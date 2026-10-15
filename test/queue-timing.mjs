import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import { withTaskTiming, summarizeQueueTiming, queueTimingDiagnostics, recordQueueTiming } from '../src/execution-timing.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'queue-timing-'));
const queueDir = path.join(root, 'queue'), responseDir = path.join(root, 'responses');
const runtime = new QueueRuntime({ queueDir, responseDir, timeoutMs: 2000, pollIntervalMs: 5 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function respond({ error = false, timing = true } = {}) {
  for (let i = 0; i < 300; i++) {
    const name = (await fs.readdir(queueDir).catch(() => [])).find(name => name.endsWith('.json'));
    if (!name) { await pause(5); continue; }
    await pause(15);
    const startedAt = Date.now(), started = performance.now();
    await pause(10);
    const finishedAt = Date.now(), dispatchMs = performance.now() - started;
    const body = error ? { error: { code: 'INVALID_ARGUMENT', message: 'Fixture failure' } } : { result: { model_revision: 'unchanged', nested: { receipt: 'unchanged' } } };
    if (timing) body.timing = { version: 'native-queue-timing.v1', started_at_ms: startedAt, finished_at_ms: finishedAt, dispatch_elapsed_ms: dispatchMs };
    await fs.writeFile(path.join(responseDir, name), JSON.stringify(body));
    return;
  }
  throw new Error('Fixture request was not published');
}
try {
  const [result] = await Promise.all([withTaskTiming('task-fixture', 'start', () => runtime.call('get_model_info', { secret: 'must-not-be-logged' })), respond()]);
  assert.deepEqual(result, { model_revision: 'unchanged', nested: { receipt: 'unchanged' } }, 'transport timing must never change geometry/receipt payloads');
  // A later runtime instance must observe prior samples for this same queue.
  const diagnostics = await new QueueRuntime({ queueDir, responseDir }).diagnostics();
  const row = diagnostics.timing.recent_calls.at(-1);
  assert.equal(row.task_id, 'task-fixture');
  assert.equal(row.task_phase, 'start');
  assert.equal(row.outcome, 'returned');
  assert.ok(row.native_dispatch_ms >= 0);
  assert.ok(row.round_trip_ms >= row.native_dispatch_ms);
  assert.ok(row.queue_wait_estimate_ms >= 0);
  assert.ok(row.response_return_estimate_ms >= 0);
  assert.equal(diagnostics.timing.recent_task_requests.at(-1).queue_calls, 1);
  assert.equal(JSON.stringify(diagnostics.timing).includes('must-not-be-logged'), false);
  await Promise.all([assert.rejects(() => withTaskTiming('task-error', 'submit', () => runtime.call('get_model_info', {})), /Fixture failure/), respond({ error: true })]);
  assert.equal(queueTimingDiagnostics(queueDir).recent_calls.at(-1).outcome, 'native_error');
  await Promise.all([runtime.call('get_model_info', {}), respond({ timing: false })]);
  const legacy = queueTimingDiagnostics(queueDir).recent_calls.at(-1);
  assert.equal(legacy.native_dispatch_ms, null);
  assert.equal(legacy.queue_wait_estimate_ms, null);
  const now = performance.now();
  const invalid = summarizeQueueTiming({method:'inspect_model',started:now,published:now,publishedAt:100,observed:now+20,observedAt:120,
    nativeTiming:{version:'native-queue-timing.v1',started_at_ms:500,finished_at_ms:510,dispatch_elapsed_ms:10},outcome:'returned'});
  assert.equal(invalid.queue_wait_estimate_ms, null, 'clock inconsistencies must not become zero wait');
  const blocked = new QueueRuntime({queueDir,responseDir,pollIntervalMs:5,lockTimeoutMs:5});
  await fs.writeFile(blocked.lockPath, '{}');
  await assert.rejects(() => blocked.call('get_model_info', {}), /lock/);
  assert.equal(queueTimingDiagnostics(queueDir).recent_calls.at(-1).outcome, 'blocked_before_enqueue');
  await fs.rm(blocked.lockPath);
  for(let i=0;i<140;i++)recordQueueTiming(queueDir,{method:'fixture',client_elapsed_ms:0});
  assert.equal(queueTimingDiagnostics(queueDir).retained_call_count,128);
  assert.equal(queueTimingDiagnostics(path.join(root,'other-queue')).retained_call_count,0);
  console.log('PASS queue timing, native error, legacy plugin, clock skew, lock failure and bounded isolation');
} finally { await fs.rm(root,{recursive:true,force:true}); }
