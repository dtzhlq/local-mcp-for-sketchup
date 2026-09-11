import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deliverModelAccessibilityTask, readVerifiedModelAccessibilitySavedReceipt } from '../src/model-accessibility-delivery.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { SessionContractAuthority } from '../src/session-contract.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { freezeDetailSpecification } from '../src/detail-quality.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-delivery-'));
let fixtureNumber = 0;

async function main() {
try {
  const f = await fixture();
  const frozenBefore = JSON.stringify((await f.store.getTask(f.source.task_id, { includePrivate: true })).private.creation.frozen_spec);
  const delivered = await f.deliver();
  assert.equal(delivered.saved, true);
  assert.equal(delivered.cold_reopen_verified, false);
  assert.equal(delivered.release_acceptance, false);
  assert.equal(delivered.file.bytes, f.runtime.bytes.length);
  assert.equal(delivered.file.sha256, crypto.createHash('sha256').update(f.runtime.bytes).digest('hex'));
  assert.match(delivered.artifact.handle, /^artifact:task_/);
  assert.equal(f.runtime.saves, 1);
  assert.equal(f.runtime.lastSave.keepSession, true, 'Saving must never reset or close the model');
  assert.equal(f.runtime.guards[0].handshake_id, f.contract.handshake_id);
  assert.equal(JSON.stringify(delivered).includes(f.store.rootDir), false, 'No storage path is exposed in the public result');
  assert.equal(JSON.stringify(delivered).includes('hmac'), false);
  assert.equal(JSON.stringify((await f.store.getTask(f.source.task_id, { includePrivate: true })).private.creation.frozen_spec), frozenBefore);
  const target = path.join(await fs.realpath(f.store.rootDir), 'model-deliveries-v1', f.destination.task_id, 'model.skp');
  assert.equal(f.runtime.lastSave.outputPath, target);
  assert.equal((await readVerifiedModelAccessibilitySavedReceipt({ taskStore: f.store, deliveryTaskId: f.destination.task_id })).parameter_continuation_available, false);
  await assert.rejects(() => f.bridge.save_model({ path: path.join(root, 'unauthorized.skp'), runtime: 'queue', session_contract: f.contract }), error => error.code === 'POLICY_DENIED');

  // A durable completion resumes without touching the current model, even
  // after restart, active-document changes and expiry of the saved connection.
  f.advanceTime();
  f.runtime.state.document_id = 'different-document-after-save';
  const restartedBridge = new SketchUpBridge(f.options);
  const replay = await f.deliver({ bridge: restartedBridge, taskStore: restartedBridge.taskStore });
  assert.equal(replay.replayed, true);
  assert.equal(replay.artifact.handle, delivered.artifact.handle);
  assert.equal(f.runtime.saves, 1);
  await fs.appendFile(target, 'unexpected external change');
  await assert.rejects(() => f.deliver(), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  assert.equal(f.runtime.saves, 1);

  const policy = await fixture({ allowSave: false });
  await assert.rejects(() => policy.deliver(), hasCode('POLICY_DENIED'));
  assert.equal(policy.runtime.saves, 0);

  const arbitraryPath = await fixture();
  await arbitraryPath.store.update(arbitraryPath.destination.task_id, { inputs: { ...arbitraryPath.destination.inputs, path: path.join(root, 'user-source.skp') } });
  await assert.rejects(() => arbitraryPath.deliver(), hasCode('INVALID_ARGUMENT'));
  assert.equal(arbitraryPath.runtime.saves, 0);

  const mockClaim = await fixture();
  await mockClaim.store.update(mockClaim.source.task_id, { result: { ...mockClaim.source.result, evidence_level: 'offline_mock' } });
  await assert.rejects(() => mockClaim.deliver(), hasCode('OPERATION_NOT_ALLOWED'));
  assert.equal(mockClaim.runtime.saves, 0);

  const frozen = await fixture();
  const changedPrivate = structuredClone(frozen.source.private);
  changedPrivate.creation.frozen_spec.specification.required_parts[0].id = 'weakened-rule';
  await frozen.store.update(frozen.source.task_id, { private: changedPrivate });
  await assert.rejects(() => frozen.deliver(), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  assert.equal(frozen.runtime.saves, 0);

  const changed = await fixture();
  changed.runtime.state.model_revision = revision(2);
  await changed.refreshConnection();
  await assert.rejects(() => changed.deliver(), hasCode('MODEL_REVISION_MISMATCH'));
  assert.equal(changed.runtime.saves, 0, 'Even a valid fresh connection cannot save a changed source as accepted');

  const document = await fixture();
  document.runtime.state.document_id = 'another-source-document';
  await document.refreshConnection();
  await assert.rejects(() => document.deliver(), hasCode('MODEL_IDENTITY_MISMATCH'));
  assert.equal(document.runtime.saves, 0);

  const expired = await fixture();
  expired.advanceTime();
  await assert.rejects(() => expired.deliver(), hasCode('HANDSHAKE_EXPIRED'));
  assert.equal(expired.runtime.saves, 0);
  await expired.refreshConnection();
  assert.equal((await expired.deliver()).saved, true, 'A pre-dispatch expiry creates no save claim and can be corrected');

  const uncertain = await fixture();
  uncertain.runtime.loseResponse = true;
  await assert.rejects(() => uncertain.deliver(), hasCode('MUTATION_RECOVERY_REQUIRED'));
  assert.equal(uncertain.runtime.saves, 1);
  const unknownDir = path.join(await fs.realpath(uncertain.store.rootDir), 'model-deliveries-v1', uncertain.destination.task_id);
  const unknownBytes = await fs.readFile(path.join(unknownDir, 'model.skp'));
  assert.deepEqual(unknownBytes, uncertain.runtime.bytes);
  uncertain.runtime.loseResponse = false;
  await assert.rejects(() => uncertain.deliver(), hasCode('MUTATION_RECOVERY_REQUIRED'));
  assert.equal(uncertain.runtime.saves, 1, 'A file left after an unknown response does not authorize a second save');
  const intentPath = path.join(unknownDir, 'save-intent.json');
  const tampered = JSON.parse(await fs.readFile(intentPath, 'utf8'));
  tampered.source_binding.model_revision = revision(99);
  await fs.writeFile(intentPath, JSON.stringify(tampered));
  await assert.rejects(() => uncertain.deliver(), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  assert.deepEqual(await fs.readFile(path.join(unknownDir, 'model.skp')), unknownBytes);

  const registration = await fixture();
  const originalRegister = registration.store.registerArtifact.bind(registration.store);
  let failedRegistration = false;
  registration.store.registerArtifact = async (...args) => {
    if (!failedRegistration) { failedRegistration = true; throw new Error('Synthetic post-receipt registration interruption'); }
    return originalRegister(...args);
  };
  assert.equal((await registration.deliver()).saved, true);
  assert.equal(registration.runtime.saves, 1, 'Post-receipt finalization recovery must not save again');

  const symlink = await fixture();
  const privateRoot = path.join(await fs.realpath(symlink.store.rootDir), 'model-deliveries-v1');
  await fs.mkdir(privateRoot, { mode: 0o700 });
  await fs.symlink(root, path.join(privateRoot, symlink.destination.task_id));
  await assert.rejects(() => symlink.deliver(), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  assert.equal(symlink.runtime.saves, 0);

  const verified = await fixture({ verified: true });
  const verifiedDelivery = await verified.deliver();
  assert.equal(verifiedDelivery.saved, true);
  const verifiedReceipt = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: verified.store, deliveryTaskId: verified.destination.task_id });
  assert.equal(verifiedReceipt.parameter_binding.source_record_hash, verified.source.private.frozen_creation_verification.parameter_source_hash);
  assert.equal(verifiedReceipt.parameter_binding_evidence, 'signed_save_intent_and_receipt');
  const original = await verified.store.getTask(verified.source.private.frozen_creation_verification.creation_task_id, { includePrivate: true });
  await verified.store.update(original.task_id, { private: { ...original.private, creation: { ...original.private.creation,
    parameter_source: { ...original.private.creation.parameter_source, source_record_hash: revision(88) } } } });
  assert.equal((await verified.deliver()).replayed, true, 'A completed file receipt remains replayable after the original parameter source advances');
  assert.equal(verified.runtime.saves, 1);
  const forgedVerification = await fixture({ verified: true });
  const forgedPrivate = structuredClone(forgedVerification.source.private);
  forgedPrivate.frozen_creation_verification.parameter_source_hash = revision(77);
  await forgedVerification.store.update(forgedVerification.source.task_id, { private: forgedPrivate });
  await assert.rejects(() => forgedVerification.deliver(), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  assert.equal(forgedVerification.runtime.saves, 0);

  const legacy = await fixture();
  await legacy.deliver(); // Simulate the old receipt format without metadata.
  const legacyRecord = { version: 'model-accessibility-parameter-source.v1', creation_task_id: legacy.source.task_id, runtime: 'queue', parameter_revision: 0,
    entries: [{ fixture: true }], model_key: `model_${'1'.repeat(32)}`, initial_model_revision: legacy.runtime.state.model_revision };
  const legacySource = await legacy.store.getTask(legacy.source.task_id, { includePrivate: true });
  await legacy.store.update(legacySource.task_id, { private: { ...legacySource.private, creation: { ...legacySource.private.creation,
    parameter_source: { ...legacyRecord, source_record_hash: sha256Canonical(legacyRecord) },
    parameter_edit_support: { baseline_captured: true, evidence_level: 'trusted_immediate_creation_readback' } } } });
  const legacyProof = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: legacy.store, deliveryTaskId: legacy.destination.task_id });
  assert.equal(legacyProof.parameter_binding_evidence, 'legacy_signed_initial_revision_and_server_creation_baseline');
  assert.equal(legacyProof.parameter_binding.source_record_hash, sha256Canonical(legacyRecord));

  console.log('model-accessibility-delivery: signed save intent, source/revision/frozen-quality checks, unique files, expiry, policy, hash replay, unknown-response no-resave, tamper and symlink gates passed; fake queue tests only, no live/cold-reopen claim');
} finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function fixture({ allowSave = true, verified = false } = {}) {
  const directory = path.join(root, String(++fixtureNumber));
  let now = Date.parse('2026-09-08T09:00:00.000Z');
  const runtime = new FakeSaveRuntime(path.join(directory, 'original.skp'));
  const authority = new SessionContractAuthority({ stateDir: path.join(directory, 'session'),
    secret: 'delivery-test-only-signing-secret-over-32-bytes', now: () => now, serverSessionId: `fixture-${fixtureNumber}` });
  const options = { queueRuntime: runtime, sessionContractAuthority: authority,
    agentContract: { rootDir: path.join(directory, 'tasks') },
    approval: { stateDir: path.join(directory, 'approval'), secret: 'delivery-test-approval-secret-over-32-bytes' },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: allowSave, allow_direct_expert_queue_mutation: false } };
  const bridge = new SketchUpBridge(options), store = bridge.taskStore;
  let contract = await authority.issue(runtime.state);
  const frozen_spec = freezeDetailSpecification({ version: 1, required_parts: [{ id: 'fixture-part', min_faces: 6 }], required_views: [{ id: 'fixture-view' }] });
  const snapshot = { model_revision: runtime.state.model_revision, model_revision_complete: true };
  const quality = { quality_status: 'pass', quality_accepted: true, evidence_level: 'live_runtime', specification_hash: frozen_spec.hash, remaining: [] };
  // Trusted fixture setup directly creates accepted server state. It tests
  // delivery authorization/persistence, not whether this fake geometry passes.
  let source = (await store.createTask({ intent: 'create_model', instruction: 'Server-owned accepted source fixture.',
    executionPolicy: bridge.executionPolicy, inputs: { runtime: 'queue', session_contract: contract } })).task;
  await store.transition(source.task_id, 'understanding');
  source = await store.transition(source.task_id, 'completed', { patch: {
    result: { kind: 'create_model_result', snapshot, ...quality, quality },
    private: { creation: { runtime: 'queue', frozen_spec, round: { snapshot, captures: [{ id: 'fixture-view', server_verified: true, model_revision: snapshot.model_revision }] } } }
  } });
  if (verified) {
    const parameter_source = { creation_task_id: source.task_id, source_record_hash: revision(8), model_key: `model_${'1'.repeat(32)}`, runtime: 'queue', parameter_revision: 1 };
    source = await store.update(source.task_id, { private: { ...source.private, creation: { ...source.private.creation, parameter_source } } });
    let parameter = (await store.createTask({ intent: 'modify_design_parameters', instruction: 'Completed parameter fixture.', executionPolicy: bridge.executionPolicy,
      inputs: { parameter_edit: { creation_task_id: source.task_id } } })).task;
    await store.transition(parameter.task_id, 'understanding');
    parameter = await store.transition(parameter.task_id, 'completed', { patch: { result: { model_revision: snapshot.model_revision } } });
    const body = { version: 'frozen-creation-verification.v1', creation_task_id: source.task_id, parameter_task_id: parameter.task_id,
      specification_hash: frozen_spec.hash, parameter_source_hash: parameter_source.source_record_hash, model_revision: snapshot.model_revision };
    const proof = { ...body, integrity_hmac: await store.mutationReceiptLedger.sign(body) };
    let verification = (await store.createTask({ intent: 'verify_model', instruction: 'Signed frozen verification fixture.', executionPolicy: bridge.executionPolicy,
      inputs: { runtime: 'queue', session_contract: contract, creation_task_id: source.task_id, parameter_task_id: parameter.task_id } })).task;
    await store.transition(verification.task_id, 'understanding');
    source = await store.transition(verification.task_id, 'completed', { patch: {
      result: { ...source.result, kind: 'verify_creation_result' }, private: { ...source.private, frozen_creation_verification: proof } } });
  }
  const inputs = { runtime: 'queue', source_task_id: source.task_id, session_contract: contract };
  let destination = (await store.createTask({ intent: 'deliver_model', instruction: 'Deliver the server source.', executionPolicy: bridge.executionPolicy, inputs })).task;
  destination = await store.transition(destination.task_id, 'understanding');
  return { bridge, store, options, runtime, source, destination, get contract() { return contract; },
    advanceTime: () => { now += 10 * 60 * 1000; },
    refreshConnection: async () => {
      contract = await authority.issue(runtime.state);
      destination = await store.update(destination.task_id, { inputs: { ...destination.inputs, session_contract: contract } });
    },
    deliver: (overrides = {}) => deliverModelAccessibilityTask({ bridge, taskStore: store, taskId: destination.task_id,
      sourceTaskId: source.task_id, sessionContract: contract, timeoutMs: 10000, ...overrides }) };
}

function revision(n) { return `sha256:${String(n).padStart(64, '0')}`; }
function hasCode(code) { return error => error.code === code; }

class FakeSaveRuntime {
  constructor(sourcePath) {
    const capabilities = getRuntimeCapabilities('queue');
    this.capabilities = { ...capabilities, plugin: { name: 'Fake Save Queue', version: PRODUCT_VERSION, sketchup_version: '26.2.242', ruby_version: '3.2' } };
    this.state = { kind: 'queue_session_state', runtime: 'queue', session_id: 'fixture-session', document_id: 'fixture-document',
      model_identity: { model_guid: 'fixture-guid', runtime_object_id: '1234', title: 'Original', source_path: sourcePath },
      model_revision: revision(1), model_revision_complete: true, model_revision_total_seen: 10, model_revision_indexed: 10,
      model_revision_strategy: capabilities.model_revision.strategy, model_revision_unique_entity_limit: capabilities.model_revision.unique_entity_limit,
      model_modified: true, plugin_version: PRODUCT_VERSION, queue_state: 'idle', capability_version: capabilities.capability_version,
      manifest_version: capabilities.manifest_version, dsl_version: capabilities.dsl_version, occurrence_contract: capabilities.occurrence_contract,
      boolean_operations_sha256: capabilities.boolean_operations_sha256, model_revision_source_sha256: capabilities.model_revision_source_sha256 };
    this.saves = 0; this.guards = [];
    this.bytes = Buffer.from('Synthetic SketchUp save fixture: not a native SKP or geometry acceptance.');
  }
  async getCapabilities() { return structuredClone(this.capabilities); }
  async getSessionState() { return structuredClone(this.state); }
  async withExclusiveAccess(callback) { return callback(); }
  async assertIdleForMutation() { return { queue_state: 'idle' }; }
  async withMutationGuard(guard, callback) { this.guards.push(structuredClone(guard)); return callback(); }
  async saveModel(options) {
    this.saves++; this.lastSave = structuredClone(options);
    await fs.writeFile(options.outputPath, this.bytes, { flag: 'wx' });
    this.state.model_identity.source_path = options.outputPath;
    this.state.model_identity.title = 'model';
    this.state.model_modified = false;
    if (this.loseResponse) throw new Error('Synthetic response loss after writing the file');
    return { file_path: options.outputPath };
  }
}

await main();
