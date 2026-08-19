import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureSourcePreview } from '../src/installer/configure-source-preview.mjs';
import { verifySourcePreview } from '../src/installer/source-preview.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-source-config-')));

try {
  const verified = await verifySourcePreview({
    checkoutRoot: repoRoot,
    requireGitProvenance: false,
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: '24.18.0'
  });
  assert.equal(verified.channel, 'source-technical-preview');
  assert.equal(verified.mcp_stdio.verified, true);
  assert.equal(verified.mcp_stdio.tools, 42);
  assert.equal(verified.live_sketchup_verified, false);
  assert.equal(verified.release_acceptance, false);

  await assert.rejects(
    verifySourcePreview({
      checkoutRoot: repoRoot,
      requireGitProvenance: false,
      runHandshake: false,
      platform: 'darwin',
      arch: 'arm64',
      nodeVersion: '23.11.0'
    }),
    (error) => error?.code === 'SOURCE_PREVIEW_NODE_UNSUPPORTED'
  );
  await assert.rejects(
    verifySourcePreview({
      checkoutRoot: repoRoot,
      requireGitProvenance: false,
      runHandshake: false,
      platform: 'darwin',
      arch: 'x64',
      nodeVersion: '24.18.0'
    }),
    (error) => error?.code === 'SOURCE_PREVIEW_PLATFORM_UNSUPPORTED'
  );

  const dryRun = await configureSourcePreview({
    checkoutRoot: repoRoot,
    clientId: 'codex',
    homeDir: fakeHome,
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: '24.18.0',
    requireGitProvenance: false,
    runHandshake: false
  });
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.changed, false);
  assert.equal(await pathExists(path.join(fakeHome, '.codex', 'config.toml')), false);

  const applied = await configureSourcePreview({
    checkoutRoot: repoRoot,
    clientId: 'codex',
    apply: true,
    homeDir: fakeHome,
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: '24.18.0',
    requireGitProvenance: false,
    runHandshake: false
  });
  assert.equal(applied.changed, true);
  const codexConfig = await fs.readFile(path.join(fakeHome, '.codex', 'config.toml'), 'utf8');
  assert.match(codexConfig, /\[mcp_servers\.local-mcp-for-sketchup\]/);
  assert.ok(codexConfig.includes(process.execPath));
  assert.ok(codexConfig.includes(path.join(repoRoot, 'src', 'mcp-server.mjs')));

  const cursorApplied = await configureSourcePreview({
    checkoutRoot: repoRoot,
    clientId: 'cursor',
    apply: true,
    homeDir: fakeHome,
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: '24.18.0',
    requireGitProvenance: false,
    runHandshake: false
  });
  assert.equal(cursorApplied.changed, true);
  const cursorConfig = JSON.parse(await fs.readFile(path.join(fakeHome, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(cursorConfig.mcpServers['local-mcp-for-sketchup'].command, process.execPath);
  assert.deepEqual(
    cursorConfig.mcpServers['local-mcp-for-sketchup'].args,
    [path.join(repoRoot, 'src', 'mcp-server.mjs')]
  );

  const unknown = await configureSourcePreview({
    checkoutRoot: repoRoot,
    clientId: 'domestic-agent-fixture',
    homeDir: fakeHome,
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: '24.18.0',
    requireGitProvenance: false,
    runHandshake: false
  });
  assert.equal(unknown.mode, 'manual');
  assert.equal(unknown.changed, false);
  assert.match(unknown.manual_snippet, /local-mcp-for-sketchup/);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    source_preview_check: true,
    mcp_stdio_tools: 42,
    codex_dry_run_default: true,
    codex_safe_apply: true,
    cursor_safe_apply: true,
    unknown_client_manual_only: true,
    live_sketchup_verified: false,
    release_acceptance: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(fakeHome, { recursive: true, force: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
