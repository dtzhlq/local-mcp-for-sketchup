import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-detail-gateway-'));
const options = { mock: { sessionPath: path.join(root, 'model.json') }, agentContract: { rootDir: path.join(root, 'tasks') }, approval: { stateDir: path.join(root, 'approval'), secret: 'quality-test-secret-with-at-least-32-characters' }, executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] } };
const bridge = new SketchUpBridge(options);
const code = operations => JSON.stringify({ version: 1, units: 'mm', operations });
const a = { op: 'box', id: 'a', name: 'A', origin: [0, 0, 0], size: [100, 100, 100] };
const b = { ...a, id: 'b', name: 'B', origin: [50, 50, 50] };
const authorize = SketchUpBridge.prototype.withLiveMutationAuthorization;
const authorizationTimeouts = [];
SketchUpBridge.prototype.withLiveMutationAuthorization = function(options, callback) {
  if(options.operation === 'build_model')authorizationTimeouts.push(options.timeoutMs);
  return authorize.call(this,options,callback);
};
try {
  const started = await bridge.start_agent_task({ intent: 'create_model', instruction: 'Create test', idempotency_key: 'first', inputs: { code: code([a, b]), runtime: 'mock' } });
  assert.equal(started.task_state, 'awaiting_input', JSON.stringify(started));
  assert.equal(started.result.quality_accepted, false);
  assert.equal(authorizationTimeouts[0],120000,'Creation timeout must reach the outer authorization runtime, which owns the queue request');
  const replay = await bridge.start_agent_task({ intent: 'create_model', instruction: 'Create test', idempotency_key: 'first', inputs: { code: code([a, b]), runtime: 'mock' } });
  assert.equal(replay.idempotent_replay, true);
  const invalid = await bridge.submit_agent_task_input({ task_id: started.task_id, idempotency_key: 'bad-replay', input: { code: code([a, b]) } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.task_state, 'awaiting_input');
  // A separate authorized editor repairs the scene. Reverification only reads it.
  await bridge.build_model({ runtime: 'mock', code: code([{ op: 'transform_object', target_id: 'b', transform: { translate: [500, 0, -50] } }]) });
  const resumed = new SketchUpBridge(options);
  const repaired = await resumed.submit_agent_task_input({ task_id: started.task_id, idempotency_key: 'reverify', input: { reverify: true } });
  assert.equal(repaired.task_state, 'completed', JSON.stringify(repaired));
  assert.equal(repaired.result.quality_accepted, true);
  const inspection = await resumed.inspect_model({ runtime: 'mock', includeSnapshot: true });
  assert.equal(inspection.snapshot.groups.length, 2, 'reverification must not rebuild the original scene');
  const diagnostic = await resumed.start_agent_task({ intent: 'verify_model', instruction: 'Diagnose supplied invalid model', inputs: { runtime: 'mock', snapshot: { ...inspection.snapshot, warnings: [{ type: 'geometry.degenerate', severity: 'error', message: 'invalid' }] } } });
  assert.equal(diagnostic.task_state, 'completed', 'diagnostic report completion is separate from acceptance');
  assert.equal(diagnostic.result.quality_accepted, false);
  console.log('detail-quality-gateway: failed creation stays open, retry/restart do not replay, reverify and diagnostic semantics passed');
} finally {
  SketchUpBridge.prototype.withLiveMutationAuthorization = authorize;
  await fs.rm(root, { recursive: true, force: true });
}
