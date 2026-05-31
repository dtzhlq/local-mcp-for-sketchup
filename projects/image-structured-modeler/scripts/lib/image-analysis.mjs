import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const repoRoot = path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
export const subprojectRoot = path.join(repoRoot, 'projects', 'image-structured-modeler');
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

const OBSERVATION_PART_REQUIREMENTS = {
  switch_controller: {
    center_grip_body: { views: ['front', 'rear'], hints: ['center_grip_body'] },
    left_joycon_shell: { views: ['front'], hints: ['left_joycon_shell'] },
    right_joycon_shell: { views: ['front'], hints: ['right_joycon_shell'] },
    rear_grip_pair: { views: ['rear', 'right'], hints: ['rear_grip_left', 'rear_grip_right', 'side_thickness_profile'] },
    left_thumbstick: { views: ['front'], hints: ['left_thumbstick'] },
    right_thumbstick: { views: ['front'], hints: ['right_thumbstick'] },
    abxy_cluster: { views: ['front'], hints: ['abxy_cluster'] },
    left_button_cluster: { views: ['front'], hints: ['left_button_cluster'] },
    shoulder_rail_pair: { views: ['right'], hints: ['side_thickness_profile'] }
  },
  compact_remote: {
    remote_body: { views: ['front', 'right'], hints: ['remote_body', 'main_object', 'side_thickness_profile'] },
    remote_face_panel: { views: ['front'], hints: ['remote_face_panel'] },
    navigation_pad: { views: ['front'], hints: ['navigation_pad'] },
    primary_button_cluster: { views: ['front'], hints: ['primary_button_cluster'] },
    volume_rocker: { views: ['front'], hints: ['volume_rocker'] },
    speaker_grille: { views: ['front'], hints: ['speaker_grille'] },
    brand_label: { views: ['front'], hints: ['brand_label'] }
  },
  vehicle_ambulance: {
    'amb-main-body': { views: ['left', 'top', 'rear'], hints: ['amb-main-body', 'main_object'] },
    'amb-cab-lower': { views: ['left', 'front'], hints: ['amb-cab-lower'] },
    'amb-cab-upper-shell': { views: ['left', 'front'], hints: ['amb-cab-upper-shell'] },
    'amb-windshield': { views: ['left', 'front'], hints: ['amb-windshield'] },
    'amb-left-side-window': { views: ['left'], hints: ['amb-left-side-window'] },
    'wheel-left-front-tire': { views: ['left'], hints: ['wheel-left-front-tire'] },
    'wheel-left-rear-tire': { views: ['left'], hints: ['wheel-left-rear-tire'] },
    'roof-red-lightbar': { views: ['left', 'top', 'front'], hints: ['roof-red-lightbar'] },
    'amb-left-red-stripe': { views: ['left'], hints: ['amb-left-red-stripe'] },
    'amb-left-ambulance-text': { views: ['left'], hints: ['amb-left-ambulance-text'] }
  },
  building_group: {
    site_boundary: { views: ['top'], hints: ['site_boundary', 'campus_footprint'] },
    primary_blue_roof_hall: { views: ['top', 'oblique'], hints: ['primary_blue_roof_hall'] },
    warehouse_row_west: { views: ['top', 'oblique'], hints: ['warehouse_row_west'] },
    warehouse_row_inner: { views: ['top', 'oblique'], hints: ['warehouse_row_inner'] },
    tank_farm: { views: ['top', 'oblique'], hints: ['tank_farm'] },
    utility_building: { views: ['top', 'oblique'], hints: ['utility_building'] },
    admin_office: { views: ['top', 'oblique'], hints: ['admin_office'] },
    parking_lot: { views: ['top'], hints: ['parking_lot'] },
    internal_roads: { views: ['top'], hints: ['internal_roads'] }
  }
};

const PROFILE_DEFAULT_SCALE = {
  switch_controller: { width: 280, depth: 42, height: 155 },
  compact_remote: { width: 44, depth: 16, height: 158 },
  vehicle_ambulance: { width: 2300, depth: 900, height: 1050 },
  building_group: { width: 520000, depth: 380000, height: 28000 }
};

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
  const contour = traceObjectContour(edges, objectBounds, info.width, info.height);
  const keypoints = keypointsFromBounds(objectBounds, info.width, info.height);
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
    contour,
    keypoints,
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
  for (const reference of document.reference_images || []) {
    if (!reference.source) continue;
    const kind = referenceViewKind(reference);
    if (!kind) continue;
    const normalized = reference.source.split(path.sep).join('/');
    const hint = {
      kind,
      confidence: reference.confidence || 0.86,
      source: toRepoRelative(hintsPath)
    };
    hints.set(normalized, hint);
    hints.set(path.basename(normalized), hint);
  }
  return hints;
}

function referenceViewKind(reference) {
  const label = `${reference.id || ''} ${reference.name || ''}`.toLowerCase();
  if (label.includes('top')) return 'top';
  if (label.includes('front')) return 'front';
  if (label.includes('rear') || label.includes('back')) return 'rear';
  if (label.includes('right')) return 'right';
  if (label.includes('left') || label.includes('side')) return 'left';
  if (label.includes('quarter') || label.includes('oblique')) return 'oblique';
  if (reference.plane === 'xy') return 'top';
  if (reference.plane === 'yz') return 'front';
  if (reference.plane === 'xz') return 'left';
  return null;
}

export function makeImageObservation(assignedView, objectProfile = 'switch_controller') {
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
  const orientationHints = makeOrientationHints({ kind, analysis, objectProfile });
  if (orientationHints.review_required) risks.push('left/right mirror orientation needs manual confirmation');

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
      id: 'main_object_contour',
      kind: 'silhouette',
      component_hint: 'main_object',
      points: analysis.contour,
      confidence: round(clamp(0.42 + analysis.edgeDensity * 1.8 + (analysis.contour.length > 8 ? 0.08 : 0), 0.42, 0.82)),
      note: 'Coarse contour polyline traced from Sobel edge occupancy slices; use as geometry evidence, not a final CAD profile.'
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

  for (const keypoint of analysis.keypoints) {
    baseObservations.push({
      id: `main_object_${keypoint.id}`,
      kind: 'keypoint',
      component_hint: 'main_object',
      points: [keypoint.point],
      confidence: keypoint.confidence,
      note: keypoint.note
    });
  }

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
    orientation_hints: orientationHints,
    metrics: {
      edge_count: analysis.edges.length,
      edge_density: round(analysis.edgeDensity, 5),
      object_bbox: bbox,
      object_bbox_ratio: round(analysis.bboxRatio, 3),
      symmetry_score: round(analysis.symmetry.score, 3)
    },
    observations: [
      ...baseObservations,
      ...componentCandidatesForView(kind, bbox, confidence, objectProfile)
    ],
    quality_report: {
      usable_for_modeling: analysis.edgeDensity >= 0.02 && Boolean(analysis.objectBounds),
      risks,
      missing_views: []
    }
  };
}

function makeOrientationHints({ kind, analysis, objectProfile }) {
  const semanticAnchors = [];
  if (objectProfile === 'vehicle_ambulance' && (kind === 'left' || kind === 'right')) {
    semanticAnchors.push(
      {
        id: 'side-front-wheel-before-rear-wheel',
        item: 'wheel-left-front-tire',
        anchor: 'wheel-left-rear-tire',
        direction: 'left_of',
        confidence: 0.64,
        note: 'Side-view profile prior: the front wheel should appear before the rear wheel in image coordinates; confirm before mapping image x to model left/right.'
      },
      {
        id: 'side-cab-before-main-body',
        item: 'amb-cab-lower',
        anchor: 'amb-main-body',
        direction: 'left_of',
        confidence: 0.58,
        note: 'Side-view profile prior: cab/front should precede the rear body; this is a handedness cue, not final geometry.'
      }
    );
  } else if (objectProfile === 'switch_controller' && (kind === 'front' || kind === 'rear')) {
    semanticAnchors.push(
      {
        id: 'right-thumbstick-after-left-thumbstick',
        item: 'right_thumbstick',
        anchor: 'left_thumbstick',
        direction: 'right_of',
        confidence: kind === 'front' ? 0.62 : 0.45,
        note: 'Controller layout prior used only as a mirror-orientation cue; user review should confirm front/rear handedness.'
      },
      {
        id: 'abxy-after-dpad',
        item: 'abxy_cluster',
        anchor: 'left_button_cluster',
        direction: 'right_of',
        confidence: kind === 'front' ? 0.64 : 0.42,
        note: 'ABXY versus D-pad placement is a strong mirror cue on front-view controllers.'
      }
    );
  } else if (objectProfile === 'building_group' && (kind === 'top' || kind === 'oblique')) {
    semanticAnchors.push(
      {
        id: 'building-blue-hall-east-of-warehouses',
        item: 'primary_blue_roof_hall',
        anchor: 'warehouse_row_west',
        direction: 'right_of',
        confidence: kind === 'top' ? 0.78 : 0.64,
        note: 'Campus-layout prior: the blue-roof production hall sits to the right/east of the long white warehouse rows.'
      },
      {
        id: 'building-tank-farm-east-of-blue-hall',
        item: 'tank_farm',
        anchor: 'primary_blue_roof_hall',
        direction: 'right_of',
        confidence: kind === 'top' ? 0.72 : 0.62,
        note: 'Campus-layout prior: the cylindrical tank farm sits beyond the blue-roof hall on the right side of the site.'
      },
      {
        id: 'building-parking-south-of-blue-hall',
        item: 'parking_lot',
        anchor: 'primary_blue_roof_hall',
        direction: 'below',
        confidence: kind === 'top' ? 0.7 : 0.58,
        note: 'Campus-layout prior: the parking field is below/south of the primary blue-roof hall in the supplied views.'
      }
    );
  }

  const reasons = [];
  if (kind === 'left' || kind === 'right') reasons.push('side view left/right labels are ambiguous without semantic handedness cues');
  if (kind === 'front' || kind === 'rear') reasons.push('front/rear views can preserve silhouette under horizontal mirroring');
  if ((analysis.symmetry?.score || 0) > 0.55) reasons.push('strong vertical symmetry makes mirror errors visually plausible');
  if (!semanticAnchors.length) reasons.push('no semantic left/right anchors were detected by the deterministic CV pass');

  const status = semanticAnchors.length > 0
    ? ((analysis.symmetry?.score || 0) > 0.65 ? 'medium' : 'low')
    : (kind === 'unknown' || kind === 'oblique' ? 'unknown' : 'high');
  return {
    coordinate_convention: 'image_x_right_y_down',
    model_convention: 'Map image-space left/right to model-space axes only after checking semantic anchors; do not infer handedness from silhouette alone.',
    mirror_risk: {
      status,
      confidence: round(clamp(0.35 + (analysis.symmetry?.score || 0) * 0.35 + (semanticAnchors.length ? 0.12 : 0.25), 0.25, 0.86)),
      reasons
    },
    semantic_anchors: semanticAnchors,
    review_required: status !== 'low'
  };
}

function componentCandidatesForView(viewKind, bbox, viewConfidence, objectProfile = 'switch_controller') {
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

  if (objectProfile === 'vehicle_ambulance') {
    addAmbulanceCandidates(viewKind, { addBox, addPoint });
  } else if (objectProfile === 'building_group') {
    addBuildingGroupCandidates(viewKind, { addBox, addPoint });
  } else if (viewKind === 'front') {
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

function addAmbulanceCandidates(viewKind, helpers) {
  const { addBox, addPoint } = helpers;
  if (viewKind === 'left' || viewKind === 'right') {
    addBox('ambulance_side_main_body', 'amb-main-body', { x: 0.24, y: 0.25, width: 0.66, height: 0.48 }, 'Ambulance side body candidate from vehicle profile anchors.', 0.72);
    addBox('ambulance_side_cab_lower', 'amb-cab-lower', { x: 0.05, y: 0.34, width: 0.24, height: 0.37 }, 'Ambulance side cab lower candidate from vehicle profile anchors.', 0.68);
    addBox('ambulance_side_cab_upper', 'amb-cab-upper-shell', { x: 0.07, y: 0.12, width: 0.24, height: 0.28 }, 'Ambulance side cab upper candidate from roof/cab silhouette.', 0.64);
    addBox('ambulance_side_windshield', 'amb-windshield', { x: 0.17, y: 0.15, width: 0.13, height: 0.22 }, 'Ambulance windshield candidate from cab side profile.', 0.58);
    addBox('ambulance_side_window', 'amb-left-side-window', { x: 0.42, y: 0.24, width: 0.22, height: 0.21 }, 'Ambulance side window candidate from side profile.', 0.62);
    addPoint('ambulance_front_wheel_center', 'wheel-left-front-tire', { x: 0.24, y: 0.83 }, 'Front wheel center keypoint candidate from side view.', 0.7);
    addPoint('ambulance_rear_wheel_center', 'wheel-left-rear-tire', { x: 0.78, y: 0.83 }, 'Rear wheel center keypoint candidate from side view.', 0.7);
    addBox('ambulance_side_lightbar', 'roof-red-lightbar', { x: 0.26, y: 0.03, width: 0.14, height: 0.07 }, 'Roof lightbar candidate from side roofline.', 0.6);
    addBox('ambulance_side_stripe', 'amb-left-red-stripe', { x: 0.31, y: 0.52, width: 0.51, height: 0.08 }, 'Side stripe candidate from ambulance profile prior.', 0.48);
    addBox('ambulance_side_text', 'amb-left-ambulance-text', { x: 0.58, y: 0.27, width: 0.24, height: 0.12 }, 'Side text candidate from ambulance profile prior.', 0.42);
  } else if (viewKind === 'top') {
    addBox('ambulance_top_main_body', 'amb-main-body', { x: 0.19, y: 0.18, width: 0.67, height: 0.64 }, 'Top-view body footprint candidate.', 0.68);
    addBox('ambulance_top_cab', 'amb-cab-lower', { x: 0.05, y: 0.21, width: 0.24, height: 0.58 }, 'Top-view cab footprint candidate.', 0.56);
    addBox('ambulance_top_lightbar', 'roof-red-lightbar', { x: 0.23, y: 0.44, width: 0.13, height: 0.12 }, 'Top-view roof lightbar candidate.', 0.62);
  } else if (viewKind === 'front') {
    addBox('ambulance_front_cab_lower', 'amb-cab-lower', { x: 0.12, y: 0.35, width: 0.76, height: 0.45 }, 'Front cab lower candidate.', 0.62);
    addBox('ambulance_front_cab_upper', 'amb-cab-upper-shell', { x: 0.14, y: 0.12, width: 0.72, height: 0.35 }, 'Front cab upper candidate.', 0.6);
    addBox('ambulance_front_windshield', 'amb-windshield', { x: 0.23, y: 0.18, width: 0.54, height: 0.25 }, 'Front windshield candidate.', 0.58);
    addBox('ambulance_front_lightbar', 'roof-red-lightbar', { x: 0.36, y: 0.02, width: 0.28, height: 0.08 }, 'Front roof lightbar candidate.', 0.56);
  } else if (viewKind === 'rear') {
    addBox('ambulance_rear_body', 'amb-main-body', { x: 0.12, y: 0.18, width: 0.76, height: 0.64 }, 'Rear body candidate.', 0.56);
  }
}

function addBuildingGroupCandidates(viewKind, helpers) {
  const { addBox, addPoint } = helpers;
  const confidenceBoost = viewKind === 'top' ? 0.06 : 0;
  const addCampusBox = (id, hint, rel, note, confidence) => {
    addBox(id, hint, rel, note, Math.min(0.74, confidence + confidenceBoost));
  };

  if (viewKind === 'top') {
    addCampusBox('building_top_site_boundary', 'site_boundary', { x: 0.02, y: 0.05, width: 0.92, height: 0.88 }, 'R7 campus-layout template candidate for the full industrial site boundary.', 0.66);
    addCampusBox('building_top_warehouse_row_west', 'warehouse_row_west', { x: 0.06, y: 0.14, width: 0.21, height: 0.63 }, 'R7 campus-layout prior for the west long white warehouse row.', 0.7);
    addCampusBox('building_top_warehouse_row_inner', 'warehouse_row_inner', { x: 0.28, y: 0.16, width: 0.13, height: 0.58 }, 'R7 campus-layout prior for the inner white warehouse row.', 0.66);
    addCampusBox('building_top_primary_blue_hall', 'primary_blue_roof_hall', { x: 0.43, y: 0.14, width: 0.29, height: 0.52 }, 'R7 campus-layout prior for the primary blue-roof hall footprint.', 0.72);
    addCampusBox('building_top_tank_farm', 'tank_farm', { x: 0.77, y: 0.1, width: 0.14, height: 0.18 }, 'R7 campus-layout prior for the cylindrical tank farm.', 0.64);
    addCampusBox('building_top_utility_building', 'utility_building', { x: 0.73, y: 0.43, width: 0.15, height: 0.2 }, 'R7 campus-layout prior for the right-side utility/mechanical building.', 0.6);
    addCampusBox('building_top_admin_office', 'admin_office', { x: 0.41, y: 0.69, width: 0.15, height: 0.13 }, 'R7 campus-layout prior for the low admin/office block near the lower center of the campus.', 0.58);
    addCampusBox('building_top_parking_lot', 'parking_lot', { x: 0.58, y: 0.68, width: 0.32, height: 0.19 }, 'R7 campus-layout prior for the parking lot footprint.', 0.66);
    addCampusBox('building_top_internal_roads', 'internal_roads', { x: 0.03, y: 0.08, width: 0.89, height: 0.8 }, 'R7 campus-layout prior for internal road loops and paved circulation.', 0.52);
    addPoint('building_top_blue_hall_center', 'primary_blue_roof_hall', { x: 0.57, y: 0.4 }, 'Center keypoint for primary blue-roof hall massing review.', 0.66);
    addPoint('building_top_tank_farm_center', 'tank_farm', { x: 0.84, y: 0.19 }, 'Center keypoint for tank farm massing review.', 0.58);
  } else if (viewKind === 'oblique') {
    addCampusBox('building_oblique_site_boundary', 'site_boundary', { x: 0.03, y: 0.08, width: 0.91, height: 0.82 }, 'R7 campus-layout template candidate for the oblique site extent.', 0.54);
    addCampusBox('building_oblique_warehouse_row_west', 'warehouse_row_west', { x: 0.08, y: 0.18, width: 0.22, height: 0.51 }, 'R7 campus-layout prior for west warehouse rows in oblique view.', 0.58);
    addCampusBox('building_oblique_warehouse_row_inner', 'warehouse_row_inner', { x: 0.29, y: 0.2, width: 0.15, height: 0.49 }, 'R7 campus-layout prior for inner warehouse rows in oblique view.', 0.54);
    addCampusBox('building_oblique_primary_blue_hall', 'primary_blue_roof_hall', { x: 0.44, y: 0.17, width: 0.3, height: 0.44 }, 'R7 campus-layout prior for blue-roof hall massing in oblique view.', 0.6);
    addCampusBox('building_oblique_tank_farm', 'tank_farm', { x: 0.78, y: 0.12, width: 0.14, height: 0.17 }, 'R7 campus-layout prior for cylindrical tanks in oblique view.', 0.54);
    addCampusBox('building_oblique_utility_building', 'utility_building', { x: 0.72, y: 0.43, width: 0.16, height: 0.19 }, 'R7 campus-layout prior for right-side utility/mechanical building in oblique view.', 0.52);
    addCampusBox('building_oblique_admin_office', 'admin_office', { x: 0.4, y: 0.68, width: 0.17, height: 0.13 }, 'R7 campus-layout prior for lower admin/office block in oblique view.', 0.5);
    addCampusBox('building_oblique_parking_lot', 'parking_lot', { x: 0.58, y: 0.66, width: 0.31, height: 0.18 }, 'R7 campus-layout prior for parking lot in oblique view.', 0.52);
    addCampusBox('building_oblique_internal_roads', 'internal_roads', { x: 0.04, y: 0.1, width: 0.88, height: 0.76 }, 'R7 campus-layout prior for paved circulation in oblique view.', 0.45);
  } else {
    addCampusBox('building_uncertain_site_boundary', 'site_boundary', { x: 0.03, y: 0.08, width: 0.9, height: 0.82 }, 'R7 campus-layout fallback candidate until this building-group view is classified.', 0.38);
  }
}

export function makeImageSetObservation({ objectType, objectName, analyses, assignedViews, overlayDir = null }) {
  const objectProfile = inferObjectProfile(objectType);
  const images = assignedViews.map((assigned) => makeImageObservation(assigned, objectProfile));
  const detected = unique(images.map((item) => item.detected_view.kind));
  const requiredViews = requiredViewsForProfile(objectProfile);
  const missingViews = requiredViews.filter((view) => !detected.includes(view));
  const usableCount = images.filter((item) => item.quality_report.usable_for_modeling).length;
  const risks = [];
  if (objectProfile === 'building_group') {
    if (!detected.includes('top')) risks.push('true site-plan/top view is missing');
    if (!detected.includes('oblique')) risks.push('oblique aerial view is missing');
  } else {
    if (!detected.includes('front')) risks.push('front view not confidently detected');
    if (!detedHasSide(detected)) risks.push('side/depth view not confidently detected');
    if (!detected.includes('top')) risks.push('true top view is missing');
  }
  if (usableCount < Math.ceil(images.length / 2)) risks.push('less than half of the images are usable by current CV heuristics');

  const scaleCalibration = makeScaleCalibration({ objectProfile, images, missingViews });
  const usableForModeling = objectProfile === 'building_group'
    ? usableCount > 0 && detected.includes('top') && detected.includes('oblique')
    : usableCount > 0 && detected.includes('front');
  return {
    version: 1,
    object: {
      type: objectType,
      name: objectName,
      profile: objectProfile,
      source_images: analyses.map((analysis) => toRepoRelative(analysis.path))
    },
    image_set_quality: qualityLabel(images, missingViews),
    views_detected: detected,
    missing_views: missingViews,
    scale_calibration: scaleCalibration,
    images,
    evidence_graph: makeObservationEvidenceGraph({ objectProfile, images, detected, missingViews, scaleCalibration }),
    quality_report: {
      usable_for_modeling: usableForModeling,
      risks,
      notes: [
        'This is a deterministic CV baseline. A later VLM pass should verify component semantics.',
        'Overlay review is required before generating a final model plan.'
      ]
    },
    review: {
      overlay_dir: overlayDir ? toRepoRelative(overlayDir) : null,
      open_questions: reviewQuestionsForProfile(objectProfile)
    }
  };
}

export function makeObservationEvidenceGraph({ objectProfile, images, detected, missingViews, scaleCalibration = null }) {
  const requirements = OBSERVATION_PART_REQUIREMENTS[objectProfile] || {};
  const viewIds = makeViewIds(images);
  const openQuestions = [];
  const parts = Object.entries(requirements).map(([partId, requirement]) => {
    const sources = [];
    for (const image of images) {
      for (const observation of image.observations || []) {
        if (!requirement.hints.includes(observation.component_hint)) continue;
        sources.push(observationSource(image, observation, viewIds.get(image.image.path)));
      }
    }
    const confirmedViews = unique(sources
      .filter((source) => source.status === 'observed')
      .map((source) => source.view_kind));
    const partMissingViews = requirement.views.filter((view) => !confirmedViews.includes(view));
    const conflicts = [];
    const questions = [];
    if (partMissingViews.length > 0) {
      conflicts.push({
        type: 'missing_required_view',
        severity: 'warn',
        views: partMissingViews,
        note: `Missing required view evidence for ${partMissingViews.join(', ')}.`
      });
      questions.push(`${partId}: confirm ${partMissingViews.join(', ')} view evidence.`);
    }
    const templateSources = sources.filter((source) => /template|layout|prior/i.test(source.note || ''));
    if (templateSources.length > 0) {
      conflicts.push({
        type: 'template_candidate_used',
        severity: 'info',
        views: unique(templateSources.map((source) => source.view_kind)),
        note: 'One or more candidate records came from a layout/template heuristic.'
      });
      questions.push(`${partId}: review template-derived candidate boxes before accepting dimensions.`);
    }
    for (const question of questions) openQuestions.push(question);
    const confidence = averageConfidence(sources);
    return {
      part_id: partId,
      status: partMissingViews.length === requirement.views.length ? 'template_prior' : partMissingViews.length > 0 ? 'inferred' : 'observed',
      template_prior: templateSources.length > 0 || partMissingViews.length > 0,
      manual_confirmed: false,
      required_views: requirement.views,
      confirmed_views: confirmedViews,
      missing_views: partMissingViews,
      confidence,
      sources,
      conflicts,
      open_questions: questions
    };
  });

  return {
    version: 1,
    image_count: images.length,
    views_detected: detected,
    missing_views: missingViews,
    ...(scaleCalibration ? { scale_calibration: scaleCalibration } : {}),
    part_matches: parts.map((part) => ({
      part_id: part.part_id,
      strategy: 'component_hint_view_requirement',
      matched_views: part.confirmed_views,
      missing_views: part.missing_views,
      source_count: part.sources.length,
      confidence: part.confidence
    })),
    parts,
    open_questions: unique(openQuestions)
  };
}

function makeViewIds(images) {
  const counts = new Map();
  const result = new Map();
  for (const image of images) {
    const kind = image.detected_view.kind;
    const base = kind === 'right' || kind === 'left' ? 'side_photo' : `${kind}_photo`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    result.set(image.image.path, count === 1 ? base : `${base}_${count}`);
  }
  return result;
}

function observationSource(image, observation, view) {
  return {
    view,
    view_kind: image.detected_view.kind,
    kind: evidenceKind(observation.kind),
    status: 'observed',
    source_image: image.image.path,
    observation_id: observation.id,
    confidence: observation.confidence,
    note: observation.note || `Evidence from ${observation.id}.`
  };
}

function evidenceKind(kind) {
  if (kind === 'silhouette') return 'silhouette';
  if (kind === 'center_point') return 'center_point';
  if (kind === 'keypoint') return 'keypoint';
  if (kind === 'edge' || kind === 'curve') return 'edge';
  if (kind === 'color_region') return 'color_region';
  if (kind === 'text_or_logo') return 'text_label';
  if (kind === 'component_bbox') return 'silhouette';
  return 'manual_note';
}

function requiredViewsForProfile(objectProfile) {
  if (objectProfile === 'vehicle_ambulance') return ['left', 'front', 'rear', 'top'];
  if (objectProfile === 'compact_remote') return ['front', 'right', 'top'];
  if (objectProfile === 'building_group') return ['top', 'oblique'];
  return ['front', 'rear', 'right', 'top'];
}

function makeScaleCalibration({ objectProfile, images, missingViews }) {
  const defaults = PROFILE_DEFAULT_SCALE[objectProfile] || PROFILE_DEFAULT_SCALE.switch_controller;
  const measurements = [];
  for (const image of images) {
    const bbox = image.metrics?.object_bbox;
    if (!bbox) continue;
    const [,, widthPx, heightPx] = bbox;
    const view = image.detected_view.kind;
    const dimensions = dimensionsForView(view, defaults);
    if (!dimensions) continue;
    measurements.push({
      view,
      source_image: image.image.path,
      object_bbox: bbox,
      physical_width_mm: dimensions.width,
      physical_height_mm: dimensions.height,
      pixels_per_mm_x: round(widthPx / dimensions.width, 4),
      pixels_per_mm_y: round(heightPx / dimensions.height, 4),
      confidence: round(clamp((image.detected_view.confidence || 0.4) - (view === 'oblique' ? 0.18 : 0), 0.25, 0.88))
    });
  }
  const measuredViews = unique(measurements.map((item) => item.view));
  const coverage = measuredViews.length / Math.max(1, requiredViewsForProfile(objectProfile).length);
  const confidence = round(clamp(0.38 + coverage * 0.28 + averageConfidence(measurements) * 0.34 - missingViews.length * 0.03, 0.24, 0.86), 3);
  return {
    units: 'mm',
    strategy: 'profile_default_dimension_with_view_bbox',
    default_scale: defaults,
    measurements,
    confidence,
    missing_views: missingViews,
    notes: [
      'Scale is calibrated against profile default dimensions and detected object bboxes.',
      'Treat as provisional until a user-provided physical dimension or calibrated orthographic view is available.'
    ]
  };
}

function dimensionsForView(view, defaults) {
  if (view === 'left' || view === 'right') return { width: defaults.width, height: defaults.height };
  if (view === 'top' || view === 'bottom') return { width: defaults.width, height: defaults.depth };
  if (view === 'front' || view === 'rear') return { width: defaults.depth, height: defaults.height };
  return null;
}

function inferObjectProfile(objectType) {
  if (['remote_control', 'media_remote', 'compact_remote'].includes(objectType)) return 'compact_remote';
  if (['vehicle_ambulance', 'ambulance', 'toy_ambulance'].includes(objectType)) return 'vehicle_ambulance';
  if (['building_group', 'building_campus', 'industrial_campus', 'factory_campus', 'industrial_park', 'factory_complex'].includes(objectType)) return 'building_group';
  return 'switch_controller';
}

function reviewQuestionsForProfile(objectProfile) {
  if (objectProfile === 'building_group') {
    return [
      'Confirm the top/oblique view assignments and the campus north/up convention.',
      'Provide one known site dimension, bay spacing, or road width to lock scale.',
      'Mark building/tank/parking/road labels before generating a final massing PartGraph.'
    ];
  }
  return [
    'Confirm which photos are true front/rear/side views.',
    'Provide one known physical dimension to lock scale.',
    'Mark component labels for shells, buttons, sticks, screws, and grips.'
  ];
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
    .filter((item) => (item.kind === 'center_point' || item.kind === 'keypoint') && item.points?.length)
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

function traceObjectContour(edges, bounds, width, height) {
  if (!bounds || edges.length === 0) {
    return [[0, 0], [width, 0], [width, height], [0, height], [0, 0]];
  }
  const slices = 18;
  const left = [];
  const right = [];
  for (let index = 0; index < slices; index += 1) {
    const y0 = bounds.y + (bounds.height * index) / slices;
    const y1 = bounds.y + (bounds.height * (index + 1)) / slices;
    const rowEdges = edges.filter((edge) => edge.y >= y0 && edge.y < y1 && edge.x >= bounds.x && edge.x <= bounds.x + bounds.width);
    if (rowEdges.length === 0) continue;
    const xs = rowEdges.map((edge) => edge.x).sort((a, b) => a - b);
    const y = round((y0 + y1) / 2);
    left.push([round(xs[Math.floor(xs.length * 0.08)]), y]);
    right.push([round(xs[Math.floor(xs.length * 0.92)]), y]);
  }
  const contour = [...left, ...right.reverse()];
  if (contour.length < 6) {
    const { x, y } = bounds;
    contour.push([x, y], [x + bounds.width, y], [x + bounds.width, y + bounds.height], [x, y + bounds.height]);
  }
  contour.push(contour[0]);
  return contour.map(([x, y]) => [round(clamp(x, 0, width)), round(clamp(y, 0, height))]);
}

function keypointsFromBounds(bounds, width, height) {
  if (!bounds) return [];
  const { x, y } = bounds;
  const x2 = x + bounds.width;
  const y2 = y + bounds.height;
  const confidence = round(clamp((bounds.width * bounds.height) / Math.max(1, width * height), 0.28, 0.74));
  return [
    { id: 'top_left_keypoint', point: [round(x), round(y)], confidence, note: 'Object bbox top-left keypoint candidate.' },
    { id: 'top_right_keypoint', point: [round(x2), round(y)], confidence, note: 'Object bbox top-right keypoint candidate.' },
    { id: 'bottom_right_keypoint', point: [round(x2), round(y2)], confidence, note: 'Object bbox bottom-right keypoint candidate.' },
    { id: 'bottom_left_keypoint', point: [round(x), round(y2)], confidence, note: 'Object bbox bottom-left keypoint candidate.' },
    { id: 'center_keypoint', point: [round(x + bounds.width / 2), round(y + bounds.height / 2)], confidence: round(clamp(confidence + 0.08, 0.32, 0.8)), note: 'Object bbox center keypoint candidate.' }
  ];
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

function averageConfidence(items) {
  const values = (items || [])
    .map((item) => item.confidence)
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 3);
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
