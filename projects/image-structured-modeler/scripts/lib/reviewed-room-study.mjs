const ROOM_MATERIALS = [
  { name: 'Room_Study_Left_Wall', color: '#d6d3d1', alpha: 0.82 },
  { name: 'Room_Study_Right_Wall', color: '#e7e5e4', alpha: 0.82 },
  { name: 'Room_Study_Floor', color: '#64748b', alpha: 0.9 },
  { name: 'Room_Study_Ceiling', color: '#f5f5f4', alpha: 0.86 },
  { name: 'Room_Study_End_Wall', color: '#a8a29e', alpha: 0.82 },
  { name: 'Room_Study_Detail', color: '#d97706', alpha: 1 }
];

export function validateRoomStudyPromotion({
  calibrationReviewResult,
  roomSurfaceGraph,
  roomSurfaceReviewResult,
  draftViewGraph,
  draftViewReviewDecision,
  visibleCoverageReviewResult,
  detailPromotion,
  mockScale
} = {}) {
  const blockers = [];
  if (calibrationReviewResult?.status !== 'accepted_for_rectification') blockers.push('accepted_perspective_calibration_review_required');
  if (roomSurfaceReviewResult?.status !== 'accepted_for_derived_drafting') blockers.push('accepted_room_surface_review_required');
  if (draftViewReviewDecision?.status !== 'accepted' || draftViewReviewDecision?.promotion_allowed !== true) blockers.push('accepted_draft_view_review_required');
  const availableSlots = (draftViewGraph?.view_slots || []).filter((slot) => slot.status !== 'unknown').map((slot) => slot.slot_id);
  if (!(draftViewReviewDecision?.accepted_view_slot_ids || []).every((id) => availableSlots.includes(id))) blockers.push('accepted_draft_view_lineage_mismatch');
  if (!sameSet(roomSurfaceReviewResult?.accepted_surface_ids || [], roomSurfaceGraph?.surfaces?.map((surface) => surface.id) || [])) blockers.push('accepted_room_surface_lineage_incomplete');
  if (visibleCoverageReviewResult?.status !== 'accepted_for_visual_completion' || visibleCoverageReviewResult?.visual_completion_eligible !== true) blockers.push('accepted_visible_coverage_review_required');
  if (detailPromotion?.status !== 'accepted_for_mock_study' || detailPromotion?.partgraph_promotion_allowed !== true) blockers.push('accepted_surface_local_detail_review_required');
  if (detailPromotion?.reprojection_qa?.status !== 'pass') blockers.push('accepted_reprojection_qa_required');
  if (mockScale?.status !== 'assumed_for_mock_study' || mockScale?.release_allowed !== false) blockers.push('bounded_mock_scale_assumption_required');
  return Array.from(new Set(blockers));
}

export function buildRoomStudyProfile({ sampleId, scale } = {}) {
  return {
    version: 1,
    profile_id: 'interior_room_reviewed_study',
    product_type: 'interior_room',
    name: `${sampleId} Reviewed Room Study`,
    description: 'Review-gated visible room-surface mock study with no hidden camera-side closure.',
    dsl_version: 1,
    units: 'mm',
    default_scale: { width: scale.width, depth: scale.depth, height: scale.height },
    expected_views: ['oblique_context', 'front', 'left_or_right_side', 'top'],
    required_parts: [],
    allowed_primitives: ['mesh'],
    materials: ROOM_MATERIALS,
    tags: [
      { name: 'Interior_Room_Reviewed', color: '#0f766e' },
      { name: 'Interior_Room_Release_Blocked', color: '#b91c1c' }
    ],
    review: {
      scenes: [{
        name: `${safeId(sampleId)}_Reviewed_Room_Study`,
        camera: {
          eye: [-scale.width * 1.1, -scale.depth * 0.25, scale.height * 1.25],
          target: [scale.width * 0.5, scale.depth * 0.55, scale.height * 0.45],
          up: [0, 0, 1],
          fov: 44
        }
      }],
      style: {
        name: 'Interior_Room_Review',
        display_edges: true,
        profiles: true,
        profile_width: 2,
        face_style: 'shaded_with_textures',
        background_color: '#eef2f1',
        sky_color: '#dbeafe',
        ground_color: '#d6d3d1'
      }
    },
    compiler: {
      name: 'compile-part-graph-to-sketchup-dsl',
      version: 'reviewed-room-study-v1',
      geometry_gate: { enabled: false }
    }
  };
}

export function assembleReviewedRoomStudyPartGraph({
  sample,
  roomSurfaceGraph,
  roomSurfaceReviewResult,
  visibleCoverageReviewResult,
  detailPromotion,
  profile
} = {}) {
  const scale = sample.mock_scale;
  const acceptedIds = new Set(roomSurfaceReviewResult.accepted_surface_ids);
  const surfaceParts = roomSurfaceGraph.surfaces
    .filter((surface) => acceptedIds.has(surface.id))
    .map((surface) => makeSurfacePart({ surface, scale, sourceImage: sample.source.local_path }));
  const surfaceById = new Map(roomSurfaceGraph.surfaces.map((surface) => [surface.id, surface]));
  const detailParts = detailPromotion.accepted_details.map((detail) => makeDetailPart({
    detail,
    surface: surfaceById.get(detail.target_surface_id),
    scale,
    sourceImage: sample.source.local_path
  }));
  return {
    version: 1,
    id: `${safeId(sample.sample_id)}-reviewed-room-study-part-graph`,
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
      type: 'interior_room',
      name: `${sample.sample_id} Reviewed Visible Room Study`,
      source: sample.source.local_path
    },
    scale: {
      width: scale.width,
      depth: scale.depth,
      height: scale.height,
      confidence: scale.confidence,
      calibration: { status: scale.status, release_allowed: false, source: sample.kind }
    },
    evidence_graph: {
      version: 1,
      source_images: [sample.source.local_path],
      views_detected: ['oblique_context'],
      accepted_surface_ids: [...acceptedIds],
      accepted_local_detail_ids: detailPromotion.accepted_detail_ids,
      visible_coverage_review: 'visible-coverage-review-result.json',
      visible_coverage_status: visibleCoverageReviewResult.coverage_status,
      excluded_region_count: visibleCoverageReviewResult.excluded_regions.length,
      open_questions: [
        'Metric scale requires an accepted real dimension.',
        'The camera-side closure and other hidden geometry require another view or explicit review.',
        'Excluded image regions remain evidence-only and are never represented as geometry.'
      ]
    },
    parts: [...surfaceParts, ...detailParts],
    review: {
      open_questions: [
        'Confirm one metric corridor dimension before release use.',
        'Provide a reverse or side view before accepting hidden closure.',
        'Retain exclusion polygons in the evidence package, not in PartGraph geometry.'
      ],
      correction_targets: surfaceParts.map((part) => ({
        part_id: part.id,
        path: `parts[${part.id}].shape.parameters`,
        reason: 'Replace nominal mock-study dimensions after metric scale review.',
        severity: 'warn'
      }))
    },
    visible_coverage: {
      status: visibleCoverageReviewResult.status,
      coverage_status: visibleCoverageReviewResult.coverage_status,
      exclusion_geometry_compiled: false,
      release_allowed: false
    }
  };
}

export function buildRoomStudyQaSpec(partGraph) {
  const allowed = [];
  for (const part of partGraph.parts || []) {
    for (const relationship of part.relationships || []) {
      if (['touching', 'attached_to'].includes(relationship.type)) allowed.push({ item: part.id, with: relationship.target });
    }
  }
  return {
    title: 'Reviewed Interior Room Mock QA',
    rules: {
      allowed_collisions: allowed,
      views: [
        { name: 'top', axes: ['x', 'y'], depthAxis: 'z', title: 'Reviewed Room Plan' },
        { name: 'front', axes: ['x', 'z'], depthAxis: 'y', title: 'Reviewed End Surface' },
        { name: 'side', axes: ['y', 'z'], depthAxis: 'x', title: 'Reviewed Room Section' }
      ]
    }
  };
}

export function renderRoomStudyIsometricSvg({ partGraph, title = 'Reviewed visible room study' } = {}) {
  const materialByName = new Map(ROOM_MATERIALS.map((material) => [material.name, material]));
  const faces = [];
  for (const part of partGraph?.parts || []) {
    const vertices = part.shape?.parameters?.vertices || [];
    const material = materialByName.get(part.material) || { color: '#cbd5e1', alpha: 0.8 };
    for (const face of part.shape?.parameters?.faces || []) {
      const points = face.map((index) => vertices[index]).filter(Boolean);
      if (points.length < 3) continue;
      faces.push({ points, color: material.color, opacity: material.alpha, depth: average(points.map(([x, y, z]) => x + y + z * 0.08)) });
    }
  }
  const projected = faces.flatMap((face) => face.points.map(projectPoint));
  const bounds = projectionBounds(projected);
  const width = 1200;
  const height = 760;
  const padding = 72;
  const scale = Math.min((width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX), (height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY));
  const toScreen = (point) => {
    const [x, y] = projectPoint(point);
    return [round(padding + (x - bounds.minX) * scale), round(padding + (y - bounds.minY) * scale)];
  };
  const shapes = faces.sort((left, right) => right.depth - left.depth).map((face) => `<polygon points="${face.points.map(toScreen).map((point) => point.join(',')).join(' ')}" fill="${face.color}" fill-opacity="${face.opacity}" stroke="#20242a" stroke-width="1.3"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#eef2f1"/><g data-layer="accepted-visible-room-partgraph">${shapes}</g><rect x="24" y="20" width="780" height="58" fill="#fff" fill-opacity="0.92" stroke="#94a3b8"/><text x="38" y="45" font-family="ui-monospace,monospace" font-size="18" fill="#111827">${escapeXml(title)}</text><text x="38" y="66" font-family="ui-monospace,monospace" font-size="12" fill="#991b1b">accepted visible room surfaces / nominal scale / open near boundary / release=false</text></svg>`;
}

function makeSurfacePart({ surface, scale, sourceImage }) {
  return {
    id: surface.id,
    name: safeId(surface.role),
    type: 'reviewed_visible_surface',
    role: surface.role,
    material: materialForRole(surface.role),
    shape: { primitive: 'mesh', parameters: surfaceMesh(surface.role, scale) },
    relationships: surface.adjacency.map((adjacency) => ({
      type: 'touching', target: adjacency.surface_id, note: adjacency.evidence,
      source: 'room_surface_graph_v1', confidence: surface.source.confidence, review_required: false
    })),
    evidence_status: 'manual_confirmed',
    evidence_sources: [{
      kind: 'reviewed_room_surface_graph', view: 'oblique_context', status: 'manual_confirmed',
      source_image: sourceImage, confidence: surface.source.confidence,
      note: `Accepted visible ${surface.role}; metric dimensions are mock-study assumptions.`
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_calibration_room_surface_and_coverage_reviews',
    grounding_decision: 'promoted_geometry',
    source_observation_ids: [surface.source.source_seed_id],
    review_required: false,
    helper_allowed: false,
    photo_grade_eligible: false,
    fallback_state: 'structured_primitive',
    compile: { emit: true, runtime_scope: 'mock_study_only' },
    promoted_geometry: true,
    qa: {
      promoted_geometry: true, accepted_surface_id: surface.id,
      metric_scale_accepted: false, hidden_geometry_created: false, release_allowed: false
    }
  };
}

function makeDetailPart({ detail, surface, scale, sourceImage }) {
  return {
    id: detail.id,
    name: safeId(detail.role),
    type: detail.geometry_type,
    role: detail.role,
    parent: detail.target_surface_id,
    material: 'Room_Study_Detail',
    shape: { primitive: 'mesh', parameters: detailMesh({ detail, surface, scale }) },
    relationships: [{
      type: 'attached_to', target: detail.target_surface_id,
      note: 'Accepted surface-local detail.', source: 'surface_local_detail_promotion_v1', confidence: 0.85, review_required: false
    }],
    evidence_status: 'manual_confirmed',
    evidence_sources: [{
      kind: 'accepted_surface_local_detail_reprojection', view: 'oblique_context', status: 'manual_confirmed',
      source_image: sourceImage, confidence: 0.85,
      note: `${detail.role} accepted on ${detail.target_surface_id}; depth remains a mock-study convention.`
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_surface_local_review_and_reprojection',
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
      promoted_geometry: true, accepted_detail_id: detail.id, accepted_surface_id: detail.target_surface_id,
      metric_scale_accepted: false, release_allowed: false
    }
  };
}

function surfaceMesh(role, { width, depth, height }) {
  const thickness = 80;
  if (role === 'left_wall') return boxMesh([-thickness, 0, 0], [0, depth, height]);
  if (role === 'right_wall') return boxMesh([width, 0, 0], [width + thickness, depth, height]);
  if (role === 'floor') return boxMesh([0, 0, -thickness], [width, depth, 0]);
  if (role === 'ceiling') return boxMesh([0, 0, height], [width, depth, height + thickness]);
  if (role === 'end_wall') return boxMesh([0, depth, 0], [width, depth + thickness, height]);
  throw new Error(`unsupported_room_surface_role:${role}`);
}

function detailMesh({ detail, surface, scale }) {
  const bounds = uvBounds(detail.quad_uv);
  const { width, depth, height } = scale;
  const protrusion = 100;
  if (surface.role === 'left_wall') return boxMesh([0, bounds.u0 * depth, height * (1 - bounds.v1)], [protrusion, bounds.u1 * depth, height * (1 - bounds.v0)]);
  if (surface.role === 'right_wall') return boxMesh([width - protrusion, bounds.u0 * depth, height * (1 - bounds.v1)], [width, bounds.u1 * depth, height * (1 - bounds.v0)]);
  if (surface.role === 'ceiling') return boxMesh([bounds.u0 * width, bounds.v0 * depth, height - protrusion], [bounds.u1 * width, bounds.v1 * depth, height]);
  if (surface.role === 'floor') return boxMesh([bounds.u0 * width, bounds.v0 * depth, 0], [bounds.u1 * width, bounds.v1 * depth, protrusion]);
  if (surface.role === 'end_wall') return boxMesh([bounds.u0 * width, depth - protrusion, height * (1 - bounds.v1)], [bounds.u1 * width, depth, height * (1 - bounds.v0)]);
  throw new Error(`unsupported_detail_surface_role:${surface.role}`);
}

function boxMesh(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return {
    vertices: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    faces: [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]],
    smooth: 'none'
  };
}

function uvBounds(quad) {
  const us = quad.map((point) => clamp(point[0], 0, 1));
  const vs = quad.map((point) => clamp(point[1], 0, 1));
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

function materialForRole(role) {
  const names = {
    left_wall: 'Room_Study_Left_Wall', right_wall: 'Room_Study_Right_Wall', floor: 'Room_Study_Floor',
    ceiling: 'Room_Study_Ceiling', end_wall: 'Room_Study_End_Wall'
  };
  return names[role] || 'Room_Study_Detail';
}

function projectPoint([x, y, z]) { return [x * 0.86 - y * 0.52, z * -0.82 + x * 0.22 + y * 0.22]; }
function projectionBounds(points) { return { minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])), minY: Math.min(...points.map((p) => p[1])), maxY: Math.max(...points.map((p) => p[1])) }; }
function average(values) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function sameSet(left = [], right = []) { return left.length === right.length && left.every((value) => right.includes(value)); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function safeId(value) { return String(value || 'unknown').trim().replace(/[^a-zA-Z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '') || 'unknown'; }
function round(value) { return Number(Number(value || 0).toFixed(3)); }
function escapeXml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
