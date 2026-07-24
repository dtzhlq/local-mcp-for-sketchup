import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { AgentContractError } from '../src/agent-contract.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { SessionContractAuthority } from '../src/session-contract.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';

async function main() {
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-session-contract-'));
let now = Date.parse('2026-07-15T10:00:00.000Z');
const directExecutionPolicy = Object.freeze({
  allowed_runtimes: ['mock', 'queue'],
  allow_queue_mutation: true,
  allow_direct_expert_queue_mutation: true
});
try {
  const policyRuntime = new FakeQueueRuntime();
  const policyAuthority = new SessionContractAuthority({ stateDir: path.join(root, 'policy'), now: () => now, serverSessionId: 'policy-server' });
  const gatewayOnlyBridge = new SketchUpBridge({
    queueRuntime: policyRuntime,
    sessionContractAuthority: policyAuthority,
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true }
  });
  const policyContract = (await gatewayOnlyBridge.create_queue_handshake()).session_contract;
  await assert.rejects(
    gatewayOnlyBridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: policyContract }),
    hasCode('POLICY_DENIED')
  );
  assert.equal(policyRuntime.mutationCount, 0, 'Gateway permission must not enable the direct expert surface');
  await gatewayOnlyBridge.withAgentGatewayExecution({ taskId: 'task_policy', intent: 'create_model' }, (gatewayBridge) => gatewayBridge.build_model({
    code: emptyDsl(),
    runtime: 'queue',
    session_contract: policyContract
  }));
  assert.equal(policyRuntime.mutationCount, 1, 'the internal Gateway scope may use the separately enabled Gateway policy');

  const gatewayRuntime = new FakeQueueRuntime();
  const gatewayAuthority = new SessionContractAuthority({ stateDir: path.join(root, 'gateway-session'), now: () => now, serverSessionId: 'gateway-server' });
  const taskGatewayBridge = new SketchUpBridge({
    queueRuntime: gatewayRuntime,
    sessionContractAuthority: gatewayAuthority,
    agentContract: { rootDir: path.join(root, 'gateway-tasks') },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true }
  });
  const missingGatewayHandshake = await taskGatewayBridge.start_agent_task({
    intent: 'create_model',
    instruction: 'Test recoverable live creation.',
    inputs: { runtime: 'queue', code: emptyDsl() }
  });
  assert.equal(missingGatewayHandshake.ok, false);
  assert.equal(missingGatewayHandshake.error.code, 'HANDSHAKE_REQUIRED');
  assert.equal(missingGatewayHandshake.task_state, 'awaiting_input');
  assert.equal(gatewayRuntime.mutationCount, 0);
  const gatewayContract = (await taskGatewayBridge.create_queue_handshake()).session_contract;
  const recoveredGatewayTask = await taskGatewayBridge.submit_agent_task_input({
    task_id: missingGatewayHandshake.task_id,
    idempotency_key: 'gateway-fresh-handshake-recovery',
    input: { session_contract: gatewayContract }
  });
  assert.equal(recoveredGatewayTask.ok, true);
  assert.equal(recoveredGatewayTask.task_state, 'completed');
  assert.equal(gatewayRuntime.mutationCount, 1, 'recovered Gateway task must mutate exactly once');

  const lockContract = (await taskGatewayBridge.create_queue_handshake()).session_contract;
  gatewayRuntime.nextIdleError = new AgentContractError('QUEUE_LOCK_PRESENT', 'A simulated queue owner is active.');
  const lockedGatewayTask = await taskGatewayBridge.start_agent_task({
    intent: 'create_model',
    instruction: 'Wait for the simulated queue owner.',
    inputs: { runtime: 'queue', code: emptyDsl(), session_contract: lockContract }
  });
  assert.equal(lockedGatewayTask.ok, false);
  assert.equal(lockedGatewayTask.error.code, 'QUEUE_LOCK_PRESENT');
  assert.equal(lockedGatewayTask.task_state, 'awaiting_input');
  assert.equal(gatewayRuntime.mutationCount, 1, 'queue preflight failure must not reach mutation');
  const unlockedContract = (await taskGatewayBridge.create_queue_handshake()).session_contract;
  const unlockedGatewayTask = await taskGatewayBridge.submit_agent_task_input({
    task_id: lockedGatewayTask.task_id,
    idempotency_key: 'gateway-queue-lock-recovery',
    input: { session_contract: unlockedContract }
  });
  assert.equal(unlockedGatewayTask.ok, true);
  assert.equal(gatewayRuntime.mutationCount, 2, 'queue-lock recovery must execute exactly once');

  const runtime = new FakeQueueRuntime();
  const authority = new SessionContractAuthority({ stateDir: path.join(root, 'main'), now: () => now, serverSessionId: 'test-server-1' });
  const bridge = new SketchUpBridge({ queueRuntime: runtime, sessionContractAuthority: authority, executionPolicy: directExecutionPolicy });

  const atomicRuntime = new FakeQueueRuntime();
  const atomicBridge = new SketchUpBridge({
    queueRuntime: atomicRuntime,
    sessionContractAuthority: new SessionContractAuthority({
      stateDir: path.join(root, 'atomic'),
      now: () => now,
      serverSessionId: 'atomic-server'
    }),
    executionPolicy: directExecutionPolicy
  });
  await atomicBridge.withFreshQueueMutationAuthorization(
    { operation: 'build_model' },
    (lockedBridge) => lockedBridge.build_model({ code: emptyDsl(), runtime: 'queue' })
  );
  assert.equal(atomicRuntime.atomicProbeCount, 1, 'atomic authorization must issue exactly one fresh runtime probe');
  assert.equal(atomicRuntime.sessionStateCount, 0, 'atomic authorization must not repeat the full server-side revision scan');
  assert.equal(atomicRuntime.mutationCount, 1, 'atomic authorization must execute the intended mutation exactly once');
  assert.equal(atomicRuntime.guards.length, 1, 'atomic authorization must retain the plugin transport guard');
  assert.equal(atomicRuntime.lockDepth, 0, 'atomic authorization must release its exclusive scope');

  const stalePluginRuntime = new FakeQueueRuntime();
  stalePluginRuntime.state.capability_version = '0.1.0-rc.2-capabilities.4';
  delete stalePluginRuntime.state.model_revision_strategy;
  const stalePluginBridge = new SketchUpBridge({
    queueRuntime: stalePluginRuntime,
    sessionContractAuthority: new SessionContractAuthority({ stateDir: path.join(root, 'stale-plugin'), now: () => now, serverSessionId: 'stale-plugin-server' }),
    executionPolicy: directExecutionPolicy
  });
  await assert.rejects(stalePluginBridge.create_queue_handshake(), hasCode('HANDSHAKE_CAPABILITIES_MISMATCH'));
  assert.equal(stalePluginRuntime.mutationCount, 0, 'a stale plugin must not receive a signed handshake or reach mutation');

  const missingStrategyRuntime = new FakeQueueRuntime();
  delete missingStrategyRuntime.state.model_revision_strategy;
  const missingStrategyBridge = new SketchUpBridge({
    queueRuntime: missingStrategyRuntime,
    sessionContractAuthority: new SessionContractAuthority({ stateDir: path.join(root, 'missing-strategy'), now: () => now, serverSessionId: 'missing-strategy-server' }),
    executionPolicy: directExecutionPolicy
  });
  await assert.rejects(missingStrategyBridge.create_queue_handshake(), hasCode('HANDSHAKE_CAPABILITIES_MISMATCH'));
  assert.equal(missingStrategyRuntime.mutationCount, 0, 'a plugin without the expected revision strategy must fail before signing');

  const missingRuntimeSourceRuntime = new FakeQueueRuntime();
  delete missingRuntimeSourceRuntime.state.boolean_operations_sha256;
  const missingRuntimeSourceBridge = new SketchUpBridge({
    queueRuntime: missingRuntimeSourceRuntime,
    sessionContractAuthority: new SessionContractAuthority({ stateDir: path.join(root, 'missing-runtime-source'), now: () => now, serverSessionId: 'missing-runtime-source-server' }),
    executionPolicy: directExecutionPolicy
  });
  await assert.rejects(missingRuntimeSourceBridge.create_queue_handshake(), hasCode('HANDSHAKE_CAPABILITIES_MISMATCH'));
  assert.equal(missingRuntimeSourceRuntime.mutationCount, 0, 'a plugin without runtime source attestation must fail before signing');

  const missingModelRevisionSourceRuntime = new FakeQueueRuntime();
  delete missingModelRevisionSourceRuntime.state.model_revision_source_sha256;
  const missingModelRevisionSourceBridge = new SketchUpBridge({
    queueRuntime: missingModelRevisionSourceRuntime,
    sessionContractAuthority: new SessionContractAuthority({ stateDir: path.join(root, 'missing-model-revision-source'), now: () => now, serverSessionId: 'missing-model-revision-source-server' }),
    executionPolicy: directExecutionPolicy
  });
  await assert.rejects(missingModelRevisionSourceBridge.create_queue_handshake(), hasCode('HANDSHAKE_CAPABILITIES_MISMATCH'));
  assert.equal(missingModelRevisionSourceRuntime.mutationCount, 0, 'a plugin without Model Revision source attestation must fail before signing');

  const created = await bridge.create_queue_handshake({ expires_in_ms: 60_000 });
  const contract = created.session_contract;
  assert.equal(created.mutates_model, false);
  assert.equal(runtime.mutationCount, 0, 'fresh handshake creation must be read-only');
  assert.equal(contract.queue_state, 'idle');
  assert.equal(contract.model_revision, runtime.state.model_revision);
  assert.equal(contract.model_revision_strategy, 'definition-merkle.v2');
  assert.equal(contract.model_revision_unique_entity_limit, 1_000_000);
  assert.equal(contract.boolean_operations_sha256, runtime.state.boolean_operations_sha256);
  assert.equal(contract.model_revision_source_sha256, runtime.state.model_revision_source_sha256);
  assert.equal(contract.model_modified, false);
  await validateSchema(contract);

  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue' }),
    hasCode('HANDSHAKE_REQUIRED')
  );
  assert.equal(runtime.mutationCount, 0, 'missing handshake must fail before live mutation');

  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: { ...contract, handshake_id: 'handshake_tampered' } }),
    hasCode('HANDSHAKE_INVALID')
  );
  assert.equal(runtime.mutationCount, 0, 'tampered handshake must fail before live mutation');

  await bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: contract });
  assert.equal(runtime.mutationCount, 1);
  assert.equal(runtime.guards.at(-1).session_id, contract.session_id);
  assert.equal(runtime.guards.at(-1).model_revision, contract.model_revision);
  assert.equal(runtime.guards.at(-1).boolean_operations_sha256, contract.boolean_operations_sha256);
  assert.equal(runtime.guards.at(-1).model_revision_source_sha256, contract.model_revision_source_sha256);
  assert.equal(runtime.guards.at(-1).model_modified, contract.model_modified);
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: contract }),
    hasCode('HANDSHAKE_MODEL_REVISION_MISMATCH')
  );
  assert.equal(runtime.mutationCount, 1, 'stale handshake must not reach the mutating runtime method');

  const restarted = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.session_id = 'plugin-session-restarted';
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: restarted }),
    hasCode('HANDSHAKE_SESSION_MISMATCH')
  );

  const switched = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.document_id = 'document-switched';
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: switched }),
    hasCode('HANDSHAKE_DOCUMENT_MISMATCH')
  );

  const identityChanged = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.model_identity = { ...runtime.state.model_identity, title: 'Different Model' };
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: identityChanged }),
    hasCode('HANDSHAKE_MODEL_IDENTITY_MISMATCH')
  );

  const capabilityChanged = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.capability_version = 'capabilities.restarted';
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: capabilityChanged }),
    hasCode('HANDSHAKE_CAPABILITIES_MISMATCH')
  );
  runtime.state.capability_version = getRuntimeCapabilities('queue').capability_version;

  const revisionStrategyChanged = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.model_revision_strategy = 'legacy_recursive_index';
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: revisionStrategyChanged }),
    hasCode('HANDSHAKE_CAPABILITIES_MISMATCH')
  );
  assert.equal(runtime.mutationCount, 1, 'revision strategy drift must fail before live mutation');
  runtime.state.model_revision_strategy = getRuntimeCapabilities('queue').model_revision.strategy;

  const revisionLimitChanged = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.model_revision_unique_entity_limit = 500_000;
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: revisionLimitChanged }),
    hasCode('HANDSHAKE_CAPABILITIES_MISMATCH')
  );
  assert.equal(runtime.mutationCount, 1, 'revision safety-limit drift must fail before live mutation');
  runtime.state.model_revision_unique_entity_limit = getRuntimeCapabilities('queue').model_revision.unique_entity_limit;

  const runtimeSourceChanged = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.boolean_operations_sha256 = 'f'.repeat(64);
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: runtimeSourceChanged }),
    hasCode('HANDSHAKE_CAPABILITIES_MISMATCH')
  );
  assert.equal(runtime.mutationCount, 1, 'loaded Boolean source drift must fail before live mutation');
  runtime.state.boolean_operations_sha256 = getRuntimeCapabilities('queue').boolean_operations_sha256;

  const modelRevisionSourceChanged = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.model_revision_source_sha256 = 'e'.repeat(64);
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: modelRevisionSourceChanged }),
    hasCode('HANDSHAKE_CAPABILITIES_MISMATCH')
  );
  assert.equal(runtime.mutationCount, 1, 'loaded Model Revision source drift must fail before live mutation');
  runtime.state.model_revision_source_sha256 = getRuntimeCapabilities('queue').model_revision_source_sha256;

  const modifiedStateChanged = (await bridge.create_queue_handshake()).session_contract;
  runtime.state.model_modified = !modifiedStateChanged.model_modified;
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: modifiedStateChanged }),
    hasCode('HANDSHAKE_MODEL_REVISION_MISMATCH')
  );
  assert.equal(runtime.mutationCount, 1, 'unsaved-model state drift must fail before live mutation');
  runtime.state.model_modified = modifiedStateChanged.model_modified;

  const expiring = (await bridge.create_queue_handshake({ expires_in_ms: 1000 })).session_contract;
  now += 1001;
  await assert.rejects(
    bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: expiring }),
    hasCode('HANDSHAKE_EXPIRED')
  );

  const composite = (await bridge.create_queue_handshake()).session_contract;
  await bridge.compare_model({
    code: emptyDsl(),
    expected_runtime: 'mock',
    actual_runtime: 'queue',
    session_contract: composite
  });
  assert.equal(runtime.mutationCount, 3, 'one high-level authorization should cover its locked reset and build sequence');

  const serverRestarted = (await bridge.create_queue_handshake()).session_contract;
  const newServerAuthority = new SessionContractAuthority({ stateDir: path.join(root, 'main'), now: () => now, serverSessionId: 'test-server-2' });
  const newServerBridge = new SketchUpBridge({ queueRuntime: runtime, sessionContractAuthority: newServerAuthority, executionPolicy: directExecutionPolicy });
  await assert.rejects(
    newServerBridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: serverRestarted }),
    hasCode('HANDSHAKE_SERVER_RESTARTED')
  );

  const persistent = (await bridge.create_queue_handshake()).session_contract;
  const restartedAuthority = new SessionContractAuthority({ stateDir: path.join(root, 'main'), now: () => now, serverSessionId: 'test-server-1' });
  const restartedBridge = new SketchUpBridge({ queueRuntime: runtime, sessionContractAuthority: restartedAuthority, executionPolicy: directExecutionPolicy });
  await restartedBridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: persistent });
  assert.equal(runtime.mutationCount, 4, 'signed contracts should survive a short-lived CLI process restart while the plugin session remains unchanged');

  process.stdout.write(`${JSON.stringify({ ok: true, tests: 34, direct_expert_policy_separated: true, gateway_preflight_recovery: true, atomic_fresh_authorization_single_server_scan: true, stale_plugin_rejected_before_signing: true, revision_strategy_bound: true, revision_limit_bound: true, runtime_source_attestation_bound: true, unsaved_model_state_bound: true, archival_v1_schema_readable: true, current_v2_schema_strict: true, mutation_count: runtime.mutationCount }, null, 2)}\n`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

class FakeQueueRuntime {
  constructor() {
    const capabilities = getRuntimeCapabilities('queue');
    this.capabilities = {
      ...capabilities,
      plugin: { name: 'Fake SketchUp Bridge', version: PRODUCT_VERSION, sketchup_version: '26.2', ruby_version: '3.2' }
    };
    this.state = {
      kind: 'queue_session_state',
      runtime: 'queue',
      session_id: 'plugin-session-1',
      document_id: 'document-1',
      model_identity: { model_guid: 'model-guid-1', runtime_object_id: '1001', title: 'Fixture', source_path: null },
      model_revision: revision(1),
      model_revision_strategy: capabilities.model_revision.strategy,
      model_revision_unique_entity_limit: capabilities.model_revision.unique_entity_limit,
      model_revision_complete: true,
      model_revision_total_seen: 10,
      model_revision_indexed: 10,
      model_modified: false,
      plugin_version: PRODUCT_VERSION,
      queue_state: 'idle',
      capability_version: capabilities.capability_version,
      manifest_version: capabilities.manifest_version,
      dsl_version: capabilities.dsl_version,
      occurrence_contract: capabilities.occurrence_contract,
      boolean_operations_sha256: capabilities.boolean_operations_sha256,
      model_revision_source_sha256: capabilities.model_revision_source_sha256,
      observed_at: new Date().toISOString()
    };
    this.mutationCount = 0;
    this.lockDepth = 0;
    this.guards = [];
    this.atomicProbeCount = 0;
    this.sessionStateCount = 0;
  }

  async withExclusiveAccess(callback) {
    this.lockDepth += 1;
    try {
      return await callback();
    } finally {
      this.lockDepth -= 1;
    }
  }

  async createFreshHandshakeProbe() {
    return structuredClone(this.state);
  }

  async withFreshHandshakeProbe(callback) {
    this.atomicProbeCount += 1;
    return this.withExclusiveAccess(() => callback(structuredClone(this.state)));
  }

  async withMutationGuard(guard, callback) {
    this.guards.push(structuredClone(guard));
    return callback();
  }

  async assertIdleForMutation() {
    if (this.nextIdleError) {
      const error = this.nextIdleError;
      this.nextIdleError = null;
      throw error;
    }
    return { queue_state: 'idle' };
  }

  async getSessionState() {
    this.sessionStateCount += 1;
    return structuredClone(this.state);
  }

  async getCapabilities() {
    return structuredClone(this.capabilities);
  }

  async buildModel() {
    this.mutationCount += 1;
    this.state.model_revision = revision(this.mutationCount + 1);
    this.state.model_modified = true;
    return emptySnapshot();
  }

  async resetModel() {
    this.mutationCount += 1;
    this.state.model_revision = revision(this.mutationCount + 1);
    this.state.model_modified = true;
    return emptySnapshot();
  }
}

function revision(value) {
  return `sha256:${String(value).padStart(64, '0')}`;
}

function emptyDsl() {
  return JSON.stringify({ version: 1, units: 'mm', operations: [] });
}

function emptySnapshot() {
  return {
    totals: { faces: 0, edges: 0, vertices: 0, groups: 0, instances: 0 },
    groups: [],
    instances: [],
    component_definitions: [],
    materials: [],
    material_names: [],
    tags: [],
    scenes: [],
    image_references: [],
    warnings: [],
    warning_messages: [],
    warning_summary: { total: 0, by_severity: { error: 0, warn: 0, info: 0 }, by_category: {} },
    bounding_box: { min: [0, 0, 0], max: [0, 0, 0], w: 0, d: 0, h: 0 },
    selection: []
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function validateSchema(contract) {
  const schema = JSON.parse(await fs.readFile(path.resolve('schema/session-contract-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  assert.equal(validate(contract), true, JSON.stringify(validate.errors));

  const missingCurrentAttestation = structuredClone(contract);
  delete missingCurrentAttestation.model_revision_source_sha256;
  assert.equal(validate(missingCurrentAttestation), false, 'a current v2 contract must include Model Revision loaded-source attestation');

  const archivalV1 = {
    ...structuredClone(contract),
    model_revision_strategy: 'definition-merkle.v1',
    capability_version: '0.1.0-rc.2-capabilities.6',
    manifest_version: '2026-07-agent-contract-v1.3'
  };
  delete archivalV1.model_modified;
  delete archivalV1.boolean_operations_sha256;
  delete archivalV1.model_revision_source_sha256;
  assert.equal(validate(archivalV1), true, JSON.stringify(validate.errors));
}

await main();
