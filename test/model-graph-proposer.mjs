import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { planExistingModelEditDiscovery, proposeExistingModelEdit } from '../src/existing-model-edit-proposer.mjs';
import {
  existingModelEditExecutionTargetValidationPolicy,
  existingModelEditPlanHash,
  modelRevisionForAdoption
} from '../src/existing-model-editing.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';

const TEST_MODEL_KEY = `model_${'b'.repeat(32)}`;

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-model-graph-'));
const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(root, 'session.json') },
  agentContract: { rootDir: path.join(root, 'agent-state') },
  approval: { stateDir: path.join(root, 'approvals'), secret: 'model-graph-test-secret-that-is-at-least-32-bytes' },
  executionPolicy: { allowed_runtimes: ['mock'] }
});
const results = {};

try {
  const architecture = await graphFor(domainFixture('architecture'));
  const architectureBefore = architecture.model_revision;
  const architectureProposal = proposeExistingModelEdit({
    graph: architecture,
    model_key: TEST_MODEL_KEY,
    instruction: 'Set the largest wall to the reviewed concrete material.',
    target_query: 'largest wall',
    action: 'set_material',
    parameters: { material: 'Reviewed_Concrete' }
  });
  assert.equal(architectureProposal.requires_clarification, false, JSON.stringify({
    reasons: architectureProposal.ambiguity_reasons,
    confidence: architectureProposal.confidence,
    candidates: architectureProposal.candidates.map((candidate) => ({
      name: candidate.summary.value.name,
      bounding_box: candidate.summary.value.bounding_box,
      confidence: candidate.confidence,
      evidence: candidate.evidence
    }))
  }));
  assert.equal(architectureProposal.execution_allowed, false);
  assert.ok(architectureProposal.operation_proposal[0].target_id || /group:/.test(architectureProposal.operation_proposal[0].entity_path));
  assert.throws(
    () => proposeExistingModelEdit({
      graph: architecture,
      model_key: TEST_MODEL_KEY,
      instruction: 'Set the largest wall material.',
      target_query: 'largest wall',
      action: 'set_material',
      parameters: { material: 'Reviewed_Concrete', target_id: 'agent-selected-override' }
    }),
    (error) => error.code === 'INVALID_ARGUMENT'
  );
  assert.throws(
    () => proposeExistingModelEdit({
      graph: architecture,
      model_key: TEST_MODEL_KEY,
      instruction: 'Set the largest wall material.',
      target_query: 'largest wall',
      action: 'set_material',
      parameters: { material: 'Reviewed_Concrete' },
      shared_policy: 'agent-decides'
    }),
    (error) => error.code === 'INVALID_ARGUMENT'
  );
  results.architecture = { ready: true, confidence: architectureProposal.confidence };

  const gateway = await bridge.start_agent_task({
    intent: 'propose_existing_model_edit',
    instruction: 'Set the largest wall to the reviewed concrete material.',
    client_capabilities: { vision: false, local_files: false, structured_output: true, context: 'short', parallel: false },
    idempotency_key: 'model-graph-architecture-proposal',
    inputs: { runtime: 'mock', target_query: 'largest wall', action: 'set_material', parameters: { material: 'Reviewed_Concrete' }, save_model: false }
  });
  assert.equal(gateway.task_state, 'awaiting_review');
  const gatewayProjection = await expandedEnvelopeDocument(bridge, gateway);
  assert.equal(gatewayProjection.result.proposal.execution_allowed, false);
  assert.equal(gateway.next_action.tool, 'start_agent_task');
  assert.ok(gateway.artifacts.some((artifact) => artifact.label.startsWith('agent-response-projection-')));
  const graphArtifact = gatewayProjection.artifacts.find((artifact) => artifact.label === 'model_graph');
  assert.ok(graphArtifact);
  const graphText = await readArtifactText(bridge, graphArtifact.handle, gateway.task_id);
  assert.match(graphText, /model-graph\.v1/);

  assert.deepEqual(planExistingModelEditDiscovery({
    instruction: 'Rename the largest group.',
    target_query: 'largest group',
    action: 'rename'
  }), {
    mode: 'structural_groups',
    reason: 'bounded_group_scope_is_sufficient_for_target_discovery'
  });
  assert.equal(planExistingModelEditDiscovery({
    instruction: 'Rename the largest component.',
    target_query: 'largest component',
    action: 'rename'
  }).mode, 'full_recursive');
  assert.equal(planExistingModelEditDiscovery({
    instruction: 'Rename the largest group.',
    target_query: 'largest group',
    action: 'rename',
    discovery_mode: 'full_recursive'
  }).mode, 'full_recursive');
  assert.throws(
    () => planExistingModelEditDiscovery({ instruction: 'Rename a group.', discovery_mode: 'agent_decides' }),
    (error) => error.code === 'INVALID_ARGUMENT'
  );

  const adoptionCalls = [];
  const originalAdoptOpenModel = bridge.adopt_open_model.bind(bridge);
  bridge.adopt_open_model = async (options) => {
    adoptionCalls.push(structuredClone(options));
    return originalAdoptOpenModel(options);
  };
  let boundedGateway;
  try {
    boundedGateway = await bridge.start_agent_task({
      intent: 'propose_existing_model_edit',
      instruction: 'Rename the largest group to Reviewed_Largest_Group.',
      idempotency_key: 'model-graph-bounded-group-proposal',
      inputs: {
        runtime: 'mock',
        target_query: 'largest group',
        action: 'rename',
        parameters: { new_name: 'Reviewed_Largest_Group' },
        structural_group_limit: 5000,
        save_model: false
      }
    });
  } finally {
    bridge.adopt_open_model = originalAdoptOpenModel;
  }
  assert.equal(boundedGateway.task_state, 'awaiting_review');
  assert.deepEqual(adoptionCalls, [{
    runtime: 'mock',
    recursive: false,
    read_only: true,
    structural_groups: true,
    structural_group_limit: 5000
  }]);
  const boundedProjection = await expandedEnvelopeDocument(bridge, boundedGateway);
  assert.equal(boundedProjection.result.target_discovery.mode, 'structural_groups');
  assert.equal(boundedProjection.result.target_discovery.leaf_entities_materialized, false);
  assert.equal(boundedProjection.result.proposal.target_resolution.coverage.mode, 'complete_structural_group_projection');
  assert.equal(boundedProjection.result.proposal.target_resolution.coverage.sufficient_for_proposal, true);
  assert.equal(boundedProjection.result.model_graph.projections.structural_groups.leaf_entities_materialized, false);
  const boundedGraphArtifact = boundedProjection.artifacts.find((artifact) => artifact.label === 'model_graph');
  const boundedGraph = JSON.parse(await readArtifactText(bridge, boundedGraphArtifact.handle, boundedGateway.task_id));
  assert.equal(boundedGraph.completeness.complete, false);
  assert.equal(boundedGraph.projections.structural_groups.complete, true);
  assert.equal(boundedGraph.stats.faces, 0);
  assert.equal(boundedGraph.stats.edges, 0);

  const preparationCalls = [];
  bridge.adopt_open_model = async (options) => {
    preparationCalls.push(structuredClone(options));
    return originalAdoptOpenModel(options);
  };
  let boundedReviewed;
  try {
    boundedReviewed = await bridge.start_agent_task({
      ...boundedProjection.result.proposal.next_action.arguments,
      idempotency_key: 'model-graph-bounded-group-reviewed-prepare'
    });
  } finally {
    bridge.adopt_open_model = originalAdoptOpenModel;
  }
  assert.equal(boundedReviewed.task_state, 'awaiting_review');
  assert.equal(preparationCalls.length, 1);
  assert.equal(preparationCalls[0].recursive, false);
  assert.equal(preparationCalls[0].read_only, true);
  assert.equal(preparationCalls[0].structural_groups, true);
  assert.equal(preparationCalls[0].structural_group_limit, 5000);
  const boundedReviewedTask = await bridge.taskStore.getTask(boundedReviewed.task_id, { includePrivate: true });
  assert.equal(boundedReviewedTask.private.existing_edit_plan.target_validation.mode, 'structural_groups');
  assert.equal(boundedReviewedTask.private.existing_edit_plan.target_validation.exact_targets_verified, true);
  assert.equal(boundedReviewedTask.private.existing_edit_plan.target_validation.leaf_entities_materialized, false);
  assert.equal(boundedReviewedTask.private.existing_edit_plan.target_validation.sufficient_for_review, true);
  await validateTargetValidation(boundedReviewedTask.private.existing_edit_plan.target_validation);
  const boundedReviewedProjection = await expandedEnvelopeDocument(bridge, boundedReviewed);
  assert.equal(boundedReviewedProjection.result.target_validation.mode, 'structural_groups');
  assert.equal(boundedReviewedProjection.result.target_validation.leaf_entities_materialized, false);
  assert.equal(boundedReviewedProjection.result.approval_challenge.status, 'awaiting_trusted_user');
  assert.equal(boundedReviewedProjection.result.approval_challenge.review_context.execution_target_validation.mode, 'structural_groups');
  assert.equal(boundedReviewedProjection.result.approval_challenge.review_context.execution_target_validation.leaf_entities_materialized, false);
  const tamperedTargetValidationPlan = structuredClone(boundedReviewedTask.private.existing_edit_plan);
  tamperedTargetValidationPlan.target_validation.exact_targets_verified = false;
  assert.notEqual(
    existingModelEditPlanHash(tamperedTargetValidationPlan),
    tamperedTargetValidationPlan.plan_hash,
    'target_validation must be bound into the reviewed plan hash'
  );
  let tamperedApplyAdoptionCalls = 0;
  bridge.adopt_open_model = async (options) => {
    tamperedApplyAdoptionCalls += 1;
    return originalAdoptOpenModel(options);
  };
  try {
    await assert.rejects(
      bridge.apply_reviewed_model_edit({
        runtime: 'mock',
        plan: tamperedTargetValidationPlan,
        approval_token: 'must-not-be-consumed-for-target-validation-tamper',
        save_model: false
      }),
      (error) => error.code === 'PLAN_HASH_MISMATCH'
    );
  } finally {
    bridge.adopt_open_model = originalAdoptOpenModel;
  }
  assert.equal(tamperedApplyAdoptionCalls, 0, 'target-validation tamper must fail before model observation or mutation');
  const makeUniqueFallbackPlan = structuredClone(boundedReviewedTask.private.existing_edit_plan);
  makeUniqueFallbackPlan.targets[0].instance_policy = 'make_unique';
  makeUniqueFallbackPlan.targets[0].instance_id = 'fixture-instance';
  makeUniqueFallbackPlan.dsl_document.operations[0].instance_policy = 'make_unique';
  makeUniqueFallbackPlan.dsl_document.operations[0].instance_id = 'fixture-instance';
  assert.equal(existingModelEditExecutionTargetValidationPolicy(makeUniqueFallbackPlan).mode, 'full_recursive');
  await bridge.approvalAuthority.recordTrustedDecision(
    boundedReviewedProjection.result.approval_challenge,
    { decision: 'approved', user_id: 'bounded-group-human-fixture', channel: 'test-only-trusted-user-fixture', confirmed: true }
  );
  const executionCalls = [];
  const originalMockAdoptOpenModel = bridge.mockRuntime.adoptOpenModel.bind(bridge.mockRuntime);
  bridge.mockRuntime.adoptOpenModel = async (options) => {
    executionCalls.push(structuredClone(options));
    return originalMockAdoptOpenModel(options);
  };
  let boundedApplied;
  try {
    boundedApplied = await bridge.submit_agent_task_input({
      task_id: boundedReviewed.task_id,
      idempotency_key: 'model-graph-bounded-group-reviewed-apply',
      input: { note: 'Approved by the bounded Group execution fixture.' }
    });
  } finally {
    bridge.mockRuntime.adoptOpenModel = originalMockAdoptOpenModel;
  }
  const boundedAppliedTask = await bridge.taskStore.getTask(boundedReviewed.task_id, { includePrivate: true });
  assert.equal(boundedApplied.task_state, 'completed', JSON.stringify({ boundedApplied, last_error: boundedAppliedTask.last_error }, null, 2));
  assert.ok(executionCalls.length >= 5, JSON.stringify(executionCalls, null, 2));
  assert.equal(executionCalls.some((options) => options.recursive === true), false, 'eligible reviewed Group execution must not materialize the full recursive leaf index');
  assert.equal(executionCalls.every((options) => options.recursive === false && options.read_only === true && options.structural_groups === true), true);
  const boundedAppliedProjection = await expandedEnvelopeDocument(bridge, boundedApplied);
  assert.equal(boundedAppliedProjection.result.execution_target_validation.mode, 'structural_groups');
  assert.equal(boundedAppliedProjection.result.execution_target_validation.leaf_entities_materialized, false);
  assert.equal(boundedAppliedProjection.result.execution_target_validation.phases.gateway_pre_apply.exact_targets_verified, true);
  assert.equal(boundedAppliedProjection.result.execution_target_validation.phases.apply_preflight.exact_targets_verified, true);
  assert.equal(boundedAppliedProjection.result.execution_target_validation.phases.iteration_before.exact_targets_verified, true);
  assert.equal(boundedAppliedProjection.result.execution_target_validation.phases.iteration_after.exact_targets_verified, true);
  assert.equal(boundedAppliedProjection.result.execution_target_validation.phases.gateway_post_apply.exact_targets_verified, true);
  assert.equal(boundedAppliedProjection.result.execution_target_validation.phases.finalization.exact_targets_verified, true);
  await validateExecutionTargetValidation(boundedAppliedProjection.result.execution_target_validation);
  await assert.rejects(
    bridge.prepare_existing_model_edit({
      runtime: 'mock',
      instruction: 'A caller cannot self-select bounded plan validation.',
      operations: boundedProjection.result.proposal.operation_proposal,
      targets: boundedProjection.result.proposal.selected_targets,
      save_model: false,
      target_validation: {
        mode: 'structural_groups',
        source: 'server_bound_source_proposal',
        structural_group_limit: 5000
      }
    }),
    (error) => error.code === 'INVALID_ARGUMENT' && /source proposal binding/i.test(error.message)
  );

  const topologyProposalEnvelope = await bridge.start_agent_task({
    intent: 'propose_existing_model_edit',
    instruction: 'Delete the largest group after trusted review.',
    idempotency_key: 'model-graph-structural-topology-proposal',
    inputs: {
      runtime: 'mock',
      target_ref: gatewayProjection.result.proposal.selected_targets[0],
      action: 'delete',
      parameters: {},
      structural_group_limit: 5000,
      save_model: false
    }
  });
  const topologyProposalProjection = await expandedEnvelopeDocument(bridge, topologyProposalEnvelope);
  assert.equal(topologyProposalEnvelope.task_state, 'awaiting_review');
  assert.equal(topologyProposalProjection.result.target_discovery.mode, 'full_recursive');
  const topologyPreparationCalls = [];
  bridge.adopt_open_model = async (options) => {
    topologyPreparationCalls.push(structuredClone(options));
    return originalAdoptOpenModel(options);
  };
  let topologyReviewed;
  try {
    topologyReviewed = await bridge.start_agent_task({
      ...topologyProposalProjection.result.proposal.next_action.arguments,
      idempotency_key: 'model-graph-structural-topology-reviewed-prepare'
    });
  } finally {
    bridge.adopt_open_model = originalAdoptOpenModel;
  }
  assert.equal(topologyReviewed.task_state, 'awaiting_review');
  assert.equal(topologyPreparationCalls.length, 1);
  assert.equal(topologyPreparationCalls[0].recursive, true, 'destructive Group operations must retain full recursive plan validation');
  assert.equal(topologyPreparationCalls[0].structural_groups, undefined);
  const topologyReviewedTask = await bridge.taskStore.getTask(topologyReviewed.task_id, { includePrivate: true });
  assert.equal(topologyReviewedTask.private.existing_edit_plan.target_validation.mode, 'full_recursive');
  assert.equal(topologyReviewedTask.private.existing_edit_plan.target_validation.leaf_entities_materialized, true);
  await validateTargetValidation(topologyReviewedTask.private.existing_edit_plan.target_validation);
  assert.equal(existingModelEditExecutionTargetValidationPolicy(topologyReviewedTask.private.existing_edit_plan).mode, 'full_recursive');
  const topologyReviewedProjection = await expandedEnvelopeDocument(bridge, topologyReviewed);
  assert.equal(topologyReviewedProjection.result.approval_challenge.review_context.execution_target_validation.mode, 'full_recursive');

  const interior = await graphFor(domainFixture('interior'));
  const interiorProposal = proposeExistingModelEdit({
    graph: interior,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the cabinet to Reviewed_Cabinet.',
    target_query: 'cabinet',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Cabinet' }
  });
  assert.equal(interiorProposal.requires_clarification, true);
  assert.ok(interiorProposal.ambiguity_reasons.includes('multiple_similar_targets'));
  assert.equal(interiorProposal.selected_targets.length, 0);
  results.interior = { ambiguous: true, candidates: interiorProposal.candidates.length };

  const ambiguousTask = await bridge.start_agent_task({
    intent: 'propose_existing_model_edit',
    instruction: 'Rename the cabinet to Reviewed_Cabinet.',
    idempotency_key: 'model-graph-interior-proposal',
    inputs: { runtime: 'mock', target_query: 'cabinet', action: 'rename', parameters: { new_name: 'Reviewed_Cabinet' }, save_model: false }
  });
  assert.equal(ambiguousTask.task_state, 'awaiting_input');
  const ambiguousProjection = await expandedEnvelopeDocument(bridge, ambiguousTask);
  const clarifiedTask = await bridge.submit_agent_task_input({
    task_id: ambiguousTask.task_id,
    idempotency_key: 'model-graph-interior-clarification',
    input: { target_ref: ambiguousProjection.result.proposal.candidates[0].persistent_ref }
  });
  assert.equal(clarifiedTask.task_state, 'awaiting_review');
  const clarifiedProjection = await expandedEnvelopeDocument(bridge, clarifiedTask);
  assert.equal(clarifiedProjection.result.proposal.execution_allowed, false);

  const product = await graphFor(domainFixture('product'));
  const productProposal = proposeExistingModelEdit({
    graph: product,
    model_key: TEST_MODEL_KEY,
    instruction: 'Attach metadata to the largest product body.',
    target_query: 'largest body',
    action: 'attribute',
    parameters: { dictionary: 'DesignIntent', key: 'reviewed', value: true }
  });
  assert.equal(productProposal.requires_clarification, false);
  assert.equal(productProposal.candidates[0].summary.value.name, 'Controller_Body');
  results.product = { ready: true, top_target: productProposal.candidates[0].summary.value.name };

  const queueAdoption = JSON.parse(await fs.readFile(path.resolve('test/fixtures/model-graph/queue-pid-adoption.json'), 'utf8'));
  const queueGraph = buildModelGraph(queueAdoption);
  const deepestGeometryProposal = proposeExistingModelEdit({
    graph: queueGraph,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the deepest geometry-bearing group to Reviewed_Inner_Group.',
    target_query: 'deepest geometry-bearing group',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Inner_Group' }
  });
  assert.equal(deepestGeometryProposal.requires_clarification, false);
  assert.equal(deepestGeometryProposal.selected_targets[0].entity_path, 'pid:101.201');
  assert.ok(deepestGeometryProposal.candidates[0].evidence.some((entry) => entry.kind === 'trusted_topology_match'));
  assert.ok(deepestGeometryProposal.candidates[0].evidence.some((entry) => entry.kind === 'deterministic_structural_ranking'));

  const tiedAdoption = structuredClone(queueAdoption);
  const tiedWall = structuredClone(tiedAdoption.recursive_index.find((entry) => entry.entity_path === 'pid:101.201'));
  tiedWall.path = 'pid:101.202';
  tiedWall.entity_path = 'pid:101.202';
  tiedWall.persistent_id_path = '101.202';
  tiedWall.path_segments.at(-1).persistent_id = '202';
  tiedWall.path_segments.at(-1).reference = 'south-wall';
  tiedWall.reference = 'south-wall';
  tiedWall.persistent_id = '202';
  tiedWall.name = 'South_Wall';
  tiedAdoption.recursive_index.push(tiedWall);
  tiedAdoption.recursive_total_seen += 1;
  tiedAdoption.model_revision_total_seen += 1;
  tiedAdoption.model_revision_indexed += 1;
  const tiedGeometryProposal = proposeExistingModelEdit({
    graph: buildModelGraph(tiedAdoption),
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the deepest geometry-bearing group to Reviewed_Inner_Group.',
    target_query: 'deepest geometry-bearing group',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Inner_Group' }
  });
  assert.equal(tiedGeometryProposal.requires_clarification, true);
  assert.ok(tiedGeometryProposal.ambiguity_reasons.includes('multiple_similar_targets'));
  assert.deepEqual(tiedGeometryProposal.selected_targets, []);
  assert.deepEqual(tiedGeometryProposal.operation_proposal, []);

  const tiedLargestProposal = proposeExistingModelEdit({
    graph: buildModelGraph(tiedAdoption),
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the largest wall to Reviewed_Wall.',
    target_query: 'largest wall',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Wall' }
  });
  assert.equal(tiedLargestProposal.requires_clarification, true, 'equal geometry must not be resolved by node id');
  assert.ok(tiedLargestProposal.ambiguity_reasons.includes('multiple_similar_targets'));
  assert.deepEqual(tiedLargestProposal.selected_targets, []);

  const structuralLargeAdoption = JSON.parse(await fs.readFile(
    path.resolve('test/fixtures/model-graph/structural-large-group-adoption.json'),
    'utf8'
  ));
  const structuralLargeGraph = buildModelGraph(structuralLargeAdoption);
  assert.equal(structuralLargeGraph.completeness.complete, false, 'Group projection must not impersonate a complete leaf ModelGraph');
  assert.equal(structuralLargeGraph.projections.structural_groups.complete, true);
  assert.equal(structuralLargeGraph.projections.structural_groups.indexed, 3);
  assert.equal(structuralLargeGraph.projections.structural_groups.leaf_entities_materialized, false);
  assert.equal(structuralLargeGraph.stats.occurrences, 3);
  assert.equal(structuralLargeGraph.stats.faces, 0);
  assert.equal(structuralLargeGraph.stats.edges, 0);
  const structuralLargeProposal = proposeExistingModelEdit({
    graph: structuralLargeGraph,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the largest group to Reviewed_Product_Group.',
    target_query: 'largest group',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Product_Group' }
  });
  assert.equal(structuralLargeProposal.requires_clarification, false);
  assert.equal(structuralLargeProposal.selected_targets[0].entity_path, 'pid:102');
  assert.equal(structuralLargeProposal.target_resolution.coverage.mode, 'complete_structural_group_projection');
  assert.equal(structuralLargeProposal.target_resolution.coverage.sufficient_for_proposal, true);
  assert.equal(structuralLargeProposal.target_resolution.coverage.leaf_entities_materialized, false);
  assert.ok(structuralLargeProposal.candidates[0].evidence.some((entry) => entry.kind === 'bounded_structural_group_projection'));

  const lockedLargestGraph = structuredClone(structuralLargeGraph);
  const lockedLargest = lockedLargestGraph.nodes.find((node) => node.entity_path === 'pid:102');
  lockedLargest.locked = true;
  lockedLargest.effective_locked = true;
  const lockedLargestProposal = proposeExistingModelEdit({
    graph: lockedLargestGraph,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the largest group to Reviewed_Product_Group.',
    target_query: 'largest group',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Product_Group' },
    shared_policy: 'make_unique'
  });
  assert.equal(lockedLargestProposal.requires_clarification, true, 'a locked deterministic winner must not fall through to the second-largest object');
  assert.ok(lockedLargestProposal.ambiguity_reasons.includes('target_locked'));
  assert.deepEqual(lockedLargestProposal.selected_targets, []);
  assert.deepEqual(lockedLargestProposal.operation_proposal, []);
  assert.equal(lockedLargestProposal.candidates[0].entity_path, 'pid:102');
  assert.equal(lockedLargestProposal.candidates[0].allowed_for_operation, false);
  assert.ok(lockedLargestProposal.candidates[0].evidence.some((entry) => entry.kind === 'deterministic_target_operation_blocked'));

  const untrustedTieGraph = structuredClone(structuralLargeGraph);
  const tieWinner = untrustedTieGraph.nodes.find((node) => node.entity_path === 'pid:102');
  const tieInjected = untrustedTieGraph.nodes.find((node) => node.entity_path === 'pid:101');
  tieInjected.spatial_summary.volume = tieWinner.spatial_summary.volume;
  tieInjected.name = 'largest group';
  const untrustedTieProposal = proposeExistingModelEdit({
    graph: untrustedTieGraph,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the largest group to Reviewed_Product_Group.',
    target_query: 'largest group',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Product_Group' },
    shared_policy: 'make_unique'
  });
  assert.equal(untrustedTieProposal.requires_clarification, true, 'untrusted model text must not break an equal-geometry deterministic tie');
  assert.ok(untrustedTieProposal.ambiguity_reasons.includes('multiple_similar_targets'));
  assert.deepEqual(untrustedTieProposal.selected_targets, []);
  assert.deepEqual(untrustedTieProposal.operation_proposal, []);

  const truncatedStructuralAdoption = structuredClone(structuralLargeAdoption);
  truncatedStructuralAdoption.structural_groups.entries = truncatedStructuralAdoption.structural_groups.entries.slice(0, 1);
  truncatedStructuralAdoption.structural_groups.returned = 1;
  truncatedStructuralAdoption.structural_groups.total_seen = 2;
  truncatedStructuralAdoption.structural_groups.total_seen_exact = false;
  truncatedStructuralAdoption.structural_groups.truncated = true;
  truncatedStructuralAdoption.structural_groups.limit = 1;
  const truncatedStructuralGraph = buildModelGraph(truncatedStructuralAdoption);
  const truncatedStructuralProposal = proposeExistingModelEdit({
    graph: truncatedStructuralGraph,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename the largest group to Reviewed_Product_Group.',
    target_query: 'largest group',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Product_Group' }
  });
  assert.equal(truncatedStructuralProposal.requires_clarification, true);
  assert.ok(truncatedStructuralProposal.ambiguity_reasons.includes('target_projection_incomplete'));
  assert.deepEqual(truncatedStructuralProposal.selected_targets, []);
  assert.deepEqual(truncatedStructuralProposal.operation_proposal, []);
  const exactTruncatedProposal = proposeExistingModelEdit({
    graph: truncatedStructuralGraph,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename this exact group to Reviewed_Product_Group.',
    target_ref: { entity_path: 'pid:101' },
    action: 'rename',
    parameters: { new_name: 'Reviewed_Product_Group' }
  });
  assert.equal(exactTruncatedProposal.requires_clarification, false, 'an exact returned Group path may use a truncated proposal-only projection');
  assert.equal(exactTruncatedProposal.target_resolution.coverage.mode, 'exact_structural_group_reference');
  assert.equal(exactTruncatedProposal.selected_targets[0].entity_path, 'pid:101');
  await validateSchemas(structuralLargeGraph, structuralLargeProposal);
  results.structural = {
    unique_deepest_geometry_selected: true,
    equal_depth_abstained: true,
    equal_volume_abstained: true,
      bounded_large_group_projection_selected: true,
      bounded_group_review_preparation: true,
      bounded_group_reviewed_execution: true,
      topology_review_preparation_full_recursive: true,
      truncated_projection_abstained: true,
    exact_truncated_group_reference_selected: true
  };

  const shared = await graphFor(domainFixture('shared'));
  assert.ok(shared.stats.shared_occurrences > 0);
  assert.ok(shared.relationships.hierarchy.length > 0);
  assert.ok(shared.relationships.topology.length > 0);
  assert.equal(shared.relationships.lineage.length, 0, 'Agent-supplied lineage strings must not become trusted graph edges');
  assert.equal(shared.lineage.part_graph, null);
  assert.equal(shared.lineage.untrusted_claims.value.part_graph, 'part-graph:shared-fixture');
  assert.equal(shared.lineage.untrusted_claims.policy_effect, 'none');
  const sharedProposal = proposeExistingModelEdit({
    graph: shared,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename one shared leaf.',
    target_query: 'Shared_Leaf',
    action: 'rename',
    parameters: { new_name: 'Shared_Leaf_Reviewed' }
  });
  assert.equal(sharedProposal.requires_clarification, true);
  assert.ok(sharedProposal.ambiguity_reasons.includes('shared_definition_policy_required'));
  const sharedTarget = sharedProposal.candidates.find((candidate) => candidate.summary.value.name === 'Shared_Leaf');
  const clarifiedShared = proposeExistingModelEdit({
    graph: shared,
    model_key: TEST_MODEL_KEY,
    instruction: 'Rename only this shared leaf occurrence.',
    target_ref: sharedTarget.entity_path,
    action: 'rename',
    parameters: { new_name: 'Shared_Leaf_Reviewed' },
    shared_policy: 'make_unique'
  });
  assert.equal(clarifiedShared.requires_clarification, false);
  assert.equal(clarifiedShared.operation_proposal[0].instance_policy, 'make_unique');
  assert.ok(clarifiedShared.operation_proposal[0].instance_id);
  results.shared = { ambiguous_without_policy: true, ready_with_make_unique: true };

  await validateSchemas(shared, clarifiedShared);
  const currentRevision = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 }));
  assert.equal(currentRevision, shared.model_revision, 'proposal generation must not modify the model');
  assert.notEqual(architectureBefore, shared.model_revision, 'domain fixtures must build distinct model revisions');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    domains: results,
    wrong_target_executions: 0,
    proposal_executions: 0,
    ambiguity_asked: true,
    reserved_routing_override_rejected: true,
    invalid_shared_policy_rejected: true,
    model_graph_stats: shared.stats
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function graphFor(document) {
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify(document) });
  const adoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 });
  const sharedPath = adoption.recursive_index?.find((entry) => entry.name === 'Shared_Leaf')?.entity_path;
  return buildModelGraph(adoption, {
    lineage: document.domain === 'shared' ? {
      part_graph: 'part-graph:shared-fixture',
      parametric_recipe: 'recipe:shared-fixture',
      feature_mapping_plan: 'feature-map:shared-fixture',
      evidence: ['evidence:shared-fixture'],
      entity_paths: { [sharedPath]: ['part:shared-leaf', 'evidence:shared-fixture'] }
    } : {}
  });
}

function domainFixture(domain) {
  const definitions = {
    architecture: {
      name: 'Architecture_Domain',
      operations: [
        { op: 'box', id: 'north-wall', name: 'North_Wall', origin: [0, 0, 0], size: [5000, 200, 3000] },
        { op: 'box', id: 'south-wall', name: 'South_Wall', origin: [0, 4000, 0], size: [3000, 200, 3000] }
      ]
    },
    interior: {
      name: 'Interior_Domain',
      operations: [
        { op: 'box', id: 'left-cabinet', name: 'Left_Cabinet', origin: [0, 0, 0], size: [900, 600, 2200] },
        { op: 'box', id: 'right-cabinet', name: 'Right_Cabinet', origin: [1200, 0, 0], size: [900, 600, 2200] }
      ]
    },
    product: {
      name: 'Product_Domain',
      operations: [
        { op: 'rounded_box', id: 'controller-body', name: 'Controller_Body', origin: [0, 0, 0], size: [180, 90, 24], radius: 12 },
        { op: 'cylinder', id: 'controller-button-a', name: 'Controller_Button_A', origin: [130, 45, 24], radius: 8, height: 5 },
        { op: 'cylinder', id: 'controller-button-b', name: 'Controller_Button_B', origin: [150, 45, 24], radius: 8, height: 5 }
      ]
    }
  };
  if (domain === 'shared') {
    return {
      domain,
      version: 1,
      units: 'mm',
      operations: [
        { op: 'reset' },
        { op: 'component_definition', name: 'Shared_Leaf_Definition', operations: [
          { op: 'box', id: 'shared-leaf', name: 'Shared_Leaf', origin: [0, 0, 0], size: [100, 60, 30] }
        ] },
        { op: 'component_definition', name: 'Shared_Parent_Definition', operations: [
          { op: 'component_instance', id: 'shared-leaf-instance', name: 'Shared_Leaf_Instance', definition: 'Shared_Leaf_Definition', origin: [0, 0, 0] }
        ] },
        { op: 'component_instance', id: 'shared-parent-a', name: 'Shared_Parent_A', definition: 'Shared_Parent_Definition', origin: [0, 0, 0] },
        { op: 'component_instance', id: 'shared-parent-b', name: 'Shared_Parent_B', definition: 'Shared_Parent_Definition', origin: [250, 0, 0] }
      ]
    };
  }
  const definition = definitions[domain];
  return {
    domain,
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Reviewed_Concrete', color: '#999999' },
      { op: 'component_definition', name: definition.name, operations: definition.operations },
      { op: 'component_instance', id: `${domain}-domain-instance`, name: `${domain}_domain_instance`, definition: definition.name, origin: [0, 0, 0] }
    ]
  };
}

async function expandedEnvelopeDocument(targetBridge, envelope) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) {
    return {
      result: envelope.data,
      next_action: envelope.next_action,
      artifacts: envelope.artifacts || []
    };
  }
  return JSON.parse(await readArtifactText(targetBridge, handle, envelope.task_id));
}

async function readArtifactText(targetBridge, handle, taskId) {
  let offset = 0;
  let content = '';
  while (true) {
    const page = await targetBridge.read_agent_artifact({
      handle,
      task_id: taskId,
      offset,
      max_chars: 100000
    });
    assert.equal(page.ok, true);
    assert.equal(typeof page.data?.artifact?.content, 'string');
    content += page.data.artifact.content;
    if (page.data.artifact.eof) return content;
    offset = page.data.artifact.next_offset;
  }
}

async function validateSchemas(graph, proposal) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const graphSchema = JSON.parse(await fs.readFile(path.resolve('schema/model-graph-v1.schema.json'), 'utf8'));
  const proposalSchema = JSON.parse(await fs.readFile(path.resolve('schema/existing-model-edit-proposal-v1.schema.json'), 'utf8'));
  assert.equal(ajv.validate(graphSchema, graph), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(proposalSchema, proposal), true, JSON.stringify(ajv.errors));
}

async function validateTargetValidation(targetValidation) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const schema = JSON.parse(await fs.readFile(path.resolve('schema/existing-edit-target-validation-v1.schema.json'), 'utf8'));
  assert.equal(ajv.validate(schema, targetValidation), true, JSON.stringify(ajv.errors));
}

async function validateExecutionTargetValidation(targetValidation) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const schema = JSON.parse(await fs.readFile(path.resolve('schema/existing-edit-execution-target-validation-v1.schema.json'), 'utf8'));
  const validate = ajv.compile(schema);
  assert.equal(validate(targetValidation), true, JSON.stringify(validate.errors));
  for (const phase of Object.values(targetValidation.phases)) {
    assert.equal(phase.mode, targetValidation.mode);
    assert.equal(phase.leaf_entities_materialized, targetValidation.leaf_entities_materialized);
  }
  const missingIterationAfter = structuredClone(targetValidation);
  delete missingIterationAfter.phases.iteration_after;
  assert.equal(validate(missingIterationAfter), false);
  const unexpectedField = structuredClone(targetValidation);
  unexpectedField.agent_override = true;
  assert.equal(validate(unexpectedField), false);
  const falseLeafClaim = structuredClone(targetValidation);
  falseLeafClaim.leaf_entities_materialized = true;
  assert.equal(validate(falseLeafClaim), false);
}
