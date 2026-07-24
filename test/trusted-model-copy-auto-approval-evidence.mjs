import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(testDir);
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

const mockSchema = await readJson('schema/trusted-model-copy-auto-approval-evidence-v1.schema.json');
const mockEvidence = await readJson('docs/evidence/trusted-model-copy-auto-approval-v1-mock-evidence.json');
const validateMock = ajv.compile(mockSchema);
assert.equal(validateMock(mockEvidence), true, JSON.stringify(validateMock.errors, null, 2));

const liveSchema = await readJson('schema/controlled-s4-delete-live-evidence-v1.schema.json');
const liveEvidence = await readJson('docs/evidence/controlled-s4-delete-live-evidence-2026-07-22.json');
const validateLive = ajv.compile(liveSchema);
assert.equal(validateLive(liveEvidence), true, JSON.stringify(validateLive.errors, null, 2));
assert.equal(liveEvidence.model.disk_sha256_before, liveEvidence.model.disk_sha256_after);
assert.notEqual(liveEvidence.apply.model_revision_before, liveEvidence.apply.model_revision_after);

for (const [relativePath, expected] of Object.entries(liveEvidence.source_sha256)) {
  const bytes = await fs.readFile(path.join(root, relativePath));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, `${relativePath} drifted after live capture`);
}

for (const mutate of [
  (value) => { value.policy.public_roots_exposed = true; },
  (value) => { value.results.outside_root_failed_closed = false; },
  (value) => { value.results.duplicate_mutation = true; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(mockEvidence);
  mutate(invalid);
  assert.equal(validateMock(invalid), false);
}

for (const mutate of [
  (value) => { value.prepare.configured_roots_exposed_to_agent = true; },
  (value) => { value.apply.receipt_status = 'prepared'; },
  (value) => { value.apply.empty_parent_absent = false; },
  (value) => { value.apply.queue_after.processing = 1; },
  (value) => { value.model.save_model = true; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(liveEvidence);
  mutate(invalid);
  assert.equal(validateLive(invalid), false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  mock_policy_evidence: true,
  current_source_s4_live_evidence: true,
  source_hashes_verified: Object.keys(liveEvidence.source_sha256).length,
  mock_negative_cases: 4,
  live_negative_cases: 6,
  release_acceptance: false
}, null, 2)}\n`);
