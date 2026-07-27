import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validateAgentInstallManifest } from '../scripts/validate-agent-install-manifest.mjs';

const draft = JSON.parse(await fs.readFile('release/agent-install.v1.template.json', 'utf8'));
const draftReport = await validateAgentInstallManifest(draft);
assert.equal(draftReport.ok, true, JSON.stringify(draftReport.errors));
assert.equal(draftReport.status, 'draft');
assert.deepEqual(draftReport.platforms, [
  'darwin-arm64-sketchup-2026',
  'win32-x64-sketchup-2026'
]);

const prematureRelease = structuredClone(draft);
prematureRelease.status = 'release';
const releaseReport = await validateAgentInstallManifest(prematureRelease, { requireRelease: true });
assert.equal(releaseReport.ok, false);
assert.ok(releaseReport.errors.some((error) => error.includes('placeholder')));
assert.ok(releaseReport.errors.some((error) => error.includes('Signing Portal')));
assert.ok(releaseReport.errors.some((error) => error.includes('release_acceptance')));

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
  intel_mac_excluded: true
}, null, 2)}\n`);
