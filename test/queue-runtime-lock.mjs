import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueRuntime } from '../src/queue-runtime.mjs';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchup-queue-runtime-'));
try {
  await testExclusiveLockSerializesIndependentInstances();
  await testExclusiveLockIsReentrantForOneInstance();
  await testTimeoutRemovesPendingRequest();
  await testDiagnosticsReportsQueueState();
  process.stdout.write(`${JSON.stringify({ ok: true, tests: 4 }, null, 2)}\n`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function testDiagnosticsReportsQueueState() {
  const root = path.join(tempRoot, 'diagnostics');
  const queueDir = path.join(root, 'queue');
  const responseDir = path.join(root, 'responses');
  const lockPath = path.join(root, 'queue-runtime.lock');
  await fs.mkdir(queueDir, { recursive: true });
  await fs.mkdir(responseDir, { recursive: true });
  await fs.writeFile(path.join(queueDir, 'request.json'), '{"id":"request"}\n', 'utf8');
  await fs.writeFile(path.join(responseDir, 'response.json'), '{"result":{}}\n', 'utf8');
  await fs.writeFile(lockPath, '{"pid":123,"method":"build_model"}\n', 'utf8');
  const staleDate = new Date(Date.now() - 5000);
  await fs.utimes(lockPath, staleDate, staleDate);

  const runtime = new QueueRuntime({
    queueDir,
    responseDir,
    lockPath,
    staleLockMs: 1000,
    lockTimeoutMs: 100,
    pollIntervalMs: 5
  });
  const diagnostics = await runtime.diagnostics({ includeFiles: true });
  assert.equal(diagnostics.kind, 'queue_diagnostics');
  assert.equal(diagnostics.queue.count, 1);
  assert.equal(diagnostics.responses.count, 1);
  assert.equal(diagnostics.lock.exists, true);
  assert.equal(diagnostics.lock.stale, true);
  assert.equal(diagnostics.lock.owner.method, 'build_model');
  assert.ok(diagnostics.recommendations.some((item) => item.includes('stale')));
  assert.equal(diagnostics.queue.files[0].name, 'request.json');
}

async function testExclusiveLockSerializesIndependentInstances() {
  const root = path.join(tempRoot, 'serialize');
  const queueDir = path.join(root, 'queue');
  const responseDir = path.join(root, 'responses');
  const options = {
    queueDir,
    responseDir,
    lockTimeoutMs: 1000,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  };
  const first = new QueueRuntime(options);
  const second = new QueueRuntime(options);
  const events = [];

  const firstRun = first.withExclusiveAccess(async () => {
    events.push('first:start');
    await sleep(80);
    events.push('first:end');
  });
  await sleep(10);
  const secondRun = second.withExclusiveAccess(async () => {
    events.push('second:start');
  });
  await Promise.all([firstRun, secondRun]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start']);
}

async function testExclusiveLockIsReentrantForOneInstance() {
  const root = path.join(tempRoot, 'reentrant');
  const runtime = new QueueRuntime({
    queueDir: path.join(root, 'queue'),
    responseDir: path.join(root, 'responses'),
    lockTimeoutMs: 100,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });
  const events = [];

  await runtime.withExclusiveAccess(async () => {
    events.push('outer');
    await runtime.withExclusiveAccess(async () => {
      events.push('inner');
    });
  });

  assert.deepEqual(events, ['outer', 'inner']);
}

async function testTimeoutRemovesPendingRequest() {
  const root = path.join(tempRoot, 'timeout-cleanup');
  const queueDir = path.join(root, 'queue');
  const runtime = new QueueRuntime({
    queueDir,
    responseDir: path.join(root, 'responses'),
    timeoutMs: 20,
    lockTimeoutMs: 100,
    staleLockMs: 10_000,
    pollIntervalMs: 5
  });

  await assert.rejects(
    () => runtime.getCapabilities(),
    /Timed out waiting for SketchUp plugin response/
  );
  const queueFiles = await fs.readdir(queueDir);
  assert.deepEqual(queueFiles, []);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
