import { nonEmptyString } from './object-operation-utils.mjs';

export function objectId(operation, fallbackName) {
  return nonEmptyString(operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid ?? fallbackName, `${fallbackName}.id`);
}

export function objectIdentityFields(operation = {}) {
  const explicitId = operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid;
  return explicitId === undefined ? {} : { id: explicitId };
}

export function assertObjectIdentityAvailable(model, reference) {
  const duplicateById = findModelObject(model, { id: reference.id }, false);
  if (duplicateById) throw new Error(`object id already exists: ${reference.id}`);
  const duplicateByName = findModelObject(model, { name: reference.name }, false);
  if (duplicateByName) throw new Error(`object name already exists: ${reference.name}`);
}

export function resolveObjectReference(operation, opName) {
  const rawId = operation.target_id ?? operation.targetId ?? operation.id ?? operation.object_id ?? operation.objectId ?? operation.guid;
  const rawName = operation.name ?? operation.target ?? operation.object;
  const reference = {};
  if (rawId !== undefined) reference.id = nonEmptyString(rawId, `${opName}.target_id`);
  if (rawName !== undefined) reference.name = nonEmptyString(rawName, `${opName}.name`);
  if (!reference.id && !reference.name) throw new Error(`${opName} requires target_id or name`);
  return reference;
}

export function matchesObjectReference(item, reference) {
  const idMatches = !reference.id || item.id === reference.id || item.guid === reference.id || item.persistent_id === reference.id;
  const nameMatches = !reference.name || item.name === reference.name;
  return idMatches && nameMatches;
}

export function referenceLabel(reference) {
  return [
    reference.id ? `id:${reference.id}` : null,
    reference.name ? `name:${reference.name}` : null
  ].filter(Boolean).join(' ');
}

export function findModelObject(model, reference, required = true) {
  const groupIndex = model.groups.findIndex((group) => matchesObjectReference(group, reference));
  if (groupIndex >= 0) return { collection: 'groups', index: groupIndex, item: model.groups[groupIndex] };
  const instanceIndex = (model.instances || []).findIndex((instance) => matchesObjectReference(instance, reference));
  if (instanceIndex >= 0) return { collection: 'instances', index: instanceIndex, item: model.instances[instanceIndex] };
  if (required) throw new Error(`object not found: ${referenceLabel(reference)}`);
  return null;
}

export function identityMatrix3() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

export function rotationZMatrix(angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

export function boxVertices([x, y, z], [w, d, h]) {
  return [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
    [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]
  ];
}
