import { createSnapshot } from './snapshot.mjs';
import { entityListFromSnapshot, modelInfoFromSnapshot } from './model-inspection.mjs';
import { definitionEntityPath } from './object-identity.mjs';

export const ADOPTION_VERSION = '2026-07-natural-iteration-adoption.2';

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
    read_only_nested_count: readOnlyNested,
    editable_nested_count: editableNested,
    model_info: modelInfoFromSnapshot(snapshot, { runtime }),
    entities,
    recursive_index: recursive ? recursiveIndex : undefined,
    snapshot
  };
}

function mockRecursiveIndex(model, options = {}) {
  const limit = positiveInteger(options.recursive_limit ?? options.recursiveLimit ?? 500, 500);
  const prefix = safePrefix(options.prefix || 'adopted');
  const entries = [];
  for (const [definitionName, definition] of Object.entries(model.component_definitions || {})) {
    const affectedInstanceCount = (model.instances || []).filter((instance) => instance.definition === definitionName).length;
    for (const [entityType, collection] of [['group', definition.groups || []], ['component_instance', definition.instances || []]]) {
      for (const [index, item] of collection.entries()) {
        if (entries.length >= limit) return entries;
        const stableReference = item.id || item.adopted_id || item.persistent_id || nestedAdoptionId(prefix, definitionName, entityType, item, index);
        item.id ||= stableReference;
        item.adopted_id ||= stableReference;
        const entityPath = definitionEntityPath(definitionName, entityType, stableReference);
        entries.push({
          path: entityPath,
          entity_path: entityPath,
          parent_definition: definitionName,
          definition_name: definitionName,
          reference: stableReference,
          name: item.name,
          entity_type: entityType,
          kind: item.kind || entityType,
          material: item.material || null,
          visible: item.visible !== false && item.hidden !== true,
          bounding_box: item.bounding_box || null,
          faces: item.faces || 0,
          edges: item.edges || 0,
          editable: true,
          edit_scope: 'component_definition',
          allowed_operations: ['rename', 'set_material', 'set_visibility', 'transform_object'],
          affected_instance_count: affectedInstanceCount,
          shared_definition: affectedInstanceCount > 1,
          instance_policy_required: true,
          warning: 'Definition-wide edits affect every instance; use instance_policy=make_unique with instance_id for a per-instance edit.'
        });
      }
    }
  }
  return entries;
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
