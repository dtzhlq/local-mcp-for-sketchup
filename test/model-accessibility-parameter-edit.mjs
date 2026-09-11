import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { compileModelAccessibilityTask } from '../src/model-accessibility-tasks.mjs';
import { prepareTaskOwnedCreationDsl } from '../src/agent-dsl-policy.mjs';
import { buildDetailedRecipeSample } from '../src/detailed-modeling/scenes.mjs';
import { prepareAssemblyParameterEdit, applyAssemblyParameterEdit } from '../src/detailed-modeling/assembly-edit.mjs';
import { captureDefinitionParameterSource, planDefinitionParameterEdit, acceptDefinitionParameterEdit } from '../src/model-accessibility-parameter-edit.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-parameters-'));
const creationId = `task_${'a'.repeat(32)}`, taskId = `task_${'b'.repeat(32)}`, modelKey = `model_${'c'.repeat(32)}`;
const task = { version: 1, kind: 'cabinet', id: 'cabinet', units: 'mm', parameters: { width_mm: 600, depth_mm: 600, height_mm: 900 },
  instances: [{ id: 'A', origin_mm: [0, 0, 0] }, { id: 'B', origin_mm: [1800, 0, 0], rotation_z_deg: 25 }, { id: 'C', origin_mm: [3600, 0, 0] }] };
const current = async bridge => buildModelGraph(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 20000, read_only: true }));
const read = bridge => bridge.selectRuntime('mock').readModel();
let checks = 0;
function check(fn) { fn(); checks++; }
async function fixture(id, sourceTask = task, sourceBundle) {
  const dir = path.join(tmp, id);
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(dir, 'session.json') }, agentContract: { rootDir: path.join(dir, 'state') },
    approval: { stateDir: path.join(dir, 'approval'), secret: 'parameter-edit-offline-test-secret-at-least-32-bytes' }, executionPolicy: { allowed_runtimes: ['mock'], resource_limits: { max_recursive_entities: 20000 } } });
  const source = sourceBundle || compileModelAccessibilityTask(sourceTask).bundle;
  const sourceDsl = structuredClone(source.dsl);
  sourceDsl.operations = sourceDsl.operations.filter(op => !['reset', 'scene', 'camera', 'style', 'rendering_options', 'shadow'].includes(op.op));
  const prepared = prepareTaskOwnedCreationDsl(JSON.stringify(sourceDsl), { taskId: creationId });
  await bridge.build_model({ runtime: 'mock', code: prepared.code });
  // Fixture-authored metadata exists before the trusted creation snapshot.
  if (prepared.identity_map.B) await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'attribute', target_id: prepared.identity_map.B, dictionary: 'ManualFixture', attributes: { preserve: true, note: 'keep B' } },
    { op: 'tag', name: 'keep-instance-label', visible: true }, { op: 'assign_tag', target_id: prepared.identity_map.B, tag: 'keep-instance-label' }
  ] }) });
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', id: 'unrelated', name: 'unrelated', size: [100, 100, 100], origin: [9000, 9000, 0] }] }) });
  const graph = await current(bridge);
  const record = captureDefinitionParameterSource({ creationTaskId: creationId, modelKey, modelGraph: graph,
    ...(sourceBundle ? { sourceBundle } : { sourceTask }), identityMap: prepared.identity_map, materialMap: prepared.material_map, creationDocument: prepared.document });
  return { bridge, graph, record, prepared, dir };
}
function plan(f, ids = ['A'], changes = { width_mm: 800 }, scope = 'single', record = f.record, graph = f.graph, iteration = 0) {
  return planDefinitionParameterEdit({ sourceRecord: record, currentModelGraph: graph,
    request: { creation_task_id: creationId, scope, targets: ids.map(id => ({ target_id: f.prepared.identity_map[id] })), changes }, taskId, iteration, instruction: 'Change the specified cabinet width and preserve all other objects.' });
}
async function apply(f, edit) {
  const opts = { bridge: f.bridge, designGraph: edit.design_graph, changePlan: edit.change_plan, runtime: 'mock', recursiveLimit: 20000 };
  const prepared = await prepareAssemblyParameterEdit(opts);
  await assert.rejects(() => applyAssemblyParameterEdit({ ...opts, prepared }), error => error.code === 'APPROVAL_REQUIRED'); checks++;
  const token = await f.bridge.approvalAuthority.approveChallengeFromTrustedUser(prepared.prepared_edit.approval_challenge,
    { user_id: 'offline-test-reviewer', channel: 'local-user-presence-test', confirmed: true });
  return applyAssemblyParameterEdit({ ...opts, prepared, approval_token: token });
}
try {
  const f = await fixture('single'), before = await read(f.bridge), edit = plan(f);
  check(() => assert.equal(edit.ready, true));
  check(() => assert.deepEqual(edit.change_plan.operations.map(op => op.op), ['replace_component_definition']));
  check(() => assert.equal(edit.execution_allowed, false));
  check(() => assert.ok(edit.change_plan.assembly_rebuild.creation_document.operations.every(op => op.op === 'component_definition')));
  const creation = edit.change_plan.assembly_rebuild.creation_document;
  const side = creation.operations.flatMap(op => op.operations || []).find(op => op.name === 'cabinet-side-left');
  check(() => assert.deepEqual(side.size, [18, 600, 800], 'carcass stays 18 mm; width edit regenerates parts rather than scaling the root'));
  const bottom = creation.operations.flatMap(op => op.operations || []).find(op => op.name === 'cabinet-bottom');
  check(() => assert.equal(bottom.size[0], 764, 'inside clear width changes by the intended 200 mm'));
  check(() => assert.ok(Object.values(edit.next_source.part_id_aliases).includes('cabinet-leg-555-80'), 'cabinet foot corner IDs remain mapped to the initial frozen requirement'));
  check(() => assert.ok(Object.hasOwn(edit.change_plan.assembly_rebuild.identity_map, 'cabinet-leg-555-80')));
  check(() => assert.throws(() => plan(f, ['A', 'B'], { width_mm: 800 }), /exactly one/));
  check(() => assert.throws(() => plan(f, ['A', 'B'], { width_mm: 800 }, 'all'), /every actual definition/));
  check(() => assert.throws(() => plan(f, ['A'], { scale: [2, 1, 1] }), /supported explicit parameter/));
  check(() => assert.throws(() => plan(f, ['A'], { width_mm: '800' }), /preflight/i));
  check(() => assert.throws(() => plan(f, ['A'], { handle_length_mm: 700 }), /preflight/i));
  check(() => assert.throws(() => plan(f, ['A'], { width_mm: 600 }), /did not change/));
  const incomplete = structuredClone(f.graph); incomplete.completeness = { complete: false, scope_complete: false };
  check(() => assert.throws(() => plan(f, ['A'], { width_mm: 800 }, 'single', f.record, incomplete), error => error.code === 'MODEL_REVISION_INCOMPLETE'));
  const drift = structuredClone(f.graph), root = drift.nodes.find(node => node.reference === f.prepared.identity_map.A && !node.parent_id);
  drift.nodes.find(node => node.parent_id === root.node_id).material = 'manual-new-finish';
  const blocked = plan(f, ['A'], { width_mm: 800 }, 'single', f.record, drift);
  check(() => assert.deepEqual(blocked.blockers, ['manual_or_external_divergence_requires_reconciliation']));
  check(() => assert.deepEqual(blocked.operations, []));
  const tamperedRecord = structuredClone(f.record); tamperedRecord.entries[0].source_definition = 'forged';
  check(() => assert.throws(() => plan(f, ['A'], { width_mm: 800 }, 'single', tamperedRecord), error => error.code === 'ARTIFACT_INTEGRITY_ERROR'));
  const wrongDefinition = structuredClone(f.graph); wrongDefinition.nodes.find(node => node.reference === f.prepared.identity_map.A && !node.parent_id).entity_definition_name = 'different-real-definition';
  check(() => assert.equal(plan(f, ['A'], { width_mm: 800 }, 'single', f.record, wrongDefinition).ready, false));
  const applied = await apply(f, edit), after = await read(f.bridge);
  const beforeB = before.instances.find(i => i.id === f.prepared.identity_map.B), afterB = after.instances.find(i => i.id === f.prepared.identity_map.B);
  check(() => assert.deepEqual(afterB, beforeB, 'B transform, definition, tag and authored manual attributes are retained'));
  check(() => assert.deepEqual(after.groups, before.groups));
  check(() => assert.equal(after.instances.find(i => i.id === f.prepared.identity_map.A).bounding_box.w, 800));
  check(() => assert.deepEqual(after.component_definitions[beforeB.definition], before.component_definitions[beforeB.definition]));
  check(() => assert.throws(() => acceptDefinitionParameterEdit({ sourceRecord: f.record, edit, applied: structuredClone(applied) }), error => error.code === 'APPROVAL_INVALID'));
  const updated = acceptDefinitionParameterEdit({ sourceRecord: f.record, edit, applied });
  check(() => assert.equal(updated.parameter_revision, 1));
  check(() => assert.equal(updated.entries.find(e => e.logical_instance_id === 'A').source.task.parameters.width_mm, 800));
  check(() => assert.equal(updated.entries.find(e => e.logical_instance_id === 'B').source.task.parameters.width_mm, 600));
  const second = plan(f, ['A'], { width_mm: 900 }, 'single', updated, applied.model_graph, 1);
  check(() => assert.equal(second.ready, true));
  const sibling = plan(f, ['B', 'C'], { width_mm: 700 }, 'all', updated, applied.model_graph, 2);
  check(() => assert.equal(sibling.change_plan.operations.length, 2, 'all follows actual post-split definition peers'));
  check(() => assert.throws(() => plan(f, ['A', 'B', 'C'], { width_mm: 1000 }, 'all', updated, applied.model_graph), /one actual shared definition/));
  const saved = path.join(f.dir, 'saved.json'); await f.bridge.save_model({ runtime: 'mock', path: saved, keep_session: true }); await f.bridge.open_model({ runtime: 'mock', path: saved });
  const reopenedGraph = await current(f.bridge);
  check(() => assert.equal(plan(f, ['A'], { width_mm: 950 }, 'single', JSON.parse(JSON.stringify(updated)), reopenedGraph, 3).ready, true));

  const all = await fixture('all'), allBefore = await read(all.bridge), allEdit = plan(all, ['A', 'B', 'C'], { width_mm: 900 }, 'all');
  const allApplied = await apply(all, allEdit), allAfter = await read(all.bridge);
  check(() => assert.equal(allApplied.replaced_instance_count, 3));
  check(() => assert.equal(new Set(allAfter.instances.map(i => i.definition)).size, 1));
  check(() => assert.ok(allAfter.instances.every(i => i.bounding_box.w === 900)));
  check(() => assert.deepEqual(allAfter.instances.find(i => i.id === all.prepared.identity_map.B).attributes, allBefore.instances.find(i => i.id === all.prepared.identity_map.B).attributes));
  check(() => assert.equal(acceptDefinitionParameterEdit({ sourceRecord: all.record, edit: allEdit, applied: allApplied }).entries.every(e => e.source.task.parameters.width_mm === 900), true));
  const scoped = structuredClone(all.graph); scoped.completeness = { complete: false, scope_complete: true, recursive_root_paths: scoped.nodes.filter(n => n.node_type === 'occurrence' && !n.parent_id).map(n => n.entity_path) };
  for (const node of scoped.nodes.filter(n => n.node_type === 'occurrence' && !n.parent_id)) node.entity_definition_occurrence_count = 4;
  check(() => assert.throws(() => plan(all, ['A', 'B', 'C'], { width_mm: 800 }, 'all', all.record, scoped), /global definition/));
  const actualDocumentMismatch = structuredClone(all.prepared.document); actualDocumentMismatch.operations.find(op => op.op === 'component_instance').definition = 'wrong';
  check(() => assert.throws(() => captureDefinitionParameterSource({ creationTaskId: creationId, modelKey, modelGraph: all.graph, sourceTask: task, identityMap: all.prepared.identity_map, creationDocument: actualDocumentMismatch }), /actual creation document/));

  const sample = buildDetailedRecipeSample({ kind: 'cabinet', id: 'sample-cabinet', parameters: { width: 600, depth: 600, height: 900 } });
  const sampleFixture = await fixture('sample', null, sample);
  const sampleEdit = plan(sampleFixture, ['id-sample-cabinet'], { width_mm: 1000 });
  check(() => assert.equal(sampleEdit.ready, true));
  check(() => assert.equal(sampleEdit.next_source.bundle.brief.parameters.width, 1000));
  check(() => assert.equal(sampleEdit.change_plan.assembly_rebuild.creation_document.operations.some(op => op.op === 'reset'), false));
  console.log(JSON.stringify({ ok: true, checks, runtime: 'isolated_mock_only', actual_sketchup_acceptance: false,
    tested: ['real_recipe_recompile', 'fixed_board_thickness', 'actual_definition_coverage', 'manual_drift_blocked', 'single_all_reviewed_apply', 'trusted_receipt_only', 'per_instance_parameter_versions', 'detailed_sample_adapter'] }));
} finally { await fs.rm(tmp, { recursive: true, force: true }); }
