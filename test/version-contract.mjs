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
const [packageJson, packageLock, pluginLoaderSource, pluginBridgeSource] = await Promise.all([
  readJson('package.json'),
  readJson('package-lock.json'),
  fs.readFile(path.join(repoRoot, 'sketchup_plugin', 'local_mcp_for_sketchup.rb'), 'utf8'),
  fs.readFile(path.join(repoRoot, 'sketchup_plugin', 'local_mcp_for_sketchup', 'bridge.rb'), 'utf8')
]);

assert.equal(PRODUCT_VERSION, '0.1.0-rc.4');
assert.equal(packageJson.version, PRODUCT_VERSION);
assert.equal(packageLock.version, PRODUCT_VERSION);
assert.equal(packageLock.packages?.['']?.version, PRODUCT_VERSION);
assert.deepEqual(uniqueRubyConstant(pluginLoaderSource, 'PLUGIN_VERSION'), [PRODUCT_VERSION]);
assert.deepEqual(
  uniqueRubyConstant(pluginBridgeSource, 'RUNTIME_CAPABILITY_VERSION'),
  [RUNTIME_CAPABILITY_VERSION]
);
assert.deepEqual(
  uniqueRubyConstant(pluginBridgeSource, 'CAPABILITY_MANIFEST_VERSION'),
  [CAPABILITY_MANIFEST_VERSION]
);
assert.equal(RUNTIME_CAPABILITY_VERSION, '0.1.0-rc.4-capabilities.1');
assert.equal(CAPABILITY_MANIFEST_VERSION, '2026-07-agent-contract-rc4.1');

process.stdout.write(`${JSON.stringify({
  ok: true,
  product_version: PRODUCT_VERSION,
  runtime_capability_version: RUNTIME_CAPABILITY_VERSION,
  capability_manifest_version: CAPABILITY_MANIFEST_VERSION,
  package_lock_bound: true,
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
