export const FACADE_PLANE_GRAPH_KIND = 'facade_plane_graph_v1';
export const FACADE_PLANE_REVIEW_OVERLAY_KIND = 'facade_plane_review_overlay_v1';

export const VISIBLE_PLANE_ROLES = [
  'visible_plane_primary',
  'visible_plane_recessed_left'
];

const PLANE_ROLE_SET = new Set(VISIBLE_PLANE_ROLES);

const PLANE_COLORS = {
  visible_plane_primary: '#2563eb',
  visible_plane_recessed_left: '#f97316'
};

const DETAIL_COLORS = {
  rectangular_utility_ducts: '#16a34a',
  shadow_or_recess_boundary: '#7c3aed',
  exterior_hvac_units: '#0891b2',
  upper_window_bands: '#ca8a04',
  ground_floor_storefront: '#dc2626',
  roof_parapet_and_rail: '#059669'
};

export function isVisiblePlaneRole(role) {
  return PLANE_ROLE_SET.has(role);
}

export function buildFacadePlaneGraphV1({
  semanticEvidence = null,
  observationSet = null,
  structureEvidenceGraph = null,
  draftViewGraph = null,
  sourceSemanticEvidence = 'building-single-semantic-evidence.json'
} = {}) {
  if (!semanticEvidence || semanticEvidence.profile !== 'building_single') return null;
  const selected = selectedRegionsWithImage(semanticEvidence);
  const planeItems = selected.filter((item) => isVisiblePlaneRole(item.region.role));
  const detailItems = selected.filter((item) => !isVisiblePlaneRole(item.region.role));
  const planes = planeItems.map((item, index) => planeFromRegion({
    item,
    index,
    allPlaneItems: planeItems,
    observationSet
  }));
  const planeByRole = new Map(planes.map((plane) => [plane.role, plane]));
  const planeLocalDetailCandidates = detailItems.map((item) => detailCandidateFromRegion({
    item,
    planes,
    planeByRole
  }));
  const graph = {
    kind: FACADE_PLANE_GRAPH_KIND,
    version: 1,
    profile: 'building_single',
    coordinate_convention: 'image_x_right_y_down',
    source_images: semanticEvidence.source_images || [],
    source_semantic_evidence: sourceSemanticEvidence,
    source_structure_evidence_graph: structureEvidenceGraph ? 'structure-evidence-graph.json' : null,
    source_draft_view_graph: draftViewGraph ? 'draft-view-graph.json' : null,
    planes,
    plane_local_detail_candidates: planeLocalDetailCandidates,
    review_policy: {
      status: planes.length ? 'needs_plane_review' : 'blocked_no_visible_planes',
      accepted_plane_review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      review_required: true,
      blockers: planes.length ? ['accepted_facade_plane_review_required'] : ['visible_plane_evidence_required'],
      notes: [
        'Visible planes are derived from DraftViewGraph/StructureEvidenceGraph evidence, not PartGraph geometry.',
        'Do not merge visible_plane_* items until plane review accepts their separate boundaries and occlusion order.',
        'Plane-local detail candidates may be reviewed only after the target visible plane is accepted.'
      ]
    },
    summary: {
      plane_count: planes.length,
      detail_candidate_count: planeLocalDetailCandidates.length,
      visible_plane_ids: planes.map((plane) => plane.id),
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      must_not_merge_pairs: mustNotMergePairs(planes)
    }
  };
  return graph;
}

export function buildFacadePlaneReviewOverlay({
  facadePlaneGraph = null
} = {}) {
  if (!facadePlaneGraph) return null;
  const operations = [];
  for (const plane of facadePlaneGraph.planes || []) {
    operations.push({
      id: `overlay_${plane.id}`,
      op: 'visible_plane_quad_overlay',
      plane_id: plane.id,
      role: plane.role,
      source_image: plane.source_image,
      visible_quad_px: plane.visible_quad_px,
      color: PLANE_COLORS[plane.role] || '#64748b',
      opacity: 0.28,
      label: `${plane.id} review`,
      review_required: true,
      promotion_allowed: false
    });
    operations.push({
      id: `label_${plane.id}`,
      op: 'label',
      plane_id: plane.id,
      source_image: plane.source_image,
      anchor_px: planeLabelAnchor(plane),
      text: `${plane.id} | promotion_allowed=false`,
      color: PLANE_COLORS[plane.role] || '#64748b'
    });
    for (const adjacency of plane.adjacency || []) {
      operations.push({
        id: `adjacency_${plane.id}_${adjacency.plane_id}`,
        op: 'visible_plane_adjacency_line',
        from_plane_id: plane.id,
        to_plane_id: adjacency.plane_id,
        relation: adjacency.relation,
        source_image: plane.source_image,
        from_px: quadCenter(plane.visible_quad_px),
        to_px: adjacency.target_center_px || [],
        review_required: true,
        promotion_allowed: false
      });
    }
  }
  for (const detail of facadePlaneGraph.plane_local_detail_candidates || []) {
    operations.push({
      id: `detail_${detail.id}`,
      op: 'plane_local_detail_candidate_overlay',
      detail_id: detail.id,
      role: detail.role,
      candidate_plane_ids: detail.candidate_plane_ids,
      source_image: detail.source_image,
      visible_quad_px: detail.visible_quad_px,
      bbox_px: detail.bbox_px,
      color: DETAIL_COLORS[detail.role] || '#64748b',
      opacity: 0.24,
      label: `${detail.role} candidate`,
      review_required: true,
      promotion_allowed: false
    });
  }
  return {
    kind: FACADE_PLANE_REVIEW_OVERLAY_KIND,
    version: 1,
    source_facade_plane_graph: 'facade-plane-graph.json',
    model_status: 'review_only',
    compile_allowed: false,
    geometry_promotion_allowed: false,
    promotion_allowed: false,
    operations,
    qa: {
      no_promoted_geometry: true,
      forbidden_geometry_ops_absent: !operations.some((operation) => ['box', 'push_pull', 'cut_recess', 'promote_part'].includes(operation.op)),
      notes: [
        'Overlay operations are for plane review only.',
        'This artifact must not be compiled into SketchUp geometry.'
      ]
    }
  };
}

export function renderFacadePlaneGraphMarkdown(facadePlaneGraph) {
  if (!facadePlaneGraph) return '# Facade Plane Graph\n\nNo facade plane graph generated.\n';
  const lines = [];
  lines.push('# Facade Plane Graph v1');
  lines.push('');
  lines.push(`- status: \`${facadePlaneGraph.review_policy?.status || 'unknown'}\``);
  lines.push(`- accepted_plane_review_required: \`${String(facadePlaneGraph.review_policy?.accepted_plane_review_required === true)}\``);
  lines.push(`- promotion_allowed: \`${String(facadePlaneGraph.review_policy?.promotion_allowed === true)}\``);
  lines.push(`- plane_count: \`${facadePlaneGraph.summary?.plane_count || 0}\``);
  lines.push(`- detail_candidate_count: \`${facadePlaneGraph.summary?.detail_candidate_count || 0}\``);
  lines.push('');
  lines.push('## Visible Planes');
  lines.push('| id | orientation | occlusion | must_not_merge_with | visible_quad_px | source |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const plane of facadePlaneGraph.planes || []) {
    lines.push(`| ${plane.id} | ${plane.orientation_hint?.kind || 'unknown'} | ${plane.occlusion_order?.rank ?? 'unknown'} | ${(plane.must_not_merge_with || []).join(', ') || 'none'} | ${quadToken(plane.visible_quad_px)} | ${plane.source?.kind || 'unknown'}:${plane.source?.semantic_evidence_id || ''} |`);
  }
  lines.push('');
  lines.push('## Plane-Local Detail Candidates');
  lines.push('| id | role | candidate planes | promotion allowed | bbox_px |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const detail of facadePlaneGraph.plane_local_detail_candidates || []) {
    lines.push(`| ${detail.id} | ${detail.role} | ${(detail.candidate_plane_ids || []).join(', ') || 'none'} | ${String(detail.promotion_allowed === true)} | ${(detail.bbox_px || []).join(', ')} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function facadePlaneGraphSummary(facadePlaneGraph = null) {
  if (!facadePlaneGraph) return null;
  return {
    kind: facadePlaneGraph.kind,
    status: facadePlaneGraph.review_policy?.status || 'unknown',
    plane_count: facadePlaneGraph.summary?.plane_count || 0,
    detail_candidate_count: facadePlaneGraph.summary?.detail_candidate_count || 0,
    visible_plane_ids: facadePlaneGraph.summary?.visible_plane_ids || [],
    accepted_plane_review_required: facadePlaneGraph.review_policy?.accepted_plane_review_required === true,
    promotion_allowed: facadePlaneGraph.summary?.promotion_allowed === true,
    review_required: facadePlaneGraph.summary?.review_required === true,
    blockers: facadePlaneGraph.review_policy?.blockers || []
  };
}

function selectedRegionsWithImage(semanticEvidence) {
  const items = [];
  for (const image of semanticEvidence.images || []) {
    for (const region of image.regions || []) {
      if (region.selected_for_candidate_graph !== true) continue;
      items.push({ image, region });
    }
  }
  return items;
}

function planeFromRegion({ item, index, allPlaneItems, observationSet }) {
  const { image, region } = item;
  const id = uniquePlaneId(region.role, index, allPlaneItems);
  const otherPlaneItems = allPlaneItems.filter((other) => other.region !== region);
  const visibleQuad = ensureQuad(region.polygon_px, region.bbox_px);
  const sourceImage = image.source_image;
  const imageObservation = (observationSet?.images || []).find((candidate) => candidate.image?.path === sourceImage) || null;
  const draftViewSlot = draftViewSlotForImage(observationSet?.draft_view_graph_v1, sourceImage);
  return {
    id,
    role: region.role,
    source_image: sourceImage,
    view: image.view,
    visible_quad_px: visibleQuad,
    visible_bbox_px: region.bbox_px,
    orientation_hint: {
      kind: orientationKind(region, image),
      view: image.view || 'unknown',
      projection_model: region.projection_model || image.projection_model || 'unknown',
      perspective_strength: region.perspective_strength || image.perspective_strength || 'unknown',
      normal_hint: 'unknown_until_plane_review',
      camera_hints: image.camera_hints || imageObservation?.camera_hints || {},
      confidence: round(region.confidence || 0),
      review_required: true
    },
    adjacency: otherPlaneItems.map((other) => ({
      plane_id: uniquePlaneId(other.region.role, allPlaneItems.indexOf(other), allPlaneItems),
      relation: adjacencyRelation(region, other.region),
      evidence: 'image_space_visible_quad_adjacency',
      target_center_px: quadCenter(ensureQuad(other.region.polygon_px, other.region.bbox_px)),
      review_required: true
    })),
    occlusion_order: {
      rank: index + 1,
      relation_to_camera: occlusionHint(region.role),
      evidence: 'draft_visible_plane_order_requires_review',
      review_required: true
    },
    must_not_merge_with: otherPlaneItems.map((other) => uniquePlaneId(other.region.role, allPlaneItems.indexOf(other), allPlaneItems)),
    source: {
      kind: region.source || 'unknown',
      semantic_evidence_id: region.id,
      draft_view_slot_id: draftViewSlot?.slot_id || null,
      source_priority: region.source_priority ?? null,
      confidence: round(region.confidence || 0),
      derived_from: region.derived_from || []
    },
    review_required: true,
    promotion_allowed: false
  };
}

function draftViewSlotForImage(draftViewGraph, sourceImage) {
  return (draftViewGraph?.view_slots || []).find((slot) => (slot.source_image_ids || []).includes(sourceImage)) || null;
}

function detailCandidateFromRegion({ item, planes, planeByRole }) {
  const { image, region } = item;
  const candidatePlaneIds = candidatePlaneIdsForRole(region.role, planes, planeByRole);
  return {
    id: `detail_${region.role}_${shortHash(`${image.source_image}:${region.id}`)}`,
    role: region.role,
    source_image: image.source_image,
    view: image.view,
    candidate_plane_ids: candidatePlaneIds,
    attachment_hint: attachmentHintForRole(region.role),
    visible_quad_px: ensureQuad(region.polygon_px, region.bbox_px),
    bbox_px: region.bbox_px,
    source: {
      kind: region.source || 'unknown',
      semantic_evidence_id: region.id,
      source_priority: region.source_priority ?? null,
      confidence: round(region.confidence || 0),
      derived_from: region.derived_from || []
    },
    review_required: true,
    promotion_allowed: false,
    blockers: [
      'accepted_facade_plane_review_required',
      'plane_local_detail_review_required'
    ]
  };
}

function uniquePlaneId(role, index, allPlaneItems) {
  const roleCount = allPlaneItems.filter((item) => item.region.role === role).length;
  if (roleCount <= 1) return role;
  return `${role}_${index + 1}`;
}

function candidatePlaneIdsForRole(role, planes, planeByRole) {
  const primary = planeByRole.get('visible_plane_primary')?.id;
  const recessed = planeByRole.get('visible_plane_recessed_left')?.id;
  if (role === 'rectangular_utility_ducts') return [recessed || primary].filter(Boolean);
  if (role === 'shadow_or_recess_boundary') return [recessed, primary].filter(Boolean);
  if (role === 'roof_parapet_and_rail') return [primary, recessed].filter(Boolean);
  if (['upper_window_bands', 'ground_floor_storefront', 'exterior_hvac_units'].includes(role)) return [primary || recessed].filter(Boolean);
  return planes.map((plane) => plane.id).slice(0, 1);
}

function attachmentHintForRole(role) {
  if (role === 'rectangular_utility_ducts') return 'review_as_external_duct_on_candidate_visible_plane';
  if (role === 'shadow_or_recess_boundary') return 'review_as_boundary_between_visible_planes_or_shadow';
  if (role === 'upper_window_bands') return 'review_as_opening_band_on_accepted_visible_plane';
  if (role === 'ground_floor_storefront') return 'review_as_ground_floor_opening_candidate_on_accepted_visible_plane';
  if (role === 'exterior_hvac_units') return 'review_as_fixture_candidates_on_accepted_visible_plane';
  if (role === 'roof_parapet_and_rail') return 'review_as_roofline_detail_after_plane_acceptance';
  return 'review_as_plane_local_detail_candidate';
}

function orientationKind(region, image) {
  if (region.role === 'visible_plane_recessed_left') return 'oblique_recessed_visible_plane_candidate';
  if (image.view === 'front') return 'front_visible_plane_candidate';
  return 'oblique_visible_plane_candidate';
}

function adjacencyRelation(a, b) {
  if (a.role === 'visible_plane_recessed_left' || b.role === 'visible_plane_recessed_left') {
    return 'separate_recess_or_return_plane_candidate';
  }
  return 'separate_visible_plane_candidate';
}

function occlusionHint(role) {
  if (role === 'visible_plane_recessed_left') return 'ambiguous_recessed_or_side_plane';
  return 'ambiguous_primary_visible_plane';
}

function mustNotMergePairs(planes) {
  const pairs = [];
  for (const plane of planes) {
    for (const other of plane.must_not_merge_with || []) {
      const key = [plane.id, other].sort().join('|');
      if (!pairs.some((pair) => pair.key === key)) pairs.push({ key, plane_ids: key.split('|') });
    }
  }
  return pairs.map((pair) => pair.plane_ids);
}

function ensureQuad(polygon, bbox) {
  const normalized = normalizePolygon(polygon);
  if (normalized.length >= 4) return normalized.slice(0, 4);
  return bboxQuad(bbox);
}

function bboxQuad(bbox = []) {
  const [x, y, width, height] = normalizeBbox(bbox);
  return [
    [x, y],
    [round(x + width), y],
    [round(x + width), round(y + height)],
    [x, round(y + height)]
  ];
}

function planeLabelAnchor(plane) {
  const center = quadCenter(plane.visible_quad_px);
  return [round(center[0] + 8), round(center[1] - 8)];
}

function quadCenter(quad = []) {
  const normalized = normalizePolygon(quad);
  if (!normalized.length) return [];
  return [
    round(normalized.reduce((sum, point) => sum + point[0], 0) / normalized.length),
    round(normalized.reduce((sum, point) => sum + point[1], 0) / normalized.length)
  ];
}

function quadToken(quad = []) {
  return normalizePolygon(quad).map((point) => point.join(',')).join(';');
}

function normalizePolygon(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((point) => Array.isArray(point) && point.length >= 2
      ? [round(point[0]), round(point[1])]
      : null)
    .filter(Boolean);
}

function normalizeBbox(value = []) {
  const numbers = Array.isArray(value) ? value.slice(0, 4).map((item) => Number(item || 0)) : [0, 0, 0, 0];
  while (numbers.length < 4) numbers.push(0);
  return numbers.map(round);
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}
