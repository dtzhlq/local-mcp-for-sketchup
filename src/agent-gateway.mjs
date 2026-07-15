import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AgentContractError,
  createResultEnvelope,
  markUntrustedData,
  normalizeClientCapabilities,
  publicExecutionPolicy
} from './agent-contract.mjs';
import { buildModelGraph, writeModelGraph } from './model-graph.mjs';
import { proposeExistingModelEdit } from './existing-model-edit-proposer.mjs';
import {
  buildDesignIntentGraph,
  planDesignParameterChange,
  reconcileDesignIntentGraph,
  writeDesignArtifact
} from './design-intent-graph.mjs';
import { projectRoot } from './paths.mjs';
import { analyzeReferenceImageCorrection, verifyReferenceImageCorrection } from './visual-correction.mjs';

const SUPPORTED_INTENTS = new Set(['create_model', 'understand_model', 'propose_existing_model_edit', 'modify_design_parameters', 'reconcile_design_intent', 'reference_image_correction', 'visual_correction_qa', 'reviewed_existing_model_edit', 'image_artifact', 'verify_model']);

export class AgentGateway {
  constructor({ bridge, taskStore } = {}) {
    if (!bridge || !taskStore) throw new Error('AgentGateway requires bridge and taskStore');
    this.bridge = bridge;
    this.taskStore = taskStore;
  }

  async start({ intent, instruction, interface_level = 'guided', client_capabilities = {}, idempotency_key, inputs = {} } = {}) {
    if (!SUPPORTED_INTENTS.has(intent)) throw new AgentContractError('INVALID_ARGUMENT', 'intent is not supported by Agent Contract v1.');
    const capabilities = normalizeClientCapabilities(client_capabilities);
    const policy = publicExecutionPolicy(this.bridge.executionPolicy);
    const created = await this.taskStore.createTask({
      intent,
      interfaceLevel: interface_level,
      instruction,
      clientCapabilities: capabilities,
      executionPolicy: policy,
      inputs: structuredClone(inputs || {}),
      idempotencyKey: idempotency_key
    });
    if (created.replayed) {
      const publicTask = await this.taskStore.getTask(created.task.task_id);
      return createResultEnvelope({ task: publicTask, data: taskSummary(publicTask), idempotentReplay: true });
    }

    let task = await this.taskStore.transition(created.task.task_id, 'understanding', {
      reason: 'gateway_started',
      patch: { next_action: { action: 'continue_server_work' } }
    });
    try {
      task = await this.runIntent(task);
      return createResultEnvelope({
        task: await this.taskStore.getTask(task.task_id),
        data: responseData(task)
      });
    } catch (error) {
      return this.failTask(task, error);
    }
  }

  async resume({ task_id } = {}) {
    const task = await this.taskStore.getTask(task_id);
    return createResultEnvelope({ task, data: taskSummary(task) });
  }

  async submit({ task_id, idempotency_key, input = {} } = {}) {
    let task = await this.taskStore.getTask(task_id, { includePrivate: true });
    const claim = await this.taskStore.claimTaskOperation({
      taskId: task_id,
      operation: 'submit_agent_task_input',
      idempotencyKey: idempotency_key,
      input
    });
    if (claim.replayed) {
      const publicTask = await this.taskStore.getTask(task_id);
      return createResultEnvelope({ task: publicTask, data: taskSummary(publicTask), idempotentReplay: true });
    }

    try {
      if (task.state === 'awaiting_input') {
        task = await this.taskStore.update(task_id, { inputs: { ...task.inputs, ...structuredClone(input) } });
        task = await this.taskStore.transition(task_id, 'understanding', { reason: 'required_input_received' });
        task = await this.runIntent(task);
      } else if (task.state === 'awaiting_review' && task.intent === 'reviewed_existing_model_edit') {
        task = await this.executeReviewedExistingEdit(task, input);
      } else {
        throw new AgentContractError('TASK_STATE_CONFLICT', `Task input is not accepted while the task is ${task.state}.`, {
          details: { task_state: task.state }
        });
      }
      await this.taskStore.completeTaskOperation(claim, task_id);
      const publicTask = await this.taskStore.getTask(task_id);
      return createResultEnvelope({ task: publicTask, data: responseData(task) });
    } catch (error) {
      const current = await this.taskStore.getTask(task_id, { includePrivate: true });
      if (current.state === 'awaiting_review' && ['APPROVAL_REQUIRED', 'APPROVAL_INVALID', 'APPROVAL_EXPIRED', 'APPROVAL_REPLAYED'].includes(error?.code)) {
        return createResultEnvelope({ task: await this.taskStore.getTask(task_id), ok: false, error, data: null });
      }
      return this.failTask(task, error);
    }
  }

  async readArtifact({ handle, max_chars } = {}) {
    const artifact = await this.taskStore.readArtifact(handle, { maxChars: max_chars });
    const taskId = String(handle).split(':')[1];
    const task = await this.taskStore.getTask(taskId);
    return createResultEnvelope({ task, data: { artifact }, nextAction: artifact.next_action, artifacts: task.artifacts });
  }

  async runIntent(task) {
    assertRuntimePolicy(task.inputs?.runtime || 'mock', this.bridge.executionPolicy, task.intent);
    switch (task.intent) {
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
    const { operations, targets } = task.inputs;
    if (!Array.isArray(operations) || operations.length === 0 || !Array.isArray(targets) || targets.length === 0) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'edit_inputs_required',
        patch: { next_action: { action: 'submit_task_input', required: ['operations', 'targets'] } }
      });
    }
    const prepared = await this.bridge.prepare_existing_model_edit({
      runtime: task.inputs.runtime || 'mock',
      instruction: task.instruction,
      operations,
      targets,
      budgets: task.inputs.budgets,
      recursive_limit: task.inputs.recursive_limit,
      task_id: task.task_id,
      output_dir: path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'prepare')
    });
    const handles = await this.registerArtifacts(task.task_id, prepared.artifacts);
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, prepared.plan.compile_permission === 'ready_for_review' ? 'awaiting_review' : 'failed', {
      reason: prepared.plan.compile_permission === 'ready_for_review' ? 'trusted_review_required' : 'edit_plan_blocked',
      patch: {
        private: { ...refreshed.private, existing_edit_plan: prepared.plan },
        result: {
          kind: 'reviewed_existing_model_edit_proposal',
          plan_id: prepared.plan.plan_id,
          plan_hash: prepared.plan.plan_hash,
          model_revision: prepared.plan.model_revision,
          risk_level: prepared.plan.risk_level,
          operation_count: prepared.plan.dsl_document.operations.length,
          blockers: prepared.plan.blockers,
          approval_challenge: prepared.approval_challenge
        },
        next_action: prepared.plan.compile_permission === 'ready_for_review'
          ? { action: 'request_user_approval', challenge: prepared.approval_challenge, then_tool: 'submit_agent_task_input' }
          : { action: 'start_new_task', reason: 'plan_blocked' },
        artifacts: handles
      }
    });
  }

  async proposeExistingModelEdit(task) {
    const inputs = task.inputs;
    const runtime = inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({
      runtime,
      recursive: true,
      recursive_limit: inputs.recursive_limit || 5000
    });
    const graph = buildModelGraph(adoption, { lineage: inputs.lineage, sourceArtifacts: inputs.source_artifacts });
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'model-graph');
    const graphPath = await writeModelGraph(path.join(artifactDir, 'model-graph.v1.json'), graph);
    const proposal = proposeExistingModelEdit({
      graph,
      instruction: task.instruction,
      target_query: inputs.target_query,
      target_ref: inputs.target_ref,
      action: inputs.action,
      parameters: inputs.parameters,
      shared_policy: inputs.shared_policy,
      limit: inputs.candidate_limit
    });
    if (!proposal.requires_clarification) {
      proposal.next_action.arguments.inputs.runtime = runtime;
      proposal.next_action.arguments.inputs.save_model = inputs.save_model !== false;
      if (inputs.capture_view === true) proposal.next_action.arguments.inputs.capture_view = true;
    }
    const proposalPath = path.join(artifactDir, 'existing-model-edit-proposal.v1.json');
    await atomicWriteJson(proposalPath, proposal);
    await this.registerArtifacts(task.task_id, { model_graph: graphPath, edit_proposal: proposalPath });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, proposal.requires_clarification ? 'awaiting_input' : 'awaiting_review', {
      reason: proposal.requires_clarification ? 'proposal_ambiguity_requires_input' : 'proposal_ready_for_user_review',
      patch: {
        private: { ...refreshed.private, model_graph: graph, edit_proposal: proposal },
        result: {
          kind: 'propose_existing_model_edit_result',
          model_graph: { graph_id: graph.graph_id, model_revision: graph.model_revision, stats: graph.stats },
          proposal
        },
        artifacts: refreshed.artifacts,
        next_action: proposal.next_action
      }
    });
  }

  async executeReviewedExistingEdit(task, input) {
    const plan = task.private?.existing_edit_plan;
    if (!plan) throw new AgentContractError('TASK_STATE_CONFLICT', 'The task has no persisted edit plan.');
    if (!input.approval_token && !(plan.risk_level === 'S1' && this.bridge.executionPolicy.auto_approve_risks.includes('S1'))) {
      throw new AgentContractError('APPROVAL_REQUIRED', 'A trusted approval token must be supplied to resume this task.');
    }
    if (input.approval_token) {
      const token = await this.bridge.approvalAuthority.verifyToken(input.approval_token);
      if (token.task_id !== task.task_id || token.plan_id !== plan.plan_id || token.plan_hash !== plan.plan_hash || token.model_revision !== plan.model_revision || token.risk_level !== plan.risk_level) {
        throw new AgentContractError('APPROVAL_INVALID', 'The approval token is not bound to this task and plan.');
      }
    }
    task = await this.taskStore.transition(task.task_id, 'approved', {
      reason: 'trusted_approval_present',
      patch: { next_action: { action: 'continue_server_work' } }
    });
    task = await this.taskStore.transition(task.task_id, 'executing', { reason: 'reviewed_edit_execution_started' });
    const applied = await this.bridge.apply_reviewed_model_edit({
      runtime: task.inputs.runtime || 'mock',
      plan,
      approval_token: input.approval_token,
      review: input.note ? { plan_id: plan.plan_id, note: input.note } : null,
      output_dir: path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'apply'),
      save_model: task.inputs.save_model !== false,
      save_path: task.inputs.save_path,
      capture_view: task.inputs.capture_view === true
    });
    task = await this.taskStore.transition(task.task_id, 'verifying', { reason: 'reviewed_edit_applied' });
    await this.registerArtifacts(task.task_id, applied.artifacts);
    const allArtifacts = (await this.taskStore.getTask(task.task_id, { includePrivate: true })).artifacts;
    return this.taskStore.transition(task.task_id, 'completed', {
      reason: 'reviewed_edit_verified',
      patch: {
        result: {
          kind: 'reviewed_existing_model_edit_result',
          ok: true,
          plan_id: applied.plan_id,
          risk_level: applied.risk_level,
          authorization: applied.authorization,
          qa: applied.iteration?.qa || null
        },
        artifacts: allArtifacts,
        next_action: null
      }
    });
  }

  async modifyDesignParameters(task) {
    const inputs = task.inputs;
    if (!inputs.parametric_recipe || !inputs.entity_bindings || !inputs.changes) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'design_parameter_artifacts_required',
        patch: { next_action: { action: 'submit_task_input', required: ['parametric_recipe', 'entity_bindings', 'changes'] } }
      });
    }
    const runtime = inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({ runtime, recursive: true, recursive_limit: inputs.recursive_limit || 5000 });
    const modelGraph = buildModelGraph(adoption, { lineage: inputs.lineage, sourceArtifacts: inputs.source_artifacts });
    const designGraph = buildDesignIntentGraph({
      modelGraph,
      parametricRecipe: inputs.parametric_recipe,
      featureMappingPlan: inputs.feature_mapping_plan,
      partGraph: inputs.part_graph,
      entityBindings: inputs.entity_bindings,
      correctionHistory: inputs.correction_history
    });
    const changePlan = planDesignParameterChange({
      designGraph,
      currentModelGraph: modelGraph,
      changes: inputs.changes,
      instruction: task.instruction
    });
    if (!changePlan.blockers.length) {
      changePlan.next_action.arguments.inputs.runtime = runtime;
      changePlan.next_action.arguments.inputs.save_model = inputs.save_model !== false;
    }
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'design-intent');
    const graphPath = await writeModelGraph(path.join(artifactDir, 'model-graph.v1.json'), modelGraph);
    const designPath = await writeDesignArtifact(path.join(artifactDir, 'design-intent-graph.v1.json'), designGraph);
    const changePath = await writeDesignArtifact(path.join(artifactDir, 'design-parameter-change-plan.v1.json'), changePlan);
    await this.registerArtifacts(task.task_id, { model_graph: graphPath, design_intent_graph: designPath, design_parameter_change_plan: changePath });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, changePlan.blockers.length ? 'awaiting_input' : 'awaiting_review', {
      reason: changePlan.blockers.length ? 'design_divergence_blocks_change' : 'design_parameter_change_ready_for_review',
      patch: {
        private: { ...refreshed.private, model_graph: modelGraph, design_intent_graph: designGraph, design_parameter_change_plan: changePlan },
        result: { kind: 'modify_design_parameters_result', design_graph: { design_graph_id: designGraph.design_graph_id, stats: designGraph.stats }, change_plan: changePlan },
        artifacts: refreshed.artifacts,
        next_action: changePlan.next_action
      }
    });
  }

  async reconcileDesignIntent(task) {
    const inputs = task.inputs;
    if (!inputs.design_intent_graph) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'design_intent_graph_required',
        patch: { next_action: { action: 'submit_task_input', required: ['design_intent_graph'] } }
      });
    }
    const runtime = inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({ runtime, recursive: true, recursive_limit: inputs.recursive_limit || 5000 });
    const modelGraph = buildModelGraph(adoption, { lineage: inputs.lineage, sourceArtifacts: inputs.source_artifacts });
    const reconciliation = reconcileDesignIntentGraph({
      designGraph: inputs.design_intent_graph,
      currentModelGraph: modelGraph,
      acceptedChangePlan: inputs.accepted_change_plan
    });
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'design-reconciliation');
    const graphPath = await writeModelGraph(path.join(artifactDir, 'model-graph.v1.json'), modelGraph);
    const reconciliationPath = await writeDesignArtifact(path.join(artifactDir, 'design-intent-reconciliation.v1.json'), reconciliation);
    await this.registerArtifacts(task.task_id, { model_graph: graphPath, design_intent_reconciliation: reconciliationPath });
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, reconciliation.review_required ? 'awaiting_review' : 'completed', {
      reason: reconciliation.review_required ? 'design_reconciliation_review_required' : 'design_intent_aligned',
      patch: {
        private: { ...refreshed.private, model_graph: modelGraph, reconciliation },
        result: { kind: 'reconcile_design_intent_result', reconciliation },
        artifacts: refreshed.artifacts,
        next_action: reconciliation.next_action
      }
    });
  }

  async referenceImageCorrection(task) {
    const inputs = task.inputs;
    if (!inputs.reference_image_path || !inputs.capture_image_path) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'reference_and_capture_images_required',
        patch: {
          next_action: {
            action: 'submit_task_input',
            required: ['reference_image_path', 'capture_image_path'],
            capture_tool: 'capture_view',
            warning: 'capture_view with runtime queue reads the live SketchUp viewport; do not reset or modify the model without explicit user coordination.'
          }
        }
      });
    }
    const runtime = inputs.runtime || 'mock';
    const adoption = await this.bridge.adopt_open_model({ runtime, recursive: true, recursive_limit: inputs.recursive_limit || 5000 });
    const modelGraph = buildModelGraph(adoption, { lineage: inputs.lineage, sourceArtifacts: inputs.source_artifacts });
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'visual-correction');
    const analysis = await analyzeReferenceImageCorrection({
      referenceImagePath: inputs.reference_image_path,
      captureImagePath: inputs.capture_image_path,
      modelGraph,
      modelSnapshot: adoption.snapshot,
      referenceSpec: inputs.reference_spec,
      correctionTargets: inputs.correction_targets,
      correctionOperations: inputs.correction_operations,
      outputDir: artifactDir,
      allowedRoots: visualAllowedRoots(this.taskStore.rootDir)
    });
    await this.registerArtifacts(task.task_id, analysis.artifacts);
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    const blocked = analysis.correction_patch.blockers.length > 0;
    if (!blocked) analysis.correction_patch.next_action.arguments.inputs.runtime = runtime;
    return this.taskStore.transition(task.task_id, blocked ? 'awaiting_input' : 'awaiting_review', {
      reason: blocked ? 'visual_correction_inputs_blocked' : 'visual_correction_ready_for_review',
      patch: {
        private: { ...refreshed.private, visual_evidence: analysis.evidence, visual_correction_patch: analysis.correction_patch },
        result: {
          kind: 'reference_image_correction_result',
          evidence: analysis.evidence,
          correction_patch: analysis.correction_patch,
          visual_agent_required: false
        },
        artifacts: refreshed.artifacts,
        next_action: analysis.correction_patch.next_action
      }
    });
  }

  async visualCorrectionQa(task) {
    const inputs = task.inputs;
    if (!inputs.reference_image_path || !inputs.capture_image_path) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'reference_and_recapture_images_required',
        patch: { next_action: { action: 'submit_task_input', required: ['reference_image_path', 'capture_image_path'] } }
      });
    }
    const artifactDir = path.join(this.taskStore.rootDir, 'task-artifacts', task.task_id, 'visual-correction-qa');
    const verified = await verifyReferenceImageCorrection({
      referenceImagePath: inputs.reference_image_path,
      captureImagePath: inputs.capture_image_path,
      previousEvidence: inputs.previous_evidence,
      outputDir: artifactDir,
      allowedRoots: visualAllowedRoots(this.taskStore.rootDir)
    });
    await this.registerArtifacts(task.task_id, verified.artifacts);
    const refreshed = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    return this.taskStore.transition(task.task_id, verified.report.review_required ? 'awaiting_review' : 'completed', {
      reason: verified.report.review_required ? 'visual_residuals_require_review' : 'visual_correction_qa_passed',
      patch: {
        result: { kind: 'visual_correction_qa_result', report: verified.report, visual_agent_required: false },
        artifacts: refreshed.artifacts,
        next_action: verified.report.next_action
      }
    });
  }

  async verifyModel(task) {
    const inputs = task.inputs;
    if (!inputs.code && !inputs.snapshot) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'verification_input_required',
        patch: { next_action: { action: 'submit_task_input', required: ['code_or_snapshot'] } }
      });
    }
    let next = await this.taskStore.transition(task.task_id, 'verifying', { reason: 'verification_started' });
    const report = await this.bridge.validate_model({
      code: inputs.code,
      snapshot: inputs.snapshot,
      runtime: inputs.runtime || 'mock',
      spec: inputs.spec,
      includePreview: inputs.include_preview !== false
    });
    next = await this.taskStore.transition(task.task_id, 'completed', {
      reason: 'verification_completed',
      patch: { result: { kind: 'verify_model_result', report }, next_action: null }
    });
    return next;
  }

  async prepareImageArtifact(task) {
    const inputs = task.inputs;
    if (!inputs.input_dir && !inputs.asset_set_path) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'image_artifact_required',
        patch: { next_action: { action: 'submit_task_input', required: ['input_dir_or_asset_handle'] } }
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
    const inputs = task.inputs;
    if (!inputs.code) {
      return this.taskStore.transition(task.task_id, 'awaiting_input', {
        reason: 'safe_dsl_required',
        patch: { next_action: { action: 'submit_task_input', required: ['code'] } }
      });
    }
    if ((inputs.runtime || 'mock') === 'queue' && !this.bridge.executionPolicy.allow_queue_mutation) {
      throw new AgentContractError('POLICY_DENIED', 'The server execution policy does not allow Agent Gateway queue mutation.');
    }
    let next = await this.taskStore.transition(task.task_id, 'executing', { reason: 'safe_dsl_build_started' });
    const built = await this.bridge.build_model({ code: inputs.code, runtime: inputs.runtime || 'mock' });
    next = await this.taskStore.transition(task.task_id, 'verifying', { reason: 'safe_dsl_build_completed' });
    const qa = await this.bridge.validate_model({ snapshot: built.snapshot, runtime: inputs.runtime || 'mock', includePreview: inputs.include_preview !== false });
    return this.taskStore.transition(task.task_id, 'completed', {
      reason: 'created_model_verified',
      patch: { result: { kind: 'create_model_result', snapshot: built.snapshot, qa }, next_action: null }
    });
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

  async failTask(task, error) {
    let current = await this.taskStore.getTask(task.task_id, { includePrivate: true });
    if (!['completed', 'failed', 'cancelled', 'expired'].includes(current.state)) {
      try {
        current = await this.taskStore.transition(current.task_id, 'failed', {
          reason: error?.code || 'gateway_error',
          patch: { next_action: error?.next_action || null }
        });
      } catch {
        current = await this.taskStore.getTask(task.task_id, { includePrivate: true });
      }
    }
    return createResultEnvelope({ task: await this.taskStore.getTask(task.task_id), ok: false, error, data: null });
  }
}

function assertRuntimePolicy(runtime, policy, intent) {
  if (!policy.allowed_runtimes.includes(runtime)) {
    throw new AgentContractError('POLICY_DENIED', `Runtime ${runtime} is not allowed by the server execution policy.`, {
      details: { intent, allowed_runtimes: policy.allowed_runtimes }
    });
  }
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

function artifactKind(filePath) {
  const extension = path.extname(filePath).toLowerCase();
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
  return 'text/plain';
}

function visualAllowedRoots(stateRoot) {
  const configured = String(process.env.ALMA_SKETCHUP_VISUAL_ALLOWED_ROOTS || '')
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([projectRoot, stateRoot, ...configured].map((value) => path.resolve(value)))];
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}
