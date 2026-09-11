import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read = file => fs.readFile(file, 'utf8');
const [entry, readme, install] = await Promise.all(['INSTALL_FOR_AGENTS.md', 'README.md', 'docs/INSTALL.md'].map(read));
// Regression: a stable shared sentence must resolve a release, not the older main implementation.
assert.ok(readme.includes('INSTALL_FOR_AGENTS.md'));
for (const host of ['github.com', 'gitee.com']) assert.ok(readme.includes(`https://${host}/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md`));
assert.ok(entry.includes('https://api.github.com/repos/dtzhlq/local-mcp-for-sketchup/releases/latest'));
assert.match(entry, /draft=false.*prerelease=false/);
assert.ok(entry.includes('SHA256SUMS.txt') && entry.includes('source.commit') && entry.includes('manifest.product.tool_count'));
assert.match(entry, /Freeze that release tag/);
assert.match(entry, /Never combine a server, plugin/);
assert.match(entry, /Do not silently downgrade/);
assert.match(entry, /replace that entry's old executable\/server paths/);
assert.match(entry, /tools\/list success alone does not prove live SketchUp/);
assert.doesNotMatch(entry, /npm run source-preview:|npm ci --ignore-scripts|releases\/download\/v0\.1\./);
assert.ok(install.includes('Do not install main source'));
process.stdout.write('PASS: release discovery, immutable binding, upgrade/rollback, mirror boundaries and removal of legacy installation commands\n');
