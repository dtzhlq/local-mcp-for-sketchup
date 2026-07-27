import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MODIFICATION_INTENT_VERSION = '2026-07-modification-intent.1';

const SAFE_ACTIONS = new Set([
  'set_material',
  'assign_tag',
  'set_attribute',
  'transform_targets',
  'create_selection_surface',
  'create_aligned_box',
  'delete_targets'
]);

const ATTRIBUTE_ONLY_ACTIONS = new Set(['set_attribute', 'assign_tag']);

export async function planModificationIntent({
  instruction,
  action,
  parameters,
  target_query,
  targetQuery,
  targets,
  assume,
  output_dir,
  outputDir,
  compile_patch,
  compilePatch,
  runtime = 'mock',
  timeoutMs,
  allow_ambiguous_targets,
  allowAmbiguousTargets,
  allowMultiple = false,
  selection_mode,
  selectionMode,
  includeDetails = true,
  bridge
} = {}) {
  if (!bridge) throw new Error('planModificationIntent requires a bridge');
  const reportDir = output_dir || outputDir ? path.resolve(output_dir || outputDir) : null;
  const artifacts = {};
  const inspected = await bridge.inspect_model({
    runtime,
    timeoutMs,
    includeEntities: true,
    includeSnapshot: true,
    includeHidden: true
  });
  let targetResolution = null;
  const targetQueryValue = target_query ?? targetQuery;
  const allowAmbiguousValue = allow_ambiguous_targets === true || allowAmbiguousTargets === true || allowMultiple === true;
  if (targetQueryValue !== undefined && String(targetQueryValue).trim()) {
    targetResolution = await bridge.resolve_model_targets({
      query: targetQueryValue,
      runtime,
      timeoutMs,
      allowMultiple: allowAmbiguousValue
    });
  }
  const selectionGeometry = await bridge.analyze_selection_geometry({
    runtime,
    timeoutMs,
    assume,
    includeDetails
  });

  const intent = buildModificationIntent({
    instruction,
    action,
    parameters,
    targets,
    targetResolution,
    selectionGeometry,
    inspected,
    runtime,
    assume,
    selectionMode: selection_mode || selectionMode || 'replace',
    allowAmbiguousTargets: allowAmbiguousValue,
    compilePatch: compile_patch !== false && compilePatch !== false
  });

  if (reportDir) {
    await writeJsonArtifact(artifacts, 'target_resolution', path.join(reportDir, 'target-resolution.json'), targetResolution);
    await writeJsonArtifact(artifacts, 'selection_geometry', path.join(reportDir, 'selection-geometry.json'), selectionGeometry);
    await writeJsonArtifact(artifacts, 'modification_intent', path.join(reportDir, 'modification-intent.json'), intent);
    if (intent.patch) {
      await writeJsonArtifact(artifacts, 'intent_patch', path.join(reportDir, 'intent-patch.dsl.json'), intent.patch);
    }
    await writeJsonArtifact(artifacts, 'intent_manifest', path.join(reportDir, 'intent-manifest.json'), {
      kind: 'modification_intent_manifest',
      version: MODIFICATION_INTENT_VERSION,
      runtime,
      created_at: intent.created_at,
      intent_id: intent.intent_id,
      ok: intent.ok,
      action: intent.action,
      safe_to_execute: intent.safe_to_execute,
      requires_confirmation: intent.requires_confirmation,
      patch_sha256: intent.patch_sha256,
      artifacts
    });
    intent.artifacts = artifacts;
    await writeJsonArtifact(artifacts, 'modification_intent', path.join(reportDir, 'modification-intent.json'), intent);
  }

  return intent;
}

export function buildModificationIntent({
  instruction,
  action,
  parameters,
  targets,
  targetResolution,
  selectionGeometry,
  inspected,
  runtime = 'mock',
  assume,
  selectionMode = 'replace',
  allowAmbiguousTargets = false,
  compilePatch = true
} = {}) {
  const normalizedAction = normalizeAction(action, instruction);
  const normalizedParameters = normalizeParameters(parameters);
  const createdAt = new Date().toISOString();
  const targetRefs = targetReferences({ targets, targetResolution, selection: inspected?.selection || [] });
  const selection = selectionSummary(inspected?.selection || []);
  const geometryFacts = geometryFactSummary(selectionGeometry);
  const uncertainties = [
    ...(selectionGeometry?.uncertainties || []).map((item) => ({
      ...item,
      source: 'selection_geometry'
    }))
  ];
  const limitations = [];

  if (!selection.length) {
    uncertainties.push({
      type: 'selection.empty',
      severity: 'error',
      message: 'No selected geometry was available to turn into a modification intent.'
    });
  }
  if (!SAFE_ACTIONS.has(normalizedAction)) {
    limitations.push({
      type: 'action.unsupported',
      severity: 'error',
      message: `Unsupported ModificationIntent action: ${normalizedAction}`
    });
  }
  if (targetResolution?.requires_confirmation) {
    limitations.push({
      type: 'target.requires_confirmation',
      severity: 'warn',
      message: 'Target query returned an ambiguous or low-confidence resolution.'
    });
  }
  if (targetResolution && !targetResolution.ok) {
    limitations.push({
      type: 'target.unresolved',
      severity: 'error',
      message: 'Target query did not resolve to an editable target.'
    });
  }
  if (targetRefs.length > 1 && !allowAmbiguousTargets) {
    limitations.push({
      type: 'target.multiple_requires_confirmation',
      severity: 'warn',
      message: 'Multiple targets require explicit confirmation before execution.'
    });
  }
  if (normalizedAction === 'delete_targets') {
    limitations.push({
      type: 'action.destructive_requires_confirmation',
      severity: 'warn',
      message: 'delete_targets is destructive and always requires confirmation.'
    });
  }
  if (geometryFacts.some((fact) => fact.source === 'bounding_box_approximation') && !ATTRIBUTE_ONLY_ACTIONS.has(normalizedAction)) {
    limitations.push({
      type: 'geometry.bbox_only_requires_confirmation',
      severity: 'warn',
      message: 'Only approximate bounding-box geometry is available; geometry-changing edits require confirmation.'
    });
  }
  if (!ATTRIBUTE_ONLY_ACTIONS.has(normalizedAction) && selectionGeometry?.entities?.some((entity) => entity.hypotheses?.some((hypothesis) => hypothesis.requires_confirmation))) {
    limitations.push({
      type: 'semantics.requires_confirmation',
      severity: 'warn',
      message: 'One or more semantic hypotheses are uncertain and need domain confirmation.'
    });
  }
  if (!ATTRIBUTE_ONLY_ACTIONS.has(normalizedAction) && String(assume || normalizedAction).toLowerCase().includes('road')) {
    limitations.push({
      type: 'unsupported_or_requires_domain_confirmation',
      severity: 'warn',
      message: 'Road, traffic-control, and regulated domain-standard edits are not inferred automatically.'
    });
  }

  const proposedActions = buildProposedActions({
    action: normalizedAction,
    parameters: normalizedParameters,
    targetRefs,
    selection,
    geometryFacts
  });
  const actionErrors = proposedActions.filter((item) => item.valid === false)
    .map((item) => ({
      type: 'action.invalid_parameters',
      severity: 'error',
      message: item.reason || `Action ${normalizedAction} is missing required parameters.`
    }));
  limitations.push(...actionErrors);

  const hardErrors = [...limitations, ...uncertainties].filter((item) => item.severity === 'error');
  const blockingUncertainties = ATTRIBUTE_ONLY_ACTIONS.has(normalizedAction)
    ? []
    : uncertainties.filter((item) => item.severity === 'warn');
  const requiresConfirmation = hardErrors.length > 0 || limitations.some((item) => item.severity === 'warn') || blockingUncertainties.length > 0;
  const confirmationReasons = requiresConfirmation
    ? uniqueStrings([...hardErrors, ...limitations.filter((item) => item.severity === 'warn'), ...blockingUncertainties].map((item) => item.type))
    : [];
  const safeToExecute = hardErrors.length === 0
    && !requiresConfirmation
    && proposedActions.length > 0
    && proposedActions.every((item) => item.safe_to_execute === true);
  const confidence = intentConfidence({ targetResolution, selectionGeometry, limitations, uncertainties, proposedActions });
  const patch = compilePatch && proposedActions.length && hardErrors.length === 0
    ? compileIntentPatch(proposedActions)
    : null;

  const intent = {
    kind: 'modification_intent',
    version: MODIFICATION_INTENT_VERSION,
    intent_id: `intent-${createdAt.replace(/[:.]/g, '-')}`,
    created_at: createdAt,
    runtime,
    ok: hardErrors.length === 0 && proposedActions.length > 0,
    instruction: String(instruction || '').trim() || null,
    action: normalizedAction,
    parameters: normalizedParameters,
    targets: targetRefs,
    selection,
    geometry_facts: geometryFacts,
    proposed_actions: proposedActions.map(({ valid, reason, ...item }) => item),
    evidence: buildEvidence({ targetResolution, selectionGeometry, selection, geometryFacts, parameters: normalizedParameters }),
    confidence,
    safe_to_execute: safeToExecute,
    requires_confirmation: requiresConfirmation,
    confirmation: {
      required: requiresConfirmation,
      reasons: confirmationReasons
    },
    limitations,
    uncertainties,
    target_resolution: targetResolution ? resolutionSummary(targetResolution) : null,
    selection_geometry: selectionGeometry ? selectionGeometrySummary(selectionGeometry) : null,
    patch,
    patch_sha256: patch ? sha256Json(patch) : null,
    selection_mode: selectionMode
  };

  return intent;
}

export async function loadModificationIntent(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const parsed = JSON.parse(input);
    return normalizeIntentDocument(parsed);
  }
  return normalizeIntentDocument(input);
}

export async function loadModificationIntentFile(filePath) {
  if (!filePath) return null;
  return loadModificationIntent(await fs.readFile(filePath, 'utf8'));
}

export function compilePatchFromIntent(intent) {
  const normalized = normalizeIntentDocument(intent);
  if (normalized.patch) return normalized.patch;
  return compileIntentPatch(normalized.proposed_actions || []);
}

export function canExecuteIntent(intent) {
  const normalized = normalizeIntentDocument(intent);
  return normalized?.ok === true
    && normalized.safe_to_execute === true
    && normalized.requires_confirmation !== true
    && Array.isArray(normalized.proposed_actions)
    && normalized.proposed_actions.length > 0;
}

export function intentExecutionBlockReason(intent) {
  const normalized = normalizeIntentDocument(intent);
  if (!normalized) return 'No modification intent was supplied.';
  if (normalized.ok !== true) return 'Modification intent is not ok.';
  if (normalized.requires_confirmation === true) return 'Modification intent requires confirmation.';
  if (normalized.safe_to_execute !== true) return 'Modification intent is not marked safe_to_execute.';
  if (!Array.isArray(normalized.proposed_actions) || !normalized.proposed_actions.length) return 'Modification intent has no proposed actions.';
  return null;
}

function normalizeIntentDocument(document) {
  if (!document || typeof document !== 'object') throw new Error('ModificationIntent must be an object or JSON object string');
  if (document.kind !== 'modification_intent') throw new Error('ModificationIntent.kind must be "modification_intent"');
  return document;
}

function normalizeAction(action, instruction) {
  const explicit = String(action || '').trim();
  if (explicit) return explicit;
  const text = String(instruction || '').toLowerCase();
  if (/(delete|remove|删除|移除)/.test(text)) return 'delete_targets';
  if (/(material|材质|颜色|color|paint)/.test(text)) return 'set_material';
  if (/(tag|layer|图层|标签)/.test(text)) return 'assign_tag';
  if (/(move|translate|移动|旋转|rotate|scale|缩放)/.test(text)) return 'transform_targets';
  if (/(surface|face|面|区域|overlay)/.test(text)) return 'create_selection_surface';
  if (/(box|cube|块|盒)/.test(text)) return 'create_aligned_box';
  return 'set_attribute';
}

function normalizeParameters(parameters) {
  if (!parameters) return {};
  if (typeof parameters === 'string') {
    try {
      return JSON.parse(parameters);
    } catch (_) {
      return { value: parameters };
    }
  }
  return { ...parameters };
}

function targetReferences({ targets, targetResolution, selection }) {
  if (targetResolution?.selected_targets?.length) {
    return targetResolution.selected_targets.map((target) => referenceSummary(target));
  }
  const targetList = targets === undefined ? [] : (Array.isArray(targets) ? targets : [targets]);
  if (targetList.length) return targetList.map((target) => referenceSummary(target));
  return (selection || []).map((item) => referenceSummary(item));
}

function referenceSummary(item) {
  if (typeof item === 'string') return { id: item };
  return {
    id: item?.id || item?.target_id || item?.targetId || item?.persistent_id || item?.name || null,
    persistent_id: item?.persistent_id || null,
    name: item?.name || null,
    entity_type: item?.entity_type || item?.kind || null
  };
}

function selectionSummary(selection = []) {
  return (selection || []).map((item, index) => ({
    evidence_id: `selection:${index}`,
    id: item.id || item.persistent_id || item.name || null,
    persistent_id: item.persistent_id || null,
    name: item.name || null,
    entity_type: item.entity_type || item.kind || null,
    kind: item.kind || item.entity_type || null,
    material: item.material || null,
    tag: item.tag || null,
    bounding_box: item.bounding_box || null
  }));
}

function geometryFactSummary(selectionGeometry = {}) {
  return (selectionGeometry.entities || []).map((entity, index) => ({
    evidence_id: `geometry:${index}`,
    entity_index: entity.index ?? index,
    target_ref: entity.reference || null,
    entity_type: entity.entity_type,
    primitive: entity.geometry?.primitive || null,
    source: entity.geometry?.source || null,
    confidence: entity.geometry?.confidence ?? null,
    horizontal: entity.geometry?.horizontal ?? null,
    area_mm2: entity.geometry?.area_mm2 ?? null,
    perimeter_mm: entity.geometry?.perimeter_mm ?? null,
    length_mm: entity.geometry?.length_mm ?? null,
    vertex_count: entity.geometry?.vertex_count ?? null,
    hole_count: entity.geometry?.hole_count ?? null,
    bbox_2d: entity.geometry?.bbox_2d || null,
    oriented_extent: entity.geometry?.oriented_extent || null,
    points: entity.geometry?.points || null,
    holes: entity.geometry?.holes || null,
    hypotheses: (entity.hypotheses || []).map((item) => ({
      type: item.type,
      confidence: item.confidence,
      requires_confirmation: item.requires_confirmation === true
    }))
  }));
}

function buildProposedActions({ action, parameters, targetRefs, selection, geometryFacts }) {
  const refs = targetRefs.length ? targetRefs : selection.map((item) => ({ id: item.id, name: item.name, entity_type: item.entity_type }));
  const evidence = evidenceRefs({ selection, geometryFacts, parameters });
  switch (action) {
    case 'set_material': {
      const material = parameters.material || parameters.material_name || parameters.materialName || parameters.name;
      if (!material) return [invalidAction(action, 'set_material requires parameters.material')];
      return refs.map((target) => ({
        action,
        target,
        parameters: { material },
        evidence_refs: evidence,
        safe_to_execute: true,
        dsl_operation: { op: 'set_material', target_id: target.id, name: target.name, material }
      }));
    }
    case 'assign_tag': {
      const tag = parameters.tag || parameters.tag_name || parameters.tagName || parameters.name;
      if (!tag) return [invalidAction(action, 'assign_tag requires parameters.tag')];
      return refs.map((target) => ({
        action,
        target,
        parameters: { tag },
        evidence_refs: evidence,
        safe_to_execute: true,
        dsl_operation: { op: 'assign_tag', target_id: target.id, name: target.name, tag }
      }));
    }
    case 'set_attribute': {
      const dictionary = parameters.dictionary || parameters.namespace || 'LocalMcpModificationIntent';
      const key = parameters.key || parameters.attr_key || parameters.attrKey || 'intent';
      const value = parameters.value ?? parameters.attributes ?? parameters;
      return refs.map((target) => ({
        action,
        target,
        parameters: { dictionary, key, value },
        evidence_refs: evidence,
        safe_to_execute: true,
        dsl_operation: { op: 'attribute', target_id: target.id, name: target.name, dictionary, key, value }
      }));
    }
    case 'transform_targets': {
      const transform = normalizeTransformParameters(parameters);
      if (!Object.keys(transform).length) return [invalidAction(action, 'transform_targets requires translate, rotate, scale, mirror, matrix, or pivot parameters')];
      return refs.map((target) => ({
        action,
        target,
        parameters: transform,
        evidence_refs: evidence,
        safe_to_execute: true,
        dsl_operation: { op: 'transform_object', target_id: target.id, name: target.name, ...transform }
      }));
    }
    case 'create_selection_surface':
      return createSelectionSurfaceActions({ action, parameters, geometryFacts, evidence });
    case 'create_aligned_box':
      return createAlignedBoxActions({ action, parameters, geometryFacts, evidence });
    case 'delete_targets':
      return refs.map((target) => ({
        action,
        target,
        parameters: {},
        evidence_refs: evidence,
        safe_to_execute: false,
        dsl_operation: { op: 'delete', target_id: target.id, name: target.name }
      }));
    default:
      return [invalidAction(action, `Unsupported action: ${action}`)];
  }
}

function createSelectionSurfaceActions({ action, parameters, geometryFacts, evidence }) {
  const facts = geometryFacts.filter((fact) => fact.primitive === 'surface_polygon' && Array.isArray(fact.points) && fact.points.length >= 3);
  if (!facts.length) return [invalidAction(action, 'create_selection_surface requires selected face polygon points')];
  return facts.map((fact, index) => ({
    action,
    target: fact.target_ref || null,
    parameters: {
      material: parameters.material || null,
      name: parameters.name || `Intent_Surface_${index + 1}`
    },
    evidence_refs: [...evidence, fact.evidence_id],
    safe_to_execute: fact.source !== 'bounding_box_approximation',
    dsl_operation: {
      op: 'geometry_input',
      id: parameters.id || `intent-surface-${index + 1}`,
      name: parameters.name || `Intent_Surface_${index + 1}`,
      vertices: fact.points,
      faces: [[...Array(fact.points.length).keys()]],
      ...(fact.holes?.length ? { holes: fact.holes } : {}),
      ...(parameters.material ? { material: parameters.material } : {})
    }
  }));
}

function createAlignedBoxActions({ action, parameters, geometryFacts, evidence }) {
  const fact = geometryFacts.find((item) => item.oriented_extent || item.bbox_2d);
  const size = parameters.size || sizeFromFact(fact);
  const origin = parameters.origin || originFromFact(fact);
  if (!Array.isArray(size) || size.length < 3 || !Array.isArray(origin) || origin.length < 3) {
    return [invalidAction(action, 'create_aligned_box requires parameters.origin/size or measurable selected geometry')];
  }
  return [{
    action,
    target: fact?.target_ref || null,
    parameters: { origin, size, material: parameters.material || null },
    evidence_refs: fact ? [...evidence, fact.evidence_id] : evidence,
    safe_to_execute: fact?.source !== 'bounding_box_approximation',
    dsl_operation: {
      op: 'box',
      id: parameters.id || 'intent-aligned-box',
      name: parameters.name || 'Intent_Aligned_Box',
      origin,
      size,
      ...(parameters.material ? { material: parameters.material } : {})
    }
  }];
}

function sizeFromFact(fact) {
  const extent = fact?.oriented_extent;
  if (extent?.length_mm && extent?.width_mm) return [extent.length_mm, extent.width_mm, 10];
  const box = fact?.bbox_2d;
  if (box?.min && box?.max) return [box.max[0] - box.min[0], box.max[1] - box.min[1], 10];
  return null;
}

function originFromFact(fact) {
  const box = fact?.bbox_2d;
  if (box?.min) return [box.min[0], box.min[1], 0];
  return null;
}

function normalizeTransformParameters(parameters) {
  const transform = {};
  for (const key of ['translate', 'rotateX', 'rotateY', 'rotateZ', 'axis', 'angle', 'rotate_axis', 'rotateAxis', 'local_axis', 'localAxis', 'local_angle', 'localAngle', 'rotate_local', 'rotateLocal', 'matrix', 'matrix4x4', 'local_matrix', 'localMatrix', 'scale', 'mirror', 'pivot']) {
    if (parameters[key] !== undefined) transform[key] = parameters[key];
  }
  if (parameters.transform && typeof parameters.transform === 'object') Object.assign(transform, parameters.transform);
  return transform;
}

function invalidAction(action, reason) {
  return {
    action,
    valid: false,
    reason,
    parameters: {},
    evidence_refs: ['parameters'],
    safe_to_execute: false
  };
}

function evidenceRefs({ selection, geometryFacts, parameters }) {
  const refs = [];
  if (selection.length) refs.push(selection[0].evidence_id);
  if (geometryFacts.length) refs.push(geometryFacts[0].evidence_id);
  if (Object.keys(parameters || {}).length) refs.push('parameters');
  return refs.length ? refs : ['user_instruction'];
}

function buildEvidence({ targetResolution, selectionGeometry, selection, geometryFacts, parameters }) {
  const evidence = [];
  if (targetResolution) {
    evidence.push({
      evidence_id: 'target_resolution',
      type: 'target_resolution',
      ok: targetResolution.ok,
      requires_confirmation: targetResolution.requires_confirmation,
      selected_count: targetResolution.selected_targets?.length || 0
    });
  }
  for (const item of selection) evidence.push({ evidence_id: item.evidence_id, type: 'selection', summary: item });
  for (const item of geometryFacts) evidence.push({ evidence_id: item.evidence_id, type: 'geometry_fact', summary: item });
  if (Object.keys(parameters || {}).length) evidence.push({ evidence_id: 'parameters', type: 'user_parameters', summary: parameters });
  if (selectionGeometry?.aggregate) evidence.push({ evidence_id: 'geometry_aggregate', type: 'selection_geometry_aggregate', summary: selectionGeometry.aggregate });
  return evidence;
}

function compileIntentPatch(proposedActions) {
  const operations = (proposedActions || [])
    .filter((item) => item.dsl_operation)
    .map((item) => item.dsl_operation);
  return { version: 1, units: 'mm', operations };
}

function intentConfidence({ targetResolution, selectionGeometry, limitations, uncertainties, proposedActions }) {
  const scores = [];
  if (targetResolution?.selected?.length) scores.push(targetResolution.selected[0].confidence || 0.65);
  for (const entity of selectionGeometry?.entities || []) scores.push(entity.geometry?.confidence ?? 0.5);
  for (const action of proposedActions || []) scores.push(action.safe_to_execute ? 0.85 : 0.45);
  const base = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0.35;
  const penalty = limitations.length * 0.08 + uncertainties.filter((item) => item.severity !== 'info').length * 0.05;
  return round(Math.max(0, Math.min(1, base - penalty)));
}

function resolutionSummary(resolution) {
  return {
    ok: resolution.ok,
    query: resolution.query,
    strategy: resolution.strategy,
    requires_confirmation: resolution.requires_confirmation,
    candidate_count: resolution.candidate_count,
    selected_targets: resolution.selected_targets || []
  };
}

function selectionGeometrySummary(analysis) {
  return {
    ok: analysis.ok,
    source: analysis.source,
    aggregate: analysis.aggregate,
    uncertainty_count: analysis.uncertainties?.length || 0,
    entity_count: analysis.entities?.length || 0
  };
}

async function writeJsonArtifact(artifacts, key, filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  artifacts[key] = filePath;
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
