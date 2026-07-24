import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertNoSensitivePublicEvidence } from '../scripts/run-current-source-agent-readonly-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [evidence, schema] = await Promise.all([
  readJson('docs/evidence/current-source-model-target-quality-runner-v1-mock-evidence.json'),
  readJson('schema/current-source-model-target-quality-runner-mock-evidence-v1.schema.json')
]);
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.doesNotThrow(() => assertNoSensitivePublicEvidence(evidence)); assertions += 1;
for (const [relativePath, expected] of Object.entries(evidence.hashes)) {
  assert.equal(await sha256File(relativePath), expected.slice('sha256:'.length), relativePath); assertions += 1;
}

assert.equal(evidence.contract.active_model_switch_performed_by_runner, false); assertions += 1;
assert.equal(evidence.contract.proposal_only, true); assertions += 1;
assert.equal(evidence.scenarios.locked_largest_abstention, true); assertions += 1;
assert.equal(evidence.scenarios.untrusted_text_cannot_break_geometry_tie, true); assertions += 1;
assert.equal(evidence.tests.default_live_queue_calls, 0); assertions += 1;
assert.equal(evidence.tests.mutation_requested, false); assertions += 1;
assert.equal(evidence.hard_gates.wrong_object_automatic_execution, 0); assertions += 1;
assert.equal(evidence.hard_gates.ambiguous_target_automatic_selection, 0); assertions += 1;
assert.equal(evidence.acceptance.multi_model_live_target_quality, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeCases = [
  mutate(evidence, (value) => { value.contract.explicit_runtime_queue_required = false; }),
  mutate(evidence, (value) => { value.contract.active_model_switch_performed_by_runner = true; }),
  mutate(evidence, (value) => { value.scenarios.locked_largest_abstention = false; }),
  mutate(evidence, (value) => { value.scenarios.untrusted_text_cannot_break_geometry_tie = false; }),
  mutate(evidence, (value) => { value.tests.default_live_queue_calls = 1; }),
  mutate(evidence, (value) => { value.hard_gates.wrong_object_automatic_execution = 1; }),
  mutate(evidence, (value) => { value.hard_gates.ambiguous_target_automatic_selection = 1; }),
  mutate(evidence, (value) => { value.acceptance.multi_model_live_target_quality = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false); assertions += 1;
}
const tamperedBinding = mutate(evidence, (value) => {
  value.hashes['src/existing-model-edit-proposer.mjs'] = `sha256:${'0'.repeat(64)}`;
});
assert.notEqual(
  await sha256File('src/existing-model-edit-proposer.mjs'),
  tamperedBinding.hashes['src/existing-model-edit-proposer.mjs'].slice('sha256:'.length)
); assertions += 1;

process.stdout.write(`${JSON.stringify({
  ok: true,
  source_bindings: Object.keys(evidence.hashes).length,
  runner_assertions: evidence.tests.runner_assertions,
  locked_target_fallback_failed_closed: true,
  untrusted_text_geometry_tie_failed_closed: true,
  live_queue_called: false,
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
