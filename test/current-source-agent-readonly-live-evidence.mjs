import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertNoSensitivePublicEvidence } from '../scripts/run-current-source-agent-readonly-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [evidence, schema] = await Promise.all([
  readJson('docs/evidence/current-source-agent-gateway-live-readonly-evidence-2026-07-21.json'),
  readJson('schema/current-source-agent-readonly-live-report-v1.schema.json')
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.doesNotThrow(() => assertNoSensitivePublicEvidence(evidence)); assertions += 1;
assert.equal(evidence.model.bytes_sha256_before, evidence.model.bytes_sha256_after); assertions += 1;
assert.equal(evidence.model.revision_indexed, evidence.model.revision_total_seen); assertions += 1;
assert.equal(evidence.agent_gateway.proposal_task_state, 'awaiting_input'); assertions += 1;
assert.equal(evidence.agent_gateway.proposal_requires_clarification, true); assertions += 1;
assert.equal(evidence.agent_gateway.proposal_candidate_count, 5); assertions += 1;
assert.equal(evidence.agent_gateway.proposal_selected_target_count, 0); assertions += 1;
assert.equal(evidence.agent_gateway.proposal_operation_count, 0); assertions += 1;
assert.equal(evidence.agent_gateway.proposal_execution_allowed, false); assertions += 1;
assert.deepEqual(evidence.safety.queue_before, evidence.safety.queue_after); assertions += 1;
assert.equal(evidence.safety.mutation_performed, false); assertions += 1;
assert.equal(evidence.acceptance.target_selection_accepted, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.agent_gateway.proposal_task_state = 'awaiting_review'; }),
  mutate(evidence, (value) => { value.agent_gateway.proposal_requires_clarification = false; }),
  mutate(evidence, (value) => { value.agent_gateway.proposal_selected_target_count = 1; }),
  mutate(evidence, (value) => { value.agent_gateway.proposal_operation_count = 1; }),
  mutate(evidence, (value) => { value.agent_gateway.proposal_execution_allowed = true; }),
  mutate(evidence, (value) => { value.safety.mutation_performed = true; }),
  mutate(evidence, (value) => { value.safety.queue_after.responses = 1; }),
  mutate(evidence, (value) => { value.acceptance.target_selection_accepted = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false, 'unsafe or overclaimed live evidence must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  weak_client_profile: evidence.agent_gateway.client_profile,
  understand_completed: true,
  ambiguity_failed_closed: true,
  candidate_count: evidence.agent_gateway.proposal_candidate_count,
  selected_target_count: 0,
  operation_count: 0,
  mutation_performed: false,
  queue_clean: true,
  release_acceptance: false,
  negative_cases: negativeCases.length,
  assertions
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
