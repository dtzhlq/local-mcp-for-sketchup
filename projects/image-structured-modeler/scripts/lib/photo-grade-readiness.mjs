import { validateGroundingV3 } from './grounding-v3.mjs';

export const PHOTO_GRADE_READINESS_VERDICTS = [
  'candidate',
  'technical_baseline',
  'review_required',
  'rejected'
];

const CANDIDATE_THRESHOLDS = {
  scale: {
    minAnchors: 3,
    minFamilies: 2,
    winnerResidual: 0.12,
    alternateResidual: 0.18
  },
  subdivision: {
    maxOverlapRatio: 0.02,
    maxGapRatio: 0.25
  },
  lineGrid: {
    maxParkingSpacingResidual: 0.12,
    maxParkingCountResidual: 1,
    maxDriveAisleResidual: 0.15,
    maxRoadAxisResidual: 0.04
  },
  topViewOverlay: {
    minMeanIou: 0.85,
    minIou: 0.65,
    maxCentroidError: 0.03,
    maxChamferError: 0.025
  },
  obliqueFacade: {
    maxPrimaryHeightTierResidual: 0.18,
    minVisibleFacadeItems: 3,
    minOpeningEdgeEvidence: 1
  }
};

export function validatePhotoGradeReadiness({
  observations = {},
  fixture = {},
  geometryFit = null,
  groundingV3 = null,
  codeDocument = null,
  sampleId = null,
  sampleKind = 'building_group',
  inputAssetStatus = 'available'
} = {}) {
  const groundingReport = normalizeGroundingReport(groundingV3)
    || validateGroundingV3({ observations, fixture, geometryFit, codeDocument });
  const graph = groundingReport.graph || groundingReport;
  const autoGroundPlan = graph.auto_ground_plan || observations.grounding_r10?.auto_ground_plan || null;
  const gates = [
    evaluateScaleGate(graph.scale_anchor_graph),
    evaluateSubdivisionGate(graph.ground_plan, autoGroundPlan),
    evaluateLineGridGate(graph.line_grid_fit),
    evaluateTopViewOverlayGate(graph.top_view_overlay),
    evaluateObliqueFacadeGate({ observations, geometryFit, codeDocument }),
    evaluatePromotionGate(graph.promotion_decisions, codeDocument)
  ];
  const blockers = [
    ...gates.flatMap((gate) => gate.blockers),
    ...inputAssetBlockers(inputAssetStatus)
  ];
  const hardFailures = gates.filter((gate) => gate.verdict === 'fail');
  const candidateReady = inputAssetStatus === 'available' && gates.every((gate) => gate.candidate_ready);
  const hasPromotedGeometry = (graph.summary?.promoted_geometry || 0) > 0
    || (graph.promotion_decisions || []).some((decision) => decision.decision === 'promoted_geometry');
  const groundingHasNoErrors = (groundingReport.summary?.by_severity?.error || 0) === 0
    && (groundingReport.summary?.total_issues || 0) === (groundingReport.summary?.by_severity?.warn || 0);
  const readiness = hardFailures.length
    ? 'rejected'
    : candidateReady
      ? 'candidate'
      : inputAssetStatus !== 'available'
        ? 'review_required'
        : groundingHasNoErrors && hasPromotedGeometry
          ? 'technical_baseline'
          : 'review_required';
  const bySeverity = countBy(blockers, 'severity');
  const summary = {
    photo_grade_readiness: readiness,
    photo_grade_candidate: readiness === 'candidate',
    sample_id: sampleId,
    sample_kind: sampleKind,
    input_asset_status: inputAssetStatus,
    gate_count: gates.length,
    candidate_ready_gates: gates.filter((gate) => gate.candidate_ready).length,
    review_required_gates: gates.filter((gate) => gate.verdict === 'review').length,
    failed_gates: hardFailures.length,
    blockers: blockers.length,
    by_severity: {
      error: bySeverity.error || 0,
      warn: bySeverity.warn || 0,
      info: bySeverity.info || 0
    },
    grounding_v3_verdict: groundingReport.verdict || 'unknown',
    grounding_v3_photo_grade_candidate: Boolean(groundingReport.summary?.photo_grade_candidate)
  };

  return {
    kind: 'photo_grade_readiness_qa',
    version: 1,
    ok: readiness !== 'rejected',
    verdict: readiness === 'candidate' ? 'pass' : readiness === 'rejected' ? 'fail' : 'review',
    photo_grade_readiness: readiness,
    photo_grade_candidate: readiness === 'candidate',
    thresholds: CANDIDATE_THRESHOLDS,
    sample: {
      id: sampleId,
      kind: sampleKind,
      input_asset_status: inputAssetStatus
    },
    gates,
    grounding_v3: {
      ok: groundingReport.ok,
      verdict: groundingReport.verdict,
      summary: groundingReport.summary,
      auto_ground_plan_r10: autoGroundPlan ? {
        verdict: autoGroundPlan.qa?.verdict,
        road_building_overlap_ratio: autoGroundPlan.qa?.road_building_overlap_ratio,
        raw_contour_leakage: autoGroundPlan.qa?.raw_contour_leakage,
        parent_child_double_occupancy: autoGroundPlan.qa?.parent_child_double_occupancy,
        canonical_region_overlap_ratio: autoGroundPlan.qa?.canonical_region_overlap_ratio,
        gap_ratio: autoGroundPlan.qa?.gap_ratio,
        gap_completion_ratio: autoGroundPlan.qa?.gap_completion_ratio,
        remaining_unknown_gap_ratio: autoGroundPlan.qa?.remaining_unknown_gap_ratio
      } : null
    },
    summary,
    blockers,
    correction_suggestions: correctionSuggestions(blockers, gates)
  };
}

function normalizeGroundingReport(value) {
  if (!value) return null;
  if (value.kind === 'grounding_v3_qa') return value;
  if (value.kind === 'grounding_graph_v3') {
    const bySeverity = countBy(value.issues || [], 'severity');
    return {
      kind: 'grounding_v3_qa',
      version: 3,
      ok: (bySeverity.error || 0) === 0,
      verdict: (bySeverity.error || 0) > 0 ? 'fail' : (bySeverity.warn || 0) > 0 ? 'review' : 'pass',
      graph: value,
      summary: value.summary,
      issues: value.issues || [],
      correction_suggestions: value.correction_suggestions || []
    };
  }
  if (value.graph?.kind === 'grounding_graph_v3') return value;
  return null;
}

function evaluateScaleGate(scaleAnchorGraph = {}) {
  const candidates = scaleAnchorGraph.candidates || [];
  const nonSite = candidates.filter((candidate) => candidate.family !== 'site');
  const families = unique(nonSite.map((candidate) => candidate.family));
  const winnerResidual = Number(scaleAnchorGraph.winner?.residual ?? 1);
  const alternateResidual = max((scaleAnchorGraph.alternates || [])
    .filter((candidate) => candidate.family !== 'site')
    .map((candidate) => Number(candidate.residual ?? 0)));
  const independentNonParking = nonSite.some((candidate) => (
    candidate.family !== 'parking'
    && candidate.in_consensus !== false
    && Number(candidate.residual ?? 1) <= CANDIDATE_THRESHOLDS.scale.alternateResidual
  ));
  const blockers = [
    ...(candidates.length < CANDIDATE_THRESHOLDS.scale.minAnchors ? [blocker('scale', 'scale_anchor_count_below_candidate_threshold', 'warn', { checked: candidates.length })] : []),
    ...(families.length < CANDIDATE_THRESHOLDS.scale.minFamilies ? [blocker('scale', 'scale_anchor_family_count_below_candidate_threshold', 'warn', { families })] : []),
    ...(!independentNonParking ? [blocker('scale', 'scale_anchor_lacks_independent_non_parking_consensus', 'warn', { families })] : []),
    ...(winnerResidual > CANDIDATE_THRESHOLDS.scale.winnerResidual ? [blocker('scale', 'scale_anchor_winner_residual_above_candidate_threshold', 'warn', { winner_residual: winnerResidual })] : []),
    ...(alternateResidual > CANDIDATE_THRESHOLDS.scale.alternateResidual ? [blocker('scale', 'scale_anchor_alternate_residual_above_candidate_threshold', 'warn', { alternate_residual: alternateResidual })] : []),
    ...(scaleAnchorGraph.gate?.review_required ? [blocker('scale', 'scale_anchor_review_required', 'warn', { reasons: scaleAnchorGraph.gate.reasons || [] })] : [])
  ];
  return gate({
    id: 'scale',
    candidateReady: blockers.length === 0,
    blockers,
    metrics: {
      checked_scale_anchors: candidates.length,
      distinct_non_site_families: families.length,
      winner_anchor_type: scaleAnchorGraph.winner?.anchor_type || null,
      winner_residual: round(winnerResidual),
      alternate_residual: round(alternateResidual),
      independent_non_parking_consensus: independentNonParking,
      scale_anchor_review_required: Boolean(scaleAnchorGraph.gate?.review_required)
    }
  });
}

function evaluateSubdivisionGate(groundPlan = {}, autoGroundPlan = null) {
  if (autoGroundPlan?.qa) return evaluateR10SubdivisionGate(autoGroundPlan);
  const qa = groundPlan.qa || {};
  const nonGapRegions = (groundPlan.regions || []).filter((region) => region.class !== 'gap');
  const missingEvidence = nonGapRegions.filter((region) => !region.source_observation_ids?.length);
  const blockers = [
    ...(Number(qa.overlap_ratio ?? 1) > CANDIDATE_THRESHOLDS.subdivision.maxOverlapRatio ? [blocker('subdivision', 'ground_plan_overlap_above_candidate_threshold', 'warn', { overlap_ratio: qa.overlap_ratio })] : []),
    ...(Number(qa.gap_ratio ?? 1) > CANDIDATE_THRESHOLDS.subdivision.maxGapRatio ? [blocker('subdivision', 'ground_plan_gap_above_candidate_threshold', 'warn', { gap_ratio: qa.gap_ratio })] : []),
    ...(missingEvidence.length ? [blocker('subdivision', 'ground_plan_region_missing_source_evidence', 'error', { regions: missingEvidence.map((region) => region.id) })] : [])
  ];
  return gate({
    id: 'subdivision',
    candidateReady: blockers.length === 0,
    blockers,
    metrics: {
      checked_ground_regions: qa.checked_regions || 0,
      coverage_ratio: qa.coverage_ratio || 0,
      overlap_ratio: qa.overlap_ratio || 0,
      gap_ratio: qa.gap_ratio || 0,
      missing_evidence_regions: missingEvidence.length
    }
  });
}

function evaluateR10SubdivisionGate(autoGroundPlan = {}) {
  const qa = autoGroundPlan.qa || {};
  const blockers = [
    ...(Number(qa.road_building_overlap_ratio ?? 1) > 0 ? [blocker('subdivision', 'r10_road_building_overlap', 'error', { road_building_overlap_ratio: qa.road_building_overlap_ratio })] : []),
    ...((qa.raw_contour_leakage || 0) > 0 ? [blocker('subdivision', 'r10_raw_contour_leakage', 'error', { raw_contour_leakage: qa.raw_contour_leakage })] : []),
    ...((qa.parent_child_double_occupancy || 0) > 0 ? [blocker('subdivision', 'r10_parent_child_double_occupancy', 'error', { parent_child_double_occupancy: qa.parent_child_double_occupancy })] : []),
    ...(Number(qa.canonical_region_overlap_ratio ?? 1) > CANDIDATE_THRESHOLDS.subdivision.maxOverlapRatio ? [blocker('subdivision', 'r10_canonical_region_overlap_above_candidate_threshold', 'warn', { canonical_region_overlap_ratio: qa.canonical_region_overlap_ratio })] : []),
    ...(Number(qa.gap_ratio ?? 1) > CANDIDATE_THRESHOLDS.subdivision.maxGapRatio ? [blocker('subdivision', 'r10_gap_above_candidate_threshold', 'warn', { gap_ratio: qa.gap_ratio })] : []),
    ...(Number(qa.remaining_unknown_gap_ratio ?? qa.gap_ratio ?? 1) > CANDIDATE_THRESHOLDS.subdivision.maxGapRatio ? [blocker('subdivision', 'r10_remaining_unknown_gap_above_candidate_threshold', 'warn', { remaining_unknown_gap_ratio: qa.remaining_unknown_gap_ratio })] : []),
    ...(Number(qa.gap_derived_road_overlap_ratio || 0) > 0 ? [blocker('subdivision', 'r10_gap_derived_road_overlap', 'error', { gap_derived_road_overlap_ratio: qa.gap_derived_road_overlap_ratio })] : []),
    ...((qa.gap_derived_region_without_connectivity || 0) > 0 ? [blocker('subdivision', 'r10_gap_derived_region_without_connectivity', 'error', { gap_derived_region_without_connectivity: qa.gap_derived_region_without_connectivity })] : []),
    ...((qa.road_candidate_review_count || 0) > 0 ? [blocker('subdivision', 'r10_gap_road_candidates_require_review', 'warn', { road_candidate_review_count: qa.road_candidate_review_count })] : []),
    ...((qa.region_without_evidence || 0) > 0 ? [blocker('subdivision', 'r10_region_without_evidence', 'error', { region_without_evidence: qa.region_without_evidence })] : []),
    ...((qa.layout_prior_conflict_count || 0) > 0 ? [blocker('subdivision', 'r10_layout_prior_conflicts_rejected', 'warn', { layout_prior_conflict_count: qa.layout_prior_conflict_count })] : [])
  ];
  return gate({
    id: 'subdivision',
    candidateReady: blockers.length === 0,
    blockers,
    metrics: {
      source: 'auto_ground_plan_r10',
      checked_ground_regions: qa.checked_canonical_regions || 0,
      checked_subdivision_cells: qa.checked_subdivision_cells || 0,
      coverage_ratio: round(1 - Number(qa.gap_ratio ?? 1)),
      overlap_ratio: qa.canonical_region_overlap_ratio || 0,
      gap_ratio: qa.gap_ratio || 0,
      gap_completion_ratio: qa.gap_completion_ratio || 0,
      remaining_unknown_gap_ratio: qa.remaining_unknown_gap_ratio ?? qa.gap_ratio ?? 1,
      open_paved_area_ratio: qa.open_paved_area_ratio || 0,
      road_candidate_review_count: qa.road_candidate_review_count || 0,
      gap_derived_road_overlap_ratio: qa.gap_derived_road_overlap_ratio || 0,
      gap_derived_region_without_connectivity: qa.gap_derived_region_without_connectivity || 0,
      road_building_overlap_ratio: qa.road_building_overlap_ratio || 0,
      raw_contour_leakage: qa.raw_contour_leakage || 0,
      parent_child_double_occupancy: qa.parent_child_double_occupancy || 0,
      layout_prior_conflict_count: qa.layout_prior_conflict_count || 0,
      region_without_evidence: qa.region_without_evidence || 0
    }
  });
}

function evaluateLineGridGate(lineGridFit = {}) {
  const qa = lineGridFit.qa || {};
  const parkingFit = lineGridFit.parking_grid_fits?.[0] || {};
  const residuals = parkingFit.residuals || {};
  const lineFits = parkingFit.line_fits || [];
  const bboxOnlyLines = lineFits.filter((line) => !/^pixel_(line|gap)_segmentation$/.test(line.grounding_method || ''));
  const blockers = [
    ...((qa.checked_parking_lines || 0) < 2 ? [blocker('line_grid', 'parking_line_fit_count_below_candidate_threshold', 'warn', { checked: qa.checked_parking_lines || 0 })] : []),
    ...(Number(residuals.row_spacing_residual ?? 0) > CANDIDATE_THRESHOLDS.lineGrid.maxParkingSpacingResidual ? [blocker('line_grid', 'parking_spacing_residual_above_candidate_threshold', 'warn', { row_spacing_residual: residuals.row_spacing_residual })] : []),
    ...(Number(residuals.parking_grid_count_residual ?? qa.parking_grid_count_residual ?? 0) > CANDIDATE_THRESHOLDS.lineGrid.maxParkingCountResidual ? [blocker('line_grid', 'parking_grid_count_residual_above_candidate_threshold', 'warn', { parking_grid_count_residual: residuals.parking_grid_count_residual ?? qa.parking_grid_count_residual })] : []),
    ...(Number(residuals.drive_aisle_gap_residual ?? qa.max_drive_aisle_gap_residual ?? 1) > CANDIDATE_THRESHOLDS.lineGrid.maxDriveAisleResidual ? [blocker('line_grid', 'drive_aisle_gap_residual_above_candidate_threshold', 'warn', { drive_aisle_gap_residual: residuals.drive_aisle_gap_residual ?? qa.max_drive_aisle_gap_residual })] : []),
    ...(Number(qa.max_line_axis_residual ?? 1) > CANDIDATE_THRESHOLDS.lineGrid.maxRoadAxisResidual ? [blocker('line_grid', 'road_or_line_axis_residual_above_candidate_threshold', 'warn', { max_line_axis_residual: qa.max_line_axis_residual })] : []),
    ...(bboxOnlyLines.length ? [blocker('line_grid', 'bbox_only_parking_line_evidence', 'error', { lines: bboxOnlyLines.map((line) => line.id) })] : [])
  ];
  return gate({
    id: 'line_grid',
    candidateReady: blockers.length === 0,
    blockers,
    metrics: {
      checked_parking_lines: qa.checked_parking_lines || 0,
      checked_road_axes: qa.checked_road_axes || 0,
      row_spacing_residual: round(residuals.row_spacing_residual || 0),
      parking_grid_count_residual: round(residuals.parking_grid_count_residual ?? qa.parking_grid_count_residual ?? 0),
      drive_aisle_gap_residual: round(residuals.drive_aisle_gap_residual ?? qa.max_drive_aisle_gap_residual ?? 1),
      max_line_axis_residual: round(qa.max_line_axis_residual ?? 1),
      bbox_only_parking_lines: bboxOnlyLines.length
    }
  });
}

function evaluateTopViewOverlayGate(topViewOverlay = {}) {
  const qa = topViewOverlay.qa || {};
  const blockers = [
    ...(Number(qa.mean_mask_iou ?? 0) < CANDIDATE_THRESHOLDS.topViewOverlay.minMeanIou ? [blocker('top_view_overlay', 'mean_iou_below_candidate_threshold', 'warn', { mean_mask_iou: qa.mean_mask_iou })] : []),
    ...(Number(qa.min_mask_iou ?? 0) < CANDIDATE_THRESHOLDS.topViewOverlay.minIou ? [blocker('top_view_overlay', 'min_iou_below_candidate_threshold', 'warn', { min_mask_iou: qa.min_mask_iou })] : []),
    ...(Number(qa.max_centroid_error_norm ?? 1) > CANDIDATE_THRESHOLDS.topViewOverlay.maxCentroidError ? [blocker('top_view_overlay', 'centroid_delta_above_candidate_threshold', 'warn', { max_centroid_error_norm: qa.max_centroid_error_norm })] : []),
    ...(Number(qa.max_line_chamfer_error_norm ?? 1) > CANDIDATE_THRESHOLDS.topViewOverlay.maxChamferError ? [blocker('top_view_overlay', 'line_chamfer_above_candidate_threshold', 'warn', { max_line_chamfer_error_norm: qa.max_line_chamfer_error_norm })] : [])
  ];
  return gate({
    id: 'top_view_overlay',
    candidateReady: blockers.length === 0,
    blockers,
    metrics: {
      checked_regions: qa.checked_regions || 0,
      checked_lines: qa.checked_lines || 0,
      mean_mask_iou: qa.mean_mask_iou || 0,
      min_mask_iou: qa.min_mask_iou || 0,
      max_centroid_error_norm: qa.max_centroid_error_norm || 0,
      max_line_chamfer_error_norm: qa.max_line_chamfer_error_norm || 0
    }
  });
}

function evaluateObliqueFacadeGate({ observations = {}, geometryFit = null, codeDocument = null } = {}) {
  const obliqueImages = (observations.images || []).filter((image) => image.detected_view?.kind === 'oblique');
  const obliqueObservations = obliqueImages.flatMap((image) => image.observations || []);
  const visibleFacadeItems = unique(obliqueObservations
    .map((observation) => observation.component_hint)
    .filter((hint) => hint && hint !== 'site_boundary'));
  const primaryTop = findObservationByHint(observations, 'top', 'primary_blue_roof_hall');
  const primaryOblique = findObservationByHint(observations, 'oblique', 'primary_blue_roof_hall');
  const heightTierResidual = estimateHeightTierResidual(primaryTop, primaryOblique, obliqueImages);
  const roofRidgeEvidence = obliqueImages.some((image) => (image.camera_hints?.vanishing_lines || []).length > 0)
    || obliqueObservations.some((observation) => observation.facade_hints?.roof_ridge_direction);
  const openingEdgeEvidence = countOpeningEdgeEvidence(observations, codeDocument);
  const blockers = [
    ...(obliqueImages.length === 0 ? [blocker('oblique_facade', 'missing_oblique_view', 'warn', {})] : []),
    ...(visibleFacadeItems.length < CANDIDATE_THRESHOLDS.obliqueFacade.minVisibleFacadeItems ? [blocker('oblique_facade', 'visible_facade_item_count_below_candidate_threshold', 'warn', { visible_facade_items: visibleFacadeItems.length })] : []),
    ...(heightTierResidual > CANDIDATE_THRESHOLDS.obliqueFacade.maxPrimaryHeightTierResidual ? [blocker('oblique_facade', 'primary_height_tier_residual_above_candidate_threshold', 'warn', { primary_height_tier_residual: heightTierResidual })] : []),
    ...(!roofRidgeEvidence ? [blocker('oblique_facade', 'missing_roof_ridge_or_vanishing_line_evidence', 'warn', {})] : []),
    ...(openingEdgeEvidence < CANDIDATE_THRESHOLDS.obliqueFacade.minOpeningEdgeEvidence ? [blocker('oblique_facade', 'facade_openings_lack_per_instance_edge_evidence', 'warn', { opening_edge_evidence: openingEdgeEvidence })] : [])
  ];
  return gate({
    id: 'oblique_facade',
    candidateReady: blockers.length === 0,
    blockers,
    metrics: {
      oblique_images: obliqueImages.length,
      visible_facade_items: visibleFacadeItems.length,
      primary_height_tier_residual: heightTierResidual,
      roof_ridge_evidence: roofRidgeEvidence,
      opening_edge_evidence: openingEdgeEvidence,
      geometry_fit_multi_view_items: geometryFit?.camera_calibration?.multi_view_consistency?.checked_items || 0
    }
  });
}

function evaluatePromotionGate(promotionDecisions = [], codeDocument = null) {
  const counts = countBy(promotionDecisions, 'decision');
  const denseBlocking = (codeDocument?.operations || []).filter((operation) => {
    const role = operation.qa?.role || operation.role || '';
    if (!/opening|vent|hvac|roof_|parked_vehicle|tree|facade/i.test(role)) return false;
    return operation.qa?.photo_grade_eligible !== true || !operation.qa?.source_observation_ids?.length;
  });
  const blockers = [
    ...((counts.promoted_geometry || 0) === 0 ? [blocker('promotion', 'no_promoted_geometry_candidates', 'error', {})] : []),
    ...((counts.review_candidate || 0) > 0 ? [blocker('promotion', 'review_candidates_still_present', 'warn', { review_candidate: counts.review_candidate })] : []),
    ...((counts.helper_only || 0) > 0 ? [blocker('promotion', 'helper_only_candidates_still_present', 'warn', { helper_only: counts.helper_only })] : []),
    ...((counts.rejected || 0) > 0 ? [blocker('promotion', 'rejected_candidates_present', 'error', { rejected: counts.rejected })] : []),
    ...(denseBlocking.length ? [blocker('promotion', 'dense_detail_lacks_per_instance_photo_grade_evidence', 'warn', { dense_detail_count: denseBlocking.length })] : [])
  ];
  return gate({
    id: 'promotion',
    candidateReady: blockers.length === 0,
    blockers,
    metrics: {
      promoted_geometry: counts.promoted_geometry || 0,
      review_candidate: counts.review_candidate || 0,
      helper_only: counts.helper_only || 0,
      rejected: counts.rejected || 0,
      dense_detail_without_photo_grade_evidence: denseBlocking.length
    }
  });
}

function estimateHeightTierResidual(topObservation, obliqueObservation, obliqueImages) {
  if (!topObservation || !obliqueObservation) return 1;
  if (obliqueObservation.facade_hints?.height_tier_residual !== undefined) {
    return round(obliqueObservation.facade_hints.height_tier_residual);
  }
  const topHeight = Math.max(1, topObservation.bbox?.[3] || 1);
  const obliqueHeight = Math.max(1, obliqueObservation.bbox?.[3] || 1);
  const ratioResidual = Math.abs((obliqueHeight / topHeight) - 1);
  const reviewPenalty = obliqueImages.some((image) => image.camera_hints?.review_required) ? 0.08 : 0;
  return round(Math.min(1, ratioResidual * 0.25 + 0.14 + reviewPenalty));
}

function countOpeningEdgeEvidence(observations = {}, codeDocument = null) {
  const observationEvidence = (observations.images || []).flatMap((image) => image.observations || [])
    .filter((observation) => /opening|window|door|loading|bay|facade/i.test(observation.component_hint || observation.id || ''))
    .filter((observation) => /edge|keypoint|mask|contour/i.test(`${observation.grounding?.method || ''} ${observation.kind || ''}`));
  const operationEvidence = (codeDocument?.operations || [])
    .filter((operation) => /opening|window|door|loading|bay|facade/i.test(operation.qa?.role || operation.id || ''))
    .filter((operation) => operation.qa?.photo_grade_eligible === true && operation.qa?.source_observation_ids?.length);
  return observationEvidence.length + operationEvidence.length;
}

function inputAssetBlockers(status) {
  if (status === 'available') return [];
  return [blocker('input_asset', 'real_building_photo_asset_not_available', 'warn', { input_asset_status: status })];
}

function gate({ id, candidateReady, blockers = [], metrics = {} }) {
  const hasErrors = blockers.some((item) => item.severity === 'error');
  return {
    id,
    candidate_ready: Boolean(candidateReady),
    verdict: candidateReady ? 'pass' : hasErrors ? 'fail' : 'review',
    metrics,
    blockers
  };
}

function blocker(gateId, reason, severity, evidence) {
  return {
    gate: gateId,
    reason,
    severity,
    message: reason.replace(/_/g, ' '),
    evidence
  };
}

function correctionSuggestions(blockers, gates) {
  return blockers.map((item) => ({
    action: correctionActionForGate(item.gate),
    target: item.gate,
    reason: item.reason,
    evidence: item.evidence
  })).concat(gates
    .filter((gateItem) => !gateItem.candidate_ready && gateItem.blockers.length === 0)
    .map((gateItem) => ({
      action: 'inspect_photo_grade_gate',
      target: gateItem.id,
      reason: `${gateItem.id} is not candidate-ready.`,
      evidence: gateItem.metrics
    })));
}

function correctionActionForGate(gateId) {
  return {
    scale: 'add_or_confirm_independent_scale_anchor',
    subdivision: 'refine_ground_plan_region_masks',
    line_grid: 'review_parking_or_road_line_fit',
    top_view_overlay: 'adjust_grounding_graph_or_part_graph_projection',
    oblique_facade: 'add_oblique_facade_edge_or_height_evidence',
    promotion: 'downgrade_candidate_or_add_per_instance_evidence',
    input_asset: 'provide_real_building_photo_assets'
  }[gateId] || 'review_photo_grade_readiness_blocker';
}

function findObservationByHint(observations, viewKind, componentHint) {
  const image = (observations.images || []).find((item) => item.detected_view?.kind === viewKind);
  return (image?.observations || []).find((observation) => observation.component_hint === componentHint) || null;
}

function countBy(items = [], key) {
  const result = {};
  for (const item of items || []) {
    const value = item?.[key] ?? 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function max(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : 0;
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}
