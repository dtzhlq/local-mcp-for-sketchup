import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidencePath = 'docs/evidence/locked-target-guard-live-evidence-2026-07-23.json';
const evidence = await readJson(evidencePath);
const evidenceSchema = await readJson('schema/locked-target-guard-live-evidence-v1.schema.json');
const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateReport = ajv.compile(reportSchema);
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

assert.equal(
  evidence.source_fixture.original_input_sha256,
  evidence.artifacts.original_input.sha256
); assertions += 1;
assert.equal(
  evidence.runtime.loaded_boolean_source_sha256,
  evidence.source_sha256['sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb']
); assertions += 1;
assert.equal(
  evidence.runtime.revision_source_sha256,
  evidence.source_sha256['sketchup_plugin/alma_sketchup_mcp/model_revision.rb']
); assertions += 1;

const finalization = await readJson(evidence.artifacts.finalization_report.path);
assert.equal(finalization.source.sha256, evidence.artifacts.original_input.sha256); assertions += 1;
assert.equal(finalization.source.original_bytes_unchanged, true); assertions += 1;
assert.equal(finalization.native_lock.observed_before_save, true); assertions += 1;
assert.equal(finalization.native_lock.observed_after_reopen, true); assertions += 1;
assert.equal(finalization.identity.recursive_total, 12944); assertions += 1;
assert.deepEqual(finalization.queue_clean, emptyQueue()); assertions += 1;

const failure = await readJson(evidence.artifacts.failure_report.path);
assert.equal(failure.ok, false); assertions += 1;
assert.equal(failure.selected_case.case_id, evidence.case_id); assertions += 1;
assert.equal(failure.result.tasks[0].task_id, 'locked_fail_closed'); assertions += 1;
assert.equal(failure.result.tasks[0].status, 'failed'); assertions += 1;
assert.equal(failure.result.error, evidence.discovery.failure_error); assertions += 1;
assert.match(failure.result.error, /Expected operation to reject with .*locked/); assertions += 1;
assert.deepEqual(failure.queue_clean, emptyQueue()); assertions += 1;
assert.notEqual(evidence.artifacts.failure_state.sha256, evidence.artifacts.source_model.sha256); assertions += 1;

const success = await readJson(evidence.artifacts.success_report.path);
assert.equal(validateReport(success), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assert.equal(success.ok, true); assertions += 1;
assert.equal(success.selected_case.case_id, evidence.case_id); assertions += 1;
assert.equal(success.metrics.tasks_total, 5); assertions += 1;
assert.equal(success.metrics.tasks_passed, 5); assertions += 1;
assert.equal(success.metrics.wrong_object_modification_count, 0); assertions += 1;
assert.equal(success.metrics.silent_geometry_corruption_count, 0); assertions += 1;
assert.equal(success.metrics.recovery_attempts, 1); assertions += 1;
assert.equal(success.metrics.recoveries, 1); assertions += 1;
assert.deepEqual(success.queue_clean, emptyQueue()); assertions += 1;
assert.equal(success.artifacts.source_sha256, `sha256:${evidence.artifacts.source_model.sha256}`); assertions += 1;
assert.equal(success.artifacts.contract_sha256, `sha256:${evidence.artifacts.source_contract.sha256}`); assertions += 1;
assert.equal(success.artifacts.verified_model_sha256, `sha256:${evidence.artifacts.verified_model.sha256}`); assertions += 1;

const tasks = new Map(success.result.tasks.map((task) => [task.task_id, task]));
assert.equal(tasks.get('locked_fail_closed').evidence.rejected, true); assertions += 1;
assert.equal(tasks.get('rollback').evidence.revision_preserved, true); assertions += 1;
assert.equal(tasks.get('rollback').evidence.guard_unchanged, true); assertions += 1;
assert.equal(tasks.get('rollback').evidence.locked_target_unchanged, true); assertions += 1;
assert.deepEqual(tasks.get('nonuniform_mirror').evidence.scale, [1.5, 0.75, 2]); assertions += 1;
assert.equal(tasks.get('nonuniform_mirror').evidence.mirror, 'x'); assertions += 1;
assert.equal(tasks.get('nonuniform_mirror').evidence.exact_target_changed, true); assertions += 1;
assert.equal(tasks.get('wrong_object_isolation').evidence.guard_unchanged, true); assertions += 1;
assert.equal(tasks.get('wrong_object_isolation').evidence.locked_target_unchanged, true); assertions += 1;

const identity = tasks.get('save_reopen_identity').evidence;
assert.equal(identity.exact_match, true); assertions += 1;
assert.equal(identity.identity_mode, 'full_recursive'); assertions += 1;
assert.equal(identity.entries_before, 12944); assertions += 1;
assert.equal(identity.entries_after, 12944); assertions += 1;
assert.equal(identity.model_revision_exact_match, true); assertions += 1;
assert.equal(identity.snapshot_error_diffs, 0); assertions += 1;

const diagnostic = await readJson(evidence.artifacts.success_diagnostic.path);
assert.equal(diagnostic.identity_signature_before, diagnostic.identity_signature_after); assertions += 1;
assert.equal(diagnostic.identity_signature_after, identity.signature); assertions += 1;
assert.equal(diagnostic.model_revision_before, diagnostic.model_revision_after); assertions += 1;
assert.equal(diagnostic.model_revision_after, identity.model_revision_after); assertions += 1;
assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0); assertions += 1;
assert.equal(diagnostic.snapshot_diff.verdict, 'pass'); assertions += 1;

const { stdout } = await execFile('ruby', ['test/ruby/locked_target_guard_test.rb'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024
});
const rubyGuard = JSON.parse(stdout);
assert.equal(rubyGuard.ok, true); assertions += 1;
assert.equal(rubyGuard.mutating_operations_guarded, evidence.fix.mutating_operations_guarded); assertions += 1;
assert.equal(rubyGuard.top_level_locked_rejected, true); assertions += 1;
assert.equal(rubyGuard.locked_ancestor_rejected, true); assertions += 1;
assert.equal(rubyGuard.selection_read_only_allowed, true); assertions += 1;
assert.equal(rubyGuard.manifold_check_read_only_allowed, true); assertions += 1;
assert.equal(rubyGuard.manifold_repair_locked_rejected, true); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.discovery.observed_locked_batch_rejection = true; }),
  mutate(evidence, (value) => { value.discovery.batch_unexpectedly_committed = false; }),
  mutate(evidence, (value) => { value.fix.mutating_operations_guarded = 24; }),
  mutate(evidence, (value) => { value.fix.read_only_locked_access.push('transform_object'); }),
  mutate(evidence, (value) => { value.live_verification.locked_target_unchanged = false; }),
  mutate(evidence, (value) => { value.live_verification.guard_unchanged = false; }),
  mutate(evidence, (value) => { value.live_verification.wrong_object_modification_count = 1; }),
  mutate(evidence, (value) => { value.live_verification.recoveries = 0; }),
  mutate(evidence, (value) => { value.acceptance.formal_corpus_complete = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validateEvidence(invalid), false, 'unsafe or overclaimed evidence must fail closed'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_contract: evidence.version,
  case_id: evidence.case_id,
  tasks_passed: evidence.live_verification.tasks_passed,
  mutating_operations_guarded: evidence.fix.mutating_operations_guarded,
  recursive_entries: evidence.live_verification.recursive_entries_after,
  wrong_object_modification_count: 0,
  silent_geometry_corruption_count: 0,
  release_acceptance: false,
  negative_cases: negativeCases.length,
  assertions
}, null, 2)}\n`);

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, relativePath))).digest('hex');
}

function emptyQueue() {
  return { queue: 0, processing: 0, responses: 0, lock: false };
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
