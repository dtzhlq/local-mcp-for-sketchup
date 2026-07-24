import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { aggregateTargetQualityReports } from '../scripts/aggregate-current-source-model-target-quality-live.mjs';
import { assertNoSensitivePublicEvidence } from '../scripts/run-current-source-agent-readonly-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'schema/current-source-multi-model-target-quality-live-evidence-v1.schema.json'),
  'utf8'
));
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
let assertions = 0;

const sourceBindings = [
  binding('src/existing-model-edit-proposer.mjs', '1'),
  binding('src/agent-gateway.mjs', '2'),
  binding('scripts/run-current-source-model-target-quality-live.mjs', '3'),
  binding('schema/current-source-model-target-quality-live-report-v1.schema.json', '4')
];
const entries = [
  reportEntry('architecture', 1, 'unique_eligible_maximum', 'select_one_for_review_only', true),
  reportEntry('deep_shared', 2, 'ambiguous_volume_tie', 'ask_for_clarification', null),
  reportEntry('interior', 3, 'largest_group_locked_or_ineligible', 'ask_for_clarification', null),
  reportEntry('product', 4, 'unique_eligible_maximum', 'select_one_for_review_only', true)
];
const aggregate = aggregateTargetQualityReports(entries, {
  capturedAt: '2026-07-21T18:00:00.000Z',
  aggregateSourceBindings: [
    binding('scripts/aggregate-current-source-model-target-quality-live.mjs', '5'),
    binding('schema/current-source-multi-model-target-quality-live-evidence-v1.schema.json', '6')
  ]
});

assert.equal(validate(aggregate), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.doesNotThrow(() => assertNoSensitivePublicEvidence(aggregate)); assertions += 1;
assert.deepEqual(aggregate.domains, ['architecture', 'deep_shared', 'interior', 'product']); assertions += 1;
assert.equal(aggregate.metrics.models, 4); assertions += 1;
assert.equal(aggregate.metrics.distinct_fixture_handles, 4); assertions += 1;
assert.equal(aggregate.metrics.distinct_model_revisions, 4); assertions += 1;
assert.equal(aggregate.metrics.unique_selection_attempts, 2); assertions += 1;
assert.equal(aggregate.metrics.correct_unique_selections, 2); assertions += 1;
assert.equal(aggregate.metrics.target_top_5_attempts, 2); assertions += 1;
assert.equal(aggregate.metrics.target_top_5_hits, 2); assertions += 1;
assert.equal(aggregate.metrics.ambiguity_or_safety_abstention_attempts, 2); assertions += 1;
assert.equal(aggregate.metrics.ambiguity_or_safety_abstentions, 2); assertions += 1;
assert.equal(aggregate.metrics.artifact_page_calls, 10); assertions += 1;
assert.equal(aggregate.hard_gates.wrong_object_automatic_execution, 0); assertions += 1;
assert.equal(aggregate.acceptance.four_domain_real_skp_structural_target_quality, true); assertions += 1;
assert.equal(aggregate.acceptance.semantic_intent_benchmark, false); assertions += 1;
assert.equal(aggregate.acceptance.release_acceptance, false); assertions += 1;

for (const invalidEntries of [
  entries.slice(0, 3),
  entries.map((entry, index) => index === 3 ? reportEntry('architecture', 4, 'unique_eligible_maximum', 'select_one_for_review_only', true) : entry),
  entries.map((entry, index) => index === 3 ? { ...structuredClone(entry), document: { ...structuredClone(entry.document), model: structuredClone(entries[0].document.model) } } : entry),
  entries.map((entry, index) => index === 3 ? { ...structuredClone(entry), document: { ...structuredClone(entry.document), source_bindings: [binding('src/existing-model-edit-proposer.mjs', '9'), ...sourceBindings.slice(1)] } } : entry),
  entries.map((entry, index) => index === 3 ? { ...structuredClone(entry), document: { ...structuredClone(entry.document), safety: { ...entry.document.safety, mutation_performed: true } } } : entry)
]) {
  assert.throws(() => aggregateTargetQualityReports(invalidEntries, {
    aggregateSourceBindings: [
      binding('scripts/aggregate-current-source-model-target-quality-live.mjs', '5'),
      binding('schema/current-source-multi-model-target-quality-live-evidence-v1.schema.json', '6')
    ]
  })); assertions += 1;
}

const negativeDocuments = [
  mutate(aggregate, (value) => { value.domains.reverse(); }),
  mutate(aggregate, (value) => { value.cases[0].mutation_performed = true; }),
  mutate(aggregate, (value) => { value.safety.mutation_performed = true; }),
  mutate(aggregate, (value) => { value.hard_gates.wrong_object_automatic_execution = 1; }),
  mutate(aggregate, (value) => { value.acceptance.semantic_intent_benchmark = true; }),
  mutate(aggregate, (value) => { value.acceptance.release_acceptance = true; }),
  mutate(aggregate, (value) => { value.source_bindings[0].path = '/private/source.mjs'; })
];
for (const invalid of negativeDocuments) {
  assert.equal(validate(invalid), false); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  domains: aggregate.domains,
  unique_selection: '2/2',
  abstention: '2/2',
  wrong_object_automatic_execution: 0,
  mutation_performed: false,
  live_queue_called: false,
  negative_contract_cases: 5,
  negative_schema_cases: negativeDocuments.length,
  assertions
}, null, 2)}\n`);

function reportEntry(domain, index, oracleStatus, behavior, selectedMatchesOracle) {
  const select = behavior === 'select_one_for_review_only';
  return {
    sha256: `sha256:${String(index).repeat(64)}`,
    document: {
      version: 'current-source-model-target-quality-live-report.v1',
      result: 'pass',
      domain,
      source_bindings: structuredClone(sourceBindings),
      model: {
        fixture_handle: `fixture:sha256:${String(index + 4).repeat(64)}`,
        model_revision: `sha256:${String(index + 5).repeat(64)}`,
        revision_indexed: index * 100,
        revision_total_seen: index * 100,
        model_revision_complete: true,
        structural_group_count: index,
        projection_complete: true,
        bytes_unchanged: true,
        revision_unchanged: true
      },
      oracle: {
        status: oracleStatus,
        expected_behavior: behavior
      },
      agent_gateway: {
        observed_behavior: behavior,
        selected_matches_oracle: selectedMatchesOracle,
        oracle_target_in_top_5: select ? true : null,
        artifact_page_calls: index
      },
      safety: {
        queue_before: idleQueue(),
        queue_after: idleQueue(),
        mutation_requested: false,
        mutation_performed: false,
        save_requested: false,
        save_performed: false
      },
      acceptance: {
        structural_target_or_abstention_matches_oracle: true,
        multi_model_target_quality: false
      }
    }
  };
}

function binding(relativePath, digit) {
  return { path: relativePath, sha256: `sha256:${digit.repeat(64)}` };
}

function idleQueue() {
  return { queue: 0, processing: 0, responses: 0, lock_exists: false };
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
