import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/portal-boolean-v8-readonly-discovery-2026-07-21.json';
const schemaPath = 'schema/portal-boolean-v8-readonly-discovery-v1.schema.json';
const expectedRevision = 'sha256:c03d317c25883606f0f8d7819610823118d916694d5a5d323deabe2ac7bcdf36';
const expectedSourceSha256 = 'sha256:4a75190929bfa47b1506a8ed037a08e0f08e1632169d9bb550c4a9219b43e90c';
const expectedPair = ['pid:11543', 'pid:11635'];
let assertions = 0;

const [evidence, schema] = await Promise.all([readJson(evidencePath), readJson(schemaPath)]);
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;

const artifactDocuments = {};
for (const [label, binding] of Object.entries(evidence.artifact_bindings)) {
  const bytes = await readRegularRepoFile(binding.path);
  assert.equal(`sha256:${sha256(bytes)}`, binding.sha256, `${label} artifact byte hash drift`); assertions += 1;
  artifactDocuments[label] = JSON.parse(bytes.toString('utf8'));
}

const { capabilities, queue_before: queueBefore, structural_adoption: adoption, recursive_review: review, queue_after: queueAfter } = artifactDocuments;
assert.equal(capabilities.runtime.name, 'queue'); assertions += 1;
assert.equal(capabilities.runtime.version, evidence.runtime.plugin_version); assertions += 1;
assert.equal(capabilities.runtime.capability_version, evidence.runtime.capability_version); assertions += 1;
assert.equal(capabilities.runtime.manifest_version, evidence.runtime.manifest_version); assertions += 1;
assert.equal(capabilities.runtime.dsl_version, evidence.runtime.dsl_version); assertions += 1;
assert.equal(capabilities.runtime.compatibility.ok, true); assertions += 1;
assert.deepEqual(capabilities.runtime.compatibility.issues, []); assertions += 1;
assert.equal(`sha256:${capabilities.runtime.boolean_operations_sha256}`, evidence.runtime.boolean_operations_sha256); assertions += 1;
assert.equal(`sha256:${capabilities.runtime.model_revision_source_sha256}`, evidence.runtime.model_revision_source_sha256); assertions += 1;
assert.equal(capabilities.runtime.model_revision.strategy, evidence.model.revision_strategy); assertions += 1;
assert.equal(capabilities.runtime.model_revision.unique_entity_limit, evidence.model.revision_unique_entity_limit); assertions += 1;
assert.equal(capabilities.runtime.read_only_probes.structural_groups.version, evidence.runtime.structural_groups_version); assertions += 1;
assert.equal(capabilities.runtime.read_only_probes.structural_groups.mutates_model, false); assertions += 1;

for (const queueState of [queueBefore, queueAfter]) {
  assert.equal(queueState.queue.count, 0); assertions += 1;
  assert.equal(queueState.processing.count, 0); assertions += 1;
  assert.equal(queueState.responses.count, 0); assertions += 1;
  assert.equal(queueState.lock.exists, false); assertions += 1;
  assert.equal(queueState.lock.stale, false); assertions += 1;
}

assert.equal(adoption.kind, 'adopt_open_model'); assertions += 1;
assert.equal(adoption.runtime, 'queue'); assertions += 1;
assert.equal(adoption.read_only, true); assertions += 1;
assert.equal(adoption.model_modified, false); assertions += 1;
assert.equal(adoption.model_revision, expectedRevision); assertions += 1;
assert.equal(adoption.model_revision_complete, true); assertions += 1;
assert.equal(adoption.model_revision_strategy, 'definition-merkle.v2'); assertions += 1;
assert.equal(adoption.model_revision_total_seen, 11474); assertions += 1;
assert.equal(adoption.model_revision_indexed, 11474); assertions += 1;
assert.equal(adoption.model_revision_unique_entities, 9588); assertions += 1;
assert.equal(adoption.model_revision_reachable_definitions, 11); assertions += 1;
assert.equal(adoption.document_id, evidence.model.document_id); assertions += 1;
assert.equal(adoption.recursive_total_seen, 11474); assertions += 1;
assert.equal(adoption.recursive_truncated, false); assertions += 1;
assert.equal(adoption.structural_groups.total_seen, 18); assertions += 1;
assert.equal(adoption.structural_groups.total_seen_exact, true); assertions += 1;
assert.equal(adoption.structural_groups.returned, 18); assertions += 1;
assert.equal(adoption.structural_groups.truncated, false); assertions += 1;
assert.equal(adoption.structural_groups.fresh_manifold_requested, 9); assertions += 1;
assert.equal(adoption.structural_groups.fresh_manifold_matched, 9); assertions += 1;
assert.equal(adoption.structural_groups.fresh_manifold_unmatched, 0); assertions += 1;
assert.deepEqual(adoption.structural_groups.fresh_manifold_unmatched_paths, []); assertions += 1;

const requestedEntries = adoption.structural_groups.entries.filter((entry) => entry.manifold_attestation?.fresh === true);
assert.equal(requestedEntries.length, 9); assertions += 1;
assert.equal(requestedEntries.filter((entry) => entry.manifold_attestation.is_manifold === true).length, 8); assertions += 1;
assert.equal(requestedEntries.filter((entry) => entry.manifold_attestation.is_manifold === false).length, 1); assertions += 1;
for (const entityPath of expectedPair) {
  const matches = adoption.structural_groups.entries.filter((entry) => entry.entity_path === entityPath);
  assert.equal(matches.length, 1); assertions += 1;
  const entry = matches[0];
  assert.equal(entry.parent_entity_path, null); assertions += 1;
  assert.equal(entry.scope_path, 'model'); assertions += 1;
  assert.equal(entry.locked, false); assertions += 1;
  assert.equal(entry.effective_locked, false); assertions += 1;
  assert.equal(entry.visible, true); assertions += 1;
  assert.equal(entry.effective_visible, true); assertions += 1;
  assert.equal(entry.manifold_attestation.entity_path, entityPath); assertions += 1;
  assert.equal(entry.manifold_attestation.model_revision, expectedRevision); assertions += 1;
  assert.equal(entry.manifold_attestation.is_manifold, true); assertions += 1;
}

assert.equal(review.version, 'real-model-recursive-target-review.v2'); assertions += 1;
assert.equal(review.runtime, 'offline'); assertions += 1;
assert.equal(review.live_queue_called, false); assertions += 1;
assert.equal(review.source.sha256, expectedSourceSha256); assertions += 1;
assert.equal(review.model.revision, expectedRevision); assertions += 1;
assert.equal(review.model.revision_complete, true); assertions += 1;
assert.equal(review.model.document_id, evidence.model.document_id); assertions += 1;
assert.equal(review.model.model_identity_sha256, evidence.model.model_identity_sha256); assertions += 1;
assert.equal(review.input_summary.fresh_manifold_requested, 9); assertions += 1;
assert.equal(review.input_summary.fresh_manifold_matched, 9); assertions += 1;
assert.equal(review.review.status, 'server_recommended'); assertions += 1;
assert.equal(review.review.blockers.length, 0); assertions += 1;
const recommendation = review.review.recommended_proposal;
assert.deepEqual([recommendation.target.occurrence_path, recommendation.tool.occurrence_path], expectedPair); assertions += 1;
assert.equal(recommendation.bbox_relation, 'containment'); assertions += 1;
assert.equal(recommendation.positive_bbox_overlap, true); assertions += 1;
assert.deepEqual(recommendation.bbox_overlap_bounding_box, recommendation.tool.bounding_box); assertions += 1;
assert.equal(recommendation.bbox_overlap_volume, evidence.recommended_pair.bbox_overlap_volume); assertions += 1;
assert.equal(recommendation.atomic_boolean_trial_eligible, true); assertions += 1;
assert.deepEqual(recommendation.exact_solid_overlap, evidence.recommended_pair.exact_solid_overlap); assertions += 1;
assert.equal(recommendation.exact_solid_overlap.verified, false); assertions += 1;
assert.equal(recommendation.target.manifold_attestation.is_manifold, true); assertions += 1;
assert.equal(recommendation.tool.manifold_attestation.is_manifold, true); assertions += 1;
assert.equal(recommendation.confirmed, false); assertions += 1;
assert.equal(recommendation.authorized, false); assertions += 1;
assert.equal(recommendation.trusted_approval_required, true); assertions += 1;
assert.equal(review.safety.model_mutation_authorized, false); assertions += 1;
assert.equal(review.next_action.approval_token_issued, false); assertions += 1;
assert.equal(review.next_action.release_acceptance, false); assertions += 1;

const sourceBytes = await readRegularRepoFile(evidence.source.path);
assert.equal(sourceBytes.length, evidence.source.size_bytes); assertions += 1;
assert.equal(`sha256:${sha256(sourceBytes)}`, expectedSourceSha256); assertions += 1;
assert.equal(evidence.source.sha256_before, evidence.source.sha256_after); assertions += 1;
assert.equal(evidence.source.bytes_unchanged, true); assertions += 1;
assert.equal(evidence.authorization_boundary.approval_challenge_issued, false); assertions += 1;
assert.equal(evidence.authorization_boundary.prior_task_or_approval_replay_allowed, false); assertions += 1;
assert.equal(evidence.authorization_boundary.mutation_authorized, false); assertions += 1;
assert.equal(evidence.safety.model_content_mutation_performed, false); assertions += 1;
assert.equal(evidence.safety.save_requested, false); assertions += 1;
assert.equal(evidence.release_acceptance, false); assertions += 1;
assert.doesNotMatch(JSON.stringify(evidence), /"(?:approval_token|signature|nonce|session_contract)"\s*:/); assertions += 1;

const invalidEvidence = [
  mutate(evidence, (value) => { value.artifact_bindings.capabilities.path = value.artifact_bindings.queue_before.path; }),
  mutate(evidence, (value) => { value.artifact_bindings.structural_adoption.sha256 = `sha256:${'0'.repeat(64)}`; }),
  mutate(evidence, (value) => { value.recommended_pair.exact_solid_overlap.verified = true; }),
  mutate(evidence, (value) => { value.recommended_pair.atomic_boolean_trial_eligible = false; }),
  mutate(evidence, (value) => { value.recommended_pair.tool_path = 'pid:14632'; }),
  mutate(evidence, (value) => { value.authorization_boundary.approval_challenge_issued = true; }),
  mutate(evidence, (value) => { value.authorization_boundary.prior_task_or_approval_replay_allowed = true; }),
  mutate(evidence, (value) => { value.authorization_boundary.mutation_authorized = true; }),
  mutate(evidence, (value) => { value.safety.model_content_mutation_performed = true; }),
  mutate(evidence, (value) => { value.safety.queue_after.responses = 1; }),
  mutate(evidence, (value) => { value.release_acceptance = true; })
];
for (const invalid of invalidEvidence) {
  assert.equal(validate(invalid), false, 'unsafe or drifted discovery evidence must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  assertions,
  artifact_hash_bindings: Object.keys(evidence.artifact_bindings).length,
  source_bytes_bound: true,
  model_revision: expectedRevision,
  recursive_logical_occurrences: evidence.model.revision_logical_occurrences,
  fresh_manifold_requested: evidence.structural_probe.fresh_manifold_requested,
  fresh_manifold_matched: evidence.structural_probe.fresh_manifold_matched,
  recommended_pair: expectedPair,
  bbox_relation: evidence.recommended_pair.bbox_relation,
  exact_solid_overlap_verified: false,
  approval_challenge_issued: false,
  prior_approval_replay_allowed: false,
  mutation_authorized: false,
  release_acceptance: false,
  live_queue_called_by_test: false,
  negative_cases: invalidEvidence.length
}, null, 2)}\n`);

async function readJson(repoPath) {
  return JSON.parse((await readRegularRepoFile(repoPath)).toString('utf8'));
}

async function readRegularRepoFile(repoPath) {
  assert.equal(isSafeRepoRelativePath(repoPath), true, `unsafe repository path: ${repoPath}`);
  const candidate = path.resolve(repoRoot, repoPath);
  const lexicalStat = await fs.lstat(candidate);
  assert.equal(lexicalStat.isSymbolicLink(), false, `symbolic link not allowed: ${repoPath}`);
  assert.equal(lexicalStat.isFile(), true, `not a regular file: ${repoPath}`);
  const [realRoot, realCandidate] = await Promise.all([fs.realpath(repoRoot), fs.realpath(candidate)]);
  const relative = path.relative(realRoot, realCandidate);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `real path escapes repository: ${repoPath}`);
  return fs.readFile(realCandidate);
}

function isSafeRepoRelativePath(repoPath) {
  if (typeof repoPath !== 'string' || repoPath.length === 0 || repoPath.includes('\\') || repoPath.includes('\u0000')
    || path.posix.isAbsolute(repoPath) || path.win32.isAbsolute(repoPath)) return false;
  const segments = repoPath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && path.posix.normalize(repoPath) === repoPath;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
