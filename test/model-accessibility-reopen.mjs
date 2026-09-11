// Offline API-shaped fixtures only: these fake bytes and lifecycle returns do
// not establish actual SketchUp closure, native appearance or release quality.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SketchUpBridge } from '../src/bridge.mjs';
import { MockRuntime } from '../src/mock-runtime.mjs';
import { SessionContractAuthority } from '../src/session-contract.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import { TOOL_REGISTRY, AGENT_GATEWAY_TOOL_NAMES } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reopen-gateway-offline-'));
const validator = new ToolInputValidator(TOOL_REGISTRY), copy = value => structuredClone(value);
const revision = n => `sha256:${String(n).padStart(64, '0')}`;
let serial = 0;
async function call(bridge, tool, args) {
  validator.validate(tool, args); const result = await bridge[tool](args), text = JSON.stringify(result);
  assert.ok(text.length <= 4096, 'All four tools remain bounded'); assert.equal(text.includes(root), false, 'Private saved paths do not leak');
  assert.equal(text.includes('hmac_sha256:'), false, 'Session signatures do not leak'); return result;
}
class QueueFixture {
  constructor(directory) {
    this.mock = new MockRuntime({ sessionPath: path.join(directory, 'mock.json') });
    const caps = getRuntimeCapabilities('queue');
    this.capabilities = { ...caps, saved_model_lifecycle: { version: 'saved-model-lifecycle.v1', close_reopen_saved_model: true },
      plugin: { name: 'Offline lifecycle fixture', version: PRODUCT_VERSION, sketchup_version: '26.2.242', ruby_version: '3.2' } };
    this.state = { kind: 'queue_session_state', runtime: 'queue', session_id: 'fixture-session', document_id: 'fixture-document',
      model_identity: { model_guid: 'fixture-guid', runtime_object_id: '42', title: 'Fixture', source_path: path.join(directory, 'source.skp') },
      model_revision: revision(1), model_revision_complete: true, model_revision_total_seen: 10, model_revision_indexed: 10,
      model_revision_strategy: caps.model_revision.strategy, model_revision_unique_entity_limit: caps.model_revision.unique_entity_limit,
      model_modified: false, plugin_version: PRODUCT_VERSION, queue_state: 'idle', capability_version: caps.capability_version,
      manifest_version: caps.manifest_version, dsl_version: caps.dsl_version, occurrence_contract: caps.occurrence_contract,
      boolean_operations_sha256: caps.boolean_operations_sha256, model_revision_source_sha256: caps.model_revision_source_sha256 };
    this.closes = 0; this.saves = 0; this.reads = 0; this.bytes = Buffer.from('Offline lifecycle test, not a real SKP.');
  }
  async getCapabilities() { return copy(this.capabilities); }
  async diagnostics() { return { queue: { count: 0 }, processing: { count: 0 }, responses: { count: 0 }, lock: { exists: false } }; }
  async inspectModel(options) { return this.mock.inspectModel(options); }
  async createFreshHandshakeProbe() { return this.getSessionState(); }
  async getSessionState() { this.reads++; if (this.forbidReads) throw new Error('No native reads allowed in receipt-only recovery'); return copy(this.state); }
  async withExclusiveAccess(callback) { return callback(); }
  async assertIdleForMutation() { return { queue_state: 'idle' }; }
  async withMutationGuard(_guard, callback) { return callback(); }
  async buildModel(code) {
    const snapshot = await this.mock.buildModel(code); this.state.model_revision = revision(2); this.state.model_modified = true;
    for (const group of snapshot.groups || []) group.geometry_evidence = { source: 'sketchup_runtime', measured: true, complete: true, face_count: 6 };
    return { ...snapshot, model_revision: revision(2), model_revision_complete: true };
  }
  async saveModel({ outputPath }) {
    this.saves++; await fs.writeFile(outputPath, this.bytes, { flag: 'wx' }); this.state.model_identity.source_path = outputPath; this.state.model_identity.title = 'model'; this.state.model_modified = false;
    return { file_path: outputPath };
  }
  async closeReopenSavedModel(binding) {
    this.closes++; const before = copy(this.state), after = copy(this.state);
    after.document_id = 'reopened-document'; after.model_identity.runtime_object_id = '99';
    if (this.changedRevision) after.model_revision = revision(999);
    if (this.sameHandle) after.model_identity.runtime_object_id = before.model_identity.runtime_object_id;
    if (this.pending) { this.pendingState = after; this.state.document_id = 'temporary-other-document'; this.state.model_identity = { ...this.state.model_identity, source_path: '/offline/other.skp', runtime_object_id: '777' }; }
    else this.state = after;
    if (this.loseResponse) throw new Error('Synthetic lost response after closing/opening');
    const file = { bytes: this.bytes.length, sha256: crypto.createHash('sha256').update(this.bytes).digest('hex') };
    return { kind: 'close_reopen_saved_model', version: 'saved-model-lifecycle.v1', runtime: 'queue', delivery_task_id: binding.delivery_task_id,
      file_path: binding.path, opened: true, open_status: this.pending ? 'pending_mdi_activation' : 'activated',
      close_confirmed: true, close_ignore_changes: false, close_evidence: this.badCloseEvidence ? 'unverified' : 'original_native_model_valid_false_before_open',
      before_document_id: before.document_id, after_document_id: this.pending ? null : after.document_id,
      before, after: this.pending ? null : after, file_before: file, file_after: file,
      new_document_identity_confirmed: !this.pending, reopen_verified: !this.pending && !this.changedRevision && !this.sameHandle,
      application_restarted: false, cold_application_restart: false, mutation_ready: false, requires_fresh_session: true, automatic_retry_allowed: false };
  }
}
async function fixture() {
  const directory = path.join(root, `scenario-${++serial}`); let now = Date.now();
  const runtime = new QueueFixture(directory), authority = new SessionContractAuthority({ stateDir: path.join(directory, 'session'), secret: 'offline-reopen-test-session-over-thirty-two-bytes', now: () => now, serverSessionId: `server-${serial}` });
  const options = { queueRuntime: runtime, sessionContractAuthority: authority, agentContract: { rootDir: path.join(directory, 'tasks') },
    approval: { stateDir: path.join(directory, 'approvals'), secret: 'offline-reopen-test-approval-over-thirty-two-bytes' },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: false } };
  const bridge = new SketchUpBridge(options);
  const connect = () => call(bridge, 'start_agent_task', { intent: 'discover', instruction: 'Offline connection fixture.', inputs: { runtime: 'queue', topic: 'connect' } });
  const connection = await connect();
  const source = await call(bridge, 'start_agent_task', { intent: 'create_model', instruction: 'Injected offline box contract.', idempotency_key: `create-${serial}`, inputs: { runtime: 'queue', connection_task_id: connection.task_id,
    code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', id: 'fixture-part', name: 'Fixture', origin: [0, 0, 0], size: [100, 100, 100] }] }), detail_spec: { version: 1, required_parts: [{ id: 'fixture-part', min_faces: 6 }] } } });
  assert.equal(source.task_state, 'completed', JSON.stringify(source));
  const delivery = await call(bridge, 'start_agent_task', { intent: 'deliver_model', instruction: 'Save isolated fixture.', idempotency_key: `delivery-${serial}`, inputs: { runtime: 'queue', source_task_id: source.task_id, connection_task_id: (await connect()).task_id } });
  assert.equal(delivery.task_state, 'completed', JSON.stringify(delivery));
  const args = async (extra = {}) => ({ intent: 'reopen_delivered_model', instruction: 'Close and disk-reopen only the exact saved delivery document.', idempotency_key: `reopen-${serial}`,
    inputs: { saved_delivery_task_id: delivery.task_id, runtime: 'queue', connection_task_id: (await connect()).task_id, ...extra } });
  return { bridge, options, runtime, source, delivery, connect, args, directory, expire: () => { now += 10 * 60 * 1000; },
    task: id => bridge.taskStore.getTask(id, { includePrivate: true }), journal: id => path.join(options.agentContract.rootDir, 'model-reopens-v1', id) };
}
try {
  assert.equal(AGENT_GATEWAY_TOOL_NAMES.length, 4);
  const taskSchema = JSON.parse(await fs.readFile(new URL('../schema/agent-task-v1.schema.json', import.meta.url)));
  assert.ok(taskSchema.properties.intent.enum.includes('reopen_delivered_model')); assert.ok(taskSchema.properties.intent.enum.includes('apply_native_appearance'));
  const f = await fixture(), args = await f.args();
  await assert.rejects(() => call(f.bridge, 'start_agent_task', { ...args, idempotency_key: undefined }), /idempotency_key/);
  for (const bad of [{ path: '/tmp/another.skp' }, { saved_receipt: {} }, { session_contract: {} }, { code: '{}' }, { runtime: 'mock' }, { timeout_ms: 0 }]) {
    await assert.rejects(() => call(f.bridge, 'start_agent_task', { ...args, inputs: { ...args.inputs, ...bad } }));
  }
  const opened = await call(f.bridge, 'start_agent_task', args);
  assert.equal(opened.task_state, 'completed', JSON.stringify(opened)); const complete = await f.task(opened.task_id);
  assert.equal(complete.result.document_close_reopen_verified, true); assert.equal(complete.result.parameter_rebound, false); assert.equal(complete.result.application_restarted, false);
  assert.equal(complete.result.quality_accepted, false); assert.equal(f.runtime.closes, 1); assert.equal(f.runtime.saves, 1);
  assert.equal((await call(f.bridge, 'start_agent_task', args)).idempotent_replay, true);
  f.runtime.forbidReads = true;
  assert.equal((await call(new SketchUpBridge(f.options), 'resume_agent_task', { task_id: opened.task_id })).task_state, 'completed'); assert.equal(f.runtime.closes, 1);
  const missing = await fixture();
  const waiting = await call(missing.bridge, 'start_agent_task', { intent: 'reopen_delivered_model', instruction: 'Await the original delivery connection.', idempotency_key: 'missing-reopen', inputs: { runtime: 'queue', saved_delivery_task_id: missing.delivery.task_id } });
  assert.equal(waiting.task_state, 'awaiting_input'); await call(missing.bridge, 'resume_agent_task', { task_id: waiting.task_id }); assert.equal(missing.runtime.closes, 0);
  const connection = await missing.connect(), submission = { task_id: waiting.task_id, idempotency_key: 'fill-connection', input: { connection_task_id: connection.task_id } };
  assert.equal((await call(missing.bridge, 'submit_agent_task_input', { ...submission, idempotency_key: undefined })).error.code, 'INVALID_ARGUMENT');
  assert.equal((await call(missing.bridge, 'submit_agent_task_input', { ...submission, input: { saved_delivery_task_id: missing.source.task_id } })).error.code, 'INVALID_ARGUMENT');
  assert.equal((await call(missing.bridge, 'submit_agent_task_input', submission)).task_state, 'completed');
  assert.equal((await call(missing.bridge, 'submit_agent_task_input', submission)).idempotent_replay, true); assert.equal(missing.runtime.closes, 1);
  for (const obstacle of ['dirty', 'revision', 'identity', 'capability', 'expiry', 'file', 'policy', 'source']) {
    const bad = await fixture(); let request;
    if (obstacle === 'dirty') bad.runtime.state.model_modified = true;
    if (obstacle === 'revision') bad.runtime.state.model_revision = revision(55);
    if (obstacle === 'identity') bad.runtime.state.document_id = 'wrong-current-document';
    if (obstacle === 'capability') bad.runtime.capabilities.saved_model_lifecycle.close_reopen_saved_model = false;
    request = await bad.args();
    if (obstacle === 'policy') bad.bridge.executionPolicy.allow_queue_mutation = false;
    if (obstacle === 'source') request.inputs.saved_delivery_task_id = bad.source.task_id;
    if (obstacle === 'expiry') bad.expire();
    if (obstacle === 'file') await fs.appendFile(bad.runtime.state.model_identity.source_path, 'tampered');
    const rejected = await call(bad.bridge, 'start_agent_task', request); assert.ok(rejected.error, obstacle); assert.equal(rejected.task_state, 'awaiting_input', obstacle);
    assert.equal(bad.runtime.closes, 0); assert.equal(await fs.lstat(bad.journal(rejected.task_id)).then(() => true).catch(error => { assert.equal(error.code, 'ENOENT'); return false; }), false, `${obstacle} must not consume a lifecycle claim`);
  }
  const pending = await fixture(); pending.runtime.pending = true;
  const pendingTask = await call(pending.bridge, 'start_agent_task', await pending.args()); assert.equal((await pending.task(pendingTask.task_id)).result.stage, 'pending_mdi_activation');
  const reads = pending.runtime.reads; await call(pending.bridge, 'resume_agent_task', { task_id: pendingTask.task_id }); assert.equal(pending.runtime.reads - reads, 1); assert.equal(pending.runtime.closes, 1);
  pending.runtime.state = copy(pending.runtime.pendingState); pending.runtime.state.model_modified = true;
  await call(pending.bridge, 'resume_agent_task', { task_id: pendingTask.task_id }); assert.equal((await pending.task(pendingTask.task_id)).result.document_close_reopen_verified, false);
  pending.runtime.state.model_modified = false;
  assert.equal((await call(pending.bridge, 'resume_agent_task', { task_id: pendingTask.task_id })).task_state, 'completed'); assert.equal(pending.runtime.closes, 1);
  for (const defect of ['loseResponse', 'changedRevision', 'sameHandle', 'badCloseEvidence']) {
    const uncertain = await fixture(); uncertain.runtime[defect] = true; const first = await call(uncertain.bridge, 'start_agent_task', await uncertain.args());
    assert.ok(first.error, defect); assert.equal((await uncertain.task(first.task_id)).result.document_close_reopen_verified, false);
    const readsBefore = uncertain.runtime.reads; await call(new SketchUpBridge(uncertain.options), 'resume_agent_task', { task_id: first.task_id });
    assert.equal(uncertain.runtime.closes, 1); assert.equal(uncertain.runtime.reads, readsBefore, `${defect} must not use another native call as substitute evidence`);
  }
  const interrupted = await fixture(), originalTransition = interrupted.bridge.taskStore.transition.bind(interrupted.bridge.taskStore); let once = true;
  interrupted.bridge.taskStore.transition = async (id, state, options) => { if (once && state === 'completed' && options?.reason === 'saved_document_close_reopen_verified') { once = false; throw new Error('Synthetic completion response loss'); } return originalTransition(id, state, options); };
  const unfinished = await call(interrupted.bridge, 'start_agent_task', await interrupted.args()); assert.ok(unfinished.error); interrupted.runtime.forbidReads = true;
  assert.equal((await call(new SketchUpBridge(interrupted.options), 'resume_agent_task', { task_id: unfinished.task_id })).task_state, 'completed'); assert.equal(interrupted.runtime.closes, 1);
  const corrupted = await fixture(); corrupted.runtime.pending = true;
  const started = await call(corrupted.bridge, 'start_agent_task', await corrupted.args()); const journal = path.join(corrupted.journal(started.task_id), 'native-return.json');
  const record = JSON.parse(await fs.readFile(journal)); record.result.open_status = 'activated'; await fs.writeFile(journal, JSON.stringify(record));
  const rejected = await call(corrupted.bridge, 'resume_agent_task', { task_id: started.task_id }); assert.ok(rejected.error); assert.equal(corrupted.runtime.closes, 1);
  console.log('model-accessibility-reopen: four tools, source freeze, fresh connection, preclaim rejects, exact native return, pending read-only activation, HMAC/durable receipt recovery and no close replay passed. Offline injected queue only; no native SKP, actual application closure, visual or release acceptance.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
