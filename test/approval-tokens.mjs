import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { ApprovalAuthority } from '../src/approval-tokens.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-approval-token-'));
const authority = new ApprovalAuthority({ stateDir: root, secret: 'approval-test-secret-that-is-at-least-32-bytes-long' });
const binding = {
  taskId: 'task_11111111-1111-4111-8111-111111111111',
  planId: 'plan-1',
  planHash: `sha256:${'a'.repeat(64)}`,
  modelRevision: `sha256:${'b'.repeat(64)}`,
  riskLevel: 'S3',
  allowedOperations: ['pushpull_face', 'set_material'],
  reviewContext: {
    kind: 'existing_model_edit_review_context',
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    targets: [{ entity_path: 'pid:123', name: 'Untrusted target name' }],
    operations: [{ index: 0, op: 'pushpull_face', target: 'pid:123' }]
  }
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

  const deterministicBinding = { ...binding, planId: 'plan-idempotent-finalizer', idempotencyKey: 'post-commit-finalizer-step' };
  const deterministicChallenge = await authority.createChallenge(deterministicBinding);
  const deterministicReplay = await authority.createChallenge(deterministicBinding);
  assert.deepEqual(deterministicReplay, deterministicChallenge, 'post-commit challenge creation must be idempotent across finalizer restart');
  await assert.rejects(
    authority.createChallenge({ ...deterministicBinding, planHash: `sha256:${'e'.repeat(64)}` }),
    (error) => error.code === 'APPROVAL_INVALID'
  );

  const expiringChallenge = await authority.createChallenge({ ...binding, planId: 'plan-expired', expiresInMs: 1000 });
  const expiringToken = await authority.approveChallengeFromTrustedUser(expiringChallenge, { user_id: 'user-42', channel: 'local-user-ui', confirmed: true });
  const originalNow = Date.now;
  Date.now = () => originalNow() + 2000;
  try {
    await assert.rejects(authority.consumeToken(expiringToken, expected({ ...binding, planId: 'plan-expired' })), (error) => error.code === 'APPROVAL_EXPIRED');
  } finally {
    Date.now = originalNow;
  }

  const decisionBinding = {
    ...binding,
    planId: 'plan-signed-decision',
    reviewContext: {
      ...binding.reviewContext,
      decision_options: [{ value: 'accept_reviewed_change', label: 'Accept reviewed change' }]
    }
  };
  const decisionChallenge = await authority.createChallenge(decisionBinding);
  const publicDecision = await authority.recordTrustedDecision(decisionChallenge, {
    decision: 'approved',
    user_id: 'user-42',
    channel: 'local-approval-host.v1',
    confirmed: true,
    selection: 'accept_reviewed_change',
    reason: 'Reviewed in the trusted local host.'
  });
  assert.equal(Object.hasOwn(publicDecision, 'approval_token'), false);
  assert.equal(Object.hasOwn(publicDecision, 'approval_token_hash'), false);
  assert.equal(Object.hasOwn(publicDecision, 'decision_signature'), false);
  const decisionPath = authority.decisionPath(decisionChallenge.challenge_id);
  const signedDecision = JSON.parse(await fs.readFile(decisionPath, 'utf8'));
  assert.match(signedDecision.decision_signature, /^[A-Za-z0-9_-]+$/);
  assert.match(signedDecision.approval_token_hash, /^sha256:[0-9a-f]{64}$/);
  const ready = await authority.verifyStoredApprovalAuthorizationReady(decisionChallenge, expected(decisionBinding));
  assert.equal(ready.decision.status, 'approved_pending_execution');
  assert.equal(Object.hasOwn(ready, 'approval_token'), false);
  assert.equal(ready.authorization.review_context_hash, sha256Canonical(decisionBinding.reviewContext));
  await assert.rejects(
    authority.verifyStoredApprovalAuthorizationReady(decisionChallenge, {
      ...expected(decisionBinding),
      review_context_hash: `sha256:${'f'.repeat(64)}`
    }),
    (error) => error.code === 'APPROVAL_INVALID'
  );

  for (const mutate of [
    (value) => { value.status = 'rejected'; },
    (value) => { value.review_selection = 'tampered-selection'; },
    (value) => { value.reason = 'tampered reason'; },
    (value) => { value.approval_token_hash = `sha256:${'0'.repeat(64)}`; },
    (value) => { value.decision_signature = `${value.decision_signature.slice(0, -1)}${value.decision_signature.endsWith('a') ? 'b' : 'a'}`; }
  ]) {
    const tamperedDecision = structuredClone(signedDecision);
    mutate(tamperedDecision);
    await fs.writeFile(decisionPath, `${JSON.stringify(tamperedDecision, null, 2)}\n`, 'utf8');
    await assert.rejects(
      authority.verifyStoredApprovalAuthorizationReady(decisionChallenge, expected(decisionBinding)),
      (error) => error.code === 'APPROVAL_INVALID'
    );
  }
  await fs.writeFile(decisionPath, `${JSON.stringify(signedDecision, null, 2)}\n`, 'utf8');

  const legacyBinding = { ...binding, planId: 'plan-legacy-unsigned-decision' };
  const legacyChallenge = await authority.createChallenge(legacyBinding);
  await authority.recordTrustedDecision(legacyChallenge, {
    decision: 'approved', user_id: 'legacy-user', channel: 'local-approval-host.v1', confirmed: true
  });
  const legacyPath = authority.decisionPath(legacyChallenge.challenge_id);
  const legacyRecord = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
  delete legacyRecord.decision_signature;
  await fs.writeFile(legacyPath, `${JSON.stringify(legacyRecord, null, 2)}\n`, 'utf8');
  await assert.rejects(
    authority.verifyStoredApprovalAuthorizationReady(legacyChallenge, expected(legacyBinding)),
    (error) => error.code === 'APPROVAL_INVALID'
  );
  const legacyDisplay = await authority.readDecisionForDisplay(legacyChallenge.challenge_id);
  assert.equal(legacyDisplay.status, 'reauthorization_required');
  assert.equal(legacyDisplay.executable, false);
  const listedLegacy = (await authority.listChallenges()).find((entry) => entry.challenge_id === legacyChallenge.challenge_id);
  assert.equal(listedLegacy.decision.status, 'reauthorization_required', 'one legacy record must not make the approval list fail');

  const freshAfterLegacyBinding = { ...binding, planId: 'plan-fresh-after-legacy' };
  const freshAfterLegacy = await authority.createChallenge(freshAfterLegacyBinding);
  await authority.recordTrustedDecision(freshAfterLegacy, {
    decision: 'approved', user_id: 'fresh-user', channel: 'local-approval-host.v1', confirmed: true
  });
  assert.equal(
    (await authority.verifyStoredApprovalAuthorizationReady(freshAfterLegacy, expected(freshAfterLegacyBinding))).decision.status,
    'approved_pending_execution'
  );

  const expiringDecisionBinding = { ...binding, planId: 'plan-expiring-signed-decision', expiresInMs: 1000 };
  const expiringDecisionChallenge = await authority.createChallenge(expiringDecisionBinding);
  await authority.recordTrustedDecision(expiringDecisionChallenge, {
    decision: 'approved', user_id: 'user-42', channel: 'local-approval-host.v1', confirmed: true
  });
  const decisionOriginalNow = Date.now;
  Date.now = () => Date.parse(expiringDecisionChallenge.expires_at) + 1;
  try {
    await assert.rejects(
      authority.verifyStoredApprovalAuthorizationReady(expiringDecisionChallenge, expected(expiringDecisionBinding)),
      (error) => error.code === 'APPROVAL_EXPIRED'
    );
  } finally {
    Date.now = decisionOriginalNow;
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    one_time: true,
    idempotent_challenge_creation: true,
    decision_hmac: true,
    legacy_unsigned_display_safe: true,
    bindings: ['task_id', 'plan_hash', 'model_revision', 'risk_level', 'allowed_operations', 'review_context_hash', 'expiry']
  }, null, 2)}\n`);
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
    allowed_operations: values.allowedOperations,
    review_context_hash: sha256Canonical(values.reviewContext ?? null)
  };
}
