import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { defaultQueueDir, defaultResponseDir } from './paths.mjs';
import { materializeDslAssetPaths } from './dsl-asset-paths.mjs';
import { AgentContractError } from './agent-contract.mjs';
import { assertStructuralProbeResult, normalizeStructuralProbeOptions } from './model-adoption.mjs';

const DEFAULT_LOCK_TIMEOUT_MS = 30000;
const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const QUEUE_REQUEST_ID_PATTERN = /^(?<clientPid>[1-9]\d{0,14})-(?<createdAtMs>\d{13})-(?<uuid>[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const QUEUE_GUARDED_METHODS = new Set([
  'reset_model', 'build_model', 'save_model', 'save_model_version', 'open_model', 'close_reopen_saved_model', 'import_model', 'export_model',
  'adopt_open_model', 'set_selection', 'capture_view', 'capture_detail_views', 'run_ruby_expert'
]);
const QUEUE_MODEL_MUTATING_METHODS = new Set([
  'reset_model', 'build_model', 'import_model', 'adopt_open_model', 'run_ruby_expert'
]);
const QUEUE_DOCUMENT_SWITCH_METHODS = new Set(['open_model', 'close_reopen_saved_model']);
const INTERRUPT_SAFE_READ_ONLY_QUEUE_METHODS = new Set([
  'get_capabilities',
  'get_session_state',
  'get_active_model_identity',
  'inspect_model',
  'query_model_geometry',
  'inspect_detail_regions',
  'list_entities',
  'get_model_info',
  'get_selection'
]);
const ownedQueueArtifacts = new Set();
const ownedProcessingArtifacts = new Set();
const ownedResponseProcessingPairs = new Map();
let queueRuntimeShuttingDown = false;

export class QueueRuntime {
  constructor({
    queueDir = defaultQueueDir,
    responseDir = defaultResponseDir,
    processingDir = process.env.ALMA_SKETCHUP_PROCESSING_DIR || path.join(path.dirname(queueDir), 'processing'),
    cancellationDir = process.env.ALMA_SKETCHUP_CANCELLATION_DIR || path.join(path.dirname(queueDir), 'read-only-cancellations'),
    repoRoot = process.cwd(),
    timeoutMs = 30000,
    lockPath,
    lockTimeoutMs,
    staleLockMs = numberFromEnv('ALMA_SKETCHUP_QUEUE_STALE_LOCK_MS', DEFAULT_STALE_LOCK_MS),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  } = {}) {
    this.queueDir = queueDir;
    this.responseDir = responseDir;
    this.processingDir = processingDir;
    this.cancellationDir = cancellationDir;
    this.repoRoot = path.resolve(repoRoot);
    this.timeoutMs = timeoutMs;
    this.lockPath = lockPath || path.join(path.dirname(queueDir), 'queue-runtime.lock');
    this.lockTimeoutMs = lockTimeoutMs ?? numberFromEnv('ALMA_SKETCHUP_QUEUE_LOCK_TIMEOUT_MS', Math.max(timeoutMs || 0, DEFAULT_LOCK_TIMEOUT_MS));
    this.staleLockMs = staleLockMs;
    this.pollIntervalMs = pollIntervalMs;
    this.lockDepth = 0;
    this.mutationGuardContext = null;
  }

  async queryModelGeometry(options = {}) { return this.call('query_model_geometry', options); }

  async getCapabilities() {
    return this.call('get_capabilities', {});
  }

  async getSessionState() {
    return this.call('get_session_state', {});
  }

  async getActiveModelIdentity() {
    return this.call('get_active_model_identity', {});
  }

  async createFreshHandshakeProbe() {
    return this.withFreshHandshakeProbe((runtimeState) => runtimeState, {
      method: 'create_queue_handshake'
    });
  }

  async withFreshHandshakeProbe(callback, { method = 'create_queue_handshake' } = {}) {
    if (typeof callback !== 'function') throw new TypeError('Fresh handshake probe callback is required.');
    await sweepInterruptedReadOnlyQueueArtifacts({
      cancellationDir: this.cancellationDir,
      processingDir: this.processingDir,
      responseDir: this.responseDir
    });
    const before = await this.diagnostics({ includeFiles: true });
    assertFreshHandshakeDiagnostics(before);
    return this.withExclusiveAccess(async () => {
      const [queue, processing, responses] = await Promise.all([
        directoryDiagnostics(this.queueDir, { includeFiles: true }),
        directoryDiagnostics(this.processingDir, { includeFiles: true }),
        directoryDiagnostics(this.responseDir, { includeFiles: true })
      ]);
      assertFreshHandshakeDiagnostics({ ...before, queue, processing, responses, lock: { exists: false, stale: false } });
      const runtimeState = await this.callUnlocked('get_session_state', {});
      return callback(runtimeState);
    }, { method, failIfLocked: true });
  }

  async assertIdleForMutation() {
    await sweepInterruptedReadOnlyQueueArtifacts({
      cancellationDir: this.cancellationDir,
      processingDir: this.processingDir,
      responseDir: this.responseDir
    });
    const [queue, processing, responses] = await Promise.all([
      directoryDiagnostics(this.queueDir, { includeFiles: true }),
      directoryDiagnostics(this.processingDir, { includeFiles: true }),
      directoryDiagnostics(this.responseDir, { includeFiles: true })
    ]);
    assertFreshHandshakeDiagnostics({ queue, processing, responses, lock: { exists: false, stale: false } });
    return { queue_state: 'idle' };
  }

  async resetModel() {
    return this.call('reset_model', {});
  }

  async buildModel(code) {
    const queueReadyCode = materializeDslAssetPaths(code, { repoRoot: this.repoRoot });
    return this.call('build_model', { code: queueReadyCode });
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

  async saveModelVersion({ outputPath, basePath, label, keepSession = true } = {}) {
    const requestedPath = outputPath || basePath;
    const resolvedPath = requestedPath ? path.resolve(requestedPath) : requestedPath;
    const result = await this.call('save_model_version', { path: resolvedPath, base_path: resolvedPath, label, keep_session: keepSession });
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

  async openModel({ inputPath, path: requestedPath } = {}) {
    const sourcePath = inputPath || requestedPath;
    const resolvedPath = sourcePath ? path.resolve(sourcePath) : sourcePath;
    return this.call('open_model', { path: resolvedPath });
  }

  async closeReopenSavedModel(binding) {
    return this.call('close_reopen_saved_model', binding);
  }

  async importModel({ inputPath, path: requestedPath, mode, prefix, options = {} } = {}) {
    const normalizedMode = assertQueueImportModeAllowed(mode);
    const sourcePath = inputPath || requestedPath;
    const resolvedPath = sourcePath ? path.resolve(sourcePath) : sourcePath;
    return this.call('import_model', { path: resolvedPath, mode: normalizedMode, prefix, options });
  }

  async exportModel({ outputPath, path: requestedPath, format, options = {} } = {}) {
    const targetPath = outputPath || requestedPath;
    const resolvedPath = targetPath ? path.resolve(targetPath) : targetPath;
    const result = await this.call('export_model', { path: resolvedPath, format, options });
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

  async inspectModel(options = {}) {
    return this.call('inspect_model', options);
  }

  async inspectDetailRegions(options = {}) {
    return this.call('inspect_detail_regions', options);
  }

  async listEntities(options = {}) {
    return this.call('list_entities', options);
  }

  async getModelInfo() {
    return this.call('get_model_info', {});
  }

  async adoptOpenModel(options = {}) {
    const structuralProbe = normalizeStructuralProbeOptions(options);
    const params = { ...options };
    if (structuralProbe.requested) {
      params.read_only = true;
      params.structural_groups = structuralProbe.structural_groups;
      params.structural_group_limit = structuralProbe.structural_group_limit;
      params.fresh_manifold_paths = structuralProbe.fresh_manifold_paths;
    } else if (params.structural_groups === false || params.structuralGroups === false) {
      delete params.structural_groups;
    }
    delete params.structuralGroups;
    delete params.structuralGroupLimit;
    delete params.freshManifoldPaths;
    const result = await this.call('adopt_open_model', params);
    return assertStructuralProbeResult(result, structuralProbe, { runtime: 'queue' });
  }

  async getSelection() {
    return this.call('get_selection', {});
  }

  async setSelection({ targets = [], mode = 'replace' } = {}) {
    return this.call('set_selection', { targets, mode });
  }

  async captureView({ outputPath, path: requestedPath, view, scene, width, height, antialias, compression, zoomExtents, zoom_extents, server_visual_capture } = {}) {
    const outputPathValue = outputPath || requestedPath;
    const resolvedPath = outputPathValue ? path.resolve(outputPathValue) : outputPathValue;
    const result = await this.call('capture_view', {
      path: resolvedPath,
      view,
      scene,
      width,
      height,
      antialias,
      compression,
      zoom_extents: zoom_extents ?? zoomExtents,
      server_visual_capture
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

  async captureDetailViews({ views, output_dir } = {}) {
    return this.call('capture_detail_views', { views, output_dir: path.resolve(output_dir) });
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
    const [queue, processing, responses, lock] = await Promise.all([
      directoryDiagnostics(this.queueDir, { includeFiles }),
      directoryDiagnostics(this.processingDir, { includeFiles }),
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
    if (processing.count > 0) {
      recommendations.push('Claimed processing files are present from an interrupted or crashed SketchUp plugin. They will not be replayed automatically; inspect and clean only the owning client artifacts.');
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
      processing_dir: this.processingDir,
      response_dir: this.responseDir,
      lock_path: this.lockPath,
      timeout_ms: this.timeoutMs,
      lock_timeout_ms: this.lockTimeoutMs,
      stale_lock_ms: this.staleLockMs,
      queue,
      processing,
      responses,
      lock,
      recommendations
    };
  }

  async recoverOrphanResponse({ requestId, expectedResultKind, expectedClientPid } = {}) {
    const expectation = normalizeOrphanResponseExpectation({ requestId, expectedResultKind, expectedClientPid });
    return this.withExclusiveAccess(async () => {
      await assertQueueAndProcessingIdle(this, expectation.request_id);

      const responseFilename = `${expectation.request_id}.json`;
      const responsePath = path.join(this.responseDir, responseFilename);
      const entries = await readDirectoryEntries(this.responseDir);
      const jsonEntries = entries.filter((entry) => entry.endsWith('.json'));
      if (jsonEntries.length === 0) {
        throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The exact orphan queue response was not found.', {
          details: {
            artifact: 'queue_response',
            request_id: expectation.request_id,
            response_filename: responseFilename
          }
        });
      }
      if (jsonEntries.length !== 1 || jsonEntries[0] !== responseFilename) {
        throw new AgentContractError('QUEUE_RESPONSES_PENDING', 'Orphan response recovery requires exactly one JSON response matching request_id.', {
          details: {
            request_id: expectation.request_id,
            expected_response_filename: responseFilename,
            response_count: jsonEntries.length,
            exact_response_only: false,
            response_removed: false
          },
          nextAction: { action: 'inspect_orphan_queue_responses' }
        });
      }

      const before = await assertRegularRecoveryFile(responsePath, expectation.request_id);
      const raw = await fs.readFile(responsePath, 'utf8');
      const afterRead = await assertRegularRecoveryFile(responsePath, expectation.request_id);
      assertSameRecoveryFile(before, afterRead, expectation.request_id);
      const response = parseRecoveryResponse(raw, expectation);

      // The SketchUp plugin does not use the Node-side lock. Recheck both
      // request directories after parsing and before consuming the response.
      await assertQueueAndProcessingIdle(this, expectation.request_id);
      const beforeRemove = await assertRegularRecoveryFile(responsePath, expectation.request_id);
      assertSameRecoveryFile(before, beforeRemove, expectation.request_id);
      await fs.rm(responsePath);

      return {
        version: 'queue-response-recovery.v1',
        kind: 'queue_orphan_response_recovery',
        runtime: 'queue',
        mutates_model: false,
        request_id: expectation.request_id,
        request_client_pid: expectation.request_client_pid,
        expected_result_kind: expectation.expected_result_kind,
        ...(expectation.expected_client_pid === undefined ? {} : { expected_client_pid: expectation.expected_client_pid }),
        response_filename: responseFilename,
        queue_idle_verified: true,
        processing_idle_verified: true,
        lock_idle_verified: true,
        response_removed: true,
        recovered_at: new Date().toISOString(),
        result: response.result
      };
    }, { method: 'recover_queue_response', failIfLocked: true });
  }

  async call(method, params) {
    return this.withExclusiveAccess(() => this.callUnlocked(method, params), { method });
  }

  async withMutationGuard(guard, callback) {
    const previous = this.mutationGuardContext;
    this.mutationGuardContext = {
      guard: structuredClone(guard),
      revisionConsumed: false,
      invalidatedByDocumentSwitch: null
    };
    try {
      return await callback();
    } finally {
      this.mutationGuardContext = previous;
    }
  }

  async callUnlocked(method, params) {
    if (queueRuntimeShuttingDown) throw new Error('Queue runtime is shutting down.');
    await fs.mkdir(this.queueDir, { recursive: true });
    await fs.mkdir(this.processingDir, { recursive: true });
    await fs.mkdir(this.responseDir, { recursive: true });
    await sweepInterruptedReadOnlyQueueArtifacts({
      cancellationDir: this.cancellationDir,
      processingDir: this.processingDir,
      responseDir: this.responseDir
    });

    const id = `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;
    const requestPath = path.join(this.queueDir, `${id}.json`);
    const processingPath = path.join(this.processingDir, `${id}.json`);
    const responsePath = path.join(this.responseDir, `${id}.json`);
    const guardedParams = this.guardedParams(method, params);
    const request = { id, method, params: guardedParams, client_pid: process.pid, created_at: new Date().toISOString() };
    ownedQueueArtifacts.add(requestPath);
    ownedQueueArtifacts.add(processingPath);
    ownedQueueArtifacts.add(responsePath);
    ownedProcessingArtifacts.add(processingPath);
    ownedResponseProcessingPairs.set(responsePath, processingPath);
    try {
      await fs.writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
    } catch (error) {
      await fs.rm(requestPath, { force: true }).catch(() => {});
      ownedQueueArtifacts.delete(requestPath);
      ownedQueueArtifacts.delete(processingPath);
      ownedQueueArtifacts.delete(responsePath);
      ownedProcessingArtifacts.delete(processingPath);
      ownedResponseProcessingPairs.delete(responsePath);
      throw error;
    }

    let outcomeObserved = false;
    try {
      const startedAt = Date.now();
      while (Date.now() - startedAt < this.timeoutMs) {
        await sweepInterruptedReadOnlyQueueArtifacts({
          cancellationDir: this.cancellationDir,
          processingDir: this.processingDir,
          responseDir: this.responseDir
        });
        try {
          const raw = await fs.readFile(responsePath, 'utf8');
          const response = JSON.parse(raw);
          outcomeObserved = true;
          await fs.rm(responsePath, { force: true });
          if (response.error) throw queueResponseError(response.error);
          this.recordSuccessfulGuardedCall(method, guardedParams);
          return response.result;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        await sleep(this.pollIntervalMs);
      }

      throw new Error(`Timed out waiting for SketchUp plugin response after ${this.timeoutMs}ms. Open SketchUp and enable Alma SketchUp MCP Bridge.`);
    } finally {
      await fs.rm(requestPath, { force: true }).catch(() => {});
      if (outcomeObserved) {
        await fs.rm(processingPath, { force: true }).catch(() => {});
        await fs.rm(responsePath, { force: true }).catch(() => {});
      }
      // Until the call loop parses a complete atomic response, preserve any
      // processing marker and response file. Either may be the only evidence
      // that SketchUp executed the request before client-side task persistence.
      ownedQueueArtifacts.delete(requestPath);
      ownedQueueArtifacts.delete(processingPath);
      ownedQueueArtifacts.delete(responsePath);
      ownedProcessingArtifacts.delete(processingPath);
      ownedResponseProcessingPairs.delete(responsePath);
    }
  }

  async withExclusiveAccess(callback, { method = 'queue-runtime', failIfLocked = false } = {}) {
    if (queueRuntimeShuttingDown) throw new Error('Queue runtime is shutting down.');
    if (this.lockDepth > 0) return callback();

    await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    const startedAt = Date.now();
    while (true) {
      if (queueRuntimeShuttingDown) throw new Error('Queue runtime is shutting down.');
      let handle;
      try {
        handle = await fs.open(this.lockPath, 'wx');
        ownedQueueArtifacts.add(this.lockPath);
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
        if (error.code !== 'EEXIST') {
          await fs.rm(this.lockPath, { force: true }).catch(() => {});
          ownedQueueArtifacts.delete(this.lockPath);
          throw error;
        }
        if (failIfLocked) {
          const lock = await lockDiagnostics(this.lockPath, this.staleLockMs);
          const code = lock.stale ? 'QUEUE_STALE_LOCK' : 'QUEUE_LOCK_PRESENT';
          throw new AgentContractError(code, 'An existing queue lock prevents fresh Session Contract authorization.', {
            details: { lock, method }
          });
        }
        await this.removeStaleLock();
        if (Date.now() - startedAt > this.lockTimeoutMs) {
          throw new AgentContractError('QUEUE_LOCK_PRESENT', `Timed out waiting for SketchUp queue runtime lock after ${this.lockTimeoutMs}ms.`, {
            details: { lock_path: this.lockPath, method }
          });
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
      ownedQueueArtifacts.delete(this.lockPath);
    }
  }

  guardedParams(method, params) {
    const context = this.mutationGuardContext;
    const readOnlyAdoption = method === 'adopt_open_model'
      && (params?.read_only === true || params?.readOnly === true);
    // Read-only adoption remains callable without a Session Contract, but when
    // it runs inside an authorized live scope it must carry the same transport
    // guard as the capture/mutation surrounded by that observation.
    const guardedMethod = QUEUE_GUARDED_METHODS.has(method)
      && !(readOnlyAdoption && !context);
    if (!context || !guardedMethod) return params;

    if (context.invalidatedByDocumentSwitch) {
      throw new AgentContractError(
        'HANDSHAKE_DOCUMENT_MISMATCH',
        'The Session Contract was invalidated by a requested document switch. Inspect the active model and create a fresh handshake before another guarded queue operation.',
        {
          details: {
            invalidated_by: context.invalidatedByDocumentSwitch,
            requested_method: method,
            queue_request_created: false
          }
        }
      );
    }

    const transportGuard = { ...context.guard };
    if (context.revisionConsumed) {
      // These two fields describe the exact pre-mutation model state and must
      // be consumed together. Keeping model_modified after a successful
      // mutation would compare the now-modified document against the stale
      // handshake value on every subsequent guarded observation or save.
      delete transportGuard.model_revision;
      delete transportGuard.model_modified;
    }
    if (QUEUE_DOCUMENT_SWITCH_METHODS.has(method)) context.invalidatedByDocumentSwitch = method;
    return { ...params, _session_guard: transportGuard };
  }

  recordSuccessfulGuardedCall(method, params) {
    const context = this.mutationGuardContext;
    if (!context || context.revisionConsumed) return;
    if (!params?._session_guard?.model_revision) return;
    if (queueMethodConsumesModelRevision(method, params)) context.revisionConsumed = true;
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

function queueMethodConsumesModelRevision(method, params) {
  if (method === 'adopt_open_model' && (params?.read_only === true || params?.readOnly === true)) return false;
  if (QUEUE_MODEL_MUTATING_METHODS.has(method)) return true;
  // Ruby implements keep_session=false by resetting the active model after the
  // save completes, so that variant is a model mutation even though an ordinary
  // save/save-version is not.
  return (method === 'save_model' || method === 'save_model_version')
    && params?.keep_session === false;
}

export function assertQueueImportModeAllowed(mode) {
  const normalizedMode = String(mode || 'append').toLowerCase();
  if (normalizedMode !== 'replace') return normalizedMode;

  throw new AgentContractError(
    'OPERATION_NOT_ALLOWED',
    'import_model mode=replace is disabled for queue runtime because a failed import could erase the active SketchUp model.',
    {
      details: {
        operation: 'import_model',
        runtime: 'queue',
        requested_mode: normalizedMode,
        model_state_preserved: true,
        queue_request_created: false,
        allowed_queue_modes: ['append']
      },
      nextAction: {
        action: 'prepare_new_plan',
        allowed_queue_modes: ['append'],
        alternatives: ['open_model'],
        note: 'Use import_model mode=append to preserve the active model, or use open_model when replacing the active document is intended.'
      }
    }
  );
}

export async function cleanupOwnedQueueArtifacts() {
  queueRuntimeShuttingDown = true;
  for (let pass = 0; pass < 3; pass += 1) {
    const artifacts = [...ownedQueueArtifacts];
    await Promise.all(artifacts.map(async (artifactPath) => {
      // A claimed request may already have mutated SketchUp before the client
      // persists its task outcome. Signal cleanup removes unclaimed queue files
      // and locks, but never erases processing or an unobserved response.
      if (ownedProcessingArtifacts.has(artifactPath)) return;
      if (ownedResponseProcessingPairs.has(artifactPath)) return;
      await fs.rm(artifactPath, { force: true }).catch(() => {});
    }));
    if (pass < 2) await new Promise((resolve) => setImmediate(resolve));
  }
  ownedQueueArtifacts.clear();
  ownedProcessingArtifacts.clear();
  ownedResponseProcessingPairs.clear();
}

export async function cleanupQueueArtifactsForPid(pid, {
  queueDir = defaultQueueDir,
  processingDir = process.env.ALMA_SKETCHUP_PROCESSING_DIR || path.join(path.dirname(queueDir), 'processing'),
  responseDir = defaultResponseDir,
  cancellationDir = process.env.ALMA_SKETCHUP_CANCELLATION_DIR || path.join(path.dirname(queueDir), 'read-only-cancellations'),
  lockPath = path.join(path.dirname(queueDir), 'queue-runtime.lock'),
  removeReadOnlyProcessing = false
} = {}) {
  const requestIds = new Set();
  const removedRequests = await removeOwnedRequestArtifacts(queueDir, pid, requestIds);
  const processingCleanup = await cleanupOwnedProcessingArtifacts(
    processingDir,
    pid,
    requestIds,
    { removeReadOnlyProcessing, cancellationDir }
  );

  let removedLock = false;
  if (await readArtifactPid(lockPath) === Number(pid)) {
    await fs.rm(lockPath, { force: true });
    removedLock = true;
  }

  let removedResponses = 0;
  let preservedResponses = 0;
  try {
    for (const entry of await fs.readdir(responseDir)) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      if (!requestIds.has(id) && !entry.startsWith(`${Number(pid)}-`)) continue;
      if (processingCleanup.removedIds.has(id)) {
        await fs.rm(path.join(responseDir, entry), { force: true });
        await fs.rm(path.join(cancellationDir, `${id}.json`), { force: true });
        removedResponses += 1;
      } else {
        preservedResponses += 1;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const result = {
    pid: Number(pid),
    removed_requests: removedRequests,
    removed_processing: processingCleanup.removed,
    preserved_processing: processingCleanup.preserved,
    removed_lock: removedLock,
    removed_responses: removedResponses,
    preserved_responses: preservedResponses
  };
  if (removeReadOnlyProcessing) {
    result.pending_read_only_response_cleanup = processingCleanup.removedIds.size - removedResponses;
  }
  return result;
}

async function cleanupOwnedProcessingArtifacts(directory, pid, requestIds, {
  removeReadOnlyProcessing = false,
  cancellationDir
} = {}) {
  const removedIds = new Set();
  let removed = 0;
  let preserved = 0;
  try {
    for (const entry of await fs.readdir(directory)) {
      if (!entry.endsWith('.json')) continue;
      const artifactPath = path.join(directory, entry);
      const document = await readArtifactDocument(artifactPath);
      const owner = Number(document?.client_pid ?? document?.pid);
      if (owner !== Number(pid) && !entry.startsWith(`${Number(pid)}-`)) continue;
      const id = entry.slice(0, -5);
      requestIds.add(id);
      if (removeReadOnlyProcessing && INTERRUPT_SAFE_READ_ONLY_QUEUE_METHODS.has(document?.method)) {
        await persistReadOnlyCancellation(cancellationDir, {
          id,
          client_pid: Number(pid),
          method: document.method
        });
        await fs.rm(artifactPath, { force: true });
        removedIds.add(id);
        removed += 1;
      } else {
        preserved += 1;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { removed, preserved, removedIds };
}

export async function sweepInterruptedReadOnlyQueueArtifacts({
  cancellationDir,
  processingDir,
  responseDir
} = {}) {
  if (!cancellationDir || !processingDir || !responseDir) {
    return { removed_processing: 0, removed_responses: 0, removed_markers: 0, pending_markers: 0 };
  }
  let removedProcessing = 0;
  let removedResponses = 0;
  let removedMarkers = 0;
  let pendingMarkers = 0;
  let entries;
  try {
    entries = await fs.readdir(cancellationDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { removed_processing: 0, removed_responses: 0, removed_markers: 0, pending_markers: 0 };
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const markerPath = path.join(cancellationDir, entry);
    const marker = await readArtifactDocument(markerPath);
    const id = entry.slice(0, -5);
    if (
      !marker
      || marker.id !== id
      || !INTERRUPT_SAFE_READ_ONLY_QUEUE_METHODS.has(marker.method)
      || Number(marker.client_pid) <= 0
    ) {
      pendingMarkers += 1;
      continue;
    }
    const processingPath = path.join(processingDir, `${id}.json`);
    const responsePath = path.join(responseDir, `${id}.json`);
    if (await pathExists(processingPath)) {
      await fs.rm(processingPath, { force: true });
      removedProcessing += 1;
    }
    if (await pathExists(responsePath)) {
      await fs.rm(responsePath, { force: true });
      await fs.rm(markerPath, { force: true });
      removedResponses += 1;
      removedMarkers += 1;
    } else {
      pendingMarkers += 1;
    }
  }
  return {
    removed_processing: removedProcessing,
    removed_responses: removedResponses,
    removed_markers: removedMarkers,
    pending_markers: pendingMarkers
  };
}

async function persistReadOnlyCancellation(cancellationDir, marker) {
  await fs.mkdir(cancellationDir, { recursive: true });
  const markerPath = path.join(cancellationDir, `${marker.id}.json`);
  try {
    await fs.writeFile(markerPath, `${JSON.stringify({
      version: 'queue-read-only-cancellation.v1',
      kind: 'queue_read_only_cancellation',
      ...marker,
      created_at: new Date().toISOString()
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

async function removeOwnedRequestArtifacts(directory, pid, requestIds) {
  let removed = 0;
  try {
    for (const entry of await fs.readdir(directory)) {
      if (!entry.endsWith('.json')) continue;
      const artifactPath = path.join(directory, entry);
      const owner = await readArtifactPid(artifactPath);
      if (owner !== Number(pid) && !entry.startsWith(`${Number(pid)}-`)) continue;
      requestIds.add(entry.slice(0, -5));
      await fs.rm(artifactPath, { force: true });
      removed += 1;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return removed;
}

async function readArtifactPid(artifactPath) {
  const document = await readArtifactDocument(artifactPath);
  return document ? Number(document.client_pid ?? document.pid) : null;
}

async function readArtifactDocument(artifactPath) {
  try {
    return JSON.parse(await fs.readFile(artifactPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOrphanResponseExpectation({ requestId, expectedResultKind, expectedClientPid }) {
  if (typeof requestId !== 'string' || !QUEUE_REQUEST_ID_PATTERN.test(requestId)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'request_id must be the complete canonical QueueRuntime request identifier.', {
      details: { field: 'request_id', expected_format: 'clientPid-createdAtMs-uuidV4' }
    });
  }
  if (typeof expectedResultKind !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(expectedResultKind)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'expected_result_kind must be an explicit stable result kind.', {
      details: { field: 'expected_result_kind' }
    });
  }

  const requestClientPid = Number(QUEUE_REQUEST_ID_PATTERN.exec(requestId).groups.clientPid);
  if (!Number.isSafeInteger(requestClientPid) || requestClientPid < 1) {
    throw new AgentContractError('INVALID_ARGUMENT', 'request_id contains an invalid client PID.', {
      details: { field: 'request_id' }
    });
  }
  if (expectedClientPid !== undefined) {
    if (!Number.isSafeInteger(expectedClientPid) || expectedClientPid < 1) {
      throw new AgentContractError('INVALID_ARGUMENT', 'expected_client_pid must be a positive safe integer.', {
        details: { field: 'expected_client_pid' }
      });
    }
    if (expectedClientPid !== requestClientPid) {
      throw new AgentContractError('INVALID_ARGUMENT', 'expected_client_pid does not match the PID bound into request_id.', {
        details: {
          field: 'expected_client_pid',
          request_id_pid: requestClientPid,
          expected_client_pid: expectedClientPid
        }
      });
    }
  }
  return {
    request_id: requestId,
    request_client_pid: requestClientPid,
    expected_result_kind: expectedResultKind,
    expected_client_pid: expectedClientPid
  };
}

async function assertQueueAndProcessingIdle(runtime, requestId) {
  const [queue, processing] = await Promise.all([
    directoryDiagnostics(runtime.queueDir, { includeFiles: false }),
    directoryDiagnostics(runtime.processingDir, { includeFiles: false })
  ]);
  if (queue.count > 0 || processing.count > 0) {
    throw new AgentContractError('QUEUE_NOT_IDLE', 'Orphan response recovery requires empty queue and processing directories.', {
      details: {
        request_id: requestId,
        queue_count: queue.count,
        processing_count: processing.count,
        response_removed: false
      },
      nextAction: { action: 'wait_for_queue_idle_then_recover_exact_response' }
    });
  }
}

async function readDirectoryEntries(directory) {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function assertRegularRecoveryFile(filePath, requestId) {
  try {
    const stats = await fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw recoveryIntegrityError(requestId, 'response_not_regular_file');
    }
    return stats;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AgentContractError('ARTIFACT_NOT_FOUND', 'The exact orphan queue response disappeared before it could be verified.', {
        details: { artifact: 'queue_response', request_id: requestId }
      });
    }
    throw error;
  }
}

function assertSameRecoveryFile(expected, actual, requestId) {
  if (expected.dev !== actual.dev || expected.ino !== actual.ino || expected.size !== actual.size || expected.mtimeMs !== actual.mtimeMs) {
    throw recoveryIntegrityError(requestId, 'response_changed_during_verification');
  }
}

function parseRecoveryResponse(raw, expectation) {
  let response;
  try {
    response = JSON.parse(raw);
  } catch (_) {
    throw recoveryIntegrityError(expectation.request_id, 'response_invalid_json');
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw recoveryIntegrityError(expectation.request_id, 'response_not_object');
  }
  if (Object.hasOwn(response, 'error')) {
    throw recoveryIntegrityError(expectation.request_id, 'response_contains_error');
  }
  if (Object.keys(response).length !== 1 || !Object.hasOwn(response, 'result')) {
    throw recoveryIntegrityError(expectation.request_id, 'response_envelope_invalid');
  }
  if (!response.result || typeof response.result !== 'object' || Array.isArray(response.result)) {
    throw recoveryIntegrityError(expectation.request_id, 'result_not_object');
  }
  if (response.result.kind !== expectation.expected_result_kind) {
    throw recoveryIntegrityError(expectation.request_id, 'result_kind_mismatch', {
      expected_result_kind: expectation.expected_result_kind,
      actual_result_kind: typeof response.result.kind === 'string' ? response.result.kind : null
    });
  }
  return response;
}

function recoveryIntegrityError(requestId, reason, details = {}) {
  return new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The orphan queue response did not match the explicit recovery expectation.', {
    details: {
      artifact: 'queue_response',
      request_id: requestId,
      reason,
      response_removed: false,
      ...details
    }
  });
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

function assertFreshHandshakeDiagnostics(diagnostics) {
  if (diagnostics.lock?.exists) {
    const code = diagnostics.lock.stale ? 'QUEUE_STALE_LOCK' : 'QUEUE_LOCK_PRESENT';
    throw new AgentContractError(code, diagnostics.lock.stale
      ? 'A stale queue lock is present; fresh handshake issuance fails closed.'
      : 'The queue lock is held by another command; fresh handshake issuance requires an idle queue.', {
      details: { lock: diagnostics.lock }
    });
  }
  if ((diagnostics.queue?.count || 0) > 0) {
    throw new AgentContractError('QUEUE_REQUESTS_PENDING', 'Pending or residual queue request files prevent a fresh handshake.', {
      details: { queue: diagnostics.queue }
    });
  }
  if ((diagnostics.processing?.count || 0) > 0) {
    throw new AgentContractError('QUEUE_REQUESTS_PENDING', 'Claimed requests from an interrupted or crashed plugin prevent a fresh handshake and will not be replayed automatically.', {
      details: { processing: diagnostics.processing }
    });
  }
  if ((diagnostics.responses?.count || 0) > 0) {
    throw new AgentContractError('QUEUE_RESPONSES_PENDING', 'Orphan queue response files prevent a fresh handshake.', {
      details: { responses: diagnostics.responses }
    });
  }
}

function queueResponseError(value) {
  if (value && typeof value === 'object' && value.code) {
    return new AgentContractError(value.code, String(value.message || value.code), {
      details: value.details,
      nextAction: value.next_action
    });
  }
  return new Error(String(value));
}
