export const GROUNDING_STATUSES = [
  'image_grounded',
  'review_confirmed',
  'helper_only',
  'profile_prior',
  'rejected'
];

export const IMAGE_GROUNDING_METHODS = new Set([
  'mask_polygon',
  'sampled_contour',
  'line_segment',
  'gap_region',
  'vegetation_region',
  'keypoint',
  'scale_anchor',
  'pixel_color_segmentation',
  'pixel_line_segmentation',
  'pixel_gap_segmentation',
  'pixel_vegetation_segmentation',
  'edge_contour_segmentation',
  'edge_keypoint_segmentation',
  'known_element_scale_anchor'
]);

export const HELPER_DENSE_DETAIL_ROLES = new Set([
  'perimeter_fence',
  'entry_guardhouse',
  'entry_canopy',
  'entry_gate',
  'road_marking',
  'crosswalk_stripe',
  'pedestrian_walkway',
  'parking_stall_line',
  'parking_tree_island_curb',
  'landscape_tree_trunk',
  'landscape_tree_canopy',
  'parked_vehicle_body',
  'parked_vehicle_wheel',
  'loading_truck_trailer',
  'loading_truck_cab',
  'loading_dock_apron',
  'roof_monitor',
  'roof_panel_seam',
  'roof_vent',
  'roof_hvac',
  'tank_roof_cap',
  'tank_roof_hatch',
  'tank_base_plinth',
  'tank_service_platform',
  'tank_pipe_bridge',
  'photoreal_texture_alignment',
  'roof_texture',
  'ground_texture'
]);

export function observationGroundingMetadata(observation = {}, options = {}) {
  const method = options.method
    || observation.grounding?.method
    || observation.mask?.method
    || observation.contour?.source
    || observation.kind
    || null;
  const quality = observation.grounding?.grounding_quality || observation.mask?.quality || {};
  const sourceObservationIds = unique([options.observationId || observation.id].filter(Boolean));
  const isolation = isolationFromQuality(quality, observation);
  const reviewRequired = Boolean(
    options.reviewRequired
    || observation.review_required
    || observation.grounding?.review_required
    || observation.mask?.review_required
    || observation.contour?.review_required
    || quality.review_required
    || isolation.review_required
  );
  const status = groundingStatusFromEvidence({
    method,
    hasObservation: sourceObservationIds.length > 0,
    reviewRequired,
    quality,
    fallbackState: options.fallbackState,
    note: observation.note,
    sourceStatus: options.sourceStatus
  });
  return normalizeGroundingMetadata({
    grounding_status: status,
    grounding_method: method,
    source_observation_ids: sourceObservationIds,
    grounding_isolation: isolation,
    review_required: reviewRequired || status === 'review_confirmed',
    helper_allowed: status === 'helper_only' || options.helperAllowed === true,
    photo_grade_eligible: status === 'image_grounded' && sourceObservationIds.length > 0 && !reviewRequired
  });
}

export function groundingMetadataForEvidenceSources(sources = [], options = {}) {
  const records = sources.map((source) => groundingMetadataForEvidenceSource(source, options));
  if (records.length === 0) {
    return normalizeGroundingMetadata({
      grounding_status: fallbackGroundingStatus(options.fallbackState, options),
      grounding_method: options.method || (options.helperAllowed ? 'helper_generated' : null),
      source_observation_ids: [],
      grounding_isolation: null,
      review_required: Boolean(options.reviewRequired),
      helper_allowed: Boolean(options.helperAllowed) || options.fallbackState === 'visual_helper',
      photo_grade_eligible: false
    });
  }

  const statuses = records.map((record) => record.grounding_status);
  const reviewRequired = Boolean(options.reviewRequired) || records.some((record) => record.review_required);
  const status = chooseCombinedGroundingStatus(statuses, {
    reviewRequired,
    fallbackState: options.fallbackState,
    helperAllowed: options.helperAllowed
  });
  const sourceObservationIds = unique(records.flatMap((record) => record.source_observation_ids || []));
  const methods = unique(records.map((record) => record.grounding_method).filter(Boolean));
  return normalizeGroundingMetadata({
    grounding_status: status,
    grounding_method: methods[0] || null,
    source_observation_ids: sourceObservationIds,
    grounding_isolation: combineIsolation(records),
    review_required: reviewRequired || status === 'review_confirmed',
    helper_allowed: Boolean(options.helperAllowed)
      || options.fallbackState === 'visual_helper'
      || status === 'helper_only',
    photo_grade_eligible: status === 'image_grounded' && sourceObservationIds.length > 0 && !reviewRequired
  });
}

export function groundingMetadataForEvidenceSource(source = {}, options = {}) {
  const method = source.grounding?.method
    || source.mask?.method
    || methodForSourceKind(source.kind)
    || options.method
    || null;
  const quality = source.grounding?.grounding_quality || source.mask?.quality || {};
  const sourceObservationIds = unique([source.observation_id, ...(source.source_observation_ids || [])].filter(Boolean));
  const reviewRequired = Boolean(
    source.review_required
    || source.grounding?.review_required
    || quality.review_required
  );
  const status = groundingStatusFromEvidence({
    method,
    hasObservation: sourceObservationIds.length > 0,
    reviewRequired,
    quality,
    fallbackState: options.fallbackState,
    note: source.note,
    sourceStatus: source.status,
    kind: source.kind
  });
  return normalizeGroundingMetadata({
    grounding_status: status,
    grounding_method: method,
    source_observation_ids: sourceObservationIds,
    grounding_isolation: isolationFromQuality(quality),
    review_required: reviewRequired || status === 'review_confirmed',
    helper_allowed: status === 'helper_only',
    photo_grade_eligible: status === 'image_grounded' && sourceObservationIds.length > 0 && !reviewRequired
  });
}

export function withGroundingMetadata(entity = {}, options = {}) {
  const metadata = groundingMetadataForEvidenceSources(entity.evidence_sources || [], {
    fallbackState: entity.fallback_state,
    helperAllowed: options.helperAllowed,
    reviewRequired: options.reviewRequired ?? entity.qa?.review_required,
    method: options.method
  });
  const merged = {
    ...entity,
    grounding_status: options.groundingStatus || metadata.grounding_status,
    grounding_method: options.groundingMethod || metadata.grounding_method,
    source_observation_ids: options.sourceObservationIds || metadata.source_observation_ids,
    projection_residuals: entity.projection_residuals || options.projectionResiduals || null,
    review_required: options.reviewRequired ?? entity.review_required ?? metadata.review_required,
    helper_allowed: options.helperAllowed ?? entity.helper_allowed ?? metadata.helper_allowed,
    photo_grade_eligible: options.photoGradeEligible ?? entity.photo_grade_eligible ?? metadata.photo_grade_eligible
  };
  merged.qa = qaWithGroundingMetadata(entity.qa || {}, merged);
  return merged;
}

export function featureIntentWithGroundingMetadata(feature = {}, parentPart = {}, options = {}) {
  const metadata = groundingMetadataForEvidenceSources(feature.evidence_sources || parentPart.evidence_sources || [], {
    fallbackState: feature.fallback_state,
    helperAllowed: options.helperAllowed ?? feature.fallback_state === 'visual_helper',
    reviewRequired: options.reviewRequired ?? feature.review_required,
    method: options.method
  });
  return {
    ...feature,
    grounding_status: options.groundingStatus || metadata.grounding_status,
    grounding_method: options.groundingMethod || metadata.grounding_method,
    source_observation_ids: options.sourceObservationIds || metadata.source_observation_ids,
    projection_residuals: feature.projection_residuals || null,
    review_required: options.reviewRequired ?? feature.review_required ?? metadata.review_required,
    helper_allowed: options.helperAllowed ?? feature.helper_allowed ?? metadata.helper_allowed,
    photo_grade_eligible: options.photoGradeEligible ?? feature.photo_grade_eligible ?? metadata.photo_grade_eligible
  };
}

export function qaWithGroundingMetadata(qa = {}, metadataOrOptions = {}) {
  const metadata = metadataOrOptions.grounding_status
    ? metadataOrOptions
    : groundingMetadataForEvidenceSources(qa.evidence_sources || [], {
      fallbackState: qa.fallback_state,
      helperAllowed: metadataOrOptions.helperAllowed,
      reviewRequired: metadataOrOptions.reviewRequired ?? qa.review_required,
      method: metadataOrOptions.method
    });
  return {
    ...qa,
    grounding_status: metadata.grounding_status,
    grounding_method: metadata.grounding_method,
    source_observation_ids: metadata.source_observation_ids || [],
    projection_residuals: metadata.projection_residuals || qa.projection_residuals || null,
    review_required: metadata.review_required ?? qa.review_required ?? false,
    helper_allowed: metadata.helper_allowed ?? false,
    photo_grade_eligible: metadata.photo_grade_eligible ?? false
  };
}

export function summarizePartGraphGrounding(partGraph = {}) {
  const parts = partGraph.parts || [];
  const featureIntents = parts.flatMap((part) => part.feature_intents || []);
  return {
    version: 2,
    parts: summarizeGroundingItems(parts),
    feature_intents: summarizeGroundingItems(featureIntents),
    photo_grade_ready: parts.length > 0 && parts.every((part) => part.photo_grade_eligible === true),
    helper_heavy: parts.filter((part) => part.grounding_status === 'helper_only').length > 0
  };
}

export function summarizeDenseDetailGroundingFromOperations(operations = [], options = {}) {
  const qaItems = operations
    .filter((operation) => operation?.qa)
    .map((operation) => groundingItemFromOperation(operation));
  const denseItems = qaItems.filter((item) => isDenseDetailGroundingItem(item));
  const primaryItems = qaItems.filter((item) => !isDenseDetailGroundingItem(item));
  const denseSummary = summarizeGroundingItems(denseItems);
  const primarySummary = summarizeGroundingItems(primaryItems);
  const helperRatio = ratio(denseSummary.by_status.helper_only || 0, denseSummary.total);
  const imageGroundedClaimsWithoutObservation = qaItems.filter((item) => (
    item.grounding_status === 'image_grounded'
    && (!item.source_observation_ids || item.source_observation_ids.length === 0)
  ));
  return {
    version: 2,
    total_items: qaItems.length,
    primary_structures: primarySummary,
    dense_details: {
      ...denseSummary,
      helper_ratio: helperRatio,
      helper_roles: unique(denseItems
        .filter((item) => item.grounding_status === 'helper_only')
        .map((item) => item.role)
        .filter(Boolean))
    },
    image_grounded_claims_without_observation: imageGroundedClaimsWithoutObservation.map((item) => ({
      id: item.id,
      role: item.role,
      grounding_method: item.grounding_method
    })),
    sample_items: qaItems.slice(0, options.sampleLimit ?? 24)
  };
}

export function groundingAcceptanceIssues(groundingReport = {}, thresholds = {}) {
  const issues = [];
  const missingObservationClaims = groundingReport.image_grounded_claims_without_observation || [];
  for (const item of missingObservationClaims) {
    issues.push({
      severity: 'error',
      type: 'geometry_fit.ungrounded_image_claim',
      rule_id: item.id,
      message: `${item.id} is marked image_grounded without source_observation_ids.`,
      evidence: item
    });
  }

  const dense = groundingReport.dense_details || {};
  const helperRatio = Number(dense.helper_ratio || 0);
  const maxHelperRatio = thresholds.max_dense_helper_ratio ?? thresholds.maxDenseHelperRatio ?? 0.35;
  if ((dense.total || 0) > 0 && helperRatio > maxHelperRatio) {
    issues.push({
      severity: thresholds.require_photo_grade ? 'error' : 'warn',
      type: 'geometry_fit.helper_heavy_dense_detail',
      rule_id: 'dense_detail_grounding',
      message: `Dense detail layer is helper-heavy (${helperRatio}); do not treat this model as photo-grade grounded.`,
      evidence: {
        helper_ratio: helperRatio,
        max_helper_ratio: maxHelperRatio,
        helper_roles: dense.helper_roles || []
      }
    });
  }
  return issues;
}

function groundingItemFromOperation(operation) {
  const qa = operation.qa || {};
  const status = qa.grounding_status || groundingStatusFromEvidence({
    method: qa.grounding_method,
    hasObservation: (qa.source_observation_ids || []).length > 0,
    reviewRequired: qa.review_required,
    fallbackState: qa.fallback_state,
    sourceStatus: qa.evidence_status,
    kind: qa.role,
    note: qa.intent
  });
  return {
    id: operation.id || operation.name || operation.feature_id || operation.target_id || operation.op,
    op: operation.op,
    role: qa.role || qa.intent || operation.op,
    grounding_status: status,
    grounding_method: qa.grounding_method || methodForSourceKind(qa.role) || null,
    source_observation_ids: qa.source_observation_ids || [],
    review_required: Boolean(qa.review_required),
    helper_allowed: Boolean(qa.helper_allowed || qa.fallback_state === 'visual_helper' || status === 'helper_only'),
    photo_grade_eligible: Boolean(qa.photo_grade_eligible),
    fallback_state: qa.fallback_state,
    evidence_status: qa.evidence_status
  };
}

function summarizeGroundingItems(items = []) {
  const total = items.length;
  const byStatus = countBy(items, 'grounding_status');
  const byRole = countBy(items, 'role');
  const imageGrounded = byStatus.image_grounded || 0;
  const grounded = imageGrounded + (byStatus.review_confirmed || 0);
  const reviewRequired = items.filter((item) => item.review_required).length;
  const photoGradeEligible = items.filter((item) => item.photo_grade_eligible).length;
  return {
    total,
    by_status: byStatus,
    by_role: byRole,
    grounded,
    image_grounded: imageGrounded,
    review_required: reviewRequired,
    rejected: byStatus.rejected || 0,
    photo_grade_eligible: photoGradeEligible,
    grounded_ratio: ratio(grounded, total),
    image_grounded_ratio: ratio(imageGrounded, total),
    photo_grade_eligible_ratio: ratio(photoGradeEligible, total)
  };
}

function isDenseDetailGroundingItem(item) {
  if (HELPER_DENSE_DETAIL_ROLES.has(item.role)) return true;
  if (/photoreal|site_detail|texture|helper/i.test(item.role || '')) return true;
  return false;
}

function chooseCombinedGroundingStatus(statuses, options = {}) {
  if (statuses.includes('rejected')) return 'rejected';
  if (statuses.includes('image_grounded') && !options.reviewRequired) return 'image_grounded';
  if (statuses.includes('image_grounded')) return 'review_confirmed';
  if (statuses.includes('review_confirmed')) return 'review_confirmed';
  if (statuses.includes('profile_prior')) return 'profile_prior';
  if (statuses.includes('helper_only')) return 'helper_only';
  return fallbackGroundingStatus(options.fallbackState, options);
}

function groundingStatusFromEvidence({ method, hasObservation, reviewRequired, quality, fallbackState, note, sourceStatus, kind } = {}) {
  if (quality?.status === 'rejected' || quality?.status === 'fail') return 'rejected';
  if (sourceStatus === 'template_prior' || fallbackState === 'profile_default') return 'profile_prior';
  if (IMAGE_GROUNDING_METHODS.has(method) && hasObservation && !reviewRequired) return 'image_grounded';
  if (IMAGE_GROUNDING_METHODS.has(method) && hasObservation) return 'review_confirmed';
  if (method === 'helper_generated' || fallbackState === 'visual_helper') return 'helper_only';
  if (/helper_generated|visual helper/i.test(`${kind || ''} ${note || ''}`)) return 'helper_only';
  if (/template|layout prior|profile prior/i.test(`${note || ''}`)) return 'profile_prior';
  if (sourceStatus === 'manual_confirmed' || method === 'manual_review') return 'review_confirmed';
  if (hasObservation) return 'review_confirmed';
  return fallbackGroundingStatus(fallbackState, { helperAllowed: false });
}

function fallbackGroundingStatus(fallbackState, options = {}) {
  if (options.helperAllowed || fallbackState === 'visual_helper' || fallbackState === 'reference_only') return 'helper_only';
  if (fallbackState === 'profile_default' || fallbackState === 'template_prior') return 'profile_prior';
  return 'profile_prior';
}

function methodForSourceKind(kind) {
  if (!kind) return null;
  if (kind === 'known_element_scale_anchor') return 'scale_anchor';
  if (kind === 'parameter_proposal_review') return 'manual_review';
  if (kind === 'manual_review') return 'manual_review';
  if (kind === 'helper_generated') return 'helper_generated';
  if (kind === 'mask_polygon') return 'mask_polygon';
  if (kind === 'sampled_contour') return 'sampled_contour';
  if (kind === 'line_segment') return 'line_segment';
  if (kind === 'gap_region') return 'gap_region';
  if (kind === 'vegetation_region') return 'vegetation_region';
  if (kind === 'keypoint') return 'keypoint';
  return null;
}

function isolationFromQuality(quality = {}, observation = {}) {
  const sampleCount = observation.contour?.sample_count
    ?? observation.contour?.polygon?.length
    ?? observation.mask?.sampled_contour?.length
    ?? observation.mask?.polygon?.length
    ?? null;
  const reasons = unique([
    ...(quality.reasons || []),
    ...(quality.bbox_proxy === true && sampleCount !== null && sampleCount <= 5 ? ['bbox_proxy_not_instance_mask'] : [])
  ]);
  return {
    version: 2,
    status: reasons.length ? 'review' : 'pass',
    raw_to_evidence_bbox_ratio: quality.raw_to_evidence_bbox_ratio ?? null,
    prior_to_evidence_bbox_ratio: quality.prior_to_evidence_bbox_ratio ?? null,
    bbox_proxy: quality.bbox_proxy ?? false,
    contour_sample_count: sampleCount,
    review_required: Boolean(quality.review_required || reasons.length),
    reasons
  };
}

function combineIsolation(records = []) {
  const isolations = records.map((record) => record.grounding_isolation).filter(Boolean);
  if (!isolations.length) return null;
  const reasons = unique(isolations.flatMap((item) => item.reasons || []));
  return {
    version: 2,
    status: reasons.length ? 'review' : 'pass',
    bbox_proxy: isolations.some((item) => item.bbox_proxy === true),
    review_required: isolations.some((item) => item.review_required === true),
    reasons
  };
}

function normalizeGroundingMetadata(metadata) {
  const status = GROUNDING_STATUSES.includes(metadata.grounding_status)
    ? metadata.grounding_status
    : 'profile_prior';
  return {
    grounding_status: status,
    grounding_method: metadata.grounding_method || null,
    source_observation_ids: unique(metadata.source_observation_ids || []),
    grounding_isolation: metadata.grounding_isolation || null,
    projection_residuals: metadata.projection_residuals || null,
    review_required: Boolean(metadata.review_required),
    helper_allowed: Boolean(metadata.helper_allowed),
    photo_grade_eligible: Boolean(metadata.photo_grade_eligible && status === 'image_grounded')
  };
}

function countBy(items, key) {
  const result = {};
  for (const item of items || []) {
    const value = item?.[key] ?? 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function ratio(value, total) {
  return total > 0 ? round(value / total) : 0;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null && value !== ''))];
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}
