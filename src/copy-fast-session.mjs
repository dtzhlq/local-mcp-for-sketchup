import crypto from 'node:crypto';
import {
  AgentContractError,
  copyFastTrustedScopeBindingHash,
  sha256Canonical
} from './agent-contract.mjs';

export const COPY_FAST_SESSION_VERSION = 'copy-fast-session.v1';
export const COPY_FAST_SESSION_SUMMARY_VERSION = 'copy-fast-session-summary.v1';
export const DEFAULT_COPY_FAST_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const MIN_COPY_FAST_SESSION_TTL_MS = 5 * 60 * 1000;
export const MAX_COPY_FAST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const MODEL_KEY_PATTERN = /^model_[0-9a-f]{32}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SESSION_ID_PATTERN = /^copy_session_[0-9a-f-]+$/;
const RUNTIMES = new Set(['mock', 'queue']);

/**
 * Server-owned, process-lifetime authorization scope for a verified model copy.
 *
 * A model-facing Agent cannot create or revive a session. The authority only
 * activates after the existing server execution policy has matched the
 * canonical model source path to a configured copy root. Restarting the server
 * drops every active session, so a plan created before restart cannot silently
 * inherit a new process' copy scope.
 */
export class CopyFastSessionAuthority {
  constructor({
    now = () => Date.now(),
    authoritySessionId = `copy_authority_${crypto.randomUUID()}`
  } = {}) {
    this.now = now;
    this.authoritySessionId = String(authoritySessionId);
    this.sessionsById = new Map();
    this.sessionIdsByScope = new Map();
  }

  resolveOrCreate({
    scopeBinding,
    modelKey,
    modelRevision,
    runtime,
    sessionTtlMs = DEFAULT_COPY_FAST_SESSION_TTL_MS
  } = {}) {
    assertActivationInput({ scopeBinding, modelKey, modelRevision, runtime });
    const ttlMs = boundedSessionTtl(sessionTtlMs);
    const scopeKey = sessionScopeKey({
      authoritySessionId: this.authoritySessionId,
      scopeBinding,
      modelKey,
      runtime
    });
    const existingId = this.sessionIdsByScope.get(scopeKey);
    const existing = existingId ? this.sessionsById.get(existingId) : null;
    if (existing && Date.parse(existing.binding.expires_at) > this.now()) {
      existing.last_used_at = new Date(this.now()).toISOString();
      existing.use_count += 1;
      return {
        binding: structuredClone(existing.binding),
        summary: publicCopyFastSessionSummary(existing.binding, { reused: true })
      };
    }
    if (existingId) this.removeSession(existingId);

    const issuedAt = this.now();
    const core = {
      version: COPY_FAST_SESSION_VERSION,
      kind: 'copy_fast_session',
      session_id: `copy_session_${crypto.randomUUID()}`,
      authority_session_id: this.authoritySessionId,
      policy_scope_fingerprint: scopeBinding.policy_scope_fingerprint,
      trusted_scope_binding_hash: copyFastTrustedScopeBindingHash(scopeBinding),
      source_path_fingerprint: scopeBinding.source_path_fingerprint,
      matched_root_fingerprint: scopeBinding.matched_root_fingerprint,
      model_key: modelKey,
      runtime,
      initial_model_revision: modelRevision,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(issuedAt + ttlMs).toISOString()
    };
    const binding = { ...core, binding_hash: sha256Canonical(core) };
    this.sessionsById.set(binding.session_id, {
      binding,
      scope_key: scopeKey,
      use_count: 1,
      last_used_at: binding.issued_at
    });
    this.sessionIdsByScope.set(scopeKey, binding.session_id);
    return {
      binding: structuredClone(binding),
      summary: publicCopyFastSessionSummary(binding, { reused: false })
    };
  }

  verify(binding, { scopeBinding, modelKey, runtime } = {}) {
    assertBinding(binding);
    assertScopeBinding(scopeBinding);
    if (binding.authority_session_id !== this.authoritySessionId) {
      throw denied('The Copy Fast session belongs to a different server process.');
    }
    const stored = this.sessionsById.get(binding.session_id);
    if (!stored || sha256Canonical(stored.binding) !== sha256Canonical(binding)) {
      throw denied('The Copy Fast session is not active in this server process.');
    }
    if (Date.parse(binding.expires_at) <= this.now()) {
      this.removeSession(binding.session_id);
      throw denied('The Copy Fast session expired; prepare a new edit plan for the verified copy.');
    }
    if (binding.policy_scope_fingerprint !== scopeBinding.policy_scope_fingerprint
      || binding.trusted_scope_binding_hash !== copyFastTrustedScopeBindingHash(scopeBinding)
      || binding.source_path_fingerprint !== scopeBinding.source_path_fingerprint
      || binding.matched_root_fingerprint !== scopeBinding.matched_root_fingerprint
      || binding.model_key !== modelKey
      || binding.runtime !== runtime) {
      throw denied('The active model or server copy policy no longer matches the Copy Fast session.');
    }
    stored.last_used_at = new Date(this.now()).toISOString();
    stored.use_count += 1;
    return publicCopyFastSessionSummary(binding, { reused: true });
  }

  revoke(sessionId) {
    if (!SESSION_ID_PATTERN.test(String(sessionId || ''))) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Copy Fast session_id is invalid.');
    }
    return this.removeSession(sessionId);
  }

  removeSession(sessionId) {
    const stored = this.sessionsById.get(sessionId);
    if (!stored) return false;
    this.sessionsById.delete(sessionId);
    if (this.sessionIdsByScope.get(stored.scope_key) === sessionId) {
      this.sessionIdsByScope.delete(stored.scope_key);
    }
    return true;
  }
}

export function publicCopyFastSessionSummary(binding, { reused = false } = {}) {
  if (!binding) return null;
  assertBinding(binding);
  return {
    version: COPY_FAST_SESSION_SUMMARY_VERSION,
    status: 'active',
    session_id: binding.session_id,
    model_key: binding.model_key,
    runtime: binding.runtime,
    issued_at: binding.issued_at,
    expires_at: binding.expires_at,
    reused: reused === true,
    user_action_required: false,
    agent_can_enable: false,
    local_paths_exposed: false
  };
}

export function copyFastSessionBindingValid(binding) {
  try {
    assertBinding(binding);
    return true;
  } catch {
    return false;
  }
}

export function boundedSessionTtl(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_COPY_FAST_SESSION_TTL_MS;
  return Math.max(MIN_COPY_FAST_SESSION_TTL_MS, Math.min(parsed, MAX_COPY_FAST_SESSION_TTL_MS));
}

function assertActivationInput({ scopeBinding, modelKey, modelRevision, runtime }) {
  assertScopeBinding(scopeBinding);
  if (!MODEL_KEY_PATTERN.test(String(modelKey || ''))
    || !HASH_PATTERN.test(String(modelRevision || ''))
    || !RUNTIMES.has(runtime)) {
    throw denied('Copy Fast activation requires a complete model identity, revision, and supported runtime.');
  }
}

function assertScopeBinding(binding) {
  if (!binding
    || binding.version !== 'trusted-model-copy-auto-approval.v1'
    || binding.mode !== 'server_user_execution_policy'
    || !HASH_PATTERN.test(String(binding.policy_scope_fingerprint || ''))
    || !HASH_PATTERN.test(String(binding.source_path_fingerprint || ''))
    || !HASH_PATTERN.test(String(binding.matched_root_fingerprint || ''))
    || !HASH_PATTERN.test(String(binding.binding_hash || ''))) {
    throw denied('Copy Fast activation requires a server-verified trusted-copy scope.');
  }
  const { binding_hash: ignored, ...core } = binding;
  if (binding.binding_hash !== sha256Canonical(core)) {
    throw denied('The trusted-copy scope binding failed integrity validation.');
  }
}

function assertBinding(binding) {
  if (!binding
    || binding.version !== COPY_FAST_SESSION_VERSION
    || binding.kind !== 'copy_fast_session'
    || !SESSION_ID_PATTERN.test(String(binding.session_id || ''))
    || typeof binding.authority_session_id !== 'string'
    || !binding.authority_session_id
    || !HASH_PATTERN.test(String(binding.policy_scope_fingerprint || ''))
    || !HASH_PATTERN.test(String(binding.trusted_scope_binding_hash || ''))
    || !HASH_PATTERN.test(String(binding.source_path_fingerprint || ''))
    || !HASH_PATTERN.test(String(binding.matched_root_fingerprint || ''))
    || !MODEL_KEY_PATTERN.test(String(binding.model_key || ''))
    || !RUNTIMES.has(binding.runtime)
    || !HASH_PATTERN.test(String(binding.initial_model_revision || ''))
    || !Number.isFinite(Date.parse(binding.issued_at))
    || !Number.isFinite(Date.parse(binding.expires_at))
    || Date.parse(binding.expires_at) <= Date.parse(binding.issued_at)
    || !HASH_PATTERN.test(String(binding.binding_hash || ''))) {
    throw denied('The Copy Fast session binding is invalid.');
  }
  const { binding_hash: ignored, ...core } = binding;
  if (binding.binding_hash !== sha256Canonical(core)) {
    throw denied('The Copy Fast session binding failed integrity validation.');
  }
}

function sessionScopeKey({ authoritySessionId, scopeBinding, modelKey, runtime }) {
  return sha256Canonical({
    kind: 'copy_fast_session_scope',
    authority_session_id: authoritySessionId,
    policy_scope_fingerprint: scopeBinding.policy_scope_fingerprint,
    source_path_fingerprint: scopeBinding.source_path_fingerprint,
    matched_root_fingerprint: scopeBinding.matched_root_fingerprint,
    model_key: modelKey,
    runtime
  });
}

function denied(message) {
  return new AgentContractError('POLICY_DENIED', message, {
    nextAction: { action: 'prepare_new_plan', reason: 'copy_fast_session_invalid' }
  });
}
