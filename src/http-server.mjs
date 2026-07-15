#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge, callTool } from './bridge.mjs';
import { defaultStateDir, projectRoot } from './paths.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { getToolDefinition, listToolNames } from './tool-registry.mjs';
import { PRODUCT_VERSION } from './version.mjs';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 65_000;
const FILE_PATH_KEYS = new Set([
  'path', 'input_dir', 'output_dir', 'asset_set_path', 'observations_path', 'candidate_graph_path',
  'modeling_brief_path', 'promotion_review_path', 'source_package_path', 'output_json', 'output_markdown',
  'mcp_brief_path', 'part_graph_path', 'profile_path', 'output_dsl', 'plan_file', 'review_file', 'save_path',
  'base_path', 'audit_path', 'intent_file', 'file_path', 'input_path', 'output_path', 'texture'
]);

export function createHttpServer(options = {}) {
  const config = createHttpConfig(options);
  const bridge = options.bridge || new SketchUpBridge();
  const server = http.createServer(async (request, response) => {
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
        return sendJson(response, 200, { tools: listToolNames(), count: listToolNames().length }, requestId);
      }

      if (request.method === 'POST' && url.pathname.startsWith('/tools/')) {
        requireAuthorization(request, config.sessionSecret);
        const tool = decodeURIComponent(url.pathname.slice('/tools/'.length));
        const definition = getToolDefinition(tool);
        if (!definition || !tool || tool.includes('/')) {
          throw new HttpBridgeError(404, 'TOOL_NOT_FOUND', 'The requested tool is not available.');
        }
        const body = await readJson(request, config.maxBodyBytes);
        await assertAllowedPaths(body, config.allowedRoots, { workspaceRoot: config.workspaceRoot, parseCode: true });
        const args = withBoundedToolTimeout(body || {}, definition, config.toolTimeoutMs);
        const result = await withTimeout(
          tool === 'compare_snapshots'
            ? Promise.resolve(compareSnapshots(
                normalizeSnapshotArgument(args.expected),
                normalizeSnapshotArgument(args.actual),
                { toleranceMm: args.toleranceMm, budgets: args.budgets, topIssueLimit: args.topIssueLimit }
              ))
            : callTool(tool, args, bridge),
          config.requestTimeoutMs
        );
        await assertAllowedPaths(result, config.allowedRoots, { workspaceRoot: config.workspaceRoot, parseCode: false, output: true });
        return sendJson(response, 200, result, requestId);
      }

      throw new HttpBridgeError(404, 'NOT_FOUND', 'The requested endpoint was not found.');
    } catch (error) {
      const safe = normalizeHttpError(error);
      sendJson(response, safe.statusCode, {
        error: { code: safe.code, message: safe.message, request_id: requestId }
      }, requestId);
    }
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(config.requestTimeoutMs, 60_000);
  server.keepAliveTimeout = 5_000;
  Object.defineProperty(server, 'almaConfig', { value: config, enumerable: false });
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
  return Object.freeze({
    host,
    port: positiveInteger(options.port ?? process.env.PORT, 3977),
    sessionSecret,
    generatedSecret: !options.sessionSecret && !process.env.ALMA_SKETCHUP_HTTP_SESSION_SECRET,
    workspaceRoot,
    stateDir,
    allowedRoots: Object.freeze(allowedRoots),
    maxBodyBytes: positiveInteger(options.maxBodyBytes ?? process.env.ALMA_SKETCHUP_HTTP_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    toolTimeoutMs: positiveInteger(options.toolTimeoutMs ?? process.env.ALMA_SKETCHUP_HTTP_TOOL_TIMEOUT_MS, DEFAULT_TOOL_TIMEOUT_MS),
    requestTimeoutMs: positiveInteger(options.requestTimeoutMs ?? process.env.ALMA_SKETCHUP_HTTP_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS)
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
  if (!definition.inputSchema?.properties?.timeoutMs) return body;
  const requested = Number(body.timeoutMs);
  return {
    ...body,
    timeoutMs: Number.isFinite(requested) && requested > 0 ? Math.min(requested, maxTimeoutMs) : maxTimeoutMs
  };
}

async function assertAllowedPaths(value, roots, options, key = '', parentKey = '') {
  if (typeof value === 'string') {
    if (options.parseCode && key === 'code') {
      try {
        const document = JSON.parse(value);
        await assertAllowedPaths(document, roots, { ...options, parseCode: false }, '', 'code');
      } catch (error) {
        if (error instanceof HttpBridgeError) throw error;
      }
      return;
    }
    const artifactValue = parentKey === 'artifacts' && looksLikePath(value);
    const textureMapValue = parentKey === 'textures' && looksLikePath(value);
    if (FILE_PATH_KEYS.has(key) || artifactValue || textureMapValue) {
      await assertPathWithinRoots(value, roots, options.workspaceRoot, options.output);
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

async function assertPathWithinRoots(value, roots, workspaceRoot, output = false) {
  if (!value || value.startsWith('data:')) return;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    throw new HttpBridgeError(403, output ? 'OUTPUT_PATH_NOT_ALLOWED' : 'PATH_NOT_ALLOWED', 'The path is outside the configured local roots.');
  }
  const candidate = path.resolve(workspaceRoot, value);
  const canonicalCandidate = await canonicalizeCandidate(candidate);
  for (const root of roots) {
    const canonicalRoot = await canonicalizeCandidate(root);
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

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HttpBridgeError(504, 'TOOL_TIMEOUT', 'The tool did not finish within the configured timeout.')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeHttpError(error) {
  if (error instanceof HttpBridgeError) return error;
  return new HttpBridgeError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
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
  return host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

class HttpBridgeError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
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
