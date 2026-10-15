import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { freezeDetailSpecification } from '../src/detail-quality.mjs';
import { compileModelAccessibilityTask } from '../src/model-accessibility-tasks.mjs';
import { straightCorridorTask, squarePavilionTask, cornerCorridorTask, referenceTask } from '../src/traditional-timber/examples.mjs';
import { ringsMesh } from '../src/traditional-timber/solids.mjs';
import { geometryDistance } from '../src/model-geometry-service.mjs';
import { identityMatrix, matrixFromTransform, multiplyMatrices, transformPoint } from '../src/geometry-matrix.mjs';
import { evaluateTraditionalAssemblyQuality } from '../src/traditional-timber/assembly-quality.mjs';
import { readTraditionalAssemblyJointMeasurements, evaluateTraditionalAssemblyJoints } from '../src/traditional-timber/assembly-joint-measurements.mjs';

const revision = `sha256:${'1'.repeat(64)}`;
const otherRevision = `sha256:${'2'.repeat(64)}`;
const plane = z => [[[0, 0, z], [10, 0, z], [0, 10, z]]];
const copy = value => structuredClone(value);

// Independently check that sampled relationships are intentional contacts in
// the actual compiler output. This is compiler geometry, never native proof.
function compiledSurface(graph, path) {
  const parts = new Map(graph.parts.map(part => [part.id, part]));
  let ref = graph.roots.find(root => root.instance_id === path[0]), world = identityMatrix();
  const apply = child => { world = multiplyMatrices(world, matrixFromTransform({ ...child.transform, translate: child.origin || [0, 0, 0] })); };
  apply(ref);
  let part = parts.get(ref.part_id);
  for (const id of path.slice(1)) {
    ref = part.assembly.children.find(child => (child.instance_id || child.part_id) === id);
    assert.ok(ref, `Missing compiler member ${id}`); apply(ref); part = parts.get(ref.part_id);
  }
  ref = part.assembly.children.find(child => parts.get(child.part_id).shape); apply(ref);
  const shape = parts.get(ref.part_id).shape, p = shape.parameters;
  let mesh;
  if (shape.primitive === 'mesh') mesh = p;
  else if (shape.primitive === 'cylinder') mesh = ringsMesh([0, p.height].map(z => Array.from({ length: p.segments }, (_, i) => {
    const angle = i * Math.PI * 2 / p.segments;
    return [p.origin[0] + p.radius * Math.cos(angle), p.origin[1] + p.radius * Math.sin(angle), p.origin[2] + z];
  })));
  else throw new Error(`Unexpected compiler sample primitive ${shape.primitive}`);
  const vertices = mesh.vertices.map(point => transformPoint(world, point));
  return { points: [], segments: [], triangles: mesh.faces.flatMap(face => Array.from({ length: face.length - 2 }, (_, i) => [vertices[face[0]], vertices[face[i + 1]], vertices[face[i + 2]]])) };
}
const seated = squarePavilionTask('seated-pavilion');
seated.assembly.assemblies.push({ id: 'column-seats', family: 'bracket_or_seat', parameters: { type: 'simple_seat' } });
for (const task of [straightCorridorTask(), squarePavilionTask(), cornerCorridorTask(), seated]) {
  const bundle = compileModelAccessibilityTask(task).bundle;
  for (const check of bundle.detail_spec.native_joint_checks) {
    const gap = geometryDistance(compiledSurface(bundle.part_graph, check.first_instance_path), compiledSurface(bundle.part_graph, check.second_instance_path), 2_000_000);
    assert.ok(gap <= check.tolerance_mm, `${task.id} ${check.kind} compiler surfaces have an unintended ${gap} mm gap`);
  }
}

function fixture(rootCount = 1) {
  const spec = compileModelAccessibilityTask(straightCorridorTask('joint-fixture')).bundle.detail_spec;
  if (rootCount > 1) {
    const checks = copy(spec.native_joint_checks), parts = copy(spec.required_parts);
    spec.native_joint_checks = Array.from({ length: rootCount }, (_, i) => checks.map(check => ({ ...copy(check), id: `${i}:${check.id}`,
      first_instance_path: [`root-${i}`, ...check.first_instance_path.slice(1)], second_instance_path: [`root-${i}`, ...check.second_instance_path.slice(1)] }))).flat();
    spec.required_parts = Array.from({ length: rootCount }, (_, i) => parts.map(part => ({ ...copy(part), instance_path: [`root-${i}`, ...part.instance_path.slice(1)] }))).flat();
  }
  const identity_map = {};
  for (const check of spec.native_joint_checks) for (const id of [...check.first_instance_path, ...check.second_instance_path]) identity_map[id] = `owned-${id}`;
  const creation = { runtime: 'queue', frozen_spec: freezeDetailSpecification(spec), identity_map, occurrence_path_map: {}, round: { snapshot: { model_revision: revision } } };
  const summary = { runtime: 'queue', read_only: true, model_revision: revision, model_revision_complete: true,
    session_id: 'session-native-fixture', document_id: 'document-native-fixture', model_identity: { runtime_object_id: 'model-native-fixture' },
    assembly_projection_complete: true, recursive_truncated: false, assembly_summary_depth: 2, recursive_projection: 'assembly-merkle.v2',
    snapshot: { resource_totals: { complete: true, scope: 'all_native_stored_geometry', faces: 100, edges: 200, vertices: 100 } }, recursive_index: [] };
  const paths = new Map();
  const addPath = logical => {
    const key = JSON.stringify(logical);
    if (paths.has(key)) return paths.get(key);
    const parent = logical.length > 1 ? addPath(logical.slice(0, -1)) : null;
    const entity_path = parent ? `${parent}.${paths.size + 1}` : `pid:${paths.size + 1}`;
    paths.set(key, entity_path);
    summary.recursive_index.push({ entity_path, parent_entity_path: parent, visible: true,
      path_segments: logical.map(id => ({ reference: identity_map[id] || id })),
      geometry_summary: { type: 'assembly_merkle', expanded_count: 10, subtree_digest: 'native-fixture-digest' },
      bounding_box: { min: [0, 0, 0], max: [100, 100, 100] } });
    return entity_path;
  };
  spec.required_parts.forEach(part => addPath(part.instance_path));
  const memberPaths = [...new Set(spec.native_joint_checks.flatMap(check => [addPath(check.first_instance_path), addPath(check.second_instance_path)]))];
  const snapshot = { version: 'model-geometry.v1', runtime: 'queue', complete: true, units: 'mm', model_revision: revision,
    session_id: summary.session_id, document_id: summary.document_id, model_identity: copy(summary.model_identity),
    contexts: memberPaths.map(entity_path => ({ entity_path: `${entity_path}.100`, vertices: [], edges: [], faces: [{ triangles: plane(0) }] })) };
  const calls = [];
  const bridge = { async query_model_geometry(options) {
    calls.push(copy(options));
    const actual = copy(snapshot);
    actual.contexts = actual.contexts.filter(context => options.targets.some(target => context.entity_path === target || context.entity_path.startsWith(`${target}.`)));
    return { runtime: actual.runtime, model_revision: actual.model_revision, complete: actual.complete,
      snapshot_handle: `geometry:${sha256Canonical(actual).slice(7)}`, snapshot: actual };
  } };
  const captures = spec.required_views.map(view => ({ id: view.id, server_verified: true, model_revision: revision, width: 1600, height: 1000 }));
  return { spec, creation, summary, snapshot, bridge, calls, paths, captures };
}

const measure = f => readTraditionalAssemblyJointMeasurements(f);
const evaluate = (f, measurements, trusted = true) => evaluateTraditionalAssemblyJoints({ ...f, measurements, trusted });
const f = fixture();
assert.deepEqual(f.spec.native_joint_checks.map(check => check.kind), ['column_beam', 'frame_purlin', 'purlin_rafter']);
assert.equal(compileModelAccessibilityTask(squarePavilionTask()).bundle.detail_spec.native_joint_checks.length, 3);
assert.deepEqual(compileModelAccessibilityTask(referenceTask()).bundle.detail_spec.native_joint_checks, []);
const measured = await measure(f);
assert.deepEqual(measured.results.map(row => row.status), ['pass', 'pass', 'pass']);
assert.ok(measured.results.every(row => row.measured_distance_mm === 0 && row.penetration_checked === false && row.bearing_capacity_checked === false));
assert.equal(f.calls.length, 1);
assert.equal(f.calls[0].targets.length, 4, 'Only four selected wrappers are read; tile geometry is outside this query.');
assert.equal(f.calls[0].runtime, 'queue');
assert.equal(f.calls[0].max_vertices, 40000);
assert.equal(evaluate(f, measured).evidence_level, 'native_surface_distance');
assert.equal(evaluate(f, measured).issues.length, 0);
const quality = evaluateTraditionalAssemblyQuality({ ...f, jointMeasurements: measured, trustedJointMeasurements: true });
assert.equal(quality.quality_status, 'pass', JSON.stringify(quality.issues));
assert.equal(quality.connection_checks[0].evidence_level, 'shared_layout_contract', 'Compiler expectations remain explicitly separate.');
assert.equal(quality.connection_evidence_level, 'compiler_expected_coordinates', 'Selected native pairs cannot upgrade all declared connections.');
assert.equal(quality.native_joint_evidence_level, 'native_surface_distance');
assert.equal(quality.joint_penetration_checked, false);
const unmeasuredQuality = evaluateTraditionalAssemblyQuality({ ...f });
assert.equal(unmeasuredQuality.connection_evidence_level, 'compiler_expected_coordinates');
assert.equal(unmeasuredQuality.native_joint_evidence_level, 'mixed_or_unverified');
const manyRoots = fixture(12), manyMeasured = await measure(manyRoots);
assert.equal(manyRoots.calls.length, 2);
assert.ok(manyRoots.calls.every(call => call.targets.length <= 32));
assert.equal(manyMeasured.results.length, 36);
assert.ok(manyMeasured.results.every(row => row.status === 'pass'));
assert.equal(evaluate(manyRoots, manyMeasured).issues.length, 0);
assert.equal(manyMeasured.snapshot_handles.length, 2);
const driftBetweenBatches = fixture(12), batchedQuery = driftBetweenBatches.bridge.query_model_geometry;
driftBetweenBatches.bridge.query_model_geometry = async options => {
  if (driftBetweenBatches.calls.length) driftBetweenBatches.snapshot.model_revision = otherRevision;
  return batchedQuery(options);
};
assert.ok(evaluate(driftBetweenBatches, await measure(driftBetweenBatches)).issues.length > 0);

// A changed native surface must fail even when bounding boxes, logical names,
// source recipe and all other assemblies remain identical.
const gap = fixture();
gap.snapshot.contexts.at(-1).faces[0].triangles = plane(3);
const separated = await measure(gap);
assert.equal(separated.results.at(-1).status, 'fail');
assert.equal(separated.results.at(-1).measured_distance_mm, 3);
assert.equal(evaluateTraditionalAssemblyQuality({ ...gap, jointMeasurements: separated, trustedJointMeasurements: true }).quality_status, 'fail');
const tolerance = fixture();
tolerance.snapshot.contexts.at(-1).faces[0].triangles = plane(0.75);
assert.equal((await measure(tolerance)).results.at(-1).status, 'pass');

// Both triangles have overlapping XY bounding boxes. They do not touch;
// unrelated coincident vertices/edges must not manufacture a surface contact.
const bbox = fixture();
bbox.snapshot.contexts[0].faces[0].triangles = [[[0, 0, 0], [20, 0, 0], [0, 20, 0]]];
bbox.snapshot.contexts[1].faces[0].triangles = [[[20, 20, 0], [20, 8, 0], [8, 20, 0]]];
for (const context of bbox.snapshot.contexts.slice(0, 2)) context.vertices = [{ handle: 'v:orphan', world_position: [0, 0, 0] }];
const bboxMeasured = await measure(bbox);
assert.equal(bboxMeasured.results[0].status, 'fail');
assert.ok(bboxMeasured.results[0].measured_distance_mm > 5);

// Queue-shaped offline fixtures exercise the contract only. Mock, stale,
// foreign-document and forged-header data must never become native evidence.
for (const mutate of [
  x => { x.snapshot.runtime = 'mock'; },
  x => { x.snapshot.model_revision = otherRevision; },
  x => { x.snapshot.document_id = 'other-document'; },
  x => { x.snapshot.session_id = 'other-session'; },
  x => { x.snapshot.model_identity.runtime_object_id = 'other-model'; },
  x => { x.snapshot.complete = false; }
]) {
  const invalid = fixture(); mutate(invalid);
  const report = await measure(invalid);
  assert.ok(report.results.every(row => row.status === 'unverified' && row.evidence_level !== 'native_surface_distance'));
}
const mock = fixture(); mock.creation.runtime = 'mock';
assert.equal((await measure(mock)).runtime, 'mock');
assert.equal(mock.calls.length, 0);
const staleCommit = fixture(); staleCommit.creation.round.snapshot.model_revision = otherRevision;
assert.ok((await measure(staleCommit)).results.every(row => row.status === 'unverified'));
assert.equal(staleCommit.calls.length, 0);
const badHash = fixture();
const originalQuery = badHash.bridge.query_model_geometry;
badHash.bridge.query_model_geometry = async options => ({ ...await originalQuery(options), snapshot_handle: `geometry:${'a'.repeat(64)}` });
assert.ok((await measure(badHash)).results.every(row => row.status === 'unverified'));
const changedSpec = fixture(); changedSpec.creation.frozen_spec.specification.native_joint_checks[0].tolerance_mm = 10;
await assert.rejects(measure(changedSpec), /frozen specification/);
assert.ok(evaluate(f, measured, false).results.every(row => row.status === 'unverified'));
for (const mutate of [
  x => { x.document_id = 'foreign'; },
  x => { x.model_revision = otherRevision; },
  x => { x.specification_hash = 'forged'; },
  x => { x.results[0].first_entity_path = 'pid:999'; },
  x => { x.results[0].first_geometry_context = 'pid:999.1'; },
  x => { x.results[0].tolerance_mm = 100; },
  x => { x.results[0].method = 'bounding_box_contact'; },
  x => { x.results[0].measured_distance_mm = NaN; },
  x => { x.results.push(copy(x.results[0])); }
]) {
  const report = copy(measured); mutate(report);
  assert.equal(evaluate(f, report).results[0].status, 'unverified');
}

const missing = fixture(); missing.summary.recursive_index = missing.summary.recursive_index.filter(row => row.entity_path !== measured.results[0].first_entity_path);
assert.equal((await measure(missing)).results[0].status, 'unverified');
const ambiguous = fixture(); ambiguous.summary.recursive_index.push(copy(ambiguous.summary.recursive_index.find(row => row.entity_path === measured.results[0].first_entity_path)));
assert.equal((await measure(ambiguous)).results[0].status, 'unverified');
const unsupported = fixture(); unsupported.snapshot.contexts[0].faces = [];
assert.equal((await measure(unsupported)).results[0].status, 'unsupported');
const overBudget = fixture();
overBudget.snapshot.contexts[0].faces[0].triangles = Array.from({ length: 1500 }, () => plane(0)[0]);
overBudget.snapshot.contexts[1].faces[0].triangles = Array.from({ length: 1500 }, () => plane(0)[0]);
assert.equal((await measure(overBudget)).results[0].status, 'unsupported');
const unavailable = fixture(); unavailable.bridge.query_model_geometry = async () => { throw Object.assign(new Error('fixture disconnected'), { code: 'QUEUE_UNAVAILABLE' }); };
assert.ok((await measure(unavailable)).results.every(row => row.status === 'unverified'));

const legacy = fixture(); delete legacy.creation.frozen_spec.specification.native_joint_checks;
legacy.creation.frozen_spec = freezeDetailSpecification(legacy.creation.frozen_spec.specification);
assert.equal(evaluate(legacy, null).evidence_level, 'compiler_expected_coordinates');
assert.deepEqual(evaluate(legacy, null).issues, []);
assert.equal(evaluateTraditionalAssemblyQuality(legacy).quality_status, 'pass', 'Existing frozen specifications without native sampling remain compatible.');
console.log('Traditional joint offline fixtures: native surface gaps, tolerance, revision/document/identity/hash binding, bounded unsupported states and legacy compatibility passed. No live SketchUp acceptance claimed.');
