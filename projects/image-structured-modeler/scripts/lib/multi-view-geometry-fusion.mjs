export function buildPendingRelativePoseReview() {
  return {
    kind: 'multi_view_relative_pose_review_decision_v1', version: 1,
    source_multi_view_calibration_graph: 'multi-view-calibration-graph.json',
    source_evidence_fusion_review_result: 'multi-view-calibration-review-result.json',
    reviewer: 'relative-pose-review-template', status: 'not_accepted', reference_view_id: null, pose_edges: [],
    promotion_allowed: false, compile_allowed: false,
    notes: ['Evidence identity does not imply a relative camera pose.']
  };
}

export function evaluateRelativePoseReview({ graph, evidenceReviewResult, reviewDecision } = {}) {
  const viewIds = new Set((graph?.view_nodes || []).map((view) => view.id));
  const acceptedCorrespondenceIds = new Set(evidenceReviewResult?.accepted_correspondence_ids || []);
  const correspondenceById = new Map((graph?.correspondence_candidates || []).map((candidate) => [candidate.id, candidate]));
  const blockers = [];
  const acceptedEdges = [];
  if (evidenceReviewResult?.status !== 'accepted_for_evidence_fusion') blockers.push('accepted_multi_view_evidence_fusion_review_required');
  if (reviewDecision?.status !== 'accepted_for_geometry_fusion') blockers.push('accepted_relative_pose_review_required');
  if (!viewIds.has(reviewDecision?.reference_view_id)) blockers.push('known_reference_view_required');
  if (hasDuplicates((reviewDecision?.pose_edges || []).map((edge) => edge.id))) blockers.push('relative_pose_edge_ids_must_be_unique');
  for (const edge of reviewDecision?.pose_edges || []) {
    if (!viewIds.has(edge.source_view_id) || !viewIds.has(edge.target_view_id)) blockers.push(`pose_edge_unknown_view:${edge.id}`);
    if (edge.source_view_id === edge.target_view_id) blockers.push(`pose_edge_requires_distinct_views:${edge.id}`);
    if (!['homography_2d', 'rigid_transform_3d'].includes(edge.model)) blockers.push(`unsupported_pose_model:${edge.id}`);
    const correspondenceIds = edge.accepted_correspondence_ids || [];
    const minimumCorrespondenceCount = edge.model === 'homography_2d' ? 4 : 3;
    if (new Set(correspondenceIds).size < minimumCorrespondenceCount) blockers.push(`pose_edge_correspondence_count_insufficient:${edge.id}`);
    if (hasDuplicates(correspondenceIds)) blockers.push(`pose_edge_correspondence_ids_must_be_unique:${edge.id}`);
    const edgeCorrespondences = [];
    for (const id of correspondenceIds) {
      const correspondence = correspondenceById.get(id);
      if (!acceptedCorrespondenceIds.has(id) || !correspondence) blockers.push(`pose_edge_unaccepted_correspondence:${edge.id}:${id}`);
      else if (!sameViewPair(correspondence, edge)) blockers.push(`pose_edge_correspondence_view_pair_mismatch:${edge.id}:${id}`);
      else if (correspondence.kind !== 'point') blockers.push(`pose_edge_point_correspondence_required:${edge.id}:${id}`);
      else {
        const oriented = orientCorrespondence(correspondence, edge);
        if (edge.model === 'homography_2d' && (!validPoint(oriented.source_point_px) || !validPoint(oriented.target_point_px))) {
          blockers.push(`pose_edge_point_coordinates_required:${edge.id}:${id}`);
        } else if (edge.model === 'rigid_transform_3d' && (!validPoint3d(oriented.source_point_model) || !validPoint3d(oriented.target_point_model))) {
          blockers.push(`pose_edge_model_coordinates_required:${edge.id}:${id}`);
        } else {
          edgeCorrespondences.push(oriented);
        }
      }
    }
    const matrixSize = edge.model === 'homography_2d' ? 3 : 4;
    if (!validSquareMatrix(edge.transform_matrix, matrixSize)) blockers.push(`pose_edge_transform_matrix_invalid:${edge.id}`);
    else if (Math.abs(matrixDeterminant(edge.transform_matrix)) < 1e-8) blockers.push(`pose_edge_transform_matrix_degenerate:${edge.id}`);
    let measuredResidual = null;
    if (validSquareMatrix(edge.transform_matrix, matrixSize) && edgeCorrespondences.length >= minimumCorrespondenceCount) {
      if (edge.model === 'homography_2d') {
        measuredResidual = maxHomographyResidual(edge.transform_matrix, edgeCorrespondences);
        if (!(edge.max_reprojection_residual_px >= 0 && edge.max_reprojection_residual_px <= 3)) blockers.push(`pose_edge_reprojection_residual_too_high:${edge.id}`);
        if (!(measuredResidual >= 0 && measuredResidual <= 3)) blockers.push(`pose_edge_measured_reprojection_residual_too_high:${edge.id}`);
      } else {
        if (!hasNonCollinearModelPoints(edgeCorrespondences)) blockers.push(`pose_edge_non_collinear_model_points_required:${edge.id}`);
        if (!isRigidTransform(edge.transform_matrix)) blockers.push(`pose_edge_transform_must_be_rigid:${edge.id}`);
        measuredResidual = maxRigidTransformResidual(edge.transform_matrix, edgeCorrespondences);
        if (!(edge.max_alignment_residual_model_units >= 0 && edge.max_alignment_residual_model_units <= 0.02)) blockers.push(`pose_edge_alignment_residual_too_high:${edge.id}`);
        if (!(measuredResidual >= 0 && measuredResidual <= 0.02)) blockers.push(`pose_edge_measured_alignment_residual_too_high:${edge.id}`);
      }
    }
    if (!(edge.confidence >= 0.7)) blockers.push(`pose_edge_confidence_too_low:${edge.id}`);
    acceptedEdges.push({
      ...structuredClone(edge),
      geometry_scope: edge.model === 'rigid_transform_3d' ? 'object_frame' : 'single_plane',
      ...(edge.model === 'homography_2d'
        ? { measured_max_reprojection_residual_px: measuredResidual }
        : { measured_max_alignment_residual_model_units: measuredResidual })
    });
  }
  if (!acceptedEdges.length) blockers.push('accepted_relative_pose_edge_required');
  if (reviewDecision?.reference_view_id && !allViewsConnected(viewIds, acceptedEdges, reviewDecision.reference_view_id)) blockers.push('relative_pose_graph_must_connect_all_views');
  const accepted = blockers.length === 0;
  return {
    kind: 'multi_view_relative_pose_review_result_v1', version: 1,
    status: accepted ? 'accepted_for_geometry_fusion' : reviewDecision?.status === 'accepted_for_geometry_fusion' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    reference_view_id: accepted ? reviewDecision.reference_view_id : null,
    accepted_pose_edges: accepted ? acceptedEdges : [],
    geometry_fusion_allowed: accepted,
    geometry_scope: accepted && acceptedEdges.every((edge) => edge.geometry_scope === 'object_frame') ? 'object_frame' : accepted ? 'single_plane' : 'unresolved',
    metric_scale_status: accepted ? 'relative_pose_only' : 'unresolved',
    promotion_allowed: false, compile_allowed: false, false_promotion_count: 0,
    blockers: accepted ? ['accepted_metric_scale_review_required', 'accepted_multi_view_conflict_review_required', 'accepted_hidden_geometry_review_required'] : Array.from(new Set(blockers))
  };
}

export function buildPendingMetricScaleReview() {
  return {
    kind: 'metric_scale_review_decision_v1', version: 1,
    source_relative_pose_review_result: 'multi-view-relative-pose-review-result.json',
    reviewer: 'metric-scale-review-template', status: 'not_accepted', anchors: [],
    units_per_model_unit: null, promotion_allowed: false, compile_allowed: false,
    notes: ['Relative pose does not establish metric scale.']
  };
}

export function evaluateMetricScaleReview({ relativePoseReviewResult, evidenceReviewResult, reviewDecision } = {}) {
  const acceptedEvidenceIds = new Set(evidenceReviewResult?.accepted_correspondence_ids || []);
  const blockers = [];
  if (relativePoseReviewResult?.status !== 'accepted_for_geometry_fusion') blockers.push('accepted_relative_pose_review_required');
  if (reviewDecision?.status !== 'accepted_metric_scale') blockers.push('accepted_metric_scale_review_required');
  if (!(reviewDecision?.units_per_model_unit > 0)) blockers.push('positive_metric_units_per_model_unit_required');
  const anchors = reviewDecision?.anchors || [];
  if (!anchors.length) blockers.push('accepted_metric_scale_anchor_required');
  if (hasDuplicates(anchors.map((anchor) => anchor.id))) blockers.push('metric_scale_anchor_ids_must_be_unique');
  for (const anchor of anchors) {
    if (anchor.kind !== 'known_distance') blockers.push(`unsupported_metric_anchor_kind:${anchor.id}`);
    if (!(anchor.value > 0) || anchor.units !== 'mm') blockers.push(`positive_metric_anchor_mm_required:${anchor.id}`);
    if (!(anchor.model_distance > 0)) blockers.push(`positive_metric_anchor_model_distance_required:${anchor.id}`);
    if (!(anchor.confidence >= 0.7)) blockers.push(`metric_anchor_confidence_too_low:${anchor.id}`);
    if (!(anchor.source_evidence_ids || []).length) blockers.push(`metric_anchor_source_evidence_required:${anchor.id}`);
    for (const id of anchor.source_evidence_ids || []) if (!acceptedEvidenceIds.has(id)) blockers.push(`metric_anchor_unaccepted_source_evidence:${anchor.id}:${id}`);
    if (anchor.value > 0 && anchor.model_distance > 0 && reviewDecision?.units_per_model_unit > 0) {
      const derivedUnitsPerModelUnit = anchor.value / anchor.model_distance;
      if (Math.abs(derivedUnitsPerModelUnit - reviewDecision.units_per_model_unit) > Math.max(1e-6, derivedUnitsPerModelUnit * 1e-6)) {
        blockers.push(`metric_anchor_scale_inconsistent:${anchor.id}`);
      }
    }
  }
  const accepted = blockers.length === 0;
  return {
    kind: 'metric_scale_review_result_v1', version: 1,
    status: accepted ? 'accepted_metric_scale' : reviewDecision?.status === 'accepted_metric_scale' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    accepted_anchor_ids: accepted ? anchors.map((anchor) => anchor.id) : [],
    units: accepted ? 'mm' : null,
    units_per_model_unit: accepted ? reviewDecision.units_per_model_unit : null,
    metric_scale_allowed: accepted,
    source_relative_pose_edge_ids: (relativePoseReviewResult?.accepted_pose_edges || []).map((edge) => edge.id),
    source_geometry_scope: relativePoseReviewResult?.geometry_scope || 'unresolved',
    promotion_allowed: false, compile_allowed: false, false_promotion_count: 0,
    blockers: accepted ? ['accepted_multi_view_conflict_review_required', 'accepted_hidden_geometry_review_required'] : Array.from(new Set(blockers))
  };
}

export function buildMultiViewConflictGraph({ conflicts = [] } = {}) {
  return {
    kind: 'multi_view_conflict_graph_v1', version: 1,
    conflicts: conflicts.map((conflict) => ({ ...structuredClone(conflict), review_required: true, promotion_allowed: false })),
    review_policy: {
      status: conflicts.length ? 'needs_conflict_review' : 'no_conflicts_detected_review_still_required',
      accepted_conflict_review_required: true,
      geometry_fusion_allowed: false, promotion_allowed: false, compile_allowed: false,
      blockers: ['accepted_multi_view_conflict_review_required']
    },
    summary: { conflict_count: conflicts.length, blocking_conflict_count: conflicts.filter((conflict) => conflict.severity === 'blocking').length, promotion_allowed: false }
  };
}

export function buildPendingMultiViewConflictReview() {
  return {
    kind: 'multi_view_conflict_review_decision_v1', version: 1,
    source_multi_view_conflict_graph: 'multi-view-conflict-graph.json',
    reviewer: 'multi-view-conflict-review-template', status: 'not_accepted', resolutions: [],
    promotion_allowed: false, compile_allowed: false,
    notes: ['Every blocking geometry conflict must be explicitly resolved.']
  };
}

export function evaluateMultiViewConflictReview({ conflictGraph, evidenceReviewResult, relativePoseReviewResult, reviewDecision } = {}) {
  const conflictById = new Map((conflictGraph?.conflicts || []).map((conflict) => [conflict.id, conflict]));
  const acceptedEvidenceIds = new Set(evidenceReviewResult?.accepted_correspondence_ids || []);
  const poseEvidenceIds = new Set((relativePoseReviewResult?.accepted_pose_edges || []).flatMap((edge) => edge.accepted_correspondence_ids || []));
  const blockers = [];
  const resolutions = [];
  if (relativePoseReviewResult?.status !== 'accepted_for_geometry_fusion') blockers.push('accepted_relative_pose_review_required');
  if (reviewDecision?.status !== 'accepted_conflict_resolution') blockers.push('accepted_multi_view_conflict_review_required');
  if (hasDuplicates((reviewDecision?.resolutions || []).map((resolution) => resolution.conflict_id))) blockers.push('conflicts_must_be_resolved_once');
  for (const resolution of reviewDecision?.resolutions || []) {
    const conflict = conflictById.get(resolution.conflict_id);
    if (!conflict) {
      blockers.push(`unknown_multi_view_conflict_id:${resolution.conflict_id}`);
      continue;
    }
    if (!['reject_outlier', 'split_identity', 'accept_reviewed_source'].includes(resolution.decision)) blockers.push(`unsupported_conflict_resolution:${resolution.conflict_id}`);
    if (!String(resolution.reason || '').trim()) blockers.push(`conflict_resolution_reason_required:${resolution.conflict_id}`);
    const retained = resolution.retained_evidence_ids || [];
    const rejected = resolution.rejected_evidence_ids || [];
    const involved = new Set(conflict.involved_evidence_ids || []);
    if (retained.some((id) => rejected.includes(id))) blockers.push(`conflict_resolution_sets_overlap:${resolution.conflict_id}`);
    if (!retained.length && !rejected.length) blockers.push(`conflict_resolution_disposition_required:${resolution.conflict_id}`);
    if (resolution.decision === 'reject_outlier' && !rejected.length) blockers.push(`rejected_outlier_evidence_required:${resolution.conflict_id}`);
    for (const id of [...retained, ...rejected]) {
      if (!acceptedEvidenceIds.has(id)) blockers.push(`conflict_resolution_unaccepted_evidence:${resolution.conflict_id}:${id}`);
      if (!involved.has(id)) blockers.push(`conflict_resolution_evidence_not_in_conflict:${resolution.conflict_id}:${id}`);
    }
    for (const id of involved) if (![...retained, ...rejected].includes(id)) blockers.push(`conflict_evidence_disposition_missing:${resolution.conflict_id}:${id}`);
    for (const id of rejected) if (poseEvidenceIds.has(id)) blockers.push(`pose_uses_rejected_conflict_evidence:${resolution.conflict_id}:${id}`);
    resolutions.push(structuredClone(resolution));
  }
  for (const conflict of conflictGraph?.conflicts || []) {
    if (conflict.severity === 'blocking' && !resolutions.some((resolution) => resolution.conflict_id === conflict.id)) blockers.push(`blocking_conflict_unresolved:${conflict.id}`);
  }
  const accepted = blockers.length === 0;
  return {
    kind: 'multi_view_conflict_review_result_v1', version: 1,
    status: accepted ? 'accepted_conflict_resolution' : reviewDecision?.status === 'accepted_conflict_resolution' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    accepted_resolutions: accepted ? resolutions : [],
    geometry_conflicts_resolved: accepted,
    source_relative_pose_edge_ids: (relativePoseReviewResult?.accepted_pose_edges || []).map((edge) => edge.id),
    source_geometry_scope: relativePoseReviewResult?.geometry_scope || 'unresolved',
    promotion_allowed: false, compile_allowed: false, false_promotion_count: 0,
    blockers: accepted ? ['accepted_hidden_geometry_review_required'] : Array.from(new Set(blockers))
  };
}

export function buildPendingHiddenGeometryReview({ requiredHiddenRoles = [] } = {}) {
  return {
    kind: 'hidden_geometry_review_decision_v1', version: 1,
    source_multi_view_calibration_graph: 'multi-view-calibration-graph.json',
    reviewer: 'hidden-geometry-review-template', status: 'not_accepted',
    required_hidden_roles: [...requiredHiddenRoles], accepted_hidden_surfaces: [],
    promotion_allowed: false, compile_allowed: false,
    notes: ['Unseen closure is not inferred by default.']
  };
}

export function evaluateHiddenGeometryReview({ graph, evidenceReviewResult, reviewDecision } = {}) {
  const acceptedViewIds = new Set(evidenceReviewResult?.accepted_view_ids || []);
  const acceptedEvidenceIds = new Set(evidenceReviewResult?.accepted_correspondence_ids || []);
  const correspondenceById = new Map((graph?.correspondence_candidates || []).map((candidate) => [candidate.id, candidate]));
  const blockers = [];
  const surfaces = reviewDecision?.accepted_hidden_surfaces || [];
  if (evidenceReviewResult?.status !== 'accepted_for_evidence_fusion') blockers.push('accepted_multi_view_evidence_fusion_review_required');
  if (reviewDecision?.status !== 'accepted_hidden_geometry') blockers.push('accepted_hidden_geometry_review_required');
  const requiredRoles = reviewDecision?.required_hidden_roles || [];
  if (!requiredRoles.length) blockers.push('required_hidden_geometry_roles_required');
  if (hasDuplicates(requiredRoles)) blockers.push('required_hidden_geometry_roles_must_be_unique');
  if (hasDuplicates(surfaces.map((surface) => surface.id))) blockers.push('hidden_surface_ids_must_be_unique');
  if (hasDuplicates(surfaces.map((surface) => surface.role))) blockers.push('hidden_surface_roles_must_be_unique');
  for (const role of requiredRoles) if (!surfaces.some((surface) => surface.role === role)) blockers.push(`required_hidden_surface_missing:${role}`);
  for (const surface of surfaces) {
    if (!['cross_view_observed', 'measured_document', 'explicit_user_assumption'].includes(surface.evidence_kind)) blockers.push(`hidden_surface_evidence_kind_invalid:${surface.id}`);
    if (!(surface.confidence >= 0.7)) blockers.push(`hidden_surface_confidence_too_low:${surface.id}`);
    if (!(surface.source_view_ids || []).length) blockers.push(`hidden_surface_source_view_required:${surface.id}`);
    for (const id of surface.source_view_ids || []) if (!acceptedViewIds.has(id)) blockers.push(`hidden_surface_unaccepted_source_view:${surface.id}:${id}`);
    if (!(surface.source_evidence_ids || []).length) blockers.push(`hidden_surface_source_evidence_required:${surface.id}`);
    for (const id of surface.source_evidence_ids || []) {
      const correspondence = correspondenceById.get(id);
      if (!acceptedEvidenceIds.has(id) || !correspondence) blockers.push(`hidden_surface_unaccepted_source_evidence:${surface.id}:${id}`);
      else if (!(surface.source_view_ids || []).some((viewId) => [correspondence.source_view_id, correspondence.target_view_id].includes(viewId))) {
        blockers.push(`hidden_surface_evidence_view_mismatch:${surface.id}:${id}`);
      }
    }
    if (!surface.geometry_descriptor || !Object.keys(surface.geometry_descriptor).length) blockers.push(`hidden_surface_geometry_descriptor_required:${surface.id}`);
  }
  const accepted = blockers.length === 0;
  const releaseEligible = accepted && surfaces.every((surface) => ['cross_view_observed', 'measured_document'].includes(surface.evidence_kind) && surface.confidence >= 0.75);
  return {
    kind: 'hidden_geometry_review_result_v1', version: 1,
    status: accepted ? 'accepted_hidden_geometry' : reviewDecision?.status === 'accepted_hidden_geometry' ? 'blocked_invalid_review' : 'blocked_no_accepted_review',
    accepted_hidden_surface_ids: accepted ? surfaces.map((surface) => surface.id) : [],
    hidden_geometry_allowed: accepted,
    release_eligible: releaseEligible,
    promotion_allowed: false, compile_allowed: false, false_promotion_count: 0,
    blockers: accepted && !releaseEligible ? ['hidden_geometry_requires_cross_view_or_measured_evidence_for_release'] : accepted ? [] : Array.from(new Set(blockers))
  };
}

export function evaluateGeometryFusionGate({
  evidenceReviewResult,
  relativePoseReviewResult,
  metricScaleReviewResult,
  conflictReviewResult,
  hiddenGeometryReviewResult
} = {}) {
  const blockers = [];
  const evidenceAccepted = evidenceReviewResult?.kind === 'multi_view_calibration_review_result_v1'
    && evidenceReviewResult?.status === 'accepted_for_evidence_fusion'
    && evidenceReviewResult?.evidence_fusion_allowed === true;
  const poseAccepted = relativePoseReviewResult?.kind === 'multi_view_relative_pose_review_result_v1'
    && relativePoseReviewResult?.status === 'accepted_for_geometry_fusion'
    && relativePoseReviewResult?.geometry_fusion_allowed === true;
  const poseEdgeIds = (relativePoseReviewResult?.accepted_pose_edges || []).map((edge) => edge.id);
  const conflictAccepted = conflictReviewResult?.kind === 'multi_view_conflict_review_result_v1'
    && conflictReviewResult?.status === 'accepted_conflict_resolution'
    && conflictReviewResult?.geometry_conflicts_resolved === true;
  const conflictMatchesPose = sameStringSet(conflictReviewResult?.source_relative_pose_edge_ids || [], poseEdgeIds)
    && conflictReviewResult?.source_geometry_scope === relativePoseReviewResult?.geometry_scope;
  if (!evidenceAccepted) blockers.push('accepted_multi_view_evidence_fusion_review_required');
  if (!poseAccepted) blockers.push('accepted_relative_pose_review_required');
  if (!conflictAccepted) blockers.push('accepted_multi_view_conflict_review_required');
  if (conflictAccepted && !conflictMatchesPose) blockers.push('conflict_review_pose_mismatch');
  const geometryFusionAllowed = blockers.length === 0;
  const metricAccepted = metricScaleReviewResult?.kind === 'metric_scale_review_result_v1'
    && metricScaleReviewResult?.status === 'accepted_metric_scale'
    && metricScaleReviewResult?.metric_scale_allowed === true;
  const metricMatchesPose = sameStringSet(metricScaleReviewResult?.source_relative_pose_edge_ids || [], poseEdgeIds)
    && metricScaleReviewResult?.source_geometry_scope === relativePoseReviewResult?.geometry_scope;
  const hiddenAccepted = hiddenGeometryReviewResult?.kind === 'hidden_geometry_review_result_v1'
    && hiddenGeometryReviewResult?.status === 'accepted_hidden_geometry'
    && hiddenGeometryReviewResult?.hidden_geometry_allowed === true;
  if (!metricAccepted) blockers.push('accepted_metric_scale_review_required');
  if (metricAccepted && !metricMatchesPose) blockers.push('metric_scale_review_pose_mismatch');
  if (!hiddenAccepted) blockers.push('accepted_hidden_geometry_review_required');
  const partgraphPromotionAllowed = blockers.length === 0;
  const objectFramePose = relativePoseReviewResult?.geometry_scope === 'object_frame';
  const releaseCandidateAllowed = partgraphPromotionAllowed && hiddenGeometryReviewResult?.release_eligible === true && objectFramePose;
  if (partgraphPromotionAllowed && hiddenGeometryReviewResult?.release_eligible !== true) blockers.push('hidden_geometry_release_evidence_insufficient');
  if (partgraphPromotionAllowed && !objectFramePose) blockers.push('object_frame_relative_pose_required_for_release');
  return {
    kind: 'geometry_fusion_gate_result_v1', version: 1,
    status: releaseCandidateAllowed
      ? 'ready_for_reviewed_partgraph_promotion'
      : partgraphPromotionAllowed
        ? 'ready_for_reviewed_partgraph_promotion_release_blocked'
        : geometryFusionAllowed
          ? 'geometry_fusion_ready_promotion_blocked'
          : 'blocked_geometry_fusion',
    evidence_fusion_allowed: evidenceAccepted,
    geometry_fusion_allowed: geometryFusionAllowed,
    metric_scale_allowed: metricAccepted && metricMatchesPose,
    hidden_geometry_allowed: hiddenAccepted,
    conflicts_resolved: conflictAccepted && conflictMatchesPose,
    geometry_scope: relativePoseReviewResult?.geometry_scope || 'unresolved',
    partgraph_promotion_allowed: partgraphPromotionAllowed,
    release_candidate_allowed: releaseCandidateAllowed,
    direct_compile_allowed: false,
    false_promotion_count: 0,
    blockers: Array.from(new Set(blockers))
  };
}

function sameViewPair(correspondence, edge) {
  return (correspondence.source_view_id === edge.source_view_id && correspondence.target_view_id === edge.target_view_id)
    || (correspondence.source_view_id === edge.target_view_id && correspondence.target_view_id === edge.source_view_id);
}

function orientCorrespondence(correspondence, edge) {
  if (correspondence.source_view_id === edge.source_view_id) return correspondence;
  return {
    ...correspondence,
    source_view_id: correspondence.target_view_id,
    target_view_id: correspondence.source_view_id,
    source_point_px: correspondence.target_point_px,
    target_point_px: correspondence.source_point_px,
    source_point_model: correspondence.target_point_model,
    target_point_model: correspondence.source_point_model
  };
}

function validPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
}

function validPoint3d(point) {
  return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
}

function maxHomographyResidual(matrix, correspondences) {
  return Math.max(...correspondences.map((correspondence) => {
    const [x, y] = correspondence.source_point_px;
    const w = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
    if (Math.abs(w) < 1e-9) return Number.POSITIVE_INFINITY;
    const projected = [
      (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / w,
      (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / w
    ];
    return Math.hypot(projected[0] - correspondence.target_point_px[0], projected[1] - correspondence.target_point_px[1]);
  }));
}

function maxRigidTransformResidual(matrix, correspondences) {
  return Math.max(...correspondences.map((correspondence) => {
    const [x, y, z] = correspondence.source_point_model;
    const projected = [0, 1, 2].map((row) => matrix[row][0] * x + matrix[row][1] * y + matrix[row][2] * z + matrix[row][3]);
    return Math.hypot(
      projected[0] - correspondence.target_point_model[0],
      projected[1] - correspondence.target_point_model[1],
      projected[2] - correspondence.target_point_model[2]
    );
  }));
}

function hasNonCollinearModelPoints(correspondences) {
  for (let a = 0; a < correspondences.length - 2; a += 1) {
    for (let b = a + 1; b < correspondences.length - 1; b += 1) {
      for (let c = b + 1; c < correspondences.length; c += 1) {
        const p0 = correspondences[a].source_point_model;
        const p1 = correspondences[b].source_point_model;
        const p2 = correspondences[c].source_point_model;
        const u = p1.map((value, index) => value - p0[index]);
        const v = p2.map((value, index) => value - p0[index]);
        const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (Math.hypot(...cross) > 1e-8) return true;
      }
    }
  }
  return false;
}

function isRigidTransform(matrix) {
  if (!validSquareMatrix(matrix, 4)) return false;
  if (matrix[3].some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-8)) return false;
  const rotation = matrix.slice(0, 3).map((row) => row.slice(0, 3));
  const determinant = matrixDeterminant(rotation);
  if (Math.abs(determinant - 1) > 1e-6) return false;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const dot = rotation.reduce((sum, values) => sum + values[row] * values[column], 0);
      if (Math.abs(dot - (row === column ? 1 : 0)) > 1e-6) return false;
    }
  }
  return true;
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validSquareMatrix(matrix, size) {
  return Array.isArray(matrix) && matrix.length === size && matrix.every((row) => Array.isArray(row) && row.length === size && row.every(Number.isFinite));
}

function matrixDeterminant(matrix) {
  if (matrix.length === 3) {
    return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
      - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
      + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
  }
  let determinant = 0;
  for (let column = 0; column < matrix.length; column += 1) {
    determinant += (column % 2 === 0 ? 1 : -1) * matrix[0][column] * matrixDeterminant(matrix.slice(1).map((row) => row.filter((_, index) => index !== column)));
  }
  return determinant;
}

function allViewsConnected(viewIds, edges, referenceViewId) {
  const visited = new Set([referenceViewId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (visited.has(edge.source_view_id) && !visited.has(edge.target_view_id)) { visited.add(edge.target_view_id); changed = true; }
      if (visited.has(edge.target_view_id) && !visited.has(edge.source_view_id)) { visited.add(edge.source_view_id); changed = true; }
    }
  }
  return [...viewIds].every((id) => visited.has(id));
}
