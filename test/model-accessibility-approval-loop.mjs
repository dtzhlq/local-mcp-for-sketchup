import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { ApprovalAuthority } from '../src/approval-tokens.mjs';
import { AgentContractError } from '../src/agent-contract.mjs';
import { defaultStateDir } from '../src/paths.mjs';
import { TOOL_REGISTRY, AGENT_GATEWAY_TOOL_NAMES } from '../src/tool-registry.mjs';
import { createGatewayAdapter, gatewayHostOptions } from '../scripts/model-accessibility/gateway-adapter.mjs';
import { runModelLoop } from '../scripts/model-accessibility/agent-loop.mjs';

// Isolated filesystem/readiness/provider fixtures only. No Alma, live queue,
// local-host login/decision, approval issuer or native mutation is called.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-loop-'));
const taskId = 'task_11111111-1111-4111-8111-111111111111';
const connectionId = 'task_22222222-2222-4222-8222-222222222222';
const challengeId = 'approval_33333333-3333-4333-8333-333333333333';
const approved = { task_id: taskId, status: 'approved', approval_status: 'approved_pending_execution', challenge_id: challengeId, decision_id: 'decision-fixture' };
const waiting = { ok: true, task_id: taskId, task_state: 'awaiting_review', next_action: { action: 'request_user_approval', approval_host: { challenge_id: challengeId, url: `http://127.0.0.1:3978/approvals/${challengeId}`, user_presence_required: true } }, result: { quality_accepted: false } };
const definitions = TOOL_REGISTRY.filter(item => AGENT_GATEWAY_TOOL_NAMES.includes(item.name));
const limits = { max_provider_requests: 5, max_tool_calls: 4, max_total_tokens: 1000, max_output_tokens_per_request: 100, max_wall_seconds: 5, approval_wait_seconds: 1 };
const task = { id: 'isolated-approval-loop', prompt: 'Prepare the explicit appearance change, preserving other objects.' };
const response = content => ({ model: 'FIXTURE_ONLY', content, usage: { input_tokens: 10, output_tokens: 10 }, stop_reason: content.some(value => value.type === 'tool_use') ? 'tool_use' : 'end_turn' });
const tool = (id, name, input) => response([{ type: 'tool_use', id, name, input }]);
const firstInput = { intent: 'apply_native_appearance', instruction: task.prompt, idempotency_key: 'model-chosen-stable-appearance-key', inputs: { runtime: 'queue', appearance: { kind: 'native_pbr', target: 'actual-root-fixture', preset: 'wood', texture_size_mm: [750, 750], rotation: 30 } } };
try {
  const liveOptions = gatewayHostOptions({ stateRoot: path.join(dir, 'default'), runtime: 'queue' }, {});
  assert.equal(liveOptions.bridgeOptions.approval.stateDir, path.join(defaultStateDir, 'agent-contract-v1', 'approvals'));
  const configured = gatewayHostOptions({}, { MODEL_ACCESSIBILITY_STATE_ROOT: path.join(dir, 'env'), MODEL_ACCESSIBILITY_RUNTIME: 'queue', MODEL_ACCESSIBILITY_APPROVAL_STATE_DIR: path.join(dir, 'shared-host'), MODEL_ACCESSIBILITY_APPROVAL_HOST_URL: 'http://127.0.0.1:3980' });
  assert.equal(configured.bridgeOptions.approval.stateDir, path.join(dir, 'shared-host'));
  assert.equal(configured.bridgeOptions.approval.approvalHostUrl, 'http://127.0.0.1:3980');
  assert.equal(configured.bridgeOptions.executionPolicy.allow_direct_expert_queue_mutation, false);
  assert.deepEqual(configured.bridgeOptions.executionPolicy.auto_approve_risks, []);
  assert.equal(gatewayHostOptions({ stateRoot: path.join(dir, 'mock'), runtime: 'mock' }, {}).bridgeOptions.approval.stateDir, path.join(dir, 'mock', 'approval'));
  assert.throws(() => gatewayHostOptions({ stateRoot: path.join(dir, 'mock'), runtime: 'mock', approvalStateDir: path.join(dir, 'shared-host') }, {}), /cannot share/);
  assert.throws(() => gatewayHostOptions({ stateRoot: path.join(dir, 'run'), runtime: 'queue', approvalStateDir: 'relative' }, {}), /absolute/);
  assert.throws(() => gatewayHostOptions({ stateRoot: 'relative' }, {}), /absolute/);

  // The real bridge and an independently constructed host authority must read
  // the exact same challenge. This proves storage wiring, not human approval.
  let actualBridge;
  const actualAdapter = createGatewayAdapter({ stateRoot: path.join(dir, 'actual-adapter'), runtime: 'queue', approvalStateDir: path.join(dir, 'host-approval') }, {
    env: {}, createBridge: options => (actualBridge = new SketchUpBridge(options)) });
  await actualAdapter.callGateway('start_agent_task', { intent: 'discover', instruction: 'Read only.', inputs: { topic: 'workflows', task_name: 'native_pbr' } });
  const challenge = await actualBridge.approvalAuthority.createChallenge({ taskId, planId: 'offline-plan', planHash: 'offline-plan-hash', modelRevision: 'offline-revision', riskLevel: 'S3', allowedOperations: ['transform_object'] });
  const hostAuthority = new ApprovalAuthority({ stateDir: path.join(dir, 'host-approval') });
  assert.deepEqual(await hostAuthority.readChallenge(challenge.challenge_id), challenge);
  await assert.rejects(new ApprovalAuthority({ stateDir: path.join(dir, 'actual-adapter', 'approval') }).readChallenge(challenge.challenge_id));
  await assert.rejects(actualAdapter.readApprovalStatus({ taskId }), /returned during this run/);
  await assert.rejects(actualAdapter.callGateway('verify_agent_task_authorization_ready', { task_id: taskId }), /Unknown tool|not registered|unknown/i);

  let readiness = [], statusCalls = 0, gatewayCalls = 0;
  const stub = createGatewayAdapter({ stateRoot: path.join(dir, 'status-adapter'), runtime: 'queue', approvalStateDir: path.join(dir, 'stub-host') }, { env: {}, createBridge: () => ({
    start_agent_task: async () => { gatewayCalls++; return waiting; },
    verify_agent_task_authorization_ready: async ({ task_id }) => { statusCalls++; assert.equal(task_id, taskId); const item = readiness.shift(); if (item instanceof Error) throw item; return item; }
  }) });
  await stub.callGateway('start_agent_task', firstInput);
  const nativeReady = { ok: true, kind: 'agent_task_authorization_readiness', task_id: taskId, execution_task_id: connectionId, approval_status: 'approved_pending_execution', approval_token_exposed: false, challenge_id: challengeId, decision_id: 'decision-fixture', approval_token: 'MUST-NOT-ESCAPE', approved_by: 'fixture-user' };
  readiness = [new AgentContractError('APPROVAL_REQUIRED', 'No decision.'), nativeReady];
  const detachedWait = stub.waitForApproval;
  assert.deepEqual(await detachedWait({ taskId, timeoutMs: 100, pollMs: 1 }), approved, 'Host callback must work when passed directly to runModelLoop.');
  assert.equal(statusCalls, 2); assert.equal(gatewayCalls, 1, 'The host wait cannot call resume, submit or apply.');
  for (const [error, expected] of [[new AgentContractError('APPROVAL_EXPIRED', 'Expired.'), 'expired'], [new AgentContractError('POLICY_DENIED', 'Rejected.', { nextAction: { reason: 'trusted_user_rejected' } }), 'rejected'], [new AgentContractError('APPROVAL_INVALID', 'Invalid signature.'), 'blocked'], [new AgentContractError('MODEL_REVISION_MISMATCH', 'Changed.'), 'blocked'], [new AgentContractError('APPROVAL_REPLAYED', 'Consumed.'), 'blocked']]) {
    readiness = [error]; assert.equal((await stub.waitForApproval({ taskId, timeoutMs: 100, pollMs: 1 })).status, expected); assert.equal(readiness.length, 0);
  }
  readiness = [{ ...nativeReady, approval_status: 'server_policy_auto_approved' }];
  assert.equal((await stub.readApprovalStatus({ taskId })).status, 'blocked', 'Policy approval must never become a human system_unlock.');

  let requests = 0, dispatches = [];
  let unblock;
  const pendingDecision = new Promise(resolve => { unblock = resolve; });
  let pauseEntered;
  const entered = new Promise(resolve => { pauseEntered = resolve; });
  const runDir = path.join(dir, 'continuous');
  const provider = { invoke: async request => {
    requests++;
    assert.equal(request.tools.length, 4);
    assert.equal(request.messages[0].content, task.prompt);
    if (requests === 1) { assert.equal(request.messages.length, 1); return tool('first', 'start_agent_task', firstInput); }
    assert.deepEqual(request.messages[1].content, [{ type: 'tool_use', id: 'first', name: 'start_agent_task', input: firstInput }]);
    assert.deepEqual(JSON.parse(request.messages[2].content[0].content), waiting, 'Original tool result must be preserved verbatim.');
    const notice = JSON.parse(request.messages[2].content[1].text);
    assert.equal(notice.task_id, taskId);
    assert.equal(notice.approval_status, 'approved_pending_execution');
    assert.equal(JSON.stringify(request.messages).includes('MUST-NOT-ESCAPE'), false);
    assert.equal(JSON.stringify(request.messages).includes('SECRET-DESIGN-ANSWER'), false);
    if (requests === 2) return tool('resume', 'resume_agent_task', { task_id: taskId });
    if (requests === 3) return tool('connect', 'start_agent_task', { intent: 'discover', instruction: 'Read fresh connection.', inputs: { topic: 'connect', runtime: 'queue' } });
    if (requests === 4) return tool('submit', 'submit_agent_task_input', { task_id: taskId, idempotency_key: 'model-chosen-stable-submit-key', input: { connection_task_id: connectionId } });
    return response([{ type: 'text', text: 'Fixture end; no native acceptance.' }]);
  } };
  const running = runModelLoop({ provider, gateway: async (name, args) => {
    dispatches.push({ name, args });
    if (dispatches.length === 1) return waiting;
    if (name === 'resume_agent_task') return { ...waiting, next_action: { action: 'submit_task_input', approval_status: 'approved_pending_execution', required: ['connection_task_id'] } };
    if (name === 'start_agent_task') return { ok: true, task_id: connectionId, task_state: 'completed', result: { connection_task_id: connectionId } };
    return { ok: true, task_id: taskId, task_state: 'completed', result: { quality_accepted: false } };
  }, waitForApproval: async ({ taskId: actual, signal }) => { assert.equal(actual, taskId); assert.equal(signal.aborted, false); pauseEntered(); return pendingDecision; }, task, definitions, outputDir: runDir, limits, testFixture: true });
  await entered;
  assert.equal(requests, 1); assert.equal(dispatches.length, 1, 'No provider or mutation during approval wait.');
  const paused = JSON.parse(await fs.readFile(path.join(runDir, 'approval-pause-1.json'), 'utf8'));
  assert.equal(paused.messages.length, 3); assert.equal(paused.cross_process_resume_supported, false);
  unblock({ ...approved, approval_token: 'MUST-NOT-ESCAPE', answer: 'SECRET-DESIGN-ANSWER' });
  const summary = await running;
  assert.equal(summary.outcome, 'model_finished'); assert.equal(summary.run_id, paused.run_id);
  assert.equal(summary.provider_request_count, 5); assert.equal(summary.tool_call_count, 4); assert.equal(summary.total_reported_tokens, 100);
  assert.equal(summary.observed_system_unlocks, 1); assert.equal(summary.approval_pause_count, 1);
  assert.deepEqual(dispatches.map(item => item.name), ['start_agent_task', 'resume_agent_task', 'start_agent_task', 'submit_agent_task_input']);
  assert.equal(dispatches.at(-1).args.task_id, taskId);
  assert.equal(dispatches.at(-1).args.idempotency_key, 'model-chosen-stable-submit-key');
  const events = (await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.type === 'human_intervention' && event.kind === 'system_unlocks').length, 1);
  assert.equal(events.find(event => event.type === 'approval_resume').model_context_replaced, false);
  assert.equal(summary.live_runtime_acceptance, false);

  for (const [label, decision, expected] of [['rejected', { task_id: taskId, status: 'rejected' }, 'approval_rejected'], ['expired', { task_id: taskId, status: 'expired' }, 'approval_expired'], ['timeout', { task_id: taskId, status: 'timeout' }, 'awaiting_approval_timeout'], ['wrong-task', { ...approved, task_id: connectionId }, 'approval_status_invalid'], ['wrong-challenge', { ...approved, challenge_id: 'approval-other' }, 'approval_status_invalid'], ['policy-only', { ...approved, approval_status: 'copy_fast_active' }, 'approval_status_invalid'], ['missing-host', null, 'awaiting_approval_host']]) {
    let invokes = 0, calls = 0;
    const stopped = await runModelLoop({ provider: { invoke: async () => { invokes++; return tool('one', 'start_agent_task', firstInput); } }, gateway: async () => { calls++; return waiting; },
      ...(decision ? { waitForApproval: async () => decision } : {}), task, definitions, outputDir: path.join(dir, label), limits, testFixture: true });
    assert.equal(stopped.outcome, expected); assert.equal(invokes, 1); assert.equal(calls, 1); assert.equal(stopped.observed_system_unlocks, 0);
  }
  let batchDispatches = 0;
  const batch = await runModelLoop({ provider: { invoke: async () => response([
    { type: 'tool_use', id: 'prepare', name: 'start_agent_task', input: firstInput },
    { type: 'tool_use', id: 'premature-submit', name: 'submit_agent_task_input', input: { task_id: taskId, idempotency_key: 'premature-submit-key', input: {} } }
  ]) }, gateway: async () => { batchDispatches++; return waiting; }, waitForApproval: async () => ({ task_id: taskId, status: 'timeout' }), task, definitions, outputDir: path.join(dir, 'batch'), limits, testFixture: true });
  assert.equal(batchDispatches, 1, 'Later calls in the same model turn must be held before approval.');
  assert.equal(batch.tool_call_count, 2, 'Record the attempted call even though it was not dispatched.');
  assert.equal(batch.outcome, 'awaiting_approval_timeout');
  console.log(JSON.stringify({ ok: true, evidence_level: 'isolated_host_wiring_and_loop_fixtures', provider_calls: 0, native_calls: 0, approval_decisions_issued: 0,
    verified: ['shared-live-and-isolated-mock-approval-state', 'readiness-only-no-token-or-apply', 'same-run-context-model-owned-resume-connect-submit', 'system-unlock-separate-metric', 'denial-expiry-timeout-signature-boundaries'] }));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
