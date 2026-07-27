import { assertObjectIdentityAvailable, objectId, objectIdentityFields } from './object-identity.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { addMesh, addPrism, prismVertices, profilePlaneVertices } from './primitive-operations.mjs';
import { applyTransform, normalizePlanPoint, normalizePlanSize, normalizeTransform, normalizeVector, positiveNumber, nonNegativeNumber } from './operation-utils.mjs';
import { boundingBoxForVertices, mergeBoundingBoxes } from './snapshot.mjs';

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
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
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
  addPanelWithOpenings(model, { ...objectIdentityFields(operation), name, origin, plane: 'xy', size: [width, depth], thickness, openings, material, smooth });
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

export function addFaceWithHoles(model, operation) {
  const { name, origin = [0, 0, 0], plane = 'xy', outer, holes = [], material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('face_with_holes operation requires a string name');
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  if (!['xy', 'xz', 'yz'].includes(plane)) throw new Error(`${name}.plane must be one of xy, xz, yz`);
  const { outerProfile, holeProfiles } = normalizeProfileWithHoles(outer, holes, name);
  const profileEdges = profileLoopEdgeCount(outerProfile, holeProfiles);
  const vertices = profilePlaneVertices(normalizedOrigin, plane, outerProfile);
  const materialName = ensureMaterial(model, material);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'face_with_holes',
    faces: 1,
    edges: profileEdges,
    material: materialName,
    plane,
    holes: holeProfiles.length,
    profile: { outer: outerProfile, holes: holeProfiles.length, hole_edges: holeProfiles.map((hole) => hole.length) },
    transform: normalizeTransform({ transform }, name),
    bounding_box: boundingBoxForVertices(applyTransform(vertices, { transform }, name))
  });
}

export function addProfileExtrude(model, operation) {
  const { name, origin = [0, 0, 0], plane = 'xy', outer, holes = [], depth, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('profile_extrude operation requires a string name');
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  if (!['xy', 'xz', 'yz'].includes(plane)) throw new Error(`${name}.plane must be one of xy, xz, yz`);
  const extrusionDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const { outerProfile, holeProfiles } = normalizeProfileWithHoles(outer, holes, name);
  const profileEdges = profileLoopEdgeCount(outerProfile, holeProfiles);
  const vertices = prismVertices(normalizedOrigin, plane, outerProfile, extrusionDepth);
  const materialName = ensureMaterial(model, material);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'profile_extrude',
    faces: profileEdges + 2,
    edges: profileEdges * 3,
    material: materialName,
    plane,
    depth: extrusionDepth,
    holes: holeProfiles.length,
    profile: { outer: outerProfile, holes: holeProfiles.length, hole_edges: holeProfiles.map((hole) => hole.length) },
    transform: normalizeTransform({ transform }, name),
    bounding_box: boundingBoxForVertices(applyTransform(vertices, { transform }, name))
  });
}

function normalizeProfileWithHoles(outer, holes, name) {
  if (!Array.isArray(holes)) throw new Error(`${name}.holes must be an array`);
  const outerProfile = normalizeProfileLoop(outer, `${name}.outer`);
  const holeProfiles = holes.map((hole, index) => normalizeProfileLoop(hole?.points ?? hole, `${name}.holes[${index}]`));
  validateProfileHoles(outerProfile, holeProfiles, name);
  return { outerProfile, holeProfiles };
}

function normalizeProfileLoop(points, fieldName) {
  if (!Array.isArray(points)) throw new Error(`${fieldName} must be an array of [x, y] points`);
  let normalized = points.map((point, index) => normalizePlanPoint(point, `${fieldName}[${index}]`));
  if (normalized.length > 1 && pointsEqual2d(normalized[0], normalized[normalized.length - 1])) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized.length < 3) throw new Error(`${fieldName} must contain at least 3 distinct [x, y] points`);
  const seen = new Set();
  normalized.forEach((point, index) => {
    const key = `${point[0]}:${point[1]}`;
    if (seen.has(key)) throw new Error(`${fieldName}[${index}] repeats a non-adjacent profile point`);
    seen.add(key);
    if (pointsEqual2d(point, normalized[(index + 1) % normalized.length])) throw new Error(`${fieldName}[${index}] creates a zero-length profile edge`);
  });
  if (Math.abs(signedArea2d(normalized)) <= 1e-9) throw new Error(`${fieldName} must enclose non-zero area`);
  validateNoSelfIntersections(normalized, fieldName);
  return normalized;
}

function validateProfileHoles(outer, holes, name) {
  holes.forEach((hole, holeIndex) => {
    hole.forEach((point) => {
      if (!isPointStrictlyInsidePolygon(point, outer)) throw new Error(`${name}.holes[${holeIndex}] must fit inside outer profile without touching boundary`);
    });
    validateLoopsDoNotIntersect(outer, hole, `${name}.holes[${holeIndex}] must fit inside outer profile without crossing boundary`);
  });
  for (let i = 0; i < holes.length; i += 1) {
    for (let j = i + 1; j < holes.length; j += 1) {
      validateLoopsDoNotIntersect(holes[i], holes[j], `${name}.holes[${i}] must not overlap ${name}.holes[${j}]`);
      if (isPointStrictlyInsidePolygon(holes[i][0], holes[j]) || isPointStrictlyInsidePolygon(holes[j][0], holes[i])) {
        throw new Error(`${name}.holes[${i}] must not overlap ${name}.holes[${j}]`);
      }
    }
  }
}

function validateNoSelfIntersections(loop, fieldName) {
  for (let i = 0; i < loop.length; i += 1) {
    const a1 = loop[i];
    const a2 = loop[(i + 1) % loop.length];
    for (let j = i + 1; j < loop.length; j += 1) {
      if (profileEdgesAreAdjacent(i, j, loop.length)) continue;
      const b1 = loop[j];
      const b2 = loop[(j + 1) % loop.length];
      if (segmentsIntersect2d(a1, a2, b1, b2)) throw new Error(`${fieldName} must not self-intersect`);
    }
  }
}

function validateLoopsDoNotIntersect(a, b, message) {
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersect2d(a1, a2, b1, b2)) throw new Error(message);
    }
  }
}

function profileLoopEdgeCount(outer, holes) {
  return outer.length + holes.reduce((sum, hole) => sum + hole.length, 0);
}

function profileEdgesAreAdjacent(a, b, count) {
  return a === b || Math.abs(a - b) === 1 || (a === 0 && b === count - 1) || (b === 0 && a === count - 1);
}

function pointsEqual2d(a, b) {
  return Math.abs(a[0] - b[0]) <= 1e-9 && Math.abs(a[1] - b[1]) <= 1e-9;
}

function signedArea2d(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function isPointStrictlyInsidePolygon(point, polygon) {
  if (polygon.some((start, index) => pointOnSegment2d(point, start, polygon[(index + 1) % polygon.length]))) return false;
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsIntersect2d(a, b, c, d) {
  if (Math.max(a[0], b[0]) + 1e-9 < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + 1e-9 < Math.min(a[0], b[0])) return false;
  if (Math.max(a[1], b[1]) + 1e-9 < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + 1e-9 < Math.min(a[1], b[1])) return false;
  const o1 = orientation2d(a, b, c);
  const o2 = orientation2d(a, b, d);
  const o3 = orientation2d(c, d, a);
  const o4 = orientation2d(c, d, b);
  if (Math.abs(o1) <= 1e-9 && pointOnSegment2d(c, a, b)) return true;
  if (Math.abs(o2) <= 1e-9 && pointOnSegment2d(d, a, b)) return true;
  if (Math.abs(o3) <= 1e-9 && pointOnSegment2d(a, c, d)) return true;
  if (Math.abs(o4) <= 1e-9 && pointOnSegment2d(b, c, d)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function orientation2d(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment2d(point, start, end) {
  return Math.abs(orientation2d(start, end, point)) <= 1e-9
    && point[0] >= Math.min(start[0], end[0]) - 1e-9
    && point[0] <= Math.max(start[0], end[0]) + 1e-9
    && point[1] >= Math.min(start[1], end[1]) - 1e-9
    && point[1] <= Math.max(start[1], end[1]) + 1e-9;
}

export function addGableRoof(model, operation) {
  const { name, origin = [0, 0, 0], width, depth, rise, overhang = 0, material } = operation;
  const roofWidth = positiveNumber(width, undefined, `${name}.width`);
  const roofDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const roofRise = positiveNumber(rise, undefined, `${name}.rise`);
  const roofOverhang = nonNegativeNumber(overhang, 0, `${name}.overhang`);
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const points = [[0, 0], [(roofWidth + 2 * roofOverhang) / 2, roofRise], [roofWidth + 2 * roofOverhang, 0]];
  addPrism(model, {
    ...objectIdentityFields(operation),
    name,
    origin: [x - roofOverhang, y - roofOverhang, z],
    plane: 'xz',
    points,
    depth: roofDepth + 2 * roofOverhang,
    material
  });
  model.groups[model.groups.length - 1].kind = 'gable_roof';
}

export function addShedRoof(model, operation) {
  const { name, origin = [0, 0, 0], width, depth, rise, overhang = 0, material } = operation;
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
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces: [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]], material, smooth: 'coplanar' });
  model.groups[model.groups.length - 1].kind = 'shed_roof';
}
