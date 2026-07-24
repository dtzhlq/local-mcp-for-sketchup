import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'docs/evidence/real-model-target-review-v1-archival-lineage-manifest-v1.json';
const manifestSchemaPath = 'schema/real-model-target-review-v1-archival-lineage-manifest-v1.schema.json';
const expectedEntry = Object.freeze({
  path: 'docs/evidence/real-model-target-review-v1-mock-evidence.json',
  sha256: 'sha256:20139fad3c0ae7964b5f88f79ec7531acb06194d80b36c21bfb5d889c6e91274',
  contract_schema_path: 'schema/real-model-target-review-v1.schema.json',
  contract_schema_sha256: 'sha256:9a9c6203d605abf56515462d58153cbefff508643935f0a521b2f0e6c1423da1',
  linked_live_evidence_path: 'docs/evidence/real-model-target-review-live-evidence-2026-07-20.json',
  linked_live_evidence_sha256: 'sha256:ba0d92baa78b4857a5c6d7eb1aa403db992c517442cc5a1a241593b2a7a619e1',
  evidence_kind: 'real_model_target_review_mock_evidence',
  runtime: 'synthetic_fake_queue',
  target_review_version_pointer: '/contract/target_review',
  release_acceptance_pointer: '/safety/release_acceptance',
  mutation_authorized_pointer: '/safety/model_mutation_authorized'
});

const [manifestRaw, manifestSchemaRaw] = await Promise.all([
  readRegularRepoFile(manifestPath),
  readRegularRepoFile(manifestSchemaPath)
]);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const manifestSchema = JSON.parse(manifestSchemaRaw.toString('utf8'));
const validateManifest = compileSchema(manifestSchema);
assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors, null, 2));

assert.equal(manifest.target_review_version, 'real-model-target-review.v1');
assert.equal(manifest.superseded_by, 'real-model-target-review.v2');
assert.equal(manifest.lineage_only, true);
assert.equal(manifest.current_acceptance, false);
assert.equal(manifest.release_acceptance, false);
assert.equal(manifest.historical_schema_readable, true);
assert.equal(manifest.immutable_evidence, true);
assert.equal(manifest.policy.hashes_bind_evidence_bytes, true);
assert.equal(manifest.policy.historical_schema_bytes_bound, true);
assert.equal(manifest.policy.linked_live_evidence_bytes_bound, true);
assert.equal(manifest.policy.embedded_source_hashes_are_capture_time_only, true);
assert.equal(manifest.policy.historical_source_hashes_compared_to_current_tree, false);
assert.equal(manifest.policy.historical_contract_tests_are_not_rerun_as_current_acceptance, true);
assert.equal(manifest.policy.historical_evidence_may_authorize_current_execution, false);
assert.equal(manifest.policy.historical_evidence_may_satisfy_current_acceptance, false);
assert.equal(manifest.policy.current_evidence_source_hash_validation_preserved, true);
assert.equal(manifest.entries.length, 1);

const entry = manifest.entries[0];
for (const [key, value] of Object.entries(expectedEntry)) {
  assert.equal(entry[key], value, `${key} drift`);
}
assert.equal(entry.lineage_only, true);
assert.equal(entry.current_acceptance, false);
assert.equal(entry.release_acceptance, false);
assert.deepEqual(manifest.evidence_sha256, { [entry.path]: entry.sha256 });

const [evidenceRaw, contractSchemaRaw, linkedLiveEvidenceRaw] = await Promise.all([
  verifyPinnedFile(entry.path, entry.sha256),
  verifyPinnedFile(entry.contract_schema_path, entry.contract_schema_sha256),
  verifyPinnedFile(entry.linked_live_evidence_path, entry.linked_live_evidence_sha256)
]);
const evidence = JSON.parse(evidenceRaw.toString('utf8'));
const historicalContractSchema = JSON.parse(contractSchemaRaw.toString('utf8'));
const linkedLiveEvidence = JSON.parse(linkedLiveEvidenceRaw.toString('utf8'));
const validateHistoricalTargetReview = compileSchema(historicalContractSchema);
assert.equal(
  validateHistoricalTargetReview(linkedLiveEvidence),
  true,
  JSON.stringify(validateHistoricalTargetReview.errors, null, 2)
);

assert.equal(evidence.version, 'real-model-target-review-v1-mock-evidence.1');
assert.equal(evidence.kind, entry.evidence_kind);
assert.equal(evidence.result, 'pass');
assert.equal(readJsonPointer(evidence, entry.target_review_version_pointer), manifest.target_review_version);
assert.equal(readJsonPointer(evidence, entry.release_acceptance_pointer), false);
assert.equal(readJsonPointer(evidence, entry.mutation_authorized_pointer), false);
assert.equal(evidence.commands.length, 1);
assert.equal(evidence.commands[0].runtime, entry.runtime);
assert.equal(evidence.commands[0].live_queue_called, false);
assert.equal(evidence.contract_test.real_sketchup_called, false);
assert.equal(evidence.contract_test.default_live_queue_called, false);
assert.equal(evidence.separate_live_read_only_evidence.path, entry.linked_live_evidence_path);
assert.equal(evidence.separate_live_read_only_evidence.sha256, entry.linked_live_evidence_sha256);
assert.equal(evidence.separate_live_read_only_evidence.release_acceptance, false);
assert.equal(evidence.safety.approval_token_issued, false);
assert.equal(evidence.safety.target_roles_confirmed, false);

assert.equal(linkedLiveEvidence.version, manifest.target_review_version);
assert.equal(linkedLiveEvidence.kind, 'real_model_target_review');
assert.equal(linkedLiveEvidence.runtime, 'queue');
assert.equal(linkedLiveEvidence.live_queue_called, true);
assert.equal(linkedLiveEvidence.next_action.release_acceptance, false);
assert.equal(linkedLiveEvidence.next_action.mutation_authorized, false);
assert.equal(linkedLiveEvidence.next_action.approval_token_issued, false);
assert.equal(linkedLiveEvidence.safety.model_content_mutation_requested, false);
assert.equal(linkedLiveEvidence.safety.save_requested, false);

const captureTimeBindings = Object.entries(evidence.hashes);
assert.equal(captureTimeBindings.length, 5);
for (const [repoPath, digest] of captureTimeBindings) {
  assert.equal(isSafeRepoRelativePath(repoPath), true, `unsafe capture-time path: ${repoPath}`);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
}
assert.equal(evidence.hashes[entry.contract_schema_path], entry.contract_schema_sha256);
assert.equal(evidence.hashes[entry.linked_live_evidence_path], entry.linked_live_evidence_sha256);

const invalidManifests = [
  mutate(manifest, (value) => { value.lineage_only = false; }),
  mutate(manifest, (value) => { value.current_acceptance = true; }),
  mutate(manifest, (value) => { value.release_acceptance = true; }),
  mutate(manifest, (value) => { value.policy.historical_source_hashes_compared_to_current_tree = true; }),
  mutate(manifest, (value) => { value.policy.current_evidence_source_hash_validation_preserved = false; }),
  mutate(manifest, (value) => { value.entries[0].current_acceptance = true; }),
  mutate(manifest, (value) => { value.entries[0].release_acceptance = true; }),
  mutate(manifest, (value) => { value.entries[0].path = '../escaped-evidence.json'; })
];
for (const invalid of invalidManifests) {
  assert.equal(validateManifest(invalid), false, 'unsafe archival manifest must fail schema validation');
}

await assert.rejects(
  () => verifyPinnedFile(entry.path, `sha256:${'0'.repeat(64)}`),
  /byte hash drift/
);
await assert.rejects(
  () => verifyPinnedFile(entry.contract_schema_path, `sha256:${'0'.repeat(64)}`),
  /byte hash drift/
);
await assert.rejects(
  () => verifyPinnedFile(entry.linked_live_evidence_path, `sha256:${'0'.repeat(64)}`),
  /byte hash drift/
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  target_review_version: manifest.target_review_version,
  superseded_by: manifest.superseded_by,
  archival_evidence_files: 1,
  historical_evidence_byte_hash_bindings: 1,
  historical_schema_byte_hash_bindings: 1,
  linked_live_evidence_byte_hash_bindings: 1,
  historical_schemas_validated: 1,
  historical_embedded_source_bindings: captureTimeBindings.length,
  current_source_hashes_compared: 0,
  lineage_only: true,
  current_acceptance: false,
  release_acceptance: false,
  current_source_hash_policy_preserved: true,
  live_queue_called: false,
  negative_cases: invalidManifests.length + 3
}, null, 2)}\n`);

function compileSchema(schema) {
  return new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
}

async function verifyPinnedFile(repoPath, expectedSha256) {
  const bytes = await readRegularRepoFile(repoPath);
  assert.equal(`sha256:${sha256(bytes)}`, expectedSha256, `${repoPath} byte hash drift`);
  return bytes;
}

async function readRegularRepoFile(repoPath) {
  assert.equal(isSafeRepoRelativePath(repoPath), true, `path escapes repository: ${repoPath}`);
  const candidate = path.resolve(repoRoot, repoPath);
  const lexicalStat = await fs.lstat(candidate);
  assert.equal(lexicalStat.isSymbolicLink(), false, `symbolic link is not allowed: ${repoPath}`);
  assert.equal(lexicalStat.isFile(), true, `not a regular file: ${repoPath}`);
  const [realRoot, realCandidate] = await Promise.all([fs.realpath(repoRoot), fs.realpath(candidate)]);
  const relative = path.relative(realRoot, realCandidate);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `symlink escapes repository: ${repoPath}`);
  assert.equal((await fs.stat(realCandidate)).isFile(), true, `not a regular file: ${repoPath}`);
  return fs.readFile(realCandidate);
}

function isSafeRepoRelativePath(repoPath) {
  if (typeof repoPath !== 'string' || repoPath.length === 0 || repoPath.includes('\\') || repoPath.includes('\u0000')
    || path.posix.isAbsolute(repoPath) || path.win32.isAbsolute(repoPath)) {
    return false;
  }
  const segments = repoPath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return false;
  if (path.posix.normalize(repoPath) !== repoPath) return false;
  const candidate = path.resolve(repoRoot, repoPath);
  const relative = path.relative(repoRoot, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readJsonPointer(document, pointer) {
  assert.match(pointer, /^\//);
  return pointer.slice(1).split('/').reduce((value, token) => {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    assert.ok(value && Object.prototype.hasOwnProperty.call(value, key), `missing JSON pointer ${pointer}`);
    return value[key];
  }, document);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
