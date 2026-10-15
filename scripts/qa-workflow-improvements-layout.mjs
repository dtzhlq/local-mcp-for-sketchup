// Imported by an explicitly authorized native QA runner. Importing this module
// does not connect, mutate, install, save, close, reopen or operate the UI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';

const TIMEOUT_MS = 120_000;
const EPS_MM = 1e-5;
const close = (actual, expected, label) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= EPS_MM,
  `${label}: expected ${expected}, observed ${actual}`);
const rootRows = adoption => adoption.recursive_index.filter(row => row.parent_entity_path === null
  && /^pid:[1-9]\d*$/.test(row.entity_path) && ['group', 'component_instance'].includes(row.entity_type));
const exactRoot = (adoption, entityPath) => {
  const matches = rootRows(adoption).filter(row => row.entity_path === entityPath);
  assert.equal(matches.length, 1, `Expected one native root ${entityPath}`);
  return matches[0];
};
const pointWithin = (file, directory) => {
  const relative = path.relative(path.resolve(directory), path.resolve(file));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const frozenRoot = row => Object.fromEntries(['entity_path', 'persistent_id', 'reference', 'name', 'entity_type',
  'entity_definition_name', 'world_transform', 'bounding_box', 'faces', 'edges', 'vertices', 'geometry_summary',
  'material', 'tag', 'attributes', 'visible', 'locked'].map(key => [key, row[key] ?? null]));
const hashRoot = row => sha256Canonical(frozenRoot(row));
const addedRoots = (before, after) => {
  const known = new Set(rootRows(before).map(row => row.entity_path));
  return rootRows(after).filter(row => !known.has(row.entity_path));
};

// Native occurrence matrices use SketchUp inches only in the translation
// column. bounds_hash already reports root entity.bounds in world millimetres.
function worldMatrixMm(row) {
  const matrix = structuredClone(row.world_transform || row.transformation);
  assert.ok(Array.isArray(matrix) && matrix.length === 16 && matrix.every(Number.isFinite));
  for (const i of [12, 13, 14]) matrix[i] *= 25.4;
  return matrix;
}

function verifyTranslation(source, moved, delta) {
  for (const edge of ['min', 'max']) for (let axis = 0; axis < 3; axis++) {
    close(moved.bounding_box[edge][axis], source.bounding_box[edge][axis] + delta[axis], `${edge}[${axis}] mm`);
  }
  const expected = worldMatrixMm(source), actual = worldMatrixMm(moved);
  for (let axis = 0; axis < 3; axis++) expected[12 + axis] += delta[axis];
  expected.forEach((value, i) => close(actual[i], value, `world transform[${i}]`));
}

function verifyReflection(source, copy, axis, plane) {
  for (const edge of ['min', 'max']) for (let i = 0; i < 3; i++) {
    const expected = i === axis ? 2 * plane - source.bounding_box[edge === 'min' ? 'max' : 'min'][i] : source.bounding_box[edge][i];
    close(copy.bounding_box[edge][i], expected, `mirrored ${edge}[${i}] mm`);
  }
  const expected = worldMatrixMm(source), actual = worldMatrixMm(copy);
  for (const i of [axis, axis + 4, axis + 8]) expected[i] = -expected[i];
  expected[12 + axis] = 2 * plane - expected[12 + axis];
  expected.forEach((value, i) => close(actual[i], value, `mirrored world transform[${i}]`));
  assert.equal(copy.entity_definition_name, source.entity_definition_name, 'Mirror reuses source definition geometry');
}

/**
 * Run only in a caller-established saved fixture inside its configured
 * development_model_auto_approval.allowed_roots. No approvals are minted here.
 * A run marker prevents accidental re-entry after success or an uncertain write.
 * Returns {ok,...}; on failure inspect evidence/task IDs before any recovery.
 */
export async function runLayoutNativeQA({ bridge, outputDir, resumeRunId, resumeStage = 'before-layout' } = {}) {
  assert.ok(bridge?.withFreshQueueMutationAuthorization && bridge?.start_agent_task && bridge?.submit_agent_task_input,
    'Supply the caller-configured SketchUpBridge');
  assert.ok(typeof outputDir === 'string' && outputDir.trim(), 'outputDir is required');
  assert.ok(['before-layout', 'after-align'].includes(resumeStage), 'Choose an explicit supported resume stage');
  assert.ok(resumeRunId || resumeStage === 'before-layout', 'after-align requires the original resumeRunId');
  const baseDirectory = path.resolve(outputDir, 'layout-native');
  await fs.mkdir(baseDirectory, { recursive: true });
  const load = async (name, directory = baseDirectory) => JSON.parse(await fs.readFile(path.join(directory, `${name}.json`), 'utf8'));
  const runId = resumeRunId || `wf-layout-${randomUUID()}`;
  let resume = null;
  if (resumeRunId !== undefined) {
    assert.match(resumeRunId, /^wf-layout-[0-9a-f-]+$/);
    const previousDirectory = resumeStage === 'after-align' ? path.join(baseDirectory, 'resume-before-layout') : baseDirectory;
    const marker = await load('run-started'), previous = await load('result', previousDirectory);
    assert.equal(marker.run_id, resumeRunId, 'Resume must name the original fixture run');
    assert.equal(previous.run_id, resumeRunId);
    assert.equal(previous.ok, false);
    const completedNames = resumeStage === 'after-align' ? ['02-component-array', '03-component-align'] : [];
    assert.deepEqual(previous.tasks.map(item => item.name), completedNames, 'Unexpected completed task scope');
    assert.deepEqual(previous.completed_checks.map(item => item.name), completedNames);
    assert.ok(previous.completed_checks.every(item => item.replay_no_mutation === true));
    const rejectedStep = resumeStage === 'after-align' ? '04-align-then-mirror' : '02-component-array';
    const files = await fs.readdir(previousDirectory);
    assert.equal(files.some(name => /-(apply|replay)-(request|response)\.json$/.test(name)
      && (resumeStage === 'before-layout' || !/^(02-component-array|03-component-align)-/.test(name))), false, 'Uncertain execution evidence requires original-task recovery');
    const rejected = await load(`${rejectedStep}-prepare-response`, previousDirectory);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.task_state, 'awaiting_input');
    assert.equal(rejected.error?.code, resumeStage === 'after-align' ? 'OPERATION_NOT_ALLOWED' : 'POLICY_DENIED');
    if (resumeStage === 'before-layout') assert.equal(rejected.error?.details?.field, 'max_affected_instances');
    assert.match(rejected.task_id, /^task_[0-9a-f-]+$/);
    resume = { stage: resumeStage, initial: await load('00-before-fixture'), fixture: await load('01-fixture'),
      identities: await load('fixture-native-identities'), info: await load('model-info-before'), rejected_task_id: rejected.task_id,
      rejected_step: rejectedStep, previous_tasks: previous.tasks, previous_checks: previous.completed_checks };
    if (resumeStage === 'after-align') {
      resume.arrayBefore = await load('02-component-array-before', previousDirectory);
      resume.arrayAfter = await load('02-component-array-after-replay', previousDirectory);
      resume.alignBefore = await load('03-component-align-before', previousDirectory);
      resume.alignAfter = await load('03-component-align-after-replay', previousDirectory);
      assert.equal(modelRevisionForAdoption(resume.arrayAfter), previous.completed_checks[0].native_revision);
      assert.equal(modelRevisionForAdoption(resume.alignAfter), previous.completed_checks[1].native_revision);
    }
  }
  // Keep the original failed run immutable. A second pre-layout resume attempt
  // is refused even if a prior continuation stopped before any visible write.
  const directory = resume ? path.join(baseDirectory, `resume-${resumeStage}`) : baseDirectory;
  if (resume) await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'run-started.json'), JSON.stringify({ run_id: runId, started_at: new Date().toISOString(),
    resumed_from: resume ? baseDirectory : null,
    instruction: 'Do not rerun blindly; inspect saved public task IDs and resume uncertain tasks.' }, null, 2), { flag: 'wx' });
  const write = async (name, value) => { await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2)); return value; };
  const limits = bridge.executionPolicy?.resource_limits || {};
  const budgets = { max_operations: Math.min(100, limits.max_operations ?? 100),
    max_affected_instances: Math.min(200, limits.max_affected_instances ?? 200, bridge.executionPolicy?.development_model_auto_approval?.max_affected_instances ?? 200),
    recursive_limit: Math.min(5000, limits.max_recursive_entities ?? 5000) };
  const tasks = structuredClone(resume?.previous_tasks || []), checks = structuredClone(resume?.previous_checks || []);
  let fixturePath = null;
  let protectedRoots = new Map();
  const read = async name => {
    const adoption = await bridge.adopt_open_model({ runtime: 'queue', recursive: true, recursive_limit: budgets.recursive_limit, read_only: true, timeoutMs: TIMEOUT_MS });
    assert.equal(adoption.runtime, 'queue');
    assert.equal(adoption.recursive_truncated, false, 'A complete native occurrence index is required');
    assert.ok(Array.isArray(adoption.recursive_index));
    modelRevisionForAdoption(adoption);
    await write(name, adoption);
    return adoption;
  };
  const assertProtected = adoption => {
    for (const [entityPath, hash] of protectedRoots) assert.equal(hashRoot(exactRoot(adoption, entityPath)), hash, `Protected root changed: ${entityPath}`);
  };
  const call = async (name, method, args) => {
    await write(`${name}-request`, args);
    const response = await bridge[method](args);
    await write(`${name}-response`, response);
    assert.equal(response.ok, true, `${name}: ${JSON.stringify(response.error || response.next_action)}`);
    return response;
  };
  try {
    const policy = bridge.executionPolicy;
    assert.equal(policy?.allow_queue_mutation, true);
    assert.equal(policy?.allow_direct_expert_queue_mutation, true);
    assert.equal(policy?.development_model_auto_approval?.enabled, true, 'Caller must configure authorized development model scope');
    await write('capabilities', await bridge.get_capabilities({ runtime: 'queue', timeoutMs: TIMEOUT_MS }));
    const info = await write('model-info-before', await bridge.get_model_info({ runtime: 'queue', timeoutMs: TIMEOUT_MS }));
    fixturePath = info.source_path;
    assert.ok(typeof fixturePath === 'string' && path.isAbsolute(fixturePath) && path.extname(fixturePath).toLowerCase() === '.skp', 'A saved SKP fixture is required');
    assert.ok(policy.development_model_auto_approval.allowed_roots.some(root => pointWithin(fixturePath, root)), 'Active SKP must be inside the configured test directory');
    const initial = resume ? resume.initial : await read('00-before-fixture');
    protectedRoots = new Map(rootRows(initial).map(row => [row.entity_path, hashRoot(row)]));
    const ids = { definition: `${runId}-definition`, source: `${runId}-source`, peer: `${runId}-peer`, group: `${runId}-group`, fixed: `${runId}-fixed` };
    let fixture;
    if (resume) {
      assert.equal(fixturePath, resume.info.source_path, 'Resume must use the originally saved fixture');
      assert.deepEqual(resume.identities.ids, ids, 'Saved fixture identifiers must belong to the requested run');
      const checkpoint = resume.alignAfter || resume.fixture;
      resume.current = await read('resume-current');
      assert.equal(modelRevisionForAdoption(resume.current), modelRevisionForAdoption(checkpoint), 'Fixture revision changed after the rejected preparation; stop before any task submission');
      assert.equal(modelKeyForIdentity(modelIdentityForAdoption(resume.current)), modelKeyForIdentity(modelIdentityForAdoption(resume.fixture)), 'Fixture document identity changed');
      for (const row of rootRows(checkpoint)) assert.equal(hashRoot(exactRoot(resume.current, row.entity_path)), hashRoot(row), 'Saved checkpoint root changed');
      fixture = resume.fixture;
    } else {
      const operations = [
      { op: 'component_definition', name: ids.definition, size: [100, 50, 30] },
      { op: 'component_instance', id: ids.source, name: ids.source, definition: ids.definition, origin: [500, 400, 20], transform: { rotateZ: 30 } },
      { op: 'component_instance', id: ids.peer, name: ids.peer, definition: ids.definition, origin: [1200, 400, 20], transform: { rotateZ: -15 } },
      { op: 'box', id: ids.group, name: ids.group, origin: [100, 100, 0], size: [80, 50, 30] },
      { op: 'box', id: ids.fixed, name: ids.fixed, origin: [1500, 1500, 100], size: [100, 100, 50] }
    ];
    await write('fixture-request', { version: 1, units: 'mm', operations });
    await write('fixture-response', await bridge.withFreshQueueMutationAuthorization({ operation: 'build_model', timeoutMs: TIMEOUT_MS }, async live => {
      const lockedInfo = await live.get_model_info({ runtime: 'queue', timeoutMs: TIMEOUT_MS });
      assert.equal(lockedInfo.source_path, fixturePath, 'Active fixture changed before creation');
      return live.build_model({ runtime: 'queue', timeoutMs: TIMEOUT_MS, code: JSON.stringify({ version: 1, units: 'mm', operations }) });
    }));
      fixture = await read('01-fixture');
    }
    assertProtected(fixture);
    const byId = id => {
      const matches = rootRows(fixture).filter(row => row.reference === id);
      assert.equal(matches.length, 1, `Fixture ID ${id} must resolve to exactly one native root`);
      return matches[0];
    };
    const source = byId(ids.source), peer = byId(ids.peer), group = byId(ids.group), fixed = byId(ids.fixed);
    if (resume) for (const [key, row] of Object.entries({ source, peer, group, fixed })) assert.equal(row.entity_path, resume.identities[key], 'Resume native root identity mismatch');
    assert.equal(source.entity_definition_name, peer.entity_definition_name);
    assert.equal(group.entity_type, 'group');
    close(worldMatrixMm(source)[12], 500, 'Fixture native X translation converted from inches');
    close(worldMatrixMm(source)[13], 400, 'Fixture native Y translation converted from inches');
    protectedRoots.set(peer.entity_path, hashRoot(peer));
    protectedRoots.set(fixed.entity_path, hashRoot(fixed));
    if (resume) assertProtected(resume.current);
    await write('fixture-native-identities', { ids, source: source.entity_path, peer: peer.entity_path, group: group.entity_path, fixed: fixed.entity_path });

    const execute = async (name, layoutEdit) => {
      const before = await read(`${name}-before`), beforeRevision = modelRevisionForAdoption(before);
      const prepared = resume && name === resume.rejected_step
        ? await call(`${name}-prepare`, 'submit_agent_task_input', { task_id: resume.rejected_task_id,
          idempotency_key: `${runId}-${name}-${resume.stage}-resume`, input: { budgets, recursive_limit: budgets.recursive_limit } })
        : await call(`${name}-prepare`, 'start_agent_task', { intent: 'reviewed_existing_model_edit',
        instruction: 'Apply only the explicit QA root layout change; preserve the shared peer and all unrelated roots.',
        idempotency_key: `${runId}-${name}-prepare`, inputs: { runtime: 'queue', save_model: false, capture_view: false, timeout_ms: TIMEOUT_MS,
          budgets, recursive_limit: budgets.recursive_limit, layout_edit: { version: 1, ...layoutEdit } } });
      tasks.push({ name, task_id: prepared.task_id });
      await write('tasks', tasks);
      assert.equal(prepared.task_state, 'approved', 'Expected caller-scoped development authorization; do not bypass awaiting_review');
      assert.equal(prepared.data?.execution_mode || prepared.result?.execution_mode, 'development_authorized');
      const afterPrepare = await read(`${name}-prepared-readback`);
      assert.equal(modelRevisionForAdoption(afterPrepare), beforeRevision, 'Preparation must be read-only');
      const connected = await call(`${name}-connect`, 'start_agent_task', { intent: 'discover', instruction: 'Get a fresh queue connection for the already prepared QA layout task.',
        inputs: { topic: 'connect', runtime: 'queue', timeout_ms: TIMEOUT_MS } });
      assert.equal(connected.task_state, 'completed');
      const submission = { task_id: prepared.task_id, idempotency_key: `${runId}-${name}-apply`, input: { runtime: 'queue', connection_task_id: connected.task_id, note: 'Execute the existing frozen layout plan under the caller configured development policy.' } };
      const applied = await call(`${name}-apply`, 'submit_agent_task_input', submission);
      assert.equal(applied.task_state, 'completed', 'Do not start another task after pending/uncertain execution');
      const after = await read(`${name}-after`);
      assert.notEqual(modelRevisionForAdoption(after), beforeRevision, 'The nonzero layout change must alter native revision');
      assertProtected(after);
      const replay = await call(`${name}-replay`, 'submit_agent_task_input', submission);
      assert.equal(replay.idempotent_replay, true);
      const afterReplay = await read(`${name}-after-replay`);
      assert.equal(modelRevisionForAdoption(afterReplay), modelRevisionForAdoption(after), 'Duplicate submit must not write again');
      assertProtected(afterReplay);
      const added = addedRoots(before, after);
      const permittedChanged = new Set(layoutEdit.mode === 'align' ? layoutEdit.targets.map(target => target.entity_path) : []);
      for (const old of rootRows(before)) if (!permittedChanged.has(old.entity_path)) assert.equal(hashRoot(exactRoot(after, old.entity_path)), hashRoot(old), `Unselected/original root changed: ${old.entity_path}`);
      checks.push({ name, task_id: prepared.task_id, native_revision: modelRevisionForAdoption(after), new_root_count: added.length, replay_no_mutation: true });
      return { before, after, added };
    };

    const array = resume?.stage === 'after-align'
      ? { before: resume.arrayBefore, after: resume.arrayAfter, added: addedRoots(resume.arrayBefore, resume.arrayAfter) }
      : await execute('02-component-array', { mode: 'array', targets: [{ entity_path: source.entity_path }], axis: 'x', count: 3, spacing_mm: 250 });
    assert.equal(array.added.length, 2);
    const arrayCopies = array.added.sort((a, b) => a.bounding_box.min[0] - b.bounding_box.min[0]);
    arrayCopies.forEach((copy, index) => verifyTranslation(source, copy, [(index + 1) * 250, 0, 0]));
    if (resume?.stage === 'after-align') for (const copy of arrayCopies) assert.equal(hashRoot(exactRoot(resume.current, copy.entity_path)), hashRoot(copy), 'Prior array copy changed');
    const align = resume?.stage === 'after-align'
      ? { before: resume.alignBefore, after: resume.alignAfter, added: addedRoots(resume.alignBefore, resume.alignAfter) }
      : await execute('03-component-align', { mode: 'align', targets: [{ entity_path: source.entity_path }], axis: 'y', anchor: 'center', reference: { target: { entity_path: fixed.entity_path }, anchor: 'min' } });
    assert.equal(align.added.length, 0);
    const oldSource = exactRoot(align.before, source.entity_path), alignedSource = exactRoot(align.after, source.entity_path);
    const yShift = fixed.bounding_box.min[1] - (oldSource.bounding_box.min[1] + oldSource.bounding_box.max[1]) / 2;
    verifyTranslation(oldSource, alignedSource, [0, yShift, 0]);
    const mirror = await execute('04-align-then-mirror', { mode: 'mirror_copy', targets: [{ entity_path: source.entity_path }], axis: 'x', plane_offset_mm: 2000 });
    assert.equal(mirror.added.length, 1);
    verifyReflection(alignedSource, mirror.added[0], 0, 2000);
    const copiedMirror = await execute('05-array-then-mirror', { mode: 'mirror_copy', targets: [{ entity_path: arrayCopies[0].entity_path }], axis: 'y', plane_offset_mm: 800 });
    assert.equal(copiedMirror.added.length, 1);
    verifyReflection(arrayCopies[0], copiedMirror.added[0], 1, 800);
    const groupArray = await execute('06-group-array', { mode: 'array', targets: [{ entity_path: group.entity_path }], axis: 'z', count: 2, spacing_mm: 80 });
    assert.equal(groupArray.added.length, 1);
    verifyTranslation(group, groupArray.added[0], [0, 0, 80]);
    const groupAlign = await execute('07-group-align', { mode: 'align', targets: [{ entity_path: groupArray.added[0].entity_path }], axis: 'x', anchor: 'min', reference: { target: { entity_path: fixed.entity_path }, anchor: 'max' } });
    assert.equal(groupAlign.added.length, 0);
    verifyTranslation(groupArray.added[0], exactRoot(groupAlign.after, groupArray.added[0].entity_path), [fixed.bounding_box.max[0] - groupArray.added[0].bounding_box.min[0], 0, 0]);
    const result = { ok: true, kind: 'workflow_layout_native_qa', run_id: runId, evidence_dir: directory, fixture_path: fixturePath,
      checks, native_coordinates: 'root world bbox in mm; matrix translation converted from native inches', tolerance_mm: EPS_MM,
      shared_peer_preserved: true, preexisting_roots_preserved: true, completed_layout_tasks: checks.length,
      reset_performed: false, delete_performed: false, save_performed: false, close_reopen_performed: false,
      quality_accepted: false, evidence_boundary: 'Native fixture coordinate and execution checks only; no visual/collision/structural or release acceptance.' };
    return write('result', result);
  } catch (error) {
    return write('result', { ok: false, kind: 'workflow_layout_native_qa', run_id: runId, fixture_path: fixturePath, evidence_dir: directory,
      tasks, completed_checks: checks, error: { code: error.code || 'QA_ASSERTION_FAILED', message: error.message },
      next_action: 'Inspect saved evidence and original task IDs; do not rerun the fixture blindly.', close_reopen_performed: false, quality_accepted: false });
  }
}
