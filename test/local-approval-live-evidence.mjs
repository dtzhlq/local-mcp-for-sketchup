import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(await fs.readFile(new URL('../schema/local-approval-live-evidence-v1.schema.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(await fs.readFile(new URL('../docs/evidence/local-approval-live-evidence-2026-07-16.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2));
assert.equal(evidence.installed_source.workspace_plugin_main_sha256, evidence.installed_source.installed_plugin_main_sha256);
assert.equal(evidence.failure_discovery.native_mutation_committed, true);
assert.equal(evidence.failure_discovery.task_state, 'failed');
assert.equal(evidence.failure_discovery.durable_task_receipt_recorded, false);
assert.equal(evidence.successful_attempt.task_state, 'completed');
assert.equal(evidence.successful_attempt.receipt.status, 'finalized');
assert.equal(evidence.successful_attempt.save.mode, 'copy');
assert.equal(evidence.successful_attempt.save.active_model_identity_preserved, true);
assert.notEqual(evidence.successful_attempt.model_revision_before, evidence.successful_attempt.model_revision_after);
assert.equal(evidence.successful_attempt.target.same_persistent_entity, true);
assert.equal(evidence.successful_attempt.approval_token_exposed_to_agent, false);
assert.equal(evidence.release_acceptance, false);

for (const mutate of [
  (value) => { value.installed_source.exact_hash_match = false; },
  (value) => { value.successful_attempt.approval_token_exposed_to_agent = true; },
  (value) => { value.successful_attempt.receipt.status = 'prepared'; },
  (value) => { value.successful_attempt.save.mode = 'save_as'; },
  (value) => { value.successful_attempt.geometry_delta.faces = 1; },
  (value) => { value.successful_attempt.queue_after.processing = 1; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(evidence);
  mutate(invalid);
  assert.equal(validate(invalid), false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  real_user_approval: true,
  live_s2_mutation: true,
  finalized_receipt: true,
  identity_preserving_save_copy: true,
  approval_token_exposed_to_agent: false,
  queue_clean: true,
  release_acceptance: false,
  negative_cases: 7
}, null, 2)}\n`);
