const TARGET_KINDS = new Set(['feature_mapping_plan', 'part_graph', 'safe_json_dsl']);

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
    recipe_id: recipe.id,
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

  return { featureMappingPlan, report };
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
  return {
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
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
