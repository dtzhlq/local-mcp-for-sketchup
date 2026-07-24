import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'docs/evidence/real-model-reliability-plan-v1-archival-lineage-manifest-v1.json';
const manifestSchemaPath = 'schema/real-model-reliability-plan-v1-archival-lineage-manifest-v1.schema.json';
const expectedEntry = Object.freeze({
  path: 'docs/evidence/real-model-recursive-reliability-v1-mock-evidence.json',
  sha256: 'sha256:0efe311bda21ed69e0a68ef19222b16936cabf7e3836605b3bc505a880989219',
  schema_path: 'schema/real-model-recursive-reliability-evidence-v1.schema.json',
  schema_sha256: 'sha256:221354ddce6467f9ea04c9099451d1261154b175198e013255cff7274f157b6d',
  plan_schema_path: 'schema/real-model-reliability-execution-plan-v1.schema.json',
  plan_schema_sha256: 'sha256:2fa1675ae86b8a1f934c62f8cd74e4275942dfbaf14e7d7c124ebf75d9d39d32',
  evidence_kind: 'real_model_recursive_reliability_v1_mock_evidence',
  runtime: 'offline',
  staged_plan_version_pointer: '/contracts/staged_plan/version',
  release_acceptance_pointer: '/release_boundary/release_acceptance'
});

const [manifestRaw, manifestSchemaRaw] = await Promise.all([
  readRegularRepoFile(manifestPath),
  readRegularRepoFile(manifestSchemaPath)
]);
const manifest = JSON.parse(manifestRaw.toString('utf8'));
const manifestSchema = JSON.parse(manifestSchemaRaw.toString('utf8'));
const validateManifest = compileSchema(manifestSchema);
assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors, null, 2));

assert.equal(manifest.staged_plan_version, 'real-model-reliability-execution-plan.v1');
assert.equal(manifest.superseded_by, 'real-model-reliability-execution-plan.v2');
assert.equal(manifest.lineage_only, true);
assert.equal(manifest.current_acceptance, false);
assert.equal(manifest.release_acceptance, false);
assert.equal(manifest.historical_schema_readable, true);
assert.equal(manifest.immutable_evidence, true);
assert.equal(manifest.policy.hashes_bind_evidence_bytes, true);
assert.equal(manifest.policy.historical_schema_bytes_bound, true);
assert.equal(manifest.policy.embedded_source_hashes_are_capture_time_only, true);
assert.equal(manifest.policy.historical_source_hashes_compared_to_current_tree, false);
assert.equal(manifest.policy.historical_core_commands_are_not_rerun_as_current_acceptance, true);
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

const [evidenceRaw, evidenceSchemaRaw, planSchemaRaw] = await Promise.all([
  verifyPinnedFile(entry.path, entry.sha256),
  verifyPinnedFile(entry.schema_path, entry.schema_sha256),
  verifyPinnedFile(entry.plan_schema_path, entry.plan_schema_sha256)
]);
const evidence = JSON.parse(evidenceRaw.toString('utf8'));
const evidenceSchema = JSON.parse(evidenceSchemaRaw.toString('utf8'));
const planSchema = JSON.parse(planSchemaRaw.toString('utf8'));
const validateHistoricalEvidence = compileSchema(evidenceSchema);
assert.equal(
  validateHistoricalEvidence(evidence),
  true,
  JSON.stringify(validateHistoricalEvidence.errors, null, 2)
);
compileSchema(planSchema);

assert.equal(evidence.kind, entry.evidence_kind);
assert.equal(evidence.runtime, entry.runtime);
assert.equal(
  readJsonPointer(evidence, entry.staged_plan_version_pointer),
  manifest.staged_plan_version
);
assert.equal(readJsonPointer(evidence, entry.release_acceptance_pointer), false);
assert.equal(evidence.queue_boundary.queue_requests_created, 0);
assert.equal(evidence.authorization_boundary.mutation_authorized, false);
assert.equal(planSchema.properties.version.const, manifest.staged_plan_version);
assert.equal(
  planSchema.properties.revision_contract.properties.strategy.const,
  'definition-merkle.v1'
);

const embeddedSourceBindings = Object.entries(evidence.hashes);
assert.equal(embeddedSourceBindings.length, 11);
for (const [repoPath, digest] of embeddedSourceBindings) {
  assert.equal(isSafeRepoRelativePath(repoPath), true, `unsafe historical source path: ${repoPath}`);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
}

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

const wrongEvidenceDigest = structuredClone(entry);
wrongEvidenceDigest.sha256 = `sha256:${'0'.repeat(64)}`;
await assert.rejects(
  () => verifyPinnedFile(wrongEvidenceDigest.path, wrongEvidenceDigest.sha256),
  /byte hash drift/
);
const wrongSchemaDigest = structuredClone(entry);
wrongSchemaDigest.schema_sha256 = `sha256:${'0'.repeat(64)}`;
await assert.rejects(
  () => verifyPinnedFile(wrongSchemaDigest.schema_path, wrongSchemaDigest.schema_sha256),
  /byte hash drift/
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  staged_plan_version: manifest.staged_plan_version,
  superseded_by: manifest.superseded_by,
  archival_evidence_files: 1,
  evidence_byte_hash_bindings: 1,
  historical_schema_byte_hash_bindings: 2,
  historical_schemas_validated: 2,
  historical_embedded_source_bindings: embeddedSourceBindings.length,
  current_source_hashes_compared: 0,
  lineage_only: true,
  current_acceptance: false,
  release_acceptance: false,
  current_source_hash_policy_preserved: true,
  live_queue_called: false,
  negative_cases: invalidManifests.length + 2
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
