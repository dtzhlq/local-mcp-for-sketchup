import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertNoSensitivePublicEvidence } from '../scripts/run-current-source-agent-readonly-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [evidence, schema, targetValidationSchema] = await Promise.all([
  readJson('docs/evidence/current-source-reviewed-plan-live-evidence-2026-07-21.json'),
  readJson('schema/current-source-reviewed-plan-live-evidence-v1.schema.json'),
  readJson('schema/existing-edit-target-validation-v1.schema.json')
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);
const validateTargetValidation = ajv.compile(targetValidationSchema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.equal(validateTargetValidation(evidence.reviewed_plan.target_validation), true, JSON.stringify(validateTargetValidation.errors, null, 2)); assertions += 1;
assert.doesNotThrow(() => assertNoSensitivePublicEvidence(evidence)); assertions += 1;
assert.equal(new Set(evidence.source_bindings.map((entry) => entry.path)).size, evidence.source_bindings.length); assertions += 1;
assert.equal(evidence.source_binding_status, 'historical_exact_source_snapshot'); assertions += 1;
assert.equal(evidence.superseded_by, 'docs/evidence/current-source-reviewed-plan-v3-live-evidence-2026-07-21.json'); assertions += 1;
await fs.access(path.join(repoRoot, evidence.superseded_by)); assertions += 1;
assert.equal(evidence.acceptance.capture_time_current_source, true); assertions += 1;
assert.equal(evidence.acceptance.current_acceptance, false); assertions += 1;

assert.equal(evidence.model.revision_indexed, 71360); assertions += 1;
assert.equal(evidence.model.revision_indexed, evidence.model.revision_total_seen); assertions += 1;
assert.equal(evidence.proposal.full_model_graph_complete, false); assertions += 1;
assert.deepEqual(evidence.proposal.full_model_graph_blockers, ['recursive_index_not_requested']); assertions += 1;
assert.equal(evidence.proposal.projected_groups, 41); assertions += 1;
assert.equal(evidence.proposal.selected_entity_path, evidence.reviewed_plan.selected_entity_path); assertions += 1;
assert.equal(evidence.proposal.execution_allowed, false); assertions += 1;
assert.equal(evidence.reviewed_plan.target_validation.mode, 'structural_groups'); assertions += 1;
assert.equal(evidence.reviewed_plan.target_validation.exact_targets_verified, true); assertions += 1;
assert.equal(evidence.reviewed_plan.target_validation.leaf_entities_materialized, false); assertions += 1;
assert.equal(evidence.reviewed_plan.blocker_count, 0); assertions += 1;
assert.equal(evidence.reviewed_plan.approval_challenge_status, 'awaiting_trusted_user'); assertions += 1;
assert.equal(evidence.reviewed_plan.approval_decision_recorded, false); assertions += 1;
assert.equal(evidence.reviewed_plan.approval_token_issued, false); assertions += 1;
assert.equal(evidence.reviewed_plan.execution_allowed, false); assertions += 1;
assert.equal(evidence.safety.final_queue + evidence.safety.final_processing + evidence.safety.final_responses, 0); assertions += 1;
assert.equal(evidence.safety.final_lock_exists, false); assertions += 1;
assert.equal(evidence.safety.mutation_performed, false); assertions += 1;
assert.equal(evidence.acceptance.post_approval_execution_path, false); assertions += 1;
assert.equal(evidence.acceptance.live_mutation, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const runRoot = 'output/live-validation/reviewed-plan-readonly/trimble-s6-bounded-reviewed-plan-2026-07-21';
const localArtifacts = [
  [`${runRoot}/report.json`, evidence.capture_artifact_hashes.public_report],
  [`${runRoot}/private/proposal-projection.json`, evidence.capture_artifact_hashes.private_proposal_projection],
  [`${runRoot}/private/reviewed-projection.json`, evidence.capture_artifact_hashes.private_reviewed_projection],
  [`${runRoot}/private/reviewed-plan.json`, evidence.capture_artifact_hashes.private_reviewed_plan],
  [`${runRoot}/private/handshake-before.json`, evidence.capture_artifact_hashes.private_handshake_before],
  [`${runRoot}/private/handshake-after.json`, evidence.capture_artifact_hashes.private_handshake_after]
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

if (localCaptureArtifactsVerified === localArtifacts.length) {
  const [report, proposalProjection, reviewedProjection, plan] = await Promise.all([
    readJson(localArtifacts[0][0]),
    readJson(localArtifacts[1][0]),
    readJson(localArtifacts[2][0]),
    readJson(localArtifacts[3][0])
  ]);
  assert.equal(report.result, 'pass'); assertions += 1;
  assert.equal(report.safety.mutation_performed, false); assertions += 1;
  assert.equal(proposalProjection.result.target_discovery.mode, 'structural_groups'); assertions += 1;
  assert.equal(proposalProjection.result.proposal.selected_targets[0].entity_path, evidence.proposal.selected_entity_path); assertions += 1;
  assert.equal(reviewedProjection.result.target_validation.mode, 'structural_groups'); assertions += 1;
  assert.equal(reviewedProjection.result.approval_challenge.status, 'awaiting_trusted_user'); assertions += 1;
  assert.equal(plan.plan_hash, evidence.reviewed_plan.plan_hash); assertions += 1;
  assert.equal(plan.targets[0].entity.entity_path, evidence.reviewed_plan.selected_entity_path); assertions += 1;
  assert.equal(plan.dsl_document.operations[0].op, evidence.reviewed_plan.operation); assertions += 1;
  assert.equal(plan.target_validation.leaf_entities_materialized, false); assertions += 1;
  const decisionDir = path.join(repoRoot, runRoot, 'private/approvals/local-decisions');
  let decisionFiles = [];
  try {
    decisionFiles = await fs.readdir(decisionDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  assert.equal(decisionFiles.length, 0); assertions += 1;
}

const negativeCases = [
  mutate(evidence, (value) => { value.proposal.full_model_graph_complete = true; }),
  mutate(evidence, (value) => { value.proposal.leaf_entities_materialized = true; }),
  mutate(evidence, (value) => { value.proposal.selected_entity_path = 'pid:89455'; }),
  mutate(evidence, (value) => { value.reviewed_plan.target_validation.mode = 'full_recursive'; }),
  mutate(evidence, (value) => { value.reviewed_plan.target_validation.exact_targets_verified = false; }),
  mutate(evidence, (value) => { value.reviewed_plan.target_validation.leaf_entities_materialized = true; }),
  mutate(evidence, (value) => { value.reviewed_plan.approval_decision_recorded = true; }),
  mutate(evidence, (value) => { value.reviewed_plan.approval_token_issued = true; }),
  mutate(evidence, (value) => { value.reviewed_plan.execution_allowed = true; }),
  mutate(evidence, (value) => { value.safety.mutation_performed = true; }),
  mutate(evidence, (value) => { value.safety.final_processing = 1; }),
  mutate(evidence, (value) => { value.acceptance.current_acceptance = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false, 'unsafe or overclaimed reviewed-plan evidence must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_scope: evidence.evidence_scope,
  revision_occurrences: evidence.model.revision_total_seen,
  projected_groups: evidence.proposal.projected_groups,
  reviewed_target_exact: true,
  approval_decision_recorded: false,
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
