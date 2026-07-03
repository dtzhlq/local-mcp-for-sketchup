import fs from 'node:fs/promises';
import path from 'node:path';

export const CALIBRATED_VIEW_GRAPH_KIND = 'calibrated_view_graph_v1';
export const CORNER_CHAIN_TOPOLOGY_KIND = 'corner_chain_topology_v1';
export const CALIBRATED_VIEW_REVIEW_DECISION_KIND = 'calibrated_view_review_decision_v1';
export const CORNER_CHAIN_TOPOLOGY_REVIEW_DECISION_KIND = 'corner_chain_topology_review_decision_v1';

export const YELLOW_CORNER_CHAIN_TRUTH = {
  source: 'user_match_photo_review_truth',
  projection_model: 'two_point_vertical_parallel',
  projection_warnings: [
    'vertical_blue_axis_is_parallel_or_infinite_for_this_photo_match_style_view',
    'shifted_lens_or_post_rectified_image_possible_do_not_force_3vp_blue_vanishing_point'
  ],
  corners: [
    {
      id: 'A',
      point_px: [443.7, 81.9],
      local_xy: [0, 0.18],
      notes: ['set-back left segment start; behind main street facade CD']
    },
    {
      id: 'B',
      point_px: [561.5, 126.2],
      local_xy: [0.31, 0.18],
      notes: ['inner notch corner; AB and CD share the x_red axis family']
    },
    {
      id: 'C',
      point_px: [626.5, 105.6],
      local_xy: [0.31, 0],
      notes: ['return edge meets the main street/front facade']
    },
    {
      id: 'D',
      point_px: [756.8, 137.4],
      local_xy: [1, 0],
      notes: ['right end of the main street/front facade']
    }
  ],
  edges: [
    {
      id: 'AB',
      from: 'A',
      to: 'B',
      axis: 'x_red',
      role: 'recessed_left_front_segment',
      depth_role: 'behind_main_front_edge'
    },
    {
      id: 'BC',
      from: 'B',
      to: 'C',
      axis: 'y_green',
      role: 'left_recess_return_depth_edge',
      depth_role: 'connects_recessed_segment_to_main_front'
    },
    {
      id: 'CD',
      from: 'C',
      to: 'D',
      axis: 'x_red',
      role: 'main_street_front_edge',
      depth_role: 'in_front_of_AB'
    }
  ],
  topology: 'left_front_recess_notch',
  accepted_topology_id: 'yellow_left_front_recess_notch_topology',
  depth_order: [
    {
      behind: 'AB',
      in_front: 'CD',
      evidence: [
        'user_top_view_review_truth',
        'roof_corner_chain_A_B_C_D',
        'B_C_is_green_return_depth_edge'
      ]
    }
  ]
};

export function buildYellowCalibratedViewGraph({
  structuralProjection,
  sourceImage,
  profileId = 'building_single'
} = {}) {
  const truth = YELLOW_CORNER_CHAIN_TRUTH;
  const imageSize = structuralProjection?.image_size || { width: 900, height: 589 };
  const corners = new Map(truth.corners.map((corner) => [corner.id, corner]));
  const edgeLine = (edgeId) => {
    const edge = truth.edges.find((item) => item.id === edgeId);
    if (!edge) return null;
    return {
      a: corners.get(edge.from).point_px.map((value) => round(value)),
      b: corners.get(edge.to).point_px.map((value) => round(value))
    };
  };
  const verticalLines = (structuralProjection?.lines || [])
    .filter((line) => line.family === 'vertical')
    .slice(0, 4)
    .map((line) => line.fitted_line_px);
  const xLines = ['AB', 'CD'].map(edgeLine).filter(Boolean);
  const yLines = ['BC'].map(edgeLine).filter(Boolean);
  const axisFamilies = [
    {
      id: 'yellow_axis_x_red_facade_width',
      axis: 'x_red',
      label: 'red axis / facade-width family',
      image_line_ids: ['AB', 'CD'],
      source_evidence_ids: [
        'yellow_corner_chain_edge_AB',
        'yellow_corner_chain_edge_CD',
        'yellow_primary_roof_front_edge'
      ],
      image_lines_px: xLines,
      vanishing_type: structuralProjection?.vanishing?.primary_facade_vanishing_point_px ? 'finite' : 'unknown',
      vanishing_point_px: structuralProjection?.vanishing?.primary_facade_vanishing_point_px || null,
      image_direction_px: null,
      confidence: 0.72,
      review_required: true,
      promotion_allowed: false,
      notes: ['AB and CD are parallel in the accepted topological review, but AB is behind CD in the green-axis direction.']
    },
    {
      id: 'yellow_axis_y_green_depth',
      axis: 'y_green',
      label: 'green axis / return-depth family',
      image_line_ids: ['BC'],
      source_evidence_ids: [
        'yellow_corner_chain_edge_BC',
        'yellow_side_roof_front_edge'
      ],
      image_lines_px: yLines,
      vanishing_type: structuralProjection?.vanishing?.side_depth_vanishing_point_px ? 'finite' : 'unknown',
      vanishing_point_px: structuralProjection?.vanishing?.side_depth_vanishing_point_px || null,
      image_direction_px: null,
      confidence: 0.66,
      review_required: true,
      promotion_allowed: false,
      notes: ['BC is the return edge that resolves the left-front recess depth order.']
    },
    {
      id: 'yellow_axis_z_blue_vertical',
      axis: 'z_blue',
      label: 'blue axis / vertical family',
      image_line_ids: ['yellow_primary_left_corner_vertical', 'yellow_primary_right_edge_vertical', 'yellow_side_left_edge_vertical'],
      source_evidence_ids: ['yellow_primary_left_corner_vertical', 'yellow_primary_right_edge_vertical', 'yellow_side_left_edge_vertical'],
      image_lines_px: verticalLines,
      vanishing_type: 'infinite',
      vanishing_point_px: null,
      image_direction_px: { a: [0, 0], b: [0, 1] },
      confidence: 0.7,
      review_required: true,
      promotion_allowed: false,
      notes: ['Treat blue axis as vertical-parallel/infinite for this likely match-photo or shifted-lens style image.']
    }
  ];
  return {
    kind: CALIBRATED_VIEW_GRAPH_KIND,
    version: 1,
    profile_id: profileId,
    coordinate_convention: 'image_x_right_y_down_world_z_up',
    source_structure_evidence_graph: 'structure-evidence-graph.json',
    projection_model: truth.projection_model,
    source_images: [
      {
        id: 'source_image_1',
        source_image: sourceImage || structuralProjection?.source_image || '',
        width: Number(imageSize.width || 0),
        height: Number(imageSize.height || 0)
      }
    ],
    axis_families: axisFamilies,
    horizon_line_px: structuralProjection?.vanishing?.horizon_line_px || null,
    origin_candidates: [
      {
        id: 'yellow_origin_C_main_front_return',
        source_image: sourceImage || structuralProjection?.source_image || '',
        point_px: corners.get('C').point_px.map((value) => round(value)),
        confidence: 0.58,
        review_required: true
      }
    ],
    scale_anchors: [],
    projection_warnings: truth.projection_warnings,
    review_policy: {
      status: 'accepted_for_derived_drafting',
      accepted_calibrated_view_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: ['accepted_partgraph_promotion_review_required']
    },
    summary: {
      axis_family_count: axisFamilies.length,
      finite_vanishing_point_count: axisFamilies.filter((axis) => axis.vanishing_type === 'finite').length,
      infinite_axis_count: axisFamilies.filter((axis) => axis.vanishing_type === 'infinite').length,
      projection_model: truth.projection_model,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildYellowCornerChainTopologyGraph({
  calibratedViewGraph,
  structuralProjection,
  sourceImage,
  profileId = 'building_single'
} = {}) {
  const truth = YELLOW_CORNER_CHAIN_TRUTH;
  const source = sourceImage || structuralProjection?.source_image || calibratedViewGraph?.source_images?.[0]?.source_image || '';
  const cornerPoints = truth.corners.map((corner) => ({
    id: corner.id,
    source_image: source,
    point_px: corner.point_px.map((value) => round(value)),
    local_xy: corner.local_xy.map((value) => round(value)),
    confidence: 0.72,
    review_required: true,
    promotion_allowed: false,
    notes: corner.notes || []
  }));
  const depthToWidthRatio = round(structuralProjection?.plan_projection?.depth_to_width_ratio || 0.487);
  const edgeChain = {
    id: 'yellow_roof_chain_A_B_C_D',
    source_image: source,
    ordered_corner_ids: ['A', 'B', 'C', 'D'],
    edges: truth.edges.map((edge) => ({
      ...edge,
      source_line_ids: [`yellow_corner_chain_edge_${edge.id}`],
      review_required: true,
      promotion_allowed: false
    })),
    review_required: true,
    promotion_allowed: false
  };
  const footprintLocal = [
    { id: 'A_recessed_left_front', xy: [0, 0.18], source: 'corner_A' },
    { id: 'B_inner_recess_corner', xy: [0.31, 0.18], source: 'corner_B' },
    { id: 'C_main_front_return_corner', xy: [0.31, 0], source: 'corner_C' },
    { id: 'D_main_front_right_corner', xy: [1, 0], source: 'corner_D' },
    { id: 'back_right_inferred', xy: [1, depthToWidthRatio], source: 'parallel_depth_inferred_after_topology_review' },
    { id: 'back_left_inferred', xy: [0, depthToWidthRatio], source: 'parallel_depth_inferred_after_topology_review' }
  ];
  const topologyHypothesis = {
    id: truth.accepted_topology_id,
    topology: truth.topology,
    source_edge_chain_ids: [edgeChain.id],
    footprint_local: footprintLocal,
    edge_axis_sequence: ['x_red', 'y_green', 'x_red'],
    depth_order: truth.depth_order,
    status: 'accepted_for_derived_drafting',
    review_required: true,
    promotion_allowed: false,
    notes: [
      'Accepted review truth: AB is the set-back segment, BC is the return edge, and CD is the main street/front edge.',
      'This topology may derive review drawings, but it does not allow PartGraph or SketchUp promotion.'
    ]
  };
  return {
    kind: CORNER_CHAIN_TOPOLOGY_KIND,
    version: 1,
    profile_id: profileId,
    coordinate_convention: 'axis_calibrated_local_plan_y_positive_back',
    source_calibrated_view_graph: 'calibrated-view-graph.json',
    source_structure_evidence_graph: 'structure-evidence-graph.json',
    corner_points: cornerPoints,
    edge_chains: [edgeChain],
    topology_hypotheses: [topologyHypothesis],
    review_policy: {
      status: 'accepted_for_derived_drafting',
      accepted_topology_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: ['accepted_partgraph_promotion_review_required']
    },
    summary: {
      corner_count: cornerPoints.length,
      edge_chain_count: 1,
      topology_hypothesis_count: 1,
      accepted_topology_id: truth.accepted_topology_id,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildAcceptedYellowCalibratedViewReviewDecision({ calibratedViewGraph } = {}) {
  return {
    kind: CALIBRATED_VIEW_REVIEW_DECISION_KIND,
    version: 1,
    source_calibrated_view_graph: 'calibrated-view-graph.json',
    reviewer: 'yellow-user-topology-review-fixture',
    status: 'accepted_for_derived_drafting',
    accepted_axis_family_ids: (calibratedViewGraph?.axis_families || []).map((axis) => axis.id),
    rejected_axis_family_ids: [],
    corrected_axes: [
      {
        axis_family_id: 'yellow_axis_z_blue_vertical',
        correction: 'treat_as_infinite_vertical_axis',
        reason: 'photo_match_or_shifted_lens_style_view_makes_blue_axis_parallel'
      }
    ],
    accepted_projection_model: calibratedViewGraph?.projection_model || 'two_point_vertical_parallel',
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_partgraph_promotion_review_required'],
    notes: [
      'Accepts the red/green/blue axis families only for derived drafting artifacts.',
      'Does not grant PartGraph or SketchUp promotion.'
    ]
  };
}

export function buildAcceptedYellowCornerChainTopologyReviewDecision({ topologyGraph } = {}) {
  const acceptedTopologyIds = (topologyGraph?.topology_hypotheses || [])
    .filter((hypothesis) => hypothesis.status === 'accepted_for_derived_drafting')
    .map((hypothesis) => hypothesis.id);
  return {
    kind: CORNER_CHAIN_TOPOLOGY_REVIEW_DECISION_KIND,
    version: 1,
    source_corner_chain_topology: 'corner-chain-topology.json',
    source_calibrated_view_graph: 'calibrated-view-graph.json',
    reviewer: 'yellow-user-topology-review-fixture',
    status: acceptedTopologyIds.length ? 'accepted_for_derived_drafting' : 'not_accepted',
    accepted_corner_ids: (topologyGraph?.corner_points || []).map((corner) => corner.id),
    accepted_edge_chain_ids: (topologyGraph?.edge_chains || []).map((chain) => chain.id),
    accepted_topology_ids: acceptedTopologyIds,
    rejected_topology_ids: [],
    depth_order_overrides: YELLOW_CORNER_CHAIN_TRUTH.depth_order,
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_partgraph_promotion_review_required'],
    notes: [
      'Accepted topology for derived plan/facade review only: AB behind CD, BC is the return edge.',
      'This review explicitly rejects the previous opposite-depth stepped plan.'
    ]
  };
}

export function planProjectionFromCornerChainTopology({
  topologyGraph,
  structuralProjection
} = {}) {
  const accepted = (topologyGraph?.topology_hypotheses || [])
    .find((hypothesis) => hypothesis.status === 'accepted_for_derived_drafting')
    || topologyGraph?.topology_hypotheses?.[0];
  const depthToWidthRatio = round(structuralProjection?.plan_projection?.depth_to_width_ratio || 0.487);
  return {
    id: 'yellow_relative_plan_projection',
    kind: 'normalized_footprint_projection_v1',
    coordinate_convention: 'front_width_1_depth_relative_y_positive_back',
    source_calibrated_view_graph: 'calibrated-view-graph.json',
    source_corner_chain_topology: 'corner-chain-topology.json',
    accepted_topology_id: accepted?.id || null,
    footprint_topology: accepted?.topology || 'unknown',
    front_edge_policy: 'main_front_edge_CD_with_left_recess_AB_behind',
    footprint_local: accepted?.footprint_local || [],
    axis_mapping: {
      facade_width: 'x_red',
      return_depth: 'y_green',
      vertical: 'z_blue_infinite'
    },
    corner_chain: {
      ordered_corners: ['A', 'B', 'C', 'D'],
      edges: [
        { id: 'AB', role: 'recessed_left_front_segment', axis: 'x_red', depth_role: 'behind_CD' },
        { id: 'BC', role: 'left_recess_return_depth_edge', axis: 'y_green', depth_role: 'return_to_main_front' },
        { id: 'CD', role: 'main_street_front_edge', axis: 'x_red', depth_role: 'in_front_of_AB' }
      ]
    },
    recesses: [
      {
        id: 'yellow_left_front_recess_notch',
        kind: 'facade_notch',
        topology: 'left_front_recess_notch',
        start_x_ratio: 0.31,
        end_x_ratio: 1,
        depth_to_width_ratio: 0.18,
        recessed_edge_id: 'AB',
        return_edge_id: 'BC',
        main_front_edge_id: 'CD',
        recessed_depth_to_width_ratio: 0.18,
        affected_front_segment: [0, 0.31],
        depth_order: YELLOW_CORNER_CHAIN_TRUTH.depth_order,
        source: 'corner_chain_topology_review',
        review_status: 'accepted_for_derived_drafting',
        review_required: true,
        promotion_allowed: false
      }
    ],
    depth_order: YELLOW_CORNER_CHAIN_TRUTH.depth_order,
    visible_plane_ids: (structuralProjection?.planes || []).map((plane) => plane.id),
    depth_to_width_ratio: depthToWidthRatio,
    scale_status: 'relative_only_no_metric_scale',
    source_line_ids: [
      'yellow_corner_chain_edge_AB',
      'yellow_corner_chain_edge_BC',
      'yellow_corner_chain_edge_CD'
    ],
    inferred_hidden_edges: ['back_right_inferred', 'back_left_inferred'],
    review_required: true,
    promotion_allowed: false
  };
}

export function renderCalibratedViewGraphMarkdown(graph) {
  return `# Calibrated View Graph

- kind: \`${graph.kind}\`
- projection_model: \`${graph.projection_model}\`
- status: \`${graph.review_policy.status}\`
- promotion_allowed: \`${String(graph.review_policy.promotion_allowed === true)}\`

## Axis Families

| id | axis | vanishing | confidence | lines |
| --- | --- | --- | ---: | --- |
${graph.axis_families.map((axis) => `| ${axis.id} | ${axis.axis} | ${axis.vanishing_type} | ${axis.confidence} | ${axis.image_line_ids.join(', ')} |`).join('\n')}

## Projection Warnings

${graph.projection_warnings.map((warning) => `- ${warning}`).join('\n')}
`;
}

export function renderCornerChainTopologyMarkdown(graph) {
  const topology = graph.topology_hypotheses[0];
  return `# Corner Chain Topology

- kind: \`${graph.kind}\`
- status: \`${graph.review_policy.status}\`
- accepted_topology_id: \`${graph.summary.accepted_topology_id || 'none'}\`
- promotion_allowed: \`${String(graph.review_policy.promotion_allowed === true)}\`

## Corners

| id | image px | local xy |
| --- | --- | --- |
${graph.corner_points.map((corner) => `| ${corner.id} | ${pointToken(corner.point_px)} | ${pointToken(corner.local_xy)} |`).join('\n')}

## Edge Chain

| edge | axis | role | depth role |
| --- | --- | --- | --- |
${graph.edge_chains.flatMap((chain) => chain.edges).map((edge) => `| ${edge.id} | ${edge.axis} | ${edge.role} | ${edge.depth_role} |`).join('\n')}

## Topology

- topology: \`${topology?.topology || 'unknown'}\`
- edge_axis_sequence: \`${(topology?.edge_axis_sequence || []).join(' -> ')}\`
- depth_order: ${(topology?.depth_order || []).map((order) => `${order.behind} behind ${order.in_front}`).join(', ') || 'none'}
`;
}

export function renderCalibratedViewOverlaySvg(graph, sourceImagePath) {
  const image = graph.source_images?.[0] || { width: 900, height: 589 };
  const dataUrl = imageDataUrl(sourceImagePath);
  const axisLines = graph.axis_families.flatMap((axis) => (axis.image_lines_px || []).map((line) => lineSvg({
    line,
    color: axisColor(axis.axis),
    width: axis.axis === 'z_blue' ? 2.2 : 4,
    label: `${axis.axis} ${axis.vanishing_type}`
  }))).join('\n');
  const originMarkers = (graph.origin_candidates || []).map((origin) => pointSvg({
    point: origin.point_px,
    color: '#111827',
    label: origin.id
  })).join('\n');
  const legend = `<g>
  <rect x="18" y="18" width="450" height="112" fill="white" fill-opacity="0.88" stroke="#cbd5e1"/>
  <text x="30" y="43" font-size="16" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Calibrated View Graph</text>
  <text x="30" y="66" font-size="12" fill="#334155" font-family="Arial, sans-serif">projection=${escapeXml(graph.projection_model)}; z_blue can be infinite/parallel</text>
  <text x="30" y="88" font-size="12" fill="#334155" font-family="Arial, sans-serif">red=x facade width, green=return depth, blue=vertical</text>
  <text x="30" y="110" font-size="12" fill="#334155" font-family="Arial, sans-serif">review-only: no PartGraph or SketchUp promotion</text>
</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">
<image href="${dataUrl}" width="${image.width}" height="${image.height}"/>
${axisLines}
${originMarkers}
${legend}
</svg>
`;
}

export function renderCornerChainTopologyOverlaySvg(graph, sourceImagePath) {
  const sourceImage = graph.corner_points?.[0]?.source_image || '';
  const width = graph.source_image_size?.width || 900;
  const height = graph.source_image_size?.height || 589;
  const dataUrl = imageDataUrl(sourceImagePath);
  const cornerById = new Map(graph.corner_points.map((corner) => [corner.id, corner]));
  const chainLines = graph.edge_chains.flatMap((chain) => chain.edges.map((edge) => {
    const from = cornerById.get(edge.from);
    const to = cornerById.get(edge.to);
    return lineSvg({
      line: { a: from.point_px, b: to.point_px },
      color: axisColor(edge.axis),
      width: edge.id === 'BC' ? 5 : 4,
      label: `${edge.id} ${edge.axis} ${edge.role}`
    });
  })).join('\n');
  const corners = graph.corner_points.map((corner) => labeledPointSvg({
    point: corner.point_px,
    color: '#111827',
    label: corner.id
  })).join('\n');
  const depthOrder = graph.topology_hypotheses?.[0]?.depth_order?.[0];
  const legend = `<g>
  <rect x="18" y="18" width="392" height="120" fill="white" fill-opacity="0.88" stroke="#cbd5e1"/>
  <text x="30" y="43" font-size="16" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Corner Chain Topology</text>
  <text x="30" y="66" font-size="12" fill="#334155" font-family="Arial, sans-serif">A-B and C-D share x_red; B-C is y_green return edge</text>
  <text x="30" y="88" font-size="12" fill="#334155" font-family="Arial, sans-serif">${escapeXml(depthOrder ? `${depthOrder.behind} is behind ${depthOrder.in_front}` : 'depth order review required')}</text>
  <text x="30" y="110" font-size="12" fill="#334155" font-family="Arial, sans-serif">topology=left_front_recess_notch; derived drafting only</text>
</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<image href="${dataUrl}" width="${width}" height="${height}"/>
${chainLines}
${corners}
${legend}
<title>${escapeXml(sourceImage)}</title>
</svg>
`;
}

export async function prepareCalibrationImageDataUrl(sourceImagePath) {
  const data = await fs.readFile(sourceImagePath);
  imageDataUrl.cache.set(sourceImagePath, data.toString('base64'));
}

function imageDataUrl(sourceImagePath) {
  const extension = path.extname(sourceImagePath).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'jpeg' : 'png';
  return `data:image/${mime};base64,${imageDataUrl.cache.get(sourceImagePath) || ''}`;
}
imageDataUrl.cache = new Map();

function lineSvg({ line, color, width = 3, label }) {
  return `<line data-layer="calibrated-axis-line" x1="${round(line.a[0])}" y1="${round(line.a[1])}" x2="${round(line.b[0])}" y2="${round(line.b[1])}" stroke="${color}" stroke-width="${width}">
  <title>${escapeXml(label)}</title>
</line>`;
}

function pointSvg({ point, color, label }) {
  return `<g data-layer="calibrated-origin">
  <circle cx="${round(point[0])}" cy="${round(point[1])}" r="7" fill="${color}" fill-opacity="0.86"/>
  <title>${escapeXml(label)}</title>
</g>`;
}

function labeledPointSvg({ point, color, label }) {
  return `<g data-layer="corner-chain-point">
  <circle cx="${round(point[0])}" cy="${round(point[1])}" r="7" fill="white" stroke="${color}" stroke-width="3"/>
  <text x="${round(point[0] + 10)}" y="${round(point[1] - 10)}" font-size="20" font-weight="700" fill="${color}" font-family="Arial, sans-serif">${escapeXml(label)}</text>
</g>`;
}

function axisColor(axis) {
  if (axis === 'x_red') return '#dc2626';
  if (axis === 'y_green') return '#16a34a';
  if (axis === 'z_blue') return '#2563eb';
  return '#64748b';
}

function pointToken(point = []) {
  return `[${point.map((value) => round(value)).join(', ')}]`;
}

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
