import { assertObjectIdentityAvailable, objectId, objectIdentityFields } from './object-identity.mjs';
import { resolveCurveSegments } from './curve-resolution.mjs';
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

export function addGeometryInput(model, operation) {
  const { name, vertices, faces = [], edges = [], material, smooth = false, transform, qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('geometry_input operation requires a string name');
  const normalizedVertices = normalizeGeometryVertices(vertices, name);
  const normalizedFaces = normalizeGeometryFaces(faces, normalizedVertices.length, name);
  const normalizedEdges = normalizeGeometryEdges(edges, normalizedVertices.length, name);
  const materialName = ensureMaterial(model, material);
  const realized = realizeGeometryInputEffects(normalizedVertices, normalizedFaces, normalizedEdges);
  const displayVertices = realized.vertices || normalizedVertices;
  const transformedVertices = applyTransform(displayVertices, { transform }, name);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'geometry_input',
    faces: realized.faces,
    edges: realized.edges,
    material: materialName,
    vertices: displayVertices,
    geometry_input: {
      faces: normalizedFaces,
      edges: normalizedEdges,
      face_count: normalizedFaces.length,
      edge_count: countGeometryInputEdges(normalizedFaces, normalizedEdges),
      loop_count: normalizedFaces.reduce((sum, face) => sum + 1 + face.holes.length, 0),
      ...(realized.pushpulls.length ? { pushpull_realized: realized.pushpulls } : {}),
      ...(realized.followmes.length ? { followme_realized: realized.followmes } : {})
    },
    ...(realized.faceUvs.length ? { face_uvs: realized.faceUvs } : {}),
    transform: normalizeTransform({ transform }, name),
    smooth,
    bounding_box: boundingBoxForVertices(transformedVertices),
    qa: normalizeQaMetadata(qa)
  });
}

function realizeGeometryInputEffects(vertices, faces, explicitEdges) {
  const edgeCount = countGeometryInputEdges(faces, explicitEdges);
  let actualFaces = faces.length;
  let actualEdges = edgeCount;
  const displayVertices = vertices.map((vertex) => [...vertex]);
  const pushpulls = [];
  const followmes = [];
  const faceUvs = [];
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    if (face.position_material) {
      faceUvs.push({
        id: face.id || `face_${faceIndex}`,
        selector: face.id ? { type: 'named', value: face.id } : { type: 'index', value: faceIndex },
        projection: face.position_material.projection || 'position_material',
        material: face.position_material.material,
        uv: face.position_material.uv,
        mapping: face.position_material.mapping,
        front: face.position_material.front !== false
      });
    }
    const pushpull = face.pushpull;
    if (pushpull && pushpull.metadata_only === false) {
      const normal = face.normal || faceNormalFromVertices(face.outer.map((index) => vertices[index]));
      const loops = [face.outer, ...face.holes];
      const unique = [...new Set(loops.flat())];
      const offset = normal.map((axis) => axis * pushpull.distance);
      for (const index of unique) {
        const vertex = vertices[index];
        displayVertices.push([vertex[0] + offset[0], vertex[1] + offset[1], vertex[2] + offset[2]]);
      }
      const loopEdgeCount = loops.reduce((sum, loop) => sum + loop.length, 0);
      actualFaces += 1 + loopEdgeCount;
      actualEdges += loopEdgeCount * 2;
      pushpulls.push({
        face_index: faceIndex,
        face_id: face.id,
        distance: pushpull.distance,
        copy: Boolean(pushpull.copy),
        normal
      });
    }
    if (face.followme) {
      const realized = followmeMeshForFace(vertices, face);
      const startIndex = displayVertices.length;
      displayVertices.push(...realized.vertices);
      actualFaces += realized.faces.length;
      actualEdges += countMeshEdges(realized.faces);
      followmes.push({
        face_index: faceIndex,
        face_id: face.id,
        path: face.followme.path,
        faces: realized.faces.length,
        edges: countMeshEdges(realized.faces),
        vertex_offset: startIndex
      });
    }
  }
  return {
    vertices: pushpulls.length || followmes.length ? displayVertices : null,
    faces: actualFaces,
    edges: actualEdges,
    pushpulls,
    followmes,
    faceUvs
  };
}

function followmeMeshForFace(vertices, face) {
  const profile = face.outer.map((index) => vertices[index]);
  const path = face.followme.path;
  if (!Array.isArray(path) || path.length < 2) return { vertices: [], faces: [] };
  const origin = path[0];
  const sweptVertices = [];
  for (const pathPoint of path) {
    const offset = [pathPoint[0] - origin[0], pathPoint[1] - origin[1], pathPoint[2] - origin[2]];
    for (const point of profile) sweptVertices.push([point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]]);
  }
  const faces = [];
  const n = profile.length;
  faces.push([...Array(n).keys()]);
  for (let ring = 0; ring < path.length - 1; ring += 1) {
    const base = ring * n;
    const next = (ring + 1) * n;
    for (let index = 0; index < n; index += 1) {
      faces.push([base + index, base + ((index + 1) % n), next + ((index + 1) % n), next + index]);
    }
  }
  const last = (path.length - 1) * n;
  faces.push([...Array(n).keys()].map((index) => last + index).reverse());
  return { vertices: sweptVertices, faces };
}

function faceNormalFromVertices(points) {
  if (points.length < 3) return [0, 0, 1];
  const [a, b, c] = points;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  const length = Math.hypot(...cross);
  if (length <= 1e-12) return [0, 0, 1];
  return cross.map((value) => value / length);
}

export function addCurve(model, operation) {
  const { name, points, vertices, material, smooth = false, transform, qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('curve operation requires a string name');
  const curvePoints = normalizeGeometryVertices(points ?? vertices, name);
  if (curvePoints.length < 2) throw new Error(`${name}.points must contain at least 2 [x, y, z] points`);
  const materialName = ensureMaterial(model, material);
  const transformedVertices = applyTransform(curvePoints, { transform }, name);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: operation.kind || 'curve',
    faces: 0,
    edges: curvePoints.length - 1 + (operation.closed ? 1 : 0),
    material: materialName,
    vertices: curvePoints,
    curve: {
      points: curvePoints,
      closed: Boolean(operation.closed)
    },
    transform: normalizeTransform({ transform }, name),
    smooth,
    bounding_box: boundingBoxForVertices(transformedVertices),
    qa: normalizeQaMetadata(qa)
  });
}

export function addArcCurve(model, operation) {
  const { name, center = [0, 0, 0], radius, start_angle = 0, startAngle, end_angle = 90, endAngle, plane = 'xy', segments = 16 } = operation;
  if (!name || typeof name !== 'string') throw new Error('arc_curve operation requires a string name');
  const [cx, cy, cz] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const r = positiveNumber(radius, undefined, `${name}.radius`);
  const start = Number(startAngle ?? start_angle);
  const end = Number(endAngle ?? end_angle);
  const n = resolveCurveSegments(operation, r, { sweepDegrees: end - start, defaultSegments: 16, minSegments: 2, legacyMax: 128 });
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error(`${name}.start_angle/end_angle must be finite numbers`);
  if (!['xy', 'xz', 'yz'].includes(plane)) throw new Error(`${name}.plane must be one of xy, xz, yz`);
  const points = [];
  for (let index = 0; index <= n; index += 1) {
    const angle = ((start + ((end - start) * index) / n) * Math.PI) / 180;
    const u = Math.cos(angle) * r;
    const v = Math.sin(angle) * r;
    if (plane === 'xy') points.push([cx + u, cy + v, cz]);
    else if (plane === 'xz') points.push([cx + u, cy, cz + v]);
    else points.push([cx, cy + u, cz + v]);
  }
  addCurve(model, { ...objectIdentityFields(operation), ...operation, points, kind: 'arc_curve' });
  const group = model.groups[model.groups.length - 1];
  group.arc = { center: [cx, cy, cz], radius: r, start_angle: start, end_angle: end, plane, segments: n };
  group.segments = n;
}

function normalizeGeometryVertices(vertices, name) {
  if (!Array.isArray(vertices) || vertices.length < 1) throw new Error(`${name}.vertices must contain [x, y, z] points`);
  return vertices.map((vertex, index) => normalizeVector(vertex, [0, 0, 0], `${name}.vertices[${index}]`));
}

function normalizeGeometryFaces(faces, vertexCount, name) {
  if (!Array.isArray(faces)) throw new Error(`${name}.faces must be an array`);
  return faces.map((face, faceIndex) => {
    const rawOuter = Array.isArray(face) ? face : face?.outer ?? face?.loop ?? face?.vertices;
    if (!Array.isArray(rawOuter) || rawOuter.length < 3) throw new Error(`${name}.faces[${faceIndex}].outer must contain at least 3 vertex indices`);
    const outer = rawOuter.map((item, itemIndex) => normalizeVertexIndex(item, vertexCount, `${name}.faces[${faceIndex}].outer[${itemIndex}]`));
    const holes = (face?.holes || []).map((hole, holeIndex) => {
      const loop = Array.isArray(hole) ? hole : hole?.outer ?? hole?.loop ?? hole?.vertices;
      if (!Array.isArray(loop) || loop.length < 3) throw new Error(`${name}.faces[${faceIndex}].holes[${holeIndex}] must contain at least 3 vertex indices`);
      return loop.map((item, itemIndex) => normalizeVertexIndex(item, vertexCount, `${name}.faces[${faceIndex}].holes[${holeIndex}][${itemIndex}]`));
    });
    return {
      outer,
      holes,
      id: face?.id ?? face?.face_id ?? face?.faceId ?? null,
      material: face?.material || null,
      back_material: face?.back_material ?? face?.backMaterial ?? null,
      smooth: face?.smooth ?? null,
      soft: face?.soft ?? null,
      reversed: Boolean(face?.reversed ?? face?.reverse),
      normal: normalizeOptionalVector(face?.normal, `${name}.faces[${faceIndex}].normal`),
      plane: normalizeOptionalPlane(face?.plane, `${name}.faces[${faceIndex}].plane`),
      area: normalizeOptionalFiniteNumber(face?.area, `${name}.faces[${faceIndex}].area`),
      pushpull: normalizeOptionalPushPull(face?.pushpull, `${name}.faces[${faceIndex}].pushpull`),
      followme: normalizeOptionalFollowme(face?.followme, `${name}.faces[${faceIndex}].followme`),
      position_material: normalizeOptionalPositionMaterial(face?.position_material ?? face?.positionMaterial, `${name}.faces[${faceIndex}].position_material`),
      metadata: face?.metadata && typeof face.metadata === 'object' ? structuredClone(face.metadata) : null
    };
  });
}

function normalizeOptionalVector(value, fieldName) {
  if (value === undefined || value === null) return null;
  return normalizeVector(value, [0, 0, 0], fieldName);
}

function normalizeOptionalPlane(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length !== 4) throw new Error(`${fieldName} must be [a, b, c, d]`);
  return value.map((item, index) => {
    const number = Number(item);
    if (!Number.isFinite(number)) throw new Error(`${fieldName}[${index}] must be finite`);
    return number;
  });
}

function normalizeOptionalFiniteNumber(value, fieldName) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} must be finite`);
  return number;
}

function normalizeOptionalPushPull(value, fieldName) {
  if (value === undefined || value === null) return null;
  const spec = typeof value === 'object' ? value : { distance: value };
  const distance = Number(spec.distance);
  if (!Number.isFinite(distance)) throw new Error(`${fieldName}.distance must be finite`);
  return {
    distance,
    copy: Boolean(spec.copy),
    metadata_only: spec.metadata_only !== false
  };
}

function normalizeOptionalFollowme(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  if (!Array.isArray(value.path) || value.path.length < 2) throw new Error(`${fieldName}.path must contain at least 2 points`);
  return {
    path: value.path.map((point, index) => normalizeVector(point, [0, 0, 0], `${fieldName}.path[${index}]`)),
    ...(value.name !== undefined ? { name: String(value.name) } : {}),
    ...(value.material !== undefined ? { material: String(value.material) } : {}),
    ...(value.smooth !== undefined ? { smooth: value.smooth } : {})
  };
}

function normalizeOptionalPositionMaterial(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  const mapping = value.mapping;
  if (!Array.isArray(mapping) || mapping.length < 2) throw new Error(`${fieldName}.mapping must contain at least 2 entries`);
  return {
    material: value.material !== undefined ? String(value.material) : null,
    front: value.front !== false,
    projection: value.projection || 'position_material',
    mapping: mapping.map((entry, index) => ({
      point: normalizeVector(entry.point, [0, 0, 0], `${fieldName}.mapping[${index}].point`),
      uv: normalizeUvPair(entry.uv, `${fieldName}.mapping[${index}].uv`)
    })),
    uv: Array.isArray(value.uv) ? value.uv.map((point, index) => normalizeUvPair(point, `${fieldName}.uv[${index}]`)) : mapping.map((entry) => normalizeUvPair(entry.uv, fieldName))
  };
}

function normalizeUvPair(value, fieldName) {
  if (!Array.isArray(value) || value.length < 2) throw new Error(`${fieldName} must be [u, v]`);
  const u = Number(value[0]);
  const v = Number(value[1]);
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error(`${fieldName} must contain finite numbers`);
  return [u, v];
}

function normalizeGeometryEdges(edges, vertexCount, name) {
  if (!Array.isArray(edges)) throw new Error(`${name}.edges must be an array`);
  return edges.map((edge, edgeIndex) => {
    if (!Array.isArray(edge) || edge.length !== 2) throw new Error(`${name}.edges[${edgeIndex}] must be [a, b] vertex indices`);
    return edge.map((item, itemIndex) => normalizeVertexIndex(item, vertexCount, `${name}.edges[${edgeIndex}][${itemIndex}]`));
  });
}

function normalizeVertexIndex(item, vertexCount, fieldName) {
  const index = Number(item);
  if (!Number.isInteger(index) || index < 0 || index >= vertexCount) throw new Error(`${fieldName} must be a valid vertex index`);
  return index;
}

function countGeometryInputEdges(faces, explicitEdges) {
  const edgeSet = new Set(explicitEdges.map(([a, b]) => edgeKey(a, b)));
  for (const face of faces) {
    addLoopEdges(edgeSet, face.outer);
    for (const hole of face.holes) addLoopEdges(edgeSet, hole);
  }
  return edgeSet.size;
}

function addLoopEdges(edgeSet, loop) {
  for (let index = 0; index < loop.length; index += 1) {
    edgeSet.add(edgeKey(loop[index], loop[(index + 1) % loop.length]));
  }
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
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
  const n = resolveCurveSegments(operation, r);
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
