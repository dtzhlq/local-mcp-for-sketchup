import { adoptAssemblySummary } from './model-accessibility-assembly-summary.mjs';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { buildModelGraph } from './model-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { adoptParameterRoots } from './model-accessibility-scoped-readback.mjs';

// A new task verifies the unchanged server-frozen requirements. The original
// completed creation is never reopened, nor are client snapshots/specs accepted.
export async function verifyDefinitionParameterResult(gateway, task) {
  const inputs = task.inputs;
  if (Object.keys(inputs).some(key => !['creation_task_id', 'parameter_task_id', 'runtime', 'connection_task_id', 'session_contract', 'timeout_ms', 'reverify'].includes(key))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Creation-bound verification accepts only the source/parameter task ids and connection; code, snapshots, views and requirements are server-owned.');
  }
  if (!inputs.creation_task_id || !inputs.parameter_task_id) throw new AgentContractError('INVALID_ARGUMENT', 'Verification requires creation_task_id and completed parameter_task_id.');
  const source = await gateway.taskStore.getTask(inputs.creation_task_id, { includePrivate: true });
  const parameter = await gateway.taskStore.getTask(inputs.parameter_task_id, { includePrivate: true });
  const creation = source.private?.creation, record = creation?.parameter_source;
  const execution = parameter.private?.parameter_execution;
  if (source.intent !== 'create_model' || !creation?.frozen_spec || !record || parameter.intent !== 'modify_design_parameters' || parameter.state !== 'completed'
    || parameter.inputs?.parameter_edit?.creation_task_id !== source.task_id || parameter.result?.source_record_hash !== record.source_record_hash
    || parameter.result?.geometry_applied !== true || execution?.phase !== 'completed') throw new AgentContractError('INVALID_ARGUMENT', 'Verification must reference the completed parameter result for this source current version.');
  if (!parameter.private?.creation_parameter_edit?.change_plan) throw new AgentContractError('INVALID_ARGUMENT', 'Cannot verify without a completed parameter change_plan.');
  const { integrity_hmac, ...executionBody } = execution;
  if (integrity_hmac !== await gateway.taskStore.mutationReceiptLedger.sign(executionBody)) throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'Parameter verification requires an intact signed execution record.');
  const runtime = creation.runtime;
  if (inputs.runtime && inputs.runtime !== runtime) throw new AgentContractError('INVALID_ARGUMENT', 'Verification cannot change the source runtime.');
  if (runtime === 'queue' && !inputs.session_contract) return gateway.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'frozen_verification_connection_required', patch: {
    next_action: { action: 'connect_then_submit_verification', required: ['connection_task_id from fresh discover/connect'], task_id: task.task_id,
      tool: 'start_agent_task', arguments: { intent: 'discover', instruction: 'Connect for frozen creation verification.', inputs: { topic: 'connect', runtime: 'queue' } } } } });
  const timeoutMs = inputs.timeout_ms ?? 120000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new AgentContractError('INVALID_ARGUMENT', 'Verification timeout must be within 1..300000 ms.');
  const roots = parameter.private.creation_parameter_edit.change_plan.recursive_roots;
  const assembly=record.readback_projection==='assembly-merkle.v2';
  const adoption = assembly?await adoptAssemblySummary({bridge:gateway.bridge,rootPaths:roots,timeoutMs,recursiveLimit:parameter.private.parameter_recursive_limit||5000}):roots?.length > 1 ? await adoptParameterRoots({ bridge: gateway.bridge, runtime, timeoutMs,
    recursiveLimit: parameter.private.parameter_recursive_limit, rootPaths: roots })
    : await gateway.bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, read_only: true,
      recursive_limit: parameter.private.parameter_recursive_limit, recursive_roots: roots });
  const graph = buildModelGraph(adoption);
  if (!graph.completeness.complete && !graph.completeness.scope_complete && !(assembly&&graph.completeness.assembly_scope_complete)) throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Frozen verification requires complete parameter source subtrees.');
  if (modelKeyForIdentity(modelIdentityForAdoption(adoption)) !== record.model_key || graph.model_revision !== parameter.result.model_revision) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The current model is not the completed parameter edit; preserve intervening changes and reconcile first.');
  const inspected = assembly?null:await gateway.bridge.inspect_model({ runtime, timeoutMs, includeSnapshot: true });
  const snapshot = assembly?{...adoption.snapshot,model_revision:adoption.model_revision,model_revision_complete:adoption.model_revision_complete}:inspected.snapshot;
  if (!snapshot || runtime === 'queue' && (snapshot.model_revision_complete !== true || snapshot.model_revision !== graph.model_revision)) throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Verification requires a fresh complete native snapshot of the bound revision.');
  const binding = { version: 'frozen-creation-verification.v1', creation_task_id: source.task_id, parameter_task_id: parameter.task_id,
    specification_hash: creation.frozen_spec.hash, parameter_source_hash: record.source_record_hash, model_key: record.model_key,
    model_revision: graph.model_revision, views: structuredClone(source.inputs.views || []) };
  const signed = { ...binding, integrity_hmac: await gateway.taskStore.mutationReceiptLedger.sign(binding) };
  const privateCreation = { ...structuredClone(creation), rounds: [], round: { phase: 'verification_snapshot', iteration: 0,
    source_hash: sha256Canonical({ verification_task_id: task.task_id, model_revision: graph.model_revision }), snapshot, captures: [] } };
  task = await gateway.taskStore.update(task.task_id, { inputs: { ...inputs, runtime }, private: { ...task.private,
    creation: privateCreation, frozen_creation_verification: signed } });
  task = await gateway.taskStore.transition(task.task_id, 'verifying', { reason: 'verify_frozen_creation_after_parameter_edit' });
  task = await gateway.finalizeCreationQuality(task);
  return gateway.taskStore.update(task.task_id, { result: { ...task.result, kind: 'verify_creation_result', source_creation_task_id: source.task_id,
    parameter_task_id: parameter.task_id, geometry_built: false, specification_hash: creation.frozen_spec.hash },
    next_action: task.result.quality_accepted ? { action: 'connect_for_delivery', source_task_id: task.task_id }
      : { action: 'reverify_frozen_creation', tool: 'submit_agent_task_input', arguments: { task_id: task.task_id,
        idempotency_key: `${task.task_id}:reverify`, input: { reverify: true } }, quality_accepted: false, remaining: task.result.quality.remaining } });
}
