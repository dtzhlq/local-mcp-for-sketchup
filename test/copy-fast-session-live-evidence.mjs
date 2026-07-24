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
  'copy-fast-session-v1-live-evidence-2026-07-24.json'
);
const evidenceBytes = await fs.readFile(evidencePath);
const evidence = JSON.parse(evidenceBytes);

assert.equal(
  sha256(evidenceBytes),
  '0968b72f268243e22c60e0b46c32d1f01d179a4fe01367de1e6cc168be7c4d80',
  'public Copy Fast live evidence bytes drifted'
);
assert.equal(await assertCopyFastLiveEvidenceSchema(evidence), true);
assert.equal(assertCopyFastLiveEvidenceBindings(evidence), true);

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  const actual = sha256(await fs.readFile(path.join(repoRoot, relativePath)));
  assert.equal(actual, expected, `${relativePath} drifted after the Copy Fast live capture`);
}

const modelBytes = await fs.readFile(COPY_FAST_LIVE_DEFAULT_MODEL);
assert.equal(sha256(modelBytes), COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(modelBytes.length, evidence.model.size_bytes);
assert.equal(evidence.model.disk_sha256_before, COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(evidence.model.disk_sha256_after, COPY_FAST_LIVE_MODEL_SHA256);
assert.equal(evidence.model.disk_bytes_unchanged, true);
assert.equal(evidence.prepare.approval_challenges_created, 0);
assert.equal(evidence.apply.authorization_mode, 'server_policy_copy_fast_session');
assert.equal(evidence.apply.receipt_status, 'finalized');
assert.equal(evidence.replay.idempotent_replay, true);
assert.equal(evidence.replay.duplicate_mutation, false);
assert.deepEqual(evidence.queue.before, cleanQueue());
assert.deepEqual(evidence.queue.after, cleanQueue());
assert.equal(evidence.release_acceptance, false);

const serialized = JSON.stringify(evidence);
assert.doesNotMatch(serialized, /\/Users\/|\/private\/|OneDrive/);
assert.doesNotMatch(serialized, /"(?:approval_token|signature|session_contract|source_path)"\s*:/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: evidence.version,
  evidence_sha256: sha256(evidenceBytes),
  source_hashes_verified: Object.keys(evidence.source_sha256).length,
  installed_plugin_files: evidence.installed_source.file_count,
  operation_count: evidence.runtime.operation_count,
  risk_level: evidence.prepare.risk_level,
  approval_challenges_created: evidence.prepare.approval_challenges_created,
  duplicate_mutation: evidence.replay.duplicate_mutation,
  disk_bytes_unchanged: evidence.model.disk_bytes_unchanged,
  queue_clean: true,
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
