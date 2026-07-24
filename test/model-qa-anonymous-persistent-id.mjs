import assert from 'node:assert/strict';
import { validateModelSnapshot } from '../src/model-qa.mjs';

const anonymous = {
  id: '',
  name: '',
  persistent_id: '89455',
  visible: true,
  bounding_box: { min: [0, 0, 0], max: [10, 10, 10], w: 10, d: 10, h: 10 }
};
const head = {
  id: 'tripod-head',
  name: 'Tripod_Head',
  visible: true,
  bounding_box: { min: [5, 5, 5], max: [15, 15, 15], w: 10, d: 10, h: 10 },
  qa: {
    expected_contacts: [{
      with: 'pid:89455',
      bucket: 'intentional_assembly_joint',
      note: 'Reviewed physical joint.'
    }]
  }
};

const recovered = validateModelSnapshot({
  groups: [anonymous, head],
  warnings: [{
    type: 'geometry.bbox_overlap',
    severity: 'warn',
    category: 'geometry',
    message: 'Bounding boxes overlap:  intersects Tripod_Head',
    source: 'group:;Tripod_Head'
  }]
}, { includePreview: false });

assert.equal(recovered.ok, true);
assert.equal(recovered.verdict, 'pass');
assert.equal(recovered.issues.length, 0);
assert.equal(recovered.accepted_warnings.length, 1);
assert.deepEqual(recovered.accepted_warnings[0].pair, ['pid:89455', 'Tripod_Head']);

const ambiguous = validateModelSnapshot({
  groups: [
    anonymous,
    { ...anonymous, persistent_id: '89456' },
    head
  ],
  warnings: [{
    type: 'geometry.bbox_overlap',
    severity: 'warn',
    category: 'geometry',
    message: 'Bounding boxes overlap:  intersects Tripod_Head',
    source: 'group:;Tripod_Head'
  }]
}, { includePreview: false });

assert.equal(ambiguous.ok, false);
assert.equal(ambiguous.verdict, 'fail');
assert.equal(ambiguous.issues.length, 1);
assert.equal(ambiguous.accepted_warnings.length, 0);

process.stdout.write(`${JSON.stringify({
  ok: true,
  persistent_id_recovery: true,
  ambiguous_recovery_fails_closed: true
}, null, 2)}\n`);
