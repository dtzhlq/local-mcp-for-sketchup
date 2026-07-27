import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const REAL_MODEL_RECURSIVE_TARGET_REVIEW_VERSION = 'real-model-recursive-target-review.v2';
export const REAL_MODEL_RECURSIVE_TARGET_REVIEW_V3_VERSION = 'real-model-recursive-target-review.v3';
export const DEFAULT_RECURSIVE_PAIR_EVALUATION_LIMIT = 5_000;
export const MAX_RECURSIVE_PAIR_EVALUATION_LIMIT = 100_000;
export const DEFAULT_MANIFOLD_PROBE_LIMIT = 2;
export const DEFAULT_LOW_BBOX_FILL_RATIO_THRESHOLD = 0.1;

const MAX_STRUCTURAL_GROUPS = 10_000;
const MAX_DISPLAY_CHARS = 200;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CASE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,119}$/;
const NEGATIVE_ATOMIC_TRIAL_LINEAGE_VERSION = 'negative-atomic-trial-lineage.v1';
const BBOX_FILL_RATIO_SEMANTICS = 'sparsity_hint_only_not_exact_overlap';
const SUPPORTED_NEGATIVE_EVIDENCE = Object.freeze({
  'portal-boolean-v8-failure-evidence.v1': Object.freeze({
    kind: 'portal_boolean_v8_precommit_abort_evidence',
    case_id: 'portal_structure_disposable_copy',
    evidence_scope: 'portal_structure_disposable_copy_s3_apply_failure',
    source_scope: 'workspace_disposable_copy'
  })
});
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BLOCKER_ORDER = Object.freeze([
  'input_structural_groups_truncated',
  'input_total_seen_not_exact',
  'structural_group_returned_count_mismatch',
  'duplicate_entity_path',
  'fresh_manifold_unmatched',
  'fresh_manifold_counter_mismatch',
  'pair_evaluation_budget_exhausted',
  'fewer_than_two_pair_eligible_groups',
  'no_same_parent_scope_pair',
  'no_positive_bbox_overlap_pair',
  'no_manifold_qualified_pair',
  'fresh_manifold_attestation_required'
]);

/**
 * Pure, deterministic review of one read-only adoption artifact. This function
 * does not import a runtime, inspect queue directories, or mutate SketchUp.
 */
export function deriveRealModelRecursiveTargetReview(adoption, {
  sourceSha256,
  modelRevision,
  operation = 'difference',
  pairEvaluationLimit = DEFAULT_RECURSIVE_PAIR_EVALUATION_LIMIT,
  manifoldProbeLimit = DEFAULT_MANIFOLD_PROBE_LIMIT,
  now = () => new Date()
} = {}) {
  assertSha256(sourceSha256, 'sourceSha256');
  assertSha256(modelRevision, 'modelRevision');
  assert(operation === 'difference' || operation === 'intersect', 'operation must be difference or intersect.');
  const evaluationLimit = positiveSafeInteger(pairEvaluationLimit, 'pairEvaluationLimit');
  assert(evaluationLimit <= MAX_RECURSIVE_PAIR_EVALUATION_LIMIT,
    `pairEvaluationLimit must not exceed ${MAX_RECURSIVE_PAIR_EVALUATION_LIMIT}.`);
  const probeLimit = positiveSafeInteger(manifoldProbeLimit, 'manifoldProbeLimit');
  assert(probeLimit <= 20, 'manifoldProbeLimit must not exceed 20.');

  const structuralGroups = adoption?.structural_groups;
  assert(structuralGroups && typeof structuralGroups === 'object' && !Array.isArray(structuralGroups),
    'adoption.structural_groups is required.');
  assert(structuralGroups.version === 'structural-groups.v1',
    'adoption.structural_groups.version must be structural-groups.v1.');
  assert(Array.isArray(structuralGroups.entries), 'adoption.structural_groups.entries must be an array.');
  assert(adoption.read_only === true, 'adoption.read_only must be true for recursive target review.');
  assert(adoption.model_revision_complete === true,
    'adoption.model_revision_complete must be true for recursive target review.');
  assert(adoption.model_revision === modelRevision,
    'adoption.model_revision must exactly match the supplied modelRevision.');

  const totalSeen = nonnegativeSafeInteger(structuralGroups.total_seen, 'structural_groups.total_seen');
  const totalSeenExact = requiredBoolean(
    structuralGroups.total_seen_exact,
    'structural_groups.total_seen_exact'
  );
  const returned = nonnegativeSafeInteger(structuralGroups.returned, 'structural_groups.returned');
  const inputTruncated = requiredBoolean(structuralGroups.truncated, 'structural_groups.truncated');
  const inputLimit = positiveSafeInteger(structuralGroups.limit, 'structural_groups.limit');
  assert(inputLimit <= MAX_STRUCTURAL_GROUPS, `structural_groups.limit must not exceed ${MAX_STRUCTURAL_GROUPS}.`);
  assert(structuralGroups.entries.length <= MAX_STRUCTURAL_GROUPS,
    `structural_groups.entries must not exceed ${MAX_STRUCTURAL_GROUPS}.`);
  const requestedCount = nonnegativeSafeInteger(
    structuralGroups.fresh_manifold_requested,
    'structural_groups.fresh_manifold_requested'
  );
  const matchedCount = nonnegativeSafeInteger(
    structuralGroups.fresh_manifold_matched,
    'structural_groups.fresh_manifold_matched'
  );
  const unmatchedCount = nonnegativeSafeInteger(
    structuralGroups.fresh_manifold_unmatched,
    'structural_groups.fresh_manifold_unmatched'
  );

  const candidates = structuralGroups.entries
    .map((entry, index) => normalizeStructuralGroup(entry, { modelRevision, index }))
    .sort(compareCandidatePath);
  const duplicatePaths = duplicateValues(candidates.map((entry) => entry.entity_path));
  const exactFreshCount = candidates.filter((entry) => entry.manifold_attestation.exact_fresh_match).length;
  const pairEligible = candidates.filter((entry) => entry.pair_review_eligible);
  const pairResult = evaluateCandidatePairs(pairEligible, {
    operation,
    pairEvaluationLimit: evaluationLimit
  });

  const hardBlockers = [];
  if (inputTruncated) hardBlockers.push('input_structural_groups_truncated');
  if (!totalSeenExact) hardBlockers.push('input_total_seen_not_exact');
  if (returned !== structuralGroups.entries.length || totalSeen < returned || returned > inputLimit) {
    hardBlockers.push('structural_group_returned_count_mismatch');
  }
  if (duplicatePaths.length > 0) hardBlockers.push('duplicate_entity_path');
  if (unmatchedCount > 0) hardBlockers.push('fresh_manifold_unmatched');
  if (matchedCount !== exactFreshCount || requestedCount !== matchedCount + unmatchedCount) {
    hardBlockers.push('fresh_manifold_counter_mismatch');
  }
  if (pairResult.budgetExhausted) hardBlockers.push('pair_evaluation_budget_exhausted');

  const outcomeBlockers = [];
  if (pairEligible.length < 2) outcomeBlockers.push('fewer_than_two_pair_eligible_groups');
  if (pairEligible.length >= 2 && pairResult.sameParentScopePairCount === 0) {
    outcomeBlockers.push('no_same_parent_scope_pair');
  }
  const positiveBBoxPairs = pairResult.evaluations.filter((entry) => entry.positive_bbox_overlap);
  if (pairResult.sameParentScopePairCount > 0 && positiveBBoxPairs.length === 0) {
    outcomeBlockers.push('no_positive_bbox_overlap_pair');
  }
  const atomicTrialEligiblePairs = positiveBBoxPairs.filter((entry) => entry.atomic_boolean_trial_eligible);
  const pendingManifoldProbePaths = hardBlockers.length === 0
    ? buildManifoldProbePaths(pairResult.evaluations, { limit: probeLimit })
    : [];
  if (positiveBBoxPairs.length > 0 && atomicTrialEligiblePairs.length === 0) {
    outcomeBlockers.push(
      pendingManifoldProbePaths.length > 0
        ? 'fresh_manifold_attestation_required'
        : 'no_manifold_qualified_pair'
    );
  }

  const blockers = orderedUnique([...hardBlockers, ...outcomeBlockers]);
  const globallyIncomplete = hardBlockers.length > 0;
  const pairEvaluations = pairResult.evaluations.map((entry, index) => {
    const pairBlockers = [...entry.blockers];
    if (globallyIncomplete) pairBlockers.push('review_input_incomplete');
    const canRecommend = !globallyIncomplete && entry.atomic_boolean_trial_eligible;
    return {
      ...entry,
      rank: index + 1,
      status: canRecommend ? 'server_recommended' : 'blocked',
      blockers: orderedUnique(pairBlockers)
    };
  });
  const selectedPair = pairEvaluations.find((entry) => entry.status === 'server_recommended') || null;
  const recommendedProposal = blockers.length === 0 && selectedPair
    ? buildRecommendedProposal(selectedPair)
    : null;
  const manifoldProbePaths = hardBlockers.length === 0 && !recommendedProposal
    ? pendingManifoldProbePaths
    : [];
  const status = recommendedProposal ? 'server_recommended' : 'blocked';

  return {
    version: REAL_MODEL_RECURSIVE_TARGET_REVIEW_VERSION,
    kind: 'real_model_recursive_target_review',
    generated_at: isoTimestamp(now()),
    ok: true,
    runtime: 'offline',
    live_queue_called: false,
    source: {
      sha256: sourceSha256
    },
    model: {
      revision: modelRevision,
      revision_complete: true,
      revision_strategy: nullableBoundedIdentifier(adoption.model_revision_strategy),
      revision_unique_entity_limit: nullableNonnegativeSafeInteger(
        adoption.model_revision_unique_entity_limit,
        'adoption.model_revision_unique_entity_limit'
      ),
      revision_unique_entities: nullableNonnegativeSafeInteger(
        adoption.model_revision_unique_entities,
        'adoption.model_revision_unique_entities'
      ),
      revision_reachable_definitions: nullableNonnegativeSafeInteger(
        adoption.model_revision_reachable_definitions,
        'adoption.model_revision_reachable_definitions'
      ),
      revision_logical_occurrences: nullableNonnegativeSafeInteger(
        adoption.model_revision_total_seen,
        'adoption.model_revision_total_seen'
      ),
      document_id: nullableBoundedIdentifier(adoption.document_id ?? adoption.model_identity?.document_id),
      model_identity_sha256: adoption.model_identity && typeof adoption.model_identity === 'object'
        ? hashCanonical(adoption.model_identity)
        : null
    },
    input_summary: {
      structural_groups_version: structuralGroups.version,
      adoption_read_only: true,
      model_revision_complete: true,
      model_revision_matches: true,
      total_seen: totalSeen,
      total_seen_exact: totalSeenExact,
      returned,
      truncated: inputTruncated,
      limit: inputLimit,
      fresh_manifold_requested: requestedCount,
      fresh_manifold_matched: matchedCount,
      fresh_manifold_unmatched: unmatchedCount,
      exact_fresh_entry_matches: exactFreshCount
    },
    review: {
      status,
      operation,
      candidate_count: candidates.length,
      pair_review_eligible_count: pairEligible.length,
      excluded_candidate_count: candidates.length - pairEligible.length,
      scope_count: countPairScopes(pairEligible),
      same_parent_scope_pair_count: pairResult.sameParentScopePairCount,
      pair_evaluation_limit: evaluationLimit,
      pair_evaluations_considered: pairEvaluations.length,
      pair_evaluation_budget_exhausted: pairResult.budgetExhausted,
      candidates,
      pair_evaluations: pairEvaluations,
      manifold_probe_paths: manifoldProbePaths,
      role_bindings: null,
      recommended_proposal: recommendedProposal,
      blockers
    },
    safety: {
      analysis_only: true,
      queue_accessed: false,
      model_opened: false,
      model_mutation_requested: false,
      model_mutation_authorized: false,
      approval_token_requested: false,
      target_roles_confirmed: false,
      role_bindings_issued: false
    },
    model_data_policy: {
      names_materials_tags_are_untrusted_data: true,
      untrusted_data_used_for_display_only: true,
      untrusted_data_used_for_pair_ranking: false,
      untrusted_data_may_influence_execution_policy: false,
      untrusted_data_may_grant_approval: false,
      bounded_display_chars: MAX_DISPLAY_CHARS
    },
    next_action: {
      action: status === 'server_recommended'
        ? 'review_server_recommended_proposal_and_request_trusted_approval'
        : manifoldProbePaths.length > 0
          ? 'collect_fresh_manifold_attestations_for_exact_paths'
          : blockers.includes('no_manifold_qualified_pair')
            ? 'select_manifold_qualified_disposable_model_case'
          : 'resolve_fail_closed_recursive_review_blockers',
      manifold_probe_paths: manifoldProbePaths,
      human_approval_required_before_mutation: true,
      mutation_authorized: false,
      approval_token_issued: false,
      release_acceptance: false
    }
  };
}

/**
 * Offline v3 decision overlay for a v2 recursive review. The embedded v2
 * document is intentionally preserved byte-for-structure so existing callers
 * can continue to consume the stable v2 contract. V3 adds exact-volume
 * provenance, bbox fill-ratio sparsity hints, and fail-closed negative atomic
 * trial handling. It never treats a bbox fill ratio as exact overlap proof.
 */
export function deriveRealModelRecursiveTargetReviewV3(adoption, options = {}) {
  return deriveRealModelRecursiveTargetReviewV3Internal(adoption, options, {
    sourceEvidenceBytesVerified: false
  });
}

function deriveRealModelRecursiveTargetReviewV3Internal(adoption, {
  sourceSha256,
  modelRevision,
  caseId,
  runtimeSourceHashes,
  negativeAtomicTrialLineages = [],
  operation = 'difference',
  pairEvaluationLimit = DEFAULT_RECURSIVE_PAIR_EVALUATION_LIMIT,
  manifoldProbeLimit = DEFAULT_MANIFOLD_PROBE_LIMIT,
  lowBBoxFillRatioThreshold = DEFAULT_LOW_BBOX_FILL_RATIO_THRESHOLD,
  now = () => new Date()
} = {}, { sourceEvidenceBytesVerified }) {
  assert(CASE_ID_PATTERN.test(String(caseId || '')),
    'caseId must be a lowercase stable identifier using letters, digits, underscore, or hyphen.');
  const currentRuntimeSourceHashes = normalizeRuntimeSourceHashes(
    runtimeSourceHashes,
    'runtimeSourceHashes'
  );
  assert(Number.isFinite(lowBBoxFillRatioThreshold)
    && lowBBoxFillRatioThreshold > 0
    && lowBBoxFillRatioThreshold <= 1,
  'lowBBoxFillRatioThreshold must be a finite number in (0, 1].');

  const baseReview = deriveRealModelRecursiveTargetReview(adoption, {
    sourceSha256,
    modelRevision,
    operation,
    pairEvaluationLimit,
    manifoldProbeLimit,
    now
  });
  const geometryAttestations = buildGeometryAttestations(adoption, baseReview, { modelRevision });
  const geometryByPath = new Map(geometryAttestations.map((entry) => [entry.occurrence_path, entry]));
  const normalizedLineages = normalizeNegativeAtomicTrialLineages(negativeAtomicTrialLineages, {
    caseId,
    sourceSha256,
    modelRevision,
    operation,
    currentRuntimeSourceHashes,
    baseReview,
    sourceEvidenceBytesVerified
  });
  const exactRuntimeMatchCount = normalizedLineages
    .filter((entry) => entry.runtime_binding_status === 'exact_runtime_match').length;
  const runtimeDeltaCount = normalizedLineages
    .filter((entry) => entry.runtime_binding_status === 'runtime_delta_requires_review').length;
  const lineageStatus = normalizedLineages.length === 0
    ? 'none_supplied'
    : runtimeDeltaCount === 0
      ? 'exact_runtime_match'
      : exactRuntimeMatchCount === 0
        ? 'runtime_delta_requires_review'
        : 'mixed_runtime_applicability_requires_review';
  const runtimeDeltaRequiresReview = runtimeDeltaCount > 0;
  const negativeSourceEvidenceUnverified = normalizedLineages.length > 0
    && sourceEvidenceBytesVerified !== true;

  const pairDecisions = baseReview.review.pair_evaluations.map((pair) => {
    const targetGeometry = geometryByPath.get(pair.target.occurrence_path);
    const toolGeometry = geometryByPath.get(pair.tool.occurrence_path);
    assert(targetGeometry && toolGeometry, 'v3 pair endpoint has no geometry attestation.');
    const pairLineages = normalizedLineages.filter((entry) => (
      entry.target_path === pair.target.occurrence_path
      && entry.tool_path === pair.tool.occurrence_path
      && entry.operation === pair.operation
    ));
    const exactRuntimeLineage = pairLineages.find(
      (entry) => entry.runtime_binding_status === 'exact_runtime_match'
    ) || null;
    const driftedRuntimeLineage = pairLineages.find(
      (entry) => entry.runtime_binding_status === 'runtime_delta_requires_review'
    ) || null;
    const lowFillRatioObserved = pair.bbox_relation === 'containment'
      && [targetGeometry.bbox_fill_ratio, toolGeometry.bbox_fill_ratio]
        .some((value) => value !== null && value < lowBBoxFillRatioThreshold);
    const blockers = [...pair.blockers];
    if (negativeSourceEvidenceUnverified) blockers.push('negative_source_evidence_unverified');
    if (exactRuntimeLineage && !negativeSourceEvidenceUnverified) {
      blockers.push('negative_atomic_trial_pair_excluded');
    }
    if (driftedRuntimeLineage) blockers.push('negative_trial_not_directly_reusable');
    if (runtimeDeltaRequiresReview) blockers.push('runtime_delta_requires_review');
    if (lowFillRatioObserved) blockers.push('stronger_exact_overlap_evidence_required');
    const atomicBooleanTrialEligible = pair.atomic_boolean_trial_eligible
      && !exactRuntimeLineage
      && !negativeSourceEvidenceUnverified
      && !runtimeDeltaRequiresReview
      && !lowFillRatioObserved;
    const evidenceRequirement = negativeSourceEvidenceUnverified
      ? 'verified_negative_source_evidence_required'
      : exactRuntimeLineage
      ? 'failed_atomic_trial_pair_excluded'
      : runtimeDeltaRequiresReview
        ? 'trusted_runtime_delta_audit_required'
        : lowFillRatioObserved
          ? 'needs_stronger_evidence'
          : pair.atomic_boolean_trial_eligible
            ? 'review_gated_atomic_trial'
            : 'geometric_preconditions_required';
    return {
      base_rank: pair.rank,
      operation: pair.operation,
      status: atomicBooleanTrialEligible ? 'server_recommended' : 'blocked',
      target_path: pair.target.occurrence_path,
      tool_path: pair.tool.occurrence_path,
      scope_path: pair.scope_path,
      parent_entity_path: pair.parent_entity_path,
      bbox_relation: pair.bbox_relation,
      positive_bbox_overlap: pair.positive_bbox_overlap,
      bbox_overlap_volume: pair.bbox_overlap_volume,
      target_exact_solid_volume: targetGeometry.exact_solid_volume,
      tool_exact_solid_volume: toolGeometry.exact_solid_volume,
      target_bbox_fill_ratio: targetGeometry.bbox_fill_ratio,
      tool_bbox_fill_ratio: toolGeometry.bbox_fill_ratio,
      fill_ratio_assessment: {
        low_threshold: lowBBoxFillRatioThreshold,
        low_fill_ratio_observed: lowFillRatioObserved,
        semantics: BBOX_FILL_RATIO_SEMANTICS,
        exact_overlap_proof: false
      },
      exact_solid_overlap: structuredClone(pair.exact_solid_overlap),
      exact_overlap_assessment: {
        status: 'exact_overlap_unverified',
        verified: false,
        evidence_requirement: evidenceRequirement,
        bbox_fill_ratio_is_exact_overlap_proof: false
      },
      negative_atomic_trial: pairLineages.length === 0
        ? {
          status: 'not_observed_for_pair',
          lineage_sha256: null,
          plan_hash: null,
          runtime_exact_match: null,
          failed_plan_replay_allowed: false
        }
        : negativeSourceEvidenceUnverified
          ? {
            status: 'negative_source_evidence_unverified',
            lineage_sha256: pairLineages[0].lineage_sha256,
            plan_hash: pairLineages[0].plan_hash,
            runtime_exact_match: null,
            failed_plan_replay_allowed: false
          }
          : exactRuntimeLineage
          ? {
            status: 'confirmed_precommit_abort_exact_runtime',
            lineage_sha256: exactRuntimeLineage.lineage_sha256,
            plan_hash: exactRuntimeLineage.plan_hash,
            runtime_exact_match: true,
            failed_plan_replay_allowed: false
          }
          : {
            status: 'negative_trial_not_directly_reusable',
            lineage_sha256: driftedRuntimeLineage.lineage_sha256,
            plan_hash: driftedRuntimeLineage.plan_hash,
            runtime_exact_match: false,
            failed_plan_replay_allowed: false
          },
      atomic_boolean_trial_eligible: atomicBooleanTrialEligible,
      role_provenance: pair.role_provenance,
      blockers: orderedUnique(blockers)
    };
  });

  const baseInputBlocked = baseReview.review.blockers.length > 0;
  const selectedPair = !baseInputBlocked
    && !negativeSourceEvidenceUnverified
    && !runtimeDeltaRequiresReview
    ? pairDecisions.find((entry) => entry.atomic_boolean_trial_eligible) || null
    : null;
  const recommendedProposal = selectedPair ? buildV3RecommendedProposal(selectedPair) : null;
  const findings = orderedUnique(pairDecisions.flatMap((entry) => entry.blockers).filter((entry) => [
    'negative_atomic_trial_pair_excluded',
    'negative_source_evidence_unverified',
    'negative_trial_not_directly_reusable',
    'runtime_delta_requires_review',
    'stronger_exact_overlap_evidence_required'
  ].includes(entry)));
  const blockers = recommendedProposal
    ? orderedUnique(baseReview.review.blockers)
    : orderedUnique([
      ...baseReview.review.blockers,
      ...findings,
      ...(pairDecisions.length > 0 ? ['no_v3_atomic_boolean_trial_candidate'] : [])
    ]);
  const status = recommendedProposal ? 'server_recommended' : 'blocked';

  return {
    version: REAL_MODEL_RECURSIVE_TARGET_REVIEW_V3_VERSION,
    kind: 'real_model_recursive_target_review',
    generated_at: baseReview.generated_at,
    ok: true,
    runtime: 'offline',
    live_queue_called: false,
    case_id: caseId,
    source: structuredClone(baseReview.source),
    model: structuredClone(baseReview.model),
    runtime_source_hashes: currentRuntimeSourceHashes,
    base_review: baseReview,
    geometry_attestations: geometryAttestations,
    negative_atomic_trial_lineage: {
      input_version: NEGATIVE_ATOMIC_TRIAL_LINEAGE_VERSION,
      status: lineageStatus,
      supplied_count: normalizedLineages.length,
      exact_runtime_match_count: exactRuntimeMatchCount,
      runtime_delta_count: runtimeDeltaCount,
      negative_trial_not_directly_reusable: runtimeDeltaRequiresReview,
      source_evidence_verification: {
        status: normalizedLineages.length === 0
          ? 'not_required'
          : sourceEvidenceBytesVerified
            ? 'verified_repo_regular_files_and_bound_content'
            : 'not_verified_pure_derivation',
        required_count: normalizedLineages.length,
        verified_count: sourceEvidenceBytesVerified ? normalizedLineages.length : 0
      },
      trials: normalizedLineages
    },
    review: {
      status,
      operation,
      fill_ratio_low_threshold: lowBBoxFillRatioThreshold,
      bbox_fill_ratio_semantics: BBOX_FILL_RATIO_SEMANTICS,
      pair_decisions: pairDecisions,
      recommended_proposal: recommendedProposal,
      findings,
      blockers
    },
    safety: {
      analysis_only: true,
      queue_accessed: false,
      model_opened: false,
      model_mutation_requested: false,
      model_mutation_authorized: false,
      approval_token_requested: false,
      negative_trial_may_grant_authorization: false,
      negative_source_evidence_bytes_verified: normalizedLineages.length === 0 || sourceEvidenceBytesVerified,
      runtime_delta_may_be_silently_ignored: false,
      release_acceptance: false
    },
    model_data_policy: structuredClone(baseReview.model_data_policy),
    next_action: {
      action: negativeSourceEvidenceUnverified
        ? 'verify_negative_source_evidence_before_candidate_policy'
        : runtimeDeltaRequiresReview
        ? 'audit_runtime_source_delta_before_new_atomic_trial'
        : recommendedProposal
          ? 'review_server_recommended_proposal_and_request_trusted_approval'
          : findings.includes('stronger_exact_overlap_evidence_required')
            ? 'collect_stronger_exact_overlap_evidence'
            : findings.includes('negative_atomic_trial_pair_excluded')
              ? 'select_distinct_candidate_or_correct_implementation'
              : 'resolve_fail_closed_recursive_review_blockers',
      runtime_delta_requires_review: runtimeDeltaRequiresReview,
      negative_trial_not_directly_reusable: runtimeDeltaRequiresReview,
      human_approval_required_before_mutation: true,
      mutation_authorized: false,
      approval_token_issued: false,
      release_acceptance: false
    }
  };
}

/**
 * Two-phase helper. It emits only exact occurrence paths from the best
 * positive-AABB-overlap pair(s); contact/disjoint pairs never trigger a probe.
 */
export function buildManifoldProbePaths(pairEvaluations, { limit = DEFAULT_MANIFOLD_PROBE_LIMIT } = {}) {
  const boundedLimit = positiveSafeInteger(limit, 'limit');
  assert(boundedLimit <= 20, 'limit must not exceed 20.');
  const paths = [];
  for (const pair of pairEvaluations || []) {
    if (pair?.positive_bbox_overlap !== true) continue;
    for (const candidate of [pair.target, pair.tool]) {
      if (!candidate || candidate.manifold_attestation?.exact_fresh_match === true) continue;
      if (!paths.includes(candidate.occurrence_path)) paths.push(candidate.occurrence_path);
      if (paths.length >= boundedLimit) return paths;
    }
  }
  return paths;
}

/** Strict axis-aligned bbox relation used by the sweep-and-prune review. */
export function classifyBoundingBoxRelation(leftValue, rightValue) {
  const left = normalizeBoundingBox(leftValue);
  const right = normalizeBoundingBox(rightValue);
  assert(left && positiveBoundingBox(left), 'left bounding box must have positive bbox volume.');
  assert(right && positiveBoundingBox(right), 'right bounding box must have positive bbox volume.');
  const axisOverlaps = [0, 1, 2].map((axis) => (
    Math.min(left.max[axis], right.max[axis]) - Math.max(left.min[axis], right.min[axis])
  ));
  const disjoint = axisOverlaps.some((value) => value < 0);
  const contact = !disjoint && axisOverlaps.some((value) => value === 0);
  const positiveBBoxOverlap = axisOverlaps.every((value) => value > 0);
  const leftContainsRight = containsBox(left, right);
  const rightContainsLeft = containsBox(right, left);
  const relation = disjoint
    ? 'disjoint'
    : contact
      ? 'contact'
      : leftContainsRight || rightContainsLeft
        ? 'containment'
        : 'collision';
  const containmentDirection = relation !== 'containment'
    ? null
    : leftContainsRight && rightContainsLeft
      ? 'equal'
      : leftContainsRight
        ? 'left_contains_right'
        : 'right_contains_left';
  const overlapBox = positiveBBoxOverlap
    ? boundingBoxFromMinMax(
      [0, 1, 2].map((axis) => Math.max(left.min[axis], right.min[axis])),
      [0, 1, 2].map((axis) => Math.min(left.max[axis], right.max[axis]))
    )
    : null;
  return {
    bbox_relation: relation,
    bbox_containment_direction: containmentDirection,
    bbox_axis_overlaps: axisOverlaps,
    positive_bbox_overlap: positiveBBoxOverlap,
    bbox_overlap_bounding_box: overlapBox,
    bbox_overlap_volume: overlapBox ? boundingVolume(overlapBox) : 0
  };
}

export async function runRealModelRecursiveTargetReview({
  adoptionFile,
  sourceSha256,
  modelRevision,
  output,
  operation = 'difference',
  pairEvaluationLimit = DEFAULT_RECURSIVE_PAIR_EVALUATION_LIMIT,
  manifoldProbeLimit = DEFAULT_MANIFOLD_PROBE_LIMIT,
  now = () => new Date()
} = {}) {
  const inputPath = requiredPath(adoptionFile, 'adoptionFile');
  const outputPath = requiredPath(output, 'output');
  const adoption = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const review = deriveRealModelRecursiveTargetReview(adoption, {
    sourceSha256,
    modelRevision,
    operation,
    pairEvaluationLimit,
    manifoldProbeLimit,
    now
  });
  await validateReview(review);
  await writeJsonAtomic(outputPath, review);
  return {
    ok: true,
    runtime: 'offline',
    live_queue_called: false,
    review,
    output_path: outputPath
  };
}

export async function runRealModelRecursiveTargetReviewV3({
  adoptionFile,
  sourceSha256,
  modelRevision,
  caseId,
  runtimeSourceHashes,
  negativeAtomicTrialFile,
  output,
  operation = 'difference',
  pairEvaluationLimit = DEFAULT_RECURSIVE_PAIR_EVALUATION_LIMIT,
  manifoldProbeLimit = DEFAULT_MANIFOLD_PROBE_LIMIT,
  lowBBoxFillRatioThreshold = DEFAULT_LOW_BBOX_FILL_RATIO_THRESHOLD,
  now = () => new Date()
} = {}) {
  const inputPath = requiredPath(adoptionFile, 'adoptionFile');
  const outputPath = requiredPath(output, 'output');
  const adoption = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const negativeAtomicTrialLineages = negativeAtomicTrialFile
    ? [JSON.parse(await fs.readFile(requiredPath(negativeAtomicTrialFile, 'negativeAtomicTrialFile'), 'utf8'))]
    : [];
  await verifyNegativeAtomicTrialSourceEvidence(negativeAtomicTrialLineages);
  const review = deriveRealModelRecursiveTargetReviewV3Internal(adoption, {
    sourceSha256,
    modelRevision,
    caseId,
    runtimeSourceHashes,
    negativeAtomicTrialLineages,
    operation,
    pairEvaluationLimit,
    manifoldProbeLimit,
    lowBBoxFillRatioThreshold,
    now
  }, {
    sourceEvidenceBytesVerified: true
  });
  await validateReviewV3(review);
  await writeJsonAtomic(outputPath, review);
  return {
    ok: true,
    runtime: 'offline',
    live_queue_called: false,
    review,
    output_path: outputPath
  };
}

async function validateReview(review) {
  const schemaPath = path.join(repoRoot, 'schema/real-model-recursive-target-review-v2.schema.json');
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validate(review)) {
    throw new Error(`real-model recursive target review schema validation failed: ${JSON.stringify(validate.errors)}`);
  }
}

export async function validateRealModelRecursiveTargetReviewV3(review) {
  await validateReviewV3(review);
  return true;
}

async function validateReviewV3(review) {
  assertReviewV3Invariants(review);
  const v2SchemaPath = path.join(repoRoot, 'schema/real-model-recursive-target-review-v2.schema.json');
  const v3SchemaPath = path.join(repoRoot, 'schema/real-model-recursive-target-review-v3.schema.json');
  const [v2Schema, v3Schema] = await Promise.all([
    fs.readFile(v2SchemaPath, 'utf8').then(JSON.parse),
    fs.readFile(v3SchemaPath, 'utf8').then(JSON.parse)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  ajv.addSchema(v2Schema);
  const validate = ajv.compile(v3Schema);
  if (!validate(review)) {
    throw new Error(`real-model recursive target review v3 schema validation failed: ${JSON.stringify(validate.errors)}`);
  }
}

function assertReviewV3Invariants(review) {
  assert(review?.version === REAL_MODEL_RECURSIVE_TARGET_REVIEW_V3_VERSION,
    'v3 review version is invalid.');
  const baseReview = review.base_review;
  assert(baseReview?.version === REAL_MODEL_RECURSIVE_TARGET_REVIEW_VERSION,
    'v3 base_review must preserve the v2 contract.');
  assert(review.generated_at === baseReview.generated_at,
    'v3 generated_at must match base_review.generated_at.');
  assert(stableCanonicalJson(review.source) === stableCanonicalJson(baseReview.source),
    'v3 source binding must match base_review.');
  assert(stableCanonicalJson(review.model) === stableCanonicalJson(baseReview.model),
    'v3 model binding must match base_review.');
  assert(review.review?.operation === baseReview.review?.operation,
    'v3 operation must match base_review.');

  const candidates = baseReview.review.candidates || [];
  const geometry = review.geometry_attestations || [];
  assert(geometry.length === candidates.length,
    'v3 geometry attestation count must match base_review candidates.');
  const geometryByPath = new Map();
  for (const entry of geometry) {
    assert(!geometryByPath.has(entry.occurrence_path),
      'v3 geometry attestations must have unique occurrence paths.');
    geometryByPath.set(entry.occurrence_path, entry);
  }
  for (const candidate of candidates) {
    const entry = geometryByPath.get(candidate.occurrence_path);
    assert(entry && entry.entity_fingerprint === candidate.entity_fingerprint,
      `v3 geometry attestation is not bound to ${candidate.occurrence_path}.`);
    assert(entry.world_bbox_volume === candidate.world_bbox_volume,
      `v3 bbox volume drifted for ${candidate.occurrence_path}.`);
    assert(entry.bbox_fill_ratio_semantics === BBOX_FILL_RATIO_SEMANTICS
      && entry.exact_overlap_proof === false,
    `v3 bbox fill ratio semantics drifted for ${candidate.occurrence_path}.`);
  }

  const lineage = review.negative_atomic_trial_lineage;
  const trials = lineage?.trials || [];
  assert(lineage?.supplied_count === trials.length,
    'v3 negative trial supplied_count must match trials.');
  let exactRuntimeCount = 0;
  let runtimeDeltaCount = 0;
  for (const trial of trials) {
    assert(trial.case_id === review.case_id, 'v3 negative trial case binding drifted.');
    assert(trial.source_sha256 === review.source.sha256, 'v3 negative trial source binding drifted.');
    assert(trial.model_revision === review.model.revision, 'v3 negative trial revision binding drifted.');
    assert(trial.operation === review.review.operation, 'v3 negative trial operation binding drifted.');
    assert(baseReview.review.pair_evaluations.some((pair) => (
      pair.operation === trial.operation
      && pair.target.occurrence_path === trial.target_path
      && pair.tool.occurrence_path === trial.tool_path
    )), 'v3 negative trial pair binding drifted.');
    const expectedDeltaFields = ['boolean_operations_sha256', 'model_revision_source_sha256']
      .filter((field) => trial.runtime_source_hashes[field] !== review.runtime_source_hashes[field]);
    assert(stableCanonicalJson(trial.runtime_delta_fields) === stableCanonicalJson(expectedDeltaFields),
      'v3 negative trial runtime delta fields drifted.');
    const expectedRuntimeStatus = expectedDeltaFields.length === 0
      ? 'exact_runtime_match'
      : 'runtime_delta_requires_review';
    assert(trial.runtime_binding_status === expectedRuntimeStatus,
      'v3 negative trial runtime binding status drifted.');
    if (expectedDeltaFields.length === 0) exactRuntimeCount += 1;
    else runtimeDeltaCount += 1;
    const {
      lineage_sha256: lineageSha256,
      runtime_binding_status: runtimeBindingStatus,
      runtime_delta_fields: runtimeDeltaFields,
      pair_present_in_base_review: pairPresentInBaseReview,
      failed_plan_replay_allowed: failedPlanReplayAllowed,
      ...boundTrial
    } = trial;
    void runtimeBindingStatus;
    void runtimeDeltaFields;
    assert(pairPresentInBaseReview === true && failedPlanReplayAllowed === false,
      'v3 negative trial replay or pair-presence binding drifted.');
    const {
      verification: sourceEvidenceVerification,
      ...boundSourceEvidence
    } = boundTrial.source_evidence;
    assert([
      'not_verified_pure_derivation',
      'verified_repo_regular_file_and_bound_content'
    ].includes(sourceEvidenceVerification), 'v3 negative trial source evidence verification is invalid.');
    assert(lineageSha256 === hashCanonical({
      version: NEGATIVE_ATOMIC_TRIAL_LINEAGE_VERSION,
      kind: 'negative_atomic_trial_lineage',
      ...boundTrial,
      source_evidence: boundSourceEvidence
    }), 'v3 negative trial lineage hash drifted.');
  }
  assert(lineage.exact_runtime_match_count === exactRuntimeCount,
    'v3 exact runtime lineage count drifted.');
  assert(lineage.runtime_delta_count === runtimeDeltaCount,
    'v3 runtime delta lineage count drifted.');
  assert(lineage.negative_trial_not_directly_reusable === (runtimeDeltaCount > 0),
    'v3 negative trial reusability summary drifted.');
  const verifiedSourceEvidenceCount = trials.filter(
    (trial) => trial.source_evidence.verification === 'verified_repo_regular_file_and_bound_content'
  ).length;
  const expectedEvidenceVerificationStatus = trials.length === 0
    ? 'not_required'
    : verifiedSourceEvidenceCount === trials.length
      ? 'verified_repo_regular_files_and_bound_content'
      : 'not_verified_pure_derivation';
  assert(lineage.source_evidence_verification.status === expectedEvidenceVerificationStatus
    && lineage.source_evidence_verification.required_count === trials.length
    && lineage.source_evidence_verification.verified_count === verifiedSourceEvidenceCount,
  'v3 negative trial source evidence verification summary drifted.');
  const expectedLineageStatus = trials.length === 0
    ? 'none_supplied'
    : runtimeDeltaCount === 0
      ? 'exact_runtime_match'
      : exactRuntimeCount === 0
        ? 'runtime_delta_requires_review'
        : 'mixed_runtime_applicability_requires_review';
  assert(lineage.status === expectedLineageStatus, 'v3 negative trial lineage status drifted.');
  const negativeSourceEvidenceUnverified = trials.length > 0
    && verifiedSourceEvidenceCount !== trials.length;

  const pairDecisions = review.review.pair_decisions || [];
  assert(pairDecisions.length === baseReview.review.pair_evaluations.length,
    'v3 pair decision count must match base_review pair evaluations.');
  const runtimeDeltaRequiresReview = runtimeDeltaCount > 0;
  for (let index = 0; index < pairDecisions.length; index += 1) {
    const decision = pairDecisions[index];
    const basePair = baseReview.review.pair_evaluations[index];
    assert(decision.base_rank === basePair.rank
      && decision.operation === basePair.operation
      && decision.target_path === basePair.target.occurrence_path
      && decision.tool_path === basePair.tool.occurrence_path,
    `v3 pair decision ${index} is not bound to base_review.`);
    assert(decision.bbox_relation === basePair.bbox_relation
      && decision.positive_bbox_overlap === basePair.positive_bbox_overlap
      && decision.bbox_overlap_volume === basePair.bbox_overlap_volume,
    `v3 pair decision ${index} bbox evidence drifted.`);
    const targetGeometry = geometryByPath.get(decision.target_path);
    const toolGeometry = geometryByPath.get(decision.tool_path);
    assert(decision.target_exact_solid_volume === targetGeometry.exact_solid_volume
      && decision.tool_exact_solid_volume === toolGeometry.exact_solid_volume
      && decision.target_bbox_fill_ratio === targetGeometry.bbox_fill_ratio
      && decision.tool_bbox_fill_ratio === toolGeometry.bbox_fill_ratio,
    `v3 pair decision ${index} geometry evidence drifted.`);
    const expectedLowFill = decision.bbox_relation === 'containment'
      && [decision.target_bbox_fill_ratio, decision.tool_bbox_fill_ratio]
        .some((value) => value !== null && value < review.review.fill_ratio_low_threshold);
    assert(decision.fill_ratio_assessment.low_fill_ratio_observed === expectedLowFill
      && decision.fill_ratio_assessment.semantics === BBOX_FILL_RATIO_SEMANTICS
      && decision.fill_ratio_assessment.exact_overlap_proof === false,
    `v3 pair decision ${index} fill-ratio assessment drifted.`);
    const matchingTrials = trials.filter((trial) => (
      trial.target_path === decision.target_path
      && trial.tool_path === decision.tool_path
      && trial.operation === decision.operation
    ));
    const exactNegative = matchingTrials.find(
      (trial) => trial.runtime_binding_status === 'exact_runtime_match'
    );
    const expectedEligible = basePair.atomic_boolean_trial_eligible
      && !exactNegative
      && !negativeSourceEvidenceUnverified
      && !runtimeDeltaRequiresReview
      && !expectedLowFill;
    assert(decision.atomic_boolean_trial_eligible === expectedEligible,
      `v3 pair decision ${index} eligibility drifted.`);
    assert(decision.status === (expectedEligible ? 'server_recommended' : 'blocked'),
      `v3 pair decision ${index} status drifted.`);
    assert(decision.exact_overlap_assessment.status === 'exact_overlap_unverified'
      && decision.exact_overlap_assessment.verified === false
      && decision.exact_overlap_assessment.bbox_fill_ratio_is_exact_overlap_proof === false,
    `v3 pair decision ${index} exact-overlap boundary drifted.`);
    if (negativeSourceEvidenceUnverified && matchingTrials.length > 0) {
      assert(decision.negative_atomic_trial.status === 'negative_source_evidence_unverified',
        `v3 pair decision ${index} trusted unverified negative evidence.`);
    } else if (exactNegative) {
      assert(decision.negative_atomic_trial.status === 'confirmed_precommit_abort_exact_runtime'
        && decision.blockers.includes('negative_atomic_trial_pair_excluded'),
      `v3 pair decision ${index} did not exclude its exact failed trial.`);
    }
    if (runtimeDeltaRequiresReview) {
      assert(decision.blockers.includes('runtime_delta_requires_review'),
        `v3 pair decision ${index} silently ignored runtime drift.`);
    }
    if (negativeSourceEvidenceUnverified) {
      assert(decision.blockers.includes('negative_source_evidence_unverified'),
        `v3 pair decision ${index} allowed unverified negative evidence to alter candidate policy.`);
    }
    if (expectedLowFill) {
      assert(decision.exact_overlap_assessment.evidence_requirement === 'needs_stronger_evidence'
        || runtimeDeltaRequiresReview
        || negativeSourceEvidenceUnverified
        || exactNegative,
      `v3 pair decision ${index} did not require stronger overlap evidence.`);
    }
  }

  const selectedPair = baseReview.review.blockers.length === 0
    && !negativeSourceEvidenceUnverified
    && !runtimeDeltaRequiresReview
    ? pairDecisions.find((entry) => entry.atomic_boolean_trial_eligible) || null
    : null;
  assert(review.review.status === (selectedPair ? 'server_recommended' : 'blocked'),
    'v3 review status drifted from pair decisions.');
  assert(stableCanonicalJson(review.review.recommended_proposal) === stableCanonicalJson(
    selectedPair ? buildV3RecommendedProposal(selectedPair) : null
  ), 'v3 recommended proposal drifted from pair decisions.');
  assert(review.next_action.runtime_delta_requires_review === runtimeDeltaRequiresReview
    && review.next_action.negative_trial_not_directly_reusable === runtimeDeltaRequiresReview,
  'v3 next_action runtime delta binding drifted.');
  if (negativeSourceEvidenceUnverified) {
    assert(review.next_action.action === 'verify_negative_source_evidence_before_candidate_policy',
      'v3 next_action must require negative evidence verification.');
  }
  assert(review.safety.queue_accessed === false
    && review.safety.model_mutation_authorized === false
    && review.safety.negative_source_evidence_bytes_verified === (
      trials.length === 0 || verifiedSourceEvidenceCount === trials.length
    )
    && review.safety.release_acceptance === false,
  'v3 safety boundary drifted.');
}

async function verifyNegativeAtomicTrialSourceEvidence(values) {
  assert(Array.isArray(values), 'negativeAtomicTrialLineages must be an array.');
  assert(values.length <= 100, 'negativeAtomicTrialLineages must not exceed 100 entries.');
  if (values.length === 0) return 0;
  const canonicalRepoRoot = await fs.realpath(repoRoot);
  let verifiedCount = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const label = `negativeAtomicTrialLineages[${index}].source_evidence`;
    assert(value && typeof value === 'object' && !Array.isArray(value),
      `negativeAtomicTrialLineages[${index}] must be an object.`);
    const evidence = value.source_evidence;
    assert(evidence && typeof evidence === 'object' && !Array.isArray(evidence),
      `${label} is required.`);
    const repoPath = safeRepoRelativePath(evidence.path, `${label}.path`);
    assertSha256(evidence.sha256, `${label}.sha256`);
    const expectedCanonicalPath = path.resolve(canonicalRepoRoot, repoPath);
    assert(pathIsWithin(canonicalRepoRoot, expectedCanonicalPath),
      `${label}.path must remain inside the repository.`);
    let fileStat;
    let canonicalFilePath;
    try {
      fileStat = await fs.lstat(path.resolve(repoRoot, repoPath));
      canonicalFilePath = await fs.realpath(path.resolve(repoRoot, repoPath));
    } catch {
      throw new Error(`${label}.path is not a readable repository evidence file.`);
    }
    assert(fileStat.isFile() && !fileStat.isSymbolicLink(),
      `${label}.path must be a regular non-symlink file.`);
    assert(canonicalFilePath === expectedCanonicalPath && pathIsWithin(canonicalRepoRoot, canonicalFilePath),
      `${label}.path must not traverse a symlink or escape the repository.`);
    let handle;
    let bytes;
    try {
      handle = await fs.open(
        path.resolve(repoRoot, repoPath),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
      );
      const openedStat = await handle.stat();
      assert(openedStat.isFile(), `${label}.path must remain a regular file while opened.`);
      bytes = await handle.readFile();
    } catch (error) {
      if (error?.message?.startsWith(label)) throw error;
      throw new Error(`${label}.path could not be opened as a regular non-symlink file.`);
    } finally {
      await handle?.close().catch(() => {});
    }
    const actualSha256 = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    assert(actualSha256 === evidence.sha256, `${label} hash mismatch.`);
    let publicEvidence;
    try {
      publicEvidence = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error(`${label} must contain valid JSON.`);
    }
    assertNegativeLineageMatchesPublicEvidence(value, publicEvidence, label);
    verifiedCount += 1;
  }
  return verifiedCount;
}

function assertNegativeLineageMatchesPublicEvidence(lineage, evidence, label) {
  const supported = SUPPORTED_NEGATIVE_EVIDENCE[evidence?.version];
  assert(supported && evidence.kind === supported.kind,
    `${label} uses an unsupported evidence version or kind.`);
  assert(lineage.case_id === supported.case_id
    && evidence.evidence_scope === supported.evidence_scope
    && evidence.source?.scope === supported.source_scope,
  `${label} case or disposable source scope mismatch.`);
  assert(evidence.result === 'confirmed_precommit_abort',
    `${label} result must be confirmed_precommit_abort.`);
  assert(lineage.source_sha256 === evidence.source?.sha256_after
    && evidence.source?.sha256_before === evidence.source?.sha256_after
    && evidence.source?.bytes_unchanged === true
    && evidence.source?.source_overwritten === false,
  `${label} disposable source SHA or unchanged-source contract mismatch.`);
  assert(lineage.model_revision === evidence.post_abort_model?.revision
    && evidence.post_abort_model?.revision_complete === true
    && evidence.post_abort_model?.model_modified === false
    && evidence.post_abort_model?.pair_baseline_unchanged === true,
  `${label} post-abort model revision or baseline contract mismatch.`);
  const expectedOperation = evidence.operation?.op === 'boolean_difference'
    ? 'difference'
    : evidence.operation?.op === 'boolean_intersect'
      ? 'intersect'
      : null;
  assert(lineage.operation === expectedOperation
    && lineage.target_path === evidence.operation?.target_path
    && Array.isArray(evidence.operation?.tool_paths)
    && evidence.operation.tool_paths.length === 1
    && lineage.tool_path === evidence.operation.tool_paths[0],
  `${label} directed operation target/tool binding mismatch.`);
  assert(lineage.plan_id === evidence.approval?.plan_id
    && lineage.plan_hash === evidence.approval?.plan_hash,
  `${label} plan id/hash binding mismatch.`);
  assert(lineage.runtime_source_hashes?.boolean_operations_sha256
      === evidence.runtime_contract?.boolean_operations_sha256
    && lineage.runtime_source_hashes?.model_revision_source_sha256
      === evidence.runtime_contract?.model_revision_source_sha256
    && evidence.runtime_contract?.historical_exact_loaded_runtime === true,
  `${label} historical loaded runtime source binding mismatch.`);
  assert(lineage.outcome?.error_code === evidence.failure?.error_code
    && lineage.outcome?.phase === evidence.failure?.phase
    && lineage.outcome?.commit_state === evidence.failure?.commit_state
    && lineage.outcome?.abort_succeeded === evidence.failure?.abort_succeeded
    && lineage.outcome?.outcome_unknown === evidence.failure?.outcome_unknown
    && lineage.outcome?.mutation_committed === evidence.failure?.mutation_committed
    && lineage.outcome?.rollback_confirmed === evidence.failure?.rollback_confirmed
    && lineage.outcome?.exact_solid_overlap_verified === evidence.failure?.exact_solid_overlap?.verified
    && evidence.failure?.evidence_conflict === false,
  `${label} precommit failure outcome binding mismatch.`);
  assert(lineage.retry_policy?.approval_status_after_failure === evidence.approval?.status_after_failure
    && lineage.retry_policy?.approval_reusable === evidence.approval?.approval_reusable
    && lineage.retry_policy?.same_task_retry_allowed === evidence.approval?.same_task_retry_allowed
    && lineage.retry_policy?.previous_plan_or_approval_replay_allowed
      === evidence.approval?.previous_plan_or_approval_replay_allowed
    && lineage.retry_policy?.automatic_retry_performed === evidence.failure?.automatic_retry_performed
    && lineage.retry_policy?.automatic_replay_performed === evidence.failure?.automatic_replay_performed
    && evidence.recovery?.new_review_required_before_any_retry === true,
  `${label} consumed-failure retry policy binding mismatch.`);
  assert(lineage.release_acceptance === false && evidence.release_acceptance === false,
    `${label} release acceptance must remain false.`);
}

function buildGeometryAttestations(adoption, baseReview, { modelRevision }) {
  const entriesByPath = new Map(
    adoption.structural_groups.entries.map((entry) => [String(entry.entity_path), entry])
  );
  return baseReview.review.candidates.map((candidate) => {
    const sourceEntry = entriesByPath.get(candidate.occurrence_path);
    assert(sourceEntry, `No structural source entry for ${candidate.occurrence_path}.`);
    const report = sourceEntry.manifold_attestation?.report;
    let exactSolidVolume = null;
    let provenance = 'not_available';
    if (report !== null && report !== undefined) {
      assert(report && typeof report === 'object' && !Array.isArray(report),
        `manifold report for ${candidate.occurrence_path} must be an object.`);
      if (candidate.manifold_attestation.status === 'fresh_manifold') {
        assert(report.checked === true,
          `manifold report for ${candidate.occurrence_path} must be checked.`);
        assert(report.entity_path === candidate.occurrence_path,
          `manifold report path mismatch for ${candidate.occurrence_path}.`);
        assert(report.model_revision === modelRevision,
          `manifold report revision mismatch for ${candidate.occurrence_path}.`);
        assert(report.is_manifold === true,
          `manifold report for ${candidate.occurrence_path} must attest a solid.`);
        assert(String(report.persistent_id) === candidate.persistent_id,
          `manifold report persistent id mismatch for ${candidate.occurrence_path}.`);
        for (const field of ['faces', 'edges', 'vertices']) {
          assert(report[field] === candidate[field],
            `manifold report ${field} mismatch for ${candidate.occurrence_path}.`);
        }
        assert(Number.isFinite(report.volume) && report.volume > 0,
          `manifold report volume for ${candidate.occurrence_path} must be positive and finite.`);
        assert(report.checks?.positive_volume === true,
          `manifold report for ${candidate.occurrence_path} must confirm positive volume.`);
        exactSolidVolume = report.volume;
        provenance = 'fresh_manifold_structural_attestation';
      }
    }
    const bboxFillRatio = exactSolidVolume === null || candidate.world_bbox_volume <= 0
      ? null
      : exactSolidVolume / candidate.world_bbox_volume;
    assert(bboxFillRatio === null || (Number.isFinite(bboxFillRatio) && bboxFillRatio > 0 && bboxFillRatio <= 1.000001),
      `bbox fill ratio for ${candidate.occurrence_path} is outside the physical range.`);
    return {
      occurrence_path: candidate.occurrence_path,
      entity_fingerprint: candidate.entity_fingerprint,
      manifold_status: candidate.manifold_attestation.status,
      exact_solid_volume: exactSolidVolume,
      exact_solid_volume_provenance: provenance,
      world_bbox_volume: candidate.world_bbox_volume,
      bbox_fill_ratio: bboxFillRatio,
      bbox_fill_ratio_semantics: BBOX_FILL_RATIO_SEMANTICS,
      exact_overlap_proof: false
    };
  });
}

function normalizeNegativeAtomicTrialLineages(values, context) {
  assert(Array.isArray(values), 'negativeAtomicTrialLineages must be an array.');
  assert(values.length <= 100, 'negativeAtomicTrialLineages must not exceed 100 entries.');
  const normalized = values.map((value, index) => normalizeNegativeAtomicTrialLineage(value, {
    ...context,
    index
  }));
  const duplicateKeys = duplicateValues(normalized.map((entry) => [
    entry.target_path,
    entry.tool_path,
    entry.plan_hash,
    entry.runtime_source_hashes.boolean_operations_sha256,
    entry.runtime_source_hashes.model_revision_source_sha256
  ].join('\u0000')));
  assert(duplicateKeys.length === 0, 'negativeAtomicTrialLineages contains duplicate bound trials.');
  return normalized;
}

function normalizeNegativeAtomicTrialLineage(value, {
  caseId,
  sourceSha256,
  modelRevision,
  operation,
  currentRuntimeSourceHashes,
  baseReview,
  sourceEvidenceBytesVerified,
  index
}) {
  const label = `negativeAtomicTrialLineages[${index}]`;
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  assert(value.version === NEGATIVE_ATOMIC_TRIAL_LINEAGE_VERSION,
    `${label}.version must be ${NEGATIVE_ATOMIC_TRIAL_LINEAGE_VERSION}.`);
  assert(value.kind === 'negative_atomic_trial_lineage',
    `${label}.kind must be negative_atomic_trial_lineage.`);
  assert(value.case_id === caseId, `${label}.case_id must match caseId.`);
  assert(value.source_sha256 === sourceSha256, `${label}.source_sha256 must match sourceSha256.`);
  assert(value.model_revision === modelRevision, `${label}.model_revision must match modelRevision.`);
  assert(value.operation === operation, `${label}.operation must match operation.`);
  const targetPath = exactPath(value.target_path, `${label}.target_path`);
  const toolPath = exactPath(value.tool_path, `${label}.tool_path`);
  assert(targetPath !== toolPath, `${label} target and tool paths must differ.`);
  assert(baseReview.review.pair_evaluations.some((pair) => (
    pair.operation === operation
    && pair.target.occurrence_path === targetPath
    && pair.tool.occurrence_path === toolPath
  )), `${label} target/tool pair is not present in the bound recursive review.`);
  const planId = boundedRequiredString(value.plan_id, `${label}.plan_id`, 240);
  assertSha256(value.plan_hash, `${label}.plan_hash`);
  const evidence = value.source_evidence;
  assert(evidence && typeof evidence === 'object' && !Array.isArray(evidence),
    `${label}.source_evidence is required.`);
  const evidencePath = safeRepoRelativePath(evidence.path, `${label}.source_evidence.path`);
  assertSha256(evidence.sha256, `${label}.source_evidence.sha256`);
  const trialRuntime = normalizeRuntimeSourceHashes(value.runtime_source_hashes, `${label}.runtime_source_hashes`);
  const runtimeDeltaFields = ['boolean_operations_sha256', 'model_revision_source_sha256']
    .filter((field) => trialRuntime[field] !== currentRuntimeSourceHashes[field]);
  const outcome = value.outcome;
  assert(outcome && typeof outcome === 'object' && !Array.isArray(outcome), `${label}.outcome is required.`);
  assert(outcome.error_code === 'MUTATION_EXECUTION_FAILED',
    `${label}.outcome.error_code must be MUTATION_EXECUTION_FAILED.`);
  assert(outcome.phase === 'precommit_execution',
    `${label}.outcome.phase must be precommit_execution.`);
  assert(outcome.commit_state === 'not_committed',
    `${label}.outcome.commit_state must be not_committed.`);
  assert(outcome.abort_succeeded === true, `${label}.outcome.abort_succeeded must be true.`);
  assert(outcome.outcome_unknown === false, `${label}.outcome.outcome_unknown must be false.`);
  assert(outcome.mutation_committed === false, `${label}.outcome.mutation_committed must be false.`);
  assert(outcome.rollback_confirmed === true, `${label}.outcome.rollback_confirmed must be true.`);
  assert(outcome.exact_solid_overlap_verified === false,
    `${label}.outcome.exact_solid_overlap_verified must be false.`);
  const retry = value.retry_policy;
  assert(retry && typeof retry === 'object' && !Array.isArray(retry), `${label}.retry_policy is required.`);
  assert(retry.approval_status_after_failure === 'consumed_failed',
    `${label}.retry_policy.approval_status_after_failure must be consumed_failed.`);
  for (const field of [
    'approval_reusable',
    'same_task_retry_allowed',
    'previous_plan_or_approval_replay_allowed',
    'automatic_retry_performed',
    'automatic_replay_performed'
  ]) {
    assert(retry[field] === false, `${label}.retry_policy.${field} must be false.`);
  }
  assert(value.release_acceptance === false, `${label}.release_acceptance must be false.`);
  const bound = {
    case_id: caseId,
    source_sha256: sourceSha256,
    model_revision: modelRevision,
    operation,
    target_path: targetPath,
    tool_path: toolPath,
    plan_id: planId,
    plan_hash: value.plan_hash,
    source_evidence: {
      path: evidencePath,
      sha256: evidence.sha256
    },
    runtime_source_hashes: trialRuntime,
    outcome: {
      error_code: outcome.error_code,
      phase: outcome.phase,
      commit_state: outcome.commit_state,
      abort_succeeded: true,
      outcome_unknown: false,
      mutation_committed: false,
      rollback_confirmed: true,
      exact_solid_overlap_verified: false
    },
    retry_policy: {
      approval_status_after_failure: retry.approval_status_after_failure,
      approval_reusable: false,
      same_task_retry_allowed: false,
      previous_plan_or_approval_replay_allowed: false,
      automatic_retry_performed: false,
      automatic_replay_performed: false
    },
    release_acceptance: false
  };
  return {
    lineage_sha256: hashCanonical({
      version: NEGATIVE_ATOMIC_TRIAL_LINEAGE_VERSION,
      kind: 'negative_atomic_trial_lineage',
      ...bound
    }),
    ...bound,
    source_evidence: {
      ...bound.source_evidence,
      verification: sourceEvidenceBytesVerified
        ? 'verified_repo_regular_file_and_bound_content'
        : 'not_verified_pure_derivation'
    },
    runtime_binding_status: runtimeDeltaFields.length === 0
      ? 'exact_runtime_match'
      : 'runtime_delta_requires_review',
    runtime_delta_fields: runtimeDeltaFields,
    pair_present_in_base_review: true,
    failed_plan_replay_allowed: false
  };
}

function normalizeRuntimeSourceHashes(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is required.`);
  assertSha256(value.boolean_operations_sha256, `${label}.boolean_operations_sha256`);
  assertSha256(value.model_revision_source_sha256, `${label}.model_revision_source_sha256`);
  return {
    boolean_operations_sha256: value.boolean_operations_sha256,
    model_revision_source_sha256: value.model_revision_source_sha256
  };
}

function buildV3RecommendedProposal(pair) {
  return {
    operation: pair.operation,
    status: 'server_recommended',
    base_pair_rank: pair.base_rank,
    target_path: pair.target_path,
    tool_path: pair.tool_path,
    scope_path: pair.scope_path,
    parent_entity_path: pair.parent_entity_path,
    bbox_relation: pair.bbox_relation,
    positive_bbox_overlap: true,
    bbox_overlap_volume: pair.bbox_overlap_volume,
    exact_overlap_assessment: structuredClone(pair.exact_overlap_assessment),
    atomic_boolean_trial_eligible: true,
    role_provenance: pair.role_provenance,
    confirmed: false,
    authorized: false,
    trusted_approval_required: true
  };
}

function normalizeStructuralGroup(entry, { modelRevision, index }) {
  assert(entry && typeof entry === 'object' && !Array.isArray(entry),
    `structural_groups.entries[${index}] must be an object.`);
  const entityPath = exactPath(entry.entity_path, `structural_groups.entries[${index}].entity_path`);
  const parentEntityPath = entry.parent_entity_path === null || entry.parent_entity_path === undefined
    ? null
    : exactPath(entry.parent_entity_path, `structural_groups.entries[${index}].parent_entity_path`);
  const scopePath = exactPath(entry.scope_path, `structural_groups.entries[${index}].scope_path`);
  const persistentId = normalizePersistentId(entry.persistent_id);
  const pathSegments = normalizePathSegments(entry.path_segments, index);
  assert(persistentId, `structural_groups.entries[${index}].persistent_id must be a positive integer string.`);
  assertCanonicalOccurrenceBinding({
    entityPath,
    parentEntityPath,
    scopePath,
    persistentId,
    pathSegments,
    index
  });
  const parentBoundingBox = normalizeBoundingBox(entry.parent_bounding_box);
  const worldBoundingBox = normalizeBoundingBox(entry.world_bounding_box);
  const faces = nonnegativeSafeInteger(entry.faces, `structural_groups.entries[${index}].faces`);
  const edges = nonnegativeSafeInteger(entry.edges, `structural_groups.entries[${index}].edges`);
  const vertices = nonnegativeSafeInteger(entry.vertices, `structural_groups.entries[${index}].vertices`);
  const visible = requiredBoolean(entry.visible, `structural_groups.entries[${index}].visible`);
  const locked = requiredBoolean(entry.locked, `structural_groups.entries[${index}].locked`);
  const effectiveVisible = requiredBoolean(
    entry.effective_visible,
    `structural_groups.entries[${index}].effective_visible`
  );
  const effectiveLocked = requiredBoolean(
    entry.effective_locked,
    `structural_groups.entries[${index}].effective_locked`
  );
  const affectedInstanceCount = nonnegativeSafeInteger(
    entry.affected_instance_count,
    `structural_groups.entries[${index}].affected_instance_count`
  );
  const sharedDefinition = requiredBoolean(
    entry.shared_definition,
    `structural_groups.entries[${index}].shared_definition`
  );
  const instancePolicyRequired = requiredBoolean(
    entry.instance_policy_required,
    `structural_groups.entries[${index}].instance_policy_required`
  );
  const manifoldAttestation = normalizeManifoldAttestation(entry.manifold_attestation, {
    entityPath,
    modelRevision
  });
  const exclusionReasons = [];
  if (!visible || !effectiveVisible) exclusionReasons.push('effectively_hidden');
  if (locked || effectiveLocked) exclusionReasons.push('effectively_locked');
  if (faces === 0) exclusionReasons.push('no_direct_faces');
  if (!worldBoundingBox || !positiveBoundingBox(worldBoundingBox)) exclusionReasons.push('invalid_world_bounding_box');
  const display = {
    name: nullableUntrustedString(entry.name ?? entry.untrusted_display?.name),
    material: nullableUntrustedString(entry.material ?? entry.untrusted_display?.material),
    tag: nullableUntrustedString(entry.tag ?? entry.untrusted_display?.tag),
    trust: 'untrusted_data'
  };
  const boundingBoxSha256 = worldBoundingBox ? hashCanonical(worldBoundingBox) : null;
  const materialExpectationSha256 = hashCanonical({ material: display.material, trust: display.trust });
  const entityFingerprint = hashCanonical({
    model_revision: modelRevision,
    entity_path: entityPath,
    parent_entity_path: parentEntityPath,
    scope_path: scopePath,
    persistent_id: persistentId,
    path_segments: pathSegments,
    faces,
    edges,
    vertices,
    world_bounding_box: worldBoundingBox,
    visible,
    locked,
    effective_visible: effectiveVisible,
    effective_locked: effectiveLocked,
    affected_instance_count: affectedInstanceCount,
    shared_definition: sharedDefinition,
    instance_policy_required: instancePolicyRequired
  });
  return {
    entity_type: 'group',
    entity_path: entityPath,
    occurrence_path: entityPath,
    parent_entity_path: parentEntityPath,
    scope_path: scopePath,
    persistent_id: persistentId,
    path_segments: pathSegments,
    entity_fingerprint: entityFingerprint,
    bounding_box_sha256: boundingBoxSha256,
    material_expectation_sha256: materialExpectationSha256,
    display,
    visible,
    locked,
    effective_visible: effectiveVisible,
    effective_locked: effectiveLocked,
    faces,
    edges,
    vertices,
    parent_bounding_box: parentBoundingBox,
    world_bounding_box: worldBoundingBox,
    world_bbox_volume: worldBoundingBox && positiveBoundingBox(worldBoundingBox) ? boundingVolume(worldBoundingBox) : 0,
    affected_instance_count: affectedInstanceCount,
    shared_definition: sharedDefinition,
    instance_policy_required: instancePolicyRequired,
    manifold_attestation: manifoldAttestation,
    pair_review_eligible: exclusionReasons.length === 0,
    exclusion_reasons: exclusionReasons
  };
}

function normalizeManifoldAttestation(value, { entityPath, modelRevision }) {
  const attestation = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const claimedFresh = attestation.fresh === true
    || ['fresh', 'fresh_matched', 'matched'].includes(attestation.status);
  const claimedMatched = attestation.matched === true
    || ['fresh_matched', 'matched'].includes(attestation.status)
    || (claimedFresh && typeof attestation.is_manifold === 'boolean');
  const rawAttestedPath = attestation.entity_path ?? attestation.occurrence_path ?? attestation.path;
  const attestedPath = typeof rawAttestedPath === 'string'
    ? boundedClaim(rawAttestedPath, 2_048)
    : null;
  const attestedRevision = typeof attestation.model_revision === 'string'
    ? boundedClaim(attestation.model_revision, 200)
    : null;
  const exactPathMatch = claimedFresh && claimedMatched && attestedPath === entityPath;
  const modelRevisionMatch = claimedFresh && claimedMatched && attestedRevision === modelRevision;
  const exactFreshMatch = exactPathMatch && modelRevisionMatch && typeof attestation.is_manifold === 'boolean';
  const isManifold = exactFreshMatch ? attestation.is_manifold : null;
  const status = !claimedFresh && !claimedMatched
    ? 'not_observed'
    : !exactFreshMatch
      ? 'unmatched'
      : isManifold
        ? 'fresh_manifold'
        : 'fresh_non_manifold';
  return {
    status,
    attested_entity_path: attestedPath,
    attested_model_revision: attestedRevision,
    exact_path_match: exactPathMatch,
    model_revision_match: modelRevisionMatch,
    exact_fresh_match: exactFreshMatch,
    is_manifold: isManifold
  };
}

function evaluateCandidatePairs(candidates, { operation, pairEvaluationLimit }) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.scope_path}\u0000${candidate.parent_entity_path || ''}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(candidate);
  }
  const evaluations = [];
  let budgetExhausted = false;
  const keys = [...grouped.keys()].sort(compareText);
  const sameParentScopePairCount = keys.reduce((sum, key) => {
    const count = grouped.get(key).length;
    return sum + (count * (count - 1)) / 2;
  }, 0);
  outer: for (const key of keys) {
    const sorted = grouped.get(key).slice().sort(compareSweepCandidate);
    let active = [];
    for (const current of sorted) {
      active = active.filter((entry) => entry.world_bounding_box.max[0] >= current.world_bounding_box.min[0]);
      for (const other of active) {
        if (evaluations.length >= pairEvaluationLimit) {
          budgetExhausted = true;
          break outer;
        }
        evaluations.push(evaluateDirectedPair(other, current, operation));
      }
      active.push(current);
    }
  }
  evaluations.sort(comparePairEvaluation);
  return { evaluations, budgetExhausted, sameParentScopePairCount };
}

function evaluateDirectedPair(left, right, operation) {
  const [target, tool] = orientTargetAndTool(left, right);
  const spatial = classifyBoundingBoxRelation(target.world_bounding_box, tool.world_bounding_box);
  const targetFresh = target.manifold_attestation.status === 'fresh_manifold';
  const toolFresh = tool.manifold_attestation.status === 'fresh_manifold';
  const targetFreshNonManifold = target.manifold_attestation.status === 'fresh_non_manifold';
  const toolFreshNonManifold = tool.manifold_attestation.status === 'fresh_non_manifold';
  const blockers = [];
  if (!spatial.positive_bbox_overlap) blockers.push('positive_bbox_overlap_required');
  if (!targetFresh) {
    blockers.push(targetFreshNonManifold ? 'target_non_manifold' : 'target_fresh_manifold_required');
  }
  if (!toolFresh) {
    blockers.push(toolFreshNonManifold ? 'tool_non_manifold' : 'tool_fresh_manifold_required');
  }
  const atomicBooleanTrialEligible = spatial.positive_bbox_overlap && targetFresh && toolFresh;
  return {
    operation,
    status: 'blocked',
    rank: 0,
    scope_path: target.scope_path,
    parent_entity_path: target.parent_entity_path,
    bbox_relation: spatial.bbox_relation,
    bbox_containment_direction: directedContainmentDirection(spatial.bbox_containment_direction),
    bbox_axis_overlaps: spatial.bbox_axis_overlaps,
    positive_bbox_overlap: spatial.positive_bbox_overlap,
    bbox_overlap_bounding_box: spatial.bbox_overlap_bounding_box,
    bbox_overlap_volume: spatial.bbox_overlap_volume,
    target_bbox_volume: target.world_bbox_volume,
    tool_bbox_volume: tool.world_bbox_volume,
    both_fresh_manifold: targetFresh && toolFresh,
    exact_solid_overlap: {
      status: 'unverified_before_atomic_trial',
      verified: false,
      verification_stage: 'review_gated_atomic_apply'
    },
    atomic_boolean_trial_eligible: atomicBooleanTrialEligible,
    target: pairEndpoint(target),
    tool: pairEndpoint(tool),
    rank_basis: [
      'both_fresh_manifold_desc',
      'positive_bbox_overlap_desc',
      'target_bbox_volume_desc',
      'tool_bbox_volume_asc',
      'canonical_occurrence_paths_asc'
    ],
    role_provenance: 'server_geometric_ranking_untrusted_unapproved',
    blockers
  };
}

function pairEndpoint(candidate) {
  return {
    occurrence_path: candidate.occurrence_path,
    entity_path: candidate.entity_path,
    persistent_id: candidate.persistent_id,
    entity_fingerprint: candidate.entity_fingerprint,
    bounding_box: candidate.world_bounding_box,
    bounding_box_sha256: candidate.bounding_box_sha256,
    material_expectation_sha256: candidate.material_expectation_sha256,
    display: {
      material: candidate.display.material,
      trust: 'untrusted_data'
    },
    manifold_attestation: candidate.manifold_attestation
  };
}

function buildRecommendedProposal(pair) {
  return {
    operation: pair.operation,
    status: 'server_recommended',
    scope_path: pair.scope_path,
    parent_entity_path: pair.parent_entity_path,
    bbox_relation: pair.bbox_relation,
    positive_bbox_overlap: true,
    bbox_overlap_bounding_box: pair.bbox_overlap_bounding_box,
    bbox_overlap_volume: pair.bbox_overlap_volume,
    exact_solid_overlap: structuredClone(pair.exact_solid_overlap),
    atomic_boolean_trial_eligible: true,
    target: structuredClone(pair.target),
    tool: structuredClone(pair.tool),
    role_provenance: pair.role_provenance,
    confirmed: false,
    authorized: false,
    trusted_approval_required: true
  };
}

function orientTargetAndTool(left, right) {
  const volumeDifference = right.world_bbox_volume - left.world_bbox_volume;
  if (volumeDifference > 0) return [right, left];
  if (volumeDifference < 0) return [left, right];
  return compareText(left.entity_path, right.entity_path) <= 0 ? [left, right] : [right, left];
}

function comparePairEvaluation(left, right) {
  return Number(right.both_fresh_manifold) - Number(left.both_fresh_manifold)
    || Number(right.positive_bbox_overlap) - Number(left.positive_bbox_overlap)
    || right.target_bbox_volume - left.target_bbox_volume
    || left.tool_bbox_volume - right.tool_bbox_volume
    || compareText(left.target.occurrence_path, right.target.occurrence_path)
    || compareText(left.tool.occurrence_path, right.tool.occurrence_path);
}

function compareSweepCandidate(left, right) {
  return left.world_bounding_box.min[0] - right.world_bounding_box.min[0]
    || left.world_bounding_box.max[0] - right.world_bounding_box.max[0]
    || compareText(left.entity_path, right.entity_path);
}

function compareCandidatePath(left, right) {
  return compareText(left.scope_path, right.scope_path)
    || compareNullableText(left.parent_entity_path, right.parent_entity_path)
    || compareText(left.entity_path, right.entity_path);
}

function directedContainmentDirection(value) {
  if (value === 'left_contains_right') return 'target_contains_tool';
  if (value === 'right_contains_left') return 'tool_contains_target';
  return value;
}

function countPairScopes(candidates) {
  return new Set(candidates.map((entry) => `${entry.scope_path}\u0000${entry.parent_entity_path || ''}`)).size;
}

function normalizeBoundingBox(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const min = finiteVector3(value.min);
  const max = finiteVector3(value.max);
  if (!min || !max || [0, 1, 2].some((axis) => min[axis] > max[axis])) return null;
  return boundingBoxFromMinMax(min, max);
}

function boundingBoxFromMinMax(min, max) {
  return {
    min: [...min],
    max: [...max],
    w: max[0] - min[0],
    d: max[1] - min[1],
    h: max[2] - min[2]
  };
}

function positiveBoundingBox(value) {
  return value !== null && value.w > 0 && value.d > 0 && value.h > 0;
}

function boundingVolume(value) {
  return value.w * value.d * value.h;
}

function containsBox(outer, inner) {
  return [0, 1, 2].every((axis) => outer.min[axis] <= inner.min[axis] && outer.max[axis] >= inner.max[axis]);
}

function finiteVector3(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every(Number.isFinite) ? [...value] : null;
}

function normalizePathSegments(value, entryIndex) {
  assert(Array.isArray(value) && value.length > 0 && value.length <= 128,
    `structural_groups.entries[${entryIndex}].path_segments must contain 1..128 canonical segments.`);
  return value.map((segment, segmentIndex) => {
    const label = `structural_groups.entries[${entryIndex}].path_segments[${segmentIndex}]`;
    assert(segment && typeof segment === 'object' && !Array.isArray(segment), `${label} must be an object.`);
    assert(segment.entity_type === 'group' || segment.entity_type === 'component_instance',
      `${label}.entity_type must be group or component_instance.`);
    const persistentId = normalizePersistentId(segment.persistent_id);
    assert(persistentId, `${label}.persistent_id must be a positive integer string.`);
    return {
      entity_type: segment.entity_type,
      persistent_id: persistentId,
      reference: nullableReference(segment.reference, `${label}.reference`)
    };
  });
}

function assertCanonicalOccurrenceBinding({
  entityPath,
  parentEntityPath,
  scopePath,
  persistentId,
  pathSegments,
  index
}) {
  const label = `structural_groups.entries[${index}]`;
  const canonicalEntityPath = `pid:${pathSegments.map((segment) => segment.persistent_id).join('.')}`;
  assert(/^pid:[1-9][0-9]*(?:\.[1-9][0-9]*)*$/.test(entityPath), `${label}.entity_path must be a canonical pid path.`);
  assert(entityPath === canonicalEntityPath, `${label}.entity_path must exactly match path_segments.`);
  const finalSegment = pathSegments[pathSegments.length - 1];
  assert(finalSegment.entity_type === 'group', `${label}.path_segments final segment must be a group.`);
  assert(finalSegment.persistent_id === persistentId,
    `${label}.persistent_id must match the final path segment.`);
  const expectedParent = pathSegments.length > 1
    ? `pid:${pathSegments.slice(0, -1).map((segment) => segment.persistent_id).join('.')}`
    : null;
  assert(parentEntityPath === expectedParent, `${label}.parent_entity_path must match the canonical path prefix.`);
  const expectedScope = expectedParent || 'model';
  assert(scopePath === expectedScope, `${label}.scope_path must equal parent_entity_path or model at top level.`);
}

function nullableReference(value, label) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  assert(text.length > 0 && text.length <= 240 && !/[\u0000-\u001f\u007f]/.test(text), `${label} is invalid.`);
  return text;
}

function requiredBoolean(value, label) {
  assert(typeof value === 'boolean', `${label} must be boolean.`);
  return value;
}

function exactPath(value, label) {
  const text = String(value ?? '');
  assert(text.length > 0 && text.length <= 2_048 && !/[\u0000-\u001f\u007f]/.test(text), `${label} is invalid.`);
  return text;
}

function normalizePersistentId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  const text = String(value ?? '');
  return /^[1-9][0-9]*$/.test(text) ? text : null;
}

function nullableUntrustedString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, MAX_DISPLAY_CHARS);
  return text || null;
}

function nullableBoundedIdentifier(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, 240);
  return text || null;
}

function boundedClaim(value, maxChars) {
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, maxChars);
  return text || null;
}

function boundedRequiredString(value, label, maxChars) {
  assert(typeof value === 'string'
    && value.length > 0
    && value.length <= maxChars
    && !/[\u0000-\u001f\u007f]/.test(value), `${label} is invalid.`);
  return value;
}

function safeRepoRelativePath(value, label) {
  const text = boundedRequiredString(value, label, 1_024);
  assert(!path.isAbsolute(text), `${label} must be repository-relative.`);
  const normalized = path.posix.normalize(text.replaceAll('\\', '/'));
  assert(normalized === text && normalized !== '..' && !normalized.startsWith('../'),
    `${label} must not escape the repository.`);
  return normalized;
}

function pathIsWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(compareText);
}

function orderedUnique(values) {
  const unique = [...new Set(values)];
  return unique.sort((left, right) => {
    const leftOrder = BLOCKER_ORDER.indexOf(left);
    const rightOrder = BLOCKER_ORDER.indexOf(right);
    if (leftOrder !== -1 || rightOrder !== -1) {
      return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder)
        - (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
    }
    return compareText(left, right);
  });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableText(left, right) {
  return compareText(left || '', right || '');
}

function hashCanonical(value) {
  return `sha256:${crypto.createHash('sha256').update(stableCanonicalJson(value)).digest('hex')}`;
}

function stableCanonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort(compareText);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(value[key])}`).join(',')}}`;
}

function requiredPath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} is required.`);
  return path.resolve(value);
}

function assertSha256(value, label) {
  assert(SHA256_PATTERN.test(String(value || '')), `${label} must be a sha256:<64 lowercase hex> digest.`);
}

function positiveSafeInteger(value, label) {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
    `${label} must be a positive safe integer.`);
  return value;
}

function nonnegativeSafeInteger(value, label) {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    `${label} must be a non-negative safe integer.`);
  return value;
}

function nullableNonnegativeSafeInteger(value, label) {
  if (value === null || value === undefined) return null;
  return nonnegativeSafeInteger(value, label);
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  assert(!Number.isNaN(date.getTime()), 'now() must return a valid date.');
  return date.toISOString();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function writeJsonAtomic(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}
