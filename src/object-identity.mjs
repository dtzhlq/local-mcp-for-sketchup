import { nonEmptyString } from './object-operation-utils.mjs';
import { mockStructuralPersistentId, parseCanonicalMockPidPath } from './mock-structural-identity.mjs';

const NESTED_EDIT_OPERATIONS = new Set([
  'delete',
  'rename',
  'set_material',
  'set_visibility',
  'transform_object',
  'assign_tag',
  'attribute',
  'classification',
  'texture_transform',
  'remove_attribute',
  'set_face_material',
  'reverse_face',
  'pushpull_face',
  'set_edge_properties',
  'duplicate_entity',
  'replace_component_definition',
  'explode_entity',
  'erase_entities',
  'transform_entities',
  'cut_hole',
  'cut_slot',
  'cut_recess',
  'add_boss',
  'add_raised_rib',
  'boolean_union',
  'boolean_difference',
  'boolean_intersect',
  'manifold_check',
  'manifold_repair'
]);

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
    if (!['component_definition', 'instance_path'].includes(editScope)) throw new Error(`${opName}.edit_scope must be component_definition or instance_path for nested targets`);
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
  if (reference?.entity_path?.startsWith('mock:')) return findMockPersistentObject(model, reference, required);
  if (reference?.entity_path?.startsWith('pid:')) return findMockCanonicalPidObject(model, reference, required);
  if (reference?.entity_path) return findNestedDefinitionObject(model, reference, required);
  const groupIndex = model.groups.findIndex((group) => matchesObjectReference(group, reference));
  if (groupIndex >= 0) return { collection: 'groups', index: groupIndex, item: model.groups[groupIndex] };
  const instanceIndex = (model.instances || []).findIndex((instance) => matchesObjectReference(instance, reference));
  if (instanceIndex >= 0) return { collection: 'instances', index: instanceIndex, item: model.instances[instanceIndex] };
  if (required) throw new Error(`object not found: ${referenceLabel(reference)}`);
  return null;
}

function findMockCanonicalPidObject(model, reference, required) {
  const persistentIds = parseCanonicalMockPidPath(reference.entity_path);
  let groupItems = model.groups || [];
  let instanceItems = model.instances || [];
  let ancestors = [];
  let current = null;
  let collection = null;
  let collectionName = null;
  let index = -1;
  let definition = null;
  let definitionName = null;
  let parentGroup = null;

  for (let segmentIndex = 0; segmentIndex < persistentIds.length; segmentIndex += 1) {
    const persistentId = persistentIds[segmentIndex];
    const candidates = [];
    for (const [entityType, items, name] of [
      ['group', groupItems, 'groups'],
      ['component_instance', instanceItems, 'instances']
    ]) {
      items.forEach((item, itemIndex) => {
        const candidateId = mockStructuralPersistentId(item, entityType, ancestors);
        if (candidateId === persistentId) candidates.push({ entityType, items, name, item, itemIndex, persistentId: candidateId });
      });
    }
    if (candidates.length !== 1) {
      if (required) throw new Error(`mock canonical persistent path segment resolved ${candidates.length} objects: ${persistentId}`);
      return null;
    }
    const candidate = candidates[0];
    current = candidate.item;
    collection = candidate.items;
    collectionName = candidate.name;
    index = candidate.itemIndex;
    ancestors = [...ancestors, candidate.persistentId];

    if (reference.instance_policy === 'make_unique' && candidate.entityType === 'component_instance') {
      if (reference.instance_id && !nestedStableReferences(current).includes(String(reference.instance_id))) {
        throw new Error(`make_unique instance ${reference.instance_id} does not match canonical persistent path segment ${persistentId}`);
      }
      current = makeMockInstanceUnique(model, current);
      collection[index] = current;
    }

    if (segmentIndex === persistentIds.length - 1) {
      const affectedInstanceCount = definitionName ? countMockDefinitionInstances(model, definitionName) : 1;
      return {
        collection: collectionName,
        collection_ref: collection,
        index,
        item: current,
        nested: segmentIndex > 0,
        definition,
        definition_name: definitionName,
        entity_type: candidate.entityType,
        parent_group: parentGroup,
        affected_instance_count: reference.instance_policy === 'make_unique' ? 1 : affectedInstanceCount,
        instance_policy: reference.instance_policy,
        persistent_id_path: reference.entity_path
      };
    }

    if (candidate.entityType === 'component_instance') {
      definitionName = current.definition;
      definition = model.component_definitions?.[definitionName];
      if (!definition) throw new Error(`component definition not found for mock canonical persistent path: ${definitionName}`);
      groupItems = definition.groups || [];
      instanceItems = definition.instances || [];
      parentGroup = null;
    } else {
      parentGroup = current;
      groupItems = current.groups || [];
      instanceItems = current.instances || [];
    }
  }
  if (required) throw new Error(`object not found: ${referenceLabel(reference)}`);
  return null;
}

function findMockPersistentObject(model, reference, required) {
  const segments = parseMockPersistentEntityPath(reference.entity_path);
  let current = null;
  let definition = null;
  let definitionName = null;
  let collection = null;
  let collectionName = null;
  let index = -1;
  let parentGroup = null;
  const root = segments[0];
  if (root.entity_type === 'group') {
    collection = model.groups || [];
    collectionName = 'groups';
  } else if (root.entity_type === 'component_instance') {
    collection = model.instances || [];
    collectionName = 'instances';
  } else {
    if (required) throw new Error('mock persistent entity path must start with a group or component_instance');
    return null;
  }
  index = collection.findIndex((item) => nestedStableReferences(item).includes(root.reference));
  if (index < 0) {
    if (required) throw new Error(`mock persistent path root not found: ${root.reference}`);
    return null;
  }
  current = collection[index];

  if (reference.instance_policy === 'make_unique' && root.entity_type === 'component_instance') {
    if (reference.instance_id && !nestedStableReferences(current).includes(String(reference.instance_id))) {
      throw new Error(`make_unique instance ${reference.instance_id} does not match persistent path root ${root.reference}`);
    }
    current = makeMockInstanceUnique(model, current);
    collection[index] = current;
  }

  for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (current?.definition) {
      definitionName = current.definition;
      definition = model.component_definitions?.[definitionName];
      if (!definition) throw new Error(`component definition not found for mock persistent path: ${definitionName}`);
      if (segment.entity_type === 'group') {
        collection = definition.groups || [];
        collectionName = 'groups';
      } else if (segment.entity_type === 'component_instance') {
        collection = definition.instances || [];
        collectionName = 'instances';
      } else {
        throw new Error(`mock persistent path cannot resolve ${segment.entity_type} directly under component instance`);
      }
      index = collection.findIndex((item) => nestedStableReferences(item).includes(segment.reference));
      if (index < 0) throw new Error(`mock persistent path segment not found: ${segment.reference}`);
      current = collection[index];
      if (reference.instance_policy === 'make_unique' && segment.entity_type === 'component_instance') {
        current = makeMockInstanceUnique(model, current);
        collection[index] = current;
      }
      continue;
    }
    if (segment.entity_type === 'face' || segment.entity_type === 'edge') {
      parentGroup = current;
      const key = segment.entity_type === 'face' ? '_face_states' : '_edge_states';
      ensureMockSubentityStates(parentGroup, segment.entity_type, Number(parentGroup[segment.entity_type === 'face' ? 'faces' : 'edges'] || 0));
      collection = parentGroup[key];
      collectionName = key;
      index = collection.findIndex((item) => nestedStableReferences(item).includes(segment.reference));
      if (index < 0) throw new Error(`mock persistent ${segment.entity_type} not found: ${segment.reference}`);
      current = collection[index];
      if (segmentIndex !== segments.length - 1) throw new Error(`${segment.entity_type} must be the leaf of a mock persistent path`);
      continue;
    }
    throw new Error(`mock persistent path cannot descend through ${current?.entity_type || 'entity'}`);
  }

  const affectedInstanceCount = definitionName
    ? countMockDefinitionInstances(model, definitionName)
    : 1;
  return {
    collection: collectionName,
    collection_ref: collection,
    index,
    item: current,
    nested: segments.length > 1,
    definition,
    definition_name: definitionName,
    entity_type: segments.at(-1).entity_type,
    parent_group: parentGroup,
    affected_instance_count: reference.instance_policy === 'make_unique' ? 1 : affectedInstanceCount,
    instance_policy: reference.instance_policy,
    persistent_id_path: reference.entity_path
  };
}

export function ensureMockSubentityStates(group, entityType, count) {
  const key = entityType === 'face' ? '_face_states' : '_edge_states';
  group[key] ||= [];
  while (group[key].length < count) {
    const index = group[key].length;
    const boxNormals = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
    group[key].push({
      entity_type: entityType,
      persistent_id: `${group.id || group.name}:${entityType}:${index + 1}`,
      id: `${group.id || group.name}:${entityType}:${index + 1}`,
      material: entityType === 'face' ? group.material || null : null,
      normal: entityType === 'face' ? boxNormals[index % boxNormals.length] : null,
      visible: true,
      bounding_box: group.bounding_box || null
    });
  }
  return group[key].slice(0, count);
}

function makeMockInstanceUnique(model, instance) {
  const definition = model.component_definitions?.[instance.definition];
  if (!definition) throw new Error(`make_unique definition not found: ${instance.definition}`);
  if (countMockDefinitionInstances(model, instance.definition) <= 1) return instance;
  const base = `${instance.definition}__${safeIdentityToken(instance.id || instance.name)}__unique`;
  const uniqueName = uniqueDefinitionName(model, base);
  const clone = structuredClone(definition);
  clone.name = uniqueName;
  model.component_definitions[uniqueName] = clone;
  instance.definition = uniqueName;
  return instance;
}

function countMockDefinitionInstances(model, definitionName) {
  let count = 0;
  const walk = (instance, stack = []) => {
    if (instance.definition === definitionName) count += 1;
    if (stack.includes(instance.definition)) return;
    const definition = model.component_definitions?.[instance.definition];
    for (const nested of definition?.instances || []) walk(nested, [...stack, instance.definition]);
  };
  for (const instance of model.instances || []) walk(instance);
  return count;
}

export function definitionEntityPath(definitionName, entityType, stableReference) {
  if (!['group', 'component_instance'].includes(entityType)) throw new Error(`unsupported nested entity type: ${entityType}`);
  return `definition:${encodeEntityPathToken(definitionName)}/${entityType}:${encodeEntityPathToken(stableReference)}`;
}

export function mockPersistentEntityPath(segments) {
  if (!Array.isArray(segments) || !segments.length) throw new Error('mock persistent entity path requires at least one segment');
  return `mock:${segments.map((segment) => `${segment.entity_type}:${encodeEntityPathToken(segment.reference)}`).join('/')}`;
}

export function parseMockPersistentEntityPath(value) {
  const raw = String(value || '');
  if (!raw.startsWith('mock:')) throw new Error('mock persistent entity path must start with mock:');
  const segments = raw.slice(5).split('/').filter(Boolean).map((segment) => {
    const split = segment.indexOf(':');
    if (split < 1) throw new Error('mock persistent entity path contains an invalid segment');
    const entityType = segment.slice(0, split);
    if (!['group', 'component_instance', 'face', 'edge'].includes(entityType)) throw new Error(`unsupported mock persistent entity type: ${entityType}`);
    return { entity_type: entityType, reference: decodeEntityPathToken(segment.slice(split + 1)) };
  });
  if (!segments.length) throw new Error('mock persistent entity path must contain at least one segment');
  return segments;
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
    collection_ref: collection,
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
