import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { defaultQueueDir, defaultResponseDir } from './paths.mjs';

export class QueueRuntime {
  constructor({ queueDir = defaultQueueDir, responseDir = defaultResponseDir, timeoutMs = 30000 } = {}) {
    this.queueDir = queueDir;
    this.responseDir = responseDir;
    this.timeoutMs = timeoutMs;
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
    await fs.mkdir(this.queueDir, { recursive: true });
    await fs.mkdir(this.responseDir, { recursive: true });

    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const requestPath = path.join(this.queueDir, `${id}.json`);
    const responsePath = path.join(this.responseDir, `${id}.json`);
    const request = { id, method, params, created_at: new Date().toISOString() };
    await fs.writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');

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
      await sleep(250);
    }

    throw new Error(`Timed out waiting for SketchUp plugin response after ${this.timeoutMs}ms. Open SketchUp and enable Alma SketchUp MCP Bridge.`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
