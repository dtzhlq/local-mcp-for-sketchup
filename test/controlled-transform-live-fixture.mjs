import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  FIXTURE_IDS,
  FIXTURE_NAMES,
  buildScaledMirroredLockedContract,
  controlledTransformFixtureOperations,
  finalizeControlledTransformFixture,
  prepareControlledTransformFixture,
  validateFixtureDocument
} from '../scripts/prepare-scaled-mirrored-locked-live-fixture.mjs';

let assertions = 0;
const operations = controlledTransformFixtureOperations([1000, 2000, 3000]);
assert.equal(operations.length, 4); assertions += 1;
assert.deepEqual(operations.map((operation) => operation.op), ['material', 'box', 'box', 'box']); assertions += 1;
assert.equal(operations.some((operation) => ['reset', 'delete', 'run_ruby_expert'].includes(operation.op)), false); assertions += 1;
assert.deepEqual(operations.slice(1).map((operation) => operation.id), Object.values(FIXTURE_IDS)); assertions += 1;
assert.deepEqual(operations.slice(1).map((operation) => operation.name), Object.values(FIXTURE_NAMES)); assertions += 1;
assert.deepEqual(operations[1].origin, [1000, 2000, 3000]); assertions += 1;
assert.deepEqual(operations[3].origin, [2200, 2000, 3000]); assertions += 1;

const targetFixture = {
  locked_target: { persistent_id: '101' },
  guard_target: { persistent_id: '102' },
  transform_target: { persistent_id: '103' }
};
const fullContract = buildScaledMirroredLockedContract({
  artifactSha256: `sha256:${'a'.repeat(64)}`,
  entities: 7,
  recursiveTotal: 12887,
  targets: targetFixture
});
const boundedContract = buildScaledMirroredLockedContract({
  artifactSha256: `sha256:${'b'.repeat(64)}`,
  entities: 7,
  recursiveTotal: 220006,
  targets: targetFixture
});
const schema = JSON.parse(await fs.readFile(new URL('../schema/real-model-reliability-live-case-v1.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(fullContract), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.equal(validate(boundedContract), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.equal(fullContract.case_id, 'scaled-mirrored-locked'); assertions += 1;
assert.equal(fullContract.expectations.identity_mode, 'full_recursive'); assertions += 1;
assert.equal(boundedContract.expectations.identity_mode, 'complete_revision_bounded_occurrence_sample'); assertions += 1;
assert.deepEqual(fullContract.targets, {
  locked_target: { persistent_id: '101' },
  guard_target: { persistent_id: '102' },
  transform_target: { persistent_id: '103' }
}); assertions += 1;

const preparationDocument = {
  version: 'controlled-transform-live-fixture.v1',
  kind: 'controlled_transform_live_fixture_preparation',
  status: 'awaiting_native_lock',
  prepared_at: '2026-07-23T00:00:00.000Z',
  source: { path: '/workspace/source.skp', sha256: 'c'.repeat(64) },
  working_path: '/workspace/working.skp',
  active_path_after_prepare: '/workspace/unlocked.skp',
  unlocked_checkpoint: { path: '/workspace/unlocked.skp', sha256: 'd'.repeat(64) },
  final_artifact_path: '/workspace/final.skp',
  final_contract_path: '/workspace/final.reliability.json',
  fixture_origin_mm: [1, 2, 3],
  fixture_ids: FIXTURE_IDS,
  fixture_names: FIXTURE_NAMES,
  model_revision_before: `sha256:${'e'.repeat(64)}`,
  model_revision_after_fixture_insert: null,
  runtime_attestation: {
    name: 'queue',
    server_version: '0.1.0-rc.2',
    plugin_version: '0.1.0-rc.2',
    sketchup_version: '26.2.242',
    capability_version: '0.1.0-rc.2-capabilities.7',
    manifest_version: '2026-07-agent-contract-v1.4',
    revision_strategy: 'definition-merkle.v2',
    revision_source_sha256: 'f'.repeat(64),
    compatibility_ok: true
  },
  native_lock_instruction: 'Lock the exact selected fixture target.',
  original_bytes_unchanged: true,
  queue_clean: { queue: 0, processing: 0, responses: 0, lock: false }
};
await validateFixtureDocument(preparationDocument); assertions += 1;
const finalizationDocument = {
  version: 'controlled-transform-live-fixture.v1',
  kind: 'controlled_transform_live_fixture_finalization',
  status: 'ready_for_formal_live_case',
  finalized_at: '2026-07-23T00:01:00.000Z',
  derivation_class: 'controlled_fixture_overlay_on_user_authorized_real_model_copy',
  source: { sha256: 'c'.repeat(64), original_bytes_unchanged: true },
  artifact: { path: '/workspace/final.skp', sha256: `sha256:${'1'.repeat(64)}`, bytes: 1024 },
  contract: { path: '/workspace/final.reliability.json', sha256: `sha256:${'2'.repeat(64)}` },
  native_lock: { target_persistent_id: '101', observed_before_save: true, observed_after_reopen: true },
  targets: {
    locked_target: { persistent_id: '101', name_untrusted: FIXTURE_NAMES.locked_target, locked: true },
    guard_target: { persistent_id: '102', name_untrusted: FIXTURE_NAMES.guard_target, locked: false },
    transform_target: { persistent_id: '103', name_untrusted: FIXTURE_NAMES.transform_target, locked: false }
  },
  identity: {
    model_revision: `sha256:${'3'.repeat(64)}`,
    model_revision_complete: true,
    recursive_total: 100,
    recursive_materialized: 100,
    recursive_truncated: false
  },
  queue_clean: { queue: 0, processing: 0, responses: 0, lock: false },
  release_acceptance: false
};
await validateFixtureDocument(finalizationDocument); assertions += 1;
await assert.rejects(
  validateFixtureDocument({ ...preparationDocument, queue_clean: { ...preparationDocument.queue_clean, lock: true } }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    targets: {
      ...finalizationDocument.targets,
      locked_target: { ...finalizationDocument.targets.locked_target, locked: false }
    }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({ ...finalizationDocument, release_acceptance: true }),
  /fixture document is invalid/
); assertions += 1;

await assert.rejects(
  prepareControlledTransformFixture({ runtime: 'queue', queueRequired: false }),
  /--runtime queue --queue-required/
); assertions += 1;
await assert.rejects(
  prepareControlledTransformFixture({ runtime: 'mock', queueRequired: true }),
  /--runtime queue/
); assertions += 1;
await assert.rejects(
  finalizeControlledTransformFixture({ runtime: 'queue', queueRequired: false, statePath: 'unused' }),
  /--runtime queue --queue-required/
); assertions += 1;

const tamperRoot = await fs.mkdtemp(path.join(path.resolve('output'), 'test-controlled-transform-state-'));
const packagePath = path.resolve('package.json');
const packageSha256 = crypto.createHash('sha256').update(await fs.readFile(packagePath)).digest('hex');
const tamperedStatePath = path.join(tamperRoot, 'preparation-state.v1.json');
const tamperedState = {
  ...preparationDocument,
  source: { path: packagePath, sha256: packageSha256 },
  working_path: packagePath,
  active_path_after_prepare: null,
  unlocked_checkpoint: { path: packagePath, sha256: packageSha256 },
  final_artifact_path: path.join(os.tmpdir(), 'scaled-mirrored-locked.skp'),
  final_contract_path: path.join(os.tmpdir(), 'scaled-mirrored-locked.reliability.json')
};
await fs.writeFile(tamperedStatePath, `${JSON.stringify(tamperedState, null, 2)}\n`, 'utf8');
const policyEnv = {
  ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES: process.env.ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES,
  ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION: process.env.ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION,
  ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION: process.env.ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION
};
process.env.ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES = 'mock,queue';
process.env.ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION = '1';
process.env.ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION = '1';
try {
  await assert.rejects(
    finalizeControlledTransformFixture({ runtime: 'queue', queueRequired: true, statePath: tamperedStatePath }),
    /final artifact must stay inside the workspace/
  ); assertions += 1;
} finally {
  for (const [key, value] of Object.entries(policyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(tamperRoot, { recursive: true, force: true });
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-controlled-transform-fixture-'));
const noArgs = spawnSync(process.execPath, ['scripts/prepare-scaled-mirrored-locked-live-fixture.mjs'], {
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
  full_recursive_contract: true,
  bounded_contract: true,
  locked_role_bound_by_persistent_id: true,
  tampered_state_path_failed_before_queue: true,
  assertions
}, null, 2)}\n`);
