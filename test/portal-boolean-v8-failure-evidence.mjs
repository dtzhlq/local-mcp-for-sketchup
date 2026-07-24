import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/portal-boolean-v8-failure-evidence-2026-07-21.json';
const schemaPath = 'schema/portal-boolean-v8-failure-evidence-v1.schema.json';
const prepareEvidencePath = 'docs/evidence/portal-boolean-v8-prepare-2026-07-21.json';
const discoveryEvidencePath = 'docs/evidence/portal-boolean-v8-readonly-discovery-2026-07-21.json';
const publicPaths = new Set([evidencePath, schemaPath, prepareEvidencePath, discoveryEvidencePath]);
const localCaptureMode = process.argv.includes('--local-capture');
const publicReads = [];
let assertions = 0;

const [evidence, schema, prepareEvidence, discoveryEvidence] = await Promise.all([
  readPublicJson(evidencePath),
  readPublicJson(schemaPath),
  readPublicJson(prepareEvidencePath),
  readPublicJson(discoveryEvidencePath)
]);
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;

assert.deepEqual([...new Set(publicReads)].sort(), [...publicPaths].sort()); assertions += 1;
assert.equal(publicReads.some((repoPath) => repoPath.startsWith('output/')), false); assertions += 1;

for (const [binding, contractPath] of [
  [evidence.source_contract_bindings.prepare_evidence, prepareEvidencePath],
  [evidence.source_contract_bindings.readonly_discovery_evidence, discoveryEvidencePath]
]) {
  assert.equal(binding.path, contractPath); assertions += 1;
  assert.equal(`sha256:${sha256(await readPublicBytes(contractPath))}`, binding.sha256); assertions += 1;
}

assert.equal(evidence.result, 'confirmed_precommit_abort'); assertions += 1;
assert.equal(evidence.workflow.version, prepareEvidence.workflow.version); assertions += 1;
assert.equal(evidence.workflow.run_id, prepareEvidence.workflow.run_id); assertions += 1;
assert.equal(evidence.workflow.task_id, prepareEvidence.approval.task_id); assertions += 1;
assert.equal(evidence.workflow.task_state, 'failed'); assertions += 1;
assert.equal(evidence.workflow.risk_level, 'S3'); assertions += 1;
assert.equal(evidence.runtime_contract.capability_version, '0.1.0-rc.2-capabilities.7'); assertions += 1;
assert.equal(evidence.runtime_contract.manifest_version, '2026-07-agent-contract-v1.4'); assertions += 1;
assert.equal(evidence.runtime_contract.model_revision_strategy, 'definition-merkle.v2'); assertions += 1;
assert.equal(evidence.runtime_contract.boolean_operations_sha256, 'sha256:2e3d686ba926f8b43f5a9847e05471587a217b536fd901811f10444948c2c444'); assertions += 1;
assert.equal(evidence.runtime_contract.model_revision_source_sha256, 'sha256:b5c4c64c346c5abe1258be32c8027d542a4ccc28e2afc70c48debf3fcb886134'); assertions += 1;
assert.equal(evidence.runtime_contract.historical_exact_loaded_runtime, true); assertions += 1;
assert.equal(evidence.approval.plan_id, prepareEvidence.approval.plan_id); assertions += 1;
assert.equal(evidence.approval.plan_hash, prepareEvidence.approval.plan_hash); assertions += 1;
assert.equal(evidence.approval.status_after_failure, 'consumed_failed'); assertions += 1;
assert.equal(evidence.approval.approval_reusable, false); assertions += 1;
assert.equal(evidence.approval.same_task_retry_allowed, false); assertions += 1;
assert.equal(evidence.approval.previous_plan_or_approval_replay_allowed, false); assertions += 1;
assert.equal(evidence.approval.agent_self_approval_accepted, false); assertions += 1;
assert.equal(evidence.approval.private_approval_material_exposed, false); assertions += 1;

assert.deepEqual(evidence.operation, prepareEvidence.operation); assertions += 1;
assert.deepEqual(
  [evidence.operation.target_path, ...evidence.operation.tool_paths],
  [discoveryEvidence.recommended_pair.target_path, discoveryEvidence.recommended_pair.tool_path]
); assertions += 1;
assert.equal(discoveryEvidence.recommended_pair.authorized, false); assertions += 1;
assert.equal(discoveryEvidence.recommended_pair.exact_solid_overlap.verified, false); assertions += 1;

assert.equal(evidence.failure.error_code, 'MUTATION_EXECUTION_FAILED'); assertions += 1;
assert.equal(evidence.failure.phase, 'precommit_execution'); assertions += 1;
assert.equal(evidence.failure.outcome_unknown, false); assertions += 1;
assert.equal(evidence.failure.mutation_committed, false); assertions += 1;
assert.equal(evidence.failure.rollback_confirmed, true); assertions += 1;
assert.equal(evidence.failure.commit_state, 'not_committed'); assertions += 1;
assert.equal(evidence.failure.abort_succeeded, true); assertions += 1;
assert.equal(evidence.failure.durable_receipt_confirmed, false); assertions += 1;
assert.equal(evidence.failure.durable_receipt_present, false); assertions += 1;
assert.equal(evidence.failure.automatic_retry_performed, false); assertions += 1;
assert.equal(evidence.failure.automatic_replay_performed, false); assertions += 1;
assert.equal(evidence.failure.duplicate_mutation_observed, false); assertions += 1;
assert.equal(evidence.failure.exact_solid_overlap.verified, false); assertions += 1;

assert.equal(evidence.post_abort_model.document_id, prepareEvidence.model.document_id); assertions += 1;
assert.equal(evidence.post_abort_model.revision, prepareEvidence.model.revision); assertions += 1;
assert.equal(evidence.post_abort_model.revision, discoveryEvidence.model.revision); assertions += 1;
assert.equal(evidence.post_abort_model.revision_complete, true); assertions += 1;
assert.equal(evidence.post_abort_model.revision_indexed, 11474); assertions += 1;
assert.equal(evidence.post_abort_model.revision_total_seen, discoveryEvidence.model.revision_logical_occurrences); assertions += 1;
assert.equal(evidence.post_abort_model.revision_unique_entities, discoveryEvidence.model.revision_unique_entities); assertions += 1;
assert.equal(evidence.post_abort_model.revision_reachable_definitions, discoveryEvidence.model.revision_reachable_definitions); assertions += 1;
assert.equal(evidence.post_abort_model.recursive_total_seen, discoveryEvidence.structural_probe.recursive_total_seen); assertions += 1;
assert.equal(evidence.post_abort_model.top_level_groups, discoveryEvidence.structural_probe.top_level_groups_total_seen); assertions += 1;
assert.equal(evidence.post_abort_model.model_modified, false); assertions += 1;
assert.equal(evidence.post_abort_model.pair_baseline_unchanged, true); assertions += 1;
assert.equal(evidence.post_abort_model.target.manifold, true); assertions += 1;
assert.equal(evidence.post_abort_model.tool.manifold, true); assertions += 1;
assert.equal(evidence.post_abort_model.target.manifold_revision, evidence.post_abort_model.revision); assertions += 1;
assert.equal(evidence.post_abort_model.tool.manifold_revision, evidence.post_abort_model.revision); assertions += 1;

assert.equal(evidence.source.path, prepareEvidence.source.path); assertions += 1;
assert.equal(evidence.source.sha256_before, prepareEvidence.source.sha256_before); assertions += 1;
assert.equal(evidence.source.sha256_after, prepareEvidence.source.sha256_after); assertions += 1;
assert.equal(evidence.source.sha256_after, discoveryEvidence.source.sha256_after); assertions += 1;
assert.equal(evidence.source.bytes_unchanged, true); assertions += 1;
assert.equal(evidence.source.original_model_in_scope, false); assertions += 1;
assert.equal(evidence.source.source_overwritten, false); assertions += 1;

assert.equal(evidence.recovery.post_abort_readonly_check_completed, true); assertions += 1;
assert.deepEqual(evidence.recovery.queue_after_recovery, {
  queue: 0,
  processing: 0,
  responses: 0,
  lock_exists: false,
  evidence_mode: 'orchestrator_observation_not_bundled'
}); assertions += 1;
assert.equal(evidence.recovery.saved_result_copy_created, false); assertions += 1;
assert.equal(evidence.recovery.new_review_required_before_any_retry, true); assertions += 1;
assert.match(evidence.recovery.next_action, /Do not retry or replay this consumed task\.$/); assertions += 1;
assert.equal(evidence.release_acceptance, false); assertions += 1;

const publicText = JSON.stringify(evidence);
assert.doesNotMatch(publicText, /(?:^|["'])\/(?:Users|home|var|private|tmp)\//); assertions += 1;
assert.doesNotMatch(publicText, /[A-Za-z]:\\/); assertions += 1;
assert.equal(findSensitiveKeys(evidence).length, 0); assertions += 1;
for (const binding of [
  ...Object.values(evidence.artifact_bindings),
  ...Object.values(evidence.source_contract_bindings)
]) {
  assert.equal(isSafeRepoRelativePath(binding.path), true); assertions += 1;
  assert.match(binding.sha256, /^sha256:[0-9a-f]{64}$/); assertions += 1;
}
for (const binding of Object.values(evidence.artifact_bindings)) {
  assert.equal(binding.default_verifier_access, 'forbidden'); assertions += 1;
  assert.equal(binding.verification_mode, 'explicit_local_capture_only'); assertions += 1;
}

const invalidEvidence = [
  mutate(evidence, (value) => { value.result = 'success'; }),
  mutate(evidence, (value) => { value.workflow.task_state = 'completed'; }),
  mutate(evidence, (value) => { value.runtime_contract.boolean_operations_sha256 = `sha256:${'0'.repeat(64)}`; }),
  mutate(evidence, (value) => { value.runtime_contract.historical_exact_loaded_runtime = false; }),
  mutate(evidence, (value) => { value.approval.status_after_failure = 'approved'; }),
  mutate(evidence, (value) => { value.approval.approval_reusable = true; }),
  mutate(evidence, (value) => { value.approval.same_task_retry_allowed = true; }),
  mutate(evidence, (value) => { value.approval.previous_plan_or_approval_replay_allowed = true; }),
  mutate(evidence, (value) => { value.failure.outcome_unknown = true; }),
  mutate(evidence, (value) => { value.failure.mutation_committed = true; }),
  mutate(evidence, (value) => { value.failure.rollback_confirmed = false; }),
  mutate(evidence, (value) => { value.failure.commit_state = 'committed'; }),
  mutate(evidence, (value) => { value.failure.durable_receipt_present = true; }),
  mutate(evidence, (value) => { value.failure.automatic_retry_performed = true; }),
  mutate(evidence, (value) => { value.failure.automatic_replay_performed = true; }),
  mutate(evidence, (value) => { value.post_abort_model.revision_total_seen = 11473; }),
  mutate(evidence, (value) => { value.post_abort_model.pair_baseline_unchanged = false; }),
  mutate(evidence, (value) => { value.source.bytes_unchanged = false; }),
  mutate(evidence, (value) => { value.recovery.queue_after_recovery.lock_exists = true; }),
  mutate(evidence, (value) => { value.recovery.saved_result_copy_created = true; }),
  mutate(evidence, (value) => { value.release_acceptance = true; })
];
for (const invalid of invalidEvidence) {
  assert.equal(validate(invalid), false, 'unsafe or drifted failure evidence must fail schema validation'); assertions += 1;
}

let localCaptureAssertions = 0;
if (localCaptureMode) localCaptureAssertions = await verifyMachineLocalCapture(evidence, prepareEvidence, discoveryEvidence);

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: localCaptureMode ? 'explicit_machine_local_capture' : 'public_offline',
  assertions,
  public_files_read: [...new Set(publicReads)].sort(),
  machine_local_capture_files_read: localCaptureMode,
  machine_local_capture_artifacts_verified: localCaptureMode ? 5 : 0,
  source_bytes_verified: localCaptureMode,
  local_capture_assertions: localCaptureAssertions,
  task_state: evidence.workflow.task_state,
  approval_status: evidence.approval.status_after_failure,
  mutation_committed: false,
  rollback_confirmed: true,
  source_unchanged: true,
  pair_baseline_unchanged: true,
  historical_runtime_source_bound: true,
  queue_clean_observation_bundled: false,
  saved_result_copy_created: false,
  retry_or_replay_allowed: false,
  release_acceptance: false,
  negative_cases: invalidEvidence.length
}, null, 2)}\n`);

async function verifyMachineLocalCapture(publicEvidence, prepareContract, discoveryContract) {
  let localAssertions = 0;
  const raw = {};
  for (const [key, binding] of Object.entries(publicEvidence.artifact_bindings)) {
    const bytes = await readRegularRepoFile(binding.path);
    assert.equal(bytes.length, binding.size_bytes); localAssertions += 1;
    assert.equal(`sha256:${sha256(bytes)}`, binding.sha256); localAssertions += 1;
    raw[key] = JSON.parse(bytes.toString('utf8'));
  }

  const prepareBinding = prepareContract.artifact_bindings.prepare_capture;
  const prepareBytes = await readRegularRepoFile(prepareBinding.path);
  assert.equal(prepareBytes.length, prepareBinding.size_bytes); localAssertions += 1;
  assert.equal(`sha256:${sha256(prepareBytes)}`, prepareBinding.sha256); localAssertions += 1;
  const prepare = JSON.parse(prepareBytes.toString('utf8'));
  assert.equal(
    `sha256:${prepare.live_preflight.fresh_handshake.boolean_operations_sha256}`,
    publicEvidence.runtime_contract.boolean_operations_sha256
  ); localAssertions += 1;
  assert.equal(
    `sha256:${prepare.live_preflight.fresh_handshake.model_revision_source_sha256}`,
    publicEvidence.runtime_contract.model_revision_source_sha256
  ); localAssertions += 1;
  assert.equal(
    prepare.live_preflight.fresh_handshake.capability_version,
    publicEvidence.runtime_contract.capability_version
  ); localAssertions += 1;
  assert.equal(
    prepare.live_preflight.fresh_handshake.manifest_version,
    publicEvidence.runtime_contract.manifest_version
  ); localAssertions += 1;

  const discoveryStructuralBinding = discoveryContract.artifact_bindings.structural_adoption;
  const discoveryStructuralBytes = await readRegularRepoFile(discoveryStructuralBinding.path);
  assert.equal(`sha256:${sha256(discoveryStructuralBytes)}`, discoveryStructuralBinding.sha256); localAssertions += 1;
  const discoveryStructural = JSON.parse(discoveryStructuralBytes.toString('utf8'));

  const abort = raw.apply_precommit_abort;
  assert.equal(abort.version, publicEvidence.workflow.version); localAssertions += 1;
  assert.equal(abort.kind, 'portal_structure_s3_boolean_apply_precommit_abort'); localAssertions += 1;
  assert.equal(abort.recorded_at, '2026-07-21T07:05:11.279Z'); localAssertions += 1;
  assert.equal(abort.run_id, publicEvidence.workflow.run_id); localAssertions += 1;
  assert.equal(abort.task_id, publicEvidence.workflow.task_id); localAssertions += 1;
  assert.equal(abort.task_state, publicEvidence.workflow.task_state); localAssertions += 1;
  assert.equal(abort.outcome_unknown, publicEvidence.failure.outcome_unknown); localAssertions += 1;
  assert.equal(abort.mutation_committed, publicEvidence.failure.mutation_committed); localAssertions += 1;
  assert.equal(abort.rollback_confirmed, publicEvidence.failure.rollback_confirmed); localAssertions += 1;
  assert.equal(abort.evidence_conflict, publicEvidence.failure.evidence_conflict); localAssertions += 1;
  assert.equal(abort.commit_state, publicEvidence.failure.commit_state); localAssertions += 1;
  assert.equal(abort.abort_succeeded, publicEvidence.failure.abort_succeeded); localAssertions += 1;
  assert.equal(abort.durable_receipt_confirmed, publicEvidence.failure.durable_receipt_confirmed); localAssertions += 1;
  assert.equal(abort.durable_receipt, null); localAssertions += 1;
  assert.equal(abort.error.code, publicEvidence.failure.error_code); localAssertions += 1;
  assert.equal(abort.error.details.phase, publicEvidence.failure.phase); localAssertions += 1;
  assert.deepEqual(abort.exact_solid_overlap, publicEvidence.failure.exact_solid_overlap); localAssertions += 1;
  assert.equal(abort.automatic_retry_performed, false); localAssertions += 1;
  assert.equal(abort.failure_policy.automatic_replay, false); localAssertions += 1;
  assert.equal(abort.trusted_token_copied_to_evidence, false); localAssertions += 1;
  assert.equal(`sha256:${abort.source_sha256_before}`, publicEvidence.source.sha256_before); localAssertions += 1;
  assert.equal(`sha256:${abort.source_sha256_after}`, publicEvidence.source.sha256_after); localAssertions += 1;
  assert.equal(abort.source_file_unchanged, true); localAssertions += 1;

  const status = raw.status_after_failure;
  assert.equal(status.version, publicEvidence.workflow.version); localAssertions += 1;
  assert.equal(status.checked_at, publicEvidence.captured_at); localAssertions += 1;
  assert.equal(status.task_id, publicEvidence.workflow.task_id); localAssertions += 1;
  assert.equal(status.task_state, publicEvidence.workflow.task_state); localAssertions += 1;
  assert.equal(status.plan_id, publicEvidence.approval.plan_id); localAssertions += 1;
  assert.equal(status.plan_hash, publicEvidence.approval.plan_hash); localAssertions += 1;
  assert.equal(status.approval_status, publicEvidence.approval.status_after_failure); localAssertions += 1;
  assert.equal(status.approval_url, null); localAssertions += 1;
  assert.equal(status.trusted_token_copied_to_evidence, false); localAssertions += 1;
  assert.equal(status.queue_called, false); localAssertions += 1;
  assert.equal(`sha256:${status.source_sha256}`, publicEvidence.source.sha256_after); localAssertions += 1;
  assert.deepEqual(status.mutation_outcome, {
    outcome_unknown: false,
    mutation_committed: false,
    rollback_confirmed: true,
    evidence_conflict: false,
    commit_state: 'not_committed',
    abort_succeeded: true
  }); localAssertions += 1;
  assert.equal(status.next_action, 'inspect_failure_then_start_new_task'); localAssertions += 1;

  const adoption = raw.post_abort_readonly_adoption;
  assert.equal(adoption.kind, 'adopt_open_model'); localAssertions += 1;
  assert.equal(adoption.runtime, 'queue'); localAssertions += 1;
  assert.equal(adoption.read_only, true); localAssertions += 1;
  assert.equal(adoption.document_id, publicEvidence.post_abort_model.document_id); localAssertions += 1;
  assert.equal(adoption.model_revision, publicEvidence.post_abort_model.revision); localAssertions += 1;
  assert.equal(adoption.model_revision_strategy, publicEvidence.post_abort_model.revision_strategy); localAssertions += 1;
  assert.equal(adoption.model_revision_complete, true); localAssertions += 1;
  assert.equal(adoption.model_revision_indexed, publicEvidence.post_abort_model.revision_indexed); localAssertions += 1;
  assert.equal(adoption.model_revision_total_seen, publicEvidence.post_abort_model.revision_total_seen); localAssertions += 1;
  assert.equal(adoption.model_revision_unique_entities, publicEvidence.post_abort_model.revision_unique_entities); localAssertions += 1;
  assert.equal(adoption.model_revision_reachable_definitions, publicEvidence.post_abort_model.revision_reachable_definitions); localAssertions += 1;
  assert.equal(adoption.recursive_total_seen, publicEvidence.post_abort_model.recursive_total_seen); localAssertions += 1;
  assert.equal(adoption.recursive_truncated, false); localAssertions += 1;
  assert.equal(adoption.entity_count, publicEvidence.post_abort_model.top_level_groups); localAssertions += 1;
  assert.equal(adoption.model_modified, false); localAssertions += 1;
  assert.equal(adoption.model_info.model_modified, false); localAssertions += 1;

  const postAbortPair = pairBaselines(adoption);
  const discoveryPair = pairBaselines(discoveryStructural);
  assert.deepEqual(postAbortPair, discoveryPair); localAssertions += 1;
  assert.deepEqual(postAbortPair, {
    target: publicEvidence.post_abort_model.target,
    tool: publicEvidence.post_abort_model.tool
  }); localAssertions += 1;
  assert.deepEqual(preparePairBaselines(prepare), {
    target: withoutVolume(publicEvidence.post_abort_model.target),
    tool: withoutVolume(publicEvidence.post_abort_model.tool)
  }); localAssertions += 1;

  assert.equal(prepare.task_id, publicEvidence.workflow.task_id); localAssertions += 1;
  assert.equal(prepare.plan_id, publicEvidence.approval.plan_id); localAssertions += 1;
  assert.equal(prepare.plan_hash, publicEvidence.approval.plan_hash); localAssertions += 1;
  assert.deepEqual(prepare.operation, publicEvidence.operation); localAssertions += 1;
  assert.equal(prepare.model.revision, publicEvidence.post_abort_model.revision); localAssertions += 1;
  assert.equal(prepare.model.modified, false); localAssertions += 1;

  const sourceBytes = await readRegularRepoFile(publicEvidence.source.path);
  assert.equal(sourceBytes.length, publicEvidence.source.size_bytes); localAssertions += 1;
  assert.equal(`sha256:${sha256(sourceBytes)}`, publicEvidence.source.sha256_after); localAssertions += 1;

  const expectedResultPath = `output/real-model-reliability/boolean-live/portal-structure/${publicEvidence.workflow.run_id}/approved-model-${publicEvidence.approval.plan_id}.skp`;
  assert.equal(prepare.save.final_path, path.resolve(repoRoot, expectedResultPath)); localAssertions += 1;
  await assertPathDoesNotExist(expectedResultPath); localAssertions += 1;

  assertions += localAssertions;
  return localAssertions;
}

function pairBaselines(adoption) {
  const entries = adoption.structural_groups?.entries;
  assert.ok(Array.isArray(entries));
  return {
    target: normalizeAdoptionEntry(entries.find((entry) => entry.entity_path === 'pid:11543')),
    tool: normalizeAdoptionEntry(entries.find((entry) => entry.entity_path === 'pid:11635'))
  };
}

function normalizeAdoptionEntry(entry) {
  assert.ok(entry);
  const report = entry.manifold_attestation?.report;
  assert.ok(report);
  return {
    entity_path: entry.entity_path,
    faces: entry.faces,
    edges: entry.edges,
    vertices: entry.vertices,
    volume: report.volume,
    world_bounding_box: {
      min: entry.world_bounding_box.min,
      max: entry.world_bounding_box.max
    },
    manifold: entry.manifold_attestation.is_manifold,
    manifold_revision: entry.manifold_attestation.model_revision
  };
}

function preparePairBaselines(prepare) {
  return {
    target: normalizePrepareEntry(prepare.pair.target),
    tool: normalizePrepareEntry(prepare.pair.tool)
  };
}

function normalizePrepareEntry(entry) {
  return {
    entity_path: entry.entity_path,
    faces: entry.faces,
    edges: entry.edges,
    vertices: entry.vertices,
    world_bounding_box: {
      min: entry.world_bounding_box.min,
      max: entry.world_bounding_box.max
    },
    manifold: entry.manifold,
    manifold_revision: entry.manifold_revision
  };
}

function withoutVolume(entry) {
  const copy = structuredClone(entry);
  delete copy.volume;
  return copy;
}

async function readPublicJson(repoPath) {
  return JSON.parse((await readPublicBytes(repoPath)).toString('utf8'));
}

async function readPublicBytes(repoPath) {
  assert.equal(publicPaths.has(repoPath), true, `default verifier may only read public evidence/schema contracts: ${repoPath}`);
  publicReads.push(repoPath);
  return readRegularRepoFile(repoPath);
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

async function assertPathDoesNotExist(repoPath) {
  assert.equal(isSafeRepoRelativePath(repoPath), true, `unsafe repository path: ${repoPath}`);
  try {
    await fs.lstat(path.resolve(repoRoot, repoPath));
  } catch (error) {
    assert.equal(error?.code, 'ENOENT');
    return;
  }
  assert.fail(`unexpected saved result copy exists: ${repoPath}`);
}

function isSafeRepoRelativePath(repoPath) {
  if (typeof repoPath !== 'string' || repoPath.length === 0 || repoPath.includes('\\') || repoPath.includes('\u0000')
    || path.posix.isAbsolute(repoPath) || path.win32.isAbsolute(repoPath)) return false;
  const segments = repoPath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && path.posix.normalize(repoPath) === repoPath;
}

function findSensitiveKeys(value, pointer = '$', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:token|signature|nonce|session_contract|approval_url|secret)/i.test(key)) found.push(`${pointer}.${key}`);
    findSensitiveKeys(child, `${pointer}.${key}`, found);
  }
  return found;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
