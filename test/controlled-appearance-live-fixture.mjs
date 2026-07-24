import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  APPEARANCE_FIXTURE_IDS,
  APPEARANCE_FIXTURE_NAMES,
  APPEARANCE_MATERIAL_NAME,
  APPEARANCE_SCENE_NAME,
  APPEARANCE_UV_ID,
  assertAppearanceSnapshot,
  buildAppearanceScenesHiddenContract,
  controlledAppearanceFixtureOperations,
  prepareControlledAppearanceFixture,
  resolveAppearanceTargets,
  validateFixtureDocument
} from '../scripts/prepare-appearance-scenes-hidden-live-fixture.mjs';

let assertions = 0;
const texturePath = path.resolve('test', 'ScreenShot_2026-04-30_165028_429.png');
const textureStat = await fs.lstat(texturePath);
assert.equal(textureStat.isFile(), true); assertions += 1;
const textureSha256 = crypto.createHash('sha256').update(await fs.readFile(texturePath)).digest('hex');
const operations = controlledAppearanceFixtureOperations([1000, 2000, 3000], texturePath);
assert.equal(operations.length, 6); assertions += 1;
assert.deepEqual(
  operations.map((operation) => operation.op),
  ['material', 'box', 'face_uv', 'box', 'set_visibility', 'scene']
); assertions += 1;
assert.equal(operations.some((operation) => ['reset', 'delete', 'run_ruby_expert'].includes(operation.op)), false); assertions += 1;
assert.equal(operations[0].texture.path, texturePath); assertions += 1;
assert.equal(operations[1].id, APPEARANCE_FIXTURE_IDS.uv_target); assertions += 1;
assert.equal(operations[1].name, APPEARANCE_FIXTURE_NAMES.uv_target); assertions += 1;
assert.equal(operations[2].target_id, APPEARANCE_FIXTURE_IDS.uv_target); assertions += 1;
assert.equal(operations[2].uv_id, APPEARANCE_UV_ID); assertions += 1;
assert.equal(operations[3].id, APPEARANCE_FIXTURE_IDS.hidden_target); assertions += 1;
assert.equal(operations[4].visible, false); assertions += 1;
assert.equal(operations[5].name, APPEARANCE_SCENE_NAME); assertions += 1;
assert.deepEqual(operations[1].origin, [1000, 2000, 3000]); assertions += 1;
assert.deepEqual(operations[3].origin, [2600, 2000, 3000]); assertions += 1;

const entities = [
  {
    id: APPEARANCE_FIXTURE_IDS.uv_target,
    persistent_id: '101',
    name: APPEARANCE_FIXTURE_NAMES.uv_target,
    visible: true,
    material: APPEARANCE_MATERIAL_NAME,
    face_uvs: [{
      id: APPEARANCE_UV_ID,
      material: APPEARANCE_MATERIAL_NAME,
      projection: 'explicit',
      selector: { type: 'index', value: 0 },
      uv: [[0, 0], [2, 0], [2, 1], [0, 1]]
    }]
  },
  {
    id: APPEARANCE_FIXTURE_IDS.hidden_target,
    persistent_id: '102',
    name: APPEARANCE_FIXTURE_NAMES.hidden_target,
    visible: false,
    material: APPEARANCE_MATERIAL_NAME,
    face_uvs: null
  }
];
const snapshot = {
  groups: entities,
  instances: [],
  materials: [{
    name: APPEARANCE_MATERIAL_NAME,
    color: '#6a8fc8',
    texture: { path: texturePath, width: 1200, height: 800 }
  }],
  material_names: [APPEARANCE_MATERIAL_NAME],
  scenes: [{ name: APPEARANCE_SCENE_NAME }],
  warnings: []
};
const targets = resolveAppearanceTargets(entities);
assert.deepEqual(Object.keys(targets), ['uv_target', 'hidden_target']); assertions += 1;
assert.equal(assertAppearanceSnapshot(snapshot, targets), true); assertions += 1;
assert.throws(
  () => assertAppearanceSnapshot(snapshot, {
    ...targets,
    uv_target: { ...targets.uv_target, face_uvs: [] }
  }),
  /no face_uv payload|exactly one face_uv payload/
); assertions += 1;
assert.throws(
  () => assertAppearanceSnapshot(snapshot, {
    ...targets,
    hidden_target: { ...targets.hidden_target, visible: true }
  }),
  /hidden target is visible/
); assertions += 1;
assert.throws(
  () => assertAppearanceSnapshot({ ...snapshot, scenes: [] }, targets),
  /Scene is missing/
); assertions += 1;

const contract = buildAppearanceScenesHiddenContract({
  artifactSha256: `sha256:${'a'.repeat(64)}`,
  entities: 10,
  recursiveTotal: 6000,
  targets
});
const contractSchema = JSON.parse(await fs.readFile(
  new URL('../schema/real-model-reliability-live-case-v1.schema.json', import.meta.url),
  'utf8'
));
const validateContract = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(contractSchema);
assert.equal(validateContract(contract), true, JSON.stringify(validateContract.errors, null, 2)); assertions += 1;
assert.equal(contract.case_id, 'appearance-scenes-hidden'); assertions += 1;
assert.equal(contract.expectations.identity_mode, 'full_recursive'); assertions += 1;
assert.deepEqual(contract.expectations.uv_target_roles, ['uv_target']); assertions += 1;
assert.deepEqual(contract.expectations.hidden_target_roles, ['hidden_target']); assertions += 1;
assert.deepEqual(contract.targets, {
  uv_target: { persistent_id: '101' },
  hidden_target: { persistent_id: '102' }
}); assertions += 1;

const finalizationDocument = {
  version: 'controlled-appearance-live-fixture.v1',
  kind: 'controlled_appearance_live_fixture_finalization',
  status: 'ready_for_formal_live_case',
  finalized_at: '2026-07-23T00:00:00.000Z',
  derivation_class: 'controlled_fixture_overlay_on_user_authorized_real_model_copy',
  source: { sha256: 'b'.repeat(64), original_bytes_unchanged: true },
  texture: {
    sha256: textureSha256,
    input_bytes_unchanged: true,
    embedded_material_texture_observed: true
  },
  artifact: {
    path: '/workspace/appearance-scenes-hidden.skp',
    sha256: `sha256:${'c'.repeat(64)}`,
    bytes: 1024
  },
  contract: {
    path: '/workspace/appearance-scenes-hidden.reliability.json',
    sha256: `sha256:${'d'.repeat(64)}`
  },
  targets: {
    uv_target: {
      persistent_id: '101',
      name_untrusted: APPEARANCE_FIXTURE_NAMES.uv_target,
      visible: true,
      face_uv_payload_count: 1
    },
    hidden_target: {
      persistent_id: '102',
      name_untrusted: APPEARANCE_FIXTURE_NAMES.hidden_target,
      visible: false,
      face_uv_payload_count: 0
    }
  },
  appearance: {
    material_name_untrusted: APPEARANCE_MATERIAL_NAME,
    scene_name_untrusted: APPEARANCE_SCENE_NAME,
    uv_id: APPEARANCE_UV_ID,
    face_uv_operation_applied_without_warning: true,
    face_uv_payload_persisted: true,
    textured_material_persisted: true,
    hidden_target_persisted: true
  },
  identity: {
    model_revision: `sha256:${'e'.repeat(64)}`,
    model_revision_complete: true,
    recursive_total: 6000,
    recursive_materialized: 6000,
    recursive_truncated: false
  },
  runtime_attestation: {
    name: 'queue',
    server_version: '0.1.0-rc.2',
    plugin_version: '0.1.0-rc.2',
    sketchup_version: '26.2.242',
    capability_version: '0.1.0-rc.2-capabilities.7',
    manifest_version: '2026-07-agent-contract-v1.4',
    boolean_operations_sha256: 'f'.repeat(64),
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
    targets: {
      ...finalizationDocument.targets,
      hidden_target: { ...finalizationDocument.targets.hidden_target, visible: true }
    }
  }),
  /fixture document is invalid|must be equal to constant/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    targets: {
      ...finalizationDocument.targets,
      uv_target: { ...finalizationDocument.targets.uv_target, face_uv_payload_count: 0 }
    }
  }),
  /fixture document is invalid|must be equal to constant/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    appearance: {
      ...finalizationDocument.appearance,
      face_uv_operation_applied_without_warning: false
    }
  }),
  /fixture document is invalid|must be equal to constant/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({ ...finalizationDocument, release_acceptance: true }),
  /fixture document is invalid|must be equal to constant/
); assertions += 1;

await assert.rejects(
  prepareControlledAppearanceFixture({ runtime: 'queue', queueRequired: false }),
  /--runtime queue --queue-required/
); assertions += 1;
await assert.rejects(
  prepareControlledAppearanceFixture({ runtime: 'mock', queueRequired: true }),
  /--runtime queue/
); assertions += 1;

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-controlled-appearance-fixture-'));
const noArgs = spawnSync(process.execPath, ['scripts/prepare-appearance-scenes-hidden-live-fixture.mjs'], {
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
  open_ruby_used: false,
  tracked_texture_sha256: textureSha256,
  full_recursive_contract: true,
  uv_evidence_kind: 'face_uvs',
  negative_paths_fail_closed: true,
  assertions
}, null, 2)}\n`);
