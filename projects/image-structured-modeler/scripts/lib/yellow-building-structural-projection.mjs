import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { repoRoot } from './image-analysis.mjs';

export const YELLOW_BUILDING_STRUCTURAL_PROJECTION_KIND = 'yellow_building_structural_projection_v1';
export const BUILDING_SINGLE_STRUCTURAL_PROJECTION_KIND = 'building_single_structural_projection_v1';

const REFERENCE_SIZE = { width: 900, height: 589 };
const STRUCTURAL_BACKEND = 'seeded_topology_clamped_sobel_line_fit';

const LINE_HINTS = [
  {
    id: 'yellow_primary_left_corner_vertical',
    role: 'primary_facade_left_corner',
    family: 'vertical',
    seed: [[444, 88], [444, 546]],
    max_angle_deg: 0.8,
    max_offset_px: 3
  },
  {
    id: 'yellow_primary_right_edge_vertical',
    role: 'primary_facade_right_edge',
    family: 'vertical',
    seed: [[760, 138], [760, 516]],
    max_angle_deg: 0.8,
    max_offset_px: 3
  },
  {
    id: 'yellow_side_left_edge_vertical',
    role: 'side_plane_left_edge',
    family: 'vertical',
    seed: [[291, 118], [291, 557]],
    max_angle_deg: 0.8,
    max_offset_px: 3
  },
  {
    id: 'yellow_primary_roof_front_edge',
    role: 'primary_facade_roof_edge',
    family: 'primary_facade_width_axis',
    seed: [[444, 88], [760, 138]],
    max_angle_deg: 1.2,
    max_offset_px: 3
  },
  {
    id: 'yellow_primary_street_base_edge',
    role: 'primary_facade_street_base',
    family: 'primary_facade_width_axis',
    seed: [[444, 546], [760, 516]],
    max_angle_deg: 1.2,
    max_offset_px: 3
  },
  {
    id: 'yellow_side_roof_front_edge',
    role: 'side_plane_roof_edge',
    family: 'side_depth_axis',
    seed: [[291, 118], [444, 88]],
    max_angle_deg: 1.2,
    max_offset_px: 3
  },
  {
    id: 'yellow_side_street_base_edge',
    role: 'side_plane_street_base',
    family: 'side_depth_axis',
    seed: [[291, 557], [444, 546]],
    max_angle_deg: 1.2,
    max_offset_px: 3
  },
  {
    id: 'yellow_primary_upper_window_band_edge',
    role: 'primary_upper_window_band_axis',
    family: 'primary_facade_width_axis',
    seed: [[457, 235], [752, 244]],
    max_angle_deg: 1.2,
    max_offset_px: 3,
    evidence_only: true
  },
  {
    id: 'yellow_primary_storefront_lintel_edge',
    role: 'primary_storefront_lintel_axis',
    family: 'primary_facade_width_axis',
    seed: [[448, 467], [762, 470]],
    max_angle_deg: 1.2,
    max_offset_px: 3,
    evidence_only: true
  },
  {
    id: 'yellow_roof_back_parapet_edge',
    role: 'roof_back_parapet_edge',
    family: 'roof_depth_axis_partial',
    seed: [[532, 62], [760, 138]],
    max_angle_deg: 1.2,
    max_offset_px: 3,
    evidence_only: true
  },
  {
    id: 'yellow_roof_left_depth_edge',
    role: 'roof_left_depth_edge',
    family: 'side_depth_axis',
    seed: [[444, 88], [532, 62]],
    max_angle_deg: 1.2,
    max_offset_px: 3,
    evidence_only: true
  }
];

function normalizeProjectionConfig(config = {}) {
  return {
    kind: config.kind || BUILDING_SINGLE_STRUCTURAL_PROJECTION_KIND,
    reference_size: config.reference_size || REFERENCE_SIZE,
    deterministic_backend: config.deterministic_backend || STRUCTURAL_BACKEND,
    line_evidence_source_stage: config.line_evidence_source_stage || 'building_single_structural_projection_line_fit',
    plane_evidence_source_stage: config.plane_evidence_source_stage || 'building_single_structural_projection_line_intersections',
    graph_attachment_key: config.graph_attachment_key || 'building_single_structural_projection_v1',
    graph_attachment_source: config.graph_attachment_source || 'structural-projection.json',
    method: config.method || {
      summary: 'Fit structural facade lines before naming building_single planes.',
      steps: [
        'Use bounded structural line hypotheses as search windows.',
        'Score candidate lines against local Sobel gradient support.',
        'Reject stronger texture or lighting lines when they break plane topology.',
        'Build visible facade planes from structural line intersections.',
        'Estimate vanishing points and horizon from structural line families.',
        'Keep all output review-gated until accepted structural projection review.'
      ]
    },
    line_hints: config.line_hints || LINE_HINTS,
    planes: config.planes || YELLOW_BUILDING_STRUCTURAL_PROJECTION_CONFIG.planes,
    plan_projection: config.plan_projection || YELLOW_BUILDING_STRUCTURAL_PROJECTION_CONFIG.plan_projection
  };
}

function isStructuralProjection(projection) {
  return projection?.kind === YELLOW_BUILDING_STRUCTURAL_PROJECTION_KIND
    || projection?.kind === BUILDING_SINGLE_STRUCTURAL_PROJECTION_KIND
    || Array.isArray(projection?.planes) && Array.isArray(projection?.lines) && projection?.plan_projection;
}

export const YELLOW_BUILDING_STRUCTURAL_PROJECTION_CONFIG = {
  kind: YELLOW_BUILDING_STRUCTURAL_PROJECTION_KIND,
  reference_size: REFERENCE_SIZE,
  deterministic_backend: STRUCTURAL_BACKEND,
  line_evidence_source_stage: 'yellow_structural_projection_line_fit',
  plane_evidence_source_stage: 'yellow_structural_projection_line_intersections',
  graph_attachment_key: 'yellow_building_structural_projection_v1',
  graph_attachment_source: 'yellow-structural-projection.json',
  method: {
    summary: 'Fit roof, street-base, vertical-corner, and side-depth structural lines before naming facade planes.',
    steps: [
      'Use human-review structural seed lines only as bounded search windows.',
      'Score candidate lines against local Sobel gradient support inside a small offset/angle clamp.',
      'Reject stronger texture, pipe, and shadow lines when they break facade topology.',
      'Build facade and side plane quads from line intersections.',
      'Estimate vanishing points and horizon from structural line families, not from a bbox placeholder.',
      'Encode partial facade recesses as plan topology instead of collapsing the front edge to one straight segment.',
      'Treat dark vertical shadow/recess marks as lighting/material separation unless a reviewed plane edge accepts them.'
    ]
  },
  line_hints: LINE_HINTS,
  planes: [
    {
      id: 'visible_plane_primary',
      role: 'visible_plane_primary',
      normal_hint: 'front_facade_visible_plane',
      structural_roles: [
        'primary_facade_left_corner',
        'primary_facade_roof_edge',
        'primary_facade_right_edge',
        'primary_facade_street_base'
      ],
      lines: {
        left: 'primary_facade_left_corner',
        top: 'primary_facade_roof_edge',
        right: 'primary_facade_right_edge',
        bottom: 'primary_facade_street_base'
      }
    },
    {
      id: 'visible_plane_recessed_left',
      role: 'visible_plane_recessed_left',
      normal_hint: 'left_return_or_recessed_visible_plane',
      structural_roles: [
        'side_plane_left_edge',
        'side_plane_roof_edge',
        'primary_facade_left_corner',
        'side_plane_street_base'
      ],
      lines: {
        left: 'side_plane_left_edge',
        top: 'side_plane_roof_edge',
        right: 'primary_facade_left_corner',
        bottom: 'side_plane_street_base'
      }
    }
  ],
  plan_projection: {
    id: 'yellow_relative_plan_projection',
    depth_ratio_lines: {
      width: 'primary_facade_roof_edge',
      depth: 'side_plane_roof_edge'
    },
    source_line_ids: [
      'yellow_primary_roof_front_edge',
      'yellow_side_roof_front_edge',
      'yellow_primary_street_base_edge',
      'yellow_side_street_base_edge'
    ],
    front_recess: {
      id: 'yellow_left_front_recess_notch',
      kind: 'facade_local_setback',
      topology: 'left_front_recess_notch',
      start_x_ratio: 0.31,
      end_x_ratio: 1,
      depth_to_width_ratio: 0.18,
      recessed_edge_id: 'AB',
      return_edge_id: 'BC',
      main_front_edge_id: 'CD',
      source_line_ids: [
        'yellow_primary_left_corner_vertical',
        'yellow_primary_street_base_edge',
        'yellow_primary_storefront_lintel_edge',
        'yellow_primary_upper_window_band_edge'
      ],
      evidence_summary: 'Accepted topology review: A-B is the recessed left segment, B-C is the return/depth edge, and C-D is the main street/front edge. Exact setback depth remains review-only.',
      support_score: 0.54,
      review_status: 'needs_review'
    }
  }
};

export async function buildYellowBuildingStructuralProjection({
  sourceImagePath,
  sourceImage = null,
  semanticEvidence = null,
  targetWidth = null,
  targetHeight = null
} = {}) {
  return buildBuildingSingleStructuralProjection({
    sourceImagePath,
    sourceImage,
    semanticEvidence,
    targetWidth,
    targetHeight,
    config: YELLOW_BUILDING_STRUCTURAL_PROJECTION_CONFIG
  });
}

export async function buildBuildingSingleStructuralProjection({
  sourceImagePath,
  sourceImage = null,
  semanticEvidence = null,
  targetWidth = null,
  targetHeight = null,
  config = {}
} = {}) {
  if (!sourceImagePath) throw new Error('sourceImagePath is required');
  const projectionConfig = normalizeProjectionConfig(config);
  const resolvedImagePath = path.isAbsolute(sourceImagePath)
    ? sourceImagePath
    : path.resolve(repoRoot, sourceImagePath);
  const raster = await loadRaster(resolvedImagePath, { targetWidth, targetHeight });
  const fittedLines = projectionConfig.line_hints.map((hint) => fitLineHint({
    hint,
    raster,
    referenceSize: projectionConfig.reference_size,
    sourceStage: projectionConfig.deterministic_backend
  }));
  const byRole = new Map(fittedLines.map((line) => [line.role, line]));
  const rawPlanes = projectionConfig.planes.map((planeSpec) => planeFromLines({
    id: planeSpec.id,
    role: planeSpec.role,
    sourceImage,
    lineIds: planeSpec.structural_roles,
    left: byRole.get(planeSpec.lines.left),
    top: byRole.get(planeSpec.lines.top),
    right: byRole.get(planeSpec.lines.right),
    bottom: byRole.get(planeSpec.lines.bottom),
    normalHint: planeSpec.normal_hint
  }));
  const [primaryPlane, sidePlane] = rawPlanes;
  const planProjection = buildPlanProjection({ primaryPlane, sidePlane, fittedLines, config: projectionConfig });
  const vanishing = buildVanishingModel({ fittedLines, raster });
  const shadowDecision = buildShadowLightingDecision({ raster, sourceImage, primaryPlane, sidePlane });
  const planes = rawPlanes.map((plane) => ({
    ...plane,
    projection: {
      kind: 'plane_local_unit_projection',
      coordinate_convention: 'u_right_v_down',
      image_to_local_homography: homographyFromQuadToUnitSquare(plane.visible_quad_px),
      local_quad: [[0, 0], [1, 0], [1, 1], [0, 1]]
    }
  }));
  const qa = structuralProjectionQa({ lines: fittedLines, planes, vanishing, shadowDecision });
  return {
    kind: projectionConfig.kind,
    version: 1,
    coordinate_convention: 'image_x_right_y_down',
    source_image: sourceImage || toRepoRelative(resolvedImagePath),
    image_size: { width: raster.width, height: raster.height },
    deterministic_backend: projectionConfig.deterministic_backend,
    line_evidence_source_stage: projectionConfig.line_evidence_source_stage,
    plane_evidence_source_stage: projectionConfig.plane_evidence_source_stage,
    graph_attachment_key: projectionConfig.graph_attachment_key,
    graph_attachment_source: projectionConfig.graph_attachment_source,
    method: projectionConfig.method,
    line_hints: projectionConfig.line_hints.map((hint) => ({
      id: hint.id,
      role: hint.role,
      family: hint.family,
      seed_line_px: scaleLine(hint.seed, raster.width, raster.height, projectionConfig.reference_size),
      max_angle_deg: hint.max_angle_deg,
      max_offset_px: hint.max_offset_px,
      evidence_only: hint.evidence_only === true
    })),
    lines: fittedLines,
    line_families: lineFamilies({ fittedLines, vanishing }),
    vanishing,
    planes,
    plan_projection: planProjection,
    shadow_lighting_decisions: [shadowDecision],
    semantic_region_comparison: semanticRegionComparison({ semanticEvidence, planes }),
    qa
  };
}

export function augmentStructureEvidenceGraphWithYellowProjection(graph = null, projection = null) {
  return augmentStructureEvidenceGraphWithStructuralProjection(graph, projection);
}

export function augmentStructureEvidenceGraphWithStructuralProjection(graph = null, projection = null) {
  if (!graph || !isStructuralProjection(projection)) return graph;
  const lineEvidenceSourceStage = projection.line_evidence_source_stage || 'building_single_structural_projection_line_fit';
  const planeEvidenceSourceStage = projection.plane_evidence_source_stage || 'building_single_structural_projection_line_intersections';
  const graphAttachmentKey = projection.graph_attachment_key || 'building_single_structural_projection_v1';
  const graphAttachmentSource = projection.graph_attachment_source || 'structural-projection.json';
  const projectedEdges = projection.lines.map((line) => ({
    id: line.id,
    source_image: projection.source_image,
    line_px: line.fitted_line_px,
    class: line.role,
    source_stage: lineEvidenceSourceStage,
    support_score: line.support_score,
    rejection_reason: line.review_status === 'accepted_for_draft' ? null : line.rejection_reason,
    review_status: line.review_status
  }));
  const projectedPlanes = projection.planes.map((plane) => ({
    id: `plane_${plane.id}_yellow_structural_projection`,
    role: plane.role,
    source_image: projection.source_image,
    source_evidence_id: plane.id,
    visible_quad_px: plane.visible_quad_px,
    bbox_px: bboxFromQuad(plane.visible_quad_px),
    confidence: plane.support_score,
    support_score: plane.support_score,
    source_stage: planeEvidenceSourceStage,
    rejection_reason: null,
    review_status: 'accepted_for_draft',
    promotion_allowed: false
  }));
  const existingEdges = (graph.edge_evidence || [])
    .filter((edge) => edge.source_stage !== lineEvidenceSourceStage);
  const existingPlanes = (graph.plane_hypotheses || [])
    .filter((plane) => !['visible_plane_primary', 'visible_plane_recessed_left'].includes(plane.role));
  const edgeEvidence = [...projectedEdges, ...existingEdges];
  const planeHypotheses = [...projectedPlanes, ...existingPlanes];
  const cornerEvidence = [
    ...projection.planes.flatMap((plane) => plane.visible_quad_px.map((point, index) => ({
      id: `${plane.id}_yellow_structural_corner_${index + 1}`,
      source_image: projection.source_image,
      point_px: point.map((value) => round(value)),
      source_evidence_ids: [`plane_${plane.id}_yellow_structural_projection`],
      support_score: plane.support_score,
      rejection_reason: null,
      review_status: 'accepted_for_draft'
    }))),
    ...(graph.corner_evidence || []).filter((corner) => !/_yellow_structural_corner_/u.test(corner.id))
  ];
  const viewAxisHypotheses = (graph.view_axis_hypotheses || []).map((axis) => {
    if (axis.source_image !== projection.source_image) return axis;
    return {
      ...axis,
      primary_axis_hint: 'primary_facade_width_axis',
      secondary_axis_hint: 'side_depth_axis',
      vanishing_point_px: projection.vanishing.primary_facade_vanishing_point_px,
      secondary_vanishing_point_px: projection.vanishing.side_depth_vanishing_point_px,
      horizon_line_px: projection.vanishing.horizon_line_px,
      support_score: projection.vanishing.support_score,
      rejection_reason: null,
      review_status: 'accepted_for_draft',
      axis_fit_source: lineEvidenceSourceStage
    };
  });
  const qa = {
    ...(graph.qa || {}),
    ok: true,
    verdict: 'review',
    edge_evidence_count: edgeEvidence.length,
    corner_evidence_count: cornerEvidence.length,
    plane_hypothesis_count: planeHypotheses.length,
    silhouette_profile_count: graph.silhouette_profiles?.length || 0,
    view_axis_hypothesis_count: viewAxisHypotheses.length,
    accepted_or_review_edge_count: edgeEvidence.filter((edge) => edge.review_status !== 'rejected').length,
    rejected_edge_count: edgeEvidence.filter((edge) => edge.review_status === 'rejected').length,
    default_heavy_model_required: false,
    issues: [
      ...((graph.qa?.issues || []).filter((issue) => issue.rule_id !== 'structure_evidence.few_structural_edges')),
      {
        severity: 'info',
        rule_id: `${graphAttachmentKey}.line_fit_available`,
        message: 'Building structural lines, facade planes, and relative plan projection are available for review.'
      }
    ]
  };
  const next = {
    ...graph,
    default_backends: uniqueStrings([...(graph.default_backends || []), projection.deterministic_backend || STRUCTURAL_BACKEND]),
    edge_evidence: edgeEvidence,
    corner_evidence: cornerEvidence,
    plane_hypotheses: planeHypotheses,
    view_axis_hypotheses: viewAxisHypotheses,
    qa,
    [graphAttachmentKey]: {
      source: graphAttachmentSource,
      status: projection.qa.status,
      plane_ids: projection.planes.map((plane) => plane.id),
      plan_projection_id: projection.plan_projection.id
    }
  };
  if (graphAttachmentKey !== 'yellow_building_structural_projection_v1' && projection.kind === YELLOW_BUILDING_STRUCTURAL_PROJECTION_KIND) {
    next.yellow_building_structural_projection_v1 = next[graphAttachmentKey];
  }
  return next;
}

export function facadePlaneGraphFromYellowProjection(baseGraph = null, projection = null) {
  return facadePlaneGraphFromStructuralProjection(baseGraph, projection);
}

export function facadePlaneGraphFromStructuralProjection(baseGraph = null, projection = null) {
  if (!baseGraph || !isStructuralProjection(projection)) return baseGraph;
  const graphAttachmentKey = projection.graph_attachment_key || 'building_single_structural_projection_v1';
  const graphAttachmentSource = projection.graph_attachment_source || 'structural-projection.json';
  const projectionByRole = new Map(projection.planes.map((plane) => [plane.role, plane]));
  const basePlanes = baseGraph.planes?.length ? baseGraph.planes : projection.planes.map((plane) => ({
    id: plane.id,
    role: plane.role,
    source_image: projection.source_image,
    view: 'oblique',
    visible_quad_px: plane.visible_quad_px,
    visible_bbox_px: bboxFromQuad(plane.visible_quad_px),
    orientation_hint: {},
    adjacency: [],
    occlusion_order: { rank: 1, relation_to_camera: 'unknown', review_required: true },
    must_not_merge_with: [],
    source: { kind: 'local_cv_proposal', semantic_evidence_id: plane.id, confidence: plane.support_score },
    review_required: true,
    promotion_allowed: false
  }));
  const planes = basePlanes.map((plane, index) => {
    const projectionPlane = projectionByRole.get(plane.role);
    if (!projectionPlane) return plane;
    return {
      ...plane,
      source_image: projection.source_image,
      visible_quad_px: projectionPlane.visible_quad_px,
      visible_bbox_px: bboxFromQuad(projectionPlane.visible_quad_px),
      orientation_hint: {
        ...(plane.orientation_hint || {}),
        kind: `${projectionPlane.role}_structural_line_fit_projection`,
        view: 'oblique',
        projection_model: 'line_fit_perspective_projection',
        perspective_strength: 'medium',
        normal_hint: projectionPlane.normal_hint,
        camera_hints: {
          projection_model: projection.line_evidence_source_stage || 'building_single_structural_projection_line_fit',
          vanishing_points: [
            projection.vanishing.primary_facade_vanishing_point_px,
            projection.vanishing.side_depth_vanishing_point_px
          ],
          horizon_line: projection.vanishing.horizon_line_px,
          source_line_ids: projectionPlane.source_line_ids
        },
        confidence: projectionPlane.support_score,
        review_required: true
      },
      source: {
        kind: 'local_cv_proposal',
        semantic_evidence_id: projectionPlane.id,
        source_priority: 5,
        confidence: projectionPlane.support_score,
        derived_from: projectionPlane.source_line_ids
      },
      review_required: true,
      promotion_allowed: false
    };
  });
  const detailCandidates = (baseGraph.plane_local_detail_candidates || []).map((detail) => {
    const projectedDetail = projectedDetailForRole(detail.role, projection);
    return {
      ...detail,
      candidate_plane_ids: candidatePlaneIdsForDetail(detail.role, planes),
      ...(projectedDetail ? {
        visible_quad_px: projectedDetail.visible_quad_px,
        bbox_px: bboxFromQuad(projectedDetail.visible_quad_px),
        attachment_hint: projectedDetail.attachment_hint,
        source: {
          kind: 'local_cv_proposal',
          semantic_evidence_id: detail.source?.semantic_evidence_id || detail.id,
          source_priority: 5,
          confidence: projectedDetail.support_score,
          derived_from: projectedDetail.derived_from
        }
      } : {}),
      blockers: uniqueStrings([
        ...(detail.blockers || []),
        'accepted_structural_projection_review_required'
      ])
    };
  });
  return {
    ...baseGraph,
    source_structure_evidence_graph: 'structure-evidence-graph.json',
    planes,
    plane_local_detail_candidates: detailCandidates,
    review_policy: {
      ...(baseGraph.review_policy || {}),
      status: planes.length ? 'needs_plane_review' : 'blocked_no_visible_planes',
      accepted_plane_review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      review_required: true,
      blockers: uniqueStrings([
        'accepted_structural_projection_review_required',
        ...((baseGraph.review_policy?.blockers || []).filter((blocker) => blocker !== 'visible_plane_evidence_required'))
      ]),
      notes: uniqueStrings([
        ...(baseGraph.review_policy?.notes || []),
        'Visible planes are corrected by structural line intersections before review.',
        'Shadow/recess markers remain plane-local evidence and are not cut geometry.'
      ])
    },
    summary: {
      ...(baseGraph.summary || {}),
      plane_count: planes.length,
      detail_candidate_count: detailCandidates.length,
      visible_plane_ids: planes.map((plane) => plane.id),
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      must_not_merge_pairs: [['visible_plane_primary', 'visible_plane_recessed_left']]
    },
    [graphAttachmentKey]: {
      source: graphAttachmentSource,
      plan_projection_id: projection.plan_projection.id,
      line_fit_status: projection.qa.status
    }
  };
}

export function renderYellowStructuralProjectionOverlaySvg(projection, sourceImagePath) {
  const width = projection.image_size.width;
  const height = projection.image_size.height;
  const dataUrl = projectionImageDataUrl(sourceImagePath);
  const planePolygons = projection.planes.map((plane, index) => polygonSvg({
    points: plane.visible_quad_px,
    fill: index === 0 ? '#2563eb' : '#f97316',
    stroke: index === 0 ? '#2563eb' : '#f97316',
    opacity: 0.18,
    label: `${plane.id} line-fit`
  })).join('\n');
  const lines = projection.lines.map((line) => {
    const color = line.family === 'vertical'
      ? '#22c55e'
      : line.family === 'primary_facade_width_axis'
        ? '#38bdf8'
        : line.family === 'side_depth_axis'
          ? '#f97316'
          : '#a855f7';
    return lineSvg({
      line: line.fitted_line_px,
      color,
      label: `${line.role} score=${line.support_score}`
    });
  }).join('\n');
  const horizon = projection.vanishing.horizon_line_px
    ? lineSvg({ line: projection.vanishing.horizon_line_px, color: '#ef4444', label: 'line-fit horizon' })
    : '';
  const vpMarkers = [
    ['primary VP', projection.vanishing.primary_facade_vanishing_point_px, '#38bdf8'],
    ['side VP', projection.vanishing.side_depth_vanishing_point_px, '#f97316']
  ].map(([label, point, color]) => pointSvg({ point, color, label })).join('\n');
  const legend = `<g>
  <rect x="18" y="18" width="378" height="94" fill="white" fill-opacity="0.86" stroke="#cbd5e1"/>
  <text x="30" y="42" font-size="15" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Yellow structural projection</text>
  <text x="30" y="64" font-size="12" fill="#334155" font-family="Arial, sans-serif">planes from roof/street/vertical line intersections</text>
  <text x="30" y="84" font-size="12" fill="#334155" font-family="Arial, sans-serif">shadow boundary is separator evidence, not cut geometry</text>
  <text x="30" y="104" font-size="12" fill="#334155" font-family="Arial, sans-serif">promotion_allowed=false until accepted review</text>
</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<image href="${dataUrl}" width="${width}" height="${height}"/>
${planePolygons}
${lines}
${horizon}
${vpMarkers}
${legend}
</svg>
`;
}

export function renderYellowFacadeProjectionSvg(projection) {
  const primary = projection.planes.find((plane) => plane.id === 'visible_plane_primary');
  const side = projection.planes.find((plane) => plane.id === 'visible_plane_recessed_left');
  const frontRecess = projection.plan_projection?.recesses?.[0] || null;
  const width = 1040;
  const height = 620;
  const primaryBox = { x: 72, y: 124, w: 520, h: 360 };
  const sideBox = { x: 680, y: 124, w: 260, h: 360 };
  const grid = (box, columns) => {
    const lines = [];
    for (let i = 1; i < columns; i += 1) {
      const x = box.x + box.w * i / columns;
      lines.push(`<line x1="${x}" y1="${box.y}" x2="${x}" y2="${box.y + box.h}" stroke="#cbd5e1" stroke-width="1"/>`);
    }
    for (let i = 1; i < 4; i += 1) {
      const y = box.y + box.h * i / 4;
      lines.push(`<line x1="${box.x}" y1="${y}" x2="${box.x + box.w}" y2="${y}" stroke="#cbd5e1" stroke-width="1"/>`);
    }
  return lines.join('\n');
  };
  const recessX = frontRecess ? primaryBox.x + primaryBox.w * frontRecess.start_x_ratio : null;
  const recessOverlay = frontRecess ? `
  <rect x="${primaryBox.x}" y="${primaryBox.y}" width="${recessX - primaryBox.x}" height="${primaryBox.h}" fill="#fde68a" fill-opacity="0.22" stroke="#d97706" stroke-width="2" stroke-dasharray="7 5"/>
  <line x1="${recessX}" y1="${primaryBox.y}" x2="${recessX}" y2="${primaryBox.y + primaryBox.h}" stroke="#d97706" stroke-width="3"/>
  <text x="${primaryBox.x + 12}" y="${primaryBox.y + 24}" font-size="12" fill="#92400e" font-family="Arial, sans-serif">A-B recessed behind C-D</text>
  <text x="${primaryBox.x + 12}" y="${primaryBox.y + 42}" font-size="11" fill="#92400e" font-family="Arial, sans-serif">B-C return depth=${frontRecess.depth_to_width_ratio}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f8fafc"/>
<text x="48" y="46" font-size="24" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Line-fit Facade Projection</text>
<text x="48" y="72" font-size="14" fill="#475569" font-family="Arial, sans-serif">Primary/side planes and the partial front recess are review artifacts. No SketchUp geometry is promoted.</text>
<g>
  <text x="${primaryBox.x}" y="${primaryBox.y - 18}" font-size="17" font-weight="700" fill="#1d4ed8" font-family="Arial, sans-serif">visible_plane_primary</text>
  <rect x="${primaryBox.x}" y="${primaryBox.y}" width="${primaryBox.w}" height="${primaryBox.h}" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  ${grid(primaryBox, 5)}
  ${recessOverlay}
  <rect x="${primaryBox.x + primaryBox.w * 0.14}" y="${primaryBox.y + primaryBox.h * 0.18}" width="${primaryBox.w * 0.72}" height="${primaryBox.h * 0.12}" fill="#93c5fd" stroke="#1d4ed8"/>
  <rect x="${primaryBox.x + primaryBox.w * 0.14}" y="${primaryBox.y + primaryBox.h * 0.48}" width="${primaryBox.w * 0.72}" height="${primaryBox.h * 0.13}" fill="#93c5fd" stroke="#1d4ed8"/>
  <rect x="${primaryBox.x + primaryBox.w * 0.36}" y="${primaryBox.y + primaryBox.h * 0.72}" width="${primaryBox.w * 0.52}" height="${primaryBox.h * 0.22}" fill="#bfdbfe" stroke="#1d4ed8"/>
  <text x="${primaryBox.x}" y="${primaryBox.y + primaryBox.h + 28}" font-size="12" fill="#334155" font-family="Arial, sans-serif">support=${primary?.support_score ?? 0}; source lines: roof edge, street base, vertical corners</text>
</g>
<g>
  <text x="${sideBox.x}" y="${sideBox.y - 18}" font-size="17" font-weight="700" fill="#c2410c" font-family="Arial, sans-serif">visible_plane_recessed_left</text>
  <rect x="${sideBox.x}" y="${sideBox.y}" width="${sideBox.w}" height="${sideBox.h}" fill="#ffedd5" stroke="#f97316" stroke-width="2"/>
  ${grid(sideBox, 3)}
  <rect x="${sideBox.x + sideBox.w * 0.16}" y="${sideBox.y + sideBox.h * 0.08}" width="${sideBox.w * 0.24}" height="${sideBox.h * 0.72}" fill="#fed7aa" stroke="#c2410c"/>
  <rect x="${sideBox.x + sideBox.w * 0.55}" y="${sideBox.y + sideBox.h * 0.60}" width="${sideBox.w * 0.25}" height="${sideBox.h * 0.16}" fill="#fdba74" stroke="#c2410c"/>
  <text x="${sideBox.x}" y="${sideBox.y + sideBox.h + 28}" font-size="12" fill="#334155" font-family="Arial, sans-serif">support=${side?.support_score ?? 0}; shadow boundary is not depth geometry</text>
</g>
</svg>
`;
}

export function renderYellowPlanProjectionSvg(projection) {
  const width = 920;
  const height = 620;
  const plan = projection.plan_projection;
  const origin = { x: 180, y: 410 };
  const scale = 420;
  const localToSvg = ([x, y]) => [round(origin.x + x * scale), round(origin.y - y * scale)];
  const footprint = plan.footprint_local?.length
    ? plan.footprint_local.map((point) => localToSvg(point.xy))
    : [
        [origin.x, origin.y],
        [origin.x + scale, origin.y],
        [origin.x + scale, origin.y - scale * plan.depth_to_width_ratio],
        [origin.x, origin.y - scale * plan.depth_to_width_ratio]
      ];
  const depth = scale * plan.depth_to_width_ratio;
  const frontRecess = plan.recesses?.[0] || null;
  const polygonToken = footprint.map((point) => point.join(',')).join(' ');
  const frontRecessSvg = frontRecess ? (() => {
    const isLeftNotch = plan.footprint_topology === 'left_front_recess_notch';
    const outerStart = isLeftNotch ? localToSvg([0, frontRecess.depth_to_width_ratio]) : localToSvg([0, 0]);
    const outerStep = isLeftNotch ? localToSvg([frontRecess.start_x_ratio, frontRecess.depth_to_width_ratio]) : localToSvg([frontRecess.start_x_ratio, 0]);
    const innerStep = isLeftNotch ? localToSvg([frontRecess.start_x_ratio, 0]) : localToSvg([frontRecess.start_x_ratio, frontRecess.depth_to_width_ratio]);
    const innerEnd = isLeftNotch ? localToSvg([1, 0]) : localToSvg([frontRecess.end_x_ratio || 1, frontRecess.depth_to_width_ratio]);
    return `
<line x1="${outerStart[0]}" y1="${outerStart[1]}" x2="${outerStep[0]}" y2="${outerStep[1]}" stroke="#2563eb" stroke-width="6"/>
<line x1="${outerStep[0]}" y1="${outerStep[1]}" x2="${innerStep[0]}" y2="${innerStep[1]}" stroke="#d97706" stroke-width="5"/>
<line x1="${innerStep[0]}" y1="${innerStep[1]}" x2="${innerEnd[0]}" y2="${innerEnd[1]}" stroke="#2563eb" stroke-width="5" stroke-dasharray="8 6"/>
<circle cx="${outerStep[0]}" cy="${outerStep[1]}" r="5" fill="#d97706"/>
<circle cx="${innerStep[0]}" cy="${innerStep[1]}" r="5" fill="#d97706"/>
<text x="${innerStep[0] + 12}" y="${innerStep[1] - 42}" font-size="13" fill="#92400e" font-family="Arial, sans-serif">${isLeftNotch ? 'left recess return' : 'front recess step'}</text>
<text x="${innerStep[0] + 12}" y="${innerStep[1] - 23}" font-size="12" fill="#92400e" font-family="Arial, sans-serif">AB behind CD; depth=${frontRecess.depth_to_width_ratio}</text>`;
  })() : `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x + scale}" y2="${origin.y}" stroke="#2563eb" stroke-width="5"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f8fafc"/>
<text x="54" y="54" font-size="24" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Topology-Derived Relative Plan Projection</text>
<text x="54" y="82" font-size="14" fill="#475569" font-family="Arial, sans-serif">The plan is derived from accepted A-B-C-D topology: A-B is set back, B-C returns to the main C-D front edge.</text>
<polygon points="${polygonToken}" fill="#dcfce7" stroke="#16a34a" stroke-width="3"/>
${frontRecessSvg}
<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x}" y2="${origin.y - depth}" stroke="#f97316" stroke-width="5"/>
<text x="${origin.x + scale / 2 - 78}" y="${origin.y + 34}" font-size="15" fill="#1d4ed8" font-family="Arial, sans-serif">front width = 1.000, topology=${escapeXml(plan.footprint_topology || 'unknown')}</text>
<text x="${origin.x - 132}" y="${origin.y - depth / 2}" font-size="15" fill="#c2410c" font-family="Arial, sans-serif">visible depth ratio = ${plan.depth_to_width_ratio}</text>
<circle cx="${origin.x}" cy="${origin.y}" r="5" fill="#111827"/>
<text x="${origin.x + scale + 20}" y="${origin.y + 4}" font-size="13" fill="#334155" font-family="Arial, sans-serif">primary facade right edge</text>
<text x="${origin.x + 12}" y="${origin.y - depth - 14}" font-size="13" fill="#334155" font-family="Arial, sans-serif">inferred rear edge</text>
<g transform="translate(54 480)">
  <rect width="804" height="92" fill="white" stroke="#cbd5e1"/>
  <text x="18" y="28" font-size="14" font-weight="700" fill="#111827" font-family="Arial, sans-serif">Plan policy</text>
  <text x="18" y="52" font-size="13" fill="#475569" font-family="Arial, sans-serif">front_edge_policy=${escapeXml(plan.front_edge_policy || 'unknown')}; relative_only=true; no metric scale</text>
  <text x="18" y="74" font-size="13" fill="#475569" font-family="Arial, sans-serif">no hidden geometry or SketchUp promotion without accepted structural review</text>
</g>
</svg>
`;
}

export function renderYellowStructuralMethodologyMarkdown(projection) {
  return `# Yellow Building Structural Projection Method

- kind: \`${projection.kind}\`
- backend: \`${projection.deterministic_backend}\`
- status: \`${projection.qa.status}\`
- support: \`${projection.qa.support_score}\`
- promotion_allowed: \`false\`

## Method

${projection.method.steps.map((step) => `- ${step}`).join('\n')}

## Structural Lines

| id | role | family | support | fit |
| --- | --- | --- | --- | --- |
${projection.lines.map((line) => `| ${line.id} | ${line.role} | ${line.family} | ${line.support_score} | ${pointToken(line.fitted_line_px.a)} -> ${pointToken(line.fitted_line_px.b)} |`).join('\n')}

## Planes

| id | support | quad |
| --- | --- | --- |
${projection.planes.map((plane) => `| ${plane.id} | ${plane.support_score} | ${quadToken(plane.visible_quad_px)} |`).join('\n')}

## Plan Projection

- depth_to_width_ratio: \`${projection.plan_projection.depth_to_width_ratio}\`
- footprint_topology: \`${projection.plan_projection.footprint_topology || 'unknown'}\`
- front_edge_policy: \`${projection.plan_projection.front_edge_policy || 'unknown'}\`
- footprint_point_count: \`${projection.plan_projection.footprint_local?.length || 0}\`
- scale_status: \`${projection.plan_projection.scale_status}\`
- review_required: \`${String(projection.plan_projection.review_required)}\`
${(projection.plan_projection.recesses || []).map((recess) => `- recess ${recess.id}: start=\`${recess.start_x_ratio}\`, depth=\`${recess.depth_to_width_ratio}\`, status=\`${recess.review_status}\``).join('\n')}

## Shadow / Lighting

${projection.shadow_lighting_decisions.map((decision) => `- ${decision.id}: \`${decision.classification}\` (${decision.geometry_policy})`).join('\n')}
`;
}

async function loadRaster(imagePath, { targetWidth = null, targetHeight = null } = {}) {
  let pipeline = sharp(imagePath);
  if (targetWidth || targetHeight) {
    pipeline = pipeline.resize({
      width: targetWidth ? Math.round(Number(targetWidth)) : undefined,
      height: targetHeight ? Math.round(Number(targetHeight)) : undefined,
      fit: 'fill'
    });
  }
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(info.width * info.height);
  for (let index = 0, pixel = 0; index < data.length; index += info.channels, pixel += 1) {
    gray[pixel] = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
  }
  const gradient = sobelMagnitude(gray, info.width, info.height);
  return {
    path: imagePath,
    data,
    channels: info.channels,
    width: info.width,
    height: info.height,
    gray,
    gradient
  };
}

function sobelMagnitude(gray, width, height) {
  const gradient = new Float32Array(width * height);
  const sample = (x, y) => gray[y * width + x] || 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx = -sample(x - 1, y - 1) - 2 * sample(x - 1, y) - sample(x - 1, y + 1)
        + sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1);
      const gy = -sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1)
        + sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1);
      gradient[y * width + x] = Math.hypot(gx, gy);
    }
  }
  return gradient;
}

function fitLineHint({ hint, raster, referenceSize = REFERENCE_SIZE, sourceStage = STRUCTURAL_BACKEND }) {
  const seedLine = scaleLine(hint.seed, raster.width, raster.height, referenceSize);
  const [seedA, seedB] = [seedLine.a, seedLine.b];
  const dx = seedB[0] - seedA[0];
  const dy = seedB[1] - seedA[1];
  const length = Math.hypot(dx, dy);
  const center = [(seedA[0] + seedB[0]) / 2, (seedA[1] + seedB[1]) / 2];
  const seedAngle = Math.atan2(dy, dx);
  let best = null;
  for (let angleOffset = -hint.max_angle_deg; angleOffset <= hint.max_angle_deg + 1e-9; angleOffset += 0.25) {
    const angle = seedAngle + angleOffset * Math.PI / 180;
    const unit = [Math.cos(angle), Math.sin(angle)];
    const normal = [-unit[1], unit[0]];
    for (let offset = -hint.max_offset_px; offset <= hint.max_offset_px + 1e-9; offset += 0.75) {
      const candidateCenter = [
        center[0] + normal[0] * offset,
        center[1] + normal[1] * offset
      ];
      const candidate = {
        a: [
          candidateCenter[0] - unit[0] * length / 2,
          candidateCenter[1] - unit[1] * length / 2
        ],
        b: [
          candidateCenter[0] + unit[0] * length / 2,
          candidateCenter[1] + unit[1] * length / 2
        ]
      };
      const support = lineGradientSupport(candidate, raster);
      const topologyPenalty = Math.abs(angleOffset) * 2 + Math.abs(offset) * 0.7;
      const value = support.average_gradient + support.hit_ratio * 80 - topologyPenalty;
      if (!best || value > best.value) {
        best = { candidate, support, value, angle_deg: angle * 180 / Math.PI, offset_px: offset };
      }
    }
  }
  const supportScore = supportScoreForLine(best.support);
  return {
    id: hint.id,
    role: hint.role,
    family: hint.family,
    seed_line_px: seedLine,
    fitted_line_px: {
      a: best.candidate.a.map((value) => round(value)),
      b: best.candidate.b.map((value) => round(value))
    },
    fit_window: {
      max_angle_deg: hint.max_angle_deg,
      max_offset_px: hint.max_offset_px,
      selected_angle_deg: round(best.angle_deg),
      selected_offset_px: round(best.offset_px)
    },
    support: {
      average_gradient: round(best.support.average_gradient),
      hit_ratio: round(best.support.hit_ratio),
      sample_count: best.support.sample_count
    },
    support_score: supportScore,
    source_stage: sourceStage,
    evidence_only: hint.evidence_only === true,
    rejection_reason: supportScore < 0.42 ? 'weak_sobel_support_in_structural_search_window' : null,
    review_status: supportScore < 0.42 ? 'needs_review' : 'accepted_for_draft'
  };
}

function lineGradientSupport(line, raster) {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const unit = [dx / length, dy / length];
  const normal = [-unit[1], unit[0]];
  let total = 0;
  let hits = 0;
  let samples = 0;
  for (let t = 0; t <= length; t += 1.2) {
    const x = line.a[0] + unit[0] * t;
    const y = line.a[1] + unit[1] * t;
    let best = 0;
    for (let offset = -1; offset <= 1; offset += 1) {
      const px = Math.round(x + normal[0] * offset);
      const py = Math.round(y + normal[1] * offset);
      if (px < 1 || py < 1 || px >= raster.width - 1 || py >= raster.height - 1) continue;
      best = Math.max(best, raster.gradient[py * raster.width + px] || 0);
    }
    total += best;
    if (best >= 75) hits += 1;
    samples += 1;
  }
  return {
    average_gradient: samples ? total / samples : 0,
    hit_ratio: samples ? hits / samples : 0,
    sample_count: samples
  };
}

function planeFromLines({ id, role, sourceImage, lineIds, left, top, right, bottom, normalHint }) {
  const topLeft = intersectLines(left.fitted_line_px, top.fitted_line_px);
  const topRight = intersectLines(right.fitted_line_px, top.fitted_line_px);
  const bottomRight = intersectLines(right.fitted_line_px, bottom.fitted_line_px);
  const bottomLeft = intersectLines(left.fitted_line_px, bottom.fitted_line_px);
  const sourceLines = [left, top, right, bottom];
  const support = round(sourceLines.reduce((sum, line) => sum + line.support_score, 0) / sourceLines.length);
  return {
    id,
    role,
    source_image: sourceImage,
    visible_quad_px: [topLeft, topRight, bottomRight, bottomLeft].map((point) => point.map((value) => round(value))),
    source_line_ids: sourceLines.map((line) => line.id),
    structural_roles: lineIds,
    support_score: support,
    review_status: support >= 0.5 ? 'accepted_for_draft' : 'needs_review',
    review_required: true,
    promotion_allowed: false,
    normal_hint: normalHint,
    geometry_policy: 'reviewable_projection_only_no_partgraph_promotion'
  };
}

function buildPlanProjection({ primaryPlane, sidePlane, fittedLines, config = {} }) {
  const ratioLines = config.plan_projection?.depth_ratio_lines || {};
  const primaryTop = lineLengthByRole(fittedLines, ratioLines.width || 'primary_facade_roof_edge');
  const sideTop = lineLengthByRole(fittedLines, ratioLines.depth || 'side_plane_roof_edge');
  const rawRatio = primaryTop > 0 ? sideTop / primaryTop : 0.5;
  const depthToWidthRatio = round(clamp(rawRatio, 0.34, 0.72));
  const frontRecess = buildFrontRecess(config.plan_projection?.front_recess, depthToWidthRatio);
  const leftNotch = frontRecess?.topology === 'left_front_recess_notch';
  const footprintLocal = leftNotch ? [
    { id: 'A_recessed_left_front', xy: [0, frontRecess.depth_to_width_ratio], source: 'corner_chain_A' },
    { id: 'B_inner_recess_corner', xy: [frontRecess.start_x_ratio, frontRecess.depth_to_width_ratio], source: 'corner_chain_B' },
    { id: 'C_main_front_return_corner', xy: [frontRecess.start_x_ratio, 0], source: 'corner_chain_C' },
    { id: 'D_main_front_right_corner', xy: [1, 0], source: 'corner_chain_D' },
    { id: 'back_right_inferred', xy: [1, depthToWidthRatio], source: 'parallel_depth_inferred_from_side_plane' },
    { id: 'back_left_inferred', xy: [0, depthToWidthRatio], source: 'parallel_depth_inferred_from_side_plane' }
  ] : frontRecess ? [
    { id: 'front_left_outer_corner', xy: [0, 0], source: 'visible_plane_primary.bottom_left' },
    { id: 'front_recess_step_outer', xy: [frontRecess.start_x_ratio, 0], source: frontRecess.id },
    { id: 'front_recess_step_inner', xy: [frontRecess.start_x_ratio, frontRecess.depth_to_width_ratio], source: frontRecess.id },
    { id: 'recessed_front_right', xy: [1, frontRecess.depth_to_width_ratio], source: 'visible_plane_primary.recessed_front_edge' },
    { id: 'back_right_inferred', xy: [1, depthToWidthRatio], source: 'parallel_depth_inferred_from_side_plane' },
    { id: 'back_left_visible', xy: [0, depthToWidthRatio], source: 'visible_plane_recessed_left.depth_edge' }
  ] : [
    { id: 'front_left_corner', xy: [0, 0], source: 'visible_plane_primary.bottom_left' },
    { id: 'front_right_corner', xy: [1, 0], source: 'visible_plane_primary.bottom_right' },
    { id: 'back_right_inferred', xy: [1, depthToWidthRatio], source: 'parallel_depth_inferred_from_side_plane' },
    { id: 'back_left_visible', xy: [0, depthToWidthRatio], source: 'visible_plane_recessed_left.depth_edge' }
  ];
  const footprintTopology = leftNotch
    ? 'left_front_recess_notch'
    : frontRecess
      ? 'stepped_recessed_front_facade'
      : 'rectangular_visible_mass';
  const frontEdgePolicy = leftNotch
    ? 'main_front_edge_CD_with_left_recess_AB_behind'
    : frontRecess
      ? 'not_single_straight_line'
      : 'single_straight_line';
  return {
    id: config.plan_projection?.id || 'building_single_relative_plan_projection',
    kind: 'normalized_footprint_projection_v1',
    coordinate_convention: 'front_width_1_depth_relative_y_positive_back',
    footprint_topology: footprintTopology,
    front_edge_policy: frontEdgePolicy,
    footprint_local: footprintLocal,
    outer_mass_reference_local: [
      { id: 'outer_front_left', xy: [0, 0], source: 'outer_reference_only' },
      { id: 'outer_front_right', xy: [1, 0], source: 'outer_reference_only' },
      { id: 'outer_back_right', xy: [1, depthToWidthRatio], source: 'outer_reference_only' },
      { id: 'outer_back_left', xy: [0, depthToWidthRatio], source: 'outer_reference_only' }
    ],
    recesses: frontRecess ? [frontRecess] : [],
    visible_plane_ids: [primaryPlane.id, sidePlane.id],
    depth_to_width_ratio: depthToWidthRatio,
    scale_status: 'relative_only_no_metric_scale',
    source_line_ids: uniqueStrings([
      ...((config.plan_projection?.source_line_ids || [ratioLines.width, ratioLines.depth]).filter(Boolean)),
      ...((frontRecess?.source_line_ids || []))
    ]),
    depth_order: leftNotch ? [{ behind: 'AB', in_front: 'CD', evidence: ['corner_chain_A_B_C_D_review_truth'] }] : [],
    inferred_hidden_edges: ['back_right_inferred', ...(leftNotch ? ['back_left_inferred'] : frontRecess ? ['recessed_front_right_depth_review_required'] : [])],
    review_required: true,
    promotion_allowed: false
  };
}

function buildFrontRecess(recessConfig, depthToWidthRatio) {
  if (!recessConfig) return null;
  const start = round(clamp(Number(recessConfig.start_x_ratio ?? 0.32), 0.08, 0.82));
  const end = round(clamp(Number(recessConfig.end_x_ratio ?? 1), start + 0.05, 1));
  const maxDepth = Math.max(0.035, Math.min(0.22, depthToWidthRatio - 0.08));
  const recessDepth = round(clamp(Number(recessConfig.depth_to_width_ratio ?? 0.1), 0.035, maxDepth));
  return {
    id: recessConfig.id || 'front_facade_partial_recess',
    kind: recessConfig.kind || 'facade_local_setback',
    topology: recessConfig.topology || 'stepped_front_edge_recess',
    start_x_ratio: start,
    end_x_ratio: end,
    depth_to_width_ratio: recessDepth,
    affected_front_segment: [start, end],
    ...(recessConfig.recessed_edge_id ? { recessed_edge_id: recessConfig.recessed_edge_id } : {}),
    ...(recessConfig.return_edge_id ? { return_edge_id: recessConfig.return_edge_id } : {}),
    ...(recessConfig.main_front_edge_id ? { main_front_edge_id: recessConfig.main_front_edge_id } : {}),
    source_line_ids: recessConfig.source_line_ids || [],
    evidence_summary: recessConfig.evidence_summary || 'Partial front setback is review-gated plan topology.',
    support_score: round(clamp(Number(recessConfig.support_score ?? 0.5), 0, 1)),
    review_status: recessConfig.review_status || 'needs_review',
    review_required: true,
    promotion_allowed: false
  };
}

function buildVanishingModel({ fittedLines, raster }) {
  const primaryLines = byFamily(fittedLines, 'primary_facade_width_axis')
    .filter((line) => !line.evidence_only || /window|storefront|roof|street/u.test(line.role));
  const sideLines = byFamily(fittedLines, 'side_depth_axis');
  const primaryVp = vanishingPointFromLines(primaryLines);
  const sideVp = vanishingPointFromLines(sideLines);
  const horizon = primaryVp && sideVp
    ? clippedLineThroughPoints(primaryVp.point_px, sideVp.point_px, raster.width, raster.height)
    : null;
  const supportScore = round(((primaryVp?.support_score || 0) + (sideVp?.support_score || 0)) / 2);
  return {
    status: primaryVp && sideVp ? 'estimated_from_structural_line_families' : 'needs_review',
    primary_facade_vanishing_point_px: primaryVp?.point_px || null,
    side_depth_vanishing_point_px: sideVp?.point_px || null,
    horizon_line_px: horizon,
    support_score: supportScore,
    source_line_families: [
      {
        id: 'primary_facade_width_axis',
        line_ids: primaryLines.map((line) => line.id),
        support_score: primaryVp?.support_score || 0
      },
      {
        id: 'side_depth_axis',
        line_ids: sideLines.map((line) => line.id),
        support_score: sideVp?.support_score || 0
      }
    ],
    rejected_legacy_placeholder: {
      projection_model: 'weak_oblique_affine_review_only',
      horizon_line_px: { a: [0, round(raster.height * 0.28)], b: [raster.width, round(raster.height * 0.28)] },
      reason: 'bbox_placeholder_not_supported_by_roof_street_or_window_line_families'
    }
  };
}

function buildShadowLightingDecision({ raster, sourceImage, primaryPlane, sidePlane }) {
  const boundary = {
    a: primaryPlane.visible_quad_px[0],
    b: primaryPlane.visible_quad_px[3]
  };
  const contrast = lineSideLuminanceContrast({ raster, line: boundary, offset: 10 });
  return {
    id: 'yellow_shadow_recess_boundary_decision',
    source_image: sourceImage,
    boundary_line_px: {
      a: boundary.a.map((value) => round(value)),
      b: boundary.b.map((value) => round(value))
    },
    candidate_plane_ids: [sidePlane.id, primaryPlane.id],
    classification: 'lighting_or_material_boundary_between_planes',
    geometry_policy: 'separator_evidence_only_not_cut_recess_geometry',
    luminance_left_mean: contrast.left_mean,
    luminance_right_mean: contrast.right_mean,
    absolute_luminance_delta: contrast.delta,
    support_score: round(clamp(contrast.delta / 55, 0.38, 0.86)),
    review_required: true,
    promotion_allowed: false
  };
}

function structuralProjectionQa({ lines, planes, vanishing, shadowDecision }) {
  const primary = planes.find((plane) => plane.id === 'visible_plane_primary');
  const side = planes.find((plane) => plane.id === 'visible_plane_recessed_left');
  const lineSupport = lines.reduce((sum, line) => sum + line.support_score, 0) / Math.max(1, lines.length);
  const planeSupport = planes.reduce((sum, plane) => sum + plane.support_score, 0) / Math.max(1, planes.length);
  const supportScore = round((lineSupport * 0.45) + (planeSupport * 0.35) + ((vanishing.support_score || 0) * 0.2));
  const issues = [];
  if (!primary || primary.support_score < 0.5) issues.push({ severity: 'warn', rule_id: 'yellow_projection.primary_plane_weak', message: 'Primary facade projection support is weak.' });
  if (!side || side.support_score < 0.5) issues.push({ severity: 'warn', rule_id: 'yellow_projection.side_plane_weak', message: 'Side/recessed plane projection support is weak.' });
  if (!vanishing.primary_facade_vanishing_point_px || !vanishing.side_depth_vanishing_point_px) issues.push({ severity: 'warn', rule_id: 'yellow_projection.vanishing_fit_incomplete', message: 'Vanishing families could not both be estimated.' });
  if (shadowDecision.geometry_policy !== 'separator_evidence_only_not_cut_recess_geometry') issues.push({ severity: 'warn', rule_id: 'yellow_projection.shadow_policy_missing', message: 'Shadow boundary is not explicitly blocked from geometry cuts.' });
  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    status: issues.length ? 'projection_review_ready_with_warnings' : 'projection_review_ready',
    support_score: supportScore,
    line_count: lines.length,
    plane_count: planes.length,
    false_promotion_count: 0,
    review_required: true,
    promotion_allowed: false,
    compile_allowed: false,
    issues
  };
}

function semanticRegionComparison({ semanticEvidence, planes }) {
  if (!semanticEvidence) return [];
  const semanticPlanes = [];
  for (const image of semanticEvidence.images || []) {
    for (const region of image.regions || []) {
      if (!['visible_plane_primary', 'visible_plane_recessed_left'].includes(region.role)) continue;
      semanticPlanes.push(region);
    }
  }
  return planes.map((plane) => {
    const semantic = semanticPlanes.find((region) => region.role === plane.role);
    return {
      role: plane.role,
      semantic_bbox_px: semantic?.bbox_px || null,
      structural_bbox_px: bboxFromQuad(plane.visible_quad_px),
      policy: semantic ? 'semantic_region_used_as_weak_search_context_not_final_plane' : 'no_semantic_region',
      review_required: true
    };
  });
}

function lineFamilies({ fittedLines, vanishing }) {
  return [
    {
      id: 'primary_facade_width_axis',
      role: 'front_facade_horizontal_line_family',
      line_ids: byFamily(fittedLines, 'primary_facade_width_axis').map((line) => line.id),
      vanishing_point_px: vanishing.primary_facade_vanishing_point_px,
      support_score: vanishing.source_line_families?.[0]?.support_score || 0,
      review_status: 'accepted_for_draft'
    },
    {
      id: 'side_depth_axis',
      role: 'left_return_depth_line_family',
      line_ids: byFamily(fittedLines, 'side_depth_axis').map((line) => line.id),
      vanishing_point_px: vanishing.side_depth_vanishing_point_px,
      support_score: vanishing.source_line_families?.[1]?.support_score || 0,
      review_status: 'accepted_for_draft'
    },
    {
      id: 'vertical',
      role: 'building_vertical_line_family',
      line_ids: byFamily(fittedLines, 'vertical').map((line) => line.id),
      vanishing_point_px: null,
      support_score: round(byFamily(fittedLines, 'vertical').reduce((sum, line) => sum + line.support_score, 0) / Math.max(1, byFamily(fittedLines, 'vertical').length)),
      review_status: 'accepted_for_draft'
    }
  ];
}

function vanishingPointFromLines(lines) {
  const usable = lines
    .filter((line) => line.support_score >= 0.42)
    .map((line) => normalizedLineEquation(line.fitted_line_px));
  if (usable.length < 2) return null;
  let a00 = 0;
  let a01 = 0;
  let a11 = 0;
  let b0 = 0;
  let b1 = 0;
  for (const line of usable) {
    a00 += line.a * line.a;
    a01 += line.a * line.b;
    a11 += line.b * line.b;
    b0 += -line.a * line.c;
    b1 += -line.b * line.c;
  }
  const det = a00 * a11 - a01 * a01;
  if (Math.abs(det) < 1e-6) {
    const pair = pairwiseIntersections(lines)[0];
    return pair || null;
  }
  const x = (b0 * a11 - b1 * a01) / det;
  const y = (a00 * b1 - a01 * b0) / det;
  const residual = usable.reduce((sum, line) => sum + Math.abs(line.a * x + line.b * y + line.c), 0) / usable.length;
  return {
    point_px: [round(x), round(y)],
    support_score: round(clamp(1 - residual / 80, 0.35, 0.9)),
    residual_px: round(residual)
  };
}

function pairwiseIntersections(lines) {
  const intersections = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const point = intersectLines(lines[i].fitted_line_px, lines[j].fitted_line_px);
      if (!point.every(Number.isFinite)) continue;
      intersections.push({
        point_px: point.map((value) => round(value)),
        support_score: round((lines[i].support_score + lines[j].support_score) / 2),
        residual_px: 0
      });
    }
  }
  return intersections.sort((a, b) => b.support_score - a.support_score);
}

function lineSideLuminanceContrast({ raster, line, offset = 8 }) {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const unit = [dx / length, dy / length];
  const normal = [-unit[1], unit[0]];
  let leftTotal = 0;
  let rightTotal = 0;
  let count = 0;
  for (let t = 16; t < length - 16; t += 5) {
    const x = line.a[0] + unit[0] * t;
    const y = line.a[1] + unit[1] * t;
    const left = sampleGray(raster, x + normal[0] * offset, y + normal[1] * offset);
    const right = sampleGray(raster, x - normal[0] * offset, y - normal[1] * offset);
    if (left === null || right === null) continue;
    leftTotal += left;
    rightTotal += right;
    count += 1;
  }
  const leftMean = count ? leftTotal / count : 0;
  const rightMean = count ? rightTotal / count : 0;
  return {
    left_mean: round(leftMean),
    right_mean: round(rightMean),
    delta: round(Math.abs(leftMean - rightMean))
  };
}

function clippedLineThroughPoints(a, b, width, height) {
  if (!a || !b) return null;
  const yAt = (x) => {
    if (Math.abs(b[0] - a[0]) < 1e-6) return null;
    const t = (x - a[0]) / (b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * t;
  };
  const endpoints = [];
  for (const x of [0, width]) {
    const y = yAt(x);
    if (Number.isFinite(y)) endpoints.push([x, y]);
  }
  if (endpoints.length < 2) return null;
  return {
    a: endpoints[0].map((value) => round(value)),
    b: endpoints[1].map((value) => round(value))
  };
}

function homographyFromQuadToUnitSquare(quad) {
  const dst = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const matrix = [];
  const rhs = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = quad[i];
    const [u, v] = dst[i];
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
  const n = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let pivot = 0; pivot < n; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot] || 1e-12;
    for (let col = pivot; col <= n; col += 1) augmented[pivot][col] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = pivot; col <= n; col += 1) augmented[row][col] -= factor * augmented[pivot][col];
    }
  }
  return augmented.map((row) => row[n]);
}

function intersectLines(first, second) {
  const l1 = lineEquation(first);
  const l2 = lineEquation(second);
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-9) return [NaN, NaN];
  return [
    (l1.b * l2.c - l2.b * l1.c) / det,
    (l1.c * l2.a - l2.c * l1.a) / det
  ];
}

function normalizedLineEquation(line) {
  const eq = lineEquation(line);
  const norm = Math.hypot(eq.a, eq.b) || 1;
  return { a: eq.a / norm, b: eq.b / norm, c: eq.c / norm };
}

function lineEquation(line) {
  const [x1, y1] = line.a;
  const [x2, y2] = line.b;
  const a = y1 - y2;
  const b = x2 - x1;
  const c = x1 * y2 - x2 * y1;
  return { a, b, c };
}

function supportScoreForLine(support) {
  const gradientScore = clamp((support.average_gradient - 45) / 145, 0, 1);
  const continuityScore = clamp(support.hit_ratio, 0, 1);
  return round(clamp(0.38 + gradientScore * 0.34 + continuityScore * 0.28, 0.2, 0.92));
}

function lineLengthByRole(lines, role) {
  const line = lines.find((item) => item.role === role);
  if (!line) return 0;
  return lineLength(line.fitted_line_px);
}

function lineLength(line) {
  return Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
}

function byFamily(lines, family) {
  return lines.filter((line) => line.family === family);
}

function sampleGray(raster, x, y) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) return null;
  return raster.gray[py * raster.width + px];
}

function scaleLine(line, width, height, referenceSize = REFERENCE_SIZE) {
  return {
    a: scalePoint(line[0], width, height, referenceSize),
    b: scalePoint(line[1], width, height, referenceSize)
  };
}

function scalePoint(point, width, height, referenceSize = REFERENCE_SIZE) {
  return [
    point[0] * width / referenceSize.width,
    point[1] * height / referenceSize.height
  ];
}

function candidatePlaneIdsForDetail(role, planes) {
  const primary = planes.find((plane) => plane.id === 'visible_plane_primary')?.id;
  const side = planes.find((plane) => plane.id === 'visible_plane_recessed_left')?.id;
  if (role === 'rectangular_utility_ducts') return [side || primary].filter(Boolean);
  if (role === 'shadow_or_recess_boundary') return [side, primary].filter(Boolean);
  if (['upper_window_bands', 'ground_floor_storefront', 'exterior_hvac_units'].includes(role)) return [primary || side].filter(Boolean);
  if (role === 'roof_parapet_and_rail') return [primary, side].filter(Boolean);
  return [primary || side].filter(Boolean);
}

function projectedDetailForRole(role, projection) {
  const primary = projection.planes.find((plane) => plane.id === 'visible_plane_primary');
  const side = projection.planes.find((plane) => plane.id === 'visible_plane_recessed_left');
  const primaryBox = (localBox, attachmentHint, support = 0.62) => ({
    visible_quad_px: localBoxToImageQuad(primary?.visible_quad_px, localBox),
    attachment_hint: attachmentHint,
    support_score: support,
    derived_from: ['visible_plane_primary', ...((primary?.source_line_ids || []))]
  });
  const sideBox = (localBox, attachmentHint, support = 0.62) => ({
    visible_quad_px: localBoxToImageQuad(side?.visible_quad_px, localBox),
    attachment_hint: attachmentHint,
    support_score: support,
    derived_from: ['visible_plane_recessed_left', ...((side?.source_line_ids || []))]
  });
  if (role === 'upper_window_bands') {
    return primaryBox([0.12, 0.18, 0.76, 0.43], 'review_as_window_bands_on_corrected_primary_plane', 0.64);
  }
  if (role === 'exterior_hvac_units') {
    return primaryBox([0.13, 0.23, 0.78, 0.43], 'review_as_hvac_boxes_on_corrected_primary_plane', 0.58);
  }
  if (role === 'ground_floor_storefront') {
    return primaryBox([0.34, 0.72, 0.58, 0.25], 'review_as_storefront_on_corrected_primary_plane', 0.64);
  }
  if (role === 'roof_parapet_and_rail') {
    return primaryBox([0.00, -0.08, 1.00, 0.14], 'review_as_roof_parapet_band_after_scale_review', 0.56);
  }
  if (role === 'rectangular_utility_ducts') {
    return sideBox([0.05, 0.04, 0.33, 0.72], 'review_as_rectangular_utility_ducts_on_corrected_side_plane', 0.64);
  }
  if (role === 'shadow_or_recess_boundary') {
    return {
      visible_quad_px: localBoxToImageQuad(side?.visible_quad_px, [0.92, 0.02, 0.08, 0.96]),
      attachment_hint: 'review_as_lighting_separator_between_corrected_planes_not_cut_geometry',
      support_score: projection.shadow_lighting_decisions?.[0]?.support_score || 0.38,
      derived_from: ['yellow_shadow_recess_boundary_decision']
    };
  }
  return null;
}

function localBoxToImageQuad(quad, localBox) {
  if (!quad?.length) return [];
  const [u, v, width, height] = localBox;
  return [
    bilinearPoint(quad, u, v),
    bilinearPoint(quad, u + width, v),
    bilinearPoint(quad, u + width, v + height),
    bilinearPoint(quad, u, v + height)
  ].map((point) => point.map((value) => round(value)));
}

function bilinearPoint(quad, u, v) {
  const top = lerpPoint(quad[0], quad[1], u);
  const bottom = lerpPoint(quad[3], quad[2], u);
  return lerpPoint(top, bottom, v);
}

function lerpPoint(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t
  ];
}

function bboxFromQuad(quad) {
  const xs = quad.map((point) => point[0]);
  const ys = quad.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return [round(minX), round(minY), round(maxX - minX), round(maxY - minY)];
}

function polygonSvg({ points, fill, stroke, opacity, label }) {
  return `<polygon data-layer="yellow-structural-plane" points="${points.map((point) => point.map((value) => round(value)).join(',')).join(' ')}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="3">
  <title>${escapeXml(label)}</title>
</polygon>`;
}

function lineSvg({ line, color, label }) {
  return `<line data-layer="yellow-structural-line" x1="${round(line.a[0])}" y1="${round(line.a[1])}" x2="${round(line.b[0])}" y2="${round(line.b[1])}" stroke="${color}" stroke-width="2.4">
  <title>${escapeXml(label)}</title>
</line>`;
}

function pointSvg({ point, color, label }) {
  if (!point) return '';
  return `<g data-layer="yellow-vanishing-point">
  <circle cx="${round(point[0])}" cy="${round(point[1])}" r="7" fill="${color}" fill-opacity="0.85"/>
  <title>${escapeXml(label)} ${pointToken(point)}</title>
</g>`;
}

function projectionImageDataUrl(sourceImagePath) {
  return `data:image/${path.extname(sourceImagePath).toLowerCase() === '.jpg' ? 'jpeg' : 'png'};base64,${projectionImageDataUrl.cache.get(sourceImagePath) || ''}`;
}
projectionImageDataUrl.cache = new Map();

export async function prepareYellowProjectionImageDataUrl(sourceImagePath) {
  const data = await fs.readFile(sourceImagePath);
  projectionImageDataUrl.cache.set(sourceImagePath, data.toString('base64'));
}

function pointToken(point = []) {
  return `[${point.map((value) => round(value)).join(', ')}]`;
}

function quadToken(quad = []) {
  return quad.map((point) => pointToken(point)).join('; ');
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).split(path.sep).join('/');
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
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
