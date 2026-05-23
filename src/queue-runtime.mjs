import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { defaultQueueDir, defaultResponseDir } from './paths.mjs';

const DEFAULT_LOCK_TIMEOUT_MS = 30000;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export class QueueRuntime {
  constructor({
    queueDir = defaultQueueDir,
    responseDir = defaultResponseDir,
    timeoutMs = 30000,
    lockPath,
    lockTimeoutMs,
    staleLockMs = numberFromEnv('ALMA_SKETCHUP_QUEUE_STALE_LOCK_MS', DEFAULT_STALE_LOCK_MS),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  } = {}) {
    this.queueDir = queueDir;
    this.responseDir = responseDir;
    this.timeoutMs = timeoutMs;
    this.lockPath = lockPath || path.join(path.dirname(queueDir), 'queue-runtime.lock');
    this.lockTimeoutMs = lockTimeoutMs ?? numberFromEnv('ALMA_SKETCHUP_QUEUE_LOCK_TIMEOUT_MS', Math.max(timeoutMs || 0, DEFAULT_LOCK_TIMEOUT_MS));
    this.staleLockMs = staleLockMs;
    this.pollIntervalMs = pollIntervalMs;
    this.lockDepth = 0;
  }

  async getCapabilities() {
    return this.call('get_capabilities', {});
  }

  async resetModel() {
    return this.call('reset_model', {});
  }

  async buildModel(code) {
    return this.call('build_model', { code });
  }

  async saveModel({ outputPath, keepSession = true } = {}) {
    const result = await this.call('save_model', { path: outputPath, keep_session: keepSession });
    // Stat the saved file to get size
    if (result && result.file_path) {
      try {
        const stats = await fs.stat(result.file_path);
        result.file_size_bytes = stats.size;
      } catch (_) {
        // File may not be accessible; skip
      }
    }
    return result;
  }

  async call(method, params) {
    return this.withExclusiveAccess(() => this.callUnlocked(method, params), { method });
  }

  async callUnlocked(method, params) {
    await fs.mkdir(this.queueDir, { recursive: true });
    await fs.mkdir(this.responseDir, { recursive: true });

    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const requestPath = path.join(this.queueDir, `${id}.json`);
    const responsePath = path.join(this.responseDir, `${id}.json`);
    const request = { id, method, params, created_at: new Date().toISOString() };
    await fs.writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');

    try {
      const startedAt = Date.now();
      while (Date.now() - startedAt < this.timeoutMs) {
        try {
          const raw = await fs.readFile(responsePath, 'utf8');
          const response = JSON.parse(raw);
          await fs.rm(responsePath, { force: true });
          if (response.error) {
            throw new Error(response.error);
          }
          return response.result;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await sleep(this.pollIntervalMs);
      }

      throw new Error(`Timed out waiting for SketchUp plugin response after ${this.timeoutMs}ms. Open SketchUp and enable Alma SketchUp MCP Bridge.`);
    } finally {
      await fs.rm(requestPath, { force: true }).catch(() => {});
    }
  }

  async withExclusiveAccess(callback, { method = 'queue-runtime' } = {}) {
    if (this.lockDepth > 0) return callback();

    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      let handle;
      try {
        handle = await fs.open(this.lockPath, 'wx');
        await handle.writeFile(`${JSON.stringify({
          pid: process.pid,
          method,
          queue_dir: this.queueDir,
          created_at: new Date().toISOString()
        }, null, 2)}\n`);
        await handle.close();
        break;
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        if (error.code !== 'EEXIST') throw error;
        await this.removeStaleLock();
        if (Date.now() - startedAt > this.lockTimeoutMs) {
          throw new Error(`Timed out waiting for SketchUp queue runtime lock after ${this.lockTimeoutMs}ms: ${this.lockPath}. Another queue command may be running; run queue commands serially.`);
        }
        await sleep(Math.min(this.pollIntervalMs, 100));
      }
    }

    this.lockDepth += 1;
    try {
      return await callback();
    } finally {
      this.lockDepth -= 1;
      await fs.rm(this.lockPath, { force: true }).catch(() => {});
    }
  }

  async removeStaleLock() {
    try {
      const stats = await fs.stat(this.lockPath);
      if (Date.now() - stats.mtimeMs > this.staleLockMs) {
        await fs.rm(this.lockPath, { force: true });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}
