import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { normalizeClientCapabilities, normalizeExecutionPolicy, sha256Canonical } from '../src/agent-contract.mjs';
import { AgentTaskStore } from '../src/agent-task-store.mjs';
import {
  TASK_MUTATION_FINALIZER_VERSION,
  TaskMutationReceiptLedger,
  trustedBridgeReceipt
} from '../src/task-mutation-receipt-ledger.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-task-mutation-receipt-'));
try {
  const store = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: 50 });
  const created = await store.createTask({
    intent: 'reviewed_existing_model_edit',
    instruction: 'Apply the reviewed edit once.',
    clientCapabilities: normalizeClientCapabilities(),
    executionPolicy: normalizeExecutionPolicy({ allowed_runtimes: ['mock'] }),
    inputs: { runtime: 'mock' }
  });
  await store.transition(created.task.task_id, 'understanding');
  await store.transition(created.task.task_id, 'awaiting_review');
  const input = { approval_token: 'opaque-trusted-token' };
  const claim = await store.claimTaskOperation({
    taskId: created.task.task_id,
    operation: 'submit_agent_task_input',
    idempotencyKey: 'task-mutation-ledger-test',
    input
  });
  await store.transition(created.task.task_id, 'approved');
  await store.transition(created.task.task_id, 'executing');

  const binding = {
    plan_id: 'plan-ledger-test',
    plan_hash: sha256Canonical({ plan: 'ledger-test' }),
    model_key: `model_${'1'.repeat(32)}`,
    model_revision_before: sha256Canonical({ revision: 'before' }),
    model_revision_after: sha256Canonical({ revision: 'after' }),
    risk_level: 'S2',
    runtime: 'mock'
  };
  const appliedResult = {
    kind: 'apply_reviewed_model_edit',
    ok: true,
    plan_id: binding.plan_id,
    model_key: binding.model_key,
    model_revision_before: binding.model_revision_before,
    artifacts: {}
  };
  const bridgeReceipt = trustedBridgeReceipt({ runtime: 'mock', appliedResult });
  const nativeQueueReceipt = {
    version: 'mutation-receipt.v1',
    kind: 'sketchup_mutation_receipt',
    operation: 'Alma Build Model',
    commit_state: 'committed',
    committed_at: new Date().toISOString()
  };
  const queueBridgeReceipt = trustedBridgeReceipt({ runtime: 'queue', nativeReceipt: nativeQueueReceipt });
  assert.equal(queueBridgeReceipt.kind, 'trusted_sketchup_commit_receipt');
  assert.throws(
    () => trustedBridgeReceipt({ runtime: 'queue', nativeReceipt: { ...nativeQueueReceipt, commit_state: 'outcome_unknown' } }),
    (error) => error.code === 'MUTATION_RECEIPT_INVALID'
  );
  const finalizer = {
    version: TASK_MUTATION_FINALIZER_VERSION,
    kind: 'reviewed_existing_model_edit',
    applied_result: appliedResult
  };
  const receipt = await store.recordTaskMutationReceipt({
    taskId: created.task.task_id,
    claim,
    binding,
    bridgeReceipt,
    finalizer
  });

  const receiptPath = store.mutationReceiptLedger.receiptPath(created.task.task_id);
  const secretPath = store.mutationReceiptLedger.secretPath;
  assert.equal((await fs.stat(receiptPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(secretPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(receiptPath))).mode & 0o777, 0o700);
  assert.equal(JSON.stringify(receipt).includes(input.approval_token), false, 'receipt must not persist approval credentials');
  assert.equal(JSON.stringify(receipt).includes('idempotency_key'), false, 'receipt must not persist raw idempotency keys');

  const schema = JSON.parse(await fs.readFile(path.resolve('schema/task-mutation-receipt-v1.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  assert.equal(ajv.validate(schema, receipt), true, JSON.stringify(ajv.errors));

  const restartedStore = new AgentTaskStore({ rootDir: root, idempotencyLeaseMs: 50 });
  assert.deepEqual(await restartedStore.loadTaskMutationReceipt(created.task.task_id), receipt, 'receipt must survive process restart');
  assert.deepEqual(await restartedStore.recordTaskMutationReceipt({
    taskId: created.task.task_id,
    claim,
    binding,
    bridgeReceipt,
    finalizer
  }), receipt, 'identical receipt recording must be idempotent');

  await assert.rejects(
    restartedStore.recordTaskMutationReceipt({
      taskId: created.task.task_id,
      claim,
      binding: { ...binding, model_revision_after: sha256Canonical({ revision: 'forged-after' }) },
      bridgeReceipt,
      finalizer
    }),
    (error) => error.code === 'MUTATION_RECEIPT_INVALID'
  );
  await assert.rejects(
    restartedStore.recordTaskMutationReceipt({
      taskId: created.task.task_id,
      claim,
      binding,
      bridgeReceipt,
      finalizer: { ...finalizer, applied_result: { ...appliedResult, plan_id: 'forged-plan' } }
    }),
    (error) => error.code === 'MUTATION_RECEIPT_INVALID'
  );

  const original = await fs.readFile(receiptPath, 'utf8');
  const tampered = JSON.parse(original);
  tampered.model_revision_after = sha256Canonical({ revision: 'tampered' });
  await fs.writeFile(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(
    restartedStore.loadTaskMutationReceipt(created.task.task_id),
    (error) => error.code === 'MUTATION_RECEIPT_INVALID'
  );
  await fs.writeFile(receiptPath, original, { mode: 0o600 });

  const symlinkTarget = path.join(root, 'receipt-symlink-target.json');
  await fs.writeFile(symlinkTarget, original, { mode: 0o600 });
  await fs.unlink(receiptPath);
  await fs.symlink(symlinkTarget, receiptPath);
  await assert.rejects(
    restartedStore.loadTaskMutationReceipt(created.task.task_id),
    (error) => error.code === 'MUTATION_RECEIPT_INVALID'
  );
  await fs.unlink(receiptPath);
  await fs.writeFile(receiptPath, original, { mode: 0o600 });

  const secretSymlinkRoot = path.join(root, 'secret-symlink-ledger');
  const secretTarget = path.join(root, 'secret-target.bin');
  await fs.mkdir(secretSymlinkRoot, { recursive: true });
  await fs.writeFile(secretTarget, Buffer.alloc(32, 7), { mode: 0o600 });
  await fs.symlink(secretTarget, path.join(secretSymlinkRoot, 'ledger-secret.bin'));
  const symlinkLedger = new TaskMutationReceiptLedger({ rootDir: secretSymlinkRoot });
  await assert.rejects(symlinkLedger.secret(), (error) => error.code === 'MUTATION_RECEIPT_INVALID');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    schema_valid: true,
    durable_restart_load: true,
    hmac_tamper_rejected: true,
    plan_binding_forgery_rejected: true,
    native_queue_receipt_shape_checked: true,
    symlink_substitution_rejected: true,
    private_modes: { directory: '0700', secret: '0600', receipt: '0600' }
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
