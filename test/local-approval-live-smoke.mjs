import assert from 'node:assert/strict';
import { assertQueueIdle, summarizeQueue } from '../scripts/run-local-approval-live-smoke.mjs';

const currentDiagnostics = {
  queue: { exists: true, count: 0 },
  processing: { exists: true, count: 0 },
  responses: { exists: true, count: 0 },
  lock: { exists: false }
};
assert.deepEqual(summarizeQueue(currentDiagnostics), {
  queue: 0,
  processing: 0,
  responses: 0,
  lock_exists: false
});
assert.doesNotThrow(() => assertQueueIdle(currentDiagnostics));

const legacyDiagnostics = {
  diagnostics: { queue_count: 0, processing_count: 0, response_count: 0, lock_exists: false }
};
assert.doesNotThrow(() => assertQueueIdle(legacyDiagnostics));

assert.throws(
  () => assertQueueIdle({ queue: { count: 1 }, processing: { count: 0 }, responses: { count: 0 }, lock: { exists: false } }),
  /Queue is not idle/
);
assert.throws(() => assertQueueIdle({}), /Queue is not idle/, 'unknown diagnostics must fail closed');
assert.throws(
  () => assertQueueIdle({ queue: { count: 0 }, processing: { count: 0 }, responses: { count: 0 }, lock: {} }),
  /Queue is not idle/,
  'unknown lock state must fail closed'
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  current_nested_shape: true,
  legacy_flat_shape: true,
  unknown_shape_fail_closed: true,
  live_queue_called: false
}, null, 2)}\n`);
