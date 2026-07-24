import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildRealModelCandidateReview,
  verifyRealModelCandidateReviewBindings
} from './real-model-candidate-review.mjs';

const PRODUCT_CASE_ID = 'product-boolean-manifold';
const BASE_CANDIDATE_COUNT = 5;
const AGGREGATE_CANDIDATE_COUNT = 6;
const FORMAL_CASE_COUNT = 7;
const PRODUCT_REQUIRED_TARGET_ROLES = Object.freeze(['boolean_target', 'boolean_tool']);
const PRODUCT_BLOCKERS = Object.freeze([
  'formal_sidecar_missing',
  'reviewed_target_roles_missing',
  'boolean_target_unconfirmed',
  'boolean_tool_unconfirmed',
  'required_material_selection_missing',
  'boolean_manifold_mutation_not_verified',
  'save_reopen_identity_not_verified'
]);

/**
 * Verify raw file hashes for an amendment and return the parsed base/current
 * documents. The historical mapping remains the authority for its own four
 * bound documents; the amendment binds only the immutable base mapping, the
 * additive six-candidate inventory, the read-only target review, and the same
 * formal manifest.
 */
export async function verifyRealModelCandidateReviewAmendmentBindings({ amendment, rootDir }) {
  const root = path.resolve(rootDir);
  const realRoot = await fs.realpath(root);
  const baseMapping = await readBoundJson({
    root,
    realRoot,
    binding: amendment?.bindings?.base_mapping,
    label: 'base_mapping'
  });
  const baseDocuments = await verifyRealModelCandidateReviewBindings({ mapping: baseMapping, rootDir: root });
  const candidateInventory = await readBoundJson({
    root,
    realRoot,
    binding: amendment?.bindings?.candidate_inventory,
    label: 'candidate_inventory'
  });
  const targetReview = await readBoundJson({
    root,
    realRoot,
    binding: amendment?.bindings?.target_review,
    label: 'target_review'
  });
  const amendmentManifest = amendment?.bindings?.formal_manifest;
  const baseManifest = baseMapping?.bindings?.formal_manifest;
  amendmentAssert(
    sameBinding(amendmentManifest, baseManifest),
    'amendment formal_manifest binding must exactly match the immutable base mapping'
  );
  const formalManifest = await readBoundJson({
    root,
    realRoot,
    binding: amendmentManifest,
    label: 'formal_manifest'
  });
  amendmentAssert(
    JSON.stringify(formalManifest) === JSON.stringify(baseDocuments.formal_manifest),
    'amendment and base mapping resolved different formal manifests'
  );
  return {
    base_mapping: baseMapping,
    base_inventory: baseDocuments.inventory,
    base_profile: baseDocuments.profile,
    base_live_evidence: baseDocuments.live_evidence,
    formal_manifest: formalManifest,
    candidate_inventory: candidateInventory,
    target_review: targetReview
  };
}

/**
 * Compose the historical 5-candidate review with one user-confirmed product
 * candidate. Read-only target suggestions are deliberately ignored as
 * authorization: boolean_target and boolean_tool remain human-review blockers.
 */
export function buildRealModelCandidateReviewAggregate({
  amendment,
  baseMapping,
  baseInventory,
  baseProfile,
  baseLiveEvidence,
  manifest,
  candidateInventory,
  targetReview
}) {
  assertAmendmentAuthority(amendment);
  const baseReport = buildRealModelCandidateReview({
    mapping: baseMapping,
    inventory: baseInventory,
    profile: baseProfile,
    liveEvidence: baseLiveEvidence,
    manifest
  });
  amendmentAssert(baseReport.summary.candidates === BASE_CANDIDATE_COUNT, 'base mapping must contain exactly five candidates');
  amendmentAssert(baseReport.summary.confirmed_candidates === BASE_CANDIDATE_COUNT, 'all five base candidates must remain confirmed');
  amendmentAssert(baseReport.summary.formal_cases === FORMAL_CASE_COUNT, 'base manifest must contain seven formal cases');
  amendmentAssert(baseReport.summary.semantically_mapped_cases === 6, 'base mapping must retain the historical 6/7 semantic result');

  assertManifestBinding(amendment, baseMapping);
  const addedCandidate = assertAdditiveInventory({ baseInventory, candidateInventory, amendment });
  assertTargetReview({ targetReview, addedCandidate, amendment });
  const productCase = manifest.cases.find((entry) => entry.id === PRODUCT_CASE_ID);
  amendmentAssert(productCase, `formal manifest is missing ${PRODUCT_CASE_ID}`);
  amendmentAssert(productCase.domain === 'product', `${PRODUCT_CASE_ID} must remain in the product domain`);
  amendmentAssert(productCase.tasks.includes('boolean_manifold'), `${PRODUCT_CASE_ID} must retain boolean_manifold`);
  amendmentAssert(productCase.tasks.includes('material_preservation'), `${PRODUCT_CASE_ID} must retain material_preservation`);
  amendmentAssert(productCase.tasks.includes('save_reopen_identity'), `${PRODUCT_CASE_ID} must retain save_reopen_identity`);

  const productReview = {
    case_id: PRODUCT_CASE_ID,
    domain: productCase.domain,
    status: 'blocked_missing_reviewed_targets',
    mapped_candidates: [{
      candidate_id: addedCandidate.candidate_id,
      candidate_handle: addedCandidate.candidate_handle,
      source_sha256: addedCandidate.source.sha256,
      source_label: addedCandidate.source.relative_path,
      role: 'primary'
    }],
    required_target_roles: [...PRODUCT_REQUIRED_TARGET_ROLES],
    structural_evidence: normalizeTargetReviewStructure(targetReview.structure),
    blockers: [...PRODUCT_BLOCKERS],
    formal_sidecar_ready: false
  };

  const caseReviews = baseReport.case_reviews.map((review) =>
    review.case_id === PRODUCT_CASE_ID ? productReview : structuredClone(review)
  );
  amendmentAssert(caseReviews.length === FORMAL_CASE_COUNT, 'aggregate must contain seven formal case reviews');
  amendmentAssert(new Set(caseReviews.map((entry) => entry.case_id)).size === FORMAL_CASE_COUNT, 'aggregate formal case ids must be unique');
  amendmentAssert(caseReviews.every((entry) => entry.mapped_candidates.length > 0), 'aggregate cannot contain an unmapped formal case');

  return {
    version: 'real-model-candidate-review-aggregate.v1',
    kind: 'real_model_candidate_review_aggregate',
    generated_on: amendment.created_on,
    evidence_scope: 'base_five_candidate_evidence_plus_hash_bound_read_only_target_review',
    bindings: structuredClone(amendment.bindings),
    lineage: {
      base_mapping_version: baseMapping.version,
      amendment_version: amendment.version,
      base_candidates: BASE_CANDIDATE_COUNT,
      added_candidates: 1,
      total_candidates: AGGREGATE_CANDIDATE_COUNT
    },
    summary: {
      candidates: AGGREGATE_CANDIDATE_COUNT,
      confirmed_candidates: AGGREGATE_CANDIDATE_COUNT,
      formal_cases: FORMAL_CASE_COUNT,
      semantically_mapped_cases: FORMAL_CASE_COUNT,
      unmapped_cases: 0,
      formal_sidecars_ready: 0,
      formal_sidecars_generated: 0
    },
    target_review: {
      candidate_id: addedCandidate.candidate_id,
      candidate_handle: addedCandidate.candidate_handle,
      source_sha256: addedCandidate.source.sha256,
      status: 'read_only_verified',
      target_roles_confirmed: false,
      suggestions_authoritative: false
    },
    case_reviews: caseReviews,
    safety: {
      aggregation_live_queue_called: false,
      source_target_review_read_only: true,
      model_mutation_authorized: false,
      model_mutation_performed: false,
      approval_token_issued: false,
      execution_policy_changed: false,
      target_roles_confirmed: false,
      formal_sidecar_auto_generated: false,
      release_acceptance: false
    },
    next_action: {
      action: 'collect_reviewed_target_roles_and_prepare_disposable_formal_fixtures',
      human_input_required: true,
      required_decisions: aggregateRemainingDecisions(amendment, baseMapping)
    }
  };
}

function assertAmendmentAuthority(amendment) {
  amendmentAssert(amendment?.version === 'real-model-candidate-semantic-mapping-amendment.v1', 'unsupported amendment version');
  amendmentAssert(amendment?.kind === 'real_model_candidate_semantic_mapping_amendment', 'unsupported amendment kind');
  amendmentAssert(amendment?.decision_scope === 'semantic_candidate_mapping_addition_only', 'amendment scope must be semantic addition only');
  amendmentAssert(amendment?.authority?.source === 'interactive_user_confirmation', 'amendment must originate from interactive user confirmation');
  amendmentAssert(amendment?.authority?.user_confirmed === true, 'product candidate mapping must be user confirmed');
  amendmentAssert(amendment?.authority?.mutation_authorized === false, 'amendment cannot authorize mutation');
  amendmentAssert(amendment?.authority?.approval_token_issued === false, 'amendment cannot issue approval tokens');
  amendmentAssert(amendment?.authority?.execution_policy_changed === false, 'amendment cannot change execution policy');
  amendmentAssert(amendment?.authority?.target_roles_confirmed === false, 'read-only target review cannot confirm target roles');
  amendmentAssert(amendment?.authority?.model_content_trust === 'untrusted_data', 'model content must remain untrusted data');
  amendmentAssert(amendment?.target_review_disposition?.target_roles_confirmed === false, 'target roles must remain unconfirmed');
  amendmentAssert(amendment?.target_review_disposition?.boolean_target_confirmed === false, 'boolean_target must remain unconfirmed');
  amendmentAssert(amendment?.target_review_disposition?.boolean_tool_confirmed === false, 'boolean_tool must remain unconfirmed');
  amendmentAssert(amendment?.target_review_disposition?.selection_authority_granted === false, 'target review cannot grant selection authority');
  const assignment = amendment?.addition?.assignments;
  amendmentAssert(Array.isArray(assignment) && assignment.length === 1, 'amendment must add exactly one formal-case assignment');
  amendmentAssert(assignment[0]?.case_id === PRODUCT_CASE_ID, `amendment may only add ${PRODUCT_CASE_ID}`);
  amendmentAssert(assignment[0]?.role === 'primary', 'product candidate must be a primary mapping');
  amendmentAssert(assignment[0]?.review_status === 'user_confirmed', 'product candidate mapping must be user confirmed');
  for (const required of ['boolean_target', 'boolean_tool', 'required_material_selection', 'formal_persistent_target_roles', 'formal_sidecar']) {
    amendmentAssert(amendment?.remaining_requirements?.includes(required), `amendment must retain ${required} as unresolved`);
  }
  amendmentAssert(amendment?.cross_version?.status === 'deferred_by_user', 'cross-version status must remain deferred_by_user');
  amendmentAssert(amendment?.cross_version?.represented_as_pass === false, 'cross-version validation cannot be represented as a pass');
}

function assertManifestBinding(amendment, baseMapping) {
  amendmentAssert(
    sameBinding(amendment?.bindings?.formal_manifest, baseMapping?.bindings?.formal_manifest),
    'amendment formal_manifest binding must exactly match base mapping'
  );
}

function assertAdditiveInventory({ baseInventory, candidateInventory, amendment }) {
  amendmentAssert(Array.isArray(baseInventory?.candidates), 'base candidate inventory is missing');
  amendmentAssert(baseInventory.candidates.length === BASE_CANDIDATE_COUNT, 'base inventory must contain five candidates');
  amendmentAssert(Array.isArray(candidateInventory?.candidates), 'current candidate inventory is missing');
  amendmentAssert(candidateInventory.candidates.length === AGGREGATE_CANDIDATE_COUNT, 'current candidate inventory must contain exactly six candidates');
  amendmentAssert(candidateInventory?.summary?.candidate_count === AGGREGATE_CANDIDATE_COUNT, 'current candidate inventory summary must report six candidates');
  amendmentAssert(candidateInventory?.policy?.live_queue_called === false, 'candidate inventory itself must remain offline/read-only');
  amendmentAssert(candidateInventory?.policy?.model_content_is_untrusted_data === true, 'candidate inventory must mark model content as untrusted');
  amendmentAssert(candidateInventory?.policy?.formal_corpus_acceptance === false, 'candidate inventory cannot grant formal corpus acceptance');

  const baseById = uniqueCandidateMap(baseInventory.candidates, 'base inventory');
  const currentById = uniqueCandidateMap(candidateInventory.candidates, 'current inventory');
  for (const [candidateId, baseCandidate] of baseById) {
    const currentCandidate = currentById.get(candidateId);
    amendmentAssert(currentCandidate, `current inventory removed historical candidate ${candidateId}`);
    amendmentAssert(sameCandidateIdentity(baseCandidate, currentCandidate), `current inventory changed historical candidate ${candidateId}`);
  }
  const additions = candidateInventory.candidates.filter((candidate) => !baseById.has(candidate.candidate_id));
  amendmentAssert(additions.length === 1, 'current inventory must add exactly one candidate');
  const candidate = additions[0];
  amendmentAssert(candidate.candidate_id === amendment.addition.candidate_id, 'amendment candidate_id does not match inventory addition');
  amendmentAssert(candidate.candidate_handle === amendment.addition.candidate_handle, 'amendment candidate_handle does not match inventory addition');
  amendmentAssert(candidate.source?.sha256 === amendment.addition.source_sha256, 'amendment source_sha256 does not match inventory addition');
  amendmentAssert(candidate.source?.relative_path === amendment.addition.source_label, 'amendment source_label does not match inventory addition');
  amendmentAssert(candidate.trust?.classification === 'untrusted_data', 'added candidate content must remain untrusted');
  amendmentAssert(candidate.trust?.may_influence_execution_policy === false, 'added candidate cannot influence execution policy');
  amendmentAssert(candidate.trust?.may_grant_approval === false, 'added candidate cannot grant approval');
  return candidate;
}

function assertTargetReview({ targetReview, addedCandidate, amendment }) {
  amendmentAssert(['real-model-target-review.v1', 'real-model-target-review.v2'].includes(targetReview?.version),
    'unsupported target-review version');
  amendmentAssert(targetReview?.kind === 'real_model_target_review', 'unsupported target-review kind');
  amendmentAssert(
    targetReview?.evidence_scope === 'user_coordinated_single_disposable_copy_read_only_target_review',
    'target review must be single-disposable-copy read-only evidence'
  );
  amendmentAssert(targetReview?.runtime === 'queue' && targetReview?.live_queue_called === true, 'target review must disclose its live queue observation');
  amendmentAssert(targetReview?.source?.candidate_id === addedCandidate.candidate_id, 'target review candidate_id mismatch');
  amendmentAssert(targetReview?.source?.candidate_handle === addedCandidate.candidate_handle, 'target review candidate_handle mismatch');
  amendmentAssert(targetReview?.source?.sha256 === addedCandidate.source.sha256, 'target review source_sha256 mismatch');
  amendmentAssert(targetReview?.source?.relative_path === addedCandidate.source.relative_path, 'target review source_label mismatch');
  amendmentAssert(targetReview?.source?.source_label_trust === 'untrusted_data', 'target review source label must remain untrusted');

  const safety = targetReview?.safety;
  amendmentAssert(safety?.read_only_adoption === true, 'target review safety.read_only_adoption must be true');
  amendmentAssert(safety?.disposable_copy_only === true, 'target review safety.disposable_copy_only must be true');
  amendmentAssert(safety?.originals_opened_in_sketchup === false, 'target review cannot open the original in SketchUp');
  amendmentAssert(safety?.original_bytes_unchanged_verified === true, 'target review original bytes must be unchanged');
  amendmentAssert(safety?.disposable_copy_bytes_unchanged_verified === true, 'target review copy bytes must be unchanged');
  amendmentAssert(safety?.model_content_mutation_requested === false, 'target review safety.model_content_mutation_requested must be false');
  amendmentAssert(safety?.save_requested === false, 'target review safety.save_requested must be false');
  amendmentAssert(safety?.approval_token_requested === false, 'target review safety.approval_token_requested must be false');
  amendmentAssert(targetReview?.revision_attestation?.complete === true, 'target review revision must be complete');
  amendmentAssert(targetReview?.revision_attestation?.unchanged === true, 'target review revision must be unchanged');
  amendmentAssert(targetReview?.target_review?.target_roles_confirmed === false, 'target review cannot confirm target roles');
  amendmentAssert(targetReview?.target_review?.formal_sidecar_ready === false, 'target review cannot make a formal sidecar ready');
  amendmentAssert(targetReview?.next_action?.mutation_authorized === false, 'target review cannot authorize mutation');
  amendmentAssert(targetReview?.next_action?.approval_token_issued === false, 'target review cannot issue approval tokens');
  amendmentAssert(targetReview?.next_action?.release_acceptance === false, 'target review cannot grant release acceptance');
  amendmentAssert(targetReview?.model_data_policy?.untrusted_data_may_influence_execution_policy === false, 'untrusted model data cannot influence execution policy');
  amendmentAssert(targetReview?.model_data_policy?.untrusted_data_may_grant_approval === false, 'untrusted model data cannot grant approval');
  amendmentAssert(targetReview?.model_data_policy?.untrusted_data_may_confirm_target_roles === false, 'untrusted model data cannot confirm target roles');
  amendmentAssert(amendment.authority.target_roles_confirmed === targetReview.target_review.target_roles_confirmed, 'amendment and target review target-role disposition mismatch');
}

function normalizeTargetReviewStructure(structure = {}) {
  return {
    materials: count(structure.materials),
    scenes: count(structure.scenes),
    hidden_occurrences: count(structure.hidden_occurrences),
    locked_occurrences: count(structure.locked_occurrences),
    uv_occurrences: count(structure.uv_occurrences),
    shared_occurrences: count(structure.shared_occurrence_count ?? structure.shared_occurrences),
    nonuniform_instances: count(structure.nonuniform_instance_occurrences ?? structure.nonuniform_instances),
    mirrored_instances: count(structure.mirrored_instance_occurrences ?? structure.mirrored_instances),
    logical_occurrences: count(structure.recursive_total_seen ?? structure.logical_occurrences),
    profile_sample_truncated: structure.recursive_truncated === true || structure.profile_sample_truncated === true
  };
}

function aggregateRemainingDecisions(amendment, baseMapping) {
  const decisions = new Set(amendment.remaining_requirements);
  for (const value of baseMapping.unresolved || []) {
    if (value !== 'product_boolean_candidate_and_target_tool') decisions.add(value);
  }
  return [...decisions].sort();
}

function uniqueCandidateMap(candidates, label) {
  const result = new Map();
  for (const candidate of candidates) {
    const candidateId = candidate?.candidate_id;
    amendmentAssert(typeof candidateId === 'string' && candidateId.length > 0, `${label} candidate is missing candidate_id`);
    amendmentAssert(!result.has(candidateId), `${label} repeats candidate ${candidateId}`);
    result.set(candidateId, candidate);
  }
  return result;
}

function sameCandidateIdentity(left, right) {
  return left?.candidate_id === right?.candidate_id
    && left?.candidate_handle === right?.candidate_handle
    && left?.source?.sha256 === right?.source?.sha256
    && left?.source?.relative_path === right?.source?.relative_path
    && left?.source?.size_bytes === right?.source?.size_bytes;
}

async function readBoundJson({ root, realRoot, binding, label }) {
  amendmentAssert(binding && typeof binding.path === 'string', `missing binding ${label}`);
  amendmentAssert(typeof binding.sha256 === 'string' && /^[0-9a-f]{64}$/.test(binding.sha256), `invalid binding ${label} sha256`);
  const candidate = path.resolve(root, binding.path);
  amendmentAssert(isWithin(root, candidate), `binding ${label} escapes repository root`);
  const stat = await fs.lstat(candidate).catch(() => null);
  amendmentAssert(stat?.isFile() === true && stat.isSymbolicLink() === false, `binding ${label} must be a regular non-symlink file`);
  const realCandidate = await fs.realpath(candidate);
  amendmentAssert(isWithin(realRoot, realCandidate), `binding ${label} resolves outside repository root`);
  const bytes = await fs.readFile(realCandidate);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  amendmentAssert(digest === binding.sha256, `binding ${label} sha256 mismatch`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    amendmentAssert(false, `binding ${label} must contain valid JSON`);
  }
}

function sameBinding(left, right) {
  return left?.path === right?.path && left?.sha256 === right?.sha256;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function count(value) {
  const numeric = Number(value ?? 0);
  amendmentAssert(Number.isSafeInteger(numeric) && numeric >= 0, 'target-review structural counts must be non-negative safe integers');
  return numeric;
}

function amendmentAssert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = 'REAL_MODEL_CANDIDATE_REVIEW_AMENDMENT_INVALID';
    throw error;
  }
}
