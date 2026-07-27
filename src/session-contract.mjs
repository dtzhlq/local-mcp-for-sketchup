import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson } from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';
import { PRODUCT_VERSION } from './version.mjs';

export const SESSION_CONTRACT_VERSION = 'session-contract.v1';
export const DEFAULT_HANDSHAKE_TTL_MS = 2 * 60 * 1000;
export const MAX_HANDSHAKE_TTL_MS = 5 * 60 * 1000;

export class SessionContractAuthority {
  constructor({
    stateDir = path.join(defaultStateDir, 'agent-contract-v1', 'session-contracts'),
    secret,
    now = () => Date.now(),
    serverVersion = PRODUCT_VERSION,
    serverSessionId = `server_${crypto.randomUUID()}`
  } = {}) {
    this.stateDir = path.resolve(stateDir);
    this.secretOverride = secret || process.env.LOCAL_MCP_FOR_SKETCHUP_SESSION_CONTRACT_SECRET || null;
    this.now = now;
    this.serverVersion = serverVersion;
    this.serverSessionId = serverSessionId;
    this.secretPromise = null;
  }

  async issue(runtimeState, { expiresInMs = defaultExpiryFromEnvironment() } = {}) {
    validateRuntimeState(runtimeState);
    if (runtimeState.queue_state !== 'idle') {
      throw new AgentContractError('QUEUE_NOT_IDLE', 'A fresh queue handshake can only be issued while the queue is idle.', {
        details: { queue_state: runtimeState.queue_state }
      });
    }
    const now = this.now();
    const payload = {
      version: SESSION_CONTRACT_VERSION,
      kind: 'fresh_queue_handshake',
      handshake_id: `handshake_${crypto.randomUUID()}`,
      runtime: 'queue',
      session_id: runtimeState.session_id,
      document_id: runtimeState.document_id,
      model_identity: structuredClone(runtimeState.model_identity),
      model_revision: runtimeState.model_revision,
      model_revision_strategy: runtimeState.model_revision_strategy,
      model_revision_unique_entity_limit: runtimeState.model_revision_unique_entity_limit,
      model_revision_complete: runtimeState.model_revision_complete,
      model_revision_total_seen: runtimeState.model_revision_total_seen,
      model_revision_indexed: runtimeState.model_revision_indexed,
      model_modified: runtimeState.model_modified,
      server_version: this.serverVersion,
      server_session_id: this.serverSessionId,
      plugin_version: runtimeState.plugin_version,
      queue_state: 'idle',
      capability_version: runtimeState.capability_version,
      manifest_version: runtimeState.manifest_version,
      dsl_version: runtimeState.dsl_version,
      occurrence_contract: runtimeState.occurrence_contract,
      boolean_operations_sha256: runtimeState.boolean_operations_sha256,
      model_revision_source_sha256: runtimeState.model_revision_source_sha256,
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + boundedExpiry(expiresInMs)).toISOString()
    };
    return {
      ...payload,
      signature: `hmac_sha256:${await this.sign(canonicalJson(payload))}`
    };
  }

  async verify(contract, { runtimeState, operation } = {}) {
    validateContractShape(contract);
    const payload = unsignedContract(contract);
    const expectedSignature = `hmac_sha256:${await this.sign(canonicalJson(payload))}`;
    const supplied = Buffer.from(contract.signature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      throw new AgentContractError('HANDSHAKE_INVALID', 'The fresh queue handshake signature is invalid.');
    }
    if (contract.server_version !== this.serverVersion) {
      throw new AgentContractError('HANDSHAKE_SERVER_VERSION_MISMATCH', 'The server version no longer matches the fresh queue handshake.', {
        details: { expected: contract.server_version, actual: this.serverVersion, operation: operation || null }
      });
    }
    if (contract.server_session_id !== this.serverSessionId) {
      throw new AgentContractError('HANDSHAKE_SERVER_RESTARTED', 'The MCP server session restarted after the fresh queue handshake.', {
        details: { operation: operation || null }
      });
    }
    if (Date.parse(contract.expires_at) <= this.now()) {
      throw new AgentContractError('HANDSHAKE_EXPIRED', 'The fresh queue handshake has expired.', {
        details: { expired_at: contract.expires_at, operation: operation || null }
      });
    }
    if (runtimeState) validateRuntimeBinding(contract, runtimeState, { operation });
    return contract;
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
      if (Buffer.byteLength(this.secretOverride) < 32) {
        throw new AgentContractError('POLICY_DENIED', 'The session-contract signing secret must be at least 32 bytes.');
      }
      return this.secretOverride;
    }
    const filePath = path.join(this.stateDir, 'session-contract-signing-secret');
    await fs.mkdir(this.stateDir, { recursive: true });
    try {
      return await readPersistedSecret(filePath);
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
      if (error?.code === 'EEXIST') return readPersistedSecret(filePath, { retry: true });
      throw error;
    }
  }
}

export function validateRuntimeBinding(contract, runtimeState, { operation } = {}) {
  validateRuntimeState(runtimeState);
  if (runtimeState.queue_state !== 'idle') {
    throw new AgentContractError('QUEUE_NOT_IDLE', 'The live queue is not idle at mutation authorization time.', {
      details: { queue_state: runtimeState.queue_state, operation: operation || null }
    });
  }
  compareBinding(contract, runtimeState, 'session_id', 'HANDSHAKE_SESSION_MISMATCH', 'The SketchUp plugin session restarted after the handshake.', operation);
  compareBinding(contract, runtimeState, 'document_id', 'HANDSHAKE_DOCUMENT_MISMATCH', 'The active SketchUp document changed after the handshake.', operation);
  if (canonicalJson(contract.model_identity) !== canonicalJson(runtimeState.model_identity)) {
    throw new AgentContractError('HANDSHAKE_MODEL_IDENTITY_MISMATCH', 'The active SketchUp model identity changed after the handshake.', {
      details: { expected: contract.model_identity, actual: runtimeState.model_identity, operation: operation || null }
    });
  }
  compareBinding(contract, runtimeState, 'model_revision', 'HANDSHAKE_MODEL_REVISION_MISMATCH', 'The active SketchUp model changed after the handshake.', operation);
  compareBinding(contract, runtimeState, 'model_modified', 'HANDSHAKE_MODEL_REVISION_MISMATCH', 'The active SketchUp model unsaved-change state changed after the handshake.', operation);
  compareBinding(contract, runtimeState, 'model_revision_strategy', 'HANDSHAKE_CAPABILITIES_MISMATCH', 'The live queue model revision strategy changed after the handshake.', operation);
  compareBinding(contract, runtimeState, 'model_revision_unique_entity_limit', 'HANDSHAKE_CAPABILITIES_MISMATCH', 'The live queue model revision safety limit changed after the handshake.', operation);
  compareBinding(contract, runtimeState, 'plugin_version', 'HANDSHAKE_PLUGIN_VERSION_MISMATCH', 'The SketchUp plugin version changed after the handshake.', operation);
  for (const field of ['capability_version', 'manifest_version', 'dsl_version', 'occurrence_contract', 'boolean_operations_sha256', 'model_revision_source_sha256', 'model_revision_complete', 'model_revision_total_seen', 'model_revision_indexed']) {
    compareBinding(contract, runtimeState, field, 'HANDSHAKE_CAPABILITIES_MISMATCH', 'The live queue capability contract changed after the handshake.', operation);
  }
}

function compareBinding(contract, runtimeState, field, code, message, operation) {
  if (contract[field] === runtimeState[field]) return;
  throw new AgentContractError(code, message, {
    details: { field, expected: contract[field], actual: runtimeState[field], operation: operation || null }
  });
}

function validateContractShape(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new AgentContractError('HANDSHAKE_REQUIRED', 'A fresh queue handshake is required for live mutation.');
  }
  if (contract.version !== SESSION_CONTRACT_VERSION || contract.kind !== 'fresh_queue_handshake' || contract.runtime !== 'queue') {
    throw new AgentContractError('HANDSHAKE_INVALID', 'The supplied session contract version or kind is unsupported.');
  }
  for (const field of [
    'handshake_id', 'session_id', 'document_id', 'model_revision', 'model_revision_strategy', 'server_version', 'server_session_id', 'plugin_version',
    'queue_state', 'capability_version', 'manifest_version', 'occurrence_contract', 'boolean_operations_sha256', 'model_revision_source_sha256', 'issued_at', 'expires_at', 'signature'
  ]) {
    if (typeof contract[field] !== 'string' || !contract[field]) {
      throw new AgentContractError('HANDSHAKE_INVALID', `The session contract field ${field} is missing or invalid.`);
    }
  }
  if (!contract.handshake_id.startsWith('handshake_') || contract.queue_state !== 'idle' || !contract.model_identity || typeof contract.model_identity !== 'object') {
    throw new AgentContractError('HANDSHAKE_INVALID', 'The session contract identity or queue state is invalid.');
  }
  if (contract.model_revision_complete !== true
    || !/^[0-9a-f]{64}$/.test(contract.boolean_operations_sha256)
    || !/^[0-9a-f]{64}$/.test(contract.model_revision_source_sha256)
    || typeof contract.model_modified !== 'boolean'
    || !Number.isInteger(contract.model_revision_unique_entity_limit)
    || contract.model_revision_unique_entity_limit < 1
    || !Number.isInteger(contract.model_revision_total_seen)
    || !Number.isInteger(contract.model_revision_indexed)
    || !Number.isInteger(contract.dsl_version)
    || !Number.isFinite(Date.parse(contract.issued_at))
    || !Number.isFinite(Date.parse(contract.expires_at))) {
    throw new AgentContractError('HANDSHAKE_INVALID', 'The session contract version or timestamps are invalid.');
  }
}

function validateRuntimeState(runtimeState) {
  if (!runtimeState || runtimeState.kind !== 'queue_session_state' || runtimeState.runtime !== 'queue') {
    throw new AgentContractError('HANDSHAKE_INVALID', 'The live queue did not return a compatible session state.');
  }
  for (const field of ['session_id', 'document_id', 'model_revision', 'model_revision_strategy', 'plugin_version', 'queue_state', 'capability_version', 'manifest_version', 'occurrence_contract', 'boolean_operations_sha256', 'model_revision_source_sha256']) {
    if (typeof runtimeState[field] !== 'string' || !runtimeState[field]) {
      throw new AgentContractError('HANDSHAKE_INVALID', `The live queue session state field ${field} is missing or invalid.`);
    }
  }
  if (runtimeState.model_revision_complete !== true) {
    throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'The live model does not have a complete revision binding.', {
      details: {
        strategy: runtimeState.model_revision_strategy || 'legacy_recursive_index',
        unique_entity_limit: runtimeState.model_revision_unique_entity_limit ?? null,
        total_seen: runtimeState.model_revision_total_seen,
        indexed: runtimeState.model_revision_indexed,
        unique_entities: runtimeState.model_revision_unique_entities ?? null,
        blockers: Array.isArray(runtimeState.model_revision_blockers) ? runtimeState.model_revision_blockers : []
      }
    });
  }
  if (!Number.isInteger(runtimeState.model_revision_total_seen)
    || !Number.isInteger(runtimeState.model_revision_indexed)
    || runtimeState.model_revision_total_seen !== runtimeState.model_revision_indexed
    || !Number.isInteger(runtimeState.model_revision_unique_entity_limit)
    || runtimeState.model_revision_unique_entity_limit < 1
    || !Number.isInteger(runtimeState.dsl_version)
    || !runtimeState.model_identity
    || typeof runtimeState.model_identity !== 'object'
    || typeof runtimeState.model_modified !== 'boolean'
    || !/^[0-9a-f]{64}$/.test(runtimeState.boolean_operations_sha256)
    || !/^[0-9a-f]{64}$/.test(runtimeState.model_revision_source_sha256)) {
    throw new AgentContractError('HANDSHAKE_INVALID', 'The live queue session state identity or DSL version is invalid.');
  }
}

function unsignedContract(contract) {
  const { signature, ...payload } = contract;
  return payload;
}

function boundedExpiry(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > MAX_HANDSHAKE_TTL_MS) {
    throw new AgentContractError('INVALID_ARGUMENT', `Fresh queue handshake expiry must be between 1 second and ${MAX_HANDSHAKE_TTL_MS} milliseconds.`);
  }
  return Math.floor(parsed);
}

function defaultExpiryFromEnvironment() {
  const raw = process.env.LOCAL_MCP_FOR_SKETCHUP_HANDSHAKE_TTL_MS;
  if (!raw) return DEFAULT_HANDSHAKE_TTL_MS;
  return Number(raw);
}

async function readPersistedSecret(filePath, { retry = false } = {}) {
  const attempts = retry ? 10 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const secret = (await fs.readFile(filePath, 'utf8')).trim();
    if (Buffer.byteLength(secret) >= 32) return secret;
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new AgentContractError('POLICY_DENIED', 'The persisted session-contract signing secret is missing or too short.');
}
