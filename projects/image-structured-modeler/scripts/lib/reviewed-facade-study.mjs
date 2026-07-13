export const FACADE_STUDY_MATERIALS = [
  { name: 'Facade_Study_Brick', color: '#a64b3c', alpha: 0.82 },
  { name: 'Facade_Study_Chamfer', color: '#d4a72c', alpha: 0.82 },
  { name: 'Facade_Study_Metal', color: '#287f8f', alpha: 0.82 },
  { name: 'Facade_Study_Stone', color: '#a8a29e', alpha: 0.82 },
  { name: 'Facade_Study_Glass', color: '#263746', alpha: 0.92 },
  { name: 'Facade_Study_Equipment', color: '#d7dde2', alpha: 1 },
  { name: 'Facade_Study_Utility', color: '#59636e', alpha: 1 }
];

export function validateFacadeStudyApproval({
  approval,
  calibrationReviewResult,
  topologyReviewResult,
  draftViewGraph,
  facadePlaneGraph
} = {}) {
  const blockers = [];
  if (approval?.status !== 'accepted_for_mock_study') blockers.push('accepted_facade_mock_study_review_required');
  if (approval?.scope?.part_graph_study_allowed !== true || approval?.scope?.sketchup_mock_allowed !== true) {
    blockers.push('mock_study_scope_not_allowed');
  }
  if (approval?.scope?.live_sketchup_allowed !== false || approval?.scope?.release_allowed !== false) {
    blockers.push('mock_study_must_block_live_and_release');
  }
  if (!sameSet(
    approval?.accepted_axis_family_ids,
    calibrationReviewResult?.accepted_axis_families?.map((family) => family.direction_family_id)
  )) blockers.push('accepted_axis_family_lineage_mismatch');
  if (!sameSet(
    approval?.accepted_topology_ids,
    [topologyReviewResult?.topology_graph?.summary?.accepted_topology_id].filter(Boolean)
  )) blockers.push('accepted_topology_lineage_mismatch');
  const slotIds = (draftViewGraph?.view_slots || [])
    .filter((slot) => slot.status !== 'unknown')
    .map((slot) => slot.slot_id);
  if (!(approval?.accepted_view_slot_ids || []).every((id) => slotIds.includes(id))) {
    blockers.push('accepted_view_slot_lineage_mismatch');
  }
  if (!sameSet(
    approval?.accepted_plane_ids,
    facadePlaneGraph?.planes?.map((plane) => plane.id)
  )) blockers.push('accepted_plane_lineage_mismatch');
  if (approval?.scale_assumption?.status !== 'assumed_for_mock_study') {
    blockers.push('bounded_mock_scale_assumption_required');
  }
  if (approval?.scale_assumption?.release_allowed !== false) blockers.push('mock_scale_must_not_be_release_scale');
  return Array.from(new Set(blockers));
}

export function buildFacadeStudyProfile(profile, { sampleId, scale } = {}) {
  const next = structuredClone(profile);
  next.default_scale = { width: scale.width, depth: scale.depth, height: scale.height };
  next.compiler = {
    ...(next.compiler || {}),
    version: 'reviewed-visible-facade-study-v1',
    geometry_gate: { enabled: false }
  };
  next.materials = uniqueByName([...(next.materials || []), ...FACADE_STUDY_MATERIALS]);
  next.review = {
    ...(next.review || {}),
    scenes: [{
      name: `${safeId(sampleId)}_Reviewed_Visible_Facade_Study`,
      camera: {
        eye: [-scale.width * 0.85, -scale.depth * 0.8, scale.height * 1.15],
        target: [scale.width * 0.42, scale.depth * 0.42, scale.height * 0.42],
        up: [0, 0, 1],
        fov: 42
      }
    }]
  };
  return next;
}

export function assembleReviewedFacadeStudyPartGraph({
  sample,
  topologySeed,
  facadePlaneGraph,
  approval,
  profile,
  detailPromotion = null
} = {}) {
  const scale = approval.scale_assumption;
  const sourceImage = sample.source.local_path;
  const planPoints = scaledPlanPoints(topologySeed.plan_topology.corners, scale);
  const acceptedPlaneIds = new Set(approval.accepted_plane_ids || []);
  const acceptedDetails = detailPromotion?.partgraph_promotion_allowed === true
    ? detailPromotion.accepted_details || []
    : [];
  const planeFrames = new Map();
  const planeParts = [];
  const detailParts = [];
  const spans = topologySeed.plane_spans.filter((span) => acceptedPlaneIds.has(span.id));

  spans.forEach((span, index) => {
    const edge = topologySeed.plan_topology.edges.find((candidate) => (
      candidate.id === span.plan_edge_id
      || (!span.plan_edge_id && candidate.role === span.plan_role)
    ));
    if (!edge) throw new Error(`No plan edge found for accepted plane ${span.id}`);
    const from = planPoints.get(edge.from);
    const to = planPoints.get(edge.to);
    if (!from || !to) throw new Error(`Plan edge ${edge.id} references an unknown corner`);
    const graphPlane = facadePlaneGraph.planes.find((plane) => plane.id === span.id);
    if (!graphPlane) throw new Error(`Accepted facade plane not found: ${span.id}`);
    const frame = buildPlaneFrame({
      planeId: span.id,
      from,
      to,
      height: scale.height,
      axis: span.orientation_axis,
      homography: graphPlane.rectification.image_to_local_homography,
      thickness: 120
    });
    planeFrames.set(span.id, frame);
    const planeDetails = acceptedDetails.filter((detail) => detail.target_plane_id === span.id);
    const openings = planeDetails.filter((detail) => detail.geometry_type === 'recess_opening');
    const material = FACADE_STUDY_MATERIALS[index % 4].name;
    planeParts.push(makePlanePart({ frame, span, edge, graphPlane, sourceImage, material, openings }));
    for (const detail of planeDetails) {
      detailParts.push(makeDetailPart({ detail, frame, sourceImage }));
    }
  });

  const partGraph = {
    version: 1,
    id: `${safeId(sample.sample_id)}-reviewed-visible-facade-study-part-graph`,
    profile_id: profile.profile_id,
    dsl_version: 1,
    units: 'mm',
    compile_policy: {
      enabled: true,
      runtime_scope: 'mock_study_only',
      release_allowed: false,
      max_needs_review_ratio: 0,
      max_profile_default_ratio: 0,
      min_inferred_parts: 0,
      min_scale_confidence: 0.1,
      require_promoted_geometry: true,
      block_reference_only_output: true
    },
    product: {
      type: 'building_single',
      name: `${sample.sample_id} Reviewed Visible Facade Study`,
      source: sourceImage
    },
    scale: {
      width: scale.width,
      depth: scale.depth,
      height: scale.height,
      confidence: scale.confidence,
      calibration: {
        status: scale.status,
        release_allowed: false,
        source: approval.kind
      }
    },
    evidence_graph: {
      version: 1,
      source_images: [sourceImage],
      views_detected: ['oblique_context', 'front', 'left_or_right_side'],
      accepted_axis_family_ids: approval.accepted_axis_family_ids,
      accepted_topology_ids: approval.accepted_topology_ids,
      accepted_view_slot_ids: approval.accepted_view_slot_ids,
      accepted_plane_ids: approval.accepted_plane_ids,
      accepted_local_detail_ids: acceptedDetails.map((detail) => detail.id),
      open_questions: [
        'Metric scale requires an accepted real dimension.',
        'Rear closure and hidden faces require another view or explicit review.',
        'Only accepted plane-local detail ids are represented.'
      ]
    },
    parts: [...planeParts, ...detailParts],
    review: {
      open_questions: [
        'Confirm one real width, depth, or height before release use.',
        'Review remaining plane-local proposals before adding more details.',
        'Provide another calibrated view before closing hidden geometry.'
      ],
      correction_targets: planeParts.map((part) => ({
        part_id: part.id,
        path: `parts[${part.id}].shape.parameters`,
        reason: 'Replace nominal study dimensions after a metric anchor is accepted.',
        severity: 'warn'
      }))
    },
    detail_promotion: detailPromotion ? {
      kind: detailPromotion.kind,
      status: detailPromotion.status,
      accepted_detail_ids: detailPromotion.accepted_detail_ids,
      reprojection_qa: detailPromotion.reprojection_qa,
      release_allowed: false
    } : null
  };
  return { partGraph, planeFrames, planPoints };
}

export function buildFacadeStudyQaSpec(partGraph) {
  const allowed = [];
  for (const part of partGraph.parts || []) {
    for (const relation of part.relationships || []) {
      if (relation.type === 'touching' || relation.type === 'attached_to') {
        allowed.push({ item: part.id, with: relation.target });
      }
    }
  }
  return {
    title: 'Reviewed Visible Facade Mock QA',
    rules: {
      allowed_collisions: allowed,
      views: [
        { name: 'top', axes: ['x', 'y'], depthAxis: 'z', title: 'Reviewed Topology Plan' },
        { name: 'front', axes: ['x', 'z'], depthAxis: 'y', title: 'Reviewed Front Planes' },
        { name: 'side', axes: ['y', 'z'], depthAxis: 'x', title: 'Reviewed Side Planes' }
      ]
    }
  };
}

export function renderFacadeStudyIsometricSvg({ partGraph, title = 'Reviewed visible facade study' } = {}) {
  const materialByName = new Map(FACADE_STUDY_MATERIALS.map((material) => [material.name, material]));
  const faces = [];
  for (const part of partGraph?.parts || []) {
    if (part.compile?.emit === false || part.shape?.primitive !== 'mesh') continue;
    const vertices = part.shape.parameters?.vertices || [];
    const material = materialByName.get(part.material) || { color: '#cbd5e1', alpha: 0.7 };
    for (const face of part.shape.parameters?.faces || []) {
      const points = face.map((index) => vertices[index]).filter(Boolean);
      if (points.length < 3) continue;
      faces.push({
        points,
        color: material.color,
        opacity: material.alpha,
        depth: average(points.map(([x, y, z]) => x + y + z * 0.08))
      });
    }
  }
  const projected = faces.flatMap((face) => face.points.map(projectIsometricPoint));
  const bounds = projectionBounds(projected);
  const width = 1200;
  const height = 760;
  const padding = 72;
  const scale = Math.min(
    (width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY)
  );
  const toScreen = (point) => {
    const [x, y] = projectIsometricPoint(point);
    return [
      round(padding + (x - bounds.minX) * scale),
      round(padding + (y - bounds.minY) * scale)
    ];
  };
  const shapes = faces
    .sort((left, right) => right.depth - left.depth)
    .map((face) => `<polygon points="${face.points.map(toScreen).map((point) => point.join(',')).join(' ')}" fill="${face.color}" fill-opacity="${face.opacity}" stroke="#20242a" stroke-width="1.3"/>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#eef2f1"/>
  <g data-layer="accepted-visible-facade-partgraph">${shapes}</g>
  <rect x="24" y="20" width="610" height="58" fill="#ffffff" fill-opacity="0.9" stroke="#94a3b8"/>
  <text x="38" y="45" font-family="ui-monospace,monospace" font-size="18" fill="#111827">${escapeXml(title)}</text>
  <text x="38" y="66" font-family="ui-monospace,monospace" font-size="12" fill="#991b1b">accepted visible planes only / nominal scale / no hidden closure / release=false</text>
</svg>`;
}

function makePlanePart({ frame, span, edge, graphPlane, sourceImage, material, openings }) {
  return {
    id: span.id,
    name: `${safeId(edge.id)}_${safeId(span.plan_role)}`,
    type: 'reviewed_visible_plane',
    role: span.id,
    material,
    shape: {
      primitive: 'mesh',
      parameters: wallMeshWithOpenings(frame, openings)
    },
    relationships: (graphPlane.adjacency || []).map((adjacency) => ({
      type: 'touching',
      target: adjacency.plane_id,
      note: `Reviewed shared boundary ${adjacency.evidence}.`,
      source: 'facade_plane_graph_v1',
      confidence: graphPlane.source.confidence,
      review_required: false
    })),
    evidence_status: 'manual_confirmed',
    evidence_sources: [{
      kind: 'reviewed_facade_plane_graph',
      view: graphPlane.orientation_hint.view,
      status: 'manual_confirmed',
      source_image: sourceImage,
      confidence: graphPlane.source.confidence,
      note: `Accepted visible plane ${span.id}; thickness and metric dimensions are mock-study conventions.`
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_calibrated_plane_and_corner_chain',
    grounding_decision: 'promoted_geometry',
    source_observation_ids: [graphPlane.source.semantic_evidence_id],
    review_required: false,
    helper_allowed: false,
    photo_grade_eligible: false,
    fallback_state: 'structured_primitive',
    compile: { emit: true, runtime_scope: 'mock_study_only' },
    promoted_geometry: true,
    qa: {
      promoted_geometry: true,
      accepted_plane_id: span.id,
      accepted_edge_id: edge.id,
      orientation_axis: span.orientation_axis,
      opening_count: openings.length,
      metric_scale_accepted: false,
      hidden_geometry_created: false,
      release_allowed: false
    }
  };
}

function makeDetailPart({ detail, frame, sourceImage }) {
  const bounds = quadBounds(detail.quad_uv);
  const isOpening = detail.geometry_type === 'recess_opening';
  const isEquipment = detail.geometry_type === 'equipment_box';
  const depthRange = isOpening ? [-220, -170] : isEquipment ? [0, 420] : [0, 180];
  const material = isOpening
    ? 'Facade_Study_Glass'
    : isEquipment
      ? 'Facade_Study_Equipment'
      : 'Facade_Study_Utility';
  return {
    id: safeId(detail.id),
    name: `${safeId(detail.role)}_${safeId(detail.id)}`,
    type: isOpening ? 'reviewed_recess_backing' : detail.geometry_type,
    role: detail.role,
    parent: detail.target_plane_id,
    material,
    shape: {
      primitive: 'mesh',
      parameters: prismMeshForUvBounds(frame, bounds, depthRange)
    },
    relationships: [{
      type: 'attached_to',
      target: detail.target_plane_id,
      note: isOpening ? 'Accepted opening backing behind a true wall-mesh void.' : 'Accepted plane-local attached detail.',
      source: 'plane_local_detail_promotion_v1',
      confidence: 0.78,
      review_required: false
    }],
    evidence_status: 'manual_confirmed',
    evidence_sources: [{
      kind: 'accepted_plane_local_detail_reprojection',
      view: 'oblique_context',
      status: 'manual_confirmed',
      source_image: sourceImage,
      confidence: 0.78,
      note: `${detail.role} accepted on ${detail.target_plane_id}; depth remains a mock-study convention.`
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_plane_local_evidence_review_and_reprojection',
    grounding_decision: 'promoted_geometry',
    source_observation_ids: [detail.source_proposal_id],
    projection_residuals: detail.reprojection,
    review_required: false,
    helper_allowed: false,
    photo_grade_eligible: false,
    fallback_state: 'structured_primitive',
    compile: { emit: true, runtime_scope: 'mock_study_only' },
    promoted_geometry: true,
    qa: {
      promoted_geometry: true,
      accepted_detail_id: detail.id,
      accepted_plane_id: detail.target_plane_id,
      geometry_type: detail.geometry_type,
      wall_void_created: isOpening,
      metric_scale_accepted: false,
      release_allowed: false
    }
  };
}

function buildPlaneFrame({ planeId, from, to, height, axis, homography, thickness }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return {
    planeId,
    from,
    to,
    height,
    axis,
    homography,
    thickness,
    length,
    tangent: [dx / length, dy / length],
    normal: [-dy / length, dx / length]
  };
}

function wallMeshWithOpenings(frame, openingDetails) {
  const openings = openingDetails.map((detail) => quadBounds(detail.quad_uv));
  const uCuts = uniqueSorted([0, 1, ...openings.flatMap((bounds) => [bounds.u0, bounds.u1])]);
  const vCuts = uniqueSorted([0, 1, ...openings.flatMap((bounds) => [bounds.v0, bounds.v1])]);
  const mesh = emptyMesh();
  for (let uIndex = 0; uIndex < uCuts.length - 1; uIndex += 1) {
    for (let vIndex = 0; vIndex < vCuts.length - 1; vIndex += 1) {
      const bounds = {
        u0: uCuts[uIndex],
        u1: uCuts[uIndex + 1],
        v0: vCuts[vIndex],
        v1: vCuts[vIndex + 1]
      };
      const center = [(bounds.u0 + bounds.u1) / 2, (bounds.v0 + bounds.v1) / 2];
      if (openings.some((opening) => pointInBounds(center, opening))) continue;
      appendMesh(mesh, prismMeshForUvBounds(frame, bounds, [-frame.thickness, 0]));
    }
  }
  mesh.smooth = 'none';
  return mesh;
}

function prismMeshForUvBounds(frame, bounds, depthRange) {
  const u0 = clamp(bounds.u0, 0, 1);
  const u1 = clamp(bounds.u1, 0, 1);
  const z0 = frame.height * (1 - clamp(bounds.v1, 0, 1));
  const z1 = frame.height * (1 - clamp(bounds.v0, 0, 1));
  const [n0, n1] = depthRange;
  const vertices = [
    pointOnFrame(frame, u0, n0, z0),
    pointOnFrame(frame, u1, n0, z0),
    pointOnFrame(frame, u1, n0, z1),
    pointOnFrame(frame, u0, n0, z1),
    pointOnFrame(frame, u0, n1, z0),
    pointOnFrame(frame, u1, n1, z0),
    pointOnFrame(frame, u1, n1, z1),
    pointOnFrame(frame, u0, n1, z1)
  ];
  return {
    vertices: vertices.map((point) => point.map(round)),
    faces: [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ],
    smooth: 'none'
  };
}

function pointOnFrame(frame, u, normalOffset, z) {
  return [
    frame.from.x + (frame.to.x - frame.from.x) * u + frame.normal[0] * normalOffset,
    frame.from.y + (frame.to.y - frame.from.y) * u + frame.normal[1] * normalOffset,
    z
  ];
}

function scaledPlanPoints(corners, scale) {
  const xs = corners.map((corner) => Number(corner.diagram_xy[0]));
  const ys = corners.map((corner) => Number(corner.diagram_xy[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = Math.max(0.001, maxX - minX);
  const yRange = Math.max(0.001, maxY - minY);
  return new Map(corners.map((corner) => [corner.id, {
    x: round(((corner.diagram_xy[0] - minX) / xRange) * scale.width),
    y: round(((corner.diagram_xy[1] - minY) / yRange) * scale.depth)
  }]));
}

function emptyMesh() {
  return { vertices: [], faces: [], smooth: 'none' };
}

function appendMesh(target, source) {
  const offset = target.vertices.length;
  target.vertices.push(...source.vertices);
  target.faces.push(...source.faces.map((face) => face.map((index) => index + offset)));
}

function quadBounds(quad) {
  const us = quad.map((point) => Number(point[0]));
  const vs = quad.map((point) => Number(point[1]));
  return {
    u0: Math.min(...us),
    u1: Math.max(...us),
    v0: Math.min(...vs),
    v1: Math.max(...vs)
  };
}

function pointInBounds([u, v], bounds) {
  return u >= bounds.u0 && u <= bounds.u1 && v >= bounds.v0 && v <= bounds.v1;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => round(clamp(Number(value), 0, 1), 6)))].sort((a, b) => a - b);
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function sameSet(first = [], second = []) {
  const left = [...new Set(first || [])].sort();
  const right = [...new Set(second || [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeId(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'unknown';
}

function projectIsometricPoint([x, y, z]) {
  return [x + y * 0.58, -x * 0.18 + y * 0.22 - z * 0.82];
}

function projectionBounds(points) {
  if (!points.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  return {
    minX: Math.min(...points.map((point) => point[0])),
    maxX: Math.max(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxY: Math.max(...points.map((point) => point[1]))
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}
