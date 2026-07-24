import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { aggregateCurrentSourceRealModelReliabilityLiveV4 } from '../scripts/aggregate-current-source-real-model-reliability-live-v4.mjs';

const repoRoot = path.resolve('.');
const evidencePath = 'docs/evidence/current-source-real-model-reliability-live-evidence-v4-2026-07-23.json';
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson(evidencePath);
const evidenceSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v4.schema.json');
const priorSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v3.schema.json');
const architectureSchema = await readJson('schema/architecture-golden-live-evidence-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validatePrior = ajv.compile(priorSchema);
const validateArchitecture = ajv.compile(architectureSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;
for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after v4 capture`); assertions += 1;
}
for (const descriptor of Object.values(evidence.lineage)) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256); assertions += 1;
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes); assertions += 1;
}

const prior = await readJson(evidence.lineage.prior_four_case_evidence.path);
const architecture = await readJson(evidence.lineage.architecture_case_evidence.path);
assert.equal(validatePrior(prior), true, JSON.stringify(validatePrior.errors, null, 2)); assertions += 1;
assert.equal(validateArchitecture(architecture), true, JSON.stringify(validateArchitecture.errors, null, 2)); assertions += 1;
assert.deepEqual(evidence.runtime, prior.runtime); assertions += 1;
assert.deepEqual(evidence.execution_authorization, prior.execution_authorization); assertions += 1;
assert.equal(prior.corpus.formal_cases_passed, 4); assertions += 1;
assert.equal(architecture.acceptance.selected_case_passed, true); assertions += 1;
assert.equal(architecture.acceptance.release_acceptance, false); assertions += 1;

assert.deepEqual(evidence.corpus.passed_case_ids, [
  'appearance-scenes-hidden',
  'architecture-golden',
  'deep-shared-components',
  'interior-expression',
  'scaled-mirrored-locked'
]); assertions += 1;
assert.deepEqual(evidence.corpus.remaining_case_ids, [
  'product-boolean-manifold',
  'imported-dirty-topology'
]); assertions += 1;
assert.equal(evidence.case_summaries.length, 5); assertions += 1;
assert.equal(new Set(evidence.case_summaries.map((entry) => entry.case_id)).size, 5); assertions += 1;
for (const summary of evidence.case_summaries) {
  assert.equal(summary.tasks_total, summary.tasks_passed); assertions += 1;
  assert.equal(summary.save_reopen_exact, true); assertions += 1;
  assert.equal(summary.wrong_object_modification_count, 0); assertions += 1;
  assert.equal(summary.silent_geometry_corruption_count, 0); assertions += 1;
  assert.equal(summary.queue_clean, true); assertions += 1;
}

const architectureSummary = evidence.case_summaries.find((entry) => entry.case_id === 'architecture-golden');
assert.deepEqual(architectureSummary, {
  case_id: 'architecture-golden',
  tasks_total: 3,
  tasks_passed: 3,
  duration_ms: 62768,
  geometry_mutation_executed: false,
  save_reopen_exact: true,
  wrong_object_modification_count: 0,
  silent_geometry_corruption_count: 0,
  queue_clean: true
}); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_total, 17); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_passed, 17); assertions += 1;
assert.equal(evidence.aggregate_metrics.geometry_mutation_cases_passed, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.controlled_fixture_overlay_cases_passed, 3); assertions += 1;
assert.equal(evidence.aggregate_metrics.wrong_object_modification_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.silent_geometry_corruption_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.recovery_attempts, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.recoveries, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.queue_clean_after_each_case, true); assertions += 1;

assert.equal(evidence.architecture_preservation.case_id, 'architecture-golden'); assertions += 1;
assert.equal(evidence.architecture_preservation.fixture_overlay_mutated_disposable_copy_metadata, true); assertions += 1;
assert.equal(evidence.architecture_preservation.fixture_overlay_geometry_mutation_performed, false); assertions += 1;
assert.equal(evidence.architecture_preservation.formal_case_geometry_mutation_executed, false); assertions += 1;
assert.equal(evidence.architecture_preservation.material_signature_preserved, true); assertions += 1;
assert.equal(evidence.architecture_preservation.scene_visibility_signature_preserved, true); assertions += 1;
assert.equal(evidence.architecture_preservation.scenes, 1); assertions += 1;
assert.equal(evidence.architecture_preservation.hidden_top_level_entities, 0); assertions += 1;
assert.equal(evidence.architecture_preservation.recursive_entries, 5859); assertions += 1;
assert.equal(evidence.architecture_preservation.model_revision_exact_match, true); assertions += 1;
assert.equal(evidence.architecture_preservation.nested_hidden_occurrence_attestation, false); assertions += 1;
assert.equal(evidence.appearance_preservation.face_uv_evidence_kind, 'face_uvs'); assertions += 1;
assert.equal(evidence.locked_target_guard.locked_batch_rejected_before_commit, true); assertions += 1;

assert.equal(evidence.acceptance.formal_corpus_cases_passed, 5); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_cases_total, 7); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_complete, false); assertions += 1;
assert.equal(evidence.acceptance.boolean_manifold, false); assertions += 1;
assert.equal(evidence.acceptance.dirty_topology_recovery, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeDocuments = [
  { ...evidence, acceptance: { ...evidence.acceptance, release_acceptance: true } },
  {
    ...evidence,
    acceptance: { ...evidence.acceptance, architecture_case: false }
  },
  {
    ...evidence,
    aggregate_metrics: { ...evidence.aggregate_metrics, wrong_object_modification_count: 1 }
  },
  {
    ...evidence,
    architecture_preservation: {
      ...evidence.architecture_preservation,
      material_signature_preserved: false
    }
  },
  { ...evidence, case_summaries: evidence.case_summaries.slice(1) },
  {
    ...evidence,
    corpus: { ...evidence.corpus, formal_cases_passed: 7, formal_corpus_complete: true }
  }
];
for (const document of negativeDocuments) {
  assert.equal(validateEvidence(document), false);
  assertions += 1;
}

const regeneratedPath = `output/test-current-source-reliability-v4-${process.pid}.json`;
try {
  const regenerated = await aggregateCurrentSourceRealModelReliabilityLiveV4({
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
  architecture_case_verified: true,
  negative_cases: negativeDocuments.length,
  deterministic_regeneration: true,
  assertions
}, null, 2)}\n`);

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
