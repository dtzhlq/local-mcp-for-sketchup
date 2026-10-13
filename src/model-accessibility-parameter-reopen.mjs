import path from 'node:path';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { readVerifiedModelAccessibilitySavedReceipt, savedParameterBindingForSource } from './model-accessibility-delivery.mjs';
import { rebindDefinitionParameterSource, assertDefinitionParameterSourceUnchanged } from './model-accessibility-parameter-edit.mjs';
import { indexCapturedParameterSource, parameterSourceDocumentBinding } from './model-accessibility-parameter-discovery.mjs';
import { adoptAssemblySummary } from './model-accessibility-assembly-summary.mjs';
import { buildModelGraph } from './model-graph.mjs';

/** Identity continuation never opens a file or adopts current geometry as a new
 * baseline. A user/runtime must already have opened the exact saved copy. */
export async function resumeSavedDefinitionParameterSource({ gateway, sourceTask, deliveryTaskId, adoption, modelGraph } = {}) {
  const receipt = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: gateway.taskStore, deliveryTaskId });
  const record = sourceTask.private.creation.parameter_source;
  const sourcePath = adoption.model_identity?.source_path || adoption.model_info?.source_path;
  if (!sourcePath || path.resolve(sourcePath) !== receipt.file_path) throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'Open the exact unchanged server delivery copy before continuing its parameters.');
  const binding = savedParameterBindingForSource(receipt, sourceTask.task_id);
  if (!binding) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'This delivery has no verifiable saved parameter source binding.');
  if (receipt.scene_parameter_bindings) return resumeSavedSceneSources({ gateway, receipt, sourceTask, adoption, modelGraph });
  if ((binding.frozen_specification_hash || receipt.source_binding.frozen_specification_hash) !== sourceTask.private.creation.frozen_spec.hash) throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'This delivery does not bind the original creation and frozen specification.');
  const updated = rebindDefinitionParameterSource({ sourceRecord: record, currentModelGraph: modelGraph,
    modelKey: modelKeyForIdentity(modelIdentityForAdoption(adoption)), savedReceipt: receipt });
  const fresh = await gateway.taskStore.getTask(sourceTask.task_id, { includePrivate: true });
  if (![record.source_record_hash, updated.source_record_hash].includes(fresh.private.creation.parameter_source.source_record_hash)) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The parameter source advanced during saved-file continuation.');
  const rebound = await gateway.taskStore.update(sourceTask.task_id, { private: { ...fresh.private, creation: { ...fresh.private.creation,
    parameter_source: updated, parameter_source_document_binding: parameterSourceDocumentBinding(adoption), parameter_edit_support: { ...fresh.private.creation.parameter_edit_support,
      source_record_hash: updated.source_record_hash, saved_delivery_task_id: deliveryTaskId,
      continuation_evidence: 'signed_saved_bytes_and_complete_unchanged_parameter_readback', cold_reopen_verified: false } } } });
  await indexCapturedParameterSource({ taskStore: gateway.taskStore, task: rebound });
  return updated;
}

async function resumeSavedSceneSources({ gateway, receipt, sourceTask, adoption, modelGraph }) {
  const store = gateway.taskStore, modelKey = modelKeyForIdentity(modelIdentityForAdoption(adoption)), documentBinding = parameterSourceDocumentBinding(adoption);
  const parent = await store.getTask(receipt.source_task_id, { includePrivate: true });
  const group = parent.private?.saved_scene_identity_rebindings?.[receipt.delivery_task_id];
  const sign = async body => ({ ...body, integrity_hmac: await store.mutationReceiptLedger.sign(body) });
  const authentic = async proof => { const { integrity_hmac, ...body } = proof || {}; return Boolean(integrity_hmac && integrity_hmac === await store.mutationReceiptLedger.sign(body)); };
  const memberIds = receipt.scene_parameter_bindings.map(binding => binding.creation_task_id);
  const current = await store.getTask(sourceTask.task_id, { includePrivate: true });
  // A durable group proof means all identities and indexes were completed.
  // A crash while clearing per-child pending flags must not replay metadata or
  // require the old full revision after a later, legitimate scoped edit.
  if (group && await authentic(group) && group.version === 'saved-scene-identity-rebind.v1'
    && group.delivery_task_id === receipt.delivery_task_id && group.saved_file_sha256 === receipt.file.sha256
    && group.model_key === modelKey && group.document_binding === documentBinding
    && sha256Canonical(group.member_ids) === sha256Canonical(memberIds)
    && current.private.creation.parameter_source.model_key === modelKey
    && current.private.creation.parameter_source_document_binding === documentBinding) {
    assertDefinitionParameterSourceUnchanged({ sourceRecord: current.private.creation.parameter_source, currentModelGraph: modelGraph });
    if (current.private.creation.saved_scene_identity_rebinding?.pending) {
      const proof = await sign({ ...withoutSignature(current.private.creation.saved_scene_identity_rebinding), pending: false });
      await store.update(current.task_id, { private: { ...current.private, creation: { ...current.private.creation, saved_scene_identity_rebinding: proof } } });
    }
    return structuredClone(current.private.creation.parameter_source);
  }
  if (modelGraph.model_revision !== receipt.post_save_revision) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Saved scene identities require the complete unchanged saved revision before the first edit.');
  const children = await Promise.all(memberIds.map(id => store.getTask(id, { includePrivate: true })));
  const paths = children.flatMap(child => child.private?.creation?.parameter_source?.entries?.map(entry => entry.target.entity_path) || []);
  if (paths.length !== children.length || new Set(paths).size !== paths.length) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Saved scene members need distinct original top-level roots.');
  // An edit's initial summary contains only its selected root. Obtain actual
  // coverage for every saved member before rebinding any source identity.
  const full = await adoptAssemblySummary({ bridge: gateway.bridge, rootPaths: paths, expectedRevision: receipt.post_save_revision, recursiveLimit: 5000, timeoutMs: 300000 });
  if (modelKeyForIdentity(modelIdentityForAdoption(full)) !== modelKey || parameterSourceDocumentBinding(full) !== documentBinding)
    throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The saved scene document changed during identity continuation.');
  const graph = buildModelGraph(full), prepared = [];
  for (const child of children) {
    const binding = savedParameterBindingForSource(receipt, child.task_id), creation = child.private?.creation, record = creation?.parameter_source;
    if (child.intent !== 'create_model' || creation?.parameter_edit_support?.baseline_captured !== true
      || !binding || creation.frozen_spec?.hash !== binding.frozen_specification_hash || record?.creation_task_id !== child.task_id)
      throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Saved scene continuation lost its original creation baseline.');
    let updated;
    if (record.source_record_hash === binding.source_record_hash) updated = rebindDefinitionParameterSource({ sourceRecord: record, currentModelGraph: graph, modelKey, savedReceipt: receipt });
    else {
      const prior = creation.saved_scene_identity_rebinding;
      if (!await authentic(prior) || prior?.version !== 'saved-scene-child-identity-rebind.v1'
        || prior.delivery_task_id !== receipt.delivery_task_id || prior.creation_task_id !== child.task_id
        || prior.saved_source_record_hash !== binding.source_record_hash || prior.bound_source_record_hash !== record.source_record_hash
        || prior.saved_file_sha256 !== receipt.file.sha256 || prior.model_key !== modelKey || record.model_key !== modelKey
        || record.parameter_revision !== binding.parameter_revision || record.runtime !== binding.runtime)
        throw new AgentContractError('MODEL_REVISION_MISMATCH', 'A scene source advanced outside its recorded saved identity continuation.');
      assertDefinitionParameterSourceUnchanged({ sourceRecord: record, currentModelGraph: graph }); updated = record;
    }
    const proof = await sign({ version: 'saved-scene-child-identity-rebind.v1', delivery_task_id: receipt.delivery_task_id,
      creation_task_id: child.task_id, saved_source_record_hash: binding.source_record_hash, bound_source_record_hash: updated.source_record_hash,
      model_key: modelKey, saved_file_sha256: receipt.file.sha256, pending: true });
    prepared.push({ child, updated, proof });
  }
  // Validate all members first. Per-child signed checkpoints make a partial
  // metadata failure resumable; no geometry is staged or written here.
  for (const { child, updated, proof } of prepared) {
    const fresh = await store.getTask(child.task_id, { includePrivate: true });
    if (![child.private.creation.parameter_source.source_record_hash, updated.source_record_hash].includes(fresh.private.creation.parameter_source.source_record_hash))
      throw new AgentContractError('MODEL_REVISION_MISMATCH', 'A scene parameter source advanced during identity continuation.');
    const rebound = await store.update(child.task_id, { private: { ...fresh.private, creation: { ...fresh.private.creation,
      parameter_source: updated, parameter_source_document_binding: documentBinding, saved_scene_identity_rebinding: proof,
      parameter_edit_support: { ...fresh.private.creation.parameter_edit_support, source_record_hash: updated.source_record_hash,
        saved_delivery_task_id: receipt.delivery_task_id, continuation_evidence: 'signed_saved_scene_and_unchanged_all_root_readback', cold_reopen_verified: false } } } });
    await indexCapturedParameterSource({ taskStore: store, task: rebound });
  }
  const freshParent = await store.getTask(parent.task_id, { includePrivate: true });
  const complete = await sign({ version: 'saved-scene-identity-rebind.v1', delivery_task_id: receipt.delivery_task_id,
    model_key: modelKey, document_binding: documentBinding, saved_file_sha256: receipt.file.sha256, member_ids: memberIds });
  await store.update(parent.task_id, { private: { ...freshParent.private,
    saved_scene_identity_rebindings: { ...freshParent.private.saved_scene_identity_rebindings, [receipt.delivery_task_id]: complete } } });
  for (const { child, proof } of prepared) {
    const fresh = await store.getTask(child.task_id, { includePrivate: true });
    await store.update(child.task_id, { private: { ...fresh.private, creation: { ...fresh.private.creation,
      saved_scene_identity_rebinding: await sign({ ...withoutSignature(proof), pending: false }) } } });
  }
  return structuredClone(prepared.find(item => item.child.task_id === sourceTask.task_id).updated);
}

function withoutSignature(proof) { const { integrity_hmac, ...body } = proof; return body; }
