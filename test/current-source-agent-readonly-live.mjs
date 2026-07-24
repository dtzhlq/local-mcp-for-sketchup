import assert from 'node:assert/strict';
import {
  assertExplicitReadOnlyOptIn,
  assertNoSensitivePublicEvidence,
  assertQueueIdle,
  assertReadOnlyBindingUnchanged,
  assertSafeRunId,
  summarizeQueue
} from '../scripts/run-current-source-agent-readonly-live.mjs';

let assertions = 0;
const validOptions = {
  runtime: 'queue',
  queueRequired: true,
  disposableCopyConfirmed: true,
  expectedModelSha256: 'a'.repeat(64),
  recursiveLimit: 20_000,
  timeoutMs: 120_000
};
assert.doesNotThrow(() => assertExplicitReadOnlyOptIn(validOptions)); assertions += 1;
assert.doesNotThrow(() => assertSafeRunId('2026-07-21T14-41-09-643Z-e471edf2')); assertions += 1;

for (const invalid of [
  { ...validOptions, runtime: 'mock' },
  { ...validOptions, queueRequired: false },
  { ...validOptions, disposableCopyConfirmed: false },
  { ...validOptions, expectedModelSha256: 'short' },
  { ...validOptions, recursiveLimit: 0 },
  { ...validOptions, recursiveLimit: 1_000_001 },
  { ...validOptions, timeoutMs: 999 },
  { ...validOptions, timeoutMs: 600_001 }
]) {
  assert.throws(() => assertExplicitReadOnlyOptIn(invalid)); assertions += 1;
}
for (const invalidRunId of ['../escape', '/absolute', '.hidden', '', 'a'.repeat(97)]) {
  assert.throws(() => assertSafeRunId(invalidRunId)); assertions += 1;
}

const cleanQueue = { queue: { count: 0 }, processing: { count: 0 }, responses: { count: 0 }, lock: { exists: false } };
assert.deepEqual(summarizeQueue(cleanQueue), { queue: 0, processing: 0, responses: 0, lock_exists: false }); assertions += 1;
assert.doesNotThrow(() => assertQueueIdle(cleanQueue)); assertions += 1;
for (const dirty of [
  { ...cleanQueue, queue: { count: 1 } },
  { ...cleanQueue, processing: { count: 1 } },
  { ...cleanQueue, responses: { count: 1 } },
  { ...cleanQueue, lock: { exists: true } }
]) {
  assert.throws(() => assertQueueIdle(dirty)); assertions += 1;
}

const binding = {
  session_id: 'session',
  document_id: 'document',
  model_identity: { model_guid: 'guid', runtime_object_id: 'object', title: 'title', source_path: '/private/model.skp' },
  model_revision: `sha256:${'b'.repeat(64)}`,
  model_revision_strategy: 'definition-merkle.v2',
  model_revision_unique_entity_limit: 1_000_000,
  model_revision_complete: true,
  model_revision_total_seen: 10,
  model_revision_indexed: 10,
  model_modified: false,
  plugin_version: '0.1.0-rc.2',
  capability_version: 'capabilities.7',
  manifest_version: 'manifest.v1.4',
  dsl_version: 1,
  occurrence_contract: 'canonical-occurrence-path.v1',
  boolean_operations_sha256: 'c'.repeat(64),
  model_revision_source_sha256: 'd'.repeat(64)
};
assert.doesNotThrow(() => assertReadOnlyBindingUnchanged(binding, structuredClone(binding))); assertions += 1;
for (const field of ['session_id', 'document_id', 'model_revision', 'model_modified', 'capability_version']) {
  const changed = structuredClone(binding);
  changed[field] = field === 'model_modified' ? true : `${changed[field]}-changed`;
  assert.throws(() => assertReadOnlyBindingUnchanged(binding, changed)); assertions += 1;
}
const identityChanged = structuredClone(binding);
identityChanged.model_identity.title = 'changed';
assert.throws(() => assertReadOnlyBindingUnchanged(binding, identityChanged)); assertions += 1;

assert.doesNotThrow(() => assertNoSensitivePublicEvidence({
  result: 'pass',
  model: { source_path_disclosed: false },
  acceptance: { live_mutation: false }
})); assertions += 1;
for (const unsafe of [
  { signature: 'secret' },
  { session_id: 'secret' },
  { nested: { token: 'secret' } },
  { path: '/Users/example/private.json' },
  { path: 'file:///private.json' }
]) {
  assert.throws(() => assertNoSensitivePublicEvidence(unsafe)); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  explicit_queue_opt_in: true,
  disposable_confirmation_required: true,
  run_id_path_escape_failed_closed: true,
  queue_residue_failed_closed: true,
  read_only_binding_drift_failed_closed: true,
  public_sensitive_values_failed_closed: true,
  assertions
}, null, 2)}\n`);
