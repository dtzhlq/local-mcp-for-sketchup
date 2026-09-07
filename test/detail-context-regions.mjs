import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freezeDetailSpecification, evaluateDetailQuality } from '../src/detail-quality.mjs';
import { AgentGateway } from '../src/agent-gateway.mjs';
import { AgentTaskStore } from '../src/agent-task-store.mjs';

// These receipts are synthetic service fixtures. Actual geometric obstruction
// and containment are independently covered by the Ruby native-getter tests.
const specification = {
  version: 1,
  required_parts: [{ id: 'leaf', instance_path: ['wall', 'leaf'], min_faces: 6 }],
  required_voids: [{ id: 'door-gap', instance_path: ['wall'], search_scope: 'assembly',
    bounds_mm: { min: [2, 2, 2], max: [98, 28, 198] },
    boundary_checks: [{ side: 'min_x', offset_mm: 5 }, { side: 'max_x', offset_mm: 5 }, { side: 'max_z', offset_mm: 5 }] }]
};
const frozen = freezeDetailSpecification(specification);
const occurrencePathMap = { '["wall"]': ['original_native_root', 'replacement_wall'], '["wall","leaf"]': ['original_native_root', 'replacement_wall', 'replacement_leaf'] };
const snapshot = { model_revision: 'synthetic-revision-1', geometry_occurrences: [{
  part_id: 'replacement_leaf', instance_path: occurrencePathMap['["wall","leaf"]'],
  geometry_evidence: { measured: true, source: 'sketchup_runtime', complete: true, face_count: 6 }
}] };
const query = { ...structuredClone(specification.required_voids[0]), instance_path: occurrencePathMap['["wall"]'] };
const receipt = () => ({ version: 'native-detail-regions.v1', read_only: true, model_revision_complete: true, model_revision: snapshot.model_revision,
  results: [{ ...structuredClone(query), status: 'pass', evidence_source: 'sketchup_runtime', model_revision: snapshot.model_revision,
    boundary_results: query.boundary_checks.map(({ side }) => ({ side, verified: true, status: 'pass' })) }] });
const assess = (raw, overrides = {}) => evaluateDetailQuality({ snapshot, runtime: 'queue', trustedSnapshot: true, frozenSpecification: frozen,
  occurrencePathMap, regionInspection: raw, trustedRegionInspection: true, ...overrides });
assert.equal(assess(receipt()).quality_status, 'pass');
assert.equal(assess(receipt()).measured_voids, 1);
assert.equal(assess(receipt(), { trustedRegionInspection: false }).quality_status, 'unverified', 'a supplied receipt is never evidence');
assert.equal(assess(receipt(), { trustedSnapshot: false }).quality_accepted, false);
for (const mutate of [
  value => { value.model_revision = 'stale'; },
  value => { value.model_revision_complete = false; },
  value => { value.read_only = false; },
  value => { value.results[0].model_revision = 'stale'; },
  value => { value.results[0].instance_path = ['wrong_instance']; },
  value => { value.results[0].bounds_mm.min[0] = 10; },
  value => { value.results[0].search_scope = 'scene'; },
  value => { value.results[0].boundary_checks[0].offset_mm = 500; },
  value => { value.results[0].evidence_source = 'metadata'; },
  value => { value.results.push(structuredClone(value.results[0])); },
  value => { value.results[0].boundary_results.pop(); },
  value => { value.results[0].boundary_results[0].verified = false; }
]) {
  const value = receipt();
  mutate(value);
  assert.equal(assess(value).quality_status, 'unverified', JSON.stringify(value));
}
const blocked = receipt();
blocked.results[0] = { ...blocked.results[0], status: 'fail', reason: 'native_surface_intersects_required_void', blocker_path: ['parent', 'extra_cap'] };
const rejected = assess(blocked);
assert.equal(rejected.quality_status, 'fail');
assert.equal(rejected.remaining[0].part_key, 'void:door-gap');
assert.equal(rejected.remaining[0].void_id, 'door-gap');
assert.deepEqual(rejected.issues[0].blocker_path, ['parent', 'extra_cap']);
const unsupported = receipt();
unsupported.results[0].status = 'unverified';
unsupported.results[0].reason = 'open_or_ambiguous_geometry_surrounds_void';
assert.equal(assess(unsupported).quality_status, 'unverified');

for (const mutate of [
  value => { value.required_voids[0].instance_path = null; },
  value => { value.required_voids[0].bounds_mm.max[0] = 1; },
  value => { value.required_voids[0].bounds_mm.min[0] = Number.NaN; },
  value => { value.required_voids[0].boundary_checks[0].offset_mm = 0; },
  value => { value.required_voids[0].boundary_checks.push(value.required_voids[0].boundary_checks[0]); },
  value => { value.required_voids[0].exclude_instance_paths = [['arbitrary_fill']]; },
  value => { value.required_voids.push(structuredClone(value.required_voids[0])); }
]) {
  const value = structuredClone(specification); mutate(value);
  assert.throws(() => freezeDetailSpecification(value), /INVALID_ARGUMENT|void|Void|bounds|boundaries/);
}
assert.throws(() => freezeDetailSpecification({ ...specification, required_voids: [] }, frozen), /frozen/);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-context-region-contract-'));
try {
  for (const mode of ['valid', 'blocked', 'stale', 'unavailable']) {
    const taskStore = new AgentTaskStore({ rootDir: path.join(root, mode) });
    let calls = 0;
    const bridge = {
      validate_model: async () => ({ ok: true, verdict: 'pass' }),
      withAgentGatewayExecution: async (_context, callback) => callback(bridge),
      inspect_detail_regions: async request => {
        calls++;
        assert.equal(request.runtime, 'queue');
        assert.deepEqual(request.queries, [query], 'only frozen query parameters and the trusted occurrence map may be submitted');
        if (mode === 'unavailable') throw new Error('private native diagnostic: unavailable');
        if (mode === 'blocked') return blocked;
        const raw = receipt();
        if (mode === 'stale') raw.model_revision = 'old-revision';
        return raw;
      }
    };
    const gateway = new AgentGateway({ bridge, taskStore });
    let { task } = await taskStore.createTask({ intent: 'create_model', instruction: 'Synthetic native void service fixture', inputs: {
      queries: [{ id: 'door-gap', bounds_mm: { min: [1000,1000,1000], max: [1001,1001,1001] } }], region_inspection: receipt()
    } });
    task = await taskStore.transition(task.task_id, 'understanding');
    task = await taskStore.transition(task.task_id, 'verifying', { patch: { private: { creation: {
      runtime: 'queue', frozen_spec: frozen, occurrence_path_map: occurrencePathMap, rounds: [],
      round: { iteration: 0, source_hash: 'synthetic-source', snapshot }
    } } } });
    const result = await gateway.finalizeCreationQuality(task);
    assert.equal(calls, 1);
    assert.equal(result.state, mode === 'valid' ? 'completed' : 'awaiting_input');
    assert.equal(result.result.quality_accepted, mode === 'valid');
    assert.equal(result.private.creation.round.region_inspection_attempts, 1);
    assert.equal(result.private.creation.frozen_spec.hash, frozen.hash);
    if (mode === 'blocked') {
      assert.deepEqual(result.private.creation.round.region_inspection.raw_result.results[0].blocker_path, ['parent', 'extra_cap']);
      assert.equal(result.private.creation.per_part_failure_streak['void:door-gap'], 0, 'initial build is not a correction');
    }
    if (mode === 'unavailable') assert.match(result.private.creation.round.region_inspection.error.message, /private native diagnostic/);
    if (mode !== 'valid') {
      let retry = await taskStore.transition(task.task_id, 'understanding');
      retry = await taskStore.transition(task.task_id, 'verifying');
      const again = await gateway.finalizeCreationQuality(retry);
      assert.equal(calls, 2, 'read-only retry obtains a fresh server query and does not replay creation');
      assert.equal(again.private.creation.round.region_inspection_attempts, 2);
      assert.equal(again.private.creation.per_part_failure_streak['void:door-gap'], 0);
    }
  }
  console.log('detail-context-regions: frozen local voids, trusted server/native revision and occurrence binding, blocker gates, private diagnostics and read-only retry passed (offline fixtures)');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
