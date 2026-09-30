#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCT_VERSION } from '../src/version.mjs';
import { TOOL_NAMES } from '../src/tool-registry.mjs';
import { serviceBundleRuntimeDirectories } from './package-service-bundle.mjs';

const [bundleArg, reportArg, archiveArg] = process.argv.slice(2);
assert.ok(bundleArg && reportArg && archiveArg, 'Expected bundle, report and archive paths.');
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const bundle = path.resolve(bundleArg);
const app = path.join(bundle, 'app');
const meta = JSON.parse(await fs.readFile(path.join(bundle, 'bundle.json'), 'utf8'));
assert.equal(meta.target, 'win32-x64');
assert.equal(meta.version, PRODUCT_VERSION);
assert.equal(meta.bundled_node.version, process.versions.node);
assert.equal(path.resolve(process.execPath).toLowerCase(), path.join(bundle, 'node', 'node.exe').toLowerCase());
assert.ok(/\s/.test(bundle) && /[^\x00-\x7f]/.test(bundle), 'Use a path with spaces and non-ASCII characters.');
const installedVersion = await import(pathToFileURL(path.join(app, 'src/version.mjs')));
assert.equal(installedVersion.PRODUCT_VERSION, PRODUCT_VERSION);

// Compare every shipped runtime file, including schema, Ruby and timber data,
// with this run's source. A version string alone cannot establish synchronization.
const sourceFiles = [];
for (const directory of serviceBundleRuntimeDirectories) {
  const expected = await filesBelow(path.join(sourceRoot, directory));
  assert.deepEqual(await filesBelow(path.join(app, directory)), expected);
  for (const file of expected) {
    const relative = `${directory}/${file}`;
    const bytes = await fs.readFile(path.join(sourceRoot, relative));
    assert.equal(sha256(await fs.readFile(path.join(app, relative))), sha256(bytes), relative);
    sourceFiles.push(`${sha256(bytes)}  ${relative}`);
  }
}
for (const file of ['package.json', 'package-lock.json']) {
  assert.equal(sha256(await fs.readFile(path.join(app, file))),
    sha256(await fs.readFile(path.join(sourceRoot, 'release', `public-${file}`))), file);
}

const stateRoot = path.join(app, '.windows-verification-state');
const testRoot = path.join(app, 'test');
const exampleRoot = path.join(app, 'examples');
for (const directory of [stateRoot, testRoot, exampleRoot]) {
  await assert.rejects(fs.lstat(directory), { code: 'ENOENT' });
}
const testEnv = {
  ...process.env,
  NODE_PATH: '',
  LOCAL_MCP_FOR_SKETCHUP_STATE_DIR: stateRoot,
  ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES: 'mock',
  ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION: '0'
};
let protocol;
const checks = {};
try {
  protocol = await checkMcp();
  // Only fixtures are copied. Imports resolve to installed src/node_modules,
  // and Windows never runs npm install or uses checkout dependencies.
  await fs.cp(path.join(sourceRoot, 'examples/cad-kernel'), path.join(exampleRoot, 'cad-kernel'), { recursive: true });
  for (const [name, fixture] of [
    ['image_structure', 'image-structure.mjs'],
    ['cad_geometry_and_editing', 'cad-kernel/core.mjs'],
    ['cad_surfaces_and_fillets', 'cad-kernel/surfaces.mjs'],
    ['traditional_timber', 'traditional-timber-rules.mjs']
  ]) {
    const destination = path.join(testRoot, fixture);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(sourceRoot, 'test', fixture), destination);
    checks[name] = await runFixture(destination);
  }
} finally {
  for (const directory of [stateRoot, testRoot, exampleRoot]) {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const archive = await fs.readFile(archiveArg);
const report = {
  schema_version: 'windows-installed-check.v2',
  passed: true,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  product_version: PRODUCT_VERSION,
  source_commit: process.env.GITHUB_SHA || null,
  installed_bundled_node: true,
  unicode_space_path: true,
  runtime_source_files_verified: sourceFiles.length,
  runtime_source_sha256: sha256(Buffer.from(sourceFiles.sort().join('\n') + '\n')),
  archive: { file_name: path.basename(archiveArg), sha256: sha256(archive), size_bytes: archive.length },
  mcp: protocol,
  checks,
  live_sketchup_verified: false,
  release_acceptance: false,
  scope: 'Installed Windows server, runtime source identity, native image dependencies, offline modeling/CAD and timber rules. SketchUp is unavailable on the CI runner.'
};
await fs.mkdir(path.dirname(path.resolve(reportArg)), { recursive: true });
await fs.writeFile(reportArg, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function filesBelow(root, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesBelow(root, relative));
    else {
      assert.ok(entry.isFile(), `Unexpected runtime entry: ${relative}`);
      files.push(relative);
    }
  }
  return files.sort();
}

function checkMcp() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(app, 'src/mcp-server.mjs')], {
      cwd: bundle, env: testEnv, stdio: ['pipe', 'pipe', 'pipe']
    });
    let buffer = '', errors = '', server, finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error(`MCP timeout: ${errors.slice(-1000)}`)), 30000);
    const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('close', code => { if (!finished) finish(new Error(`MCP exited ${code}: ${errors.slice(-1000)}`)); });
    child.stderr.on('data', data => { errors += data; });
    child.stdout.on('data', data => {
      try {
        buffer += data;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          assert.ok(!message.error, JSON.stringify(message.error));
          if (message.id === 1) {
            server = message.result.serverInfo;
            assert.equal(server.version, PRODUCT_VERSION);
            send({ method: 'notifications/initialized' });
            send({ id: 2, method: 'tools/list' });
          } else if (message.id === 2) {
            assert.deepEqual(message.result.tools.map(tool => tool.name).sort(), [...TOOL_NAMES].sort());
            finish(null, { server, tool_count: TOOL_NAMES.length });
          }
        }
      } catch (error) { finish(error); }
    });
    send({ id: 1, method: 'initialize', params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'windows-installed-check', version: '2' }
    } });
  });
}

function runFixture(fixture) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture], { cwd: app, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Fixture timeout: ${path.basename(fixture)}`)); }, 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors += data; });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${path.basename(fixture)} exited ${code}: ${errors}\n${output}`));
      else {
        console.log(output.trim());
        const last = output.trim().split('\n').at(-1);
        try { resolve({ passed: true, result: JSON.parse(last) }); }
        catch { resolve({ passed: true }); }
      }
    });
  });
}
