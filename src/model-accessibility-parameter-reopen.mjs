import path from 'node:path';
import { AgentContractError } from './agent-contract.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { readVerifiedModelAccessibilitySavedReceipt } from './model-accessibility-delivery.mjs';
import { rebindDefinitionParameterSource } from './model-accessibility-parameter-edit.mjs';
import { indexCapturedParameterSource, parameterSourceDocumentBinding } from './model-accessibility-parameter-discovery.mjs';

/** Identity continuation never opens a file or adopts current geometry as a new
 * baseline. A user/runtime must already have opened the exact saved copy. */
export async function resumeSavedDefinitionParameterSource({ gateway, sourceTask, deliveryTaskId, adoption, modelGraph } = {}) {
  const receipt = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: gateway.taskStore, deliveryTaskId });
  const record = sourceTask.private.creation.parameter_source;
  const sourcePath = adoption.model_identity?.source_path || adoption.model_info?.source_path;
  if (!sourcePath || path.resolve(sourcePath) !== receipt.file_path) throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'Open the exact unchanged server delivery copy before continuing its parameters.');
  if (!receipt.parameter_binding) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'This delivery has no verifiable saved parameter source binding.');
  if (receipt.parameter_binding.creation_task_id !== sourceTask.task_id
    || receipt.source_binding.frozen_specification_hash !== sourceTask.private.creation.frozen_spec.hash) throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'This delivery does not bind the original creation and frozen specification.');
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
