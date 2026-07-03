import { createSnapshot } from './snapshot.mjs';
import { entityListFromSnapshot, modelInfoFromSnapshot } from './model-inspection.mjs';

export const ADOPTION_VERSION = '2026-07-natural-iteration-adoption.1';

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
  return {
    kind: 'adopt_open_model',
    version: ADOPTION_VERSION,
    runtime,
    adopted_count: adopted,
    existing_count: existing,
    entity_count: entities.length,
    recursive,
    read_only_nested_count: readOnlyNested,
    model_info: modelInfoFromSnapshot(snapshot, { runtime }),
    entities,
    recursive_index: recursive ? recursiveIndex : undefined,
    snapshot
  };
}

function mockRecursiveIndex(model, options = {}) {
  const limit = positiveInteger(options.recursive_limit ?? options.recursiveLimit ?? 500, 500);
  const entries = [];
  for (const [definitionName, definition] of Object.entries(model.component_definitions || {})) {
    for (const [index, group] of (definition.groups || []).entries()) {
      if (entries.length >= limit) return entries;
      entries.push({
        path: `definition:${definitionName}/group:${index}`,
        parent_definition: definitionName,
        name: group.name,
        entity_type: 'group',
        kind: group.kind || 'group',
        material: group.material || null,
        bounding_box: group.bounding_box || null,
        faces: group.faces || 0,
        edges: group.edges || 0,
        editable: false,
        edit_scope: 'component_definition_read_only',
        warning: 'Nested definition entities are indexed for reference only in this slice; edit the top-level instance unless definition-wide editing is explicitly implemented.'
      });
    }
  }
  return entries;
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
