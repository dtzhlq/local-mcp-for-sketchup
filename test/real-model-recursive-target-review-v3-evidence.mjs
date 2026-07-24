import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  deriveRealModelRecursiveTargetReviewV3,
  runRealModelRecursiveTargetReviewV3
} from '../src/real-model-recursive-target-review.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/real-model-recursive-target-review-v3-mock-evidence.json';
const evidenceSchemaPath = 'schema/real-model-recursive-target-review-v3-evidence-v1.schema.json';
const fixturePath = 'test/fixtures/real-model-recursive-target-review-v3.json';
const reviewV2SchemaPath = 'schema/real-model-recursive-target-review-v2.schema.json';
const reviewV3SchemaPath = 'schema/real-model-recursive-target-review-v3.schema.json';
const publicV8FailurePath = 'docs/evidence/portal-boolean-v8-failure-evidence-2026-07-21.json';
const [evidence, evidenceSchema, fixture, v2Schema, v3Schema, publicV8] = await Promise.all([
  readJson(evidencePath),
  readJson(evidenceSchemaPath),
  readJson(fixturePath),
  readJson(reviewV2SchemaPath),
  readJson(reviewV3SchemaPath),
  readJson(publicV8FailurePath)
]);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-recursive-review-v3-evidence-'));
const adoptionPath = path.join(tempRoot, 'adoption.json');
const lineagePath = path.join(tempRoot, 'negative-lineage.json');
await Promise.all([
  fs.writeFile(adoptionPath, `${JSON.stringify(fixture.adoption, null, 2)}\n`),
  fs.writeFile(lineagePath, `${JSON.stringify(fixture.negative_atomic_trial_lineage, null, 2)}\n`)
]);
let assertions = 0;

const validateEvidence = new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
  .compile(evidenceSchema);
assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2)); assertions += 1;

const reviewAjv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
reviewAjv.addSchema(v2Schema);
const validateReview = reviewAjv.compile(v3Schema);

const expectedBindings = new Set([
  'source_module',
  'cli',
  'review_v1_schema',
  'review_v2_schema',
  'review_v3_schema',
  'evidence_schema',
  'portable_fixture',
  'focused_test',
  'evidence_test',
  'workflow',
  'public_v8_failure_evidence'
]);
assert.deepEqual(new Set(Object.keys(evidence.artifact_bindings)), expectedBindings); assertions += 1;
for (const binding of Object.values(evidence.artifact_bindings)) {
  assert.equal(isSafeRepoRelativePath(binding.path), true); assertions += 1;
  assert.equal(await sha256File(binding.path), binding.sha256); assertions += 1;
}

assert.equal(fixture.policy.portable, true); assertions += 1;
assert.equal(fixture.policy.live_queue_called, false); assertions += 1;
assert.equal(fixture.policy.model_mutation_performed, false); assertions += 1;
assert.equal(fixture.policy.release_acceptance, false); assertions += 1;
assert.equal(fixture.negative_atomic_trial_lineage.source_evidence.path, publicV8FailurePath); assertions += 1;
assert.equal(fixture.negative_atomic_trial_lineage.source_evidence.sha256, await sha256File(publicV8FailurePath)); assertions += 1;
assert.deepEqual(fixture.context.v8_loaded_runtime_source_hashes, {
  boolean_operations_sha256: publicV8.runtime_contract.boolean_operations_sha256,
  model_revision_source_sha256: publicV8.runtime_contract.model_revision_source_sha256
}); assertions += 1;
assert.equal(publicV8.runtime_contract.historical_exact_loaded_runtime, true); assertions += 1;

assert.equal(
  fixture.context.workspace_pending_runtime_source_hashes.boolean_operations_sha256,
  await sha256File('sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb')
); assertions += 1;
assert.equal(
  fixture.context.workspace_pending_runtime_source_hashes.model_revision_source_sha256,
  await sha256File('sketchup_plugin/alma_sketchup_mcp/model_revision.rb')
); assertions += 1;
assert.notEqual(
  fixture.context.v8_loaded_runtime_source_hashes.boolean_operations_sha256,
  fixture.context.workspace_pending_runtime_source_hashes.boolean_operations_sha256
); assertions += 1;

const pureExact = derive(fixture.context.v8_loaded_runtime_source_hashes);
assert.equal(pureExact.review.status, 'blocked'); assertions += 1;
assert.ok(pureExact.review.blockers.includes('negative_source_evidence_unverified')); assertions += 1;
assert.equal(pureExact.next_action.action,
  'verify_negative_source_evidence_before_candidate_policy'); assertions += 1;
const exact = await runVerified(fixture.context.v8_loaded_runtime_source_hashes, 'exact');
assert.equal(validateReview(exact), true, JSON.stringify(validateReview.errors, null, 2)); assertions += 1;
assert.equal(exact.negative_atomic_trial_lineage.status, 'exact_runtime_match'); assertions += 1;
assert.equal(exact.review.status, 'blocked'); assertions += 1;
assert.equal(exact.review.recommended_proposal, null); assertions += 1;
assert.equal(pair(exact, 'pid:11543', 'pid:11635').negative_atomic_trial.status,
  'confirmed_precommit_abort_exact_runtime'); assertions += 1;
assert.equal(pair(exact, 'pid:11543', 'pid:11635').atomic_boolean_trial_eligible, false); assertions += 1;
assert.equal(pair(exact, 'pid:11543', 'pid:11636').exact_overlap_assessment.evidence_requirement,
  'needs_stronger_evidence'); assertions += 1;
assert.equal(pair(exact, 'pid:11543', 'pid:11636').atomic_boolean_trial_eligible, false); assertions += 1;
assert.equal(exact.geometry_attestations.every((entry) => entry.exact_overlap_proof === false), true); assertions += 1;
assert.equal(exact.safety.queue_accessed, false); assertions += 1;
assert.equal(exact.safety.release_acceptance, false); assertions += 1;

const drift = await runVerified(fixture.context.workspace_pending_runtime_source_hashes, 'drift');
assert.equal(validateReview(drift), true, JSON.stringify(validateReview.errors, null, 2)); assertions += 1;
assert.equal(drift.negative_atomic_trial_lineage.status, 'runtime_delta_requires_review'); assertions += 1;
assert.deepEqual(drift.negative_atomic_trial_lineage.trials[0].runtime_delta_fields,
  ['boolean_operations_sha256']); assertions += 1;
assert.equal(drift.negative_atomic_trial_lineage.negative_trial_not_directly_reusable, true); assertions += 1;
assert.equal(pair(drift, 'pid:11543', 'pid:11635').negative_atomic_trial.status,
  'negative_trial_not_directly_reusable'); assertions += 1;
assert.equal(drift.review.status, 'blocked'); assertions += 1;
assert.equal(drift.review.recommended_proposal, null); assertions += 1;
assert.equal(drift.review.pair_decisions.every((entry) => entry.atomic_boolean_trial_eligible === false), true); assertions += 1;
assert.ok(drift.review.blockers.includes('runtime_delta_requires_review')); assertions += 1;
assert.equal(drift.next_action.action, 'audit_runtime_source_delta_before_new_atomic_trial'); assertions += 1;
assert.equal(drift.next_action.negative_trial_not_directly_reusable, true); assertions += 1;
assert.equal(drift.next_action.release_acceptance, false); assertions += 1;

assert.deepEqual(evidence.runtime_cases.historical_exact_match.current_runtime_source_hashes,
  fixture.context.v8_loaded_runtime_source_hashes); assertions += 1;
assert.deepEqual(evidence.runtime_cases.historical_exact_match.negative_trial_runtime_source_hashes,
  fixture.negative_atomic_trial_lineage.runtime_source_hashes); assertions += 1;
assert.equal(evidence.runtime_cases.historical_exact_match.lineage_status,
  exact.negative_atomic_trial_lineage.status); assertions += 1;
assert.equal(evidence.runtime_cases.historical_exact_match.failed_pair_status,
  pair(exact, 'pid:11543', 'pid:11635').negative_atomic_trial.status); assertions += 1;
assert.deepEqual(evidence.runtime_cases.workspace_pending_delta.current_runtime_source_hashes,
  fixture.context.workspace_pending_runtime_source_hashes); assertions += 1;
assert.deepEqual(evidence.runtime_cases.workspace_pending_delta.negative_trial_runtime_source_hashes,
  fixture.negative_atomic_trial_lineage.runtime_source_hashes); assertions += 1;
assert.deepEqual(evidence.runtime_cases.workspace_pending_delta.runtime_delta_fields,
  drift.negative_atomic_trial_lineage.trials[0].runtime_delta_fields); assertions += 1;
assert.equal(evidence.runtime_cases.workspace_pending_delta.next_action, drift.next_action.action); assertions += 1;
assert.equal(evidence.results.rank_2_automatic_recommendation, false); assertions += 1;
assert.equal(evidence.results.runtime_delta_automatic_s3_recommendation, false); assertions += 1;
assert.equal(evidence.results.runner_source_evidence_verified, true); assertions += 1;
assert.equal(evidence.results.wrong_source_evidence_hash_rejected, true); assertions += 1;
assert.equal(evidence.results.source_evidence_path_escape_rejected, true); assertions += 1;
assert.equal(evidence.results.source_evidence_symlink_rejected, true); assertions += 1;
assert.equal(evidence.results.public_evidence_content_binding_negative_cases, 4); assertions += 1;
assert.equal(evidence.safety.queue_requests_created, 0); assertions += 1;
assert.equal(evidence.release_acceptance, false); assertions += 1;

const serialized = JSON.stringify(evidence);
assert.doesNotMatch(serialized, /(?:^|["'])\/(?:Users|home|private|tmp)\//); assertions += 1;
assert.doesNotMatch(serialized, /[A-Za-z]:\\/); assertions += 1;
assert.equal(findSensitiveKeys(evidence).length, 0); assertions += 1;
await fs.rm(tempRoot, { recursive: true, force: true });

process.stdout.write(`${JSON.stringify({
  ok: true,
  assertions,
  artifact_hash_bindings: Object.keys(evidence.artifact_bindings).length,
  historical_runtime_preserved: true,
  exact_runtime_pair_excluded: true,
  workspace_runtime_delta_fail_closed: true,
  rank_2_automatic_recommendation: false,
  queue_requests_created: 0,
  release_acceptance: false
}, null, 2)}\n`);

function derive(runtimeSourceHashes) {
  return deriveRealModelRecursiveTargetReviewV3(fixture.adoption, {
    sourceSha256: fixture.context.source_sha256,
    modelRevision: fixture.context.model_revision,
    caseId: fixture.context.case_id,
    runtimeSourceHashes,
    negativeAtomicTrialLineages: [fixture.negative_atomic_trial_lineage],
    now: () => new Date('2026-07-21T08:00:00.000Z')
  });
}

async function runVerified(runtimeSourceHashes, label) {
  const result = await runRealModelRecursiveTargetReviewV3({
    adoptionFile: adoptionPath,
    sourceSha256: fixture.context.source_sha256,
    modelRevision: fixture.context.model_revision,
    caseId: fixture.context.case_id,
    runtimeSourceHashes,
    negativeAtomicTrialFile: lineagePath,
    output: path.join(tempRoot, `${label}-review.json`),
    now: () => new Date('2026-07-21T08:00:00.000Z')
  });
  return result.review;
}

function pair(review, targetPath, toolPath) {
  const match = review.review.pair_decisions.find((entry) => (
    entry.target_path === targetPath && entry.tool_path === toolPath
  ));
  assert.ok(match);
  return match;
}

async function readJson(repoPath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, repoPath), 'utf8'));
}

async function sha256File(repoPath) {
  const bytes = await fs.readFile(path.join(repoRoot, repoPath));
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function isSafeRepoRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes('\\')
    && path.posix.normalize(value) === value
    && value !== '..'
    && !value.startsWith('../');
}

function findSensitiveKeys(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  const findings = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (/(?:token|secret|password|authorization|cookie|credential|private_key)/i.test(key)
      && child !== false
      && child !== null) {
      findings.push(childPath);
    }
    findings.push(...findSensitiveKeys(child, childPath));
  }
  return findings;
}
