import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, markUntrustedData, sha256Canonical } from './agent-contract.mjs';
import { AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS } from './agent-dsl-policy.mjs';
import { validateExpertDocument } from './expert-compiler.mjs';
import { compileVersionedAssemblyRebuild, validateAssemblyMaterialReferences } from './detailed-modeling/assembly-edit.mjs';

export const DESIGN_INTENT_GRAPH_VERSION = 'design-intent-graph.v1';
export const DESIGN_PARAMETER_CHANGE_VERSION = 'design-parameter-change-plan.v1';
export const DESIGN_RECONCILIATION_VERSION = 'design-intent-reconciliation.v1';

const MODEL_KEY_PATTERN = /^model_[0-9a-f]{32}$/;
const ADDITIVE_CREATION_OPERATIONS = new Set(AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS);

export function buildDesignIntentGraph({
  modelKey,
  modelGraph,
  parametricRecipe = {},
  featureMappingPlan = {},
  partGraph = {},
  entityBindings,
  correctionHistory = []
} = {}) {
  assertModelKey(modelKey);
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
    model_key: modelKey,
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
      mapped_entities: new Set(bindings.flatMap((binding) => binding.resolved_entities.map((entry) => entry.entity_node_id))).size,
      correction_events: correctionHistory.length
    }
  };
}

export function planDesignParameterChange({ designGraph, currentModelGraph, changes, instruction = 'Modify reviewed design parameters.', assemblyRebuild = null } = {}) {
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
  if (assemblyRebuild) return planAssemblyParameterChange({ designGraph, currentModelGraph, normalizedChanges, changedParameterIds, affectedBindings, instruction, assemblyRebuild });
  const values = Object.fromEntries(Object.entries(designGraph.parameters).map(([id, parameter]) => [id, parameter.value]));
  Object.assign(values, normalizedChanges);
  const targets = uniqueTargets(affectedBindings.flatMap((binding) => binding.existing_targets));
  const operations = [];
  const eraseTargets = uniqueTargets(affectedBindings.filter((binding) => binding.erase_before_rebuild !== false).flatMap((binding) => binding.existing_targets));
  if (eraseTargets.length) operations.push({ op: 'erase_entities', targets: eraseTargets });
  const operationRanges = new Map();
  for (const binding of affectedBindings) {
    const start = operations.length;
    operations.push(...expandBindingOperations(binding, values));
    operationRanges.set(binding.binding_id, { start, end: operations.length });
  }
  validateChangePlanOperations(operations);
  const affectedSubgraph = affectedBindings.map((binding) => affectedBindingPlan(
    binding,
    operations,
    operationRanges.get(binding.binding_id),
    changedParameterIds,
    currentModelGraph.runtime
  ));
  const replacementBlockers = affectedSubgraph.flatMap((entry) => entry.blockers);
  const core = {
    version: DESIGN_PARAMETER_CHANGE_VERSION,
    kind: 'design_parameter_change_plan',
    model_key: designGraph.model_key,
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
    blockers: [...(operations.length ? [] : ['no_rebuild_operations']), ...replacementBlockers],
    execution_allowed: false,
    execution_route: 'trusted_reviewed_existing_model_edit_only'
  };
  return {
    ...core,
    change_plan_id: `design-change-${sha256Canonical(core).slice(7, 31)}`,
    next_action: operations.length && core.blockers.length === 0 ? {
      action: 'start_reviewed_existing_model_edit',
      tool: 'start_agent_task',
      arguments: {
        intent: 'reviewed_existing_model_edit',
        instruction,
        interface_level: 'guided',
        inputs: { runtime: currentModelGraph.runtime, targets, operations }
      }
    } : { action: 'correct_design_mapping' }
  };
}

function planAssemblyParameterChange({ designGraph, currentModelGraph, normalizedChanges, changedParameterIds, affectedBindings, instruction, assemblyRebuild }) {
  if (!currentModelGraph.completeness?.complete && !currentModelGraph.completeness?.scope_complete) throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Versioned assembly editing requires a complete occurrence graph');
  if (!['single', 'all'].includes(assemblyRebuild.scope)) throw new Error('assemblyRebuild.scope must explicitly be single or all');
  const selections = new Map();
  for (const binding of affectedBindings) {
    if (binding.lineage?.binding_fingerprint_version !== 'assembly-subtree.v1') throw new Error(`Assembly binding ${binding.binding_id} requires a current subtree fingerprint baseline`);
    const resolved = resolveCanonicalTargets(currentModelGraph, binding.existing_targets, `assembly:${binding.binding_id}`);
    if (assemblyRebuild.scope === 'single' && resolved.length !== 1) throw new Error('single assembly scope requires exactly one bound instance per affected binding');
    for (const entry of resolved) {
      const node = entry.node;
      if (currentModelGraph.completeness.recursive_root_paths && !currentModelGraph.completeness.recursive_root_paths.includes(node.entity_path)) throw new Error('Assembly target is outside the complete indexed roots');
      if (node.entity_type !== 'component_instance' || node.parent_id) throw new Error('Versioned assembly replacement requires a top-level ComponentInstance; isolate the parent assembly before editing a nested occurrence');
      const sourceDefinition = node.entity_definition_name || node.definition_name;
      if (!sourceDefinition) throw new Error('Assembly definition identity is unavailable');
      if (assemblyRebuild.scope === 'all') {
        const all = currentModelGraph.nodes.filter(candidate => candidate.node_type === 'occurrence' && candidate.entity_type === 'component_instance' && (candidate.entity_definition_name || candidate.definition_name) === sourceDefinition);
        if (all.some(candidate => candidate.parent_id)) throw new Error('all assembly scope includes nested occurrences; replace their parent assembly explicitly');
        if (currentModelGraph.completeness.recursive_root_paths && node.entity_definition_occurrence_count !== all.length) throw new Error('all assembly scope requires the exact global definition occurrence count');
        const bound = new Set(resolved.map(candidate => candidate.node.node_id));
        if (all.some(candidate => !bound.has(candidate.node_id))) throw new Error('all assembly scope requires every current instance of the definition in the binding baseline');
      }
      const key = persistentRefKey(entry.ref);
      const existing = selections.get(key);
      const logicalDefinition = binding.lineage.assembly_definitions?.[key] || binding.lineage.assembly_definition || sourceDefinition;
      if (existing && existing.logical_definition !== logicalDefinition) throw new Error('Overlapping assembly bindings disagree on their source definition');
      selections.set(key, { target: structuredClone(entry.ref), source_definition: sourceDefinition, logical_definition: logicalDefinition,
        binding_ids: [...new Set([...(existing?.binding_ids || []), binding.binding_id])] });
    }
  }
  const stage = compileVersionedAssemblyRebuild({ ...assemblyRebuild, selections: [...selections.values()] });
  validateAssemblyMaterialReferences(stage.creation_document, currentModelGraph);
  validateChangePlanOperations(stage.operations);
  const targets = [...selections.values()].map(entry => entry.target);
  const affectedSubgraph = affectedBindings.map(binding => affectedBindingPlan({ ...binding, erase_before_rebuild: false }, [], { start: 0, end: 0 }, changedParameterIds, currentModelGraph.runtime));
  const core = {
    version: DESIGN_PARAMETER_CHANGE_VERSION, kind: 'design_parameter_change_plan',
    model_key: designGraph.model_key, design_graph_id: designGraph.design_graph_id,
    source_model_graph_id: currentModelGraph.graph_id, model_revision: currentModelGraph.model_revision,
    instruction: markUntrustedData(instruction, 'agent_instruction'), changes: normalizedChanges,
    affected_subgraph: affectedSubgraph, targets, operations: stage.operations, risk_level: 'S2',
    divergence: [], blockers: [], execution_allowed: false, execution_route: 'trusted_reviewed_existing_model_edit_only', assembly_rebuild: stage, ...(currentModelGraph.completeness.recursive_root_paths ? { recursive_roots: currentModelGraph.completeness.recursive_root_paths } : {})
  };
  return { ...core, change_plan_id: `design-change-${sha256Canonical(core).slice(7, 31)}`,
    next_action: { action: 'prepare_versioned_assembly_edit', arguments: { runtime: currentModelGraph.runtime,
      preparation_function: 'prepareAssemblyParameterEdit', approval_route: 'existing_reviewed_model_edit',
      replacement_scope: stage.scope, instance_count: stage.replacements.length } } };
}

export function reconcileDesignIntentGraph({ designGraph, currentModelGraph, acceptedChangePlan = null } = {}) {
  if (designGraph?.version !== DESIGN_INTENT_GRAPH_VERSION) throw new Error('reconcileDesignIntentGraph requires DesignIntentGraph v1');
  if (currentModelGraph?.version !== 'model-graph.v1') throw new Error('reconcileDesignIntentGraph requires current ModelGraph v1');
  const differences = compareBindingFingerprints(designGraph, currentModelGraph);
  const acceptedBindingIds = new Set(acceptedChangePlan?.affected_subgraph?.map((item) => item.binding_id) || []);
  if (acceptedChangePlan?.assembly_rebuild) {
    // Splitting a shared definition can change its usage count on an untouched
    // sibling. Reconcile that derived metadata only when its complete semantic
    // subtree is identical to the stored baseline.
    for (const binding of designGraph.bindings) {
      if (!binding.lineage?.assembly_semantic_fingerprint) continue;
      const resolution = tryResolveCanonicalTargets(currentModelGraph, binding.existing_targets, 'assembly usage reconciliation');
      if (resolution.ok && assemblySubtreeFingerprint(resolution.resolved, currentModelGraph, true) === binding.lineage.assembly_semantic_fingerprint) acceptedBindingIds.add(binding.binding_id);
    }
  }
  const expected = differences.filter((item) => acceptedBindingIds.has(item.binding_id));
  const unexpected = differences.filter((item) => !acceptedBindingIds.has(item.binding_id));
  const core = {
    version: DESIGN_RECONCILIATION_VERSION,
    kind: 'design_intent_reconciliation',
    model_key: designGraph.model_key,
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

export function acceptReconciliation({
  designGraph,
  currentModelGraph,
  reconciliation,
  decision,
  acceptedChangePlan = null,
  eventId = null,
  reviewedAt = null
} = {}) {
  if (reconciliation?.version !== DESIGN_RECONCILIATION_VERSION) throw new Error('acceptReconciliation requires a reconciliation artifact');
  if (reconciliation.model_key !== designGraph?.model_key) throw new Error('acceptReconciliation model_key mismatch');
  if (!['accept_reviewed_parameter_change', 'adopt_manual_edit'].includes(decision)) throw new Error('acceptReconciliation decision is not supported');
  if (decision === 'adopt_manual_edit' && !reconciliation.unexpected_divergence.length) throw new Error('There is no manual divergence to adopt');
  if (decision === 'accept_reviewed_parameter_change') {
    if (!acceptedChangePlan || acceptedChangePlan.model_key !== designGraph.model_key || acceptedChangePlan.design_graph_id !== designGraph.design_graph_id) {
      throw new Error('acceptReconciliation requires the server-bound DesignIntent change plan');
    }
  }
  const affected = new Map((acceptedChangePlan?.affected_subgraph || []).map((entry) => [entry.binding_id, entry]));
  const updatedBindings = designGraph.bindings.map((binding) => {
    const affectedEntry = decision === 'accept_reviewed_parameter_change' ? affected.get(binding.binding_id) : null;
    const sourceRefs = affectedEntry ? affectedEntry.replacement_refs.map((entry) => entry.selector) : binding.existing_targets;
    const resolved = resolveCanonicalTargets(currentModelGraph, sourceRefs, `binding:${binding.binding_id}:reconciliation`);
    if (affectedEntry && resolved.length !== affectedEntry.replacement_refs.length) {
      throw new Error(`DesignIntent replacement mapping count mismatch for ${binding.binding_id}`);
    }
    let sourceBinding = binding;
    if (affectedEntry && acceptedChangePlan?.assembly_rebuild) {
      const definitions = Object.fromEntries(acceptedChangePlan.assembly_rebuild.replacements
        .filter(entry => entry.binding_ids.includes(binding.binding_id)).map(entry => [persistentRefKey(entry.target), entry.logical_definition]));
      sourceBinding = { ...binding, lineage: { ...binding.lineage, assembly_definitions: definitions } };
    }
    return reboundBinding(sourceBinding, resolved, currentModelGraph);
  });
  const updatedParameters = structuredClone(designGraph.parameters);
  if (decision === 'accept_reviewed_parameter_change') {
    for (const [parameterId, value] of Object.entries(acceptedChangePlan?.changes || {})) {
      if (updatedParameters[parameterId]) updatedParameters[parameterId].value = value;
    }
  }
  const historyEvent = {
    event_id: eventId || `correction-${crypto.randomUUID()}`,
    at: reviewedAt || new Date().toISOString(),
    decision,
    reconciliation_id: reconciliation.reconciliation_id,
    change_plan_id: acceptedChangePlan?.change_plan_id || null,
    previous_model_revision: designGraph.model_revision,
    current_model_revision: currentModelGraph.model_revision
  };
  const core = {
    ...structuredClone(designGraph),
    model_key: designGraph.model_key,
    source_model_graph_id: currentModelGraph.graph_id,
    model_revision: currentModelGraph.model_revision,
    parameters: updatedParameters,
    bindings: updatedBindings,
    correction_history: [...designGraph.correction_history, historyEvent]
  };
  core.bidirectional = buildBidirectionalIndexes(updatedBindings);
  core.stats = {
    ...core.stats,
    mapped_entities: new Set(updatedBindings.flatMap((binding) => binding.resolved_entities.map((entry) => entry.entity_node_id))).size,
    correction_events: core.correction_history.length
  };
  core.design_graph_id = `design-graph-${sha256Canonical({ ...core, design_graph_id: undefined }).slice(7, 31)}`;
  return core;
}

export async function writeDesignArtifact(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, 0o600);
    return filePath;
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true });
  }
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
    const requestedPrimary = normalizePersistentRef(binding.entity || binding.persistent_ref || binding.target);
    const requestedTargets = uniqueTargets([requestedPrimary, ...(binding.existing_targets || [])]);
    const resolved = resolveCanonicalTargets(modelGraph, requestedTargets, `entity_bindings[${index}]`);
    const primary = resolved[0];
    const parameterBindings = (binding.parameter_bindings || binding.parameters || []).map((item) => typeof item === 'string' ? { parameter_id: item } : structuredClone(item));
    return reboundBinding({
      binding_id: binding.binding_id || `binding-${index + 1}`,
      part_id: binding.part_id || null,
      feature_id: binding.feature_id || null,
      entity_node_id: primary.node.node_id,
      persistent_ref: primary.ref,
      baseline_fingerprint: bindingFingerprint(resolved),
      resolved_entities: [],
      parameter_bindings: parameterBindings,
      associated_binding_ids: [...new Set(binding.associated_binding_ids || binding.associations || [])],
      existing_targets: resolved.map((entry) => entry.ref),
      erase_before_rebuild: binding.erase_before_rebuild !== false,
      rebuild_template: structuredClone(binding.rebuild_template || []),
      repeat: binding.repeat ? structuredClone(binding.repeat) : null,
      lineage: structuredClone(binding.lineage || {})
    }, resolved, modelGraph);
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
    const designRefs = [
      ...(binding.part_id ? [`part:${binding.part_id}`] : []),
      ...(binding.feature_id ? [`feature:${binding.feature_id}`] : []),
      ...binding.parameter_bindings.map((item) => `parameter:${item.parameter_id}`)
    ];
    for (const persistentRef of binding.existing_targets) {
      const entityKey = persistentRefKey(persistentRef);
      entityToDesign[entityKey] = [...new Set([...(entityToDesign[entityKey] || []), ...designRefs])];
      for (const designRef of designRefs) designToEntities[designRef] = [...new Set([...(designToEntities[designRef] || []), entityKey])];
    }
  }
  return { design_to_entities: designToEntities, entity_to_design: entityToDesign };
}

function normalizeChanges(changes, parameters) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).length === 0) throw new Error('changes must be a non-empty object');
  const result = {};
  for (const [id, value] of Object.entries(changes)) {
    const parameter = parameters[id];
    if (!parameter) throw new Error(`Unknown design parameter: ${id}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${id} must be a finite number`);
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

function affectedBindingPlan(binding, operations, range, changedParameterIds, runtime) {
  const generatedRefs = [];
  for (let index = range.start; index < range.end; index += 1) {
    const operation = operations[index];
    if (!ADDITIVE_CREATION_OPERATIONS.has(operation.op)) continue;
    const targetId = operation.id || operation.object_id || operation.objectId || operation.name;
    if (!targetId) continue;
    generatedRefs.push({
      selector: { target_id: String(targetId) },
      selector_source: operation.id || operation.object_id || operation.objectId ? 'operation_id' : 'operation_name',
      source_operation_index: index,
      source_operation: operation.op,
      expected_count: 1
    });
  }
  const uniqueGenerated = uniqueGeneratedRefs(generatedRefs);
  const replacementRefs = uniqueGenerated.length
    ? uniqueGenerated.map((entry) => ({ ...entry, replacement_kind: 'generated_entity' }))
    : binding.erase_before_rebuild === false
      ? binding.existing_targets.map((selector) => ({
          selector: structuredClone(selector),
          selector_source: 'retained_canonical_ref',
          source_operation_index: null,
          source_operation: 'retained_entity',
          expected_count: 1,
          replacement_kind: 'retained_entity'
        }))
      : [];
  const blockers = [
    ...(binding.erase_before_rebuild !== false && replacementRefs.length === 0 ? [`replacement_references_unavailable:${binding.binding_id}`] : []),
    ...(runtime === 'queue' && replacementRefs.some((entry) => entry.selector_source === 'operation_name')
      ? [`queue_generated_reference_requires_operation_id:${binding.binding_id}`]
      : [])
  ];
  return {
    binding_id: binding.binding_id,
    part_id: binding.part_id,
    feature_id: binding.feature_id,
    entity_node_id: binding.entity_node_id,
    persistent_ref: structuredClone(binding.persistent_ref),
    previous_refs: structuredClone(binding.existing_targets),
    generated_refs: uniqueGenerated,
    replacement_refs: replacementRefs,
    reasons: binding.parameter_bindings
      .filter((item) => changedParameterIds.includes(item.parameter_id))
      .map((item) => `parameter:${item.parameter_id}`),
    associated_bindings: binding.associated_binding_ids,
    blockers
  };
}

function uniqueGeneratedRefs(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = persistentRefKey(entry.selector);
    if (seen.has(key)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A DesignIntent rebuild emits duplicate generated entity selectors.');
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function validateChangePlanOperations(operations) {
  try {
    validateExpertDocument({
      version: 1,
      units: 'mm',
      operations: operations.map((operation) => ['erase_entities', 'replace_component_definition'].includes(operation.op)
        ? { ...operation, confirmed: true }
        : operation)
    }, { maxOperations: Math.max(1, operations.length) });
  } catch (error) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent rebuild operations do not satisfy the shared safe-DSL contract.', {
      details: { reason: String(error?.message || error) }
    });
  }
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
  const result = [];
  for (const binding of designGraph.bindings) {
    const resolution = tryResolveCanonicalTargets(currentModelGraph, binding.existing_targets, `binding:${binding.binding_id}:compare`);
    const currentFingerprint = resolution.ok ? binding.lineage?.binding_fingerprint_version === 'assembly-subtree.v1'
      ? assemblySubtreeFingerprint(resolution.resolved, currentModelGraph) : bindingFingerprint(resolution.resolved) : null;
    if (currentFingerprint !== binding.baseline_fingerprint) {
      result.push({
        binding_id: binding.binding_id,
        persistent_ref: binding.persistent_ref,
        expected_fingerprint: binding.baseline_fingerprint,
        current_fingerprint: currentFingerprint,
        status: resolution.ok ? 'changed' : resolution.status,
        candidate_count: resolution.candidate_count
      });
    }
  }
  return result;
}

export function compareDesignBindingFingerprints(designGraph, currentModelGraph) {
  return compareBindingFingerprints(designGraph, currentModelGraph);
}

function blockedChangePlan(designGraph, currentGraph, changes, divergence, instruction) {
  const core = {
    version: DESIGN_PARAMETER_CHANGE_VERSION,
    kind: 'design_parameter_change_plan',
    model_key: designGraph.model_key,
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

function canonicalRefForNode(graph, node, requested) {
  const topLevelMock = graph.runtime === 'mock' && !node.parent_id;
  const stableTopLevelId = node.reference || node.persistent_id || null;
  if (topLevelMock && stableTopLevelId) {
    return { target_id: String(stableTopLevelId), edit_scope: 'top_level' };
  }
  if (!node.entity_path) {
    if (graph.runtime === 'queue') {
      throw mappingError('missing', 'Queue DesignIntent mappings require a canonical occurrence entity_path.', 0);
    }
    if (!stableTopLevelId) throw mappingError('missing', 'The ModelGraph occurrence has no stable reference.', 0);
    return { target_id: String(stableTopLevelId), edit_scope: 'top_level' };
  }
  const suppliedPolicy = requested.instance_policy || requested.instancePolicy || null;
  if (node.instance_policy_required === true && !suppliedPolicy) {
    throw mappingError('ambiguous', 'A shared-definition DesignIntent mapping requires an explicit instance_policy.', node.affected_instance_count || 2);
  }
  const instancePolicy = suppliedPolicy || 'definition_wide';
  if (!['definition_wide', 'make_unique'].includes(instancePolicy)) {
    throw mappingError('ambiguous', 'DesignIntent instance_policy must be definition_wide or make_unique.', 0);
  }
  const instanceId = requested.instance_id || requested.instanceId || null;
  if (instancePolicy === 'make_unique' && !instanceId) {
    throw mappingError('ambiguous', 'DesignIntent make_unique mappings require instance_id.', 0);
  }
  return {
    entity_path: String(node.entity_path),
    edit_scope: node.edit_scope || 'instance_path',
    instance_policy: instancePolicy,
    ...(instanceId ? { instance_id: String(instanceId) } : {})
  };
}

function reboundBinding(binding, resolved, modelGraph = null) {
  if (!Array.isArray(resolved) || resolved.length === 0) throw new Error(`DesignIntent binding ${binding.binding_id} has no resolved entities`);
  const primary = resolved[0];
  const assembly = modelGraph && resolved.every(entry => entry.node.entity_type === 'component_instance');
  return {
    ...structuredClone(binding),
    entity_node_id: primary.node.node_id,
    persistent_ref: structuredClone(primary.ref),
    baseline_fingerprint: assembly ? assemblySubtreeFingerprint(resolved, modelGraph) : bindingFingerprint(resolved),
    ...(assembly ? { lineage: { ...binding.lineage, binding_fingerprint_version: 'assembly-subtree.v1',
      assembly_semantic_fingerprint: assemblySubtreeFingerprint(resolved, modelGraph, true) } } : {}),
    resolved_entities: resolved.map((entry) => ({
      entity_node_id: entry.node.node_id,
      persistent_ref: structuredClone(entry.ref),
      baseline_fingerprint: entityFingerprint(entry.node)
    })),
    existing_targets: resolved.map((entry) => structuredClone(entry.ref))
  };
}

function assemblySubtreeFingerprint(resolved, modelGraph, ignoreUsage = false) {
  const descendants = new Map();
  for (const node of modelGraph.nodes) {
    if (node.node_type !== 'occurrence') continue;
    if (!descendants.has(node.parent_id)) descendants.set(node.parent_id, []);
    descendants.get(node.parent_id).push(node);
  }
  const fingerprint = (node) => {
    const semantic = ignoreUsage ? { ...node, shared_definition: undefined, affected_instance_count: undefined, instance_policy_required: undefined } : node;
    return { path: node.entity_path, fingerprint: entityFingerprint(semantic), children: (descendants.get(node.node_id) || [])
      .sort((a, b) => String(a.entity_path).localeCompare(String(b.entity_path))).map(fingerprint) };
  };
  return sha256Canonical(resolved.map(entry => ({ persistent_ref: entry.ref, subtree: fingerprint(entry.node) }))
    .sort((a, b) => persistentRefKey(a.persistent_ref).localeCompare(persistentRefKey(b.persistent_ref))));
}

function bindingFingerprint(resolved) {
  return sha256Canonical(resolved
    .map((entry) => ({ persistent_ref: entry.ref, entity_fingerprint: entityFingerprint(entry.node) }))
    .sort((left, right) => persistentRefKey(left.persistent_ref).localeCompare(persistentRefKey(right.persistent_ref))));
}

function mappingError(status, message, candidateCount) {
  const error = new AgentContractError('INVALID_ARGUMENT', message, {
    details: { mapping_status: status, candidate_count: candidateCount }
  });
  error.mapping_status = status;
  error.candidate_count = candidateCount;
  return error;
}

function resolveCanonicalTargets(graph, refs, context) {
  const resolved = [];
  const seen = new Set();
  for (const ref of refs) {
    const entry = resolveCanonicalTarget(graph, normalizePersistentRef(ref), context);
    const key = persistentRefKey(entry.ref);
    if (!seen.has(key)) {
      seen.add(key);
      resolved.push(entry);
    }
  }
  if (!resolved.length) throw mappingError('missing', `${context} has no resolvable ModelGraph occurrences.`, 0);
  return resolved;
}

function tryResolveCanonicalTargets(graph, refs, context) {
  try {
    return { ok: true, resolved: resolveCanonicalTargets(graph, refs, context), status: null, candidate_count: null };
  } catch (error) {
    if (error?.mapping_status) {
      return { ok: false, resolved: [], status: error.mapping_status, candidate_count: error.candidate_count ?? null };
    }
    throw error;
  }
}

function resolveCanonicalTarget(graph, ref, context) {
  const occurrences = graph.nodes.filter((node) => node.node_type === 'occurrence');
  if (ref.entity_path) {
    const candidates = occurrences.filter((node) => node.entity_path === ref.entity_path);
    if (candidates.length === 0) throw mappingError('missing', `${context} does not resolve in ModelGraph.`, 0);
    if (candidates.length !== 1) throw mappingError('ambiguous', `${context} resolves to multiple occurrence paths.`, candidates.length);
    return { node: candidates[0], ref: canonicalRefForNode(graph, candidates[0], ref), match_kind: 'entity_path' };
  }
  const candidates = occurrences.filter((node) => matchesPersistentRef(node, ref));
  if (candidates.length === 0) throw mappingError('missing', `${context} does not resolve in ModelGraph.`, 0);
  const ranked = candidates.map((node) => ({ node, rank: targetMatchRank(node, ref.target_id) }));
  const bestRank = Math.max(...ranked.map((entry) => entry.rank));
  const best = ranked.filter((entry) => entry.rank === bestRank);
  if (best.length !== 1) throw mappingError('ambiguous', `${context} is ambiguous in ModelGraph.`, best.length);
  const node = best[0].node;
  const matchKind = node.reference === ref.target_id
    ? 'reference'
    : node.persistent_id === ref.target_id
      ? 'persistent_id'
      : 'name';
  if (graph.runtime === 'queue' && matchKind === 'name') {
    throw mappingError('ambiguous', `${context} cannot persist a queue mapping resolved only by an untrusted name.`, candidates.length);
  }
  return { node, ref: canonicalRefForNode(graph, node, ref), match_kind: matchKind };
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
    entity_path: node.entity_path || null,
    parent_entity_path: node.parent_entity_path || null,
    path_segments: node.path_segments || [],
    reference: node.reference || null,
    persistent_id: node.persistent_id || null,
    entity_type: node.entity_type,
    definition_name: node.definition_name,
    definition_persistent_id: node.definition_persistent_id,
    entity_definition_name: node.entity_definition_name,
    entity_definition_persistent_id: node.entity_definition_persistent_id,
    material: node.material,
    back_material: node.back_material,
    tag: node.tag,
    classification: node.classification,
    native_classification: node.native_classification,
    attributes: node.attributes,
    texture_transform: node.texture_transform,
    face_uvs: node.face_uvs,
    transform: node.transform,
    transformation: node.transformation,
    world_transform: node.world_transform,
    geometry_summary: node.geometry_summary,
    visible: node.visible,
    locked: node.locked,
    effective_locked: node.effective_locked,
    locked_ancestor_path: node.locked_ancestor_path,
    soft: node.soft,
    smooth: node.smooth,
    reversed: node.reversed,
    editable: node.editable,
    edit_scope: node.edit_scope,
    bounding_box: node.bounding_box,
    topology_summary: node.topology_summary,
    features: node.features,
    shared_definition: node.shared_definition,
    affected_instance_count: node.affected_instance_count,
    instance_policy_required: node.instance_policy_required
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

function assertModelKey(modelKey) {
  if (!MODEL_KEY_PATTERN.test(String(modelKey || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph requires a server-derived model_key.');
  }
}

function inferParameterType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'unknown';
  return typeof value;
}
