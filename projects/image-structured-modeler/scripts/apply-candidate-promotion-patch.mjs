#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';

export function applyCandidatePromotionPatch({
  patch,
  candidateGraph,
  observationSet,
  profile,
  basePartGraph = null,
  id = null,
  productName = null
} = {}) {
  if (!patch) throw new Error('patch is required');
  if (!candidateGraph) throw new Error('candidateGraph is required');
  if (!observationSet) throw new Error('observationSet is required');
  if (!profile) throw new Error('profile is required');
  if (patch.apply_allowed !== true || patch.status !== 'ready_for_part_graph_patch') {
    throw new Error(`Candidate promotion patch is not applyable: status=${patch.status}, apply_allowed=${patch.apply_allowed}`);
  }
  if (!geometryStrategiesMatch({ patch, candidateGraph })) {
    throw new Error('Candidate promotion patch is not applyable: geometry strategy does not match the candidate graph');
  }
  if (requiresMultiViewGeometryFusionReview({ patch, candidateGraph })) {
    throw new Error('Candidate promotion patch is not applyable: accepted multi-view relative pose or homography review is required before geometry fusion');
  }
  if (requiresCalibratedLineage({ patch, candidateGraph }) && !hasAcceptedCalibratedLineage({ patch, candidateGraph })) {
    throw new Error('Candidate promotion patch is not applyable: accepted perspective calibration and corner-chain topology lineage are required before PartGraph promotion');
  }
  if (requiresDraftingFirstReview({ patch, candidateGraph, observationSet }) && !hasAcceptedDraftingFirstReview(patch)) {
    throw new Error('Candidate promotion patch is not applyable: accepted DraftViewGraph and local detail review are required before PartGraph promotion');
  }
  if (requiresFacadePlaneReview({ patch, candidateGraph, profile }) && !hasAcceptedFacadePlaneReview(patch)) {
    throw new Error('Candidate promotion patch is not applyable: accepted facade plane review is required before building_single PartGraph promotion');
  }
  if (requiresCalibratedLineage({ patch, candidateGraph }) && !hasAcceptedCalibratedPlaneBindings({ patch, candidateGraph })) {
    throw new Error('Candidate promotion patch is not applyable: every calibrated visible-plane action must bind to an accepted facade plane id');
  }
  if (requiresCalibratedLineage({ patch, candidateGraph }) && !hasAcceptedCalibratedDetailBindings({ patch, candidateGraph })) {
    throw new Error('Candidate promotion patch is not applyable: every calibrated local-detail action must bind its accepted detail id to an accepted facade plane id');
  }

  const next = basePartGraph ? cloneJson(basePartGraph) : makePartGraphShell({
    patch,
    observationSet,
    profile,
    id,
    productName
  });
  const candidateById = new Map((candidateGraph.candidates || []).map((candidate) => [candidate.id, candidate]));
  const observationIndex = buildObservationIndex(observationSet);
  const applied = [];

  for (const action of patch.actions || []) {
    if (action.action !== 'promote_candidate') continue;
    const candidate = candidateById.get(action.candidate_id);
    if (!candidate) throw new Error(`Candidate ${action.candidate_id} not found in candidate graph`);
    const observation = observationIndex.get(`${candidate.source_image}|${candidate.source_observation_id}`);
    const image = observationIndex.get(`image|${candidate.source_image}`);
    const part = partFromCandidate({ action, candidate, observation, image, profile });
    upsertPart(next, part);
    applied.push(action);
  }

  next.review = {
    ...(next.review || {}),
    candidate_promotion_patches_applied: [
      ...(next.review?.candidate_promotion_patches_applied || []),
      {
        source_review: patch.source_review,
        actions: applied.length,
        apply_allowed: patch.apply_allowed,
        status: patch.status,
        geometry_strategy: patch.geometry_strategy || candidateGraph.geometry_strategy || null,
        source_perspective_calibration_review_result: patch.calibration_review?.source_perspective_calibration_review_result || null,
        source_corner_chain_topology_review: patch.topology_review?.source_corner_chain_topology_review || null
      }
    ]
  };
  next.evidence_graph = next.evidence_graph || evidenceGraphShell(observationSet, patch);
  next.evidence_graph.parts = [
    ...(next.evidence_graph.parts || []).filter((part) => !applied.some((action) => action.candidate_id === part.part_id)),
    ...applied.map((action) => evidenceGraphPartForAction(action))
  ];
  return { partGraph: next, applied };
}

function isBuildingSinglePromotion({ patch, candidateGraph, profile }) {
  return patch?.profile_id === 'building_single'
    || candidateGraph?.profile_id === 'building_single'
    || profile?.profile_id === 'building_single'
    || profile?.product_type === 'building_single';
}

function geometryStrategiesMatch({ patch, candidateGraph }) {
  if (!patch?.geometry_strategy || !candidateGraph?.geometry_strategy) return true;
  return patch.geometry_strategy === candidateGraph.geometry_strategy;
}

function requiresCalibratedLineage({ patch, candidateGraph }) {
  return (candidateGraph?.geometry_strategy || patch?.geometry_strategy) === 'calibrated_manhattan_planes';
}

function requiresMultiViewGeometryFusionReview({ patch, candidateGraph }) {
  return (candidateGraph?.geometry_strategy || patch?.geometry_strategy) === 'multi_view_calibration_pose_graph';
}

function hasAcceptedCalibratedLineage({ patch, candidateGraph }) {
  const expected = candidateGraph?.calibration_lineage;
  const embedded = patch?.calibration_lineage;
  const calibration = patch?.calibration_review;
  const topology = patch?.topology_review;
  if (!expected || !embedded || !calibration || !topology) return false;
  const lineageMatches = (
    embedded.source_perspective_calibration_review_result === expected.source_perspective_calibration_review_result
    && embedded.source_corner_chain_topology_review === expected.source_corner_chain_topology_review
    && sameStringSet(embedded.accepted_axis_family_ids, expected.accepted_axis_family_ids)
    && sameStringSet(embedded.accepted_topology_ids, expected.accepted_topology_ids)
  );
  const calibrationAccepted = (
    calibration.status === 'accepted_for_rectification'
    && calibration.rectification_allowed === true
    && calibration.promotion_allowed === false
    && calibration.source_perspective_calibration_review_result === expected.source_perspective_calibration_review_result
    && sameStringSet(calibration.accepted_axis_family_ids, expected.accepted_axis_family_ids)
    && calibration.accepted_axis_family_ids.length >= 3
  );
  const topologyAccepted = (
    topology.status === 'accepted_for_derived_drafting'
    && topology.derived_drafting_allowed === true
    && topology.promotion_allowed === false
    && topology.source_corner_chain_topology_review === expected.source_corner_chain_topology_review
    && sameStringSet(topology.accepted_topology_ids, expected.accepted_topology_ids)
    && topology.accepted_topology_ids.length > 0
  );
  return lineageMatches && calibrationAccepted && topologyAccepted;
}

function hasAcceptedCalibratedPlaneBindings({ patch, candidateGraph }) {
  const acceptedPlaneIds = new Set(patch?.plane_review?.accepted_plane_ids || []);
  const candidateById = new Map((candidateGraph?.candidates || []).map((candidate) => [candidate.id, candidate]));
  return (patch?.actions || []).every((action) => {
    const candidate = candidateById.get(action.candidate_id);
    const role = action.role || candidate?.role || '';
    if (!role.startsWith('visible_plane_')) return true;
    const expectedPlaneId = candidate?.source_plane_id || candidate?.id;
    return Boolean(action.accepted_plane_id)
      && action.accepted_plane_id === expectedPlaneId
      && acceptedPlaneIds.has(action.accepted_plane_id);
  });
}

function hasAcceptedCalibratedDetailBindings({ patch, candidateGraph }) {
  const acceptedPlaneIds = new Set(patch?.plane_review?.accepted_plane_ids || []);
  const acceptedDetailIds = new Set(patch?.local_detail_review?.accepted_detail_ids || []);
  const candidateById = new Map((candidateGraph?.candidates || []).map((candidate) => [candidate.id, candidate]));
  return (patch?.actions || []).every((action) => {
    const candidate = candidateById.get(action.candidate_id);
    const role = action.role || candidate?.role || '';
    if (role.startsWith('visible_plane_')) return true;
    const expectedPlaneId = candidate?.source_plane_id || '';
    return Boolean(action.accepted_detail_id)
      && action.accepted_detail_id === candidate?.id
      && acceptedDetailIds.has(action.accepted_detail_id)
      && Boolean(action.accepted_plane_id)
      && action.accepted_plane_id === expectedPlaneId
      && acceptedPlaneIds.has(action.accepted_plane_id);
  });
}

function requiresDraftingFirstReview({ patch, candidateGraph, observationSet }) {
  const draftGraph = observationSet?.draft_view_graph_v1;
  const draftGraphSlotCount = Number(draftGraph?.summary?.observed_slots || 0)
    + Number(draftGraph?.summary?.inferred_slots || 0)
    + Number(draftGraph?.summary?.partial_slots || 0);
  return Boolean(patch?.draft_view_review)
    || Boolean(patch?.local_detail_review)
    || draftGraphSlotCount > 0
    || (candidateGraph?.candidates || []).some((candidate) => candidate.promotion?.blockers?.includes('accepted_draft_view_review_required'));
}

function hasAcceptedDraftingFirstReview(patch) {
  const draftReviewAccepted = patch?.draft_view_review?.status === 'accepted'
    && patch?.draft_view_review?.promotion_allowed === true
    && Array.isArray(patch?.draft_view_review?.accepted_view_slot_ids)
    && patch.draft_view_review.accepted_view_slot_ids.length > 0;
  const localDetailReviewAbsent = !patch?.local_detail_review;
  const localDetailReviewAccepted = patch?.local_detail_review?.status === 'accepted'
    && patch?.local_detail_review?.promotion_allowed === true
    && (
      (Array.isArray(patch?.local_detail_review?.accepted_surface_ids) && patch.local_detail_review.accepted_surface_ids.length > 0)
      || (Array.isArray(patch?.local_detail_review?.accepted_detail_ids) && patch.local_detail_review.accepted_detail_ids.length > 0)
    );
  return draftReviewAccepted && (localDetailReviewAbsent || localDetailReviewAccepted);
}

function requiresFacadePlaneReview({ patch, candidateGraph, profile }) {
  if (!isBuildingSinglePromotion({ patch, candidateGraph, profile })) return false;
  if (patch?.plane_review) return true;
  return (candidateGraph?.candidates || []).some((candidate) => {
    const role = candidate.role || '';
    return role.startsWith('visible_plane_')
      || candidate.promotion?.blockers?.includes('accepted_facade_plane_review_required')
      || candidate.blockers?.includes?.('accepted_facade_plane_review_required');
  });
}

function hasAcceptedFacadePlaneReview(patch) {
  return patch?.plane_review?.status === 'accepted'
    && patch?.plane_review?.promotion_allowed === true
    && Array.isArray(patch?.plane_review?.accepted_plane_ids)
    && patch.plane_review.accepted_plane_ids.length > 0;
}

function makePartGraphShell({ patch, observationSet, profile, id, productName }) {
  const scale = scaleFromObservationOrProfile(observationSet, profile);
  return {
    version: 1,
    id: id || `${profile.profile_id || patch.profile_id || 'candidate'}-candidate-promotion-part-graph`,
    profile_id: profile.profile_id || patch.profile_id,
    compile_policy: {
      source: 'candidate_promotion_patch',
      require_promoted_geometry: true,
      block_reference_only_output: true
    },
    dsl_version: profile.dsl_version || 1,
    units: profile.units || 'mm',
    product: {
      type: observationSet.object?.type || profile.product_type || patch.profile_id,
      name: productName || observationSet.object?.name || profile.name || 'Candidate Promotion Model',
      source: 'candidate promotion patch'
    },
    scale,
    evidence_graph: evidenceGraphShell(observationSet, patch),
    parts: []
  };
}

function evidenceGraphShell(observationSet, patch = null) {
  return {
    version: 1,
    source_images: observationSet.object?.source_images || (observationSet.images || []).map((image) => image.image.path),
    views_detected: observationSet.views_detected || [],
    structure_evidence_graph: observationSet.structure_evidence_graph_v1 ? {
      kind: observationSet.structure_evidence_graph_v1.kind,
      edge_evidence_count: observationSet.structure_evidence_graph_v1.qa?.edge_evidence_count || 0,
      plane_hypothesis_count: observationSet.structure_evidence_graph_v1.qa?.plane_hypothesis_count || 0
    } : null,
    draft_view_graph: observationSet.draft_view_graph_v1 ? {
      kind: observationSet.draft_view_graph_v1.kind,
      observed_slots: observationSet.draft_view_graph_v1.summary?.observed_slots || 0,
      inferred_slots: observationSet.draft_view_graph_v1.summary?.inferred_slots || 0,
      unknown_slots: observationSet.draft_view_graph_v1.summary?.unknown_slots || 0
    } : null,
    calibration_lineage: patch?.calibration_lineage || null,
    open_questions: [
      'Candidate promotion generated PartGraph parts; run PartGraph compiler and QA gates before SketchUp output.'
    ],
    scale_calibration: observationSet.scale_calibration || null,
    parts: []
  };
}

function scaleFromObservationOrProfile(observationSet, profile) {
  const defaults = observationSet.scale_calibration?.default_scale || profile.default_scale || {};
  return {
    width: Number(defaults.width) || Number(profile.default_scale?.width) || 1,
    depth: Number(defaults.depth) || Number(profile.default_scale?.depth) || 1,
    height: Number(defaults.height) || Number(profile.default_scale?.height) || 1,
    confidence: Number(observationSet.scale_calibration?.confidence) || 0,
    ...(observationSet.scale_calibration ? { calibration: observationSet.scale_calibration } : {})
  };
}

function buildObservationIndex(observationSet) {
  const index = new Map();
  for (const image of observationSet.images || []) {
    index.set(`image|${image.image.path}`, image);
    for (const observation of image.observations || []) {
      index.set(`${image.image.path}|${observation.id}`, observation);
    }
  }
  return index;
}

function partFromCandidate({ action, candidate, observation, image, profile }) {
  const role = action.role || candidate.role;
  const id = safePartId(action.candidate_id);
  return {
    id,
    name: `${profile.profile_id || 'candidate'}_${id}`,
    type: role,
    role,
    material: materialForRole(role),
    shape: shapeForCandidate({ candidate, observation, image, profile }),
    evidence_status: 'manual_confirmed',
    fallback_state: fallbackForRole(role),
    evidence_sources: [
      {
        kind: 'candidate_promotion_review',
        status: 'manual_confirmed',
        source_image: candidate.source_image,
        observation_id: candidate.source_observation_id,
        accepted_draft_view_slot_id: action.accepted_draft_view_slot_id || '',
        accepted_plane_id: action.accepted_plane_id || '',
        accepted_surface_id: action.accepted_surface_id || '',
        accepted_detail_id: action.accepted_detail_id || '',
        confidence: Number(action.confidence ?? candidate.confidence ?? 0),
        note: action.reviewer_note || `Candidate ${candidate.id} accepted by candidate promotion review.`
      }
    ],
    grounding_status: 'review_confirmed',
    grounding_decision: 'promoted_geometry',
    source_observation_ids: [candidate.source_observation_id].filter(Boolean),
    review_required: true,
    helper_allowed: fallbackForRole(role) === 'visual_helper',
    photo_grade_eligible: false,
    compile: {
      emit: true,
      promoted_by: 'candidate_promotion_patch'
    },
    promoted_geometry: true,
    qa: {
      candidate_promotion_applied: true,
      promoted_geometry: true,
      part_graph_review_required: true,
      source_candidate_id: candidate.id,
      source_candidate_role: candidate.role,
      source_view: candidate.view,
      accepted_draft_view_slot_id: action.accepted_draft_view_slot_id || '',
      accepted_plane_id: action.accepted_plane_id || '',
      accepted_surface_id: action.accepted_surface_id || '',
      accepted_detail_id: action.accepted_detail_id || '',
      blocker_review_cleared: true
    }
  };
}

function shapeForCandidate({ candidate, observation, image, profile }) {
  const bbox = candidate.bbox || observation?.bbox || [0, 0, image?.image?.width || 1, image?.image?.height || 1];
  const imageWidth = Number(image?.image?.width) || Math.max(1, bbox[0] + bbox[2]);
  const imageHeight = Number(image?.image?.height) || Math.max(1, bbox[1] + bbox[3]);
  const scale = profile.default_scale || { width: 100, depth: 40, height: 50 };
  const centerX = (bbox[0] + bbox[2] / 2) / imageWidth;
  const centerY = (bbox[1] + bbox[3] / 2) / imageHeight;
  const width = Math.max(10, (bbox[2] / imageWidth) * scale.width);
  const height = Math.max(10, (bbox[3] / imageHeight) * scale.height);
  const roleDepth = depthForRole(candidate.role, scale.depth);
  const x = round((centerX - 0.5) * scale.width, 2);
  const z = round((1 - centerY) * scale.height, 2);
  const y = yForView(candidate.view, scale.depth, roleDepth);
  return {
    primitive: 'box',
    parameters: {
      origin: [x, y, round(z, 2)],
      size: [round(width, 2), round(roleDepth, 2), round(height, 2)]
    }
  };
}

function yForView(view, depth, partDepth) {
  if (view === 'front') return round(-depth / 2 + partDepth / 2, 2);
  if (view === 'rear') return round(depth / 2 - partDepth / 2, 2);
  return 0;
}

function depthForRole(role, depth) {
  if (role === 'building_main_mass' || role === 'main_object') return depth;
  if (role === 'rectangular_utility_ducts') return Math.max(120, depth * 0.035);
  if (role === 'exterior_hvac_units') return Math.max(180, depth * 0.045);
  if (role === 'shadow_or_recess_boundary') return Math.max(40, depth * 0.015);
  if (/facade|visible_plane|window|storefront|parapet/.test(role)) return Math.max(80, depth * 0.025);
  return Math.max(60, depth * 0.02);
}

function fallbackForRole(role) {
  if (role === 'building_main_mass' || role === 'main_object') return 'box_approximation';
  if (['rectangular_utility_ducts', 'roof_parapet_and_rail'].includes(role)) return 'structured_primitive';
  if (role === 'shadow_or_recess_boundary') return 'reference_only';
  return 'visual_helper';
}

function materialForRole(role) {
  if (role === 'rectangular_utility_ducts' || role === 'exterior_hvac_units') return 'Urban_Utility_Metal';
  if (role === 'shadow_or_recess_boundary' || role === 'visible_plane_recessed_left') return 'Urban_Stucco_Shadow';
  if (/window/.test(role)) return 'Urban_Glass_Blue';
  if (/storefront/.test(role)) return 'Urban_Awning_Red';
  return 'Urban_Review_Marker';
}

function evidenceGraphPartForAction(action) {
  const partId = safePartId(action.candidate_id);
  return {
    part_id: partId,
    status: 'manual_confirmed',
    required_views: [action.view].filter(Boolean),
    confirmed_views: [action.view].filter(Boolean),
    missing_views: [],
    confidence: Number(action.confidence) || 0,
    sources: [
      {
        kind: 'candidate_promotion_review',
        status: 'manual_confirmed',
        view: action.view,
        source_image: action.source_image,
        observation_id: action.source_observation_id,
        confidence: Number(action.confidence) || 0
      }
    ],
    conflicts: [
      {
        type: 'part_graph_review_required',
        severity: 'warn',
        note: 'Candidate promotion created geometry; run PartGraph QA before SketchUp compile acceptance.'
      }
    ],
    open_questions: [
      `${partId}: confirm shape parameters and physical placement after candidate promotion.`
    ]
  };
}

function upsertPart(partGraph, part) {
  const index = (partGraph.parts || []).findIndex((item) => item.id === part.id);
  if (index >= 0) partGraph.parts[index] = part;
  else partGraph.parts = [...(partGraph.parts || []), part];
}

function safePartId(value) {
  return String(value || 'candidate')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'candidate';
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sameStringSet(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second)) return false;
  const left = Array.from(new Set(first)).sort();
  const right = Array.from(new Set(second)).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = options.inputDir ? path.resolve(repoRoot, options.inputDir) : null;
  const profilePath = path.resolve(repoRoot, options.profile);
  const patchPath = path.resolve(repoRoot, options.patch || path.join(inputDir || '', 'candidate-promotion-patch.json'));
  const candidateGraphPath = path.resolve(repoRoot, options.candidateGraph || path.join(inputDir || '', 'candidate-graph.json'));
  const observationsPath = path.resolve(repoRoot, options.observations || path.join(inputDir || '', 'observations.json'));
  const basePartGraphPath = options.basePartGraph ? path.resolve(repoRoot, options.basePartGraph) : null;
  const outputPath = path.resolve(repoRoot, options.output || path.join(inputDir || '.', 'part-graph.candidate-promoted.json'));

  const [patch, candidateGraph, observationSet, profile, basePartGraph] = await Promise.all([
    readJson(patchPath),
    readJson(candidateGraphPath),
    readJson(observationsPath),
    readJson(profilePath),
    basePartGraphPath ? readJson(basePartGraphPath) : null
  ]);
  const { partGraph, applied } = applyCandidatePromotionPatch({
    patch,
    candidateGraph,
    observationSet,
    profile,
    basePartGraph,
    id: options.id,
    productName: options.productName
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(partGraph, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: outputPath,
    applied: applied.length,
    parts: partGraph.parts.length,
    compile_policy: partGraph.compile_policy
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input-dir') options.inputDir = argv[++index];
    else if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--patch') options.patch = argv[++index];
    else if (arg === '--candidate-graph') options.candidateGraph = argv[++index];
    else if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--base-part-graph') options.basePartGraph = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--id') options.id = argv[++index];
    else if (arg === '--product-name') options.productName = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.profile) throw new Error('--profile is required');
  if (!options.inputDir && !(options.patch && options.candidateGraph && options.observations)) {
    throw new Error('--input-dir or explicit --patch/--candidate-graph/--observations paths are required');
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/apply-candidate-promotion-patch.mjs \\
    --input-dir output/image-structured-modeler/building-single-intake-test \\
    --profile examples/product-profiles/building_single_urban_oblique.json

Options:
  --patch <path>             Explicit candidate-promotion-patch.json path.
  --candidate-graph <path>   Explicit candidate-graph.json path.
  --observations <path>      Explicit observations.json path.
  --base-part-graph <path>   Optional PartGraph to update.
  --output <path>            Output PartGraph path.
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
