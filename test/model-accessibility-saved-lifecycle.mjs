import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import { SessionContractAuthority } from '../src/session-contract.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { readVerifiedModelAccessibilitySavedReceipt, MODEL_ACCESSIBILITY_DELIVERY_VERSION } from '../src/model-accessibility-delivery.mjs';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'saved-lifecycle-offline-')));
let number = 0;
try {
  const f = await fixture();
  const result = await f.invoke();
  assert.equal(result.reopen_verified, true);
  assert.equal(result.application_restarted, false);
  assert.equal(f.runtime.calls.length, 1);
  assert.deepEqual(f.runtime.calls[0], { path: f.receipt.file_path, source_sha256: f.receipt.file.sha256, source_bytes: f.receipt.file.bytes,
    session_id: f.state.session_id, document_id: f.state.document_id, model_identity: f.receipt.after_identity,
    model_revision: f.receipt.post_save_revision, delivery_task_id: f.receipt.delivery_task_id });
  assert.equal(f.runtime.guards[0].model_modified, false);
  assert.equal(f.runtime.guards[0].document_id, f.state.document_id);
  assert.equal(f.runtime.guards[0].model_revision, f.receipt.post_save_revision);

  for (const fake of [{}, structuredClone(f.receipt)]) await assert.rejects(() => f.invoke({ saved_receipt: fake }), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  await assert.rejects(async () => f.bridge.close_reopen_saved_model({ saved_receipt: f.receipt, session_contract: await f.authority.issue(f.state) }), hasCode('POLICY_DENIED'));
  await assert.rejects(() => f.invoke({ runtime: 'mock' }), hasCode('POLICY_DENIED'));
  assert.equal(f.runtime.calls.length, 1);

  const denied = await fixture({ allowed: false });
  await assert.rejects(() => denied.invoke(), hasCode('POLICY_DENIED'));
  assert.equal(denied.runtime.calls.length, 0);

  for (const change of [state => { state.model_modified = true; }, state => { state.model_modified = null; },
    state => { state.model_revision_complete = false; }, state => { state.model_revision = `sha256:${'b'.repeat(64)}`; }]) {
    const changed = await fixture(); change(changed.state);
    await assert.rejects(() => changed.invoke(), error => ['MODEL_REVISION_MISMATCH', 'MODEL_REVISION_INCOMPLETE', 'HANDSHAKE_INVALID'].includes(error.code));
    assert.equal(changed.runtime.calls.length, 0);
  }
  for (const change of [state => { state.document_id = 'different-native-document'; }, state => { state.session_id = 'different-session'; },
    state => { state.model_identity.runtime_object_id = '999'; }, state => { state.model_identity.source_path = path.join(root, 'another.skp'); }]) {
    const changed = await fixture(); change(changed.state);
    await assert.rejects(() => changed.invoke(), hasCode('MODEL_IDENTITY_MISMATCH'));
    assert.equal(changed.runtime.calls.length, 0);
  }
  const staleFile = await fixture();
  await fs.appendFile(staleFile.receipt.file_path, 'external file change');
  await assert.rejects(() => staleFile.invoke(), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  assert.equal(staleFile.runtime.calls.length, 0);
  const tampered = await fixture(); tampered.receipt.post_save_revision = `sha256:${'c'.repeat(64)}`;
  await assert.rejects(() => tampered.invoke(), hasCode('ARTIFACT_INTEGRITY_ERROR'));
  assert.equal(tampered.runtime.calls.length, 0);
  const oldPlugin = await fixture(); delete oldPlugin.runtime.capabilities.saved_model_lifecycle;
  await assert.rejects(() => oldPlugin.invoke(), hasCode('OPERATION_NOT_ALLOWED'));
  assert.equal(oldPlugin.runtime.calls.length, 0);
  const missingConnection = await fixture();
  await assert.rejects(() => missingConnection.invoke({ session_contract: null }), hasCode('HANDSHAKE_REQUIRED'));
  assert.equal(missingConnection.runtime.calls.length, 0);

  const pending = await fixture(); pending.runtime.pending = true;
  const waiting = await pending.invoke();
  assert.equal(waiting.open_status, 'pending_mdi_activation');
  assert.equal(waiting.reopen_verified, false);
  assert.equal(waiting.after_document_id, null);
  assert.equal(pending.runtime.calls.length, 1);
  const interrupted = await fixture(); interrupted.runtime.loseResponse = true;
  await assert.rejects(() => interrupted.invoke(), /synthetic native response loss/);
  assert.equal(interrupted.runtime.calls.length, 1, 'The transport does not retry after unknown close/open outcome');
  const invalid = await fixture(); invalid.runtime.badResponse = true;
  await assert.rejects(() => invalid.invoke(), hasCode('MUTATION_RECOVERY_REQUIRED'));
  assert.equal(invalid.runtime.calls.length, 1);

  await checkQueueGuardTransport();
  console.log(JSON.stringify({ ok: true, native_model_called: false, offline_fixture_only: true, receipt_brand_and_integrity: true,
    fresh_session: true, dirty_revision_identity_file_guards: true, pending_mdi_no_pass: true, unknown_response_no_retry: true,
    transport_invalidates_old_contract: true, live_reopen_verified: false }));
} finally { await fs.rm(root, { recursive: true, force: true }); }

function hasCode(code) { return error => error.code === code; }
async function fixture({ allowed = true } = {}) {
  const directory = path.join(root, String(++number));
  const capabilities = { ...getRuntimeCapabilities('queue'), plugin: { version: PRODUCT_VERSION, sketchup_version: '26.2.242' } };
  const state = { kind: 'queue_session_state', runtime: 'queue', session_id: 'fixture-session', document_id: 'fixture-saved-document',
    model_identity: { model_guid: 'fixture-guid', runtime_object_id: '123', title: 'model', source_path: '' },
    model_revision: `sha256:${'a'.repeat(64)}`, model_revision_complete: true, model_revision_total_seen: 10, model_revision_indexed: 10,
    model_revision_strategy: capabilities.model_revision.strategy, model_revision_unique_entity_limit: capabilities.model_revision.unique_entity_limit,
    model_modified: false, plugin_version: PRODUCT_VERSION, queue_state: 'idle', capability_version: capabilities.capability_version,
    manifest_version: capabilities.manifest_version, dsl_version: capabilities.dsl_version, occurrence_contract: capabilities.occurrence_contract,
    boolean_operations_sha256: capabilities.boolean_operations_sha256, model_revision_source_sha256: capabilities.model_revision_source_sha256 };
  const runtime = { capabilities, calls: [], guards: [],
    async getCapabilities() { return structuredClone(this.capabilities); }, async getSessionState() { return structuredClone(state); },
    async withExclusiveAccess(callback) { return callback(); }, async assertIdleForMutation() {},
    async withMutationGuard(guard, callback) { this.guards.push(structuredClone(guard)); return callback(); },
    async closeReopenSavedModel(binding) {
      this.calls.push(structuredClone(binding));
      if (this.loseResponse) throw new Error('synthetic native response loss');
      if (this.badResponse) return { close_confirmed: true };
      return { kind: 'close_reopen_saved_model', version: 'saved-model-lifecycle.v1', delivery_task_id: binding.delivery_task_id,
        close_confirmed: true, close_ignore_changes: false, before_document_id: binding.document_id,
        after_document_id: this.pending ? null : 'fixture-new-document', file_after: { bytes: binding.source_bytes, sha256: binding.source_sha256 },
        open_status: this.pending ? 'pending_mdi_activation' : 'activated', reopen_verified: !this.pending, application_restarted: false };
    }
  };
  const authority = new SessionContractAuthority({ stateDir: path.join(directory, 'sessions'), secret: 'saved-lifecycle-fixture-secret-more-than-32-bytes', serverSessionId: `fixture-${number}` });
  const bridge = new SketchUpBridge({ queueRuntime: runtime, sessionContractAuthority: authority, agentContract: { rootDir: path.join(directory, 'tasks') },
    approval: { stateDir: path.join(directory, 'approvals'), secret: 'saved-lifecycle-fixture-approval-secret-more-than-32-bytes' },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: allowed, allow_direct_expert_queue_mutation: false } });
  const store = bridge.taskStore;
  const source = (await store.createTask({ intent: 'create_model', instruction: 'Trusted offline receipt setup', inputs: {}, executionPolicy: bridge.executionPolicy })).task;
  const delivery = (await store.createTask({ intent: 'deliver_model', instruction: 'Trusted offline receipt setup', inputs: { source_task_id: source.task_id }, executionPolicy: bridge.executionPolicy })).task;
  const deliveries = path.join(await fs.realpath(store.rootDir), 'model-deliveries-v1');
  await fs.mkdir(deliveries, { mode: 0o700 });
  const saved = path.join(deliveries, delivery.task_id); await fs.mkdir(saved, { mode: 0o700 });
  const target = path.join(saved, 'model.skp'), bytes = Buffer.from('Synthetic saved lifecycle fixture; not real SKP geometry.');
  await fs.writeFile(target, bytes); state.model_identity.source_path = target;
  // Only fixture code writes these trusted HMAC records. This establishes
  // transport authorization tests and makes no live geometry/quality claim.
  const immutable = { version: MODEL_ACCESSIBILITY_DELIVERY_VERSION, delivery_task_id: delivery.task_id, source_task_id: source.task_id,
    source_binding: { session_id: state.session_id, document_id: state.document_id, model_revision: state.model_revision }, filename: 'model.skp' };
  const intent = { ...immutable, kind: 'save_intent' };
  const receiptBody = { ...immutable, kind: 'saved_receipt', save_confirmed: true, post_save_revision: state.model_revision,
    after_identity: structuredClone(state.model_identity), save_intent_hash: sha256Canonical(intent),
    file: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
  for (const [name, body] of [['save-intent.json', intent], ['saved-receipt.json', receiptBody]]) {
    await fs.writeFile(path.join(saved, name), JSON.stringify({ ...body, integrity_hmac: await store.mutationReceiptLedger.sign(body) }), { mode: 0o600 });
  }
  const receipt = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: store, deliveryTaskId: delivery.task_id });
  return { receipt, bridge, state, authority, runtime,
    async invoke(overrides = {}) { return bridge.withAgentGatewayExecution({ taskId: delivery.task_id, intent: 'reopen_delivered_model' }, async scoped => scoped.close_reopen_saved_model({
      saved_receipt: receipt, session_contract: await authority.issue(state), ...overrides })); } };
}

async function checkQueueGuardTransport() {
  const directory = path.join(root, 'queue-transport');
  const runtime = new QueueRuntime({ queueDir: path.join(directory, 'queue'), processingDir: path.join(directory, 'processing'),
    responseDir: path.join(directory, 'responses'), timeoutMs: 1000, pollIntervalMs: 5 });
  const requests = [];
  const responder = (async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const names = await fs.readdir(runtime.queueDir).catch(() => []);
      if (names.length) {
        const name = names[0], request = JSON.parse(await fs.readFile(path.join(runtime.queueDir, name), 'utf8')); requests.push(request);
        await fs.rename(path.join(runtime.queueDir, name), path.join(runtime.processingDir, name));
        await fs.writeFile(path.join(runtime.responseDir, name), JSON.stringify({ result: { close_confirmed: true, open_status: 'pending_mdi_activation' } }));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Offline responder did not observe a lifecycle request');
  })();
  const guard = { session_id: 'fixture', document_id: 'saved', model_revision: `sha256:${'a'.repeat(64)}`, model_modified: false };
  await runtime.withMutationGuard(guard, async () => {
    await runtime.closeReopenSavedModel({ path: '/server-fixture/model.skp', model_revision: guard.model_revision });
    await assert.rejects(() => runtime.closeReopenSavedModel({}), error => error.code === 'HANDSHAKE_DOCUMENT_MISMATCH' && error.details.invalidated_by === 'close_reopen_saved_model');
    await assert.rejects(() => runtime.saveModel({ outputPath: '/never-dispatched.skp' }), hasCode('HANDSHAKE_DOCUMENT_MISMATCH'));
  });
  await responder;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'close_reopen_saved_model');
  assert.deepEqual(requests[0].params._session_guard, guard);
  assert.deepEqual(await fs.readdir(runtime.queueDir), []);
}
