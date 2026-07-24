#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODE_REGISTRY } from './agent-contract.mjs';
import { SketchUpBridge, callTool } from './bridge.mjs';
import { defaultStateDir, projectRoot } from './paths.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { getToolDefinition, getToolEffect, listToolDefinitions, listToolNames } from './tool-registry.mjs';
import { ToolInputValidator } from './tool-input-validator.mjs';
import { PRODUCT_VERSION } from './version.mjs';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 65_000;
const INPUT_FILE_PATH_KEYS = new Set([
  'path', 'input_dir', 'output_dir', 'asset_set_path', 'observations_path', 'candidate_graph_path',
  'modeling_brief_path', 'promotion_review_path', 'source_package_path', 'output_json', 'output_markdown',
  'mcp_brief_path', 'part_graph_path', 'profile_path', 'output_dsl', 'plan_file', 'review_file', 'save_path',
  'base_path', 'audit_path', 'intent_file', 'file_path', 'input_path', 'output_path', 'texture',
  'file', 'filename', 'image', 'texture_root', 'textureRoot', 'image_reference', 'imageReference',
  'outputDir', 'output_root', 'outputRoot', 'allowed_output_root', 'allowedOutputRoot', 'report_dir', 'reportDir'
]);
const OUTPUT_FILE_PATH_KEYS = new Set([
  ...INPUT_FILE_PATH_KEYS,
  'allowed_output_root', 'artifact_path', 'capture_path', 'final_save_path', 'graph_path', 'inventory_path',
  'lock_path', 'manifest_path', 'model_path', 'preview_path', 'processing_dir', 'queue_dir', 'recapture_path',
  'relative_path', 'response_dir', 'review_path', 'source_path', 'source_root', 'state_dir',
  'allowedOutputRoot', 'artifactPath', 'capturePath', 'destinationPath', 'graphPath', 'inputDir', 'inputRoot',
  'inventoryPath', 'lockPath', 'manifestPath', 'modelPath', 'outputDir', 'outputPath', 'outputRoot',
  'previewPath', 'processingDir', 'queueDir', 'recapturePath', 'relativePath', 'repoRoot', 'responseDir',
  'reviewPath', 'rootDir', 'sourcePath', 'sourceRoot', 'stateDir', 'tempRoot', 'textureRoot', 'workingPath',
  'workspaceRoot'
]);
const OUTPUT_DIRECTORY_INPUT_KEYS = new Set([
  'output_dir', 'outputDir', 'output_root', 'outputRoot', 'allowed_output_root', 'allowedOutputRoot',
  'report_dir', 'reportDir'
]);
const MAX_OUTPUT_SYMLINK_SCAN_ENTRIES = 10_000;
const HTTP_COMPILER_RESOURCE_LIMITS = Object.freeze({
  maxOperations: 2_000,
  maxLoopIterations: 10_000,
  maxStatements: 50_000,
  maxOutputBytes: 5_000_000
});
export function createHttpServer(options = {}) {
  const config = createHttpConfig(options);
  const bridge = options.bridge || new SketchUpBridge();
  if (typeof bridge.addDslDispatchGuard === 'function') {
    bridge.addDslDispatchGuard((document) => assertAllowedPaths(
      document,
      config.allowedRoots,
      { workspaceRoot: config.workspaceRoot, parseCode: false }
    ));
  }
  const toolInputValidator = options.toolInputValidator || new ToolInputValidator(listToolDefinitions());
  const requestHandler = async (request, response) => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, {
          ok: true,
          name: 'sketchup-mcp-replica',
          version: PRODUCT_VERSION,
          auth_required: true,
          loopback_default: true
        }, requestId);
      }

      if (request.method === 'GET' && url.pathname === '/tools') {
        requireAuthorization(request, config.sessionSecret);
        return sendJson(response, 200, { tools: listToolNames(), count: listToolNames().length }, requestId);
      }

      if (request.method === 'POST' && url.pathname.startsWith('/tools/')) {
        requireAuthorization(request, config.sessionSecret);
        const encodedTool = url.pathname.slice('/tools/'.length);
        let tool;
        try {
          tool = decodeURIComponent(encodedTool);
        } catch {
          throw new HttpBridgeError(404, 'TOOL_NOT_FOUND', 'The requested tool is not registered.');
        }
        if (!tool || encodedTool.includes('/') || tool.includes('/') || !getToolDefinition(tool)) {
          throw new HttpBridgeError(404, 'TOOL_NOT_FOUND', 'The requested tool is not registered.');
        }
        const definition = getToolDefinition(tool);
        const body = await readJson(request, config.maxBodyBytes);
        toolInputValidator.validate(tool, body);
        assertHttpToolPolicy(tool, body);
        await assertAllowedPaths(body, config.allowedRoots, { workspaceRoot: config.workspaceRoot, parseCode: true });
        const args = withBoundedToolTimeout(body || {}, definition, config.toolTimeoutMs);
        const result = await withTimeout(
          withDispatchedTimeoutSemantics(tool, tool === 'compare_snapshots'
            ? Promise.resolve(compareSnapshots(
                normalizeSnapshotArgument(args.expected),
                normalizeSnapshotArgument(args.actual),
                { toleranceMm: args.toleranceMm, budgets: args.budgets, topIssueLimit: args.topIssueLimit }
              ))
            : callTool(tool, args, bridge)),
          config.requestTimeoutMs,
          () => dispatchedTimeoutError(tool)
        );
        const normalized = normalizeHttpToolResult(result, requestId);
        try {
          await assertAllowedPaths(normalized.body, config.allowedRoots, { workspaceRoot: config.workspaceRoot, parseCode: false, output: true });
        } catch (error) {
          if (error?.code === 'OUTPUT_PATH_NOT_ALLOWED' && isPotentiallyEffectfulTool(tool)) {
            throw postDispatchOutputPolicyError();
          }
          throw error;
        }
        return sendJson(response, normalized.statusCode, normalized.body, requestId);
      }

      throw new HttpBridgeError(404, 'NOT_FOUND', 'The requested endpoint was not found.');
    } catch (error) {
      const safe = normalizeHttpError(error);
      sendJson(response, safe.statusCode, {
        error: {
          code: safe.code,
          message: safe.message,
          retryable: safe.retryable,
          next_action: safe.nextAction,
          ...(safe.outcomeUnknown ? { outcome_unknown: true } : {}),
          request_id: requestId
        },
        ...(safe.outcomeUnknown ? { outcome_unknown: true } : {})
      }, requestId);
    }
  };
  const server = http.createServer(requestHandler);

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(config.requestTimeoutMs, 60_000);
  server.keepAliveTimeout = 5_000;
  Object.defineProperty(server, 'almaConfig', { value: config, enumerable: false });
  Object.defineProperty(server, 'almaRequestHandler', { value: requestHandler, enumerable: false });
  return server;
}

export function createHttpConfig(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.env.ALMA_SKETCHUP_WORKSPACE_ROOT || projectRoot);
  const stateDir = path.resolve(options.stateDir || defaultStateDir);
  const configuredRoots = options.allowedRoots || splitRoots(process.env.ALMA_SKETCHUP_HTTP_ALLOWED_ROOTS);
  const allowedRoots = [...new Set([workspaceRoot, stateDir, ...configuredRoots.map((root) => path.resolve(root))])];
  const host = options.host || process.env.ALMA_SKETCHUP_HTTP_HOST || '127.0.0.1';
  const allowNonLoopback = options.allowNonLoopback ?? process.env.ALMA_SKETCHUP_HTTP_ALLOW_NON_LOOPBACK === '1';
  if (!isLoopbackHost(host) && !allowNonLoopback) {
    throw new Error('Non-loopback HTTP binding requires ALMA_SKETCHUP_HTTP_ALLOW_NON_LOOPBACK=1.');
  }
  const sessionSecret = String(options.sessionSecret || process.env.ALMA_SKETCHUP_HTTP_SESSION_SECRET || crypto.randomBytes(32).toString('hex'));
  if (Buffer.byteLength(sessionSecret) < 16) throw new Error('HTTP session secret must be at least 16 bytes.');
  const toolTimeoutMs = positiveInteger(options.toolTimeoutMs ?? process.env.ALMA_SKETCHUP_HTTP_TOOL_TIMEOUT_MS, DEFAULT_TOOL_TIMEOUT_MS);
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? process.env.ALMA_SKETCHUP_HTTP_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
  if (requestTimeoutMs <= toolTimeoutMs) {
    throw new Error('HTTP request timeout must be greater than the maximum tool timeout.');
  }
  return Object.freeze({
    host,
    port: positiveInteger(options.port ?? process.env.PORT, 3977),
    sessionSecret,
    generatedSecret: !options.sessionSecret && !process.env.ALMA_SKETCHUP_HTTP_SESSION_SECRET,
    workspaceRoot,
    stateDir,
    allowedRoots: Object.freeze(allowedRoots),
    maxBodyBytes: positiveInteger(options.maxBodyBytes ?? process.env.ALMA_SKETCHUP_HTTP_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    toolTimeoutMs,
    requestTimeoutMs
  });
}

function normalizeSnapshotArgument(document) {
  if (!document?.snapshot) return document;
  return {
    ...document.snapshot,
    artifact_size_bytes: document.snapshot.artifact_size_bytes ?? document.file_size_bytes
  };
}

function requireAuthorization(request, secret) {
  const provided = String(request.headers.authorization || '');
  const expected = `Bearer ${secret}`;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  const authorized = providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  if (!authorized) throw new HttpBridgeError(401, 'AUTH_REQUIRED', 'A valid local session secret is required.');
}

function assertHttpToolPolicy(tool, args) {
  if (Object.hasOwn(args || {}, 'pythonCommand')) {
    throw new HttpBridgeError(
      403,
      'OPERATION_NOT_ALLOWED',
      'HTTP callers cannot select the Python parser executable.',
      {
        retryable: false,
        nextAction: { action: 'use_server_configured_python_parser', retry: 'after_request_change' }
      }
    );
  }

  const requestsArbitraryRuby = tool === 'run_ruby_expert'
    || (tool === 'evaluate_py' && args?.input_format === 'ruby_expert');
  if (requestsArbitraryRuby) {
    throw new HttpBridgeError(
      403,
      'OPERATION_NOT_ALLOWED',
      'Arbitrary Ruby execution is disabled on the HTTP bridge.',
      {
        retryable: false,
        nextAction: { action: 'use_non_http_trusted_expert_surface', retry: 'do_not_retry' }
      }
    );
  }

  const compilesAndExecutesSource = tool === 'build_expert_model'
    || (tool === 'evaluate_py' && args?.input_format !== 'json_dsl')
    || (tool === 'iterate_model' && typeof args?.code === 'string' && args?.input_format !== 'json_dsl');
  if (!compilesAndExecutesSource) return;
  throw new HttpBridgeError(
    403,
    'OPERATION_NOT_ALLOWED',
    'HTTP source compilation and execution must be split into a compile step followed by inspected JSON DSL execution.',
    {
      retryable: false,
      nextAction: {
        action: 'compile_then_submit_json_dsl',
        retry: 'after_recompile',
        compile_tools: ['compile_expert', 'compile_python_sdk']
      }
    }
  );
}

function readJson(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      request.resume();
      reject(new HttpBridgeError(413, 'BODY_TOO_LARGE', 'The request body exceeds the configured limit.'));
      return;
    }
    const chunks = [];
    let received = 0;
    let settled = false;
    request.on('data', (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > maxBodyBytes) {
        settled = true;
        chunks.length = 0;
        request.resume();
        reject(new HttpBridgeError(413, 'BODY_TOO_LARGE', 'The request body exceeds the configured limit.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpBridgeError(400, 'INVALID_JSON', 'The request body must be valid JSON.'));
      }
    });
    request.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function withBoundedToolTimeout(body, definition, maxTimeoutMs) {
  const properties = definition.inputSchema?.properties || {};
  const bounded = { ...body };
  if (properties.timeoutMs) {
    const requested = Number(body.timeoutMs);
    bounded.timeoutMs = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, maxTimeoutMs)
      : maxTimeoutMs;
  }
  for (const key of ['expertTimeoutMs', 'pythonTimeoutMs']) {
    if (!properties[key] || body[key] === undefined) continue;
    const requested = Number(body[key]);
    bounded[key] = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, maxTimeoutMs)
      : maxTimeoutMs;
  }
  for (const [key, maximum] of Object.entries(HTTP_COMPILER_RESOURCE_LIMITS)) {
    if (!properties[key] || body[key] === undefined) continue;
    const requested = Number(body[key]);
    bounded[key] = Number.isFinite(requested) && requested > 0
      ? Math.min(Math.floor(requested), maximum)
      : maximum;
  }
  return bounded;
}

async function assertAllowedPaths(value, roots, options, key = '', parentKey = '') {
  if (typeof value === 'string') {
    if (options.parseCode && key === 'code') {
      let document;
      try {
        document = JSON.parse(value);
      } catch {
        return;
      }
      await assertAllowedPaths(document, roots, { ...options, parseCode: false }, '', 'code');
      return;
    }
    const artifactValue = parentKey === 'artifacts' && looksLikePath(value);
    const textureMapValue = parentKey === 'textures' && looksLikePath(value);
    const pathKeys = options.output === true ? OUTPUT_FILE_PATH_KEYS : INPUT_FILE_PATH_KEYS;
    if (pathKeys.has(key) || artifactValue || textureMapValue) {
      await assertPathWithinRoots(value, roots, options.workspaceRoot, options.output);
      if (options.output !== true && OUTPUT_DIRECTORY_INPUT_KEYS.has(key)) {
        await assertOutputTreeHasNoSymlinks(value, options.workspaceRoot);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) await assertAllowedPaths(item, roots, options, key, parentKey);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [childKey, childValue] of Object.entries(value)) {
    await assertAllowedPaths(childValue, roots, options, childKey, key);
  }
}

async function assertOutputTreeHasNoSymlinks(value, workspaceRoot) {
  const root = path.resolve(workspaceRoot, value);
  const pending = [root];
  let scanned = 0;
  while (pending.length) {
    const current = pending.pop();
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new HttpBridgeError(403, 'PATH_NOT_ALLOWED', 'The output directory cannot be inspected safely.');
    }
    if (stat.isSymbolicLink()) {
      throw new HttpBridgeError(403, 'PATH_NOT_ALLOWED', 'Output directories containing symbolic links are not accepted over HTTP.');
    }
    if (!stat.isDirectory()) continue;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      throw new HttpBridgeError(403, 'PATH_NOT_ALLOWED', 'The output directory cannot be inspected safely.');
    }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_OUTPUT_SYMLINK_SCAN_ENTRIES) {
        throw new HttpBridgeError(403, 'PATH_NOT_ALLOWED', 'The output directory exceeds the safe symlink inspection budget.');
      }
      if (entry.isSymbolicLink()) {
        throw new HttpBridgeError(403, 'PATH_NOT_ALLOWED', 'Output directories containing symbolic links are not accepted over HTTP.');
      }
      if (entry.isDirectory()) pending.push(path.join(current, entry.name));
    }
  }
}

async function assertPathWithinRoots(value, roots, workspaceRoot, output = false) {
  if (!value || value.startsWith('data:')) return;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new HttpBridgeError(403, output ? 'OUTPUT_PATH_NOT_ALLOWED' : 'PATH_NOT_ALLOWED', 'The path is outside the configured local roots.');
  }
  const candidate = path.resolve(workspaceRoot, value);
  let canonicalCandidate;
  try {
    canonicalCandidate = await canonicalizeCandidate(candidate);
  } catch {
    throw new HttpBridgeError(403, output ? 'OUTPUT_PATH_NOT_ALLOWED' : 'PATH_NOT_ALLOWED', 'The path cannot be resolved safely within the configured local roots.');
  }
  for (const root of roots) {
    let canonicalRoot;
    try {
      canonicalRoot = await canonicalizeCandidate(root);
    } catch {
      continue;
    }
    if (isWithin(canonicalCandidate, canonicalRoot)) return;
  }
  throw new HttpBridgeError(403, output ? 'OUTPUT_PATH_NOT_ALLOWED' : 'PATH_NOT_ALLOWED', 'The path is outside the configured local roots.');
}

async function canonicalizeCandidate(candidate) {
  let cursor = path.resolve(candidate);
  const suffix = [];
  while (true) {
    try {
      const real = await fs.realpath(cursor);
      return path.join(real, ...suffix.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        const entry = await fs.lstat(cursor);
        if (entry.isSymbolicLink()) {
          const symlinkError = new Error('Unresolvable symbolic link in path.');
          symlinkError.code = 'UNRESOLVABLE_SYMLINK';
          throw symlinkError;
        }
      } catch (entryError) {
        if (entryError.code !== 'ENOENT') throw entryError;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(candidate);
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function looksLikePath(value) {
  return path.isAbsolute(value) || value.startsWith('./') || value.startsWith('../') || value.includes(path.sep);
}

function withTimeout(promise, timeoutMs, createTimeoutError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createTimeoutError()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function withDispatchedTimeoutSemantics(tool, promise) {
  try {
    return await promise;
  } catch (error) {
    if (isUnclassifiedTimeout(error)) throw dispatchedTimeoutError(tool);
    throw error;
  }
}

function isUnclassifiedTimeout(error) {
  if (error?.code && ERROR_CODE_REGISTRY[error.code]) return false;
  if (['ETIMEDOUT', 'ERR_OPERATION_TIMEOUT', 'TOOL_TIMEOUT'].includes(error?.code)) return true;
  if (error?.name === 'TimeoutError') return true;
  return /\b(?:timed?\s*out|timeout)\b/i.test(String(error?.message || ''));
}

function isPotentiallyEffectfulTool(tool) {
  return getToolEffect(tool).effect !== 'none';
}

function dispatchedTimeoutError(tool) {
  if (isPotentiallyEffectfulTool(tool)) {
    return new HttpBridgeError(
      500,
      'MUTATION_EXECUTION_FAILED',
      'The HTTP request timed out after dispatch. The operation outcome is unknown and the request must not be retried.',
      {
        retryable: false,
        nextAction: {
          ...ERROR_CODE_REGISTRY.MUTATION_EXECUTION_FAILED.next_action,
          retry: 'do_not_retry'
        },
        outcomeUnknown: true
      }
    );
  }
  return new HttpBridgeError(
    504,
    'TOOL_TIMEOUT',
    'The read-only tool did not finish within the configured timeout.',
    { retryable: false, nextAction: { action: 'inspect_service_before_retry', retry: 'manual_only' } }
  );
}

function postDispatchOutputPolicyError() {
  return new HttpBridgeError(
    500,
    'MUTATION_EXECUTION_FAILED',
    'The dispatched operation completed with an unsafe output path. Its observable outcome is incomplete and the request must not be retried.',
    {
      retryable: false,
      nextAction: {
        ...ERROR_CODE_REGISTRY.MUTATION_EXECUTION_FAILED.next_action,
        retry: 'do_not_retry'
      },
      outcomeUnknown: true
    }
  );
}

function normalizeHttpError(error) {
  if (error instanceof HttpBridgeError) return error;
  if (ERROR_CODE_REGISTRY[error?.code]) {
    const definition = ERROR_CODE_REGISTRY[error.code];
    return new HttpBridgeError(
      httpStatusForAgentError(error.code),
      error.code,
      publicMessageForAgentError(error.code),
      {
        retryable: error.retryable ?? definition.retryable,
        nextAction: sanitizeHttpNextAction(error.next_action, definition.next_action),
        outcomeUnknown: error.details?.outcome_unknown === true
      }
    );
  }
  return new HttpBridgeError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
}

function normalizeHttpToolResult(result, requestId) {
  if (result?.kind !== 'agent_result_envelope' || result.ok !== false || !result.error) {
    return { statusCode: 200, body: result };
  }
  const safe = normalizeHttpError(result.error);
  const nextAction = sanitizeHttpNextAction(result.next_action, safe.nextAction);
  return {
    statusCode: safe.statusCode,
    body: {
      ...result,
      retryable: safe.retryable,
      next_action: nextAction,
      error: {
        code: safe.code,
        message: safe.message,
        retryable: safe.retryable,
        next_action: nextAction,
        ...(safe.outcomeUnknown ? { outcome_unknown: true } : {}),
        request_id: requestId
      },
      ...(safe.outcomeUnknown ? { outcome_unknown: true } : {})
    }
  };
}

function sanitizeHttpNextAction(value, fallback = null) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : (fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : null);
  if (!source) return null;
  const result = {};
  for (const key of ['action', 'retry', 'tool', 'then_tool', 'task_id', 'challenge_id', 'reason', 'source_visual_correction']) {
    if (typeof source[key] === 'string') result[key] = source[key];
  }
  for (const key of ['offset', 'max_chars']) {
    if (Number.isSafeInteger(source[key]) && source[key] >= 0) result[key] = source[key];
  }
  for (const key of ['required', 'compile_tools']) {
    if (Array.isArray(source[key])) result[key] = source[key].filter((item) => typeof item === 'string').slice(0, 100);
  }
  const challenge = sanitizeHttpApprovalChallenge(source.challenge);
  if (challenge) result.challenge = challenge;
  const approvalHost = sanitizeHttpApprovalHost(source.approval_host);
  if (approvalHost) result.approval_host = approvalHost;
  return Object.keys(result).length ? result : sanitizeHttpNextAction(fallback, null);
}

function sanitizeHttpApprovalChallenge(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of [
    'challenge_id', 'task_id', 'plan_id', 'plan_hash', 'model_revision', 'risk_level',
    'review_context_hash', 'expires_at', 'status'
  ]) {
    if (typeof value[key] === 'string') result[key] = value[key];
  }
  if (Array.isArray(value.allowed_operations)) {
    result.allowed_operations = value.allowed_operations.filter((item) => typeof item === 'string').slice(0, 100);
  }
  return Object.keys(result).length ? result : null;
}

function sanitizeHttpApprovalHost(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  if (typeof value.version === 'string') result.version = value.version;
  if (typeof value.challenge_id === 'string') result.challenge_id = value.challenge_id;
  if (value.user_presence_required === true) result.user_presence_required = true;
  if (value.approval_token_exposed_to_agent === false) result.approval_token_exposed_to_agent = false;
  if (typeof value.url === 'string') {
    try {
      const url = new URL(value.url);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      if (['http:', 'https:'].includes(url.protocol) && isLoopbackHost(hostname) && !url.username && !url.password) {
        result.url = url.toString();
      }
    } catch {
      // Invalid or non-local approval URLs are intentionally omitted.
    }
  }
  return result.url ? result : null;
}

function httpStatusForAgentError(code) {
  if (['TASK_NOT_FOUND', 'ARTIFACT_NOT_FOUND', 'MODEL_GRAPH_NOT_FOUND'].includes(code)) return 404;
  if (code === 'HANDSHAKE_REQUIRED') return 428;
  if (['APPROVAL_REQUIRED', 'APPROVAL_INVALID', 'OPERATION_NOT_ALLOWED', 'POLICY_DENIED'].includes(code)) return 403;
  if (['QUEUE_LOCK_PRESENT', 'QUEUE_STALE_LOCK'].includes(code)) return 423;
  if (code === 'INVALID_ARGUMENT') return 400;
  if (['INTERNAL_ERROR', 'MUTATION_EXECUTION_FAILED', 'MUTATION_RECEIPT_INVALID', 'ARTIFACT_INTEGRITY_ERROR', 'MODEL_GRAPH_INTEGRITY_ERROR'].includes(code)) return 500;
  return 409;
}

function publicMessageForAgentError(code) {
  if (code === 'POLICY_DENIED') return 'The server execution policy does not allow this operation.';
  if (code === 'HANDSHAKE_REQUIRED') return 'A fresh live Session Contract is required before this operation.';
  if (code.startsWith('HANDSHAKE_')) return 'The live Session Contract is no longer valid for the current SketchUp state.';
  if (code.startsWith('QUEUE_')) return 'The live queue is not ready for this operation.';
  if (code.startsWith('APPROVAL_')) return 'A valid trusted user approval is required for this operation.';
  if (code === 'MODEL_IDENTITY_MISMATCH') return 'The reviewed task is bound to a different model identity.';
  if (code === 'MODEL_REVISION_MISMATCH' || code === 'PLAN_HASH_MISMATCH') return 'The reviewed plan no longer matches the current model state.';
  if (code === 'MODEL_REVISION_INCOMPLETE') return 'The model does not have a complete revision binding for safe editing.';
  if (code === 'TASK_NOT_FOUND') return 'The requested task does not exist.';
  if (code === 'ARTIFACT_NOT_FOUND') return 'The requested artifact does not exist.';
  if (code === 'ARTIFACT_INTEGRITY_ERROR') return 'The persisted artifact failed an integrity check and must be re-ingested.';
  if (code === 'MODEL_GRAPH_NOT_FOUND') return 'The requested persisted ModelGraph does not exist.';
  if (code === 'MODEL_IDENTITY_UNAVAILABLE') return 'A stable model identity is required before this task can continue.';
  if (code === 'MODEL_GRAPH_INTEGRITY_ERROR') return 'The persisted ModelGraph failed an integrity check and must be rebuilt.';
  if (code === 'INVALID_ARGUMENT') return 'The request contains an invalid argument.';
  if (code === 'OPERATION_NOT_ALLOWED') return 'The requested operation is outside the approved scope.';
  if (code === 'MUTATION_RECOVERY_REQUIRED') return 'The model commit is recorded, but server-only finalization must be resumed before new work continues.';
  if (code === 'MUTATION_RECEIPT_INVALID') return 'The server mutation receipt failed an integrity or binding check. Inspect the active model and report the corrupted state.';
  if (code === 'MUTATION_EXECUTION_FAILED') return 'Execution may have changed the model before it failed. Inspect the active model before starting a new task.';
  if (code === 'INTERNAL_ERROR') return 'The request could not be completed.';
  return 'The request conflicts with the current task or model state.';
}

function sendJson(response, statusCode, body, requestId) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function splitRoots(value) {
  return String(value || '').split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isLoopbackHost(host) {
  const normalized = String(host || '').toLowerCase();
  if (normalized === 'localhost') return true;
  if (isIP(normalized) === 4) return normalized.split('.')[0] === '127';
  if (isIP(normalized) === 6) return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
  return false;
}

class HttpBridgeError extends Error {
  constructor(statusCode, code, message, { retryable = false, nextAction = null, outcomeUnknown = false } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable === true;
    this.nextAction = nextAction;
    this.outcomeUnknown = outcomeUnknown === true;
  }
}

async function main() {
  const server = createHttpServer();
  const config = server.almaConfig;
  server.listen(config.port, config.host, () => {
    process.stderr.write(`SketchUp MCP replica HTTP bridge listening on http://${config.host}:${config.port}\n`);
    process.stderr.write(`HTTP auth: Bearer session secret ${config.generatedSecret ? `(generated) ${config.sessionSecret}` : 'loaded from ALMA_SKETCHUP_HTTP_SESSION_SECRET'}\n`);
    process.stderr.write(`HTTP limits: body=${config.maxBodyBytes} bytes, tool timeout=${config.toolTimeoutMs}ms\n`);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
