import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { aggregateCurrentSourceRealModelReliabilityLiveV3 } from '../scripts/aggregate-current-source-real-model-reliability-live-v3.mjs';

const repoRoot = path.resolve('.');
const evidencePath = 'docs/evidence/current-source-real-model-reliability-live-evidence-v3-2026-07-23.json';
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson(evidencePath);
const evidenceSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v3.schema.json');
const priorSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v2.schema.json');
const appearanceSchema = await readJson('schema/appearance-scenes-hidden-live-evidence-v1.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validatePrior = ajv.compile(priorSchema);
const validateAppearance = ajv.compile(appearanceSchema);
const validateReport = ajv.compile(reportSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after v3 capture`); assertions += 1;
}
for (const descriptor of Object.values(evidence.lineage)) {
  await assertDescriptor(descriptor); assertions += 2;
}
for (const corpusCase of evidence.cases) {
  for (const descriptor of Object.values(corpusCase.artifacts)) {
    await assertDescriptor(descriptor); assertions += 2;
  }
}

const prior = await readJson(evidence.lineage.prior_three_case_evidence.path);
const appearanceEvidence = await readJson(evidence.lineage.appearance_case_evidence.path);
assert.equal(validatePrior(prior), true, JSON.stringify(validatePrior.errors, null, 2)); assertions += 1;
assert.equal(validateAppearance(appearanceEvidence), true, JSON.stringify(validateAppearance.errors, null, 2)); assertions += 1;
assert.deepEqual(evidence.runtime, prior.runtime); assertions += 1;
assert.deepEqual(evidence.execution_authorization, prior.execution_authorization); assertions += 1;
assert.equal(prior.corpus.formal_cases_passed, 3); assertions += 1;
assert.equal(appearanceEvidence.acceptance.selected_case_passed, true); assertions += 1;
assert.equal(appearanceEvidence.acceptance.release_acceptance, false); assertions += 1;

assert.deepEqual(evidence.corpus.passed_case_ids, [
  'appearance-scenes-hidden',
  'deep-shared-components',
  'interior-expression',
  'scaled-mirrored-locked'
]); assertions += 1;
assert.deepEqual(evidence.corpus.remaining_case_ids, [
  'architecture-golden',
  'product-boolean-manifold',
  'imported-dirty-topology'
]); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_total, 14); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_passed, 14); assertions += 1;
assert.equal(evidence.aggregate_metrics.geometry_mutation_cases_passed, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.controlled_fixture_overlay_cases_passed, 2); assertions += 1;
assert.equal(evidence.aggregate_metrics.wrong_object_modification_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.silent_geometry_corruption_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.recovery_attempts, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.recoveries, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.recovery_rate, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.queue_clean_after_each_case, true); assertions += 1;

const appearanceCase = evidence.cases.find((entry) => entry.case_id === 'appearance-scenes-hidden');
assert(appearanceCase); assertions += 1;
assert.deepEqual(appearanceCase.task_ids, [
  'uv_material_preservation',
  'scene_visibility_preservation',
  'save_reopen_identity'
]); assertions += 1;
assert.equal(appearanceCase.tasks_total, 3); assertions += 1;
assert.equal(appearanceCase.tasks_passed, 3); assertions += 1;
assert.equal(appearanceCase.coverage.full_recursive_identity, true); assertions += 1;
assert.equal(appearanceCase.coverage.uv_preservation, true); assertions += 1;
assert.equal(appearanceCase.coverage.hidden_visibility_preservation, true); assertions += 1;
assert.equal(appearanceCase.mutation.geometry_mutation_executed, false); assertions += 1;
assert.equal(appearanceCase.appearance.face_uv_evidence_kind, 'face_uvs'); assertions += 1;
assert.equal(appearanceCase.appearance.uv_material_signature_preserved, true); assertions += 1;
assert.equal(appearanceCase.appearance.scene_visibility_signature_preserved, true); assertions += 1;
assert.equal(appearanceCase.appearance.scenes, 1); assertions += 1;
assert.equal(appearanceCase.appearance.hidden_entities, 1); assertions += 1;
assert.equal(appearanceCase.identity.entries_before, 5897); assertions += 1;
assert.equal(appearanceCase.identity.entries_after, 5897); assertions += 1;
assert.equal(appearanceCase.identity.exact_match, true); assertions += 1;
assert.equal(appearanceCase.identity.model_revision_exact_match, true); assertions += 1;
assert.equal(appearanceCase.identity.snapshot_error_diffs, 0); assertions += 1;
assert.deepEqual(appearanceCase.quality.queue_clean, emptyQueue()); assertions += 1;

const appearanceReport = await readJson(appearanceCase.artifacts.report.path);
assert.equal(validateReport(appearanceReport), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assert.equal(appearanceReport.selected_case.case_id, 'appearance-scenes-hidden'); assertions += 1;
assert.equal(appearanceReport.metrics.tasks_passed, 3); assertions += 1;
assert.equal(appearanceReport.acceptance.release_acceptance, false); assertions += 1;

const scaledCase = evidence.cases.find((entry) => entry.case_id === 'scaled-mirrored-locked');
assert.equal(scaledCase.mutation.geometry_mutation_executed, true); assertions += 1;
assert.equal(scaledCase.mutation.locked_target_fail_closed, true); assertions += 1;
assert.equal(scaledCase.mutation.rollback_verified, true); assertions += 1;
assert.equal(scaledCase.mutation.exact_target_changed, true); assertions += 1;
assert.deepEqual(scaledCase.mutation.nonuniform_scale, [1.5, 0.75, 2]); assertions += 1;
assert.equal(scaledCase.mutation.mirror_axis, 'x'); assertions += 1;

assert.equal(evidence.appearance_preservation.face_uv_evidence_kind, 'face_uvs'); assertions += 1;
assert.equal(evidence.appearance_preservation.fixture_overlay_mutated_disposable_copy, true); assertions += 1;
assert.equal(evidence.appearance_preservation.formal_case_geometry_mutation_executed, false); assertions += 1;
assert.equal(evidence.appearance_preservation.independent_uvhelper_coordinate_attestation, false); assertions += 1;
assert.equal(evidence.appearance_preservation.arbitrary_uv_editing_proven, false); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_cases_passed, 4); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_cases_total, 7); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_complete, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeDocuments = [
  { ...evidence, acceptance: { ...evidence.acceptance, release_acceptance: true } },
  {
    ...evidence,
    acceptance: {
      ...evidence.acceptance,
      appearance_uv_hidden_preservation: false
    }
  },
  {
    ...evidence,
    aggregate_metrics: {
      ...evidence.aggregate_metrics,
      wrong_object_modification_count: 1
    }
  },
  {
    ...evidence,
    appearance_preservation: {
      ...evidence.appearance_preservation,
      face_uv_payload_persisted: false
    }
  },
  { ...evidence, cases: evidence.cases.slice(1) },
  {
    ...evidence,
    corpus: {
      ...evidence.corpus,
      formal_cases_passed: 7,
      formal_corpus_complete: true
    }
  }
];
for (const document of negativeDocuments) {
  assert.equal(validateEvidence(document), false, 'invalid v3 aggregate evidence must fail schema validation');
  assertions += 1;
}

const regeneratedPath = `output/test-current-source-reliability-v3-${process.pid}.json`;
try {
  const regenerated = await aggregateCurrentSourceRealModelReliabilityLiveV3({
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
  cases_passed: evidence.corpus.formal_cases_passed,
  tasks_passed: evidence.aggregate_metrics.tasks_passed,
  appearance_case_verified: true,
  negative_cases: negativeDocuments.length,
  deterministic_regeneration: true,
  assertions
}, null, 2)}\n`);

async function assertDescriptor(descriptor) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} hash mismatch`);
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes);
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256')
    .update(await fs.readFile(path.join(repoRoot, relativePath)))
    .digest('hex');
}

function emptyQueue() {
  return { queue: 0, processing: 0, responses: 0, lock: false };
}

function assertNoAbsoluteLocalPaths(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /(?:file:\/\/|\/Users\/|\/var\/folders\/|[A-Za-z]:\\\\)/);
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
