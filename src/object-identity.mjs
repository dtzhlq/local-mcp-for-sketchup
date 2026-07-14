import { nonEmptyString } from './object-operation-utils.mjs';

const NESTED_EDIT_OPERATIONS = new Set(['rename', 'set_material', 'set_visibility', 'transform_object']);

export function objectId(operation, fallbackName) {
  return nonEmptyString(operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid ?? fallbackName, `${fallbackName}.id`);
}

export function objectIdentityFields(operation = {}) {
  const explicitId = operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid;
  return explicitId === undefined ? {} : { id: explicitId };
}

export function assertObjectIdentityAvailable(model, reference) {
  const duplicateById = findModelObject(model, { id: reference.id }, false);
  if (duplicateById) throw new Error(`object id already exists: ${reference.id}`);
  const duplicateByName = findModelObject(model, { name: reference.name }, false);
  if (duplicateByName) throw new Error(`object name already exists: ${reference.name}`);
}

export function resolveObjectReference(operation, opName) {
  const rawEntityPath = operation.entity_path ?? operation.entityPath ?? operation.target_path ?? operation.targetPath;
  if (rawEntityPath !== undefined) {
    if (!NESTED_EDIT_OPERATIONS.has(opName)) throw new Error(`${opName} does not support nested entity_path targets`);
    const editScope = operation.edit_scope ?? operation.editScope;
    if (editScope !== 'component_definition') throw new Error(`${opName}.edit_scope must be component_definition for nested targets`);
    const instancePolicy = operation.instance_policy ?? operation.instancePolicy;
    if (!['definition_wide', 'make_unique'].includes(instancePolicy)) {
      throw new Error(`${opName}.instance_policy must be definition_wide or make_unique for nested targets`);
    }
    const instanceId = operation.instance_id ?? operation.instanceId;
    if (instancePolicy === 'make_unique' && (instanceId === undefined || String(instanceId).trim() === '')) {
      throw new Error(`${opName}.instance_id is required when instance_policy=make_unique`);
    }
    return {
      entity_path: nonEmptyString(rawEntityPath, `${opName}.entity_path`),
      edit_scope: editScope,
      instance_policy: instancePolicy,
      ...(instanceId !== undefined ? { instance_id: String(instanceId) } : {})
    };
  }
  const rawId = operation.target_id ?? operation.targetId ?? operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid;
  const rawName = operation.name ?? operation.target ?? operation.object;
  const reference = {};
  if (rawId !== undefined) reference.id = nonEmptyString(rawId, `${opName}.target_id`);
  if (rawName !== undefined) reference.name = nonEmptyString(rawName, `${opName}.name`);
  if (!reference.id && !reference.name) throw new Error(`${opName} requires target_id or name`);
  return reference;
}

export function matchesObjectReference(item, reference) {
  const idMatches = !reference.id || item.id === reference.id || item.guid === reference.id || item.persistent_id === reference.id;
  const nameMatches = !reference.name || item.name === reference.name;
  return idMatches && nameMatches;
}

export function referenceLabel(reference) {
  return [
    reference.entity_path ? `entity_path:${reference.entity_path}` : null,
    reference.id ? `id:${reference.id}` : null,
    reference.name ? `name:${reference.name}` : null
  ].filter(Boolean).join(' ');
}

export function findModelObject(model, reference, required = true) {
  if (reference?.entity_path) return findNestedDefinitionObject(model, reference, required);
  const groupIndex = model.groups.findIndex((group) => matchesObjectReference(group, reference));
  if (groupIndex >= 0) return { collection: 'groups', index: groupIndex, item: model.groups[groupIndex] };
  const instanceIndex = (model.instances || []).findIndex((instance) => matchesObjectReference(instance, reference));
  if (instanceIndex >= 0) return { collection: 'instances', index: instanceIndex, item: model.instances[instanceIndex] };
  if (required) throw new Error(`object not found: ${referenceLabel(reference)}`);
  return null;
}

export function definitionEntityPath(definitionName, entityType, stableReference) {
  if (!['group', 'component_instance'].includes(entityType)) throw new Error(`unsupported nested entity type: ${entityType}`);
  return `definition:${encodeEntityPathToken(definitionName)}/${entityType}:${encodeEntityPathToken(stableReference)}`;
}

export function parseDefinitionEntityPath(value) {
  const match = /^definition:([^/]+)\/(group|component_instance):([^/]+)$/.exec(String(value || ''));
  if (!match) throw new Error('entity_path must use definition:<token>/<group|component_instance>:<token>');
  return {
    definition_name: decodeEntityPathToken(match[1]),
    entity_type: match[2],
    stable_reference: decodeEntityPathToken(match[3])
  };
}

export function refreshNestedDefinition(model, target) {
  if (!target?.nested || !target.definition) return;
  const definition = target.definition;
  const items = [...(definition.groups || []), ...(definition.instances || [])];
  definition.faces = items.reduce((sum, item) => sum + Number(item.faces || 0), 0);
  definition.edges = items.reduce((sum, item) => sum + Number(item.edges || 0), 0);
  definition.material = items.find((item) => item.material)?.material || null;
  definition.bounding_box = mergeBoundingBoxes(items.map((item) => item.bounding_box).filter(Boolean));
}

function findNestedDefinitionObject(model, reference, required) {
  const parsed = parseDefinitionEntityPath(reference.entity_path);
  let definitionName = parsed.definition_name;
  let definition = model.component_definitions?.[definitionName];
  if (!definition) {
    if (required) throw new Error(`component definition not found for entity_path: ${definitionName}`);
    return null;
  }

  let affectedInstanceCount = (model.instances || []).filter((instance) => instance.definition === definitionName).length;
  if (reference.instance_policy === 'make_unique') {
    const instance = (model.instances || []).find((item) => matchesObjectReference(item, { id: reference.instance_id }) || matchesObjectReference(item, { name: reference.instance_id }));
    if (!instance) throw new Error(`make_unique instance not found: ${reference.instance_id}`);
    if (instance.definition !== definitionName) throw new Error(`make_unique instance ${reference.instance_id} does not use definition ${definitionName}`);
    const uniqueName = uniqueDefinitionName(model, `${definitionName}__${safeIdentityToken(instance.id || instance.name)}__unique`);
    const clone = structuredClone(definition);
    clone.name = uniqueName;
    model.component_definitions[uniqueName] = clone;
    instance.definition = uniqueName;
    definitionName = uniqueName;
    definition = clone;
    affectedInstanceCount = 1;
  }

  const collectionName = parsed.entity_type === 'group' ? 'groups' : 'instances';
  const collection = definition[collectionName] || [];
  const index = collection.findIndex((item) => nestedStableReferences(item).includes(parsed.stable_reference));
  if (index < 0) {
    if (required) throw new Error(`nested object not found: ${referenceLabel(reference)}`);
    return null;
  }
  return {
    collection: collectionName,
    index,
    item: collection[index],
    nested: true,
    definition,
    definition_name: definitionName,
    entity_type: parsed.entity_type,
    affected_instance_count: affectedInstanceCount,
    instance_policy: reference.instance_policy
  };
}

function nestedStableReferences(item = {}) {
  return [item.id, item.adopted_id, item.persistent_id, item.guid, item.name].filter((value) => value !== undefined && value !== null).map(String);
}

function uniqueDefinitionName(model, base) {
  if (!model.component_definitions?.[base]) return base;
  let index = 2;
  while (model.component_definitions[`${base}_${index}`]) index += 1;
  return `${base}_${index}`;
}

function safeIdentityToken(value) {
  return String(value || 'instance').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'instance';
}

function encodeEntityPathToken(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function decodeEntityPathToken(value) {
  try {
    return Buffer.from(String(value), 'base64url').toString('utf8');
  } catch (_) {
    throw new Error('entity_path contains an invalid base64url token');
  }
}

function mergeBoundingBoxes(boxes) {
  if (!boxes.length) return null;
  const min = [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => Number(box.min?.[axis] ?? 0))));
  const max = [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => Number(box.max?.[axis] ?? 0))));
  return { min, max, w: max[0] - min[0], d: max[1] - min[1], h: max[2] - min[2] };
}

export function identityMatrix3() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

export function rotationZMatrix(angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

export function boxVertices([x, y, z], [w, d, h]) {
  return [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
    [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]
  ];
}
