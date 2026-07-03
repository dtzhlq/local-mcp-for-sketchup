export const STRUCTURE_EVIDENCE_GRAPH_KIND = 'structure_evidence_graph_v1';
export const DRAFT_VIEW_GRAPH_KIND = 'draft_view_graph_v1';
export const DRAFT_VIEW_REVIEW_OVERLAY_KIND = 'draft_view_review_overlay_v1';
export const OBJECT_SURFACE_GRAPH_KIND = 'object_surface_graph_v1';
export const DRAFT_VIEW_REVIEW_DECISION_KIND = 'draft_view_review_decision_v1';
export const LOCAL_DETAIL_REVIEW_DECISION_KIND = 'local_detail_review_decision_v1';

export const DRAFT_VIEW_SLOTS = ['front', 'left_or_right_side', 'top', 'oblique_context'];

const SLOT_COLORS = {
  front: '#2563eb',
  left_or_right_side: '#f97316',
  top: '#0f766e',
  oblique_context: '#7c3aed'
};

const BUILDING_PROFILES = new Set(['building_single', 'building_group']);

export function annotateObservationSetWithDraftingFirstGraphs({
  observationSet = {},
  buildingSingleSemanticEvidence = null
} = {}) {
  const structureEvidenceGraph = buildStructureEvidenceGraphV1({
    observationSet,
    buildingSingleSemanticEvidence
  });
  const draftViewGraph = buildDraftViewGraphV1({
    observationSet,
    structureEvidenceGraph
  });
  const objectSurfaceGraph = buildObjectSurfaceGraphV1({
    observationSet,
    structureEvidenceGraph,
    draftViewGraph
  });
  return {
    observationSet: {
      ...observationSet,
      structure_evidence_graph_v1: structureEvidenceGraph,
      draft_view_graph_v1: draftViewGraph,
      ...(objectSurfaceGraph ? { object_surface_graph_v1: objectSurfaceGraph } : {})
    },
    structureEvidenceGraph,
    draftViewGraph,
    objectSurfaceGraph
  };
}

export function buildStructureEvidenceGraphV1({
  observationSet = {},
  buildingSingleSemanticEvidence = null
} = {}) {
  const images = Array.isArray(observationSet.images) ? observationSet.images : [];
  const sourceProvenance = images.map((image, index) => ({
    id: `source_image_${index + 1}`,
    source_image: image.image?.path || `image_${index + 1}`,
    width: Number(image.image?.analysis_width || image.image?.width || 0),
    height: Number(image.image?.analysis_height || image.image?.height || 0),
    detected_view: image.detected_view?.kind || 'unknown',
    deterministic_backends: deterministicBackends(observationSet),
    optional_evidence_sources: optionalEvidenceSources(observationSet)
  }));
  const edgeEvidence = [
    ...edgesFromVisionEvidence(observationSet.vision_evidence_set_v1),
    ...edgesFromImageObservations(images)
  ];
  const planeHypotheses = [
    ...planesFromBuildingSingleSemanticEvidence(buildingSingleSemanticEvidence),
    ...planesFromImageObservations(images)
  ];
  const cornerEvidence = cornersFromPlanesAndEdges({ planes: planeHypotheses, edges: edgeEvidence });
  const silhouetteProfiles = silhouettesFromImages(images);
  const viewAxisHypotheses = viewAxisHypothesesFromImages(images, edgeEvidence);
  const qa = structureEvidenceQa({ edgeEvidence, cornerEvidence, planeHypotheses, silhouetteProfiles, viewAxisHypotheses });
  return {
    kind: STRUCTURE_EVIDENCE_GRAPH_KIND,
    version: 1,
    coordinate_convention: 'image_x_right_y_down',
    default_backends: deterministicBackends(observationSet),
    optional_backends: optionalEvidenceSources(observationSet),
    edge_evidence: edgeEvidence,
    corner_evidence: cornerEvidence,
    plane_hypotheses: planeHypotheses,
    silhouette_profiles: silhouetteProfiles,
    view_axis_hypotheses: viewAxisHypotheses,
    source_provenance: sourceProvenance,
    qa,
    review_policy: {
      status: qa.edge_evidence_count || qa.plane_hypothesis_count ? 'needs_review' : 'blocked_no_structure_evidence',
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: qa.edge_evidence_count || qa.plane_hypothesis_count
        ? ['accepted_draft_view_review_required']
        : ['structure_evidence_required']
    }
  };
}

export function buildDraftViewGraphV1({
  observationSet = {},
  structureEvidenceGraph = null
} = {}) {
  const images = Array.isArray(observationSet.images) ? observationSet.images : [];
  const slots = DRAFT_VIEW_SLOTS.map((slotId) => draftViewSlot({
    slotId,
    images,
    structureEvidenceGraph
  }));
  const observedSlots = slots.filter((slot) => slot.status === 'observed').length;
  const reviewRequiredSlots = slots.filter((slot) => slot.review_required).length;
  return {
    kind: DRAFT_VIEW_GRAPH_KIND,
    version: 1,
    profile_id: observationSet.object?.profile || observationSet.object?.type || 'unknown_object',
    coordinate_convention: 'image_x_right_y_down',
    source_structure_evidence_graph: 'structure-evidence-graph.json',
    view_slots: slots,
    review_overlay: buildDraftViewReviewOverlay({ slots }),
    review_policy: {
      status: observedSlots ? 'needs_draft_view_review' : 'blocked_no_observed_views',
      accepted_draft_view_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: observedSlots ? ['accepted_draft_view_review_required'] : ['observed_view_required']
    },
    summary: {
      slot_count: slots.length,
      observed_slots: observedSlots,
      inferred_slots: slots.filter((slot) => slot.status === 'inferred').length,
      partial_slots: slots.filter((slot) => slot.status === 'partial').length,
      unknown_slots: slots.filter((slot) => slot.status === 'unknown').length,
      review_required_slots: reviewRequiredSlots,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildObjectSurfaceGraphV1({
  observationSet = {},
  structureEvidenceGraph = null,
  draftViewGraph = null
} = {}) {
  const profile = observationSet.object?.profile || observationSet.object?.type || 'unknown_object';
  const surfaces = (draftViewGraph?.view_slots || [])
    .filter((slot) => slot.status !== 'unknown')
    .map((slot) => ({
      id: `surface_${slot.slot_id}`,
      role: `${slot.slot_id}_visible_surface`,
      draft_view_slot_id: slot.slot_id,
      status: slot.status,
      source_image_ids: slot.source_image_ids || [],
      source_evidence_ids: slot.source_evidence_ids || [],
      visible_regions: slot.visible_regions || [],
      unknown_regions: slot.unknown_regions || [],
      orientation_hint: slot.projection_basis?.kind || 'unknown_projection',
      review_required: true,
      promotion_allowed: false,
      blockers: ['accepted_draft_view_review_required']
    }));
  const featureCandidates = surfaceLocalFeatureCandidates({ observationSet, surfaces });
  return {
    kind: OBJECT_SURFACE_GRAPH_KIND,
    version: 1,
    profile_id: profile,
    domain: BUILDING_PROFILES.has(profile) ? 'building_domain_projection' : 'generic_object_surface_projection',
    source_draft_view_graph: 'draft-view-graph.json',
    source_structure_evidence_graph: 'structure-evidence-graph.json',
    surfaces,
    surface_local_feature_candidates: featureCandidates,
    review_policy: {
      status: surfaces.length ? 'needs_surface_review' : 'blocked_no_visible_surfaces',
      accepted_surface_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: surfaces.length ? ['accepted_local_detail_review_required'] : ['visible_surface_evidence_required']
    },
    summary: {
      surface_count: surfaces.length,
      feature_candidate_count: featureCandidates.length,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false
    }
  };
}

export function buildDraftViewReviewOverlay({ slots = [] } = {}) {
  const operations = [];
  for (const slot of slots) {
    for (const region of slot.visible_regions || []) {
      operations.push({
        id: `draft_view_${slot.slot_id}_${region.id}`,
        op: 'draft_view_region_overlay',
        slot_id: slot.slot_id,
        region_id: region.id,
        source_image: region.source_image,
        visible_quad_px: region.visible_quad_px,
        color: SLOT_COLORS[slot.slot_id] || '#64748b',
        opacity: slot.status === 'observed' ? 0.28 : 0.18,
        review_required: true,
        promotion_allowed: false
      });
    }
  }
  return {
    kind: DRAFT_VIEW_REVIEW_OVERLAY_KIND,
    version: 1,
    model_status: 'review_only',
    compile_allowed: false,
    geometry_promotion_allowed: false,
    promotion_allowed: false,
    operations,
    qa: {
      no_promoted_geometry: true,
      forbidden_geometry_ops_absent: !operations.some((operation) => ['box', 'push_pull', 'cut_recess', 'promote_part'].includes(operation.op))
    }
  };
}

export function buildDefaultDraftViewReviewDecision({
  draftViewGraph = null,
  reviewer = 'intake-workbench',
  accepted = false
} = {}) {
  const slots = draftViewGraph?.view_slots || [];
  const acceptedSlots = accepted ? slots.filter((slot) => slot.status !== 'unknown') : [];
  return {
    kind: DRAFT_VIEW_REVIEW_DECISION_KIND,
    version: 1,
    source_draft_view_graph: 'draft-view-graph.json',
    reviewer,
    status: acceptedSlots.length ? 'accepted' : 'not_accepted',
    promotion_allowed: acceptedSlots.length > 0,
    compile_allowed: false,
    accepted_view_slot_ids: acceptedSlots.map((slot) => slot.slot_id),
    rejected_view_slot_ids: [],
    corrected_axes: [],
    accepted_plane_hypothesis_ids: acceptedSlots.flatMap((slot) => slot.visible_regions || []).map((region) => region.id),
    blockers: acceptedSlots.length ? [] : ['accepted_draft_view_review_required'],
    notes: acceptedSlots.length
      ? ['Draft view slots accepted for downstream surface/detail review; this does not compile geometry.']
      : ['Draft view review must accept view slots before candidate promotion.']
  };
}

export function buildDefaultLocalDetailReviewDecision({
  objectSurfaceGraph = null,
  facadePlaneGraph = null,
  reviewer = 'intake-workbench',
  accepted = false
} = {}) {
  const surfaces = objectSurfaceGraph?.surfaces || [];
  const details = [
    ...(objectSurfaceGraph?.surface_local_feature_candidates || []),
    ...(facadePlaneGraph?.plane_local_detail_candidates || [])
  ];
  const acceptedSurfaceIds = accepted ? surfaces.map((surface) => surface.id) : [];
  const acceptedDetailIds = accepted ? details.map((detail) => detail.id) : [];
  return {
    kind: LOCAL_DETAIL_REVIEW_DECISION_KIND,
    version: 1,
    source_object_surface_graph: objectSurfaceGraph ? 'object-surface-graph.json' : null,
    source_facade_plane_graph: facadePlaneGraph ? 'facade-plane-graph.json' : null,
    reviewer,
    status: acceptedSurfaceIds.length || acceptedDetailIds.length ? 'accepted' : 'not_accepted',
    promotion_allowed: acceptedSurfaceIds.length > 0 || acceptedDetailIds.length > 0,
    compile_allowed: false,
    accepted_surface_ids: acceptedSurfaceIds,
    accepted_detail_ids: acceptedDetailIds,
    detail_bindings: acceptedDetailIds.map((detailId) => ({
      detail_id: detailId,
      target_surface_id: acceptedSurfaceIds[0] || null,
      target_plane_id: facadePlaneGraph?.planes?.[0]?.id || null,
      status: 'accepted'
    })),
    blockers: acceptedSurfaceIds.length || acceptedDetailIds.length ? [] : ['accepted_local_detail_review_required'],
    notes: acceptedSurfaceIds.length || acceptedDetailIds.length
      ? ['Local details accepted for promotion review; this does not compile geometry.']
      : ['Surface-local or plane-local detail review is required before PartGraph promotion.']
  };
}

export function renderStructureEvidenceGraphMarkdown(graph = null) {
  if (!graph) return '# Structure Evidence Graph\n\nNo structure evidence graph generated.\n';
  return [
    '# Structure Evidence Graph v1',
    '',
    `- status: \`${graph.review_policy?.status || 'unknown'}\``,
    `- default_backends: \`${(graph.default_backends || []).join(', ') || 'none'}\``,
    `- edge_evidence: \`${graph.qa?.edge_evidence_count || 0}\``,
    `- corner_evidence: \`${graph.qa?.corner_evidence_count || 0}\``,
    `- plane_hypotheses: \`${graph.qa?.plane_hypothesis_count || 0}\``,
    `- promotion_allowed: \`${String(graph.review_policy?.promotion_allowed === true)}\``,
    '',
    '## Edge Evidence',
    '| id | class | source | support | review | rejection |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(graph.edge_evidence || []).slice(0, 40).map((edge) => `| ${edge.id} | ${edge.class || 'unknown'} | ${edge.source_image || ''} | ${edge.support_score ?? 0} | ${edge.review_status || 'unknown'} | ${edge.rejection_reason || 'none'} |`),
    '',
    '## Plane Hypotheses',
    '| id | role | source | confidence | review |',
    '| --- | --- | --- | --- | --- |',
    ...(graph.plane_hypotheses || []).slice(0, 40).map((plane) => `| ${plane.id} | ${plane.role || 'unknown'} | ${plane.source_image || ''} | ${plane.confidence ?? 0} | ${plane.review_status || 'unknown'} |`),
    ''
  ].join('\n');
}

export function renderDraftViewGraphMarkdown(graph = null) {
  if (!graph) return '# Draft View Graph\n\nNo draft view graph generated.\n';
  return [
    '# Draft View Graph v1',
    '',
    `- status: \`${graph.review_policy?.status || 'unknown'}\``,
    `- accepted_draft_view_review_required: \`${String(graph.review_policy?.accepted_draft_view_review_required === true)}\``,
    `- promotion_allowed: \`${String(graph.review_policy?.promotion_allowed === true)}\``,
    '',
    '## Draft View Slots',
    '| slot | status | confidence | source images | evidence | unknown regions |',
    '| --- | --- | --- | --- | --- | --- |',
    ...(graph.view_slots || []).map((slot) => `| ${slot.slot_id} | ${slot.status} | ${slot.confidence} | ${(slot.source_image_ids || []).join(', ') || 'none'} | ${(slot.source_evidence_ids || []).slice(0, 6).join(', ') || 'none'} | ${(slot.unknown_regions || []).map((item) => item.reason).join(', ') || 'none'} |`),
    ''
  ].join('\n');
}

export function renderDraftViewGraphSvg(graph = null) {
  const slots = graph?.view_slots || [];
  const width = 980;
  const height = 260;
  const panelWidth = 230;
  const panels = slots.map((slot, index) => {
    const x = 18 + index * 240;
    const color = SLOT_COLORS[slot.slot_id] || '#64748b';
    return `<g>
  <rect x="${x}" y="24" width="${panelWidth}" height="188" fill="#fff" stroke="#cbd5e1"/>
  <rect x="${x}" y="24" width="${panelWidth}" height="28" fill="${color}" opacity="0.16"/>
  <text x="${x + 12}" y="43" font-size="14" font-weight="700" fill="#111827" font-family="Arial, sans-serif">${escapeXml(slot.slot_id)}</text>
  <text x="${x + 12}" y="76" font-size="13" fill="#334155" font-family="Arial, sans-serif">status: ${escapeXml(slot.status)}</text>
  <text x="${x + 12}" y="100" font-size="13" fill="#334155" font-family="Arial, sans-serif">confidence: ${slot.confidence}</text>
  <text x="${x + 12}" y="124" font-size="13" fill="#334155" font-family="Arial, sans-serif">regions: ${(slot.visible_regions || []).length}</text>
  <text x="${x + 12}" y="148" font-size="13" fill="#334155" font-family="Arial, sans-serif">promotion: false</text>
  <text x="${x + 12}" y="172" font-size="12" fill="#64748b" font-family="Arial, sans-serif">${escapeXml((slot.source_image_ids || []).slice(0, 1).join(', ') || 'no source')}</text>
</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f8fafc"/>
<text x="18" y="18" font-size="15" font-weight="700" fill="#111827" font-family="Arial, sans-serif">DraftViewGraph v1 review overlay - no promoted geometry</text>
${panels}
</svg>
`;
}

export function renderObjectSurfaceGraphMarkdown(graph = null) {
  if (!graph) return '# Object Surface Graph\n\nNo object surface graph generated.\n';
  return [
    '# Object Surface Graph v1',
    '',
    `- domain: \`${graph.domain || 'unknown'}\``,
    `- status: \`${graph.review_policy?.status || 'unknown'}\``,
    `- surfaces: \`${graph.summary?.surface_count || 0}\``,
    `- feature_candidates: \`${graph.summary?.feature_candidate_count || 0}\``,
    '',
    '## Surfaces',
    '| id | role | draft view | status | promotion allowed |',
    '| --- | --- | --- | --- | --- |',
    ...(graph.surfaces || []).map((surface) => `| ${surface.id} | ${surface.role} | ${surface.draft_view_slot_id} | ${surface.status} | ${String(surface.promotion_allowed === true)} |`),
    '',
    '## Surface-Local Feature Candidates',
    '| id | role | surface candidates | source |',
    '| --- | --- | --- | --- |',
    ...(graph.surface_local_feature_candidates || []).slice(0, 80).map((detail) => `| ${detail.id} | ${detail.role} | ${(detail.candidate_surface_ids || []).join(', ') || 'none'} | ${detail.source_image || ''} |`),
    ''
  ].join('\n');
}

export function structureEvidenceGraphSummary(graph = null) {
  if (!graph) return null;
  return {
    kind: graph.kind,
    status: graph.review_policy?.status || 'unknown',
    edge_evidence_count: graph.qa?.edge_evidence_count || 0,
    corner_evidence_count: graph.qa?.corner_evidence_count || 0,
    plane_hypothesis_count: graph.qa?.plane_hypothesis_count || 0,
    silhouette_profile_count: graph.qa?.silhouette_profile_count || 0,
    review_required: true,
    promotion_allowed: false,
    blockers: graph.review_policy?.blockers || []
  };
}

export function draftViewGraphSummary(graph = null) {
  if (!graph) return null;
  return {
    kind: graph.kind,
    status: graph.review_policy?.status || 'unknown',
    observed_slots: graph.summary?.observed_slots || 0,
    inferred_slots: graph.summary?.inferred_slots || 0,
    partial_slots: graph.summary?.partial_slots || 0,
    unknown_slots: graph.summary?.unknown_slots || 0,
    review_required: true,
    promotion_allowed: false,
    blockers: graph.review_policy?.blockers || [],
    slots: (graph.view_slots || []).map((slot) => ({
      slot_id: slot.slot_id,
      status: slot.status,
      confidence: slot.confidence,
      source_image_ids: slot.source_image_ids || [],
      visible_regions: (slot.visible_regions || []).length,
      unknown_regions: (slot.unknown_regions || []).length
    }))
  };
}

export function objectSurfaceGraphSummary(graph = null) {
  if (!graph) return null;
  return {
    kind: graph.kind,
    domain: graph.domain || 'unknown',
    status: graph.review_policy?.status || 'unknown',
    surface_count: graph.summary?.surface_count || 0,
    feature_candidate_count: graph.summary?.feature_candidate_count || 0,
    review_required: true,
    promotion_allowed: false,
    blockers: graph.review_policy?.blockers || []
  };
}

function draftViewSlot({ slotId, images, structureEvidenceGraph }) {
  const matchedImages = images.filter((image) => slotForView(image.detected_view?.kind || image.view || 'unknown') === slotId);
  const obliqueImages = images.filter((image) => slotForView(image.detected_view?.kind || image.view || 'unknown') === 'oblique_context');
  const hasObserved = matchedImages.length > 0;
  const weakSourceImages = hasObserved ? matchedImages : (slotId === 'front' || slotId === 'left_or_right_side' ? obliqueImages : []);
  const status = hasObserved
    ? 'observed'
    : weakSourceImages.length
      ? 'inferred'
      : slotId === 'oblique_context' && images.length
        ? 'partial'
        : 'unknown';
  const sourceImageIds = weakSourceImages.map((image) => image.image?.path).filter(Boolean);
  const visibleRegions = visibleRegionsForSlot({ slotId, sourceImageIds, status, structureEvidenceGraph, images: weakSourceImages });
  return {
    slot_id: slotId,
    status,
    projection_basis: {
      kind: status === 'observed' ? 'observed_image_projection' : status === 'inferred' ? 'inferred_from_oblique_context' : 'unknown_projection',
      deterministic: true,
      source: 'local_cv_and_image_observation_metadata'
    },
    source_image_ids: sourceImageIds,
    source_evidence_ids: visibleRegions.map((region) => region.source_evidence_id).filter(Boolean),
    visible_regions: visibleRegions,
    unknown_regions: status === 'unknown'
      ? [{ id: `unknown_${slotId}`, reason: 'no_observed_or_inferred_source_view', review_required: true }]
      : status === 'inferred'
        ? [{ id: `weak_${slotId}`, reason: 'view_inferred_from_oblique_context', review_required: true }]
        : [],
    confidence: confidenceForSlot({ status, visibleRegions }),
    review_required: true,
    promotion_allowed: false
  };
}

function visibleRegionsForSlot({ slotId, sourceImageIds, status, structureEvidenceGraph, images }) {
  const planes = (structureEvidenceGraph?.plane_hypotheses || [])
    .filter((plane) => {
      if (sourceImageIds.length && sourceImageIds.includes(plane.source_image)) return true;
      if (slotId === 'front') return /front|primary|facade|main|body|face/u.test(plane.role || '');
      if (slotId === 'left_or_right_side') return /side|left|right|profile|recess/u.test(plane.role || '');
      if (slotId === 'top') return /top|roof|plan/u.test(plane.role || '');
      return status !== 'unknown';
    })
    .slice(0, 8)
    .map((plane) => ({
      id: plane.id,
      role: plane.role,
      source_image: plane.source_image,
      source_evidence_id: plane.id,
      visible_quad_px: plane.visible_quad_px || bboxQuad(plane.bbox_px),
      confidence: plane.confidence,
      review_required: true
    }));
  if (planes.length) return planes;
  return images.flatMap((image, index) => {
    const bbox = image.metrics?.object_bbox || bestObservationBbox(image);
    if (!bbox) return [];
    return [{
      id: `${slotId}_visible_region_${index + 1}`,
      role: `${slotId}_object_silhouette`,
      source_image: image.image?.path || '',
      source_evidence_id: `${image.image?.path || slotId}:silhouette`,
      visible_quad_px: bboxQuad(bbox),
      confidence: status === 'observed' ? 0.56 : 0.34,
      review_required: true
    }];
  });
}

function edgesFromVisionEvidence(visionEvidenceSet = null) {
  if (visionEvidenceSet?.kind !== 'vision_evidence_set_v1') return [];
  return (visionEvidenceSet.edges || []).slice(0, 300).map((edge, index) => {
    const a = edge.a || edge.from_px || edge.start_px || edge.points?.[0] || bboxPoint(edge.bbox_px || edge.bbox, 0);
    const b = edge.b || edge.to_px || edge.end_px || edge.points?.[1] || bboxPoint(edge.bbox_px || edge.bbox, 2);
    const reviewStatus = edge.review_required ? 'needs_review' : edge.rejected ? 'rejected' : 'accepted_for_draft';
    return {
      id: edge.id || `vision_edge_${index + 1}`,
      source_image: edge.source_image || edge.image || '',
      line_px: { a: normalizePoint(a), b: normalizePoint(b) },
      class: edge.class || edge.type || 'unknown_edge',
      source_stage: edge.source_stage || edge.method || 'vision_evidence_set_v1',
      support_score: round(edge.support_score ?? edge.confidence ?? edge.source_pixel_support_ratio ?? 0.5),
      rejection_reason: edge.rejection_reason || (reviewStatus === 'rejected' ? 'rejected_by_source_policy' : null),
      review_status: reviewStatus
    };
  });
}

function edgesFromImageObservations(images = []) {
  const edges = [];
  for (const image of images) {
    for (const observation of image.observations || []) {
      const bbox = observation.bbox || bboxFromPolygon(observation.points);
      if (!bbox) continue;
      const quad = bboxQuad(bbox);
      const role = observation.component_hint || observation.kind || 'observation';
      const reviewStatus = observation.review_required || observation.grounding?.review_required ? 'needs_review' : 'accepted_for_draft';
      rectEdges(quad).forEach((line, edgeIndex) => {
        edges.push({
          id: `${observation.id || role}_bbox_edge_${edgeIndex + 1}`,
          source_image: image.image?.path || '',
          line_px: { a: line[0], b: line[1] },
          class: role,
          source_stage: 'image_observation_bbox',
          support_score: round((observation.confidence ?? 0.45) * 0.72),
          rejection_reason: observation.kind === 'uncertain' ? 'uncertain_observation' : null,
          review_status: reviewStatus
        });
      });
    }
  }
  return dedupeEdges(edges).slice(0, 400);
}

function planesFromBuildingSingleSemanticEvidence(semanticEvidence = null) {
  if (!semanticEvidence) return [];
  const planes = [];
  for (const image of semanticEvidence.images || []) {
    for (const region of image.regions || []) {
      if (region.selected_for_candidate_graph !== true) continue;
      if (!/^visible_plane_/u.test(region.role || '')) continue;
      planes.push({
        id: `plane_${region.role}_${shortHash(`${image.source_image}:${region.id}`)}`,
        role: region.role,
        source_image: image.source_image,
        source_evidence_id: region.id,
        visible_quad_px: ensureQuad(region.polygon_px, region.bbox_px),
        bbox_px: region.bbox_px,
        confidence: round(region.confidence || 0),
        support_score: round(region.confidence || 0),
        source_stage: region.source || 'building_single_semantic_evidence',
        rejection_reason: null,
        review_status: 'needs_review',
        promotion_allowed: false
      });
    }
  }
  return planes;
}

function planesFromImageObservations(images = []) {
  const planes = [];
  for (const image of images) {
    for (const observation of image.observations || []) {
      const role = observation.component_hint || observation.kind || '';
      const bbox = observation.bbox || bboxFromPolygon(observation.points);
      if (!bbox) continue;
      if (!isSurfaceLikeRole(role, observation.kind)) continue;
      planes.push({
        id: `plane_${role}_${shortHash(`${image.image?.path}:${observation.id}`)}`,
        role,
        source_image: image.image?.path || '',
        source_evidence_id: observation.id,
        visible_quad_px: ensureQuad(observation.points, bbox),
        bbox_px: bbox,
        confidence: round(observation.confidence || 0.42),
        support_score: round((observation.confidence || 0.42) * 0.7),
        source_stage: observation.grounding?.method || observation.kind || 'image_observation',
        rejection_reason: observation.kind === 'uncertain' ? 'uncertain_observation' : null,
        review_status: observation.review_required || observation.grounding?.review_required ? 'needs_review' : 'accepted_for_draft',
        promotion_allowed: false
      });
    }
  }
  return planes.slice(0, 120);
}

function cornersFromPlanesAndEdges({ planes = [], edges = [] }) {
  const corners = [];
  for (const plane of planes) {
    for (const [index, point] of (plane.visible_quad_px || []).entries()) {
      corners.push({
        id: `${plane.id}_corner_${index + 1}`,
        source_image: plane.source_image,
        point_px: normalizePoint(point),
        source_evidence_ids: [plane.id],
        support_score: plane.support_score,
        rejection_reason: null,
        review_status: 'needs_review'
      });
    }
  }
  for (const edge of edges.slice(0, 40)) {
    corners.push({
      id: `${edge.id}_start_corner`,
      source_image: edge.source_image,
      point_px: edge.line_px?.a || [],
      source_evidence_ids: [edge.id],
      support_score: round((edge.support_score || 0) * 0.8),
      rejection_reason: edge.rejection_reason,
      review_status: edge.review_status
    });
  }
  return dedupePoints(corners).slice(0, 300);
}

function silhouettesFromImages(images = []) {
  return images.map((image, index) => {
    const bbox = image.metrics?.object_bbox || bestObservationBbox(image) || [0, 0, image.image?.analysis_width || image.image?.width || 0, image.image?.analysis_height || image.image?.height || 0];
    return {
      id: `silhouette_profile_${index + 1}`,
      source_image: image.image?.path || '',
      view: image.detected_view?.kind || 'unknown',
      visible_quad_px: bboxQuad(bbox),
      bbox_px: normalizeBbox(bbox),
      support_score: round(image.quality_report?.usable_for_modeling ? 0.62 : 0.34),
      rejection_reason: image.quality_report?.usable_for_modeling ? null : 'source_image_quality_review_required',
      review_status: 'needs_review'
    };
  });
}

function viewAxisHypothesesFromImages(images = [], edges = []) {
  return images.map((image, index) => {
    const sourceImage = image.image?.path || '';
    const sourceEdges = edges.filter((edge) => edge.source_image === sourceImage);
    const axis = dominantAxis(sourceEdges);
    const cameraHints = image.camera_hints || {};
    const heuristicProjection = cameraHints.projection_model === 'weak_oblique_affine_review_only';
    const hasLineFit = Array.isArray(cameraHints.vanishing_lines) && cameraHints.vanishing_lines.length > 0;
    const rejectionReason = heuristicProjection && !hasLineFit
      ? 'heuristic_vanishing_point_not_line_fit'
      : axis.support < 0.2
        ? 'few_structural_lines_for_axis_fit'
        : null;
    return {
      id: `view_axis_${index + 1}`,
      source_image: sourceImage,
      detected_view: image.detected_view?.kind || 'unknown',
      primary_axis_hint: axis.primary,
      secondary_axis_hint: axis.secondary,
      vanishing_point_px: cameraHints.vanishing_points?.[0] || null,
      horizon_line_px: cameraHints.horizon_line || null,
      support_score: axis.support,
      rejection_reason: rejectionReason,
      review_status: rejectionReason || axis.support < 0.45 ? 'needs_review' : 'accepted_for_draft',
      axis_fit_source: hasLineFit ? 'camera_hints_vanishing_lines' : heuristicProjection ? 'heuristic_projection_placeholder' : 'edge_orientation_histogram'
    };
  });
}

function surfaceLocalFeatureCandidates({ observationSet = {}, surfaces = [] }) {
  const bySlot = new Map(surfaces.map((surface) => [surface.draft_view_slot_id, surface]));
  const candidates = [];
  for (const image of observationSet.images || []) {
    const slotId = slotForView(image.detected_view?.kind || 'unknown');
    const targetSurface = bySlot.get(slotId) || surfaces[0] || null;
    for (const observation of image.observations || []) {
      const role = observation.component_hint || observation.kind || '';
      if (!role || role === 'main_object' || role === 'main_outline' || role === 'symmetry_axis') continue;
      candidates.push({
        id: `surface_detail_${role}_${shortHash(`${image.image?.path}:${observation.id}`)}`,
        role,
        source_image: image.image?.path || '',
        view: image.detected_view?.kind || 'unknown',
        source_observation_id: observation.id,
        candidate_surface_ids: targetSurface ? [targetSurface.id] : [],
        bbox_px: observation.bbox || bboxFromPolygon(observation.points) || [],
        visible_quad_px: ensureQuad(observation.points, observation.bbox),
        source: {
          kind: observation.kind || 'image_observation',
          confidence: round(observation.confidence || 0),
          source_evidence_id: observation.id
        },
        review_required: true,
        promotion_allowed: false,
        blockers: [
          'accepted_draft_view_review_required',
          'accepted_local_detail_review_required'
        ]
      });
    }
  }
  return candidates.slice(0, 160);
}

function structureEvidenceQa({ edgeEvidence, cornerEvidence, planeHypotheses, silhouetteProfiles, viewAxisHypotheses }) {
  const reviewedEdges = edgeEvidence.filter((edge) => edge.review_status !== 'rejected');
  const rejectedEdges = edgeEvidence.filter((edge) => edge.review_status === 'rejected');
  return {
    ok: reviewedEdges.length > 0 || planeHypotheses.length > 0,
    verdict: reviewedEdges.length > 0 || planeHypotheses.length > 0 ? 'review' : 'fail',
    edge_evidence_count: edgeEvidence.length,
    corner_evidence_count: cornerEvidence.length,
    plane_hypothesis_count: planeHypotheses.length,
    silhouette_profile_count: silhouetteProfiles.length,
    view_axis_hypothesis_count: viewAxisHypotheses.length,
    accepted_or_review_edge_count: reviewedEdges.length,
    rejected_edge_count: rejectedEdges.length,
    default_heavy_model_required: false,
    issues: [
      ...(reviewedEdges.length < 4 ? [{ severity: 'warn', rule_id: 'structure_evidence.few_structural_edges', message: 'Few structural edges available for DraftViewGraph.' }] : []),
      ...(planeHypotheses.length < 1 ? [{ severity: 'warn', rule_id: 'structure_evidence.no_plane_hypotheses', message: 'No plane hypotheses available; draft views will rely on silhouettes.' }] : [])
    ]
  };
}

function confidenceForSlot({ status, visibleRegions }) {
  if (status === 'unknown') return 0;
  const basis = status === 'observed' ? 0.58 : status === 'inferred' ? 0.36 : 0.22;
  const evidenceBonus = Math.min(0.3, visibleRegions.length * 0.05);
  return round(basis + evidenceBonus);
}

function deterministicBackends(observationSet = {}) {
  return [
    'deterministic_image_observations',
    ...(observationSet.high_contrast_edge_v1 ? ['high_contrast_edge_v1'] : []),
    ...(observationSet.opencv_edge_v1 ? ['opencv_edge_v1_cpu_optional'] : [])
  ];
}

function optionalEvidenceSources(observationSet = {}) {
  return {
    vlm: Boolean(observationSet.building_single_semantic_evidence_v1?.vlm_cache),
    insid3: observationSet.vision_evidence_set_v1?.optional_backends?.insid3 || null,
    sam: observationSet.vision_evidence_set_v1?.optional_backends?.sam || null,
    grounded_sam: observationSet.vision_evidence_set_v1?.optional_backends?.grounded_sam || null
  };
}

function slotForView(view) {
  if (view === 'front') return 'front';
  if (['left', 'right', 'side', 'profile', 'rear'].includes(view)) return 'left_or_right_side';
  if (['top', 'bird_eye', 'plan'].includes(view)) return 'top';
  return 'oblique_context';
}

function bestObservationBbox(image) {
  const observations = (image.observations || []).filter((observation) => observation.bbox);
  observations.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  return observations[0]?.bbox || null;
}

function isSurfaceLikeRole(role, kind) {
  return kind === 'silhouette'
    || /plane|surface|facade|profile|body|roof|outline|mass|main_object|footprint/u.test(role || '');
}

function dominantAxis(edges = []) {
  if (!edges.length) return { primary: 'unknown', secondary: 'unknown', support: 0 };
  let horizontal = 0;
  let vertical = 0;
  for (const edge of edges) {
    const a = edge.line_px?.a || [];
    const b = edge.line_px?.b || [];
    if (Math.abs((b[0] || 0) - (a[0] || 0)) >= Math.abs((b[1] || 0) - (a[1] || 0))) horizontal += 1;
    else vertical += 1;
  }
  return horizontal >= vertical
    ? { primary: 'image_x_horizontal', secondary: 'image_y_vertical', support: round(Math.max(horizontal, vertical) / Math.max(1, edges.length)) }
    : { primary: 'image_y_vertical', secondary: 'image_x_horizontal', support: round(Math.max(horizontal, vertical) / Math.max(1, edges.length)) };
}

function rectEdges(quad) {
  return quad.map((point, index) => [point, quad[(index + 1) % quad.length]]);
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

function bboxPoint(bbox = [], corner = 0) {
  return bboxQuad(bbox)[corner] || [0, 0];
}

function bboxFromPolygon(points = []) {
  const polygon = normalizePolygon(points);
  if (!polygon.length) return null;
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

function normalizePolygon(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((point) => Array.isArray(point) && point.length >= 2 ? normalizePoint(point) : null)
    .filter(Boolean);
}

function normalizePoint(value = []) {
  return [round(Number(value[0]) || 0), round(Number(value[1]) || 0)];
}

function normalizeBbox(value = []) {
  const numbers = Array.isArray(value) ? value.slice(0, 4).map((item) => Number(item || 0)) : [0, 0, 0, 0];
  while (numbers.length < 4) numbers.push(0);
  return numbers.map((valueItem) => round(valueItem));
}

function dedupeEdges(edges) {
  const seen = new Set();
  const next = [];
  for (const edge of edges) {
    const key = `${edge.source_image}:${edge.class}:${edge.line_px?.a?.join(',')}:${edge.line_px?.b?.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(edge);
  }
  return next;
}

function dedupePoints(points) {
  const seen = new Set();
  const next = [];
  for (const point of points) {
    const key = `${point.source_image}:${point.point_px?.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(point);
  }
  return next;
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < String(value).length; index += 1) {
    hash ^= String(value).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
