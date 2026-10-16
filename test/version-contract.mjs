import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_MANIFEST_VERSION,
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [packageJson, packageLock, publicPackageJson, publicPackageLock, installTemplate, pluginSource] = await Promise.all([
  readJson('package.json'),
  readJson('package-lock.json'),
  readJson('release/public-package.json'),
  readJson('release/public-package-lock.json'),
  readJson('release/agent-install.v1.template.json'),
  fs.readFile(path.join(repoRoot, 'sketchup_plugin', 'alma_sketchup_mcp.rb'), 'utf8')
]);

assert.equal(PRODUCT_VERSION, '0.4.2');
for (const packageMetadata of [packageJson, publicPackageJson]) {
  assert.equal(packageMetadata.version, PRODUCT_VERSION);
}
assert.equal(publicPackageJson.scripts['regression:check'], packageJson.scripts['regression:check']);
assert.equal(publicPackageJson.scripts['regression:check'], 'node scripts/run-core-check.mjs --extended');
for (const lockfile of [packageLock, publicPackageLock]) {
  assert.equal(lockfile.version, PRODUCT_VERSION);
  assert.equal(lockfile.packages?.['']?.version, PRODUCT_VERSION);
}
assert.equal(installTemplate.product.version, PRODUCT_VERSION);
assert.equal(installTemplate.source.tag, `v${PRODUCT_VERSION}`);
assert.equal(installTemplate.acceptance.validation_policy, 'workflow-v042-minimal.v1');
assert.ok(installTemplate.manifest_delivery.immutable_url.includes(`/v${PRODUCT_VERSION}/`));
for (const platform of installTemplate.platforms) {
  assert.equal(platform.service_bundle.file_name, `${packageJson.name}-${PRODUCT_VERSION}-${platform.os}-${platform.arch}.tar.gz`);
  assert.equal(platform.rbz.file_name, `${packageJson.name}-${PRODUCT_VERSION}.rbz`);
  for (const artifact of [platform.service_bundle, platform.rbz]) {
    assert.ok(artifact.url.endsWith(`/v${PRODUCT_VERSION}/${artifact.file_name}`));
  }
}
for (const evidence of [installTemplate.acceptance.core_gate, ...installTemplate.acceptance.platforms.map(platform => platform.evidence)]) {
  assert.ok(evidence.url.includes(`/v${PRODUCT_VERSION}/`));
}
assert.deepEqual(uniqueRubyConstant(pluginSource, 'PLUGIN_VERSION'), [PRODUCT_VERSION]);
assert.deepEqual(
  uniqueRubyConstant(pluginSource, 'RUNTIME_CAPABILITY_VERSION'),
  [RUNTIME_CAPABILITY_VERSION]
);
assert.deepEqual(
  uniqueRubyConstant(pluginSource, 'CAPABILITY_MANIFEST_VERSION'),
  [CAPABILITY_MANIFEST_VERSION]
);
assert.equal(RUNTIME_CAPABILITY_VERSION, '0.4.2-workflows.1');
assert.equal(CAPABILITY_MANIFEST_VERSION, '2026-09-modeling-uplift-alpha.1');

process.stdout.write(`${JSON.stringify({
  ok: true,
  product_version: PRODUCT_VERSION,
  runtime_capability_version: RUNTIME_CAPABILITY_VERSION,
  capability_manifest_version: CAPABILITY_MANIFEST_VERSION,
  package_lock_bound: true,
  public_package_lock_bound: true,
  release_template_bound: true,
  plugin_loader_bound: true,
  live_queue_called: false
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function uniqueRubyConstant(source, name) {
  return [...source.matchAll(new RegExp(`^\\s*${name}\\s*=\\s*'([^'\\r\\n]+)'\\s*$`, 'gm'))]
    .map((match) => match[1]);
}
