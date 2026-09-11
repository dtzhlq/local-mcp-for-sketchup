import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SketchUpBridge } from '../src/bridge.mjs';
import { prepareHostCommonCreation } from '../src/model-accessibility-host-provisioning.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parameter-batched-four-cabinets-'));
const config = { mock: { sessionPath: path.join(root, 'model.json') }, agentContract: { rootDir: path.join(root, 'tasks') },
  approval: { stateDir: path.join(root, 'approval'), secret: 'offline-only-batched-parameter-test-key-32-bytes' } };
const source = (id, ids, y = 0) => ({ version: 1, kind: 'cabinet', id, units: 'mm', parameters: { width_mm: 600, height_mm: 900, depth_mm: 600 },
  instances: ids.map((name, i) => ({ id: name, origin_mm: [i * 1600, y, 0] })) });
let checks = 0;
const check = fn => { fn(); checks++; };
try {
  const bridge = new SketchUpBridge(config), runtime = bridge.selectRuntime('mock');
  const d = await bridge.start_agent_task({ intent: 'create_model', instruction: 'Create independent D first.', idempotency_key: 'D', inputs: { runtime: 'mock', task: source('independent', ['D'], 4000) } });
  const dTask = await bridge.taskStore.getTask(d.task_id, { includePrivate: true });
  check(() => assert.equal(dTask.private.creation.parameter_edit_support.baseline_captured, true));
  const options = prepareHostCommonCreation({ instruction: 'Author shared A/B/C and the preservation marker before the model test.', idempotency_key: 'ABC',
    inputs: { runtime: 'mock', recursive_limit: 5000, task: source('shared', ['A', 'B', 'C']) },
    metadata: [{ root_id: 'B', dictionary: 'BenchmarkManualEdit', attributes: { preserve: true, note: 'authored-before-test' }, tag: 'preserve-manual' }] });
  const started = await bridge.agentGateway.start(options);
  let task = await bridge.taskStore.getTask(started.task_id, { includePrivate: true });
  check(() => assert.equal(started.error, null, JSON.stringify(started.error)));
  check(() => assert.equal(task.private.creation.parameter_edit_support.baseline_captured, true, JSON.stringify(task.private.creation.parameter_edit_support)));
  check(() => assert.equal(task.private.creation.parameter_source.entries.length, 3));
  const initial = await runtime.readModel(), mapping = task.private.creation.identity_map;
  const dId = dTask.private.creation.identity_map.D;
  const initialD = initial.instances.find(i => i.id === dId), definitionD = initial.component_definitions[initialD.definition];
  check(() => assert.notEqual(initialD.definition, initial.instances.find(i => i.id === mapping.A).definition));
  const global = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 10000, read_only: true });
  check(() => assert.equal(global.recursive_truncated, true));
  const indexed = await bridge.start_agent_task({ intent: 'discover', instruction: 'Find B source without an oracle.', inputs: { topic: 'parameter_sources', runtime: 'mock', query: 'B' } });
  check(() => assert.equal(indexed.result.sources[0].creation_task_id, started.task_id));
  const counts = { stage: 0, replace: 0 }, build = runtime.buildModel.bind(runtime);
  runtime.buildModel = async code => { const ops = JSON.parse(code).operations; if (ops.every(op => op.op === 'component_definition')) counts.stage++; if (ops.some(op => op.op === 'replace_component_definition')) counts.replace++; return build(code); };
  async function edit(scope, ids, width, key) {
    const result = await bridge.start_agent_task({ intent: 'modify_design_parameters', instruction: `Explicit ${scope} width change.`, idempotency_key: key,
      inputs: { runtime: 'mock', recursive_limit: 5000, parameter_edit: { creation_task_id: started.task_id, scope, targets: ids.map(id => ({ target_id: mapping[id] })), changes: { width_mm: width } } } });
    check(() => assert.equal(result.error, null, JSON.stringify(result.error)));
    check(() => assert.equal(result.task_state, 'awaiting_review'));
    const parent = await bridge.taskStore.getTask(result.task_id, { includePrivate: true });
    const child = await bridge.taskStore.getTask(parent.private.parameter_execution.reviewed_task_id, { includePrivate: true });
    check(() => assert.equal(child.private.existing_edit_plan.budgets.recursive_limit, 5000));
    await bridge.approvalAuthority.recordTrustedDecision(child.result.approval_challenge, { decision: 'approved', user_id: 'offline-test-reviewer', channel: 'local-user-presence-test', confirmed: true });
    const applied = await bridge.submit_agent_task_input({ task_id: result.task_id, idempotency_key: `${key}-apply`, input: {} });
    check(() => assert.equal(applied.error, null, JSON.stringify(applied.error)));
    check(() => assert.equal(applied.result.geometry_applied, true));
    check(() => assert.equal(applied.result.quality_accepted, false));
    return result;
  }
  await edit('all', ['A','B','C'], 800, 'all-800');
  const all = await runtime.readModel();
  check(() => assert(['A','B','C'].every(id => all.instances.find(i => i.id === mapping[id]).bounding_box.w === 800)));
  const single = await edit('single', ['A'], 900, 'single-900');
  const final = await runtime.readModel();
  check(() => assert.equal(final.instances.find(i => i.id === mapping.A).bounding_box.w, 900));
  check(() => assert(['B','C'].every(id => final.instances.find(i => i.id === mapping[id]).bounding_box.w === 800)));
  check(() => assert.equal(final.instances.find(i => i.id === mapping.B).attributes.BenchmarkManualEdit.note, 'authored-before-test'));
  check(() => assert.deepEqual(final.instances.find(i => i.id === dId), initialD));
  check(() => assert.deepEqual(final.component_definitions[initialD.definition], definitionD));
  for (const id of ['A','B','C']) {
    const definition = final.component_definitions[final.instances.find(i => i.id === mapping[id]).definition];
    check(() => assert.equal(definition.groups.find(group => group.name === 'shared-side-left').bounding_box.w, 18));
  }
  const beforeReplay = { ...counts };
  await bridge.resume_agent_task({ task_id: single.task_id });
  await bridge.submit_agent_task_input({ task_id: single.task_id, idempotency_key: 'single-900-apply', input: {} });
  check(() => assert.deepEqual(counts, beforeReplay));
  check(() => assert.deepEqual(counts, { stage: 2, replace: 2 }));
  console.log(JSON.stringify({ checks, global_recursive_total_seen: global.recursive_total_seen, per_read_limit: 5000, unchanged_policy: true,
    actual_mock_all_then_single: true, saved_skp: false, native_runtime: false, release_acceptance: false }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
