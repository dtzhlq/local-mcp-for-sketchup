import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { adoptParameterRoots, mergeParameterRootAdoptions } from '../src/model-accessibility-scoped-readback.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';

// Recorded/fake queue reports only. No runtime construction or native calls.
const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/model-graph/queue-pid-adoption.json', import.meta.url), 'utf8'));
function reports() {
  const first = structuredClone(fixture);
  const secondEntity = { ...structuredClone(first.entities[0]), id: 'second', reference: 'second', persistent_id: '102', name: 'Second' };
  first.entities.push(secondEntity); first.entity_count = 2;
  first.model_revision_total_seen = 8; first.model_revision_indexed = 8;
  first.model_revision_strategy = 'definition-merkle.v2'; first.model_revision_blockers = [];
  const a = first.recursive_index;
  for (const entry of a) entry.entity_definition_occurrence_count = 2;
  const b = a.map(item => {
    const entry = structuredClone(item);
    for (const field of ['path', 'entity_path', 'parent_entity_path']) if (entry[field]) entry[field] = entry[field].replace(/^pid:101/, 'pid:102');
    entry.persistent_id_path = entry.persistent_id_path.replace(/^101/, '102');
    entry.path_segments[0].persistent_id = '102'; entry.path_segments[0].reference = 'second';
    if (entry.parent_entity_path === null) { entry.persistent_id = '102'; entry.reference = 'second'; entry.name = 'Second'; }
    return entry;
  });
  const result = [structuredClone(first), structuredClone(first)];
  result[0].recursive_index = [...a, b[0]];
  result[1].recursive_index = [a[0], ...b];
  result[0].recursive_root_paths = ['pid:101']; result[1].recursive_root_paths = ['pid:102'];
  for (const row of result) row.recursive_total_seen = row.recursive_index.length;
  return JSON.parse(JSON.stringify(result));
}
const options = { rootPaths: ['pid:101', 'pid:102'], recursiveLimit: 5, runtime: 'queue' };
const input = reports(), copy = JSON.stringify(input);
const merged = mergeParameterRootAdoptions({ ...options, reports: input });
assert.equal(JSON.stringify(input), copy, 'merging must not mutate native evidence');
assert.equal(merged.recursive_index.length, 8);
assert.equal(merged.recursive_total_seen, 8);
assert.equal(merged.model_revision_total_seen, 8);
assert.equal(merged.model_revision_indexed, 8);
assert.equal(merged.recursive_index.find(x => x.entity_path === 'pid:101').entity_definition_occurrence_count, 2);
assert.equal(merged.bounded_readback.complete, false);
assert.equal(merged.bounded_readback.merged_unique_count, 8);
assert(merged.bounded_readback.requests.every(x => x.recursive_limit === 5 && x.returned === 5));
const graph = buildModelGraph(merged);
assert.equal(graph.completeness.complete, false);
assert.equal(graph.completeness.scope_complete, true);
let rejected = 0;
for (const mutate of [
  rows => { rows[1].recursive_truncated = true; },
  rows => { rows[1].recursive_total_seen++; },
  rows => { rows[1].model_revision = `sha256:${'b'.repeat(64)}`; },
  rows => { rows[1].model_revision_complete = false; },
  rows => { rows[1].model_revision_indexed--; },
  rows => { rows[1].model_identity.runtime_object_id = 'another-window'; },
  rows => { rows[1].document_id = 'another-doc'; },
  rows => { rows[1].snapshot.materials = [{ name: 'changed' }]; },
  rows => { rows[1].recursive_index[0].entity_definition_occurrence_count = 99; },
  rows => { rows[1].recursive_index[0] = Object.fromEntries(Object.entries(rows[1].recursive_index[0]).reverse()); },
  rows => { rows[1].recursive_index[1].entity_path = 'pid:999'; },
  rows => { rows[1].recursive_root_paths = ['pid:101']; },
  rows => { rows[1].recursive_index[2].parent_entity_path = 'pid:102.999'; },
  rows => { rows[1].recursive_index.push(rows[1].recursive_index[0]); rows[1].recursive_total_seen++; },
  rows => { rows[1].read_only = false; }
]) {
  const rows = reports(); mutate(rows);
  assert.throws(() => mergeParameterRootAdoptions({ ...options, reports: rows })); rejected++;
}
for (const bad of [
  { rootPaths: ['pid:101', 'pid:101'] }, { rootPaths: ['pid:101.201'] },
  { rootPaths: Array.from({ length: 13 }, (_, i) => `pid:${i + 1}`) }, { recursiveLimit: 10001 }, { recursiveLimit: 0 }
]) assert.throws(() => mergeParameterRootAdoptions({ ...options, ...bad, reports: reports() }));

const calls = [], recorded = reports();
let active = 0;
const bridge = { async adopt_open_model(args) {
  assert.equal(++active, 1, 'readbacks must be sequential'); calls.push(args);
  await Promise.resolve(); active--;
  if (!args.recursive) return { ...structuredClone(recorded[0]), recursive: false, recursive_index: null, recursive_root_paths: null, recursive_total_seen: 0 };
  return structuredClone(recorded[args.recursive_roots[0] === 'pid:101' ? 0 : 1]);
} };
const read = await adoptParameterRoots({ bridge, runtime: 'queue', recursiveLimit: 5, timeoutMs: 12345, rootIds: ['building-root', 'second'] });
assert.equal(calls.length, 3);
assert(calls.every(call => call.read_only === true && call.recursive_limit === 5 && call.timeoutMs === 12345));
assert.equal(calls[0].recursive, false);
assert.deepEqual(calls.slice(1).map(call => call.recursive_roots), [['pid:101'], ['pid:102']]);
assert.equal(read.bounded_readback.header_read_performed, true);
assert.equal(read.bounded_readback.scope_complete, true);
let driftCalls = 0;
const drift = { async adopt_open_model() { driftCalls++; const result = structuredClone(recorded[0]); result.recursive_truncated = true; return result; } };
await assert.rejects(adoptParameterRoots({ ...options, bridge: drift }), error => error.code === 'MODEL_REVISION_INCOMPLETE');
assert.equal(driftCalls, 1, 'a failed first scope must prevent remaining reads');
let invalidCalls = 0;
await assert.rejects(adoptParameterRoots({ bridge: { adopt_open_model() { invalidCalls++; } }, rootPaths: [] }));
assert.equal(invalidCalls, 0);
console.log(`bounded scoped readback: complete scoped graph, 15 corrupted reports and 5 invalid budgets/root lists rejected, sequential read-only calls and early-stop passed; native calls 0`);
