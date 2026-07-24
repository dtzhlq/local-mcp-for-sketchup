import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  PORTAL_BOOLEAN_BINDING,
  PORTAL_BOOLEAN_CURRENT_RUNTIME,
  PORTAL_BOOLEAN_V8_LOADED_RUNTIME,
  assertLivePortalBinding,
  assertNoSensitiveEvidence,
  assertPinnedCapabilities,
  assertPinnedPortalReview,
  assertPinnedStructuralEvidence,
  loadHistoricalPinnedPortalBindingsForLocalCapture
} from '../scripts/run-real-model-boolean-live.mjs';

if (!process.argv.includes('--local-capture')) {
  process.stderr.write(
    'LOCAL_CAPTURE_REQUIRED: this verifier reads ignored machine-local Portal Boolean captures; run npm run test:real-model-boolean-live-capture-local explicitly.\n'
  );
  process.exit(2);
}

let assertions = 0;
const pinned = await loadHistoricalPinnedPortalBindingsForLocalCapture();
const sourceSha256 = crypto.createHash('sha256')
  .update(await fs.readFile(PORTAL_BOOLEAN_BINDING.source_path))
  .digest('hex');
assert.equal(sourceSha256, PORTAL_BOOLEAN_BINDING.source_sha256); assertions += 1;

assert.equal(pinned.review.review.status, 'server_recommended'); assertions += 1;
assert.equal(pinned.review.review.recommended_proposal.target.entity_path, PORTAL_BOOLEAN_BINDING.target_path); assertions += 1;
assert.equal(pinned.review.review.recommended_proposal.tool.entity_path, PORTAL_BOOLEAN_BINDING.tool_path); assertions += 1;
assert.equal(pinned.lineage.primary_review, 'recursive-target-review-v2.json'); assertions += 1;
assert.equal(pinned.lineage.superseded_workflows_are_lineage_only, true); assertions += 1;
assert.equal(
  pinned.capabilities.runtime.boolean_operations_sha256,
  PORTAL_BOOLEAN_V8_LOADED_RUNTIME.boolean_operations_sha256
); assertions += 1;
assert.notEqual(
  PORTAL_BOOLEAN_V8_LOADED_RUNTIME.boolean_operations_sha256,
  PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256
); assertions += 1;
assert.throws(
  () => assertPinnedCapabilities(pinned.capabilities),
  /Pinned runtime Boolean source attestation drifted/
); assertions += 1;

const structuralPathDrift = structuredClone(pinned.structural);
structuralPathDrift.model_info.source_path = `${PORTAL_BOOLEAN_BINDING.source_path}.wrong`;
assert.throws(() => assertPinnedStructuralEvidence(structuralPathDrift), /source_path drifted/); assertions += 1;

const structuralRevisionDrift = structuredClone(pinned.structural);
structuralRevisionDrift.model_revision = `sha256:${'0'.repeat(64)}`;
assert.throws(() => assertPinnedStructuralEvidence(structuralRevisionDrift), /Model revision drifted/); assertions += 1;

const structuralManifoldDrift = structuredClone(pinned.structural);
structuralManifoldDrift.structural_groups.entries.find(
  (entry) => entry.entity_path === PORTAL_BOOLEAN_BINDING.tool_path
).manifold_attestation.is_manifold = false;
assert.throws(() => assertPinnedStructuralEvidence(structuralManifoldDrift), /lacks a fresh exact manifold attestation/); assertions += 1;

const reviewSourceDrift = structuredClone(pinned.review);
reviewSourceDrift.source.sha256 = `sha256:${'f'.repeat(64)}`;
assert.throws(() => assertPinnedPortalReview(reviewSourceDrift), /source hash drifted/); assertions += 1;

const reviewRoleDrift = structuredClone(pinned.review);
reviewRoleDrift.review.recommended_proposal.tool.entity_path = 'pid:999';
assert.throws(() => assertPinnedPortalReview(reviewRoleDrift), /tool path drifted/); assertions += 1;

assert.throws(() => assertLivePortalBinding({
  capabilities: pinned.capabilities,
  handshake: pinned.session,
  adoption: pinned.structural
}), /attest the exact loaded boolean_operations\.rb source/); assertions += 1;
assert.equal(
  pinned.capabilities?.runtime?.model_revision_source_sha256,
  PORTAL_BOOLEAN_V8_LOADED_RUNTIME.model_revision_source_sha256,
  'historical capture must preserve its exact loaded runtime attestations'
); assertions += 1;

const result = {
  ok: true,
  mode: 'explicit_machine_local_capture',
  assertions,
  raw_capture_files_read: true,
  raw_capture_hashes_verified: Object.keys(PORTAL_BOOLEAN_BINDING.artifacts).length,
  source_skp_hash_verified: true,
  capability_version: PORTAL_BOOLEAN_BINDING.capability_version,
  pinned_pair: [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path],
  review_recommendation: 'server_recommended',
  historical_loaded_runtime_verified: true,
  current_runtime_drift_fail_closed: true,
  authorized: false,
  live_queue_called: false,
  live_mutation_performed: false,
  sensitive_fields_exposed: false,
  release_acceptance: false
};
assert.doesNotThrow(() => assertNoSensitiveEvidence(result)); assertions += 1;
result.assertions = assertions;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
