import { findModelObject, referenceLabel, resolveObjectReference } from './object-identity.mjs';
import { finiteNumber, integerInRange, normalizeBoolean, normalizeKeyword, normalizePlanSize, positiveNumber } from './operation-utils.mjs';
import { mergeBoundingBoxes } from './snapshot.mjs';

const ALLOWED_TARGET_KINDS = new Set(['box', 'rounded_box', 'panel_with_openings', 'boolean_cutout', 'floor_slab', 'wall']);

const FACE_SPECS = {
  top: { axes: [0, 1], normalAxis: 2, outward: 1, surface: 'max' },
  bottom: { axes: [0, 1], normalAxis: 2, outward: -1, surface: 'min' },
  front: { axes: [0, 2], normalAxis: 1, outward: -1, surface: 'min' },
  back: { axes: [0, 2], normalAxis: 1, outward: 1, surface: 'max' },
  left: { axes: [1, 2], normalAxis: 0, outward: -1, surface: 'min' },
  right: { axes: [1, 2], normalAxis: 0, outward: 1, surface: 'max' }
};

export function cutHole(model, operation) {
  const context = featureContext(model, operation, 'cut_hole');
  const radius = positiveNumber(operation.radius, undefined, 'cut_hole.radius');
  const segments = integerInRange(operation.segments ?? 24, 8, 96, 'cut_hole.segments');
  validateFeatureFits(context, radius * 2, radius * 2, 'cut_hole');
  const through = operation.through === undefined ? true : normalizeBoolean(operation.through, 'cut_hole.through');
  const depth = through ? context.thickness : positiveNumber(operation.depth, undefined, 'cut_hole.depth');
  recordFeature(context, {
    op: 'cut_hole',
    id: featureId(operation, context),
    face: context.face,
    center: context.center,
    radius,
    depth,
    through,
    segments,
    method: 'face_pushpull'
  });
  mutateTopology(context.item, segments, segments * 2);
}

export function cutSlot(model, operation) {
  const context = featureContext(model, operation, 'cut_slot');
  const length = positiveNumber(operation.length, undefined, 'cut_slot.length');
  const width = positiveNumber(operation.width, undefined, 'cut_slot.width');
  if (length < width) throw new Error('cut_slot.length must be greater than or equal to width');
  const segments = integerInRange(operation.segments ?? 12, 4, 48, 'cut_slot.segments');
  validateFeatureFits(context, length, width, 'cut_slot');
  const through = operation.through === undefined ? true : normalizeBoolean(operation.through, 'cut_slot.through');
  const depth = through ? context.thickness : positiveNumber(operation.depth, undefined, 'cut_slot.depth');
  const edges = roundedRectEdgeCount(width / 2, segments);
  recordFeature(context, {
    op: 'cut_slot',
    id: featureId(operation, context),
    face: context.face,
    center: context.center,
    length,
    width,
    depth,
    through,
    segments,
    method: 'face_pushpull'
  });
  mutateTopology(context.item, edges, edges * 2);
}

export function cutRecess(model, operation) {
  const context = featureContext(model, operation, 'cut_recess');
  const [width, depthSize] = normalizePlanSize(operation.size, 'cut_recess.size');
  const depth = positiveNumber(operation.depth, undefined, 'cut_recess.depth');
  const radius = Math.min(finiteNonNegative(operation.radius ?? 0, 'cut_recess.radius'), width / 2, depthSize / 2);
  const segments = integerInRange(operation.segments ?? 8, 1, 48, 'cut_recess.segments');
  validateFeatureFits(context, width, depthSize, 'cut_recess');
  const edges = roundedRectEdgeCount(radius, segments);
  recordFeature(context, {
    op: 'cut_recess',
    id: featureId(operation, context),
    face: context.face,
    center: context.center,
    size: [width, depthSize],
    radius,
    depth,
    through: false,
    segments,
    method: 'face_pushpull'
  });
  mutateTopology(context.item, edges + 1, edges * 2);
}

export function addBoss(model, operation) {
  const context = featureContext(model, operation, 'add_boss');
  const radius = positiveNumber(operation.radius ?? operation.outer_radius ?? operation.outerRadius, undefined, 'add_boss.radius');
  const height = positiveNumber(operation.height, undefined, 'add_boss.height');
  const segments = integerInRange(operation.segments ?? 24, 8, 96, 'add_boss.segments');
  validateFeatureFits(context, radius * 2, radius * 2, 'add_boss');
  recordFeature(context, {
    op: 'add_boss',
    id: featureId(operation, context),
    face: context.face,
    center: context.center,
    radius,
    height,
    segments,
    method: 'face_pushpull'
  });
  mutateTopology(context.item, segments + 1, segments * 2);
  extendFeatureBounds(context, radius * 2, radius * 2, height);
}

export function addRaisedRib(model, operation) {
  const context = featureContext(model, operation, 'add_raised_rib');
  const length = positiveNumber(operation.length, undefined, 'add_raised_rib.length');
  const width = positiveNumber(operation.width ?? operation.thickness, undefined, 'add_raised_rib.width');
  const height = positiveNumber(operation.height, undefined, 'add_raised_rib.height');
  const direction = normalizeKeyword(operation.direction ?? 'u', ['u', 'v'], 'add_raised_rib.direction');
  const size = direction === 'u' ? [length, width] : [width, length];
  validateFeatureFits(context, size[0], size[1], 'add_raised_rib');
  recordFeature(context, {
    op: 'add_raised_rib',
    id: featureId(operation, context),
    face: context.face,
    center: context.center,
    length,
    width,
    height,
    direction,
    method: 'face_pushpull'
  });
  mutateTopology(context.item, 5, 12);
  extendFeatureBounds(context, size[0], size[1], height);
}

function featureContext(model, operation, opName) {
  const reference = resolveObjectReference(operation, opName);
  const target = findModelObject(model, reference);
  const item = target.item;
  if (!ALLOWED_TARGET_KINDS.has(item.kind)) {
    throw new Error(`${opName} supports box, rounded_box, panel_with_openings, boolean_cutout, floor_slab, and wall targets; got ${item.kind || 'unknown'} for ${referenceLabel(reference)}`);
  }
  const baseBounds = ensureFeatureBaseBoundingBox(item);
  const face = normalizeFace(operation.face ?? operation.plane, opName);
  const spec = FACE_SPECS[face];
  const center = normalizeFeatureCenter(operation.center, baseBounds, spec, `${opName}.center`);
  const extents = faceExtents(baseBounds, spec);
  return {
    reference,
    item,
    face,
    spec,
    center,
    extents,
    baseBounds,
    thickness: Math.max(0, baseBounds.max[spec.normalAxis] - baseBounds.min[spec.normalAxis])
  };
}

function normalizeFace(value, opName) {
  const raw = value ?? 'top';
  const aliases = { xy: 'top', xz: 'front', yz: 'left' };
  const normalized = String(raw).trim().toLowerCase().replaceAll('-', '_');
  const face = aliases[normalized] || normalized;
  if (!FACE_SPECS[face]) throw new Error(`${opName}.face must be one of top, bottom, front, back, left, right`);
  return face;
}

function normalizeFeatureCenter(value, bbox, spec, fieldName) {
  if (!Array.isArray(value) || ![2, 3].includes(value.length)) throw new Error(`${fieldName} must be [u, v] or [x, y, z]`);
  const numbers = value.map((item, index) => finiteNumber(item, undefined, `${fieldName}[${index}]`));
  if (numbers.length === 2) return numbers;
  return spec.axes.map((axis) => numbers[axis] - bbox.min[axis]);
}

function faceExtents(bbox, spec) {
  return spec.axes.map((axis) => bbox.max[axis] - bbox.min[axis]);
}

function validateFeatureFits(context, width, height, opName) {
  const half = [width / 2, height / 2];
  for (let axis = 0; axis < 2; axis += 1) {
    if (context.center[axis] - half[axis] < -1e-9 || context.center[axis] + half[axis] > context.extents[axis] + 1e-9) {
      throw new Error(`${opName} feature footprint must fit inside target ${context.face} face bounds`);
    }
  }
}

function recordFeature(context, feature) {
  context.item.features ||= [];
  context.item.features.push({
    ...feature,
    target_id: context.item.id || context.item.name,
    target_name: context.item.name
  });
}

function featureId(operation, context) {
  return String(operation.feature_id ?? operation.featureId ?? `${context.item.name}_${operation.op}_${(context.item.features || []).length + 1}`);
}

function mutateTopology(item, facesDelta, edgesDelta) {
  item.faces += facesDelta;
  item.edges += edgesDelta;
}

function extendFeatureBounds(context, width, height, outwardDepth) {
  const bbox = context.item.bounding_box;
  const baseBounds = context.baseBounds;
  const min = [...bbox.min];
  const max = [...bbox.max];
  const center = context.center;
  context.spec.axes.forEach((axis, index) => {
    const localMin = baseBounds.min[axis] + center[index] - (index === 0 ? width : height) / 2;
    const localMax = baseBounds.min[axis] + center[index] + (index === 0 ? width : height) / 2;
    min[axis] = Math.min(min[axis], localMin);
    max[axis] = Math.max(max[axis], localMax);
  });
  const normalAxis = context.spec.normalAxis;
  const surface = context.spec.surface === 'max' ? baseBounds.max[normalAxis] : baseBounds.min[normalAxis];
  if (context.spec.outward > 0) max[normalAxis] = Math.max(max[normalAxis], surface + outwardDepth);
  else min[normalAxis] = Math.min(min[normalAxis], surface - outwardDepth);
  context.item.bounding_box = mergeBoundingBoxes([{ min, max }]);
}

function ensureFeatureBaseBoundingBox(item) {
  item._feature_base_bounding_box ||= structuredClone(item.bounding_box);
  return item._feature_base_bounding_box;
}

function roundedRectEdgeCount(radius, segments) {
  return radius > 0 ? 4 * (segments + 1) : 4;
}

function finiteNonNegative(value, fieldName) {
  const number = finiteNumber(value, undefined, fieldName);
  if (number < 0) throw new Error(`${fieldName} must be non-negative`);
  return number;
}
