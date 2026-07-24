import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  BOOLEAN_TARGET_ID,
  BOOLEAN_TARGET_MATERIAL,
  BOOLEAN_TARGET_NAME,
  BOOLEAN_TOOL_ID,
  BOOLEAN_TOOL_MATERIAL,
  BOOLEAN_TOOL_NAME,
  CONTROLLED_PRODUCT_BOOLEAN_FIXTURE_VERSION,
  assertProductBooleanPlacement,
  assertProductBooleanSnapshot,
  buildProductBooleanContract,
  controlledProductBooleanFixtureOperations,
  loadStagedProductBooleanFixture,
  prepareControlledProductBooleanFixture,
  stageControlledProductBooleanFixture,
  validateFixtureDocument
} from '../scripts/prepare-product-boolean-manifold-live-fixture.mjs';

let assertions = 0;
const origin = [5000, -200, -300];
const operations = controlledProductBooleanFixtureOperations(origin);
assert.equal(operations.length, 4); assertions += 1;
assert.deepEqual(operations.map((operation) => operation.op), [
  'material', 'material', 'box', 'cylinder'
]); assertions += 1;
assert.equal(operations.some((operation) =>
  ['reset', 'delete', 'boolean_difference', 'run_ruby_expert'].includes(operation.op)), false); assertions += 1;
assert.equal(operations[2].id, BOOLEAN_TARGET_ID); assertions += 1;
assert.equal(operations[2].name, BOOLEAN_TARGET_NAME); assertions += 1;
assert.equal(operations[2].material, BOOLEAN_TARGET_MATERIAL); assertions += 1;
assert.deepEqual(operations[2].origin, origin); assertions += 1;
assert.deepEqual(operations[2].size, [160, 100, 80]); assertions += 1;
assert.equal(operations[3].id, BOOLEAN_TOOL_ID); assertions += 1;
assert.equal(operations[3].name, BOOLEAN_TOOL_NAME); assertions += 1;
assert.equal(operations[3].material, BOOLEAN_TOOL_MATERIAL); assertions += 1;
assert.deepEqual(operations[3].origin, [5060, -150, -310]); assertions += 1;
assert.equal(operations[3].radius, 20); assertions += 1;
assert.equal(operations[3].height, 100); assertions += 1;
assert.throws(
  () => controlledProductBooleanFixtureOperations([0, Number.NaN, 0]),
  /three finite coordinates/
); assertions += 1;

const target = {
  bounding_box: { min: [5000, -200, -300], max: [5160, -100, -220] }
};
const tool = {
  bounding_box: { min: [5040, -170, -310], max: [5080, -130, -210] }
};
assert.deepEqual(assertProductBooleanPlacement({
  sourceBounds: { min: [-100, -100, -100], max: [3000, 1000, 1000] },
  target,
  tool
}), {
  isolated_from_source: true,
  positive_3d_overlap: true,
  through_cut: true,
  overlap_mm: [40, 40, 80]
}); assertions += 1;
assert.throws(
  () => assertProductBooleanPlacement({
    sourceBounds: { min: [-100, -100, -100], max: [4500, 1000, 1000] },
    target,
    tool
  }),
  /not isolated/
); assertions += 1;
assert.throws(
  () => assertProductBooleanPlacement({
    sourceBounds: { min: [-100, -100, -100], max: [3000, 1000, 1000] },
    target,
    tool: { bounding_box: { min: [6000, 0, 0], max: [6100, 100, 100] } }
  }),
  /positive 3D overlap/
); assertions += 1;

const manifoldReport = {
  is_manifold: true,
  method: 'sketchup_manifold_api',
  faces: 6,
  edges: 12,
  vertices: 8,
  issues: []
};
const toolReport = {
  is_manifold: true,
  method: 'sketchup_manifold_api',
  faces: 34,
  edges: 96,
  vertices: 64,
  issues: []
};
const checkedSnapshot = {
  material_names: [BOOLEAN_TARGET_MATERIAL, BOOLEAN_TOOL_MATERIAL],
  manifold_checks: [{
    op: 'manifold_check',
    ok: true,
    targets: [manifoldReport, toolReport]
  }]
};
assert.deepEqual(assertProductBooleanSnapshot(checkedSnapshot), [manifoldReport, toolReport]); assertions += 1;
assert.throws(
  () => assertProductBooleanSnapshot({
    ...checkedSnapshot,
    manifold_checks: [{
      ...checkedSnapshot.manifold_checks[0],
      ok: false
    }]
  }),
  /did not pass/
); assertions += 1;
assert.throws(
  () => assertProductBooleanSnapshot({
    ...checkedSnapshot,
    material_names: [BOOLEAN_TOOL_MATERIAL]
  }),
  /target material is missing/
); assertions += 1;

const fullContract = buildProductBooleanContract({
  artifactSha256: `sha256:${'a'.repeat(64)}`,
  entities: 5,
  recursiveTotal: 71412,
  targetPersistentId: '1001',
  toolPersistentId: '1002'
});
const boundedContract = buildProductBooleanContract({
  artifactSha256: `sha256:${'b'.repeat(64)}`,
  entities: 5,
  recursiveTotal: 120000,
  targetPersistentId: '2001',
  toolPersistentId: '2002'
});
const contractSchema = JSON.parse(await fs.readFile(
  new URL('../schema/real-model-reliability-live-case-v1.schema.json', import.meta.url),
  'utf8'
));
const validateContract = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
  .compile(contractSchema);
assert.equal(validateContract(fullContract), true, JSON.stringify(validateContract.errors, null, 2)); assertions += 1;
assert.equal(validateContract(boundedContract), true, JSON.stringify(validateContract.errors, null, 2)); assertions += 1;
assert.equal(fullContract.case_id, 'product-boolean-manifold'); assertions += 1;
assert.equal(fullContract.artifact_file, 'product-boolean-manifold.skp'); assertions += 1;
assert.deepEqual(fullContract.targets, {
  boolean_target: { persistent_id: '1001' },
  boolean_tool: { persistent_id: '1002' }
}); assertions += 1;
assert.deepEqual(fullContract.expectations.required_materials, [BOOLEAN_TARGET_MATERIAL]); assertions += 1;
assert.equal(fullContract.expectations.boolean_operation, 'boolean_difference'); assertions += 1;
assert.equal(fullContract.expectations.identity_mode, 'full_recursive'); assertions += 1;
assert.equal(boundedContract.expectations.identity_mode, 'complete_revision_bounded_occurrence_sample'); assertions += 1;
assert.throws(() => buildProductBooleanContract({
  artifactSha256: `sha256:${'c'.repeat(64)}`,
  entities: 5,
  recursiveTotal: 100,
  targetPersistentId: 'same',
  toolPersistentId: 'same'
})); assertions += 1;

const fixtureDocument = {
  version: CONTROLLED_PRODUCT_BOOLEAN_FIXTURE_VERSION,
  kind: 'controlled_product_boolean_live_fixture_finalization',
  status: 'ready_for_formal_live_case',
  finalized_at: '2026-07-23T00:00:00.000Z',
  derivation_class: 'controlled_overlapping_manifold_pair_overlay_on_trimble_s6_copy',
  source: {
    sha256: 'd'.repeat(64),
    original_bytes_unchanged: true
  },
  overlay: {
    operation_count: 4,
    operations: ['material', 'material', 'box', 'cylinder'],
    geometry_mutation_performed: true,
    product_context_retained: true,
    original_top_level_entities_preserved: true,
    fixture: 'manifold_box_with_through_cylinder',
    origin_mm: origin,
    separation_margin_mm: 2000,
    isolated_from_source: true,
    positive_3d_overlap: true,
    through_cut: true,
    overlap_mm: [40, 40, 80]
  },
  target: {
    public_id: BOOLEAN_TARGET_ID,
    persistent_id: '1001',
    name_untrusted: BOOLEAN_TARGET_NAME,
    material: BOOLEAN_TARGET_MATERIAL,
    initial_manifold_report: manifoldReport,
    reopened_manifold_report: manifoldReport
  },
  tool: {
    public_id: BOOLEAN_TOOL_ID,
    persistent_id: '1002',
    name_untrusted: BOOLEAN_TOOL_NAME,
    material: BOOLEAN_TOOL_MATERIAL,
    initial_manifold_report: toolReport,
    reopened_manifold_report: toolReport
  },
  artifact: {
    path: '/workspace/product-boolean-manifold.skp',
    sha256: `sha256:${'e'.repeat(64)}`,
    bytes: 1024
  },
  contract: {
    path: '/workspace/product-boolean-manifold.reliability.json',
    sha256: `sha256:${'f'.repeat(64)}`
  },
  identity: {
    model_revision: `sha256:${'1'.repeat(64)}`,
    model_revision_complete: true,
    identity_mode: 'full_recursive',
    top_level_entities_before: 3,
    top_level_entities_after: 5,
    recursive_total_before: 71360,
    recursive_total_after: 71412,
    recursive_entries_materialized: 71412,
    recursive_truncated: false
  },
  runtime_attestation: {
    name: 'queue',
    server_version: '0.1.0-rc.2',
    plugin_version: '0.1.0-rc.2',
    sketchup_version: '26.2.242',
    capability_version: '0.1.0-rc.2-capabilities.7',
    manifest_version: '2026-07-agent-contract-v1.4',
    revision_strategy: 'definition-merkle.v2',
    revision_source_sha256: '2'.repeat(64),
    compatibility_ok: true
  },
  queue_clean: { queue: 0, processing: 0, responses: 0, lock: false },
  release_acceptance: false
};
await validateFixtureDocument(fixtureDocument); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...fixtureDocument,
    overlay: { ...fixtureDocument.overlay, original_top_level_entities_preserved: false }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...fixtureDocument,
    target: {
      ...fixtureDocument.target,
      reopened_manifold_report: {
        ...fixtureDocument.target.reopened_manifold_report,
        is_manifold: false
      }
    }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({ ...fixtureDocument, release_acceptance: true }),
  /fixture document is invalid/
); assertions += 1;

await assert.rejects(
  prepareControlledProductBooleanFixture({ runtime: 'queue', queueRequired: false }),
  /--runtime queue --queue-required/
); assertions += 1;
await assert.rejects(
  prepareControlledProductBooleanFixture({ runtime: 'mock', queueRequired: true }),
  /--runtime queue/
); assertions += 1;

const workspaceStageRoot = path.resolve(
  'output',
  `test-controlled-product-boolean-stage-${process.pid}`
);
const preparationRoot = path.join(workspaceStageRoot, 'preparation');
const artifactRoot = path.join(workspaceStageRoot, 'artifacts');
const staged = await stageControlledProductBooleanFixture({
  preparationRoot,
  artifactRoot,
  runId: 'offline-unit'
});
assert.equal(staged.queue_called, false); assertions += 1;
assert.equal(
  (await fs.stat(staged.working_path)).size,
  (await fs.stat(path.resolve('test', '模型', 'Trimble S6.skp'))).size
); assertions += 1;
const loadedStage = await loadStagedProductBooleanFixture({
  preparationRoot,
  artifactRoot,
  runId: 'offline-unit'
});
assert.equal(loadedStage.workingPath, staged.working_path); assertions += 1;
assert.equal(loadedStage.sourceSha256, staged.source_sha256); assertions += 1;
await assert.rejects(
  stageControlledProductBooleanFixture({
    preparationRoot,
    artifactRoot,
    runId: '../escape'
  }),
  /filesystem-safe/
); assertions += 1;
await fs.rm(workspaceStageRoot, { recursive: true, force: true });

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-controlled-product-boolean-fixture-'));
const noArgs = spawnSync(process.execPath, ['scripts/prepare-product-boolean-manifold-live-fixture.mjs'], {
  cwd: path.resolve('.'),
  encoding: 'utf8',
  env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: path.join(tempRoot, 'queue-state') }
});
assert.equal(noArgs.status, 2); assertions += 1;
assert.match(noArgs.stderr, /--runtime queue --queue-required/); assertions += 1;
assert.equal(await fs.lstat(path.join(tempRoot, 'queue-state')).catch(() => null), null); assertions += 1;
await fs.rm(tempRoot, { recursive: true, force: true });

process.stdout.write(`${JSON.stringify({
  ok: true,
  preparation_default_queue_calls: 0,
  operation_count: operations.length,
  controlled_positive_overlap: true,
  boolean_not_executed_during_preparation: true,
  full_recursive_contract: true,
  bounded_contract: true,
  filesystem_only_stage_queue_called: false,
  staged_copy_hash_bound: true,
  negative_paths_fail_closed: true,
  assertions
}, null, 2)}\n`);
