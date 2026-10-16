import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validateAgentInstallManifest } from '../scripts/validate-agent-install-manifest.mjs';

const draft = JSON.parse(await fs.readFile('release/agent-install.v1.template.json', 'utf8'));
const draftReport = await validateAgentInstallManifest(draft);
assert.equal(draftReport.ok, true, JSON.stringify(draftReport.errors));
assert.equal(draftReport.status, 'draft');
assert.deepEqual(draftReport.platforms, [
  'darwin-arm64-sketchup-2026'
]);

const prematureRelease = structuredClone(draft);
prematureRelease.status = 'release';
const releaseReport = await validateAgentInstallManifest(prematureRelease, { requireRelease: true });
assert.equal(releaseReport.ok, false);
assert.ok(releaseReport.errors.some((error) => error.includes('placeholder')));
assert.ok(releaseReport.errors.some((error) => error.includes('Signing Portal')));
assert.ok(releaseReport.errors.some((error) => error.includes('release_acceptance')));

// The explicit v0.4.2 policy keeps skipped persistence checks false, while
// requiring the actual create/edit/view and target-scope evidence instead.
assert.ok(releaseReport.errors.some(error => error.includes('native_create_edit_view_verified')));
assert.ok(!releaseReport.errors.some(error => error.includes('save_close_reopen_verified')));
const mismatchedPolicy = structuredClone(prematureRelease);
mismatchedPolicy.acceptance.validation_policy = 'timber-v040-minimal.v1';
assert.ok((await validateAgentInstallManifest(mismatchedPolicy, {requireRelease: true})).errors.some(error => error.includes('limited to v0.4.0')));
const mismatchedVersion = structuredClone(prematureRelease);
mismatchedVersion.product.version = '0.4.1';
assert.ok((await validateAgentInstallManifest(mismatchedVersion, {requireRelease: true})).errors.some(error => error.includes('limited to v0.4.2')));
const previousPolicy = structuredClone(prematureRelease);
previousPolicy.acceptance.validation_policy = 'assembly-v041-minimal.v1';
const previousPolicyReport = await validateAgentInstallManifest(previousPolicy, {requireRelease: true});
assert.equal(previousPolicyReport.schema_valid, true, 'previous release policy remains in the schema');
assert.ok(previousPolicyReport.errors.some(error => error.includes('limited to v0.4.1')));
const legacy = structuredClone(prematureRelease);
legacy.acceptance.validation_policy = 'legacy-full.v1';
assert.ok((await validateAgentInstallManifest(legacy, {requireRelease: true})).errors.some(error => error.includes('save_close_reopen_verified')));

// A complete minimal-policy manifest must validate without upgrading skipped
// persistence checks to true. These are synthetic manifest fields only: the
// test makes no live SketchUp or release-acceptance claim.
const completeRelease = JSON.parse(JSON.stringify(prematureRelease)
  .replaceAll('example.invalid', 'github.com')
  .replaceAll('example-owner', 'test-owner')
  .replaceAll('0'.repeat(64), 'a'.repeat(64))
  .replaceAll('0'.repeat(40), 'b'.repeat(40)));
completeRelease.acceptance.release_acceptance = true;
completeRelease.platforms[0].rbz.sketchup_officially_signed = true;
const requiredMinimalEvidence = [
  'live_sketchup_2026',
  'signed_rbz_loaded',
  'native_create_edit_view_verified',
  'target_scope_verified',
  'signed_payload_verified'
];
for (const field of requiredMinimalEvidence) completeRelease.acceptance.platforms[0][field] = true;
const completeReport = await validateAgentInstallManifest(completeRelease, {requireRelease: true});
assert.equal(completeReport.ok, true, JSON.stringify(completeReport.errors));
assert.equal(completeRelease.acceptance.platforms[0].save_close_reopen_verified, false);
assert.equal(completeRelease.acceptance.platforms[0].offline_after_install_verified, false);
for (const field of requiredMinimalEvidence) {
  const missingEvidence = structuredClone(completeRelease);
  missingEvidence.acceptance.platforms[0][field] = false;
  const missingReport = await validateAgentInstallManifest(missingEvidence, {requireRelease: true});
  assert.equal(missingReport.ok, false);
  assert.deepEqual(missingReport.errors, [`darwin-arm64-sketchup-2026.${field} must be true`]);
}
const unsupportedMinimalPlatform = structuredClone(completeRelease);
unsupportedMinimalPlatform.acceptance.platforms[0].id = 'win32-x64-sketchup-2026';
const unsupportedReport = await validateAgentInstallManifest(unsupportedMinimalPlatform, {requireRelease: true});
assert.ok(unsupportedReport.errors.some(error => error.includes('workflow-v042-minimal.v1 is limited to v0.4.2 on Apple Silicon macOS')));

const intelMac = structuredClone(draft);
intelMac.platforms.push({
  ...structuredClone(intelMac.platforms[0]),
  id: 'darwin-x64-sketchup-2026',
  arch: 'x64'
});
const intelReport = await validateAgentInstallManifest(intelMac);
assert.equal(intelReport.ok, false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  draft_schema_valid: draftReport.schema_valid,
  premature_release_blocked: true,
  unsigned_rbz_blocked: true,
  incomplete_acceptance_blocked: true,
  current_minimal_policy_accepts_explicit_skips: true,
  current_minimal_policy_requires_native_evidence: true,
  minimal_policy_version_and_platform_bound: true,
  previous_minimal_policy_retained: true,
  intel_mac_excluded: true
}, null, 2)}\n`);
