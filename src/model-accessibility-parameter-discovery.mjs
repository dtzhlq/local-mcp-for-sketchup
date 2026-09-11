import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { getModelAccessibilityTaskCatalog } from './model-accessibility-tasks.mjs';
import { isVerifiedModelAccessibilitySavedReceipt, readVerifiedModelAccessibilitySavedReceipt } from './model-accessibility-delivery.mjs';

const VERSION = 'parameter-source-index.v1';
const fail = message => { throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', message); };
const directory = (store, key) => path.join(store.rootDir, 'parameter-source-index-v1', key);
export function parameterSourceDocumentBinding(adoption) {
  const documentId = adoption.document_id || adoption.model_identity?.document_id;
  if (!documentId) throw new AgentContractError('MODEL_IDENTITY_UNAVAILABLE', 'Parameter discovery requires the actual document session identity.');
  return sha256Canonical({ runtime: adoption.runtime, document_id: documentId, runtime_object_id: adoption.model_identity?.runtime_object_id || null });
}
async function writeEntry(store, key, id, value) {
  const dir = directory(store, key); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const core = { version: VERSION, index_key: key, ...value };
  const signed = { ...core, integrity_hmac: await store.mutationReceiptLedger.sign(core) };
  const file = path.join(dir, `${id}.json`), temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(signed), { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, file);
}
async function readEntries(store, key) {
  const dir = directory(store, key), files = await fs.readdir(dir).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const entries = [];
  for (const file of files.filter(name => /^task_[a-f0-9-]+\.json$/.test(name))) {
    const stat = await fs.lstat(path.join(dir, file)); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) fail('Invalid private parameter source index file.');
    const { integrity_hmac, ...core } = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    if (core.version !== VERSION || core.index_key !== key || integrity_hmac !== await store.mutationReceiptLedger.sign(core)) fail('Parameter source index integrity mismatch.');
    entries.push(core);
  }
  return entries;
}
export async function indexCapturedParameterSource({ taskStore, task } = {}) {
  const record = task.private?.creation?.parameter_source;
  if (!record || task.private.creation.parameter_edit_support?.baseline_captured !== true) return false;
  const { source_record_hash, ...body } = record;
  if (source_record_hash !== sha256Canonical(body) || record.creation_task_id !== task.task_id || !/^model_[a-f0-9]{32}$/.test(record.model_key)) fail('Only actual captured parameter sources can be indexed.');
  const documentBinding = task.private.creation.parameter_source_document_binding;
  if (!/^sha256:[a-f0-9]{64}$/.test(documentBinding || '')) return false;
  await writeEntry(taskStore, record.model_key, task.task_id, { creation_task_id: task.task_id, capture_record_hash: record.source_record_hash, document_binding: documentBinding });
  return true;
}
export async function indexSavedParameterSource({ taskStore, receipt, deliveryTaskId } = {}) {
  if (!isVerifiedModelAccessibilitySavedReceipt(receipt)) fail('Saved source index needs a server-verified saved receipt.');
  if (!/^task_[a-f0-9-]+$/.test(deliveryTaskId || '') || receipt.delivery_task_id !== deliveryTaskId) fail('Saved source index delivery identity mismatch.');
  if (!receipt.parameter_binding) return false;
  const key = `file_${sha256Canonical(path.resolve(receipt.file_path)).slice(7)}`;
  await writeEntry(taskStore, key, deliveryTaskId, { creation_task_id: receipt.parameter_binding.creation_task_id, saved_delivery_task_id: deliveryTaskId });
  return true;
}
export async function discoverParameterSources({ gateway, runtime, query } = {}) {
  if (!['mock','queue'].includes(runtime)) throw new AgentContractError('INVALID_ARGUMENT', 'Parameter source discovery needs explicit runtime=mock or queue.');
  if (query !== undefined && (typeof query !== 'string' || query.length > 120)) throw new AgentContractError('INVALID_ARGUMENT', 'query must be a short literal root name.');
  const adoption = await gateway.bridge.adopt_open_model({ runtime, read_only: true, recursive: false });
  const identity = modelIdentityForAdoption(adoption), modelKey = modelKeyForIdentity(identity), sources = [], documentBinding = parameterSourceDocumentBinding(adoption);
  const entries = await readEntries(gateway.taskStore, modelKey);
  for (const item of entries) {
    if (item.document_binding !== documentBinding) continue;
    const task = await gateway.taskStore.getTask(item.creation_task_id, { includePrivate: true }), record = task.private?.creation?.parameter_source;
    if (!record || record.model_key !== modelKey || record.runtime !== runtime || task.private.creation.parameter_edit_support?.baseline_captured !== true) continue;
    const { source_record_hash, ...body } = record;
    if (source_record_hash !== sha256Canonical(body)) fail('Indexed parameter source record integrity mismatch.');
    const roots = record.entries.filter(entry => !query || entry.logical_instance_id.toLowerCase().includes(query.toLowerCase())).map(entry => ({ name: entry.logical_instance_id, target: entry.target }));
    if (!roots.length) continue;
    const kind = record.entries[0].source.task?.kind || record.entries[0].source.bundle?.brief?.kind;
    sources.push({ creation_task_id: task.task_id, kind, roots, supported_parameters: Object.keys(getModelAccessibilityTaskCatalog({ task: kind, detail: 'parameters' }).tasks[0].parameters),
      baseline_captured: true, parameter_revision: record.parameter_revision, current_geometry_rechecked: false,
      next_action: 'Use modify_design_parameters with this creation_task_id, explicit single/all targets and changes; fresh edit preflight will enforce manual-change protection.' });
  }
  const reopen = [];
  const sourcePath = adoption.model_identity?.source_path || adoption.model_info?.source_path;
  if (!sources.length && sourcePath) {
    for (const item of await readEntries(gateway.taskStore, `file_${sha256Canonical(path.resolve(sourcePath)).slice(7)}`)) {
      const receipt = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: gateway.taskStore, deliveryTaskId: item.saved_delivery_task_id });
      if (receipt.file_path !== path.resolve(sourcePath) || receipt.parameter_binding?.creation_task_id !== item.creation_task_id || receipt.parameter_binding.runtime !== runtime) continue;
      reopen.push({ creation_task_id: item.creation_task_id, saved_delivery_task_id: item.saved_delivery_task_id,
        baseline_rebind_required: true, next_action: 'Include saved_delivery_task_id with the parameter edit. The server will compare signed saved bytes, complete current revision and all original subtree fingerprints before rebinding identity.' });
    }
  }
  return { kind: 'parameter_source_discovery', current_model: 'fresh_identity_checked', sources, saved_source_continuations: reopen,
    evidence_level: 'trusted_creation_source_index', geometry_rechecked: false,
    note: sources.length || reopen.length ? 'Only this active document or its verified saved delivery is listed; no filesystem paths are exposed.' : 'No trusted creation-time baseline was indexed for this active document. Current geometry cannot create one retroactively.' };
}
