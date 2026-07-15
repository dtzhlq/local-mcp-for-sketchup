import path from 'node:path';
import { findModelObject, matchesObjectReference } from './object-identity.mjs';

export function modelInfoFromSnapshot(snapshot, { runtime = 'mock', sourcePath = null } = {}) {
  return {
    kind: 'model_info',
    runtime,
    units: 'mm',
    source_path: sourcePath,
    totals: snapshot.totals,
    bounding_box: snapshot.bounding_box,
    counts: {
      groups: snapshot.groups?.length || 0,
      instances: snapshot.instances?.length || 0,
      component_definitions: snapshot.component_definitions?.length || 0,
      materials: snapshot.materials?.length || 0,
      tags: snapshot.tags?.length || 0,
      scenes: snapshot.scenes?.length || 0,
      image_references: snapshot.image_references?.length || 0
    },
    warning_summary: snapshot.warning_summary,
    material_names: snapshot.material_names || [],
    component_definitions: snapshot.component_definitions || [],
    tags: snapshot.tags || [],
    scenes: snapshot.scenes || []
  };
}

export function entityListFromSnapshot(snapshot, options = {}) {
  const {
    includeHidden = true,
    kind,
    material,
    tag,
    name
  } = options;
  const namePattern = name ? new RegExp(name, 'i') : null;
  return [
    ...(snapshot.groups || []).map((item) => ({ ...item, entity_type: 'group' })),
    ...(snapshot.instances || []).map((item) => ({ ...item, entity_type: 'component_instance' }))
  ].filter((item) => {
    if (!includeHidden && item.visible === false) return false;
    if (kind && item.kind !== kind) return false;
    if (material && item.material !== material) return false;
    if (tag && item.tag !== tag) return false;
    if (namePattern && !namePattern.test(item.name || '')) return false;
    return true;
  }).map((item) => ({
    id: item.id,
    persistent_id: item.persistent_id,
    name: item.name,
    entity_type: item.entity_type,
    kind: item.kind || item.definition || item.entity_type,
    definition: item.definition,
    visible: item.visible !== false,
    locked: item.locked === true,
    faces: item.faces,
    edges: item.edges,
    vertices: item.vertices,
    bounding_box: item.bounding_box,
    material: item.material,
    tag: item.tag,
    classification: item.classification,
    attributes: item.attributes,
    texture_transform: item.texture_transform,
    face_uvs: item.face_uvs,
    features: item.features,
    transform: item.transform,
    image: item.image,
    qa: item.qa
  }));
}

export function inspectSnapshot(snapshot, options = {}) {
  const runtime = options.runtime || 'mock';
  return {
    kind: 'inspect_model',
    runtime,
    model_info: modelInfoFromSnapshot(snapshot, { runtime, sourcePath: options.sourcePath }),
    entities: options.includeEntities === false ? undefined : entityListFromSnapshot(snapshot, options),
    selection: options.selection || [],
    snapshot: options.includeSnapshot === true ? snapshot : undefined
  };
}

export function selectionFromModel(model) {
  const selected = [];
  const references = model.selection || [];
  for (const reference of references) {
    const match = findModelObject(model, reference, false);
    if (match) {
      selected.push(selectionEntity(match.item, match.collection));
    }
  }
  return selected;
}

export function setModelSelection(model, { targets = [], mode = 'replace' } = {}) {
  const normalizedMode = normalizeSelectionMode(mode);
  if (normalizedMode === 'clear') {
    model.selection = [];
    return selectionFromModel(model);
  }
  const targetList = normalizeSelectionTargets(targets);
  const resolved = targetList.map((target) => {
    const match = findModelObject(model, target, true);
    return {
      id: match.item.id || match.item.persistent_id || match.item.name,
      name: match.item.name
    };
  });
  const existing = normalizedMode === 'replace' ? [] : [...(model.selection || [])];
  const next = normalizedMode === 'remove'
    ? existing.filter((item) => !resolved.some((target) => matchesObjectReference(item, target)))
    : uniqueReferences([...existing, ...resolved]);
  model.selection = next;
  return selectionFromModel(model);
}

export function normalizeSelectionTargets(targets) {
  const rawTargets = Array.isArray(targets) ? targets : [targets];
  return rawTargets.filter((target) => target !== undefined && target !== null).map((target, index) => {
    if (typeof target === 'string') return { id: target };
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error(`set_selection.targets[${index}] must be a string id/name or object reference`);
    }
    const reference = {};
    const id = target.target_id ?? target.targetId ?? target.id ?? target.object_id ?? target.objectId ?? target.guid;
    const name = target.name ?? target.target ?? target.object;
    if (id !== undefined) reference.id = String(id);
    if (name !== undefined) reference.name = String(name);
    if (!reference.id && !reference.name) throw new Error(`set_selection.targets[${index}] requires id or name`);
    return reference;
  });
}

export function versionedPath(basePath, {
  defaultBase = path.join('output', 'model.json'),
  label = new Date().toISOString().replace(/[:.]/g, '-'),
  extension
} = {}) {
  const target = path.resolve(basePath || defaultBase);
  const ext = extension || path.extname(target) || '.json';
  const withoutExt = target.endsWith(ext) ? target.slice(0, -ext.length) : target;
  return `${withoutExt}-${safePathLabel(label)}${ext}`;
}

function selectionEntity(item, collection) {
  return {
    id: item.id || item.persistent_id || item.name,
    name: item.name,
    entity_type: collection === 'instances' ? 'component_instance' : 'group',
    kind: item.kind || item.definition || 'group',
    bounding_box: item.bounding_box,
    visible: item.hidden ? false : item.visible !== false
  };
}

function normalizeSelectionMode(mode) {
  const normalized = String(mode || 'replace').toLowerCase();
  if (['replace', 'add', 'remove', 'clear'].includes(normalized)) return normalized;
  throw new Error('set_selection.mode must be replace, add, remove, or clear');
}

function uniqueReferences(references) {
  const seen = new Set();
  const result = [];
  for (const reference of references) {
    const key = reference.id ? `id:${reference.id}` : `name:${reference.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

function safePathLabel(value) {
  const normalized = String(value || 'version').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
  return normalized || 'version';
}
