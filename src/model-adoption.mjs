import { createSnapshot } from './snapshot.mjs';
import { entityListFromSnapshot, modelInfoFromSnapshot } from './model-inspection.mjs';
import { definitionEntityPath, mockPersistentEntityPath } from './object-identity.mjs';

export const ADOPTION_VERSION = '2026-07-existing-model-editing.1';

export function adoptMockModel(model, options = {}) {
  const prefix = safePrefix(options.prefix || 'adopted');
  const force = options.force === true;
  const entities = [
    ...(model.groups || []).map((item, index) => ({ item, index, entity_type: 'group' })),
    ...(model.instances || []).map((item, index) => ({ item, index, entity_type: 'component_instance' }))
  ];
  let adopted = 0;
  let existing = 0;
  for (const entry of entities) {
    const current = entry.item.id || entry.item.adopted_id;
    if (current && !force) {
      existing += 1;
      entry.item.adopted_id ||= current;
      continue;
    }
    const nextId = adoptionId(prefix, entry);
    entry.item.id = nextId;
    entry.item.adopted_id = nextId;
    entry.item.attributes ||= {};
    entry.item.attributes.AlmaSketchupMCP ||= {};
    entry.item.attributes.AlmaSketchupMCP.adopted_id = nextId;
    entry.item.attributes.AlmaSketchupMCP.adoption_version = ADOPTION_VERSION;
    adopted += 1;
  }
  const snapshot = createSnapshot(model);
  return adoptionReport({
    runtime: 'mock',
    snapshot,
    adopted,
    existing,
    recursive: options.recursive === true,
    recursiveIndex: options.recursive === true ? mockRecursiveIndex(model, options) : []
  });
}

export function adoptionReport({ runtime, snapshot, adopted, existing, recursive = false, recursiveIndex = [] }) {
  const entities = entityListFromSnapshot(snapshot, { includeHidden: true }).map((entity) => ({
    ...entity,
    editable: true,
    edit_scope: 'top_level',
    reference: entity.id || entity.persistent_id || entity.name
  }));
  const readOnlyNested = recursiveIndex.filter((entry) => entry.editable === false).length;
  const editableNested = recursiveIndex.filter((entry) => entry.editable === true).length;
  return {
    kind: 'adopt_open_model',
    version: ADOPTION_VERSION,
    runtime,
    adopted_count: adopted,
    existing_count: existing,
    entity_count: entities.length,
    recursive,
    recursive_truncated: Boolean(recursiveIndex.truncated),
    recursive_total_seen: recursiveIndex.total_seen ?? recursiveIndex.length,
    read_only_nested_count: readOnlyNested,
    editable_nested_count: editableNested,
    model_info: modelInfoFromSnapshot(snapshot, { runtime }),
    entities,
    recursive_index: recursive ? [...recursiveIndex] : undefined,
    snapshot
  };
}

function mockRecursiveIndex(model, options = {}) {
  const limit = positiveInteger(options.recursive_limit ?? options.recursiveLimit ?? 500, 500);
  const prefix = safePrefix(options.prefix || 'adopted');
  const entries = [];
  let totalSeen = 0;
  const definitionCounts = countMockDefinitionOccurrences(model);
  const push = (entry) => {
    totalSeen += 1;
    if (entries.length < limit) entries.push(entry);
  };
  const walkGroupGeometry = (group, segments, definitionName, affectedInstanceCount) => {
    const faceStates = ensureMockSubentityStates(group, 'face', Number(group.faces || 0));
    const edgeStates = ensureMockSubentityStates(group, 'edge', Number(group.edges || 0));
    for (const state of [...faceStates, ...edgeStates]) {
      const entityPath = mockPersistentEntityPath([...segments, { entity_type: state.entity_type, reference: state.persistent_id }]);
      push(mockOccurrenceEntry(state, entityPath, definitionName, affectedInstanceCount));
    }
  };
  const walkDefinition = (definitionName, segments, definitionStack = []) => {
    if (definitionStack.includes(definitionName)) return;
    const definition = model.component_definitions?.[definitionName];
    if (!definition) return;
    const affectedInstanceCount = definitionCounts.get(definitionName) || 0;
    for (const [index, item] of (definition.groups || []).entries()) {
      const stableReference = ensureMockStableReference(item, prefix, definitionName, 'group', index);
      const nextSegments = [...segments, { entity_type: 'group', reference: stableReference }];
      const entityPath = mockPersistentEntityPath(nextSegments);
      push(mockOccurrenceEntry(item, entityPath, definitionName, affectedInstanceCount, definitionEntityPath(definitionName, 'group', stableReference)));
      walkGroupGeometry(item, nextSegments, definitionName, affectedInstanceCount);
    }
    for (const [index, item] of (definition.instances || []).entries()) {
      const stableReference = ensureMockStableReference(item, prefix, definitionName, 'component_instance', index);
      const nextSegments = [...segments, { entity_type: 'component_instance', reference: stableReference }];
      const entityPath = mockPersistentEntityPath(nextSegments);
      push(mockOccurrenceEntry(item, entityPath, definitionName, affectedInstanceCount, definitionEntityPath(definitionName, 'component_instance', stableReference)));
      walkDefinition(item.definition, nextSegments, [...definitionStack, definitionName]);
    }
  };
  for (const [index, group] of (model.groups || []).entries()) {
    const stableReference = ensureMockStableReference(group, prefix, 'model', 'group', index);
    walkGroupGeometry(group, [{ entity_type: 'group', reference: stableReference }], null, 1);
  }
  for (const [index, instance] of (model.instances || []).entries()) {
    const stableReference = ensureMockStableReference(instance, prefix, 'model', 'component_instance', index);
    walkDefinition(instance.definition, [{ entity_type: 'component_instance', reference: stableReference }]);
  }
  Object.defineProperties(entries, {
    truncated: { value: totalSeen > limit, enumerable: false },
    total_seen: { value: totalSeen, enumerable: false }
  });
  return entries;
}

function mockOccurrenceEntry(item, entityPath, definitionName, affectedInstanceCount, legacyEntityPath = null) {
  const entityType = item.entity_type || 'group';
  const editable = ['group', 'component_instance', 'face', 'edge'].includes(entityType);
  return {
    path: entityPath,
    entity_path: entityPath,
    persistent_id_path: entityPath,
    legacy_entity_path: legacyEntityPath,
    parent_definition: definitionName,
    definition_name: definitionName,
    reference: item.id || item.persistent_id,
    name: item.name || null,
    entity_type: entityType,
    kind: item.kind || entityType,
    material: item.material || null,
    back_material: item.back_material || null,
    visible: item.visible !== false && item.hidden !== true,
    soft: item.soft === true,
    smooth: item.smooth === true,
    reversed: item.reversed === true,
    bounding_box: item.bounding_box || null,
    faces: item.faces || 0,
    edges: item.edges || 0,
    vertices: item.vertices || 0,
    features: Array.isArray(item.features) ? item.features : [],
    editable,
    edit_scope: 'instance_path',
    allowed_operations: allowedMockOperations(entityType),
    affected_instance_count: affectedInstanceCount,
    shared_definition: affectedInstanceCount > 1,
    instance_policy_required: Boolean(definitionName),
    warning: definitionName ? 'Definition-wide edits affect every occurrence; use instance_policy=make_unique for one occurrence.' : null
  };
}

function allowedMockOperations(entityType) {
  if (entityType === 'face') return ['set_material', 'set_face_material', 'set_visibility', 'attribute', 'remove_attribute', 'reverse_face', 'pushpull_face', 'erase_entities', 'transform_entities'];
  if (entityType === 'edge') return ['set_visibility', 'attribute', 'remove_attribute', 'set_edge_properties', 'erase_entities', 'transform_entities'];
  return ['delete', 'rename', 'set_material', 'set_visibility', 'transform_object', 'assign_tag', 'attribute', 'remove_attribute', 'classification', 'texture_transform', 'duplicate_entity', 'replace_component_definition', 'explode_entity', 'erase_entities', 'transform_entities', 'cut_hole', 'cut_slot', 'cut_recess', 'add_boss', 'add_raised_rib', 'boolean_union', 'boolean_difference', 'boolean_intersect', 'manifold_check', 'manifold_repair'];
}

function ensureMockStableReference(item, prefix, definitionName, entityType, index) {
  const stableReference = item.id || item.adopted_id || item.persistent_id || nestedAdoptionId(prefix, definitionName, entityType, item, index);
  item.id ||= stableReference;
  item.adopted_id ||= stableReference;
  item.entity_type ||= entityType;
  return String(stableReference);
}

function ensureMockSubentityStates(group, entityType, count) {
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

function countMockDefinitionOccurrences(model) {
  const counts = new Map();
  const walk = (definitionName, stack = []) => {
    counts.set(definitionName, (counts.get(definitionName) || 0) + 1);
    if (stack.includes(definitionName)) return;
    const definition = model.component_definitions?.[definitionName];
    for (const instance of definition?.instances || []) walk(instance.definition, [...stack, definitionName]);
  };
  for (const instance of model.instances || []) walk(instance.definition);
  return counts;
}

function nestedAdoptionId(prefix, definitionName, entityType, item, index) {
  const seed = item.id || item.persistent_id || item.name || `${entityType}-${index + 1}`;
  return `${prefix}-nested-${safeToken(definitionName)}-${safeToken(seed)}`;
}

function adoptionId(prefix, { item, index, entity_type }) {
  const persistent = item.persistent_id || item.persistentId;
  if (persistent) return `${prefix}-${entity_type}-${safeToken(persistent)}`;
  const name = item.name ? safeToken(item.name) : null;
  return `${prefix}-${entity_type}-${name || index + 1}`;
}

function safePrefix(value) {
  return safeToken(value || 'adopted') || 'adopted';
}

function safeToken(value) {
  return String(value || '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
