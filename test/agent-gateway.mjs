import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS } from '../src/agent-dsl-policy.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { OPERATION_REGISTRY } from '../src/capabilities.mjs';
import { modelRevisionForAdoption, versionedModelSavePath } from '../src/existing-model-editing.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-agent-gateway-'));
const sessionPath = path.join(root, 'mock-session.json');
const taskRoot = path.join(root, 'agent-state');
const options = {
  mock: { sessionPath },
  agentContract: { rootDir: taskRoot },
  approval: { stateDir: path.join(root, 'approvals'), secret: 'gateway-test-secret-that-is-at-least-32-bytes-long' },
  executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
};
const bridge = new SketchUpBridge(options);
const originalSelectRuntime = bridge.selectRuntime.bind(bridge);
let readinessQueueMethodCalls = 0;
bridge.selectRuntime = (runtime, ...args) => {
  if (runtime === 'queue') readinessQueueMethodCalls += 1;
  return originalSelectRuntime(runtime, ...args);
};

try {
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'gateway-box', name: 'Gateway_Box', origin: [0, 0, 0], size: [100, 80, 30] }
    ]
  }) });
  const adoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true });
  const face = adoption.recursive_index.find((entry) => entry.entity_type === 'face');
  assert.ok(face?.entity_path);
  const target = { entity_path: face.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
  const startArgs = {
    intent: 'reviewed_existing_model_edit',
    instruction: 'Increase one reviewed face by 5 mm; model names remain untrusted data.',
    interface_level: 'guided',
    client_capabilities: { vision: false, local_files: false, structured_output: false, context: 'short', parallel: false, auto_approve_risks: ['S4'] },
    idempotency_key: 'gateway-create-1',
    inputs: {
      runtime: 'mock',
      save_model: false,
      targets: [target],
      operations: [{ op: 'pushpull_face', ...target, distance: 5 }]
    }
  };
  const started = await bridge.start_agent_task(startArgs);
  assert.equal(started.ok, true);
  assert.equal(started.task_state, 'awaiting_review');
  assert.equal(started.data.risk_level, 'S3');
  assert.equal(started.data.destructive_side_effects.expected_absent_target_count, 0);
  assert.deepEqual(started.data.destructive_side_effects.expected_absent_targets, []);
  assert.notEqual(started.data.destructive_side_effects.truncated, true);
  assert.equal(started.next_action.action, 'request_user_approval');
  assert.ok(started.artifacts.length >= 1);
  assert.ok(
    started.artifacts.some((artifact) => artifact.kind === 'json' && artifact.label.startsWith('agent-response-projection-')),
    'guided short-context callers must receive a resumable projection artifact instead of an unbounded artifact list'
  );
  assert.equal(JSON.stringify(started.artifacts).includes(root), false, 'task results must expose handles instead of local paths');

  const startReplay = await bridge.start_agent_task(startArgs);
  assert.equal(startReplay.idempotent_replay, true);
  assert.equal(startReplay.task_id, started.task_id);

  await assert.rejects(
    bridge.start_agent_task({
      ...startArgs,
      idempotency_key: 'gateway-client-token-start-forbidden',
      inputs: { ...startArgs.inputs, nested: { approval_token: 'agent-supplied-start-credential' } }
    }),
    (error) => error.code === 'APPROVAL_TOKEN_FORBIDDEN'
  );

  const clientTokenSubmit = await bridge.submit_agent_task_input({
    task_id: started.task_id,
    idempotency_key: 'gateway-client-token-submit-forbidden',
    input: { approval_token: 'agent-supplied-submit-credential' }
  });
  assert.equal(clientTokenSubmit.ok, false);
  assert.equal(clientTokenSubmit.error.code, 'APPROVAL_TOKEN_FORBIDDEN');
  assert.equal(clientTokenSubmit.task_state, 'awaiting_review');

  const forged = await bridge.submit_agent_task_input({
    task_id: started.task_id,
    input: { review: { status: 'approved', reviewer: 'ordinary-agent', plan_id: started.data.plan_id } }
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'APPROVAL_REQUIRED');
  assert.equal(forged.task_state, 'awaiting_review', 'forged approval must fail without destroying the resumable task');

  const forgedPublicTask = await bridge.taskStore.getTask(started.task_id, { includePrivate: true });
  await bridge.taskStore.update(started.task_id, {
    result: {
      ...forgedPublicTask.result,
      local_approval: { status: 'approved_pending_execution', reviewer: 'ordinary-agent' }
    }
  });
  await assert.rejects(
    bridge.verify_agent_task_authorization_ready({ task_id: started.task_id }),
    (error) => error.code === 'APPROVAL_REQUIRED'
  );

  await bridge.approvalAuthority.recordTrustedDecision(
    started.data.approval_challenge,
    { decision: 'approved', user_id: 'human-reviewer-1', channel: 'local-user-presence-test', confirmed: true }
  );
  const authorizationReady = await bridge.verify_agent_task_authorization_ready({ task_id: started.task_id });
  assert.equal(authorizationReady.ok, true);
  assert.equal(authorizationReady.task_id, started.task_id);
  assert.equal(authorizationReady.plan_id, started.data.plan_id);
  assert.equal(authorizationReady.plan_hash, started.data.plan_hash);
  assert.equal(authorizationReady.model_revision, started.data.model_revision);
  assert.equal(authorizationReady.risk_level, started.data.risk_level);
  assert.equal(authorizationReady.challenge_id, started.data.approval_challenge.challenge_id);
  assert.equal(authorizationReady.approval_status, 'approved_pending_execution');
  assert.equal(authorizationReady.approval_token_exposed, false);
  assert.equal(Object.hasOwn(authorizationReady, 'approval_token'), false);
  assert.equal(authorizationReady.review_context_hash, started.data.approval_challenge.review_context_hash);
  const applied = await bridge.submit_agent_task_input({
    task_id: started.task_id,
    idempotency_key: 'gateway-apply-1',
    input: { note: 'Approved in trusted test channel.' }
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.task_state, 'completed');
  assert.equal(applied.data.authorization.mode, 'trusted_one_time_token');
  assert.equal(applied.data.authorization.approved_by, 'human-reviewer-1');
  assert.match(applied.data.model_revision_before, /^sha256:[0-9a-f]{64}$/);
  assert.match(applied.data.model_revision_after, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(applied.data.model_revision_before, applied.data.model_revision_after);

  const revisionAfter = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true }));
  const retry = await bridge.submit_agent_task_input({
    task_id: started.task_id,
    idempotency_key: 'gateway-apply-1',
    input: { note: 'Approved in trusted test channel.' }
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotent_replay, true);
  const revisionAfterRetry = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true }));
  assert.equal(revisionAfterRetry, revisionAfter, 'idempotent retry must not apply geometry twice');

  const artifactRead = await bridge.read_agent_artifact({ handle: applied.artifacts[0].handle, max_chars: 256 });
  assert.equal(artifactRead.ok, true);
  assert.equal(typeof artifactRead.data.artifact.content, 'string');

  const restartedBridge = new SketchUpBridge(options);
  const resumed = await restartedBridge.resume_agent_task({ task_id: started.task_id });
  assert.equal(resumed.task_state, 'completed');
  assert.equal(resumed.task_id, started.task_id);

  const rawTask = await restartedBridge.taskStore.getTask(started.task_id, { includePrivate: true });
  assert.deepEqual(rawTask.execution_policy.auto_approve_risks, [], 'client capabilities must not elevate server execution policy');
  const fakeSkpPath = path.join(root, 'opaque-model.skp');
  await fs.writeFile(fakeSkpPath, Buffer.from([0x53, 0x4b, 0x50, 0x00, 0xff]));
  const [binaryModelArtifact] = await restartedBridge.agentGateway.registerArtifacts(started.task_id, { model_binary_probe: fakeSkpPath });
  assert.equal(binaryModelArtifact.kind, 'model_binary');
  assert.equal(binaryModelArtifact.media_type, 'application/octet-stream');
  const binaryModelRead = await restartedBridge.read_agent_artifact({ handle: binaryModelArtifact.handle, max_chars: 256 });
  assert.equal(binaryModelRead.data.artifact.encoding, 'base64');

  const localHostTask = await bridge.start_agent_task({
    ...startArgs,
    instruction: 'Exercise server-private local approval without returning a token to the Agent.',
    idempotency_key: 'gateway-local-approval-host',
    inputs: {
      ...startArgs.inputs,
      operations: [{ op: 'pushpull_face', ...target, distance: 1 }]
    }
  });
  const localDecision = await bridge.approvalAuthority.recordTrustedDecision(
    localHostTask.data.approval_challenge,
    { decision: 'approved', user_id: 'local-user-1', channel: 'local-approval-host.v1', confirmed: true }
  );
  assert.equal(Object.hasOwn(localDecision, 'approval_token'), false);
  const locallyApprovedResume = await bridge.resume_agent_task({ task_id: localHostTask.task_id });
  assert.equal(locallyApprovedResume.next_action.action, 'submit_task_input');
  assert.equal(Object.hasOwn(locallyApprovedResume.next_action, 'approval_token_exposed_to_agent'), false);
  assert.equal(Object.hasOwn(locallyApprovedResume.data.approval_challenge, 'approval_token'), false, 'resume output must not contain an approval token');
  assert.equal(JSON.stringify(locallyApprovedResume).includes('approval_token'), false, 'Gateway public output must not publish approval-token fields');
  const locallyApprovedApply = await bridge.submit_agent_task_input({
    task_id: localHostTask.task_id,
    idempotency_key: 'gateway-local-approval-apply',
    input: { note: 'The trusted local host approved this test.' }
  });
  assert.equal(locallyApprovedApply.ok, true);
  assert.equal(locallyApprovedApply.task_state, 'completed');
  assert.equal(locallyApprovedApply.data.authorization.approved_by, 'local-user-1');
  assert.equal((await bridge.approvalAuthority.readDecision(localHostTask.data.approval_challenge.challenge_id)).status, 'consumed');

  const executionBindingTask = await bridge.start_agent_task({
    ...startArgs,
    instruction: 'Reject a server-private execution target substitution before any queue preflight.',
    idempotency_key: 'gateway-execution-contract-tamper',
    inputs: {
      ...startArgs.inputs,
      operations: [{ op: 'pushpull_face', ...target, distance: 1 }]
    }
  });
  await bridge.approvalAuthority.recordTrustedDecision(
    executionBindingTask.data.approval_challenge,
    { decision: 'approved', user_id: 'execution-binding-user', channel: 'local-approval-host.v1', confirmed: true }
  );
  const executionBindingRaw = await bridge.taskStore.getTask(executionBindingTask.task_id, { includePrivate: true });
  const tamperedExecutionPlan = structuredClone(executionBindingRaw.private.existing_edit_plan);
  const forgedExternalBase = path.join(os.tmpdir(), 'forged-agent-external-output.skp');
  tamperedExecutionPlan.execution_contract = {
    save_model: true,
    save_path: forgedExternalBase,
    final_save_path: versionedModelSavePath(forgedExternalBase, tamperedExecutionPlan.plan_id),
    overwrite_existing: false,
    capture_view: false
  };
  await bridge.taskStore.update(executionBindingTask.task_id, {
    private: { ...executionBindingRaw.private, existing_edit_plan: tamperedExecutionPlan }
  });
  await assert.rejects(
    bridge.verify_agent_task_authorization_ready({ task_id: executionBindingTask.task_id }),
    (error) => error.code === 'PLAN_HASH_MISMATCH'
  );

  const corruptDecisionTask = await bridge.start_agent_task({
    ...startArgs,
    instruction: 'Reject a corrupted signed local decision before any queue preflight.',
    idempotency_key: 'gateway-corrupt-decision-readiness',
    inputs: {
      ...startArgs.inputs,
      operations: [{ op: 'pushpull_face', ...target, distance: 1 }]
    }
  });
  await bridge.approvalAuthority.recordTrustedDecision(
    corruptDecisionTask.data.approval_challenge,
    { decision: 'approved', user_id: 'corrupt-decision-user', channel: 'local-approval-host.v1', confirmed: true }
  );
  const corruptDecisionPath = bridge.approvalAuthority.decisionPath(corruptDecisionTask.data.approval_challenge.challenge_id);
  const corruptDecisionRecord = JSON.parse(await fs.readFile(corruptDecisionPath, 'utf8'));
  corruptDecisionRecord.decision_signature = `${corruptDecisionRecord.decision_signature.slice(0, -1)}${corruptDecisionRecord.decision_signature.endsWith('a') ? 'b' : 'a'}`;
  await fs.writeFile(corruptDecisionPath, `${JSON.stringify(corruptDecisionRecord, null, 2)}\n`, 'utf8');
  await assert.rejects(
    bridge.verify_agent_task_authorization_ready({ task_id: corruptDecisionTask.task_id }),
    (error) => error.code === 'APPROVAL_INVALID'
  );

  const expiredDecisionTask = await bridge.start_agent_task({
    ...startArgs,
    instruction: 'Reject an expired signed local decision before any queue preflight.',
    idempotency_key: 'gateway-expired-decision-readiness',
    inputs: {
      ...startArgs.inputs,
      operations: [{ op: 'pushpull_face', ...target, distance: 1 }]
    }
  });
  await bridge.approvalAuthority.recordTrustedDecision(
    expiredDecisionTask.data.approval_challenge,
    { decision: 'approved', user_id: 'expired-decision-user', channel: 'local-approval-host.v1', confirmed: true }
  );
  const originalDateNow = Date.now;
  Date.now = () => Date.parse(expiredDecisionTask.data.approval_challenge.expires_at) + 1;
  try {
    await assert.rejects(
      bridge.verify_agent_task_authorization_ready({ task_id: expiredDecisionTask.task_id }),
      (error) => error.code === 'APPROVAL_EXPIRED'
    );
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(readinessQueueMethodCalls, 0, 'authorization readiness failures must occur before any queue runtime selection');

  const reviewHandshakeTask = await bridge.start_agent_task({
    ...startArgs,
    instruction: 'Exercise reviewed-edit handshake recovery without touching live SketchUp.',
    idempotency_key: 'gateway-review-handshake-recovery',
    inputs: {
      ...startArgs.inputs,
      operations: [{ op: 'pushpull_face', ...target, distance: 1 }]
    }
  });
  await bridge.approvalAuthority.recordTrustedDecision(
    reviewHandshakeTask.data.approval_challenge,
    { decision: 'approved', user_id: 'human-reviewer-2', channel: 'local-user-presence-test', confirmed: true }
  );
  const reviewHandshakeRaw = await bridge.taskStore.getTask(reviewHandshakeTask.task_id, { includePrivate: true });
  await bridge.taskStore.update(reviewHandshakeTask.task_id, { inputs: { ...reviewHandshakeRaw.inputs, runtime: 'queue' } });
  await assert.rejects(
    bridge.verify_agent_task_authorization_ready({ task_id: reviewHandshakeTask.task_id }),
    (error) => error.code === 'PLAN_HASH_MISMATCH'
  );
  const reviewedMissingHandshake = await bridge.submit_agent_task_input({
    task_id: reviewHandshakeTask.task_id,
    idempotency_key: 'gateway-review-missing-handshake',
    input: {}
  });
  assert.equal(reviewedMissingHandshake.ok, false);
  assert.equal(reviewedMissingHandshake.error.code, 'PLAN_HASH_MISMATCH');
  assert.equal(reviewedMissingHandshake.task_state, 'awaiting_input');
  assert.equal((await bridge.approvalAuthority.readChallenge(reviewHandshakeTask.data.approval_challenge.challenge_id)).status, 'awaiting_trusted_user', 'plan-binding failure must not consume trusted approval');
  const reviewHandshakeQueued = await bridge.taskStore.getTask(reviewHandshakeTask.task_id, { includePrivate: true });
  await bridge.taskStore.update(reviewHandshakeTask.task_id, { inputs: { ...reviewHandshakeQueued.inputs, runtime: 'mock' } });
  const reviewedReplanned = await bridge.submit_agent_task_input({
    task_id: reviewHandshakeTask.task_id,
    idempotency_key: 'gateway-review-recovered',
    input: {}
  });
  assert.equal(reviewedReplanned.ok, true);
  assert.equal(reviewedReplanned.task_state, 'awaiting_review');
  assert.notEqual(reviewedReplanned.data.approval_challenge.challenge_id, reviewHandshakeTask.data.approval_challenge.challenge_id);
  await bridge.approvalAuthority.recordTrustedDecision(
    reviewedReplanned.data.approval_challenge,
    { decision: 'approved', user_id: 'human-reviewer-2', channel: 'local-user-presence-test', confirmed: true }
  );
  const reviewedRecovered = await bridge.submit_agent_task_input({
    task_id: reviewHandshakeTask.task_id,
    idempotency_key: 'gateway-review-recovered-apply',
    input: {}
  });
  assert.equal(reviewedRecovered.ok, true);
  assert.equal(reviewedRecovered.task_state, 'completed');

  const recoverableOptions = {
    ...options,
    mock: { sessionPath: path.join(root, 'recoverable-mock-session.json') },
    agentContract: { rootDir: path.join(root, 'recoverable-agent-state') },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, auto_approve_risks: [] }
  };
  const recoverableBridge = new SketchUpBridge(recoverableOptions);
  const recoverableArgs = {
    intent: 'create_model',
    instruction: 'Build only after the server has authorized a live session.',
    idempotency_key: 'recoverable-create-start',
    inputs: {
      runtime: 'queue',
      code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', name: 'Recoverable_Box', origin: [0, 0, 0], size: [10, 10, 10] }] })
    }
  };
  const missingHandshake = await recoverableBridge.start_agent_task(recoverableArgs);
  assert.equal(missingHandshake.ok, false);
  assert.equal(missingHandshake.error.code, 'HANDSHAKE_REQUIRED');
  assert.equal(missingHandshake.task_state, 'awaiting_input');
  assert.equal(missingHandshake.next_action.then_tool, 'submit_agent_task_input');
  const missingHandshakeStartReplay = await recoverableBridge.start_agent_task(recoverableArgs);
  assert.equal(missingHandshakeStartReplay.ok, false, 'start replay must preserve the persisted error outcome');
  assert.equal(missingHandshakeStartReplay.error.code, 'HANDSHAKE_REQUIRED');
  assert.equal(missingHandshakeStartReplay.idempotent_replay, true);
  const missingHandshakeResume = await recoverableBridge.resume_agent_task({ task_id: missingHandshake.task_id });
  assert.equal(missingHandshakeResume.ok, false, 'resume must not turn a persisted preflight error into success');
  assert.equal(missingHandshakeResume.error.code, 'HANDSHAKE_REQUIRED');
  const failedSubmitArgs = { task_id: missingHandshake.task_id, idempotency_key: 'recoverable-submit-missing-handshake', input: {} };
  const failedSubmit = await recoverableBridge.submit_agent_task_input(failedSubmitArgs);
  assert.equal(failedSubmit.ok, false);
  assert.equal(failedSubmit.task_state, 'awaiting_input');
  const failedSubmitReplay = await recoverableBridge.submit_agent_task_input(failedSubmitArgs);
  assert.equal(failedSubmitReplay.ok, false, 'failed submit replay must preserve the original error envelope');
  assert.equal(failedSubmitReplay.error.code, 'HANDSHAKE_REQUIRED');
  assert.equal(failedSubmitReplay.idempotent_replay, true);
  const recoveredCreate = await recoverableBridge.submit_agent_task_input({
    task_id: missingHandshake.task_id,
    idempotency_key: 'recoverable-submit-mock',
    input: { runtime: 'mock' }
  });
  assert.equal(recoveredCreate.ok, true);
  assert.equal(recoveredCreate.task_state, 'completed');
  assert.equal(recoveredCreate.error, null);

  const creationPolicy = new Set(AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS);
  assert.equal(creationPolicy.size, AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS.length, 'creation-only allowlist must not contain duplicates');
  assert.ok([...creationPolicy].every((operation) => OPERATION_REGISTRY[operation]), 'every creation-only operation must exist in the shared registry');
  const reviewedExistingEditOperations = [
    'attribute', 'remove_attribute', 'assign_tag', 'classification', 'texture_transform', 'set_material', 'set_face_material',
    'set_visibility', 'set_edge_properties', 'rename', 'transform_object', 'duplicate_entity', 'replace_component_definition',
    'reverse_face', 'pushpull_face', 'transform_entities', 'erase_entities', 'delete', 'explode_entity', 'cut_hole', 'cut_slot',
    'cut_recess', 'add_boss', 'add_raised_rib', 'boolean_union', 'boolean_difference', 'boolean_intersect', 'manifold_repair',
    'manifold_check'
  ];
  const nonCreationOperations = new Set([
    ...reviewedExistingEditOperations,
    'uv_project_planar', 'uv_project_box', 'face_uv',
    'reset', 'level', 'component_definition', 'material', 'tag', 'image_reference', 'image_plane',
    'camera', 'scene', 'style', 'shadow', 'rendering_options', 'selection',
    'environment_define', 'environment_update', 'environment_activate', 'style_load', 'style_activate'
    , 'section_plane', 'section_plane_activate'
  ]);
  for (const operation of nonCreationOperations) {
    assert.equal(creationPolicy.has(operation), false, `${operation} must not enter the Gateway creation route`);
  }
  assert.equal(creationPolicy.size + nonCreationOperations.size, Object.keys(OPERATION_REGISTRY).length, 'every registered operation must be explicitly classified as additive or blocked');
  assert.ok(Object.keys(OPERATION_REGISTRY).every((operation) => creationPolicy.has(operation) !== nonCreationOperations.has(operation)), 'registry classifications must be complete and disjoint');

  const policyBridge = new SketchUpBridge({
    ...options,
    mock: { sessionPath: path.join(root, 'creation-policy-mock-session.json') },
    agentContract: { rootDir: path.join(root, 'creation-policy-agent-state') }
  });
  await policyBridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Existing_Material', color: '#123456' },
      { op: 'material', name: 'Floor_Oak', color: '#010203' },
      { op: 'level', name: 'Existing_Level', elevation: 0, height: 3000 },
      { op: 'component_definition', name: 'Existing_Definition', size: [20, 20, 20] },
      { op: 'component_instance', name: 'Existing_Instance', definition: 'Existing_Definition', origin: [0, 0, 0] },
      { op: 'box', id: 'existing-box', name: 'Existing_Box', origin: [30, 0, 0], size: [10, 10, 10] }
    ]
  }) });

  const blockedGatewayDsl = async ({ intent = 'create_model', operations, idempotencyKey }) => {
    const beforeRevision = modelRevisionForAdoption(await policyBridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true }));
    const result = await policyBridge.start_agent_task({
      intent,
      instruction: 'This unsafe DSL must route to reviewed editing instead of direct build_model.',
      idempotency_key: idempotencyKey,
      inputs: {
        runtime: 'mock',
        code: JSON.stringify({ version: 1, units: 'mm', operations })
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'OPERATION_NOT_ALLOWED');
    assert.equal(result.task_state, 'awaiting_input');
    assert.equal(result.next_action.action, 'start_reviewed_existing_model_edit');
    const afterRevision = modelRevisionForAdoption(await policyBridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true }));
    assert.equal(afterRevision, beforeRevision, `${intent} blocked DSL must not mutate the active model`);
    return result;
  };

  await blockedGatewayDsl({
    operations: [{ op: 'reset' }, { op: 'box', name: 'Should_Not_Exist', origin: [0, 0, 0], size: [1, 1, 1] }],
    idempotencyKey: 'gateway-block-reset'
  });
  await blockedGatewayDsl({
    operations: [{ op: 'delete', name: 'Existing_Box' }],
    idempotencyKey: 'gateway-block-target-edit'
  });
  const isolatedDefinition = await policyBridge.start_agent_task({
    intent: 'create_model', instruction: 'Create a fresh definition without replacing the existing one.',
    idempotency_key: 'gateway-isolate-definition-name',
    inputs: { runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'component_definition', name: 'Existing_Definition', size: [99, 99, 99] }] }) }
  });
  assert.equal(isolatedDefinition.ok, true);
  const preservedDefinitionSnapshot = (await policyBridge.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot;
  assert.equal(preservedDefinitionSnapshot.instances.find(item => item.name === 'Existing_Instance').bounding_box.w, 20, 'same logical definition name must allocate a fresh resource and preserve existing instances');
  assert.ok(preservedDefinitionSnapshot.component_definitions.some(name => name.startsWith('alma_')), 'new definition must have a server namespace');
  const levelsBeforeBlockedUpsert = (await policyBridge.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot.levels;
  await blockedGatewayDsl({
    operations: [{ op: 'level', name: 'Existing_Level', elevation: 9999, height: 1 }],
    idempotencyKey: 'gateway-block-level-sidecar-upsert'
  });
  const levelsAfterBlockedUpsert = (await policyBridge.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot.levels;
  assert.deepEqual(levelsAfterBlockedUpsert, levelsBeforeBlockedUpsert, 'same-name level sidecar input must not execute through the creation route');
  const blockedEmbeddedMaterial = await blockedGatewayDsl({
    operations: [{ op: 'box', name: 'Material_Upsert_Box', origin: [0, 0, 0], size: [1, 1, 1], material: { name: 'Existing_Material', color: '#ffffff' } }],
    idempotencyKey: 'gateway-block-embedded-material-upsert'
  });
  assert.equal(blockedEmbeddedMaterial.error.details.blocked_operations[0].reason, 'named_material_may_be_updated');
  const isolatedMacro = await policyBridge.start_agent_task({
    intent: 'create_model', instruction: 'Create isolated preset materials.', idempotency_key: 'gateway-isolate-expanded-materials',
    inputs: { runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'material_preset', preset: 'interior_kitchen' }] }) }
  });
  assert.equal(isolatedMacro.ok, true);
  const isolatedMaterials = (await policyBridge.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot.materials;
  assert.equal(isolatedMaterials.find(material => material.name === 'Existing_Material').color, '#123456');
  assert.equal(isolatedMaterials.find(material => material.name === 'Floor_Oak').color, '#010203');
  assert.ok(isolatedMaterials.some(material => material.name.startsWith('alma_')), 'macro expansion must allocate new scoped resources');
  await blockedGatewayDsl({
    intent: 'verify_model',
    operations: [{ op: 'transform_object', name: 'Existing_Box', translate: [10, 0, 0] }],
    idempotencyKey: 'gateway-block-verify-edit'
  });
  await blockedGatewayDsl({
    operations: [{ op: 'box', name: 'Target_Shaped_Create', origin: [0, 0, 0], size: [1, 1, 1], target_id: 'existing-box' }],
    idempotencyKey: 'gateway-block-target-shaped-create'
  });

  const additiveCreate = await policyBridge.start_agent_task({
    intent: 'create_model',
    instruction: 'Append one new, independently identified box.',
    idempotency_key: 'gateway-allow-additive-create',
    inputs: {
      runtime: 'mock',
      code: JSON.stringify({ version: 1, units: 'mm', operations: [
        { op: 'box', id: 'additive-box', name: 'Additive_Box', origin: [60, 0, 0], size: [10, 10, 10] }
      ] })
    }
  });
  assert.equal(additiveCreate.ok, true);
  assert.equal(additiveCreate.task_state, 'completed');

  const roomCreate = await policyBridge.start_agent_task({
    intent: 'create_model',
    instruction: 'Create the additive room helper without updating an existing implicit material.',
    idempotency_key: 'gateway-allow-room-add-if-missing-materials',
    inputs: {
      runtime: 'mock',
      code: JSON.stringify({ version: 1, units: 'mm', operations: [
        { op: 'room', name: 'Policy_Room', width: 4500, depth: 3000, height: 2400 }
      ] })
    }
  });
  assert.equal(roomCreate.ok, true);
  assert.equal(roomCreate.task_state, roomCreate.result.quality_status === 'pass' ? 'completed' : 'awaiting_input', 'room execution must obey its quality result');
  const roomSnapshot = (await policyBridge.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot;
  assert.equal(roomSnapshot.materials.find((material) => material.name === 'Floor_Oak')?.color, '#010203', 'room implicit materials are add-if-missing and must not update an existing material');

  const inspectedForSnapshot = await policyBridge.inspect_model({ runtime: 'mock', includeSnapshot: true });
  const beforeSnapshotVerify = modelRevisionForAdoption(await policyBridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true }));
  const snapshotVerify = await policyBridge.start_agent_task({
    intent: 'verify_model',
    instruction: 'Verify an existing snapshot without executing DSL.',
    idempotency_key: 'gateway-allow-snapshot-verify',
    inputs: { runtime: 'mock', snapshot: inspectedForSnapshot.snapshot }
  });
  assert.equal(snapshotVerify.ok, true);
  assert.equal(snapshotVerify.task_state, 'completed');
  const afterSnapshotVerify = modelRevisionForAdoption(await policyBridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true }));
  assert.equal(afterSnapshotVerify, beforeSnapshotVerify, 'snapshot-only verification must remain read-only');

  const executionFailureArgs = {
    intent: 'create_model',
    instruction: 'Exercise fail-closed behavior after the execution boundary.',
    idempotency_key: 'gateway-mutation-execution-failure',
    inputs: {
      runtime: 'mock',
      code: JSON.stringify({ version: 1, units: 'mm', operations: [
        { op: 'box', name: 'Valid_Before_Failure', origin: [90, 0, 0], size: [5, 5, 5] },
        { op: 'box', name: 'Secret_Broken_Box', origin: [100, 0, 0] }
      ] })
    }
  };
  const executionFailure = await policyBridge.start_agent_task(executionFailureArgs);
  assert.equal(executionFailure.ok, false);
  assert.equal(executionFailure.task_state, 'failed');
  assert.equal(executionFailure.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(executionFailure.retryable, false, 'a terminal post-boundary failure must never invite identical automatic retry');
  assert.equal(executionFailure.next_action.action, 'inspect_failure_then_start_new_task');
  assert.equal(JSON.stringify(executionFailure).includes('Secret_Broken_Box'), false, 'runtime exception details must not be echoed after mutation may have started');
  const executionFailureReplay = await policyBridge.start_agent_task(executionFailureArgs);
  assert.equal(executionFailureReplay.ok, false);
  assert.equal(executionFailureReplay.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(executionFailureReplay.retryable, false);
  assert.equal(executionFailureReplay.idempotent_replay, true);

  const verificationFailure = await policyBridge.start_agent_task({
    intent: 'verify_model',
    instruction: 'Exercise fail-closed code verification after entering verifying.',
    idempotency_key: 'gateway-verification-execution-failure',
    inputs: {
      runtime: 'mock',
      code: JSON.stringify({ version: 1, units: 'mm', operations: [
        { op: 'box', name: 'Secret_Verification_Box', origin: [0, 0, 0] }
      ] })
    }
  });
  assert.equal(verificationFailure.ok, false);
  assert.equal(verificationFailure.task_state, 'failed');
  assert.equal(verificationFailure.error.code, 'MUTATION_EXECUTION_FAILED');
  assert.equal(verificationFailure.retryable, false);
  assert.equal(JSON.stringify(verificationFailure).includes('Secret_Verification_Box'), false);

  const visualOptions = {
    mock: { sessionPath: path.join(root, 'visual-session.json') },
    agentContract: { rootDir: path.join(root, 'visual-agent-state'), idempotencyLeaseMs: 25 },
    approval: { stateDir: path.join(root, 'visual-approvals'), secret: 'visual-gateway-test-secret-that-is-at-least-32-bytes' },
    executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
  };
  const visualBridge = new SketchUpBridge(visualOptions);
  await visualBridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'visual-gateway-target', name: 'Visual_Gateway_Target', origin: [20, 0, 0], size: [90, 40, 44] }
    ]
  }) });
  const visualAdoption = await visualBridge.adopt_open_model({ runtime: 'mock', recursive: true });
  const visualTargetEntry = visualAdoption.recursive_index.find((entry) => entry.entity_type === 'face');
  assert.ok(visualTargetEntry?.entity_path);
  const visualTarget = {
    entity_path: visualTargetEntry.entity_path,
    edit_scope: 'instance_path',
    instance_policy: 'definition_wide'
  };
  const [visualReferenceBuffer, visualBeforeBuffer] = await Promise.all([
    renderVisualFixture({ left: 45, top: 38, width: 110, height: 44 }),
    renderVisualFixture({ left: 63, top: 38, width: 90, height: 44 })
  ]);
  const [visualReference, visualBefore] = await Promise.all([
    visualBridge.agentGateway.imageArtifactStore.ingestBuffer(visualReferenceBuffer),
    visualBridge.agentGateway.imageArtifactStore.ingestBuffer(visualBeforeBuffer)
  ]);
  const visualSource = await visualBridge.start_agent_task({
    intent: 'reference_image_correction',
    instruction: 'Align the existing reviewed target with the immutable reference.',
    client_capabilities: { vision: false, local_files: false, structured_output: true, context: 'short', parallel: false },
    idempotency_key: 'gateway-visual-source',
    inputs: {
      runtime: 'mock',
      reference_image_handle: visualReference.record.handle,
      capture_image_handle: visualBefore.record.handle,
      correction_targets: [visualTarget],
      correction_operations: [{ op: 'pushpull_face', ...visualTarget, distance: 5 }],
      save_model: false
    }
  });
  assert.equal(visualSource.ok, true);
  assert.equal(visualSource.task_state, 'awaiting_review');
  const visualSourceData = await expandedEnvelopeData(visualBridge, visualSource);
  assert.equal(visualSourceData.local_files_required, false);
  assert.equal(Object.hasOwn(visualSourceData.correction_patch, 'targets'), false);
  assert.equal(Object.hasOwn(visualSourceData.correction_patch, 'operations'), false);
  assert.deepEqual(Object.keys(visualSource.next_action).sort(), ['action', 'source_visual_correction']);
  assert.match(visualSource.next_action.source_visual_correction, /^source_visual_correction:task_/);
  assert.equal(JSON.stringify(visualSource).includes(visualTargetEntry.entity_path), false, 'public visual response must not leak mapped execution targets');
  assert.match(visualSourceData.image_artifacts.overlay.handle, /^image-artifact:sha256:[0-9a-f]{64}$/);
  assert.equal(visualSourceData.image_artifacts.overlay.media_type, 'image/png');
  const immutableRead = await visualBridge.read_agent_artifact({ handle: visualSourceData.image_artifacts.overlay.handle, max_chars: 256 });
  assert.equal(immutableRead.ok, true);
  assert.equal(immutableRead.data.artifact.encoding, 'omitted');
  assert.equal(immutableRead.data.artifact.content_omitted_for_capability, true);
  assert.equal(Object.hasOwn(immutableRead.data.artifact, 'content'), false);
  assert.equal(immutableRead.data.artifact.content_trust, 'untrusted_data');

  const visualOverride = await visualBridge.start_agent_task({
    intent: 'reviewed_existing_model_edit',
    instruction: 'An Agent must not override the server-private visual mapping.',
    inputs: {
      runtime: 'mock',
      source_visual_correction: visualSource.next_action.source_visual_correction,
      operations: [{ op: 'delete', ...visualTarget }],
      targets: [visualTarget]
    }
  });
  assert.equal(visualOverride.ok, false);
  assert.equal(visualOverride.error.code, 'INVALID_ARGUMENT');

  const visualReviewed = await visualBridge.start_agent_task({
    intent: 'reviewed_existing_model_edit',
    instruction: 'Promote only the server-private visual correction mapping.',
    inputs: {
      runtime: 'mock',
      source_visual_correction: visualSource.next_action.source_visual_correction,
      save_model: false
    }
  });
  assert.equal(visualReviewed.ok, true);
  assert.equal(visualReviewed.task_state, 'awaiting_review');
  const visualReviewedData = await expandedEnvelopeData(visualBridge, visualReviewed);
  assert.equal(visualReviewedData.source_visual_correction.source_task_id, visualSource.task_id);
  await visualBridge.approvalAuthority.recordTrustedDecision(
    visualReviewedData.approval_challenge,
    { decision: 'approved', user_id: 'visual-human-reviewer', channel: 'test-only-trusted-user-fixture', confirmed: true }
  );
  const originalVisualFinalizer = visualBridge.agentGateway.finalizeVisualCorrectionApply.bind(visualBridge.agentGateway);
  let visualFinalizerInterrupted = false;
  visualBridge.agentGateway.finalizeVisualCorrectionApply = async (...args) => {
    const completion = await originalVisualFinalizer(...args);
    if (!visualFinalizerInterrupted) {
      visualFinalizerInterrupted = true;
      throw new Error('simulated_visual_finalizer_process_exit');
    }
    return completion;
  };
  const visualInterrupted = await visualBridge.submit_agent_task_input({
    task_id: visualReviewed.task_id,
    idempotency_key: 'gateway-visual-apply',
    input: {}
  });
  assert.equal(visualInterrupted.ok, false);
  assert.equal(visualInterrupted.error.code, 'MUTATION_RECOVERY_REQUIRED');
  const sourceAfterInterruptedFinalizer = await visualBridge.taskStore.getTask(visualSource.task_id, { includePrivate: true });
  const interruptedVisualReceiptHash = sourceAfterInterruptedFinalizer.private.visual_apply_receipt.receipt_hash;
  const restartedVisualBridge = new SketchUpBridge(visualOptions);
  const visualApplied = await restartedVisualBridge.resume_agent_task({ task_id: visualReviewed.task_id });
  assert.equal(visualApplied.ok, true);
  assert.equal(visualApplied.task_state, 'completed');
  const visualAppliedData = await expandedEnvelopeData(restartedVisualBridge, visualApplied);
  assert.equal(visualAppliedData.source_visual_correction, visualSource.next_action.source_visual_correction);
  assert.match(visualAppliedData.visual_apply_receipt.receipt_hash, /^sha256:[0-9a-f]{64}$/);
  const sourceAfterRecoveredFinalizer = await restartedVisualBridge.taskStore.getTask(visualSource.task_id, { includePrivate: true });
  assert.equal(sourceAfterRecoveredFinalizer.private.visual_apply_receipt.receipt_hash, interruptedVisualReceiptHash, 'visual finalizer recovery must reuse deterministic receipt lineage');

  const visualQa = await restartedVisualBridge.start_agent_task({
    intent: 'visual_correction_qa',
    instruction: 'Verify the reviewed edit using immutable recapture evidence.',
    client_capabilities: { vision: false, local_files: false, structured_output: true, context: 'short', parallel: false },
    idempotency_key: 'gateway-visual-qa',
    inputs: {
      runtime: 'mock',
      source_visual_correction: visualSource.next_action.source_visual_correction,
      reference_image_handle: visualReference.record.handle,
      recapture_image_handle: visualReference.record.handle
    }
  });
  assert.equal(visualQa.ok, true);
  assert.equal(visualQa.task_state, 'completed');
  assert.equal(visualQa.presentation.projected, true);
  assert.ok(JSON.stringify(visualQa).length <= 4096);
  assert.equal(visualQa.data.version, 'visual-correction-qa-result.v1');
  assert.equal(visualQa.data.report.verdict, 'pass');
  assert.equal(
    visualQa.data.background_normalized_comparison.structure_verdict,
    'coarse_structure_pass'
  );
  assert.equal(visualQa.data.background_normalized_comparison.segmentation_reliable, true);
  assert.equal(visualQa.data.background_normalized_comparison.visual_similarity_accepted, false);
  assert.equal(visualQa.data.diagnostic_boundary.policy_effect, 'none');
  assert.equal(visualQa.data.diagnostic_boundary.execution_authorization_allowed, false);
  const visualQaData = await expandedEnvelopeData(restartedVisualBridge, visualQa);
  assert.equal(visualQaData.version, 'visual-correction-qa-result.v1');
  assert.equal(visualQaData.report.verdict, 'pass');
  assert.equal(visualQaData.report.source_patch.patch_hash, visualSourceData.correction_patch.patch_hash);
  assert.equal(visualQaData.report.apply_receipt.receipt_hash, visualAppliedData.visual_apply_receipt.receipt_hash);
  assert.equal(visualQaData.background_normalized_comparison.structure.verdict, 'coarse_structure_pass');
  assert.equal(visualQaData.background_normalized_comparison.visual_similarity_accepted, false);
  assert.equal(visualQaData.diagnostic_boundary.target_selection_allowed, false);
  assert.equal(visualQaData.diagnostic_boundary.operation_selection_allowed, false);
  assert.equal(visualQaData.diagnostic_boundary.approval_state_change_allowed, false);
  assert.equal(visualQaData.diagnostic_boundary.execution_authorization_allowed, false);
  assert.equal(visualQaData.diagnostic_boundary.visual_similarity_accepted, false);
  assert.match(visualQaData.image_artifacts.silhouette_overlay.handle, /^image-artifact:sha256:[0-9a-f]{64}$/);
  assert.equal(Object.keys(visualQaData.image_artifacts).length, 8);
  assert.equal(visualQaData.local_files_required, false);
  assert.equal(JSON.stringify(visualQa).includes(root), false);

  const injectedVisualDecision = await restartedVisualBridge.start_agent_task({
    intent: 'visual_correction_qa',
    instruction: 'An Agent must not inject visual comparison or authorization decisions.',
    idempotency_key: 'gateway-visual-qa-injected-decision',
    inputs: {
      runtime: 'mock',
      source_visual_correction: visualSource.next_action.source_visual_correction,
      reference_image_handle: visualReference.record.handle,
      recapture_image_handle: visualReference.record.handle,
      visual_similarity_accepted: true
    }
  });
  assert.equal(injectedVisualDecision.ok, false);
  assert.equal(injectedVisualDecision.error.code, 'INVALID_ARGUMENT');

  const legacyVisual = await visualBridge.start_agent_task({
    intent: 'reference_image_correction',
    instruction: 'Reject legacy path-based visual inputs.',
    inputs: {
      runtime: 'mock',
      reference_image_path: '/tmp/reference.png',
      capture_image_path: '/tmp/capture.png',
      correction_targets: [visualTarget],
      correction_operations: [{ op: 'transform_object', ...visualTarget, translate: [1, 0, 0] }]
    }
  });
  assert.equal(legacyVisual.ok, false);
  assert.equal(legacyVisual.error.code, 'INVALID_ARGUMENT');

  const persistedGatewayState = await readAllFiles(root);
  assert.equal(persistedGatewayState.includes('agent-supplied-start-credential'), false, 'forbidden start credentials must not be persisted');
  assert.equal(persistedGatewayState.includes('agent-supplied-submit-credential'), false, 'forbidden submit credentials must not be persisted');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    task_id: started.task_id,
    forged_approval_blocked: true,
    resumed_after_restart: true,
    duplicate_mutation: false,
    artifact_handles: applied.artifacts.length,
    recoverable_preflight: true,
    error_replay_preserved: true,
    reviewed_approval_preserved: true,
    creation_only_gateway: true,
    unsafe_gateway_mutation: false,
    creation_operations: AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS.length,
    mutation_execution_failure_retryable: false,
    visual_handle_only_gateway: true,
    visual_private_promotion: true,
    visual_apply_receipt_qa: true,
    visual_qa_structured_result: true,
    visual_qa_l0_projection: true,
    visual_decision_injection_blocked: true,
    local_approval_host_private_token: true,
    authorization_readiness_private_plan: true,
    authorization_readiness_queue_calls: readinessQueueMethodCalls,
    signed_decision_fail_closed: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function renderVisualFixture(rectangle) {
  const svg = `<svg width="200" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="120" fill="white"/><rect x="${rectangle.left}" y="${rectangle.top}" width="${rectangle.width}" height="${rectangle.height}" rx="4" fill="#202020"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function readAllFiles(directory) {
  const chunks = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) chunks.push(await readAllFiles(entryPath));
    else if (entry.isFile()) chunks.push(await fs.readFile(entryPath, 'utf8').catch(() => ''));
  }
  return chunks.join('\n');
}

async function expandedEnvelopeData(bridge, envelope) {
  const handle = envelope?.presentation?.full_result_artifact || envelope?.data?.full_result_artifact;
  if (!handle) return envelope.data;
  let offset = 0;
  let content = '';
  while (true) {
    const page = await bridge.read_agent_artifact({
      handle,
      task_id: envelope.task_id,
      offset,
      max_chars: 100000
    });
    assert.equal(typeof page.data?.artifact?.content, 'string');
    content += page.data.artifact.content;
    if (page.data.artifact.eof) break;
    offset = page.data.artifact.next_offset;
  }
  return JSON.parse(content).result;
}
