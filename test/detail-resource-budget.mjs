import assert from 'node:assert/strict';
import { freezeDetailSpecification, evaluateDetailQuality } from '../src/detail-quality.mjs';

const base = { version: 1, required_parts: [{ id: 'part', min_faces: 6 }] };
const frozen = freezeDetailSpecification({ ...base, resource_budget: { max_faces: 100, max_edges: 200, max_vertices: 150 } });
const snapshot = { model_revision: 'synthetic-measured-budget-revision', model_revision_complete: true,
  totals: { faces: 1, edges: 1, vertices: 1 },
  resource_totals: { faces: 100, edges: 200, vertices: 150, complete: true, scope: 'all_native_stored_geometry' },
  groups: [{ id: 'part', geometry_evidence: { source: 'sketchup_runtime', measured: true, face_count: 6 } }] };
const evaluate = (value, overrides = {}) => evaluateDetailQuality({ snapshot: value, runtime: 'queue', trustedSnapshot: true, frozenSpecification: frozen, ...overrides });
const accepted = evaluate(snapshot);
assert.equal(accepted.quality_accepted, true);
assert.deepEqual(accepted.resource_costs.counts, { faces: 100, edges: 200, vertices: 150 });
assert.equal(accepted.resource_costs.meaning, 'resource_cost_not_detail_score');
assert.equal(accepted.resource_costs.model_revision, snapshot.model_revision);
for (const metric of ['faces', 'edges', 'vertices']) {
  const exceeded = structuredClone(snapshot); exceeded.resource_totals[metric]++;
  const result = evaluate(exceeded);
  assert.equal(result.quality_accepted, false);
  assert.equal(result.quality_status, 'fail');
  assert.ok(result.issues.some(issue => issue.type === 'quality.resource_budget_exceeded' && issue.resource === metric && issue.actual === exceeded.resource_totals[metric]));
  for (const missing of [undefined, null, '100', -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const unavailable = structuredClone(snapshot); unavailable.resource_totals[metric] = missing;
    const unchecked = evaluate(unavailable);
    assert.equal(unchecked.quality_status, 'unverified');
    assert.equal(unchecked.resource_costs.counts[metric], null);
  }
}
for (const changed of [
  { ...snapshot, model_revision: null },
  { ...snapshot, model_revision: '' },
  { ...snapshot, model_revision_complete: false },
  { ...snapshot, model_revision_complete: undefined },
  { ...snapshot, resource_totals: undefined },
  { ...snapshot, resource_totals: { ...snapshot.resource_totals, complete: false } },
  { ...snapshot, resource_totals: { ...snapshot.resource_totals, scope: 'visible_geometry' } }
]) assert.equal(evaluate(changed).quality_status, 'unverified');
assert.equal(evaluate(snapshot, { runtime: 'mock' }).quality_status, 'unverified', 'mock counts never attest the complete native stored geometry cost');
assert.equal(evaluate(snapshot, { trustedSnapshot: false }).quality_accepted, false);
assert.ok(evaluate(snapshot, { trustedSnapshot: false }).issues.some(issue => issue.type === 'quality.resource_budget_unverified'));
assert.equal(evaluate(snapshot, { trustedSnapshot: false }).resource_costs.model_revision, null);
for (const budget of [{}, { max_faces: 0 }, { max_edges: -1 }, { max_vertices: 2.5 }, { max_faces: '100' }, { max_faces: Number.MAX_SAFE_INTEGER + 1 }, { max_triangles: 10 }, []]) {
  assert.throws(() => freezeDetailSpecification({ ...base, resource_budget: budget }), /resource_budget/);
}
assert.throws(() => freezeDetailSpecification({ ...frozen.specification, resource_budget: { max_faces: 1000, max_edges: 200, max_vertices: 150 } }, frozen), /frozen/);
assert.throws(() => freezeDetailSpecification(base, frozen), /frozen/, 'a refinement cannot remove a frozen resource ceiling');
const legacy = evaluate({ ...snapshot, resource_totals: undefined, model_revision: undefined, model_revision_complete: undefined }, { frozenSpecification: freezeDetailSpecification(base) });
assert.equal(legacy.quality_accepted, true, 'no budget preserves existing measured geometry acceptance behavior');
assert.equal(legacy.resource_costs, undefined);
const lowerCost = structuredClone(snapshot); Object.assign(lowerCost.resource_totals, { faces: 6, edges: 12, vertices: 8 });
lowerCost.groups[0].geometry_evidence.face_count = 4;
assert.equal(evaluate(lowerCost).quality_status, 'fail', 'low resource cost cannot compensate for missing geometry detail');
console.log('detail-resource-budget: trusted revision-bound costs, three ceilings, missing getters, frozen limits and legacy behavior passed (synthetic offline receipts)');
