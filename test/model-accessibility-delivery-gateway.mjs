import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { MockRuntime } from '../src/mock-runtime.mjs';
import { SessionContractAuthority } from '../src/session-contract.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import { TOOL_REGISTRY, AGENT_GATEWAY_TOOL_NAMES } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-delivery-gateway-'));
const validator = new ToolInputValidator(TOOL_REGISTRY);
let fixtureNumber = 0;

async function main() {
  try {
    assert.equal(AGENT_GATEWAY_TOOL_NAMES.length, 4, 'Delivery must not introduce a fifth public tool');
    const f = await fixture();
    const source = await f.create();
    const storedSource = await f.bridge.taskStore.getTask(source.task_id, { includePrivate: true });
    assert.equal(storedSource.state, 'completed');
    assert.equal(storedSource.result.kind, 'create_model_result');
    assert.equal(storedSource.result.evidence_level, 'live_runtime', 'The queue branch produces this field; this injected runtime is still only a contract fixture');
    assert.equal(storedSource.result.quality.evidence_level, 'live_runtime');
    assert.equal(storedSource.result.quality_status, 'pass');
    assert.equal(storedSource.result.quality_accepted, true);
    assert.equal(storedSource.private.creation.round.phase, 'verified');
    const frozen = JSON.stringify(storedSource.private.creation.frozen_spec);
    const connection = await f.connect();
    const args = deliveryArgs(source.task_id, connection.task_id, 'first-delivery');
    await assert.rejects(() => call(f.bridge, 'start_agent_task', { ...args, idempotency_key: undefined }), /idempotency_key/);
    const saved = await call(f.bridge, 'start_agent_task', args);
    assert.equal(saved.error, null, JSON.stringify(saved.error));
    assert.equal(saved.task_state, 'completed');
    assert.equal(saved.result.status.evidence_level, 'live_saved_file');
    assert.equal(saved.result.status.quality_status, 'pass');
    const full = await completeResult(f.bridge, saved);
    assert.equal(full.saved, true);
    assert.equal(full.cold_reopen_verified, false);
    assert.equal(full.release_acceptance, false);
    assert.match(full.file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(full.file.bytes, f.runtime.bytes.length);
    assert.equal(f.runtime.saves, 1);
    assert.equal(JSON.stringify((await f.bridge.taskStore.getTask(source.task_id, { includePrivate: true })).private.creation.frozen_spec), frozen);

    const restarted = new SketchUpBridge(f.options);
    const replay = await call(restarted, 'start_agent_task', args);
    assert.equal(replay.idempotent_replay, true);
    assert.equal(replay.task_id, saved.task_id);
    const resumed = await call(restarted, 'resume_agent_task', { task_id: saved.task_id });
    assert.equal(resumed.task_state, 'completed');
    assert.equal(f.runtime.saves, 1);

    const pending = await fixture();
    const pendingSource = await pending.create();
    const waiting = await call(pending.bridge, 'start_agent_task', { intent: 'deliver_model', instruction: 'Wait for a source and connection.',
      idempotency_key: 'pending-delivery', inputs: { runtime: 'queue' } });
    assert.equal(waiting.task_state, 'awaiting_input');
    const untouched = await call(pending.bridge, 'resume_agent_task', { task_id: waiting.task_id });
    assert.equal(untouched.task_state, 'awaiting_input');
    assert.equal(pending.runtime.saves, 0, 'Resume without a saved receipt cannot initiate a save');
    const pendingConnection = await pending.connect();
    const submitArgs = { task_id: waiting.task_id, idempotency_key: 'submit-delivery-source',
      input: { source_task_id: pendingSource.task_id, connection_task_id: pendingConnection.task_id } };
    const missingKey = await call(pending.bridge, 'submit_agent_task_input', { ...submitArgs, idempotency_key: undefined });
    assert.equal(missingKey.error?.code, 'INVALID_ARGUMENT');
    assert.match(missingKey.error.message, /idempotency_key/);
    assert.equal(pending.runtime.saves, 0);
    const submitted = await call(pending.bridge, 'submit_agent_task_input', submitArgs);
    assert.equal(submitted.task_state, 'completed', JSON.stringify(submitted.error));
    assert.equal(submitted.error, null);
    const submittedReplay = await call(pending.bridge, 'submit_agent_task_input', submitArgs);
    assert.equal(submittedReplay.idempotent_replay, true);
    assert.equal(pending.runtime.saves, 1);

    const bad = await fixture();
    const badSource = await bad.create({ requiredPart: 'absent-part' });
    assert.equal(badSource.task_state, 'awaiting_input');
    const badConnection = await bad.connect();
    const denied = await call(bad.bridge, 'start_agent_task', deliveryArgs(badSource.task_id, badConnection.task_id, 'failed-source'));
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'OPERATION_NOT_ALLOWED');
    assert.equal(bad.runtime.saves, 0);

    const uncertain = await fixture();
    const uncertainSource = await uncertain.create();
    const uncertainConnection = await uncertain.connect();
    uncertain.runtime.loseResponse = true;
    const unknownArgs = deliveryArgs(uncertainSource.task_id, uncertainConnection.task_id, 'uncertain-delivery');
    const unknown = await call(uncertain.bridge, 'start_agent_task', unknownArgs);
    assert.equal(unknown.error.code, 'MUTATION_RECOVERY_REQUIRED');
    assert.equal(unknown.result.status.execution_status, 'outcome_unknown');
    assert.equal(uncertain.runtime.saves, 1);
    uncertain.runtime.loseResponse = false;
    await call(uncertain.bridge, 'resume_agent_task', { task_id: unknown.task_id });
    await call(uncertain.bridge, 'start_agent_task', unknownArgs);
    assert.equal(uncertain.runtime.saves, 1, 'An unconfirmed SKP without a receipt must never resave on resume or retry');

    const interrupted = await fixture();
    const interruptedSource = await interrupted.create();
    const interruptedConnection = await interrupted.connect();
    const originalTransition = interrupted.bridge.taskStore.transition.bind(interrupted.bridge.taskStore);
    let throwCompletion = true;
    interrupted.bridge.taskStore.transition = async (taskId, state, options) => {
      if (state === 'completed' && options?.reason === 'accepted_model_saved_to_unique_file' && throwCompletion) {
        throwCompletion = false;
        throw new Error('Synthetic completion interruption after durable save receipt');
      }
      return originalTransition(taskId, state, options);
    };
    const incomplete = await call(interrupted.bridge, 'start_agent_task', deliveryArgs(interruptedSource.task_id, interruptedConnection.task_id, 'receipt-recovery'));
    assert.equal(incomplete.ok, false);
    assert.notEqual(incomplete.task_state, 'failed', 'A durable save receipt needs a resumable task after finalization fails');
    assert.equal(interrupted.runtime.saves, 1);
    interrupted.advanceTime();
    interrupted.runtime.state.document_id = 'another-document-after-save';
    const afterRestart = new SketchUpBridge(interrupted.options);
    const recovered = await call(afterRestart, 'resume_agent_task', { task_id: incomplete.task_id });
    assert.equal(recovered.error, null, JSON.stringify(recovered.error));
    assert.equal(recovered.task_state, 'completed');
    assert.equal((await completeResult(afterRestart, recovered)).replayed, true);
    assert.equal(interrupted.runtime.saves, 1, 'Recovery after receipt persistence is exclusively artifact finalization');

    console.log('model-accessibility-delivery-gateway: four-tool routing, actual creation-result field compatibility, bounded private projections, input recovery, rejected source, start/submit replay, receipt-only finalization and unknown-save no-replay passed; injected fake queue only, no native SKP/live/cold-reopen acceptance');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function fixture() {
  const directory = path.join(root, String(++fixtureNumber));
  let now = Date.parse('2026-09-08T10:00:00Z');
  const runtime = new InjectedQueueFixture(directory);
  const authority = new SessionContractAuthority({ stateDir: path.join(directory, 'session'),
    secret: 'gateway-delivery-session-test-only-over-32-bytes', now: () => now, serverSessionId: `gateway-fixture-${fixtureNumber}` });
  const options = { queueRuntime: runtime, sessionContractAuthority: authority,
    agentContract: { rootDir: path.join(directory, 'tasks') },
    approval: { stateDir: path.join(directory, 'approval'), secret: 'gateway-delivery-approval-test-only-over-32-bytes' },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: false } };
  const bridge = new SketchUpBridge(options);
  const connect = () => call(bridge, 'start_agent_task', { intent: 'discover', instruction: 'Read-only connection fixture.', inputs: { topic: 'connect', runtime: 'queue' } });
  return { bridge, options, runtime, connect, advanceTime: () => { now += 10 * 60 * 1000; },
    create: async ({ requiredPart = 'fixture-part' } = {}) => {
      const connection = await connect();
      return call(bridge, 'start_agent_task', { intent: 'create_model', instruction: 'Contract fixture only: accept an injected queue snapshot.',
        idempotency_key: `create-${fixtureNumber}`, inputs: { runtime: 'queue', connection_task_id: connection.task_id,
          code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', id: 'fixture-part', name: 'Fixture', origin: [0, 0, 0], size: [100, 100, 100] }] }),
          detail_spec: { version: 1, required_parts: [{ id: requiredPart, min_faces: 6 }] } } });
    } };
}

function deliveryArgs(sourceTaskId, connectionTaskId, key) {
  return { intent: 'deliver_model', instruction: 'Save the accepted source into the unique server artifact.', idempotency_key: key,
    inputs: { runtime: 'queue', source_task_id: sourceTaskId, connection_task_id: connectionTaskId } };
}
async function call(bridge, tool, args) {
  validator.validate(tool, args);
  const response = await bridge[tool](args);
  assert.ok(JSON.stringify(response).length <= 4096, `${tool} must fit short context`);
  assertPrivate(response);
  return response;
}
function assertPrivate(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(root), false, 'No local source or delivery path may leak');
  assert.equal(text.includes('hmac_sha256:'), false, 'Signed material stays private');
}
async function completeResult(bridge, response) {
  const handle = response.presentation?.full_result_artifact;
  if (!handle) return response.result;
  let offset = 0, content = '';
  for (let page = 0; page < 100; page++) {
    const read = await call(bridge, 'read_agent_artifact', { handle, task_id: response.task_id, offset, max_chars: 1500 });
    content += read.result.artifact.content;
    if (read.result.artifact.eof) { const document = JSON.parse(content); assertPrivate(document); return document.result; }
    offset = read.result.artifact.next_offset;
  }
  throw new Error('Bounded result-artifact pagination did not finish');
}
function revision(n) { return `sha256:${String(n).padStart(64, '0')}`; }

class InjectedQueueFixture {
  constructor(directory) {
    this.mock = new MockRuntime({ sessionPath: path.join(directory, 'fixture-model.json') });
    const capabilities = getRuntimeCapabilities('queue');
    this.capabilities = { ...capabilities, plugin: { name: 'Injected Queue Contract Fixture', version: PRODUCT_VERSION, sketchup_version: '26.2.242', ruby_version: '3.2' } };
    this.state = { kind: 'queue_session_state', runtime: 'queue', session_id: 'fixture-session', document_id: 'fixture-document',
      model_identity: { model_guid: 'fixture-guid', runtime_object_id: '42', title: 'Fixture', source_path: path.join(directory, 'original.skp') },
      model_revision: revision(1), model_revision_complete: true, model_revision_total_seen: 10, model_revision_indexed: 10,
      model_revision_strategy: capabilities.model_revision.strategy, model_revision_unique_entity_limit: capabilities.model_revision.unique_entity_limit,
      model_modified: false, plugin_version: PRODUCT_VERSION, queue_state: 'idle', capability_version: capabilities.capability_version,
      manifest_version: capabilities.manifest_version, dsl_version: capabilities.dsl_version, occurrence_contract: capabilities.occurrence_contract,
      boolean_operations_sha256: capabilities.boolean_operations_sha256, model_revision_source_sha256: capabilities.model_revision_source_sha256 };
    this.builds = 0; this.saves = 0;
    this.bytes = Buffer.from('Gateway test synthetic bytes, not a native SketchUp file.');
  }
  async getCapabilities() { return structuredClone(this.capabilities); }
  async diagnostics() { return { queue: { count: 0 }, processing: { count: 0 }, responses: { count: 0 }, lock: { exists: false } }; }
  async inspectModel(options) { return this.mock.inspectModel(options); }
  async createFreshHandshakeProbe() { return structuredClone(this.state); }
  async getSessionState() { return structuredClone(this.state); }
  async withExclusiveAccess(callback) { return callback(); }
  async assertIdleForMutation() { return { queue_state: 'idle' }; }
  async withMutationGuard(_guard, callback) { return callback(); }
  async buildModel(code) {
    const snapshot = await this.mock.buildModel(code);
    this.state.model_revision = revision(++this.builds + 1);
    this.state.model_modified = true;
    // Inject the native-shaped return contract solely to reach Gateway save
    // finalization. These fields are synthetic and establish no live evidence.
    for (const group of snapshot.groups || []) group.geometry_evidence = { source: 'sketchup_runtime', measured: true, complete: true, face_count: 6 };
    return { ...snapshot, model_revision: this.state.model_revision, model_revision_complete: true };
  }
  async saveModel({ outputPath, keepSession }) {
    assert.equal(keepSession, true);
    this.saves++;
    await fs.writeFile(outputPath, this.bytes, { flag: 'wx' });
    this.state.model_identity.source_path = outputPath;
    this.state.model_identity.title = 'model';
    this.state.model_modified = false;
    if (this.loseResponse) throw new Error('Synthetic lost save response');
    return { file_path: outputPath };
  }
}

await main();
