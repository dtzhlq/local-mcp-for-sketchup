import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runModelGraphTargetQualityBenchmark } from '../scripts/run-model-graph-target-quality-benchmark.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [evidence, evidenceSchema, benchmark, benchmarkSchema, reportSchema] = await Promise.all([
  readJson('docs/evidence/model-graph-target-quality-v1-mock-evidence.json'),
  readJson('schema/model-graph-target-quality-mock-evidence-v1.schema.json'),
  readJson('test/fixtures/model-graph/target-quality-benchmark-v1.json'),
  readJson('schema/model-graph-target-quality-benchmark-v1.schema.json'),
  readJson('schema/model-graph-target-quality-report-v1.schema.json')
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateBenchmark = ajv.compile(benchmarkSchema);
const validateReport = ajv.compile(reportSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assert.equal(validateBenchmark(benchmark), true, JSON.stringify(validateBenchmark.errors, null, 2)); assertions += 1;
for (const [relativePath, expected] of Object.entries(evidence.hashes)) {
  assert.equal(await sha256File(relativePath), expected.slice('sha256:'.length), relativePath); assertions += 1;
}

const report = await runModelGraphTargetQualityBenchmark();
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assert.equal(sha256Text(`${JSON.stringify(report, null, 2)}\n`), evidence.report.deterministic_sha256.slice('sha256:'.length)); assertions += 1;
for (const binding of report.source_bindings) {
  assert.equal(binding.sha256, evidence.hashes[binding.path], binding.path); assertions += 1;
}
assert.equal(report.model_count, 4); assertions += 1;
assert.equal(new Set(report.cases.map((entry) => entry.model_revision)).size, 4); assertions += 1;
assert.equal(report.cases.every((entry) => entry.ground_truth_match), true); assertions += 1;
assert.equal(report.cases.every((entry) => entry.execution_allowed === false), true); assertions += 1;
assert.equal(report.metrics.target_top_k.rate, 1); assertions += 1;
assert.equal(report.metrics.ambiguity_abstention.rate, 1); assertions += 1;
assert.equal(report.metrics.clarification_recovery.rate, 1); assertions += 1;
assert.equal(report.hard_gates.wrong_object_automatic_execution, 0); assertions += 1;
assert.equal(report.hard_gates.unauthorized_s2_s4_execution, 0); assertions += 1;
assert.equal(report.hard_gates.duplicate_request_duplicate_modification, 0); assertions += 1;
assert.equal(report.hard_gates.ambiguous_target_automatic_selection, 0); assertions += 1;
assert.equal(report.safety.live_queue_called, false); assertions += 1;
assert.equal(report.acceptance.real_skp_multi_model_live, false); assertions += 1;
assert.equal(report.acceptance.release_acceptance, false); assertions += 1;

const serializedReport = JSON.stringify(report);
const rawFixtureLabels = [...new Set(benchmark.models.flatMap((model) => model.cases.flatMap((entry) => [
  ...(entry.expected?.candidate_fixture_labels || []),
  entry.expected?.selected_fixture_label,
  entry.clarification_fixture_label
].filter(Boolean))))];
for (const label of rawFixtureLabels) {
  assert.equal(serializedReport.includes(label), false, `raw model label leaked into report: ${label}`); assertions += 1;
}

const invalidEvidence = [
  mutate(evidence, (value) => { value.metrics.target_top_k_hits = 2; }),
  mutate(evidence, (value) => { value.hard_gates.wrong_object_automatic_execution = 1; }),
  mutate(evidence, (value) => { value.hard_gates.ambiguous_target_automatic_selection = 1; }),
  mutate(evidence, (value) => { value.acceptance.real_skp_multi_model_live = true; }),
  mutate(evidence, (value) => { value.acceptance.live_mutation = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; }),
  mutate(evidence, (value) => { value.report.raw_model_labels_exposed = true; })
];
for (const invalid of invalidEvidence) {
  assert.equal(validateEvidence(invalid), false); assertions += 1;
}

const invalidReports = [
  mutate(report, (value) => { value.metrics.correct_unique_selections = 2; }),
  mutate(report, (value) => { value.cases[1].selected_target_count = 1; }),
  mutate(report, (value) => { value.cases[1].ground_truth_match = false; }),
  mutate(report, (value) => { value.hard_gates.unauthorized_s2_s4_execution = 1; }),
  mutate(report, (value) => { value.safety.live_queue_called = true; }),
  mutate(report, (value) => { value.acceptance.real_skp_multi_model_live = true; }),
  mutate(report, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of invalidReports) {
  assert.equal(validateReport(invalid), false); assertions += 1;
}

const invalidBenchmarks = [
  mutate(benchmark, (value) => { value.models[0].domain = 'agent_defined'; }),
  mutate(benchmark, (value) => { value.models[0].unexpected = true; }),
  mutate(benchmark, (value) => { value.models[0].cases[0].flow = 'execute'; }),
  mutate(benchmark, (value) => { value.models[3].cases[1].clarification_candidate_rank = 0; }),
  mutate(benchmark, (value) => { delete value.models[1].cases[0].expected; })
];
for (const invalid of invalidBenchmarks) {
  assert.equal(validateBenchmark(invalid), false); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  runtime: report.runtime,
  models: report.metrics.models,
  domains: report.domains,
  cases: report.metrics.cases,
  target_top_k: report.metrics.target_top_k,
  ambiguity_abstention: report.metrics.ambiguity_abstention,
  clarification_recovery: report.metrics.clarification_recovery,
  artifact_page_calls: report.metrics.artifact_page_calls,
  hard_gates: report.hard_gates,
  raw_model_labels_exposed: false,
  live_queue_called: false,
  negative_cases: invalidEvidence.length + invalidReports.length + invalidBenchmarks.length,
  assertions
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, relativePath))).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
