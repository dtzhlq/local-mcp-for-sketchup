import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
const schema = await readJson('schema/trimble-s6-reference-correction-live-evidence-v1.schema.json');
const evidence = await readJson('docs/evidence/trimble-s6-reference-correction-live-evidence-2026-07-22.json');
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2));

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after live capture`);
}
for (const [relativePath, expected] of Object.entries(evidence.artifact_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} does not match the live evidence`);
}

const artifactPath = (suffix) => Object.keys(evidence.artifact_sha256).find((value) => value.endsWith(suffix));
const [prepare, apply, acceptance, inputDsl, applyResult, capture, modelQa] = await Promise.all([
  readJson(artifactPath('/prepare.json')),
  readJson(artifactPath('/apply.json')),
  readJson(artifactPath('/acceptance.json')),
  readJson(artifactPath('/input.dsl.json')),
  readJson(artifactPath('/apply-result.json')),
  readJson(artifactPath('/capture.json')),
  readJson(artifactPath('/model-qa.json'))
]);

assert.equal(prepare.task_id, evidence.plan.task_id);
assert.equal(prepare.plan_id, evidence.plan.plan_id);
assert.equal(prepare.plan_hash, evidence.plan.plan_hash);
assert.equal(prepare.approval_required, false);
assert.equal(prepare.authorization_policy.approval_status, evidence.plan.approval_status);
assert.equal(prepare.authorization_policy.configured_roots_exposed_to_agent, false);
assert.equal(apply.task_id, evidence.plan.task_id);
assert.equal(apply.task_state, 'completed');
assert.equal(apply.authorization.mode, evidence.apply.authorization_mode);
assert.equal(apply.authorization.approved_by, evidence.apply.approved_by);
assert.equal(apply.mutation_receipt.receipt_id, evidence.apply.receipt_id);
assert.equal(apply.mutation_receipt.status, 'finalized');

assert.equal(inputDsl.version, 1);
assert.equal(inputDsl.operations.length, evidence.plan.operation_count);
const expectedContacts = inputDsl.operations.reduce(
  (count, operation) => count + (operation.qa?.expected_contacts?.length || 0),
  0
);
assert.equal(expectedContacts, evidence.plan.expected_contact_count);
const evidenceSources = inputDsl.operations.flatMap((operation) => [
  ...(operation.evidence ? [operation.evidence] : []),
  ...(operation.qa?.evidence_sources || [])
]);
assert.equal(new Set(evidenceSources.map((item) => item.handle)).size, evidence.plan.reference_handle_count);
assert.equal(evidenceSources.every((item) => item.content_trust === 'untrusted_data' && item.policy_effect === 'none'), true);
assert.equal(
  sha256Text(JSON.stringify(inputDsl)),
  applyResult.iteration.code_sha256,
  'the executed compact DSL must retain the hash-bound reference/contact metadata'
);

assert.equal(acceptance.task_id, evidence.plan.task_id);
assert.equal(acceptance.plan_hash, evidence.plan.plan_hash);
assert.equal(acceptance.qa_contract_binding.approved_plan_expected_contact_count, evidence.plan.expected_contact_count);
assert.equal(acceptance.qa_contract_binding.plan_hash_bound_for_this_run, true);
assert.equal(acceptance.correction.observed_added_group_count, evidence.apply.added_group_count);
assert.equal(acceptance.correction.missing_groups.length, 0);
assert.equal(acceptance.correction.material_mismatches.length, 0);
assert.equal(acceptance.correction.lower_front_cover.pass, true);
assert.equal(modelQa.ok, true);
assert.equal(modelQa.verdict, 'pass');
assert.equal(modelQa.issues.length, 0);
assert.equal(modelQa.accepted_warnings.length, evidence.apply.accepted_expected_contact_count);
assert.equal(capture.read_only_attestation.state_unchanged, true);
assert.equal(capture.read_only_attestation.view_unchanged, true);
assert.equal(capture.read_only_attestation.model_revision_before, evidence.model.model_revision_after);
assert.equal(capture.read_only_attestation.model_revision_after, evidence.model.model_revision_after);
assert.equal(evidence.model.disk_sha256_before, evidence.model.disk_sha256_after);
assert.notEqual(evidence.model.model_revision_before, evidence.model.model_revision_after);

for (const mutate of [
  (value) => { value.plan.contacts_hash_bound_before_execution = false; },
  (value) => { value.plan.configured_roots_exposed_to_agent = true; },
  (value) => { value.apply.authorization_mode = 'agent_self_approved'; },
  (value) => { value.apply.receipt_status = 'prepared'; },
  (value) => { value.apply.queue_after.processing = 1; },
  (value) => { value.model.save_model = true; },
  (value) => { value.apply.structured_reference_alignment_completed = true; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(evidence);
  mutate(invalid);
  assert.equal(validate(invalid), false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  current_source_live_reference_correction: true,
  source_hashes_verified: Object.keys(evidence.source_sha256).length,
  artifact_hashes_verified: Object.keys(evidence.artifact_sha256).length,
  operations: inputDsl.operations.length,
  references: evidence.references.length,
  expected_contacts_hash_bound: expectedContacts,
  added_groups: evidence.apply.added_group_count,
  raw_model_qa_pass: true,
  capture_state_unchanged: true,
  queue_clean: true,
  release_acceptance: false
}, null, 2)}\n`);

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(root, relativePath))).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
