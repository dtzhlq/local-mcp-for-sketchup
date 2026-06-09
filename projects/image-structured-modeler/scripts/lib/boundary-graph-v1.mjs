import path from 'node:path';
import sharp from 'sharp';
import { repoRoot } from './image-analysis.mjs';
import { boundaryEdgesFromHighContrastEdgeV1 } from './high-contrast-edge-v1.mjs';
import { boundaryEdgesFromOpenCvEdgeV1 } from './opencv-edge-v1.mjs';

export const BOUNDARY_GRAPH_EDGE_TYPES = [
  'site_boundary_edge',
  'road_boundary_edge',
  'paved_green_edge',
  'parking_envelope_edge',
  'building_exclusion_edge',
  'unknown_boundary_edge'
];

export const BOUNDARY_GRAPH_EDGE_STATES = [
  'observed',
  'completed_occluded',
  'completed_gap',
  'extrapolated_off_frame',
  'weak_inferred'
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

const SERVICE_EXCLUSION_HINTS = new Set(['tank_farm']);
const PARKING_HINTS = new Set(['parking_lot', 'parking_stall_row_north', 'parking_stall_row_south']);
const ROAD_HINTS = new Set(['parking_drive_aisle_center', 'internal_roads']);

export async function annotateObservationSetWithBoundaryGraphV1(observations = {}, options = {}) {
  if (observations.object?.profile !== 'building_group' && observations.object?.type !== 'building_group') return observations;
  if (observations.boundary_graph_v1 && !options.force) return observations;
  const topImage = findTopImage(observations);
  const activeLandCover = observations.land_cover_v1 || null;
  const site = normalizeBbox(activeLandCover?.site_bbox_px
    || findObservation(topImage, 'site_boundary')?.bbox
    || findObservation(topImage, 'building_top_site_boundary')?.bbox
    || topImage?.metrics?.object_bbox
    || [0, 0, topImage?.image?.analysis_width || 1, topImage?.image?.analysis_height || 1]);
  const sourceImageBoundary = await buildSourceImageBoundaryEvidence({
    observations,
    topImage,
    landCover: activeLandCover,
    site,
    options
  }).catch(() => null);
  const boundaryGraph = buildBoundaryGraphV1({
    observations,
    landCover: activeLandCover,
    options: {
      ...options,
      sourceImageBoundary
    }
  });
  return {
    ...observations,
    boundary_graph_v1: boundaryGraph
  };
}

export function buildBoundaryGraphV1({ observations = {}, landCover = null, options = {} } = {}) {
  const topImage = findTopImage(observations);
  const activeLandCover = landCover || observations.land_cover_v1 || null;
  const site = normalizeBbox(activeLandCover?.site_bbox_px
    || findObservation(topImage, 'site_boundary')?.bbox
    || findObservation(topImage, 'building_top_site_boundary')?.bbox
    || topImage?.metrics?.object_bbox
    || [0, 0, topImage?.image?.analysis_width || 1, topImage?.image?.analysis_height || 1]);
  if (!topImage && !activeLandCover) return missingBoundaryGraph();

  const buildingExclusions = buildingExclusionBoxes(topImage);
  const parkingBoxes = parkingBoxesFor(topImage, activeLandCover);
  const sourceImageBoundary = options.sourceImageBoundary || null;
  const highContrastEdge = options.highContrastEdge || observations.high_contrast_edge_v1 || null;
  const openCvEdge = options.openCvEdge || observations.opencv_edge_v1 || null;
  const highContrastBoundaryEdges = boundaryEdgesFromHighContrastEdgeV1(highContrastEdge);
  const openCvBoundaryEdges = boundaryEdgesFromOpenCvEdgeV1(openCvEdge);
  const hasSourceImageEdges = (sourceImageBoundary?.observed_edges || []).length >= 4;
  const observedEdges = hasSourceImageEdges
    ? mergeCollinearEdges([...sourceImageBoundary.observed_edges, ...openCvBoundaryEdges, ...highContrastBoundaryEdges])
    : mergeCollinearEdges([...observedEdgesFromEvidence({
      site,
      topImage,
      landCover: activeLandCover,
      buildingExclusions,
      parkingBoxes
    }), ...openCvBoundaryEdges, ...highContrastBoundaryEdges]);
  const dominantDirections = dominantDirectionsForEdges(observedEdges);
  const completion = completeBoundaryGraph({
    site,
    observedEdges,
    landCover: activeLandCover,
    buildingExclusions,
    parkingBoxes,
    sourceImageBoundary,
    options
  });
  const allEdges = [...observedEdges, ...completion.completed_edges];
  const boundaryLoops = boundaryLoopsFromEdges({ site, allEdges });
  const qa = boundaryGraphQa({
    site,
    observedEdges,
    completedEdges: completion.completed_edges,
    corridorHypotheses: completion.corridor_hypotheses,
    completionHypotheses: completion.completion_hypotheses,
    boundaryLoops,
    buildingExclusions,
    sourceImageBoundary
  });

  return {
    kind: 'boundary_graph_v1',
    version: 1,
    backend: hasSourceImageEdges ? 'source_image_edge_detector_v1' : 'classical_cv_boundary_graph_v1',
    policy: options.completionPolicy || 'aggressive_completion',
    coordinate_convention: 'image_x_right_y_down',
    source_image: topImage?.image?.path || activeLandCover?.source_image || null,
    site_bbox_px: site,
    source_image_boundary: sourceImageBoundary ? {
      backend: sourceImageBoundary.backend,
      edge_pixel_count: sourceImageBoundary.edge_pixel_count,
      candidate_segment_count: sourceImageBoundary.candidate_segment_count,
      accepted_segment_count: sourceImageBoundary.accepted_segment_count,
      source_edge_alignment_ratio: sourceImageBoundary.source_edge_alignment_ratio,
      site_edge_detection_ratio: sourceImageBoundary.site_edge_detection_ratio,
      bbox_fallback_used: !hasSourceImageEdges
    } : null,
    high_contrast_edge_v1: highContrastEdge?.kind === 'high_contrast_edge_v1' ? {
      available: true,
      backend: highContrastEdge.backend || null,
      accepted_edge_count: highContrastEdge.qa?.accepted_edge_count || 0,
      rejected_edge_count: highContrastEdge.qa?.rejected_edge_count || 0,
      site_perimeter_confidence: highContrastEdge.qa?.site_perimeter_confidence ?? 0,
      road_boundary_confidence: highContrastEdge.qa?.road_boundary_confidence ?? 0,
      boundary_edge_count: highContrastBoundaryEdges.length
    } : {
      available: false,
      reason: 'ObservationSet.high_contrast_edge_v1 missing; BoundaryGraph used source-image gradient detector only.'
    },
    opencv_edge_v1: openCvEdge?.kind === 'opencv_edge_v1' ? {
      available: openCvEdge.backend !== 'unavailable',
      backend: openCvEdge.backend || null,
      opencv_version: openCvEdge.opencv_version || null,
      accepted_edge_count: openCvEdge.qa?.accepted_edge_count || 0,
      rejected_edge_count: openCvEdge.qa?.rejected_edge_count || 0,
      site_perimeter_confidence: openCvEdge.qa?.site_perimeter_confidence ?? 0,
      road_boundary_confidence: openCvEdge.qa?.road_boundary_confidence ?? 0,
      boundary_edge_count: openCvBoundaryEdges.length
    } : {
      available: false,
      reason: 'ObservationSet.opencv_edge_v1 missing; BoundaryGraph used source-image gradient detector and JS fallback only.'
    },
    dominant_directions: dominantDirections,
    observed_edges: observedEdges,
    completed_edges: completion.completed_edges,
    boundary_loops: boundaryLoops,
    corridor_hypotheses: completion.corridor_hypotheses,
    completion_hypotheses: completion.completion_hypotheses,
    qa,
    correction_targets: correctionTargetsFromBoundaryQa(qa),
    notes: [
      'BoundaryGraph v1 turns R11 land-cover and top-view edge evidence into vector boundaries.',
      'Aggressive completion may expose inferred geometry, but every completed/extrapolated edge remains traceable and reviewable.'
    ]
  };
}

export function boundaryGraphReport(boundaryGraph = {}) {
  return {
    kind: 'boundary_graph_v1_report',
    version: 1,
    ok: boundaryGraph.qa?.ok === true,
    verdict: boundaryGraph.qa?.verdict || 'fail',
    boundary_graph_v1: boundaryGraph,
    summary: {
      backend: boundaryGraph.backend || null,
      source_image: boundaryGraph.source_image || null,
      observed_edges: boundaryGraph.observed_edges?.length || 0,
      completed_edges: boundaryGraph.completed_edges?.length || 0,
      boundary_loops: boundaryGraph.boundary_loops?.length || 0,
      source_image_backend: boundaryGraph.source_image_boundary?.backend || null,
      source_edge_alignment_ratio: boundaryGraph.qa?.source_edge_alignment_ratio ?? 0,
      site_edge_detection_ratio: boundaryGraph.qa?.site_edge_detection_ratio ?? 0,
      bbox_fallback_edge_ratio: boundaryGraph.qa?.bbox_fallback_edge_ratio ?? 1,
      source_edge_pixel_count: boundaryGraph.source_image_boundary?.edge_pixel_count || 0,
      high_contrast_edge_available: boundaryGraph.high_contrast_edge_v1?.available === true,
      high_contrast_boundary_edge_count: boundaryGraph.high_contrast_edge_v1?.boundary_edge_count || 0,
      high_contrast_site_perimeter_confidence: boundaryGraph.high_contrast_edge_v1?.site_perimeter_confidence ?? 0,
      high_contrast_road_boundary_confidence: boundaryGraph.high_contrast_edge_v1?.road_boundary_confidence ?? 0,
      opencv_edge_available: boundaryGraph.opencv_edge_v1?.available === true,
      opencv_boundary_edge_count: boundaryGraph.opencv_edge_v1?.boundary_edge_count || 0,
      opencv_version: boundaryGraph.opencv_edge_v1?.opencv_version || null,
      opencv_site_perimeter_confidence: boundaryGraph.opencv_edge_v1?.site_perimeter_confidence ?? 0,
      opencv_road_boundary_confidence: boundaryGraph.opencv_edge_v1?.road_boundary_confidence ?? 0,
      road_corridor_count: boundaryGraph.qa?.road_corridor_count || 0,
      site_boundary_closure_ratio: boundaryGraph.qa?.site_boundary_closure_ratio ?? 0,
      observed_edge_coverage_ratio: boundaryGraph.qa?.observed_edge_coverage_ratio ?? 0,
      completed_edge_ratio: boundaryGraph.qa?.completed_edge_ratio ?? 0,
      extrapolated_edge_ratio: boundaryGraph.qa?.extrapolated_edge_ratio ?? 0,
      mean_corridor_width_residual: boundaryGraph.qa?.mean_corridor_width_residual ?? 1,
      max_boundary_snap_delta: boundaryGraph.qa?.max_boundary_snap_delta ?? 1,
      conflicting_hypothesis_count: boundaryGraph.qa?.conflicting_hypothesis_count || 0,
      inferred_geometry_area_ratio: boundaryGraph.qa?.inferred_geometry_area_ratio ?? 0,
      extrapolated_geometry_area_ratio: boundaryGraph.qa?.extrapolated_geometry_area_ratio ?? 0
    },
    issues: boundaryGraph.qa?.issues || [],
    correction_targets: boundaryGraph.correction_targets || []
  };
}

export function makeSyntheticBoundaryGraphFixture(kind = 'occluded_industrial_campus') {
  const site = [0, 0, 320, 220];
  const base = {
    kind: 'bird_eye_land_cover_v1',
    version: 1,
    backend: 'programmatic_boundary_fixture_v1',
    source_image: `synthetic://${kind}`,
    site_bbox_px: site,
    tiles: [],
    masks: [
      mask('fixture_building_a', 'building_footprint', [90, 55, 70, 95]),
      mask('fixture_building_b', 'building_footprint', [190, 55, 70, 95]),
      mask('fixture_road_top', 'road_surface_candidate', [20, 25, 280, 28]),
      mask('fixture_road_mid', 'road_surface_candidate', [20, 152, 280, 30]),
      mask('fixture_parking', 'parking_surface_candidate', [205, 155, 85, 45])
    ],
    qa: { ok: true, verdict: 'pass', paved_surface_ratio: 0.22, vegetation_ratio: 0.1, unknown_land_cover_ratio: 0.04 }
  };
  if (kind === 'partial_off_frame_road') {
    base.masks = [
      mask('fixture_building', 'building_footprint', [65, 50, 80, 105]),
      mask('fixture_off_frame_road', 'road_surface_candidate', [0, 152, 270, 32]),
      mask('fixture_green', 'vegetation_low', [0, 0, 320, 34])
    ];
  } else if (kind === 'single_edge_parking') {
    base.masks = [
      mask('fixture_store', 'building_footprint', [24, 35, 95, 72]),
      mask('fixture_parking_big', 'parking_surface_candidate', [145, 48, 145, 115]),
      mask('fixture_drive', 'road_surface_candidate', [18, 140, 282, 34])
    ];
  } else if (kind === 'roof_seam_negative') {
    base.masks = [
      mask('fixture_roof', 'building_footprint', [72, 46, 170, 120]),
      mask('fixture_paved', 'paved_surface', [0, 170, 320, 38])
    ];
  }
  const observations = {
    object: { type: 'building_group', profile: 'building_group' },
    images: [{
      detected_view: { kind: 'top' },
      image: { path: base.source_image, analysis_width: site[2], analysis_height: site[3] },
      metrics: { object_bbox: site },
      observations: [
        obs('fixture_site', 'site_boundary', site),
        ...base.masks.map((item) => obs(`${item.id}_obs`, hintForClass(item.class, item.id), item.bbox_px))
      ]
    }],
    land_cover_v1: base
  };
  return {
    kind,
    observations,
    boundary_graph_v1: buildBoundaryGraphV1({ observations, landCover: base })
  };
}

async function buildSourceImageBoundaryEvidence({ observations = {}, topImage = null, landCover = null, site = null } = {}) {
  if (!topImage?.image?.path || /^synthetic:\/\//.test(topImage.image.path)) return null;
  const raster = await loadSourceRaster(topImage);
  const resolvedSite = normalizeBbox(site || landCover?.site_bbox_px || topImage.metrics?.object_bbox || [0, 0, raster.width, raster.height]);
  const buildingExclusions = buildingExclusionBoxes(topImage);
  const parkingBoxes = parkingBoxesFor(topImage, landCover);
  const edgeMap = computeSourceEdgeMap({ raster, site: resolvedSite, buildingExclusions });
  const rawSegments = extractSourceBoundarySegments({
    raster,
    edgeMap,
    site: resolvedSite,
    buildingExclusions,
    parkingBoxes,
    landCover
  });
  const siteEdges = sourceSiteBoundaryEdges({ site: resolvedSite, rawSegments, edgeMap, raster });
  const acceptedSegments = rawSegments
    .filter((segment) => segment.length_px >= 32 && segment.source_pixel_support_ratio >= 0.22)
    .sort((a, b) => b.score - a.score || b.length_px - a.length_px)
    .slice(0, 170);
  const observedEdges = [
    ...siteEdges,
    ...acceptedSegments.map((segment, index) => edge(
      `source_image_edge_${index + 1}`,
      segment.type,
      'observed',
      segment.a,
      segment.b,
      {
        method: 'source_image_gradient_line_segment',
        confidence: segment.confidence,
        source_ids: [topImage.image.path],
        inference_level: 'observed',
        class_boundary_hint: segment.class_boundary_hint,
        source_pixel_support_ratio: segment.source_pixel_support_ratio,
        source_edge_strength: segment.source_edge_strength,
        context: segment.context,
        risk_flags: segment.risk_flags
      }
    ))
  ];
  const alignedEdges = observedEdges.filter((edgeItem) => edgeItem.method === 'source_image_gradient_line_segment' || edgeItem.method === 'source_image_site_boundary_fit');
  return {
    kind: 'source_image_boundary_evidence_v1',
    backend: 'source_image_edge_detector_v1',
    coordinate_convention: 'image_x_right_y_down',
    source_image: topImage.image.path,
    site_bbox_px: resolvedSite,
    edge_pixel_count: edgeMap.edge_pixel_count,
    candidate_segment_count: rawSegments.length,
    accepted_segment_count: acceptedSegments.length,
    source_edge_alignment_ratio: round(average(alignedEdges.map((edgeItem) => edgeItem.source_pixel_support_ratio || 0), 0)),
    site_edge_detection_ratio: round(siteEdges.filter((edgeItem) => edgeItem.method === 'source_image_site_boundary_fit').length / 4),
    observed_edges: observedEdges,
    source_segments: acceptedSegments.map((segment) => ({
      id: segment.id,
      axis: segment.axis,
      type: segment.type,
      a: segment.a,
      b: segment.b,
      length_px: segment.length_px,
      source_pixel_support_ratio: segment.source_pixel_support_ratio,
      source_edge_strength: segment.source_edge_strength,
      context: segment.context
    })),
    notes: [
      'These edges are extracted directly from source image gradients and color/vegetation transitions.',
      'Observation bboxes are not used to create observed source edges; they are only used as exclusion/context guards.'
    ],
    _edgeMap: edgeMap,
    _raster: raster
  };
}

async function loadSourceRaster(topImage) {
  const imagePath = path.resolve(repoRoot, topImage.image.path);
  const width = topImage.image.analysis_width || 900;
  const height = topImage.image.analysis_height || Math.round(width * (topImage.image.height || 1) / Math.max(1, topImage.image.width || 1));
  const { data, info } = await sharp(imagePath)
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, channels: info.channels };
}

function computeSourceEdgeMap({ raster, site, buildingExclusions }) {
  const horizontal = new Uint8Array(raster.width * raster.height);
  const vertical = new Uint8Array(raster.width * raster.height);
  const strength = new Float32Array(raster.width * raster.height);
  const [sx, sy, sw, sh] = site;
  const x0 = Math.max(2, Math.floor(sx));
  const y0 = Math.max(2, Math.floor(sy));
  const x1 = Math.min(raster.width - 3, Math.ceil(sx + sw));
  const y1 = Math.min(raster.height - 3, Math.ceil(sy + sh));
  let edgePixelCount = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const hScore = boundaryScoreAcross(raster, x, y, 'h');
      const vScore = boundaryScoreAcross(raster, x, y, 'v');
      const index = y * raster.width + x;
      const localStrength = Math.max(hScore, vScore);
      strength[index] = localStrength;
      const threshold = pointInAnyBbox([x, y], buildingExclusions) ? 54 : 38;
      if (hScore >= threshold && hScore >= vScore * 0.82) {
        horizontal[index] = 1;
        edgePixelCount += 1;
      }
      if (vScore >= threshold && vScore >= hScore * 0.82) {
        vertical[index] = 1;
        edgePixelCount += 1;
      }
    }
  }
  return { width: raster.width, height: raster.height, horizontal, vertical, strength, edge_pixel_count: edgePixelCount };
}

function boundaryScoreAcross(raster, x, y, axis) {
  const a = axis === 'h' ? pixelSample(raster, x, y - 2) : pixelSample(raster, x - 2, y);
  const b = axis === 'h' ? pixelSample(raster, x, y + 2) : pixelSample(raster, x + 2, y);
  const grayDiff = Math.abs(a.gray - b.gray);
  const colorDiff = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const exgDiff = Math.abs(a.exg - b.exg);
  const vegetationTransition = a.vegetation !== b.vegetation;
  const hardscapeTransition = a.hardscape !== b.hardscape;
  const brightLine = Math.max(a.v, b.v) > 0.74 && Math.min(a.s, b.s) < 0.22;
  return grayDiff * 0.62
    + colorDiff * 0.28
    + Math.min(90, exgDiff) * 0.24
    + (vegetationTransition ? 32 : 0)
    + (hardscapeTransition ? 10 : 0)
    + (brightLine ? 8 : 0);
}

function extractSourceBoundarySegments({ raster, edgeMap, site, buildingExclusions, parkingBoxes, landCover }) {
  const horizontalRows = selectSourceLineBands({ edgeMap, site, axis: 'x' });
  const verticalCols = selectSourceLineBands({ edgeMap, site, axis: 'y' });
  const horizontalSegments = horizontalRows.flatMap((y) => segmentsForBand({
    raster,
    edgeMap,
    site,
    axis: 'x',
    fixed: y,
    buildingExclusions,
    parkingBoxes,
    landCover
  }));
  const verticalSegments = verticalCols.flatMap((x) => segmentsForBand({
    raster,
    edgeMap,
    site,
    axis: 'y',
    fixed: x,
    buildingExclusions,
    parkingBoxes,
    landCover
  }));
  return mergeSourceSegments([...horizontalSegments, ...verticalSegments])
    .sort((a, b) => b.score - a.score || b.length_px - a.length_px);
}

function selectSourceLineBands({ edgeMap, site, axis }) {
  const [sx, sy, sw, sh] = site;
  const scores = [];
  if (axis === 'x') {
    for (let y = Math.floor(sy) + 4; y < sy + sh - 4; y += 1) {
      let count = 0;
      for (let x = Math.floor(sx) + 4; x < sx + sw - 4; x += 2) {
        if (edgeAt(edgeMap, x, y, 'h', 2)) count += 1;
      }
      const support = count / Math.max(1, sw / 2);
      if (support >= 0.075) scores.push({ value: y, support });
    }
  } else {
    for (let x = Math.floor(sx) + 4; x < sx + sw - 4; x += 1) {
      let count = 0;
      for (let y = Math.floor(sy) + 4; y < sy + sh - 4; y += 2) {
        if (edgeAt(edgeMap, x, y, 'v', 2)) count += 1;
      }
      const support = count / Math.max(1, sh / 2);
      if (support >= 0.075) scores.push({ value: x, support });
    }
  }
  return nonMaxBands(scores, 6)
    .sort((a, b) => b.support - a.support)
    .slice(0, 54)
    .map((item) => item.value);
}

function nonMaxBands(scores, radius) {
  const sorted = [...scores].sort((a, b) => b.support - a.support);
  const selected = [];
  for (const item of sorted) {
    if (selected.some((existing) => Math.abs(existing.value - item.value) <= radius)) continue;
    selected.push(item);
  }
  return selected.sort((a, b) => a.value - b.value);
}

function segmentsForBand({ raster, edgeMap, site, axis, fixed, buildingExclusions, parkingBoxes, landCover }) {
  const [sx, sy, sw, sh] = site;
  const start = Math.floor(axis === 'x' ? sx : sy);
  const end = Math.ceil(axis === 'x' ? sx + sw : sy + sh);
  const result = [];
  let runStart = null;
  let runVotes = 0;
  let runStrength = 0;
  let lastVoteAt = null;
  const closeRun = (current) => {
    if (runStart === null) return;
    const runEnd = lastVoteAt ?? current;
    const length = runEnd - runStart;
    const support = runVotes / Math.max(1, length / 2);
    if (length >= 34 && support >= 0.18) {
      const a = axis === 'x' ? [runStart, fixed] : [fixed, runStart];
      const b = axis === 'x' ? [runEnd, fixed] : [fixed, runEnd];
      const context = segmentContext({ raster, a, b, axis, buildingExclusions, parkingBoxes, landCover });
      if (context.inside_building_ratio > 0.48 && context.building_transition_ratio < 0.3) {
        runStart = null;
        runVotes = 0;
        runStrength = 0;
        lastVoteAt = null;
        return;
      }
      const type = classifySourceSegment({ a, b, axis, site, context });
      if (!(type === 'unknown_boundary_edge' && context.inside_building_ratio > 0.6)) {
        result.push({
          id: `source_segment_${axis}_${fixed}_${runStart}_${runEnd}`,
          axis,
          type,
          a: a.map((value) => round(value)),
          b: b.map((value) => round(value)),
          length_px: round(length),
          score: round(length * support * (1 + context.transition_score)),
          confidence: round(Math.min(0.93, 0.48 + support * 0.34 + Math.min(0.18, context.transition_score * 0.12))),
          source_pixel_support_ratio: round(Math.min(1, support)),
          source_edge_strength: round(runStrength / Math.max(1, runVotes)),
          class_boundary_hint: context.class_boundary_hint,
          context,
          risk_flags: type === 'unknown_boundary_edge' ? ['weak_source_context'] : []
        });
      }
    }
    runStart = null;
    runVotes = 0;
    runStrength = 0;
    lastVoteAt = null;
  };
  for (let cursor = start + 3; cursor <= end - 3; cursor += 2) {
    const x = axis === 'x' ? cursor : fixed;
    const y = axis === 'x' ? fixed : cursor;
    const vote = edgeAt(edgeMap, x, y, axis === 'x' ? 'h' : 'v', 2);
    if (vote) {
      if (runStart === null) runStart = cursor;
      runVotes += 1;
      runStrength += strengthAt(edgeMap, x, y);
      lastVoteAt = cursor;
      continue;
    }
    if (runStart !== null && lastVoteAt !== null && cursor - lastVoteAt > 18) closeRun(cursor);
  }
  closeRun(end);
  return result;
}

function sourceSiteBoundaryEdges({ site, rawSegments, edgeMap, raster }) {
  const [x, y, w, h] = site;
  const colorFit = raster ? siteBoundaryColorFit({ raster, site }) : {};
  const candidates = {
    top: rawSegments.filter((segment) => segment.axis === 'x' && Math.abs(segment.a[1] - y) <= 42),
    bottom: rawSegments.filter((segment) => segment.axis === 'x' && Math.abs(segment.a[1] - (y + h)) <= 42),
    left: rawSegments.filter((segment) => segment.axis === 'y' && Math.abs(segment.a[0] - x) <= 42),
    right: rawSegments.filter((segment) => segment.axis === 'y' && Math.abs(segment.a[0] - (x + w)) <= 42)
  };
  const best = {
    top: bestRawSiteSide(candidates.top, 'top', site),
    right: bestRawSiteSide(candidates.right, 'right', site),
    bottom: bestRawSiteSide(candidates.bottom, 'bottom', site),
    left: bestRawSiteSide(candidates.left, 'left', site)
  };
  const sideValue = (side, fallback) => {
    const colorCandidate = colorFit[side];
    if (!colorCandidate) return fallback;
    if (side === 'right' && fallback && colorCandidate.value < fallback - 20) return fallback;
    const threshold = side === 'left' || side === 'right' ? 0.065 : 0.04;
    return colorCandidate.support >= threshold ? colorCandidate.value : fallback;
  };
  const topY = sideValue('top', best.top?.a?.[1] ?? y);
  const bottomY = sideValue('bottom', best.bottom?.a?.[1] ?? y + h);
  const leftX = sideValue('left', best.left?.a?.[0] ?? x);
  const rightX = sideValue('right', best.right?.a?.[0] ?? x + w);
  const sideDefs = [
    ['top', best.top, [leftX, topY], [rightX, topY], colorFit.top],
    ['right', best.right, [rightX, topY], [rightX, bottomY], colorFit.right],
    ['bottom', best.bottom, [rightX, bottomY], [leftX, bottomY], colorFit.bottom],
    ['left', best.left, [leftX, bottomY], [leftX, topY], colorFit.left]
  ];
  return sideDefs.map(([side, segment, a, b, colorCandidate], index) => {
    const support = colorCandidate?.value === (side === 'left' || side === 'right' ? a[0] : a[1])
      ? Math.max(colorCandidate.support, segment?.source_pixel_support_ratio || 0)
      : segment?.source_pixel_support_ratio ?? lineSupport(edgeMap, a, b, side === 'top' || side === 'bottom' ? 'h' : 'v');
    return edge(`source_site_boundary_${index + 1}_${side}`, 'site_boundary_edge', segment ? 'observed' : 'weak_inferred', a, b, {
      method: segment || colorCandidate ? 'source_image_site_boundary_fit' : 'site_bbox_boundary_fallback',
      confidence: colorCandidate ? Math.max(0.66, segment?.confidence || 0.5) : segment ? Math.max(0.62, segment.confidence) : 0.38,
      source_ids: segment ? [segment.id, colorCandidate?.id].filter(Boolean) : colorCandidate ? [colorCandidate.id] : ['site_boundary_bbox_fallback'],
      inference_level: segment || colorCandidate ? 'observed' : 'weak_inferred',
      source_pixel_support_ratio: round(support),
      source_edge_strength: segment?.source_edge_strength ?? null,
      context: segment?.context || null,
      risk_flags: segment || colorCandidate ? [] : ['site_boundary_bbox_fallback']
    });
  });
}

function bestRawSiteSide(list = [], side, site) {
  if (!list.length) return null;
  const [x, y, w, h] = site;
  const longEnough = list.filter((segment) => {
    const length = distance(segment.a, segment.b);
    const support = segment.source_pixel_support_ratio || 0;
    const requiredLength = side === 'top' || side === 'bottom' ? w * 0.55 : h * 0.55;
    return length >= requiredLength && support >= 0.75;
  });
  const candidates = longEnough.length ? longEnough : list;
  if (side === 'right') {
    return [...candidates].sort((a, b) => b.a[0] - a.a[0] || b.source_pixel_support_ratio - a.source_pixel_support_ratio)[0] || null;
  }
  if (side === 'left') {
    return [...candidates].sort((a, b) => b.source_pixel_support_ratio - a.source_pixel_support_ratio || a.a[0] - b.a[0])[0] || null;
  }
  if (side === 'bottom') {
    return [...candidates].sort((a, b) => b.a[1] - a.a[1] || b.source_pixel_support_ratio - a.source_pixel_support_ratio)[0] || null;
  }
  if (side === 'top') {
    return [...candidates].sort((a, b) => a.a[1] - b.a[1] || b.source_pixel_support_ratio - a.source_pixel_support_ratio)[0] || null;
  }
  return [...candidates].sort((a, b) => b.length_px * b.source_pixel_support_ratio - a.length_px * a.source_pixel_support_ratio)[0] || null;
}

function siteBoundaryColorFit({ raster, site }) {
  const [x, y, w, h] = site;
  const horizontalStart = Math.max(0, Math.round(x + w * 0.04));
  const horizontalEnd = Math.min(raster.width - 1, Math.round(x + w * 0.96));
  const verticalStart = Math.max(0, Math.round(y + h * 0.04));
  const verticalEnd = Math.min(raster.height - 1, Math.round(y + h * 0.96));
  return {
    top: bestTopOuterBoundaryRow({
      raster,
      y0: Math.max(0, Math.round(y - Math.min(24, h * 0.06))),
      y1: Math.min(raster.height - 1, Math.round(y + Math.min(76, h * 0.16))),
      x0: horizontalStart,
      x1: horizontalEnd,
      preferOuter: 'min',
      id: 'source_site_color_top'
    }),
    bottom: bestColorBoundaryRow({
      raster,
      y0: Math.max(0, Math.round(y + h - Math.min(90, h * 0.18))),
      y1: Math.min(raster.height - 1, Math.round(y + h - 8)),
      x0: horizontalStart,
      x1: horizontalEnd,
      preferOuter: 'max',
      id: 'source_site_color_bottom'
    }),
    left: bestColorBoundaryCol({
      raster,
      x0: Math.max(0, Math.round(x + 8)),
      x1: Math.min(raster.width - 1, Math.round(x + Math.min(105, w * 0.16))),
      y0: verticalStart,
      y1: verticalEnd,
      preferOuter: 'min',
      id: 'source_site_color_left'
    }),
    right: bestColorBoundaryCol({
      raster,
      x0: Math.max(0, Math.round(x + w - Math.min(105, w * 0.16))),
      x1: Math.min(raster.width - 1, Math.round(x + w - 8)),
      y0: verticalStart,
      y1: verticalEnd,
      preferOuter: 'max',
      id: 'source_site_color_right'
    })
  };
}

function bestColorBoundaryRow({ raster, y0, y1, x0, x1, preferOuter, id }) {
  const scored = [];
  for (let yy = y0; yy <= y1; yy += 1) {
    let count = 0;
    let total = 0;
    for (let xx = x0; xx <= x1; xx += 1) {
      total += 1;
      if (siteBoundaryColorPixel(raster, xx, yy)) count += 1;
    }
    const support = count / Math.max(1, total);
    if (support >= 0.012) scored.push({ id, value: yy, support: round(support) });
  }
  if (!scored.length) return null;
  return chooseColorSiteCandidate(scored, preferOuter);
}

function bestTopOuterBoundaryRow({ raster, y0, y1, x0, x1, id }) {
  const scored = [];
  for (let yy = y0; yy <= y1; yy += 1) {
    let colorCount = 0;
    let edgeCount = 0;
    let total = 0;
    for (let xx = x0; xx <= x1; xx += 1) {
      total += 1;
      if (siteBoundaryColorPixel(raster, xx, yy)) colorCount += 1;
      if (boundaryScoreAcross(raster, xx, yy, 'h') > 35) edgeCount += 1;
    }
    const colorSupport = colorCount / Math.max(1, total);
    const edgeSupport = edgeCount / Math.max(1, total);
    const score = colorSupport * 0.7 + edgeSupport * 0.3;
    if (score >= 0.08) scored.push({
      id,
      value: yy,
      support: round(Math.max(colorSupport, score)),
      score: round(score),
      color_support: round(colorSupport),
      edge_support: round(edgeSupport)
    });
  }
  if (!scored.length) return null;
  const maxScore = Math.max(...scored.map((item) => item.score));
  return scored
    .filter((item) => item.score >= Math.max(0.18, maxScore * 0.45) && item.color_support >= 0.08)
    .sort((a, b) => a.value - b.value || b.score - a.score)[0]
    || scored.sort((a, b) => b.score - a.score || a.value - b.value)[0];
}

function bestColorBoundaryCol({ raster, x0, x1, y0, y1, preferOuter, id }) {
  const scored = [];
  for (let xx = x0; xx <= x1; xx += 1) {
    let count = 0;
    let total = 0;
    for (let yy = y0; yy <= y1; yy += 1) {
      total += 1;
      if (siteBoundaryColorPixel(raster, xx, yy)) count += 1;
    }
    const support = count / Math.max(1, total);
    if (support >= 0.012) scored.push({ id, value: xx, support: round(support) });
  }
  if (!scored.length) return null;
  return chooseColorSiteCandidate(scored, preferOuter);
}

function chooseColorSiteCandidate(scored, preferOuter) {
  const maxSupport = Math.max(...scored.map((item) => item.support));
  const viable = scored.filter((item) => item.support >= Math.max(0.025, maxSupport * 0.45));
  if (preferOuter === 'min') return viable.sort((a, b) => a.value - b.value || b.support - a.support)[0];
  if (preferOuter === 'max') return viable.sort((a, b) => b.value - a.value || b.support - a.support)[0];
  return scored.sort((a, b) => b.support - a.support)[0];
}

function siteBoundaryColorPixel(raster, x, y) {
  const sample = pixelSample(raster, x, y);
  return sample.b > 105
    && sample.g > 82
    && sample.b > sample.r + 14
    && sample.g > sample.r + 4
    && sample.s > 0.12
    && sample.s < 0.58
    && sample.v > 0.38;
}

function segmentContext({ raster, a, b, axis, buildingExclusions, parkingBoxes, landCover }) {
  const length = distance(a, b);
  const steps = Math.max(8, Math.min(60, Math.ceil(length / 8)));
  const offset = 6;
  const counts = {
    building_a: 0,
    building_b: 0,
    vegetation_a: 0,
    vegetation_b: 0,
    hardscape_a: 0,
    hardscape_b: 0,
    parking: 0,
    paved_mask: 0,
    road_mask: 0,
    samples: 0
  };
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const pA = axis === 'x' ? [x, y - offset] : [x - offset, y];
    const pB = axis === 'x' ? [x, y + offset] : [x + offset, y];
    const sA = pixelSample(raster, Math.round(pA[0]), Math.round(pA[1]));
    const sB = pixelSample(raster, Math.round(pB[0]), Math.round(pB[1]));
    counts.building_a += pointInAnyBbox(pA, buildingExclusions) ? 1 : 0;
    counts.building_b += pointInAnyBbox(pB, buildingExclusions) ? 1 : 0;
    counts.vegetation_a += sA.vegetation ? 1 : 0;
    counts.vegetation_b += sB.vegetation ? 1 : 0;
    counts.hardscape_a += sA.hardscape ? 1 : 0;
    counts.hardscape_b += sB.hardscape ? 1 : 0;
    counts.parking += pointInAnyBbox([x, y], parkingBoxes) ? 1 : 0;
    counts.paved_mask += pointInLandCover([x, y], landCover, ['paved_surface', 'parking_surface_candidate', 'road_surface_candidate']) ? 1 : 0;
    counts.road_mask += pointInLandCover([x, y], landCover, ['road_surface_candidate']) ? 1 : 0;
    counts.samples += 1;
  }
  const samples = Math.max(1, counts.samples);
  const buildingA = counts.building_a / samples;
  const buildingB = counts.building_b / samples;
  const vegA = counts.vegetation_a / samples;
  const vegB = counts.vegetation_b / samples;
  const hardA = counts.hardscape_a / samples;
  const hardB = counts.hardscape_b / samples;
  const vegetationHardTransition = (vegA > 0.42 && hardB > 0.36) || (vegB > 0.42 && hardA > 0.36);
  const buildingTransition = Math.abs(buildingA - buildingB) > 0.34;
  const classHint = buildingTransition
    ? 'building_exclusion_edge'
    : vegetationHardTransition
      ? 'vegetation_hardscape_transition'
      : counts.parking / samples > 0.35
        ? 'parking_context'
        : counts.road_mask / samples > 0.22
          ? 'road_surface_context'
          : counts.paved_mask / samples > 0.28
            ? 'paved_surface_context'
            : 'source_image_gradient';
  return {
    inside_building_ratio: round(Math.min(1, (counts.building_a + counts.building_b) / (samples * 2))),
    building_transition_ratio: round(Math.abs(buildingA - buildingB)),
    vegetation_hardscape_transition_ratio: round(vegetationHardTransition ? Math.abs(vegA - vegB) + Math.max(hardA, hardB) * 0.5 : 0),
    hardscape_ratio: round((hardA + hardB) / 2),
    vegetation_ratio: round((vegA + vegB) / 2),
    parking_context_ratio: round(counts.parking / samples),
    paved_mask_ratio: round(counts.paved_mask / samples),
    road_mask_ratio: round(counts.road_mask / samples),
    transition_score: round((buildingTransition ? 0.6 : 0) + (vegetationHardTransition ? 0.8 : 0) + Math.max(hardA, hardB) * 0.25),
    class_boundary_hint: classHint
  };
}

function classifySourceSegment({ a, b, axis, site, context }) {
  const nearSite = distanceToSiteEdge([axis === 'x' ? (a[0] + b[0]) / 2 : a[0], axis === 'x' ? a[1] : (a[1] + b[1]) / 2], site) <= 13;
  if (nearSite && (context.vegetation_hardscape_transition_ratio > 0.12 || context.hardscape_ratio > 0.28)) return 'site_boundary_edge';
  if (context.inside_building_ratio > 0.48) return 'building_exclusion_edge';
  if (context.building_transition_ratio > 0.34) return 'building_exclusion_edge';
  if (context.parking_context_ratio > 0.32) return 'parking_envelope_edge';
  if (context.vegetation_hardscape_transition_ratio > 0.18 && context.hardscape_ratio > 0.28) return 'road_boundary_edge';
  if (context.vegetation_hardscape_transition_ratio > 0.1) return 'paved_green_edge';
  if (context.road_mask_ratio > 0.2 || context.hardscape_ratio > 0.58) return 'road_boundary_edge';
  return 'unknown_boundary_edge';
}

function mergeSourceSegments(segments = []) {
  const merged = [];
  for (const segment of segments) {
    const current = merged.find((candidate) => sourceSegmentsCanMerge(candidate, segment));
    if (!current) {
      merged.push({ ...segment });
      continue;
    }
    const currentStart = segment.axis === 'x' ? Math.min(current.a[0], current.b[0]) : Math.min(current.a[1], current.b[1]);
    const currentEnd = segment.axis === 'x' ? Math.max(current.a[0], current.b[0]) : Math.max(current.a[1], current.b[1]);
    const segmentStart = segment.axis === 'x' ? Math.min(segment.a[0], segment.b[0]) : Math.min(segment.a[1], segment.b[1]);
    const segmentEnd = segment.axis === 'x' ? Math.max(segment.a[0], segment.b[0]) : Math.max(segment.a[1], segment.b[1]);
    if (segmentStart - currentEnd > 26 || currentStart - segmentEnd > 26) continue;
    const start = Math.min(currentStart, segmentStart);
    const end = Math.max(currentEnd, segmentEnd);
    const fixedValue = segment.axis === 'x' ? average([current.a[1], segment.a[1]]) : average([current.a[0], segment.a[0]]);
    current.a = segment.axis === 'x' ? [start, fixedValue] : [fixedValue, start];
    current.b = segment.axis === 'x' ? [end, fixedValue] : [fixedValue, end];
    current.length_px = round(end - start);
    current.score = Math.max(current.score, segment.score);
    current.confidence = Math.max(current.confidence, segment.confidence);
    current.source_pixel_support_ratio = round(Math.max(current.source_pixel_support_ratio, segment.source_pixel_support_ratio));
    current.source_edge_strength = round(Math.max(current.source_edge_strength, segment.source_edge_strength));
  }
  return merged.filter((segment) => segment.length_px >= 28);
}

function sourceSegmentsCanMerge(a, b) {
  if (a.axis !== b.axis || a.type !== b.type) return false;
  const fixedA = a.axis === 'x' ? a.a[1] : a.a[0];
  const fixedB = b.axis === 'x' ? b.a[1] : b.a[0];
  if (Math.abs(fixedA - fixedB) > 5) return false;
  const a0 = a.axis === 'x' ? Math.min(a.a[0], a.b[0]) : Math.min(a.a[1], a.b[1]);
  const a1 = a.axis === 'x' ? Math.max(a.a[0], a.b[0]) : Math.max(a.a[1], a.b[1]);
  const b0 = b.axis === 'x' ? Math.min(b.a[0], b.b[0]) : Math.min(b.a[1], b.b[1]);
  const b1 = b.axis === 'x' ? Math.max(b.a[0], b.b[0]) : Math.max(b.a[1], b.b[1]);
  return !(b0 - a1 > 26 || a0 - b1 > 26);
}

function observedEdgesFromEvidence({ site, topImage, landCover, buildingExclusions, parkingBoxes }) {
  const edges = [];
  let index = 1;
  const pushRect = (prefix, type, bbox, options = {}) => {
    for (const side of rectSides(bbox)) {
      edges.push(edge(`${prefix}_${index++}_${side.side}`, type, 'observed', side.a, side.b, {
        method: options.method || 'bbox_boundary_vectorization',
        confidence: options.confidence ?? 0.68,
        source_ids: options.source_ids || [],
        inference_level: 'observed',
        risk_flags: options.risk_flags || [],
        class_boundary_hint: options.class_boundary_hint || null
      }));
    }
  };

  pushRect('site_boundary_edge', 'site_boundary_edge', site, {
    method: 'site_bbox_boundary_prior_plus_visible_edge',
    confidence: 0.76,
    source_ids: ['site_boundary']
  });

  for (const [boxIndex, bbox] of buildingExclusions.entries()) {
    pushRect('building_exclusion_edge', 'building_exclusion_edge', bbox, {
      method: 'building_exclusion_boundary',
      confidence: 0.78,
      source_ids: [`building_exclusion_${boxIndex + 1}`]
    });
  }

  for (const mask of landCover?.masks || []) {
    if (!mask.bbox_px) continue;
    if (mask.class === 'road_surface_candidate') {
      pushRect('road_boundary_edge', 'road_boundary_edge', mask.bbox_px, {
        method: 'land_cover_road_surface_boundary',
        confidence: mask.confidence ?? 0.7,
        source_ids: [mask.id],
        class_boundary_hint: mask.class
      });
    } else if (mask.class === 'parking_surface_candidate') {
      pushRect('parking_envelope_edge', 'parking_envelope_edge', mask.bbox_px, {
        method: 'land_cover_parking_envelope_boundary',
        confidence: mask.confidence ?? 0.68,
        source_ids: [mask.id],
        class_boundary_hint: mask.class
      });
    } else if (mask.class === 'vegetation_low' || mask.class === 'vegetation_tree') {
      pushRect('paved_green_edge', 'paved_green_edge', mask.bbox_px, {
        method: 'land_cover_paved_green_boundary',
        confidence: mask.confidence ?? 0.62,
        source_ids: [mask.id],
        class_boundary_hint: mask.class
      });
    }
  }

  for (const observation of topImage?.observations || []) {
    if (!observation.bbox) continue;
    if (PARKING_HINTS.has(observation.component_hint)) {
      pushRect('parking_observed_edge', 'parking_envelope_edge', observation.bbox, {
        method: observation.grounding?.method || observation.mask?.method || 'parking_observation_boundary',
        confidence: observation.confidence ?? 0.64,
        source_ids: [observation.id]
      });
    } else if (ROAD_HINTS.has(observation.component_hint) && observation.component_hint !== 'internal_roads') {
      pushRect('road_observed_edge', 'road_boundary_edge', observation.bbox, {
        method: observation.grounding?.method || observation.mask?.method || 'road_observation_boundary',
        confidence: observation.confidence ?? 0.64,
        source_ids: [observation.id]
      });
    }
  }

  for (const [boxIndex, bbox] of parkingBoxes.entries()) {
    pushRect('parking_guide_edge', 'parking_envelope_edge', bbox, {
      method: 'parking_guide_boundary',
      confidence: 0.62,
      source_ids: [`parking_guide_${boxIndex + 1}`]
    });
  }

  return mergeCollinearEdges(edges);
}

function completeBoundaryGraph({ site, observedEdges, landCover, buildingExclusions, parkingBoxes, sourceImageBoundary }) {
  const roadMasks = (landCover?.masks || []).filter((maskItem) => maskItem.class === 'road_surface_candidate' && bboxArea(maskItem.bbox_px) >= 220);
  const parkingMasks = (landCover?.masks || []).filter((maskItem) => maskItem.class === 'parking_surface_candidate');
  const obstacles = [
    ...buildingExclusions.map((bbox, index) => ({ id: `building_exclusion_${index + 1}`, class: 'building_footprint', bbox })),
    ...parkingBoxes.map((bbox, index) => ({ id: `parking_box_${index + 1}`, class: 'parking', bbox }))
  ];
  const completedEdges = [];
  const completionHypotheses = [];
  const corridorHypotheses = [];
  let edgeIndex = 1;
  let hypothesisIndex = 1;

  const addCorridor = (bbox, sourceMask, inferenceLevel, reason, confidence, options = {}) => {
    const clipped = clipBbox(bbox, site);
    if (bboxArea(clipped) < 500) return null;
    const buildingOverlap = obstacles
      .filter((item) => item.class === 'building_footprint')
      .reduce((sum, item) => sum + intersectionArea(clipped, item.bbox), 0);
    if (buildingOverlap > 0) return null;
    const parkingOverlap = obstacles
      .filter((item) => item.class === 'parking')
      .reduce((sum, item) => sum + intersectionArea(clipped, item.bbox), 0);
    if (parkingOverlap / Math.max(1, bboxArea(clipped)) > 0.1) return null;
    if (corridorHypotheses.some((hypothesis) => intersectionArea(clipped, hypothesis.bbox_px) / Math.max(1, Math.min(bboxArea(clipped), bboxArea(hypothesis.bbox_px))) > 0.55)) return null;
    const axis = clipped[2] >= clipped[3] ? 'x' : 'y';
    const width = Math.min(clipped[2], clipped[3]);
    const length = Math.max(clipped[2], clipped[3]);
    if (length / Math.max(1, width) < 1.55 && inferenceLevel !== 'completed_occluded') return null;
    const landCoverSupport = landCoverSupportRatio(landCover, clipped, ['road_surface_candidate', 'paved_surface', 'parking_surface_candidate']);
    const completionId = `boundary_completion_${hypothesisIndex++}`;
    const edgeIds = rectSides(clipped).map((side) => {
      const state = inferenceLevel === 'observed' ? 'completed_gap' : inferenceLevel;
      const id = `boundary_completed_edge_${edgeIndex++}_${side.side}`;
      completedEdges.push(edge(id, 'road_boundary_edge', state, side.a, side.b, {
        method: 'hypothesis_completion_solver',
        confidence,
        source_ids: [sourceMask?.id, ...(options.source_ids || [])].filter(Boolean),
        inference_level: state,
        completion_hypothesis_id: completionId,
        completion_reason: reason,
        risk_flags: riskFlagsForInference(state, landCoverSupport)
      }));
      return id;
    });
    const widthResidual = options.width_residual ?? widthResidualFor(width, corridorHypotheses, site);
    const hypothesis = {
      id: completionId,
      kind: 'road_corridor',
      state: inferenceLevel,
      inference_level: inferenceLevel,
      bbox_px: normalizeBbox(clipped),
      polygon_px: bboxPolygon(clipped),
      axis,
      width_px: round(width),
      length_px: round(length),
      source_mask_id: sourceMask?.id || null,
      observed_endpoint_ids: options.observed_endpoint_ids || observedEdges
        .filter((edgeItem) => edgeTouchesBbox(edgeItem, clipped, 2))
        .slice(0, 4)
        .map((edgeItem) => edgeItem.id),
      occluder_type: options.occluder_type || null,
      completion_length_px: round(length),
      direction_residual: options.direction_residual ?? 0.08,
      width_residual: round(widthResidual),
      land_cover_support_ratio: round(landCoverSupport),
      confidence,
      grounding_decision: inferenceLevel === 'completed_occluded' && confidence >= 0.66 ? 'promoted_geometry' : 'review_candidate',
      review_required: !(inferenceLevel === 'completed_occluded' && confidence >= 0.66),
      risk_flags: riskFlagsForInference(inferenceLevel, landCoverSupport),
      boundary_graph_edge_ids: edgeIds,
      completion_reason: reason
    };
    corridorHypotheses.push(hypothesis);
    completionHypotheses.push(hypothesis);
    return hypothesis;
  };

  if ((sourceImageBoundary?.observed_edges || []).length >= 4) {
    const sourceCorridors = corridorsFromSourceEdgePairs({
      observedEdges,
      site,
      obstacles,
      landCover
    });
    for (const corridor of sourceCorridors) {
      addCorridor(corridor.bbox_px, corridor.sourceMask, corridor.inference_level, corridor.reason, corridor.confidence, {
        observed_endpoint_ids: corridor.observed_endpoint_ids,
        direction_residual: corridor.direction_residual,
        width_residual: corridor.width_residual,
        source_ids: corridor.source_ids
      });
    }
    if (corridorHypotheses.length < 2) {
      for (const corridor of singleEdgeSourceCorridors({ observedEdges, site, obstacles }).slice(0, 4)) {
        addCorridor(corridor.bbox_px, null, 'weak_inferred', corridor.reason, corridor.confidence, {
          observed_endpoint_ids: corridor.observed_endpoint_ids,
          direction_residual: corridor.direction_residual,
          source_ids: corridor.source_ids
        });
      }
    }
  } else {
    for (const maskItem of roadMasks) {
      const maskBox = normalizeBbox(maskItem.bbox_px);
      const fragments = splitRoadMaskIntoCorridors(maskBox, obstacles, site);
      for (const fragment of fragments) {
        const state = fragment.inference_level || (fragment.occluder_type ? 'completed_occluded' : 'weak_inferred');
        addCorridor(fragment.bbox_px, maskItem, state, fragment.reason, fragment.confidence, {
          occluder_type: fragment.occluder_type,
          direction_residual: fragment.direction_residual
        });
      }
    }

    for (const maskItem of parkingMasks) {
      const [x, y, w, h] = normalizeBbox(maskItem.bbox_px);
      addCorridor([x, y - Math.max(16, h * 0.12), w, Math.max(16, h * 0.16)], maskItem, 'weak_inferred', 'single parking envelope edge implies adjacent drive corridor', 0.53, {
        direction_residual: 0.12
      });
    }
  }

  const offFrameEdges = rectSides(site)
    .filter((side) => side.a[0] <= site[0] || side.a[1] <= site[1] || side.b[0] >= site[0] + site[2] || side.b[1] >= site[1] + site[3])
    .slice(0, 1);
  for (const side of offFrameEdges) {
    const completionId = `boundary_completion_${hypothesisIndex++}`;
    completedEdges.push(edge(`boundary_extrapolated_edge_${edgeIndex++}_${side.side}`, 'site_boundary_edge', 'extrapolated_off_frame', side.a, side.b, {
      method: 'site_boundary_off_frame_extrapolation',
      confidence: 0.46,
      source_ids: ['site_boundary'],
      inference_level: 'extrapolated_off_frame',
      completion_hypothesis_id: completionId,
      completion_reason: 'site boundary touches analysis frame and may continue off-frame',
      risk_flags: ['off_frame_extrapolation']
    }));
    completionHypotheses.push({
      id: completionId,
      kind: 'site_boundary_completion',
      state: 'extrapolated_off_frame',
      inference_level: 'extrapolated_off_frame',
      bbox_px: lineBbox(side.a, side.b),
      polygon_px: [side.a, side.b],
      observed_endpoint_ids: observedEdges
        .filter((edgeItem) => edgeItem.type === 'site_boundary_edge')
        .slice(0, 2)
        .map((edgeItem) => edgeItem.id),
      occluder_type: 'off_frame',
      completion_length_px: round(distance(side.a, side.b)),
      direction_residual: 0,
      width_residual: 0,
      land_cover_support_ratio: 1,
      confidence: 0.46,
      review_required: true,
      risk_flags: ['off_frame_extrapolation'],
      completion_reason: 'site boundary touches analysis frame and may continue off-frame'
    });
  }

  return {
    completed_edges: mergeCollinearEdges(completedEdges),
    completion_hypotheses: completionHypotheses,
    corridor_hypotheses: corridorHypotheses
  };
}

function corridorsFromSourceEdgePairs({ observedEdges, site, obstacles, landCover }) {
  const sourceEdges = observedEdges
    .filter((edgeItem) => edgeItem.state === 'observed')
    .filter((edgeItem) => ['road_boundary_edge', 'paved_green_edge', 'unknown_boundary_edge', 'parking_envelope_edge'].includes(edgeItem.type))
    .filter((edgeItem) => distance(edgeItem.a, edgeItem.b) >= 48)
    .filter((edgeItem) => !edgeItem.risk_flags?.includes('site_boundary_bbox_fallback'));
  const horizontal = sourceEdges.filter((edgeItem) => isHorizontalEdge(edgeItem));
  const vertical = sourceEdges.filter((edgeItem) => !isHorizontalEdge(edgeItem));
  const candidates = [
    ...parallelCorridorsForEdges({ edges: horizontal, axis: 'x', site, obstacles, landCover }),
    ...parallelCorridorsForEdges({ edges: vertical, axis: 'y', site, obstacles, landCover })
  ];
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate, index, all) => all.findIndex((other) => (
      intersectionArea(candidate.bbox_px, other.bbox_px) / Math.max(1, Math.min(bboxArea(candidate.bbox_px), bboxArea(other.bbox_px))) > 0.52
    )) === index)
    .slice(0, 12);
}

function parallelCorridorsForEdges({ edges, axis, site, obstacles, landCover }) {
  const result = [];
  const minWidth = Math.max(16, Math.min(site[2], site[3]) * 0.026);
  const maxWidth = Math.max(52, Math.min(site[2], site[3]) * 0.13);
  for (let index = 0; index < edges.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < edges.length; otherIndex += 1) {
      const a = edges[index];
      const b = edges[otherIndex];
      const separation = axis === 'x' ? Math.abs(a.a[1] - b.a[1]) : Math.abs(a.a[0] - b.a[0]);
      if (separation < minWidth || separation > maxWidth) continue;
      const overlap = edgeProjectionOverlap(a, b, axis);
      if (overlap.length < 54) continue;
      const bbox = axis === 'x'
        ? normalizeBbox([overlap.start, Math.min(a.a[1], b.a[1]), overlap.length, separation])
        : normalizeBbox([Math.min(a.a[0], b.a[0]), overlap.start, separation, overlap.length]);
      const area = bboxArea(bbox);
      if (area < 650) continue;
      const buildingOverlap = obstacles
        .filter((item) => item.class === 'building_footprint')
        .reduce((sum, item) => sum + intersectionArea(bbox, item.bbox), 0);
      if (buildingOverlap / Math.max(1, area) > 0.005) continue;
      const landSupport = landCoverSupportRatio(landCover, bbox, ['road_surface_candidate', 'paved_surface', 'parking_surface_candidate']);
      const pairSupport = average([a.source_pixel_support_ratio || 0.35, b.source_pixel_support_ratio || 0.35]);
      const widthResidual = Math.min(0.5, Math.abs(separation - Math.min(site[2], site[3]) * 0.055) / Math.max(1, Math.min(site[2], site[3]) * 0.055));
      const typeBonus = (a.type === 'road_boundary_edge' ? 0.2 : 0) + (b.type === 'road_boundary_edge' ? 0.2 : 0);
      result.push({
        bbox_px: bbox,
        inference_level: pairSupport > 0.38 && landSupport > 0.3 ? 'completed_occluded' : 'completed_gap',
        reason: 'road corridor fitted from source-image parallel boundary pair',
        confidence: round(Math.min(0.82, 0.48 + pairSupport * 0.34 + landSupport * 0.16 + typeBonus)),
        observed_endpoint_ids: [a.id, b.id],
        source_ids: [a.id, b.id],
        direction_residual: 0.035,
        width_residual: round(widthResidual),
        score: round(overlap.length * pairSupport * (0.7 + landSupport))
      });
    }
  }
  return result;
}

function singleEdgeSourceCorridors({ observedEdges, site, obstacles }) {
  const defaultWidth = Math.max(20, Math.min(site[2], site[3]) * 0.055);
  return observedEdges
    .filter((edgeItem) => edgeItem.state === 'observed' && ['road_boundary_edge', 'paved_green_edge'].includes(edgeItem.type))
    .filter((edgeItem) => distance(edgeItem.a, edgeItem.b) >= 88)
    .map((edgeItem) => {
      const horizontal = isHorizontalEdge(edgeItem);
      const bbox = horizontal
        ? normalizeBbox([Math.min(edgeItem.a[0], edgeItem.b[0]), edgeItem.a[1] - defaultWidth / 2, Math.abs(edgeItem.a[0] - edgeItem.b[0]), defaultWidth])
        : normalizeBbox([edgeItem.a[0] - defaultWidth / 2, Math.min(edgeItem.a[1], edgeItem.b[1]), defaultWidth, Math.abs(edgeItem.a[1] - edgeItem.b[1])]);
      const buildingOverlap = obstacles
        .filter((item) => item.class === 'building_footprint')
        .reduce((sum, item) => sum + intersectionArea(bbox, item.bbox), 0);
      return {
        bbox_px: clipBbox(bbox, site),
        reason: 'single source-image road/green boundary edge implies weak corridor',
        confidence: 0.5,
        observed_endpoint_ids: [edgeItem.id],
        source_ids: [edgeItem.id],
        direction_residual: 0.11,
        building_overlap: buildingOverlap
      };
    })
    .filter((item) => item.building_overlap / Math.max(1, bboxArea(item.bbox_px)) <= 0.005)
    .sort((a, b) => bboxArea(b.bbox_px) - bboxArea(a.bbox_px));
}

function splitRoadMaskIntoCorridors(maskBox, obstacles, site) {
  const [x, y, w, h] = maskBox;
  const minSiteEdge = Math.min(site[2], site[3]);
  const result = [];
  const horizontal = w >= h;
  const xBreaks = sortedUnique([x, x + w, ...obstacles.flatMap((item) => [item.bbox[0], item.bbox[0] + item.bbox[2]])]
    .filter((value) => value >= x && value <= x + w));
  const yBreaks = sortedUnique([y, y + h, ...obstacles.flatMap((item) => [item.bbox[1], item.bbox[1] + item.bbox[3]])]
    .filter((value) => value >= y && value <= y + h));
  for (let yi = 0; yi < yBreaks.length - 1; yi += 1) {
    for (let xi = 0; xi < xBreaks.length - 1; xi += 1) {
      const cell = normalizeBbox([xBreaks[xi], yBreaks[yi], xBreaks[xi + 1] - xBreaks[xi], yBreaks[yi + 1] - yBreaks[yi]]);
      const area = bboxArea(cell);
      if (area < 500) continue;
      const buildingOverlap = obstacles
        .filter((item) => item.class === 'building_footprint')
        .reduce((sum, item) => sum + intersectionArea(cell, item.bbox), 0);
      if (buildingOverlap > 0) continue;
      const parkingOverlap = obstacles
        .filter((item) => item.class === 'parking')
        .reduce((sum, item) => sum + intersectionArea(cell, item.bbox), 0);
      if (parkingOverlap / Math.max(1, area) > 0.1) continue;
      const longEdge = Math.max(cell[2], cell[3]);
      const shortEdge = Math.min(cell[2], cell[3]);
      if (longEdge / Math.max(1, shortEdge) < 1.45) continue;
      if (shortEdge > minSiteEdge * 0.18) continue;
      const occluder = obstacles.find((item) => bboxTouches(cell, item.bbox, 2) && item.class === 'building_footprint');
      const touchesMaskEdge = Math.abs(cell[0] - x) <= 0.5
        || Math.abs(cell[1] - y) <= 0.5
        || Math.abs(cell[0] + cell[2] - (x + w)) <= 0.5
        || Math.abs(cell[1] + cell[3] - (y + h)) <= 0.5;
      result.push({
        bbox_px: cell,
        inference_level: occluder ? 'completed_occluded' : touchesMaskEdge ? 'weak_inferred' : 'completed_gap',
        reason: occluder
          ? `road corridor completed around ${occluder.id} occlusion`
          : horizontal ? 'road corridor inferred from horizontal hardscape boundary graph' : 'road corridor inferred from vertical hardscape boundary graph',
        occluder_type: occluder?.class || null,
        direction_residual: horizontal === (cell[2] >= cell[3]) ? 0.04 : 0.16,
        confidence: occluder ? 0.68 : touchesMaskEdge ? 0.58 : 0.62
      });
    }
  }
  return mergeCorridorFragments(result)
    .sort((a, b) => bboxArea(b.bbox_px) - bboxArea(a.bbox_px))
    .slice(0, 9);
}

function mergeCorridorFragments(fragments = []) {
  const sorted = [...fragments].sort((a, b) => a.bbox_px[1] - b.bbox_px[1] || a.bbox_px[0] - b.bbox_px[0]);
  const merged = [];
  for (const item of sorted) {
    const existing = merged.find((candidate) => sameCorridorBand(candidate.bbox_px, item.bbox_px));
    if (!existing) {
      merged.push({ ...item, bbox_px: normalizeBbox(item.bbox_px) });
      continue;
    }
    existing.bbox_px = normalizeBbox(bboxUnion([existing.bbox_px, item.bbox_px]));
    existing.confidence = round(Math.max(existing.confidence, item.confidence));
    existing.inference_level = strongerInference(existing.inference_level, item.inference_level);
    existing.reason = `${existing.reason}; ${item.reason}`;
  }
  return merged;
}

function sameCorridorBand(a, b) {
  const horizontal = a[2] >= a[3] && b[2] >= b[3];
  const vertical = a[3] > a[2] && b[3] > b[2];
  if (horizontal) {
    const yOverlap = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return yOverlap / Math.max(1, Math.min(a[3], b[3])) >= 0.65 && bboxTouches(a, b, 2);
  }
  if (vertical) {
    const xOverlap = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    return xOverlap / Math.max(1, Math.min(a[2], b[2])) >= 0.65 && bboxTouches(a, b, 2);
  }
  return false;
}

function strongerInference(a, b) {
  const order = ['observed', 'completed_occluded', 'completed_gap', 'weak_inferred', 'extrapolated_off_frame'];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

function boundaryLoopsFromEdges({ site, allEdges }) {
  const siteEdges = allEdges.filter((edgeItem) => edgeItem.type === 'site_boundary_edge');
  const observedSiteEdges = siteEdges.filter((edgeItem) => edgeItem.state === 'observed');
  const perimeter = 2 * site[2] + 2 * site[3];
  return [{
    id: 'site_boundary_loop_1',
    type: 'site_boundary',
    polygon_px: bboxPolygon(site),
    edge_ids: siteEdges.map((edgeItem) => edgeItem.id),
    observed_edge_ids: observedSiteEdges.map((edgeItem) => edgeItem.id),
    closure_ratio: round(Math.min(1, edgeLength(siteEdges) / Math.max(1, perimeter))),
    observed_ratio: round(Math.min(1, edgeLength(observedSiteEdges) / Math.max(1, perimeter))),
    inference_level: observedSiteEdges.length >= 3 ? 'observed_plus_completion' : 'weak_inferred',
    review_required: observedSiteEdges.length < 4
  }];
}

function boundaryGraphQa({
  site,
  observedEdges,
  completedEdges,
  corridorHypotheses,
  completionHypotheses,
  boundaryLoops,
  buildingExclusions,
  sourceImageBoundary
}) {
  const siteArea = bboxArea(site);
  const perimeter = 2 * site[2] + 2 * site[3];
  const observedLength = edgeLength(observedEdges.filter((edgeItem) => edgeItem.type !== 'building_exclusion_edge'));
  const completedLength = edgeLength(completedEdges);
  const extrapolatedLength = edgeLength(completedEdges.filter((edgeItem) => edgeItem.state === 'extrapolated_off_frame'));
  const corridorArea = corridorHypotheses.reduce((sum, item) => sum + bboxArea(item.bbox_px), 0);
  const inferredArea = corridorHypotheses
    .filter((item) => ['weak_inferred', 'completed_gap', 'completed_occluded'].includes(item.inference_level))
    .reduce((sum, item) => sum + bboxArea(item.bbox_px), 0);
  const extrapolatedArea = completionHypotheses
    .filter((item) => item.inference_level === 'extrapolated_off_frame')
    .reduce((sum, item) => sum + bboxArea(item.bbox_px || [0, 0, 0, 0]), 0);
  const roadBuildingOverlap = corridorHypotheses.reduce((sum, corridor) => (
    sum + buildingExclusions.reduce((inner, building) => inner + intersectionArea(corridor.bbox_px, building), 0)
  ), 0);
  const widthResiduals = corridorHypotheses.map((item) => item.width_residual || 0);
  const snapDeltas = corridorHypotheses.map((item) => Math.min(item.width_px || 0, 24) / Math.max(1, Math.min(site[2], site[3])));
  const bboxFallbackEdges = observedEdges.filter((edgeItem) => /bbox|prior/.test(edgeItem.method || '') && edgeItem.method !== 'source_image_site_boundary_fit');
  const bboxFallbackEdgeRatio = bboxFallbackEdges.length / Math.max(1, observedEdges.length);
  const sourceEdgeAlignmentRatio = sourceImageBoundary?.source_edge_alignment_ratio
    ?? average(observedEdges.map((edgeItem) => edgeItem.source_pixel_support_ratio).filter((value) => Number.isFinite(value)), 0);
  const siteEdgeDetectionRatio = sourceImageBoundary?.site_edge_detection_ratio
    ?? observedEdges.filter((edgeItem) => edgeItem.type === 'site_boundary_edge' && edgeItem.method === 'source_image_site_boundary_fit').length / 4;
  const hardReasons = [
    ...(roadBuildingOverlap > 0.005 * siteArea ? ['completed_corridor_crosses_building_exclusion'] : [])
  ];
  const reviewReasons = [
    ...(inferredArea / Math.max(1, siteArea) > 0.28 ? ['inferred_geometry_area_above_review_threshold'] : []),
    ...(extrapolatedArea / Math.max(1, siteArea) > 0.12 ? ['extrapolated_geometry_area_above_review_threshold'] : []),
    ...(average(widthResiduals, 0) > 0.35 ? ['corridor_width_residual_above_review_threshold'] : []),
    ...(sourceImageBoundary && sourceEdgeAlignmentRatio < 0.24 ? ['source_edge_alignment_below_review_threshold'] : []),
    ...(sourceImageBoundary && siteEdgeDetectionRatio < 0.5 ? ['site_boundary_source_detection_below_review_threshold'] : []),
    ...(sourceImageBoundary && bboxFallbackEdgeRatio > 0.05 ? ['bbox_fallback_edges_present_in_source_boundary_graph'] : [])
  ];
  const issues = [
    ...hardReasons.map((reason) => issue('error', `boundary_graph.${reason}`, reason)),
    ...reviewReasons.map((reason) => issue('warn', `boundary_graph.${reason}`, reason))
  ];
  return {
    ok: hardReasons.length === 0,
    verdict: hardReasons.length ? 'fail' : reviewReasons.length ? 'review' : 'pass',
    site_boundary_closure_ratio: round(boundaryLoops[0]?.closure_ratio || 0),
    observed_edge_coverage_ratio: round(Math.min(1, observedLength / Math.max(1, perimeter * 1.5))),
    completed_edge_ratio: round(completedLength / Math.max(1, observedLength + completedLength)),
    extrapolated_edge_ratio: round(extrapolatedLength / Math.max(1, observedLength + completedLength)),
    road_corridor_count: corridorHypotheses.length,
    mean_corridor_width_residual: round(average(widthResiduals, 0)),
    max_boundary_snap_delta: round(max(snapDeltas)),
    conflicting_hypothesis_count: conflictingHypotheses(corridorHypotheses),
    source_edge_alignment_ratio: round(sourceEdgeAlignmentRatio),
    site_edge_detection_ratio: round(siteEdgeDetectionRatio),
    bbox_fallback_edge_ratio: round(bboxFallbackEdgeRatio),
    inferred_geometry_area_ratio: round(inferredArea / Math.max(1, siteArea)),
    extrapolated_geometry_area_ratio: round(extrapolatedArea / Math.max(1, siteArea)),
    road_building_overlap_ratio: round(roadBuildingOverlap / Math.max(1, siteArea)),
    corridor_area_ratio: round(corridorArea / Math.max(1, siteArea)),
    reasons: [...hardReasons, ...reviewReasons],
    issues
  };
}

function correctionTargetsFromBoundaryQa(qa = {}) {
  return (qa.reasons || []).map((reason) => ({
    target: `boundary_graph.${reason}`,
    action: reason.includes('corridor') ? 'inspect_or_refit_boundary_corridor_hypotheses' : 'inspect_boundary_completion_hypotheses',
    reason
  }));
}

function dominantDirectionsForEdges(edges = []) {
  const horizontal = edges.filter((edgeItem) => Math.abs(edgeItem.a[1] - edgeItem.b[1]) <= Math.abs(edgeItem.a[0] - edgeItem.b[0])).length;
  const vertical = edges.length - horizontal;
  return [
    { id: 'dominant_x', axis: 'x', angle_degrees: 0, support_edges: horizontal, confidence: round(horizontal / Math.max(1, edges.length)) },
    { id: 'dominant_y', axis: 'y', angle_degrees: 90, support_edges: vertical, confidence: round(vertical / Math.max(1, edges.length)) }
  ];
}

function mergeCollinearEdges(edges = []) {
  const byKey = new Map();
  for (const edgeItem of edges) {
    const horizontal = Math.abs(edgeItem.a[1] - edgeItem.b[1]) <= Math.abs(edgeItem.a[0] - edgeItem.b[0]);
    const key = [
      edgeItem.type,
      edgeItem.state,
      horizontal ? 'h' : 'v',
      horizontal ? Math.round(edgeItem.a[1] / 3) : Math.round(edgeItem.a[0] / 3),
      edgeItem.method
    ].join('|');
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...edgeItem });
      continue;
    }
    const points = [current.a, current.b, edgeItem.a, edgeItem.b];
    if (horizontal) {
      const xs = points.map((point) => point[0]);
      const y = average(points.map((point) => point[1]));
      current.a = [round(Math.min(...xs)), round(y)];
      current.b = [round(Math.max(...xs)), round(y)];
    } else {
      const ys = points.map((point) => point[1]);
      const x = average(points.map((point) => point[0]));
      current.a = [round(x), round(Math.min(...ys))];
      current.b = [round(x), round(Math.max(...ys))];
    }
    current.confidence = round(Math.max(current.confidence, edgeItem.confidence));
    current.source_ids = unique([...(current.source_ids || []), ...(edgeItem.source_ids || [])]);
  }
  return [...byKey.values()].filter((edgeItem) => distance(edgeItem.a, edgeItem.b) >= 8);
}

function rectSides([x, y, w, h]) {
  return [
    { side: 'top', a: [round(x), round(y)], b: [round(x + w), round(y)] },
    { side: 'right', a: [round(x + w), round(y)], b: [round(x + w), round(y + h)] },
    { side: 'bottom', a: [round(x + w), round(y + h)], b: [round(x), round(y + h)] },
    { side: 'left', a: [round(x), round(y + h)], b: [round(x), round(y)] }
  ];
}

function edge(id, type, state, a, b, options = {}) {
  return {
    id,
    type,
    state,
    a: a.map((value) => round(value)),
    b: b.map((value) => round(value)),
    method: options.method || 'boundary_graph_v1',
    confidence: round(options.confidence ?? 0.5),
    source_ids: options.source_ids || [],
    inference_level: options.inference_level || state,
    completion_hypothesis_id: options.completion_hypothesis_id || null,
    completion_reason: options.completion_reason || null,
    class_boundary_hint: options.class_boundary_hint || null,
    risk_flags: options.risk_flags || [],
    source_pixel_support_ratio: options.source_pixel_support_ratio ?? null,
    source_edge_strength: options.source_edge_strength ?? null,
    context: options.context || null
  };
}

function buildingExclusionBoxes(topImage) {
  return (topImage?.observations || [])
    .filter((item) => item.bbox && (BUILDING_HINTS.has(item.component_hint) || SERVICE_EXCLUSION_HINTS.has(item.component_hint)))
    .filter((item) => !/^building_top_warehouse_row/.test(item.id || ''))
    .map((item) => normalizeBbox(item.bbox));
}

function parkingBoxesFor(topImage, landCover) {
  const observed = (topImage?.observations || [])
    .filter((item) => item.bbox && PARKING_HINTS.has(item.component_hint))
    .map((item) => normalizeBbox(item.bbox));
  const masks = (landCover?.masks || [])
    .filter((maskItem) => maskItem.class === 'parking_surface_candidate')
    .map((maskItem) => normalizeBbox(maskItem.bbox_px));
  return [...observed, ...masks];
}

function riskFlagsForInference(state, support) {
  return [
    ...(state === 'weak_inferred' ? ['single_edge_inference'] : []),
    ...(state === 'completed_gap' ? ['gap_completion'] : []),
    ...(state === 'completed_occluded' ? ['occlusion_completion'] : []),
    ...(state === 'extrapolated_off_frame' ? ['off_frame_extrapolation'] : []),
    ...(support < 0.32 ? ['weak_land_cover_support'] : [])
  ];
}

function edgeAt(edgeMap, x, y, axis, radius = 0) {
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  const map = axis === 'h' ? edgeMap.horizontal : edgeMap.vertical;
  for (let yy = roundedY - radius; yy <= roundedY + radius; yy += 1) {
    if (yy < 0 || yy >= edgeMap.height) continue;
    for (let xx = roundedX - radius; xx <= roundedX + radius; xx += 1) {
      if (xx < 0 || xx >= edgeMap.width) continue;
      if (map[yy * edgeMap.width + xx]) return true;
    }
  }
  return false;
}

function strengthAt(edgeMap, x, y) {
  const xx = Math.max(0, Math.min(edgeMap.width - 1, Math.round(x)));
  const yy = Math.max(0, Math.min(edgeMap.height - 1, Math.round(y)));
  return edgeMap.strength?.[yy * edgeMap.width + xx] || 0;
}

function lineSupport(edgeMap, a, b, axis) {
  const length = distance(a, b);
  const steps = Math.max(1, Math.ceil(length / 3));
  let votes = 0;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    if (edgeAt(edgeMap, x, y, axis, 2)) votes += 1;
  }
  return votes / Math.max(1, steps + 1);
}

function pixelSample(raster, x, y) {
  const xx = Math.max(0, Math.min(raster.width - 1, Math.round(x)));
  const yy = Math.max(0, Math.min(raster.height - 1, Math.round(y)));
  const index = (yy * raster.width + xx) * raster.channels;
  const r = raster.buffer[index];
  const g = raster.buffer[index + 1];
  const b = raster.buffer[index + 2];
  const hsv = rgbToHsv(r, g, b);
  const exg = 2 * g - r - b;
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  return {
    r,
    g,
    b,
    gray,
    exg,
    ...hsv,
    vegetation: isVegetationPixel(r, g, b, hsv, exg),
    hardscape: isHardscapePixel(r, g, b, hsv)
  };
}

function isVegetationPixel(r, g, b, hsv, exg) {
  return (hsv.h >= 58 && hsv.h <= 172 && hsv.s >= 0.18 && exg > 12 && g > 48)
    || (g > r * 1.12 && g > b * 1.05 && exg > 18);
}

function isHardscapePixel(r, g, b, hsv) {
  const channelSpread = Math.max(r, g, b) - Math.min(r, g, b);
  return hsv.v >= 0.22 && hsv.v <= 0.88 && hsv.s <= 0.42 && channelSpread <= 92;
}

function pointInAnyBbox(point, bboxes = []) {
  return bboxes.some((bbox) => pointInBbox(point, bbox));
}

function pointInBbox([x, y], bbox) {
  if (!bbox) return false;
  return x >= bbox[0]
    && x <= bbox[0] + bbox[2]
    && y >= bbox[1]
    && y <= bbox[1] + bbox[3];
}

function pointInLandCover(point, landCover, classes) {
  return (landCover?.masks || []).some((maskItem) => classes.includes(maskItem.class) && pointInBbox(point, maskItem.bbox_px));
}

function distanceToSiteEdge([x, y], site) {
  return Math.min(
    Math.abs(x - site[0]),
    Math.abs(x - (site[0] + site[2])),
    Math.abs(y - site[1]),
    Math.abs(y - (site[1] + site[3]))
  );
}

function isHorizontalEdge(edgeItem) {
  return Math.abs(edgeItem.a[1] - edgeItem.b[1]) <= Math.abs(edgeItem.a[0] - edgeItem.b[0]);
}

function edgeProjectionOverlap(a, b, axis) {
  const a0 = axis === 'x' ? Math.min(a.a[0], a.b[0]) : Math.min(a.a[1], a.b[1]);
  const a1 = axis === 'x' ? Math.max(a.a[0], a.b[0]) : Math.max(a.a[1], a.b[1]);
  const b0 = axis === 'x' ? Math.min(b.a[0], b.b[0]) : Math.min(b.a[1], b.b[1]);
  const b1 = axis === 'x' ? Math.max(b.a[0], b.b[0]) : Math.max(b.a[1], b.b[1]);
  const start = Math.max(a0, b0);
  const end = Math.min(a1, b1);
  return {
    start,
    end,
    length: Math.max(0, end - start)
  };
}

function landCoverSupportRatio(landCover, bbox, classes) {
  if (!landCover?.tiles?.length) return 0.5;
  const area = Math.max(1, bboxArea(bbox));
  let support = 0;
  for (const tileItem of landCover.tiles) {
    if (!classes.includes(tileItem.class)) continue;
    support += intersectionArea(bbox, tileItem.bbox_px) / area;
  }
  return Math.min(1, support);
}

function widthResidualFor(width, existing, site) {
  const widths = existing.map((item) => item.width_px).filter((value) => Number.isFinite(value) && value > 0);
  if (!widths.length) return Math.min(0.34, Math.abs(width - Math.min(site[2], site[3]) * 0.055) / Math.max(1, Math.min(site[2], site[3]) * 0.055));
  return Math.abs(width - average(widths)) / Math.max(1, average(widths));
}

function conflictingHypotheses(hypotheses = []) {
  let count = 0;
  for (let index = 0; index < hypotheses.length; index += 1) {
    for (let other = index + 1; other < hypotheses.length; other += 1) {
      const overlap = intersectionArea(hypotheses[index].bbox_px, hypotheses[other].bbox_px);
      if (overlap / Math.max(1, Math.min(bboxArea(hypotheses[index].bbox_px), bboxArea(hypotheses[other].bbox_px))) > 0.65) count += 1;
    }
  }
  return count;
}

function edgeTouchesBbox(edgeItem, bbox, tolerance = 0) {
  return pointNearBbox(edgeItem.a, bbox, tolerance) || pointNearBbox(edgeItem.b, bbox, tolerance);
}

function pointNearBbox(point, bbox, tolerance = 0) {
  return point[0] >= bbox[0] - tolerance
    && point[0] <= bbox[0] + bbox[2] + tolerance
    && point[1] >= bbox[1] - tolerance
    && point[1] <= bbox[1] + bbox[3] + tolerance;
}

function edgeLength(edges = []) {
  return edges.reduce((sum, edgeItem) => sum + distance(edgeItem.a, edgeItem.b), 0);
}

function distance(a, b) {
  return Math.hypot((a?.[0] || 0) - (b?.[0] || 0), (a?.[1] || 0) - (b?.[1] || 0));
}

function lineBbox(a, b) {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return normalizeBbox([x, y, Math.max(1, Math.abs(a[0] - b[0])), Math.max(1, Math.abs(a[1] - b[1]))]);
}

function mask(id, cls, bbox) {
  const normalized = normalizeBbox(bbox);
  return {
    id,
    class: cls,
    bbox_px: normalized,
    polygon_px: bboxPolygon(normalized),
    area_px: round(bboxArea(normalized)),
    confidence: 0.86
  };
}

function obs(id, hint, bbox) {
  return {
    id,
    component_hint: hint,
    bbox,
    confidence: 0.8,
    grounding: { method: 'pixel_color_segmentation' }
  };
}

function hintForClass(cls, id) {
  if (cls === 'building_footprint') return id.includes('store') ? 'admin_office' : 'primary_blue_roof_hall';
  if (cls === 'parking_surface_candidate') return 'parking_lot';
  if (cls === 'road_surface_candidate') return 'parking_drive_aisle_center';
  if (/vegetation/.test(cls)) return 'tree_row_south';
  return 'site_boundary';
}

function findTopImage(observations) {
  return (observations.images || []).find((image) => image.detected_view?.kind === 'top')
    || (observations.images || []).find((image) => image.image?.path && /top/i.test(image.image.path))
    || observations.images?.[0]
    || null;
}

function findObservation(image, hint) {
  return (image?.observations || []).find((item) => item.component_hint === hint || item.id === hint);
}

function missingBoundaryGraph() {
  return {
    kind: 'boundary_graph_v1',
    version: 1,
    backend: 'missing_top_view',
    source_image: null,
    site_bbox_px: [0, 0, 0, 0],
    dominant_directions: [],
    observed_edges: [],
    completed_edges: [],
    boundary_loops: [],
    corridor_hypotheses: [],
    completion_hypotheses: [],
    qa: {
      ok: false,
      verdict: 'fail',
      site_boundary_closure_ratio: 0,
      observed_edge_coverage_ratio: 0,
      completed_edge_ratio: 0,
      extrapolated_edge_ratio: 0,
      road_corridor_count: 0,
      mean_corridor_width_residual: 1,
      max_boundary_snap_delta: 1,
      conflicting_hypothesis_count: 0,
      inferred_geometry_area_ratio: 0,
      extrapolated_geometry_area_ratio: 0,
      issues: [{ severity: 'error', rule_id: 'boundary_graph.missing_top_view', type: 'boundary_graph.missing_top_view', message: 'missing_top_view', evidence: {} }]
    },
    correction_targets: [{ target: 'boundary_graph.missing_top_view', action: 'provide_top_or_near_orthographic_view', reason: 'missing_top_view' }]
  };
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

function clipBbox(bbox, site) {
  const x1 = Math.max(site[0], bbox[0]);
  const y1 = Math.max(site[1], bbox[1]);
  const x2 = Math.min(site[0] + site[2], bbox[0] + bbox[2]);
  const y2 = Math.min(site[1] + site[3], bbox[1] + bbox[3]);
  return normalizeBbox([x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1)]);
}

function bboxTouches(a, b, tolerance = 0) {
  if (!a || !b) return false;
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  return !(ax2 < b[0] - tolerance || bx2 < a[0] - tolerance || ay2 < b[1] - tolerance || by2 < a[1] - tolerance);
}

function intersectionArea(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function bboxUnion(bboxes = []) {
  const xs = bboxes.flatMap((bbox) => [bbox[0], bbox[0] + bbox[2]]);
  const ys = bboxes.flatMap((bbox) => [bbox[1], bbox[1] + bbox[3]]);
  return normalizeBbox([
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys)
  ]);
}

function bboxArea(bbox) {
  if (!bbox) return 0;
  return Math.max(0, Number(bbox[2]) || 0) * Math.max(0, Number(bbox[3]) || 0);
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

function sortedUnique(values = []) {
  return [...new Set(values.map((value) => round(value)).filter((value) => Number.isFinite(value)))]
    .sort((a, b) => a - b);
}

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

function normalizeBbox(bbox = [0, 0, 0, 0]) {
  return bbox.map((value) => round(Number(value) || 0));
}

function average(values = [], fallback = 0) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return fallback;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function max(values = []) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : 0;
}

function rgbToHsv(r, g, b) {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const maxValue = Math.max(nr, ng, nb);
  const minValue = Math.min(nr, ng, nb);
  const delta = maxValue - minValue;
  let h = 0;
  if (delta !== 0) {
    if (maxValue === nr) h = 60 * (((ng - nb) / delta) % 6);
    else if (maxValue === ng) h = 60 * ((nb - nr) / delta + 2);
    else h = 60 * ((nr - ng) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = maxValue === 0 ? 0 : delta / maxValue;
  return { h, s, v: maxValue };
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
