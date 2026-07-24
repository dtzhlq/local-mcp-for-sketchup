import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  normalizeExecutionPolicy,
  sha256Canonical,
  trustedModelCopyAutoApprovalBinding
} from '../src/agent-contract.mjs';
import {
  CopyFastSessionAuthority,
  MAX_COPY_FAST_SESSION_TTL_MS,
  MIN_COPY_FAST_SESSION_TTL_MS,
  boundedSessionTtl,
  copyFastSessionBindingValid
} from '../src/copy-fast-session.mjs';

let now = Date.parse('2026-07-24T00:00:00.000Z');
const copyRoot = path.resolve('test/fixtures/copy-fast-session/copies');
const executionPolicy = normalizeExecutionPolicy({
  allowed_runtimes: ['mock'],
  trusted_model_copy_auto_approval: {
    enabled: true,
    allowed_risks: ['S2', 'S3', 'S4'],
    allowed_roots: [copyRoot],
    max_affected_instances: 20,
    allow_save_model: false,
    session_ttl_ms: 60 * 60 * 1000
  },
  resource_limits: {
    max_operations: 20,
    max_affected_instances: 20,
    max_recursive_entities: 1000
  }
});
const scopeBinding = trustedModelCopyAutoApprovalBinding({
  executionPolicy,
  riskLevel: 'S4',
  affectedInstanceCount: 1,
  modelSourcePath: path.join(copyRoot, 'device-copy.skp'),
  saveModel: false
});
const otherCopyBinding = trustedModelCopyAutoApprovalBinding({
  executionPolicy,
  riskLevel: 'S4',
  affectedInstanceCount: 1,
  modelSourcePath: path.join(copyRoot, 'other-copy.skp'),
  saveModel: false
});
assert.ok(scopeBinding);
assert.ok(otherCopyBinding);

const modelKey = `model_${'1'.repeat(32)}`;
const modelRevision = sha256Canonical({ revision: 1 });
const nextModelRevision = sha256Canonical({ revision: 2 });
const authority = new CopyFastSessionAuthority({
  now: () => now,
  authoritySessionId: 'copy_authority_test_process'
});
const first = authority.resolveOrCreate({
  scopeBinding,
  modelKey,
  modelRevision,
  runtime: 'mock',
  sessionTtlMs: 60 * 60 * 1000
});

const schema = JSON.parse(await fs.readFile(path.resolve('schema/copy-fast-session-v1.schema.json'), 'utf8'));
const summarySchema = JSON.parse(await fs.readFile(path.resolve('schema/copy-fast-session-summary-v1.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);
const validateSummary = ajv.compile(summarySchema);
assert.equal(validate(first.binding), true, JSON.stringify(validate.errors));
assert.equal(validateSummary(first.summary), true, JSON.stringify(validateSummary.errors));
assert.equal(copyFastSessionBindingValid(first.binding), true);
assert.equal(first.summary.reused, false);
assert.equal(first.summary.user_action_required, false);
assert.equal(first.summary.agent_can_enable, false);
assert.equal(first.summary.local_paths_exposed, false);
assert.equal(JSON.stringify(first.summary).includes(copyRoot), false);
for (const privateField of [
  'authority_session_id',
  'policy_scope_fingerprint',
  'trusted_scope_binding_hash',
  'source_path_fingerprint',
  'matched_root_fingerprint',
  'binding_hash'
]) {
  assert.equal(Object.hasOwn(first.summary, privateField), false);
}

now += 5_000;
const reused = authority.resolveOrCreate({
  scopeBinding,
  modelKey,
  modelRevision: nextModelRevision,
  runtime: 'mock',
  sessionTtlMs: 60 * 60 * 1000
});
assert.equal(reused.binding.session_id, first.binding.session_id);
assert.equal(reused.binding.initial_model_revision, modelRevision);
assert.equal(reused.summary.reused, true);
assert.equal(authority.verify(first.binding, {
  scopeBinding,
  modelKey,
  runtime: 'mock'
}).status, 'active');

assert.throws(
  () => authority.verify(first.binding, { scopeBinding: otherCopyBinding, modelKey, runtime: 'mock' }),
  (error) => error.code === 'POLICY_DENIED'
);
assert.throws(
  () => authority.verify(first.binding, { scopeBinding, modelKey: `model_${'2'.repeat(32)}`, runtime: 'mock' }),
  (error) => error.code === 'POLICY_DENIED'
);
assert.throws(
  () => authority.verify(first.binding, { scopeBinding, modelKey, runtime: 'queue' }),
  (error) => error.code === 'POLICY_DENIED'
);
const restartedAuthority = new CopyFastSessionAuthority({
  now: () => now,
  authoritySessionId: 'copy_authority_restarted_process'
});
assert.throws(
  () => restartedAuthority.verify(first.binding, { scopeBinding, modelKey, runtime: 'mock' }),
  (error) => error.code === 'POLICY_DENIED'
);

const revocable = restartedAuthority.resolveOrCreate({
  scopeBinding,
  modelKey,
  modelRevision,
  runtime: 'mock'
});
assert.equal(restartedAuthority.revoke(revocable.binding.session_id), true);
assert.throws(
  () => restartedAuthority.verify(revocable.binding, { scopeBinding, modelKey, runtime: 'mock' }),
  (error) => error.code === 'POLICY_DENIED'
);

now = Date.parse(first.binding.expires_at) + 1;
assert.throws(
  () => authority.verify(first.binding, { scopeBinding, modelKey, runtime: 'mock' }),
  (error) => error.code === 'POLICY_DENIED'
);
assert.equal(boundedSessionTtl(1), MIN_COPY_FAST_SESSION_TTL_MS);
assert.equal(boundedSessionTtl(Number.MAX_SAFE_INTEGER), MAX_COPY_FAST_SESSION_TTL_MS);

const invalidCases = [
  mutate(first.binding, (value) => { value.version = 'copy-fast-session.v0'; }),
  mutate(first.binding, (value) => { value.kind = 'approval_token'; }),
  mutate(first.binding, (value) => { value.session_id = 'agent_enabled'; }),
  mutate(first.binding, (value) => { value.authority_session_id = ''; }),
  mutate(first.binding, (value) => { value.policy_scope_fingerprint = 'bad'; }),
  mutate(first.binding, (value) => { value.source_path_fingerprint = 'bad'; }),
  mutate(first.binding, (value) => { delete value.matched_root_fingerprint; }),
  mutate(first.binding, (value) => { value.model_key = 'model_bad'; }),
  mutate(first.binding, (value) => { value.runtime = 'direct'; }),
  mutate(first.binding, (value) => { value.initial_model_revision = 'bad'; }),
  mutate(first.binding, (value) => { value.expires_at = value.issued_at; }),
  mutate(first.binding, (value) => { value.binding_hash = sha256Canonical({ forged: true }); }),
  mutate(first.binding, (value) => { value.agent_can_enable = true; })
];
let negativeSchemaCases = 0;
for (const invalid of invalidCases) {
  if (!validate(invalid)) negativeSchemaCases += 1;
  assert.equal(copyFastSessionBindingValid(invalid), false);
}
assert.ok(negativeSchemaCases >= 10);

process.stdout.write(`${JSON.stringify({
  ok: true,
  schema_valid: true,
  session_reused_across_model_revisions: true,
  agent_can_enable: false,
  local_paths_exposed: false,
  wrong_scope_rejected: true,
  wrong_model_rejected: true,
  wrong_runtime_rejected: true,
  restart_rejected: true,
  expiry_rejected: true,
  revocation_rejected: true,
  negative_schema_cases: negativeSchemaCases,
  negative_runtime_cases: invalidCases.length,
  live_queue_calls: 0
}, null, 2)}\n`);

function mutate(value, callback) {
  const clone = structuredClone(value);
  callback(clone);
  return clone;
}
