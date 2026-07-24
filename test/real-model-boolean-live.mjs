import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PORTAL_BOOLEAN_BINDING,
  PORTAL_BOOLEAN_CURRENT_RUNTIME,
  PORTAL_BOOLEAN_EXECUTION_POLICY,
  PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE,
  PORTAL_BOOLEAN_LIVE_VERSION,
  PORTAL_BOOLEAN_RECURSIVE_POLICY,
  applyWorkflow,
  assertApplyRecordBinding,
  assertArtifactHash,
  assertExplicitLiveOptIn,
  assertInstalledBooleanSource,
  assertLivePortalBinding,
  assertNoSensitiveEvidence,
  assertNoPublicApprovalToken,
  assertPinnedPortalReview,
  assertPinnedStructuralEvidence,
  assertPortalAuthorizationReady,
  assertPortalFailedTaskBinding,
  assertPortalRecursiveIndexCapacity,
  assertPortalSaveTargetAvailable,
  assertPortalTaskBinding,
  assertPreparedTask,
  assertQueueIdle,
  assertReopenSessionBinding,
  assertRunRecordBinding,
  buildPrepareFailureEvidence,
  buildOutcomeUnknownEvidence,
  buildPortalBooleanTaskInputs,
  classifyApplyAttempt,
  classifyTaskMutationOutcome,
  main,
  portalIdempotencyKey,
  portalPrepareReuseDisposition,
  sanitizeForEvidence,
  summarizeQueue,
  verifyReopenWorkflow,
  writeTerminalStatusSnapshot
} from '../scripts/run-real-model-boolean-live.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { versionedModelSavePath } from '../src/existing-model-editing.mjs';
import { projectRoot } from '../src/paths.mjs';

let assertions = 0;
let liveQueueCalls = 0;
const CURRENT_REVISION = `sha256:${'7'.repeat(64)}`;

const historicalWitnessPaths = [
  path.join(projectRoot, 'test', 'fixtures', 'portal-boolean-live-witness.v1.json'),
  path.join(projectRoot, 'test', 'fixtures', 'portal-boolean-live-witness.v2.json')
];
const historicalWitnessHashes = [
  '0509df8c2361a1a4b5812afa67afbd089539a18675757c68ae2f82f9f91a5c3a',
  'd6ba9efd9352bb57543c83da8c34c6ee76061ba494b6bcad2af070fd4b151536'
];
for (const [index, historicalPath] of historicalWitnessPaths.entries()) {
  const bytes = await fs.readFile(historicalPath);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), historicalWitnessHashes[index]); assertions += 1;
}

const witnessPath = path.join(projectRoot, 'test', 'fixtures', 'portal-boolean-live-witness.v3.json');
const witness = JSON.parse(await fs.readFile(witnessPath, 'utf8'));
assert.doesNotThrow(() => assertPortablePortalWitness(witness)); assertions += 1;
assert.equal(witness.review_lineage.recommendation, 'server_recommended'); assertions += 1;
assert.equal(witness.review_lineage.review_version, 'real-model-recursive-target-review.v2'); assertions += 1;
assert.equal(witness.review_lineage.exact_solid_overlap.verified, false); assertions += 1;
assert.equal(witness.review_lineage.bbox_relation, 'containment'); assertions += 1;
assert.equal(witness.review_lineage.atomic_boolean_trial_eligible, true); assertions += 1;
assert.deepEqual(witness.approval_disclosure, PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE); assertions += 1;
assert.equal(witness.operation_contract.target_path, PORTAL_BOOLEAN_BINDING.target_path); assertions += 1;
assert.equal(witness.operation_contract.tool_path, PORTAL_BOOLEAN_BINDING.tool_path); assertions += 1;
assert.equal(witness.operation_contract.result_id, 'portal-structure-s3-boolean-result-v8'); assertions += 1;
assert.equal(witness.operation_contract.result_name, 'Portal_S3_Boolean_Result_v8'); assertions += 1;
assert.equal(witness.review_lineage.primary_review, 'readonly_probe_capability7_recursive_review_v2'); assertions += 1;
assert.deepEqual(witness.workflow_contract.historical_witnesses, [
  { version: 'portal-structure-s3-boolean-witness.v1', lineage_only: true, approval_reusable: false, task_reusable: false },
  { version: 'portal-structure-s3-boolean-witness.v2', lineage_only: true, approval_reusable: false, task_reusable: false }
]); assertions += 1;

const negativeWitnesses = [
  mutate(witness, (value) => { value.operation_contract.tool_path = 'pid:999'; }),
  mutate(witness, (value) => { value.source_binding.model_revision = `sha256:${'0'.repeat(64)}`; }),
  mutate(witness, (value) => { value.review_lineage.tool_fresh_manifold = false; }),
  mutate(witness, (value) => { value.review_lineage.exact_solid_overlap.verified = true; }),
  mutate(witness, (value) => { value.review_lineage.bbox_relation = 'disjoint'; }),
  mutate(witness, (value) => { value.review_lineage.atomic_boolean_trial_eligible = false; }),
  mutate(witness, (value) => { value.capture_hash_bindings.primary_review_capture = `sha256:${'f'.repeat(64)}`; }),
  mutate(witness, (value) => { value.capture_hash_bindings.structural_capture = `sha256:${'e'.repeat(64)}`; }),
  mutate(witness, (value) => { value.nested = { signature: 'hmac_sha256:private' }; }),
  mutate(witness, (value) => { value.nested = { session_id: 'private' }; }),
  mutate(witness, (value) => { value.nested = { token: 'private' }; }),
  mutate(witness, (value) => { value.nested = { secret: 'private' }; }),
  mutate(witness, (value) => { value.nested = { capture_path: '/Users/example/private.json' }; }),
  mutate(witness, (value) => { value.nested = { capture_path: 'C:\\Users\\example\\private.json' }; }),
  mutate(witness, (value) => { value.nested = { capture_path: '\\\\server\\share\\private.json' }; })
];
for (const invalid of negativeWitnesses) {
  assert.throws(() => assertPortablePortalWitness(invalid)); assertions += 1;
}

assert.throws(() => assertArtifactHash('review', 'a', 'b'), /artifact hash drifted/); assertions += 1;

assert.throws(
  () => assertExplicitLiveOptIn({ runtime: 'mock' }),
  /No queue request was created/
); assertions += 1;
assert.throws(
  () => assertExplicitLiveOptIn({ runtime: 'queue', queueRequired: true, disposableCopyConfirmed: true }, { requireActiveSavedCopy: true }),
  /active-saved-copy-confirmed.*No queue request was created/
); assertions += 1;
assert.doesNotThrow(() => assertExplicitLiveOptIn({ runtime: 'queue', queueRequired: true, disposableCopyConfirmed: true })); assertions += 1;

const importOnlyBridge = new Proxy({}, {
  get() {
    liveQueueCalls += 1;
    throw new Error('No bridge method should be reached without explicit live opt-in.');
  }
});
await assert.rejects(
  main(['prepare'], { bridge: importOnlyBridge, stdout: { write() {} }, stderr: { write() {} } }),
  /No queue request was created/
); assertions += 1;
assert.equal(liveQueueCalls, 0); assertions += 1;

const runDir = path.join(projectRoot, 'output', 'real-model-reliability', 'boolean-live', 'portal-structure', 'fixture-run');
const inputs = buildPortalBooleanTaskInputs(runDir);
assert.equal(PORTAL_BOOLEAN_LIVE_VERSION, 'portal-structure-s3-boolean-live.v8'); assertions += 1;
assert.deepEqual(PORTAL_BOOLEAN_RECURSIVE_POLICY, {
  observed_complete_entity_count: 11_474,
  recursive_limit: 20_000,
  max_recursive_entities: 20_000,
  baseline_headroom_entities: 8_526
}); assertions += 1;
assert.equal(PORTAL_BOOLEAN_EXECUTION_POLICY.resource_limits.max_recursive_entities, 20_000); assertions += 1;
assert.equal(inputs.recursive_limit, 20_000); assertions += 1;
assert.equal(inputs.budgets.recursive_limit, 20_000); assertions += 1;
assert.deepEqual(assertPortalRecursiveIndexCapacity(11_474), {
  total_seen: 11_474,
  recursive_limit: 20_000,
  headroom_entities: 8_526,
  within_trusted_policy: true
}); assertions += 1;
assert.doesNotThrow(() => assertPortalRecursiveIndexCapacity(20_000)); assertions += 1;
assert.throws(() => assertPortalRecursiveIndexCapacity(20_001), /exceeds the trusted 20000-entity workflow limit/); assertions += 1;
assert.equal(portalPrepareReuseDisposition({ kind: 'portal_structure_s3_boolean_prepare', version: PORTAL_BOOLEAN_LIVE_VERSION }), 'current'); assertions += 1;
for (let version = 1; version <= 7; version += 1) {
  assert.equal(
    portalPrepareReuseDisposition({ kind: 'portal_structure_s3_boolean_prepare', version: `portal-structure-s3-boolean-live.v${version}` }),
    'superseded'
  ); assertions += 1;
}
assert.equal(portalPrepareReuseDisposition({ kind: 'portal_structure_s3_boolean_prepare', version: 'portal-structure-s3-boolean-live.v9' }), 'invalid'); assertions += 1;
assert.equal(portalPrepareReuseDisposition({ kind: 'other', version: PORTAL_BOOLEAN_LIVE_VERSION }), 'invalid'); assertions += 1;
assert.equal(
  portalIdempotencyKey('prepare', CURRENT_REVISION),
  `${PORTAL_BOOLEAN_LIVE_VERSION}:prepare:${PORTAL_BOOLEAN_BINDING.source_sha256}:${PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy}:${CURRENT_REVISION}`
); assertions += 1;
assert.deepEqual(inputs.targets.map((target) => target.entity_path), [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path]); assertions += 1;
assert.deepEqual([PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path], ['pid:11543', 'pid:11635']); assertions += 1;
assert.equal(PORTAL_BOOLEAN_BINDING.artifacts.review.sha256, '2339a9876535abc903377e78e5a85488d3cc562ee72fbd83960c75698d809955'); assertions += 1;
assert.equal(PORTAL_BOOLEAN_BINDING.artifacts.structural.sha256, 'c0050321bf08b6ad6d74dc1536a5eaab5ccdc8c65a6db19bdf0f013908040837'); assertions += 1;
assert.throws(
  () => assertArtifactHash('review', `0${PORTAL_BOOLEAN_BINDING.artifacts.review.sha256.slice(1)}`, PORTAL_BOOLEAN_BINDING.artifacts.review.sha256),
  /Pinned review artifact hash drifted/
); assertions += 1;
assert.throws(
  () => assertArtifactHash('structural', `0${PORTAL_BOOLEAN_BINDING.artifacts.structural.sha256.slice(1)}`, PORTAL_BOOLEAN_BINDING.artifacts.structural.sha256),
  /Pinned structural artifact hash drifted/
); assertions += 1;
assert.equal(inputs.operations.length, 1); assertions += 1;
assert.equal(inputs.operations[0].op, 'boolean_difference'); assertions += 1;
assert.equal(inputs.operations[0].keep_originals, true); assertions += 1;
assert.equal(inputs.operations[0].keep_tools, true); assertions += 1;
assert.equal(inputs.capture_view, false); assertions += 1;
assert.equal(inputs.save_model, true); assertions += 1;
assert.notEqual(path.resolve(inputs.save_path), path.resolve(PORTAL_BOOLEAN_BINDING.source_path)); assertions += 1;

const currentProcessDocumentId = `document_${'1'.repeat(64)}`;
const liveBindingFixture = createLivePortalBindingFixture(currentProcessDocumentId);
assert.notEqual(currentProcessDocumentId, PORTAL_BOOLEAN_BINDING.document_id, 'fixture must exercise a legitimate cross-restart document id change'); assertions += 1;
assert.doesNotThrow(() => assertLivePortalBinding(liveBindingFixture)); assertions += 1;
const liveDocumentDrift = structuredClone(liveBindingFixture);
liveDocumentDrift.adoption.document_id = `document_${'2'.repeat(64)}`;
assert.throws(() => assertLivePortalBinding(liveDocumentDrift), /adoption document differs/); assertions += 1;
const liveSessionDrift = structuredClone(liveBindingFixture);
liveSessionDrift.adoption.session_id = 'session-other';
assert.throws(() => assertLivePortalBinding(liveSessionDrift), /adoption session differs/); assertions += 1;
const missingLiveDocument = structuredClone(liveBindingFixture);
missingLiveDocument.handshake.session_contract.document_id = '';
assert.throws(() => assertLivePortalBinding(missingLiveDocument), /document binding is missing/); assertions += 1;
const liveHandshakeSourceDrift = structuredClone(liveBindingFixture);
liveHandshakeSourceDrift.handshake.session_contract.model_identity.source_path = '/fixture/other.skp';
assert.throws(() => assertLivePortalBinding(liveHandshakeSourceDrift), /active source_path/); assertions += 1;
const liveAdoptionSourceDrift = structuredClone(liveBindingFixture);
liveAdoptionSourceDrift.adoption.model_info.source_path = '/fixture/other.skp';
assert.throws(() => assertLivePortalBinding(liveAdoptionSourceDrift), /adoption source_path/); assertions += 1;
const liveRevisionDrift = structuredClone(liveBindingFixture);
liveRevisionDrift.handshake.session_contract.model_revision = `sha256:${'4'.repeat(64)}`;
assert.throws(() => assertLivePortalBinding(liveRevisionDrift), /revision drifted/); assertions += 1;
const liveIncompleteRevision = structuredClone(liveBindingFixture);
liveIncompleteRevision.adoption.model_revision_complete = false;
assert.throws(() => assertLivePortalBinding(liveIncompleteRevision), /revision is incomplete/); assertions += 1;
const liveLegacyStrategy = structuredClone(liveBindingFixture);
liveLegacyStrategy.capabilities.runtime.model_revision.strategy = 'definition-merkle.v1';
assert.throws(() => assertLivePortalBinding(liveLegacyStrategy), /strategy is not definition-merkle\.v2/); assertions += 1;
const liveRevisionSourceDrift = structuredClone(liveBindingFixture);
liveRevisionSourceDrift.handshake.session_contract.model_revision_source_sha256 = '0'.repeat(64);
assert.throws(() => assertLivePortalBinding(liveRevisionSourceDrift), /Model Revision source attestation drifted/); assertions += 1;
const liveUnsavedModel = structuredClone(liveBindingFixture);
liveUnsavedModel.handshake.session_contract.model_modified = true;
assert.throws(() => assertLivePortalBinding(liveUnsavedModel), /requires a clean saved disposable copy/); assertions += 1;
const liveUnsavedAdoption = structuredClone(liveBindingFixture);
liveUnsavedAdoption.adoption.model_modified = true;
assert.throws(() => assertLivePortalBinding(liveUnsavedAdoption), /adoption reports unsaved model changes/); assertions += 1;

const pinnedStructuralFixture = createLivePortalBindingFixture(
  PORTAL_BOOLEAN_BINDING.document_id,
  PORTAL_BOOLEAN_BINDING.model_revision
).adoption;
assert.doesNotThrow(() => assertPinnedStructuralEvidence(pinnedStructuralFixture)); assertions += 1;
const pinnedReviewFixture = createPinnedPortalReviewFixture();
assert.doesNotThrow(() => assertPinnedPortalReview(pinnedReviewFixture)); assertions += 1;
const reviewSemanticTampering = [
  mutate(pinnedReviewFixture, (value) => { value.review.recommended_proposal.exact_solid_overlap.verified = true; }),
  mutate(pinnedReviewFixture, (value) => { value.review.recommended_proposal.bbox_relation = 'disjoint'; }),
  mutate(pinnedReviewFixture, (value) => { value.review.recommended_proposal.atomic_boolean_trial_eligible = false; }),
  mutate(pinnedReviewFixture, (value) => { value.review.recommended_proposal.target.manifold_attestation.is_manifold = false; }),
  mutate(pinnedReviewFixture, (value) => { value.review.recommended_proposal.tool.entity_path = 'pid:14632'; }),
  mutate(pinnedReviewFixture, (value) => { value.model.revision = `sha256:${'6'.repeat(64)}`; })
];
const reviewTamperQueueCallsBefore = liveQueueCalls;
for (const tamperedReview of reviewSemanticTampering) {
  assert.throws(() => assertPinnedPortalReview(tamperedReview)); assertions += 1;
}
assert.equal(liveQueueCalls, reviewTamperQueueCallsBefore, 'tampered pinned v2 review must fail without any queue call'); assertions += 1;

const preparedTask = {
  ok: true,
  task_id: 'task_11111111-1111-4111-8111-111111111111',
  task_state: 'awaiting_review',
  result: {
    kind: 'reviewed_existing_model_edit_proposal',
    plan_id: 'existing-edit-fixture',
    plan_hash: `sha256:${'a'.repeat(64)}`,
    model_revision: CURRENT_REVISION,
    risk_level: 'S3',
    operation_count: 1,
    blockers: [],
    approval_challenge: {
      kind: 'approval_challenge',
      challenge_id: 'approval_fixture',
      task_id: 'task_11111111-1111-4111-8111-111111111111',
      plan_id: 'existing-edit-fixture',
      plan_hash: `sha256:${'a'.repeat(64)}`,
      model_revision: CURRENT_REVISION,
      risk_level: PORTAL_BOOLEAN_BINDING.risk_level,
      allowed_operations: [PORTAL_BOOLEAN_BINDING.operation],
      review_context_hash: null,
      status: 'awaiting_trusted_user',
      issued_at: '2099-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:15:00.000Z',
      review_context: {
        kind: 'existing_model_edit_review_context',
        content_trust: 'untrusted_data',
        policy_effect: 'none',
        geometry_validation: structuredClone(PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE),
        affected_instance_count: 2,
        targets: [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path].map((entityPath) => ({
          entity_path: entityPath,
          edit_scope: 'instance_path',
          instance_policy: 'definition_wide',
          affected_instance_count: 1,
          shared_definition: false
        })),
        operations: [{
          op: PORTAL_BOOLEAN_BINDING.operation,
          target: PORTAL_BOOLEAN_BINDING.target_path,
          tools: [PORTAL_BOOLEAN_BINDING.tool_path],
          result_id: PORTAL_BOOLEAN_BINDING.result_id,
          result_name: PORTAL_BOOLEAN_BINDING.result_name,
          keep_originals: true,
          keep_tools: true
        }],
        execution: {
          save_model: true,
          save_path: inputs.save_path,
          final_save_path: versionedModelSavePath(inputs.save_path, 'existing-edit-fixture'),
          overwrite_existing: false,
          capture_view: false
        }
      }
    }
  },
  next_action: {
    action: 'request_user_approval',
      approval_host: {
        url: 'http://127.0.0.1:3978/approvals/approval_fixture',
        user_presence_required: true
      }
  }
};
preparedTask.result.approval_challenge.review_context_hash = sha256Canonical(
  preparedTask.result.approval_challenge.review_context
);
assert.doesNotThrow(() => assertPreparedTask(preparedTask, { expectedRevision: CURRENT_REVISION })); assertions += 1;
assert.doesNotThrow(() => assertNoPublicApprovalToken(preparedTask)); assertions += 1;
assert.deepEqual(preparedTask.result.approval_challenge.review_context.geometry_validation, PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE); assertions += 1;
const geometryDisclosureDrift = structuredClone(preparedTask);
geometryDisclosureDrift.result.approval_challenge.review_context.geometry_validation.exact_solid_overlap.verified = true;
geometryDisclosureDrift.result.approval_challenge.review_context_hash = sha256Canonical(
  geometryDisclosureDrift.result.approval_challenge.review_context
);
assert.throws(() => assertPreparedTask(geometryDisclosureDrift, { expectedRevision: CURRENT_REVISION }), /AABB-only evidence.*atomic-trial disclosure/); assertions += 1;
const tokenLeak = structuredClone(preparedTask);
tokenLeak.next_action.approval_token = 'forged-agent-visible-token';
assert.throws(() => assertPreparedTask(tokenLeak, { expectedRevision: CURRENT_REVISION }), /exposed an approval token/); assertions += 1;
const executionDrift = structuredClone(preparedTask);
executionDrift.result.approval_challenge.review_context.execution.save_path = PORTAL_BOOLEAN_BINDING.source_path;
executionDrift.result.approval_challenge.review_context_hash = sha256Canonical(
  executionDrift.result.approval_challenge.review_context
);
assert.throws(() => assertPreparedTask(executionDrift, { expectedRevision: CURRENT_REVISION }), /save_path aliases the source/); assertions += 1;

const preparedContext = preparedTask.result.approval_challenge.review_context;
const latestFixture = { version: PORTAL_BOOLEAN_LIVE_VERSION, run_id: 'fixture-run', run_dir: runDir, task_id: preparedTask.task_id };
const prepareRecord = {
  version: PORTAL_BOOLEAN_LIVE_VERSION,
  kind: 'portal_structure_s3_boolean_prepare',
  run_id: latestFixture.run_id,
  task_id: preparedTask.task_id,
  task_state: 'awaiting_review',
  runtime: 'queue',
  risk_level: 'S3',
  plan_id: preparedTask.result.plan_id,
  plan_hash: preparedTask.result.plan_hash,
  source: {
    path: PORTAL_BOOLEAN_BINDING.source_path,
    sha256_before: PORTAL_BOOLEAN_BINDING.source_sha256,
    sha256_after: PORTAL_BOOLEAN_BINDING.source_sha256,
    file_unchanged: true,
    disposable_copy_only: true
  },
  model: {
    document_id: currentProcessDocumentId,
    revision: CURRENT_REVISION,
    revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
    revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
    revision_complete: true,
    modified: false
  },
  operation: {
    op: PORTAL_BOOLEAN_BINDING.operation,
    target_path: PORTAL_BOOLEAN_BINDING.target_path,
    tool_paths: [PORTAL_BOOLEAN_BINDING.tool_path],
    result_id: PORTAL_BOOLEAN_BINDING.result_id,
    result_name: PORTAL_BOOLEAN_BINDING.result_name,
    keep_originals: true,
    keep_tools: true,
    risk_level: 'S3'
  },
  geometry_validation: structuredClone(PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE),
  save: {
    requested_base_path: inputs.save_path,
    final_path: preparedContext.execution.final_save_path,
    final_path_matches_versioned_plan: true,
    overwrite_existing: false,
    overwrites_source: false,
    save_copy_required: true
  },
  approval: {
    challenge_id: preparedTask.result.approval_challenge.challenge_id,
    review_context_sha256: sha256Canonical(preparedContext),
    expires_at: preparedTask.result.approval_challenge.expires_at,
    url: preparedTask.next_action.approval_host.url,
    state: 'awaiting_trusted_user',
    trusted_token_copied_to_evidence: false,
    agent_self_approval_accepted: false
  },
  live_preflight: {
    recursive_index_policy: {
      mode: 'complete_recursive_index',
      preflight_observed_entity_count: PORTAL_BOOLEAN_RECURSIVE_POLICY.observed_complete_entity_count,
      requested_recursive_limit: PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit,
      recursive_limit: PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit,
      server_max_recursive_entities: PORTAL_BOOLEAN_RECURSIVE_POLICY.max_recursive_entities,
      headroom_entities: PORTAL_BOOLEAN_RECURSIVE_POLICY.baseline_headroom_entities,
      generic_prepare_complete_index_validated: true,
      generic_prepare_blockers: [],
      within_trusted_policy: true
    },
    fresh_handshake: {
      document_id: currentProcessDocumentId,
      source_path: PORTAL_BOOLEAN_BINDING.source_path,
      model_revision: CURRENT_REVISION,
      model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
      model_revision_unique_entity_limit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit,
      model_revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
      model_revision_complete: true,
      model_modified: false,
      capability_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version,
      manifest_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version,
      boolean_operations_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256,
      queue_state: 'idle'
    }
  },
  live_mutation_performed: false,
  release_acceptance: false
};
assert.doesNotThrow(() => assertRunRecordBinding(prepareRecord, latestFixture)); assertions += 1;
const prepareFailure = buildPrepareFailureEvidence({
  runDir,
  error: new Error('fixture prepare failure'),
  task: {
    ...structuredClone(preparedTask),
    private: { approval_token: 'must-not-be-copied' }
  },
  sourceShaBefore: PORTAL_BOOLEAN_BINDING.source_sha256,
  sourceShaAfter: PORTAL_BOOLEAN_BINDING.source_sha256,
  capabilities: liveBindingFixture.capabilities,
  queueBefore: { queue_count: 0, processing_count: 0, response_count: 0, lock_exists: false },
  queueAfter: { queue_count: 0, processing_count: 0, response_count: 0, lock_exists: false },
  handshake: liveBindingFixture.handshake,
  adoption: liveBindingFixture.adoption
});
assert.equal(prepareFailure.kind, 'portal_structure_s3_boolean_prepare_failure'); assertions += 1;
assert.equal(prepareFailure.approval.challenge_issued, true); assertions += 1;
assert.equal(prepareFailure.source.file_unchanged, true); assertions += 1;
assert.equal(prepareFailure.persistence.latest_json_updated, false); assertions += 1;
assert.equal(prepareFailure.live_mutation_performed, false); assertions += 1;
assert.equal(prepareFailure.model_save_performed, false); assertions += 1;
assert.equal(JSON.stringify(prepareFailure).includes('must-not-be-copied'), false); assertions += 1;
assert.doesNotThrow(() => assertNoSensitiveEvidence(prepareFailure)); assertions += 1;
const supersededPrepareRecord = { ...structuredClone(prepareRecord), version: 'portal-structure-s3-boolean-live.v7' };
assert.throws(() => assertRunRecordBinding(supersededPrepareRecord, latestFixture), /wrong contract/); assertions += 1;
const prepareDocumentDrift = structuredClone(prepareRecord);
prepareDocumentDrift.live_preflight.fresh_handshake.document_id = `document_${'3'.repeat(64)}`;
assert.throws(() => assertRunRecordBinding(prepareDocumentDrift, latestFixture), /differs from its fresh handshake/); assertions += 1;
const persistedPreparedTask = { ...structuredClone(preparedTask), state: 'awaiting_review' };
delete persistedPreparedTask.task_state;
assert.doesNotThrow(() => assertPortalTaskBinding(persistedPreparedTask, prepareRecord, latestFixture)); assertions += 1;
const taskPlanDrift = structuredClone(persistedPreparedTask);
taskPlanDrift.result.plan_hash = `sha256:${'b'.repeat(64)}`;
assert.throws(() => assertPortalTaskBinding(taskPlanDrift, prepareRecord, latestFixture), /plan id\/hash differs/); assertions += 1;
const challengeScopeDrift = structuredClone(persistedPreparedTask);
challengeScopeDrift.result.approval_challenge.allowed_operations = ['erase_entities'];
assert.throws(() => assertPortalTaskBinding(challengeScopeDrift, prepareRecord, latestFixture), /allowed operations drifted/); assertions += 1;
const legacyV7PreparedTask = structuredClone(persistedPreparedTask);
legacyV7PreparedTask.result.approval_challenge.review_context.targets[1].entity_path = 'pid:14632';
legacyV7PreparedTask.result.approval_challenge.review_context.operations[0].tools = ['pid:14632'];
legacyV7PreparedTask.result.approval_challenge.review_context.operations[0].result_id = 'portal-structure-s3-boolean-result';
legacyV7PreparedTask.result.approval_challenge.review_context.operations[0].result_name = 'Portal_S3_Boolean_Result';
legacyV7PreparedTask.result.approval_challenge.review_context_hash = sha256Canonical(
  legacyV7PreparedTask.result.approval_challenge.review_context
);
assert.throws(
  () => assertPortalTaskBinding(legacyV7PreparedTask, prepareRecord, latestFixture),
  /review-context hash drifted|review context differs|target\/tool scope drifted|tool drifted/
); assertions += 1;
const legacyRevisionTask = structuredClone(persistedPreparedTask);
legacyRevisionTask.result.model_revision = PORTAL_BOOLEAN_BINDING.model_revision;
legacyRevisionTask.result.approval_challenge.model_revision = PORTAL_BOOLEAN_BINDING.model_revision;
assert.throws(() => assertPortalTaskBinding(legacyRevisionTask, prepareRecord, latestFixture), /model\/risk binding drifted/); assertions += 1;
const expiredChallenge = structuredClone(persistedPreparedTask);
expiredChallenge.result.approval_challenge.expires_at = '2000-01-01T00:00:00.000Z';
assert.throws(() => assertPortalTaskBinding(expiredChallenge, prepareRecord, latestFixture), /expired/); assertions += 1;
const authorizationReadyFixture = {
  kind: 'agent_task_authorization_readiness',
  ok: true,
  task_id: preparedTask.task_id,
  plan_id: prepareRecord.plan_id,
  plan_hash: prepareRecord.plan_hash,
  challenge_id: prepareRecord.approval.challenge_id,
  model_revision: CURRENT_REVISION,
  risk_level: PORTAL_BOOLEAN_BINDING.risk_level,
  allowed_operations: [PORTAL_BOOLEAN_BINDING.operation],
  review_context_hash: prepareRecord.approval.review_context_sha256,
  approval_status: 'approved_pending_execution',
  approval_token_exposed: false,
  expires_at: prepareRecord.approval.expires_at
};
assert.doesNotThrow(() => assertPortalAuthorizationReady(authorizationReadyFixture, prepareRecord, latestFixture)); assertions += 1;
assert.throws(
  () => assertPortalAuthorizationReady({ ...authorizationReadyFixture, risk_level: 'S1' }, prepareRecord, latestFixture),
  /model\/risk binding drifted/
); assertions += 1;
assert.throws(
  () => assertPortalAuthorizationReady({
    ...authorizationReadyFixture,
    challenge_id: 'approval_consumed_by_portal_v7',
    review_context_hash: `sha256:${'5'.repeat(64)}`
  }, prepareRecord, latestFixture),
  /challenge binding drifted|review-context binding drifted/
); assertions += 1;

const booleanSourceBuffer = await fs.readFile(path.join(projectRoot, 'sketchup_plugin', 'alma_sketchup_mcp', 'boolean_operations.rb'));
const modelRevisionSourceBuffer = await fs.readFile(path.join(projectRoot, 'sketchup_plugin', 'alma_sketchup_mcp', 'model_revision.rb'));
let readIndex = 0;
const identicalPluginFs = {
  async readFile(filePath) {
    readIndex += 1;
    return String(filePath).includes('model-revision') ? modelRevisionSourceBuffer : booleanSourceBuffer;
  }
};
const installedMatch = await assertInstalledBooleanSource({
  fsImpl: identicalPluginFs,
  workspacePath: 'workspace-boolean.rb',
  installedPath: 'installed-boolean.rb',
  workspaceModelRevisionPath: 'workspace-model-revision.rb',
  installedModelRevisionPath: 'installed-model-revision.rb'
});
assert.equal(readIndex, 4); assertions += 1;
assert.equal(installedMatch.exact_match, true); assertions += 1;
assert.equal(installedMatch.installed_path_exposed, false); assertions += 1;
let mismatchIndex = 0;
await assert.rejects(
  assertInstalledBooleanSource({
    fsImpl: {
      async readFile(filePath) {
        mismatchIndex += 1;
        if (String(filePath) === 'installed-boolean.rb') return Buffer.from('installed stale');
        return String(filePath).includes('model-revision') ? modelRevisionSourceBuffer : booleanSourceBuffer;
      }
    },
    workspacePath: 'workspace-boolean.rb',
    installedPath: 'installed-boolean.rb',
    workspaceModelRevisionPath: 'workspace-model-revision.rb',
    installedModelRevisionPath: 'installed-model-revision.rb'
  }),
  /does not match.*No queue request was created/
); assertions += 1;
assert.equal(liveQueueCalls, 0); assertions += 1;
await assert.rejects(
  assertInstalledBooleanSource({
    fsImpl: {
      async readFile(filePath) {
        if (String(filePath) === 'installed-model-revision.rb') return Buffer.from('installed stale model revision');
        return String(filePath).includes('model-revision') ? modelRevisionSourceBuffer : booleanSourceBuffer;
      }
    },
    workspacePath: 'workspace-boolean.rb',
    installedPath: 'installed-boolean.rb',
    workspaceModelRevisionPath: 'workspace-model-revision.rb',
    installedModelRevisionPath: 'installed-model-revision.rb'
  }),
  /Installed model_revision\.rb does not match.*No queue request was created/
); assertions += 1;

const unapprovedTask = structuredClone(preparedTask);
unapprovedTask.next_action.approval_status = 'awaiting_trusted_user';
unapprovedTask.next_action.approval_token_exposed_to_agent = false;
assert.throws(() => classifyApplyAttempt({ task: unapprovedTask, prepareRecord }), /not approved_pending_execution.*No queue request was created/); assertions += 1;

const fakeApplyFs = createFakeApplyFs(latestFixture, prepareRecord);
let queueCallsBeforeApproval = 0;
let nonQueueResumeCalls = 0;
let deferredPreflightCalls = 0;
const guardedBridge = {
  async resume_agent_task() {
    nonQueueResumeCalls += 1;
    return structuredClone(unapprovedTask);
  },
  async get_capabilities() { queueCallsBeforeApproval += 1; },
  async queue_diagnostics() { queueCallsBeforeApproval += 1; },
  async create_queue_handshake() { queueCallsBeforeApproval += 1; },
  async adopt_open_model() { queueCallsBeforeApproval += 1; },
  async submit_agent_task_input() { queueCallsBeforeApproval += 1; }
};
await assert.rejects(
  applyWorkflow({ timeoutMs: 10_000 }, {
    bridge: guardedBridge,
    fsImpl: fakeApplyFs,
    readPersistedTask: async () => ({ ...structuredClone(persistedPreparedTask), next_action: structuredClone(unapprovedTask.next_action) }),
    loadPinnedBindings: async () => { deferredPreflightCalls += 1; },
    assertSourceBinding: async () => { deferredPreflightCalls += 1; },
    assertInstalledSource: async () => { deferredPreflightCalls += 1; }
  }),
  /not approved_pending_execution.*No queue request was created/
); assertions += 1;
assert.equal(nonQueueResumeCalls, 1); assertions += 1;
assert.equal(queueCallsBeforeApproval, 0, 'unapproved end-to-end apply must stop before every queue-related bridge method'); assertions += 1;
assert.equal(deferredPreflightCalls, 0, 'unapproved apply must stop before deferred live preflight'); assertions += 1;

let tamperedResumeCalls = 0;
let tamperedQueueCalls = 0;
const tamperedBridge = {
  async resume_agent_task() { tamperedResumeCalls += 1; return structuredClone(unapprovedTask); },
  async get_capabilities() { tamperedQueueCalls += 1; },
  async queue_diagnostics() { tamperedQueueCalls += 1; },
  async create_queue_handshake() { tamperedQueueCalls += 1; },
  async adopt_open_model() { tamperedQueueCalls += 1; },
  async submit_agent_task_input() { tamperedQueueCalls += 1; }
};
await assert.rejects(
  applyWorkflow({ timeoutMs: 10_000 }, {
    bridge: tamperedBridge,
    fsImpl: createFakeApplyFs(latestFixture, prepareRecord),
    readPersistedTask: async () => structuredClone(taskPlanDrift),
    loadPinnedBindings: async () => {},
    assertSourceBinding: async () => {},
    assertInstalledSource: async () => {}
  }),
  /plan id\/hash differs/
); assertions += 1;
assert.equal(tamperedResumeCalls, 0, 'tampered persisted task must fail before resume can perform recovery work'); assertions += 1;
assert.equal(tamperedQueueCalls, 0, 'tampered persisted task must fail before every queue-related bridge method'); assertions += 1;

let legacyV7ResumeCalls = 0;
let legacyV7QueueCalls = 0;
await assert.rejects(
  applyWorkflow({ timeoutMs: 10_000 }, {
    bridge: {
      async resume_agent_task() { legacyV7ResumeCalls += 1; return structuredClone(unapprovedTask); },
      async get_capabilities() { legacyV7QueueCalls += 1; },
      async queue_diagnostics() { legacyV7QueueCalls += 1; },
      async create_queue_handshake() { legacyV7QueueCalls += 1; },
      async adopt_open_model() { legacyV7QueueCalls += 1; },
      async submit_agent_task_input() { legacyV7QueueCalls += 1; }
    },
    fsImpl: createFakeApplyFs(latestFixture, prepareRecord),
    readPersistedTask: async () => structuredClone(legacyV7PreparedTask),
    loadPinnedBindings: async () => {},
    assertSourceBinding: async () => {},
    assertInstalledSource: async () => {}
  }),
  /review-context hash drifted|review context differs|target\/tool scope drifted|tool drifted/
); assertions += 1;
assert.equal(legacyV7ResumeCalls, 0, 'superseded v7 task must fail before resume'); assertions += 1;
assert.equal(legacyV7QueueCalls, 0, 'superseded v7 task/approval must not create a queue call'); assertions += 1;

const forgedApprovedTask = structuredClone(preparedTask);
forgedApprovedTask.next_action.approval_status = 'approved_pending_execution';
forgedApprovedTask.next_action.approval_token_exposed_to_agent = false;
let forgedApprovalQueueCalls = 0;
let forgedApprovalReadyChecks = 0;
const forgedApprovalBridge = {
  async resume_agent_task() { return structuredClone(forgedApprovedTask); },
  async get_capabilities() { forgedApprovalQueueCalls += 1; },
  async queue_diagnostics() { forgedApprovalQueueCalls += 1; },
  async create_queue_handshake() { forgedApprovalQueueCalls += 1; },
  async adopt_open_model() { forgedApprovalQueueCalls += 1; },
  async submit_agent_task_input() { forgedApprovalQueueCalls += 1; }
};
await assert.rejects(
  applyWorkflow({ timeoutMs: 10_000 }, {
    bridge: forgedApprovalBridge,
    fsImpl: createFakeApplyFs(latestFixture, prepareRecord),
    readPersistedTask: async () => ({ ...structuredClone(persistedPreparedTask), next_action: structuredClone(forgedApprovedTask.next_action) }),
    verifyAuthorizationReady: async () => {
      forgedApprovalReadyChecks += 1;
      const error = new Error('Stored local approval decision signature or binding is invalid. No queue request was created.');
      error.code = 'APPROVAL_INVALID';
      throw error;
    },
    loadPinnedBindings: async () => {},
    assertSourceBinding: async () => {},
    assertInstalledSource: async () => {}
  }),
  /approval decision signature or binding is invalid/
); assertions += 1;
assert.equal(forgedApprovalReadyChecks, 1); assertions += 1;
assert.equal(forgedApprovalQueueCalls, 0, 'forged approved status/decision must fail before every queue-related bridge method'); assertions += 1;

let privateExecutionTamperQueueCalls = 0;
const privateExecutionTamperBridge = {
  async resume_agent_task() { return structuredClone(forgedApprovedTask); },
  async get_capabilities() { privateExecutionTamperQueueCalls += 1; },
  async queue_diagnostics() { privateExecutionTamperQueueCalls += 1; },
  async create_queue_handshake() { privateExecutionTamperQueueCalls += 1; },
  async adopt_open_model() { privateExecutionTamperQueueCalls += 1; },
  async submit_agent_task_input() { privateExecutionTamperQueueCalls += 1; }
};
await assert.rejects(
  applyWorkflow({ timeoutMs: 10_000 }, {
    bridge: privateExecutionTamperBridge,
    fsImpl: createFakeApplyFs(latestFixture, prepareRecord),
    readPersistedTask: async () => ({ ...structuredClone(persistedPreparedTask), next_action: structuredClone(forgedApprovedTask.next_action) }),
    verifyAuthorizationReady: async () => {
      const error = new Error('Private plan execution_contract no longer matches its approved plan hash. No queue request was created.');
      error.code = 'PLAN_HASH_MISMATCH';
      throw error;
    },
    loadPinnedBindings: async () => {},
    assertSourceBinding: async () => {},
    assertInstalledSource: async () => {}
  }),
  /Private plan execution_contract.*approved plan hash/
); assertions += 1;
assert.equal(privateExecutionTamperQueueCalls, 0, 'private execution-contract tamper must fail before every queue-related bridge method'); assertions += 1;

const completedTask = {
  ...preparedTask,
  task_state: 'completed',
  result: {
    ...structuredClone(preparedTask.result),
    mutation_receipt: { receipt_id: 'receipt-portal-v8-fixture', status: 'committed' }
  }
};
const replay = classifyApplyAttempt({
  task: completedTask,
  prepareRecord,
  applyRecord: {
    task_state: 'completed',
    live_mutation_performed: true,
    mutation_receipt: { receipt_id: 'receipt-portal-v8-fixture', status: 'committed' }
  }
});
assert.deepEqual(replay, { action: 'return_idempotent_evidence', idempotent_replay: true }); assertions += 1;
assert.equal(completedTask.result.mutation_receipt.receipt_id, 'receipt-portal-v8-fixture'); assertions += 1;
assert.equal(liveQueueCalls, 0, 'completed replay must not call queue or mutation'); assertions += 1;

const validApplyRecord = {
  version: PORTAL_BOOLEAN_LIVE_VERSION,
  kind: 'portal_structure_s3_boolean_apply',
  task_id: preparedTask.task_id,
  task_state: 'completed',
  ok: true,
  plan_id: prepareRecord.plan_id,
  plan_hash: prepareRecord.plan_hash,
  risk_level: PORTAL_BOOLEAN_BINDING.risk_level,
  authorization: {
    mode: 'trusted_local_approval',
    challenge_id: prepareRecord.approval.challenge_id,
    trusted_token_copied_to_evidence: false,
    agent_self_approval_accepted: false
  },
  source: {
    path: PORTAL_BOOLEAN_BINDING.source_path,
    sha256_before: PORTAL_BOOLEAN_BINDING.source_sha256,
    sha256_after: PORTAL_BOOLEAN_BINDING.source_sha256,
    file_unchanged: true
  },
  model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
  model_revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
  model_revision_before: CURRENT_REVISION,
  model_revision_after: `sha256:${'c'.repeat(64)}`,
  pair: {
    target: { entity_path: PORTAL_BOOLEAN_BINDING.target_path },
    tool: { entity_path: PORTAL_BOOLEAN_BINDING.tool_path }
  },
  result: {
    result_path: 'pid:99999',
    result_name: PORTAL_BOOLEAN_BINDING.result_name,
    before_group_count: PORTAL_BOOLEAN_BINDING.baseline_group_count,
    after_group_count: PORTAL_BOOLEAN_BINDING.baseline_group_count + 1,
    result_manifold: true,
    result_volume: 1,
    originals_preserved: true,
    tool_preserved: true,
    structural_identity_sha256: `sha256:${'d'.repeat(64)}`
  },
  mutation_receipt: { receipt_id: 'receipt-portal-v8-fixture', status: 'committed' },
  saved_copy: {
    path: prepareRecord.save.final_path,
    approved_final_path: prepareRecord.save.final_path,
    exact_approved_target: true,
    sha256: 'e'.repeat(64),
    source_overwritten: false,
    active_source_identity_preserved: true
  },
  live_mutation_performed: true
};
assert.doesNotThrow(() => assertApplyRecordBinding(validApplyRecord, prepareRecord, latestFixture)); assertions += 1;
const tamperedApplyRecord = structuredClone(validApplyRecord);
tamperedApplyRecord.saved_copy.path = path.join(latestFixture.run_dir, 'unapproved-copy.skp');
assert.throws(() => assertApplyRecordBinding(tamperedApplyRecord, prepareRecord, latestFixture), /saved-copy binding drifted/); assertions += 1;
let tamperedReopenQueueCalls = 0;
const completedPersistedTask = {
  task_id: preparedTask.task_id,
  state: 'completed',
  result: {
    kind: 'reviewed_existing_model_edit_result',
    plan_id: prepareRecord.plan_id,
    risk_level: PORTAL_BOOLEAN_BINDING.risk_level
  }
};
await assert.rejects(
  verifyReopenWorkflow({ taskId: preparedTask.task_id, timeoutMs: 10_000 }, {
    bridge: {
      taskStore: { async getTask() { return structuredClone(completedPersistedTask); } },
      async queue_diagnostics() { tamperedReopenQueueCalls += 1; },
      async get_capabilities() { tamperedReopenQueueCalls += 1; },
      async create_queue_handshake() { tamperedReopenQueueCalls += 1; },
      async adopt_open_model() { tamperedReopenQueueCalls += 1; }
    },
    fsImpl: createFakeReopenFs(latestFixture, prepareRecord, tamperedApplyRecord)
  }),
  /saved-copy binding drifted/
); assertions += 1;
assert.equal(tamperedReopenQueueCalls, 0, 'tampered apply/reopen evidence must fail before every queue-related bridge method'); assertions += 1;

const outcomeUnknown = buildOutcomeUnknownEvidence({
  taskId: 'task_11111111-1111-1111-1111-111111111111',
  runId: 'fixture-run',
  error: new Error('connection lost after submit'),
  sourceShaBefore: PORTAL_BOOLEAN_BINDING.source_sha256,
  sourceShaAfter: PORTAL_BOOLEAN_BINDING.source_sha256
});
assert.equal(outcomeUnknown.outcome_unknown, true); assertions += 1;
assert.equal(outcomeUnknown.exact_solid_overlap.status, 'outcome_unconfirmed'); assertions += 1;
assert.equal(outcomeUnknown.durable_receipt_confirmed, false); assertions += 1;
assert.equal(outcomeUnknown.failure_policy.automatic_replay, false); assertions += 1;
assert.equal(outcomeUnknown.automatic_retry_performed, false); assertions += 1;
assert.throws(() => classifyApplyAttempt({ task: preparedTask, prepareRecord, failureRecord: outcomeUnknown }), /Automatic replay is forbidden/); assertions += 1;
const receiptBoundFailure = buildOutcomeUnknownEvidence({
  taskId: 'task_11111111-1111-1111-1111-111111111111',
  runId: 'fixture-run',
  error: new Error('post-commit QA interrupted'),
  sourceShaBefore: PORTAL_BOOLEAN_BINDING.source_sha256,
  sourceShaAfter: PORTAL_BOOLEAN_BINDING.source_sha256,
  durableReceipt: { receipt_id: 'receipt-fixture', status: 'committed_pending_finalization' },
  taskState: 'verifying'
});
assert.equal(receiptBoundFailure.outcome_unknown, false); assertions += 1;
assert.equal(receiptBoundFailure.durable_receipt_confirmed, true); assertions += 1;
assert.equal(receiptBoundFailure.mutation_committed, true); assertions += 1;
assert.throws(() => classifyApplyAttempt({ task: preparedTask, prepareRecord, failureRecord: receiptBoundFailure }), /automatic mutation replay is forbidden/); assertions += 1;
const precommitAbortError = {
  code: 'MUTATION_EXECUTION_FAILED',
  message: 'The SketchUp model transaction failed before commit.',
  details: { phase: 'precommit_execution', commit_state: 'not_committed', abort_succeeded: true }
};
const precommitAbort = buildOutcomeUnknownEvidence({
  taskId: 'task_11111111-1111-1111-1111-111111111111',
  runId: 'fixture-run',
  error: new Error('generic outer error'),
  taskError: precommitAbortError,
  sourceShaBefore: PORTAL_BOOLEAN_BINDING.source_sha256,
  sourceShaAfter: PORTAL_BOOLEAN_BINDING.source_sha256,
  taskState: 'failed'
});
assert.equal(precommitAbort.kind, 'portal_structure_s3_boolean_apply_precommit_abort'); assertions += 1;
assert.equal(precommitAbort.outcome_unknown, false); assertions += 1;
assert.equal(precommitAbort.mutation_committed, false); assertions += 1;
assert.equal(precommitAbort.rollback_confirmed, true); assertions += 1;
assert.equal(precommitAbort.abort_succeeded, true); assertions += 1;
assert.deepEqual(precommitAbort.exact_solid_overlap, {
  status: 'not_verified_atomic_trial_aborted',
  verified: false,
  verification_stage: 'review_gated_atomic_apply'
}); assertions += 1;
assert.deepEqual(classifyTaskMutationOutcome({ taskState: 'failed', taskError: precommitAbortError }), {
  outcome_unknown: false,
  mutation_committed: false,
  rollback_confirmed: true,
  evidence_conflict: false,
  commit_state: 'not_committed',
  abort_succeeded: true
}); assertions += 1;
assert.equal(classifyTaskMutationOutcome({
  taskState: 'failed',
  taskError: { ...precommitAbortError, code: 'WRONG_ERROR' }
}).rollback_confirmed, false); assertions += 1;
assert.equal(classifyTaskMutationOutcome({
  taskState: 'failed',
  taskError: { ...precommitAbortError, details: { ...precommitAbortError.details, phase: 'postcommit_qa' } }
}).rollback_confirmed, false); assertions += 1;
assert.deepEqual(classifyTaskMutationOutcome({
  taskState: 'failed',
  taskError: precommitAbortError,
  durableReceiptConfirmed: true
}), {
  outcome_unknown: true,
  mutation_committed: null,
  rollback_confirmed: false,
  evidence_conflict: true,
  commit_state: 'evidence_conflict',
  abort_succeeded: true
}); assertions += 1;
assert.deepEqual(classifyTaskMutationOutcome({ taskState: 'awaiting_review' }), {
  outcome_unknown: false,
  mutation_committed: false,
  rollback_confirmed: false,
  evidence_conflict: false,
  commit_state: 'not_submitted',
  abort_succeeded: null
}); assertions += 1;
assert.deepEqual(classifyTaskMutationOutcome({ taskState: 'completed', durableReceiptConfirmed: true }), {
  outcome_unknown: false,
  mutation_committed: true,
  rollback_confirmed: false,
  evidence_conflict: false,
  commit_state: 'committed',
  abort_succeeded: null
}); assertions += 1;
assert.throws(() => classifyApplyAttempt({ task: preparedTask, prepareRecord, failureRecord: precommitAbort }), /confirmed aborted before commit/); assertions += 1;
const failedPersistedTask = {
  ...structuredClone(persistedPreparedTask),
  state: 'failed',
  last_error: precommitAbortError
};
assert.doesNotThrow(() => assertPortalFailedTaskBinding(failedPersistedTask, prepareRecord, latestFixture)); assertions += 1;
let abortedReplayQueueCalls = 0;
await assert.rejects(
  applyWorkflow({ timeoutMs: 10_000 }, {
    bridge: {
      async resume_agent_task() { return { ...structuredClone(preparedTask), task_state: 'failed', error: precommitAbortError }; },
      async get_capabilities() { abortedReplayQueueCalls += 1; },
      async queue_diagnostics() { abortedReplayQueueCalls += 1; },
      async create_queue_handshake() { abortedReplayQueueCalls += 1; },
      async adopt_open_model() { abortedReplayQueueCalls += 1; },
      async submit_agent_task_input() { abortedReplayQueueCalls += 1; }
    },
    fsImpl: createFakeApplyFs(latestFixture, prepareRecord, { 'apply-precommit-abort.json': precommitAbort }),
    readPersistedTask: async () => structuredClone(failedPersistedTask),
    loadPinnedBindings: async () => {},
    assertSourceBinding: async () => {},
    assertInstalledSource: async () => {}
  }),
  /confirmed aborted before commit/
); assertions += 1;
assert.equal(abortedReplayQueueCalls, 0, 'confirmed precommit abort must never replay or call the live queue'); assertions += 1;

const sanitized = sanitizeForEvidence({
  session_contract: { signature: 'hmac_sha256:secret' },
  approval_token: 'secret-token',
  nonce: 'secret-nonce',
  safe: 'hmac_sha256:still-secret',
  nested: { plan_id: 'plan-safe' }
});
assert.equal(sanitized.session_contract, undefined); assertions += 1;
assert.equal(sanitized.approval_token, undefined); assertions += 1;
assert.equal(sanitized.nonce, undefined); assertions += 1;
assert.equal(sanitized.safe, '[REDACTED_SESSION_SIGNATURE]'); assertions += 1;
assert.doesNotThrow(() => assertNoSensitiveEvidence(sanitized)); assertions += 1;
assert.throws(() => assertNoSensitiveEvidence({ signature: 'hmac_sha256:secret' }), /Session Contract signature/); assertions += 1;

const currentDiagnostics = { queue: { count: 0 }, processing: { count: 0 }, responses: { count: 0 }, lock: { exists: false } };
assert.deepEqual(summarizeQueue(currentDiagnostics), { queue: 0, processing: 0, responses: 0, lock_exists: false }); assertions += 1;
assert.doesNotThrow(() => assertQueueIdle(currentDiagnostics)); assertions += 1;
assert.throws(() => assertQueueIdle({}), /Queue is not idle/); assertions += 1;

const absentSaveFs = saveTargetFs({ runDir, finalPath: preparedContext.execution.final_save_path });
await assert.doesNotReject(assertPortalSaveTargetAvailable({ runDir, finalPath: preparedContext.execution.final_save_path, fsImpl: absentSaveFs })); assertions += 1;
await assert.rejects(
  assertPortalSaveTargetAvailable({
    runDir,
    finalPath: preparedContext.execution.final_save_path,
    fsImpl: saveTargetFs({ runDir, finalPath: preparedContext.execution.final_save_path, finalExists: true })
  }),
  /already an existing filesystem entry.*before any queue request/
); assertions += 1;
await assert.rejects(
  assertPortalSaveTargetAvailable({
    runDir,
    finalPath: preparedContext.execution.final_save_path,
    fsImpl: saveTargetFs({ runDir, finalPath: preparedContext.execution.final_save_path, parentSymlink: true })
  }),
  /ancestor chain contains.*symbolic link|parent must be a real non-symlink run directory|parent must not be a symlink/
); assertions += 1;
const higherAncestor = path.dirname(path.dirname(runDir));
await assert.rejects(
  assertPortalSaveTargetAvailable({
    runDir,
    finalPath: preparedContext.execution.final_save_path,
    fsImpl: saveTargetFs({ runDir, finalPath: preparedContext.execution.final_save_path, ancestorSymlink: higherAncestor })
  }),
  /ancestor chain contains.*symbolic link/
); assertions += 1;

const reopenHandshake = {
  session_contract: {
    kind: 'fresh_queue_handshake',
    runtime: 'queue',
    queue_state: 'idle',
    capability_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version,
    manifest_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version,
    session_id: 'session-reopen-fixture',
    document_id: 'document-reopen-fixture',
    model_identity: { source_path: '/fixture/saved-result.skp' },
    model_revision: `sha256:${'c'.repeat(64)}`,
    model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
    model_revision_unique_entity_limit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit,
    model_revision_complete: true,
    model_revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
    model_modified: false,
    boolean_operations_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256,
    signature: 'hmac_sha256:fixture-only-private-signature'
  }
};
const reopenAdoption = {
  session_id: 'session-reopen-fixture',
  document_id: 'document-reopen-fixture',
  model_info: { source_path: '/fixture/saved-result.skp' },
  model_revision: `sha256:${'c'.repeat(64)}`,
  model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
  model_revision_complete: true,
  model_modified: false
};
assert.doesNotThrow(() => assertReopenSessionBinding(reopenHandshake, reopenAdoption)); assertions += 1;
assert.notEqual(
  reopenHandshake.session_contract.document_id,
  prepareRecord.model.document_id,
  'a legitimate reopen may receive a new process-local document id; only handshake/adoption equality is required'
); assertions += 1;
const reopenDocumentDrift = structuredClone(reopenAdoption);
reopenDocumentDrift.document_id = 'document-other';
assert.throws(() => assertReopenSessionBinding(reopenHandshake, reopenDocumentDrift), /document differs/); assertions += 1;
const reopenSessionDrift = structuredClone(reopenAdoption);
reopenSessionDrift.session_id = 'session-other';
assert.throws(() => assertReopenSessionBinding(reopenHandshake, reopenSessionDrift), /session differs/); assertions += 1;

const terminalStatusRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-portal-terminal-status-'));
try {
  const terminalStatus = {
    kind: 'portal_structure_s3_boolean_status',
    checked_at: '2026-07-21T07:05:28.460Z',
    task_id: 'task_terminal_fixture',
    task_state: 'failed',
    error: { code: 'MUTATION_EXECUTION_FAILED' }
  };
  const firstTerminal = await writeTerminalStatusSnapshot(terminalStatusRoot, terminalStatus);
  assert.deepEqual(firstTerminal, terminalStatus); assertions += 1;
  const laterObservation = { ...terminalStatus, checked_at: '2026-07-21T08:00:00.000Z' };
  const preservedTerminal = await writeTerminalStatusSnapshot(terminalStatusRoot, laterObservation);
  assert.equal(preservedTerminal.checked_at, terminalStatus.checked_at, 'terminal evidence must remain first-write immutable'); assertions += 1;
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(terminalStatusRoot, 'status-terminal.json'), 'utf8')),
    terminalStatus
  ); assertions += 1;
  await assert.rejects(
    writeTerminalStatusSnapshot(terminalStatusRoot, { ...laterObservation, error: { code: 'INTERNAL_ERROR' } }),
    /terminal status evidence conflicts/
  ); assertions += 1;
  assert.equal(await writeTerminalStatusSnapshot(terminalStatusRoot, { task_state: 'awaiting_review' }), null); assertions += 1;
} finally {
  await fs.rm(terminalStatusRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  assertions,
  runtime: 'portable_witness_and_mock_fixtures_only',
  portable_witness: true,
  raw_capture_files_read: false,
  live_queue_called: false,
  live_mutation_performed: false,
  pinned_post_restart_review: PORTAL_BOOLEAN_BINDING.artifacts.review.sha256,
  pinned_pair: [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path],
  installed_source_hash_gate: true,
  unapproved_apply_blocked: true,
  unapproved_end_to_end_queue_calls: queueCallsBeforeApproval,
  tampered_task_end_to_end_queue_calls: tamperedQueueCalls,
  superseded_v7_task_end_to_end_queue_calls: legacyV7QueueCalls,
  forged_approval_end_to_end_queue_calls: forgedApprovalQueueCalls,
  private_execution_tamper_queue_calls: privateExecutionTamperQueueCalls,
  tampered_reopen_evidence_queue_calls: tamperedReopenQueueCalls,
  challenge_full_binding_and_expiry: true,
  approved_final_save_target_bound: true,
  ancestor_symlink_rejected: true,
  reopen_session_document_bound: true,
  process_local_document_id_not_cross_restart_bound: true,
  path_revision_hash_drift_fail_closed: true,
  duplicate_apply_mutation_count: 0,
  completed_receipt_idempotent_path: true,
  no_receipt_outcome_unknown_no_replay: true,
  immutable_terminal_status_evidence: true,
  sensitive_fields_exposed: false,
  negative_witness_cases: negativeWitnesses.length
}, null, 2)}\n`);

function createFakeApplyFs(latest, prepare, extraJson = {}) {
  return {
    async readFile(filePath) {
      if (path.basename(filePath) === 'latest.json') return JSON.stringify(latest);
      if (path.basename(filePath) === 'prepare.json') return JSON.stringify(prepare);
      if (Object.hasOwn(extraJson, path.basename(filePath))) return JSON.stringify(extraJson[path.basename(filePath)]);
      const error = new Error(`fixture file does not exist: ${path.basename(filePath)}`);
      error.code = 'ENOENT';
      throw error;
    },
    async lstat(filePath) {
      if (path.basename(filePath) === 'latest.json') return fakeStat({ file: true });
      return fakeStat({ directory: true });
    },
    async realpath(filePath) { return path.resolve(filePath); }
  };
}

function createFakeReopenFs(latest, prepare, apply) {
  return {
    async readFile(filePath) {
      if (path.basename(filePath) === 'latest.json') return JSON.stringify(latest);
      if (path.basename(filePath) === 'prepare.json') return JSON.stringify(prepare);
      if (path.basename(filePath) === 'apply.json') return JSON.stringify(apply);
      const error = new Error(`fixture file does not exist: ${path.basename(filePath)}`);
      error.code = 'ENOENT';
      throw error;
    },
    async lstat(filePath) {
      if (path.basename(filePath) === 'latest.json') return fakeStat({ file: true });
      return fakeStat({ directory: true });
    },
    async realpath(filePath) { return path.resolve(filePath); }
  };
}

function saveTargetFs({ runDir: expectedRunDir, finalPath, finalExists = false, parentSymlink = false, ancestorSymlink = null }) {
  return {
    async lstat(filePath) {
      const resolved = path.resolve(filePath);
      if (resolved === path.resolve(finalPath)) {
        if (finalExists) return fakeStat({ file: true });
        const error = new Error('target absent');
        error.code = 'ENOENT';
        throw error;
      }
      if (ancestorSymlink && resolved === path.resolve(ancestorSymlink)) return fakeStat({ directory: true, symlink: true });
      if (resolved === path.resolve(expectedRunDir)) return fakeStat({ directory: true, symlink: parentSymlink });
      return fakeStat({ directory: true });
    },
    async realpath(filePath) { return path.resolve(filePath); }
  };
}

function fakeStat({ directory = false, file = false, symlink = false } = {}) {
  return {
    mode: directory ? 0o40700 : 0o100600,
    isDirectory: () => directory,
    isFile: () => file,
    isSymbolicLink: () => symlink
  };
}

function createLivePortalBindingFixture(documentId, modelRevision = CURRENT_REVISION) {
  const sessionId = 'session-current-process';
  const structuralEntries = [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path].map((entityPath) => {
    const geometry = PORTAL_BOOLEAN_BINDING.geometry[entityPath];
    return {
      entity_path: entityPath,
      parent_entity_path: null,
      scope_path: 'model',
      entity_type: 'group',
      locked: false,
      effective_locked: false,
      visible: true,
      effective_visible: true,
      affected_instance_count: 1,
      shared_definition: false,
      faces: geometry.faces,
      edges: geometry.edges,
      vertices: geometry.vertices,
      world_bounding_box: structuredClone(geometry.bounding_box),
      manifold_attestation: {
        status: 'fresh_matched',
        fresh: true,
        matched: true,
        is_manifold: true,
        entity_path: entityPath,
        model_revision: modelRevision,
        report: { volume: geometry.volume }
      }
    };
  });
  return {
    capabilities: {
      runtime: {
        capability_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version,
        manifest_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version,
        model_revision: {
          strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
          unique_entity_limit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit
        },
        supported_operations: [PORTAL_BOOLEAN_BINDING.operation],
        read_only_probes: {
          structural_groups: { version: PORTAL_BOOLEAN_BINDING.structural_groups_version }
        },
        boolean_operations_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256,
        model_revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256
      }
    },
    handshake: {
      session_contract: {
        kind: 'fresh_queue_handshake',
        runtime: 'queue',
        queue_state: 'idle',
        session_id: sessionId,
        document_id: documentId,
        model_identity: { source_path: PORTAL_BOOLEAN_BINDING.source_path },
        model_revision: modelRevision,
        model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
        model_revision_unique_entity_limit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit,
        model_revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
        model_revision_complete: true,
        model_modified: false,
        capability_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version,
        manifest_version: PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version,
        boolean_operations_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256,
        signature: 'hmac_sha256:fixture-only-private-signature'
      }
    },
    adoption: {
      kind: 'adopt_open_model',
      runtime: 'queue',
      session_id: sessionId,
      document_id: documentId,
      read_only: true,
      model_info: { source_path: PORTAL_BOOLEAN_BINDING.source_path },
      model_revision: modelRevision,
      model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
      model_revision_unique_entity_limit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit,
      model_revision_complete: true,
      model_modified: false,
      model_revision_total_seen: PORTAL_BOOLEAN_RECURSIVE_POLICY.observed_complete_entity_count,
      model_revision_indexed: PORTAL_BOOLEAN_RECURSIVE_POLICY.observed_complete_entity_count,
      recursive_truncated: false,
      structural_groups: {
        version: PORTAL_BOOLEAN_BINDING.structural_groups_version,
        truncated: false,
        total_seen_exact: true,
        total_seen: PORTAL_BOOLEAN_BINDING.baseline_group_count,
        returned: PORTAL_BOOLEAN_BINDING.baseline_group_count,
        fresh_manifold_unmatched: 0,
        entries: structuralEntries
      }
    }
  };
}

function createPinnedPortalReviewFixture() {
  const manifoldAttestation = (entityPath) => ({
    status: 'fresh_manifold',
    attested_entity_path: entityPath,
    attested_model_revision: PORTAL_BOOLEAN_BINDING.model_revision,
    exact_path_match: true,
    model_revision_match: true,
    exact_fresh_match: true,
    is_manifold: true
  });
  return {
    version: 'real-model-recursive-target-review.v2',
    kind: 'real_model_recursive_target_review',
    runtime: 'offline',
    live_queue_called: false,
    source: { sha256: `sha256:${PORTAL_BOOLEAN_BINDING.source_sha256}` },
    model: {
      revision: PORTAL_BOOLEAN_BINDING.model_revision,
      revision_complete: true,
      revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
      revision_unique_entity_limit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit,
      document_id: PORTAL_BOOLEAN_BINDING.document_id,
      model_identity_sha256: PORTAL_BOOLEAN_BINDING.model_identity_sha256
    },
    review: {
      status: 'server_recommended',
      operation: 'difference',
      recommended_proposal: {
        operation: 'difference',
        status: 'server_recommended',
        bbox_relation: 'containment',
        positive_bbox_overlap: true,
        exact_solid_overlap: {
          status: 'unverified_before_atomic_trial',
          verified: false,
          verification_stage: 'review_gated_atomic_apply'
        },
        atomic_boolean_trial_eligible: true,
        target: {
          entity_path: PORTAL_BOOLEAN_BINDING.target_path,
          occurrence_path: PORTAL_BOOLEAN_BINDING.target_path,
          manifold_attestation: manifoldAttestation(PORTAL_BOOLEAN_BINDING.target_path)
        },
        tool: {
          entity_path: PORTAL_BOOLEAN_BINDING.tool_path,
          occurrence_path: PORTAL_BOOLEAN_BINDING.tool_path,
          manifold_attestation: manifoldAttestation(PORTAL_BOOLEAN_BINDING.tool_path)
        },
        role_provenance: 'server_geometric_ranking_untrusted_unapproved',
        confirmed: false,
        authorized: false,
        trusted_approval_required: true
      }
    },
    safety: { model_mutation_authorized: false },
    next_action: {
      mutation_authorized: false,
      approval_token_issued: false
    }
  };
}

function witnessGeometry(value) {
  return {
    faces: value.faces,
    edges: value.edges,
    vertices: value.vertices,
    exact_solid_volume: value.volume,
    world_bounding_box: value.bounding_box
  };
}

function assertPortablePortalWitness(value) {
  assertNoSensitiveWitnessData(value);
  assertNoAbsoluteLocalPath(value);
  assert.deepEqual(Object.keys(value).sort(), [
    'approval_disclosure',
    'authorization_boundary',
    'capture_hash_bindings',
    'case_id',
    'geometry_contract',
    'operation_contract',
    'release_acceptance',
    'review_lineage',
    'runtime_contract',
    'source_binding',
    'version',
    'workflow_contract'
  ]);
  assert.equal(value.version, 'portal-structure-s3-boolean-witness.v3');
  assert.equal(value.case_id, 'portal_structure_disposable_copy');
  assert.equal(value.runtime_contract.capability_version, PORTAL_BOOLEAN_BINDING.capability_version);
  assert.equal(value.runtime_contract.manifest_version, PORTAL_BOOLEAN_BINDING.manifest_version);
  assert.equal(value.runtime_contract.structural_groups_version, PORTAL_BOOLEAN_BINDING.structural_groups_version);
  assert.equal(value.source_binding.sha256, `sha256:${PORTAL_BOOLEAN_BINDING.source_sha256}`);
  assert.equal(value.source_binding.model_revision, PORTAL_BOOLEAN_BINDING.model_revision);
  assert.equal(value.source_binding.document_id, PORTAL_BOOLEAN_BINDING.document_id);
  assert.equal(value.source_binding.model_identity_sha256, PORTAL_BOOLEAN_BINDING.model_identity_sha256);
  assert.deepEqual(value.operation_contract, {
    op: PORTAL_BOOLEAN_BINDING.operation,
    risk_level: PORTAL_BOOLEAN_BINDING.risk_level,
    target_path: PORTAL_BOOLEAN_BINDING.target_path,
    tool_path: PORTAL_BOOLEAN_BINDING.tool_path,
    result_id: PORTAL_BOOLEAN_BINDING.result_id,
    result_name: PORTAL_BOOLEAN_BINDING.result_name,
    keep_originals: true,
    keep_tools: true,
    baseline_group_count: PORTAL_BOOLEAN_BINDING.baseline_group_count
  });
  assert.deepEqual(value.geometry_contract.target, witnessGeometry(PORTAL_BOOLEAN_BINDING.geometry[PORTAL_BOOLEAN_BINDING.target_path]));
  assert.deepEqual(value.geometry_contract.tool, witnessGeometry(PORTAL_BOOLEAN_BINDING.geometry[PORTAL_BOOLEAN_BINDING.tool_path]));
  assert.deepEqual(value.capture_hash_bindings, {
    capabilities_capture: `sha256:${PORTAL_BOOLEAN_BINDING.artifacts.capabilities.sha256}`,
    queue_before_capture: `sha256:${PORTAL_BOOLEAN_BINDING.artifacts.queue_before.sha256}`,
    structural_capture: `sha256:${PORTAL_BOOLEAN_BINDING.artifacts.structural.sha256}`,
    primary_review_capture: `sha256:${PORTAL_BOOLEAN_BINDING.artifacts.review.sha256}`,
    queue_after_capture: `sha256:${PORTAL_BOOLEAN_BINDING.artifacts.queue_after.sha256}`
  });
  for (const digest of Object.values(value.capture_hash_bindings)) assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(value.review_lineage, {
    primary_review: 'readonly_probe_capability7_recursive_review_v2',
    review_version: 'real-model-recursive-target-review.v2',
    recommendation: 'server_recommended',
    bbox_relation: 'containment',
    positive_bbox_overlap: true,
    exact_solid_overlap: {
      status: 'unverified_before_atomic_trial',
      verified: false,
      verification_stage: 'review_gated_atomic_apply'
    },
    atomic_boolean_trial_eligible: true,
    target_fresh_manifold: true,
    tool_fresh_manifold: true,
    role_provenance: 'server_geometric_ranking_untrusted_unapproved'
  });
  assert.deepEqual(value.approval_disclosure, PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE);
  assert.deepEqual(value.authorization_boundary, {
    confirmed: false,
    authorized: false,
    trusted_user_approval_required: true,
    model_mutation_authorized: false
  });
  assert.deepEqual(value.workflow_contract, {
    current_workflow_version: PORTAL_BOOLEAN_LIVE_VERSION,
    superseded_workflow_versions: [1, 2, 3, 4, 5, 6, 7].map((version) => `portal-structure-s3-boolean-live.v${version}`),
    historical_witnesses: [
      { version: 'portal-structure-s3-boolean-witness.v1', lineage_only: true, approval_reusable: false, task_reusable: false },
      { version: 'portal-structure-s3-boolean-witness.v2', lineage_only: true, approval_reusable: false, task_reusable: false }
    ],
    default_live_queue_called: false,
    default_model_mutation_performed: false,
    prepare_read_only: true,
    private_capture_required_for_live_prepare: true,
    source_save_target_forbidden: true,
    automatic_replay_after_unknown_outcome: false,
    automatic_replay_after_confirmed_abort: false
  });
  assert.equal(value.release_acceptance, false);
}

function assertNoSensitiveWitnessData(value) {
  walk(value, (key, child) => {
    assert.doesNotMatch(key, /(?:signature|session[_-]?id|token|secret)/i, `portable witness contains sensitive key ${key}`);
    if (typeof child === 'string') {
      assert.doesNotMatch(child, /hmac_sha256:|bearer\s+|[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}/i, 'portable witness contains credential-like data');
    }
  });
}

function assertNoAbsoluteLocalPath(value) {
  walk(value, (_key, child) => {
    if (typeof child !== 'string') return;
    assert.equal(
      child.startsWith('/') || /^[A-Za-z]:[\\/]/.test(child) || child.startsWith('\\\\') || child.startsWith('file://') || child.startsWith('~/'),
      false,
      'portable witness contains an absolute local path'
    );
  });
}

function walk(value, callback) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    callback(key, child);
    walk(child, callback);
  }
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
