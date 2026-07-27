#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { isIP } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AgentContractError } from './agent-contract.mjs';
import { ApprovalAuthority } from './approval-tokens.mjs';
import { defaultStateDir } from './paths.mjs';

export const LOCAL_APPROVAL_HOST_VERSION = 'local-approval-host.v1';

const DEFAULT_PORT = 3978;
const DEFAULT_MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_WINDOW_MS = 60 * 1000;
const DEFAULT_AUTH_LOCK_MS = 30 * 1000;
const DEFAULT_MAX_AUTH_FAILURES = 5;
const DEFAULT_BOOTSTRAP_SECRET_BYTES = 32;
const BOOTSTRAP_SECRET_ENV = 'LOCAL_MCP_FOR_SKETCHUP_APPROVAL_BOOTSTRAP_SECRET';
const SESSION_COOKIE = 'local_mcp_for_sketchup_approval_session';
const PREAUTH_COOKIE = 'local_mcp_for_sketchup_approval_preauth';
const scryptAsync = promisify(crypto.scrypt);

export function createLocalApprovalHost(options = {}) {
  const config = createLocalApprovalHostConfig(options);
  const bootstrapSecret = createBootstrapSecretState(
    Object.hasOwn(options, 'bootstrapSecret') ? options.bootstrapSecret : process.env[BOOTSTRAP_SECRET_ENV]
  );
  const authority = options.approvalAuthority || new ApprovalAuthority({
    stateDir: config.approvalStateDir,
    approvalHostUrl: `http://${formatHost(config.host)}:${config.port}`
  });
  const sessions = new Map();
  const preauthSessions = new Map();
  const authFailures = new Map();

  const server = http.createServer(async (request, response) => {
    try {
      requireLoopbackPeer(request);
      requireExpectedHost(request, server, config);
      const url = new URL(request.url || '/', currentOrigin(server, config));

      if (request.method === 'GET' && url.pathname === '/health') {
        const initialized = await credentialExists(config.credentialPath);
        return sendJson(response, 200, {
          ok: true,
          kind: 'local_approval_host_status',
          version: LOCAL_APPROVAL_HOST_VERSION,
          initialized,
          loopback_only: true,
          auth_required: true,
          setup_bootstrap_required: !initialized,
          setup_bootstrap_configured: initialized || bootstrapSecret !== null,
          approval_tokens_exposed: false
        });
      }
      if (request.method === 'GET' && url.pathname === '/approval.css') {
        return sendCss(response, APPROVAL_CSS);
      }

      const initialized = await credentialExists(config.credentialPath);
      if (!initialized) {
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/setup')) {
          requireBootstrapSecretConfigured(bootstrapSecret);
          const preauth = createPreauthSession(preauthSessions, config);
          return sendHtml(response, 200, setupPage(preauth.csrf), [preauthCookie(preauth.token, config)]);
        }
        if (request.method === 'POST' && url.pathname === '/setup') {
          requireSameOrigin(request, server, config);
          const preauth = requirePreauthSession(request, preauthSessions);
          const form = await readForm(request, config.maxBodyBytes);
          requireCsrf(form, preauth);
          requireBootstrapSecret(form.bootstrap_secret, bootstrapSecret);
          if (form.passphrase !== form.confirm_passphrase) {
            throw new LocalApprovalHttpError(400, 'PASSPHRASE_MISMATCH', 'The passphrase confirmation does not match.');
          }
          await createCredential(config.credentialPath, form.passphrase, { userId: form.user_id || 'local-user' });
          consumeBootstrapSecret(bootstrapSecret);
          preauthSessions.delete(preauth.key);
          const session = createAuthenticatedSession(sessions, config, form.user_id || 'local-user');
          return redirect(response, '/', [sessionCookie(session.token, config), clearCookie(PREAUTH_COOKIE)]);
        }
        throw new LocalApprovalHttpError(409, 'SETUP_REQUIRED', 'The local approval host must be initialized in a browser first.');
      }

      if (request.method === 'POST' && url.pathname === '/login') {
        requireSameOrigin(request, server, config);
        const preauth = requirePreauthSession(request, preauthSessions);
        const form = await readForm(request, config.maxBodyBytes);
        requireCsrf(form, preauth);
        const peer = peerKey(request);
        assertAuthRateLimit(peer, authFailures, config);
        if (!await verifyCredential(config.credentialPath, form.passphrase)) {
          registerAuthFailure(peer, authFailures, config);
          return sendHtml(response, 401, loginPage(preauth.csrf, '口令不正确。'), [preauthCookie(preauth.token, config)]);
        }
        authFailures.delete(peer);
        preauthSessions.delete(preauth.key);
        const credential = await readCredential(config.credentialPath);
        const session = createAuthenticatedSession(sessions, config, credential.user_id);
        return redirect(response, '/', [sessionCookie(session.token, config), clearCookie(PREAUTH_COOKIE)]);
      }

      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
        const session = readAuthenticatedSession(request, sessions);
        if (!session) {
          const preauth = createPreauthSession(preauthSessions, config);
          return sendHtml(response, 200, loginPage(preauth.csrf), [preauthCookie(preauth.token, config)]);
        }
        const challenges = await authority.listChallenges({ includeExpired: true, limit: 100 });
        return sendHtml(response, 200, challengeListPage(challenges, session.csrf));
      }

      if (request.method === 'POST' && url.pathname === '/logout') {
        requireSameOrigin(request, server, config);
        const session = requireAuthenticatedSession(request, sessions);
        const form = await readForm(request, config.maxBodyBytes);
        requireCsrf(form, session);
        sessions.delete(session.key);
        return redirect(response, '/login', [clearCookie(SESSION_COOKIE)]);
      }

      const approvalMatch = url.pathname.match(/^\/approvals\/(approval_[0-9a-f-]+)$/i);
      const decisionMatch = url.pathname.match(/^\/approvals\/(approval_[0-9a-f-]+)\/(approve|reject)$/i);
      if (request.method === 'GET' && approvalMatch) {
        const session = requireAuthenticatedSession(request, sessions);
        const challenge = await authority.readChallenge(approvalMatch[1]);
        const decision = await authority.readDecisionForDisplay(challenge.challenge_id, { allowMissing: true });
        return sendHtml(response, 200, challengeDetailPage(challenge, decision, session.csrf));
      }
      if (request.method === 'POST' && decisionMatch) {
        requireSameOrigin(request, server, config);
        const session = requireAuthenticatedSession(request, sessions);
        const form = await readForm(request, config.maxBodyBytes);
        requireCsrf(form, session);
        if (form.acknowledge !== 'yes') {
          throw new LocalApprovalHttpError(400, 'ACKNOWLEDGEMENT_REQUIRED', 'You must explicitly acknowledge the bound plan before deciding.');
        }
        const peer = peerKey(request);
        assertAuthRateLimit(peer, authFailures, config);
        if (!await verifyCredential(config.credentialPath, form.passphrase)) {
          registerAuthFailure(peer, authFailures, config);
          throw new LocalApprovalHttpError(401, 'AUTH_FAILED', 'The approval passphrase is incorrect.');
        }
        authFailures.delete(peer);
        await authority.recordTrustedDecision(decisionMatch[1], {
          decision: decisionMatch[2] === 'approve' ? 'approved' : 'rejected',
          user_id: session.userId,
          channel: LOCAL_APPROVAL_HOST_VERSION,
          confirmed: true,
          reason: form.reason,
          selection: form.review_selection
        });
        return redirect(response, `/approvals/${encodeURIComponent(decisionMatch[1])}`);
      }

      throw new LocalApprovalHttpError(404, 'NOT_FOUND', 'The requested approval page was not found.');
    } catch (error) {
      const normalized = normalizeHostError(error);
      if (request.headers.accept?.includes('application/json')) {
        return sendJson(response, normalized.statusCode, { error: { code: normalized.code, message: normalized.message } });
      }
      return sendHtml(response, normalized.statusCode, errorPage(normalized.code, normalized.message));
    }
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(config.requestTimeoutMs, 30_000);
  server.keepAliveTimeout = 5_000;
  Object.defineProperty(server, 'localMcpConfig', { value: config, enumerable: false });
  Object.defineProperty(server, 'approvalAuthority', { value: authority, enumerable: false });
  return server;
}

export function createLocalApprovalHostConfig(options = {}) {
  const host = String(options.host || process.env.LOCAL_MCP_FOR_SKETCHUP_APPROVAL_HOST_BIND || '127.0.0.1');
  if (!isLoopbackHost(host)) throw new Error('The local approval host may only bind to a loopback address.');
  const approvalStateDir = path.resolve(options.approvalStateDir || path.join(defaultStateDir, 'agent-contract-v1', 'approvals'));
  const credentialPath = path.resolve(options.credentialPath || path.join(approvalStateDir, 'local-host', 'credential.v1.json'));
  return Object.freeze({
    host,
    port: positiveInteger(options.port ?? process.env.LOCAL_MCP_FOR_SKETCHUP_APPROVAL_HOST_PORT, DEFAULT_PORT),
    approvalStateDir,
    credentialPath,
    maxBodyBytes: positiveInteger(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES),
    sessionTtlMs: boundedMilliseconds(options.sessionTtlMs, DEFAULT_SESSION_TTL_MS, 60_000, 60 * 60 * 1000),
    authWindowMs: boundedMilliseconds(options.authWindowMs, DEFAULT_AUTH_WINDOW_MS, 1_000, 10 * 60 * 1000),
    authLockMs: boundedMilliseconds(options.authLockMs, DEFAULT_AUTH_LOCK_MS, 1_000, 10 * 60 * 1000),
    maxAuthFailures: positiveInteger(options.maxAuthFailures, DEFAULT_MAX_AUTH_FAILURES),
    requestTimeoutMs: boundedMilliseconds(options.requestTimeoutMs, 30_000, 1_000, 120_000)
  });
}

export function generateLocalApprovalBootstrapSecret() {
  return crypto.randomBytes(DEFAULT_BOOTSTRAP_SECRET_BYTES).toString('base64url');
}

function createBootstrapSecretState(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value);
  const byteLength = Buffer.byteLength(normalized);
  if (byteLength < DEFAULT_BOOTSTRAP_SECRET_BYTES || byteLength > 256) {
    throw new Error('The local approval bootstrap secret must be between 32 and 256 bytes.');
  }
  return {
    digest: crypto.createHash('sha256').update(normalized).digest(),
    consumed: false
  };
}

function requireBootstrapSecretConfigured(state) {
  if (!state) {
    throw new LocalApprovalHttpError(
      503,
      'BOOTSTRAP_SECRET_REQUIRED',
      `First-time setup requires a one-time bootstrap secret generated at host startup or configured through ${BOOTSTRAP_SECRET_ENV}.`
    );
  }
  if (state.consumed || !state.digest) {
    throw new LocalApprovalHttpError(409, 'BOOTSTRAP_SECRET_CONSUMED', 'The one-time setup bootstrap secret has already been consumed.');
  }
}

function requireBootstrapSecret(value, state) {
  requireBootstrapSecretConfigured(state);
  const supplied = typeof value === 'string' && Buffer.byteLength(value) <= 256
    ? crypto.createHash('sha256').update(value).digest()
    : Buffer.alloc(32);
  if (!crypto.timingSafeEqual(supplied, state.digest)) {
    throw new LocalApprovalHttpError(403, 'BOOTSTRAP_SECRET_INVALID', 'The one-time setup bootstrap secret is invalid.');
  }
}

function consumeBootstrapSecret(state) {
  requireBootstrapSecretConfigured(state);
  state.digest.fill(0);
  state.digest = null;
  state.consumed = true;
}

async function credentialExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function createCredential(filePath, passphrase, { userId } = {}) {
  validatePassphrase(passphrase);
  const salt = crypto.randomBytes(24);
  const params = { N: 16384, r: 8, p: 1, keylen: 32 };
  const derived = await derivePassphrase(passphrase, salt, params);
  const credential = {
    version: 'local-approval-credential.v1',
    kind: 'local_approval_credential',
    user_id: normalizeUserId(userId),
    algorithm: 'scrypt',
    salt: salt.toString('base64url'),
    hash: derived.toString('base64url'),
    params,
    created_at: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const handle = await fs.open(filePath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(credential, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === 'EEXIST') throw new LocalApprovalHttpError(409, 'ALREADY_INITIALIZED', 'The local approval host is already initialized.');
    throw error;
  }
  return credential;
}

async function readCredential(filePath) {
  const credential = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (credential?.version !== 'local-approval-credential.v1' || credential?.algorithm !== 'scrypt') {
    throw new LocalApprovalHttpError(500, 'CREDENTIAL_INVALID', 'The local approval credential is invalid.');
  }
  return credential;
}

async function verifyCredential(filePath, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length > 256) return false;
  const credential = await readCredential(filePath);
  const salt = Buffer.from(credential.salt, 'base64url');
  const expected = Buffer.from(credential.hash, 'base64url');
  const derived = await derivePassphrase(passphrase, salt, credential.params);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

async function derivePassphrase(passphrase, salt, params) {
  return scryptAsync(passphrase, salt, Number(params.keylen), {
    N: Number(params.N),
    r: Number(params.r),
    p: Number(params.p),
    maxmem: 64 * 1024 * 1024
  });
}

function validatePassphrase(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) {
    throw new LocalApprovalHttpError(400, 'PASSPHRASE_POLICY', 'Use an approval passphrase between 12 and 256 characters.');
  }
}

function normalizeUserId(value) {
  const normalized = String(value || 'local-user').trim();
  if (!/^[a-z0-9._-]{1,64}$/i.test(normalized)) {
    throw new LocalApprovalHttpError(400, 'USER_ID_INVALID', 'The local user id may contain only letters, numbers, dot, underscore, and dash.');
  }
  return normalized;
}

function createPreauthSession(store, config) {
  pruneSessions(store);
  const token = crypto.randomBytes(32).toString('base64url');
  const key = tokenHash(token);
  const session = { key, token, csrf: crypto.randomBytes(24).toString('base64url'), expiresAt: Date.now() + Math.min(config.sessionTtlMs, 10 * 60 * 1000) };
  store.set(key, session);
  return session;
}

function createAuthenticatedSession(store, config, userId) {
  pruneSessions(store);
  const token = crypto.randomBytes(32).toString('base64url');
  const key = tokenHash(token);
  const session = { key, token, csrf: crypto.randomBytes(24).toString('base64url'), userId: normalizeUserId(userId), expiresAt: Date.now() + config.sessionTtlMs };
  store.set(key, session);
  return session;
}

function requirePreauthSession(request, store) {
  const token = parseCookies(request.headers.cookie || '')[PREAUTH_COOKIE];
  const session = token ? store.get(tokenHash(token)) : null;
  if (!session || session.expiresAt <= Date.now()) throw new LocalApprovalHttpError(403, 'CSRF_INVALID', 'The browser setup or login session expired.');
  return session;
}

function readAuthenticatedSession(request, store) {
  const token = parseCookies(request.headers.cookie || '')[SESSION_COOKIE];
  const session = token ? store.get(tokenHash(token)) : null;
  if (!session || session.expiresAt <= Date.now()) return null;
  return session;
}

function requireAuthenticatedSession(request, store) {
  const session = readAuthenticatedSession(request, store);
  if (!session) throw new LocalApprovalHttpError(401, 'AUTH_REQUIRED', 'Open the local approval page and authenticate first.');
  return session;
}

function pruneSessions(store) {
  for (const [key, session] of store) if (session.expiresAt <= Date.now()) store.delete(key);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function requireCsrf(form, session) {
  const supplied = Buffer.from(String(form.csrf || ''));
  const expected = Buffer.from(String(session.csrf || ''));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new LocalApprovalHttpError(403, 'CSRF_INVALID', 'The browser approval form is no longer valid.');
  }
}

function requireSameOrigin(request, server, config) {
  const expected = currentOrigin(server, config);
  const origin = String(request.headers.origin || '');
  const fetchSite = String(request.headers['sec-fetch-site'] || '');
  const compatibleOpaqueOrigin = origin === 'null' && fetchSite === 'same-origin';
  if (origin !== expected && !compatibleOpaqueOrigin) {
    throw new LocalApprovalHttpError(403, 'ORIGIN_INVALID', 'Cross-origin approval requests are not allowed.');
  }
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
    throw new LocalApprovalHttpError(403, 'ORIGIN_INVALID', 'Cross-site approval requests are not allowed.');
  }
}

function requireExpectedHost(request, server, config) {
  if (String(request.headers.host || '') !== currentAuthority(server, config)) {
    throw new LocalApprovalHttpError(421, 'HOST_INVALID', 'The local approval host header is invalid.');
  }
}

function requireLoopbackPeer(request) {
  const peer = String(request.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!isLoopbackHost(peer)) throw new LocalApprovalHttpError(403, 'LOOPBACK_REQUIRED', 'The approval page only accepts loopback clients.');
}

function peerKey(request) {
  return String(request.socket.remoteAddress || 'unknown');
}

function assertAuthRateLimit(peer, failures, config) {
  const entry = failures.get(peer);
  if (!entry) return;
  if (entry.lockedUntil > Date.now()) throw new LocalApprovalHttpError(429, 'AUTH_RATE_LIMITED', 'Too many failed authentication attempts. Try again shortly.');
  if (entry.windowStarted + config.authWindowMs <= Date.now()) failures.delete(peer);
}

function registerAuthFailure(peer, failures, config) {
  const now = Date.now();
  const current = failures.get(peer);
  const entry = !current || current.windowStarted + config.authWindowMs <= now
    ? { count: 0, windowStarted: now, lockedUntil: 0 }
    : current;
  entry.count += 1;
  if (entry.count >= config.maxAuthFailures) entry.lockedUntil = now + config.authLockMs;
  failures.set(peer, entry);
}

function readForm(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      reject(new LocalApprovalHttpError(415, 'CONTENT_TYPE_INVALID', 'Approval forms must use application/x-www-form-urlencoded.'));
      return;
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      request.resume();
      reject(new LocalApprovalHttpError(413, 'BODY_TOO_LARGE', 'The approval form is too large.'));
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
        reject(new LocalApprovalHttpError(413, 'BODY_TOO_LARGE', 'The approval form is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
      resolve(form);
    });
    request.on('error', reject);
  });
}

function parseCookies(value) {
  const cookies = {};
  for (const part of String(value || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    try { cookies[key] = decodeURIComponent(raw); } catch { /* ignore malformed cookie */ }
  }
  return cookies;
}

function preauthCookie(token, config) {
  return `${PREAUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(Math.min(config.sessionTtlMs, 600000) / 1000)}`;
}

function sessionCookie(token, config) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`;
}

function clearCookie(name) {
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

function challengeListPage(challenges, csrf) {
  const pending = challenges.filter((entry) => !entry.expired && entry.status === 'awaiting_trusted_user' && !entry.decision);
  const decided = challenges.filter((entry) => entry.decision || entry.expired || entry.status !== 'awaiting_trusted_user');
  return layout('本机审批中心', `
    <header class="hero"><p class="eyebrow">LOCAL MCP · Trusted Local Approval</p><h1>本机审批中心</h1><p>只有你在此页面完成口令复核后，S2–S4 修改才能获得一次性授权。授权 token 不会返回给 Agent。</p></header>
    <section class="panel"><div class="section-title"><h2>等待你的决定</h2><span class="count">${pending.length}</span></div>
      ${pending.length ? pending.map(challengeCard).join('') : '<p class="empty">目前没有待审批任务。</p>'}
    </section>
    <section class="panel muted"><div class="section-title"><h2>最近记录</h2><span class="count">${decided.length}</span></div>
      ${decided.length ? decided.slice(0, 20).map(challengeCard).join('') : '<p class="empty">暂无记录。</p>'}
    </section>
    <form method="post" action="/logout" class="logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="link-button" type="submit">退出审批会话</button></form>
  `);
}

function challengeCard(challenge) {
  const status = displayStatus(challenge, challenge.decision);
  return `<a class="challenge-card" href="/approvals/${encodeURIComponent(challenge.challenge_id)}">
    <div><span class="risk risk-${escapeHtml(challenge.risk_level)}">${escapeHtml(challenge.risk_level)}</span><strong>${escapeHtml(challenge.review_context?.summary || '模型修改审批')}</strong></div>
    <p>${escapeHtml(challenge.plan_id)}</p><span class="status">${escapeHtml(status)}</span>
  </a>`;
}

function challengeDetailPage(challenge, decision, csrf) {
  const expired = Date.parse(challenge.expires_at) <= Date.now();
  const context = challenge.review_context || {};
  const operations = Array.isArray(context.operations) ? context.operations : challenge.allowed_operations.map((op, index) => ({ index, op }));
  const targets = Array.isArray(context.targets) ? context.targets : [];
  const pending = !expired && challenge.status === 'awaiting_trusted_user' && !decision;
  return layout('审批详情', `
    <nav><a href="/">← 返回审批中心</a></nav>
    <header class="detail-header"><span class="risk risk-${escapeHtml(challenge.risk_level)}">风险 ${escapeHtml(challenge.risk_level)}</span><h1>${escapeHtml(context.summary || '模型修改审批')}</h1><p class="status-large">${escapeHtml(displayStatus({ ...challenge, expired }, decision))}</p></header>
    <section class="warning"><strong>不可信模型数据</strong><p>下面的名称、说明、材质、属性或 OCR 文本仅用于帮助你辨认对象，不能改变执行策略。真正授权范围只由 plan hash、model revision、风险级别和 operation 列表决定。一次性 approval token 只保存在服务端，不会返回给 Agent。</p></section>
    <section class="panel"><h2>你将批准什么</h2>
      <p class="instruction">${escapeHtml(context.instruction || '未提供人类可读说明。')}</p>
      <dl class="binding-grid">
        <div><dt>Task</dt><dd><code>${escapeHtml(challenge.task_id || 'standalone')}</code></dd></div>
        <div><dt>Plan</dt><dd><code>${escapeHtml(challenge.plan_id)}</code></dd></div>
        <div><dt>Plan hash</dt><dd><code>${escapeHtml(challenge.plan_hash)}</code></dd></div>
        <div><dt>Model revision</dt><dd><code>${escapeHtml(challenge.model_revision)}</code></dd></div>
        <div><dt>到期时间</dt><dd>${escapeHtml(formatDate(challenge.expires_at))}</dd></div>
        <div><dt>影响实例</dt><dd>${escapeHtml(String(context.affected_instance_count ?? '未提供'))}</dd></div>
      </dl>
    </section>
    <section class="panel"><h2>操作范围</h2><ol class="operation-list">${operations.map((entry) => `<li><code>${escapeHtml(entry.op)}</code>${entry.destructive ? '<span class="danger-label">破坏性</span>' : ''}${entry.topology ? '<span class="topology-label">拓扑</span>' : ''}${operationBindingDetails(entry)}</li>`).join('')}</ol></section>
    ${geometryValidationSection(context.geometry_validation)}
    <section class="panel"><h2>目标对象</h2>${targets.length ? `<ul class="target-list">${targets.map((target) => `<li><strong>${escapeHtml(target.name || target.kind || '未命名对象')}</strong><code>${escapeHtml(target.entity_path || target.target_id || target.instance_id || 'opaque target')}</code><span>${escapeHtml(target.instance_policy || target.edit_scope || '')}</span></li>`).join('')}</ul>` : '<p class="empty">目标由计划 hash 绑定；当前没有额外可读摘要。</p>'}</section>
    ${context.execution ? `<section class="panel"><h2>保存与截图</h2><dl class="binding-grid"><div><dt>保存副本</dt><dd>${context.execution.save_model ? '是' : '否'}</dd></div><div><dt>保存基路径</dt><dd><code>${escapeHtml(context.execution.save_path || '由服务端生成')}</code></dd></div><div><dt>实际版本文件</dt><dd><code>${escapeHtml(context.execution.final_save_path || '由服务端生成')}</code></dd></div><div><dt>覆盖已有文件</dt><dd>${context.execution.overwrite_existing === false ? '禁止' : '未声明'}</dd></div><div><dt>执行后截图</dt><dd>${context.execution.capture_view ? '是' : '否'}</dd></div></dl></section>` : ''}
    ${pending ? decisionForms(challenge, csrf) : `<section class="panel decision-result"><h2>审批结果</h2><p>${escapeHtml(decision?.decision || (expired ? 'expired' : challenge.status))}</p>${decision?.decided_at ? `<p>${escapeHtml(formatDate(decision.decided_at))} · ${escapeHtml(decision.decided_by)}</p>` : ''}</section>`}
  `);
}

function geometryValidationSection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const exactOverlap = value.exact_solid_overlap && typeof value.exact_solid_overlap === 'object' && !Array.isArray(value.exact_solid_overlap)
    ? value.exact_solid_overlap
    : {};
  const successPreconditions = Array.isArray(value.success_preconditions)
    ? value.success_preconditions
    : [];
  return `<section class="panel geometry-validation"><h2>布尔几何验证边界</h2>
    <p><strong>BBox 重叠只用于候选筛选</strong>，不能证明两个实体真正相交。 <code>${escapeHtml(value.evidence_kind || 'not_disclosed')}</code> <code>${escapeHtml(value.bbox_relation || 'not_disclosed')}</code></p>
    <p><strong>精确实体相交尚未验证</strong>；本次审批不会把它当作已证实事实。 <code>${escapeHtml(exactOverlap.status || 'not_disclosed')}</code> <code>verified=${escapeHtml(String(exactOverlap.verified ?? 'not_disclosed'))}</code> <code>${escapeHtml(exactOverlap.verification_stage || 'not_disclosed')}</code></p>
    <p><strong>批准的动作</strong>：仅允许受审查门控的原子布尔试算。 <code>${escapeHtml(value.approved_action || 'not_disclosed')}</code></p>
    <p><strong>成功前置条件</strong>：目标的精确体积必须严格减少，且结果必须是 manifold。</p>
    ${successPreconditions.length ? `<ul>${successPreconditions.map((condition) => `<li><code>${escapeHtml(condition)}</code></li>`).join('')}</ul>` : ''}
    <p><strong>提交前强制中止</strong>：任一成功前置条件不成立时，必须 <code>${escapeHtml(value.failure_disposition || 'not_disclosed')}</code>。</p>
  </section>`;
}

function operationBindingDetails(entry = {}) {
  const details = [];
  if (entry.target) details.push(`target=${entry.target}`);
  if (Array.isArray(entry.tools) && entry.tools.length) details.push(`tools=${entry.tools.join(', ')}`);
  if (entry.result_id) details.push(`result_id=${entry.result_id}`);
  if (entry.result_name) details.push(`result_name=${entry.result_name}`);
  if (typeof entry.keep_originals === 'boolean') details.push(`keep_originals=${entry.keep_originals}`);
  if (typeof entry.keep_tools === 'boolean') details.push(`keep_tools=${entry.keep_tools}`);
  return details.length ? `<small><code>${escapeHtml(details.join(' · '))}</code></small>` : '';
}

function decisionForms(challenge, csrf) {
  const decisionOptions = Array.isArray(challenge.review_context?.decision_options)
    ? challenge.review_context.decision_options
    : [];
  return `<section class="decision-grid">
    <form method="post" action="/approvals/${encodeURIComponent(challenge.challenge_id)}/approve" class="panel approval-form approve-form">
      <h2>批准一次性执行</h2><p>批准只对上面的 task、plan hash、model revision、风险和操作范围有效。</p>
      ${decisionOptions.length ? `<fieldset><legend>选择要批准的协调决定</legend>${decisionOptions.map((entry) => {
        const value = String(entry?.value || entry);
        const label = String(entry?.label || entry?.value || entry);
        return `<label class="checkbox"><input type="radio" name="review_selection" value="${escapeHtml(value)}" required>${escapeHtml(label)}</label>`;
      }).join('')}</fieldset>` : ''}
      <label class="checkbox"><input type="checkbox" name="acknowledge" value="yes" required>我已核对绑定信息，并确认当前测试模型允许修改。</label>
      <label>审批口令<input type="password" name="passphrase" autocomplete="current-password" minlength="12" maxlength="256" required></label>
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="primary" type="submit">批准这一次执行</button>
    </form>
    <form method="post" action="/approvals/${encodeURIComponent(challenge.challenge_id)}/reject" class="panel approval-form reject-form">
      <h2>拒绝</h2><p>拒绝后 Agent 不能继续执行这个 challenge。</p>
      <label>原因（可选）<textarea name="reason" maxlength="500"></textarea></label>
      <label class="checkbox"><input type="checkbox" name="acknowledge" value="yes" required>我确认拒绝当前计划。</label>
      <label>审批口令<input type="password" name="passphrase" autocomplete="current-password" minlength="12" maxlength="256" required></label>
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="danger" type="submit">拒绝当前计划</button>
    </form>
  </section>`;
}

function setupPage(csrf) {
  return layout('初始化本机审批', `<main class="auth-shell"><section class="auth-card"><p class="eyebrow">First-time setup</p><h1>初始化本机审批口令</h1><p>首次初始化还需要主机启动时在终端显示、或由可信管理员显式配置的一次性 bootstrap secret。它只在内存中核验，成功建立身份后立即失效。</p><p>审批口令只用于你本人批准 S2–S4 操作，不会写入 MCP 输出，也不会发送给 Agent。每次批准都会要求重新输入。</p>
    <form method="post" action="/setup" class="auth-form">
      <label>一次性 bootstrap secret<input type="password" name="bootstrap_secret" autocomplete="off" minlength="32" maxlength="256" required></label>
      <label>本机用户标识<input name="user_id" value="local-user" pattern="[A-Za-z0-9._-]{1,64}" maxlength="64" required></label>
      <label>新审批口令<input type="password" name="passphrase" autocomplete="new-password" minlength="12" maxlength="256" required></label>
      <label>确认审批口令<input type="password" name="confirm_passphrase" autocomplete="new-password" minlength="12" maxlength="256" required></label>
      <input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="primary" type="submit">建立本机审批身份</button>
    </form><p class="fine-print">安全边界：服务默认仅监听 127.0.0.1，但 loopback 本身不是信任边界。bootstrap secret 不会写入审批状态、任务、证据或响应。拥有同一操作系统账号和任意进程/文件权限的恶意程序仍属于系统级威胁。</p></section></main>`);
}

function loginPage(csrf, error = '') {
  return layout('登录本机审批', `<main class="auth-shell"><section class="auth-card"><p class="eyebrow">Trusted user presence</p><h1>打开本机审批中心</h1><p>输入审批口令以查看等待中的 challenge。登录会话本身不能批准；每次决定仍需重新输入口令。</p>${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="/login" class="auth-form"><label>审批口令<input type="password" name="passphrase" autocomplete="current-password" minlength="12" maxlength="256" required></label><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="primary" type="submit">进入审批中心</button></form></section></main>`);
}

function errorPage(code, message) {
  return layout('审批页错误', `<main class="auth-shell"><section class="auth-card"><p class="eyebrow">${escapeHtml(code)}</p><h1>无法完成请求</h1><p>${escapeHtml(message)}</p><p><a href="/">返回审批中心</a></p></section></main>`);
}

function layout(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Local MCP for SketchUp</title><link rel="stylesheet" href="/approval.css"></head><body><div class="page">${body}</div></body></html>`;
}

function displayStatus(challenge, decision) {
  if (challenge.expired || Date.parse(challenge.expires_at) <= Date.now()) return '已过期';
  if (decision?.status === 'reauthorization_required') return '记录无效，请创建新审批任务';
  if (decision?.status === 'consumed' || challenge.status === 'consumed') return '已使用';
  if (decision?.decision === 'approved') return '已批准，等待服务端执行';
  if (decision?.decision === 'rejected') return '已拒绝';
  return '等待真人审批';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function sendHtml(response, statusCode, html, cookies = []) {
  return send(response, statusCode, html, 'text/html; charset=utf-8', cookies);
}

function sendCss(response, css) {
  return send(response, 200, css, 'text/css; charset=utf-8');
}

function sendJson(response, statusCode, value) {
  return send(response, statusCode, `${JSON.stringify(value, null, 2)}\n`, 'application/json; charset=utf-8');
}

function redirect(response, location, cookies = []) {
  if (response.headersSent || response.destroyed) return;
  const headers = securityHeaders('text/plain; charset=utf-8');
  headers.location = location;
  if (cookies.length) headers['set-cookie'] = cookies;
  response.writeHead(303, headers);
  response.end('See Other\n');
}

function send(response, statusCode, body, contentType, cookies = []) {
  if (response.headersSent || response.destroyed) return;
  const headers = securityHeaders(contentType);
  if (cookies.length) headers['set-cookie'] = cookies;
  response.writeHead(statusCode, headers);
  response.end(body);
}

function securityHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache',
    'content-security-policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  };
}

function normalizeHostError(error) {
  if (error instanceof LocalApprovalHttpError) return error;
  if (error instanceof AgentContractError) {
    const statusCode = error.code === 'APPROVAL_EXPIRED' ? 409 : error.code === 'POLICY_DENIED' ? 403 : error.code === 'APPROVAL_REPLAYED' ? 409 : 400;
    return new LocalApprovalHttpError(statusCode, error.code, error.message);
  }
  return new LocalApprovalHttpError(500, 'INTERNAL_ERROR', 'The local approval host could not complete the request.');
}

function currentAuthority(server, config) {
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : config.port;
  return `${formatHost(config.host)}:${port}`;
}

function currentOrigin(server, config) {
  return `http://${currentAuthority(server, config)}`;
}

function formatHost(host) {
  return String(host).includes(':') ? `[${host}]` : String(host);
}

function isLoopbackHost(host) {
  const normalized = String(host || '').toLowerCase();
  if (normalized === 'localhost') return true;
  if (isIP(normalized) === 4) return normalized.split('.')[0] === '127';
  if (isIP(normalized) === 6) return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
  return false;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedMilliseconds(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? Math.floor(parsed) : fallback;
}

class LocalApprovalHttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const APPROVAL_CSS = `
:root{color-scheme:light;--ink:#15211d;--muted:#63706a;--paper:#f4f1e9;--panel:#fffdf8;--line:#d8d4c8;--green:#1d6b4f;--red:#a13b2d;--amber:#9b6500;--shadow:0 18px 50px rgba(21,33,29,.08)}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#dfece4 0,transparent 32rem),var(--paper);color:var(--ink);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;line-height:1.55}.page{width:min(1040px,calc(100% - 32px));margin:0 auto;padding:48px 0 72px}.hero,.detail-header{margin:0 0 28px}.eyebrow{letter-spacing:.13em;text-transform:uppercase;font-size:.76rem;font-weight:800;color:var(--green)}h1{font-size:clamp(2rem,5vw,3.8rem);line-height:1.05;margin:.25rem 0 1rem;letter-spacing:-.04em}h2{font-size:1.08rem;margin:0 0 16px}.hero>p:last-child{max-width:680px;color:var(--muted)}a{color:var(--green)}.panel,.auth-card,.warning{background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:24px;margin:0 0 20px;box-shadow:var(--shadow)}.panel.muted{background:#f8f6ef}.section-title{display:flex;align-items:center;justify-content:space-between}.count{display:grid;place-items:center;width:30px;height:30px;border-radius:999px;background:#e4ebe6;font-weight:800}.challenge-card{display:grid;grid-template-columns:1fr auto;gap:8px 20px;color:inherit;text-decoration:none;border-top:1px solid var(--line);padding:18px 4px}.challenge-card>div{display:flex;gap:10px;align-items:center}.challenge-card p{grid-column:1;margin:0;color:var(--muted);font-family:ui-monospace,monospace;font-size:.8rem;overflow-wrap:anywhere}.challenge-card .status{grid-column:2;grid-row:1/3;align-self:center;color:var(--muted);font-size:.88rem}.risk{display:inline-flex;padding:4px 9px;border-radius:999px;font-size:.76rem;font-weight:900;background:#e8eee9}.risk-S2{background:#fff0bf;color:#765000}.risk-S3,.risk-S4{background:#f8d7d0;color:#7b261c}.detail-header .status-large{font-weight:700;color:var(--muted)}.warning{background:#fff6d9;border-color:#ebcc70;box-shadow:none}.warning strong{color:#765000}.warning p{margin:.45rem 0 0}.instruction{font-size:1.18rem}.binding-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.binding-grid>div{min-width:0}.binding-grid dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.binding-grid dd{margin:4px 0 0;overflow-wrap:anywhere}.binding-grid code{font-size:.76rem}.operation-list,.target-list{margin:0;padding-left:22px}.operation-list li,.target-list li{padding:8px 0}.danger-label,.topology-label{font-size:.7rem;font-weight:800;border-radius:999px;padding:3px 7px;margin-left:8px}.danger-label{background:#f8d7d0;color:#7b261c}.topology-label{background:#dce9f3;color:#28566f}.target-list li{display:grid;grid-template-columns:1fr;gap:3px}.target-list code{font-size:.76rem;overflow-wrap:anywhere;color:var(--muted)}.decision-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.approval-form{display:flex;flex-direction:column;gap:14px}.approval-form label,.auth-form label{display:flex;flex-direction:column;gap:7px;font-weight:700;font-size:.9rem}.approval-form input,.approval-form textarea,.auth-form input{width:100%;border:1px solid #b9b8b0;border-radius:10px;padding:12px;background:white;font:inherit}.approval-form textarea{min-height:90px}.approval-form .checkbox{display:grid;grid-template-columns:auto 1fr;align-items:start}.approval-form .checkbox input{width:18px;margin-top:3px}.primary,.danger,.link-button{border:0;border-radius:10px;padding:12px 16px;font:inherit;font-weight:800;cursor:pointer}.primary{background:var(--green);color:white}.danger{background:var(--red);color:white}.link-button{background:transparent;color:var(--green)}.logout{text-align:right}.auth-shell{min-height:calc(100vh - 120px);display:grid;place-items:center}.auth-card{width:min(560px,100%);padding:36px}.auth-form{display:flex;flex-direction:column;gap:16px}.fine-print,.empty{color:var(--muted);font-size:.86rem}.form-error{background:#f8d7d0;color:#7b261c;padding:10px;border-radius:8px}@media(max-width:720px){.page{padding-top:28px}.binding-grid,.decision-grid{grid-template-columns:1fr}.challenge-card{grid-template-columns:1fr}.challenge-card .status{grid-column:1;grid-row:auto}.auth-card{padding:24px}}
`;

async function main() {
  const preflightConfig = createLocalApprovalHostConfig();
  const initialized = await credentialExists(preflightConfig.credentialPath);
  const configuredBootstrapSecret = process.env[BOOTSTRAP_SECRET_ENV] || null;
  let generatedBootstrapSecret = !initialized && !configuredBootstrapSecret
    ? generateLocalApprovalBootstrapSecret()
    : null;
  let bootstrapSecret = initialized ? null : (configuredBootstrapSecret || generatedBootstrapSecret);
  const server = createLocalApprovalHost({ bootstrapSecret });
  bootstrapSecret = null;
  const config = server.localMcpConfig;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  const url = currentOrigin(server, config);
  process.stderr.write(`Local MCP for SketchUp approval host listening on ${url}\n`);
  process.stderr.write(`Approval identity: ${initialized ? 'initialized' : 'first-time setup required in the browser'}\n`);
  if (!initialized && generatedBootstrapSecret) {
    process.stderr.write(`One-time setup bootstrap secret (shown once): ${generatedBootstrapSecret}\n`);
    generatedBootstrapSecret = null;
  } else if (!initialized) {
    process.stderr.write(`One-time setup bootstrap secret: configured through ${BOOTSTRAP_SECRET_ENV}; value not logged.\n`);
  }
  process.stderr.write('Approval tokens remain server-private and are never returned by this web UI.\n');
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
