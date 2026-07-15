import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-capability-suite-safety-'));
const script = path.join(repoRoot, 'scripts', 'validate-mcp-capability-suite.mjs');

try {
  const defaultState = path.join(root, 'default-state');
  const defaultOutput = path.join(root, 'default-output');
  const normal = await run(process.execPath, [script, '--output-dir', defaultOutput], {
    env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: defaultState }
  });
  assert.equal(normal.code, 0, normal.stderr);
  const report = JSON.parse(await fs.readFile(path.join(defaultOutput, 'report.json'), 'utf8'));
  assert.equal(report.mode, 'mock', 'the capability suite must default to mock');
  assert.equal(report.queue.skipped, true);
  assert.equal(await exists(path.join(defaultState, 'queue')), false, 'the default suite must not create queue requests');

  const interruptedState = path.join(root, 'interrupted-state');
  const interruptedOutput = path.join(root, 'interrupted-output');
  const child = spawn(process.execPath, [
    script,
    '--runtime', 'queue',
    '--timeout-ms', '60000',
    '--output-dir', interruptedOutput
  ], {
    cwd: repoRoot,
    env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: interruptedState },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const queueDir = path.join(interruptedState, 'queue');
  await waitFor(async () => (await jsonFiles(queueDir)).length > 0, 15_000);
  assert.match(stderr, /will reset and modify the model currently open in SketchUp/);
  child.kill('SIGTERM');
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(exitCode, 143, `unexpected interrupted exit; stderr=${stderr}`);
  await waitFor(async () => (await jsonFiles(queueDir)).length === 0 && !await exists(path.join(interruptedState, 'queue-runtime.lock')), 5_000);
  assert.deepEqual(await jsonFiles(queueDir), [], 'interrupted validation must remove its pending queue request');
  assert.equal(await exists(path.join(interruptedState, 'queue-runtime.lock')), false, 'interrupted validation must remove its queue lock');

  process.stdout.write(`${JSON.stringify({ ok: true, default_runtime: report.mode, interruption_cleanup: true }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function jsonFiles(directory) {
  try {
    return (await fs.readdir(directory)).filter((entry) => entry.endsWith('.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
