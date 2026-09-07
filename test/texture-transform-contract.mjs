import assert from 'node:assert/strict';
import { normalizeTextureTransform } from '../src/object-operation-utils.mjs';
import { validateExistingModelEditOperations } from '../src/existing-model-editing.mjs';
const normalize = value => normalizeTextureTransform(value, 'texture_transform');
assert.deepEqual(normalize({ texture_size_mm: [1200, 180], scale: [3, 2], rotation: 90, side: 'both', face_selector: 2 }),
  { projection: 'planar', offset: [0, 0], scale: [3, 2], rotation: 90, texture_size_mm: [1200, 180], side: 'both', face_selector: { type: 'index', value: 2 } });
for (const value of [{ scale: [0, 1] }, { scale: [-1, 1] }, { texture_size_mm: [1, 0] }, { side: 'left' }, { face_selector: -1 }, { face_selector: 1.5 }, { face_selector: { type: 'recursive' } }, { projection: 'cylindrical' }]) assert.throws(() => normalize(value));
for (const projection of ['cylindrical', 'spherical', 'custom']) assert.throws(() => validateExistingModelEditOperations([{ op: 'texture_transform', target_id: 'board', projection }]), /planar.*box/);
assert.equal(validateExistingModelEditOperations([{ op: 'texture_transform', target_id: 'board', projection: 'box', texture_size_mm: [1200, 180] }]).risk_level, 'S1');
console.log('texture transform contract: passed (native mapping is verified by separate Ruby tests)');
