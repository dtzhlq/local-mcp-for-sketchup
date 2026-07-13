export function buildPendingObjectSurfaceReview({ sourceObjectSurfaceGraph = 'object-surface-graph.json' } = {}) {
  return {
    kind: 'object_surface_review_decision_v1',
    version: 1,
    source_object_surface_graph: sourceObjectSurfaceGraph,
    source_draft_view_review: 'draft-view-review.json',
    reviewer: 'object-surface-review-template',
    status: 'not_accepted',
    accepted_surface_ids: [],
    context_only_surface_ids: [],
    rejected_surface_ids: [],
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_object_surface_review_required'],
    notes: ['No object surface is accepted by default.']
  };
}

export function evaluateObjectSurfaceReview({
  objectSurfaceGraph,
  draftViewGraph,
  draftViewReviewDecision,
  reviewDecision,
  sourceReviewDecision = 'object-surface-review.json'
} = {}) {
  const graphIds = new Set((objectSurfaceGraph?.surfaces || []).map((surface) => surface.id));
  const accepted = reviewDecision?.accepted_surface_ids || [];
  const contextOnly = reviewDecision?.context_only_surface_ids || [];
  const rejected = reviewDecision?.rejected_surface_ids || [];
  const acceptedSlots = new Set(draftViewReviewDecision?.accepted_view_slot_ids || []);
  const blockers = [];
  if (draftViewReviewDecision?.status !== 'accepted' || draftViewReviewDecision?.promotion_allowed !== true) blockers.push('accepted_draft_view_review_required');
  if (reviewDecision?.status !== 'accepted_for_local_feature_review') blockers.push('accepted_object_surface_review_required');
  if (!accepted.length) blockers.push('accepted_object_surface_required');
  const categorized = [...accepted, ...contextOnly, ...rejected];
  for (const id of categorized) if (!graphIds.has(id)) blockers.push(`unknown_object_surface_id:${id}`);
  if (new Set(categorized).size !== categorized.length) blockers.push('object_surface_review_categories_must_be_disjoint');
  for (const id of graphIds) if (!categorized.includes(id)) blockers.push(`object_surface_review_decision_missing:${id}`);
  for (const id of accepted) {
    const surface = objectSurfaceGraph.surfaces.find((candidate) => candidate.id === id);
    if (surface && !acceptedSlots.has(surface.draft_view_slot_id)) blockers.push(`object_surface_bound_to_unaccepted_draft_view:${id}`);
  }
  const availableSlots = new Set((draftViewGraph?.view_slots || []).filter((slot) => slot.status !== 'unknown').map((slot) => slot.slot_id));
  for (const slot of acceptedSlots) if (!availableSlots.has(slot)) blockers.push(`accepted_unknown_draft_view_slot:${slot}`);
  const ok = blockers.length === 0;
  return {
    kind: 'object_surface_review_result_v1',
    version: 1,
    source_object_surface_graph: reviewDecision?.source_object_surface_graph || 'object-surface-graph.json',
    source_review_decision: sourceReviewDecision,
    status: ok
      ? 'accepted_for_local_feature_review'
      : reviewDecision?.status === 'accepted_for_local_feature_review' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    accepted_surface_ids: ok ? [...accepted] : [],
    context_only_surface_ids: ok ? [...contextOnly] : [],
    local_feature_review_allowed: ok,
    promotion_allowed: false,
    compile_allowed: false,
    false_promotion_count: 0,
    blockers: ok ? ['accepted_local_detail_review_required', 'accepted_partgraph_promotion_review_required'] : Array.from(new Set(blockers))
  };
}

export function promoteReviewedObjectSurfaceFeatures({
  objectSurfaceGraph,
  surfaceReviewResult,
  localDetailReviewDecision,
  seedPartGraph
} = {}) {
  const surfaceIds = new Set(surfaceReviewResult?.accepted_surface_ids || []);
  const featureById = new Map((objectSurfaceGraph?.surface_local_feature_candidates || []).map((feature) => [feature.id, feature]));
  const partIds = new Set((seedPartGraph?.parts || []).map((part) => part.id));
  const referenceByImage = new Map((objectSurfaceGraph?.coordinate_references || []).map((reference) => [reference.source_image, reference]));
  const blockers = [];
  const mappings = [];
  let outOfBoundsCount = 0;
  let degenerateGeometryCount = 0;
  if (surfaceReviewResult?.status !== 'accepted_for_local_feature_review') blockers.push('accepted_object_surface_review_required');
  if (localDetailReviewDecision?.status !== 'accepted') blockers.push('accepted_local_detail_review_required');
  if (localDetailReviewDecision?.promotion_allowed !== false || localDetailReviewDecision?.compile_allowed !== false) blockers.push('review_decision_cannot_directly_promote_or_compile');
  if (!sameSet(localDetailReviewDecision?.accepted_surface_ids || [], [...surfaceIds])) blockers.push('local_detail_review_surface_lineage_mismatch');
  const bindingByFeature = new Map((localDetailReviewDecision?.detail_bindings || []).map((binding) => [binding.detail_id, binding]));
  for (const featureId of localDetailReviewDecision?.accepted_detail_ids || []) {
    const feature = featureById.get(featureId);
    const binding = bindingByFeature.get(featureId);
    if (!feature) {
      blockers.push(`unknown_object_feature_id:${featureId}`);
      continue;
    }
    if (binding?.status !== 'accepted' || !binding.target_surface_id) {
      blockers.push(`accepted_object_surface_binding_required:${featureId}`);
      continue;
    }
    if (!surfaceIds.has(binding.target_surface_id)) blockers.push(`object_feature_bound_to_unaccepted_surface:${featureId}`);
    if (!feature.candidate_surface_ids.includes(binding.target_surface_id)) blockers.push(`object_feature_surface_binding_not_supported:${featureId}`);
    if (!binding.target_part_id || !partIds.has(binding.target_part_id)) blockers.push(`reviewed_target_part_missing_or_unknown:${featureId}`);
    const [x, y, width, height] = feature.bbox_px || [];
    if (!(width > 1 && height > 1) || polygonArea(feature.visible_quad_px || []) <= 4) {
      degenerateGeometryCount += 1;
      blockers.push(`object_feature_geometry_degenerate:${featureId}`);
    }
    const reference = referenceByImage.get(feature.source_image);
    if (!reference || !bboxInside([x, y, width, height], reference)) {
      outOfBoundsCount += 1;
      blockers.push(`object_feature_out_of_source_bounds:${featureId}`);
    }
    mappings.push({
      feature_id: feature.id,
      role: feature.role,
      source_image: feature.source_image,
      source_observation_id: feature.source_observation_id,
      accepted_surface_id: binding.target_surface_id,
      target_part_id: binding.target_part_id,
      bbox_px: feature.bbox_px,
      visible_quad_px: feature.visible_quad_px,
      source_kind: feature.source?.kind || 'unknown',
      confidence: Number(feature.source?.confidence || 0)
    });
  }
  if (!mappings.length) blockers.push('accepted_object_feature_required');
  const ok = blockers.length === 0;
  return {
    kind: 'object_surface_feature_promotion_v1',
    version: 1,
    status: ok ? 'accepted_for_mock_partgraph' : localDetailReviewDecision?.status === 'accepted' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    source_object_surface_graph: 'object-surface-graph.json',
    source_surface_review_result: 'object-surface-review-result.json',
    source_local_detail_review: 'local-detail-review.json',
    accepted_surface_ids: ok ? [...surfaceIds] : [],
    accepted_feature_ids: ok ? mappings.map((mapping) => mapping.feature_id) : [],
    accepted_target_part_ids: ok ? [...new Set(mappings.map((mapping) => mapping.target_part_id))] : [],
    accepted_feature_mappings: ok ? mappings : [],
    qa: {
      status: ok ? 'pass' : 'blocked',
      checked_feature_count: mappings.length,
      out_of_bounds_count: outOfBoundsCount,
      degenerate_geometry_count: degenerateGeometryCount
    },
    partgraph_promotion_allowed: ok,
    direct_compile_allowed: false,
    release_allowed: false,
    false_promotion_count: 0,
    blockers: ok ? ['accepted_metric_scale_anchor_required', 'accepted_complete_feature_coverage_review_required', 'accepted_hidden_surface_review_required'] : Array.from(new Set(blockers))
  };
}

export function buildReviewedObjectFeatureSubsetPartGraph({ seedPartGraph, featurePromotion, sampleId = 'object-surface-study' } = {}) {
  if (featurePromotion?.status !== 'accepted_for_mock_partgraph' || featurePromotion?.partgraph_promotion_allowed !== true) {
    const error = new Error('accepted_object_surface_feature_promotion_required');
    error.code = 'accepted_object_surface_feature_promotion_required';
    throw error;
  }
  const acceptedPartIds = new Set(featurePromotion.accepted_target_part_ids);
  const mappingsByPart = new Map();
  for (const mapping of featurePromotion.accepted_feature_mappings) {
    if (!mappingsByPart.has(mapping.target_part_id)) mappingsByPart.set(mapping.target_part_id, []);
    mappingsByPart.get(mapping.target_part_id).push(mapping);
  }
  const parts = (seedPartGraph.parts || []).filter((part) => acceptedPartIds.has(part.id)).map((part) => {
    const mappings = mappingsByPart.get(part.id) || [];
    const next = structuredClone(part);
    if (next.parent && !acceptedPartIds.has(next.parent)) delete next.parent;
    next.relationships = (next.relationships || []).filter((relationship) => acceptedPartIds.has(relationship.target));
    next.evidence_status = 'manual_confirmed';
    next.evidence_sources = mappings.map((mapping) => ({
      kind: 'accepted_object_surface_feature',
      view: objectViewForSurface(mapping.accepted_surface_id),
      status: 'manual_confirmed',
      source_image: mapping.source_image,
      confidence: mapping.confidence,
      note: `${mapping.feature_id} reviewed on ${mapping.accepted_surface_id}.`
    }));
    next.grounding_status = 'review_confirmed';
    next.grounding_method = 'accepted_object_surface_and_local_feature_reviews';
    next.grounding_decision = 'promoted_geometry';
    next.source_observation_ids = mappings.map((mapping) => mapping.source_observation_id);
    next.review_required = false;
    next.helper_allowed = false;
    next.photo_grade_eligible = false;
    next.compile = { ...(next.compile || {}), emit: true, runtime_scope: 'mock_study_only' };
    next.promoted_geometry = true;
    next.qa = {
      ...(next.qa || {}),
      promoted_geometry: true,
      accepted_feature_ids: mappings.map((mapping) => mapping.feature_id),
      accepted_surface_ids: [...new Set(mappings.map((mapping) => mapping.accepted_surface_id))],
      metric_scale_accepted: false,
      complete_feature_coverage_accepted: false,
      release_allowed: false
    };
    return next;
  });
  if (parts.length !== acceptedPartIds.size) throw new Error('accepted_target_part_subset_incomplete');
  return {
    ...structuredClone(seedPartGraph),
    id: `${safeId(sampleId)}-reviewed-object-feature-subset-part-graph`,
    compile_policy: {
      enabled: true,
      runtime_scope: 'mock_study_only',
      release_allowed: false,
      max_needs_review_ratio: 0,
      max_profile_default_ratio: 1,
      min_inferred_parts: 0,
      min_scale_confidence: 0,
      require_promoted_geometry: true,
      block_reference_only_output: true
    },
    scale: {
      ...structuredClone(seedPartGraph.scale),
      confidence: Math.min(Number(seedPartGraph.scale?.confidence || 0), 0.49),
      calibration: {
        ...(structuredClone(seedPartGraph.scale?.calibration) || {}),
        status: 'profile_default_mock_study_only',
        release_allowed: false
      }
    },
    evidence_graph: {
      version: 1,
      source_images: [...new Set(featurePromotion.accepted_feature_mappings.map((mapping) => mapping.source_image))],
      views_detected: [...new Set(featurePromotion.accepted_feature_mappings.map((mapping) => objectViewForSurface(mapping.accepted_surface_id)))],
      accepted_surface_ids: featurePromotion.accepted_surface_ids,
      accepted_local_detail_ids: featurePromotion.accepted_feature_ids,
      open_questions: [
        'Metric dimensions remain profile-default mock assumptions.',
        'Only the explicitly reviewed feature subset is present.',
        'Hidden surfaces and complete feature coverage remain unaccepted.'
      ]
    },
    parts,
    operations: (seedPartGraph.operations || []).filter((operation) => operationReferencesAcceptedParts(operation, acceptedPartIds)),
    physical_relations: (seedPartGraph.physical_relations || []).filter((relation) => physicalRelationReferencesAcceptedParts(relation, acceptedPartIds)),
    review: {
      open_questions: [
        'Accept a real metric scale before release.',
        'Review remaining visible feature candidates and hidden surfaces before claiming completeness.'
      ],
      correction_targets: parts.map((part) => ({
        part_id: part.id,
        path: `parts[${part.id}].shape.parameters`,
        reason: 'Replace template geometry after accepted geometric parameter review.',
        severity: 'warn'
      }))
    }
  };
}

function operationReferencesAcceptedParts(operation, acceptedPartIds) {
  const directIds = [operation.part_id, operation.target_part_id].filter(Boolean);
  if (!directIds.length) return false;
  if (!directIds.every((id) => acceptedPartIds.has(id))) return false;
  if ((operation.tool_part_ids || []).some((id) => !acceptedPartIds.has(id))) return false;
  if (operation.target_id && !acceptedPartIds.has(operation.target_id)) return false;
  return true;
}

function physicalRelationReferencesAcceptedParts(relation, acceptedPartIds) {
  const ids = [relation.part_id, relation.target_part_id, relation.a, relation.b, relation.from, relation.to].filter(Boolean);
  return ids.length > 0 && ids.every((id) => acceptedPartIds.has(id));
}

function bboxInside([x, y, width, height], reference) {
  return [x, y, width, height].every(Number.isFinite)
    && x >= 0 && y >= 0 && width > 0 && height > 0
    && x + width <= Number(reference.width) + 1e-6
    && y + height <= Number(reference.height) + 1e-6;
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area / 2);
}

function objectViewForSurface(surfaceId) {
  if (surfaceId === 'surface_front') return 'front';
  if (surfaceId === 'surface_left_or_right_side') return 'left_or_right_side';
  if (surfaceId === 'surface_top') return 'top';
  return 'oblique_context';
}

function sameSet(left = [], right = []) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function safeId(value) {
  return String(value || 'unknown').trim().replace(/[^a-zA-Z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '') || 'unknown';
}
