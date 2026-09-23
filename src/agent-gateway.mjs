import { TIMBER_QUALITY_SCOPE, readTimberQualitySummary, evaluateTimberQuality, captureTimberOverview, recoverTimberOverview } from './traditional-timber/quality.mjs';
import { adoptAssemblySummary, rootPathsFromCommittedSnapshot } from './model-accessibility-assembly-summary.mjs';
import {captureCreationQaBaseline,applyCreationQaScope} from './creation-qa-scope.mjs';
import { continueModelProgram } from './model-program.mjs';
import { prepareImageStructure, prepareImageModelCreation, approveImageModelCreation, assertFrozenImageCreation } from './image-structure.mjs';
import { narrowDetailLayoutQa } from './detail-collision-review.mjs';
import { prepareNativeAssetEdit } from './model-accessibility-asset-edit.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AgentContractError,
  canonicalJson,
  createResultEnvelope,
  markUntrustedData,
  normalizeClientCapabilities,
  normalizeAgentError,
  serverPolicyAutoApprovalMode,
  sha256Canonical
} from './agent-contract.mjs';
import { prepareAgentGatewayCreationDsl, prepareTaskOwnedCreationDsl } from './agent-dsl-policy.mjs';
import { freezeDetailSpecification, evaluateDetailQuality } from './detail-quality.mjs';
import { isTrustedAssemblyEditReceipt } from './detailed-modeling/assembly-edit.mjs';
import {
  capabilitySafeArtifact,
  createAgentResponsePolicy,
  normalizeTrustedAgentResponsePolicy,
  presentAgentResultEnvelope,
  responsePolicyForTask,
  trustedAgentResponsePolicyFromEnvironment
} from './agent-response-projection.mjs';
import {
  EXISTING_MODEL_EDIT_PLAN_VERSION,
  canPrepareExistingModelEditFromStructuralGroups,
  existingModelEditApprovalReviewContext,
  existingModelEditPlanHash,
  modelRevisionForAdoption,
  observeExistingModelEditExecutionState,
  verifyAssemblyReplacementReadback
} from './existing-model-editing.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { buildModelGraph } from './model-graph.mjs';
import { ModelGraphStore } from './model-graph-store.mjs';
import { planExistingModelEditDiscovery, proposeExistingModelEdit } from './existing-model-edit-proposer.mjs';
import {
  acceptReconciliation,
  buildDesignIntentGraph,
  planDesignParameterChange,
  reconcileDesignIntentGraph,
  writeDesignArtifact
} from './design-intent-graph.mjs';
import { DesignIntentStore } from './design-intent-store.mjs';
import { ImmutableImageArtifactStore } from './image-artifact-store.mjs';
import { LiveVisualCaptureService } from './live-visual-capture.mjs';
import { projectRoot } from './paths.mjs';
import {
  VISUAL_APPLY_RECEIPT_VERSION,
  VISUAL_CAPTURE_PROVENANCE_VERSION,
  analyzeReferenceImageCorrection,
  buildVisualCorrectionSourceLineage,
  verifyReferenceImageCorrection,
  visualCorrectionApplyReceiptHash
} from './visual-correction.mjs';
import {
  TASK_MUTATION_FINALIZER_VERSION,
  trustedBridgeReceipt
} from './task-mutation-receipt-ledger.mjs';
import { publicCopyFastSessionSummary } from './copy-fast-session.mjs';
import { compileModelAccessibilityTask, getModelAccessibilityTaskCatalog } from './model-accessibility-tasks.mjs';
import { accessibilityStatus, discoverCall, FIRST_USE_GUIDE } from './model-accessibility-guidance.mjs';
import { getModelAccessibilityWorkflowGuide } from './model-accessibility-workflows.mjs';
import { deliverModelAccessibilityTask } from './model-accessibility-delivery.mjs';
import { captureDefinitionParameterSource, planDefinitionParameterEdit } from './model-accessibility-parameter-edit.mjs';
import { continueDefinitionParameterExecution, parameterExecutionError } from './model-accessibility-parameter-execution.mjs';
import { prepareNativeAppearanceTask, continueNativeAppearanceTask, verifyNativeAppearanceAuthorizationReady, validateNativeAppearanceSubmission } from './model-accessibility-appearance.mjs';
import { verifyDefinitionParameterResult } from './model-accessibility-parameter-verification.mjs';
import { resumeSavedDefinitionParameterSource } from './model-accessibility-parameter-reopen.mjs';
import { reopenDeliveredModelTask, reopenDeliveredModelError, validateReopenDeliveredInput } from './model-accessibility-reopen.mjs';
import { attachHostCreationPacket, prepareHostCreationDsl, verifyHostCreationCapture } from './model-accessibility-host-provisioning.mjs';
import { indexCapturedParameterSource, discoverParameterSources, parameterSourceDocumentBinding } from './model-accessibility-parameter-discovery.mjs';
import { adoptParameterRoots } from './model-accessibility-scoped-readback.mjs';

const SUPPORTED_INTENTS = new Set(['program_model', 'discover', 'preflight_model', 'deliver_model', 'reopen_delivered_model', 'apply_native_appearance', 'create_model', 'understand_model', 'propose_existing_model_edit', 'modify_design_parameters', 'reconcile_design_intent', 'reference_image_correction', 'visual_correction_qa', 'reviewed_existing_model_edit', 'image_artifact', 'verify_model']);

export class AgentGateway {
  constructor({ bridge, taskStore, modelGraphStore, designIntentStore, imageArtifactStore, liveVisualCaptureService, responsePolicy } = {}) {
    if (!bridge || !taskStore) throw new Error('AgentGateway requires bridge and taskStore');
    this.bridge = bridge;
    this.taskStore = taskStore;
    this.modelGraphStore = modelGraphStore || new ModelGraphStore({ rootDir: path.join(taskStore.rootDir, 'model-graphs') });
    this.designIntentStore = designIntentStore || new DesignIntentStore({ rootDir: path.join(taskStore.rootDir, 'design-intents') });
    this.imageArtifactStore = imageArtifactStore || new ImmutableImageArtifactStore({
      rootDir: path.join(taskStore.rootDir, 'image-artifacts-v1'),
      allowedRoots: visualAllowedRoots(taskStore.rootDir)
    });
    this.liveVisualCaptureService = liveVisualCaptureService || new LiveVisualCaptureService({
      imageArtifactStore: this.imageArtifactStore,
      tempRoot: path.join(taskStore.rootDir, 'live-visual-capture-tmp')
    });
    this.trustedResponsePolicy = normalizeTrustedAgentResponsePolicy(
      responsePolicy ?? trustedAgentResponsePolicyFromEnvironment()
    );
  }

  approvalNextAction(challenge, { required = [] } = {}) {
    if (!challenge) return { action: 'request_user_approval' };
    return {
      action: 'request_user_approval',
      challenge,
      approval_host: {
        version: 'local-approval-host.v1',
        url: this.bridge.approvalAuthority.approvalUrl(challenge.challenge_id),
        challenge_id: challenge.challenge_id,
        user_presence_required: true
      },
      then_tool: 'submit_agent_task_input',
      required
    };
  }

  async resolveTrustedApproval(challenge, expected = {}) {
    if (!challenge?.challenge_id) {
      throw new AgentContractError('APPROVAL_REQUIRED', 'This task has no server-persisted approval challenge.');
    }
    const stored = await this.bridge.approvalAuthority.readStoredApprovalAuthorization(challenge, expected);
    return { approval_token: stored.approval_token, local_decision: stored.decision };
  }

  async verifyTaskAuthorizationReady({ task_id } = {}) {
    const taskId = String(task_id || '');
    if (!/^task_[0-9a-f-]+$/i.test(taskId)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'verify_task_authorization_ready requires a valid task_id.');
    }
    const task = await this.taskStore.getTask(taskId, { includePrivate: true });
    if (task.private?.image_model_creation && task.state === 'awaiting_review') {
      const {challenge,binding}=task.private.image_model_creation;
      return this.bridge.approvalAuthority.verifyStoredApprovalAuthorizationReady(challenge,binding);
    }
    if (task.intent === 'apply_native_appearance') return verifyNativeAppearanceAuthorizationReady(this, task);
    if (task.inputs?.parameter_edit && task.private?.parameter_execution?.reviewed_task_id) {
      const ready = await this.verifyTaskAuthorizationReady({ task_id: task.private.parameter_execution.reviewed_task_id });
      return { ...ready, task_id: task.task_id, execution_task_id: task.private.parameter_execution.reviewed_task_id };
    }
    const binding = reviewedTaskAuthorizationBinding(task, this.bridge.executionPolicy);
    const serverAutoApproval = serverPolicyAutoApprovalMode(binding.plan, this.bridge.executionPolicy);
    if (serverAutoApproval) {
      const copyFastSession = serverAutoApproval === 'copy_fast_session'
        ? this.bridge.copyFastSessionAuthority.verify(binding.plan.copy_fast_session, {
          scopeBinding: binding.plan.trusted_model_copy_auto_approval,
          modelKey: binding.plan.model_key,
          runtime: binding.plan.runtime
        })
        : null;
      return {
        kind: 'agent_task_authorization_readiness',
        ok: true,
        task_id: task.task_id,
        plan_id: binding.plan.plan_id,
        plan_hash: binding.plan.plan_hash,
        model_revision: binding.plan.model_revision,
        risk_level: binding.plan.risk_level,
        challenge_id: binding.challenge?.challenge_id || null,
        approval_status: serverAutoApproval === 'copy_fast_session'
          ? 'copy_fast_active'
          : 'server_policy_auto_approved',
        approved_by: serverAutoApproval === 'copy_fast_session'
          ? 'execution-policy:copy-fast-session'
          : 'execution-policy:S1',
        approval_token_exposed: false,
        review_context_hash: binding.reviewContextHash,
        allowed_operations: binding.allowedOperations,
        user_action_required: false,
        ...(copyFastSession ? { copy_fast_session: copyFastSession } : {})
      };
    }
    const ready = await this.bridge.approvalAuthority.verifyStoredApprovalAuthorizationReady(
      binding.challenge,
      binding.expectedAuthorization
    );
    return {
      kind: 'agent_task_authorization_readiness',
      ok: true,
      task_id: task.task_id,
      plan_id: binding.plan.plan_id,
      plan_hash: binding.plan.plan_hash,
      model_revision: binding.plan.model_revision,
      risk_level: binding.plan.risk_level,
      challenge_id: binding.challenge.challenge_id,
      approval_status: ready.decision.status,
      approval_token_exposed: false,
      review_context_hash: binding.reviewContextHash,
      allowed_operations: binding.allowedOperations,
      decision_id: ready.decision.decision_id,
      approved_by: ready.authorization.approved_by,
      expires_at: ready.authorization.expires_at
    };
  }

  async refreshLocalApprovalState(task) {
    if (task?.state !== 'awaiting_review') return task;
    const challenge = task.result?.approval_challenge
      || task.private?.design_reconciliation_approval
      || task.private?.approval_challenge;
    if (!challenge?.challenge_id) return task;
    if (task.intent === 'reviewed_existing_model_edit') {
      const binding = reviewedTaskAuthorizationBinding(task, this.bridge.executionPolicy);
      const autoApprovalMode = serverPolicyAutoApprovalMode(binding.plan, this.bridge.executionPolicy);
      if (autoApprovalMode) {
        const nextAction = serverPolicySubmissionNextAction({
          runtime: task.inputs?.runtime || 'mock',
          autoApprovalMode,
          plan: binding.plan
        });
        if (task.last_error === null && canonicalJson(task.next_action) === canonicalJson(nextAction)) return task;
        return this.taskStore.update(task.task_id, { last_error: null, next_action: nextAction });
      }
    }
    const decision = await this.bridge.approvalAuthority.readDecision(challenge.challenge_id, { allowMissing: true });
    if (!decision) {
      const nextAction = this.approvalNextAction(challenge, {
        required: task.intent === 'apply_native_appearance' ? ['connection_task_id', 'stable submit idempotency_key'] : (task.inputs?.runtime || 'mock') === 'queue' && task.intent === 'reviewed_existing_model_edit'
          ? ['session_contract']
          : []
      });
      if (canonicalJson(task.next_action) === canonicalJson(nextAction)) return task;
      return this.taskStore.update(task.task_id, { next_action: nextAction });
    }
    if (decision.decision === 'approved') {
      const patch = {
        last_error: null,
        next_action: {
          action: 'submit_task_input',
          then_tool: 'submit_agent_task_input',
          approval_status: decision.status,
          approval_decision_id: decision.decision_id,
          required: task.intent === 'apply_native_appearance' ? ['connection_task_id', 'stable submit idempotency_key'] : (task.inputs?.runtime || 'mock') === 'queue' && task.intent === 'reviewed_existing_model_edit'
            ? ['session_contract']
            : []
        }
      };
      if (task.last_error === null && canonicalJson(task.next_action) === canonicalJson(patch.next_action)) return task;
      return this.taskStore.update(task.task_id, patch);
    }
    const denied = normalizeAgentError(new AgentContractError('POLICY_DENIED', 'The trusted local user rejected this approval challenge.', {
      nextAction: { action: 'start_new_task', reason: 'trusted_user_rejected' }
    }));
    const patch = {
      last_error: denied,
      next_action: denied.next_action
    };
    if (canonicalJson(task.last_error) === canonicalJson(patch.last_error) && canonicalJson(task.next_action) === canonicalJson(patch.next_action)) return task;
    return this.taskStore.update(task.task_id, patch);
  }

  async start(options = {}) {
    return this.presentTaskEnvelope(await this.startUnprojected(options));
  }

  async startUnprojected(options = {}) {
    assertNoPublicApprovalToken(options);
    const { intent, instruction, interface_level = 'guided', client_capabilities = {}, idempotency_key, inputs = {} } = options;
    if (!SUPPORTED_INTENTS.has(intent)) throw new AgentContractError('INVALID_ARGUMENT', 'intent is not supported by Agent Contract v1.');
    if (intent === 'program_model' && !idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Program requires a stable idempotency_key');
    if (intent === 'create_model' && inputs.task && !idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Common-task creation requires an idempotency_key retained across retries.', { details: { recovery_class: 'self_correctable', issues: [{ path: '/idempotency_key', message: 'Provide a stable unique request key.' }] } });
    if (intent === 'deliver_model' && !idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Delivery requires a stable idempotency_key.');
    if (intent === 'reopen_delivered_model') {
      if (!idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Saved close/reopen requires a stable idempotency_key.');
      validateReopenDeliveredInput(inputs);
    }
    if (intent === 'apply_native_appearance' && !idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Native appearance requires a stable idempotency_key.');
    if (intent === 'modify_design_parameters' && inputs.parameter_edit && !idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Parameter replacement requires a stable idempotency_key.');
    const durableInputs = await this.materializeConnectionInput(await this.materializeTransientImageInputs(intent, inputs));
    const capabilities = normalizeClientCapabilities(client_capabilities);
    const responsePolicy = createAgentResponsePolicy({
      interfaceLevel: interface_level,
      clientCapabilities: capabilities,
      trustedPolicy: this.trustedResponsePolicy
    });
    const serverIdempotencyKey = sourcePromotionIdempotencyKey(intent, durableInputs) || idempotency_key;
    const created = await this.taskStore.createTask({
      intent,
      interfaceLevel: responsePolicy.interface_level,
      instruction,
      clientCapabilities: capabilities,
      executionPolicy: this.bridge.executionPolicy,
      responsePolicy,
      inputs: durableInputs,
      idempotencyKey: serverIdempotencyKey
    });
    // The option brand is only constructible by local host code. It is never
    // serialized into MCP inputs. Persist its signed source before execution.
    await attachHostCreationPacket({ options, task: await this.taskStore.getTask(created.task.task_id, { includePrivate: true }), taskStore: this.taskStore });
    const resumeRecoveredCreation = created.replayed && created.recovered_pending === true && created.task.state === 'created';
    if (created.replayed && !resumeRecoveredCreation) {
      const publicTask = await this.taskStore.getTask(created.task.task_id);
      return createResultEnvelope({
        task: publicTask,
        ok: !publicTask.last_error,
        error: publicTask.last_error || null,
        data: responseData(publicTask),
        idempotentReplay: true
      });
    }

    let task = await this.taskStore.transition(created.task.task_id, 'understanding', {
      reason: 'gateway_started',
      patch: { next_action: { action: 'continue_server_work' } }
    });
    try {
      task = await this.runIntent(task);
      return createResultEnvelope({
        task: await this.taskStore.getTask(task.task_id),
        ...((task.inputs?.parameter_edit || task.intent==='program_model') ? { ok: !task.last_error && task.state!=='failed', error: task.last_error || null } : {}),
        data: responseData(task)
      });
    } catch (error) {
      return this.handleTaskError(task, error);
    }
  }

  async resume(options = {}) {
    return this.withTaskRequestSlot(options.task_id, 'resume_agent_task', async () => (
      this.presentTaskEnvelope(await this.resumeUnprojected(options))
    ));
  }

  async resumeUnprojected({ task_id } = {}) {
    let task = await this.taskStore.getTask(task_id, { includePrivate: true });
    if (task.intent === 'create_model' && task.private?.creation?.timber_rule_binding
      && ['executing', 'failed'].includes(task.state) && !task.private.creation.round.snapshot) {
      try {
        task = await this.recoverLateTimberCreation(task);
        task = await this.finalizeCreationQuality(task);
        return createResultEnvelope({task: await this.taskStore.getTask(task_id), data: responseData(task), idempotentReplay: true});
      } catch (error) { return this.mutationRecoveryEnvelope(task, error); }
    }
    if(task.intent==='program_model') {
      try {task=await continueModelProgram(this,task);return createResultEnvelope({task:await this.taskStore.getTask(task_id),ok:!task.last_error && task.state!=='failed',error:task.last_error||null,data:responseData(task)});}
      catch(error){return this.handleTaskError(task,error);}
    }

    if (task.intent === 'reopen_delivered_model') {
      try {
        task = await reopenDeliveredModelTask(this, task, { resume: true });
        return createResultEnvelope({ task: await this.taskStore.getTask(task_id), ok: !task.last_error, error: task.last_error || null, data: responseData(task) });
      } catch (error) { return this.handleTaskError(task, error); }
    }
    if (task.intent === 'apply_native_appearance' && task.private?.appearance_plan) {
      try {
        task = await continueNativeAppearanceTask(this, task);
        return createResultEnvelope({ task: await this.taskStore.getTask(task_id), ok: !task.last_error, error: task.last_error || null, data: responseData(task) });
      } catch (error) { return this.handleTaskError(task, error); }
    }
    if (task.inputs?.parameter_edit && task.private?.parameter_execution) return this.continueParameterTaskEnvelope(task, {});
    if (task.intent === 'verify_model' && task.inputs?.creation_task_id && task.state === 'verifying') {
      try {
        task = await verifyDefinitionParameterResult(this, task);
        return createResultEnvelope({ task: await this.taskStore.getTask(task_id), data: responseData(task), idempotentReplay: true });
      } catch (error) { return this.handleTaskError(task, error); }
    }
    if (task.intent === 'deliver_model' && ['understanding', 'awaiting_input', 'executing', 'verifying'].includes(task.state)) {
      const receipt = path.join(this.taskStore.rootDir, 'model-deliveries-v1', task_id, 'saved-receipt.json');
      const present = await fs.lstat(receipt).then(stat => stat.isFile()).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
      if (present) {
        // The helper verifies the signed receipt and file bytes. It never
        // saves again when the unique delivery directory already exists.
        if (task.state === 'awaiting_input') task = await this.taskStore.transition(task_id, 'understanding', { reason: 'resume_saved_delivery_receipt' });
        try {
          task = await this.deliverModeling(task);
          return createResultEnvelope({ task: await this.taskStore.getTask(task_id), data: responseData(task), idempotentReplay: true });
        } catch (error) { return this.handleTaskError(task, error); }
      }
    }
    const pendingAssembly = task.private?.creation?.pending_assembly_mapping;
    if (task.intent === 'create_model' && pendingAssembly
      && !(task.private.creation.assembly_edit_receipts || []).some(receipt => sha256Canonical(receipt) === sha256Canonical(pendingAssembly.receipt))) {
      const recovered = await this.resumeTrustedAssemblyEditMapping({ creation_task_id: task_id });
      task = await this.taskStore.getTask(task_id, { includePrivate: true });
      return createResultEnvelope({ task: await this.taskStore.getTask(task_id),
        data: { ...responseData(task), assembly_mapping_recovery: recovered }, idempotentReplay: true });
    }
    if (task.intent === 'create_model' && ['executing', 'verifying'].includes(task.state) && task.private?.creation?.round?.snapshot) {
      if (task.private.creation.timber_rule_binding && task.inputs.task
        && task.private.creation.parameter_edit_support?.baseline_captured !== true) {
        const prepared = prepareTaskOwnedCreationDsl(task.inputs.code, {taskId: task.task_id, iteration: task.private.creation.round.iteration});
        task = await this.captureCreationParameterBaseline(task, prepared);
      }
      task = await this.finalizeCreationQuality(task);
      return createResultEnvelope({ task: await this.taskStore.getTask(task_id), data: responseData(task), idempotentReplay: true });
    }
    if (['executing', 'verifying'].includes(task.state) && mutationMayHaveStarted(task)) {
      let recovery;
      try {
        recovery = await this.taskStore.claimMutationFinalizationRecovery(task_id);
      } catch (error) {
        return this.mutationRecoveryEnvelope(task, error);
      }
      if (recovery?.outcome_unknown) {
        return this.mutationRecoveryEnvelope(task, new AgentContractError(
          'MUTATION_EXECUTION_FAILED',
          'Mutation outcome is unknown because no valid durable task receipt exists. Inspect the active model before starting new work.',
          { details: { task_id, task_state: task.state, outcome_unknown: true } }
        ));
      }
      if (recovery?.completed_claim) {
        if (recovery.completed_claim.response) return { ...structuredClone(recovery.completed_claim.response), idempotent_replay: true };
        return this.mutationRecoveryEnvelope(task, new AgentContractError(
          'MUTATION_RECEIPT_INVALID',
          'The mutation claim is complete but has no replayable response while its task remains unfinished.'
        ));
      }
      if (recovery?.recovery_receipt) {
        try {
          task = await this.finalizeReviewedMutationReceipt(recovery.recovery_receipt);
          const publicTask = await this.taskStore.getTask(task_id);
          const envelope = createResultEnvelope({ task: publicTask, data: responseData(task), idempotentReplay: true });
          await this.taskStore.completeTaskOperation(recovery, task_id, { response: envelope });
          return envelope;
        } catch (error) {
          await this.taskStore.abandonTaskOperationRecovery(recovery, { errorCode: error?.code });
          const recoveredTask = await this.taskStore.getTask(task_id, { includePrivate: true });
          if (['completed', 'awaiting_review'].includes(recoveredTask.state)) {
            return createResultEnvelope({ task: await this.taskStore.getTask(task_id), data: responseData(recoveredTask), idempotentReplay: true });
          }
          return this.mutationRecoveryEnvelope(recoveredTask, error, recovery.recovery_receipt);
        }
      }
      const activeError = normalizeAgentError(new AgentContractError(
        'MUTATION_RECOVERY_REQUIRED',
        'A committed mutation is still being finalized by its current owner. Resume after that owner exits or its lease expires.'
      ));
      const currentPublicTask = await this.taskStore.getTask(task_id);
      if (['completed', 'awaiting_review'].includes(currentPublicTask.state)) {
        return createResultEnvelope({ task: currentPublicTask, data: responseData(currentPublicTask), idempotentReplay: true });
      }
      return createResultEnvelope({
        task: currentPublicTask,
        ok: false,
        error: activeError,
        data: null,
        nextAction: { ...activeError.next_action, task_id }
      });
    }
    task = await this.refreshLocalApprovalState(task);
    task = await this.taskStore.getTask(task_id);
    return createResultEnvelope({ task, ok: !task.last_error, error: task.last_error || null, data: responseData(task) });
  }

  async submit(options = {}) {
    return this.withTaskRequestSlot(options.task_id, 'submit_agent_task_input', async () => (
      this.presentTaskEnvelope(await this.submitUnprojected(options))
    ));
  }

  async submitUnprojected(options = {}) {
    const { task_id, idempotency_key, input = {} } = options;
    let task = await this.taskStore.getTask(task_id, { includePrivate: true });
    try {
      assertNoPublicApprovalToken(options);
      if (task.intent === 'reopen_delivered_model') {
        if (!idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Saved close/reopen submission requires a stable idempotency_key.');
        validateReopenDeliveredInput(input, { previous: task.inputs });
      }
      if (task.private?.native_asset_edit && (['asset_edit', 'operations', 'targets', 'source_proposal', 'source_design_change', 'source_visual_correction'].some(key => Object.hasOwn(input, key)) || input.runtime && input.runtime !== 'queue')) throw new AgentContractError('INVALID_ARGUMENT', 'The reviewed native asset source, placement and target are frozen. Start a new reviewed task to change them.');
      if (((task.intent === 'create_model' && input.task) || task.intent === 'deliver_model') && !idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Submitting common-task creation or delivery requires a stable idempotency_key.');
      if (task.intent === 'apply_native_appearance' && !idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Submitting native appearance requires a stable idempotency_key.');
      if (task.intent === 'apply_native_appearance') validateNativeAppearanceSubmission(task, input);
    } catch (error) {
      const publicTask = await this.taskStore.getTask(task_id);
      return createResultEnvelope({
        task: publicTask,
        ok: false,
        error,
        data: null,
        nextAction: error.next_action
      });
    }
    const durableInput = await this.materializeConnectionInput(await this.materializeTransientImageInputs(task.intent, input), task.inputs?.runtime);
    if (task.intent === 'verify_model' && task.inputs?.creation_task_id) {
      if (Object.keys(durableInput).some(key => !['session_contract', 'connection_task_id', 'runtime', 'timeout_ms', 'reverify'].includes(key))
        || durableInput.runtime && task.inputs.runtime && durableInput.runtime !== task.inputs.runtime || durableInput.reverify !== undefined && durableInput.reverify !== true) {
        throw new AgentContractError('INVALID_ARGUMENT', 'Creation-bound verification cannot change its source tasks, snapshots, views or frozen requirements. Submit only a same-runtime connection and reverify:true.');
      }
    }
    if (task.inputs?.parameter_edit && task.private?.creation_parameter_edit?.ready) {
      if (!idempotency_key) throw new AgentContractError('INVALID_ARGUMENT', 'Parameter replacement submission requires a stable idempotency_key.');
      if (Object.keys(durableInput).some(key => !['session_contract', 'connection_task_id', 'runtime', 'note'].includes(key))
        || durableInput.runtime && durableInput.runtime !== task.private.parameter_source_record.runtime) throw new AgentContractError('INVALID_ARGUMENT', 'A prepared parameter change is frozen. Submit only its same-runtime connection and optional review note.');
      const executionInput = { ...(durableInput.session_contract ? { session_contract: durableInput.session_contract } : {}), ...(durableInput.note ? { note: durableInput.note } : {}) };
      return this.continueParameterTaskEnvelope(task, { input: executionInput, idempotencyKey: idempotency_key, submit: true });
    }
    const claim = await this.taskStore.claimTaskOperation({
      taskId: task_id,
      operation: 'submit_agent_task_input',
      idempotencyKey: idempotency_key,
      input: durableInput
    });
    if (claim.recovery_receipt) {
      try {
        task = await this.finalizeReviewedMutationReceipt(claim.recovery_receipt);
        const publicTask = await this.taskStore.getTask(task_id);
        const envelope = createResultEnvelope({ task: publicTask, data: responseData(task), idempotentReplay: true });
        await this.taskStore.completeTaskOperation(claim, task_id, { response: envelope });
        return envelope;
      } catch (error) {
        await this.taskStore.abandonTaskOperationRecovery(claim, { errorCode: error?.code });
        const recoveredTask = await this.taskStore.getTask(task_id, { includePrivate: true });
        if (['completed', 'awaiting_review'].includes(recoveredTask.state)) {
          return createResultEnvelope({ task: await this.taskStore.getTask(task_id), data: responseData(recoveredTask), idempotentReplay: true });
        }
        return this.mutationRecoveryEnvelope(recoveredTask, error, claim.recovery_receipt);
      }
    }
    if (claim.replayed) {
      if (claim.record.response) return { ...structuredClone(claim.record.response), idempotent_replay: true };
      const publicTask = await this.taskStore.getTask(task_id);
      return createResultEnvelope({
        task: publicTask,
        ok: !publicTask.last_error,
        error: publicTask.last_error || null,
        data: responseData(publicTask),
        idempotentReplay: true
      });
    }

    try {
      if (task.intent === 'reopen_delivered_model') {
        task = await this.taskStore.update(task_id, { inputs: { ...task.inputs, ...durableInput } });
        if (task.state === 'awaiting_input') task = await this.taskStore.transition(task_id, 'understanding', { reason: 'reopen_input_received' });
        task = await reopenDeliveredModelTask(this, task);
      } else if (task.intent === 'apply_native_appearance' && task.private?.appearance_plan && !['completed', 'failed', 'cancelled', 'expired'].includes(task.state)) {
        task = await continueNativeAppearanceTask(this, task, { input: durableInput, submit: true });
      } else if (task.state === 'awaiting_input') {
        if (task.inputs?.task && ['code', 'detail_spec', 'views', 'spec'].some(key => Object.hasOwn(durableInput, key))) throw new AgentContractError('INVALID_ARGUMENT', 'Common-task compiled code, views and quality requirements are server-owned. Submit a corrected task before execution, or use reviewed editing after creation.');
        if (task.intent === 'create_model' && task.private?.creation) {
          if (Object.hasOwn(durableInput, 'task')) throw new AgentContractError('INVALID_ARGUMENT', 'Task dimensions are frozen after creation starts. Use the reviewed edit workflow, then reverify this task.');
          freezeDetailSpecification(durableInput.detail_spec, task.private.creation.frozen_spec);
          if (durableInput.runtime !== undefined && durableInput.runtime !== task.private.creation.runtime) throw new AgentContractError('INVALID_ARGUMENT', 'Refinement cannot change runtime.');
          if (Object.hasOwn(durableInput, 'spec') && sha256Canonical(durableInput.spec) !== task.private.creation.layout_spec_hash) throw new AgentContractError('INVALID_ARGUMENT', 'Layout requirements are frozen.');
          if (task.private.creation.round?.snapshot && Object.hasOwn(durableInput, 'code')) throw new AgentContractError('INVALID_ARGUMENT', 'Use refinement_code or reverify; the initial creation code is never replayed.');
        }
        const priorInputs = { ...task.inputs };
        if (durableInput.task && !task.private?.common_task && !task.private?.creation) {
          // A rejected mixed code/task request did not execute. Choosing a
          // corrected task replaces those unexecuted alternatives so recovery
          // stays on the same task instead of trapping stale invalid fields.
          for (const key of ['code', 'detail_spec', 'views', 'spec']) delete priorInputs[key];
        }
        task = await this.taskStore.update(task_id, { inputs: { ...priorInputs, ...durableInput } });
        task = await this.taskStore.transition(task_id, 'understanding', {
          reason: 'required_input_received',
          patch: { last_error: null, next_action: { action: 'continue_server_work' } }
        });
        task = await this.runIntent(task);
      } else if (task.state === 'awaiting_review' && task.intent === 'create_model' && task.private?.image_model_creation) {
        task = await approveImageModelCreation(this, task, durableInput);
      } else if (task.state === 'awaiting_review'
        && task.intent === 'reviewed_existing_model_edit'
        && task.private?.design_post_apply_reconciliation) {
        task = await this.completeDesignReconciliationReview(task, durableInput);
      } else if (['awaiting_review', 'approved'].includes(task.state)
        && task.intent === 'reviewed_existing_model_edit') {
        task = await this.executeReviewedExistingEdit(task, durableInput, claim);
      } else if (task.state === 'awaiting_review' && task.intent === 'reconcile_design_intent') {
        task = await this.completeDesignReconciliationReview(task, durableInput);
      } else {
        throw new AgentContractError('TASK_STATE_CONFLICT', `Task input is not accepted while the task is ${task.state}.`, {
          details: { task_state: task.state }
        });
      }
      const publicTask = await this.taskStore.getTask(task_id);
      const envelope = createResultEnvelope({ task: publicTask, data: responseData(task) });
      await this.taskStore.completeTaskOperation(claim, task_id, { response: envelope });
      return envelope;
    } catch (error) {
      let durableReceipt = null;
      try {
        durableReceipt = await this.taskStore.loadTaskMutationReceipt(task_id, {
          allowMissing: true,
          claimRecord: claim.record
        });
      } catch (receiptError) {
        if (receiptError?.code !== 'MUTATION_RECEIPT_INVALID') throw receiptError;
        const envelope = await this.mutationRecoveryEnvelope(
          await this.taskStore.getTask(task_id, { includePrivate: true }),
          receiptError
        );
        await this.taskStore.completeTaskOperation(claim, task_id, { response: envelope });
        return envelope;
      }
      if (durableReceipt) {
        await this.taskStore.abandonTaskOperationRecovery(claim, { errorCode: error?.code });
        const postFinalizerTask = await this.taskStore.getTask(task_id, { includePrivate: true });
        if (['completed', 'awaiting_review'].includes(postFinalizerTask.state)) {
          const publicTask = await this.taskStore.getTask(task_id);
          return createResultEnvelope({ task: publicTask, data: responseData(postFinalizerTask) });
        }
        return this.mutationRecoveryEnvelope(postFinalizerTask, error, durableReceipt);
      }
      const envelope = await this.handleTaskError(task, error);
      await this.taskStore.completeTaskOperation(claim, task_id, { response: envelope });
      return envelope;
    }
  }

  async presentTaskEnvelope(envelope) {
    if (!envelope?.task_id || envelope.kind !== 'agent_result_envelope') return envelope;
    const task = await this.taskStore.getTask(envelope.task_id, { includePrivate: true });
    if (['discover', 'preflight_model', 'deliver_model'].includes(task.intent) || task.inputs?.task || task.inputs?.parameter_edit || task.inputs?.creation_task_id) {
      const result = { ...(envelope.result || {}), status: accessibilityStatus(task, envelope) };
      if (task.inputs?.parameter_edit && result.geometry_applied === true) result.status.execution_status = result.stage === 'applied' ? 'applied' : 'committed_pending_finalization';
      envelope = { ...envelope, result, data: result };
    }
    return presentAgentResultEnvelope({ envelope, task, taskStore: this.taskStore });
  }

  async withTaskRequestSlot(taskId, operation, callback) {
    const task = await this.taskStore.getTask(taskId, { includePrivate: true });
    let claim;
    try {
      claim = await this.taskStore.claimTaskRequest({ taskId: task.task_id, operation });
    } catch (error) {
      if (error?.code !== 'TASK_STATE_CONFLICT') throw error;
      const envelope = createResultEnvelope({
        task,
        ok: false,
        error,
        data: null,
        nextAction: error.next_action
      });
      return presentAgentResultEnvelope({ envelope, task, taskStore: this.taskStore });
    }
    try {
      return await callback();
    } finally {
      await this.taskStore.releaseTaskRequest(claim);
    }
  }

  async readArtifact(options = {}) {
    const handle = options.handle;
    const taskId = String(handle || '').startsWith('image-artifact:sha256:')
      ? options.task_id
      : taskIdFromArtifactHandle(handle);
    if (!taskId) return this.readArtifactWithinTask(options);
    return this.withTaskRequestSlot(taskId, 'read_agent_artifact', () => this.readArtifactWithinTask(options));
  }

  async readArtifactWithinTask({ handle, task_id, max_chars, offset } = {}) {
    if (String(handle || '').startsWith('image-artifact:sha256:')) {
      const task = task_id
        ? await this.taskStore.getTask(task_id, { includePrivate: true })
        : null;
      if (task && !taskHasBoundImageHandle(task, handle)) {
        throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The immutable image handle is not bound to the supplied task.');
      }
      const policy = task ? responsePolicyForTask(task) : createAgentResponsePolicy();
      let artifact;
      if (!policy.effective_capabilities.vision) {
        boundedArtifactReadInteger(max_chars ?? 12000, 'max_chars', 256, 100000);
        boundedArtifactReadInteger(offset ?? 0, 'offset', 0, 0);
        artifact = omittedImageArtifact(await this.imageArtifactStore.inspect(handle));
      } else {
        const limit = artifactPageLimit(max_chars, policy.max_context_chars);
        artifact = await this.readImmutableImageArtifact(handle, { maxChars: limit, offset });
      }
      const publicTask = task ? await this.taskStore.getTask(task.task_id) : null;
      const envelope = createResultEnvelope({
        task: publicTask,
        data: { kind: 'agent_artifact_page', artifact },
        nextAction: artifact.next_action,
        artifacts: []
      });
      return task
        ? presentAgentResultEnvelope({ envelope, task, taskStore: this.taskStore })
        : envelope;
    }
    const taskId = taskIdFromArtifactHandle(handle);
    if (task_id && task_id !== taskId) {
      throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact handle is not bound to the supplied task.');
    }
    const task = await this.taskStore.getTask(taskId, { includePrivate: true });
    const policy = responsePolicyForTask(task);
    const safe = await capabilitySafeArtifact({ taskStore: this.taskStore, task, handle });
    let artifact;
    if (safe.content_omitted) {
      boundedArtifactReadInteger(max_chars ?? 12000, 'max_chars', 256, 100000);
      boundedArtifactReadInteger(offset ?? 0, 'offset', 0, 0);
      artifact = omittedImageArtifact(safe.artifact);
    } else {
      artifact = await this.taskStore.readArtifact(safe.artifact.handle, {
        maxChars: artifactPageLimit(max_chars, policy.max_context_chars),
        offset: offset ?? 0
      });
    }
    const publicTask = await this.taskStore.getTask(taskId);
    const envelope = createResultEnvelope({
      task: publicTask,
      data: { kind: 'agent_artifact_page', artifact },
      nextAction: artifact.next_action,
      artifacts: []
    });
    return presentAgentResultEnvelope({ envelope, task, taskStore: this.taskStore });
  }

  async readImmutableImageArtifact(handle, { maxChars = 12000, offset = 0 } = {}) {
    const [record, buffer] = await Promise.all([
      this.imageArtifactStore.inspect(handle),
      this.imageArtifactStore.readBuffer(handle)
    ]);
    const content = buffer.toString('base64');
    const limit = boundedArtifactReadInteger(maxChars, 'max_chars', 256, 100000);
    const start = boundedArtifactReadInteger(offset, 'offset', 0, content.length);
    const end = Math.min(start + limit, content.length);
    const eof = end >= content.length;
    return {
      handle: record.handle,
      kind: record.kind,
      media_type: record.media_type,
      label: 'immutable_image_artifact',
      size_bytes: record.size_bytes,
      created_at: record.created_at,
      sha256: record.sha256,
      content_trust: record.content_trust,
      policy_effect: record.policy_effect,
      encoding: 'base64',
      content: content.slice(start, end),
      offset: start,
      next_offset: eof ? null : end,
      total_chars: content.length,
      eof,
      truncated: !eof,
      next_action: eof ? null : { action: 'read_artifact', handle, offset: end, max_chars: limit }
    };
  }

  async runIntent(task) {
    if (task.intent === 'discover') return this.discoverModeling(task);
    if (task.intent === 'preflight_model') return this.preflightModeling(task);
    if (task.intent === 'deliver_model') return this.deliverModeling(task);
    if (task.intent === 'apply_native_appearance') return prepareNativeAppearanceTask(this, task);
    if (task.intent === 'reopen_delivered_model') return reopenDeliveredModelTask(this, task);
    assertRuntimePolicy(task.inputs?.runtime || 'mock', this.bridge.executionPolicy, task.intent);
    switch (task.intent) {
    case 'program_model': return continueModelProgram(this, task);
    case 'understand_model': return this.understandModel(task);
    case 'propose_existing_model_edit': return this.proposeExistingModelEdit(task);
    case 'modify_design_parameters': return this.modifyDesignParameters(task);
    case 'reconcile_design_intent': return this.reconcileDesignIntent(task);
    case 'reference_image_correction': return this.referenceImageCorrection(task);
    case 'visual_correction_qa': return this.visualCorrectionQa(task);
    case 'reviewed_existing_model_edit': return this.prepareReviewedExistingEdit(task);
    case 'verify_model': return this.verifyModel(task);
    case 'image_artifact': return this.prepareImageArtifact(task);
    case 'create_model': return this.createModel(task);
    default: throw new AgentContractError('INVALID_ARGUMENT', 'Unsupported task intent.');
    }
  }

  async discoverModeling(task) {
    const inputs = task.inputs;
    const topic = inputs.topic || 'start';
    if (!['start', 'tasks', 'assets', 'workflows', 'connect', 'parameter_sources'].includes(topic)) throw new AgentContractError('INVALID_ARGUMENT', 'Discovery topic must be start, tasks, assets, workflows, connect, or parameter_sources.');
    let result = { kind: 'model_accessibility_discovery', version: 'model-accessibility.v1', topic, current_model: 'not_checked', evidence_level: 'preflight_only', ...(topic === 'start' ? { guide: FIRST_USE_GUIDE } : {}) };
    if (topic === 'tasks') {
      result.catalog = getModelAccessibilityTaskCatalog({ task: inputs.kind, detail: inputs.detail || 'summary' });
      if (inputs.kind && inputs.detail === 'examples') {
        const selected = result.catalog.tasks[0];
        // The selected example is a complete small entry. Full ranges and
        // dependency documentation remain available via detail=parameters.
        result = { kind: result.kind, topic, evidence_level: 'preflight_only',
          task_input: selected.examples.minimal.arguments.inputs.task,
          fixed_design: selected.fixed_design,
          next_step: 'Replace example values with user dimensions. Call preflight_model with inputs.task, then discover/connect runtime=queue and create_model using the same task plus connection_task_id and a stable idempotency_key.',
          more_constraints: 'discover topic=tasks, kind=' + inputs.kind + ', detail=parameters; preflight also reports exact range/dependency errors.' };
      }
      if (inputs.kind && inputs.detail === 'parameters') {
        const selected = result.catalog.tasks[0];
        const byAsset = selected.parameters.by_asset_recipe;
        const recipe = typeof inputs.asset_id === 'string' ? inputs.asset_id.replace(/^detail-/, '') : null;
        if (byAsset && !byAsset[recipe]) {
          result = { kind: result.kind, topic, task_kind: inputs.kind, evidence_level: 'preflight_only', asset_ids: Object.keys(byAsset).map(name => `detail-${name}`),
            next_step: 'Choose an asset_id; repeat discover topic=tasks, kind=asset_placement, detail=parameters, asset_id=<selected>. Or use topic=assets for native file assets.' };
        } else {
          const parameters = byAsset ? byAsset[recipe] : selected.parameters;
          result = { kind: result.kind, topic, task_kind: inputs.kind, evidence_level: 'preflight_only', units: 'mm; angles in degrees',
            parameter_rules: Object.fromEntries(Object.entries(parameters).map(([name, rule]) => [name, Object.fromEntries(Object.entries(rule).filter(([key]) => ['type', 'minimum', 'maximum', 'default', 'enum', 'required'].includes(key)))])),
            fixed_design: selected.fixed_design, dependencies: selected.dependencies.slice(3),
            placement: 'Exactly one of placement:{origin_mm:[x,y,z],rotation_z_deg?} or instances:[{id,origin_mm,rotation_z_deg?}]. World mm; +X width,+Y back,+Z up; rotate then translate. Up to 12 shared instances.',
            next_step: 'Use these rules with the inline example. Preflight reports all exact range/dependency errors; do not read an artifact before trying preflight.' };
        }
      }
    }
    if (topic === 'assets') {
      result.catalog = await this.bridge.query_assets({ query: inputs.query || '', limit: 12, ...(this.bridge.options.assetCatalogPath ? { catalog_path: this.bridge.options.assetCatalogPath } : {}) });
      const catalogFile = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'asset-query.json');
      await atomicWriteJson(catalogFile, result.catalog);
      result.catalog_artifacts = await this.registerArtifacts(task.task_id, { asset_query: catalogFile });
    }
    if (topic === 'workflows') result = getModelAccessibilityWorkflowGuide({ task: inputs.task_name });
    if (topic === 'parameter_sources') Object.assign(result, await discoverParameterSources({ gateway: this, runtime: inputs.runtime, query: inputs.query }));
    if (topic === 'connect') {
      if (!['mock', 'queue'].includes(inputs.runtime)) throw new AgentContractError('INVALID_ARGUMENT', 'Connect requires explicit runtime mock or queue.');
      assertRuntimePolicy(inputs.runtime, this.bridge.executionPolicy, task.intent);
      const timeoutMs = boundedQueueTimeoutMs(inputs.timeout_ms, inputs.runtime === 'queue' ? 300_000 : 15_000);
      // Serial read-only probes. Freshness proves the document binding, not approval.
      if (inputs.runtime === 'queue') result.queue = await this.bridge.queue_diagnostics({ includeFiles: false, timeoutMs });
      const capabilities = await this.bridge.get_capabilities({ runtime: inputs.runtime, timeoutMs });
      result.runtime = capabilities.runtime;
      const inspected = inputs.runtime === 'queue' ? await this.bridge.get_model_info({runtime: inputs.runtime, timeoutMs})
        : await this.bridge.inspect_model({ runtime: inputs.runtime, includeSnapshot: false, timeoutMs });
      const currentModel = inputs.runtime === 'queue' ? Object.fromEntries(['kind', 'runtime', 'units', 'source_path', 'model_modified', 'totals', 'bounding_box', 'counts', 'warning_summary'].filter(key => Object.hasOwn(inspected, key)).map(key => [key, inspected[key]])) : inspected;
      result.current_model = markUntrustedData(currentModel, 'sketchup_model_entities');
      if (inputs.runtime === 'queue') {
        const session_contract = (await this.bridge.create_queue_handshake({ timeoutMs, expires_in_ms: Math.min(300000, Math.max(120000, timeoutMs)) })).session_contract;
        task = await this.taskStore.update(task.task_id, { private: { ...task.private, connection: { session_contract } } });
        // Signed payloads cannot pass through no-files projection: removing a
        // model source path would invalidate the signature. Keep the original
        // server-side and expose only this task-bound connection reference.
        result.connection_task_id = task.task_id;
        result.connection_expires_at = session_contract.expires_at;
      }
      result.evidence_level = inputs.runtime === 'queue' ? 'live_read_only' : 'mock_only';
      result.gateway_creation_allowed = inputs.runtime === 'mock' || this.bridge.executionPolicy.allow_queue_mutation === true;
    }
    result.next_steps = topic === 'start' ? [discoverCall({ topic: 'tasks' }), discoverCall({ topic: 'connect', runtime: 'queue' })] : [];
    return this.taskStore.transition(task.task_id, 'completed', { reason: 'model_accessibility_discovered', patch: { result, next_action: topic === 'start' ? { action: 'discover_tasks', ...discoverCall({ topic: 'tasks' }) } : null } });
  }

  async materializeConnectionInput(input, fallbackRuntime) {
    if (!Object.hasOwn(input, 'connection_task_id')) return input;
    if (input.session_contract !== undefined || (input.runtime || fallbackRuntime) !== 'queue') throw new AgentContractError('INVALID_ARGUMENT', 'connection_task_id requires queue runtime and cannot be combined with session_contract.');
    const sourceId = String(input.connection_task_id || '');
    if (!/^task_[0-9a-f-]+$/i.test(sourceId)) throw new AgentContractError('HANDSHAKE_INVALID', 'connection_task_id must refer to a completed queue connection task.');
    const source = await this.taskStore.getTask(sourceId, { includePrivate: true });
    const contract = source.private?.connection?.session_contract;
    if (source.intent !== 'discover' || source.inputs?.topic !== 'connect' || source.inputs?.runtime !== 'queue' || source.state !== 'completed' || !contract) throw new AgentContractError('HANDSHAKE_INVALID', 'The source task does not contain a completed queue connection.');
    return { ...input, session_contract: structuredClone(contract) };
  }

  async compileCommonTask(task) {
    if (!task.inputs.task) throw new AgentContractError('INVALID_ARGUMENT', 'Provide the common-task description in inputs.task.', { details: { recovery_class: 'design_input', issues: [{ path: '/inputs/task', message: 'Read discover topic=tasks for required fields.' }] } });
    const context = { limits: this.bridge.executionPolicy.resource_limits };
    // Reject bad dimensions before contacting SketchUp. A runtime-free preflight is
    // useful, but must not imply that the currently open model was inspected.
    let compiled = compileModelAccessibilityTask(task.inputs.task, context);
    const runtime = task.inputs.runtime;
    if (runtime !== undefined) {
      if (!['mock', 'queue'].includes(runtime)) throw new AgentContractError('INVALID_ARGUMENT', 'Common-task preflight runtime must be mock or queue.');
      assertRuntimePolicy(runtime, this.bridge.executionPolicy, task.intent);
      const timeoutMs = boundedQueueTimeoutMs(task.inputs.timeout_ms, 30_000);
      const capabilities = (await this.bridge.get_capabilities({ runtime, timeoutMs })).runtime;
      if(runtime==='queue'&&task.inputs.task.kind==='traditional_timber'&&capabilities.creation_scope?.assembly_projection!=='assembly-merkle.v2')throw new AgentContractError('POLICY_DENIED','The timber preset requires the matching plugin with bounded assembly summaries.');
      if (!Array.isArray(capabilities?.supported_operations)) throw new AgentContractError('INVALID_ARGUMENT', 'The runtime did not advertise its generated-operation support; reconnect to a compatible plugin.', { details: { recovery_class: 'runtime_blocked', issues: [{ code: 'CAPABILITY_UNSUPPORTED', path: '/inputs/runtime', message: 'A fresh generated-operation capability list is required.' }] } });
      const inspected = runtime==='queue'&&task.inputs.task.kind==='traditional_timber'
        ? await this.bridge.adopt_open_model({runtime,read_only:true,assembly_projection:true,recursive:false,timeoutMs})
        : await this.bridge.inspect_model({ runtime, includeEntities: true, includeSnapshot: true, timeoutMs });
      const roots = [...(inspected.entities || []), ...(inspected.snapshot?.groups || []), ...(inspected.snapshot?.instances || [])];
      context.availableOperations = capabilities.supported_operations;
      context.existingIds = [...new Set(roots.flatMap(entity => [entity.id, entity.name]).filter(value => typeof value === 'string' && value))];
      compiled = compileModelAccessibilityTask(task.inputs.task, context);
      compiled.preflight.runtime_observation = { runtime, capability_version: capabilities.capability_version || null, model_revision: inspected.snapshot?.model_revision || null, model_revision_complete: inspected.snapshot?.model_revision_complete === true, root_names_checked: context.existingIds.length, mutates_model: false };
      compiled.preflight.remaining_runtime_checks = compiled.preflight.remaining_runtime_checks.filter(check => check !== 'fresh runtime capability and session binding');
      compiled.preflight.remaining_runtime_checks.unshift('fresh session authorization and atomic target/name absence at execution');
    }
    return compiled;
  }

  async preflightModeling(task) {
    const compiled = await this.compileCommonTask(task);
    return this.taskStore.transition(task.task_id, 'completed', { reason: 'common_task_preflight_completed', patch: {
      result: { kind: 'model_accessibility_preflight', evidence_level: 'preflight_only', quality_status: 'not_evaluated', quality_accepted: false, preflight: compiled.preflight, required_before_execution: ['explicit runtime', 'stable idempotency_key', 'fresh connection_task_id or session_contract for queue'], task: task.inputs.task },
      next_action: null
    } });
  }

  async deliverModeling(task) {
    assertRuntimePolicy('queue', this.bridge.executionPolicy, task.intent);
    if (!task.inputs.source_task_id || !task.inputs.session_contract) return this.taskStore.transition(task.task_id, 'awaiting_input', {
      reason: 'delivery_source_and_connection_required', patch: { next_action: { action: 'submit_task_input', then_tool: 'submit_agent_task_input', task_id: task.task_id, required: ['source_task_id', 'connection_task_id from a fresh discover/connect task'] } }
    });
    const result = await deliverModelAccessibilityTask({ bridge: this.bridge, taskStore: this.taskStore, taskId: task.task_id,
      sourceTaskId: task.inputs.source_task_id, sessionContract: task.inputs.session_contract,
      timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000) });
    return this.taskStore.transition(task.task_id, 'completed', { reason: 'accepted_model_saved_to_unique_file', patch: { result, last_error: null, next_action: null } });
  }

  async understandModel(task) {
    const runtime = task.inputs.runtime || 'mock';
    const inspected = await this.bridge.inspect_model({
      runtime,
      includeEntities: task.inputs.include_entities !== false,
      includeSnapshot: task.inputs.include_snapshot === true,
      includeHidden: task.inputs.include_hidden !== false
    });
    return this.taskStore.transition(task.task_id, 'completed', {
      reason: 'model_understood',
      patch: {
        result: {
          kind: 'understand_model_result',
          model_data: markUntrustedData(inspected, 'sketchup_model_entities')
        },
        next_action: null
      }
    });
  }

  async prepareReviewedExistingEdit(task) {
    let assetEdit = null;
    if (task.inputs.asset_edit) {
      if (['operations', 'targets', 'source_proposal', 'source_design_change', 'source_visual_correction'].some(key => Object.hasOwn(task.inputs, key))) throw new AgentContractError('INVALID_ARGUMENT', 'asset_edit cannot be combined with caller operations, targets or another source plan.');
      assetEdit = await prepareNativeAssetEdit({ assetEdit: task.inputs.asset_edit, taskId: task.task_id, runtime: task.inputs.runtime || 'mock', catalogPath: this.bridge.options.assetCatalogPath });
    }
    const sourceProposal = await this.resolveSourceProposal(task);
    const sourceDesignChange = await this.resolveSourceDesignChange(task);
    const sourceVisualCorrection = await this.resolveSourceVisualCorrection(task);
    if ([sourceProposal, sourceDesignChange, sourceVisualCorrection].filter(Boolean).length > 1) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A reviewed edit task cannot combine multiple server source bindings.');
    }
      const operations = sourceProposal?.proposal.operation_proposal
      || sourceDesignChange?.change_plan.operations
      || sourceVisualCorrection?.private_patch.operations
      || assetEdit?.operations || task.inputs.operations;
    const targets = sourceProposal?.proposal.selected_targets
      || sourceDesignChange?.change_plan.targets
      || sourceVisualCorrection?.private_patch.targets
      || assetEdit?.targets || task.inputs.targets;
    if (!assetEdit && operations?.some(operation => ['place_component_asset', 'replace_component_asset'].includes(operation?.op))) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Gateway native assets must use asset_edit and the server-configured catalog.');
    const recursiveLimit = task.inputs.recursive_limit
      || sourceProposal?.source_task.inputs?.recursive_limit
      || sourceDesignChange?.source_task.inputs?.recursive_limit
      || sourceVisualCorrection?.source_task.inputs?.recursive_limit
      || 5000;
    const timeoutMs = boundedQueueTimeoutMs(task.inputs.timeout_ms, 30_000);
    const budgets = {
      ...(task.inputs.budgets || {}),
      recursive_limit: task.inputs.budgets?.recursive_limit || recursiveLimit
    };
    if (!Array.isArray(operations) || operations.length === 0 || !Array.isArray(targets) || (targets.length === 0 && !(operations.length === 1 && operations[0].op === 'place_component_asset'))) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'edit_inputs_required',
        patch: { next_action: { action: 'submit_task_input', required: ['operations', 'targets'] } }
      });
    }
    const sourceDiscovery = sourceProposal?.source_task.private?.target_discovery;
    const targetValidation = sourceDiscovery?.mode === 'structural_groups'
      && canPrepareExistingModelEditFromStructuralGroups({ operations, targets })
      ? {
        mode: 'structural_groups',
        source: 'server_bound_source_proposal',
        structural_group_limit: boundedStructuralGroupLimit(sourceDiscovery.structural_group_limit, 5000)
      }
      : null;
    const prepared = await this.bridge.prepare_existing_model_edit({
      runtime: task.inputs.runtime || 'mock',
      timeoutMs,
      instruction: sourceProposal?.source_task.instruction
        || sourceVisualCorrection?.source_task.instruction
        || task.instruction,
      operations,
      targets,
      budgets,
      recursive_limit: recursiveLimit,
      readback_projection: sourceDesignChange?.change_plan.readback_projection || task.inputs.readback_projection,
      ...((sourceDesignChange?.change_plan.recursive_roots || task.inputs.recursive_roots) ? {
        recursive_roots: sourceDesignChange?.change_plan.recursive_roots || task.inputs.recursive_roots
      } : {}),
      task_id: task.task_id,
      ...(sourceProposal ? {
        source_proposal_binding: sourceProposal.binding,
        expected_model_revision: sourceProposal.binding.model_revision,
        expected_model_key: sourceProposal.binding.model_key
      } : sourceDesignChange ? {
        expected_model_revision: sourceDesignChange.binding.model_revision,
        expected_model_key: sourceDesignChange.binding.model_key
      } : sourceVisualCorrection ? {
        expected_model_revision: sourceVisualCorrection.binding.model_revision,
        expected_model_key: sourceVisualCorrection.binding.model_key
      } : {}),
      output_dir: path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'prepare'),
      execution_contract: {
        save_model: task.inputs.save_model !== false,
        save_path: task.inputs.save_path || null,
        capture_view: task.inputs.capture_view === true
      },
      ...(targetValidation ? { target_validation: targetValidation } : {})
    });
    if (sourceProposal) {
      const latestSource = await this.taskStore.getTask(sourceProposal.source_task.task_id, { includePrivate: true });
      await this.taskStore.update(latestSource.task_id, {
        private: {
          ...latestSource.private,
          source_proposal_promotion: {
            task_id: task.task_id,
            plan_id: prepared.plan.plan_id,
            plan_hash: prepared.plan.plan_hash,
            promoted_at: new Date().toISOString()
          }
        }
      });
    }
    if (sourceDesignChange) {
      const latestSource = await this.taskStore.getTask(sourceDesignChange.source_task.task_id, { includePrivate: true });
      await this.taskStore.update(latestSource.task_id, {
        private: {
          ...latestSource.private,
          design_change_promotion: {
            task_id: task.task_id,
            plan_id: prepared.plan.plan_id,
            plan_hash: prepared.plan.plan_hash,
            promoted_at: new Date().toISOString()
          }
        }
      });
    }
    if (sourceVisualCorrection) {
      const latestSource = await this.taskStore.getTask(sourceVisualCorrection.source_task.task_id, { includePrivate: true });
      await this.taskStore.update(latestSource.task_id, {
        private: {
          ...latestSource.private,
          visual_correction_promotion: {
            task_id: task.task_id,
            plan_id: prepared.plan.plan_id,
            plan_hash: prepared.plan.plan_hash,
            promoted_at: new Date().toISOString()
          }
        }
      });
    }
    const handles = await this.registerArtifacts(task.task_id, prepared.artifacts);
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    const autoApprovalMode = serverPolicyAutoApprovalMode(prepared.plan, this.bridge.executionPolicy);
    const copyFastActive = autoApprovalMode === 'copy_fast_session';
    const targetState = prepared.plan.compile_permission !== 'ready_for_review'
      ? 'failed'
      : copyFastActive
        ? 'approved'
        : 'awaiting_review';
    return this.taskStore.transition(task.task_id, targetState, {
      reason: prepared.plan.compile_permission !== 'ready_for_review'
        ? 'edit_plan_blocked'
        : copyFastActive
          ? 'copy_fast_session_active'
          : 'trusted_review_required',
      patch: {
        private: {
          ...refreshed.private,
          existing_edit_plan: prepared.plan,
          ...(assetEdit ? { native_asset_edit: assetEdit } : {}),
          ...(sourceProposal ? { source_proposal: sourceProposal.binding } : {}),
          ...(sourceVisualCorrection ? { source_visual_correction: sourceVisualCorrection.binding } : {}),
          ...(sourceDesignChange ? {
            source_design_change: sourceDesignChange.binding,
            design_intent_binding: sourceDesignChange.design_binding,
            design_parameter_change_plan: sourceDesignChange.change_plan
          } : {})
        },
        result: {
          kind: 'reviewed_existing_model_edit_proposal',
          ...(assetEdit ? { asset: assetEdit.asset_record, asset_verification_required: assetEdit.verification } : {}),
          plan_id: prepared.plan.plan_id,
          plan_hash: prepared.plan.plan_hash,
          model_revision: prepared.plan.model_revision,
          risk_level: prepared.plan.risk_level,
          operation_count: prepared.plan.dsl_document.operations.length,
          target_validation: prepared.plan.target_validation,
          destructive_side_effects: prepared.plan.destructive_side_effects,
          blockers: prepared.plan.blockers,
          approval_challenge: prepared.approval_challenge,
          execution_mode: prepared.plan.execution_mode,
          user_action_required: prepared.plan.user_action_required,
          copy_fast_session: prepared.copy_fast_session,
          source_proposal: sourceProposal?.binding || null,
          source_design_change: sourceDesignChange ? {
            source_task_id: sourceDesignChange.source_task.task_id,
            change_plan_id: sourceDesignChange.change_plan.change_plan_id,
            provenance: 'server_task_binding'
          } : null,
          source_visual_correction: sourceVisualCorrection ? {
            source_task_id: sourceVisualCorrection.source_task.task_id,
            correction_patch_id: sourceVisualCorrection.public_patch.correction_patch_id,
            patch_hash: sourceVisualCorrection.public_patch.patch_hash,
            provenance: 'server_private_visual_correction_binding'
          } : null
        },
        next_action: prepared.plan.compile_permission === 'ready_for_review'
          ? autoApprovalMode
            ? serverPolicySubmissionNextAction({
              runtime: task.inputs.runtime || 'mock',
              autoApprovalMode,
              plan: prepared.plan
            })
            : this.approvalNextAction(prepared.approval_challenge, {
              required: (task.inputs.runtime || 'mock') === 'queue' ? ['session_contract'] : []
            })
          : { action: 'start_new_task', reason: 'plan_blocked' },
        artifacts: handles
      }
    });
  }

  async proposeExistingModelEdit(task) {
    const inputs = task.inputs;
    const runtime = inputs.runtime || 'mock';
    const recursiveLimit = boundedRecursiveLimit(inputs.recursive_limit, this.bridge.executionPolicy, 5000);
    const discovery = planExistingModelEditDiscovery({
      instruction: task.instruction,
      target_query: inputs.target_query,
      target_ref: inputs.target_ref,
      action: inputs.action,
      discovery_mode: inputs.discovery_mode
    });
    const structuralGroupLimit = boundedStructuralGroupLimit(inputs.structural_group_limit, 5000);
    const adoption = discovery.mode === 'structural_groups'
      ? await this.bridge.adopt_open_model({
        runtime,
        recursive: false,
        read_only: true,
        structural_groups: true,
        structural_group_limit: structuralGroupLimit
      })
      : await this.bridge.adopt_open_model({
        runtime,
        recursive: true,
        recursive_limit: recursiveLimit,
        read_only: true
      });
    const graphLineage = await this.resolveModelGraphLineage(inputs);
    const graph = buildModelGraph(adoption, graphLineage);
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'model-graph');
    const persistedGraph = await this.persistModelGraph(task, adoption, graph);
    const proposal = proposeExistingModelEdit({
      graph,
      model_key: persistedGraph.model_key,
      instruction: task.instruction,
      target_query: inputs.target_query,
      target_ref: inputs.target_ref,
      action: inputs.action,
      parameters: inputs.parameters,
      shared_policy: inputs.shared_policy,
      limit: inputs.candidate_limit
    });
    if (!proposal.requires_clarification) {
      proposal.next_action.arguments.inputs = {
        runtime,
        source_proposal: {
          task_id: task.task_id,
          proposal_id: proposal.proposal_id,
          proposal_hash: proposal.proposal_hash,
          graph_id: proposal.graph_id,
          model_key: proposal.model_key,
          model_revision: proposal.model_revision
        },
        recursive_limit: recursiveLimit,
        save_model: inputs.save_model !== false
      };
      if (inputs.capture_view === true) proposal.next_action.arguments.inputs.capture_view = true;
    }
    const proposalPath = path.join(artifactDir, 'existing-model-edit-proposal.v1.json');
    await atomicWriteJson(proposalPath, proposal);
    await this.registerArtifacts(task.task_id, {
      model_graph: persistedGraph.graph_path,
      model_graph_manifest: persistedGraph.manifest_path,
      edit_proposal: proposalPath
    });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, proposal.requires_clarification ? 'awaiting_input' : 'awaiting_review', {
      reason: proposal.requires_clarification ? 'proposal_ambiguity_requires_input' : 'proposal_ready_for_user_review',
      patch: {
        private: {
          ...refreshed.private,
          model_graph: graph,
          model_graph_store: graphStoreSummary(persistedGraph),
          edit_proposal: proposal,
          target_discovery: {
            ...discovery,
            recursive_limit: recursiveLimit,
            structural_group_limit: structuralGroupLimit
          }
        },
        result: {
          kind: 'propose_existing_model_edit_result',
          target_discovery: {
            mode: discovery.mode,
            reason: discovery.reason,
            leaf_entities_materialized: discovery.mode !== 'structural_groups'
          },
          model_graph: {
            graph_id: graph.graph_id,
            model_revision: graph.model_revision,
            stats: graph.stats,
            ...(graph.projections ? { projections: graph.projections } : {}),
            store: graphStoreSummary(persistedGraph)
          },
          proposal
        },
        artifacts: refreshed.artifacts,
        next_action: proposal.next_action
      }
    });
  }

  async executeReviewedExistingEdit(task, input, claim) {
    const binding = reviewedTaskAuthorizationBinding(task, this.bridge.executionPolicy);
    const plan = binding.plan;
    const runtime = plan.runtime;
    const timeoutMs = boundedQueueTimeoutMs(task.inputs.timeout_ms, 30_000);
    if (runtime === 'queue' && !input.session_contract) {
      throw new AgentContractError('HANDSHAKE_REQUIRED', 'A fresh queue handshake must be supplied with the trusted approval before live execution.');
    }
    const serverAutoApproval = serverPolicyAutoApprovalMode(plan, this.bridge.executionPolicy);
    if (serverAutoApproval === 'copy_fast_session') {
      this.bridge.copyFastSessionAuthority.verify(plan.copy_fast_session, {
        scopeBinding: plan.trusted_model_copy_auto_approval,
        modelKey: plan.model_key,
        runtime
      });
    }
    const challenge = binding.challenge;
    const trustedApproval = serverAutoApproval
      ? { approval_token: null, local_decision: null }
      : await this.resolveTrustedApproval(challenge, binding.expectedAuthorization);
    if (trustedApproval.approval_token) {
      const token = await this.bridge.approvalAuthority.verifyToken(trustedApproval.approval_token);
      if (token.task_id !== task.task_id || token.plan_id !== plan.plan_id || token.plan_hash !== plan.plan_hash || token.model_revision !== plan.model_revision || token.risk_level !== plan.risk_level) {
        throw new AgentContractError('APPROVAL_INVALID', 'The approval token is not bound to this task and plan.');
      }
    }
    if (!claim || claim.disabled || claim.replayed || !claim.record) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A reviewed mutation requires an idempotency key for durable receipt binding.');
    }
    const execution = await this.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, (gatewayBridge) => gatewayBridge.withLiveMutationAuthorization({
      runtime,
      timeoutMs,
      session_contract: input.session_contract,
      operation: 'apply_reviewed_model_edit'
    }, async (authorizedBridge) => {
      const preflight = await observeExistingModelEditExecutionState({
        bridge: authorizedBridge,
        plan,
        runtime,
        timeoutMs,
        phase: 'gateway_pre_apply',
        expected_model_key: plan.model_key,
        expected_model_revision: plan.model_revision
      });
      if (task.state === 'awaiting_review') {
        task = await this.taskStore.transition(task.task_id, 'approved', {
          reason: 'trusted_approval_present',
          patch: { last_error: null, next_action: { action: 'continue_server_work' } }
        });
      } else {
        task = await this.taskStore.update(task.task_id, {
          last_error: null,
          next_action: { action: 'continue_server_work' }
        });
      }
      task = await this.taskStore.transition(task.task_id, 'executing', { reason: 'reviewed_edit_execution_started' });
      const applied = await authorizedBridge.apply_reviewed_model_edit({
        runtime,
        timeoutMs,
        plan,
        trusted_commit_observer: async ({ applied, model_revision_after }) => {
          await this.taskStore.recordTaskMutationReceipt({ taskId: task.task_id, claim,
            binding: { plan_id: plan.plan_id, plan_hash: plan.plan_hash, model_key: plan.model_key,
              model_revision_before: plan.model_revision, model_revision_after, risk_level: plan.risk_level, runtime },
            bridgeReceipt: trustedBridgeReceipt({ runtime, nativeReceipt: applied.mutation_receipt }),
            finalizer: { version: TASK_MUTATION_FINALIZER_VERSION, kind: 'committed_assembly_replacement', applied_result: applied } });
        },
        approval_token: trustedApproval.approval_token,
        review: input.note ? { plan_id: plan.plan_id, note: input.note } : null,
        output_dir: path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'apply'),
        save_model: plan.execution_contract?.save_model ?? (task.inputs.save_model !== false),
        save_path: plan.execution_contract?.save_path ?? task.inputs.save_path,
        capture_view: plan.execution_contract?.capture_view ?? (task.inputs.capture_view === true)
      });
      const postApply = await observeExistingModelEditExecutionState({
        bridge: authorizedBridge,
        plan,
        runtime,
        timeoutMs,
        phase: 'gateway_post_apply',
        expected_model_key: plan.model_key
      });
      return {
        applied,
        preflight,
        post_apply_adoption: postApply.adoption,
        post_apply_validation: postApply.summary
      };
    }));
    const earlyReceipt = await this.taskStore.loadTaskMutationReceipt(task.task_id, { allowMissing: true });
    if (earlyReceipt) return this.finalizeReviewedMutationReceipt(earlyReceipt);
    const applied = execution.applied;
    applied.execution_target_validation ||= {
      version: 'existing-edit-execution-target-validation.v1',
      mode: execution.preflight.policy.mode,
      source: execution.preflight.policy.source,
      leaf_entities_materialized: execution.preflight.policy.leaf_entities_materialized,
      phases: {}
    };
    applied.execution_target_validation.phases = {
      gateway_pre_apply: execution.preflight.summary,
      ...applied.execution_target_validation.phases,
      gateway_post_apply: execution.post_apply_validation
    };
    const afterModelKey = modelKeyForIdentity(modelIdentityForAdoption(execution.post_apply_adoption));
    const afterRevision = modelRevisionForAdoption(execution.post_apply_adoption);
    if (afterModelKey !== plan.model_key) {
      throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The committed edit returned from a different model identity.');
    }
    const bridgeReceipt = trustedBridgeReceipt({
      runtime,
      nativeReceipt: applied.mutation_receipt,
      appliedResult: applied
    });
    const receipt = await this.taskStore.recordTaskMutationReceipt({
      taskId: task.task_id,
      claim,
      binding: {
        plan_id: plan.plan_id,
        plan_hash: plan.plan_hash,
        model_key: plan.model_key,
        model_revision_before: plan.model_revision,
        model_revision_after: afterRevision,
        risk_level: plan.risk_level,
        runtime
      },
      bridgeReceipt,
      finalizer: {
        version: TASK_MUTATION_FINALIZER_VERSION,
        kind: 'reviewed_existing_model_edit',
        applied_result: applied
      }
    });
    return this.finalizeReviewedMutationReceipt(receipt);
  }

  async finalizeReviewedMutationReceipt(receipt) {
    const persistedReceipt = await this.taskStore.loadTaskMutationReceipt(receipt.task_id);
    if (persistedReceipt.receipt_id !== receipt.receipt_id) {
      throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'The recovering receipt is not the task ledger receipt.');
    }
    receipt = persistedReceipt;
    let task = await this.taskStore.getTask(receipt.task_id, { includePrivate: true });
    const plan = task.private?.existing_edit_plan;
    if (task.intent !== 'reviewed_existing_model_edit'
      || !plan
      || plan.plan_id !== receipt.plan_id
      || plan.plan_hash !== receipt.plan_hash
      || plan.model_key !== receipt.model_key
      || plan.model_revision !== receipt.model_revision_before
      || plan.risk_level !== receipt.risk_level
      || (task.inputs.runtime || 'mock') !== receipt.runtime) {
      throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'The mutation receipt no longer matches the server-persisted reviewed plan.');
    }
    if (task.state === 'executing') {
      task = await this.taskStore.transition(task.task_id, 'verifying', {
        reason: 'durable_mutation_receipt_recorded',
        patch: {
          last_error: null,
          next_action: { action: 'continue_server_work' },
          private: {
            ...task.private,
            mutation_finalization: {
              receipt_id: receipt.receipt_id,
              status: 'committed_pending_finalization'
            }
          }
        }
      });
    } else if (task.state !== 'verifying') {
      if (['completed', 'awaiting_review'].includes(task.state)) return task;
      throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'The mutation receipt task is not at a recoverable post-commit state.');
    }
    const finalization = await observeExistingModelEditExecutionState({
      bridge: this.bridge,
      plan,
      runtime: receipt.runtime,
      timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000),
      phase: 'finalization',
      expected_model_key: receipt.model_key,
      expected_model_revision: receipt.model_revision_after
    });
    const applied = receipt.finalizer.applied_result;
    if (receipt.finalizer.kind === 'committed_assembly_replacement') {
      verifyAssemblyReplacementReadback(applied, finalization.adoption, plan);
      applied.ok = true; applied.verification_pending = false;
    }
    const executionTargetValidation = {
      ...(applied.execution_target_validation || {}),
      phases: {
        ...(applied.execution_target_validation?.phases || {}),
        finalization: finalization.summary
      }
    };
    await this.registerArtifacts(task.task_id, applied.artifacts);
    const visualCompletion = task.private?.source_visual_correction
      ? await this.finalizeVisualCorrectionApply(task, applied, {
          appliedAt: receipt.recorded_at,
          expectedModelKey: receipt.model_key,
          expectedModelRevision: receipt.model_revision_after
        })
      : null;
    if (task.private?.source_design_change) {
      const finalized = await this.finalizeReviewedDesignChange(task, applied, {
        expectedModelKey: receipt.model_key,
        expectedModelRevision: receipt.model_revision_after
      });
      return this.markMutationReceiptFinalized(finalized, receipt);
    }
    const allArtifacts = (await this.taskStore.getTask(task.task_id, { includePrivate: true })).artifacts;
    const finalized = await this.taskStore.transition(task.task_id, 'completed', {
      reason: 'reviewed_edit_verified',
      patch: {
        result: {
          kind: 'reviewed_existing_model_edit_result',
          ok: true,
          plan_id: applied.plan_id,
          risk_level: applied.risk_level,
          model_revision_before: receipt.model_revision_before,
          model_revision_after: receipt.model_revision_after,
          authorization: applied.authorization,
          geometry_edits: applied.iteration?.geometry_edits || [],
    qa: applied.iteration?.qa || null,
          target_validation: plan.target_validation,
          execution_target_validation: executionTargetValidation,
          mutation_receipt: { receipt_id: receipt.receipt_id, status: 'finalized' },
          ...(visualCompletion ? {
            source_visual_correction: visualCompletion.lineage.source_visual_correction,
            visual_apply_receipt: {
              receipt_id: visualCompletion.receipt.receipt_id,
              receipt_hash: visualCompletion.receipt.receipt_hash,
              model_revision_after: visualCompletion.receipt.model_revision_after
            }
          } : {})
        },
        artifacts: allArtifacts,
        next_action: null
      }
    });
    return this.markMutationReceiptFinalized(finalized, receipt);
  }

  async markMutationReceiptFinalized(task, receipt) {
    const current = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.update(task.task_id, {
      private: {
        ...current.private,
        mutation_finalization: {
          receipt_id: receipt.receipt_id,
          status: current.state === 'awaiting_review' ? 'post_commit_review_required' : 'finalized'
        }
      },
      result: current.result && typeof current.result === 'object'
        ? {
            ...current.result,
            mutation_receipt: {
              receipt_id: receipt.receipt_id,
              status: current.state === 'awaiting_review' ? 'post_commit_review_required' : 'finalized'
            }
          }
        : current.result
    });
  }

  async modifyDesignParameters(task) {
    const inputs = task.inputs;
    this.assertNoClientModelKey(inputs);
    if (inputs.parameter_edit) return this.planCreationParameterEdit(task);
    const createsDesignGraph = Boolean(inputs.parametric_recipe && inputs.entity_bindings);
    const resumesDesignGraph = Boolean(inputs.design_task_id);
    if (!inputs.changes || (!createsDesignGraph && !resumesDesignGraph)) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'design_parameter_artifacts_required',
        patch: {
          next_action: {
            action: 'submit_task_input',
            required: ['changes', 'design_task_id_or_parametric_recipe_and_entity_bindings']
          }
        }
      });
    }
    if (createsDesignGraph && resumesDesignGraph) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Use either a server DesignIntent task binding or creation artifacts, not both.');
    }
    const runtime = inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({ runtime, recursive: true, recursive_limit: boundedRecursiveLimit(inputs.recursive_limit, this.bridge.executionPolicy, 5000), read_only: true });
    const graphLineage = await this.resolveModelGraphLineage(inputs);
    const modelGraph = buildModelGraph(adoption, graphLineage);
    const persistedGraph = await this.persistModelGraph(task, adoption, modelGraph);
    const resolvedDesign = resumesDesignGraph
      ? await this.resolvePersistedDesignIntent({ taskId: inputs.design_task_id, persistedGraph })
      : null;
    const designGraph = resolvedDesign?.graph || buildDesignIntentGraph({
        modelKey: persistedGraph.model_key,
        modelGraph,
        parametricRecipe: inputs.parametric_recipe,
        featureMappingPlan: inputs.feature_mapping_plan,
        partGraph: inputs.part_graph,
        entityBindings: inputs.entity_bindings,
        correctionHistory: inputs.correction_history
      });
    const persistedDesign = await this.designIntentStore.persist({
      modelKey: persistedGraph.model_key,
      graph: designGraph,
      sourceTaskId: task.task_id
    });
    const changePlan = planDesignParameterChange({
      designGraph,
      currentModelGraph: modelGraph,
      changes: inputs.changes,
      instruction: task.instruction
    });
    const designBinding = designIntentBinding(persistedDesign);
    const changeBinding = designChangeBinding(task.task_id, persistedDesign, changePlan);
    if (!changePlan.blockers.length) bindDesignChangeNextAction(changePlan, changeBinding, {
      runtime,
      saveModel: inputs.save_model !== false,
      captureView: inputs.capture_view === true
    });
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'design-intent');
    const changePath = await writeDesignArtifact(path.join(artifactDir, 'design-parameter-change-plan.v1.json'), changePlan);
    const storeArtifacts = await this.registerDesignIntentArtifacts(task.task_id, persistedDesign, { artifactDir });
    const otherArtifacts = await this.registerArtifacts(task.task_id, {
      model_graph: persistedGraph.graph_path,
      model_graph_manifest: persistedGraph.manifest_path,
      design_parameter_change_plan: changePath
    });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    const artifacts = [...storeArtifacts, ...otherArtifacts];
    return this.taskStore.transition(task.task_id, changePlan.blockers.length ? 'awaiting_input' : 'awaiting_review', {
      reason: changePlan.blockers.length ? 'design_divergence_blocks_change' : 'design_parameter_change_ready_for_review',
      patch: {
        private: {
          ...refreshed.private,
          model_graph: modelGraph,
          model_graph_store: graphStoreSummary(persistedGraph),
          design_intent_graph: designGraph,
          design_intent_binding: designBinding,
          design_intent_store: designStoreSummary(persistedDesign),
          design_parameter_change_plan: changePlan,
          design_change_binding: changeBinding
        },
        result: {
          kind: 'modify_design_parameters_result',
          design_graph: { design_graph_id: designGraph.design_graph_id, stats: designGraph.stats },
          design_intent_store: designStoreSummary(persistedDesign, artifacts),
          change_plan: changePlan
        },
        artifacts: refreshed.artifacts,
        next_action: changePlan.next_action
      }
    });
  }

  async continueParameterTaskEnvelope(task, options) {
    try { task = await continueDefinitionParameterExecution(this, task, options); }
    catch (error) { task = await parameterExecutionError(this, task, error); }
    return createResultEnvelope({ task: await this.taskStore.getTask(task.task_id), ok: !task.last_error,
      error: task.last_error || null, data: responseData(task) });
  }

  // Fresh definitions have a signed one-shot journal. Actual replacement uses
  // the existing reviewed child task and its durable mutation receipt ledger.
  async planCreationParameterEdit(task) {
    if (['changes', 'design_task_id', 'parametric_recipe', 'entity_bindings', 'part_graph', 'feature_mapping_plan', 'assembly_rebuild'].some(key => Object.hasOwn(task.inputs, key))) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Use inputs.parameter_edit alone for the creation-bound parameter route.');
    }
    const request = task.inputs.parameter_edit;
    if (!request || typeof request !== 'object' || !request.creation_task_id) throw new AgentContractError('INVALID_ARGUMENT', 'parameter_edit requires creation_task_id, scope, targets and changes.');
    const sourceTask = await this.taskStore.getTask(request.creation_task_id, { includePrivate: true });
    let record = sourceTask.private?.creation?.parameter_source;
    const unavailable = sourceTask.private?.creation?.parameter_edit_support;
    if (sourceTask.intent !== 'create_model' || !record) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'creation_parameter_baseline_unavailable', patch: {
        result: { kind: 'modify_design_parameters_result', stage: 'blocked_before_planning', execution_allowed: false, quality_accepted: false,
          blockers: ['trusted_creation_parameter_baseline_unavailable'], parameter_edit_support: unavailable || null },
        next_action: { action: 'use_existing_reviewed_edit_workflow', reason: 'A missing creation-time baseline cannot be recreated from the current model.' }
      } });
    }
    const runtime = task.inputs.runtime || record.runtime;
    if (runtime !== record.runtime) throw new AgentContractError('INVALID_ARGUMENT', 'Parameter editing cannot change the creation runtime.');
    const recursiveLimit = boundedRecursiveLimit(task.inputs.recursive_limit, this.bridge.executionPolicy, 5000);
    const sourceTargets = record.entries.map(entry => entry.target);
    const adoption = record.readback_projection === 'assembly-merkle.v2' ? await adoptAssemblySummary({ bridge: this.bridge, recursiveLimit,
      timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000), rootPaths: sourceTargets.map(target => target.entity_path) }) : sourceTargets.length > 1 ? await adoptParameterRoots({ bridge: this.bridge, runtime, recursiveLimit,
      timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000),
      ...(sourceTargets.every(target => target.entity_path) ? { rootPaths: sourceTargets.map(target => target.entity_path) } : { rootIds: sourceTargets.map(target => target.target_id) }) })
      : await this.bridge.adopt_open_model({ runtime, recursive: true, recursive_limit: recursiveLimit, read_only: true,
        timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000) });
    const graph = buildModelGraph(adoption);
    const sourceDocument = sourceTask.private.creation.parameter_source_document_binding;
    if (modelKeyForIdentity(modelIdentityForAdoption(adoption)) !== record.model_key
      || sourceDocument && sourceDocument !== parameterSourceDocumentBinding(adoption)) {
      if (!task.inputs.saved_delivery_task_id) throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'Open model identity differs from the trusted creation baseline. To continue an unchanged server delivery, include inputs.saved_delivery_task_id.');
      record = await resumeSavedDefinitionParameterSource({ gateway: this, sourceTask, deliveryTaskId: task.inputs.saved_delivery_task_id, adoption, modelGraph: graph });
    }
    const edit = planDefinitionParameterEdit({ sourceRecord: record, currentModelGraph: graph, request, taskId: task.task_id,
      iteration: record.parameter_revision, instruction: task.instruction });
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'parameter-edit');
    const artifactPath = await writeDesignArtifact(path.join(artifactDir, 'definition-parameter-edit.v1.json'), edit);
    await this.registerArtifacts(task.task_id, { definition_parameter_edit: artifactPath });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    task = await this.taskStore.update(task.task_id, { private: { ...refreshed.private, creation_parameter_edit: edit,
      parameter_source_record: record, parameter_recursive_limit: recursiveLimit, parameter_timeout_ms: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000) },
      artifacts: refreshed.artifacts });
    if (!edit.ready) return this.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'parameter_manual_divergence_requires_reconciliation', patch: {
      result: { kind: 'modify_design_parameters_result', stage: 'blocked_before_staging', plan_ready: false, divergence: edit.divergence, blockers: edit.blockers,
        definitions_staged: false, execution_allowed: false, quality_accepted: false }, next_action: { action: 'reconcile_design_intent' } } });
    try { return await continueDefinitionParameterExecution(this, task); }
    catch (error) { return parameterExecutionError(this, task, error); }
  }

  // Only invoked immediately after the original committed build. Recovery must
  // not recapture this baseline from a later model revision or hide manual edits.
  async captureCreationParameterBaseline(task, prepared) {
    if (!task.inputs.task || task.private?.creation?.parameter_edit_support?.baseline_captured === true) return task;
    const creation = task.private.creation;
    const attempts = creation.parameter_baseline_attempts || (creation.parameter_edit_support ? 1 : 0);
    if (attempts >= 2) return task;
    let record = null, support, documentBinding, readbackEvidence;
    try {
      if (creation.round.iteration !== 0 || task.private.common_task?.source_hash !== sha256Canonical(task.inputs.task)) throw new AgentContractError('INVALID_ARGUMENT', 'Only the unchanged initial common-task source can establish a parameter baseline.');
      const committedRevision = creation.round.snapshot?.model_revision;
      if (creation.runtime === 'queue' && (!committedRevision || creation.round.snapshot.model_revision_complete !== true)) throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Creation has no complete committed native revision for an immediate parameter baseline.');
      const rootIds = compileModelAccessibilityTask(task.inputs.task).bundle.part_graph.roots.map(root => creation.identity_map[root.instance_id || root.part_id]);
      const recursiveLimit = boundedRecursiveLimit(task.inputs.recursive_limit, this.bridge.executionPolicy, 5000);
      const adoption = creation.runtime === 'queue' && task.inputs.task.kind === 'traditional_timber' ? await adoptAssemblySummary({ bridge: this.bridge, recursiveLimit,
        timeoutMs: Math.max(900_000, boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000)),
        rootPaths: rootPathsFromCommittedSnapshot(creation.round.snapshot, rootIds), expectedRevision: committedRevision }) : rootIds.length > 1 ? await adoptParameterRoots({ bridge: this.bridge, runtime: creation.runtime, recursiveLimit,
        timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000), rootIds })
        : await this.bridge.adopt_open_model({ runtime: creation.runtime, read_only: true, recursive: true,
          recursive_limit: recursiveLimit, timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000) });
      const graph = buildModelGraph(adoption);
      if (creation.runtime === 'queue' && graph.model_revision !== committedRevision) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Model changed between creation and parameter baseline readback.');
      if (creation.runtime === 'mock') {
        // Mock build snapshots have no native revision. Keep this weaker fixture
        // check explicit; it can never stand in for queue revision attestation.
        const { runtime: ignoredRuntime, ...committedSnapshot } = creation.round.snapshot;
        const { runtime: ignoredAdoptionRuntime, ...readbackSnapshot } = adoption.snapshot;
        if (sha256Canonical(committedSnapshot) !== sha256Canonical(readbackSnapshot)) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Mock snapshot changed before parameter baseline readback.');
      }
      record = captureDefinitionParameterSource({ creationTaskId: task.task_id, modelKey: modelKeyForIdentity(modelIdentityForAdoption(adoption)),
        modelGraph: graph, sourceTask: task.inputs.task, identityMap: creation.identity_map, materialMap: creation.material_map, creationDocument: prepared.document });
      await verifyHostCreationCapture({ task, taskStore: this.taskStore, prepared, modelGraph: graph });
      documentBinding = parameterSourceDocumentBinding(adoption);
      readbackEvidence = adoption.bounded_readback || null;
      support = { baseline_captured: true, planning_available: true, execution_available: true, evidence_level: creation.runtime === 'queue' ? 'trusted_immediate_creation_readback' : 'mock_initial_snapshot_match',
        source_record_hash: record.source_record_hash, blockers: [] };
    } catch (error) {
      record = null;
      support = { baseline_captured: false, planning_available: false, execution_available: false, evidence_level: 'creation_baseline_capture_blocked',
        blockers: [error.code || 'PARAMETER_BASELINE_CAPTURE_FAILED'], reason: String(error.message) };
    }
    const captured = await this.taskStore.update(task.task_id, { private: { ...task.private, creation: { ...creation, parameter_baseline_attempts: attempts + 1,
      parameter_edit_support: support, ...(record ? { parameter_source: record, parameter_source_document_binding: documentBinding,
        ...(readbackEvidence ? { parameter_source_readback: readbackEvidence } : {}) } : {}) } } });
    if (record) {
      try { await indexCapturedParameterSource({ taskStore: this.taskStore, task: captured }); }
      catch (error) { return this.taskStore.update(task.task_id, { private: { ...captured.private, creation: { ...captured.private.creation,
        parameter_source_discovery: { available: false, reason: error.code || 'SOURCE_INDEX_WRITE_FAILED' } } } }); }
    }
    return captured;
  }

  async reconcileDesignIntent(task) {
    const inputs = task.inputs;
    this.assertNoClientModelKey(inputs);
    if (!inputs.design_task_id) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'design_intent_graph_required',
        patch: { next_action: { action: 'submit_task_input', required: ['design_task_id'] } }
      });
    }
    if (inputs.accepted_change_plan !== undefined) {
      throw new AgentContractError('INVALID_ARGUMENT', 'accepted_change_plan must come from a server-persisted DesignIntent change task.');
    }
    if (inputs.design_intent_graph !== undefined) {
      throw new AgentContractError('INVALID_ARGUMENT', 'design_intent_graph cannot be retransmitted by an Agent; resume with its server task id.');
    }
    const runtime = inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({ runtime, recursive: true, recursive_limit: boundedRecursiveLimit(inputs.recursive_limit, this.bridge.executionPolicy, 5000), read_only: true });
    const graphLineage = await this.resolveModelGraphLineage(inputs);
    const modelGraph = buildModelGraph(adoption, graphLineage);
    const persistedGraph = await this.persistModelGraph(task, adoption, modelGraph);
    const resolvedDesign = await this.resolvePersistedDesignIntent({ taskId: inputs.design_task_id, persistedGraph });
    const reconciliation = reconcileDesignIntentGraph({
      designGraph: resolvedDesign.graph,
      currentModelGraph: modelGraph,
      acceptedChangePlan: null
    });
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'design-reconciliation');
    const persistedDesign = await this.designIntentStore.persist({
      modelKey: persistedGraph.model_key,
      graph: resolvedDesign.graph,
      sourceTaskId: task.task_id,
      reconciliation
    });
    const storeArtifacts = await this.registerDesignIntentArtifacts(task.task_id, persistedDesign, { artifactDir });
    const otherArtifacts = await this.registerArtifacts(task.task_id, {
      model_graph: persistedGraph.graph_path,
      model_graph_manifest: persistedGraph.manifest_path
    });
    const artifacts = [...storeArtifacts, ...otherArtifacts];
    const approvalChallenge = reconciliation.review_required
      ? await this.createDesignReconciliationChallenge(task, reconciliation)
      : null;
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, reconciliation.review_required ? 'awaiting_review' : 'completed', {
      reason: reconciliation.review_required ? 'design_reconciliation_review_required' : 'design_intent_aligned',
      patch: {
        private: {
          ...refreshed.private,
          model_graph: modelGraph,
          model_graph_store: graphStoreSummary(persistedGraph),
          design_intent_graph: resolvedDesign.graph,
          design_intent_binding: designIntentBinding(persistedDesign),
          design_intent_store: designStoreSummary(persistedDesign),
          design_reconciliation: reconciliation,
          design_reconciliation_approval: approvalChallenge
        },
        result: {
          kind: 'reconcile_design_intent_result',
          design_intent_store: designStoreSummary(persistedDesign, artifacts),
          reconciliation,
          approval_challenge: approvalChallenge
        },
        artifacts: refreshed.artifacts,
        next_action: approvalChallenge
          ? this.approvalNextAction(approvalChallenge)
          : null
      }
    });
  }

  assertNoClientModelKey(inputs = {}) {
    if (Object.hasOwn(inputs, 'model_key')) {
      throw new AgentContractError('INVALID_ARGUMENT', 'model_key is server-owned and cannot be supplied by an Agent.');
    }
  }

  async resolvePersistedDesignIntent({ taskId, persistedGraph } = {}) {
    const sourceTask = await this.taskStore.getTask(taskId, { includePrivate: true });
    const binding = sourceTask.private?.design_intent_binding;
    if (!binding) {
      throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The referenced task does not own a server-persisted DesignIntentGraph.');
    }
    assertDesignIntentBinding(binding);
    if (binding.model_key !== persistedGraph.model_key) {
      throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The DesignIntent task belongs to a different model.', {
        details: { design_task_id: sourceTask.task_id }
      });
    }
    const loaded = await this.designIntentStore.load(binding.model_key, binding.design_graph_id);
    if (loaded.graph.model_revision !== binding.model_revision
      || loaded.graph.source_model_graph_id !== binding.source_model_graph_id) {
      throw new AgentContractError('MODEL_GRAPH_INTEGRITY_ERROR', 'The task DesignIntent binding no longer matches its immutable store version.');
    }
    return { ...loaded, source_task: sourceTask, binding };
  }

  async resolveSourceDesignChange(task) {
    const source = task.inputs?.source_design_change;
    if (!source) return null;
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || typeof source.task_id !== 'string'
      || canonicalJson(Object.keys(source).sort()) !== canonicalJson(['task_id'])) {
      throw new AgentContractError('INVALID_ARGUMENT', 'source_design_change must be the opaque task reference emitted by the server.');
    }
    if (task.inputs.operations !== undefined || task.inputs.targets !== undefined
      || task.inputs.model_key !== undefined || task.inputs.design_graph_id !== undefined
      || task.inputs.change_plan_id !== undefined) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A source-bound DesignIntent rebuild cannot include Agent-supplied targets, operations, or lineage bindings.');
    }
    const sourceTask = await this.taskStore.getTask(source.task_id, { includePrivate: true });
    const changePlan = sourceTask.private?.design_parameter_change_plan;
    const binding = sourceTask.private?.design_change_binding;
    const designBinding = sourceTask.private?.design_intent_binding;
    if (sourceTask.intent !== 'modify_design_parameters'
      || sourceTask.state !== 'awaiting_review'
      || !changePlan
      || changePlan.blockers?.length
      || !binding
      || !designBinding) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The source DesignIntent change is not ready for one-time reviewed promotion.');
    }
    assertDesignIntentBinding(designBinding);
    if (binding.task_id !== sourceTask.task_id
      || binding.change_plan_id !== changePlan.change_plan_id
      || binding.change_plan_hash !== designChangePlanHash(changePlan)
      || binding.design_graph_id !== designBinding.design_graph_id
      || binding.model_key !== designBinding.model_key
      || binding.model_revision !== changePlan.model_revision) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'The source DesignIntent binding does not match the server-persisted change plan.');
    }
    const promotion = sourceTask.private?.design_change_promotion;
    if (promotion && promotion.task_id !== task.task_id) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The DesignIntent change has already been promoted into a reviewed edit task.', {
        details: { promoted_task_id: promotion.task_id }
      });
    }
    const sourceRuntime = sourceTask.inputs?.runtime || 'mock';
    const requestedRuntime = task.inputs?.runtime || sourceRuntime;
    if (requestedRuntime !== sourceRuntime) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A DesignIntent change cannot be promoted into a different runtime.');
    }
    const loaded = await this.designIntentStore.load(designBinding.model_key, designBinding.design_graph_id);
    return { source_task: sourceTask, change_plan: changePlan, binding, design_binding: designBinding, design_graph: loaded.graph };
  }

  async registerDesignIntentArtifacts(taskId, persisted, { artifactDir } = {}) {
    const directory = artifactDir || path.join(this.taskStore.rootDir, 'task-artifacts', taskId, 'design-intent-store');
    const manifestSnapshot = await writeDesignArtifact(
      path.join(directory, `design-intent-store-manifest-${persisted.design_graph_id}.json`),
      persisted.manifest
    );
    return this.registerArtifacts(taskId, {
      design_intent_graph: this.designIntentStore.graphPath(persisted.model_key, persisted.design_graph_id),
      ...(persisted.reconciliation ? {
        design_intent_reconciliation: this.designIntentStore.reconciliationPath(
          persisted.model_key,
          persisted.reconciliation.reconciliation_id
        )
      } : {}),
      design_intent_store_manifest: manifestSnapshot
    });
  }

  async createDesignReconciliationChallenge(task, reconciliation) {
    return this.bridge.approvalAuthority.createChallenge({
      taskId: task.task_id,
      planId: reconciliation.reconciliation_id,
      planHash: designReconciliationHash(reconciliation),
      modelRevision: reconciliation.current_model_revision,
      riskLevel: 'S2',
      allowedOperations: ['accept_design_reconciliation'],
      reviewContext: {
        kind: 'design_intent_reconciliation_review_context',
        summary: '设计意图差异协调',
        instruction: task.instruction,
        content_trust: 'untrusted_data',
        policy_effect: 'none',
        affected_instance_count: 0,
        targets: [],
        decision_options: reconciliation.proposed_decisions
          .filter((entry) => entry.decision !== 'restore_design_intent')
          .map((entry) => ({ value: entry.decision, label: entry.label || entry.decision })),
        operations: [{ index: 0, op: 'accept_design_reconciliation', destructive: false, topology: false }]
      },
      idempotencyKey: `design-reconciliation:${task.task_id}:${reconciliation.reconciliation_id}`
    });
  }

  async finalizeReviewedDesignChange(task, applied, { expectedModelKey, expectedModelRevision } = {}) {
    const source = await this.resolvePersistedDesignIntent({
      taskId: task.private.source_design_change.task_id,
      persistedGraph: { model_key: task.private.design_intent_binding.model_key }
    });
    const runtime = task.inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({
      runtime,
      recursive: true,
      recursive_limit: task.private.existing_edit_plan?.budgets?.recursive_limit || 5000,
      read_only: true
    });
    const modelGraph = buildModelGraph(adoption, await this.resolveModelGraphLineage(task.inputs));
    const persistedGraph = await this.persistModelGraph(task, adoption, modelGraph);
    if ((expectedModelKey && persistedGraph.model_key !== expectedModelKey)
      || (expectedModelRevision && modelGraph.model_revision !== expectedModelRevision)) {
      throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed while the reviewed DesignIntent edit was being finalized.');
    }
    if (persistedGraph.model_key !== source.binding.model_key) {
      throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The reviewed rebuild completed in a different model.');
    }
    const changePlan = task.private.design_parameter_change_plan;
    if (!changePlan || designChangePlanHash(changePlan) !== task.private.source_design_change.change_plan_hash) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'The reviewed DesignIntent change plan is no longer intact.');
    }
    const reconciliation = reconcileDesignIntentGraph({
      designGraph: source.graph,
      currentModelGraph: modelGraph,
      acceptedChangePlan: changePlan
    });
    if (reconciliation.unexpected_divergence.length) {
      const persistedDesign = await this.designIntentStore.persist({
        modelKey: persistedGraph.model_key,
        graph: source.graph,
        sourceTaskId: task.task_id,
        reconciliation
      });
      const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'design-post-apply-reconciliation');
      await this.registerDesignIntentArtifacts(task.task_id, persistedDesign, { artifactDir });
      const challenge = await this.createDesignReconciliationChallenge(task, reconciliation);
      const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
      return this.taskStore.transition(task.task_id, 'awaiting_review', {
        reason: 'reviewed_rebuild_unexpected_divergence',
        patch: {
          private: {
            ...refreshed.private,
            model_graph: modelGraph,
            design_intent_graph: source.graph,
            design_intent_binding: designIntentBinding(persistedDesign),
            design_intent_store: designStoreSummary(persistedDesign),
            design_reconciliation: reconciliation,
            design_reconciliation_approval: challenge,
            design_post_apply_reconciliation: true,
            reviewed_edit_result: reviewedEditResult(applied)
          },
          result: {
            ...reviewedEditResult(applied),
            lineage_status: 'unexpected_divergence_review_required',
            reconciliation,
            approval_challenge: challenge
          },
          artifacts: refreshed.artifacts,
          next_action: this.approvalNextAction(challenge)
        }
      });
    }

    const updatedGraph = acceptReconciliation({
      designGraph: source.graph,
      currentModelGraph: modelGraph,
      reconciliation,
      decision: 'accept_reviewed_parameter_change',
      acceptedChangePlan: changePlan,
      eventId: deterministicCorrectionEventId(task.task_id, reconciliation, 'accept_reviewed_parameter_change'),
      reviewedAt: task.created_at
    });
    const persistedDesign = await this.designIntentStore.persist({
      modelKey: persistedGraph.model_key,
      graph: updatedGraph,
      sourceTaskId: task.task_id,
      reconciliation
    });
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'design-reviewed-rebuild');
    const designArtifacts = await this.registerDesignIntentArtifacts(task.task_id, persistedDesign, { artifactDir });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, 'completed', {
      reason: 'reviewed_edit_and_design_lineage_verified',
      patch: {
        private: {
          ...refreshed.private,
          model_graph: modelGraph,
          model_graph_store: graphStoreSummary(persistedGraph),
          design_intent_graph: updatedGraph,
          design_intent_binding: designIntentBinding(persistedDesign),
          design_intent_store: designStoreSummary(persistedDesign),
          design_reconciliation: reconciliation,
          reviewed_edit_result: reviewedEditResult(applied)
        },
        result: {
          ...reviewedEditResult(applied),
          lineage_status: 'persisted',
          design_intent_store: designStoreSummary(persistedDesign, designArtifacts),
          reconciliation
        },
        artifacts: refreshed.artifacts,
        next_action: null
      }
    });
  }

  async completeDesignReconciliationReview(task, input) {
    const reconciliation = task.private?.design_reconciliation;
    const binding = task.private?.design_intent_binding;
    const challenge = task.private?.design_reconciliation_approval;
    if (!reconciliation || !binding || !challenge) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The task has no pending server-persisted DesignIntent reconciliation.');
    }
    const trustedApproval = await this.resolveTrustedApproval(challenge);
    if (input.decision && trustedApproval.local_decision?.review_selection && input.decision !== trustedApproval.local_decision.review_selection) {
      throw new AgentContractError('APPROVAL_INVALID', 'The Agent-supplied reconciliation decision differs from the trusted local user selection.');
    }
    const proposedDecisions = new Set(reconciliation.proposed_decisions.map((entry) => entry.decision));
    const decision = String(trustedApproval.local_decision?.review_selection || input.decision || '');
    if (!proposedDecisions.has(decision) || decision === 'restore_design_intent') {
      throw new AgentContractError('INVALID_ARGUMENT', 'The selected reconciliation decision is not supported by this metadata-only review.', {
        nextAction: decision === 'restore_design_intent'
          ? { action: 'start_reviewed_existing_model_edit' }
          : { action: 'request_user_reconciliation_review' }
      });
    }
    const runtime = task.inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({
      runtime,
      recursive: true,
      recursive_limit: boundedRecursiveLimit(task.inputs.recursive_limit, this.bridge.executionPolicy, 5000),
      read_only: true
    });
    const modelGraph = buildModelGraph(adoption, await this.resolveModelGraphLineage(task.inputs));
    const persistedGraph = await this.persistModelGraph(task, adoption, modelGraph);
    if (persistedGraph.model_key !== binding.model_key) {
      throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The active model no longer matches the DesignIntent review.');
    }
    if (modelGraph.model_revision !== reconciliation.current_model_revision) {
      throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed after DesignIntent reconciliation was prepared.', {
        details: { expected: reconciliation.current_model_revision, actual: modelGraph.model_revision }
      });
    }
    const source = await this.designIntentStore.load(binding.model_key, binding.design_graph_id);
    const allowedChangePlan = decision === 'accept_reviewed_parameter_change'
      ? task.private?.design_parameter_change_plan
      : null;
    if (decision === 'accept_reviewed_parameter_change' && !allowedChangePlan) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'No server-persisted reviewed parameter change is bound to this reconciliation.');
    }
    await this.bridge.approvalAuthority.consumeToken(trustedApproval.approval_token, {
      task_id: task.task_id,
      plan_id: reconciliation.reconciliation_id,
      plan_hash: designReconciliationHash(reconciliation),
      model_revision: reconciliation.current_model_revision,
      risk_level: 'S2',
      allowed_operations: ['accept_design_reconciliation']
    });
    task = await this.taskStore.transition(task.task_id, 'approved', {
      reason: 'trusted_design_reconciliation_approval_present',
      patch: { last_error: null, next_action: { action: 'continue_server_work' } }
    });
    task = await this.taskStore.transition(task.task_id, 'executing', { reason: 'design_reconciliation_persistence_started' });
    const updatedGraph = acceptReconciliation({
      designGraph: source.graph,
      currentModelGraph: modelGraph,
      reconciliation,
      decision,
      acceptedChangePlan: allowedChangePlan,
      eventId: deterministicCorrectionEventId(task.task_id, reconciliation, decision),
      reviewedAt: task.created_at
    });
    const persistedDesign = await this.designIntentStore.persist({
      modelKey: persistedGraph.model_key,
      graph: updatedGraph,
      sourceTaskId: task.task_id,
      reconciliation
    });
    const designArtifacts = await this.registerDesignIntentArtifacts(task.task_id, persistedDesign, {
      artifactDir: path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'design-reconciliation-accepted')
    });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    const baseResult = refreshed.private?.reviewed_edit_result || { kind: 'reconcile_design_intent_result' };
    return this.taskStore.transition(task.task_id, 'completed', {
      reason: 'design_reconciliation_persisted',
      patch: {
        private: {
          ...refreshed.private,
          model_graph: modelGraph,
          model_graph_store: graphStoreSummary(persistedGraph),
          design_intent_graph: updatedGraph,
          design_intent_binding: designIntentBinding(persistedDesign),
          design_intent_store: designStoreSummary(persistedDesign),
          design_post_apply_reconciliation: false
        },
        result: {
          ...baseResult,
          lineage_status: 'persisted_after_trusted_reconciliation',
          decision,
          design_intent_store: designStoreSummary(persistedDesign, designArtifacts),
          reconciliation
        },
        artifacts: refreshed.artifacts,
        next_action: null
      }
    });
  }

  async referenceImageCorrection(task) {
    const inputs = task.inputs;
    assertNoLegacyVisualInputs(inputs);
    const runtime = inputs.runtime || 'mock';
    if (runtime === 'queue') assertNoAgentLiveCaptureInputs(inputs, { phase: 'before' });
    const required = runtime === 'queue'
      ? ['reference_image_handle', 'session_contract']
      : ['reference_image_handle', 'capture_image_handle'];
    if (required.some((field) => !inputs[field])) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: runtime === 'queue' ? 'reference_handle_and_live_session_required' : 'immutable_reference_and_capture_handles_required',
        patch: {
          next_action: {
            action: 'submit_task_input',
            required,
            warning: runtime === 'queue'
              ? 'The server will capture the current SketchUp view; it rejects Agent paths, capture handles, camera options, and provenance claims.'
              : 'Mock capture handles are explicit test fixtures and do not prove live SketchUp provenance.'
          }
        }
      });
    }
    const recursiveLimit = boundedRecursiveLimit(inputs.recursive_limit, this.bridge.executionPolicy, 5000);
    const adoption = await this.bridge.adopt_open_model({ runtime, recursive: true, recursive_limit: recursiveLimit, read_only: true });
    const graphLineage = await this.resolveModelGraphLineage(inputs);
    const modelGraph = buildModelGraph(adoption, graphLineage);
    const persistedGraph = await this.persistModelGraph(task, adoption, modelGraph);
    const binding = {
      model_key: persistedGraph.model_key,
      graph_id: modelGraph.graph_id,
      model_revision: modelGraph.model_revision
    };
    const liveCapture = runtime === 'queue'
      ? await this.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, (gatewayBridge) => this.liveVisualCaptureService.capture({
          bridge: gatewayBridge,
          taskId: task.task_id,
          phase: 'before',
          sessionContract: inputs.session_contract,
          expectedBinding: binding,
          recursiveLimit
        }))
      : null;
    const captureHandle = liveCapture?.record.handle || inputs.capture_image_handle;
    const captureProvenance = liveCapture?.provenance || serverVisualCaptureProvenance({
      taskId: task.task_id,
      binding,
      runtime,
      handle: captureHandle,
      phase: 'before'
    });
    const analysis = await analyzeReferenceImageCorrection({
      imageArtifactStore: this.imageArtifactStore,
      referenceHandle: inputs.reference_image_handle,
      captureHandle,
      captureProvenance,
      modelGraph,
      modelBinding: binding,
      sourceTaskId: task.task_id,
      modelSnapshot: adoption.snapshot,
      referenceSpec: inputs.reference_spec,
      correctionTargets: inputs.correction_targets,
      correctionOperations: inputs.correction_operations
    });
    await this.registerArtifacts(task.task_id, {
      model_graph: persistedGraph.graph_path,
      model_graph_manifest: persistedGraph.manifest_path
    });
    await this.registerVisualArtifacts(task.task_id, analysis.artifacts, 'visual-correction');
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    const blocked = analysis.correction_patch.blockers.length > 0;
    return this.taskStore.transition(task.task_id, blocked ? 'awaiting_input' : 'awaiting_review', {
      reason: blocked ? 'visual_correction_inputs_blocked' : 'visual_correction_ready_for_review',
      patch: {
        private: {
          ...refreshed.private,
          model_graph: modelGraph,
          model_graph_store: graphStoreSummary(persistedGraph),
          bound_image_handles: mergeBoundImageHandles(
            refreshed.private?.bound_image_handles,
            inputs.reference_image_handle,
            captureHandle,
            analysis.artifacts
          ),
          visual_evidence: analysis.evidence,
          visual_correction_patch: analysis.correction_patch,
          visual_correction_private_patch: analysis.server_private.correction_patch,
          ...(liveCapture ? { visual_live_capture_receipt: liveCapture.provenance } : {})
        },
        result: {
          kind: 'reference_image_correction_result',
          evidence: analysis.evidence,
          correction_patch: analysis.correction_patch,
          image_artifacts: analysis.artifacts,
          visual_agent_required: false,
          local_files_required: false,
          capture_mode: analysis.capture_mode
        },
        artifacts: refreshed.artifacts,
        next_action: analysis.correction_patch.next_action
      }
    });
  }

  async visualCorrectionQa(task) {
    const inputs = task.inputs;
    assertNoLegacyVisualInputs(inputs);
    if (!inputs.source_visual_correction) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'source_visual_correction_required',
        patch: {
          next_action: {
            action: 'submit_task_input',
            required: ['source_visual_correction']
          }
        }
      });
    }
    const source = await this.resolveVisualCorrectionQaSource(inputs.source_visual_correction);
    const runtime = inputs.runtime || source.source_task.inputs?.runtime || 'mock';
    if (runtime !== (source.source_task.inputs?.runtime || 'mock')) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction QA cannot switch runtimes from its source task.');
    }
    if (runtime === 'queue') assertNoAgentLiveCaptureInputs(inputs, { phase: 'after' });
    const required = runtime === 'queue'
      ? ['session_contract']
      : ['reference_image_handle', 'recapture_image_handle'];
    if (required.some((field) => !inputs[field])) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: runtime === 'queue' ? 'live_recapture_session_required' : 'source_lineage_and_immutable_image_handles_required',
        patch: { next_action: { action: 'submit_task_input', required } }
      });
    }
    const recursiveLimit = boundedRecursiveLimit(inputs.recursive_limit, this.bridge.executionPolicy, 5000);
    const adoption = await this.bridge.adopt_open_model({
      runtime,
      recursive: true,
      recursive_limit: recursiveLimit,
      read_only: true
    });
    const modelGraph = buildModelGraph(adoption);
    const persistedGraph = await this.persistModelGraph(task, adoption, modelGraph);
    const binding = {
      model_key: persistedGraph.model_key,
      graph_id: modelGraph.graph_id,
      model_revision: modelGraph.model_revision
    };
    const liveRecapture = runtime === 'queue'
      ? await this.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, (gatewayBridge) => this.liveVisualCaptureService.capture({
          bridge: gatewayBridge,
          taskId: task.task_id,
          phase: 'after',
          sessionContract: inputs.session_contract,
          expectedBinding: binding,
          recursiveLimit,
          sourceCaptureProvenance: source.lineage.before_capture.capture_provenance
        }))
      : null;
    const referenceHandle = runtime === 'queue' ? source.lineage.reference_image.handle : inputs.reference_image_handle;
    const recaptureHandle = liveRecapture?.record.handle || inputs.recapture_image_handle;
    const recaptureProvenance = liveRecapture?.provenance || serverVisualCaptureProvenance({
      taskId: task.task_id,
      binding,
      runtime,
      handle: recaptureHandle,
      phase: 'after'
    });
    const verified = await verifyReferenceImageCorrection({
      imageArtifactStore: this.imageArtifactStore,
      referenceHandle,
      recaptureHandle,
      recaptureProvenance,
      sourceLineage: source.lineage,
      afterModelBinding: binding,
      qaTaskId: task.task_id
    });
    await this.registerArtifacts(task.task_id, {
      model_graph: persistedGraph.graph_path,
      model_graph_manifest: persistedGraph.manifest_path
    });
    await this.registerVisualArtifacts(task.task_id, verified.artifacts, 'visual-correction-qa');
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, verified.report.review_required ? 'awaiting_review' : 'completed', {
      reason: verified.report.review_required ? 'visual_residuals_require_review' : 'visual_correction_qa_passed',
      patch: {
        private: {
          ...refreshed.private,
          bound_image_handles: mergeBoundImageHandles(
            refreshed.private?.bound_image_handles,
            referenceHandle,
            recaptureHandle,
            verified.artifacts
          ),
          visual_source_task_id: source.source_task.task_id,
          visual_source_lineage_hash: source.lineage.lineage_hash,
          model_graph: modelGraph,
          model_graph_store: graphStoreSummary(persistedGraph),
          ...(liveRecapture ? { visual_live_recapture_receipt: liveRecapture.provenance } : {})
        },
        result: verified.result,
        artifacts: refreshed.artifacts,
        next_action: verified.report.next_action
      }
    });
  }

  async verifyModel(task) {
    const inputs = task.inputs;
    if (inputs.creation_task_id) return verifyDefinitionParameterResult(this, task);
    if (Object.hasOwn(inputs, 'task') || Object.hasOwn(inputs, 'source_task_id')) {
      const source = typeof inputs.source_task_id === 'string'
        ? await this.taskStore.getTask(inputs.source_task_id, { includePrivate: true }).catch(() => null) : null;
      const acceptedCreation = source?.intent === 'create_model' && source.state === 'completed' && source.result?.quality_accepted === true && source.result?.evidence_level === 'live_runtime';
      throw new AgentContractError('INVALID_ARGUMENT', 'verify_model does not accept task or source_task_id. A creation already includes quality verification. Deliver its accepted result; after a parameter edit use creation_task_id and parameter_task_id in a new frozen verification task.', {
        nextAction: acceptedCreation ? { action: 'connect_for_delivery', ...discoverCall({ topic: 'connect', runtime: 'queue' }), source_task_id: source.task_id,
          then: { tool: 'start_agent_task', intent: 'deliver_model', inputs: { source_task_id: source.task_id, runtime: 'queue', connection_task_id: '<returned connect task_id>' } } }
          : source ? { action: 'resume_creation_quality_result', tool: 'resume_agent_task', arguments: { task_id: source.task_id } }
            : { action: 'discover_verification_contract', ...discoverCall({ topic: 'workflows', task_name: 'save_reopen_resume' }) }
      });
    }
    if (Object.hasOwn(inputs, 'snapshot')) {
      const snapshot = inputs.snapshot;
      const object = value => value && typeof value === 'object' && !Array.isArray(value);
      if (!object(snapshot) || !Array.isArray(snapshot.groups) || !Array.isArray(snapshot.instances)
        || !object(snapshot.totals) || ['faces', 'edges', 'groups', 'instances'].some(key => !Number.isSafeInteger(snapshot.totals[key]) || snapshot.totals[key] < 0)
        || snapshot.groups.some(item => !object(item)) || snapshot.instances.some(item => !object(item))
        || snapshot.totals.groups > snapshot.groups.length || snapshot.totals.instances > snapshot.instances.length
        || !object(snapshot.bounding_box) || ['min', 'max'].some(key => !Array.isArray(snapshot.bounding_box[key]) || snapshot.bounding_box[key].length !== 3 || snapshot.bounding_box[key].some(value => !Number.isFinite(value)))
        || snapshot.warnings !== undefined && !Array.isArray(snapshot.warnings)) {
        throw new AgentContractError('INVALID_ARGUMENT', 'snapshot must be a structured model snapshot with groups, instances, nonnegative integer totals and finite bounding_box; a task id, string, array or empty object is not model evidence.', {
          nextAction: { action: 'supply_structured_snapshot_or_use_creation_result', accepted_inputs: ['snapshot object from actual inspect_model output', 'creation_task_id plus completed parameter_task_id for frozen verification'],
            accepted_creation_next_step: 'connect then deliver_model with source_task_id; never put a task id in snapshot' }
        });
      }
    }
    if (!inputs.code && !inputs.snapshot) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'verification_input_required',
        patch: { next_action: { action: 'submit_task_input', required: ['code_or_snapshot'] } }
      });
    }
    if (inputs.code && inputs.snapshot) {
      throw new AgentContractError('INVALID_ARGUMENT', 'verify_model accepts code or snapshot, but not both in one task.');
    }
    const preparedCode = inputs.code
      ? prepareAgentGatewayCreationDsl(inputs.code, { intent: task.intent }).code
      : null;
    if ((inputs.runtime || 'mock') === 'queue' && inputs.code && !inputs.session_contract) {
      throw new AgentContractError('HANDSHAKE_REQUIRED', 'A fresh queue handshake is required when verification builds code in live SketchUp.');
    }
    const runtime = inputs.runtime || 'mock';
    let next;
    let verificationSnapshot = inputs.snapshot || null;
    let trustedVerificationSnapshot = false;
    const report = await this.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, async (gatewayBridge) => {
      const verify = async (authorizedBridge) => {
        next = await this.taskStore.transition(task.task_id, 'verifying', {
          reason: 'verification_started',
          patch: { last_error: null, next_action: { action: 'continue_server_work' } }
        });
        if (inputs.code) {
          const built = await authorizedBridge.build_model({ code: preparedCode, runtime });
          verificationSnapshot = built.snapshot || null;
          trustedVerificationSnapshot = Boolean(verificationSnapshot);
        }
        const report = await authorizedBridge.validate_model({
          snapshot: verificationSnapshot,
          runtime,
          spec: inputs.spec,
          includePreview: inputs.include_preview !== false
        });
        return report;
      };
      if (runtime === 'queue' && inputs.code) {
        return gatewayBridge.withLiveMutationAuthorization({
          runtime,
          session_contract: inputs.session_contract,
          operation: 'validate_model'
        }, verify);
      }
      return verify(gatewayBridge);
    });
    const frozenSpecification = freezeDetailSpecification(inputs.detail_spec);
    const regionCheck = trustedVerificationSnapshot ? await this.inspectFrozenDetailRegions(task, { frozen_spec: frozenSpecification, runtime }) : null;
    const quality = evaluateDetailQuality({ snapshot: verificationSnapshot || {}, layoutQa: report, frozenSpecification, runtime, trustedSnapshot: trustedVerificationSnapshot,
      regionInspection: regionCheck?.raw_result, trustedRegionInspection: regionCheck?.received_from_server === true });
    next = await this.taskStore.transition(task.task_id, 'completed', {
      reason: 'verification_completed',
      patch: { private: { ...next.private, detail_region_inspection: regionCheck }, result: { kind: 'verify_model_result', report, quality, quality_status: quality.quality_status, quality_accepted: quality.quality_accepted, evidence_level: quality.evidence_level }, next_action: null }
    });
    return next;
  }

  async materializeTransientImageInputs(intent, value = {}) {
    const inputs = structuredClone(value || {});
    const hasBase64 = inputs.image_base64 !== undefined;
    const hasMediaType = inputs.media_type !== undefined;
    if (!hasBase64) return inputs;
    if (intent !== 'image_artifact') {
      throw new AgentContractError('INVALID_ARGUMENT', 'Transient image_base64 is accepted only by the image_artifact task intent.');
    }
    if (!hasBase64 || typeof inputs.image_base64 !== 'string' || !inputs.image_base64) {
      throw new AgentContractError('INVALID_ARGUMENT', 'image_artifact transient ingest requires non-empty image_base64.');
    }
    if (inputs.image_handle !== undefined || inputs.input_dir !== undefined || inputs.asset_set_path !== undefined) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Transient image ingest cannot be combined with another image source.');
    }
    const ingested = await this.imageArtifactStore.ingestBase64(inputs.image_base64, {
      mediaType: hasMediaType ? inputs.media_type : undefined
    });
    delete inputs.image_base64;
    delete inputs.media_type;
    inputs.image_handle = ingested.record.handle;
    return inputs;
  }

  async prepareImageArtifact(task) {
    const inputs = task.inputs;
    if (inputs.image_base64 !== undefined || inputs.media_type !== undefined) {
      throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Raw transient image data must never reach persisted task execution.');
    }
    if (inputs.action === 'structure') return prepareImageStructure(this, task);
    if (inputs.image_handle) {
      const record = await this.imageArtifactStore.inspect(inputs.image_handle);
      const current = await this.taskStore.getTask(task.task_id, { includePrivate: true });
      return this.taskStore.transition(task.task_id, 'completed', {
        reason: 'immutable_image_artifact_registered',
        patch: {
          private: {
            ...current.private,
            bound_image_handles: mergeBoundImageHandles(
              current.private?.bound_image_handles,
              record.handle
            )
          },
          result: {
            kind: 'immutable_image_artifact_result',
            image: record,
            local_files_required: false,
            visual_agent_required: false
          },
          next_action: null
        }
      });
    }
    if (!inputs.input_dir && !inputs.asset_set_path) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'image_artifact_required',
        patch: { next_action: { action: 'submit_task_input', required: ['image_base64_and_media_type_or_server_asset_source'] } }
      });
    }
    const prepared = await this.bridge.prepare_image_modeling_brief({
      ...inputs,
      output_dir: path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'image-brief')
    });
    const handles = await this.registerArtifacts(task.task_id, prepared.artifacts);
    return this.taskStore.transition(task.task_id, prepared.compile_allowed ? 'awaiting_review' : 'awaiting_input', {
      reason: prepared.compile_allowed ? 'image_promotion_review_required' : 'image_artifact_blocked',
      patch: {
        result: { kind: 'image_artifact_brief', blocked: prepared.blocked, compile_allowed: prepared.compile_allowed, blockers: prepared.blockers },
        artifacts: handles,
        next_action: prepared.compile_allowed
          ? { action: 'request_user_review', workflow: 'image_promotion' }
          : { action: 'resolve_blockers', blockers: prepared.blockers }
      }
    });
  }

  async createModel(task) {
    if (task.inputs.source_image_model && task.private?.image_model_creation?.approved) await assertFrozenImageCreation(this,task);
    if (task.inputs.source_image_model && !task.private?.image_model_creation?.approved) return prepareImageModelCreation(this, task);
    if (task.inputs.task && !task.private?.creation) {
      if (!['mock', 'queue'].includes(task.inputs.runtime)) throw new AgentContractError('INVALID_ARGUMENT', 'Common-task creation requires an explicit runtime: mock or queue.', { details: { recovery_class: 'design_input', issues: [{ path: '/inputs/runtime', message: 'Choose mock for offline checks or queue for SketchUp.' }] } });
      if (!task.private?.common_task && ['code', 'detail_spec', 'views', 'spec'].some(key => Object.hasOwn(task.inputs, key))) throw new AgentContractError('INVALID_ARGUMENT', 'Use inputs.task alone for common-task geometry and quality. Use the existing code entry for advanced DSL.');
      const compiled = await this.compileCommonTask(task);
      task = await this.taskStore.update(task.task_id, {
        inputs: { ...task.inputs, ...compiled.inputs },
        private: { ...task.private, common_task: { source_hash: sha256Canonical(task.inputs.task), preflight: compiled.preflight, ...(compiled.bundle.rule_binding?{rule_binding:compiled.bundle.rule_binding}: {}) } }
      });
    }
    const inputs = task.inputs;
    const previous = task.private?.creation;
    const frozenSpec = freezeDetailSpecification(inputs.detail_spec, previous?.frozen_spec);
    const runtime = previous?.runtime || inputs.runtime || 'mock';
    const hasPreviousBuild = Boolean(previous?.round?.snapshot);
    const sourceCode = hasPreviousBuild ? inputs.refinement_code : inputs.code;
    if (hasPreviousBuild && inputs.reverify === true) {
      const inspected = previous.timber_rule_binding && runtime === 'queue'
        ? await readTimberQualitySummary({ bridge: this.bridge, creation: previous, timeoutMs: boundedQueueTimeoutMs(inputs.timeout_ms, 120_000) })
        : await this.bridge.inspect_model({ runtime, includeSnapshot: true, timeoutMs: boundedQueueTimeoutMs(inputs.timeout_ms, 120_000) });
      const snapshot = inspected.snapshot && { ...inspected.snapshot, model_revision: inspected.model_revision || inspected.snapshot.model_revision };
      if (!snapshot) throw new AgentContractError('INVALID_ARGUMENT', 'Reverification requires a fresh server snapshot.');
      let resetStreaks = false;
      if (inputs.reviewed_edit_task_id) {
        const reviewed = await this.taskStore.getTask(inputs.reviewed_edit_task_id, { includePrivate: true });
        if (reviewed.intent !== 'reviewed_existing_model_edit' || reviewed.state !== 'completed' || !snapshot.model_revision || reviewed.result?.model_revision_after !== snapshot.model_revision || (reviewed.inputs?.runtime || 'mock') !== runtime) throw new AgentContractError('INVALID_ARGUMENT', 'A completed reviewed edit bound to the current revision is required to reset refinement streaks.');
        resetStreaks = true;
      }
      task = await this.taskStore.update(task.task_id, { private: { ...task.private, creation: { ...previous, ...(resetStreaks ? { per_part_failure_streak: {} } : {}), round: { ...previous.round, snapshot } } } });
      task = await this.taskStore.transition(task.task_id, 'verifying', { reason: 'fresh_creation_reverification' });
      return this.finalizeCreationQuality(task, { timberSummary: previous.timber_rule_binding && runtime === 'queue' ? inspected : null });
    }
    if (!sourceCode) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: hasPreviousBuild ? 'refinement_required' : 'safe_dsl_required',
        patch: { next_action: { action: 'submit_task_input', required: hasPreviousBuild ? ['refinement_code_or_reverify'] : ['code'] } }
      });
    }
    const iteration = previous?.rounds?.length || 0;
    const refinementParts = inputs.refinement_part_ids || (hasPreviousBuild ? Object.keys(previous.per_part_failure_streak || {}) : []);
    if (!Array.isArray(refinementParts) || refinementParts.some(id => typeof id !== 'string' || !id)) throw new AgentContractError('INVALID_ARGUMENT', 'refinement_part_ids must contain stable part ids.');
    const exhaustedParts = Object.entries(previous?.per_part_failure_streak || {}).filter(([, count]) => count >= 3).map(([id]) => id);
    if (exhaustedParts.length) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'detail_part_refinement_budget_exhausted', patch: { next_action: { action: 'start_reviewed_existing_model_edit', required: ['reviewed_edit_task_id_then_reverify'], unfinished_parts: exhaustedParts } } });
    }
    if (iteration >= (frozenSpec?.specification.max_iterations || 6)) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'detail_iteration_budget_exhausted', patch: { next_action: { action: 'review_unfinished_model', quality_accepted: false, required: ['reverify_after_reviewed_edit'] } } });
    }
    const sourceHash = sha256Canonical(sourceCode);
    if (previous?.rounds?.some(round => round.source_hash === sourceHash)) throw new AgentContractError('INVALID_ARGUMENT', 'This creation patch already ran; reverify instead of replaying it.');
    let parsed;
    try { parsed = JSON.parse(sourceCode); } catch { throw new AgentContractError('INVALID_ARGUMENT', 'Creation requires JSON DSL.'); }
    const scoped = (parsed.operations || []).some(operation => ['component_definition', 'material', 'cut_hole', 'cut_slot', 'cut_recess', 'material_preset', 'kitchen_component', 'fixture_embed'].includes(operation.op));
    const hostPrepared = await prepareHostCreationDsl({ task, taskStore: this.taskStore, sourceCode, iteration });
    const prepared = hostPrepared || (scoped ? prepareTaskOwnedCreationDsl(sourceCode, { taskId: task.task_id, iteration }) : prepareAgentGatewayCreationDsl(sourceCode, { intent: task.intent }));
    if (scoped && runtime === 'queue') {
      const capabilities = await this.bridge.get_capabilities({ runtime });
      if (capabilities.runtime?.creation_scope?.version !== 'creation-scope.v1' || capabilities.runtime.creation_scope.atomic_absence_validation !== true) throw new AgentContractError('POLICY_DENIED', 'The loaded runtime does not attest atomic creation-scope validation.');
      if (hostPrepared && capabilities.runtime.creation_scope.host_new_root_metadata !== 'new-root-metadata.v1') throw new AgentContractError('POLICY_DENIED', 'The loaded runtime does not attest bounded host new-root metadata.');
    }
    if (runtime === 'queue' && !this.bridge.executionPolicy.allow_queue_mutation) {
      throw new AgentContractError('POLICY_DENIED', 'The server execution policy does not allow Agent Gateway queue mutation.');
    }
    if (runtime === 'queue' && !inputs.session_contract) {
      throw new AgentContractError('HANDSHAKE_REQUIRED', 'A fresh queue handshake is required before Agent Gateway live model creation.');
    }
    if (hasPreviousBuild && Object.keys(prepared.identity_map || {}).some(id => previous.identity_map?.[id])) throw new AgentContractError('INVALID_ARGUMENT', 'An existing logical part requires reviewed editing; refinement cannot allocate a duplicate replacement.');
    let creation = { ...previous, runtime, frozen_spec: frozenSpec, ...(task.private?.common_task?.rule_binding?{timber_rule_binding:task.private.common_task.rule_binding}:{}), layout_spec: previous?.layout_spec || inputs.spec || {}, layout_spec_hash: previous?.layout_spec_hash || sha256Canonical(inputs.spec || {}), rounds: previous?.rounds || [], identity_map: { ...previous?.identity_map, ...prepared.identity_map }, material_map: { ...previous?.material_map, ...prepared.material_map }, ...(prepared.host_provisioning ? { host_provisioning: prepared.host_provisioning } : {}), round: { source_hash: sourceHash, phase: 'executing', iteration, refinement_part_ids: refinementParts } };
    task = await this.taskStore.update(task.task_id, { private: { ...task.private, creation } });
    const built = await this.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, (gatewayBridge) => gatewayBridge.withLiveMutationAuthorization({
      runtime,
      timeoutMs: boundedQueueTimeoutMs(inputs.timeout_ms, 120_000),
      session_contract: inputs.session_contract,
      operation: 'build_model'
    }, async (authorizedBridge) => {
      if(!creation.qa_baseline&&!creation.timber_rule_binding){
        const qa_baseline=await captureCreationQaBaseline(authorizedBridge,runtime,creation.layout_spec,boundedQueueTimeoutMs(inputs.timeout_ms,120_000));
        creation={...creation,qa_baseline};
        task=await this.taskStore.update(task.task_id,{private:{...task.private,creation}});
      }
      task = await this.taskStore.transition(task.task_id, 'executing', {
        reason: 'safe_dsl_build_started',
        patch: { last_error: null, next_action: { action: 'continue_server_work' } }
      });
      return authorizedBridge.build_model({ code: prepared.code, runtime, snapshot_detail:!creation.timber_rule_binding, timeoutMs: boundedQueueTimeoutMs(inputs.timeout_ms, 120_000) });
    }));
    // Persist the committed result before QA. Recovery only finalizes this stored
    // result; an execution with no durable result is never automatically replayed.
    task = await this.taskStore.update(task.task_id, { private: { ...task.private, creation: { ...creation, round: { ...creation.round, phase: 'built', snapshot: built.snapshot, mutation_receipt: built.mutation_receipt || built.snapshot?.mutation_receipt || null } } } });
    task = await this.captureCreationParameterBaseline(task, prepared);
    task = await this.taskStore.transition(task.task_id, 'verifying', { reason: 'safe_dsl_build_completed' });
    return this.finalizeCreationQuality(task);
  }

  // Internal handoff only: this method is not an MCP input surface. A receipt
  // must retain the in-process brand granted after the reviewed native edit.
  async recordTrustedAssemblyEditMapping({ creation_task_id, receipt } = {}) {
    if (!isTrustedAssemblyEditReceipt(receipt)) throw new AgentContractError('APPROVAL_INVALID', 'Assembly detail mapping requires a trusted completed edit receipt.');
    const task = await this.taskStore.getTask(creation_task_id, { includePrivate: true });
    const creation = task.private?.creation;
    if (task.intent !== 'create_model' || !creation?.frozen_spec || receipt.runtime !== creation.runtime) throw new AgentContractError('INVALID_ARGUMENT', 'Assembly mapping must belong to a creation task with frozen detail requirements in the same runtime.');
    // Journal the branded handoff before any slow read. A process restart may
    // resume this signed server record, but cannot promote a supplied JSON receipt.
    const core = { version: 'pending-assembly-mapping.v1', task_id: task.task_id,
      specification_hash: creation.frozen_spec.hash, receipt: structuredClone(receipt) };
    const pending = { ...core, integrity_hmac: await this.taskStore.mutationReceiptLedger.sign(core) };
    await this.taskStore.update(task.task_id, { private: { ...task.private,
      creation: { ...creation, pending_assembly_mapping: pending } } });
    return this.resumeTrustedAssemblyEditMapping({ creation_task_id });
  }

  // Internal read-only recovery. It never stages definitions or replays an edit.
  async resumeTrustedAssemblyEditMapping({ creation_task_id } = {}) {
    const task = await this.taskStore.getTask(creation_task_id, { includePrivate: true });
    const creation = task.private?.creation;
    const pending = creation?.pending_assembly_mapping;
    if (!pending) throw new AgentContractError('APPROVAL_INVALID', 'No server-journaled assembly mapping is available.');
    const { integrity_hmac, ...core } = pending;
    if (core.version !== 'pending-assembly-mapping.v1' || core.task_id !== task.task_id
      || core.specification_hash !== creation.frozen_spec?.hash
      || integrity_hmac !== await this.taskStore.mutationReceiptLedger.sign(core)) {
      throw new AgentContractError('APPROVAL_INVALID', 'The pending assembly mapping failed server integrity verification.');
    }
    const receipt = core.receipt;
    if (task.intent !== 'create_model' || receipt.runtime !== creation.runtime) throw new AgentContractError('INVALID_ARGUMENT', 'Assembly recovery belongs to a different task or runtime.');
    const timeoutMs = boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000);
    const summary = receipt.readback_projection === 'assembly-merkle.v2'
      ? await adoptAssemblySummary({ bridge: this.bridge, timeoutMs, rootPaths: receipt.recursive_roots,
        recursiveLimit: boundedRecursiveLimit(receipt.recursive_limit, this.bridge.executionPolicy, 5000) }) : null;
    const inspected = summary ? null : await this.bridge.inspect_model({ runtime: creation.runtime, timeoutMs, includeSnapshot: true });
    const snapshot = summary?.snapshot || inspected?.snapshot || {};
    const revision = summary?.model_revision || (snapshot.model_revision && (creation.runtime !== 'queue' || snapshot.model_revision_complete === true)
      ? snapshot.model_revision
      : buildModelGraph(receipt.recursive_roots?.length > 1
        ? await adoptParameterRoots({ bridge: this.bridge, runtime: creation.runtime, timeoutMs,
          recursiveLimit: boundedRecursiveLimit(receipt.recursive_limit, this.bridge.executionPolicy, 5000), rootPaths: receipt.recursive_roots })
        : await this.bridge.adopt_open_model({ runtime: creation.runtime, timeoutMs, recursive: true,
          recursive_limit: boundedRecursiveLimit(receipt.recursive_limit, this.bridge.executionPolicy, 5000),
          ...(receipt.recursive_roots ? { recursive_roots: receipt.recursive_roots } : {}), read_only: true })).model_revision);
    if (revision !== receipt.model_revision_after) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed after the trusted assembly receipt.');
    if ((creation.assembly_edit_receipts || []).some(previous => sha256Canonical(previous) === sha256Canonical(receipt))) {
      return { kind: 'trusted_assembly_detail_mapping', task_id: task.task_id, mapped_parts: 0, already_recorded: true,
        specification_hash: creation.frozen_spec.hash, model_revision: revision };
    }
    const mapping = { ...creation.occurrence_path_map };
    const streaks = { ...creation.per_part_failure_streak };
    const mappedRootPrefixes = [];
    let mappedParts = 0;
    const canonicalPath = item => item.persistent_path?.length ? `pid:${item.persistent_path.join('.')}` : item.entity_path;
    for (const requirement of creation.frozen_spec.specification.required_parts) {
      if (!requirement.instance_path) continue;
      const key = JSON.stringify(requirement.instance_path);
      const oldPath = mapping[key] || requirement.instance_path.map(id => creation.identity_map?.[id] || id);
      for (const root of receipt.selected_roots || []) {
        const nativeRoot = (snapshot.geometry_occurrences || []).find(item => canonicalPath(item) === root.entity_path);
        const prefix = nativeRoot?.instance_path || oldPath.slice(0, oldPath.indexOf(root.reference) + 1);
        if (!prefix?.length || prefix.some((id, index) => id !== oldPath[index])) continue;
        const nextPath = [...prefix, ...requirement.instance_path.slice(prefix.length).map(id => receipt.identity_map?.[id] || creation.identity_map?.[id] || id)];
        const currentOccurrence = (snapshot.geometry_occurrences || []).find(item => canonicalJson(item.instance_path) === canonicalJson(nextPath));
        const observed = (root.occurrences || []).some(item => currentOccurrence
          ? item.entity_path === canonicalPath(currentOccurrence)
          : canonicalJson(item.instance_path) === canonicalJson(nextPath));
        if (!observed) throw new AgentContractError('MODEL_REVISION_MISMATCH', `Reviewed assembly readback did not contain required descendant ${requirement.id}.`);
        for (let length = prefix.length; length <= nextPath.length; length++) mapping[JSON.stringify(requirement.instance_path.slice(0, length))] = nextPath.slice(0, length);
        mappedRootPrefixes.push(prefix);
        streaks[key] = 0;
        mappedParts++;
        break;
      }
    }
    if (!mappedParts) throw new AgentContractError('INVALID_ARGUMENT', 'No frozen detail occurrence belongs to the reviewed assembly roots.');
    for (const region of creation.frozen_spec.specification.required_voids || []) {
      const mappedPath = mapping[JSON.stringify(region.instance_path)] || region.instance_path.map(id => creation.identity_map?.[id] || id);
      if (mappedRootPrefixes.some(prefix => prefix.every((id, index) => mappedPath[index] === id))) streaks[`void:${region.id}`] = 0;
    }
    await this.taskStore.update(task.task_id, { private: { ...task.private, creation: { ...creation,
      occurrence_path_map: mapping, per_part_failure_streak: streaks,
      assembly_edit_receipts: [...(creation.assembly_edit_receipts || []), structuredClone(receipt)] } } });
    return { kind: 'trusted_assembly_detail_mapping', task_id: task.task_id, mapped_parts: mappedParts,
      specification_hash: creation.frozen_spec.hash, model_revision: revision };
  }

  async inspectFrozenDetailRegions(task, creation) {
    const requirements = creation.frozen_spec?.specification.required_voids || [];
    if (!requirements.length) return null;
    // The query is derived only from persisted frozen requirements. Inputs may
    // neither replace bounds nor inject a successful native inspection receipt.
    const queries = requirements.map(requirement => ({ id: requirement.id,
      instance_path: creation.occurrence_path_map?.[JSON.stringify(requirement.instance_path)] || requirement.instance_path.map(id => creation.identity_map?.[id] || id),
      bounds_mm: structuredClone(requirement.bounds_mm), search_scope: requirement.search_scope || 'scene',
      boundary_checks: structuredClone(requirement.boundary_checks || []) }));
    try {
      if (typeof this.bridge.inspect_detail_regions !== 'function') throw new Error('Native detail region queries are unavailable.');
      const raw = await this.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, gatewayBridge => gatewayBridge.inspect_detail_regions({ queries, runtime: creation.runtime, timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000) }));
      return { queries, raw_result: raw, received_from_server: true, error: null };
    } catch (error) {
      return { queries, raw_result: null, received_from_server: false, error: { message: String(error?.message || error), code: error?.code || null } };
    }
  }

  async recoverLateTimberCreation(task) {
    const creation = task.private.creation;
    if (sha256Canonical(task.inputs.code) !== creation.round.source_hash) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The frozen creation source changed before recovery.');
    const prepared = prepareTaskOwnedCreationDsl(task.inputs.code, {taskId: task.task_id, iteration: creation.round.iteration});
    if (!creation.late_commit) {
      const document = JSON.parse(prepared.code);
      // A committed timber hall can take longer than the caller's mutation
      // timeout to calculate its complete native revision. Recovery is read-only
      // and must wait for that revision rather than abandoning the receipt.
      const runtime = this.bridge.selectRuntime('queue', {timeoutMs: Math.max(600_000, boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000))});
      await runtime.recoverCommittedCreation({
        roots: document.operations.filter(op => op.op === 'component_instance').map(op => ({id: op.id, definition: op.definition})),
        definitions: document.creation_scope.definitions,
        session: task.inputs.session_contract,
        startedAt: task.history.find(item => item.reason === 'safe_dsl_build_started')?.at || task.created_at,
        persist: async result => {
          const record = {task_id: task.task_id, source_hash: creation.round.source_hash, ...result};
          const late_commit = {...record, integrity_hmac: await this.taskStore.mutationReceiptLedger.sign(record)};
          task = await this.taskStore.update(task.task_id, {private: {...task.private, creation: {...creation, late_commit}}});
        }
      });
    }
    task = await this.taskStore.restoreCommittedCreation(task.task_id);
    return this.captureCreationParameterBaseline(task, prepared);
  }

  async finalizeCreationQuality(task, { timberSummary = null } = {}) {
    if (task.state === 'executing') task = await this.taskStore.transition(task.task_id, 'verifying', { reason: 'recover_creation_quality_without_rebuild' });
    let creation = task.private.creation;
    const snapshot = creation.round.snapshot;
    const timber=Boolean(creation.timber_rule_binding);
    const timberReadTimeoutMs=timber?Math.max(900_000,boundedQueueTimeoutMs(task.inputs.timeout_ms,120_000)):null;
    if(timber&&creation.frozen_spec?.specification.coverage_version!==TIMBER_QUALITY_SCOPE)throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR','Timber creation lost its frozen assembly contract.');
    const summary=timber?(timberSummary || await readTimberQualitySummary({bridge:this.bridge,creation,timeoutMs:timberReadTimeoutMs})):null;
    if(summary&&summary.model_revision!==snapshot.model_revision)throw new AgentContractError('MODEL_REVISION_MISMATCH','Model changed after the committed timber operation.');
    let qa = timber?{verdict:'pass',validation_scope:'atomic_creation_and_native_assembly_summary',collision_acceptance:false}
      :await this.bridge.validate_model({ snapshot, runtime: creation.runtime, spec: creation.layout_spec, includePreview: task.inputs.include_preview !== false });
    const collisionReview = timber?{qa,evidence:{scope:'visible_joints_reviewed_in_final_whole_hall',full_collision_sweep:false}}
      :await narrowDetailLayoutQa({ bridge: this.bridge, snapshot, qa, runtime: creation.runtime, timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000) });
    if(!timber)qa = await applyCreationQaScope(this.bridge,collisionReview.qa,creation,snapshot,boundedQueueTimeoutMs(task.inputs.timeout_ms,120_000));
    creation = { ...creation, round: { ...creation.round, collision_review: collisionReview.evidence } };
    task = await this.taskStore.update(task.task_id, { private: { ...task.private, creation } });
    let captures = creation.round.captures || [];
    let captureError = null;
    let captureArtifacts = task.artifacts || [];
    const requiredViews = creation.frozen_spec?.specification.required_views || [];
    if (requiredViews.length && !requiredViews.every(view => captures.some(capture => capture.id === view.id && capture.model_revision === snapshot.model_revision && capture.server_verified === true && capture.width >= (view.min_width || 1) && capture.height >= (view.min_height || 1)))) {
      const captureAttempt = (creation.round.capture_attempts || 0) + 1;
      creation = { ...creation, round: { ...creation.round, capture_attempts: captureAttempt } };
      task = await this.taskStore.update(task.task_id, { private: { ...task.private, creation } });
      let captureRawResult = null;
      let capturePrivateError = null;
      try {
        if (typeof this.bridge.capture_detail_views !== 'function') throw new Error('The runtime does not support server detail capture.');
        const views = requiredViews.map(requirement => {
          const view = { ...(task.private?.frozen_creation_verification?.views || task.inputs.views || []).find(candidate => candidate.id === requirement.id), ...requirement };
          return { ...view, ...(view.target_id ? { target_id: creation.identity_map?.[view.target_id] || view.target_id } : {}), ...(view.instance_path ? { instance_path: creation.occurrence_path_map?.[JSON.stringify(view.instance_path)] || view.instance_path.map(id => creation.identity_map?.[id] || id) } : {}) };
        });
        const outputDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'detail-views', `iteration-${creation.round.iteration}`, `attempt-${captureAttempt}`);
        const captured = await this.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, async (gatewayBridge) => {
          if (timber && captureAttempt > 1) {
            const recovered = await recoverTimberOverview({bridge: gatewayBridge, taskStore: this.taskStore, taskId: task.task_id,
              view: requiredViews[0], summary, timeoutMs: timberReadTimeoutMs,
              priorOutputDirs: Array.from({length: captureAttempt-1}, (_,i)=>path.join(path.dirname(outputDir), `attempt-${i+1}`))});
            if (recovered) return recovered;
          }
          const handshake = creation.runtime === 'queue' ? await gatewayBridge.create_queue_handshake({timeoutMs: timberReadTimeoutMs || boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000), expires_in_ms: 300000}) : null;
          if (timber) return captureTimberOverview({bridge: gatewayBridge, view: requiredViews[0], outputDir,
            modelRevision: snapshot.model_revision, timeoutMs: timberReadTimeoutMs, sessionContract: handshake.session_contract});
          return gatewayBridge.capture_detail_views({ views, output_dir: outputDir, runtime: creation.runtime, timeoutMs: boundedQueueTimeoutMs(task.inputs.timeout_ms, 120_000), ...(handshake ? { session_contract: handshake.session_contract } : {}) });
        });
        captureRawResult = captured;
        captures = captured.captures || [];
        if (captured.restored !== true && !(timber && captured.view_left_for_delivery === true)) throw new Error('Detail capture did not attest restoration of the prior view.');
        const paths = Object.fromEntries(captures.filter(capture => capture.path).map(capture => [`detail_view_${capture.id}`, capture.path]));
        if (Object.keys(paths).length) captureArtifacts = [...captureArtifacts, ...await this.registerArtifacts(task.task_id, paths)];
      } catch (error) {
        captures = [];
        capturePrivateError = { message: String(error?.message || error), code: error?.code || null };
        captureError = { message: 'Required server detail views are not verified.', code: error?.code || 'DETAIL_CAPTURE_UNVERIFIED' };
      }
      creation = { ...creation, round: { ...creation.round, captures, capture_error: captureError,
        capture_diagnostics: [...(creation.round.capture_diagnostics || []), { attempt: captureAttempt, raw_result: captureRawResult, error: capturePrivateError }] } };
      task = await this.taskStore.update(task.task_id, { artifacts: captureArtifacts, private: { ...task.private, creation } });
    }
    const regionCheck = await this.inspectFrozenDetailRegions(task, creation);
    if (regionCheck) {
      creation = { ...creation, round: { ...creation.round, region_inspection: regionCheck,
        region_inspection_attempts: (creation.round.region_inspection_attempts || 0) + 1 } };
      task = await this.taskStore.update(task.task_id, { private: { ...task.private, creation } });
    }
    const quality = timber?evaluateTimberQuality({summary,creation,captures}):evaluateDetailQuality({ snapshot, layoutQa: qa, frozenSpecification: creation.frozen_spec, runtime: creation.runtime, trustedSnapshot: true, identityMap: creation.identity_map, materialMap: creation.material_map, occurrencePathMap: creation.occurrence_path_map, captures,
      regionInspection: regionCheck?.raw_result, trustedRegionInspection: regionCheck?.received_from_server === true });
    const newRound = !creation.rounds.some(round => round.source_hash === creation.round.source_hash);
    const rounds = newRound ? [...creation.rounds, { source_hash: creation.round.source_hash, iteration: creation.round.iteration }] : creation.rounds;
    const streaks = { ...creation.per_part_failure_streak };
    const failedParts = new Set(quality.remaining.map(issue => issue.part_key || issue.part_id || (issue.view_id ? `view:${issue.view_id}` : '__layout__')));
    for (const id of Object.keys(streaks)) if (!failedParts.has(id)) streaks[id] = 0;
    // A caller's claimed part list cannot suppress a failed measured check.
    // The initial build records missing requirements; only later committed
    // refinements consume the three-attempt budget.
    if (newRound) for (const id of failedParts) streaks[id] = (streaks[id] || 0) + (creation.round.iteration > 0 ? 1 : 0);
    const nextInputs = { ...task.inputs };
    delete nextInputs.refinement_code;
    delete nextInputs.reverify;
    delete nextInputs.refinement_part_ids;
    delete nextInputs.reviewed_edit_task_id;
    return this.taskStore.transition(task.task_id, quality.quality_status === 'pass' ? 'completed' : 'awaiting_input', {
      reason: quality.quality_status === 'pass' ? 'created_model_quality_passed' : 'created_model_requires_refinement',
      patch: {
        last_error: null,
        inputs: nextInputs,
        private: { ...task.private, creation: { ...creation, rounds, per_part_failure_streak: streaks, round: { ...creation.round, phase: 'verified', captures, capture_error: captureError } } },
        result: { ...(task.private?.image_model_creation ? { image_model: { source_image_model:task.inputs.source_image_model, assumptions:task.private.image_model_creation.plan.assumptions, scale_mode:task.private.image_model_creation.plan.scale_mode, complete_model_delivered:false, visual_acceptance:'pending' } } : {}), kind: task.private?.frozen_creation_verification ? 'verify_creation_result' : 'create_model_result', snapshot, qa, quality, quality_status: quality.quality_status, quality_accepted: quality.quality_accepted, evidence_level: quality.evidence_level, iteration: rounds.length, identity_map: creation.identity_map,
          ...(task.private?.frozen_creation_verification ? { source_creation_task_id: task.private.frozen_creation_verification.creation_task_id,
            parameter_task_id: task.private.frozen_creation_verification.parameter_task_id, geometry_built: false, specification_hash: creation.frozen_spec.hash } : {}),
          ...(task.inputs.task ? { parameter_edit_support: creation.parameter_edit_support || { baseline_captured: false, planning_available: false, execution_available: false, blockers: ['trusted_initial_parameter_readback_unavailable'] } } : {}) },
        next_action: quality.quality_status === 'pass' ? (task.inputs.task && creation.runtime === 'queue' ? { action: 'connect_for_delivery', ...discoverCall({ topic: 'connect', runtime: 'queue' }), source_task_id: task.task_id } : null) : { action: 'submit_task_input', required: ['refinement_code_or_reverify'], existing_edits_route: 'reviewed_existing_model_edit', remaining: quality.remaining }
      }
    });
  }

  async persistModelGraph(task, adoption, graph) {
    let identityHint = adoption.model_identity;
    if (adoption.runtime === 'queue') {
      const handshake = await this.bridge.create_queue_handshake({ expires_in_ms: 60000 });
      const contract = handshake.session_contract;
      if (adoption.session_id !== contract.session_id
        || adoption.document_id !== contract.document_id
        || canonicalJson(adoption.model_identity) !== canonicalJson(contract.model_identity)) {
        throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The active SketchUp document changed while its ModelGraph identity was being bound.', {
          details: {
            adoption_document_id: adoption.document_id || null,
            handshake_document_id: contract.document_id
          }
        });
      }
      if (adoption.occurrence_contract !== contract.occurrence_contract
        || adoption.model_revision_complete !== contract.model_revision_complete
        || adoption.model_revision_total_seen !== contract.model_revision_total_seen
        || adoption.model_revision_indexed !== contract.model_revision_indexed) {
        throw new AgentContractError('HANDSHAKE_CAPABILITIES_MISMATCH', 'The live model indexing contract changed while its ModelGraph was being bound.');
      }
      if (contract.model_revision !== graph.model_revision) {
        throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The active SketchUp model changed while its ModelGraph identity was being bound.', {
          details: { expected: graph.model_revision, actual: contract.model_revision }
        });
      }
      identityHint = { ...contract.model_identity, document_id: contract.document_id };
    }
    return this.modelGraphStore.persist({
      graph,
      adoption,
      identityHint,
      sourceTaskId: task.task_id
    });
  }

  async resolveSourceProposal(task) {
    const source = task.inputs?.source_proposal;
    if (!source) return null;
    if (task.inputs.operations !== undefined || task.inputs.targets !== undefined) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A source-bound proposal cannot be combined with client-supplied operations or targets.');
    }
    const sourceTask = await this.taskStore.getTask(source.task_id, { includePrivate: true });
    const proposal = sourceTask.private?.edit_proposal;
    if (sourceTask.intent !== 'propose_existing_model_edit' || sourceTask.state !== 'awaiting_review' || !proposal || proposal.requires_clarification) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The source proposal is not ready for promotion into a reviewed edit task.');
    }
    const existingPromotion = sourceTask.private?.source_proposal_promotion;
    if (existingPromotion && existingPromotion.task_id !== task.task_id) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The source proposal has already been promoted into a reviewed task.', {
        details: { promoted_task_id: existingPromotion.task_id }
      });
    }
    const sourceRuntime = sourceTask.inputs?.runtime || 'mock';
    const requestedRuntime = task.inputs?.runtime || sourceRuntime;
    if (requestedRuntime !== sourceRuntime) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A source-bound proposal cannot be promoted into a different runtime.');
    }
    const { proposal_id: _proposalId, proposal_hash: _proposalHash, clarification: _clarification, next_action: _nextAction, ...proposalCore } = proposal;
    const actualHash = sha256Canonical(proposalCore);
    const binding = {
      task_id: sourceTask.task_id,
      proposal_id: proposal.proposal_id,
      proposal_hash: proposal.proposal_hash,
      graph_id: proposal.graph_id,
      model_key: proposal.model_key,
      model_revision: proposal.model_revision
    };
    if (actualHash !== proposal.proposal_hash
      || source.task_id !== binding.task_id
      || source.proposal_id !== binding.proposal_id
      || source.proposal_hash !== binding.proposal_hash
      || source.graph_id !== binding.graph_id
      || source.model_key !== binding.model_key
      || source.model_revision !== binding.model_revision) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'The source proposal binding does not match the server-persisted proposal.');
    }
    return { source_task: sourceTask, proposal, binding };
  }

  async resolveSourceVisualCorrection(task) {
    const source = task.inputs?.source_visual_correction;
    if (!source) return null;
    if (typeof source !== 'string' || !/^source_visual_correction:task_[0-9a-f-]+$/i.test(source)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'source_visual_correction must be an opaque server task binding.');
    }
    if (task.inputs.operations !== undefined || task.inputs.targets !== undefined) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A source-bound visual correction cannot be combined with client-supplied operations or targets.');
    }
    const sourceTaskId = source.slice('source_visual_correction:'.length);
    const sourceTask = await this.taskStore.getTask(sourceTaskId, { includePrivate: true });
    const evidence = sourceTask.private?.visual_evidence;
    const publicPatch = sourceTask.private?.visual_correction_patch;
    const privatePatch = sourceTask.private?.visual_correction_private_patch;
    if (sourceTask.intent !== 'reference_image_correction'
      || sourceTask.state !== 'awaiting_review'
      || !evidence
      || !publicPatch
      || !privatePatch
      || publicPatch.blockers?.length) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The source visual correction is not ready for reviewed promotion.');
    }
    const existingPromotion = sourceTask.private?.visual_correction_promotion;
    if (existingPromotion && existingPromotion.task_id !== task.task_id) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The source visual correction has already been promoted.', {
        details: { promoted_task_id: existingPromotion.task_id }
      });
    }
    const sourceRuntime = sourceTask.inputs?.runtime || 'mock';
    if ((task.inputs.runtime || sourceRuntime) !== sourceRuntime) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A source-bound visual correction cannot switch runtimes.');
    }
    if (publicPatch.next_action?.source_visual_correction !== source
      || publicPatch.private_payload_hash !== privatePatch.private_payload_hash
      || publicPatch.patch_hash !== privatePatch.patch_hash
      || publicPatch.correction_patch_id !== privatePatch.correction_patch_id
      || evidence.evidence_id !== publicPatch.evidence_id
      || evidence.evidence_hash !== publicPatch.evidence_hash) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'The source visual correction binding does not match server-private state.');
    }
    return {
      source_task: sourceTask,
      evidence,
      public_patch: publicPatch,
      private_patch: privatePatch,
      binding: {
        source_visual_correction: source,
        source_task_id: sourceTask.task_id,
        correction_patch_id: publicPatch.correction_patch_id,
        patch_hash: publicPatch.patch_hash,
        private_payload_hash: publicPatch.private_payload_hash,
        model_key: publicPatch.model_key,
        graph_id: publicPatch.graph_id,
        model_revision: publicPatch.model_revision
      }
    };
  }

  async resolveVisualCorrectionQaSource(source) {
    if (typeof source !== 'string' || !/^source_visual_correction:task_[0-9a-f-]+$/i.test(source)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction QA requires an opaque source_visual_correction binding.');
    }
    const sourceTask = await this.taskStore.getTask(source.slice('source_visual_correction:'.length), { includePrivate: true });
    const lineage = sourceTask.private?.visual_source_lineage;
    if (sourceTask.intent !== 'reference_image_correction'
      || !lineage
      || lineage.source_visual_correction !== source
      || sourceTask.private?.visual_apply_receipt?.receipt_hash !== lineage.apply_receipt?.receipt_hash) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The visual correction source has no completed reviewed apply lineage.');
    }
    return { source_task: sourceTask, lineage };
  }

  async finalizeVisualCorrectionApply(task, applied, {
    appliedAt = new Date().toISOString(),
    expectedModelKey,
    expectedModelRevision
  } = {}) {
    const sourceBinding = task.private?.source_visual_correction;
    const plan = task.private?.existing_edit_plan;
    if (!sourceBinding || !plan) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The reviewed visual correction has no server source binding.');
    }
    const sourceTask = await this.taskStore.getTask(sourceBinding.source_task_id, { includePrivate: true });
    const runtime = task.inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({
      runtime,
      recursive: true,
      recursive_limit: plan.budgets?.recursive_limit || 5000,
      read_only: true
    });
    const modelGraph = buildModelGraph(adoption);
    const persistedGraph = await this.persistModelGraph(task, adoption, modelGraph);
    if ((expectedModelKey && persistedGraph.model_key !== expectedModelKey)
      || (expectedModelRevision && modelGraph.model_revision !== expectedModelRevision)) {
      throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed while the visual correction apply was being finalized.');
    }
    if (persistedGraph.model_key !== sourceBinding.model_key) {
      throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The applied visual correction ended on a different model identity.');
    }
    const receiptCore = {
      version: VISUAL_APPLY_RECEIPT_VERSION,
      kind: 'reviewed_existing_model_edit_apply_receipt',
      receipt_id: `visual-apply-${sha256Canonical({ task_id: task.task_id, plan_id: plan.plan_id, model_revision_after: modelGraph.model_revision }).slice(7, 31)}`,
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      model_key: persistedGraph.model_key,
      model_revision_before: applied.model_revision_before,
      model_revision_after: modelGraph.model_revision,
      committed: true,
      applied_at: appliedAt
    };
    const receipt = { ...receiptCore, receipt_hash: visualCorrectionApplyReceiptHash(receiptCore) };
    const lineage = buildVisualCorrectionSourceLineage({
      evidence: sourceTask.private.visual_evidence,
      correctionPatch: sourceTask.private.visual_correction_patch,
      privateCorrectionPatch: sourceTask.private.visual_correction_private_patch,
      plan: {
        plan_id: plan.plan_id,
        plan_hash: plan.plan_hash,
        model_key: plan.model_key,
        model_revision: plan.model_revision,
        source_visual_correction: sourceBinding.source_visual_correction
      },
      applyReceipt: receipt
    });
    await this.taskStore.update(sourceTask.task_id, {
      private: {
        ...sourceTask.private,
        visual_apply_receipt: receipt,
        visual_source_lineage: lineage,
        visual_after_model_graph: modelGraph,
        visual_after_model_graph_store: graphStoreSummary(persistedGraph)
      }
    });
    const refreshedReviewed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    await this.taskStore.update(task.task_id, {
      private: {
        ...refreshedReviewed.private,
        visual_apply_receipt: receipt,
        visual_source_lineage_hash: lineage.lineage_hash,
        visual_after_model_graph: modelGraph,
        visual_after_model_graph_store: graphStoreSummary(persistedGraph)
      }
    });
    await this.registerArtifacts(task.task_id, {
      visual_after_model_graph: persistedGraph.graph_path,
      visual_after_model_graph_manifest: persistedGraph.manifest_path
    });
    return { receipt, lineage, model_graph: modelGraph };
  }

  async resolveModelGraphLineage(inputs = {}) {
    const sourceArtifacts = [];
    for (const value of Array.isArray(inputs.source_artifacts) ? inputs.source_artifacts : []) {
      if (typeof value !== 'string' || !value.startsWith('artifact:')) {
        sourceArtifacts.push(structuredClone(value));
        continue;
      }
      const inspected = await this.taskStore.inspectArtifact(value);
      sourceArtifacts.push({
        provenance_verified: true,
        handle: value,
        artifact_kind: lineageArtifactKind(inspected),
        content_sha256: inspected.content_sha256,
        source_task_id: inspected.task_id,
        label: inspected.record.label,
        media_type: inspected.record.media_type
      });
    }
    return { lineage: structuredClone(inputs.lineage || {}), sourceArtifacts };
  }

  async registerArtifacts(taskId, artifacts = {}) {
    const handles = [];
    for (const [label, filePath] of Object.entries(artifacts || {})) {
      if (typeof filePath !== 'string') continue;
      try {
        handles.push(await this.taskStore.registerArtifact(taskId, { filePath, label, kind: artifactKind(filePath), mediaType: mediaType(filePath) }));
      } catch (error) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ARTIFACT_NOT_FOUND') throw error;
      }
    }
    return handles;
  }

  async registerVisualArtifacts(taskId, artifacts = {}, directoryName = 'visual') {
    const directory = path.join(this.taskStore.rootDir, 'task-artifacts', taskId, directoryName);
    await fs.mkdir(directory, { recursive: true });
    const handles = [];
    for (const [label, artifact] of Object.entries(artifacts || {})) {
      if (!artifact?.handle || !String(artifact.media_type || '').startsWith('image/')) continue;
      const buffer = await this.imageArtifactStore.readBuffer(artifact.handle);
      const filePath = path.join(directory, `${safeArtifactLabel(label)}.png`);
      await atomicWriteBuffer(filePath, buffer);
      handles.push(await this.taskStore.registerArtifact(taskId, {
        filePath,
        label,
        kind: 'image',
        mediaType: artifact.media_type
      }));
    }
    return handles;
  }

  async mutationRecoveryEnvelope(task, error, receipt = null) {
    const stableError = ['MUTATION_RECEIPT_INVALID', 'MUTATION_EXECUTION_FAILED'].includes(error?.code)
      ? error
      : new AgentContractError(
          'MUTATION_RECOVERY_REQUIRED',
          'The model commit is durably recorded, but server-only post-commit finalization did not finish. Resume this task; the mutation itself will not be replayed.',
          {
            details: {
              task_id: task.task_id,
              task_state: task.state,
              ...(receipt?.receipt_id ? { receipt_id: receipt.receipt_id } : {})
            }
          }
        );
    const normalized = normalizeAgentError(stableError);
    const nextAction = {
      ...(normalized.next_action || { action: 'resume_task_finalization' }),
      task_id: task.task_id
    };
    const updated = await this.taskStore.update(task.task_id, {
      last_error: normalized,
      next_action: nextAction
    });
    return createResultEnvelope({
      task: await this.taskStore.getTask(updated.task_id),
      ok: false,
      error: normalized,
      data: null,
      nextAction
    });
  }

  async handleTaskError(task, error) {
    let current = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    if (current.intent === 'reopen_delivered_model') {
      current = await reopenDeliveredModelError(this, current, error);
      return createResultEnvelope({ task: await this.taskStore.getTask(current.task_id), ok: false, error: current.last_error, data: responseData(current) });
    }
    if (current.intent === 'apply_native_appearance' && current.private?.appearance_execution) {
      const normalized = normalizeAgentError(error);
      current = await this.taskStore.update(current.task_id, { last_error: normalized,
        next_action: { action: 'resume_agent_task', tool: 'resume_agent_task', arguments: { task_id: current.task_id }, reason: 'inspect_same_task_receipt_without_replaying_native_actions' } });
      return createResultEnvelope({ task: await this.taskStore.getTask(current.task_id), ok: false, error: normalized, data: responseData(current) });
    }
    if (current.intent === 'apply_native_appearance' && error.code === 'MODEL_REVISION_INCOMPLETE') {
      error = new AgentContractError(error.code, error.message, { details: error.details,
        nextAction: { action: 'inspect_native_connection', ...discoverCall({ topic: 'connect', runtime: 'queue' }),
          reason: 'Read current native revision completeness. After the runtime is complete, submit the original appearance task with its fresh connection_task_id; action labels are not input fields.' } });
    }
    if (current.intent === 'deliver_model' && ['understanding', 'awaiting_input'].includes(current.state)) {
      const claimed = await fs.lstat(path.join(this.taskStore.rootDir, 'model-deliveries-v1', current.task_id)).then(() => true).catch(cause => { if (cause.code === 'ENOENT') return false; throw cause; });
      if (claimed) {
        const normalized = normalizeAgentError(new AgentContractError('MUTATION_RECOVERY_REQUIRED', 'The delivery save was claimed. Resume to verify any completed receipt; do not create another delivery or repeat the save.', { details: { original_code: error.code || 'INTERNAL_ERROR' } }));
        const next_action = { action: 'resume_agent_task', tool: 'resume_agent_task', arguments: { task_id: current.task_id } };
        current = current.state === 'awaiting_input' ? await this.taskStore.update(current.task_id, { last_error: normalized, next_action }) : await this.taskStore.transition(current.task_id, 'awaiting_input', { reason: 'delivery_receipt_finalization_required', patch: { last_error: normalized, next_action } });
        return createResultEnvelope({ task: await this.taskStore.getTask(current.task_id), ok: false, error: normalized, data: responseData(current) });
      }
    }
    if (current.intent === 'create_model' && ['executing', 'verifying'].includes(current.state) && current.private?.creation?.round?.snapshot) {
      const normalized = normalizeAgentError(error);
      current = await this.taskStore.update(current.task_id, { last_error: normalized, next_action: { action: 'resume_agent_task', task_id: current.task_id, reason: 'committed_creation_requires_quality_finalization' } });
      return createResultEnvelope({ task: await this.taskStore.getTask(current.task_id), ok: false, error: normalized, data: responseData(current) });
    }
    if (isRecoverablePreExecutionError(current, error)) {
      const normalized = normalizeAgentError(error);
      const targetState = recoveryStateFor(current, normalized.code);
      const nextAction = {
        ...(normalized.next_action || { action: 'submit_task_input' }),
        then_tool: 'submit_agent_task_input',
        task_id: current.task_id
      };
      const patch = { last_error: normalized, next_action: nextAction };
      current = current.state === targetState
        ? await this.taskStore.update(current.task_id, patch)
        : await this.taskStore.transition(current.task_id, targetState, {
            reason: `recoverable_${normalized.code.toLowerCase()}`,
            patch
          });
      return createResultEnvelope({
        task: await this.taskStore.getTask(current.task_id),
        ok: false,
        error: normalized,
        data: null
      });
    }
    return this.failTask(current, error);
  }

  async failTask(task, error) {
    let current = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    const original = normalizeAgentError(error);
    const normalized = mutationMayHaveStarted(current) && original.code === 'INTERNAL_ERROR'
      ? normalizeAgentError(new AgentContractError(
          'MUTATION_EXECUTION_FAILED',
          'Execution failed after model mutation may have started. Inspect the active model and failure evidence before starting a new task.'
        ))
      : original;
    if (!['completed', 'failed', 'cancelled', 'expired'].includes(current.state)) {
      try {
        current = await this.taskStore.transition(current.task_id, 'failed', {
          reason: normalized.code || 'gateway_error',
          patch: { last_error: normalized, next_action: normalized.next_action || null }
        });
      } catch {
        current = await this.taskStore.getTask(task.task_id, { includePrivate: true });
      }
    }
    return createResultEnvelope({ task: await this.taskStore.getTask(task.task_id), ok: false, error: normalized, data: null });
  }
}

const RECOVERABLE_PRE_EXECUTION_STATES = new Set(['understanding', 'awaiting_input', 'awaiting_review', 'approved']);
const MUTATION_STARTED_STATES = new Set(['executing']);
const REVIEW_REPLAN_ERROR_CODES = new Set([
  'PLAN_HASH_MISMATCH',
  'MODEL_REVISION_MISMATCH',
  'OPERATION_NOT_ALLOWED',
  'HANDSHAKE_DOCUMENT_MISMATCH',
  'HANDSHAKE_MODEL_IDENTITY_MISMATCH',
  'HANDSHAKE_MODEL_REVISION_MISMATCH',
  'HANDSHAKE_SERVER_VERSION_MISMATCH',
  'HANDSHAKE_PLUGIN_VERSION_MISMATCH',
  'HANDSHAKE_CAPABILITIES_MISMATCH'
]);

function isRecoverablePreExecutionError(task, error) {
  if (!RECOVERABLE_PRE_EXECUTION_STATES.has(task.state)) return false;
  const code = String(error?.code || '');
  if (task.intent === 'apply_native_appearance' && (code === 'INVALID_ARGUMENT' || code === 'CAPABILITY_UNSUPPORTED' || code.startsWith('APPROVAL_'))) return true;
  if (task.intent === 'deliver_model' && code === 'OPERATION_NOT_ALLOWED') return true;
  if (task.intent === 'verify_model' && code === 'INVALID_ARGUMENT') return true;
  if ((['discover', 'preflight_model', 'deliver_model'].includes(task.intent) || task.inputs?.task) && code === 'INVALID_ARGUMENT') return true;
  if (task.intent === 'create_model' && task.private?.creation && code === 'INVALID_ARGUMENT') return true;
  if (task.state === 'awaiting_review'
    && ['reviewed_existing_model_edit', 'reconcile_design_intent'].includes(task.intent)
    && (code.startsWith('APPROVAL_')
      || (task.intent === 'reconcile_design_intent' && code === 'INVALID_ARGUMENT')
      || (task.private?.design_post_apply_reconciliation && code === 'INVALID_ARGUMENT'))) return true;
  return code === 'POLICY_DENIED'
    || code === 'PLAN_HASH_MISMATCH'
    || code === 'MODEL_IDENTITY_MISMATCH'
    || code === 'MODEL_REVISION_MISMATCH'
    || code === 'MODEL_REVISION_INCOMPLETE'
    || code === 'MODEL_IDENTITY_UNAVAILABLE'
    || code === 'OPERATION_NOT_ALLOWED'
    || code.startsWith('HANDSHAKE_')
    || code.startsWith('QUEUE_');
}

function recoveryStateFor(task, code) {
  if (task.intent === 'apply_native_appearance' && task.private?.appearance_plan) return 'awaiting_review';
  if (task.private?.design_post_apply_reconciliation
    && task.state === 'awaiting_review'
    && (code.startsWith('APPROVAL_') || code === 'INVALID_ARGUMENT')) return 'awaiting_review';
  if (task.intent === 'reconcile_design_intent'
    && task.state === 'awaiting_review'
    && (code.startsWith('APPROVAL_') || code === 'INVALID_ARGUMENT')) return 'awaiting_review';
  if (task.intent === 'reviewed_existing_model_edit' && task.state === 'approved') return 'awaiting_input';
  if (task.intent !== 'reviewed_existing_model_edit' || task.state !== 'awaiting_review') return 'awaiting_input';
  return REVIEW_REPLAN_ERROR_CODES.has(code) ? 'awaiting_input' : 'awaiting_review';
}

function mutationMayHaveStarted(task) {
  if (MUTATION_STARTED_STATES.has(task.state)) return true;
  if (task.state !== 'verifying') return false;
  return task.intent !== 'verify_model' || Boolean(task.inputs?.code);
}

function assertRuntimePolicy(runtime, policy, intent) {
  if (!policy.allowed_runtimes.includes(runtime)) {
    throw new AgentContractError('POLICY_DENIED', `Runtime ${runtime} is not allowed by the server execution policy.`, {
      details: { intent, allowed_runtimes: policy.allowed_runtimes }
    });
  }
}

function boundedRecursiveLimit(value, policy, fallback) {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AgentContractError('INVALID_ARGUMENT', 'recursive_limit must be a positive integer.');
  }
  const maximum = Number(policy.resource_limits?.max_recursive_entities || 10_000);
  if (parsed > maximum) {
    throw new AgentContractError('POLICY_DENIED', 'recursive_limit exceeds the trusted server execution-policy limit.', {
      details: { requested: parsed, maximum }
    });
  }
  return parsed;
}

function boundedStructuralGroupLimit(value, fallback) {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 5000) {
    throw new AgentContractError('INVALID_ARGUMENT', 'structural_group_limit must be an integer from 1 to 5000.');
  }
  return parsed;
}

function boundedQueueTimeoutMs(value, fallback) {
  const parsed = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 5_000 || parsed > 900_000) {
    throw new AgentContractError('INVALID_ARGUMENT', 'timeout_ms must be an integer from 5000 to 900000.');
  }
  return parsed;
}

function sourcePromotionIdempotencyKey(intent, inputs = {}) {
  if (intent !== 'reviewed_existing_model_edit') return null;
  if (inputs?.source_visual_correction) {
    if (typeof inputs.source_visual_correction !== 'string'
      || !/^source_visual_correction:task_[0-9a-f-]+$/i.test(inputs.source_visual_correction)
      || inputs.operations !== undefined
      || inputs.targets !== undefined
      || inputs.source_proposal !== undefined
      || inputs.source_design_change !== undefined) return null;
    return `server-visual-correction-promotion:${sha256Canonical({
      source_visual_correction: inputs.source_visual_correction,
      runtime: inputs.runtime || 'mock'
    }).slice(7)}`;
  }
  if (inputs?.source_design_change) {
    const source = inputs.source_design_change;
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || typeof source.task_id !== 'string'
      || canonicalJson(Object.keys(source).sort()) !== canonicalJson(['task_id'])
      || inputs.operations !== undefined
      || inputs.targets !== undefined
      || inputs.model_key !== undefined
      || inputs.design_graph_id !== undefined
      || inputs.change_plan_id !== undefined) return null;
    return `server-design-change-promotion:${sha256Canonical({
      source_design_change: inputs.source_design_change,
      runtime: inputs.runtime || 'mock'
    }).slice(7)}`;
  }
  if (!inputs?.source_proposal) return null;
  // Client-supplied operations/targets make this an invalid source-bound request.
  // Keep such attempts out of the server-owned one-time promotion claim so they
  // cannot poison the valid proposal's canonical idempotency key.
  if (inputs.operations !== undefined || inputs.targets !== undefined) return null;
  return `server-source-proposal-promotion:${sha256Canonical({
    source_proposal: inputs.source_proposal,
    runtime: inputs.runtime || 'mock'
  }).slice(7)}`;
}

function taskSummary(task) {
  return {
    intent: task.intent,
    interface_level: task.interface_level,
    instruction: markUntrustedData(task.instruction, 'agent_instruction'),
    state: task.state,
    updated_at: task.updated_at
  };
}

function responseData(task) {
  return task.result || taskSummary(task);
}

function graphStoreSummary(persisted) {
  return {
    version: 'model-graph-store.v1',
    model_key: persisted.model_key,
    version_sequence: persisted.version_sequence,
    version_count: persisted.version_count,
    current: persisted.current,
    reused: persisted.reused,
    identity_stability: persisted.manifest.identity.stability,
    sensitive_values_persisted: false,
    delta_from_previous: persisted.version.delta_from_previous
  };
}

function designIntentBinding(persisted) {
  return {
    model_key: persisted.model_key,
    design_graph_id: persisted.design_graph_id,
    source_model_graph_id: persisted.source_model_graph_id,
    model_revision: persisted.model_revision,
    version_sequence: persisted.version_sequence
  };
}

function assertDesignIntentBinding(binding) {
  if (!binding
    || !/^model_[0-9a-f]{32}$/.test(String(binding.model_key || ''))
    || !/^design-graph-[0-9a-f]{24}$/.test(String(binding.design_graph_id || ''))
    || !/^model-graph-[0-9a-f]{24}$/.test(String(binding.source_model_graph_id || ''))
    || !/^sha256:[0-9a-f]{64}$/.test(String(binding.model_revision || ''))
    || !Number.isInteger(binding.version_sequence)
    || binding.version_sequence < 1) {
    throw new AgentContractError('MODEL_GRAPH_INTEGRITY_ERROR', 'A server DesignIntent task binding is invalid.');
  }
}

function designChangeBinding(taskId, persistedDesign, changePlan) {
  return {
    task_id: taskId,
    change_plan_id: changePlan.change_plan_id,
    change_plan_hash: designChangePlanHash(changePlan),
    model_key: persistedDesign.model_key,
    design_graph_id: persistedDesign.design_graph_id,
    model_revision: changePlan.model_revision
  };
}

function designChangePlanHash(changePlan) {
  const core = structuredClone(changePlan);
  delete core.next_action;
  return sha256Canonical(core);
}

function bindDesignChangeNextAction(changePlan, binding, { runtime, saveModel, captureView } = {}) {
  changePlan.next_action = {
    action: 'start_reviewed_existing_model_edit',
    tool: 'start_agent_task',
    arguments: {
      intent: 'reviewed_existing_model_edit',
      instruction: untrustedInstructionValue(changePlan.instruction),
      interface_level: 'guided',
      inputs: {
        runtime,
        source_design_change: { task_id: binding.task_id },
        save_model: saveModel,
        ...(captureView ? { capture_view: true } : {})
      }
    }
  };
}

function untrustedInstructionValue(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'value')) return String(value.value || 'Apply reviewed DesignIntent change.');
  return 'Apply reviewed DesignIntent change.';
}

function designReconciliationHash(reconciliation) {
  return sha256Canonical(reconciliation);
}

function deterministicCorrectionEventId(taskId, reconciliation, decision) {
  return `correction-${sha256Canonical({ task_id: taskId, reconciliation_id: reconciliation.reconciliation_id, decision }).slice(7, 31)}`;
}

function designStoreSummary(persisted, artifacts = []) {
  return {
    version: 'design-intent-store.v1',
    model_key: persisted.model_key,
    design_graph_id: persisted.design_graph_id,
    source_model_graph_id: persisted.source_model_graph_id,
    model_revision: persisted.model_revision,
    version_sequence: persisted.version_sequence,
    version_count: persisted.version_count,
    current: persisted.current,
    reused: persisted.reused,
    reconciliation_count: persisted.manifest.reconciliation_count,
    reconciliation: persisted.reconciliation ? {
      reconciliation_id: persisted.reconciliation.reconciliation_id,
      sequence: persisted.reconciliation.sequence,
      reused: persisted.reconciliation.reused
    } : null,
    artifact_handles: Object.fromEntries(artifacts.map((artifact) => [artifact.label, artifact.handle])),
    raw_external_paths_persisted: false,
    sensitive_identity_persisted: false
  };
}

function reviewedEditResult(applied) {
  return {
    kind: 'reviewed_existing_model_edit_result',
    ok: true,
    plan_id: applied.plan_id,
    risk_level: applied.risk_level,
    authorization: applied.authorization,
    geometry_edits: applied.iteration?.geometry_edits || [],
    qa: applied.iteration?.qa || null
  };
}

function lineageArtifactKind(inspected) {
  if (inspected.record.media_type !== 'application/json' || !inspected.json) return 'binary';
  const document = inspected.json;
  const artifact = String(document.artifact || '').toLowerCase();
  const kind = String(document.kind || '').toLowerCase();
  if (artifact === 'parametricrecipe') return 'parametric_recipe';
  if (artifact === 'featuremappingplan') return 'feature_mapping_plan';
  if (kind === 'design_intent_graph' || document.version === 'design-intent-graph.v1') return 'design_intent_graph';
  if (kind.includes('evidence') || document.vision_evidence_set_v1) return 'evidence';
  if (Array.isArray(document.parts) && (document.id || document.profile_id)) return 'part_graph';
  return 'generic_json';
}

function artifactKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.skp') return 'model_binary';
  return extension === '.json' ? 'json' : extension === '.svg' ? 'image' : extension === '.html' ? 'review' : 'text';
}

function mediaType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') return 'application/json';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.html') return 'text/html';
  if (extension === '.skp') return 'application/octet-stream';
  return 'text/plain';
}

function serverPolicySubmissionNextAction({ runtime, autoApprovalMode, plan }) {
  if (autoApprovalMode === 'copy_fast_session') {
    return {
      action: 'execute_copy_edit',
      then_tool: 'submit_agent_task_input',
      approval_status: 'copy_fast_active',
      authorization_mode: autoApprovalMode,
      user_action_required: false,
      copy_fast_session_id: plan?.copy_fast_session?.session_id,
      required: runtime === 'queue' ? ['session_contract'] : []
    };
  }
  return {
    action: 'submit_task_input',
    then_tool: 'submit_agent_task_input',
    approval_status: 'server_policy_auto_approved',
    authorization_mode: autoApprovalMode,
    required: runtime === 'queue' ? ['session_contract'] : []
  };
}

function reviewedTaskAuthorizationBinding(task, executionPolicy) {
  if (task?.intent !== 'reviewed_existing_model_edit'
    || !['awaiting_review', 'approved'].includes(task?.state)) {
    throw new AgentContractError('TASK_STATE_CONFLICT', 'The task is not ready to authorize or execute an existing-model edit.');
  }
  const plan = task.private?.existing_edit_plan;
  if (!plan
    || plan.kind !== 'existing_model_edit_plan'
    || plan.version !== EXISTING_MODEL_EDIT_PLAN_VERSION
    || plan.compile_permission !== 'ready_for_review') {
    throw new AgentContractError('PLAN_HASH_MISMATCH', 'The task has no intact server-private reviewed edit plan.');
  }
  if (plan.task_id !== task.task_id
    || plan.plan_hash !== existingModelEditPlanHash(plan)
    || (task.inputs?.runtime || 'mock') !== plan.runtime
    || !Array.isArray(plan.dsl_document?.operations)
    || plan.dsl_document.operations.length === 0
    || !Array.isArray(plan.blockers)
    || plan.blockers.length !== 0) {
    throw new AgentContractError('PLAN_HASH_MISMATCH', 'The server-private reviewed edit plan binding is invalid.');
  }
  const result = task.result;
  const challenge = result?.approval_challenge;
  const autoApprovalMode = serverPolicyAutoApprovalMode(plan, executionPolicy);
  if (result?.kind !== 'reviewed_existing_model_edit_proposal'
    || result.plan_id !== plan.plan_id
    || result.plan_hash !== plan.plan_hash
    || result.model_revision !== plan.model_revision
    || result.risk_level !== plan.risk_level
    || result.operation_count !== plan.dsl_document.operations.length) {
    throw new AgentContractError('APPROVAL_INVALID', 'The public task proposal no longer matches its server-private reviewed plan.');
  }
  const reviewContext = existingModelEditApprovalReviewContext(plan);
  const reviewContextHash = sha256Canonical(reviewContext);
  const allowedOperations = [...new Set(plan.dsl_document.operations.map((operation) => String(operation?.op || '')))]
    .filter(Boolean)
    .sort();
  if (autoApprovalMode === 'copy_fast_session') {
    const expectedSummary = publicCopyFastSessionSummary(plan.copy_fast_session);
    const summary = result.copy_fast_session;
    if (challenge !== null
      || result.execution_mode !== 'copy_fast'
      || result.user_action_required !== false
      || !summary
      || summary.version !== expectedSummary.version
      || summary.status !== expectedSummary.status
      || summary.session_id !== expectedSummary.session_id
      || summary.model_key !== expectedSummary.model_key
      || summary.runtime !== expectedSummary.runtime
      || summary.issued_at !== expectedSummary.issued_at
      || summary.expires_at !== expectedSummary.expires_at
      || typeof summary.reused !== 'boolean'
      || summary.user_action_required !== false
      || summary.agent_can_enable !== false
      || summary.local_paths_exposed !== false) {
      throw new AgentContractError('APPROVAL_INVALID', 'The public Copy Fast summary no longer matches its server-private session binding.');
    }
    return {
      plan,
      challenge: null,
      reviewContextHash,
      allowedOperations,
      expectedAuthorization: null,
      copyFastSession: expectedSummary
    };
  }
  if (!challenge) {
    throw new AgentContractError('APPROVAL_INVALID', 'The reviewed edit no longer has its server-persisted approval challenge.');
  }
  if (challenge.kind !== 'approval_challenge'
    || challenge.status !== 'awaiting_trusted_user'
    || challenge.task_id !== task.task_id
    || challenge.plan_id !== plan.plan_id
    || challenge.plan_hash !== plan.plan_hash
    || challenge.model_revision !== plan.model_revision
    || challenge.risk_level !== plan.risk_level
    || challenge.review_context_hash !== reviewContextHash
    || sha256Canonical(challenge.review_context ?? null) !== reviewContextHash
    || canonicalJson(challenge.allowed_operations) !== canonicalJson(allowedOperations)) {
    throw new AgentContractError('APPROVAL_INVALID', 'The approval challenge no longer matches the complete server-private reviewed plan.');
  }
  return {
    plan,
    challenge,
    reviewContextHash,
    allowedOperations,
    expectedAuthorization: {
      challenge_id: challenge.challenge_id,
      task_id: task.task_id,
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      model_revision: plan.model_revision,
      risk_level: plan.risk_level,
      allowed_operations: allowedOperations,
      review_context_hash: reviewContextHash
    },
    copyFastSession: null
  };
}

function assertNoPublicApprovalToken(value) {
  const seen = new WeakSet();
  const visit = (current) => {
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (String(key).replace(/[-_\s]/g, '').toLowerCase() === 'approvaltoken') {
        throw new AgentContractError(
          'APPROVAL_TOKEN_FORBIDDEN',
          'Agent task inputs cannot carry approval credentials; complete the local approval decision and resume the task without a credential field.'
        );
      }
      visit(child);
    }
  };
  visit(value);
}

function assertNoLegacyVisualInputs(inputs = {}) {
  const forbidden = [
    'reference_image_path',
    'referenceImagePath',
    'capture_image_path',
    'captureImagePath',
    'recapture_image_path',
    'recaptureImagePath',
    'previous_evidence',
    'capture_provenance',
    'captureProvenance',
    'recapture_provenance',
    'recaptureProvenance',
    'source_lineage',
    'sourceLineage',
    'apply_receipt',
    'applyReceipt',
    'model_key',
    'modelKey',
    'graph_id',
    'graphId',
    'model_revision',
    'modelRevision',
    'background_normalized_comparison',
    'backgroundNormalizedComparison',
    'structured_visual_summary',
    'structuredVisualSummary',
    'visual_similarity_accepted',
    'visualSimilarityAccepted',
    'execution_allowed',
    'executionAllowed',
    'review_required',
    'reviewRequired'
  ].filter((field) => inputs[field] !== undefined);
  if (forbidden.length) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Visual Agent inputs must use immutable handles; model, capture, receipt, lineage, structured comparison, and policy decisions are server-owned.', {
      details: { forbidden_fields: forbidden.sort() }
    });
  }
}

function assertNoAgentLiveCaptureInputs(inputs = {}, { phase } = {}) {
  const forbidden = [
    'capture_image_handle', 'captureImageHandle',
    'recapture_image_handle', 'recaptureImageHandle',
    'capture_path', 'capturePath',
    'recapture_path', 'recapturePath',
    'path', 'output_path', 'outputPath',
    'server_visual_capture', 'serverVisualCapture',
    'view', 'scene', 'camera',
    'zoom_extents', 'zoomExtents',
    'width', 'height', 'antialias', 'compression',
    ...(phase === 'after' ? ['reference_image_handle', 'referenceImageHandle'] : [])
  ].filter((field) => inputs[field] !== undefined);
  if (forbidden.length) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Live visual capture bytes, path, camera, and provenance are server-owned.', {
      details: { forbidden_fields: forbidden.sort(), capture_phase: phase || null }
    });
  }
}

function serverVisualCaptureProvenance({ taskId, binding, runtime, handle, phase }) {
  if (runtime !== 'mock') {
    throw new AgentContractError('POLICY_DENIED', 'Live visual correction requires a future server-side capture_view receipt; an Agent-supplied image cannot impersonate SketchUp capture provenance.');
  }
  return {
    version: VISUAL_CAPTURE_PROVENANCE_VERSION,
    kind: 'trusted_test_capture',
    capture_id: `visual-capture-${sha256Canonical({ task_id: taskId, handle, phase }).slice(7, 31)}`,
    provider: 'test_fixture',
    runtime: 'mock',
    source_task_id: taskId,
    model_key: binding.model_key,
    graph_id: binding.graph_id,
    model_revision: binding.model_revision,
    captured_at: new Date().toISOString()
  };
}

function boundedArtifactReadInteger(value, field, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AgentContractError('INVALID_ARGUMENT', `artifact ${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function artifactPageLimit(value, responseLimit) {
  const requested = boundedArtifactReadInteger(value ?? 12000, 'max_chars', 256, 100000);
  const boundedResponseLimit = Number.isInteger(responseLimit) ? responseLimit : 4096;
  // The presenter fits the full serialized envelope, including the data alias,
  // escaped content and metadata, and recomputes next_offset without skipping.
  // Reading half the budget lets that exact fitter use the available space;
  // a fixed one-eighth cap needlessly forced 512-character guided pages.
  return Math.min(requested, Math.max(256, Math.floor(boundedResponseLimit / 2)));
}

function taskIdFromArtifactHandle(handle) {
  const match = /^artifact:(task_[0-9a-f-]+):[0-9a-f-]+$/i.exec(String(handle || ''));
  if (!match) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact handle is invalid.');
  return match[1];
}

function taskHasBoundImageHandle(task, expected) {
  return Array.isArray(task?.private?.bound_image_handles)
    && task.private.bound_image_handles.includes(expected);
}

function mergeBoundImageHandles(existing, ...values) {
  const handles = new Set();
  collectImageHandles(existing, handles);
  collectImageHandles(values, handles);
  return [...handles].sort();
}

function collectImageHandles(value, handles) {
  if (typeof value === 'string') {
    if (/^image-artifact:sha256:[0-9a-f]{64}$/i.test(value)) handles.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageHandles(item, handles);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const item of Object.values(value)) collectImageHandles(item, handles);
}

function omittedImageArtifact(record = {}) {
  return {
    ...record,
    encoding: 'omitted',
    content_omitted_for_capability: true,
    offset: 0,
    next_offset: null,
    total_chars: 0,
    eof: true,
    truncated: false,
    next_action: null
  };
}

function safeArtifactLabel(value) {
  return String(value || 'visual-artifact').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'visual-artifact';
}

function visualAllowedRoots(stateRoot) {
  const configured = String(process.env.ALMA_SKETCHUP_VISUAL_ALLOWED_ROOTS || '')
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([projectRoot, stateRoot, ...configured].map((value) => path.resolve(value)))];
}

async function atomicWriteBuffer(filePath, buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, buffer, { mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}
