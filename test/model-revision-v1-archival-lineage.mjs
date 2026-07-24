import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'docs/evidence/model-revision-v1-archival-lineage-manifest-v1.json';
const manifestSchemaPath = 'schema/model-revision-v1-archival-lineage-manifest-v1.schema.json';
const expectedEntries = new Map([
  ['docs/evidence/model-revision-merkle-v1-mock-evidence.json', {
    sha256: 'sha256:188a562af03c11e6ee682b45e11573ebc4e4d9ab85ceafd570bfcc614cc39eda',
    schema_path: 'schema/model-revision-merkle-evidence-v1.schema.json',
    evidence_kind: 'model_revision_merkle_mock_evidence',
    runtime: 'mock',
    capability_version: '0.1.0-rc.2-capabilities.6',
    manifest_version: '2026-07-agent-contract-v1.3',
    strategy_pointer: '/contract/strategy',
    release_acceptance_pointer: '/live_evidence/release_acceptance'
  }],
  ['docs/evidence/real-model-candidate-live-evidence-2026-07-20.json', {
    sha256: 'sha256:8b814d5a1f23c70adde54835c98098e9644fffae94893f1d05e2b27b3abe3b50',
    schema_path: 'schema/real-model-candidate-live-evidence-v1.schema.json',
    evidence_kind: 'real_model_candidate_live_readonly_evidence',
    runtime: 'queue',
    capability_version: '0.1.0-rc.2-capabilities.5',
    manifest_version: '2026-07-agent-contract-v1.3',
    strategy_pointer: '/runtime/model_revision_strategy',
    release_acceptance_pointer: '/release_acceptance'
  }],
  ['docs/evidence/real-model-recursive-live-readonly-evidence-2026-07-20-capability6.json', {
    sha256: 'sha256:0f834f17ed128db864a0e07792f002abcb268c8ed37edbb26a05bf7ee08963b4',
    schema_path: 'schema/real-model-recursive-live-readonly-evidence-v1.schema.json',
    evidence_kind: 'real_model_recursive_live_readonly_evidence',
    runtime: 'queue',
    capability_version: '0.1.0-rc.2-capabilities.6',
    manifest_version: '2026-07-agent-contract-v1.3',
    strategy_pointer: '/revision_attestation/strategy',
    release_acceptance_pointer: '/release_acceptance'
  }],
  ['docs/evidence/real-model-target-review-live-evidence-2026-07-20.json', {
    sha256: 'sha256:ba0d92baa78b4857a5c6d7eb1aa403db992c517442cc5a1a241593b2a7a619e1',
    schema_path: 'schema/real-model-target-review-v1.schema.json',
    evidence_kind: 'real_model_target_review',
    runtime: 'queue',
    capability_version: '0.1.0-rc.2-capabilities.5',
    manifest_version: '2026-07-agent-contract-v1.3',
    strategy_pointer: '/sketchup/model_revision_strategy',
    release_acceptance_pointer: '/next_action/release_acceptance'
  }]
]);

const [manifestRaw, manifestSchemaRaw] = await Promise.all([
  fs.readFile(path.join(repoRoot, manifestPath), 'utf8'),
  fs.readFile(path.join(repoRoot, manifestSchemaPath), 'utf8')
]);
const manifest = JSON.parse(manifestRaw);
const manifestSchema = JSON.parse(manifestSchemaRaw);
const validateManifest = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(manifestSchema);
assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors, null, 2));

assert.equal(manifest.lineage_only, true);
assert.equal(manifest.current_acceptance, false);
assert.equal(manifest.release_acceptance, false);
assert.equal(manifest.revision_strategy, 'definition-merkle.v1');
assert.equal(manifest.superseded_by, 'definition-merkle.v2');
assert.equal(manifest.policy.embedded_source_hashes_are_capture_time_only, true);
assert.equal(manifest.policy.historical_evidence_may_authorize_current_execution, false);
assert.equal(manifest.policy.historical_evidence_may_satisfy_current_acceptance, false);
assert.equal(manifest.policy.current_evidence_source_hash_validation_preserved, true);

const expectedPaths = [...expectedEntries.keys()].sort();
assert.deepEqual(manifest.entries.map((entry) => entry.path).sort(), expectedPaths);
assert.deepEqual(Object.keys(manifest.evidence_sha256).sort(), expectedPaths);
assert.equal(new Set(manifest.entries.map((entry) => entry.path)).size, expectedPaths.length);

let schemaValidations = 0;
let byteHashBindings = 0;
for (const entry of manifest.entries) {
  const expected = expectedEntries.get(entry.path);
  assert.ok(expected, `unexpected archival evidence path: ${entry.path}`);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(entry[key], value, `${entry.path} ${key} drift`);
  }
  assert.equal(entry.lineage_only, true);
  assert.equal(entry.current_acceptance, false);
  assert.equal(entry.release_acceptance, false);
  assert.equal(manifest.evidence_sha256[entry.path], entry.sha256);

  const evidenceFile = await resolveRegularRepoFile(entry.path);
  const evidenceRaw = await fs.readFile(evidenceFile);
  assert.equal(`sha256:${sha256(evidenceRaw)}`, entry.sha256, `${entry.path} byte hash drift`);
  byteHashBindings += 1;

  const schemaFile = await resolveRegularRepoFile(entry.schema_path);
  const evidence = JSON.parse(evidenceRaw.toString('utf8'));
  const historicalSchema = JSON.parse(await fs.readFile(schemaFile, 'utf8'));
  const validateHistoricalEvidence = new Ajv2020({
    strict: false,
    allErrors: true,
    validateFormats: false
  }).compile(historicalSchema);
  assert.equal(
    validateHistoricalEvidence(evidence),
    true,
    `${entry.path} no longer validates against ${entry.schema_path}: ${JSON.stringify(validateHistoricalEvidence.errors)}`
  );
  schemaValidations += 1;

  assert.equal(readJsonPointer(evidence, entry.strategy_pointer), 'definition-merkle.v1');
  assert.equal(readJsonPointer(evidence, entry.release_acceptance_pointer), false);
  assert.equal(evidence.kind, entry.evidence_kind);
}

const invalidManifests = [
  mutate(manifest, (value) => { value.lineage_only = false; }),
  mutate(manifest, (value) => { value.current_acceptance = true; }),
  mutate(manifest, (value) => { value.release_acceptance = true; }),
  mutate(manifest, (value) => { value.entries[0].release_acceptance = true; }),
  mutate(manifest, (value) => { value.entries[0].path = '../escaped-evidence.json'; })
];
for (const invalid of invalidManifests) {
  assert.equal(validateManifest(invalid), false, 'unsafe archival boundary must fail schema validation');
}

const wrongDigestEntry = structuredClone(manifest.entries[0]);
wrongDigestEntry.sha256 = `sha256:${'0'.repeat(64)}`;
await assert.rejects(() => verifyEvidenceDigest(wrongDigestEntry), /byte hash drift/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  revision_strategy: manifest.revision_strategy,
  superseded_by: manifest.superseded_by,
  archival_evidence_files: manifest.entries.length,
  byte_hash_bindings: byteHashBindings,
  historical_schemas_validated: schemaValidations,
  lineage_only: true,
  current_acceptance: false,
  release_acceptance: false,
  current_source_hash_policy_preserved: true,
  live_queue_called: false,
  negative_cases: invalidManifests.length + 1
}, null, 2)}\n`);

async function verifyEvidenceDigest(entry) {
  const evidenceFile = await resolveRegularRepoFile(entry.path);
  const actual = `sha256:${sha256(await fs.readFile(evidenceFile))}`;
  assert.equal(actual, entry.sha256, `${entry.path} byte hash drift`);
}

async function resolveRegularRepoFile(repoPath) {
  const candidate = path.resolve(repoRoot, repoPath);
  const relative = path.relative(repoRoot, candidate);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `path escapes repository: ${repoPath}`);
  const [realRoot, realCandidate] = await Promise.all([fs.realpath(repoRoot), fs.realpath(candidate)]);
  const realRelative = path.relative(realRoot, realCandidate);
  assert.ok(realRelative && !realRelative.startsWith('..') && !path.isAbsolute(realRelative), `symlink escapes repository: ${repoPath}`);
  assert.equal((await fs.stat(realCandidate)).isFile(), true, `not a regular file: ${repoPath}`);
  return realCandidate;
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
