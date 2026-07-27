const TARGET_KINDS = new Set(['feature_mapping_plan', 'part_graph', 'safe_json_dsl']);
const PATCHABLE_PART_GRAPH_PATHS = [
  /^parts\[[^\]]+\]\.shape\.parameters\./,
  /^parts\[[^\]]+\]\.feature_intents$/
];
const REPORT_SHAPE = 'parametric_recipe_compile_report_v1';

export function compileParametricRecipe(recipe = {}, options = {}) {
  if (!recipe || typeof recipe !== 'object') throw new Error('ParametricRecipe must be an object');
  const partGraph = options.partGraph || null;
  const parameterMap = buildParameterMap(recipe.parameters || []);
  const partKeyMap = buildPartKeyMap(recipe.part_keys || [], partGraph, recipe.profile_id);
  const nodeMap = buildNodeMap(recipe.feature_mapping_graph?.nodes || [], partKeyMap, parameterMap);
  const variationPoints = normalizeVariationPoints(recipe.variation_points || [], nodeMap, partKeyMap, parameterMap);
  const compileTarget = normalizeCompileTarget(recipe.compile?.target || {});
  const batchPolicy = normalizeBatchPolicy(recipe.compile?.batch || {}, parameterMap);
  const executionOrder = topologicalSort(nodeMap);
  const candidate = resolveCandidate(batchPolicy, options.candidateId);
  enforceFirstOutputDiscipline(batchPolicy, candidate, options.firstOutputReport);

  const featureMappingPlan = {
    version: recipe.version || 1,
    artifact: 'FeatureMappingPlan',
    recipe_id: recipe.id,
    recipe_name: recipe.name,
    profile_id: recipe.profile_id,
    units: recipe.units || 'mm',
    source_artifacts: clone(recipe.source_artifacts || {}),
    downstream_target_kind: compileTarget.kind,
    parameter_defaults: Object.fromEntries([...parameterMap.values()].map((parameter) => [parameter.id, clone(parameter.default)])),
    part_keys: [...partKeyMap.values()].map((entry) => entry.plan_summary),
    graph: {
      execution_order: executionOrder,
      nodes: executionOrder.map((nodeId) => compileNode(nodeMap.get(nodeId)))
    },
    variation_points: variationPoints,
    batch: clone(batchPolicy),
    summary: {
      parameter_count: parameterMap.size,
      part_key_count: partKeyMap.size,
      node_count: nodeMap.size,
      variation_point_count: variationPoints.length,
      fanout_count: batchPolicy.fanout.length,
      first_output_required: batchPolicy.mode === 'first_output_then_fanout'
    }
  };

  const report = {
    ok: true,
    verdict: 'pass',
    version: 1,
    artifact: 'ParametricRecipeCompileReport',
    report_shape: REPORT_SHAPE,
    recipe_id: recipe.id,
    candidate_id: candidate.id,
    emitted_artifact: 'FeatureMappingPlan',
    downstream_target_kind: compileTarget.kind,
    summary: {
      execution_order: executionOrder,
      first_output_candidate: batchPolicy.first_output?.candidate_id || null,
      fanout_count: batchPolicy.fanout.length,
      required_artifacts: batchPolicy.first_output?.required_artifacts || ['feature_mapping_plan'],
      target_kind: compileTarget.kind
    }
  };

  const partGraphPatch = partGraph
    ? buildPartGraphCorrectionPatch({
      recipe,
      partGraph,
      parameterMap,
      partKeyMap,
      nodeMap,
      executionOrder,
      candidate
    })
    : null;

  return { featureMappingPlan, report, partGraphPatch };
}

export function compileParametricRecipeCandidate(recipe = {}, options = {}) {
  const { featureMappingPlan, report, partGraphPatch } = compileParametricRecipe(recipe, options);
  const partGraph = options.partGraph || null;
  const profile = options.profile || null;
  const appliedPartGraph = partGraph && partGraphPatch
    ? applyPartGraphCorrectionPatch(partGraph, partGraphPatch).partGraph
    : null;
  const safeJsonDsl = appliedPartGraph && profile && typeof options.compilePartGraphToSketchUpDsl === 'function'
    ? options.compilePartGraphToSketchUpDsl(appliedPartGraph, profile, options.compileOptions || {})
    : null;
  return {
    featureMappingPlan,
    report: {
      ...report,
      summary: {
        ...report.summary,
        patch_edits: partGraphPatch?.edits?.length || 0,
        skipped_bindings: partGraphPatch?.metadata?.skipped_bindings?.length || 0,
        emitted_artifacts: [
          'feature_mapping_plan',
          'compile_report',
          ...(partGraphPatch ? ['part_graph_correction_patch'] : []),
          ...(appliedPartGraph ? ['part_graph'] : []),
          ...(safeJsonDsl ? ['safe_json_dsl'] : [])
        ]
      }
    },
    partGraphPatch,
    appliedPartGraph,
    safeJsonDsl
  };
}

export function compileParametricRecipeFirstOutput(recipe = {}, options = {}) {
  const batch = recipe.compile?.batch || {};
  const firstOutputId = batch.first_output?.candidate_id;
  if (!firstOutputId) throw new Error('ParametricRecipe compile.batch.first_output.candidate_id is required');
  return compileParametricRecipeCandidate(recipe, {
    ...options,
    candidateId: firstOutputId
  });
}

export function applyPartGraphCorrectionPatch(partGraph = {}, patch = {}) {
  if (patch.kind !== 'part_graph_correction_patch') {
    throw new Error('PartGraph correction patch kind must be part_graph_correction_patch');
  }
  const next = clone(partGraph);
  const applied = [];
  for (const edit of patch.edits || []) {
    if (edit.action !== 'set') continue;
    assertPatchPathAllowed(edit.path);
    setPathValue(next, edit.path, edit.value);
    const part = partById(next, edit.part_id || partIdFromPath(edit.path));
    if (part) {
      part.evidence_status = edit.mark_evidence_status || part.evidence_status || 'inferred';
      part.evidence_sources = [
        ...(part.evidence_sources || []),
        {
          kind: 'parametric_recipe',
          status: edit.mark_evidence_status || part.evidence_status || 'inferred',
          confidence: edit.confidence,
          note: `${edit.rule_id || 'parametric_recipe'}: ${edit.reason}`
        }
      ];
      part.qa = {
        ...(part.qa || {}),
        parametric_recipe_applied: true,
        parametric_recipe_candidate_id: patch.metadata?.candidate_id || null,
        last_correction_rule: edit.rule_id || null
      };
    }
    applied.push(edit);
  }
  next.review = {
    ...(next.review || {}),
    correction_patches_applied: [
      ...(next.review?.correction_patches_applied || []),
      {
        source: patch.source || 'parametric_recipe',
        edits: applied.length,
        target_part_graph_id: patch.target_part_graph_id || next.id,
        recipe_id: patch.metadata?.recipe_id || null,
        candidate_id: patch.metadata?.candidate_id || null
      }
    ]
  };
  return { partGraph: next, applied };
}

function buildParameterMap(parameters) {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    throw new Error('ParametricRecipe parameters must include at least one entry');
  }
  const map = new Map();
  for (const parameter of parameters) {
    if (!parameter?.id) throw new Error('ParametricRecipe parameter.id is required');
    if (map.has(parameter.id)) throw new Error(`Duplicate ParametricRecipe parameter id: ${parameter.id}`);
    map.set(parameter.id, clone(parameter));
  }
  return map;
}

function buildPartKeyMap(partKeys, partGraph, profileId) {
  if (!Array.isArray(partKeys) || partKeys.length === 0) {
    throw new Error('ParametricRecipe part_keys must include at least one entry');
  }
  const partsById = partGraph ? new Map((partGraph.parts || []).map((part) => [part.id, part])) : null;
  if (partGraph?.profile_id && profileId && partGraph.profile_id !== profileId) {
    throw new Error(`ParametricRecipe profile_id ${profileId} does not match PartGraph profile_id ${partGraph.profile_id}`);
  }
  const map = new Map();
  for (const partKey of partKeys) {
    if (!partKey?.key) throw new Error('ParametricRecipe part_keys[].key is required');
    if (map.has(partKey.key)) throw new Error(`Duplicate ParametricRecipe part key: ${partKey.key}`);
    const partIds = Array.isArray(partKey.part_ids) ? [...partKey.part_ids] : [];
    if (partIds.length === 0) throw new Error(`ParametricRecipe part key ${partKey.key} must reference at least one part id`);
    const resolvedParts = [];
    if (partsById) {
      for (const partId of partIds) {
        const part = partsById.get(partId);
        if (!part) throw new Error(`ParametricRecipe part key ${partKey.key} references unknown PartGraph part ${partId}`);
        resolvedParts.push(part);
      }
    }
    map.set(partKey.key, {
      source: clone(partKey),
      plan_summary: {
        key: partKey.key,
        part_ids: partIds,
        description: partKey.description || '',
        resolved_roles: [...new Set(resolvedParts.map((part) => part.role).filter(Boolean))],
        evidence_statuses: [...new Set(resolvedParts.map((part) => part.evidence_status).filter(Boolean))],
        fallback_states: [...new Set(resolvedParts.map((part) => part.fallback_state).filter(Boolean))]
      }
    });
  }
  return map;
}

function buildNodeMap(nodes, partKeyMap, parameterMap) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('ParametricRecipe feature_mapping_graph.nodes must include at least one node');
  }
  const map = new Map();
  for (const node of nodes) {
    if (!node?.id) throw new Error('ParametricRecipe node.id is required');
    if (map.has(node.id)) throw new Error(`Duplicate ParametricRecipe node id: ${node.id}`);
    for (const key of node.part_keys || []) {
      if (!partKeyMap.has(key)) throw new Error(`ParametricRecipe node ${node.id} references unknown part key ${key}`);
    }
    for (const binding of node.parameter_bindings || []) {
      if (!parameterMap.has(binding.parameter_id)) {
        throw new Error(`ParametricRecipe node ${node.id} references unknown parameter ${binding.parameter_id}`);
      }
    }
    for (const output of node.outputs || []) {
      if (!TARGET_KINDS.has(output)) {
        throw new Error(`ParametricRecipe node ${node.id} declares unsupported output ${output}`);
      }
    }
    map.set(node.id, clone(node));
  }
  for (const node of map.values()) {
    for (const dependency of node.depends_on || []) {
      if (!map.has(dependency)) throw new Error(`ParametricRecipe node ${node.id} depends on unknown node ${dependency}`);
    }
  }
  return map;
}

function normalizeVariationPoints(variationPoints, nodeMap, partKeyMap, parameterMap) {
  const normalized = [];
  const ids = new Set();
  for (const variationPoint of variationPoints) {
    if (!variationPoint?.id) throw new Error('ParametricRecipe variation_points[].id is required');
    if (ids.has(variationPoint.id)) throw new Error(`Duplicate ParametricRecipe variation point id: ${variationPoint.id}`);
    ids.add(variationPoint.id);
    for (const parameterId of variationPoint.parameter_ids || []) {
      if (!parameterMap.has(parameterId)) {
        throw new Error(`ParametricRecipe variation point ${variationPoint.id} references unknown parameter ${parameterId}`);
      }
    }
    for (const nodeId of variationPoint.node_ids || []) {
      if (!nodeMap.has(nodeId)) throw new Error(`ParametricRecipe variation point ${variationPoint.id} references unknown node ${nodeId}`);
    }
    for (const partKey of variationPoint.part_keys || []) {
      if (!partKeyMap.has(partKey)) throw new Error(`ParametricRecipe variation point ${variationPoint.id} references unknown part key ${partKey}`);
    }
    normalized.push(clone(variationPoint));
  }
  for (const node of nodeMap.values()) {
    for (const variationPointId of node.variation_points || []) {
      if (!ids.has(variationPointId)) {
        throw new Error(`ParametricRecipe node ${node.id} references unknown variation point ${variationPointId}`);
      }
    }
  }
  return normalized;
}

function normalizeCompileTarget(target) {
  if (!target?.kind) throw new Error('ParametricRecipe compile.target.kind is required');
  if (!TARGET_KINDS.has(target.kind)) {
    throw new Error(`ParametricRecipe compile target kind must be one of ${[...TARGET_KINDS].join(', ')}`);
  }
  return clone(target);
}

function normalizeBatchPolicy(batch, parameterMap) {
  const mode = batch.mode || 'single_output';
  if (!['single_output', 'first_output_then_fanout'].includes(mode)) {
    throw new Error(`ParametricRecipe batch mode ${mode} is not supported`);
  }
  const fanout = Array.isArray(batch.fanout) ? batch.fanout.map((candidate) => clone(candidate)) : [];
  const candidateIds = new Set();
  for (const candidate of fanout) {
    if (!candidate?.id) throw new Error('ParametricRecipe batch fanout candidate id is required');
    if (candidateIds.has(candidate.id)) throw new Error(`Duplicate ParametricRecipe fanout candidate id: ${candidate.id}`);
    candidateIds.add(candidate.id);
    for (const parameterId of Object.keys(candidate.parameter_overrides || {})) {
      if (!parameterMap.has(parameterId)) {
        throw new Error(`ParametricRecipe fanout candidate ${candidate.id} overrides unknown parameter ${parameterId}`);
      }
    }
  }
  const firstOutput = batch.first_output ? clone(batch.first_output) : null;
  if (mode === 'first_output_then_fanout') {
    if (!firstOutput) throw new Error('ParametricRecipe batch.first_output is required for first_output_then_fanout mode');
    if (!candidateIds.has(firstOutput.candidate_id)) {
      throw new Error(`ParametricRecipe first_output candidate ${firstOutput.candidate_id} is not present in batch fanout`);
    }
    const requiredArtifacts = new Set(firstOutput.required_artifacts || []);
    if (!requiredArtifacts.has('feature_mapping_plan') || !requiredArtifacts.has('compile_report')) {
      throw new Error('ParametricRecipe first_output must require feature_mapping_plan and compile_report artifacts');
    }
  }
  return {
    mode,
    first_output: firstOutput,
    fanout
  };
}

function resolveCandidate(batchPolicy, candidateId) {
  const candidates = batchPolicy.fanout || [];
  if (candidates.length === 0) {
    return { id: 'single_output', label: 'Single output', parameter_overrides: {} };
  }
  const selectedId = candidateId || batchPolicy.first_output?.candidate_id || candidates[0]?.id;
  const candidate = candidates.find((item) => item.id === selectedId);
  if (!candidate) throw new Error(`ParametricRecipe candidate ${selectedId} is not present in batch fanout`);
  return clone(candidate);
}

function enforceFirstOutputDiscipline(batchPolicy, candidate, firstOutputReport) {
  if (batchPolicy.mode !== 'first_output_then_fanout') return;
  const firstOutputId = batchPolicy.first_output?.candidate_id;
  if (candidate.id === firstOutputId) return;
  const reportShape = firstOutputReport?.report_shape || firstOutputReport?.summary?.required_report_shape;
  const reportCandidate = firstOutputReport?.candidate_id || firstOutputReport?.summary?.first_output_candidate;
  if (reportShape !== REPORT_SHAPE || reportCandidate !== firstOutputId || firstOutputReport?.ok !== true) {
    throw new Error(`ParametricRecipe candidate ${candidate.id} requires a passing first-output report for ${firstOutputId}`);
  }
}

function buildPartGraphCorrectionPatch({ recipe, partGraph, parameterMap, partKeyMap, nodeMap, executionOrder, candidate }) {
  const parameterValues = resolveParameterValues(parameterMap, candidate);
  const edits = [];
  const skippedBindings = [];
  for (const nodeId of executionOrder) {
    const node = nodeMap.get(nodeId);
    for (const binding of node.parameter_bindings || []) {
      const current = getPathValue(partGraph, binding.target);
      const parameterValue = parameterValues[binding.parameter_id];
      if (!isPatchPathAllowed(binding.target)) {
        skippedBindings.push({
          node_id: node.id,
          parameter_id: binding.parameter_id,
          target: binding.target,
          reason: 'target_not_in_part_graph_patch_whitelist'
        });
        continue;
      }
      const value = transformParameterValue(current, parameterValue, binding.transform || 'replace', binding.target, binding, parameterValues);
      if (sameJson(current, value)) {
        skippedBindings.push({
          node_id: node.id,
          parameter_id: binding.parameter_id,
          target: binding.target,
          reason: 'no_value_change'
        });
        continue;
      }
      const partId = partIdFromPath(binding.target);
      const edit = {
        action: 'set',
        path: binding.target,
        part_id: partId,
        reason: `${recipe.id} ${candidate.id} applies ${binding.parameter_id} through node ${node.id}`,
        issue_type: 'parametric_recipe_binding',
        rule_id: 'parametric_recipe_first_output',
        severity: candidate.id === recipe.compile?.batch?.first_output?.candidate_id ? 'info' : 'warn',
        confidence: 0.78,
        value,
        note: 'Generated from a reviewed ParametricRecipe binding; no open script execution was used.',
        evidence: {
          recipe_id: recipe.id,
          candidate_id: candidate.id,
          node_id: node.id,
          node_kind: node.kind,
          operation: node.operation,
          parameter_id: binding.parameter_id,
          transform: binding.transform || 'replace',
          part_keys: [...(node.part_keys || [])],
          part_ids: partIdsForNode(node, partKeyMap),
          variation_points: [...(node.variation_points || [])]
        },
        mark_evidence_status: 'manual_confirmed'
      };
      if (current !== undefined) edit.previous_value = current;
      edits.push(edit);
    }
  }
  return {
    version: 1,
    kind: 'part_graph_correction_patch',
    source: 'parametric_recipe',
    target_part_graph_id: partGraph.id,
    report_verdict: 'pass',
    edits,
    metadata: {
      recipe_id: recipe.id,
      candidate_id: candidate.id,
      report_shape: REPORT_SHAPE,
      skipped_bindings: skippedBindings,
      patch_path_policy: PATCHABLE_PART_GRAPH_PATHS.map((pattern) => pattern.source)
    }
  };
}

function resolveParameterValues(parameterMap, candidate) {
  const values = Object.fromEntries([...parameterMap.values()].map((parameter) => [parameter.id, clone(parameter.default)]));
  for (const [parameterId, value] of Object.entries(candidate.parameter_overrides || {})) {
    values[parameterId] = clone(value);
  }
  return values;
}

function transformParameterValue(current, parameterValue, transform, targetPath, binding = {}, parameterValues = {}) {
  const templatedValue = binding.value_template !== undefined
    ? resolveTemplate(binding.value_template, parameterValues)
    : binding.value !== undefined
      ? resolveTemplate(binding.value, parameterValues)
      : undefined;
  if (transform === 'replace') return clone(templatedValue !== undefined ? templatedValue : parameterValue);
  if (transform === 'append') {
    const currentItems = Array.isArray(current) ? clone(current) : [];
    const item = clone(templatedValue !== undefined ? templatedValue : parameterValue);
    if (item?.id) {
      const existingIndex = currentItems.findIndex((existing) => existing?.id === item.id);
      if (existingIndex >= 0) currentItems[existingIndex] = item;
      else currentItems.push(item);
      return currentItems;
    }
    return [...currentItems, item];
  }
  if (transform === 'add') {
    if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(parameterValue))) {
      throw new Error(`ParametricRecipe add transform requires numeric current and parameter values for ${targetPath}`);
    }
    return round(Number(current) + Number(parameterValue), 6);
  }
  if (transform === 'multiply') {
    if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(parameterValue))) {
      throw new Error(`ParametricRecipe multiply transform requires numeric current and parameter values for ${targetPath}`);
    }
    return round(Number(current) * Number(parameterValue), 6);
  }
  throw new Error(`Unsupported ParametricRecipe transform ${transform}`);
}

function resolveTemplate(value, parameterValues) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplate(item, parameterValues));
  if (!value || typeof value !== 'object') return clone(value);
  if (Object.keys(value).length === 1 && typeof value.$parameter === 'string') {
    if (!(value.$parameter in parameterValues)) throw new Error(`Unknown ParametricRecipe template parameter ${value.$parameter}`);
    return clone(parameterValues[value.$parameter]);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplate(item, parameterValues)]));
}

function partIdsForNode(node, partKeyMap) {
  const ids = [];
  for (const key of node.part_keys || []) {
    ids.push(...(partKeyMap.get(key)?.source?.part_ids || []));
  }
  return [...new Set(ids)];
}

function isPatchPathAllowed(targetPath) {
  return PATCHABLE_PART_GRAPH_PATHS.some((pattern) => pattern.test(String(targetPath)));
}

function assertPatchPathAllowed(targetPath) {
  if (!isPatchPathAllowed(targetPath)) {
    throw new Error(`ParametricRecipe patch target is outside the allowed PartGraph paths: ${targetPath}`);
  }
}

function topologicalSort(nodeMap) {
  const indegree = new Map();
  const outgoing = new Map();
  for (const [nodeId, node] of nodeMap.entries()) {
    indegree.set(nodeId, 0);
    outgoing.set(nodeId, []);
  }
  for (const [nodeId, node] of nodeMap.entries()) {
    for (const dependency of node.depends_on || []) {
      outgoing.get(dependency).push(nodeId);
      indegree.set(nodeId, indegree.get(nodeId) + 1);
    }
  }

  const queue = [...nodeMap.keys()].filter((nodeId) => indegree.get(nodeId) === 0);
  const order = [];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    order.push(nodeId);
    for (const target of outgoing.get(nodeId)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (order.length !== nodeMap.size) {
    throw new Error('ParametricRecipe feature_mapping_graph contains a cycle');
  }
  return order;
}

function compileNode(node) {
  const compiled = {
    id: node.id,
    kind: node.kind,
    operation: node.operation,
    part_keys: [...(node.part_keys || [])],
    depends_on: [...(node.depends_on || [])],
    parameter_bindings: (node.parameter_bindings || []).map((binding) => clone(binding)),
    variation_points: [...(node.variation_points || [])],
    outputs: [...(node.outputs || [])],
    notes: node.notes || ''
  };
  for (const binding of compiled.parameter_bindings) {
    const original = (node.parameter_bindings || []).find((item) => item.parameter_id === binding.parameter_id && item.target === binding.target);
    if (original?.value_template !== undefined) binding.value_template = clone(original.value_template);
    if (original?.value !== undefined) binding.value = clone(original.value);
  }
  return compiled;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getPathValue(document, targetPath) {
  return pathTokens(targetPath).reduce((current, token) => {
    if (current === undefined || current === null) return undefined;
    if (token.collection === 'parts') return partById(current, token.id);
    if (token.index !== undefined) return current[token.index];
    return current[token];
  }, document);
}

function setPathValue(document, targetPath, value) {
  const tokens = pathTokens(targetPath);
  const last = tokens.pop();
  const parent = tokens.reduce((current, token, index) => {
    const nextToken = tokens[index + 1] || last;
    if (token.collection === 'parts') return partById(current, token.id);
    if (token.index !== undefined) {
      if (!Array.isArray(current)) throw new Error(`Expected array while setting PartGraph path: ${targetPath}`);
      if (current[token.index] === undefined) current[token.index] = nextToken?.index !== undefined ? [] : {};
      return current[token.index];
    }
    if (!current[token] || typeof current[token] !== 'object') current[token] = nextToken?.index !== undefined ? [] : {};
    return current[token];
  }, document);
  if (last.collection === 'parts') throw new Error(`Unable to set PartGraph collection path: ${targetPath}`);
  if (last.index !== undefined) {
    if (!Array.isArray(parent)) throw new Error(`Expected array parent while setting PartGraph path: ${targetPath}`);
    parent[last.index] = clone(value);
    return;
  }
  if (!parent || typeof last !== 'string') throw new Error(`Unable to set PartGraph path: ${targetPath}`);
  parent[last] = clone(value);
}

function pathTokens(targetPath) {
  const tokens = [];
  for (const token of String(targetPath).split('.')) {
    const partMatch = token.match(/^parts\[([^\]]+)\]$/);
    if (partMatch) {
      tokens.push({ collection: 'parts', id: partMatch[1] });
      continue;
    }
    const match = token.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (!match) throw new Error(`Unsupported PartGraph path token: ${token}`);
    tokens.push(match[1]);
    if (match[2] !== undefined) tokens.push({ index: Number(match[2]) });
  }
  return tokens;
}

function partById(root, id) {
  const parts = Array.isArray(root) ? root : root?.parts;
  return parts?.find((part) => part.id === id) || null;
}

function partIdFromPath(targetPath) {
  return String(targetPath).match(/parts\[([^\]]+)\]/)?.[1] || null;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
