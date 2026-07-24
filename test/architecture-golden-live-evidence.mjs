import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildArchitectureGoldenLiveEvidence } from '../scripts/build-architecture-golden-live-evidence.mjs';

const repoRoot = path.resolve('.');
const evidencePath = 'docs/evidence/architecture-golden-live-evidence-2026-07-23.json';
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson(evidencePath);
const evidenceSchema = await readJson('schema/architecture-golden-live-evidence-v1.schema.json');
const fixtureSchema = await readJson('schema/controlled-architecture-live-fixture-v1.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateFixture = ajv.compile(fixtureSchema);
const validateReport = ajv.compile(reportSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;
for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after capture`); assertions += 1;
}
for (const descriptor of Object.values(evidence.artifacts)) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256); assertions += 1;
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes); assertions += 1;
}

assert.equal(evidence.source_fixture.original_input_sha256, evidence.artifacts.original_input.sha256); assertions += 1;
assert.equal(`sha256:${evidence.artifacts.source_model.sha256}`, evidence.source_fixture.source_artifact_sha256); assertions += 1;
assert.deepEqual(evidence.source_fixture.metadata_operations, ['material', 'scene']); assertions += 1;
assert.equal(evidence.source_fixture.geometry_mutation_performed, false); assertions += 1;
assert.equal(evidence.source_fixture.top_level_entities_before, 1); assertions += 1;
assert.equal(evidence.source_fixture.top_level_entities_after, 1); assertions += 1;
assert.equal(evidence.source_fixture.recursive_total_before, 5859); assertions += 1;
assert.equal(evidence.source_fixture.recursive_total_after, 5859); assertions += 1;

const finalization = await readJson(evidence.artifacts.finalization_report.path);
assert.equal(validateFixture(finalization), true, JSON.stringify(validateFixture.errors, null, 2)); assertions += 1;
assert.equal(finalization.source.sha256, evidence.artifacts.original_input.sha256); assertions += 1;
assert.equal(finalization.overlay.geometry_mutation_performed, false); assertions += 1;
assert.equal(finalization.overlay.material_persisted, true); assertions += 1;
assert.equal(finalization.overlay.scene_persisted, true); assertions += 1;
assert.equal(finalization.identity.top_level_entities_before, finalization.identity.top_level_entities_after); assertions += 1;
assert.equal(finalization.identity.recursive_total_before, finalization.identity.recursive_total_after); assertions += 1;
assert.deepEqual(finalization.queue_clean, emptyQueue()); assertions += 1;

const report = await readJson(evidence.artifacts.success_report.path);
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assert.equal(report.ok, true); assertions += 1;
assert.equal(report.selected_case.case_id, 'architecture-golden'); assertions += 1;
assert.equal(report.metrics.tasks_total, 3); assertions += 1;
assert.equal(report.metrics.tasks_passed, 3); assertions += 1;
assert.equal(report.metrics.wrong_object_modification_count, 0); assertions += 1;
assert.equal(report.metrics.silent_geometry_corruption_count, 0); assertions += 1;
assert.deepEqual(report.queue_clean, emptyQueue()); assertions += 1;
assert.equal(report.acceptance.release_acceptance, false); assertions += 1;

const tasks = new Map(report.result.tasks.map((task) => [task.task_id, task]));
const material = tasks.get('material_preservation').evidence;
assert.equal(material.initial_signature, material.pre_save_signature); assertions += 1;
assert.equal(material.pre_save_signature, material.post_reopen_signature); assertions += 1;
assert.equal(material.preserved_across_save_reopen, true); assertions += 1;
const presentation = tasks.get('scene_visibility_preservation').evidence;
assert.equal(presentation.hash, presentation.pre_save_hash); assertions += 1;
assert.equal(presentation.pre_save_hash, presentation.post_reopen_hash); assertions += 1;
assert.equal(presentation.scenes, 1); assertions += 1;
assert.equal(presentation.hidden_entities, 0); assertions += 1;
assert.equal(presentation.preserved_across_save_reopen, true); assertions += 1;
const identity = tasks.get('save_reopen_identity').evidence;
assert.equal(identity.exact_match, true); assertions += 1;
assert.equal(identity.entries_before, 5859); assertions += 1;
assert.equal(identity.entries_after, 5859); assertions += 1;
assert.equal(identity.model_revision_exact_match, true); assertions += 1;
assert.equal(identity.snapshot_error_diffs, 0); assertions += 1;

assert.equal(evidence.preservation_contract.existing_material_assignments_in_signature, true); assertions += 1;
assert.equal(evidence.preservation_contract.top_level_visibility_in_signature, true); assertions += 1;
assert.equal(evidence.preservation_contract.nested_hidden_occurrence_attestation, false); assertions += 1;
assert.equal(evidence.acceptance.architecture_material_scene_preservation, true); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeDocuments = [
  { ...evidence, acceptance: { ...evidence.acceptance, release_acceptance: true } },
  {
    ...evidence,
    source_fixture: { ...evidence.source_fixture, geometry_mutation_performed: true }
  },
  {
    ...evidence,
    preservation_contract: { ...evidence.preservation_contract, material_persisted: false }
  },
  {
    ...evidence,
    live_verification: { ...evidence.live_verification, scenes: 0 }
  },
  {
    ...evidence,
    live_verification: { ...evidence.live_verification, wrong_object_modification_count: 1 }
  }
];
for (const document of negativeDocuments) {
  assert.equal(validateEvidence(document), false);
  assertions += 1;
}

const regeneratedPath = `output/test-architecture-evidence-${process.pid}.json`;
try {
  const regenerated = await buildArchitectureGoldenLiveEvidence({
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
  assert.doesNotMatch(JSON.stringify(value), /(?:file:\/\/|\/Users\/|\/var\/folders\/|[A-Za-z]:\\\\)/);
}

function assertNoSensitiveKeys(value) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.doesNotMatch(key.toLowerCase(), /token|secret|password|cookie/);
      visit(child);
    }
  };
  visit(value);
}
