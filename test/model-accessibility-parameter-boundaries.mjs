import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parameter-boundaries-'));
const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(root, 'session.json') }, agentContract: { rootDir: path.join(root, 'tasks') }, approval: { stateDir: path.join(root, 'approval'), secret: 'parameter-boundary-test-only-secret-more-than-32-bytes' } });
const task = { version: 1, kind: 'cabinet', id: 'shared', units: 'mm', parameters: { width_mm: 600, depth_mm: 600, height_mm: 900 }, instances: [{ id: 'A', origin_mm: [0, 0, 0] }, { id: 'B', origin_mm: [1600, 0, 0] }] };
let checks = 0;
const check = fn => { fn(); checks++; };
const stored = response => bridge.taskStore.getTask(response.task_id, { includePrivate: true });
try {
  const source = await bridge.start_agent_task({ intent: 'create_model', instruction: 'Create two complete shared cabinets.', idempotency_key: 'source', inputs: { runtime: 'mock', recursive_limit: 10000, task } });
  check(() => assert.equal(source.error, null, JSON.stringify(source.error)));
  const creation = await stored(source), ids = creation.private.creation.identity_map;
  check(() => assert.equal(creation.private.creation.parameter_edit_support.baseline_captured, true, JSON.stringify(creation.private.creation.parameter_edit_support)));
  const native = bridge.selectRuntime('mock'), build = native.buildModel.bind(native), counts = { staging: 0, replacement: 0 };
  native.buildModel = code => { const doc = JSON.parse(code); if (doc.operations.every(op => op.op === 'component_definition')) counts.staging++; if (doc.operations.some(op => op.op === 'replace_component_definition')) counts.replacement++; return build(code); };
  const start = (key, selected, width, scope) => bridge.start_agent_task({ intent: 'modify_design_parameters', instruction: 'Change only the named cabinet parameter scope.', idempotency_key: key,
    inputs: { runtime: 'mock', recursive_limit: 10000, parameter_edit: { creation_task_id: source.task_id, scope, targets: selected.map(id => ({ target_id: ids[id] })), changes: { width_mm: width } } } });
  async function apply(response) {
    check(() => assert.equal(response.error, null, JSON.stringify(response.error)));
    check(() => assert.equal(response.task_state, 'awaiting_review'));
    const parent = await stored(response), child = await bridge.taskStore.getTask(parent.private.parameter_execution.reviewed_task_id, { includePrivate: true });
    await bridge.approvalAuthority.recordTrustedDecision(child.result.approval_challenge, { decision: 'approved', user_id: 'offline-boundary-reviewer', channel: 'local-user-presence-test', confirmed: true });
    const completed = await bridge.submit_agent_task_input({ task_id: response.task_id, idempotency_key: 'apply-fixed-once', input: {} });
    check(() => assert.equal(completed.error, null, JSON.stringify(completed.error)));
    check(() => assert.equal(completed.task_state, 'completed'));
    return stored(completed);
  }
  const initial = await native.readModel(), originalDefinition = initial.instances[0].definition;
  const all = await apply(await start('all', ['A', 'B'], 800, 'all'));
  check(() => assert.equal(all.result.replaced_instance_count, 2));
  const afterAll = await native.readModel();
  check(() => assert.ok(afterAll.instances.every(instance => instance.bounding_box.w === 800)));
  check(() => assert.equal(new Set(afterAll.instances.map(instance => instance.definition)).size, 1));
  check(() => assert.deepEqual(afterAll.component_definitions[originalDefinition], initial.component_definitions[originalDefinition]));
  check(() => assert.equal(afterAll.component_definitions[afterAll.instances[0].definition].groups.find(group => group.name === 'shared-side-left').bounding_box.w, 18));
  await native.buildModel(JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'attribute', target_id: ids.B, dictionary: 'HumanEditFixture', attributes: { note: 'preserve my note' } },
    { op: 'tag', name: 'human-label', visible: true }, { op: 'assign_tag', target_id: ids.B, tag: 'human-label' }] }));
  const beforeSingle = await native.readModel(), beforeB = beforeSingle.instances.find(instance => instance.id === ids.B);
  const rejected = await start('manual-B', ['B'], 1000, 'single'), rejectedTask = await stored(rejected);
  check(() => assert.equal(rejectedTask.result.stage, 'blocked_before_staging'));
  check(() => assert.deepEqual(rejectedTask.result.blockers, ['manual_or_external_divergence_requires_reconciliation']));
  check(() => assert.deepEqual(counts, { staging: 1, replacement: 1 }));
  const single = await apply(await start('single-A', ['A'], 900, 'single'));
  check(() => assert.equal(single.result.replaced_instance_count, 1));
  const final = await native.readModel();
  check(() => assert.equal(final.instances.find(instance => instance.id === ids.A).bounding_box.w, 900));
  check(() => assert.deepEqual(final.instances.find(instance => instance.id === ids.B), beforeB));
  check(() => assert.deepEqual(final.component_definitions[beforeB.definition], beforeSingle.component_definitions[beforeB.definition]));
  check(() => assert.deepEqual(counts, { staging: 2, replacement: 2 }));
  const updated = await bridge.taskStore.getTask(source.task_id, { includePrivate: true });
  check(() => assert.equal(updated.private.creation.parameter_source.entries.find(entry => entry.logical_instance_id === 'A').source.task.parameters.width_mm, 900));
  check(() => assert.equal(updated.private.creation.parameter_source.entries.find(entry => entry.logical_instance_id === 'B').source.task.parameters.width_mm, 800));
  check(() => assert.equal(updated.private.creation.frozen_spec.hash, creation.private.creation.frozen_spec.hash));
  console.log(JSON.stringify({ ok: true, checks, runtime: 'isolated_mock_only', live_acceptance: false, production_policy_unchanged: true, shared_pair_within_default_10000_limit: true, single_all_gateway_applied: true, manual_selected_blocked: true, manual_peer_preserved: true, board_thickness_mm: 18 }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
