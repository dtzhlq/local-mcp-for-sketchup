export function buildPendingVisibleCoverageReview({
  sourceSurfaceGraph = 'room-surface-graph.json',
  sourceSurfaceReviewResult = 'room-surface-review-result.json'
} = {}) {
  return {
    kind: 'visible_coverage_review_decision_v1',
    version: 1,
    source_surface_graph: sourceSurfaceGraph,
    source_surface_review_result: sourceSurfaceReviewResult,
    reviewer: 'visible-coverage-review-template',
    status: 'not_accepted',
    accepted_visible_surface_ids: [],
    excluded_regions: [],
    coverage_status: 'partial',
    promotion_allowed: false,
    compile_allowed: false,
    notes: ['Visible completion requires reviewed surface coverage or explicit non-promotable exclusion polygons.']
  };
}

export function evaluateVisibleCoverageReview({
  surfaceGraph,
  surfaceReviewResult,
  reviewDecision,
  sourceReviewDecision = 'visible-coverage-review.json'
} = {}) {
  const blockers = [];
  const reviewedIds = new Set(surfaceReviewResult?.accepted_surface_ids || []);
  const graphIds = new Set((surfaceGraph?.surfaces || []).map((surface) => surface.id));
  const acceptedIds = reviewDecision?.accepted_visible_surface_ids || [];
  if (surfaceReviewResult?.status !== 'accepted_for_derived_drafting') {
    blockers.push('accepted_surface_review_required');
  }
  if (reviewDecision?.status !== 'accepted') blockers.push('accepted_visible_coverage_review_required');
  if (!['complete_visible_coverage', 'complete_with_explicit_exclusions'].includes(reviewDecision?.coverage_status)) {
    blockers.push('complete_visible_coverage_status_required');
  }
  if (!sameSet(acceptedIds, [...reviewedIds])) blockers.push('accepted_visible_surface_lineage_mismatch');
  for (const id of acceptedIds) {
    if (!graphIds.has(id)) blockers.push(`unknown_visible_surface_id:${id}`);
  }
  const exclusions = reviewDecision?.excluded_regions || [];
  if (reviewDecision?.coverage_status === 'complete_visible_coverage' && exclusions.length) {
    blockers.push('complete_visible_coverage_must_not_contain_exclusions');
  }
  if (reviewDecision?.coverage_status === 'complete_with_explicit_exclusions' && !exclusions.length) {
    blockers.push('explicit_exclusion_region_required');
  }
  const imageBounds = surfaceGraphImageBounds(surfaceGraph);
  const exclusionIds = new Set();
  for (const exclusion of exclusions) {
    if (!exclusion?.id || exclusionIds.has(exclusion.id)) blockers.push(`invalid_or_duplicate_exclusion_id:${exclusion?.id || 'missing'}`);
    exclusionIds.add(exclusion?.id);
    if (exclusion?.status !== 'excluded_non_promotable') blockers.push(`exclusion_status_invalid:${exclusion?.id || 'missing'}`);
    if (exclusion?.promotion_allowed !== false) blockers.push(`exclusion_promotion_must_be_false:${exclusion?.id || 'missing'}`);
    if (exclusion?.compile_allowed !== false) blockers.push(`exclusion_compile_must_be_false:${exclusion?.id || 'missing'}`);
    if (!String(exclusion?.reason || '').trim()) blockers.push(`exclusion_reason_required:${exclusion?.id || 'missing'}`);
    if (!Array.isArray(exclusion?.polygon_px) || exclusion.polygon_px.length < 3) {
      blockers.push(`exclusion_polygon_invalid:${exclusion?.id || 'missing'}`);
    } else if (!polygonInsideBounds(exclusion.polygon_px, imageBounds)) {
      blockers.push(`exclusion_polygon_out_of_bounds:${exclusion?.id || 'missing'}`);
    } else if (Math.abs(polygonArea(exclusion.polygon_px)) < 4) {
      blockers.push(`exclusion_polygon_degenerate:${exclusion?.id || 'missing'}`);
    }
    if (exclusion?.source_image !== imageBounds.sourceImage) {
      blockers.push(`exclusion_source_image_mismatch:${exclusion?.id || 'missing'}`);
    }
    for (const id of exclusion?.affected_surface_ids || []) {
      if (!reviewedIds.has(id)) blockers.push(`exclusion_references_unaccepted_surface:${exclusion?.id || 'missing'}:${id}`);
    }
  }
  const accepted = blockers.length === 0;
  return {
    kind: 'visible_coverage_review_result_v1',
    version: 1,
    source_surface_graph: reviewDecision?.source_surface_graph || 'room-surface-graph.json',
    source_surface_review_result: reviewDecision?.source_surface_review_result || 'room-surface-review-result.json',
    source_review_decision: sourceReviewDecision,
    status: accepted
      ? 'accepted_for_visual_completion'
      : reviewDecision?.status === 'accepted' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    coverage_status: reviewDecision?.coverage_status || 'partial',
    accepted_visible_surface_ids: accepted ? [...acceptedIds] : [],
    excluded_regions: accepted ? structuredClone(exclusions) : [],
    visual_completion_eligible: accepted,
    promotion_allowed: false,
    compile_allowed: false,
    false_promotion_count: 0,
    blockers: accepted ? [] : Array.from(new Set(blockers))
  };
}

function surfaceGraphImageBounds(surfaceGraph) {
  const reference = surfaceGraph?.coordinate_reference || {};
  return {
    sourceImage: reference.source_image || surfaceGraph?.source_images?.[0] || '',
    width: Number(reference.width || 0),
    height: Number(reference.height || 0)
  };
}

function polygonInsideBounds(polygon, bounds) {
  if (!(bounds.width > 0 && bounds.height > 0)) return false;
  return polygon.every((point) => (
    Array.isArray(point)
    && point.length === 2
    && point.every(Number.isFinite)
    && point[0] >= 0
    && point[0] <= bounds.width
    && point[1] >= 0
    && point[1] <= bounds.height
  ));
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function sameSet(left = [], right = []) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
