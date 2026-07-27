import assert from 'node:assert/strict';
import {
  mergeCodexToml,
  mergeJsonMcpConfig,
  renderManualMcpSnippet,
  stdioServerSpec
} from '../src/installer/agent-config.mjs';

const spec = stdioServerSpec({
  nodePath: '/Applications/Local MCP for SketchUp/runtime/node',
  serverPath: '/Applications/Local MCP for SketchUp/app/src/mcp-server.mjs'
});

const codexOriginal = 'model = "gpt-5.6"\n\n[mcp_servers.existing]\ncommand = "existing"\n';
const codexMerged = mergeCodexToml(codexOriginal, spec);
assert.equal(codexMerged.changed, true);
assert.match(codexMerged.text, /model = "gpt-5\.6"/);
assert.match(codexMerged.text, /\[mcp_servers\.existing\]/);
assert.match(codexMerged.text, /\[mcp_servers\.local-mcp-for-sketchup\]/);
assert.equal(mergeCodexToml(codexMerged.text, spec).changed, false);
assert.throws(
  () => mergeCodexToml(`${codexOriginal}\n[mcp_servers.local-mcp-for-sketchup]\ncommand = "unknown"\n`, spec),
  (error) => error?.code === 'AGENT_CONFIG_CONFLICT'
);

const jsonOriginal = JSON.stringify({
  theme: 'dark',
  mcpServers: {
    existing: { command: 'existing', args: [] }
  }
});
const jsonMerged = mergeJsonMcpConfig(jsonOriginal, spec);
assert.equal(jsonMerged.changed, true);
const parsed = JSON.parse(jsonMerged.text);
assert.equal(parsed.theme, 'dark');
assert.deepEqual(parsed.mcpServers.existing, { command: 'existing', args: [] });
assert.deepEqual(parsed.mcpServers['local-mcp-for-sketchup'], spec);
assert.equal(mergeJsonMcpConfig(jsonMerged.text, spec).changed, false);
assert.throws(
  () => mergeJsonMcpConfig('{"mcpServers":{"local-mcp-for-sketchup":{"command":"unknown"}}}', spec),
  (error) => error?.code === 'AGENT_CONFIG_CONFLICT'
);

const manual = JSON.parse(renderManualMcpSnippet(spec));
assert.deepEqual(manual.mcpServers['local-mcp-for-sketchup'], spec);
assert.throws(
  () => stdioServerSpec({ nodePath: 'node', serverPath: 'src/mcp-server.mjs' }),
  (error) => error?.code === 'AGENT_CONFIG_ABSOLUTE_PATH_REQUIRED'
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  codex_toml_unknown_keys_preserved: true,
  json_unknown_keys_preserved: true,
  conflicting_entries_overwritten: false,
  manual_snippet_available: true
}, null, 2)}\n`);
