import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { repoRoot } from './image-analysis.mjs';

export const HIGH_CONTRAST_EDGE_CLASSES = [
  'building_outline',
  'roof_internal_seam',
  'site_perimeter_candidate',
  'road_boundary_candidate',
  'paved_green_boundary',
  'unknown_strong_edge'
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

const PARKING_HINTS = new Set(['parking_lot', 'parking_stall_row_north', 'parking_stall_row_south']);

const EDGE_COLORS = {
  building_outline: '#1677ff',
  roof_internal_seam: '#a855f7',
  site_perimeter_candidate: '#ef4444',
  road_boundary_candidate: '#f59e0b',
  paved_green_boundary: '#16a34a',
  unknown_strong_edge: '#64748b'
};

export async function annotateObservationSetWithHighContrastEdgeV1(observations = {}, options = {}) {
  if (observations.object?.profile !== 'building_group' && observations.object?.type !== 'building_group') return observations;
  if (observations.high_contrast_edge_v1 && !options.force) return observations;
  const highContrastEdge = await buildHighContrastEdgeV1({ observations, options });
  return {
    ...observations,
    high_contrast_edge_v1: highContrastEdge
  };
}

export async function buildHighContrastEdgeV1({ observations = {}, options = {} } = {}) {
  const topImage = findTopImage(observations);
  if (!topImage?.image?.path || /^synthetic:\/\//.test(topImage.image.path)) return missingHighContrastEdge('missing_top_raster');
  const raster = await loadTopRaster(topImage).catch(() => null);
  if (!raster) return missingHighContrastEdge('failed_to_load_top_raster');
  const site = normalizeBbox(
    observations.land_cover_v1?.site_bbox_px
    || findObservation(topImage, 'site_boundary')?.bbox
    || findObservation(topImage, 'building_top_site_boundary')?.bbox
    || topImage.metrics?.object_bbox
    || [0, 0, raster.width, raster.height]
  );
  const buildingBoxes = buildingExclusionBoxes(topImage);
  const parkingBoxes = parkingBoxesFor(topImage);
  const preprocessed = computeHighContrastPreprocess({ raster, site, buildingBoxes });
  const rawCandidates = extractLineCandidates({
    raster,
    preprocessed,
    site,
    buildingBoxes,
    parkingBoxes,
    landCover: observations.land_cover_v1 || null
  });
  const siteRanking = rankSitePerimeterCandidates(rawCandidates, site);
  const edgeCandidates = applyAcceptancePolicy(rawCandidates, siteRanking);
  const accepted = edgeCandidates.filter((candidate) => candidate.accepted);
  const rejected = edgeCandidates.filter((candidate) => !candidate.accepted);
  const qa = highContrastQa({ edgeCandidates, siteRanking });

  return {
    kind: 'high_contrast_edge_v1',
    version: 1,
    backend: 'grayscale_clahe_like_canny_hough_v1',
    coordinate_convention: 'image_x_right_y_down',
    source_image: topImage.image.path,
    analysis_size: { width: raster.width, height: raster.height },
    site_bbox_px: site,
    classes: HIGH_CONTRAST_EDGE_CLASSES,
    preprocessing: {
      grayscale: true,
      contrast_method: 'local_mean_stretch_clahe_like',
      edge_method: 'sobel_threshold_plus_axis_hough_like_segments',
      edge_threshold: preprocessed.edge_threshold
    },
    edge_pixel_count: preprocessed.edge_pixel_count,
    candidate_edges: edgeCandidates,
    site_perimeter_candidates: siteRanking,
    qa,
    correction_targets: correctionTargetsFromQa(qa),
    notes: [
      'HighContrastEdge v1 separates visible edge evidence from inferred GroundPlan surfaces.',
      'Strong internal edges are ranked and rejected instead of silently becoming site perimeter.'
    ],
    _preprocess: options.includeDebugBuffers ? preprocessed : undefined
  };
}

export function highContrastEdgeReport(highContrastEdge = {}) {
  return {
    kind: 'high_contrast_edge_v1_report',
    version: 1,
    ok: highContrastEdge.qa?.ok === true,
    verdict: highContrastEdge.qa?.verdict || 'fail',
    high_contrast_edge_v1: stripDebug(highContrastEdge),
    summary: {
      backend: highContrastEdge.backend || null,
      source_image: highContrastEdge.source_image || null,
      edge_pixel_count: highContrastEdge.edge_pixel_count || 0,
      candidate_edge_count: highContrastEdge.candidate_edges?.length || 0,
      accepted_edge_count: highContrastEdge.qa?.accepted_edge_count || 0,
      rejected_edge_count: highContrastEdge.qa?.rejected_edge_count || 0,
      site_perimeter_confidence: highContrastEdge.qa?.site_perimeter_confidence ?? 0,
      road_boundary_confidence: highContrastEdge.qa?.road_boundary_confidence ?? 0,
      building_outline_confidence: highContrastEdge.qa?.building_outline_confidence ?? 0,
      roof_seam_rejection_count: highContrastEdge.qa?.roof_seam_rejection_count || 0,
      internal_strong_edge_rejection_count: highContrastEdge.qa?.internal_strong_edge_rejection_count || 0,
      site_perimeter_sides_with_rejected_alternatives: highContrastEdge.qa?.site_perimeter_sides_with_rejected_alternatives || 0
    },
    issues: highContrastEdge.qa?.issues || [],
    correction_targets: highContrastEdge.correction_targets || []
  };
}

export function boundaryEdgesFromHighContrastEdgeV1(highContrastEdge = {}) {
  if (!highContrastEdge) return [];
  if (highContrastEdge.kind !== 'high_contrast_edge_v1') return [];
  return (highContrastEdge.candidate_edges || [])
    .filter((candidate) => candidate.accepted)
    .filter((candidate) => !['roof_internal_seam', 'unknown_strong_edge'].includes(candidate.class))
    .map((candidate, index) => ({
      id: `high_contrast_boundary_edge_${index + 1}_${candidate.id}`,
      type: boundaryTypeForCandidate(candidate.class),
      state: 'observed',
      a: candidate.a,
      b: candidate.b,
      method: 'high_contrast_edge_v1_segment',
      confidence: candidate.confidence,
      source_ids: [candidate.id],
      inference_level: 'observed',
      completion_hypothesis_id: null,
      completion_reason: null,
      class_boundary_hint: candidate.class,
      risk_flags: candidate.risk_flags || [],
      source_pixel_support_ratio: candidate.source_pixel_support_ratio,
      source_edge_strength: candidate.source_edge_strength,
      context: candidate.context || null
    }));
}

export async function renderHighContrastEdgeArtifacts({
  observations = {},
  highContrastEdge = null,
  outputDir,
  basename = 'edge'
} = {}) {
  const resolved = highContrastEdge || await buildHighContrastEdgeV1({
    observations,
    options: { includeDebugBuffers: true }
  });
  const topImage = findTopImage(observations);
  const raster = await loadTopRaster(topImage).catch(() => null);
  const debug = resolved._preprocess || (raster
    ? computeHighContrastPreprocess({ raster, site: resolved.site_bbox_px, buildingBoxes: buildingExclusionBoxes(topImage) })
    : null);
  const imageHref = raster ? await rasterDataUrl(raster) : null;
  const grayHref = debug ? await grayDataUrl(debug.gray, debug.width, debug.height) : null;
  const contrastHref = debug ? await grayDataUrl(debug.high_contrast, debug.width, debug.height) : null;
  const edgeHref = debug ? await grayDataUrl(debug.edge_visual, debug.width, debug.height) : null;
  const preprocessSvg = renderPreprocessSvg({
    highContrastEdge: resolved,
    imageHref,
    grayHref,
    contrastHref,
    edgeHref
  });
  const classificationSvg = renderClassificationSvg({
    highContrastEdge: resolved,
    imageHref
  });
  await fs.mkdir(outputDir, { recursive: true });
  const preprocessSvgPath = path.join(outputDir, `${basename}-preprocess-debug.svg`);
  const preprocessPngPath = path.join(outputDir, `${basename}-preprocess-debug.png`);
  const classificationSvgPath = path.join(outputDir, `${basename}-candidate-classification.svg`);
  const classificationPngPath = path.join(outputDir, `${basename}-candidate-classification.png`);
  await fs.writeFile(preprocessSvgPath, preprocessSvg, 'utf8');
  await fs.writeFile(classificationSvgPath, classificationSvg, 'utf8');
  await sharp(Buffer.from(preprocessSvg), { density: 144 }).png().toFile(preprocessPngPath);
  await sharp(Buffer.from(classificationSvg), { density: 144 }).png().toFile(classificationPngPath);
  return {
    preprocessSvgPath,
    preprocessPngPath,
    classificationSvgPath,
    classificationPngPath
  };
}

export function makeSyntheticHighContrastEdgeFixture(kind = 'roof_seam_negative') {
  const site = [0, 0, 240, 180];
  const common = {
    kind: 'high_contrast_edge_v1',
    version: 1,
    backend: 'synthetic_high_contrast_edge_fixture_v1',
    coordinate_convention: 'image_x_right_y_down',
    source_image: `synthetic://${kind}`,
    analysis_size: { width: 240, height: 180 },
    site_bbox_px: site,
    classes: HIGH_CONTRAST_EDGE_CLASSES,
    preprocessing: {
      grayscale: true,
      contrast_method: 'synthetic',
      edge_method: 'synthetic',
      edge_threshold: 1
    },
    edge_pixel_count: 1200
  };
  const candidates = kind === 'roof_seam_negative'
    ? [
      candidate('synthetic_roof_seam', 'roof_internal_seam', [55, 72], [172, 72], { accepted: false, rejection_reason: 'inside_building_roof_seam' }),
      candidate('synthetic_building_outline', 'building_outline', [48, 48], [180, 48], { accepted: true })
    ]
    : [
      candidate('synthetic_site_top', 'site_perimeter_candidate', [5, 8], [232, 8], { accepted: true, site_side: 'top' }),
      candidate('synthetic_internal_top', 'site_perimeter_candidate', [25, 44], [214, 44], { accepted: false, rejection_reason: 'lower_rank_site_perimeter_alternative', site_side: 'top' }),
      candidate('synthetic_road_edge', 'road_boundary_candidate', [30, 120], [220, 120], { accepted: true })
    ];
  const siteRanking = rankSitePerimeterCandidates(candidates, site);
  const edgeCandidates = applyAcceptancePolicy(candidates, siteRanking);
  const qa = highContrastQa({ edgeCandidates, siteRanking });
  return {
    ...common,
    candidate_edges: edgeCandidates,
    site_perimeter_candidates: siteRanking,
    qa,
    correction_targets: correctionTargetsFromQa(qa)
  };
}

function computeHighContrastPreprocess({ raster, site, buildingBoxes }) {
  const pixels = raster.width * raster.height;
  const gray = new Uint8Array(pixels);
  const localMean = new Uint8Array(pixels);
  const highContrast = new Uint8Array(pixels);
  const edgeVisual = new Uint8Array(pixels);
  const strength = new Float32Array(pixels);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const sample = pixelSample(raster, x, y);
      gray[y * raster.width + x] = sample.gray;
    }
  }
  const global = percentile(gray, 0.08, 0.94);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      localMean[y * raster.width + x] = localAverage(gray, raster.width, raster.height, x, y, 8);
    }
  }
  for (let index = 0; index < pixels; index += 1) {
    const stretched = clamp255((gray[index] - global.low) * 255 / Math.max(1, global.high - global.low));
    const local = clamp255(128 + (gray[index] - localMean[index]) * 2.1);
    highContrast[index] = clamp255(stretched * 0.62 + local * 0.38);
  }
  const [sx, sy, sw, sh] = site || [0, 0, raster.width, raster.height];
  const x0 = Math.max(2, Math.floor(sx));
  const y0 = Math.max(2, Math.floor(sy));
  const x1 = Math.min(raster.width - 3, Math.ceil(sx + sw));
  const y1 = Math.min(raster.height - 3, Math.ceil(sy + sh));
  let totalStrength = 0;
  let samples = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const gx = sobelAt(highContrast, raster.width, x, y, 'x');
      const gy = sobelAt(highContrast, raster.width, x, y, 'y');
      const value = Math.hypot(gx, gy);
      strength[y * raster.width + x] = value;
      totalStrength += value;
      samples += 1;
    }
  }
  const threshold = Math.max(34, Math.min(88, totalStrength / Math.max(1, samples) * 1.52));
  let edgePixelCount = 0;
  const horizontal = new Uint8Array(pixels);
  const vertical = new Uint8Array(pixels);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const gx = Math.abs(sobelAt(highContrast, raster.width, x, y, 'x'));
      const gy = Math.abs(sobelAt(highContrast, raster.width, x, y, 'y'));
      const value = strength[y * raster.width + x];
      if (value < threshold) continue;
      const insideBuilding = pointInAnyBbox([x, y], buildingBoxes);
      const relaxed = insideBuilding ? threshold * 1.24 : threshold;
      if (value < relaxed) continue;
      edgeVisual[y * raster.width + x] = 255;
      edgePixelCount += 1;
      if (gy >= gx * 0.72) horizontal[y * raster.width + x] = 1;
      if (gx >= gy * 0.72) vertical[y * raster.width + x] = 1;
    }
  }
  return {
    width: raster.width,
    height: raster.height,
    gray,
    high_contrast: highContrast,
    edge_visual: edgeVisual,
    strength,
    horizontal,
    vertical,
    edge_threshold: round(threshold),
    edge_pixel_count: edgePixelCount
  };
}

function extractLineCandidates({ raster, preprocessed, site, buildingBoxes, parkingBoxes, landCover }) {
  const horizontalBands = selectLineBands({ preprocessed, site, axis: 'x' });
  const verticalBands = selectLineBands({ preprocessed, site, axis: 'y' });
  const segments = [
    ...horizontalBands.flatMap((band) => segmentsForBand({
      raster,
      preprocessed,
      site,
      axis: 'x',
      fixed: band,
      buildingBoxes,
      parkingBoxes,
      landCover
    })),
    ...verticalBands.flatMap((band) => segmentsForBand({
      raster,
      preprocessed,
      site,
      axis: 'y',
      fixed: band,
      buildingBoxes,
      parkingBoxes,
      landCover
    }))
  ];
  return mergeLineCandidates(segments)
    .sort((a, b) => b.score - a.score || b.length_px - a.length_px)
    .slice(0, 220);
}

function selectLineBands({ preprocessed, site, axis }) {
  const [sx, sy, sw, sh] = site;
  const scores = [];
  if (axis === 'x') {
    for (let y = Math.max(2, Math.floor(sy) + 3); y < Math.min(preprocessed.height - 2, sy + sh - 3); y += 1) {
      let count = 0;
      for (let x = Math.floor(sx) + 3; x < sx + sw - 3; x += 2) {
        if (edgeVote(preprocessed, x, y, 'h', 2)) count += 1;
      }
      const support = count / Math.max(1, sw / 2);
      if (support >= 0.055) scores.push({ value: y, support });
    }
  } else {
    for (let x = Math.max(2, Math.floor(sx) + 3); x < Math.min(preprocessed.width - 2, sx + sw - 3); x += 1) {
      let count = 0;
      for (let y = Math.floor(sy) + 3; y < sy + sh - 3; y += 2) {
        if (edgeVote(preprocessed, x, y, 'v', 2)) count += 1;
      }
      const support = count / Math.max(1, sh / 2);
      if (support >= 0.055) scores.push({ value: x, support });
    }
  }
  return nonMaxBands(scores, 5)
    .sort((a, b) => b.support - a.support)
    .slice(0, 80)
    .map((item) => item.value);
}

function segmentsForBand({ raster, preprocessed, site, axis, fixed, buildingBoxes, parkingBoxes, landCover }) {
  const [sx, sy, sw, sh] = site;
  const start = Math.floor(axis === 'x' ? sx : sy) + 3;
  const end = Math.ceil(axis === 'x' ? sx + sw : sy + sh) - 3;
  const result = [];
  let runStart = null;
  let votes = 0;
  let strength = 0;
  let lastVote = null;
  const closeRun = (cursor) => {
    if (runStart === null) return;
    const runEnd = lastVote ?? cursor;
    const length = runEnd - runStart;
    const support = votes / Math.max(1, length / 2);
    if (length >= 36 && support >= 0.15) {
      const a = axis === 'x' ? [runStart, fixed] : [fixed, runStart];
      const b = axis === 'x' ? [runEnd, fixed] : [fixed, runEnd];
      const context = lineContext({ raster, a, b, axis, buildingBoxes, parkingBoxes, landCover });
      const classified = classifyHighContrastEdgeCandidate({
        a,
        b,
        axis,
        site,
        context,
        support,
        sourceStrength: strength / Math.max(1, votes)
      });
      result.push(candidate(`high_contrast_${axis}_${fixed}_${runStart}_${runEnd}`, classified.class, a, b, {
        axis,
        confidence: classified.confidence,
        source_pixel_support_ratio: Math.min(1, support),
        source_edge_strength: strength / Math.max(1, votes),
        context,
        score: length * support * classified.confidence,
        risk_flags: classified.risk_flags,
        accepted: classified.accepted,
        rejection_reason: classified.rejection_reason
      }));
    }
    runStart = null;
    votes = 0;
    strength = 0;
    lastVote = null;
  };
  for (let cursor = start; cursor <= end; cursor += 2) {
    const x = axis === 'x' ? cursor : fixed;
    const y = axis === 'x' ? fixed : cursor;
    const vote = edgeVote(preprocessed, x, y, axis === 'x' ? 'h' : 'v', 2);
    if (vote) {
      if (runStart === null) runStart = cursor;
      votes += 1;
      strength += strengthAt(preprocessed, x, y);
      lastVote = cursor;
    } else if (runStart !== null && lastVote !== null && cursor - lastVote > 18) {
      closeRun(cursor);
    }
  }
  closeRun(end);
  return result;
}

export function classifyHighContrastEdgeCandidate({ a, b, axis, site, context, support = 0, sourceStrength = 0 } = {}) {
  const center = axis === 'x' ? [(a[0] + b[0]) / 2, a[1]] : [a[0], (a[1] + b[1]) / 2];
  const nearSite = distanceToSiteEdge(center, site) <= Math.max(13, Math.min(site[2], site[3]) * 0.025);
  const length = distance(a, b);
  const sideLength = axis === 'x' ? site[2] : site[3];
  const longSiteLike = length >= sideLength * 0.34;
  if (context.inside_building_ratio > 0.52 && context.building_transition_ratio < 0.26) {
    return {
      class: 'roof_internal_seam',
      confidence: Math.min(0.88, 0.54 + support * 0.24),
      accepted: false,
      rejection_reason: 'inside_building_roof_seam',
      risk_flags: ['inside_building']
    };
  }
  if (context.building_transition_ratio > 0.3) {
    return {
      class: 'building_outline',
      confidence: Math.min(0.9, 0.55 + context.building_transition_ratio * 0.24 + support * 0.14),
      accepted: true,
      risk_flags: []
    };
  }
  if (nearSite && longSiteLike && sourceStrength > 36) {
    return {
      class: 'site_perimeter_candidate',
      confidence: Math.min(0.9, 0.5 + support * 0.22 + Math.min(0.16, sourceStrength / 500)),
      accepted: true,
      risk_flags: []
    };
  }
  if (context.vegetation_hardscape_transition_ratio > 0.18) {
    return {
      class: 'paved_green_boundary',
      confidence: Math.min(0.88, 0.5 + context.vegetation_hardscape_transition_ratio * 0.26 + support * 0.14),
      accepted: true,
      risk_flags: []
    };
  }
  if (context.parking_context_ratio > 0.28 || context.road_mask_ratio > 0.2 || context.hardscape_ratio > 0.54) {
    return {
      class: 'road_boundary_candidate',
      confidence: Math.min(0.86, 0.48 + support * 0.18 + context.hardscape_ratio * 0.14),
      accepted: context.inside_building_ratio < 0.28,
      rejection_reason: context.inside_building_ratio >= 0.28 ? 'road_boundary_inside_building_rejected' : null,
      risk_flags: context.inside_building_ratio >= 0.28 ? ['inside_building'] : []
    };
  }
  return {
    class: 'unknown_strong_edge',
    confidence: Math.min(0.72, 0.38 + support * 0.18),
    accepted: false,
    rejection_reason: 'unknown_strong_edge_needs_review',
    risk_flags: ['unknown_source_context']
  };
}

function lineContext({ raster, a, b, axis, buildingBoxes, parkingBoxes, landCover }) {
  const length = distance(a, b);
  const steps = Math.max(8, Math.min(70, Math.ceil(length / 8)));
  const offset = 7;
  const counts = {
    buildingA: 0,
    buildingB: 0,
    vegetationA: 0,
    vegetationB: 0,
    hardscapeA: 0,
    hardscapeB: 0,
    parking: 0,
    roadMask: 0,
    pavedMask: 0,
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
    counts.buildingA += pointInAnyBbox(pA, buildingBoxes) ? 1 : 0;
    counts.buildingB += pointInAnyBbox(pB, buildingBoxes) ? 1 : 0;
    counts.vegetationA += sA.vegetation ? 1 : 0;
    counts.vegetationB += sB.vegetation ? 1 : 0;
    counts.hardscapeA += sA.hardscape ? 1 : 0;
    counts.hardscapeB += sB.hardscape ? 1 : 0;
    counts.parking += pointInAnyBbox([x, y], parkingBoxes) ? 1 : 0;
    counts.roadMask += pointInLandCover([x, y], landCover, ['road_surface_candidate']) ? 1 : 0;
    counts.pavedMask += pointInLandCover([x, y], landCover, ['road_surface_candidate', 'parking_surface_candidate', 'paved_surface']) ? 1 : 0;
    counts.samples += 1;
  }
  const samples = Math.max(1, counts.samples);
  const buildingA = counts.buildingA / samples;
  const buildingB = counts.buildingB / samples;
  const vegA = counts.vegetationA / samples;
  const vegB = counts.vegetationB / samples;
  const hardA = counts.hardscapeA / samples;
  const hardB = counts.hardscapeB / samples;
  const vegetationHardTransition = (vegA > 0.35 && hardB > 0.32) || (vegB > 0.35 && hardA > 0.32);
  return {
    inside_building_ratio: round(Math.min(1, (counts.buildingA + counts.buildingB) / (samples * 2))),
    building_transition_ratio: round(Math.abs(buildingA - buildingB)),
    vegetation_hardscape_transition_ratio: round(vegetationHardTransition ? Math.abs(vegA - vegB) + Math.max(hardA, hardB) * 0.5 : 0),
    hardscape_ratio: round((hardA + hardB) / 2),
    vegetation_ratio: round((vegA + vegB) / 2),
    parking_context_ratio: round(counts.parking / samples),
    road_mask_ratio: round(counts.roadMask / samples),
    paved_mask_ratio: round(counts.pavedMask / samples)
  };
}

function rankSitePerimeterCandidates(candidates = [], site) {
  const sides = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((side) => [side, {
    side,
    winner_id: null,
    candidates: [],
    rejected_alternatives: []
  }]));
  for (const item of candidates) {
    const side = siteSideForCandidate(item, site);
    if (!side) continue;
    const distancePenalty = distanceToSide(item, site, side) / Math.max(1, side === 'top' || side === 'bottom' ? site[3] : site[2]);
    const outerBonus = outerPreferenceScore(item, site, side);
    const score = round(item.confidence * 0.44
      + item.source_pixel_support_ratio * 0.26
      + Math.min(0.22, item.length_px / Math.max(1, side === 'top' || side === 'bottom' ? site[2] : site[3]) * 0.22)
      + outerBonus * 0.18
      - distancePenalty * 0.24);
    sides[side].candidates.push({
      id: item.id,
      class: item.class,
      score,
      distance_to_side_px: round(distanceToSide(item, site, side)),
      confidence: item.confidence,
      source_pixel_support_ratio: item.source_pixel_support_ratio,
      length_px: item.length_px,
      a: item.a,
      b: item.b
    });
  }
  for (const side of Object.keys(sides)) {
    sides[side].candidates.sort((a, b) => b.score - a.score || b.length_px - a.length_px);
    const winner = sides[side].candidates.find((item) => item.class === 'site_perimeter_candidate') || sides[side].candidates[0] || null;
    sides[side].winner_id = winner?.id || null;
    sides[side].rejected_alternatives = sides[side].candidates.filter((item) => item.id !== sides[side].winner_id).slice(0, 6).map((item) => ({
      ...item,
      rejection_reason: 'lower_rank_site_perimeter_alternative'
    }));
  }
  return sides;
}

function applyAcceptancePolicy(candidates = [], siteRanking = {}) {
  const winners = new Set(Object.values(siteRanking).map((side) => side.winner_id).filter(Boolean));
  const lowerRankSite = new Set(Object.values(siteRanking).flatMap((side) => side.rejected_alternatives.map((item) => item.id)));
  return candidates.map((item) => {
    const next = { ...item };
    if (next.class === 'site_perimeter_candidate') {
      if (winners.has(next.id)) {
        next.accepted = true;
        next.acceptance_reason = 'winner_site_perimeter_candidate';
      } else if (lowerRankSite.has(next.id)) {
        next.accepted = false;
        next.rejection_reason = 'lower_rank_site_perimeter_alternative';
        next.risk_flags = unique([...(next.risk_flags || []), 'site_perimeter_lower_rank']);
      }
    }
    if (next.class === 'roof_internal_seam') {
      next.accepted = false;
      next.rejection_reason ||= 'inside_building_roof_seam';
    }
    if (next.class === 'unknown_strong_edge') {
      next.accepted = false;
      next.rejection_reason ||= 'unknown_strong_edge_needs_review';
    }
    return next;
  });
}

function highContrastQa({ edgeCandidates = [], siteRanking = {} } = {}) {
  const accepted = edgeCandidates.filter((item) => item.accepted);
  const rejected = edgeCandidates.filter((item) => !item.accepted);
  const roofSeams = rejected.filter((item) => item.class === 'roof_internal_seam');
  const internalStrong = rejected.filter((item) => item.rejection_reason === 'lower_rank_site_perimeter_alternative' || item.context?.inside_building_ratio > 0.35);
  const siteWinners = Object.values(siteRanking).map((side) => edgeCandidates.find((item) => item.id === side.winner_id)).filter(Boolean);
  const roadBoundaries = accepted.filter((item) => item.class === 'road_boundary_candidate');
  const buildingOutlines = accepted.filter((item) => item.class === 'building_outline');
  const issues = [];
  if (siteWinners.length < 3) issues.push(issue('review', 'high_contrast_site_perimeter_incomplete', 'HighContrastEdge found fewer than 3 site perimeter side winners.'));
  if (roadBoundaries.length < 1) issues.push(issue('review', 'high_contrast_road_boundary_missing', 'HighContrastEdge did not find a road boundary candidate.'));
  if (buildingOutlines.length < 1) issues.push(issue('review', 'high_contrast_building_outline_missing', 'HighContrastEdge did not find a building outline candidate.'));
  return {
    ok: siteWinners.length >= 3 && accepted.length >= 4,
    verdict: siteWinners.length >= 3 && accepted.length >= 4 ? 'pass' : 'review',
    accepted_edge_count: accepted.length,
    rejected_edge_count: rejected.length,
    site_perimeter_confidence: round(average(siteWinners.map((item) => item.confidence), 0)),
    road_boundary_confidence: round(average(roadBoundaries.map((item) => item.confidence), 0)),
    building_outline_confidence: round(average(buildingOutlines.map((item) => item.confidence), 0)),
    roof_seam_rejection_count: roofSeams.length,
    internal_strong_edge_rejection_count: internalStrong.length,
    site_perimeter_sides_with_rejected_alternatives: Object.values(siteRanking).filter((side) => side.rejected_alternatives.length > 0).length,
    accepted_by_class: countBy(accepted, 'class'),
    rejected_by_class: countBy(rejected, 'class'),
    issues
  };
}

function renderPreprocessSvg({ highContrastEdge, imageHref, grayHref, contrastHref, edgeHref }) {
  const [x, y, w, h] = highContrastEdge.site_bbox_px || [0, 0, 900, 675];
  const panelW = Math.round(w);
  const panelH = Math.round(h);
  const gap = 20;
  const titleH = 32;
  const width = panelW * 2 + gap;
  const height = panelH * 2 + gap + titleH * 2 + 92;
  const panels = [
    { x: 0, y: 0, contentY: titleH },
    { x: panelW + gap, y: 0, contentY: titleH },
    { x: 0, y: panelH + titleH + gap, contentY: panelH + titleH + gap + titleH },
    { x: panelW + gap, y: panelH + titleH + gap, contentY: panelH + titleH + gap + titleH }
  ];
  const image = (href, p, fallback) => href
    ? `<image href="${href}" x="${p.x}" y="${p.contentY}" width="${panelW}" height="${panelH}" preserveAspectRatio="none"/>`
    : `<rect x="${p.x}" y="${p.contentY}" width="${panelW}" height="${panelH}" fill="${fallback}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f3f4f6"/>
  ${panelTitle(panels[0], panelW, 'Original')}
  ${image(imageHref, panels[0], '#cbd5e1')}
  ${panelTitle(panels[1], panelW, 'Grayscale')}
  ${image(grayHref, panels[1], '#d1d5db')}
  ${panelTitle(panels[2], panelW, 'High contrast')}
  ${image(contrastHref, panels[2], '#e5e7eb')}
  ${panelTitle(panels[3], panelW, 'Edge map')}
  ${image(edgeHref, panels[3], '#111827')}
  ${panels.map((p) => `<rect x="${p.x}" y="${p.contentY}" width="${panelW}" height="${panelH}" fill="none" stroke="#111827" stroke-width="2"/>`).join('\n')}
  <rect x="0" y="${height - 76}" width="${width}" height="76" fill="#fff" stroke="#d1d5db"/>
  <text x="18" y="${height - 42}" font-size="15" font-weight="700" fill="#111827" font-family="Inter, Arial, sans-serif">edge pixels ${highContrastEdge.edge_pixel_count || 0} | threshold ${highContrastEdge.preprocessing?.edge_threshold ?? 0} | candidates ${highContrastEdge.candidate_edges?.length || 0}</text>
  <text x="18" y="${height - 18}" font-size="14" fill="#475569" font-family="Inter, Arial, sans-serif">The edge map is diagnostic evidence only; GroundPlan must consume classified vector edges, not raw pixels.</text>
</svg>`;
}

function renderClassificationSvg({ highContrastEdge, imageHref }) {
  const [x, y, w, h] = highContrastEdge.site_bbox_px || [0, 0, 900, 675];
  const width = Math.round(w);
  const height = Math.round(h) + 126;
  const edges = highContrastEdge.candidate_edges || [];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  ${imageHref ? `<image href="${imageHref}" x="0" y="0" width="${width}" height="${Math.round(h)}" preserveAspectRatio="none" opacity="0.86"/>` : `<rect x="0" y="0" width="${width}" height="${Math.round(h)}" fill="#dbe3ec"/>`}
  <rect x="0" y="0" width="${width}" height="${Math.round(h)}" fill="none" stroke="#111827" stroke-width="2"/>
  ${edges.map((item) => edgeSvg(item)).join('\n')}
  <rect x="0" y="${Math.round(h)}" width="${width}" height="126" fill="#fff" stroke="#d1d5db"/>
  ${legendSvg(Math.round(h) + 24)}
  <text x="18" y="${Math.round(h) + 104}" font-size="14" fill="#111827" font-family="Inter, Arial, sans-serif">accepted ${highContrastEdge.qa?.accepted_edge_count || 0} | rejected ${highContrastEdge.qa?.rejected_edge_count || 0} | site confidence ${Number(highContrastEdge.qa?.site_perimeter_confidence || 0).toFixed(2)} | road confidence ${Number(highContrastEdge.qa?.road_boundary_confidence || 0).toFixed(2)}</text>
</svg>`;
}

function edgeSvg(item) {
  const color = EDGE_COLORS[item.class] || '#64748b';
  const dash = item.accepted ? '' : ' stroke-dasharray="7 5"';
  const opacity = item.accepted ? 0.96 : 0.46;
  const width = item.class === 'site_perimeter_candidate' ? 5 : item.accepted ? 3 : 2;
  return `<line x1="${round(item.a[0])}" y1="${round(item.a[1])}" x2="${round(item.b[0])}" y2="${round(item.b[1])}" stroke="${color}" stroke-width="${width}" opacity="${opacity}" stroke-linecap="round"${dash}/>`;
}

function legendSvg(y) {
  let x = 18;
  return HIGH_CONTRAST_EDGE_CLASSES.map((name) => {
    const item = `<line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y}" stroke="${EDGE_COLORS[name]}" stroke-width="5"/><text x="${x + 42}" y="${y + 5}" font-size="13" fill="#111827" font-family="Inter, Arial, sans-serif">${escapeXml(name)}</text>`;
    x += name.length * 8 + 78;
    return item;
  }).join('\n');
}

function panelTitle(panel, width, text) {
  return `<rect x="${panel.x}" y="${panel.y}" width="${width}" height="32" fill="#111827"/><text x="${panel.x + 12}" y="${panel.y + 22}" fill="#fff" font-size="15" font-weight="700" font-family="Inter, Arial, sans-serif">${escapeXml(text)}</text>`;
}

function boundaryTypeForCandidate(edgeClass) {
  if (edgeClass === 'building_outline') return 'building_exclusion_edge';
  if (edgeClass === 'site_perimeter_candidate') return 'site_boundary_edge';
  if (edgeClass === 'road_boundary_candidate') return 'road_boundary_edge';
  if (edgeClass === 'paved_green_boundary') return 'paved_green_edge';
  return 'unknown_boundary_edge';
}

function siteSideForCandidate(item, site) {
  const horizontal = Math.abs(item.a[1] - item.b[1]) <= Math.abs(item.a[0] - item.b[0]);
  if (horizontal) {
    const cy = (item.a[1] + item.b[1]) / 2;
    const side = Math.abs(cy - site[1]) <= Math.abs(cy - (site[1] + site[3])) ? 'top' : 'bottom';
    const sideDistance = side === 'top' ? Math.abs(cy - site[1]) : Math.abs(cy - (site[1] + site[3]));
    const longEnough = item.length_px >= site[2] * 0.24;
    return sideDistance <= Math.max(72, site[3] * 0.13) && longEnough ? side : null;
  }
  const cx = (item.a[0] + item.b[0]) / 2;
  const side = Math.abs(cx - site[0]) <= Math.abs(cx - (site[0] + site[2])) ? 'left' : 'right';
  const sideDistance = side === 'left' ? Math.abs(cx - site[0]) : Math.abs(cx - (site[0] + site[2]));
  const longEnough = item.length_px >= site[3] * 0.24;
  return sideDistance <= Math.max(72, site[2] * 0.13) && longEnough ? side : null;
}

function distanceToSide(item, site, side) {
  if (side === 'top') return Math.abs((item.a[1] + item.b[1]) / 2 - site[1]);
  if (side === 'bottom') return Math.abs((item.a[1] + item.b[1]) / 2 - (site[1] + site[3]));
  if (side === 'left') return Math.abs((item.a[0] + item.b[0]) / 2 - site[0]);
  return Math.abs((item.a[0] + item.b[0]) / 2 - (site[0] + site[2]));
}

function outerPreferenceScore(item, site, side) {
  const sideDistance = distanceToSide(item, site, side);
  const span = side === 'top' || side === 'bottom' ? site[3] : site[2];
  return Math.max(0, 1 - sideDistance / Math.max(1, span * 0.18));
}

async function loadTopRaster(topImage) {
  const imagePath = path.resolve(repoRoot, topImage.image.path);
  const width = topImage.image.analysis_width || topImage.image.width || 900;
  const height = topImage.image.analysis_height || Math.round(width * (topImage.image.height || 1) / Math.max(1, topImage.image.width || 1));
  const { data, info } = await sharp(imagePath)
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, channels: info.channels };
}

async function rasterDataUrl(raster) {
  const buffer = await sharp(raster.buffer, {
    raw: { width: raster.width, height: raster.height, channels: raster.channels }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function grayDataUrl(values, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    rgba[index * 4] = value;
    rgba[index * 4 + 1] = value;
    rgba[index * 4 + 2] = value;
    rgba[index * 4 + 3] = 255;
  }
  const buffer = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function candidate(id, edgeClass, a, b, options = {}) {
  return {
    id,
    class: edgeClass,
    axis: options.axis || (Math.abs(a[1] - b[1]) <= Math.abs(a[0] - b[0]) ? 'x' : 'y'),
    a: a.map((value) => round(value)),
    b: b.map((value) => round(value)),
    length_px: round(distance(a, b)),
    confidence: round(options.confidence ?? 0.6),
    source_pixel_support_ratio: round(options.source_pixel_support_ratio ?? 0.65),
    source_edge_strength: round(options.source_edge_strength ?? 64),
    score: round(options.score ?? distance(a, b) * (options.confidence ?? 0.6)),
    accepted: Boolean(options.accepted),
    acceptance_reason: options.acceptance_reason || null,
    rejection_reason: options.rejection_reason || null,
    risk_flags: options.risk_flags || [],
    site_side: options.site_side || null,
    context: options.context || {}
  };
}

function mergeLineCandidates(candidates = []) {
  const merged = [];
  for (const item of candidates) {
    const existing = merged.find((candidateItem) => canMerge(candidateItem, item));
    if (!existing) {
      merged.push({ ...item });
      continue;
    }
    const axis = item.axis;
    const currentStart = axis === 'x' ? Math.min(existing.a[0], existing.b[0]) : Math.min(existing.a[1], existing.b[1]);
    const currentEnd = axis === 'x' ? Math.max(existing.a[0], existing.b[0]) : Math.max(existing.a[1], existing.b[1]);
    const itemStart = axis === 'x' ? Math.min(item.a[0], item.b[0]) : Math.min(item.a[1], item.b[1]);
    const itemEnd = axis === 'x' ? Math.max(item.a[0], item.b[0]) : Math.max(item.a[1], item.b[1]);
    const start = Math.min(currentStart, itemStart);
    const end = Math.max(currentEnd, itemEnd);
    const fixed = axis === 'x' ? average([existing.a[1], item.a[1]]) : average([existing.a[0], item.a[0]]);
    existing.a = axis === 'x' ? [round(start), round(fixed)] : [round(fixed), round(start)];
    existing.b = axis === 'x' ? [round(end), round(fixed)] : [round(fixed), round(end)];
    existing.length_px = round(end - start);
    existing.confidence = round(Math.max(existing.confidence, item.confidence));
    existing.source_pixel_support_ratio = round(Math.max(existing.source_pixel_support_ratio, item.source_pixel_support_ratio));
    existing.source_edge_strength = round(Math.max(existing.source_edge_strength, item.source_edge_strength));
    existing.score = round(Math.max(existing.score, item.score));
  }
  return merged.filter((item) => item.length_px >= 32);
}

function canMerge(a, b) {
  if (a.axis !== b.axis || a.class !== b.class) return false;
  const fixedA = a.axis === 'x' ? a.a[1] : a.a[0];
  const fixedB = b.axis === 'x' ? b.a[1] : b.a[0];
  if (Math.abs(fixedA - fixedB) > 5) return false;
  const a0 = a.axis === 'x' ? Math.min(a.a[0], a.b[0]) : Math.min(a.a[1], a.b[1]);
  const a1 = a.axis === 'x' ? Math.max(a.a[0], a.b[0]) : Math.max(a.a[1], a.b[1]);
  const b0 = b.axis === 'x' ? Math.min(b.a[0], b.b[0]) : Math.min(b.a[1], b.b[1]);
  const b1 = b.axis === 'x' ? Math.max(b.a[0], b.b[0]) : Math.max(b.a[1], b.b[1]);
  return !(b0 - a1 > 26 || a0 - b1 > 26);
}

function nonMaxBands(scores, radius) {
  const selected = [];
  for (const item of [...scores].sort((a, b) => b.support - a.support)) {
    if (selected.some((candidateItem) => Math.abs(candidateItem.value - item.value) <= radius)) continue;
    selected.push(item);
  }
  return selected.sort((a, b) => a.value - b.value);
}

function sobelAt(values, width, x, y, axis) {
  const a = values[(y - 1) * width + (x - 1)];
  const b = values[(y - 1) * width + x];
  const c = values[(y - 1) * width + (x + 1)];
  const d = values[y * width + (x - 1)];
  const f = values[y * width + (x + 1)];
  const g = values[(y + 1) * width + (x - 1)];
  const h = values[(y + 1) * width + x];
  const i = values[(y + 1) * width + (x + 1)];
  return axis === 'x'
    ? -a - 2 * d - g + c + 2 * f + i
    : -a - 2 * b - c + g + 2 * h + i;
}

function edgeVote(preprocessed, x, y, direction, radius) {
  for (let yy = y - radius; yy <= y + radius; yy += 1) {
    for (let xx = x - radius; xx <= x + radius; xx += 1) {
      if (xx < 0 || yy < 0 || xx >= preprocessed.width || yy >= preprocessed.height) continue;
      const index = yy * preprocessed.width + xx;
      if (direction === 'h' && preprocessed.horizontal[index]) return true;
      if (direction === 'v' && preprocessed.vertical[index]) return true;
    }
  }
  return false;
}

function strengthAt(preprocessed, x, y) {
  if (x < 0 || y < 0 || x >= preprocessed.width || y >= preprocessed.height) return 0;
  return preprocessed.strength[y * preprocessed.width + x] || 0;
}

function pixelSample(raster, x, y) {
  const xx = Math.max(0, Math.min(raster.width - 1, x));
  const yy = Math.max(0, Math.min(raster.height - 1, y));
  const index = (yy * raster.width + xx) * raster.channels;
  const r = raster.buffer[index] || 0;
  const g = raster.buffer[index + 1] || 0;
  const b = raster.buffer[index + 2] || 0;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const s = max <= 0 ? 0 : (max - min) / max;
  const v = max / 255;
  const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  const exg = 2 * g - r - b;
  const vegetation = exg > 18 && g > r + 8 && g > b + 4 && s > 0.12;
  const hardscape = s < 0.32 && v > 0.34 && v < 0.88;
  return { r, g, b, gray, s, v, vegetation, hardscape };
}

function localAverage(values, width, height, x, y, radius) {
  let total = 0;
  let count = 0;
  for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy += 2) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx += 2) {
      total += values[yy * width + xx];
      count += 1;
    }
  }
  return Math.round(total / Math.max(1, count));
}

function percentile(values, lowRatio, highRatio) {
  const bins = new Array(256).fill(0);
  for (const value of values) bins[value] += 1;
  const total = values.length;
  const pick = (ratio) => {
    const target = total * ratio;
    let cumulative = 0;
    for (let index = 0; index < bins.length; index += 1) {
      cumulative += bins[index];
      if (cumulative >= target) return index;
    }
    return 255;
  };
  return { low: pick(lowRatio), high: pick(highRatio) };
}

function buildingExclusionBoxes(topImage) {
  return (topImage?.observations || [])
    .filter((item) => BUILDING_HINTS.has(item.component_hint))
    .map((item) => normalizeBbox(item.bbox));
}

function parkingBoxesFor(topImage) {
  return (topImage?.observations || [])
    .filter((item) => PARKING_HINTS.has(item.component_hint))
    .map((item) => normalizeBbox(item.bbox));
}

function findTopImage(observations) {
  return observations.images?.find((image) => image.detected_view?.kind === 'top')
    || observations.images?.find((image) => image.view === 'top')
    || observations.images?.[0]
    || null;
}

function findObservation(image, hint) {
  return image?.observations?.find((item) => item.component_hint === hint || item.id === hint) || null;
}

function pointInLandCover(point, landCover, classes = []) {
  if (!landCover?.masks?.length) return false;
  return landCover.masks.some((mask) => classes.includes(mask.class) && pointInBbox(point, mask.bbox_px));
}

function pointInAnyBbox(point, boxes = []) {
  return boxes.some((box) => pointInBbox(point, box));
}

function pointInBbox([x, y], [bx, by, bw, bh] = [0, 0, 0, 0]) {
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

function distanceToSiteEdge([x, y], [sx, sy, sw, sh]) {
  return Math.min(Math.abs(x - sx), Math.abs(x - (sx + sw)), Math.abs(y - sy), Math.abs(y - (sy + sh)));
}

function normalizeBbox(bbox = [0, 0, 0, 0]) {
  const [x, y, w, h] = bbox.map((value) => Number(value) || 0);
  return [round(x), round(y), round(Math.max(0, w)), round(Math.max(0, h))];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function issue(severity, ruleId, message) {
  return { severity, rule_id: ruleId, message };
}

function correctionTargetsFromQa(qa = {}) {
  const targets = [];
  if ((qa.site_perimeter_confidence || 0) < 0.5) {
    targets.push({
      target: 'high_contrast_edge_v1.site_perimeter_candidates',
      action: 'inspect_rejected_site_perimeter_alternatives',
      reason: 'site perimeter confidence is low or incomplete'
    });
  }
  if ((qa.road_boundary_confidence || 0) < 0.45) {
    targets.push({
      target: 'high_contrast_edge_v1.candidate_edges',
      action: 'add_or_adjust_road_boundary_context',
      reason: 'road boundary edge confidence is low'
    });
  }
  return targets;
}

function missingHighContrastEdge(reason) {
  const qa = {
    ok: false,
    verdict: 'review',
    accepted_edge_count: 0,
    rejected_edge_count: 0,
    site_perimeter_confidence: 0,
    road_boundary_confidence: 0,
    building_outline_confidence: 0,
    roof_seam_rejection_count: 0,
    internal_strong_edge_rejection_count: 0,
    site_perimeter_sides_with_rejected_alternatives: 0,
    issues: [issue('review', reason, 'HighContrastEdge could not build raster edge evidence.')]
  };
  return {
    kind: 'high_contrast_edge_v1',
    version: 1,
    backend: 'unavailable',
    coordinate_convention: 'image_x_right_y_down',
    source_image: null,
    analysis_size: { width: 0, height: 0 },
    site_bbox_px: [0, 0, 0, 0],
    classes: HIGH_CONTRAST_EDGE_CLASSES,
    preprocessing: {},
    edge_pixel_count: 0,
    candidate_edges: [],
    site_perimeter_candidates: {},
    qa,
    correction_targets: correctionTargetsFromQa(qa)
  };
}

function stripDebug(value = {}) {
  const { _preprocess, ...rest } = value;
  return rest;
}

function average(values = [], fallback = 0) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function clamp255(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
