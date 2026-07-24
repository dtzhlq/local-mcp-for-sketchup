#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { defaultStateDir, projectRoot } from '../src/paths.mjs';

const options = parseArgs(process.argv.slice(2));
const command = options.command || 'status';
const outputRoot = path.resolve(options.outputDir || path.join(projectRoot, 'output', 'agent-first-live', 'trusted-approval'));
const approvalHostUrl = options.approvalHostUrl || process.env.ALMA_SKETCHUP_APPROVAL_HOST_URL || 'http://127.0.0.1:3978';
const bridge = new SketchUpBridge({
  executionPolicy: {
    allowed_runtimes: ['mock', 'queue'],
    allow_queue_mutation: true,
    allow_direct_expert_queue_mutation: false,
    auto_approve_risks: []
  },
  approval: {
    stateDir: path.join(defaultStateDir, 'agent-contract-v1', 'approvals'),
    approvalHostUrl
  },
  agentContract: { rootDir: path.join(defaultStateDir, 'agent-contract-v1') },
  sessionContract: { serverSessionId: 'local-approval-live-smoke.v1' }
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (command === 'prepare') await prepare();
  else if (command === 'apply') await apply();
  else if (command === 'status') await status();
  else throw new Error('Usage: node scripts/run-local-approval-live-smoke.mjs prepare|status|apply [--task-id ...]');
}

async function prepare() {
  await fs.mkdir(outputRoot, { recursive: true });
  const recursiveLimit = options.recursiveLimit || 10_000;
  const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: options.timeoutMs || 60_000 });
  const queueBefore = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs || 60_000 });
  assertQueueIdle(queueBefore);
  const handshake = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs: options.timeoutMs || 60_000 });
  const adoption = await bridge.adopt_open_model({ runtime: 'queue', recursive: true, recursive_limit: recursiveLimit, read_only: true, timeoutMs: options.timeoutMs || 120_000 });
  if (adoption.recursive_truncated || adoption.model_revision_complete !== true) {
    throw new Error('The active model cannot produce a complete review binding; no live task was prepared.');
  }
  if (handshake.session_contract.model_revision !== adoption.model_revision) {
    throw new Error('The read-only adoption revision differs from the fresh Session Contract.');
  }
  const target = selectRenameTarget(adoption);
  const runId = options.runId || timestampId();
  const runDir = path.join(outputRoot, runId);
  await fs.mkdir(runDir, { recursive: true });
  const originalName = String(target.name || target.definition_name || 'Unnamed_Component');
  const newName = options.newName || `ALMA_Approval_Proof_${runId.replace(/[^0-9A-Za-z_]/g, '_')}`;
  const task = await bridge.start_agent_task({
    intent: 'reviewed_existing_model_edit',
    instruction: `Rename one reviewed top-level test component from "${originalName}" to "${newName}" as a trusted local approval proof.`,
    interface_level: 'guided',
    client_capabilities: { vision: false, local_files: false, structured_output: true, parallel: false, context: 'short' },
    idempotency_key: `local-approval-live-prepare:${runId}`,
    inputs: {
      runtime: 'queue',
      recursive_limit: recursiveLimit,
      save_model: true,
      save_path: path.join(runDir, 'approved-model.skp'),
      capture_view: true,
      targets: [{ entity_path: target.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' }],
      operations: [{ op: 'rename', entity_path: target.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide', new_name: newName }]
    }
  });
  if (!task.ok || task.task_state !== 'awaiting_review' || task.result?.risk_level !== 'S2') {
    throw new Error(`Expected an S2 awaiting_review task, received ${JSON.stringify({ ok: task.ok, state: task.task_state, risk: task.result?.risk_level, error: task.error })}`);
  }
  const record = {
    kind: 'local_approval_live_smoke_prepare',
    version: 'local-approval-live-smoke.v1',
    run_id: runId,
    prepared_at: new Date().toISOString(),
    task_id: task.task_id,
    task_state: task.task_state,
    approval_url: task.next_action?.approval_host?.url,
    approval_challenge_id: task.result.approval_challenge.challenge_id,
    risk_level: task.result.risk_level,
    plan_id: task.result.plan_id,
    plan_hash: task.result.plan_hash,
    model_revision: task.result.model_revision,
    target: {
      entity_path: target.entity_path,
      entity_type: target.entity_type,
      original_name: originalName,
      new_name: newName,
      affected_instance_count: target.affected_instance_count || 1,
      shared_definition: target.shared_definition === true
    },
    runtime: capabilities.runtime,
    queue_before: summarizeQueue(queueBefore),
    live_mutation_performed: false,
    next_action: 'Open the local approval URL and let the real user approve. Then run apply with this task_id.'
  };
  await writeJson(path.join(runDir, 'prepare.json'), record);
  await writeJson(path.join(outputRoot, 'latest.json'), { run_id: runId, run_dir: runDir, task_id: task.task_id });
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
}

async function status() {
  const taskId = await requiredTaskId();
  const task = await bridge.resume_agent_task({ task_id: taskId });
  process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
}

async function apply() {
  const taskId = await requiredTaskId();
  const latest = await readLatestForTask(taskId);
  const taskBefore = await bridge.resume_agent_task({ task_id: taskId });
  if (taskBefore.task_state !== 'awaiting_review' || taskBefore.next_action?.approval_status !== 'approved_pending_execution') {
    throw new Error(`Task ${taskId} has not been approved in the trusted local page.`);
  }
  const queueBefore = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs || 60_000 });
  assertQueueIdle(queueBefore);
  const handshake = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs: options.timeoutMs || 60_000 });
  const result = await bridge.submit_agent_task_input({
    task_id: taskId,
    idempotency_key: `local-approval-live-apply:${taskId}`,
    input: {
      session_contract: handshake.session_contract,
      note: 'Approved by the independently authenticated local approval host.'
    }
  });
  const queueAfter = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs || 60_000 });
  assertQueueIdle(queueAfter);
  const record = {
    kind: 'local_approval_live_smoke_apply',
    version: 'local-approval-live-smoke.v1',
    applied_at: new Date().toISOString(),
    task_id: taskId,
    ok: result.ok,
    task_state: result.task_state,
    error: result.error,
    authorization: result.result?.authorization || null,
    receipt: result.result?.mutation_receipt || result.result?.receipt || null,
    model_revision_before: result.result?.model_revision_before || null,
    model_revision_after: result.result?.model_revision_after || null,
    artifacts: result.artifacts,
    queue_before: summarizeQueue(queueBefore),
    queue_after: summarizeQueue(queueAfter),
    live_mutation_performed: result.ok === true && result.task_state === 'completed',
    approval_token_exposed_to_agent: false,
    release_acceptance: false
  };
  await writeJson(path.join(latest.run_dir, 'apply.json'), record);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  if (!record.live_mutation_performed) process.exitCode = 1;
}

function selectRenameTarget(adoption) {
  const candidates = (adoption.recursive_index || []).filter((entry) =>
    ['group', 'component_instance'].includes(entry.entity_type)
      && Array.isArray(entry.allowed_operations)
      && entry.allowed_operations.includes('rename')
      && entry.locked !== true
      && entry.effective_locked !== true
      && Number(entry.affected_instance_count || 1) === 1
  );
  const shallow = candidates.sort((left, right) => occurrenceDepth(left.entity_path) - occurrenceDepth(right.entity_path))[0];
  if (!shallow) throw new Error('No unlocked single-instance Group or ComponentInstance supports the S2 rename proof.');
  return shallow;
}

function occurrenceDepth(value) {
  return String(value || '').replace(/^pid:/, '').split('.').filter(Boolean).length;
}

export function assertQueueIdle(value) {
  const summary = summarizeQueue(value);
  if (summary.queue !== 0 || summary.processing !== 0 || summary.responses !== 0 || summary.lock_exists !== false) {
    throw new Error(`Queue is not idle: ${JSON.stringify(summary)}`);
  }
}

export function summarizeQueue(value) {
  const diagnostics = value?.diagnostics || value;
  return {
    queue: diagnosticCount(diagnostics?.queue_count, diagnostics?.queue),
    processing: diagnosticCount(diagnostics?.processing_count, diagnostics?.processing),
    responses: diagnosticCount(diagnostics?.response_count, diagnostics?.responses),
    lock_exists: diagnosticLockState(diagnostics)
  };
}

function diagnosticCount(flatValue, nestedValue) {
  for (const candidate of [flatValue, nestedValue?.count, nestedValue]) {
    if (candidate === null || candidate === undefined || typeof candidate === 'object') continue;
    const count = Number(candidate);
    if (Number.isInteger(count) && count >= 0) return count;
  }
  return null;
}

function diagnosticLockState(diagnostics) {
  if (typeof diagnostics?.lock_exists === 'boolean') return diagnostics.lock_exists;
  if (typeof diagnostics?.lock?.exists === 'boolean') return diagnostics.lock.exists;
  return null;
}

async function requiredTaskId() {
  if (options.taskId) return options.taskId;
  const latest = JSON.parse(await fs.readFile(path.join(outputRoot, 'latest.json'), 'utf8'));
  if (!latest.task_id) throw new Error('No task id was supplied and output/latest.json has none.');
  return latest.task_id;
}

async function readLatestForTask(taskId) {
  const latest = JSON.parse(await fs.readFile(path.join(outputRoot, 'latest.json'), 'utf8'));
  if (latest.task_id !== taskId) throw new Error('The requested task does not match the latest trusted-approval run.');
  return latest;
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function parseArgs(argv) {
  const result = { command: argv[0] && !argv[0].startsWith('--') ? argv[0] : null };
  for (let index = result.command ? 1 : 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--task-id') result.taskId = argv[++index];
    else if (value === '--output-dir') result.outputDir = argv[++index];
    else if (value === '--approval-host-url') result.approvalHostUrl = argv[++index];
    else if (value === '--timeout-ms') result.timeoutMs = Number(argv[++index]);
    else if (value === '--recursive-limit') result.recursiveLimit = Number(argv[++index]);
    else if (value === '--run-id') result.runId = argv[++index];
    else if (value === '--new-name') result.newName = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}
