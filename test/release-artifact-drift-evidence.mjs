import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/release-rc2-artifact-drift-evidence-2026-07-21.json';
const schemaPath = 'schema/release-artifact-drift-evidence-v1.schema.json';
const releasePaths = new Set([
  'out/releases/release-manifest-0.1.0-rc.2.json',
  'out/releases/alma-sketchup-mcp-0.1.0-rc.2.sha256',
  'out/releases/alma-sketchup-mcp-0.1.0-rc.2.rbz'
]);
const releaseReads = [];
let assertions = 0;

const [evidence, schema] = await Promise.all([
  readJson(evidencePath),
  readJson(schemaPath)
]);
const validate = new Ajv2020({ strict: true, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.equal(schema.additionalProperties, false); assertions += 1;

const observed = {};
for (const [name, binding] of Object.entries(evidence.observed_artifacts)) {
  const snapshot = await readReleaseArtifact(binding.path);
  releaseReads.push(binding.path);
  assert.equal(snapshot.bytes.length, binding.size_bytes, `${name} byte size drifted after evidence capture`); assertions += 1;
  assert.equal(`sha256:${sha256(snapshot.bytes)}`, binding.sha256, `${name} SHA-256 drifted after evidence capture`); assertions += 1;
  assert.equal(snapshot.mtime, binding.mtime_observed, `${name} mtime observation drifted after evidence capture`); assertions += 1;
  observed[name] = snapshot;
}
assert.deepEqual([...new Set(releaseReads)].sort(), [...releasePaths].sort()); assertions += 1;
assert.equal(releaseReads.length, 3); assertions += 1;

const manifest = JSON.parse(observed.manifest.bytes.toString('utf8'));
assert.equal(manifest.product_version, '0.1.0-rc.2'); assertions += 1;
assert.equal(manifest.release_status, 'rc_candidate_verified'); assertions += 1;
assert.equal(manifest.rc_signed, true); assertions += 1;
assert.equal(manifest.git.branch, evidence.historical_signed_rc_declaration.git.branch); assertions += 1;
assert.equal(manifest.git.head, evidence.historical_signed_rc_declaration.git.head); assertions += 1;
assert.equal(evidence.historical_signed_rc_declaration.git.semantics, 'historical_manifest_declaration_not_current_checkout_assertion'); assertions += 1;
assert.equal(manifest.artifacts.rbz, evidence.historical_signed_rc_declaration.expected_rbz.path); assertions += 1;
assert.equal(manifest.artifacts.rbz_size_bytes, 70724); assertions += 1;
assert.equal(`sha256:${manifest.artifacts.rbz_sha256}`, evidence.historical_signed_rc_declaration.expected_rbz.sha256); assertions += 1;
assert.equal(manifest.artifacts.sha256_file, evidence.historical_signed_rc_declaration.sidecar.path); assertions += 1;

const sidecarText = observed.sidecar.bytes.toString('utf8');
const sidecarMatch = /^([0-9a-f]{64})  ([a-zA-Z0-9._-]+)\n$/.exec(sidecarText);
assert.ok(sidecarMatch, 'the historical SHA-256 sidecar must remain canonical'); assertions += 1;
const [, sidecarDigest, sidecarFilename] = sidecarMatch;
assert.equal(sidecarFilename, evidence.historical_signed_rc_declaration.sidecar.declared_filename); assertions += 1;
assert.equal(`sha256:${sidecarDigest}`, evidence.historical_signed_rc_declaration.sidecar.declared_sha256); assertions += 1;
assert.equal(sidecarDigest, manifest.artifacts.rbz_sha256); assertions += 1;

const currentDigest = sha256(observed.rbz.bytes);
assert.equal(observed.rbz.bytes.length, 90432); assertions += 1;
assert.equal(`sha256:${currentDigest}`, 'sha256:01a95525bd73d48d40e1e50e2fee61d967b72f58752396e01bfdc3897dced34d'); assertions += 1;
assert.notEqual(observed.rbz.bytes.length, manifest.artifacts.rbz_size_bytes); assertions += 1;
assert.notEqual(currentDigest, manifest.artifacts.rbz_sha256); assertions += 1;
assert.notEqual(currentDigest, sidecarDigest); assertions += 1;
assert.equal(observed.rbz.bytes.length - manifest.artifacts.rbz_size_bytes, evidence.comparison.size_delta_bytes); assertions += 1;
assert.equal(evidence.comparison.manifest_and_sidecar_sha256_match, true); assertions += 1;
assert.equal(evidence.comparison.manifest_and_current_rbz_size_match, false); assertions += 1;
assert.equal(evidence.comparison.manifest_and_current_rbz_sha256_match, false); assertions += 1;
assert.equal(evidence.comparison.sidecar_and_current_rbz_sha256_match, false); assertions += 1;
assert.equal(evidence.comparison.manifest_sidecar_consistent_current_rbz_inconsistent, true); assertions += 1;
assert.equal(evidence.comparison.mtime_semantics, 'observation_only_not_causal_attribution'); assertions += 1;
assert.equal(evidence.comparison.mtime_used_for_causal_attribution, false); assertions += 1;
assert.equal(evidence.comparison.drift_cause, 'undetermined'); assertions += 1;

assert.equal(evidence.integrity_decision.current_artifact_status, 'invalid_for_signed_rc'); assertions += 1;
assert.equal(evidence.integrity_decision.signed_rc_identity_valid, false); assertions += 1;
assert.equal(evidence.integrity_decision.current_artifact_overwrite_allowed, false); assertions += 1;
assert.equal(evidence.integrity_decision.current_artifact_delete_allowed, false); assertions += 1;
assert.equal(evidence.integrity_decision.automatic_self_repair_allowed, false); assertions += 1;
assert.equal(evidence.integrity_decision.historical_manifest_or_sidecar_rewrite_allowed, false); assertions += 1;
assert.deepEqual(evidence.integrity_decision.allowed_recovery_paths, [
  'recover_historical_copy_matching_manifest_and_sidecar',
  'rebuild_as_new_version_and_regenerate_manifest_sidecar_and_signature'
]); assertions += 1;
assert.equal(evidence.release_acceptance, false); assertions += 1;
assert.deepEqual(evidence.verification, {
  mode: 'explicit_read_only_local_release_artifact_integrity',
  local_release_artifacts_read: 3,
  artifact_bytes_modified: false,
  queue_requested: false,
  queue_files_read: false
}); assertions += 1;

const publicText = JSON.stringify(evidence);
assert.doesNotMatch(publicText, /(?:^|["'])\/(?:Users|home|private|tmp|var)\//); assertions += 1;
assert.doesNotMatch(publicText, /[A-Za-z]:\\/); assertions += 1;
for (const repoPath of collectPathValues(evidence)) {
  assert.equal(isSafeRepoRelativePath(repoPath), true, `unsafe public evidence path: ${repoPath}`); assertions += 1;
}

const invalidEvidence = [
  mutate(evidence, (value) => { value.observed_artifacts.rbz.size_bytes = 70724; }),
  mutate(evidence, (value) => { value.observed_artifacts.rbz.sha256 = value.historical_signed_rc_declaration.expected_rbz.sha256; }),
  mutate(evidence, (value) => { value.observed_artifacts.rbz.path = '/Users/example/release.rbz'; }),
  mutate(evidence, (value) => { value.historical_signed_rc_declaration.git.semantics = 'current_checkout'; }),
  mutate(evidence, (value) => { value.comparison.manifest_and_current_rbz_sha256_match = true; }),
  mutate(evidence, (value) => { value.comparison.mtime_used_for_causal_attribution = true; }),
  mutate(evidence, (value) => { value.comparison.drift_cause = 'mtime_proves_rebuild'; }),
  mutate(evidence, (value) => { value.integrity_decision.current_artifact_status = 'valid'; }),
  mutate(evidence, (value) => { value.integrity_decision.current_artifact_overwrite_allowed = true; }),
  mutate(evidence, (value) => { value.integrity_decision.current_artifact_delete_allowed = true; }),
  mutate(evidence, (value) => { value.integrity_decision.automatic_self_repair_allowed = true; }),
  mutate(evidence, (value) => { value.integrity_decision.allowed_recovery_paths.push('overwrite_rc2_in_place'); }),
  mutate(evidence, (value) => { value.verification.artifact_bytes_modified = true; }),
  mutate(evidence, (value) => { value.verification.queue_requested = true; }),
  mutate(evidence, (value) => { value.release_acceptance = true; }),
  mutate(evidence, (value) => { value.unexpected = true; })
];
for (const invalid of invalidEvidence) {
  assert.equal(validate(invalid), false, 'unsafe or contradictory RC drift evidence must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: evidence.verification.mode,
  assertions,
  local_release_artifacts_read: releaseReads.length,
  artifact_paths: [...releasePaths].sort(),
  manifest_expected_size_bytes: manifest.artifacts.rbz_size_bytes,
  manifest_expected_sha256: `sha256:${manifest.artifacts.rbz_sha256}`,
  current_observed_size_bytes: observed.rbz.bytes.length,
  current_observed_sha256: `sha256:${currentDigest}`,
  manifest_sidecar_consistent: true,
  current_rbz_consistent: false,
  current_artifact_status: evidence.integrity_decision.current_artifact_status,
  artifact_bytes_modified: false,
  queue_requested: false,
  release_acceptance: false,
  negative_cases: invalidEvidence.length
}, null, 2)}\n`);

async function readJson(repoPath) {
  const snapshot = await readStableRepoFile(repoPath);
  return JSON.parse(snapshot.bytes.toString('utf8'));
}

async function readReleaseArtifact(repoPath) {
  assert.equal(releasePaths.has(repoPath), true, `unexpected release artifact read: ${repoPath}`);
  return readStableRepoFile(repoPath);
}

async function readStableRepoFile(repoPath) {
  assert.equal(isSafeRepoRelativePath(repoPath), true, `unsafe repository path: ${repoPath}`);
  const absolutePath = path.resolve(repoRoot, repoPath);
  const canonicalPath = await fs.realpath(absolutePath);
  assert.equal(canonicalPath, absolutePath, `symlinked repository input is forbidden: ${repoPath}`);
  let handle;
  try {
    const linkStat = await fs.lstat(absolutePath);
    assert.equal(linkStat.isSymbolicLink(), false, `symlinked repository input is forbidden: ${repoPath}`);
    assert.equal(linkStat.isFile(), true, `repository input must be a regular file: ${repoPath}`);
    assert.equal(linkStat.nlink, 1, `repository input must not have extra hard links: ${repoPath}`);
    handle = await fs.open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    assert.equal(sameSnapshot(before, after), true, `repository input changed during verification: ${repoPath}`);
    assert.equal(bytes.length, after.size, `repository input size changed during verification: ${repoPath}`);
    const canonicalAfter = await fs.realpath(absolutePath);
    const pathStat = await fs.stat(canonicalAfter);
    assert.equal(canonicalAfter, canonicalPath, `repository input path changed during verification: ${repoPath}`);
    assert.equal(sameIdentity(after, pathStat), true, `repository input identity changed during verification: ${repoPath}`);
    return { bytes, mtime: after.mtime.toISOString() };
  } finally {
    await handle?.close();
  }
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function sameIdentity(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function isSafeRepoRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) return false;
  if (path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== '..' && !normalized.startsWith('../');
}

function collectPathValues(value, key = '') {
  if (Array.isArray(value)) return value.flatMap((item) => collectPathValues(item, key));
  if (!value || typeof value !== 'object') return key === 'path' || key === 'source_path' ? [value] : [];
  return Object.entries(value).flatMap(([childKey, child]) => collectPathValues(child, childKey));
}

function mutate(value, callback) {
  const clone = structuredClone(value);
  callback(clone);
  return clone;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
