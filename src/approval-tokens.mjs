import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson } from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';

const APPROVAL_VERSION = 'approval-token.v1';

export class ApprovalAuthority {
  constructor({ stateDir = path.join(defaultStateDir, 'agent-contract-v1', 'approvals'), secret } = {}) {
    this.stateDir = path.resolve(stateDir);
    this.secretOverride = secret || process.env.ALMA_SKETCHUP_APPROVAL_SECRET || null;
    this.secretPromise = null;
  }

  async createChallenge({ taskId = null, planId, planHash, modelRevision, riskLevel, allowedOperations, expiresInMs = 15 * 60 * 1000 } = {}) {
    const now = Date.now();
    const challenge = {
      version: APPROVAL_VERSION,
      kind: 'approval_challenge',
      challenge_id: `approval_${crypto.randomUUID()}`,
      task_id: taskId,
      plan_id: requiredString(planId, 'planId'),
      plan_hash: requiredString(planHash, 'planHash'),
      model_revision: requiredString(modelRevision, 'modelRevision'),
      risk_level: requiredRisk(riskLevel),
      allowed_operations: normalizeOperations(allowedOperations),
      nonce: crypto.randomBytes(24).toString('base64url'),
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + boundedExpiry(expiresInMs)).toISOString(),
      status: 'awaiting_trusted_user'
    };
    await atomicWriteJson(this.challengePath(challenge.challenge_id), challenge);
    return challenge;
  }

  async approveChallengeFromTrustedUser(challengeOrId, trustedUser) {
    if (!trustedUser || trustedUser.confirmed !== true || !trustedUser.user_id || !trustedUser.channel) {
      throw new AgentContractError('POLICY_DENIED', 'Approval tokens may only be issued by a trusted user-presence channel.');
    }
    const challenge = typeof challengeOrId === 'string'
      ? await this.readChallenge(challengeOrId)
      : await this.readChallenge(challengeOrId?.challenge_id);
    assertNotExpired(challenge);
    const payload = {
      version: APPROVAL_VERSION,
      kind: 'approval_token',
      challenge_id: challenge.challenge_id,
      task_id: challenge.task_id,
      plan_id: challenge.plan_id,
      plan_hash: challenge.plan_hash,
      model_revision: challenge.model_revision,
      risk_level: challenge.risk_level,
      allowed_operations: challenge.allowed_operations,
      nonce: challenge.nonce,
      approved_by: String(trustedUser.user_id),
      approval_channel: String(trustedUser.channel),
      approved_at: new Date().toISOString(),
      expires_at: challenge.expires_at
    };
    const encoded = Buffer.from(canonicalJson(payload)).toString('base64url');
    const signature = await this.sign(encoded);
    return `${encoded}.${signature}`;
  }

  async consumeToken(token, expected = {}) {
    const payload = await this.verifyToken(token);
    const challenge = await this.readChallenge(payload.challenge_id);
    assertNotExpired(payload);
    assertNotExpired(challenge);
    assertBinding(payload, challenge, 'APPROVAL_INVALID');
    assertExpected(payload, expected);

    const spentPath = path.join(this.stateDir, 'spent', `${safeId(payload.challenge_id)}.json`);
    await fs.mkdir(path.dirname(spentPath), { recursive: true });
    try {
      const handle = await fs.open(spentPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ challenge_id: payload.challenge_id, consumed_at: new Date().toISOString(), plan_id: payload.plan_id }, null, 2)}\n`, 'utf8');
      await handle.close();
    } catch (error) {
      if (error?.code === 'EEXIST') throw new AgentContractError('APPROVAL_REPLAYED', 'This approval token has already been consumed.');
      throw error;
    }
    await atomicWriteJson(this.challengePath(challenge.challenge_id), { ...challenge, status: 'consumed', consumed_at: new Date().toISOString() });
    return payload;
  }

  async verifyToken(token) {
    const [encoded, suppliedSignature, extra] = String(token || '').split('.');
    if (!encoded || !suppliedSignature || extra) throw new AgentContractError('APPROVAL_INVALID', 'The approval token format is invalid.');
    const expectedSignature = await this.sign(encoded);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      throw new AgentContractError('APPROVAL_INVALID', 'The approval token signature is invalid.');
    }
    let payload;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw new AgentContractError('APPROVAL_INVALID', 'The approval token payload is invalid.');
    }
    if (payload?.version !== APPROVAL_VERSION || payload?.kind !== 'approval_token') {
      throw new AgentContractError('APPROVAL_INVALID', 'The approval token version is unsupported.');
    }
    return payload;
  }

  async readChallenge(challengeId) {
    try {
      return JSON.parse(await fs.readFile(this.challengePath(challengeId), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new AgentContractError('APPROVAL_INVALID', 'The approval challenge does not exist.');
      throw error;
    }
  }

  challengePath(challengeId) {
    return path.join(this.stateDir, 'challenges', `${safeId(challengeId)}.json`);
  }

  async sign(value) {
    const secret = await this.secret();
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
  }

  async secret() {
    if (!this.secretPromise) this.secretPromise = this.loadOrCreateSecret();
    return this.secretPromise;
  }

  async loadOrCreateSecret() {
    if (this.secretOverride) {
      if (Buffer.byteLength(this.secretOverride) < 32) throw new AgentContractError('POLICY_DENIED', 'The approval signing secret must be at least 32 bytes.');
      return this.secretOverride;
    }
    const filePath = path.join(this.stateDir, 'approval-signing-secret');
    await fs.mkdir(this.stateDir, { recursive: true });
    try {
      return (await fs.readFile(filePath, 'utf8')).trim();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const secret = crypto.randomBytes(48).toString('base64url');
    try {
      const handle = await fs.open(filePath, 'wx', 0o600);
      await handle.writeFile(`${secret}\n`, 'utf8');
      await handle.close();
      return secret;
    } catch (error) {
      if (error?.code === 'EEXIST') return (await fs.readFile(filePath, 'utf8')).trim();
      throw error;
    }
  }
}

function assertExpected(payload, expected) {
  const scalarFields = ['task_id', 'plan_id', 'plan_hash', 'model_revision', 'risk_level'];
  for (const field of scalarFields) {
    if (expected[field] !== undefined && (payload[field] || null) !== (expected[field] || null)) {
      const code = field === 'plan_hash' ? 'PLAN_HASH_MISMATCH' : field === 'model_revision' ? 'MODEL_REVISION_MISMATCH' : 'APPROVAL_INVALID';
      throw new AgentContractError(code, `Approval token ${field} does not match the current plan.`);
    }
  }
  if (expected.allowed_operations !== undefined) {
    const requested = normalizeOperations(expected.allowed_operations);
    const allowed = new Set(payload.allowed_operations);
    if (requested.some((operation) => !allowed.has(operation))) {
      throw new AgentContractError('OPERATION_NOT_ALLOWED', 'The approval token does not allow every requested operation.');
    }
  }
}

function assertBinding(left, right, code) {
  for (const field of ['challenge_id', 'task_id', 'plan_id', 'plan_hash', 'model_revision', 'risk_level', 'nonce', 'expires_at']) {
    if ((left[field] || null) !== (right[field] || null)) throw new AgentContractError(code, 'The approval token does not match its server challenge.');
  }
  if (canonicalJson(left.allowed_operations) !== canonicalJson(right.allowed_operations)) {
    throw new AgentContractError(code, 'The approval token operation scope does not match its server challenge.');
  }
}

function assertNotExpired(value) {
  if (!value?.expires_at || Date.parse(value.expires_at) <= Date.now()) {
    throw new AgentContractError('APPROVAL_EXPIRED', 'The approval has expired.');
  }
}

function normalizeOperations(value) {
  if (!Array.isArray(value) || value.length === 0) throw new AgentContractError('INVALID_ARGUMENT', 'allowedOperations must be a non-empty array.');
  return [...new Set(value.map((item) => requiredString(item, 'allowedOperations[]')))].sort();
}

function requiredRisk(value) {
  if (!['S1', 'S2', 'S3', 'S4'].includes(value)) throw new AgentContractError('INVALID_ARGUMENT', 'riskLevel must be S1, S2, S3, or S4.');
  return value;
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentContractError('INVALID_ARGUMENT', `${field} must be a non-empty string.`);
  return value.trim();
}

function boundedExpiry(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 24 * 60 * 60 * 1000) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Approval expiry must be between 1 second and 24 hours.');
  }
  return Math.floor(parsed);
}

function safeId(value) {
  if (!/^[a-z0-9_-]+$/i.test(String(value || ''))) throw new AgentContractError('APPROVAL_INVALID', 'The approval challenge id is invalid.');
  return value;
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}
