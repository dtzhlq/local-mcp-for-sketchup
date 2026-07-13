export function buildCalibratedViewGraphFromPerspectiveReview({
  perspectiveCalibration,
  calibrationReviewResult,
  structureLineEvidence = null,
  topologySeed = null,
  profileId = 'building_single'
} = {}) {
  if (calibrationReviewResult?.status !== 'accepted_for_rectification') {
    throw gateError('accepted_perspective_calibration_review_required');
  }
  const hypothesisById = new Map((perspectiveCalibration?.direction_families || []).map((family) => [family.id, family]));
  const segmentById = new Map((structureLineEvidence?.raw_segments || []).map((segment) => [segment.id, segment]));
  const axisFamilies = calibrationReviewResult.accepted_axis_families.map((accepted) => {
    const hypothesis = hypothesisById.get(accepted.direction_family_id);
    const supportIds = accepted.support_segment_ids || [];
    return {
      id: `calibrated_${accepted.axis}_family`,
      axis: accepted.axis,
      label: `${accepted.axis} / reviewed ${accepted.direction_family_id}`,
      image_line_ids: supportIds,
      source_evidence_ids: supportIds,
      image_lines_px: supportIds.slice(0, 48).map((id) => segmentById.get(id)?.line_px).filter(Boolean),
      vanishing_type: accepted.vanishing_type,
      vanishing_point_px: accepted.vanishing_point_px,
      image_direction_px: accepted.image_direction_px
        ? { a: [0, 0], b: accepted.image_direction_px }
        : null,
      confidence: hypothesis?.confidence || 0,
      review_required: true,
      promotion_allowed: false,
      notes: [
        'Axis mapping comes from accepted perspective-calibration review.',
        'This calibrated view allows plane rectification only; it does not authorize geometry promotion.'
      ]
    };
  });
  const imageSize = perspectiveCalibration.source_image;
  const originCornerId = topologySeed?.plan_topology?.origin_corner_id
    || topologySeed?.vertical_boundaries?.find((boundary) => boundary.origin_candidate === true)?.corner_id
    || topologySeed?.plan_topology?.corner_order?.[0]
    || null;
  const originBoundary = topologySeed?.vertical_boundaries?.find((boundary) => boundary.corner_id === originCornerId);
  const originPoint = originBoundary
    ? scalePoint(originBoundary.bottom_norm, imageSize)
    : [imageSize.width / 2, imageSize.height * 0.8];
  return {
    kind: 'calibrated_view_graph_v1',
    version: 1,
    profile_id: profileId,
    coordinate_convention: 'image_x_right_y_down_world_z_up',
    source_structure_evidence_graph: 'structure-line-evidence.json',
    projection_model: calibrationReviewResult.accepted_camera_model,
    source_images: [{ ...imageSize }],
    axis_families: axisFamilies,
    horizon_line_px: calibrationReviewResult.horizon_line_px,
    origin_candidates: [{
      id: `reviewed_ground_corner_${safeId(originCornerId || 'fallback')}_candidate`,
      source_image: imageSize.source_image,
      point_px: originPoint.map(round),
      confidence: 0.75,
      review_required: true
    }],
    scale_anchors: [],
    projection_warnings: [
      'vertical_axis_at_infinity_is_compatible_with_level_shifted_or_post_rectified_image',
      'single_view_calibration_does_not_recover_metric_scale_or_setback_depth'
    ],
    review_policy: {
      status: 'accepted_for_derived_drafting',
      accepted_calibrated_view_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: ['accepted_plane_topology_review_required', 'accepted_partgraph_promotion_review_required']
    },
    summary: {
      axis_family_count: axisFamilies.length,
      finite_vanishing_point_count: axisFamilies.filter((family) => family.vanishing_type === 'finite').length,
      infinite_axis_count: axisFamilies.filter((family) => family.vanishing_type === 'infinite').length,
      projection_model: calibrationReviewResult.accepted_camera_model,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildFacadePlaneGraphFromCalibratedSeed({
  calibrationReviewResult,
  calibratedViewGraph,
  topologySeed,
  localDetailSeed = null
} = {}) {
  const sourceImage = topologySeed?.source_image || calibratedViewGraph?.source_images?.[0]?.source_image || '';
  if (calibrationReviewResult?.status !== 'accepted_for_rectification') {
    return blockedFacadePlaneGraph(sourceImage, 'accepted_perspective_calibration_review_required');
  }
  if (!topologySeed || topologySeed.review_status === 'rejected') {
    return blockedFacadePlaneGraph(sourceImage, 'plane_topology_review_seed_required');
  }
  const imageSize = calibratedViewGraph.source_images[0];
  const boundaryById = new Map(topologySeed.vertical_boundaries.map((boundary) => [boundary.id, {
    ...boundary,
    top_px: scalePoint(boundary.top_norm, imageSize),
    bottom_px: scalePoint(boundary.bottom_norm, imageSize)
  }]));
  const spans = topologySeed.plane_spans;
  const planes = spans.map((span, index) => {
    const left = boundaryById.get(span.left_boundary_id);
    const right = boundaryById.get(span.right_boundary_id);
    if (!left || !right) throw new Error(`Unknown plane boundary for ${span.id}`);
    const quad = [left.top_px, right.top_px, right.bottom_px, left.bottom_px].map((point) => point.map(round));
    const adjacent = spans.filter((candidate) => (
      candidate.id !== span.id
      && (
        candidate.left_boundary_id === span.left_boundary_id
        || candidate.left_boundary_id === span.right_boundary_id
        || candidate.right_boundary_id === span.left_boundary_id
        || candidate.right_boundary_id === span.right_boundary_id
      )
    ));
    return {
      id: span.id,
      role: span.id,
      source_image: sourceImage,
      view: 'oblique_context',
      visible_quad_px: quad,
      visible_bbox_px: quadBoundingBox(quad),
      orientation_hint: {
        kind: 'accepted_axis_calibrated_plane_candidate',
        view: viewSlotForAxis(span.orientation_axis),
        projection_model: calibratedViewGraph.projection_model,
        perspective_strength: perspectiveStrength(calibratedViewGraph.projection_model),
        normal_hint: normalHintForAxis(span.orientation_axis),
        camera_hints: {
          orientation_axis: span.orientation_axis,
          horizon_line_px: calibratedViewGraph.horizon_line_px
        },
        confidence: Number(span.confidence || 0.78),
        review_required: true
      },
      adjacency: adjacent.map((candidate) => ({
        plane_id: candidate.id,
        relation: 'shares_reviewed_vertical_boundary',
        evidence: sharedBoundaryId(span, candidate),
        review_required: true
      })),
      occlusion_order: {
        rank: Number(span.occlusion_order?.rank || index + 1),
        relation_to_camera: span.occlusion_order?.relation_to_camera || span.depth_relation || span.plan_role,
        evidence: `plane_topology_review_seed:${topologySeed.sample_id}`,
        review_required: true
      },
      must_not_merge_with: span.must_not_merge_with,
      source: {
        kind: 'user_annotation',
        semantic_evidence_id: `plane_topology_seed:${span.id}`,
        source_priority: index + 1,
        confidence: Number(span.confidence || 0.78),
        derived_from: [
          'accepted_perspective_calibration_review',
          span.left_boundary_id,
          span.right_boundary_id
        ]
      },
      rectification: {
        kind: 'plane_local_unit_rectification_v1',
        image_to_local_homography: homographyFromQuadToUnitSquare(quad),
        local_quad: [[0, 0], [1, 0], [1, 1], [0, 1]],
        metric_scale_status: 'unknown_single_view'
      },
      review_required: true,
      promotion_allowed: false
    };
  });
  const planeLocalDetailCandidates = buildPlaneLocalDetailCandidates({
    localDetailSeed,
    planes,
    imageSize,
    sourceImage
  });
  return {
    kind: 'facade_plane_graph_v1',
    version: 1,
    profile: 'building_single',
    coordinate_convention: 'image_x_right_y_down',
    coordinate_reference: {
      space: 'calibration_working_image_px',
      source_image: sourceImage,
      width: imageSize.width,
      height: imageSize.height,
      normalized_from_source_image: true
    },
    source_images: [sourceImage],
    source_semantic_evidence: localDetailSeed
      ? 'plane-topology-review-seed.draft.json + plane-local-detail-seed.draft.json'
      : 'plane-topology-review-seed.draft.json',
    planes,
    plane_local_detail_candidates: planeLocalDetailCandidates,
    review_policy: {
      status: 'needs_plane_review',
      accepted_plane_review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      review_required: true,
      blockers: ['accepted_plane_topology_review_required', 'accepted_local_detail_review_required', 'accepted_partgraph_promotion_review_required'],
      notes: [
        'Calibration is accepted only for rectification. Plane identities and recess topology still require review.',
        'Metric depth remains unknown from this single view.'
      ]
    },
    summary: {
      plane_count: planes.length,
      detail_candidate_count: planeLocalDetailCandidates.length,
      visible_plane_ids: planes.map((plane) => plane.id),
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      must_not_merge_pairs: uniquePairs(planes.flatMap((plane) => (
        plane.must_not_merge_with.map((other) => [plane.id, other])
      )))
    }
  };
}

function buildPlaneLocalDetailCandidates({
  localDetailSeed,
  planes,
  imageSize,
  sourceImage
}) {
  if (!localDetailSeed || localDetailSeed.review_status === 'rejected') return [];
  const planeIds = new Set(planes.map((plane) => plane.id));
  const planeById = new Map(planes.map((plane) => [plane.id, plane]));
  return (localDetailSeed.details || []).map((detail, index) => {
    const bbox = normalizedBboxToPixels(detail.bbox_norm, imageSize);
    const candidatePlaneIds = (detail.candidate_plane_ids || []).filter((id) => planeIds.has(id));
    const invalidPlaneIds = (detail.candidate_plane_ids || []).filter((id) => !planeIds.has(id));
    const candidatePlane = candidatePlaneIds.length === 1 ? planeById.get(candidatePlaneIds[0]) : null;
    return {
      id: detail.id,
      role: detail.role,
      source_image: sourceImage,
      view: candidatePlane?.orientation_hint?.view || 'oblique_context',
      candidate_plane_ids: candidatePlaneIds,
      attachment_hint: detail.attachment_hint,
      visible_quad_px: bboxToQuad(bbox),
      bbox_px: bbox,
      source: {
        kind: detail.source || 'unknown',
        semantic_evidence_id: detail.semantic_evidence_id || `plane_local_detail_seed:${detail.id}`,
        source_priority: index + 1,
        confidence: Number(detail.confidence || 0),
        derived_from: [
          'plane_local_detail_seed.draft.json',
          ...candidatePlaneIds
        ]
      },
      review_required: true,
      promotion_allowed: false,
      blockers: Array.from(new Set([
        ...(detail.blockers || []),
        ...(!candidatePlaneIds.length ? ['accepted_plane_binding_required'] : []),
        ...(invalidPlaneIds.length ? ['candidate_plane_id_not_found'] : []),
        'accepted_draft_view_review_required',
        'accepted_facade_plane_review_required',
        'accepted_local_detail_review_required'
      ]))
    };
  });
}

function normalizedBboxToPixels(bboxNorm = [], imageSize = {}) {
  const width = Number(imageSize.width || 0);
  const height = Number(imageSize.height || 0);
  return [
    round(Number(bboxNorm[0] || 0) * width),
    round(Number(bboxNorm[1] || 0) * height),
    round(Number(bboxNorm[2] || 0) * width),
    round(Number(bboxNorm[3] || 0) * height)
  ];
}

function bboxToQuad([x, y, width, height]) {
  return [
    [x, y],
    [round(x + width), y],
    [round(x + width), round(y + height)],
    [x, round(y + height)]
  ];
}

export function buildCornerChainTopologyCandidates({
  calibrationReviewResult,
  calibratedViewGraph,
  topologySeed,
  profileId = 'building_single'
} = {}) {
  if (calibrationReviewResult?.status !== 'accepted_for_rectification') {
    throw gateError('accepted_perspective_calibration_review_required');
  }
  const imageSize = calibratedViewGraph.source_images[0];
  const boundaryByCorner = new Map(topologySeed.vertical_boundaries.map((boundary) => [boundary.corner_id, boundary]));
  const planCornerById = new Map(topologySeed.plan_topology.corners.map((corner) => [corner.id, corner]));
  const cornerPoints = topologySeed.plan_topology.corner_order.map((cornerId) => {
    const boundary = boundaryByCorner.get(cornerId);
    const planCorner = planCornerById.get(cornerId);
    if (!boundary || !planCorner) throw new Error(`Topology seed is missing corner/boundary ${cornerId}`);
    return {
      id: cornerId,
      source_image: topologySeed.source_image,
      point_px: scalePoint(boundary.bottom_norm, imageSize).map(round),
      local_xy: planCorner.diagram_xy.map(round),
      confidence: 0.76,
      review_required: true,
      promotion_allowed: false,
      notes: [
        'Image corner comes from reviewed vertical-boundary candidate.',
        'local_xy is a topology diagram coordinate, not a metric depth measurement.'
      ]
    };
  });
  const chainSuffix = topologySeed.plan_topology.corner_order.map(safeId).join('_');
  const edgeChain = {
    id: `calibrated_corner_chain_${chainSuffix}`,
    source_image: topologySeed.source_image,
    ordered_corner_ids: topologySeed.plan_topology.corner_order,
    edges: topologySeed.plan_topology.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      axis: edge.axis,
      role: edge.role,
      depth_role: edge.depth_role,
      source_line_ids: [`reviewed_plan_edge_${edge.id}`],
      review_required: true,
      promotion_allowed: false
    })),
    review_required: true,
    promotion_allowed: false
  };
  const topologyHypothesis = {
    id: `${safeId(topologySeed.plan_topology.kind)}_candidate`,
    topology: topologySeed.plan_topology.kind,
    source_edge_chain_ids: [edgeChain.id],
    footprint_local: topologySeed.plan_topology.corners.map((corner) => ({
      id: corner.id,
      xy: corner.diagram_xy,
      source: `reviewed_corner_${corner.id}_topology_diagram_only`
    })),
    edge_axis_sequence: topologySeed.plan_topology.edges.map((edge) => edge.axis),
    depth_order: (topologySeed.plan_topology.depth_order || []).map((entry) => ({
      behind: entry.behind,
      in_front: entry.in_front,
      evidence: entry.evidence || []
    })),
    status: 'hypothesis',
    review_required: true,
    promotion_allowed: false,
    notes: [
      ...(topologySeed.notes || []),
      'Plan coordinates are a reviewed topology diagram only; metric depth requires a scale anchor or another calibrated view.'
    ]
  };
  return {
    kind: 'corner_chain_topology_v1',
    version: 1,
    sample_id: topologySeed.sample_id,
    profile_id: profileId,
    coordinate_convention: 'axis_calibrated_local_plan_y_positive_back',
    source_calibrated_view_graph: 'calibrated-view-graph.json',
    source_structure_evidence_graph: 'structure-line-evidence.json',
    corner_points: cornerPoints,
    edge_chains: [edgeChain],
    topology_hypotheses: [topologyHypothesis],
    review_policy: {
      status: 'needs_topology_review',
      accepted_topology_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: ['accepted_corner_chain_topology_review_required', 'accepted_draft_view_review_required', 'accepted_partgraph_promotion_review_required']
    },
    summary: {
      corner_count: cornerPoints.length,
      edge_chain_count: 1,
      topology_hypothesis_count: 1,
      accepted_topology_id: null,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildPendingCornerChainTopologyReview({ topologyGraph } = {}) {
  return {
    kind: 'corner_chain_topology_review_decision_v1',
    version: 1,
    source_corner_chain_topology: 'corner-chain-topology.json',
    source_calibrated_view_graph: 'calibrated-view-graph.json',
    reviewer: 'corner-chain-topology-review-template',
    status: 'not_accepted',
    accepted_corner_ids: [],
    accepted_edge_chain_ids: [],
    accepted_topology_ids: [],
    rejected_topology_ids: [],
    depth_order_overrides: [],
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_corner_chain_topology_review_required'],
    notes: [`Pending review for ${(topologyGraph?.topology_hypotheses || []).length} topology candidate(s).`]
  };
}

export function buildAcceptedCornerChainTopologyReviewFixture({ topologyGraph } = {}) {
  const depthOrder = topologyGraph?.topology_hypotheses?.[0]?.depth_order || [];
  return {
    kind: 'corner_chain_topology_review_decision_v1',
    version: 1,
    source_corner_chain_topology: 'corner-chain-topology.json',
    source_calibrated_view_graph: 'calibrated-view-graph.json',
    reviewer: `${safeId(topologyGraph?.sample_id || 'topology')}-positive-fixture`,
    status: 'accepted_for_derived_drafting',
    accepted_corner_ids: topologyGraph.corner_points.map((corner) => corner.id),
    accepted_edge_chain_ids: topologyGraph.edge_chains.map((chain) => chain.id),
    accepted_topology_ids: topologyGraph.topology_hypotheses.map((hypothesis) => hypothesis.id),
    rejected_topology_ids: [],
    depth_order_overrides: depthOrder,
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_draft_view_review_required', 'accepted_partgraph_promotion_review_required'],
    notes: [
      `Fixture accepts ${topologyGraph?.topology_hypotheses?.[0]?.topology || 'reviewed visible-chain'} topology for derived drafting only.`,
      'Metric depth and geometry promotion remain blocked.'
    ]
  };
}

export function applyCornerChainTopologyReview({ topologyGraph, reviewDecision } = {}) {
  const cornerIds = new Set(topologyGraph.corner_points.map((corner) => corner.id));
  const chainIds = new Set(topologyGraph.edge_chains.map((chain) => chain.id));
  const topologyIds = new Set(topologyGraph.topology_hypotheses.map((hypothesis) => hypothesis.id));
  const blockers = [];
  if (reviewDecision?.status !== 'accepted_for_derived_drafting') {
    blockers.push('accepted_corner_chain_topology_review_required');
  }
  for (const id of reviewDecision?.accepted_corner_ids || []) {
    if (!cornerIds.has(id)) blockers.push(`unknown_corner_id:${id}`);
  }
  for (const id of reviewDecision?.accepted_edge_chain_ids || []) {
    if (!chainIds.has(id)) blockers.push(`unknown_edge_chain_id:${id}`);
  }
  for (const id of reviewDecision?.accepted_topology_ids || []) {
    if (!topologyIds.has(id)) blockers.push(`unknown_topology_id:${id}`);
  }
  if ((reviewDecision?.accepted_topology_ids || []).length !== 1) {
    blockers.push('exactly_one_accepted_topology_required');
  }
  if (blockers.length) {
    return {
      status: reviewDecision?.status === 'accepted_for_derived_drafting' ? 'blocked_invalid_topology_review' : 'blocked_no_accepted_topology_review',
      derived_drafting_allowed: false,
      promotion_allowed: false,
      blockers,
      topology_graph: topologyGraph
    };
  }
  const acceptedId = reviewDecision.accepted_topology_ids[0];
  const reviewedGraph = structuredClone(topologyGraph);
  reviewedGraph.topology_hypotheses = reviewedGraph.topology_hypotheses.map((hypothesis) => ({
    ...hypothesis,
    status: hypothesis.id === acceptedId ? 'accepted_for_derived_drafting' : 'rejected'
  }));
  reviewedGraph.review_policy.status = 'accepted_for_derived_drafting';
  reviewedGraph.review_policy.blockers = ['accepted_draft_view_review_required', 'accepted_partgraph_promotion_review_required'];
  reviewedGraph.summary.accepted_topology_id = acceptedId;
  return {
    status: 'accepted_for_derived_drafting',
    derived_drafting_allowed: true,
    promotion_allowed: false,
    blockers: reviewedGraph.review_policy.blockers,
    topology_graph: reviewedGraph
  };
}

export function buildDraftViewGraphFromTopologyReview({
  topologyReviewResult,
  facadePlaneGraph,
  sourceImage
} = {}) {
  const accepted = topologyReviewResult?.status === 'accepted_for_derived_drafting';
  const planes = facadePlaneGraph?.planes || [];
  const planeByRole = new Map(planes.map((plane) => [plane.id, plane]));
  const visibleRegion = (planeId) => {
    const plane = planeByRole.get(planeId);
    if (!plane) return [];
    return [{
      id: `draft_region_${plane.id}`,
      role: plane.role,
      source_image: plane.source_image,
      source_evidence_id: plane.id,
      visible_quad_px: plane.visible_quad_px,
      confidence: plane.orientation_hint.confidence,
      review_required: true
    }];
  };
  const frontPlanes = planes.filter((plane) => plane.orientation_hint?.view === 'front');
  const sidePlanes = planes.filter((plane) => plane.orientation_hint?.view === 'left_or_right_side');
  const sourceImageId = facadePlaneGraph?.coordinate_reference?.source_image_id || 'source_image_1';
  const projectionModel = planes[0]?.orientation_hint?.projection_model || 'unknown';
  const topology = topologyReviewResult?.topology_graph?.topology_hypotheses?.find((candidate) => (
    candidate.id === topologyReviewResult?.topology_graph?.summary?.accepted_topology_id
  )) || topologyReviewResult?.topology_graph?.topology_hypotheses?.[0] || null;
  const edgeChainIds = topologyReviewResult?.topology_graph?.edge_chains?.map((chain) => chain.id) || [];
  const calibratedSlot = ({ slotId, axis, slotPlanes, unknownId }) => ({
    slot_id: slotId,
    status: slotPlanes.length ? 'partial' : 'unknown',
    projection_basis: slotPlanes.length ? {
      kind: 'accepted_calibrated_plane_rectification',
      axis,
      plane_ids: slotPlanes.map((plane) => plane.id),
      metric_depth_status: 'unknown_single_view'
    } : {
      kind: 'accepted_topology_has_no_plane_for_slot',
      axis
    },
    source_image_ids: slotPlanes.length ? [sourceImageId] : [],
    source_evidence_ids: slotPlanes.map((plane) => plane.id),
    visible_regions: slotPlanes.flatMap((plane) => visibleRegion(plane.id)),
    unknown_regions: [{
      id: unknownId,
      reason: slotPlanes.length ? 'single_view_no_scale_anchor_or_hidden_extent' : 'no_reviewed_visible_plane_for_axis'
    }],
    confidence: slotPlanes.length ? round(average(slotPlanes.map((plane) => plane.orientation_hint?.confidence || 0))) : 0,
    review_required: true,
    promotion_allowed: false
  });
  const slots = accepted ? [
    calibratedSlot({
      slotId: 'front',
      axis: 'x_red',
      slotPlanes: frontPlanes,
      unknownId: 'unknown_front_metric_depth_or_extent'
    }),
    calibratedSlot({
      slotId: 'left_or_right_side',
      axis: 'y_green',
      slotPlanes: sidePlanes,
      unknownId: 'unknown_side_metric_depth_or_extent'
    }),
    {
      slot_id: 'top',
      status: topology ? 'inferred' : 'unknown',
      projection_basis: topology ? {
        kind: 'accepted_corner_chain_topology_diagram',
        topology_id: topology.id,
        topology: topology.topology,
        metric_depth_status: 'unknown_single_view'
      } : { kind: 'accepted_review_missing_topology_hypothesis' },
      source_image_ids: topology ? [sourceImageId] : [],
      source_evidence_ids: topology ? edgeChainIds : [],
      visible_regions: [],
      unknown_regions: [{ id: 'unknown_metric_depth_and_hidden_rear_edges', reason: 'topology_only_no_metric_reconstruction' }],
      confidence: topology ? 0.68 : 0,
      review_required: true,
      promotion_allowed: false
    },
    {
      slot_id: 'oblique_context',
      status: planes.length ? 'observed' : 'unknown',
      projection_basis: {
        kind: 'source_image_with_accepted_calibration_and_topology',
        projection_model: projectionModel
      },
      source_image_ids: planes.length ? [sourceImageId] : [],
      source_evidence_ids: planes.map((plane) => plane.id),
      visible_regions: planes.flatMap((plane) => visibleRegion(plane.id)),
      unknown_regions: planes.length ? [] : [{ id: 'unknown_oblique_context', reason: 'no_reviewed_visible_planes' }],
      confidence: planes.length ? round(average(planes.map((plane) => plane.orientation_hint?.confidence || 0))) : 0,
      review_required: true,
      promotion_allowed: false
    }
  ] : ['front', 'left_or_right_side', 'top', 'oblique_context'].map((slotId) => ({
    slot_id: slotId,
    status: 'unknown',
    projection_basis: { kind: 'blocked_no_accepted_topology_review' },
    source_image_ids: [],
    source_evidence_ids: [],
    visible_regions: [],
    unknown_regions: [{ id: `unknown_${slotId}`, reason: 'accepted_corner_chain_topology_review_required' }],
    confidence: 0,
    review_required: true,
    promotion_allowed: false
  }));
  return {
    kind: 'draft_view_graph_v1',
    version: 1,
    profile_id: 'building_single',
    coordinate_convention: 'image_x_right_y_down',
    source_structure_evidence_graph: 'structure-line-evidence.json',
    view_slots: slots,
    review_overlay: {
      kind: 'draft_view_review_overlay_v1',
      version: 1,
      model_status: 'review_only',
      compile_allowed: false,
      geometry_promotion_allowed: false,
      promotion_allowed: false,
      operations: accepted
        ? facadePlaneGraph.planes.map((plane) => ({
          op: 'draw_review_polygon',
          plane_id: plane.id,
          points_px: plane.visible_quad_px
        }))
        : [],
      qa: {
        no_promoted_geometry: true,
        forbidden_geometry_ops_absent: true
      }
    },
    review_policy: {
      status: accepted ? 'needs_draft_view_review' : 'blocked_no_observed_views',
      accepted_draft_view_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: accepted
        ? ['accepted_draft_view_review_required', 'accepted_partgraph_promotion_review_required']
        : ['accepted_corner_chain_topology_review_required']
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
    },
    source_image: sourceImage
  };
}

export function renderCalibratedPlaneTopologyOverlaySvg({
  facadePlaneGraph,
  topologyGraph,
  imageDataUrl,
  imageSize
} = {}) {
  const width = imageSize.width;
  const height = imageSize.height;
  const colors = ['#7c3aed', '#e11d48', '#0891b2', '#16a34a'];
  const planeShapes = (facadePlaneGraph?.planes || []).map((plane, index) => {
    const points = plane.visible_quad_px.map((point) => point.join(',')).join(' ');
    const color = colors[index % colors.length];
    return `<g data-layer="calibrated-plane" data-plane-id="${plane.id}"><title>${plane.id}</title><polygon points="${points}" fill="${color}" fill-opacity="0.2" stroke="#ffffff" stroke-width="5"/><polygon points="${points}" fill="none" stroke="${color}" stroke-width="3"/></g>`;
  }).join('\n');
  const detailShapes = (facadePlaneGraph?.plane_local_detail_candidates || []).map((detail) => {
    const points = detail.visible_quad_px.map((point) => point.join(',')).join(' ');
    const unassigned = detail.candidate_plane_ids.length === 0;
    const color = unassigned ? '#c026d3' : '#f59e0b';
    return `<g data-layer="plane-local-detail" data-detail-id="${detail.id}" data-binding="${unassigned ? 'unassigned' : 'plane-candidate'}"><title>${detail.id}: ${detail.attachment_hint}</title><polygon points="${points}" fill="${color}" fill-opacity="0.08" stroke="#ffffff" stroke-width="4" stroke-dasharray="8 5"/><polygon points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="8 5"/></g>`;
  }).join('\n');
  const legendLabels = (facadePlaneGraph?.planes || []).map((plane) => plane.id);
  const planeLegend = legendLabels.map((label, index) => `<g data-layer="plane-legend"><rect x="20" y="${72 + index * 21}" width="13" height="13" fill="${colors[index % colors.length]}" fill-opacity="0.75"/><text x="41" y="${83 + index * 21}" font-family="ui-monospace, monospace" font-size="12" fill="#111827">${escapeXml(label)}</text></g>`).join('\n');
  const topology = topologyGraph?.topology_hypotheses?.[0];
  const insetX = width - 260;
  const insetY = 16;
  const insetW = 244;
  const insetH = 150;
  const footprint = topology?.footprint_local || [];
  const xs = footprint.map((corner) => Number(corner.xy[0]));
  const ys = footprint.map((corner) => Number(corner.xy[1]));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;
  const xRange = Math.max(0.001, maxX - minX);
  const yRange = Math.max(0.001, maxY - minY);
  const points = new Map(footprint.map((corner) => [corner.id, [
    insetX + 24 + ((corner.xy[0] - minX) / xRange) * 190,
    insetY + 128 - ((corner.xy[1] - minY) / yRange) * 78
  ]]));
  const edges = (topologyGraph?.edge_chains?.[0]?.edges || []).map((edge) => {
    const from = points.get(edge.from);
    const to = points.get(edge.to);
    if (!from || !to) return '';
    const color = edge.axis === 'x_red' ? '#e11d48' : edge.axis === 'y_green' ? '#0891b2' : '#7c3aed';
    return `<g data-layer="plan-topology-edge"><line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke="#fff" stroke-width="7"/><line x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke="${color}" stroke-width="4"/><text x="${round((from[0] + to[0]) / 2)}" y="${round((from[1] + to[1]) / 2 - 7)}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12">${edge.id}</text></g>`;
  }).join('\n');
  const corners = [...points.entries()].map(([id, point]) => `<g data-layer="plan-topology-corner"><circle cx="${point[0]}" cy="${point[1]}" r="5" fill="#111827" stroke="#fff" stroke-width="2"/><text x="${point[0] + 8}" y="${point[1] - 7}" font-family="ui-monospace, monospace" font-size="12">${id}</text></g>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageDataUrl}" width="${width}" height="${height}" preserveAspectRatio="none"/>
  <g data-layer="calibrated-plane-graph">${planeShapes}</g>
  <g data-layer="plane-local-detail-candidates">${detailShapes}</g>
  <g data-layer="plan-topology-inset"><rect x="${insetX}" y="${insetY}" width="${insetW}" height="${insetH}" fill="#f8fafc" fill-opacity="0.94" stroke="#111827"/><text x="${insetX + 12}" y="${insetY + 19}" font-family="ui-monospace, monospace" font-size="12" fill="#111827">topology only</text><text x="${insetX + 12}" y="${insetY + 35}" font-family="ui-monospace, monospace" font-size="11" fill="#991b1b">metric depth unknown</text>${edges}${corners}</g>
  <rect x="10" y="10" width="360" height="44" fill="#fff" fill-opacity="0.92" stroke="#111827"/>
  <text x="18" y="29" font-family="ui-monospace, monospace" font-size="13">calibration=accepted review / planes=review candidates</text>
  <text x="18" y="47" font-family="ui-monospace, monospace" font-size="12" fill="#991b1b">promotion_allowed=false metric_depth=unknown</text>
  <rect x="10" y="62" width="340" height="${Math.max(78, 38 + legendLabels.length * 21)}" fill="#fff" fill-opacity="0.9" stroke="#94a3b8"/>
  ${planeLegend}
  <line x1="20" y1="${82 + legendLabels.length * 21}" x2="48" y2="${82 + legendLabels.length * 21}" stroke="#f59e0b" stroke-width="3" stroke-dasharray="8 5"/><text x="56" y="${86 + legendLabels.length * 21}" font-family="ui-monospace, monospace" font-size="11">plane-local candidates</text>
  <line x1="20" y1="${95 + legendLabels.length * 21}" x2="48" y2="${95 + legendLabels.length * 21}" stroke="#c026d3" stroke-width="3" stroke-dasharray="8 5"/><text x="56" y="${99 + legendLabels.length * 21}" font-family="ui-monospace, monospace" font-size="11">unassigned detail</text>
</svg>`;
}

function blockedFacadePlaneGraph(sourceImage, blocker) {
  return {
    kind: 'facade_plane_graph_v1',
    version: 1,
    profile: 'building_single',
    coordinate_convention: 'image_x_right_y_down',
    source_images: [sourceImage],
    planes: [],
    plane_local_detail_candidates: [],
    review_policy: {
      status: 'blocked_no_visible_planes',
      accepted_plane_review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      review_required: true,
      blockers: [blocker]
    },
    summary: {
      plane_count: 0,
      detail_candidate_count: 0,
      visible_plane_ids: [],
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      must_not_merge_pairs: []
    }
  };
}

function scalePoint(pointNorm, imageSize) {
  return [pointNorm[0] * imageSize.width, pointNorm[1] * imageSize.height];
}

function sharedBoundaryId(first, second) {
  return [first.left_boundary_id, first.right_boundary_id]
    .find((id) => id === second.left_boundary_id || id === second.right_boundary_id) || 'unknown_shared_boundary';
}

function quadBoundingBox(quad) {
  const xs = quad.map((point) => point[0]);
  const ys = quad.map((point) => point[1]);
  return [round(Math.min(...xs)), round(Math.min(...ys)), round(Math.max(...xs)), round(Math.max(...ys))];
}

function uniquePairs(pairs) {
  const seen = new Set();
  const output = [];
  for (const pair of pairs) {
    const normalized = [...pair].sort();
    const key = normalized.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function viewSlotForAxis(axis) {
  if (axis === 'x_red') return 'front';
  if (axis === 'y_green') return 'left_or_right_side';
  return 'oblique_context';
}

function normalHintForAxis(axis) {
  if (axis === 'x_red') return 'normal_y_green';
  if (axis === 'y_green') return 'normal_x_red';
  return 'normal_unknown_until_plane_review';
}

function perspectiveStrength(model) {
  if (model === 'orthographic_or_near_orthographic') return 'low';
  if (model === 'one_point_or_near_affine') return 'medium';
  return 'high';
}

function safeId(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'unknown';
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function homographyFromQuadToUnitSquare(quad) {
  const destination = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix = [];
  const rhs = [];
  for (let index = 0; index < 4; index += 1) {
    const [x, y] = quad[index];
    const [u, v] = destination[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const solution = solveLinearSystem(matrix, rhs);
  return [
    [round(solution[0], 6), round(solution[1], 6), round(solution[2], 6)],
    [round(solution[3], 6), round(solution[4], 6), round(solution[5], 6)],
    [round(solution[6], 6), round(solution[7], 6), 1]
  ];
}

function solveLinearSystem(matrix, rhs) {
  const count = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let pivot = 0; pivot < count; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < count; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot] || 1e-12;
    for (let column = pivot; column <= count; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < count; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= count; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }
  return augmented.map((row) => row[count]);
}

function gateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}
