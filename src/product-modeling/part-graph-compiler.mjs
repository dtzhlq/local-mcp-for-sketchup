import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SHAPE_OPERATIONS = new Set([
  'box',
  'rounded_box',
  'mesh',
  'prism',
  'cylinder',
  'rib',
  'slot',
  'slot_array',
  'recess',
  'engraved_line',
  'text_3d',
  'text_emboss',
  'text_engrave',
  'image_plane',
  'button_on_panel',
  'analog_stick',
  'screw_hole',
  'standoff_boss',
  'domed_surface',
  'bowed_panel',
  'loft_between_profiles',
  'shell_from_front_side_profiles',
  'face_on_cylinder',
  'panel_with_openings',
  'boolean_cutout',
  'face_with_holes',
  'profile_extrude',
  'gable_roof',
  'shed_roof'
]);

const FEATURE_OPERATIONS = new Set(['cut_hole', 'cut_slot', 'cut_recess', 'add_boss', 'add_raised_rib']);

export async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function compilePartGraphFiles({ profilePath, partGraphPath, repoRoot = process.cwd() } = {}) {
  if (!profilePath) throw new Error('profilePath is required');
  if (!partGraphPath) throw new Error('partGraphPath is required');
  const [profile, partGraph] = await Promise.all([
    readJsonFile(profilePath),
    readJsonFile(partGraphPath)
  ]);
  return compilePartGraphToSketchUpDsl(partGraph, profile, {
    repoRoot,
    profilePath,
    partGraphPath
  });
}

export function compilePartGraphToSketchUpDsl(partGraph = {}, profile = {}, options = {}) {
  validateProfileMatch(partGraph, profile);
  enforceCompileGate(partGraph, profile);
  const repoRoot = path.resolve(options.repoRoot || DEFAULT_REPO_ROOT);
  const context = buildContext(partGraph, profile, { ...options, repoRoot });
  const operations = [];

  if (options.includeReset !== false) operations.push({ op: 'reset' });
  operations.push(...compileMaterials(profile));
  operations.push(...compileTags(profile));
  operations.push(...compileReferenceImages(profile, context));

  for (const part of partGraph.parts || []) {
    operations.push(...compilePart(part, context));
  }

  for (const operation of partGraph.operations || []) {
    operations.push(compileGraphOperation(operation, context));
  }

  operations.push(...compileReviewOperations(profile));

  return {
    version: partGraph.dsl_version || profile.dsl_version || 1,
    units: partGraph.units || profile.units || 'mm',
    metadata: compileDocumentMetadata(partGraph, profile),
    operations
  };
}

function validateProfileMatch(partGraph, profile) {
  if (!partGraph || typeof partGraph !== 'object') throw new Error('partGraph must be an object');
  if (!profile || typeof profile !== 'object') throw new Error('profile must be an object');
  if (partGraph.profile_id && profile.profile_id && partGraph.profile_id !== profile.profile_id) {
    throw new Error(`Part graph profile_id ${partGraph.profile_id} does not match profile ${profile.profile_id}`);
  }
}

function enforceCompileGate(partGraph, profile) {
  const gate = resolveCompileGate([
    profile.compile_gate,
    profile.compiler?.geometry_gate,
    partGraph.compile_gate,
    partGraph.compile_policy
  ]);
  if (!gate || gate.enabled === false) return;

  const summary = compileGateSummary(partGraph);
  const issues = [];
  if (gate.max_needs_review_ratio !== undefined && summary.needs_review_ratio > gate.max_needs_review_ratio) {
    issues.push(`needs_review_ratio ${summary.needs_review_ratio} exceeds ${gate.max_needs_review_ratio}`);
  }
  if (gate.max_profile_default_ratio !== undefined && summary.profile_default_ratio > gate.max_profile_default_ratio) {
    issues.push(`profile_default_ratio ${summary.profile_default_ratio} exceeds ${gate.max_profile_default_ratio}`);
  }
  if (gate.min_observed_parts !== undefined && summary.observed_parts < gate.min_observed_parts) {
    issues.push(`observed_parts ${summary.observed_parts} is below ${gate.min_observed_parts}`);
  }
  if (gate.min_inferred_parts !== undefined && summary.inferred_parts < gate.min_inferred_parts) {
    issues.push(`inferred_parts ${summary.inferred_parts} is below ${gate.min_inferred_parts}`);
  }
  if (gate.min_scale_confidence !== undefined && summary.scale_confidence < gate.min_scale_confidence) {
    issues.push(`scale_confidence ${summary.scale_confidence} is below ${gate.min_scale_confidence}`);
  }
  if (gate.require_promoted_geometry === true && summary.promoted_geometry_parts < 1) {
    issues.push('promoted_geometry_parts 0 is below 1');
  }
  if (gate.block_reference_only_output === true && summary.compilable_shape_parts < 1) {
    issues.push('compilable_shape_parts 0 is below 1');
  }

  if (issues.length > 0) {
    const profileId = partGraph.profile_id || profile.profile_id || 'unknown_profile';
    throw new Error(`PartGraph compile blocked by geometry gate for ${profileId}: ${issues.join('; ')}`);
  }
}

function resolveCompileGate(gates = []) {
  const resolved = {};
  let hasGate = false;
  for (const gate of gates) {
    if (!gate || gate.enabled === false) continue;
    hasGate = true;
    resolved.enabled = true;
    if (gate.max_needs_review_ratio !== undefined) {
      resolved.max_needs_review_ratio = resolved.max_needs_review_ratio === undefined
        ? gate.max_needs_review_ratio
        : Math.min(resolved.max_needs_review_ratio, gate.max_needs_review_ratio);
    }
    if (gate.max_profile_default_ratio !== undefined) {
      resolved.max_profile_default_ratio = resolved.max_profile_default_ratio === undefined
        ? gate.max_profile_default_ratio
        : Math.min(resolved.max_profile_default_ratio, gate.max_profile_default_ratio);
    }
    if (gate.min_observed_parts !== undefined) {
      resolved.min_observed_parts = Math.max(resolved.min_observed_parts || 0, gate.min_observed_parts);
    }
    if (gate.min_inferred_parts !== undefined) {
      resolved.min_inferred_parts = Math.max(resolved.min_inferred_parts || 0, gate.min_inferred_parts);
    }
    if (gate.min_scale_confidence !== undefined) {
      resolved.min_scale_confidence = Math.max(resolved.min_scale_confidence || 0, gate.min_scale_confidence);
    }
    if (gate.require_promoted_geometry === true) resolved.require_promoted_geometry = true;
    if (gate.block_reference_only_output === true) resolved.block_reference_only_output = true;
  }
  return hasGate ? resolved : null;
}

function compileGateSummary(partGraph) {
  const parts = partGraph.parts || [];
  const total = Math.max(1, parts.length);
  const evidenceCounts = countBy(parts, 'evidence_status');
  const fallbackCounts = countBy(parts, 'fallback_state');
  const promoted = parts.filter((part) => partPromotedForGeometry(part)).length;
  const compilableShapeParts = parts.filter((part) => part.compile?.emit !== false && part.shape).length;
  return {
    part_count: parts.length,
    observed_parts: evidenceCounts.observed || 0,
    inferred_parts: evidenceCounts.inferred || 0,
    profile_default_parts: evidenceCounts.profile_default || 0,
    needs_review_parts: evidenceCounts.needs_review || 0,
    profile_default_ratio: round((evidenceCounts.profile_default || 0) / total, 3),
    needs_review_ratio: round((evidenceCounts.needs_review || 0) / total, 3),
    fallback_needs_review_parts: fallbackCounts.needs_review || 0,
    scale_confidence: partGraph.scale?.confidence ?? 0,
    promoted_geometry_parts: promoted,
    compilable_shape_parts: compilableShapeParts
  };
}

function partPromotedForGeometry(part) {
  if (part.promoted_geometry === true || part.qa?.promoted_geometry === true) return true;
  if (part.grounding_decision === 'promoted_geometry') return true;
  if (part.evidence_status === 'manual_confirmed' && part.fallback_state !== 'needs_review') return true;
  return false;
}

function countBy(items, key) {
  const result = {};
  for (const item of items || []) {
    const value = item[key];
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildContext(partGraph, profile, options) {
  const partsById = new Map();
  const partsByName = new Map();
  for (const part of partGraph.parts || []) {
    if (!part.id) throw new Error('PartGraph part.id is required');
    if (!part.name) throw new Error(`PartGraph part ${part.id} requires name`);
    if (partsById.has(part.id)) throw new Error(`Duplicate PartGraph part id: ${part.id}`);
    if (partsByName.has(part.name)) throw new Error(`Duplicate PartGraph part name: ${part.name}`);
    partsById.set(part.id, part);
    partsByName.set(part.name, part);
  }
  return {
    repoRoot: options.repoRoot,
    profilePath: options.profilePath,
    partGraphPath: options.partGraphPath,
    profile,
    partGraph,
    partsById,
    partsByName
  };
}

function compileMaterials(profile) {
  return (profile.materials || []).map((material) => {
    const { name, color, ...rest } = material;
    if (!name || !color) throw new Error('ProductProfile materials require name and color');
    return { op: 'material', name, color, ...cloneJson(rest) };
  });
}

function compileTags(profile) {
  return (profile.tags || []).map((tag) => {
    const { name, color, ...rest } = tag;
    if (!name) throw new Error('ProductProfile tags require name');
    return { op: 'tag', name, ...(color ? { color } : {}), ...cloneJson(rest) };
  });
}

function compileReferenceImages(profile, context) {
  return (profile.reference_images || []).map((reference) => {
    const { id, name, source, origin, plane, size, alpha, material, texture_transform } = reference;
    if (!id || !name || !source) throw new Error('reference_images entries require id, name, and source');
    return {
      op: 'image_plane',
      id,
      name,
      origin: cloneJson(origin),
      plane,
      size: cloneJson(size),
      image: resolveAssetPath(source, context.repoRoot),
      ...(alpha !== undefined ? { alpha } : {}),
      ...(material ? { material } : {}),
      texture_transform: cloneJson(texture_transform || { projection: 'planar', scale: [1, 1], rotation: 0 }),
      qa: {
        role: 'reference_image',
        part_id: id,
        intent: 'reference_alignment',
        evidence_status: 'observed',
        fallback_state: 'reference_only'
      }
    };
  });
}

function compilePart(part, context) {
  if (part.compile?.emit === false) return [];
  if (!part.shape) return [];
  const primitive = part.shape.primitive;
  if (!SHAPE_OPERATIONS.has(primitive)) throw new Error(`Unsupported PartGraph shape primitive: ${primitive}`);

  const operation = {
    op: primitive,
    id: part.id,
    name: part.name,
    ...cloneJson(part.shape.parameters || {})
  };
  if (part.material && operation.material === undefined) operation.material = part.material;
  operation.qa = qaForPart(part);

  const operations = [operation];
  for (const feature of part.feature_intents || []) {
    operations.push(compileFeatureIntent(part, feature));
  }
  return operations;
}

function compileFeatureIntent(part, feature) {
  const op = feature.operation || feature.op || feature.feature_mapping?.operation;
  if (!FEATURE_OPERATIONS.has(op)) throw new Error(`Unsupported feature intent operation: ${op}`);
  const parameters = cloneJson(feature.parameters || {});
  return {
    op,
    target_id: feature.target_id || part.id,
    feature_id: feature.id || feature.feature_id,
    face: feature.face,
    ...parameters,
    qa: qaForFeatureIntent(part, feature)
  };
}

function compileGraphOperation(operation, context) {
  const compiled = cloneJson(operation);
  if (compiled.op === 'image_plane') {
    for (const field of ['image', 'texture']) {
      if (typeof compiled[field] === 'string') compiled[field] = resolveAssetPath(compiled[field], context.repoRoot);
    }
  }
  if (compiled.target_part_id) {
    compiled.target_id = partObjectId(compiled.target_part_id, context);
    delete compiled.target_part_id;
  }
  if (compiled.tool_part_ids) {
    compiled.tool_ids = compiled.tool_part_ids.map((partId) => partObjectId(partId, context));
    delete compiled.tool_part_ids;
  }
  if (compiled.result_part_id) {
    compiled.result_id = compiled.result_part_id;
    delete compiled.result_part_id;
  }
  if (compiled.part_id && !compiled.qa) {
    const part = context.partsById.get(compiled.part_id);
    if (part) compiled.qa = qaForPart(part);
  }
  return compiled;
}

function compileReviewOperations(profile) {
  const review = profile.review || {};
  const operations = [];
  for (const scene of review.scenes || []) {
    operations.push({ op: 'scene', ...cloneJson(scene) });
  }
  if (review.style) operations.push({ op: 'style', ...cloneJson(review.style) });
  if (review.shadow) operations.push({ op: 'shadow', ...cloneJson(review.shadow) });
  if (review.rendering_options) operations.push({ op: 'rendering_options', ...cloneJson(review.rendering_options) });
  return operations;
}

function compileDocumentMetadata(partGraph, profile) {
  return {
    kind: 'product_modeling_dsl',
    profile_id: partGraph.profile_id || profile.profile_id,
    product_type: partGraph.product?.type || profile.product_type,
    product_name: partGraph.product?.name || profile.name,
    source: 'part_graph_compiler',
    part_graph_id: partGraph.id,
    profile_version: profile.version,
    part_graph_version: partGraph.version
  };
}

function qaForPart(part) {
  const qa = {
    role: part.role || part.type,
    part_id: part.id,
    intent: part.intent || part.feature_intent || part.type,
    evidence_status: part.evidence_status || 'needs_review',
    fallback_state: part.fallback_state || 'needs_review'
  };
  if (part.parent) qa.parent_part_id = part.parent;
  if (part.evidence_sources) qa.evidence_sources = cloneJson(part.evidence_sources);
  if (part.feature_intents) {
    qa.feature_intents = part.feature_intents.map((feature) => ({
      id: feature.id || feature.feature_id,
      operation: feature.operation || feature.op || feature.feature_mapping?.operation,
      fallback_state: feature.fallback_state || feature.feature_mapping?.fallback || 'needs_review'
    }));
  }
  return { ...qa, ...cloneJson(part.qa || {}) };
}

function qaForFeatureIntent(part, feature) {
  return {
    role: feature.semantic || feature.operation || 'feature_intent',
    part_id: part.id,
    feature_id: feature.id || feature.feature_id,
    intent: feature.semantic || feature.operation || 'feature_intent',
    evidence_status: part.evidence_status || 'needs_review',
    fallback_state: feature.fallback_state || feature.feature_mapping?.fallback || 'needs_review',
    grounding_status: feature.grounding_status || part.grounding_status || part.qa?.grounding_status || 'profile_prior',
    grounding_method: feature.grounding_method || part.grounding_method || part.qa?.grounding_method || null,
    source_observation_ids: cloneJson(feature.source_observation_ids || part.source_observation_ids || part.qa?.source_observation_ids || []),
    projection_residuals: cloneJson(feature.projection_residuals || null),
    review_required: feature.review_required ?? part.review_required ?? part.qa?.review_required ?? false,
    helper_allowed: feature.helper_allowed ?? part.helper_allowed ?? part.qa?.helper_allowed ?? false,
    photo_grade_eligible: feature.photo_grade_eligible ?? false
  };
}

function partObjectId(partId, context) {
  const part = context.partsById.get(partId);
  if (!part) throw new Error(`Unknown PartGraph part reference: ${partId}`);
  return part.object_id || part.id;
}

function resolveAssetPath(source, repoRoot) {
  if (path.isAbsolute(source)) return source;
  return path.resolve(repoRoot, source);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
