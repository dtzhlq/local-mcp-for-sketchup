import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertNoSensitivePublicEvidence } from '../scripts/run-current-source-agent-readonly-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [evidence, schema] = await Promise.all([
  readJson('docs/evidence/current-source-agent-target-quality-live-evidence-2026-07-21.json'),
  readJson('schema/current-source-agent-target-quality-live-evidence-v1.schema.json')
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.doesNotThrow(() => assertNoSensitivePublicEvidence(evidence)); assertions += 1;
assert.equal(evidence.model.revision_indexed, evidence.model.revision_total_seen); assertions += 1;
assert.equal(evidence.model.bytes_unchanged_across_cases, true); assertions += 1;
assert.equal(evidence.model.revision_unchanged_across_cases, true); assertions += 1;

assert.equal(evidence.source_binding_status, 'historical_exact_source_snapshot'); assertions += 1;
assert.equal(evidence.superseded_by, 'docs/evidence/current-source-agent-bounded-group-live-evidence-2026-07-21.json'); assertions += 1;
for (const binding of evidence.source_bindings) {
  const currentDigest = await sha256File(binding.path);
  if (binding.path === 'src/existing-model-edit-proposer.mjs') {
    assert.notEqual(currentDigest, binding.sha256.slice('sha256:'.length), 'superseded live evidence must retain its exact capture-time source digest'); assertions += 1;
  } else {
    assert.equal(currentDigest, binding.sha256.slice('sha256:'.length)); assertions += 1;
  }
}

const positive = evidence.cases[0];
assert.equal(positive.task_state, 'awaiting_review'); assertions += 1;
assert.equal(positive.selected_target_count, 1); assertions += 1;
assert.equal(positive.operation_count, 1); assertions += 1;
assert.equal(positive.execution_allowed, false); assertions += 1;
assert.deepEqual(positive.evidence_kinds, ['trusted_topology_match', 'deterministic_structural_ranking']); assertions += 1;

const abstention = evidence.cases[1];
assert.equal(abstention.task_state, 'awaiting_input'); assertions += 1;
assert.equal(abstention.equal_bbox, true); assertions += 1;
assert.equal(abstention.selected_target_count, 0); assertions += 1;
assert.equal(abstention.operation_count, 0); assertions += 1;
assert.ok(abstention.ambiguity_reasons.includes('multiple_similar_targets')); assertions += 1;

assert.equal(evidence.safety.mutation_requested, false); assertions += 1;
assert.equal(evidence.safety.mutation_performed, false); assertions += 1;
assert.equal(evidence.safety.final_queue + evidence.safety.final_processing + evidence.safety.final_responses, 0); assertions += 1;
assert.equal(evidence.safety.final_lock_exists, false); assertions += 1;
assert.equal(evidence.acceptance.wrong_object_automatic_execution, 0); assertions += 1;
assert.equal(evidence.acceptance.unauthorized_s2_s4_execution, 0); assertions += 1;
assert.equal(evidence.acceptance.duplicate_request_duplicate_modification, 0); assertions += 1;
assert.equal(evidence.acceptance.multi_model_target_quality, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const localArtifacts = [
  ['output/live-validation/agent-gateway-readonly/fire-escape-structural-target-positive-2026-07-21/report.json', evidence.capture_artifact_hashes.positive_public_report],
  ['output/live-validation/agent-gateway-readonly/fire-escape-structural-target-positive-2026-07-21/private/proposal-projection.json', evidence.capture_artifact_hashes.positive_private_projection],
  ['output/live-validation/agent-gateway-readonly/fire-escape-equal-bbox-abstain-2026-07-21/report.json', evidence.capture_artifact_hashes.abstention_public_report],
  ['output/live-validation/agent-gateway-readonly/fire-escape-equal-bbox-abstain-2026-07-21/private/proposal-projection.json', evidence.capture_artifact_hashes.abstention_private_projection]
];
let localCaptureArtifactsVerified = 0;
for (const [relativePath, expected] of localArtifacts) {
  try {
    assert.equal(await sha256File(relativePath), expected.slice('sha256:'.length)); assertions += 1;
    localCaptureArtifactsVerified += 1;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
assert.ok([0, localArtifacts.length].includes(localCaptureArtifactsVerified), 'local capture verification must be all-or-none'); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.cases[0].selected_target_count = 0; }),
  mutate(evidence, (value) => { value.cases[0].execution_allowed = true; }),
  mutate(evidence, (value) => { value.cases[1].selected_target_count = 1; }),
  mutate(evidence, (value) => { value.cases[1].operation_count = 1; }),
  mutate(evidence, (value) => { value.cases[1].equal_bbox = false; }),
  mutate(evidence, (value) => { value.safety.mutation_performed = true; }),
  mutate(evidence, (value) => { value.safety.final_responses = 1; }),
  mutate(evidence, (value) => { value.acceptance.multi_model_target_quality = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; }),
  mutate(evidence, (value) => { value.source_bindings[0].sha256 = `sha256:${'0'.repeat(64)}`; })
];
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false, 'unsafe, stale, or overclaimed target-quality evidence must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  cases: evidence.cases.length,
  positive_target_selected_for_review_only: true,
  equal_bbox_abstention: true,
  wrong_object_automatic_execution: 0,
  mutation_performed: false,
  local_capture_artifacts_verified: localCaptureArtifactsVerified,
  negative_cases: negativeCases.length,
  assertions
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, relativePath))).digest('hex');
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
