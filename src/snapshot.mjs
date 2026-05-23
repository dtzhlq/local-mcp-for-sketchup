const VALID_WARNING_TYPES = [
  'geometry.degenerate', 'geometry.bbox_overlap', 'geometry.bbox_collision', 'geometry.bbox_contact', 'material.missing_texture',
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
      texture_transform: group.texture_transform || null,
      image: group.image || null,
      attributes: cloneAttributes(group.attributes),
      transform: group.transform || null,
      visible: group.hidden ? false : true,
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
      texture_transform: instance.texture_transform || null,
      attributes: cloneAttributes(instance.attributes),
      transform: instance.transform || null,
      visible: instance.hidden ? false : true,
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
    ...model.groups.filter((group) => group.faces === 0).map((group) => ({
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

  return {
    totals,
    groups,
    instances,
    component_definitions: Object.keys(model.component_definitions || {}).sort(),
    scenes: model.scenes || [],
    levels: model.levels || [],
    tags: Object.values(model.tags || {}).map((tag) => ({ ...tag })).sort((a, b) => a.name.localeCompare(b.name)),
    materials,
    material_names: materials.map((material) => material.name),
    style_state: model.style_state || null,
    shadow_state: model.shadow_state || null,
    rendering_options: model.rendering_options || null,
    bounding_box: boundingBox,
    warnings: allWarnings,
    warning_messages: allWarnings.map((w) => w.message),
    warning_summary: warningSummary,
    view_state: model.view_state || null
  };
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
