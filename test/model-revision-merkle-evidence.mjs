import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CAPABILITY_MANIFEST_VERSION,
  QUEUE_MODEL_REVISION_STRATEGY,
  RUNTIME_CAPABILITY_VERSION,
  getComponentDefinitionOperationNames,
  getOperationNames,
  getRuntimeCapabilities
} from '../src/capabilities.mjs';
import { MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaRepoPath = 'schema/model-revision-merkle-evidence-v2.schema.json';
const evidenceRepoPath = 'docs/evidence/model-revision-merkle-v2-mock-evidence.json';
const sourceRepoPath = 'sketchup_plugin/alma_sketchup_mcp/model_revision.rb';

const [schema, evidence, modelRevisionSource, packageDocument] = await Promise.all([
  readJson(schemaRepoPath),
  readJson(evidenceRepoPath),
  fs.readFile(path.join(repoRoot, sourceRepoPath)),
  readJson('package.json')
]);

const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2));

const sourceSha256 = sha256(modelRevisionSource);
assert.equal(evidence.contract.strategy, 'definition-merkle.v2');
assert.equal(evidence.contract.capability_version, RUNTIME_CAPABILITY_VERSION);
assert.equal(evidence.contract.manifest_version, CAPABILITY_MANIFEST_VERSION);
assert.equal(evidence.contract.model_revision_source.path, sourceRepoPath);
assert.equal(evidence.contract.model_revision_source.sha256, sourceSha256);
assert.equal(MODEL_REVISION_SOURCE_SHA256, sourceSha256, 'tracked runtime manifest must attest the exact Model Revision source');
assert.equal(evidence.contract.dsl_operation_count, getOperationNames().length);
assert.equal(evidence.contract.component_scope_operation_count, getComponentDefinitionOperationNames().length);

const queueDescriptor = getRuntimeCapabilities('queue');
assert.equal(queueDescriptor.capability_version, '0.1.0-rc.2-capabilities.7');
assert.equal(queueDescriptor.manifest_version, '2026-07-agent-contract-v1.4');
assert.equal(queueDescriptor.model_revision.strategy, QUEUE_MODEL_REVISION_STRATEGY);
assert.equal(queueDescriptor.model_revision_source_sha256, sourceSha256);

assert.match(packageDocument.scripts.test, /node test\/model-revision-v1-archival-lineage\.mjs/,
  'npm test must keep the external v1 archival boundary check');
assert.match(packageDocument.scripts.test, /node test\/model-revision-merkle-evidence\.mjs/,
  'npm test must validate the current v2 evidence');

const ruby = await execFileAsync('ruby', ['test/ruby/model_revision_merkle_test.rb'], {
  cwd: repoRoot,
  maxBuffer: 8 * 1024 * 1024
});
const rubyReport = JSON.parse(ruby.stdout.trim().split(/\r?\n/).at(-1));
assert.equal(rubyReport.ok, true);
assert.equal(rubyReport.tests, evidence.tests.ruby_assertions);
assert.equal(rubyReport.strategy, evidence.contract.strategy);
assert.equal(rubyReport.unique_entity_limit, evidence.contract.unique_entity_limit);
assert.equal(rubyReport.logical_occurrences, evidence.contract.logical_occurrences);
assert.equal(rubyReport.unique_entities, evidence.contract.unique_entities);
assert.equal(rubyReport.shared_definition_expansion_materialized, evidence.contract.shared_occurrence_snapshots_materialized);

assert.equal(rubyReport.process_local_entity_id_ignored, !evidence.normalization.process_local_entity_id_hashed);
assert.equal(rubyReport.custom_reference_entity_id_stable, true);
assert.equal(rubyReport.enumeration_order_independent, evidence.normalization.entity_enumeration_order_independent);
assert.equal(rubyReport.attribute_order_independent, evidence.normalization.attribute_dictionary_and_key_order_independent);
assert.equal(rubyReport.face_loop_order_independent, evidence.normalization.face_loop_start_independent);
assert.equal(rubyReport.face_loop_order_independent, evidence.normalization.face_loop_direction_independent);
assert.equal(rubyReport.face_loop_order_independent, evidence.normalization.face_hole_order_independent);
assert.equal(rubyReport.edge_direction_independent, evidence.normalization.edge_endpoint_direction_independent);

assert.equal(rubyReport.missing_stable_identity_failed_closed, evidence.fail_closed.missing_entity_identity);
assert.equal(rubyReport.duplicate_fallback_identity_failed_closed, evidence.fail_closed.duplicate_entity_identity);
assert.equal(rubyReport.cross_type_duplicate_identity_failed_closed, evidence.fail_closed.cross_type_duplicate_entity_identity);
assert.equal(rubyReport.missing_definition_identity_failed_closed, evidence.fail_closed.missing_definition_identity);
assert.equal(rubyReport.duplicate_definition_identity_failed_closed, evidence.fail_closed.duplicate_definition_identity);
assert.equal(rubyReport.unique_limit_failed_closed, evidence.fail_closed.unique_entity_limit_exceeded);
assert.equal(rubyReport.recursive_cycle_failed_closed, evidence.fail_closed.recursive_definition_cycle);

assert.equal(rubyReport.transform_change_detected, evidence.semantic_change_detection.transform);
assert.equal(rubyReport.material_change_detected, evidence.semantic_change_detection.material);
assert.equal(rubyReport.attribute_change_detected, evidence.semantic_change_detection.attribute_value);
assert.equal(rubyReport.semantic_geometry_change_detected, evidence.semantic_change_detection.geometry);

assert.equal(evidence.safety.queue_requests_sent, 0);
assert.equal(evidence.safety.model_mutation_requested, false);
assert.equal(evidence.live_evidence.current_strategy_live_proven, false);
assert.equal(evidence.live_evidence.loaded_source_attestation_live_proven, false);
assert.equal(evidence.live_evidence.clean_reopen_live_proven, false);
assert.equal(evidence.live_evidence.release_acceptance, false);

let pathHashBindings = 0;
for (const [repoPath, expectedDigest] of Object.entries(evidence.hashes)) {
  const file = await resolveRegularRepoFile(repoPath);
  assert.equal(`sha256:${sha256(await fs.readFile(file))}`, expectedDigest, `${repoPath} current-source hash drift`);
  pathHashBindings += 1;
}

const invalidEvidence = [
  mutate(evidence, (value) => { value.runtime = 'queue'; }),
  mutate(evidence, (value) => { value.contract.strategy = 'definition-merkle.v1'; }),
  mutate(evidence, (value) => { value.contract.model_revision_source.sha256 = '0'.repeat(64); }),
  mutate(evidence, (value) => { value.tests.ruby_assertions = 37; }),
  mutate(evidence, (value) => { value.normalization.process_local_entity_id_hashed = true; }),
  mutate(evidence, (value) => { value.fail_closed.missing_entity_identity = false; }),
  mutate(evidence, (value) => { value.semantic_change_detection.geometry = false; }),
  mutate(evidence, (value) => { value.safety.queue_requests_sent = 1; }),
  mutate(evidence, (value) => { value.live_evidence.release_acceptance = true; })
];
for (const invalid of invalidEvidence) {
  assert.equal(validate(invalid), false, 'unsafe or stale current evidence must fail schema validation');
}

const wrongSourceDigest = structuredClone(evidence);
wrongSourceDigest.hashes[sourceRepoPath] = `sha256:${'0'.repeat(64)}`;
await assert.rejects(() => verifyBoundFileDigest(wrongSourceDigest, sourceRepoPath), /current-source hash drift/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  strategy: evidence.contract.strategy,
  capability_version: evidence.contract.capability_version,
  manifest_version: evidence.contract.manifest_version,
  model_revision_source_sha256: sourceSha256,
  ruby_assertions: rubyReport.tests,
  logical_occurrences: rubyReport.logical_occurrences,
  unique_entities: rubyReport.unique_entities,
  path_hash_bindings: pathHashBindings,
  v1_archival_test_preserved: true,
  current_v2_npm_test_entry: true,
  live_status: evidence.live_evidence.status,
  release_acceptance: false,
  live_queue_called: false,
  mutation_count: 0,
  negative_cases: invalidEvidence.length + 1
}, null, 2)}\n`);

async function readJson(repoPath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, repoPath), 'utf8'));
}

async function verifyBoundFileDigest(document, repoPath) {
  const file = await resolveRegularRepoFile(repoPath);
  const actual = `sha256:${sha256(await fs.readFile(file))}`;
  assert.equal(actual, document.hashes[repoPath], `${repoPath} current-source hash drift`);
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
