import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson('docs/evidence/current-source-real-model-reliability-live-evidence-v2-2026-07-23.json');
const evidenceSchema = await readJson('schema/current-source-real-model-reliability-live-evidence-v2.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const lockGuardSchema = await readJson('schema/locked-target-guard-live-evidence-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateReport = ajv.compile(reportSchema);
const validateLockGuard = ajv.compile(lockGuardSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after aggregate capture`); assertions += 1;
}
for (const descriptor of Object.values(evidence.lineage)) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} lineage hash mismatch`); assertions += 1;
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes); assertions += 1;
}

const baseEvidence = await readJson(evidence.lineage.base_two_case_evidence.path);
assert.equal(baseEvidence.version, 'current-source-real-model-reliability-live-evidence.v1'); assertions += 1;
assert.equal(baseEvidence.corpus.formal_cases_passed, 2); assertions += 1;
assert.equal(baseEvidence.aggregate_metrics.tasks_passed, 6); assertions += 1;
assert.equal(baseEvidence.acceptance.mutation_cases_passed, 0); assertions += 1;
assert.equal(baseEvidence.acceptance.release_acceptance, false); assertions += 1;

const lockGuardEvidence = await readJson(evidence.lineage.locked_target_guard_evidence.path);
assert.equal(validateLockGuard(lockGuardEvidence), true, JSON.stringify(validateLockGuard.errors, null, 2)); assertions += 1;
assert.equal(lockGuardEvidence.result, 'fixed_and_live_verified'); assertions += 1;
assert.equal(lockGuardEvidence.runtime.loaded_boolean_source_sha256, evidence.locked_target_guard.loaded_boolean_source_sha256); assertions += 1;
assert.equal(lockGuardEvidence.fix.mutating_operations_guarded, evidence.locked_target_guard.mutating_operations_guarded); assertions += 1;
assert.equal(lockGuardEvidence.acceptance.release_acceptance, false); assertions += 1;

const manifest = await readJson(evidence.corpus.manifest_path);
assert.equal(evidence.corpus.manifest_sha256, `sha256:${await sha256File(evidence.corpus.manifest_path)}`); assertions += 1;
assert.deepEqual(
  evidence.corpus.remaining_case_ids,
  manifest.cases.map((entry) => entry.id).filter((caseId) => !evidence.corpus.passed_case_ids.includes(caseId))
); assertions += 1;
assert.deepEqual(
  evidence.cases.map((entry) => entry.case_id),
  evidence.corpus.passed_case_ids
); assertions += 1;

const reports = new Map();
for (const corpusCase of evidence.cases) {
  for (const descriptor of Object.values(corpusCase.artifacts)) {
    assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} hash mismatch`); assertions += 1;
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

const scaled = evidence.cases.find((entry) => entry.case_id === 'scaled-mirrored-locked');
const scaledReport = reports.get('scaled-mirrored-locked');
assert(scaled); assertions += 1;
assert(scaledReport); assertions += 1;
assert.deepEqual(scaled.coverage, {
  full_recursive_identity: true,
  bounded_recursive_identity: false,
  shared_definition_scope: false,
  material_preservation: false,
  scene_visibility_preservation: false,
  save_reopen_identity: true
}); assertions += 1;
assert.deepEqual(scaled.mutation, {
  geometry_mutation_executed: true,
  locked_target_fail_closed: true,
  rollback_verified: true,
  guard_unchanged: true,
  locked_target_unchanged: true,
  exact_target_changed: true,
  nonuniform_scale: [1.5, 0.75, 2],
  mirror_axis: 'x',
  recovery_attempts: 1,
  recoveries: 1
}); assertions += 1;
assert.equal(scaled.identity.entries_before, 12944); assertions += 1;
assert.equal(scaled.identity.entries_after, 12944); assertions += 1;
assert.equal(scaled.identity.total_before, 12944); assertions += 1;
assert.equal(scaled.identity.total_after, 12944); assertions += 1;

const scaledTasks = new Map(scaledReport.result.tasks.map((task) => [task.task_id, task]));
assert.equal(scaledTasks.get('locked_fail_closed').evidence.rejected, true); assertions += 1;
assert.equal(scaledTasks.get('rollback').evidence.revision_preserved, true); assertions += 1;
assert.equal(scaledTasks.get('rollback').evidence.guard_unchanged, true); assertions += 1;
assert.equal(scaledTasks.get('rollback').evidence.locked_target_unchanged, true); assertions += 1;
assert.deepEqual(scaledTasks.get('nonuniform_mirror').evidence.scale, [1.5, 0.75, 2]); assertions += 1;
assert.equal(scaledTasks.get('nonuniform_mirror').evidence.mirror, 'x'); assertions += 1;
assert.equal(scaledTasks.get('nonuniform_mirror').evidence.exact_target_changed, true); assertions += 1;
assert.equal(scaledTasks.get('wrong_object_isolation').evidence.guard_unchanged, true); assertions += 1;
assert.equal(scaledTasks.get('wrong_object_isolation').evidence.locked_target_unchanged, true); assertions += 1;

for (const baseCase of evidence.cases.filter((entry) => entry.case_id !== 'scaled-mirrored-locked')) {
  assert.equal(baseCase.mutation.geometry_mutation_executed, false); assertions += 1;
  assert.equal(baseCase.mutation.nonuniform_scale, null); assertions += 1;
  assert.equal(baseCase.mutation.mirror_axis, null); assertions += 1;
}

assert.equal(
  evidence.aggregate_metrics.aggregate_duration_ms,
  evidence.cases.reduce((sum, entry) => sum + entry.duration_ms, 0)
); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_total, evidence.cases.reduce((sum, entry) => sum + entry.tasks_total, 0)); assertions += 1;
assert.equal(evidence.aggregate_metrics.tasks_passed, evidence.cases.reduce((sum, entry) => sum + entry.tasks_passed, 0)); assertions += 1;
assert.equal(evidence.aggregate_metrics.geometry_mutation_cases_passed, 1); assertions += 1;
assert.equal(evidence.aggregate_metrics.recovery_rate, 1); assertions += 1;
assert.equal(evidence.acceptance.mutation_cases_passed, 1); assertions += 1;
assert.equal(evidence.acceptance.locked_transform_rollback, true); assertions += 1;
assert.equal(evidence.acceptance.native_lock_guard_enforced, true); assertions += 1;
assert.equal(evidence.acceptance.formal_corpus_complete, false); assertions += 1;
assert.equal(evidence.acceptance.agent_gateway_default_profile_qualified, false); assertions += 1;
assert.equal(evidence.acceptance.cross_version, 'deferred_by_user'); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.result = 'pass'; }),
  mutate(evidence, (value) => { value.execution_authorization.agent_self_authorization_allowed = true; }),
  mutate(evidence, (value) => { value.corpus.formal_cases_passed = 7; }),
  mutate(evidence, (value) => { value.corpus.formal_corpus_complete = true; }),
  mutate(evidence, (value) => { value.aggregate_metrics.tasks_passed = 10; }),
  mutate(evidence, (value) => { value.aggregate_metrics.wrong_object_modification_count = 1; }),
  mutate(evidence, (value) => { value.aggregate_metrics.recoveries = 0; }),
  mutate(evidence, (value) => { value.locked_target_guard.native_lock_alone_sufficient = true; }),
  mutate(evidence, (value) => { value.locked_target_guard.guard_unchanged = false; }),
  mutate(evidence, (value) => { value.cases[2].mutation.locked_target_unchanged = false; }),
  mutate(evidence, (value) => { value.cases[2].mutation.nonuniform_scale = [1, 1, 1]; }),
  mutate(evidence, (value) => { value.acceptance.mutation_cases_passed = 2; }),
  mutate(evidence, (value) => { value.acceptance.boolean_manifold = true; }),
  mutate(evidence, (value) => { value.acceptance.cross_version = 'passed'; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validateEvidence(invalid), false, 'overclaim or unsafe v2 evidence must fail closed'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_contract: evidence.version,
  cases_passed: evidence.acceptance.formal_corpus_cases_passed,
  cases_total: evidence.acceptance.formal_corpus_cases_total,
  tasks_passed: evidence.aggregate_metrics.tasks_passed,
  mutation_cases_passed: evidence.acceptance.mutation_cases_passed,
  scaled_recursive_entries: scaled.identity.total_after,
  wrong_object_modification_count: 0,
  silent_geometry_corruption_count: 0,
  recovery_rate: 1,
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
