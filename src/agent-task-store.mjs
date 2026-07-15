import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENT_CONTRACT_VERSION, AgentContractError, assertTaskTransition, fingerprintRequest } from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';

export class AgentTaskStore {
  constructor({ rootDir = path.join(defaultStateDir, 'agent-contract-v1') } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.tasksDir = path.join(this.rootDir, 'tasks');
    this.idempotencyDir = path.join(this.rootDir, 'idempotency');
    this.operationChain = Promise.resolve();
  }

  async createTask({ intent, interfaceLevel = 'guided', instruction, clientCapabilities, executionPolicy, inputs = {}, idempotencyKey } = {}) {
    return this.serialized(async () => {
      requireString(intent, 'intent');
      requireString(instruction, 'instruction');
      const fingerprint = fingerprintRequest({ operation: 'create_task', intent, interfaceLevel, instruction, clientCapabilities, inputs });
      const claim = await this.claimIdempotency({ key: idempotencyKey, fingerprint, operation: 'create_task' });
      if (claim.replayed) return { task: await this.getTask(claim.record.task_id, { includePrivate: true }), replayed: true };

      const now = new Date().toISOString();
      const taskId = `task_${crypto.randomUUID()}`;
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
        execution_policy: executionPolicy,
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
      return { task, replayed: false };
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

  async claimTaskOperation({ taskId, operation, idempotencyKey, input }) {
    return this.serialized(async () => {
      await this.getTask(taskId, { includePrivate: true });
      const fingerprint = fingerprintRequest({ task_id: taskId, operation, input });
      return this.claimIdempotency({ key: idempotencyKey, fingerprint, operation, taskId });
    });
  }

  async completeTaskOperation(claim, taskId) {
    return this.serialized(() => this.finishIdempotencyClaim(claim, taskId));
  }

  async registerArtifact(taskId, { filePath, kind = 'json', mediaType = 'application/json', label } = {}) {
    return this.serialized(async () => {
      requireString(filePath, 'artifact.filePath');
      const task = await this.getTask(taskId, { includePrivate: true });
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The server artifact is not a regular file.');
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
          artifact_paths: { ...(task.private?.artifact_paths || {}), [handle]: path.resolve(filePath) }
        }
      };
      await this.writeTask(next);
      return record;
    });
  }

  async readArtifact(handle, { maxChars = 12000 } = {}) {
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
    const limit = Math.max(256, Math.min(Number(maxChars) || 12000, 100000));
    return {
      ...record,
      encoding: binary ? 'base64' : 'utf8',
      content: content.slice(0, limit),
      truncated: content.length > limit,
      next_action: content.length > limit ? { action: 'read_artifact', handle, max_chars: Math.min(limit * 2, 100000) } : null
    };
  }

  async claimIdempotency({ key, fingerprint, operation, taskId = null }) {
    if (!key) return { disabled: true };
    requireString(key, 'idempotency_key');
    const filePath = this.idempotencyPath(key);
    await fs.mkdir(this.idempotencyDir, { recursive: true });
    const record = { key_hash: fingerprintRequest(key), fingerprint, operation, task_id: taskId, created_at: new Date().toISOString() };
    try {
      const handle = await fs.open(filePath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
      await handle.close();
      return { filePath, record, replayed: false };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (existing.fingerprint !== fingerprint || existing.operation !== operation || (taskId && existing.task_id && existing.task_id !== taskId)) {
        throw new AgentContractError('IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for a different request.');
      }
      if (!existing.task_id) throw new AgentContractError('TASK_STATE_CONFLICT', 'The matching request is still being processed.');
      return { filePath, record: existing, replayed: true };
    }
  }

  async finishIdempotencyClaim(claim, taskId) {
    if (!claim || claim.disabled || claim.replayed) return;
    await atomicWriteJson(claim.filePath, { ...claim.record, task_id: taskId, completed_at: new Date().toISOString() });
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

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentContractError('INVALID_ARGUMENT', `${field} must be a non-empty string.`);
}
