export const VISION_EVIDENCE_SET_CLASSES = [
  'building_outline',
  'roof_internal_seam',
  'site_perimeter',
  'road_boundary',
  'paved_green_boundary',
  'building_footprint',
  'paved_surface',
  'road_surface_candidate',
  'parking_surface_candidate',
  'parking_marking',
  'road_marking',
  'vegetation',
  'bare_soil',
  'shadow_or_dark_unknown',
  'unknown'
];

const EDGE_CLASS_MAP = {
  building_outline: 'building_outline',
  roof_internal_seam: 'roof_internal_seam',
  site_perimeter_candidate: 'site_perimeter',
  road_boundary_candidate: 'road_boundary',
  paved_green_boundary: 'paved_green_boundary',
  unknown_strong_edge: 'unknown'
};

const LAND_COVER_CLASS_MAP = {
  vegetation_tree: 'vegetation',
  vegetation_low: 'vegetation'
};

const SEMANTIC_CANDIDATE_REVIEW_POLICIES = {
  visible_plane_primary: {
    requiredDecision: 'confirm_visible_plane_primary_extent_excludes_recesses_ducts_and_shadows',
    policy: 'keep_visible_plane_primary_as_draft_plane_until_accepted_plane_review',
    decision: 'confirmed_visible_plane_primary_review_policy',
    riskDisposition: 'primary_visible_plane_kept_as_draft_plane_evidence',
    resolvedBlockers: ['visible_plane_primary_extent_review_required'],
    allowedOutputs: ['reviewed_visible_plane_primary_candidate'],
    blockedOutputs: ['front_facade_plane_without_accepted_plane_review', 'container_for_recessed_side_facade', 'container_for_ducts_or_hvac_units'],
    nextAction: 'confirm_visible_quad_orientation_and_plane_review_before_any_part_graph_promotion',
    reason: 'The primary visible plane must stay Drafting-first and separate from recess, duct, HVAC, opening, and shadow candidates until accepted plane review.'
  },
  visible_plane_recessed_left: {
    requiredDecision: 'confirm_visible_plane_recessed_left_stays_as_separate_offset_plane',
    policy: 'keep_visible_plane_recessed_left_as_distinct_review_only_plane',
    decision: 'confirmed_visible_plane_recessed_left_separate_plane_policy',
    riskDisposition: 'kept_as_distinct_offset_or_recessed_visible_plane_candidate',
    resolvedBlockers: ['visible_plane_recessed_left_requires_separate_plane_review'],
    allowedOutputs: ['reviewed_visible_plane_recessed_left_candidate'],
    blockedOutputs: ['merged_with_visible_plane_primary', 'merged_front_facade_plane', 'front_facade_detail_or_texture', 'decorative_shadow_stripe'],
    nextAction: 'confirm_offset_boundary_and_depth_with_side_or_top_evidence',
    reason: 'A recessed/side visible plane candidate must not be pasted into visible_plane_primary; depth and boundary require review.'
  },
  rectangular_utility_ducts: {
    requiredDecision: 'confirm_rectangular_utility_ducts_are_not_facade_trim_or_round_pipes',
    policy: 'keep_rectangular_utility_ducts_as_review_only_duct_or_conduit_candidates',
    decision: 'confirmed_rectangular_utility_duct_semantics_policy',
    riskDisposition: 'kept_as_rectangular_utility_candidate_not_trim_or_round_pipe',
    resolvedBlockers: ['rectangular_utility_ducts_require_duct_semantics_review'],
    allowedOutputs: ['reviewed_rectangular_utility_candidate'],
    blockedOutputs: ['decorative_facade_trim', 'round_pipe_geometry', 'window_rhythm_artifact'],
    nextAction: 'confirm_duct_position_section_and_mounting_before_utility_geometry',
    reason: 'Rectangular ducts, conduits, and utility risers need separate semantics; they must not become facade trim or round pipe primitives.'
  },
  shadow_or_recess_boundary: {
    requiredDecision: 'confirm_shadow_boundary_is_not_geometry_without_recess_evidence',
    policy: 'keep_shadow_or_recess_boundary_as_ambiguity_marker_until_confirmed',
    decision: 'confirmed_shadow_recess_ambiguity_policy',
    riskDisposition: 'kept_as_shadow_or_recess_review_marker',
    resolvedBlockers: ['shadow_recess_boundary_ambiguity'],
    allowedOutputs: ['reviewed_shadow_recess_boundary_marker'],
    blockedOutputs: ['cut_recess_from_shadow_only', 'extruded_wall_from_shadow_only', 'shadow_to_geometry_conversion'],
    nextAction: 'classify_cast_shadow_ambient_occlusion_or_real_wall_return_before_geometry',
    reason: 'Lighting can reveal form, but a dark edge alone cannot become a recess cut or wall offset without confirmation.'
  },
  exterior_hvac_units: {
    requiredDecision: 'confirm_hvac_units_remain_fixture_candidates_not_facade_plane_mass',
    policy: 'keep_exterior_hvac_units_as_review_only_fixture_candidates',
    decision: 'confirmed_exterior_hvac_fixture_policy',
    riskDisposition: 'kept_as_fixture_candidate_not_facade_mass',
    resolvedBlockers: ['exterior_hvac_units_require_fixture_review'],
    allowedOutputs: ['reviewed_hvac_fixture_candidate'],
    blockedOutputs: ['merged_facade_plane_detail', 'generic_window_band', 'unconfirmed_utility_geometry'],
    nextAction: 'confirm individual units, mounting depth, and facade relationship before fixture geometry',
    reason: 'HVAC or facade equipment should remain fixture evidence until object-level position and depth are confirmed.'
  },
  upper_window_bands: {
    requiredDecision: 'confirm_window_bands_are_opening_candidates_not_texture_only',
    policy: 'keep_upper_window_bands_review_only_until_opening_layout_confirmed',
    decision: 'confirmed_upper_window_band_review_policy',
    riskDisposition: 'kept_as_opening_band_candidate_pending_layout_review',
    resolvedBlockers: ['upper_window_band_layout_review_required'],
    allowedOutputs: ['reviewed_window_band_candidate'],
    blockedOutputs: ['texture_only_facade_grid_to_geometry', 'invented_window_repetition'],
    nextAction: 'confirm opening count, spacing, and facade plane before cut operations',
    reason: 'Window bands need layout confirmation before facade opening cuts or repeated modules are generated.'
  },
  ground_floor_storefront: {
    requiredDecision: 'confirm_storefront_openings_and_canopies_before_facade_cut_ops',
    policy: 'keep_ground_floor_storefront_review_only_until_opening_boundaries_confirmed',
    decision: 'confirmed_ground_floor_storefront_review_policy',
    riskDisposition: 'kept_as_storefront_opening_candidate_pending_review',
    resolvedBlockers: ['ground_floor_storefront_opening_review_required'],
    allowedOutputs: ['reviewed_storefront_candidate'],
    blockedOutputs: ['invented_ground_floor_openings', 'merged_storefront_into_wall_mass'],
    nextAction: 'confirm storefront boundary, floor line, and facade plane before cut operations',
    reason: 'Ground-floor storefront evidence should not become openings or wall cuts until boundaries are confirmed.'
  }
};

export function annotateObservationSetWithVisionEvidenceSetV1(observations = {}, options = {}) {
  if (observations.vision_evidence_set_v1 && !options.force) return observations;
  const visionEvidenceSet = buildVisionEvidenceSetV1({ observations, options });
  return {
    ...observations,
    vision_evidence_set_v1: visionEvidenceSet
  };
}

export function buildVisionEvidenceSetV1({ observations = {}, options = {} } = {}) {
  const images = Array.isArray(observations.images) ? observations.images : [];
  const sourceImages = images.map((image) => image.image?.path).filter(Boolean);
  const masks = [
    ...masksFromLandCover(observations.land_cover_v1),
    ...masksFromImageObservations(images)
  ];
  const edges = [
    ...edgesFromOpenCv(observations.opencv_edge_v1),
    ...edgesFromHighContrast(observations.high_contrast_edge_v1),
    ...edgesFromBoundaryGraph(observations.boundary_graph_v1)
  ];
  const lines = [
    ...linesFromLandCover(observations.land_cover_v1),
    ...linesFromImageObservations(images)
  ];
  const keypoints = keypointsFromImageObservations(images);
  const regions = [
    ...regionsFromLandCover(observations.land_cover_v1),
    ...regionsFromImageObservations(images)
  ];
  const scaleAnchors = scaleAnchorsFromObservations(observations);
  const relations = relationsFromVisualGraph(observations.visual_relation_graph);
  const viewGroundPlane = estimateViewGroundPlane({
    observations,
    edges,
    masks,
    regions,
    scaleAnchors
  });
  const backendStatuses = backendStatusesFor(observations, options);
  const qa = visionEvidenceSetQa({
    masks,
    edges,
    lines,
    keypoints,
    regions,
    scaleAnchors,
    relations,
    viewGroundPlane,
    backendStatuses
  });

  return {
    kind: 'vision_evidence_set_v1',
    version: 1,
    coordinate_convention: 'image_x_right_y_down',
    policy: 'lightweight_cv_default_no_required_heavy_models',
    source_images: sourceImages,
    default_backends: ['deterministic_cv', 'high_contrast_edge_v1', 'opencv_edge_v1_cpu_optional'],
    optional_backends: {
      insid3: optionalStatus(observations, 'insid3'),
      sam: optionalStatus(observations, 'sam'),
      grounded_sam: optionalStatus(observations, 'grounded_sam')
    },
    backend_statuses: backendStatuses,
    masks,
    edges,
    lines,
    keypoints,
    regions,
    scale_anchors: scaleAnchors,
    relations,
    view_ground_plane: viewGroundPlane,
    qa,
    correction_targets: correctionTargetsFromQa(qa),
    notes: [
      'VisionEvidenceSet v1 is the R12 lightweight evidence contract.',
      'Backends only provide evidence; PartGraph promotion is controlled by GroundPlan, residual, overlay, and readiness gates.',
      'SAM/INSID3/Grounded-SAM are optional status fields and are not required by the default pipeline.'
    ]
  };
}

export function visionEvidenceSetReport(visionEvidenceSet = {}) {
  return {
    kind: 'vision_evidence_set_v1_report',
    version: 1,
    ok: visionEvidenceSet.qa?.ok === true,
    verdict: visionEvidenceSet.qa?.verdict || 'fail',
    vision_evidence_set_v1: visionEvidenceSet,
    summary: {
      source_images: visionEvidenceSet.source_images?.length || 0,
      masks: visionEvidenceSet.masks?.length || 0,
      edges: visionEvidenceSet.edges?.length || 0,
      accepted_edges: visionEvidenceSet.qa?.accepted_edges || 0,
      rejected_edges: visionEvidenceSet.qa?.rejected_edges || 0,
      lines: visionEvidenceSet.lines?.length || 0,
      keypoints: visionEvidenceSet.keypoints?.length || 0,
      regions: visionEvidenceSet.regions?.length || 0,
      scale_anchors: visionEvidenceSet.scale_anchors?.length || 0,
      relations: visionEvidenceSet.relations?.length || 0,
      default_heavy_model_required: visionEvidenceSet.qa?.default_heavy_model_required === true,
      top_view_ground_plane_confidence: visionEvidenceSet.view_ground_plane?.summary?.top_view_ground_plane_confidence ?? 0,
      planar_groundplan_allowed: visionEvidenceSet.view_ground_plane?.summary?.planar_groundplan_allowed === true,
      view_ground_plane_images: visionEvidenceSet.view_ground_plane?.summary?.images_analyzed ?? 0,
      ground_plane_review_images: visionEvidenceSet.view_ground_plane?.summary?.images_requiring_review ?? 0,
      top_view_candidates: visionEvidenceSet.view_ground_plane?.summary?.top_view_candidates ?? 0,
      oblique_review_images: visionEvidenceSet.view_ground_plane?.summary?.oblique_review_images ?? 0,
      preferred_top_view_usage_policy: visionEvidenceSet.view_ground_plane?.summary?.preferred_top_view_usage_policy || null,
      optional_backend_statuses: visionEvidenceSet.optional_backends || {}
    },
    issues: visionEvidenceSet.qa?.issues || [],
    correction_targets: visionEvidenceSet.correction_targets || []
  };
}

export function buildVisionEvidenceReviewPatch({
  visionEvidenceSet = {},
  source = 'vision_evidence_set_v1'
} = {}) {
  const reviewItems = [
    ...groundPlaneReviewItems(visionEvidenceSet),
    ...edgeClassReviewItems(visionEvidenceSet),
    ...semanticCandidateReviewItems(visionEvidenceSet)
  ];
  const status = reviewItems.length ? 'needs_review' : 'no_review_required';
  return {
    kind: 'vision_evidence_review_patch',
    version: 1,
    source_vision_evidence_set: source,
    status,
    apply_allowed: false,
    compile_allowed: false,
    blockers: reviewItems.length ? ['human_vision_evidence_review_required'] : [],
    review_items: reviewItems,
    summary: {
      total_items: reviewItems.length,
      ground_plane_items: reviewItems.filter((item) => item.evidence_type === 'view_ground_plane').length,
      edge_class_items: reviewItems.filter((item) => item.evidence_type === 'edge_class_policy').length,
      semantic_candidate_items: reviewItems.filter((item) => item.evidence_type === 'semantic_candidate_policy').length,
      blocking_items: reviewItems.filter((item) => item.downstream_effect?.blocked_outputs?.length > 0).length,
      review_required: reviewItems.length > 0
    },
    notes: [
      'This patch is an authoring/review contract, not an applyable geometry patch.',
      'Confirming review items may update evidence policy in a later patch, but must not directly promote geometry or emit SketchUp DSL.'
    ]
  };
}

export function renderVisionEvidenceReviewPatchMarkdown(patch = {}) {
  const lines = [
    '# Vision Evidence Review Patch',
    '',
    `- Status: \`${patch.status || 'unknown'}\``,
    `- Apply allowed: \`${String(patch.apply_allowed === true)}\``,
    `- Compile allowed: \`${String(patch.compile_allowed === true)}\``,
    `- Review items: \`${patch.summary?.total_items ?? 0}\``,
    `- Ground-plane items: \`${patch.summary?.ground_plane_items ?? 0}\``,
    `- Edge class items: \`${patch.summary?.edge_class_items ?? 0}\``,
    `- Semantic candidate items: \`${patch.summary?.semantic_candidate_items ?? 0}\``,
    '',
    '## Review Items'
  ];
  for (const item of patch.review_items || []) {
    const evidenceInstances = item.evidence_type === 'semantic_candidate_policy'
      ? semanticEvidenceInstancesText(item.current_value?.evidence_instances || [])
      : null;
    lines.push(
      '',
      `### ${item.id}`,
      '',
      `- Action: \`${item.action}\``,
      `- Evidence type: \`${item.evidence_type}\``,
      `- Target: \`${item.target_path}\``,
      `- Required decision: \`${item.required_decision}\``,
      `- Source image: \`${item.source_image || 'n/a'}\``,
      ...(evidenceInstances ? [`- Evidence instances: ${evidenceInstances}`] : []),
      `- Risks: \`${(item.risk_flags || []).join(', ') || 'none'}\``,
      `- Reason: ${item.reason}`
    );
  }
  return `${lines.join('\n')}\n`;
}

export function buildAcceptedVisionEvidenceReviewDecision({
  reviewPatch = {},
  reviewer = 'agent_first_review_fixture',
  acceptedAt = '2026-06-17',
  sourceReviewPatch = 'vision-evidence-review-patch.json'
} = {}) {
  const acceptedItems = (reviewPatch.review_items || []).map((item) => acceptedDecisionForReviewItem(item));
  return {
    kind: 'vision_evidence_review_decision',
    version: 1,
    source_review_patch: sourceReviewPatch,
    reviewer,
    accepted_at: acceptedAt,
    status: acceptedItems.length ? 'accepted_policy_review' : 'no_review_items',
    compile_allowed: false,
    geometry_promotion_allowed: false,
    accepted_items: acceptedItems,
    held_items: [],
    blockers: [],
    summary: {
      accepted_items: acceptedItems.length,
      held_items: 0,
      blockers: 0,
      ground_plane_items: acceptedItems.filter((item) => item.evidence_type === 'view_ground_plane').length,
      edge_class_items: acceptedItems.filter((item) => item.evidence_type === 'edge_class_policy').length,
      semantic_candidate_items: acceptedItems.filter((item) => item.evidence_type === 'semantic_candidate_policy').length
    },
    notes: [
      'This decision confirms evidence policy only.',
      'It must not directly promote geometry, generate PartGraph parts, or emit SketchUp DSL.'
    ]
  };
}

export function buildVisionEvidencePolicyCorrectionPatch({
  reviewPatch = {},
  reviewDecision = {},
  sourceReviewPatch = 'vision-evidence-review-patch.json',
  sourceReviewDecision = 'vision-evidence-review.accepted.json'
} = {}) {
  const reviewItemById = new Map((reviewPatch.review_items || []).map((item) => [item.id, item]));
  const blockers = [];
  if (reviewDecision.compile_allowed === true) blockers.push('review_decision_compile_allowed_must_be_false');
  if (reviewDecision.geometry_promotion_allowed === true) blockers.push('review_decision_geometry_promotion_allowed_must_be_false');
  if ((reviewDecision.blockers || []).length) blockers.push('review_decision_has_blockers');

  const actions = [];
  for (const accepted of reviewDecision.accepted_items || []) {
    const reviewItem = reviewItemById.get(accepted.review_item_id);
    if (!reviewItem) {
      blockers.push(`missing_review_item:${accepted.review_item_id}`);
      continue;
    }
    actions.push(policyCorrectionAction({ reviewItem, accepted }));
  }

  const status = blockers.length
    ? 'blocked'
    : actions.length
      ? 'ready_for_vision_evidence_policy_update'
      : 'no_policy_updates';
  return {
    kind: 'vision_evidence_policy_correction_patch',
    version: 1,
    source_review_patch: sourceReviewPatch,
    source_review_decision: sourceReviewDecision,
    status,
    apply_scope: 'vision_evidence_set_policy_only',
    apply_allowed: status === 'ready_for_vision_evidence_policy_update',
    compile_allowed: false,
    geometry_promotion_allowed: false,
    blockers,
    actions: status === 'ready_for_vision_evidence_policy_update' ? actions : [],
    summary: {
      total_actions: status === 'ready_for_vision_evidence_policy_update' ? actions.length : 0,
      ground_plane_actions: status === 'ready_for_vision_evidence_policy_update'
        ? actions.filter((action) => action.evidence_type === 'view_ground_plane').length
        : 0,
      edge_class_actions: status === 'ready_for_vision_evidence_policy_update'
        ? actions.filter((action) => action.evidence_type === 'edge_class_policy').length
        : 0,
      semantic_candidate_actions: status === 'ready_for_vision_evidence_policy_update'
        ? actions.filter((action) => action.evidence_type === 'semantic_candidate_policy').length
        : 0,
      geometry_promotions: 0,
      compile_outputs: 0
    },
    notes: [
      'Apply this patch only to VisionEvidenceSet policy/review metadata.',
      'This patch intentionally preserves geometry promotion and compile gates.'
    ]
  };
}

export function applyVisionEvidencePolicyCorrectionPatch({
  visionEvidenceSet = {},
  patch = {}
} = {}) {
  if (patch.apply_allowed !== true || patch.status !== 'ready_for_vision_evidence_policy_update') {
    throw new Error(`VisionEvidence policy correction patch is not applyable: status=${patch.status}, apply_allowed=${patch.apply_allowed}`);
  }
  const next = cloneJson(visionEvidenceSet);
  const applied = [];
  for (const action of patch.actions || []) {
    if (action.action === 'annotate_ground_plane_policy_review') {
      const index = groundPlaneIndexFromTargetPath(action.target_path);
      const image = next.view_ground_plane?.images?.[index];
      if (!image) throw new Error(`Ground-plane target not found: ${action.target_path}`);
      image.policy_review = policyReviewRecord(action);
      applied.push(action);
    } else if (action.action === 'annotate_edge_class_policy_review') {
      const edgeClass = edgeClassFromTargetPath(action.target_path);
      if (!edgeClass) throw new Error(`Edge class target not found: ${action.target_path}`);
      let count = 0;
      for (const edge of next.edges || []) {
        if (edge.class !== edgeClass) continue;
        edge.policy_review = policyReviewRecord(action);
        count += 1;
      }
      if (!count) throw new Error(`No edges found for policy target: ${action.target_path}`);
      applied.push(action);
    } else if (action.action === 'annotate_semantic_candidate_policy_review') {
      const semanticClass = semanticClassFromTargetPath(action.target_path);
      if (!semanticClass) throw new Error(`Semantic candidate target not found: ${action.target_path}`);
      let count = 0;
      for (const region of next.regions || []) {
        if (region.class !== semanticClass) continue;
        region.policy_review = policyReviewRecord(action);
        count += 1;
      }
      for (const mask of next.masks || []) {
        if (mask.class !== semanticClass) continue;
        mask.policy_review = policyReviewRecord(action);
        count += 1;
      }
      if (!count) throw new Error(`No semantic evidence found for policy target: ${action.target_path}`);
      applied.push(action);
    }
  }
  next.review = {
    ...(next.review || {}),
    policy_correction_patches_applied: [
      ...(next.review?.policy_correction_patches_applied || []),
      {
        source_review_patch: patch.source_review_patch,
        source_review_decision: patch.source_review_decision,
        apply_scope: patch.apply_scope,
        actions: applied.length,
        compile_allowed: patch.compile_allowed,
        geometry_promotion_allowed: patch.geometry_promotion_allowed
      }
    ]
  };
  return { visionEvidenceSet: next, applied };
}

export function renderVisionEvidencePolicyCorrectionPatchMarkdown(patch = {}) {
  const lines = [
    '# Vision Evidence Policy Correction Patch',
    '',
    `- Status: \`${patch.status || 'unknown'}\``,
    `- Apply scope: \`${patch.apply_scope || 'unknown'}\``,
    `- Apply allowed: \`${String(patch.apply_allowed === true)}\``,
    `- Compile allowed: \`${String(patch.compile_allowed === true)}\``,
    `- Geometry promotion allowed: \`${String(patch.geometry_promotion_allowed === true)}\``,
    `- Actions: \`${patch.summary?.total_actions ?? 0}\``,
    `- Semantic candidate actions: \`${patch.summary?.semantic_candidate_actions ?? 0}\``,
    '',
    '## Actions'
  ];
  for (const action of patch.actions || []) {
    lines.push(
      '',
      `### ${action.review_item_id}`,
      '',
      `- Action: \`${action.action}\``,
      `- Evidence type: \`${action.evidence_type}\``,
      `- Target: \`${action.target_path}\``,
      `- Decision: \`${action.decision}\``,
      `- Risk disposition: \`${action.risk_disposition}\``,
      `- Geometry promotion allowed: \`${String(action.geometry_promotion_allowed === true)}\``,
      `- Note: ${action.reviewer_note || 'n/a'}`
    );
  }
  return `${lines.join('\n')}\n`;
}

export function renderVisionEvidenceReviewWorkbenchHtml({
  reviewPatch = {},
  initialDecision = null,
  title = 'Vision Evidence Review Workbench'
} = {}) {
  const decision = initialDecision || buildAcceptedVisionEvidenceReviewDecision({ reviewPatch });
  const rows = (reviewPatch.review_items || []).map((item) => {
    const riskTags = (item.risk_flags || []).length
      ? item.risk_flags.map((risk) => `<span class="tag warn">${escapeHtml(risk)}</span>`).join('')
      : '<span class="tag good">none</span>';
    const blocked = (item.downstream_effect?.blocked_outputs || [])
      .map((value) => `<span class="tag bad">${escapeHtml(value)}</span>`)
      .join('');
    const sourceEvidence = item.evidence_type === 'semantic_candidate_policy'
      ? `${item.source_image || 'n/a'}${semanticEvidenceInstancesText(item.current_value?.evidence_instances || []) ? ` | ${semanticEvidenceInstancesText(item.current_value?.evidence_instances || [])}` : ''}`
      : item.source_image || 'n/a';
    return `<tr>
      <td><input class="vision-review-item-select" type="checkbox" data-review-item-id="${escapeHtml(item.id)}" checked aria-label="Accept ${escapeHtml(item.id)}"></td>
      <td><code>${escapeHtml(item.id)}</code></td>
      <td>${escapeHtml(item.evidence_type)}</td>
      <td><code>${escapeHtml(item.required_decision)}</code></td>
      <td>${escapeHtml(sourceEvidence)}</td>
      <td>${riskTags}</td>
      <td>${blocked}</td>
    </tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --ink: #17202a;
      --muted: #5b6472;
      --line: #d8dee8;
      --good: #087f5b;
      --warn: #9a6700;
      --bad: #b42318;
      --accent: #1f6feb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }
    header, main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px;
    }
    header {
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 18px; letter-spacing: 0; }
    .subtle { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .metric, .section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .metric span { display: block; font-size: 12px; color: var(--muted); }
    .metric strong { display: block; margin-top: 4px; font-size: 22px; }
    .section { margin: 16px 0; }
    .scroll { overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; min-width: 920px; }
    th, td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: #eef2f7; font-size: 12px; text-transform: uppercase; color: var(--muted); }
    code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; }
    .tag {
      display: inline-block;
      margin: 2px 4px 2px 0;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid var(--line);
      font-size: 12px;
      white-space: nowrap;
    }
    .tag.good { color: var(--good); border-color: rgba(8,127,91,.25); background: rgba(8,127,91,.08); }
    .tag.warn { color: var(--warn); border-color: rgba(154,103,0,.25); background: rgba(154,103,0,.08); }
    .tag.bad { color: var(--bad); border-color: rgba(180,35,24,.25); background: rgba(180,35,24,.08); }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
    button {
      appearance: none;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--ink);
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
    }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      background: #fff;
      color: var(--ink);
    }
    textarea { font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; }
    .review-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 760px) {
      header, main { padding: 16px; }
      .grid, .review-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p class="subtle">Review evidence policy only. Exported decisions cannot promote geometry or emit SketchUp DSL.</p>
  </header>
  <main>
    <section class="grid">
      <div class="metric"><span>Status</span><strong>${escapeHtml(reviewPatch.status || 'unknown')}</strong></div>
      <div class="metric"><span>Review Items</span><strong>${String(reviewPatch.summary?.total_items ?? 0)}</strong></div>
      <div class="metric"><span>Apply Allowed</span><strong>${String(reviewPatch.apply_allowed === true)}</strong></div>
      <div class="metric"><span>Compile Allowed</span><strong>${String(reviewPatch.compile_allowed === true)}</strong></div>
    </section>
    <section class="section">
      <h2>Review Items</h2>
      <div class="toolbar">
        <button type="button" id="select-all-vision-evidence">Select All</button>
        <button type="button" id="clear-vision-evidence-selection">Clear</button>
      </div>
      <div class="scroll">
        <table>
          <thead><tr><th>Accept</th><th>ID</th><th>Type</th><th>Decision</th><th>Source</th><th>Risks</th><th>Blocked Outputs</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7">No review items.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
    <section class="section">
      <h2>Review Decision</h2>
      <div class="review-grid">
        <label>Reviewer<br><input id="vision-reviewer-name" value="vision-evidence-workbench"></label>
        <label>Accepted at<br><input id="vision-accepted-at" value="2026-06-17"></label>
        <label>Source patch<br><input id="vision-source-review-patch" value="${escapeHtml(decision.source_review_patch || 'vision-evidence-review-patch.json')}"></label>
      </div>
      <label>Notes<br><textarea id="vision-review-notes" rows="3" placeholder="Ground-plane, oblique, roof seam, unknown edge policy notes"></textarea></label>
      <div class="toolbar">
        <button type="button" class="primary" id="refresh-vision-evidence-review">Refresh Decision JSON</button>
        <button type="button" id="copy-vision-evidence-review">Copy JSON</button>
        <button type="button" id="download-vision-evidence-review">Download JSON</button>
      </div>
      <textarea id="vision-evidence-review-decision-json" rows="18" spellcheck="false"></textarea>
    </section>
  </main>
  <script id="vision-evidence-review-patch-data" type="application/json">${scriptJson(reviewPatch)}</script>
  <script id="vision-evidence-review-decision-data" type="application/json">${scriptJson(decision)}</script>
  <script>
    const reviewPatch = JSON.parse(document.getElementById('vision-evidence-review-patch-data').textContent);
    const initialDecision = JSON.parse(document.getElementById('vision-evidence-review-decision-data').textContent);
    const reviewItemById = new Map((reviewPatch.review_items || []).map((item) => [item.id, item]));
    const selectedReviewItems = () => Array.from(document.querySelectorAll('.vision-review-item-select:checked'))
      .map((input) => reviewItemById.get(input.dataset.reviewItemId))
      .filter(Boolean);
    function decisionForReviewItem(item) {
      if (item.required_decision === 'confirm_top_view_planar_groundplan_candidate_or_downgrade') return 'confirmed_planar_groundplan_candidate';
      if (item.required_decision === 'confirm_review_only_context_or_provide_better_view') return 'confirmed_review_only_context';
      if (item.required_decision === 'confirm_roof_seams_are_not_site_or_road_boundaries') return 'confirmed_keep_roof_seam_rejected';
      if (item.required_decision === 'confirm_unknown_edges_remain_review_only_or_reclassify') return 'confirmed_keep_unknown_review_only';
      if (item.evidence_type === 'semantic_candidate_policy') return item.suggested_value?.decision || 'confirmed_semantic_candidate_policy';
      return 'confirmed_review_policy';
    }
    function acceptedValue(item, decision) {
      if (item.evidence_type === 'view_ground_plane') {
        return {
          usage_policy: item.suggested_value?.usage_policy || item.current_value?.usage_policy || 'review_only',
          planar_groundplan_allowed: item.suggested_value?.planar_groundplan_allowed === true,
          reviewer_confirmation_required: false,
          review_status: 'manual_confirmed'
        };
      }
      if (item.evidence_type === 'edge_class_policy') {
        return {
          policy: item.suggested_value?.policy || decision,
          promote_to_boundary: false,
          review_status: 'manual_confirmed'
        };
      }
      if (item.evidence_type === 'semantic_candidate_policy') {
        return {
          policy: item.suggested_value?.policy || decision,
          role: item.current_value?.role || item.current_value?.class || 'semantic_candidate',
          review_status: 'manual_confirmed',
          promote_to_geometry: false
        };
      }
      return { review_status: 'manual_confirmed' };
    }
    function riskDisposition(item, decision) {
      if (decision === 'confirmed_planar_groundplan_candidate') return 'accepted_as_reviewed_planar_candidate';
      if (decision === 'confirmed_review_only_context') return 'kept_as_context_not_planar_groundplan';
      if (decision === 'confirmed_keep_roof_seam_rejected') return 'kept_rejected_not_boundary';
      if (decision === 'confirmed_keep_unknown_review_only') return 'kept_review_only_until_reclassified';
      if (item.evidence_type === 'semantic_candidate_policy') return item.suggested_value?.risk_disposition || 'reviewed_semantic_candidate_with_geometry_blocked';
      return item.risk_flags?.length ? 'reviewed_with_risks_retained' : 'reviewed';
    }
    function resolvedBlockers(item) {
      if (item.evidence_type === 'view_ground_plane') {
        return item.current_value?.usage_policy === 'planar_groundplan_candidate'
          ? ['top_view_ground_plane_policy_review_required']
          : ['oblique_ground_plane_policy_review_required'];
      }
      if (item.evidence_type === 'edge_class_policy') {
        return item.required_decision === 'confirm_roof_seams_are_not_site_or_road_boundaries'
          ? ['roof_seam_boundary_policy_review_required']
          : ['unknown_edge_policy_review_required'];
      }
      if (item.evidence_type === 'semantic_candidate_policy') {
        return item.suggested_value?.resolved_blockers || ['semantic_candidate_policy_review_required'];
      }
      return ['vision_evidence_policy_review_required'];
    }
    function buildAcceptedItem(item) {
      const decision = decisionForReviewItem(item);
      return {
        review_item_id: item.id,
        evidence_type: item.evidence_type,
        decision,
        accepted_value: acceptedValue(item, decision),
        risk_disposition: riskDisposition(item, decision),
        resolved_blockers: resolvedBlockers(item),
        reviewer_note: document.getElementById('vision-review-notes').value || item.reason || 'Vision evidence policy reviewed.',
        geometry_promotion_allowed: false,
        compile_allowed: false
      };
    }
    function buildVisionEvidenceReviewDecision() {
      const acceptedItems = selectedReviewItems().map(buildAcceptedItem);
      const heldItems = (reviewPatch.review_items || [])
        .filter((item) => !acceptedItems.some((accepted) => accepted.review_item_id === item.id))
        .map((item) => ({
          review_item_id: item.id,
          evidence_type: item.evidence_type,
          decision: 'held_for_review',
          accepted_value: {},
          risk_disposition: 'unresolved',
          resolved_blockers: [],
          reviewer_note: 'Held in VisionEvidence review workbench.',
          geometry_promotion_allowed: false,
          compile_allowed: false
        }));
      return {
        ...initialDecision,
        source_review_patch: document.getElementById('vision-source-review-patch').value || initialDecision.source_review_patch,
        reviewer: document.getElementById('vision-reviewer-name').value || 'vision-evidence-workbench',
        accepted_at: document.getElementById('vision-accepted-at').value || '2026-06-17',
        status: heldItems.length ? 'partial_policy_review' : acceptedItems.length ? 'accepted_policy_review' : 'no_review_items',
        compile_allowed: false,
        geometry_promotion_allowed: false,
        accepted_items: acceptedItems,
        held_items: heldItems,
        blockers: [],
        summary: {
          accepted_items: acceptedItems.length,
          held_items: heldItems.length,
          blockers: 0,
          ground_plane_items: acceptedItems.filter((item) => item.evidence_type === 'view_ground_plane').length,
          edge_class_items: acceptedItems.filter((item) => item.evidence_type === 'edge_class_policy').length,
          semantic_candidate_items: acceptedItems.filter((item) => item.evidence_type === 'semantic_candidate_policy').length
        },
        notes: [
          'Exported from VisionEvidence review workbench.',
          'This decision confirms evidence policy only.',
          'It must not directly promote geometry, generate PartGraph parts, or emit SketchUp DSL.'
        ]
      };
    }
    function refreshDecision() {
      document.getElementById('vision-evidence-review-decision-json').value = JSON.stringify(buildVisionEvidenceReviewDecision(), null, 2);
    }
    document.getElementById('select-all-vision-evidence').addEventListener('click', () => {
      for (const input of document.querySelectorAll('.vision-review-item-select')) input.checked = true;
      refreshDecision();
    });
    document.getElementById('clear-vision-evidence-selection').addEventListener('click', () => {
      for (const input of document.querySelectorAll('.vision-review-item-select')) input.checked = false;
      refreshDecision();
    });
    document.getElementById('refresh-vision-evidence-review').addEventListener('click', refreshDecision);
    document.getElementById('copy-vision-evidence-review').addEventListener('click', async () => {
      refreshDecision();
      await navigator.clipboard.writeText(document.getElementById('vision-evidence-review-decision-json').value);
    });
    document.getElementById('download-vision-evidence-review').addEventListener('click', () => {
      refreshDecision();
      const blob = new Blob([document.getElementById('vision-evidence-review-decision-json').value + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'vision-evidence-review-decision.json';
      anchor.click();
      URL.revokeObjectURL(url);
    });
    refreshDecision();
  </script>
</body>
</html>
`;
}

export function boundaryEdgesFromVisionEvidenceSetV1(visionEvidenceSet = {}) {
  if (visionEvidenceSet?.kind !== 'vision_evidence_set_v1') return [];
  return (visionEvidenceSet.edges || [])
    .filter((edge) => edge.accepted === true)
    .filter((edge) => ['opencv_edge_v1', 'high_contrast_edge_v1'].includes(edge.source_stage))
    .filter((edge) => !['roof_internal_seam', 'unknown'].includes(edge.class))
    .map((edge, index) => ({
      id: `vision_evidence_boundary_edge_${index + 1}_${edge.id}`,
      type: boundaryTypeForVisionEdge(edge.class),
      state: 'observed',
      a: edge.a,
      b: edge.b,
      method: edge.source_stage === 'opencv_edge_v1' ? 'opencv_edge_v1_segment' : 'high_contrast_edge_v1_segment',
      confidence: edge.confidence,
      source_ids: [edge.id],
      inference_level: 'observed',
      completion_hypothesis_id: null,
      completion_reason: null,
      class_boundary_hint: edge.class,
      risk_flags: edge.risk_flags || [],
      source_pixel_support_ratio: edge.residuals?.source_pixel_support_ratio ?? 0,
      source_edge_strength: edge.residuals?.source_edge_strength ?? 0,
      context: {
        source_stage: 'vision_evidence_set_v1',
        backend: edge.backend,
        original_class: edge.original_class,
        review_required: edge.review_required
      }
    }));
}

function acceptedDecisionForReviewItem(item = {}) {
  const decision = decisionForReviewItem(item);
  return {
    review_item_id: item.id,
    evidence_type: item.evidence_type,
    decision,
    accepted_value: acceptedValueForReviewItem(item, decision),
    risk_disposition: riskDispositionForReviewItem(item, decision),
    resolved_blockers: resolvedBlockersForReviewItem(item),
    reviewer_note: reviewerNoteForReviewItem(item, decision),
    geometry_promotion_allowed: false,
    compile_allowed: false
  };
}

function decisionForReviewItem(item = {}) {
  if (item.required_decision === 'confirm_top_view_planar_groundplan_candidate_or_downgrade') {
    return 'confirmed_planar_groundplan_candidate';
  }
  if (item.required_decision === 'confirm_review_only_context_or_provide_better_view') {
    return 'confirmed_review_only_context';
  }
  if (item.required_decision === 'confirm_roof_seams_are_not_site_or_road_boundaries') {
    return 'confirmed_keep_roof_seam_rejected';
  }
  if (item.required_decision === 'confirm_unknown_edges_remain_review_only_or_reclassify') {
    return 'confirmed_keep_unknown_review_only';
  }
  if (item.evidence_type === 'semantic_candidate_policy') {
    return item.suggested_value?.decision || 'confirmed_semantic_candidate_policy';
  }
  return 'confirmed_review_policy';
}

function acceptedValueForReviewItem(item = {}, decision = '') {
  if (item.evidence_type === 'view_ground_plane') {
    return {
      usage_policy: item.suggested_value?.usage_policy || item.current_value?.usage_policy || 'review_only',
      planar_groundplan_allowed: item.suggested_value?.planar_groundplan_allowed === true,
      reviewer_confirmation_required: false,
      review_status: 'manual_confirmed'
    };
  }
  if (item.evidence_type === 'edge_class_policy') {
    return {
      policy: item.suggested_value?.policy || decision,
      promote_to_boundary: false,
      review_status: 'manual_confirmed'
    };
  }
  if (item.evidence_type === 'semantic_candidate_policy') {
    return {
      policy: item.suggested_value?.policy || decision,
      role: item.current_value?.role || item.current_value?.class || 'semantic_candidate',
      promote_to_geometry: false,
      review_status: 'manual_confirmed'
    };
  }
  return {
    review_status: 'manual_confirmed'
  };
}

function riskDispositionForReviewItem(item = {}, decision = '') {
  if (decision === 'confirmed_planar_groundplan_candidate') return 'accepted_as_reviewed_planar_candidate';
  if (decision === 'confirmed_review_only_context') return 'kept_as_context_not_planar_groundplan';
  if (decision === 'confirmed_keep_roof_seam_rejected') return 'kept_rejected_not_boundary';
  if (decision === 'confirmed_keep_unknown_review_only') return 'kept_review_only_until_reclassified';
  if (item.evidence_type === 'semantic_candidate_policy') {
    return item.suggested_value?.risk_disposition || 'reviewed_semantic_candidate_with_geometry_blocked';
  }
  return item.risk_flags?.length ? 'reviewed_with_risks_retained' : 'reviewed';
}

function resolvedBlockersForReviewItem(item = {}) {
  if (item.evidence_type === 'view_ground_plane') {
    return item.current_value?.usage_policy === 'planar_groundplan_candidate'
      ? ['top_view_ground_plane_policy_review_required']
      : ['oblique_ground_plane_policy_review_required'];
  }
  if (item.evidence_type === 'edge_class_policy') {
    return item.required_decision === 'confirm_roof_seams_are_not_site_or_road_boundaries'
      ? ['roof_seam_boundary_policy_review_required']
      : ['unknown_edge_policy_review_required'];
  }
  if (item.evidence_type === 'semantic_candidate_policy') {
    return item.suggested_value?.resolved_blockers || ['semantic_candidate_policy_review_required'];
  }
  return ['vision_evidence_policy_review_required'];
}

function reviewerNoteForReviewItem(item = {}, decision = '') {
  if (decision === 'confirmed_planar_groundplan_candidate') {
    return 'Top view may remain a reviewed planar GroundPlan candidate; downstream GroundPlan/QA gates still decide promotion.';
  }
  if (decision === 'confirmed_review_only_context') {
    return 'Oblique image remains visual context and must not seed planar GroundPlan geometry.';
  }
  if (decision === 'confirmed_keep_roof_seam_rejected') {
    return 'Roof/internal seam edges stay rejected for site and road boundary promotion.';
  }
  if (decision === 'confirmed_keep_unknown_review_only') {
    return 'Unknown edges remain review-only until explicitly reclassified.';
  }
  if (item.evidence_type === 'semantic_candidate_policy') {
    return item.reason || 'Semantic candidate policy reviewed; geometry promotion remains blocked.';
  }
  return item.reason || 'Vision evidence policy reviewed.';
}

function policyCorrectionAction({ reviewItem = {}, accepted = {} } = {}) {
  const action = policyCorrectionActionType(reviewItem.evidence_type);
  return {
    action,
    review_item_id: reviewItem.id,
    evidence_type: reviewItem.evidence_type,
    target_path: reviewItem.target_path,
    source_image: reviewItem.source_image || '',
    decision: accepted.decision || decisionForReviewItem(reviewItem),
    previous_value: reviewItem.current_value || {},
    value: {
      ...(accepted.accepted_value || acceptedValueForReviewItem(reviewItem, accepted.decision)),
      review_status: 'manual_confirmed'
    },
    risk_flags: reviewItem.risk_flags || [],
    risk_disposition: accepted.risk_disposition || riskDispositionForReviewItem(reviewItem, accepted.decision),
    resolved_blockers: accepted.resolved_blockers || [],
    downstream_effect: {
      allowed_outputs: reviewItem.downstream_effect?.allowed_outputs || [],
      blocked_outputs: uniqueStrings([
        ...(reviewItem.downstream_effect?.blocked_outputs || []),
        'direct_part_graph_geometry_promotion',
        'direct_sketchup_dsl'
      ]),
      next_action: reviewItem.downstream_effect?.next_action || 'continue_review_gated_pipeline'
    },
    geometry_promotion_allowed: false,
    compile_allowed: false,
    reviewer_note: accepted.reviewer_note || reviewerNoteForReviewItem(reviewItem, accepted.decision)
  };
}

function policyCorrectionActionType(evidenceType) {
  if (evidenceType === 'view_ground_plane') return 'annotate_ground_plane_policy_review';
  if (evidenceType === 'edge_class_policy') return 'annotate_edge_class_policy_review';
  if (evidenceType === 'semantic_candidate_policy') return 'annotate_semantic_candidate_policy_review';
  return 'annotate_semantic_candidate_policy_review';
}

function policyReviewRecord(action = {}) {
  return {
    status: 'manual_confirmed',
    source: 'vision_evidence_policy_correction_patch',
    review_item_id: action.review_item_id,
    decision: action.decision,
    risk_disposition: action.risk_disposition,
    geometry_promotion_allowed: false,
    compile_allowed: false,
    reviewer_note: action.reviewer_note || ''
  };
}

function groundPlaneIndexFromTargetPath(targetPath = '') {
  const match = String(targetPath).match(/view_ground_plane\.images\[(\d+)\]/u);
  if (!match) return -1;
  return Number(match[1]);
}

function edgeClassFromTargetPath(targetPath = '') {
  const match = String(targetPath).match(/edges\[class=([^\]]+)\]/u);
  return match ? match[1] : null;
}

function semanticClassFromTargetPath(targetPath = '') {
  const match = String(targetPath).match(/semantic_candidates\[class=([^\]]+)\]/u);
  return match ? match[1] : null;
}

function groundPlaneReviewItems(visionEvidenceSet = {}) {
  return (visionEvidenceSet.view_ground_plane?.images || [])
    .map((image, index) => ({ image, index }))
    .filter(({ image }) => image.review_required === true || (image.risks || []).length > 0)
    .map(({ image, index }) => ({
      id: `ground_plane:${index + 1}:${slug(image.detected_view || 'unknown')}`,
      evidence_type: 'view_ground_plane',
      action: 'confirm_ground_plane_usage_policy',
      target_path: `vision_evidence_set_v1.view_ground_plane.images[${index}].usage_policy`,
      source_image: image.source_image || '',
      current_value: {
        detected_view: image.detected_view,
        usage_policy: image.usage_policy,
        planar_groundplan_allowed: image.planar_groundplan_allowed === true,
        ground_plane_confidence: image.ground_plane_confidence,
        confidence_band: image.confidence_band,
        evidence_summary: image.evidence_summary || {}
      },
      suggested_value: {
        usage_policy: image.usage_policy,
        planar_groundplan_allowed: image.planar_groundplan_allowed === true,
        reviewer_confirmation_required: true
      },
      required_decision: image.usage_policy === 'planar_groundplan_candidate'
        ? 'confirm_top_view_planar_groundplan_candidate_or_downgrade'
        : 'confirm_review_only_context_or_provide_better_view',
      risk_flags: image.risks || [],
      reason: image.usage_policy === 'planar_groundplan_candidate'
        ? 'Top/near-orthographic view can seed planar GroundPlan, but camera and scale evidence still need review before promotion.'
        : 'Non-top imagery is useful context but must not be used as promoted planar GroundPlan evidence.',
      downstream_effect: {
        allowed_outputs: image.usage_policy === 'planar_groundplan_candidate' ? ['reviewed_ground_plan_candidate'] : ['visual_context_only'],
        blocked_outputs: ['direct_sketchup_dsl', 'photo_grade_candidate_without_review'],
        next_action: image.usage_policy === 'planar_groundplan_candidate'
          ? 'review_top_view_ground_plane_and_scale_anchor_support'
          : 'keep_oblique_image_review_only_or_upload_top_view'
      }
    }));
}

function semanticCandidateReviewItems(visionEvidenceSet = {}) {
  const classes = new Map();
  for (const evidence of [...(visionEvidenceSet.regions || []), ...(visionEvidenceSet.masks || [])]) {
    const className = evidence.class;
    const policy = SEMANTIC_CANDIDATE_REVIEW_POLICIES[className];
    if (!policy) continue;
    const record = classes.get(className) || {
      className,
      total: 0,
      reviewRequired: 0,
      sourceImages: new Set(),
      riskFlags: new Set(),
      sourceIds: new Set(),
      evidenceInstances: [],
      maxConfidence: 0
    };
    record.total += 1;
    if (evidence.review_required) record.reviewRequired += 1;
    if (evidence.source_image) record.sourceImages.add(evidence.source_image);
    if (evidence.provenance?.source_id) record.sourceIds.add(evidence.provenance.source_id);
    record.evidenceInstances.push(semanticEvidenceInstance(record.className, evidence));
    record.maxConfidence = Math.max(record.maxConfidence, Number(evidence.confidence || 0));
    for (const risk of semanticRiskFlagsFor(className, evidence)) record.riskFlags.add(risk);
    classes.set(className, record);
  }
  return Array.from(classes.values())
    .sort((a, b) => semanticReviewPriority(a.className) - semanticReviewPriority(b.className))
    .map((record) => {
      const policy = SEMANTIC_CANDIDATE_REVIEW_POLICIES[record.className];
      return {
        id: `semantic_candidate:${slug(record.className)}`,
        evidence_type: 'semantic_candidate_policy',
        action: 'confirm_semantic_candidate_review_policy',
        target_path: `vision_evidence_set_v1.semantic_candidates[class=${record.className}]`,
        source_image: Array.from(record.sourceImages)[0] || '',
        current_value: {
          role: record.className,
          class: record.className,
          total_evidence: record.total,
          review_required_evidence: record.reviewRequired,
          max_confidence: round(record.maxConfidence),
          source_images: Array.from(record.sourceImages),
          source_ids: Array.from(record.sourceIds).slice(0, 24),
          evidence_instances: record.evidenceInstances
            .filter(Boolean)
            .sort(compareSemanticEvidenceInstances)
            .slice(0, 24)
        },
        suggested_value: {
          policy: policy.policy,
          decision: policy.decision,
          promote_to_geometry: false,
          risk_disposition: policy.riskDisposition,
          resolved_blockers: policy.resolvedBlockers
        },
        required_decision: policy.requiredDecision,
        risk_flags: Array.from(record.riskFlags),
        reason: policy.reason,
        downstream_effect: {
          allowed_outputs: policy.allowedOutputs,
          blocked_outputs: uniqueStrings([
            ...policy.blockedOutputs,
            'direct_part_graph_geometry_promotion',
            'direct_sketchup_dsl'
          ]),
          next_action: policy.nextAction
        }
      };
    });
}

function semanticEvidenceInstance(className, evidence = {}) {
  const sourceId = evidence.provenance?.source_id || evidence.id || '';
  return {
    evidence_id: evidence.id || sourceId || `${className}_evidence`,
    source_id: sourceId,
    source_image: evidence.source_image || '',
    view: inferSemanticEvidenceView(evidence),
    class: className,
    kind: evidence.kind || 'region',
    bbox_px: normalizeBbox(evidence.bbox_px || evidence.bbox || []),
    polygon_px: normalizePolygon(evidence.polygon_px || evidence.points || []),
    image_space_geometry: evidence.image_space_geometry || evidence.provenance?.image_space_geometry || '',
    polygon_derivation: evidence.polygon_derivation || evidence.provenance?.polygon_derivation || '',
    projection_model: evidence.projection_model || evidence.provenance?.projection_model || '',
    perspective_strength: evidence.perspective_strength || evidence.provenance?.perspective_strength || '',
    orthographic_projection_allowed: evidence.orthographic_projection_allowed === true || evidence.provenance?.orthographic_projection_allowed === true,
    confidence: round(evidence.confidence || 0),
    backend: evidence.backend || evidence.provenance?.method || '',
    source_stage: evidence.source_stage || evidence.provenance?.source_stage || '',
    semantic_source: evidence.provenance?.semantic_source || '',
    semantic_evidence_id: evidence.provenance?.semantic_evidence_id || '',
    semantic_source_priority: evidence.provenance?.semantic_source_priority ?? null,
    blocked_interpretations: evidence.provenance?.blocked_interpretations || [],
    review_required: evidence.review_required === true
  };
}

function compareSemanticEvidenceInstances(a = {}, b = {}) {
  return (b.confidence || 0) - (a.confidence || 0)
    || String(a.view || '').localeCompare(String(b.view || ''))
    || String(a.source_id || '').localeCompare(String(b.source_id || ''));
}

function inferSemanticEvidenceView(evidence = {}) {
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

function semanticEvidenceInstancesText(instances = []) {
  return instances
    .slice(0, 4)
    .map((instance) => {
      const bbox = Array.isArray(instance.bbox_px) && instance.bbox_px.length === 4
        ? ` bbox=${instance.bbox_px.join(',')}`
        : '';
      const confidence = Number.isFinite(Number(instance.confidence)) ? ` conf=${instance.confidence}` : '';
      return `${instance.source_id || instance.evidence_id || 'evidence'} view=${instance.view || 'unknown'}${bbox}${confidence}`;
    })
    .join('; ');
}

function semanticRiskFlagsFor(className, evidence = {}) {
  const risks = new Set();
  if (evidence.review_required) risks.add('review_required');
  if (Number(evidence.confidence || 0) < 0.65) risks.add('low_confidence_semantic_candidate');
  if (className === 'visible_plane_primary') risks.add('visible_plane_primary_may_absorb_other_roles');
  if (className === 'visible_plane_recessed_left') risks.add('visible_plane_recessed_left_may_be_mismerged_into_primary');
  if (className === 'rectangular_utility_ducts') risks.add('duct_may_be_misread_as_trim_or_round_pipe');
  if (className === 'shadow_or_recess_boundary') risks.add('shadow_may_be_misread_as_geometry');
  if (className === 'exterior_hvac_units') risks.add('fixture_may_be_misread_as_facade_mass');
  if (className === 'upper_window_bands') risks.add('window_rhythm_may_be_texture_or_opening');
  if (className === 'ground_floor_storefront') risks.add('storefront_boundary_requires_facade_plane_review');
  return Array.from(risks);
}

function semanticReviewPriority(className) {
  const order = [
    'visible_plane_primary',
    'visible_plane_recessed_left',
    'rectangular_utility_ducts',
    'shadow_or_recess_boundary',
    'exterior_hvac_units',
    'upper_window_bands',
    'ground_floor_storefront'
  ];
  const index = order.indexOf(className);
  return index === -1 ? 999 : index;
}

function edgeClassReviewItems(visionEvidenceSet = {}) {
  const classes = new Map();
  for (const edge of visionEvidenceSet.edges || []) {
    if (!edge.class) continue;
    const record = classes.get(edge.class) || {
      className: edge.class,
      total: 0,
      accepted: 0,
      rejected: 0,
      reviewRequired: 0,
      sourceImages: new Set(),
      riskFlags: new Set()
    };
    record.total += 1;
    if (edge.accepted === true) record.accepted += 1;
    if (edge.accepted === false || edge.review_required) record.rejected += 1;
    if (edge.review_required) record.reviewRequired += 1;
    if (edge.source_image) record.sourceImages.add(edge.source_image);
    for (const risk of edge.risk_flags || []) record.riskFlags.add(risk);
    classes.set(edge.class, record);
  }
  return Array.from(classes.values())
    .filter((record) => record.className === 'roof_internal_seam' || record.className === 'unknown')
    .filter((record) => record.rejected > 0 || record.reviewRequired > 0)
    .map((record) => ({
      id: `edge_class:${slug(record.className)}`,
      evidence_type: 'edge_class_policy',
      action: 'confirm_edge_class_review_policy',
      target_path: `vision_evidence_set_v1.edges[class=${record.className}]`,
      source_image: Array.from(record.sourceImages)[0] || '',
      current_value: {
        class: record.className,
        total_edges: record.total,
        accepted_edges: record.accepted,
        rejected_or_review_edges: record.rejected,
        review_required_edges: record.reviewRequired,
        source_images: Array.from(record.sourceImages)
      },
      suggested_value: {
        policy: record.className === 'roof_internal_seam'
          ? 'keep_rejected_as_roof_internal_seam_not_boundary'
          : 'keep_unknown_review_only_until_reclassified',
        promote_to_boundary: false
      },
      required_decision: record.className === 'roof_internal_seam'
        ? 'confirm_roof_seams_are_not_site_or_road_boundaries'
        : 'confirm_unknown_edges_remain_review_only_or_reclassify',
      risk_flags: Array.from(record.riskFlags),
      reason: record.className === 'roof_internal_seam'
        ? 'Roof/internal seams create strong image edges but must not become site perimeter or road boundary geometry.'
        : 'Unknown edge evidence needs human classification before any downstream geometry use.',
      downstream_effect: {
        allowed_outputs: ['reviewed_edge_evidence'],
        blocked_outputs: ['promoted_boundary_from_unreviewed_edge'],
        next_action: record.className === 'roof_internal_seam'
          ? 'keep_roof_seam_rejected_or_mark_as_roof_detail'
          : 'classify_unknown_edges_before_boundary_promotion'
      }
    }));
}

function slug(value = 'unknown') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function makeSyntheticVisionEvidenceSetFixture(kind = 'top_view') {
  const base = {
    kind: 'vision_evidence_set_v1',
    version: 1,
    coordinate_convention: 'image_x_right_y_down',
    policy: 'synthetic_fixture',
    source_images: [`synthetic://${kind}`],
    default_backends: ['synthetic_cv_fixture'],
    optional_backends: {
      insid3: { status: 'skipped_unavailable', required: false },
      sam: { status: 'skipped_unavailable', required: false },
      grounded_sam: { status: 'skipped_unavailable', required: false }
    },
    backend_statuses: [{ backend: 'synthetic_cv_fixture', available: true, required: true, status: 'available' }],
    masks: [evidenceBase({
      id: 'synthetic_building_mask',
      kind: 'mask',
      className: 'building_footprint',
      sourceImage: `synthetic://${kind}`,
      backend: 'synthetic_cv_fixture',
      confidence: 0.85,
      reviewRequired: false,
      geometry: { bbox_px: [40, 30, 80, 60], polygon_px: bboxPolygon([40, 30, 80, 60]) }
    })],
    edges: [
      evidenceBase({
        id: 'synthetic_site_edge',
        kind: 'edge',
        className: 'site_perimeter',
        sourceImage: `synthetic://${kind}`,
        backend: 'synthetic_cv_fixture',
        confidence: 0.8,
        reviewRequired: false,
        geometry: { a: [0, 0], b: [220, 0] }
      }),
      evidenceBase({
        id: 'synthetic_roof_seam',
        kind: 'edge',
        className: 'roof_internal_seam',
        sourceImage: `synthetic://${kind}`,
        backend: 'synthetic_cv_fixture',
        confidence: 0.72,
        reviewRequired: true,
        accepted: false,
        geometry: { a: [55, 52], b: [108, 52] },
        residuals: { rejection_reason: 'inside_building_roof_seam' }
      })
    ],
    lines: [],
    keypoints: [],
    regions: [],
    scale_anchors: [],
    relations: [],
    view_ground_plane: syntheticGroundPlane(kind),
    qa: null,
    correction_targets: [],
    notes: []
  };
  base.qa = visionEvidenceSetQa(base);
  base.correction_targets = correctionTargetsFromQa(base.qa);
  return base;
}

function masksFromLandCover(landCover = null) {
  if (landCover?.kind !== 'bird_eye_land_cover_v1') return [];
  return (landCover.masks || []).map((mask) => evidenceBase({
    id: `land_cover_mask:${mask.id}`,
    kind: 'mask',
    className: normalizeLandCoverClass(mask.class),
    sourceImage: landCover.source_image,
    backend: landCover.backend || 'bird_eye_land_cover_v1',
    confidence: mask.confidence ?? confidenceForLandCover(mask.class),
    reviewRequired: Boolean(mask.review_required || ['unknown', 'shadow_or_dark_unknown'].includes(mask.class)),
    sourceStage: 'land_cover_v1',
    geometry: {
      bbox_px: normalizeBbox(mask.bbox_px || mask.bbox || [0, 0, 0, 0]),
      polygon_px: normalizePolygon(mask.polygon_px || mask.polygon || bboxPolygon(mask.bbox_px || mask.bbox || [0, 0, 0, 0]))
    },
    provenance: { source_id: mask.id, method: mask.method || 'land_cover_mask' }
  }));
}

function masksFromImageObservations(images = []) {
  const masks = [];
  for (const image of images) {
    for (const item of image.observations || []) {
      if (!['mask_polygon', 'sampled_contour', 'gap_region', 'vegetation_region', 'color_region', 'silhouette'].includes(item.kind)) continue;
      const mask = item.mask || {};
      masks.push(evidenceBase({
        id: `image_mask:${item.id}`,
        kind: 'mask',
        className: classFromObservation(item),
        sourceImage: image.image?.path || item.source_image || null,
        backend: item.grounding?.method || mask.method || item.kind,
        confidence: item.confidence ?? 0.5,
        reviewRequired: Boolean(item.grounding?.review_required ?? mask.review_required ?? item.confidence < 0.65),
        sourceStage: 'image_observation',
        geometry: {
          bbox_px: normalizeBbox(mask.bbox || item.bbox || [0, 0, 0, 0]),
          polygon_px: normalizePolygon(mask.polygon || mask.sampled_contour || item.points || bboxPolygon(mask.bbox || item.bbox || [0, 0, 0, 0]))
        },
        provenance: { source_id: item.id, method: item.grounding?.method || mask.method || item.kind }
      }));
    }
  }
  return masks;
}

function edgesFromOpenCv(opencvEdge = null) {
  if (opencvEdge?.kind !== 'opencv_edge_v1') return [];
  return (opencvEdge.candidate_edges || []).map((candidate) => edgeEvidence({
    id: `opencv_edge:${candidate.id}`,
    candidate,
    backend: opencvEdge.backend || 'opencv_edge_v1',
    sourceImage: opencvEdge.source_image,
    sourceStage: 'opencv_edge_v1'
  }));
}

function edgesFromHighContrast(highContrastEdge = null) {
  if (highContrastEdge?.kind !== 'high_contrast_edge_v1') return [];
  return (highContrastEdge.candidate_edges || []).map((candidate) => edgeEvidence({
    id: `high_contrast_edge:${candidate.id}`,
    candidate,
    backend: highContrastEdge.backend || 'high_contrast_edge_v1',
    sourceImage: highContrastEdge.source_image,
    sourceStage: 'high_contrast_edge_v1'
  }));
}

function edgesFromBoundaryGraph(boundaryGraph = null) {
  if (boundaryGraph?.kind !== 'boundary_graph_v1') return [];
  return [...(boundaryGraph.observed_edges || []), ...(boundaryGraph.completed_edges || [])].map((edge) => evidenceBase({
    id: `boundary_graph_edge:${edge.id}`,
    kind: 'edge',
    className: classFromBoundaryType(edge.type),
    sourceImage: boundaryGraph.source_image,
    backend: boundaryGraph.backend || 'boundary_graph_v1',
    confidence: edge.confidence ?? 0.5,
    reviewRequired: edge.state !== 'observed' || edge.inference_level !== 'observed',
    sourceStage: 'boundary_graph_v1',
    accepted: edge.state !== 'conflict',
    geometry: { a: edge.a, b: edge.b },
    residuals: {
      source_pixel_support_ratio: edge.source_pixel_support_ratio ?? 0,
      source_edge_strength: edge.source_edge_strength ?? 0
    },
    provenance: {
      source_id: edge.id,
      method: edge.method,
      inference_level: edge.inference_level || edge.state,
      completion_hypothesis_id: edge.completion_hypothesis_id || null
    },
    riskFlags: edge.risk_flags || []
  }));
}

function edgeEvidence({ id, candidate, backend, sourceImage, sourceStage }) {
  const normalizedClass = EDGE_CLASS_MAP[candidate.class] || 'unknown';
  const accepted = candidate.accepted === true && !['roof_internal_seam', 'unknown'].includes(normalizedClass);
  return evidenceBase({
    id,
    kind: 'edge',
    className: normalizedClass,
    sourceImage,
    backend,
    confidence: candidate.confidence ?? 0.5,
    reviewRequired: !accepted,
    sourceStage,
    accepted,
    geometry: { a: candidate.a, b: candidate.b },
    residuals: {
      source_pixel_support_ratio: candidate.source_pixel_support_ratio ?? 0,
      source_edge_strength: candidate.source_edge_strength ?? 0,
      rejection_reason: candidate.rejection_reason || null,
      site_side: candidate.site_side || null
    },
    provenance: {
      source_id: candidate.id,
      method: sourceStage,
      original_class: candidate.class
    },
    riskFlags: candidate.risk_flags || [],
    originalClass: candidate.class
  });
}

function linesFromLandCover(landCover = null) {
  if (landCover?.kind !== 'bird_eye_land_cover_v1') return [];
  const evidence = landCover.line_evidence || {};
  const lines = Array.isArray(evidence)
    ? evidence
    : [
        ...(evidence.parking_marking_segments || []).map((line) => ({ ...line, class: line.class || 'parking_marking' })),
        ...(evidence.road_marking_segments || []).map((line) => ({ ...line, class: line.class || 'road_marking' })),
        ...(landCover.boundary_evidence?.line_segments || []).map((line) => ({ ...line, class: line.class || 'paved_green_boundary' }))
      ];

  return lines.map((line, index) => evidenceBase({
    id: `land_cover_line:${line.id || index}`,
    kind: 'line',
    className: line.class || line.type || 'unknown',
    sourceImage: landCover.source_image,
    backend: landCover.backend || 'land_cover_v1',
    confidence: line.confidence ?? landCover.boundary_evidence?.boundary_confidence ?? 0.5,
    reviewRequired: Boolean(line.review_required ?? (line.confidence ?? 0.5) < 0.65),
    sourceStage: 'land_cover_v1',
    geometry: { a: line.a || line.points?.[0] || [line.x1 || 0, line.y1 || 0], b: line.b || line.points?.[1] || [line.x2 || 0, line.y2 || 0] },
    provenance: { source_id: line.id || `land_cover_line_${index}`, method: line.method || evidence.method || 'line_evidence' }
  }));
}

function linesFromImageObservations(images = []) {
  const lines = [];
  for (const image of images) {
    for (const item of image.observations || []) {
      if (item.kind !== 'line_segment') continue;
      const points = item.points || item.contour?.polygon || [];
      lines.push(evidenceBase({
        id: `image_line:${item.id}`,
        kind: 'line',
        className: classFromObservation(item),
        sourceImage: image.image?.path || null,
        backend: item.grounding?.method || 'image_line_segment',
        confidence: item.confidence ?? 0.5,
        reviewRequired: Boolean(item.grounding?.review_required ?? item.confidence < 0.65),
        sourceStage: 'image_observation',
        geometry: {
          a: points[0] || pointFromBbox(item.bbox, 0),
          b: points[1] || pointFromBbox(item.bbox, 1)
        },
        provenance: { source_id: item.id, method: item.grounding?.method || item.kind }
      }));
    }
  }
  return lines;
}

function keypointsFromImageObservations(images = []) {
  const keypoints = [];
  for (const image of images) {
    for (const item of image.observations || []) {
      for (const keypoint of item.keypoints || []) {
        keypoints.push(evidenceBase({
          id: `image_keypoint:${item.id}:${keypoint.id || keypoints.length + 1}`,
          kind: 'keypoint',
          className: keypoint.role || item.component_hint || 'unknown',
          sourceImage: image.image?.path || null,
          backend: item.grounding?.method || 'image_keypoint',
          confidence: keypoint.confidence ?? item.confidence ?? 0.5,
          reviewRequired: Boolean(keypoint.review_required ?? item.grounding?.review_required ?? item.confidence < 0.65),
          sourceStage: 'image_observation',
          geometry: { point: keypoint.point || keypoint.xy || [0, 0] },
          provenance: { source_id: item.id, method: item.grounding?.method || 'keypoint' }
        }));
      }
    }
  }
  return keypoints;
}

function regionsFromLandCover(landCover = null) {
  if (landCover?.kind !== 'bird_eye_land_cover_v1') return [];
  return (landCover.tiles || []).slice(0, 900).map((tile) => evidenceBase({
    id: `land_cover_region:${tile.id}`,
    kind: 'region',
    className: normalizeLandCoverClass(tile.class),
    sourceImage: landCover.source_image,
    backend: landCover.backend || 'land_cover_v1',
    confidence: tile.confidence ?? confidenceForLandCover(tile.class),
    reviewRequired: Boolean(tile.review_required || ['unknown', 'shadow_or_dark_unknown'].includes(tile.class)),
    sourceStage: 'land_cover_v1',
    geometry: { bbox_px: normalizeBbox(tile.bbox_px || tile.bbox || [0, 0, 0, 0]) },
    provenance: { source_id: tile.id, method: 'land_cover_tile' }
  }));
}

function regionsFromImageObservations(images = []) {
  const regions = [];
  for (const image of images) {
    for (const item of image.observations || []) {
      if (!item.bbox) continue;
      regions.push(evidenceBase({
        id: `image_region:${item.id}`,
        kind: 'region',
        className: classFromObservation(item),
        sourceImage: image.image?.path || null,
        backend: item.grounding?.method || item.kind,
        confidence: item.confidence ?? 0.5,
        reviewRequired: Boolean(item.grounding?.review_required ?? item.confidence < 0.65),
        sourceStage: 'image_observation',
        geometry: {
          bbox_px: normalizeBbox(item.bbox),
          ...(item.points ? { polygon_px: normalizePolygon(item.points) } : {}),
          ...(item.grounding?.image_space_geometry ? { image_space_geometry: item.grounding.image_space_geometry } : {}),
          ...(item.grounding?.polygon_derivation ? { polygon_derivation: item.grounding.polygon_derivation } : {}),
          ...(item.grounding?.projection_model ? { projection_model: item.grounding.projection_model } : {}),
          ...(item.grounding?.perspective_strength ? { perspective_strength: item.grounding.perspective_strength } : {}),
          ...(item.grounding?.orthographic_projection_allowed !== undefined ? { orthographic_projection_allowed: item.grounding.orthographic_projection_allowed === true } : {})
        },
        provenance: {
          source_id: item.id,
          method: item.grounding?.method || item.kind,
          semantic_evidence_id: item.grounding?.semantic_evidence_id || null,
          semantic_source: item.grounding?.semantic_source || null,
          semantic_source_priority: item.grounding?.semantic_source_priority ?? null,
          projection_model: item.grounding?.projection_model || '',
          perspective_strength: item.grounding?.perspective_strength || '',
          image_space_geometry: item.grounding?.image_space_geometry || '',
          polygon_derivation: item.grounding?.polygon_derivation || '',
          orthographic_projection_allowed: item.grounding?.orthographic_projection_allowed === true,
          blocked_interpretations: item.grounding?.blocked_interpretations || []
        }
      }));
    }
  }
  return regions;
}

function scaleAnchorsFromObservations(observations = {}) {
  const anchors = [];
  for (const image of observations.images || []) {
    for (const item of image.observations || []) {
      if (item.kind !== 'scale_anchor') continue;
      anchors.push(evidenceBase({
        id: `image_scale_anchor:${item.id}`,
        kind: 'scale_anchor',
        className: item.component_hint || 'scale_anchor',
        sourceImage: image.image?.path || null,
        backend: item.grounding?.method || 'image_scale_anchor',
        confidence: item.confidence ?? 0.5,
        reviewRequired: Boolean(item.grounding?.review_required ?? true),
        sourceStage: 'image_observation',
        geometry: { bbox_px: normalizeBbox(item.bbox || [0, 0, 0, 0]) },
        provenance: { source_id: item.id, method: item.grounding?.method || item.kind }
      }));
    }
  }
  for (const candidate of observations.grounding_v3?.scale_anchor_graph?.candidates || []) {
    anchors.push(evidenceBase({
      id: `grounding_v3_scale_anchor:${candidate.id}`,
      kind: 'scale_anchor',
      className: candidate.family || candidate.type || 'scale_anchor',
      sourceImage: candidate.source_image || observations.grounding_v3?.source_image || null,
      backend: 'grounding_v3_scale_anchor_graph',
      confidence: candidate.confidence ?? 0.5,
      reviewRequired: Boolean(candidate.review_required ?? observations.grounding_v3?.scale_anchor_graph?.review_required ?? true),
      sourceStage: 'grounding_v3',
      geometry: { bbox_px: normalizeBbox(candidate.bbox_px || candidate.image_bbox || [0, 0, 0, 0]) },
      residuals: {
        scale_residual: candidate.residual ?? candidate.scale_residual ?? null,
        family: candidate.family || null
      },
      provenance: { source_id: candidate.id, method: 'scale_anchor_graph' }
    }));
  }
  return anchors;
}

function relationsFromVisualGraph(visualRelationGraph = null) {
  if (!visualRelationGraph?.relations) return [];
  return visualRelationGraph.relations.map((relation) => ({
    id: `visual_relation:${relation.id || `${relation.type}:${relation.item}:${relation.anchor}`}`,
    kind: 'relation',
    relation_type: relation.type,
    item: relation.item,
    anchor: relation.anchor,
    source_image: relation.source_image,
    backend: 'visual_relation_graph_v1',
    confidence: round(relation.confidence ?? 0.5),
    review_required: Boolean(relation.review_required),
    basis: relation.basis || null,
    provenance: { source_stage: 'visual_relation_graph', source_id: relation.id || null }
  }));
}

function estimateViewGroundPlane({
  observations = {},
  edges = [],
  masks = [],
  regions = [],
  scaleAnchors = []
} = {}) {
  const images = (observations.images || []).map((image) => {
    const sourceImage = image.image?.path || null;
    const kind = image.detected_view?.kind || 'unknown';
    const confidence = image.detected_view?.confidence ?? 0.5;
    const topLike = kind === 'top';
    const oblique = kind === 'oblique';
    const siteEdges = edges.filter((edge) => edge.class === 'site_perimeter' && edge.source_image === sourceImage && edge.accepted !== false);
    const roadEdges = edges.filter((edge) => edge.class === 'road_boundary' && edge.source_image === sourceImage && edge.accepted !== false);
    const acceptedBoundaryEdges = [...siteEdges, ...roadEdges];
    const imageMasks = masks.filter((mask) => mask.source_image === sourceImage);
    const imageRegions = regions.filter((region) => region.source_image === sourceImage);
    const imageScaleAnchors = scaleAnchors.filter((anchor) => anchor.source_image === sourceImage);
    const dominant = dominantDirectionsForEdges([...siteEdges, ...roadEdges]);
    const boundarySupport = Math.min(1, acceptedBoundaryEdges.length / 8);
    const orthogonalDirectionSupport = Math.min(1, dominant.length / 2);
    const scaleAnchorSupport = Math.min(1, imageScaleAnchors.length / 2);
    const cameraHintSupport = cameraHintSupportFor(image.camera_hints, kind);
    const groundPlaneConfidence = topLike
      ? round(Math.min(0.96, 0.48 + confidence * 0.2 + boundarySupport * 0.18 + orthogonalDirectionSupport * 0.06 + scaleAnchorSupport * 0.02 + cameraHintSupport * 0.02))
      : oblique ? round(Math.min(0.62, 0.22 + confidence * 0.14 + boundarySupport * 0.1 + orthogonalDirectionSupport * 0.04 + cameraHintSupport * 0.03)) : round(Math.min(0.45, 0.16 + confidence * 0.12 + boundarySupport * 0.06));
    const planarAllowed = topLike && groundPlaneConfidence >= 0.68;
    const risks = groundPlaneRisks({
      topLike,
      oblique,
      boundarySupport,
      dominant,
      scaleAnchorSupport,
      cameraHints: image.camera_hints
    });
    return {
      source_image: sourceImage,
      detected_view: kind,
      view_class: topLike ? 'top_or_near_orthographic' : oblique ? 'oblique_or_axometric_review' : 'non_planar_or_unknown_review',
      dominant_directions: dominant,
      rectification_hint: topLike && dominant.length >= 2 ? 'axis_aligned_planar_rectification_candidate' : oblique ? 'requires_ground_plane_estimate_before_planar_subdivision' : 'not_enough_view_evidence',
      vanishing_or_parallel_line_evidence: dominant.length,
      evidence_summary: {
        source_view_confidence: round(confidence),
        site_edges: siteEdges.length,
        road_edges: roadEdges.length,
        accepted_boundary_edges: acceptedBoundaryEdges.length,
        boundary_support: round(boundarySupport),
        dominant_direction_count: dominant.length,
        scale_anchor_count: imageScaleAnchors.length,
        building_footprint_masks: imageMasks.filter((mask) => mask.class === 'building_footprint').length,
        road_surface_regions: imageRegions.filter((region) => ['road_surface_candidate', 'parking_surface_candidate', 'paved_surface'].includes(region.class)).length,
        camera_hint_projection_model: image.camera_hints?.projection_model || null,
        camera_hint_review_required: image.camera_hints?.review_required === true
      },
      confidence_components: {
        view_label: round(confidence),
        boundary_support: round(boundarySupport),
        orthogonal_direction_support: round(orthogonalDirectionSupport),
        scale_anchor_support: round(scaleAnchorSupport),
        camera_hint_support: round(cameraHintSupport)
      },
      ground_plane_confidence: groundPlaneConfidence,
      confidence_band: confidenceBand(groundPlaneConfidence),
      planar_groundplan_allowed: planarAllowed,
      review_required: !planarAllowed,
      usage_policy: planarAllowed ? 'planar_groundplan_candidate' : oblique ? 'review_only_oblique_context' : 'blocked_unknown_view',
      risks,
      downgrade_reason: planarAllowed ? null : downgradeReasonForGroundPlane({ topLike, oblique, boundarySupport, dominant })
    };
  });
  const topCandidates = images.filter((image) => image.detected_view === 'top');
  const bestTop = topCandidates.sort((a, b) => b.ground_plane_confidence - a.ground_plane_confidence)[0] || null;
  const reviewImages = images.filter((image) => image.review_required);
  return {
    kind: 'view_ground_plane_estimate_v1',
    version: 1,
    images,
    summary: {
      preferred_top_view_source_image: bestTop?.source_image || null,
      top_view_ground_plane_confidence: bestTop?.ground_plane_confidence || 0,
      planar_groundplan_allowed: bestTop?.planar_groundplan_allowed === true,
      review_required: reviewImages.length > 0 || !bestTop?.planar_groundplan_allowed,
      images_analyzed: images.length,
      top_view_candidates: topCandidates.length,
      oblique_review_images: images.filter((image) => image.detected_view === 'oblique' && image.review_required).length,
      images_requiring_review: reviewImages.length,
      preferred_top_view_usage_policy: bestTop?.usage_policy || null,
      preferred_top_view_evidence_summary: bestTop?.evidence_summary || null,
      downgrade_reason: bestTop?.planar_groundplan_allowed ? null : 'No top/near-orthographic image has enough lightweight edge support for promoted planar GroundPlan.'
    }
  };
}

function cameraHintSupportFor(cameraHints = {}, viewKind = 'unknown') {
  if (!cameraHints || typeof cameraHints !== 'object') return 0;
  if (viewKind === 'top' && cameraHints.projection_model === 'top_view_affine_bbox_to_site_xy') return 1;
  if (viewKind === 'oblique' && cameraHints.horizon_line) return 0.55;
  if (cameraHints.projection_model) return 0.35;
  return 0;
}

function groundPlaneRisks({ topLike, oblique, boundarySupport, dominant, scaleAnchorSupport, cameraHints } = {}) {
  const risks = [];
  if (!topLike && oblique) risks.push('oblique_view_not_planar_groundplan');
  if (!topLike && !oblique) risks.push('unknown_view_not_planar_groundplan');
  if (topLike && boundarySupport < 0.5) risks.push('weak_boundary_support_for_planar_groundplane');
  if (topLike && dominant.length < 2) risks.push('insufficient_orthogonal_line_support');
  if (topLike && scaleAnchorSupport <= 0) risks.push('no_scale_anchor_for_groundplane');
  if (cameraHints?.review_required) risks.push('camera_hint_review_required');
  return risks;
}

function downgradeReasonForGroundPlane({ topLike, oblique, boundarySupport, dominant } = {}) {
  if (oblique) return 'Oblique imagery is review context and cannot promote a planar GroundPlan without top-view support.';
  if (!topLike) return 'View label is not top/near-orthographic, so planar GroundPlan is blocked.';
  if (boundarySupport < 0.5) return 'Top-view label exists but boundary edge support is below planar GroundPlan threshold.';
  if (dominant.length < 2) return 'Top-view label exists but orthogonal direction evidence is incomplete.';
  return 'view/ground-plane evidence is insufficient for promoted planar GroundPlan';
}

function confidenceBand(value) {
  if (value >= 0.78) return 'high';
  if (value >= 0.55) return 'medium';
  return 'low';
}

function backendStatusesFor(observations = {}, options = {}) {
  const statuses = [
    backendStatus('bird_eye_land_cover_v1', observations.land_cover_v1?.kind === 'bird_eye_land_cover_v1', observations.land_cover_v1?.backend, true),
    backendStatus('high_contrast_edge_v1', observations.high_contrast_edge_v1?.kind === 'high_contrast_edge_v1', observations.high_contrast_edge_v1?.backend, true),
    backendStatus('opencv_edge_v1', observations.opencv_edge_v1?.kind === 'opencv_edge_v1' && observations.opencv_edge_v1?.backend !== 'unavailable', observations.opencv_edge_v1?.backend, false),
    backendStatus('visual_relation_graph_v1', Boolean(observations.visual_relation_graph?.relations), 'deterministic_relation_candidates', true),
    backendStatus('boundary_graph_v1', observations.boundary_graph_v1?.kind === 'boundary_graph_v1', observations.boundary_graph_v1?.backend, true)
  ];
  const compare = observations.segmentation_backend_compare_v1 || observations.segmentation_backend_compare;
  statuses.push({
    backend: 'insid3_optional',
    available: compare?.insid3?.status === 'available',
    required: false,
    status: compare?.insid3?.status || options.insid3Status || 'skipped_unavailable',
    reason: compare?.insid3?.reason || 'optional heavy backend is not part of default R12 pipeline'
  });
  statuses.push({ backend: 'sam_optional', available: false, required: false, status: 'not_configured', reason: 'optional heavy backend is out of default R12 scope' });
  statuses.push({ backend: 'grounded_sam_optional', available: false, required: false, status: 'not_configured', reason: 'optional heavy backend is out of default R12 scope' });
  return statuses;
}

function backendStatus(backend, available, implementation, required) {
  return {
    backend,
    implementation: implementation || null,
    available: Boolean(available),
    required,
    status: available ? 'available' : required ? 'missing_required_lightweight_evidence' : 'skipped_unavailable'
  };
}

function optionalStatus(observations, backend) {
  const compare = observations.segmentation_backend_compare_v1 || observations.segmentation_backend_compare || {};
  if (backend === 'insid3') {
    return {
      status: compare.insid3?.status || 'skipped_unavailable',
      required: false,
      available: compare.insid3?.status === 'available',
      reason: compare.insid3?.reason || 'optional heavy backend is not required by default'
    };
  }
  return {
    status: 'not_configured',
    required: false,
    available: false,
    reason: 'optional heavy backend is out of default R12 scope'
  };
}

function visionEvidenceSetQa({
  masks = [],
  edges = [],
  lines = [],
  keypoints = [],
  regions = [],
  scaleAnchors = [],
  relations = [],
  viewGroundPlane = {},
  backendStatuses = []
} = {}) {
  const collections = { masks, edges, lines, keypoints, regions, scaleAnchors };
  const issues = [];
  for (const [name, items] of Object.entries(collections)) {
    for (const item of items) {
      if (!item.source_image) issues.push(issue('error', `vision_evidence.${name}.missing_source_image`, `${item.id} is missing source_image`));
      if (!item.backend) issues.push(issue('error', `vision_evidence.${name}.missing_backend`, `${item.id} is missing backend`));
      if (!Number.isFinite(item.confidence)) issues.push(issue('error', `vision_evidence.${name}.missing_confidence`, `${item.id} is missing confidence`));
      if (typeof item.review_required !== 'boolean') issues.push(issue('error', `vision_evidence.${name}.missing_review_required`, `${item.id} is missing review_required`));
    }
  }
  const acceptedEdges = edges.filter((edge) => edge.accepted === true).length;
  const rejectedEdges = edges.filter((edge) => edge.accepted === false || edge.review_required).length;
  const roofSeamPromoted = edges.some((edge) => edge.class === 'roof_internal_seam' && edge.accepted === true && edge.review_required === false);
  if (roofSeamPromoted) issues.push(issue('error', 'vision_evidence.roof_seam_promoted', 'roof/internal seam evidence must not be promoted as road/site boundary'));
  if (!backendStatuses.some((status) => status.backend === 'opencv_edge_v1' && status.available)) {
    issues.push(issue('info', 'vision_evidence.opencv_unavailable', 'OpenCV CPU backend is optional but unavailable; JS fallback evidence remains usable.'));
  }
  const defaultHeavyModelRequired = backendStatuses.some((status) => /sam|insid3/i.test(status.backend) && status.required);
  if (defaultHeavyModelRequired) issues.push(issue('error', 'vision_evidence.heavy_model_required_by_default', 'R12 default pipeline must not require SAM/INSID3/Grounded-SAM.'));
  const hard = issues.filter((item) => item.severity === 'error');
  const reviewReasons = [
    ...(!viewGroundPlane?.summary?.planar_groundplan_allowed ? ['view_ground_plane_requires_review'] : []),
    ...(acceptedEdges < 4 ? ['few_accepted_edges'] : [])
  ];
  return {
    ok: hard.length === 0,
    verdict: hard.length ? 'fail' : reviewReasons.length ? 'review' : 'pass',
    review_required: reviewReasons.length > 0 || hard.length > 0,
    masks: masks.length,
    edges: edges.length,
    accepted_edges: acceptedEdges,
    rejected_edges: rejectedEdges,
    lines: lines.length,
    keypoints: keypoints.length,
    regions: regions.length,
    scale_anchors: scaleAnchors.length,
    relations: relations.length,
    default_heavy_model_required: defaultHeavyModelRequired,
    review_reasons: reviewReasons,
    issues
  };
}

function evidenceBase({
  id,
  kind,
  className,
  sourceImage,
  backend,
  confidence,
  reviewRequired,
  sourceStage = null,
  accepted = null,
  geometry = {},
  residuals = {},
  provenance = {},
  riskFlags = [],
  originalClass = null
}) {
  return {
    id,
    kind,
    class: className || 'unknown',
    original_class: originalClass || className || 'unknown',
    source_image: sourceImage || null,
    backend: backend || 'unknown',
    source_stage: sourceStage || backend || 'unknown',
    confidence: round(confidence ?? 0.5),
    review_required: Boolean(reviewRequired),
    accepted,
    ...geometry,
    residuals,
    provenance: {
      ...provenance,
      source_stage: sourceStage || provenance.source_stage || backend || 'unknown'
    },
    risk_flags: riskFlags
  };
}

function classFromObservation(item = {}) {
  if (item.component_hint?.includes('building') || item.component_hint?.includes('warehouse') || item.component_hint?.includes('hall') || item.component_hint?.includes('office')) return 'building_footprint';
  if (item.component_hint?.includes('parking')) return item.kind === 'line_segment' ? 'parking_marking' : 'parking_surface_candidate';
  if (item.component_hint?.includes('road') || item.component_hint?.includes('aisle')) return item.kind === 'line_segment' ? 'road_marking' : 'road_surface_candidate';
  if (item.component_hint?.includes('tree') || item.kind === 'vegetation_region') return 'vegetation';
  if (item.kind === 'scale_anchor') return 'scale_anchor';
  return item.component_hint || item.kind || 'unknown';
}

function normalizeLandCoverClass(className) {
  return LAND_COVER_CLASS_MAP[className] || className || 'unknown';
}

function classFromBoundaryType(type) {
  if (type === 'site_boundary_edge') return 'site_perimeter';
  if (type === 'road_boundary_edge') return 'road_boundary';
  if (type === 'building_exclusion_edge') return 'building_outline';
  if (type === 'paved_green_edge') return 'paved_green_boundary';
  if (type === 'parking_envelope_edge') return 'parking_surface_candidate';
  return 'unknown';
}

function boundaryTypeForVisionEdge(className) {
  if (className === 'building_outline') return 'building_exclusion_edge';
  if (className === 'site_perimeter') return 'site_boundary_edge';
  if (className === 'road_boundary') return 'road_boundary_edge';
  if (className === 'paved_green_boundary') return 'paved_green_edge';
  return 'unknown_boundary_edge';
}

function dominantDirectionsForEdges(edges = []) {
  const horizontal = edges.filter((edge) => isHorizontal(edge)).length;
  const vertical = edges.filter((edge) => isVertical(edge)).length;
  const total = Math.max(1, horizontal + vertical);
  return [
    ...(horizontal ? [{ axis: 'x', angle_degrees: 0, support_edges: horizontal, confidence: round(horizontal / total) }] : []),
    ...(vertical ? [{ axis: 'y', angle_degrees: 90, support_edges: vertical, confidence: round(vertical / total) }] : [])
  ];
}

function isHorizontal(edge) {
  if (!edge.a || !edge.b) return false;
  return Math.abs(edge.a[1] - edge.b[1]) <= Math.abs(edge.a[0] - edge.b[0]) * 0.35;
}

function isVertical(edge) {
  if (!edge.a || !edge.b) return false;
  return Math.abs(edge.a[0] - edge.b[0]) <= Math.abs(edge.a[1] - edge.b[1]) * 0.35;
}

function confidenceForLandCover(className) {
  if (className === 'building_footprint') return 0.78;
  if (className?.startsWith('vegetation')) return 0.68;
  if (className?.includes('candidate')) return 0.58;
  if (className === 'unknown') return 0.25;
  return 0.55;
}

function syntheticGroundPlane(kind) {
  const allowed = kind === 'top_view';
  const sourceImage = `synthetic://${kind}`;
  const evidenceSummary = {
    source_view_confidence: allowed ? 0.9 : 0.72,
    site_edges: allowed ? 2 : 0,
    road_edges: allowed ? 2 : 0,
    accepted_boundary_edges: allowed ? 4 : 0,
    boundary_support: allowed ? 0.5 : 0,
    dominant_direction_count: allowed ? 2 : 0,
    scale_anchor_count: 0,
    building_footprint_masks: 1,
    road_surface_regions: 0,
    camera_hint_projection_model: allowed ? 'synthetic_top_view_affine' : 'synthetic_oblique_review_only',
    camera_hint_review_required: !allowed
  };
  return {
    kind: 'view_ground_plane_estimate_v1',
    version: 1,
    images: [{
      source_image: sourceImage,
      detected_view: kind === 'oblique' ? 'oblique' : 'top',
      view_class: allowed ? 'top_or_near_orthographic' : 'oblique_or_axometric_review',
      dominant_directions: allowed ? [{ axis: 'x', angle_degrees: 0, support_edges: 2, confidence: 0.5 }, { axis: 'y', angle_degrees: 90, support_edges: 2, confidence: 0.5 }] : [],
      rectification_hint: allowed ? 'axis_aligned_planar_rectification_candidate' : 'requires_ground_plane_estimate_before_planar_subdivision',
      vanishing_or_parallel_line_evidence: allowed ? 2 : 0,
      evidence_summary: evidenceSummary,
      confidence_components: {
        view_label: allowed ? 0.9 : 0.72,
        boundary_support: evidenceSummary.boundary_support,
        orthogonal_direction_support: allowed ? 1 : 0,
        scale_anchor_support: 0,
        camera_hint_support: allowed ? 1 : 0.55
      },
      ground_plane_confidence: allowed ? 0.82 : 0.42,
      confidence_band: allowed ? 'high' : 'low',
      planar_groundplan_allowed: allowed,
      review_required: !allowed,
      usage_policy: allowed ? 'planar_groundplan_candidate' : 'review_only_oblique_context',
      risks: allowed ? ['no_scale_anchor_for_groundplane'] : ['oblique_view_not_planar_groundplan', 'camera_hint_review_required'],
      downgrade_reason: allowed ? null : 'synthetic oblique fixture requires review'
    }],
    summary: {
      preferred_top_view_source_image: allowed ? sourceImage : null,
      top_view_ground_plane_confidence: allowed ? 0.82 : 0,
      planar_groundplan_allowed: allowed,
      review_required: !allowed,
      images_analyzed: 1,
      top_view_candidates: allowed ? 1 : 0,
      oblique_review_images: allowed ? 0 : 1,
      images_requiring_review: allowed ? 0 : 1,
      preferred_top_view_usage_policy: allowed ? 'planar_groundplan_candidate' : null,
      preferred_top_view_evidence_summary: allowed ? evidenceSummary : null,
      downgrade_reason: allowed ? null : 'No top/near-orthographic image has enough lightweight edge support for promoted planar GroundPlan.'
    }
  };
}

function correctionTargetsFromQa(qa = {}) {
  return (qa.issues || []).map((item) => ({
    target: item.rule_id,
    action: item.severity === 'error' ? 'fix_vision_evidence_contract' : 'review_vision_evidence',
    reason: item.message
  }));
}

function issue(severity, ruleId, message) {
  return { severity, rule_id: ruleId, message };
}

function normalizeBbox(bbox = [0, 0, 0, 0]) {
  const [x, y, w, h] = bbox.map((value) => Number(value) || 0);
  return [round(x), round(y), round(Math.max(0, w)), round(Math.max(0, h))];
}

function normalizePolygon(points = []) {
  return (points || []).map((point) => [round(point?.[0] || 0), round(point?.[1] || 0)]);
}

function bboxPolygon(bbox = [0, 0, 0, 0]) {
  const [x, y, w, h] = normalizeBbox(bbox);
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
}

function pointFromBbox(bbox = [0, 0, 0, 0], index = 0) {
  const [x, y, w, h] = normalizeBbox(bbox);
  return index === 0 ? [x, y + h / 2] : [x + w, y + h / 2];
}

function round(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
