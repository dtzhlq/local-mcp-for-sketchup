import cvModule from '@techstark/opencv-js';
import sharp from 'sharp';

export const STRUCTURE_LINE_EVIDENCE_KIND = 'structure_line_evidence_v2';

const DEFAULT_PASSES = [
  {
    id: 'fine_low_threshold',
    scale: 1,
    canny_low: 28,
    canny_high: 84,
    hough_threshold: 16,
    min_line_length_px: 18,
    max_line_gap_px: 5
  },
  {
    id: 'fine_balanced',
    scale: 1,
    canny_low: 46,
    canny_high: 138,
    hough_threshold: 23,
    min_line_length_px: 24,
    max_line_gap_px: 8
  },
  {
    id: 'coarse_context',
    scale: 0.67,
    canny_low: 32,
    canny_high: 96,
    hough_threshold: 14,
    min_line_length_px: 16,
    max_line_gap_px: 7
  }
];

let openCvPromise = null;

export async function buildStructureLineEvidence({
  sourceImagePath,
  sourceImage = null,
  maxWidth = 900,
  passes = DEFAULT_PASSES,
  seedLimit = 96
} = {}) {
  if (!sourceImagePath) throw new Error('sourceImagePath is required');
  const raster = await loadGrayRaster(sourceImagePath, maxWidth);
  const cv = await getOpenCv();
  const backendCapabilities = {
    hough_lines_p: typeof cv.HoughLinesP === 'function',
    canny: typeof cv.Canny === 'function',
    line_segment_detector: typeof cv.createLineSegmentDetector === 'function'
  };
  if (!backendCapabilities.hough_lines_p || !backendCapabilities.canny) {
    return blockedEvidence({
      sourceImage: sourceImage || sourceImagePath,
      raster,
      passes,
      capabilities: backendCapabilities,
      blocker: 'opencv_wasm_houghp_or_canny_unavailable'
    });
  }

  const detected = [];
  const passReports = [];
  for (const pass of passes) {
    const passResult = runHoughPass({ cv, raster, pass });
    detected.push(...passResult.lines);
    passReports.push(passResult.report);
  }
  const deduplicated = deduplicateSegments(detected);
  const gradient = computeSobelMagnitude(raster);
  const enriched = enrichSegments({
    segments: deduplicated,
    raster,
    gradient
  });
  const seedSet = new Set(selectBalancedSeeds({
    segments: enriched.filter((segment) => segment.eligible),
    imageSize: raster,
    limit: seedLimit
  }).map((segment) => segment._key));
  const rawSegments = enriched
    .sort((a, b) => b.feature_scores.seed_quality - a.feature_scores.seed_quality)
    .map((segment, index) => ({
      id: `structure_segment_${String(index + 1).padStart(4, '0')}`,
      line_px: normalizeLine(segment.line_px),
      length_px: round(segment.length_px),
      angle_deg: round(segment.angle_deg),
      backend_pass_ids: [...segment.backend_pass_ids].sort(),
      feature_scores: {
        edge_support: round(segment.feature_scores.edge_support),
        contrast: round(segment.feature_scores.contrast),
        length_preference: round(segment.feature_scores.length_preference),
        seed_quality: round(segment.feature_scores.seed_quality),
        local_density: round(segment.feature_scores.local_density)
      },
      eligible: segment.eligible,
      eligibility_reasons: segment.eligibility_reasons,
      seed_selected: seedSet.has(segment._key),
      uncertainty: {
        endpoint_sigma_px: round(segment.uncertainty.endpoint_sigma_px),
        angle_sigma_deg: round(segment.uncertainty.angle_sigma_deg)
      },
      source_kind: 'raster_detected_line'
    }));
  const eligibleSegmentIds = rawSegments.filter((segment) => segment.eligible).map((segment) => segment.id);
  const seedSegmentIds = rawSegments.filter((segment) => segment.seed_selected).map((segment) => segment.id);
  const ready = eligibleSegmentIds.length >= 24 && seedSegmentIds.length >= 12;
  return {
    kind: STRUCTURE_LINE_EVIDENCE_KIND,
    version: 2,
    source_image: {
      id: 'source_image_1',
      source_image: sourceImage || sourceImagePath,
      width: raster.width,
      height: raster.height
    },
    coordinate_convention: 'image_x_right_y_down',
    backend: {
      id: 'opencv_wasm_multiscale_houghp_v1',
      implementation: '@techstark/opencv-js@5.0.0-release.1',
      deterministic: true,
      capabilities: Object.entries(backendCapabilities)
        .filter(([, available]) => available)
        .map(([name]) => name),
      passes: passReports
    },
    raw_segments: rawSegments,
    eligible_segment_ids: eligibleSegmentIds,
    seed_segment_ids: seedSegmentIds,
    selection_policy: {
      raw_retention: 'retain_all_deduplicated_backend_segments',
      eligibility: 'pixel_support_and_minimum_length_only; local density is recorded but never rejects a line',
      seed_selection: 'balanced by image cell and angle bucket, then filled by quality without deleting non-seed evidence',
      neighbor_density_is_hard_rejection: false
    },
    qa: {
      status: ready ? 'ready_for_perspective_hypotheses' : 'blocked_insufficient_line_evidence',
      review_required: true,
      promotion_allowed: false,
      blockers: ready ? ['accepted_calibration_review_required'] : ['insufficient_eligible_or_seed_line_evidence']
    },
    summary: {
      raw_segment_count: rawSegments.length,
      eligible_segment_count: eligibleSegmentIds.length,
      seed_segment_count: seedSegmentIds.length
    }
  };
}

export async function prepareStructureLineEvidenceImageDataUrl(sourceImagePath) {
  const buffer = await sharp(sourceImagePath).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export function renderStructureLineEvidenceOverlaySvg({
  evidence,
  calibration = null,
  imageDataUrl
} = {}) {
  const width = Number(evidence?.source_image?.width || 900);
  const height = Number(evidence?.source_image?.height || 589);
  const eligible = new Set(evidence?.eligible_segment_ids || []);
  const seeds = new Set(evidence?.seed_segment_ids || []);
  const familyBySegment = new Map();
  for (const family of calibration?.direction_families || []) {
    for (const segmentId of family.support_segment_ids || []) {
      if (!familyBySegment.has(segmentId)) familyBySegment.set(segmentId, family.id);
    }
  }
  const familyColors = ['#e11d48', '#0891b2', '#ca8a04', '#7c3aed'];
  const familyColorById = new Map((calibration?.direction_families || []).map((family, index) => [
    family.id,
    familyColors[index % familyColors.length]
  ]));
  const rawLines = (evidence?.raw_segments || []).map((segment) => {
    const familyId = familyBySegment.get(segment.id);
    const color = familyId
      ? familyColorById.get(familyId)
      : seeds.has(segment.id)
        ? '#16a34a'
        : eligible.has(segment.id)
          ? '#2563eb'
          : '#64748b';
    const layer = familyId
      ? 'vp-family-support'
      : seeds.has(segment.id)
        ? 'seed-segment'
        : eligible.has(segment.id)
          ? 'eligible-segment'
          : 'raw-segment';
    const opacity = familyId ? 0.9 : seeds.has(segment.id) ? 0.82 : eligible.has(segment.id) ? 0.22 : 0.1;
    const strokeWidth = familyId ? 2.6 : seeds.has(segment.id) ? 2 : eligible.has(segment.id) ? 1.1 : 0.7;
    return `<line data-layer="${layer}" data-segment-id="${escapeXml(segment.id)}" x1="${segment.line_px.a[0]}" y1="${segment.line_px.a[1]}" x2="${segment.line_px.b[0]}" y2="${segment.line_px.b[1]}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${opacity}"><title>${escapeXml(`${segment.id} angle=${segment.angle_deg} edge=${segment.feature_scores.edge_support} contrast=${segment.feature_scores.contrast} eligible=${segment.eligible} seed=${segment.seed_selected} family=${familyId || 'none'}`)}</title></line>`;
  }).join('\n');
  const familyLabels = (calibration?.direction_families || []).map((family, index) => {
    const y = 72 + index * 22;
    const color = familyColorById.get(family.id);
    return `<g data-layer="vp-family-label"><rect x="12" y="${y - 14}" width="390" height="19" fill="#ffffff" fill-opacity="0.9"/><text x="18" y="${y}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="${color}">${escapeXml(`${family.id} ${family.vanishing_type} support=${family.support_count} cells=${family.spatial_cell_count} residual=${family.median_angular_residual_deg}`)}</text></g>`;
  }).join('\n');
  const status = calibration?.qa?.status || evidence?.qa?.status || 'unknown';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageDataUrl}" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <g data-layer="structure-line-evidence">${rawLines}</g>
  <rect x="10" y="10" width="520" height="43" fill="#ffffff" fill-opacity="0.9" stroke="#111827"/>
  <text x="18" y="28" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="#111827">raw=${evidence?.summary?.raw_segment_count || 0} eligible=${evidence?.summary?.eligible_segment_count || 0} seeds=${evidence?.summary?.seed_segment_count || 0}</text>
  <text x="18" y="46" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#991b1b">${escapeXml(status)} review_required=true promotion_allowed=false</text>
  ${familyLabels}
</svg>`;
}

function blockedEvidence({ sourceImage, raster, passes, capabilities, blocker }) {
  return {
    kind: STRUCTURE_LINE_EVIDENCE_KIND,
    version: 2,
    source_image: {
      id: 'source_image_1',
      source_image: sourceImage,
      width: raster.width,
      height: raster.height
    },
    coordinate_convention: 'image_x_right_y_down',
    backend: {
      id: 'opencv_wasm_multiscale_houghp_v1',
      implementation: '@techstark/opencv-js@5.0.0-release.1',
      deterministic: true,
      capabilities: Object.entries(capabilities).filter(([, value]) => value).map(([name]) => name),
      passes
    },
    raw_segments: [],
    eligible_segment_ids: [],
    seed_segment_ids: [],
    selection_policy: {
      raw_retention: 'retain_all_deduplicated_backend_segments',
      eligibility: 'not_run_backend_unavailable',
      seed_selection: 'not_run_backend_unavailable',
      neighbor_density_is_hard_rejection: false
    },
    qa: {
      status: 'blocked_backend_unavailable',
      review_required: true,
      promotion_allowed: false,
      blockers: [blocker]
    },
    summary: {
      raw_segment_count: 0,
      eligible_segment_count: 0,
      seed_segment_count: 0
    }
  };
}

async function getOpenCv() {
  if (!openCvPromise) {
    openCvPromise = Promise.resolve(cvModule).then((cv) => {
      if (!cv?.Mat) throw new Error('OpenCV.js runtime did not initialize');
      return cv;
    });
  }
  return openCvPromise;
}

async function loadGrayRaster(sourceImagePath, maxWidth) {
  const metadata = await sharp(sourceImagePath).metadata();
  const width = Math.min(Number(metadata.width || maxWidth), maxWidth);
  const { data, info } = await sharp(sourceImagePath)
    .resize({ width, withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: Uint8Array.from(data)
  };
}

function runHoughPass({ cv, raster, pass }) {
  const scaledWidth = Math.max(64, Math.round(raster.width * pass.scale));
  const scaledHeight = Math.max(64, Math.round(raster.height * pass.scale));
  const source = cv.matFromArray(raster.height, raster.width, cv.CV_8UC1, raster.data);
  const scaled = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const lines = new cv.Mat();
  try {
    if (pass.scale === 1) {
      source.copyTo(scaled);
    } else {
      cv.resize(source, scaled, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_AREA);
    }
    cv.GaussianBlur(scaled, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, pass.canny_low, pass.canny_high, 3, false);
    cv.HoughLinesP(
      edges,
      lines,
      1,
      Math.PI / 720,
      pass.hough_threshold,
      pass.min_line_length_px,
      pass.max_line_gap_px
    );
    const values = lines.data32S;
    const scaleBack = 1 / pass.scale;
    const output = [];
    for (let index = 0; index + 3 < values.length; index += 4) {
      const line = canonicalLine({
        a: [values[index] * scaleBack, values[index + 1] * scaleBack],
        b: [values[index + 2] * scaleBack, values[index + 3] * scaleBack]
      });
      const length = lineLength(line);
      if (length < 14) continue;
      output.push({
        line_px: line,
        length_px: length,
        angle_deg: lineAngle(line),
        backend_pass_ids: new Set([pass.id])
      });
    }
    return {
      lines: output,
      report: {
        ...pass,
        scaled_width: scaledWidth,
        scaled_height: scaledHeight,
        detected_segment_count: output.length
      }
    };
  } finally {
    source.delete();
    scaled.delete();
    blurred.delete();
    edges.delete();
    lines.delete();
  }
}

function deduplicateSegments(segments) {
  const sorted = [...segments].sort((a, b) => b.length_px - a.length_px);
  const buckets = new Map();
  const kept = [];
  for (const segment of sorted) {
    const midpoint = lineMidpoint(segment.line_px);
    const cellX = Math.floor(midpoint[0] / 24);
    const cellY = Math.floor(midpoint[1] / 24);
    const angleBucket = Math.round(segment.angle_deg / 4);
    let duplicate = null;
    for (let dx = -1; dx <= 1 && !duplicate; dx += 1) {
      for (let dy = -1; dy <= 1 && !duplicate; dy += 1) {
        for (let da = -1; da <= 1 && !duplicate; da += 1) {
          const key = `${cellX + dx}:${cellY + dy}:${angleBucket + da}`;
          for (const candidate of buckets.get(key) || []) {
            if (segmentsEquivalent(candidate, segment)) {
              duplicate = candidate;
              break;
            }
          }
        }
      }
    }
    if (duplicate) {
      for (const passId of segment.backend_pass_ids) duplicate.backend_pass_ids.add(passId);
      continue;
    }
    segment._key = `raw_${kept.length + 1}`;
    kept.push(segment);
    const key = `${cellX}:${cellY}:${angleBucket}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(segment);
  }
  return kept;
}

function segmentsEquivalent(first, second) {
  if (acuteAngleDelta(first.angle_deg, second.angle_deg) > 2.5) return false;
  const firstMid = lineMidpoint(first.line_px);
  const secondMid = lineMidpoint(second.line_px);
  if (distance(firstMid, secondMid) > 28) return false;
  const perpendicular = Math.min(
    pointLineDistance(firstMid, second.line_px),
    pointLineDistance(secondMid, first.line_px)
  );
  if (perpendicular > 4.5) return false;
  return projectedOverlapRatio(first.line_px, second.line_px) >= 0.45
    || distance(firstMid, secondMid) <= 8;
}

function enrichSegments({ segments, raster, gradient }) {
  const midpointBuckets = new Map();
  for (const segment of segments) {
    const midpoint = lineMidpoint(segment.line_px);
    const key = `${Math.floor(midpoint[0] / 48)}:${Math.floor(midpoint[1] / 48)}`;
    midpointBuckets.set(key, (midpointBuckets.get(key) || 0) + 1);
  }
  return segments.map((segment) => {
    const edgeSupport = sampleEdgeSupport(segment.line_px, gradient, raster);
    const contrast = sampleLineContrast(segment.line_px, raster);
    const lengthPreference = lengthPreferenceScore(segment.length_px);
    const midpoint = lineMidpoint(segment.line_px);
    const localDensity = neighborCellDensity(midpointBuckets, midpoint);
    const seedQuality = clamp01(
      edgeSupport * 0.48
      + contrast * 0.24
      + lengthPreference * 0.2
      + Math.min(segment.backend_pass_ids.size, 3) / 3 * 0.08
    );
    const eligibilityReasons = [];
    if (segment.length_px < 18) eligibilityReasons.push('length_below_18px');
    if (edgeSupport < 0.34) eligibilityReasons.push('edge_support_below_0_34');
    const eligible = eligibilityReasons.length === 0;
    return {
      ...segment,
      eligible,
      eligibility_reasons: eligible ? ['eligible_pixel_support_and_length'] : eligibilityReasons,
      feature_scores: {
        edge_support: edgeSupport,
        contrast,
        length_preference: lengthPreference,
        seed_quality: seedQuality,
        local_density: localDensity
      },
      uncertainty: {
        endpoint_sigma_px: 1.2 + (1 - edgeSupport) * 2.8,
        angle_sigma_deg: clamp(80 / Math.max(segment.length_px, 20), 0.45, 4)
      }
    };
  });
}

function selectBalancedSeeds({ segments, imageSize, limit }) {
  const sorted = [...segments].sort((a, b) => b.feature_scores.seed_quality - a.feature_scores.seed_quality);
  const selected = [];
  const selectedSet = new Set();
  const groupCount = new Map();
  for (const segment of sorted) {
    const midpoint = lineMidpoint(segment.line_px);
    const cellX = clamp(Math.floor(midpoint[0] / imageSize.width * 6), 0, 5);
    const cellY = clamp(Math.floor(midpoint[1] / imageSize.height * 4), 0, 3);
    const angle = Math.round(segment.angle_deg / 10) * 10;
    const key = `${cellX}:${cellY}:${angle}`;
    if ((groupCount.get(key) || 0) >= 1) continue;
    selected.push(segment);
    selectedSet.add(segment);
    groupCount.set(key, 1);
    if (selected.length >= limit) return selected;
  }
  for (const segment of sorted) {
    if (selectedSet.has(segment)) continue;
    const tooSimilar = selected.some((item) => (
      acuteAngleDelta(item.angle_deg, segment.angle_deg) < 2
      && distance(lineMidpoint(item.line_px), lineMidpoint(segment.line_px)) < 22
    ));
    if (tooSimilar) continue;
    selected.push(segment);
    if (selected.length >= limit) break;
  }
  return selected;
}

function computeSobelMagnitude(raster) {
  const magnitude = new Float32Array(raster.width * raster.height);
  for (let y = 1; y < raster.height - 1; y += 1) {
    for (let x = 1; x < raster.width - 1; x += 1) {
      const i = y * raster.width + x;
      const gx = (
        -raster.data[i - raster.width - 1] + raster.data[i - raster.width + 1]
        - 2 * raster.data[i - 1] + 2 * raster.data[i + 1]
        - raster.data[i + raster.width - 1] + raster.data[i + raster.width + 1]
      );
      const gy = (
        -raster.data[i - raster.width - 1] - 2 * raster.data[i - raster.width] - raster.data[i - raster.width + 1]
        + raster.data[i + raster.width - 1] + 2 * raster.data[i + raster.width] + raster.data[i + raster.width + 1]
      );
      magnitude[i] = Math.hypot(gx, gy);
    }
  }
  return magnitude;
}

function sampleEdgeSupport(line, gradient, raster) {
  const length = lineLength(line);
  const samples = Math.max(8, Math.ceil(length / 3));
  let supported = 0;
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = Math.round(line.a[0] + (line.b[0] - line.a[0]) * t);
    const y = Math.round(line.a[1] + (line.b[1] - line.a[1]) * t);
    let maximum = 0;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const sx = clamp(x + ox, 0, raster.width - 1);
        const sy = clamp(y + oy, 0, raster.height - 1);
        maximum = Math.max(maximum, gradient[sy * raster.width + sx]);
      }
    }
    if (maximum >= 120) supported += 1;
  }
  return supported / (samples + 1);
}

function sampleLineContrast(line, raster) {
  const length = lineLength(line);
  const dx = (line.b[0] - line.a[0]) / length;
  const dy = (line.b[1] - line.a[1]) / length;
  const normal = [-dy, dx];
  const samples = Math.max(6, Math.ceil(length / 8));
  let total = 0;
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = line.a[0] + (line.b[0] - line.a[0]) * t;
    const y = line.a[1] + (line.b[1] - line.a[1]) * t;
    const first = sampleGray(raster, x + normal[0] * 2.5, y + normal[1] * 2.5);
    const second = sampleGray(raster, x - normal[0] * 2.5, y - normal[1] * 2.5);
    total += Math.abs(first - second);
  }
  return clamp01(total / (samples + 1) / 54);
}

function sampleGray(raster, x, y) {
  const sx = clamp(Math.round(x), 0, raster.width - 1);
  const sy = clamp(Math.round(y), 0, raster.height - 1);
  return raster.data[sy * raster.width + sx];
}

function neighborCellDensity(buckets, midpoint) {
  const cellX = Math.floor(midpoint[0] / 48);
  const cellY = Math.floor(midpoint[1] / 48);
  let count = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      count += buckets.get(`${cellX + dx}:${cellY + dy}`) || 0;
    }
  }
  return count;
}

function lengthPreferenceScore(length) {
  if (length < 18) return clamp01(length / 18);
  if (length <= 160) return clamp01(0.55 + (length - 18) / 142 * 0.45);
  return clamp01(1 - (length - 160) / 700 * 0.35);
}

function projectedOverlapRatio(first, second) {
  const length = lineLength(first);
  const direction = [(first.b[0] - first.a[0]) / length, (first.b[1] - first.a[1]) / length];
  const firstInterval = [0, length];
  const secondInterval = [
    dot([second.a[0] - first.a[0], second.a[1] - first.a[1]], direction),
    dot([second.b[0] - first.a[0], second.b[1] - first.a[1]], direction)
  ].sort((a, b) => a - b);
  const overlap = Math.max(0, Math.min(firstInterval[1], secondInterval[1]) - Math.max(firstInterval[0], secondInterval[0]));
  return overlap / Math.max(1, Math.min(length, lineLength(second)));
}

function pointLineDistance(point, line) {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const denominator = Math.max(1e-6, Math.hypot(dx, dy));
  return Math.abs(dy * point[0] - dx * point[1] + line.b[0] * line.a[1] - line.b[1] * line.a[0]) / denominator;
}

function canonicalLine(line) {
  if (line.a[0] < line.b[0]) return line;
  if (line.a[0] === line.b[0] && line.a[1] <= line.b[1]) return line;
  return { a: line.b, b: line.a };
}

function normalizeLine(line) {
  return {
    a: line.a.map((value) => round(value)),
    b: line.b.map((value) => round(value))
  };
}

function lineLength(line) {
  return Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
}

function lineAngle(line) {
  let angle = Math.atan2(line.b[1] - line.a[1], line.b[0] - line.a[0]) * 180 / Math.PI;
  while (angle >= 90) angle -= 180;
  while (angle < -90) angle += 180;
  return angle;
}

function lineMidpoint(line) {
  return [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
}

function acuteAngleDelta(first, second) {
  let delta = Math.abs(first - second) % 180;
  if (delta > 90) delta = 180 - delta;
  return delta;
}

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function dot(first, second) {
  return first[0] * second[0] + first[1] * second[1];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
