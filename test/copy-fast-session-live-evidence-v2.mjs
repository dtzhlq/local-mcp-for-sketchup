import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COPY_FAST_LIVE_DEFAULT_MODEL,
  COPY_FAST_LIVE_MODEL_SHA256,
  assertCopyFastLiveEvidenceBindings,
  assertCopyFastLiveEvidenceSchema
} from '../scripts/run-copy-fast-session-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs',
  'evidence',
  'copy-fast-session-v2-live-evidence-2026-07-24.json'
);
const evidenceBytes = await fs.readFile(evidencePath);
const evidence = JSON.parse(evidenceBytes);

assert.equal(
  sha256(evidenceBytes),
  '1357a42face31640096cdadcc462d736f8c4825a626e8cae41115e4de51b56e2',
  'public rc.3 Copy Fast v2 live evidence bytes drifted'
);
assert.equal(evidence.baseline_commit, 'bd8048fc789dea5d3d55b091a6d1e8712908c970');
assert.equal(await assertCopyFastLiveEvidenceSchema(evidence), true);
assert.equal(assertCopyFastLiveEvidenceBindings(evidence), true);

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  const actual = sha256(await fs.readFile(path.join(repoRoot, relativePath)));
  assert.equal(actual, expected, `${relativePath} drifted after the rc.3 Copy Fast live capture`);
}

const modelBytes = await fs.readFile(COPY_FAST_LIVE_DEFAULT_MODEL);
assert.equal(sha256(modelBytes), COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(modelBytes.length, evidence.model.size_bytes);
assert.equal(evidence.runtime.server_version, '0.1.0-rc.3');
assert.equal(evidence.runtime.plugin_version, '0.1.0-rc.3');
assert.equal(evidence.runtime.capability_version, '0.1.0-rc.3-capabilities.1');
assert.equal(evidence.runtime.manifest_version, '2026-07-agent-contract-rc3.1');
assert.equal(evidence.runtime.operator_confirmed_full_sketchup_restart, true);
assert.equal(evidence.installed_source.exact_workspace_match, true);
assert.equal(evidence.model.disk_sha256_before, COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(evidence.model.disk_sha256_after, COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(evidence.model.disk_bytes_unchanged, true);
assert.equal(evidence.prepare.approval_challenges_created, 0);
assert.equal(evidence.apply.submit_count, 1);
assert.equal(evidence.apply.authorization_mode, 'server_policy_copy_fast_session');
assert.equal(evidence.apply.receipt_status, 'finalized');
assert.equal(evidence.replay.idempotent_replay, true);
assert.equal(evidence.replay.duplicate_mutation, false);
assert.deepEqual(evidence.queue.before, cleanQueue());
assert.deepEqual(evidence.queue.after, cleanQueue());
assert.equal(evidence.release_acceptance, false);

for (const [label, mutate] of [
  ['server version', (value) => { value.runtime.server_version = '0.1.0-rc.2'; }],
  ['approval challenge', (value) => { value.prepare.approval_challenges_created = 1; }],
  ['duplicate mutation', (value) => { value.replay.duplicate_mutation = true; }]
]) {
  const invalid = structuredClone(evidence);
  mutate(invalid);
  await assert.rejects(
    () => assertCopyFastLiveEvidenceSchema(invalid),
    /Copy Fast live evidence schema failed/,
    `${label} tamper must fail the rc.3 evidence schema`
  );
}

const serialized = JSON.stringify(evidence);
assert.doesNotMatch(serialized, /\/Users\/|\/private\/|OneDrive/);
assert.doesNotMatch(serialized, /"(?:approval_token|signature|session_contract|source_path)"\s*:/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: evidence.version,
  evidence_sha256: sha256(evidenceBytes),
  baseline_commit: evidence.baseline_commit,
  source_hashes_verified: Object.keys(evidence.source_sha256).length,
  installed_plugin_files: evidence.installed_source.file_count,
  operation_count: evidence.runtime.operation_count,
  risk_level: evidence.prepare.risk_level,
  approval_challenges_created: evidence.prepare.approval_challenges_created,
  submit_count: evidence.apply.submit_count,
  duplicate_mutation: evidence.replay.duplicate_mutation,
  disk_bytes_unchanged: evidence.model.disk_bytes_unchanged,
  queue_clean: true,
  schema_negative_cases: 3,
  sensitive_paths_or_credentials_exposed: false,
  milestone_acceptance: evidence.apply.milestone_acceptance,
  release_acceptance: evidence.release_acceptance
}, null, 2)}\n`);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cleanQueue() {
  return {
    queue: 0,
    processing: 0,
    responses: 0,
    lock_exists: false
  };
}
