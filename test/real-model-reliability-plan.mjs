import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { deriveRealModelRecursiveTargetReview } from '../src/real-model-recursive-target-review.mjs';
import {
  prepareRealModelReliabilityExecutionPlan,
  validateRealModelReliabilityExecutionPlan
} from '../src/real-model-reliability-plan.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_SHA = `sha256:${'8'.repeat(64)}`;
const REVISION_HASH = `sha256:${'7'.repeat(64)}`;
const MODEL_REVISION_SOURCE_SHA256 = '9'.repeat(64);
const CANDIDATE_TOKEN = 'c'.repeat(24);
const CANDIDATE_ID = `candidate_${CANDIDATE_TOKEN}`;
const CANDIDATE_HANDLE = `candidate:sha256:${CANDIDATE_TOKEN}`;
let assertions = 0;

const positive = fixtureContext({ freshManifold: true });
assert.equal(positive.recursiveReview.version, 'real-model-recursive-target-review.v2'); assertions += 1;
const plan = await prepareRealModelReliabilityExecutionPlan(directOptions(positive));
assert.equal(plan.version, 'real-model-reliability-execution-plan.v3'); assertions += 1;
assert.equal(plan.revision_contract.strategy, 'definition-merkle.v2'); assertions += 1;
assert.equal(plan.revision_contract.model_revision_source_sha256, MODEL_REVISION_SOURCE_SHA256); assertions += 1;
assert.equal(plan.revision_contract.model_modified, false); assertions += 1;
assert.equal(plan.stage, 'offline_prepare_only'); assertions += 1;
assert.equal(plan.runtime, 'offline'); assertions += 1;
assert.equal(plan.live_queue_called, false); assertions += 1;
assert.equal(plan.operation_contract.exact_allowed_operation, 'boolean_difference'); assertions += 1;
assert.deepEqual(plan.operation_contract.allowed_operations, ['boolean_difference']); assertions += 1;
assert.equal(plan.operation_contract.risk_level, 'S3'); assertions += 1;
assert.equal(plan.operation_contract.keep_policy.keep_original_target, true); assertions += 1;
assert.equal(plan.operation_contract.keep_policy.keep_guard, true); assertions += 1;
assert.equal(plan.proposal_contract.strategy, 'existing_pair'); assertions += 1;
assert.equal(plan.proposal_contract.status, 'server_recommended'); assertions += 1;
assert.equal(plan.proposal_contract.bbox_relation, 'containment'); assertions += 1;
assert.equal(plan.proposal_contract.bbox_containment_direction, 'target_contains_tool'); assertions += 1;
assert.deepEqual(plan.proposal_contract.bbox_axis_overlaps, [3, 6, 6]); assertions += 1;
assert.equal(plan.proposal_contract.positive_bbox_overlap, true); assertions += 1;
assert.equal(plan.proposal_contract.bbox_overlap_volume, 108); assertions += 1;
assert.equal(plan.proposal_contract.target_bbox_volume, 1000); assertions += 1;
assert.equal(plan.proposal_contract.tool_bbox_volume, 108); assertions += 1;
assert.deepEqual(plan.proposal_contract.exact_solid_overlap, {
  status: 'unverified_before_atomic_trial',
  verified: false,
  verification_stage: 'review_gated_atomic_apply'
}); assertions += 1;
assert.equal(plan.proposal_contract.atomic_boolean_trial_eligible, true); assertions += 1;
assert.equal(plan.proposal_contract.target.occurrence_path, 'pid:101'); assertions += 1;
assert.equal(plan.proposal_contract.guard.occurrence_path, 'pid:102'); assertions += 1;
assert.deepEqual(plan.proposal_contract.scope_instance_policy, {
  policy: 'top_level',
  parent_occurrence_path: null,
  affected_instance_count: 1,
  shared_definition: false,
  instance_policy_required: false
}); assertions += 1;
assert.match(plan.proposal_contract.target.entity_fingerprint, /^sha256:[0-9a-f]{64}$/); assertions += 1;
assert.match(plan.proposal_contract.target.bounding_box_sha256, /^sha256:[0-9a-f]{64}$/); assertions += 1;
assert.equal(plan.proposal_contract.target.material_expectation.value, '[Target_Material]'); assertions += 1;
assert.equal(plan.execution_scope.disposable_copy_only, true); assertions += 1;
assert.equal(plan.execution_scope.capture_policy, 'forbidden'); assertions += 1;
assert.equal(plan.execution_scope.save_policy, 'save_model_version_non_overwriting'); assertions += 1;
assert.equal(plan.execution_scope.reopen_policy, 'required_before_acceptance'); assertions += 1;
assert.equal(plan.execution_scope.executable_now, false); assertions += 1;
assert.equal(plan.execution_scope.disposition, 'awaiting_local_approval_for_atomic_trial'); assertions += 1;
assert.equal(plan.approval_requirements.local_approval_required, true); assertions += 1;
assert.equal(plan.approval_requirements.fresh_session_contract_required, true); assertions += 1;
assert.equal(plan.approval_requirements.mutation_authorized, false); assertions += 1;
assert.equal(plan.atomic_trial_contract.eligible, true); assertions += 1;
assert.equal(plan.atomic_trial_contract.verification_stage, 'review_gated_atomic_apply'); assertions += 1;
assert.equal(plan.atomic_trial_contract.exact_solid_overlap_verified_before_trial, false); assertions += 1;
assert.deepEqual(plan.atomic_trial_contract.success_preconditions, {
  atomic_split_success_required: true,
  target_exact_volume_reduction_required: true,
  result_manifold_required: true,
  all_required_before_commit: true
}); assertions += 1;
assert.equal(plan.atomic_trial_contract.success_disposition,
  'commit_only_after_all_success_preconditions'); assertions += 1;
assert.equal(plan.atomic_trial_contract.failure_disposition, 'abort_before_commit'); assertions += 1;
assert.equal(plan.retry_contract.mutation_receipt_required, true); assertions += 1;
assert.equal(plan.retry_contract.duplicate_request_behavior, 'return_existing_receipt_without_reexecution'); assertions += 1;
assert.equal(plan.acceptance_contract.wrong_object.maximum_wrong_object_modifications, 0); assertions += 1;
assert.equal(plan.acceptance_contract.silent_geometry_corruption.maximum_silent_corruption_events, 0); assertions += 1;
assert.equal(plan.acceptance_contract.material_preservation.exact_match_required, true); assertions += 1;
assert.equal(plan.acceptance_contract.manifold.result_must_be_manifold, true); assertions += 1;
assert.equal(plan.acceptance_contract.save_reopen_identity.reopen_required, true); assertions += 1;
assert.equal(plan.safety.release_acceptance, false); assertions += 1;
assert.equal(/token|secret/i.test(JSON.stringify(plan)), false); assertions += 1;

const repeat = await prepareRealModelReliabilityExecutionPlan({
  ...directOptions(positive),
  now: () => new Date('2030-01-01T00:00:00.000Z')
});
assert.equal(repeat.plan_hash, plan.plan_hash); assertions += 1;
assert.equal(repeat.retry_contract.idempotency_key, plan.retry_contract.idempotency_key); assertions += 1;

const modifiedState = directOptions(positive);
modifiedState.modelRevision.model_modified = true;
const modifiedStatePlan = await prepareRealModelReliabilityExecutionPlan(modifiedState);
assert.notEqual(modifiedStatePlan.plan_hash, plan.plan_hash); assertions += 1;

const differentRevisionSource = directOptions(positive);
differentRevisionSource.modelRevision.model_revision_source_sha256 = '1'.repeat(64);
const differentRevisionSourcePlan = await prepareRealModelReliabilityExecutionPlan(differentRevisionSource);
assert.notEqual(differentRevisionSourcePlan.plan_hash, plan.plan_hash); assertions += 1;

const historicalV2Plan = toHistoricalV2Plan(plan);
const historicalV2Schema = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'schema/real-model-reliability-execution-plan-v2.schema.json'),
  'utf8'
));
const validateHistoricalV2 = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: false
}).compile(historicalV2Schema);
assert.equal(validateHistoricalV2(historicalV2Plan), true, JSON.stringify(validateHistoricalV2.errors)); assertions += 1;
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(historicalV2Plan),
  /schema validation failed/
); assertions += 1;

const historicalV1Plan = structuredClone(historicalV2Plan);
historicalV1Plan.version = 'real-model-reliability-execution-plan.v1';
historicalV1Plan.revision_contract.strategy = 'definition-merkle.v1';
delete historicalV1Plan.revision_contract.model_revision_source_sha256;
delete historicalV1Plan.revision_contract.model_modified;
const historicalV1Schema = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'schema/real-model-reliability-execution-plan-v1.schema.json'),
  'utf8'
));
const validateHistoricalV1 = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: false
}).compile(historicalV1Schema);
assert.equal(validateHistoricalV1(historicalV1Plan), true); assertions += 1;
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(historicalV1Plan),
  /schema validation failed/
); assertions += 1;

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.version = 'real-model-recursive-target-review.v1';
}, /requires recursive review v2/);

await rejectMutation(positive, ({ targetReview }) => {
  targetReview.version = 'real-model-target-review.v1';
}, /unsupported target review version/);

await rejectMutation(positive, ({ evidenceBindings }) => {
  evidenceBindings.target_review.sha256 = 'e'.repeat(64);
}, /target_review evidence hash drift/);

await rejectMutation(positive, ({ evidenceBindings }) => {
  evidenceBindings.recursive_review.sha256 = 'not-a-digest';
}, /must be 64 lowercase hex characters/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.target.persistent_id = '999';
  recursiveReview.review.pair_evaluations[0].target.persistent_id = '999';
}, /persistent_id does not match occurrence_path/);

await rejectMutation(positive, ({ modelRevision }) => {
  modelRevision.hash = `sha256:${'6'.repeat(64)}`;
}, /revision hash drift/);

await rejectMutation(positive, ({ modelRevision }) => {
  modelRevision.complete = false;
}, /model revision must be complete/);

await rejectMutation(positive, ({ modelRevision }) => {
  modelRevision.strategy = 'definition-merkle.v1';
}, /model revision strategy is not allowed/);

await rejectMutation(positive, ({ modelRevision }) => {
  delete modelRevision.model_revision_source_sha256;
}, /model revision source sha256 must be 64 lowercase hex characters/);

await rejectMutation(positive, ({ modelRevision }) => {
  modelRevision.model_revision_source_sha256 = 'not-a-digest';
}, /model revision source sha256 must be 64 lowercase hex characters/);

await rejectMutation(positive, ({ modelRevision }) => {
  delete modelRevision.model_modified;
}, /modelRevision.model_modified must be a boolean/);

await rejectMutation(positive, ({ modelRevision }) => {
  modelRevision.model_modified = 'false';
}, /modelRevision.model_modified must be a boolean/);

await rejectMutation(positive, ({ modelRevision, targetReview }) => {
  targetReview.revision_attestation.model_modified = false;
  modelRevision.model_modified = true;
}, /model modified state drift/);

await rejectMutation(positive, ({ modelRevision, targetReview }) => {
  targetReview.sketchup.model_revision_source_sha256 = MODEL_REVISION_SOURCE_SHA256;
  modelRevision.model_revision_source_sha256 = '1'.repeat(64);
}, /model revision source sha256 drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.model.revision_unique_entities += 1;
}, /recursive review unique entity count drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.target.entity_fingerprint = `sha256:${'5'.repeat(64)}`;
  recursiveReview.review.pair_evaluations[0].target.entity_fingerprint = `sha256:${'5'.repeat(64)}`;
}, /entity fingerprint drift from recursive candidate/);

await rejectMutation(positive, ({ recursiveReview }) => {
  const box = recursiveReview.review.recommended_proposal.target.bounding_box;
  box.max[0] += 1;
  box.w += 1;
}, /bounding box hash drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.target.display.material = '[Drifted]';
  recursiveReview.review.pair_evaluations[0].target.display.material = '[Drifted]';
}, /material expectation hash drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.mutation_authorized = true;
}, /forged authority/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.status = 'agent_selected';
}, /roles are not server_recommended/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.operation = 'intersect';
  recursiveReview.review.pair_evaluations[0].operation = 'intersect';
}, /only the exact boolean_difference operation is allowed/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.bbox_relation = 'contact';
  recursiveReview.review.pair_evaluations[0].bbox_relation = 'contact';
}, /contact\/disjoint fail closed/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.exact_solid_overlap.status = 'verified';
  recursiveReview.review.recommended_proposal.exact_solid_overlap.verified = true;
  recursiveReview.review.pair_evaluations[0].exact_solid_overlap.status = 'verified';
  recursiveReview.review.pair_evaluations[0].exact_solid_overlap.verified = true;
}, /must remain unverified before the review-gated atomic trial/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.bbox_overlap_volume += 1;
  recursiveReview.review.pair_evaluations[0].bbox_overlap_volume += 1;
}, /proposal bbox overlap volume drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.pair_evaluations[0].target_bbox_volume += 1;
}, /pair target bbox volume drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.pair_evaluations[0].tool_bbox_volume += 1;
}, /pair tool bbox volume drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.pair_evaluations[0].bbox_axis_overlaps[0] += 1;
}, /pair bbox axis overlaps drift/);

await rejectMutation(positive, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.atomic_boolean_trial_eligible = false;
  recursiveReview.review.pair_evaluations[0].atomic_boolean_trial_eligible = false;
}, /requires atomic boolean trial eligibility/);

await rejectMutation(positive, ({ recursiveReview }) => {
  const source = recursiveReview.review.recommended_proposal.target;
  recursiveReview.review.recommended_proposal.tool = structuredClone(source);
  recursiveReview.review.pair_evaluations[0].tool = structuredClone(source);
}, /target and guard occurrence paths must be distinct/);

const nested = fixtureContext({
  freshManifold: true,
  targetPath: 'pid:100.101',
  guardPath: 'pid:100.102',
  parentPath: 'pid:100',
  scopePath: 'pid:100',
  affectedInstanceCount: 2,
  sharedDefinition: true,
  instancePolicyRequired: true
});
nested.targetReview.target_review.candidates = [{
  persistent_id: '100',
  entity_path: 'pid:100',
  display: { material: '[Parent_Material]', trust: 'untrusted_data' },
  bounding_box: bbox([-1, -1, -1], [11, 11, 11])
}];
const nestedPlan = await prepareRealModelReliabilityExecutionPlan(directOptions(nested));
assert.equal(nestedPlan.proposal_contract.target.occurrence_path, 'pid:100.101'); assertions += 1;
assert.equal(nestedPlan.proposal_contract.guard.occurrence_path, 'pid:100.102'); assertions += 1;
assert.deepEqual(nestedPlan.proposal_contract.scope_instance_policy, {
  policy: 'make_unique',
  parent_occurrence_path: 'pid:100',
  affected_instance_count: 2,
  shared_definition: true,
  instance_policy_required: true
}); assertions += 1;

const inconsistentSharedScope = directOptions(nested);
inconsistentSharedScope.recursiveReview.review.candidates
  .find((entry) => entry.occurrence_path === 'pid:100.102').affected_instance_count = 1;
await assert.rejects(
  prepareRealModelReliabilityExecutionPlan(inconsistentSharedScope),
  /shared_definition must exactly match affected_instance_count/
); assertions += 1;

const inconsistentSingleScope = fixtureContext({
  freshManifold: true,
  targetPath: 'pid:110.111',
  guardPath: 'pid:110.112',
  parentPath: 'pid:110',
  scopePath: 'pid:110',
  affectedInstanceCount: 1,
  sharedDefinition: true,
  instancePolicyRequired: true
});
inconsistentSingleScope.targetReview.target_review.candidates = [];
await assert.rejects(
  prepareRealModelReliabilityExecutionPlan(directOptions(inconsistentSingleScope)),
  /shared_definition must exactly match affected_instance_count/
); assertions += 1;

const singleNested = fixtureContext({
  freshManifold: true,
  targetPath: 'pid:120.121',
  guardPath: 'pid:120.122',
  parentPath: 'pid:120',
  scopePath: 'pid:120',
  affectedInstanceCount: 1,
  sharedDefinition: false,
  instancePolicyRequired: true
});
singleNested.targetReview.target_review.candidates = [];
const singleNestedPlan = await prepareRealModelReliabilityExecutionPlan(directOptions(singleNested));
assert.equal(singleNestedPlan.proposal_contract.scope_instance_policy.policy, 'definition_wide'); assertions += 1;
assert.equal(singleNestedPlan.proposal_contract.scope_instance_policy.shared_definition, false); assertions += 1;
const forgedSingleShared = structuredClone(singleNestedPlan);
forgedSingleShared.proposal_contract.scope_instance_policy.shared_definition = true;
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(forgedSingleShared),
  /schema validation failed/
); assertions += 1;

const forgedSharedPolicy = structuredClone(nestedPlan);
forgedSharedPolicy.proposal_contract.scope_instance_policy.policy = 'definition_wide';
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(forgedSharedPolicy),
  /schema validation failed/
); assertions += 1;

const forgedSharedCount = structuredClone(nestedPlan);
forgedSharedCount.proposal_contract.scope_instance_policy.affected_instance_count = 1;
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(forgedSharedCount),
  /schema validation failed/
); assertions += 1;

const forgedVerifiedPlan = structuredClone(plan);
forgedVerifiedPlan.proposal_contract.exact_solid_overlap.status = 'verified';
forgedVerifiedPlan.proposal_contract.exact_solid_overlap.verified = true;
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(forgedVerifiedPlan),
  /schema validation failed/
); assertions += 1;

const forgedExecutablePlan = structuredClone(plan);
forgedExecutablePlan.execution_scope.executable_now = true;
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(forgedExecutablePlan),
  /schema validation failed/
); assertions += 1;

const weakenedAtomicFailurePlan = structuredClone(plan);
weakenedAtomicFailurePlan.atomic_trial_contract.failure_disposition = 'commit_partial_result';
await assert.rejects(
  validateRealModelReliabilityExecutionPlan(weakenedAtomicFailurePlan),
  /schema validation failed/
); assertions += 1;

await rejectMutation(nested, ({ recursiveReview }) => {
  recursiveReview.review.recommended_proposal.target.occurrence_path = 'pid:100/pid:101';
  recursiveReview.review.recommended_proposal.target.entity_path = 'pid:100/pid:101';
  recursiveReview.review.pair_evaluations[0].target.occurrence_path = 'pid:100/pid:101';
}, /occurrence_path is not canonical/);

const noExecutablePair = fixtureContext({ freshManifold: false });
const blocked = await prepareRealModelReliabilityExecutionPlan(directOptions(noExecutablePair));
assert.equal(blocked.proposal_contract.strategy, 'generated_cutter'); assertions += 1;
assert.equal(blocked.proposal_contract.status, 'blocked_generated_cutter_lineage'); assertions += 1;
assert.equal(blocked.proposal_contract.target.occurrence_path, 'pid:101'); assertions += 1;
assert.equal(blocked.proposal_contract.guard.occurrence_path, 'pid:102'); assertions += 1;
assert.equal(blocked.proposal_contract.generated_cutter_lineage.complete, false); assertions += 1;
assert.equal(blocked.execution_scope.disposition, 'blocked'); assertions += 1;
assert.equal(blocked.execution_scope.eligible_after_requirements, false); assertions += 1;
assert.equal(blocked.atomic_trial_contract.eligible, false); assertions += 1;
assert.equal(blocked.atomic_trial_contract.failure_disposition, 'abort_before_commit'); assertions += 1;
assert.equal(blocked.next_action.action, 'complete_generated_cutter_lineage_then_reprepare'); assertions += 1;
assert.equal(blocked.safety.mutation_authorized, false); assertions += 1;

const disjoint = fixtureContext({
  freshManifold: false,
  guardBox: bbox([30, 0, 0], [35, 5, 5])
});
const disjointDraft = await prepareRealModelReliabilityExecutionPlan(directOptions(disjoint));
assert.equal(disjointDraft.proposal_contract.bbox_relation, 'disjoint'); assertions += 1;
assert.equal(disjointDraft.proposal_contract.positive_bbox_overlap, false); assertions += 1;
assert.equal(disjointDraft.proposal_contract.bbox_overlap_volume, 0); assertions += 1;
assert.equal(disjointDraft.proposal_contract.exact_solid_overlap.verified, false); assertions += 1;
assert.equal(disjointDraft.execution_scope.disposition, 'blocked'); assertions += 1;

const crossScope = fixtureContext({ freshManifold: false });
const crossScopeOptions = directOptions(crossScope);
crossScopeOptions.recursiveReview.review.candidates
  .find((entry) => entry.occurrence_path === 'pid:102').scope_path = 'pid:999';
await assert.rejects(
  prepareRealModelReliabilityExecutionPlan(crossScopeOptions),
  /different Entities scopes/
); assertions += 1;

const cli = await runCliOfflineFixture(positive);
assert.equal(cli.stdout.runtime, 'offline'); assertions += 1;
assert.equal(cli.stdout.live_queue_called, false); assertions += 1;
assert.equal(cli.stdout.mutation_authorized, false); assertions += 1;
assert.equal(cli.stdout.release_acceptance, false); assertions += 1;
assert.equal(cli.output.runtime, 'offline'); assertions += 1;
assert.equal(cli.output.live_queue_called, false); assertions += 1;
assert.equal(cli.queueStateCreated, false); assertions += 1;

process.stdout.write(`${JSON.stringify({
  ok: true,
  assertions,
  positive_strategy: plan.proposal_contract.strategy,
  generated_cutter_strategy: blocked.proposal_contract.strategy,
  generated_cutter_blocked: blocked.execution_scope.disposition === 'blocked',
  cli_live_queue_called: cli.stdout.live_queue_called,
  mutation_authorized: cli.stdout.mutation_authorized,
  release_acceptance: cli.stdout.release_acceptance
}, null, 2)}\n`);

async function rejectMutation(context, mutate, pattern) {
  const options = directOptions(context);
  mutate(options);
  options.serverRecommendedProposal = options.recursiveReview.review.recommended_proposal
    ? structuredClone(options.recursiveReview.review.recommended_proposal)
    : null;
  await assert.rejects(prepareRealModelReliabilityExecutionPlan(options), pattern);
  assertions += 1;
}

function toHistoricalV2Plan(currentPlan) {
  const historical = structuredClone(currentPlan);
  historical.version = 'real-model-reliability-execution-plan.v2';
  delete historical.atomic_trial_contract;
  historical.proposal_contract.positive_volume_overlap = historical.proposal_contract.positive_bbox_overlap;
  for (const key of [
    'bbox_containment_direction', 'bbox_axis_overlaps', 'positive_bbox_overlap',
    'bbox_overlap_bounding_box', 'bbox_overlap_volume', 'target_bbox_volume', 'tool_bbox_volume',
    'exact_solid_overlap', 'atomic_boolean_trial_eligible'
  ]) {
    delete historical.proposal_contract[key];
  }
  historical.execution_scope.disposition = 'awaiting_local_approval';
  historical.next_action.action = 'request_local_approval_for_fresh_disposable_copy_execution';
  return historical;
}

function directOptions(context) {
  return {
    candidateInventory: structuredClone(context.candidateInventory),
    candidateId: CANDIDATE_ID,
    semanticMapping: structuredClone(context.semanticMapping),
    targetReview: structuredClone(context.targetReview),
    recursiveReview: structuredClone(context.recursiveReview),
    evidenceBindings: structuredClone(context.bindings),
    modelRevision: structuredClone(context.modelRevision),
    serverRecommendedProposal: context.recursiveReview.review.recommended_proposal
      ? structuredClone(context.recursiveReview.review.recommended_proposal)
      : null,
    allowedOutputRoot: 'output/real-model-reliability/staged-execution',
    now: () => new Date('2026-07-20T16:00:00.000Z')
  };
}

function fixtureContext({
  freshManifold,
  targetPath = 'pid:101',
  guardPath = 'pid:102',
  parentPath = null,
  scopePath = 'model',
  guardScopePath = scopePath,
  targetBox = bbox([0, 0, 0], [10, 10, 10]),
  guardBox = bbox([5, 2, 2], [8, 8, 8]),
  affectedInstanceCount = 1,
  sharedDefinition = false,
  instancePolicyRequired = false,
  guardAffectedInstanceCount = affectedInstanceCount,
  guardSharedDefinition = sharedDefinition,
  guardInstancePolicyRequired = instancePolicyRequired
}) {
  const candidateInventoryHash = 'a'.repeat(64);
  const targetReviewHash = 'b'.repeat(64);
  const bindings = {
    candidate_inventory: { path: 'evidence/candidate-inventory.json', sha256: candidateInventoryHash },
    semantic_mapping: { path: 'evidence/semantic-mapping.json', sha256: 'c'.repeat(64) },
    target_review: { path: 'evidence/target-review.json', sha256: targetReviewHash },
    recursive_review: { path: 'evidence/recursive-review.json', sha256: 'd'.repeat(64) }
  };
  const candidateInventory = inventoryFixture();
  const adoption = {
    read_only: true,
    model_revision_complete: true,
    model_revision: REVISION_HASH,
    model_revision_strategy: 'definition-merkle.v2',
    model_revision_unique_entity_limit: 1_000_000,
    model_revision_unique_entities: 200,
    model_revision_reachable_definitions: 3,
    model_revision_total_seen: 220,
    document_id: 'document_fixture_001',
    model_identity: {
      document_id: 'document_fixture_001',
      source_path: 'output/disposable/candidate.skp',
      model_guid: 'fixture-guid'
    },
    structural_groups: {
      version: 'structural-groups.v1',
      total_seen: 2,
      total_seen_exact: true,
      returned: 2,
      truncated: false,
      limit: 100,
      fresh_manifold_requested: freshManifold ? 2 : 0,
      fresh_manifold_matched: freshManifold ? 2 : 0,
      fresh_manifold_unmatched: 0,
      entries: [
        structuralEntry({
          entityPath: targetPath,
          parentPath,
          scopePath,
          persistentId: leafPid(targetPath),
          material: '[Target_Material]',
          box: targetBox,
          faces: 100,
          freshManifold,
          affectedInstanceCount,
          sharedDefinition,
          instancePolicyRequired
        }),
        structuralEntry({
          entityPath: guardPath,
          parentPath,
          scopePath: guardScopePath,
          persistentId: leafPid(guardPath),
          material: '[Guard_Material]',
          box: guardBox,
          faces: 20,
          freshManifold,
          affectedInstanceCount: guardAffectedInstanceCount,
          sharedDefinition: guardSharedDefinition,
          instancePolicyRequired: guardInstancePolicyRequired
        })
      ]
    }
  };
  const recursiveReview = deriveRealModelRecursiveTargetReview(adoption, {
    sourceSha256: SOURCE_SHA,
    modelRevision: REVISION_HASH,
    operation: 'difference',
    now: () => new Date('2026-07-20T15:00:00.000Z')
  });
  const targetReview = targetReviewFixture({
    candidateInventoryHash,
    candidates: adoption.structural_groups.entries
  });
  const semanticMapping = mappingFixture({ candidateInventoryHash, targetReviewHash });
  return {
    candidateInventory,
    semanticMapping,
    targetReview,
    recursiveReview,
    bindings,
    modelRevision: revisionFixture(recursiveReview)
  };
}

function inventoryFixture() {
  return {
    version: 'real-model-candidate-inventory.v1',
    kind: 'real_model_candidate_inventory',
    policy: {
      live_queue_called: false,
      model_content_is_untrusted_data: true,
      formal_corpus_acceptance: false
    },
    candidates: [{
      candidate_id: CANDIDATE_ID,
      candidate_handle: CANDIDATE_HANDLE,
      source: { sha256: SOURCE_SHA, relative_path: 'Trimble S6.skp' },
      trust: {
        classification: 'untrusted_data',
        may_influence_execution_policy: false,
        may_grant_approval: false
      },
      intake: { original_modified: false }
    }]
  };
}

function mappingFixture({ candidateInventoryHash, targetReviewHash }) {
  return {
    version: 'real-model-candidate-semantic-mapping-amendment.v1',
    kind: 'real_model_candidate_semantic_mapping_amendment',
    decision_scope: 'semantic_candidate_mapping_addition_only',
    authority: {
      mutation_authorized: false,
      approval_token_issued: false,
      execution_policy_changed: false,
      target_roles_confirmed: false,
      model_content_trust: 'untrusted_data'
    },
    bindings: {
      candidate_inventory: { path: 'evidence/candidate-inventory.json', sha256: candidateInventoryHash },
      target_review: { path: 'evidence/target-review.json', sha256: targetReviewHash }
    },
    addition: {
      candidate_id: CANDIDATE_ID,
      candidate_handle: CANDIDATE_HANDLE,
      source_sha256: SOURCE_SHA,
      assignments: [{ case_id: 'product-boolean-manifold', role: 'primary', review_status: 'user_confirmed' }]
    },
    target_review_disposition: { selection_authority_granted: false }
  };
}

function targetReviewFixture({ candidateInventoryHash, candidates }) {
  return {
    version: 'real-model-target-review.v2',
    kind: 'real_model_target_review',
    runtime: 'queue',
    live_queue_called: true,
    inventory: { sha256: `sha256:${candidateInventoryHash}` },
    source: {
      candidate_id: CANDIDATE_ID,
      candidate_handle: CANDIDATE_HANDLE,
      sha256: SOURCE_SHA
    },
    sketchup: {
      model_revision_strategy: 'definition-merkle.v2',
      model_revision_unique_entity_limit: 1_000_000
    },
    revision_attestation: {
      before: REVISION_HASH,
      adoption: REVISION_HASH,
      after: REVISION_HASH,
      complete: true,
      unchanged: true,
      unique_entities: 200,
      reachable_definitions: 3,
      logical_occurrences: 220
    },
    target_review: {
      candidates: candidates.map((entry) => ({
        persistent_id: String(entry.persistent_id),
        entity_path: entry.entity_path,
        display: { material: entry.material, trust: 'untrusted_data' },
        bounding_box: structuredClone(entry.world_bounding_box)
      }))
    },
    safety: {
      read_only_adoption: true,
      disposable_copy_only: true,
      model_content_mutation_requested: false,
      save_requested: false
    },
    next_action: { mutation_authorized: false, release_acceptance: false }
  };
}

function revisionFixture(recursiveReview) {
  return {
    strategy: 'definition-merkle.v2',
    hash: REVISION_HASH,
    complete: true,
    unique_entity_limit: 1_000_000,
    unique_entities: 200,
    reachable_definitions: 3,
    logical_occurrences: 220,
    document_id: recursiveReview.model.document_id,
    model_identity_sha256: recursiveReview.model.model_identity_sha256,
    model_revision_source_sha256: MODEL_REVISION_SOURCE_SHA256,
    model_modified: false
  };
}

function structuralEntry({
  entityPath,
  parentPath,
  scopePath,
  persistentId,
  material,
  box,
  faces,
  freshManifold,
  affectedInstanceCount,
  sharedDefinition,
  instancePolicyRequired
}) {
  const segments = entityPath.slice('pid:'.length).split('.');
  return {
    entity_path: entityPath,
    parent_entity_path: parentPath,
    scope_path: scopePath,
    persistent_id: persistentId,
    path_segments: segments.map((segment, index) => ({
      entity_type: index === segments.length - 1 ? 'group' : 'component_instance',
      persistent_id: segment,
      reference: null
    })),
    name: 'Untrusted display name',
    material,
    tag: 'Untrusted tag',
    visible: true,
    locked: false,
    effective_visible: true,
    effective_locked: false,
    faces,
    edges: faces * 2,
    vertices: faces * 2,
    parent_bounding_box: null,
    world_bounding_box: structuredClone(box),
    affected_instance_count: affectedInstanceCount,
    shared_definition: sharedDefinition,
    instance_policy_required: instancePolicyRequired,
    manifold_attestation: freshManifold
      ? {
        fresh: true,
        matched: true,
        entity_path: entityPath,
        model_revision: REVISION_HASH,
        is_manifold: true
      }
      : {}
  };
}

function bbox(min, max) {
  return {
    min: [...min],
    max: [...max],
    w: max[0] - min[0],
    d: max[1] - min[1],
    h: max[2] - min[2]
  };
}

function leafPid(entityPath) {
  return entityPath.slice('pid:'.length).split('.').at(-1);
}

async function runCliOfflineFixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-real-model-reliability-plan-'));
  try {
    await fs.mkdir(path.join(root, 'evidence'));
    const inventoryPath = 'evidence/candidate-inventory.json';
    const inventoryHash = await writeJson(root, inventoryPath, context.candidateInventory);
    const targetReview = structuredClone(context.targetReview);
    targetReview.inventory.sha256 = `sha256:${inventoryHash}`;
    const targetPath = 'evidence/target-review.json';
    const targetHash = await writeJson(root, targetPath, targetReview);
    const mapping = mappingFixture({ candidateInventoryHash: inventoryHash, targetReviewHash: targetHash });
    const mappingPath = 'evidence/semantic-mapping.json';
    await writeJson(root, mappingPath, mapping);
    const recursivePath = 'evidence/recursive-review.json';
    await writeJson(root, recursivePath, context.recursiveReview);
    const requestPath = 'request.json';
    await writeJson(root, requestPath, {
      version: 'real-model-reliability-plan-request.v1',
      case_id: 'product-boolean-manifold',
      candidate_id: CANDIDATE_ID,
      evidence: {
        candidate_inventory: inventoryPath,
        semantic_mapping: mappingPath,
        target_review: targetPath,
        recursive_review: recursivePath
      },
      model_revision: context.modelRevision,
      server_recommended_proposal: context.recursiveReview.review.recommended_proposal,
      allowed_output_root: 'output/staged'
    });
    const stateDir = path.join(root, 'state-must-not-exist');
    const child = await execFileAsync(process.execPath, [
      path.join(repoRoot, 'scripts/prepare-real-model-reliability-case.mjs'),
      '--request', requestPath
    ], {
      cwd: root,
      env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: stateDir }
    });
    const stdout = JSON.parse(child.stdout);
    const output = JSON.parse(await fs.readFile(
      path.join(root, 'output/staged/real-model-reliability-execution-plan.v3.json'),
      'utf8'
    ));
    return {
      stdout,
      output,
      queueStateCreated: await exists(stateDir)
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeJson(root, relativePath, value) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(path.join(root, relativePath), bytes);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
