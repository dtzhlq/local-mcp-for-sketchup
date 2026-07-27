import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeCodexToml, stdioServerSpec } from '../src/installer/agent-config.mjs';
import { mergeAgentConfigFile } from '../src/installer/config-writer.mjs';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-config-writer-')));
const configPath = path.join(root, '.codex', 'config.toml');
const spec = stdioServerSpec({
  nodePath: '/opt/local-mcp/runtime/node',
  serverPath: '/opt/local-mcp/app/src/mcp-server.mjs'
});

await fs.mkdir(path.dirname(configPath), { recursive: true });
await fs.writeFile(configPath, 'model = "gpt-5.6"\n', { mode: 0o600 });
const result = await mergeAgentConfigFile({
  configPath,
  expectedParent: root,
  now: () => new Date('2026-07-27T00:00:00.000Z'),
  merge: (text) => mergeCodexToml(text, spec)
});
assert.equal(result.changed, true);
assert.equal(await fs.readFile(result.backup_path, 'utf8'), 'model = "gpt-5.6"\n');
const installed = await fs.readFile(configPath, 'utf8');
assert.match(installed, /model = "gpt-5\.6"/);
assert.match(installed, /\[mcp_servers\.local-mcp-for-sketchup\]/);

const idempotent = await mergeAgentConfigFile({
  configPath,
  expectedParent: root,
  merge: (text) => mergeCodexToml(text, spec)
});
assert.equal(idempotent.changed, false);
assert.equal(idempotent.backup_path, null);

const outside = path.join(os.tmpdir(), 'outside-local-mcp-config.toml');
await assert.rejects(
  mergeAgentConfigFile({
    configPath: outside,
    expectedParent: root,
    merge: (text) => mergeCodexToml(text, spec)
  }),
  (error) => error?.code === 'AGENT_CONFIG_PATH_OUTSIDE_ALLOWED_ROOT'
);

await fs.rm(root, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({
  ok: true,
  backup_created: true,
  atomic_replace: true,
  idempotent: true,
  outside_root_rejected: true
}, null, 2)}\n`);
