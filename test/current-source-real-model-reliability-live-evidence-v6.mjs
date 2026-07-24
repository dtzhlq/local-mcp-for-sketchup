import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { aggregateCurrentSourceRealModelReliabilityLiveV6 } from '../scripts/aggregate-current-source-real-model-reliability-live-v6.mjs';

const repoRoot = path.resolve('.');
const evidencePath = 'docs/evidence/current-source-real-model-reliability-live-evidence-v6-2026-07-23.json';
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson(evidencePath);
const evidenceSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v6.schema.json');
const priorSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v5.schema.json');
const fixtureSchema = await readJson('schema/controlled-product-boolean-live-fixture-v1.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validatePrior = ajv.compile(priorSchema);
const validateFixture = ajv.compile(fixtureSchema);
const validateReport = ajv.compile(reportSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;
for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after v6 capture`); assertions += 1;
}
for (const descriptor of Object.values(evidence.lineage)) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256); assertions += 1;
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes); assertions += 1;
}

const prior = await readJson(evidence.lineage.prior_six_case_evidence.path);
const fixture = await readJson(evidence.lineage.product_boolean_fixture_report.path);
const report = await readJson(evidence.lineage.product_boolean_case_report.path);
assert.equal(validatePrior(prior), true, JSON.stringify(validatePrior.errors, null, 2)); assertions += 1;
assert.equal(validateFixture(fixture), true, JSON.stringify(validateFixture.errors, null, 2)); assertions += 1;
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assert.deepEqual(evidence.runtime, prior.runtime); assertions += 1;
assert.deepEqual(evidence.runtime, report.runtime_attestation); assertions += 1;
assert.deepEqual(evidence.execution_authorization, prior.execution_authorization); assertions += 1;
assert.equal(prior.corpus.formal_cases_passed, 6); assertions += 1;
assert.equal(report.acceptance.selected_case_passed, true); assertions += 1;
assert.equal(report.acceptance.release_acceptance, false); assertions += 1;
assert.equal(fixture.status, 'ready_for_formal_live_case'); assertions += 1;
assert.equal(fixture.release_acceptance, false); assertions += 1;

assert.deepEqual(evidence.corpus.passed_case_ids, [
  'appearance-scenes-hidden',
  'architecture-golden',
  'deep-shared-components',
  'imported-dirty-topology',
  'interior-expression',
  'product-boolean-manifold',
  'scaled-mirrored-locked'
]); assertions += 1;
assert.deepEqual(evidence.corpus.remaining_case_ids, []); assertions += 1;
assert.equal(evidence.case_summaries.length, 7); assertions += 1;
assert.equal(new Set(evidence.case_summaries.map((entry) => entry.case_id)).size, 7); assertions += 1;
for (const summary of evidence.case_summaries) {
  assert.equal(summary.tasks_total, summary.tasks_passed); assertions += 1;
  assert.equal(summary.save_reopen_exact, true); assertions += 1;
  assert.equal(summary.wrong_object_modification_count, 0); assertions += 1;
  assert.equal(summary.silent_geometry_corruption_count, 0); assertions += 1;
  assert.equal(summary.queue_clean, true); assertions += 1;
}

const productSummary = evidence.case_summaries.find((entry) => entry.case_id === 'product-boolean-manifold');
assert.deepEqual(productSummary, {
  case_id: 'product-boolean-manifold',
  tasks_total: 3,
  tasks_passed: 3,
  duration_ms: 145952,
  geometry_mutation_executed: true,
  save_reopen_exact: true,
  wrong_object_modification_count: 0,
  silent_geometry_corruption_count: 0,
  queue_clean: true
}); assertions += 1;

assert.equal(evidence.aggregate_metrics.tasks_total, 23); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_passed, 23); assertions += 1;
assert.equal(evidence.aggregate_metrics.geometry_mutation_cases_passed, 3); assertions += 1;
assert.equal(evidence.aggregate_metrics.controlled_fixture_overlay_cases_passed, 5); assertions += 1;
assert.equal(evidence.aggregate_metrics.wrong_object_modification_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.silent_geometry_corruption_count, 0); assertions += 1;
assert.equal(evidence.aggregate_metrics.recovery_attempts, 2); assertions += 1;
assert.equal(evidence.aggregate_metrics.recoveries, 2); assertions += 1;
assert.equal(evidence.aggregate_metrics.queue_clean_after_each_case, true); assertions += 1;

const product = evidence.product_boolean_reliability;
assert.equal(product.case_id, 'product-boolean-manifold'); assertions += 1;
assert.equal(product.controlled_overlay_inputs_only, true); assertions += 1;
assert.equal(product.product_context_retained, true); assertions += 1;
assert.equal(product.original_top_level_entities_preserved_during_fixture_creation, true); assertions += 1;
assert.equal(product.isolated_from_source, true); assertions += 1;
assert.equal(product.positive_3d_overlap, true); assertions += 1;
assert.equal(product.through_cut, true); assertions += 1;
assert.equal(product.target_initial_manifold, true); assertions += 1;
assert.equal(product.tool_initial_manifold, true); assertions += 1;
assert.equal(product.input_pair_manifold_after_fixture_reopen, true); assertions += 1;
assert.equal(product.formal_case_geometry_mutation_executed, true); assertions += 1;
assert.equal(product.operation, 'boolean_difference'); assertions += 1;
assert.equal(product.result_manifold, true); assertions += 1;
assert.equal(product.exact_target_replaced, true); assertions += 1;
assert.equal(product.tool_preserved_unchanged, true); assertions += 1;
assert.equal(product.non_input_top_level_entities_unchanged, true); assertions += 1;
assert.equal(product.target_material_preserved, true); assertions += 1;
assert.equal(product.material_preserved_across_save_reopen, true); assertions += 1;
assert.equal(product.source_artifact_bytes_unchanged, true); assertions += 1;
assert.equal(product.save_reopen_identity_exact, true); assertions += 1;
assert.equal(product.model_revision_exact_match, true); assertions += 1;
assert.equal(product.recursive_entries_before, 71868); assertions += 1;
assert.equal(product.recursive_entries_after, 71868); assertions += 1;
assert.equal(product.recursive_total_before, 71868); assertions += 1;
assert.equal(product.recursive_total_after, 71868); assertions += 1;
assert.equal(product.full_recursive_payload, true); assertions += 1;
assert.equal(product.queue_clean, true); assertions += 1;
assert.equal(`sha256:${await sha256File(report.artifacts.source_artifact)}`, product.source_sha256); assertions += 1;
assert.equal(`sha256:${await sha256File(report.artifacts.verified_model)}`, product.verified_model_sha256); assertions += 1;
assert.equal((await fs.stat(path.join(repoRoot, report.artifacts.verified_model))).size, product.verified_model_bytes); assertions += 1;
assert.equal(fixture.artifact.sha256, product.source_sha256); assertions += 1;

assert.equal(evidence.acceptance.seven_case_live_reliability, true); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_cases_passed, 7); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_cases_total, 7); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_complete, true); assertions += 1;
assert.equal(evidence.acceptance.boolean_manifold, true); assertions += 1;
assert.equal(evidence.acceptance.boolean_target_isolation, true); assertions += 1;
assert.equal(evidence.acceptance.dirty_topology_recovery, true); assertions += 1;
assert.equal(evidence.acceptance.arbitrary_imported_cad_repair, false); assertions += 1;
assert.equal(evidence.acceptance.agent_gateway_default_profile_qualified, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeDocuments = [
  { ...evidence, acceptance: { ...evidence.acceptance, release_acceptance: true } },
  { ...evidence, acceptance: { ...evidence.acceptance, boolean_manifold: false } },
  { ...evidence, acceptance: { ...evidence.acceptance, formal_corpus_complete: false } },
  { ...evidence, aggregate_metrics: { ...evidence.aggregate_metrics, tasks_passed: 22 } },
  { ...evidence, aggregate_metrics: { ...evidence.aggregate_metrics, wrong_object_modification_count: 1 } },
  {
    ...evidence,
    product_boolean_reliability: {
      ...evidence.product_boolean_reliability,
      exact_target_replaced: false
    }
  },
  {
    ...evidence,
    product_boolean_reliability: {
      ...evidence.product_boolean_reliability,
      tool_preserved_unchanged: false
    }
  },
  {
    ...evidence,
    product_boolean_reliability: {
      ...evidence.product_boolean_reliability,
      non_input_top_level_entities_unchanged: false
    }
  },
  {
    ...evidence,
    product_boolean_reliability: {
      ...evidence.product_boolean_reliability,
      result_manifold: false
    }
  },
  { ...evidence, case_summaries: evidence.case_summaries.slice(1) },
  {
    ...evidence,
    corpus: { ...evidence.corpus, remaining_case_ids: ['product-boolean-manifold'] }
  }
];
for (const document of negativeDocuments) {
  assert.equal(validateEvidence(document), false);
  assertions += 1;
}

const regeneratedPath = `output/test-current-source-reliability-v6-${process.pid}.json`;
try {
  const regenerated = await aggregateCurrentSourceRealModelReliabilityLiveV6({
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
  product_boolean_verified: true,
  target_isolation_verified: true,
  arbitrary_product_boolean_reliability_claimed: false,
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
