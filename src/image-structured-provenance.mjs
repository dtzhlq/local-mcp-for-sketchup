import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE_STRUCTURED_SOURCE_MODE = 'image_structured';
const NON_INTERPRETATION_SOURCE_MODES = new Set(['manual_authored', 'imported_geometry', 'dsl_reverse_wrapped']);
const SIGNATURE_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ASSET_HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/;
const TRADITIONAL_HALL_ROLE_VIEWS = Object.freeze({
  outer_eave_column_grid: ['front', 'oblique'],
  enclosure_wall_column_grid: ['front', 'oblique'],
  bay_enclosure: ['front'],
  masonry_sill_wall: ['front', 'oblique'],
  podium_with_front_stair: ['front', 'left', 'right', 'rear'],
  roof_shell: ['front', 'top', 'oblique']
});
const TRADITIONAL_HALL_NEGATIVE_VIEWS = Object.freeze({
  balustrade: ['front', 'rear', 'left', 'right'],
  side_stair: ['left', 'right'],
  rear_stair: ['rear']
});

export function artifactContentSignature(value, { excludedKeys = ['content_signature'] } = {}) {
  const excluded = new Set(excludedKeys);
  const canonical = canonicalize(value, excluded);
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function withArtifactContentSignature(value, options = {}) {
  const artifact = structuredClone(value);
  artifact.content_signature = artifactContentSignature(artifact, options);
  return artifact;
}

export function hasValidArtifactContentSignature(value, options = {}) {
  return SIGNATURE_PATTERN.test(String(value?.content_signature || ''))
    && value.content_signature === artifactContentSignature(value, options);
}

export async function verifyImageStructuredSourceAssets({
  assetSet,
  repoRoot = process.cwd(),
  maxAssetBytes = 512 * 1024 * 1024
} = {}) {
  const blockers = [];
  if (!assetSet || typeof assetSet !== 'object' || Array.isArray(assetSet)) {
    return sourceAssetVerificationResult({ blockers: ['asset_set_missing'], assetSet, assets: [] });
  }
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1) throw new Error('maxAssetBytes must be a positive safe integer');
  const resolvedRoot = path.resolve(repoRoot);
  let canonicalRoot;
  try {
    canonicalRoot = await fs.realpath(resolvedRoot);
  } catch {
    return sourceAssetVerificationResult({ blockers: ['source_asset_root_unavailable'], assetSet, assets: [] });
  }
  const verifiedAssets = [];
  const assets = Array.isArray(assetSet.assets) ? assetSet.assets : [];
  if (assets.length === 0) blockers.push('source_assets_empty');
  for (const asset of assets) {
    const id = String(asset?.id || asset?.path || 'unknown');
    const sourcePath = String(asset?.path || '');
    if (!sourcePath) {
      blockers.push(`source_asset_path_missing:${id}`);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(sourcePath)) {
      blockers.push(`source_asset_non_file_reference:${id}`);
      continue;
    }
    const absolutePath = path.isAbsolute(sourcePath) ? path.resolve(sourcePath) : path.resolve(resolvedRoot, sourcePath);
    if (!isWithinRoot(absolutePath, resolvedRoot)) {
      blockers.push(`source_asset_path_outside_root:${id}`);
      continue;
    }
    let handle;
    try {
      await assertNoSymlinkComponents(absolutePath, resolvedRoot);
      const lexicalStat = await fs.lstat(absolutePath);
      if (!lexicalStat.isFile() || lexicalStat.isSymbolicLink()) throw new Error('not_regular_file');
      const canonicalPath = await fs.realpath(absolutePath);
      if (!isWithinRoot(canonicalPath, canonicalRoot)) throw new Error('realpath_outside_root');
      handle = await fs.open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const openedStat = await handle.stat();
      if (!openedStat.isFile() || openedStat.ino !== lexicalStat.ino || openedStat.dev !== lexicalStat.dev) {
        throw new Error('source_asset_changed_during_open');
      }
      if (openedStat.size > maxAssetBytes) {
        blockers.push(`source_asset_too_large:${id}`);
        continue;
      }
      const actualHash = await sha256Handle(handle, openedStat.size);
      const [finalOpenedStat, finalLexicalStat] = await Promise.all([handle.stat(), fs.lstat(absolutePath)]);
      await assertNoSymlinkComponents(absolutePath, resolvedRoot);
      const finalCanonicalPath = await fs.realpath(absolutePath);
      if (!sameFileSnapshot(openedStat, finalOpenedStat)
        || finalLexicalStat.isSymbolicLink()
        || finalLexicalStat.ino !== openedStat.ino
        || finalLexicalStat.dev !== openedStat.dev
        || finalCanonicalPath !== canonicalPath) {
        throw new Error('source_asset_changed_during_open');
      }
      const expectedHash = normalizeSha256(asset.content_sha256);
      if (!expectedHash) blockers.push(`source_asset_hash_missing:${id}`);
      else if (actualHash !== expectedHash) blockers.push(`source_asset_hash_mismatch:${id}`);
      verifiedAssets.push({
        id,
        path: sourcePath,
        sha256: `sha256:${actualHash}`,
        size_bytes: openedStat.size
      });
    } catch (error) {
      if (!blockers.some((blocker) => blocker.endsWith(`:${id}`))) {
        const code = error?.code === 'ENOENT' ? 'source_asset_missing'
          : error?.message === 'realpath_outside_root' ? 'source_asset_path_outside_root'
            : error?.message === 'source_asset_changed_during_open' ? 'source_asset_open_race'
              : error?.message === 'symlink_component' ? 'source_asset_symlink_path'
                : 'source_asset_not_regular_file';
        blockers.push(`${code}:${id}`);
      }
    } finally {
      await handle?.close();
    }
  }
  return sourceAssetVerificationResult({ blockers, assetSet, assets: verifiedAssets });
}

export function sourceAssetVerificationBinding(verification = {}) {
  const core = {
    version: 1,
    kind: 'image_structured_source_asset_verification',
    asset_set_signature: verification.asset_set_signature || null,
    assets: [...(verification.assets || [])]
      .map((asset) => ({
        id: String(asset.id),
        path: String(asset.path),
        sha256: String(asset.sha256),
        size_bytes: Number(asset.size_bytes)
      }))
      .sort((left, right) => `${left.id}|${left.path}`.localeCompare(`${right.id}|${right.path}`))
  };
  return artifactContentSignature(core);
}

export function sourceModeForPartGraph(partGraph = {}) {
  return partGraph.source_mode || 'manual_authored';
}

export function interpretationEligibilityForPartGraph(partGraph = {}) {
  const sourceMode = sourceModeForPartGraph(partGraph);
  if (sourceMode === IMAGE_STRUCTURED_SOURCE_MODE) {
    return {
      eligible: true,
      source_mode: sourceMode,
      reason: 'verified_image_structured_lineage_required'
    };
  }
  return {
    eligible: false,
    source_mode: NON_INTERPRETATION_SOURCE_MODES.has(sourceMode) ? sourceMode : 'manual_authored',
    reason: `${sourceMode}_excluded_from_image_interpretation_accuracy`
  };
}

export function deriveImageStructuredReviewGate({
  assetSet,
  observations,
  candidateGraph,
  promotionReview,
  requireContentSignatures = true,
  enforceTopLevelState = true
} = {}) {
  const blockers = [];
  requireObject(blockers, 'asset_set', assetSet);
  requireObject(blockers, 'observations', observations);
  requireObject(blockers, 'candidate_graph', candidateGraph);
  requireObject(blockers, 'promotion_review', promotionReview);
  if (blockers.length) return reviewResult(blockers, {}, []);

  const signatures = {
    asset_set: artifactContentSignature(assetSet),
    observations: artifactContentSignature(observations),
    candidate_graph: artifactContentSignature(candidateGraph),
    promotion_review: artifactContentSignature(promotionReview)
  };
  if (requireContentSignatures) {
    validateSelfSignature(blockers, 'asset_set', assetSet, signatures.asset_set);
    validateSelfSignature(blockers, 'observations', observations, signatures.observations);
    validateSelfSignature(blockers, 'candidate_graph', candidateGraph, signatures.candidate_graph);
    validateSelfSignature(blockers, 'promotion_review', promotionReview, signatures.promotion_review);
  }

  validateReviewArtifactBindings(blockers, promotionReview, signatures);
  validateIdentityAlignment(blockers, { assetSet, candidateGraph, promotionReview });
  validateSourceArtifacts(blockers, { assetSet, observations });
  validateReviewConfirmations(blockers, promotionReview);

  const candidates = Array.isArray(candidateGraph.candidates) ? candidateGraph.candidates : [];
  const candidateById = new Map();
  for (const candidate of candidates) {
    if (!candidate?.id) {
      blockers.push('candidate_id_missing');
      continue;
    }
    if (candidateById.has(candidate.id)) blockers.push(`candidate_id_duplicate:${candidate.id}`);
    candidateById.set(candidate.id, candidate);
  }
  const observationIndex = buildObservationIndex(observations, blockers);
  const assetIndex = buildAssetIndex(assetSet, blockers);
  validateCandidateSummary(blockers, candidateGraph);
  const acceptedItems = Array.isArray(promotionReview.accepted_candidates) ? promotionReview.accepted_candidates : [];
  const heldItems = Array.isArray(promotionReview.held_candidates) ? promotionReview.held_candidates : [];
  const acceptedIds = idsForReviewItems(acceptedItems, 'accepted', blockers);
  const heldIds = idsForReviewItems(heldItems, 'held', blockers);
  if (acceptedIds.length === 0) blockers.push('accepted_candidates_empty');

  for (const candidateId of acceptedIds) {
    if (heldIds.includes(candidateId)) blockers.push(`candidate_review_overlap:${candidateId}`);
  }
  const classified = new Set([...acceptedIds, ...heldIds]);
  for (const candidateId of candidateById.keys()) {
    if (!classified.has(candidateId)) blockers.push(`candidate_unclassified:${candidateId}`);
  }
  for (const candidateId of classified) {
    if (!candidateById.has(candidateId)) blockers.push(`review_candidate_missing:${candidateId}`);
  }

  for (const item of acceptedItems) {
    const candidate = candidateById.get(item?.candidate_id);
    if (!candidate) continue;
    validateAcceptedCandidate(blockers, item, candidate, observationIndex, assetIndex);
  }
  validateNestedReviews(blockers, {
    review: promotionReview,
    candidateGraph,
    observations,
    acceptedItems,
    candidateById
  });
  validateProfileSpecificReview(blockers, {
    profileId: candidateGraph.profile_id,
    review: promotionReview,
    acceptedItems,
    candidateById,
    observationIndex
  });

  if (promotionReview.verdict !== 'accepted_subset') blockers.push('promotion_review_verdict_not_accepted_subset');
  const derivedBeforeTopLevel = blockers.length === 0;
  if (enforceTopLevelState) {
    if (promotionReview.promotion_allowed !== derivedBeforeTopLevel) blockers.push('promotion_review_promotion_state_not_derived');
    if (promotionReview.compile_allowed !== derivedBeforeTopLevel) blockers.push('promotion_review_compile_state_not_derived');
  }

  return reviewResult(blockers, signatures, acceptedIds, observationIndex);
}

export function bindPromotionReviewArtifacts({ assetSet, observations, candidateGraph, promotionReview } = {}) {
  const signedAssetSet = withArtifactContentSignature(assetSet);
  const signedObservations = withArtifactContentSignature(observations);
  const signedCandidateGraph = withArtifactContentSignature(candidateGraph);
  const boundReview = structuredClone(promotionReview || {});
  delete boundReview.content_signature;
  boundReview.artifact_bindings = {
    asset_set: artifactContentSignature(signedAssetSet),
    observations: artifactContentSignature(signedObservations),
    candidate_graph: artifactContentSignature(signedCandidateGraph)
  };
  const derived = deriveImageStructuredReviewGate({
    assetSet: signedAssetSet,
    observations: signedObservations,
    candidateGraph: signedCandidateGraph,
    promotionReview: boundReview,
    requireContentSignatures: false,
    enforceTopLevelState: false
  });
  boundReview.promotion_allowed = derived.ok;
  boundReview.compile_allowed = derived.ok;
  const signedPromotionReview = withArtifactContentSignature(boundReview);
  return {
    assetSet: signedAssetSet,
    observations: signedObservations,
    candidateGraph: signedCandidateGraph,
    promotionReview: signedPromotionReview,
    derivedReviewGate: deriveImageStructuredReviewGate({
      assetSet: signedAssetSet,
      observations: signedObservations,
      candidateGraph: signedCandidateGraph,
      promotionReview: signedPromotionReview
    })
  };
}

export function verifyImageStructuredCompileBundle({
  assetSet,
  observations,
  candidateGraph,
  promotionReview,
  promotionPatch,
  partGraph,
  mcpBrief = null,
  sourceAssetVerification = null,
  requireContentSignatures = true,
  requireSourceAssetVerification = false
} = {}) {
  const review = deriveImageStructuredReviewGate({
    assetSet,
    observations,
    candidateGraph,
    promotionReview,
    requireContentSignatures
  });
  const blockers = [...review.blockers];
  requireObject(blockers, 'promotion_patch', promotionPatch);
  requireObject(blockers, 'part_graph', partGraph);
  if (!promotionPatch || !partGraph) return compileResult(blockers, review, {}, null);

  const signatures = {
    ...review.signatures,
    promotion_patch: artifactContentSignature(promotionPatch),
    part_graph: artifactContentSignature(partGraph)
  };
  if (requireContentSignatures) {
    validateSelfSignature(blockers, 'promotion_patch', promotionPatch, signatures.promotion_patch);
    validateSelfSignature(blockers, 'part_graph', partGraph, signatures.part_graph);
  }
  validateSourceAssetVerification(blockers, {
    verification: sourceAssetVerification,
    assetSet,
    signatures,
    required: requireSourceAssetVerification
  });

  validatePatch(blockers, {
    promotionPatch,
    promotionReview,
    candidateGraph,
    signatures,
    acceptedCandidateIds: review.accepted_candidate_ids
  });
  validatePartGraphLineage(blockers, {
    partGraph,
    candidateGraph,
    observations,
    promotionReview,
    promotionPatch,
    signatures,
    acceptedCandidateIds: review.accepted_candidate_ids
  });
  validateCompileIdentityAlignment(blockers, {
    assetSet,
    candidateGraph,
    promotionReview,
    promotionPatch,
    partGraph,
    mcpBrief
  });

  if (mcpBrief) {
    const derivedAllowed = blockers.length === 0;
    if (mcpBrief.compile_permission?.can_generate_sketchup_dsl !== derivedAllowed) {
      blockers.push('mcp_brief_compile_permission_not_derived');
    }
  }

  const binding = compileBundleBinding({
    signatures,
    acceptedCandidateIds: review.accepted_candidate_ids,
    partGraph,
    sourceAssetVerification
  });
  return compileResult(blockers, review, signatures, binding);
}

export function verifyImageStructuredPromotionBundle({
  assetSet,
  observations,
  candidateGraph,
  promotionReview,
  promotionPatch,
  requireContentSignatures = true
} = {}) {
  const review = deriveImageStructuredReviewGate({
    assetSet,
    observations,
    candidateGraph,
    promotionReview,
    requireContentSignatures
  });
  const blockers = [...review.blockers];
  requireObject(blockers, 'promotion_patch', promotionPatch);
  if (!promotionPatch) return promotionResult(blockers, review, {});
  const signatures = {
    ...review.signatures,
    promotion_patch: artifactContentSignature(promotionPatch)
  };
  if (requireContentSignatures) validateSelfSignature(blockers, 'promotion_patch', promotionPatch, signatures.promotion_patch);
  validatePatch(blockers, {
    promotionPatch,
    promotionReview,
    candidateGraph,
    signatures,
    acceptedCandidateIds: review.accepted_candidate_ids
  });
  const assetSetIds = uniqueStrings([assetSet?.id, candidateGraph?.asset_set_id, promotionReview?.asset_set_id, promotionPatch?.asset_set_id]);
  if (assetSetIds.length !== 1) blockers.push(`promotion_asset_set_id_mismatch:${assetSetIds.join(',')}`);
  const profileIds = uniqueStrings([
    assetSet?.profile_routing?.selected_profile,
    candidateGraph?.profile_id,
    promotionReview?.profile_id,
    promotionPatch?.profile_id
  ]);
  if (profileIds.length !== 1) blockers.push(`promotion_profile_id_mismatch:${profileIds.join(',')}`);
  return promotionResult(blockers, review, signatures);
}

export function assertImageStructuredCompileBundle(bundle, options = {}) {
  const result = verifyImageStructuredCompileBundle({ ...bundle, ...options });
  if (!result.ok) {
    throw new Error(`Image-structured compile provenance blocked: ${result.blockers.join('; ')}`);
  }
  return result;
}

export function compileBundleBinding({ signatures, acceptedCandidateIds, partGraph, sourceAssetVerification = null } = {}) {
  const core = {
    version: 1,
    kind: 'image_structured_compile_binding',
    source_mode: sourceModeForPartGraph(partGraph),
    part_graph_id: partGraph?.id || null,
    artifact_signatures: structuredClone(signatures || {}),
    accepted_candidate_ids: uniqueStrings(acceptedCandidateIds).sort(),
    ...(sourceAssetVerification?.binding_hash ? { source_asset_binding_hash: sourceAssetVerification.binding_hash } : {})
  };
  return {
    ...core,
    binding_hash: artifactContentSignature(core)
  };
}

function validateSourceAssetVerification(blockers, { verification, assetSet, signatures, required }) {
  if (!verification) {
    if (required) blockers.push('source_asset_verification_required');
    return;
  }
  if (verification.ok !== true) blockers.push(...(verification.blockers || ['source_asset_verification_failed']));
  if (verification.asset_set_signature !== signatures.asset_set) blockers.push('source_asset_verification_asset_set_signature_mismatch');
  if (verification.binding_hash !== sourceAssetVerificationBinding(verification)) blockers.push('source_asset_verification_binding_mismatch');
  const expectedIds = uniqueStrings((assetSet?.assets || []).map((asset) => asset?.id));
  const verifiedIds = uniqueStrings((verification.assets || []).map((asset) => asset?.id));
  if (!sameStringSet(expectedIds, verifiedIds)) blockers.push('source_asset_verification_assets_mismatch');
}

function validateReviewArtifactBindings(blockers, review, signatures) {
  const bindings = review.artifact_bindings;
  if (!bindings || typeof bindings !== 'object') {
    blockers.push('promotion_review_artifact_bindings_missing');
    return;
  }
  for (const key of ['asset_set', 'observations', 'candidate_graph']) {
    if (bindings[key] !== signatures[key]) blockers.push(`promotion_review_${key}_signature_mismatch`);
  }
}

function validateIdentityAlignment(blockers, { assetSet, candidateGraph, promotionReview }) {
  const assetSetIds = uniqueStrings([assetSet?.id, candidateGraph?.asset_set_id, promotionReview?.asset_set_id]);
  if (assetSetIds.length !== 1) blockers.push(`asset_set_id_mismatch:${assetSetIds.join(',')}`);
  const profileIds = uniqueStrings([assetSet?.profile_routing?.selected_profile, candidateGraph?.profile_id, promotionReview?.profile_id]);
  if (profileIds.length !== 1) blockers.push(`profile_id_mismatch:${profileIds.join(',')}`);
}

function validateReviewConfirmations(blockers, review) {
  if (review.profile_confirmation?.status !== 'confirmed') blockers.push('profile_confirmation_required');
  if (review.profile_confirmation?.selected_profile !== review.profile_id) blockers.push('profile_confirmation_mismatch');
  if (review.scale_confirmation?.status !== 'confirmed') blockers.push('scale_confirmation_required');
  if ((review.missing_inputs || []).length > 0) blockers.push('promotion_review_missing_inputs');
  if ((review.blockers || []).length > 0) blockers.push('promotion_review_has_blockers');
}

function validateProfileSpecificReview(blockers, { profileId, review, acceptedItems, candidateById, observationIndex }) {
  if (profileId !== 'traditional_chinese_hall') return;
  validateTraditionalHallScaleConfirmation(blockers, review.scale_confirmation);
  const acceptedByRole = new Map();
  for (const item of acceptedItems) {
    const candidate = candidateById.get(item?.candidate_id);
    const role = candidate?.role;
    if (!Object.hasOwn(TRADITIONAL_HALL_ROLE_VIEWS, role)) {
      blockers.push(`traditional_hall_unrecognized_accepted_role:${role || 'unknown'}`);
      continue;
    }
    if (acceptedByRole.has(role)) blockers.push(`traditional_hall_role_geometry_candidate_duplicate:${role}`);
    acceptedByRole.set(role, item);
    const resolved = item.resolved_blockers || [];
    if (!sameStringSet(resolved, ['review_required', 'traditional_hall_multiview_role_review_required'])
      || !sameStringSet(candidate.review_resolution?.resolved_blockers, resolved)
      || candidate.review_resolution?.reviewer !== review.reviewer
      || candidate.review_resolution?.status !== 'accepted_for_part_graph') {
      blockers.push(`traditional_hall_candidate_review_resolution_invalid:${candidate.id}`);
    }
    validateTraditionalHallPositiveObservation(blockers, {
      role,
      sourceImage: candidate.source_image,
      observationId: candidate.source_observation_id,
      expectedView: candidate.view,
      observationIndex,
      reviewer: review.reviewer,
      label: candidate.id
    });
    const evidenceViews = new Set([candidate.view]);
    const supportRefs = new Set([`${candidate.source_image}|${candidate.source_observation_id}`]);
    for (const support of item.supporting_observations || []) {
      const ref = `${support?.source_image}|${support?.source_observation_id}`;
      if (!support?.source_image || !support?.source_observation_id || supportRefs.has(ref)) {
        blockers.push(`traditional_hall_supporting_observation_duplicate_or_missing:${candidate.id}`);
        continue;
      }
      supportRefs.add(ref);
      if (support.status !== 'confirmed_support') blockers.push(`traditional_hall_supporting_observation_status_invalid:${candidate.id}:${ref}`);
      evidenceViews.add(support.view);
      validateTraditionalHallPositiveObservation(blockers, {
        role,
        sourceImage: support.source_image,
        observationId: support.source_observation_id,
        expectedView: support.view,
        observationIndex,
        reviewer: review.reviewer,
        label: `${candidate.id}:${ref}`
      });
    }
    for (const view of TRADITIONAL_HALL_ROLE_VIEWS[role]) {
      if (!evidenceViews.has(view)) blockers.push(`traditional_hall_role_view_missing:${role}:${view}`);
    }
  }
  for (const role of Object.keys(TRADITIONAL_HALL_ROLE_VIEWS)) {
    if (!acceptedByRole.has(role)) blockers.push(`traditional_hall_required_role_missing:${role}`);
  }
  validateTraditionalHallNegativeReview(blockers, review.negative_evidence_review, observationIndex, review.reviewer);
}

function validateTraditionalHallScaleConfirmation(blockers, scale = {}) {
  if (scale.confirmation_scope === 'metric_truth') {
    if (scale.metric_accuracy_claimed !== true) blockers.push('traditional_hall_metric_truth_claim_required');
  } else if (scale.confirmation_scope === 'test_runtime_profile_default') {
    if (scale.metric_accuracy_claimed !== false) blockers.push('traditional_hall_profile_default_metric_accuracy_must_be_false');
  } else {
    blockers.push('traditional_hall_scale_confirmation_scope_required');
  }
  for (const field of ['known_width', 'known_depth', 'known_height']) {
    if (!Number.isFinite(Number(scale[field])) || Number(scale[field]) <= 0) blockers.push(`traditional_hall_scale_${field}_required`);
  }
}

function validateTraditionalHallPositiveObservation(blockers, {
  role,
  sourceImage,
  observationId,
  expectedView,
  observationIndex,
  reviewer,
  label
}) {
  const ref = `${sourceImage}|${observationId}`;
  const observation = observationIndex.byRef.get(ref);
  if (!observation) {
    blockers.push(`traditional_hall_positive_observation_not_found:${label}`);
    return;
  }
  if (observationIndex.views.get(sourceImage) !== expectedView
    || observation.component_hint !== role
      || observation.grounding?.method !== 'traditional_hall_multiview_role_prior'
      || observation.grounding_status !== 'review_confirmed'
      || observation.review_required !== false
      || observation.review_resolution?.reviewer !== reviewer) {
    blockers.push(`traditional_hall_positive_observation_not_review_confirmed:${label}`);
  }
}

function validateTraditionalHallNegativeReview(blockers, negative, observationIndex, reviewer) {
  if (!negative
    || negative.status !== 'accepted'
    || negative.semantic_contract_allowed !== true
    || (negative.blockers || []).length > 0) {
    blockers.push('traditional_hall_negative_evidence_review_required');
    return;
  }
  const coverage = new Map();
  const seen = new Set();
  for (const item of negative.confirmed_observations || []) {
    const ref = `${item?.source_image}|${item?.source_observation_id}`;
    if (!item?.source_image || !item?.source_observation_id || seen.has(ref)) {
      blockers.push(`traditional_hall_negative_observation_duplicate_or_missing:${ref}`);
      continue;
    }
    seen.add(ref);
    const observation = observationIndex.byRef.get(ref);
    if (!observation
      || item.status !== 'confirmed_absent'
      || (item.blockers || []).length > 0
      || observationIndex.views.get(item.source_image) !== item.view
      || observation.kind !== 'manual_review'
      || observation.grounding?.method !== 'traditional_hall_negative_semantic_prior'
      || observation.negative_semantic_role !== item.absent_role
      || observation.grounding_status !== 'review_confirmed'
      || observation.review_required !== false
      || observation.review_resolution?.reviewer !== reviewer
      || !String(item.reviewer_note || '').trim()) {
      blockers.push(`traditional_hall_negative_observation_not_review_confirmed:${ref}`);
      continue;
    }
    const views = coverage.get(item.absent_role) || new Set();
    views.add(item.view);
    coverage.set(item.absent_role, views);
  }
  for (const [role, requiredViews] of Object.entries(TRADITIONAL_HALL_NEGATIVE_VIEWS)) {
    const views = coverage.get(role) || new Set();
    for (const view of requiredViews) {
      if (!views.has(view)) blockers.push(`traditional_hall_negative_view_missing:${role}:${view}`);
    }
  }
}

function validateSourceArtifacts(blockers, { assetSet, observations }) {
  if (assetSet.gates?.can_compile_geometry !== true) blockers.push('asset_set_compile_gate_closed');
  if ((assetSet.gates?.reasons || []).length > 0) blockers.push('asset_set_compile_gate_has_reasons');
  if (observations.quality_report?.usable_for_modeling !== true) blockers.push('observations_not_usable_for_modeling');
  const assetPaths = new Set();
  for (const asset of assetSet.assets || []) {
    if (!asset?.path) continue;
    assetPaths.add(asset.path);
    if (!ASSET_HASH_PATTERN.test(String(asset.content_sha256 || ''))) blockers.push(`asset_content_hash_missing:${asset.id || asset.path}`);
  }
  for (const image of observations.images || []) {
    if (!assetPaths.has(image?.image?.path)) blockers.push(`observation_source_asset_not_found:${image?.image?.path || 'unknown'}`);
  }
}

function validateCandidateSummary(blockers, candidateGraph) {
  const candidates = candidateGraph.candidates || [];
  const eligible = candidates.filter((candidate) => candidate.promotion?.status === 'eligible').length;
  const blocked = candidates.filter((candidate) => candidate.promotion?.status === 'blocked').length;
  if (candidateGraph.summary?.candidate_count !== candidates.length) blockers.push('candidate_summary_count_mismatch');
  if (candidateGraph.summary?.eligible_count !== eligible) blockers.push('candidate_summary_eligible_count_mismatch');
  if (candidateGraph.summary?.blocked_count !== blocked) blockers.push('candidate_summary_blocked_count_mismatch');
}

function validateNestedReviews(blockers, { review, candidateGraph, observations, acceptedItems, candidateById }) {
  const requirements = nestedReviewRequirements({ candidateGraph, observations, acceptedItems, candidateById });
  if (requirements.multi_view_geometry_fusion) blockers.push('accepted_multi_view_geometry_fusion_review_required');
  if (requirements.calibration && !review.calibration_review) blockers.push('calibration_review_required');
  if (requirements.topology && !review.topology_review) blockers.push('topology_review_required');
  if (requirements.facade_plane && !review.facade_plane_review) blockers.push('facade_plane_review_required');
  if (requirements.draft_view && !review.draft_view_review) blockers.push('draft_view_review_required');
  if (requirements.local_detail && !review.local_detail_review) blockers.push('local_detail_review_required');

  if (review.calibration_review) {
    const lineage = candidateGraph.calibration_lineage;
    if (review.calibration_review.status !== 'accepted_for_rectification'
      || review.calibration_review.rectification_allowed !== true
      || review.calibration_review.promotion_allowed !== false
      || (review.calibration_review.blockers || []).length > 0) {
      blockers.push('calibration_review_not_accepted');
    }
    if (lineage && (review.calibration_review.source_perspective_calibration_review_result !== lineage.source_perspective_calibration_review_result
      || !sameStringSet(review.calibration_review.accepted_axis_family_ids, lineage.accepted_axis_family_ids))) {
      blockers.push('calibration_review_lineage_mismatch');
    }
  }
  if (review.topology_review) {
    const lineage = candidateGraph.calibration_lineage;
    if (review.topology_review.status !== 'accepted_for_derived_drafting'
      || review.topology_review.derived_drafting_allowed !== true
      || review.topology_review.promotion_allowed !== false
      || (review.topology_review.blockers || []).length > 0) {
      blockers.push('topology_review_not_accepted');
    }
    if (lineage && (review.topology_review.source_corner_chain_topology_review !== lineage.source_corner_chain_topology_review
      || !sameStringSet(review.topology_review.accepted_topology_ids, lineage.accepted_topology_ids))) {
      blockers.push('topology_review_lineage_mismatch');
    }
  }
  if (review.facade_plane_review) {
    if (review.facade_plane_review.status !== 'accepted'
      || review.facade_plane_review.promotion_allowed !== true
      || !(review.facade_plane_review.accepted_plane_ids || []).length
      || (review.facade_plane_review.blockers || []).length > 0) {
      blockers.push('facade_plane_review_not_accepted');
    }
  }
  if (review.draft_view_review) {
    if (review.draft_view_review.status !== 'accepted'
      || review.draft_view_review.promotion_allowed !== true
      || !(review.draft_view_review.accepted_view_slot_ids || []).length
      || (review.draft_view_review.blockers || []).length > 0) {
      blockers.push('draft_view_review_not_accepted');
    }
    const draftSlots = new Set((observations.draft_view_graph_v1?.view_slots || []).map((slot) => slot?.slot_id).filter(Boolean));
    for (const id of review.draft_view_review.accepted_view_slot_ids || []) {
      if (!draftSlots.has(id)) blockers.push(`draft_view_review_slot_not_found:${id}`);
    }
    const planeHypotheses = new Set((observations.draft_view_graph_v1?.plane_hypotheses || []).map((plane) => plane?.id).filter(Boolean));
    for (const id of review.draft_view_review.accepted_plane_hypothesis_ids || []) {
      if (!planeHypotheses.has(id)) blockers.push(`draft_view_review_plane_not_found:${id}`);
    }
  }
  if (review.local_detail_review) {
    const acceptedIds = [
      ...(review.local_detail_review.accepted_surface_ids || []),
      ...(review.local_detail_review.accepted_detail_ids || [])
    ];
    if (review.local_detail_review.status !== 'accepted'
      || review.local_detail_review.promotion_allowed !== true
      || acceptedIds.length === 0
      || (review.local_detail_review.blockers || []).length > 0) {
      blockers.push('local_detail_review_not_accepted');
    }
    const surfaces = new Set((observations.object_surface_graph_v1?.surfaces || []).map((surface) => surface?.id).filter(Boolean));
    const details = new Set((observations.object_surface_graph_v1?.surface_local_feature_candidates || []).map((detail) => detail?.id).filter(Boolean));
    for (const id of review.local_detail_review.accepted_surface_ids || []) {
      if (!surfaces.has(id)) blockers.push(`local_detail_review_surface_not_found:${id}`);
    }
    for (const id of review.local_detail_review.accepted_detail_ids || []) {
      if (!details.has(id)) blockers.push(`local_detail_review_detail_not_found:${id}`);
    }
  }
  const acceptedDraftSlots = new Set(review.draft_view_review?.accepted_view_slot_ids || []);
  const acceptedSurfaces = new Set(review.local_detail_review?.accepted_surface_ids || []);
  const acceptedDetails = new Set(review.local_detail_review?.accepted_detail_ids || []);
  for (const item of acceptedItems) {
    if (item.accepted_draft_view_slot_id && !acceptedDraftSlots.has(item.accepted_draft_view_slot_id)) {
      blockers.push(`accepted_candidate_draft_view_slot_not_accepted:${item.candidate_id}`);
    }
    if (item.accepted_surface_id && !acceptedSurfaces.has(item.accepted_surface_id)) {
      blockers.push(`accepted_candidate_surface_not_accepted:${item.candidate_id}`);
    }
    if (item.accepted_detail_id && !acceptedDetails.has(item.accepted_detail_id)) {
      blockers.push(`accepted_candidate_detail_not_accepted:${item.candidate_id}`);
    }
  }
}

function nestedReviewRequirements({ candidateGraph, observations, acceptedItems, candidateById }) {
  const candidates = candidateGraph.candidates || [];
  const candidateBlockers = new Set(candidates.flatMap((candidate) => [
    ...(candidate.promotion?.blockers || []),
    ...(candidate.blockers || [])
  ]));
  const calibrated = candidateGraph.geometry_strategy === 'calibrated_manhattan_planes';
  const draftSummary = observations.draft_view_graph_v1?.summary || {};
  const draftSlots = Number(draftSummary.observed_slots || 0)
    + Number(draftSummary.inferred_slots || 0)
    + Number(draftSummary.partial_slots || 0);
  const acceptedDetailCandidate = acceptedItems.some((item) => {
    const candidate = candidateById.get(item.candidate_id);
    return !String(item.role || candidate?.role || '').startsWith('visible_plane_');
  });
  const facadeCandidate = candidates.some((candidate) => String(candidate.role || '').startsWith('visible_plane_'));
  return {
    calibration: calibrated,
    topology: calibrated,
    multi_view_geometry_fusion: candidateGraph.geometry_strategy === 'multi_view_calibration_pose_graph',
    facade_plane: candidateGraph.profile_id === 'building_single'
      && (facadeCandidate || candidateBlockers.has('accepted_facade_plane_review_required')),
    draft_view: calibrated || draftSlots > 0 || candidateBlockers.has('accepted_draft_view_review_required'),
    local_detail: acceptedItems.length > 0 && (
      (calibrated && acceptedDetailCandidate)
      || Boolean(observations.object_surface_graph_v1)
      || candidateBlockers.has('accepted_local_detail_review_required')
      || candidateBlockers.has('plane_local_detail_review_required')
    )
  };
}

function validateAcceptedCandidate(blockers, item, candidate, observationIndex, assetIndex) {
  const id = candidate.id;
  if (candidate.promotion?.status !== 'eligible' || (candidate.promotion?.blockers || []).length > 0) {
    blockers.push(`accepted_candidate_not_eligible:${id}`);
  }
  if (candidate.geometry_promotion_allowed === false) blockers.push(`accepted_candidate_geometry_promotion_disallowed:${id}`);
  if (item.promotion_status !== 'accepted_for_part_graph') blockers.push(`accepted_candidate_review_status_invalid:${id}`);
  if ((item.blockers || []).length > 0) blockers.push(`accepted_candidate_review_has_blockers:${id}`);
  for (const field of ['role', 'view', 'source_image', 'source_observation_id']) {
    if (!item?.[field]) blockers.push(`accepted_candidate_${field}_missing:${id}`);
    else if (candidate?.[field] !== item[field]) blockers.push(`accepted_candidate_${field}_mismatch:${id}`);
  }
  if (!candidate.source_observation_id) {
    blockers.push(`accepted_candidate_observation_missing:${id}`);
  } else if (!observationIndex.refs.has(`${candidate.source_image}|${candidate.source_observation_id}`)) {
    blockers.push(`accepted_candidate_observation_not_found:${id}`);
  }
  const asset = assetIndex.byPath.get(candidate.source_image);
  if (!asset) blockers.push(`accepted_candidate_source_asset_not_found:${id}`);
  else if (!ASSET_HASH_PATTERN.test(String(asset.content_sha256 || ''))) blockers.push(`accepted_candidate_source_asset_hash_missing:${id}`);
}

function validatePatch(blockers, {
  promotionPatch,
  promotionReview,
  candidateGraph,
  signatures,
  acceptedCandidateIds
}) {
  const bindings = promotionPatch.artifact_bindings;
  if (!bindings || typeof bindings !== 'object') {
    blockers.push('promotion_patch_artifact_bindings_missing');
  } else {
    for (const key of ['asset_set', 'observations', 'candidate_graph', 'promotion_review']) {
      if (bindings[key] !== signatures[key]) blockers.push(`promotion_patch_${key}_signature_mismatch`);
    }
  }
  if (promotionPatch.status !== 'ready_for_part_graph_patch') blockers.push('promotion_patch_not_ready');
  if (promotionPatch.apply_allowed !== true) blockers.push('promotion_patch_apply_not_allowed');
  if (promotionPatch.compile_allowed !== false) blockers.push('promotion_patch_compile_state_must_be_false');
  if ((promotionPatch.blockers || []).length > 0) blockers.push('promotion_patch_has_blockers');

  const patchAcceptedIds = uniqueStrings(promotionPatch.accepted_candidate_ids);
  if (!sameStringSet(patchAcceptedIds, acceptedCandidateIds)) blockers.push('promotion_patch_accepted_candidates_mismatch');
  const candidateById = new Map((candidateGraph.candidates || []).map((candidate) => [candidate.id, candidate]));
  const acceptedReviewById = new Map((promotionReview.accepted_candidates || []).map((item) => [item.candidate_id, item]));
  const actionIds = [];
  for (const action of promotionPatch.actions || []) {
    if (action.action !== 'promote_candidate') blockers.push('promotion_patch_action_invalid');
    if (!action.candidate_id) blockers.push('promotion_patch_action_candidate_missing');
    actionIds.push(action.candidate_id);
    if (!action.source_observation_id) blockers.push(`promotion_patch_action_observation_missing:${action.candidate_id || 'unknown'}`);
    if (action.requires_part_graph_review !== true) blockers.push(`promotion_patch_action_review_bypass:${action.candidate_id || 'unknown'}`);
    const candidate = candidateById.get(action.candidate_id);
    const acceptedReview = acceptedReviewById.get(action.candidate_id);
    if (!candidate || !acceptedReview) continue;
    for (const field of ['role', 'view', 'source_image', 'source_observation_id']) {
      if (action[field] !== candidate[field] || action[field] !== acceptedReview[field]) {
        blockers.push(`promotion_patch_action_${field}_mismatch:${action.candidate_id}`);
      }
    }
    const actionSupport = (action.supporting_observations || []).map(supportingObservationKey);
    const reviewSupport = (acceptedReview.supporting_observations || []).map(supportingObservationKey);
    if (!sameStringSet(actionSupport, reviewSupport)) blockers.push(`promotion_patch_action_supporting_observations_mismatch:${action.candidate_id}`);
  }
  if (!sameStringSet(uniqueStrings(actionIds), acceptedCandidateIds) || actionIds.length !== acceptedCandidateIds.length) {
    blockers.push('promotion_patch_actions_mismatch');
  }
}

function supportingObservationKey(item = {}) {
  return `${item.source_image || ''}|${item.source_observation_id || ''}|${item.view || ''}|${item.status || ''}`;
}

function validatePartGraphLineage(blockers, {
  partGraph,
  candidateGraph,
  observations,
  promotionReview,
  signatures,
  acceptedCandidateIds
}) {
  if (sourceModeForPartGraph(partGraph) !== IMAGE_STRUCTURED_SOURCE_MODE) blockers.push('part_graph_source_mode_not_image_structured');
  const lineage = partGraph.provenance;
  if (!lineage || typeof lineage !== 'object') {
    blockers.push('part_graph_provenance_missing');
    return;
  }
  if (lineage.version !== 1) blockers.push('part_graph_provenance_version_invalid');
  const bound = lineage.artifact_signatures || {};
  for (const key of ['asset_set', 'observations', 'candidate_graph', 'promotion_review', 'promotion_patch']) {
    if (bound[key] !== signatures[key]) blockers.push(`part_graph_${key}_signature_mismatch`);
  }
  if (!sameStringSet(lineage.accepted_candidate_ids, acceptedCandidateIds)) blockers.push('part_graph_accepted_candidates_mismatch');

  if (candidateGraph.profile_id === 'traditional_chinese_hall') {
    const partGraphReview = partGraph.review?.decision;
    const reviewSignature = artifactContentSignature(partGraphReview || {});
    if (!partGraphReview || !hasValidArtifactContentSignature(partGraphReview)) blockers.push('traditional_hall_part_graph_review_signature_invalid');
    if (lineage.artifact_signatures?.part_graph_review !== reviewSignature) blockers.push('traditional_hall_part_graph_review_signature_mismatch');
    if (partGraphReview?.status !== 'accepted'
      || partGraphReview?.parameter_scope !== 'test_runtime_profile_default'
      || partGraphReview?.metric_accuracy_claimed !== false
      || partGraphReview?.release_ready !== false
      || (partGraphReview?.blockers || []).length > 0) {
      blockers.push('traditional_hall_part_graph_review_not_accepted_for_test_runtime');
    }
    for (const key of ['asset_set', 'observations', 'candidate_graph', 'promotion_review', 'promotion_patch']) {
      if (partGraphReview?.artifact_bindings?.[key] !== signatures[key]) blockers.push(`traditional_hall_part_graph_review_${key}_signature_mismatch`);
    }
  }

  const candidateById = new Map((candidateGraph.candidates || []).map((candidate) => [candidate.id, candidate]));
  const acceptedReviewById = new Map((promotionReview?.accepted_candidates || []).map((item) => [item.candidate_id, item]));
  const observationIndex = buildObservationIndex(observations, blockers);
  const expectedAcceptedObservationIds = uniqueStrings(acceptedCandidateIds.map((candidateId) => candidateById.get(candidateId)?.source_observation_id));
  if (!expectedAcceptedObservationIds.every((observationId) => uniqueStrings(lineage.source_observation_ids).includes(observationId))) {
    blockers.push('part_graph_accepted_observation_lineage_incomplete');
  }
  for (const observationId of uniqueStrings(lineage.source_observation_ids)) {
    if (!observationIndex.ids.has(observationId)) blockers.push(`part_graph_source_observation_not_found:${observationId}`);
  }
  for (const evidence of partGraph.semantic_contract?.negative_evidence || []) {
    for (const observationId of uniqueStrings(evidence.source_observation_ids)) {
      if (!observationIndex.ids.has(observationId)) blockers.push(`semantic_negative_evidence_observation_not_found:${evidence.id}:${observationId}`);
    }
  }
  for (const part of partGraph.parts || []) {
    if (part.compile?.emit === false || !part.shape) continue;
    const sourceCandidateIds = uniqueStrings(part.source_candidate_ids || part.qa?.source_candidate_ids);
    const sourceObservationIds = uniqueStrings(part.source_observation_ids || part.qa?.source_observation_ids);
    if (sourceCandidateIds.length === 0) blockers.push(`part_source_candidate_lineage_missing:${part.id}`);
    if (sourceObservationIds.length === 0) blockers.push(`part_source_observation_lineage_missing:${part.id}`);
    for (const observationId of sourceObservationIds) {
      if (!observationIndex.ids.has(observationId)) blockers.push(`part_source_observation_not_found:${part.id}:${observationId}`);
    }
    for (const candidateId of sourceCandidateIds) {
      const candidate = candidateById.get(candidateId);
      if (!candidate || !acceptedCandidateIds.includes(candidateId)) {
        blockers.push(`part_source_candidate_not_accepted:${part.id}:${candidateId}`);
        continue;
      }
      if (!sourceObservationIds.includes(candidate.source_observation_id)) {
        blockers.push(`part_candidate_observation_lineage_mismatch:${part.id}:${candidateId}`);
      }
      if (candidateGraph.profile_id === 'traditional_chinese_hall') {
        for (const support of acceptedReviewById.get(candidateId)?.supporting_observations || []) {
          if (!sourceObservationIds.includes(support.source_observation_id)) {
            blockers.push(`part_candidate_supporting_observation_lineage_mismatch:${part.id}:${candidateId}:${support.source_observation_id}`);
          }
        }
      }
      if (!observationIndex.refs.has(`${candidate.source_image}|${candidate.source_observation_id}`)) {
        blockers.push(`part_source_observation_not_found:${part.id}:${candidate.source_observation_id}`);
      }
    }
    if (part.review_required === true || part.qa?.part_graph_review_required === true) {
      blockers.push(`part_graph_review_unresolved:${part.id}`);
    }
  }
  if (candidateGraph.profile_id === 'traditional_chinese_hall') {
    const confirmedNegative = new Map();
    for (const item of promotionReview?.negative_evidence_review?.confirmed_observations || []) {
      const ids = confirmedNegative.get(item.absent_role) || [];
      ids.push(item.source_observation_id);
      confirmedNegative.set(item.absent_role, ids);
    }
    const contractNegative = new Map((partGraph.semantic_contract?.negative_evidence || []).map((item) => [item.absent_role, item.source_observation_ids || []]));
    for (const [role, ids] of confirmedNegative) {
      if (!sameStringSet(ids, contractNegative.get(role) || [])) blockers.push(`traditional_hall_negative_evidence_lineage_mismatch:${role}`);
    }
  }
  if (!partGraph.review || typeof partGraph.review !== 'object') blockers.push('part_graph_review_missing');
  else if (!['accepted', 'approved', 'manual_confirmed'].includes(partGraph.review.status)) blockers.push('part_graph_review_status_not_accepted');
}

function validateCompileIdentityAlignment(blockers, documents) {
  const assetSetIds = uniqueStrings([
    documents.assetSet?.id,
    documents.candidateGraph?.asset_set_id,
    documents.promotionReview?.asset_set_id,
    documents.promotionPatch?.asset_set_id,
    documents.partGraph?.provenance?.asset_set_id,
    documents.mcpBrief?.asset_set_id
  ]);
  if (assetSetIds.length !== 1) blockers.push(`compile_asset_set_id_mismatch:${assetSetIds.join(',')}`);
  const profileIds = uniqueStrings([
    documents.candidateGraph?.profile_id,
    documents.promotionReview?.profile_id,
    documents.promotionPatch?.profile_id,
    documents.partGraph?.profile_id,
    documents.partGraph?.provenance?.profile_id,
    documents.mcpBrief?.profile_id
  ]);
  if (profileIds.length !== 1) blockers.push(`compile_profile_id_mismatch:${profileIds.join(',')}`);
}

function buildObservationIndex(observations, blockers = []) {
  const refs = new Set();
  const ids = new Set();
  const byRef = new Map();
  const views = new Map();
  for (const image of observations?.images || []) {
    const sourceImage = image?.image?.path;
    if (sourceImage) {
      if (views.has(sourceImage)) blockers.push(`observation_image_duplicate:${sourceImage}`);
      views.set(sourceImage, image?.detected_view?.kind);
    }
    for (const observation of image?.observations || []) {
      if (!sourceImage || !observation?.id) continue;
      const ref = `${sourceImage}|${observation.id}`;
      if (refs.has(ref)) blockers.push(`observation_ref_duplicate:${ref}`);
      refs.add(ref);
      ids.add(observation.id);
      byRef.set(ref, observation);
    }
  }
  return { refs, ids, byRef, views };
}

function buildAssetIndex(assetSet, blockers = []) {
  const byPath = new Map();
  const byId = new Map();
  for (const asset of assetSet?.assets || []) {
    if (!asset?.id || !asset?.path) continue;
    if (byId.has(asset.id)) blockers.push(`asset_id_duplicate:${asset.id}`);
    if (byPath.has(asset.path)) blockers.push(`asset_path_duplicate:${asset.path}`);
    byId.set(asset.id, asset);
    byPath.set(asset.path, asset);
  }
  return { byId, byPath };
}

function idsForReviewItems(items, label, blockers) {
  const ids = [];
  const seen = new Set();
  for (const item of items) {
    const id = item?.candidate_id;
    if (!id) {
      blockers.push(`${label}_candidate_id_missing`);
      continue;
    }
    if (seen.has(id)) blockers.push(`${label}_candidate_duplicate:${id}`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function validateSelfSignature(blockers, label, value, expected) {
  if (!SIGNATURE_PATTERN.test(String(value?.content_signature || ''))) blockers.push(`${label}_content_signature_missing`);
  else if (value.content_signature !== expected) blockers.push(`${label}_content_signature_mismatch`);
}

function requireObject(blockers, label, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) blockers.push(`${label}_missing`);
}

function reviewResult(blockers, signatures, acceptedCandidateIds, observationIndex = { ids: new Set() }) {
  const uniqueBlockers = uniqueStrings(blockers);
  return {
    kind: 'image_structured_review_gate',
    ok: uniqueBlockers.length === 0,
    promotion_allowed: uniqueBlockers.length === 0,
    compile_allowed: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    signatures,
    accepted_candidate_ids: uniqueStrings(acceptedCandidateIds),
    source_observation_ids: [...(observationIndex.ids || [])].sort()
  };
}

function compileResult(blockers, review, signatures, binding) {
  const uniqueBlockers = uniqueStrings(blockers);
  return {
    kind: 'image_structured_compile_provenance_gate',
    ok: uniqueBlockers.length === 0,
    compile_allowed: uniqueBlockers.length === 0,
    interpretation_eligible: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    signatures,
    accepted_candidate_ids: review.accepted_candidate_ids,
    source_observation_ids: review.source_observation_ids,
    binding
  };
}

function promotionResult(blockers, review, signatures) {
  const uniqueBlockers = uniqueStrings(blockers);
  return {
    kind: 'image_structured_promotion_provenance_gate',
    ok: uniqueBlockers.length === 0,
    apply_allowed: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    signatures,
    accepted_candidate_ids: review.accepted_candidate_ids,
    source_observation_ids: review.source_observation_ids
  };
}

function sourceAssetVerificationResult({ blockers, assetSet, assets }) {
  const uniqueBlockers = uniqueStrings(blockers);
  const result = {
    version: 1,
    kind: 'image_structured_source_asset_verification',
    ok: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    asset_set_signature: assetSet && typeof assetSet === 'object' ? artifactContentSignature(assetSet) : null,
    assets: [...assets].sort((left, right) => `${left.id}|${left.path}`.localeCompare(`${right.id}|${right.path}`))
  };
  return {
    ...result,
    binding_hash: result.ok ? sourceAssetVerificationBinding(result) : null
  };
}

function normalizeSha256(value) {
  const normalized = String(value || '').toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function isWithinRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function assertNoSymlinkComponents(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('realpath_outside_root');
  let cursor = rootPath;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error('symlink_component');
  }
}

async function sha256Handle(handle, expectedBytes) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (position < expectedBytes) {
    const length = Math.min(buffer.length, expectedBytes - position);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead < 1) throw new Error('source_asset_changed_during_open');
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function canonicalize(value, excluded) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, excluded));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !excluded.has(key) && value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key], excluded)])
  );
}

function sameStringSet(left, right) {
  const first = uniqueStrings(left).sort();
  const second = uniqueStrings(right).sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
}
