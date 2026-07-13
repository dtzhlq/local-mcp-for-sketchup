import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { buildStructureLineEvidence } from './opencv-structure-line-backend.mjs';
import { buildPerspectiveCalibrationHypotheses } from './perspective-calibration.mjs';

export const DETECTED_STRUCTURE_LINES_KIND = 'detected_structure_lines_v1';

export async function buildDetectedStructureLines(options = {}) {
  if (options.backend === 'legacy_sobel_local_hough') {
    return buildLegacyDetectedStructureLines(options);
  }
  const structureLineEvidence = options.structureLineEvidence || await buildStructureLineEvidence({
    sourceImagePath: options.sourceImagePath,
    sourceImage: options.sourceImage,
    maxWidth: options.maxWidth || 900,
    seedLimit: options.seedLimit || 96
  });
  const perspectiveCalibration = options.perspectiveCalibration || buildPerspectiveCalibrationHypotheses({
    structureLineEvidence,
    sourceStructureLineEvidence: 'structure-line-evidence.json'
  });
  return detectedStructureLinesCompatibilityV1({
    structureLineEvidence,
    perspectiveCalibration
  });
}

export async function buildLegacyDetectedStructureLines({
  sourceImagePath,
  sourceImage,
  maxWidth = 900,
  minLengthPx = 42
} = {}) {
  const raster = await loadGrayRaster(sourceImagePath, maxWidth);
  const sobel = computeSobel(raster);
  const threshold = percentile(sobel.magnitude.filter((value) => value > 0), 0.91);
  const localSegments = localShortLineCandidates({
    raster,
    sobel,
    threshold,
    minLengthPx
  });
  const houghFallback = localSegments.length >= 8
    ? []
    : houghLineCandidates({
      raster,
      sobel,
      threshold,
      minLengthPx: Math.max(90, minLengthPx * 2)
    });
  const rawCandidates = dedupeLines([...localSegments, ...houghFallback]);
  const cleanSeedCandidates = scoreCleanSeedLines({
    lines: rawCandidates,
    raster,
    sobel,
    threshold
  });
  const perspectiveSelection = selectPerspectiveAwareCleanSeedLines({
    lines: cleanSeedCandidates,
    imageSize: { width: raster.width, height: raster.height },
    limit: 18
  });
  const detected = perspectiveSelection.lines;
  const lineCandidates = detected.map((line, index) => ({
    id: `detected_line_${String(index + 1).padStart(3, '0')}`,
    source_image: sourceImage || sourceImagePath,
    line_px: normalizeLine(line.line_px),
    length_px: round(line.length_px),
    angle_deg: round(line.angle_deg),
    support_score: round(line.support_score),
    source_kind: 'raster_detected_line',
    accepted_for_vp_clustering: line.accepted_for_vp_clustering,
    rejection_reason: line.rejection_reason,
    extraction_method: line.extraction_method,
    clean_seed_score: round(line.clean_seed_score),
    isolation_score: round(line.isolation_score),
    clutter_score: round(line.clutter_score),
    nearby_candidate_count: line.nearby_candidate_count,
    touches_image_border: line.touches_image_border === true,
    perspective_family_id: line.perspective_family_id || null,
    perspective_role: line.perspective_role || 'clean_seed_unassigned',
    angle_bucket_deg: angleBucket(line.angle_deg),
    tile_px: line.tile_px
  }));
  const vpClusters = clusterVanishingPoints({
    lines: lineCandidates.filter((line) => line.accepted_for_vp_clustering),
    imageSize: { width: raster.width, height: raster.height }
  });
  const acceptedVpClusters = vpClusters.filter((cluster) => cluster.accepted);
  const nonVerticalCount = lineCandidates.filter((line) => isNonVertical(line.angle_deg)).length;
  const qa = qaForDetectedLines({
    lineCandidates,
    nonVerticalCount,
    acceptedVpClusters,
    perspectiveHypothesis: perspectiveSelection.perspective_hypothesis
  });
  return {
    kind: DETECTED_STRUCTURE_LINES_KIND,
    version: 1,
    source_image: {
      id: 'source_image_1',
      source_image: sourceImage || sourceImagePath,
      width: raster.width,
      height: raster.height
    },
    backend: 'sharp_sobel_local_short_segments_vp_cluster_v1',
    preprocess: {
      grayscale: true,
      edge_method: 'sobel_magnitude_percentile_threshold_local_short_segment_hough',
      edge_threshold: round(threshold),
      local_tile_px: 128,
      local_tile_step_px: 64,
      global_hough_fallback_enabled: houghFallback.length > 0,
      selection_policy: 'perspective_aware_clean_isolated_short_line_seeds',
      clean_seed_limit: 18,
      hough_theta_step_deg: 2,
      hough_rho_step_px: 4,
      min_length_px: minLengthPx
    },
    perspective_hypothesis: perspectiveSelection.perspective_hypothesis,
    line_candidates: lineCandidates,
    vanishing_point_clusters: vpClusters,
    qa,
    summary: {
      line_candidate_count: lineCandidates.length,
      raw_line_candidate_count: rawCandidates.length,
      clean_seed_candidate_count: cleanSeedCandidates.length,
      perspective_model: perspectiveSelection.perspective_hypothesis.model,
      finite_vp_family_count: perspectiveSelection.perspective_hypothesis.finite_vp_family_count,
      parallel_family_count: perspectiveSelection.perspective_hypothesis.parallel_family_count,
      non_vertical_line_count: nonVerticalCount,
      vp_cluster_count: vpClusters.length,
      accepted_vp_cluster_count: acceptedVpClusters.length
    }
  };
}

function detectedStructureLinesCompatibilityV1({
  structureLineEvidence,
  perspectiveCalibration
}) {
  const segmentById = new Map(structureLineEvidence.raw_segments.map((segment) => [segment.id, segment]));
  const selectedSegments = structureLineEvidence.seed_segment_ids
    .map((id) => segmentById.get(id))
    .filter(Boolean);
  const familyBySegmentId = new Map();
  for (const family of perspectiveCalibration.direction_families) {
    for (const segmentId of family.support_segment_ids) {
      familyBySegmentId.set(segmentId, family);
    }
  }
  const compatibilityIdBySegmentId = new Map();
  const lineCandidates = selectedSegments.map((segment, index) => {
    const id = `detected_line_${String(index + 1).padStart(3, '0')}`;
    compatibilityIdBySegmentId.set(segment.id, id);
    const family = familyBySegmentId.get(segment.id) || null;
    const horizontalFamily = family?.role === 'horizontal_candidate';
    return {
      id,
      source_image: structureLineEvidence.source_image.source_image,
      line_px: segment.line_px,
      length_px: segment.length_px,
      angle_deg: segment.angle_deg,
      support_score: segment.feature_scores.edge_support,
      source_kind: 'raster_detected_line',
      accepted_for_vp_clustering: horizontalFamily,
      rejection_reason: horizontalFamily ? null : 'seed_not_in_selected_horizontal_direction_family',
      extraction_method: 'opencv_wasm_multiscale_houghp',
      clean_seed_score: segment.feature_scores.seed_quality,
      isolation_score: null,
      clutter_score: null,
      nearby_candidate_count: segment.feature_scores.local_density,
      touches_image_border: false,
      perspective_family_id: family?.id || null,
      perspective_role: family?.role || 'balanced_seed_unassigned',
      evidence_segment_id: segment.id,
      angle_bucket_deg: angleBucket(segment.angle_deg),
      tile_px: null
    };
  });
  const horizontalFamilies = perspectiveCalibration.direction_families.filter((family) => family.role === 'horizontal_candidate');
  const vpClusters = horizontalFamilies.map((family, index) => ({
    id: `vp_cluster_${index + 1}`,
    vanishing_point_px: family.vanishing_point_px || [
      family.image_direction_px?.[0] || 0,
      family.image_direction_px?.[1] || 0
    ],
    support_line_ids: family.seed_segment_ids
      .map((segmentId) => compatibilityIdBySegmentId.get(segmentId))
      .filter(Boolean),
    support_count: family.support_count,
    accepted: false,
    rejection_reason: 'accepted_calibration_review_required'
  }));
  const finiteCount = horizontalFamilies.filter((family) => family.vanishing_type === 'finite').length;
  const verticalParallel = perspectiveCalibration.direction_families.some((family) => (
    family.role === 'vertical_candidate' && family.vanishing_type === 'infinite'
  ));
  const cameraModel = perspectiveCalibration.camera_model_candidates[0]?.model || 'unknown';
  return {
    kind: DETECTED_STRUCTURE_LINES_KIND,
    version: 1,
    source_image: { ...structureLineEvidence.source_image },
    backend: 'opencv_wasm_multiscale_houghp_v1_compatibility_projection',
    preprocess: {
      selection_policy: 'raw_eligible_seed_three_layer_compatibility_projection',
      neighbor_density_is_hard_rejection: false,
      seed_limit: structureLineEvidence.summary.seed_segment_count
    },
    perspective_hypothesis: {
      model: cameraModel,
      review_required: true,
      promotion_allowed: false,
      finite_vp_family_count: finiteCount,
      parallel_family_count: verticalParallel ? 1 : 0,
      selected_seed_count: selectedSegments.length,
      family_summaries: horizontalFamilies.map((family) => ({
        id: family.id,
        type: family.vanishing_type,
        vanishing_point_px: family.vanishing_point_px,
        image_direction_px: family.image_direction_px,
        support_count: family.support_count,
        selected_line_count: family.seed_segment_ids.length,
        score: family.confidence
      })),
      blockers: perspectiveCalibration.review_policy.blockers,
      notes: [
        'Compatibility projection only. structure-line-evidence.json and perspective-calibration-hypotheses.json are authoritative.',
        'Axis labels remain unassigned until accepted calibration review.'
      ]
    },
    line_candidates: lineCandidates,
    vanishing_point_clusters: vpClusters,
    qa: {
      status: 'blocked_vanishing_point_cluster_review_required',
      usable_for_axis_calibration: false,
      blockers: perspectiveCalibration.review_policy.blockers,
      notes: [
        'Two direction families can be ready for review without being accepted for calibration.',
        'No review means no rectification, topology derivation, PartGraph, or SketchUp promotion.'
      ]
    },
    summary: {
      line_candidate_count: lineCandidates.length,
      raw_line_candidate_count: structureLineEvidence.summary.raw_segment_count,
      clean_seed_candidate_count: structureLineEvidence.summary.seed_segment_count,
      perspective_model: cameraModel,
      finite_vp_family_count: finiteCount,
      parallel_family_count: verticalParallel ? 1 : 0,
      non_vertical_line_count: lineCandidates.filter((line) => isNonVertical(line.angle_deg)).length,
      vp_cluster_count: vpClusters.length,
      accepted_vp_cluster_count: 0
    },
    source_structure_line_evidence: 'structure-line-evidence.json',
    source_perspective_calibration_hypotheses: 'perspective-calibration-hypotheses.json'
  };
}

export function renderDetectedStructureLinesMarkdown(graph) {
  return `# Detected Structure Lines

- kind: \`${graph.kind}\`
- backend: \`${graph.backend}\`
- status: \`${graph.qa.status}\`
- usable_for_axis_calibration: \`${String(graph.qa.usable_for_axis_calibration === true)}\`
- blockers: ${graph.qa.blockers.length ? graph.qa.blockers.map((blocker) => `\`${blocker}\``).join(', ') : 'none'}

## Summary

- line candidates: \`${graph.summary.line_candidate_count}\`
- raw line candidates before clean-seed selection: \`${graph.summary.raw_line_candidate_count || graph.summary.line_candidate_count}\`
- clean seed candidates: \`${graph.summary.clean_seed_candidate_count || graph.summary.line_candidate_count}\`
- perspective model: \`${graph.perspective_hypothesis?.model || 'not_available'}\`
- finite VP families: \`${graph.perspective_hypothesis?.finite_vp_family_count ?? 0}\`
- parallel families: \`${graph.perspective_hypothesis?.parallel_family_count ?? 0}\`
- non-vertical lines: \`${graph.summary.non_vertical_line_count}\`
- VP clusters: \`${graph.summary.vp_cluster_count}\`
- accepted VP clusters: \`${graph.summary.accepted_vp_cluster_count}\`

## Vanishing Point Clusters

| id | accepted | support | vp px | rejection |
| --- | --- | ---: | --- | --- |
${graph.vanishing_point_clusters.map((cluster) => `| ${cluster.id} | ${String(cluster.accepted)} | ${cluster.support_count} | [${cluster.vanishing_point_px.join(', ')}] | ${cluster.rejection_reason || 'none'} |`).join('\n')}
`;
}

export async function prepareDetectedStructureLineImageDataUrl(sourceImagePath) {
  const data = await fs.readFile(sourceImagePath);
  imageDataUrl.cache.set(sourceImagePath, data.toString('base64'));
}

export function renderDetectedStructureLinesOverlaySvg(graph, sourceImagePath) {
  const image = graph.source_image;
  const dataUrl = imageDataUrl(sourceImagePath);
  const acceptedClusterLineIds = new Set(
    graph.vanishing_point_clusters
      .filter((cluster) => cluster.accepted)
      .flatMap((cluster) => cluster.support_line_ids)
  );
  const lines = graph.line_candidates.map((line) => {
    const clustered = acceptedClusterLineIds.has(line.id);
    const color = clustered ? '#dc2626' : perspectiveRoleColor(line.perspective_role, line.accepted_for_vp_clustering);
    return `<line data-layer="detected-structure-line" x1="${line.line_px.a[0]}" y1="${line.line_px.a[1]}" x2="${line.line_px.b[0]}" y2="${line.line_px.b[1]}" stroke="${color}" stroke-width="${clustered ? 4 : 3}" stroke-opacity="${clustered ? 0.9 : 0.82}" stroke-linecap="round">
  <title>${escapeXml(`${line.id} role=${line.perspective_role || 'unknown'} family=${line.perspective_family_id || 'none'} angle=${line.angle_deg} clean=${line.clean_seed_score ?? 'n/a'} isolation=${line.isolation_score ?? 'n/a'} clutter=${line.clutter_score ?? 'n/a'} nearby=${line.nearby_candidate_count ?? 'n/a'} border=${String(line.touches_image_border === true)} ${line.rejection_reason || ''}`)}</title>
</line>`;
  }).join('\n');
  const vps = graph.vanishing_point_clusters.map((cluster, index) => {
    const [x, y] = cluster.vanishing_point_px;
    if (x < -image.width * 2 || x > image.width * 3 || y < -image.height * 2 || y > image.height * 3) return '';
    return `<g data-layer="vanishing-point-cluster">
  <circle cx="${x}" cy="${y}" r="${cluster.accepted ? 8 : 5}" fill="${cluster.accepted ? '#dc2626' : '#64748b'}" fill-opacity="0.85"/>
  <text x="${x + 10}" y="${y - 10}" font-size="13" fill="#111827" stroke="white" stroke-width="3" paint-order="stroke">VP${index + 1}:${cluster.support_count}</text>
</g>`;
  }).join('\n');
  const legend = `<g>
  <rect x="18" y="18" width="560" height="132" fill="white" fill-opacity="0.9" stroke="#cbd5e1"/>
  <text x="30" y="43" font-size="16" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Detected Structure Lines</text>
  <text x="30" y="66" font-size="12" fill="#334155" font-family="Arial, sans-serif">Raster-only clean isolated short-line seeds; no A/B/C/D or seeded topology input.</text>
  <text x="30" y="88" font-size="12" fill="#334155" font-family="Arial, sans-serif">status=${escapeXml(graph.qa.status)}; model=${escapeXml(graph.perspective_hypothesis?.model || 'unknown')}; accepted VP clusters=${graph.summary.accepted_vp_cluster_count}</text>
  <text x="30" y="110" font-size="12" fill="#334155" font-family="Arial, sans-serif">Two-point keeps separate VP families; single-point keeps VP + parallel seeds.</text>
  <text x="30" y="132" font-size="12" fill="#334155" font-family="Arial, sans-serif">Colors are perspective seed roles, not accepted red/green axes.</text>
</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">
<image href="${dataUrl}" width="${image.width}" height="${image.height}"/>
${lines}
${vps}
${legend}
</svg>
`;
}

export function lineCandidatesFromDetectedStructureLines(graph = {}) {
  return (graph.line_candidates || []).map((line) => ({
    id: `candidate_${line.id}`,
    source_image: line.source_image,
    line_px: line.line_px,
    axis_assignment: 'axis_unknown',
    allowed_axes: ['x_red', 'y_green', 'reject'],
    source_kind: 'detected_structure_line_candidate',
    source_family_hint: null,
    source_evidence_ids: [line.id],
    confidence: line.support_score,
    review_required: true,
    promotion_allowed: false,
    notes: [
      'Raster-detected line candidate. Eligible for VP clustering before axis review.',
      `extraction_method=${line.extraction_method || 'unknown'}`,
      `accepted_for_vp_clustering=${String(line.accepted_for_vp_clustering)}`
    ]
  }));
}

function loadGrayRaster(sourceImagePath, maxWidth) {
  return sharp(sourceImagePath)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({
      data: Uint8Array.from(data),
      width: info.width,
      height: info.height
    }));
}

function computeSobel(raster) {
  const { width, height, data } = raster;
  const magnitude = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const tl = data[(y - 1) * width + x - 1];
      const tc = data[(y - 1) * width + x];
      const tr = data[(y - 1) * width + x + 1];
      const ml = data[y * width + x - 1];
      const mr = data[y * width + x + 1];
      const bl = data[(y + 1) * width + x - 1];
      const bc = data[(y + 1) * width + x];
      const br = data[(y + 1) * width + x + 1];
      const gx = -tl - (2 * ml) - bl + tr + (2 * mr) + br;
      const gy = -tl - (2 * tc) - tr + bl + (2 * bc) + br;
      magnitude[i] = Math.hypot(gx, gy);
    }
  }
  return { magnitude, width, height };
}

function houghLineCandidates({
  raster,
  sobel,
  threshold,
  minLengthPx
}) {
  const { width, height } = raster;
  const points = [];
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const mag = sobel.magnitude[y * width + x];
      if (mag >= threshold) points.push({ x, y, mag });
    }
  }
  const rhoStep = 4;
  const thetaStep = 2;
  const rhoMax = Math.ceil(Math.hypot(width, height));
  const rhoBins = Math.ceil((rhoMax * 2) / rhoStep) + 1;
  const thetaValues = [];
  for (let theta = 0; theta < 180; theta += thetaStep) {
    thetaValues.push(theta * Math.PI / 180);
  }
  const accumulator = new Float32Array(thetaValues.length * rhoBins);
  for (const point of points) {
    for (let ti = 0; ti < thetaValues.length; ti += 1) {
      const theta = thetaValues[ti];
      const rho = point.x * Math.cos(theta) + point.y * Math.sin(theta);
      const ri = Math.round((rho + rhoMax) / rhoStep);
      accumulator[ti * rhoBins + ri] += Math.min(point.mag, 255);
    }
  }
  const peaks = [];
  for (let ti = 0; ti < thetaValues.length; ti += 1) {
    for (let ri = 0; ri < rhoBins; ri += 1) {
      const score = accumulator[ti * rhoBins + ri];
      if (score < 12000) continue;
      peaks.push({ ti, ri, score });
    }
  }
  peaks.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const peak of peaks) {
    if (selected.some((item) => Math.abs(item.ti - peak.ti) <= 3 && Math.abs(item.ri - peak.ri) <= 4)) continue;
    selected.push(peak);
    if (selected.length >= 80) break;
  }
  const candidates = [];
  for (const peak of selected) {
    const theta = thetaValues[peak.ti];
    const rho = (peak.ri * rhoStep) - rhoMax;
    const dir = [-Math.sin(theta), Math.cos(theta)];
    const support = points
      .filter((point) => Math.abs((point.x * Math.cos(theta) + point.y * Math.sin(theta)) - rho) <= 2.5)
      .map((point) => ({
        ...point,
        t: (point.x * dir[0]) + (point.y * dir[1])
      }))
      .sort((a, b) => a.t - b.t);
    if (support.length < 18) continue;
    const run = strongestContinuousRun(support);
    if (!run || run.points.length < 14) continue;
    const projected = run.points.map((point) => point.t);
    const minT = Math.min(...projected);
    const maxT = Math.max(...projected);
    const length = maxT - minT;
    if (length < minLengthPx) continue;
    const base = [rho * Math.cos(theta), rho * Math.sin(theta)];
    const line = {
      a: [base[0] + dir[0] * minT, base[1] + dir[1] * minT],
      b: [base[0] + dir[0] * maxT, base[1] + dir[1] * maxT]
    };
    const angle = normalizeLineAngle(Math.atan2(line.b[1] - line.a[1], line.b[0] - line.a[0]) * 180 / Math.PI);
    const verticalish = !isNonVertical(angle);
    const supportScore = clamp01((run.points.length / Math.max(1, length)) * 2.3);
    candidates.push({
      line_px: clipLineToImage(line, width, height),
      length_px: length,
      angle_deg: angle,
      support_score: supportScore,
      extraction_method: 'global_hough_continuous_run_fallback',
      accepted_for_vp_clustering: !verticalish && supportScore >= 0.18,
      rejection_reason: verticalish
        ? 'vertical_line_not_used_for_red_green_vp_clustering'
        : supportScore < 0.18
          ? 'weak_edge_support'
          : null
    });
  }
  return dedupeLines(candidates)
    .sort((a, b) => b.length_px * b.support_score - a.length_px * a.support_score)
    .slice(0, 40);
}

function localShortLineCandidates({
  raster,
  sobel,
  threshold,
  minLengthPx
}) {
  const { width, height } = raster;
  const tileSize = 128;
  const step = 64;
  const rhoStep = 3;
  const angleValues = [
    -82, -74, -66, -58, -50, -42, -34, -26, -18, -12, -8, -4,
    0, 4, 8, 12, 18, 26, 34, 42, 50, 58, 66, 74, 82
  ];
  const candidates = [];
  for (let tileY = 0; tileY < height; tileY += step) {
    for (let tileX = 0; tileX < width; tileX += step) {
      const x0 = tileX;
      const y0 = tileY;
      const x1 = Math.min(width - 1, tileX + tileSize);
      const y1 = Math.min(height - 1, tileY + tileSize);
      const points = [];
      for (let y = y0 + 1; y < y1 - 1; y += 1) {
        for (let x = x0 + 1; x < x1 - 1; x += 1) {
          const mag = sobel.magnitude[y * width + x];
          if (mag >= threshold) points.push({ x, y, mag });
        }
      }
      if (points.length < 18) continue;
      for (const angleDeg of angleValues) {
        const angle = angleDeg * Math.PI / 180;
        const dir = [Math.cos(angle), Math.sin(angle)];
        const normal = [-Math.sin(angle), Math.cos(angle)];
        const bins = new Map();
        for (const point of points) {
          const rho = point.x * normal[0] + point.y * normal[1];
          const key = Math.round(rho / rhoStep);
          bins.set(key, (bins.get(key) || 0) + Math.min(point.mag, 255));
        }
        const peaks = [...bins.entries()]
          .map(([key, score]) => ({ key: Number(key), score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);
        for (const peak of peaks) {
          if (peak.score < 2200) continue;
          const rho = peak.key * rhoStep;
          const support = points
            .filter((point) => Math.abs((point.x * normal[0] + point.y * normal[1]) - rho) <= 2.5)
            .map((point) => ({
              ...point,
              t: point.x * dir[0] + point.y * dir[1]
            }))
            .sort((a, b) => a.t - b.t);
          if (support.length < 10) continue;
          const run = strongestContinuousRun(support, 9);
          if (!run || run.points.length < 8) continue;
          const projected = run.points.map((point) => point.t);
          const minT = Math.min(...projected);
          const maxT = Math.max(...projected);
          const length = maxT - minT;
          if (length < minLengthPx) continue;
          const base = [rho * normal[0], rho * normal[1]];
          const line = {
            a: [base[0] + dir[0] * minT, base[1] + dir[1] * minT],
            b: [base[0] + dir[0] * maxT, base[1] + dir[1] * maxT]
          };
          const supportScore = clamp01((run.points.length / Math.max(1, length)) * 1.8);
          const normalizedAngle = normalizeLineAngle(angleDeg);
          const verticalish = !isNonVertical(normalizedAngle);
          candidates.push({
            line_px: clipLineToImage(line, width, height),
            length_px: length,
            angle_deg: normalizedAngle,
            support_score: supportScore,
            extraction_method: 'local_short_segment_hough',
            tile_px: [x0, y0, x1 - x0, y1 - y0],
            accepted_for_vp_clustering: !verticalish && supportScore >= 0.24,
            rejection_reason: verticalish
              ? 'vertical_line_not_used_for_red_green_vp_clustering'
              : supportScore < 0.24
                ? 'weak_local_segment_support'
                : null
          });
        }
      }
    }
  }
  return candidates;
}

function strongestContinuousRun(points, maxGap = 18) {
  const runs = [];
  let current = [];
  for (const point of points) {
    const last = current[current.length - 1];
    if (last && Math.abs(point.t - last.t) > maxGap) {
      if (current.length) runs.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) runs.push(current);
  let best = null;
  for (const run of runs) {
    const span = run[run.length - 1].t - run[0].t;
    const strength = run.reduce((sum, point) => sum + Math.min(point.mag, 255), 0);
    const score = span * 0.65 + strength * 0.004 + run.length * 2;
    if (!best || score > best.score) {
      best = {
        points: run,
        span,
        score
      };
    }
  }
  return best;
}

function scoreCleanSeedLines({
  lines,
  raster,
  sobel,
  threshold
}) {
  const scored = lines.map((line) => ({
    ...line,
    ...cleanSeedContextScore({
      line,
      raster,
      sobel,
      threshold
    })
  }));
  for (const line of scored) {
    const midpoint = lineMidpoint(line.line_px);
    const nearby = scored.filter((other) => {
      if (other === line) return false;
      if (distance(midpoint, lineMidpoint(other.line_px)) > 72) return false;
      return true;
    });
    line.nearby_candidate_count = nearby.length;
    const neighborPenalty = clamp01(nearby.length / 14) * 0.46;
    const lengthPenalty = line.length_px > 170 ? clamp01((line.length_px - 170) / 120) * 0.18 : 0;
    const borderPenalty = line.touches_image_border ? 0.36 : 0;
    line.clean_seed_score = clamp01(
      line.support_score * 0.34
      + line.isolation_score * 0.46
      + line.sparsity_score * 0.18
      + line.length_preference_score * 0.12
      - neighborPenalty
      - lengthPenalty
      - borderPenalty
    );
    if (line.clean_seed_score < 0.42) {
      line.accepted_for_vp_clustering = false;
      line.rejection_reason = line.rejection_reason || 'clean_seed_score_below_threshold';
    }
  }
  return scored.sort((a, b) => b.clean_seed_score - a.clean_seed_score);
}

function cleanSeedContextScore({
  line,
  raster,
  sobel,
  threshold
}) {
  const { width, height } = raster;
  const a = line.line_px.a;
  const b = line.line_px.b;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const borderMargin = Math.min(
    a[0],
    b[0],
    a[1],
    b[1],
    width - a[0],
    width - b[0],
    height - a[1],
    height - b[1]
  );
  const dir = [dx / length, dy / length];
  const normal = [-dir[1], dir[0]];
  const padding = 22;
  const minX = Math.max(1, Math.floor(Math.min(a[0], b[0]) - padding));
  const maxX = Math.min(width - 2, Math.ceil(Math.max(a[0], b[0]) + padding));
  const minY = Math.max(1, Math.floor(Math.min(a[1], b[1]) - padding));
  const maxY = Math.min(height - 2, Math.ceil(Math.max(a[1], b[1]) + padding));
  let edgeCount = 0;
  let supportBandCount = 0;
  let clutterBandCount = 0;
  let farClutterCount = 0;
  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const mag = sobel.magnitude[y * width + x];
      if (mag < threshold) continue;
      const vx = x - a[0];
      const vy = y - a[1];
      const t = vx * dir[0] + vy * dir[1];
      const perp = Math.abs(vx * normal[0] + vy * normal[1]);
      if (t < -10 || t > length + 10 || perp > 18) continue;
      edgeCount += 1;
      if (t >= 0 && t <= length && perp <= 2.75) {
        supportBandCount += 1;
      } else if (perp <= 8) {
        clutterBandCount += 1;
      } else {
        farClutterCount += 1;
      }
    }
  }
  const clutterCount = clutterBandCount + farClutterCount;
  const isolationScore = edgeCount
    ? clamp01(supportBandCount / Math.max(1, supportBandCount + clutterCount))
    : 0;
  const clutterScore = edgeCount ? clamp01(clutterCount / edgeCount) : 1;
  const sampledArea = Math.max(1, ((maxX - minX + 1) * (maxY - minY + 1)) / 4);
  const localEdgeDensity = edgeCount / sampledArea;
  const sparsityScore = clamp01(1 - (localEdgeDensity / 0.16));
  const lengthPreferenceScore = length <= 150
    ? clamp01((length - 36) / 78)
    : clamp01(1 - ((length - 150) / 150));
  return {
    isolation_score: isolationScore,
    clutter_score: clutterScore,
    sparsity_score: sparsityScore,
    local_edge_density: localEdgeDensity,
    length_preference_score: lengthPreferenceScore,
    touches_image_border: borderMargin < 8,
    support_band_edge_count: supportBandCount,
    clutter_edge_count: clutterCount
  };
}

function selectCleanSeedLines(lines, limit) {
  const selected = [];
  for (const line of lines) {
    if (line.clean_seed_score < 0.4) continue;
    const midpoint = lineMidpoint(line.line_px);
    const tooClose = selected.some((item) => {
      const itemMidpoint = lineMidpoint(item.line_px);
      if (distance(midpoint, itemMidpoint) < 58) return true;
      return lineDistanceApprox(item.line_px, line.line_px) < 24
        && acuteAngleDelta(item.angle_deg, line.angle_deg) < 18;
    });
    if (tooClose) continue;
    selected.push(line);
    if (selected.length >= limit) break;
  }
  return selected;
}

function selectPerspectiveAwareCleanSeedLines({
  lines,
  imageSize,
  limit
}) {
  const cleanLines = lines
    .filter((line) => line.clean_seed_score >= 0.32 && !line.touches_image_border)
    .sort((a, b) => perspectiveSeedRank(b) - perspectiveSeedRank(a));
  const finiteFamilies = buildProvisionalVpFamilies({
    lines: cleanLines.filter((line) => isNonVertical(line.angle_deg)),
    imageSize
  });
  const selectedFiniteFamilies = selectDistinctVpFamilies(finiteFamilies, imageSize, 2);
  const selected = [];
  const selectedSet = new Set();
  const familySummaries = [];

  for (let index = 0; index < selectedFiniteFamilies.length; index += 1) {
    const family = selectedFiniteFamilies[index];
    const familyId = `finite_vp_family_${index + 1}`;
    const support = family.support
      .filter((line) => line.clean_seed_score >= 0.4)
      .sort((a, b) => perspectiveSeedRank(b) - perspectiveSeedRank(a))
      .slice(0, index === 0 ? 4 : 3);
    let selectedLineCount = 0;
    for (const line of support) {
      const added = addPerspectiveSeed({
        selected,
        selectedSet,
        line,
        familyId,
        role: familyId,
        acceptForVp: true,
        minDistancePx: 38
      });
      if (added) selectedLineCount += 1;
    }
    familySummaries.push({
      id: familyId,
      type: 'finite_vp',
      vanishing_point_px: family.vp.map((value) => round(value)),
      support_count: family.support.length,
      selected_line_count: selectedLineCount,
      score: round(family.score),
      angle_buckets: uniqueNumbers(family.support.map((line) => angleBucket(line.angle_deg))).sort((a, b) => a - b)
    });
  }

  const parallelFamilies = selectedFiniteFamilies.length <= 1
    ? buildParallelFamilies({
      lines: cleanLines,
      excluded: selectedSet,
      finiteFamilies: selectedFiniteFamilies
    })
    : [];
  const selectedParallelFamilies = parallelFamilies.slice(0, selectedFiniteFamilies.length ? 1 : 2);
  for (let index = 0; index < selectedParallelFamilies.length; index += 1) {
    const family = selectedParallelFamilies[index];
    const familyId = `parallel_family_${index + 1}`;
    const support = family.lines
      .sort((a, b) => perspectiveSeedRank(b) - perspectiveSeedRank(a))
      .slice(0, 4);
    let selectedLineCount = 0;
    for (const line of support) {
      const added = addPerspectiveSeed({
        selected,
        selectedSet,
        line,
        familyId,
        role: 'parallel_axis_seed',
        acceptForVp: false,
        rejectionReason: 'parallel_axis_seed_for_single_point_or_parallel_family_hypothesis',
        minDistancePx: 44
      });
      if (added) selectedLineCount += 1;
    }
    familySummaries.push({
      id: familyId,
      type: 'parallel_angle',
      angle_bucket_deg: family.angle_bucket_deg,
      support_count: family.lines.length,
      selected_line_count: selectedLineCount,
      score: round(family.score)
    });
  }

  if (selected.length < 4 || selectedFiniteFamilies.length === 0) {
    for (const line of cleanLines) {
      if (selected.length >= limit) break;
      addPerspectiveSeed({
        selected,
        selectedSet,
        line,
        familyId: null,
        role: 'clean_seed_fallback',
        acceptForVp: line.clean_seed_score >= 0.42 && isNonVertical(line.angle_deg),
        minDistancePx: 72
      });
    }
  }

  const finiteCount = selectedFiniteFamilies.length;
  const parallelCount = selectedParallelFamilies.length;
  const model = finiteCount >= 2
    ? 'two_point_candidate'
    : finiteCount === 1 && parallelCount >= 1
      ? 'one_finite_vp_plus_parallel_candidate'
      : finiteCount === 1
        ? 'single_finite_vp_candidate_parallel_missing'
        : parallelCount >= 1
          ? 'parallel_only_or_single_point_candidate'
          : 'unknown_insufficient_clean_direction_evidence';
  return {
    lines: selected.slice(0, limit),
    perspective_hypothesis: {
      model,
      review_required: true,
      promotion_allowed: false,
      finite_vp_family_count: finiteCount,
      parallel_family_count: parallelCount,
      selected_seed_count: Math.min(selected.length, limit),
      family_summaries: familySummaries,
      blockers: perspectiveBlockers({ finiteCount, parallelCount }),
      notes: [
        'Clean seed selection is perspective-aware: do not let one dominant vanishing direction consume all line seeds.',
        'Two-point candidates require two distinct finite VP families.',
        'Single-point candidates keep one finite VP family plus near-parallel seeds for the other image axis.'
      ]
    }
  };
}

function buildProvisionalVpFamilies({ lines, imageSize }) {
  const candidates = [];
  const maxDistance = Math.max(imageSize.width, imageSize.height) * 8;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const first = lines[i];
      const second = lines[j];
      const angleDelta = acuteAngleDelta(first.angle_deg, second.angle_deg);
      if (angleDelta < 7 || angleDelta > 70) continue;
      const vp = lineIntersection(first.line_px, second.line_px);
      if (!vp) continue;
      if (Math.abs(vp[0]) > maxDistance || Math.abs(vp[1]) > maxDistance) continue;
      const support = lines.filter((line) => (
        line.clean_seed_score >= 0.32
        && lineSupportsVanishingPoint(line, vp, 4.25)
      ));
      if (support.length < 2) continue;
      const angleBuckets = uniqueNumbers(support.map((line) => angleBucket(line.angle_deg)));
      const score = support.reduce((sum, line) => sum + Number(line.clean_seed_score || 0), 0)
        + angleBuckets.length * 0.18
        - inImageVpPenalty(vp, imageSize);
      candidates.push({ vp, support, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const families = [];
  const mergeDistance = Math.max(imageSize.width, imageSize.height) * 0.2;
  for (const candidate of candidates) {
    if (families.some((family) => distance(family.vp, candidate.vp) < mergeDistance)) continue;
    families.push(candidate);
    if (families.length >= 8) break;
  }
  return families;
}

function selectDistinctVpFamilies(families, imageSize, limit) {
  const selected = [];
  const minDistance = Math.max(imageSize.width, imageSize.height) * 0.32;
  for (const family of families) {
    if (selected.some((item) => distance(item.vp, family.vp) < minDistance)) continue;
    if (selected.some((item) => familySupportOverlapRatio(item.support, family.support) > 0.55)) continue;
    selected.push(family);
    if (selected.length >= limit) break;
  }
  return selected;
}

function buildParallelFamilies({ lines, excluded, finiteFamilies }) {
  const finiteSupport = new Set(finiteFamilies.flatMap((family) => family.support));
  const buckets = new Map();
  for (const line of lines) {
    if (excluded.has(line)) continue;
    if (finiteSupport.has(line)) continue;
    if (line.clean_seed_score < 0.34) continue;
    if (!isNonVertical(line.angle_deg)) continue;
    const key = angleBucket(line.angle_deg);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(line);
  }
  return [...buckets.entries()]
    .map(([angle, bucketLines]) => ({
      angle_bucket_deg: Number(angle),
      lines: bucketLines,
      score: bucketLines.reduce((sum, line) => sum + Number(line.clean_seed_score || 0), 0)
        + Math.min(bucketLines.length, 4) * 0.12
    }))
    .filter((family) => family.lines.length >= 2)
    .sort((a, b) => b.score - a.score);
}

function addPerspectiveSeed({
  selected,
  selectedSet,
  line,
  familyId,
  role,
  acceptForVp,
  rejectionReason = null,
  minDistancePx
}) {
  if (selectedSet.has(line)) return false;
  const midpoint = lineMidpoint(line.line_px);
  const tooClose = selected.some((item) => (
    distance(midpoint, lineMidpoint(item.line_px)) < minDistancePx
    && acuteAngleDelta(item.angle_deg, line.angle_deg) < 18
  ));
  if (tooClose) return false;
  line.perspective_family_id = familyId;
  line.perspective_role = role;
  line.accepted_for_vp_clustering = acceptForVp && line.clean_seed_score >= 0.4 && isNonVertical(line.angle_deg);
  if (line.accepted_for_vp_clustering) {
    line.rejection_reason = null;
  } else if (rejectionReason) {
    line.rejection_reason = rejectionReason;
  }
  selected.push(line);
  selectedSet.add(line);
  return true;
}

function perspectiveSeedRank(line) {
  return Number(line.clean_seed_score || 0) * 100
    + Number(line.isolation_score || 0) * 18
    + Number(line.support_score || 0) * 12
    - clamp01(Number(line.nearby_candidate_count || 0) / 60) * 8;
}

function perspectiveBlockers({ finiteCount, parallelCount }) {
  const blockers = ['accepted_vanishing_point_cluster_review_required'];
  if (finiteCount === 1 && parallelCount >= 1) {
    blockers.push('perspective_model_review_required_single_point_vs_two_point');
  } else if (finiteCount < 2) {
    blockers.push('second_vanishing_direction_or_parallel_family_review_required');
  }
  if (finiteCount === 1 && parallelCount === 0) blockers.push('parallel_axis_family_missing_for_single_point_hypothesis');
  if (finiteCount === 0) blockers.push('finite_vanishing_family_missing');
  return blockers;
}

function familySupportOverlapRatio(first, second) {
  const secondSet = new Set(second);
  const overlap = first.filter((line) => secondSet.has(line)).length;
  return overlap / Math.max(1, Math.min(first.length, second.length));
}

function uniqueNumbers(values) {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value)))];
}

function inImageVpPenalty(vp, imageSize) {
  const inside = vp[0] >= 0 && vp[0] <= imageSize.width && vp[1] >= 0 && vp[1] <= imageSize.height;
  return inside ? 0.35 : 0;
}

function lineRank(line) {
  const cleanBoost = Number(line.clean_seed_score || 0) * 130;
  const methodBoost = line.extraction_method === 'local_short_segment_hough' ? 90 : 0;
  const targetLength = line.extraction_method === 'local_short_segment_hough' ? 120 : 220;
  const lengthScore = Math.min(Number(line.length_px || 0), targetLength) / targetLength;
  return cleanBoost + methodBoost + Number(line.support_score || 0) * 80 + lengthScore * 20;
}

function selectBalancedLines(lines, limit) {
  const sorted = [...lines].sort((a, b) => lineRank(b) - lineRank(a));
  const buckets = new Map();
  for (const line of sorted) {
    const key = angleBucket(line.angle_deg);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(line);
  }
  const bucketKeys = [...buckets.keys()].sort((a, b) => Number(a) - Number(b));
  const selected = [];
  const selectedSet = new Set();
  const perBucketQuota = Math.max(3, Math.ceil(limit / Math.max(1, bucketKeys.length)));
  for (const key of bucketKeys) {
    const bucket = buckets.get(key) || [];
    for (const line of bucket.slice(0, perBucketQuota)) {
      selected.push(line);
      selectedSet.add(line);
      if (selected.length >= limit) return selected;
    }
  }
  for (const line of sorted) {
    if (selectedSet.has(line)) continue;
    selected.push(line);
    if (selected.length >= limit) return selected;
  }
  return selected;
}

function angleBucket(angleDeg) {
  return Math.round(Number(angleDeg || 0) / 10) * 10;
}

function clusterVanishingPoints({ lines, imageSize }) {
  const vpCandidates = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const first = lines[i];
      const second = lines[j];
      const angleDelta = acuteAngleDelta(first.angle_deg, second.angle_deg);
      if (angleDelta < 6 || angleDelta > 72) continue;
      const vp = lineIntersection(first.line_px, second.line_px);
      if (!vp) continue;
      const maxDistance = Math.max(imageSize.width, imageSize.height) * 8;
      if (Math.abs(vp[0]) > maxDistance || Math.abs(vp[1]) > maxDistance) continue;
      const support = lines.filter((line) => lineSupportsVanishingPoint(line, vp));
      if (support.length < 2) continue;
      vpCandidates.push({
        vp,
        support,
        score: support.reduce((sum, line) => sum + line.support_score, 0)
      });
    }
  }
  vpCandidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of vpCandidates) {
    if (selected.some((cluster) => distance(cluster.vp, candidate.vp) < Math.max(imageSize.width, imageSize.height) * 0.25)) continue;
    selected.push(candidate);
    if (selected.length >= 4) break;
  }
  return selected.map((cluster, index) => {
    const supportCount = cluster.support.length;
    return {
      id: `vp_cluster_${index + 1}`,
      vanishing_point_px: cluster.vp.map((value) => round(value)),
      support_line_ids: cluster.support.map((line) => line.id),
      support_count: supportCount,
      accepted: false,
      rejection_reason: supportCount >= 4
        ? 'requires_vanishing_point_cluster_review'
        : 'support_line_count_below_4'
    };
  });
}

function qaForDetectedLines({
  lineCandidates,
  nonVerticalCount,
  acceptedVpClusters,
  perspectiveHypothesis = null
}) {
  const blockers = [];
  let status = 'blocked_vanishing_point_cluster_review_required';
  if (lineCandidates.length < 4 || nonVerticalCount < 4) {
    status = 'blocked_insufficient_detected_lines';
    blockers.push('insufficient_detected_structure_lines');
  } else if (acceptedVpClusters.length === 0) {
    blockers.push('accepted_vanishing_point_cluster_review_required');
    blockers.push('detected_lines_are_candidates_not_axis_assignments');
  }
  for (const blocker of perspectiveHypothesis?.blockers || []) {
    if (!blockers.includes(blocker)) blockers.push(blocker);
  }
  return {
    status,
    usable_for_axis_calibration: false,
    blockers,
    notes: [
      'Only raster-detected lines are used for VP clustering.',
      'Seeded topology hints and A/B/C/D corner-chain lines are excluded from this evidence.'
    ]
  };
}

function lineSupportsVanishingPoint(line, vp, toleranceDeg = 3.5) {
  const mid = [
    (line.line_px.a[0] + line.line_px.b[0]) / 2,
    (line.line_px.a[1] + line.line_px.b[1]) / 2
  ];
  const lineAngle = Math.atan2(line.line_px.b[1] - line.line_px.a[1], line.line_px.b[0] - line.line_px.a[0]) * 180 / Math.PI;
  const vpAngle = Math.atan2(vp[1] - mid[1], vp[0] - mid[0]) * 180 / Math.PI;
  return acuteAngleDelta(lineAngle, vpAngle) <= toleranceDeg;
}

function isNonVertical(angleDeg) {
  const abs = Math.abs(normalizeLineAngle(angleDeg));
  return abs < 65 || abs > 115;
}

function dedupeLines(lines) {
  const output = [];
  for (const line of lines) {
    if (output.some((item) => acuteAngleDelta(item.angle_deg, line.angle_deg) < 3 && lineDistanceApprox(item.line_px, line.line_px) < 12)) continue;
    output.push(line);
  }
  return output;
}

function clipLineToImage(line, width, height) {
  return {
    a: [clamp(line.a[0], 0, width), clamp(line.a[1], 0, height)],
    b: [clamp(line.b[0], 0, width), clamp(line.b[1], 0, height)]
  };
}

function lineDistanceApprox(first, second) {
  const fm = [(first.a[0] + first.b[0]) / 2, (first.a[1] + first.b[1]) / 2];
  const sm = [(second.a[0] + second.b[0]) / 2, (second.a[1] + second.b[1]) / 2];
  return distance(fm, sm);
}

function lineMidpoint(line) {
  return [
    (Number(line.a[0]) + Number(line.b[0])) / 2,
    (Number(line.a[1]) + Number(line.b[1])) / 2
  ];
}

function lineIntersection(first, second) {
  const x1 = Number(first.a[0]);
  const y1 = Number(first.a[1]);
  const x2 = Number(first.b[0]);
  const y2 = Number(first.b[1]);
  const x3 = Number(second.a[0]);
  const y3 = Number(second.a[1]);
  const x4 = Number(second.b[0]);
  const y4 = Number(second.b[1]);
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-6) return null;
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  return [px, py];
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[index];
}

function normalizeLine(line = {}) {
  return {
    a: [round(line.a?.[0]), round(line.a?.[1])],
    b: [round(line.b?.[0]), round(line.b?.[1])]
  };
}

function normalizeLineAngle(deg) {
  let value = deg;
  while (value <= -90) value += 180;
  while (value > 90) value -= 180;
  return value;
}

function acuteAngleDelta(a, b) {
  const delta = Math.abs(normalizeLineAngle(a) - normalizeLineAngle(b));
  return Math.min(delta, 180 - delta);
}

function distance(a, b) {
  return Math.hypot(Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function perspectiveRoleColor(role, acceptedForVp) {
  if (role === 'finite_vp_family_1') return '#047857';
  if (role === 'finite_vp_family_2') return '#2563eb';
  if (role === 'parallel_axis_seed') return '#f97316';
  if (role === 'clean_seed_fallback') return acceptedForVp ? '#7c3aed' : '#64748b';
  return acceptedForVp ? '#047857' : '#64748b';
}

function imageDataUrl(sourceImagePath) {
  const extension = path.extname(sourceImagePath).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : 'png';
  return `data:image/${mime};base64,${imageDataUrl.cache.get(sourceImagePath) || ''}`;
}
imageDataUrl.cache = new Map();

function round(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}
