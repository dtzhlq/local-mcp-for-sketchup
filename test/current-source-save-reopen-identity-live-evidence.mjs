import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson('docs/evidence/current-source-save-reopen-identity-live-evidence-2026-07-22.json');
const evidenceSchema = await readJson('schema/current-source-save-reopen-identity-live-evidence-v1.schema.json');
const reportSchema = await readJson('schema/save-reopen-identity-report-v2.schema.json');
const report = await readJson(evidence.report.path);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateReport = ajv.compile(reportSchema);
let assertions = 0;

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after the live run`); assertions += 1;
}
for (const [relativePath, expected] of Object.entries(evidence.artifact_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} does not match the frozen live evidence`); assertions += 1;
}

assert.equal(report.runtime, 'queue'); assertions += 1;
assert.equal(report.live_proof, true); assertions += 1;
assert.equal(report.destructive_opt_in.observed, true); assertions += 1;
assert.equal(report.model_revision_before, evidence.report.model_revision_before); assertions += 1;
assert.equal(report.model_revision_after, evidence.report.model_revision_after); assertions += 1;
assert.equal(report.revision_attestation.source_exact_match, evidence.report.source_exact_match); assertions += 1;
assert.equal(report.revision_attestation.after_reopen_clean, evidence.report.after_reopen_clean); assertions += 1;
assert.equal(report.path_switch.verified, evidence.report.path_switch_verified); assertions += 1;
assert.equal(report.path_switch.active_source_path_verified, evidence.report.active_source_path_verified); assertions += 1;
assert.notEqual(report.path_switch.target_path, report.path_switch.intermediary_path); assertions += 1;
assert.equal(report.identity.entries_before, evidence.report.entries_before); assertions += 1;
assert.equal(report.identity.entries_after, evidence.report.entries_after); assertions += 1;
assert.equal(report.identity.exact_match, evidence.report.identity_exact_match); assertions += 1;
assert.equal(report.identity.shared_leaf_occurrences, evidence.report.shared_leaf_occurrences); assertions += 1;
assert.equal(report.identity.face_edge_entries, evidence.report.face_edge_entries); assertions += 1;
assert.equal(report.snapshot_compare.diff_count, evidence.report.snapshot_diff_count); assertions += 1;
assert.equal(report.snapshot_compare.verdict, evidence.report.snapshot_verdict); assertions += 1;
assert.deepEqual(report.queue_clean, evidence.report.queue_clean); assertions += 1;

const targetPath = 'output/live-validation/save-reopen-identity/current-source-2026-07-22-v1/target.skp';
const intermediaryPath = 'output/live-validation/save-reopen-identity/current-source-2026-07-22-v1/intermediary.skp';
const checkpointPath = 'output/live-validation/save-reopen-identity/current-source-2026-07-22-v1/save-reopen-checkpoint.json';
assert.equal((await fs.stat(path.join(repoRoot, targetPath))).size, evidence.artifact_sizes.target_skp_bytes); assertions += 1;
assert.equal((await fs.stat(path.join(repoRoot, intermediaryPath))).size, evidence.artifact_sizes.intermediary_skp_bytes); assertions += 1;
assert.equal((await fs.stat(path.join(repoRoot, checkpointPath))).size, evidence.artifact_sizes.checkpoint_bytes); assertions += 1;
assert.notEqual(evidence.artifact_sha256[targetPath], evidence.artifact_sha256[intermediaryPath]); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.result = 'inconclusive'; }),
  mutate(evidence, (value) => { value.execution_authorization.policy_persisted = true; }),
  mutate(evidence, (value) => { value.execution_authorization.default_policy_unchanged = false; }),
  mutate(evidence, (value) => { value.report.revision_exact_match = false; }),
  mutate(evidence, (value) => { value.report.path_switch_verified = false; }),
  mutate(evidence, (value) => { value.report.identity_exact_match = false; }),
  mutate(evidence, (value) => { value.report.snapshot_diff_count = 1; }),
  mutate(evidence, (value) => { value.report.queue_clean.queue = 1; }),
  mutate(evidence, (value) => { value.acceptance.feature_history_lineage = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validateEvidence(invalid), false, 'overclaim or unsafe live evidence must fail closed'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_contract: evidence.version,
  report_contract: report.contract_version,
  current_source_live_save_reopen: true,
  model_revision: report.model_revision_after,
  identity_entries: report.identity.entries_after,
  shared_leaf_occurrences: report.identity.shared_leaf_occurrences,
  face_edge_entries: report.identity.face_edge_entries,
  snapshot_diff_count: report.snapshot_compare.diff_count,
  queue_clean: true,
  feature_history_lineage: false,
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
