import { assertObjectIdentityAvailable, objectId, objectIdentityFields } from './object-identity.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { addMesh } from './primitive-operations.mjs';
import { addBox } from './product-operations.mjs';
import { addCylinder } from './primitive-operations.mjs';
import { addPanelWithOpenings } from './profile-operations.mjs';
import { addPipeBetweenPoints } from './surface-operations.mjs';
import { applyTransform, finiteNumber, integerInRange, normalizeKeyword, normalizePlanPoint, normalizeQaMetadata, normalizeTransform, normalizeVector, positiveNumber, nonNegativeNumber } from './operation-utils.mjs';
import { boundingBoxForVertices } from './snapshot.mjs';

const GEOMETRY_EPSILON = 1e-6;

export function addLevel(model, { name, elevation = 0, height } = {}) {
  if (!name || typeof name !== 'string') throw new Error('level operation requires a string name');
  const level = {
    name,
    elevation: finiteNumber(elevation, 0, `${name}.elevation`)
  };
  if (height !== undefined) level.height = positiveNumber(height, undefined, `${name}.height`);
  model.levels.push(level);
}

export function addFloorSlab(model, operation = {}) {
  const { name, origin = [0, 0, 0], width, depth, thickness = 150, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('floor_slab operation requires a string name');
  addBox(model, { ...objectIdentityFields(operation), name, origin, size: [positiveNumber(width, undefined, `${name}.width`), positiveNumber(depth, undefined, `${name}.depth`), positiveNumber(thickness, undefined, `${name}.thickness`)], material, transform });
  model.groups[model.groups.length - 1].kind = 'floor_slab';
}

export function addFootprintSlab(model, operation = {}) {
  const { name, origin = [0, 0, 0], points, holes = [], thickness = 150, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('footprint_slab operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const { outer: footprint, holes: normalizedHoles } = normalizePolygonWithHoles(points, holes, name, 'points');
  const slabThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  addExtrudedProfileGroup(model, {
    ...operation,
    name,
    origin: [x, y, z],
    outer: footprint,
    holes: normalizedHoles,
    depth: slabThickness,
    material,
    transform,
    kind: 'footprint_slab'
  });
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
  const length = Math.hypot(dx, dy);
  if (length <= GEOMETRY_EPSILON) throw new Error(`${name}.start and end must not be identical`);
  const isAxisAligned = Math.abs(dx) <= GEOMETRY_EPSILON || Math.abs(dy) <= GEOMETRY_EPSILON;
  if (!isAxisAligned) {
    const normalizedOpenings = normalizeWallOpenings(openings, length, wallHeight, `${name}.openings`);
    addWallSegmentMesh(model, { ...objectIdentityFields(operation), name, start: wallStart, end: wallEnd, height: wallHeight, thickness: wallThickness, material, transform: operation.transform, translation: operation.translation, qa: operation.qa, kind: 'wall' });
    applyOpeningTopology(model.groups[model.groups.length - 1], normalizedOpenings);
    return;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    const origin = [Math.min(wallStart[0], wallEnd[0]), wallStart[1], wallStart[2]];
    addPanelWithOpenings(model, { ...objectIdentityFields(operation), name, origin, plane: 'xz', size: [Math.abs(dx), wallHeight], thickness: wallThickness, openings, material });
  } else {
    const origin = [wallStart[0], Math.min(wallStart[1], wallEnd[1]), wallStart[2]];
    addPanelWithOpenings(model, { ...objectIdentityFields(operation), name, origin, plane: 'yz', size: [Math.abs(dy), wallHeight], thickness: wallThickness, openings, material });
  }
  model.groups[model.groups.length - 1].kind = 'wall';
}

export function addWallPath(model, operation = {}) {
  const { name, path, height, thickness = 120, openings = [], material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('wall_path operation requires a string name');
  if (!Array.isArray(path) || path.length < 2) throw new Error(`${name}.path must contain at least 2 [x, y, z] points`);
  const normalizedPath = path.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.path[${index}]`));
  assertUnique3dPoints(normalizedPath, `${name}.path`);
  const wallHeight = positiveNumber(height, undefined, `${name}.height`);
  const wallThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const segmentLengths = normalizedPath.slice(0, -1).map((point, index) => distanceBetween(point, normalizedPath[index + 1]));
  const normalizedOpenings = normalizeWallPathOpenings(openings, segmentLengths, wallHeight, `${name}.openings`);
  const vertices = [];
  const faces = [];
  for (let index = 0; index < normalizedPath.length - 1; index += 1) {
    const segment = wallSegmentVertices(normalizedPath[index], normalizedPath[index + 1], wallHeight, wallThickness, `${name}.path[${index}]`);
    const offset = vertices.length;
    vertices.push(...segment);
    faces.push(...cuboidFaces(offset));
  }
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, transform });
  model.groups[model.groups.length - 1].kind = 'wall_path';
  applyOpeningTopology(model.groups[model.groups.length - 1], normalizedOpenings);
}

export function addCurvedWall(model, operation = {}) {
  const { name, center, radius, start_angle, startAngle, end_angle, endAngle, height, thickness = 120, segments = 12, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('curved_wall operation requires a string name');
  if (operation.openings !== undefined && Array.isArray(operation.openings) && operation.openings.length > 0) throw new Error(`${name}.openings are not supported for curved_wall`);
  const [cx, cy, cz] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const wallRadius = positiveNumber(radius, undefined, `${name}.radius`);
  const wallHeight = positiveNumber(height, undefined, `${name}.height`);
  const wallThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const segmentCount = integerInRange(segments, 2, 96, `${name}.segments`);
  const startDegrees = finiteNumber(start_angle ?? startAngle, undefined, `${name}.start_angle`);
  const endDegrees = finiteNumber(end_angle ?? endAngle, undefined, `${name}.end_angle`);
  if (Math.abs(endDegrees - startDegrees) <= GEOMETRY_EPSILON) throw new Error(`${name}.end_angle must differ from start_angle`);
  const path = [];
  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount;
    const angle = ((startDegrees + (endDegrees - startDegrees) * t) * Math.PI) / 180;
    path.push([cx + wallRadius * Math.cos(angle), cy + wallRadius * Math.sin(angle), cz]);
  }
  addWallPath(model, { ...objectIdentityFields(operation), name, path, height: wallHeight, thickness: wallThickness, material, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'curved_wall';
  group.segments = segmentCount;
}

export function addRoofFootprint(model, operation = {}) {
  const { name, origin = [0, 0, 0], points, holes = [], elevation, thickness = 100, rise = 0, slope_direction, slopeDirection, overhang = 0, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('roof_footprint operation requires a string name');
  const [x, y, originZ] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const roofZ = finiteNumber(elevation, originZ, `${name}.elevation`);
  const roofThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const roofRise = nonNegativeNumber(rise, 0, `${name}.rise`);
  const roofOverhang = nonNegativeNumber(overhang, 0, `${name}.overhang`);
  const { outer, holes: normalizedHoles } = normalizePolygonWithHoles(points, holes, name, 'points');
  const expandedOuter = roofOverhang > 0 ? offsetAxisAlignedPolygon(outer, roofOverhang) : outer;
  const direction = normalizeSlopeDirection(slope_direction ?? slopeDirection, `${name}.slope_direction`);
  const bboxVertices = roofFootprintVertices([x, y, roofZ], expandedOuter, roofThickness, roofRise, direction);
  addSemanticGroup(model, {
    operation,
    name,
    kind: 'roof_footprint',
    material,
    transform,
    faces: extrudedProfileFaceCount(expandedOuter, normalizedHoles),
    edges: extrudedProfileEdgeCount(expandedOuter, normalizedHoles),
    vertexCount: extrudedProfileVertexCount(expandedOuter, normalizedHoles),
    bboxVertices,
    metadata: {
      profile: { outer: expandedOuter, holes: normalizedHoles.length, hole_edges: normalizedHoles.map((hole) => hole.length) },
      slope_direction: direction,
      rise: roofRise,
      thickness: roofThickness
    }
  });
}

export function addHipRoof(model, operation = {}) {
  const { name, origin = [0, 0, 0], width, depth, rise, thickness = 80, overhang = 0, ridge_ratio, ridgeRatio, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('hip_roof operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const roofWidth = positiveNumber(width, undefined, `${name}.width`);
  const roofDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const roofRise = positiveNumber(rise, undefined, `${name}.rise`);
  const roofThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const roofOverhang = nonNegativeNumber(overhang, 0, `${name}.overhang`);
  const ratio = finiteNumber(ridge_ratio ?? ridgeRatio, 0.35, `${name}.ridge_ratio`);
  if (ratio <= 0 || ratio >= 1) throw new Error(`${name}.ridge_ratio must be greater than 0 and less than 1`);
  const minX = x - roofOverhang;
  const minY = y - roofOverhang;
  const w = roofWidth + roofOverhang * 2;
  const d = roofDepth + roofOverhang * 2;
  const ridgeLength = w * ratio;
  const ridgeStart = minX + (w - ridgeLength) / 2;
  const ridgeEnd = ridgeStart + ridgeLength;
  const top = [
    [minX, minY, z], [minX + w, minY, z], [minX + w, minY + d, z], [minX, minY + d, z],
    [ridgeStart, minY + d / 2, z + roofRise], [ridgeEnd, minY + d / 2, z + roofRise]
  ];
  const bottom = top.map(([px, py, pz]) => [px, py, pz - roofThickness]);
  const vertices = [...top, ...bottom];
  const faces = [
    [0, 1, 5, 4], [3, 4, 5, 2], [0, 4, 3], [1, 2, 5],
    [6, 10, 11, 7], [9, 8, 11, 10], [6, 9, 10], [7, 11, 8],
    [0, 6, 7, 1], [1, 7, 8, 2], [2, 8, 9, 3], [3, 9, 6, 0]
  ];
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, transform, smooth: 'coplanar' });
  model.groups[model.groups.length - 1].kind = 'hip_roof';
}

export function addParapetPath(model, operation = {}) {
  const { name, path, points, origin = [0, 0, 0], closed = false, height = 600, thickness = 180, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('parapet_path operation requires a string name');
  const wallPath = normalizePathOrPlanPoints(path, points, origin, closed, name);
  if (wallPath.length < 2) throw new Error(`${name}.path must contain at least 2 points`);
  const parapetHeight = positiveNumber(height, undefined, `${name}.height`);
  const parapetThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const vertices = [];
  const faces = [];
  for (let index = 0; index < wallPath.length - 1; index += 1) {
    const offset = vertices.length;
    vertices.push(...wallSegmentVertices(wallPath[index], wallPath[index + 1], parapetHeight, parapetThickness, `${name}.path[${index}]`));
    faces.push(...cuboidFaces(offset));
  }
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'parapet_path';
  group.closed = Boolean(closed);
}

export function addCurtainWall(model, operation = {}) {
  const { name, path, start, end, height, module_width, moduleWidth: moduleWidthInput, mullion_width, mullionWidth: mullionWidthInput, thickness = 50, material, frame_material, frameMaterial, panel_material, panelMaterial, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('curtain_wall operation requires a string name');
  const wallPath = path ?? (start && end ? [start, end] : undefined);
  if (!Array.isArray(wallPath) || wallPath.length < 2) throw new Error(`${name}.path must contain at least 2 [x, y, z] points or start/end`);
  const normalizedPath = wallPath.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.path[${index}]`));
  const wallHeight = positiveNumber(height, undefined, `${name}.height`);
  const moduleWidthValue = positiveNumber(module_width ?? moduleWidthInput, 1200, `${name}.module_width`);
  const mullionWidthValue = positiveNumber(mullion_width ?? mullionWidthInput, 80, `${name}.mullion_width`);
  const panelThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const vertices = [];
  const faces = [];
  let panelCount = 0;
  normalizedPath.slice(0, -1).forEach((point, index) => {
    const next = normalizedPath[index + 1];
    const length = distanceBetween(point, next);
    panelCount += Math.max(1, Math.ceil(length / moduleWidthValue));
    const offset = vertices.length;
    vertices.push(...wallSegmentVertices(point, next, wallHeight, panelThickness, `${name}.path[${index}]`));
    faces.push(...cuboidFaces(offset));
  });
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material: frame_material ?? frameMaterial ?? material, transform, smooth: 'coplanar' });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'curtain_wall';
  group.curtain_wall = {
    panels: panelCount,
    module_width: moduleWidthValue,
    mullion_width: mullionWidthValue,
    frame_material: frame_material ?? frameMaterial ?? material ?? null,
    panel_material: panel_material ?? panelMaterial ?? null
  };
}

export function addColumnGrid(model, operation = {}) {
  const { name, origin = [0, 0, 0], points, x_count, xCount, y_count, yCount, spacing, column_size, columnSize, radius, height, shape = 'rect', segments = 12, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('column_grid operation requires a string name');
  const columnHeight = positiveNumber(height, undefined, `${name}.height`);
  const normalizedShape = normalizeKeyword(shape, ['rect', 'round'], `${name}.shape`);
  const columnPoints = normalizeColumnGridPoints({ points, origin, x_count, xCount, y_count, yCount, spacing, name });
  const vertices = [];
  const faces = [];
  const columnMetadata = [];
  columnPoints.forEach((point, index) => {
    const offset = vertices.length;
    if (normalizedShape === 'round') {
      const r = positiveNumber(radius, undefined, `${name}.radius`);
      const n = integerInRange(segments, 6, 48, `${name}.segments`);
      vertices.push(...cylinderVertices(point, r, columnHeight, n));
      faces.push(...cylinderFaces(offset, n));
      columnMetadata.push({ index, center: point, shape: 'round', radius: r });
    } else {
      const [w, d] = normalizePlanSizeLocal(column_size ?? columnSize, [300, 300], `${name}.column_size`);
      vertices.push(...boxVerticesFromOrigin([point[0] - w / 2, point[1] - d / 2, point[2]], [w, d, columnHeight]));
      faces.push(...cuboidFaces(offset));
      columnMetadata.push({ index, center: point, shape: 'rect', size: [w, d] });
    }
  });
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, transform, smooth: normalizedShape === 'round' ? 'all' : false });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'column_grid';
  group.columns = columnMetadata.length;
  if (normalizedShape === 'round') group.segments = integerInRange(segments, 6, 48, `${name}.segments`);
}

export function addPathSurface(model, operation = {}) {
  const { name, path, width, thickness = 20, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('path_surface operation requires a string name');
  if (!Array.isArray(path) || path.length < 2) throw new Error(`${name}.path must contain at least 2 [x, y, z] points`);
  const normalizedPath = path.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.path[${index}]`));
  assertUnique3dPoints(normalizedPath, `${name}.path`);
  const surfaceWidth = positiveNumber(width, undefined, `${name}.width`);
  const surfaceThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const { vertices, faces } = ribbonSegmentMesh(normalizedPath, surfaceWidth, surfaceThickness, name);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, transform, smooth: 'coplanar' });
  model.groups[model.groups.length - 1].kind = 'path_surface';
}

export function addTerrainMesh(model, operation = {}) {
  const { name, vertices, faces, material, transform, smooth = 'all' } = operation;
  if (!name || typeof name !== 'string') throw new Error('terrain_mesh operation requires a string name');
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, transform, smooth });
  model.groups[model.groups.length - 1].kind = 'terrain_mesh';
}

export function addParkingStallArray(model, operation = {}) {
  const { name, origin = [0, 0, 0], count, stall_width, stallWidth, stall_depth, stallDepth, line_width, lineWidth, line_height, lineHeight, direction = 'x', material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('parking_stall_array operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const stallCount = integerInRange(count, 1, 500, `${name}.count`);
  const width = positiveNumber(stall_width ?? stallWidth, undefined, `${name}.stall_width`);
  const depth = positiveNumber(stall_depth ?? stallDepth, undefined, `${name}.stall_depth`);
  const lineW = positiveNumber(line_width ?? lineWidth, 100, `${name}.line_width`);
  const lineH = positiveNumber(line_height ?? lineHeight, 5, `${name}.line_height`);
  const orientation = normalizeKeyword(direction, ['x', 'y'], `${name}.direction`);
  const rectangles = parkingLineRectangles([x, y, z], stallCount, width, depth, lineW, lineH, orientation);
  const vertices = [];
  const faces = [];
  rectangles.forEach((rect) => {
    const offset = vertices.length;
    vertices.push(...boxVerticesFromOrigin(rect.origin, rect.size));
    faces.push(...cuboidFaces(offset));
  });
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, transform, smooth: 'coplanar' });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'parking_stall_array';
  group.stalls = stallCount;
}

export function addDoor(model, operation = {}) {
  addVerticalPanel(model, operation, 'door', 'door operation requires a string name');
}

export function addWindow(model, operation = {}) {
  addVerticalPanel(model, operation, 'window', 'window operation requires a string name');
}

function addVerticalPanel(model, operation = {}, kind, errorMessage) {
  const { name, origin = [0, 0, 0], plane = 'xz', width, height, thickness = 40, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error(errorMessage);
  const panelWidth = positiveNumber(width, undefined, `${name}.width`);
  const panelHeight = positiveNumber(height, undefined, `${name}.height`);
  const panelThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  if (plane === 'xz') addBox(model, { ...objectIdentityFields(operation), name, origin, size: [panelWidth, panelThickness, panelHeight], material, transform });
  else if (plane === 'yz') addBox(model, { ...objectIdentityFields(operation), name, origin, size: [panelThickness, panelWidth, panelHeight], material, transform });
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

function addExtrudedProfileGroup(model, { name, origin, outer, holes = [], depth, material, transform, kind, qa, ...operation }) {
  const bboxVertices = [
    ...outer.map(([px, py]) => [origin[0] + px, origin[1] + py, origin[2]]),
    ...outer.map(([px, py]) => [origin[0] + px, origin[1] + py, origin[2] + depth])
  ];
  addSemanticGroup(model, {
    operation: { ...operation, name, transform, qa },
    name,
    kind,
    material,
    transform,
    faces: extrudedProfileFaceCount(outer, holes),
    edges: extrudedProfileEdgeCount(outer, holes),
    vertexCount: extrudedProfileVertexCount(outer, holes),
    bboxVertices,
    metadata: {
      profile: { outer, holes: holes.length, hole_edges: holes.map((hole) => hole.length) },
      thickness: depth
    }
  });
}

function addSemanticGroup(model, { operation, name, kind, material, transform, faces, edges, vertexCount, bboxVertices, metadata = {} }) {
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind,
    faces,
    edges,
    material: ensureMaterial(model, material),
    vertices: vertexPlaceholders(vertexCount),
    transform: normalizeTransform({ ...operation, transform }, name),
    bounding_box: boundingBoxForVertices(applyTransform(bboxVertices, { ...operation, transform }, name)),
    qa: normalizeQaMetadata(operation.qa),
    ...metadata
  });
}

function vertexPlaceholders(count) {
  return Array.from({ length: count }, () => [0, 0, 0]);
}

function extrudedProfileEdgeTotal(outer, holes) {
  return outer.length + holes.reduce((sum, hole) => sum + hole.length, 0);
}

function extrudedProfileFaceCount(outer, holes) {
  return 2 + extrudedProfileEdgeTotal(outer, holes);
}

function extrudedProfileEdgeCount(outer, holes) {
  return extrudedProfileEdgeTotal(outer, holes) * 3;
}

function extrudedProfileVertexCount(outer, holes) {
  return extrudedProfileEdgeTotal(outer, holes) * 2;
}

function addWallSegmentMesh(model, { name, start, end, height, thickness, material, transform, translation, qa, kind, id, object_id, objectId, guid }) {
  addMesh(model, {
    name,
    id,
    object_id,
    objectId,
    guid,
    vertices: wallSegmentVertices(start, end, height, thickness, name),
    faces: cuboidFaces(0),
    material,
    transform,
    translation,
    qa
  });
  model.groups[model.groups.length - 1].kind = kind;
}

function applyOpeningTopology(group, openings) {
  if (!openings.length) return;
  group.openings = openings;
  group.faces += openings.length * 4;
  group.edges += openings.length * 12;
  const currentVertexCount = Array.isArray(group.vertices) ? group.vertices.length : 0;
  group.vertices = vertexPlaceholders(currentVertexCount + openings.length * 8);
}

function wallSegmentVertices(start, end, height, thickness, fieldName) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= GEOMETRY_EPSILON) throw new Error(`${fieldName} segment length must be positive`);
  const nx = -dy / length;
  const ny = dx / length;
  const half = thickness / 2;
  const bottom = [
    [start[0] + nx * half, start[1] + ny * half, start[2]],
    [start[0] - nx * half, start[1] - ny * half, start[2]],
    [end[0] - nx * half, end[1] - ny * half, end[2]],
    [end[0] + nx * half, end[1] + ny * half, end[2]]
  ];
  return [...bottom, ...bottom.map(([x, y, z]) => [x, y, z + height])];
}

function cuboidFaces(offset) {
  return [
    [offset, offset + 1, offset + 2, offset + 3],
    [offset + 4, offset + 7, offset + 6, offset + 5],
    [offset, offset + 4, offset + 5, offset + 1],
    [offset + 1, offset + 5, offset + 6, offset + 2],
    [offset + 2, offset + 6, offset + 7, offset + 3],
    [offset + 3, offset + 7, offset + 4, offset]
  ];
}

function normalizeWallPathOpenings(openings, segmentLengths, wallHeight, fieldName) {
  if (!Array.isArray(openings)) throw new Error(`${fieldName} must be an array`);
  const normalized = openings.map((opening, index) => {
    if (!opening || typeof opening !== 'object' || Array.isArray(opening)) throw new Error(`${fieldName}[${index}] must be an object`);
    const segmentIndex = integerInRange(opening.segment_index ?? opening.segmentIndex, 0, segmentLengths.length - 1, `${fieldName}[${index}].segment_index`);
    return {
      ...normalizeWallOpening(opening, segmentLengths[segmentIndex], wallHeight, `${fieldName}[${index}]`),
      segment_index: segmentIndex
    };
  });
  assertNoOpeningOverlaps(normalized, fieldName, true);
  return normalized;
}

function normalizeWallOpenings(openings, segmentLength, wallHeight, fieldName) {
  if (!Array.isArray(openings)) throw new Error(`${fieldName} must be an array`);
  const normalized = openings.map((opening, index) => normalizeWallOpening(opening, segmentLength, wallHeight, `${fieldName}[${index}]`));
  assertNoOpeningOverlaps(normalized, fieldName, false);
  return normalized;
}

function normalizeWallOpening(opening, segmentLength, wallHeight, fieldName) {
  if (!opening || typeof opening !== 'object' || Array.isArray(opening)) throw new Error(`${fieldName} must be an object`);
  const offset = nonNegativeNumber(opening.offset ?? opening.x ?? opening.origin?.[0], undefined, `${fieldName}.offset`);
  const width = positiveNumber(opening.width, undefined, `${fieldName}.width`);
  const height = positiveNumber(opening.height, undefined, `${fieldName}.height`);
  const sillHeight = nonNegativeNumber(opening.sill_height ?? opening.sillHeight ?? opening.y ?? opening.z ?? opening.origin?.[1], 0, `${fieldName}.sill_height`);
  if (offset + width > segmentLength + GEOMETRY_EPSILON) throw new Error(`${fieldName} must fit inside wall segment length`);
  if (sillHeight + height > wallHeight + GEOMETRY_EPSILON) throw new Error(`${fieldName} must fit inside wall height`);
  return {
    name: opening.name || 'Opening',
    offset,
    width,
    height,
    sill_height: sillHeight
  };
}

function assertNoOpeningOverlaps(openings, fieldName, includeSegment) {
  for (let i = 0; i < openings.length; i += 1) {
    for (let j = i + 1; j < openings.length; j += 1) {
      if (includeSegment && openings[i].segment_index !== openings[j].segment_index) continue;
      const horizontalOverlap = intervalsOverlap(openings[i].offset, openings[i].offset + openings[i].width, openings[j].offset, openings[j].offset + openings[j].width);
      const verticalOverlap = intervalsOverlap(openings[i].sill_height, openings[i].sill_height + openings[i].height, openings[j].sill_height, openings[j].sill_height + openings[j].height);
      if (horizontalOverlap && verticalOverlap) throw new Error(`${fieldName}[${j}] must not overlap another opening`);
    }
  }
}

function intervalsOverlap(a1, a2, b1, b2) {
  return Math.max(a1, b1) < Math.min(a2, b2) - GEOMETRY_EPSILON;
}

function normalizeSimplePolygon(points, fieldName) {
  if (!Array.isArray(points) || points.length < 3) throw new Error(`${fieldName} must contain at least 3 [x, y] points`);
  const normalized = points.map((point, index) => normalizePlanPoint(point, `${fieldName}[${index}]`));
  assertUnique2dPoints(normalized, fieldName);
  assertSimplePolygon(normalized, fieldName);
  const area = polygonSignedArea(normalized);
  if (Math.abs(area) <= GEOMETRY_EPSILON) throw new Error(`${fieldName} must enclose non-zero area`);
  return area > 0 ? normalized : normalized.slice().reverse();
}

function normalizePolygonWithHoles(points, holes, name, pointsField) {
  if (!Array.isArray(holes)) throw new Error(`${name}.holes must be an array`);
  const outer = normalizeSimplePolygon(points, `${name}.${pointsField}`);
  const normalizedHoles = holes.map((hole, index) => {
    const source = hole?.points ?? hole;
    const normalized = normalizeSimplePolygon(source, `${name}.holes[${index}]`);
    return polygonSignedArea(normalized) < 0 ? normalized : normalized.slice().reverse();
  });
  validatePolygonHoles(outer, normalizedHoles, name);
  return { outer, holes: normalizedHoles };
}

function validatePolygonHoles(outer, holes, name) {
  holes.forEach((hole, holeIndex) => {
    hole.forEach((point) => {
      if (!pointStrictlyInsidePolygon(point, outer)) throw new Error(`${name}.holes[${holeIndex}] must fit inside outer profile without touching boundary`);
    });
    validateLoopsDoNotIntersect(outer, hole, `${name}.holes[${holeIndex}] must fit inside outer profile without crossing boundary`);
  });
  for (let i = 0; i < holes.length; i += 1) {
    for (let j = i + 1; j < holes.length; j += 1) {
      const message = `${name}.holes[${i}] must not overlap ${name}.holes[${j}]`;
      validateLoopsDoNotIntersect(holes[i], holes[j], message);
      if (pointStrictlyInsidePolygon(holes[i][0], holes[j]) || pointStrictlyInsidePolygon(holes[j][0], holes[i])) throw new Error(message);
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
      if (segmentsIntersect(a1, a2, b1, b2)) throw new Error(message);
    }
  }
}

function pointStrictlyInsidePolygon(point, polygon) {
  if (polygon.some((start, index) => onSegment(start, point, polygon[(index + 1) % polygon.length]))) return false;
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function normalizeSlopeDirection(value, fieldName) {
  if (value === undefined) return 'x';
  return normalizeKeyword(value, ['x', 'y', 'none'], fieldName);
}

function roofFootprintVertices(origin, outer, thickness, rise, direction) {
  const [x, y, z] = origin;
  const bounds = bounds2d(outer);
  const denom = direction === 'y' ? bounds.d : bounds.w;
  const safeDenom = denom <= GEOMETRY_EPSILON ? 1 : denom;
  const bottom = outer.map(([px, py]) => [x + px, y + py, z - thickness]);
  const top = outer.map(([px, py]) => {
    const t = direction === 'none' ? 0 : direction === 'y' ? (py - bounds.min[1]) / safeDenom : (px - bounds.min[0]) / safeDenom;
    return [x + px, y + py, z + rise * t];
  });
  return [...bottom, ...top];
}

function offsetAxisAlignedPolygon(points, amount) {
  const bounds = bounds2d(points);
  return points.map(([x, y]) => {
    const ox = x <= bounds.min[0] + GEOMETRY_EPSILON ? x - amount : x >= bounds.max[0] - GEOMETRY_EPSILON ? x + amount : x;
    const oy = y <= bounds.min[1] + GEOMETRY_EPSILON ? y - amount : y >= bounds.max[1] - GEOMETRY_EPSILON ? y + amount : y;
    return [ox, oy];
  });
}

function bounds2d(points) {
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  points.forEach(([x, y]) => {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
  });
  return { min, max, w: max[0] - min[0], d: max[1] - min[1] };
}

function normalizePathOrPlanPoints(path, points, origin, closed, name) {
  if (path !== undefined) {
    if (!Array.isArray(path) || path.length < 2) throw new Error(`${name}.path must contain at least 2 [x, y, z] points`);
    const normalized = path.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.path[${index}]`));
    return closePathIfNeeded(normalized, closed);
  }
  if (!Array.isArray(points) || points.length < 2) throw new Error(`${name}.points must contain at least 2 [x, y] points when path is omitted`);
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const normalized = points.map((point, index) => {
    const [px, py] = normalizePlanPoint(point, `${name}.points[${index}]`);
    return [x + px, y + py, z];
  });
  return closePathIfNeeded(normalized, closed);
}

function closePathIfNeeded(path, closed) {
  if (!closed) return path;
  const first = path[0];
  const last = path[path.length - 1];
  return distanceBetween(first, last) <= GEOMETRY_EPSILON ? path : [...path, first];
}

function normalizeColumnGridPoints({ points, origin, x_count, xCount, y_count, yCount, spacing, name }) {
  if (points !== undefined) {
    if (!Array.isArray(points) || points.length < 1) throw new Error(`${name}.points must contain at least one [x, y, z] point`);
    return points.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.points[${index}]`));
  }
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const countX = integerInRange(x_count ?? xCount, 1, 100, `${name}.x_count`);
  const countY = integerInRange(y_count ?? yCount, 1, 100, `${name}.y_count`);
  const [spacingX, spacingY] = normalizePlanSizeLocal(spacing, [1000, 1000], `${name}.spacing`);
  const result = [];
  for (let ix = 0; ix < countX; ix += 1) {
    for (let iy = 0; iy < countY; iy += 1) {
      result.push([x + ix * spacingX, y + iy * spacingY, z]);
    }
  }
  return result;
}

function normalizePlanSizeLocal(value, fallback, fieldName) {
  const source = value ?? fallback;
  if (!Array.isArray(source) || source.length !== 2) throw new Error(`${fieldName} must be [width, depth]`);
  const normalized = source.map((item, index) => positiveNumber(item, undefined, `${fieldName}[${index}]`));
  return normalized;
}

function boxVerticesFromOrigin(origin, size) {
  const [x, y, z] = origin;
  const [w, d, h] = size;
  return [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
    [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]
  ];
}

function cylinderVertices(origin, radius, height, segments) {
  const [x, y, z] = origin;
  const vertices = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments;
    vertices.push([x + radius * Math.cos(angle), y + radius * Math.sin(angle), z]);
  }
  for (let index = 0; index < segments; index += 1) vertices.push([vertices[index][0], vertices[index][1], z + height]);
  return vertices;
}

function cylinderFaces(offset, segments) {
  const faces = [];
  for (let index = 1; index < segments - 1; index += 1) faces.push([offset, offset + index + 1, offset + index]);
  for (let index = 1; index < segments - 1; index += 1) faces.push([offset + segments, offset + segments + index, offset + segments + index + 1]);
  for (let index = 0; index < segments; index += 1) faces.push([offset + index, offset + ((index + 1) % segments), offset + segments + ((index + 1) % segments), offset + segments + index]);
  return faces;
}

function ribbonSegmentMesh(path, width, thickness, name) {
  const vertices = [];
  const faces = [];
  path.slice(0, -1).forEach((start, index) => {
    const end = path[index + 1];
    const length = distanceBetween(start, end);
    if (length <= GEOMETRY_EPSILON) throw new Error(`${name}.path[${index}] segment length must be positive`);
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const planarLength = Math.hypot(dx, dy);
    if (planarLength <= GEOMETRY_EPSILON) throw new Error(`${name}.path[${index}] must have horizontal length`);
    const nx = -dy / planarLength;
    const ny = dx / planarLength;
    const half = width / 2;
    const bottom = [
      [start[0] + nx * half, start[1] + ny * half, start[2]],
      [start[0] - nx * half, start[1] - ny * half, start[2]],
      [end[0] - nx * half, end[1] - ny * half, end[2]],
      [end[0] + nx * half, end[1] + ny * half, end[2]]
    ];
    const offset = vertices.length;
    vertices.push(...bottom, ...bottom.map(([x, y, z]) => [x, y, z + thickness]));
    faces.push(...cuboidFaces(offset));
  });
  return { vertices, faces };
}

function parkingLineRectangles(origin, count, stallWidth, stallDepth, lineWidth, lineHeight, direction) {
  const [x, y, z] = origin;
  const rectangles = [];
  if (direction === 'x') {
    rectangles.push({ origin: [x, y, z], size: [count * stallWidth, lineWidth, lineHeight] });
    rectangles.push({ origin: [x, y + stallDepth - lineWidth, z], size: [count * stallWidth, lineWidth, lineHeight] });
    for (let index = 0; index <= count; index += 1) rectangles.push({ origin: [x + index * stallWidth - lineWidth / 2, y, z], size: [lineWidth, stallDepth, lineHeight] });
  } else {
    rectangles.push({ origin: [x, y, z], size: [lineWidth, count * stallWidth, lineHeight] });
    rectangles.push({ origin: [x + stallDepth - lineWidth, y, z], size: [lineWidth, count * stallWidth, lineHeight] });
    for (let index = 0; index <= count; index += 1) rectangles.push({ origin: [x, y + index * stallWidth - lineWidth / 2, z], size: [stallDepth, lineWidth, lineHeight] });
  }
  return rectangles;
}

function extrusionFaces(count) {
  const bottom = Array.from({ length: count }, (_, index) => count - 1 - index);
  const top = Array.from({ length: count }, (_, index) => count + index);
  const faces = [bottom, top];
  for (let index = 0; index < count; index += 1) {
    faces.push([index, (index + 1) % count, count + ((index + 1) % count), count + index]);
  }
  return faces;
}

function assertUnique2dPoints(points, fieldName) {
  const seen = new Set();
  points.forEach((point, index) => {
    const key = pointKey(point);
    if (seen.has(key)) throw new Error(`${fieldName}[${index}] must not duplicate another point`);
    seen.add(key);
  });
}

function assertUnique3dPoints(points, fieldName) {
  const seen = new Set();
  points.forEach((point, index) => {
    const key = pointKey(point);
    if (seen.has(key)) throw new Error(`${fieldName}[${index}] must not duplicate another point`);
    seen.add(key);
  });
}

function assertSimplePolygon(points, fieldName) {
  for (let a = 0; a < points.length; a += 1) {
    const b = (a + 1) % points.length;
    for (let c = a + 1; c < points.length; c += 1) {
      const d = (c + 1) % points.length;
      if (a === c || b === c || a === d) continue;
      if (segmentsIntersect(points[a], points[b], points[c], points[d])) {
        throw new Error(`${fieldName} must not self-intersect`);
      }
    }
  }
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (Math.abs(o1) <= GEOMETRY_EPSILON && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= GEOMETRY_EPSILON && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= GEOMETRY_EPSILON && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= GEOMETRY_EPSILON && onSegment(c, b, d)) return true;
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, c) {
  return b[0] >= Math.min(a[0], c[0]) - GEOMETRY_EPSILON
    && b[0] <= Math.max(a[0], c[0]) + GEOMETRY_EPSILON
    && b[1] >= Math.min(a[1], c[1]) - GEOMETRY_EPSILON
    && b[1] <= Math.max(a[1], c[1]) + GEOMETRY_EPSILON;
}

function polygonSignedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    area += points[index][0] * points[next][1] - points[next][0] * points[index][1];
  }
  return area / 2;
}

function pointKey(point) {
  return point.map((value) => value.toFixed(6)).join(':');
}
