import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/fresh-process-multi-model-visual-evidence-2026-07-23.json';
const [evidence, evidenceSchema, comparisonSchema] = await Promise.all([
  readJson(evidencePath),
  readJson('schema/fresh-process-multi-model-visual-evidence-v1.schema.json'),
  readJson('schema/background-normalized-visual-comparison-v1.schema.json')
]);
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateComparison = ajv.compile(comparisonSchema);
assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2));

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after live evidence generation`);
}
for (const [relativePath, expected] of Object.entries(evidence.artifact_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after live evidence generation`);
}

assert.deepEqual(evidence.cases.map((entry) => entry.case_id).sort(), ['architecture', 'product']);
assert.equal(new Set(evidence.cases.map((entry) => entry.model_revision)).size, 2);
assert.equal(new Set(evidence.cases.map((entry) => entry.fixture_handle)).size, 2);
for (const entry of evidence.cases) {
  assert.equal(entry.case_id, entry.domain);
  assert.equal(entry.source_fixture_unchanged, true);
  assert.equal(entry.working_copy_unchanged, true);
  assert.equal(entry.recursive_complete, true);
  assert.equal(entry.before_capture.logical_occurrences, entry.before_capture.indexed_occurrences);
  assert.equal(entry.after_capture.logical_occurrences, entry.after_capture.indexed_occurrences);
  assert.equal(entry.before_capture.model_revision, entry.after_capture.model_revision);
  assert.equal(entry.before_capture.model_revision, entry.model_revision);
  assert.equal(entry.before_capture.camera_hash, entry.after_capture.camera_hash);
  assert.equal(entry.before_capture.capture_spec_hash, entry.after_capture.capture_spec_hash);
  assert.equal(entry.full_restart.plugin_session_changed, true);
  assert.equal(entry.full_restart.raw_session_values_omitted, true);
  assert.equal(entry.before_capture.state_unchanged, true);
  assert.equal(entry.after_capture.state_unchanged, true);
  assert.equal(entry.before_capture.view_unchanged, true);
  assert.equal(entry.after_capture.view_unchanged, true);
  assert.equal(entry.before_capture.model_modified, false);
  assert.equal(entry.after_capture.model_modified, false);
  assert.deepEqual(entry.queue_before, cleanQueue());
  assert.deepEqual(entry.queue_after, cleanQueue());

  for (const capture of [entry.before_capture, entry.after_capture]) {
    assert.equal(capture.image.sha256, `sha256:${await sha256File(capture.image.path)}`);
    const metadata = await sharp(path.join(root, capture.image.path)).metadata();
    assert.equal(metadata.format, 'png');
    assert.deepEqual([metadata.width, metadata.height], [1280, 720]);
  }
  const comparison = await readJson(entry.comparison.path);
  assert.equal(validateComparison(comparison), true, JSON.stringify(validateComparison.errors, null, 2));
  assert.equal(await sha256File(entry.comparison.path), entry.comparison.sha256);
  const { comparison_id: comparisonId, comparison_hash: comparisonHash, ...comparisonCore } = comparison;
  assert.equal(sha256Canonical(comparisonCore), comparisonHash);
  assert.equal(comparisonId, `background-visual-${comparisonHash.slice(7, 31)}`);
  assert.equal(comparison.structure.verdict, 'coarse_structure_pass');
  assert.equal(comparison.visual_similarity_accepted, false);
  assert.equal(comparison.execution_allowed, false);
  assert.equal(comparison.review_required, true);
  assert.equal(entry.comparison.structure_verdict, comparison.structure.verdict);
  assert.equal(entry.comparison.intersection_over_union, comparison.structure.intersection_over_union);
  assert.equal(entry.comparison.dice_coefficient, comparison.structure.dice_coefficient);
  assert.ok(entry.comparison.intersection_over_union >= comparison.structure.thresholds.iou_pass_min);
  assert.ok(entry.comparison.dice_coefficient >= comparison.structure.thresholds.dice_pass_min);
}

assert.deepEqual(evidence.aggregate, {
  case_count: 2,
  distinct_model_keys: 2,
  distinct_model_revisions: 2,
  full_restart_cases: 2,
  camera_hash_exact_cases: 2,
  coarse_structure_pass_cases: 2,
  model_bytes_changed_cases: 0,
  model_modified_cases: 0,
  queue_residue_cases: 0
});
assert.deepEqual(evidence.agent_compatibility, {
  visual_agent_required: false,
  local_files_required: false,
  structured_summary_available: true
});
assert.deepEqual(evidence.policy_invariants, {
  read_only_capture_only: true,
  model_mutation_performed: false,
  model_save_performed: false,
  approval_challenge_created: false,
  approval_token_exposed_to_agent: false,
  image_content_policy_effect: 'none',
  visual_similarity_accepted: false
});
assert.equal(evidence.release_acceptance, false);

const runnerSource = await fs.readFile(
  path.join(root, 'scripts/run-fresh-process-multi-model-visual-live.mjs'),
  'utf8'
);
assert.match(runnerSource, /explicit --runtime queue --queue-required/);
assert.match(runnerSource, /does not reset, edit, save, or approve/);
assert.match(runnerSource, /session_fingerprint/);

for (const mutate of [
  (value) => { value.result = 'fail'; },
  (value) => { value.aggregate.case_count = 1; },
  (value) => { value.aggregate.distinct_model_keys = 1; },
  (value) => { value.aggregate.full_restart_cases = 1; },
  (value) => { value.aggregate.model_bytes_changed_cases = 1; },
  (value) => { value.aggregate.queue_residue_cases = 1; },
  (value) => { value.cases[0].full_restart.camera_hash_exact = false; },
  (value) => { value.cases[0].comparison.structure_verdict = 'review'; },
  (value) => { value.policy_invariants.model_mutation_performed = true; },
  (value) => { value.policy_invariants.model_save_performed = true; },
  (value) => { value.policy_invariants.visual_similarity_accepted = true; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(evidence);
  mutate(invalid);
  assert.equal(validateEvidence(invalid), false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  cases: evidence.aggregate.case_count,
  distinct_model_keys: evidence.aggregate.distinct_model_keys,
  full_restart_cases: evidence.aggregate.full_restart_cases,
  camera_hash_exact_cases: evidence.aggregate.camera_hash_exact_cases,
  coarse_structure_pass_cases: evidence.aggregate.coarse_structure_pass_cases,
  model_bytes_changed_cases: 0,
  queue_residue_cases: 0,
  source_hashes_verified: Object.keys(evidence.source_sha256).length,
  artifact_hashes_verified: Object.keys(evidence.artifact_sha256).length,
  schema_negative_cases: 12,
  visual_similarity_accepted: false,
  release_acceptance: false
}, null, 2)}\n`);

function cleanQueue() {
  return { queue: 0, processing: 0, responses: 0, lock_exists: false };
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(root, relativePath))).digest('hex');
}

function sha256Canonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
