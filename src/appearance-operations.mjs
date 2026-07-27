import { findModelObject, resolveObjectReference } from './object-identity.mjs';
import { finiteNumber, nonEmptyString, positiveNumber } from './object-operation-utils.mjs';

export function addImageReference(model, operation) {
  const name = nonEmptyString(operation.name, 'image_reference.name');
  const path = nonEmptyString(operation.path ?? operation.file ?? operation.filename ?? operation.image, 'image_reference.path');
  model.image_references ||= {};
  const existing = model.image_references[name] || {};
  const reference = {
    ...existing,
    name,
    path,
    role: operation.role === undefined ? existing.role || null : nonEmptyString(operation.role, 'image_reference.role'),
    source: operation.source === undefined ? existing.source || null : nonEmptyString(operation.source, 'image_reference.source')
  };
  if (operation.width !== undefined) reference.width = positiveNumber(operation.width, undefined, 'image_reference.width');
  if (operation.height !== undefined) reference.height = positiveNumber(operation.height, undefined, 'image_reference.height');
  if (operation.scale !== undefined) reference.scale = positiveNumber(operation.scale, undefined, 'image_reference.scale');
  if (operation.metadata !== undefined) {
    if (!operation.metadata || typeof operation.metadata !== 'object' || Array.isArray(operation.metadata)) {
      throw new Error('image_reference.metadata must be an object');
    }
    reference.metadata = structuredClone(operation.metadata);
  }
  model.image_references[name] = reference;
  return reference;
}

export function setFaceUv(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'face_uv'));
  const faceUv = normalizeFaceUv(operation);
  target.item.face_uvs ||= [];
  const existingIndex = target.item.face_uvs.findIndex((item) => item.id === faceUv.id);
  if (existingIndex >= 0) target.item.face_uvs[existingIndex] = faceUv;
  else target.item.face_uvs.push(faceUv);
  target.item.attributes ||= {};
  target.item.attributes.FaceUV ||= {};
  target.item.attributes.FaceUV[faceUv.id] = JSON.stringify(faceUv);
  return faceUv;
}

function normalizeFaceUv(operation) {
  const id = nonEmptyString(operation.uv_id ?? operation.uvId ?? operation.face ?? operation.face_id ?? 'default', 'face_uv.uv_id');
  const uv = operation.uv ?? operation.coordinates ?? operation.coords;
  if (!Array.isArray(uv) || uv.length < 3) throw new Error('face_uv.uv must contain at least 3 [u,v] pairs');
  const normalized = {
    id,
    selector: normalizeFaceSelector(operation.face_selector ?? operation.faceSelector ?? operation.face ?? operation.face_id),
    projection: operation.projection === undefined ? 'explicit' : nonEmptyString(operation.projection, 'face_uv.projection'),
    uv: uv.map((point, index) => normalizeUvPoint(point, `face_uv.uv[${index}]`))
  };
  if (operation.mapping !== undefined) {
    if (!Array.isArray(operation.mapping)) throw new Error('face_uv.mapping must be an array');
    normalized.mapping = operation.mapping.map((entry, index) => normalizeFaceUvMapping(entry, `face_uv.mapping[${index}]`));
  }
  const material = operation.material ?? operation.material_name ?? operation.materialName;
  if (material !== undefined) normalized.material = nonEmptyString(material, 'face_uv.material');
  const imageReference = operation.image_reference ?? operation.imageReference ?? operation.image;
  if (imageReference !== undefined) normalized.image_reference = nonEmptyString(imageReference, 'face_uv.image_reference');
  return normalized;
}

function normalizeFaceUvMapping(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return {
    point: normalizeModelPoint(value.point, `${fieldName}.point`),
    uv: normalizeUvPoint(value.uv, `${fieldName}.uv`)
  };
}

function normalizeModelPoint(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${fieldName} must be [x, y, z]`);
  return [
    finiteNumber(value[0], undefined, `${fieldName}[0]`),
    finiteNumber(value[1], undefined, `${fieldName}[1]`),
    finiteNumber(value[2], undefined, `${fieldName}[2]`)
  ];
}

function normalizeFaceSelector(value) {
  if (value === undefined || value === null) return { type: 'all' };
  if (typeof value === 'string') return { type: 'named', value };
  if (Number.isInteger(Number(value))) return { type: 'index', value: Number(value) };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('face_uv.face_selector must be a string, number, or object');
  return structuredClone(value);
}

function normalizeUvPoint(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${fieldName} must be [u, v]`);
  return [
    finiteNumber(value[0], undefined, `${fieldName}[0]`),
    finiteNumber(value[1], undefined, `${fieldName}[1]`)
  ];
}
