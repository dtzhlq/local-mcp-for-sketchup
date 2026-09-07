import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import { AgentGateway } from '../src/agent-gateway.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { buildDesignIntentGraph, planDesignParameterChange, reconcileDesignIntentGraph } from '../src/design-intent-graph.mjs';
import { prepareAssemblyParameterEdit, applyAssemblyParameterEdit } from '../src/detailed-modeling/assembly-edit.mjs';
import { freezeDetailSpecification, evaluateDetailQuality } from '../src/detail-quality.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'assembly-parameter-edit-'));
const modelKey = `model_${'a'.repeat(32)}`;
const ajv = new Ajv({ strict: false });
const validatePlan = ajv.compile(JSON.parse(await fs.readFile(new URL('../schema/design-parameter-change-plan-v1.schema.json', import.meta.url))));
const validateGraph = ajv.compile(JSON.parse(await fs.readFile(new URL('../schema/design-intent-graph-v1.schema.json', import.meta.url))));
function dsl(width = 800) {
  return { version: 1, units: 'mm', operations: [
    { op: 'component_definition', name: 'Handle', operations: [{ op: 'box', id: 'handle', name: 'handle', size: [90, 12, 8], origin: [0, 0, 0] }] },
    { op: 'component_definition', name: 'Cabinet', operations: [
      { op: 'box', id: 'carcass', name: 'carcass', size: [width, 600, 850], origin: [0, 0, 0] },
      { op: 'component_instance', id: 'hardware', name: 'hardware', definition: 'Handle', origin: [300, -20, 700] }
    ] },
    { op: 'component_instance', id: 'cabinet-a', name: 'Cabinet A', definition: 'Cabinet', origin: [100, 0, 0] },
    { op: 'component_instance', id: 'cabinet-b', name: 'Cabinet B', definition: 'Cabinet', origin: [1500, 0, 0] },
    { op: 'box', id: 'unrelated', name: 'Unrelated', size: [250, 250, 250], origin: [5000, 0, 0] }
  ] };
}
async function fixture(name, { all = false } = {}) {
  const directory = path.join(temporary, name);
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(directory, 'session.json') },
    agentContract: { rootDir: path.join(directory, 'agent-state') },
    approval: { stateDir: path.join(directory, 'approvals'), secret: 'assembly-test-secret-at-least-thirty-two-bytes' },
    executionPolicy: { allowed_runtimes: ['mock'] } });
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify(dsl()) });
  const graph = await current(bridge);
  const designGraph = buildDesignIntentGraph({ modelKey, modelGraph: graph,
    parametricRecipe: { version: 1, id: 'cabinet-recipe', parameters: [{ id: 'width', value: 800, type: 'number', minimum: 300, maximum: 2000 }] },
    entityBindings: [{ binding_id: 'cabinet', part_id: 'cabinet', entity: { target_id: 'cabinet-a' },
      ...(all ? { existing_targets: [{ target_id: 'cabinet-b' }] } : {}), parameter_bindings: ['width'], rebuild_template: [] }] });
  assert.equal(validateGraph(designGraph), true, JSON.stringify(validateGraph.errors));
  return { directory, bridge, graph, designGraph };
}
const current = async bridge => buildModelGraph(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 }));
const read = async bridge => bridge.selectRuntime('mock').readModel();
function plan(fixture, { scope = 'single', width = 1000, iteration = 0, previousDsl = dsl(), nextDsl = dsl(width), graph = fixture.graph, designGraph = fixture.designGraph } = {}) {
  const result = planDesignParameterChange({ designGraph, currentModelGraph: graph, changes: { width },
    assemblyRebuild: { previousDsl, nextDsl, scope, taskId: `task_${'b'.repeat(32)}`, iteration } });
  assert.equal(validatePlan(result), true, JSON.stringify(validatePlan.errors));
  return result;
}
async function approve(fixture, prepared) {
  return fixture.bridge.approvalAuthority.approveChallengeFromTrustedUser(prepared.prepared_edit.approval_challenge,
    { user_id: 'assembly-reviewer', channel: 'local-user-presence-test', confirmed: true });
}

try {
  const single = await fixture('single');
  const before = await read(single.bridge), change = plan(single);
  assert.deepEqual(change.operations.map(operation => operation.op), ['replace_component_definition']);
  assert.equal(change.risk_level, 'S2');
  assert.equal(change.execution_allowed, false);
  assert.equal(change.assembly_rebuild.copied_definition_count, 2, 'copy the nested dependency closure, not the entire model');
  assert.deepEqual(change.assembly_rebuild.changed_definitions, ['Cabinet']);
  assert.ok(change.assembly_rebuild.creation_document.operations.every(operation => operation.op === 'component_definition'));
  const prepared = await prepareAssemblyParameterEdit({ ...single, changePlan: change, outputDir: single.directory });
  assert.equal(prepared.prepared_edit.plan.compile_permission, 'ready_for_review');
  assert.equal((await read(single.bridge)).instances[0].definition, 'Cabinet', 'creating definitions must not replace an existing instance');
  await assert.rejects(() => applyAssemblyParameterEdit({ ...single, changePlan: change, prepared, outputDir: single.directory }), error => error.code === 'APPROVAL_REQUIRED');
  const artifactPath = path.join(single.directory, 'design-intent.json');
  const applied = await applyAssemblyParameterEdit({ ...single, changePlan: change, prepared,
    approval_token: await approve(single, prepared), outputDir: single.directory, designGraphPath: artifactPath });
  const frozenSpec = freezeDetailSpecification({ version: 1, required_parts: ['cabinet-a','cabinet-b'].map(root => ({ id: 'handle', instance_path: [root,'hardware','handle'], min_faces: 6 })) });
  const mappingTask = await single.bridge.taskStore.createTask({ intent: 'create_model', instruction: 'Server-owned assembly mapping contract fixture', inputs: { runtime: 'mock' } });
  await single.bridge.taskStore.update(mappingTask.task.task_id, { private: { creation: { runtime: 'mock', frozen_spec: frozenSpec, identity_map: {}, round: { snapshot: {} } } } });
  await assert.rejects(() => single.bridge.agentGateway.recordTrustedAssemblyEditMapping({ creation_task_id: mappingTask.task.task_id, receipt: structuredClone(applied.assembly_edit_receipt) }), error => error.code === 'APPROVAL_INVALID');
  const originalMappedHandle = applied.assembly_edit_receipt.identity_map.handle;
  applied.assembly_edit_receipt.identity_map.handle = 'forged-other-part';
  await assert.rejects(() => single.bridge.agentGateway.recordTrustedAssemblyEditMapping({ creation_task_id: mappingTask.task.task_id, receipt: applied.assembly_edit_receipt }), error => error.code === 'APPROVAL_INVALID');
  applied.assembly_edit_receipt.identity_map.handle = originalMappedHandle;
  const originalInspect = single.bridge.inspect_model.bind(single.bridge);
  let mappingTimeout;
  single.bridge.inspect_model = async options => { mappingTimeout = options.timeoutMs; return originalInspect(options); };
  single.bridge.inspect_model = async options => { mappingTimeout = options.timeoutMs; throw new Error('simulated read timeout after committed edit'); };
  await assert.rejects(() => single.bridge.agentGateway.recordTrustedAssemblyEditMapping({ creation_task_id: mappingTask.task.task_id, receipt: applied.assembly_edit_receipt }), /simulated read timeout/);
  const pendingTask = await single.bridge.taskStore.getTask(mappingTask.task.task_id, { includePrivate: true });
  const originalPending = structuredClone(pendingTask.private.creation.pending_assembly_mapping);
  const tamperedPending = structuredClone(pendingTask.private);
  tamperedPending.creation.pending_assembly_mapping.receipt.identity_map.handle = 'forged-other-part';
  await single.bridge.taskStore.update(mappingTask.task.task_id, { private: tamperedPending });
  const restartedGateway = new AgentGateway({ bridge: single.bridge, taskStore: single.bridge.taskStore });
  await assert.rejects(() => restartedGateway.resumeTrustedAssemblyEditMapping({ creation_task_id: mappingTask.task.task_id }), error => error.code === 'APPROVAL_INVALID');
  tamperedPending.creation.pending_assembly_mapping = originalPending;
  await single.bridge.taskStore.update(mappingTask.task.task_id, { private: tamperedPending });
  single.bridge.inspect_model = async options => { mappingTimeout = options.timeoutMs; return originalInspect(options); };
  const nativeBeforeRecovery = await read(single.bridge);
  const resumedMapping = await restartedGateway.resumeUnprojected({ task_id: mappingTask.task.task_id });
  const mappingReceipt = resumedMapping.data.assembly_mapping_recovery;
  assert.deepEqual(await read(single.bridge), nativeBeforeRecovery, 'recovery must not replay any geometry mutation');
  assert.equal(mappingTimeout, 120000, 'post-edit verification must use the same bounded live timeout as the edit');
  single.bridge.inspect_model = originalInspect;
  assert.equal(mappingReceipt.mapped_parts, 1);
  const mappedTask = await single.bridge.taskStore.getTask(mappingTask.task.task_id, { includePrivate: true });
  assert.equal(mappedTask.private.creation.frozen_spec.hash, frozenSpec.hash, 'versioned mapping must never replace or weaken the original frozen requirements');
  const pathMap = mappedTask.private.creation.occurrence_path_map;
  assert.equal(pathMap[JSON.stringify(['cabinet-b','hardware','handle'])], undefined, 'single-instance replacement must leave the other shared instance mapping unchanged');
  const newPath = pathMap[JSON.stringify(['cabinet-a','hardware','handle'])];
  assert.deepEqual(newPath, ['cabinet-a', applied.assembly_edit_receipt.identity_map.hardware, applied.assembly_edit_receipt.identity_map.handle]);
  const measuredFixture = { geometry_occurrences: [newPath, ['cabinet-b','hardware','handle']].map(instance_path => ({ instance_path, geometry_evidence: { source: 'mock_runtime', measured: true, face_count: 6 } })) };
  assert.equal(evaluateDetailQuality({ snapshot: measuredFixture, frozenSpecification: frozenSpec, runtime: 'mock', trustedSnapshot: true, occurrencePathMap: pathMap }).quality_accepted, true);
  assert.equal(evaluateDetailQuality({ snapshot: measuredFixture, frozenSpecification: frozenSpec, runtime: 'mock', trustedSnapshot: true }).quality_accepted, false, 'new namespace requires the reviewed server mapping, not a changed frozen specification');
  const countedCreation = { ...mappedTask.private.creation, per_part_failure_streak: { '["cabinet-a","hardware","handle"]': 3 } };
  await single.bridge.taskStore.update(mappingTask.task.task_id, { private: { ...mappedTask.private, creation: countedCreation } });
  const repeatedMapping = await single.bridge.agentGateway.recordTrustedAssemblyEditMapping({ creation_task_id: mappingTask.task.task_id, receipt: applied.assembly_edit_receipt });
  assert.equal(repeatedMapping.already_recorded, true);
  const repeatedTask = await single.bridge.taskStore.getTask(mappingTask.task.task_id, { includePrivate: true });
  assert.equal(repeatedTask.private.creation.assembly_edit_receipts.length, 1);
  assert.equal(repeatedTask.private.creation.per_part_failure_streak['["cabinet-a","hardware","handle"]'], 3, 'replaying the same legitimate receipt cannot reset later correction failures');
  const voidSpec = freezeDetailSpecification({ ...frozenSpec.specification, required_voids: ['cabinet-a','cabinet-b'].map(root => ({ id: root, instance_path: [root], bounds_mm: { min: [1,1,1], max: [2,2,2] } })) });
  const voidTask = await single.bridge.taskStore.createTask({ intent: 'create_model', instruction: 'Trusted void budget mapping fixture', inputs: { runtime: 'mock' } });
  await single.bridge.taskStore.update(voidTask.task.task_id, { private: { creation: { runtime: 'mock', frozen_spec: voidSpec, per_part_failure_streak: { 'void:cabinet-a': 3, 'void:cabinet-b': 3 } } } });
  await single.bridge.agentGateway.recordTrustedAssemblyEditMapping({ creation_task_id: voidTask.task.task_id, receipt: applied.assembly_edit_receipt });
  const remappedVoid = await single.bridge.taskStore.getTask(voidTask.task.task_id, { includePrivate: true });
  assert.equal(remappedVoid.private.creation.per_part_failure_streak['void:cabinet-a'], 0, 'a new actual reviewed edit resets its own void correction budget');
  assert.equal(remappedVoid.private.creation.per_part_failure_streak['void:cabinet-b'], 3, 'an unselected instance retains its void correction budget');
  const after = await read(single.bridge);
  assert.equal(after.instances[0].id, before.instances[0].id);
  assert.deepEqual(after.instances[0].transform, before.instances[0].transform);
  assert.notEqual(after.instances[0].definition, 'Cabinet');
  assert.equal(after.instances[0].bounding_box.w, 1000);
  assert.deepEqual(after.instances[1], before.instances[1], 'unselected shared instance remains byte identical');
  assert.deepEqual(after.groups, before.groups, 'unrelated geometry remains byte identical');
  assert.deepEqual(after.component_definitions.Cabinet, before.component_definitions.Cabinet, 'old definition remains intact');
  assert.deepEqual(after.component_definitions.Handle, before.component_definitions.Handle, 'old nested definition remains intact');
  assert.equal(applied.design_graph.parameters.width.value, 1000);
  assert.equal(applied.design_graph.correction_history.length, 1);
  const saved = path.join(single.directory, 'reopen.json');
  await single.bridge.save_model({ runtime: 'mock', path: saved, keep_session: true });
  await single.bridge.open_model({ runtime: 'mock', path: saved });
  const reopenedGraph = await current(single.bridge), persistedDesign = JSON.parse(await fs.readFile(artifactPath));
  assert.equal(reconcileDesignIntentGraph({ designGraph: persistedDesign, currentModelGraph: reopenedGraph }).aligned, true);
  const second = plan(single, { designGraph: persistedDesign, graph: reopenedGraph, width: 1100, previousDsl: dsl(1000), nextDsl: dsl(1100), iteration: 1 });
  assert.equal(second.assembly_rebuild.replacements[0].logical_definition, 'Cabinet', 'logical recipe identity survives namespaced definition versions');
  const secondPrepared = await prepareAssemblyParameterEdit({ ...single, designGraph: persistedDesign, changePlan: second, outputDir: path.join(single.directory, 'second') });
  await applyAssemblyParameterEdit({ ...single, designGraph: persistedDesign, changePlan: second, prepared: secondPrepared,
    approval_token: await approve(single, secondPrepared), outputDir: path.join(single.directory, 'second') });
  assert.equal((await read(single.bridge)).instances[0].bounding_box.w, 1100);
  assert.deepEqual((await read(single.bridge)).instances[1], before.instances[1]);

  const all = await fixture('all', { all: true }), allChange = plan(all, { scope: 'all' });
  assert.equal(allChange.operations.length, 2);
  const allPrepared = await prepareAssemblyParameterEdit({ ...all, changePlan: allChange, outputDir: all.directory });
  const allResult = await applyAssemblyParameterEdit({ ...all, changePlan: allChange, prepared: allPrepared,
    approval_token: await approve(all, allPrepared), outputDir: all.directory });
  const allModel = await read(all.bridge);
  assert.equal(allModel.instances[0].definition, allModel.instances[1].definition);
  assert.equal(allModel.instances[1].bounding_box.w, 1000);
  assert.equal(allResult.replaced_instance_count, 2);

  const guarded = await fixture('guarded');
  assert.throws(() => plan(guarded, { scope: 'all' }), /every current instance/, 'all scope may not implicitly expand past the baseline');
  assert.throws(() => plan(guarded, { scope: undefined, nextDsl: dsl() }), /did not change/);
  const drifted = structuredClone(guarded.graph);
  const rootNode = drifted.nodes.find(node => node.reference === 'cabinet-a' && !node.parent_id);
  const child = drifted.nodes.find(node => node.reference === 'carcass' && node.parent_id === rootNode?.node_id);
  assert.ok(child, JSON.stringify(drifted.nodes.filter(node => node.node_type === 'occurrence').map(node => ({ id: node.node_id, parent: node.parent_id, ref: node.reference, path: node.entity_path }))));
  child.material = 'Manual_Material';
  const blocked = planDesignParameterChange({ designGraph: guarded.designGraph, currentModelGraph: drifted, changes: { width: 1000 },
    assemblyRebuild: { previousDsl: dsl(), nextDsl: dsl(1000), scope: 'single', taskId: `task_${'c'.repeat(32)}` } });
  assert.deepEqual(blocked.blockers, ['manual_or_external_divergence_requires_reconciliation']);
  assert.equal(blocked.operations.length, 0, 'manual nested changes block before unused definitions are created');
  const tampered = structuredClone(plan(guarded));
  tampered.operations[0].target_id = 'cabinet-b';
  await assert.rejects(() => prepareAssemblyParameterEdit({ ...guarded, changePlan: tampered }), error => error.code === 'PLAN_HASH_MISMATCH');
  assert.equal(Object.keys((await read(guarded.bridge)).component_definitions).length, 2);
  const missingMaterialDsl = dsl(1000);
  missingMaterialDsl.operations.find(operation => operation.name === 'Cabinet').operations[0].material = 'Missing_Implicit_Material';
  assert.throws(() => plan(guarded, { nextDsl: missingMaterialDsl }), error => error.code === 'OPERATION_NOT_ALLOWED', 'fresh definitions must not implicitly create undeclared materials');
  const mappedGraph = structuredClone(guarded.graph);
  mappedGraph.catalogs.materials.push({ name: 'Actual_Namespaced_Material' });
  const mappedPlan = planDesignParameterChange({ designGraph: guarded.designGraph, currentModelGraph: mappedGraph, changes: { width: 1000 },
    assemblyRebuild: { previousDsl: dsl(), nextDsl: missingMaterialDsl, scope: 'single', taskId: `task_${'d'.repeat(32)}`,
      materialMap: { Missing_Implicit_Material: 'Actual_Namespaced_Material' } } });
  assert.equal(mappedPlan.assembly_rebuild.creation_document.operations.at(-1).operations[0].material, 'Actual_Namespaced_Material');
  console.log(JSON.stringify({ ok: true, runtime: 'mock-only', single_and_all_reviewed: true, unaffected_instances_preserved: true,
    original_definitions_preserved: true, missing_approval_blocked: true, manual_subtree_divergence_blocked: true,
    save_reopen_second_parameter_edit: true, plan_schema_valid: true }));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
