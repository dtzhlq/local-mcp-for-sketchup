import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { getModelAccessibilityTaskCatalog } from '../src/model-accessibility-tasks.mjs';
import { TOOL_REGISTRY, AGENT_GATEWAY_TOOL_NAMES } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-accessibility-gateway-'));
const options = { mock: { sessionPath: path.join(root, 'model.json') }, agentContract: { rootDir: path.join(root, 'tasks') }, approval: { stateDir: path.join(root, 'approval'), secret: 'accessibility-test-only-secret-over-32-bytes' } };
let bridge = new SketchUpBridge(options);
const validator = new ToolInputValidator(TOOL_REGISTRY);
async function call(name, args) {
  validator.validate(name, args);
  const response = await bridge[name](args);
  assert.ok(JSON.stringify(response).length <= 4096, 'Weak-context response must fit 4096 characters');
  return response;
}
async function completeResult(response) {
  const handle = response.presentation?.full_result_artifact;
  if (!handle) return response.result;
  let offset = 0, content = '';
  for (let page = 0; page < 100; page++) {
    const read = await call('read_agent_artifact', { handle, task_id: response.task_id, offset, max_chars: 1500 });
    content += read.result.artifact.content;
    if (read.result.artifact.eof) return JSON.parse(content).result;
    offset = read.result.artifact.next_offset;
  }
  throw new Error('Artifact pagination failed to finish');
}
try {
  assert.equal(AGENT_GATEWAY_TOOL_NAMES.length, 4);
  const start = await call('start_agent_task', { intent: 'discover', instruction: 'Start modeling.' });
  assert.equal(start.task_state, 'completed');
  assert.equal(start.result.current_model, 'not_checked');
  validator.validate(start.next_action.tool, start.next_action.arguments);
  const catalog = await call(start.next_action.tool, start.next_action.arguments);
  assert.ok(catalog.result.task_kinds.includes('window'));
  const details = await call('start_agent_task', { intent: 'discover', instruction: 'Window example.', inputs: { topic: 'tasks', kind: 'window', detail: 'examples' } });
  assert.equal(details.result.task_input.kind, 'window', 'The runnable example must be inline in short context, without artifact pagination');
  assert.match(details.result.fixed_design, /Two shared sash/);
  assert.equal(details.presentation.full_result_artifact, null, 'The selected example must not require a long projected document');
  const sample = getModelAccessibilityTaskCatalog({ task: 'window', detail: 'examples' }).tasks[0].examples.minimal.arguments;
  assert.deepEqual(details.result.task_input, sample.inputs.task);
  validator.validate('start_agent_task', sample);
  assert.deepEqual(sample.inputs.task, getModelAccessibilityTaskCatalog({ task: 'window', detail: 'examples' }).tasks[0].examples.minimal.arguments.inputs.task);
  let writes = 0;
  const build = bridge.build_model.bind(bridge);
  bridge.build_model = (...args) => { writes++; return build(...args); };
  const bad = structuredClone(sample); delete bad.inputs.task.parameters.width_mm;
  const missing = await call('start_agent_task', { ...bad, idempotency_key: 'missing-dimension' });
  assert.equal(missing.ok, false);
  assert.equal(missing.task_state, 'awaiting_input');
  assert.match(JSON.stringify(missing.error), /width_mm/);
  assert.equal(writes, 0);
  const preflight = await call('start_agent_task', { ...sample, intent: 'preflight_model', idempotency_key: 'preflight' });
  assert.equal(preflight.result.status.quality_status, 'not_evaluated');
  assert.equal(preflight.result.status.evidence_level, 'preflight_only');
  assert.equal(writes, 0);
  const empty = await call('start_agent_task', { intent: 'create_model', instruction: 'Wait for dimensions.', inputs: { runtime: 'mock' } });
  const noKey = await call('submit_agent_task_input', { task_id: empty.task_id, input: { task: sample.inputs.task } });
  assert.equal(noKey.error.code, 'INVALID_ARGUMENT');
  assert.match(noKey.error.message, /idempotency_key/);
  const mixed = await call('start_agent_task', { ...sample, idempotency_key: 'mixed-input', inputs: { ...sample.inputs, code: '{}' } });
  assert.equal(mixed.error.code, 'INVALID_ARGUMENT');
  const mixedFixed = await call('submit_agent_task_input', { task_id: mixed.task_id, idempotency_key: 'fixed-mixed', input: { task: { ...sample.inputs.task, id: 'mixed-recovered-window', placement: { origin_mm: [5000, 0, 0] } } } });
  assert.equal(mixedFixed.error, null);
  assert.equal(mixedFixed.task_id, mixed.task_id);
  const created = await call('submit_agent_task_input', { task_id: missing.task_id, idempotency_key: 'corrected-dimension', input: { task: sample.inputs.task } });
  assert.equal(created.error, null);
  assert.equal(created.task_state, 'awaiting_input', 'Mock geometry never meets native close-view requirements');
  assert.equal(created.result.quality_accepted, false);
  const snapshot = await bridge.inspect_model({ runtime: 'mock', includeSnapshot: true });
  const altered = structuredClone(sample.inputs.task); altered.parameters.width_mm = 1800;
  const frozen = await call('submit_agent_task_input', { task_id: created.task_id, idempotency_key: 'try-recompile', input: { task: altered } });
  assert.equal(frozen.ok, false);
  assert.match(frozen.error.message, /frozen/);
  const now = await bridge.inspect_model({ runtime: 'mock', includeSnapshot: true });
  assert.deepEqual(now.snapshot, snapshot.snapshot, 'Frozen input cannot recreate or change objects');
  bridge = new SketchUpBridge(options);
  const replay = await call('submit_agent_task_input', { task_id: missing.task_id, idempotency_key: 'corrected-dimension', input: { task: sample.inputs.task } });
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.task_id, created.task_id);
  const resumed = await call('resume_agent_task', { task_id: created.task_id });
  assert.equal(resumed.task_state, 'awaiting_input');
  assert.equal(resumed.result.status.resume.arguments.task_id, created.task_id);
  await assert.rejects(call('start_agent_task', { ...sample, idempotency_key: undefined }), /idempotency_key/);
  const blocked = await call('start_agent_task', { intent: 'discover', instruction: 'Connect.', inputs: { topic: 'connect', runtime: 'queue' } });
  assert.equal(blocked.error.code, 'POLICY_DENIED');
  assert.equal(blocked.result.status.recovery_class, 'runtime_blocked');
  console.log('model-accessibility-gateway: four-tool discovery, bounded artifact recovery, preflight without writes, correction, frozen inputs, restart replay and runtime-policy boundary passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
