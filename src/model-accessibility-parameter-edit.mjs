import { yfRuleBinding, assertYfRuleBinding } from './traditional-timber/yf-rules.mjs';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { compileModelAccessibilityTask, getModelAccessibilityTaskCatalog } from './model-accessibility-tasks.mjs';
import { buildDesignIntentGraph, compareDesignBindingFingerprints, planDesignParameterChange, reconcileDesignIntentGraph } from './design-intent-graph.mjs';
import { recompileDetailedBundle } from './detailed-modeling/recompile-bundle.mjs';
import { isTrustedAssemblyEditReceipt } from './detailed-modeling/assembly-edit.mjs';
import { compilePartGraphToSketchUpDsl } from './product-modeling/part-graph-compiler.mjs';
import { describeAssemblyOccurrences } from './detailed-modeling/scenes.mjs';
import { isVerifiedModelAccessibilitySavedReceipt } from './model-accessibility-delivery.mjs';

const VERSION = 'model-accessibility-parameter-source.v1';
const clone = value => structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new AgentContractError('INVALID_ARGUMENT', message); };
const actualDefinition = node => node.entity_definition_name || node.definition_name;
const localName = key => key === 'open_angle_deg' ? 'open_angle' : key.replace(/_mm$/, '');
const definitions = dsl => (dsl?.operations || []).filter(op => op.op === 'component_definition');
const seal = value => ({ ...value, source_record_hash: sha256Canonical(value) });
function verifyRecord(record) {
  if (record?.version !== VERSION) fail('A server-persisted creation parameter source is required; current geometry cannot establish a replacement baseline.');
  const { source_record_hash, ...body } = record;
  if (source_record_hash !== sha256Canonical(body)) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Stored parameter source was modified.');
}
function complete(graph) {
  if (!graph?.completeness?.complete && !graph?.completeness?.scope_complete && !graph?.completeness?.assembly_scope_complete) throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Parameter replacement needs complete selected subtrees and the global definition occurrence counts.');
}
function resolve(graph, target) {
  if (!object(target) || Object.keys(target).some(key => !['target_id', 'entity_path'].includes(key)) || Boolean(target.target_id) === Boolean(target.entity_path)) fail('Each target must provide exactly target_id or entity_path; names and implicit selections are unsupported.');
  const matches = graph.nodes.filter(node => node.node_type === 'occurrence' && (target.entity_path ? node.entity_path === target.entity_path : node.reference === target.target_id || node.persistent_id === target.target_id));
  if (matches.length !== 1) fail('Parameter target must resolve to exactly one actual occurrence.');
  const node = matches[0];
  if (node.entity_type !== 'component_instance' || node.parent_id) fail('Only complete top-level component instances are supported. Select the declared parent assembly for nested parts.');
  if (!actualDefinition(node)) fail('Actual component definition identity is missing.');
  if (graph.completeness.recursive_root_paths && !graph.completeness.recursive_root_paths.includes(node.entity_path)) fail('Target subtree is outside the complete indexed roots.');
  return node;
}
function ref(graph, node) {
  return graph.runtime === 'mock' ? { target_id: node.reference || node.persistent_id }
    : { entity_path: node.entity_path };
}
function bindingRef(graph, node) {
  return graph.runtime === 'mock' ? ref(graph, node)
    : { entity_path: node.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
}
function ruleFor(kind) {
  const result = getModelAccessibilityTaskCatalog({ task: kind, detail: 'parameters' }).tasks[0].parameters;
  if (!result || result.by_asset_recipe) fail('This parameter helper supports the declared catalog-listed parameter assemblies only.');
  return result;
}
function sourceDetails(source) {
  if (source.kind === 'common_task') {
    if (!['window', 'door', 'cabinet', 'sink_counter', 'traditional_timber'].includes(source.task?.kind)) fail('Unsupported common-task parameter recipe.');
    if(source.task.kind==='traditional_timber')assertYfRuleBinding(source.rule_binding);
    const timber=source.task.kind==='traditional_timber';
    const legacy=timber&&!source.rendering_version;
    if(timber&&source.rendering_version&&source.rendering_version!=='timber-render.v2')fail('Unsupported stored timber rendering version.');
    const task=legacy?{...source.task,parameters:{...source.task.parameters,tile_detail:'detailed'}}:source.task;
    const compiled = compileModelAccessibilityTask(task,{timberLegacyRendering:legacy});
    let bundle = compiled.bundle;
    if (source.part_id_aliases) {
      const remap = value => typeof value === 'string' ? source.part_id_aliases[value] || value : Array.isArray(value) ? value.map(remap)
        : object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)])) : value;
      bundle = { ...bundle, part_graph: remap(bundle.part_graph), detail_spec: remap(bundle.detail_spec) };
      bundle.dsl = compilePartGraphToSketchUpDsl(bundle.part_graph, bundle.profile, { includeReset: false });
      bundle.parts_mapping = source.task.kind==='traditional_timber'?[]:describeAssemblyOccurrences(bundle.part_graph);
    }
    return { bundle, parameters: bundle.parameters, rules: ruleFor(source.task.kind) };
  }
  if (source.kind !== 'detailed_sample' || !['window', 'door', 'cabinet'].includes(source.bundle?.brief?.kind) || source.bundle.composition_plan) fail('Detailed sources must be an existing window, door or cabinet sample; scene composition is outside this adapter.');
  const bundle = source.bundle, kind = bundle.brief.kind, rules = ruleFor(kind);
  if (bundle.part_graph?.roots?.length !== 1) fail('A detailed sample source must declare exactly one root.');
  // Recipe defaults come from the same public contract examples. They are
  // accepted only if regenerating the original sample reproduces its definitions.
  const defaults = getModelAccessibilityTaskCatalog({ task: kind, detail: 'examples' }).tasks[0].examples.minimal.arguments.inputs.task.parameters;
  const parameters = Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, bundle.brief.parameters?.[localName(key)] ?? defaults[key] ?? rule.default]));
  const probe = { version: 1, kind, id: bundle.part_graph.roots[0].part_id, units: 'mm', parameters, placement: { origin_mm: [0, 0, 0] } };
  compileModelAccessibilityTask(probe); // Includes dependent dimensions and enum validation.
  const regenerated = recompileDetailedBundle(bundle, { partId: probe.id, parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [localName(key), value])) });
  if (sha256Canonical(definitions(bundle.dsl)) !== sha256Canonical(definitions(regenerated.dsl))) fail('Stored detailed sample does not reproduce its declared recipe; reconcile or supply the original trusted recipe source.');
  return { bundle, parameters, rules };
}
function recompile(source, changes) {
  const before = sourceDetails(source);
  if (!object(changes) || !Object.keys(changes).length || Object.keys(changes).some(key => !Object.hasOwn(before.rules, key))) fail('changes must use supported explicit parameter names, such as width_mm; transforms and arbitrary DSL are unsupported.');
  const parameters = { ...before.parameters, ...changes };
  if (source.kind === 'common_task') {
    const nextSource = { kind: source.kind, task: { ...clone(source.task), parameters }, ...(source.rule_binding?{rule_binding:clone(source.rule_binding)}:{}),
      ...(source.rendering_version?{rendering_version:source.rendering_version}:{}),
      ...(source.task.kind==='traditional_timber'&&Object.hasOwn(changes,'tile_detail')?{rendering_version:'timber-render.v2'}:{}) };
    if (source.task.kind === 'cabinet') {
      // Old recipes encode the leg corner coordinates in IDs. Preserve the four
      // corresponding corners so frozen quality mappings survive width edits.
      const feet = bundle => {
        const values = bundle.part_graph.parts.filter(part => part.role === 'adjustable_foot');
        if (values.length !== 4 || values.some(part => part.shape?.primitive !== 'cylinder')) fail('Cabinet leg identity requires the original four-cylinder corner topology.');
        return values.sort((a, b) => a.shape.parameters.origin[0] - b.shape.parameters.origin[0] || a.shape.parameters.origin[1] - b.shape.parameters.origin[1]);
      };
      const original = feet(before.bundle), generated = feet(sourceDetails(nextSource).bundle);
      nextSource.part_id_aliases = Object.fromEntries(generated.flatMap((part, index) => part.id === original[index].id ? [] : [[part.id, original[index].id]]));
    }
    return { nextSource, next: sourceDetails(nextSource), before };
  }
  // Validate through the public contract before invoking the existing sample
  // compiler, which otherwise tolerates unknown local parameter names.
  compileModelAccessibilityTask({ version: 1, kind: source.bundle.brief.kind, id: source.bundle.part_graph.roots[0].part_id, units: 'mm', parameters, placement: { origin_mm: [0, 0, 0] } });
  const nextSource = { kind: source.kind, bundle: recompileDetailedBundle(source.bundle, { partId: source.bundle.part_graph.roots[0].part_id, parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [localName(key), value])) }) };
  return { nextSource, next: sourceDetails(nextSource), before };
}
function designFor({ modelKey, modelGraph, entries, parameters, rules }) {
  const nodes = entries.map(entry => resolve(modelGraph, entry.target));
  return buildDesignIntentGraph({ modelKey, modelGraph,
    parametricRecipe: { parameters: Object.entries(parameters).map(([id, value]) => ({ id, value, ...rules[id] })) },
    entityBindings: [{ binding_id: `assembly-${entries.map(entry => entry.logical_instance_id).sort().join('-')}`, part_id: entries[0].root_part_id,
      entity: bindingRef(modelGraph, nodes[0]), existing_targets: nodes.slice(1).map(node => bindingRef(modelGraph, node)), parameter_bindings: Object.keys(parameters),
      erase_before_rebuild: false, rebuild_template: [], lineage: { assembly_definition: entries[0].logical_definition } }] });
}

/** Call only at the trusted creation readback, before handing the model to an
 * agent. Persist privately. Hashes detect corruption, not client authenticity.
 * Supplying a current graph later to this function is NOT reconciliation. */
export function captureDefinitionParameterSource({ creationTaskId, modelKey, modelGraph, sourceTask, sourceBundle, identityMap, materialMap = {}, creationDocument } = {}) {
  complete(modelGraph);
  if (!/^task_[0-9a-f-]+$/i.test(creationTaskId || '')) fail('A server creation task id is required.');
  if (Boolean(sourceTask) === Boolean(sourceBundle)) fail('Provide exactly one trusted sourceTask or sourceBundle.');
  if (!object(identityMap) || !Array.isArray(creationDocument?.operations)) fail('Capture requires the actual server creation document and identity map.');
  const source = sourceTask ? { kind: 'common_task', task: clone(sourceTask), ...(sourceTask.kind==='traditional_timber'?{rule_binding:yfRuleBinding(),rendering_version:'timber-render.v2'}:{}) } : { kind: 'detailed_sample', bundle: clone(sourceBundle) };
  const { bundle, parameters, rules } = sourceDetails(source);
  const logicalDefinitions=definitions(bundle.dsl),nativeDefinitions=definitions(creationDocument);
  if(logicalDefinitions.length!==nativeDefinitions.length)fail('Creation definition map cannot be reconstructed from different compilation closures.');
  const definitionMap=Object.fromEntries(logicalDefinitions.map((definition,index)=>[definition.name,nativeDefinitions[index].name]));
  const entries = bundle.part_graph.roots.map(root => {
    const logicalId = root.instance_id || root.part_id;
    const actualId = identityMap[logicalId];
    if (!actualId) fail(`Creation identity mapping is missing for ${logicalId}.`);
    const matches = creationDocument.operations.filter(op => op.op === 'component_instance' && op.id === actualId);
    if (matches.length !== 1) fail(`Actual creation root binding is unavailable for ${logicalId}.`);
    const node = resolve(modelGraph, { target_id: actualId });
    if (actualDefinition(node) !== matches[0].definition) fail('Current target definition does not match its actual creation document.');
    return { logical_instance_id: logicalId, root_part_id: root.part_id, logical_definition: `PG2_${root.part_id}`, target: ref(modelGraph, node),
      source_definition: actualDefinition(node), definition_map: clone(definitionMap), identity_map:clone(identityMap), source: clone(source) };
  });
  if (new Set(entries.map(entry => sha256Canonical(entry.target))).size !== entries.length) fail('Creation roots must bind to distinct actual instances.');
  for (const entry of entries) entry.design_graph = designFor({ modelKey, modelGraph, entries: [entry], parameters, rules });
  return seal({ version: VERSION, creation_task_id: creationTaskId, model_key: modelKey, runtime: modelGraph.runtime,
    readback_projection: modelGraph.completeness.assembly_scope_complete ? 'assembly-merkle.v2' : 'full_geometry',
    initial_model_revision: modelGraph.model_revision, creation_document_hash: sha256Canonical(creationDocument), material_map: clone(materialMap), entries,
    evidence_level: 'trusted_creation_binding_snapshot', initial_geometry_quality_accepted: false, parameter_revision: 0 });
}

/** Move identity only after a server-verified saved receipt and unchanged actual
 * readback. Existing subtree baselines are compared before any graph is rebuilt. */
export function rebindDefinitionParameterSource({ sourceRecord, currentModelGraph, modelKey, savedReceipt } = {}) {
  verifyRecord(sourceRecord); complete(currentModelGraph);
  if (!isVerifiedModelAccessibilitySavedReceipt(savedReceipt)) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Only a server-read signed saved receipt can rebind parameter identity.');
  const binding = savedReceipt.parameter_binding;
  if (!binding) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'This delivery has no verifiable saved parameter source binding; current geometry cannot recreate a missing creation baseline.');
  if (binding.creation_task_id !== sourceRecord.creation_task_id || binding.source_record_hash !== sourceRecord.source_record_hash
    || binding.model_key !== sourceRecord.model_key || binding.runtime !== sourceRecord.runtime || currentModelGraph.runtime !== sourceRecord.runtime
    || savedReceipt.post_save_revision !== currentModelGraph.model_revision || !/^model_[0-9a-f]{32}$/.test(modelKey || '')) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Saved parameter version or current model revision differs from its creation source.');
  }
  for (const entry of sourceRecord.entries) {
    if (actualDefinition(resolve(currentModelGraph, entry.target)) !== entry.source_definition
      || compareDesignBindingFingerprints(entry.design_graph, currentModelGraph).length) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Preserve manual or external changes; saved continuation cannot reset a changed parameter baseline.');
  }
  if (modelKey === sourceRecord.model_key) return clone(sourceRecord);
  const { source_record_hash, ...body } = clone(sourceRecord);
  body.model_key = modelKey;
  body.identity_rebindings = [...(body.identity_rebindings || []), { delivery_task_id: savedReceipt.delivery_task_id,
    previous_model_key: sourceRecord.model_key, model_key: modelKey, previous_source_record_hash: source_record_hash,
    saved_file_sha256: savedReceipt.file.sha256, model_revision: currentModelGraph.model_revision }];
  for (const entry of body.entries) entry.design_graph = designFor({ modelKey, modelGraph: currentModelGraph, entries: [entry], ...sourceDetails(entry.source) });
  return seal(body);
}

/** Pure planning: no runtime call, staging, authorization or geometry mutation.
 * Public request: {creation_task_id, scope:'single'|'all', targets:[{target_id}
 * or {entity_path}], changes:{width_mm:...}}. All names every current peer. */
export function planDefinitionParameterEdit({ sourceRecord, currentModelGraph, request, taskId, iteration = 0, instruction } = {}) {
  verifyRecord(sourceRecord); complete(currentModelGraph);
  if (!object(request) || Object.keys(request).some(key => !['creation_task_id', 'scope', 'targets', 'changes'].includes(key))) fail('Only creation_task_id, scope, targets and changes belong to the parameter request.');
  if (request.creation_task_id !== sourceRecord.creation_task_id || currentModelGraph.runtime !== sourceRecord.runtime) fail('Parameter source task or runtime does not match.');
  if (!['single', 'all'].includes(request.scope)) fail('scope must explicitly be single or all.');
  if (!Array.isArray(request.targets) || !request.targets.length || request.scope === 'single' && request.targets.length !== 1) fail('single requires exactly one explicit target; all requires the complete explicit target list.');
  const nodes = request.targets.map(target => resolve(currentModelGraph, target));
  if (new Set(nodes.map(node => node.node_id)).size !== nodes.length) fail('Duplicate parameter targets are unsupported.');
  const selected = nodes.map(node => {
    const matches = sourceRecord.entries.filter(entry => resolve(currentModelGraph, entry.target).node_id === node.node_id);
    if (matches.length !== 1) fail('Target is not covered by this trusted creation source.');
    return matches[0];
  });
  const definition = actualDefinition(nodes[0]);
  if (nodes.some(node => actualDefinition(node) !== definition)) fail('One parameter edit must select one actual shared definition, not similarly named independent definitions.');
  if (request.scope === 'all') {
    const peers = currentModelGraph.nodes.filter(node => node.node_type === 'occurrence' && node.entity_type === 'component_instance' && actualDefinition(node) === definition);
    if (peers.some(node => node.parent_id) || peers.length !== nodes.length || peers.some(node => !nodes.some(selectedNode => selectedNode.node_id === node.node_id))) fail('all must cover every actual definition occurrence, including unbound or nested peers; partial coverage is blocked.');
    if (currentModelGraph.completeness.recursive_root_paths && nodes.some(node => node.entity_definition_occurrence_count !== peers.length)) fail('all requires exact global definition occurrence coverage.');
  }
  if (selected.some(entry => sha256Canonical(entry.source) !== sha256Canonical(selected[0].source) || entry.logical_definition !== selected[0].logical_definition)) fail('Selected definition bindings disagree on their persisted recipe version.');
  const compiled = recompile(selected[0].source, request.changes);
  const drift = selected.flatMap(entry => compareDesignBindingFingerprints(entry.design_graph, currentModelGraph));
  if (drift.length) return { kind: 'definition_parameter_edit', ready: false, blockers: ['manual_or_external_divergence_requires_reconciliation'], divergence: drift, operations: [], execution_allowed: false };
  if (selected.some(entry => entry.source_definition !== definition)) fail('Actual source definition no longer matches the recorded binding.');
  const designGraph = designFor({ modelKey: sourceRecord.model_key, modelGraph: currentModelGraph, entries: selected, ...compiled.before });
  const changePlan = planDesignParameterChange({ designGraph, currentModelGraph, changes: request.changes, instruction,
    assemblyRebuild: { previousDsl: compiled.before.bundle.dsl, nextDsl: compiled.next.bundle.dsl, scope: request.scope, taskId, iteration, materialMap: sourceRecord.material_map,
      ...(currentModelGraph.runtime==='queue'&&selected[0].definition_map?{
        existingDefinitionMap:Object.fromEntries(Object.entries(selected[0].definition_map).filter(([,name])=>currentModelGraph.nodes.some(node=>node.node_type==='definition'&&node.name===name))),
        existingIdentityMap:clone(selected[0].identity_map||{}), expectedModelRevision:currentModelGraph.model_revision}: {}) } });
  const body = { kind: 'definition_parameter_edit', ready: changePlan.blockers.length === 0, source_record_hash: sourceRecord.source_record_hash,
    selected_instances: selected.map(entry => entry.logical_instance_id), design_graph: designGraph, change_plan: changePlan, next_source: compiled.nextSource,
    blockers: clone(changePlan.blockers), execution_allowed: false, preparation_function: 'prepareAssemblyParameterEdit', application_function: 'applyAssemblyParameterEdit',
    approval_route: 'existing_reviewed_model_edit', quality_acceptance: false };
  return { ...body, edit_hash: sha256Canonical(body) };
}

/** Only a real in-process receipt from applyAssemblyParameterEdit advances the
 * private source. Persist afterward and call recordTrustedAssemblyEditMapping
 * separately to rebind the original frozen quality paths without weakening it. */
export function acceptDefinitionParameterEdit({ sourceRecord, edit, applied } = {}) {
  verifyRecord(sourceRecord);
  const { edit_hash, ...body } = edit || {};
  if (edit_hash !== sha256Canonical(body) || edit.source_record_hash !== sourceRecord.source_record_hash) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Parameter edit is not bound to this source record.');
  const receipt = applied?.assembly_edit_receipt;
  if (!isTrustedAssemblyEditReceipt(receipt) || receipt.change_plan_id !== edit.change_plan.change_plan_id || applied.model_graph?.model_revision !== receipt.model_revision_after) throw new AgentContractError('APPROVAL_INVALID', 'Only the trusted reviewed assembly application receipt can advance a parameter source.');
  const graph = applied.model_graph, result = clone(sourceRecord); delete result.source_record_hash;
  for (const entry of result.entries) {
    if (edit.selected_instances.includes(entry.logical_instance_id)) {
      const node = resolve(graph, entry.target);
      if (!receipt.selected_roots.some(root => root.entity_path === node.entity_path && root.replacement_definition === actualDefinition(node))) fail('Applied receipt does not cover a selected source root.');
      entry.source = clone(edit.next_source); entry.source_definition = actualDefinition(node);
      entry.definition_map={...entry.definition_map,...clone(edit.change_plan.assembly_rebuild.definition_map)};
      entry.identity_map=clone(edit.change_plan.assembly_rebuild.identity_map);
      const detail = sourceDetails(entry.source);
      entry.design_graph = designFor({ modelKey: result.model_key, modelGraph: graph, entries: [entry], ...detail });
    } else {
      // Only derived sharing counts may be refreshed. Existing manual semantic
      // divergence remains in the old baseline and will block a future edit.
      const reconciliation = reconcileDesignIntentGraph({ designGraph: entry.design_graph, currentModelGraph: graph, acceptedChangePlan: edit.change_plan });
      if (!reconciliation.unexpected_divergence.length) {
        const detail = sourceDetails(entry.source);
        entry.design_graph = designFor({ modelKey: result.model_key, modelGraph: graph, entries: [entry], ...detail });
      }
    }
  }
  result.parameter_revision += 1; result.last_change_plan_id = receipt.change_plan_id;
  return seal(result);
}
