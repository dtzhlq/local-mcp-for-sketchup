import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';
import { normalizeNativeAppearanceInput, MODEL_ACCESSIBILITY_APPEARANCE_VERSION } from './model-accessibility-appearance.mjs';

const TASK = /^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVISION = /^sha256:[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{64}$/;
const fail = message => { throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);

async function realDirectory(directory) {
  const info = await fs.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('Appearance provenance storage must be a real directory.');
}
async function readStable(file, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maxBytes) fail('Appearance provenance must be a bounded nonempty regular file.');
    const bytes = await handle.readFile(), after = await handle.stat(), current = await fs.lstat(file);
    if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || current.isSymbolicLink()
      || current.ino !== before.ino || current.dev !== before.dev) fail('Appearance provenance changed during its read.');
    return bytes;
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes(error.code)) fail('Appearance saved provenance is missing or is a symlink.');
    throw error;
  } finally { await handle?.close(); }
}
async function verifySigned(taskStore, record) {
  if (!object(record)) fail('Appearance provenance must be an object.');
  const { integrity_hmac, ...body } = record;
  const expected = Buffer.from(await taskStore.mutationReceiptLedger.sign(body)), actual = Buffer.from(String(integrity_hmac || ''));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) fail('Appearance provenance signature verification failed.');
  return body;
}
async function readSigned(taskStore, filename) {
  let record;
  try { record = JSON.parse((await readStable(filename, 16_000_000)).toString('utf8')); }
  catch (error) { if (error instanceof SyntaxError) fail('Appearance provenance contains invalid JSON.'); throw error; }
  return verifySigned(taskStore, record);
}

/** Internal read-only provenance, never a client-supplied proof. The common
 * saved-receipt reader applies its non-serializable lifecycle brand afterward.
 * Older receipts without signed post-save state deliberately cannot reopen. */
export async function readNativeAppearanceSavedProvenance({ taskStore, appearanceTaskId } = {}) {
  if (!taskStore?.mutationReceiptLedger || !TASK.test(appearanceTaskId || '')) throw new AgentContractError('INVALID_ARGUMENT', 'An actual saved appearance task id is required.');
  const task = await taskStore.getTask(appearanceTaskId, { includePrivate: true });
  if (task.intent !== 'apply_native_appearance' || task.inputs?.runtime !== 'queue') throw new AgentContractError('INVALID_ARGUMENT', 'This saved source must be a queue appearance task.');
  await realDirectory(taskStore.rootDir);
  const directory = path.join(await fs.realpath(taskStore.rootDir), 'task-artifacts', appearanceTaskId, 'native-appearance');
  for (const location of [path.dirname(path.dirname(directory)), path.dirname(directory), directory]) await realDirectory(location);
  const planRecord = await verifySigned(taskStore, task.private?.appearance_plan);
  const plan = planRecord.plan, binding = planRecord.binding;
  if (!object(plan) || !object(binding)) fail('The saved appearance plan is missing.');
  const { appearance_plan_hash, ...planBody } = plan;
  if (planRecord.task_id !== appearanceTaskId || plan.task_id !== appearanceTaskId || binding.task_id !== appearanceTaskId
    || plan.version !== MODEL_ACCESSIBILITY_APPEARANCE_VERSION || appearance_plan_hash !== sha256Canonical(planBody)
    || binding.plan_hash !== appearance_plan_hash || binding.model_revision !== plan.model_revision
    || !same(plan.input, normalizeNativeAppearanceInput(task.inputs.appearance))
    || await fs.realpath(planRecord.directory) !== directory) fail('The saved appearance plan no longer matches its original task.');
  const claim = await readSigned(taskStore, path.join(directory, 'execution-claim.json'));
  const complete = await readSigned(taskStore, path.join(directory, 'complete-receipt.json'));
  for (const [record, phase] of [[claim, 'started'], [complete, 'complete']]) {
    if (record.version !== MODEL_ACCESSIBILITY_APPEARANCE_VERSION || record.task_id !== appearanceTaskId
      || record.plan_hash !== appearance_plan_hash || record.phase !== phase) fail('Appearance save provenance is not bound to its original execution claim.');
  }
  const state = complete.saved_state;
  if (!state) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'This older appearance save has no signed post-save document state. Keep the saved file; do not reconstruct historical identity or automatically save/reopen it.');
  const target = path.join(directory, 'model.skp'), result = complete.result, capture = complete.capture;
  if (state.runtime !== 'queue' || typeof state.session_id !== 'string' || !state.session_id || typeof state.document_id !== 'string' || !state.document_id
    || !object(state.model_identity) || !state.model_identity.runtime_object_id || state.model_identity.source_path !== target
    || !REVISION.test(state.model_revision || '') || state.model_revision_complete !== true || state.model_modified !== false
    || result?.kind !== 'model_accessibility_appearance' || result.stage !== 'applied' || result.saved !== true
    || result.model_revision !== state.model_revision || result.quality_accepted !== false || result.evidence_level !== 'live_saved_file'
    || result.native_readback?.ok !== true || result.uv_readback?.ok !== true || result.geometry_preserved !== true || result.unrelated_unchanged !== true
    || result.native_style_readback !== true || result.native_workflow_readback !== true
    || capture?.server_verified !== true || capture.model_revision !== state.model_revision || capture.model_revision_complete !== true) fail('Appearance saved provenance lacks exact verified document/revision, capture or readback evidence.');
  const native = complete.native_receipt;
  if (!object(native)) fail('Appearance saved provenance has no native commit receipt.');
  const { receipt_hash, ...nativeBody } = native;
  if (receipt_hash !== sha256Canonical(nativeBody) || native.kind !== 'trusted_sketchup_commit_receipt' || native.runtime !== 'queue'
    || native.source !== 'sketchup_plugin' || native.commit_state !== 'committed' || native.native_receipt?.commit_state !== 'committed') fail('Appearance native commit provenance failed verification.');
  const bytes = await readStable(target, 100_000_000);
  const file = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  if (complete.file?.path !== target || complete.file.role !== 'saved_model' || complete.file.size_bytes !== file.bytes
    || !SHA.test(complete.file.sha256 || '') || complete.file.sha256 !== file.sha256
    || result.file?.bytes !== file.bytes || result.file?.sha256 !== file.sha256) fail('The saved appearance bytes differ from their signed receipt.');
  return { version: MODEL_ACCESSIBILITY_APPEARANCE_VERSION, kind: 'appearance_saved_receipt', provenance: 'signed_native_appearance_save',
    delivery_task_id: appearanceTaskId, source_task_id: appearanceTaskId, file_path: target, file, save_confirmed: true,
    post_save_revision: state.model_revision, after_identity: structuredClone(state.model_identity),
    source_binding: { session_id: state.session_id, document_id: state.document_id, model_revision: state.model_revision,
      appearance_plan_hash, appearance_claim_hash: sha256Canonical(claim), appearance_receipt_hash: sha256Canonical(complete) },
    parameter_binding_evidence: 'unavailable', parameter_continuation_available: false, quality_accepted: false };
}
