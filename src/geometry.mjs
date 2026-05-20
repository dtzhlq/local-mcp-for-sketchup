export function emptyModel() {
  return {
    version: 1,
    units: 'mm',
    groups: [],
    component_definitions: {},
    instances: [],
    scenes: [],
    levels: [],
    materials: {},
    warnings: [],
    view_state: null,
    style_state: null,
    shadow_state: null,
    rendering_options: null
  };
}

export function normalizeVector(value, fallback, fieldName) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${fieldName} must be [x, y, z]`);
  }
  return value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number)) {
      throw new Error(`${fieldName}[${index}] must be a finite number`);
    }
    return number;
  });
}

export function ensureMaterial(model, material, options = '#cccccc') {
  const normalized = normalizeMaterialSpec(material, options);
  if (!normalized) return null;
  const { spec, updateExisting } = normalized;
  const existing = model.materials[spec.name];
  if (existing && !updateExisting) return spec.name;
  model.materials[spec.name] = mergeMaterialSpecs(existing, spec);
  return spec.name;
}

function normalizeMaterialSpec(material, options) {
  if (!material) return null;
  const materialIsObject = typeof material === 'object' && !Array.isArray(material);
  const raw = materialIsObject
    ? { ...material }
    : {
        ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}),
        name: material,
        color: typeof options === 'string' ? options : options?.color
      };
  if (!raw.name || typeof raw.name !== 'string') throw new Error('material operation requires a string name');
  const spec = { name: raw.name, color: raw.color || '#cccccc' };
  if (raw.alpha !== undefined) spec.alpha = optionalNumberInRange(raw.alpha, 0, 1, `${raw.name}.alpha`);
  if (raw.workflow !== undefined) spec.workflow = normalizeKeyword(raw.workflow, ['classic', 'pbr_metallic_roughness'], `${raw.name}.workflow`);
  if (raw.colorize_type !== undefined || raw.colorizeType !== undefined) {
    spec.colorize_type = normalizeKeyword(raw.colorize_type ?? raw.colorizeType, ['shift', 'tint'], `${raw.name}.colorize_type`);
  }
  if (raw.texture !== undefined) spec.texture = normalizeTextureSpec(raw.texture, `${raw.name}.texture`);
  if (raw.pbr !== undefined) spec.pbr = normalizePbrSpec(raw.pbr, `${raw.name}.pbr`);
  return { spec, updateExisting: materialIsObject };
}

function mergeMaterialSpecs(existing = {}, spec) {
  const merged = { ...existing, ...spec };
  if (existing.texture && spec.texture === undefined) merged.texture = existing.texture;
  if (existing.pbr || spec.pbr) {
    merged.pbr = { ...(existing.pbr || {}), ...(spec.pbr || {}) };
    if (existing.pbr?.textures || spec.pbr?.textures) {
      merged.pbr.textures = { ...(existing.pbr?.textures || {}), ...(spec.pbr?.textures || {}) };
    }
  }
  return merged;
}

function normalizeTextureSpec(texture, fieldName) {
  if (typeof texture === 'string') return { path: nonEmptyString(texture, `${fieldName}.path`) };
  if (!texture || typeof texture !== 'object' || Array.isArray(texture)) throw new Error(`${fieldName} must be a path string or object`);
  const path = nonEmptyString(texture.path ?? texture.file ?? texture.filename, `${fieldName}.path`);
  const normalized = { path };
  if (texture.width !== undefined) normalized.width = positiveNumber(texture.width, undefined, `${fieldName}.width`);
  if (texture.height !== undefined) normalized.height = positiveNumber(texture.height, undefined, `${fieldName}.height`);
  if (texture.scale_u !== undefined || texture.scaleU !== undefined) normalized.scale_u = positiveNumber(texture.scale_u ?? texture.scaleU, undefined, `${fieldName}.scale_u`);
  if (texture.scale_v !== undefined || texture.scaleV !== undefined) normalized.scale_v = positiveNumber(texture.scale_v ?? texture.scaleV, undefined, `${fieldName}.scale_v`);
  return normalized;
}

function normalizePbrSpec(pbr, fieldName) {
  if (!pbr || typeof pbr !== 'object' || Array.isArray(pbr)) throw new Error(`${fieldName} must be an object`);
  const normalized = {};
  for (const key of ['metallic_factor', 'roughness_factor', 'ao_strength']) {
    if (pbr[key] !== undefined) normalized[key] = optionalNumberInRange(pbr[key], 0, 1, `${fieldName}.${key}`);
  }
  if (pbr.normal_scale !== undefined) normalized.normal_scale = positiveNumber(pbr.normal_scale, undefined, `${fieldName}.normal_scale`);
  if (pbr.normal_style !== undefined || pbr.normalStyle !== undefined) {
    normalized.normal_style = normalizeKeyword(pbr.normal_style ?? pbr.normalStyle, ['opengl', 'directx'], `${fieldName}.normal_style`);
  }
  if (pbr.textures !== undefined) normalized.textures = normalizePbrTextures(pbr.textures, `${fieldName}.textures`);
  return normalized;
}

function normalizePbrTextures(textures, fieldName) {
  if (!textures || typeof textures !== 'object' || Array.isArray(textures)) throw new Error(`${fieldName} must be an object`);
  const normalized = {};
  for (const key of ['metallic', 'roughness', 'normal', 'ao', 'opacity']) {
    if (textures[key] !== undefined) {
      normalized[key] = typeof textures[key] === 'string'
        ? nonEmptyString(textures[key], `${fieldName}.${key}`)
        : normalizeTextureSpec(textures[key], `${fieldName}.${key}`).path;
    }
  }
  return normalized;
}

const VALID_WARNING_TYPES = [
  'geometry.degenerate', 'geometry.bbox_overlap', 'geometry.bbox_collision', 'geometry.bbox_contact', 'material.missing_texture',
  'material.pbr_unsupported', 'rendering.unsupported_option',
  'rendering.apply_failed', 'info.limitation', 'info.operation_skipped'
];

const VALID_SEVERITIES = ['error', 'warn', 'info'];

export function addWarning(model, typeOrMessage, severity, message, source) {
  // Backward-compat: addWarning(model, message)
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
  // New-style: addWarning(model, type, severity, message, source?)
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

export function addLevel(model, { name, elevation = 0, height } = {}) {
  if (!name || typeof name !== 'string') throw new Error('level operation requires a string name');
  const level = {
    name,
    elevation: finiteNumber(elevation, 0, `${name}.elevation`)
  };
  if (height !== undefined) level.height = positiveNumber(height, undefined, `${name}.height`);
  model.levels.push(level);
}

export function addBox(model, operation) {
  const { name, origin, size, material } = operation;
  if (!name || typeof name !== 'string') {
    throw new Error('box operation requires a string name');
  }
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const normalizedSize = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if (normalizedSize.some((value) => value <= 0)) {
    throw new Error(`${name}.size values must be positive`);
  }
  const materialName = ensureMaterial(model, material);
  const [x, y, z] = normalizedOrigin;
  const [w, d, h] = normalizedSize;
  const vertices = boxVertices([x, y, z], [w, d, h]);
  model.groups.push({
    id: objectId(operation, name),
    name,
    kind: 'box',
    faces: 6,
    edges: 12,
    material: materialName,
    transform: normalizeTransform(operation, name),
    bounding_box: boundingBoxForVertices(applyTransform(vertices, operation, name))
  });
}


export function deleteObject(model, operation) {
  const target = resolveObjectReference(operation, 'delete');
  const beforeGroups = model.groups.length;
  const beforeInstances = (model.instances || []).length;
  model.groups = model.groups.filter((group) => !matchesObjectReference(group, target));
  model.instances = (model.instances || []).filter((instance) => !matchesObjectReference(instance, target));
  if (model.groups.length === beforeGroups && (model.instances || []).length === beforeInstances) throw new Error(`delete target not found: ${referenceLabel(target)}`);
}

export function renameObject(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'rename'));
  const newName = nonEmptyString(operation.new_name ?? operation.newName, 'rename.new_name');
  if (findModelObject(model, { name: newName }, false)) throw new Error(`rename target already exists: ${newName}`);
  target.item.name = newName;
}

export function setObjectMaterial(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'set_material'));
  target.item.material = ensureMaterial(model, operation.material ?? operation.material_name ?? operation.materialName);
}

export function setObjectVisibility(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'set_visibility'));
  const visible = normalizeBoolean(operation.visible ?? !operation.hidden, 'set_visibility.visible');
  target.item.hidden = !visible;
}

export function transformObject(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'transform_object'));
  const object = target.item;
  const transform = normalizeObjectTransform(operation, object);
  const corners = boxVertices(object.bounding_box.min, [object.bounding_box.w, object.bounding_box.d, object.bounding_box.h]);
  object.bounding_box = boundingBoxForVertices(applyObjectTransform(corners, transform));
  object.transform = mergeObjectTransform(object.transform, transform);
}

function objectId(operation, fallbackName) {
  return nonEmptyString(operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid ?? fallbackName, `${fallbackName}.id`);
}

function resolveObjectReference(operation, opName) {
  const rawId = operation.target_id ?? operation.targetId ?? operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid;
  const rawName = operation.name ?? operation.target ?? operation.object;
  const reference = {};
  if (rawId !== undefined) reference.id = nonEmptyString(rawId, `${opName}.target_id`);
  if (rawName !== undefined) reference.name = nonEmptyString(rawName, `${opName}.name`);
  if (!reference.id && !reference.name) throw new Error(`${opName} requires target_id or name`);
  return reference;
}

function matchesObjectReference(item, reference) {
  if (reference.id && (item.id === reference.id || item.guid === reference.id || item.persistent_id === reference.id)) return true;
  if (reference.name && item.name === reference.name) return true;
  return false;
}

function referenceLabel(reference) {
  return reference.id ? `id:${reference.id}` : `name:${reference.name}`;
}

function findModelObject(model, reference, required = true) {
  const groupIndex = model.groups.findIndex((group) => matchesObjectReference(group, reference));
  if (groupIndex >= 0) return { collection: 'groups', index: groupIndex, item: model.groups[groupIndex] };
  const instanceIndex = (model.instances || []).findIndex((instance) => matchesObjectReference(instance, reference));
  if (instanceIndex >= 0) return { collection: 'instances', index: instanceIndex, item: model.instances[instanceIndex] };
  if (required) throw new Error(`object not found: ${referenceLabel(reference)}`);
  return null;
}

function normalizeObjectTransform(operation, object) {
  const transform = operation.transform || operation;
  const name = object.name;
  const translate = transform.translate ?? transform.translation ?? [0, 0, 0];
  const rotate = transform.rotate ?? transform.rotation ?? {};
  const scaleRaw = transform.scale ?? 1;
  const mirrorRaw = transform.mirror ?? [];
  const pivotRaw = transform.pivot ?? operation.pivot ?? 'origin';
  const mirrorAxes = Array.isArray(mirrorRaw) ? mirrorRaw : [mirrorRaw];
  for (const axis of mirrorAxes) {
    if (axis !== undefined && !['x', 'y', 'z'].includes(axis)) throw new Error(`${name}.mirror axes must be x, y, or z`);
  }
  const scale = Array.isArray(scaleRaw)
    ? normalizeVector(scaleRaw, [1, 1, 1], `${name}.scale`)
    : [positiveNumber(scaleRaw, 1, `${name}.scale`), positiveNumber(scaleRaw, 1, `${name}.scale`), positiveNumber(scaleRaw, 1, `${name}.scale`)];
  return {
    translate: normalizeVector(translate, [0, 0, 0], `${name}.translate`),
    rotateX: finiteNumber(transform.rotateX ?? transform.rotationX ?? rotate.x, 0, `${name}.rotateX`),
    rotateY: finiteNumber(transform.rotateY ?? transform.rotationY ?? rotate.y, 0, `${name}.rotateY`),
    rotateZ: finiteNumber(transform.rotateZ ?? transform.rotationZ ?? rotate.z, 0, `${name}.rotateZ`),
    scale,
    mirror: mirrorAxes.filter(Boolean),
    pivot: normalizeTransformPivot(pivotRaw, object.bounding_box, `${name}.pivot`)
  };
}

function normalizeTransformPivot(pivot, boundingBox, fieldName) {
  if (Array.isArray(pivot)) return normalizeVector(pivot, [0, 0, 0], fieldName);
  const normalized = pivot === undefined ? 'origin' : String(pivot);
  if (normalized === 'origin') return [0, 0, 0];
  if (['center', 'object_center', 'objectCenter'].includes(normalized)) {
    return [
      boundingBox.min[0] + boundingBox.w / 2,
      boundingBox.min[1] + boundingBox.d / 2,
      boundingBox.min[2] + boundingBox.h / 2
    ];
  }
  throw new Error(`${fieldName} must be "origin", "center", or a [x,y,z] vector`);
}

function applyObjectTransform(vertices, transform) {
  const sx = transform.scale[0] * (transform.mirror.includes('x') ? -1 : 1);
  const sy = transform.scale[1] * (transform.mirror.includes('y') ? -1 : 1);
  const sz = transform.scale[2] * (transform.mirror.includes('z') ? -1 : 1);
  const rx = (transform.rotateX * Math.PI) / 180;
  const ry = (transform.rotateY * Math.PI) / 180;
  const rz = (transform.rotateZ * Math.PI) / 180;
  const cx = Math.cos(rx), sxn = Math.sin(rx);
  const cy = Math.cos(ry), syn = Math.sin(ry);
  const cz = Math.cos(rz), szn = Math.sin(rz);
  const [px, py, pz] = transform.pivot;
  return vertices.map(([x0, y0, z0]) => {
    let x = (x0 - px) * sx;
    let y = (y0 - py) * sy;
    let z = (z0 - pz) * sz;
    [y, z] = [y * cx - z * sxn, y * sxn + z * cx];
    [x, z] = [x * cy + z * syn, -x * syn + z * cy];
    [x, y] = [x * cz - y * szn, x * szn + y * cz];
    return [x + px + transform.translate[0], y + py + transform.translate[1], z + pz + transform.translate[2]];
  });
}

function mergeObjectTransform(existing = {}, transform) {
  return {
    ...(existing || {}),
    object_transform: transform
  };
}

export function addRoundedBox(model, operation) {
  const { name, origin = [0, 0, 0], size, radius, segments = 5, material, smooth = 'all' } = operation;
  if (!name || typeof name !== 'string') throw new Error('rounded_box operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const r = Math.min(nonNegativeNumber(radius, 0, `${name}.radius`), w / 2, d / 2);
  const n = integerInRange(segments, 1, 16, `${name}.segments`);
  const points = roundedRectPoints(x, y, w, d, r, n);
  addFootprintExtrusionMesh(model, operation, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'rounded_box';
  group.radius = r;
  group.segments = n;
  group.resolution_hint = { segments: n };
}

export function addBeveledPanel(model, operation) {
  const { name, origin = [0, 0, 0], size, bevel, material, smooth = 'coplanar' } = operation;
  if (!name || typeof name !== 'string') throw new Error('beveled_panel operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const b = Math.min(nonNegativeNumber(bevel, 0, `${name}.bevel`), w / 2, d / 2);
  const points = beveledRectPoints(x, y, w, d, b);
  addFootprintExtrusionMesh(model, { name, material, transform: operation.transform }, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'beveled_panel';
  group.bevel = b;
}

export function addFillet(model, operation) {
  const { name, origin = [0, 0, 0], size, radius, segments = 5, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('fillet operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const r = Math.min(nonNegativeNumber(radius, 0, `${name}.radius`), w / 2, d / 2);
  const n = integerInRange(segments, 1, 32, `${name}.segments`);
  const points = roundedRectPoints(x, y, w, d, r, n);
  addFootprintExtrusionMesh(model, { name, material, transform }, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'fillet';
  group.radius = r;
  group.segments = n;
}

export function addChamfer(model, operation) {
  const { name, origin = [0, 0, 0], size, amount, bevel = amount, material, smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('chamfer operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const c = Math.min(nonNegativeNumber(bevel, 0, `${name}.amount`), w / 2, d / 2);
  const points = beveledRectPoints(x, y, w, d, c);
  addFootprintExtrusionMesh(model, { name, material, transform }, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'chamfer';
  group.bevel = c;
}

export function addRecess(model, operation) {
  const { name, center = operation.origin, size, depth, radius = 0, segments = 5, material = 'Recess_Dark', smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('recess operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const [w, d] = normalizePlanSize(size, `${name}.size`);
  const recessDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const r = Math.min(nonNegativeNumber(radius, 0, `${name}.radius`), w / 2, d / 2);
  const n = integerInRange(segments, 1, 32, `${name}.segments`);
  const points = roundedRectPoints(x - w / 2, y - d / 2, w, d, r, n);
  const top = points.map(([px, py]) => [px, py, z]);
  const bottom = points.map(([px, py]) => [px, py, z - recessDepth]);
  const count = points.length;
  const faces = [Array.from({ length: count }, (_, index) => count + count - 1 - index)];
  for (let index = 0; index < count; index += 1) {
    faces.push([index, (index + 1) % count, count + ((index + 1) % count), count + index]);
  }
  addMesh(model, { name, vertices: [...top, ...bottom], faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'recess';
  group.segments = n;
}

export function addEngravedLine(model, operation) {
  const { name, points, width, depth = 1, material = 'Groove_Dark', smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('engraved_line operation requires a string name');
  if (!Array.isArray(points) || points.length < 2) throw new Error(`${name}.points must contain at least 2 [x, y, z] points`);
  const normalizedPoints = points.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.points[${index}]`));
  const lineWidth = positiveNumber(width, undefined, `${name}.width`);
  const lineDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const vertices = [];
  const faces = [];
  for (let index = 0; index < normalizedPoints.length - 1; index += 1) {
    const start = normalizedPoints[index];
    const end = normalizedPoints[index + 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) throw new Error(`${name}.points[${index}] and points[${index + 1}] must not be identical in XY`);
    const nx = (-dy / length) * (lineWidth / 2);
    const ny = (dx / length) * (lineWidth / 2);
    const z = start[2];
    const base = vertices.length;
    vertices.push(
      [start[0] + nx, start[1] + ny, z], [end[0] + nx, end[1] + ny, z], [end[0] - nx, end[1] - ny, z], [start[0] - nx, start[1] - ny, z],
      [start[0] + nx, start[1] + ny, z - lineDepth], [end[0] + nx, end[1] + ny, z - lineDepth], [end[0] - nx, end[1] - ny, z - lineDepth], [start[0] - nx, start[1] - ny, z - lineDepth]
    );
    faces.push([base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]);
  }
  addMesh(model, { name, vertices, faces, material, smooth, transform });
  model.groups[model.groups.length - 1].kind = 'engraved_line';
}

export function addTextEmboss(model, operation) {
  const { name, material = 'Text_Emboss', smooth = 'coplanar', transform } = operation;
  const marker = textMarkerMesh(operation, `${name || 'text_emboss'}`, 1);
  addMesh(model, { name, vertices: marker.vertices, faces: marker.faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'text_emboss';
  group.glyphs = marker.glyphs;
}

export function addTextEngrave(model, operation) {
  const { name, material = 'Text_Engrave_Dark', smooth = 'coplanar', transform } = operation;
  const marker = textMarkerMesh(operation, `${name || 'text_engrave'}`, -1);
  addMesh(model, { name, vertices: marker.vertices, faces: marker.faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'text_engrave';
  group.glyphs = marker.glyphs;
}

function textMarkerMesh(operation, fieldPrefix, direction) {
  const { name, text } = operation;
  if (!name || typeof name !== 'string') throw new Error(`${direction > 0 ? 'text_emboss' : 'text_engrave'} operation requires a string name`);
  if (typeof text !== 'string' || text.length === 0) throw new Error(`${name}.text must be a non-empty string`);
  const anchor = normalizeVector(operation.center ?? operation.origin, [0, 0, 0], `${name}.${operation.center ? 'center' : 'origin'}`);
  const glyphHeight = positiveNumber(operation.height, undefined, `${name}.height`);
  const textDepth = positiveNumber(operation.depth, 1, `${name}.depth`);
  const spacing = nonNegativeNumber(operation.spacing, glyphHeight * 0.2, `${name}.spacing`);
  const glyphWidth = positiveNumber(operation.width, glyphHeight * 0.6, `${name}.width`);
  const alignDefault = operation.center ? 'center' : 'left';
  const align = normalizeKeyword(operation.align ?? alignDefault, ['left', 'center', 'right'], `${name}.align`);
  const advances = Array.from(text, () => glyphWidth);
  const totalWidth = advances.reduce((sum, width) => sum + width, 0) + Math.max(0, advances.length - 1) * spacing;
  const startX = align === 'center' ? anchor[0] - totalWidth / 2 : align === 'right' ? anchor[0] - totalWidth : anchor[0];
  const vertices = [];
  const faces = [];
  let cursor = startX;
  let glyphs = 0;
  for (const character of text) {
    if (!/\s/u.test(character)) {
      const z0 = direction > 0 ? anchor[2] : anchor[2] - textDepth;
      const h = textDepth;
      const base = vertices.length;
      vertices.push(...boxVertices([cursor, anchor[1], z0], [glyphWidth, glyphHeight, h]));
      faces.push([base, base + 1, base + 2, base + 3], [base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]);
      glyphs += 1;
    }
    cursor += glyphWidth + spacing;
  }
  if (glyphs === 0) throw new Error(`${fieldPrefix}.text must include at least one non-space character`);
  return { vertices, faces, glyphs };
}

export function addSlot(model, operation) {
  const { name, center = operation.origin, length, width, depth, segments = 8, material = 'Slot_Dark', smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('slot operation requires a string name');
  const slotLength = positiveNumber(length, undefined, `${name}.length`);
  const slotWidth = positiveNumber(width, undefined, `${name}.width`);
  if (slotLength < slotWidth) throw new Error(`${name}.length must be greater than or equal to width`);
  addRecess(model, { name, center, size: [slotLength, slotWidth], depth, radius: slotWidth / 2, segments, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'slot';
}

export function addSlotArray(model, operation) {
  const { name, center, origin, count, spacing, length, width, depth, direction = 'x', segments = 8, material = 'Slot_Dark', smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('slot_array operation requires a string name');
  const slotCount = integerInRange(count, 1, 500, `${name}.count`);
  const slotSpacing = positiveNumber(spacing, undefined, `${name}.spacing`);
  const slotLength = positiveNumber(length, undefined, `${name}.length`);
  const slotWidth = positiveNumber(width, undefined, `${name}.width`);
  const slotDepth = positiveNumber(depth, undefined, `${name}.depth`);
  if (slotLength < slotWidth) throw new Error(`${name}.length must be greater than or equal to width`);
  if (!['x', 'y'].includes(direction)) throw new Error(`${name}.direction must be x or y`);
  const n = integerInRange(segments, 1, 16, `${name}.segments`);
  const anchor = center !== undefined
    ? normalizeVector(center, [0, 0, 0], `${name}.center`)
    : normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const startOffset = center !== undefined ? -((slotCount - 1) * slotSpacing) / 2 : 0;
  const materialName = ensureMaterial(model, material);
  const boxes = [];
  const slotPointCount = roundedRectPoints(0, 0, direction === 'x' ? slotLength : slotWidth, direction === 'x' ? slotWidth : slotLength, slotWidth / 2, n).length;
  const slotFaces = slotPointCount + 1;
  const slotEdges = slotPointCount * 3;
  for (let index = 0; index < slotCount; index += 1) {
    const offset = startOffset + index * slotSpacing;
    const slotCenter = direction === 'x'
      ? [anchor[0] + offset, anchor[1], anchor[2]]
      : [anchor[0], anchor[1] + offset, anchor[2]];
    boxes.push(slotBox(slotCenter, slotLength, slotWidth, slotDepth, direction));
  }
  const corners = boxes.flatMap((box) => boxVertices(box.origin, box.size));
  model.groups.push({
    id: objectId(operation, name),
    name,
    kind: 'slot_array',
    faces: slotFaces * slotCount,
    edges: slotEdges * slotCount,
    material: materialName,
    transform: normalizeTransform(operation, name),
    count: slotCount,
    direction,
    segments: n,
    bounding_box: boundingBoxForVertices(applyTransform(corners, { transform }, name))
  });
}

export function addRib(model, operation) {
  const { name, origin = [0, 0, 0], length, height, thickness, direction = 'x', material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('rib operation requires a string name');
  const ribLength = positiveNumber(length, undefined, `${name}.length`);
  const ribHeight = positiveNumber(height, undefined, `${name}.height`);
  const ribThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  if (!['x', 'y'].includes(direction)) throw new Error(`${name}.direction must be x or y`);
  const size = direction === 'x' ? [ribLength, ribThickness, ribHeight] : [ribThickness, ribLength, ribHeight];
  addBox(model, { name, origin, size, material, transform });
  model.groups[model.groups.length - 1].kind = 'rib';
}

export function addStandoffBoss(model, operation) {
  const { name, center = operation.origin, outer_radius, outerRadius, inner_radius, innerRadius, height, segments = 16, material, hole_material, holeMaterial = 'Slot_Dark', smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('standoff_boss operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const outer = positiveNumber(outer_radius ?? outerRadius, undefined, `${name}.outer_radius`);
  const inner = positiveNumber(inner_radius ?? innerRadius, undefined, `${name}.inner_radius`);
  const bossHeight = positiveNumber(height, undefined, `${name}.height`);
  if (inner >= outer) throw new Error(`${name}.inner_radius must be smaller than outer_radius`);
  const n = integerInRange(segments, 3, 96, `${name}.segments`);
  const materialName = ensureMaterial(model, material);
  ensureMaterial(model, hole_material ?? holeMaterial);
  const corners = boxVertices([x - outer, y - outer, z], [outer * 2, outer * 2, bossHeight]);
  model.groups.push({
    id: objectId(operation, name),
    name,
    kind: 'standoff_boss',
    faces: (3 * n - 4) * 2,
    edges: (5 * n - 6) * 2,
    material: materialName,
    transform: normalizeTransform(operation, name),
    segments: n,
    bounding_box: boundingBoxForVertices(applyTransform(corners, { transform }, name))
  });
}

function slotBox(center, length, width, depth, direction) {
  const [x, y, z] = center;
  const size = direction === 'x' ? [length, width, depth] : [width, length, depth];
  return { origin: [x - size[0] / 2, y - size[1] / 2, z - depth], size };
}

function addFootprintExtrusionMesh(model, operation, points, z, height, smooth) {
  const bottom = points.map(([px, py]) => [px, py, z]);
  const top = points.map(([px, py]) => [px, py, z + height]);
  const vertices = [...bottom, ...top];
  const count = points.length;
  const faces = [
    Array.from({ length: count }, (_, index) => index),
    Array.from({ length: count }, (_, index) => count + count - 1 - index)
  ];
  for (let index = 0; index < count; index += 1) {
    faces.push([index, (index + 1) % count, count + ((index + 1) % count), count + index]);
  }
  addMesh(model, { ...operation, vertices, faces, smooth });
}

function roundedRectPoints(x, y, width, depth, radius, segments) {
  if (radius <= 0) {
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]];
  }
  const corners = [
    { cx: x + width - radius, cy: y + radius, start: -Math.PI / 2, end: 0 },
    { cx: x + width - radius, cy: y + depth - radius, start: 0, end: Math.PI / 2 },
    { cx: x + radius, cy: y + depth - radius, start: Math.PI / 2, end: Math.PI },
    { cx: x + radius, cy: y + radius, start: Math.PI, end: Math.PI * 1.5 }
  ];
  const points = [];
  for (const corner of corners) {
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const angle = corner.start + (corner.end - corner.start) * t;
      points.push([corner.cx + radius * Math.cos(angle), corner.cy + radius * Math.sin(angle)]);
    }
  }
  return dedupePlanPoints(points);
}

function dedupePlanPoints(points) {
  const unique = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 1e-9) unique.push(point);
  }
  if (unique.length > 1) {
    const first = unique[0];
    const last = unique[unique.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9) unique.pop();
  }
  return unique;
}

function beveledRectPoints(x, y, width, depth, bevel) {
  if (bevel <= 0) {
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]];
  }
  return [
    [x + bevel, y],
    [x + width - bevel, y],
    [x + width, y + bevel],
    [x + width, y + depth - bevel],
    [x + width - bevel, y + depth],
    [x + bevel, y + depth],
    [x, y + depth - bevel],
    [x, y + bevel]
  ];
}

function boxVertices([x, y, z], [w, d, h]) {
  return [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
    [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]
  ];
}

export function addFloorSlab(model, { name, origin = [0, 0, 0], width, depth, thickness = 150, material, transform } = {}) {
  if (!name || typeof name !== 'string') throw new Error('floor_slab operation requires a string name');
  addBox(model, { name, origin, size: [positiveNumber(width, undefined, `${name}.width`), positiveNumber(depth, undefined, `${name}.depth`), positiveNumber(thickness, undefined, `${name}.thickness`)], material, transform });
  model.groups[model.groups.length - 1].kind = 'floor_slab';
}

export function addWall(model, operation = {}) {
  const { name, start, end, height, thickness = 120, openings = [], material } = operation;
  if (!name || typeof name !== 'string') throw new Error('wall operation requires a string name');
  const wallStart = normalizeVector(start, [0, 0, 0], `${name}.start`);
  const wallEnd = normalizeVector(end, [0, 0, 0], `${name}.end`);
  const wallHeight = positiveNumber(height, undefined, `${name}.height`);
  const wallThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const dx = wallEnd[0] - wallStart[0];
  const dy = wallEnd[1] - wallStart[1];
  if (Math.abs(dx) > 0 && Math.abs(dy) > 0) throw new Error(`${name} supports axis-aligned walls only in the MVP`);
  if (Math.abs(dx) === 0 && Math.abs(dy) === 0) throw new Error(`${name}.start and end must not be identical`);
  if (Math.abs(dx) >= Math.abs(dy)) {
    const origin = [Math.min(wallStart[0], wallEnd[0]), wallStart[1], wallStart[2]];
    addPanelWithOpenings(model, { name, origin, plane: 'xz', size: [Math.abs(dx), wallHeight], thickness: wallThickness, openings, material });
  } else {
    const origin = [wallStart[0], Math.min(wallStart[1], wallEnd[1]), wallStart[2]];
    addPanelWithOpenings(model, { name, origin, plane: 'yz', size: [Math.abs(dy), wallHeight], thickness: wallThickness, openings, material });
  }
  model.groups[model.groups.length - 1].kind = 'wall';
}

export function addDoor(model, operation = {}) {
  addVerticalPanel(model, operation, 'door', 'door operation requires a string name');
}

export function addWindow(model, operation = {}) {
  addVerticalPanel(model, operation, 'window', 'window operation requires a string name');
}

function addVerticalPanel(model, { name, origin = [0, 0, 0], plane = 'xz', width, height, thickness = 40, material, transform } = {}, kind, errorMessage) {
  if (!name || typeof name !== 'string') throw new Error(errorMessage);
  const panelWidth = positiveNumber(width, undefined, `${name}.width`);
  const panelHeight = positiveNumber(height, undefined, `${name}.height`);
  const panelThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  if (plane === 'xz') addBox(model, { name, origin, size: [panelWidth, panelThickness, panelHeight], material, transform });
  else if (plane === 'yz') addBox(model, { name, origin, size: [panelThickness, panelWidth, panelHeight], material, transform });
  else throw new Error(`${name}.plane must be xz or yz`);
  model.groups[model.groups.length - 1].kind = kind;
}

export function addStairs(model, { name, origin = [0, 0, 0], steps, width, tread_depth, treadDepth, riser_height, riserHeight, direction = 'y', material } = {}) {
  if (!name || typeof name !== 'string') throw new Error('stairs operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const stepCount = integerInRange(steps, 1, 200, `${name}.steps`);
  const stairWidth = positiveNumber(width, undefined, `${name}.width`);
  const tread = positiveNumber(tread_depth ?? treadDepth, undefined, `${name}.tread_depth`);
  const riser = positiveNumber(riser_height ?? riserHeight, undefined, `${name}.riser_height`);
  for (let index = 0; index < stepCount; index += 1) {
    if (direction === 'x') {
      addBox(model, { name: `${name}_Step_${index + 1}`, origin: [x + index * tread, y, z], size: [tread, stairWidth, (index + 1) * riser], material });
    } else if (direction === 'y') {
      addBox(model, { name: `${name}_Step_${index + 1}`, origin: [x, y + index * tread, z], size: [stairWidth, tread, (index + 1) * riser], material });
    } else {
      throw new Error(`${name}.direction must be x or y`);
    }
    model.groups[model.groups.length - 1].kind = 'stair_step';
  }
}

export function addRailing(model, { name, path, height = 900, rail_radius, railRadius, post_radius, postRadius, post_spacing, postSpacing, material, smooth = 'all' } = {}) {
  if (!name || typeof name !== 'string') throw new Error('railing operation requires a string name');
  if (!Array.isArray(path) || path.length < 2) throw new Error(`${name}.path must contain at least 2 [x, y, z] points`);
  const normalizedPath = path.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.path[${index}]`));
  const railHeight = positiveNumber(height, undefined, `${name}.height`);
  const railRadiusValue = positiveNumber(rail_radius ?? railRadius, 40, `${name}.rail_radius`);
  const postRadiusValue = positiveNumber(post_radius ?? postRadius, 35, `${name}.post_radius`);
  const spacing = positiveNumber(post_spacing ?? postSpacing, 900, `${name}.post_spacing`);
  const railPath = normalizedPath.map(([x, y, z]) => [x, y, z + railHeight]);
  addPipeBetweenPoints(model, { name: `${name}_Top_Rail`, points: railPath, radius: railRadiusValue, segments: 8, material, smooth });
  model.groups[model.groups.length - 1].kind = 'railing_rail';
  const posts = pointsAlongPolyline(normalizedPath, spacing);
  posts.forEach(([px, py, pz], index) => {
    addCylinder(model, { name: `${name}_Post_${index + 1}`, origin: [px, py, pz], radius: postRadiusValue, height: railHeight, segments: 8, material, smooth });
    model.groups[model.groups.length - 1].kind = 'railing_post';
  });
}

function pointsAlongPolyline(path, spacing) {
  const points = [path[0]];
  let distanceSincePost = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const length = distanceBetween(start, end);
    let cursor = spacing - distanceSincePost;
    while (cursor < length) {
      const t = cursor / length;
      points.push(interpolatePoint(start, end, t));
      cursor += spacing;
    }
    distanceSincePost = length - (cursor - spacing);
    if (distanceSincePost < 1e-6) distanceSincePost = 0;
  }
  const last = path[path.length - 1];
  const previous = points[points.length - 1];
  if (distanceBetween(previous, last) > 1e-6) points.push(last);
  return points;
}

function distanceBetween(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function interpolatePoint(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}




export function addPanelWithOpenings(model, operation) {
  const { name, origin = [0, 0, 0], plane = 'xz', size, thickness, openings = [], material } = operation;
  if (!name || typeof name !== 'string') {
    throw new Error('panel_with_openings operation requires a string name');
  }
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  if (!['xy', 'xz', 'yz'].includes(plane)) {
    throw new Error(`${name}.plane must be one of xy, xz, yz`);
  }
  if (!Array.isArray(size) || size.length !== 2) {
    throw new Error(`${name}.size must be [width, height]`);
  }
  const [width, height] = size.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number) || number <= 0) {
      throw new Error(`${name}.size[${index}] must be a positive number`);
    }
    return number;
  });
  const panelThickness = positiveNumber(thickness, 120, `${name}.thickness`);
  const normalizedOpenings = normalizeOpenings(openings, width, height, name);
  const materialName = ensureMaterial(model, material);
  const vertices = panelVertices(normalizedOrigin, plane, width, height, panelThickness);
  const bbox = mergeBoundingBoxes(vertices.map(([x, y, z]) => ({ min: [x, y, z], max: [x, y, z] })));
  const openingCount = normalizedOpenings.length;
  const openingEdges = normalizedOpenings.reduce((sum, opening) => sum + openingEdgeContribution(opening, width, height), 0);
  model.groups.push({
    id: objectId(operation, name),
    name,
    kind: 'panel_with_openings',
    faces: 6 + openingCount * 4,
    edges: 12 + openingEdges,
    material: materialName,
    plane,
    size: [width, height],
    thickness: panelThickness,
    openings: normalizedOpenings,
    bounding_box: bbox
  });
}

export function addBooleanCutout(model, operation) {
  const { name, origin = [0, 0, 0], size, cutouts, material, smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('boolean_cutout operation requires a string name');
  const [width, depth, thickness] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([width, depth, thickness].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  if (transform !== undefined) throw new Error(`${name}.transform is not supported yet for boolean_cutout safe slice`);
  const openings = normalizeBooleanCutouts(cutouts, width, depth, name);
  addPanelWithOpenings(model, { name, origin, plane: 'xy', size: [width, depth], thickness, openings, material, smooth });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'boolean_cutout';
  group.cutouts = openings;
}

function normalizeBooleanCutouts(cutouts, width, depth, name) {
  if (!Array.isArray(cutouts) || cutouts.length < 1) throw new Error(`${name}.cutouts must contain at least one cutout`);
  return cutouts.map((cutout, index) => {
    if (!cutout || typeof cutout !== 'object' || Array.isArray(cutout)) throw new Error(`${name}.cutouts[${index}] must be an object`);
    const [cutoutWidth, cutoutDepth] = normalizePlanSize(cutout.size, `${name}.cutouts[${index}].size`);
    const [centerX, centerY] = normalizePlanPoint(cutout.center, `${name}.cutouts[${index}].center`);
    const x = centerX - cutoutWidth / 2;
    const y = centerY - cutoutDepth / 2;
    if (x < 0 || y < 0 || x + cutoutWidth > width || y + cutoutDepth > depth) throw new Error(`${name}.cutouts[${index}] must fit inside slab bounds`);
    return { name: cutout.name || `Cutout_${index + 1}`, x, y, width: cutoutWidth, height: cutoutDepth };
  });
}

function normalizeOpenings(openings, width, height, name) {
  if (!Array.isArray(openings)) {
    throw new Error(`${name}.openings must be an array`);
  }
  return openings.map((opening, index) => {
    if (!opening || typeof opening !== 'object' || Array.isArray(opening)) {
      throw new Error(`${name}.openings[${index}] must be an object`);
    }
    const x = Number(opening.x ?? opening.origin?.[0]);
    const y = Number(opening.y ?? opening.z ?? opening.origin?.[1]);
    const openingWidth = Number(opening.width);
    const openingHeight = Number(opening.height);
    for (const [field, value] of [['x', x], ['y', y], ['width', openingWidth], ['height', openingHeight]]) {
      if (!Number.isFinite(value)) {
        throw new Error(`${name}.openings[${index}].${field} must be a finite number`);
      }
    }
    if (openingWidth <= 0 || openingHeight <= 0) {
      throw new Error(`${name}.openings[${index}] width/height must be positive`);
    }
    if (x < 0 || y < 0 || x + openingWidth > width || y + openingHeight > height) {
      throw new Error(`${name}.openings[${index}] must fit inside panel bounds`);
    }
    return { name: opening.name || `Opening_${index + 1}`, x, y, width: openingWidth, height: openingHeight };
  });
}

function panelVertices(origin, plane, width, height, thickness) {
  const points = [[0, 0], [width, 0], [width, height], [0, height]];
  return prismVertices(origin, plane, points, thickness);
}

function openingEdgeContribution(opening, panelWidth, panelHeight) {
  let boundaryTouches = 0;
  if (opening.x === 0) boundaryTouches += 1;
  if (opening.y === 0) boundaryTouches += 1;
  if (opening.x + opening.width === panelWidth) boundaryTouches += 1;
  if (opening.y + opening.height === panelHeight) boundaryTouches += 1;
  return 12 + boundaryTouches * 4;
}

export function addMesh(model, operation) {
  const { name, vertices, faces, material, smooth = false } = operation;
  if (!name || typeof name !== 'string') {
    throw new Error('mesh operation requires a string name');
  }
  if (!Array.isArray(vertices) || vertices.length < 3) {
    throw new Error(`${name}.vertices must contain at least 3 [x, y, z] points`);
  }
  const normalizedVertices = vertices.map((vertex, index) => normalizeVector(vertex, [0, 0, 0], `${name}.vertices[${index}]`));
  if (!Array.isArray(faces) || faces.length < 1) {
    throw new Error(`${name}.faces must contain at least one face index loop`);
  }
  const normalizedFaces = faces.map((face, faceIndex) => {
    if (!Array.isArray(face) || face.length < 3) {
      throw new Error(`${name}.faces[${faceIndex}] must contain at least 3 vertex indices`);
    }
    return face.map((item, itemIndex) => {
      const index = Number(item);
      if (!Number.isInteger(index) || index < 0 || index >= normalizedVertices.length) {
        throw new Error(`${name}.faces[${faceIndex}][${itemIndex}] must be a valid vertex index`);
      }
      return index;
    });
  });
  const materialName = ensureMaterial(model, material);
  const transformedVertices = applyTransform(normalizedVertices, operation, name);
  const bbox = boundingBoxForVertices(transformedVertices);
  model.groups.push({
    id: objectId(operation, name),
    name,
    kind: 'mesh',
    faces: normalizedFaces.length,
    edges: countMeshEdges(normalizedFaces),
    material: materialName,
    vertices: normalizedVertices,
    mesh_faces: normalizedFaces,
    transform: normalizeTransform(operation, name),
    smooth,
    bounding_box: bbox,
    qa: normalizeQaMetadata(operation.qa)
  });
}

function countMeshEdges(faces) {
  const edges = new Set();
  for (const face of faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  return edges.size;
}

export function addPrism(model, operation) {
  const { name, origin = [0, 0, 0], plane = 'xy', points, depth, material } = operation;
  if (!name || typeof name !== 'string') {
    throw new Error('prism operation requires a string name');
  }
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  if (!['xy', 'xz', 'yz'].includes(plane)) {
    throw new Error(`${name}.plane must be one of xy, xz, yz`);
  }
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error(`${name}.points must contain at least 3 [u, v] pairs`);
  }
  const normalizedPoints = points.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error(`${name}.points[${index}] must be [u, v]`);
    }
    return point.map((item, axis) => {
      const number = Number(item);
      if (!Number.isFinite(number)) {
        throw new Error(`${name}.points[${index}][${axis}] must be a finite number`);
      }
      return number;
    });
  });
  const extrusionDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const materialName = ensureMaterial(model, material);
  const vertices = prismVertices(normalizedOrigin, plane, normalizedPoints, extrusionDepth);
  const bbox = mergeBoundingBoxes(vertices.map(([x, y, z]) => ({ min: [x, y, z], max: [x, y, z] })));
  model.groups.push({
    id: objectId(operation, name),
    name,
    kind: 'prism',
    faces: normalizedPoints.length + 2,
    edges: normalizedPoints.length * 3,
    material: materialName,
    plane,
    points: normalizedPoints,
    depth: extrusionDepth,
    bounding_box: bbox
  });
}

function prismVertices(origin, plane, points, depth) {
  const [x, y, z] = origin;
  const base = points.map(([u, v]) => {
    if (plane === 'xy') return [x + u, y + v, z];
    if (plane === 'xz') return [x + u, y, z + v];
    return [x, y + u, z + v];
  });
  const offset = plane === 'xy' ? [0, 0, depth] : plane === 'xz' ? [0, depth, 0] : [depth, 0, 0];
  return [...base, ...base.map((point) => point.map((value, index) => value + offset[index]))];
}



export function addFaceWithHoles(model, operation) {
  const { name, origin = [0, 0, 0], plane = 'xy', outer, holes = [], material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('face_with_holes operation requires a string name');
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const outerRect = normalizeRectProfile(outer, `${name}.outer`);
  const holeRects = holes.map((hole, index) => normalizeRectProfile(hole.points ?? hole, `${name}.holes[${index}]`));
  const bbox = rectProfileBoundingBox(normalizedOrigin, plane, outerRect, 0);
  const materialName = ensureMaterial(model, material);
  model.groups.push({
    id: objectId(operation, name),
    name,
    kind: 'face_with_holes',
    faces: 1,
    edges: 4 + holeRects.length * 4,
    material: materialName,
    plane,
    holes: holeRects.length,
    transform: normalizeTransform({ transform }, name),
    bounding_box: boundingBoxForVertices(applyTransform(boxVertices(bbox.min, [Math.max(bbox.w, 1e-9), Math.max(bbox.d, 1e-9), Math.max(bbox.h, 1e-9)]), { transform }, name))
  });
}

export function addProfileExtrude(model, operation) {
  const { name, origin = [0, 0, 0], plane = 'xy', outer, holes = [], depth, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('profile_extrude operation requires a string name');
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const extrusionDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const outerRect = normalizeRectProfile(outer, `${name}.outer`);
  const holeRects = holes.map((hole, index) => normalizeRectProfile(hole.points ?? hole, `${name}.holes[${index}]`));
  const outerBox = rectProfileBounds2d(outerRect);
  const openings = holeRects.map((hole, index) => {
    const box = rectProfileBounds2d(hole);
    if (box.minX <= outerBox.minX || box.minY <= outerBox.minY || box.maxX >= outerBox.maxX || box.maxY >= outerBox.maxY) throw new Error(`${name}.holes[${index}] must fit inside outer profile without touching boundary`);
    return { name: `Hole_${index + 1}`, x: box.minX - outerBox.minX, y: box.minY - outerBox.minY, width: box.maxX - box.minX, height: box.maxY - box.minY };
  });
  const panelOrigin = profilePanelOrigin(normalizedOrigin, plane, outerBox);
  addPanelWithOpenings(model, { name, origin: panelOrigin, plane, size: [outerBox.maxX - outerBox.minX, outerBox.maxY - outerBox.minY], thickness: extrusionDepth, openings, material });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'profile_extrude';
  group.profile = { outer: outerRect, holes: holeRects.length };
  group.transform = normalizeTransform({ transform }, name);
  if (transform !== undefined) {
    const corners = boxVertices(group.bounding_box.min, [group.bounding_box.w, group.bounding_box.d, group.bounding_box.h]);
    group.bounding_box = boundingBoxForVertices(applyTransform(corners, { transform }, name));
  }
}

function normalizeRectProfile(points, fieldName) {
  if (!Array.isArray(points) || points.length !== 4) throw new Error(`${fieldName} must be a 4-point rectangular profile`);
  const normalized = points.map((point, index) => normalizePlanPoint(point, `${fieldName}[${index}]`));
  const xs = [...new Set(normalized.map((point) => point[0]))];
  const ys = [...new Set(normalized.map((point) => point[1]))];
  if (xs.length !== 2 || ys.length !== 2) throw new Error(`${fieldName} must be axis-aligned rectangle points`);
  return normalized;
}

function rectProfileBounds2d(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function profilePanelOrigin(origin, plane, bounds) {
  if (plane === 'xy') return [origin[0] + bounds.minX, origin[1] + bounds.minY, origin[2]];
  if (plane === 'xz') return [origin[0] + bounds.minX, origin[1], origin[2] + bounds.minY];
  if (plane === 'yz') return [origin[0], origin[1] + bounds.minX, origin[2] + bounds.minY];
  throw new Error('profile_extrude.plane must be one of xy, xz, yz');
}

function rectProfileBoundingBox(origin, plane, points, thickness) {
  const bounds = rectProfileBounds2d(points);
  const panelOrigin = profilePanelOrigin(origin, plane, bounds);
  const vertices = panelVertices(panelOrigin, plane, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, thickness);
  return boundingBoxForVertices(vertices);
}

export function addGableRoof(model, { name, origin = [0, 0, 0], width, depth, rise, overhang = 0, material }) {
  const roofWidth = positiveNumber(width, undefined, `${name}.width`);
  const roofDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const roofRise = positiveNumber(rise, undefined, `${name}.rise`);
  const roofOverhang = nonNegativeNumber(overhang, 0, `${name}.overhang`);
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const points = [[0, 0], [(roofWidth + 2 * roofOverhang) / 2, roofRise], [roofWidth + 2 * roofOverhang, 0]];
  addPrism(model, {
    name,
    origin: [x - roofOverhang, y - roofOverhang, z],
    plane: 'xz',
    points,
    depth: roofDepth + 2 * roofOverhang,
    material
  });
  model.groups[model.groups.length - 1].kind = 'gable_roof';
}

export function addShedRoof(model, { name, origin = [0, 0, 0], width, depth, rise, overhang = 0, material }) {
  if (!name || typeof name !== 'string') throw new Error('shed_roof operation requires a string name');
  const roofWidth = positiveNumber(width, undefined, `${name}.width`);
  const roofDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const roofRise = positiveNumber(rise, undefined, `${name}.rise`);
  const roofOverhang = nonNegativeNumber(overhang, 0, `${name}.overhang`);
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const minX = x - roofOverhang;
  const minY = y - roofOverhang;
  const vertices = [
    [minX, minY, z], [minX + roofWidth + 2 * roofOverhang, minY, z + roofRise],
    [minX + roofWidth + 2 * roofOverhang, minY + roofDepth + 2 * roofOverhang, z + roofRise], [minX, minY + roofDepth + 2 * roofOverhang, z],
    [minX, minY, z - 80], [minX + roofWidth + 2 * roofOverhang, minY, z + roofRise - 80],
    [minX + roofWidth + 2 * roofOverhang, minY + roofDepth + 2 * roofOverhang, z + roofRise - 80], [minX, minY + roofDepth + 2 * roofOverhang, z - 80]
  ];
  addMesh(model, { name, vertices, faces: [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]], material, smooth: 'coplanar' });
  model.groups[model.groups.length - 1].kind = 'shed_roof';
}

export function addCylinder(model, { name, origin = [0, 0, 0], radius, height, segments = 16, material, smooth = 'all', transform, qa }) {
  if (!name || typeof name !== 'string') throw new Error('cylinder operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const r = positiveNumber(radius, undefined, `${name}.radius`);
  const h = positiveNumber(height, undefined, `${name}.height`);
  const n = integerInRange(segments, 3, 96, `${name}.segments`);
  const vertices = [];
  for (let i = 0; i < n; i += 1) {
    const a = (Math.PI * 2 * i) / n;
    vertices.push([x + r * Math.cos(a), y + r * Math.sin(a), z]);
  }
  for (let i = 0; i < n; i += 1) vertices.push([vertices[i][0], vertices[i][1], z + h]);
  const faces = [];
  for (let i = 1; i < n - 1; i += 1) faces.push([0, i + 1, i]);
  for (let i = 1; i < n - 1; i += 1) faces.push([n, n + i, n + i + 1]);
  for (let i = 0; i < n; i += 1) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  addMesh(model, { name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'cylinder';
  model.groups[model.groups.length - 1].segments = n;
}

export function addButtonOnPanel(model, operation) {
  const { name, center = operation.origin, size, radius, height, segments = 16, material, smooth = 'all', qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('button_on_panel operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const h = positiveNumber(height, undefined, `${name}.height`);
  const n = integerInRange(segments, 3, 96, `${name}.segments`);
  if (size !== undefined) {
    const [w, d] = normalizePlanSize(size, `${name}.size`);
    const cornerRadius = operation.corner_radius ?? operation.cornerRadius ?? Math.min(w, d) / 2;
    const r = Math.min(nonNegativeNumber(cornerRadius, 0, `${name}.corner_radius`), w / 2, d / 2);
    addRoundedBox(model, { name, origin: [x - w / 2, y - d / 2, z], size: [w, d, h], radius: r, segments: n, material, smooth, transform: operation.transform, qa });
  } else {
    addCylinder(model, { name, origin: [x, y, z], radius, height: h, segments: n, material, smooth, transform: operation.transform, qa });
  }
  const group = model.groups[model.groups.length - 1];
  group.kind = 'button_on_panel';
  group.segments = n;
}

function normalizePlanPoint(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${fieldName} must be [x, y]`);
  return value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number)) throw new Error(`${fieldName}[${index}] must be a finite number`);
    return number;
  });
}

function normalizePlanSize(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${fieldName} must be [width, depth]`);
  const normalized = value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number)) throw new Error(`${fieldName}[${index}] must be a finite number`);
    return number;
  });
  if (normalized.some((number) => number <= 0)) throw new Error(`${fieldName} values must be positive`);
  return normalized;
}

export function addComponentDefinition(model, { name, size = [1000, 1000, 1000], material, operations }) {
  if (!name || typeof name !== 'string') throw new Error('component_definition operation requires a string name');

  if (operations !== undefined) {
    if (!Array.isArray(operations)) throw new Error(`${name}.operations must be an array`);
    const componentModel = emptyModel();
    for (const operation of operations) {
      applyComponentDefinitionOperation(componentModel, operation, name);
    }
    for (const [materialName, materialValue] of Object.entries(componentModel.materials)) {
      if (!model.materials[materialName]) model.materials[materialName] = materialValue;
    }
    const groups = componentModel.groups;
    const faces = groups.reduce((sum, group) => sum + group.faces, 0);
    const edges = groups.reduce((sum, group) => sum + group.edges, 0);
    model.component_definitions[name] = {
      name,
      faces,
      edges,
      groups,
      material: groups.find((group) => group.material)?.material || null,
      bounding_box: mergeBoundingBoxes(groups.map((group) => group.bounding_box))
    };
    return;
  }

  const normalizedSize = normalizeVector(size, [1000, 1000, 1000], `${name}.size`);
  if (normalizedSize.some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const [w, d, h] = normalizedSize;
  model.component_definitions[name] = {
    name,
    faces: 6,
    edges: 12,
    groups: [],
    material: ensureMaterial(model, material),
    bounding_box: { min: [0, 0, 0], max: [w, d, h], w, d, h }
  };
}

function applyComponentDefinitionOperation(model, operation, componentName) {
  switch (operation.op) {
    case 'material':
      ensureMaterial(model, operation);
      break;
    case 'box':
      addBox(model, operation);
      break;
    case 'rounded_box':
      addRoundedBox(model, operation);
      break;
    case 'beveled_panel':
      addBeveledPanel(model, operation);
      break;
    case 'fillet':
      addFillet(model, operation);
      break;
    case 'chamfer':
      addChamfer(model, operation);
      break;
    case 'recess':
      addRecess(model, operation);
      break;
    case 'engraved_line':
      addEngravedLine(model, operation);
      break;
    case 'text_emboss':
      addTextEmboss(model, operation);
      break;
    case 'text_engrave':
      addTextEngrave(model, operation);
      break;
    case 'slot':
      addSlot(model, operation);
      break;
    case 'slot_array':
      addSlotArray(model, operation);
      break;
    case 'rib':
      addRib(model, operation);
      break;
    case 'standoff_boss':
      addStandoffBoss(model, operation);
      break;
    case 'button_on_panel':
      addButtonOnPanel(model, operation);
      break;
    case 'floor_slab':
      addFloorSlab(model, operation);
      break;
    case 'wall':
      addWall(model, operation);
      break;
    case 'door':
      addDoor(model, operation);
      break;
    case 'window':
      addWindow(model, operation);
      break;
    case 'stairs':
      addStairs(model, operation);
      break;
    case 'railing':
      addRailing(model, operation);
      break;
    case 'panel_with_openings':
      addPanelWithOpenings(model, operation);
      break;
    case 'boolean_cutout':
      addBooleanCutout(model, operation);
      break;
    case 'mesh':
      addMesh(model, operation);
      break;
    case 'prism':
      addPrism(model, operation);
      break;
    case 'face_with_holes':
      addFaceWithHoles(model, operation);
      break;
    case 'profile_extrude':
      addProfileExtrude(model, operation);
      break;
    case 'gable_roof':
      addGableRoof(model, operation);
      break;
    case 'shed_roof':
      addShedRoof(model, operation);
      break;
    case 'cylinder':
      addCylinder(model, operation);
      break;
    case 'loft_between_profiles':
      addLoftBetweenProfiles(model, operation);
      break;
    case 'shell_from_front_side_profiles':
      addShellFromFrontSideProfiles(model, operation);
      break;
    case 'lofted_solid':
      addLoftedSolid(model, operation);
      break;
    case 'face_on_cylinder':
      addFaceOnCylinder(model, operation);
      break;
    case 'analog_stick':
      addAnalogStick(model, operation);
      break;
    case 'screw_hole':
      addScrewHole(model, operation);
      break;
    case 'pipe_between_points':
      addPipeBetweenPoints(model, operation);
      break;
    case 'swept_path':
      addSweptPath(model, operation);
      break;
    case 'domed_surface':
      addDomedSurface(model, operation);
      break;
    case 'bowed_panel':
      addBowedPanel(model, operation);
      break;
    default:
      throw new Error(`${componentName}.operations does not support op: ${operation.op}`);
  }
}

export function addComponentInstance(model, operation) {
  const { name, definition, origin = [0, 0, 0] } = operation;
  if (!name || typeof name !== 'string') throw new Error('component_instance operation requires a string name');
  const componentDefinition = model.component_definitions[definition];
  if (!componentDefinition) throw new Error(`${name}.definition not found: ${definition}`);
  const translation = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const box = componentDefinition.bounding_box;
  const corners = boxVertices(box.min, [box.w, box.d, box.h]);
  const transform = operation.transform || {};
  const extraTranslate = normalizeVector(transform.translate ?? transform.translation ?? operation.translation ?? [0, 0, 0], [0, 0, 0], `${name}.transform.translate`);
  const boundingBox = boundingBoxForVertices(applyTransform(corners, {
    transform: {
      ...transform,
      translate: [translation[0] + extraTranslate[0], translation[1] + extraTranslate[1], translation[2] + extraTranslate[2]]
    }
  }, name));
  model.instances.push({
    id: objectId(operation, name),
    name,
    definition,
    faces: componentDefinition.faces,
    edges: componentDefinition.edges,
    material: componentDefinition.material,
    transform: normalizeTransform({ transform: { ...transform, translate: [translation[0] + extraTranslate[0], translation[1] + extraTranslate[1], translation[2] + extraTranslate[2]] } }, name),
    bounding_box: boundingBox,
    qa: normalizeQaMetadata(operation.qa)
  });
}

export function setCamera(model, { eye, target, up = [0, 0, 1], fov = 35 }) {
  model.view_state = {
    camera: normalizeCamera({ eye, target, up, fov }, 'camera')
  };
}

export function addScene(model, { name, camera }) {
  if (!name || typeof name !== 'string') throw new Error('scene operation requires a string name');
  const scene = { name };
  if (camera) scene.camera = normalizeCamera(camera, `${name}.camera`);
  model.scenes.push(scene);
  if (scene.camera) model.view_state = { camera: scene.camera, scene: name };
}


export function setStyle(model, operation = {}) {
  const style = {};
  if (operation.name !== undefined) style.name = nonEmptyString(operation.name, 'style.name');
  assignBoolean(style, operation, 'display_edges', 'style.display_edges');
  assignBoolean(style, operation, 'profiles', 'style.profiles');
  assignBoolean(style, operation, 'display_watermarks', 'style.display_watermarks');
  assignBoolean(style, operation, 'draw_ground', 'style.draw_ground');
  assignBoolean(style, operation, 'draw_sky', 'style.draw_sky');
  if (operation.profile_width !== undefined || operation.profileWidth !== undefined) {
    style.profile_width = positiveNumber(operation.profile_width ?? operation.profileWidth, undefined, 'style.profile_width');
  }
  if (operation.face_style !== undefined || operation.faceStyle !== undefined) {
    style.face_style = normalizeKeyword(operation.face_style ?? operation.faceStyle, ['wireframe', 'hidden_line', 'shaded', 'shaded_with_textures', 'monochrome'], 'style.face_style');
  }
  assignColor(style, operation, 'background_color', 'style.background_color');
  assignColor(style, operation, 'sky_color', 'style.sky_color');
  assignColor(style, operation, 'ground_color', 'style.ground_color');
  model.style_state = style;
}

export function setShadow(model, operation = {}) {
  const shadow = {};
  assignBoolean(shadow, operation, 'display', 'shadow.display');
  if (operation.time !== undefined) {
    const time = new Date(operation.time);
    if (Number.isNaN(time.getTime())) throw new Error('shadow.time must be an ISO-8601 date/time string');
    shadow.time = time.toISOString();
  }
  if (operation.light !== undefined) shadow.light = optionalNumberInRange(operation.light, 0, 100, 'shadow.light');
  if (operation.dark !== undefined) shadow.dark = optionalNumberInRange(operation.dark, 0, 100, 'shadow.dark');
  if (operation.use_sun_for_shading !== undefined || operation.useSunForShading !== undefined) {
    shadow.use_sun_for_shading = normalizeBoolean(operation.use_sun_for_shading ?? operation.useSunForShading, 'shadow.use_sun_for_shading');
  }
  model.shadow_state = shadow;
}

export function setRenderingOptions(model, operation = {}) {
  const options = {};
  assignRenderingBoolean(options, operation, 'draw_hidden_geometry', 'drawHiddenGeometry');
  assignRenderingBoolean(options, operation, 'display_color_by_layer', 'displayColorByLayer');
  assignRenderingBoolean(options, operation, 'transparency');
  assignRenderingBoolean(options, operation, 'draw_back_edges', 'drawBackEdges');
  assignRenderingBoolean(options, operation, 'draw_hidden', 'drawHidden');
  assignRenderingBoolean(options, operation, 'draw_ground', 'drawGround');
  assignRenderingBoolean(options, operation, 'draw_horizon', 'drawHorizon');
  assignRenderingNumber(options, operation, 'edge_display_mode', 'edgeDisplayMode', 0, 10);
  assignRenderingNumber(options, operation, 'render_mode', 'renderMode', 0, 10);
  assignRenderingNumber(options, operation, 'face_color_mode', 'faceColorMode', 0, 10);
  assignRenderingNumber(options, operation, 'model_transparency', 'modelTransparency', 0, 3);
  assignRenderingNumber(options, operation, 'material_transparency', 'materialTransparency', 0, 3);
  assignRenderingColor(options, operation, 'background_color', 'backgroundColor');
  assignRenderingColor(options, operation, 'sky_color', 'skyColor');
  assignRenderingColor(options, operation, 'ground_color', 'groundColor');
  model.rendering_options = options;
}

function assignBoolean(target, source, field, fieldName) {
  if (source[field] !== undefined) target[field] = normalizeBoolean(source[field], fieldName);
}

function assignColor(target, source, field, fieldName) {
  const camel = field.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  const value = source[field] ?? source[camel];
  if (value !== undefined) target[field] = normalizeColor(value, fieldName);
}

function assignRenderingBoolean(target, source, field, alias = field) {
  const value = source[field] ?? source[alias];
  if (value !== undefined) target[field] = normalizeBoolean(value, `rendering_options.${field}`);
}

function assignRenderingNumber(target, source, field, alias, min, max) {
  const value = source[field] ?? source[alias];
  if (value !== undefined) target[field] = optionalNumberInRange(value, min, max, `rendering_options.${field}`);
}

function assignRenderingColor(target, source, field, alias) {
  const value = source[field] ?? source[alias];
  if (value !== undefined) target[field] = normalizeColor(value, `rendering_options.${field}`);
}

export function addLoftBetweenProfiles(model, operation) {
  const { name, profiles, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('loft_between_profiles operation requires a string name');
  if (!Array.isArray(profiles) || profiles.length < 2) throw new Error(`${name}.profiles must contain at least 2 profile sections`);
  const sections = profiles.map((section, sectionIndex) => normalizeLoftProfileSection(section, `${name}.profiles[${sectionIndex}]`));
  const pointCount = sections[0].points.length;
  if (pointCount < 3) throw new Error(`${name}.profiles[0].points must contain at least 3 points`);
  for (const [index, section] of sections.entries()) {
    if (section.points.length !== pointCount) throw new Error(`${name}.profiles[${index}].points must contain ${pointCount} points to match the first profile`);
  }
  const vertices = sections.flatMap((section) => section.points);
  const faces = [];
  for (let ring = 0; ring < sections.length - 1; ring += 1) {
    const base = ring * pointCount;
    const top = (ring + 1) * pointCount;
    for (let i = 0; i < pointCount; i += 1) {
      const next = (i + 1) % pointCount;
      faces.push([base + i, base + next, top + next]);
      faces.push([base + i, top + next, top + i]);
    }
  }
  for (let i = 1; i < pointCount - 1; i += 1) faces.push([0, i + 1, i]);
  const topStart = (sections.length - 1) * pointCount;
  for (let i = 1; i < pointCount - 1; i += 1) faces.push([topStart, topStart + i, topStart + i + 1]);
  addMesh(model, { name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'loft_between_profiles';
  group.segments_z = sections.length - 1;
}

function normalizeLoftProfileSection(section, fieldName) {
  if (Array.isArray(section)) {
    return { points: section.map((point, index) => normalizeVector(point, [0, 0, 0], `${fieldName}[${index}]`)) };
  }
  if (!section || typeof section !== 'object') throw new Error(`${fieldName} must be an array of points or an object with points`);
  const origin = normalizeVector(section.origin ?? [0, 0, 0], [0, 0, 0], `${fieldName}.origin`);
  if (!Array.isArray(section.points) || section.points.length < 3) throw new Error(`${fieldName}.points must contain at least 3 points`);
  const plane = normalizeKeyword(section.plane ?? 'xy', ['xy', 'xz', 'yz'], `${fieldName}.plane`);
  return {
    points: section.points.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) throw new Error(`${fieldName}.points[${index}] must be [u, v]`);
      const u = Number(point[0]);
      const v = Number(point[1]);
      if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error(`${fieldName}.points[${index}] must contain finite numbers`);
      if (plane === 'xy') return [origin[0] + u, origin[1] + v, origin[2]];
      if (plane === 'xz') return [origin[0] + u, origin[1], origin[2] + v];
      return [origin[0], origin[1] + u, origin[2] + v];
    })
  };
}

export function addShellFromFrontSideProfiles(model, operation) {
  const { name, origin = [0, 0, 0], front_profile: frontProfileRaw, side_profile: sideProfileRaw, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('shell_from_front_side_profiles operation requires a string name');
  const [originX, originY, originZ] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const frontProfile = normalize2dProfile(frontProfileRaw ?? operation.frontProfile, `${name}.front_profile`, 'x', 'z');
  const sideProfile = normalize2dProfile(sideProfileRaw ?? operation.sideProfile, `${name}.side_profile`, 'z', 'half_depth')
    .sort((a, b) => a[0] - b[0]);
  if (frontProfile.length < 3) throw new Error(`${name}.front_profile must contain at least 3 [x, z] points`);
  if (sideProfile.length < 2) throw new Error(`${name}.side_profile must contain at least 2 [z, half_depth] points`);
  for (let index = 1; index < sideProfile.length; index += 1) {
    if (sideProfile[index][0] <= sideProfile[index - 1][0]) throw new Error(`${name}.side_profile z values must be strictly increasing`);
  }
  for (const [index, point] of sideProfile.entries()) {
    if (point[1] < 0) throw new Error(`${name}.side_profile[${index}][1] must be non-negative`);
  }
  const count = frontProfile.length;
  const frontVertices = frontProfile.map(([x, z]) => [originX + x, originY - shellDepthAt(sideProfile, z, name), originZ + z]);
  const backVertices = frontProfile.map(([x, z]) => [originX + x, originY + shellDepthAt(sideProfile, z, name), originZ + z]);
  const vertices = [...frontVertices, ...backVertices];
  const faces = [];
  for (let i = 1; i < count - 1; i += 1) faces.push([0, i, i + 1]);
  for (let i = 1; i < count - 1; i += 1) faces.push([count, count + i + 1, count + i]);
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    faces.push([i, next, count + next]);
    faces.push([i, count + next, count + i]);
  }
  addMesh(model, { name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'shell_from_front_side_profiles';
  group.segments = count;
}

function normalize2dProfile(profile, fieldName, firstLabel, secondLabel) {
  if (!Array.isArray(profile)) throw new Error(`${fieldName} must be an array of [${firstLabel}, ${secondLabel}] pairs`);
  return profile.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) throw new Error(`${fieldName}[${index}] must be [${firstLabel}, ${secondLabel}]`);
    const first = Number(point[0]);
    const second = Number(point[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) throw new Error(`${fieldName}[${index}] must contain finite numbers`);
    return [first, second];
  });
}

function shellDepthAt(sideProfile, z, name) {
  if (z <= sideProfile[0][0]) return sideProfile[0][1];
  const last = sideProfile[sideProfile.length - 1];
  if (z >= last[0]) return last[1];
  for (let index = 0; index < sideProfile.length - 1; index += 1) {
    const [z0, depth0] = sideProfile[index];
    const [z1, depth1] = sideProfile[index + 1];
    if (z >= z0 && z <= z1) {
      if (Math.abs(z1 - z0) <= 1e-9) throw new Error(`${name}.side_profile z values must be strictly increasing after sorting`);
      const t = (z - z0) / (z1 - z0);
      return depth0 + (depth1 - depth0) * t;
    }
  }
  return last[1];
}

export function addFaceOnCylinder(model, operation) {
  const { name, center, cylinder_center: cylinderCenterRaw, cylinder_radius: cylinderRadiusRaw, width, height, depth, angle, material, smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('face_on_cylinder operation requires a string name');
  const cylinderCenter = normalizeVector(cylinderCenterRaw ?? operation.cylinderCenter ?? [0, 0, 0], [0, 0, 0], `${name}.cylinder_center`);
  const surfaceCenter = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const radius = positiveNumber(cylinderRadiusRaw ?? operation.cylinderRadius, undefined, `${name}.cylinder_radius`);
  const patchWidth = positiveNumber(width, undefined, `${name}.width`);
  const patchHeight = positiveNumber(height, undefined, `${name}.height`);
  const patchDepth = positiveNumber(depth, 1, `${name}.depth`);
  const theta = angle !== undefined ? Number(angle) : Math.atan2(surfaceCenter[1] - cylinderCenter[1], surfaceCenter[0] - cylinderCenter[0]);
  if (!Number.isFinite(theta)) throw new Error(`${name}.angle must be a finite number`);
  const radial = [Math.cos(theta), Math.sin(theta), 0];
  const tangent = [-Math.sin(theta), Math.cos(theta), 0];
  const halfWidth = patchWidth / 2;
  const halfHeight = patchHeight / 2;
  const centerOnSurface = [cylinderCenter[0] + radial[0] * radius, cylinderCenter[1] + radial[1] * radius, surfaceCenter[2]];
  const makePoint = (tangentOffset, zOffset, radialOffset) => [
    centerOnSurface[0] + tangent[0] * tangentOffset + radial[0] * radialOffset,
    centerOnSurface[1] + tangent[1] * tangentOffset + radial[1] * radialOffset,
    centerOnSurface[2] + zOffset
  ];
  const vertices = [
    makePoint(-halfWidth, -halfHeight, 0),
    makePoint(halfWidth, -halfHeight, 0),
    makePoint(halfWidth, halfHeight, 0),
    makePoint(-halfWidth, halfHeight, 0),
    makePoint(-halfWidth, -halfHeight, patchDepth),
    makePoint(halfWidth, -halfHeight, patchDepth),
    makePoint(halfWidth, halfHeight, patchDepth),
    makePoint(-halfWidth, halfHeight, patchDepth)
  ];
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  addMesh(model, { name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'face_on_cylinder';
}

export function addLoftedSolid(model, { name, origin = [0, 0, 0], profile, segments = 10, n, material, smooth = 'all', transform, qa }) {
  if (!name || typeof name !== 'string') throw new Error('lofted_solid operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const ringCount = integerInRange(n ?? segments, 3, 96, `${name}.segments`);
  if (!Array.isArray(profile) || profile.length < 2) throw new Error(`${name}.profile must contain at least 2 [height, radius] pairs`);
  const normalizedProfile = profile.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) throw new Error(`${name}.profile[${index}] must be [height, radius]`);
    return [nonNegativeNumber(point[0], undefined, `${name}.profile[${index}][0]`), positiveNumber(point[1], undefined, `${name}.profile[${index}][1]`)];
  });
  const vertices = [];
  for (const [height, radius] of normalizedProfile) {
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (Math.PI * 2 * i) / ringCount;
      vertices.push([x + radius * Math.cos(angle), y + radius * Math.sin(angle), z + height]);
    }
  }
  const faces = [];
  for (let ring = 0; ring < normalizedProfile.length - 1; ring += 1) {
    const base = ring * ringCount;
    const top = (ring + 1) * ringCount;
    for (let i = 0; i < ringCount; i += 1) {
      const next = (i + 1) % ringCount;
      faces.push([base + i, base + next, top + next]);
      faces.push([base + i, top + next, top + i]);
    }
  }
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([0, i + 1, i]);
  const topStart = (normalizedProfile.length - 1) * ringCount;
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([topStart, topStart + i, topStart + i + 1]);
  addMesh(model, { name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'lofted_solid';
  model.groups[model.groups.length - 1].segments = ringCount;
}

export function addAnalogStick(model, operation) {
  const { name, origin = [0, 0, 0], profile, segments = 18, n, material, smooth = 'all', transform, qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('analog_stick operation requires a string name');
  const height = positiveNumber(operation.height, 125, `${name}.height`);
  const shaftHeight = positiveNumber(operation.shaft_height ?? operation.shaftHeight, height * 0.45, `${name}.shaft_height`);
  if (shaftHeight >= height) throw new Error(`${name}.shaft_height must be lower than height`);
  const baseRadius = positiveNumber(operation.base_radius ?? operation.baseRadius, 135, `${name}.base_radius`);
  const shaftRadius = positiveNumber(operation.shaft_radius ?? operation.shaftRadius, 92, `${name}.shaft_radius`);
  const capRadius = positiveNumber(operation.cap_radius ?? operation.capRadius, 180, `${name}.cap_radius`);
  const topRadius = positiveNumber(operation.top_radius ?? operation.topRadius, Math.max(shaftRadius, capRadius * 0.72), `${name}.top_radius`);
  const stickProfile = profile || [[0, baseRadius], [shaftHeight, shaftRadius], [height * 0.72, capRadius], [height, topRadius]];
  addLoftedSolid(model, { name, origin, profile: stickProfile, segments, n, material, smooth, transform, qa });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'analog_stick';
}

export function addScrewHole(model, operation) {
  const { name, center = operation.origin, segments = 16, n, material = 'Hole_Dark', smooth = 'all', transform, qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('screw_hole operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const radius = positiveNumber(operation.radius, undefined, `${name}.radius`);
  const depth = positiveNumber(operation.depth, 6, `${name}.depth`);
  const headRadius = operation.head_radius !== undefined || operation.headRadius !== undefined
    ? positiveNumber(operation.head_radius ?? operation.headRadius, undefined, `${name}.head_radius`)
    : radius;
  const headDepth = operation.head_depth !== undefined || operation.headDepth !== undefined
    ? positiveNumber(operation.head_depth ?? operation.headDepth, undefined, `${name}.head_depth`)
    : Math.min(depth, Math.max(1, depth * 0.45));
  const clampedHeadDepth = Math.min(headDepth, depth);
  const profile = headRadius > radius
    ? [[0, headRadius], [clampedHeadDepth, radius], [depth, radius]]
    : [[0, radius], [depth, radius]];
  addLoftedSolid(model, { name, origin: [x, y, z - depth], profile, segments, n, material, smooth, transform, qa });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'screw_hole';
}

export function addPipeBetweenPoints(model, operation) {
  const { name, radius, segments = 8, n, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('pipe_between_points operation requires a string name');
  const rawPath = operation.points ?? operation.path ?? (operation.start && operation.end ? [operation.start, operation.end] : undefined);
  if (!Array.isArray(rawPath) || rawPath.length < 2) throw new Error(`${name}.points must contain at least 2 [x, y, z] points`);
  const path = rawPath.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.points[${index}]`));
  const pipeRadius = positiveNumber(radius, undefined, `${name}.radius`);
  const ringCount = integerInRange(n ?? segments, 3, 96, `${name}.segments`);
  const vertices = [];
  for (let index = 0; index < path.length; index += 1) {
    const tangent = pipeTangent(path, index, name);
    const [u, v] = perpendicularFrame(tangent);
    const [x, y, z] = path[index];
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (Math.PI * 2 * i) / ringCount;
      const cos = Math.cos(angle) * pipeRadius;
      const sin = Math.sin(angle) * pipeRadius;
      vertices.push([x + u[0] * cos + v[0] * sin, y + u[1] * cos + v[1] * sin, z + u[2] * cos + v[2] * sin]);
    }
  }
  const faces = [];
  for (let ring = 0; ring < path.length - 1; ring += 1) {
    const base = ring * ringCount;
    const top = (ring + 1) * ringCount;
    for (let i = 0; i < ringCount; i += 1) {
      const next = (i + 1) % ringCount;
      faces.push([base + i, base + next, top + next]);
      faces.push([base + i, top + next, top + i]);
    }
  }
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([0, i + 1, i]);
  const topStart = (path.length - 1) * ringCount;
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([topStart, topStart + i, topStart + i + 1]);
  addMesh(model, { name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'pipe_between_points';
  group.segments = ringCount;
}

function pipeTangent(path, index, name) {
  const previous = path[Math.max(0, index - 1)];
  const next = path[Math.min(path.length - 1, index + 1)];
  const vector = [next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]];
  const length = Math.hypot(...vector);
  if (length <= 1e-9) throw new Error(`${name}.points must not contain repeated adjacent points`);
  return vector.map((value) => value / length);
}

function perpendicularFrame(tangent) {
  const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize3(cross3(reference, tangent));
  const v = normalize3(cross3(tangent, u));
  return [u, v];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(vector) {
  const length = Math.hypot(...vector);
  if (length <= 1e-9) throw new Error('Cannot normalize zero-length vector');
  return vector.map((value) => value / length);
}

export function addSweptPath(model, { name, path, radius, segments = 8, n, material, smooth = 'all', transform }) {
  if (!name || typeof name !== 'string') throw new Error('swept_path operation requires a string name');
  if (!Array.isArray(path) || path.length < 2) throw new Error(`${name}.path must contain at least 2 [x, y, z] points`);
  const normalizedPath = path.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.path[${index}]`));
  const tubeRadius = positiveNumber(radius, undefined, `${name}.radius`);
  const ringCount = integerInRange(n ?? segments, 3, 96, `${name}.segments`);
  const vertices = [];
  for (const [x, y, z] of normalizedPath) {
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (Math.PI * 2 * i) / ringCount;
      vertices.push([x, y + tubeRadius * Math.cos(angle), z + tubeRadius * Math.sin(angle)]);
    }
  }
  const faces = [];
  for (let ring = 0; ring < normalizedPath.length - 1; ring += 1) {
    const base = ring * ringCount;
    const top = (ring + 1) * ringCount;
    for (let i = 0; i < ringCount; i += 1) {
      const next = (i + 1) % ringCount;
      faces.push([base + i, base + next, top + next]);
      faces.push([base + i, top + next, top + i]);
    }
  }
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([0, i + 1, i]);
  const topStart = (normalizedPath.length - 1) * ringCount;
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([topStart, topStart + i, topStart + i + 1]);
  addMesh(model, { name, vertices, faces, material, smooth, transform });
  model.groups[model.groups.length - 1].kind = 'swept_path';
  model.groups[model.groups.length - 1].segments = ringCount;
}

export function addDomedSurface(model, operation) {
  const {
    name,
    origin = [0, 0, 0],
    width,
    depth,
    thickness,
    crown_height,
    crownHeight,
    segments_x = 8,
    segments_y = 8,
    nx,
    ny,
    material,
    smooth = 'all',
    transform,
    qa
  } = operation;
  if (!name || typeof name !== 'string') throw new Error('domed_surface operation requires a string name');
  const [x0, y0, z0] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const surfaceWidth = positiveNumber(width, undefined, `${name}.width`);
  const surfaceDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const surfaceThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const crown = nonNegativeNumber(crown_height ?? crownHeight, 0, `${name}.crown_height`);
  const xSegments = integerInRange(nx ?? segments_x, 1, 96, `${name}.segments_x`);
  const ySegments = integerInRange(ny ?? segments_y, 1, 96, `${name}.segments_y`);
  const vertices = [];
  const cols = xSegments + 1;
  const bottomIndex = (ix, iy) => (iy * cols + ix) * 2;
  const topIndex = (ix, iy) => bottomIndex(ix, iy) + 1;
  for (let iy = 0; iy <= ySegments; iy += 1) {
    for (let ix = 0; ix <= xSegments; ix += 1) {
      const u = ix / xSegments;
      const v = iy / ySegments;
      const x = x0 + u * surfaceWidth;
      const y = y0 + v * surfaceDepth;
      const du = (u - 0.5) * 2;
      const dv = (v - 0.5) * 2;
      const dome = crown * Math.max(0, 1 - du * du) * Math.max(0, 1 - dv * dv);
      vertices.push([x, y, z0]);
      vertices.push([x, y, z0 + surfaceThickness + dome]);
    }
  }
  const faces = [];
  for (let iy = 0; iy < ySegments; iy += 1) {
    for (let ix = 0; ix < xSegments; ix += 1) {
      faces.push([topIndex(ix, iy), topIndex(ix + 1, iy), topIndex(ix + 1, iy + 1)]);
      faces.push([topIndex(ix, iy), topIndex(ix + 1, iy + 1), topIndex(ix, iy + 1)]);
      faces.push([bottomIndex(ix, iy), bottomIndex(ix + 1, iy + 1), bottomIndex(ix + 1, iy)]);
      faces.push([bottomIndex(ix, iy), bottomIndex(ix, iy + 1), bottomIndex(ix + 1, iy + 1)]);
    }
  }
  addGridSkirtFaces(faces, bottomIndex, topIndex, xSegments, ySegments);
  addMesh(model, { name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'domed_surface';
  model.groups[model.groups.length - 1].segments_x = xSegments;
  model.groups[model.groups.length - 1].segments_y = ySegments;
}

export function addBowedPanel(model, operation) {
  const {
    name,
    origin = [0, 0, 0],
    width,
    height,
    thickness,
    bow_depth,
    bowDepth,
    segments_x = 8,
    segments_z = 8,
    nx,
    nz,
    material,
    smooth = 'all',
    transform,
    qa
  } = operation;
  if (!name || typeof name !== 'string') throw new Error('bowed_panel operation requires a string name');
  const [x0, y0, z0] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const panelWidth = positiveNumber(width, undefined, `${name}.width`);
  const panelHeight = positiveNumber(height, undefined, `${name}.height`);
  const panelThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const bow = finiteNumber(bow_depth ?? bowDepth, 0, `${name}.bow_depth`);
  if (panelThickness + Math.min(0, bow) <= 0) throw new Error(`${name}.thickness + bow_depth must stay positive`);
  const xSegments = integerInRange(nx ?? segments_x, 1, 96, `${name}.segments_x`);
  const zSegments = integerInRange(nz ?? segments_z, 1, 96, `${name}.segments_z`);
  const vertices = [];
  const cols = xSegments + 1;
  const frontIndex = (ix, iz) => (iz * cols + ix) * 2;
  const backIndex = (ix, iz) => frontIndex(ix, iz) + 1;
  for (let iz = 0; iz <= zSegments; iz += 1) {
    for (let ix = 0; ix <= xSegments; ix += 1) {
      const u = ix / xSegments;
      const v = iz / zSegments;
      const x = x0 + u * panelWidth;
      const z = z0 + v * panelHeight;
      const du = (u - 0.5) * 2;
      const dv = (v - 0.5) * 2;
      const bowedOffset = bow * Math.max(0, 1 - du * du) * Math.max(0, 1 - dv * dv);
      vertices.push([x, y0, z]);
      vertices.push([x, y0 + panelThickness + bowedOffset, z]);
    }
  }
  const faces = [];
  for (let iz = 0; iz < zSegments; iz += 1) {
    for (let ix = 0; ix < xSegments; ix += 1) {
      faces.push([frontIndex(ix, iz), frontIndex(ix + 1, iz + 1), frontIndex(ix + 1, iz)]);
      faces.push([frontIndex(ix, iz), frontIndex(ix, iz + 1), frontIndex(ix + 1, iz + 1)]);
      faces.push([backIndex(ix, iz), backIndex(ix + 1, iz), backIndex(ix + 1, iz + 1)]);
      faces.push([backIndex(ix, iz), backIndex(ix + 1, iz + 1), backIndex(ix, iz + 1)]);
    }
  }
  addGridSkirtFaces(faces, frontIndex, backIndex, xSegments, zSegments);
  addMesh(model, { name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'bowed_panel';
  model.groups[model.groups.length - 1].segments_x = xSegments;
  model.groups[model.groups.length - 1].segments_z = zSegments;
}

function addGridSkirtFaces(faces, lowerIndex, upperIndex, xSegments, ySegments) {
  for (let ix = 0; ix < xSegments; ix += 1) {
    faces.push([lowerIndex(ix, 0), lowerIndex(ix + 1, 0), upperIndex(ix + 1, 0)]);
    faces.push([lowerIndex(ix, 0), upperIndex(ix + 1, 0), upperIndex(ix, 0)]);
    faces.push([lowerIndex(ix, ySegments), upperIndex(ix, ySegments), upperIndex(ix + 1, ySegments)]);
    faces.push([lowerIndex(ix, ySegments), upperIndex(ix + 1, ySegments), lowerIndex(ix + 1, ySegments)]);
  }
  for (let iy = 0; iy < ySegments; iy += 1) {
    faces.push([lowerIndex(0, iy), upperIndex(0, iy), upperIndex(0, iy + 1)]);
    faces.push([lowerIndex(0, iy), upperIndex(0, iy + 1), lowerIndex(0, iy + 1)]);
    faces.push([lowerIndex(xSegments, iy), lowerIndex(xSegments, iy + 1), upperIndex(xSegments, iy + 1)]);
    faces.push([lowerIndex(xSegments, iy), upperIndex(xSegments, iy + 1), upperIndex(xSegments, iy)]);
  }
}

function normalizeCamera({ eye, target, up = [0, 0, 1], fov = 35 }, fieldName) {
  return {
    eye: normalizeVector(eye, [0, -8000, 5000], `${fieldName}.eye`),
    target: normalizeVector(target, [0, 0, 0], `${fieldName}.target`),
    up: normalizeVector(up, [0, 0, 1], `${fieldName}.up`),
    fov: Number(fov)
  };
}

function normalizeTransform(operation = {}, fieldName = 'transform') {
  const transform = operation.transform || {};
  const translate = transform.translate ?? transform.translation ?? operation.translation ?? [0, 0, 0];
  const rotateZ = transform.rotateZ ?? transform.rotationZ ?? transform.rotation?.z ?? operation.rotateZ ?? 0;
  return {
    translate: normalizeVector(translate, [0, 0, 0], `${fieldName}.transform.translate`),
    rotateZ: Number(rotateZ)
  };
}

function normalizeQaMetadata(qa) {
  if (qa === undefined || qa === null) return null;
  if (typeof qa !== 'object' || Array.isArray(qa)) throw new Error('qa metadata must be an object');
  const normalized = {};
  if (qa.role !== undefined) normalized.role = nonEmptyString(qa.role, 'qa.role');
  if (qa.part_id !== undefined || qa.partId !== undefined) normalized.part_id = nonEmptyString(qa.part_id ?? qa.partId, 'qa.part_id');
  if (qa.intent !== undefined) normalized.intent = nonEmptyString(qa.intent, 'qa.intent');
  if (qa.expected_contacts !== undefined || qa.expectedContacts !== undefined) {
    const contacts = qa.expected_contacts ?? qa.expectedContacts;
    if (!Array.isArray(contacts)) throw new Error('qa.expected_contacts must be an array');
    normalized.expected_contacts = contacts.map((contact, index) => normalizeExpectedContact(contact, index));
  }
  for (const [key, value] of Object.entries(qa)) {
    if (['role', 'part_id', 'partId', 'intent', 'expected_contacts', 'expectedContacts'].includes(key)) continue;
    if (isJsonValue(value)) normalized[key] = structuredClone(value);
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeExpectedContact(contact, index) {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) throw new Error(`qa.expected_contacts[${index}] must be an object`);
  const withName = contact.with ?? contact.object ?? contact.name;
  const bucket = contact.bucket;
  const note = contact.note;
  return {
    with: nonEmptyString(withName, `qa.expected_contacts[${index}].with`),
    bucket: nonEmptyString(bucket, `qa.expected_contacts[${index}].bucket`),
    ...(note !== undefined ? { note: nonEmptyString(note, `qa.expected_contacts[${index}].note`) } : {})
  };
}

function isJsonValue(value) {
  if (value === null) return true;
  if (['string', 'number', 'boolean'].includes(typeof value)) return Number.isFinite(value) || typeof value !== 'number';
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
}

function applyTransform(vertices, operation = {}, fieldName = 'transform') {
  const { translate, rotateZ } = normalizeTransform(operation, fieldName);
  const radians = (rotateZ * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return vertices.map(([x, y, z]) => [
    x * cos - y * sin + translate[0],
    x * sin + y * cos + translate[1],
    z + translate[2]
  ]);
}

function boundingBoxForVertices(vertices) {
  return mergeBoundingBoxes(vertices.map(([x, y, z]) => ({ min: [x, y, z], max: [x, y, z] })));
}

function nonNegativeNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${fieldName} must be a non-negative number`);
  return number;
}

function finiteNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} must be a finite number`);
  return number;
}

function integerInRange(value, min, max, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${fieldName} must be an integer from ${min} to ${max}`);
  return number;
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

export function addDemoRoom(model, operation = {}) {
  const width = positiveNumber(operation.width, 4500, 'room.width');
  const depth = positiveNumber(operation.depth, 3000, 'room.depth');
  const height = positiveNumber(operation.height, 2400, 'room.height');
  const wallThickness = positiveNumber(operation.wall_thickness ?? operation.wallThickness, 120, 'room.wall_thickness');
  const floorThickness = positiveNumber(operation.floor_thickness ?? operation.floorThickness, 100, 'room.floor_thickness');
  const name = operation.name || 'Demo_Room';

  ensureMaterial(model, 'Floor_Oak', '#a87945');
  ensureMaterial(model, 'Wall_Paint', '#efe7dc');
  ensureMaterial(model, 'Door_Wood', '#7a4a2b');
  ensureMaterial(model, 'Window_Glass', '#8ecae6');
  ensureMaterial(model, 'Table_Wood', '#9b6b43');
  ensureMaterial(model, 'Chair_Fabric', '#315c8a');

  addBox(model, {
    name: `${name}_Floor`,
    origin: [0, 0, 0],
    size: [width, depth, floorThickness],
    material: 'Floor_Oak'
  });

  const doorWidth = 900;
  const doorHeight = 2100;
  const doorX = (width - doorWidth) / 2;
  const wallZ = floorThickness;

  addBox(model, {
    name: `${name}_Wall_South_Left`,
    origin: [0, -wallThickness, wallZ],
    size: [doorX, wallThickness, height],
    material: 'Wall_Paint'
  });
  addBox(model, {
    name: `${name}_Wall_South_Right`,
    origin: [doorX + doorWidth, -wallThickness, wallZ],
    size: [width - doorX - doorWidth, wallThickness, height],
    material: 'Wall_Paint'
  });
  addBox(model, {
    name: `${name}_Wall_South_Header`,
    origin: [doorX, -wallThickness, wallZ + doorHeight],
    size: [doorWidth, wallThickness, height - doorHeight],
    material: 'Wall_Paint'
  });
  addBox(model, {
    name: `${name}_Door_Panel`,
    origin: [doorX + 25, -wallThickness - 25, wallZ],
    size: [doorWidth - 50, 25, doorHeight],
    material: 'Door_Wood'
  });

  addBox(model, {
    name: `${name}_Wall_North`,
    origin: [0, depth, wallZ],
    size: [width, wallThickness, height],
    material: 'Wall_Paint'
  });
  addBox(model, {
    name: `${name}_Wall_West`,
    origin: [-wallThickness, 0, wallZ],
    size: [wallThickness, depth, height],
    material: 'Wall_Paint'
  });
  addBox(model, {
    name: `${name}_Wall_East`,
    origin: [width, 0, wallZ],
    size: [wallThickness, depth, height],
    material: 'Wall_Paint'
  });

  addBox(model, {
    name: `${name}_Window_North_Glass`,
    origin: [width * 0.58, depth + wallThickness + 6, wallZ + 1050],
    size: [1050, 12, 750],
    material: 'Window_Glass'
  });

  const tableX = width / 2 - 600;
  const tableY = depth / 2 - 400;
  addBox(model, { name: `${name}_Table_Top`, origin: [tableX, tableY, 750], size: [1200, 800, 75], material: 'Table_Wood' });
  for (const [index, leg] of [[0, 0], [1100, 0], [0, 700], [1100, 700]].entries()) {
    addBox(model, { name: `${name}_Table_Leg_${index + 1}`, origin: [tableX + leg[0], tableY + leg[1], 100], size: [100, 100, 650], material: 'Table_Wood' });
  }

  addBox(model, { name: `${name}_Chair_Seat`, origin: [tableX + 300, tableY - 550, 450], size: [600, 500, 75], material: 'Chair_Fabric' });
  addBox(model, { name: `${name}_Chair_Back`, origin: [tableX + 300, tableY - 600, 525], size: [600, 75, 700], material: 'Chair_Fabric' });
  addBox(model, { name: `${name}_Chair_Leg_1`, origin: [tableX + 350, tableY - 500, 100], size: [75, 75, 350], material: 'Chair_Fabric' });
  addBox(model, { name: `${name}_Chair_Leg_2`, origin: [tableX + 775, tableY - 500, 100], size: [75, 75, 350], material: 'Chair_Fabric' });
  addBox(model, { name: `${name}_Chair_Leg_3`, origin: [tableX + 350, tableY - 150, 100], size: [75, 75, 350], material: 'Chair_Fabric' });
  addBox(model, { name: `${name}_Chair_Leg_4`, origin: [tableX + 775, tableY - 150, 100], size: [75, 75, 350], material: 'Chair_Fabric' });

  addWarning(model, 'info.limitation', 'info', 'Door opening is represented by segmented wall boxes in the MVP DSL.', 'demo_room');
  addWarning(model, 'info.limitation', 'info', 'Window is represented as glass marker geometry; true boolean wall cuts are left for the SketchUp plugin refinement.', 'demo_room');
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
      transform: group.transform || null,
      visible: group.hidden ? false : true,
      qa: group.qa || null
    };
    // Surface resolution tracking
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

  const allWarnings = [...model.warnings, ...generatedWarnings];
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

function computeWarningSummary(warnings) {
  const summary = { total: warnings.length, by_severity: { error: 0, warn: 0, info: 0 }, by_category: {} };
  for (const w of warnings) {
    summary.by_severity[w.severity] = (summary.by_severity[w.severity] || 0) + 1;
    summary.by_category[w.category] = (summary.by_category[w.category] || 0) + 1;
  }
  return summary;
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


function normalizeBoolean(value, fieldName) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${fieldName} must be a boolean`);
}

function normalizeColor(value, fieldName) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${fieldName} must be a #rrggbb color`);
  }
  return value.toLowerCase();
}

function nonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${fieldName} must be a non-empty string`);
  return value;
}

function normalizeKeyword(value, allowed, fieldName) {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  const normalized = value.trim().toLowerCase().replace(/[ -]/g, '_');
  if (!allowed.includes(normalized)) throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  return normalized;
}

function optionalNumberInRange(value, min, max, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${fieldName} must be a number from ${min} to ${max}`);
  }
  return number;
}

function positiveNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return number;
}
