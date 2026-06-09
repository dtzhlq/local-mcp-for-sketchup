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
    const resolvedPath = outputPath ? path.resolve(outputPath) : outputPath;
    const result = await this.call('save_model', { path: resolvedPath, keep_session: keepSession });
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

  async captureView({ outputPath, path: requestedPath, view, width, height, antialias, compression, zoomExtents, zoom_extents } = {}) {
    const outputPathValue = outputPath || requestedPath;
    const resolvedPath = outputPathValue ? path.resolve(outputPathValue) : outputPathValue;
    const result = await this.call('capture_view', {
      path: resolvedPath,
      view,
      width,
      height,
      antialias,
      compression,
      zoom_extents: zoom_extents ?? zoomExtents
    });
    if (result && result.file_path) {
      try {
        const stats = await fs.stat(result.file_path);
        result.file_size_bytes = stats.size;
      } catch (_) {
        // File may not be accessible; skip.
      }
    }
    return result;
  }

  async runRubyExpert({ code, auditPath, audit_path } = {}) {
    const requestedAuditPath = auditPath || audit_path;
    const resolvedAuditPath = requestedAuditPath ? path.resolve(requestedAuditPath) : requestedAuditPath;
    const result = await this.call('run_ruby_expert', { code, audit_path: resolvedAuditPath });
    if (result && result.audit_path) {
      try {
        const stats = await fs.stat(result.audit_path);
        result.audit_size_bytes = stats.size;
      } catch (_) {
        // File may not be accessible; skip.
      }
    }
    return result;
  }

  async diagnostics({ includeFiles = false } = {}) {
    const stateDir = path.dirname(this.queueDir);
    const [queue, responses, lock] = await Promise.all([
      directoryDiagnostics(this.queueDir, { includeFiles }),
      directoryDiagnostics(this.responseDir, { includeFiles }),
      lockDiagnostics(this.lockPath, this.staleLockMs)
    ]);
    const recommendations = [];
    if (!queue.exists) {
      recommendations.push('Queue directory does not exist yet; start the SketchUp Bridge or run a queue command to initialize it.');
    }
    if (!responses.exists) {
      recommendations.push('Response directory does not exist yet; start the SketchUp Bridge or run a queue command to initialize it.');
    }
    if (lock.exists && lock.stale) {
      recommendations.push(`Queue lock appears stale; if no queue command is running, remove ${this.lockPath}.`);
    } else if (lock.exists) {
      recommendations.push('Queue lock is active; run queue commands serially and wait for the current command to finish.');
    }
    if (queue.count > 0) {
      recommendations.push('Pending queue request files are present; the SketchUp Bridge may not be running or may be busy.');
    }
    if (responses.count > 0) {
      recommendations.push('Response files are present without a waiting client; this can happen after interrupted queue commands.');
    }

    return {
      kind: 'queue_diagnostics',
      runtime: 'queue',
      state_dir: stateDir,
      queue_dir: this.queueDir,
      response_dir: this.responseDir,
      lock_path: this.lockPath,
      timeout_ms: this.timeoutMs,
      lock_timeout_ms: this.lockTimeoutMs,
      stale_lock_ms: this.staleLockMs,
      queue,
      responses,
      lock,
      recommendations
    };
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

async function directoryDiagnostics(dir, { includeFiles = false } = {}) {
  try {
    const entries = await fs.readdir(dir);
    const files = [];
    let oldestMtimeMs = null;
    let newestMtimeMs = null;
    for (const entry of entries.filter((item) => item.endsWith('.json')).sort()) {
      const filePath = path.join(dir, entry);
      const stats = await fs.stat(filePath);
      oldestMtimeMs = oldestMtimeMs === null ? stats.mtimeMs : Math.min(oldestMtimeMs, stats.mtimeMs);
      newestMtimeMs = newestMtimeMs === null ? stats.mtimeMs : Math.max(newestMtimeMs, stats.mtimeMs);
      if (includeFiles) {
        files.push({
          name: entry,
          path: filePath,
          size_bytes: stats.size,
          age_ms: Math.max(0, Date.now() - stats.mtimeMs)
        });
      }
    }
    return {
      exists: true,
      count: entries.filter((item) => item.endsWith('.json')).length,
      oldest_age_ms: oldestMtimeMs === null ? null : Math.max(0, Date.now() - oldestMtimeMs),
      newest_age_ms: newestMtimeMs === null ? null : Math.max(0, Date.now() - newestMtimeMs),
      ...(includeFiles ? { files } : {})
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        exists: false,
        count: 0,
        oldest_age_ms: null,
        newest_age_ms: null,
        ...(includeFiles ? { files: [] } : {})
      };
    }
    throw error;
  }
}

async function lockDiagnostics(lockPath, staleLockMs) {
  try {
    const [raw, stats] = await Promise.all([
      fs.readFile(lockPath, 'utf8').catch(() => null),
      fs.stat(lockPath)
    ]);
    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        parsed = null;
      }
    }
    const ageMs = Math.max(0, Date.now() - stats.mtimeMs);
    return {
      exists: true,
      stale: ageMs > staleLockMs,
      age_ms: ageMs,
      path: lockPath,
      owner: parsed
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        exists: false,
        stale: false,
        age_ms: null,
        path: lockPath,
        owner: null
      };
    }
    throw error;
  }
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
