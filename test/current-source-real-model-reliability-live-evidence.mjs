import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson('docs/evidence/current-source-real-model-reliability-live-evidence-2026-07-23.json');
const evidenceSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v1.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateReport = ajv.compile(reportSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.match(expected, /^[0-9a-f]{64}$/, `${relativePath} has an invalid historical source hash`); assertions += 1;
  assert.equal((await fs.stat(path.join(repoRoot, relativePath))).isFile(), true, `${relativePath} is missing`); assertions += 1;
}
assert.equal(
  evidence.corpus.manifest_sha256,
  `sha256:${evidence.source_sha256[evidence.corpus.manifest_path]}`
); assertions += 1;
const manifest = await readJson(evidence.corpus.manifest_path);
assert.deepEqual(
  evidence.corpus.remaining_case_ids,
  manifest.cases.map((entry) => entry.id).filter((caseId) => !evidence.corpus.passed_case_ids.includes(caseId))
); assertions += 1;
assert.equal(
  evidence.runtime.revision_source_sha256,
  evidence.source_sha256['sketchup_plugin/alma_sketchup_mcp/model_revision.rb']
); assertions += 1;

const reports = new Map();
for (const corpusCase of evidence.cases) {
  for (const descriptor of Object.values(corpusCase.artifacts)) {
    assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} does not match evidence`); assertions += 1;
    assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes); assertions += 1;
  }
  const report = await readJson(corpusCase.artifacts.report.path);
  const diagnostic = await readJson(corpusCase.artifacts.diagnostic.path);
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
  assert.equal(report.selected_case.case_id, corpusCase.case_id); assertions += 1;
  assert.equal(report.result.domain, corpusCase.domain); assertions += 1;
  assert.equal(report.result.duration_ms, corpusCase.duration_ms); assertions += 1;
  assert.equal(report.metrics.tasks_total, corpusCase.tasks_total); assertions += 1;
  assert.equal(report.metrics.tasks_passed, corpusCase.tasks_passed); assertions += 1;
  assert.equal(report.metrics.wrong_object_modification_count, 0); assertions += 1;
  assert.equal(report.metrics.silent_geometry_corruption_count, 0); assertions += 1;
  assert.deepEqual(report.queue_clean, corpusCase.quality.queue_clean); assertions += 1;
  assert.equal(report.safety.original_bytes_unchanged, true); assertions += 1;
  assert.equal(report.safety.disposable_copy_only, true); assertions += 1;
  assert.equal(report.artifacts.source_sha256, `sha256:${corpusCase.artifacts.source_model.sha256}`); assertions += 1;
  assert.equal(report.artifacts.contract_sha256, `sha256:${corpusCase.artifacts.contract.sha256}`); assertions += 1;
  assert.equal(report.artifacts.verified_model_sha256, `sha256:${corpusCase.artifacts.verified_model.sha256}`); assertions += 1;
  assert.deepEqual(report.result.tasks.map((task) => task.task_id), corpusCase.task_ids); assertions += 1;

  const identity = report.result.tasks.find((task) => task.task_id === 'save_reopen_identity').evidence;
  assert.equal(identity.identity_mode, corpusCase.identity.mode); assertions += 1;
  assert.equal(identity.entries_before, corpusCase.identity.entries_before); assertions += 1;
  assert.equal(identity.entries_after, corpusCase.identity.entries_after); assertions += 1;
  assert.equal(identity.total_before, corpusCase.identity.total_before); assertions += 1;
  assert.equal(identity.total_after, corpusCase.identity.total_after); assertions += 1;
  assert.equal(identity.signature, corpusCase.identity.identity_digest); assertions += 1;
  assert.equal(identity.model_revision_before, corpusCase.identity.model_revision_before); assertions += 1;
  assert.equal(identity.model_revision_after, corpusCase.identity.model_revision_after); assertions += 1;
  assert.equal(identity.model_revision_exact_match, true); assertions += 1;
  assert.equal(identity.snapshot_error_diffs, 0); assertions += 1;
  assert.equal(diagnostic.identity_signature_before, diagnostic.identity_signature_after); assertions += 1;
  assert.equal(diagnostic.identity_signature_after, corpusCase.identity.identity_digest); assertions += 1;
  assert.equal(diagnostic.model_revision_before, diagnostic.model_revision_after); assertions += 1;
  assert.equal(diagnostic.model_revision_after, corpusCase.identity.model_revision_after); assertions += 1;
  assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0); assertions += 1;
  assert.equal(diagnostic.snapshot_diff.verdict, 'pass'); assertions += 1;
  reports.set(corpusCase.case_id, report);
}

const deep = evidence.cases.find((entry) => entry.case_id === 'deep-shared-components');
const deepReport = reports.get('deep-shared-components');
assert.deepEqual(deep.coverage, {
  full_recursive_identity: true,
  bounded_recursive_identity: false,
  shared_definition_scope: true,
  material_preservation: false,
  scene_visibility_preservation: false,
  save_reopen_identity: true
}); assertions += 1;
assert.equal(deep.identity.entries_before, 11474); assertions += 1;
assert.equal(deep.identity.total_before, 11474); assertions += 1;
assert.equal(deep.identity.truncated_before, false); assertions += 1;
assert.equal(
  deepReport.result.tasks.find((task) => task.task_id === 'shared_definition_identity').evidence.shared_occurrences,
  2986
); assertions += 1;

const interior = evidence.cases.find((entry) => entry.case_id === 'interior-expression');
const interiorReport = reports.get('interior-expression');
assert.deepEqual(interior.coverage, {
  full_recursive_identity: false,
  bounded_recursive_identity: true,
  shared_definition_scope: false,
  material_preservation: true,
  scene_visibility_preservation: true,
  save_reopen_identity: true
}); assertions += 1;
assert.equal(interior.identity.entries_before, 100000); assertions += 1;
assert.equal(interior.identity.total_before, 220006); assertions += 1;
assert.equal(interior.identity.truncated_before, true); assertions += 1;
assert.equal(
  interiorReport.result.tasks.find((task) => task.task_id === 'material_preservation').evidence.preserved_across_save_reopen,
  true
); assertions += 1;
assert.equal(
  interiorReport.result.tasks.find((task) => task.task_id === 'scene_visibility_preservation').evidence.scenes,
  1
); assertions += 1;

assert.equal(
  evidence.aggregate_metrics.aggregate_duration_ms,
  evidence.cases.reduce((sum, entry) => sum + entry.duration_ms, 0)
); assertions += 1;
assert.equal(evidence.performance_boundary.stress_case_duration_ms, interior.duration_ms); assertions += 1;
assert(interior.duration_ms > evidence.performance_boundary.interactive_budget_ms); assertions += 1;
assert.equal(evidence.acceptance.mutation_cases_passed, 0); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_complete, false); assertions += 1;
assert.equal(evidence.acceptance.agent_gateway_default_profile_qualified, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.result = 'pass'; }),
  mutate(evidence, (value) => { value.execution_authorization.agent_self_authorization_allowed = true; }),
  mutate(evidence, (value) => { value.corpus.formal_cases_passed = 7; }),
  mutate(evidence, (value) => { value.corpus.formal_corpus_complete = true; }),
  mutate(evidence, (value) => { value.aggregate_metrics.wrong_object_modification_count = 1; }),
  mutate(evidence, (value) => { value.cases[0].identity.exact_match = false; }),
  mutate(evidence, (value) => { value.cases[1].quality.queue_clean.lock = true; }),
  mutate(evidence, (value) => { value.performance_boundary.use_as_default_agent_payload = true; }),
  mutate(evidence, (value) => { value.acceptance.mutation_cases_passed = 1; }),
  mutate(evidence, (value) => { value.acceptance.boolean_manifold = true; }),
  mutate(evidence, (value) => { value.acceptance.cross_version = 'passed'; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validateEvidence(invalid), false, 'overclaim or unsafe evidence must fail closed'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_contract: evidence.version,
  cases_passed: evidence.acceptance.formal_corpus_cases_passed,
  cases_total: evidence.acceptance.formal_corpus_cases_total,
  tasks_passed: evidence.aggregate_metrics.tasks_passed,
  deep_recursive_entries: deep.identity.total_after,
  deep_shared_occurrences: 2986,
  interior_recursive_total: interior.identity.total_after,
  interior_materialized_entries: interior.identity.entries_after,
  wrong_object_modification_count: 0,
  silent_geometry_corruption_count: 0,
  stress_case_within_interactive_budget: false,
  mutation_cases_passed: 0,
  cross_version: evidence.acceptance.cross_version,
  release_acceptance: false,
  negative_cases: negativeCases.length,
  assertions
}, null, 2)}\n`);

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, relativePath))).digest('hex');
}

function assertNoAbsoluteLocalPaths(value) {
  walk(value, (_key, child) => {
    if (typeof child !== 'string') return;
    assert.equal(
      child.startsWith('/') || /^[A-Za-z]:[\\/]/.test(child) || child.startsWith('file://') || child.startsWith('~/'),
      false,
      'public evidence contains an absolute local path'
    );
  });
}

function assertNoSensitiveKeys(value) {
  walk(value, (key) => {
    assert.doesNotMatch(
      key,
      /^(?:signature|session[_-]?id|document[_-]?id|model[_-]?guid|runtime[_-]?object[_-]?id|source[_-]?path|token|secret)$/i,
      `public evidence contains sensitive key ${key}`
    );
  });
}

function walk(value, callback) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    callback(key, child);
    walk(child, callback);
  }
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
