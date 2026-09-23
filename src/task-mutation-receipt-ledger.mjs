import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';

export const TASK_MUTATION_RECEIPT_VERSION = 'task-mutation-receipt.v1';
export const TASK_MUTATION_FINALIZER_VERSION = 'task-mutation-finalizer.v1';

const TASK_ID_PATTERN = /^task_[0-9a-f-]+$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MODEL_KEY_PATTERN = /^model_[0-9a-f]{32}$/;
const CLAIM_ID_PATTERN = /^[0-9a-f]{64}$/;
const RISK_LEVELS = new Set(['S1', 'S2', 'S3', 'S4']);
const RUNTIMES = new Set(['mock', 'queue']);

/**
 * Private, server-owned proof that a mutating Gateway request returned a
 * trusted commit/application receipt. The HMAC key is local state and never
 * appears in a task or result envelope, so editing the JSON record cannot
 * manufacture a recoverable commit.
 */
export class TaskMutationReceiptLedger {
  constructor({ rootDir } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) {
      throw new AgentContractError('INVALID_ARGUMENT', 'mutation receipt rootDir must be a non-empty string.');
    }
    this.rootDir = path.resolve(rootDir);
    this.receiptsDir = path.join(this.rootDir, 'receipts');
    this.secretPath = path.join(this.rootDir, 'ledger-secret.bin');
    this.secretPromise = null;
  }

  async record({ task, claim, binding, bridgeReceipt, finalizer } = {}) {
    assertRecordInputs({ task, claim, binding, bridgeReceipt, finalizer });
    const claimId = claimIdForPath(claim.filePath);
    const now = new Date().toISOString();
    const core = {
      version: TASK_MUTATION_RECEIPT_VERSION,
      kind: 'agent_task_mutation_receipt',
      receipt_id: receiptId({
        task_id: task.task_id,
        request_fingerprint: claim.record.fingerprint,
        plan_hash: binding.plan_hash,
        model_revision_after: binding.model_revision_after,
        bridge_receipt_hash: bridgeReceipt.receipt_hash
      }),
      task_id: task.task_id,
      operation: claim.record.operation,
      idempotency_claim_id: claimId,
      request_fingerprint: claim.record.fingerprint,
      task_version_at_claim: claim.record.task_version_at_claim,
      task_state_at_claim: claim.record.task_state_at_claim,
      plan_id: binding.plan_id,
      plan_hash: binding.plan_hash,
      model_key: binding.model_key,
      model_revision_before: binding.model_revision_before,
      model_revision_after: binding.model_revision_after,
      risk_level: binding.risk_level,
      runtime: binding.runtime,
      bridge_receipt: structuredClone(bridgeReceipt),
      finalizer: structuredClone(finalizer),
      recorded_at: now
    };
    const payloadHash = sha256Canonical(core);
    const unsigned = { ...core, payload_hash: payloadHash };
    const record = { ...unsigned, integrity_hmac: await this.sign(unsigned) };
    const filePath = this.receiptPath(task.task_id);
    await ensurePrivateDirectory(this.rootDir);
    await ensurePrivateDirectory(this.receiptsDir);
    try {
      await createJsonExclusive(filePath, record);
      await syncDirectory(this.receiptsDir);
      return structuredClone(record);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await this.load(task.task_id);
      if (!sameImmutableReceipt(existing, record)) {
        throw invalidReceipt('A different mutation receipt is already bound to this task.');
      }
      return existing;
    }
  }

  async load(taskId, { allowMissing = false } = {}) {
    assertTaskId(taskId);
    let record;
    try {
      record = JSON.parse(await readPrivateFile(this.receiptPath(taskId), { encoding: 'utf8' }));
    } catch (error) {
      if (error?.code === 'ENOENT' && allowMissing) return null;
      if (error?.code === 'ENOENT') throw invalidReceipt('The task mutation receipt is missing.');
      if (error instanceof SyntaxError) throw invalidReceipt('The task mutation receipt is not valid JSON.');
      throw error;
    }
    await this.verify(record, { taskId });
    return structuredClone(record);
  }

  async verify(record, { taskId, claimRecord } = {}) {
    assertReceiptShape(record);
    if (taskId && record.task_id !== taskId) {
      throw invalidReceipt('The task mutation receipt is bound to a different task.');
    }
    const { integrity_hmac: actualHmac, ...unsigned } = record;
    if (record.payload_hash !== sha256Canonical(unsignedWithoutPayloadHash(unsigned))) {
      throw invalidReceipt('The task mutation receipt payload hash does not match its content.');
    }
    const expectedHmac = await this.sign(unsigned);
    if (!safeEqual(actualHmac, expectedHmac)) {
      throw invalidReceipt('The task mutation receipt failed server integrity verification.');
    }
    if (claimRecord) assertReceiptMatchesClaim(record, claimRecord);
    return true;
  }

  receiptPath(taskId) {
    assertTaskId(taskId);
    return path.join(this.receiptsDir, `${taskId}.json`);
  }

  async sign(value) {
    const secret = await this.secret();
    return `sha256:${crypto.createHmac('sha256', secret).update(canonicalJson(value)).digest('hex')}`;
  }

  async secret() {
    if (!this.secretPromise) this.secretPromise = loadOrCreateSecret(this.secretPath);
    return this.secretPromise;
  }
}

export function trustedBridgeReceipt({ runtime, nativeReceipt, appliedResult } = {}) {
  if (!RUNTIMES.has(runtime)) throw invalidReceipt('The bridge receipt runtime is invalid.');
  let core;
  if (runtime === 'queue') {
    if (!nativeReceipt
      || !hasExactKeys(nativeReceipt, ['version', 'kind', 'operation', 'commit_state', 'committed_at'])
      || nativeReceipt.version !== 'mutation-receipt.v1'
      || nativeReceipt.kind !== 'sketchup_mutation_receipt'
      || nativeReceipt.commit_state !== 'committed'
      || typeof nativeReceipt.operation !== 'string'
      || !nativeReceipt.operation
      || !Number.isFinite(Date.parse(nativeReceipt.committed_at))) {
      throw invalidReceipt('A confirmed native SketchUp commit receipt is required for queue recovery.');
    }
    core = {
      version: 'trusted-bridge-mutation-receipt.v1',
      kind: 'trusted_sketchup_commit_receipt',
      source: 'sketchup_plugin',
      runtime,
      native_receipt: structuredClone(nativeReceipt),
      commit_state: 'committed'
    };
  } else {
    if (!appliedResult || appliedResult.ok !== true || appliedResult.kind !== 'apply_reviewed_model_edit') {
      throw invalidReceipt('A successful trusted mock application result is required for mock recovery.');
    }
    core = {
      version: 'trusted-bridge-mutation-receipt.v1',
      kind: 'trusted_mock_application_receipt',
      source: 'mock_runtime',
      runtime,
      application_result_hash: sha256Canonical(appliedResult),
      commit_state: 'committed'
    };
  }
  return { ...core, receipt_hash: sha256Canonical(core) };
}

export function assertReceiptMatchesClaim(record, claimRecord) {
  const boundTaskId = claimRecord?.bound_task_id || claimRecord?.task_id || null;
  if (!claimRecord
    || record.request_fingerprint !== claimRecord.fingerprint
    || record.operation !== claimRecord.operation
    || boundTaskId !== record.task_id) {
    throw invalidReceipt('The task mutation receipt does not match the idempotency claim.');
  }
}

function assertRecordInputs({ task, claim, binding, bridgeReceipt, finalizer }) {
  assertTaskId(task?.task_id);
  if (!['executing', 'verifying'].includes(task?.state)) {
    throw invalidReceipt('A mutation receipt can only be recorded after execution starts.');
  }
  if (!claim?.filePath || claim.disabled || claim.replayed || !claim.record) {
    throw invalidReceipt('A live idempotency claim is required to bind a mutation receipt.');
  }
  if (claim.record.operation !== 'submit_agent_task_input'
    || !['awaiting_review', 'approved'].includes(claim.record.task_state_at_claim)) {
    throw invalidReceipt('The mutation receipt claim is not a reviewed submit operation.');
  }
  assertReceiptMatchesClaim({
    request_fingerprint: claim.record.fingerprint,
    operation: claim.record.operation,
    task_id: task.task_id
  }, claim.record);
  if (binding?.plan_id === undefined || typeof binding.plan_id !== 'string' || !binding.plan_id) {
    throw invalidReceipt('The mutation receipt plan id is missing.');
  }
  if (!SHA256_PATTERN.test(String(binding.plan_hash || ''))
    || !MODEL_KEY_PATTERN.test(String(binding.model_key || ''))
    || !SHA256_PATTERN.test(String(binding.model_revision_before || ''))
    || !SHA256_PATTERN.test(String(binding.model_revision_after || ''))
    || !RISK_LEVELS.has(binding.risk_level)
    || !RUNTIMES.has(binding.runtime)) {
    throw invalidReceipt('The mutation receipt plan/model binding is invalid.');
  }
  assertBridgeReceipt(bridgeReceipt, binding.runtime);
  if (!finalizer
    || finalizer.version !== TASK_MUTATION_FINALIZER_VERSION
    || !['reviewed_existing_model_edit', 'committed_assembly_replacement'].includes(finalizer.kind)
    || !finalizer.applied_result
    || finalizer.applied_result.kind !== 'apply_reviewed_model_edit'
    || !validFinalizerState(finalizer, binding.runtime)
    || finalizer.applied_result.plan_id !== binding.plan_id
    || finalizer.applied_result.model_revision_before !== binding.model_revision_before
    || (finalizer.applied_result.model_key !== undefined
      && finalizer.applied_result.model_key !== binding.model_key)) {
    throw invalidReceipt('The mutation receipt finalizer payload is invalid.');
  }
}

function assertReceiptShape(record) {
  const keys = Object.keys(record || {}).sort();
  const expected = [
    'bridge_receipt', 'finalizer', 'idempotency_claim_id', 'integrity_hmac', 'kind',
    'model_key', 'model_revision_after', 'model_revision_before', 'operation',
    'payload_hash', 'plan_hash', 'plan_id', 'receipt_id', 'recorded_at',
    'request_fingerprint', 'risk_level', 'runtime', 'task_id', 'task_state_at_claim',
    'task_version_at_claim', 'version'
  ].sort();
  if (canonicalJson(keys) !== canonicalJson(expected)
    || record.version !== TASK_MUTATION_RECEIPT_VERSION
    || record.kind !== 'agent_task_mutation_receipt'
    || !/^mutation-receipt-[0-9a-f]{24}$/.test(String(record.receipt_id || ''))
    || !TASK_ID_PATTERN.test(String(record.task_id || ''))
    || record.operation !== 'submit_agent_task_input'
    || !CLAIM_ID_PATTERN.test(String(record.idempotency_claim_id || ''))
    || !SHA256_PATTERN.test(String(record.request_fingerprint || ''))
    || !Number.isInteger(record.task_version_at_claim)
    || record.task_version_at_claim < 1
    || !['awaiting_review', 'approved'].includes(record.task_state_at_claim)
    || typeof record.plan_id !== 'string'
    || !record.plan_id
    || !SHA256_PATTERN.test(String(record.plan_hash || ''))
    || !MODEL_KEY_PATTERN.test(String(record.model_key || ''))
    || !SHA256_PATTERN.test(String(record.model_revision_before || ''))
    || !SHA256_PATTERN.test(String(record.model_revision_after || ''))
    || !RISK_LEVELS.has(record.risk_level)
    || !RUNTIMES.has(record.runtime)
    || !Number.isFinite(Date.parse(record.recorded_at))
    || !SHA256_PATTERN.test(String(record.payload_hash || ''))
    || !SHA256_PATTERN.test(String(record.integrity_hmac || ''))) {
    throw invalidReceipt('The task mutation receipt has an invalid shape.');
  }
  assertBridgeReceipt(record.bridge_receipt, record.runtime);
  if (!record.finalizer
    || canonicalJson(Object.keys(record.finalizer).sort()) !== canonicalJson(['applied_result', 'kind', 'version'])
    || record.finalizer.version !== TASK_MUTATION_FINALIZER_VERSION
    || !['reviewed_existing_model_edit', 'committed_assembly_replacement'].includes(record.finalizer.kind)
    || record.finalizer.applied_result?.kind !== 'apply_reviewed_model_edit'
    || !validFinalizerState(record.finalizer, record.runtime)
    || record.finalizer.applied_result?.plan_id !== record.plan_id
    || record.finalizer.applied_result?.model_revision_before !== record.model_revision_before
    || (record.finalizer.applied_result?.model_key !== undefined
      && record.finalizer.applied_result.model_key !== record.model_key)) {
    throw invalidReceipt('The task mutation receipt finalizer is invalid.');
  }
}

function assertBridgeReceipt(receipt, runtime) {
  const { receipt_hash: actualHash, ...core } = receipt || {};
  if (!receipt
    || receipt.version !== 'trusted-bridge-mutation-receipt.v1'
    || receipt.runtime !== runtime
    || receipt.commit_state !== 'committed'
    || !SHA256_PATTERN.test(String(actualHash || ''))
    || actualHash !== sha256Canonical(core)) {
    throw invalidReceipt('The trusted bridge receipt is invalid.');
  }
  if (runtime === 'queue') {
    const native = receipt.native_receipt;
    if (!hasExactKeys(receipt, ['version', 'kind', 'source', 'runtime', 'native_receipt', 'commit_state', 'receipt_hash'])
      || !hasExactKeys(native, ['version', 'kind', 'operation', 'commit_state', 'committed_at'])
      || receipt.kind !== 'trusted_sketchup_commit_receipt'
      || receipt.source !== 'sketchup_plugin'
      || native?.version !== 'mutation-receipt.v1'
      || native?.kind !== 'sketchup_mutation_receipt'
      || native?.commit_state !== 'committed'
      || typeof native?.operation !== 'string'
      || !native.operation
      || !Number.isFinite(Date.parse(native.committed_at))) {
      throw invalidReceipt('The native SketchUp commit receipt is invalid.');
    }
  } else if (!hasExactKeys(receipt, ['version', 'kind', 'source', 'runtime', 'application_result_hash', 'commit_state', 'receipt_hash'])
    || receipt.kind !== 'trusted_mock_application_receipt'
    || receipt.source !== 'mock_runtime'
    || !SHA256_PATTERN.test(String(receipt.application_result_hash || ''))) {
    throw invalidReceipt('The trusted mock application receipt is invalid.');
  }
}

function unsignedWithoutPayloadHash(unsigned) {
  const clone = structuredClone(unsigned);
  delete clone.payload_hash;
  return clone;
}

function sameImmutableReceipt(left, right) {
  return left.task_id === right.task_id
    && left.receipt_id === right.receipt_id
    && left.operation === right.operation
    && left.idempotency_claim_id === right.idempotency_claim_id
    && left.request_fingerprint === right.request_fingerprint
    && left.task_version_at_claim === right.task_version_at_claim
    && left.task_state_at_claim === right.task_state_at_claim
    && left.plan_id === right.plan_id
    && left.plan_hash === right.plan_hash
    && left.model_key === right.model_key
    && left.model_revision_before === right.model_revision_before
    && left.model_revision_after === right.model_revision_after
    && left.risk_level === right.risk_level
    && left.runtime === right.runtime
    && left.bridge_receipt.receipt_hash === right.bridge_receipt.receipt_hash
    && sha256Canonical(left.finalizer) === sha256Canonical(right.finalizer);
}

function receiptId(value) {
  return `mutation-receipt-${sha256Canonical(value).slice(7, 31)}`;
}

function claimIdForPath(filePath) {
  const name = path.basename(String(filePath || ''), '.json');
  if (!CLAIM_ID_PATTERN.test(name)) throw invalidReceipt('The idempotency claim path is invalid.');
  return name;
}

function assertTaskId(taskId) {
  if (!TASK_ID_PATTERN.test(String(taskId || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'task_id has an invalid format.');
  }
}

function invalidReceipt(message) {
  return new AgentContractError('MUTATION_RECEIPT_INVALID', message);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasExactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

async function loadOrCreateSecret(secretPath) {
  await ensurePrivateDirectory(path.dirname(secretPath));
  try {
    const secret = await readPrivateFile(secretPath);
    if (secret.length !== 32) throw invalidReceipt('The local mutation receipt ledger secret is invalid.');
    return secret;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const secret = crypto.randomBytes(32);
  const temporary = `${secretPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(secret);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.link(temporary, secretPath);
    await syncDirectory(path.dirname(secretPath));
    return secret;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readPrivateFile(secretPath);
    if (existing.length !== 32) throw invalidReceipt('The local mutation receipt ledger secret is invalid.');
    return existing;
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

async function createJsonExclusive(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.link(temporary, filePath);
    await fs.chmod(filePath, 0o600);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw invalidReceipt('The mutation receipt ledger directory is not a private real directory.');
  }
  await fs.chmod(directory, 0o700);
}

async function readPrivateFile(filePath, { encoding = null } = {}) {
  let handle;
  try {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
    handle = await fs.open(filePath, flags);
    const stat = await handle.stat();
    if (!stat.isFile()) throw invalidReceipt('The mutation receipt ledger file is not a regular file.');
    await handle.chmod(0o600);
    return handle.readFile(encoding ? { encoding } : undefined);
  } catch (error) {
    if (error?.code === 'ELOOP') throw invalidReceipt('The mutation receipt ledger refused a symlink.');
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function validFinalizerState(finalizer, runtime) {
  if (finalizer.kind === 'reviewed_existing_model_edit') return finalizer.applied_result?.ok === true;
  const result = finalizer.applied_result;
  return runtime === 'queue' && result?.ok === false && result.verification_pending === true
    && result.assembly_scope_baseline && !Array.isArray(result.assembly_scope_baseline)
    && typeof result.assembly_scope_baseline === 'object'
    && Object.entries(result.assembly_scope_baseline).every(([path, hash]) => /^pid:[1-9]\d*$/.test(path) && SHA256_PATTERN.test(hash));
}
