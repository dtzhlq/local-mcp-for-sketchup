import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { aggregateCurrentSourceRealModelReliabilityLiveV5 } from '../scripts/aggregate-current-source-real-model-reliability-live-v5.mjs';

const repoRoot = path.resolve('.');
const evidencePath = 'docs/evidence/current-source-real-model-reliability-live-evidence-v5-2026-07-23.json';
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson(evidencePath);
const evidenceSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v5.schema.json');
const priorSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v4.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validatePrior = ajv.compile(priorSchema);
const validateReport = ajv.compile(reportSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;
for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after v5 capture`); assertions += 1;
}
for (const descriptor of Object.values(evidence.lineage)) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256); assertions += 1;
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes); assertions += 1;
}

const prior = await readJson(evidence.lineage.prior_five_case_evidence.path);
const report = await readJson(evidence.lineage.dirty_topology_case_report.path);
assert.equal(validatePrior(prior), true, JSON.stringify(validatePrior.errors, null, 2)); assertions += 1;
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assert.deepEqual(evidence.runtime, prior.runtime); assertions += 1;
assert.deepEqual(evidence.runtime, report.runtime_attestation); assertions += 1;
assert.deepEqual(evidence.execution_authorization, prior.execution_authorization); assertions += 1;
assert.equal(prior.corpus.formal_cases_passed, 5); assertions += 1;
assert.equal(report.acceptance.selected_case_passed, true); assertions += 1;
assert.equal(report.acceptance.release_acceptance, false); assertions += 1;

assert.deepEqual(evidence.corpus.passed_case_ids, [
  'appearance-scenes-hidden',
  'architecture-golden',
  'deep-shared-components',
  'imported-dirty-topology',
  'interior-expression',
  'scaled-mirrored-locked'
]); assertions += 1;
assert.deepEqual(evidence.corpus.remaining_case_ids, ['product-boolean-manifold']); assertions += 1;
assert.equal(evidence.case_summaries.length, 6); assertions += 1;
assert.equal(new Set(evidence.case_summaries.map((entry) => entry.case_id)).size, 6); assertions += 1;
for (const summary of evidence.case_summaries) {
  assert.equal(summary.tasks_total, summary.tasks_passed); assertions += 1;
  assert.equal(summary.save_reopen_exact, true); assertions += 1;
  assert.equal(summary.wrong_object_modification_count, 0); assertions += 1;
  assert.equal(summary.silent_geometry_corruption_count, 0); assertions += 1;
  assert.equal(summary.queue_clean, true); assertions += 1;
}

const dirtySummary = evidence.case_summaries.find((entry) => entry.case_id === 'imported-dirty-topology');
assert.deepEqual(dirtySummary, {
  case_id: 'imported-dirty-topology',
  tasks_total: 3,
  tasks_passed: 3,
  duration_ms: 1423821,
  geometry_mutation_executed: true,
  save_reopen_exact: true,
  wrong_object_modification_count: 0,
  silent_geometry_corruption_count: 0,
  queue_clean: true
}); assertions += 1;

assert.equal(evidence.aggregate_metrics.tasks_total, 20); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_passed, 20); assertions += 1;
assert.equal(evidence.aggregate_metrics.geometry_mutation_cases_passed, 2); assertions += 1;
assert.equal(evidence.aggregate_metrics.controlled_fixture_overlay_cases_passed, 4); assertions += 1;
assert.equal(evidence.aggregate_metrics.wrong_object_modification_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.silent_geometry_corruption_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.recovery_attempts, 2); assertions += 1;
assert.equal(evidence.aggregate_metrics.recoveries, 2); assertions += 1;
assert.equal(evidence.aggregate_metrics.queue_clean_after_each_case, true); assertions += 1;

const dirty = evidence.dirty_topology_recovery;
assert.equal(dirty.case_id, 'imported-dirty-topology'); assertions += 1;
assert.equal(dirty.controlled_overlay_target_only, true); assertions += 1;
assert.equal(dirty.imported_context_retained, true); assertions += 1;
assert.equal(dirty.arbitrary_imported_cad_repair_proven, false); assertions += 1;
assert.equal(dirty.formal_case_geometry_mutation_executed, true); assertions += 1;
assert.equal(dirty.abnormal_topology_detected, true); assertions += 1;
assert(dirty.expected_issue_codes.includes('boundary_edges')); assertions += 1;
assert.equal(dirty.before.is_manifold, false); assertions += 1;
assert.equal(dirty.before.edges, 13); assertions += 1;
assert.equal(dirty.after.is_manifold, true); assertions += 1;
assert.equal(dirty.after.edges, 12); assertions += 1;
assert.deepEqual(dirty.after.issues, []); assertions += 1;
assert.equal(dirty.exact_target_changed, true); assertions += 1;
assert.equal(dirty.non_target_top_level_entities_unchanged, true); assertions += 1;
assert.equal(dirty.source_artifact_bytes_unchanged, true); assertions += 1;
assert.equal(dirty.save_reopen_identity_exact, true); assertions += 1;
assert.equal(dirty.model_revision_exact_match, true); assertions += 1;
assert.equal(dirty.recursive_entries_before, 100000); assertions += 1;
assert.equal(dirty.recursive_entries_after, 100000); assertions += 1;
assert.equal(dirty.recursive_total_before, 1903696); assertions += 1;
assert.equal(dirty.recursive_total_after, 1903696); assertions += 1;
assert.equal(dirty.recursive_payload_bounded, true); assertions += 1;
assert.equal(dirty.queue_clean, true); assertions += 1;
assert.equal(`sha256:${await sha256File(report.artifacts.source_artifact)}`, dirty.source_sha256); assertions += 1;
assert.equal(`sha256:${await sha256File(report.artifacts.verified_model)}`, dirty.verified_model_sha256); assertions += 1;
assert.equal((await fs.stat(path.join(repoRoot, report.artifacts.verified_model))).size, dirty.verified_model_bytes); assertions += 1;

assert.equal(evidence.acceptance.formal_corpus_cases_passed, 6); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_cases_total, 7); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_complete, false); assertions += 1;
assert.equal(evidence.acceptance.boolean_manifold, false); assertions += 1;
assert.equal(evidence.acceptance.dirty_topology_recovery, true); assertions += 1;
assert.equal(evidence.acceptance.arbitrary_imported_cad_repair, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeDocuments = [
  { ...evidence, acceptance: { ...evidence.acceptance, release_acceptance: true } },
  {
    ...evidence,
    acceptance: { ...evidence.acceptance, arbitrary_imported_cad_repair: true }
  },
  {
    ...evidence,
    aggregate_metrics: { ...evidence.aggregate_metrics, wrong_object_modification_count: 1 }
  },
  {
    ...evidence,
    dirty_topology_recovery: {
      ...evidence.dirty_topology_recovery,
      non_target_top_level_entities_unchanged: false
    }
  },
  {
    ...evidence,
    dirty_topology_recovery: {
      ...evidence.dirty_topology_recovery,
      after: { ...evidence.dirty_topology_recovery.after, is_manifold: false }
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

const regeneratedPath = `output/test-current-source-reliability-v5-${process.pid}.json`;
try {
  const regenerated = await aggregateCurrentSourceRealModelReliabilityLiveV5({
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
  dirty_topology_recovery_verified: true,
  arbitrary_imported_cad_repair_proven: false,
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
