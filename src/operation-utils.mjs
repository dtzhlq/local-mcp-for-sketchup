import { matrixFromTransform, transformPoint } from './geometry-matrix.mjs';
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

export function normalizePlanPoint(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${fieldName} must be [x, y]`);
  return value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number)) throw new Error(`${fieldName}[${index}] must be a finite number`);
    return number;
  });
}

export function normalizePlanSize(value, fieldName) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${fieldName} must be [width, depth]`);
  const normalized = value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number)) throw new Error(`${fieldName}[${index}] must be a finite number`);
    return number;
  });
  if (normalized.some((number) => number <= 0)) throw new Error(`${fieldName} values must be positive`);
  return normalized;
}

export function normalizeCamera({ eye, target, up = [0, 0, 1], fov = 35 }, fieldName) {
  return {
    eye: normalizeVector(eye, [0, -8000, 5000], `${fieldName}.eye`),
    target: normalizeVector(target, [0, 0, 0], `${fieldName}.target`),
    up: normalizeVector(up, [0, 0, 1], `${fieldName}.up`),
    fov: Number(fov)
  };
}

export function normalizeTransform(operation = {}, fieldName = 'transform') {
  const transform = operation.transform || {};
  if (['matrix','rotateX','rotateY','scale','axis'].some(k=>transform[k]!==undefined)) return {matrix:matrixFromTransform(transform),translate:[0,0,0],rotateZ:0};
  const translate = transform.translate ?? transform.translation ?? operation.translation ?? [0, 0, 0];
  const rotateZ = transform.rotateZ ?? transform.rotationZ ?? transform.rotation?.z ?? operation.rotateZ ?? 0;
  return {
    translate: normalizeVector(translate, [0, 0, 0], `${fieldName}.transform.translate`),
    rotateZ: Number(rotateZ)
  };
}

export function normalizeQaMetadata(qa) {
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

export function applyTransform(vertices, operation = {}, fieldName = 'transform') {
  const matrix=matrixFromTransform(normalizeTransform(operation, fieldName));
  return vertices.map(point=>transformPoint(matrix,point));
}

export function nonNegativeNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${fieldName} must be a non-negative number`);
  return number;
}

export function finiteNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} must be a finite number`);
  return number;
}

export function integerInRange(value, min, max, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${fieldName} must be an integer from ${min} to ${max}`);
  return number;
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

export function normalizeColor(value, fieldName) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${fieldName} must be a #rrggbb color`);
  }
  return value.toLowerCase();
}

export function nonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${fieldName} must be a non-empty string`);
  return value;
}

export function normalizeKeyword(value, allowed, fieldName) {
  if (typeof value !== 'string') throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  const normalized = value.trim().toLowerCase().replace(/[ -]/g, '_');
  if (!allowed.includes(normalized)) throw new Error(`${fieldName} must be one of: ${allowed.join(', ')}`);
  return normalized;
}

export function optionalNumberInRange(value, min, max, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${fieldName} must be a number from ${min} to ${max}`);
  }
  return number;
}

export function positiveNumber(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return number;
}
