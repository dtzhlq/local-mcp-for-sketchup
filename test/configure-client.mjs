import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureInstalledBundle, knownClientTarget } from '../src/installer/configure-client.mjs';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-configure-client-')));
const bundleRoot = path.join(root, 'bundle');
const fakeHome = path.join(root, 'home');
await fs.mkdir(path.join(bundleRoot, 'node', 'bin'), { recursive: true });
await fs.mkdir(path.join(bundleRoot, 'app', 'src'), { recursive: true });
await fs.writeFile(path.join(bundleRoot, 'node', 'bin', 'node'), 'fixture');
await fs.writeFile(path.join(bundleRoot, 'app', 'src', 'mcp-server.mjs'), 'fixture');
await fs.writeFile(path.join(bundleRoot, 'bundle.json'), `${JSON.stringify({
  schema_version: 'local-mcp-service-bundle.v1',
  product: 'local-mcp-for-sketchup',
  version: '0.1.0-rc.4',
  target: 'darwin-arm64',
  entrypoint: {
    command_relative: 'node/bin/node',
    args_relative: ['app/src/mcp-server.mjs']
  }
})}\n`);

assert.equal(
  knownClientTarget('cursor', { homeDir: fakeHome }).configPath,
  path.join(fakeHome, '.cursor', 'mcp.json')
);

const codex = await configureInstalledBundle({
  bundleRoot,
  clientId: 'codex',
  homeDir: fakeHome,
  platform: 'darwin',
  arch: 'arm64'
});
assert.equal(codex.changed, true);
assert.equal(codex.config_path, path.join(fakeHome, '.codex', 'config.toml'));
assert.ok((await fs.readFile(codex.config_path, 'utf8')).includes('[mcp_servers.local-mcp-for-sketchup]'));

const cursor = await configureInstalledBundle({
  bundleRoot,
  clientId: 'cursor',
  homeDir: fakeHome,
  platform: 'darwin',
  arch: 'arm64'
});
assert.equal(cursor.changed, true);
assert.equal(JSON.parse(await fs.readFile(cursor.config_path, 'utf8')).mcpServers['local-mcp-for-sketchup'].command,
  path.join(bundleRoot, 'node', 'bin', 'node'));

const claude = await configureInstalledBundle({
  bundleRoot,
  clientId: 'claude-desktop',
  homeDir: fakeHome,
  platform: 'darwin',
  arch: 'arm64'
});
assert.equal(claude.mode, 'manual-or-dxt');
assert.equal(claude.changed, false);

const unknown = await configureInstalledBundle({
  bundleRoot,
  clientId: 'domestic-agent-fixture',
  homeDir: fakeHome,
  platform: 'darwin',
  arch: 'arm64'
});
assert.equal(unknown.mode, 'manual');
assert.ok(unknown.manual_snippet.includes('local-mcp-for-sketchup'));

await assert.rejects(
  configureInstalledBundle({
    bundleRoot,
    clientId: 'codex',
    homeDir: fakeHome,
    platform: 'win32',
    arch: 'x64'
  }),
  (error) => error?.code === 'SERVICE_BUNDLE_PLATFORM_MISMATCH'
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  codex_safe_merge: true,
  cursor_safe_merge: true,
  claude_manual_or_dxt: true,
  unknown_client_manual_only: true,
  wrong_platform_blocked: true
}, null, 2)}\n`);
