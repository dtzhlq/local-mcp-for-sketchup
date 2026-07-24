import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  fingerprintRequest,
  normalizeClientCapabilities,
  normalizeExecutionPolicy
} from '../src/agent-contract.mjs';
import { AgentTaskStore } from '../src/agent-task-store.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-agent-task-recovery-'));
const leaseMs = 100;
const clientCapabilities = normalizeClientCapabilities({
  vision: false,
  local_files: false,
  structured_output: true,
  context: 'short',
  parallel: false
});
const executionPolicy = normalizeExecutionPolicy({ allowed_runtimes: ['mock'] });

try {
  const recoveredCreate = await staleCreateWithoutTaskCanBeTakenOver();
  const replayedCreate = await staleCreateWithTaskCanBeReplayed();
  const recoveredSubmit = await staleSubmitWithoutProgressCanBeTakenOver();
  await mutationMayHaveStartedFailsClosed('executing');
  await mutationMayHaveStartedFailsClosed('verifying');
  await activePendingClaimsRemainExclusive();
  await concurrentRecoveryHasSingleOwner();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    recovered_create_task: recoveredCreate,
    replayed_create_task: replayedCreate,
    recovered_submit_task: recoveredSubmit,
    fail_closed_states: ['executing', 'verifying'],
    active_pending_conflict: true,
    concurrent_recovery_single_owner: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function staleCreateWithoutTaskCanBeTakenOver() {
  const key = 'recovery-create-without-task';
  const args = createArgs(key, 'Recover a create request that stopped before its task was written.');
  const crashedStore = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const abandonedTaskId = `task_${crypto.randomUUID()}`;
  const claim = await crashedStore.claimIdempotency({
    key,
    fingerprint: createFingerprint(args),
    operation: 'create_task',
    taskId: abandonedTaskId
  });
  await expireClaim(claim.filePath);

  const restartedStore = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const recovered = await restartedStore.createTask(args);
  assert.equal(recovered.replayed, false);
  assert.equal(recovered.recovered_pending, true);
  assert.notEqual(recovered.task.task_id, abandonedTaskId, 'a missing task must be replaced by the new recovery owner');
  assert.equal((await restartedStore.getTask(recovered.task.task_id)).state, 'created');
  const completedClaim = await readJson(claim.filePath);
  assert.equal(completedClaim.status, 'completed');
  assert.equal(completedClaim.task_id, recovered.task.task_id);
  assert.equal(completedClaim.bound_task_id, recovered.task.task_id);
  return recovered.task.task_id;
}

async function staleCreateWithTaskCanBeReplayed() {
  const key = 'recovery-create-with-existing-task';
  const args = createArgs(key, 'Recover a create request that wrote its task before crashing.');
  const crashedStore = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const created = await crashedStore.createTask(args);
  const claimPath = crashedStore.idempotencyPath(key);
  await expireClaim(claimPath, { status: 'pending', completed_at: undefined });

  const restartedStore = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const recovered = await restartedStore.createTask(args);
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.recovered_pending, true);
  assert.equal(recovered.task.task_id, created.task.task_id);
  const completedClaim = await readJson(claimPath);
  assert.equal(completedClaim.status, 'completed');
  assert.equal(completedClaim.task_id, created.task.task_id);
  assert.ok(completedClaim.recovered_at);
  return recovered.task.task_id;
}

async function staleSubmitWithoutProgressCanBeTakenOver() {
  const store = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const created = await store.createTask(createArgs(undefined, 'Create a task for submit recovery.'));
  const key = 'recovery-submit-no-progress';
  const operation = 'submit_agent_task_input';
  const input = { clarification: 'Use the selected occurrence.' };
  const crashedClaim = await store.claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: key,
    input
  });
  await expireClaim(crashedClaim.filePath);

  const restartedStore = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const recovered = await restartedStore.claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: key,
    input
  });
  assert.equal(recovered.replayed, false);
  assert.equal(recovered.recovered_pending, true);
  assert.equal(recovered.record.task_version_at_claim, created.task.task_version);
  assert.equal(recovered.record.task_state_at_claim, created.task.state);
  await restartedStore.completeTaskOperation(recovered, created.task.task_id, {
    response: { ok: true, task_id: created.task.task_id }
  });
  const replay = await restartedStore.claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: key,
    input
  });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.record.response, { ok: true, task_id: created.task.task_id });
  return created.task.task_id;
}

async function mutationMayHaveStartedFailsClosed(state) {
  const store = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const created = await store.createTask(createArgs(undefined, `Create a task that reaches ${state}.`));
  const key = `recovery-submit-${state}`;
  const input = { approval_token: 'opaque-test-token' };
  const claim = await store.claimTaskOperation({
    taskId: created.task.task_id,
    operation: 'submit_agent_task_input',
    idempotencyKey: key,
    input
  });
  await store.transition(created.task.task_id, 'understanding', { reason: 'test_progress' });
  await store.transition(created.task.task_id, state, { reason: 'test_mutation_boundary' });
  await expireClaim(claim.filePath);

  const restartedStore = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  await assert.rejects(
    restartedStore.claimTaskOperation({
      taskId: created.task.task_id,
      operation: 'submit_agent_task_input',
      idempotencyKey: key,
      input
    }),
    (error) => {
      assert.equal(error.code, 'MUTATION_EXECUTION_FAILED');
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details, { task_id: created.task.task_id, task_state: state, outcome_unknown: true });
      return true;
    }
  );
}

async function activePendingClaimsRemainExclusive() {
  const store = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const created = await store.createTask(createArgs(undefined, 'Create a task for active-claim checks.'));
  const operation = 'submit_agent_task_input';
  const input = { clarification: 'Keep the current target.' };

  const aliveKey = 'recovery-submit-alive-owner';
  const aliveClaim = await store.claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: aliveKey,
    input
  });
  await expireClaim(aliveClaim.filePath, { owner_pid: process.pid });
  await expectTaskStateConflict(() => new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs }).claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: aliveKey,
    input
  }));

  const freshKey = 'recovery-submit-fresh-lease';
  const freshClaim = await store.claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: freshKey,
    input
  });
  await expireClaim(freshClaim.filePath, {
    owner_pid: deadPid(),
    lease_expires_at: new Date(Date.now() + 60_000).toISOString()
  });
  await expectTaskStateConflict(() => new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs }).claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: freshKey,
    input
  }));
}

async function concurrentRecoveryHasSingleOwner() {
  const store = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs });
  const created = await store.createTask(createArgs(undefined, 'Create a task for concurrent recovery.'));
  const key = 'recovery-submit-concurrent';
  const operation = 'submit_agent_task_input';
  const input = { clarification: 'Only one recovery owner may continue.' };
  const crashedClaim = await store.claimTaskOperation({
    taskId: created.task.task_id,
    operation,
    idempotencyKey: key,
    input
  });
  await expireClaim(crashedClaim.filePath);

  const attempts = await Promise.allSettled([
    new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs }).claimTaskOperation({
      taskId: created.task.task_id,
      operation,
      idempotencyKey: key,
      input
    }),
    new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: leaseMs }).claimTaskOperation({
      taskId: created.task.task_id,
      operation,
      idempotencyKey: key,
      input
    })
  ]);
  const owners = attempts.filter((attempt) => attempt.status === 'fulfilled' && attempt.value.replayed === false);
  const conflicts = attempts.filter((attempt) => attempt.status === 'rejected' && attempt.reason?.code === 'TASK_STATE_CONFLICT');
  assert.equal(owners.length, 1, 'exactly one process may take over a stale submit claim');
  assert.equal(conflicts.length, 1, 'the concurrent recovery contender must fail with TASK_STATE_CONFLICT');
}

function createArgs(idempotencyKey, instruction) {
  return {
    intent: 'understand_model',
    interfaceLevel: 'guided',
    instruction,
    clientCapabilities,
    executionPolicy,
    inputs: { runtime: 'mock' },
    ...(idempotencyKey ? { idempotencyKey } : {})
  };
}

function createFingerprint(args) {
  return fingerprintRequest({
    operation: 'create_task',
    intent: args.intent,
    interfaceLevel: args.interfaceLevel,
    instruction: args.instruction,
    clientCapabilities: args.clientCapabilities,
    inputs: args.inputs
  });
}

async function expireClaim(filePath, overrides = {}) {
  const claim = await readJson(filePath);
  const next = {
    ...claim,
    status: 'pending',
    owner_pid: deadPid(),
    lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    ...overrides
  };
  if (overrides.completed_at === undefined) delete next.completed_at;
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function expectTaskStateConflict(callback) {
  await assert.rejects(callback, (error) => error?.code === 'TASK_STATE_CONFLICT');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function deadPid() {
  return 2_147_483_647;
}
