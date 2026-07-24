import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertNoSensitivePublicEvidence } from '../scripts/run-current-source-agent-readonly-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/current-source-multi-model-target-quality-live-evidence-2026-07-22.json';
const [evidence, schema] = await Promise.all([
  readJson(evidencePath),
  readJson('schema/current-source-multi-model-target-quality-live-evidence-v1.schema.json')
]);
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.doesNotThrow(() => assertNoSensitivePublicEvidence(evidence)); assertions += 1;
assert.deepEqual(evidence.domains, ['architecture', 'deep_shared', 'interior', 'product']); assertions += 1;
assert.equal(evidence.cases.length, 4); assertions += 1;
assert.equal(new Set(evidence.cases.map((entry) => entry.fixture_handle)).size, 4); assertions += 1;
assert.equal(new Set(evidence.cases.map((entry) => entry.model_revision)).size, 4); assertions += 1;
for (const entry of evidence.cases) {
  assert.equal(entry.revision_indexed, entry.revision_total_seen); assertions += 1;
  assert.equal(entry.mutation_performed, false); assertions += 1;
  assert.equal(entry.source_path_disclosed, false); assertions += 1;
  assert.equal(entry.expected_behavior, entry.observed_behavior); assertions += 1;
}

assert.equal(evidence.metrics.unique_selection_attempts, 3); assertions += 1;
assert.equal(evidence.metrics.correct_unique_selections, 3); assertions += 1;
assert.equal(evidence.metrics.target_top_5_attempts, 3); assertions += 1;
assert.equal(evidence.metrics.target_top_5_hits, 3); assertions += 1;
assert.equal(evidence.metrics.ambiguity_or_safety_abstention_attempts, 1); assertions += 1;
assert.equal(evidence.metrics.ambiguity_or_safety_abstentions, 1); assertions += 1;
assert.equal(evidence.metrics.schema_errors, 0); assertions += 1;
assert.equal(evidence.safety.all_queue_boundaries_idle, true); assertions += 1;
assert.equal(evidence.safety.mutation_performed, false); assertions += 1;
assert.equal(evidence.hard_gates.wrong_object_automatic_execution, 0); assertions += 1;
assert.equal(evidence.hard_gates.unauthorized_s2_s4_execution, 0); assertions += 1;
assert.equal(evidence.hard_gates.duplicate_request_duplicate_modification, 0); assertions += 1;
assert.equal(evidence.hard_gates.ambiguous_target_automatic_selection, 0); assertions += 1;
assert.equal(evidence.acceptance.semantic_intent_benchmark, false); assertions += 1;
assert.equal(evidence.acceptance.live_mutation, false); assertions += 1;
assert.equal(evidence.acceptance.cross_version, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

for (const binding of evidence.source_bindings) {
  assert.equal(await sha256File(binding.path), binding.sha256.slice('sha256:'.length), binding.path); assertions += 1;
}

const reportPaths = new Map([
  ['architecture', 'output/live-validation/model-target-quality/fire-escape-architecture-target-quality-current-source-2026-07-22/report.json'],
  ['deep_shared', 'output/live-validation/model-target-quality/portal-deep-shared-target-quality-current-source-2026-07-22/report.json'],
  ['interior', 'output/live-validation/model-target-quality/chinese-interior-target-quality-current-source-2026-07-22/report.json'],
  ['product', 'output/live-validation/model-target-quality/trimble-s6-product-target-quality-current-source-final-2026-07-22/report.json']
]);
let localReportsVerified = 0;
for (const entry of evidence.cases) {
  try {
    assert.equal(await sha256File(reportPaths.get(entry.domain)), entry.report_sha256.slice('sha256:'.length)); assertions += 1;
    localReportsVerified += 1;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
assert.ok([0, evidence.cases.length].includes(localReportsVerified), 'local live reports must verify all-or-none'); assertions += 1;

let localAggregateVerified = false;
try {
  assert.equal(
    await sha256File('output/live-validation/model-target-quality/four-domain-current-source-evidence-2026-07-22.json'),
    await sha256File(evidencePath)
  ); assertions += 1;
  localAggregateVerified = true;
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const negativeSchemaCases = [
  mutate(evidence, (value) => { value.domains.reverse(); }),
  mutate(evidence, (value) => { value.metrics.models = 3; }),
  mutate(evidence, (value) => { value.metrics.unique_selection_attempts = 0; }),
  mutate(evidence, (value) => { value.cases[0].mutation_performed = true; }),
  mutate(evidence, (value) => { value.safety.mutation_performed = true; }),
  mutate(evidence, (value) => { value.hard_gates.wrong_object_automatic_execution = 1; }),
  mutate(evidence, (value) => { value.acceptance.semantic_intent_benchmark = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeSchemaCases) {
  assert.equal(validate(invalid), false); assertions += 1;
}

const duplicateRevision = mutate(evidence, (value) => {
  value.cases[1].model_revision = value.cases[0].model_revision;
});
assert.notEqual(new Set(duplicateRevision.cases.map((entry) => entry.model_revision)).size, 4); assertions += 1;
const tamperedBinding = mutate(evidence, (value) => {
  value.source_bindings[0].sha256 = `sha256:${'0'.repeat(64)}`;
});
assert.notEqual(
  await sha256File(tamperedBinding.source_bindings[0].path),
  tamperedBinding.source_bindings[0].sha256.slice('sha256:'.length)
); assertions += 1;

process.stdout.write(`${JSON.stringify({
  ok: true,
  domains: evidence.domains,
  models: evidence.metrics.models,
  unique_selection: `${evidence.metrics.correct_unique_selections}/${evidence.metrics.unique_selection_attempts}`,
  abstention: `${evidence.metrics.ambiguity_or_safety_abstentions}/${evidence.metrics.ambiguity_or_safety_abstention_attempts}`,
  artifact_page_calls: evidence.metrics.artifact_page_calls,
  wrong_object_automatic_execution: 0,
  unauthorized_s2_s4_execution: 0,
  mutation_performed: false,
  local_reports_verified: localReportsVerified,
  local_aggregate_verified: localAggregateVerified,
  negative_schema_cases: negativeSchemaCases.length,
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
