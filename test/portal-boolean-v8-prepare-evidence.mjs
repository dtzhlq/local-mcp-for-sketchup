import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/portal-boolean-v8-prepare-2026-07-21.json';
const schemaPath = 'schema/portal-boolean-v8-prepare-evidence-v1.schema.json';
const discoveryEvidencePath = 'docs/evidence/portal-boolean-v8-readonly-discovery-2026-07-21.json';
const publicPaths = new Set([evidencePath, schemaPath, discoveryEvidencePath]);
const localCaptureMode = process.argv.includes('--local-capture');
const publicReads = [];
let assertions = 0;

const [evidence, schema, discoveryEvidence] = await Promise.all([
  readPublicJson(evidencePath),
  readPublicJson(schemaPath),
  readPublicJson(discoveryEvidencePath)
]);
const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;

assert.deepEqual([...new Set(publicReads)].sort(), [...publicPaths].sort()); assertions += 1;
assert.equal(publicReads.some((repoPath) => repoPath.startsWith('output/')), false); assertions += 1;

const discoveryContractBytes = await readPublicBytes(discoveryEvidencePath);
assert.equal(
  `sha256:${sha256(discoveryContractBytes)}`,
  evidence.source_contract_bindings.readonly_discovery_evidence.sha256
); assertions += 1;
assert.deepEqual(evidence.artifact_bindings.readonly_discovery, discoveryEvidence.artifact_bindings); assertions += 1;

assert.equal(evidence.result, 'awaiting_review'); assertions += 1;
assert.equal(evidence.workflow.task_state, 'awaiting_review'); assertions += 1;
assert.equal(evidence.workflow.risk_level, 'S3'); assertions += 1;
assert.equal(evidence.approval.state, 'awaiting_trusted_user'); assertions += 1;
assert.match(evidence.approval.task_id, /^task_[0-9a-f-]{36}$/); assertions += 1;
assert.match(evidence.approval.plan_id, /^existing-edit-[0-9a-f]{24}$/); assertions += 1;
assert.match(evidence.approval.challenge_id, /^approval_[0-9a-f-]{36}$/); assertions += 1;
assert.match(evidence.approval.plan_hash, /^sha256:[0-9a-f]{64}$/); assertions += 1;
assert.match(evidence.approval.review_context_sha256, /^sha256:[0-9a-f]{64}$/); assertions += 1;
assert.equal(Number.isNaN(Date.parse(evidence.approval.expires_at)), false); assertions += 1;
assert.equal(evidence.approval.previous_approval_applicable, false); assertions += 1;
assert.equal(evidence.approval.previous_plan_or_approval_replay_allowed, false); assertions += 1;
assert.equal(evidence.approval.agent_self_approval_accepted, false); assertions += 1;
assert.equal(evidence.approval.mutation_authorized, false); assertions += 1;
assert.equal(evidence.approval.private_approval_material_exposed, false); assertions += 1;

assert.deepEqual([evidence.operation.target_path, ...evidence.operation.tool_paths], ['pid:11543', 'pid:11635']); assertions += 1;
assert.equal(evidence.geometry_validation.exact_solid_overlap.verified, false); assertions += 1;
assert.equal(evidence.geometry_validation.failure_disposition, 'abort_before_commit'); assertions += 1;
assert.equal(evidence.source.sha256_before, evidence.source.sha256_after); assertions += 1;
assert.equal(evidence.source.bytes_unchanged, true); assertions += 1;
assert.equal(evidence.source.original_model_in_scope, false); assertions += 1;
assert.equal(evidence.model.modified, false); assertions += 1;
assert.equal(evidence.safety.model_content_mutation_requested, false); assertions += 1;
assert.equal(evidence.safety.model_content_mutation_performed, false); assertions += 1;
assert.equal(evidence.safety.save_requested, false); assertions += 1;
assert.equal(evidence.safety.output_write_performed, false); assertions += 1;
assert.deepEqual(evidence.safety.queue_before, cleanQueue()); assertions += 1;
assert.deepEqual(evidence.safety.queue_after, cleanQueue()); assertions += 1;
assert.equal(evidence.release_acceptance, false); assertions += 1;

const publicText = JSON.stringify(evidence);
assert.doesNotMatch(publicText, /(?:^|["'])\/(?:Users|home|var|private|tmp)\//); assertions += 1;
assert.doesNotMatch(publicText, /[A-Za-z]:\\/); assertions += 1;
assert.equal(findSensitiveKeys(evidence).length, 0); assertions += 1;
for (const binding of [
  evidence.artifact_bindings.prepare_capture,
  ...Object.values(evidence.artifact_bindings.readonly_discovery),
  ...Object.values(evidence.source_contract_bindings)
]) {
  assert.equal(isSafeRepoRelativePath(binding.path), true); assertions += 1;
  assert.match(binding.sha256, /^sha256:[0-9a-f]{64}$/); assertions += 1;
}
assert.equal(evidence.artifact_bindings.prepare_capture.default_verifier_access, 'forbidden'); assertions += 1;
assert.equal(evidence.artifact_bindings.prepare_capture.verification_mode, 'explicit_local_capture_only'); assertions += 1;

const invalidEvidence = [
  mutate(evidence, (value) => { value.result = 'approved'; }),
  mutate(evidence, (value) => { value.workflow.risk_level = 'S1'; }),
  mutate(evidence, (value) => { value.approval.previous_approval_applicable = true; }),
  mutate(evidence, (value) => { value.approval.previous_plan_or_approval_replay_allowed = true; }),
  mutate(evidence, (value) => { value.approval.agent_self_approval_accepted = true; }),
  mutate(evidence, (value) => { value.approval.mutation_authorized = true; }),
  mutate(evidence, (value) => { value.operation.tool_paths = ['pid:14632']; }),
  mutate(evidence, (value) => { value.source.bytes_unchanged = false; }),
  mutate(evidence, (value) => { value.model.modified = true; }),
  mutate(evidence, (value) => { value.safety.model_content_mutation_performed = true; }),
  mutate(evidence, (value) => { value.safety.save_requested = true; }),
  mutate(evidence, (value) => { value.safety.queue_after.lock_exists = true; }),
  mutate(evidence, (value) => { value.release_acceptance = true; })
];
for (const invalid of invalidEvidence) {
  assert.equal(validate(invalid), false, 'unsafe or drifted prepare evidence must fail schema validation'); assertions += 1;
}

let localCaptureAssertions = 0;
if (localCaptureMode) localCaptureAssertions = await verifyMachineLocalCapture(evidence);

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: localCaptureMode ? 'explicit_machine_local_capture' : 'public_offline',
  assertions,
  public_files_read: [...new Set(publicReads)].sort(),
  machine_local_capture_files_read: localCaptureMode,
  machine_local_capture_artifacts_verified: localCaptureMode ? 6 : 0,
  local_capture_assertions: localCaptureAssertions,
  raw_prepare_sha256_bound: evidence.artifact_bindings.prepare_capture.sha256,
  readonly_discovery_artifact_bindings: Object.keys(evidence.artifact_bindings.readonly_discovery).length,
  task_state: evidence.workflow.task_state,
  risk_level: evidence.workflow.risk_level,
  pinned_pair: [evidence.operation.target_path, ...evidence.operation.tool_paths],
  previous_approval_applicable: false,
  mutation_authorized: false,
  source_unchanged: true,
  queue_clean: true,
  release_acceptance: false,
  negative_cases: invalidEvidence.length
}, null, 2)}\n`);

async function verifyMachineLocalCapture(publicEvidence) {
  let localAssertions = 0;
  const prepareBinding = publicEvidence.artifact_bindings.prepare_capture;
  const prepareBytes = await readRegularRepoFile(prepareBinding.path);
  assert.equal(prepareBytes.length, prepareBinding.size_bytes); localAssertions += 1;
  assert.equal(`sha256:${sha256(prepareBytes)}`, prepareBinding.sha256); localAssertions += 1;
  const prepare = JSON.parse(prepareBytes.toString('utf8'));

  for (const binding of Object.values(publicEvidence.artifact_bindings.readonly_discovery)) {
    const bytes = await readRegularRepoFile(binding.path);
    assert.equal(`sha256:${sha256(bytes)}`, binding.sha256); localAssertions += 1;
  }

  assert.equal(prepare.version, publicEvidence.workflow.version); localAssertions += 1;
  assert.equal(prepare.kind, publicEvidence.workflow.kind); localAssertions += 1;
  assert.equal(prepare.prepared_at, publicEvidence.captured_at); localAssertions += 1;
  assert.equal(prepare.run_id, publicEvidence.workflow.run_id); localAssertions += 1;
  assert.equal(prepare.runtime, publicEvidence.workflow.runtime); localAssertions += 1;
  assert.equal(prepare.task_state, publicEvidence.workflow.task_state); localAssertions += 1;
  assert.equal(prepare.risk_level, publicEvidence.workflow.risk_level); localAssertions += 1;
  assert.equal(prepare.task_id, publicEvidence.approval.task_id); localAssertions += 1;
  assert.equal(prepare.plan_id, publicEvidence.approval.plan_id); localAssertions += 1;
  assert.equal(prepare.plan_hash, publicEvidence.approval.plan_hash); localAssertions += 1;
  assert.equal(prepare.approval.challenge_id, publicEvidence.approval.challenge_id); localAssertions += 1;
  assert.equal(prepare.approval.review_context_sha256, publicEvidence.approval.review_context_sha256); localAssertions += 1;
  assert.equal(prepare.approval.expires_at, publicEvidence.approval.expires_at); localAssertions += 1;
  assert.equal(prepare.approval.state, publicEvidence.approval.state); localAssertions += 1;
  assert.equal(prepare.approval.agent_self_approval_accepted, false); localAssertions += 1;
  assert.equal(prepare.approval.trusted_token_copied_to_evidence, false); localAssertions += 1;

  assert.deepEqual(prepare.operation, publicEvidence.operation); localAssertions += 1;
  assert.deepEqual([prepare.pair.target.entity_path, prepare.pair.tool.entity_path], ['pid:11543', 'pid:11635']); localAssertions += 1;
  assert.equal(prepare.pair.target.manifold, true); localAssertions += 1;
  assert.equal(prepare.pair.tool.manifold, true); localAssertions += 1;
  assert.equal(prepare.pair.target.manifold_revision, publicEvidence.model.revision); localAssertions += 1;
  assert.equal(prepare.pair.tool.manifold_revision, publicEvidence.model.revision); localAssertions += 1;
  assert.deepEqual(prepare.geometry_validation.exact_solid_overlap, publicEvidence.geometry_validation.exact_solid_overlap); localAssertions += 1;
  assert.equal(prepare.geometry_validation.failure_disposition, 'abort_before_commit'); localAssertions += 1;

  assert.equal(prepare.source.path, path.resolve(repoRoot, publicEvidence.source.path)); localAssertions += 1;
  assert.equal(`sha256:${prepare.source.sha256_before}`, publicEvidence.source.sha256_before); localAssertions += 1;
  assert.equal(`sha256:${prepare.source.sha256_after}`, publicEvidence.source.sha256_after); localAssertions += 1;
  assert.equal(prepare.source.file_unchanged, true); localAssertions += 1;
  assert.equal(prepare.source.disposable_copy_only, true); localAssertions += 1;
  const sourceBytes = await readRegularRepoFile(publicEvidence.source.path);
  assert.equal(`sha256:${sha256(sourceBytes)}`, publicEvidence.source.sha256_after); localAssertions += 1;

  assert.equal(prepare.model.document_id, publicEvidence.model.document_id); localAssertions += 1;
  assert.equal(prepare.model.revision, publicEvidence.model.revision); localAssertions += 1;
  assert.equal(prepare.model.revision_strategy, publicEvidence.model.revision_strategy); localAssertions += 1;
  assert.equal(prepare.model.revision_complete, true); localAssertions += 1;
  assert.equal(prepare.model.modified, false); localAssertions += 1;
  assert.deepEqual(prepare.live_preflight.queue_before, cleanQueue()); localAssertions += 1;
  assert.deepEqual(prepare.live_preflight.queue_after, cleanQueue()); localAssertions += 1;
  assert.equal(prepare.live_mutation_performed, false); localAssertions += 1;
  assert.equal(prepare.save.overwrites_source, false); localAssertions += 1;
  assert.equal(prepare.save.overwrite_existing, false); localAssertions += 1;
  assert.equal(prepare.save.save_copy_required, true); localAssertions += 1;
  assert.equal(prepare.release_acceptance, false); localAssertions += 1;

  const captureBindingMap = {
    capabilities: 'capabilities',
    queue_before: 'queue_before',
    structural_adoption: 'structural',
    recursive_review: 'review',
    queue_after: 'queue_after'
  };
  for (const [publicKey, captureKey] of Object.entries(captureBindingMap)) {
    const capture = prepare.live_preflight.current_discovery_evidence[captureKey];
    const binding = publicEvidence.artifact_bindings.readonly_discovery[publicKey];
    assert.equal(capture.path, path.resolve(repoRoot, binding.path)); localAssertions += 1;
    assert.equal(`sha256:${capture.sha256}`, binding.sha256); localAssertions += 1;
  }
  assert.equal(prepare.live_preflight.current_discovery_evidence.prior_plan_or_approval_replay_allowed, false); localAssertions += 1;
  assert.equal(prepare.live_preflight.historical_workflow_lineage.prior_plan_or_approval_replay_allowed, false); localAssertions += 1;

  assertions += localAssertions;
  return localAssertions;
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

function cleanQueue() {
  return { queue: 0, processing: 0, responses: 0, lock_exists: false };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}
