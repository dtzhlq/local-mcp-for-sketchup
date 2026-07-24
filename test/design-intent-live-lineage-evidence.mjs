import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve('.');
const evidencePath = 'docs/evidence/design-intent-live-lineage-evidence-2026-07-23.json';
const schemaPath = 'schema/design-intent-live-lineage-evidence-v1.schema.json';
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
const evidence = await readJson(evidencePath);
const schema = await readJson(schemaPath);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assertNoAbsoluteLocalPaths(evidence); assertions += 1;
assertNoSensitiveKeys(evidence); assertions += 1;

const attestedPaths = evidence.source_attestation.map((entry) => entry.path);
assert.equal(new Set(attestedPaths).size, attestedPaths.length); assertions += 1;
for (const entry of evidence.source_attestation) {
  assert.equal(`sha256:${await sha256File(entry.path)}`, entry.sha256, `${entry.path} drifted after live capture`);
  assertions += 1;
}
assert.equal(
  `sha256:${await sha256File(evidence.baseline.mock_evidence_artifact)}`,
  evidence.baseline.mock_evidence_sha256
); assertions += 1;
assert.equal(
  `fixture:sha256:${await sha256File(evidence.fixture.working_copy_artifact)}`,
  evidence.fixture.saved_fixture_handle
); assertions += 1;
assert.equal(
  (await fs.stat(path.join(repoRoot, evidence.fixture.working_copy_artifact))).size,
  evidence.fixture.size_bytes
); assertions += 1;

assert.equal(evidence.lineage.task_resumed_by_task_id, true); assertions += 1;
assert.equal(evidence.lineage.model_revision_exact_after_restart, true); assertions += 1;
assert.equal(evidence.lineage.feature_history_versions_before_restart, 1); assertions += 1;
assert.equal(evidence.lineage.feature_history_versions_after_restart, 1); assertions += 1;
assert.equal(evidence.lineage.aligned_reconciliation_completed, true); assertions += 1;
assert.equal(evidence.manual_divergence.model_revision_changed, true); assertions += 1;
assert.equal(evidence.manual_divergence.proposed_operation_count, 0); assertions += 1;
assert.equal(evidence.manual_divergence.unexpected_divergence_count, 1); assertions += 1;
assert.equal(evidence.manual_divergence.review_required, true); assertions += 1;
assert.equal(evidence.manual_divergence.silent_overwrite_allowed, false); assertions += 1;
assert.equal(evidence.manual_divergence.approval_decision_recorded, false); assertions += 1;
assert.equal(evidence.manual_divergence.agent_supplied_decision_error_code, 'APPROVAL_REQUIRED'); assertions += 1;
assert.equal(evidence.manual_divergence.feature_history_advanced_without_trusted_review, false); assertions += 1;
assert.equal(evidence.manual_divergence.disk_bytes_unchanged_after_divergence, true); assertions += 1;
assert.equal(evidence.safety.divergence_saved, false); assertions += 1;
assert.equal(evidence.acceptance.silent_overwrite_count, 0); assertions += 1;
assert.equal(evidence.acceptance.unauthorized_reconciliation_count, 0); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const negativeDocuments = [
  { ...evidence, acceptance: { ...evidence.acceptance, release_acceptance: true } },
  { ...evidence, manual_divergence: { ...evidence.manual_divergence, proposed_operation_count: 1 } },
  { ...evidence, manual_divergence: { ...evidence.manual_divergence, silent_overwrite_allowed: true } },
  { ...evidence, manual_divergence: { ...evidence.manual_divergence, approval_decision_recorded: true } },
  { ...evidence, manual_divergence: { ...evidence.manual_divergence, feature_history_versions_after_review: 2 } },
  { ...evidence, runtime: { ...evidence.runtime, session_changed_from_capture: false } },
  { ...evidence, lineage: { ...evidence.lineage, model_revision_exact_after_restart: false } },
  { ...evidence, safety: { ...evidence.safety, divergence_saved: true } }
];
for (const document of negativeDocuments) {
  assert.equal(validate(document), false);
  assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence: evidencePath,
  live_save_restart_lineage_stable: true,
  manual_divergence_detected: true,
  silent_overwrite_count: 0,
  unauthorized_reconciliation_count: 0,
  cross_version_claimed: false,
  negative_cases: negativeDocuments.length,
  assertions
}, null, 2)}\n`);

async function sha256File(relativePath) {
  return crypto.createHash('sha256')
    .update(await fs.readFile(path.join(repoRoot, relativePath)))
    .digest('hex');
}

function assertNoAbsoluteLocalPaths(value) {
  assert.doesNotMatch(JSON.stringify(value), /(?:file:\/\/|\/Users\/|\/var\/folders\/|[A-Za-z]:\\\\)/);
}

function assertNoSensitiveKeys(value) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (!key.toLowerCase().endsWith('_exposed')) {
        assert.doesNotMatch(key.toLowerCase(), /(?:^|_)(?:token|secret|password|cookie|session_id|document_id)(?:$|_)/);
      }
      visit(child);
    }
  };
  visit(value);
}
