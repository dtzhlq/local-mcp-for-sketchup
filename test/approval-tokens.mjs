import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApprovalAuthority } from '../src/approval-tokens.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-approval-token-'));
const authority = new ApprovalAuthority({ stateDir: root, secret: 'approval-test-secret-that-is-at-least-32-bytes-long' });
const binding = {
  taskId: 'task_11111111-1111-4111-8111-111111111111',
  planId: 'plan-1',
  planHash: `sha256:${'a'.repeat(64)}`,
  modelRevision: `sha256:${'b'.repeat(64)}`,
  riskLevel: 'S3',
  allowedOperations: ['pushpull_face', 'set_material']
};

try {
  const challenge = await authority.createChallenge(binding);
  await assert.rejects(
    authority.approveChallengeFromTrustedUser(challenge, { user_id: 'agent', channel: 'mcp', confirmed: false }),
    (error) => error.code === 'POLICY_DENIED'
  );
  const token = await authority.approveChallengeFromTrustedUser(challenge, { user_id: 'user-42', channel: 'local-user-ui', confirmed: true });
  const verified = await authority.verifyToken(token);
  assert.equal(verified.approved_by, 'user-42');
  const consumed = await authority.consumeToken(token, expected(binding));
  assert.equal(consumed.plan_hash, binding.planHash);
  await assert.rejects(authority.consumeToken(token, expected(binding)), (error) => error.code === 'APPROVAL_REPLAYED');

  const mismatchedPlan = await tokenFor({ ...binding, planId: 'plan-2' });
  await assert.rejects(authority.consumeToken(mismatchedPlan, { ...expected({ ...binding, planId: 'plan-2' }), plan_hash: `sha256:${'c'.repeat(64)}` }), (error) => error.code === 'PLAN_HASH_MISMATCH');

  const mismatchedRevision = await tokenFor({ ...binding, planId: 'plan-3' });
  await assert.rejects(authority.consumeToken(mismatchedRevision, { ...expected({ ...binding, planId: 'plan-3' }), model_revision: `sha256:${'d'.repeat(64)}` }), (error) => error.code === 'MODEL_REVISION_MISMATCH');

  const narrowToken = await tokenFor({ ...binding, planId: 'plan-4', allowedOperations: ['set_material'] });
  await assert.rejects(authority.consumeToken(narrowToken, { ...expected({ ...binding, planId: 'plan-4', allowedOperations: ['set_material'] }), allowed_operations: ['set_material', 'delete'] }), (error) => error.code === 'OPERATION_NOT_ALLOWED');

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  await assert.rejects(authority.verifyToken(tampered), (error) => error.code === 'APPROVAL_INVALID');

  const expiringChallenge = await authority.createChallenge({ ...binding, planId: 'plan-expired', expiresInMs: 1000 });
  const expiringToken = await authority.approveChallengeFromTrustedUser(expiringChallenge, { user_id: 'user-42', channel: 'local-user-ui', confirmed: true });
  const originalNow = Date.now;
  Date.now = () => originalNow() + 2000;
  try {
    await assert.rejects(authority.consumeToken(expiringToken, expected({ ...binding, planId: 'plan-expired' })), (error) => error.code === 'APPROVAL_EXPIRED');
  } finally {
    Date.now = originalNow;
  }

  process.stdout.write(`${JSON.stringify({ ok: true, one_time: true, bindings: ['task_id', 'plan_hash', 'model_revision', 'risk_level', 'allowed_operations', 'expiry'] }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function tokenFor(values) {
  const challenge = await authority.createChallenge(values);
  return authority.approveChallengeFromTrustedUser(challenge, { user_id: 'user-42', channel: 'local-user-ui', confirmed: true });
}

function expected(values) {
  return {
    task_id: values.taskId,
    plan_id: values.planId,
    plan_hash: values.planHash,
    model_revision: values.modelRevision,
    risk_level: values.riskLevel,
    allowed_operations: values.allowedOperations
  };
}
