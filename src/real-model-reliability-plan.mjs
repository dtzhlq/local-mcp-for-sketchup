import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { classifyBoundingBoxRelation } from './real-model-recursive-target-review.mjs';

export const REAL_MODEL_RELIABILITY_EXECUTION_PLAN_VERSION = 'real-model-reliability-execution-plan.v3';
export const DEFAULT_REAL_MODEL_RELIABILITY_PLAN_OUTPUT_ROOT = 'output/real-model-reliability/staged-execution';
export const REAL_MODEL_RELIABILITY_PLAN_FILE = 'real-model-reliability-execution-plan.v3.json';

const CASE_ID = 'product-boolean-manifold';
const SOURCE_ROLE_PROVENANCE = 'server_geometric_ranking_untrusted_unapproved';
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CANDIDATE_ID_PATTERN = /^candidate_[0-9a-f]{24}$/;
const CANDIDATE_HANDLE_PATTERN = /^candidate:sha256:[0-9a-f]{24}$/;
const PID_PATTERN = /^[1-9][0-9]*$/;
const OCCURRENCE_PATH_PATTERN = /^pid:[1-9][0-9]*(?:\.[1-9][0-9]*)*$/;
const EXACT_SOLID_OVERLAP_PENDING = Object.freeze({
  status: 'unverified_before_atomic_trial',
  verified: false,
  verification_stage: 'review_gated_atomic_apply'
});
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build a deterministic, offline-only execution plan for one real-model case.
 * A successful v3 result is still non-executable: bbox overlap is only a broad
 * phase signal. Exact solid overlap may be learned only inside a review-gated
 * atomic trial, and S3 mutation still requires a fresh Session Contract plus a
 * trusted local approval decision. No credential material is accepted or
 * emitted by this contract.
 */
export async function prepareRealModelReliabilityExecutionPlan({
  candidateInventory,
  candidateId,
  semanticMapping,
  targetReview,
  recursiveReview,
  evidenceBindings,
  modelRevision,
  serverRecommendedProposal,
  allowedOutputRoot = DEFAULT_REAL_MODEL_RELIABILITY_PLAN_OUTPUT_ROOT,
  now = () => new Date()
} = {}) {
  const bindings = normalizeEvidenceBindings(evidenceBindings);
  const candidate = selectSourceCandidate(candidateInventory, candidateId);
  assertSourceCandidate(candidate);
  assertMappingBinding({ semanticMapping, candidate, bindings });
  assertTargetReviewBinding({ targetReview, candidate, bindings });
  const revision = normalizeAndVerifyRevision({ modelRevision, targetReview, recursiveReview });
  assertRecursiveReviewEnvelope({ recursiveReview, candidate, revision });
  const outputRoot = normalizeAllowedOutputRoot(allowedOutputRoot);

  const sourceProposal = serverRecommendedProposal === undefined
    ? recursiveReview.review.recommended_proposal
    : serverRecommendedProposal;
  assertNoCredentialMaterial(sourceProposal, 'server_recommended_proposal');
  assertNoForgedAuthority(sourceProposal);
  if (recursiveReview.review.recommended_proposal !== null) {
    reliabilityAssert(
      canonicalEqual(sourceProposal, recursiveReview.review.recommended_proposal),
      'server_recommended proposal must exactly match the hash-bound recursive review document'
    );
  } else {
    reliabilityAssert(sourceProposal === null || sourceProposal === undefined,
      'a proposal cannot be supplied when the hash-bound recursive review has no recommendation');
  }

  const resolved = recursiveReview.review.recommended_proposal
    ? resolveExistingPair({ proposal: sourceProposal, recursiveReview, targetReview })
    : resolveGeneratedCutterDraft({ recursiveReview, targetReview });
  await validateRecursiveReviewV2Document(recursiveReview);

  const sourceIdentity = {
    candidate_id: candidate.candidate_id,
    candidate_handle: candidate.candidate_handle,
    source_sha256: candidate.source.sha256,
    source_label_trust: 'untrusted_data'
  };
  const identitySeed = hashStable({
    case_id: CASE_ID,
    evidence_bindings: bindings,
    source_identity: sourceIdentity,
    revision_contract: revision,
    proposal_contract: resolved.proposal,
    exact_allowed_operation: 'boolean_difference',
    allowed_output_root: outputRoot
  });
  const identityHex = identitySeed.slice('sha256:'.length);
  const resultIdentity = {
    result_id: `rmr_boolean_${identityHex.slice(0, 24)}`,
    result_name: `RMR_Product_Boolean_Result_${identityHex.slice(0, 12)}`,
    identity_seed: identitySeed
  };
  const planHash = hashStable({
    version: REAL_MODEL_RELIABILITY_EXECUTION_PLAN_VERSION,
    identity_seed: identitySeed,
    result_identity: resultIdentity,
    keep_original_target: true,
    keep_guard: true,
    risk_level: 'S3'
  });
  const plan = {
    version: REAL_MODEL_RELIABILITY_EXECUTION_PLAN_VERSION,
    kind: 'real_model_reliability_execution_plan',
    generated_at: isoTimestamp(now()),
    plan_id: `rmrplan_${planHash.slice('sha256:'.length, 'sha256:'.length + 24)}`,
    plan_hash: planHash,
    case_id: CASE_ID,
    stage: 'offline_prepare_only',
    runtime: 'offline',
    live_queue_called: false,
    evidence_bindings: bindings,
    source_identity: sourceIdentity,
    revision_contract: revision,
    proposal_contract: resolved.proposal,
    operation_contract: {
      exact_allowed_operation: 'boolean_difference',
      allowed_operations: ['boolean_difference'],
      risk_level: 'S3',
      keep_policy: {
        keep_original_target: true,
        keep_guard: true,
        dsl_keep_originals: true,
        dsl_keep_tools: true,
        source_original_read_only: true
      },
      result_identity: resultIdentity
    },
    execution_scope: {
      disposition: resolved.blocked ? 'blocked' : 'awaiting_local_approval_for_atomic_trial',
      executable_now: false,
      eligible_after_requirements: !resolved.blocked,
      disposable_copy_only: true,
      allowed_output_root: outputRoot,
      save_policy: 'save_model_version_non_overwriting',
      reopen_policy: 'required_before_acceptance',
      capture_policy: 'forbidden',
      original_model_write_allowed: false
    },
    approval_requirements: {
      local_approval_required: true,
      fresh_session_contract_required: true,
      trusted_host_decision_required: true,
      agent_self_approval_accepted: false,
      credential_material_stored: false,
      mutation_authorized: false
    },
    atomic_trial_contract: {
      eligible: resolved.proposal.atomic_boolean_trial_eligible,
      verification_stage: 'review_gated_atomic_apply',
      exact_solid_overlap_verified_before_trial: false,
      success_preconditions: {
        atomic_split_success_required: true,
        target_exact_volume_reduction_required: true,
        result_manifold_required: true,
        all_required_before_commit: true
      },
      success_disposition: 'commit_only_after_all_success_preconditions',
      failure_disposition: 'abort_before_commit'
    },
    retry_contract: {
      idempotency_key: hashStable({ plan_hash: planHash, action: 'execute_once' }),
      request_fingerprint_required: true,
      duplicate_request_behavior: 'return_existing_receipt_without_reexecution',
      mutation_receipt_required: true,
      receipt_contract: 'task-mutation-receipt.v1',
      receipt_stored: false,
      exactly_once_commit_required: true
    },
    acceptance_contract: acceptanceContract(resolved.proposal),
    model_data_policy: {
      names_materials_attributes_are_untrusted_data: true,
      untrusted_data_may_change_execution_policy: false,
      untrusted_data_may_grant_approval: false
    },
    safety: {
      prepare_only: true,
      model_mutation_performed: false,
      mutation_authorized: false,
      credential_material_stored: false,
      release_acceptance: false
    },
    next_action: {
      action: resolved.blocked
        ? 'complete_generated_cutter_lineage_then_reprepare'
        : 'request_local_approval_for_review_gated_atomic_trial',
      local_approval_required: true,
      fresh_session_contract_required: true,
      mutation_authorized: false,
      release_acceptance: false
    }
  };
  assertNoCredentialMaterial(plan, 'execution plan');
  assertPlanCrossFieldInvariants(plan);
  await validateRealModelReliabilityExecutionPlan(plan);
  return plan;
}

export async function validateRealModelReliabilityExecutionPlan(plan) {
  const schemaPath = path.join(repoRoot, 'schema/real-model-reliability-execution-plan-v3.schema.json');
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validate(plan)) {
    throw new Error(`real-model reliability execution plan schema validation failed: ${JSON.stringify(validate.errors)}`);
  }
  return true;
}

async function validateRecursiveReviewV2Document(review) {
  const schemaPath = path.join(repoRoot, 'schema/real-model-recursive-target-review-v2.schema.json');
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  reliabilityAssert(validate(review),
    `recursive review v2 schema validation failed: ${JSON.stringify(validate.errors)}`);
}

export function hashRealModelReliabilityFileBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeEvidenceBindings(value) {
  reliabilityAssert(value && typeof value === 'object' && !Array.isArray(value), 'evidenceBindings is required');
  const result = {};
  for (const key of ['candidate_inventory', 'semantic_mapping', 'target_review', 'recursive_review']) {
    const binding = value[key];
    reliabilityAssert(binding && typeof binding === 'object' && !Array.isArray(binding), `evidenceBindings.${key} is required`);
    const bindingPath = normalizeSafeRelativePath(binding.path, `evidenceBindings.${key}.path`);
    reliabilityAssert(RAW_SHA256_PATTERN.test(String(binding.sha256 || '')),
      `evidenceBindings.${key}.sha256 must be 64 lowercase hex characters`);
    result[key] = { path: bindingPath, sha256: binding.sha256 };
  }
  return result;
}

function selectSourceCandidate(inventory, candidateId) {
  reliabilityAssert(inventory?.version === 'real-model-candidate-inventory.v1', 'unsupported candidate inventory version');
  reliabilityAssert(inventory?.kind === 'real_model_candidate_inventory', 'unsupported candidate inventory kind');
  reliabilityAssert(inventory?.policy?.live_queue_called === false, 'candidate inventory must be offline');
  reliabilityAssert(inventory?.policy?.model_content_is_untrusted_data === true, 'candidate inventory must mark model content as untrusted');
  reliabilityAssert(inventory?.policy?.formal_corpus_acceptance === false, 'candidate inventory cannot grant corpus acceptance');
  reliabilityAssert(CANDIDATE_ID_PATTERN.test(String(candidateId || '')), 'candidateId is invalid');
  const matches = (inventory.candidates || []).filter((entry) => entry?.candidate_id === candidateId);
  reliabilityAssert(matches.length === 1, `candidate inventory must contain exactly one ${candidateId}`);
  return matches[0];
}

function assertSourceCandidate(candidate) {
  reliabilityAssert(CANDIDATE_ID_PATTERN.test(String(candidate?.candidate_id || '')), 'source candidate_id is invalid');
  reliabilityAssert(CANDIDATE_HANDLE_PATTERN.test(String(candidate?.candidate_handle || '')), 'source candidate_handle is invalid');
  assertSha256(candidate?.source?.sha256, 'source candidate sha256');
  reliabilityAssert(candidate?.trust?.classification === 'untrusted_data', 'source candidate content must remain untrusted');
  reliabilityAssert(candidate?.trust?.may_influence_execution_policy === false, 'source candidate cannot influence execution policy');
  reliabilityAssert(candidate?.trust?.may_grant_approval === false, 'source candidate cannot grant approval');
  reliabilityAssert(candidate?.intake?.original_modified === false, 'source candidate original must be unchanged');
}

function assertMappingBinding({ semanticMapping, candidate, bindings }) {
  reliabilityAssert(
    semanticMapping?.version === 'real-model-candidate-semantic-mapping-amendment.v1'
      && semanticMapping?.kind === 'real_model_candidate_semantic_mapping_amendment',
    'semantic mapping must be the product candidate amendment v1'
  );
  reliabilityAssert(semanticMapping?.decision_scope === 'semantic_candidate_mapping_addition_only',
    'semantic mapping scope must remain addition only');
  const authority = semanticMapping?.authority || {};
  reliabilityAssert(authority.mutation_authorized === false, 'semantic mapping cannot authorize mutation');
  reliabilityAssert(authority.approval_token_issued === false, 'semantic mapping cannot issue approval');
  reliabilityAssert(authority.execution_policy_changed === false, 'semantic mapping cannot change execution policy');
  reliabilityAssert(authority.target_roles_confirmed === false, 'semantic mapping cannot confirm target roles');
  reliabilityAssert(authority.model_content_trust === 'untrusted_data', 'semantic mapping must retain untrusted model content');
  const addition = semanticMapping.addition || {};
  reliabilityAssert(addition.candidate_id === candidate.candidate_id, 'semantic mapping candidate_id drift');
  reliabilityAssert(addition.candidate_handle === candidate.candidate_handle, 'semantic mapping candidate_handle drift');
  reliabilityAssert(addition.source_sha256 === candidate.source.sha256, 'semantic mapping source sha256 drift');
  reliabilityAssert(Array.isArray(addition.assignments) && addition.assignments.length === 1,
    'semantic mapping must contain one product assignment');
  reliabilityAssert(addition.assignments[0]?.case_id === CASE_ID && addition.assignments[0]?.review_status === 'user_confirmed',
    'semantic mapping must bind the confirmed product case');
  reliabilityAssert(semanticMapping?.bindings?.candidate_inventory?.sha256 === bindings.candidate_inventory.sha256,
    'semantic mapping candidate_inventory evidence hash drift');
  reliabilityAssert(semanticMapping?.bindings?.target_review?.sha256 === bindings.target_review.sha256,
    'semantic mapping target_review evidence hash drift');
  reliabilityAssert(semanticMapping?.target_review_disposition?.selection_authority_granted === false,
    'semantic mapping cannot grant target selection authority');
}

function assertTargetReviewBinding({ targetReview, candidate, bindings }) {
  reliabilityAssert(targetReview?.version === 'real-model-target-review.v2', 'unsupported target review version');
  reliabilityAssert(targetReview?.kind === 'real_model_target_review', 'unsupported target review kind');
  reliabilityAssert(targetReview?.source?.candidate_id === candidate.candidate_id, 'target review candidate_id drift');
  reliabilityAssert(targetReview?.source?.candidate_handle === candidate.candidate_handle, 'target review candidate_handle drift');
  reliabilityAssert(targetReview?.source?.sha256 === candidate.source.sha256, 'target review source sha256 drift');
  reliabilityAssert(targetReview?.inventory?.sha256 === `sha256:${bindings.candidate_inventory.sha256}`,
    'target review candidate inventory hash drift');
  reliabilityAssert(targetReview?.runtime === 'queue' && targetReview?.live_queue_called === true,
    'target review must disclose its historical read-only live observation');
  reliabilityAssert(targetReview?.safety?.read_only_adoption === true, 'target review must use read-only adoption');
  reliabilityAssert(targetReview?.safety?.disposable_copy_only === true, 'target review must use a disposable copy');
  reliabilityAssert(targetReview?.safety?.model_content_mutation_requested === false, 'target review cannot request mutation');
  reliabilityAssert(targetReview?.safety?.save_requested === false, 'target review cannot save');
  reliabilityAssert(targetReview?.next_action?.mutation_authorized === false, 'target review cannot authorize mutation');
  reliabilityAssert(targetReview?.next_action?.release_acceptance === false, 'target review cannot grant release acceptance');
}

function normalizeAndVerifyRevision({ modelRevision, targetReview, recursiveReview }) {
  reliabilityAssert(modelRevision && typeof modelRevision === 'object' && !Array.isArray(modelRevision),
    'modelRevision is required');
  const revision = {
    strategy: String(modelRevision.strategy || ''),
    hash: String(modelRevision.hash || ''),
    complete: modelRevision.complete === true,
    unique_entity_limit: safePositiveInteger(modelRevision.unique_entity_limit, 'modelRevision.unique_entity_limit'),
    unique_entities: safeCount(modelRevision.unique_entities, 'modelRevision.unique_entities'),
    reachable_definitions: safeCount(modelRevision.reachable_definitions, 'modelRevision.reachable_definitions'),
    logical_occurrences: safeCount(modelRevision.logical_occurrences, 'modelRevision.logical_occurrences'),
    document_id: boundedIdentifier(modelRevision.document_id, 'modelRevision.document_id'),
    model_identity_sha256: String(modelRevision.model_identity_sha256 || ''),
    model_revision_source_sha256: String(modelRevision.model_revision_source_sha256 || ''),
    model_modified: modelRevision.model_modified
  };
  reliabilityAssert(revision.strategy === 'definition-merkle.v2', 'model revision strategy is not allowed');
  assertSha256(revision.hash, 'model revision hash');
  reliabilityAssert(revision.complete, 'model revision must be complete');
  assertSha256(revision.model_identity_sha256, 'model identity sha256');
  reliabilityAssert(RAW_SHA256_PATTERN.test(revision.model_revision_source_sha256),
    'model revision source sha256 must be 64 lowercase hex characters');
  reliabilityAssert(typeof revision.model_modified === 'boolean', 'modelRevision.model_modified must be a boolean');
  reliabilityAssert(revision.unique_entities <= revision.unique_entity_limit, 'model revision unique entity count exceeds its limit');
  const attestation = targetReview?.revision_attestation || {};
  reliabilityAssert(attestation.complete === true && attestation.unchanged === true,
    'target review revision must be complete and unchanged');
  reliabilityAssert(attestation.before === revision.hash && attestation.adoption === revision.hash && attestation.after === revision.hash,
    'model revision hash drift between target review stages');
  reliabilityAssert(targetReview?.sketchup?.model_revision_strategy === revision.strategy,
    'model revision strategy drift');
  reliabilityAssert(targetReview?.sketchup?.model_revision_unique_entity_limit === revision.unique_entity_limit,
    'model revision unique entity limit drift');
  assertNullableRevisionField(
    targetReview?.sketchup?.model_revision_source_sha256,
    revision.model_revision_source_sha256,
    'model revision source sha256 drift'
  );
  assertNullableRevisionField(
    targetReview?.revision_attestation?.model_modified,
    revision.model_modified,
    'model modified state drift'
  );
  reliabilityAssert(attestation.unique_entities === revision.unique_entities, 'model revision unique entity count drift');
  reliabilityAssert(attestation.reachable_definitions === revision.reachable_definitions,
    'model revision reachable definition count drift');
  reliabilityAssert(attestation.logical_occurrences === revision.logical_occurrences,
    'model revision logical occurrence count drift');
  reliabilityAssert(recursiveReview?.model?.revision === revision.hash, 'recursive review model revision drift');
  reliabilityAssert(recursiveReview?.model?.document_id === revision.document_id, 'recursive review document_id drift');
  reliabilityAssert(recursiveReview?.model?.model_identity_sha256 === revision.model_identity_sha256,
    'recursive review model identity hash drift');
  assertNullableRevisionField(
    recursiveReview?.model?.model_revision_source_sha256,
    revision.model_revision_source_sha256,
    'recursive review model revision source sha256 drift'
  );
  assertNullableRevisionField(
    recursiveReview?.model?.model_modified,
    revision.model_modified,
    'recursive review model modified state drift'
  );
  return revision;
}

function assertRecursiveReviewEnvelope({ recursiveReview, candidate, revision }) {
  reliabilityAssert(recursiveReview?.version === 'real-model-recursive-target-review.v2',
    'unsupported recursive review version; reliability plan v3 requires recursive review v2');
  reliabilityAssert(recursiveReview?.kind === 'real_model_recursive_target_review',
    'unsupported recursive review kind');
  reliabilityAssert(recursiveReview?.runtime === 'offline' && recursiveReview?.live_queue_called === false,
    'recursive review must be offline');
  reliabilityAssert(recursiveReview?.source?.sha256 === candidate.source.sha256,
    'recursive review source sha256 drift');
  reliabilityAssert(recursiveReview?.model?.revision === revision.hash, 'recursive review revision drift');
  reliabilityAssert(recursiveReview?.model?.revision_complete === true,
    'recursive review revision must be complete');
  assertNullableRevisionField(recursiveReview?.model?.revision_strategy, revision.strategy,
    'recursive review revision strategy drift');
  assertNullableRevisionField(recursiveReview?.model?.revision_unique_entity_limit, revision.unique_entity_limit,
    'recursive review unique entity limit drift');
  assertNullableRevisionField(recursiveReview?.model?.revision_unique_entities, revision.unique_entities,
    'recursive review unique entity count drift');
  assertNullableRevisionField(recursiveReview?.model?.revision_reachable_definitions, revision.reachable_definitions,
    'recursive review reachable definition count drift');
  assertNullableRevisionField(recursiveReview?.model?.revision_logical_occurrences, revision.logical_occurrences,
    'recursive review logical occurrence count drift');
  reliabilityAssert(recursiveReview?.safety?.analysis_only === true, 'recursive review must be analysis only');
  reliabilityAssert(recursiveReview?.safety?.queue_accessed === false, 'recursive review cannot access queue');
  reliabilityAssert(recursiveReview?.safety?.model_mutation_authorized === false,
    'recursive review cannot authorize mutation');
  reliabilityAssert(recursiveReview?.safety?.target_roles_confirmed === false,
    'recursive review cannot confirm roles');
  reliabilityAssert(recursiveReview?.review?.role_bindings === null,
    'recursive review cannot issue role bindings');
  reliabilityAssert(recursiveReview?.next_action?.mutation_authorized === false,
    'recursive review next action cannot authorize mutation');
  reliabilityAssert(recursiveReview?.next_action?.release_acceptance === false,
    'recursive review cannot grant release acceptance');
  reliabilityAssert(Array.isArray(recursiveReview?.review?.candidates), 'recursive review candidates are required');
}

function resolveExistingPair({ proposal, recursiveReview, targetReview }) {
  reliabilityAssert(recursiveReview.review.status === 'server_recommended',
    'recursive review roles are not server_recommended');
  reliabilityAssert(proposal?.status === 'server_recommended', 'proposal roles are not server_recommended');
  reliabilityAssert(proposal?.role_provenance === SOURCE_ROLE_PROVENANCE,
    'proposal role provenance is not server_recommended');
  reliabilityAssert(proposal?.confirmed === false && proposal?.authorized === false,
    'server recommendation cannot claim confirmation or authorization');
  reliabilityAssert(proposal?.trusted_approval_required === true,
    'server recommendation must require trusted approval');
  reliabilityAssert(proposal?.operation === 'difference',
    'only the exact boolean_difference operation is allowed');
  reliabilityAssert(['collision', 'containment'].includes(proposal?.bbox_relation),
    'existing-pair plan requires collision or containment; contact/disjoint fail closed');
  reliabilityAssert(proposal?.positive_bbox_overlap === true,
    'existing-pair plan requires positive bbox overlap');
  assertPendingExactSolidOverlap(proposal?.exact_solid_overlap, 'proposal exact_solid_overlap');
  reliabilityAssert(proposal?.atomic_boolean_trial_eligible === true,
    'existing-pair plan requires atomic boolean trial eligibility');
  const pair = findExactRecommendedPair(recursiveReview.review.pair_evaluations, proposal);
  reliabilityAssert(pair, 'proposal is not backed by an exact server_recommended pair evaluation');
  reliabilityAssert(pair.both_fresh_manifold === true && pair.atomic_boolean_trial_eligible === true,
    'existing-pair plan requires exact fresh manifold attestations and atomic trial eligibility');
  assertPendingExactSolidOverlap(pair.exact_solid_overlap, 'pair exact_solid_overlap');
  const target = normalizeEndpoint(proposal.target, 'target', recursiveReview, targetReview, { requireTopLevelBinding: false });
  const guard = normalizeEndpoint(proposal.tool, 'guard', recursiveReview, targetReview, { requireTopLevelBinding: false });
  assertDistinctAndSameScope({ target, guard, proposal, recursiveReview });
  const scopeInstancePolicy = deriveScopeInstancePolicy({ target, guard, proposal, recursiveReview });
  const bboxContract = assertBBoxContract({ target, guard, proposal, pair });
  return {
    blocked: false,
    proposal: {
      strategy: 'existing_pair',
      status: 'server_recommended',
      role_authority: 'server_recommended',
      source_role_provenance: SOURCE_ROLE_PROVENANCE,
      scope_path: proposal.scope_path,
      parent_entity_path: proposal.parent_entity_path ?? null,
      scope_instance_policy: scopeInstancePolicy,
      ...bboxContract,
      exact_solid_overlap: structuredClone(EXACT_SOLID_OVERLAP_PENDING),
      atomic_boolean_trial_eligible: true,
      target,
      guard,
      generated_cutter_lineage: {
        required: false,
        status: 'not_applicable',
        complete: false
      }
    }
  };
}

function resolveGeneratedCutterDraft({ recursiveReview, targetReview }) {
  reliabilityAssert(recursiveReview.review.status === 'blocked',
    'generated-cutter fallback is allowed only when recursive review has no executable recommendation');
  reliabilityAssert(recursiveReview.review.recommended_proposal === null,
    'generated-cutter fallback cannot replace an existing recommendation');
  const topLevel = targetReview?.target_review?.candidates || [];
  reliabilityAssert(topLevel.length >= 2, 'generated-cutter draft requires A and B target-review candidates');
  const recursiveCandidates = recursiveReview.review.candidates;
  const candidateA = recursiveCandidateForTargetReview(topLevel[0], recursiveCandidates, 'A');
  const candidateB = recursiveCandidateForTargetReview(topLevel[1], recursiveCandidates, 'B');
  const target = normalizeEndpoint(candidateEndpoint(candidateA), 'target', recursiveReview, targetReview, { requireTopLevelBinding: true });
  const guard = normalizeEndpoint(candidateEndpoint(candidateB), 'guard', recursiveReview, targetReview, { requireTopLevelBinding: true });
  const proposal = {
    scope_path: candidateA.scope_path,
    parent_entity_path: candidateA.parent_entity_path ?? null
  };
  assertDistinctAndSameScope({ target, guard, proposal, recursiveReview });
  const scopeInstancePolicy = deriveScopeInstancePolicy({ target, guard, proposal, recursiveReview });
  const spatial = classifyBoundingBoxRelation(target.bounding_box, guard.bounding_box);
  const targetBBoxVolume = boundingBoxVolume(target.bounding_box);
  const guardBBoxVolume = boundingBoxVolume(guard.bounding_box);
  return {
    blocked: true,
    proposal: {
      strategy: 'generated_cutter',
      status: 'blocked_generated_cutter_lineage',
      role_authority: 'server_recommended',
      source_role_provenance: SOURCE_ROLE_PROVENANCE,
      scope_path: proposal.scope_path,
      parent_entity_path: proposal.parent_entity_path,
      scope_instance_policy: scopeInstancePolicy,
      bbox_relation: spatial.bbox_relation,
      bbox_containment_direction: directedContainmentDirection(spatial.bbox_containment_direction),
      bbox_axis_overlaps: spatial.bbox_axis_overlaps,
      positive_bbox_overlap: spatial.positive_bbox_overlap,
      bbox_overlap_bounding_box: spatial.bbox_overlap_bounding_box,
      bbox_overlap_volume: spatial.bbox_overlap_volume,
      target_bbox_volume: targetBBoxVolume,
      tool_bbox_volume: guardBBoxVolume,
      exact_solid_overlap: structuredClone(EXACT_SOLID_OVERLAP_PENDING),
      atomic_boolean_trial_eligible: false,
      target,
      guard,
      generated_cutter_lineage: {
        required: true,
        status: 'blocked_missing_composite_generated_target_lineage',
        complete: false
      }
    }
  };
}

function normalizeEndpoint(value, role, recursiveReview, targetReview, { requireTopLevelBinding }) {
  reliabilityAssert(value && typeof value === 'object' && !Array.isArray(value), `${role} endpoint is required`);
  const occurrencePath = String(value.occurrence_path || '');
  reliabilityAssert(OCCURRENCE_PATH_PATTERN.test(occurrencePath), `${role} occurrence_path is not canonical`);
  reliabilityAssert(value.entity_path === occurrencePath, `${role} entity_path must exactly equal occurrence_path`);
  const persistentId = String(value.persistent_id || '');
  reliabilityAssert(PID_PATTERN.test(persistentId), `${role} persistent_id is invalid`);
  reliabilityAssert(leafPersistentId(occurrencePath) === persistentId,
    `${role} persistent_id does not match occurrence_path`);
  assertSha256(value.entity_fingerprint, `${role} entity_fingerprint`);
  const boundingBox = normalizeBoundingBox(value.bounding_box, `${role} bounding_box`);
  assertSha256(value.bounding_box_sha256, `${role} bounding_box_sha256`);
  reliabilityAssert(hashStable(boundingBox) === value.bounding_box_sha256, `${role} bounding box hash drift`);
  reliabilityAssert(value?.display?.trust === 'untrusted_data', `${role} material must remain untrusted data`);
  const material = normalizeMaterial(value.display.material, `${role} material`);
  assertSha256(value.material_expectation_sha256, `${role} material expectation sha256`);
  reliabilityAssert(
    hashStable({ material, trust: 'untrusted_data' }) === value.material_expectation_sha256,
    `${role} material expectation hash drift`
  );
  const candidate = (recursiveReview.review.candidates || []).find((entry) => entry.occurrence_path === occurrencePath);
  reliabilityAssert(candidate, `${role} occurrence is missing from recursive review candidates`);
  reliabilityAssert(candidate.persistent_id === persistentId, `${role} PID drift from recursive candidate`);
  reliabilityAssert(candidate.entity_fingerprint === value.entity_fingerprint,
    `${role} entity fingerprint drift from recursive candidate`);
  reliabilityAssert(candidate.bounding_box_sha256 === value.bounding_box_sha256,
    `${role} bbox hash drift from recursive candidate`);
  reliabilityAssert(candidate.material_expectation_sha256 === value.material_expectation_sha256,
    `${role} material expectation hash drift from recursive candidate`);
  reliabilityAssert(canonicalEqual(candidate.world_bounding_box, boundingBox),
    `${role} bbox drift from recursive candidate`);
  reliabilityAssert(candidate.display?.material === material, `${role} material drift from recursive candidate`);
  const topLevel = (targetReview?.target_review?.candidates || []).filter((entry) => entry.entity_path === occurrencePath);
  reliabilityAssert(topLevel.length <= 1, `${role} occurrence is duplicated in target review`);
  if (requireTopLevelBinding) {
    reliabilityAssert(topLevel.length === 1, `${role} occurrence must resolve exactly once in target review`);
  }
  if (topLevel.length === 1) {
    reliabilityAssert(topLevel[0].persistent_id === persistentId, `${role} PID drift from target review`);
    reliabilityAssert(canonicalEqual(topLevel[0].bounding_box, boundingBox), `${role} bbox drift from target review`);
    reliabilityAssert(topLevel[0].display?.material === material, `${role} material drift from target review`);
    reliabilityAssert(topLevel[0].display?.trust === 'untrusted_data', `${role} target-review material trust drift`);
  }
  return {
    role,
    occurrence_path: occurrencePath,
    persistent_id: persistentId,
    entity_type: 'group',
    entity_fingerprint: value.entity_fingerprint,
    bounding_box: boundingBox,
    bounding_box_sha256: value.bounding_box_sha256,
    material_expectation_sha256: value.material_expectation_sha256,
    material_expectation: {
      value: material,
      trust: 'untrusted_data',
      preserve_exactly: true
    }
  };
}

function assertDistinctAndSameScope({ target, guard, proposal, recursiveReview }) {
  reliabilityAssert(target.occurrence_path !== guard.occurrence_path, 'target and guard occurrence paths must be distinct');
  reliabilityAssert(target.persistent_id !== guard.persistent_id, 'target and guard persistent IDs must be distinct');
  const targetCandidate = recursiveReview.review.candidates.find((entry) => entry.occurrence_path === target.occurrence_path);
  const guardCandidate = recursiveReview.review.candidates.find((entry) => entry.occurrence_path === guard.occurrence_path);
  reliabilityAssert(targetCandidate?.scope_path === guardCandidate?.scope_path,
    'target and guard are in different Entities scopes');
  reliabilityAssert((targetCandidate?.parent_entity_path ?? null) === (guardCandidate?.parent_entity_path ?? null),
    'target and guard have different parent occurrence paths');
  reliabilityAssert(proposal.scope_path === targetCandidate.scope_path, 'proposal scope_path drift');
  reliabilityAssert((proposal.parent_entity_path ?? null) === (targetCandidate.parent_entity_path ?? null),
    'proposal parent_entity_path drift');
}

function assertBBoxContract({ target, guard, proposal, pair }) {
  const spatial = classifyBoundingBoxRelation(target.bounding_box, guard.bounding_box);
  const containmentDirection = directedContainmentDirection(spatial.bbox_containment_direction);
  const targetBBoxVolume = boundingBoxVolume(target.bounding_box);
  const guardBBoxVolume = boundingBoxVolume(guard.bounding_box);
  reliabilityAssert(spatial.bbox_relation === proposal.bbox_relation, 'proposal bbox relation drift');
  reliabilityAssert(spatial.positive_bbox_overlap === proposal.positive_bbox_overlap,
    'proposal positive bbox overlap drift');
  reliabilityAssert(canonicalEqual(spatial.bbox_overlap_bounding_box, proposal.bbox_overlap_bounding_box),
    'proposal bbox overlap bounding box drift');
  reliabilityAssert(spatial.bbox_overlap_volume === proposal.bbox_overlap_volume,
    'proposal bbox overlap volume drift');
  reliabilityAssert(pair.bbox_relation === spatial.bbox_relation, 'pair bbox relation drift');
  reliabilityAssert(pair.bbox_containment_direction === containmentDirection,
    'pair bbox containment direction drift');
  reliabilityAssert(canonicalEqual(pair.bbox_axis_overlaps, spatial.bbox_axis_overlaps),
    'pair bbox axis overlaps drift');
  reliabilityAssert(pair.positive_bbox_overlap === spatial.positive_bbox_overlap,
    'pair positive bbox overlap drift');
  reliabilityAssert(canonicalEqual(pair.bbox_overlap_bounding_box, spatial.bbox_overlap_bounding_box),
    'pair bbox overlap bounding box drift');
  reliabilityAssert(pair.bbox_overlap_volume === spatial.bbox_overlap_volume,
    'pair bbox overlap volume drift');
  reliabilityAssert(pair.target_bbox_volume === targetBBoxVolume, 'pair target bbox volume drift');
  reliabilityAssert(pair.tool_bbox_volume === guardBBoxVolume, 'pair tool bbox volume drift');
  return {
    bbox_relation: spatial.bbox_relation,
    bbox_containment_direction: containmentDirection,
    bbox_axis_overlaps: [...spatial.bbox_axis_overlaps],
    positive_bbox_overlap: spatial.positive_bbox_overlap,
    bbox_overlap_bounding_box: structuredClone(spatial.bbox_overlap_bounding_box),
    bbox_overlap_volume: spatial.bbox_overlap_volume,
    target_bbox_volume: targetBBoxVolume,
    tool_bbox_volume: guardBBoxVolume
  };
}

function deriveScopeInstancePolicy({ target, guard, proposal, recursiveReview }) {
  const targetCandidate = recursiveReview.review.candidates.find((entry) => entry.occurrence_path === target.occurrence_path);
  const guardCandidate = recursiveReview.review.candidates.find((entry) => entry.occurrence_path === guard.occurrence_path);
  const targetScope = normalizeCandidateInstanceScope(targetCandidate, 'target');
  const guardScope = normalizeCandidateInstanceScope(guardCandidate, 'guard');
  reliabilityAssert(targetScope.affected_instance_count === guardScope.affected_instance_count,
    'target and guard affected_instance_count drift within the same scope');
  reliabilityAssert(targetScope.shared_definition === guardScope.shared_definition,
    'target and guard shared_definition drift within the same scope');
  reliabilityAssert(targetScope.instance_policy_required === guardScope.instance_policy_required,
    'target and guard instance_policy_required drift within the same scope');
  const parentOccurrencePath = proposal.parent_entity_path ?? null;
  if (parentOccurrencePath === null) {
    reliabilityAssert(proposal.scope_path === 'model', 'top-level scope_path must be model');
    reliabilityAssert(targetScope.affected_instance_count === 1,
      'top-level scope must affect exactly one instance');
    reliabilityAssert(targetScope.shared_definition === false,
      'top-level scope cannot claim a shared definition');
    reliabilityAssert(targetScope.instance_policy_required === false,
      'top-level scope cannot require an instance policy');
    return {
      policy: 'top_level',
      parent_occurrence_path: null,
      affected_instance_count: 1,
      shared_definition: false,
      instance_policy_required: false
    };
  }
  reliabilityAssert(proposal.scope_path === parentOccurrencePath,
    'nested scope_path must equal parent occurrence path');
  reliabilityAssert(targetScope.instance_policy_required === true,
    'nested scope must explicitly require an instance policy');
  if (targetScope.affected_instance_count > 1) {
    reliabilityAssert(targetScope.shared_definition === true,
      'multi-instance nested scope must bind a shared definition');
    return {
      policy: 'make_unique',
      parent_occurrence_path: parentOccurrencePath,
      affected_instance_count: targetScope.affected_instance_count,
      shared_definition: true,
      instance_policy_required: true
    };
  }
  reliabilityAssert(targetScope.affected_instance_count === 1,
    'nested definition-wide scope must affect exactly one instance');
  return {
    policy: 'definition_wide',
    parent_occurrence_path: parentOccurrencePath,
    affected_instance_count: 1,
    shared_definition: targetScope.shared_definition,
    instance_policy_required: true
  };
}

function normalizeCandidateInstanceScope(candidate, role) {
  reliabilityAssert(candidate && typeof candidate === 'object', `${role} recursive candidate is missing`);
  const affectedInstanceCount = Number(candidate.affected_instance_count);
  reliabilityAssert(Number.isSafeInteger(affectedInstanceCount) && affectedInstanceCount >= 1,
    `${role} affected_instance_count must be a positive safe integer`);
  reliabilityAssert(typeof candidate.shared_definition === 'boolean', `${role} shared_definition must be boolean`);
  reliabilityAssert(typeof candidate.instance_policy_required === 'boolean',
    `${role} instance_policy_required must be boolean`);
  reliabilityAssert(candidate.shared_definition === (affectedInstanceCount > 1),
    `${role} shared_definition must exactly match affected_instance_count`);
  return {
    affected_instance_count: affectedInstanceCount,
    shared_definition: candidate.shared_definition,
    instance_policy_required: candidate.instance_policy_required
  };
}

function findExactRecommendedPair(pairs, proposal) {
  return (pairs || []).find((pair) => (
    pair.status === 'server_recommended'
    && pair.operation === proposal.operation
    && pair.scope_path === proposal.scope_path
    && (pair.parent_entity_path ?? null) === (proposal.parent_entity_path ?? null)
    && pair.bbox_relation === proposal.bbox_relation
    && pair.positive_bbox_overlap === proposal.positive_bbox_overlap
    && pair.bbox_overlap_volume === proposal.bbox_overlap_volume
    && canonicalEqual(pair.bbox_overlap_bounding_box, proposal.bbox_overlap_bounding_box)
    && canonicalEqual(pair.exact_solid_overlap, proposal.exact_solid_overlap)
    && pair.atomic_boolean_trial_eligible === proposal.atomic_boolean_trial_eligible
    && pair.role_provenance === proposal.role_provenance
    && pair.target?.occurrence_path === proposal.target?.occurrence_path
    && pair.tool?.occurrence_path === proposal.tool?.occurrence_path
    && pair.target?.entity_fingerprint === proposal.target?.entity_fingerprint
    && pair.tool?.entity_fingerprint === proposal.tool?.entity_fingerprint
    && pair.target?.bounding_box_sha256 === proposal.target?.bounding_box_sha256
    && pair.tool?.bounding_box_sha256 === proposal.tool?.bounding_box_sha256
    && pair.target?.material_expectation_sha256 === proposal.target?.material_expectation_sha256
    && pair.tool?.material_expectation_sha256 === proposal.tool?.material_expectation_sha256
    && pair.target?.display?.material === proposal.target?.display?.material
    && pair.tool?.display?.material === proposal.tool?.display?.material
  )) || null;
}

function recursiveCandidateForTargetReview(targetCandidate, recursiveCandidates, label) {
  const matches = recursiveCandidates.filter((entry) => (
    entry.occurrence_path === targetCandidate.entity_path
    && entry.persistent_id === targetCandidate.persistent_id
  ));
  reliabilityAssert(matches.length === 1, `generated-cutter ${label} must resolve exactly once in recursive review`);
  return matches[0];
}

function candidateEndpoint(candidate) {
  reliabilityAssert(candidate?.world_bounding_box && candidate?.bounding_box_sha256,
    'generated-cutter candidate requires a bound positive bounding box');
  return {
    occurrence_path: candidate.occurrence_path,
    entity_path: candidate.entity_path,
    persistent_id: candidate.persistent_id,
    entity_fingerprint: candidate.entity_fingerprint,
    bounding_box: candidate.world_bounding_box,
    bounding_box_sha256: candidate.bounding_box_sha256,
    material_expectation_sha256: candidate.material_expectation_sha256,
    display: {
      material: candidate.display?.material ?? null,
      trust: 'untrusted_data'
    }
  };
}

function acceptanceContract(proposal) {
  return {
    wrong_object: {
      original_target_must_remain_unchanged: proposal.target.occurrence_path,
      guard_must_remain_unchanged: proposal.guard.occurrence_path,
      only_new_result_identity_may_be_added: true,
      all_other_occurrences_unchanged: true,
      maximum_wrong_object_modifications: 0
    },
    silent_geometry_corruption: {
      maximum_silent_corruption_events: 0,
      complete_revision_before_after_required: true,
      structural_diff_required: true,
      rollback_on_failure: true
    },
    material_preservation: {
      original_target_material: proposal.target.material_expectation.value,
      result_material: proposal.target.material_expectation.value,
      guard_material: proposal.guard.material_expectation.value,
      exact_match_required: true
    },
    manifold: {
      fresh_target_and_guard_attestation_before_mutation: true,
      result_must_be_manifold: true,
      fail_on_non_manifold: true
    },
    save_reopen_identity: {
      non_overwriting_save_required: true,
      reopen_required: true,
      result_identity_must_resolve_once: true,
      complete_revision_after_reopen_required: true
    }
  };
}

function assertPlanCrossFieldInvariants(plan) {
  reliabilityAssert(plan.operation_contract.risk_level === 'S3', 'real-model boolean plan risk must remain S3');
  reliabilityAssert(plan.operation_contract.exact_allowed_operation === 'boolean_difference',
    'real-model plan operation must remain exact boolean_difference');
  reliabilityAssert(plan.execution_scope.executable_now === false, 'prepared plan cannot be executable now');
  reliabilityAssert(plan.approval_requirements.mutation_authorized === false,
    'prepared plan cannot authorize mutation');
  reliabilityAssert(plan.safety.release_acceptance === false, 'prepared plan cannot grant release acceptance');
  reliabilityAssert(plan.atomic_trial_contract.verification_stage === 'review_gated_atomic_apply',
    'atomic trial verification stage drift');
  reliabilityAssert(plan.atomic_trial_contract.exact_solid_overlap_verified_before_trial === false,
    'prepared plan cannot claim exact solid overlap before the atomic trial');
  reliabilityAssert(plan.atomic_trial_contract.success_preconditions.atomic_split_success_required === true,
    'atomic split must succeed before commit');
  reliabilityAssert(plan.atomic_trial_contract.success_preconditions.target_exact_volume_reduction_required === true,
    'target exact volume reduction must be observed before commit');
  reliabilityAssert(plan.atomic_trial_contract.success_preconditions.result_manifold_required === true,
    'a manifold result must be observed before commit');
  reliabilityAssert(plan.atomic_trial_contract.success_preconditions.all_required_before_commit === true,
    'all atomic trial success preconditions must hold before commit');
  reliabilityAssert(plan.atomic_trial_contract.failure_disposition === 'abort_before_commit',
    'failed atomic trial must abort before commit');
  if (plan.proposal_contract.strategy === 'generated_cutter') {
    reliabilityAssert(plan.execution_scope.disposition === 'blocked', 'generated cutter draft must remain blocked');
    reliabilityAssert(plan.execution_scope.eligible_after_requirements === false,
      'generated cutter draft cannot become executable without re-preparation');
    reliabilityAssert(plan.atomic_trial_contract.eligible === false,
      'generated cutter draft cannot be eligible for an atomic trial');
  } else {
    reliabilityAssert(plan.execution_scope.disposition === 'awaiting_local_approval_for_atomic_trial',
      'existing pair must await trusted local approval for an atomic trial');
    reliabilityAssert(plan.execution_scope.eligible_after_requirements === true,
      'existing pair must remain eligible only after approval requirements');
    reliabilityAssert(plan.atomic_trial_contract.eligible === true,
      'existing pair must remain eligible for a review-gated atomic trial');
    assertPendingExactSolidOverlap(plan.proposal_contract.exact_solid_overlap,
      'plan proposal exact_solid_overlap');
  }
}

function assertPendingExactSolidOverlap(value, label) {
  reliabilityAssert(value && typeof value === 'object' && !Array.isArray(value), `${label} is required`);
  reliabilityAssert(canonicalEqual(value, EXACT_SOLID_OVERLAP_PENDING),
    `${label} must remain unverified before the review-gated atomic trial`);
}

function assertNoForgedAuthority(value) {
  if (value === null || value === undefined) return;
  const forbiddenTruthy = new Set([
    'mutation_authorized', 'approval_granted', 'approved', 'user_approved',
    'selection_authority_granted', 'execution_policy_changed'
  ]);
  walkObject(value, (key, entry) => {
    if (forbiddenTruthy.has(key) && (entry === true || String(entry).toLowerCase() === 'approved')) {
      throw new Error(`server_recommended proposal contains forged authority field ${key}`);
    }
  });
}

function assertNoCredentialMaterial(value, label) {
  if (value === null || value === undefined) return;
  walkObject(value, (key, entry) => {
    if (/(?:token|secret|password|signature|cookie|hmac)/i.test(key)) {
      throw new Error(`${label} cannot contain credential material field ${key}`);
    }
    if (typeof entry === 'string' && /^(?:bearer\s+|hmac_sha256:)/i.test(entry)) {
      throw new Error(`${label} cannot contain credential material`);
    }
  });
}

function walkObject(value, visitor) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) walkObject(entry, visitor);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    visitor(key, entry);
    walkObject(entry, visitor);
  }
}

function normalizeBoundingBox(value, label) {
  reliabilityAssert(value && typeof value === 'object' && !Array.isArray(value), `${label} is required`);
  const min = finiteVector3(value.min, `${label}.min`);
  const max = finiteVector3(value.max, `${label}.max`);
  reliabilityAssert([0, 1, 2].every((axis) => min[axis] < max[axis]), `${label} must have positive volume`);
  const normalized = {
    min,
    max,
    w: max[0] - min[0],
    d: max[1] - min[1],
    h: max[2] - min[2]
  };
  for (const key of ['w', 'd', 'h']) {
    reliabilityAssert(Number(value[key]) === normalized[key], `${label}.${key} drift`);
  }
  return normalized;
}

function boundingBoxVolume(value) {
  return value.w * value.d * value.h;
}

function directedContainmentDirection(value) {
  if (value === 'left_contains_right') return 'target_contains_tool';
  if (value === 'right_contains_left') return 'tool_contains_target';
  return value;
}

function finiteVector3(value, label) {
  reliabilityAssert(Array.isArray(value) && value.length === 3, `${label} must contain three numbers`);
  const result = value.map(Number);
  reliabilityAssert(result.every(Number.isFinite), `${label} must contain finite numbers`);
  return result;
}

function normalizeMaterial(value, label) {
  if (value === null || value === undefined) return null;
  reliabilityAssert(typeof value === 'string' && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value),
    `${label} is invalid`);
  return value;
}

function boundedIdentifier(value, label) {
  reliabilityAssert(typeof value === 'string' && value.length > 0 && value.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(value), `${label} is invalid`);
  return value;
}

function assertNullableRevisionField(observed, expected, message) {
  if (observed !== null && observed !== undefined) reliabilityAssert(observed === expected, message);
}

function leafPersistentId(occurrencePath) {
  return occurrencePath.slice('pid:'.length).split('.').at(-1);
}

function normalizeAllowedOutputRoot(value) {
  const normalized = normalizeSafeRelativePath(value, 'allowedOutputRoot');
  reliabilityAssert(normalized.startsWith('output/'), 'allowedOutputRoot must be inside workspace output/');
  reliabilityAssert(normalized !== 'output', 'allowedOutputRoot must name a bounded output subdirectory');
  return normalized;
}

function normalizeSafeRelativePath(value, label) {
  reliabilityAssert(typeof value === 'string' && value.length > 0 && value.length <= 500, `${label} is invalid`);
  reliabilityAssert(!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value), `${label} must be relative`);
  reliabilityAssert(!value.includes('\\') && !value.includes('\u0000'), `${label} is invalid`);
  const segments = value.split('/');
  reliabilityAssert(segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    `${label} cannot contain traversal or empty segments`);
  const normalized = path.posix.normalize(value);
  reliabilityAssert(normalized === value, `${label} must be normalized`);
  return normalized;
}

function safePositiveInteger(value, label) {
  const number = Number(value);
  reliabilityAssert(Number.isSafeInteger(number) && number > 0, `${label} must be a positive safe integer`);
  return number;
}

function safeCount(value, label) {
  const number = Number(value);
  reliabilityAssert(Number.isSafeInteger(number) && number >= 0, `${label} must be a non-negative safe integer`);
  return number;
}

function assertSha256(value, label) {
  reliabilityAssert(SHA256_PATTERN.test(String(value || '')), `${label} must be sha256:<64 lowercase hex>`);
}

function hashStable(value) {
  return `sha256:${crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function canonicalEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  reliabilityAssert(!Number.isNaN(date.getTime()), 'now() must return a valid date');
  return date.toISOString();
}

function reliabilityAssert(condition, message) {
  if (!condition) throw new Error(`Real-model reliability plan rejected: ${message}.`);
}
