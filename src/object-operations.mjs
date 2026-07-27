import { ensureMaterial } from './material-operations.mjs';
import { boxVertices, findModelObject, matchesObjectReference, referenceLabel, refreshNestedDefinition, resolveObjectReference } from './object-identity.mjs';
import {
  classificationAttributeSnapshot,
  colorHex,
  finiteNumber,
  nonEmptyString,
  normalizeAttributeUpdates,
  normalizeBoolean,
  normalizeClassification,
  normalizeTextureTransform,
  positiveNumber,
  textureTransformAttributeSnapshot
} from './object-operation-utils.mjs';
import { normalizeVector } from './operation-utils.mjs';
import { boundingBoxForVertices } from './snapshot.mjs';

export function deleteObject(model, operation) {
  const reference = resolveObjectReference(operation, 'delete');
  if (reference.entity_path && operation.confirmed !== true) throw new Error('delete.confirmed=true is required for nested entity deletion');
  const target = findModelObject(model, reference);
  assertUnlocked(target, 'delete');
  removeResolvedTarget(model, target);
}

export function renameObject(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'rename'));
  assertUnlocked(target, 'rename');
  const newName = nonEmptyString(operation.new_name ?? operation.newName, 'rename.new_name');
  const duplicate = target.nested
    ? (target.definition[target.collection] || []).some((item) => item !== target.item && item.name === newName)
    : Boolean(findModelObject(model, { name: newName }, false));
  if (duplicate) throw new Error(`rename target already exists: ${newName}`);
  target.item.name = newName;
  refreshNestedDefinition(model, target);
}

export function setObjectMaterial(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'set_material'));
  assertUnlocked(target, 'set_material');
  target.item.material = ensureMaterial(model, operation.material ?? operation.material_name ?? operation.materialName);
  refreshNestedDefinition(model, target);
}

export function setObjectVisibility(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'set_visibility'));
  assertUnlocked(target, 'set_visibility');
  const visible = normalizeBoolean(operation.visible ?? !operation.hidden, 'set_visibility.visible');
  target.item.hidden = !visible;
  target.item.visible = visible;
  refreshNestedDefinition(model, target);
}

export function addTag(model, operation) {
  const name = nonEmptyString(operation.name, 'tag.name');
  model.tags ||= {};
  const existing = model.tags[name] || {};
  model.tags[name] = {
    name,
    color: operation.color !== undefined ? colorHex(operation.color, 'tag.color') : existing.color || null,
    visible: normalizeBoolean(operation.visible ?? existing.visible ?? true, 'tag.visible')
  };
}

export function assignTag(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'assign_tag'));
  assertUnlocked(target, 'assign_tag');
  const tagName = nonEmptyString(operation.tag ?? operation.tag_name ?? operation.tagName, 'assign_tag.tag');
  model.tags ||= {};
  if (!model.tags[tagName]) model.tags[tagName] = { name: tagName, color: null, visible: true };
  target.item.tag = tagName;
}

export function setObjectAttribute(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'attribute'));
  assertUnlocked(target, 'attribute');
  const dictionary = nonEmptyString(operation.dictionary ?? operation.namespace ?? 'LocalMcpForSketchUp', 'attribute.dictionary');
  const updates = normalizeAttributeUpdates(operation, dictionary);
  target.item.attributes ||= {};
  target.item.attributes[dictionary] ||= {};
  Object.assign(target.item.attributes[dictionary], updates);
}

export function removeObjectAttribute(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'remove_attribute'));
  assertUnlocked(target, 'remove_attribute');
  const dictionary = nonEmptyString(operation.dictionary ?? operation.namespace ?? 'LocalMcpForSketchUp', 'remove_attribute.dictionary');
  const key = operation.key ?? operation.attr_key ?? operation.attrKey;
  if (!target.item.attributes?.[dictionary]) return;
  if (key === undefined) delete target.item.attributes[dictionary];
  else delete target.item.attributes[dictionary][nonEmptyString(key, 'remove_attribute.key')];
}

export function setFaceMaterial(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'set_face_material'));
  assertUnlocked(target, 'set_face_material');
  if (target.entity_type !== 'face') throw new Error('set_face_material target must be a Face');
  const material = ensureMaterial(model, operation.material ?? operation.material_name ?? operation.materialName);
  const side = String(operation.side || 'front');
  if (!['front', 'back', 'both'].includes(side)) throw new Error('set_face_material.side must be front, back, or both');
  if (side === 'front' || side === 'both') target.item.material = material;
  if (side === 'back' || side === 'both') target.item.back_material = material;
}

export function setEdgeProperties(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'set_edge_properties'));
  assertUnlocked(target, 'set_edge_properties');
  if (target.entity_type !== 'edge') throw new Error('set_edge_properties target must be an Edge');
  if (operation.soft !== undefined) target.item.soft = normalizeBoolean(operation.soft, 'set_edge_properties.soft');
  if (operation.smooth !== undefined) target.item.smooth = normalizeBoolean(operation.smooth, 'set_edge_properties.smooth');
  if (operation.visible !== undefined || operation.hidden !== undefined) {
    const visible = normalizeBoolean(operation.visible ?? !operation.hidden, 'set_edge_properties.visible');
    target.item.visible = visible;
    target.item.hidden = !visible;
  }
}

export function reverseFace(model, operation) {
  assertConfirmed(operation, 'reverse_face');
  const target = findModelObject(model, resolveObjectReference(operation, 'reverse_face'));
  assertUnlocked(target, 'reverse_face');
  if (target.entity_type !== 'face') throw new Error('reverse_face target must be a Face');
  [target.item.material, target.item.back_material] = [target.item.back_material || null, target.item.material || null];
  target.item.reversed = !target.item.reversed;
  if (Array.isArray(target.item.normal)) target.item.normal = target.item.normal.map((value) => -value);
}

export function pushpullFace(model, operation) {
  assertConfirmed(operation, 'pushpull_face');
  const target = findModelObject(model, resolveObjectReference(operation, 'pushpull_face'));
  assertUnlocked(target, 'pushpull_face');
  if (target.entity_type !== 'face') throw new Error('pushpull_face target must be a Face');
  const distance = finiteNumber(operation.distance, undefined, 'pushpull_face.distance');
  if (Math.abs(distance) <= 1e-9) throw new Error('pushpull_face.distance must be non-zero');
  const group = target.parent_group;
  if (!group) throw new Error('mock pushpull_face requires a Face contained by a group');
  group.topology_edits ||= [];
  group.topology_edits.push({ op: 'pushpull_face', face: target.item.persistent_id, distance, copy: operation.copy === true });
  group.faces = Math.max(1, Number(group.faces || 1) + (operation.copy === true ? 1 : 0) + 4);
  group.edges = Math.max(3, Number(group.edges || 0) + 8);
  const normal = target.item.normal || [0, 0, 1];
  const box = group.bounding_box;
  if (box) {
    const moved = normal.map((axis) => axis * distance);
    const points = [box.min, box.max, box.min.map((value, axis) => value + moved[axis]), box.max.map((value, axis) => value + moved[axis])];
    group.bounding_box = boundingBoxForVertices(points);
  }
  target.item.pushpull_distance = (target.item.pushpull_distance || 0) + distance;
}

export function setObjectClassification(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'classification'));
  assertUnlocked(target, 'classification');
  const classification = normalizeClassification(operation);
  target.item.classification = classification;
  target.item.attributes ||= {};
  target.item.attributes.Classification = classificationAttributeSnapshot(classification);
}

export function setObjectTextureTransform(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'texture_transform'));
  assertUnlocked(target, 'texture_transform');
  const textureTransform = normalizeTextureTransform(operation, 'texture_transform');
  target.item.texture_transform = textureTransform;
  target.item.attributes ||= {};
  target.item.attributes.TextureTransform = textureTransformAttributeSnapshot(textureTransform);
}

export function duplicateEntity(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'duplicate_entity'));
  assertUnlocked(target, 'duplicate_entity');
  const entityType = target.entity_type || target.item.entity_type || (target.collection === 'instances' ? 'component_instance' : 'group');
  if (!['group', 'component_instance'].includes(entityType)) throw new Error('duplicate_entity target must be a Group or ComponentInstance');
  const collection = resolvedCollection(model, target);
  const clone = structuredClone(target.item);
  clone.id = nonEmptyString(operation.new_id ?? operation.newId, 'duplicate_entity.new_id');
  clone.name = nonEmptyString(operation.new_name ?? operation.newName, 'duplicate_entity.new_name');
  if (collection.some((item) => item.id === clone.id || item.name === clone.name)) throw new Error('duplicate_entity new_id and new_name must be unique in the target scope');
  const translate = normalizeVector(operation.translate ?? [0, 0, 0], [0, 0, 0], 'duplicate_entity.translate');
  if (clone.bounding_box) {
    clone.bounding_box = boundingBoxForVertices([clone.bounding_box.min, clone.bounding_box.max].map((point) => point.map((value, axis) => value + translate[axis])));
  }
  if (clone._vertices) clone._vertices = clone._vertices.map((point) => point.map((value, axis) => value + translate[axis]));
  clone.duplicated_from = target.item.id || target.item.persistent_id || target.item.name;
  collection.push(clone);
  return clone;
}

export function replaceComponentDefinition(model, operation) {
  assertConfirmed(operation, 'replace_component_definition');
  const target = findModelObject(model, resolveObjectReference(operation, 'replace_component_definition'));
  assertUnlocked(target, 'replace_component_definition');
  const entityType = target.entity_type || target.item.entity_type || (target.collection === 'instances' ? 'component_instance' : null);
  if (entityType !== 'component_instance') throw new Error('replace_component_definition target must be a ComponentInstance');
  const definitionName = nonEmptyString(operation.definition ?? operation.new_definition ?? operation.newDefinition, 'replace_component_definition.definition');
  const definition = model.component_definitions?.[definitionName];
  if (!definition) throw new Error(`replace_component_definition definition not found: ${definitionName}`);
  target.item.definition = definitionName;
  target.item.faces = definition.faces;
  target.item.edges = definition.edges;
  target.item.material = definition.material;
  const translate = target.item.transform?.translate || target.item.bounding_box?.min || [0, 0, 0];
  if (definition.bounding_box) {
    target.item.bounding_box = boundingBoxForVertices([definition.bounding_box.min, definition.bounding_box.max].map((point) => point.map((value, axis) => value + Number(translate[axis] || 0))));
  }
}

export function explodeEntity(model, operation) {
  assertConfirmed(operation, 'explode_entity');
  const target = findModelObject(model, resolveObjectReference(operation, 'explode_entity'));
  assertUnlocked(target, 'explode_entity');
  const collection = resolvedCollection(model, target);
  const inserted = [];
  if (target.item.definition && model.component_definitions?.[target.item.definition]) {
    const definition = model.component_definitions[target.item.definition];
    for (const child of [...(definition.groups || []), ...(definition.instances || [])]) {
      const clone = structuredClone(child);
      clone.id = `${target.item.id || target.item.name}__${clone.id || clone.name}`;
      clone.name = `${target.item.name || 'Exploded'}__${clone.name || clone.id}`;
      clone.exploded_from = target.item.id || target.item.name;
      collection.push(clone);
      inserted.push(clone.id);
    }
  }
  const source = target.item.id || target.item.name;
  removeResolvedTarget(model, target);
  model.exploded_entities ||= [];
  model.exploded_entities.push({ source, inserted });
  return inserted;
}

export function eraseEntities(model, operation) {
  assertConfirmed(operation, 'erase_entities');
  const targets = normalizeTargetList(operation.targets ?? operation.entity_paths ?? operation.entityPaths, 'erase_entities.targets');
  if (operation.max_affected !== undefined && targets.length > Number(operation.max_affected)) throw new Error('erase_entities exceeds max_affected');
  const resolved = targets.map((target) => findModelObject(model, resolveObjectReference(withCollectionPolicy(target, operation), 'erase_entities')));
  for (const target of resolved) assertUnlocked(target, 'erase_entities');
  for (const target of resolved.reverse()) removeResolvedTarget(model, target);
}

export function transformEntities(model, operation) {
  assertConfirmed(operation, 'transform_entities');
  const targets = normalizeTargetList(operation.targets ?? operation.entity_paths ?? operation.entityPaths, 'transform_entities.targets');
  const translate = normalizeVector(operation.translate ?? operation.translation, [0, 0, 0], 'transform_entities.translate');
  if (operation.max_affected !== undefined && targets.length > Number(operation.max_affected)) throw new Error('transform_entities exceeds max_affected');
  for (const reference of targets) {
    const merged = withCollectionPolicy(reference, operation);
    const target = findModelObject(model, resolveObjectReference(merged, 'transform_entities'));
    assertUnlocked(target, 'transform_entities');
    if (['group', 'component_instance'].includes(target.entity_type || target.item.entity_type)) {
      transformObject(model, { ...merged, op: 'transform_object', translate });
    } else {
      target.item.transform = { translate };
      if (target.parent_group?.bounding_box) {
        const box = target.parent_group.bounding_box;
        const moved = [box.min, box.max].map((point) => point.map((value, axis) => value + translate[axis]));
        target.parent_group.bounding_box = boundingBoxForVertices([box.min, box.max, ...moved]);
        target.parent_group.topology_edits ||= [];
        target.parent_group.topology_edits.push({ op: 'transform_entities', entity: target.item.persistent_id, translate });
      }
    }
  }
}

export function transformObject(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'transform_object'));
  assertUnlocked(target, 'transform_object');
  const object = target.item;
  const transform = normalizeObjectTransform(operation, object);
  const vertices = object._vertices || boxVertices(object.bounding_box.min, [object.bounding_box.w, object.bounding_box.d, object.bounding_box.h]);
  object._vertices = applyObjectTransform(vertices, transform);
  object.bounding_box = boundingBoxForVertices(object._vertices);
  object._orientation = applyOrientationTransform(object._orientation || identityMatrix3(), transform);
  object.transform = mergeObjectTransform(object.transform, transform);
  refreshNestedDefinition(model, target);
}

function assertConfirmed(operation, opName) {
  if (operation.confirmed !== true) throw new Error(`${opName}.confirmed=true is required`);
}

function assertUnlocked(target, opName) {
  if (target?.item?.locked === true) throw new Error(`${opName} target is locked`);
  if (target?.parent_group?.locked === true) throw new Error(`${opName} target is inside a locked entity`);
}

function normalizeTargetList(value, fieldName) {
  if (!Array.isArray(value) || !value.length) throw new Error(`${fieldName} must be a non-empty array`);
  return value.map((item) => typeof item === 'string' ? { entity_path: item } : item);
}

function withCollectionPolicy(reference, operation) {
  return {
    ...reference,
    edit_scope: reference.edit_scope || operation.edit_scope,
    instance_policy: reference.instance_policy || operation.instance_policy,
    instance_id: reference.instance_id || operation.instance_id
  };
}

function resolvedCollection(model, target) {
  if (target.collection_ref) return target.collection_ref;
  if (target.definition && target.collection) return target.definition[target.collection] || [];
  if (target.collection === 'groups') return model.groups;
  if (target.collection === 'instances') return model.instances;
  throw new Error('resolved target does not expose an editable collection');
}

function removeResolvedTarget(model, target) {
  const collection = resolvedCollection(model, target);
  const index = collection.indexOf(target.item);
  if (index < 0) throw new Error(`delete target not found: ${target.item.id || target.item.name || target.item.persistent_id}`);
  collection.splice(index, 1);
  if (target.parent_group) {
    if (target.entity_type === 'face') target.parent_group.faces = Math.max(0, Number(target.parent_group.faces || 0) - 1);
    if (target.entity_type === 'edge') target.parent_group.edges = Math.max(0, Number(target.parent_group.edges || 0) - 1);
  }
  refreshNestedDefinition(model, target);
}

function normalizeObjectTransform(operation, object) {
  const transform = operation.transform || operation;
  const name = object.name;
  const orientation = object._orientation || identityMatrix3();
  const translate = transform.translate ?? transform.translation ?? [0, 0, 0];
  const rotate = transform.rotate ?? transform.rotation ?? {};
  const axisRotation = normalizeAxisRotation(transform, rotate, name);
  const localRotation = normalizeLocalRotation(transform, rotate, orientation, name);
  const matrix = normalizeObjectMatrix(transform, name);
  const localMatrix = normalizeObjectLocalMatrix(transform, name);
  const matrixDecomposition = decomposeTransformMatrix4(matrix);
  const localMatrixDecomposition = decomposeTransformMatrix4(localMatrix);
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
    axis: axisRotation.axis,
    angle: axisRotation.angle,
    local_axis: localRotation.local_axis,
    local_angle: localRotation.local_angle,
    local_model_axis: localRotation.local_model_axis,
    matrix,
    matrix_decomposition: matrixDecomposition,
    local_matrix: localMatrix,
    local_matrix_decomposition: localMatrixDecomposition,
    orientation,
    scale,
    mirror: mirrorAxes.filter(Boolean),
    pivot: normalizeTransformPivot(pivotRaw, object.bounding_box, `${name}.pivot`)
  };
}

function normalizeObjectMatrix(transform, name) {
  const raw = transform.matrix ?? transform.matrix4x4;
  if (raw === undefined) return null;
  return normalizeTransformMatrixValues(raw, name, 'matrix');
}

function normalizeObjectLocalMatrix(transform, name) {
  const raw = transform.local_matrix ?? transform.localMatrix ?? transform.matrix_local ?? transform.matrixLocal;
  if (raw === undefined) return null;
  return normalizeTransformMatrixValues(raw, name, 'local_matrix');
}

function normalizeTransformMatrixValues(raw, name, fieldName) {
  const values = Array.isArray(raw) && raw.length === 4 && raw.every((row) => Array.isArray(row) && row.length === 4)
    ? raw.flat()
    : raw;
  if (!Array.isArray(values) || values.length !== 16) throw new Error(`${name}.${fieldName} must be a 16-number SketchUp-compatible transform array`);
  return values.map((value, index) => finiteNumber(value, undefined, `${name}.${fieldName}[${index}]`));
}

function normalizeLocalRotation(transform, rotate, orientation, name) {
  const raw = transform.rotate_local ?? transform.rotateLocal ?? transform.local_rotation ?? transform.localRotation ?? rotate.local ?? {};
  const rawAxis = raw.axis ?? transform.local_axis ?? transform.localAxis ?? rotate.local_axis ?? rotate.localAxis;
  const rawAngle = raw.angle ?? transform.local_angle ?? transform.localAngle ?? rotate.local_angle ?? rotate.localAngle;
  if (rawAxis === undefined && rawAngle === undefined) return { local_axis: null, local_angle: 0, local_model_axis: null };
  if (rawAxis === undefined || rawAngle === undefined) throw new Error(`${name}.local_axis and ${name}.local_angle must be provided together`);
  const localAxis = normalizeLocalAxis(rawAxis, name);
  return {
    local_axis: localAxis,
    local_angle: finiteNumber(rawAngle, 0, `${name}.local_angle`),
    local_model_axis: normalizeModelAxisFromLocal(localAxis, orientation)
  };
}

function normalizeLocalAxis(rawAxis, name) {
  if (typeof rawAxis === 'string') {
    const axis = rawAxis.toLowerCase();
    if (axis === 'x') return [1, 0, 0];
    if (axis === 'y') return [0, 1, 0];
    if (axis === 'z') return [0, 0, 1];
    throw new Error(`${name}.local_axis must be x, y, z, or a [x,y,z] vector`);
  }
  const axis = normalizeVector(rawAxis, [0, 0, 1], `${name}.local_axis`);
  const length = Math.hypot(...axis);
  if (length <= 1e-9) throw new Error(`${name}.local_axis must be non-zero`);
  return axis.map((value) => value / length);
}

function normalizeModelAxisFromLocal(localAxis, orientation) {
  const axis = applyMatrix3(localAxis, orientation);
  const length = Math.hypot(...axis);
  if (length <= 1e-9) return localAxis;
  return axis.map((value) => value / length);
}

function normalizeAxisRotation(transform, rotate, name) {
  const rawAxisRotation = transform.rotate_axis ?? transform.rotateAxis ?? transform.axis_rotation ?? transform.axisRotation ?? rotate.axis_rotation ?? rotate.axisRotation;
  const rawAxis = rawAxisRotation?.axis ?? transform.axis ?? rotate.axis;
  const rawAngle = rawAxisRotation?.angle ?? transform.angle ?? rotate.angle;
  if (rawAxis === undefined && rawAngle === undefined) return { axis: null, angle: 0 };
  if (rawAxis === undefined || rawAngle === undefined) throw new Error(`${name}.axis and ${name}.angle must be provided together`);
  const axis = normalizeVector(rawAxis, [0, 0, 1], `${name}.axis`);
  const length = Math.hypot(...axis);
  if (length <= 1e-9) throw new Error(`${name}.axis must be non-zero`);
  return {
    axis: axis.map((value) => value / length),
    angle: finiteNumber(rawAngle, 0, `${name}.angle`)
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
  const arbitrary = axisRotationMatrix(transform.axis, transform.angle);
  const local = axisRotationMatrix(transform.local_model_axis, transform.local_angle);
  const [px, py, pz] = transform.pivot;
  return vertices.map(([x0, y0, z0]) => {
    let x = (x0 - px) * sx;
    let y = (y0 - py) * sy;
    let z = (z0 - pz) * sz;
    [y, z] = [y * cx - z * sxn, y * sxn + z * cx];
    [x, z] = [x * cy + z * syn, -x * syn + z * cy];
    [x, y] = [x * cz - y * szn, x * szn + y * cz];
    [x, y, z] = applyMatrix3([x, y, z], arbitrary);
    [x, y, z] = applyMatrix3([x, y, z], local);
    [x, y, z] = applyLocalTransformMatrix4([x, y, z], transform.local_matrix, transform.orientation);
    return applyTransformMatrix4([
      x + px + transform.translate[0],
      y + py + transform.translate[1],
      z + pz + transform.translate[2]
    ], transform.matrix, 'transform_object.matrix');
  });
}

function applyOrientationTransform(orientation, transform) {
  let next = orientation;
  next = multiplyMatrix3(rotationXMatrix(transform.rotateX), next);
  next = multiplyMatrix3(rotationYMatrix(transform.rotateY), next);
  next = multiplyMatrix3(rotationZMatrix(transform.rotateZ), next);
  next = multiplyMatrix3(axisRotationMatrix(transform.axis, transform.angle), next);
  next = multiplyMatrix3(axisRotationMatrix(transform.local_model_axis, transform.local_angle), next);
  next = multiplyMatrix3(next, linearMatrix3FromTransformMatrix4(transform.local_matrix));
  next = multiplyMatrix3(linearMatrix3FromTransformMatrix4(transform.matrix), next);
  return next;
}

function identityMatrix3() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function rotationXMatrix(angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

function rotationYMatrix(angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

function rotationZMatrix(angleDegrees) {
  const radians = (angleDegrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}

function axisRotationMatrix(axis, angleDegrees) {
  if (!axis) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [x, y, z] = axis;
  const radians = (angleDegrees * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c]
  ];
}

function applyMatrix3([x, y, z], matrix) {
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
    matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z
  ];
}

function applyTransformMatrix4([x, y, z], matrix, label = 'transform_object.matrix') {
  if (!matrix) return [x, y, z];
  const w = x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15];
  const nx = x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12];
  const ny = x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13];
  const nz = x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14];
  if (Math.abs(w) <= 1e-9) throw new Error(`${label} produced a point with zero homogeneous w`);
  return [nx / w, ny / w, nz / w];
}

function applyLocalTransformMatrix4(relativePoint, matrix, orientation) {
  if (!matrix) return relativePoint;
  const inverse = invertMatrix3(orientation);
  const localPoint = applyMatrix3(relativePoint, inverse);
  const transformedLocalPoint = applyTransformMatrix4(localPoint, matrix, 'transform_object.local_matrix');
  return applyMatrix3(transformedLocalPoint, orientation);
}

function linearMatrix3FromTransformMatrix4(matrix) {
  if (!matrix) return identityMatrix3();
  return [
    [matrix[0], matrix[4], matrix[8]],
    [matrix[1], matrix[5], matrix[9]],
    [matrix[2], matrix[6], matrix[10]]
  ];
}

function decomposeTransformMatrix4(matrix) {
  if (!matrix) return null;
  const xColumn = [matrix[0], matrix[1], matrix[2]];
  const yColumn = [matrix[4], matrix[5], matrix[6]];
  const zColumn = [matrix[8], matrix[9], matrix[10]];
  const determinant = dotVector(xColumn, crossVector(yColumn, zColumn));
  const xAxis = normalizeMatrixAxis(xColumn);
  const yAxis = normalizeMatrixAxis(yColumn);
  const zAxis = normalizeMatrixAxis(zColumn);
  const shear = {
    xy: dotVector(xAxis, yAxis),
    xz: dotVector(xAxis, zAxis),
    yz: dotVector(yAxis, zAxis)
  };
  const nonAffineReasons = transformMatrixNonAffineReasons(matrix);
  const rotationCompatible = nonAffineReasons.length === 0
    && Math.abs(determinant) > 1e-12
    && Math.abs(shear.xy) <= 1e-6
    && Math.abs(shear.xz) <= 1e-6
    && Math.abs(shear.yz) <= 1e-6
    && determinant > 0;
  return {
    translate: [matrix[12], matrix[13], matrix[14]],
    scale: [vectorLength(xColumn), vectorLength(yColumn), vectorLength(zColumn)],
    x_axis: xAxis,
    y_axis: yAxis,
    z_axis: zAxis,
    shear,
    determinant,
    mirrored: determinant < 0,
    affine: nonAffineReasons.length === 0,
    non_affine_reasons: nonAffineReasons,
    homogeneous: {
      perspective: [matrix[3], matrix[7], matrix[11]],
      w: matrix[15]
    },
    rotation_euler_order: rotationCompatible ? 'XYZ' : null,
    rotation_euler_degrees: rotationCompatible ? eulerXyzDegreesFromAxes(xAxis, yAxis, zAxis) : null
  };
}

function transformMatrixNonAffineReasons(matrix) {
  const reasons = [];
  if (Math.abs(matrix[3]) > 1e-9 || Math.abs(matrix[7]) > 1e-9 || Math.abs(matrix[11]) > 1e-9) reasons.push('perspective_terms');
  if (Math.abs(matrix[15] - 1) > 1e-9) reasons.push('homogeneous_w_not_one');
  return reasons;
}

function eulerXyzDegreesFromAxes(xAxis, yAxis, zAxis) {
  const r = [
    [xAxis[0], yAxis[0], zAxis[0]],
    [xAxis[1], yAxis[1], zAxis[1]],
    [xAxis[2], yAxis[2], zAxis[2]]
  ];
  const sy = Math.max(-1, Math.min(1, r[0][2]));
  const y = Math.asin(sy);
  let x;
  let z;
  if (Math.abs(Math.cos(y)) > 1e-9) {
    x = Math.atan2(-r[1][2], r[2][2]);
    z = Math.atan2(-r[0][1], r[0][0]);
  } else {
    x = Math.atan2(r[2][1], r[1][1]);
    z = 0;
  }
  return [x, y, z].map((radians) => normalizeSmallNumber((radians * 180) / Math.PI));
}

function normalizeSmallNumber(value) {
  return Math.abs(value) <= 1e-9 ? 0 : value;
}

function normalizeMatrixAxis(axis) {
  const length = vectorLength(axis);
  if (length <= 1e-12) return [0, 0, 0];
  return axis.map((value) => value / length);
}

function vectorLength(axis) {
  return Math.hypot(axis[0], axis[1], axis[2]);
}

function dotVector(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVector(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function multiplyMatrix3(a, b) {
  return a.map((row) => b[0].map((_, columnIndex) => (
    row[0] * b[0][columnIndex] + row[1] * b[1][columnIndex] + row[2] * b[2][columnIndex]
  )));
}

function invertMatrix3(matrix) {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i]
  ] = matrix;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) <= 1e-12) throw new Error('transform_object.local_matrix requires an invertible object orientation');
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]
  ];
}

function mergeObjectTransform(existing = {}, transform) {
  const { orientation, ...publicTransform } = transform;
  return {
    ...(existing || {}),
    object_transform: publicTransform
  };
}
