import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './image-analysis.mjs';
import { isVisiblePlaneRole } from './facade-plane-graph.mjs';

export const BUILDING_SINGLE_SEMANTIC_EVIDENCE_KIND = 'building_single_semantic_evidence_v1';
export const BUILDING_SINGLE_REVIEW_HELPER_KIND = 'building_single_review_helper_output';

export const BUILDING_SINGLE_PLANE_ROLE_ALIASES = {
  front_facade_plane: 'visible_plane_primary',
  recessed_side_facade_plane: 'visible_plane_recessed_left'
};

export const BUILDING_SINGLE_SEMANTIC_ROLES = [
  'visible_plane_primary',
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary',
  'exterior_hvac_units',
  'upper_window_bands',
  'ground_floor_storefront',
  'roof_parapet_and_rail'
];

export const CRITICAL_BUILDING_SINGLE_SEMANTIC_ROLES = [
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary'
];

const ROLE_SET = new Set(BUILDING_SINGLE_SEMANTIC_ROLES);
const SOURCE_PRIORITY = {
  user_annotation: 4,
  vlm_candidate: 3,
  local_cv_proposal: 2,
  profile_prior: 1
};

const ROLE_DEFAULT_REL_BBOX = {
  visible_plane_primary: [0.48, 0.12, 0.31, 0.66],
  visible_plane_recessed_left: [0.25, 0.13, 0.28, 0.68],
  rectangular_utility_ducts: [0.16, 0.08, 0.22, 0.53],
  shadow_or_recess_boundary: [0.24, 0.16, 0.08, 0.52],
  exterior_hvac_units: [0.47, 0.30, 0.31, 0.25],
  upper_window_bands: [0.47, 0.22, 0.32, 0.35],
  ground_floor_storefront: [0.50, 0.58, 0.30, 0.22],
  roof_parapet_and_rail: [0.32, 0.02, 0.43, 0.12]
};

const ROLE_ALLOWED_SEMANTICS = {
  visible_plane_primary: ['visible_primary_facade_plane_evidence', 'draft_visible_plane_candidate'],
  visible_plane_recessed_left: ['visible_recessed_or_return_plane_evidence', 'draft_visible_plane_candidate'],
  rectangular_utility_ducts: ['rectangular_external_duct_candidate', 'square_section_conduit_candidate', 'utility_riser_candidate'],
  shadow_or_recess_boundary: ['lighting_boundary_marker', 'candidate_recess_boundary_after_confirmation'],
  exterior_hvac_units: ['exterior_hvac_unit_candidate', 'mechanical_box_candidate'],
  upper_window_bands: ['upper_window_band_candidate'],
  ground_floor_storefront: ['storefront_or_shutter_candidate'],
  roof_parapet_and_rail: ['roof_parapet_candidate', 'roof_guardrail_candidate']
};

const ROLE_BLOCKED_INTERPRETATIONS = {
  visible_plane_primary: ['assumed_front_facade_plane_without_review', 'merged_recessed_side_facade_without_review', 'texture_only_layout_source'],
  visible_plane_recessed_left: ['merged_with_visible_plane_primary', 'merged_front_facade_plane', 'front_facade_detail_or_texture', 'decorative_shadow_stripe'],
  rectangular_utility_ducts: ['decorative_facade_trim', 'round_pipe_geometry', 'round_pipe_without_evidence', 'window_mullion_or_opening_frame'],
  shadow_or_recess_boundary: ['cut_recess', 'cut_recess_from_shadow_only', 'extruded_wall_from_shadow_only', 'confirmed_depth_edge_without_alternate_evidence'],
  exterior_hvac_units: ['window_opening', 'signage_or_logo', 'facade_texture'],
  upper_window_bands: ['individual_window_geometry_without_review', 'facade_trim_only'],
  ground_floor_storefront: ['confirmed_opening_depth_without_review', 'full_structural_void_without_review'],
  roof_parapet_and_rail: ['roof_height_measurement_without_scale', 'structural_roof_geometry_without_review']
};

const ROLE_REVIEW_NOTES = {
  visible_plane_primary: 'Primary visible facade plane evidence; review before naming it as a buildable front facade plane.',
  visible_plane_recessed_left: 'Recessed/side/return visible plane evidence; do not paste this into the primary visible plane layout.',
  rectangular_utility_ducts: 'Rectangular external duct or utility riser candidate; do not convert to round pipe or trim.',
  shadow_or_recess_boundary: 'Shadow/recess ambiguity marker; do not cut geometry from shadow alone.',
  exterior_hvac_units: 'Exterior HVAC/mechanical box candidate; item-level modeling requires review.',
  upper_window_bands: 'Upper window-band candidate; individual openings require review.',
  ground_floor_storefront: 'Ground-floor storefront or shutter candidate; opening depth requires review.',
  roof_parapet_and_rail: 'Roof parapet/rail candidate; height and shape require scale and review.'
};

const REVIEW_HELPER_COLORS = {
  visible_plane_primary: '#2f80ed',
  visible_plane_recessed_left: '#f2994a',
  rectangular_utility_ducts: '#27ae60',
  shadow_or_recess_boundary: '#9b51e0',
  exterior_hvac_units: '#56ccf2',
  upper_window_bands: '#f2c94c',
  ground_floor_storefront: '#eb5757',
  roof_parapet_and_rail: '#6fcf97'
};

const REVIEW_HELPER_LABEL_RAIL_GAP_PX = 24;
const REVIEW_HELPER_LABEL_ROW_PX = 34;
const REVIEW_HELPER_LABEL_TOP_PADDING_PX = 24;

const OBLIQUE_REVIEW_PROJECTION_MODELS = new Set([
  'weak_oblique_affine_review_only',
  'uncalibrated_view_bbox'
]);

const ANNOTATION_FILE_NAMES = [
  'building-single-annotations.md'
];

const VLM_CANDIDATE_FILE_NAMES = [
  'building-single-vlm-candidates.json',
  'building-single-vlm-candidates.fixture.json'
];

export async function annotateObservationSetWithBuildingSingleSemanticEvidenceV1(observationSet, {
  input = null,
  annotationsPath = null,
  vlmCandidatesPath = null
} = {}) {
  if (observationSet?.object?.profile !== 'building_single') return {
    observationSet,
    semanticEvidence: null,
    resolvedInputs: { annotationsPath: null, vlmCandidatesPath: null }
  };

  const resolvedInputs = await resolveBuildingSingleSemanticInputFiles({
    input,
    annotationsPath,
    vlmCandidatesPath
  });
  const annotations = resolvedInputs.annotationsPath
    ? parseBuildingSingleAnnotations(await fs.readFile(resolvedInputs.annotationsPath, 'utf8'), resolvedInputs.annotationsPath)
    : [];
  const vlmCandidates = resolvedInputs.vlmCandidatesPath
    ? await loadBuildingSingleVlmCandidates(resolvedInputs.vlmCandidatesPath)
    : [];

  const semanticEvidence = buildBuildingSingleSemanticEvidenceV1({
    observationSet,
    annotations,
    vlmCandidates,
    annotationSource: resolvedInputs.annotationsPath ? toRepoRelative(resolvedInputs.annotationsPath) : null,
    vlmCandidateSource: resolvedInputs.vlmCandidatesPath ? toRepoRelative(resolvedInputs.vlmCandidatesPath) : null
  });

  const nextObservationSet = attachSelectedSemanticRegionsToObservationSet(observationSet, semanticEvidence);
  nextObservationSet.building_single_semantic_evidence_v1 = semanticEvidence;
  return {
    observationSet: nextObservationSet,
    semanticEvidence,
    resolvedInputs
  };
}

export async function resolveBuildingSingleSemanticInputFiles({
  input = null,
  annotationsPath = null,
  vlmCandidatesPath = null
} = {}) {
  const searchDirs = await semanticSearchDirs(input);
  return {
    annotationsPath: annotationsPath
      ? await requireExistingPath(annotationsPath, 'building-single annotations')
      : await firstExisting(searchDirs, ANNOTATION_FILE_NAMES),
    vlmCandidatesPath: vlmCandidatesPath
      ? await requireExistingPath(vlmCandidatesPath, 'building-single VLM candidates')
      : await firstExisting(searchDirs, VLM_CANDIDATE_FILE_NAMES)
  };
}

export function parseBuildingSingleAnnotations(markdown, sourcePath = 'building-single-annotations.md') {
  const entries = [];
  const lines = String(markdown || '').split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const cleaned = line
      .replace(/^\s*[-*]\s*/u, '')
      .replace(/^\s*\d+\.\s*/u, '')
      .trim();
    if (!cleaned || cleaned.startsWith('#')) continue;
    if (!cleaned.includes('role=')) continue;
    const entry = parseKeyValueAnnotationLine(cleaned);
    if (!entry.role) throw new Error(`Invalid building-single annotation at ${sourcePath}:${index + 1}: missing role`);
    entry.role = normalizeBuildingSingleRole(entry.role);
    if (!ROLE_SET.has(entry.role)) throw new Error(`Invalid building-single annotation role at ${sourcePath}:${index + 1}: ${entry.role}`);
    entries.push({
      ...entry,
      source_line: index + 1,
      source_file: toRepoRelative(sourcePath)
    });
  }
  return entries;
}

export async function loadBuildingSingleVlmCandidates(filePath) {
  const absolutePath = resolveRepoPath(filePath);
  const payload = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  const regions = Array.isArray(payload?.regions) ? payload.regions : [];
  const errors = [];
  if (payload.kind && payload.kind !== 'building_single_vlm_candidates') {
    errors.push(`kind must be building_single_vlm_candidates, got ${payload.kind}`);
  }
  for (const [index, region] of regions.entries()) {
    const normalizedRole = normalizeBuildingSingleRole(region.role);
    if (!ROLE_SET.has(normalizedRole)) errors.push(`regions[${index}].role is invalid: ${region.role}`);
    const bbox = region.bbox_px || region.bbox || region.bbox_rel;
    const polygon = region.polygon_px || region.polygon || region.polygon_rel;
    if ((!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((value) => !Number.isFinite(Number(value))))
      && (!Array.isArray(polygon) || polygon.length < 3 || polygon.some((point) => !Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(Number(value)))))) {
      errors.push(`regions[${index}].bbox_px/bbox_rel or polygon_px/polygon_rel must contain finite image coordinates`);
    }
    const confidence = Number(region.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      errors.push(`regions[${index}].confidence must be between 0 and 1`);
    }
  }
  if (!regions.length) errors.push('regions must contain at least one candidate');
  if (errors.length) {
    const error = new Error(`Invalid building-single VLM candidates: ${errors.join('; ')}`);
    error.details = errors;
    throw error;
  }
  return regions.map((region, index) => ({
    id: String(region.id || `vlm_candidate_${index + 1}`),
    role: normalizeBuildingSingleRole(region.role),
    source_image: region.source_image || null,
    bbox_px: Array.isArray(region.bbox_px || region.bbox) ? normalizeBbox(region.bbox_px || region.bbox) : null,
    bbox_rel: Array.isArray(region.bbox_rel) ? normalizeBbox(region.bbox_rel) : null,
    polygon_px: Array.isArray(region.polygon_px || region.polygon) ? normalizePolygon(region.polygon_px || region.polygon) : null,
    polygon_rel: Array.isArray(region.polygon_rel) ? normalizePolygon(region.polygon_rel) : null,
    confidence: clamp01(region.confidence),
    legacy_role: BUILDING_SINGLE_PLANE_ROLE_ALIASES[region.role] ? region.role : null,
    what_it_is: String(region.what_it_is || ROLE_REVIEW_NOTES[normalizeBuildingSingleRole(region.role)] || normalizeBuildingSingleRole(region.role)),
    what_it_is_not: String(region.what_it_is_not || ROLE_BLOCKED_INTERPRETATIONS[normalizeBuildingSingleRole(region.role)]?.join(', ') || ''),
    ambiguity: String(region.ambiguity || 'vlm_candidate_requires_schema_review'),
    rough_position: String(region.rough_position || ''),
    blocked_interpretations: uniqueStrings([
      ...(Array.isArray(region.blocked_interpretations) ? region.blocked_interpretations : []),
      ...(ROLE_BLOCKED_INTERPRETATIONS[normalizeBuildingSingleRole(region.role)] || [])
    ]),
    derived_from: [toRepoRelative(absolutePath), region.id || `regions[${index}]`]
  }));
}

export function buildBuildingSingleSemanticEvidenceV1({
  observationSet,
  annotations = [],
  vlmCandidates = [],
  annotationSource = null,
  vlmCandidateSource = null
}) {
  const images = (observationSet.images || []).map((image, imageIndex) => {
    const contentFrame = imageContentFrame(image);
    const sourceImage = image.image?.path || `image_${imageIndex + 1}`;
    const cameraHints = image.camera_hints || {};
    const profileRegions = profilePriorRegionsFromImage(image, contentFrame);
    const vlmRegions = vlmCandidates
      .filter((candidate) => matchesImage(candidate.source_image, sourceImage, observationSet.images?.length || 0))
      .map((candidate, index) => regionFromInput({
        input: candidate,
        source: 'vlm_candidate',
        sourceImage,
        view: image.detected_view?.kind || 'unknown',
        cameraHints,
        contentFrame,
        fallbackIndex: index
      }));
    const annotationRegions = annotations
      .filter((annotation) => matchesImage(annotation.source_image, sourceImage, observationSet.images?.length || 0))
      .map((annotation, index) => regionFromInput({
        input: annotation,
        source: 'user_annotation',
        sourceImage,
        view: image.detected_view?.kind || 'unknown',
        cameraHints,
        contentFrame,
        fallbackIndex: index
      }));
    const allRegions = [
      ...profileRegions,
      ...vlmRegions,
      ...annotationRegions
    ];
    const selectedRegionIds = new Set(selectPreferredRegions(allRegions).map((region) => region.id));
    return {
      source_image: sourceImage,
      view: image.detected_view?.kind || 'unknown',
      projection_model: cameraHints.projection_model || null,
      perspective_strength: cameraHints.perspective_strength || 'unknown',
      camera_hints: cameraHints,
      content_frame_bbox: contentFrame,
      regions: allRegions
        .map((region) => ({
          ...region,
          selected_for_candidate_graph: selectedRegionIds.has(region.id)
        }))
        .sort(regionSort)
    };
  });

  const allRegions = images.flatMap((image) => image.regions);
  const selectedRegions = allRegions.filter((region) => region.selected_for_candidate_graph);
  const roles = uniqueStrings(allRegions.map((region) => region.role)).sort();
  const sources = uniqueStrings(allRegions.map((region) => region.source)).sort();
  return {
    kind: BUILDING_SINGLE_SEMANTIC_EVIDENCE_KIND,
    version: 1,
    profile: 'building_single',
    source_images: observationSet.object?.source_images || images.map((image) => image.source_image),
    annotation_source: annotationSource,
    vlm_cache: {
      status: vlmCandidateSource ? 'loaded_fixture' : 'not_provided',
      source: vlmCandidateSource,
      candidate_count: vlmCandidates.length,
      artifact: null
    },
    images,
    summary: {
      region_count: allRegions.length,
      selected_region_count: selectedRegions.length,
      roles,
      sources,
      critical_roles_present: CRITICAL_BUILDING_SINGLE_SEMANTIC_ROLES.filter((role) => selectedRegions.some((region) => region.role === role)),
      missing_critical_roles: CRITICAL_BUILDING_SINGLE_SEMANTIC_ROLES.filter((role) => !selectedRegions.some((region) => region.role === role)),
      compile_allowed: false,
      geometry_promotion_allowed: false
    },
    review_policy: {
      model_status: 'review_only',
      compile_allowed: false,
      geometry_promotion_allowed: false,
      default_review_required: true,
      notes: [
        'Single-image building evidence is semantic review evidence only.',
        'Do not promote geometry from these regions without accepted human review and sufficient source assets.',
        'Shadows can separate visual regions but cannot directly become cut_recess geometry.'
      ]
    }
  };
}

export function buildBuildingSingleReviewHelperOutput({
  semanticEvidence,
  observationSet = null
} = {}) {
  const images = semanticEvidence?.images || [];
  const operations = [];
  for (const [imageIndex, imageEvidence] of images.entries()) {
    const imageObservation = (observationSet?.images || []).find((image) => image.image?.path === imageEvidence.source_image) || null;
    operations.push({
      id: `image_plane_${imageIndex + 1}`,
      op: 'image_plane',
      source_image: imageEvidence.source_image,
      view: imageEvidence.view,
      bbox_px: imageEvidence.content_frame_bbox,
      width_px: imageObservation?.image?.analysis_width || imageObservation?.image?.width || null,
      height_px: imageObservation?.image?.analysis_height || imageObservation?.image?.height || null
    });
    const selectedRegions = imageEvidence.regions.filter((region) => region.selected_for_candidate_graph);
    for (const [regionIndex, region] of selectedRegions.entries()) {
      const labelLayout = reviewHelperLabelLayout({
        region,
        frame: imageEvidence.content_frame_bbox,
        index: regionIndex
      });
      operations.push({
        id: `overlay_${region.id}`,
        op: 'semantic_region_overlay',
        source_image: imageEvidence.source_image,
        role: region.role,
        bbox_px: region.bbox_px,
        polygon_px: region.polygon_px,
        image_space_geometry: region.image_space_geometry,
        polygon_derivation: region.polygon_derivation,
        projection_model: region.projection_model,
        perspective_strength: region.perspective_strength,
        orthographic_projection_allowed: false,
        color: REVIEW_HELPER_COLORS[region.role] || '#828282',
        opacity: 0.34,
        label: labelForRegion(region),
        review_required: true,
        geometry_promotion_allowed: false,
        blocked_interpretations: region.blocked_interpretations
      });
      operations.push({
        id: `leader_${region.id}`,
        op: 'semantic_leader_line',
        source_image: imageEvidence.source_image,
        role: region.role,
        from_px: labelLayout.from_px,
        to_px: labelLayout.to_px,
        color: REVIEW_HELPER_COLORS[region.role] || '#828282',
        review_required: true,
        geometry_promotion_allowed: false
      });
      operations.push({
        id: `label_${region.id}`,
        op: 'label',
        source_image: imageEvidence.source_image,
        role: region.role,
        anchor_px: labelLayout.anchor_px,
        anchor_role_px: labelLayout.from_px,
        layout: labelLayout.layout,
        rail: labelLayout.rail,
        row_index: regionIndex,
        text: labelForRegion(region),
        color: REVIEW_HELPER_COLORS[region.role] || '#828282'
      });
    }
    for (const relation of reviewRelations(selectedRegions, imageEvidence.source_image)) {
      operations.push(relation);
    }
  }
  return {
    kind: BUILDING_SINGLE_REVIEW_HELPER_KIND,
    version: 1,
    model_status: 'review_only',
    compile_allowed: false,
    geometry_promotion_allowed: false,
    source_observations: 'observations.json',
    source_semantic_evidence: 'building-single-semantic-evidence.json',
    operations,
    qa: {
      no_promoted_geometry: true,
      forbidden_geometry_ops_absent: !operations.some((operation) => ['cut_recess', 'round_pipe_geometry', 'facade_trim'].includes(operation.op)),
      notes: [
        'Review helper contains overlays and labels only.',
        'It must not be fed into formal SketchUp geometry promotion.'
      ]
    }
  };
}

export function renderBuildingSingleSemanticEvidenceMarkdown(semanticEvidence) {
  if (!semanticEvidence) return '# Building Single Semantic Evidence\n\nNo evidence generated.\n';
  const lines = [];
  lines.push('# Building Single Semantic Evidence v1');
  lines.push('');
  lines.push(`- model_status: \`${semanticEvidence.review_policy.model_status}\``);
  lines.push(`- compile_allowed: \`${semanticEvidence.review_policy.compile_allowed}\``);
  lines.push(`- geometry_promotion_allowed: \`${semanticEvidence.review_policy.geometry_promotion_allowed}\``);
  lines.push(`- annotation_source: ${semanticEvidence.annotation_source || 'none'}`);
  lines.push(`- vlm_source: ${semanticEvidence.vlm_cache?.source || 'none'}`);
  lines.push('');
  for (const image of semanticEvidence.images || []) {
    lines.push(`## ${image.source_image}`);
    lines.push('');
    lines.push(`- projection_model: \`${image.projection_model || 'unknown'}\``);
    lines.push(`- perspective_strength: \`${image.perspective_strength || 'unknown'}\``);
    lines.push('');
    lines.push('| role | selected | source | confidence | image_space_geometry | polygon_derivation | bbox_px | blocked_interpretations |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const region of image.regions || []) {
      lines.push(`| ${region.role} | ${region.selected_for_candidate_graph} | ${region.source} | ${round(region.confidence)} | ${region.image_space_geometry || 'bbox_px'} | ${region.polygon_derivation || 'none'} | ${region.bbox_px.join(',')} | ${region.blocked_interpretations.join(', ')} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function attachSelectedSemanticRegionsToObservationSet(observationSet, semanticEvidence) {
  const next = JSON.parse(JSON.stringify(observationSet));
  for (const image of next.images || []) {
    const imageEvidence = (semanticEvidence.images || []).find((item) => item.source_image === image.image?.path);
    if (!imageEvidence) continue;
    const selectedRegions = imageEvidence.regions.filter((region) => region.selected_for_candidate_graph);
    const existingIds = new Set((image.observations || []).map((observation) => observation.id));
    image.observations = image.observations || [];
    for (const region of selectedRegions) {
      const observationId = `bse_v1_${region.role}_${hashString(`${imageEvidence.source_image}:${region.id}`)}`;
      if (existingIds.has(observationId)) continue;
      image.observations.push({
        id: observationId,
        kind: 'component_bbox',
        source_view: image.detected_view?.kind || 'unknown',
        component_hint: region.role,
        bbox: region.bbox_px,
        points: region.polygon_px,
        confidence: region.confidence,
        note: `${ROLE_REVIEW_NOTES[region.role]} source=${region.source}; what_it_is=${region.what_it_is || ''}; what_it_is_not=${region.what_it_is_not || ''}`,
        grounding_status: 'helper_only',
        review_required: true,
        grounding: {
          method: BUILDING_SINGLE_SEMANTIC_EVIDENCE_KIND,
          review_required: true,
          semantic_evidence_id: region.id,
          semantic_source: region.source,
          semantic_source_priority: region.source_priority,
          projection_model: region.projection_model,
          perspective_strength: region.perspective_strength,
          image_space_geometry: region.image_space_geometry,
          polygon_derivation: region.polygon_derivation,
          orthographic_projection_allowed: false,
          blocked_interpretations: region.blocked_interpretations,
          allowed_semantics: ROLE_ALLOWED_SEMANTICS[region.role] || [],
          geometry_promotion_allowed: false,
          promotion_blockers: uniqueStrings([
            'single_view_depth_ambiguity',
            'semantic_evidence_review_required',
            'oblique_perspective_requires_plane_confirmation',
            'geometry_promotion_allowed_false',
            ...(isVisiblePlaneRole(region.role) ? ['accepted_facade_plane_review_required'] : ['plane_local_detail_review_required']),
            ...(region.role === 'shadow_or_recess_boundary' ? ['shadow_cannot_drive_cut_recess'] : []),
            ...(region.role === 'rectangular_utility_ducts' ? ['duct_semantics_review_required'] : [])
          ]),
          derived_from: region.derived_from || []
        }
      });
    }
  }
  return next;
}

function profilePriorRegionsFromImage(image, contentFrame) {
  const regions = [];
  const cameraHints = image.camera_hints || {};
  for (const observation of image.observations || []) {
    const role = normalizeBuildingSingleRole(observation.component_hint);
    if (!ROLE_SET.has(role) || !observation.bbox) continue;
    const source = observation.grounding?.method === 'single_oblique_building_prior' || observation.kind === 'profile_prior'
      ? 'profile_prior'
      : 'local_cv_proposal';
    regions.push(makeRegion({
      id: `${source}_${observation.id}`,
      role,
      bbox: observation.bbox,
      polygon: observation.polygon_px || observation.points || null,
      contentFrame,
      view: image.detected_view?.kind || 'unknown',
      cameraHints,
      confidence: observation.confidence ?? (source === 'profile_prior' ? 0.34 : 0.52),
      source,
      whatItIs: ROLE_REVIEW_NOTES[role],
      whatItIsNot: (ROLE_BLOCKED_INTERPRETATIONS[role] || []).join(', '),
      ambiguity: source === 'profile_prior' ? 'profile_prior_bbox_requires_review' : 'local_cv_bbox_requires_review',
      roughPosition: observation.note || '',
      derivedFrom: [observation.id, observation.grounding?.method || observation.kind]
    }));
  }
  return regions;
}

function regionFromInput({
  input,
  source,
  sourceImage,
  view,
  cameraHints = {},
  contentFrame,
  fallbackIndex
}) {
  const role = normalizeBuildingSingleRole(input.role);
  const polygon = input.polygon_px
    ? input.polygon_px
    : input.polygon_rel
      ? polygonFromRelative(input.polygon_rel, contentFrame)
      : null;
  const bbox = input.bbox_px
    ? input.bbox_px
    : input.bbox_rel
      ? bboxFromRelative(input.bbox_rel, contentFrame)
      : polygon
        ? bboxFromPolygon(polygon)
        : bboxFromRoughPosition({
            role,
            roughPosition: input.rough_position || '',
            contentFrame
          });
  return makeRegion({
    id: `${source}_${role}_${hashString(`${sourceImage}:${view}:${role}:${fallbackIndex}:${JSON.stringify(input)}`)}`,
    role,
    bbox,
    polygon,
    contentFrame,
    view,
    cameraHints,
    confidence: input.confidence ?? (source === 'user_annotation' ? 0.82 : 0.66),
    source,
    whatItIs: input.what_it_is || ROLE_REVIEW_NOTES[role],
    whatItIsNot: input.what_it_is_not || (ROLE_BLOCKED_INTERPRETATIONS[role] || []).join(', '),
    ambiguity: input.ambiguity || `${source}_requires_review`,
    roughPosition: input.rough_position || '',
    blockedInterpretations: input.blocked_interpretations,
    derivedFrom: uniqueStrings([...(input.derived_from || []), input.source_file || '', input.id || ''])
  });
}

function makeRegion({
  id,
  role,
  bbox,
  polygon = null,
  contentFrame,
  view = 'unknown',
  cameraHints = {},
  confidence,
  source,
  whatItIs,
  whatItIsNot,
  ambiguity,
  roughPosition,
  blockedInterpretations = [],
  derivedFrom = []
}) {
  role = normalizeBuildingSingleRole(role);
  const clippedBbox = clipBboxToFrame(normalizeBbox(bbox), contentFrame);
  const projectionModel = cameraHints.projection_model || (view === 'oblique' ? 'weak_oblique_affine_review_only' : 'uncalibrated_view_bbox');
  const polygonResult = resolveRegionPolygon({
    role,
    bbox: clippedBbox,
    polygon,
    frame: contentFrame,
    projectionModel,
    perspectiveStrength: cameraHints.perspective_strength || 'unknown',
    vanishingPoints: cameraHints.vanishing_points || []
  });
  return {
    id,
    role,
    bbox_px: clippedBbox,
    polygon_px: polygonResult.polygon_px,
    image_space_geometry: polygonResult.image_space_geometry,
    polygon_derivation: polygonResult.polygon_derivation,
    polygon_confidence: polygonResult.polygon_confidence,
    projection_model: projectionModel,
    perspective_strength: cameraHints.perspective_strength || 'unknown',
    orthographic_projection_allowed: false,
    perspective_review_required: true,
    confidence: clamp01(confidence),
    source,
    source_priority: SOURCE_PRIORITY[source] || 0,
    review_required: true,
    blocked_interpretations: uniqueStrings([
      ...(blockedInterpretations || []),
      ...(ROLE_BLOCKED_INTERPRETATIONS[role] || [])
    ]),
    allowed_semantics: ROLE_ALLOWED_SEMANTICS[role] || [],
    what_it_is: String(whatItIs || ''),
    what_it_is_not: String(whatItIsNot || ''),
    ambiguity: String(ambiguity || ''),
    rough_position: String(roughPosition || ''),
    geometry_promotion_allowed: false,
    selected_for_candidate_graph: false,
    derived_from: uniqueStrings(derivedFrom.filter(Boolean))
  };
}

export function normalizeBuildingSingleRole(role) {
  const value = String(role || '');
  return BUILDING_SINGLE_PLANE_ROLE_ALIASES[value] || value;
}

function selectPreferredRegions(regions) {
  const byRole = new Map();
  for (const region of regions) {
    const current = byRole.get(region.role);
    if (!current || region.source_priority > current.source_priority
      || (region.source_priority === current.source_priority && region.confidence > current.confidence)) {
      byRole.set(region.role, region);
    }
  }
  return Array.from(byRole.values());
}

function regionSort(a, b) {
  return (b.selected_for_candidate_graph === true) - (a.selected_for_candidate_graph === true)
    || (b.source_priority || 0) - (a.source_priority || 0)
    || rolePriority(a.role) - rolePriority(b.role)
    || String(a.id).localeCompare(String(b.id));
}

function rolePriority(role) {
  const critical = CRITICAL_BUILDING_SINGLE_SEMANTIC_ROLES.indexOf(role);
  if (critical !== -1) return critical;
  const index = BUILDING_SINGLE_SEMANTIC_ROLES.indexOf(role);
  return index === -1 ? 999 : 100 + index;
}

function bboxFromRoughPosition({ role, roughPosition, contentFrame }) {
  const rel = [...(ROLE_DEFAULT_REL_BBOX[role] || [0.2, 0.2, 0.5, 0.5])];
  const text = String(roughPosition || '').toLowerCase();
  if (text.includes('left')) rel[0] = Math.min(rel[0], 0.16);
  if (text.includes('right')) rel[0] = Math.max(rel[0], 0.58);
  if (text.includes('center') || text.includes('middle')) rel[0] = Math.max(0.25, Math.min(0.42, rel[0]));
  if (text.includes('top') || text.includes('roof')) rel[1] = Math.min(rel[1], 0.08);
  if (text.includes('bottom') || text.includes('ground')) rel[1] = Math.max(rel[1], 0.58);
  if (text.includes('vertical')) rel[3] = Math.max(rel[3], 0.45);
  if (text.includes('horizontal') || text.includes('band')) rel[2] = Math.max(rel[2], 0.30);
  return bboxFromRelative(rel, contentFrame);
}

function bboxFromRelative(rel, frame) {
  const [fx, fy, fw, fh] = frame;
  return [
    fx + Number(rel[0] || 0) * fw,
    fy + Number(rel[1] || 0) * fh,
    Number(rel[2] || 0) * fw,
    Number(rel[3] || 0) * fh
  ];
}

function polygonFromRelative(polygonRel, frame) {
  const [fx, fy, fw, fh] = frame;
  return normalizePolygon(polygonRel).map(([x, y]) => [
    round(fx + x * fw),
    round(fy + y * fh)
  ]);
}

function resolveRegionPolygon({
  role,
  bbox,
  polygon,
  frame,
  projectionModel,
  perspectiveStrength,
  vanishingPoints = []
}) {
  if (Array.isArray(polygon) && polygon.length >= 3) {
    return {
      polygon_px: clipPolygonToFrame(normalizePolygon(polygon), frame),
      image_space_geometry: 'polygon_px',
      polygon_derivation: 'explicit_polygon',
      polygon_confidence: 0.82
    };
  }
  const oblique = OBLIQUE_REVIEW_PROJECTION_MODELS.has(projectionModel)
    || perspectiveStrength === 'medium'
    || perspectiveStrength === 'high';
  if (oblique) {
    return {
      polygon_px: weakObliqueQuadFromBbox({ role, bbox, frame, vanishingPoints }),
      image_space_geometry: 'polygon_px',
      polygon_derivation: 'weak_oblique_vp_quad_from_bbox',
      polygon_confidence: 0.42
    };
  }
  return {
    polygon_px: bboxPolygon(bbox),
    image_space_geometry: 'bbox_polygon_fallback',
    polygon_derivation: 'bbox_polygon_no_perspective_hint',
    polygon_confidence: 0.34
  };
}

function weakObliqueQuadFromBbox({ role, bbox, frame, vanishingPoints = [] }) {
  const [x, y, width, height] = normalizeBbox(bbox);
  const vp = chooseHorizontalVanishingPoint({ role, bbox, frame, vanishingPoints });
  const leftTop = [x, y];
  const leftBottom = [x, y + height];
  const rightTop = pointOnLineAtX(leftTop, vp, x + width);
  const rightBottom = pointOnLineAtX(leftBottom, vp, x + width);
  const quad = [
    leftTop,
    rightTop,
    rightBottom,
    leftBottom
  ];
  return clipPolygonToFrame(quad.map((point) => point.map(round)), frame);
}

function chooseHorizontalVanishingPoint({ role, bbox, frame, vanishingPoints = [] }) {
  const [fx, , fw] = normalizeBbox(frame);
  const fallbackY = normalizeBbox(bbox)[1];
  const left = Array.isArray(vanishingPoints[0]) ? vanishingPoints[0] : [fx - fw * 0.6, fallbackY];
  const right = Array.isArray(vanishingPoints[1]) ? vanishingPoints[1] : [fx + fw * 1.6, fallbackY];
  if (role === 'visible_plane_recessed_left' || role === 'rectangular_utility_ducts' || role === 'shadow_or_recess_boundary') return right;
  return right;
}

function pointOnLineAtX(point, vanishingPoint, x) {
  const [x1, y1] = point;
  const [x2, y2] = vanishingPoint;
  const denominator = x2 - x1;
  if (Math.abs(denominator) < 1e-6) return [x, y1];
  const t = (x - x1) / denominator;
  return [x, y1 + (y2 - y1) * t];
}

function bboxPolygon(bbox) {
  const [x, y, width, height] = normalizeBbox(bbox);
  return [
    [round(x), round(y)],
    [round(x + width), round(y)],
    [round(x + width), round(y + height)],
    [round(x), round(y + height)]
  ];
}

function bboxFromPolygon(polygon) {
  const normalized = normalizePolygon(polygon);
  const xs = normalized.map((point) => point[0]);
  const ys = normalized.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return [round(minX), round(minY), round(maxX - minX), round(maxY - minY)];
}

function imageContentFrame(image) {
  return normalizeBbox(
    image.image?.content_frame?.bbox
      || image.metrics?.content_frame_bbox
      || [0, 0, image.image?.analysis_width || image.image?.width || 0, image.image?.analysis_height || image.image?.height || 0]
  );
}

function reviewRelations(regions, sourceImage) {
  const byRole = new Map(regions.map((region) => [region.role, region]));
  const pairs = [
    ['visible_plane_recessed_left', 'visible_plane_primary', 'separate_plane_from'],
    ['rectangular_utility_ducts', 'visible_plane_recessed_left', 'attached_to_or_near'],
    ['shadow_or_recess_boundary', 'visible_plane_recessed_left', 'ambiguous_boundary_for']
  ];
  return pairs
    .filter(([a, b]) => byRole.has(a) && byRole.has(b))
    .map(([a, b, relation]) => ({
      id: `relation_${a}_${relation}_${b}`,
      op: 'semantic_relation_line',
      source_image: sourceImage,
      relation,
      from_role: a,
      to_role: b,
      from_px: regionCenter(byRole.get(a)),
      to_px: regionCenter(byRole.get(b)),
      review_required: true
    }));
}

function labelForRegion(region) {
  return `${region.role} (${region.source})`;
}

function reviewHelperLabelLayout({ region, frame, index }) {
  const [fx, fy, fw] = normalizeBbox(frame);
  const anchorX = round(fx + fw + REVIEW_HELPER_LABEL_RAIL_GAP_PX);
  const anchorY = round(fy + REVIEW_HELPER_LABEL_TOP_PADDING_PX + index * REVIEW_HELPER_LABEL_ROW_PX);
  return {
    layout: 'external_right_rail',
    rail: 'right',
    anchor_px: [anchorX, anchorY],
    from_px: regionCenter(region),
    to_px: [round(anchorX - 8), anchorY]
  };
}

function regionCenter(region) {
  return polygonCenter(region.polygon_px) || bboxCenter(region.bbox_px);
}

function polygonCenter(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  return [
    round(polygon.reduce((sum, point) => sum + Number(point[0] || 0), 0) / polygon.length),
    round(polygon.reduce((sum, point) => sum + Number(point[1] || 0), 0) / polygon.length)
  ];
}

function bboxCenter(bbox) {
  return [round(bbox[0] + bbox[2] / 2), round(bbox[1] + bbox[3] / 2)];
}

function parseKeyValueAnnotationLine(line) {
  const entry = {};
  const parts = line.split(';');
  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) continue;
    if (key === 'bbox_px' || key === 'bbox' || key === 'bbox_rel') {
      entry[key === 'bbox_rel' ? 'bbox_rel' : 'bbox_px'] = parseBboxValue(value);
    } else if (key === 'polygon_px' || key === 'polygon' || key === 'polygon_rel') {
      entry[key === 'polygon_rel' ? 'polygon_rel' : 'polygon_px'] = parsePolygonValue(value);
    } else if (key === 'confidence') {
      entry.confidence = clamp01(value);
    } else {
      entry[key] = value;
    }
  }
  return entry;
}

function parseBboxValue(value) {
  const parsed = String(value)
    .replace(/[[\]()]/gu, '')
    .split(/[, ]+/u)
    .filter(Boolean)
    .map(Number);
  if (parsed.length !== 4 || parsed.some((number) => !Number.isFinite(number))) {
    throw new Error(`Invalid bbox value: ${value}`);
  }
  return normalizeBbox(parsed);
}

function parsePolygonValue(value) {
  const parsed = String(value)
    .replace(/[()[\]]/gu, '')
    .split(/;/u)
    .map((point) => point.trim())
    .filter(Boolean)
    .map((point) => point.split(/[, ]+/u).filter(Boolean).map(Number));
  if (parsed.length < 3 || parsed.some((point) => point.length !== 2 || point.some((number) => !Number.isFinite(number)))) {
    throw new Error(`Invalid polygon value: ${value}`);
  }
  return normalizePolygon(parsed);
}

async function semanticSearchDirs(input) {
  if (!input) return [];
  const absoluteInput = resolveRepoPath(input);
  try {
    const stat = await fs.stat(absoluteInput);
    if (stat.isDirectory()) return [absoluteInput];
    return [path.dirname(absoluteInput)];
  } catch {
    return [path.dirname(absoluteInput)];
  }
}

async function firstExisting(dirs, fileNames) {
  for (const dir of dirs) {
    for (const fileName of fileNames) {
      const candidate = path.join(dir, fileName);
      if (await pathExists(candidate)) return candidate;
    }
  }
  return null;
}

async function requireExistingPath(value, label) {
  const absolute = resolveRepoPath(value);
  if (!await pathExists(absolute)) throw new Error(`${label} not found: ${value}`);
  return absolute;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function matchesImage(candidateImage, sourceImage, imageCount) {
  if (!candidateImage) return imageCount <= 1;
  const candidate = String(candidateImage);
  return candidate === sourceImage
    || toRepoRelative(candidate) === toRepoRelative(sourceImage)
    || path.basename(candidate) === path.basename(sourceImage);
}

function resolveRepoPath(value) {
  return path.resolve(repoRoot, value);
}

function toRepoRelative(value) {
  if (!value) return '';
  return path.relative(repoRoot, path.resolve(repoRoot, value)) || '.';
}

function clipBboxToFrame(bbox, frame) {
  const [fx, fy, fw, fh] = normalizeBbox(frame);
  const [x, y, width, height] = normalizeBbox(bbox);
  const minX = Math.max(fx, x);
  const minY = Math.max(fy, y);
  const maxX = Math.min(fx + fw, x + width);
  const maxY = Math.min(fy + fh, y + height);
  return [
    round(minX),
    round(minY),
    round(Math.max(1, maxX - minX)),
    round(Math.max(1, maxY - minY))
  ];
}

function clipPolygonToFrame(polygon, frame) {
  const [fx, fy, fw, fh] = normalizeBbox(frame);
  return normalizePolygon(polygon).map(([x, y]) => [
    round(Math.max(fx, Math.min(fx + fw, x))),
    round(Math.max(fy, Math.min(fy + fh, y)))
  ]);
}

function normalizePolygon(value) {
  return (Array.isArray(value) ? value : [])
    .map((point) => Array.isArray(point) ? point.slice(0, 2).map((item) => Number(item || 0)) : [0, 0])
    .filter((point) => point.length === 2 && point.every((number) => Number.isFinite(number)))
    .map((point) => point.map(round));
}

function normalizeBbox(value) {
  const numbers = Array.isArray(value) ? value.slice(0, 4).map((item) => Number(item || 0)) : [0, 0, 0, 0];
  while (numbers.length < 4) numbers.push(0);
  return numbers.map(round);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim())));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 8);
}
