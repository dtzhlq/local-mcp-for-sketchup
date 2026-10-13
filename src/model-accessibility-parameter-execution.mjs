import { adoptAssemblySummary } from './model-accessibility-assembly-summary.mjs';
import { AgentContractError, sha256Canonical, developmentModelAutoApprovalBinding, serverPolicyAutoApprovalMode } from './agent-contract.mjs';
import { existingModelEditPlanHash } from './existing-model-editing.mjs';
import { buildModelGraph } from './model-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { compareDesignBindingFingerprints } from './design-intent-graph.mjs';
import { validateAssemblyMaterialReferences, finalizeAssemblyParameterEditFromLedger } from './detailed-modeling/assembly-edit.mjs';
import { acceptDefinitionParameterEdit } from './model-accessibility-parameter-edit.mjs';
import { trustedBridgeReceipt } from './task-mutation-receipt-ledger.mjs';
import { adoptParameterRoots } from './model-accessibility-scoped-readback.mjs';

async function writeExecution(gateway, taskId, body) {
  const task = await gateway.taskStore.getTask(taskId, { includePrivate: true });
  const record = { ...body, integrity_hmac: await gateway.taskStore.mutationReceiptLedger.sign(body) };
  return gateway.taskStore.update(taskId, { private: { ...task.private, parameter_execution: record } });
}
async function verifyExecution(gateway, task) {
  const record = task.private?.parameter_execution;
  if (!record) return null;
  const { integrity_hmac, ...body } = record;
  const edit = task.private.creation_parameter_edit;
  const { edit_hash, ...editBody } = edit || {};
  if (body.version !== 'parameter-execution.v1' || body.task_id !== task.task_id || body.edit_hash !== edit_hash
    || edit_hash !== sha256Canonical(editBody) || integrity_hmac !== await gateway.taskStore.mutationReceiptLedger.sign(body)) {
    throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'The private parameter execution journal failed server integrity verification.');
  }
  return body;
}
async function graphFor(gateway, task, edit, includeAdoption = false) {
  const adoption = edit.change_plan.readback_projection === 'assembly-merkle.v2' ? await adoptAssemblySummary({ bridge: gateway.bridge,
    rootPaths: edit.change_plan.recursive_roots, recursiveLimit: task.private.parameter_recursive_limit, timeoutMs: task.private.parameter_timeout_ms }) : edit.change_plan.recursive_roots?.length > 1 ? await adoptParameterRoots({ bridge: gateway.bridge,
    runtime: task.inputs.runtime || task.private.parameter_source_record.runtime, recursiveLimit: task.private.parameter_recursive_limit,
    timeoutMs: task.private.parameter_timeout_ms, rootPaths: edit.change_plan.recursive_roots }) : await gateway.bridge.adopt_open_model({ runtime: task.inputs.runtime || task.private.parameter_source_record.runtime,
    recursive: true, recursive_limit: task.private.parameter_recursive_limit, recursive_roots: edit.change_plan.recursive_roots, read_only: true,
    timeoutMs: task.private.parameter_timeout_ms });
  if (modelKeyForIdentity(modelIdentityForAdoption(adoption)) !== edit.design_graph.model_key) throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'Parameter execution is bound to a different model.');
  const graph = buildModelGraph(adoption);
  if (!graph.completeness.complete && !graph.completeness.scope_complete && !(edit.change_plan.readback_projection === 'assembly-merkle.v2' && graph.completeness.assembly_scope_complete)) throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Parameter execution requires complete selected subtrees.');
  return includeAdoption ? { graph, adoption } : graph;
}
async function verifyOriginalBindings(gateway, task, edit, requireRevision, includeAdoption = false) {
  const observed = await graphFor(gateway, task, edit, includeAdoption);
  const graph = includeAdoption ? observed.graph : observed;
  if (requireRevision && graph.model_revision !== edit.change_plan.model_revision) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Model changed before definition staging.');
  if (compareDesignBindingFingerprints(edit.design_graph, graph).length) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Manual assembly changes require reconciliation before replacement.');
  validateAssemblyMaterialReferences(edit.change_plan.assembly_rebuild.creation_document, graph);
  return observed;
}

// A standing user policy may replace an undecided review. Only the same child,
// same staged definitions and same operations can be rebound. Original source
// fingerprints stay frozen; a signed pending journal covers a process loss
// between preparing the child and updating its parent's plan hash.
async function refreshDevelopmentParameterReview(gateway, task, edit, execution, child) {
  const refreshed = await gateway.withTaskRequestSlot(child.task_id, 'refresh_development_parameter_review', async () => {
    child = await gateway.taskStore.getTask(child.task_id, { includePrivate: true });
    const oldPlan = child.private?.existing_edit_plan;
    const pending = execution.review_refresh_pending;
    const operationsHash = sha256Canonical(edit.change_plan.operations);
    if (!oldPlan || oldPlan.plan_hash !== existingModelEditPlanHash(oldPlan) || oldPlan.model_key !== edit.design_graph.model_key
      || sha256Canonical(oldPlan.dsl_document.operations) !== operationsHash
      || sha256Canonical(child.inputs.operations) !== operationsHash
      || sha256Canonical(child.inputs.targets) !== sha256Canonical(edit.change_plan.targets)
      || (!pending && oldPlan.plan_hash !== execution.reviewed_plan_hash)
      || (pending && (pending.operations_hash !== operationsHash || pending.old_plan_hash !== execution.reviewed_plan_hash))) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'Development review refresh requires the identical original child and replacement operations.');
    }
    if (!['awaiting_review', 'approved', ...(pending ? ['awaiting_input', 'understanding'] : [])].includes(child.state)
      || await gateway.taskStore.loadTaskMutationReceipt(child.task_id, { allowMissing: true })) {
      throw new AgentContractError('MUTATION_RECOVERY_REQUIRED', 'An applied or executing replacement cannot be re-prepared.');
    }
    const source = await gateway.taskStore.getTask(task.inputs.parameter_edit.creation_task_id, { includePrivate: true });
    if (source.private.creation.parameter_source.source_record_hash !== edit.source_record_hash) {
      throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The original parameter source advanced before review refresh.');
    }
    const { graph, adoption } = await verifyOriginalBindings(gateway, task, edit, false, true);
    const developmentBinding = developmentModelAutoApprovalBinding({ executionPolicy: gateway.bridge.executionPolicy,
      modelKey: edit.design_graph.model_key, modelSourcePath: adoption.model_identity?.source_path || adoption.model_info?.source_path,
      riskLevel: oldPlan.risk_level, affectedInstanceCount: oldPlan.affected_instance_count,
      saveModel: oldPlan.execution_contract?.save_model === true, savePath: oldPlan.execution_contract?.save_path });
    if (!developmentBinding || (pending && (pending.model_revision !== graph.model_revision
      || pending.policy_scope_fingerprint !== developmentBinding.policy_scope_fingerprint))) {
      throw new AgentContractError('POLICY_DENIED', 'The current model is outside the user-authorized development scope or changed during refresh.');
    }
    if (!pending) {
      execution = { ...execution, review_refresh_pending: { version: 'parameter-review-refresh.v1',
        old_plan_hash: oldPlan.plan_hash, old_model_revision: oldPlan.model_revision,
        model_revision: graph.model_revision, operations_hash: operationsHash, model_key: oldPlan.model_key,
        policy_scope_fingerprint: developmentBinding.policy_scope_fingerprint, authorization_ref: developmentBinding.authorization_ref } };
      task = await writeExecution(gateway, task.task_id, execution);
    }
    // A newly prepared child can already exist after interruption. Finish that
    // exact journal; otherwise prepare from the unchanged frozen child inputs.
    if (oldPlan.plan_hash === execution.reviewed_plan_hash) {
      if (['awaiting_review', 'approved'].includes(child.state)) child = await gateway.taskStore.transition(child.task_id, 'awaiting_input', { reason: 'development_policy_rebind_same_operations' });
      if (child.state === 'awaiting_input') child = await gateway.taskStore.transition(child.task_id, 'understanding', { reason: 'development_policy_current_source_verified' });
      child = await gateway.prepareReviewedExistingEdit(child);
    }
    const plan = child.private?.existing_edit_plan;
    if (child.state !== 'approved' || !plan || plan.model_key !== edit.design_graph.model_key || plan.model_revision !== graph.model_revision
      || sha256Canonical(plan.dsl_document.operations) !== operationsHash
      || serverPolicyAutoApprovalMode(plan, gateway.bridge.executionPolicy) !== 'server_policy_development_models'
      || plan.development_model_auto_approval.binding_hash !== developmentBinding.binding_hash) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'The refreshed child does not match the current source, staged operations and user policy.');
    }
    const audit = { ...execution.review_refresh_pending, new_plan_hash: plan.plan_hash, source_fingerprints_unchanged: true };
    const { review_refresh_pending: ignored, ...body } = execution;
    execution = { ...body, reviewed_plan_hash: plan.plan_hash, review_refresh_audit: [...(body.review_refresh_audit || []), audit] };
    task = await writeExecution(gateway, task.task_id, execution);
    return { task, execution, child };
  });
  if (refreshed.error) throw new AgentContractError(refreshed.error.code, refreshed.error.message);
  return refreshed;
}

// Staging has one signed started/committed journal under the same server ledger
// authority as pending assembly mappings. A started-only state is deliberately
// outcome_unknown. No resume, new submission key or process restart can replay it.
export async function continueDefinitionParameterExecution(gateway, task, { input = {}, idempotencyKey, submit = false } = {}) {
  const edit = task.private.creation_parameter_edit;
  let execution = await verifyExecution(gateway, task);
  if (task.state === 'completed') return task;
  const runtime = task.private.parameter_source_record.runtime;
  if (!execution) {
    if (!edit?.ready) throw new AgentContractError('INVALID_ARGUMENT', 'A ready creation-bound parameter plan is required.');
    if (runtime === 'queue' && (!gateway.bridge.executionPolicy.allow_queue_mutation || !gateway.bridge.executionPolicy.allowed_runtimes.includes('queue'))) throw new AgentContractError('POLICY_DENIED', 'The server does not allow queue parameter mutation.');
    let session = input.session_contract || task.inputs.session_contract;
    if (runtime === 'queue' && !session) throw new AgentContractError('HANDSHAKE_REQUIRED', 'A fresh queue connection is required for unused-definition staging.');
    // Authenticate the submitted connection before any refresh. A slow native
    // read may then outlive it, but never supplies authority to change documents.
    if (runtime === 'queue') await gateway.bridge.sessionContractAuthority.verify(session, { operation: 'parameter_staging' });
    const stagingGraph = await verifyOriginalBindings(gateway, task, edit, true);
    if (runtime === 'queue') {
      const fresh = (await gateway.bridge.create_queue_handshake({ timeoutMs: task.private.parameter_timeout_ms, expires_in_ms: Math.min(300000, Math.max(120000, task.private.parameter_timeout_ms)) })).session_contract;
      if (fresh.session_id !== session.session_id || fresh.document_id !== session.document_id
        || sha256Canonical(fresh.model_identity) !== sha256Canonical(session.model_identity)
        || fresh.model_revision !== stagingGraph.model_revision) {
        throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The document or model changed while refreshing the parameter staging connection.');
      }
      session = fresh;
    }
    execution = { version: 'parameter-execution.v1', task_id: task.task_id, edit_hash: edit.edit_hash, phase: 'staging_started',
      creation_sha256: edit.change_plan.assembly_rebuild.creation_sha256, source_record_hash: edit.source_record_hash };
    task = await writeExecution(gateway, task.task_id, execution);
    if (task.state === 'awaiting_review') task = await gateway.taskStore.transition(task.task_id, 'approved', { reason: 'parameter_staging_requested' });
    task = await gateway.taskStore.transition(task.task_id, 'executing', { reason: 'parameter_fresh_definitions_started' });
    const built = await gateway.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, scoped => scoped.withLiveMutationAuthorization({
      runtime, timeoutMs: task.private.parameter_timeout_ms, session_contract: session, operation: 'build_model'
    }, authorized => authorized.build_model({ runtime, timeoutMs: task.private.parameter_timeout_ms, code: JSON.stringify(edit.change_plan.assembly_rebuild.creation_document), snapshot_detail:edit.change_plan.readback_projection!=='assembly-merkle.v2' })));
    const receipt = runtime === 'queue' ? trustedBridgeReceipt({ runtime, nativeReceipt: built.mutation_receipt })
      : { source: 'isolated_mock_build_return', snapshot_hash: sha256Canonical(built.snapshot) };
    execution = { ...execution, phase: 'staging_committed', staging_receipt: receipt, staging_result_hash: sha256Canonical(built),
      staged_model_revision: built.snapshot?.model_revision || null };
    task = await writeExecution(gateway, task.task_id, execution);
  } else if (execution.phase === 'staging_started') {
    if (runtime !== 'queue') throw new AgentContractError('MUTATION_EXECUTION_FAILED', 'Definition staging started without a trusted committed return; it will not be replayed.', { details: { outcome_unknown: true, stage: 'definition_staging' } });
    const sourceTask = await gateway.taskStore.getTask(task.inputs.parameter_edit.creation_task_id, { includePrivate: true });
    const originalRoots = sourceTask.private.creation.round.snapshot.instances.map(row => ({
      id: row.id, persistent_id: row.persistent_id, definition: row.definition
    }));
    const stagedNames = edit.change_plan.assembly_rebuild.creation_document.creation_scope.definitions;
    const startedAt = task.history.find(item => item.reason === 'parameter_fresh_definitions_started')?.at;
    const queue = gateway.bridge.selectRuntime('queue', { timeoutMs: Math.max(900_000, task.private.parameter_timeout_ms) });
    await queue.recoverCommittedParameterStaging({ roots: originalRoots, definitions: stagedNames, startedAt,
      session: sourceTask.inputs.session_contract,
      persist: async ({ request_id, snapshot }) => {
        const built = { snapshot, mutation_receipt: snapshot.mutation_receipt };
        execution = { ...execution, phase: 'staging_committed', staging_receipt: trustedBridgeReceipt({ runtime, nativeReceipt: snapshot.mutation_receipt }),
          staging_result_hash: sha256Canonical(built), staged_model_revision: snapshot.model_revision,
          late_response_request_id: request_id };
        task = await writeExecution(gateway, task.task_id, execution);
      } });
  }
  if (!execution.reviewed_task_id) {
    const graph = await verifyOriginalBindings(gateway, task, edit, false);
    const childArgs = { intent: 'reviewed_existing_model_edit', instruction: task.instruction, interface_level: task.interface_level,
      idempotency_key: `${task.task_id}:parameter-definition-replacement:v1`,
      inputs: { runtime, targets: edit.change_plan.targets, operations: edit.change_plan.operations,
        recursive_limit: task.private.parameter_recursive_limit, timeout_ms: task.private.parameter_timeout_ms,
        ...(edit.change_plan.recursive_roots ? { recursive_roots: edit.change_plan.recursive_roots } : {}),
        readback_projection: edit.change_plan.readback_projection, save_model: false, capture_view: false } };
    const childEnvelope = await gateway.startUnprojected(childArgs);
    const child = await gateway.taskStore.getTask(childEnvelope.task_id, { includePrivate: true });
    const reviewedPlan = child.private?.existing_edit_plan;
    if (!reviewedPlan || reviewedPlan.model_key !== edit.design_graph.model_key || reviewedPlan.model_revision !== graph.model_revision
      || sha256Canonical(reviewedPlan.dsl_document.operations) !== sha256Canonical(edit.change_plan.operations)) throw new AgentContractError('PLAN_HASH_MISMATCH', 'Prepared parameter review does not match the staged replacement and model revision.');
    execution = { ...execution, phase: 'awaiting_review', reviewed_task_id: child.task_id, reviewed_plan_hash: reviewedPlan.plan_hash };
    task = await writeExecution(gateway, task.task_id, execution);
  }
  let child = await gateway.taskStore.getTask(execution.reviewed_task_id, { includePrivate: true });
  if (execution.review_refresh_pending || (submit && gateway.bridge.executionPolicy.development_model_auto_approval?.enabled === true
    && ['awaiting_review', 'approved'].includes(child.state)
    && serverPolicyAutoApprovalMode(child.private?.existing_edit_plan, gateway.bridge.executionPolicy) !== 'server_policy_development_models')) {
    ({ task, execution, child } = await refreshDevelopmentParameterReview(gateway, task, edit, execution, child));
  }
  if (child.private?.existing_edit_plan?.plan_hash !== execution.reviewed_plan_hash) throw new AgentContractError('PLAN_HASH_MISMATCH', 'The bound reviewed child plan changed.');
  if (child.state === 'awaiting_review') child = await gateway.refreshLocalApprovalState(child);
  if (submit && ['awaiting_review', 'approved'].includes(child.state)) {
    if (!idempotencyKey) throw new AgentContractError('INVALID_ARGUMENT', 'Parameter application requires a stable submission idempotency key.');
    const response = await gateway.submitUnprojected({ task_id: child.task_id, idempotency_key: `${task.task_id}:apply:${idempotencyKey}`, input });
    if (response.error) throw new AgentContractError(response.error.code || 'MUTATION_RECOVERY_REQUIRED', response.error.message || 'Reviewed parameter application requires recovery.');
  } else if (['executing', 'verifying'].includes(child.state)) {
    const response = await gateway.resumeUnprojected({ task_id: child.task_id });
    if (response.error) throw new AgentContractError(response.error.code || 'MUTATION_RECOVERY_REQUIRED', response.error.message || 'Reviewed parameter application requires recovery.');
  }
  child = await gateway.taskStore.getTask(child.task_id, { includePrivate: true });
  if (child.state !== 'completed') return presentReview(gateway, task, child);
  const applied = await finalizeAssemblyParameterEditFromLedger({ bridge: gateway.bridge, reviewedTaskId: child.task_id,
    designGraph: edit.design_graph, changePlan: edit.change_plan, runtime, timeoutMs: task.private.parameter_timeout_ms,
    recursiveLimit: task.private.parameter_recursive_limit });
  const updated = acceptDefinitionParameterEdit({ sourceRecord: task.private.parameter_source_record, edit, applied });
  const sourceTask = await gateway.taskStore.getTask(task.inputs.parameter_edit.creation_task_id, { includePrivate: true });
  const currentHash = sourceTask.private.creation.parameter_source.source_record_hash;
  if (![edit.source_record_hash, updated.source_record_hash].includes(currentHash)) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Another parameter version advanced this creation source.');
  // Mapping journals the actual brand before its slow readback. On restart the
  // reviewed child ledger re-establishes the brand without another replacement.
  await gateway.recordTrustedAssemblyEditMapping({ creation_task_id: sourceTask.task_id, receipt: applied.assembly_edit_receipt });
  const latestSource = await gateway.taskStore.getTask(sourceTask.task_id, { includePrivate: true });
  await gateway.taskStore.update(sourceTask.task_id, { private: { ...latestSource.private, creation: { ...latestSource.private.creation,
    parameter_source: updated, parameter_edit_support: { ...latestSource.private.creation.parameter_edit_support, execution_available: true,
      source_record_hash: updated.source_record_hash, blockers: [] } } } });
  execution = { ...execution, phase: 'completed', parameter_source_hash_after: updated.source_record_hash, model_revision_after: applied.model_graph.model_revision };
  task = await writeExecution(gateway, task.task_id, execution);
  if (task.state === 'awaiting_review') task = await gateway.taskStore.transition(task.task_id, 'approved', { reason: 'reviewed_child_committed' });
  if (['approved', 'awaiting_input', 'understanding'].includes(task.state)) task = await gateway.taskStore.transition(task.task_id, 'executing', { reason: 'recording_reviewed_parameter_result' });
  if (task.state === 'executing') task = await gateway.taskStore.transition(task.task_id, 'verifying', { reason: 'parameter_receipt_readback_verified' });
  return gateway.taskStore.transition(task.task_id, 'completed', { reason: 'parameter_edit_applied_and_bound', patch: { last_error: null,
    result: { kind: 'modify_design_parameters_result', stage: 'applied', reviewed_task_id: child.task_id, scope: edit.change_plan.assembly_rebuild.scope,
      replaced_instance_count: applied.replaced_instance_count, model_revision: applied.model_graph.model_revision,
      source_record_hash: updated.source_record_hash, definitions_staged: true, geometry_applied: true,
      quality_accepted: false, quality_status: 'not_evaluated', evidence_level: runtime === 'queue' ? 'live_runtime_edit_readback' : 'mock_reviewed_edit',
      saved: false, blockers: [], quality_followup: 'verify_frozen_creation_in_new_task' },
    next_action: { action: 'verify_frozen_creation_in_new_task', tool: 'start_agent_task', arguments: {
      intent: 'verify_model', instruction: 'Verify the original frozen detailed-quality requirements after the reviewed parameter edit.',
      idempotency_key: `${task.task_id}:verify`, inputs: { runtime, creation_task_id: sourceTask.task_id, parameter_task_id: task.task_id } }, quality_accepted: false } } });
}

async function presentReview(gateway, task, child) {
  if (!['awaiting_review', 'approved'].includes(child.state)) throw new AgentContractError('MUTATION_RECOVERY_REQUIRED', 'The bound reviewed child is not ready or completed; inspect that same task.');
  if (task.state === 'executing') task = await gateway.taskStore.transition(task.task_id, 'verifying', { reason: 'unused_definitions_committed' });
  const patch = { last_error: null, result: { kind: 'modify_design_parameters_result', stage: 'awaiting_review', reviewed_task_id: child.task_id,
    approval_challenge: child.result.approval_challenge, plan_id: child.result.plan_id, plan_hash: child.result.plan_hash,
    definitions_staged: true, geometry_applied: false, execution_allowed: false, quality_accepted: false, quality_status: 'not_evaluated',
    evidence_level: child.inputs.runtime === 'queue' ? 'native_fresh_definitions_staged' : 'mock_fresh_definitions_staged', blockers: [] },
    next_action: { ...child.next_action, parameter_task_id: task.task_id, execution_task_id: child.task_id,
      then_tool: 'submit_agent_task_input', arguments: { task_id: task.task_id }, approval_binding: 'reviewed_child_task' } };
  return task.state === 'awaiting_review' ? gateway.taskStore.update(task.task_id, patch)
    : gateway.taskStore.transition(task.task_id, 'awaiting_review', { reason: 'parameter_replacement_review_required', patch });
}

export async function parameterExecutionError(gateway, task, error) {
  const current = await gateway.taskStore.getTask(task.task_id, { includePrivate: true });
  const childId = current.private?.parameter_execution?.reviewed_task_id;
  const child = childId ? await gateway.taskStore.getTask(childId, { includePrivate: true }) : null;
  const committed = childId ? await gateway.taskStore.loadTaskMutationReceipt(childId, { allowMissing: true }).catch(() => null) : null;
  const unknown = !committed && (current.private?.parameter_execution?.phase === 'staging_started' || ['executing', 'verifying'].includes(child?.state)
    || error.code === 'MUTATION_RECEIPT_INVALID' || /^MUTATION_(EXECUTION_FAILED|RECOVERY_REQUIRED)/.test(child?.last_error?.code || ''));
  const needsApproval = /^APPROVAL_/.test(error.code || '') && child?.next_action;
  return gateway.taskStore.update(task.task_id, { last_error: { code: error.code || 'MUTATION_RECOVERY_REQUIRED', message: String(error.message), retryable: false, ...(error.details ? { details: error.details } : {}) },
    result: { ...(current.result || {}), kind: 'modify_design_parameters_result', geometry_applied: committed ? true : unknown ? null : false,
      execution_allowed: false, quality_accepted: false, quality_status: 'not_evaluated', saved: false,
      evidence_level: committed ? 'signed_mutation_receipt_pending_readback' : unknown ? 'outcome_not_established' : current.result?.evidence_level || 'not_established',
      stage: committed ? 'committed_pending_finalization' : unknown && child ? 'replacement_outcome_unknown' : current.private?.parameter_execution?.phase || 'before_staging', outcome_unknown: unknown },
    next_action: needsApproval ? { ...child.next_action, parameter_task_id: task.task_id, execution_task_id: child.task_id, arguments: { task_id: task.task_id } }
      : { action: 'resume_agent_task', tool: 'resume_agent_task', arguments: { task_id: task.task_id }, reason: 'Resume the same parameter task; no stage or replacement is replayed.' } });
}
