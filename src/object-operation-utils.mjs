export function normalizeAttributeUpdates(operation, dictionary) {
  const hasAttributes = operation.attributes !== undefined;
  const hasKeyValue = operation.key !== undefined || operation.attr_key !== undefined || operation.attrKey !== undefined || operation.value !== undefined;
  if (!hasAttributes && !hasKeyValue) throw new Error('attribute requires attributes or key/value');
  if (hasAttributes && (!operation.attributes || typeof operation.attributes !== 'object' || Array.isArray(operation.attributes))) {
    throw new Error('attribute.attributes must be an object');
  }
  const updates = hasAttributes ? { ...operation.attributes } : {};
  if (hasKeyValue) {
    const key = nonEmptyString(operation.key ?? operation.attr_key ?? operation.attrKey, 'attribute.key');
    updates[key] = operation.value;
  }
  for (const [key, value] of Object.entries(updates)) {
    nonEmptyString(key, `attribute.${dictionary}.key`);
    if (!isJsonValue(value)) throw new Error(`attribute.${dictionary}.${key} must be a JSON value`);
  }
  return updates;
}

export function normalizeClassification(operation) {
  const system = nonEmptyString(operation.system ?? operation.schema ?? 'IFC', 'classification.system');
  const type = nonEmptyString(operation.type ?? operation.classification ?? operation.ifc_class ?? operation.ifcClass ?? operation.class, 'classification.type');
  const result = { system, type };
  const name = operation.class_name ?? operation.className ?? operation.label;
  const identifier = operation.identifier ?? operation.id_value ?? operation.idValue;
  if (name !== undefined) result.name = nonEmptyString(name, 'classification.name');
  if (identifier !== undefined) result.identifier = nonEmptyString(identifier, 'classification.identifier');
  if (operation.attributes !== undefined) {
    if (!operation.attributes || typeof operation.attributes !== 'object' || Array.isArray(operation.attributes)) {
      throw new Error('classification.attributes must be an object');
    }
    for (const [key, value] of Object.entries(operation.attributes)) {
      nonEmptyString(key, 'classification.attributes.key');
      if (!isJsonValue(value)) throw new Error(`classification.attributes.${key} must be a JSON value`);
    }
    result.attributes = structuredClone(operation.attributes);
  }
  return result;
}

export function normalizeTextureTransform(operation, fieldName) {
  const projection = normalizeKeyword(operation.projection ?? 'planar', ['planar', 'box'], `${fieldName}.projection`);
  const rawOffset = operation.offset;
  const offset = rawOffset !== undefined
    ? normalizeUvPair(rawOffset, `${fieldName}.offset`)
    : [
        finiteNumber(operation.offset_u ?? operation.offsetU, 0, `${fieldName}.offset_u`),
        finiteNumber(operation.offset_v ?? operation.offsetV, 0, `${fieldName}.offset_v`)
      ];
  const rawScale = operation.scale;
  const scale = rawScale !== undefined
    ? normalizeUvPair(rawScale, `${fieldName}.scale`)
    : [
        positiveNumber(operation.scale_u ?? operation.scaleU, 1, `${fieldName}.scale_u`),
        positiveNumber(operation.scale_v ?? operation.scaleV, 1, `${fieldName}.scale_v`)
      ];
  const rotation = finiteNumber(operation.rotation ?? operation.rotation_degrees ?? operation.rotationDegrees, 0, `${fieldName}.rotation`);
  if (scale.some(value => value <= 0)) throw new Error(`${fieldName}.scale values must be positive`);
  const result = { projection, offset, scale, rotation };
  const material = operation.material ?? operation.material_name ?? operation.materialName;
  if (material !== undefined) result.material = nonEmptyString(material, `${fieldName}.material`);
  if (operation.texture_size_mm !== undefined) result.texture_size_mm = normalizeSize2(operation.texture_size_mm, `${fieldName}.texture_size_mm`);
  if (operation.side !== undefined) result.side = normalizeKeyword(operation.side, ['front', 'back', 'both'], `${fieldName}.side`);
  if (operation.face_selector !== undefined) {
    const selector = operation.face_selector;
    if (typeof selector === 'string' && selector) result.face_selector = { type: 'named', value: selector };
    else if (Number.isInteger(selector) && selector >= 0) result.face_selector = { type: 'index', value: selector };
    else if (selector && typeof selector === 'object' && !Array.isArray(selector) && (selector.type === 'all' || selector.type === 'index' && Number.isInteger(selector.value) && selector.value >= 0 || selector.type === 'named' && typeof selector.value === 'string' && selector.value)) result.face_selector = structuredClone(selector);
    else throw new Error(`${fieldName}.face_selector must select all, a nonnegative face index, or a named face`);
  }
  return result;
}

export function normalizeSize2(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${fieldName} must be [width, height]`);
  return value.map((item, index) => positiveNumber(item, undefined, `${fieldName}[${index}]`));
}

export function classificationAttributeSnapshot(classification) {
  const snapshot = {
    system: classification.system,
    type: classification.type
  };
  if (classification.name !== undefined) snapshot.name = classification.name;
  if (classification.identifier !== undefined) snapshot.identifier = classification.identifier;
  if (classification.attributes !== undefined) snapshot.attributes_json = JSON.stringify(classification.attributes);
  return snapshot;
}

export function textureTransformAttributeSnapshot(textureTransform) {
  return {
    projection: textureTransform.projection,
    offset_u: textureTransform.offset[0],
    offset_v: textureTransform.offset[1],
    scale_u: textureTransform.scale[0],
    scale_v: textureTransform.scale[1],
    rotation: textureTransform.rotation,
    ...(textureTransform.texture_size_mm ? { texture_size_mm: textureTransform.texture_size_mm } : {}),
    ...(textureTransform.side ? { side: textureTransform.side } : {}),
    ...(textureTransform.face_selector ? { face_selector_json: JSON.stringify(textureTransform.face_selector) } : {}),
    ...(textureTransform.material ? { material: textureTransform.material } : {})
  };
}

export function normalizeBoolean(value, fieldName) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${fieldName} must be a boolean`);
}

export function colorHex(value, fieldName) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${fieldName} must be a #rrggbb color`);
  return value.toLowerCase();
}

export function nonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${fieldName} must be a non-empty string`);
  return value;
}

export function finiteNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} must be a finite number`);
  return number;
}

export function positiveNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return number;
}

function normalizeUvPair(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${fieldName} must be [u, v]`);
  return value.map((item, index) => finiteNumber(item, undefined, `${fieldName}[${index}]`));
}

function normalizeKeyword(value, allowed, fieldName) {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  const normalized = value.trim().toLowerCase().replace(/[ -]/g, '_');
  if (!allowed.includes(normalized)) throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  return normalized;
}

function isJsonValue(value) {
  if (value === null) return true;
  if (['string', 'number', 'boolean'].includes(typeof value)) return Number.isFinite(value) || typeof value !== 'number';
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object') return Object.values(value).every(isJsonValue);
  return false;
}
