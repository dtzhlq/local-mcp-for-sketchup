import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildAppearanceScenesHiddenLiveEvidence } from '../scripts/build-appearance-scenes-hidden-live-evidence.mjs';

const repoRoot = path.resolve('.');
const evidencePath = 'docs/evidence/appearance-scenes-hidden-live-evidence-2026-07-23.json';
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson(evidencePath);
const evidenceSchema = await readJson('schema/appearance-scenes-hidden-live-evidence-v1.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const fixtureSchema = await readJson('schema/controlled-appearance-live-fixture-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateReport = ajv.compile(reportSchema);
const validateFixture = ajv.compile(fixtureSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after capture`); assertions += 1;
}
for (const descriptor of Object.values(evidence.artifacts)) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} hash mismatch`); assertions += 1;
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes); assertions += 1;
}

assert.equal(evidence.source_fixture.original_input_sha256, evidence.artifacts.original_input.sha256); assertions += 1;
assert.equal(evidence.source_fixture.texture_input_sha256, evidence.artifacts.texture_input.sha256); assertions += 1;
assert.equal(`sha256:${evidence.artifacts.source_model.sha256}`, evidence.source_fixture.source_artifact_sha256); assertions += 1;

const finalization = await readJson(evidence.artifacts.finalization_report.path);
assert.equal(validateFixture(finalization), true, JSON.stringify(validateFixture.errors, null, 2)); assertions += 1;
assert.equal(finalization.source.sha256, evidence.artifacts.original_input.sha256); assertions += 1;
assert.equal(finalization.texture.sha256, evidence.artifacts.texture_input.sha256); assertions += 1;
assert.equal(finalization.source.original_bytes_unchanged, true); assertions += 1;
assert.equal(finalization.texture.input_bytes_unchanged, true); assertions += 1;
assert.equal(finalization.appearance.face_uv_operation_applied_without_warning, true); assertions += 1;
assert.equal(finalization.appearance.face_uv_payload_persisted, true); assertions += 1;
assert.equal(finalization.appearance.textured_material_persisted, true); assertions += 1;
assert.equal(finalization.appearance.hidden_target_persisted, true); assertions += 1;
assert.equal(finalization.identity.recursive_total, 5897); assertions += 1;
assert.equal(finalization.identity.recursive_materialized, 5897); assertions += 1;
assert.equal(finalization.identity.recursive_truncated, false); assertions += 1;
assert.deepEqual(finalization.queue_clean, emptyQueue()); assertions += 1;

const report = await readJson(evidence.artifacts.success_report.path);
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assert.equal(report.ok, true); assertions += 1;
assert.equal(report.selected_case.case_id, evidence.case_id); assertions += 1;
assert.equal(report.metrics.tasks_total, 3); assertions += 1;
assert.equal(report.metrics.tasks_passed, 3); assertions += 1;
assert.equal(report.metrics.wrong_object_modification_count, 0); assertions += 1;
assert.equal(report.metrics.silent_geometry_corruption_count, 0); assertions += 1;
assert.equal(report.metrics.recovery_attempts, 0); assertions += 1;
assert.equal(report.metrics.recoveries, 0); assertions += 1;
assert.deepEqual(report.queue_clean, emptyQueue()); assertions += 1;
assert.equal(report.acceptance.release_acceptance, false); assertions += 1;

const tasks = new Map(report.result.tasks.map((task) => [task.task_id, task]));
const uv = tasks.get('uv_material_preservation').evidence;
assert.equal(uv.initial_signature, uv.pre_save_signature); assertions += 1;
assert.equal(uv.pre_save_signature, uv.post_reopen_signature); assertions += 1;
assert.equal(uv.preserved_across_save_reopen, true); assertions += 1;
assert.deepEqual(uv.target_roles, ['uv_target']); assertions += 1;
const presentation = tasks.get('scene_visibility_preservation').evidence;
assert.equal(presentation.hash, presentation.pre_save_hash); assertions += 1;
assert.equal(presentation.pre_save_hash, presentation.post_reopen_hash); assertions += 1;
assert.equal(presentation.preserved_across_save_reopen, true); assertions += 1;
assert.equal(presentation.scenes, 1); assertions += 1;
assert.equal(presentation.hidden_entities, 1); assertions += 1;
const identity = tasks.get('save_reopen_identity').evidence;
assert.equal(identity.exact_match, true); assertions += 1;
assert.equal(identity.entries_before, 5897); assertions += 1;
assert.equal(identity.entries_after, 5897); assertions += 1;
assert.equal(identity.model_revision_exact_match, true); assertions += 1;
assert.equal(identity.snapshot_error_diffs, 0); assertions += 1;

assert.equal(evidence.appearance_contract.uv_evidence_kind, 'face_uvs'); assertions += 1;
assert.equal(evidence.appearance_contract.independent_uvhelper_coordinate_attestation, false); assertions += 1;
assert.equal(evidence.appearance_contract.arbitrary_uv_editing_proven, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeDocuments = [
  { ...evidence, result: 'release_pass' },
  { ...evidence, acceptance: { ...evidence.acceptance, release_acceptance: true } },
  {
    ...evidence,
    appearance_contract: {
      ...evidence.appearance_contract,
      face_uv_payload_persisted: false
    }
  },
  {
    ...evidence,
    live_verification: {
      ...evidence.live_verification,
      hidden_entities: 0
    }
  },
  {
    ...evidence,
    source_fixture: {
      ...evidence.source_fixture,
      original_bytes_unchanged: false
    }
  }
];
for (const document of negativeDocuments) {
  assert.equal(validateEvidence(document), false, 'invalid appearance evidence must fail schema validation');
  assertions += 1;
}

const regeneratedPath = `output/test-appearance-evidence-${process.pid}.json`;
try {
  const regenerated = await buildAppearanceScenesHiddenLiveEvidence({
    outputPath: regeneratedPath,
    capturedAt: evidence.captured_at
  });
  assert.deepEqual(regenerated.evidence, evidence); assertions += 1;
  assert.equal(await sha256File(regeneratedPath), await sha256File(evidencePath)); assertions += 1;
} finally {
  await fs.rm(path.join(repoRoot, regeneratedPath), { force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence: evidencePath,
  tasks_passed: evidence.live_verification.tasks_passed,
  recursive_entries: evidence.live_verification.recursive_entries_after,
  negative_cases: negativeDocuments.length,
  deterministic_regeneration: true,
  assertions
}, null, 2)}\n`);

function emptyQueue() {
  return { queue: 0, processing: 0, responses: 0, lock: false };
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256')
    .update(await fs.readFile(path.join(repoRoot, relativePath)))
    .digest('hex');
}

function assertNoAbsoluteLocalPaths(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /(?:file:\/\/|\/Users\/|\/var\/folders\/|[A-Za-z]:\\\\)/);
}

function assertNoSensitiveKeys(value) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.doesNotMatch(key.toLowerCase(), /token|secret|password|authorization|cookie/);
      visit(child);
    }
  };
  visit(value);
}
