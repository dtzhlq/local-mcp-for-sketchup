import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { normalizeClientCapabilities, normalizeExecutionPolicy } from '../src/agent-contract.mjs';
import { AgentTaskStore } from '../src/agent-task-store.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-gateway-mutation-recovery-'));
const options = {
  mock: { sessionPath: path.join(root, 'mock-session.json') },
  agentContract: { rootDir: path.join(root, 'agent-state'), idempotencyLeaseMs: 25 },
  approval: {
    stateDir: path.join(root, 'approvals'),
    secret: 'mutation-recovery-test-secret-is-longer-than-32-bytes'
  },
  executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
};

try {
  const bridge = new SketchUpBridge(options);
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'recovery-box', name: 'Recovery_Box', origin: [0, 0, 0], size: [100, 80, 30] }
    ]
  }) });
  const originalMockBuild = bridge.mockRuntime.buildModel.bind(bridge.mockRuntime);
  bridge.mockRuntime.buildModel = async (code) => ({
    ...await originalMockBuild(code),
    mutation_receipt: {
      version: 'mutation-receipt.v1',
      kind: 'sketchup_mutation_receipt',
      operation: 'Test-only receipt propagation probe',
      commit_state: 'committed',
      committed_at: new Date().toISOString()
    }
  });

  const first = await prepareReviewedFaceEdit(bridge, {
    createKey: 'recovery-create-after-receipt',
    distance: 5
  });
  const firstRevisionBefore = await currentRevision(bridge);
  const originalRecord = bridge.taskStore.recordTaskMutationReceipt.bind(bridge.taskStore);
  let injectedAfterReceipt = false;
  bridge.taskStore.recordTaskMutationReceipt = async (args) => {
    const receipt = await originalRecord(args);
    if (!injectedAfterReceipt) {
      injectedAfterReceipt = true;
      throw new Error('simulated_process_exit_after_durable_receipt');
    }
    return receipt;
  };
  const interruptedAfterReceipt = await bridge.submit_agent_task_input({
    task_id: first.task_id,
    idempotency_key: 'recovery-apply-after-receipt',
    input: {}
  });
  assert.equal(interruptedAfterReceipt.ok, false);
  assert.equal(interruptedAfterReceipt.error.code, 'MUTATION_RECOVERY_REQUIRED');
  assert.equal(interruptedAfterReceipt.task_state, 'executing');
  const firstRevisionCommitted = await currentRevision(bridge);
  assert.notEqual(firstRevisionCommitted, firstRevisionBefore, 'the simulated crash must happen after exactly one mutation');

  const restartedAfterReceipt = new SketchUpBridge(options);
  const concurrentRecoveryBridge = new SketchUpBridge(options);
  const concurrentRecoveryResults = await Promise.all([
    restartedAfterReceipt.resume_agent_task({ task_id: first.task_id }),
    concurrentRecoveryBridge.resume_agent_task({ task_id: first.task_id })
  ]);
  const finalizedAfterReceipt = concurrentRecoveryResults.find((result) => result.ok && result.task_state === 'completed');
  const concurrentRecoveryConflicts = concurrentRecoveryResults.filter((result) => result.error?.code === 'TASK_STATE_CONFLICT');
  assert.ok(finalizedAfterReceipt, 'one recovery owner must finalize the task');
  assert.ok(concurrentRecoveryResults.every((result) => result.task_state === 'completed'
    || result.error?.code === 'TASK_STATE_CONFLICT'));
  assert.equal(concurrentRecoveryConflicts.length, 1, 'the durable per-task request lock must reject the concurrent recovery contender');
  assert.equal(concurrentRecoveryConflicts[0].ok, false);
  assert.equal(concurrentRecoveryConflicts[0].retryable, true);
  assert.equal(concurrentRecoveryConflicts[0].next_action.action, 'resume_task');
  assert.equal(concurrentRecoveryConflicts[0].next_action.retry, 'after_current_request');
  assert.equal(concurrentRecoveryConflicts[0].next_action.task_id, first.task_id);
  assert.equal(finalizedAfterReceipt.ok, true);
  assert.equal(finalizedAfterReceipt.task_state, 'completed');
  assert.equal(finalizedAfterReceipt.idempotent_replay, true);
  assert.match(finalizedAfterReceipt.data.mutation_receipt.receipt_id, /^mutation-receipt-[0-9a-f]{24}$/);
  assert.deepEqual(Object.keys(finalizedAfterReceipt.data.mutation_receipt).sort(), ['receipt_id', 'status']);
  assert.equal(await currentRevision(restartedAfterReceipt), firstRevisionCommitted, 'restart finalization must not replay geometry');
  assert.equal(JSON.stringify(finalizedAfterReceipt).includes('trusted_mock_application_receipt'), false);
  assert.equal(JSON.stringify(finalizedAfterReceipt).includes('applied_result'), false);
  assert.equal(JSON.stringify(finalizedAfterReceipt).includes(root), false);
  const finalizedProjection = await expandedEnvelopeDocument(restartedAfterReceipt, finalizedAfterReceipt);
  const evaluationArtifact = finalizedProjection.artifacts.find((artifact) => artifact.label === 'evaluation');
  assert.ok(evaluationArtifact);
  const evaluationText = await readArtifactText(restartedAfterReceipt, evaluationArtifact.handle, first.task_id);
  assert.equal(evaluationText.includes('mutation-receipt.v1'), false, 'native receipt transport evidence must be stripped from public artifacts');
  const manifestArtifact = finalizedProjection.artifacts.find((artifact) => artifact.label === 'manifest');
  assert.ok(manifestArtifact);
  const manifestText = await readArtifactText(restartedAfterReceipt, manifestArtifact.handle, first.task_id);
  assert.equal(manifestText.includes('mutation-receipt.v1'), false, 'iteration manifest artifacts must not expose native receipt payloads');

  const replayAfterReceipt = await restartedAfterReceipt.submit_agent_task_input({
    task_id: first.task_id,
    idempotency_key: 'recovery-apply-after-receipt',
    input: {}
  });
  assert.equal(replayAfterReceipt.ok, true);
  assert.equal(replayAfterReceipt.idempotent_replay, true);
  assert.equal(await currentRevision(restartedAfterReceipt), firstRevisionCommitted);

  const second = await prepareReviewedFaceEdit(restartedAfterReceipt, {
    createKey: 'recovery-create-inside-finalizer',
    distance: 3
  });
  const secondRevisionBefore = await currentRevision(restartedAfterReceipt);
  const originalRegisterArtifacts = restartedAfterReceipt.agentGateway.registerArtifacts.bind(restartedAfterReceipt.agentGateway);
  let injectedInsideFinalizer = false;
  restartedAfterReceipt.agentGateway.registerArtifacts = async (...args) => {
    const handles = await originalRegisterArtifacts(...args);
    if (args[0] === second.task_id && !injectedInsideFinalizer) {
      injectedInsideFinalizer = true;
      throw new Error('simulated_process_exit_inside_post_commit_artifact_registration');
    }
    return handles;
  };
  const interruptedInsideFinalizer = await restartedAfterReceipt.submit_agent_task_input({
    task_id: second.task_id,
    idempotency_key: 'recovery-apply-inside-finalizer',
    input: {}
  });
  assert.equal(interruptedInsideFinalizer.ok, false);
  assert.equal(interruptedInsideFinalizer.error.code, 'MUTATION_RECOVERY_REQUIRED');
  assert.equal(interruptedInsideFinalizer.task_state, 'verifying');
  const secondRevisionCommitted = await currentRevision(restartedAfterReceipt);
  assert.notEqual(secondRevisionCommitted, secondRevisionBefore);

  const restartedInsideFinalizer = new SketchUpBridge(options);
  const finalizedInsideFinalizer = await restartedInsideFinalizer.resume_agent_task({ task_id: second.task_id });
  assert.equal(finalizedInsideFinalizer.ok, true);
  assert.equal(finalizedInsideFinalizer.task_state, 'completed');
  assert.equal(await currentRevision(restartedInsideFinalizer), secondRevisionCommitted, 'artifact finalizer retry must not replay geometry');
  const completedTask = await restartedInsideFinalizer.taskStore.getTask(second.task_id, { includePrivate: true });
  const artifactPathValues = Object.values(completedTask.private.artifact_paths || {});
  assert.equal(new Set(artifactPathValues).size, artifactPathValues.length, 'step-idempotent artifact registration must not duplicate handles for one path');

  const terminal = await prepareReviewedFaceEdit(restartedInsideFinalizer, {
    createKey: 'recovery-create-after-terminal-transition',
    distance: 1
  });
  const originalComplete = restartedInsideFinalizer.taskStore.completeTaskOperation.bind(restartedInsideFinalizer.taskStore);
  let completionPersistenceInterrupted = false;
  restartedInsideFinalizer.taskStore.completeTaskOperation = async (claim, taskId, options) => {
    if (taskId === terminal.task_id && !completionPersistenceInterrupted) {
      completionPersistenceInterrupted = true;
      throw new Error('simulated_process_exit_after_terminal_transition');
    }
    return originalComplete(claim, taskId, options);
  };
  const terminalResponse = await restartedInsideFinalizer.submit_agent_task_input({
    task_id: terminal.task_id,
    idempotency_key: 'recovery-apply-after-terminal-transition',
    input: {}
  });
  assert.equal(terminalResponse.ok, true, 'a completed task must not be rewritten as recovery failure when only response persistence stops');
  assert.equal(terminalResponse.task_state, 'completed');
  const terminalRevision = await currentRevision(restartedInsideFinalizer);
  const restartedAfterTerminal = new SketchUpBridge(options);
  const terminalReplay = await restartedAfterTerminal.submit_agent_task_input({
    task_id: terminal.task_id,
    idempotency_key: 'recovery-apply-after-terminal-transition',
    input: {}
  });
  assert.equal(terminalReplay.ok, true);
  assert.equal(terminalReplay.idempotent_replay, true);
  assert.equal(terminalReplay.data.kind, 'reviewed_existing_model_edit_result');
  assert.equal(await currentRevision(restartedAfterTerminal), terminalRevision, 'terminal response recovery must not replay geometry');

  const drifted = await prepareReviewedFaceEdit(restartedAfterTerminal, {
    createKey: 'recovery-create-after-receipt-drift',
    distance: 2
  });
  const originalDriftRecord = restartedAfterTerminal.taskStore.recordTaskMutationReceipt.bind(restartedAfterTerminal.taskStore);
  let driftReceiptInterrupted = false;
  restartedAfterTerminal.taskStore.recordTaskMutationReceipt = async (args) => {
    const receipt = await originalDriftRecord(args);
    if (!driftReceiptInterrupted) {
      driftReceiptInterrupted = true;
      throw new Error('simulated_process_exit_before_revision_drift');
    }
    return receipt;
  };
  const driftInterrupted = await restartedAfterTerminal.submit_agent_task_input({
    task_id: drifted.task_id,
    idempotency_key: 'recovery-apply-after-receipt-drift',
    input: {}
  });
  assert.equal(driftInterrupted.error.code, 'MUTATION_RECOVERY_REQUIRED');
  await restartedAfterTerminal.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [{ op: 'material', name: 'External_Drift', color: '#123456' }]
  }) });
  const driftRevision = await currentRevision(restartedAfterTerminal);
  const restartedAfterDrift = new SketchUpBridge(options);
  const driftBlocked = await restartedAfterDrift.resume_agent_task({ task_id: drifted.task_id });
  assert.equal(driftBlocked.ok, false);
  assert.equal(driftBlocked.error.code, 'MUTATION_RECOVERY_REQUIRED');
  assert.equal(driftBlocked.task_state, 'verifying');
  assert.equal(await currentRevision(restartedAfterDrift), driftRevision, 'revision drift must block finalization without replaying the committed mutation');

  const committedBeforeTaskReceipt = await prepareReviewedFaceEdit(restartedAfterDrift, {
    createKey: 'recovery-create-postcommit-before-task-receipt',
    distance: 4
  });
  const committedBeforeReceiptTask = await restartedAfterDrift.taskStore.getTask(committedBeforeTaskReceipt.task_id, { includePrivate: true });
  const committedBeforeReceiptPlanId = committedBeforeReceiptTask.private.existing_edit_plan.plan_id;
  const revisionBeforeUnjournaledCommit = await currentRevision(restartedAfterDrift);
  const originalPrototypeApply = SketchUpBridge.prototype.apply_reviewed_model_edit;
  let injectedAfterNativeApplication = false;
  SketchUpBridge.prototype.apply_reviewed_model_edit = async function injectedPostcommitFailure(options) {
    const result = await originalPrototypeApply.call(this, options);
    if (!injectedAfterNativeApplication && options.plan?.plan_id === committedBeforeReceiptPlanId) {
      injectedAfterNativeApplication = true;
      throw new Error('simulated_failure_after_application_before_task_receipt');
    }
    return result;
  };
  let unjournaledCommit;
  try {
    unjournaledCommit = await restartedAfterDrift.submit_agent_task_input({
      task_id: committedBeforeTaskReceipt.task_id,
      idempotency_key: 'recovery-apply-postcommit-before-task-receipt',
      input: {}
    });
  } finally {
    SketchUpBridge.prototype.apply_reviewed_model_edit = originalPrototypeApply;
  }
  assert.equal(unjournaledCommit.ok, false);
  assert.equal(unjournaledCommit.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(unjournaledCommit.error.next_action.action, 'inspect_failure_then_start_new_task');
  assert.equal(unjournaledCommit.task_state, 'failed');
  const revisionAfterUnjournaledCommit = await currentRevision(restartedAfterDrift);
  assert.notEqual(revisionAfterUnjournaledCommit, revisionBeforeUnjournaledCommit, 'the injected failure must happen after one committed mutation');
  const restartedAfterUnjournaledCommit = new SketchUpBridge(options);
  const unjournaledResume = await restartedAfterUnjournaledCommit.resume_agent_task({ task_id: committedBeforeTaskReceipt.task_id });
  assert.equal(unjournaledResume.ok, false);
  assert.equal(unjournaledResume.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(unjournaledResume.error.next_action.action, 'inspect_failure_then_start_new_task');
  assert.equal(unjournaledResume.task_state, 'failed');
  assert.equal(await currentRevision(restartedAfterUnjournaledCommit), revisionAfterUnjournaledCommit, 'an unjournaled postcommit failure must never replay geometry');

  const unknownStoreRoot = path.join(root, 'unknown-outcome-state');
  const unknownStore = new AgentTaskStore({ rootDir: unknownStoreRoot, idempotencyLeaseMs: 25 });
  const unknownTask = await unknownStore.createTask({
    intent: 'reviewed_existing_model_edit',
    instruction: 'Represent an interrupted mutation without a durable receipt.',
    clientCapabilities: normalizeClientCapabilities(),
    executionPolicy: normalizeExecutionPolicy({ allowed_runtimes: ['mock'] }),
    inputs: { runtime: 'mock' }
  });
  await unknownStore.transition(unknownTask.task.task_id, 'understanding');
  await unknownStore.transition(unknownTask.task.task_id, 'awaiting_review');
  const unknownClaim = await unknownStore.claimTaskOperation({
    taskId: unknownTask.task.task_id,
    operation: 'submit_agent_task_input',
    idempotencyKey: 'unknown-outcome-claim',
    input: { approval_token: 'opaque' }
  });
  await unknownStore.transition(unknownTask.task.task_id, 'approved');
  await unknownStore.transition(unknownTask.task.task_id, 'executing');
  const unknownRecord = JSON.parse(await fs.readFile(unknownClaim.filePath, 'utf8'));
  await fs.writeFile(unknownClaim.filePath, `${JSON.stringify({
    ...unknownRecord,
    owner_pid: null,
    lease_expires_at: new Date(0).toISOString()
  }, null, 2)}\n`);
  const unknownBridge = new SketchUpBridge({
    ...options,
    agentContract: { rootDir: unknownStoreRoot, idempotencyLeaseMs: 25 }
  });
  const unknownResume = await unknownBridge.resume_agent_task({ task_id: unknownTask.task.task_id });
  assert.equal(unknownResume.ok, false);
  assert.equal(unknownResume.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(unknownResume.error.details.outcome_unknown, true);
  assert.equal(unknownResume.task_state, 'executing');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    durable_receipt_restart_finalized: true,
    finalizer_step_restart_finalized: true,
    terminal_response_persistence_recovered: true,
    concurrent_finalizer_single_owner: true,
    model_mutation_replayed: false,
    artifact_registration_duplicate: false,
    public_receipt_opaque: true,
    native_receipt_public_artifact_leak: false,
    after_revision_drift_blocked: true,
    no_receipt_outcome_unknown: true,
    postcommit_before_task_receipt_not_replayed: true,
    live_queue_called: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function prepareReviewedFaceEdit(bridge, { createKey, distance }) {
  const adoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true });
  const face = adoption.recursive_index.find((entry) => entry.entity_type === 'face');
  assert.ok(face?.entity_path);
  const target = { entity_path: face.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
  const started = await bridge.start_agent_task({
    intent: 'reviewed_existing_model_edit',
    instruction: `Apply one reviewed ${distance} mm face change.`,
    idempotency_key: createKey,
    inputs: {
      runtime: 'mock',
      save_model: false,
      targets: [target],
      operations: [{ op: 'pushpull_face', ...target, distance }]
    }
  });
  assert.equal(started.ok, true);
  assert.equal(started.task_state, 'awaiting_review');
  await bridge.approvalAuthority.recordTrustedDecision(
    started.data.approval_challenge,
    { decision: 'approved', user_id: 'recovery-test-user', channel: 'trusted-mock-test', confirmed: true }
  );
  return { task_id: started.task_id };
}

async function currentRevision(bridge) {
  return modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true }));
}

async function expandedEnvelopeDocument(bridge, envelope) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) {
    return {
      result: envelope.data,
      next_action: envelope.next_action,
      artifacts: envelope.artifacts || []
    };
  }
  return JSON.parse(await readArtifactText(bridge, handle, envelope.task_id));
}

async function readArtifactText(bridge, handle, taskId) {
  let offset = 0;
  let content = '';
  while (true) {
    const page = await bridge.read_agent_artifact({
      handle,
      task_id: taskId,
      offset,
      max_chars: 100000
    });
    assert.equal(page.ok, true);
    assert.equal(typeof page.data?.artifact?.content, 'string');
    content += page.data.artifact.content;
    if (page.data.artifact.eof) return content;
    offset = page.data.artifact.next_offset;
  }
}
