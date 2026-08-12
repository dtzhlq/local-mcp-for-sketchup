import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const readme = await fs.readFile('README.md', 'utf8');
const installDoc = await fs.readFile('docs/INSTALL.md', 'utf8');
const agentEntry = await fs.readFile('INSTALL_FOR_AGENTS.md', 'utf8');

const guideUrls = [
  'https://gitee.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md',
  'https://github.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md'
];
for (const url of guideUrls) assert.ok(readme.includes(url), `README missing ${url}`);

const linkFreePrompt =
  '请在码云搜索用户 dtzhlq 的项目 local-mcp-for-sketchup，读取主分支根目录的';
assert.ok(readme.includes(linkFreePrompt), 'README missing the link-free Agent prompt');
assert.match(readme, /INSTALL_FOR_AGENTS\.md 并严格执行；找不到就停止，不要猜测或从第三方下载/);
assert.ok(
  readme.indexOf(linkFreePrompt) < readme.indexOf(guideUrls[0]),
  'README must present the link-free prompt before direct URLs'
);

const releaseIdentity = [
  'v0.1.0-rc.4.unsigned.1',
  'ef8d40ac0427c6917d01510dcb54043374921e5e',
  'local-mcp-for-sketchup-0.1.0-rc.4-nonrelease-unsigned-preview.rbz',
  '91481',
  '4d3517ed90654bddc278cf3c099c5c240816b65dcd2e75fe15c8465dd46c398a'
];
for (const value of releaseIdentity) {
  assert.ok(agentEntry.includes(value), `Agent entry missing release value ${value}`);
}

for (const mirror of ['gitee.com', 'github.com']) {
  assert.ok(agentEntry.includes(`https://${mirror}/dtzhlq/local-mcp-for-sketchup/releases/download/`));
}

assert.match(agentEntry, /full_auto_install_available: false/);
assert.match(agentEntry, /release_acceptance: false/);
assert.match(agentEntry, /plugin-preview-only/);
assert.match(agentEntry, /mcp_service_installed: false/);
assert.match(agentEntry, /mcp_config_modified: false/);
assert.match(agentEntry, /Never lower\s+that policy/);
assert.doesNotMatch(agentEntry, /example\.invalid/);

assert.match(readme, /无签名技术预览/);
assert.match(readme, /不能\s*声称完整 MCP 已经安装/);
assert.match(installDoc, /unsigned plugin-only technical preview/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  entrypoint: 'INSTALL_FOR_AGENTS.md',
  customer_prompts: guideUrls.length + 1,
  primary_prompt: 'link-free-gitee-search',
  mirrors: 2,
  current_outcome: 'plugin-preview-only',
  full_auto_install_available: false
}, null, 2)}\n`);
