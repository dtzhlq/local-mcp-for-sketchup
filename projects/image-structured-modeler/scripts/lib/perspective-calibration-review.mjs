export const PERSPECTIVE_CALIBRATION_REVIEW_DECISION_KIND = 'perspective_calibration_review_decision_v1';
export const PERSPECTIVE_CALIBRATION_REVIEW_RESULT_KIND = 'perspective_calibration_review_result_v1';

export function buildPendingPerspectiveCalibrationReview({ perspectiveCalibration } = {}) {
  return {
    kind: PERSPECTIVE_CALIBRATION_REVIEW_DECISION_KIND,
    version: 1,
    source_perspective_calibration_hypotheses: 'perspective-calibration-hypotheses.json',
    reviewer: 'calibration-review-template',
    status: 'not_accepted',
    accepted_camera_model_candidate_id: null,
    family_decisions: (perspectiveCalibration?.direction_families || []).map((family) => ({
      direction_family_id: family.id,
      decision: 'axis_unknown',
      assigned_axis: null,
      reviewer_confidence: 0,
      reason: 'pending_calibration_review'
    })),
    fixture_only: false,
    promotion_allowed: false,
    compile_allowed: false,
    notes: [
      'Accept a camera model and map two horizontal direction families plus the vertical family before rectification.',
      'Red/green labels are coordinate-frame choices; the underlying detected families remain neutral.'
    ]
  };
}

export function buildAcceptedPerspectiveCalibrationReviewFixture({ perspectiveCalibration } = {}) {
  const horizontal = (perspectiveCalibration?.direction_families || []).filter((family) => family.role === 'horizontal_candidate');
  const vertical = (perspectiveCalibration?.direction_families || []).find((family) => family.role === 'vertical_candidate');
  const assignments = new Map([
    [horizontal[0]?.id, 'x_red'],
    [horizontal[1]?.id, 'y_green'],
    [vertical?.id, 'z_blue']
  ]);
  return {
    kind: PERSPECTIVE_CALIBRATION_REVIEW_DECISION_KIND,
    version: 1,
    source_perspective_calibration_hypotheses: 'perspective-calibration-hypotheses.json',
    reviewer: 'calibration-benchmark-positive-fixture',
    status: 'accepted_for_rectification',
    accepted_camera_model_candidate_id: perspectiveCalibration?.camera_model_candidates?.[0]?.id || null,
    family_decisions: (perspectiveCalibration?.direction_families || []).map((family) => {
      const assignedAxis = assignments.get(family.id) || null;
      return {
        direction_family_id: family.id,
        decision: assignedAxis ? 'assign_axis' : 'reject',
        assigned_axis: assignedAxis,
        reviewer_confidence: assignedAxis ? 0.9 : 0.5,
        reason: assignedAxis
          ? 'fixture_maps_reviewed_direction_family_to_coordinate_axis'
          : 'not_required_by_positive_fixture'
      };
    }),
    fixture_only: true,
    promotion_allowed: false,
    compile_allowed: false,
    notes: [
      'Fixture-only accepted calibration for testing rectification and topology gates.',
      'This is not the default path and cannot promote PartGraph or SketchUp geometry.'
    ]
  };
}

export function evaluatePerspectiveCalibrationReview({
  perspectiveCalibration,
  reviewDecision,
  sourceReviewDecision = 'perspective-calibration-review.json'
} = {}) {
  const familyById = new Map((perspectiveCalibration?.direction_families || []).map((family) => [family.id, family]));
  const modelById = new Map((perspectiveCalibration?.camera_model_candidates || []).map((model) => [model.id, model]));
  const blockers = [];
  const acceptedFamilies = [];
  const usedAxes = new Set();
  if (perspectiveCalibration?.qa?.sufficient_for_review !== true) {
    blockers.push('perspective_calibration_hypotheses_not_sufficient_for_review');
  }
  if (reviewDecision?.status !== 'accepted_for_rectification') {
    blockers.push('accepted_perspective_calibration_review_required');
  }
  const acceptedModel = modelById.get(reviewDecision?.accepted_camera_model_candidate_id) || null;
  if (!acceptedModel) blockers.push('accepted_camera_model_candidate_missing_or_unknown');
  for (const decision of reviewDecision?.family_decisions || []) {
    if (decision.decision !== 'assign_axis') continue;
    const family = familyById.get(decision.direction_family_id);
    if (!family) {
      blockers.push(`unknown_direction_family_id:${decision.direction_family_id}`);
      continue;
    }
    if (!decision.assigned_axis) {
      blockers.push(`assigned_axis_missing:${decision.direction_family_id}`);
      continue;
    }
    if (usedAxes.has(decision.assigned_axis)) {
      blockers.push(`duplicate_axis_assignment:${decision.assigned_axis}`);
      continue;
    }
    usedAxes.add(decision.assigned_axis);
    acceptedFamilies.push({
      direction_family_id: family.id,
      axis: decision.assigned_axis,
      vanishing_type: family.vanishing_type,
      vanishing_point_px: family.vanishing_point_px,
      image_direction_px: family.image_direction_px,
      support_segment_ids: family.support_segment_ids
    });
  }
  for (const axis of ['x_red', 'y_green', 'z_blue']) {
    if (!usedAxes.has(axis)) blockers.push(`accepted_${axis}_direction_family_required`);
  }
  const acceptedHorizontalIds = new Set(acceptedFamilies
    .filter((family) => family.axis === 'x_red' || family.axis === 'y_green')
    .map((family) => family.direction_family_id));
  if (acceptedModel && acceptedModel.horizontal_family_ids.some((id) => !acceptedHorizontalIds.has(id))) {
    blockers.push('accepted_camera_model_horizontal_families_do_not_match_review');
  }
  const accepted = blockers.length === 0;
  const status = accepted
    ? 'accepted_for_rectification'
    : reviewDecision?.status === 'accepted_for_rectification'
      ? 'blocked_invalid_review'
      : 'blocked_no_accepted_review';
  const horizon = accepted ? horizonFromAcceptedFamilies(acceptedFamilies, perspectiveCalibration.source_image) : null;
  return {
    kind: PERSPECTIVE_CALIBRATION_REVIEW_RESULT_KIND,
    version: 1,
    source_perspective_calibration_hypotheses: reviewDecision?.source_perspective_calibration_hypotheses || 'perspective-calibration-hypotheses.json',
    source_review_decision: sourceReviewDecision,
    status,
    accepted_camera_model: acceptedModel?.model || null,
    accepted_axis_families: accepted ? acceptedFamilies : [],
    horizon_line_px: horizon,
    rectification_allowed: accepted,
    topology_inference_allowed: accepted,
    draft_view_derivation_allowed: false,
    promotion_allowed: false,
    compile_allowed: false,
    blockers: accepted
      ? ['accepted_plane_topology_review_required', 'accepted_partgraph_promotion_review_required']
      : blockers
  };
}

function horizonFromAcceptedFamilies(families, imageSize) {
  const horizontal = families.filter((family) => family.axis === 'x_red' || family.axis === 'y_green');
  if (horizontal.length < 2) return null;
  const first = horizontal[0];
  const second = horizontal[1];
  if (first.vanishing_type === 'finite' && second.vanishing_type === 'finite') {
    return lineAcrossImage(first.vanishing_point_px, second.vanishing_point_px, imageSize.width);
  }
  if (first.vanishing_type === 'finite' && second.image_direction_px) {
    return lineAcrossImage(first.vanishing_point_px, [
      first.vanishing_point_px[0] + second.image_direction_px[0],
      first.vanishing_point_px[1] + second.image_direction_px[1]
    ], imageSize.width);
  }
  if (second.vanishing_type === 'finite' && first.image_direction_px) {
    return lineAcrossImage(second.vanishing_point_px, [
      second.vanishing_point_px[0] + first.image_direction_px[0],
      second.vanishing_point_px[1] + first.image_direction_px[1]
    ], imageSize.width);
  }
  return null;
}

function lineAcrossImage(first, second, width) {
  const dx = second[0] - first[0];
  if (Math.abs(dx) < 1e-9) return null;
  const slope = (second[1] - first[1]) / dx;
  return {
    a: [0, round(first[1] + (0 - first[0]) * slope)],
    b: [width, round(first[1] + (width - first[0]) * slope)]
  };
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}
