import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const historicalModelPath = path.join(
  repoRoot,
  'output',
  'live-validation',
  'next-models',
  'controlled-s4-delete-2026-07-22-v1',
  'Fire Escape.disposable.skp'
);
const historicalModelSha256 = '7e649c220a265a5e27a24aae2ed9687427186c06ba335616d5cdc0191966ce72';
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
const schema = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'schema', 'copy-fast-session-live-evidence-v1.schema.json'),
  'utf8'
));
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { 'date-time': true }
}).compile(schema);
assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
assert.equal(evidence.version, 'copy-fast-session-live.v1');
assert.equal(evidence.runtime.plugin_version, '0.1.0-rc.2');
assert.equal(evidence.runtime.capability_version, '0.1.0-rc.2-capabilities.7');
assert.equal(evidence.runtime.manifest_version, '2026-07-agent-contract-v1.4');

const modelBytes = await fs.readFile(historicalModelPath);
assert.equal(sha256(modelBytes), historicalModelSha256);
assert.equal(modelBytes.length, evidence.model.size_bytes);
assert.equal(evidence.model.disk_sha256_before, historicalModelSha256);
assert.equal(evidence.model.disk_sha256_after, historicalModelSha256);
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
  frozen_source_hashes: Object.keys(evidence.source_sha256).length,
  historical_lineage_only: true,
  current_source_binding_checked: false,
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
