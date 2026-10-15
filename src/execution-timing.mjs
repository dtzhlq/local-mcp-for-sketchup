import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

// Diagnostic samples stay in this server process. No model data, request bodies,
// file paths, approvals or mutation receipts are stored in a sample.
const contexts = new AsyncLocalStorage();
const queues = new Map();
const requests = [];
const LIMIT = 128;
const duration = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) / 1000 : null;

export async function withTaskTiming(taskId, phase, callback) {
  const context = { task_id: taskId, phase, queue_calls: 0, queue_elapsed_ms: 0 };
  const started = performance.now();
  let outcome = 'returned';
  try {
    return await contexts.run(context, callback);
  } catch (error) {
    outcome = 'threw';
    throw error;
  } finally {
    requests.push({ ...context, outcome, elapsed_ms: duration(performance.now() - started), recorded_at: new Date().toISOString() });
    if (requests.length > LIMIT) requests.shift();
  }
}

export function recordQueueTiming(queueDir, sample) {
  const key = path.resolve(queueDir);
  if (!queues.has(key)) {
    if (queues.size >= 32) queues.delete(queues.keys().next().value);
    queues.set(key, []);
  }
  const context = contexts.getStore();
  const row = { ...sample, ...(context ? { task_id: context.task_id, task_phase: context.phase } : {}) };
  const rows = queues.get(key);
  rows.push(row);
  if (rows.length > LIMIT) rows.shift();
  if (context) {
    context.queue_calls++;
    context.queue_elapsed_ms = duration(context.queue_elapsed_ms + (row.client_elapsed_ms || 0));
  }
}

export function queueTimingDiagnostics(queueDir) {
  const rows = queues.get(path.resolve(queueDir)) || [];
  const ids = new Set(rows.map(row => row.task_id).filter(Boolean));
  return {
    version: 'queue-timing.v1', scope: 'bounded_current_server_process', quality_evidence: false,
    retained_call_count: rows.length, maximum_retained_calls: LIMIT,
    recent_calls: structuredClone(rows.slice(-24)),
    recent_task_requests: structuredClone(requests.filter(row => ids.has(row.task_id)).slice(-12)),
    notes: 'Task times cover one start/resume/submit request, excluding user think time. Nested task times may overlap. Wall-clock queue/return estimates are diagnostic only; unavailable or inconsistent native timing remains null.'
  };
}

export function summarizeQueueTiming({ method, requestId, started, published, publishedAt, observed, observedAt, nativeTiming, lockWaitMs, outcome }) {
  const native = nativeTiming?.version === 'native-queue-timing.v1' ? nativeTiming : null;
  const roundTrip = published === undefined ? null : duration((observed ?? performance.now()) - published);
  const dispatch = duration(native?.dispatch_elapsed_ms);
  // Both processes run on the same host, but wall time can change. Never turn
  // an inconsistent clock or old plugin into a fabricated zero wait.
  const wallValid = native && Number.isFinite(publishedAt) && Number.isFinite(observedAt)
    && Number.isFinite(native.started_at_ms) && Number.isFinite(native.finished_at_ms)
    && native.started_at_ms >= publishedAt - 2 && native.finished_at_ms >= native.started_at_ms
    && native.finished_at_ms <= observedAt + 2
    && Math.abs((observedAt - publishedAt) - roundTrip) < 10
    && dispatch !== null && Math.abs(native.finished_at_ms - native.started_at_ms - dispatch) < 10;
  return {
    request_id: requestId, method, outcome, recorded_at: new Date().toISOString(),
    client_elapsed_ms: duration(performance.now() - started + (lockWaitMs || 0)),
    lock_wait_ms: duration(lockWaitMs),
    prepare_publish_ms: published === undefined ? null : duration(published - started),
    round_trip_ms: roundTrip,
    native_dispatch_ms: dispatch,
    queue_wait_estimate_ms: wallValid ? duration(Math.max(0, native.started_at_ms - publishedAt)) : null,
    response_return_estimate_ms: wallValid ? duration(Math.max(0, observedAt - native.finished_at_ms)) : null,
    timing_source: wallValid ? 'client_monotonic_and_native_monotonic_with_local_wall_estimates' : 'client_monotonic',
    quality_evidence: false
  };
}
