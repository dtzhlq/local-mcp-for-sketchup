import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { planLayoutEdit, prepareLayoutEdit, validateLayoutEdit } from '../src/model-accessibility-layout-edit.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { identityMatrix, transformPoint } from '../src/geometry-matrix.mjs';

const taskId = 'task_11111111-1111-4111-8111-111111111111';
const row = (id, min, max, extra = {}) => ({ entity_path: `pid:${id}`, parent_entity_path: null, reference: `root-${id}`, persistent_id: String(id),
  entity_type: 'component_instance', entity_definition_name: 'shared-definition', editable: true, visible: true, locked: false,
  bounding_box: { min, max }, world_transform: identityMatrix(), ...extra });
const adoption = () => ({ kind: 'adopt_open_model', runtime: 'queue', document_id: 'native-shaped-fixture', recursive_truncated: false,
  model_revision: 'sha256:' + 'a'.repeat(64), model_revision_complete: true, model_revision_total_seen: 2, model_revision_indexed: 2,
  recursive_index: [row(1, [20, 40, 10], [120, 90, 40]), row(2, [400, 500, 100], [600, 700, 200])] });
const base = { version: 1, targets: [{ entity_path: 'pid:1' }], axis: 'x' };
const plan = (edit, source = adoption()) => planLayoutEdit({ taskId, layoutEdit: { ...base, ...edit }, adoption: source });
const array = plan({ mode: 'array', count: 4, spacing_mm: -150 });
assert.deepEqual(array.operations.map(op => op.translate), [[-150, 0, 0], [-300, 0, 0], [-450, 0, 0]]);
assert.equal(new Set(array.operations.map(op => op.new_id)).size, 3);
assert.deepEqual(array, plan({ mode: 'array', count: 4, spacing_mm: -150 }), 'same task/input/source has stable identities and plan hash');
assert.equal(array.summary.original_preserved, true);
assert.equal(array.summary.affected_instance_count, 4, 'budget includes the source and every new copy');
await assert.rejects(() => prepareLayoutEdit({ taskId, layoutEdit: { ...base, mode: 'array', count: 4, spacing_mm: 10 }, runtime: 'queue',
  bridge: { adopt_open_model: async () => adoption(), executionPolicy: { resource_limits: { max_affected_instances: 3 } } } }), error => error.code === 'POLICY_DENIED');
for (const [anchor, expected] of [['min', 480], ['center', 430], ['max', 380]]) {
  const aligned = plan({ mode: 'align', anchor, reference: { target: { entity_path: 'pid:2' }, anchor: 'center' } });
  assert.equal(aligned.operations[0].translate[0], expected);
  assert.equal(aligned.targets.length, 2, 'fixed reference is also bound to review');
  assert.equal(aligned.operations.some(op => op.entity_path === 'pid:2'), false);
}
const rotated = adoption();
rotated.recursive_index[0].world_transform = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 20, 2, 1];
const mirrored = plan({ mode: 'mirror_copy', plane_offset_mm: 500 }, rotated);
const matrix = mirrored.operations[0].transform.matrix;
assert.deepEqual(transformPoint(matrix, [30, 40, 0]), [786, 538, 50.8], 'reflect full rotated transform and convert native inch translation to mm');
assert.equal(mirrored.operations[0].definition, 'shared-definition');
assert.equal(mirrored.summary.parameter_lineage_copied, false);
assert.equal(mirrored.operations.some(op => op.op === 'transform_object'), false, 'mirror-copy never transforms the original');
const nativeEmptyInstanceSet = adoption();
nativeEmptyInstanceSet.recursive_index[0].attributes = { SU_InstanceSet: { Owner: '', Status: '' } };
assert.equal(plan({ mode: 'mirror_copy', plane_offset_mm: 0 }, nativeEmptyInstanceSet).operations[0].op, 'component_instance', 'Plain native instances include the exact empty SketchUp system dictionary');
for (const attributes of [{ SU_InstanceSet: { Owner: 'user', Status: '' } }, { SU_InstanceSet: { Owner: '', Status: 'approved' } },
  { SU_InstanceSet: { Owner: '', Status: '', Unknown: '' } }, { SU_InstanceSet: { Owner: '', Status: null } },
  { SU_InstanceSet: { Owner: '' } }, { SU_InstanceSet: {} }, { SU_InstanceSet: [] }, { SU_InstanceSet: null },
  { SU_InstanceSet: { Owner: '', Status: '' }, UnknownDictionary: {} }]) {
  const source = adoption(); source.recursive_index[0].attributes = attributes;
  assert.throws(() => plan({ mode: 'mirror_copy', plane_offset_mm: 0 }, source), error => error.code === 'OPERATION_NOT_ALLOWED');
}

for (const edit of [
  { mode: 'array', count: 1, spacing_mm: 10 }, { mode: 'array', count: 3, spacing_mm: 0 },
  { mode: 'array', count: 102, spacing_mm: 10 }, { mode: 'array', count: 3, spacing_mm: Infinity },
  { mode: 'array', count: 3, spacing_mm: 10, axis: 'local_x' }, { mode: 'array', count: 3, spacing_mm: 10, approved: true },
  { mode: 'mirror_copy', plane_offset_mm: 0, keep_original: false },
  { mode: 'align', anchor: 'origin', reference: { target: { entity_path: 'pid:2' }, anchor: 'min' } },
  { mode: 'align', anchor: 'min', reference: { target: { entity_path: 'pid:1' }, anchor: 'min' } },
  { mode: 'array', count: 3, spacing_mm: 10, targets: [{ entity_path: 'pid:1' }, { target_id: 'root-1' }] }
]) assert.throws(() => plan(edit), error => error.code === 'INVALID_ARGUMENT');
for (const mutate of [
  a => { a.recursive_truncated = true; }, a => { a.model_revision_complete = false; },
  a => { a.recursive_index[0].locked = true; }, a => { a.recursive_index[0].effective_locked = true; },
  a => { a.recursive_index[0].parent_entity_path = 'pid:9'; }, a => { a.recursive_index[0].editable = false; },
  a => { a.recursive_index[0].bounding_box.min[0] = NaN; }, a => { a.recursive_index.push(structuredClone(a.recursive_index[0])); }
]) {
  const source = adoption(); mutate(source);
  assert.throws(() => plan({ mode: 'array', count: 2, spacing_mm: 10 }, source), error => ['MODEL_REVISION_INCOMPLETE', 'OPERATION_NOT_ALLOWED'].includes(error.code));
}
for (const overrides of [{ entity_type: 'group' }, { material: 'override' }, { tag: 'custom-tag' }, { visible: false },
  { attributes: { UserData: { value: 1 } } }, { world_transform: new Array(16).fill(0) }]) {
  const source = adoption(); Object.assign(source.recursive_index[0], overrides);
  assert.throws(() => plan({ mode: 'mirror_copy', plane_offset_mm: 0 }, source), error => error.code === 'OPERATION_NOT_ALLOWED');
}
const collision = adoption(); collision.recursive_index[1].name = array.operations[0].new_id;
assert.throws(() => plan({ mode: 'array', count: 4, spacing_mm: -150 }, collision), error => error.code === 'OPERATION_NOT_ALLOWED');
assert.throws(() => validateLayoutEdit({ ...base, mode: 'array', count: 101, spacing_mm: 10, targets: [{ entity_path: 'pid:1' }, { entity_path: 'pid:2' }] }), error => error.code === 'INVALID_ARGUMENT');

// Public Gateway -> server adoption -> frozen plan -> trusted fixture approval
// -> existing reviewed execution. This is mock evidence, never live acceptance.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'layout-edit-'));
try {
  const options = { mock: { sessionPath: path.join(root, 'model.json') }, agentContract: { rootDir: path.join(root, 'tasks') },
    approval: { stateDir: path.join(root, 'approvals') }, executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] } };
  const bridge = new SketchUpBridge(options);
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'component_definition', name: 'Asymmetric', size: [100, 50, 30] },
    { op: 'component_instance', id: 'selected', name: 'Selected', definition: 'Asymmetric', origin: [200, 100, 0], transform: { rotateZ: 45 } },
    { op: 'component_instance', id: 'peer', name: 'Peer', definition: 'Asymmetric', origin: [2000, 0, 0] },
    { op: 'box', id: 'fixed', name: 'Fixed', origin: [1000, 500, 100], size: [200, 150, 50] }
  ] }) });
  const read = () => bridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true });
  const start = (key, layout_edit, extra = {}) => bridge.start_agent_task({ intent: 'reviewed_existing_model_edit', instruction: 'Review the explicit layout change; preserve original peers.',
    idempotency_key: key, inputs: { runtime: 'mock', save_model: false, layout_edit, ...extra } });
  const current = await read(), selected = current.entities.find(e => e.reference === 'selected'), peer = current.entities.find(e => e.reference === 'peer');
  const peerBefore = structuredClone(peer);
  const approveOnly = async result => {
    const stored = await bridge.taskStore.getTask(result.task_id, { includePrivate: true });
    await bridge.approvalAuthority.recordTrustedDecision(stored.result.approval_challenge,
      { decision: 'approved', user_id: 'layout-fixture-user', channel: 'test-only-trusted-user-fixture', confirmed: true });
  };
  const applyApproved = result => bridge.submit_agent_task_input({ task_id: result.task_id, idempotency_key: `${result.task_id}-apply`, input: { note: 'Approved by trusted mock fixture.' } });
  const fixtureApprove = async result => { await approveOnly(result); return applyApproved(result); };
  const cases = [
    { mode: 'array', targets: [{ target_id: 'selected' }], axis: 'x', count: 3, spacing_mm: 300 },
    { mode: 'align', targets: [{ target_id: 'selected' }], axis: 'y', anchor: 'center', reference: { target: { target_id: 'fixed' }, anchor: 'min' } },
    { mode: 'mirror_copy', targets: [{ target_id: 'selected' }], axis: 'x', plane_offset_mm: 700 }
  ];
  const limited = new SketchUpBridge({ ...options, executionPolicy: { ...options.executionPolicy,
    development_model_auto_approval: { enabled: true, authorization_ref: 'human-instruction:layout-test-fixture',
      allowed_model_keys: [modelKeyForIdentity(modelIdentityForAdoption(current))], allowed_risks: ['S1', 'S2'], max_affected_instances: 1 } } });
  for (const edit of [cases[0], cases[2]]) {
    const result = await limited.start_agent_task({ intent: 'reviewed_existing_model_edit', instruction: 'Check the bounded development approval scope.',
      idempotency_key: `limited-auto-${edit.mode}`, inputs: { runtime: 'mock', save_model: false, layout_edit: { version: 1, ...edit } } });
    assert.equal(result.task_state, 'awaiting_review', JSON.stringify(result));
    const reviewed = (await limited.taskStore.getTask(result.task_id, { includePrivate: true })).private.existing_edit_plan;
    assert.equal(reviewed.affected_instance_count, edit.mode === 'array' ? 3 : 2);
    assert.equal(reviewed.development_model_auto_approval, undefined, 'new copies cannot bypass development approval limits');
    assert.equal(modelRevisionForAdoption(await read()), modelRevisionForAdoption(current));
  }
  for (const [index, edit] of cases.entries()) {
    const beforeRevision = modelRevisionForAdoption(await read());
    const budgetDenied = await start(`layout-budget-${index}`, { version: 1, ...edit }, { budgets: { max_affected_instances: 1 } });
    assert.equal(budgetDenied.ok, false, 'new copies and the fixed reference must fit the caller budget');
    assert.equal(budgetDenied.error.code, 'POLICY_DENIED', JSON.stringify(budgetDenied));
    assert.equal(modelRevisionForAdoption(await read()), beforeRevision);
  }
  for (const [index, edit] of cases.entries()) {
    const before = await read(), beforeRevision = modelRevisionForAdoption(before), started = await start(`layout-${index}`, { version: 1, ...edit });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.task_state, 'awaiting_review', JSON.stringify(started));
    const stored = await bridge.taskStore.getTask(started.task_id, { includePrivate: true });
    assert.equal(stored.private.layout_edit_plan.binding.model_revision, beforeRevision);
    assert.equal(modelRevisionForAdoption(await read()), beforeRevision, 'preparation is read-only');
    const submittedChange = await bridge.submit_agent_task_input({ task_id: started.task_id, idempotency_key: `change-${index}`, input: { layout_edit: { version: 1, ...edit, axis: 'z' } } });
    assert.equal(submittedChange.ok, false, 'frozen layout source cannot change');
    await approveOnly(started);
    for (const input of [{ layout_edit: { version: 1, ...edit, axis: 'z' } }, { targets: [{ target_id: 'peer' }] },
      { operations: [{ op: 'delete', target_id: 'peer' }] }, { runtime: 'queue' }, { save_model: true }]) {
      const tampered = await bridge.submit_agent_task_input({ task_id: started.task_id, idempotency_key: `approved-tamper-${index}-${Object.keys(input)[0]}`, input });
      assert.equal(tampered.ok, false);
      assert.equal(tampered.error.code, 'INVALID_ARGUMENT');
      assert.equal(modelRevisionForAdoption(await read()), beforeRevision, 'approved source tampering must fail before writes or approval consumption');
    }
    const applied = await applyApproved(started);
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.task_state, 'completed', JSON.stringify(applied));
    const after = await read(), revision = modelRevisionForAdoption(after);
    assert.deepEqual(after.entities.find(e => e.reference === 'peer'), peerBefore, 'unselected shared instance stays unchanged');
    if (edit.mode === 'array') {
      const copies = stored.private.layout_edit_plan.summary.effects.map(e => after.entities.find(row => row.reference === e.new_id));
      copies.forEach((copy, i) => assert.ok(Math.abs(copy.bounding_box.min[0] - selected.bounding_box.min[0] - (i + 1) * 300) < 1e-8));
      assert.deepEqual(after.entities.find(e => e.reference === 'selected'), selected);
      cases.push({ mode: 'mirror_copy', targets: [{ target_id: stored.private.layout_edit_plan.summary.effects[0].new_id }], axis: 'y', plane_offset_mm: 300 });
    } else if (edit.mode === 'align') {
      const moved = after.entities.find(e => e.reference === 'selected');
      assert.ok(Math.abs((moved.bounding_box.min[1] + moved.bounding_box.max[1]) / 2 - 500) < 1e-8, 'rotated-world bbox center aligns to fixed native min');
      assert.deepEqual(after.entities.find(e => e.reference === 'fixed'), before.entities.find(e => e.reference === 'fixed'));
    } else {
      const source = before.entities.find(e => e.reference === edit.targets[0].target_id);
      const copy = after.entities.find(e => e.reference === stored.private.layout_edit_plan.summary.effects[0].new_id);
      const axis = ['x', 'y', 'z'].indexOf(edit.axis);
      assert.ok(Math.abs(copy.bounding_box.min[axis] - (2 * edit.plane_offset_mm - source.bounding_box.max[axis])) < 1e-8);
      for (let other = 0; other < 3; other++) if (other !== axis) assert.ok(Math.abs(copy.bounding_box.min[other] - source.bounding_box.min[other]) < 1e-8, `array/align continuation keeps every other world coordinate: case=${index}, axis=${other}, copied=${copy.bounding_box.min[other]}, expected=${source.bounding_box.min[other]}`);
      assert.deepEqual(after.entities.find(e => e.reference === edit.targets[0].target_id), source);
    }
    const replay = await bridge.submit_agent_task_input({ task_id: started.task_id, idempotency_key: `${started.task_id}-apply`, input: { note: 'Approved by trusted mock fixture.' } });
    assert.equal(replay.idempotent_replay, true);
    assert.equal(modelRevisionForAdoption(await read()), revision);
    await bridge.resume_agent_task({ task_id: started.task_id });
    assert.equal(modelRevisionForAdoption(await read()), revision);
  }
  const groupBefore = (await read()).entities.find(entry => entry.reference === 'fixed');
  const groupArray = await start('layout-root-group-array', { version: 1, mode: 'array', targets: [{ target_id: 'fixed' }], axis: 'z', count: 2, spacing_mm: 100 });
  assert.equal(groupArray.task_state, 'awaiting_review');
  const groupCopyId = (await bridge.taskStore.getTask(groupArray.task_id, { includePrivate: true })).private.layout_edit_plan.summary.effects[0].new_id;
  assert.equal((await fixtureApprove(groupArray)).task_state, 'completed');
  let groupAfter = await read(), groupCopy = groupAfter.entities.find(entry => entry.reference === groupCopyId);
  assert.equal(groupCopy.entity_type, 'group');
  assert.equal(groupCopy.bounding_box.min[2], groupBefore.bounding_box.min[2] + 100);
  const groupAlign = await start('layout-root-group-align', { version: 1, mode: 'align', targets: [{ target_id: groupCopyId }], axis: 'x', anchor: 'min', reference: { target: { target_id: 'fixed' }, anchor: 'max' } });
  assert.equal((await fixtureApprove(groupAlign)).task_state, 'completed');
  groupAfter = await read(); groupCopy = groupAfter.entities.find(entry => entry.reference === groupCopyId);
  assert.equal(groupCopy.bounding_box.min[0], groupBefore.bounding_box.max[0]);
  assert.deepEqual(groupAfter.entities.find(entry => entry.reference === 'fixed'), groupBefore);
  const stale = await start('layout-stale', { version: 1, ...cases[0] });
  assert.equal(stale.task_state, 'awaiting_review');
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', id: 'external-change', name: 'External Change', origin: [3000, 0, 0], size: [10, 10, 10] }] }) });
  const changedRevision = modelRevisionForAdoption(await read());
  const rejected = await fixtureApprove(stale);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'MODEL_REVISION_MISMATCH', JSON.stringify(rejected));
  assert.equal(modelRevisionForAdoption(await read()), changedRevision);
  for (const extra of [{ operations: [{ op: 'delete', target_id: 'peer' }] }, { targets: [{ target_id: 'peer' }] }, { snapshot: {} }, { asset_edit: {} }]) {
    const rejected = await start(`mixed-${Object.keys(extra)[0]}`, { version: 1, ...cases[0] }, extra);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'INVALID_ARGUMENT');
  }
  // Legacy mock sessions changed geometry but recorded only object_transform,
  // leaving the canonical transform stale and carrying no completeness flag.
  const legacyModel = JSON.parse(await fs.readFile(options.mock.sessionPath, 'utf8'));
  const legacyPeer = legacyModel.instances.find(item => item.id === 'peer');
  delete legacyPeer._placement_complete;
  legacyPeer.transform.object_transform = { translate: [50, 0, 0] };
  for (const edge of ['min', 'max']) legacyPeer.bounding_box[edge][0] += 50;
  legacyPeer._vertices = legacyPeer._vertices.map(point => [point[0] + 50, point[1], point[2]]);
  await fs.writeFile(options.mock.sessionPath, JSON.stringify(legacyModel));
  const mirrorLegacy = { version: 1, mode: 'mirror_copy', targets: [{ target_id: 'peer' }], axis: 'x', plane_offset_mm: 700 };
  assert.equal((await start('legacy-placement-direct', mirrorLegacy)).error.code, 'OPERATION_NOT_ALLOWED');
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'transform_object', target_id: 'peer', translate: [10, 0, 0] }] }) });
  assert.equal((await read()).entities.find(e => e.reference === 'peer').placement_complete, false, 'new translation cannot certify legacy stale placement');
  assert.equal((await start('legacy-placement-after-translation', mirrorLegacy)).error.code, 'OPERATION_NOT_ALLOWED');
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'transform_object', target_id: 'selected', rotateZ: 30 }] }) });
  assert.equal((await read()).entities.find(e => e.reference === 'selected').placement_complete, false);
  const incomplete = await start('layout-incomplete-placement', { version: 1, ...cases[2] });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.error.code, 'OPERATION_NOT_ALLOWED');
  console.log('Layout planning and Gateway mock approval/execution passed: world arrays, rotated-bbox align, mirrored copies, protected peers, stable IDs, replay, stale revision and unsupported target/input rejection.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
