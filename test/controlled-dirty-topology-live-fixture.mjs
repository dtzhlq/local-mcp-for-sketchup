import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CONTROLLED_DIRTY_TOPOLOGY_FIXTURE_VERSION,
  CONTROLLED_FIXTURE_ACTIVATION_TIMEOUT_MS,
  DIRTY_TOPOLOGY_TARGET_ID,
  DIRTY_TOPOLOGY_TARGET_NAME,
  EXPECTED_DIRTY_TOPOLOGY_ISSUES,
  RELIABILITY_HANDSHAKE_TTL_MS,
  assertActiveSavedArtifact,
  assertActivePristineWorkingCopy,
  assertDirtyTopologySnapshot,
  buildImportedDirtyTopologyContract,
  controlledDirtyTopologyFixtureOperations,
  controlledFixtureActivationTimeout,
  deriveIsolatedFixtureOrigin,
  prepareControlledImportedDirtyTopologyFixture,
  validateFixtureDocument
} from '../scripts/prepare-imported-dirty-topology-live-fixture.mjs';

let assertions = 0;
assert.equal(RELIABILITY_HANDSHAKE_TTL_MS, 300000); assertions += 1;
assert.equal(CONTROLLED_FIXTURE_ACTIVATION_TIMEOUT_MS, 600000); assertions += 1;
assert.equal(controlledFixtureActivationTimeout(3600000), 600000); assertions += 1;
assert.equal(controlledFixtureActivationTimeout(30000), 30000); assertions += 1;
assert.throws(() => controlledFixtureActivationTimeout(0), /positive finite/); assertions += 1;
const pristineWorkingPath = '/workspace/working-copy.skp';
const pristineContract = {
  model_revision_complete: true,
  model_modified: false,
  model_identity: { source_path: pristineWorkingPath }
};
assert.equal(assertActivePristineWorkingCopy(pristineContract, pristineWorkingPath), pristineContract); assertions += 1;
assert.throws(
  () => assertActivePristineWorkingCopy({ ...pristineContract, model_modified: true }, pristineWorkingPath),
  /unsaved modifications/
); assertions += 1;
assert.throws(
  () => assertActivePristineWorkingCopy(pristineContract, '/workspace/other.skp'),
  /not the requested working copy/
); assertions += 1;
const savedArtifactContract = {
  model_revision_complete: true,
  model_modified: false,
  model_identity: { source_path: '/workspace/imported-dirty-topology.skp' }
};
assert.equal(
  assertActiveSavedArtifact(savedArtifactContract, '/workspace/imported-dirty-topology.skp'),
  savedArtifactContract
); assertions += 1;
assert.throws(
  () => assertActiveSavedArtifact({ ...savedArtifactContract, model_modified: true }, '/workspace/imported-dirty-topology.skp'),
  /must be clean/
); assertions += 1;
const operations = controlledDirtyTopologyFixtureOperations([1000, 2000, 3000]);
assert.equal(operations.length, 1); assertions += 1;
assert.equal(operations[0].op, 'geometry_input'); assertions += 1;
assert.equal(operations[0].id, DIRTY_TOPOLOGY_TARGET_ID); assertions += 1;
assert.equal(operations[0].name, DIRTY_TOPOLOGY_TARGET_NAME); assertions += 1;
assert.equal(operations[0].vertices.length, 10); assertions += 1;
assert.equal(operations[0].faces.length, 6); assertions += 1;
assert.deepEqual(operations[0].edges, [[8, 9]]); assertions += 1;
assert.deepEqual(operations[0].vertices[0], [1000, 2000, 3000]); assertions += 1;
assert.deepEqual(operations[0].vertices[9], [1150, 2100, 3000]); assertions += 1;
assert.equal(operations.some((operation) => ['reset', 'delete', 'manifold_repair'].includes(operation.op)), false); assertions += 1;
assert.throws(() => controlledDirtyTopologyFixtureOperations([0, Number.NaN, 0]), /finite coordinates/); assertions += 1;

const placement = deriveIsolatedFixtureOrigin({
  entities: [
    { bounding_box: { min: [-100, -200, -300], max: [500, 600, 700] } },
    { bounding_box: { min: [300, 400, -100], max: [900, 1000, 1100] } }
  ],
  snapshot: { bounding_box: { min: [-100, -200, -300], max: [900, 1000, 1100] } }
});
assert.deepEqual(placement.origin, [2900, -200, -300]); assertions += 1;
assert.equal(placement.margin_mm, 2000); assertions += 1;
assert.deepEqual(placement.source_bounds, { min: [-100, -200, -300], max: [900, 1000, 1100] }); assertions += 1;
assert.throws(() => deriveIsolatedFixtureOrigin({ entities: [] }), /finite world bounding box/); assertions += 1;
assert.throws(() => deriveIsolatedFixtureOrigin({ entities: [{ bounding_box: { min: [0, 0, 0], max: [1, 1, 1] } }] }, 999), /at least 1000/); assertions += 1;

const contract = buildImportedDirtyTopologyContract({
  artifactSha256: `sha256:${'a'.repeat(64)}`,
  entities: 3,
  recursiveTotal: 1903697,
  repairTargetPersistentId: '987654'
});
const fullContract = buildImportedDirtyTopologyContract({
  artifactSha256: `sha256:${'b'.repeat(64)}`,
  entities: 3,
  recursiveTotal: 1000,
  repairTargetPersistentId: '123456'
});
const contractSchema = JSON.parse(await fs.readFile(
  new URL('../schema/real-model-reliability-live-case-v1.schema.json', import.meta.url),
  'utf8'
));
const validateContract = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(contractSchema);
assert.equal(validateContract(contract), true, JSON.stringify(validateContract.errors, null, 2)); assertions += 1;
assert.equal(validateContract(fullContract), true, JSON.stringify(validateContract.errors, null, 2)); assertions += 1;
assert.equal(contract.case_id, 'imported-dirty-topology'); assertions += 1;
assert.equal(contract.artifact_file, 'imported-dirty-topology.skp'); assertions += 1;
assert.deepEqual(contract.targets, { repair_target: { persistent_id: '987654' } }); assertions += 1;
assert.deepEqual(contract.expectations.expected_topology_issue_codes, ['boundary_edges']); assertions += 1;
assert.equal(contract.expectations.identity_mode, 'complete_revision_bounded_occurrence_sample'); assertions += 1;
assert.equal(fullContract.expectations.identity_mode, 'full_recursive'); assertions += 1;
const missingIssues = structuredClone(contract);
delete missingIssues.expectations.expected_topology_issue_codes;
assert.equal(validateContract(missingIssues), true, 'schema keeps topology codes optional for non-dirty historical contracts'); assertions += 1;
assert.throws(
  () => buildImportedDirtyTopologyContract({
    artifactSha256: `sha256:${'c'.repeat(64)}`,
    entities: 3,
    recursiveTotal: 100,
    repairTargetPersistentId: ''
  }),
  /repairTargetPersistentId/
); assertions += 1;

const dirtySnapshot = {
  manifold_checks: [{
    id: 'controlled-dirty-topology-baseline',
    op: 'manifold_check',
    ok: false,
    targets: [{
      id: DIRTY_TOPOLOGY_TARGET_ID,
      name: DIRTY_TOPOLOGY_TARGET_NAME,
      is_manifold: false,
      method: 'sketchup_manifold_api',
      faces: 6,
      edges: 13,
      vertices: 10,
      issues: ['sketchup_manifold_false', 'boundary_edges']
    }]
  }]
};
assert.deepEqual(assertDirtyTopologySnapshot(dirtySnapshot), {
  is_manifold: false,
  method: 'sketchup_manifold_api',
  faces: 6,
  edges: 13,
  vertices: 10,
  issues: ['boundary_edges', 'sketchup_manifold_false']
}); assertions += 1;
assert.throws(
  () => assertDirtyTopologySnapshot({
    manifold_checks: [{
      ...dirtySnapshot.manifold_checks[0],
      targets: [{ ...dirtySnapshot.manifold_checks[0].targets[0], issues: ['sketchup_manifold_false'] }]
    }]
  }),
  /missing boundary_edges/
); assertions += 1;
assert.throws(
  () => assertDirtyTopologySnapshot({
    manifold_checks: [{
      ...dirtySnapshot.manifold_checks[0],
      ok: true
    }]
  }),
  /unexpectedly passed/
); assertions += 1;
assert.deepEqual(EXPECTED_DIRTY_TOPOLOGY_ISSUES, ['boundary_edges']); assertions += 1;

const finalizationDocument = {
  version: CONTROLLED_DIRTY_TOPOLOGY_FIXTURE_VERSION,
  kind: 'controlled_dirty_topology_live_fixture_finalization',
  status: 'ready_for_formal_live_case',
  finalized_at: '2026-07-23T00:00:00.000Z',
  derivation_class: 'controlled_loose_edge_overlay_on_user_authorized_imported_model_copy',
  working_copy_mode: 'resumed_byte_exact_pristine_copy',
  recovery: null,
  source: { sha256: 'd'.repeat(64), original_bytes_unchanged: true },
  overlay: {
    operation_count: 1,
    operations: ['geometry_input'],
    geometry_mutation_performed: true,
    imported_context_retained: true,
    original_top_level_entities_preserved: true,
    defect_fixture: 'closed_box_plus_one_isolated_loose_edge',
    origin_mm: [2900, -200, -300],
    separation_margin_mm: 2000
  },
  repair_target: {
    public_id: DIRTY_TOPOLOGY_TARGET_ID,
    persistent_id: '987654',
    name_untrusted: DIRTY_TOPOLOGY_TARGET_NAME,
    expected_issue_codes: ['boundary_edges'],
    initial_report: assertDirtyTopologySnapshot(dirtySnapshot),
    reopened_report: assertDirtyTopologySnapshot(dirtySnapshot),
    repair_performed_during_preparation: false
  },
  artifact: {
    path: '/workspace/imported-dirty-topology.skp',
    sha256: `sha256:${'e'.repeat(64)}`,
    bytes: 1024
  },
  contract: {
    path: '/workspace/imported-dirty-topology.reliability.json',
    sha256: `sha256:${'f'.repeat(64)}`
  },
  identity: {
    model_revision: `sha256:${'1'.repeat(64)}`,
    model_revision_complete: true,
    identity_mode: 'complete_revision_bounded_occurrence_sample',
    top_level_entities_before: 2,
    top_level_entities_after: 3,
    recursive_total_before: 1903677,
    recursive_total_after: 1903697,
    recursive_entries_materialized: 100000,
    recursive_truncated: true
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
  session_contract_ttl_ms: RELIABILITY_HANDSHAKE_TTL_MS,
  queue_clean: { queue: 0, processing: 0, responses: 0, lock: false },
  release_acceptance: false
};
await validateFixtureDocument(finalizationDocument); assertions += 1;
await validateFixtureDocument({
  ...finalizationDocument,
  working_copy_mode: 'recovered_saved_artifact_after_document_focus_drift',
  recovery: {
    mode: 'post_save_active_artifact_recovery',
    reason_code: 'HANDSHAKE_DOCUMENT_MISMATCH',
    active_artifact_path_verified: true,
    artifact_clean_after_save: true,
    source_profile_path: '/workspace/source-profile.json',
    source_profile_sha256: `sha256:${'3'.repeat(64)}`,
    source_top_level_entities: 2,
    artifact_non_target_top_level_entities: 2,
    pre_save_isolation_assertions_precede_guarded_save_in_preparer: true
  }
}); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    overlay: { ...finalizationDocument.overlay, original_top_level_entities_preserved: false }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    repair_target: { ...finalizationDocument.repair_target, repair_performed_during_preparation: true }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    repair_target: {
      ...finalizationDocument.repair_target,
      initial_report: { ...finalizationDocument.repair_target.initial_report, issues: ['sketchup_manifold_false'] }
    }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({
    ...finalizationDocument,
    queue_clean: { ...finalizationDocument.queue_clean, queue: 1 }
  }),
  /fixture document is invalid/
); assertions += 1;
await assert.rejects(
  validateFixtureDocument({ ...finalizationDocument, release_acceptance: true }),
  /fixture document is invalid/
); assertions += 1;

await assert.rejects(
  prepareControlledImportedDirtyTopologyFixture({ runtime: 'queue', queueRequired: false }),
  /--runtime queue --queue-required/
); assertions += 1;
await assert.rejects(
  prepareControlledImportedDirtyTopologyFixture({ runtime: 'mock', queueRequired: true }),
  /--runtime queue/
); assertions += 1;

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-controlled-dirty-topology-fixture-'));
const noArgs = spawnSync(process.execPath, ['scripts/prepare-imported-dirty-topology-live-fixture.mjs'], {
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
  defect_fixture: 'closed_box_plus_one_isolated_loose_edge',
  expected_issue_codes: EXPECTED_DIRTY_TOPOLOGY_ISSUES,
  verified_artifact_required_by_runner: true,
  negative_paths_fail_closed: true,
  assertions
}, null, 2)}\n`);
