import assert from 'node:assert/strict';
import { evaluateDetailQuality, freezeDetailSpecification } from '../src/detail-quality.mjs';

const summary = (id = 'top', pid = '44981', extra = {}) => ({ id, persistent_id: pid, visible: true, faces: 6, ...extra });
const occurrence = (id = 'top', pid = '44981', extra = {}) => ({
  id, part_id: id, entity_path: id, instance_path: [id], persistent_path: [pid], visible: true,
  geometry_evidence: { source: 'sketchup_runtime', measured: true, complete: true,
    face_count: 6, visible_face_count: 6, bounds_mm: { size: [1200, 600, 30] }, closed_solid: true },
  ...extra
});
const requirement = { id: 'top', min_faces: 6, require_visible: true, bounds_mm: { size: [1200, 600, 30], tolerance_mm: 0.1 } };
function evaluate(snapshot, parts = [requirement], options = {}) {
  return evaluateDetailQuality({ snapshot, frozenSpecification: freezeDetailSpecification({ version: 1, required_parts: parts }),
    runtime: 'queue', trustedSnapshot: true, ...options });
}
function expectIssue(snapshot, type, parts, options) {
  const result = evaluate(snapshot, parts, options);
  assert.equal(result.quality_accepted, false);
  assert.ok(result.issues.some(issue => issue.type === type), JSON.stringify(result));
}

const native = { groups: [summary()], geometry_occurrences: [occurrence()] };
const before = structuredClone(native);
assert.equal(evaluate(native).quality_accepted, true);
assert.equal(evaluate(native).measured_parts, 1);
assert.deepEqual(native, before, 'evaluation must not mutate its input');
assert.equal(evaluate(native, [{ ...requirement, instance_path: ['top'] }]).quality_accepted, true);
assert.equal(evaluate({ instances: [summary('', '41159')], geometry_occurrences: [occurrence('pid:41159', '41159')] },
  [{ ...requirement, id: 'pid:41159' }]).quality_accepted, true, 'anonymous components use a native PID fallback');

// Same logical paths do not establish that two records refer to one entity.
expectIssue({ groups: [summary(), summary('top', '44982')], geometry_occurrences: [occurrence(), occurrence('top', '44982')] }, 'detail.part_ambiguous');
expectIssue({ groups: [summary(), summary()], geometry_occurrences: [occurrence()] }, 'detail.part_ambiguous');
expectIssue({ groups: [summary()], geometry_occurrences: [occurrence(), occurrence()] }, 'detail.part_ambiguous');
expectIssue({ groups: [summary()], geometry_occurrences: [occurrence('other')] }, 'detail.measured_geometry_unavailable', [{ ...requirement, require_visible: false }]);
for (const pid of [undefined, null, '', '0', '044981', 44981, '44981x']) {
  expectIssue({ groups: [summary('top', '44981', { persistent_id: pid })], geometry_occurrences: [occurrence('top', '44981', { persistent_path: [pid] })] }, 'detail.part_ambiguous');
}
assert.equal(evaluate({ groups: [summary('top', '9007199254740993')], geometry_occurrences: [occurrence('top', '9007199254740993')] }).quality_accepted, true);
expectIssue({ groups: [summary('top', '9007199254740992')], geometry_occurrences: [occurrence('top', '9007199254740993')] }, 'detail.part_ambiguous');

const nested = occurrence('top', '44981', { instance_path: ['assembly', 'top'], persistent_path: ['123', '44981'], entity_path: 'assembly/top' });
expectIssue({ groups: [summary()], geometry_occurrences: [nested] }, 'detail.part_ambiguous');
const shared = { geometry_occurrences: [nested, { ...nested, instance_path: ['other', 'top'], persistent_path: ['124', '44981'], entity_path: 'other/top' }] };
expectIssue(shared, 'detail.part_ambiguous');
assert.equal(evaluate(shared, [{ ...requirement, instance_path: ['assembly', 'top'] }]).quality_accepted, true);

// Coalescing does not manufacture evidence or erase hidden/destructive repair vetoes.
for (const evidence of [undefined, { ...occurrence().geometry_evidence, measured: false },
  { ...occurrence().geometry_evidence, complete: false }, { ...occurrence().geometry_evidence, source: 'mock_runtime' }]) {
  expectIssue({ groups: [summary('top', '44981', { geometry_evidence: occurrence().geometry_evidence })], geometry_occurrences: [occurrence('top', '44981', { geometry_evidence: evidence })] },
    'detail.measured_geometry_unavailable', [{ ...requirement, require_visible: false }]);
}
for (const extra of [{ visible: false }, { hidden: true }]) {
  expectIssue({ groups: [summary('top', '44981', extra)], geometry_occurrences: [occurrence()] }, 'detail.required_geometry_hidden');
}
for (const extra of [{ repair_strategy: 'seal_bbox' }, { manifold: { repair_strategy: 'seal_bbox' } },
  { repair_history: [{ strategy: 'seal_bbox' }] }, { geometry_evidence: { repair_strategy: 'seal_bbox' } }]) {
  expectIssue({ groups: [summary('top', '44981', extra)], geometry_occurrences: [occurrence()] }, 'detail.bounding_box_repair_forbidden');
}
expectIssue({ groups: [summary()], geometry_occurrences: [occurrence('top', '44981', { geometry_evidence: { ...occurrence().geometry_evidence, repair_strategies: ['seal_bbox'] } })] }, 'detail.bounding_box_repair_forbidden');
expectIssue(native, 'detail.measured_geometry_unavailable', [{ ...requirement, require_visible: false }], { trustedSnapshot: false });
const mock = { groups: [{ ...occurrence(), geometry_evidence: { ...occurrence().geometry_evidence, source: 'mock_runtime' } }] };
assert.equal(evaluate(mock, [requirement], { runtime: 'mock' }).quality_accepted, true);
assert.equal(evaluate(mock, [requirement], { runtime: 'mock' }).evidence_level, 'offline_mock');
assert.equal(evaluate({ geometry_occurrences: [occurrence()] }).quality_accepted, true);
console.log('Detail quality native entity identity and evidence guards passed.');
