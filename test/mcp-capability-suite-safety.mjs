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
  const scriptSource = await fs.readFile(script, 'utf8');
  assert.doesNotMatch(scriptSource, /origin: \[420, 0, 0\]/, 'the live iteration fixture must not overlap the suite component instance');
  assert.match(scriptSource, /assert\.equal\(iteration\.model_qa\.verdict, 'pass'\)/, 'the live suite must hard-gate iteration Model QA');
  assert.match(scriptSource, /queue_diagnostics:post-queue/, 'the live suite must record post-run queue cleanup evidence');

  const defaultState = path.join(root, 'default-state');
  const defaultOutput = path.join(root, 'default-output');
  const normal = await run(process.execPath, [script, '--output-dir', defaultOutput], {
    env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: defaultState }
  });
  assert.equal(normal.code, 0, normal.stderr);
  const report = JSON.parse(await fs.readFile(path.join(defaultOutput, 'report.json'), 'utf8'));
  assert.equal(report.mode, 'mock', 'the capability suite must default to mock');
  assert.equal(report.queue.skipped, true);
  assert.deepEqual(report.steps.find((step) => step.name === 'build_report')?.result?.model_qa, { ok: true, verdict: 'pass' });
  assert.deepEqual(report.steps.find((step) => step.name === 'iterate_model')?.result?.model_qa, { ok: true, verdict: 'pass' });
  assert.equal(await exists(path.join(defaultState, 'queue')), false, 'the default suite must not create queue requests');

  const sigterm = await exerciseSignalCleanup({ root, script, signal: 'SIGTERM', expectedExitCode: 143 });
  const sigint = await exerciseSignalCleanup({ root, script, signal: 'SIGINT', expectedExitCode: 130 });
  const ordinaryException = await exerciseOrdinaryExceptionCleanup({ root, script });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    default_runtime: report.mode,
    model_qa_gate: true,
    interruption_cleanup: {
      sigterm,
      sigint,
      ordinary_exception: ordinaryException
    }
  }, null, 2)}\n`);
} finally {
  // The interrupted suite owns a child MCP process and macOS can surface a
  // short directory-entry race after that process exits. Retry only the
  // isolated test root cleanup; queue/request assertions above remain strict.
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

async function exerciseSignalCleanup({ root, script, signal, expectedExitCode }) {
  const id = signal.toLowerCase();
  const home = path.join(root, `${id}-home`);
  const output = path.join(root, `${id}-output`);
  const child = spawn(process.execPath, [
    script,
    '--runtime', 'queue',
    '--timeout-ms', '60000',
    '--output-dir', output
  ], {
    cwd: repoRoot,
    env: isolatedQueueEnv(home),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.resume();
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const stateDir = path.join(home, '.sketchup-mcp-replica');
  const queueDir = path.join(stateDir, 'queue');
  await waitFor(async () => (await jsonFiles(queueDir)).length > 0, 15_000);
  assert.match(stderr, /will reset and modify the model currently open in SketchUp/);
  child.kill(signal);
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(exitCode, expectedExitCode, `unexpected ${signal} exit; stderr=${stderr}`);
  await assertOwnedQueueStateClean(stateDir, `${signal} cleanup`);
  return { exit_code: exitCode, request_removed: true, lock_removed: true };
}

async function exerciseOrdinaryExceptionCleanup({ root, script }) {
  const home = path.join(root, 'ordinary-exception-home');
  const output = path.join(root, 'ordinary-exception-output');
  const result = await run(process.execPath, [
    script,
    '--runtime', 'queue',
    '--queue-required',
    '--timeout-ms', '10',
    '--output-dir', output
  ], { env: isolatedQueueEnv(home) });
  assert.equal(result.code, 1, `queue timeout fixture must fail through the top-level finally; stderr=${result.stderr}`);
  assert.match(result.stderr, /will reset and modify the model currently open in SketchUp/);
  await assertOwnedQueueStateClean(path.join(home, '.sketchup-mcp-replica'), 'ordinary exception cleanup');
  return { exit_code: result.code, request_removed: true, lock_removed: true };
}

function isolatedQueueEnv(home) {
  const env = {
    ...process.env,
    HOME: home,
    ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES: 'mock,queue',
    ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION: '1',
    ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION: '1'
  };
  delete env.ALMA_SKETCHUP_STATE_DIR;
  delete env.ALMA_SKETCHUP_QUEUE_DIR;
  delete env.ALMA_SKETCHUP_PROCESSING_DIR;
  delete env.ALMA_SKETCHUP_RESPONSE_DIR;
  return env;
}

async function assertOwnedQueueStateClean(stateDir, label) {
  const queueDir = path.join(stateDir, 'queue');
  await waitFor(async () => (await jsonFiles(queueDir)).length === 0 && !await exists(path.join(stateDir, 'queue-runtime.lock')), 5_000);
  assert.deepEqual(await jsonFiles(queueDir), [], `${label} must remove its pending queue request`);
  assert.equal(await exists(path.join(stateDir, 'queue-runtime.lock')), false, `${label} must remove its queue lock`);
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
