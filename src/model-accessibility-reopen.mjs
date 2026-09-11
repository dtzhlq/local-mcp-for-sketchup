import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AgentContractError, canonicalJson, sha256Canonical, normalizeAgentError } from './agent-contract.mjs';
import { readVerifiedModelAccessibilitySavedReceipt } from './model-accessibility-delivery.mjs';

export const MODEL_ACCESSIBILITY_REOPEN_VERSION = 'model-accessibility-reopen.v1';
const TASK = /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_FIELDS = ['saved_delivery_task_id', 'connection_task_id', 'runtime', 'timeout_ms'];
const fail = (code, message) => { throw new AgentContractError(code, message); };
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function validateReopenDeliveredInput(input, { previous = {}, materialized = false } = {}) {
  const fields = materialized ? [...PUBLIC_FIELDS, 'session_contract'] : PUBLIC_FIELDS;
  if (!object(input) || Object.keys(input).some(key => !fields.includes(key))) fail('INVALID_ARGUMENT', 'Reopening accepts only the saved delivery task, a fresh connection, queue runtime and timeout. Paths, snapshots, approval tokens and direct session contracts are not accepted.');
  if (input.saved_delivery_task_id !== undefined && !TASK.test(input.saved_delivery_task_id)) fail('INVALID_ARGUMENT', 'saved_delivery_task_id must identify the original server delivery or saved appearance task.');
  if (previous.saved_delivery_task_id && input.saved_delivery_task_id !== undefined && input.saved_delivery_task_id !== previous.saved_delivery_task_id) fail('INVALID_ARGUMENT', 'The saved delivery source is frozen on this task.');
  if (input.runtime !== undefined && input.runtime !== 'queue') fail('INVALID_ARGUMENT', 'Saved-document close/reopen requires runtime=queue.');
  if (input.timeout_ms !== undefined && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 1000 || input.timeout_ms > 300000)) fail('INVALID_ARGUMENT', 'timeout_ms must be an integer from 1000 to 300000.');
}

function directoryFor(gateway, taskId) { return path.join(gateway.taskStore.rootDir, 'model-reopens-v1', taskId); }
async function exists(location) { try { await fs.lstat(location); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function realDirectory(location) {
  const stat = await fs.lstat(location);
  // The configured root may use macOS /var -> /private/var; the directory
  // itself must be real, while file receipts use their canonical real paths.
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ARTIFACT_INTEGRITY_ERROR', 'Reopen storage must be a real directory.');
}
async function syncDirectory(location) {
  const handle = await fs.open(location, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeSigned(gateway, location, value) {
  const body = { ...value, integrity_hmac: await gateway.taskStore.mutationReceiptLedger.sign(value) };
  let handle;
  try {
    handle = await fs.open(location, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(body)}\n`, 'utf8'); await handle.sync();
  } finally { await handle?.close(); }
  await syncDirectory(path.dirname(location));
}
async function readSigned(gateway, location) {
  let handle;
  try {
    handle = await fs.open(location, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > 128 * 1024 * 1024) fail('MUTATION_RECEIPT_INVALID', 'Reopen journal must be a bounded private regular file.');
    const record = JSON.parse(await handle.readFile('utf8'));
    if (!object(record)) fail('MUTATION_RECEIPT_INVALID', 'The reopen journal is malformed.');
    const { integrity_hmac, ...body } = record;
    const expected = Buffer.from(await gateway.taskStore.mutationReceiptLedger.sign(body)), actual = Buffer.from(String(integrity_hmac || ''));
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) fail('MUTATION_RECEIPT_INVALID', 'Reopen journal signature verification failed.');
    return body;
  } catch (error) {
    if (error instanceof SyntaxError || ['ELOOP', 'ENOENT'].includes(error.code)) fail('MUTATION_RECEIPT_INVALID', 'The reopen journal is missing, malformed or a symlink.');
    throw error;
  } finally { await handle?.close(); }
}
async function assertFile(binding) {
  const target = binding.file_path;
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.skp' || await fs.realpath(target) !== target) fail('ARTIFACT_INTEGRITY_ERROR', 'The original delivered file is unavailable.');
  let handle;
  try {
    handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== binding.file.bytes) fail('ARTIFACT_INTEGRITY_ERROR', 'The delivered file size or identity changed.');
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let chunk;
    do { chunk = await handle.read(buffer, 0, buffer.length, null); hash.update(buffer.subarray(0, chunk.bytesRead)); } while (chunk.bytesRead);
    const after = await handle.stat(), current = await fs.lstat(target);
    if (hash.digest('hex') !== binding.file.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) fail('ARTIFACT_INTEGRITY_ERROR', 'The delivered file bytes changed.');
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes(error.code)) fail('ARTIFACT_INTEGRITY_ERROR', 'The original delivered file is missing or a symlink.');
    throw error;
  } finally { await handle?.close(); }
}
function sourceBinding(proof) {
  return { saved_delivery_task_id: proof.delivery_task_id, source_task_id: proof.source_task_id,
    saved_source_kind: proof.kind === 'appearance_saved_receipt' ? 'native_appearance' : 'quality_delivery', parameter_continuation_available: proof.parameter_continuation_available === true,
    session_id: proof.source_binding.session_id, document_id: proof.source_binding.document_id,
    model_identity: structuredClone(proof.after_identity), model_revision: proof.post_save_revision,
    file_path: proof.file_path, file: structuredClone(proof.file) };
}
function assertBefore(state, binding) {
  if (state?.runtime !== 'queue' || state.session_id !== binding.session_id || state.document_id !== binding.document_id || !same(state.model_identity, binding.model_identity)
    || state.model_identity?.source_path !== binding.file_path) fail('MODEL_IDENTITY_MISMATCH', 'The active document is not the exact saved delivery document.');
  if (state.model_revision_complete !== true || state.model_revision !== binding.model_revision || state.model_modified !== false) fail('MODEL_REVISION_MISMATCH', 'Closing requires the unchanged complete saved revision and modified? false.');
}
function assertNativeReturn(value, binding) {
  if (value?.kind !== 'close_reopen_saved_model' || value.version !== 'saved-model-lifecycle.v1' || value.delivery_task_id !== binding.saved_delivery_task_id
    || value.close_confirmed !== true || value.close_ignore_changes !== false || value.close_evidence !== 'original_native_model_valid_false_before_open'
    || value.before_document_id !== binding.document_id || value.before?.document_id !== binding.document_id || value.before?.session_id !== binding.session_id
    || !same(value.before?.model_identity, binding.model_identity) || value.before?.model_revision !== binding.model_revision || value.before?.model_revision_complete !== true || value.before?.model_modified !== false
    || !same(value.file_before, binding.file) || !same(value.file_after, binding.file) || value.file_path !== binding.file_path || value.opened !== true
    || value.application_restarted !== false || value.cold_application_restart !== false || value.automatic_retry_allowed !== false
    || !['activated', 'pending_mdi_activation'].includes(value.open_status)) fail('MUTATION_RECOVERY_REQUIRED', 'The native return does not prove the exact bound document was closed and opened. Inspect this task; never repeat close.');
}
function reopenedMatches(state, binding) {
  return Boolean(state && state.session_id === binding.session_id && typeof state.document_id === 'string' && state.document_id && state.document_id !== binding.document_id
    && state.model_identity?.runtime_object_id && state.model_identity.runtime_object_id !== binding.model_identity.runtime_object_id
    && state.model_identity.source_path === binding.file_path && state.model_revision_complete === true && state.model_revision === binding.model_revision && state.model_modified === false);
}
function resultFor(task, binding, after, replayed) {
  return { kind: 'model_accessibility_reopen', stage: 'reopened', saved_delivery_task_id: binding.saved_delivery_task_id,
    close_confirmed: true, old_native_handle_invalid: true, new_document_identity_confirmed: true, document_close_reopen_verified: true,
    cold_reopen_verified: true, application_restarted: false, cold_application_restart: false, parameter_rebound: false,
    model_revision: binding.model_revision, before_document_id: binding.document_id, after_document_id: after.document_id,
    file: { filename: 'model.skp', ...binding.file }, evidence_level: 'live_document_close_reopen', quality_accepted: false,
    release_acceptance: false, requires_fresh_session: true, mutation_ready: false, replayed,
    saved_source_kind: binding.saved_source_kind || 'quality_delivery', parameter_continuation_available: binding.parameter_continuation_available === true,
    remaining: ['Obtain a fresh connection before further editing.', binding.parameter_continuation_available === true ? 'Rebind the saved parameter source explicitly before parameter editing; native visual/appearance acceptance remains separate.' : 'This saved receipt does not supply a parameter baseline; native visual/appearance acceptance remains separate.'] };
}
async function finalize(gateway, task, directory, started, complete, replayed) {
  if (complete.kind !== 'complete' || complete.task_id !== task.task_id || complete.version !== MODEL_ACCESSIBILITY_REOPEN_VERSION || complete.started_hash !== sha256Canonical(started)
    || complete.saved_delivery_task_id !== task.inputs.saved_delivery_task_id || !reopenedMatches(complete.after, started.binding)) fail('MUTATION_RECEIPT_INVALID', 'The complete reopen receipt is not bound to the original task and source.');
  await assertFile(started.binding);
  const native = await readSigned(gateway, path.join(directory, 'native-return.json'));
  if (native.kind !== 'native_return' || native.task_id !== task.task_id || native.started_hash !== sha256Canonical(started) || complete.native_return_hash !== sha256Canonical(native)) fail('MUTATION_RECEIPT_INVALID', 'The complete reopen receipt has no matching native return.');
  assertNativeReturn(native.result, started.binding);
  const artifact = await gateway.taskStore.registerArtifact(task.task_id, { filePath: started.binding.file_path, label: 'reopened-model.skp', kind: 'file', mediaType: 'application/octet-stream' });
  if (task.state === 'completed') return gateway.taskStore.update(task.task_id, { last_error: null, next_action: null, result: { ...resultFor(task, started.binding, complete.after, replayed), artifact } });
  if (task.state === 'awaiting_input') task = await gateway.taskStore.transition(task.task_id, 'understanding', { reason: 'reopen_receipt_finalization' });
  if (task.state === 'understanding' || task.state === 'executing') task = await gateway.taskStore.transition(task.task_id, 'verifying', { reason: 'reopen_receipt_verified' });
  return gateway.taskStore.transition(task.task_id, 'completed', { reason: 'saved_document_close_reopen_verified', patch: { last_error: null, next_action: null, result: { ...resultFor(task, started.binding, complete.after, replayed), artifact } } });
}
async function recover(gateway, task, directory) {
  await realDirectory(directory);
  if (!await exists(path.join(directory, 'started.json'))) fail('MUTATION_RECOVERY_REQUIRED', 'The lifecycle directory was claimed without a complete start record. Do not close again.');
  const started = await readSigned(gateway, path.join(directory, 'started.json'));
  if (started.kind !== 'started' || started.task_id !== task.task_id || started.version !== MODEL_ACCESSIBILITY_REOPEN_VERSION || started.binding?.saved_delivery_task_id !== task.inputs.saved_delivery_task_id) fail('MUTATION_RECEIPT_INVALID', 'The reopen claim is not bound to this task and its frozen source.');
  if (await exists(path.join(directory, 'complete.json'))) return finalize(gateway, task, directory, started, await readSigned(gateway, path.join(directory, 'complete.json')), true);
  if (!await exists(path.join(directory, 'native-return.json'))) fail('MUTATION_RECOVERY_REQUIRED', 'The close/open request was claimed but its native return is unavailable. Resume only inspects this task; the close will never be replayed.');
  const native = await readSigned(gateway, path.join(directory, 'native-return.json'));
  if (native.kind !== 'native_return' || native.task_id !== task.task_id || native.started_hash !== sha256Canonical(started)) fail('MUTATION_RECEIPT_INVALID', 'The native return is not bound to this lifecycle claim.');
  assertNativeReturn(native.result, started.binding);
  let after = native.result.after;
  if (native.result.open_status === 'activated') {
    if (native.result.reopen_verified !== true || native.result.new_document_identity_confirmed !== true || native.result.after_document_id !== after?.document_id || !reopenedMatches(after, started.binding)) fail('MUTATION_RECOVERY_REQUIRED', 'The native opened document did not preserve the exact saved revision and new identity. It cannot be reopened automatically again.');
  } else {
    // MDI activation may finish after the queue callback. This branch reads
    // only: never open, close, change focus, capture or issue a handshake.
    after = await gateway.bridge.selectRuntime('queue', { timeoutMs: task.inputs.timeout_ms ?? 120000 }).getSessionState();
    if (after.runtime !== 'queue' || !reopenedMatches(after, started.binding)) {
      const patch = { last_error: null, result: { kind: 'model_accessibility_reopen', stage: 'pending_mdi_activation', saved_delivery_task_id: task.inputs.saved_delivery_task_id,
        close_confirmed: true, document_close_reopen_verified: false, cold_reopen_verified: false, application_restarted: false, parameter_rebound: false,
        evidence_level: 'native_close_open_pending_activation', quality_accepted: false },
        next_action: { action: 'resume_agent_task', tool: 'resume_agent_task', arguments: { task_id: task.task_id }, reason: 'Focus the already opened saved document, then resume for a read-only identity/revision check. Do not open another model.' } };
      if (task.state === 'executing') task = await gateway.taskStore.transition(task.task_id, 'verifying', { reason: 'native_close_open_return_recorded' });
      return gateway.taskStore.update(task.task_id, patch);
    }
  }
  await assertFile(started.binding);
  const complete = { version: MODEL_ACCESSIBILITY_REOPEN_VERSION, kind: 'complete', task_id: task.task_id, saved_delivery_task_id: task.inputs.saved_delivery_task_id,
    started_hash: sha256Canonical(started), native_return_hash: sha256Canonical(native), after: structuredClone(after), completed_at: new Date().toISOString() };
  await writeSigned(gateway, path.join(directory, 'complete.json'), complete);
  return finalize(gateway, task, directory, started, complete, false);
}

export async function reopenDeliveredModelTask(gateway, task, { resume = false } = {}) {
  validateReopenDeliveredInput(task.inputs, { materialized: true });
  const directory = directoryFor(gateway, task.task_id);
  if (await exists(directory)) return recover(gateway, task, directory);
  const required = [];
  if (!task.inputs.saved_delivery_task_id) required.push('saved_delivery_task_id');
  if (task.inputs.runtime !== 'queue') required.push('runtime=queue');
  if (!task.inputs.connection_task_id || !task.inputs.session_contract) required.push('fresh connection_task_id');
  if (required.length || resume) {
    const patch = { last_error: null, result: { kind: 'model_accessibility_reopen', stage: 'awaiting_input', saved_delivery_task_id: task.inputs.saved_delivery_task_id || null, document_close_reopen_verified: false, cold_reopen_verified: false, evidence_level: 'preflight_only' },
      next_action: { action: 'submit_task_input', tool: 'submit_agent_task_input', required: required.length ? required : ['submit with stable idempotency_key to start the first close/open'], reason: 'resume cannot initiate document closure' } };
    if (task.state === 'understanding') return gateway.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'reopen_inputs_required', patch });
    return gateway.taskStore.update(task.task_id, patch);
  }
  const proof = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: gateway.taskStore, deliveryTaskId: task.inputs.saved_delivery_task_id });
  const binding = sourceBinding(proof), timeoutMs = task.inputs.timeout_ms ?? 120000;
  await realDirectory(gateway.taskStore.rootDir);
  return gateway.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: 'reopen_delivered_model' }, scoped => scoped.withLiveMutationAuthorization({
    runtime: 'queue', session_contract: task.inputs.session_contract, timeoutMs, operation: 'close_reopen_saved_model'
  }, async authorized => {
    const runtime = authorized.selectRuntime('queue', { timeoutMs });
    const capabilities = (await authorized.get_capabilities({ runtime: 'queue', timeoutMs })).runtime;
    if (typeof runtime.closeReopenSavedModel !== 'function' || capabilities.saved_model_lifecycle?.version !== 'saved-model-lifecycle.v1' || capabilities.saved_model_lifecycle.close_reopen_saved_model !== true) fail('OPERATION_NOT_ALLOWED', 'The installed native plugin must support verified saved-document close/reopen.');
    const before = await runtime.getSessionState(); assertBefore(before, binding); await assertFile(binding);
    const parent = path.dirname(directory);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 }); await realDirectory(parent); await syncDirectory(gateway.taskStore.rootDir);
    try { await fs.mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') return recover(gateway, task, directory); throw error; }
    await syncDirectory(parent);
    const started = { version: MODEL_ACCESSIBILITY_REOPEN_VERSION, kind: 'started', task_id: task.task_id, binding,
      session_contract_hash: sha256Canonical(task.inputs.session_contract), claimed_at: new Date().toISOString() };
    await writeSigned(gateway, path.join(directory, 'started.json'), started);
    task = await gateway.taskStore.transition(task.task_id, 'executing', { reason: 'saved_document_close_reopen_claimed' });
    // Preserve the WeakMap-branded object. Client JSON, structured clones and
    // persisted plain records are never passed as a native closing authority.
    const result = await authorized.close_reopen_saved_model({ saved_receipt: proof, runtime: 'queue', timeoutMs });
    await writeSigned(gateway, path.join(directory, 'native-return.json'), { version: MODEL_ACCESSIBILITY_REOPEN_VERSION, kind: 'native_return', task_id: task.task_id,
      started_hash: sha256Canonical(started), result, recorded_at: new Date().toISOString() });
    return recover(gateway, task, directory);
  }));
}

export async function reopenDeliveredModelError(gateway, task, error) {
  const claimed = await exists(directoryFor(gateway, task.task_id));
  const normalized = normalizeAgentError(claimed ? new AgentContractError('MUTATION_RECOVERY_REQUIRED', 'Saved-document lifecycle was claimed. Resume its persisted evidence; do not repeat close or start another reopen task.',
    { details: { original_code: error.code || 'INTERNAL_ERROR', automatic_close_replay_allowed: false } }) : error);
  const next_action = claimed ? { action: 'resume_agent_task', tool: 'resume_agent_task', arguments: { task_id: task.task_id } }
    : { action: 'submit_task_input', tool: 'submit_agent_task_input', required: ['correct missing runtime condition and submit a fresh connection_task_id with a stable idempotency_key'], source_frozen: Boolean(task.inputs.saved_delivery_task_id) };
  const patch = { last_error: normalized, next_action,
    ...(claimed ? { result: { kind: 'model_accessibility_reopen', stage: 'outcome_unknown', saved_delivery_task_id: task.inputs.saved_delivery_task_id,
      document_close_reopen_verified: false, cold_reopen_verified: false, application_restarted: false, parameter_rebound: false, evidence_level: 'unverified', quality_accepted: false } } : {}) };
  if (!claimed && task.state === 'understanding') return gateway.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'reopen_preflight_blocked', patch });
  return gateway.taskStore.update(task.task_id, patch);
}
