import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { markUntrustedData, sha256Canonical } from './agent-contract.mjs';

export const DESIGN_INTENT_GRAPH_VERSION = 'design-intent-graph.v1';
export const DESIGN_PARAMETER_CHANGE_VERSION = 'design-parameter-change-plan.v1';
export const DESIGN_RECONCILIATION_VERSION = 'design-intent-reconciliation.v1';

export function buildDesignIntentGraph({
  modelGraph,
  parametricRecipe = {},
  featureMappingPlan = {},
  partGraph = {},
  entityBindings,
  correctionHistory = []
} = {}) {
  if (modelGraph?.version !== 'model-graph.v1') throw new Error('buildDesignIntentGraph requires ModelGraph v1');
  const parameters = normalizeParameters(parametricRecipe, featureMappingPlan);
  const bindings = normalizeBindings(entityBindings || featureMappingPlan.entity_bindings || partGraph.entity_bindings || [], modelGraph);
  const relationships = buildRelationships(bindings);
  const bidirectional = buildBidirectionalIndexes(bindings);
  const artifacts = {
    parametric_recipe: artifactRef(parametricRecipe),
    feature_mapping_plan: artifactRef(featureMappingPlan),
    part_graph: artifactRef(partGraph)
  };
  const core = {
    version: DESIGN_INTENT_GRAPH_VERSION,
    kind: 'design_intent_graph',
    source_model_graph_id: modelGraph.graph_id,
    model_revision: modelGraph.model_revision,
    artifacts,
    parameters,
    bindings,
    relationships,
    bidirectional,
    correction_history: structuredClone(correctionHistory),
    divergence_policy: 'review_required_no_silent_overwrite',
    untrusted_data_fields: ['model_entity_name', 'material', 'tag', 'classification', 'attributes', 'ocr']
  };
  return {
    ...core,
    design_graph_id: `design-graph-${sha256Canonical(core).slice(7, 31)}`,
    stats: {
      parameters: Object.keys(parameters).length,
      bindings: bindings.length,
      mapped_entities: new Set(bindings.map((binding) => binding.entity_node_id)).size,
      correction_events: correctionHistory.length
    }
  };
}

export function planDesignParameterChange({ designGraph, currentModelGraph, changes, instruction = 'Modify reviewed design parameters.' } = {}) {
  if (designGraph?.version !== DESIGN_INTENT_GRAPH_VERSION) throw new Error('planDesignParameterChange requires DesignIntentGraph v1');
  if (currentModelGraph?.version !== 'model-graph.v1') throw new Error('planDesignParameterChange requires current ModelGraph v1');
  const normalizedChanges = normalizeChanges(changes, designGraph.parameters);
  const divergence = compareBindingFingerprints(designGraph, currentModelGraph);
  if (divergence.length) {
    return blockedChangePlan(designGraph, currentModelGraph, normalizedChanges, divergence, instruction);
  }

  const changedParameterIds = Object.keys(normalizedChanges);
  const initialBindings = designGraph.bindings.filter((binding) => binding.parameter_bindings.some((item) => changedParameterIds.includes(item.parameter_id)));
  const affectedBindings = dependencyClosure(initialBindings, designGraph.bindings);
  const values = Object.fromEntries(Object.entries(designGraph.parameters).map(([id, parameter]) => [id, parameter.value]));
  Object.assign(values, normalizedChanges);
  const targets = uniqueTargets(affectedBindings.flatMap((binding) => binding.existing_targets));
  const operations = [];
  const eraseTargets = uniqueTargets(affectedBindings.filter((binding) => binding.erase_before_rebuild !== false).flatMap((binding) => binding.existing_targets));
  if (eraseTargets.length) operations.push({ op: 'erase_entities', targets: eraseTargets });
  for (const binding of affectedBindings) operations.push(...expandBindingOperations(binding, values));
  const affectedSubgraph = affectedBindings.map((binding) => ({
    binding_id: binding.binding_id,
    part_id: binding.part_id,
    feature_id: binding.feature_id,
    entity_node_id: binding.entity_node_id,
    persistent_ref: binding.persistent_ref,
    reasons: binding.parameter_bindings.filter((item) => changedParameterIds.includes(item.parameter_id)).map((item) => `parameter:${item.parameter_id}`),
    associated_bindings: binding.associated_binding_ids
  }));
  const core = {
    version: DESIGN_PARAMETER_CHANGE_VERSION,
    kind: 'design_parameter_change_plan',
    design_graph_id: designGraph.design_graph_id,
    source_model_graph_id: currentModelGraph.graph_id,
    model_revision: currentModelGraph.model_revision,
    instruction: markUntrustedData(instruction, 'agent_instruction'),
    changes: normalizedChanges,
    affected_subgraph: affectedSubgraph,
    targets,
    operations,
    risk_level: eraseTargets.length ? 'S4' : 'S3',
    divergence: [],
    blockers: operations.length ? [] : ['no_rebuild_operations'],
    execution_allowed: false,
    execution_route: 'trusted_reviewed_existing_model_edit_only'
  };
  return {
    ...core,
    change_plan_id: `design-change-${sha256Canonical(core).slice(7, 31)}`,
    next_action: operations.length ? {
      action: 'start_reviewed_existing_model_edit',
      tool: 'start_agent_task',
      arguments: {
        intent: 'reviewed_existing_model_edit',
        instruction,
        interface_level: 'guided',
        inputs: { runtime: 'mock', targets, operations }
      }
    } : { action: 'correct_design_mapping' }
  };
}

export function reconcileDesignIntentGraph({ designGraph, currentModelGraph, acceptedChangePlan = null } = {}) {
  if (designGraph?.version !== DESIGN_INTENT_GRAPH_VERSION) throw new Error('reconcileDesignIntentGraph requires DesignIntentGraph v1');
  if (currentModelGraph?.version !== 'model-graph.v1') throw new Error('reconcileDesignIntentGraph requires current ModelGraph v1');
  const differences = compareBindingFingerprints(designGraph, currentModelGraph);
  const acceptedBindingIds = new Set(acceptedChangePlan?.affected_subgraph?.map((item) => item.binding_id) || []);
  const expected = differences.filter((item) => acceptedBindingIds.has(item.binding_id));
  const unexpected = differences.filter((item) => !acceptedBindingIds.has(item.binding_id));
  const core = {
    version: DESIGN_RECONCILIATION_VERSION,
    kind: 'design_intent_reconciliation',
    design_graph_id: designGraph.design_graph_id,
    previous_model_revision: designGraph.model_revision,
    current_model_revision: currentModelGraph.model_revision,
    aligned: differences.length === 0,
    expected_changes: expected,
    unexpected_divergence: unexpected,
    review_required: unexpected.length > 0 || expected.length > 0,
    silent_overwrite_allowed: false,
    proposed_decisions: [
      ...(expected.length ? [{ decision: 'accept_reviewed_parameter_change', binding_ids: expected.map((item) => item.binding_id) }] : []),
      ...(unexpected.length ? [
        { decision: 'adopt_manual_edit', binding_ids: unexpected.map((item) => item.binding_id) },
        { decision: 'restore_design_intent', binding_ids: unexpected.map((item) => item.binding_id) }
      ] : [])
    ]
  };
  return {
    ...core,
    reconciliation_id: `reconciliation-${sha256Canonical(core).slice(7, 31)}`,
    next_action: core.review_required ? { action: 'request_user_reconciliation_review' } : null
  };
}

export function acceptReconciliation({ designGraph, currentModelGraph, reconciliation, decision, acceptedChangePlan = null } = {}) {
  if (reconciliation?.version !== DESIGN_RECONCILIATION_VERSION) throw new Error('acceptReconciliation requires a reconciliation artifact');
  if (!['accept_reviewed_parameter_change', 'adopt_manual_edit'].includes(decision)) throw new Error('acceptReconciliation decision is not supported');
  if (decision === 'adopt_manual_edit' && !reconciliation.unexpected_divergence.length) throw new Error('There is no manual divergence to adopt');
  const nodes = new Map(currentModelGraph.nodes.map((node) => [node.node_id, node]));
  const updatedBindings = designGraph.bindings.map((binding) => {
    const current = resolveCurrentNode(binding, currentModelGraph, nodes);
    return current ? { ...binding, baseline_fingerprint: entityFingerprint(current), entity_node_id: current.node_id } : binding;
  });
  const updatedParameters = structuredClone(designGraph.parameters);
  if (decision === 'accept_reviewed_parameter_change') {
    for (const [parameterId, value] of Object.entries(acceptedChangePlan?.changes || {})) {
      if (updatedParameters[parameterId]) updatedParameters[parameterId].value = value;
    }
  }
  const historyEvent = {
    event_id: `correction-${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    decision,
    reconciliation_id: reconciliation.reconciliation_id,
    change_plan_id: acceptedChangePlan?.change_plan_id || null,
    previous_model_revision: designGraph.model_revision,
    current_model_revision: currentModelGraph.model_revision
  };
  const core = {
    ...structuredClone(designGraph),
    source_model_graph_id: currentModelGraph.graph_id,
    model_revision: currentModelGraph.model_revision,
    parameters: updatedParameters,
    bindings: updatedBindings,
    correction_history: [...designGraph.correction_history, historyEvent]
  };
  core.bidirectional = buildBidirectionalIndexes(updatedBindings);
  core.stats = { ...core.stats, correction_events: core.correction_history.length };
  core.design_graph_id = `design-graph-${sha256Canonical({ ...core, design_graph_id: undefined }).slice(7, 31)}`;
  return core;
}

export async function writeDesignArtifact(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
  return filePath;
}

function normalizeParameters(recipe, mappingPlan) {
  const result = {};
  const source = Array.isArray(recipe.parameters) ? recipe.parameters : [];
  for (const parameter of source) {
    const id = String(parameter.id || parameter.parameter_id || parameter.name || '').trim();
    if (!id) continue;
    result[id] = {
      parameter_id: id,
      value: parameter.value ?? parameter.default ?? parameter.default_value ?? mappingPlan.parameter_defaults?.[id] ?? null,
      type: parameter.type || inferParameterType(parameter.value ?? parameter.default),
      unit: parameter.unit || parameter.units || null,
      minimum: parameter.minimum ?? parameter.min ?? null,
      maximum: parameter.maximum ?? parameter.max ?? null,
      enum: parameter.enum || parameter.values || null,
      description: parameter.description || null
    };
  }
  for (const [id, value] of Object.entries(mappingPlan.parameter_defaults || {})) {
    result[id] ||= { parameter_id: id, value, type: inferParameterType(value), unit: null, minimum: null, maximum: null, enum: null, description: null };
  }
  return result;
}

function normalizeBindings(rawBindings, modelGraph) {
  if (!Array.isArray(rawBindings) || rawBindings.length === 0) throw new Error('DesignIntentGraph requires entity_bindings');
  return rawBindings.map((binding, index) => {
    const persistentRef = normalizePersistentRef(binding.entity || binding.persistent_ref || binding.target);
    const node = findModelNode(modelGraph, persistentRef);
    if (!node) throw new Error(`entity_bindings[${index}] does not resolve in ModelGraph`);
    const parameterBindings = (binding.parameter_bindings || binding.parameters || []).map((item) => typeof item === 'string' ? { parameter_id: item } : structuredClone(item));
    return {
      binding_id: binding.binding_id || `binding-${index + 1}`,
      part_id: binding.part_id || null,
      feature_id: binding.feature_id || null,
      entity_node_id: node.node_id,
      persistent_ref: persistentRef,
      baseline_fingerprint: entityFingerprint(node),
      parameter_bindings: parameterBindings,
      associated_binding_ids: [...new Set(binding.associated_binding_ids || binding.associations || [])],
      existing_targets: uniqueTargets(binding.existing_targets || [persistentRef]),
      erase_before_rebuild: binding.erase_before_rebuild !== false,
      rebuild_template: structuredClone(binding.rebuild_template || []),
      repeat: binding.repeat ? structuredClone(binding.repeat) : null,
      lineage: structuredClone(binding.lineage || {})
    };
  });
}

function buildRelationships(bindings) {
  const result = [];
  for (const binding of bindings) {
    for (const parameter of binding.parameter_bindings) result.push({ type: 'parameter_controls_entity', from: `parameter:${parameter.parameter_id}`, to: `binding:${binding.binding_id}` });
    if (binding.part_id) result.push({ type: 'part_maps_to_entity', from: `part:${binding.part_id}`, to: `binding:${binding.binding_id}` });
    if (binding.feature_id) result.push({ type: 'feature_maps_to_entity', from: `feature:${binding.feature_id}`, to: `binding:${binding.binding_id}` });
    for (const associated of binding.associated_binding_ids) result.push({ type: 'associated_rebuild', from: `binding:${binding.binding_id}`, to: `binding:${associated}` });
  }
  return result;
}

function buildBidirectionalIndexes(bindings) {
  const designToEntities = {};
  const entityToDesign = {};
  for (const binding of bindings) {
    const entityKey = persistentRefKey(binding.persistent_ref);
    const designRefs = [
      ...(binding.part_id ? [`part:${binding.part_id}`] : []),
      ...(binding.feature_id ? [`feature:${binding.feature_id}`] : []),
      ...binding.parameter_bindings.map((item) => `parameter:${item.parameter_id}`)
    ];
    entityToDesign[entityKey] = [...new Set([...(entityToDesign[entityKey] || []), ...designRefs])];
    for (const designRef of designRefs) designToEntities[designRef] = [...new Set([...(designToEntities[designRef] || []), entityKey])];
  }
  return { design_to_entities: designToEntities, entity_to_design: entityToDesign };
}

function normalizeChanges(changes, parameters) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) throw new Error('changes must be a non-empty object');
  const result = {};
  for (const [id, value] of Object.entries(changes)) {
    const parameter = parameters[id];
    if (!parameter) throw new Error(`Unknown design parameter: ${id}`);
    if (parameter.enum && !parameter.enum.includes(value)) throw new Error(`${id} must be one of its enum values`);
    if (typeof value === 'number' && parameter.minimum !== null && value < parameter.minimum) throw new Error(`${id} is below minimum`);
    if (typeof value === 'number' && parameter.maximum !== null && value > parameter.maximum) throw new Error(`${id} is above maximum`);
    result[id] = value;
  }
  return result;
}

function dependencyClosure(initial, allBindings) {
  const byId = new Map(allBindings.map((binding) => [binding.binding_id, binding]));
  const selected = new Map(initial.map((binding) => [binding.binding_id, binding]));
  const queue = [...initial];
  while (queue.length) {
    const binding = queue.shift();
    for (const id of binding.associated_binding_ids) {
      const associated = byId.get(id);
      if (associated && !selected.has(id)) {
        selected.set(id, associated);
        queue.push(associated);
      }
    }
  }
  return [...selected.values()];
}

function expandBindingOperations(binding, values) {
  if (binding.repeat) {
    const count = Number(values[binding.repeat.count_parameter]);
    if (!Number.isInteger(count) || count < 0 || count > 1000) throw new Error(`Repeat count for ${binding.binding_id} must be an integer from 0 to 1000`);
    const result = [];
    for (let index = 0; index < count; index += 1) {
      for (const operation of binding.rebuild_template) result.push(resolveTemplate(operation, values, index, binding.repeat));
    }
    return result;
  }
  return binding.rebuild_template.map((operation) => resolveTemplate(operation, values, null, null));
}

function resolveTemplate(value, parameters, index, repeat) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplate(item, parameters, index, repeat));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && index !== null) return value.replaceAll('$index', String(index + (repeat?.index_base || 0)));
    return value;
  }
  if (Object.keys(value).length === 1 && value.$parameter) return parameters[value.$parameter];
  if (Object.keys(value).length === 1 && value.$index === true) return index + (repeat?.index_base || 0);
  if (value.$expression) return evaluateExpression(value.$expression, parameters, index, repeat);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplate(item, parameters, index, repeat)]));
}

function evaluateExpression(expression, parameters, index, repeat) {
  const parameter = expression.parameter ? Number(parameters[expression.parameter]) : null;
  const indexValue = index === null ? 0 : index + (repeat?.index_base || 0);
  const base = expression.source === 'index' ? indexValue : parameter;
  const operand = Number(expression.value ?? 1);
  if (!Number.isFinite(base) || !Number.isFinite(operand)) throw new Error('Template expression requires finite numeric values');
  if (expression.op === 'multiply') return base * operand;
  if (expression.op === 'add') return base + operand;
  if (expression.op === 'subtract') return base - operand;
  if (expression.op === 'divide') return base / operand;
  throw new Error(`Unsupported template expression: ${expression.op}`);
}

function compareBindingFingerprints(designGraph, currentModelGraph) {
  const nodes = new Map(currentModelGraph.nodes.map((node) => [node.node_id, node]));
  const result = [];
  for (const binding of designGraph.bindings) {
    const current = resolveCurrentNode(binding, currentModelGraph, nodes);
    const currentFingerprint = current ? entityFingerprint(current) : null;
    if (currentFingerprint !== binding.baseline_fingerprint) {
      result.push({
        binding_id: binding.binding_id,
        persistent_ref: binding.persistent_ref,
        expected_fingerprint: binding.baseline_fingerprint,
        current_fingerprint: currentFingerprint,
        status: current ? 'changed' : 'missing'
      });
    }
  }
  return result;
}

function resolveCurrentNode(binding, graph, nodes) {
  const direct = nodes.get(binding.entity_node_id);
  if (direct && matchesPersistentRef(direct, binding.persistent_ref)) return direct;
  return findModelNode(graph, binding.persistent_ref);
}

function blockedChangePlan(designGraph, currentGraph, changes, divergence, instruction) {
  const core = {
    version: DESIGN_PARAMETER_CHANGE_VERSION,
    kind: 'design_parameter_change_plan',
    design_graph_id: designGraph.design_graph_id,
    source_model_graph_id: currentGraph.graph_id,
    model_revision: currentGraph.model_revision,
    instruction: markUntrustedData(instruction, 'agent_instruction'),
    changes,
    affected_subgraph: [],
    targets: [],
    operations: [],
    risk_level: null,
    divergence,
    blockers: ['manual_or_external_divergence_requires_reconciliation'],
    execution_allowed: false,
    execution_route: 'trusted_reviewed_existing_model_edit_only'
  };
  return {
    ...core,
    change_plan_id: `design-change-${sha256Canonical(core).slice(7, 31)}`,
    next_action: { action: 'reconcile_design_intent' }
  };
}

function normalizePersistentRef(value) {
  if (typeof value === 'string') return value.startsWith('mock:') || value.includes('/') ? { entity_path: value } : { target_id: value };
  if (!value || typeof value !== 'object') throw new Error('Entity binding requires a persistent entity reference');
  const entityPath = value.entity_path || value.entityPath;
  const targetId = value.target_id || value.targetId || value.id || value.reference;
  if (entityPath) return { entity_path: String(entityPath), edit_scope: value.edit_scope || value.editScope || 'instance_path', instance_policy: value.instance_policy || value.instancePolicy || 'definition_wide', ...(value.instance_id || value.instanceId ? { instance_id: String(value.instance_id || value.instanceId) } : {}) };
  if (targetId) return { target_id: String(targetId) };
  throw new Error('Entity binding requires entity_path or target_id');
}

function findModelNode(graph, ref) {
  const candidates = graph.nodes.filter((node) => matchesPersistentRef(node, ref));
  if (ref.entity_path) return candidates.find((node) => node.entity_path === ref.entity_path) || null;
  return candidates.sort((left, right) => targetMatchRank(right, ref.target_id) - targetMatchRank(left, ref.target_id))[0] || null;
}

function targetMatchRank(node, targetId) {
  let rank = 0;
  if (node.reference === targetId) rank += 16;
  if (node.persistent_id === targetId) rank += 8;
  if (node.name === targetId) rank += 2;
  if (node.edit_scope === 'top_level') rank += 4;
  if (node.synthetic !== true) rank += 1;
  return rank;
}

function matchesPersistentRef(node, ref) {
  if (ref.entity_path) return node.entity_path === ref.entity_path;
  return [node.reference, node.persistent_id, node.name].filter(Boolean).includes(ref.target_id);
}

function entityFingerprint(node) {
  return sha256Canonical({
    persistent_ref: node.entity_path || node.reference || node.persistent_id,
    entity_type: node.entity_type,
    definition_name: node.definition_name,
    material: node.material,
    tag: node.tag,
    classification: node.classification,
    attributes: node.attributes,
    visible: node.visible,
    bounding_box: node.bounding_box,
    topology_summary: node.topology_summary,
    features: node.features
  });
}

function uniqueTargets(targets) {
  const result = [];
  const seen = new Set();
  for (const target of targets || []) {
    const normalized = normalizePersistentRef(target);
    const key = persistentRefKey(normalized);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function persistentRefKey(ref) {
  return ref.entity_path ? `entity_path:${ref.entity_path}` : `target_id:${ref.target_id}`;
}

function artifactRef(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return null;
  return {
    id: value.id || value.recipe_id || value.plan_id || value.graph_id || null,
    version: value.version || null,
    sha256: sha256Canonical(value)
  };
}

function inferParameterType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'unknown';
  return typeof value;
}
