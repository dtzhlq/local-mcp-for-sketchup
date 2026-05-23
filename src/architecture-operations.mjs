import { objectIdentityFields } from './object-identity.mjs';
import { addBox } from './product-operations.mjs';
import { addCylinder } from './primitive-operations.mjs';
import { addPanelWithOpenings } from './profile-operations.mjs';
import { addPipeBetweenPoints } from './surface-operations.mjs';
import { finiteNumber, integerInRange, normalizeVector, positiveNumber } from './operation-utils.mjs';

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

export function addWall(model, operation = {}) {
  const { name, start, end, height, thickness = 120, openings = [], material } = operation;
  if (!name || typeof name !== 'string') throw new Error('wall operation requires a string name');
  const wallStart = normalizeVector(start, [0, 0, 0], `${name}.start`);
  const wallEnd = normalizeVector(end, [0, 0, 0], `${name}.end`);
  const wallHeight = positiveNumber(height, undefined, `${name}.height`);
  const wallThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const dx = wallEnd[0] - wallStart[0];
  const dy = wallEnd[1] - wallStart[1];
  if (Math.abs(dx) > 0 && Math.abs(dy) > 0) throw new Error(`${name} supports axis-aligned walls only in the MVP`);
  if (Math.abs(dx) === 0 && Math.abs(dy) === 0) throw new Error(`${name}.start and end must not be identical`);
  if (Math.abs(dx) >= Math.abs(dy)) {
    const origin = [Math.min(wallStart[0], wallEnd[0]), wallStart[1], wallStart[2]];
    addPanelWithOpenings(model, { ...objectIdentityFields(operation), name, origin, plane: 'xz', size: [Math.abs(dx), wallHeight], thickness: wallThickness, openings, material });
  } else {
    const origin = [wallStart[0], Math.min(wallStart[1], wallEnd[1]), wallStart[2]];
    addPanelWithOpenings(model, { ...objectIdentityFields(operation), name, origin, plane: 'yz', size: [Math.abs(dy), wallHeight], thickness: wallThickness, openings, material });
  }
  model.groups[model.groups.length - 1].kind = 'wall';
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
