import { createNativeClassificationSummary, normalizeClassificationSchemas } from './native-classification.mjs';

const VALID_WARNING_TYPES = [
  'geometry.degenerate', 'geometry.bbox_overlap', 'geometry.bbox_collision', 'geometry.bbox_contact', 'material.missing_texture',
  'geometry.non_manifold', 'geometry.boolean_failed',
  'material.pbr_unsupported', 'rendering.unsupported_option',
  'rendering.apply_failed', 'info.limitation', 'info.operation_skipped'
];

const VALID_SEVERITIES = ['error', 'warn', 'info'];

export function addWarning(model, typeOrMessage, severity, message, source) {
  model.warnings ||= [];
  if (typeof severity === 'undefined') {
    model.warnings.push({
      type: 'info.limitation',
      severity: 'info',
      category: 'info',
      message: typeOrMessage,
      source: null
    });
    return;
  }
  if (!VALID_WARNING_TYPES.includes(typeOrMessage)) {
    throw new Error(`Invalid warning type: ${typeOrMessage}`);
  }
  if (!VALID_SEVERITIES.includes(severity)) {
    throw new Error(`Invalid warning severity: ${severity}`);
  }
  model.warnings.push({
    type: typeOrMessage,
    severity,
    category: typeOrMessage.split('.')[0],
    message,
    source: source || null
  });
}

export function createSnapshot(model) {
  const classificationSchemas = normalizeClassificationSchemas(model.classification_schemas || []);
  const componentDefinitionSummaries = Object.entries(model.component_definitions || {}).map(([name, definition]) => ({
    name,
    persistent_id: definition?.persistent_id || null,
    native_classification: createNativeClassificationSummary({
      classificationSchemas,
      attributeDictionaries: definition?.attribute_dictionaries || {},
      valueLookupSupported: true
    })
  })).sort((left, right) => left.name.localeCompare(right.name));
  const nativeClassificationByDefinition = new Map(componentDefinitionSummaries.map((summary) => [summary.name, summary.native_classification]));
  const groups = model.groups.map((group) => {
    const entry = {
      id: group.id || group.name,
      name: group.name,
      kind: group.kind || 'group',
      faces: group.faces,
      edges: group.edges,
      bounding_box: group.bounding_box,
      material: group.material || null,
      tag: group.tag || null,
      classification: group.classification || null,
      native_classification: createNativeClassificationSummary({
        classificationSchemas,
        attributeDictionaries: group.definition_attribute_dictionaries || {},
        valueLookupSupported: true
      }),
      texture_transform: group.texture_transform || null,
      face_uvs: cloneJson(group.face_uvs) || null,
      image: group.image || null,
      attributes: cloneAttributes(group.attributes),
      features: cloneJson(group.features),
      curtain_wall: cloneJson(group.curtain_wall),
      geometry_input: cloneJson(group.geometry_input),
      boolean_operations: cloneJson(group.boolean_operations),
      manifold: cloneJson(group.manifold),
      transform: group.transform || null,
      visible: group.hidden ? false : true,
      locked: group.locked === true,
      qa: group.qa || null
    };
    if (group.vertices && Array.isArray(group.vertices)) {
      entry.vertices = group.vertices.length;
    }
    const resolution = {};
    if (group.segments !== undefined) resolution.segments = group.segments;
    if (group.segments_x !== undefined) resolution.segments_x = group.segments_x;
    if (group.segments_y !== undefined) resolution.segments_y = group.segments_y;
    if (group.segments_z !== undefined) resolution.segments_z = group.segments_z;
    if (Object.keys(resolution).length > 0) entry.resolution_hint = resolution;
    return entry;
  });
  const instances = (model.instances || []).map((instance) => {
    const entry = {
      id: instance.id || instance.name,
      name: instance.name,
      definition: instance.definition,
      faces: instance.faces,
      edges: instance.edges,
      bounding_box: instance.bounding_box,
      material: instance.material || null,
      tag: instance.tag || null,
      classification: instance.classification || null,
      native_classification: nativeClassificationByDefinition.get(instance.definition) || createNativeClassificationSummary({
        classificationSchemas,
        valueLookupSupported: true
      }),
      texture_transform: instance.texture_transform || null,
      face_uvs: cloneJson(instance.face_uvs) || null,
      attributes: cloneAttributes(instance.attributes),
      features: cloneJson(instance.features),
      boolean_operations: cloneJson(instance.boolean_operations),
      manifold: cloneJson(instance.manifold),
      transform: instance.transform || null,
      visible: instance.hidden ? false : true,
      locked: instance.locked === true,
      qa: instance.qa || null
    };
    if (instance.vertices && Array.isArray(instance.vertices)) {
      entry.vertices = instance.vertices.length;
    }
    const resolution = {};
    if (instance.segments !== undefined) resolution.segments = instance.segments;
    if (instance.segments_x !== undefined) resolution.segments_x = instance.segments_x;
    if (instance.segments_y !== undefined) resolution.segments_y = instance.segments_y;
    if (instance.segments_z !== undefined) resolution.segments_z = instance.segments_z;
    if (Object.keys(resolution).length > 0) entry.resolution_hint = resolution;
    return entry;
  });
  const visibleItems = [...groups, ...instances].filter((item) => item.visible !== false);
  const boundingBox = mergeBoundingBoxes(visibleItems.map((item) => item.bounding_box));
  const totals = visibleItems.reduce((acc, item) => {
    acc.faces += item.faces;
    acc.edges += item.edges;
    acc.vertices += (item.vertices || 0);
    return acc;
  }, { faces: 0, edges: 0, vertices: 0, groups: groups.filter((group) => group.visible !== false).length, instances: instances.filter((instance) => instance.visible !== false).length });
  const generatedWarnings = [
    ...model.groups.filter((group) => group.faces === 0 && !isZeroFaceAllowed(group)).map((group) => ({
      type: 'geometry.degenerate',
      severity: 'error',
      category: 'geometry',
      message: `${group.name} has zero faces`,
      source: `group:${group.name}`
    })),
    ...overlapWarnings(visibleItems)
  ];

  const allWarnings = [...(model.warnings || []), ...generatedWarnings];
  const warningSummary = computeWarningSummary(allWarnings);

  const materials = Object.values(model.materials)
    .map((material) => ({ ...material }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const imageReferences = Object.values(model.image_references || {})
    .map((reference) => ({ ...reference }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    totals,
    groups,
    instances,
    manifold_checks: cloneJson(model.manifold_checks) || [],
    component_definitions: Object.keys(model.component_definitions || {}).sort(),
    component_definition_summaries: componentDefinitionSummaries,
    classification_schemas: classificationSchemas,
    scenes: model.scenes || [],
    levels: model.levels || [],
    tags: Object.values(model.tags || {}).map((tag) => ({ ...tag })).sort((a, b) => a.name.localeCompare(b.name)),
    materials,
    material_names: materials.map((material) => material.name),
    image_references: imageReferences,
    style_state: model.style_state || null,
    shadow_state: model.shadow_state || null,
    rendering_options: model.rendering_options || null,
    bounding_box: boundingBox,
    selection: selectionSnapshot(model, groups, instances),
    warnings: allWarnings,
    warning_messages: allWarnings.map((w) => w.message),
    warning_summary: warningSummary,
    view_state: model.view_state || null
  };
}

function selectionSnapshot(model, groups, instances) {
  const references = Array.isArray(model.selection) ? model.selection : [];
  const entities = [
    ...groups.map((item) => ({ ...item, entity_type: 'group' })),
    ...instances.map((item) => ({ ...item, entity_type: 'component_instance' }))
  ];
  return references.flatMap((reference) => {
    const match = entities.find((entity) => matchesSelectionReference(entity, reference));
    if (!match) return [];
    return [{
      id: match.id || match.name,
      name: match.name,
      entity_type: match.entity_type,
      kind: match.kind || match.definition || match.entity_type,
      bounding_box: match.bounding_box,
      visible: match.visible !== false
    }];
  });
}

function matchesSelectionReference(entity, reference) {
  if (typeof reference === 'string') return entity.id === reference || entity.name === reference;
  if (!reference || typeof reference !== 'object') return false;
  const id = reference.id ?? reference.target_id ?? reference.targetId ?? reference.object_id ?? reference.objectId ?? reference.guid;
  const name = reference.name ?? reference.target ?? reference.object;
  return (id === undefined || entity.id === String(id)) && (name === undefined || entity.name === String(name));
}

function isZeroFaceAllowed(group) {
  return ['curve', 'arc_curve'].includes(group.kind);
}

export function boundingBoxForVertices(vertices) {
  return mergeBoundingBoxes(vertices.map(([x, y, z]) => ({ min: [x, y, z], max: [x, y, z] })));
}

export function mergeBoundingBoxes(boxes) {
  const validBoxes = boxes.filter(Boolean);
  if (validBoxes.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], w: 0, d: 0, h: 0 };
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of validBoxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return {
    min,
    max,
    w: max[0] - min[0],
    d: max[1] - min[1],
    h: max[2] - min[2]
  };
}

function cloneAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return null;
  return structuredClone(attributes);
}

function cloneJson(value) {
  if (value === undefined || value === null) return null;
  return structuredClone(value);
}

function overlapWarnings(items) {
  const warnings = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const relation = classifyBoxRelation(items[i].bounding_box, items[j].bounding_box);
      if (relation === 'collision') {
        warnings.push({
          type: 'geometry.bbox_collision',
          severity: 'warn',
          category: 'geometry',
          relation,
          message: `Bounding boxes collide: ${items[i].name} intersects ${items[j].name}`,
          source: `group:${items[i].name};${items[j].name}`
        });
      }
    }
  }
  return warnings;
}

function classifyBoxRelation(a, b) {
  if (!a || !b) return 'none';
  const overlaps = [0, 1, 2].map((axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]));
  if (overlaps.every((value) => value > 1e-9)) return 'collision';
  if (overlaps.every((value) => value >= -1e-9) && overlaps.some((value) => Math.abs(value) <= 1e-9)) return 'contact';
  return 'none';
}

function computeWarningSummary(warnings) {
  const summary = { total: warnings.length, by_severity: { error: 0, warn: 0, info: 0 }, by_category: {} };
  for (const warning of warnings) {
    summary.by_severity[warning.severity] = (summary.by_severity[warning.severity] || 0) + 1;
    summary.by_category[warning.category] = (summary.by_category[warning.category] || 0) + 1;
  }
  return summary;
}
