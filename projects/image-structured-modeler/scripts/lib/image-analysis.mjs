import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const repoRoot = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
export const subprojectRoot = path.join(repoRoot, 'projects', 'image-structured-modeler');
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

export async function listImageFiles(inputPath) {
  const absoluteInput = path.resolve(inputPath);
  const stat = await fs.stat(absoluteInput);
  if (stat.isFile()) return [absoluteInput];

  const entries = await fs.readdir(absoluteInput, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(absoluteInput, entry.name))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No image files found in ${absoluteInput}`);
  }
  return files;
}

export function toRepoRelative(filePath) {
  const relative = path.relative(repoRoot, path.resolve(filePath));
  return relative.split(path.sep).join('/');
}

export async function analyzeImage(imagePath, options = {}) {
  const maxDimension = options.maxDimension || 900;
  const original = await sharp(imagePath).metadata();
  const { data, info } = await sharp(imagePath)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gray = grayscale(data, info.width, info.height);
  const threshold = options.edgeThreshold || autoEdgeThreshold(gray);
  const edges = sobelEdges(gray, info.width, info.height, threshold);
  const objectBounds = percentileBounds(edges, info.width, info.height);
  const symmetry = detectVerticalSymmetry(edges, info.width, info.height, objectBounds);
  const bboxRatio = objectBounds ? objectBounds.width / Math.max(1, objectBounds.height) : 0;
  const edgeDensity = edges.length / Math.max(1, info.width * info.height);

  return {
    path: imagePath,
    sourceWidth: original.width,
    sourceHeight: original.height,
    width: info.width,
    height: info.height,
    threshold,
    gray,
    edges,
    objectBounds,
    bboxRatio,
    edgeDensity,
    symmetry
  };
}

export function assignViewKinds(analyses) {
  const assigned = analyses.map((analysis) => ({
    analysis,
    kind: 'unknown',
    confidence: 0.25,
    notes: ['Heuristic CV-only classification; review manually before modeling.']
  }));

  const candidates = assigned
    .filter((item) => item.analysis.objectBounds)
    .map((item) => {
      const { bboxRatio, symmetry, edgeDensity, objectBounds, width, height } = item.analysis;
      const coverage = (objectBounds.width * objectBounds.height) / Math.max(1, width * height);
      const frontScore = clamp01(0.44 * clamp01(symmetry.score) + 0.28 * clamp01((bboxRatio - 0.7) / 1.5) + 0.18 * clamp01(coverage / 0.55) + 0.1 * clamp01(edgeDensity / 0.18));
      const sideScore = clamp01(0.55 * clamp01((0.85 - bboxRatio) / 0.85) + 0.25 * clamp01(coverage / 0.45) + 0.2 * (1 - clamp01(symmetry.score)));
      return { item, frontScore, sideScore, coverage };
    })
    .sort((a, b) => b.frontScore - a.frontScore);

  if (candidates[0]) {
    candidates[0].item.kind = 'front';
    candidates[0].item.confidence = round(clamp(candidates[0].frontScore, 0.45, 0.86));
    candidates[0].item.notes.push('Assigned as the strongest broad symmetric view in this image set.');
  }
  if (candidates[1]) {
    candidates[1].item.kind = 'rear';
    candidates[1].item.confidence = round(clamp(candidates[1].frontScore - 0.04, 0.42, 0.82));
    candidates[1].item.notes.push('Assigned as the second strongest broad symmetric view in this image set.');
  }

  const remaining = candidates
    .filter((candidate) => !['front', 'rear'].includes(candidate.item.kind))
    .sort((a, b) => b.sideScore - a.sideScore);

  if (remaining[0] && remaining[0].sideScore > 0.28) {
    remaining[0].item.kind = 'right';
    remaining[0].item.confidence = round(clamp(remaining[0].sideScore, 0.38, 0.72));
    remaining[0].item.notes.push('Assigned as a side candidate because the detected object footprint is comparatively narrow/asymmetric.');
  }

  for (const candidate of candidates) {
    if (candidate.item.kind !== 'unknown') continue;
    candidate.item.kind = 'oblique';
    candidate.item.confidence = round(clamp(0.35 + candidate.coverage * 0.3, 0.35, 0.62));
    candidate.item.notes.push('Assigned as oblique/detail until a semantic pass can confirm the view.');
  }

  return assigned;
}

export function applyViewHints(assignedViews, viewHints) {
  if (!viewHints || viewHints.size === 0) return assignedViews;
  return assignedViews.map((assigned) => {
    const relativePath = toRepoRelative(assigned.analysis.path);
    const hint = viewHints.get(relativePath) || viewHints.get(path.basename(relativePath));
    if (!hint) return assigned;
    return {
      ...assigned,
      kind: hint.kind,
      confidence: round(clamp(Math.max(assigned.confidence, hint.confidence || 0.65), 0.45, 0.92)),
      notes: [
        ...assigned.notes,
        `View overridden by hint file: ${hint.source}.`
      ]
    };
  });
}

export async function readViewHints(hintsPath) {
  const raw = await fs.readFile(hintsPath, 'utf8');
  const document = JSON.parse(raw);
  const hints = new Map();
  for (const view of document.views || []) {
    if (!view.source_image || !view.kind) continue;
    const normalized = view.source_image.split(path.sep).join('/');
    const hint = {
      kind: view.kind,
      confidence: view.confidence,
      source: toRepoRelative(hintsPath)
    };
    hints.set(normalized, hint);
    hints.set(path.basename(normalized), hint);
  }
  return hints;
}

export function makeImageObservation(assignedView) {
  const { analysis, kind, confidence, notes } = assignedView;
  const bbox = analysis.objectBounds
    ? [analysis.objectBounds.x, analysis.objectBounds.y, analysis.objectBounds.width, analysis.objectBounds.height].map(round)
    : [0, 0, analysis.width, analysis.height];
  const sampledEdges = samplePoints(analysis.edges, 1200).map((point) => [point.x, point.y]);
  const axisX = round(analysis.symmetry.x);
  const symmetryLine = { a: [axisX, 0], b: [axisX, analysis.height] };
  const risks = [];
  if (analysis.edgeDensity < 0.02) risks.push('low edge density; outline may be under-detected');
  if (analysis.symmetry.score < 0.2) risks.push('weak vertical symmetry signal');
  if (kind === 'unknown' || kind === 'oblique') risks.push('view kind needs manual confirmation');

  const baseObservations = [
    {
      id: 'main_object_bbox',
      kind: 'component_bbox',
      component_hint: 'main_object',
      bbox,
      confidence: round(clamp(0.45 + analysis.edgeDensity * 2, 0.45, 0.78)),
      note: 'Percentile edge bounds; includes visual clutter when background edges are strong.'
    },
    {
      id: 'edge_cloud_sample',
      kind: 'edge',
      component_hint: 'main_outline',
      points: sampledEdges,
      confidence: round(clamp(0.35 + analysis.edgeDensity * 2, 0.35, 0.7)),
      note: `Sobel edge sample at analysis resolution ${analysis.width}x${analysis.height}.`
    },
    {
      id: 'vertical_symmetry_candidate',
      kind: 'edge',
      component_hint: 'symmetry_axis',
      points: [symmetryLine.a, symmetryLine.b],
      confidence: round(clamp(analysis.symmetry.score, 0, 1)),
      note: 'Candidate symmetry axis from mirrored edge occupancy.'
    }
  ];

  return {
    version: 1,
    image: {
      path: toRepoRelative(analysis.path),
      width: analysis.sourceWidth,
      height: analysis.sourceHeight,
      analysis_width: analysis.width,
      analysis_height: analysis.height
    },
    detected_view: {
      kind,
      confidence,
      notes
    },
    camera_hints: {
      perspective_strength: classifyPerspective(analysis),
      symmetry_axis: symmetryLine
    },
    metrics: {
      edge_count: analysis.edges.length,
      edge_density: round(analysis.edgeDensity, 5),
      object_bbox: bbox,
      object_bbox_ratio: round(analysis.bboxRatio, 3),
      symmetry_score: round(analysis.symmetry.score, 3)
    },
    observations: [
      ...baseObservations,
      ...componentCandidatesForView(kind, bbox, confidence)
    ],
    quality_report: {
      usable_for_modeling: analysis.edgeDensity >= 0.02 && Boolean(analysis.objectBounds),
      risks,
      missing_views: []
    }
  };
}

function componentCandidatesForView(viewKind, bbox, viewConfidence) {
  const [x, y, width, height] = bbox;
  const componentConfidence = round(clamp(viewConfidence - 0.12, 0.35, 0.72));
  const candidates = [];
  const addBox = (id, componentHint, rel, note, confidence = componentConfidence) => {
    candidates.push({
      id,
      kind: 'component_bbox',
      component_hint: componentHint,
      bbox: [
        round(x + rel.x * width),
        round(y + rel.y * height),
        round(rel.width * width),
        round(rel.height * height)
      ],
      confidence,
      note
    });
  };
  const addPoint = (id, componentHint, rel, note, confidence = componentConfidence) => {
    candidates.push({
      id,
      kind: 'center_point',
      component_hint: componentHint,
      points: [[round(x + rel.x * width), round(y + rel.y * height)]],
      confidence,
      note
    });
  };

  if (viewKind === 'front') {
    addBox('front_left_shell_candidate', 'left_joycon_shell', { x: 0.04, y: 0.08, width: 0.31, height: 0.84 }, 'Template candidate from known game-controller front layout.');
    addBox('front_center_grip_candidate', 'center_grip_body', { x: 0.34, y: 0.11, width: 0.32, height: 0.78 }, 'Template candidate from known game-controller front layout.');
    addBox('front_right_shell_candidate', 'right_joycon_shell', { x: 0.65, y: 0.08, width: 0.31, height: 0.84 }, 'Template candidate from known game-controller front layout.');
    addPoint('front_left_thumbstick_center', 'left_thumbstick', { x: 0.26, y: 0.37 }, 'Likely left thumbstick center inferred from front layout.', 0.68);
    addPoint('front_right_thumbstick_center', 'right_thumbstick', { x: 0.74, y: 0.64 }, 'Likely right thumbstick center inferred from front layout.', 0.55);
    addBox('front_abxy_cluster_candidate', 'abxy_cluster', { x: 0.72, y: 0.24, width: 0.19, height: 0.25 }, 'Likely ABXY cluster region inferred from front layout.', 0.66);
    addBox('front_left_button_cluster_candidate', 'left_button_cluster', { x: 0.09, y: 0.52, width: 0.18, height: 0.24 }, 'Likely left button cluster region inferred from front layout.', 0.55);
  } else if (viewKind === 'rear') {
    addBox('rear_left_grip_candidate', 'rear_grip_left', { x: 0.08, y: 0.08, width: 0.31, height: 0.84 }, 'Likely left rear grip silhouette from rear layout.', 0.68);
    addBox('rear_center_plate_candidate', 'center_grip_body', { x: 0.36, y: 0.12, width: 0.28, height: 0.76 }, 'Likely central rear plate from rear layout.', 0.6);
    addBox('rear_right_grip_candidate', 'rear_grip_right', { x: 0.61, y: 0.08, width: 0.31, height: 0.84 }, 'Likely right rear grip silhouette from rear layout.', 0.68);
  } else if (viewKind === 'right' || viewKind === 'left') {
    addBox('side_depth_profile_candidate', 'side_thickness_profile', { x: 0.18, y: 0.10, width: 0.64, height: 0.80 }, 'Side-view depth/thickness profile candidate.', 0.58);
    addPoint('side_max_thickness_point', 'max_thickness', { x: 0.55, y: 0.58 }, 'Approximate maximum thickness point from side view.', 0.48);
  } else if (viewKind === 'oblique') {
    addBox('oblique_uncertain_object_candidate', 'uncertain_main_object', { x: 0.08, y: 0.10, width: 0.84, height: 0.80 }, 'Oblique view useful for visual review but not trusted for dimensions.', 0.35);
  }

  return candidates;
}

export function makeImageSetObservation({ objectType, objectName, analyses, assignedViews, overlayDir = null }) {
  const images = assignedViews.map(makeImageObservation);
  const detected = unique(images.map((item) => item.detected_view.kind));
  const requiredViews = ['front', 'rear', 'right', 'top'];
  const missingViews = requiredViews.filter((view) => !detected.includes(view));
  const usableCount = images.filter((item) => item.quality_report.usable_for_modeling).length;
  const risks = [];
  if (!detected.includes('front')) risks.push('front view not confidently detected');
  if (!detedHasSide(detected)) risks.push('side/depth view not confidently detected');
  if (!detected.includes('top')) risks.push('true top view is missing');
  if (usableCount < Math.ceil(images.length / 2)) risks.push('less than half of the images are usable by current CV heuristics');

  return {
    version: 1,
    object: {
      type: objectType,
      name: objectName,
      source_images: analyses.map((analysis) => toRepoRelative(analysis.path))
    },
    image_set_quality: qualityLabel(images, missingViews),
    views_detected: detected,
    missing_views: missingViews,
    images,
    quality_report: {
      usable_for_modeling: usableCount > 0 && detected.includes('front'),
      risks,
      notes: [
        'This is a deterministic CV baseline. A later VLM pass should verify component semantics.',
        'Overlay review is required before generating a final model plan.'
      ]
    },
    review: {
      overlay_dir: overlayDir ? toRepoRelative(overlayDir) : null,
      open_questions: [
        'Confirm which photos are true front/rear/side views.',
        'Provide one known physical dimension to lock scale.',
        'Mark component labels for shells, buttons, sticks, screws, and grips.'
      ]
    }
  };
}

export async function renderObservationOverlay(observation, outputPath, options = {}) {
  const imagePath = path.resolve(repoRoot, observation.image.path);
  const maxDimension = options.maxDimension || observation.image.analysis_width || 900;
  const base = await sharp(imagePath)
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  const edgeObservation = observation.observations.find((item) => item.id === 'edge_cloud_sample');
  const edgeMarks = edgeObservation?.points
    ? edgeObservation.points.map(([x, y]) => `<rect x="${x}" y="${y}" width="1.2" height="1.2" fill="#00d7ff"/>`).join('')
    : '';

  if (edgeObservation?.points) {
    // Edge marks are intentionally sparse; full edge rasters make review overlays hard to read.
  }

  const bboxObservation = observation.observations.find((item) => item.id === 'main_object_bbox');
  const bboxMark = bboxObservation?.bbox
    ? `<rect x="${bboxObservation.bbox[0]}" y="${bboxObservation.bbox[1]}" width="${bboxObservation.bbox[2]}" height="${bboxObservation.bbox[3]}" fill="none" stroke="#ffd23f" stroke-width="3"/>`
    : '';

  if (bboxObservation?.bbox) {
    // Bbox is percentile edge bounds, not a semantic component box.
  }

  const axis = observation.camera_hints?.symmetry_axis;
  const axisMark = axis
    ? `<line x1="${axis.a[0]}" y1="${axis.a[1]}" x2="${axis.b[0]}" y2="${axis.b[1]}" stroke="#ff4d4d" stroke-width="2" stroke-dasharray="10 8"/>`
    : '';
  const componentMarks = observation.observations
    .filter((item) => item.kind === 'component_bbox' && item.id !== 'main_object_bbox' && item.bbox)
    .map((item) => {
      const [x, y, width, height] = item.bbox;
      return `<g>
        <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="#8aff80" stroke-width="2"/>
        <text x="${x + 4}" y="${y + 14}" fill="#8aff80" font-family="monospace" font-size="11">${escapeXml(item.component_hint || item.id)}</text>
      </g>`;
    })
    .join('');
  const centerMarks = observation.observations
    .filter((item) => item.kind === 'center_point' && item.points?.length)
    .map((item) => {
      const [x, y] = item.points[0];
      return `<g>
        <circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#ff8bd1" stroke-width="2"/>
        <line x1="${x - 9}" y1="${y}" x2="${x + 9}" y2="${y}" stroke="#ff8bd1" stroke-width="1.5"/>
        <line x1="${x}" y1="${y - 9}" x2="${x}" y2="${y + 9}" stroke="#ff8bd1" stroke-width="1.5"/>
        <text x="${x + 8}" y="${y - 8}" fill="#ff8bd1" font-family="monospace" font-size="11">${escapeXml(item.component_hint || item.id)}</text>
      </g>`;
    })
    .join('');

  const labelLines = [
    `${path.basename(observation.image.path)}  view=${observation.detected_view.kind} (${observation.detected_view.confidence.toFixed(2)})`,
    `edges=${observation.metrics.edge_count} density=${observation.metrics.edge_density} symmetry=${observation.metrics.symmetry_score}`,
    `bbox=${observation.metrics.object_bbox.map((value) => Math.round(value)).join(',')}`
  ];
  const label = svgLabel(labelLines, 12, 12);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${base.info.width}" height="${base.info.height}" viewBox="0 0 ${base.info.width} ${base.info.height}">
    <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.32)"/>
    ${edgeMarks}
    ${bboxMark}
    ${componentMarks}
    ${centerMarks}
    ${axisMark}
    ${label}
  </svg>`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(base.data)
    .composite([{ input: overlay, blend: 'over' }])
    .png()
    .toFile(outputPath);
  return outputPath;
}

function grayscale(data, width, height) {
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    gray[index] = Math.round(0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2]);
  }
  return gray;
}

function autoEdgeThreshold(gray) {
  let sum = 0;
  for (const value of gray) sum += value;
  const mean = sum / gray.length;
  let variance = 0;
  for (const value of gray) variance += (value - mean) ** 2;
  const std = Math.sqrt(variance / gray.length);
  return clamp(Math.round(std * 1.25), 42, 96);
}

function sobelEdges(gray, width, height, threshold) {
  const thresholdSquared = threshold * threshold;
  const edges = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = -gray[index - width - 1] + gray[index - width + 1]
        - 2 * gray[index - 1] + 2 * gray[index + 1]
        - gray[index + width - 1] + gray[index + width + 1];
      const gy = -gray[index - width - 1] - 2 * gray[index - width] - gray[index - width + 1]
        + gray[index + width - 1] + 2 * gray[index + width] + gray[index + width + 1];
      const magnitudeSquared = gx * gx + gy * gy;
      if (magnitudeSquared > thresholdSquared) edges.push({ x, y, magnitude: Math.sqrt(magnitudeSquared) });
    }
  }
  return edges;
}

function percentileBounds(edges, width, height) {
  if (edges.length === 0) return null;
  const xs = edges.map((edge) => edge.x).sort((a, b) => a - b);
  const ys = edges.map((edge) => edge.y).sort((a, b) => a - b);
  const minX = xs[Math.floor(xs.length * 0.02)];
  const maxX = xs[Math.floor(xs.length * 0.98)];
  const minY = ys[Math.floor(ys.length * 0.02)];
  const maxY = ys[Math.floor(ys.length * 0.98)];
  return {
    x: clamp(minX, 0, width - 1),
    y: clamp(minY, 0, height - 1),
    width: clamp(maxX - minX, 1, width),
    height: clamp(maxY - minY, 1, height)
  };
}

function detectVerticalSymmetry(edges, width, height, bounds) {
  const x = bounds ? bounds.x + bounds.width / 2 : width / 2;
  const coarse = new Set();
  for (const edge of edges) {
    coarse.add(`${Math.round(edge.x / 3)},${Math.round(edge.y / 3)}`);
  }

  let hits = 0;
  const sample = samplePoints(edges, 2500);
  for (const edge of sample) {
    const mirrorX = Math.round((2 * x - edge.x) / 3);
    const mirrorY = Math.round(edge.y / 3);
    if (
      coarse.has(`${mirrorX},${mirrorY}`)
      || coarse.has(`${mirrorX - 1},${mirrorY}`)
      || coarse.has(`${mirrorX + 1},${mirrorY}`)
    ) {
      hits += 1;
    }
  }

  return {
    x,
    score: sample.length ? hits / sample.length : 0
  };
}

function classifyPerspective(analysis) {
  if (analysis.symmetry.score > 0.42 && analysis.bboxRatio > 0.85) return 'low';
  if (analysis.symmetry.score > 0.22) return 'medium';
  return 'high';
}

function samplePoints(points, maxCount) {
  if (points.length <= maxCount) return points.map(({ x, y }) => ({ x: round(x), y: round(y) }));
  const step = points.length / maxCount;
  const sampled = [];
  for (let index = 0; index < maxCount; index += 1) {
    const point = points[Math.floor(index * step)];
    sampled.push({ x: round(point.x), y: round(point.y) });
  }
  return sampled;
}

function qualityLabel(images, missingViews) {
  const usable = images.filter((image) => image.quality_report.usable_for_modeling).length;
  if (missingViews.length === 0 && usable >= Math.ceil(images.length * 0.75)) return 'high';
  if (usable >= Math.ceil(images.length * 0.4)) return 'medium';
  return 'low';
}

function detedHasSide(detected) {
  return detected.includes('left') || detected.includes('right');
}

function unique(values) {
  return Array.from(new Set(values));
}

function svgLabel(lines, x, y) {
  const width = Math.max(...lines.map((line) => line.length)) * 7.2 + 18;
  const height = lines.length * 18 + 12;
  const text = lines.map((line, index) => `<text x="${x + 9}" y="${y + 20 + index * 18}" fill="#ffffff" font-family="monospace" font-size="12">${escapeXml(line)}</text>`).join('');
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="rgba(0,0,0,0.78)"/>${text}</g>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
