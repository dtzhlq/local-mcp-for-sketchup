import { buildDraftViewReviewOverlay } from './drafting-first-graphs.mjs';

export function buildRoomSurfaceGraph({
  calibrationReviewResult,
  topologySeed,
  sourceCalibrationReviewResult = 'perspective-calibration-review-result.json'
} = {}) {
  const reference = topologySeed?.source_image || { source_image: '', width: 1, height: 1 };
  if (calibrationReviewResult?.status !== 'accepted_for_rectification') {
    return blockedRoomSurfaceGraph({ reference, sourceCalibrationReviewResult, status: 'blocked_no_accepted_calibration', blocker: 'accepted_perspective_calibration_review_required' });
  }
  if (!topologySeed || topologySeed.review_status === 'rejected') {
    return blockedRoomSurfaceGraph({ reference, sourceCalibrationReviewResult, status: 'blocked_no_surface_seed', blocker: 'room_surface_topology_seed_required' });
  }
  const seedIds = new Set(topologySeed.surfaces.map((surface) => surface.id));
  const surfaces = topologySeed.surfaces.map((surface) => ({
    id: surface.id,
    role: surface.role,
    source_image: reference.source_image,
    status: surface.visibility,
    visible_polygon_px: surface.visible_polygon_px.map((point) => point.map(round)),
    rectification_quad_px: surface.rectification_quad_px.map((point) => point.map(round)),
    visible_quad_px: surface.rectification_quad_px.map((point) => point.map(round)),
    orientation_hint: {
      kind: 'accepted_axis_calibrated_room_surface_candidate',
      orientation_axis: surface.orientation_axis,
      normal_hint: surface.normal_hint || 'unknown',
      projection_model: calibrationReviewResult.accepted_camera_model,
      confidence: Number(surface.confidence),
      review_required: true
    },
    adjacency: surface.adjacent_surface_ids.map((id) => ({
      surface_id: id,
      relation: 'shares_reviewed_room_boundary',
      evidence: `room_surface_topology_seed:${surface.id}:${id}`,
      review_required: true
    })),
    occlusion_order: {
      rank: surface.occlusion_rank,
      relation_to_camera: surface.visibility === 'partial'
        ? 'partially_occluded'
        : surface.role === 'end_wall' ? 'far_terminating_surface' : 'bounds_view_volume',
      evidence: `room_surface_topology_seed:${topologySeed.sample_id}`,
      review_required: true
    },
    must_not_merge_with: surface.must_not_merge_with,
    source: {
      kind: surface.source,
      source_seed_id: surface.id,
      confidence: Number(surface.confidence),
      derived_from: [sourceCalibrationReviewResult, `room_surface_topology_seed:${topologySeed.sample_id}`]
    },
    rectification: buildRectification(surface.rectification_quad_px),
    review_required: true,
    promotion_allowed: false
  }));
  const detailCandidates = topologySeed.surface_local_detail_candidates.map((detail) => {
    const validSurfaceIds = detail.candidate_surface_ids.filter((id) => seedIds.has(id));
    return {
      id: detail.id,
      role: detail.role,
      source_image: reference.source_image,
      candidate_surface_ids: validSurfaceIds,
      visible_quad_px: detail.visible_quad_px.map((point) => point.map(round)),
      geometry_type: detail.geometry_type,
      source: {
        kind: detail.source,
        source_seed_id: detail.id,
        confidence: Number(detail.confidence),
        derived_from: [`room_surface_topology_seed:${topologySeed.sample_id}`]
      },
      review_required: true,
      promotion_allowed: false,
      blockers: Array.from(new Set([
        ...(validSurfaceIds.length === 1 ? [] : ['exactly_one_candidate_surface_required']),
        'accepted_room_surface_review_required',
        'accepted_local_detail_review_required'
      ]))
    };
  });
  return {
    kind: 'room_surface_graph_v1',
    version: 1,
    profile_id: 'interior_room',
    coordinate_convention: 'image_x_right_y_down_room_local_axes_reviewed',
    coordinate_reference: {
      source_image: reference.source_image,
      width: reference.width,
      height: reference.height
    },
    source_calibration_review_result: sourceCalibrationReviewResult,
    surfaces,
    surface_local_detail_candidates: detailCandidates,
    review_policy: {
      status: 'needs_surface_review',
      accepted_surface_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: ['accepted_room_surface_review_required', 'accepted_visible_coverage_review_required', 'accepted_local_detail_review_required']
    },
    summary: {
      surface_count: surfaces.length,
      detail_candidate_count: detailCandidates.length,
      visible_surface_ids: surfaces.map((surface) => surface.id),
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildPendingRoomSurfaceReview({ sourceRoomSurfaceGraph = 'room-surface-graph.json' } = {}) {
  return {
    kind: 'room_surface_review_decision_v1',
    version: 1,
    source_room_surface_graph: sourceRoomSurfaceGraph,
    reviewer: 'room-surface-review-template',
    status: 'not_accepted',
    accepted_surface_ids: [],
    rejected_surface_ids: [],
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_room_surface_review_required'],
    notes: ['No room surface is accepted by default.']
  };
}

export function evaluateRoomSurfaceReview({
  roomSurfaceGraph,
  reviewDecision,
  sourceReviewDecision = 'room-surface-review.json'
} = {}) {
  const graphIds = new Set((roomSurfaceGraph?.surfaces || []).map((surface) => surface.id));
  const acceptedIds = reviewDecision?.accepted_surface_ids || [];
  const rejectedIds = reviewDecision?.rejected_surface_ids || [];
  const blockers = [];
  if (roomSurfaceGraph?.review_policy?.status !== 'needs_surface_review') blockers.push('reviewable_room_surface_graph_required');
  if (reviewDecision?.status !== 'accepted_for_derived_drafting') blockers.push('accepted_room_surface_review_required');
  if (!acceptedIds.length) blockers.push('accepted_visible_room_surface_required');
  for (const id of [...acceptedIds, ...rejectedIds]) {
    if (!graphIds.has(id)) blockers.push(`unknown_room_surface_id:${id}`);
  }
  if (acceptedIds.some((id) => rejectedIds.includes(id))) blockers.push('surface_cannot_be_both_accepted_and_rejected');
  for (const surface of roomSurfaceGraph?.surfaces || []) {
    if (!acceptedIds.includes(surface.id) && !rejectedIds.includes(surface.id)) blockers.push(`surface_review_decision_missing:${surface.id}`);
  }
  const accepted = blockers.length === 0;
  return {
    kind: 'room_surface_review_result_v1',
    version: 1,
    source_room_surface_graph: reviewDecision?.source_room_surface_graph || 'room-surface-graph.json',
    source_review_decision: sourceReviewDecision,
    status: accepted
      ? 'accepted_for_derived_drafting'
      : reviewDecision?.status === 'accepted_for_derived_drafting' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    accepted_surface_ids: accepted ? [...acceptedIds] : [],
    derived_drafting_allowed: accepted,
    promotion_allowed: false,
    compile_allowed: false,
    false_promotion_count: 0,
    blockers: accepted ? ['accepted_visible_coverage_review_required', 'accepted_local_detail_review_required'] : Array.from(new Set(blockers))
  };
}

export function buildRoomDraftViewGraph({ roomSurfaceGraph, roomSurfaceReviewResult } = {}) {
  const accepted = roomSurfaceReviewResult?.status === 'accepted_for_derived_drafting';
  const acceptedIds = new Set(roomSurfaceReviewResult?.accepted_surface_ids || []);
  const surfaces = (roomSurfaceGraph?.surfaces || []).filter((surface) => acceptedIds.has(surface.id));
  const sourceImage = roomSurfaceGraph?.coordinate_reference?.source_image || '';
  const regions = (selected) => selected.map((surface) => ({
    id: `draft_region_${surface.id}`,
    role: surface.role,
    source_image: sourceImage,
    source_evidence_id: surface.id,
    visible_quad_px: surface.visible_quad_px,
    confidence: surface.orientation_hint.confidence,
    review_required: true
  }));
  const end = surfaces.filter((surface) => surface.role === 'end_wall');
  const sides = surfaces.filter((surface) => ['left_wall', 'right_wall'].includes(surface.role));
  const floor = surfaces.filter((surface) => surface.role === 'floor');
  const slots = [
    makeSlot({ id: 'front', status: end.length ? 'partial' : 'unknown', surfaces: end, regions: regions(end), sourceImage, basis: 'accepted_end_wall_rectification' }),
    makeSlot({ id: 'left_or_right_side', status: sides.length ? 'partial' : 'unknown', surfaces: sides, regions: regions(sides), sourceImage, basis: 'accepted_side_wall_rectification' }),
    makeSlot({ id: 'top', status: floor.length ? 'inferred' : 'unknown', surfaces: floor, regions: regions(floor), sourceImage, basis: 'accepted_room_floor_plan_hypothesis' }),
    makeSlot({ id: 'oblique_context', status: surfaces.length ? 'observed' : 'unknown', surfaces, regions: regions(surfaces), sourceImage, basis: 'accepted_calibrated_source_view' })
  ];
  return {
    kind: 'draft_view_graph_v1',
    version: 1,
    profile_id: 'interior_room',
    coordinate_convention: 'image_x_right_y_down',
    source_structure_evidence_graph: 'structure-line-evidence.json',
    view_slots: slots,
    review_overlay: buildDraftViewReviewOverlay({ slots }),
    review_policy: {
      status: accepted && surfaces.length ? 'needs_draft_view_review' : 'blocked_no_observed_views',
      accepted_draft_view_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: accepted && surfaces.length ? ['accepted_draft_view_review_required'] : ['accepted_room_surface_review_required']
    },
    summary: {
      slot_count: 4,
      observed_slots: slots.filter((slot) => slot.status === 'observed').length,
      inferred_slots: slots.filter((slot) => slot.status === 'inferred').length,
      partial_slots: slots.filter((slot) => slot.status === 'partial').length,
      unknown_slots: slots.filter((slot) => slot.status === 'unknown').length,
      review_required_slots: 4,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildRoomObjectSurfaceProjection({ roomSurfaceGraph, draftViewGraph } = {}) {
  const slotForRole = (role) => role === 'end_wall'
    ? 'front'
    : ['left_wall', 'right_wall'].includes(role) ? 'left_or_right_side'
      : role === 'floor' ? 'top' : 'oblique_context';
  const surfaces = (roomSurfaceGraph?.surfaces || []).map((surface) => ({
    id: surface.id,
    role: surface.role,
    draft_view_slot_id: slotForRole(surface.role),
    status: surface.status,
    source_image_ids: [roomSurfaceGraph.coordinate_reference.source_image],
    source_evidence_ids: [surface.id],
    visible_regions: [{ id: `surface_region_${surface.id}`, visible_quad_px: surface.visible_quad_px }],
    unknown_regions: [],
    orientation_hint: surface.orientation_hint.orientation_axis,
    review_required: true,
    promotion_allowed: false,
    blockers: ['accepted_room_surface_review_required']
  }));
  return {
    kind: 'object_surface_graph_v1',
    version: 1,
    profile_id: 'interior_room',
    domain: 'interior_room_surface_projection',
    source_draft_view_graph: 'draft-view-graph.json',
    source_structure_evidence_graph: draftViewGraph?.source_structure_evidence_graph || 'structure-line-evidence.json',
    surfaces,
    surface_local_feature_candidates: roomSurfaceGraph?.surface_local_detail_candidates || [],
    review_policy: {
      status: surfaces.length ? 'needs_surface_review' : 'blocked_no_visible_surfaces',
      accepted_surface_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: ['accepted_room_surface_review_required', 'accepted_local_detail_review_required']
    },
    summary: {
      surface_count: surfaces.length,
      feature_candidate_count: roomSurfaceGraph?.surface_local_detail_candidates?.length || 0,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildPendingRoomLocalDetailReview({ roomSurfaceGraph } = {}) {
  return {
    kind: 'local_detail_review_decision_v1',
    version: 1,
    source_object_surface_graph: 'object-surface-graph.json',
    source_facade_plane_graph: null,
    source_room_surface_graph: 'room-surface-graph.json',
    reviewer: 'room-local-detail-review-template',
    status: 'not_accepted',
    promotion_allowed: false,
    compile_allowed: false,
    accepted_surface_ids: [],
    accepted_detail_ids: [],
    detail_bindings: (roomSurfaceGraph?.surface_local_detail_candidates || []).map((detail) => ({
      detail_id: detail.id,
      target_surface_id: null,
      target_plane_id: null,
      status: 'not_accepted'
    })),
    review_scope: { coverage_status: 'partial' },
    blockers: ['accepted_local_detail_review_required'],
    notes: ['No room-local detail candidate is accepted by default.']
  };
}

export function promoteReviewedRoomLocalDetails({ roomSurfaceGraph, roomSurfaceReviewResult, reviewDecision } = {}) {
  const surfaceById = new Map((roomSurfaceGraph?.surfaces || []).map((surface) => [surface.id, surface]));
  const detailById = new Map((roomSurfaceGraph?.surface_local_detail_candidates || []).map((detail) => [detail.id, detail]));
  const acceptedSurfaceIds = new Set(roomSurfaceReviewResult?.accepted_surface_ids || []);
  const blockers = [];
  const promoted = [];
  if (roomSurfaceReviewResult?.status !== 'accepted_for_derived_drafting') blockers.push('accepted_room_surface_review_required');
  if (reviewDecision?.status !== 'accepted') blockers.push('accepted_local_detail_review_required');
  if (reviewDecision?.promotion_allowed !== false || reviewDecision?.compile_allowed !== false) {
    blockers.push('review_decision_cannot_directly_promote_or_compile');
  }
  if (reviewDecision?.review_scope?.coverage_status !== 'accepted_visible_detail_coverage') {
    blockers.push('accepted_visible_detail_coverage_review_required');
  }
  if (!sameSet(reviewDecision?.accepted_surface_ids || [], [...acceptedSurfaceIds])) {
    blockers.push('local_detail_review_surface_lineage_mismatch');
  }
  if (reviewDecision?.review_scope?.coverage_status === 'accepted_visible_detail_coverage'
    && !sameSet(reviewDecision?.accepted_detail_ids || [], [...detailById.keys()])) {
    blockers.push('accepted_visible_detail_coverage_lineage_mismatch');
  }
  const bindingByDetail = new Map((reviewDecision?.detail_bindings || []).map((binding) => [binding.detail_id, binding]));
  for (const detailId of reviewDecision?.accepted_detail_ids || []) {
    const detail = detailById.get(detailId);
    const binding = bindingByDetail.get(detailId);
    if (!detail) {
      blockers.push(`unknown_local_detail_id:${detailId}`);
      continue;
    }
    if (binding?.status !== 'accepted' || !binding.target_surface_id) {
      blockers.push(`accepted_surface_binding_required:${detailId}`);
      continue;
    }
    if (!acceptedSurfaceIds.has(binding.target_surface_id)) blockers.push(`detail_bound_to_unaccepted_surface:${detailId}`);
    if (!detail.candidate_surface_ids.includes(binding.target_surface_id)) blockers.push(`detail_surface_binding_not_supported:${detailId}`);
    const surface = surfaceById.get(binding.target_surface_id);
    if (!surface) continue;
    const quadUv = detail.visible_quad_px.map((point) => applyHomography(surface.rectification.image_to_local_homography, point));
    const reprojected = quadUv.map((point) => applyHomography(surface.rectification.local_to_image_homography, point));
    const residuals = detail.visible_quad_px.map((point, index) => distance(point, reprojected[index]));
    const maxResidual = Math.max(...residuals);
    if (!quadUv.every(([u, v]) => u >= -0.02 && u <= 1.02 && v >= -0.02 && v <= 1.02)) blockers.push(`detail_outside_target_surface:${detailId}`);
    if (maxResidual > 1) blockers.push(`detail_reprojection_residual_too_high:${detailId}`);
    promoted.push({
      id: detail.id,
      role: detail.role,
      target_surface_id: binding.target_surface_id,
      geometry_type: detail.geometry_type,
      source_quad_px: detail.visible_quad_px,
      quad_uv: quadUv.map((point) => point.map((value) => round(value, 6))),
      reprojection: {
        status: maxResidual <= 1 ? 'pass' : 'fail',
        max_residual_px: round(maxResidual, 6),
        reprojected_quad_px: reprojected.map((point) => point.map((value) => round(value, 3)))
      },
      source_proposal_id: detail.id
    });
  }
  const accepted = blockers.length === 0;
  return {
    kind: 'surface_local_detail_promotion_v1',
    version: 1,
    status: accepted ? 'accepted_for_mock_study' : reviewDecision?.status === 'accepted' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    source_room_surface_graph: 'room-surface-graph.json',
    source_review_decision: 'local-detail-review.json',
    accepted_surface_ids: accepted ? [...acceptedSurfaceIds] : [],
    accepted_detail_ids: accepted ? promoted.map((detail) => detail.id) : [],
    accepted_details: accepted ? promoted : [],
    reprojection_qa: {
      status: accepted && promoted.every((detail) => detail.reprojection.status === 'pass') ? 'pass' : 'blocked',
      max_residual_px: accepted && promoted.length ? Math.max(...promoted.map((detail) => detail.reprojection.max_residual_px)) : null
    },
    partgraph_promotion_allowed: accepted,
    direct_compile_allowed: false,
    release_allowed: false,
    false_promotion_count: 0,
    blockers: accepted ? ['accepted_metric_scale_anchor_required', 'accepted_hidden_geometry_review_required'] : Array.from(new Set(blockers))
  };
}

export function renderRoomReviewOverlaySvg({ roomSurfaceGraph, excludedRegions = [], sourceImageBuffer } = {}) {
  const width = roomSurfaceGraph.coordinate_reference.width;
  const height = roomSurfaceGraph.coordinate_reference.height;
  const colors = ['#2563eb', '#f97316', '#16a34a', '#7c3aed', '#db2777'];
  const imageHref = `data:image/jpeg;base64,${sourceImageBuffer.toString('base64')}`;
  const surfaces = roomSurfaceGraph.surfaces.map((surface, index) => {
    const label = polygonCentroid(surface.visible_polygon_px);
    return `<polygon data-layer="room-surface" data-id="${escapeXml(surface.id)}" points="${surface.visible_polygon_px.map((point) => point.join(',')).join(' ')}" fill="${colors[index % colors.length]}" fill-opacity="0.16" stroke="${colors[index % colors.length]}" stroke-width="3"/><text x="${label[0]}" y="${label[1]}" font-family="ui-monospace,monospace" font-size="18" text-anchor="middle" fill="#111827">${escapeXml(surface.role)}</text>`;
  }).join('\n');
  const details = roomSurfaceGraph.surface_local_detail_candidates.map((detail) => `<polygon data-layer="surface-local-detail" data-id="${escapeXml(detail.id)}" points="${detail.visible_quad_px.map((point) => point.join(',')).join(' ')}" fill="#facc15" fill-opacity="0.24" stroke="#854d0e" stroke-width="3"/>`).join('\n');
  const exclusions = excludedRegions.map((region) => `<polygon data-layer="permanent-exclusion" data-id="${escapeXml(region.id)}" points="${region.polygon_px.map((point) => point.join(',')).join(' ')}" fill="#dc2626" fill-opacity="0.24" stroke="#991b1b" stroke-width="4" stroke-dasharray="12 8"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${imageHref}" width="${width}" height="${height}"/><g data-layer="room-surfaces">${surfaces}</g><g data-layer="surface-local-details">${details}</g><g data-layer="excluded-regions">${exclusions}</g></svg>`;
}

function blockedRoomSurfaceGraph({ reference, sourceCalibrationReviewResult, status, blocker }) {
  return {
    kind: 'room_surface_graph_v1', version: 1, profile_id: 'interior_room',
    coordinate_convention: 'image_x_right_y_down_room_local_axes_reviewed',
    coordinate_reference: { source_image: reference.source_image, width: reference.width, height: reference.height },
    source_calibration_review_result: sourceCalibrationReviewResult,
    surfaces: [], surface_local_detail_candidates: [],
    review_policy: { status, accepted_surface_review_required: true, review_required: true, promotion_allowed: false, compile_allowed: false, blockers: [blocker] },
    summary: { surface_count: 0, detail_candidate_count: 0, visible_surface_ids: [], review_required: true, promotion_allowed: false, compile_allowed: false }
  };
}

function makeSlot({ id, status, surfaces, regions, sourceImage, basis }) {
  return {
    slot_id: id,
    status,
    projection_basis: { kind: basis, metric_scale_status: 'unknown_single_view' },
    source_image_ids: surfaces.length ? [sourceImage] : [],
    source_evidence_ids: surfaces.map((surface) => surface.id),
    visible_regions: regions,
    unknown_regions: status === 'unknown' ? [{ id: `${id}_unknown`, reason: 'surface_not_observed_or_reviewed' }] : [],
    confidence: surfaces.length ? Math.min(...surfaces.map((surface) => surface.orientation_hint.confidence)) : 0,
    review_required: true,
    promotion_allowed: false
  };
}

function buildRectification(quad) {
  const imageToLocal = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const localToImage = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  return {
    kind: 'surface_local_unit_rectification_v1',
    image_to_local_homography: imageToLocal,
    local_to_image_homography: localToImage,
    local_quad: [[0, 0], [1, 0], [1, 1], [0, 1]],
    metric_scale_status: 'unknown_single_view'
  };
}

function homography(source, destination) {
  const matrix = [];
  const rhs = [];
  for (let index = 0; index < 4; index += 1) {
    const [x, y] = source[index];
    const [u, v] = destination[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); rhs.push(v);
  }
  const solution = solveLinearSystem(matrix, rhs);
  return [
    [round(solution[0], 9), round(solution[1], 9), round(solution[2], 9)],
    [round(solution[3], 9), round(solution[4], 9), round(solution[5], 9)],
    [round(solution[6], 9), round(solution[7], 9), 1]
  ];
}

function solveLinearSystem(matrix, rhs) {
  const count = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let pivot = 0; pivot < count; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < count; row += 1) if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    if (Math.abs(divisor) < 1e-12) throw new Error('degenerate_room_surface_quad');
    for (let column = pivot; column <= count; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < count; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= count; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }
  return augmented.map((row) => row[count]);
}

function applyHomography(matrix, [x, y]) {
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  return [
    (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
  ];
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function polygonCentroid(points) {
  return [
    round(points.reduce((sum, point) => sum + point[0], 0) / points.length),
    round(points.reduce((sum, point) => sum + point[1], 0) / points.length)
  ];
}

function sameSet(left = [], right = []) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
