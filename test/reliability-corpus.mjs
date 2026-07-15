import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { compareSnapshots } from '../src/snapshot-diff.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-reliability-corpus-'));
const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'test/reliability-corpus/manifest.json'), 'utf8'));
assert.equal(manifest.cases.length, 7);

const results = [];
let wrongObjectModifications = 0;
let silentGeometryCorruption = 0;
let recoveryAttempts = 0;
let recoveries = 0;

for (const [index, corpusCase] of manifest.cases.entries()) {
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(root, `${index}-${corpusCase.id}.session.json`) } });
  const started = Date.now();
  try {
    let details;
    if (corpusCase.source.endsWith?.('.json')) details = await runExistingDocumentCase(bridge, corpusCase);
    else if (corpusCase.id === 'deep-shared-components') details = await runDeepSharedCase(bridge);
    else if (corpusCase.id === 'imported-dirty-topology') details = await runDirtyImportCase(bridge);
    else details = await runTransformLockedCase(bridge);
    results.push({ id: corpusCase.id, domain: corpusCase.domain, ok: true, duration_ms: Date.now() - started, ...details });
  } catch (error) {
    results.push({ id: corpusCase.id, domain: corpusCase.domain, ok: false, duration_ms: Date.now() - started, error: String(error.message || error) });
  }
}

assert.equal(results.every((result) => result.ok), true, JSON.stringify(results, null, 2));
assert.equal(wrongObjectModifications, 0);
assert.equal(silentGeometryCorruption, 0);
assert.equal(recoveryAttempts, 2);
assert.equal(recoveries, 2);

const report = {
  version: 'real-model-reliability-report.v1',
  kind: 'real_model_reliability_report',
  runtime: 'mock',
  live_sketchup_version_matrix: 'not_run_requires_explicit_user_coordination',
  corpus_cases: results.length,
  passed_cases: results.filter((result) => result.ok).length,
  metrics: {
    task_success_rate: results.filter((result) => result.ok).length / results.length,
    wrong_object_modification_count: wrongObjectModifications,
    silent_geometry_corruption_count: silentGeometryCorruption,
    recovery_rate: recoveries / recoveryAttempts
  },
  results
};
await fs.writeFile(path.join(root, 'real-model-reliability-report.v1.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function runExistingDocumentCase(bridge, corpusCase) {
  const document = await fs.readFile(path.join(repoRoot, corpusCase.source), 'utf8');
  const built = await bridge.build_model({ runtime: 'mock', code: document });
  if (corpusCase.id === 'product-boolean-manifold') {
    assert.ok(built.snapshot.manifold_checks.length >= 2);
    assert.equal(built.snapshot.manifold_checks.every((check) => check.ok), true);
  }
  if (corpusCase.id === 'appearance-scenes-hidden') {
    assert.ok(built.snapshot.groups.some((group) => group.texture_transform?.projection === 'box'));
    assert.ok(built.snapshot.material_names.includes('Appearance_Base'));
    assert.equal(built.snapshot.scenes.length, 1);
  }
  const savePath = path.join(root, `${corpusCase.id}.saved.json`);
  await bridge.save_model({ runtime: 'mock', path: savePath, keep_session: true });
  const reopened = await bridge.open_model({ runtime: 'mock', path: savePath });
  const diff = compareSnapshots(built.snapshot, reopened.snapshot, { toleranceMm: 0 });
  if (!diff.ok || diff.summary.by_severity.error > 0) silentGeometryCorruption += 1;
  assert.equal(diff.summary.by_severity.error, 0, JSON.stringify(diff.top_issues));
  return {
    groups: reopened.snapshot.groups.length,
    instances: reopened.snapshot.instances.length,
    scenes: reopened.snapshot.scenes.length,
    save_reopen_error_diffs: diff.summary.by_severity.error
  };
}

async function runDeepSharedCase(bridge) {
  const instances = Array.from({ length: 80 }, (_, index) => ({
    op: 'component_instance', id: `shared-parent-${index}`, name: `Shared_Parent_${index}`, definition: 'Shared_Parent_Definition', origin: [index * 120, 0, 0]
  }));
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'reset' },
    { op: 'component_definition', name: 'Shared_Leaf_Definition', operations: [
      { op: 'box', id: 'shared-leaf', name: 'Shared_Leaf', origin: [0, 0, 0], size: [100, 60, 30] }
    ] },
    { op: 'component_definition', name: 'Shared_Parent_Definition', operations: [
      { op: 'component_instance', id: 'shared-leaf-instance', name: 'Shared_Leaf_Instance', definition: 'Shared_Leaf_Definition', origin: [0, 0, 0] }
    ] },
    ...instances
  ] }) });
  const before = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 10000 });
  assert.equal(before.recursive_truncated, false);
  assert.equal(before.recursive_index.filter((entry) => entry.name === 'Shared_Leaf').length, 80);
  assert.ok(before.recursive_index.some((entry) => entry.affected_instance_count === 80));
  const paths = before.recursive_index.map((entry) => entry.entity_path).sort();
  const savePath = path.join(root, 'deep-shared.saved.json');
  await bridge.save_model({ runtime: 'mock', path: savePath, keep_session: true });
  await bridge.open_model({ runtime: 'mock', path: savePath });
  const after = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 10000 });
  assert.deepEqual(after.recursive_index.map((entry) => entry.entity_path).sort(), paths);
  return { recursive_entities: before.recursive_index.length, shared_leaf_occurrences: 80, save_reopen_identity_stable: true };
}

async function runDirtyImportCase(bridge) {
  const dirtyPath = path.join(root, 'imported-dirty-cad.json');
  await fs.writeFile(dirtyPath, `${JSON.stringify({ model: {
    version: 1,
    units: 'mm',
    groups: [{
      id: 'dirty-cad-shell', name: 'Imported_Dirty_CAD_Shell', kind: 'mesh', faces: 1, edges: 3,
      vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]], mesh_faces: [[0, 1, 2]],
      bounding_box: { min: [0, 0, 0], max: [100, 100, 20], w: 100, d: 100, h: 20 }
    }]
  } }, null, 2)}\n`, 'utf8');
  await bridge.import_model({ runtime: 'mock', path: dirtyPath, mode: 'replace' });
  let checked = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'manifold_check', target_id: 'dirty-cad-shell', check_id: 'dirty-before', fail_on_non_manifold: false }
  ] }) });
  assert.equal(checked.snapshot.manifold_checks.at(-1).ok, false);
  recoveryAttempts += 1;
  checked = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'manifold_repair', target_id: 'dirty-cad-shell', repair_id: 'dirty-repair', strategy: 'seal_bbox', fail_on_non_manifold: true },
    { op: 'manifold_check', target_id: 'dirty-cad-shell', check_id: 'dirty-after', fail_on_non_manifold: true }
  ] }) });
  assert.equal(checked.snapshot.manifold_checks.at(-1).ok, true);
  recoveries += 1;
  return { imported: true, dirty_topology_detected: true, repair_recovered: true };
}

async function runTransformLockedCase(bridge) {
  const rawPath = path.join(root, 'locked-transform.json');
  await fs.writeFile(rawPath, `${JSON.stringify({ model: {
    groups: [
      boxModel('locked-object', 'Locked_Object', [0, 0, 0], [100, 60, 20], true),
      boxModel('guard-object', 'Guard_Object', [200, 0, 0], [40, 40, 40], false),
      boxModel('transform-object', 'Transform_Object', [300, 0, 0], [50, 30, 20], false)
    ]
  } }, null, 2)}\n`, 'utf8');
  await bridge.open_model({ runtime: 'mock', path: rawPath });
  const beforeAdoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true });
  const beforeRevision = modelRevisionForAdoption(beforeAdoption);
  const guardBefore = beforeAdoption.entities.find((entity) => entity.id === 'guard-object');
  recoveryAttempts += 1;
  await assert.rejects(
    bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'attribute', target_id: 'guard-object', dictionary: 'Reliability', key: 'must_rollback', value: true },
      { op: 'transform_object', target_id: 'locked-object', translate: [10, 0, 0] }
    ] }) }),
    /target is locked/
  );
  const afterFailure = await bridge.adopt_open_model({ runtime: 'mock', recursive: true });
  assert.equal(modelRevisionForAdoption(afterFailure), beforeRevision);
  recoveries += 1;
  const transformed = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'transform_object', target_id: 'transform-object', scale: [1.5, 0.75, 2], mirror: 'x', pivot: 'center' }
  ] }) });
  const object = transformed.snapshot.groups.find((group) => group.id === 'transform-object');
  const guardAfter = transformed.snapshot.groups.find((group) => group.id === 'guard-object');
  assert.ok(object.transform.object_transform.mirror.includes('x'));
  assert.deepEqual(guardAfter.bounding_box, guardBefore.bounding_box);
  if (JSON.stringify(guardAfter.bounding_box) !== JSON.stringify(guardBefore.bounding_box)) wrongObjectModifications += 1;
  return { locked_mutation_rejected: true, rollback_verified: true, mirrored: true, nonuniform_scale: true };
}

function boxModel(id, name, origin, size, locked) {
  const max = origin.map((value, axis) => value + size[axis]);
  return { id, name, kind: 'box', faces: 6, edges: 12, bounding_box: { min: origin, max, w: size[0], d: size[1], h: size[2] }, locked };
}
