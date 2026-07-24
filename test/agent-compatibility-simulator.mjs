import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256Canonical } from '../src/agent-contract.mjs';
import {
  AGENT_CAPABILITY_PROFILES,
  CapabilityConstrainedToolClient,
  CapabilityProfile,
  FaultInjector,
  MockOnlyCapabilityDispatcher,
  MutationLedger,
  VolatileAgentState
} from '../src/agent-compatibility-simulator.mjs';

assert.deepEqual(Object.keys(AGENT_CAPABILITY_PROFILES), ['L0', 'L1', 'L2']);
const harnessSource = await fs.readFile(new URL('../scripts/run-agent-compatibility-harness.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(harnessSource, /ledger\.record\s*\(/, 'compatibility scenarios must not self-report mutation outcomes');
assert.match(harnessSource, /ledger\.recordGatewayEvent\s*\(/, 'compatibility hard gates must consume Gateway audit events');
assert.match(harnessSource, /client\.call\('read_agent_artifact'/, 'projected results must be recovered through the constrained Agent tool surface');
assert.doesNotMatch(harnessSource, /taskStore\.readArtifact\s*\(/, 'the compatibility harness must not bypass the Gateway to read a projection');
assert.equal(CapabilityProfile.forLevel('L0').maxContextChars, 4096);
assert.equal(CapabilityProfile.forLevel('L1').maxContextChars, 16384);
assert.equal(CapabilityProfile.forLevel('L2').maxContextChars, 65536);
assert.equal(CapabilityProfile.forLevel('L0').maxInFlight, 1);
assert.equal(CapabilityProfile.forLevel('L2').maxInFlight, 4);
assert.equal(CapabilityProfile.forLevel('L0').reportConstraints().structured_output.enforced, true, 'L0 results must cross the lossless JSON-text boundary');
assert.equal(CapabilityProfile.forLevel('L0').reportConstraints().context.enforced, true);

const observations = [];
const dispatcher = {
  async dispatch(tool, args, context) {
    observations.push({ tool, args: structuredClone(args), context: structuredClone(context) });
    if (args?.fixture === 'large') return { text: 'x'.repeat(5000) };
    if (args?.fixture === 'path') return { artifact: { file_path: '/tmp/private-result.json' } };
    if (args?.fixture === 'image') return { content: [{ type: 'image', data: 'base64-image-fixture' }] };
    if (args?.fixture === 'non-json') return { ok: true, undefined_value: undefined };
    return { ok: true, tool, args };
  }
};
const state = new VolatileAgentState({ task_id: 'task_fixture', scratch: { verbose: true } });
const faultInjector = new FaultInjector({ state });
const l0 = new CapabilityConstrainedToolClient({ dispatcher, profile: 'L0', state, faultInjector });

const started = await l0.call('start_agent_task', {
  intent: 'understand_model',
  instruction: 'Capability fixture.',
  client_capabilities: { vision: true, local_files: true, structured_output: true, context: 'long', parallel: true }
});
assert.equal(started.ok, true);
assert.deepEqual(observations.at(-1).args.client_capabilities, AGENT_CAPABILITY_PROFILES.L0.clientCapabilities(), 'self-reported capabilities must not override the trusted simulator profile');

await expectConstraint(
  l0.call('start_agent_task', {
    intent: 'reference_image_correction', instruction: 'Path fixture.', inputs: { reference_image_path: '/tmp/reference.png' }
  }),
  'local_files'
);
await expectConstraint(
  l0.call('start_agent_task', {
    intent: 'reference_image_correction', instruction: 'Camel-case path fixture.', inputs: { referenceImagePath: '/tmp/reference.png' }
  }),
  'local_files'
);
await l0.call('start_agent_task', {
  intent: 'understand_model', instruction: 'Opaque handles are pathless.', inputs: { source_artifacts: ['artifact:task_123:artifact_456'] }
});
await expectConstraint(
  l0.call('start_agent_task', {
    intent: 'reference_image_correction', instruction: 'Raw image fixture.', inputs: { image_base64: 'abc123' }
  }),
  'vision'
);
await expectConstraint(l0.call('resume_agent_task', { task_id: 'task_fixture', fixture: 'path' }), 'local_files');
await expectConstraint(l0.call('resume_agent_task', { task_id: 'task_fixture', fixture: 'image' }), 'vision');
const contextError = await expectConstraint(l0.call('resume_agent_task', { task_id: 'task_fixture', fixture: 'large' }), 'context_budget');
assert.equal(contextError.violation.limit, 4096);
assert.ok(contextError.violation.observed > contextError.violation.limit);
assert.equal(contextError.next_action.action, 'spill_result_to_artifact');
await expectConstraint(l0.call('get_docs', {}), 'tool_surface');

let releaseSlow;
const slowDispatcher = {
  dispatch: async () => new Promise((resolve) => { releaseSlow = () => resolve({ ok: true }); })
};
const serial = new CapabilityConstrainedToolClient({ dispatcher: slowDispatcher, profile: 'L0', allowedTools: ['slow'] });
const first = serial.call('slow', {});
await Promise.resolve();
await expectConstraint(serial.call('slow', {}), 'max_in_flight');
releaseSlow();
assert.equal((await first).ok, true);

l0.recordExternalCall('trusted_host', 'approve_challenge');
await l0.fixtureCall('fixture_setup', {});
assert.deepEqual(l0.accounting(), {
  agent_tool_calls: 9,
  artifact_page_tool_calls: 0,
  fixture_calls: 1,
  trusted_host_calls: 1,
  text_only_round_trips: 2,
  text_only_round_trip_failures: 0,
  capability_violations: 7
});

const serializationError = await expectConstraint(
  l0.call('resume_agent_task', { task_id: 'task_fixture', fixture: 'non-json' }),
  'structured_output'
);
assert.equal(serializationError.next_action.action, 'return_json_text_compatible_result');
assert.deepEqual(l0.accounting(), {
  agent_tool_calls: 10,
  artifact_page_tool_calls: 0,
  fixture_calls: 1,
  trusted_host_calls: 1,
  text_only_round_trips: 2,
  text_only_round_trip_failures: 1,
  capability_violations: 8
});

faultInjector.dropNextResponse({ tool: 'resume_agent_task' });
await assert.rejects(
  l0.call('resume_agent_task', { task_id: 'task_fixture' }),
  (error) => error?.code === 'SIMULATED_RESPONSE_LOST'
);
assert.equal(observations.at(-1).tool, 'resume_agent_task', 'response loss must happen after the dispatcher completes');
const lost = faultInjector.loseAgentState({ retain: ['task_id'] });
assert.equal(lost.generation, 1);
assert.equal(state.get('task_id'), 'task_fixture');
assert.equal(state.has('scratch'), false);

const adapterRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-compatibility-adapter-'));
try {
  const taskId = 'task_11111111-1111-4111-8111-111111111111';
  const imageHandle = `image-artifact:sha256:${'a'.repeat(64)}`;
  const registeredArtifacts = [];
  const privatePaths = {};
  const adapterObservations = [];
  const adapterTaskStore = {
    rootDir: adapterRoot,
    async getTask(requestedTaskId, { includePrivate = false } = {}) {
      assert.equal(requestedTaskId, taskId);
      return {
        task_id: taskId,
        task_version: registeredArtifacts.length,
        artifacts: structuredClone(registeredArtifacts),
        ...(includePrivate ? { private: { artifact_paths: structuredClone(privatePaths) } } : {})
      };
    },
    async registerArtifact(requestedTaskId, { filePath, kind, mediaType, label }) {
      assert.equal(requestedTaskId, taskId);
      const handle = `artifact:${taskId}:33333333-3333-4333-8333-${String(registeredArtifacts.length).padStart(12, '0')}`;
      const record = { handle, kind, media_type: mediaType, label, size_bytes: 1, created_at: new Date().toISOString() };
      registeredArtifacts.push(record);
      privatePaths[handle] = filePath;
      return record;
    }
  };
  const adapter = new MockOnlyCapabilityDispatcher({
    taskStore: adapterTaskStore,
    imageArtifactStore: {
      async ingest(input) {
        assert.ok(input.buffer || input.filePath);
        return { record: { handle: imageHandle, media_type: 'image/png' }, reused: false };
      }
    },
    artifactRoot: path.join(adapterRoot, 'projections'),
    dispatcher: {
      async dispatch(tool, args) {
        adapterObservations.push({ tool, args: structuredClone(args) });
        return {
          contract_version: 'agent-contract.v1',
          kind: 'agent_result_envelope',
          ok: true,
          task_id: taskId,
          task_state: 'completed',
          task_version: 1,
          retryable: false,
          idempotent_replay: false,
          result: { kind: 'understand_model_result', model_data: { trust: 'untrusted_data', value: { entities: Array.from({ length: 200 }, (_, index) => ({ id: index, description: 'x'.repeat(100) })) } } },
          data: { kind: 'understand_model_result', model_data: { trust: 'untrusted_data', value: { entities: Array.from({ length: 200 }, (_, index) => ({ id: index, description: 'x'.repeat(100) })) } } },
          warnings: [],
          error: null,
          next_action: null,
          artifacts: []
        };
      }
    }
  });
  const adapterClient = new CapabilityConstrainedToolClient({ dispatcher: adapter, profile: 'L0' });
  const projected = await adapterClient.call('start_agent_task', {
    intent: 'reference_image_correction',
    instruction: 'Resolve an opaque server image and project the oversized result.',
    inputs: { runtime: 'mock', reference_image_handle: imageHandle }
  });
  assert.equal(adapterObservations[0].args.inputs.reference_image_handle, imageHandle);
  assert.equal(Object.hasOwn(adapterObservations[0].args.inputs, 'reference_image_path'), false);
  assert.ok(JSON.stringify(projected).length <= 4096);
  assert.ok(projected.artifacts.some((artifact) => artifact.label === 'capability-compatible-full-result'));
  assert.equal(Object.hasOwn(projected.result.model_data, 'source'), false, 'missing optional projection fields must be omitted before JSON-text transport');
  assert.equal(adapterClient.accounting().text_only_round_trips, 1);
  assert.equal(adapterClient.accounting().text_only_round_trip_failures, 0);
  assert.equal((await adapter.registerServerImageArtifact({ buffer: Buffer.from('fixture') })).record.handle, imageHandle);
  await assert.rejects(
    adapter.dispatch('start_agent_task', { intent: 'understand_model', instruction: 'Queue must fail.', inputs: { runtime: 'queue' } }, { actor: 'agent', profile: 'L0' }),
    (error) => error?.code === 'POLICY_DENIED'
  );
} finally {
  await fs.rm(adapterRoot, { recursive: true, force: true });
}

const cleanLedger = new MutationLedger();
const appliedAuditEvent = gatewayAuditEvent({
  eventId: 'gateway-audit-l0-0001', requestId: 'request-1', changed: true,
  modifiedTargets: ['target-a'], receiptId: 'mutation-receipt-fixture'
});
const replayAuditEvent = gatewayAuditEvent({
  eventId: 'gateway-audit-l0-0002', requestId: 'request-1-replay', changed: false,
  modifiedTargets: [], receiptId: 'mutation-receipt-fixture'
});
cleanLedger.recordGatewayEvent(appliedAuditEvent);
cleanLedger.recordGatewayEvent(replayAuditEvent);
assert.equal(cleanLedger.toJSON()[0].source_event_id, 'gateway-audit-l0-0001');
assert.equal(cleanLedger.toJSON()[0].receipt_verified, true);
assert.throws(() => cleanLedger.recordGatewayEvent({ ...appliedAuditEvent, event_hash: `sha256:${'0'.repeat(64)}` }), /integrity-matching Gateway audit event/);
assert.deepEqual(cleanLedger.hardGates(), {
  wrong_object_automatic_execution: 0,
  unauthorized_s2_s4_execution: 0,
  duplicate_request_duplicate_modification: 0
});

const failingLedger = new MutationLedger();
failingLedger.record({
  level: 'L1', scenario: 'wrong_object', requestId: 'reviewed-but-wrong-1', automaticExecution: false,
  reviewedTargets: ['target-a'], actualModifiedTargets: ['target-b'], mutationApplied: true, mutationReceipt: 'revision-a'
});
failingLedger.record({
  level: 'L1', scenario: 'unauthorized', requestId: 'approval-1', riskLevel: 'S3', trustedApproval: false,
  reviewedTargets: ['target-a'], actualModifiedTargets: ['target-a'], mutationApplied: true, mutationReceipt: 'revision-b'
});
failingLedger.record({
  level: 'L1', scenario: 'duplicate', requestId: 'duplicate-1', idempotencyKey: 'idem-duplicate', riskLevel: 'S1',
  reviewedTargets: ['target-a'], actualModifiedTargets: ['target-a'], mutationApplied: true, mutationReceipt: 'revision-c'
});
failingLedger.record({
  level: 'L1', scenario: 'duplicate', requestId: 'duplicate-1-retry', idempotencyKey: 'idem-duplicate', riskLevel: 'S1',
  reviewedTargets: ['target-a'], actualModifiedTargets: ['target-a'], mutationApplied: true, mutationReceipt: 'revision-c'
});
assert.deepEqual(failingLedger.hardGates(), {
  wrong_object_automatic_execution: 1,
  unauthorized_s2_s4_execution: 1,
  duplicate_request_duplicate_modification: 1
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  profiles: Object.keys(AGENT_CAPABILITY_PROFILES),
  enforced_constraints: ['tool_surface', 'context_budget', 'local_files', 'vision', 'structured_output', 'max_in_flight'],
  l0_json_text_round_trip_enforced: true,
  non_json_projection_fail_closed: true,
  mock_only_handle_dispatcher: true,
  response_loss_after_dispatch: true,
  mutation_hard_gates_derived: true,
  mutation_hard_gates_event_sourced: true,
  scenario_self_reported_mutation_outcomes: false
}, null, 2)}\n`);

function gatewayAuditEvent({ eventId, requestId, changed, modifiedTargets, receiptId }) {
  const modelDiffCore = {
    changed,
    model_revision_before: 'sha256:before',
    model_revision_after: changed ? 'sha256:after' : 'sha256:after',
    model_fingerprint_before: changed ? 'sha256:model-before' : 'sha256:model-after',
    model_fingerprint_after: 'sha256:model-after',
    modified_targets: modifiedTargets
  };
  const core = {
    version: 'agent-gateway-mutation-audit-event.v1',
    kind: 'agent_gateway_mutation_audit_event',
    event_id: eventId,
    level: 'L0',
    scenario: 'approved_replay',
    request_id: requestId,
    idempotency_key: 'idem-1',
    intent: 'reviewed_existing_model_edit',
    risk_level: 'S2',
    authorization_mode: 'trusted_one_time_token',
    requested_targets: ['target-a'],
    model_diff: { ...modelDiffCore, diff_hash: sha256Canonical(modelDiffCore) },
    mutation_receipt: {
      receipt_id: receiptId,
      risk_level: 'S2',
      authorization_mode: 'trusted_one_time_token',
      integrity_verified: true
    }
  };
  return { ...core, event_hash: sha256Canonical(core) };
}

async function expectConstraint(promise, constraint) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error?.code, 'CAPABILITY_CONSTRAINT_VIOLATION');
    assert.equal(error?.violation?.constraint, constraint);
    assert.ok(error?.violation?.message);
    return error;
  }
  assert.fail(`Expected ${constraint} capability violation.`);
}
