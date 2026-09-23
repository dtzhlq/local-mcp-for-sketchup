import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { OPERATION_REGISTRY } from './capabilities.mjs';
import { expandDslCode } from './dsl-expansion.mjs';
import { HOST_CREATION_METADATA_OPS, validateHostCreationMetadata } from './host-creation-metadata.mjs';

// Agent Gateway create/verify(code) is deliberately narrower than the expert
// build_model surface. Every operation must be explicitly classified here;
// adding an operation to the shared registry does not make it Gateway-safe.
export const AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS = Object.freeze([
  'box',
  'rounded_box',
  'beveled_panel',
  'fillet',
  'chamfer',
  'recess',
  'engraved_line',
  'text_emboss',
  'text_engrave',
  'text_3d',
  'slot',
  'slot_array',
  'rib',
  'standoff_boss',
  'button_on_panel',
  'prism',
  'panel_with_openings',
  'boolean_cutout',
  'face_with_holes',
  'profile_extrude',
  'mesh',
  'geometry_input',
  'curve',
  'arc_curve',
  'gable_roof',
  'shed_roof',
  'cylinder',
  'loft_between_profiles',
  'shell_from_front_side_profiles',
  'lofted_solid',
  'face_on_cylinder',
  'analog_stick',
  'screw_hole',
  'pipe_between_points',
  'swept_path',
  'domed_surface',
  'bowed_panel',
  'floor_slab',
  'footprint_slab',
  'wall',
  'wall_path',
  'curved_wall',
  'roof_footprint',
  'hip_roof',
  'parapet_path',
  'curtain_wall',
  'column_grid',
  'path_surface',
  'terrain_mesh',
  'parking_stall_array',
  'door',
  'window',
  'stairs',
  'railing',
  'component_instance',
  'room'
]);

const ADDITIVE_CREATION_SET = new Set(AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS);
const EXISTING_TARGET_FIELDS = Object.freeze([
  'target_id',
  'targetId',
  'target',
  'object',
  'entity_path',
  'entityPath',
  'target_path',
  'targetPath',
  'edit_scope',
  'editScope',
  'instance_policy',
  'instancePolicy',
  'instance_id',
  'instanceId',
  'confirmed'
]);
const MATERIAL_SPEC_FIELDS = new Set([
  'material',
  'back_material',
  'backMaterial',
  'front_material',
  'frontMaterial',
  'f_material',
  'b_material',
  'hole_material',
  'holeMaterial',
  'frame_material',
  'frameMaterial',
  'panel_material',
  'panelMaterial'
]);

for (const operation of AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS) {
  if (!OPERATION_REGISTRY[operation]) {
    throw new Error(`Agent Gateway creation policy references an unregistered operation: ${operation}`);
  }
}

export function prepareAgentGatewayCreationDsl(code, { intent = 'create_model' } = {}) {
  let prepared;
  try {
    prepared = expandDslCode(code);
  } catch (error) {
    throw new AgentContractError('INVALID_ARGUMENT', `${intent} requires a valid safe JSON DSL document.`, {
      details: { reason: String(error?.message || error) }
    });
  }

  const blocked = [];
  for (const [index, operation] of prepared.document.operations.entries()) {
    const operationPath = `operations[${index}]`;
    if (!ADDITIVE_CREATION_SET.has(operation.op)) {
      blocked.push({
        path: operationPath,
        op: operation.op,
        reason: blockedReason(operation.op)
      });
      continue;
    }
    const targetFields = EXISTING_TARGET_FIELDS.filter((field) => Object.hasOwn(operation, field));
    if (targetFields.length) {
      blocked.push({
        path: operationPath,
        op: operation.op,
        reason: 'existing_target_fields',
        fields: targetFields
      });
    }
    const mutableMaterialSpecs = findMutableMaterialSpecs(operation, operationPath);
    if (mutableMaterialSpecs.length) {
      blocked.push({
        path: operationPath,
        op: operation.op,
        reason: 'named_material_may_be_updated',
        fields: mutableMaterialSpecs
      });
    }
  }

  if (blocked.length) {
    throw new AgentContractError(
      'OPERATION_NOT_ALLOWED',
      `${intent} accepts additive creation operations only; use reviewed_existing_model_edit for existing-model changes.`,
      {
        details: {
          execution_route: 'reviewed_existing_model_edit',
          blocked_operations: blocked
        },
        nextAction: {
          action: 'start_reviewed_existing_model_edit',
          intent: 'reviewed_existing_model_edit'
        }
      }
    );
  }

  return prepared;
}

function blockedReason(operation) {
  if (!OPERATION_REGISTRY[operation]) return 'unregistered_operation';
  if (operation === 'reset') return 'model_reset';
  if (operation === 'component_definition') return 'existing_definition_may_be_replaced';
  if (['material', 'tag', 'image_reference'].includes(operation)) return 'named_resource_may_be_updated';
  if (['camera', 'scene', 'style', 'shadow', 'rendering_options'].includes(operation)) return 'global_model_state_change';
  if (operation === 'selection') return 'existing_target_selection';
  return 'existing_model_edit_or_unclassified_operation';
}

function findMutableMaterialSpecs(value, currentPath, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findMutableMaterialSpecs(item, `${currentPath}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${currentPath}.${key}`;
    if (MATERIAL_SPEC_FIELDS.has(key) && nested && typeof nested === 'object') found.push(nestedPath);
    findMutableMaterialSpecs(nested, nestedPath, found);
  }
  return found;
}

export const CREATION_SCOPE_VERSION = 'creation-scope.v1';
const SCOPED_CUTS = new Set(['cut_hole', 'cut_slot', 'cut_recess']);
const SCOPED_CUT_HOSTS = new Set(['box', 'rounded_box', 'beveled_panel', 'panel_with_openings']);

// Scoped companion to the unchanged additive-only policy. This is a plan, not
// permission: both runtimes must validate absence and target closure atomically.
export function prepareTaskOwnedCreationDsl(code, { taskId, iteration = 0, existingDefinitions = {}, expectedModelRevision } = {}) {
  if (!/^task_[0-9a-f-]+$/i.test(String(taskId)) || !Number.isInteger(iteration) || iteration < 0) throw new AgentContractError('INVALID_ARGUMENT', 'A server task and creation iteration are required.');
  const expanded = expandDslCode(code);
  if (expanded.document.creation_scope) throw new AgentContractError('INVALID_ARGUMENT', 'Creation scope is server generated.');
  const prefix = `alma_${sha256Canonical({ taskId, iteration }).slice(7, 27)}_`;
  if (!existingDefinitions || typeof existingDefinitions !== 'object' || Array.isArray(existingDefinitions)
    || Object.entries(existingDefinitions).some(([key,value])=>!key||typeof value!=='string'||!value)) throw new AgentContractError('INVALID_ARGUMENT','Invalid existing definition bindings.');
  const reuseNames=[...new Set(Object.values(existingDefinitions))];
  if(reuseNames.length && !/^sha256:[0-9a-f]{64}$/.test(expectedModelRevision||'')) throw new AgentContractError('INVALID_ARGUMENT','Existing definitions require a complete expected native revision.');
  const identityMap = {};
  const definitions = new Map();
  const materials = new Map();
  for (const operation of expanded.document.operations) {
    if (operation.op === 'component_definition' || operation.op === 'material') {
      const map = operation.op === 'material' ? materials : definitions;
      if (typeof operation.name !== 'string' || !operation.name || map.has(operation.name)) throw new AgentContractError('INVALID_ARGUMENT', 'New resource names must be unique.');
      if(operation.op==='component_definition'&&Object.hasOwn(existingDefinitions,operation.name)) throw new AgentContractError('INVALID_ARGUMENT','A definition cannot be both reused and created.');
      map.set(operation.name, `${prefix}${operation.op}_${map.size}`);
    }
  }
  const rename = (operation) => {
    const result = structuredClone(operation);
    if (operation.op === 'material') result.name = materials.get(operation.name);
    else if (operation.op === 'component_definition') {
      result.name = definitions.get(operation.name);
      result.operations = (operation.operations || []).map(rename);
      if (!operation.operations) { delete result.operations; }
    } else if (!SCOPED_CUTS.has(operation.op)) {
      const logicalId = operation.id || operation.object_id || operation.objectId || operation.name;
      if (typeof logicalId === 'string' && logicalId) {
        identityMap[logicalId] ||= `${prefix}object_${sha256Canonical(logicalId).slice(7, 23)}`;
        result.id = identityMap[logicalId];
        delete result.object_id;
        delete result.objectId;
      }
    }
    if (operation.definition) result.definition = definitions.get(operation.definition) || existingDefinitions[operation.definition] || operation.definition;
    for (const key of MATERIAL_SPEC_FIELDS) if (typeof result[key] === 'string' && materials.has(result[key])) result[key] = materials.get(result[key]);
    return result;
  };
  const operations = expanded.document.operations.map(rename);
  const patchTargets = (ops) => ops.forEach(operation => {
    if (SCOPED_CUTS.has(operation.op)) {
      const logicalTarget = operation.target_id || operation.target || operation.name;
      operation.target_id = identityMap[logicalTarget] || logicalTarget;
      delete operation.target;
      delete operation.name;
    }
    if (operation.operations) patchTargets(operation.operations);
  });
  patchTargets(operations);
  const document = { ...expanded.document, operations, creation_scope: {
    version: CREATION_SCOPE_VERSION, task_id: taskId, iteration, namespace: prefix,
    definitions: [...definitions.values()], materials: [...materials.values()],
    ...(reuseNames.length?{definition_references:{version:'immutable-definition-references.v1',names:reuseNames,model_revision:expectedModelRevision}}:{})
  } };
  validateTaskOwnedCreationDocument(document);
  return { ...expanded, document, code: JSON.stringify(document), identity_map: identityMap, material_map: Object.fromEntries(materials), creation_scope: document.creation_scope };
}

export function validateTaskOwnedCreationDocument(document) {
  const scope = document.creation_scope;
  const deny = (reason) => { throw new AgentContractError('OPERATION_NOT_ALLOWED', `Creation scope rejected: ${reason}`); };
  if (scope?.version !== CREATION_SCOPE_VERSION || !/^alma_[0-9a-f]{20}_$/.test(scope.namespace || '')) deny('invalid contract');
  const reference=scope.definition_references;
  if(reference && (reference.version!=='immutable-definition-references.v1'||Object.keys(reference).sort().join(',')!=='model_revision,names,version'
    ||!/^sha256:[0-9a-f]{64}$/.test(reference.model_revision||'')||!Array.isArray(reference.names)||!reference.names.length||reference.names.length>50000
    ||reference.names.some(name=>typeof name!=='string'||!name)||new Set(reference.names).size!==reference.names.length)) deny('invalid immutable definition references');
  const reused=new Set(reference?.names||[]),usedReferences=new Set();
  const definitions = new Set();
  const materials = new Set();
  const rootObjects = [];
  const visit = (operations, nested = false) => {
    const objects = new Map();
    for (const operation of operations) {
      if (!operation || typeof operation !== 'object') deny('invalid operation');
      if (HOST_CREATION_METADATA_OPS.has(operation.op) && scope.host_metadata) {
        if (nested) deny('host metadata must be top-level');
        continue; // Strict field/target/order/resource closure is checked below.
      }
      if (operation.op === 'material') {
        if (nested || !operation.name?.startsWith(scope.namespace) || materials.has(operation.name)) deny('material must be a fresh top-level resource');
        materials.add(operation.name);
        continue;
      }
      if (operation.op === 'component_definition') {
        if (nested || !operation.name?.startsWith(scope.namespace) || definitions.has(operation.name) || reused.has(operation.name)) deny('definition must be fresh and acyclic');
        if (findMutableMaterialSpecs({ ...operation, operations: undefined }, '').length) deny('inline mutable material');
        visit(operation.operations || [], true);
        definitions.add(operation.name);
        continue;
      }
      if (SCOPED_CUTS.has(operation.op)) {
        const host = objects.get(operation.target_id);
        if (nested || !host || !SCOPED_CUT_HOSTS.has(host.op) || host.transform) deny('cut target must be an earlier untransformed Group in this transaction');
        if (EXISTING_TARGET_FIELDS.some(key => key !== 'target_id' && Object.hasOwn(operation, key))) deny('cut target aliases are forbidden');
        continue;
      }
      if (!ADDITIVE_CREATION_SET.has(operation.op) || !OPERATION_REGISTRY[operation.op]) deny(`unsupported operation ${operation.op}`);
      if (nested && OPERATION_REGISTRY[operation.op].component_scope?.status !== 'supported') deny('operation is not supported in definitions');
      if (EXISTING_TARGET_FIELDS.some(key => Object.hasOwn(operation, key)) || operation.operations) deny('existing references or hidden operations');
      if (findMutableMaterialSpecs(operation, '').length) deny('inline mutable material');
      if (operation.op === 'component_instance' && !definitions.has(operation.definition)) {
        if(!reused.has(operation.definition)) deny('instance must refer to an earlier new or declared immutable definition');
        usedReferences.add(operation.definition);
      }
      if (!operation.id?.startsWith(scope.namespace) || objects.has(operation.id)) deny('fresh unique object id required');
      objects.set(operation.id, operation);
      if (!nested) rootObjects.push(operation);
    }
  };
  visit(document.operations || []);
  if (JSON.stringify([...definitions]) !== JSON.stringify(scope.definitions) || JSON.stringify([...materials]) !== JSON.stringify(scope.materials)) deny('resource declaration mismatch');
  if([...reused].some(name=>!usedReferences.has(name))) deny('unused definition reference');
  const metadata = validateHostCreationMetadata(document, rootObjects);
  return { scope, root_objects: rootObjects, new_tags: metadata.tags };
}

// Pass complete runtime state, including unused definitions/materials. A public
// bounded snapshot is not an authoritative resource inventory.
export function validateCreationScopeAgainstModel(document, model) {
  if (!document.creation_scope) return null;
  const validation = validateTaskOwnedCreationDocument(document);
  const names = value => new Set(Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : item.name) : Object.keys(value || {}));
  const definitions = names(model.component_definitions);
  const materials = names(model.materials);
  const tags = names(model.tags);
  const references=validation.scope.definition_references;
  if(references && (model.model_revision!==references.model_revision||references.names.some(name=>!definitions.has(name)))) throw new AgentContractError('MODEL_REVISION_MISMATCH','Immutable definition references require the recorded model revision and existing resources.');
  if (validation.new_tags.some(name => tags.has(name))) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Creation tag already exists.');
  if (validation.scope.definitions.some(name => definitions.has(name)) || validation.scope.materials.some(name => materials.has(name))) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Creation resource already exists.');
  const declaredMaterials = new Set([...materials, ...validation.scope.materials]);
  const inspectMaterials = value => {
    if (Array.isArray(value)) return value.forEach(inspectMaterials);
    if (!value || typeof value !== 'object') return;
    if (validation.scope.host_metadata && HOST_CREATION_METADATA_OPS.has(value.op)) return;
    for (const [key, item] of Object.entries(value)) {
      if (MATERIAL_SPEC_FIELDS.has(key) && item !== null && typeof item !== 'string') throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Scoped material references must be strings.');
      if (MATERIAL_SPEC_FIELDS.has(key) && typeof item === 'string' && !declaredMaterials.has(item)) throw new AgentContractError('OPERATION_NOT_ALLOWED', `Creation material is neither declared nor already present: ${item}`);
      inspectMaterials(item);
    }
  };
  inspectMaterials(document.operations);
  const objects = [...(model.groups || []), ...(model.instances || [])];
  if (validation.scope.host_metadata?.root_ids.some(id => objects.some(item => [item.id, item.adopted_id, item.persistent_id].includes(id)))) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Host metadata target already exists.');
  for (const operation of validation.root_objects) {
    if (objects.some(item => item.id === operation.id || item.name === operation.name)) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Creation object already exists.');
  }
  return validation;
}
