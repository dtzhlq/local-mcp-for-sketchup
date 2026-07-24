import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ApprovalAuthority } from '../src/approval-tokens.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import {
  createLocalApprovalHost,
  createLocalApprovalHostConfig,
  generateLocalApprovalBootstrapSecret
} from '../src/local-approval-host.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-local-approval-host-'));
const approvalStateDir = path.join(root, 'approvals');
const credentialPath = path.join(root, 'credential.v1.json');
const bootstrapSecret = 'local-approval-bootstrap-secret-at-least-32-bytes';
const authority = new ApprovalAuthority({
  stateDir: approvalStateDir,
  secret: 'local-approval-host-test-signing-secret-at-least-32-bytes'
});
const challenge = await authority.createChallenge({
  taskId: 'task_22222222-2222-4222-8222-222222222222',
  planId: 'local-host-plan-1',
  planHash: `sha256:${'a'.repeat(64)}`,
  modelRevision: `sha256:${'b'.repeat(64)}`,
  riskLevel: 'S2',
  allowedOperations: ['rename'],
  reviewContext: {
    kind: 'existing_model_edit_review_context',
    summary: 'Rename reviewed component',
    instruction: 'Rename the selected test component.',
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    affected_instance_count: 1,
    operations: [{
      index: 0,
      op: 'rename',
      destructive: false,
      topology: false,
      target: 'pid:123',
      tools: ['pid:456'],
      result_id: 'reviewed-result',
      result_name: 'Reviewed_Result',
      keep_originals: true,
      keep_tools: true
    }],
    targets: [{ name: '<script>alert(1)</script>', entity_path: 'pid:123', instance_policy: 'definition_wide' }],
    execution: {
      save_model: true,
      save_path: '/tmp/reviewed-copy.skp',
      final_save_path: '/tmp/reviewed-copy-local-host-plan-1.skp',
      overwrite_existing: false,
      capture_view: false
    }
  }
});
const booleanReviewContext = {
  kind: 'existing_model_edit_review_context',
  summary: 'Reviewed Boolean difference trial',
  instruction: 'Try one reviewed atomic Boolean difference.',
  content_trust: 'untrusted_data',
  policy_effect: 'none',
  affected_instance_count: 2,
  operations: [{
    index: 0,
    op: 'boolean_difference',
    destructive: false,
    topology: true,
    target: 'pid:700',
    tools: ['pid:701'],
    keep_originals: true,
    keep_tools: true
  }],
  geometry_validation: {
    evidence_kind: 'bbox_candidate_only',
    bbox_relation: 'positive_bbox_overlap_unverified',
    exact_solid_overlap: {
      status: 'unverified_before_atomic_trial',
      verified: false,
      verification_stage: 'review_gated_atomic_apply'
    },
    approved_action: 'review_gated_atomic_boolean_trial',
    success_preconditions: [
      'target_exact_volume_strictly_reduced',
      'result_manifold'
    ],
    failure_disposition: 'abort_before_commit'
  },
  targets: [
    { name: 'Boolean target', entity_path: 'pid:700' },
    { name: 'Boolean tool', entity_path: 'pid:701' }
  ]
};
const booleanChallenge = await authority.createChallenge({
  taskId: 'task_77777777-7777-4777-8777-777777777777',
  planId: 'local-host-boolean-plan-1',
  planHash: `sha256:${'7'.repeat(64)}`,
  modelRevision: `sha256:${'8'.repeat(64)}`,
  riskLevel: 'S3',
  allowedOperations: ['boolean_difference'],
  reviewContext: booleanReviewContext
});
assert.equal(booleanChallenge.review_context_hash, sha256Canonical(booleanReviewContext));
const tamperedBooleanContext = structuredClone(booleanReviewContext);
tamperedBooleanContext.geometry_validation.exact_solid_overlap.status = 'verified';
assert.notEqual(sha256Canonical(tamperedBooleanContext), booleanChallenge.review_context_hash);
const server = createLocalApprovalHost({
  port: 0,
  approvalStateDir,
  credentialPath,
  bootstrapSecret,
  approvalAuthority: authority,
  sessionTtlMs: 60_000,
  authWindowMs: 10_000,
  authLockMs: 1_000,
  maxAuthFailures: 5
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const passphrase = 'correct horse battery staple';

try {
  assert.equal(createLocalApprovalHostConfig({ port: 3988 }).host, '127.0.0.1');
  assert.throws(() => createLocalApprovalHostConfig({ host: '0.0.0.0' }), /loopback/);
  assert.ok(Buffer.byteLength(generateLocalApprovalBootstrapSecret()) >= 32);
  assert.throws(() => createLocalApprovalHost({ port: 0, credentialPath: path.join(root, 'invalid-bootstrap.json'), bootstrapSecret: 'too-short' }), /32 and 256 bytes/);

  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.initialized, false);
  assert.equal(health.json.setup_bootstrap_required, true);
  assert.equal(health.json.setup_bootstrap_configured, true);
  assert.equal(health.json.approval_tokens_exposed, false);
  assert.equal(health.headers['x-frame-options'], 'DENY');
  assert.match(health.headers['content-security-policy'], /frame-ancestors 'none'/);

  const setup = await request('/');
  assert.equal(setup.status, 200);
  assert.match(setup.body, /初始化本机审批口令/);
  assert.match(setup.body, /name="bootstrap_secret"/);
  assert.equal(setup.body.includes(bootstrapSecret), false, 'the setup page must never embed the bootstrap secret');
  const preauthCookie = cookieValue(setup, 'alma_approval_preauth');
  const setupCsrf = hiddenValue(setup.body, 'csrf');

  const crossOriginSetup = await request('/setup', {
    method: 'POST',
    cookie: preauthCookie,
    origin: 'http://attacker.invalid',
    acceptJson: true,
    form: { csrf: setupCsrf, bootstrap_secret: bootstrapSecret, user_id: 'local-user', passphrase, confirm_passphrase: passphrase }
  });
  assert.equal(crossOriginSetup.status, 403);
  assert.equal(crossOriginSetup.json.error.code, 'ORIGIN_INVALID');
  assert.equal(crossOriginSetup.body.includes(passphrase), false, 'passphrases must never be echoed');

  const opaqueCrossSiteSetup = await request('/setup', {
    method: 'POST',
    cookie: preauthCookie,
    origin: 'null',
    fetchSite: 'cross-site',
    acceptJson: true,
    form: { csrf: setupCsrf, bootstrap_secret: bootstrapSecret, user_id: 'local-user', passphrase, confirm_passphrase: passphrase }
  });
  assert.equal(opaqueCrossSiteSetup.status, 403);
  assert.equal(opaqueCrossSiteSetup.json.error.code, 'ORIGIN_INVALID');

  const missingBootstrap = await request('/setup', {
    method: 'POST',
    cookie: preauthCookie,
    origin: 'null',
    fetchSite: 'same-origin',
    acceptJson: true,
    form: { csrf: setupCsrf, user_id: 'local-user', passphrase, confirm_passphrase: passphrase }
  });
  assert.equal(missingBootstrap.status, 403);
  assert.equal(missingBootstrap.json.error.code, 'BOOTSTRAP_SECRET_INVALID');

  const wrongBootstrapValue = 'wrong-bootstrap-secret-that-is-at-least-32-bytes';
  const wrongBootstrap = await request('/setup', {
    method: 'POST',
    cookie: preauthCookie,
    origin: 'null',
    fetchSite: 'same-origin',
    acceptJson: true,
    form: { csrf: setupCsrf, bootstrap_secret: wrongBootstrapValue, user_id: 'local-user', passphrase, confirm_passphrase: passphrase }
  });
  assert.equal(wrongBootstrap.status, 403);
  assert.equal(wrongBootstrap.json.error.code, 'BOOTSTRAP_SECRET_INVALID');
  assert.equal(wrongBootstrap.body.includes(wrongBootstrapValue), false, 'bootstrap secrets must never be echoed');
  await assert.rejects(fs.access(credentialPath));

  const initialized = await request('/setup', {
    method: 'POST',
    cookie: preauthCookie,
    origin: 'null',
    fetchSite: 'same-origin',
    form: { csrf: setupCsrf, bootstrap_secret: bootstrapSecret, user_id: 'user-42', passphrase, confirm_passphrase: passphrase }
  });
  assert.equal(initialized.status, 303);
  const sessionCookie = cookieValue(initialized, 'alma_approval_session');
  assert.match(initialized.headers['set-cookie'].join('\n'), /HttpOnly/);
  assert.match(initialized.headers['set-cookie'].join('\n'), /SameSite=Strict/);
  assert.equal((await fs.stat(credentialPath)).mode & 0o777, 0o600);
  const persistedSetupState = await readAllFiles(root);
  assert.equal(persistedSetupState.includes(bootstrapSecret), false, 'bootstrap secret must not be persisted');
  assert.equal(persistedSetupState.includes(wrongBootstrapValue), false, 'failed bootstrap candidates must not be persisted');
  const initializedHealth = await request('/health');
  assert.equal(initializedHealth.json.initialized, true);
  assert.equal(initializedHealth.json.setup_bootstrap_required, false);
  assert.equal(initializedHealth.json.setup_bootstrap_configured, true);

  const heldCredentialPath = `${credentialPath}.held-for-bootstrap-consumption-test`;
  await fs.rename(credentialPath, heldCredentialPath);
  try {
    const consumedBootstrap = await request('/', { acceptJson: true });
    assert.equal(consumedBootstrap.status, 409);
    assert.equal(consumedBootstrap.json.error.code, 'BOOTSTRAP_SECRET_CONSUMED');
  } finally {
    await fs.rename(heldCredentialPath, credentialPath);
  }

  const list = await request('/', { cookie: sessionCookie });
  assert.equal(list.status, 200);
  assert.match(list.body, /Rename reviewed component/);
  const sessionCsrf = hiddenValue(list.body, 'csrf');

  const detail = await request(`/approvals/${challenge.challenge_id}`, { cookie: sessionCookie });
  assert.equal(detail.status, 200);
  assert.match(detail.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(detail.body.includes('<script>alert(1)</script>'), false, 'untrusted model content must be HTML escaped');
  assert.match(detail.body, /token 只保存在服务端，不会返回给 Agent/, 'challenge page must state the server-private token boundary');
  assert.match(detail.body, /target=pid:123/);
  assert.match(detail.body, /tools=pid:456/);
  assert.match(detail.body, /keep_originals=true/);
  assert.match(detail.body, /keep_tools=true/);
  assert.match(detail.body, /reviewed-copy\.skp/);
  assert.match(detail.body, /reviewed-copy-local-host-plan-1\.skp/);
  assert.match(detail.body, /禁止/);
  assert.equal(detail.body.includes('布尔几何验证边界'), false, '非 Boolean 审批页不应增加几何披露面板');

  const booleanDetail = await request(`/approvals/${booleanChallenge.challenge_id}`, { cookie: sessionCookie });
  assert.equal(booleanDetail.status, 200);
  assert.match(booleanDetail.body, /布尔几何验证边界/);
  assert.match(booleanDetail.body, /BBox 重叠只用于候选筛选/);
  assert.match(booleanDetail.body, /bbox_candidate_only/);
  assert.match(booleanDetail.body, /positive_bbox_overlap_unverified/);
  assert.match(booleanDetail.body, /精确实体相交尚未验证/);
  assert.match(booleanDetail.body, /unverified_before_atomic_trial/);
  assert.match(booleanDetail.body, /verified=false/);
  assert.match(booleanDetail.body, /review_gated_atomic_apply/);
  assert.match(booleanDetail.body, /review_gated_atomic_boolean_trial/);
  assert.match(booleanDetail.body, /target_exact_volume_strictly_reduced/);
  assert.match(booleanDetail.body, /result_manifold/);
  assert.match(booleanDetail.body, /必须 <code>abort_before_commit<\/code>/);

  const missingCsrf = await request(`/approvals/${challenge.challenge_id}/approve`, {
    method: 'POST', cookie: sessionCookie, origin, acceptJson: true,
    form: { acknowledge: 'yes', passphrase }
  });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.json.error.code, 'CSRF_INVALID');

  const wrongPassphrase = await request(`/approvals/${challenge.challenge_id}/approve`, {
    method: 'POST', cookie: sessionCookie, origin, acceptJson: true,
    form: { csrf: sessionCsrf, acknowledge: 'yes', passphrase: 'wrong-passphrase-value' }
  });
  assert.equal(wrongPassphrase.status, 401);
  assert.equal(wrongPassphrase.body.includes('wrong-passphrase-value'), false);
  assert.equal(await authority.readDecision(challenge.challenge_id, { allowMissing: true }), null);

  const approved = await request(`/approvals/${challenge.challenge_id}/approve`, {
    method: 'POST', cookie: sessionCookie, origin,
    form: { csrf: sessionCsrf, acknowledge: 'yes', passphrase }
  });
  assert.equal(approved.status, 303);
  const publicDecision = await authority.readDecision(challenge.challenge_id);
  assert.equal(publicDecision.decision, 'approved');
  assert.equal(publicDecision.status, 'approved_pending_execution');
  assert.equal(Object.hasOwn(publicDecision, 'approval_token'), false, 'public decisions must redact approval tokens');
  await validateDecisionSchema(publicDecision);
  const storedToken = await authority.readStoredApprovalToken(challenge.challenge_id);
  assert.equal((await authority.verifyToken(storedToken)).challenge_id, challenge.challenge_id);
  await authority.consumeToken(storedToken, expected(challenge));
  const consumedDecision = await authority.readDecision(challenge.challenge_id);
  assert.equal(consumedDecision.status, 'consumed');
  assert.equal(Object.hasOwn(consumedDecision, 'approval_token'), false);
  await assert.rejects(authority.readStoredApprovalToken(challenge.challenge_id), (error) => error.code === 'APPROVAL_REPLAYED' || error.code === 'APPROVAL_EXPIRED');

  const rejectedChallenge = await authority.createChallenge({
    taskId: 'task_33333333-3333-4333-8333-333333333333',
    planId: 'local-host-plan-rejected',
    planHash: `sha256:${'c'.repeat(64)}`,
    modelRevision: `sha256:${'d'.repeat(64)}`,
    riskLevel: 'S3',
    allowedOperations: ['pushpull_face']
  });
  const rejected = await request(`/approvals/${rejectedChallenge.challenge_id}/reject`, {
    method: 'POST', cookie: sessionCookie, origin,
    form: { csrf: sessionCsrf, acknowledge: 'yes', passphrase, reason: 'Not the intended target.' }
  });
  assert.equal(rejected.status, 303);
  assert.equal((await authority.readDecision(rejectedChallenge.challenge_id)).decision, 'rejected');
  await assert.rejects(authority.readStoredApprovalToken(rejectedChallenge.challenge_id), (error) => error.code === 'POLICY_DENIED');

  const choiceChallenge = await authority.createChallenge({
    taskId: 'task_44444444-4444-4444-8444-444444444444',
    planId: 'local-host-plan-choice',
    planHash: `sha256:${'e'.repeat(64)}`,
    modelRevision: `sha256:${'f'.repeat(64)}`,
    riskLevel: 'S2',
    allowedOperations: ['accept_design_reconciliation'],
    reviewContext: {
      decision_options: [
        { value: 'accept_manual_model', label: 'Accept manual model state' },
        { value: 'accept_reviewed_parameter_change', label: 'Accept reviewed parameter change' }
      ]
    }
  });
  await assert.rejects(
    authority.recordTrustedDecision(choiceChallenge, { decision: 'approved', user_id: 'user-42', channel: 'local-approval-host.v1', confirmed: true }),
    (error) => error.code === 'INVALID_ARGUMENT'
  );
  const choice = await authority.recordTrustedDecision(choiceChallenge, {
    decision: 'approved', user_id: 'user-42', channel: 'local-approval-host.v1', confirmed: true,
    selection: 'accept_manual_model'
  });
  assert.equal(choice.review_selection, 'accept_manual_model');

  const unconfiguredServer = createLocalApprovalHost({
    port: 0,
    approvalStateDir: path.join(root, 'unconfigured-approvals'),
    credentialPath: path.join(root, 'unconfigured-credential.json')
  });
  await new Promise((resolve) => unconfiguredServer.listen(0, '127.0.0.1', resolve));
  try {
    const blockedSetup = await requestAt(unconfiguredServer.address().port, '/', { acceptJson: true });
    assert.equal(blockedSetup.status, 503);
    assert.equal(blockedSetup.json.error.code, 'BOOTSTRAP_SECRET_REQUIRED');
  } finally {
    await new Promise((resolve) => unconfiguredServer.close(resolve));
  }

  const initializedCompatibleServer = createLocalApprovalHost({
    port: 0,
    approvalStateDir,
    credentialPath,
    approvalAuthority: authority
  });
  await new Promise((resolve) => initializedCompatibleServer.listen(0, '127.0.0.1', resolve));
  try {
    const compatibleHealth = await requestAt(initializedCompatibleServer.address().port, '/health');
    assert.equal(compatibleHealth.status, 200);
    assert.equal(compatibleHealth.json.initialized, true);
    assert.equal(compatibleHealth.json.setup_bootstrap_required, false);
  } finally {
    await new Promise((resolve) => initializedCompatibleServer.close(resolve));
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    loopback_only: true,
    csrf: true,
    reauthentication_per_decision: true,
    token_exposed_to_agent: false,
    html_escaped_untrusted_data: true,
    boolean_geometry_disclosure_rendered: true,
    approved_and_rejected: true,
    decision_selection_bound: true,
    bootstrap_secret_one_time: true,
    bootstrap_secret_persisted: false,
    initialized_machine_compatible: true
  }, null, 2)}\n`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}

async function request(pathname, { method = 'GET', cookie, origin: requestOrigin, fetchSite = 'same-origin', form, acceptJson = false } = {}) {
  return requestAt(port, pathname, { method, cookie, origin: requestOrigin, fetchSite, form, acceptJson });
}

async function requestAt(requestPort, pathname, { method = 'GET', cookie, origin: requestOrigin, fetchSite = 'same-origin', form, acceptJson = false } = {}) {
  const body = form ? new URLSearchParams(form).toString() : '';
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port: requestPort,
      path: pathname,
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(requestOrigin ? { origin: requestOrigin, 'sec-fetch-site': fetchSite } : {}),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } : {}),
        ...(acceptJson ? { accept: 'application/json' } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (String(response.headers['content-type'] || '').includes('application/json')) json = JSON.parse(responseBody);
        resolve({ status: response.statusCode, headers: response.headers, body: responseBody, json });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function cookieValue(response, name) {
  const values = response.headers['set-cookie'] || [];
  const match = values.find((entry) => entry.startsWith(`${name}=`));
  assert.ok(match, `missing ${name} cookie`);
  return match.split(';')[0];
}

function hiddenValue(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  assert.ok(match, `missing hidden field ${name}`);
  return match[1];
}

function expected(challenge) {
  return {
    task_id: challenge.task_id,
    plan_id: challenge.plan_id,
    plan_hash: challenge.plan_hash,
    model_revision: challenge.model_revision,
    risk_level: challenge.risk_level,
    allowed_operations: challenge.allowed_operations
  };
}

async function validateDecisionSchema(decision) {
  const schema = JSON.parse(await fs.readFile(path.resolve('schema/local-approval-decision-v1.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  assert.equal(ajv.validate(schema, decision), true, JSON.stringify(ajv.errors));
}

async function readAllFiles(directory) {
  const chunks = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) chunks.push(await readAllFiles(entryPath));
    else if (entry.isFile()) chunks.push(await fs.readFile(entryPath, 'utf8').catch(() => ''));
  }
  return chunks.join('\n');
}
