import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';
import { freezeDetailSpecification } from './detail-quality.mjs';
import { readNativeAppearanceSavedProvenance } from './model-accessibility-appearance-receipt.mjs';

export const MODEL_ACCESSIBILITY_DELIVERY_VERSION = 'model-accessibility-delivery.v1';
const TASK_ID = /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^sha256:[0-9a-f]{64}$/;
const INPUT_FIELDS = new Set(['source_task_id', 'connection_task_id', 'session_contract', 'runtime', 'timeout_ms']);
const verifiedSavedReceipts = new WeakMap();

/** Server helper. A saved file is not a cold-reopen or cross-model acceptance. */
export async function deliverModelAccessibilityTask({ bridge, taskStore, taskId, sourceTaskId, sessionContract, timeoutMs = 120000 } = {}) {
  if (!bridge || !taskStore?.mutationReceiptLedger || !TASK_ID.test(taskId || '') || !TASK_ID.test(sourceTaskId || '')) fail('INVALID_ARGUMENT', 'Delivery requires server task storage and valid delivery/source task ids.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) fail('INVALID_ARGUMENT', 'Delivery timeout must be an integer from 1 to 300000 ms.');
  const destinationTask = await taskStore.getTask(taskId, { includePrivate: true });
  if (destinationTask.intent !== 'deliver_model' || destinationTask.inputs?.source_task_id !== sourceTaskId) fail('INVALID_ARGUMENT', 'Delivery must use its persisted source-task binding.');
  if (Object.keys(destinationTask.inputs || {}).some(key => !INPUT_FIELDS.has(key))) fail('INVALID_ARGUMENT', 'Delivery accepts only a source task and connection; file paths, overwrite and model edits are not accepted.');
  if (destinationTask.inputs.runtime !== undefined && destinationTask.inputs.runtime !== 'queue') fail('INVALID_ARGUMENT', 'SKP delivery requires the queue runtime.');
  await fs.mkdir(taskStore.rootDir, { recursive: true });
  if ((await fs.lstat(taskStore.rootDir)).isSymbolicLink()) fail('ARTIFACT_INTEGRITY_ERROR', 'Delivery storage must not be a symlink.');
  const storeRoot = await fs.realpath(taskStore.rootDir);
  const deliveriesRoot = path.join(storeRoot, 'model-deliveries-v1');
  await ensureDirectory(deliveriesRoot);
  const directory = path.join(deliveriesRoot, taskId);
  const target = path.join(directory, 'model.skp');
  const journalPath = path.join(directory, 'save-intent.json');
  const receiptPath = path.join(directory, 'saved-receipt.json');
  // Completed receipts may be replayed after the model has changed, closed or
  // the handshake expired. Replaying only verifies the saved bytes; no save runs.
  if (await exists(directory)) {
    await assertRealDirectory(directory);
    if (!await exists(journalPath)) throw outcomeUnknown(taskId, false);
    const intent = await readSigned(taskStore, journalPath);
    const immutable = { version: MODEL_ACCESSIBILITY_DELIVERY_VERSION, delivery_task_id: taskId,
      source_task_id: sourceTaskId, source_binding: intent.source_binding, filename: 'model.skp' };
    return replaySaved({ taskStore, directory, target, journalPath, receiptPath, immutable });
  }
  const source = await taskStore.getTask(sourceTaskId, { includePrivate: true });
  const binding = await sourceBinding(source, taskStore);
  const immutable = { version: MODEL_ACCESSIBILITY_DELIVERY_VERSION, delivery_task_id: taskId,
    source_task_id: sourceTaskId, source_binding: binding, filename: 'model.skp' };
  if (!sessionContract || canonicalJson(destinationTask.inputs.session_contract) !== canonicalJson(sessionContract)) fail('HANDSHAKE_REQUIRED', 'A server-resolved fresh connection must be persisted on the delivery task.');

  return bridge.withAgentGatewayExecution({ taskId, intent: 'deliver_model' }, gatewayBridge => gatewayBridge.withLiveMutationAuthorization({
    runtime: 'queue', timeoutMs, session_contract: sessionContract, operation: 'save_model'
  }, async authorizedBridge => {
    const runtime = authorizedBridge.selectRuntime('queue', { timeoutMs });
    if (typeof runtime.getSessionState !== 'function') fail('HANDSHAKE_INVALID', 'Delivery requires an actual session-state read.');
    const before = await runtime.getSessionState();
    assertSourceState(before, binding);
    try {
      // A task owns exactly one never-reused directory. Even an interrupted
      // claim with no journal is held for inspection, never retried as a save.
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') return replaySaved({ taskStore, directory, target, journalPath, receiptPath, immutable });
      throw error;
    }
    await syncDirectory(deliveriesRoot);
    await assertRealDirectory(directory);
    const intent = { ...immutable, kind: 'save_intent', claimed_at: new Date().toISOString(),
      session_contract_hash: sha256Canonical(sessionContract), before_identity: structuredClone(before.model_identity),
      ...(creationParameterBinding(source) ? { parameter_binding: creationParameterBinding(source) } : {}) };
    await writeSigned(taskStore, journalPath, intent);
    await syncDirectory(directory);
    if (await exists(target)) fail('ARTIFACT_INTEGRITY_ERROR', 'The unique delivery target unexpectedly exists; it will not be overwritten.');
    let saved;
    try {
      saved = await authorizedBridge.save_model({ path: target, keep_session: true, runtime: 'queue', timeoutMs });
      if (!saved || path.resolve(saved.file_path || '') !== target) fail('ARTIFACT_INTEGRITY_ERROR', 'The save response is not bound to the unique delivery file.');
      const after = await runtime.getSessionState();
      assertSavedState(after, binding, target);
      const file = await hashFile(target);
      const receipt = { ...immutable, kind: 'saved_receipt', saved_at: new Date().toISOString(),
        file, save_confirmed: true, post_save_revision: after.model_revision,
        ...(intent.parameter_binding ? { parameter_binding: intent.parameter_binding } : {}),
        after_identity: structuredClone(after.model_identity), save_intent_hash: sha256Canonical(intent) };
      // Once this immutable receipt exists, artifact registration/finalization
      // can safely recover without repeating the native save.
      await writeSigned(taskStore, receiptPath, receipt);
      await syncDirectory(directory);
      return await publicSavedResult(taskStore, taskId, target, receipt, false);
    } catch (error) {
      if (await exists(receiptPath)) return replaySaved({ taskStore, directory, target, journalPath, receiptPath, immutable });
      throw outcomeUnknown(taskId, Boolean(saved), error?.code);
    }
  }));
}

function creationParameterBinding(source) {
  const record = source.private?.creation?.parameter_source;
  if (!record) return null;
  return { creation_task_id: record.creation_task_id, source_record_hash: record.source_record_hash,
    model_key: record.model_key, runtime: record.runtime, parameter_revision: record.parameter_revision };
}

/** Internal provenance API for fixed server-owned delivery/appearance saves.
 * The brand cannot be reconstructed from client JSON. Appearance receipts carry
 * no parameter baseline; neither receipt itself proves an actual reopen. */
export async function readVerifiedModelAccessibilitySavedReceipt({ taskStore, deliveryTaskId } = {}) {
  if (!taskStore?.mutationReceiptLedger || !TASK_ID.test(deliveryTaskId || '')) fail('INVALID_ARGUMENT', 'A server delivery task id is required.');
  const task = await taskStore.getTask(deliveryTaskId, { includePrivate: true });
  if (task.intent === 'apply_native_appearance') {
    const proof = await readNativeAppearanceSavedProvenance({ taskStore, appearanceTaskId: deliveryTaskId });
    verifiedSavedReceipts.set(proof, sha256Canonical(proof));
    return proof;
  }
  if (task.intent !== 'deliver_model' || !TASK_ID.test(task.inputs?.source_task_id || '')) fail('INVALID_ARGUMENT', 'Saved parameter continuation requires an existing delivery task.');
  if ((await fs.lstat(taskStore.rootDir)).isSymbolicLink()) fail('ARTIFACT_INTEGRITY_ERROR', 'Delivery storage must not be a symlink.');
  const directory = path.join(await fs.realpath(taskStore.rootDir), 'model-deliveries-v1', deliveryTaskId);
  await assertRealDirectory(path.dirname(directory)); await assertRealDirectory(directory);
  const target = path.join(directory, 'model.skp');
  const intent = await readSigned(taskStore, path.join(directory, 'save-intent.json'));
  const receipt = await readSigned(taskStore, path.join(directory, 'saved-receipt.json'));
  const immutable = { version: MODEL_ACCESSIBILITY_DELIVERY_VERSION, delivery_task_id: deliveryTaskId,
    source_task_id: task.inputs.source_task_id, source_binding: intent.source_binding, filename: 'model.skp' };
  assertImmutable(intent, immutable, 'save_intent'); assertImmutable(receipt, immutable, 'saved_receipt');
  if (receipt.save_confirmed !== true || receipt.save_intent_hash !== sha256Canonical(intent)
    || !SHA.test(receipt.post_save_revision || '') || receipt.post_save_revision !== intent.source_binding?.model_revision
    || path.resolve(receipt.after_identity?.source_path || '') !== target
    || canonicalJson(receipt.parameter_binding) !== canonicalJson(intent.parameter_binding)) fail('ARTIFACT_INTEGRITY_ERROR', 'Saved-file receipt does not match its fixed file, save intent or parameter binding.');
  const file = await hashFile(target);
  if (canonicalJson(file) !== canonicalJson(receipt.file)) fail('ARTIFACT_INTEGRITY_ERROR', 'The delivered bytes changed after their confirmed save.');
  // Legacy initial-creation receipts already sign the exact accepted native
  // revision. Only the unchanged creation-time source at parameter revision 0
  // can recover that omitted metadata; later current geometry is never used.
  let parameter_binding = receipt.parameter_binding;
  let parameter_binding_evidence = parameter_binding ? 'signed_save_intent_and_receipt' : 'unavailable';
  if (!parameter_binding) {
    const source = await taskStore.getTask(receipt.source_task_id, { includePrivate: true });
    const record = source.private?.creation?.parameter_source;
    const { source_record_hash, ...body } = record || {};
    if (source.intent === 'create_model' && record?.version === 'model-accessibility-parameter-source.v1'
      && record.creation_task_id === source.task_id && record.parameter_revision === 0 && record.entries?.length
      && source.private.creation.parameter_edit_support?.baseline_captured === true
      && source.private.creation.parameter_edit_support.evidence_level === 'trusted_immediate_creation_readback'
      && !record.identity_rebindings?.length && record.runtime === 'queue' && record.initial_model_revision === receipt.post_save_revision
      && source_record_hash === sha256Canonical(body) && source.private.creation.frozen_spec?.hash === receipt.source_binding.frozen_specification_hash) {
      parameter_binding = creationParameterBinding(source);
      parameter_binding_evidence = 'legacy_signed_initial_revision_and_server_creation_baseline';
    }
  }
  const proof = { ...receipt, file_path: target, ...(parameter_binding ? { parameter_binding } : {}), parameter_binding_evidence,
    parameter_continuation_available: Boolean(parameter_binding) };
  verifiedSavedReceipts.set(proof, sha256Canonical(proof));
  return proof;
}

export function isVerifiedModelAccessibilitySavedReceipt(receipt) {
  return Boolean(receipt && verifiedSavedReceipts.get(receipt) === sha256Canonical(receipt));
}

async function sourceBinding(source, taskStore) {
  const creation = source.private?.creation;
  const result = source.result;
  const quality = result?.quality;
  let verifiedCreation = false;
  if (source.intent === 'verify_model' && result?.kind === 'verify_creation_result') {
    const proof = source.private?.frozen_creation_verification;
    if (!proof) fail('ARTIFACT_INTEGRITY_ERROR', 'Frozen creation verification has no server binding.');
    const { integrity_hmac, ...body } = proof;
    const original = await taskStore.getTask(proof.creation_task_id, { includePrivate: true });
    const parameter = await taskStore.getTask(proof.parameter_task_id, { includePrivate: true });
    if (proof.version !== 'frozen-creation-verification.v1' || integrity_hmac !== await taskStore.mutationReceiptLedger.sign(body)
      || original.intent !== 'create_model' || proof.specification_hash !== original.private?.creation?.frozen_spec?.hash
      || proof.specification_hash !== creation?.frozen_spec?.hash || proof.parameter_source_hash !== original.private?.creation?.parameter_source?.source_record_hash
      || parameter.intent !== 'modify_design_parameters' || parameter.state !== 'completed' || parameter.result?.model_revision !== proof.model_revision
      || proof.model_revision !== creation?.round?.snapshot?.model_revision) fail('ARTIFACT_INTEGRITY_ERROR', 'Frozen verification source, parameter version or original specification no longer matches its signed binding.');
    verifiedCreation = true;
  }
  if (!(source.intent === 'create_model' && result?.kind === 'create_model_result' || verifiedCreation) || source.state !== 'completed' || creation?.runtime !== 'queue'
    || result.quality_status !== 'pass' || result.quality_accepted !== true
    || result.evidence_level !== 'live_runtime' || quality?.quality_status !== 'pass' || quality.quality_accepted !== true
    || quality.evidence_level !== 'live_runtime' || quality.remaining?.length !== 0) {
    fail('OPERATION_NOT_ALLOWED', 'Only a completed queue creation or its signed frozen verification with server-recorded live quality pass may be delivered.');
  }
  const frozen = creation.frozen_spec;
  if (!frozen?.specification || frozen.hash !== freezeDetailSpecification(frozen.specification).hash
    || quality.specification_hash !== frozen.hash || !frozen.specification.required_parts?.length) {
    fail('ARTIFACT_INTEGRITY_ERROR', 'The source must retain its original frozen detailed-quality specification.');
  }
  const snapshot = creation.round?.snapshot;
  if (!SHA.test(snapshot?.model_revision || '') || snapshot.model_revision_complete !== true
    || result.snapshot?.model_revision !== snapshot.model_revision) fail('MODEL_REVISION_INCOMPLETE', 'The accepted source needs a complete native snapshot revision.');
  const contract = source.inputs?.session_contract;
  if (contract?.runtime !== 'queue' || !contract.session_id || !contract.document_id || !contract.model_identity) fail('HANDSHAKE_INVALID', 'The accepted creation has no server-persisted session/document identity binding.');
  return { session_id: contract.session_id, document_id: contract.document_id,
    model_identity_hash: sha256Canonical(contract.model_identity), model_revision: snapshot.model_revision,
    frozen_specification_hash: frozen.hash, quality_hash: sha256Canonical(quality) };
}

function assertSourceState(state, binding) {
  if (state?.runtime !== 'queue' || state.session_id !== binding.session_id || state.document_id !== binding.document_id
    || sha256Canonical(state.model_identity || null) !== binding.model_identity_hash) fail('MODEL_IDENTITY_MISMATCH', 'The active session/document/model is not the accepted creation source.');
  if (state.model_revision_complete !== true || state.model_revision !== binding.model_revision) fail('MODEL_REVISION_MISMATCH', 'The accepted model changed after quality verification; delivery is blocked.');
}

function assertSavedState(state, binding, target) {
  if (state?.runtime !== 'queue' || state.session_id !== binding.session_id || state.document_id !== binding.document_id
    || path.resolve(state.model_identity?.source_path || '') !== target) fail('MODEL_IDENTITY_MISMATCH', 'Saved-file confirmation is not bound to the same document and requested file.');
  if (state.model_revision_complete !== true || state.model_revision !== binding.model_revision) fail('MODEL_REVISION_MISMATCH', 'The model revision changed while saving; acceptance is not established.');
}

async function replaySaved({ taskStore, directory, target, journalPath, receiptPath, immutable }) {
  await assertRealDirectory(directory);
  if (!await exists(journalPath)) throw outcomeUnknown(immutable.delivery_task_id, false);
  const intent = await readSigned(taskStore, journalPath);
  assertImmutable(intent, immutable, 'save_intent');
  if (!await exists(receiptPath)) throw outcomeUnknown(immutable.delivery_task_id, false);
  const receipt = await readSigned(taskStore, receiptPath);
  assertImmutable(receipt, immutable, 'saved_receipt');
  if (receipt.save_confirmed !== true || receipt.save_intent_hash !== sha256Canonical(intent)
    || receipt.post_save_revision !== immutable.source_binding.model_revision) fail('ARTIFACT_INTEGRITY_ERROR', 'The delivery receipt does not match its save intent.');
  const file = await hashFile(target);
  if (canonicalJson(file) !== canonicalJson(receipt.file)) fail('ARTIFACT_INTEGRITY_ERROR', 'The delivered file changed after its confirmed save.');
  return publicSavedResult(taskStore, immutable.delivery_task_id, target, receipt, true);
}

function assertImmutable(record, immutable, kind) {
  if (record.kind !== kind || Object.keys(immutable).some(key => canonicalJson(record[key]) !== canonicalJson(immutable[key]))) fail('ARTIFACT_INTEGRITY_ERROR', 'Delivery journal identity or source binding changed.');
}

async function publicSavedResult(taskStore, taskId, target, receipt, replayed) {
  const artifact = await taskStore.registerArtifact(taskId, { filePath: target, kind: 'file', mediaType: 'application/octet-stream', label: 'model.skp' });
  let parameterSourceDiscovery = { available: false };
  try {
    const verified = await readVerifiedModelAccessibilitySavedReceipt({ taskStore, deliveryTaskId: taskId });
    const { indexSavedParameterSource } = await import('./model-accessibility-parameter-discovery.mjs');
    parameterSourceDiscovery.available = await indexSavedParameterSource({ taskStore, receipt: verified, deliveryTaskId: taskId });
  } catch (error) { parameterSourceDiscovery.reason = error.code || 'SOURCE_INDEX_UNAVAILABLE'; }
  return { version: MODEL_ACCESSIBILITY_DELIVERY_VERSION, kind: 'model_accessibility_delivery',
    source_task_id: receipt.source_task_id, saved: true, artifact, file: { filename: 'model.skp', ...receipt.file },
    model_revision: receipt.post_save_revision, quality_status: 'pass', quality_accepted: true,
    evidence_level: 'live_saved_file', replayed, cold_reopen_verified: false, parameter_source_discovery: parameterSourceDiscovery,
    remaining: [],
    optional_validation: 'Only on explicit user request: close/reopen and compare geometry, appearance and parameter binding. Otherwise deliver the saved artifact and stop.',
    document_effect: 'The current document is saved under the server delivery filename; source files are not overwritten.',
    release_acceptance: false };
}

async function hashFile(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.nlink !== 1) fail('ARTIFACT_INTEGRITY_ERROR', 'The delivery file must be a nonempty unlinked regular file.');
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (stat.size !== bytes.length || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('ARTIFACT_INTEGRITY_ERROR', 'The saved file changed while its checksum was read.');
    return { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    if (['ELOOP', 'ENOENT'].includes(error.code)) fail('ARTIFACT_INTEGRITY_ERROR', 'The delivery file is missing or is a symlink.');
    throw error;
  } finally { await handle?.close(); }
}

async function writeSigned(taskStore, filePath, payload) {
  const integrity_hmac = await taskStore.mutationReceiptLedger.sign(payload);
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({ ...payload, integrity_hmac })}\n`);
    await handle.sync();
    await handle.close(); handle = null;
    await fs.link(temporary, filePath);
  } finally { await handle?.close(); await fs.unlink(temporary).catch(() => {}); }
}

async function readSigned(taskStore, filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1000000 || stat.nlink !== 1) fail('ARTIFACT_INTEGRITY_ERROR', 'Delivery journal is not a bounded regular file.');
    const { integrity_hmac, ...payload } = JSON.parse(await handle.readFile('utf8'));
    const expected = await taskStore.mutationReceiptLedger.sign(payload);
    const actualBytes = Buffer.from(String(integrity_hmac || ''));
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) fail('ARTIFACT_INTEGRITY_ERROR', 'Delivery journal integrity verification failed.');
    return payload;
  } catch (error) {
    if (error instanceof SyntaxError || ['ELOOP', 'ENOENT'].includes(error.code)) fail('ARTIFACT_INTEGRITY_ERROR', 'Delivery journal is missing, invalid or a symlink.');
    throw error;
  } finally { await handle?.close(); }
}

async function ensureDirectory(directory) {
  try { await fs.mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await assertRealDirectory(directory);
}
async function assertRealDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail('ARTIFACT_INTEGRITY_ERROR', 'Delivery storage must be a private real directory.');
}
async function exists(filePath) { try { await fs.lstat(filePath); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function syncDirectory(directory) {
  let handle;
  try { handle = await fs.open(directory, 'r'); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}
function outcomeUnknown(taskId, responseReceived, originalCode) {
  return new AgentContractError('MUTATION_RECOVERY_REQUIRED', 'The delivery save was claimed but is not durably finalized. Inspect the existing delivery file and queue; this request will not save again.', {
    details: { task_id: taskId, outcome_unknown: true, save_response_received: responseReceived, original_code: originalCode || null, automatic_save_replay_allowed: false },
    nextAction: { action: 'inspect_delivery_state_without_resaving', tool: 'resume_agent_task', arguments: { task_id: taskId } }
  });
}
function fail(code, message) { throw new AgentContractError(code, message); }
