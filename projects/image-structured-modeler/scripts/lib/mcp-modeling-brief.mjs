const SEMANTIC_VISION_EVIDENCE_ROLES = [
  'visible_plane_primary',
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary',
  'exterior_hvac_units',
  'upper_window_bands',
  'ground_floor_storefront'
];

const CRITICAL_VISION_EVIDENCE_ROLES = [
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary'
];

export function buildMcpModelingBrief({
  assetSet,
  observationSet,
  candidateGraph,
  modelingBrief,
  promotionReview = null,
  sourcePackageAssessment = null,
  source = {},
  maxCandidates = 80
} = {}) {
  assertTruthy(assetSet, 'assetSet is required');
  assertTruthy(observationSet, 'observationSet is required');
  assertTruthy(candidateGraph, 'candidateGraph is required');
  assertTruthy(modelingBrief, 'modelingBrief is required');

  const candidates = candidateGraph.candidates || [];
  const reasons = uniqueStrings([
    ...(assetSet.gates?.reasons || []),
    ...(modelingBrief.missing_inputs || []),
    ...(promotionReview?.blockers || []),
    ...(sourcePackageAssessment?.input_ready_for_release_work === false ? sourcePackageAssessment.blockers || [] : [])
  ]);
  const canPromoteCandidates = promotionReview?.promotion_allowed === true && reasons.length === 0;
  const canGenerateSketchUpDsl = modelingBrief.compile_allowed === true && canPromoteCandidates && promotionReview?.compile_allowed === true;
  const candidateCatalog = candidates
    .slice()
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, Number(maxCandidates) || 80)
    .map(candidateBriefItem);
  const candidateDisambiguation = buildCandidateDisambiguation(candidateCatalog);
  const roles = new Set(candidates.map((candidate) => candidate.role).filter(Boolean));
  const structureEvidenceGraph = summarizeStructureEvidenceGraph(observationSet.structure_evidence_graph_v1);
  const calibratedViewGraph = summarizeCalibratedViewGraph(observationSet.calibrated_view_graph_v1);
  const cornerChainTopology = summarizeCornerChainTopology(observationSet.corner_chain_topology_v1);
  const draftViewGraph = summarizeDraftViewGraph(observationSet.draft_view_graph_v1);
  const objectSurfaceGraph = summarizeObjectSurfaceGraph(observationSet.object_surface_graph_v1);
  const visionEvidence = summarizeVisionEvidence(observationSet.vision_evidence_set_v1);
  const facadePlaneGraph = summarizeFacadePlaneGraph(observationSet.facade_plane_graph_v1);
  const modelingConstraintSummary = buildModelingConstraintSummary({
    candidateDisambiguation,
    visionEvidence,
    facadePlaneGraph,
    roles,
    canGenerateSketchUpDsl
  });

  const prohibitions = buildProhibitions(roles);
  const roleNotes = buildRoleNotes(roles);
  const groundingRiskRegister = buildGroundingRiskRegister({
    observationSet,
    modelingBrief,
    sourcePackageAssessment,
    canGenerateSketchUpDsl,
    reasons,
    roles
  });
  const agentContract = buildAgentContract({
    source,
    modelingBrief,
    observationSet,
    sourcePackageAssessment,
    canGenerateSketchUpDsl,
    canPromoteCandidates,
    reasons,
    roles,
    prohibitions,
    roleNotes
  });

  return {
    version: 1,
    kind: 'mcp_modeling_brief',
    asset_set_id: assetSet.id,
    profile_id: candidateGraph.profile_id || modelingBrief.profile_id,
    status: modelingBrief.status,
    source,
    compile_permission: {
      can_generate_sketchup_dsl: canGenerateSketchUpDsl,
      can_promote_candidates: canPromoteCandidates,
      reasons: reasons.length ? reasons : ['part_graph_compiler_gate_required']
    },
    source_assets: (assetSet.assets || []).map((asset) => ({
      id: asset.id,
      path: asset.path,
      media_type: asset.media_type,
      view: asset.detected_view || 'unknown',
      quality: asset.quality || 'review'
    })),
    source_package_gate: summarizeSourcePackageGate(sourcePackageAssessment),
    source_request_response_gate: null,
    evidence_summary: {
      views_detected: observationSet.views_detected || [],
      missing_views: observationSet.missing_views || [],
      scale_confidence: Number(observationSet.scale_calibration?.confidence || 0),
      scale_strategy: observationSet.scale_calibration?.strategy || 'unknown',
      scale_default: observationSet.scale_calibration?.default_scale || {},
      scale_measurements: Number(observationSet.scale_calibration?.measurements?.length || 0),
      scale_source_metadata_hints: observationSet.scale_calibration?.source_metadata_hints || [],
      risks: observationSet.quality_report?.risks || [],
      visual_relations: Number(observationSet.visual_relation_graph?.relations?.length || observationSet.visual_relation_graph?.summary?.relations || 0),
      structure_evidence_graph: structureEvidenceGraph,
      calibrated_view_graph: calibratedViewGraph,
      corner_chain_topology: cornerChainTopology,
      draft_view_graph: draftViewGraph,
      object_surface_graph: objectSurfaceGraph,
      vision_evidence: visionEvidence,
      facade_plane_graph: facadePlaneGraph
    },
    structure_evidence_graph: structureEvidenceGraph,
    calibrated_view_graph: calibratedViewGraph,
    corner_chain_topology: cornerChainTopology,
    draft_view_graph: draftViewGraph,
    object_surface_graph: objectSurfaceGraph,
    facade_plane_graph: facadePlaneGraph,
    candidate_summary: {
      candidate_count: candidates.length,
      blocked_count: candidates.filter((candidate) => candidate.promotion?.status === 'blocked').length,
      review_required_count: candidates.filter((candidate) => candidate.promotion?.status === 'review_required').length,
      eligible_count: candidates.filter((candidate) => candidate.promotion?.status === 'eligible').length
    },
    candidate_groups: summarizeCandidateGroups(candidates),
    candidate_catalog: candidateCatalog,
    candidate_disambiguation: candidateDisambiguation,
    modeling_constraint_summary: modelingConstraintSummary,
    grounding_risk_register: groundingRiskRegister,
    agent_contract: agentContract,
    next_actions: buildNextActions({ modelingBrief, promotionReview, reasons }),
    prohibitions,
    role_notes: roleNotes
  };
}

function summarizeStructureEvidenceGraph(graph = null) {
  if (graph?.kind !== 'structure_evidence_graph_v1') {
    return {
      available: false,
      status: 'not_available',
      promotion_allowed: false,
      blockers: []
    };
  }
  return {
    available: true,
    status: graph.review_policy?.status || 'unknown',
    promotion_allowed: graph.review_policy?.promotion_allowed === true,
    review_required: graph.review_policy?.review_required === true,
    blockers: graph.review_policy?.blockers || [],
    edge_evidence_count: graph.qa?.edge_evidence_count || 0,
    corner_evidence_count: graph.qa?.corner_evidence_count || 0,
    plane_hypothesis_count: graph.qa?.plane_hypothesis_count || 0,
    silhouette_profile_count: graph.qa?.silhouette_profile_count || 0,
    default_heavy_model_required: graph.qa?.default_heavy_model_required === true,
    edge_evidence: (graph.edge_evidence || []).slice(0, 24).map((edge) => ({
      id: edge.id,
      class: edge.class || 'unknown',
      source_image: edge.source_image || '',
      support_score: Number(edge.support_score || 0),
      review_status: edge.review_status || 'unknown',
      rejection_reason: edge.rejection_reason || null
    })),
    plane_hypotheses: (graph.plane_hypotheses || []).slice(0, 24).map((plane) => ({
      id: plane.id,
      role: plane.role || 'unknown',
      source_image: plane.source_image || '',
      confidence: Number(plane.confidence || 0),
      review_status: plane.review_status || 'unknown',
      promotion_allowed: plane.promotion_allowed === true
    }))
  };
}

function summarizeCalibratedViewGraph(graph = null) {
  if (graph?.kind !== 'calibrated_view_graph_v1') {
    return {
      available: false,
      status: 'not_available',
      projection_model: 'unknown',
      promotion_allowed: false,
      axis_families: [],
      blockers: []
    };
  }
  return {
    available: true,
    status: graph.review_policy?.status || 'unknown',
    projection_model: graph.projection_model || 'unknown',
    accepted_calibrated_view_review_required: graph.review_policy?.accepted_calibrated_view_review_required === true,
    review_required: graph.review_policy?.review_required === true,
    promotion_allowed: graph.review_policy?.promotion_allowed === true,
    blockers: graph.review_policy?.blockers || [],
    finite_vanishing_point_count: graph.summary?.finite_vanishing_point_count || 0,
    infinite_axis_count: graph.summary?.infinite_axis_count || 0,
    projection_warnings: graph.projection_warnings || [],
    axis_families: (graph.axis_families || []).map((axis) => ({
      id: axis.id,
      axis: axis.axis,
      label: axis.label || '',
      image_line_ids: axis.image_line_ids || [],
      vanishing_type: axis.vanishing_type || 'unknown',
      vanishing_point_px: axis.vanishing_point_px || null,
      confidence: Number(axis.confidence || 0),
      promotion_allowed: axis.promotion_allowed === true
    }))
  };
}

function summarizeCornerChainTopology(graph = null) {
  if (graph?.kind !== 'corner_chain_topology_v1') {
    return {
      available: false,
      status: 'not_available',
      promotion_allowed: false,
      topology_hypotheses: [],
      blockers: []
    };
  }
  return {
    available: true,
    status: graph.review_policy?.status || 'unknown',
    accepted_topology_review_required: graph.review_policy?.accepted_topology_review_required === true,
    review_required: graph.review_policy?.review_required === true,
    promotion_allowed: graph.review_policy?.promotion_allowed === true,
    blockers: graph.review_policy?.blockers || [],
    corner_count: graph.summary?.corner_count || 0,
    edge_chain_count: graph.summary?.edge_chain_count || 0,
    accepted_topology_id: graph.summary?.accepted_topology_id || null,
    edge_chains: (graph.edge_chains || []).map((chain) => ({
      id: chain.id,
      ordered_corner_ids: chain.ordered_corner_ids || [],
      edges: (chain.edges || []).map((edge) => ({
        id: edge.id,
        axis: edge.axis,
        role: edge.role,
        depth_role: edge.depth_role
      })),
      promotion_allowed: chain.promotion_allowed === true
    })),
    topology_hypotheses: (graph.topology_hypotheses || []).map((hypothesis) => ({
      id: hypothesis.id,
      topology: hypothesis.topology,
      status: hypothesis.status,
      edge_axis_sequence: hypothesis.edge_axis_sequence || [],
      depth_order: hypothesis.depth_order || [],
      footprint_point_count: hypothesis.footprint_local?.length || 0,
      promotion_allowed: hypothesis.promotion_allowed === true
    }))
  };
}

function summarizeDraftViewGraph(graph = null) {
  if (graph?.kind !== 'draft_view_graph_v1') {
    return {
      available: false,
      status: 'not_available',
      promotion_allowed: false,
      slots: [],
      blockers: []
    };
  }
  return {
    available: true,
    status: graph.review_policy?.status || 'unknown',
    accepted_draft_view_review_required: graph.review_policy?.accepted_draft_view_review_required === true,
    promotion_allowed: graph.review_policy?.promotion_allowed === true,
    review_required: graph.review_policy?.review_required === true,
    blockers: graph.review_policy?.blockers || [],
    observed_slots: graph.summary?.observed_slots || 0,
    inferred_slots: graph.summary?.inferred_slots || 0,
    partial_slots: graph.summary?.partial_slots || 0,
    unknown_slots: graph.summary?.unknown_slots || 0,
    slots: (graph.view_slots || []).map((slot) => ({
      slot_id: slot.slot_id,
      status: slot.status,
      confidence: Number(slot.confidence || 0),
      source_image_ids: slot.source_image_ids || [],
      source_evidence_ids: slot.source_evidence_ids || [],
      visible_region_count: slot.visible_regions?.length || 0,
      unknown_regions: slot.unknown_regions || [],
      promotion_allowed: slot.promotion_allowed === true
    }))
  };
}

function summarizeObjectSurfaceGraph(graph = null) {
  if (graph?.kind !== 'object_surface_graph_v1') {
    return {
      available: false,
      status: 'not_available',
      promotion_allowed: false,
      surfaces: [],
      surface_local_feature_candidates: [],
      blockers: []
    };
  }
  return {
    available: true,
    domain: graph.domain || 'unknown',
    status: graph.review_policy?.status || 'unknown',
    promotion_allowed: graph.review_policy?.promotion_allowed === true,
    review_required: graph.review_policy?.review_required === true,
    blockers: graph.review_policy?.blockers || [],
    surface_count: graph.summary?.surface_count || 0,
    feature_candidate_count: graph.summary?.feature_candidate_count || 0,
    surfaces: (graph.surfaces || []).map((surface) => ({
      id: surface.id,
      role: surface.role,
      draft_view_slot_id: surface.draft_view_slot_id,
      status: surface.status,
      promotion_allowed: surface.promotion_allowed === true,
      blockers: surface.blockers || []
    })),
    surface_local_feature_candidates: (graph.surface_local_feature_candidates || []).slice(0, 80).map((detail) => ({
      id: detail.id,
      role: detail.role,
      source_image: detail.source_image || '',
      view: detail.view || '',
      candidate_surface_ids: detail.candidate_surface_ids || [],
      promotion_allowed: detail.promotion_allowed === true,
      blockers: detail.blockers || []
    }))
  };
}

function summarizeVisionEvidence(visionEvidenceSet = null) {
  if (visionEvidenceSet?.kind !== 'vision_evidence_set_v1') {
    return {
      available: false,
      review_required: false,
      semantic_review_roles: [],
      semantic_evidence_instances: [],
      modeling_handoff: []
    };
  }
  const semanticReviewRoles = Array.from(new Set([
    ...(visionEvidenceSet.regions || []),
    ...(visionEvidenceSet.masks || [])
  ]
    .filter((item) => item.review_required === true)
    .map((item) => item.class)
    .filter((role) => SEMANTIC_VISION_EVIDENCE_ROLES.includes(role))));
  return {
    available: true,
    review_required: visionEvidenceSet.qa?.verdict !== 'pass' || semanticReviewRoles.length > 0,
    verdict: visionEvidenceSet.qa?.verdict || 'unknown',
    masks: visionEvidenceSet.masks?.length || 0,
    edges: visionEvidenceSet.edges?.length || 0,
    regions: visionEvidenceSet.regions?.length || 0,
    relations: visionEvidenceSet.relations?.length || 0,
    scale_anchors: visionEvidenceSet.scale_anchors?.length || 0,
    default_heavy_model_required: visionEvidenceSet.qa?.default_heavy_model_required === true,
    planar_groundplan_allowed: visionEvidenceSet.view_ground_plane?.summary?.planar_groundplan_allowed === true,
    top_view_ground_plane_confidence: Number(visionEvidenceSet.view_ground_plane?.summary?.top_view_ground_plane_confidence || 0),
    semantic_review_roles: semanticReviewRoles,
    semantic_evidence_instances: semanticEvidenceInstancesForMcpBrief(visionEvidenceSet),
    modeling_handoff: visionEvidenceModelingHandoff(visionEvidenceSet)
  };
}

function summarizeFacadePlaneGraph(facadePlaneGraph = null) {
  if (facadePlaneGraph?.kind !== 'facade_plane_graph_v1') {
    return {
      available: false,
      status: 'not_available',
      accepted_plane_review_required: false,
      promotion_allowed: false,
      review_required: false,
      planes: [],
      plane_local_detail_candidates: [],
      blockers: []
    };
  }
  return {
    available: true,
    status: facadePlaneGraph.review_policy?.status || 'unknown',
    accepted_plane_review_required: facadePlaneGraph.review_policy?.accepted_plane_review_required === true,
    promotion_allowed: facadePlaneGraph.review_policy?.promotion_allowed === true,
    review_required: facadePlaneGraph.review_policy?.review_required === true,
    plane_count: facadePlaneGraph.summary?.plane_count || 0,
    detail_candidate_count: facadePlaneGraph.summary?.detail_candidate_count || 0,
    visible_plane_ids: facadePlaneGraph.summary?.visible_plane_ids || [],
    blockers: facadePlaneGraph.review_policy?.blockers || [],
    planes: (facadePlaneGraph.planes || []).map((plane) => ({
      id: plane.id,
      role: plane.role || plane.id,
      source_image: plane.source_image || '',
      view: plane.view || '',
      visible_quad_px: normalizeVisionEvidencePolygon(plane.visible_quad_px || []),
      orientation_hint: plane.orientation_hint || {},
      adjacency: plane.adjacency || [],
      occlusion_order: plane.occlusion_order || {},
      must_not_merge_with: plane.must_not_merge_with || [],
      source: plane.source || {},
      review_required: plane.review_required === true,
      promotion_allowed: plane.promotion_allowed === true
    })),
    plane_local_detail_candidates: (facadePlaneGraph.plane_local_detail_candidates || []).map((detail) => ({
      id: detail.id,
      role: detail.role,
      source_image: detail.source_image || '',
      view: detail.view || '',
      candidate_plane_ids: detail.candidate_plane_ids || [],
      attachment_hint: detail.attachment_hint || '',
      visible_quad_px: normalizeVisionEvidencePolygon(detail.visible_quad_px || []),
      bbox_px: normalizeVisionEvidenceBbox(detail.bbox_px || []),
      source: detail.source || {},
      review_required: detail.review_required === true,
      promotion_allowed: detail.promotion_allowed === true,
      blockers: detail.blockers || []
    }))
  };
}

function semanticEvidenceInstancesForMcpBrief(visionEvidenceSet = {}) {
  const instances = [];
  for (const evidence of [...(visionEvidenceSet.regions || []), ...(visionEvidenceSet.masks || [])]) {
    const role = evidence.class || '';
    if (!SEMANTIC_VISION_EVIDENCE_ROLES.includes(role)) continue;
    const sourceId = evidence.provenance?.source_id || evidence.id || '';
    instances.push({
      role,
      evidence_id: evidence.id || sourceId || `${role}_evidence`,
      source_id: sourceId,
      source_image: evidence.source_image || '',
      view: inferVisionEvidenceView(evidence),
      class: role,
      kind: evidence.kind || 'region',
      bbox_px: normalizeVisionEvidenceBbox(evidence.bbox_px || evidence.bbox || []),
      polygon_px: normalizeVisionEvidencePolygon(evidence.polygon_px || evidence.points || []),
      image_space_geometry: evidence.image_space_geometry || evidence.provenance?.image_space_geometry || '',
      polygon_derivation: evidence.polygon_derivation || evidence.provenance?.polygon_derivation || '',
      projection_model: evidence.projection_model || evidence.provenance?.projection_model || '',
      perspective_strength: evidence.perspective_strength || evidence.provenance?.perspective_strength || '',
      orthographic_projection_allowed: evidence.orthographic_projection_allowed === true || evidence.provenance?.orthographic_projection_allowed === true,
      confidence: round(evidence.confidence || 0),
      backend: evidence.backend || evidence.provenance?.method || '',
      source_stage: evidence.source_stage || evidence.provenance?.source_stage || '',
      semantic_source: evidence.semantic_source || evidence.provenance?.semantic_source || '',
      semantic_evidence_id: evidence.semantic_evidence_id || evidence.provenance?.semantic_evidence_id || '',
      semantic_source_priority: evidence.semantic_source_priority ?? evidence.provenance?.semantic_source_priority ?? null,
      blocked_interpretations: evidence.blocked_interpretations || evidence.provenance?.blocked_interpretations || [],
      review_required: evidence.review_required === true
    });
  }
  const seen = new Set();
  return instances
    .filter((instance) => instance.role && instance.evidence_id && (instance.bbox_px.length === 4 || instance.polygon_px.length >= 3))
    .sort((a, b) => semanticEvidenceInstancePriority(a) - semanticEvidenceInstancePriority(b)
      || (b.confidence || 0) - (a.confidence || 0)
      || String(a.source_id).localeCompare(String(b.source_id)))
    .filter((instance) => {
      const key = `${instance.role}:${instance.source_id}:${instance.bbox_px.join(',')}:${instance.polygon_px.map((point) => point.join(',')).join(';')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 32);
}

function visionEvidenceModelingHandoff(visionEvidenceSet = {}) {
  const instances = semanticEvidenceInstancesForMcpBrief(visionEvidenceSet);
  const byRole = new Map();
  for (const instance of instances) {
    const group = byRole.get(instance.role) || [];
    group.push(instance);
    byRole.set(instance.role, group);
  }
  return Array.from(byRole.entries())
    .sort(([a], [b]) => semanticEvidenceInstancePriority({ role: a }) - semanticEvidenceInstancePriority({ role: b }) || a.localeCompare(b))
    .map(([role, roleInstances]) => {
      const spec = roleDisambiguationSpec(role);
      const primaryInstance = roleInstances[0] || null;
      return {
        role,
        instance_count: roleInstances.length,
        primary_instance: primaryInstance ? semanticEvidenceInstanceLocator(primaryInstance) : null,
        evidence_tokens: uniqueStrings([
          `role=${role}`,
          primaryInstance ? `view=${primaryInstance.view}` : '',
          primaryInstance ? `source_id=${primaryInstance.source_id || primaryInstance.evidence_id}` : '',
          primaryInstance?.semantic_evidence_id ? `semantic_evidence_id=${primaryInstance.semantic_evidence_id}` : '',
          primaryInstance?.semantic_source ? `semantic_source=${primaryInstance.semantic_source}` : '',
          primaryInstance?.projection_model ? `projection_model=${primaryInstance.projection_model}` : '',
          primaryInstance?.image_space_geometry ? `image_space_geometry=${primaryInstance.image_space_geometry}` : '',
          primaryInstance?.polygon_derivation ? `polygon_derivation=${primaryInstance.polygon_derivation}` : '',
          primaryInstance?.orthographic_projection_allowed === false ? 'orthographic_projection_allowed=false' : '',
          primaryInstance?.polygon_px?.length ? `polygon=${polygonToken(primaryInstance.polygon_px)}` : '',
          primaryInstance ? `bbox=${primaryInstance.bbox_px.join(',')}` : ''
        ]),
        geometry_interpretation: spec.geometry_interpretation,
        modeling_decision: spec.modeling_decision,
        allowed_semantics: spec.allowed_semantics,
        blocked_interpretations: spec.blocked_interpretations,
        required_confirmations: spec.required_confirmations,
        handoff_text: spec.handoff_text,
        review_required: true,
        geometry_promotion_allowed: false
      };
    });
}

function semanticEvidenceInstanceLocator(instance = {}) {
  return {
    evidence_id: instance.evidence_id || '',
    source_id: instance.source_id || '',
    source_image: instance.source_image || '',
    view: instance.view || 'unknown',
    bbox_px: Array.isArray(instance.bbox_px) ? instance.bbox_px : [],
    polygon_px: Array.isArray(instance.polygon_px) ? instance.polygon_px : [],
    image_space_geometry: instance.image_space_geometry || '',
    polygon_derivation: instance.polygon_derivation || '',
    projection_model: instance.projection_model || '',
    perspective_strength: instance.perspective_strength || '',
    orthographic_projection_allowed: instance.orthographic_projection_allowed === true,
    confidence: Number(instance.confidence || 0)
  };
}

function semanticEvidenceInstancePriority(instance) {
  const index = CRITICAL_VISION_EVIDENCE_ROLES.indexOf(instance.role);
  return index === -1 ? 999 : index;
}

function inferVisionEvidenceView(evidence = {}) {
  const tokens = [
    evidence.view,
    evidence.provenance?.view,
    evidence.provenance?.source_id,
    evidence.id,
    evidence.source_image
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  for (const token of tokens) {
    if (/(^|[_/\-.])front([_/\-.]|$)/.test(token)) return 'front';
    if (/(^|[_/\-.])rear([_/\-.]|$)/.test(token)) return 'rear';
    if (/(^|[_/\-.])left([_/\-.]|$)/.test(token)) return 'left';
    if (/(^|[_/\-.])right([_/\-.]|$)/.test(token)) return 'right';
    if (/(^|[_/\-.])side([_/\-.]|$)/.test(token)) return 'side';
    if (/(^|[_/\-.])oblique([_/\-.]|$)/.test(token)) return 'oblique';
    if (/(^|[_/\-.])top([_/\-.]|$)/.test(token)) return 'top';
  }
  return 'unknown';
}

function normalizeVisionEvidenceBbox(value = []) {
  if (!Array.isArray(value) || value.length < 4) return [];
  return value.slice(0, 4).map((number) => Number(number || 0));
}

function normalizeVisionEvidencePolygon(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => Array.isArray(point) && point.length >= 2
      ? [Number(point[0] || 0), Number(point[1] || 0)]
      : null)
    .filter(Boolean);
}

export function renderMcpModelingBriefMarkdown(brief) {
  const lines = [];
  lines.push('# MCP Modeling Brief');
  lines.push('');
  lines.push(`- asset_set_id: \`${brief.asset_set_id}\``);
  lines.push(`- profile_id: \`${brief.profile_id}\``);
  lines.push(`- status: \`${brief.status}\``);
  lines.push(`- can_generate_sketchup_dsl: \`${brief.compile_permission.can_generate_sketchup_dsl}\``);
  lines.push(`- can_promote_candidates: \`${brief.compile_permission.can_promote_candidates}\``);
  lines.push('');
  lines.push('## Compile Permission');
  for (const reason of brief.compile_permission.reasons) lines.push(`- ${reason}`);
  lines.push('');
  lines.push('## Source Assets');
  lines.push('| id | view | quality | media | path |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const asset of brief.source_assets) {
    lines.push(`| ${asset.id} | ${asset.view} | ${asset.quality} | ${asset.media_type} | ${asset.path} |`);
  }
  lines.push('');
  if (brief.source_package_gate) {
    lines.push('## Source Package Gate');
    lines.push(`- status: \`${brief.source_package_gate.status}\``);
    lines.push(`- input_ready_for_release_work: \`${String(brief.source_package_gate.input_ready_for_release_work)}\``);
    lines.push(`- release_ready: \`${String(brief.source_package_gate.release_ready)}\``);
    lines.push(`- scale_strategy: \`${brief.source_package_gate.scale_strategy || 'unknown'}\``);
    lines.push(`- release_checklist_required_check_ids: ${joinOrNone(brief.source_package_gate.release_checklist_required_check_ids || [])}`);
    lines.push(`- release_checklist_failed_required_check_ids: ${joinOrNone(brief.source_package_gate.release_checklist_failed_required_check_ids || [])}`);
    lines.push(`- release_checklist_review_required_check_ids: ${joinOrNone(brief.source_package_gate.release_checklist_review_required_check_ids || [])}`);
    lines.push(`- blockers: ${joinOrNone(brief.source_package_gate.blockers)}`);
    lines.push(`- next_actions: ${joinOrNone(brief.source_package_gate.next_actions)}`);
    lines.push(`- view_evidence: ${viewEvidenceSummaryText(brief.source_package_gate.view_evidence || [])}`);
    lines.push(`- semantic_role_evidence: ${semanticRoleEvidenceSummaryText(brief.source_package_gate.semantic_role_evidence || [])}`);
    lines.push(`- semantic_evidence_quality: ${brief.source_package_gate.semantic_evidence_quality?.status || 'unknown'}`);
    if (brief.source_package_gate.source_request) {
      lines.push(`- source_request_status: \`${brief.source_package_gate.source_request.status}\``);
      lines.push(`- source_request_blocked_outputs: ${joinOrNone(brief.source_package_gate.source_request.blocked_until_satisfied)}`);
    }
	    lines.push('');
	  }
  if (brief.source_request_response_gate) {
    const response = brief.source_request_response_gate;
    lines.push('## Source Request Response Gate');
    lines.push(`- status: \`${response.status}\``);
    lines.push(`- ok: \`${String(response.ok)}\``);
    lines.push(`- expected_check_ids: ${joinOrNone(response.expected_check_ids || [])}`);
    lines.push(`- missing_expected_check_ids: ${joinOrNone(response.missing_expected_check_ids || [])}`);
    lines.push(`- unexpected_requested_check_ids: ${joinOrNone(response.unexpected_requested_check_ids || [])}`);
    lines.push(`- unsatisfied_check_ids: ${joinOrNone(response.unsatisfied_check_ids || [])}`);
    lines.push(`- requested_view_evidence: ${viewEvidenceSummaryText(response.view_evidence?.requested_view_evidence || [])}`);
    lines.push(`- semantic_requested_roles: ${joinOrNone(response.semantic_evidence?.requested_roles || [])}`);
    lines.push(`- semantic_unsatisfied_roles: ${joinOrNone(response.semantic_evidence?.unsatisfied_roles || [])}`);
    lines.push(`- semantic_requested_role_evidence: ${semanticRoleEvidenceSummaryText(response.semantic_evidence?.requested_role_evidence || [])}`);
    if (response.unsatisfied_check_details?.length) {
      lines.push('');
      lines.push('| check | current | detail |');
      lines.push('| --- | --- | --- |');
      for (const detail of response.unsatisfied_check_details) {
        lines.push(`| ${detail.id} | ${detail.current_status} | ${detail.detail} |`);
      }
    }
    lines.push('');
  }
  if (brief.agent_contract) {
    lines.push('## Agent Contract');
    lines.push(`- status: \`${brief.agent_contract.status}\``);
    lines.push(`- sketchup_dsl_allowed: \`${String(brief.agent_contract.output_policy?.sketchup_dsl_allowed === true)}\``);
    lines.push(`- allowed_outputs: ${joinOrNone(brief.agent_contract.output_policy?.allowed_outputs || [])}`);
    lines.push(`- blocked_outputs: ${joinOrNone(brief.agent_contract.output_policy?.blocked_outputs || [])}`);
    lines.push(`- release_checklist_required_check_ids: ${joinOrNone(brief.agent_contract.output_policy?.release_checklist_required_check_ids || [])}`);
    lines.push(`- release_checklist_failed_required_check_ids: ${joinOrNone(brief.agent_contract.output_policy?.release_checklist_failed_required_check_ids || [])}`);
    lines.push(`- release_checklist_review_required_check_ids: ${joinOrNone(brief.agent_contract.output_policy?.release_checklist_review_required_check_ids || [])}`);
    lines.push('');
    lines.push('### Authoritative Artifacts');
    lines.push('| role | required | path |');
    lines.push('| --- | --- | --- |');
    for (const artifact of brief.agent_contract.authoritative_artifacts || []) {
      lines.push(`| ${artifact.role} | ${artifact.required ? 'yes' : 'no'} | ${artifact.path} |`);
    }
    lines.push('');
    lines.push('### Evidence Rules');
    for (const rule of brief.agent_contract.evidence_rules || []) lines.push(`- ${rule}`);
    if (brief.agent_contract.required_confirmations?.length) {
      lines.push('');
      lines.push('### Required Confirmations');
      for (const item of brief.agent_contract.required_confirmations) lines.push(`- ${item}`);
    }
    if (brief.agent_contract.geometry_boundaries?.length) {
      lines.push('');
      lines.push('### Geometry Boundaries');
      for (const item of brief.agent_contract.geometry_boundaries) lines.push(`- ${item}`);
    }
    lines.push('');
  }
  lines.push('## Evidence Summary');
  lines.push(`- views_detected: ${joinOrNone(brief.evidence_summary.views_detected)}`);
  lines.push(`- missing_views: ${joinOrNone(brief.evidence_summary.missing_views)}`);
  lines.push(`- scale_confidence: ${brief.evidence_summary.scale_confidence}`);
  lines.push(`- scale_strategy: ${brief.evidence_summary.scale_strategy}`);
  lines.push(`- scale_source_metadata_hints: ${brief.evidence_summary.scale_source_metadata_hints?.length || 0}`);
  lines.push(`- risks: ${joinOrNone(brief.evidence_summary.risks)}`);
  lines.push(`- visual_relations: ${brief.evidence_summary.visual_relations}`);
  if (brief.evidence_summary.vision_evidence?.available) {
    const visionEvidence = brief.evidence_summary.vision_evidence;
    const semanticInstances = visionEvidence.semantic_evidence_instances || [];
    lines.push(`- vision_evidence_available: \`${String(visionEvidence.available === true)}\``);
    lines.push(`- vision_evidence_semantic_roles: ${joinOrNone(visionEvidence.semantic_review_roles || [])}`);
    lines.push(`- vision_evidence_semantic_instances: ${semanticInstances.length}`);
    if (semanticInstances.length) {
      lines.push('');
      lines.push('### VisionEvidence Semantic Instances');
      lines.push('| role | view | source id | projection | image geometry | ortho allowed | polygon px | bbox px | confidence |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | ---: |');
      for (const instance of semanticInstances.slice(0, 12)) {
        lines.push(`| ${instance.role} | ${instance.view} | ${escapeMarkdownTable(instance.source_id || instance.evidence_id || '')} | ${escapeMarkdownTable(instance.projection_model || 'unknown')} | ${escapeMarkdownTable(instance.image_space_geometry || 'unknown')} | ${String(instance.orthographic_projection_allowed === true)} | ${escapeMarkdownTable(polygonToken(instance.polygon_px || []))} | ${escapeMarkdownTable((instance.bbox_px || []).join(', '))} | ${instance.confidence} |`);
      }
    }
    const modelingHandoff = visionEvidence.modeling_handoff || [];
    if (modelingHandoff.length) {
      lines.push('');
      lines.push('### VisionEvidence Modeling Handoff');
      lines.push('| role | decision | primary projection | ortho allowed | primary polygon | primary bbox | blocked interpretations | required confirmations |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const item of modelingHandoff.slice(0, 12)) {
        const primaryBbox = item.primary_instance?.bbox_px?.join(', ') || '';
        const primaryPolygon = polygonToken(item.primary_instance?.polygon_px || []);
        const primaryProjection = item.primary_instance?.projection_model || 'unknown';
        lines.push(`| ${item.role} | ${item.modeling_decision} | ${escapeMarkdownTable(primaryProjection)} | ${String(item.primary_instance?.orthographic_projection_allowed === true)} | ${escapeMarkdownTable(primaryPolygon)} | ${escapeMarkdownTable(primaryBbox)} | ${joinOrNone(item.blocked_interpretations || [])} | ${joinOrNone(item.required_confirmations || [])} |`);
      }
    }
  }
  lines.push('');
  if (brief.calibrated_view_graph?.available || brief.evidence_summary.calibrated_view_graph?.available) {
    const calibratedViewGraph = brief.calibrated_view_graph || brief.evidence_summary.calibrated_view_graph;
    lines.push('## Calibrated View Graph');
    lines.push(`- status: \`${calibratedViewGraph.status || 'unknown'}\``);
    lines.push(`- projection_model: \`${calibratedViewGraph.projection_model || 'unknown'}\``);
    lines.push(`- promotion_allowed: \`${String(calibratedViewGraph.promotion_allowed === true)}\``);
    lines.push(`- blockers: ${joinOrNone(calibratedViewGraph.blockers || [])}`);
    lines.push(`- projection_warnings: ${joinOrNone(calibratedViewGraph.projection_warnings || [])}`);
    lines.push('');
    lines.push('| axis | vanishing | confidence | lines | promotion allowed |');
    lines.push('| --- | --- | ---: | --- | --- |');
    for (const axis of calibratedViewGraph.axis_families || []) {
      lines.push(`| ${axis.axis} | ${axis.vanishing_type || 'unknown'} | ${axis.confidence || 0} | ${joinOrNone(axis.image_line_ids || [])} | ${String(axis.promotion_allowed === true)} |`);
    }
    lines.push('');
  }
  if (brief.corner_chain_topology?.available || brief.evidence_summary.corner_chain_topology?.available) {
    const cornerChainTopology = brief.corner_chain_topology || brief.evidence_summary.corner_chain_topology;
    lines.push('## Corner Chain Topology');
    lines.push(`- status: \`${cornerChainTopology.status || 'unknown'}\``);
    lines.push(`- accepted_topology_id: \`${cornerChainTopology.accepted_topology_id || 'none'}\``);
    lines.push(`- promotion_allowed: \`${String(cornerChainTopology.promotion_allowed === true)}\``);
    lines.push(`- blockers: ${joinOrNone(cornerChainTopology.blockers || [])}`);
    lines.push('');
    lines.push('### Edge Chains');
    lines.push('| chain | corners | edges | promotion allowed |');
    lines.push('| --- | --- | --- | --- |');
    for (const chain of cornerChainTopology.edge_chains || []) {
      const edges = (chain.edges || []).map((edge) => `${edge.id}:${edge.axis}:${edge.depth_role}`).join('; ');
      lines.push(`| ${chain.id} | ${joinOrNone(chain.ordered_corner_ids || [])} | ${escapeMarkdownTable(edges)} | ${String(chain.promotion_allowed === true)} |`);
    }
    lines.push('');
    lines.push('### Topology Hypotheses');
    lines.push('| id | topology | status | axes | depth order | footprint points | promotion allowed |');
    lines.push('| --- | --- | --- | --- | --- | ---: | --- |');
    for (const hypothesis of cornerChainTopology.topology_hypotheses || []) {
      const depthOrder = (hypothesis.depth_order || []).map((order) => `${order.behind} behind ${order.in_front}`).join('; ');
      lines.push(`| ${hypothesis.id} | ${hypothesis.topology} | ${hypothesis.status} | ${(hypothesis.edge_axis_sequence || []).join(' -> ')} | ${escapeMarkdownTable(depthOrder)} | ${hypothesis.footprint_point_count || 0} | ${String(hypothesis.promotion_allowed === true)} |`);
    }
    lines.push('');
  }
  if (brief.draft_view_graph?.available || brief.evidence_summary.draft_view_graph?.available) {
    const draftViewGraph = brief.draft_view_graph || brief.evidence_summary.draft_view_graph;
    lines.push('## Draft View Graph');
    lines.push(`- status: \`${draftViewGraph.status || 'unknown'}\``);
    lines.push(`- accepted_draft_view_review_required: \`${String(draftViewGraph.accepted_draft_view_review_required === true)}\``);
    lines.push(`- promotion_allowed: \`${String(draftViewGraph.promotion_allowed === true)}\``);
    lines.push(`- blockers: ${joinOrNone(draftViewGraph.blockers || [])}`);
    lines.push('');
    lines.push('| slot | status | confidence | source images | visible regions | promotion allowed |');
    lines.push('| --- | --- | ---: | --- | ---: | --- |');
    for (const slot of draftViewGraph.slots || []) {
      lines.push(`| ${slot.slot_id} | ${slot.status} | ${slot.confidence} | ${joinOrNone(slot.source_image_ids || [])} | ${slot.visible_region_count || 0} | ${String(slot.promotion_allowed === true)} |`);
    }
    lines.push('');
  }
  if (brief.structure_evidence_graph?.available || brief.evidence_summary.structure_evidence_graph?.available) {
    const structureEvidenceGraph = brief.structure_evidence_graph || brief.evidence_summary.structure_evidence_graph;
    lines.push('## Structure Evidence Graph');
    lines.push(`- status: \`${structureEvidenceGraph.status || 'unknown'}\``);
    lines.push(`- edges: \`${structureEvidenceGraph.edge_evidence_count || 0}\``);
    lines.push(`- corners: \`${structureEvidenceGraph.corner_evidence_count || 0}\``);
    lines.push(`- planes: \`${structureEvidenceGraph.plane_hypothesis_count || 0}\``);
    lines.push(`- default_heavy_model_required: \`${String(structureEvidenceGraph.default_heavy_model_required === true)}\``);
    lines.push('');
  }
  if (brief.object_surface_graph?.available || brief.evidence_summary.object_surface_graph?.available) {
    const objectSurfaceGraph = brief.object_surface_graph || brief.evidence_summary.object_surface_graph;
    lines.push('## Object Surface Graph');
    lines.push(`- domain: \`${objectSurfaceGraph.domain || 'unknown'}\``);
    lines.push(`- status: \`${objectSurfaceGraph.status || 'unknown'}\``);
    lines.push(`- promotion_allowed: \`${String(objectSurfaceGraph.promotion_allowed === true)}\``);
    lines.push(`- blockers: ${joinOrNone(objectSurfaceGraph.blockers || [])}`);
    lines.push('');
    lines.push('### Surfaces');
    lines.push('| id | role | draft view | status | promotion allowed |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const surface of objectSurfaceGraph.surfaces || []) {
      lines.push(`| ${surface.id} | ${surface.role} | ${surface.draft_view_slot_id} | ${surface.status} | ${String(surface.promotion_allowed === true)} |`);
    }
    const details = objectSurfaceGraph.surface_local_feature_candidates || [];
    if (details.length) {
      lines.push('');
      lines.push('### Surface-Local Detail Candidates');
      lines.push('| id | role | candidate surfaces | promotion allowed | blockers |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const detail of details) {
        lines.push(`| ${detail.id} | ${detail.role} | ${joinOrNone(detail.candidate_surface_ids || [])} | ${String(detail.promotion_allowed === true)} | ${joinOrNone(detail.blockers || [])} |`);
      }
    }
    lines.push('');
  }
  if (brief.facade_plane_graph?.available || brief.evidence_summary.facade_plane_graph?.available) {
    const facadePlaneGraph = brief.facade_plane_graph || brief.evidence_summary.facade_plane_graph;
    lines.push('## Facade Plane Graph');
    lines.push(`- status: \`${facadePlaneGraph.status || 'unknown'}\``);
    lines.push(`- accepted_plane_review_required: \`${String(facadePlaneGraph.accepted_plane_review_required === true)}\``);
    lines.push(`- promotion_allowed: \`${String(facadePlaneGraph.promotion_allowed === true)}\``);
    lines.push(`- blockers: ${joinOrNone(facadePlaneGraph.blockers || [])}`);
    lines.push('');
    lines.push('### Visible Planes');
    lines.push('| id | view | orientation | occlusion | must not merge with | visible quad | promotion allowed |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const plane of facadePlaneGraph.planes || []) {
      lines.push(`| ${plane.id} | ${plane.view || 'unknown'} | ${escapeMarkdownTable(plane.orientation_hint?.kind || 'unknown')} | ${escapeMarkdownTable(plane.occlusion_order?.relation_to_camera || 'unknown')} | ${joinOrNone(plane.must_not_merge_with || [])} | ${escapeMarkdownTable(polygonToken(plane.visible_quad_px || []))} | ${String(plane.promotion_allowed === true)} |`);
    }
    const details = facadePlaneGraph.plane_local_detail_candidates || [];
    if (details.length) {
      lines.push('');
      lines.push('### Plane-Local Detail Candidates');
      lines.push('| id | role | candidate planes | attachment hint | promotion allowed | blockers |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const detail of details) {
        lines.push(`| ${detail.id} | ${detail.role} | ${joinOrNone(detail.candidate_plane_ids || [])} | ${escapeMarkdownTable(detail.attachment_hint || '')} | ${String(detail.promotion_allowed === true)} | ${joinOrNone(detail.blockers || [])} |`);
      }
    }
    lines.push('');
  }
  lines.push('## Candidate Groups');
  lines.push('| role | count | views | max confidence | blockers |');
  lines.push('| --- | ---: | --- | ---: | --- |');
  for (const group of brief.candidate_groups) {
    lines.push(`| ${group.role} | ${group.count} | ${joinOrNone(group.views)} | ${group.max_confidence} | ${joinOrNone(group.blockers)} |`);
  }
  lines.push('');
  lines.push('## Candidate Catalog');
  lines.push('| id | role | view | projection | image geometry | ortho allowed | semantic source | semantic evidence | confidence | status | blockers |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- |');
  for (const candidate of brief.candidate_catalog) {
    lines.push(`| ${candidate.id} | ${candidate.role} | ${candidate.view} | ${candidate.projection_model || 'none'} | ${candidate.image_space_geometry || 'none'} | ${String(candidate.orthographic_projection_allowed === true)} | ${candidate.semantic_source || 'none'} | ${candidate.semantic_evidence_id || 'none'} | ${candidate.confidence} | ${candidate.promotion_status} | ${joinOrNone(candidate.blockers)} |`);
  }
  lines.push('');
  lines.push('## Candidate Disambiguation');
  lines.push('| id | role | projection | ortho allowed | polygon px | semantic source | semantic evidence | interpretation | modeling decision | blocked interpretations | required confirmations |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const item of brief.candidate_disambiguation || []) {
    lines.push(`| ${item.candidate_id} | ${item.role} | ${item.projection_model || 'none'} | ${String(item.orthographic_projection_allowed === true)} | ${escapeMarkdownTable(polygonToken(item.polygon_px || []))} | ${item.semantic_source || 'none'} | ${item.semantic_evidence_id || 'none'} | ${item.geometry_interpretation} | ${item.modeling_decision} | ${joinOrNone(item.blocked_interpretations)} | ${joinOrNone(item.required_confirmations)} |`);
  }
  lines.push('');
  if (brief.modeling_constraint_summary) {
    lines.push('## Modeling Constraint Summary');
    lines.push(`- status: \`${brief.modeling_constraint_summary.status}\``);
    lines.push(`- critical_roles: ${joinOrNone(brief.modeling_constraint_summary.critical_roles || [])}`);
    lines.push(`- must_not: ${joinOrNone(brief.modeling_constraint_summary.must_not || [])}`);
    lines.push('');
    lines.push('| role | priority | candidates | evidence | decision | blocked interpretations | required confirmations |');
    lines.push('| --- | --- | ---: | ---: | --- | --- | --- |');
    for (const item of brief.modeling_constraint_summary.constraints || []) {
      lines.push(`| ${item.role} | ${item.priority} | ${item.candidate_count} | ${item.evidence_instance_count} | ${item.modeling_decision} | ${joinOrNone(item.blocked_interpretations || [])} | ${joinOrNone(item.required_confirmations || [])} |`);
    }
    lines.push('');
  }
  lines.push('## Grounding Risk Register');
  lines.push('| id | category | severity | status | evidence | actions |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const risk of brief.grounding_risk_register || []) {
    lines.push(`| ${risk.id} | ${risk.category} | ${risk.severity} | ${risk.status} | ${joinOrNone(risk.evidence)} | ${joinOrNone(risk.actions)} |`);
  }
  lines.push('');
  lines.push('## Next Actions');
  for (const action of brief.next_actions) lines.push(`- ${action}`);
  lines.push('');
  lines.push('## Prohibitions');
  for (const item of brief.prohibitions) lines.push(`- ${item}`);
  if (brief.role_notes?.length) {
    lines.push('');
    lines.push('## Role Notes');
    for (const note of brief.role_notes) lines.push(`- ${note}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function summarizeSourcePackageGate(sourcePackageAssessment) {
  if (!sourcePackageAssessment) return null;
  const releaseChecklistSummary = releaseChecklistSummaryFromSourcePackage(sourcePackageAssessment);
  return {
    status: sourcePackageAssessment.status,
    input_ready_for_release_work: sourcePackageAssessment.input_ready_for_release_work === true,
    release_ready: sourcePackageAssessment.release_ready === true,
    source_status: sourcePackageAssessment.source_authenticity?.status || 'unknown',
    view_status: sourcePackageAssessment.view_package?.status || 'unknown',
    scale_status: sourcePackageAssessment.scale_package?.status || 'unknown',
    scale_strategy: sourcePackageAssessment.scale_package?.strategy || 'unknown',
    scale_source_metadata_hints: sourcePackageAssessment.scale_package?.source_metadata_hints || [],
    semantic_status: sourcePackageAssessment.semantic_package?.status || 'unknown',
    required_views: sourcePackageAssessment.view_package?.required_views || [],
    present_views: sourcePackageAssessment.view_package?.present_views || [],
    missing_views: sourcePackageAssessment.view_package?.missing_views || [],
    view_evidence: sourcePackageAssessment.view_package?.view_evidence || [],
    semantic_missing_roles: sourcePackageAssessment.semantic_package?.missing_roles || [],
    semantic_role_evidence: sourcePackageAssessment.semantic_package?.role_evidence || [],
    semantic_evidence_quality: sourcePackageAssessment.semantic_package?.evidence_quality || semanticEvidenceQualityEmpty(),
    release_checklist_required_check_ids: releaseChecklistSummary.required_check_ids,
    release_checklist_failed_required_check_ids: releaseChecklistSummary.failed_required_check_ids,
    release_checklist_review_required_check_ids: releaseChecklistSummary.review_required_check_ids,
    blockers: sourcePackageAssessment.blockers || [],
    source_request: sourcePackageAssessment.source_request || null,
    next_actions: sourcePackageAssessment.next_actions || []
  };
}

function semanticRoleEvidenceSummaryText(roleEvidence = []) {
  if (!roleEvidence.length) return 'none';
  return roleEvidence
    .map((item) => `${item.role}:${item.status}:${item.candidate_count}`)
    .join(', ');
}

function viewEvidenceSummaryText(viewEvidence = []) {
  if (!viewEvidence.length) return 'none';
  return viewEvidence
    .map((item) => `${item.view}:${item.status}:${item.asset_count}`)
    .join(', ');
}

function semanticEvidenceQualityEmpty() {
  return {
    status: 'not_applicable',
    required_role_count: 0,
    covered_role_count: 0,
    missing_role_count: 0,
    weak_role_count: 0,
    review_required_role_count: 0,
    geometry_promotion_allowed: false,
    weak_roles: [],
    review_required_roles: [],
    flags: []
  };
}

function releaseChecklistSummaryFromSourcePackage(sourcePackageAssessment) {
  return {
    required_check_ids: uniqueStrings(sourcePackageAssessment?.release_package?.required_check_ids || []),
    failed_required_check_ids: uniqueStrings(sourcePackageAssessment?.release_package?.failed_required_check_ids || []),
    review_required_check_ids: uniqueStrings(sourcePackageAssessment?.release_package?.review_required_check_ids || [])
  };
}

function summarizeCandidateGroups(candidates) {
  const byRole = new Map();
  for (const candidate of candidates) {
    const role = candidate.role || 'unknown';
    const group = byRole.get(role) || {
      role,
      count: 0,
      views: new Set(),
      max_confidence: 0,
      blockers: new Set(),
      candidate_ids: []
    };
    group.count += 1;
    if (candidate.view) group.views.add(candidate.view);
    group.max_confidence = Math.max(group.max_confidence, Number(candidate.confidence || 0));
    for (const blocker of candidate.promotion?.blockers || []) group.blockers.add(blocker);
    group.candidate_ids.push(candidate.id);
    byRole.set(role, group);
  }
  return Array.from(byRole.values())
    .map((group) => ({
      role: group.role,
      count: group.count,
      views: Array.from(group.views).sort(),
      max_confidence: round(group.max_confidence),
      blockers: Array.from(group.blockers).sort(),
      candidate_ids: group.candidate_ids.sort()
    }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
}

function candidateBriefItem(candidate) {
  const bbox = normalizeBbox(candidate.bbox);
  return {
    id: candidate.id,
    role: candidate.role,
    view: candidate.view,
    source_image: candidate.source_image,
    source_observation_id: candidate.source_observation_id || '',
    bbox,
    polygon_px: normalizeVisionEvidencePolygon(candidate.polygon_px || []),
    projection_model: candidate.projection_model || '',
    perspective_strength: candidate.perspective_strength || '',
    image_space_geometry: candidate.image_space_geometry || '',
    polygon_derivation: candidate.polygon_derivation || '',
    orthographic_projection_allowed: candidate.orthographic_projection_allowed === true,
    semantic_evidence_id: candidate.semantic_evidence_id || '',
    semantic_source: candidate.semantic_source || '',
    semantic_source_priority: candidate.semantic_source_priority ?? null,
    blocked_interpretations: candidate.blocked_interpretations || [],
    confidence: round(candidate.confidence || 0),
    promotion_status: candidate.promotion?.status || 'review_required',
    blockers: candidate.promotion?.blockers || []
  };
}

function buildCandidateDisambiguation(candidates) {
  return candidates.map((candidate) => {
    const spec = roleDisambiguationSpec(candidate.role);
    return {
      candidate_id: candidate.id,
      role: candidate.role,
      view: candidate.view,
      source_image: candidate.source_image,
      source_observation_id: candidate.source_observation_id || '',
      semantic_evidence_id: candidate.semantic_evidence_id || '',
      semantic_source: candidate.semantic_source || '',
      semantic_source_priority: candidate.semantic_source_priority ?? null,
      bbox: candidate.bbox || null,
      polygon_px: candidate.polygon_px || [],
      projection_model: candidate.projection_model || '',
      perspective_strength: candidate.perspective_strength || '',
      image_space_geometry: candidate.image_space_geometry || '',
      polygon_derivation: candidate.polygon_derivation || '',
      orthographic_projection_allowed: candidate.orthographic_projection_allowed === true,
      confidence: candidate.confidence,
      status: 'review_required',
      geometry_interpretation: spec.geometry_interpretation,
      modeling_decision: spec.modeling_decision,
      allowed_semantics: spec.allowed_semantics,
      blocked_interpretations: uniqueStrings([
        ...(spec.blocked_interpretations || []),
        ...(candidate.blocked_interpretations || [])
      ]),
      required_confirmations: spec.required_confirmations,
      evidence_tokens: uniqueStrings([
        `candidate_id=${candidate.id}`,
        `role=${candidate.role}`,
        `view=${candidate.view}`,
        candidate.source_observation_id ? `source_observation_id=${candidate.source_observation_id}` : '',
        candidate.semantic_evidence_id ? `semantic_evidence_id=${candidate.semantic_evidence_id}` : '',
        candidate.semantic_source ? `semantic_source=${candidate.semantic_source}` : '',
        candidate.projection_model ? `projection_model=${candidate.projection_model}` : '',
        candidate.image_space_geometry ? `image_space_geometry=${candidate.image_space_geometry}` : '',
        candidate.polygon_derivation ? `polygon_derivation=${candidate.polygon_derivation}` : '',
        candidate.orthographic_projection_allowed === false ? 'orthographic_projection_allowed=false' : '',
        candidate.polygon_px?.length ? `polygon=${polygonToken(candidate.polygon_px)}` : '',
        candidate.bbox ? `bbox=${bboxToken(candidate.bbox)}` : ''
      ]),
      handoff_text: spec.handoff_text
    };
  });
}

function buildModelingConstraintSummary({
  candidateDisambiguation = [],
  visionEvidence = {},
  facadePlaneGraph = {},
  roles = new Set(),
  canGenerateSketchUpDsl = false
} = {}) {
  const byRole = new Map();
  for (const item of candidateDisambiguation) {
    const role = item.role || 'unknown';
    const group = constraintGroupForRole(byRole, role);
    group.candidate_count += 1;
    if (item.view) group.views.add(item.view);
    if (item.candidate_id) group.source_candidate_ids.push(item.candidate_id);
    if (!group.primary_candidate_id && item.candidate_id) group.primary_candidate_id = item.candidate_id;
    mergeConstraintSpec(group, item);
  }
  for (const item of visionEvidence.modeling_handoff || []) {
    const role = item.role || 'unknown';
    const group = constraintGroupForRole(byRole, role);
    group.evidence_instance_count = Math.max(group.evidence_instance_count, Number(item.instance_count || 0));
    if (item.primary_instance?.view) group.views.add(item.primary_instance.view);
    if (!group.primary_evidence && item.primary_instance) group.primary_evidence = item.primary_instance;
    mergeConstraintSpec(group, item);
  }
  for (const plane of facadePlaneGraph.planes || []) {
    const group = constraintGroupForRole(byRole, plane.role || plane.id);
    group.evidence_instance_count += 1;
    if (plane.view) group.views.add(plane.view);
    group.source_candidate_ids.push(plane.id);
    if (!group.primary_candidate_id) group.primary_candidate_id = plane.id;
    mergeConstraintSpec(group, {
      geometry_interpretation: 'Draft visible facade plane evidence from FacadePlaneGraph; not a buildable facade plane until accepted plane review.',
      modeling_decision: 'review_required_before_plane_or_detail_promotion',
      allowed_semantics: ['draft_visible_plane_candidate', 'plane_review_input'],
      blocked_interpretations: [
        'front_facade_plane_without_accepted_plane_review',
        'merged_visible_planes_without_review',
        ...(plane.must_not_merge_with || []).map((id) => `merge_with_${id}`)
      ],
      required_confirmations: [
        'Accept visible_quad_px, orientation_hint, adjacency, occlusion_order, and must_not_merge_with in plane review before PartGraph promotion.',
        'Keep plane-local details on candidate planes until the target visible plane is accepted.'
      ],
      handoff_text: `${plane.id}: review visible plane boundary and orientation before any geometry promotion.`
    });
  }
  for (const detail of facadePlaneGraph.plane_local_detail_candidates || []) {
    const group = constraintGroupForRole(byRole, detail.role || 'plane_local_detail_candidate');
    group.evidence_instance_count += 1;
    if (detail.view) group.views.add(detail.view);
    group.source_candidate_ids.push(detail.id);
    if (!group.primary_candidate_id) group.primary_candidate_id = detail.id;
    mergeConstraintSpec(group, {
      geometry_interpretation: `Plane-local ${detail.role} candidate attached to ${joinOrNone(detail.candidate_plane_ids || [])}.`,
      modeling_decision: 'review_required_after_plane_acceptance',
      allowed_semantics: ['plane_local_detail_candidate'],
      blocked_interpretations: [
        'promoted_detail_without_accepted_plane',
        'detail_used_to_infer_hidden_plane_geometry'
      ],
      required_confirmations: [
        'Accept target visible plane before detail promotion.',
        'Confirm detail semantics, placement, and depth before PartGraph geometry.'
      ],
      handoff_text: `${detail.role}: keep as plane-local detail candidate until plane review is accepted.`
    });
  }
  for (const role of roles || []) {
    const group = constraintGroupForRole(byRole, role);
    if (!group.geometry_interpretation) mergeConstraintSpec(group, roleDisambiguationSpec(role));
  }

  const constraints = Array.from(byRole.values())
    .map((group) => {
      const spec = roleDisambiguationSpec(group.role);
      return {
        role: group.role,
        priority: criticalRolePriority(group.role) < 999 ? 'critical' : 'review',
        candidate_count: group.candidate_count,
        evidence_instance_count: group.evidence_instance_count,
        views: Array.from(group.views).filter(Boolean).sort(),
        source_candidate_ids: uniqueStrings(group.source_candidate_ids).slice(0, 16),
        primary_candidate_id: group.primary_candidate_id || '',
        primary_evidence: group.primary_evidence || null,
        geometry_interpretation: group.geometry_interpretation || spec.geometry_interpretation,
        modeling_decision: group.modeling_decision || spec.modeling_decision,
        allowed_semantics: uniqueStrings(group.allowed_semantics.length ? group.allowed_semantics : spec.allowed_semantics),
        blocked_interpretations: uniqueStrings(group.blocked_interpretations.length ? group.blocked_interpretations : spec.blocked_interpretations),
        required_confirmations: uniqueStrings(group.required_confirmations.length ? group.required_confirmations : spec.required_confirmations),
        handoff_text: group.handoff_text || spec.handoff_text,
        review_required: true,
        geometry_promotion_allowed: false
      };
    })
    .sort((a, b) => criticalRolePriority(a.role) - criticalRolePriority(b.role)
      || b.candidate_count - a.candidate_count
      || a.role.localeCompare(b.role));

  const roleSet = new Set(constraints.map((item) => item.role));
  return {
    status: canGenerateSketchUpDsl ? 'compiler_gated_geometry_allowed' : 'review_or_input_blocked',
    total_roles: constraints.length,
    critical_roles: CRITICAL_VISION_EVIDENCE_ROLES.filter((role) => roleSet.has(role)),
    review_required_roles: constraints.filter((item) => item.review_required).map((item) => item.role),
    blocked_interpretations: uniqueStrings(constraints.flatMap((item) => item.blocked_interpretations || [])),
    required_confirmations: uniqueStrings(constraints.flatMap((item) => item.required_confirmations || [])),
    must_not: buildProhibitions(roleSet),
    constraints
  };
}

function constraintGroupForRole(byRole, role) {
  if (!byRole.has(role)) {
    byRole.set(role, {
      role,
      candidate_count: 0,
      evidence_instance_count: 0,
      views: new Set(),
      source_candidate_ids: [],
      primary_candidate_id: '',
      primary_evidence: null,
      geometry_interpretation: '',
      modeling_decision: '',
      allowed_semantics: [],
      blocked_interpretations: [],
      required_confirmations: [],
      handoff_text: ''
    });
  }
  return byRole.get(role);
}

function mergeConstraintSpec(group, item = {}) {
  if (!group.geometry_interpretation && item.geometry_interpretation) group.geometry_interpretation = item.geometry_interpretation;
  if (!group.modeling_decision && item.modeling_decision) group.modeling_decision = item.modeling_decision;
  if (!group.handoff_text && item.handoff_text) group.handoff_text = item.handoff_text;
  group.allowed_semantics.push(...(item.allowed_semantics || []));
  group.blocked_interpretations.push(...(item.blocked_interpretations || []));
  group.required_confirmations.push(...(item.required_confirmations || []));
}

function criticalRolePriority(role) {
  const index = CRITICAL_VISION_EVIDENCE_ROLES.indexOf(role);
  return index === -1 ? 999 : index;
}

function roleDisambiguationSpec(role) {
  if (role === 'visible_plane_recessed_left') {
    return {
      geometry_interpretation: 'Separate recessed, side, or return visible plane evidence; not part of the primary visible plane until review confirms the offset.',
      modeling_decision: 'review_required_keep_as_separate_visible_plane_candidate',
      allowed_semantics: [
        'visible_recessed_or_return_plane_evidence',
        'draft_visible_plane_candidate',
        'return_wall_candidate_after_review'
      ],
      blocked_interpretations: [
        'merged_with_visible_plane_primary',
        'merged_front_facade_plane',
        'front_facade_detail_or_texture',
        'decorative_shadow_stripe'
      ],
      required_confirmations: [
        'Confirm side or oblique evidence supports a real depth offset.',
        'Confirm perspective plane orientation; image-space polygon evidence is not an orthographic elevation.',
        'Confirm visible_quad_px, adjacency, occlusion_order, and must_not_merge_with before geometry promotion.',
        'Confirm the recessed plane relationship to visible_plane_primary instead of moving it into the primary visible plane layout.'
      ],
      handoff_text: 'Keep this as a distinct visible plane candidate; do not paste it into visible_plane_primary.'
    };
  }
  if (role === 'rectangular_utility_ducts') {
    return {
      geometry_interpretation: 'External rectangular duct, conduit, or utility riser candidate.',
      modeling_decision: 'review_required_keep_as_rectangular_utility_candidate',
      allowed_semantics: [
        'rectangular_external_duct_candidate',
        'square_section_conduit_candidate',
        'utility_riser_candidate'
      ],
      blocked_interpretations: [
        'decorative_facade_trim',
        'round_pipe_without_evidence',
        'window_mullion_or_opening_frame'
      ],
      required_confirmations: [
        'Confirm rectangular duct/conduit semantics before modeling utility geometry.',
        'Confirm duct face attachment under oblique perspective before any 3D section or extrusion.',
        'Confirm section shape and attachment face before geometry promotion.',
        'Confirm the duct is not a facade trim, shadow, or window rhythm artifact.'
      ],
      handoff_text: 'Treat this as rectangular utility/duct evidence, not decorative facade trim or round pipe geometry.'
    };
  }
  if (role === 'shadow_or_recess_boundary') {
    return {
      geometry_interpretation: 'Ambiguous lighting or recess boundary marker; may be cast shadow or a real wall return.',
      modeling_decision: 'review_required_do_not_convert_shadow_to_geometry',
      allowed_semantics: [
        'lighting_boundary_marker',
        'candidate_recess_boundary_after_confirmation',
        'review_marker_for_facade_plane_split'
      ],
      blocked_interpretations: [
        'cut_recess_from_shadow_only',
        'extruded_wall_from_shadow_only',
        'confirmed_depth_edge_without_alternate_evidence'
      ],
      required_confirmations: [
        'Confirm whether the dark boundary is cast shadow or real recessed geometry.',
        'Use alternate view, edge continuity, or human review before cutting or offsetting a surface.',
        'Do not derive depth solely from shadow contrast.'
      ],
      handoff_text: 'Use this as a shadow/recess ambiguity marker; do not convert it into geometry without confirmation.'
    };
  }
  if (role === 'visible_plane_primary') {
    return {
      geometry_interpretation: 'Primary visible facade plane evidence from FacadePlaneGraph.',
      modeling_decision: 'review_required_before_naming_as_buildable_front_facade',
      allowed_semantics: [
        'visible_primary_facade_plane_evidence',
        'draft_visible_plane_candidate'
      ],
      blocked_interpretations: [
        'front_facade_plane_without_accepted_plane_review',
        'container_for_recessed_side_facade',
        'container_for_ducts_or_hvac_units',
        'hidden_depth_or_side_geometry'
      ],
      required_confirmations: [
        'Confirm facade plane extent separately from openings, ducts, HVAC units, shadows, and recessed planes.',
        'Confirm perspective and plane orientation from additional view or accepted polygon before treating this as an elevation.',
        'Confirm accepted plane review before any PartGraph or SketchUp promotion.'
      ],
      handoff_text: 'Keep visible_plane_primary as Drafting-first plane evidence until accepted plane review.'
    };
  }
  return {
    geometry_interpretation: `${role || 'unknown'} review candidate from visual evidence.`,
    modeling_decision: 'review_required_before_geometry_promotion',
    allowed_semantics: [
      `${role || 'unknown'}_candidate`
    ],
    blocked_interpretations: [
      'confirmed_geometry_without_review',
      'hidden_or_inferred_geometry_without_source_evidence'
    ],
    required_confirmations: [
      'Confirm perspective and plane orientation; oblique image-space evidence is not an orthographic elevation.',
      'Confirm source evidence, scale, placement, and semantics before geometry promotion.'
    ],
    handoff_text: 'Treat this as review evidence until accepted by candidate promotion review.'
  };
}

function bboxToken(bbox) {
  const normalized = normalizeBbox(bbox);
  if (!normalized) return '';
  return [normalized.x, normalized.y, normalized.width, normalized.height]
    .map((value) => round(value))
    .join(',');
}

function polygonToken(polygon = []) {
  const normalized = normalizeVisionEvidencePolygon(polygon);
  if (!normalized.length) return '';
  return normalized
    .map(([x, y]) => `${round(x)},${round(y)}`)
    .join(';');
}

function normalizeBbox(bbox) {
  if (!bbox) return null;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    return {
      x: Number(bbox[0]) || 0,
      y: Number(bbox[1]) || 0,
      width: Number(bbox[2]) || 0,
      height: Number(bbox[3]) || 0
    };
  }
  if (typeof bbox === 'object') {
    return {
      x: Number(bbox.x) || 0,
      y: Number(bbox.y) || 0,
      width: Number(bbox.width) || 0,
      height: Number(bbox.height) || 0
    };
  }
  return null;
}

function buildGroundingRiskRegister({
  observationSet,
  modelingBrief,
  sourcePackageAssessment,
  canGenerateSketchUpDsl,
  reasons,
  roles
}) {
  const risks = [];
  if (!canGenerateSketchUpDsl) {
    risks.push(riskItem({
      id: 'direct_sketchup_dsl_blocked',
      category: 'output_policy',
      severity: 'critical',
      status: 'blocked',
      evidence: reasons.length ? reasons : ['compile_permission_false'],
      actions: ['Return review notes, missing-input requests, or blocker reports instead of SketchUp DSL.'],
      blockedOutputs: ['direct_sketchup_dsl', 'final_3d_model']
    }));
  }

  for (const blocker of sourcePackageAssessment?.blockers || []) {
    risks.push(sourcePackageBlockerRisk(blocker));
  }

  const missingViews = uniqueStrings([
    ...(observationSet.missing_views || []),
    ...(modelingBrief.missing_inputs || []).filter((item) => item.startsWith('missing_') && item.endsWith('_view')),
    ...(sourcePackageAssessment?.view_package?.missing_views || []).map((view) => `missing_${view}_view`)
  ]);
  for (const item of missingViews) {
    const view = item.replace(/^missing_/, '').replace(/_view$/, '');
    risks.push(riskItem({
      id: `missing_view_${view}`,
      category: 'view_coverage',
      severity: view === 'top' || view === 'oblique' ? 'high' : 'medium',
      status: 'blocked',
      evidence: [item],
      actions: [`Provide or confirm ${view} view evidence before geometry promotion.`],
      blockedOutputs: ['hidden_facade_geometry', 'invented_depth_or_roof_geometry']
    }));
  }

  const scaleConfidence = Number(observationSet.scale_calibration?.confidence || 0);
  if (scaleConfidence < 0.7) {
    risks.push(riskItem({
      id: 'scale_confidence_below_publish_gate',
      category: 'scale',
      severity: 'high',
      status: 'blocked',
      evidence: [`scale_confidence=${round(scaleConfidence)}`],
      actions: ['Provide known dimensions, CAD/PDF scale evidence, or reliable scale anchors before release modeling work.'],
      blockedOutputs: ['dimensioned_geometry', 'formal_release_manifest']
    }));
  }

  if (roles.has('visible_plane_recessed_left')) {
    risks.push(riskItem({
      id: 'visible_plane_recessed_left_requires_separate_plane_review',
      category: 'semantic_geometry',
      severity: 'high',
      status: 'review_required',
      evidence: ['candidate_role=visible_plane_recessed_left'],
      actions: ['Keep recessed visible plane evidence as a separate plane until review confirms placement and depth.'],
      blockedOutputs: ['merged_front_facade_recess_geometry']
    }));
  }
  if (roles.has('rectangular_utility_ducts')) {
    risks.push(riskItem({
      id: 'rectangular_utility_ducts_require_duct_semantics_review',
      category: 'semantic_geometry',
      severity: 'medium',
      status: 'review_required',
      evidence: ['candidate_role=rectangular_utility_ducts'],
      actions: ['Keep rectangular utility ducts as duct/conduit candidates; do not convert them to facade trim.'],
      blockedOutputs: ['decorative_trim_substitution']
    }));
  }
  if (roles.has('shadow_or_recess_boundary')) {
    risks.push(riskItem({
      id: 'shadow_recess_boundary_ambiguity',
      category: 'lighting_geometry_disambiguation',
      severity: 'high',
      status: 'review_required',
      evidence: ['candidate_role=shadow_or_recess_boundary'],
      actions: ['Confirm whether the dark boundary is cast shadow or real recessed geometry before cutting or offsetting surfaces.'],
      blockedOutputs: ['shadow_to_geometry_conversion']
    }));
  }

  return dedupeRiskItems(risks);
}

function sourcePackageBlockerRisk(blocker) {
  if (blocker === 'source_assets_generated_or_scaffold') {
    return riskItem({
      id: 'source_assets_generated_or_scaffold',
      category: 'source_authenticity',
      severity: 'critical',
      status: 'blocked',
      evidence: [blocker],
      actions: ['Replace generated, screenshot, scaffold, cropped demo, or web-source paths with original user-provided building assets.'],
      blockedOutputs: ['direct_sketchup_dsl', 'formal_release_manifest']
    });
  }
  if (blocker === 'duplicate_source_assets') {
    return riskItem({
      id: 'duplicate_source_assets',
      category: 'source_authenticity',
      severity: 'critical',
      status: 'blocked',
      evidence: [blocker],
      actions: ['Replace duplicate files with distinct source assets for the required views.'],
      blockedOutputs: ['release_source_candidate', 'formal_release_manifest']
    });
  }
  if (blocker.startsWith('missing_') && blocker.endsWith('_view')) {
    return riskItem({
      id: blocker,
      category: 'view_coverage',
      severity: blocker.includes('top') || blocker.includes('oblique') ? 'high' : 'medium',
      status: 'blocked',
      evidence: [blocker],
      actions: [`Provide or confirm ${blocker.replace(/^missing_/, '').replace(/_view$/, '')} view evidence.`],
      blockedOutputs: ['hidden_facade_geometry', 'invented_depth_or_roof_geometry']
    });
  }
  if (blocker === 'scale_confidence_below_publish_gate') {
    return riskItem({
      id: blocker,
      category: 'scale',
      severity: 'high',
      status: 'blocked',
      evidence: [blocker],
      actions: ['Provide scale evidence before dimensioned modeling or release promotion.'],
      blockedOutputs: ['dimensioned_geometry', 'formal_release_manifest']
    });
  }
  if (blocker.startsWith('release_')) {
    return riskItem({
      id: blocker,
      category: 'release_readiness',
      severity: 'medium',
      status: 'blocked',
      evidence: [blocker],
      actions: ['Complete release artifacts, QA, and review checklist before promotion to a formal release manifest.'],
      blockedOutputs: ['formal_release_manifest']
    });
  }
  return riskItem({
    id: blocker,
    category: 'source_package',
    severity: 'medium',
    status: 'blocked',
    evidence: [blocker],
    actions: ['Resolve the source-package blocker before release modeling work.'],
    blockedOutputs: ['direct_sketchup_dsl']
  });
}

function riskItem({
  id,
  category,
  severity,
  status,
  evidence = [],
  actions = [],
  blockedOutputs = []
}) {
  return {
    id,
    category,
    severity,
    status,
    evidence: uniqueStrings(evidence),
    actions: uniqueStrings(actions),
    blocked_outputs: uniqueStrings(blockedOutputs)
  };
}

function dedupeRiskItems(items) {
  const byId = new Map();
  for (const item of items) {
    if (!item?.id) continue;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    existing.evidence = uniqueStrings([...(existing.evidence || []), ...(item.evidence || [])]);
    existing.actions = uniqueStrings([...(existing.actions || []), ...(item.actions || [])]);
    existing.blocked_outputs = uniqueStrings([...(existing.blocked_outputs || []), ...(item.blocked_outputs || [])]);
    existing.severity = higherSeverity(existing.severity, item.severity);
    existing.status = existing.status === 'blocked' || item.status === 'blocked' ? 'blocked' : existing.status;
  }
  return Array.from(byId.values()).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.id.localeCompare(b.id));
}

function higherSeverity(a, b) {
  return severityRank(b) > severityRank(a) ? b : a;
}

function severityRank(value) {
  if (value === 'critical') return 4;
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function buildAgentContract({
  source,
  modelingBrief,
  observationSet,
  sourcePackageAssessment,
  canGenerateSketchUpDsl,
  canPromoteCandidates,
  reasons,
  roles,
  prohibitions,
  roleNotes
}) {
  const authoritativeArtifacts = authoritativeArtifactList(source);
  const releaseChecklistSummary = releaseChecklistSummaryFromSourcePackage(sourcePackageAssessment);
  const missingViews = uniqueStrings([
    ...(observationSet.missing_views || []),
    ...(sourcePackageAssessment?.view_package?.missing_views || [])
  ]);
  const outputPolicy = {
    sketchup_dsl_allowed: canGenerateSketchUpDsl,
    candidate_promotion_allowed: canPromoteCandidates,
    allowed_outputs: canGenerateSketchUpDsl
      ? [
        'compiler_fresh_sketchup_dsl_from_promoted_part_graph',
        'qa_reports_for_compiled_output'
      ]
      : [
        'review_notes',
        'structure_evidence_graph',
        'calibrated_view_graph',
        'corner_chain_topology',
        'draft_view_graph',
        'object_surface_graph_or_domain_graph',
        'candidate_selection_draft',
        'missing_input_request',
        'source_package_blocker_report'
      ],
    blocked_outputs: canGenerateSketchUpDsl
      ? []
      : [
        'direct_sketchup_dsl',
        'final_3d_model',
        'promoted_part_graph_geometry',
        'invented_hidden_facades_or_dimensions'
      ],
    blockers: reasons,
    release_checklist_required_check_ids: releaseChecklistSummary.required_check_ids,
    release_checklist_failed_required_check_ids: releaseChecklistSummary.failed_required_check_ids,
    release_checklist_review_required_check_ids: releaseChecklistSummary.review_required_check_ids
  };
  const evidenceRules = [
    'Treat source_assets, observations, candidate_graph, modeling_brief, source_package_gate, and promotion_review as the only authoritative inputs.',
    'Treat StructureEvidenceGraph, CalibratedViewGraph, CornerChainTopology, and DraftViewGraph as drafting evidence; they do not grant PartGraph or SketchUp promotion.',
    'Treat candidate_catalog entries as review candidates, not confirmed geometry.',
    'Do not use profile priors or visual guesses to fill missing views, hidden depth, hidden facades, or unobserved roof/side geometry.',
    'Only accepted calibrated_view_review, corner_chain_topology_review, draft_view_review, local_detail_review, and candidate_promotion_review contracts can promote candidates into PartGraph geometry.',
    'Only compiler output from a promoted PartGraph can become SketchUp DSL.',
    'Source metadata scale hints are evidence for review; they do not bypass scale, source, view, semantic, compiler, or QA gates.'
  ];
  if (!canGenerateSketchUpDsl) {
    evidenceRules.push('Because sketchup_dsl_allowed=false, this brief is for review and clarification, not direct model generation.');
  }
  if (sourcePackageAssessment?.input_ready_for_release_work === false) {
    evidenceRules.push('The real-world building source package is not input-ready; resolve source/view/scale blockers before release modeling work.');
  }
  if (releaseChecklistSummary.failed_required_check_ids.length > 0) {
    evidenceRules.push('Failed required release checklist ids are blockers; do not hide them behind generic release readiness wording.');
  }
  const requiredConfirmations = uniqueStrings([
    ...missingViews.map((view) => `Provide or confirm ${view} view evidence.`),
    ...(modelingBrief.missing_inputs || []).map((item) => `Resolve modeling input blocker: ${item}.`),
    ...(sourcePackageAssessment?.semantic_package?.missing_roles || []).map((role) => `Confirm semantic role evidence: ${role}.`),
    ...(sourcePackageAssessment?.semantic_package?.evidence_quality?.weak_roles || []).map((role) => `Review weak semantic candidate evidence before geometry promotion: ${role}.`),
    ...(sourcePackageAssessment?.semantic_package?.evidence_quality?.review_required_roles || []).map((role) => `Confirm semantic candidate interpretation before geometry promotion: ${role}.`),
    ...releaseChecklistSummary.failed_required_check_ids.map((id) => `Resolve failed required release checklist check: ${id}.`),
    ...releaseChecklistSummary.review_required_check_ids.map((id) => `Resolve review-required release checklist check: ${id}.`)
  ]);
  const geometryBoundaries = uniqueStrings([
    ...prohibitions,
    ...roleNotes,
    ...(roles.has('building_main_mass') ? ['building_main_mass: keep massing distinct from openings, ducts, facade fixtures, shadows, and annotations until reviewed.'] : [])
  ]);
  return {
    version: 1,
    status: canGenerateSketchUpDsl ? 'ready_for_compiler_gated_sketchup_dsl' : 'review_or_input_blocked',
    authoritative_artifacts: authoritativeArtifacts,
    output_policy: outputPolicy,
    evidence_rules: evidenceRules,
    required_confirmations: requiredConfirmations,
    geometry_boundaries: geometryBoundaries
  };
}

function authoritativeArtifactList(source = {}) {
  return Object.entries(source)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([role, filePath]) => ({
      role,
      path: filePath,
      required: ['asset_set', 'observation_set', 'candidate_graph', 'modeling_brief'].includes(role)
    }))
    .sort((a, b) => Number(b.required) - Number(a.required) || a.role.localeCompare(b.role));
}

function buildNextActions({ modelingBrief, promotionReview, reasons }) {
  const actions = [];
  if (reasons.length) {
    actions.push('Resolve compile permission blockers before generating SketchUp DSL.');
  }
  for (const missing of modelingBrief.missing_inputs || []) {
    actions.push(`Provide or confirm: ${missing}.`);
  }
  if (!promotionReview || promotionReview.promotion_allowed !== true) {
    actions.push('Open the review workbench and export an accepted candidate_promotion_review before PartGraph promotion.');
  }
  actions.push('Use accepted candidates only as PartGraph promotion input, then run compiler and QA gates.');
  return uniqueStrings(actions);
}

function buildProhibitions(roles) {
  const prohibitions = [
    'Do not generate SketchUp DSL directly from this brief when can_generate_sketchup_dsl=false.',
    'Do not promote candidates that still carry blockers.',
    'Do not invent hidden faces, dimensions, or view-dependent geometry that is not present in source evidence or review notes.'
  ];
  if (roles.has('visible_plane_primary')) {
    prohibitions.push('Do not rename visible_plane_primary into front_facade_plane or buildable wall geometry without accepted plane review.');
  }
  if (roles.has('visible_plane_recessed_left')) {
    prohibitions.push('Do not move recessed visible plane evidence into visible_plane_primary; keep it as a separate plane until reviewed.');
  }
  if (roles.has('shadow_or_recess_boundary')) {
    prohibitions.push('Do not convert shadows into geometry unless review confirms the shadow is a recess boundary.');
  }
  if (roles.has('rectangular_utility_ducts')) {
    prohibitions.push('Do not treat rectangular utility ducts as decorative facade trim; keep them as utility/duct candidates until reviewed.');
  }
  return prohibitions;
}

function buildRoleNotes(roles) {
  const notes = [];
  if (roles.has('visible_plane_primary')) {
    notes.push('visible_plane_primary: Drafting-first visible plane evidence; accepted plane review is required before any front-facade naming or geometry promotion.');
  }
  if (roles.has('visible_plane_recessed_left')) {
    notes.push('visible_plane_recessed_left: evidence indicates an inset/offset visible plane that must stay distinct from visible_plane_primary.');
  }
  if (roles.has('rectangular_utility_ducts')) {
    notes.push('rectangular_utility_ducts: model as external duct/conduit geometry only after review confirms position and depth.');
  }
  if (roles.has('shadow_or_recess_boundary')) {
    notes.push('shadow_or_recess_boundary: use as a review marker for lighting versus geometry ambiguity.');
  }
  return notes;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0))).sort();
}

function joinOrNone(values) {
  return values && values.length ? values.join(', ') : 'none';
}

function escapeMarkdownTable(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function assertTruthy(value, message) {
  if (!value) throw new Error(message);
}
