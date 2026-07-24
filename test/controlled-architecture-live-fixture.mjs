import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  ARCHITECTURE_MATERIAL_NAME,
  ARCHITECTURE_SCENE_NAME,
  assertArchitectureSnapshot,
  buildArchitectureGoldenContract,
  controlledArchitectureFixtureOperations,
  prepareControlledArchitectureFixture,
  validateFixtureDocument
} from '../scripts/prepare-architecture-golden-live-fixture.mjs';

let assertions = 0;
const operations = controlledArchitectureFixtureOperations();
assert.equal(operations.length, 2); assertions += 1;
assert.deepEqual(operations.map((operation) => operation.op), ['material', 'scene']); assertions += 1;
assert.equal(operations.some((operation) => ['box', 'reset', 'delete', 'run_ruby_expert'].includes(operation.op)), false); assertions += 1;
assert.equal(operations[0].name, ARCHITECTURE_MATERIAL_NAME); assertions += 1;
assert.equal(operations[1].name, ARCHITECTURE_SCENE_NAME); assertions += 1;

const snapshot = {
  materials: [{ name: ARCHITECTURE_MATERIAL_NAME, color: '#b8a68f' }],
  material_names: [ARCHITECTURE_MATERIAL_NAME],
  scenes: [{ name: ARCHITECTURE_SCENE_NAME }]
};
assert.equal(assertArchitectureSnapshot(snapshot), true); assertions += 1;
assert.throws(
  () => assertArchitectureSnapshot({ ...snapshot, materials: [], material_names: [] }),
  /material is missing/
); assertions += 1;
assert.throws(
  () => assertArchitectureSnapshot({ ...snapshot, scenes: [] }),
  /Scene is missing/
); assertions += 1;

const fullContract = buildArchitectureGoldenContract({
  artifactSha256: `sha256:${'a'.repeat(64)}`,
  entities: 1,
  recursiveTotal: 5897
});
const boundedContract = buildArchitectureGoldenContract({
  artifactSha256: `sha256:${'b'.repeat(64)}`,
  entities: 2,
  recursiveTotal: 220006
});
const contractSchema = JSON.parse(await fs.readFile(
  new URL('../schema/real-model-reliability-live-case-v1.schema.json', import.meta.url),
  'utf8'
));
const validateContract = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(contractSchema);
assert.equal(validateContract(fullContract), true, JSON.stringify(validateContract.errors, null, 2)); assertions += 1;
assert.equal(validateContract(boundedContract), true, JSON.stringify(validateContract.errors, null, 2)); assertions += 1;
assert.equal(fullContract.case_id, 'architecture-golden'); assertions += 1;
assert.equal(fullContract.artifact_file, 'architecture-building.skp'); assertions += 1;
assert.deepEqual(fullContract.targets, {}); assertions += 1;
assert.equal(fullContract.expectations.identity_mode, 'full_recursive'); assertions += 1;
assert.equal(boundedContract.expectations.identity_mode, 'complete_revision_bounded_occurrence_sample'); assertions += 1;
assert.deepEqual(fullContract.expectations.required_materials, [ARCHITECTURE_MATERIAL_NAME]); assertions += 1;
assert.equal(fullContract.expectations.minimum_scenes, 1); assertions += 1;

const finalizationDocument = {
  version: 'controlled-architecture-live-fixture.v1',
  kind: 'controlled_architecture_live_fixture_finalization',
  status: 'ready_for_formal_live_case',
  finalized_at: '2026-07-23T00:00:00.000Z',
  derivation_class: 'controlled_metadata_overlay_on_user_authorized_real_model_copy',
  source: { sha256: 'c'.repeat(64), original_bytes_unchanged: true },
  overlay: {
    operation_count: 2,
    operations: ['material', 'scene'],
    geometry_mutation_performed: false,
    material_name_untrusted: ARCHITECTURE_MATERIAL_NAME,
    material_persisted: true,
    scene_name_untrusted: ARCHITECTURE_SCENE_NAME,
    scene_persisted: true
  },
  artifact: {
    path: '/workspace/architecture-building.skp',
    sha256: `sha256:${'d'.repeat(64)}`,
    bytes: 1024
  },
  contract: {
    path: '/workspace/architecture-building.reliability.json',
    sha256: `sha256:${'e'.repeat(64)}`
  },
  identity: {
    model_revision: `sha256:${'f'.repeat(64)}`,
    model_revision_complete: true,
    top_level_entities_before: 1,
    top_level_entities_after: 1,
    recursive_total_before: 5897,
    recursive_total_after: 5897,
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
    revision_source_sha256: '1'.repeat(64),
    compatibility_ok: true
  },
  queue_clean: { queue: 0, processing: 0, responses: 0, lock: false },
  release_acceptance: false
};
await validateFixtureDocument(finalizationDocument); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    overlay: { ...finalizationDocument.overlay, geometry_mutation_performed: true }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    identity: { ...finalizationDocument.identity, recursive_total_after: 0 }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    queue_clean: { ...finalizationDocument.queue_clean, lock: true }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({ ...finalizationDocument, release_acceptance: true }),
  /fixture document is invalid/
); assertions += 1;

await assert.rejects(
  prepareControlledArchitectureFixture({ runtime: 'queue', queueRequired: false }),
  /--runtime queue --queue-required/
); assertions += 1;
await assert.rejects(
  prepareControlledArchitectureFixture({ runtime: 'mock', queueRequired: true }),
  /--runtime queue/
); assertions += 1;

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-controlled-architecture-fixture-'));
const noArgs = spawnSync(process.execPath, ['scripts/prepare-architecture-golden-live-fixture.mjs'], {
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
  geometry_mutation_performed: false,
  full_recursive_contract: true,
  bounded_contract: true,
  negative_paths_fail_closed: true,
  assertions
}, null, 2)}\n`);
