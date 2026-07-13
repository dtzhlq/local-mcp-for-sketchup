export function buildMultiViewCalibrationGraph({ views, correspondenceCandidates = [] } = {}) {
  if (!Array.isArray(views) || views.length < 2) throw new Error('At least two calibrated view inputs are required');
  const viewNodes = views.map((view) => ({
    id: view.id,
    source_image: view.source_image,
    calibration_status: view.calibration_review_result?.status === 'accepted_for_rectification'
      ? 'accepted_for_rectification'
      : view.calibration_review_result
        ? 'blocked'
        : 'pending',
    camera_model: view.calibration_review_result?.accepted_camera_model || null,
    accepted_axis_families: view.calibration_review_result?.accepted_axis_families || [],
    review_required: true,
    promotion_allowed: false
  }));
  const acceptedCount = viewNodes.filter((view) => view.calibration_status === 'accepted_for_rectification').length;
  const correspondences = correspondenceCandidates.map((candidate) => ({
    ...candidate,
    review_required: true,
    promotion_allowed: false
  }));
  const sharedAxisHypotheses = buildSharedAxisHypotheses(viewNodes);
  const blockers = ['accepted_multi_view_calibration_review_required'];
  if (acceptedCount !== viewNodes.length) blockers.push('accepted_per_view_calibration_reviews_required');
  if (correspondences.length < 2) blockers.push('at_least_two_cross_view_correspondences_required');
  const status = acceptedCount !== viewNodes.length
    ? 'blocked_missing_per_view_calibration'
    : correspondences.length < 2
      ? 'blocked_no_correspondences'
      : 'needs_multi_view_review';
  return {
    kind: 'multi_view_calibration_graph_v1',
    version: 1,
    view_nodes: viewNodes,
    shared_axis_hypotheses: sharedAxisHypotheses,
    correspondence_candidates: correspondences,
    review_policy: {
      status,
      accepted_multi_view_review_required: true,
      evidence_fusion_allowed: false,
      geometry_fusion_allowed: false,
      promotion_allowed: false,
      compile_allowed: false,
      blockers
    },
    summary: {
      view_count: viewNodes.length,
      accepted_calibration_view_count: acceptedCount,
      correspondence_candidate_count: correspondences.length,
      promotion_allowed: false
    }
  };
}

export function buildPendingMultiViewCalibrationReview() {
  return {
    kind: 'multi_view_calibration_review_decision_v1',
    version: 1,
    source_multi_view_calibration_graph: 'multi-view-calibration-graph.json',
    reviewer: 'multi-view-review-template',
    status: 'not_accepted',
    accepted_view_ids: [],
    accepted_correspondence_ids: [],
    promotion_allowed: false,
    compile_allowed: false,
    notes: ['Pending per-view calibration and correspondence review.']
  };
}

export function buildAcceptedMultiViewCalibrationReviewFixture({ graph } = {}) {
  return {
    kind: 'multi_view_calibration_review_decision_v1',
    version: 1,
    source_multi_view_calibration_graph: 'multi-view-calibration-graph.json',
    reviewer: 'multi-view-positive-fixture',
    status: 'accepted_for_evidence_fusion',
    accepted_view_ids: graph.view_nodes.map((view) => view.id),
    accepted_correspondence_ids: graph.correspondence_candidates.map((candidate) => candidate.id),
    promotion_allowed: false,
    compile_allowed: false,
    notes: [
      'Fixture accepts cross-view evidence identity only.',
      'No relative metric pose, geometry fusion, PartGraph, or SketchUp promotion is authorized.'
    ]
  };
}

export function evaluateMultiViewCalibrationReview({ graph, reviewDecision } = {}) {
  const viewById = new Map(graph.view_nodes.map((view) => [view.id, view]));
  const correspondenceById = new Map(graph.correspondence_candidates.map((candidate) => [candidate.id, candidate]));
  const blockers = [];
  if (reviewDecision?.status !== 'accepted_for_evidence_fusion') {
    blockers.push('accepted_multi_view_calibration_review_required');
  }
  if (hasDuplicates(reviewDecision?.accepted_view_ids || [])) blockers.push('accepted_view_ids_must_be_unique');
  if (hasDuplicates(reviewDecision?.accepted_correspondence_ids || [])) blockers.push('accepted_correspondence_ids_must_be_unique');
  const acceptedViewIds = new Set(reviewDecision?.accepted_view_ids || []);
  for (const id of reviewDecision?.accepted_view_ids || []) {
    const view = viewById.get(id);
    if (!view) blockers.push(`unknown_view_id:${id}`);
    else if (view.calibration_status !== 'accepted_for_rectification') blockers.push(`view_calibration_not_accepted:${id}`);
  }
  if ((reviewDecision?.accepted_view_ids || []).length !== graph.view_nodes.length) {
    blockers.push('all_view_calibrations_must_be_accepted');
  }
  const acceptedCorrespondences = [];
  for (const id of reviewDecision?.accepted_correspondence_ids || []) {
    const correspondence = correspondenceById.get(id);
    if (!correspondence) blockers.push(`unknown_correspondence_id:${id}`);
    else {
      if (!acceptedViewIds.has(correspondence.source_view_id) || !acceptedViewIds.has(correspondence.target_view_id)) {
        blockers.push(`correspondence_requires_accepted_endpoint_views:${id}`);
      }
      acceptedCorrespondences.push(correspondence);
    }
  }
  if (acceptedCorrespondences.length < 2) blockers.push('at_least_two_accepted_correspondences_required');
  const accepted = blockers.length === 0;
  return {
    kind: 'multi_view_calibration_review_result_v1',
    version: 1,
    status: accepted
      ? 'accepted_for_evidence_fusion'
      : reviewDecision?.status === 'accepted_for_evidence_fusion'
        ? 'blocked_invalid_review'
        : 'blocked_no_accepted_review',
    accepted_view_ids: accepted ? [...reviewDecision.accepted_view_ids] : [],
    accepted_correspondence_ids: accepted ? [...reviewDecision.accepted_correspondence_ids] : [],
    shared_axis_frame: accepted ? {
      status: 'reviewed_axis_identity_only',
      axis_labels: ['x_red', 'y_green', 'z_blue'],
      metric_pose_status: 'unresolved_without_reviewed_point_or_plane_geometry'
    } : null,
    fused_evidence_hypotheses: accepted ? fuseCorrespondenceEvidence(acceptedCorrespondences) : [],
    evidence_fusion_allowed: accepted,
    geometry_fusion_allowed: false,
    promotion_allowed: false,
    compile_allowed: false,
    blockers: accepted
      ? ['reviewed_relative_pose_or_homography_required_for_geometry_fusion', 'accepted_partgraph_promotion_review_required']
      : blockers
  };
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function buildSharedAxisHypotheses(views) {
  const accepted = views.filter((view) => view.calibration_status === 'accepted_for_rectification');
  if (accepted.length < 2) return [];
  return ['x_red', 'y_green', 'z_blue'].map((axis) => ({
    id: `shared_${axis}_hypothesis`,
    axis,
    source_view_ids: accepted.filter((view) => view.accepted_axis_families.some((family) => family.axis === axis)).map((view) => view.id),
    status: 'hypothesis_requires_multi_view_review',
    review_required: true,
    promotion_allowed: false
  }));
}

function fuseCorrespondenceEvidence(correspondences) {
  return correspondences.map((correspondence) => ({
    id: `fused_${correspondence.id}`,
    kind: correspondence.kind,
    source_view_id: correspondence.source_view_id,
    target_view_id: correspondence.target_view_id,
    source_evidence_id: correspondence.source_evidence_id,
    target_evidence_id: correspondence.target_evidence_id,
    identity_status: 'accepted_same_physical_evidence_candidate',
    geometry_status: 'unresolved_without_relative_pose_or_homography',
    review_required: true,
    promotion_allowed: false
  }));
}
