import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [evidenceRaw, schemaRaw] = await Promise.all([
  fs.readFile(path.join(repoRoot, 'docs/evidence/current-source-live-readonly-evidence-2026-07-21.json'), 'utf8'),
  fs.readFile(path.join(repoRoot, 'schema/current-source-live-readonly-evidence-v1.schema.json'), 'utf8')
]);
const evidence = JSON.parse(evidenceRaw);
const schema = JSON.parse(schemaRaw);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;

const attestation = evidence.read_only_attestation;
assert.equal(attestation.handshake_before_revision, attestation.adoption_revision); assertions += 1;
assert.equal(attestation.adoption_revision, attestation.handshake_after_revision); assertions += 1;
assert.equal(attestation.revision_unchanged, true); assertions += 1;
assert.deepEqual([
  attestation.model_modified_before,
  attestation.model_modified_during_adoption,
  attestation.model_modified_after
], [false, false, false]); assertions += 1;
assert.equal(evidence.model.revision_indexed, evidence.model.revision_total_seen); assertions += 1;
assert.equal(evidence.model.revision_indexed, evidence.model.logical_occurrence_count); assertions += 1;
assert.equal(
  evidence.installed_source.loaded_boolean_operations_sha256,
  evidence.installed_source.workspace_boolean_operations_sha256_at_capture
); assertions += 1;
assert.equal(
  evidence.installed_source.loaded_model_revision_sha256,
  evidence.installed_source.workspace_model_revision_sha256_at_capture
); assertions += 1;
assert.equal(evidence.model.source_bytes_sha256, evidence.model.disposable_bytes_sha256); assertions += 1;
assert.deepEqual(evidence.queue_state.before, evidence.queue_state.after); assertions += 1;
assert.equal(evidence.acceptance.current_source_live_handshake, true); assertions += 1;
assert.equal(evidence.acceptance.current_source_live_read_only_model, true); assertions += 1;
assert.equal(evidence.acceptance.live_mutation, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.read_only_attestation.revision_unchanged = false; }),
  mutate(evidence, (value) => { value.read_only_attestation.model_modified_after = true; }),
  mutate(evidence, (value) => { value.read_only_attestation.model_mutation_performed = true; }),
  mutate(evidence, (value) => { value.queue_state.after.queue = 1; }),
  mutate(evidence, (value) => { value.acceptance.live_mutation = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; }),
  mutate(evidence, (value) => { value.installed_source.requires_reinstall_restart = true; }),
  mutate(evidence, (value) => { value.model.source_path_disclosed = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false, 'unsafe live-evidence mutation must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  capability_version: evidence.runtime.capability_version,
  manifest_version: evidence.runtime.manifest_version,
  revision_strategy: attestation.revision_strategy,
  revision_indexed: evidence.model.revision_indexed,
  revision_unchanged: true,
  model_modified: false,
  installed_source_exact_match: true,
  signed_handshake_verified_at_capture: true,
  queue_clean: true,
  live_mutation: false,
  release_acceptance: false,
  negative_cases: negativeCases.length,
  assertions
}, null, 2)}\n`);

function assertNoSensitiveKeys(value) {
  walk(value, (key) => {
    assert.doesNotMatch(
      key,
      /^(?:signature|session[_-]?id|document[_-]?id|model[_-]?guid|runtime[_-]?object[_-]?id|source[_-]?path|token|secret)$/i,
      `public evidence contains sensitive key ${key}`
    );
  });
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

function walk(value, callback) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    callback(key, child);
    walk(child, callback);
  }
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
