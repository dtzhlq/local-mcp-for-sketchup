import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareSnapshots } from './snapshot-diff.mjs';
import { modelInfoFromSnapshot } from './model-inspection.mjs';
import { canExecuteIntent, compilePatchFromIntent, intentExecutionBlockReason, loadModificationIntent, loadModificationIntentFile } from './modification-intent.mjs';

export const MODEL_ITERATION_VERSION = '2026-07-natural-iteration.1';

export async function runModelIteration(bridge, {
  code,
  input_format,
  inputFormat,
  runtime = 'mock',
  timeoutMs,
  label,
  output_dir,
  outputDir,
  targets,
  target_query,
  targetQuery,
  allow_ambiguous_targets,
  allowAmbiguousTargets,
  preview_only,
  previewOnly,
  selection_mode,
  selectionMode,
  save_model = true,
  saveModel,
  save_path,
  savePath,
  capture_view = false,
  captureView,
  capture,
  validate_model = true,
  validateModel,
  validate_reference_model = false,
  validateReferenceModel,
  model_spec,
  modelSpec,
  reference_spec,
  referenceSpec,
  includePreview = true,
  strictCollisions,
  strictUnanchored,
  floatingDetails,
  toleranceMm,
  topologyTolerance,
  budgets,
  topIssueLimit,
  seed,
  maxOperations,
  maxLoopIterations,
  maxStatements,
  maxOutputBytes,
  expertTimeoutMs,
  pythonTimeoutMs,
  pythonCommand,
  intent,
  intent_file,
  intentFile
} = {}) {
  const suppliedIntent = intent_file || intentFile
    ? await loadModificationIntentFile(intent_file || intentFile)
    : await loadModificationIntent(intent);
  let iterationCode = typeof code === 'string' ? code : '';
  let intentPatch = null;
  let intentBlockedReason = null;
  if (!iterationCode.trim() && suppliedIntent) {
    if (canExecuteIntent(suppliedIntent)) {
      intentPatch = compilePatchFromIntent(suppliedIntent);
      iterationCode = `${JSON.stringify(intentPatch, null, 2)}\n`;
      input_format ||= 'json_dsl';
    } else {
      intentBlockedReason = intentExecutionBlockReason(suppliedIntent);
    }
  }
  if (!iterationCode.trim() && !suppliedIntent) {
    throw new Error('iterate_model requires non-empty patch code or a modification intent');
  }

  const startedAt = new Date().toISOString();
  const normalizedLabel = safeLabel(label || suppliedIntent?.action || 'iteration');
  const iterationId = `${normalizedLabel}-${startedAt.replace(/[:.]/g, '-')}`;
  const reportDir = path.resolve(output_dir || outputDir || path.join('output', 'iterations', iterationId));
  const artifacts = {};
  await fs.mkdir(reportDir, { recursive: true });

  const before = await bridge.inspect_model({
    runtime,
    timeoutMs,
    includeSnapshot: true,
    includeEntities: true
  });
  await writeJsonArtifact(artifacts, 'before_snapshot', path.join(reportDir, 'before-snapshot.json'), before.snapshot);
  await writeJsonArtifact(artifacts, 'before_model_info', path.join(reportDir, 'before-model-info.json'), before.model_info);

  let selectedTargets = null;
  let selectedReferences = [];
  let targetResolution = null;
  let nestedBeforeAdoption = null;
  let nestedAfterAdoption = null;
  const allowAmbiguousValue = allow_ambiguous_targets === true || allowAmbiguousTargets === true;
  const targetQueryValue = target_query ?? targetQuery;
  const targetSelectionMode = selection_mode || selectionMode || 'replace';
  if (targetQueryValue !== undefined && String(targetQueryValue).trim()) {
    targetResolution = await bridge.resolve_model_targets({
      query: targetQueryValue,
      runtime,
      timeoutMs,
      allowMultiple: allowAmbiguousValue
    });
    await writeJsonArtifact(artifacts, 'target_resolution', path.join(reportDir, 'target-resolution.json'), targetResolution);
    if (!targetResolution.ok || !targetResolution.selected_targets?.length) {
      throw new Error(`iterate_model could not resolve target_query: ${targetQueryValue}`);
    }
    if (targetResolution.requires_confirmation && !allowAmbiguousValue) {
      throw new Error(`iterate_model target_query requires confirmation: ${targetQueryValue}`);
    }
    selectedTargets = await bridge.set_selection({
      runtime,
      timeoutMs,
      targets: targetResolution.selected_targets,
      mode: targetSelectionMode
    });
    selectedReferences = (selectedTargets.selection || []).map(selectionReference);
    await writeJsonArtifact(artifacts, 'target_selection', path.join(reportDir, 'target-selection.json'), selectedTargets);
  } else if (isCurrentSelectionTarget(targets)) {
    selectedReferences = (before.selection || []).map(selectionReference);
    if (!selectedReferences.length) throw new Error('iterate_model targets=selection requires a non-empty current selection');
    selectedTargets = {
      kind: 'set_selection',
      runtime,
      mode: 'current',
      selection: before.selection
    };
    await writeJsonArtifact(artifacts, 'target_selection', path.join(reportDir, 'target-selection.json'), selectedTargets);
  } else if (hasNestedEntityTargets(targets)) {
    selectedReferences = normalizeNestedEntityTargets(targets);
    nestedBeforeAdoption = await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true });
    const indexedPaths = new Set((nestedBeforeAdoption.recursive_index || []).map((entry) => entry.entity_path).filter(Boolean));
    for (const reference of selectedReferences) {
      if (!indexedPaths.has(reference.entity_path)) throw new Error(`iterate_model nested entity_path is not present in the recursive adoption index: ${reference.entity_path}`);
    }
    await writeJsonArtifact(artifacts, 'before_nested_index', path.join(reportDir, 'before-nested-index.json'), nestedBeforeAdoption);
    selectedTargets = {
      kind: 'nested_target_selection',
      runtime,
      mode: 'reference_only',
      selection: selectedReferences
    };
    await writeJsonArtifact(artifacts, 'target_selection', path.join(reportDir, 'target-selection.json'), selectedTargets);
  } else if (targets !== undefined) {
    selectedTargets = await bridge.set_selection({
      runtime,
      timeoutMs,
      targets,
      mode: targetSelectionMode
    });
    selectedReferences = (selectedTargets.selection || []).map(selectionReference);
    await writeJsonArtifact(artifacts, 'target_selection', path.join(reportDir, 'target-selection.json'), selectedTargets);
  }

  if (suppliedIntent) {
    await writeJsonArtifact(artifacts, 'modification_intent', path.join(reportDir, 'modification-intent.json'), suppliedIntent);
    const compiledIntentPatch = intentPatch || suppliedIntent.patch || null;
    if (compiledIntentPatch) {
      await writeJsonArtifact(artifacts, 'intent_patch', path.join(reportDir, 'intent-patch.dsl.json'), compiledIntentPatch);
    }
    await writeJsonArtifact(artifacts, 'intent_manifest', path.join(reportDir, 'intent-manifest.json'), {
      kind: 'model_iteration_intent_manifest',
      version: MODEL_ITERATION_VERSION,
      iteration_id: iterationId,
      intent_id: suppliedIntent.intent_id,
      action: suppliedIntent.action,
      safe_to_execute: suppliedIntent.safe_to_execute,
      requires_confirmation: suppliedIntent.requires_confirmation,
      blocked_reason: intentBlockedReason,
      patch_sha256: suppliedIntent.patch_sha256 || (compiledIntentPatch ? sha256Hex(JSON.stringify(compiledIntentPatch)) : null)
    });
  }

  if (intentBlockedReason) {
    const finishedAt = new Date().toISOString();
    const manifest = {
      kind: 'model_iteration_preview',
      version: MODEL_ITERATION_VERSION,
      iteration_id: iterationId,
      label: normalizedLabel,
      runtime,
      input_format: input_format || inputFormat || 'json_dsl',
      output_dir: reportDir,
      started_at: startedAt,
      finished_at: finishedAt,
      artifacts,
      target_resolution: resolutionSummary(targetResolution),
      target_selection: selectedTargets ? selectionSummary(selectedTargets.selection) : selectionSummary(before.selection),
      before: {
        model_info: before.model_info,
        selection: selectionSummary(before.selection)
      },
      modification_intent: intentSummary(suppliedIntent),
      preview_only: true,
      blocked: true,
      blocked_reason: intentBlockedReason
    };
    await writeJsonArtifact(artifacts, 'manifest', path.join(reportDir, 'manifest.json'), manifest);
    return manifest;
  }

  const format = input_format || inputFormat || 'auto';
  const inputPath = path.join(reportDir, inputExtension(format));
  await fs.writeFile(inputPath, `${iterationCode.trim()}\n`, 'utf8');
  artifacts.input = inputPath;
  const resolvedInput = resolvePatchInput(iterationCode, format, selectedReferences);
  const evaluationCode = resolvedInput.code;
  if (resolvedInput.changed) {
    await fs.writeFile(resolvedInputPath(format, reportDir), evaluationCode, 'utf8');
    artifacts.resolved_input = resolvedInputPath(format, reportDir);
    await writeJsonArtifact(artifacts, 'resolved_input_metadata', path.join(reportDir, 'resolved-input.json'), {
      kind: 'resolved_iteration_input',
      placeholder_targets: selectedReferences,
      changed: true,
      input_format: format
    });
  }

  if (preview_only === true || previewOnly === true) {
    const finishedAt = new Date().toISOString();
    const manifest = {
      kind: 'model_iteration_preview',
      version: MODEL_ITERATION_VERSION,
      iteration_id: iterationId,
      label: normalizedLabel,
      runtime,
      input_format: format,
      output_dir: reportDir,
      started_at: startedAt,
      finished_at: finishedAt,
      code_sha256: sha256Hex(iterationCode),
      resolved_code_sha256: resolvedInput.changed ? sha256Hex(evaluationCode) : undefined,
      artifacts,
      target_resolution: resolutionSummary(targetResolution),
      target_selection: selectedTargets ? selectionSummary(selectedTargets.selection) : selectionSummary(before.selection),
      before: {
        model_info: before.model_info,
        selection: selectionSummary(before.selection)
      },
      modification_intent: intentSummary(suppliedIntent),
      preview_only: true
    };
    await writeJsonArtifact(artifacts, 'manifest', path.join(reportDir, 'manifest.json'), manifest);
    return manifest;
  }

  const evaluated = await bridge.evaluate_py({
    code: evaluationCode,
    input_format: format,
    runtime,
    timeoutMs,
    seed,
    maxOperations,
    maxLoopIterations,
    maxStatements,
    maxOutputBytes,
    expertTimeoutMs,
    pythonTimeoutMs,
    pythonCommand
  });
  if (!evaluated?.snapshot) {
    throw new Error(`iterate_model requires a patch format that returns a snapshot; got ${evaluated?.compatibility_mode || 'unknown'}${evaluated?.reason ? ` (${evaluated.reason})` : ''}`);
  }
  await writeJsonArtifact(artifacts, 'evaluation', path.join(reportDir, 'evaluation.json'), evaluated);
  await writeJsonArtifact(artifacts, 'after_snapshot', path.join(reportDir, 'after-snapshot.json'), evaluated.snapshot);
  await writeJsonArtifact(artifacts, 'after_model_info', path.join(reportDir, 'after-model-info.json'), modelInfoFromSnapshot(evaluated.snapshot, { runtime }));
  if (nestedBeforeAdoption) {
    nestedAfterAdoption = await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true });
    await writeJsonArtifact(artifacts, 'after_nested_index', path.join(reportDir, 'after-nested-index.json'), nestedAfterAdoption);
  }

  const snapshotDiff = compareSnapshots(before.snapshot, evaluated.snapshot, {
    toleranceMm,
    topologyTolerance,
    budgets,
    topIssueLimit
  });
  await writeJsonArtifact(artifacts, 'snapshot_diff', path.join(reportDir, 'snapshot-diff.json'), snapshotDiff);

  const changeSummary = summarizeIterationChange(before.snapshot, evaluated.snapshot);
  await writeJsonArtifact(artifacts, 'change_summary', path.join(reportDir, 'change-summary.json'), changeSummary);

  let modelQa = null;
  if (validate_model !== false && validateModel !== false) {
    modelQa = await bridge.validate_model({
      snapshot: evaluated.snapshot,
      runtime,
      timeoutMs,
      spec: model_spec || modelSpec,
      includePreview,
      strictCollisions,
      strictUnanchored,
      floatingDetails
    });
    await writeJsonArtifact(artifacts, 'model_qa', path.join(reportDir, 'model-qa.json'), modelQa);
  }

  let referenceQa = null;
  if (validate_reference_model || validateReferenceModel || reference_spec || referenceSpec) {
    referenceQa = await bridge.validate_reference_model({
      snapshot: evaluated.snapshot,
      runtime,
      timeoutMs,
      spec: reference_spec || referenceSpec,
      includePreview
    });
    await writeJsonArtifact(artifacts, 'reference_qa', path.join(reportDir, 'reference-qa.json'), referenceQa);
  }

  let savedModel = null;
  if (save_model !== false && saveModel !== false) {
    savedModel = await bridge.save_model_version({
      path: save_path || savePath || path.join(reportDir, runtime === 'queue' ? 'model.skp' : 'model.json'),
      label: normalizedLabel,
      runtime,
      timeoutMs
    });
    artifacts.model = savedModel.file_path;
  }

  let captureResult = null;
  if ((capture_view || captureView || capture) && runtime === 'queue') {
    captureResult = await bridge.capture_view({
      ...(capture && typeof capture === 'object' ? capture : {}),
      path: path.join(reportDir, 'capture.png'),
      runtime,
      timeoutMs
    });
    artifacts.capture = captureResult.file_path;
    await writeJsonArtifact(artifacts, 'capture_metadata', path.join(reportDir, 'capture.json'), captureResult);
  }

  const finishedAt = new Date().toISOString();
  const manifest = {
    kind: 'model_iteration',
    version: MODEL_ITERATION_VERSION,
    iteration_id: iterationId,
    label: normalizedLabel,
    runtime,
    input_format: format,
    output_dir: reportDir,
    started_at: startedAt,
    finished_at: finishedAt,
    code_sha256: sha256Hex(iterationCode),
    resolved_code_sha256: resolvedInput.changed ? sha256Hex(evaluationCode) : undefined,
    artifacts,
    target_resolution: resolutionSummary(targetResolution),
    target_selection: selectedTargets ? selectionSummary(selectedTargets.selection) : selectionSummary(before.selection),
    before: {
      model_info: before.model_info,
      selection: selectionSummary(before.selection)
    },
    after: {
      model_info: modelInfoFromSnapshot(evaluated.snapshot, { runtime }),
      selection: selectionSummary(evaluated.snapshot.selection || [])
    },
    change_summary: changeSummary,
    snapshot_diff: diffSummary(snapshotDiff),
    model_qa: qaSummary(modelQa),
    reference_qa: qaSummary(referenceQa),
    saved_model: savedModel,
    capture: captureResult,
    modification_intent: intentSummary(suppliedIntent),
    evaluation: {
      compatibility_mode: evaluated.compatibility_mode,
      executed: evaluated.executed,
      blocked: evaluated.blocked,
      compiled: evaluated.compiled ? {
        operations: evaluated.compiled.document?.operations?.length ?? evaluated.compiled.python_sdk?.operations ?? evaluated.compiled.expert?.operations,
        compiler: evaluated.compiled.python_sdk?.compiler_version || evaluated.compiled.expert?.compiler_version || null
      } : null,
      result: evaluated.compiled?.result
    },
    nested_edit: nestedBeforeAdoption ? nestedEditSummary(nestedBeforeAdoption, nestedAfterAdoption, selectedReferences) : null
  };
  await writeJsonArtifact(artifacts, 'manifest', path.join(reportDir, 'manifest.json'), manifest);
  return manifest;
}

export function summarizeIterationChange(beforeSnapshot, afterSnapshot) {
  const beforeTotals = beforeSnapshot?.totals || {};
  const afterTotals = afterSnapshot?.totals || {};
  const beforeEntities = entityIndex(beforeSnapshot);
  const afterEntities = entityIndex(afterSnapshot);
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, entity] of afterEntities) {
    if (!beforeEntities.has(key)) {
      added.push(entitySummary(entity));
      continue;
    }
    const beforeEntity = beforeEntities.get(key);
    const fields = changedFields(beforeEntity, entity);
    if (fields.length) changed.push({ ...entitySummary(entity), changed_fields: fields });
  }
  for (const [key, entity] of beforeEntities) {
    if (!afterEntities.has(key)) removed.push(entitySummary(entity));
  }

  return {
    totals_delta: deltaTotals(beforeTotals, afterTotals),
    bounding_box_delta: bboxDelta(beforeSnapshot?.bounding_box, afterSnapshot?.bounding_box),
    added,
    removed,
    changed,
    entity_counts: {
      before: beforeEntities.size,
      after: afterEntities.size,
      added: added.length,
      removed: removed.length,
      changed: changed.length
    },
    warning_delta: deltaWarningSummary(beforeSnapshot?.warning_summary, afterSnapshot?.warning_summary)
  };
}

function entityIndex(snapshot = {}) {
  const entries = new Map();
  const items = [
    ...(snapshot.groups || []).map((item) => ({ ...item, entity_type: 'group' })),
    ...(snapshot.instances || []).map((item) => ({ ...item, entity_type: 'component_instance' }))
  ];
  for (const item of items) {
    entries.set(entityKey(item), item);
  }
  return entries;
}

function entityKey(item) {
  if (item.id) return `${item.entity_type || 'entity'}:id:${item.id}`;
  if (item.persistent_id) return `${item.entity_type || 'entity'}:persistent:${item.persistent_id}`;
  return `${item.entity_type || 'entity'}:name:${item.name}`;
}

function entitySummary(entity) {
  return {
    id: entity.id,
    persistent_id: entity.persistent_id,
    name: entity.name,
    entity_type: entity.entity_type,
    kind: entity.kind || entity.definition || entity.entity_type,
    material: entity.material,
    tag: entity.tag,
    visible: entity.visible !== false,
    faces: entity.faces,
    edges: entity.edges,
    bounding_box: entity.bounding_box
  };
}

function changedFields(before, after) {
  const fields = [];
  for (const field of ['name', 'kind', 'definition', 'material', 'tag', 'visible', 'faces', 'edges']) {
    if (stableJson(before[field]) !== stableJson(after[field])) fields.push(field);
  }
  if (stableJson(before.bounding_box) !== stableJson(after.bounding_box)) fields.push('bounding_box');
  if (stableJson(before.classification) !== stableJson(after.classification)) fields.push('classification');
  if (stableJson(before.texture_transform) !== stableJson(after.texture_transform)) fields.push('texture_transform');
  if (stableJson(before.face_uvs) !== stableJson(after.face_uvs)) fields.push('face_uvs');
  return fields;
}

function deltaTotals(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const result = {};
  for (const key of keys) result[key] = Number(after[key] || 0) - Number(before[key] || 0);
  return result;
}

function bboxDelta(before, after) {
  if (!before || !after) return null;
  return {
    w: Number(after.w || 0) - Number(before.w || 0),
    d: Number(after.d || 0) - Number(before.d || 0),
    h: Number(after.h || 0) - Number(before.h || 0)
  };
}

function deltaWarningSummary(before = {}, after = {}) {
  return {
    total: Number(after.total || 0) - Number(before.total || 0),
    errors: Number(after.by_severity?.error || 0) - Number(before.by_severity?.error || 0),
    warnings: Number(after.by_severity?.warn || 0) - Number(before.by_severity?.warn || 0),
    info: Number(after.by_severity?.info || 0) - Number(before.by_severity?.info || 0)
  };
}

function diffSummary(report) {
  if (!report) return null;
  return {
    ok: report.ok,
    verdict: report.verdict,
    level: report.level,
    summary: report.summary,
    top_issues: report.top_issues || [],
    recommendations: report.recommendations || []
  };
}

function qaSummary(report) {
  if (!report) return null;
  return {
    ok: report.ok,
    verdict: report.verdict,
    level: report.level,
    issue_count: report.summary?.total ?? report.issues?.length ?? 0,
    errors: report.summary?.by_severity?.error,
    warnings: report.summary?.by_severity?.warn
  };
}

function selectionSummary(selection = []) {
  return (selection || []).map((item) => ({
    id: item.id,
    name: item.name,
    entity_type: item.entity_type,
    kind: item.kind,
    entity_path: item.entity_path,
    edit_scope: item.edit_scope,
    instance_policy: item.instance_policy,
    instance_id: item.instance_id
  }));
}

function selectionReference(item = {}) {
  return {
    id: item.id,
    ...(item.name ? { name: item.name } : {}),
    ...(item.entity_path ? { entity_path: item.entity_path } : {}),
    ...(item.edit_scope ? { edit_scope: item.edit_scope } : {}),
    ...(item.instance_policy ? { instance_policy: item.instance_policy } : {}),
    ...(item.instance_id ? { instance_id: item.instance_id } : {})
  };
}

function intentSummary(intent) {
  if (!intent) return null;
  return {
    kind: intent.kind,
    version: intent.version,
    intent_id: intent.intent_id,
    action: intent.action,
    ok: intent.ok,
    safe_to_execute: intent.safe_to_execute,
    requires_confirmation: intent.requires_confirmation,
    confidence: intent.confidence,
    patch_sha256: intent.patch_sha256,
    target_count: intent.targets?.length || 0,
    proposed_action_count: intent.proposed_actions?.length || 0
  };
}

function isCurrentSelectionTarget(targets) {
  if (typeof targets === 'string') return ['$selection', 'selection', 'selected', 'current_selection'].includes(targets);
  if (Array.isArray(targets) && targets.length === 1) return isCurrentSelectionTarget(targets[0]);
  return targets && typeof targets === 'object' && targets.selection === true;
}

function resolvePatchInput(code, format, selectedReferences = []) {
  const normalizedFormat = String(format || 'auto').toLowerCase();
  if (!['auto', 'json_dsl'].includes(normalizedFormat) || !selectedReferences.length) {
    return { code, changed: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(code);
  } catch (_) {
    return { code, changed: false };
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.operations)) {
    return { code, changed: false };
  }
  const primary = referenceValue(selectedReferences[0]);
  const all = selectedReferences.map(referenceValue).filter(Boolean);
  if (!primary || !all.length) return { code, changed: false };
  const replaced = replaceTargetPlaceholders(parsed, primary, all);
  if (!replaced.changed) return { code, changed: false };
  return {
    code: `${JSON.stringify(replaced.value, null, 2)}\n`,
    changed: true,
    document: replaced.value
  };
}

function replaceTargetPlaceholders(value, primary, all) {
  if (typeof value === 'string') {
    if (value === '$target' || value === '$selection') return { value: primary, changed: true };
    if (value === '$targets') return { value: all, changed: true };
    return { value, changed: false };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const result = [];
    for (const item of value) {
      if (item === '$targets') {
        result.push(...all);
        changed = true;
        continue;
      }
      const replaced = replaceTargetPlaceholders(item, primary, all);
      result.push(replaced.value);
      changed = changed || replaced.changed;
    }
    return { value: result, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const replaced = replaceTargetPlaceholders(item, primary, all);
      result[key] = replaced.value;
      changed = changed || replaced.changed;
    }
    return { value: result, changed };
  }
  return { value, changed: false };
}

function referenceValue(reference) {
  if (typeof reference === 'string') return reference;
  return reference?.entity_path || reference?.entityPath || reference?.id || reference?.target_id || reference?.targetId || reference?.name || null;
}

function hasNestedEntityTargets(targets) {
  if (targets === undefined || targets === null) return false;
  const list = Array.isArray(targets) ? targets : [targets];
  const nested = list.filter((item) => item && typeof item === 'object' && (item.entity_path || item.entityPath));
  if (nested.length && nested.length !== list.length) throw new Error('iterate_model cannot mix nested entity_path targets with top-level selection targets');
  return nested.length > 0;
}

function normalizeNestedEntityTargets(targets) {
  const list = Array.isArray(targets) ? targets : [targets];
  return list.map((item, index) => {
    const entityPath = item.entity_path || item.entityPath;
    const editScope = item.edit_scope || item.editScope;
    const instancePolicy = item.instance_policy || item.instancePolicy;
    const instanceId = item.instance_id || item.instanceId;
    if (editScope !== 'component_definition') throw new Error(`iterate_model.targets[${index}].edit_scope must be component_definition`);
    if (!['definition_wide', 'make_unique'].includes(instancePolicy)) {
      throw new Error(`iterate_model.targets[${index}].instance_policy must be definition_wide or make_unique`);
    }
    if (instancePolicy === 'make_unique' && !instanceId) throw new Error(`iterate_model.targets[${index}].instance_id is required for make_unique`);
    return {
      entity_path: String(entityPath),
      edit_scope: editScope,
      instance_policy: instancePolicy,
      ...(instanceId ? { instance_id: String(instanceId) } : {})
    };
  });
}

function nestedEditSummary(before, after, references) {
  const beforeIndex = new Map((before?.recursive_index || []).filter((entry) => entry.entity_path).map((entry) => [entry.entity_path, entry]));
  const afterEntries = after?.recursive_index || [];
  return {
    target_count: references.length,
    editable_nested_before: before?.editable_nested_count || 0,
    editable_nested_after: after?.editable_nested_count || 0,
    targets: references.map((reference) => {
      const beforeEntry = beforeIndex.get(reference.entity_path) || null;
      const matchingAfter = afterEntries.find((entry) => entry.entity_path === reference.entity_path)
        || afterEntries.find((entry) => entry.reference && entry.reference === beforeEntry?.reference)
        || null;
      return {
        ...reference,
        before: beforeEntry,
        after: matchingAfter
      };
    })
  };
}

function resolutionSummary(resolution) {
  if (!resolution) return null;
  return {
    ok: resolution.ok,
    query: resolution.query,
    strategy: resolution.strategy,
    requires_confirmation: resolution.requires_confirmation,
    candidate_count: resolution.candidate_count,
    selected_targets: resolution.selected_targets || []
  };
}

async function writeJsonArtifact(artifacts, key, filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  artifacts[key] = filePath;
}

function inputExtension(format) {
  if (format === 'python_sdk') return 'input.python';
  if (format === 'restricted_expert' || format === 'expert') return 'input.expert.js';
  return 'input.dsl.json';
}

function resolvedInputPath(format, reportDir) {
  if (format === 'python_sdk') return path.join(reportDir, 'resolved-input.python');
  if (format === 'restricted_expert' || format === 'expert') return path.join(reportDir, 'resolved-input.expert.js');
  return path.join(reportDir, 'resolved-input.dsl.json');
}

function safeLabel(value) {
  return String(value || 'iteration').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'iteration';
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(sortJsonValue(value ?? null));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortJsonValue(item)]));
}
