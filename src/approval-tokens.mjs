import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson } from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';

const APPROVAL_VERSION = 'approval-token.v1';
export const LOCAL_APPROVAL_DECISION_VERSION = 'local-approval-decision.v1';
const DEFAULT_APPROVAL_HOST_URL = 'http://127.0.0.1:3978';

export class ApprovalAuthority {
  constructor({
    stateDir = path.join(defaultStateDir, 'agent-contract-v1', 'approvals'),
    secret,
    approvalHostUrl = process.env.ALMA_SKETCHUP_APPROVAL_HOST_URL || DEFAULT_APPROVAL_HOST_URL
  } = {}) {
    this.stateDir = path.resolve(stateDir);
    this.secretOverride = secret || process.env.ALMA_SKETCHUP_APPROVAL_SECRET || null;
    this.secretPromise = null;
    this.approvalHostUrl = normalizeApprovalHostUrl(approvalHostUrl);
  }

  async createChallenge({
    taskId = null,
    planId,
    planHash,
    modelRevision,
    riskLevel,
    allowedOperations,
    reviewContext = null,
    expiresInMs = 15 * 60 * 1000,
    idempotencyKey = null
  } = {}) {
    const now = Date.now();
    const normalizedReviewContext = normalizeReviewContext(reviewContext);
    const normalizedBinding = {
      task_id: taskId,
      plan_id: requiredString(planId, 'planId'),
      plan_hash: requiredString(planHash, 'planHash'),
      model_revision: requiredString(modelRevision, 'modelRevision'),
      risk_level: requiredRisk(riskLevel),
      allowed_operations: normalizeOperations(allowedOperations),
      review_context_hash: sha256Canonical(normalizedReviewContext)
    };
    const challenge = {
      version: APPROVAL_VERSION,
      kind: 'approval_challenge',
      challenge_id: idempotencyKey
        ? deterministicChallengeId(idempotencyKey)
        : `approval_${crypto.randomUUID()}`,
      ...normalizedBinding,
      nonce: crypto.randomBytes(24).toString('base64url'),
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + boundedExpiry(expiresInMs)).toISOString(),
      status: 'awaiting_trusted_user',
      ...(normalizedReviewContext ? { review_context: normalizedReviewContext } : {})
    };
    if (!idempotencyKey) {
      await atomicWriteJson(this.challengePath(challenge.challenge_id), challenge);
      return challenge;
    }
    try {
      await createJsonExclusive(this.challengePath(challenge.challenge_id), challenge);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await this.readChallenge(challenge.challenge_id);
      assertChallengeBinding(existing, challenge);
      return existing;
    }
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
    if (challenge.status !== 'awaiting_trusted_user') {
      throw new AgentContractError('APPROVAL_REPLAYED', 'This approval challenge is no longer awaiting a trusted user decision.');
    }
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
      review_context_hash: challenge.review_context_hash || sha256Canonical(null),
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

  approvalUrl(challengeId) {
    return `${this.approvalHostUrl}/approvals/${encodeURIComponent(safeId(challengeId))}`;
  }

  async recordTrustedDecision(challengeOrId, { decision, user_id, channel = 'local-approval-host.v1', confirmed, reason, selection } = {}) {
    if (!['approved', 'rejected'].includes(decision)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'The local approval decision must be approved or rejected.');
    }
    if (!user_id || !channel || confirmed !== true) {
      throw new AgentContractError('POLICY_DENIED', 'A local approval decision requires an authenticated user-presence channel.');
    }
    const challenge = typeof challengeOrId === 'string'
      ? await this.readChallenge(challengeOrId)
      : await this.readChallenge(challengeOrId?.challenge_id);
    assertNotExpired(challenge);
    if (challenge.status !== 'awaiting_trusted_user') {
      throw new AgentContractError('APPROVAL_REPLAYED', 'This approval challenge is no longer awaiting a trusted user decision.');
    }
    const normalizedSelection = normalizeReviewSelection(selection, challenge, decision);
    const bindingHash = approvalChallengeBindingHash(challenge);
    const approvalToken = decision === 'approved'
      ? await this.approveChallengeFromTrustedUser(challenge, { user_id, channel, confirmed: true })
      : null;
    const approvalPayload = approvalToken ? await this.verifyToken(approvalToken) : null;
    const unsignedRecord = {
      version: LOCAL_APPROVAL_DECISION_VERSION,
      kind: 'local_approval_decision',
      decision_id: deterministicDecisionId(challenge.challenge_id),
      challenge_id: challenge.challenge_id,
      task_id: challenge.task_id,
      plan_id: challenge.plan_id,
      binding_hash: bindingHash,
      decision,
      decided_by: String(user_id),
      approval_channel: String(channel),
      decided_at: approvalPayload?.approved_at || new Date().toISOString(),
      expires_at: challenge.expires_at,
      status: decision === 'approved' ? 'approved_pending_execution' : 'rejected',
      ...(reason ? { reason: String(reason).trim().slice(0, 500) } : {}),
      ...(normalizedSelection ? { review_selection: normalizedSelection } : {}),
      ...(approvalToken ? {
        approval_token_hash: opaqueSha256(approvalToken),
        approval_token: approvalToken
      } : {})
    };
    const record = await this.signDecisionRecord(unsignedRecord);
    try {
      await createJsonExclusive(this.decisionPath(challenge.challenge_id), record);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await this.readDecisionRecord(challenge.challenge_id);
      await this.verifyDecisionRecordIntegrity(existing, challenge);
      if (existing.binding_hash !== bindingHash || existing.decision !== decision) {
        throw new AgentContractError('POLICY_DENIED', 'This approval challenge already has a different trusted user decision.');
      }
      return publicDecision(existing);
    }
    return publicDecision(record);
  }

  async readStoredApprovalAuthorization(challengeOrId, expected = {}) {
    const challengeId = typeof challengeOrId === 'string' ? challengeOrId : challengeOrId?.challenge_id;
    const challenge = await this.readChallenge(challengeId);
    assertNotExpired(challenge);
    if (challenge.status !== 'awaiting_trusted_user') {
      throw new AgentContractError('APPROVAL_REPLAYED', 'This approval challenge has already been consumed.');
    }
    const decision = await this.readDecisionRecord(challengeId, { allowMissing: true });
    if (!decision) {
      throw new AgentContractError('APPROVAL_REQUIRED', 'The trusted local approval page has not recorded a decision yet.', {
        nextAction: { action: 'request_user_approval', approval_url: this.approvalUrl(challengeId) }
      });
    }
    await this.verifyDecisionRecordIntegrity(decision, challenge);
    if (decision.decision !== 'approved' || !decision.approval_token) {
      throw new AgentContractError('POLICY_DENIED', 'The trusted local user rejected this approval challenge.', {
        nextAction: { action: 'start_new_task', reason: 'trusted_user_rejected' }
      });
    }
    const authorization = await this.verifyToken(decision.approval_token);
    assertBinding(authorization, challenge, 'APPROVAL_INVALID');
    assertDecisionAuthorizationBinding(decision, authorization);
    assertExpected(authorization, expected);
    return { approval_token: decision.approval_token, decision: publicDecision(decision), authorization };
  }

  async verifyStoredApprovalAuthorizationReady(challengeOrId, expected = {}) {
    const stored = await this.readStoredApprovalAuthorization(challengeOrId, expected);
    return {
      decision: stored.decision,
      authorization: publicAuthorizationSummary(stored.authorization)
    };
  }

  async readStoredApprovalToken(challengeOrId) {
    return (await this.readStoredApprovalAuthorization(challengeOrId)).approval_token;
  }

  async readDecision(challengeId, { allowMissing = false } = {}) {
    const record = await this.readDecisionRecord(challengeId, { allowMissing });
    if (!record) return null;
    const challenge = await this.readChallenge(challengeId);
    await this.verifyDecisionRecordIntegrity(record, challenge);
    return publicDecision(record);
  }

  async readDecisionForDisplay(challengeId, { allowMissing = true } = {}) {
    try {
      return await this.readDecision(challengeId, { allowMissing });
    } catch (error) {
      if (error?.code !== 'APPROVAL_INVALID') throw error;
      const challenge = await this.readChallenge(challengeId);
      return invalidDecisionDisplay(challenge);
    }
  }

  async listChallenges({ includeExpired = true, limit = 100 } = {}) {
    const directory = path.join(this.stateDir, 'challenges');
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const challenges = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const challenge = JSON.parse(await fs.readFile(path.join(directory, entry.name), 'utf8'));
      const expired = !challenge.expires_at || Date.parse(challenge.expires_at) <= Date.now();
      if (expired && !includeExpired) continue;
      const decision = await this.readDecisionForDisplay(challenge.challenge_id, { allowMissing: true });
      challenges.push({
        ...challenge,
        approval_url: this.approvalUrl(challenge.challenge_id),
        expired,
        decision
      });
    }
    return challenges
      .sort((left, right) => Date.parse(right.issued_at || 0) - Date.parse(left.issued_at || 0))
      .slice(0, boundedListLimit(limit));
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
    const decision = await this.readDecisionRecord(challenge.challenge_id, { allowMissing: true });
    if (decision) {
      await this.verifyDecisionRecordIntegrity(decision, challenge);
      if (decision.approval_token !== token) {
        throw new AgentContractError('APPROVAL_INVALID', 'The stored local approval decision does not authorize this token.');
      }
      const { approval_token: ignoredToken, ...redacted } = decision;
      const consumedDecision = await this.signDecisionRecord({
        ...redacted,
        status: 'consumed',
        consumed_at: new Date().toISOString()
      });
      await atomicWriteJson(this.decisionPath(challenge.challenge_id), consumedDecision);
    }
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

  decisionPath(challengeId) {
    return path.join(this.stateDir, 'local-decisions', `${safeId(challengeId)}.json`);
  }

  async readDecisionRecord(challengeId, { allowMissing = false } = {}) {
    try {
      return JSON.parse(await fs.readFile(this.decisionPath(challengeId), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissing) return null;
      if (error?.code === 'ENOENT') throw new AgentContractError('APPROVAL_REQUIRED', 'The trusted local approval decision does not exist.');
      throw error;
    }
  }

  async sign(value) {
    const secret = await this.secret();
    return crypto.createHmac('sha256', secret).update(value).digest('base64url');
  }

  async signDecisionRecord(record) {
    const unsigned = structuredClone(record);
    delete unsigned.decision_signature;
    return {
      ...unsigned,
      decision_signature: await this.sign(canonicalJson(decisionSignaturePayload(unsigned)))
    };
  }

  async verifyDecisionRecordIntegrity(record, challenge) {
    if (!record || typeof record !== 'object' || typeof record.decision_signature !== 'string') {
      throw new AgentContractError('APPROVAL_INVALID', 'The stored local approval decision has no valid server signature.');
    }
    const expectedSignature = await this.sign(canonicalJson(decisionSignaturePayload(record)));
    if (!timingSafeStringEqual(record.decision_signature, expectedSignature)) {
      throw new AgentContractError('APPROVAL_INVALID', 'The stored local approval decision signature is invalid.');
    }
    assertDecisionRecordBinding(record, challenge);
    if (record.approval_token && record.approval_token_hash !== opaqueSha256(record.approval_token)) {
      throw new AgentContractError('APPROVAL_INVALID', 'The stored local approval authorization hash is invalid.');
    }
    return record;
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
  const scalarFields = ['challenge_id', 'task_id', 'plan_id', 'plan_hash', 'model_revision', 'risk_level', 'review_context_hash'];
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

function assertDecisionRecordBinding(record, challenge) {
  const expected = {
    version: LOCAL_APPROVAL_DECISION_VERSION,
    kind: 'local_approval_decision',
    decision_id: deterministicDecisionId(challenge.challenge_id),
    challenge_id: challenge.challenge_id,
    task_id: challenge.task_id,
    plan_id: challenge.plan_id,
    binding_hash: approvalChallengeBindingHash(challenge),
    expires_at: challenge.expires_at
  };
  for (const [field, value] of Object.entries(expected)) {
    if ((record[field] ?? null) !== (value ?? null)) {
      throw new AgentContractError('APPROVAL_INVALID', `The stored local approval decision ${field} binding is invalid.`);
    }
  }
  if (!['approved', 'rejected'].includes(record.decision)
    || typeof record.decided_by !== 'string'
    || !record.decided_by
    || typeof record.approval_channel !== 'string'
    || !record.approval_channel
    || !Number.isFinite(Date.parse(record.decided_at || ''))
    || Date.parse(record.decided_at) > Date.parse(record.expires_at)) {
    throw new AgentContractError('APPROVAL_INVALID', 'The stored local approval decision metadata is invalid.');
  }
  if (record.decision === 'approved') {
    if (!['approved_pending_execution', 'consumed'].includes(record.status)
      || typeof record.approval_token_hash !== 'string'
      || !/^sha256:[0-9a-f]{64}$/.test(record.approval_token_hash)
      || (record.status === 'approved_pending_execution' && typeof record.approval_token !== 'string')
      || (record.status === 'consumed' && (record.approval_token !== undefined || !Number.isFinite(Date.parse(record.consumed_at || ''))))) {
      throw new AgentContractError('APPROVAL_INVALID', 'The stored approved decision state is invalid.');
    }
    const normalizedSelection = normalizeReviewSelection(record.review_selection, challenge, 'approved');
    if ((record.review_selection || null) !== (normalizedSelection || null)) {
      throw new AgentContractError('APPROVAL_INVALID', 'The stored local review selection is invalid.');
    }
  } else if (record.status !== 'rejected'
    || record.approval_token !== undefined
    || record.approval_token_hash !== undefined
    || record.review_selection !== undefined) {
    throw new AgentContractError('APPROVAL_INVALID', 'The stored rejected decision state is invalid.');
  }
}

function assertDecisionAuthorizationBinding(decision, authorization) {
  const fields = {
    challenge_id: authorization.challenge_id,
    task_id: authorization.task_id,
    plan_id: authorization.plan_id,
    decided_by: authorization.approved_by,
    approval_channel: authorization.approval_channel,
    decided_at: authorization.approved_at,
    expires_at: authorization.expires_at,
    approval_token_hash: opaqueSha256(decision.approval_token)
  };
  for (const [field, expected] of Object.entries(fields)) {
    if ((decision[field] ?? null) !== (expected ?? null)) {
      throw new AgentContractError('APPROVAL_INVALID', `The stored local approval decision ${field} does not match its signed authorization.`);
    }
  }
}

function decisionSignaturePayload(record) {
  const payload = structuredClone(record || {});
  delete payload.decision_signature;
  delete payload.approval_token;
  return payload;
}

function publicAuthorizationSummary(payload) {
  return {
    challenge_id: payload.challenge_id,
    task_id: payload.task_id,
    plan_id: payload.plan_id,
    plan_hash: payload.plan_hash,
    model_revision: payload.model_revision,
    risk_level: payload.risk_level,
    allowed_operations: structuredClone(payload.allowed_operations),
    review_context_hash: payload.review_context_hash,
    approved_by: payload.approved_by,
    approval_channel: payload.approval_channel,
    approved_at: payload.approved_at,
    expires_at: payload.expires_at
  };
}

function opaqueSha256(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function timingSafeStringEqual(left, right) {
  const supplied = Buffer.from(String(left || ''));
  const expected = Buffer.from(String(right || ''));
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function assertBinding(left, right, code) {
  for (const field of ['challenge_id', 'task_id', 'plan_id', 'plan_hash', 'model_revision', 'risk_level', 'review_context_hash', 'nonce', 'expires_at']) {
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

function deterministicChallengeId(idempotencyKey) {
  const key = requiredString(idempotencyKey, 'idempotencyKey');
  return `approval_${crypto.createHash('sha256').update(canonicalJson({ key })).digest('hex').slice(0, 32)}`;
}

function deterministicDecisionId(challengeId) {
  return `decision_${crypto.createHash('sha256').update(requiredString(challengeId, 'challengeId')).digest('hex').slice(0, 32)}`;
}

function assertChallengeBinding(existing, expected) {
  for (const field of ['version', 'kind', 'challenge_id', 'task_id', 'plan_id', 'plan_hash', 'model_revision', 'risk_level', 'review_context_hash']) {
    if ((existing?.[field] ?? null) !== (expected?.[field] ?? null)) {
      throw new AgentContractError('APPROVAL_INVALID', 'The idempotent approval challenge binding does not match its existing record.');
    }
  }
  if (canonicalJson(existing.allowed_operations) !== canonicalJson(expected.allowed_operations)) {
    throw new AgentContractError('APPROVAL_INVALID', 'The idempotent approval challenge operation scope does not match its existing record.');
  }
}

function normalizeReviewContext(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'reviewContext must be an object when provided.');
  }
  return structuredClone(value);
}

function normalizeReviewSelection(value, challenge, decision) {
  const options = Array.isArray(challenge.review_context?.decision_options)
    ? challenge.review_context.decision_options.map((entry) => String(entry?.value || entry)).filter(Boolean)
    : [];
  if (decision !== 'approved' || options.length === 0) return null;
  const selected = String(value || '');
  if (!options.includes(selected)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'The trusted user must select one of the review decisions bound to this challenge.');
  }
  return selected;
}

function approvalChallengeBindingHash(challenge) {
  return sha256Canonical({
    version: challenge.version,
    kind: challenge.kind,
    challenge_id: challenge.challenge_id,
    task_id: challenge.task_id,
    plan_id: challenge.plan_id,
    plan_hash: challenge.plan_hash,
    model_revision: challenge.model_revision,
    risk_level: challenge.risk_level,
    allowed_operations: challenge.allowed_operations,
    review_context_hash: challenge.review_context_hash || sha256Canonical(null),
    nonce: challenge.nonce,
    issued_at: challenge.issued_at,
    expires_at: challenge.expires_at
  });
}

function publicDecision(record) {
  if (!record) return null;
  const {
    approval_token: ignoredToken,
    approval_token_hash: ignoredTokenHash,
    decision_signature: ignoredDecisionSignature,
    ...publicRecord
  } = structuredClone(record);
  return publicRecord;
}

function invalidDecisionDisplay(challenge) {
  return {
    version: LOCAL_APPROVAL_DECISION_VERSION,
    kind: 'local_approval_decision_status',
    decision_id: deterministicDecisionId(challenge.challenge_id),
    challenge_id: challenge.challenge_id,
    task_id: challenge.task_id || null,
    plan_id: challenge.plan_id,
    decision: 'invalid',
    status: 'reauthorization_required',
    integrity: 'legacy_or_corrupt_unsigned_decision',
    executable: false
  };
}

function sha256Canonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function normalizeApprovalHostUrl(value) {
  let url;
  try {
    url = new URL(String(value || DEFAULT_APPROVAL_HOST_URL));
  } catch {
    throw new AgentContractError('INVALID_ARGUMENT', 'approvalHostUrl must be a valid local HTTP URL.');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new AgentContractError('POLICY_DENIED', 'The approval host URL must use HTTP on a loopback host.');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function boundedListLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 100;
  return Math.min(parsed, 500);
}

async function createJsonExclusive(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filePath);
}
