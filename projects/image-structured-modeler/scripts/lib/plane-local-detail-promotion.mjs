export const PLANE_LOCAL_DETAIL_PROMOTION_KIND = 'plane_local_detail_promotion_v1';

const GEOMETRY_TYPES = new Set(['recess_opening', 'equipment_box', 'linear_path_box']);

export function promoteReviewedPlaneLocalDetails({
  graph,
  reviewDecision,
  sourcePlaneLocalEvidenceGraph = 'plane-local-evidence-graph.json',
  sourceReviewDecision = 'plane-local-evidence-review.json',
  maxRoundTripResidualPx = 1
} = {}) {
  const blockers = [];
  if (graph?.kind !== 'plane_local_evidence_graph_v1') blockers.push('plane_local_evidence_graph_v1_required');
  if (reviewDecision?.kind !== 'plane_local_evidence_review_decision_v1') blockers.push('plane_local_evidence_review_decision_v1_required');
  if (reviewDecision?.status !== 'accepted') blockers.push('accepted_plane_local_evidence_review_required');
  if (reviewDecision?.promotion_allowed !== false || reviewDecision?.compile_allowed !== false) {
    blockers.push('review_decision_must_not_directly_authorize_promotion_or_compile');
  }

  const planeById = new Map((graph?.planes || []).map((plane) => [plane.source_plane_id, plane]));
  const proposalById = new Map((graph?.planes || []).flatMap((plane) => (
    (plane.detail_instance_proposals || []).map((proposal) => [proposal.id, proposal])
  )));
  const acceptedPlaneIds = new Set((reviewDecision?.plane_decisions || [])
    .filter((decision) => decision.status === 'accepted')
    .map((decision) => decision.id));
  const acceptedDecisions = (reviewDecision?.region_decisions || []).filter((decision) => decision.status === 'accepted');
  if (!acceptedDecisions.length) blockers.push('accepted_plane_local_detail_ids_required');
  const geometryAuthoringMode = reviewDecision?.geometry_authoring?.mode || 'proposal_geometry';
  if (geometryAuthoringMode === 'manual_rectified_annotation' && !reviewDecision?.geometry_authoring?.correction_note) {
    blockers.push('manual_rectified_annotation_correction_note_required');
  }

  const seenDecisionIds = new Set();
  const checks = [];
  const validatedDetails = [];
  for (const decision of acceptedDecisions) {
    const decisionBlockers = [];
    if (seenDecisionIds.has(decision.id)) decisionBlockers.push('duplicate_accepted_detail_id');
    seenDecisionIds.add(decision.id);
    const proposal = proposalById.get(decision.id);
    if (!proposal) decisionBlockers.push('accepted_detail_id_not_found_in_evidence_graph');
    const plane = planeById.get(decision.target_plane_id);
    if (!plane) decisionBlockers.push('accepted_target_plane_id_not_found');
    if (!acceptedPlaneIds.has(decision.target_plane_id)) decisionBlockers.push('accepted_target_plane_review_required');
    if (!decision.role) decisionBlockers.push('accepted_detail_role_required');
    if (!GEOMETRY_TYPES.has(decision.geometry_type)) decisionBlockers.push('accepted_geometry_type_required');
    if (!validUnitQuad(decision.quad_uv)) decisionBlockers.push('accepted_quad_uv_must_be_non_degenerate_and_inside_plane');
    const reviewedProposalIou = proposal && validUnitQuad(decision.quad_uv) ? quadIou(decision.quad_uv, proposal.quad_uv) : 0;
    if (geometryAuthoringMode === 'proposal_geometry' && reviewedProposalIou < 0.5) {
      decisionBlockers.push('accepted_proposal_geometry_must_overlap_source_proposal');
    }
    if (proposal && decision.target_plane_id !== proposal.source_plane_id && decision.status !== 'reassigned') {
      decisionBlockers.push('target_plane_reassignment_requires_reassigned_review_status');
    }
    if (proposal && Array.isArray(decision.source_region_ids) && decision.source_region_ids.length) {
      if (!decision.source_region_ids.includes(proposal.source_region_candidate_id)) {
        decisionBlockers.push('source_region_lineage_mismatch');
      }
    }

    let sourceQuad = [];
    let residualPx = Number.POSITIVE_INFINITY;
    let withinSourceBounds = false;
    if (plane && validUnitQuad(decision.quad_uv)) {
      sourceQuad = decision.quad_uv.map((point) => applyHomography(plane.rectification.local_to_image_homography, point));
      const roundTripUv = sourceQuad.map((point) => applyHomography(plane.rectification.image_to_local_homography, point));
      residualPx = Math.max(...roundTripUv.map((point, index) => localResidualPx(
        point,
        decision.quad_uv[index],
        plane.rectification.width,
        plane.rectification.height
      )));
      const raster = plane.rectification.source_raster_size;
      withinSourceBounds = sourceQuad.every(([x, y]) => (
        x >= -0.5 && y >= -0.5 && x <= raster.width - 0.5 && y <= raster.height - 0.5
      ));
      if (residualPx > maxRoundTripResidualPx) decisionBlockers.push('source_reprojection_round_trip_residual_exceeded');
      if (!withinSourceBounds) decisionBlockers.push('source_reprojection_outside_source_raster');
    }

    checks.push({
      id: decision.id,
      target_plane_id: decision.target_plane_id || null,
      status: decisionBlockers.length ? 'fail' : 'pass',
      max_round_trip_residual_px: Number.isFinite(residualPx) ? round(residualPx, 6) : 0,
      within_source_bounds: withinSourceBounds,
      geometry_authoring_mode: geometryAuthoringMode,
      reviewed_proposal_iou: round(reviewedProposalIou, 4),
      blockers: decisionBlockers
    });
    blockers.push(...decisionBlockers.map((blocker) => `${decision.id}:${blocker}`));
    if (!decisionBlockers.length) {
      validatedDetails.push({
        id: `accepted_detail:${safeId(decision.id)}`,
        source_proposal_id: decision.id,
        source_region_candidate_id: proposal.source_region_candidate_id,
        target_plane_id: decision.target_plane_id,
        role: decision.role,
        geometry_type: decision.geometry_type,
        geometry_source: geometryAuthoringMode,
        quad_uv: decision.quad_uv.map((point) => point.map((value) => round(value, 6))),
        source_quad_px: sourceQuad.map((point) => point.map((value) => round(value, 3))),
        source_edge_ids: proposal.source_edge_ids || [],
        review_status: 'accepted',
        reprojection: {
          status: 'pass',
          max_round_trip_residual_px: round(residualPx, 6),
          within_source_bounds: true
        }
      });
    }
  }

  const uniqueBlockers = [...new Set(blockers)];
  const ready = uniqueBlockers.length === 0 && validatedDetails.length > 0;
  const sourceBoundsViolations = checks.filter((check) => check.within_source_bounds === false).length;
  const maxResidual = checks.length ? Math.max(...checks.map((check) => check.max_round_trip_residual_px)) : 0;
  return {
    kind: PLANE_LOCAL_DETAIL_PROMOTION_KIND,
    version: 1,
    source_plane_local_evidence_graph: sourcePlaneLocalEvidenceGraph,
    source_review_decision: sourceReviewDecision,
    status: ready
      ? 'ready_for_partgraph_promotion'
      : reviewDecision?.status === 'accepted'
        ? 'blocked_invalid_review'
        : 'blocked_no_accepted_review',
    accepted_detail_ids: ready ? validatedDetails.map((detail) => detail.id) : [],
    accepted_details: ready ? validatedDetails : [],
    reprojection_qa: {
      status: checks.length ? (ready ? 'pass' : 'fail') : 'not_run',
      checked_detail_count: checks.length,
      max_round_trip_residual_px: round(maxResidual, 6),
      source_bounds_violations: sourceBoundsViolations,
      checks
    },
    partgraph_promotion_allowed: ready,
    direct_compile_allowed: false,
    false_promotion_count: 0,
    blockers: uniqueBlockers,
    notes: [
      'This artifact can authorize a domain PartGraph adapter only after accepted review and reprojection QA.',
      'It is not SketchUp DSL and cannot compile directly.'
    ]
  };
}

export function renderPlaneLocalDetailReprojectionOverlaySvg({ promotion, sourceImageBuffer, width, height } = {}) {
  const imageHref = `data:image/png;base64,${sourceImageBuffer.toString('base64')}`;
  const shapes = (promotion?.accepted_details || []).map((detail, index) => {
    const color = detail.geometry_type === 'recess_opening'
      ? '#2563eb'
      : detail.geometry_type === 'equipment_box'
        ? '#db2777'
        : '#ea580c';
    const points = detail.source_quad_px.map((point) => point.join(',')).join(' ');
    const [labelX, labelY] = detail.source_quad_px[0];
    const badgeX = round(Math.max(12, Math.min(width - 12, labelX + 7)));
    const badgeY = round(Math.max(68, Math.min(height - 12, labelY + 7)));
    return `<g data-detail-id="${escapeHtml(detail.id)}" data-role="${escapeHtml(detail.role)}" data-geometry-type="${detail.geometry_type}"><polygon points="${points}" fill="${color}" fill-opacity="0.12" stroke="#ffffff" stroke-width="5"/><polygon points="${points}" fill="none" stroke="${color}" stroke-width="3"/><circle cx="${badgeX}" cy="${badgeY}" r="9" fill="${color}" stroke="#ffffff" stroke-width="2"/><text x="${badgeX}" y="${round(badgeY + 4)}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="10" fill="#ffffff">${index + 1}</text></g>`;
  }).join('\n');
  const counts = Object.fromEntries(['recess_opening', 'equipment_box', 'linear_path_box'].map((geometryType) => [
    geometryType,
    (promotion?.accepted_details || []).filter((detail) => detail.geometry_type === geometryType).length
  ]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageHref}" width="${width}" height="${height}"/>
  <g data-layer="accepted-plane-local-detail-reprojection">${shapes}</g>
  <rect x="8" y="8" width="520" height="48" fill="#ffffff" fill-opacity="0.92" stroke="#64748b"/>
  <text x="20" y="29" font-family="ui-monospace,monospace" font-size="15" fill="#111827">accepted plane-local detail reprojection</text>
  <text x="20" y="47" font-family="ui-monospace,monospace" font-size="12" fill="#991b1b">openings=${counts.recess_opening} / equipment=${counts.equipment_box} / paths=${counts.linear_path_box} / release=false</text>
</svg>`;
}

function validUnitQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 4) return false;
  if (!quad.every((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) return false;
  if (!quad.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1)) return false;
  return polygonArea(quad) > 1e-5;
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

function quadIou(first, second) {
  const a = quadBounds(first);
  const b = quadBounds(second);
  const width = Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0));
  const height = Math.max(0, Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0));
  const intersection = width * height;
  const areaA = (a.u1 - a.u0) * (a.v1 - a.v0);
  const areaB = (b.u1 - b.u0) * (b.v1 - b.v0);
  return intersection / Math.max(1e-9, areaA + areaB - intersection);
}

function quadBounds(quad) {
  const us = quad.map((point) => point[0]);
  const vs = quad.map((point) => point[1]);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

function localResidualPx(actual, expected, width, height) {
  return Math.hypot((actual[0] - expected[0]) * width, (actual[1] - expected[1]) * height);
}

function applyHomography(matrix, [x, y]) {
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (Math.abs(denominator) < 1e-12) return [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return [
    (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
  ];
}

function safeId(value) {
  return String(value || 'detail').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
