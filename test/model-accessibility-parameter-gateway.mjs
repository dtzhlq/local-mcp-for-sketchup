import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { TOOL_REGISTRY } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-parameter-gateway-'));
const validator = new ToolInputValidator(TOOL_REGISTRY);
const sourceTask = { version: 1, kind: 'cabinet', id: 'gateway-cabinet', units: 'mm', parameters: { width_mm: 600, depth_mm: 600, height_mm: 900 }, placement: { origin_mm: [0, 0, 0] } };
const options = id => ({ mock: { sessionPath: path.join(root, id, 'session.json') }, agentContract: { rootDir: path.join(root, id, 'state') }, approval: { stateDir: path.join(root, id, 'approval'), secret: 'gateway-parameter-test-only-secret-over-32-bytes' } });
async function call(bridge, name, args) { validator.validate(name, args); return bridge[name](args); }
const stored = (bridge, result) => bridge.taskStore.getTask(result.task_id, { includePrivate: true });
let checks = 0;
const check = fn => { fn(); checks++; };
async function fixture(id, { limit = 5000, task = sourceTask } = {}) {
  const config = options(id), bridge = new SketchUpBridge(config);
  const result = await call(bridge, 'start_agent_task', { intent: 'create_model', instruction: 'Create the declared offline cabinet fixture.', idempotency_key: 'parameter-source', inputs: { runtime: 'mock', recursive_limit: limit, task } });
  const creation = await stored(bridge, result);
  check(() => assert.equal(result.error, null, JSON.stringify(result.error)));
  check(() => assert.equal(creation.result.quality_accepted, false));
  const runtime = bridge.selectRuntime('mock'), originalBuild = runtime.buildModel.bind(runtime), counts = { staging: 0, replace: 0 };
  runtime.buildModel = async code => {
    const dsl = JSON.parse(code);
    if (dsl.operations.every(op => op.op === 'component_definition')) counts.staging++;
    if (dsl.operations.some(op => op.op === 'replace_component_definition')) counts.replace++;
    return originalBuild(code);
  };
  return { config, bridge, creation, counts, limit, runtime };
}
const editArgs = (f, key, changes = { width_mm: 800 }, ids, scope = 'single') => ({ intent: 'modify_design_parameters', instruction: 'Apply the explicit cabinet width parameter change.', idempotency_key: key,
  inputs: { runtime: 'mock', recursive_limit: f.limit, parameter_edit: { creation_task_id: f.creation.task_id, scope,
    targets: (ids || [Object.keys(f.creation.private.creation.identity_map).find(id => id === 'id-gateway-cabinet')]).map(id => ({ target_id: f.creation.private.creation.identity_map[id] })), changes } } });
async function approve(f, parent) {
  const task = await stored(f.bridge, parent), child = await f.bridge.taskStore.getTask(task.private.parameter_execution.reviewed_task_id, { includePrivate: true });
  await f.bridge.approvalAuthority.recordTrustedDecision(child.result.approval_challenge,
    { decision: 'approved', user_id: 'offline-reviewer', channel: 'local-user-presence-test', confirmed: true });
  return child;
}
try {
  const f = await fixture('recoverable');
  check(() => assert.equal(f.creation.private.creation.parameter_edit_support.baseline_captured, true));
  check(() => assert.equal(f.creation.private.creation.parameter_edit_support.execution_available, true));
  const originalUpdate = f.bridge.taskStore.update.bind(f.bridge.taskStore);
  let interruptStage = true;
  f.bridge.taskStore.update = async (id, patch) => {
    const result = await originalUpdate(id, patch);
    if (interruptStage && patch.private?.parameter_execution?.phase === 'staging_committed') { interruptStage = false; throw new Error('offline crash after durable staging journal'); }
    return result;
  };
  const args = editArgs(f, 'recover-stage'), started = await call(f.bridge, 'start_agent_task', args);
  check(() => assert.equal(f.counts.staging, 1));
  check(() => assert.equal(f.counts.replace, 0));
  const afterStage = await stored(f.bridge, started);
  check(() => assert.equal(afterStage.private.parameter_execution.phase, 'staging_committed'));
  f.bridge.taskStore.update = originalUpdate;
  f.bridge = new SketchUpBridge(f.config); f.bridge.mockRuntime = f.runtime;
  const resumed = await call(f.bridge, 'resume_agent_task', { task_id: started.task_id });
  check(() => assert.equal(resumed.error, null, JSON.stringify(resumed.error)));
  check(() => assert.equal(resumed.task_state, 'awaiting_review'));
  check(() => assert.equal(f.counts.staging, 1));
  const blocked = await call(f.bridge, 'submit_agent_task_input', { task_id: started.task_id, idempotency_key: 'before-approval', input: {} });
  check(() => assert.equal(blocked.error.code, 'APPROVAL_REQUIRED'));
  check(() => assert.equal(f.counts.replace, 0));
  const child = await approve(f, started);
  const ready = await f.bridge.verify_agent_task_authorization_ready({ task_id: started.task_id });
  check(() => assert.equal(ready.execution_task_id, child.task_id));
  const originalFinalizer = f.bridge.agentGateway.finalizeReviewedMutationReceipt.bind(f.bridge.agentGateway);
  let failFinalizer = true;
  f.bridge.agentGateway.finalizeReviewedMutationReceipt = async receipt => { if (failFinalizer) { failFinalizer = false; throw new Error('offline crash after signed replacement receipt'); } return originalFinalizer(receipt); };
  const interrupted = await call(f.bridge, 'submit_agent_task_input', { task_id: started.task_id, idempotency_key: 'apply-once', input: {} });
  check(() => assert.ok(interrupted.error));
  check(() => assert.equal(f.counts.replace, 1));
  const committedParent = await stored(f.bridge, started);
  check(() => assert.equal(committedParent.result.geometry_applied, true));
  f.bridge.agentGateway.finalizeReviewedMutationReceipt = originalFinalizer;
  f.bridge = new SketchUpBridge(f.config); f.bridge.mockRuntime = f.runtime;
  const originalMapping = f.bridge.agentGateway.recordTrustedAssemblyEditMapping.bind(f.bridge.agentGateway);
  let failMapping = true;
  f.bridge.agentGateway.recordTrustedAssemblyEditMapping = async value => { const result = await originalMapping(value); if (failMapping) { failMapping = false; throw new Error('offline crash after signed frozen-path mapping'); } return result; };
  const mappingInterrupted = await call(f.bridge, 'resume_agent_task', { task_id: started.task_id });
  check(() => assert.ok(mappingInterrupted.error));
  check(() => assert.equal(f.counts.replace, 1));
  f.bridge.agentGateway.recordTrustedAssemblyEditMapping = originalMapping;
  const completed = await call(f.bridge, 'resume_agent_task', { task_id: started.task_id });
  check(() => assert.equal(completed.error, null, JSON.stringify(completed.error)));
  check(() => assert.equal(completed.task_state, 'completed'));
  const result = await stored(f.bridge, completed);
  check(() => assert.equal(result.result.geometry_applied, true));
  check(() => assert.equal(result.result.quality_accepted, false));
  check(() => assert.equal(result.result.saved, false));
  check(() => assert.deepEqual(f.counts, { staging: 1, replace: 1 }));
  const model = await f.runtime.readModel();
  check(() => assert.equal(model.instances[0].bounding_box.w, 800));
  const actualDefinition = model.component_definitions[model.instances[0].definition];
  check(() => assert.equal(actualDefinition.groups.find(g => g.name === 'gateway-cabinet-side-left').bounding_box.w, 18));
  const source = await f.bridge.taskStore.getTask(f.creation.task_id, { includePrivate: true });
  check(() => assert.equal(source.private.creation.parameter_source.parameter_revision, 1));
  check(() => assert.equal(source.private.creation.frozen_spec.hash, f.creation.private.creation.frozen_spec.hash));
  const restarted = new SketchUpBridge(f.config);
  const replay = await call(restarted, 'start_agent_task', args);
  check(() => assert.equal(replay.task_id, started.task_id));
  check(() => assert.equal(replay.idempotent_replay, true));
  const duplicate = await call(restarted, 'submit_agent_task_input', { task_id: started.task_id, idempotency_key: 'apply-once', input: {} });
  check(() => assert.equal(duplicate.task_state, 'completed'));
  const replayModel = await restarted.selectRuntime('mock').readModel();
  check(() => assert.deepEqual(replayModel, model));
  // A terminal source is an offline state-machine fixture, not a live-quality
  // pass. New verification must not mutate/reopen it or accept client answers.
  await f.bridge.taskStore.transition(source.task_id, 'understanding');
  await f.bridge.taskStore.transition(source.task_id, 'verifying');
  await f.bridge.taskStore.transition(source.task_id, 'completed');
  const verification = await call(f.bridge, 'start_agent_task', result.next_action.arguments);
  check(() => assert.equal(verification.error, null, JSON.stringify(verification.error)));
  const verified = await stored(f.bridge, verification);
  check(() => assert.notEqual(verified.task_id, source.task_id));
  check(() => assert.equal(verified.result.kind, 'verify_creation_result'));
  check(() => assert.equal(verified.result.quality_accepted, false));
  check(() => assert.equal(verified.result.geometry_built, false));
  check(() => assert.equal(verified.private.creation.frozen_spec.hash, source.private.creation.frozen_spec.hash));
  const unchangedSource = await f.bridge.taskStore.getTask(source.task_id, { includePrivate: true });
  check(() => assert.equal(unchangedSource.state, 'completed'));
  await assert.rejects(() => call(f.bridge, 'submit_agent_task_input', { task_id: verified.task_id, idempotency_key: 'forged-verify', input: { detail_spec: { level: 'blockout' } } }), /cannot change/); checks++;
  const cleanVerification = await stored(f.bridge, verification);
  check(() => assert.equal(cleanVerification.inputs.detail_spec, undefined));
  const reverified = await call(f.bridge, 'submit_agent_task_input', { task_id: verified.task_id, idempotency_key: 'legitimate-reverify', input: { reverify: true } });
  check(() => assert.equal(reverified.error, null, JSON.stringify(reverified.error)));
  check(() => assert.deepEqual(f.counts, { staging: 1, replace: 1 }));
  const lostReplace = await call(f.bridge, 'start_agent_task', editArgs(f, 'lost-replace', { width_mm: 900 }));
  await approve(f, lostReplace);
  const countedBuild = f.runtime.buildModel.bind(f.runtime);
  let dropReplacement = true;
  f.runtime.buildModel = async code => {
    const result = await countedBuild(code);
    if (dropReplacement && JSON.parse(code).operations.some(op => op.op === 'replace_component_definition')) { dropReplacement = false; throw new Error('lost native replacement return before ledger'); }
    return result;
  };
  await call(f.bridge, 'submit_agent_task_input', { task_id: lostReplace.task_id, idempotency_key: 'lost-apply', input: {} });
  const lostReplacementState = await stored(f.bridge, lostReplace);
  check(() => assert.equal(lostReplacementState.result.outcome_unknown, true));
  const countsAfterLoss = { ...f.counts };
  await call(f.bridge, 'resume_agent_task', { task_id: lostReplace.task_id });
  await call(f.bridge, 'submit_agent_task_input', { task_id: lostReplace.task_id, idempotency_key: 'new-key-after-loss', input: {} });
  check(() => assert.deepEqual(f.counts, countsAfterLoss, 'uncertain replacement must never replay under a new submission key'));

  const unknown = await fixture('unknown');
  const update = unknown.bridge.taskStore.update.bind(unknown.bridge.taskStore);
  unknown.bridge.taskStore.update = async (id, patch) => { if (patch.private?.parameter_execution?.phase === 'staging_committed') throw new Error('lost stage return before durable commit record'); return update(id, patch); };
  const lost = await call(unknown.bridge, 'start_agent_task', editArgs(unknown, 'unknown-once'));
  unknown.bridge.taskStore.update = update;
  const retried = await call(unknown.bridge, 'resume_agent_task', { task_id: lost.task_id });
  check(() => assert.equal(retried.error.code, 'MUTATION_EXECUTION_FAILED'));
  const unknownState = await stored(unknown.bridge, retried);
  check(() => assert.equal(unknownState.result.outcome_unknown, true));
  await call(unknown.bridge, 'submit_agent_task_input', { task_id: lost.task_id, idempotency_key: 'new-key-cannot-replay-stage', input: {} });
  check(() => assert.deepEqual(unknown.counts, { staging: 1, replace: 0 }));
  const forged = await stored(unknown.bridge, retried);
  await unknown.bridge.taskStore.update(forged.task_id, { private: { ...forged.private, parameter_execution: { ...forged.private.parameter_execution, phase: 'staging_committed' } } });
  const rejectedJournal = await call(unknown.bridge, 'resume_agent_task', { task_id: lost.task_id });
  check(() => assert.equal(rejectedJournal.error.code, 'MUTATION_RECEIPT_INVALID'));
  check(() => assert.deepEqual(unknown.counts, { staging: 1, replace: 0 }));

  const limited = await fixture('truncated', { limit: 1 });
  check(() => assert.equal(limited.creation.private.creation.parameter_edit_support.baseline_captured, false));
  check(() => assert.equal(limited.creation.private.creation.parameter_edit_support.blockers[0], 'MODEL_REVISION_INCOMPLETE'));
  const noBaseline = await call(limited.bridge, 'start_agent_task', editArgs(limited, 'no-baseline'));
  const blockedState = await stored(limited.bridge, noBaseline);
  check(() => assert.equal(blockedState.result.stage, 'blocked_before_planning'));
  check(() => assert.deepEqual(limited.counts, { staging: 0, replace: 0 }));
  console.log(JSON.stringify({ ok: true, checks, runtime: 'isolated_mock_only', live_acceptance: false,
    verified: ['one_shot_signed_staging', 'same_task_resume', 'approval_required', 'signed_mutation_ledger_finalizer', 'mapping_recovery', 'no_repeat_after_restart', 'outcome_unknown_fail_closed', 'fixed_board_thickness', 'frozen_spec_preserved', 'creation_survives_capture_limit'] }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
