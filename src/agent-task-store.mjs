import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AGENT_CONTRACT_VERSION,
  AgentContractError,
  assertTaskTransition,
  fingerprintRequest,
  publicExecutionPolicy
} from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';
import { TaskMutationReceiptLedger } from './task-mutation-receipt-ledger.mjs';

export class AgentTaskStore {
  constructor({ rootDir = path.join(defaultStateDir, 'agent-contract-v1'), idempotencyLeaseMs = 30_000 } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.tasksDir = path.join(this.rootDir, 'tasks');
    this.idempotencyDir = path.join(this.rootDir, 'idempotency');
    this.taskRequestLocksDir = path.join(this.rootDir, 'task-request-locks');
    this.mutationReceiptLedger = new TaskMutationReceiptLedger({ rootDir: path.join(this.rootDir, 'mutation-receipts-v1') });
    this.idempotencyLeaseMs = positiveLease(idempotencyLeaseMs);
    this.operationChain = Promise.resolve();
  }

  async createTask({ intent, interfaceLevel = 'guided', instruction, clientCapabilities, executionPolicy, responsePolicy, inputs = {}, idempotencyKey } = {}) {
    return this.serialized(async () => {
      requireString(intent, 'intent');
      requireString(instruction, 'instruction');
      const taskId = `task_${crypto.randomUUID()}`;
      const fingerprint = fingerprintRequest({ operation: 'create_task', intent, interfaceLevel, instruction, clientCapabilities, inputs });
      const claim = await this.claimIdempotency({ key: idempotencyKey, fingerprint, operation: 'create_task', taskId });
      if (claim.replayed) return { task: await this.getTask(claim.record.task_id, { includePrivate: true }), replayed: true, recovered_pending: claim.recovered_pending === true };

      const now = new Date().toISOString();
      const task = {
        contract_version: AGENT_CONTRACT_VERSION,
        kind: 'agent_task',
        task_id: taskId,
        task_version: 1,
        state: 'created',
        intent,
        interface_level: ['guided', 'standard', 'expert'].includes(interfaceLevel) ? interfaceLevel : 'guided',
        instruction,
        client_capabilities: clientCapabilities,
        execution_policy: publicExecutionPolicy(executionPolicy),
        ...(responsePolicy ? { response_policy: structuredClone(responsePolicy) } : {}),
        inputs,
        next_action: { action: 'continue_server_work' },
        artifacts: [],
        history: [{ from: null, to: 'created', at: now, reason: 'task_created' }],
        created_at: now,
        updated_at: now,
        private: {}
      };
      await this.writeTask(task);
      await this.finishIdempotencyClaim(claim, taskId);
      return { task, replayed: false, recovered_pending: claim.recovered_pending === true };
    });
  }

  async getTask(taskId, { includePrivate = false } = {}) {
    requireString(taskId, 'task_id');
    let task;
    try {
      task = JSON.parse(await fs.readFile(this.taskPath(taskId), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new AgentContractError('TASK_NOT_FOUND', 'The requested task does not exist.');
      throw error;
    }
    return includePrivate ? task : publicTask(task);
  }

  async claimTaskRequest({ taskId, operation = 'agent_task_request' } = {}) {
    await this.getTask(taskId, { includePrivate: true });
    requireString(operation, 'task_request.operation');
    await fs.mkdir(this.taskRequestLocksDir, { recursive: true, mode: 0o700 });
    const lockPath = path.join(this.taskRequestLocksDir, `${taskId}.lock`);
    const record = {
      version: 'agent-task-request-lock.v1',
      owner_id: crypto.randomUUID(),
      owner_pid: process.pid,
      task_id: taskId,
      operation,
      created_at: new Date().toISOString()
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await createJsonExclusive(lockPath, record);
        return { lockPath, record };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let existing;
        try {
          existing = JSON.parse(await fs.readFile(lockPath, 'utf8'));
        } catch (readError) {
          if (readError?.code === 'ENOENT') continue;
          throw taskRequestConflict(taskId);
        }
        if (!validTaskRequestLock(existing, taskId) || processIsAlive(existing.owner_pid)) {
          throw taskRequestConflict(taskId);
        }
        if (!await recoverDeadTaskRequestLock(lockPath, existing, taskId)) {
          throw taskRequestConflict(taskId);
        }
      }
    }
    throw taskRequestConflict(taskId);
  }

  async releaseTaskRequest(claim) {
    if (!claim?.lockPath || !claim?.record?.owner_id) return;
    let current;
    try {
      current = JSON.parse(await fs.readFile(claim.lockPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    if (current.owner_id !== claim.record.owner_id
      || current.owner_pid !== claim.record.owner_pid
      || current.task_id !== claim.record.task_id) {
      throw new AgentContractError('TASK_STATE_CONFLICT', 'The task request lock owner changed before release.');
    }
    await fs.unlink(claim.lockPath);
  }

  async transition(taskId, to, { reason = 'server_transition', patch = {} } = {}) {
    return this.serialized(async () => {
      const task = await this.getTask(taskId, { includePrivate: true });
      assertTaskTransition(task.state, to);
      const now = new Date().toISOString();
      const next = {
        ...task,
        ...structuredClone(patch),
        task_id: task.task_id,
        state: to,
        task_version: task.task_version + 1,
        updated_at: now,
        history: [...task.history, { from: task.state, to, at: now, reason }]
      };
      await this.writeTask(next);
      return next;
    });
  }

  async update(taskId, patch = {}) {
    return this.serialized(async () => {
      const task = await this.getTask(taskId, { includePrivate: true });
      const next = {
        ...task,
        ...structuredClone(patch),
        task_id: task.task_id,
        state: task.state,
        task_version: task.task_version + 1,
        updated_at: new Date().toISOString()
      };
      await this.writeTask(next);
      return next;
    });
  }

  async restoreCommittedCreation(taskId) {
    return this.serialized(async () => {
      const task = await this.getTask(taskId, {includePrivate: true});
      const {integrity_hmac, ...record} = task.private?.creation?.late_commit || {};
      if (task.intent !== 'create_model' || !['failed', 'executing'].includes(task.state)
        || record.task_id !== taskId || record.source_hash !== task.private.creation.round.source_hash
        || !record.snapshot?.mutation_receipt || integrity_hmac !== await this.mutationReceiptLedger.sign(record)) {
        throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'Creation recovery requires its signed server-recorded late commit.');
      }
      const now = new Date().toISOString();
      const next = {...task, state: 'verifying', task_version: task.task_version + 1, updated_at: now, last_error: null,
        history: [...task.history, {from: task.state, to: 'verifying', at: now, reason: 'verified_late_native_creation_commit_no_replay'}],
        private: {...task.private, creation: {...task.private.creation, round: {...task.private.creation.round,
          phase: 'built', snapshot: record.snapshot, mutation_receipt: record.snapshot.mutation_receipt}}}};
      await this.writeTask(next);
      return next;
    });
  }

  async claimTaskOperation({ taskId, operation, idempotencyKey, input }) {
    return this.serialized(async () => {
      const task = await this.getTask(taskId, { includePrivate: true });
      const fingerprint = fingerprintRequest({ task_id: taskId, operation, input });
      return this.claimIdempotency({
        key: idempotencyKey,
        fingerprint,
        operation,
        taskId,
        taskVersionAtClaim: task.task_version,
        taskStateAtClaim: task.state
      });
    });
  }

  async completeTaskOperation(claim, taskId, { response } = {}) {
    return this.serialized(async () => {
      try {
        return await this.finishIdempotencyClaim(claim, taskId, { response });
      } finally {
        if (claim?.recovery_lock) await releaseIdempotencyRecoveryLock(claim.recovery_lock);
      }
    });
  }

  async abandonTaskOperationRecovery(claim, { errorCode = 'MUTATION_RECOVERY_REQUIRED' } = {}) {
    return this.serialized(async () => {
      if (!claim?.filePath || !claim?.record) return;
      try {
        const current = JSON.parse(await fs.readFile(claim.filePath, 'utf8'));
        if (current.fingerprint !== claim.record.fingerprint || current.bound_task_id !== claim.record.bound_task_id) {
          throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'The recovering idempotency claim changed during finalization.');
        }
        if (current.status === 'completed' || current.completed_at) return;
        await atomicWriteJson(claim.filePath, {
          ...current,
          status: 'pending',
          owner_pid: null,
          lease_expires_at: new Date().toISOString(),
          last_finalization_error: String(errorCode || 'MUTATION_RECOVERY_REQUIRED'),
          finalization_abandoned_at: new Date().toISOString()
        });
      } finally {
        if (claim.recovery_lock) await releaseIdempotencyRecoveryLock(claim.recovery_lock);
      }
    });
  }

  async recordTaskMutationReceipt({ taskId, claim, binding, bridgeReceipt, finalizer } = {}) {
    return this.serialized(async () => {
      const task = await this.getTask(taskId, { includePrivate: true });
      return this.mutationReceiptLedger.record({ task, claim, binding, bridgeReceipt, finalizer });
    });
  }

  async loadTaskMutationReceipt(taskId, { allowMissing = false, claimRecord } = {}) {
    const receipt = await this.mutationReceiptLedger.load(taskId, { allowMissing });
    if (receipt && claimRecord) await this.mutationReceiptLedger.verify(receipt, { taskId, claimRecord });
    return receipt;
  }

  async claimMutationFinalizationRecovery(taskId) {
    return this.serialized(async () => {
      const task = await this.getTask(taskId, { includePrivate: true });
      if (!['executing', 'verifying'].includes(task.state)) return null;
      const receipt = await this.mutationReceiptLedger.load(taskId, { allowMissing: true });
      if (!receipt) {
        return { outcome_unknown: true, task };
      }
      const filePath = this.idempotencyClaimPath(receipt.idempotency_claim_id);
      let existing;
      try {
        existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'The mutation receipt idempotency claim is missing.');
        }
        throw error;
      }
      await this.mutationReceiptLedger.verify(receipt, { taskId, claimRecord: existing });
      if (existing.status === 'completed' || existing.completed_at) {
        return { receipt, task, completed_claim: existing, filePath };
      }
      if (existing.response !== undefined) {
        throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'A pending mutation claim unexpectedly already contains a response.');
      }
      if (!pendingClaimIsStale(existing, this.idempotencyLeaseMs)) return null;
      const recoveryLock = await acquireIdempotencyRecoveryLock(filePath, this.idempotencyLeaseMs);
      if (!recoveryLock) return null;
      try {
        existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
        await this.mutationReceiptLedger.verify(receipt, { taskId, claimRecord: existing });
        if (existing.status === 'completed' || existing.completed_at) {
          await releaseIdempotencyRecoveryLock(recoveryLock);
          return { receipt, task, completed_claim: existing, filePath };
        }
        if (existing.response !== undefined) {
          throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'A pending mutation claim unexpectedly already contains a response.');
        }
        if (!pendingClaimIsStale(existing, this.idempotencyLeaseMs)) {
          await releaseIdempotencyRecoveryLock(recoveryLock);
          return null;
        }
        const recovered = recoveredMutationClaim(existing, this.idempotencyLeaseMs);
        await atomicWriteJson(filePath, recovered);
        return {
          filePath,
          record: recovered,
          replayed: false,
          recovered_pending: true,
          recovery_receipt: receipt,
          recovery_lock: recoveryLock
        };
      } catch (error) {
        await releaseIdempotencyRecoveryLock(recoveryLock);
        throw error;
      }
    });
  }

  async registerArtifact(taskId, { filePath, kind = 'json', mediaType = 'application/json', label } = {}) {
    return this.serialized(async () => {
      requireString(filePath, 'artifact.filePath');
      const task = await this.getTask(taskId, { includePrivate: true });
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The server artifact is not a regular file.');
      const resolvedPath = path.resolve(filePath);
      const existingRecord = task.artifacts.find((item) => item.label === (label || path.basename(filePath))
        && item.kind === kind
        && item.media_type === mediaType
        && item.size_bytes === stat.size
        && task.private?.artifact_paths?.[item.handle] === resolvedPath);
      if (existingRecord) return structuredClone(existingRecord);
      const artifactId = crypto.randomUUID();
      const handle = `artifact:${taskId}:${artifactId}`;
      const record = {
        handle,
        kind,
        media_type: mediaType,
        label: label || path.basename(filePath),
        size_bytes: stat.size,
        created_at: new Date().toISOString()
      };
      const next = {
        ...task,
        task_version: task.task_version + 1,
        updated_at: new Date().toISOString(),
        artifacts: [...task.artifacts, record],
        private: {
          ...task.private,
          artifact_paths: { ...(task.private?.artifact_paths || {}), [handle]: resolvedPath }
        }
      };
      await this.writeTask(next);
      return record;
    });
  }

  async readArtifact(handle, { maxChars = 12000, offset = 0 } = {}) {
    const match = /^artifact:(task_[0-9a-f-]+):([0-9a-f-]+)$/i.exec(String(handle || ''));
    if (!match) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact handle is invalid.');
    const task = await this.getTask(match[1], { includePrivate: true });
    const record = task.artifacts.find((item) => item.handle === handle);
    const filePath = task.private?.artifact_paths?.[handle];
    if (!record || !filePath) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact handle does not exist.');
    let content;
    const binary = record.media_type.startsWith('image/') || record.media_type === 'application/octet-stream';
    try {
      const buffer = await fs.readFile(filePath);
      content = binary ? buffer.toString('base64') : buffer.toString('utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact content is no longer available.');
      throw error;
    }
    const requestedLimit = Number(maxChars);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 256 || requestedLimit > 100000) {
      throw new AgentContractError('INVALID_ARGUMENT', 'artifact max_chars must be an integer between 256 and 100000.');
    }
    const limit = requestedLimit;
    const start = Number(offset);
    if (!Number.isInteger(start) || start < 0 || start > content.length) {
      throw new AgentContractError('INVALID_ARGUMENT', 'artifact offset must be an integer within the available content.');
    }
    const end = Math.min(start + limit, content.length);
    const eof = end >= content.length;
    return {
      ...record,
      encoding: binary ? 'base64' : 'utf8',
      content: content.slice(start, end),
      offset: start,
      next_offset: eof ? null : end,
      total_chars: content.length,
      eof,
      truncated: !eof,
      next_action: eof ? null : { action: 'read_artifact', handle, offset: end, max_chars: limit }
    };
  }

  async inspectArtifact(handle) {
    const match = /^artifact:(task_[0-9a-f-]+):([0-9a-f-]+)$/i.exec(String(handle || ''));
    if (!match) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact handle is invalid.');
    const task = await this.getTask(match[1], { includePrivate: true });
    const record = task.artifacts.find((item) => item.handle === handle);
    const filePath = task.private?.artifact_paths?.[handle];
    if (!record || !filePath) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact handle does not exist.');
    let buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The artifact content is no longer available.');
      throw error;
    }
    let json = null;
    if (record.media_type === 'application/json') {
      try {
        json = JSON.parse(buffer.toString('utf8'));
      } catch {
        throw new AgentContractError('MODEL_GRAPH_INTEGRITY_ERROR', 'A JSON lineage artifact is no longer valid JSON.');
      }
    }
    return {
      record: structuredClone(record),
      task_id: match[1],
      content_sha256: `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`,
      json
    };
  }

  async claimIdempotency({ key, fingerprint, operation, taskId = null, taskVersionAtClaim = null, taskStateAtClaim = null }) {
    if (!key) return { disabled: true };
    requireString(key, 'idempotency_key');
    const filePath = this.idempotencyPath(key);
    await fs.mkdir(this.idempotencyDir, { recursive: true });
    const record = {
      key_hash: fingerprintRequest(key),
      fingerprint,
      operation,
      task_id: operation === 'create_task' ? taskId : null,
      bound_task_id: taskId || null,
      status: 'pending',
      owner_pid: process.pid,
      lease_expires_at: new Date(Date.now() + this.idempotencyLeaseMs).toISOString(),
      task_version_at_claim: taskVersionAtClaim,
      task_state_at_claim: taskStateAtClaim,
      created_at: new Date().toISOString()
    };
    try {
      await createJsonExclusive(filePath, record);
      return { filePath, record, replayed: false };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
      assertMatchingIdempotencyRecord(existing, record, operation, taskId);
      const completed = existing.status === 'completed' || Boolean(existing.completed_at);
      if (!completed || !existing.task_id) {
        const recovered = await this.recoverPendingIdempotencyClaim({
          filePath,
          existing,
          replacement: record,
          operation,
          taskId
        });
        if (recovered) return recovered;
        throw new AgentContractError('TASK_STATE_CONFLICT', 'The matching request is still being processed.');
      }
      return { filePath, record: existing, replayed: true };
    }
  }

  async recoverPendingIdempotencyClaim({ filePath, existing, replacement, operation, taskId }) {
    if (!pendingClaimIsStale(existing, this.idempotencyLeaseMs)) return null;
    const recoveryLock = await acquireIdempotencyRecoveryLock(filePath, this.idempotencyLeaseMs);
    if (!recoveryLock) return null;
    let retainRecoveryLock = false;
    try {
      existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
      assertMatchingIdempotencyRecord(existing, replacement, operation, taskId);
      const completedClaim = existing.status === 'completed' || Boolean(existing.completed_at);
      if (completedClaim && existing.task_id) {
        return { filePath, record: existing, replayed: true, recovered_pending: true };
      }
      if (!pendingClaimIsStale(existing, this.idempotencyLeaseMs)) return null;

      const boundTaskId = existing.bound_task_id || existing.task_id || null;
      let boundTask = null;
      if (boundTaskId) {
        try {
          boundTask = await this.getTask(boundTaskId, { includePrivate: true });
        } catch (error) {
          if (error?.code !== 'TASK_NOT_FOUND') throw error;
        }
      }
      if (operation === 'create_task') {
        if (boundTask) {
          const completed = recoveredCompletedClaim(existing, boundTask.task_id);
          await atomicWriteJson(filePath, completed);
          return { filePath, record: completed, replayed: true, recovered_pending: true };
        }
        const recovered = {
          ...replacement,
          task_id: taskId,
          bound_task_id: taskId,
          recovered_at: new Date().toISOString()
        };
        await atomicWriteJson(filePath, recovered);
        return { filePath, record: recovered, replayed: false, recovered_pending: true };
      }
      if (!boundTask) {
        throw new AgentContractError('TASK_STATE_CONFLICT', 'A stale idempotency claim references a missing task.');
      }
      if (['executing', 'verifying'].includes(boundTask.state)) {
        const receipt = await this.mutationReceiptLedger.load(boundTask.task_id, { allowMissing: true });
        if (receipt) {
          await this.mutationReceiptLedger.verify(receipt, { taskId: boundTask.task_id, claimRecord: existing });
          if (existing.response !== undefined) {
            throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'A pending mutation claim unexpectedly already contains a response.');
          }
          const recovered = recoveredMutationClaim(existing, this.idempotencyLeaseMs);
          await atomicWriteJson(filePath, recovered);
          retainRecoveryLock = true;
          return {
            filePath,
            record: recovered,
            replayed: false,
            recovered_pending: true,
            recovery_receipt: receipt,
            recovery_lock: recoveryLock
          };
        }
        throw new AgentContractError('MUTATION_EXECUTION_FAILED', 'A prior request stopped after mutation may have started. Inspect the task and active model before continuing.', {
          details: { task_id: boundTask.task_id, task_state: boundTask.state, outcome_unknown: true }
        });
      }
      const noProgress = boundTask.task_version === existing.task_version_at_claim && boundTask.state === existing.task_state_at_claim;
      if (noProgress) {
        const recovered = { ...replacement, recovered_at: new Date().toISOString() };
        await atomicWriteJson(filePath, recovered);
        return { filePath, record: recovered, replayed: false, recovered_pending: true };
      }
      const completed = recoveredCompletedClaim(existing, boundTask.task_id);
      await atomicWriteJson(filePath, completed);
      return { filePath, record: completed, replayed: true, recovered_pending: true };
    } finally {
      if (!retainRecoveryLock) await releaseIdempotencyRecoveryLock(recoveryLock);
    }
  }

  async finishIdempotencyClaim(claim, taskId, { response } = {}) {
    if (!claim || claim.disabled || claim.replayed) return;
    await atomicWriteJson(claim.filePath, {
      ...claim.record,
      task_id: taskId,
      bound_task_id: claim.record.bound_task_id || taskId,
      status: 'completed',
      lease_expires_at: null,
      ...(response !== undefined ? { response: structuredClone(response) } : {}),
      completed_at: new Date().toISOString()
    });
  }

  async writeTask(task) {
    await fs.mkdir(this.tasksDir, { recursive: true });
    await atomicWriteJson(this.taskPath(task.task_id), task);
  }

  taskPath(taskId) {
    if (!/^task_[0-9a-f-]+$/i.test(taskId)) throw new AgentContractError('INVALID_ARGUMENT', 'task_id has an invalid format.');
    return path.join(this.tasksDir, `${taskId}.json`);
  }

  idempotencyPath(key) {
    return path.join(this.idempotencyDir, `${crypto.createHash('sha256').update(key).digest('hex')}.json`);
  }

  idempotencyClaimPath(claimId) {
    if (!/^[0-9a-f]{64}$/.test(String(claimId || ''))) {
      throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'The mutation receipt idempotency claim id is invalid.');
    }
    return path.join(this.idempotencyDir, `${claimId}.json`);
  }

  serialized(callback) {
    const result = this.operationChain.then(callback, callback);
    this.operationChain = result.catch(() => {});
    return result;
  }
}

function publicTask(task) {
  const { private: _private, inputs: _inputs, ...visible } = structuredClone(task);
  return visible;
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function createJsonExclusive(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.link(temporary, filePath);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentContractError('INVALID_ARGUMENT', `${field} must be a non-empty string.`);
}

function positiveLease(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 10 * 60 * 1000) {
    throw new AgentContractError('INVALID_ARGUMENT', 'idempotencyLeaseMs must be between 10 ms and 10 minutes.');
  }
  return parsed;
}

function taskRequestConflict(taskId) {
  return new AgentContractError(
    'TASK_STATE_CONFLICT',
    'Another request for this task is already in flight.',
    { nextAction: { action: 'resume_task', task_id: taskId, retry: 'after_current_request' } }
  );
}

function validTaskRequestLock(value, taskId) {
  return value?.version === 'agent-task-request-lock.v1'
    && value.task_id === taskId
    && typeof value.owner_id === 'string'
    && /^[0-9a-f-]{36}$/i.test(value.owner_id)
    && Number.isInteger(value.owner_pid)
    && value.owner_pid > 0;
}

async function recoverDeadTaskRequestLock(lockPath, expected, taskId) {
  const recoveryPath = `${lockPath}.recovery`;
  const recovery = {
    version: 'agent-task-request-lock-recovery.v1',
    owner_id: crypto.randomUUID(),
    owner_pid: process.pid,
    task_id: taskId,
    created_at: new Date().toISOString()
  };
  try {
    await createJsonExclusive(recoveryPath, recovery);
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
  try {
    let current;
    try {
      current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      return false;
    }
    if (!validTaskRequestLock(current, taskId)
      || current.owner_id !== expected.owner_id
      || current.owner_pid !== expected.owner_pid
      || processIsAlive(current.owner_pid)) return false;
    await fs.unlink(lockPath);
    return true;
  } finally {
    await fs.unlink(recoveryPath).catch(() => {});
  }
}

function pendingClaimIsStale(record, fallbackLeaseMs) {
  const leaseExpiry = Date.parse(record?.lease_expires_at || '');
  const createdAt = Date.parse(record?.created_at || '');
  const expired = Number.isFinite(leaseExpiry)
    ? leaseExpiry <= Date.now()
    : Number.isFinite(createdAt) && createdAt + fallbackLeaseMs <= Date.now();
  return expired && !processIsAlive(record?.owner_pid);
}

function processIsAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function recoveredCompletedClaim(record, taskId) {
  return {
    ...record,
    task_id: taskId,
    bound_task_id: record.bound_task_id || taskId,
    status: 'completed',
    lease_expires_at: null,
    recovered_at: new Date().toISOString(),
    completed_at: new Date().toISOString()
  };
}

function recoveredMutationClaim(record, leaseMs) {
  return {
    ...record,
    status: 'recovery_pending',
    owner_pid: process.pid,
    lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
    finalization_recovery_started_at: new Date().toISOString()
  };
}

function assertMatchingIdempotencyRecord(record, replacement, operation, taskId) {
  const boundTaskId = record.bound_task_id || record.task_id || null;
  if (record.fingerprint !== replacement.fingerprint || record.operation !== operation || (operation !== 'create_task' && taskId && boundTaskId && boundTaskId !== taskId)) {
    throw new AgentContractError('IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for a different request.');
  }
}

async function acquireIdempotencyRecoveryLock(filePath, leaseMs) {
  const lockPath = `${filePath}.recovery.lock`;
  const ownerToken = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      const now = new Date();
      await handle.writeFile(`${JSON.stringify({
        owner_token: ownerToken,
        owner_pid: process.pid,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        created_at: now.toISOString()
      }, null, 2)}\n`, 'utf8');
      await handle.close();
      return { lockPath, ownerToken };
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== 'EEXIST') {
        await fs.unlink(lockPath).catch(() => {});
        throw error;
      }
      const stale = await idempotencyRecoveryLockIsStale(lockPath, leaseMs);
      if (!stale) return null;
      await fs.unlink(lockPath).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      });
    }
  }
  return null;
}

async function idempotencyRecoveryLockIsStale(lockPath, fallbackLeaseMs) {
  try {
    const record = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    return pendingClaimIsStale(record, fallbackLeaseMs);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    const stat = await fs.stat(lockPath).catch((statError) => {
      if (statError?.code === 'ENOENT') return null;
      throw statError;
    });
    return !stat || stat.mtimeMs + fallbackLeaseMs <= Date.now();
  }
}

async function releaseIdempotencyRecoveryLock({ lockPath, ownerToken }) {
  try {
    const record = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    if (record.owner_token !== ownerToken) return;
    await fs.unlink(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
