import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planTraditionalBayStructureChange } from '../src/traditional-timber/structure-edit.mjs';
import { straightCorridorTask, squarePavilionTask, cornerCorridorTask, roofedGateTask, houseUnitTask } from '../src/traditional-timber/examples.mjs';
import { compileModelAccessibilityTask } from '../src/model-accessibility-tasks.mjs';
import { planDefinitionParameterEdit } from '../src/model-accessibility-parameter-edit.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { adoptParameterRoots } from '../src/model-accessibility-scoped-readback.mjs';
import { compileCurrentTraditionalParameterVerification } from '../src/traditional-timber/parameter-verification-spec.mjs';

const original = straightCorridorTask('topology-corridor');
const originalJson = JSON.stringify(original);
const inserted = planTraditionalBayStructureChange(original, { operation: 'insert_bay', segment_id: 'run', bay_index: 1, length_mm: 2400 });
assert.equal(JSON.stringify(original), originalJson, 'planning must not mutate the stored source');
assert.deepEqual(inserted.task.parameters.bay_lengths_mm, [3000, 2400, 3000, 3000, 3000]);
assert.equal(compileModelAccessibilityTask(inserted.task).bundle.rule_expected_values.column_count, 12);
assert.deepEqual(inserted.migration.bay_index_map.map(entry => entry.after), [0, 2, 3, 4]);
assert.equal(inserted.migration.station_id_map['run-station-2'], 'run-station-3');
const removed = planTraditionalBayStructureChange(inserted.task, { operation: 'remove_bay', segment_id: 'run', bay_index: 1 });
assert.deepEqual(removed.task.parameters, original.parameters);
assert.equal(compileModelAccessibilityTask(removed.task).bundle.rule_expected_values.column_count, 10);
assert.equal(removed.migration.station_id_map['run-station-2'], null);
for (const index of [0, 4]) {
  const edge = planTraditionalBayStructureChange(original, { operation: 'insert_bay', segment_id: 'run', bay_index: index, length_mm: 1500 });
  assert.equal(compileModelAccessibilityTask(edge.task).bundle.rule_expected_values.total_path_length_mm, 13500);
}
const gate = roofedGateTask('bound-gate');
const shifted = planTraditionalBayStructureChange(gate, { operation: 'insert_bay', segment_id: 'grid', bay_index: 0, length_mm: 2500 });
assert.equal(shifted.task.assembly.assemblies.find(part => part.id === 'gate-wall').parameters.bay_index, 1);
assert.deepEqual(shifted.migration.migrated_bindings, [{ assembly_id: 'gate-wall', segment_id: 'grid', before_bay_index: 0, after_bay_index: 1, semantic_id_preserved: true }]);
assert.equal(compileModelAccessibilityTask(shifted.task).bundle.detail_spec.required_voids[0].id,
  compileModelAccessibilityTask(gate).bundle.detail_spec.required_voids[0].id);
assert.throws(() => planTraditionalBayStructureChange(shifted.task, { operation: 'remove_bay', segment_id: 'grid', bay_index: 1 }), /attached assembly gate-wall/);
const back = planTraditionalBayStructureChange(shifted.task, { operation: 'remove_bay', segment_id: 'grid', bay_index: 0 });
assert.equal(back.task.assembly.assemblies.find(part => part.id === 'gate-wall').parameters.bay_index, 0);
compileModelAccessibilityTask(back.task);
assert.throws(() => planTraditionalBayStructureChange(gate, { operation: 'remove_bay', segment_id: 'grid', bay_index: 0 }), /1\.\.16/);
assert.throws(() => planTraditionalBayStructureChange(squarePavilionTask(), { operation: 'insert_bay', segment_id: 'grid', bay_index: 1, length_mm: 3000 }), /only gable and flat/);
assert.throws(() => planTraditionalBayStructureChange(cornerCorridorTask(), { operation: 'insert_bay', segment_id: 'run', bay_index: 1, length_mm: 3000 }), /one straight path/);
assert.throws(() => planTraditionalBayStructureChange(houseUnitTask(), { operation: 'insert_bay', segment_id: 'grid', bay_index: 1, length_mm: 3000 }), /board-door.*literal/);
assert.throws(() => planTraditionalBayStructureChange(original, { operation: 'remove_bay', segment_id: 'run', bay_index: 4 }), /bay_index/);
assert.throws(() => planTraditionalBayStructureChange(original, { operation: 'insert_bay', segment_id: 'run', bay_index: 1, length_mm: 0 }), /length_mm/);
assert.throws(() => planTraditionalBayStructureChange(original, { operation: 'remove_bay', segment_id: 'run', bay_index: 1, length_mm: 3000 }), /unsupported fields/);
const indexed = structuredClone(gate);
indexed.parameters.bay_address = 0;
indexed.assembly.parameter_bindings['gate-wall'].bay_index = 'bay_address';
assert.throws(() => planTraditionalBayStructureChange(indexed, { operation: 'insert_bay', segment_id: 'grid', bay_index: 0, length_mm: 3000 }), /parameter-bound bay addressing/);
const sceneMember = structuredClone(original);
sceneMember.assembly.representation = { ...sceneMember.assembly.representation, scene_id: 'external-connections', overview_scope: 'scene' };
assert.throws(() => planTraditionalBayStructureChange(sceneMember, { operation: 'insert_bay', segment_id: 'run', bay_index: 0, length_mm: 3000 }), /scene-connection migration/);

// Public gateway + real in-process mock reviewed replacement. This checks
// persistence, world placement, shared-root isolation and replay protection;
// it deliberately makes no native SketchUp or cold-reopen claim.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'traditional-structure-edit-'));
try {
  const options = { mock: { sessionPath: path.join(directory, 'model.json') },
    agentContract: { rootDir: path.join(directory, 'tasks') }, approval: { stateDir: path.join(directory, 'approvals') },
    executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [],
      resource_limits: { max_operations: 100, max_affected_instances: 40, max_recursive_entities: 20000 } } };
  let bridge = new SketchUpBridge(options);
  const small = straightCorridorTask('editable-corridor');
  // Roof insertion/removal is already compiled above. A frame-only fixture
  // keeps the persisted mock edit/recovery test small enough for routine CI.
  small.parameters = { bay_lengths_mm: [1500, 1500], width_mm: 1000, column_height_mm: 2800 };
  small.assembly.assemblies = [small.assembly.assemblies[0]];
  small.assembly.parameter_bindings = { frame: { column_height_mm: 'column_height_mm' } };
  small.assembly.connections = [];
  small.instances = [{ id: 'selected', origin_mm: [1000, 2000, 0], rotation_z_deg: 90 }, { id: 'shared', origin_mm: [1000, 8000, 0] }];
  delete small.placement;
  const created = await bridge.start_agent_task({ intent: 'create_model', instruction: 'Create isolated shared corridor fixture.', idempotency_key: 'structure-source', inputs: { runtime: 'mock', recursive_limit: 10000, task: small } });
  const creationTask = await bridge.taskStore.getTask(created.task_id, { includePrivate: true });
  const source = creationTask.private.creation.parameter_source;
  assert.ok(source, JSON.stringify(creationTask.private.creation.parameter_edit_support));
  bridge = new SketchUpBridge({ ...options, executionPolicy: { ...options.executionPolicy,
    development_model_auto_approval: { enabled: true, authorization_ref: 'test-fixture:isolated-structure-edit',
      allowed_model_keys: [source.model_key], allowed_roots: [directory], allowed_risks: ['S1', 'S2'], max_affected_instances: 1, allow_save_model: false } } });
  const target = source.entries[0].target;
  const readGraph = async () => buildModelGraph(await adoptParameterRoots({ bridge, runtime: 'mock', recursiveLimit: 10000, rootIds: source.entries.map(entry => entry.target.target_id) }));
  const beforeGraph = await readGraph();
  const rootNode = (graph, reference) => graph.nodes.find(node => node.node_type === 'occurrence' && (node.reference === reference || node.persistent_id === reference));
  const beforeSelected = structuredClone(rootNode(beforeGraph, target.target_id));
  const beforeShared = structuredClone(rootNode(beforeGraph, source.entries[1].target.target_id));
  const baseRequest = { creation_task_id: created.task_id, scope: 'single', targets: [target] };
  assert.throws(() => planDefinitionParameterEdit({ sourceRecord: source, currentModelGraph: beforeGraph,
    request: { ...baseRequest, changes: { bay_lengths_mm: [1500, 1500, 1500] } }, taskId: 'task_44444444-4444-4444-8444-444444444444' }), /topology change/);
  assert.throws(() => planDefinitionParameterEdit({ sourceRecord: source, currentModelGraph: beforeGraph,
    request: { ...baseRequest, changes: {}, structure_change: { operation: 'remove_bay', segment_id: 'run', bay_index: 0 } } }), /exactly one/);
  assert.throws(() => planDefinitionParameterEdit({ sourceRecord: source, currentModelGraph: beforeGraph,
    request: { ...baseRequest, scope: 'all', structure_change: { operation: 'remove_bay', segment_id: 'run', bay_index: 0 } } }), /all must cover every/);
  const divergent = structuredClone(beforeGraph);
  rootNode(divergent, target.target_id).bounding_box.max[0] += 100;
  const rejected = planDefinitionParameterEdit({ sourceRecord: source, currentModelGraph: divergent,
    request: { ...baseRequest, structure_change: { operation: 'remove_bay', segment_id: 'run', bay_index: 0 } }, taskId: 'task_66666666-6666-4666-8666-666666666666' });
  assert.equal(rejected.ready, false);
  assert.deepEqual(rejected.operations, []);
  const request = { intent: 'modify_design_parameters', instruction: 'Explicitly insert one bay into only the selected corridor.', idempotency_key: 'insert-reviewed-bay',
    inputs: { runtime: 'mock', recursive_limit: 10000, budgets: { max_operations: 100, max_affected_instances: 40, recursive_limit: 10000 },
      parameter_edit: { ...baseRequest, structure_change: { operation: 'insert_bay', segment_id: 'run', bay_index: 1, length_mm: 1600 } } } };
  for (const [field, value] of [['max_affected_instances', 41], ['max_operations', 101], ['recursive_limit', 20001]]) {
    const rejectedBudget = await bridge.start_agent_task({ ...request, idempotency_key: `excessive-structure-budget-${field}`,
      inputs: { ...request.inputs, budgets: { ...request.inputs.budgets, [field]: value } } });
    assert.equal(rejectedBudget.ok, false, JSON.stringify(rejectedBudget));
    assert.equal(rejectedBudget.error.code, 'POLICY_DENIED');
    const rejectedTask = await bridge.taskStore.getTask(rejectedBudget.task_id, { includePrivate: true });
    assert.equal(rejectedTask.private.parameter_execution, undefined, 'An excessive budget must fail before staging definitions.');
    assert.equal((await readGraph()).model_revision, beforeGraph.model_revision, 'Rejected budgets must not mutate geometry or definitions.');
    assert.equal((await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.parameter_source.source_record_hash, source.source_record_hash);
  }
  const prestageFailures = [
    { id: 'all-roots-over-request-budget', budgets: { max_affected_instances: 1 },
      parameter_edit: { ...request.inputs.parameter_edit, scope: 'all', targets: source.entries.map(entry => entry.target) }, code: 'POLICY_DENIED' },
    { id: 'requested-recursive-budget-incomplete', budgets: { recursive_limit: 1 }, code: 'MODEL_REVISION_INCOMPLETE' },
    { id: 'unsupported-prestage-face-budget', budgets: { max_faces: 1 }, code: 'OPERATION_NOT_ALLOWED' },
    { id: 'unsupported-prestage-edge-budget', budgets: { max_edges: 1000000 }, code: 'OPERATION_NOT_ALLOWED' }
  ];
  for (const negative of prestageFailures) {
    const rejectedBudget = await bridge.start_agent_task({ ...request, idempotency_key: negative.id, inputs: { ...request.inputs,
      budgets: { ...request.inputs.budgets, ...negative.budgets }, parameter_edit: negative.parameter_edit || request.inputs.parameter_edit } });
    assert.equal(rejectedBudget.ok, false, JSON.stringify(rejectedBudget));
    assert.equal(rejectedBudget.error.code, negative.code, JSON.stringify(rejectedBudget));
    const rejectedTask = await bridge.taskStore.getTask(rejectedBudget.task_id, { includePrivate: true });
    if (negative.id === 'all-roots-over-request-budget') assert.equal(rejectedTask.private.creation_parameter_edit.change_plan.assembly_rebuild.replacements.length, 2);
    assert.equal(rejectedTask.private.parameter_execution, undefined, `${negative.id} must fail before staging definitions.`);
    assert.equal((await readGraph()).model_revision, beforeGraph.model_revision, `${negative.id} changed the model.`);
    assert.equal((await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.parameter_source.source_record_hash, source.source_record_hash);
  }
  const execute = async request => {
    const started = await bridge.start_agent_task(request);
    assert.equal(started.ok, true, JSON.stringify(started));
    let completed = started;
    for (let step = 0; step < 4 && completed.task_state !== 'completed'; step++) {
      completed = await bridge.submit_agent_task_input({ task_id: started.task_id, idempotency_key: `${request.idempotency_key}-stage-${step}`, input: {} });
      assert.equal(completed.ok, true, JSON.stringify(completed));
    }
    assert.equal(completed.task_state, 'completed', JSON.stringify(completed));
    return completed;
  };
  const completed = await execute(request), started = completed;
  assert.equal(completed.result.geometry_applied, true);
  const completedTask = await bridge.taskStore.getTask(completed.task_id, { includePrivate: true });
  const reviewedTask = await bridge.taskStore.getTask(completedTask.private.parameter_execution.reviewed_task_id, { includePrivate: true });
  assert.deepEqual(completedTask.private.parameter_execution.review_budgets, request.inputs.budgets, 'Signed execution freezes the exact public budgets.');
  assert.deepEqual(reviewedTask.inputs.budgets, request.inputs.budgets, 'Reviewed child inherits the exact public budgets under the 40-instance host limit.');
  assert.deepEqual(reviewedTask.private.existing_edit_plan.budgets, request.inputs.budgets);
  const updated = (await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.parameter_source;
  assert.deepEqual(updated.entries[0].source.task.parameters.bay_lengths_mm, [1500, 1600, 1500]);
  assert.deepEqual(updated.entries[1].source.task.parameters.bay_lengths_mm, [1500, 1500]);
  assert.equal(updated.entries[1].source_definition, source.entries[1].source_definition);
  assert.equal(updated.entries[0].source.topology_migrations.length, 1);
  const afterGraph = await readGraph();
  assert.ok(beforeSelected.transform || beforeSelected.transformation || beforeSelected.world_transform, 'fixture has a real non-origin placement');
  const beforeSize = beforeSelected.bounding_box, afterSize = rootNode(afterGraph, target.target_id).bounding_box;
  assert.equal(Math.max(afterSize.w, afterSize.d) - Math.max(beforeSize.w, beforeSize.d), 1600, 'applied geometry gains exactly the inserted bay length');
  for (const [before, after] of [[beforeSelected, rootNode(afterGraph, target.target_id)], [beforeShared, rootNode(afterGraph, source.entries[1].target.target_id)]]) {
    assert.deepEqual(after.transform, before.transform, 'selected and shared world placements are preserved');
    assert.deepEqual(after.transformation, before.transformation);
    assert.deepEqual(after.world_transform, before.world_transform);
  }
  assert.ok(beforeShared.bounding_box);
  assert.deepEqual(rootNode(afterGraph, source.entries[1].target.target_id).bounding_box, beforeShared.bounding_box, 'shared geometry bounds stay unchanged');
  assert.equal((await bridge.start_agent_task(request)).task_id, started.task_id, 'same idempotency key returns the original structure edit');
  assert.equal((await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.parameter_source.parameter_revision, 1);
  const dimension = planDefinitionParameterEdit({ sourceRecord: updated, currentModelGraph: afterGraph,
    request: { ...baseRequest, changes: { bay_lengths_mm: [1500, 1700, 1500] } }, taskId: 'task_55555555-5555-4555-8555-555555555555' });
  assert.equal(dimension.ready, true);
  assert.equal(dimension.next_source.topology_migrations.length, 1, 'later dimensional edits preserve migration history');
  const currentCreation = (await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation;
  const currentSpec = compileCurrentTraditionalParameterVerification({ creation: currentCreation, record: updated, graph: afterGraph });
  assert.notEqual(currentSpec.frozen_spec.hash, creationTask.private.creation.frozen_spec.hash);
  assert.deepEqual(currentSpec.frozen_spec.specification.compiler_expected_values.by_root.map(row => row.values.column_count), [8, 6], 'shared root keeps its original topology requirements');
  assert.equal(currentSpec.frozen_spec.specification.native_joint_checks.length, 2, 'each current root retains a separate measured joint requirement');
  const selectedJoint = currentSpec.frozen_spec.specification.native_joint_checks.find(check => check.id.startsWith('selected:'));
  const sharedJoint = currentSpec.frozen_spec.specification.native_joint_checks.find(check => check.id.startsWith('shared:'));
  assert.notDeepEqual(currentSpec.occurrence_path_map[JSON.stringify(selectedJoint.second_instance_path)], currentSpec.occurrence_path_map[JSON.stringify(sharedJoint.second_instance_path)]);
  const verify = await bridge.start_agent_task({ intent: 'verify_model', instruction: 'Verify the current topology per bound root.', idempotency_key: 'verify-inserted-topology',
    inputs: { runtime: 'mock', creation_task_id: created.task_id, parameter_task_id: completed.task_id } });
  assert.equal(verify.ok, true, JSON.stringify(verify));
  const verification = await bridge.taskStore.getTask(verify.task_id, { includePrivate: true });
  assert.equal(verification.private.creation.frozen_spec.hash, currentSpec.frozen_spec.hash);
  assert.equal(verification.private.frozen_creation_verification.edit_hash, (await bridge.taskStore.getTask(completed.task_id, { includePrivate: true })).private.creation_parameter_edit.edit_hash);
  assert.equal((await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.frozen_spec.hash, creationTask.private.creation.frozen_spec.hash, 'old creation evidence is not overwritten');
  assert.notEqual(verification.result.quality_accepted, true, 'mock does not establish native quality acceptance');
  const dimensional = await execute({ ...request, idempotency_key: 'dimension-after-topology', inputs: { ...request.inputs,
    budgets: undefined,
    parameter_edit: { ...baseRequest, changes: { bay_lengths_mm: [1500, 1700, 1500] } } } });
  const dimensionTask = await bridge.taskStore.getTask(dimensional.task_id, { includePrivate: true });
  assert.deepEqual(dimensionTask.private.parameter_execution.review_budgets, request.inputs.budgets, 'Omitted budgets use host-bounded defaults instead of the global 200-instance default.');
  const dimensionVerify = await bridge.start_agent_task({ intent: 'verify_model', instruction: 'Verify dimensions using the updated topology.', idempotency_key: 'verify-dimensional-topology',
    inputs: { runtime: 'mock', creation_task_id: created.task_id, parameter_task_id: dimensional.task_id } });
  assert.equal(dimensionVerify.ok, true, JSON.stringify(dimensionVerify));
  const dimensionalSpec = (await bridge.taskStore.getTask(dimensionVerify.task_id, { includePrivate: true })).private.creation.frozen_spec.specification;
  assert.deepEqual(dimensionalSpec.compiler_expected_values.by_root.map(row => row.values.total_path_length_mm), [4700, 3000]);
  const removeResult = await execute({ ...request, idempotency_key: 'remove-reviewed-bay', inputs: { ...request.inputs,
    parameter_edit: { ...baseRequest, structure_change: { operation: 'remove_bay', segment_id: 'run', bay_index: 1 } } } });
  assert.equal(removeResult.result.geometry_applied, true);
  const finalSource = (await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.parameter_source;
  assert.deepEqual(finalSource.entries[0].source.task.parameters.bay_lengths_mm, [1500, 1500]);
  assert.equal(finalSource.entries[0].source.topology_migrations.length, 2);
  assert.equal(finalSource.entries[1].source_definition, source.entries[1].source_definition);
} finally { await fs.rm(directory, { recursive: true, force: true }); }
console.log('Traditional structure edit: insert/remove proposals, explicit ID and attachment migration, unsafe dependency rejection, reviewed mock replacement, shared isolation and idempotent source continuation passed.');
