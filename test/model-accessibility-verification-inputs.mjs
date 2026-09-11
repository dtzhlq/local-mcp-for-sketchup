import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-verification-inputs-'));
const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(root, 'session.json') }, agentContract: { rootDir: path.join(root, 'state') },
  approval: { stateDir: path.join(root, 'approval'), secret: 'verification-input-fixture-secret-over-32-bytes' } });
let checks = 0, validations = 0;
const check = fn => { fn(); checks++; };
const validate = bridge.validate_model.bind(bridge);
bridge.validate_model = async (...args) => { validations++; return validate(...args); };
try {
  for (const snapshot of ['task_55a4168d-c737-4884-bfe1-501b9493d501', [], {}, null, 42,
    { groups: [], instances: [], totals: { faces: -1, edges: 0, groups: 0, instances: 0 }, bounding_box: { min: [0, 0, 0], max: [0, 0, 0] } }]) {
    const result = await bridge.start_agent_task({ intent: 'verify_model', instruction: 'Reject unsupported snapshot shapes.', inputs: { runtime: 'mock', snapshot } });
    check(() => assert.equal(result.error.code, 'INVALID_ARGUMENT'));
    check(() => assert.notEqual(result.task_state, 'completed'));
    check(() => assert.notEqual(result.result?.quality_status, 'pass'));
  }
  check(() => assert.equal(validations, 0));
  const unknown = await bridge.start_agent_task({ intent: 'verify_model', instruction: 'Do not silently ignore a common task.', inputs: { runtime: 'mock', task: { version: 1, kind: 'cabinet' } } });
  check(() => assert.equal(unknown.error.code, 'INVALID_ARGUMENT'));
  // Direct server-state fixture tests only the corrective route; it does not
  // stand in for the native quality acceptance required to produce this state.
  let source = (await bridge.taskStore.createTask({ intent: 'create_model', instruction: 'Accepted-source routing fixture.', executionPolicy: bridge.executionPolicy, inputs: { runtime: 'queue' } })).task;
  await bridge.taskStore.transition(source.task_id, 'understanding');
  source = await bridge.taskStore.transition(source.task_id, 'completed', { patch: { result: { quality_accepted: true, evidence_level: 'live_runtime' } } });
  const misplaced = await bridge.start_agent_task({ intent: 'verify_model', instruction: 'Verify existing accepted creation.', inputs: { runtime: 'mock', source_task_id: source.task_id, snapshot: source.task_id } });
  check(() => assert.equal(misplaced.error.code, 'INVALID_ARGUMENT'));
  check(() => assert.equal(misplaced.next_action.action, 'connect_for_delivery'));
  check(() => assert.equal(misplaced.next_action.source_task_id, source.task_id));
  check(() => assert.equal(validations, 0));
  const pending = await bridge.start_agent_task({ intent: 'verify_model', instruction: 'Recover a diagnostic input.', inputs: { runtime: 'mock' } });
  const invalidSubmit = await bridge.submit_agent_task_input({ task_id: pending.task_id, idempotency_key: 'bad-string', input: { snapshot: source.task_id } });
  check(() => assert.equal(invalidSubmit.error.code, 'INVALID_ARGUMENT'));
  check(() => assert.notEqual(invalidSubmit.task_state, 'completed'));
  const snapshot = (await bridge.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot;
  const valid = await bridge.submit_agent_task_input({ task_id: pending.task_id, idempotency_key: 'real-object', input: { snapshot } });
  check(() => assert.equal(valid.error, null, JSON.stringify(valid.error)));
  check(() => assert.equal(valid.task_state, 'completed'));
  check(() => assert.equal(valid.result.quality_accepted, false));
  check(() => assert.equal(valid.result.evidence_level, 'supplied_snapshot'));
  console.log(JSON.stringify({ ok: true, checks, runtime: 'isolated_mock_only', live_acceptance: false,
    verified: ['task_id_snapshot_rejected', 'invalid_snapshot_structure_rejected', 'unused_task_fields_rejected', 'accepted_creation_delivery_route', 'valid_diagnostic_recovery_without_quality_promotion'] }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
