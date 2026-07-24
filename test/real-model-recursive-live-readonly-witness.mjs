import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrapperPath = 'docs/evidence/real-model-recursive-live-readonly-evidence-2026-07-20-capability6.json';
const wrapperSchemaPath = 'schema/real-model-recursive-live-readonly-evidence-v1.schema.json';
const witnessPath = 'test/fixtures/real-model-recursive-live-readonly-witness.v1.json';
const [wrapperRaw, wrapperSchemaRaw, witnessRaw] = await Promise.all([
  fs.readFile(path.join(repoRoot, wrapperPath), 'utf8'),
  fs.readFile(path.join(repoRoot, wrapperSchemaPath), 'utf8'),
  fs.readFile(path.join(repoRoot, witnessPath), 'utf8')
]);
const wrapper = JSON.parse(wrapperRaw);
const wrapperSchema = JSON.parse(wrapperSchemaRaw);
const witness = JSON.parse(witnessRaw);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
let assertions = 0;

const validateWrapper = ajv.compile(wrapperSchema);
assert.equal(validateWrapper(wrapper), true, JSON.stringify(validateWrapper.errors, null, 2)); assertions += 1;
assertWitnessShape(witness); assertions += 1;

for (const [label, value] of [
  ['wrapper', wrapper],
  ['wrapper schema', wrapperSchema]
]) {
  assertNoExactSensitiveKeys(value, label); assertions += 1;
  assertNoAbsoluteLocalPath(value, label); assertions += 1;
}
assertNoSensitiveKeyFragments(witness, 'portable witness'); assertions += 1;
assertNoAbsoluteLocalPath(witness, 'portable witness'); assertions += 1;

assert.equal(witness.hash_bindings.wrapper, sha256Text(wrapperRaw)); assertions += 1;
assert.equal(witness.hash_bindings.wrapper_schema, sha256Text(wrapperSchemaRaw)); assertions += 1;
assert.equal(witness.capability_version, wrapper.runtime.capability_version); assertions += 1;
assert.equal(witness.structural_groups_version, wrapper.runtime.structural_groups_version); assertions += 1;
assert.equal(witness.contract.total_groups, wrapper.structural_probe.total_seen); assertions += 1;
assert.equal(witness.contract.fresh_manifold_matched, wrapper.structural_probe.terminal_fresh_matched); assertions += 1;
assert.equal(witness.contract.manifold, wrapper.structural_probe.terminal_manifold); assertions += 1;
assert.equal(witness.contract.non_manifold, wrapper.structural_probe.terminal_non_manifold); assertions += 1;
assert.equal(witness.contract.terminal_blocker, wrapper.terminal_review.blockers[0]); assertions += 1;
assert.equal(witness.contract.next_action, wrapper.terminal_review.next_action); assertions += 1;
assert.equal(witness.read_only, wrapper.structural_probe.read_only); assertions += 1;
assert.equal(witness.mutation_authorized, wrapper.authorization_boundary.mutation_authorized); assertions += 1;
assert.equal(witness.release_acceptance, wrapper.release_acceptance); assertions += 1;

const expectedArtifactHashes = {
  inventory: wrapper.artifact_bindings.inventory.sha256,
  semantic_mapping: wrapper.artifact_bindings.semantic_mapping.sha256,
  semantic_mapping_amendment: wrapper.artifact_bindings.semantic_mapping_amendment.sha256,
  session_contract_capture: wrapper.artifact_bindings.session_contract.sha256,
  structural_phase1_capture: wrapper.artifact_bindings.structural_phase1.sha256,
  structural_terminal_capture: wrapper.artifact_bindings.structural_terminal_probe.sha256,
  recursive_terminal_review_capture: wrapper.artifact_bindings.recursive_terminal_review.sha256
};
for (const [name, expected] of Object.entries(expectedArtifactHashes)) {
  assert.equal(witness.hash_bindings[name], expected, `${name} witness hash drift`); assertions += 1;
}

const negativeWitnesses = [
  mutate(witness, (value) => { value.contract.total_groups = 40; }),
  mutate(witness, (value) => { value.contract.fresh_manifold_matched = 14; }),
  mutate(witness, (value) => { value.contract.manifold = 2; value.contract.non_manifold = 13; }),
  mutate(witness, (value) => { value.contract.terminal_blocker = 'fresh_manifold_attestation_required'; }),
  mutate(witness, (value) => { value.contract.next_action = 'retry_live_queue'; }),
  mutate(witness, (value) => { value.hash_bindings.wrapper = `sha256:${'0'.repeat(64)}`; }),
  mutate(witness, (value) => { value.session_id = 'must-not-be-portable'; }),
  mutate(witness, (value) => { value.contract.signature = 'must-not-be-portable'; }),
  mutate(witness, (value) => { value.contract.token = 'must-not-be-portable'; }),
  mutate(witness, (value) => { value.contract.secret = 'must-not-be-portable'; }),
  mutate(witness, (value) => { value.capture_path = '/Users/example/raw.json'; })
];
for (const invalid of negativeWitnesses) {
  assert.throws(() => assertPortableWitness(invalid, wrapper, wrapperRaw, wrapperSchemaRaw)); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: 'portable_witness',
  capability_version: witness.capability_version,
  structural_groups: witness.contract.total_groups,
  fresh_matched: witness.contract.fresh_manifold_matched,
  manifold: witness.contract.manifold,
  non_manifold: witness.contract.non_manifold,
  terminal_blocker: witness.contract.terminal_blocker,
  next_action: witness.contract.next_action,
  hash_bindings_checked: Object.keys(witness.hash_bindings).length,
  raw_capture_files_read: false,
  sensitive_keys_embedded: false,
  release_acceptance: false,
  negative_cases: negativeWitnesses.length,
  assertions
}, null, 2)}\n`);

function assertPortableWitness(value, sourceWrapper, sourceWrapperRaw, sourceSchemaRaw) {
  assertNoSensitiveKeyFragments(value, 'portable witness');
  assertNoAbsoluteLocalPath(value, 'portable witness');
  assertWitnessShape(value);
  assert.equal(value.hash_bindings.wrapper, sha256Text(sourceWrapperRaw));
  assert.equal(value.hash_bindings.wrapper_schema, sha256Text(sourceSchemaRaw));
  assert.equal(value.contract.total_groups, sourceWrapper.structural_probe.total_seen);
  assert.equal(value.contract.fresh_manifold_matched, sourceWrapper.structural_probe.terminal_fresh_matched);
  assert.equal(value.contract.manifold, sourceWrapper.structural_probe.terminal_manifold);
  assert.equal(value.contract.non_manifold, sourceWrapper.structural_probe.terminal_non_manifold);
  assert.equal(value.contract.terminal_blocker, sourceWrapper.terminal_review.blockers[0]);
  assert.equal(value.contract.next_action, sourceWrapper.terminal_review.next_action);
}

function assertWitnessShape(value) {
  assert.deepEqual(Object.keys(value).sort(), [
    'capability_version',
    'contract',
    'hash_bindings',
    'mutation_authorized',
    'read_only',
    'release_acceptance',
    'structural_groups_version',
    'version'
  ]);
  assert.equal(value.version, 'real-model-recursive-live-readonly-witness.v1');
  assert.equal(value.capability_version, '0.1.0-rc.2-capabilities.6');
  assert.equal(value.structural_groups_version, 'structural-groups.v1');
  assert.deepEqual(Object.keys(value.contract).sort(), [
    'fresh_manifold_matched',
    'manifold',
    'next_action',
    'non_manifold',
    'terminal_blocker',
    'total_groups'
  ]);
  assert.equal(value.contract.total_groups, 41);
  assert.equal(value.contract.fresh_manifold_matched, 15);
  assert.equal(value.contract.manifold, 1);
  assert.equal(value.contract.non_manifold, 14);
  assert.equal(value.contract.terminal_blocker, 'no_manifold_qualified_pair');
  assert.equal(value.contract.next_action, 'select_manifold_qualified_disposable_model_case');
  assert.equal(value.read_only, true);
  assert.equal(value.mutation_authorized, false);
  assert.equal(value.release_acceptance, false);
  assert.deepEqual(Object.keys(value.hash_bindings).sort(), [
    'inventory',
    'recursive_terminal_review_capture',
    'semantic_mapping',
    'semantic_mapping_amendment',
    'session_contract_capture',
    'structural_phase1_capture',
    'structural_terminal_capture',
    'wrapper',
    'wrapper_schema'
  ]);
  for (const digest of Object.values(value.hash_bindings)) {
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  }
}

function assertNoExactSensitiveKeys(value, label) {
  walk(value, (key) => {
    assert.doesNotMatch(key, /^(?:signature|session[_-]?id|token|secret)$/i, `${label} contains sensitive key ${key}`);
  });
}

function assertNoSensitiveKeyFragments(value, label) {
  walk(value, (key) => {
    assert.doesNotMatch(key, /(?:signature|session[_-]?id|token|secret)/i, `${label} contains sensitive key ${key}`);
  });
}

function assertNoAbsoluteLocalPath(value, label) {
  walk(value, (_key, child) => {
    if (typeof child !== 'string') return;
    assert.equal(
      child.startsWith('/') || /^[A-Za-z]:[\\/]/.test(child) || child.startsWith('file://') || child.startsWith('~/'),
      false,
      `${label} contains an absolute local path`
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

function sha256Text(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
