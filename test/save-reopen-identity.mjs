import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  assertSaveReopenRevisionAttestation,
  validateSaveReopenIdentity
} from '../scripts/validate-save-reopen-identity.mjs';
import { MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-save-reopen-identity-'));
try {
  await assert.rejects(
    validateSaveReopenIdentity({ runtime: 'queue', outputDir: path.join(root, 'must-not-run') }),
    /--runtime queue --queue-required/,
    'live save/reopen must require an explicit destructive opt-in'
  );
  await assert.rejects(
    validateSaveReopenIdentity({
      runtime: 'mock',
      outputDir: path.join(root, 'same-path'),
      savePath: path.join(root, 'same.json'),
      intermediaryPath: path.join(root, 'same.json')
    }),
    /must be different files/,
    'same-path open must not be accepted as reopen evidence'
  );

  const report = await validateSaveReopenIdentity({ runtime: 'mock', outputDir: path.join(root, 'mock') });
  assert.equal(report.ok, true);
  assert.equal(report.version, 2);
  assert.equal(report.contract_version, 'save-reopen-identity-report.v2');
  assert.equal(report.runtime, 'mock');
  assert.equal(report.evidence_scope, 'mock_contract_only');
  assert.equal(report.live_proof, false);
  assert.deepEqual(report.destructive_opt_in, {
    required_for_queue: true,
    observed: false,
    resume_is_read_only: true
  });
  assert.equal(report.model_revision_after, report.model_revision_before);
  assert.equal(report.revision_attestation.before.model_revision, report.model_revision_before);
  assert.equal(report.revision_attestation.after.model_revision, report.model_revision_after);
  assert.equal(report.revision_attestation.before.model_revision_strategy, null);
  assert.equal(report.revision_attestation.after.model_revision_strategy, null);
  assert.equal(report.revision_attestation.before.model_revision_source_sha256, null);
  assert.equal(report.revision_attestation.after.model_revision_source_sha256, null);
  assert.equal(report.revision_attestation.before.model_modified, null);
  assert.equal(report.revision_attestation.after.model_modified, null);
  assert.equal(report.revision_attestation.strategy_exact_match, null);
  assert.equal(report.revision_attestation.source_exact_match, null);
  assert.equal(report.revision_attestation.current_source_verified, false);
  assert.equal(report.revision_attestation.after_reopen_clean, false);
  assert.equal(report.identity.signature_after, report.identity.signature_before);
  assert.equal(report.identity.exact_match, true);
  assert.equal(report.identity.shared_leaf_occurrences, 2);
  assert.ok(report.identity.face_edge_entries > 0);
  assert.equal(report.path_switch.verified, true);
  assert.equal(report.path_switch.active_source_path_verified, false);
  assert.equal(report.path_switch.resumed_after_activation, false);
  assert.notEqual(report.path_switch.target_path, report.path_switch.intermediary_path);
  assert.equal(report.path_switch.open_result_path, report.path_switch.target_path);
  assert.equal(report.snapshot_compare.tolerance_mm, 0);
  assert.equal(report.snapshot_compare.diff_count, 0);
  assert.equal(report.snapshot_compare.exact_match, true);
  assert.equal(report.snapshot_compare.verdict, 'pass');
  assert.equal(report.queue_clean, null);
  await fs.access(report.artifacts.report);
  await fs.access(report.artifacts.saved_model);
  await fs.access(report.artifacts.intermediary_model);
  await fs.access(report.artifacts.snapshot_diff);
  await fs.access(report.artifacts.checkpoint);

  const resumed = await validateSaveReopenIdentity({
    runtime: 'mock',
    outputDir: path.join(root, 'mock'),
    resumeAfterOpen: true
  });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.version, 2);
  assert.equal(resumed.live_proof, false);
  assert.equal(resumed.path_switch.resumed_after_activation, true);
  assert.equal(resumed.model_revision_after, report.model_revision_before);

  const [v1Schema, v2Schema] = await Promise.all([
    fs.readFile(path.resolve('schema/save-reopen-identity-report-v1.schema.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.resolve('schema/save-reopen-identity-report-v2.schema.json'), 'utf8').then(JSON.parse)
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validateV1 = ajv.compile(v1Schema);
  const validateV2 = ajv.compile(v2Schema);
  assert.equal(validateV2(report), true, JSON.stringify(validateV2.errors));
  assert.equal(validateV2(resumed), true, JSON.stringify(validateV2.errors));
  assert.equal(validateV1(report), false, 'v2 report must not be represented as the unchanged v1 contract');

  const mockLiveOverclaim = mutate(report, (value) => { value.live_proof = true; });
  assert.equal(validateV2(mockLiveOverclaim), false, 'mock report must not claim live proof');
  const mockStrategyOverclaim = mutate(report, (value) => {
    value.revision_attestation.before.model_revision_strategy = 'definition-merkle.v2';
  });
  assert.equal(validateV2(mockStrategyOverclaim), false, 'mock report must not claim the live revision strategy');
  const queueContractFixture = queueContractShape(report);
  assert.equal(validateV2(queueContractFixture), true, JSON.stringify(validateV2.errors));
  assert.equal(assertSaveReopenRevisionAttestation({
    runtime: 'queue',
    revisionAttestation: queueContractFixture.revision_attestation,
    expectedModelRevisionSourceSha256: MODEL_REVISION_SOURCE_SHA256
  }), true);

  const v1QueueStrategy = mutate(queueContractFixture, (value) => {
    value.revision_attestation.before.model_revision_strategy = 'definition-merkle.v1';
  });
  assert.equal(validateV2(v1QueueStrategy), false, 'queue v2 report must reject definition-merkle.v1');
  const dirtyAfterReopen = mutate(queueContractFixture, (value) => {
    value.revision_attestation.after.model_modified = true;
  });
  assert.equal(validateV2(dirtyAfterReopen), false, 'queue v2 report must require model_modified=false after reopen');
  const staleSource = mutate(queueContractFixture, (value) => {
    value.revision_attestation.before.model_revision_source_sha256 = '0'.repeat(64);
    value.revision_attestation.after.model_revision_source_sha256 = '0'.repeat(64);
  });
  assert.equal(validateV2(staleSource), true, 'schema validates digest shape; runtime assertion binds the current source');
  assert.throws(() => assertSaveReopenRevisionAttestation({
    runtime: 'queue',
    revisionAttestation: staleSource.revision_attestation,
    expectedModelRevisionSourceSha256: MODEL_REVISION_SOURCE_SHA256
  }), /current Model Revision source/);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime: 'mock',
    report_contract: report.contract_version,
    exact_identity_match: true,
    real_path_switch_contract: true,
    resumable_after_mdi_activation: true,
    snapshot_diff_count: report.snapshot_compare.diff_count,
    shared_leaf_occurrences: report.identity.shared_leaf_occurrences,
    explicit_live_opt_in: true,
    mock_live_proof: false,
    queue_contract_shape_only: true,
    queue_current_source_runtime_guard: true,
    live_queue_called: false,
    negative_cases: 7
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function queueContractShape(mockReport) {
  const report = structuredClone(mockReport);
  report.runtime = 'queue';
  report.evidence_scope = 'live_queue_distinct_path_save_reopen';
  report.live_proof = true;
  report.destructive_opt_in.observed = true;
  report.path_switch.active_source_path_verified = true;
  report.revision_attestation = {
    before: {
      model_revision: report.model_revision_before,
      model_revision_strategy: 'definition-merkle.v2',
      model_revision_source_sha256: MODEL_REVISION_SOURCE_SHA256,
      model_modified: true
    },
    after: {
      model_revision: report.model_revision_after,
      model_revision_strategy: 'definition-merkle.v2',
      model_revision_source_sha256: MODEL_REVISION_SOURCE_SHA256,
      model_modified: false
    },
    revision_exact_match: true,
    strategy_exact_match: true,
    source_exact_match: true,
    current_source_verified: true,
    after_reopen_clean: true
  };
  report.queue_clean = { queue: 0, processing: 0, responses: 0, lock: false };
  return report;
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
