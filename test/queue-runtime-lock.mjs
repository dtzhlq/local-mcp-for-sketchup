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
  process.stdout.write(`${JSON.stringify({ ok: true, tests: 3 }, null, 2)}\n`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
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
