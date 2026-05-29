import { assertObjectIdentityAvailable, objectId, objectIdentityFields } from './object-identity.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { applyTransform, integerInRange, normalizeQaMetadata, normalizeTransform, normalizeVector, positiveNumber } from './operation-utils.mjs';
import { boundingBoxForVertices, mergeBoundingBoxes } from './snapshot.mjs';

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
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
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
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'prism',
    faces: normalizedPoints.length + 2,
    edges: normalizedPoints.length * 3,
    material: materialName,
    plane,
    points: normalizedPoints,
    depth: extrusionDepth,
    bounding_box: bbox,
    qa: normalizeQaMetadata(operation.qa)
  });
}

export function prismVertices(origin, plane, points, depth) {
  const [x, y, z] = origin;
  const base = points.map(([u, v]) => {
    if (plane === 'xy') return [x + u, y + v, z];
    if (plane === 'xz') return [x + u, y, z + v];
    return [x, y + u, z + v];
  });
  const offset = plane === 'xy' ? [0, 0, depth] : plane === 'xz' ? [0, depth, 0] : [depth, 0, 0];
  return [...base, ...base.map((point) => point.map((value, index) => value + offset[index]))];
}

export function profilePlaneVertices(origin, plane, points) {
  const [x, y, z] = origin;
  return points.map(([u, v]) => {
    if (plane === 'xy') return [x + u, y + v, z];
    if (plane === 'xz') return [x + u, y, z + v];
    return [x, y + u, z + v];
  });
}

export function addCylinder(model, operation) {
  const { name, origin = [0, 0, 0], radius, height, segments = 16, material, smooth = 'all', transform, qa } = operation;
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
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'cylinder';
  model.groups[model.groups.length - 1].segments = n;
}
