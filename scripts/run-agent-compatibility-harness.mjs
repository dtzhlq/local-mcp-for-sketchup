#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import {
  AGENT_CAPABILITY_PROFILES,
  CapabilityConstrainedToolClient,
  FaultInjector,
  GatewayMutationAuditTrail,
  MockOnlyCapabilityDispatcher,
  MutationLedger,
  VolatileAgentState,
  compatibilityEntityFingerprint
} from '../src/agent-compatibility-simulator.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { callTool, SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { ValidatedToolDispatcher } from '../src/validated-tool-dispatcher.mjs';

export const AGENT_CAPABILITY_LEVELS = Object.freeze(Object.fromEntries(
  Object.entries(AGENT_CAPABILITY_PROFILES).map(([level, profile]) => [level, profile.clientCapabilities()])
));

export async function runAgentCompatibilityHarness({ rootDir } = {}) {
  const ownedRoot = !rootDir;
  const root = rootDir || await fs.mkdtemp(path.join(os.tmpdir(), 'alma-agent-compatibility-'));
  const runs = [];
  try {
    for (const level of Object.keys(AGENT_CAPABILITY_PROFILES)) runs.push(await runLevel(root, level));
    const levels = runs.map((run) => run.report);
    const hardGates = {
      wrong_object_automatic_execution: sumNested(levels, 'hard_gates', 'wrong_object_automatic_execution'),
      unauthorized_s2_s4_execution: sumNested(levels, 'hard_gates', 'unauthorized_s2_s4_execution'),
      duplicate_request_duplicate_modification: sumNested(levels, 'hard_gates', 'duplicate_request_duplicate_modification')
    };
    const report = {
      version: 'agent-compatibility-report.v1',
      kind: 'agent_compatibility_report',
      runtime: 'mock',
      brand_specific: false,
      profile_version: 'agent-capability-profile.v1',
      levels,
      aggregate: aggregateMetrics(levels),
      gateway_audit: aggregateGatewayAudit(runs),
      mutation_ledger: runs.flatMap((run) => run.mutationLedger),
      hard_gates: hardGates,
      live_queue_called: false
    };
    assert.deepEqual(hardGates, zeroHardGates());
    await assertReportSchema(report);
    return report;
  } finally {
    if (ownedRoot) await fs.rm(root, { recursive: true, force: true });
  }
}

async function runLevel(root, level) {
  const profile = AGENT_CAPABILITY_PROFILES[level];
  const levelRoot = path.join(root, level);
  const stateRoot = path.join(levelRoot, 'agent-state');
  const options = {
    mock: { sessionPath: path.join(levelRoot, 'session.json') },
    agentContract: { rootDir: stateRoot },
    approval: {
      stateDir: path.join(levelRoot, 'approvals'),
      secret: `compatibility-${level}-trusted-secret-at-least-32-bytes`
    },
    executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
  };
  const bridgeRef = { current: new SketchUpBridge(options) };
  const validatedDispatcher = new ValidatedToolDispatcher({
    invoke: (name, args) => callTool(name, args, bridgeRef.current)
  });
  const auditTrail = new GatewayMutationAuditTrail({ level, getBridge: () => bridgeRef.current });
  const dispatcher = new MockOnlyCapabilityDispatcher({
    dispatcher: auditTrail.wrap(validatedDispatcher),
    taskStore: bridgeRef.current.taskStore,
    imageArtifactStore: bridgeRef.current.agentGateway.imageArtifactStore,
    artifactRoot: path.join(stateRoot, 'compatibility-projections')
  });
  const state = new VolatileAgentState();
  const faultInjector = new FaultInjector({ state });
  const client = new CapabilityConstrainedToolClient({ dispatcher, profile, state, faultInjector });
  const ledger = new MutationLedger();
  const scenarioResults = {};
  let expectedSchemaRejections = 0;
  let unexpectedSchemaErrors = 0;
  let invalidRetryAttempts = 0;
  let invalidRetriesBlocked = 0;
  let invalidRetriesExecuted = 0;
  let topKAttempts = 0;
  let topKHits = 0;
  let recoveryAttempts = 0;
  let recoverySuccesses = 0;
  let understoodTaskId = null;

  const fixtureCall = (tool, args) => client.fixtureCall(tool, args);
  const envelopeData = (envelope) => readProjectedEnvelopeData({
    client,
    profile,
    envelope,
    forbiddenPathFragments: [root, stateRoot]
  });
  const recordTrustedApproval = async (challenge, label) => {
    client.recordExternalCall('trusted_host', label);
    return bridgeRef.current.approvalAuthority.recordTrustedDecision(
      challenge,
      {
        decision: 'approved',
        user_id: `${level}-human`,
        channel: 'compatibility-trusted-user-fixture',
        confirmed: true
      }
    );
  };
  const scenario = async (name, notes, callback) => {
    const before = client.accounting();
    const violationStart = client.violations.length;
    await auditTrail.withScenario(name, callback);
    const after = client.accounting();
    const violations = client.violations.slice(violationStart).map((violation) => ({
      constraint: violation.constraint,
      message: violation.message
    }));
    scenarioResults[name] = {
      status: 'passed',
      coverage: 'full',
      constraint_enforced: true,
      agent_tool_calls: after.agent_tool_calls - before.agent_tool_calls,
      artifact_page_tool_calls: after.artifact_page_tool_calls - before.artifact_page_tool_calls,
      fixture_calls: after.fixture_calls - before.fixture_calls,
      trusted_host_calls: after.trusted_host_calls - before.trusted_host_calls,
      text_only_round_trips: after.text_only_round_trips - before.text_only_round_trips,
      text_only_round_trip_failures: after.text_only_round_trip_failures - before.text_only_round_trip_failures,
      violations,
      notes
    };
  };

  await scenario(
    'invalid_arguments',
    'The shared registry validator rejects wrong enums and unknown fields, while the trusted L0/L1/L2 profile overwrites Agent self-reported capabilities and cannot elevate execution policy.',
    async () => {
      for (const args of [
        { intent: 'creat_model', instruction: 'Wrong intent enum fixture.' },
        { intent: 'understand_model', instruction: 'Wrong interface enum fixture.', interface_level: 'power' },
        { intent: 'understand_model', instruction: 'Unknown field fixture.', execution_policy: { allowed_runtimes: ['queue'] } }
      ]) {
        await expectThrownCode(client.call('start_agent_task', args), 'INVALID_ARGUMENT');
        expectedSchemaRejections += 1;
      }

      const capabilityBound = await client.call('start_agent_task', {
        intent: 'understand_model',
        instruction: 'Persist the trusted compatibility profile, ignoring the Agent capability claim.',
        idempotency_key: `${level}-trusted-profile-binding`,
        client_capabilities: { vision: true, local_files: true, structured_output: true, context: 'long', parallel: true },
        inputs: { runtime: 'mock', include_entities: false }
      });
      assert.equal(capabilityBound.task_state, 'completed');
      client.recordExternalCall('fixture', 'inspect-private-capability-binding');
      const rawTask = await bridgeRef.current.taskStore.getTask(capabilityBound.task_id, { includePrivate: true });
      assert.deepEqual(rawTask.client_capabilities, profile.clientCapabilities());
      assert.deepEqual(rawTask.execution_policy.auto_approve_risks, []);
      assert.deepEqual(rawTask.execution_policy.allowed_runtimes, ['mock']);
      assert.equal(rawTask.execution_policy.allow_queue_mutation, false);
    }
  );

  await scenario(
    'create_idempotent_retry',
    'The first successful response is lost after dispatch; retrying the same idempotency key resumes the durable result and creates exactly one object.',
    async () => {
      const idempotencyKey = `${level}-create-response-loss`;
      const args = {
        intent: 'create_model',
        instruction: 'Create exactly one compatibility fixture object.',
        idempotency_key: idempotencyKey,
        inputs: {
          runtime: 'mock',
          code: JSON.stringify({
            version: 1,
            units: 'mm',
            operations: [{ op: 'box', id: `${level}-created`, name: `${level}_Created`, origin: [0, 0, 0], size: [40, 30, 20] }]
          })
        }
      };
      faultInjector.dropNextResponse({ tool: 'start_agent_task' });
      recoveryAttempts += 1;
      await assert.rejects(client.call('start_agent_task', args), (error) => error?.code === 'SIMULATED_RESPONSE_LOST');
      const replay = await client.call('start_agent_task', args);
      assert.equal(replay.task_state, 'completed');
      assert.equal(replay.idempotent_replay, true);
      recoverySuccesses += 1;

      const inspected = await fixtureCall('inspect_model', { runtime: 'mock' });
      assert.equal(inspected.entities.filter((entity) => entity.id === `${level}-created`).length, 1);
      const audited = auditTrail.eventsForIdempotencyKey(idempotencyKey);
      assert.equal(audited.length, 2, 'response-loss retry must produce two Gateway dispatch audit events');
      assert.deepEqual(audited.map((event) => event.model_diff.changed), [true, false]);
      assert.deepEqual(audited[0].model_diff.modified_targets, [`target:${level}-created`]);
      assert.equal(audited[0].model_diff.model_revision_after, audited[1].model_diff.model_revision_after);
      assert.equal(audited.filter((event) => event.mutation_receipt).length, 0, 'create_model is audited by model diff; reviewed-edit receipts are not fabricated for it');
    }
  );

  await scenario(
    'understand_resume',
    'The Agent loses all volatile state except task_id, the mock server is recreated from disk, and the task resumes within the declared context budget; L2 also performs parallel read-only resumes.',
    async () => {
      await fixtureCall('build_model', { runtime: 'mock', code: JSON.stringify(largeUnderstandFixture(level)) });
      const understood = await client.call('start_agent_task', {
        intent: 'understand_model',
        instruction: 'Summarize this model and keep large details server-side.',
        idempotency_key: `${level}-understand`,
        inputs: { runtime: 'mock', include_entities: true }
      });
      assert.equal(understood.task_state, 'completed');
      assert.ok(JSON.stringify(understood).length <= profile.maxContextChars);
      understoodTaskId = understood.task_id;
      state.set('task_id', understood.task_id);
      state.set('discarded_scratch', { prior_response: 'intentionally volatile' });
      recoveryAttempts += 1;
      const lost = faultInjector.loseAgentState({ retain: ['task_id'] });
      assert.deepEqual(lost.retained, ['task_id']);
      assert.equal(state.has('discarded_scratch'), false);
      client.recordExternalCall('fixture', 'restart-mock-server');
      bridgeRef.current = new SketchUpBridge(options);
      const resumed = await client.call('resume_agent_task', { task_id: state.get('task_id') });
      assert.equal(resumed.task_state, 'completed');
      assert.ok(JSON.stringify(resumed).length <= profile.maxContextChars);
      if (level === 'L2') {
        const parallel = await Promise.all([
          client.call('resume_agent_task', { task_id: understood.task_id }),
          client.call('resume_agent_task', { task_id: understood.task_id })
        ]);
        assert.ok(parallel.every((item) => item.task_state === 'completed'));
      }
      recoverySuccesses += 1;
    }
  );

  await scenario(
    'ambiguous_edit',
    'Two equal cabinet candidates require clarification; an Agent warning acknowledgement cannot select a target or mutate the model, while an explicit persistent reference produces a preview-only proposal.',
    async () => {
      await fixtureCall('build_model', { runtime: 'mock', code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [
          { op: 'reset' },
          { op: 'box', id: 'left-cabinet', name: 'Left_Cabinet', origin: [0, 0, 0], size: [900, 600, 2200] },
          { op: 'box', id: 'right-cabinet', name: 'Right_Cabinet', origin: [1200, 0, 0], size: [900, 600, 2200] }
        ]
      }) });
      const before = modelRevisionForAdoption(await fixtureCall('adopt_open_model', { runtime: 'mock', recursive: true }));
      const ambiguous = await client.call('start_agent_task', {
        intent: 'propose_existing_model_edit',
        instruction: 'Rename the cabinet.',
        idempotency_key: `${level}-ambiguous-cabinet`,
        inputs: {
          runtime: 'mock',
          target_query: 'cabinet',
          action: 'rename',
          parameters: { new_name: 'Reviewed_Cabinet' },
          candidate_limit: 2,
          save_model: false
        }
      });
      assert.equal(ambiguous.task_state, 'awaiting_input');
      const ambiguousData = await envelopeData(ambiguous);
      const candidates = ambiguousData?.proposal?.candidates || [];
      assert.equal(candidates.length, 2, JSON.stringify(ambiguous));
      topKAttempts += 1;
      const names = new Set(candidates.map((candidate) => candidate.summary?.value?.name));
      if (names.has('Left_Cabinet') && names.has('Right_Cabinet')) topKHits += 1;

      invalidRetryAttempts += 1;
      const ignored = await client.call('submit_agent_task_input', {
        task_id: ambiguous.task_id,
        idempotency_key: `${level}-ignored-warning`,
        input: { warning_acknowledged: true }
      });
      assert.equal(ignored.task_state, 'awaiting_input');
      invalidRetriesBlocked += 1;
      const afterIgnored = modelRevisionForAdoption(await fixtureCall('adopt_open_model', { runtime: 'mock', recursive: true }));
      assert.equal(afterIgnored, before);
      const ignoredAudit = auditTrail.eventsForIdempotencyKey(`${level}-ignored-warning`);
      assert.equal(ignoredAudit.length, 1);
      assert.equal(ignoredAudit[0].model_diff.changed, false);
      assert.deepEqual(ignoredAudit[0].model_diff.modified_targets, []);

      const clarified = await client.call('submit_agent_task_input', {
        task_id: ambiguous.task_id,
        idempotency_key: `${level}-explicit-cabinet`,
        input: { target_ref: candidates[0].persistent_ref }
      });
      assert.equal(clarified.task_state, 'awaiting_review', JSON.stringify(clarified));
      const clarifiedData = await envelopeData(clarified);
      assert.equal(clarifiedData?.proposal?.execution_allowed, false);
      assert.equal(clarifiedData?.proposal?.operation_proposal?.length, 1);
    }
  );

  await scenario(
    'make_unique',
    'A deep shared occurrence is proposed with make_unique, promoted by its server-bound proposal, approved through a trusted user fixture, and applied to exactly one occurrence while its sibling remains unchanged.',
    async () => {
      await fixtureCall('build_model', { runtime: 'mock', code: JSON.stringify(sharedFixture()) });
      const adoption = await fixtureCall('adopt_open_model', { runtime: 'mock', recursive: true, recursive_limit: 5000 });
      const leaves = adoption.recursive_index.filter((entry) => entry.name === 'Shared_Leaf').sort((left, right) => left.entity_path.localeCompare(right.entity_path));
      assert.equal(leaves.length, 2);
      const selectedRef = { entity_path: leaves[0].entity_path };
      const selectedKey = targetKey(selectedRef);
      const siblingBefore = compatibilityEntityFingerprint(leaves[1]);
      const selectedBefore = compatibilityEntityFingerprint(leaves[0]);
      const proposal = await client.call('start_agent_task', {
        intent: 'propose_existing_model_edit',
        instruction: 'Rename only this shared leaf occurrence.',
        idempotency_key: `${level}-make-unique-proposal`,
        inputs: {
          runtime: 'mock',
          target_ref: selectedRef,
          action: 'rename',
          parameters: { new_name: 'Shared_Leaf_Reviewed' },
          shared_policy: 'make_unique',
          candidate_limit: 1,
          save_model: false
        }
      });
      assert.equal(proposal.task_state, 'awaiting_review', JSON.stringify(proposal));
      const proposalData = await envelopeData(proposal);
      assert.equal(proposalData?.proposal?.operation_proposal?.[0]?.instance_policy, 'make_unique');
      assert.equal(proposalData?.proposal?.execution_allowed, false);
      const promotion = (proposalData?.proposal?.next_action || proposal.next_action)?.arguments;
      assert.equal(promotion?.intent, 'reviewed_existing_model_edit', 'Agent-facing proposal must retain its bound promotion action');

      const reviewed = await client.call('start_agent_task', {
        ...promotion,
        idempotency_key: `${level}-make-unique-reviewed`
      });
      assert.equal(reviewed.task_state, 'awaiting_review', JSON.stringify(reviewed));
      const reviewedData = await envelopeData(reviewed);
      assert.equal(reviewedData?.risk_level, 'S2');
      await recordTrustedApproval(reviewedData.approval_challenge, 'approve-make-unique');
      const idempotencyKey = `${level}-make-unique-apply`;
      const applied = await client.call('submit_agent_task_input', {
        task_id: reviewed.task_id,
        idempotency_key: idempotencyKey,
        input: {}
      });
      assert.equal(applied.task_state, 'completed', JSON.stringify(applied));

      const after = await fixtureCall('adopt_open_model', { runtime: 'mock', recursive: true, recursive_limit: 5000 });
      const renamed = after.recursive_index.filter((entry) => entry.name === 'Shared_Leaf_Reviewed');
      const untouched = after.recursive_index.filter((entry) => entry.name === 'Shared_Leaf');
      assert.equal(renamed.length, 1);
      assert.equal(untouched.length, 1);
      assert.ok(renamed[0].entity_path.startsWith(leaves[0].entity_path.split('/group:')[0]));
      assert.ok(untouched[0].entity_path.startsWith(leaves[1].entity_path.split('/group:')[0]));
      assert.equal(compatibilityEntityFingerprint(untouched[0]), siblingBefore, 'make_unique changed the complete semantic sibling fingerprint');
      assert.notEqual(compatibilityEntityFingerprint(renamed[0]), selectedBefore, 'selected occurrence fingerprint must change');
      const audited = auditTrail.eventsForIdempotencyKey(idempotencyKey);
      assert.equal(audited.length, 1);
      assert.equal(audited[0].model_diff.changed, true);
      assert.deepEqual(audited[0].model_diff.modified_targets, [selectedKey]);
      assert.equal(audited[0].mutation_receipt?.integrity_verified, true);
      const persistedReceipt = await bridgeRef.current.taskStore.loadTaskMutationReceipt(reviewed.task_id);
      assert.equal(audited[0].mutation_receipt?.receipt_id, persistedReceipt.receipt_id);
    }
  );

  await scenario(
    'image_summary',
    'Reference and capture images enter through immutable server image handles; the server resolves them privately and returns structured evidence plus a review-gated correction patch without requiring Agent vision.',
    async () => {
      assert.ok(understoodTaskId, 'understand_resume must provide the server artifact owner task');
      const inputDir = path.join(stateRoot, 'compatibility-images');
      await fs.mkdir(inputDir, { recursive: true });
      const referencePath = path.join(inputDir, 'reference.png');
      const capturePath = path.join(inputDir, 'capture.png');
      await Promise.all([renderImage(referencePath, 40), renderImage(capturePath, 55)]);
      client.recordExternalCall('fixture', 'register-reference-image-artifact');
      const reference = await dispatcher.registerServerImageArtifact({
        filePath: referencePath,
        mediaType: 'image/png'
      });
      client.recordExternalCall('fixture', 'register-capture-image-artifact');
      const capture = await dispatcher.registerServerImageArtifact({
        filePath: capturePath,
        mediaType: 'image/png'
      });
      await fixtureCall('build_model', { runtime: 'mock', code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [
          { op: 'reset' },
          { op: 'box', id: 'image-target', name: 'Image_Target', origin: [0, 0, 0], size: [80, 40, 30] }
        ]
      }) });
      const visual = await client.call('start_agent_task', {
        intent: 'reference_image_correction',
        instruction: 'Propose a reference-driven correction from server artifacts.',
        idempotency_key: `${level}-image-summary`,
        inputs: {
          runtime: 'mock',
          reference_image_handle: reference.record.handle,
          capture_image_handle: capture.record.handle,
          correction_targets: [{ target_id: 'image-target' }],
          correction_operations: [{ op: 'transform_object', target_id: 'image-target', translate: [-15, 0, 0] }]
        }
      });
      assert.equal(visual.task_state, 'awaiting_review', JSON.stringify(visual));
      const visualData = await envelopeData(visual);
      assert.equal(visualData?.visual_agent_required, false);
      assert.equal(visualData?.correction_patch?.execution_allowed, false);
      assert.ok(visualData?.evidence?.alignment);
      assert.ok(visualData?.evidence?.difference);
      assert.equal(JSON.stringify(visual).includes(referencePath), false);
      assert.equal(JSON.stringify(visual).includes(capturePath), false);
      assert.equal(JSON.stringify(visualData).includes(referencePath), false);
      assert.equal(JSON.stringify(visualData).includes(capturePath), false);
      assert.doesNotMatch(JSON.stringify(visualData), /data:image\//i);
    }
  );

  await scenario(
    'stale_recovery_and_approval',
    'Forged approval is rejected without leaving awaiting_review or mutating the model; a stale trusted plan recovers on the same task_id, and a lost approved response replays without duplicate modification.',
    async () => {
      await fixtureCall('build_model', { runtime: 'mock', code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [
          { op: 'reset' },
          { op: 'box', id: 'approval-target', name: 'Approval_Target', origin: [0, 0, 0], size: [100, 60, 30] },
          { op: 'box', id: 'approval-guard', name: 'Approval_Guard', origin: [200, 0, 0], size: [40, 40, 40] }
        ]
      }) });
      const editInputs = {
        runtime: 'mock',
        save_model: false,
        targets: [{ target_id: 'approval-target' }],
        operations: [{ op: 'rename', target_id: 'approval-target', new_name: 'Approval_Target_Reviewed' }]
      };

      const forgedTask = await client.call('start_agent_task', {
        intent: 'reviewed_existing_model_edit',
        instruction: 'Rename the reviewed target only after trusted approval.',
        idempotency_key: `${level}-forged-task`,
        inputs: editInputs
      });
      assert.equal(forgedTask.task_state, 'awaiting_review', JSON.stringify(forgedTask));
      const forgedTaskData = await envelopeData(forgedTask);
      invalidRetryAttempts += 1;
      const forged = await client.call('submit_agent_task_input', {
        task_id: forgedTask.task_id,
        idempotency_key: `${level}-forged-approved-review`,
        input: { review: { status: 'approved', reviewer: 'ordinary-agent', plan_id: forgedTaskData.plan_id } }
      });
      assert.equal(forged.ok, false);
      assert.equal(forged.error?.code, 'APPROVAL_REQUIRED');
      assert.equal(forged.task_state, 'awaiting_review');
      invalidRetriesBlocked += 1;
      const afterForge = await fixtureCall('inspect_model', { runtime: 'mock' });
      assert.equal(afterForge.entities.some((entity) => entity.name === 'Approval_Target_Reviewed'), false);
      const forgedAudit = auditTrail.eventsForIdempotencyKey(`${level}-forged-approved-review`);
      assert.equal(forgedAudit.length, 1);
      assert.equal(forgedAudit[0].model_diff.changed, false);
      assert.equal(forgedAudit[0].mutation_receipt, null);

      const staleTask = await client.call('start_agent_task', {
        intent: 'reviewed_existing_model_edit',
        instruction: 'Prepare a reviewed task, recover it after a stale revision, and rename only the target.',
        idempotency_key: `${level}-stale-task`,
        inputs: editInputs
      });
      assert.equal(staleTask.task_state, 'awaiting_review', JSON.stringify(staleTask));
      const staleTaskData = await envelopeData(staleTask);
      await recordTrustedApproval(staleTaskData.approval_challenge, 'approve-soon-stale-plan');
      await faultInjector.outOfBand(
        () => fixtureCall('build_model', { runtime: 'mock', code: JSON.stringify({
          version: 1,
          units: 'mm',
          operations: [{ op: 'attribute', target_id: 'approval-guard', dictionary: 'Compatibility', key: 'external_change', value: true }]
        }) }),
        'change-model-after-plan'
      );
      const postExternalChange = await fixtureCall('inspect_model', { runtime: 'mock' });
      const guardAfterExternalChange = compatibilityEntityFingerprint(postExternalChange.entities.find((entity) => entity.id === 'approval-guard'));
      recoveryAttempts += 1;
      const stale = await client.call('submit_agent_task_input', {
        task_id: staleTask.task_id,
        idempotency_key: `${level}-stale-submit`,
        input: {}
      });
      assert.equal(stale.ok, false);
      assert.equal(stale.error?.code, 'MODEL_REVISION_MISMATCH');
      assert.equal(stale.task_state, 'awaiting_input');
      const staleAudit = auditTrail.eventsForIdempotencyKey(`${level}-stale-submit`);
      assert.equal(staleAudit.length, 1);
      assert.equal(staleAudit[0].model_diff.changed, false);
      assert.equal(staleAudit[0].mutation_receipt, null, 'stale rejection must not manufacture a durable commit receipt');

      const replanned = await client.call('submit_agent_task_input', {
        task_id: staleTask.task_id,
        idempotency_key: `${level}-same-task-replan`,
        input: {}
      });
      assert.equal(replanned.task_id, staleTask.task_id);
      assert.equal(replanned.task_state, 'awaiting_review', JSON.stringify(replanned));
      const replannedData = await envelopeData(replanned);
      assert.notEqual(replannedData?.approval_challenge?.challenge_id, staleTaskData?.approval_challenge?.challenge_id);
      recoverySuccesses += 1;
      const beforeApproved = await fixtureCall('inspect_model', { runtime: 'mock' });
      const targetBeforeApproved = compatibilityEntityFingerprint(beforeApproved.entities.find((entity) => entity.id === 'approval-target'));

      await recordTrustedApproval(replannedData.approval_challenge, 'approve-replanned-task');
      const approvedArgs = {
        task_id: staleTask.task_id,
        idempotency_key: `${level}-approved-response-loss`,
        input: {}
      };
      faultInjector.dropNextResponse({ tool: 'submit_agent_task_input' });
      recoveryAttempts += 1;
      await assert.rejects(client.call('submit_agent_task_input', approvedArgs), (error) => error?.code === 'SIMULATED_RESPONSE_LOST');
      const replay = await client.call('submit_agent_task_input', approvedArgs);
      assert.equal(replay.task_state, 'completed');
      assert.equal(replay.idempotent_replay, true);
      recoverySuccesses += 1;

      const final = await fixtureCall('inspect_model', { runtime: 'mock' });
      const finalTarget = final.entities.find((entity) => entity.id === 'approval-target');
      const finalGuard = final.entities.find((entity) => entity.id === 'approval-guard');
      assert.equal(finalTarget?.name, 'Approval_Target_Reviewed');
      assert.equal(finalGuard?.name, 'Approval_Guard');
      assert.notEqual(compatibilityEntityFingerprint(finalTarget), targetBeforeApproved, 'approved target fingerprint must change');
      assert.equal(compatibilityEntityFingerprint(finalGuard), guardAfterExternalChange, 'approved rename changed the complete semantic guard fingerprint');
      const approvedAudit = auditTrail.eventsForIdempotencyKey(approvedArgs.idempotency_key);
      assert.equal(approvedAudit.length, 2);
      assert.deepEqual(approvedAudit.map((event) => event.model_diff.changed), [true, false]);
      assert.deepEqual(approvedAudit[0].model_diff.modified_targets, ['target:approval-target']);
      assert.equal(approvedAudit[0].mutation_receipt?.integrity_verified, true);
      assert.equal(approvedAudit[0].mutation_receipt?.receipt_id, approvedAudit[1].mutation_receipt?.receipt_id);
      assert.equal(approvedAudit[0].mutation_receipt?.model_revision_after, approvedAudit[1].model_diff.model_revision_after);
    }
  );

  const accounting = client.accounting();
  const mutationEvents = auditTrail.mutationEvents();
  assert.equal(mutationEvents.length, 8, 'each capability level must derive exactly eight mutation-gate events from Gateway dispatch');
  for (const event of mutationEvents) ledger.recordGatewayEvent(event);
  assert.equal(auditTrail.verifiedReceiptIds().size, 2, 'make_unique and approved stale recovery must each have one durable receipt; retries must not add receipts');
  const hardGates = ledger.hardGates();
  assert.deepEqual(hardGates, zeroHardGates());
  const scenarios = Object.keys(scenarioResults).length;
  const contextViolations = client.violations.filter((entry) => entry.constraint === 'context_budget').length;
  const pathViolations = client.violations.filter((entry) => entry.constraint === 'local_files').length;
  const imageViolations = client.violations.filter((entry) => entry.constraint === 'vision').length;
  const concurrencyViolations = client.violations.filter((entry) => entry.constraint === 'max_in_flight').length;
  assert.equal(accounting.text_only_round_trip_failures, 0, `${level} must not lose or corrupt an Agent result at the JSON-text boundary`);
  if (profile.capabilities.structured_output === false) {
    assert.ok(accounting.text_only_round_trips > 0, `${level} must exercise the JSON-text result boundary`);
    assert.ok(Object.values(scenarioResults).every((result) => result.text_only_round_trips > 0), `${level} must cross the JSON-text boundary in every scenario`);
  } else {
    assert.equal(accounting.text_only_round_trips, 0, `${level} must retain its declared structured result transport`);
  }
  assert.equal(contextViolations + pathViolations + imageViolations + concurrencyViolations, 0);
  return {
    report: {
      level,
      capabilities: profile.clientCapabilities(),
      constraints: profile.reportConstraints({ enforced: true }),
      scenario_results: scenarioResults,
      gateway_audit: auditTrail.summary(),
      metrics: {
        scenarios,
        completed_scenarios: scenarios,
        completion_rate: 1,
        agent_tool_calls: accounting.agent_tool_calls,
        artifact_page_tool_calls: accounting.artifact_page_tool_calls,
        fixture_calls: accounting.fixture_calls,
        trusted_host_calls: accounting.trusted_host_calls,
        expected_schema_rejections: expectedSchemaRejections,
        unexpected_schema_errors: unexpectedSchemaErrors,
        invalid_retry_attempts: invalidRetryAttempts,
        invalid_retries_blocked: invalidRetriesBlocked,
        invalid_retries_executed: invalidRetriesExecuted,
        target_top_k: { attempts: topKAttempts, hits: topKHits, rate: topKAttempts ? topKHits / topKAttempts : 1 },
        recovery: {
          attempts: recoveryAttempts,
          successes: recoverySuccesses,
          rate: recoveryAttempts ? recoverySuccesses / recoveryAttempts : 1
        },
        context_budget_violations: contextViolations,
        path_violations: pathViolations,
        image_content_violations: imageViolations,
        concurrency_violations: concurrencyViolations,
        text_only_round_trips: accounting.text_only_round_trips,
        text_only_round_trip_failures: accounting.text_only_round_trip_failures
      },
      hard_gates: hardGates
    },
    mutationLedger: ledger.toJSON(),
    auditEvents: auditTrail.events.map((event) => structuredClone(event))
  };
}

function largeUnderstandFixture(level) {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      ...Array.from({ length: 48 }, (_, index) => ({
        op: 'box',
        id: `${level}-understand-${index + 1}`,
        name: `${level}_Understand_${String(index + 1).padStart(2, '0')}`,
        origin: [(index % 8) * 120, Math.floor(index / 8) * 100, 0],
        size: [80, 60, 40 + (index % 3) * 10]
      }))
    ]
  };
}

function sharedFixture() {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'component_definition', name: 'Shared_Leaf_Definition', operations: [
        { op: 'box', id: 'shared-leaf', name: 'Shared_Leaf', origin: [0, 0, 0], size: [100, 60, 30] }
      ] },
      { op: 'component_definition', name: 'Shared_Parent_Definition', operations: [
        { op: 'component_instance', id: 'shared-leaf-instance', name: 'Shared_Leaf_Instance', definition: 'Shared_Leaf_Definition', origin: [0, 0, 0] }
      ] },
      { op: 'component_instance', id: 'shared-parent-a', name: 'Shared_Parent_A', definition: 'Shared_Parent_Definition', origin: [0, 0, 0] },
      { op: 'component_instance', id: 'shared-parent-b', name: 'Shared_Parent_B', definition: 'Shared_Parent_Definition', origin: [250, 0, 0] }
    ]
  };
}

async function renderImage(filePath, x) {
  const svg = `<svg width="160" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="100" fill="white"/><rect x="${x}" y="30" width="70" height="40" fill="#222"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

async function readProjectedEnvelopeData({ client, profile, envelope, forbiddenPathFragments = [] }) {
  const handle = envelope?.presentation?.full_result_artifact || envelope?.data?.full_result_artifact;
  if (!handle) return envelope?.data;

  const handleMatch = /^artifact:(task_[0-9a-f-]+):[0-9a-f-]+$/i.exec(String(handle));
  assert.ok(handleMatch, 'A projected Agent result must expose an opaque task artifact handle.');
  assert.equal(handleMatch[1], envelope.task_id, 'The full-result artifact must be bound to its owning task.');

  let offset = 0;
  let maxChars = Math.max(256, Math.min(100000, profile.maxContextChars));
  let content = '';
  let pages = 0;
  while (true) {
    const page = await client.call('read_agent_artifact', {
      handle,
      task_id: envelope.task_id,
      offset,
      max_chars: maxChars
    });
    pages += 1;
    assert.ok(pages <= 10000, 'Projected Agent result pagination did not reach EOF.');
    assert.equal(page?.data?.kind, 'agent_artifact_page');
    assert.equal(page?.result?.kind, 'agent_artifact_page');
    assert.equal(page?.presentation?.projected, false, 'An artifact page must not recursively spill into another projection.');

    const artifact = page.data.artifact;
    assert.equal(artifact.handle, handle);
    assert.equal(artifact.offset, offset);
    assert.equal(artifact.encoding, 'utf8');
    assert.equal(typeof artifact.content, 'string');
    content += artifact.content;

    if (artifact.eof) {
      assert.equal(artifact.next_offset, null);
      assert.equal(artifact.next_action, null);
      assert.equal(page.next_action, null);
      break;
    }

    assert.equal(artifact.truncated, true);
    assert.ok(Number.isInteger(artifact.next_offset) && artifact.next_offset > offset);
    assert.deepEqual(page.next_action, artifact.next_action);
    assert.equal(artifact.next_action?.action, 'read_artifact');
    assert.equal(artifact.next_action?.handle, handle);
    assert.equal(artifact.next_action?.offset, artifact.next_offset);
    assert.ok(Number.isInteger(artifact.next_action?.max_chars));
    offset = artifact.next_action.offset;
    maxChars = artifact.next_action.max_chars;
  }

  for (const fragment of forbiddenPathFragments.filter(Boolean)) {
    assert.equal(content.includes(fragment), false, 'A capability-safe projection must not disclose a server-local path.');
  }
  assert.doesNotMatch(content, /(?:file:\/\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:\\\\)/, 'A capability-safe projection must not disclose an absolute local path.');
  assert.doesNotMatch(content, /data:image\//i, 'A capability-safe projection must not disclose inline image bytes.');
  assert.doesNotMatch(content, /iVBORw0KGgo/, 'A no-vision projection must not disclose PNG base64 bytes.');
  const document = JSON.parse(content);
  assert.equal(document.version, 'agent-response-projection.v1');
  assert.equal(document.kind, 'agent_response_projection');
  assert.equal(document.task_id, envelope.task_id);
  return document.result;
}

async function expectThrownCode(promise, code) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error?.code, code, error?.message);
    return error;
  }
  assert.fail(`Expected ${code}.`);
}

function targetKey(reference) {
  if (reference && typeof reference === 'object') {
    if (reference.entity_path) return `path:${reference.entity_path}`;
    if (reference.target_id !== undefined) return `target:${reference.target_id}`;
  }
  return `target:${String(reference)}`;
}

function zeroHardGates() {
  return {
    wrong_object_automatic_execution: 0,
    unauthorized_s2_s4_execution: 0,
    duplicate_request_duplicate_modification: 0
  };
}

async function assertReportSchema(report) {
  const schema = JSON.parse(await fs.readFile(new URL('../schema/agent-compatibility-report-v1.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
}

function aggregateMetrics(levels) {
  const scenarios = sumNested(levels, 'metrics', 'scenarios');
  const completed = sumNested(levels, 'metrics', 'completed_scenarios');
  const topKAttempts = levels.reduce((total, item) => total + item.metrics.target_top_k.attempts, 0);
  const topKHits = levels.reduce((total, item) => total + item.metrics.target_top_k.hits, 0);
  const recoveryAttempts = levels.reduce((total, item) => total + item.metrics.recovery.attempts, 0);
  const recoverySuccesses = levels.reduce((total, item) => total + item.metrics.recovery.successes, 0);
  return {
    scenarios,
    completed_scenarios: completed,
    completion_rate: scenarios ? completed / scenarios : 1,
    agent_tool_calls: sumNested(levels, 'metrics', 'agent_tool_calls'),
    artifact_page_tool_calls: sumNested(levels, 'metrics', 'artifact_page_tool_calls'),
    fixture_calls: sumNested(levels, 'metrics', 'fixture_calls'),
    trusted_host_calls: sumNested(levels, 'metrics', 'trusted_host_calls'),
    expected_schema_rejections: sumNested(levels, 'metrics', 'expected_schema_rejections'),
    unexpected_schema_errors: sumNested(levels, 'metrics', 'unexpected_schema_errors'),
    invalid_retry_attempts: sumNested(levels, 'metrics', 'invalid_retry_attempts'),
    invalid_retries_blocked: sumNested(levels, 'metrics', 'invalid_retries_blocked'),
    invalid_retries_executed: sumNested(levels, 'metrics', 'invalid_retries_executed'),
    target_top_k: { attempts: topKAttempts, hits: topKHits, rate: topKAttempts ? topKHits / topKAttempts : 1 },
    recovery: { attempts: recoveryAttempts, successes: recoverySuccesses, rate: recoveryAttempts ? recoverySuccesses / recoveryAttempts : 1 },
    context_budget_violations: sumNested(levels, 'metrics', 'context_budget_violations'),
    path_violations: sumNested(levels, 'metrics', 'path_violations'),
    image_content_violations: sumNested(levels, 'metrics', 'image_content_violations'),
    concurrency_violations: sumNested(levels, 'metrics', 'concurrency_violations'),
    text_only_round_trips: sumNested(levels, 'metrics', 'text_only_round_trips'),
    text_only_round_trip_failures: sumNested(levels, 'metrics', 'text_only_round_trip_failures')
  };
}

function aggregateGatewayAudit(runs) {
  const events = runs.flatMap((run) => run.auditEvents || []);
  const mutationEvents = runs.reduce((total, run) => total + Number(run.report.gateway_audit?.mutation_events || 0), 0);
  const receiptIds = new Set(events
    .filter((event) => event.mutation_receipt?.integrity_verified === true)
    .map((event) => event.mutation_receipt.receipt_id));
  return {
    version: 'agent-gateway-mutation-audit-summary.v1',
    source: 'actual_gateway_dispatch_and_model_diff',
    events: events.length,
    mutation_events: mutationEvents,
    model_diffs: mutationEvents,
    durable_receipts: receiptIds.size,
    event_hash: sha256Canonical(events.map((event) => event.event_hash))
  };
}

function sumNested(items, parent, key) {
  return items.reduce((total, item) => total + Number(item[parent]?.[key] || 0), 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.stdout.write(`${JSON.stringify(await runAgentCompatibilityHarness(), null, 2)}\n`);
