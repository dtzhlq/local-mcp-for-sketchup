import { assertObjectIdentityAvailable, boxVertices, identityMatrix3, objectId, objectIdentityFields } from './object-identity.mjs';
export {
  assertObjectIdentityAvailable,
  boxVertices,
  findModelObject,
  matchesObjectReference,
  objectId,
  objectIdentityFields,
  referenceLabel,
  resolveObjectReference,
  rotationZMatrix
} from './object-identity.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { addCylinder, addMesh, profilePlaneVertices } from './primitive-operations.mjs';
import { applyTransform, integerInRange, nonEmptyString, nonNegativeNumber, normalizeBoolean, normalizeKeyword, normalizePlanSize, normalizeQaMetadata, normalizeTransform, normalizeVector, positiveNumber } from './operation-utils.mjs';
import { normalizeSize2, normalizeTextureTransform } from './object-operation-utils.mjs';
import { boundingBoxForVertices } from './snapshot.mjs';

export function addBox(model, operation) {
  const { name, origin, size, material } = operation;
  if (!name || typeof name !== 'string') {
    throw new Error('box operation requires a string name');
  }
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const normalizedSize = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if (normalizedSize.some((value) => value <= 0)) {
    throw new Error(`${name}.size values must be positive`);
  }
  const materialName = ensureMaterial(model, material);
  const [x, y, z] = normalizedOrigin;
  const [w, d, h] = normalizedSize;
  const vertices = boxVertices([x, y, z], [w, d, h]);
  const transformedVertices = applyTransform(vertices, operation, name);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'box',
    faces: 6,
    edges: 12,
    material: materialName,
    transform: normalizeTransform(operation, name),
    bounding_box: boundingBoxForVertices(transformedVertices),
    _vertices: transformedVertices,
    _orientation: identityMatrix3()
  });
}

export function addRoundedBox(model, operation) {
  const { name, origin = [0, 0, 0], size, radius, segments = 5, material, smooth = 'all' } = operation;
  if (!name || typeof name !== 'string') throw new Error('rounded_box operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const r = Math.min(nonNegativeNumber(radius, 0, `${name}.radius`), w / 2, d / 2);
  const n = integerInRange(segments, 1, 16, `${name}.segments`);
  const points = roundedRectPoints(x, y, w, d, r, n);
  addFootprintExtrusionMesh(model, operation, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'rounded_box';
  group.radius = r;
  group.segments = n;
  group.resolution_hint = { segments: n };
}

export function addBeveledPanel(model, operation) {
  const { name, origin = [0, 0, 0], size, bevel, material, smooth = 'coplanar' } = operation;
  if (!name || typeof name !== 'string') throw new Error('beveled_panel operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const b = Math.min(nonNegativeNumber(bevel, 0, `${name}.bevel`), w / 2, d / 2);
  const points = beveledRectPoints(x, y, w, d, b);
  addFootprintExtrusionMesh(model, { ...objectIdentityFields(operation), name, material, transform: operation.transform }, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'beveled_panel';
  group.bevel = b;
}

export function addFillet(model, operation) {
  const { name, origin = [0, 0, 0], size, radius, segments = 5, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('fillet operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const r = Math.min(nonNegativeNumber(radius, 0, `${name}.radius`), w / 2, d / 2);
  const n = integerInRange(segments, 1, 32, `${name}.segments`);
  const points = roundedRectPoints(x, y, w, d, r, n);
  addFootprintExtrusionMesh(model, { ...objectIdentityFields(operation), name, material, transform }, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'fillet';
  group.radius = r;
  group.segments = n;
}

export function addChamfer(model, operation) {
  const { name, origin = [0, 0, 0], size, amount, bevel = amount, material, smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('chamfer operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const [w, d, h] = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if ([w, d, h].some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const c = Math.min(nonNegativeNumber(bevel, 0, `${name}.amount`), w / 2, d / 2);
  const points = beveledRectPoints(x, y, w, d, c);
  addFootprintExtrusionMesh(model, { ...objectIdentityFields(operation), name, material, transform }, points, z, h, smooth);
  const group = model.groups[model.groups.length - 1];
  group.kind = 'chamfer';
  group.bevel = c;
}

export function addRecess(model, operation) {
  const { name, center = operation.origin, size, depth, radius = 0, segments = 5, material = 'Recess_Dark', smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('recess operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const [w, d] = normalizePlanSize(size, `${name}.size`);
  const recessDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const r = Math.min(nonNegativeNumber(radius, 0, `${name}.radius`), w / 2, d / 2);
  const n = integerInRange(segments, 1, 32, `${name}.segments`);
  const points = roundedRectPoints(x - w / 2, y - d / 2, w, d, r, n);
  const top = points.map(([px, py]) => [px, py, z]);
  const bottom = points.map(([px, py]) => [px, py, z - recessDepth]);
  const count = points.length;
  const faces = [Array.from({ length: count }, (_, index) => count + count - 1 - index)];
  for (let index = 0; index < count; index += 1) {
    faces.push([index, (index + 1) % count, count + ((index + 1) % count), count + index]);
  }
  addMesh(model, { ...objectIdentityFields(operation), name, vertices: [...top, ...bottom], faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'recess';
  group.segments = n;
}

export function addEngravedLine(model, operation) {
  const { name, points, width, depth = 1, material = 'Groove_Dark', smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('engraved_line operation requires a string name');
  if (!Array.isArray(points) || points.length < 2) throw new Error(`${name}.points must contain at least 2 [x, y, z] points`);
  const normalizedPoints = points.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.points[${index}]`));
  const lineWidth = positiveNumber(width, undefined, `${name}.width`);
  const lineDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const vertices = [];
  const faces = [];
  for (let index = 0; index < normalizedPoints.length - 1; index += 1) {
    const start = normalizedPoints[index];
    const end = normalizedPoints[index + 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) throw new Error(`${name}.points[${index}] and points[${index + 1}] must not be identical in XY`);
    const nx = (-dy / length) * (lineWidth / 2);
    const ny = (dx / length) * (lineWidth / 2);
    const z = start[2];
    const base = vertices.length;
    vertices.push(
      [start[0] + nx, start[1] + ny, z], [end[0] + nx, end[1] + ny, z], [end[0] - nx, end[1] - ny, z], [start[0] - nx, start[1] - ny, z],
      [start[0] + nx, start[1] + ny, z - lineDepth], [end[0] + nx, end[1] + ny, z - lineDepth], [end[0] - nx, end[1] - ny, z - lineDepth], [start[0] - nx, start[1] - ny, z - lineDepth]
    );
    faces.push([base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]);
  }
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform });
  model.groups[model.groups.length - 1].kind = 'engraved_line';
}

export function addTextEmboss(model, operation) {
  const { name, material = 'Text_Emboss', smooth = 'coplanar', transform } = operation;
  const marker = textMarkerMesh(operation, `${name || 'text_emboss'}`, 1);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices: marker.vertices, faces: marker.faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'text_emboss';
  group.glyphs = marker.glyphs;
}

export function addTextEngrave(model, operation) {
  const { name, material = 'Text_Engrave_Dark', smooth = 'coplanar', transform } = operation;
  const marker = textMarkerMesh(operation, `${name || 'text_engrave'}`, -1);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices: marker.vertices, faces: marker.faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'text_engrave';
  group.glyphs = marker.glyphs;
}

export function addText3d(model, operation) {
  const { name, material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('text_3d operation requires a string name');
  const spec = normalizeText3dSpec(operation);
  const materialName = ensureMaterial(model, material);
  const localBox = text3dLocalBox(spec);
  const vertices = boxVertices(localBox.origin, localBox.size);
  const transformedVertices = applyTransform(vertices, { transform }, name);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'text_3d',
    faces: spec.filled ? Math.max(1, spec.glyphs) * (spec.extrusion > 0 ? 10 : 1) : 0,
    edges: Math.max(1, spec.glyphs) * (spec.extrusion > 0 ? 24 : 8),
    material: materialName,
    transform: normalizeTransform(operation, name),
    bounding_box: boundingBoxForVertices(transformedVertices),
    attributes: { Text3D: text3dAttributeSnapshot(spec) },
    qa: normalizeQaMetadata(operation.qa)
  });
}

function textMarkerMesh(operation, fieldPrefix, direction) {
  const { name, text } = operation;
  if (!name || typeof name !== 'string') throw new Error(`${direction > 0 ? 'text_emboss' : 'text_engrave'} operation requires a string name`);
  if (typeof text !== 'string' || text.length === 0) throw new Error(`${name}.text must be a non-empty string`);
  const anchor = normalizeVector(operation.center ?? operation.origin, [0, 0, 0], `${name}.${operation.center ? 'center' : 'origin'}`);
  const glyphHeight = positiveNumber(operation.height, undefined, `${name}.height`);
  const textDepth = positiveNumber(operation.depth, 1, `${name}.depth`);
  const spacing = nonNegativeNumber(operation.spacing, glyphHeight * 0.2, `${name}.spacing`);
  const glyphWidth = positiveNumber(operation.width, glyphHeight * 0.6, `${name}.width`);
  const alignDefault = operation.center ? 'center' : 'left';
  const align = normalizeKeyword(operation.align ?? alignDefault, ['left', 'center', 'right'], `${name}.align`);
  const advances = Array.from(text, () => glyphWidth);
  const totalWidth = advances.reduce((sum, width) => sum + width, 0) + Math.max(0, advances.length - 1) * spacing;
  const startX = align === 'center' ? anchor[0] - totalWidth / 2 : align === 'right' ? anchor[0] - totalWidth : anchor[0];
  const vertices = [];
  const faces = [];
  let cursor = startX;
  let glyphs = 0;
  for (const character of text) {
    if (!/\s/u.test(character)) {
      const z0 = direction > 0 ? anchor[2] : anchor[2] - textDepth;
      const h = textDepth;
      const base = vertices.length;
      vertices.push(...boxVertices([cursor, anchor[1], z0], [glyphWidth, glyphHeight, h]));
      faces.push([base, base + 1, base + 2, base + 3], [base + 4, base + 7, base + 6, base + 5], [base, base + 4, base + 5, base + 1], [base + 1, base + 5, base + 6, base + 2], [base + 2, base + 6, base + 7, base + 3], [base + 3, base + 7, base + 4, base]);
      glyphs += 1;
    }
    cursor += glyphWidth + spacing;
  }
  if (glyphs === 0) throw new Error(`${fieldPrefix}.text must include at least one non-space character`);
  return { vertices, faces, glyphs };
}

function normalizeText3dSpec(operation) {
  const { name } = operation;
  const text = nonEmptyString(operation.text, `${name}.text`);
  const height = positiveNumber(operation.height, undefined, `${name}.height`);
  const extrusion = nonNegativeNumber(operation.extrusion ?? operation.depth, 1, `${name}.extrusion`);
  const tolerance = nonNegativeNumber(operation.tolerance, 0, `${name}.tolerance`);
  const font = nonEmptyString(operation.font ?? 'Arial', `${name}.font`);
  const alignDefault = operation.center ? 'center' : 'left';
  const align = normalizeKeyword(operation.align ?? alignDefault, ['left', 'center', 'right'], `${name}.align`);
  const originField = operation.center ? 'center' : 'origin';
  const anchor = normalizeVector(operation.center ?? operation.origin ?? [0, 0, 0], [0, 0, 0], `${name}.${originField}`);
  const bold = operation.bold === undefined ? false : normalizeBoolean(operation.bold, `${name}.bold`);
  const italic = operation.italic === undefined ? false : normalizeBoolean(operation.italic, `${name}.italic`);
  const filled = operation.filled === undefined ? true : normalizeBoolean(operation.filled, `${name}.filled`);
  const glyphs = Array.from(text).filter((character) => !/\s/u.test(character)).length;
  if (glyphs === 0) throw new Error(`${name}.text must include at least one non-space character`);
  return {
    text,
    height,
    extrusion,
    tolerance,
    font,
    align,
    anchor,
    bold,
    italic,
    filled,
    glyphs,
    width: estimateText3dWidth(text, height, bold, italic)
  };
}

function estimateText3dWidth(text, height, bold, italic) {
  const width = Array.from(text).reduce((sum, character) => {
    if (/\s/u.test(character)) return sum + height * 0.35;
    if (/[ilI1.,:;]/u.test(character)) return sum + height * 0.28;
    if (/[MW@#%&]/u.test(character)) return sum + height * 0.85;
    return sum + height * 0.62;
  }, 0);
  return width * (bold ? 1.06 : 1) * (italic ? 1.03 : 1);
}

function text3dLocalBox(spec) {
  const startX = spec.align === 'center'
    ? spec.anchor[0] - spec.width / 2
    : spec.align === 'right'
      ? spec.anchor[0] - spec.width
      : spec.anchor[0];
  const depth = spec.extrusion > 0 ? spec.extrusion : 0.01;
  return {
    origin: [startX, spec.anchor[1], spec.anchor[2]],
    size: [spec.width, spec.height, depth]
  };
}

function text3dAttributeSnapshot(spec) {
  return {
    text: spec.text,
    font: spec.font,
    align: spec.align,
    bold: spec.bold,
    italic: spec.italic,
    filled: spec.filled,
    height: spec.height,
    extrusion: spec.extrusion,
    tolerance: spec.tolerance,
    glyphs: spec.glyphs,
    mock_bounds: true
  };
}

export function addSlot(model, operation) {
  const { name, center = operation.origin, length, width, depth, segments = 8, material = 'Slot_Dark', smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('slot operation requires a string name');
  const slotLength = positiveNumber(length, undefined, `${name}.length`);
  const slotWidth = positiveNumber(width, undefined, `${name}.width`);
  if (slotLength < slotWidth) throw new Error(`${name}.length must be greater than or equal to width`);
  addRecess(model, { ...objectIdentityFields(operation), name, center, size: [slotLength, slotWidth], depth, radius: slotWidth / 2, segments, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'slot';
}

export function addSlotArray(model, operation) {
  const { name, center, origin, count, spacing, length, width, depth, direction = 'x', segments = 8, material = 'Slot_Dark', smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('slot_array operation requires a string name');
  const slotCount = integerInRange(count, 1, 500, `${name}.count`);
  const slotSpacing = positiveNumber(spacing, undefined, `${name}.spacing`);
  const slotLength = positiveNumber(length, undefined, `${name}.length`);
  const slotWidth = positiveNumber(width, undefined, `${name}.width`);
  const slotDepth = positiveNumber(depth, undefined, `${name}.depth`);
  if (slotLength < slotWidth) throw new Error(`${name}.length must be greater than or equal to width`);
  if (!['x', 'y'].includes(direction)) throw new Error(`${name}.direction must be x or y`);
  const n = integerInRange(segments, 1, 16, `${name}.segments`);
  const anchor = center !== undefined
    ? normalizeVector(center, [0, 0, 0], `${name}.center`)
    : normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const startOffset = center !== undefined ? -((slotCount - 1) * slotSpacing) / 2 : 0;
  const materialName = ensureMaterial(model, material);
  const boxes = [];
  const slotPointCount = roundedRectPoints(0, 0, direction === 'x' ? slotLength : slotWidth, direction === 'x' ? slotWidth : slotLength, slotWidth / 2, n).length;
  const slotFaces = slotPointCount + 1;
  const slotEdges = slotPointCount * 3;
  for (let index = 0; index < slotCount; index += 1) {
    const offset = startOffset + index * slotSpacing;
    const slotCenter = direction === 'x'
      ? [anchor[0] + offset, anchor[1], anchor[2]]
      : [anchor[0], anchor[1] + offset, anchor[2]];
    boxes.push(slotBox(slotCenter, slotLength, slotWidth, slotDepth, direction));
  }
  const corners = boxes.flatMap((box) => boxVertices(box.origin, box.size));
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'slot_array',
    faces: slotFaces * slotCount,
    edges: slotEdges * slotCount,
    material: materialName,
    transform: normalizeTransform(operation, name),
    count: slotCount,
    direction,
    segments: n,
    bounding_box: boundingBoxForVertices(applyTransform(corners, { transform }, name))
  });
}

export function addImagePlane(model, operation) {
  const { name, origin = [0, 0, 0], plane = 'xy', size, material, image, texture, alpha, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('image_plane operation requires a string name');
  if (!['xy', 'xz', 'yz'].includes(plane)) throw new Error(`${name}.plane must be one of xy, xz, yz`);
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const normalizedSize = normalizeSize2(size, `${name}.size`);
  const width = positiveNumber(normalizedSize[0], undefined, `${name}.size[0]`);
  const height = positiveNumber(normalizedSize[1], undefined, `${name}.size[1]`);
  const imagePath = image ?? texture;
  const materialSpec = material ?? (imagePath !== undefined
    ? { name: `${name}_Image_Material`, color: '#ffffff', alpha, texture: { path: imagePath, width, height } }
    : { name: `${name}_Plane_Material`, color: '#ffffff', alpha });
  const materialName = ensureMaterial(model, materialSpec);
  const textureTransform = operation.texture_transform !== undefined
    ? normalizeTextureTransform(operation.texture_transform, `${name}.texture_transform`)
    : null;
  const vertices = profilePlaneVertices(normalizedOrigin, plane, [[0, 0], [width, 0], [width, height], [0, height]]);
  const transformedVertices = applyTransform(vertices, { transform }, name);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'image_plane',
    faces: 1,
    edges: 4,
    material: materialName,
    texture_transform: textureTransform,
    image: imagePath !== undefined ? nonEmptyString(imagePath, `${name}.image`) : null,
    plane,
    transform: normalizeTransform(operation, name),
    bounding_box: boundingBoxForVertices(transformedVertices),
    _vertices: transformedVertices,
    _orientation: identityMatrix3()
  });
}

export function addRib(model, operation) {
  const { name, origin = [0, 0, 0], length, height, thickness, direction = 'x', material, transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('rib operation requires a string name');
  const ribLength = positiveNumber(length, undefined, `${name}.length`);
  const ribHeight = positiveNumber(height, undefined, `${name}.height`);
  const ribThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  if (!['x', 'y'].includes(direction)) throw new Error(`${name}.direction must be x or y`);
  const size = direction === 'x' ? [ribLength, ribThickness, ribHeight] : [ribThickness, ribLength, ribHeight];
  addBox(model, { ...objectIdentityFields(operation), name, origin, size, material, transform });
  model.groups[model.groups.length - 1].kind = 'rib';
}

export function addStandoffBoss(model, operation) {
  const { name, center = operation.origin, outer_radius, outerRadius, inner_radius, innerRadius, height, segments = 16, material, hole_material, holeMaterial = 'Slot_Dark', smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('standoff_boss operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const outer = positiveNumber(outer_radius ?? outerRadius, undefined, `${name}.outer_radius`);
  const inner = positiveNumber(inner_radius ?? innerRadius, undefined, `${name}.inner_radius`);
  const bossHeight = positiveNumber(height, undefined, `${name}.height`);
  if (inner >= outer) throw new Error(`${name}.inner_radius must be smaller than outer_radius`);
  const n = integerInRange(segments, 3, 96, `${name}.segments`);
  const materialName = ensureMaterial(model, material);
  ensureMaterial(model, hole_material ?? holeMaterial);
  const corners = boxVertices([x - outer, y - outer, z], [outer * 2, outer * 2, bossHeight]);
  const id = objectId(operation, name);
  assertObjectIdentityAvailable(model, { id, name });
  model.groups.push({
    id,
    name,
    kind: 'standoff_boss',
    faces: (3 * n - 4) * 2,
    edges: (5 * n - 6) * 2,
    material: materialName,
    transform: normalizeTransform(operation, name),
    segments: n,
    bounding_box: boundingBoxForVertices(applyTransform(corners, { transform }, name))
  });
}

export function addButtonOnPanel(model, operation) {
  const { name, center = operation.origin, size, radius, height, segments = 16, material, smooth = 'all', qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('button_on_panel operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const h = positiveNumber(height, undefined, `${name}.height`);
  const n = integerInRange(segments, 3, 96, `${name}.segments`);
  if (size !== undefined) {
    const [w, d] = normalizePlanSize(size, `${name}.size`);
    const cornerRadius = operation.corner_radius ?? operation.cornerRadius ?? Math.min(w, d) / 2;
    const r = Math.min(nonNegativeNumber(cornerRadius, 0, `${name}.corner_radius`), w / 2, d / 2);
    addRoundedBox(model, { ...objectIdentityFields(operation), name, origin: [x - w / 2, y - d / 2, z], size: [w, d, h], radius: r, segments: n, material, smooth, transform: operation.transform, qa });
  } else {
    addCylinder(model, { ...objectIdentityFields(operation), name, origin: [x, y, z], radius, height: h, segments: n, material, smooth, transform: operation.transform, qa });
  }
  const group = model.groups[model.groups.length - 1];
  group.kind = 'button_on_panel';
  group.segments = n;
}

function slotBox(center, length, width, depth, direction) {
  const [x, y, z] = center;
  const size = direction === 'x' ? [length, width, depth] : [width, length, depth];
  return { origin: [x - size[0] / 2, y - size[1] / 2, z - depth], size };
}

function addFootprintExtrusionMesh(model, operation, points, z, height, smooth) {
  const bottom = points.map(([px, py]) => [px, py, z]);
  const top = points.map(([px, py]) => [px, py, z + height]);
  const vertices = [...bottom, ...top];
  const count = points.length;
  const faces = [
    Array.from({ length: count }, (_, index) => index),
    Array.from({ length: count }, (_, index) => count + count - 1 - index)
  ];
  for (let index = 0; index < count; index += 1) {
    faces.push([index, (index + 1) % count, count + ((index + 1) % count), count + index]);
  }
  addMesh(model, { ...operation, vertices, faces, smooth });
}

function roundedRectPoints(x, y, width, depth, radius, segments) {
  if (radius <= 0) {
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]];
  }
  const corners = [
    { cx: x + width - radius, cy: y + radius, start: -Math.PI / 2, end: 0 },
    { cx: x + width - radius, cy: y + depth - radius, start: 0, end: Math.PI / 2 },
    { cx: x + radius, cy: y + depth - radius, start: Math.PI / 2, end: Math.PI },
    { cx: x + radius, cy: y + radius, start: Math.PI, end: Math.PI * 1.5 }
  ];
  const points = [];
  for (const corner of corners) {
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const angle = corner.start + (corner.end - corner.start) * t;
      points.push([corner.cx + radius * Math.cos(angle), corner.cy + radius * Math.sin(angle)]);
    }
  }
  return dedupePlanPoints(points);
}

function dedupePlanPoints(points) {
  const unique = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 1e-9) unique.push(point);
  }
  if (unique.length > 1) {
    const first = unique[0];
    const last = unique[unique.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-9) unique.pop();
  }
  return unique;
}

function beveledRectPoints(x, y, width, depth, bevel) {
  if (bevel <= 0) {
    return [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]];
  }
  return [
    [x + bevel, y],
    [x + width - bevel, y],
    [x + width, y + bevel],
    [x + width, y + depth - bevel],
    [x + width - bevel, y + depth],
    [x + bevel, y + depth],
    [x, y + depth - bevel],
    [x, y + bevel]
  ];
}
