export const GROUNDING_V3_REGION_CLASSES = [
  'building_footprint',
  'road',
  'parking',
  'green',
  'walkway',
  'service_yard',
  'gap'
];

export const GROUNDING_V3_PROMOTION_DECISIONS = [
  'promoted_geometry',
  'review_candidate',
  'helper_only',
  'rejected'
];

const BUILDING_HINTS = new Set([
  'primary_blue_roof_hall',
  'warehouse_west_north',
  'warehouse_west_south',
  'warehouse_inner_north',
  'warehouse_inner_south',
  'utility_building',
  'admin_office'
]);

const COARSE_BUILDING_HINTS = new Set([
  'warehouse_row_west',
  'warehouse_row_inner'
]);

const SCALE_ANCHOR_PRIORS = {
  parking_bay_width_span: {
    family: 'parking',
    world_dimension_mm: 2600,
    measured_axis: 'x',
    expected_count_from_basis: true
  },
  parking_bay_single: {
    family: 'parking',
    world_dimension_mm: 2600,
    measured_axis: 'x'
  },
  parking_drive_aisle_width: {
    family: 'road',
    world_dimension_mm: 6500,
    measured_axis: 'y'
  },
  road_lane_width: {
    family: 'road',
    world_dimension_mm: 3500,
    measured_axis: 'y'
  },
  crosswalk_width: {
    family: 'walkway',
    world_dimension_mm: 3000,
    measured_axis: 'y'
  },
  service_gate_width: {
    family: 'service_yard',
    world_dimension_mm: 6000,
    measured_axis: 'x'
  },
  building_footprint_prior: {
    family: 'building_footprint',
    world_dimension_mm: 30000,
    measured_axis: 'x'
  },
  site_boundary_from_known_anchors: {
    family: 'site',
    world_dimension_mm: null,
    measured_axis: 'x'
  }
};

export function annotateObservationSetWithGroundingV3(observationSet = {}, options = {}) {
  if (!isBuildingGroupObservationSet(observationSet)) return observationSet;
  const grounding = buildGroundingV3Graph({ observations: observationSet, ...options });
  observationSet.grounding_v3 = grounding;
  observationSet.evidence_graph = {
    ...(observationSet.evidence_graph || {}),
    ground_plan: grounding.ground_plan
  };
  return observationSet;
}

export function buildGroundingV3Graph({ observations = {}, fixture = {}, geometryFit = null, codeDocument = null } = {}) {
  const topImage = findTopImage(observations);
  const siteObservation = findBestObservation(topImage, 'site_boundary');
  const siteBbox = siteObservation?.bbox || topImage?.metrics?.object_bbox || null;
  const scaleAnchorGraph = buildScaleAnchorGraph(observations);
  const groundPlan = buildGroundPlan({ observations, topImage, siteObservation, siteBbox });
  const lineGridFit = buildLineGridFit({ observations, topImage, scaleAnchorGraph });
  const topViewOverlay = buildTopViewOverlay({ observations, geometryFit, groundPlan, lineGridFit });
  const promotionDecisions = buildPromotionDecisions({
    observations,
    groundPlan,
    lineGridFit,
    topViewOverlay,
    codeDocument
  });
  const gates = evaluateGroundingV3Gates({
    scaleAnchorGraph,
    groundPlan,
    lineGridFit,
    topViewOverlay,
    promotionDecisions,
    fixture
  });
  const issues = gates.flatMap((gate) => gate.issues || []);
  const summary = summarizeGroundingV3({
    scaleAnchorGraph,
    groundPlan,
    lineGridFit,
    topViewOverlay,
    promotionDecisions,
    issues
  });

  return {
    kind: 'grounding_graph_v3',
    version: 3,
    coordinate_convention: 'image_x_right_y_down_to_model_xy_y_up',
    scale_anchor_graph: scaleAnchorGraph,
    ground_plan: groundPlan,
    line_grid_fit: lineGridFit,
    top_view_overlay: topViewOverlay,
    promotion_decisions: promotionDecisions,
    gates,
    summary,
    issues,
    correction_suggestions: groundingV3CorrectionSuggestions(issues, promotionDecisions)
  };
}

export function validateGroundingV3({ observations = {}, fixture = {}, geometryFit = null, codeDocument = null } = {}) {
  const graph = buildGroundingV3Graph({ observations, fixture, geometryFit, codeDocument });
  const bySeverity = countBy(graph.issues, 'severity');
  return {
    kind: 'grounding_v3_qa',
    version: 3,
    ok: (bySeverity.error || 0) === 0,
    verdict: (bySeverity.error || 0) > 0 ? 'fail' : (bySeverity.warn || 0) > 0 ? 'review' : 'pass',
    graph,
    summary: graph.summary,
    issues: graph.issues,
    correction_suggestions: graph.correction_suggestions
  };
}

export function groundingV3DecisionForPart(groundingV3, part = {}) {
  const decision = (groundingV3?.promotion_decisions || []).find((item) => item.part_id === part.id || item.region_id === part.id);
  if (decision) return decision;
  const role = part.role || part.type || '';
  if (role === 'scale_anchor') {
    return promotionDecision({
      part_id: part.id,
      region_id: part.id,
      region_class: 'gap',
      decision: 'helper_only',
      confidence: 0.4,
      reasons: ['scale anchors are visual review helpers, not site geometry']
    });
  }
  if (/roof_|parked_vehicle|tree|vent|hvac|texture|detail/i.test(role)) {
    return promotionDecision({
      part_id: part.id,
      region_id: part.id,
      region_class: 'gap',
      decision: 'helper_only',
      confidence: 0.32,
      reasons: ['dense detail lacks Grounding v3 region or line-fit support']
    });
  }
  return promotionDecision({
    part_id: part.id,
    region_id: part.id,
    region_class: 'gap',
    decision: 'review_candidate',
    confidence: 0.35,
    reasons: ['no matching GroundPlan region was found']
  });
}

export function applyGroundingV3DecisionsToParts(parts = [], groundingV3 = null) {
  if (!groundingV3) return parts;
  return parts.map((part) => {
    const decision = groundingV3DecisionForPart(groundingV3, part);
    return {
      ...part,
      grounding_decision: decision.decision,
      grounding_region_id: decision.region_id,
      qa: {
        ...(part.qa || {}),
        grounding_v3_decision: decision.decision,
        grounding_region_id: decision.region_id,
        grounding_region_class: decision.region_class,
        grounding_v3_reasons: decision.reasons,
        top_view_overlay_residual: decision.overlay_residual || null,
        promotion_confidence: decision.confidence
      }
    };
  });
}

function buildScaleAnchorGraph(observations) {
  const measurements = observations.scale_calibration?.measurements
    || observations.evidence_graph?.scale_calibration?.measurements
    || [];
  const rawCandidates = measurements
    .filter((measurement) => measurement.anchor_type)
    .map((measurement) => scaleAnchorCandidate(measurement))
    .filter(Boolean);
  const nonSiteCandidates = rawCandidates.filter((candidate) => candidate.anchor_type !== 'site_boundary_from_known_anchors');
  const candidatePool = nonSiteCandidates.length ? nonSiteCandidates : rawCandidates;
  const families = unique(candidatePool.map((candidate) => candidate.family));
  const weightedScale = weightedAverage(candidatePool.map((candidate) => ({
    value: candidate.scale_px_per_mm,
    weight: Math.max(0.01, candidate.confidence)
  })));
  const candidates = rawCandidates.map((candidate) => {
    const residual = candidatePool.includes(candidate) && weightedScale
      ? relativeError(candidate.scale_px_per_mm, weightedScale)
      : 0;
    const tolerance = candidate.anchor_type === 'crosswalk_width' ? 0.24 : 0.18;
    return {
      ...candidate,
      residual: round(residual),
      tolerance,
      in_consensus: candidatePool.includes(candidate) && residual <= tolerance,
      conflict_reason: candidatePool.includes(candidate) && residual > tolerance
        ? `scale residual ${round(residual)} exceeds ${tolerance}`
        : null,
      review_required: Boolean(candidate.review_required || residual > tolerance)
    };
  });
  const winners = candidates
    .filter((candidate) => candidate.in_consensus)
    .sort((a, b) => b.confidence - a.confidence || a.residual - b.residual);
  const winner = winners[0] || candidates.slice().sort((a, b) => a.residual - b.residual)[0] || null;
  const alternates = candidates.filter((candidate) => candidate.id !== winner?.id);
  const ok = winners.length >= 2 && families.length >= 2;
  return {
    version: 3,
    strategy: 'multi_candidate_scale_anchor_consensus',
    required_distinct_anchor_families: 2,
    consensus_scale_px_per_mm: round(weightedScale),
    candidate_count: candidates.length,
    distinct_anchor_families: families,
    winner: winner ? compactScaleAnchor(winner) : null,
    alternates: alternates.map(compactScaleAnchor),
    candidates,
    gate: {
      ok,
      verdict: ok ? 'pass' : 'review',
      review_required: !ok || candidates.some((candidate) => candidate.review_required),
      reasons: [
        ...(winners.length < 2 ? ['fewer_than_two_consensus_scale_anchors'] : []),
        ...(families.length < 2 ? ['single_scale_anchor_family'] : [])
      ]
    }
  };
}

function scaleAnchorCandidate(measurement) {
  const prior = SCALE_ANCHOR_PRIORS[measurement.anchor_type] || {
    family: measurement.anchor_type?.split('_')[0] || 'unknown',
    world_dimension_mm: null,
    measured_axis: measurement.pixels_per_mm_x ? 'x' : 'y'
  };
  const axis = measurement.pixels_per_mm_x ? 'x' : measurement.pixels_per_mm_y ? 'y' : prior.measured_axis;
  const scale = axis === 'y' ? measurement.pixels_per_mm_y : measurement.pixels_per_mm_x;
  if (!Number.isFinite(scale)) return null;
  const count = prior.expected_count_from_basis
    ? expectedCountFromBasis(measurement.basis)
    : null;
  return {
    id: measurement.observation_id || measurement.anchor_type,
    anchor_type: measurement.anchor_type,
    family: prior.family,
    source_image: measurement.source_image,
    observation_id: measurement.observation_id || null,
    measured_axis: axis,
    object_bbox: measurement.object_bbox || null,
    scale_px_per_mm: round(scale, 6),
    physical_width_mm: measurement.physical_width_mm ?? null,
    physical_height_mm: measurement.physical_height_mm ?? null,
    expected_count: count,
    confidence: round(measurement.confidence ?? 0.5),
    basis: measurement.basis || [],
    review_required: Boolean(measurement.review_required),
    note: measurement.note || null
  };
}

function compactScaleAnchor(candidate) {
  return {
    id: candidate.id,
    anchor_type: candidate.anchor_type,
    family: candidate.family,
    scale_px_per_mm: candidate.scale_px_per_mm,
    residual: candidate.residual,
    confidence: candidate.confidence,
    review_required: candidate.review_required
  };
}

function buildGroundPlan({ observations, topImage, siteObservation, siteBbox }) {
  if (!topImage || !siteBbox) {
    return {
      version: 3,
      region_classes: GROUNDING_V3_REGION_CLASSES,
      site_surface: null,
      regions: [],
      qa: {
        ok: false,
        coverage_ratio: 0,
        overlap_ratio: 0,
        gap_ratio: 1,
        review_required: true,
        reasons: ['missing_top_view_or_site_boundary']
      }
    };
  }

  const selected = selectGroundPlanObservations(topImage);
  const regions = selected.map((selection) => groundRegionFromObservation(selection, siteBbox));
  const siteArea = bboxArea(siteBbox);
  const overlapArea = pairwiseOverlapArea(regions.map((region) => region.bbox_px));
  const coveredArea = unionAreaApprox(regions.map((region) => region.bbox_px), siteBbox);
  const gapArea = Math.max(0, siteArea - coveredArea);
  const gapRegion = {
    id: 'site_unexplained_gap',
    class: 'gap',
    source: 'derived_planar_subdivision_residual',
    bbox_px: siteBbox,
    polygon_px: bboxPolygon(siteBbox),
    area_px: round(gapArea),
    area_ratio: round(gapArea / Math.max(1, siteArea)),
    source_observation_ids: [],
    confidence: 0.42,
    review_required: true,
    note: 'Residual site area not yet explained by mutually exclusive GroundPlan regions.'
  };
  const allRegions = [...regions, gapRegion];
  const classCoverage = Object.fromEntries(GROUNDING_V3_REGION_CLASSES.map((regionClass) => [
    regionClass,
    round(allRegions
      .filter((region) => region.class === regionClass)
      .reduce((sum, region) => sum + (region.area_px || 0), 0) / Math.max(1, siteArea))
  ]));
  const overlapRatio = round(overlapArea / Math.max(1, siteArea));
  const coverageRatio = round(coveredArea / Math.max(1, siteArea));
  const gapRatio = gapRegion.area_ratio;
  const missingEvidence = allRegions.filter((region) => (
    region.class !== 'gap'
    && !region.source_observation_ids.length
  ));
  const reasons = [
    ...(overlapRatio > 0.02 ? ['region_overlap_above_threshold'] : []),
    ...(gapRatio > 0.7 ? ['unexplained_gap_above_threshold'] : []),
    ...(missingEvidence.length ? ['region_without_source_evidence'] : [])
  ];
  return {
    version: 3,
    region_classes: GROUNDING_V3_REGION_CLASSES,
    site_surface: {
      id: 'site_surface',
      observation_id: siteObservation?.id || null,
      source_image: topImage.image?.path,
      bbox_px: siteBbox,
      polygon_px: bboxPolygon(siteBbox),
      grounding_method: siteObservation?.grounding?.method || siteObservation?.mask?.method || siteObservation?.kind || null,
      review_required: Boolean(siteObservation?.review_required || siteObservation?.grounding?.review_required)
    },
    regions: allRegions,
    qa: {
      ok: reasons.length === 0,
      coverage_ratio: coverageRatio,
      overlap_ratio: overlapRatio,
      max_overlap_ratio: overlapRatio,
      gap_ratio: gapRatio,
      class_coverage: classCoverage,
      checked_regions: allRegions.length,
      review_required: reasons.length > 0 || allRegions.some((region) => region.review_required),
      reasons
    },
    evidence_graph_projection: {
      version: 3,
      region_count: allRegions.length,
      source_image: topImage.image?.path,
      region_classes: classCoverage
    },
    open_questions: [
      'Confirm the residual gap class before treating this as a survey-grade planar subdivision.'
    ]
  };
}

function selectGroundPlanObservations(topImage) {
  const byHint = new Map();
  const hasParkingGrid = Boolean(findBestObservation(topImage, 'parking_stall_row_north') && findBestObservation(topImage, 'parking_stall_row_south'));
  const hasDriveAisle = Boolean(findBestObservation(topImage, 'parking_drive_aisle_center'));
  for (const observation of topImage?.observations || []) {
    if (!observation.component_hint || !observation.bbox) continue;
    if (observation.component_hint === 'parking_lot' && hasParkingGrid) continue;
    if (observation.component_hint === 'internal_roads' && hasDriveAisle) continue;
    const regionClass = regionClassForObservation(observation);
    if (!regionClass) continue;
    if (COARSE_BUILDING_HINTS.has(observation.component_hint) && hasFineBuildingUnits(topImage, observation.component_hint)) continue;
    const current = byHint.get(observation.component_hint);
    if (!current || observationGroundingScore(observation) > observationGroundingScore(current.observation)) {
      byHint.set(observation.component_hint, { observation, regionClass });
    }
  }
  return [...byHint.values()];
}

function groundRegionFromObservation({ observation, regionClass }, siteBbox) {
  const areaPx = bboxArea(observation.bbox);
  return {
    id: observation.component_hint,
    class: regionClass,
    source: 'top_view_region_evidence',
    source_observation_ids: [observation.id],
    source_image: observation.source_image || null,
    bbox_px: observation.bbox,
    polygon_px: observation.mask?.polygon || observation.mask?.sampled_contour || observation.contour?.polygon || bboxPolygon(observation.bbox),
    area_px: round(areaPx),
    area_ratio: round(areaPx / Math.max(1, bboxArea(siteBbox))),
    grounding_method: observation.grounding?.method || observation.mask?.method || observation.kind || null,
    confidence: round(observation.confidence ?? 0.5),
    review_required: Boolean(observation.review_required || observation.grounding?.review_required || observation.mask?.review_required),
    note: observation.note || null
  };
}

function buildLineGridFit({ observations, topImage, scaleAnchorGraph }) {
  const top = topImage || findTopImage(observations);
  const parkingLines = (top?.observations || [])
    .filter((observation) => /^parking_stall_row/.test(observation.component_hint || '') && observation.bbox)
    .sort((a, b) => observationGroundingScore(b) - observationGroundingScore(a))
    .filter(uniqueByHint());
  const driveAisle = findBestObservation(top, 'parking_drive_aisle_center');
  const internalRoad = findBestObservation(top, 'internal_roads');
  const lineFits = parkingLines.map((observation) => lineFitFromObservation(observation));
  const rowCenters = lineFits.map((line) => line.center_px?.[1]).filter(Number.isFinite).sort((a, b) => a - b);
  const rowSpacingPx = rowCenters.length >= 2 ? Math.abs(rowCenters[1] - rowCenters[0]) : null;
  const winnerScale = scaleAnchorGraph?.winner?.scale_px_per_mm || scaleAnchorGraph?.consensus_scale_px_per_mm || null;
  const baySpan = scaleAnchorGraph?.candidates?.find((candidate) => candidate.anchor_type === 'parking_bay_width_span');
  const estimatedStallCount = baySpan?.object_bbox && winnerScale
    ? Math.max(1, Math.round(baySpan.object_bbox[2] / Math.max(1, 2600 * winnerScale)))
    : null;
  const basisCount = baySpan?.expected_count || estimatedStallCount;
  const countResidual = basisCount && estimatedStallCount
    ? Math.abs(estimatedStallCount - basisCount) / Math.max(1, basisCount)
    : 0;
  const axisResidual = lineFits.length
    ? max(lineFits.map((line) => line.axis_error_deg / 90))
    : 1;
  const spacingResidual = rowSpacingPx && driveAisle?.bbox
    ? relativeError(rowSpacingPx, Math.max(1, driveAisle.bbox[3] + parkingLines[0].bbox[3]))
    : 0;
  const roadAxes = [driveAisle, internalRoad]
    .filter(Boolean)
    .map((observation) => ({
      id: `${observation.component_hint}_axis`,
      observation_id: observation.id,
      source_component: observation.component_hint,
      axis: (observation.bbox?.[2] || 0) >= (observation.bbox?.[3] || 0) ? 'x' : 'y',
      bbox_px: observation.bbox,
      center_px: bboxCenter(observation.bbox),
      grounding_method: observation.grounding?.method || observation.mask?.method || observation.kind || null,
      confidence: round(observation.confidence ?? 0.5),
      review_required: Boolean(observation.review_required || observation.grounding?.review_required)
    }));
  const reasons = [
    ...(lineFits.length < 2 ? ['fewer_than_two_parking_line_fits'] : []),
    ...(axisResidual > 0.08 ? ['parking_line_axis_residual_above_threshold'] : []),
    ...(countResidual > 0.16 ? ['parking_grid_count_residual_above_threshold'] : []),
    ...(!driveAisle ? ['missing_drive_aisle_gap_evidence'] : [])
  ];
  return {
    version: 3,
    parking_grid_fits: [{
      id: 'parking_grid_main',
      row_count: lineFits.length,
      estimated_stall_count: estimatedStallCount,
      basis_stall_count: basisCount,
      row_spacing_px: rowSpacingPx,
      drive_aisle_observation_id: driveAisle?.id || null,
      line_fits: lineFits,
      residuals: {
        axis_residual: round(axisResidual),
        row_spacing_residual: round(spacingResidual),
        parking_grid_count_residual: round(countResidual),
        drive_aisle_gap_residual: driveAisle ? 0 : 1
      },
      review_required: reasons.length > 0,
      confidence: round(average(lineFits.map((line) => line.confidence)))
    }],
    road_axis_fits: roadAxes,
    qa: {
      ok: reasons.length === 0,
      checked_parking_lines: lineFits.length,
      checked_road_axes: roadAxes.length,
      max_line_axis_residual: round(axisResidual),
      parking_grid_count_residual: round(countResidual),
      max_drive_aisle_gap_residual: driveAisle ? 0 : 1,
      review_required: reasons.length > 0,
      reasons
    }
  };
}

function lineFitFromObservation(observation) {
  const horizontal = observation.bbox[2] >= observation.bbox[3];
  const axisErrorDeg = horizontal ? 0 : 90;
  return {
    id: `${observation.component_hint}_line_fit`,
    observation_id: observation.id,
    component_hint: observation.component_hint,
    axis: horizontal ? 'x' : 'y',
    bbox_px: observation.bbox,
    center_px: bboxCenter(observation.bbox),
    length_px: round(Math.max(observation.bbox[2], observation.bbox[3])),
    thickness_px: round(Math.min(observation.bbox[2], observation.bbox[3])),
    axis_error_deg: axisErrorDeg,
    grounding_method: observation.grounding?.method || observation.mask?.method || observation.kind || null,
    confidence: round(observation.confidence ?? 0.5),
    review_required: Boolean(observation.review_required || observation.grounding?.review_required || observation.mask?.review_required)
  };
}

function buildTopViewOverlay({ observations, geometryFit, groundPlan, lineGridFit }) {
  const top = findTopImage(observations);
  const footprintResults = geometryFit?.footprint_results || [];
  const regionOverlays = groundPlan.regions.map((region) => {
    const footprint = footprintResults.find((result) => result.observation_id && region.source_observation_ids?.includes(result.observation_id));
    const iou = footprint?.residuals?.polygon_iou ?? footprint?.residuals?.iou ?? 1;
    const centerError = footprint?.residuals?.center_error ?? 0;
    return {
      region_id: region.id,
      class: region.class,
      source_observation_ids: region.source_observation_ids || [],
      mask_iou: round(iou),
      centroid_delta_norm: footprint?.residuals?.center_delta || [0, 0],
      centroid_error_norm: round(centerError),
      review_required: Boolean(region.review_required || (footprint && !footprint.ok))
    };
  });
  const lineOverlays = (lineGridFit.parking_grid_fits?.[0]?.line_fits || []).map((line) => ({
    id: line.id,
    observation_id: line.observation_id,
    class: 'parking',
    chamfer_error_norm: round(line.axis_error_deg / 90),
    axis_error_deg: line.axis_error_deg,
    review_required: line.review_required
  }));
  const ious = regionOverlays.map((region) => region.mask_iou).filter(Number.isFinite);
  const centroidErrors = regionOverlays.map((region) => region.centroid_error_norm).filter(Number.isFinite);
  const chamferErrors = lineOverlays.map((line) => line.chamfer_error_norm).filter(Number.isFinite);
  const classConfusion = classConfusionSummary(regionOverlays, footprintResults);
  const reasons = [
    ...(ious.length && Math.min(...ious) < 0.42 ? ['region_mask_iou_below_threshold'] : []),
    ...(max(centroidErrors) > 0.08 ? ['region_centroid_delta_above_threshold'] : []),
    ...(max(chamferErrors) > 0.08 ? ['line_chamfer_above_threshold'] : [])
  ];
  return {
    version: 3,
    source_image: top?.image?.path || null,
    projection_basis: geometryFit ? 'geometry_fit_v2_model_projection' : 'image_space_ground_plan_only',
    region_overlays: regionOverlays,
    line_overlays: lineOverlays,
    class_confusion: classConfusion,
    qa: {
      ok: reasons.length === 0,
      mean_mask_iou: round(average(ious)),
      min_mask_iou: round(ious.length ? Math.min(...ious) : 0),
      max_centroid_error_norm: round(max(centroidErrors)),
      max_line_chamfer_error_norm: round(max(chamferErrors)),
      checked_regions: regionOverlays.length,
      checked_lines: lineOverlays.length,
      review_required: reasons.length > 0 || regionOverlays.some((region) => region.review_required),
      reasons
    }
  };
}

function buildPromotionDecisions({ groundPlan, lineGridFit, topViewOverlay, codeDocument }) {
  const overlayByRegion = new Map((topViewOverlay.region_overlays || []).map((region) => [region.region_id, region]));
  const lineOk = lineGridFit.qa?.ok === true;
  const decisions = [];
  for (const region of groundPlan.regions || []) {
    const overlay = overlayByRegion.get(region.id);
    let decision = 'review_candidate';
    const reasons = [];
    if (region.class === 'gap') {
      decision = 'review_candidate';
      reasons.push('derived gap must be reviewed before geometry promotion');
    } else if (!region.source_observation_ids?.length) {
      decision = 'rejected';
      reasons.push('missing source mask or region evidence');
    } else if (region.class === 'parking' || region.class === 'road') {
      decision = lineOk ? 'promoted_geometry' : 'review_candidate';
      if (!lineOk) reasons.push('line_grid_fit_residual_requires_review');
    } else if (['green', 'walkway', 'service_yard'].includes(region.class)) {
      decision = 'helper_only';
      reasons.push('non-structural site detail remains helper/review geometry in R9');
    } else {
      decision = overlay?.mask_iou >= 0.42 || !overlay
        ? 'promoted_geometry'
        : 'review_candidate';
      if (overlay && overlay.mask_iou < 0.42) reasons.push('top_view_overlay_iou_below_threshold');
    }
    if (region.review_required && decision === 'promoted_geometry') reasons.push('source_observation_still_review_required');
    decisions.push(promotionDecision({
      part_id: region.id,
      region_id: region.id,
      region_class: region.class,
      decision,
      confidence: confidenceForDecision(decision, region, overlay),
      source_observation_ids: region.source_observation_ids || [],
      overlay_residual: overlay
        ? {
          mask_iou: overlay.mask_iou,
          centroid_error_norm: overlay.centroid_error_norm
        }
        : null,
      reasons
    }));
  }

  for (const operation of codeDocument?.operations || []) {
    const qa = operation.qa || {};
    const role = qa.role || operation.role || '';
    if (!isDenseDetailRole(role)) continue;
    const id = operation.id || operation.name || qa.part_id || role;
    decisions.push(promotionDecision({
      part_id: qa.part_id || id,
      region_id: id,
      region_class: 'gap',
      decision: qa.grounding_status === 'image_grounded' && qa.photo_grade_eligible === true ? 'review_candidate' : 'helper_only',
      confidence: 0.3,
      source_observation_ids: qa.source_observation_ids || [],
      reasons: ['dense detail is not promoted by Grounding v3 without per-instance mask/line/region evidence']
    }));
  }
  return dedupeDecisions(decisions);
}

function promotionDecision({ part_id, region_id, region_class, decision, confidence, source_observation_ids = [], overlay_residual = null, reasons = [] }) {
  return {
    part_id,
    region_id,
    region_class,
    decision: GROUNDING_V3_PROMOTION_DECISIONS.includes(decision) ? decision : 'review_candidate',
    confidence: round(confidence ?? 0.4),
    source_observation_ids,
    overlay_residual,
    reasons
  };
}

function evaluateGroundingV3Gates({ scaleAnchorGraph, groundPlan, lineGridFit, topViewOverlay, promotionDecisions }) {
  const gates = [
    gate('scale_anchor_graph', scaleAnchorGraph.gate.ok, scaleAnchorGraph.gate.reasons, 'warn'),
    gate('planar_subdivision', groundPlan.qa.ok, groundPlan.qa.reasons, 'error'),
    gate('line_grid_fit', lineGridFit.qa.ok, lineGridFit.qa.reasons, 'error'),
    gate('top_view_overlay', topViewOverlay.qa.ok, topViewOverlay.qa.reasons, 'error')
  ];
  const invalidPromotions = promotionDecisions.filter((decision) => (
    decision.decision === 'promoted_geometry'
    && (!decision.source_observation_ids?.length || (decision.overlay_residual && decision.overlay_residual.mask_iou < 0.42))
  ));
  gates.push(gate(
    'candidate_promotion',
    invalidPromotions.length === 0,
    invalidPromotions.map((decision) => `${decision.part_id}_invalid_promotion`),
    'error'
  ));
  return gates;
}

function gate(id, ok, reasons = [], severity = 'error') {
  return {
    id,
    ok: Boolean(ok),
    verdict: ok ? 'pass' : (severity === 'warn' ? 'review' : 'fail'),
    issues: ok ? [] : reasons.map((reason) => ({
      severity,
      type: `grounding_v3.${id}`,
      rule_id: id,
      message: reason,
      evidence: { reason }
    }))
  };
}

function summarizeGroundingV3({ scaleAnchorGraph, groundPlan, lineGridFit, topViewOverlay, promotionDecisions, issues }) {
  const decisionCounts = countBy(promotionDecisions, 'decision');
  const bySeverity = countBy(issues, 'severity');
  const promoted = decisionCounts.promoted_geometry || 0;
  const review = decisionCounts.review_candidate || 0;
  const helper = decisionCounts.helper_only || 0;
  const rejected = decisionCounts.rejected || 0;
  return {
    checked_scale_anchors: scaleAnchorGraph.candidate_count,
    distinct_scale_anchor_families: scaleAnchorGraph.distinct_anchor_families.length,
    scale_anchor_winner_type: scaleAnchorGraph.winner?.anchor_type || null,
    scale_anchor_review_required: scaleAnchorGraph.gate.review_required,
    checked_ground_regions: groundPlan.qa.checked_regions,
    subdivision_coverage_ratio: groundPlan.qa.coverage_ratio,
    subdivision_overlap_ratio: groundPlan.qa.overlap_ratio,
    subdivision_gap_ratio: groundPlan.qa.gap_ratio,
    checked_line_fits: lineGridFit.qa.checked_parking_lines,
    checked_road_axes: lineGridFit.qa.checked_road_axes,
    parking_grid_count_residual: lineGridFit.qa.parking_grid_count_residual,
    max_line_axis_residual: lineGridFit.qa.max_line_axis_residual,
    top_view_overlay_regions: topViewOverlay.qa.checked_regions,
    top_view_overlay_lines: topViewOverlay.qa.checked_lines,
    top_view_overlay_mean_iou: topViewOverlay.qa.mean_mask_iou,
    top_view_overlay_min_iou: topViewOverlay.qa.min_mask_iou,
    top_view_overlay_max_centroid_error: topViewOverlay.qa.max_centroid_error_norm,
    top_view_overlay_max_chamfer_error: topViewOverlay.qa.max_line_chamfer_error_norm,
    promotion_decisions: promotionDecisions.length,
    promoted_geometry: promoted,
    review_candidate: review,
    helper_only: helper,
    rejected,
    photo_grade_candidate: promoted > 0 && review === 0 && helper === 0 && rejected === 0 && issues.length === 0,
    total_issues: issues.length,
    by_severity: {
      error: bySeverity.error || 0,
      warn: bySeverity.warn || 0,
      info: bySeverity.info || 0
    }
  };
}

function groundingV3CorrectionSuggestions(issues, promotionDecisions) {
  const suggestions = issues.map((issue) => ({
    action: issue.type.includes('scale_anchor_graph')
      ? 'add_or_confirm_independent_scale_anchor'
      : issue.type.includes('planar_subdivision')
        ? 'refine_ground_plan_region_masks'
        : issue.type.includes('line_grid_fit')
          ? 'review_parking_or_road_line_fit'
          : issue.type.includes('top_view_overlay')
            ? 'adjust_grounding_graph_or_part_graph_projection'
            : 'downgrade_candidate_or_add_evidence',
    target: issue.rule_id,
    reason: issue.message,
    evidence: issue.evidence
  }));
  for (const decision of promotionDecisions.filter((item) => item.decision !== 'promoted_geometry')) {
    suggestions.push({
      action: 'keep_candidate_out_of_promoted_geometry',
      target: decision.part_id,
      reason: decision.reasons.join('; ') || `${decision.part_id} is not ready for promoted geometry.`,
      evidence: decision
    });
  }
  return suggestions;
}

function regionClassForObservation(observation) {
  const hint = observation.component_hint || '';
  if (BUILDING_HINTS.has(hint) || COARSE_BUILDING_HINTS.has(hint)) return 'building_footprint';
  if (hint === 'parking_stall_row_north' || hint === 'parking_stall_row_south' || hint === 'parking_lot') return 'parking';
  if (hint === 'parking_drive_aisle_center' || hint === 'internal_roads') return 'road';
  if (hint === 'tree_row_south' || /green|vegetation|tree/i.test(hint)) return 'green';
  if (/crosswalk|walkway/.test(hint)) return 'walkway';
  if (hint === 'tank_farm' || /service_yard|loading|yard/.test(hint)) return 'service_yard';
  return null;
}

function hasFineBuildingUnits(topImage, coarseHint) {
  const expected = coarseHint === 'warehouse_row_west'
    ? ['warehouse_west_north', 'warehouse_west_south']
    : coarseHint === 'warehouse_row_inner'
      ? ['warehouse_inner_north', 'warehouse_inner_south']
      : [];
  return expected.every((hint) => Boolean(findBestObservation(topImage, hint)));
}

function findTopImage(observations) {
  return (observations.images || []).find((image) => image.detected_view?.kind === 'top') || observations.images?.[0] || null;
}

function findBestObservation(image, componentHint) {
  return (image?.observations || [])
    .filter((observation) => observation.component_hint === componentHint && observation.bbox)
    .sort((a, b) => observationGroundingScore(b) - observationGroundingScore(a))[0] || null;
}

function observationGroundingScore(observation) {
  let score = Number(observation?.confidence) || 0;
  const method = observation?.grounding?.method || observation?.mask?.method || '';
  if (/^pixel_/i.test(method)) score += 10;
  if (/mask|contour|line|gap|vegetation/.test(method)) score += 3;
  if (/layout_prior|template|prior/i.test(`${method} ${observation?.note || ''}`)) score -= 6;
  if (observation?.review_required || observation?.grounding?.review_required || observation?.mask?.review_required) score -= 2;
  return score;
}

function uniqueByHint() {
  const seen = new Set();
  return (observation) => {
    if (seen.has(observation.component_hint)) return false;
    seen.add(observation.component_hint);
    return true;
  };
}

function isBuildingGroupObservationSet(observationSet) {
  return observationSet.object?.profile === 'building_group' || observationSet.object?.type === 'building_group';
}

function isDenseDetailRole(role) {
  return /roof_|tree|parked_vehicle|vent|hvac|texture|fence|crosswalk|detail/i.test(role || '');
}

function classConfusionSummary(regionOverlays, footprintResults) {
  const unmatchedModel = footprintResults
    .filter((result) => !regionOverlays.some((region) => region.source_observation_ids.includes(result.observation_id)))
    .map((result) => result.id);
  return {
    unmatched_model_footprints: unmatchedModel,
    unmatched_region_overlays: regionOverlays
      .filter((region) => !region.source_observation_ids.length)
      .map((region) => region.region_id)
  };
}

function dedupeDecisions(decisions) {
  const byPart = new Map();
  for (const decision of decisions) {
    const current = byPart.get(decision.part_id);
    if (!current || decisionRank(decision.decision) > decisionRank(current.decision)) byPart.set(decision.part_id, decision);
  }
  return [...byPart.values()];
}

function decisionRank(decision) {
  return {
    promoted_geometry: 4,
    review_candidate: 3,
    helper_only: 2,
    rejected: 1
  }[decision] || 0;
}

function bboxPolygon([x, y, width, height]) {
  return [
    [round(x), round(y)],
    [round(x + width), round(y)],
    [round(x + width), round(y + height)],
    [round(x), round(y + height)],
    [round(x), round(y)]
  ];
}

function bboxArea(bbox) {
  if (!bbox) return 0;
  return Math.max(0, bbox[2] || 0) * Math.max(0, bbox[3] || 0);
}

function bboxCenter(bbox) {
  return [round(bbox[0] + bbox[2] / 2), round(bbox[1] + bbox[3] / 2)];
}

function pairwiseOverlapArea(bboxes) {
  let total = 0;
  for (let index = 0; index < bboxes.length; index += 1) {
    for (let other = index + 1; other < bboxes.length; other += 1) {
      total += intersectionArea(bboxes[index], bboxes[other]);
    }
  }
  return total;
}

function unionAreaApprox(bboxes, siteBbox) {
  const clipped = bboxes.map((bbox) => clipBbox(bbox, siteBbox)).filter((bbox) => bboxArea(bbox) > 0);
  return Math.max(0, clipped.reduce((sum, bbox) => sum + bboxArea(bbox), 0) - pairwiseOverlapArea(clipped));
}

function clipBbox(bbox, frame) {
  const minX = Math.max(frame[0], bbox[0]);
  const minY = Math.max(frame[1], bbox[1]);
  const maxX = Math.min(frame[0] + frame[2], bbox[0] + bbox[2]);
  const maxY = Math.min(frame[1] + frame[3], bbox[1] + bbox[3]);
  return [minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY)];
}

function intersectionArea(a, b) {
  const minX = Math.max(a[0], b[0]);
  const minY = Math.max(a[1], b[1]);
  const maxX = Math.min(a[0] + a[2], b[0] + b[2]);
  const maxY = Math.min(a[1] + a[3], b[1] + b[3]);
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

function expectedCountFromBasis(basis = []) {
  const match = basis.join(' ').match(/(\d+)\s+visible parking bay/i);
  return match ? Number(match[1]) : null;
}

function confidenceForDecision(decision, region, overlay) {
  const base = region.confidence ?? 0.4;
  if (decision === 'promoted_geometry') return clamp((base + (overlay?.mask_iou ?? 0.7)) / 2, 0.45, 0.9);
  if (decision === 'helper_only') return clamp(base * 0.7, 0.2, 0.62);
  if (decision === 'rejected') return clamp(base * 0.3, 0.05, 0.35);
  return clamp(base * 0.82, 0.18, 0.72);
}

function weightedAverage(items) {
  const valid = items.filter((item) => Number.isFinite(item.value) && Number.isFinite(item.weight));
  const weight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (!weight) return 0;
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weight;
}

function relativeError(value, expected) {
  const denominator = Math.max(0.000001, Math.abs(expected));
  return Math.abs(value - expected) / denominator;
}

function countBy(items = [], key) {
  const result = {};
  for (const item of items || []) {
    const value = item?.[key] ?? 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null && value !== ''))];
}

function average(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function max(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : 0;
}

function clamp(value, min, maxValue) {
  return Math.min(maxValue, Math.max(min, value));
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}
