export const AUTO_GROUND_PLAN_R10_CLASSES = [
  'building_footprint',
  'road',
  'parking',
  'green',
  'walkway',
  'service_yard',
  'gap'
];

export const AUTO_GROUND_PLAN_R10_GAP_CLASSES = [
  'open_paved_area',
  'road_candidate',
  'walkway_candidate',
  'service_yard_candidate',
  'vegetation_gap',
  'true_gap',
  'unknown_gap'
];

export const AUTO_GROUND_PLAN_R10_SOURCE_PRIORITY = {
  pixel_building_mask: 100,
  canonical_parking_grid: 94,
  pixel_line: 90,
  pixel_gap: 84,
  pixel_vegetation: 76,
  service_evidence: 70,
  layout_prior: 30,
  derived_gap: 1
};

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

const WAREHOUSE_PARENT_CHILDREN = {
  warehouse_row_west: ['warehouse_west_north', 'warehouse_west_south'],
  warehouse_row_inner: ['warehouse_inner_north', 'warehouse_inner_south']
};

const PARKING_ROW_HINTS = [
  'parking_stall_row_north',
  'parking_stall_row_south'
];

export function buildAutoGroundPlanR10({ observations = {}, groundingV3 = null } = {}) {
  const topImage = findTopImage(observations);
  const siteObservation = findBestObservation(topImage, 'site_boundary')
    || findBestObservation(topImage, 'building_top_site_boundary');
  const siteBbox = siteObservation?.bbox || topImage?.metrics?.object_bbox || null;
  if (!topImage || !siteBbox) return missingSitePlan();

  const landCoverV1 = observations.land_cover_v1?.kind === 'bird_eye_land_cover_v1'
    ? observations.land_cover_v1
    : null;
  const boundaryGraphV1 = observations.boundary_graph_v1?.kind === 'boundary_graph_v1'
    ? observations.boundary_graph_v1
    : null;
  const siteSurface = siteSurfaceFromBoundaryGraph(boundaryGraphV1, topImage)
    || siteSurfaceFromObservation(topImage, siteObservation, siteBbox);
  const evidenceCandidates = buildEvidenceCandidates(topImage, siteSurface);
  const parkingGrid = canonicalizeParkingGrid({ topImage, siteSurface, evidenceCandidates });
  const resolved = resolveEvidenceConflicts({
    evidenceCandidates,
    parkingGrid,
    siteSurface
  });
  const canonicalRegions = buildCanonicalRegions({
    resolvedEvidence: resolved.resolved_evidence,
    parkingGrid,
    siteSurface,
    boundaryGraphV1
  });
  const roadCorridors = buildRoadCorridors(canonicalRegions, boundaryGraphV1);
  const subdivisionCells = buildSubdivisionCells({
    siteSurface,
    canonicalRegions
  });
  const gapCompletion = buildGapCompletion({
    siteSurface,
    canonicalRegions,
    subdivisionCells,
    evidenceCandidates,
    rejectedPriors: resolved.rejected_priors,
    parkingGrid,
    roadCorridors,
    landCoverV1,
    boundaryGraphV1
  });
  const qa = buildStructuredPlanQa({
    siteSurface,
    canonicalRegions,
    subdivisionCells,
    gapCompletion,
    rejectedPriors: resolved.rejected_priors,
    rejectedEvidence: resolved.rejected_evidence,
    parkingGrid,
    roadCorridors,
    landCoverV1,
    boundaryGraphV1
  });

  return {
    kind: 'auto_ground_plan_r10',
    version: 10,
    coordinate_convention: 'image_x_right_y_down_to_model_xy_y_up',
    source_image: topImage.image?.path || null,
    site_surface: siteSurface,
    evidence_candidates: evidenceCandidates,
    resolved_evidence: resolved.resolved_evidence,
    rejected_priors: resolved.rejected_priors,
    rejected_evidence: resolved.rejected_evidence,
    canonical_regions: canonicalRegions,
    subdivision_cells: subdivisionCells,
    gap_completion: gapCompletion,
    parking_grid: parkingGrid,
    road_corridors: roadCorridors,
    land_cover_v1: landCoverV1 ? {
      available: true,
      backend: landCoverV1.backend || null,
      source_image: landCoverV1.source_image || null,
      qa: landCoverV1.qa || {},
      mask_count: landCoverV1.masks?.length || 0,
      tile_count: landCoverV1.tiles?.length || 0
    } : {
      available: false,
      reason: 'ObservationSet.land_cover_v1 missing; AutoGroundPlan used R10.5 object-evidence fallback.'
    },
    boundary_graph_v1: boundaryGraphV1 ? {
      available: true,
      backend: boundaryGraphV1.backend || null,
      source_image: boundaryGraphV1.source_image || null,
      qa: boundaryGraphV1.qa || {},
      observed_edge_count: boundaryGraphV1.observed_edges?.length || 0,
      completed_edge_count: boundaryGraphV1.completed_edges?.length || 0,
      corridor_hypothesis_count: boundaryGraphV1.corridor_hypotheses?.length || 0
    } : {
      available: false,
      reason: 'ObservationSet.boundary_graph_v1 missing; AutoGroundPlan used R11 land-cover fallback.'
    },
    qa,
    compatibility: {
      grounding_v3_available: Boolean(groundingV3),
      preferred_ground_plan_source: boundaryGraphV1
        ? 'auto_ground_plan_r11_boundary_graph_v1'
        : landCoverV1 ? 'auto_ground_plan_r10_land_cover_v1' : 'auto_ground_plan_r10'
    }
  };
}

export function validateAutoGroundPlanR10({ observations = {}, groundingV3 = null } = {}) {
  const autoGroundPlan = buildAutoGroundPlanR10({ observations, groundingV3 });
  return {
    kind: 'auto_ground_plan_r10_qa',
    version: 10,
    ok: autoGroundPlan.qa.ok,
    verdict: autoGroundPlan.qa.verdict,
    auto_ground_plan: autoGroundPlan,
    summary: summarizeAutoGroundPlan(autoGroundPlan),
    issues: autoGroundPlan.qa.issues || [],
    correction_suggestions: correctionSuggestions(autoGroundPlan)
  };
}

export function groundPlanV3FromAutoGroundPlanR10(autoGroundPlan = {}) {
  const siteSurface = autoGroundPlan.site_surface || null;
  const siteArea = siteSurface ? bboxArea(siteSurface.bbox_px) : 0;
  const regions = (autoGroundPlan.canonical_regions || []).map((region) => ({
    id: region.id,
    class: region.class,
    source: region.source,
    source_observation_ids: region.source_observation_ids || [],
    source_image: autoGroundPlan.source_image || null,
    bbox_px: region.bbox_px,
    polygon_px: region.polygon_px,
    area_px: region.area_px,
    area_ratio: round(region.area_px / Math.max(1, siteArea)),
    grounding_method: region.grounding_method || null,
    confidence: region.confidence,
    review_required: Boolean(region.review_required),
    note: region.note || null,
    r10_region_id: region.id,
    r10_decision: region.grounding_decision || null
  }));
  const gapArea = (autoGroundPlan.subdivision_cells || [])
    .filter((cell) => cell.class === 'gap')
    .reduce((sum, cell) => sum + (cell.area_px || 0), 0);
  regions.push({
    id: 'site_unexplained_gap',
    class: 'gap',
    source: 'auto_ground_plan_r10_subdivision_residual',
    source_observation_ids: [],
    source_image: autoGroundPlan.source_image || null,
    bbox_px: siteSurface?.bbox_px || [0, 0, 0, 0],
    polygon_px: siteSurface?.polygon_px || [],
    area_px: round(gapArea),
    area_ratio: round(gapArea / Math.max(1, siteArea)),
    grounding_method: 'derived_gap',
    confidence: 0.3,
    review_required: true,
    note: 'R10 aggregate of mutually exclusive gap cells. Inspect auto_ground_plan.subdivision_cells for exact cell boundaries.',
    r10_region_id: 'site_unexplained_gap',
    r10_decision: 'review_candidate'
  });
  const classCoverage = Object.fromEntries(AUTO_GROUND_PLAN_R10_CLASSES.map((regionClass) => [
    regionClass,
    round(regions
      .filter((region) => region.class === regionClass)
      .reduce((sum, region) => sum + (region.area_px || 0), 0) / Math.max(1, siteArea))
  ]));
  return {
    version: 3,
    source_version: 10,
    source: 'auto_ground_plan_r10',
    region_classes: AUTO_GROUND_PLAN_R10_CLASSES,
    site_surface: siteSurface,
    regions,
    qa: {
      ok: autoGroundPlan.qa?.ok === true,
      coverage_ratio: round(1 - Number(autoGroundPlan.qa?.gap_ratio ?? 1)),
      overlap_ratio: round(autoGroundPlan.qa?.canonical_region_overlap_ratio || 0),
      max_overlap_ratio: round(autoGroundPlan.qa?.canonical_region_overlap_ratio || 0),
      gap_ratio: round(autoGroundPlan.qa?.gap_ratio ?? 1),
      gap_completion_ratio: round(autoGroundPlan.qa?.gap_completion_ratio || 0),
      remaining_unknown_gap_ratio: round(autoGroundPlan.qa?.remaining_unknown_gap_ratio ?? autoGroundPlan.qa?.gap_ratio ?? 1),
      class_coverage: classCoverage,
      checked_regions: regions.length,
      review_required: Boolean(autoGroundPlan.qa?.review_required),
      reasons: autoGroundPlan.qa?.reasons || []
    },
    evidence_graph_projection: {
      version: 10,
      region_count: regions.length,
      source_image: autoGroundPlan.source_image || null,
      region_classes: classCoverage,
      gap_completion: autoGroundPlan.gap_completion ? {
        completed_regions: autoGroundPlan.gap_completion.completed_regions?.length || 0,
        remaining_gap_cells: autoGroundPlan.gap_completion.remaining_gap_cells?.length || 0,
        residuals: autoGroundPlan.gap_completion.residuals || {}
      } : null
    },
    open_questions: [
      'R10.5 gap completion classifies explainable residual cells, but derived roads/walkways/service yards remain review-gated.'
    ]
  };
}

function missingSitePlan() {
  const qa = {
    ok: false,
    verdict: 'fail',
    hard_fail: true,
    review_required: true,
    road_building_overlap_ratio: 1,
    parent_child_double_occupancy: 0,
    raw_contour_leakage: 0,
    layout_prior_conflict_count: 0,
    canonical_region_overlap_ratio: 1,
    gap_ratio: 1,
    gap_completion_ratio: 0,
    remaining_unknown_gap_ratio: 1,
    gap_derived_road_overlap_ratio: 1,
    gap_derived_region_without_connectivity: 0,
    open_paved_area_ratio: 0,
    road_candidate_review_count: 0,
    region_without_evidence: 0,
    reasons: ['missing_top_view_or_site_boundary'],
    issues: [issue('error', 'structured_plan.missing_site_boundary', 'missing_top_view_or_site_boundary')]
  };
  return {
    kind: 'auto_ground_plan_r10',
    version: 10,
    coordinate_convention: 'image_x_right_y_down_to_model_xy_y_up',
    source_image: null,
    site_surface: null,
    evidence_candidates: [],
    resolved_evidence: [],
    rejected_priors: [],
    rejected_evidence: [],
    canonical_regions: [],
    subdivision_cells: [],
    gap_completion: {
      completed_regions: [],
      remaining_gap_cells: [],
      gap_classification_summary: emptyGapClassificationSummary(1),
      connectivity_graph: { nodes: [], edges: [] },
      residuals: {
        original_gap_ratio: 1,
        gap_completion_ratio: 0,
        remaining_unknown_gap_ratio: 1,
        gap_derived_road_overlap_ratio: 1,
        gap_derived_region_without_connectivity: 0,
        open_paved_area_ratio: 0,
        road_candidate_review_count: 0
      },
      review_required: true
    },
    parking_grid: null,
    road_corridors: [],
    qa
  };
}

function buildEvidenceCandidates(topImage, siteSurface) {
  const siteArea = bboxArea(siteSurface.bbox_px);
  return (topImage?.observations || [])
    .filter((observation) => observation.bbox && observation.component_hint)
    .map((observation) => evidenceCandidate(observation, siteSurface, siteArea))
    .filter(Boolean)
    .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || a.id.localeCompare(b.id));
}

function evidenceCandidate(observation, siteSurface, siteArea) {
  const regionClass = regionClassForObservation(observation);
  if (!regionClass) return null;
  const method = observation.grounding?.method || observation.mask?.method || observation.kind || 'unknown';
  const sourceKind = sourceKindForObservation(observation, regionClass);
  const bbox = clipBbox(observation.bbox, siteSurface.bbox_px);
  if (bboxArea(bbox) <= 0) return null;
  const rawPolygon = observation.mask?.polygon
    || observation.mask?.sampled_contour
    || observation.contour?.polygon
    || bboxPolygon(bbox);
  const reviewRequired = Boolean(
    observation.review_required
    || observation.grounding?.review_required
    || observation.mask?.review_required
    || observation.grounding?.grounding_quality?.review_required
  );
  return {
    id: observation.component_hint,
    observation_id: observation.id,
    class: regionClass,
    source_kind: sourceKind,
    source_image: observation.source_image || topImagePathForObservation(observation) || null,
    bbox_px: normalizeBbox(bbox),
    polygon_px: normalizePolygon(rawPolygon),
    canonical_polygon_px: bboxPolygon(bbox),
    area_px: round(bboxArea(bbox)),
    area_ratio: round(bboxArea(bbox) / Math.max(1, siteArea)),
    grounding_method: method,
    priority: evidencePriority(sourceKind),
    confidence: round(observation.confidence ?? 0.5),
    review_required: reviewRequired,
    source_observation_ids: [observation.id],
    raw_geometry_allowed_in_structured_output: false,
    diagnostic: {
      polygon_source: rawPolygon === observation.mask?.sampled_contour ? 'sampled_contour' : observation.mask?.polygon ? 'mask_polygon' : 'bbox_polygon',
      bbox_proxy: Boolean(observation.grounding?.grounding_quality?.bbox_proxy || observation.mask?.quality?.bbox_proxy),
      note: observation.note || null
    }
  };
}

function resolveEvidenceConflicts({ evidenceCandidates, parkingGrid, siteSurface }) {
  const rejectedPriors = [];
  const rejectedEvidence = [];
  const resolved = [];
  const byId = new Map(evidenceCandidates.map((candidate) => [candidate.id, candidate]));
  const nonPriorIds = new Set(evidenceCandidates
    .filter((candidate) => candidate.source_kind !== 'layout_prior')
    .map((candidate) => candidate.id));
  const pixelBuilding = evidenceCandidates.filter((candidate) => (
    candidate.class === 'building_footprint'
    && candidate.source_kind === 'pixel_building_mask'
    && candidate.confidence >= 0.72
  ));
  const parkingGridAvailable = parkingGrid?.status === 'canonicalized';

  for (const candidate of evidenceCandidates) {
    if (candidate.source_kind === 'layout_prior' && nonPriorIds.has(candidate.id)) {
      rejectedPriors.push(rejection(candidate, 'pixel_evidence_supersedes_layout_prior_for_same_region'));
      continue;
    }

    const parentChildren = WAREHOUSE_PARENT_CHILDREN[candidate.id] || [];
    if (parentChildren.length && parentChildren.every((childId) => byId.has(childId))) {
      rejectedEvidence.push(rejection(candidate, 'parent_reference_only_child_masks_win'));
      continue;
    }

    if (candidate.id === 'parking_lot' && parkingGridAvailable) {
      rejectedPriors.push(rejection(candidate, 'canonical_parking_grid_supersedes_parking_lot_prior'));
      continue;
    }

    if (candidate.class === 'road') {
      const roadReject = roadConflict(candidate, pixelBuilding, siteSurface);
      if (roadReject) {
        rejectedPriors.push(rejection(candidate, roadReject.reason, roadReject.metrics));
        continue;
      }
    }

    if (candidate.source_kind === 'layout_prior') {
      const overlap = max(pixelBuilding.map((building) => intersectionArea(candidate.bbox_px, building.bbox_px)));
      if (overlap > 0 && candidate.class !== 'building_footprint') {
        rejectedPriors.push(rejection(candidate, 'layout_prior_overlaps_high_confidence_pixel_building', {
          overlap_px: round(overlap)
        }));
        continue;
      }
    }

    resolved.push({
      ...candidate,
      resolution: candidate.source_kind === 'layout_prior' ? 'resolved_review_prior' : 'resolved_pixel_evidence',
      structured_output: true
    });
  }

  return {
    resolved_evidence: resolved,
    rejected_priors: rejectedPriors,
    rejected_evidence: rejectedEvidence
  };
}

function roadConflict(candidate, pixelBuilding, siteSurface) {
  const siteArea = bboxArea(siteSurface.bbox_px);
  const overlapArea = pixelBuilding.reduce((sum, building) => sum + intersectionArea(candidate.bbox_px, building.bbox_px), 0);
  const priorArea = bboxArea(candidate.bbox_px);
  if (overlapArea > 0.005 * siteArea || overlapArea > 0.02 * priorArea) {
    return {
      reason: candidate.source_kind === 'layout_prior'
        ? 'layout_road_prior_overlaps_building_footprint'
        : 'road_evidence_overlaps_building_footprint',
      metrics: {
        overlap_px: round(overlapArea),
        overlap_site_ratio: round(overlapArea / Math.max(1, siteArea)),
        overlap_prior_ratio: round(overlapArea / Math.max(1, priorArea))
      }
    };
  }
  return null;
}

function canonicalizeParkingGrid({ topImage, siteSurface, evidenceCandidates }) {
  const rows = PARKING_ROW_HINTS
    .map((hint) => findBestObservation(topImage, hint))
    .filter(Boolean);
  const driveAisle = findBestObservation(topImage, 'parking_drive_aisle_center');
  const lineMethodsOk = rows.every((row) => /^pixel_line_segmentation$/.test(row.grounding?.method || row.mask?.method || ''));
  const driveAisleOk = /^pixel_gap_segmentation$/.test(driveAisle?.grounding?.method || driveAisle?.mask?.method || '');
  const rowBboxes = rows.map((row) => clipBbox(row.bbox, siteSurface.bbox_px));
  const rowCenters = rowBboxes.map((bbox) => bboxCenter(bbox)[1]).sort((a, b) => a - b);
  const rowSpacing = rowCenters.length >= 2 ? Math.abs(rowCenters[1] - rowCenters[0]) : null;
  const expectedSpacing = driveAisle?.bbox && rowBboxes[0]
    ? driveAisle.bbox[3] + rowBboxes[0][3]
    : null;
  const spacingResidual = rowSpacing && expectedSpacing
    ? relativeError(rowSpacing, Math.max(1, expectedSpacing))
    : 1;
  const rowLengths = rowBboxes.map((bbox) => bbox[2]);
  const axisResidual = rows.length ? max(rowBboxes.map((bbox) => bbox[2] >= bbox[3] ? 0 : 1)) : 1;
  const estimatedStallCount = rowLengths.length
    ? Math.max(1, Math.round(average(rowLengths) / Math.max(1, average(rowBboxes.map((bbox) => bbox[3])) * 1.9)))
    : null;
  const anchorCount = expectedParkingCountFromScaleEvidence(evidenceCandidates);
  const countResidual = estimatedStallCount && anchorCount
    ? Math.abs(estimatedStallCount - anchorCount)
    : 0;
  const buildingBboxes = evidenceCandidates
    .filter((candidate) => candidate.class === 'building_footprint' && candidate.source_kind === 'pixel_building_mask')
    .map((candidate) => candidate.bbox_px);
  const driveAisleBbox = driveAisle ? clipBbox(driveAisle.bbox, siteSurface.bbox_px) : null;
  const gridBuildingOverlap = [...rowBboxes, driveAisleBbox]
    .filter(Boolean)
    .reduce((sum, bbox) => sum + buildingBboxes.reduce((inner, building) => inner + intersectionArea(bbox, building), 0), 0);
  const gridBuildingOverlapRatio = gridBuildingOverlap / Math.max(1, bboxArea(siteSurface.bbox_px));
  const blockers = [
    ...(rows.length < 2 ? ['fewer_than_two_pixel_parking_rows'] : []),
    ...(!lineMethodsOk ? ['parking_rows_not_pixel_line_evidence'] : []),
    ...(!driveAisle ? ['missing_drive_aisle_pixel_gap'] : []),
    ...(driveAisle && !driveAisleOk ? ['drive_aisle_not_pixel_gap_evidence'] : []),
    ...(axisResidual > 0.04 ? ['parking_line_axis_unstable'] : []),
    ...(spacingResidual > 0.12 ? ['parking_row_spacing_unstable'] : []),
    ...(countResidual > 1 ? ['parking_stall_count_unstable'] : []),
    ...(gridBuildingOverlapRatio > 0.0005 ? ['parking_grid_overlaps_building_footprint'] : [])
  ];
  const rowRegions = rows.map((row) => {
    const bbox = clipBbox(row.bbox, siteSurface.bbox_px);
    return {
      id: row.component_hint,
      observation_id: row.id,
      class: 'parking',
      source_kind: 'canonical_parking_grid',
      bbox_px: normalizeBbox(bbox),
      polygon_px: bboxPolygon(bbox),
      polygon_source: 'canonical_bbox',
      grounding_method: row.grounding?.method || row.mask?.method || row.kind,
      confidence: round(row.confidence ?? 0.6),
      source_observation_ids: [row.id],
      review_required: blockers.length > 0,
      grounding_decision: blockers.length ? 'review_candidate' : 'promoted_geometry',
      note: blockers.length
        ? 'Parking row kept as review/helper because grid residuals are unstable.'
        : 'Parking row canonicalized from pixel line evidence.'
    };
  });
  const driveAisleRegion = driveAisle ? {
    id: 'parking_drive_aisle_center',
    observation_id: driveAisle.id,
    class: 'road',
    source_kind: 'pixel_gap',
    bbox_px: normalizeBbox(clipBbox(driveAisle.bbox, siteSurface.bbox_px)),
    polygon_px: bboxPolygon(clipBbox(driveAisle.bbox, siteSurface.bbox_px)),
    polygon_source: 'canonical_bbox',
    grounding_method: driveAisle.grounding?.method || driveAisle.mask?.method || driveAisle.kind,
    confidence: round(driveAisle.confidence ?? 0.6),
    source_observation_ids: [driveAisle.id],
    review_required: blockers.length > 0,
    grounding_decision: blockers.length ? 'review_candidate' : 'promoted_geometry',
    note: blockers.length
      ? 'Drive aisle kept as review/helper because parking grid residuals are unstable.'
      : 'Drive aisle canonicalized from pixel gap evidence.'
  } : null;
  const envelope = rowRegions.length || driveAisleRegion
    ? bboxUnion([...rowRegions, driveAisleRegion].filter(Boolean).map((region) => region.bbox_px))
    : null;
  return {
    id: 'parking_grid_main',
    status: blockers.length ? 'review_required' : 'canonicalized',
    row_count: rows.length,
    estimated_stall_count: estimatedStallCount,
    basis_stall_count: anchorCount,
    stall_count_residual: round(countResidual),
    row_spacing_px: round(rowSpacing),
    residuals: {
      axis_residual: round(axisResidual),
      row_spacing_residual: round(spacingResidual),
      stall_count_residual: round(countResidual),
      drive_aisle_width_residual: driveAisleOk ? 0 : 1,
      building_overlap_ratio: round(gridBuildingOverlapRatio)
    },
    envelope_px: envelope ? normalizeBbox(envelope) : null,
    row_strips: rowRegions,
    drive_aisle: driveAisleRegion,
    raw_contour_policy: 'diagnostic_only',
    blockers
  };
}

function buildCanonicalRegions({ resolvedEvidence, parkingGrid, siteSurface, boundaryGraphV1 = null }) {
  const regions = [];
  const parkingIds = new Set(PARKING_ROW_HINTS);
  if (parkingGrid?.status === 'canonicalized') {
    regions.push(...parkingGrid.row_strips.map((region) => canonicalRegionFromParking(region, siteSurface)));
    if (parkingGrid.drive_aisle) regions.push(canonicalRegionFromParking(parkingGrid.drive_aisle, siteSurface));
  }

  for (const evidence of resolvedEvidence) {
    if (parkingIds.has(evidence.id) || evidence.id === 'parking_drive_aisle_center' || evidence.id === 'parking_lot') continue;
    if (evidence.id === 'site_boundary') continue;
    const decision = decisionForResolvedEvidence(evidence);
    regions.push({
      id: evidence.id,
      class: evidence.class,
      source: evidence.source_kind,
      source_kind: evidence.source_kind,
      source_observation_ids: evidence.source_observation_ids || [],
      source_image: evidence.source_image || null,
      bbox_px: normalizeBbox(evidence.bbox_px),
      polygon_px: bboxPolygon(evidence.bbox_px),
      polygon_source: 'canonical_bbox',
      raw_polygon_px: evidence.polygon_px,
      area_px: round(bboxArea(evidence.bbox_px)),
      area_ratio: round(bboxArea(evidence.bbox_px) / Math.max(1, bboxArea(siteSurface.bbox_px))),
      grounding_method: evidence.grounding_method,
      confidence: evidence.confidence,
      review_required: Boolean(evidence.review_required || decision !== 'promoted_geometry'),
      grounding_decision: decision,
      structured_output: true,
      note: noteForResolvedEvidence(evidence, decision)
    });
  }

  regions.push(...boundaryGraphCorridorRegions({
    boundaryGraphV1,
    siteSurface,
    existingRegions: regions
  }));

  return regions
    .sort((a, b) => classPriority(b.class, b.source_kind) - classPriority(a.class, a.source_kind) || a.id.localeCompare(b.id));
}

function canonicalRegionFromParking(region, siteSurface) {
  return {
    id: region.id,
    class: region.class,
    source: region.source_kind,
    source_kind: region.source_kind,
    source_observation_ids: region.source_observation_ids || [],
    bbox_px: normalizeBbox(region.bbox_px),
    polygon_px: bboxPolygon(region.bbox_px),
    polygon_source: 'canonical_bbox',
    area_px: round(bboxArea(region.bbox_px)),
    area_ratio: round(bboxArea(region.bbox_px) / Math.max(1, bboxArea(siteSurface.bbox_px))),
    grounding_method: region.grounding_method,
    confidence: region.confidence,
    review_required: region.review_required,
    grounding_decision: region.grounding_decision,
    structured_output: true,
    note: region.note
  };
}

function boundaryGraphCorridorRegions({ boundaryGraphV1, siteSurface, existingRegions }) {
  if (!boundaryGraphV1?.corridor_hypotheses?.length) return [];
  const regions = [];
  for (const hypothesis of boundaryGraphV1.corridor_hypotheses
    .filter((item) => item.kind === 'road_corridor')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || bboxArea(b.bbox_px) - bboxArea(a.bbox_px))) {
    const bbox = clipBbox(hypothesis.bbox_px, siteSurface.bbox_px);
    if (bboxArea(bbox) <= 0) continue;
    const overlap = [...existingRegions, ...regions].reduce((sum, region) => sum + intersectionArea(bbox, region.bbox_px), 0);
    if (overlap / Math.max(1, bboxArea(bbox)) > 0.0001) continue;
    const promoted = hypothesis.grounding_decision === 'promoted_geometry' && !hypothesis.review_required;
    regions.push({
      id: `boundary_graph_${hypothesis.id}`,
      class: 'road',
      source: 'boundary_graph_completion',
      source_kind: 'boundary_graph_completion',
      source_observation_ids: hypothesis.observed_endpoint_ids?.length ? hypothesis.observed_endpoint_ids : [hypothesis.source_mask_id || hypothesis.id],
      bbox_px: normalizeBbox(bbox),
      polygon_px: bboxPolygon(bbox),
      polygon_source: 'canonical_bbox',
      area_px: round(bboxArea(bbox)),
      area_ratio: round(bboxArea(bbox) / Math.max(1, bboxArea(siteSurface.bbox_px))),
      grounding_method: 'boundary_graph_v1_hypothesis_completion',
      confidence: round(hypothesis.confidence || 0.5),
      review_required: !promoted,
      grounding_decision: promoted ? 'promoted_geometry' : 'review_candidate',
      structured_output: true,
      boundary_graph_edge_ids: hypothesis.boundary_graph_edge_ids || [],
      completion_hypothesis_id: hypothesis.id,
      inference_level: hypothesis.inference_level || hypothesis.state || 'weak_inferred',
      risk_flags: hypothesis.risk_flags || [],
      residuals: {
        direction_residual: round(hypothesis.direction_residual || 0),
        width_residual: round(hypothesis.width_residual || 0),
        land_cover_support_ratio: round(hypothesis.land_cover_support_ratio || 0)
      },
      note: `${hypothesis.inference_level || hypothesis.state || 'weak_inferred'} road corridor from BoundaryGraph v1: ${hypothesis.completion_reason || 'boundary completion'}`
    });
  }
  return regions.slice(0, 8);
}

function buildRoadCorridors(canonicalRegions, boundaryGraphV1 = null) {
  const fromRegions = canonicalRegions
    .filter((region) => region.class === 'road')
    .map((region) => ({
      id: `${region.id}_corridor`,
      region_id: region.id,
      source_observation_ids: region.source_observation_ids || [],
      bbox_px: region.bbox_px,
      polygon_px: region.polygon_px,
      axis: region.bbox_px[2] >= region.bbox_px[3] ? 'x' : 'y',
      width_px: round(Math.min(region.bbox_px[2], region.bbox_px[3])),
      confidence: region.confidence,
      review_required: region.review_required,
      inference_level: region.inference_level || 'observed',
      boundary_graph_edge_ids: region.boundary_graph_edge_ids || [],
      completion_hypothesis_id: region.completion_hypothesis_id || null
    }));
  const hypothesisIds = new Set(fromRegions.map((region) => region.completion_hypothesis_id).filter(Boolean));
  const diagnostics = (boundaryGraphV1?.corridor_hypotheses || [])
    .filter((hypothesis) => !hypothesisIds.has(hypothesis.id))
    .map((hypothesis) => ({
      id: `${hypothesis.id}_diagnostic_corridor`,
      region_id: null,
      bbox_px: hypothesis.bbox_px,
      polygon_px: hypothesis.polygon_px,
      axis: hypothesis.axis,
      width_px: hypothesis.width_px,
      confidence: hypothesis.confidence,
      review_required: true,
      inference_level: hypothesis.inference_level,
      boundary_graph_edge_ids: hypothesis.boundary_graph_edge_ids || [],
      completion_hypothesis_id: hypothesis.id,
      diagnostic_only: true
    }));
  return [...fromRegions, ...diagnostics];
}

function buildSubdivisionCells({ siteSurface, canonicalRegions }) {
  const site = siteSurface.bbox_px;
  const xEdges = sortedUnique([
    site[0],
    site[0] + site[2],
    ...canonicalRegions.flatMap((region) => [region.bbox_px[0], region.bbox_px[0] + region.bbox_px[2]])
  ]);
  const yEdges = sortedUnique([
    site[1],
    site[1] + site[3],
    ...canonicalRegions.flatMap((region) => [region.bbox_px[1], region.bbox_px[1] + region.bbox_px[3]])
  ]);
  const cells = [];
  let cellIndex = 0;
  for (let yIndex = 0; yIndex < yEdges.length - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < xEdges.length - 1; xIndex += 1) {
      const bbox = normalizeBbox([
        xEdges[xIndex],
        yEdges[yIndex],
        xEdges[xIndex + 1] - xEdges[xIndex],
        yEdges[yIndex + 1] - yEdges[yIndex]
      ]);
      if (bboxArea(bbox) <= 0) continue;
      const region = winnerRegionForCell(bbox, canonicalRegions);
      cells.push(cellFromRegion({
        index: cellIndex,
        bbox,
        region,
        siteArea: bboxArea(site)
      }));
      cellIndex += 1;
    }
  }
  return cells;
}

function cellFromRegion({ index, bbox, region, siteArea }) {
  const area = bboxArea(bbox);
  if (!region) {
    return {
      id: `r10_gap_cell_${index}`,
      class: 'gap',
      region_id: null,
      source: 'derived_gap',
      source_kind: 'derived_gap',
      source_observation_ids: [],
      bbox_px: bbox,
      polygon_px: bboxPolygon(bbox),
      area_px: round(area),
      area_ratio: round(area / Math.max(1, siteArea)),
      confidence: 0.3,
      review_required: true,
      grounding_decision: 'review_candidate',
      note: 'Unexplained site cell kept visible as gap.'
    };
  }
  return {
    id: `r10_${region.id}_cell_${index}`,
    class: region.class,
    region_id: region.id,
    source: region.source,
    source_kind: region.source_kind,
    source_observation_ids: region.source_observation_ids || [],
    bbox_px: bbox,
    polygon_px: bboxPolygon(bbox),
    area_px: round(area),
    area_ratio: round(area / Math.max(1, siteArea)),
    grounding_method: region.grounding_method || null,
    confidence: region.confidence,
    review_required: region.review_required,
    grounding_decision: region.grounding_decision,
    inference_level: region.inference_level || null,
    boundary_graph_edge_ids: region.boundary_graph_edge_ids || [],
    completion_hypothesis_id: region.completion_hypothesis_id || null,
    risk_flags: region.risk_flags || [],
    note: region.note || null
  };
}

function winnerRegionForCell(cellBbox, canonicalRegions) {
  const candidates = canonicalRegions
    .map((region) => ({
      region,
      overlap: intersectionArea(cellBbox, region.bbox_px)
    }))
    .filter((item) => item.overlap > 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (
    b.overlap - a.overlap
    || classPriority(b.region.class, b.region.source_kind) - classPriority(a.region.class, a.region.source_kind)
    || b.region.confidence - a.region.confidence
  ));
  return candidates[0].region;
}

function buildGapCompletion({
  siteSurface,
  canonicalRegions,
  subdivisionCells,
  evidenceCandidates,
  rejectedPriors,
  parkingGrid,
  roadCorridors,
  landCoverV1,
  boundaryGraphV1
}) {
  const siteArea = bboxArea(siteSurface.bbox_px);
  const gapCells = subdivisionCells.filter((cell) => cell.class === 'gap');
  const classifiedCells = gapCells.map((cell) => classifyGapCell({
    cell,
    siteSurface,
    canonicalRegions,
    evidenceCandidates,
    rejectedPriors,
    parkingGrid,
    roadCorridors,
    landCoverV1,
    boundaryGraphV1
  }));
  const classificationById = Object.fromEntries(classifiedCells.map((cell) => [cell.id, cell.gap_class]));
  for (const classified of classifiedCells) {
    const original = subdivisionCells.find((cell) => cell.id === classified.id);
    if (original) {
      Object.assign(original, {
        gap_class: classified.gap_class,
        gap_source_evidence_ids: classified.source_evidence_ids,
        gap_connectivity_reasons: classified.connectivity_reasons,
        gap_residuals: classified.residuals,
        gap_downgrade_reason: classified.downgrade_reason,
        gap_grounding_decision: classified.grounding_decision,
        gap_review_required: classified.review_required,
        note: classified.note
      });
    }
  }

  const completedCells = classifiedCells.filter((cell) => !['true_gap', 'unknown_gap'].includes(cell.gap_class));
  const remainingGapCells = classifiedCells
    .filter((cell) => ['true_gap', 'unknown_gap'].includes(cell.gap_class))
    .map((cell) => gapCellSummary(cell));
  const completedRegions = connectedGapComponents(completedCells)
    .map((cells, index) => gapCompletionRegion(cells, index, siteArea));
  const originalGapArea = gapCells.reduce((sum, cell) => sum + (cell.area_px || 0), 0);
  const completedArea = completedCells.reduce((sum, cell) => sum + (cell.area_px || 0), 0);
  const unknownGapArea = classifiedCells
    .filter((cell) => cell.gap_class === 'unknown_gap')
    .reduce((sum, cell) => sum + (cell.area_px || 0), 0);
  const remainingGapArea = remainingGapCells.reduce((sum, cell) => sum + (cell.area_px || 0), 0);
  const openPavedArea = classifiedCells
    .filter((cell) => cell.gap_class === 'open_paved_area')
    .reduce((sum, cell) => sum + (cell.area_px || 0), 0);
  const roadCandidateRegions = completedRegions.filter((region) => region.class === 'road_candidate');
  const buildingRegions = canonicalRegions.filter((region) => region.class === 'building_footprint');
  const gapDerivedRoadOverlapArea = roadCandidateRegions.reduce((sum, region) => (
    sum + buildingRegions.reduce((inner, building) => inner + intersectionArea(region.bbox_px, building.bbox_px), 0)
  ), 0);
  const withoutConnectivity = completedRegions.filter((region) => !region.connectivity_reasons.length).length;
  const roadCandidateReviewCount = roadCandidateRegions.filter((region) => region.review_required).length;
  const residuals = {
    original_gap_ratio: round(originalGapArea / Math.max(1, siteArea)),
    gap_completion_ratio: round(completedArea / Math.max(1, originalGapArea)),
    remaining_gap_ratio: round(remainingGapArea / Math.max(1, siteArea)),
    remaining_unknown_gap_ratio: round(unknownGapArea / Math.max(1, siteArea)),
    gap_derived_road_overlap_ratio: round(gapDerivedRoadOverlapArea / Math.max(1, siteArea)),
    gap_derived_region_without_connectivity: withoutConnectivity,
    open_paved_area_ratio: round(openPavedArea / Math.max(1, siteArea)),
    road_candidate_review_count: roadCandidateReviewCount
  };

  return {
    kind: 'gap_completion_solver',
    version: 1,
    classes: AUTO_GROUND_PLAN_R10_GAP_CLASSES,
    policy: {
      semantic_source: 'geometry_and_pixel_evidence_only',
      promoted_gap_classes: [],
      helper_gap_classes: ['open_paved_area', 'vegetation_gap'],
      review_gap_classes: ['road_candidate', 'walkway_candidate', 'service_yard_candidate'],
      remaining_gap_classes: ['true_gap', 'unknown_gap']
    },
    completed_regions: completedRegions,
    remaining_gap_cells: remainingGapCells,
    gap_classification_summary: gapClassificationSummary(classifiedCells, siteArea),
    connectivity_graph: gapConnectivityGraph(classifiedCells, canonicalRegions),
    cell_classification_by_id: classificationById,
    residuals,
    review_required: Boolean(
      residuals.remaining_unknown_gap_ratio > 0.25
      || residuals.gap_derived_road_overlap_ratio > 0
      || residuals.gap_derived_region_without_connectivity > 0
      || completedRegions.some((region) => region.review_required)
    )
  };
}

function classifyGapCell({
  cell,
  siteSurface,
  canonicalRegions,
  evidenceCandidates,
  rejectedPriors,
  parkingGrid,
  roadCorridors,
  landCoverV1,
  boundaryGraphV1
}) {
  const bbox = cell.bbox_px;
  const site = siteSurface.bbox_px;
  const minSiteEdge = Math.min(site[2], site[3]);
  const minEdge = Math.min(bbox[2], bbox[3]);
  const maxEdge = Math.max(bbox[2], bbox[3]);
  const aspectRatio = maxEdge / Math.max(1, minEdge);
  const areaRatio = bboxArea(bbox) / Math.max(1, bboxArea(site));
  const adjacentRegions = canonicalRegions.filter((region) => bboxTouches(bbox, region.bbox_px, 1.5));
  const overlappingEvidence = evidenceCandidates.filter((candidate) => (
    candidate.class !== 'gap'
    && candidate.id !== 'site_boundary'
    && intersectionArea(bbox, candidate.bbox_px) / Math.max(1, bboxArea(bbox)) > 0.08
  ));
  const nearEvidence = evidenceCandidates.filter((candidate) => (
    candidate.class !== 'gap'
    && candidate.id !== 'site_boundary'
    && bboxTouches(bbox, candidate.bbox_px, 2)
  ));
  const evidence = uniqueById([...overlappingEvidence, ...nearEvidence]);
  const evidenceIds = evidence.map((item) => item.observation_id || item.id).filter(Boolean);
  const adjacentClasses = new Set(adjacentRegions.map((region) => region.class));
  const adjacentIds = new Set(adjacentRegions.map((region) => region.id));
  const hasVegetationEvidence = evidence.some((item) => item.source_kind === 'pixel_vegetation' || item.class === 'green');
  const hasGapEvidence = evidence.some((item) => item.source_kind === 'pixel_gap' || item.grounding_method === 'pixel_gap_segmentation');
  const hasLineEvidence = evidence.some((item) => item.source_kind === 'pixel_line' || item.grounding_method === 'pixel_line_segmentation');
  const hasServiceEvidence = evidence.some((item) => item.class === 'service_yard' || item.source_kind === 'service_evidence');
  const touchesBuilding = adjacentClasses.has('building_footprint');
  const touchesParking = adjacentClasses.has('parking') || bboxTouches(bbox, parkingGrid?.envelope_px, 2);
  const touchesRoad = adjacentClasses.has('road') || roadCorridors.some((road) => bboxTouches(bbox, road.bbox_px, 2));
  const touchesDriveAisle = adjacentIds.has('parking_drive_aisle_center')
    || bboxTouches(bbox, parkingGrid?.drive_aisle?.bbox_px, 2);
  const touchesGreen = adjacentClasses.has('green') || hasVegetationEvidence;
  const touchesService = adjacentClasses.has('service_yard') || hasServiceEvidence;
  const touchesSiteBoundary = bboxTouchesSiteBoundary(bbox, site, 1.5);
  const rejectedPriorNearby = rejectedPriors.filter((prior) => bboxTouches(bbox, prior.bbox_px, 2) || intersectionArea(bbox, prior.bbox_px) > 0);
  const narrowBand = minEdge <= minSiteEdge * 0.09;
  const elongated = aspectRatio >= 2.1;
  const hardscapeConnectivity = touchesParking || touchesRoad || touchesDriveAisle || hasGapEvidence || hasLineEvidence;
  const widthResidual = driveAisleWidthResidual(bbox, parkingGrid);
  const landCover = landCoverForBbox(landCoverV1, bbox);
  const landCoverEvidenceIds = landCover.evidence_ids || [];
  const landCoverHardscape = landCover.coverage_by_class.paved_surface
    + landCover.coverage_by_class.road_surface_candidate
    + landCover.coverage_by_class.parking_surface_candidate;
  const landCoverVegetation = landCover.coverage_by_class.vegetation_tree
    + landCover.coverage_by_class.vegetation_low;
  const landCoverRoad = landCover.coverage_by_class.road_surface_candidate;
  const landCoverParking = landCover.coverage_by_class.parking_surface_candidate;
  const landCoverBare = landCover.coverage_by_class.bare_soil;
  const landCoverUnknown = landCover.coverage_by_class.unknown
    + landCover.coverage_by_class.shadow_or_dark_unknown;
  const boundarySupport = boundaryGraphSupportForBbox(boundaryGraphV1, bbox);
  const base = {
    ...cell,
    source_evidence_ids: unique([...evidenceIds, ...landCoverEvidenceIds]),
    adjacent_region_ids: adjacentRegions.map((region) => region.id),
    connectivity_reasons: [],
    residuals: {
      aspect_ratio: round(aspectRatio),
      area_ratio: round(areaRatio),
      min_edge_site_ratio: round(minEdge / Math.max(1, minSiteEdge)),
      drive_aisle_width_residual: round(widthResidual),
      land_cover_dominant_class: landCover.dominant_class,
      land_cover_dominant_coverage: round(landCover.dominant_coverage || 0),
      land_cover_hardscape_coverage: round(landCoverHardscape),
      land_cover_vegetation_coverage: round(landCoverVegetation),
      land_cover_unknown_coverage: round(landCoverUnknown),
      boundary_graph_corridor_support: round(boundarySupport.coverage),
      boundary_graph_best_inference_level: boundarySupport.inference_level || null
    }
  };

  if (boundarySupport.coverage >= 0.45 && !touchesBuilding) {
    return gapClassification(base, {
      gapClass: boundarySupport.promoted ? 'road_candidate' : 'open_paved_area',
      decision: boundarySupport.promoted ? 'promoted_geometry' : 'helper_only',
      confidence: round(Math.max(0.52, boundarySupport.confidence || 0.5)),
      connectivity: [
        'boundary_graph_corridor_hypothesis',
        ...(boundarySupport.edge_ids || []).slice(0, 3),
        ...(boundarySupport.inference_level ? [`boundary_${boundarySupport.inference_level}`] : [])
      ],
      reviewRequired: !boundarySupport.promoted,
      downgrade: boundarySupport.promoted
        ? 'boundary graph completed corridor has enough residual support for promoted road candidate'
        : 'boundary graph aggressive completion explains this cell as open-paved helper; canonical road region carries the reviewable inferred geometry'
    });
  }

  if (landCoverVegetation >= 0.28) {
    return gapClassification(base, {
      gapClass: 'vegetation_gap',
      decision: 'helper_only',
      confidence: round(0.58 + Math.min(0.2, landCoverVegetation * 0.2)),
      connectivity: ['land_cover_vegetation_mask', ...(touchesGreen ? ['vegetation_evidence_or_green_adjacency'] : [])],
      reviewRequired: true,
      downgrade: 'land-cover vegetation explains this residual ground cell but remains helper/review context'
    });
  }

  if (landCoverRoad >= 0.34 && !touchesBuilding && (touchesRoad || touchesDriveAisle || elongated)) {
    return gapClassification(base, {
      gapClass: 'open_paved_area',
      decision: 'helper_only',
      confidence: round(0.55 + Math.min(0.16, landCoverRoad * 0.18)),
      connectivity: ['land_cover_road_surface_candidate', ...(touchesRoad || touchesDriveAisle ? ['connected_to_existing_road_or_drive_aisle'] : [])],
      reviewRequired: true,
      downgrade: 'land-cover road-like hardscape is helper-only unless BoundaryGraph provides corridor completion evidence'
    });
  }

  if (landCoverParking >= 0.34 && !touchesBuilding && (touchesParking || hasLineEvidence)) {
    return gapClassification(base, {
      gapClass: 'open_paved_area',
      decision: 'helper_only',
      confidence: round(0.54 + Math.min(0.16, landCoverParking * 0.18)),
      connectivity: ['land_cover_parking_surface_candidate', ...(touchesParking ? ['connected_to_parking'] : [])],
      reviewRequired: true,
      downgrade: 'parking-colored hardscape explains the residual cell, but stall grid residuals still control promoted parking geometry'
    });
  }

  if (landCoverHardscape >= 0.32 && !touchesBuilding) {
    return gapClassification(base, {
      gapClass: 'open_paved_area',
      decision: 'helper_only',
      confidence: round(0.5 + Math.min(0.16, landCoverHardscape * 0.18)),
      connectivity: ['land_cover_paved_surface'],
      reviewRequired: true,
      downgrade: 'open paved land-cover helper is not promoted to road without line/connectivity residuals'
    });
  }

  if (landCoverBare >= 0.34) {
    return gapClassification(base, {
      gapClass: 'true_gap',
      decision: 'review_candidate',
      confidence: round(0.38 + Math.min(0.12, landCoverBare * 0.12)),
      connectivity: ['land_cover_bare_soil'],
      reviewRequired: true,
      downgrade: 'bare/soil land-cover stays visible and unpromoted'
    });
  }

  if (touchesGreen) {
    return gapClassification(base, {
      gapClass: 'vegetation_gap',
      decision: 'helper_only',
      confidence: 0.54,
      connectivity: ['vegetation_evidence_or_green_adjacency'],
      reviewRequired: true,
      downgrade: 'vegetation gap remains contextual helper until source mask is independently confirmed'
    });
  }

  if (touchesDriveAisle && elongated && widthResidual <= 0.65) {
    return gapClassification(base, {
      gapClass: 'open_paved_area',
      decision: 'helper_only',
      confidence: 0.56,
      connectivity: ['connected_to_parking_drive_aisle', ...(hasGapEvidence ? ['pixel_gap_evidence'] : [])],
      reviewRequired: true,
      downgrade: 'drive-aisle-adjacent gap stays open-paved helper unless BoundaryGraph supplies corridor completion'
    });
  }

  if ((touchesRoad || (touchesParking && hasGapEvidence)) && elongated && !touchesBuilding) {
    return gapClassification(base, {
      gapClass: 'open_paved_area',
      decision: 'helper_only',
      confidence: 0.5,
      connectivity: ['connected_to_hardscape_corridor', ...(hasGapEvidence ? ['pixel_gap_evidence'] : [])],
      reviewRequired: true,
      downgrade: 'hardscape-connected gap remains open-paved helper because corridor axis evidence is incomplete'
    });
  }

  if (touchesService || (touchesBuilding && rejectedPriorNearby.some((prior) => /tank|service|yard/i.test(`${prior.id} ${prior.reason}`)))) {
    return gapClassification(base, {
      gapClass: 'service_yard_candidate',
      decision: 'review_candidate',
      confidence: 0.48,
      connectivity: ['service_evidence_or_service_adjacency'],
      reviewRequired: true,
      downgrade: 'service yard candidate needs explicit yard boundary evidence before promotion'
    });
  }

  if (touchesBuilding && narrowBand && hardscapeConnectivity) {
    return gapClassification(base, {
      gapClass: 'walkway_candidate',
      decision: 'review_candidate',
      confidence: 0.47,
      connectivity: ['building_edge_narrow_hardscape_gap'],
      reviewRequired: true,
      downgrade: 'walkway candidate is gap-derived and needs entrance/edge confirmation'
    });
  }

  if (hardscapeConnectivity) {
    return gapClassification(base, {
      gapClass: 'open_paved_area',
      decision: 'helper_only',
      confidence: 0.44,
      connectivity: ['adjacent_to_hardscape_or_pixel_gap_evidence'],
      reviewRequired: true,
      downgrade: 'open paved helper is not promoted to road without line/connectivity residuals'
    });
  }

  if (touchesSiteBoundary && !evidenceIds.length) {
    return gapClassification(base, {
      gapClass: 'true_gap',
      decision: 'review_candidate',
      confidence: 0.34,
      connectivity: [],
      reviewRequired: true,
      downgrade: 'site-boundary residual has no evidence and remains visible as true gap'
    });
  }

  return gapClassification(base, {
    gapClass: 'unknown_gap',
    decision: 'review_candidate',
    confidence: 0.28,
    connectivity: [],
    reviewRequired: true,
    downgrade: 'no geometry connectivity or pixel evidence explains this residual cell'
  });
}

function gapClassification(cell, {
  gapClass,
  decision,
  confidence,
  connectivity,
  reviewRequired,
  downgrade
}) {
  return {
    ...cell,
    gap_class: gapClass,
    confidence,
    connectivity_reasons: unique(connectivity),
    grounding_decision: decision,
    review_required: reviewRequired,
    downgrade_reason: downgrade,
    note: `${gapClass}: ${downgrade}`
  };
}

function connectedGapComponents(cells) {
  const remaining = new Set(cells.map((cell) => cell.id));
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const components = [];
  while (remaining.size) {
    const startId = remaining.values().next().value;
    const stack = [startId];
    const component = [];
    remaining.delete(startId);
    while (stack.length) {
      const current = byId.get(stack.pop());
      if (!current) continue;
      component.push(current);
      for (const other of cells) {
        if (!remaining.has(other.id) || other.gap_class !== current.gap_class) continue;
        if (!bboxTouches(current.bbox_px, other.bbox_px, 0.5)) continue;
        remaining.delete(other.id);
        stack.push(other.id);
      }
    }
    components.push(component);
  }
  return components;
}

function gapCompletionRegion(cells, index, siteArea) {
  const gapClass = cells[0].gap_class;
  const bbox = normalizeBbox(bboxUnion(cells.map((cell) => cell.bbox_px)));
  const area = cells.reduce((sum, cell) => sum + (cell.area_px || 0), 0);
  const connectivityReasons = unique(cells.flatMap((cell) => cell.connectivity_reasons || []));
  const evidenceIds = unique(cells.flatMap((cell) => cell.source_evidence_ids || []));
  const candidateClass = ['road_candidate', 'walkway_candidate', 'service_yard_candidate'].includes(gapClass);
  const allPromoted = candidateClass && cells.every((cell) => cell.grounding_decision === 'promoted_geometry');
  const anyReview = cells.some((cell) => cell.review_required);
  return {
    id: `gap_completion_${gapClass}_${index + 1}`,
    class: gapClass,
    source: 'gap_completion_solver',
    source_kind: 'derived_gap',
    source_cell_ids: cells.map((cell) => cell.id),
    source_evidence_ids: evidenceIds,
    bbox_px: bbox,
    polygon_px: bboxPolygon(bbox),
    area_px: round(area),
    area_ratio: round(area / Math.max(1, siteArea)),
    connectivity_reasons: connectivityReasons,
    residuals: {
      max_aspect_ratio: round(max(cells.map((cell) => cell.residuals?.aspect_ratio || 0))),
      max_drive_aisle_width_residual: round(max(cells.map((cell) => cell.residuals?.drive_aisle_width_residual || 0))),
      max_boundary_graph_corridor_support: round(max(cells.map((cell) => cell.residuals?.boundary_graph_corridor_support || 0)))
    },
    confidence: round(average(cells.map((cell) => cell.confidence || 0.3))),
    review_required: candidateClass ? !allPromoted || anyReview : true,
    grounding_decision: candidateClass ? (allPromoted && !anyReview ? 'promoted_geometry' : 'review_candidate') : 'helper_only',
    promotion_allowed: candidateClass ? allPromoted && !anyReview : false,
    downgrade_reason: candidateClass
      ? allPromoted && !anyReview
        ? 'boundary-graph-supported gap candidate passed aggressive completion residuals'
        : 'gap-derived candidate is not promoted without explicit connectivity and residual gates'
      : 'gap-derived helper surface does not become promoted geometry'
  };
}

function gapCellSummary(cell) {
  return {
    id: cell.id,
    gap_class: cell.gap_class,
    bbox_px: cell.bbox_px,
    polygon_px: cell.polygon_px,
    area_px: cell.area_px,
    area_ratio: cell.area_ratio,
    source_evidence_ids: cell.source_evidence_ids || [],
    connectivity_reasons: cell.connectivity_reasons || [],
    residuals: cell.residuals || {},
    review_required: true,
    downgrade_reason: cell.downgrade_reason
  };
}

function gapClassificationSummary(cells, siteArea) {
  const summary = emptyGapClassificationSummary(siteArea);
  for (const cell of cells) {
    const current = summary.by_class[cell.gap_class] || {
      cells: 0,
      area_px: 0,
      area_ratio: 0
    };
    current.cells += 1;
    current.area_px = round(current.area_px + (cell.area_px || 0));
    current.area_ratio = round(current.area_px / Math.max(1, siteArea));
    summary.by_class[cell.gap_class] = current;
    summary.total_gap_cells += 1;
    summary.total_gap_area_px = round(summary.total_gap_area_px + (cell.area_px || 0));
  }
  summary.total_gap_area_ratio = round(summary.total_gap_area_px / Math.max(1, siteArea));
  return summary;
}

function emptyGapClassificationSummary(siteArea = 1) {
  return {
    total_gap_cells: 0,
    total_gap_area_px: 0,
    total_gap_area_ratio: round(0 / Math.max(1, siteArea)),
    by_class: Object.fromEntries(AUTO_GROUND_PLAN_R10_GAP_CLASSES.map((gapClass) => [
      gapClass,
      { cells: 0, area_px: 0, area_ratio: 0 }
    ]))
  };
}

function gapConnectivityGraph(cells, canonicalRegions) {
  const nodes = cells.map((cell) => ({
    id: cell.id,
    gap_class: cell.gap_class,
    adjacent_region_ids: cell.adjacent_region_ids || [],
    connectivity_reasons: cell.connectivity_reasons || []
  }));
  const edges = [];
  for (let index = 0; index < cells.length; index += 1) {
    for (let other = index + 1; other < cells.length; other += 1) {
      if (!bboxTouches(cells[index].bbox_px, cells[other].bbox_px, 0.5)) continue;
      edges.push({
        source: cells[index].id,
        target: cells[other].id,
        kind: cells[index].gap_class === cells[other].gap_class ? 'same_gap_class_adjacency' : 'gap_class_boundary'
      });
    }
  }
  for (const cell of cells) {
    for (const region of canonicalRegions) {
      if (!bboxTouches(cell.bbox_px, region.bbox_px, 1.5)) continue;
      edges.push({
        source: cell.id,
        target: region.id,
        kind: `adjacent_to_${region.class}`
      });
    }
  }
  return { nodes, edges };
}

function driveAisleWidthResidual(cellBbox, parkingGrid) {
  const driveAisle = parkingGrid?.drive_aisle?.bbox_px;
  if (!driveAisle) return 1;
  const cellWidth = Math.min(cellBbox[2], cellBbox[3]);
  const aisleWidth = Math.min(driveAisle[2], driveAisle[3]);
  return relativeError(cellWidth, Math.max(1, aisleWidth));
}

function bboxTouchesSiteBoundary(bbox, site, tolerance = 0) {
  return Math.abs(bbox[0] - site[0]) <= tolerance
    || Math.abs(bbox[1] - site[1]) <= tolerance
    || Math.abs(bbox[0] + bbox[2] - (site[0] + site[2])) <= tolerance
    || Math.abs(bbox[1] + bbox[3] - (site[1] + site[3])) <= tolerance;
}

function landCoverForBbox(landCoverV1, bbox) {
  const classes = [
    'building_footprint',
    'paved_surface',
    'road_surface_candidate',
    'parking_surface_candidate',
    'parking_marking',
    'road_marking',
    'vegetation_tree',
    'vegetation_low',
    'bare_soil',
    'shadow_or_dark_unknown',
    'unknown'
  ];
  const coverage = Object.fromEntries(classes.map((cls) => [cls, 0]));
  const evidenceIds = new Set();
  if (!landCoverV1?.tiles?.length) {
    return {
      dominant_class: 'unknown',
      dominant_coverage: 0,
      coverage_by_class: coverage,
      evidence_ids: []
    };
  }
  const area = Math.max(1, bboxArea(bbox));
  for (const tile of landCoverV1.tiles || []) {
    const overlap = intersectionArea(bbox, tile.bbox_px);
    if (overlap <= 0) continue;
    const cls = coverage[tile.class] === undefined ? 'unknown' : tile.class;
    coverage[cls] += overlap / area;
    evidenceIds.add(tile.id);
  }
  for (const cls of classes) coverage[cls] = round(Math.min(1, coverage[cls]));
  const [dominantClass, dominantCoverage] = Object.entries(coverage)
    .sort((a, b) => b[1] - a[1])[0] || ['unknown', 0];
  return {
    dominant_class: dominantClass,
    dominant_coverage: round(dominantCoverage),
    coverage_by_class: coverage,
    evidence_ids: [...evidenceIds]
  };
}

function boundaryGraphSupportForBbox(boundaryGraphV1, bbox) {
  if (!boundaryGraphV1?.corridor_hypotheses?.length) {
    return {
      coverage: 0,
      confidence: 0,
      inference_level: null,
      promoted: false,
      edge_ids: []
    };
  }
  const area = Math.max(1, bboxArea(bbox));
  const candidates = boundaryGraphV1.corridor_hypotheses
    .map((hypothesis) => ({
      hypothesis,
      coverage: intersectionArea(bbox, hypothesis.bbox_px) / area
    }))
    .filter((item) => item.coverage > 0)
    .sort((a, b) => b.coverage - a.coverage || (b.hypothesis.confidence || 0) - (a.hypothesis.confidence || 0));
  const best = candidates[0];
  if (!best) {
    return {
      coverage: 0,
      confidence: 0,
      inference_level: null,
      promoted: false,
      edge_ids: []
    };
  }
  return {
    coverage: round(best.coverage),
    confidence: best.hypothesis.confidence || 0,
    inference_level: best.hypothesis.inference_level || best.hypothesis.state || 'weak_inferred',
    promoted: best.hypothesis.grounding_decision === 'promoted_geometry' && !best.hypothesis.review_required,
    edge_ids: best.hypothesis.boundary_graph_edge_ids || [],
    completion_hypothesis_id: best.hypothesis.id
  };
}

function bboxTouches(a, b, tolerance = 0) {
  if (!a || !b) return false;
  const ax1 = a[0];
  const ay1 = a[1];
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx1 = b[0];
  const by1 = b[1];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const separated = ax2 < bx1 - tolerance
    || bx2 < ax1 - tolerance
    || ay2 < by1 - tolerance
    || by2 < ay1 - tolerance;
  if (separated) return false;
  const overlaps = intersectionArea(a, b) > 0;
  const xEdgeTouch = Math.abs(ax2 - bx1) <= tolerance || Math.abs(bx2 - ax1) <= tolerance;
  const yOverlap = Math.min(ay2, by2) - Math.max(ay1, by1) > -tolerance;
  const yEdgeTouch = Math.abs(ay2 - by1) <= tolerance || Math.abs(by2 - ay1) <= tolerance;
  const xOverlap = Math.min(ax2, bx2) - Math.max(ax1, bx1) > -tolerance;
  return overlaps || (xEdgeTouch && yOverlap) || (yEdgeTouch && xOverlap);
}

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

function buildStructuredPlanQa({
  siteSurface,
  canonicalRegions,
  subdivisionCells,
  gapCompletion,
  rejectedPriors,
  rejectedEvidence,
  parkingGrid,
  roadCorridors,
  landCoverV1,
  boundaryGraphV1
}) {
  const siteArea = bboxArea(siteSurface.bbox_px);
  const roadBuildingOverlapArea = overlapByClass(canonicalRegions, 'road', 'building_footprint');
  const canonicalRegionOverlapArea = pairwiseOverlapArea(canonicalRegions.map((region) => region.bbox_px));
  const gapArea = subdivisionCells
    .filter((cell) => cell.class === 'gap')
    .reduce((sum, cell) => sum + cell.area_px, 0);
  const gapResiduals = gapCompletion?.residuals || {};
  const rawContourLeakage = canonicalRegions.filter((region) => (
    region.polygon_source !== 'canonical_bbox'
    || region.raw_geometry_allowed_in_structured_output === true
    || /raw|sampled/i.test(region.structured_render_source || '')
  )).length;
  const parentChildDoubleOccupancy = canonicalRegions.filter((region) => COARSE_BUILDING_HINTS.has(region.id)).length;
  const regionWithoutEvidence = canonicalRegions.filter((region) => (
    region.class !== 'gap'
    && !(region.source_observation_ids || []).length
  )).length;
  const layoutPriorConflictCount = rejectedPriors.filter((item) => item.source_kind === 'layout_prior').length;
  const landCoverQa = landCoverV1?.qa || null;
  const boundaryQa = boundaryGraphV1?.qa || null;
  const inferredGeometryAreaRatio = round(boundaryQa?.inferred_geometry_area_ratio || 0);
  const extrapolatedGeometryAreaRatio = round(boundaryQa?.extrapolated_geometry_area_ratio || 0);
  const hardReasons = [
    ...(roadBuildingOverlapArea > 0 ? ['road_building_overlap'] : []),
    ...(rawContourLeakage > 0 ? ['raw_contour_leakage'] : []),
    ...(parentChildDoubleOccupancy > 0 ? ['parent_child_double_occupancy'] : []),
    ...(canonicalRegionOverlapArea > 0.000001 * siteArea ? ['canonical_region_overlap'] : []),
    ...(Number(gapResiduals.gap_derived_road_overlap_ratio || 0) > 0 ? ['gap_derived_road_overlap'] : []),
    ...((gapResiduals.gap_derived_region_without_connectivity || 0) > 0 ? ['gap_derived_region_without_connectivity'] : []),
    ...(regionWithoutEvidence > 0 ? ['region_without_evidence'] : [])
  ];
  if ((boundaryQa?.road_building_overlap_ratio || 0) > 0.005) hardReasons.push('boundary_completed_corridor_crosses_building');
  const reviewReasons = [
    ...(gapArea / Math.max(1, siteArea) > 0.25 ? ['gap_above_candidate_threshold'] : []),
    ...(Number(gapResiduals.remaining_unknown_gap_ratio ?? 1) > 0.25 ? ['remaining_unknown_gap_above_candidate_threshold'] : []),
    ...((gapResiduals.road_candidate_review_count || 0) > 0 ? ['gap_road_candidates_require_review'] : []),
    ...(layoutPriorConflictCount > 0 ? ['layout_prior_conflicts_rejected'] : []),
    ...(parkingGrid?.status !== 'canonicalized' ? ['parking_grid_review_required'] : []),
    ...(canonicalRegions.some((region) => region.review_required) ? ['canonical_regions_include_review_candidates'] : []),
    ...(extrapolatedGeometryAreaRatio > 0.12 ? ['boundary_extrapolated_geometry_area_above_review_threshold'] : []),
    ...(inferredGeometryAreaRatio > 0.28 ? ['boundary_inferred_geometry_area_above_review_threshold'] : []),
    ...((boundaryQa?.mean_corridor_width_residual || 0) > 0.35 ? ['boundary_corridor_width_residual_above_review_threshold'] : []),
    ...((boundaryQa?.conflicting_hypothesis_count || 0) > 0 ? ['boundary_conflicting_hypotheses_require_review'] : [])
  ];
  const issues = [
    ...hardReasons.map((reason) => issue('error', `structured_plan.${reason}`, reason)),
    ...reviewReasons.map((reason) => issue('warn', `structured_plan.${reason}`, reason))
  ];
  const ok = hardReasons.length === 0;
  return {
    ok,
    verdict: ok ? (reviewReasons.length ? 'review' : 'pass') : 'fail',
    hard_fail: !ok,
    review_required: reviewReasons.length > 0 || !ok,
    road_building_overlap_ratio: round(roadBuildingOverlapArea / Math.max(1, siteArea)),
    parent_child_double_occupancy: parentChildDoubleOccupancy,
    parent_child_reference_rejected_count: rejectedEvidence.filter((item) => item.reason === 'parent_reference_only_child_masks_win').length,
    raw_contour_leakage: rawContourLeakage,
    layout_prior_conflict_count: layoutPriorConflictCount,
    canonical_region_overlap_ratio: round(canonicalRegionOverlapArea / Math.max(1, siteArea)),
    gap_ratio: round(gapArea / Math.max(1, siteArea)),
    gap_completion_ratio: round(gapResiduals.gap_completion_ratio || 0),
    remaining_unknown_gap_ratio: round(gapResiduals.remaining_unknown_gap_ratio ?? 1),
    gap_derived_road_overlap_ratio: round(gapResiduals.gap_derived_road_overlap_ratio || 0),
    gap_derived_region_without_connectivity: gapResiduals.gap_derived_region_without_connectivity || 0,
    open_paved_area_ratio: round(gapResiduals.open_paved_area_ratio || 0),
    road_candidate_review_count: gapResiduals.road_candidate_review_count || 0,
    region_without_evidence: regionWithoutEvidence,
    checked_canonical_regions: canonicalRegions.length,
    checked_subdivision_cells: subdivisionCells.length,
    checked_gap_completed_regions: gapCompletion?.completed_regions?.length || 0,
    remaining_gap_cells: gapCompletion?.remaining_gap_cells?.length || 0,
    checked_road_corridors: roadCorridors.length,
    rejected_priors: rejectedPriors.length,
    rejected_evidence: rejectedEvidence.length,
    land_cover_v1_available: Boolean(landCoverV1),
    land_cover_unknown_ratio: round(landCoverQa?.unknown_land_cover_ratio ?? 1),
    land_cover_paved_surface_ratio: round(landCoverQa?.paved_surface_ratio || 0),
    land_cover_vegetation_ratio: round(landCoverQa?.vegetation_ratio || 0),
    land_cover_boundary_confidence: round(landCoverQa?.boundary_confidence || 0),
    boundary_graph_v1_available: Boolean(boundaryGraphV1),
    site_boundary_closure_ratio: round(boundaryQa?.site_boundary_closure_ratio || 0),
    observed_edge_coverage_ratio: round(boundaryQa?.observed_edge_coverage_ratio || 0),
    completed_edge_ratio: round(boundaryQa?.completed_edge_ratio || 0),
    extrapolated_edge_ratio: round(boundaryQa?.extrapolated_edge_ratio || 0),
    boundary_road_corridor_count: boundaryQa?.road_corridor_count || 0,
    mean_corridor_width_residual: round(boundaryQa?.mean_corridor_width_residual || 0),
    max_boundary_snap_delta: round(boundaryQa?.max_boundary_snap_delta || 0),
    conflicting_hypothesis_count: boundaryQa?.conflicting_hypothesis_count || 0,
    inferred_geometry_area_ratio: inferredGeometryAreaRatio,
    extrapolated_geometry_area_ratio: extrapolatedGeometryAreaRatio,
    reasons: [...hardReasons, ...reviewReasons],
    issues
  };
}

function summarizeAutoGroundPlan(autoGroundPlan) {
  const qa = autoGroundPlan.qa || {};
  return {
    auto_ground_plan_r10_available: true,
    verdict: qa.verdict,
    checked_evidence_candidates: autoGroundPlan.evidence_candidates?.length || 0,
    resolved_evidence: autoGroundPlan.resolved_evidence?.length || 0,
    rejected_priors: autoGroundPlan.rejected_priors?.length || 0,
    canonical_regions: autoGroundPlan.canonical_regions?.length || 0,
    subdivision_cells: autoGroundPlan.subdivision_cells?.length || 0,
    road_building_overlap_ratio: qa.road_building_overlap_ratio,
    parent_child_double_occupancy: qa.parent_child_double_occupancy,
    raw_contour_leakage: qa.raw_contour_leakage,
    layout_prior_conflict_count: qa.layout_prior_conflict_count,
    canonical_region_overlap_ratio: qa.canonical_region_overlap_ratio,
    gap_ratio: qa.gap_ratio,
    gap_completion_ratio: qa.gap_completion_ratio,
    remaining_unknown_gap_ratio: qa.remaining_unknown_gap_ratio,
    open_paved_area_ratio: qa.open_paved_area_ratio,
    road_candidate_review_count: qa.road_candidate_review_count,
    gap_derived_road_overlap_ratio: qa.gap_derived_road_overlap_ratio,
    gap_derived_region_without_connectivity: qa.gap_derived_region_without_connectivity,
    region_without_evidence: qa.region_without_evidence,
    parking_grid_status: autoGroundPlan.parking_grid?.status || null,
    road_corridors: autoGroundPlan.road_corridors?.length || 0,
    land_cover_v1_available: qa.land_cover_v1_available,
    land_cover_unknown_ratio: qa.land_cover_unknown_ratio,
    land_cover_paved_surface_ratio: qa.land_cover_paved_surface_ratio,
    land_cover_vegetation_ratio: qa.land_cover_vegetation_ratio,
    land_cover_boundary_confidence: qa.land_cover_boundary_confidence,
    boundary_graph_v1_available: qa.boundary_graph_v1_available,
    site_boundary_closure_ratio: qa.site_boundary_closure_ratio,
    observed_edge_coverage_ratio: qa.observed_edge_coverage_ratio,
    completed_edge_ratio: qa.completed_edge_ratio,
    extrapolated_edge_ratio: qa.extrapolated_edge_ratio,
    boundary_road_corridor_count: qa.boundary_road_corridor_count,
    mean_corridor_width_residual: qa.mean_corridor_width_residual,
    max_boundary_snap_delta: qa.max_boundary_snap_delta,
    conflicting_hypothesis_count: qa.conflicting_hypothesis_count,
    inferred_geometry_area_ratio: qa.inferred_geometry_area_ratio,
    extrapolated_geometry_area_ratio: qa.extrapolated_geometry_area_ratio
  };
}

function correctionSuggestions(autoGroundPlan) {
  return (autoGroundPlan.qa?.issues || []).map((item) => ({
    action: actionForIssue(item.rule_id),
    target: item.rule_id,
    reason: item.message,
    evidence: item.evidence
  }));
}

function actionForIssue(ruleId) {
  if (/gap/.test(ruleId)) return 'keep_gap_visible_or_add_pixel_region_evidence';
  if (/road_building/.test(ruleId)) return 'reject_or_refit_road_corridor';
  if (/raw_contour/.test(ruleId)) return 'move_raw_contour_to_diagnostic_view';
  if (/parent_child/.test(ruleId)) return 'remove_parent_reference_from_canonical_occupancy';
  if (/layout_prior/.test(ruleId)) return 'keep_conflicting_layout_prior_diagnostic_only';
  if (/parking/.test(ruleId)) return 'refit_parking_grid_or_downgrade_to_review';
  return 'review_auto_ground_plan_r10';
}

function rejection(candidate, reason, metrics = {}) {
  return {
    id: candidate.id,
    observation_id: candidate.observation_id,
    class: candidate.class,
    source_kind: candidate.source_kind,
    bbox_px: candidate.bbox_px,
    source_observation_ids: candidate.source_observation_ids || [],
    confidence: candidate.confidence,
    reason,
    metrics,
    diagnostic_only: true
  };
}

function siteSurfaceFromObservation(topImage, siteObservation, siteBbox) {
  const bbox = normalizeBbox(siteBbox);
  return {
    id: 'site_surface',
    observation_id: siteObservation?.id || null,
    source_image: topImage.image?.path || null,
    bbox_px: bbox,
    polygon_px: bboxPolygon(bbox),
    grounding_method: siteObservation?.grounding?.method || siteObservation?.mask?.method || siteObservation?.kind || null,
    confidence: round(siteObservation?.confidence ?? 0.5),
    review_required: Boolean(siteObservation?.review_required || siteObservation?.grounding?.review_required)
  };
}

function siteSurfaceFromBoundaryGraph(boundaryGraphV1, topImage) {
  if (boundaryGraphV1?.backend !== 'source_image_edge_detector_v1') return null;
  const siteEdges = (boundaryGraphV1.observed_edges || [])
    .filter((edge) => edge.type === 'site_boundary_edge')
    .filter((edge) => edge.method === 'source_image_site_boundary_fit')
    .filter((edge) => edge.state === 'observed');
  if (siteEdges.length < 3) return null;
  const horizontalEdges = siteEdges.filter((edge) => Math.abs(edge.a?.[1] - edge.b?.[1]) <= Math.abs(edge.a?.[0] - edge.b?.[0]));
  const verticalEdges = siteEdges.filter((edge) => !horizontalEdges.includes(edge));
  if (horizontalEdges.length < 2 || verticalEdges.length < 2) return null;
  const xs = verticalEdges.map((edge) => average([edge.a?.[0], edge.b?.[0]])).filter((value) => Number.isFinite(value));
  const ys = horizontalEdges.map((edge) => average([edge.a?.[1], edge.b?.[1]])).filter((value) => Number.isFinite(value));
  if (xs.length < 2 || ys.length < 2) return null;
  const bbox = normalizeBbox([
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys)
  ]);
  if (bboxArea(bbox) <= 0) return null;
  return {
    id: 'site_surface',
    observation_id: 'boundary_graph_v1.site_boundary_loop_1',
    source_image: topImage.image?.path || boundaryGraphV1.source_image || null,
    bbox_px: bbox,
    polygon_px: bboxPolygon(bbox),
    grounding_method: 'source_image_boundary_graph_site_fit',
    confidence: round(Math.min(0.9, average(siteEdges.map((edge) => edge.confidence || 0.5), 0.5))),
    review_required: boundaryGraphV1.qa?.site_edge_detection_ratio < 0.75,
    boundary_graph_edge_ids: siteEdges.map((edge) => edge.id)
  };
}

function sourceKindForObservation(observation, regionClass) {
  const method = observation.grounding?.method || observation.mask?.method || observation.kind || '';
  if (regionClass === 'building_footprint' && /^pixel_/i.test(method)) return 'pixel_building_mask';
  if (method === 'pixel_line_segmentation') return 'pixel_line';
  if (method === 'pixel_gap_segmentation') return 'pixel_gap';
  if (method === 'pixel_vegetation_segmentation') return 'pixel_vegetation';
  if (regionClass === 'service_yard' && /^pixel_/i.test(method)) return 'service_evidence';
  if (/layout_prior|template|prior/i.test(`${method} ${observation.note || ''}`)) return 'layout_prior';
  if (/pixel/i.test(method)) return regionClass === 'building_footprint' ? 'pixel_building_mask' : 'pixel_gap';
  return 'layout_prior';
}

function evidencePriority(sourceKind) {
  return AUTO_GROUND_PLAN_R10_SOURCE_PRIORITY[sourceKind] || AUTO_GROUND_PLAN_R10_SOURCE_PRIORITY.layout_prior;
}

function classPriority(regionClass, sourceKind) {
  if (sourceKind === 'pixel_building_mask') return 100;
  return {
    building_footprint: 95,
    parking: 82,
    road: 78,
    green: 60,
    service_yard: 58,
    walkway: 56,
    gap: 1
  }[regionClass] || 1;
}

function decisionForResolvedEvidence(evidence) {
  if (evidence.source_kind === 'layout_prior') return 'review_candidate';
  if (evidence.class === 'green' || evidence.class === 'walkway' || evidence.class === 'service_yard') return 'helper_only';
  if (evidence.review_required) return 'review_candidate';
  return 'promoted_geometry';
}

function noteForResolvedEvidence(evidence, decision) {
  if (decision === 'review_candidate') return 'Canonical region retained, but not promoted because it relies on prior or review-gated evidence.';
  if (decision === 'helper_only') return 'Canonical helper region retained for context only.';
  return 'Canonical region resolved from image evidence.';
}

function regionClassForObservation(observation) {
  const hint = observation.component_hint || '';
  if (/^scale_anchor/.test(hint)) return null;
  if (hint === 'site_boundary' || hint === 'building_top_site_boundary') return null;
  if (BUILDING_HINTS.has(hint) || COARSE_BUILDING_HINTS.has(hint)) return 'building_footprint';
  if (hint === 'parking_stall_row_north' || hint === 'parking_stall_row_south' || hint === 'parking_lot') return 'parking';
  if (hint === 'parking_drive_aisle_center' || hint === 'internal_roads') return 'road';
  if (hint === 'tree_row_south' || /green|vegetation|tree/i.test(hint)) return 'green';
  if (/crosswalk|walkway/.test(hint)) return 'walkway';
  if (hint === 'tank_farm' || /service_yard|loading|yard|tank/.test(hint)) return 'service_yard';
  return null;
}

function expectedParkingCountFromScaleEvidence(evidenceCandidates) {
  const span = evidenceCandidates.find((candidate) => /parking_bay_span/.test(candidate.id));
  if (span?.diagnostic?.note) {
    const match = span.diagnostic.note.match(/(\d+)\s+visible parking bay/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function topImagePathForObservation() {
  return null;
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

function bboxPolygon([x, y, width, height]) {
  return [
    [round(x), round(y)],
    [round(x + width), round(y)],
    [round(x + width), round(y + height)],
    [round(x), round(y + height)],
    [round(x), round(y)]
  ];
}

function normalizePolygon(points = []) {
  return (points || []).map((point) => [round(point[0]), round(point[1])]);
}

function normalizeBbox(bbox) {
  return [round(bbox[0]), round(bbox[1]), round(bbox[2]), round(bbox[3])];
}

function bboxArea(bbox) {
  if (!bbox) return 0;
  return Math.max(0, bbox[2] || 0) * Math.max(0, bbox[3] || 0);
}

function bboxCenter(bbox) {
  return [bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2];
}

function bboxUnion(bboxes = []) {
  const valid = bboxes.filter(Boolean);
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((bbox) => bbox[0]));
  const minY = Math.min(...valid.map((bbox) => bbox[1]));
  const maxX = Math.max(...valid.map((bbox) => bbox[0] + bbox[2]));
  const maxY = Math.max(...valid.map((bbox) => bbox[1] + bbox[3]));
  return [minX, minY, maxX - minX, maxY - minY];
}

function clipBbox(bbox, frame) {
  const minX = Math.max(frame[0], bbox[0]);
  const minY = Math.max(frame[1], bbox[1]);
  const maxX = Math.min(frame[0] + frame[2], bbox[0] + bbox[2]);
  const maxY = Math.min(frame[1] + frame[3], bbox[1] + bbox[3]);
  return [minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY)];
}

function intersectionArea(a, b) {
  if (!a || !b) return 0;
  const minX = Math.max(a[0], b[0]);
  const minY = Math.max(a[1], b[1]);
  const maxX = Math.min(a[0] + a[2], b[0] + b[2]);
  const maxY = Math.min(a[1] + a[3], b[1] + b[3]);
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
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

function overlapByClass(regions, classA, classB) {
  const left = regions.filter((region) => region.class === classA);
  const right = regions.filter((region) => region.class === classB);
  let total = 0;
  for (const a of left) {
    for (const b of right) total += intersectionArea(a.bbox_px, b.bbox_px);
  }
  return total;
}

function sortedUnique(values) {
  return [...new Set(values.map((value) => round(value)).filter(Number.isFinite))].sort((a, b) => a - b);
}

function issue(severity, ruleId, message, evidence = {}) {
  return {
    severity,
    type: ruleId,
    rule_id: ruleId,
    message,
    evidence
  };
}

function relativeError(value, expected) {
  const denominator = Math.max(0.000001, Math.abs(expected));
  return Math.abs(value - expected) / denominator;
}

function average(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function max(values = []) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : 0;
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}
