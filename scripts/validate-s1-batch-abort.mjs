#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';

const PROBE_DICTIONARY = 'AlmaControlledAbortProbe';

export async function validateS1BatchAbort({
  runtime = 'mock',
  queueRequired = false,
  timeoutMs = runtime === 'queue' ? 180000 : 30000,
  outputDir = `output/s1-batch-abort/${runtime}`
} = {}) {
  if (!['mock', 'queue'].includes(runtime)) throw new Error('runtime must be mock or queue');
  if (runtime === 'queue' && queueRequired !== true) {
    throw new Error('Live S1 batch-abort validation requires explicit --runtime queue --queue-required.');
  }
  if (runtime === 'queue') {
    process.stderr.write('[DANGER] S1 batch-abort QA requires one known non-manifold, unlocked top-level entity. It writes one probe attribute, then runs a fail-on-non-manifold check; the entire transaction must roll back. It does not reset, save, open, or create geometry.\n');
  }

  const absoluteOutputDir = path.resolve(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const bridge = new SketchUpBridge({
    ...(runtime === 'mock' ? { mock: { sessionPath: path.join(absoluteOutputDir, '.mock-session.json') } } : {}),
    agentContract: { rootDir: path.join(absoluteOutputDir, 'agent-contract') },
    approval: {
      stateDir: path.join(absoluteOutputDir, 'approval-state'),
      secret: 'controlled-s1-batch-abort-test-secret-at-least-32-bytes'
    },
    executionPolicy: {
      allowed_runtimes: runtime === 'queue' ? ['mock', 'queue'] : ['mock'],
      allow_queue_mutation: runtime === 'queue',
      auto_approve_risks: ['S1']
    }
  });

  if (runtime === 'mock') {
    await bridge.build_model({
      runtime,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [
          { op: 'reset' },
          {
            op: 'mesh',
            id: 'controlled-abort-target',
            name: 'Controlled_Abort_Open_Mesh',
            vertices: [[0, 0, 0], [100, 0, 0], [0, 80, 0], [0, 0, 40]],
            faces: [[0, 1, 2], [0, 3, 1], [1, 3, 2]]
          }
        ]
      })
    });
  }

  const before = await adopt(bridge, runtime, timeoutMs);
  const targetEntity = runtime === 'mock'
    ? before.entities.find((entity) => entity.id === 'controlled-abort-target')
    : before.entities.find((entity) => entity.locked !== true && (entity.id || entity.persistent_id) && knownNonManifold(entity));
  if (!targetEntity) {
    throw new Error('Live S1 batch-abort validation requires a known non-manifold, unlocked top-level Group. Prepare that disposable fixture explicitly before rerunning; no model change was attempted.');
  }
  const targetId = String(targetEntity.id || targetEntity.persistent_id);
  const beforeRevision = modelRevisionForAdoption(before);
  const probeKey = `must_rollback_${crypto.randomUUID()}`;
  assert(!hasProbe(before, targetId, probeKey), 'rollback probe key must not exist before the test');

  const nonce = crypto.randomUUID();
  const started = await bridge.start_agent_task({
    intent: 'reviewed_existing_model_edit',
    instruction: 'Controlled S1 transaction-abort proof. A fail-on-non-manifold check follows one probe attribute and the entire batch must abort.',
    interface_level: 'expert',
    idempotency_key: `s1-abort-start-${nonce}`,
    inputs: {
      runtime,
      save_model: false,
      targets: [{ target_id: targetId }],
      operations: [
        { op: 'attribute', target_id: targetId, dictionary: PROBE_DICTIONARY, key: probeKey, value: nonce },
        { op: 'manifold_check', target_id: targetId, check_id: `must_fail_${nonce}`, fail_on_non_manifold: true }
      ]
    }
  });
  assert(started.ok === true, 'S1 abort task preparation must succeed');
  assert(started.task_state === 'awaiting_review', 'S1 abort task must enter awaiting_review before server policy approval');
  assert(started.result?.risk_level === 'S1', 'S1 abort task must be classified as S1');

  const submitInput = await freshSessionOptions(bridge, { runtime, timeoutMs });
  const submitIdempotencyKey = `s1-abort-submit-${nonce}`;
  const failed = await bridge.submit_agent_task_input({
    task_id: started.task_id,
    idempotency_key: submitIdempotencyKey,
    input: submitInput
  });
  assert(failed.ok === false, 'controlled invalid batch must return a failed envelope');
  assert(failed.task_state === 'failed', 'failure after mutation execution begins must be terminal');
  assert(failed.error?.code === 'MUTATION_EXECUTION_FAILED', `expected MUTATION_EXECUTION_FAILED, got ${failed.error?.code}`);
  assert(failed.retryable === false && failed.error.retryable === false, 'post-execution mutation failure must not invite a second mutation');

  const afterFailure = await adopt(bridge, runtime, timeoutMs);
  const afterRevision = modelRevisionForAdoption(afterFailure);
  assert(afterRevision === beforeRevision, 'controlled failed batch must preserve the complete model revision');
  assert(!hasProbe(afterFailure, targetId, probeKey), 'first attribute write must be absent after transaction abort');

  const replay = await bridge.submit_agent_task_input({
    task_id: started.task_id,
    idempotency_key: submitIdempotencyKey,
    input: submitInput
  });
  assert(replay.ok === false, 'idempotent replay must preserve the original failed outcome');
  assert(replay.idempotent_replay === true, 'same submit key must be reported as an idempotent replay');
  assert(replay.error?.code === failed.error.code, 'idempotent replay must preserve the stable error code');
  assert(replay.task_version === failed.task_version, 'idempotent replay must preserve the original task version');

  const afterReplay = await adopt(bridge, runtime, timeoutMs);
  const replayRevision = modelRevisionForAdoption(afterReplay);
  assert(replayRevision === beforeRevision, 'idempotent error replay must not execute the batch again');
  assert(!hasProbe(afterReplay, targetId, probeKey), 'idempotent error replay must not create the probe');

  const task = await bridge.taskStore.getTask(started.task_id);
  const states = task.history.map((entry) => entry.to).filter(Boolean);
  for (const expected of ['awaiting_review', 'approved', 'executing', 'failed']) {
    assert(states.includes(expected), `task history must include ${expected}`);
  }

  const diagnostics = runtime === 'queue' ? await bridge.queue_diagnostics({ timeoutMs }) : null;
  if (diagnostics) assertQueueClean(diagnostics);

  const reportPath = path.join(absoluteOutputDir, 's1-batch-abort-report.json');
  const report = {
    version: 1,
    kind: 'controlled_s1_batch_abort_report',
    ok: true,
    runtime,
    scope: 'single_ruby_dsl_batch_abort_only',
    target: { target_id: targetId, name: targetEntity.name || null },
    task_id: started.task_id,
    plan_id: started.result.plan_id,
    risk_level: started.result.risk_level,
    authorization: 'server_policy_auto_approval:S1',
    error: {
      code: failed.error.code,
      retryable: failed.error.retryable,
      task_state: failed.task_state
    },
    model_revision_before: beforeRevision,
    model_revision_after: afterRevision,
    model_revision_after_replay: replayRevision,
    probe_absent: true,
    idempotent_error_replay: true,
    task_history_states: states,
    queue_clean: diagnostics ? {
      queue: diagnostics.queue.count,
      processing: diagnostics.processing.count,
      responses: diagnostics.responses.count,
      lock: diagnostics.lock.exists
    } : null,
    artifacts: { report: reportPath }
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function adopt(bridge, runtime, timeoutMs) {
  return bridge.adopt_open_model({
    runtime,
    timeoutMs,
    recursive: true,
    recursive_limit: 5000,
    read_only: true,
    prefix: 'controlled-abort'
  });
}

function hasProbe(adoption, targetId, probeKey) {
  const entity = adoption.entities.find((item) => String(item.id || item.persistent_id) === targetId);
  return Object.prototype.hasOwnProperty.call(entity?.attributes?.[PROBE_DICTIONARY] || {}, probeKey);
}

function knownNonManifold(entity) {
  if (entity?.manifold?.is_manifold === false) return true;
  if (['image_plane', 'face_with_holes'].includes(entity?.kind)) return true;
  const box = entity?.bounding_box;
  return box && [box.w, box.d, box.h].some((value) => !Number.isFinite(value) || value <= 0);
}

function assertQueueClean(diagnostics) {
  assert(diagnostics.queue.count === 0, 'queue must be empty after S1 batch-abort validation');
  assert(diagnostics.processing.count === 0, 'processing must be empty after S1 batch-abort validation');
  assert(diagnostics.responses.count === 0, 'responses must be empty after S1 batch-abort validation');
  assert(diagnostics.lock.exists === false, 'queue lock must be absent after S1 batch-abort validation');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  validateS1BatchAbort(parseArgs(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
