import { assertObjectIdentityAvailable, boxVertices, findModelObject, matchesObjectReference, objectId, referenceLabel, resolveObjectReference } from './object-identity.mjs';
import { normalizeBoolean } from './operation-utils.mjs';
import { nonEmptyString } from './object-operation-utils.mjs';
import { mergeBoundingBoxes } from './snapshot.mjs';

const EPSILON = 1e-9;

export function booleanUnion(model, operation) {
  applySolidBoolean(model, operation, 'boolean_union');
}

export function booleanDifference(model, operation) {
  applySolidBoolean(model, operation, 'boolean_difference');
}

export function booleanIntersect(model, operation) {
  applySolidBoolean(model, operation, 'boolean_intersect');
}

export function manifoldCheck(model, operation) {
  const targets = manifoldTargets(model, operation, 'manifold_check');
  const reports = targets.map(({ item }) => manifoldReport(item));
  const check = {
    id: String(operation.check_id ?? operation.checkId ?? `manifold_check_${(model.manifold_checks || []).length + 1}`),
    op: 'manifold_check',
    ok: reports.every((report) => report.is_manifold),
    targets: reports
  };
  model.manifold_checks ||= [];
  model.manifold_checks.push(check);
  for (const { item } of targets) item.manifold = reports.find((report) => report.id === (item.id || item.name));
  if (!check.ok && normalizeBoolean(operation.fail_on_non_manifold ?? operation.failOnNonManifold ?? false, 'manifold_check.fail_on_non_manifold')) {
    throw new Error(`manifold_check failed: ${check.targets.filter((report) => !report.is_manifold).map((report) => report.name).join(', ')}`);
  }
}

export function manifoldRepair(model, operation) {
  const target = repairGroupTarget(model, operation);
  const strategy = String(operation.strategy ?? 'cleanup').trim().toLowerCase().replaceAll('-', '_');
  if (!['cleanup', 'seal_bbox'].includes(strategy)) throw new Error('manifold_repair.strategy must be cleanup or seal_bbox');
  const before = manifoldReport(target.item);
  if (!before.is_manifold && strategy === 'seal_bbox') {
    sealAsBoundingBox(target.item);
  }
  const after = {
    ...manifoldReport(target.item),
    repaired: true,
    repair_strategy: strategy
  };
  target.item.manifold = after;
  model.manifold_checks ||= [];
  model.manifold_checks.push({
    id: String(operation.repair_id ?? operation.repairId ?? `manifold_repair_${model.manifold_checks.length + 1}`),
    op: 'manifold_repair',
    ok: after.is_manifold,
    before,
    after
  });
  if (!after.is_manifold && normalizeBoolean(operation.fail_on_non_manifold ?? operation.failOnNonManifold ?? false, 'manifold_repair.fail_on_non_manifold')) {
    throw new Error(`manifold_repair failed: ${target.item.name} is still non-manifold`);
  }
}

function repairGroupTarget(model, operation) {
  const target = findModelObject(model, resolveObjectReference(operation, 'manifold_repair'));
  if (target.collection !== 'groups' || target.entity_type && target.entity_type !== 'group') {
    throw new Error('manifold_repair requires a group target');
  }
  const box = target.item.bounding_box;
  if (!box || [box.w, box.d, box.h].some((value) => !Number.isFinite(value) || value <= EPSILON)) {
    throw new Error('manifold_repair.target must have a positive-volume bounding box');
  }
  if (target.item.locked === true) throw new Error('manifold_repair target is locked');
  return target;
}

function applySolidBoolean(model, operation, opName) {
  const target = solidGroupTarget(model, operation, opName);
  const tools = booleanToolTargets(model, operation, opName);
  const resultCollection = booleanCollection(model, target);
  for (const [index, tool] of tools.entries()) {
    if (booleanCollection(model, tool) !== resultCollection) {
      throw new Error(`${opName}.tools[${index}] must share the target Entities scope`);
    }
  }
  validateDistinctInputs(target, tools, opName);
  const keepTools = normalizeBoolean(operation.keep_tools ?? operation.keepTools ?? false, `${opName}.keep_tools`);
  const keepOriginals = normalizeBoolean(operation.keep_originals ?? operation.keepOriginals ?? false, `${opName}.keep_originals`);
  const resultName = nonEmptyString(operation.result_name ?? operation.resultName ?? operation.name ?? target.item.name, `${opName}.result_name`);
  const resultId = objectId({ id: operation.result_id ?? operation.resultId }, resultName);
  const resultBox = booleanResultBox(target.item, tools.map((tool) => tool.item), operation, opName);
  const result = booleanResultObject({
    target: target.item,
    tools: tools.map((tool) => tool.item),
    operation,
    opName,
    resultName,
    resultId,
    resultBox
  });

  const mutatesTarget = !keepOriginals && resultName === target.item.name && resultId === (target.item.id || target.item.name);
  if (mutatesTarget) {
    Object.assign(target.item, result);
    if (!keepTools) removeGroups(model, tools);
    return;
  }

  assertResultIdentityAvailable(model, resultCollection, { id: resultId, name: resultName }, keepOriginals ? [] : [target, ...tools]);
  removeGroups(model, [
    ...(!keepOriginals ? [target] : []),
    ...(!keepTools ? tools : [])
  ]);
  resultCollection.push(result);
}

function booleanResultObject({ target, tools, operation, opName, resultName, resultId, resultBox }) {
  const toolFaces = tools.reduce((sum, tool) => sum + tool.faces, 0);
  const toolEdges = tools.reduce((sum, tool) => sum + tool.edges, 0);
  const relation = tools.map((tool) => ({
    id: tool.id || tool.name,
    name: tool.name,
    relation: boxRelation(target.bounding_box, tool.bounding_box)
  }));
  const current = {
    op: opName,
    id: String(operation.boolean_id ?? operation.booleanId ?? `${resultName}_${opName}`),
    target_id: target.id || target.name,
    target_name: target.name,
    tool_ids: tools.map((tool) => tool.id || tool.name),
    tool_names: tools.map((tool) => tool.name),
    method: 'solid_boolean',
    relation
  };
  const history = [
    ...(target.boolean_operations || []),
    ...tools.flatMap((tool) => tool.boolean_operations || []),
    current
  ];
  const faces = booleanFaceCount(target, tools, opName);
  const edges = booleanEdgeCount(target, tools, opName);
  const result = {
    id: resultId,
    name: resultName,
    kind: 'solid_boolean',
    faces,
    edges,
    material: operation.material ?? target.material ?? null,
    bounding_box: resultBox,
    features: [],
    boolean_operations: history,
    manifold: {
      is_manifold: true,
      method: 'mock_boolean_topology',
      checked: true,
      issues: []
    },
    qa: target.qa || null
  };
  result._vertices = boxVertices(resultBox.min, [resultBox.w, resultBox.d, resultBox.h]);
  return result;
}

function booleanResultBox(target, tools, operation, opName) {
  if (opName === 'boolean_union') {
    const allowDisjoint = normalizeBoolean(operation.allow_disjoint ?? operation.allowDisjoint ?? false, 'boolean_union.allow_disjoint');
    const disjoint = tools.filter((tool) => boxRelation(target.bounding_box, tool.bounding_box) === 'disjoint');
    if (disjoint.length > 0 && !allowDisjoint) {
      throw new Error(`boolean_union requires intersecting or touching solids; disjoint tools: ${disjoint.map((tool) => tool.name).join(', ')}`);
    }
    return mergeBoundingBoxes([target.bounding_box, ...tools.map((tool) => tool.bounding_box)]);
  }
  if (opName === 'boolean_difference') {
    const allowNonIntersecting = normalizeBoolean(operation.allow_non_intersecting ?? operation.allowNonIntersecting ?? false, 'boolean_difference.allow_non_intersecting');
    const intersecting = tools.filter((tool) => boxRelation(target.bounding_box, tool.bounding_box) !== 'disjoint');
    if (intersecting.length === 0 && !allowNonIntersecting) {
      throw new Error('boolean_difference requires at least one intersecting tool solid');
    }
    return structuredClone(target.bounding_box);
  }
  const box = tools.reduce((current, tool) => intersectionBox(current, tool.bounding_box), target.bounding_box);
  if (!box || [box.w, box.d, box.h].some((value) => value <= EPSILON)) {
    throw new Error('boolean_intersect requires a positive-volume intersection');
  }
  return box;
}

function booleanFaceCount(target, tools, opName) {
  const toolFaces = tools.reduce((sum, tool) => sum + tool.faces, 0);
  if (opName === 'boolean_union') return Math.max(6, target.faces + toolFaces - tools.length * 2);
  if (opName === 'boolean_difference') return Math.max(6, target.faces + toolFaces);
  return Math.max(6, Math.min(target.faces, toolFaces || target.faces) + 2);
}

function booleanEdgeCount(target, tools, opName) {
  const toolEdges = tools.reduce((sum, tool) => sum + tool.edges, 0);
  if (opName === 'boolean_union') return Math.max(12, target.edges + toolEdges - tools.length * 4);
  if (opName === 'boolean_difference') return Math.max(12, target.edges + toolEdges);
  return Math.max(12, Math.min(target.edges, toolEdges || target.edges) + 4);
}

function solidGroupTarget(model, operation, opName) {
  const target = findModelObject(model, resolveObjectReference(operation, opName));
  if (target.collection !== 'groups' || target.entity_type && target.entity_type !== 'group') {
    throw new Error(`${opName} requires a group target`);
  }
  validateSolidCandidate(target.item, `${opName}.target`);
  return target;
}

function booleanToolTargets(model, operation, opName) {
  const raw = operation.tools ?? operation.tool_ids ?? operation.toolIds ?? operation.tool_id ?? operation.toolId;
  const values = Array.isArray(raw) ? raw : (raw === undefined ? [] : [raw]);
  if (values.length === 0) throw new Error(`${opName} requires tools, tool_ids, or tool_id`);
  return values.map((value, index) => {
    const target = findToolObject(model, value, `${opName}.tools[${index}]`, opName);
    if (target.collection !== 'groups' || target.entity_type && target.entity_type !== 'group') {
      throw new Error(`${opName}.tools[${index}] must resolve to a group`);
    }
    validateSolidCandidate(target.item, `${opName}.tools[${index}]`);
    return target;
  });
}

function findToolObject(model, value, fieldName, opName = fieldName) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return findModelObject(model, resolveObjectReference(value, opName));
  }
  const key = nonEmptyString(String(value), fieldName);
  const groupIndex = model.groups.findIndex((group) => group.id === key || group.name === key);
  if (groupIndex >= 0) return { collection: 'groups', index: groupIndex, item: model.groups[groupIndex] };
  const instanceIndex = (model.instances || []).findIndex((instance) => instance.id === key || instance.name === key);
  if (instanceIndex >= 0) return { collection: 'instances', index: instanceIndex, item: model.instances[instanceIndex] };
  throw new Error(`object not found: ${fieldName} ${key}`);
}

function validateSolidCandidate(item, label) {
  const report = manifoldReport(item);
  if (!report.is_manifold) throw new Error(`${label} must be a positive-volume manifold solid: ${report.issues.join(', ')}`);
}

function validateDistinctInputs(target, tools, opName) {
  const ids = new Set([target.item.id || target.item.name]);
  for (const tool of tools) {
    const key = tool.item.id || tool.item.name;
    if (ids.has(key)) throw new Error(`${opName} target/tools must be distinct solids`);
    ids.add(key);
  }
}

function removeGroups(model, targets) {
  const byCollection = new Map();
  for (const target of targets.filter((item) => item.collection === 'groups')) {
    const collection = booleanCollection(model, target);
    const indexes = byCollection.get(collection) || [];
    indexes.push(target.index);
    byCollection.set(collection, indexes);
  }
  for (const [collection, indexes] of byCollection) {
    for (const index of [...new Set(indexes)].sort((a, b) => b - a)) collection.splice(index, 1);
  }
}

function assertResultIdentityAvailable(model, collection, reference, replacingTargets) {
  const replacing = new Set(replacingTargets.map((target) => target.item));
  const duplicate = collection.find((group) => !replacing.has(group) && matchesObjectReference(group, reference));
  if (duplicate) throw new Error(`boolean result identity already exists: ${referenceLabel(reference)}`);
  if (collection === model.groups && (reference.id || reference.name)) {
    assertObjectIdentityAvailable({ ...model, groups: model.groups.filter((group) => !replacing.has(group)) }, reference);
  }
}

function booleanCollection(model, target) {
  if (target.collection_ref) return target.collection_ref;
  if (target.definition && Array.isArray(target.definition[target.collection])) return target.definition[target.collection];
  if (Array.isArray(model[target.collection])) return model[target.collection];
  throw new Error('boolean target does not expose an editable collection');
}

function manifoldTargets(model, operation, opName) {
  const rawTargets = operation.targets ?? operation.target_ids ?? operation.targetIds;
  if (rawTargets !== undefined) {
    const values = Array.isArray(rawTargets) ? rawTargets : [rawTargets];
    return values.map((value, index) => findToolObject(model, value, `${opName}.targets[${index}]`, opName));
  }
  if (operation.entity_path !== undefined || operation.entityPath !== undefined || operation.target_path !== undefined || operation.targetPath !== undefined
    || operation.target_id !== undefined || operation.targetId !== undefined || operation.name !== undefined || operation.target !== undefined || operation.object !== undefined) {
    return [findModelObject(model, resolveObjectReference(operation, opName))];
  }
  return model.groups.map((item, index) => ({ collection: 'groups', index, item }));
}

function manifoldReport(item) {
  const issues = [];
  if (!item.bounding_box || [item.bounding_box.w, item.bounding_box.d, item.bounding_box.h].some((value) => value <= EPSILON)) issues.push('non_positive_volume');
  if (!Number.isFinite(item.faces) || item.faces <= 0) issues.push('no_faces');
  if (item.kind === 'image_plane' || item.kind === 'face_with_holes') issues.push('surface_not_solid');
  const meshStatus = meshManifoldStatus(item);
  if (meshStatus && !meshStatus.closed_edges) issues.push('open_or_nonmanifold_mesh_edges');
  return {
    id: item.id || item.name,
    name: item.name,
    kind: item.kind || 'group',
    is_manifold: issues.length === 0,
    method: meshStatus ? 'mock_mesh_edge_check' : 'mock_solid_heuristic',
    checked: true,
    checks: {
      positive_volume: !issues.includes('non_positive_volume'),
      has_faces: !issues.includes('no_faces'),
      closed_edges: meshStatus ? meshStatus.closed_edges : true
    },
    issues
  };
}

function meshManifoldStatus(item) {
  if (!Array.isArray(item.mesh_faces)) return null;
  const counts = new Map();
  for (const face of item.mesh_faces) {
    for (let index = 0; index < face.length; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % face.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const nonManifoldEdges = [...counts.values()].filter((count) => count !== 2).length;
  return {
    closed_edges: nonManifoldEdges === 0,
    non_manifold_edges: nonManifoldEdges
  };
}

function sealAsBoundingBox(item) {
  const box = item.bounding_box;
  item.kind = 'manifold_repair';
  item.faces = 6;
  item.edges = 12;
  delete item.vertices;
  delete item.mesh_faces;
  item._vertices = boxVertices(box.min, [box.w, box.d, box.h]);
}

function boxRelation(a, b) {
  const overlaps = [0, 1, 2].map((axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]));
  if (overlaps.every((value) => value > EPSILON)) return 'intersecting';
  if (overlaps.every((value) => value >= -EPSILON)) return 'touching';
  return 'disjoint';
}

function intersectionBox(a, b) {
  const min = [0, 1, 2].map((axis) => Math.max(a.min[axis], b.min[axis]));
  const max = [0, 1, 2].map((axis) => Math.min(a.max[axis], b.max[axis]));
  if (max.some((value, axis) => value < min[axis])) return null;
  return {
    min,
    max,
    w: max[0] - min[0],
    d: max[1] - min[1],
    h: max[2] - min[2]
  };
}
