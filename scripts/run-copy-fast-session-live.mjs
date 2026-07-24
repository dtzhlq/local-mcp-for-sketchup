#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  CAPABILITY_MANIFEST_VERSION,
  RUNTIME_CAPABILITY_VERSION,
  getRuntimeCapabilities
} from '../src/capabilities.mjs';
import { defaultStateDir, projectRoot } from '../src/paths.mjs';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import {
  DEFAULT_PLUGIN_DIR,
  PLUGIN_FILES,
  checkSourceFiles
} from './package-sketchup-plugin.mjs';
import {
  CONTROLLED_S4_DELETE_PROFILE,
  assertControlledS4Preconditions,
  assertQueueIdle,
  controlledS4DeleteInstruction,
  controlledS4DeleteOperations,
  controlledS4DeleteTargets,
  summarizeQueue,
  verifyControlledS4Deletion
} from './run-controlled-s4-delete-live.mjs';

export const COPY_FAST_LIVE_VERSION = 'copy-fast-session-live.v2';
export const COPY_FAST_LIVE_MODEL_SHA256 = '7e649c220a265a5e27a24aae2ed9687427186c06ba335616d5cdc0191966ce72';
export const COPY_FAST_LIVE_DEFAULT_MODEL = path.join(
  projectRoot,
  'output',
  'live-validation',
  'next-models',
  'controlled-s4-delete-2026-07-22-v1',
  CONTROLLED_S4_DELETE_PROFILE.expected_basename
);

const SOURCE_PATHS = Object.freeze([
  'src/copy-fast-session.mjs',
  'src/agent-contract.mjs',
  'src/agent-gateway.mjs',
  'src/agent-response-projection.mjs',
  'src/existing-model-editing.mjs',
  'src/bridge.mjs',
  'src/queue-runtime.mjs',
  'src/session-contract.mjs',
  'src/task-mutation-receipt-ledger.mjs',
  'src/version.mjs',
  'src/capabilities.mjs',
  'scripts/run-copy-fast-session-live.mjs',
  'schema/copy-fast-session-live-evidence-v2.schema.json'
]);

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      version: COPY_FAST_LIVE_VERSION,
      error: {
        code: error?.code || 'COPY_FAST_LIVE_FAILED',
        message: String(error?.message || error)
      },
      live_queue_attempted: error?.liveQueueAttempted === true
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  const command = options.command || 'check';
  const modelPath = path.resolve(options.modelPath || COPY_FAST_LIVE_DEFAULT_MODEL);
  const model = await inspectDisposableModel(modelPath);
  if (command === 'check') {
    const installedSource = await assertInstalledPluginExactMatch({
      pluginDir: options.pluginDir || DEFAULT_PLUGIN_DIR
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      version: COPY_FAST_LIVE_VERSION,
      command,
      mutates_model: false,
      live_queue_calls: 0,
      disposable_model: model,
      installed_source: installedSource,
      next_action: {
        action: 'open_disposable_model_then_run_live_gate',
        command: 'node scripts/run-copy-fast-session-live.mjs run --runtime queue --queue-required --ack-disposable-copy --fresh-sketchup-confirmed'
      }
    }, null, 2)}\n`);
    return;
  }
  if (command !== 'run') {
    throw new Error('Usage: node scripts/run-copy-fast-session-live.mjs check|run [options]');
  }
  assertLiveRunOptions(options);
  await runLive({ ...options, modelPath, model });
}

export async function inspectDisposableModel(modelPath = COPY_FAST_LIVE_DEFAULT_MODEL) {
  const resolved = path.resolve(modelPath);
  const canonical = await fs.realpath(resolved);
  if (canonical !== resolved) {
    throw new Error('Copy Fast live QA rejects symlinked model paths.');
  }
  const stat = await fs.stat(canonical);
  if (!stat.isFile()) throw new Error('Copy Fast live QA requires a regular .skp file.');
  if (path.extname(canonical).toLowerCase() !== '.skp') {
    throw new Error('Copy Fast live QA requires a .skp disposable model.');
  }
  const sha256 = await fileSha256(canonical);
  if (sha256 !== COPY_FAST_LIVE_MODEL_SHA256) {
    throw new Error(`Disposable model hash mismatch: expected ${COPY_FAST_LIVE_MODEL_SHA256}, received ${sha256}.`);
  }
  return {
    basename: path.basename(canonical),
    sha256,
    size_bytes: stat.size,
    expected_initial_revision: CONTROLLED_S4_DELETE_PROFILE.expected_revision,
    save_model: false
  };
}

export async function assertInstalledPluginExactMatch({
  pluginDir = DEFAULT_PLUGIN_DIR,
  sourceRoot = projectRoot
} = {}) {
  const sourceManifest = await checkSourceFiles(sourceRoot);
  const canonicalPluginRoot = await fs.realpath(path.resolve(pluginDir));
  const expectedModuleEntries = PLUGIN_FILES
    .filter((entry) => entry.target.startsWith('alma_sketchup_mcp/'))
    .map((entry) => path.basename(entry.target))
    .sort();
  const actualModuleEntries = (await fs.readdir(
    path.join(canonicalPluginRoot, 'alma_sketchup_mcp'),
    { withFileTypes: true }
  )).map((entry) => {
    if (!entry.isFile()) {
      throw new Error(`Installed plugin contains a non-file managed entry: ${entry.name}.`);
    }
    return entry.name;
  }).sort();
  if (JSON.stringify(actualModuleEntries) !== JSON.stringify(expectedModuleEntries)) {
    throw new Error('Installed plugin module entries do not exactly match the 22-file workspace manifest.');
  }

  const installedManifest = {};
  for (const entry of PLUGIN_FILES) {
    const installedPath = path.join(canonicalPluginRoot, entry.target);
    const canonicalInstalledPath = await fs.realpath(installedPath);
    if (canonicalInstalledPath !== installedPath) {
      throw new Error(`Installed plugin entry is symlinked: ${entry.target}.`);
    }
    const bytes = await fs.readFile(canonicalInstalledPath);
    const descriptor = {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.length
    };
    const expected = sourceManifest[entry.target];
    if (descriptor.sha256 !== expected?.sha256 || descriptor.size_bytes !== expected?.size_bytes) {
      throw new Error(
        `Installed plugin entry does not match the current workspace: ${entry.target}. `
        + 'Reinstall the plugin and fully restart SketchUp before live work.'
      );
    }
    installedManifest[entry.target] = descriptor;
  }
  return {
    file_count: PLUGIN_FILES.length,
    manifest_sha256: crypto.createHash('sha256')
      .update(stableManifestJson(installedManifest))
      .digest('hex'),
    exact_workspace_match: true,
    paths_exposed: false
  };
}

export function assertLiveRunOptions(options = {}) {
  if (options.runtime !== 'queue'
    || options.queueRequired !== true
    || options.ackDisposableCopy !== true
    || options.freshSketchUpConfirmed !== true) {
    throw new Error(
      'Live Copy Fast QA requires --runtime queue --queue-required --ack-disposable-copy '
      + '--fresh-sketchup-confirmed. It deletes one reviewed nested Group from the active '
      + 'disposable model in memory and does not save the file.'
    );
  }
}

async function runLive(options) {
  const timeoutMs = boundedInteger(options.timeoutMs, 900_000, 10_000, 1_800_000);
  const recursiveLimit = boundedInteger(options.recursiveLimit, 10_000, 1, 20_000);
  const runId = options.runId || timestampId();
  const outputRoot = path.resolve(options.outputDir || path.join(
    projectRoot,
    'output',
    'live-validation',
    'copy-fast-session-v2'
  ));
  const runDir = path.join(outputRoot, runId);
  const canonicalRoot = await fs.realpath(path.dirname(options.modelPath));
  const installedSource = await assertInstalledPluginExactMatch({
    pluginDir: options.pluginDir || DEFAULT_PLUGIN_DIR
  });
  process.stderr.write(
    'LIVE COPY FAST QA: this run will delete pid:9287.9289 and its empty parent '
    + 'from the currently open disposable Fire Escape model in memory. '
    + 'It will not save the SKP. Close without saving after the run.\n'
  );

  const bridge = createLiveBridge({
    timeoutMs,
    runId,
    copyRoot: canonicalRoot
  });
  const diskShaBefore = await fileSha256(options.modelPath);
  const queueBefore = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs });
  assertQueueIdle(queueBefore);
  const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
  assertRuntimeReady(capabilities.runtime);
  const before = await bridge.adopt_open_model({
    runtime: 'queue',
    read_only: true,
    structural_groups: true,
    structural_group_limit: 5000,
    timeoutMs
  });
  assertControlledS4Preconditions(before, { expectedModelPath: options.modelPath });

  const task = await bridge.start_agent_task({
    intent: 'reviewed_existing_model_edit',
    instruction: controlledS4DeleteInstruction(),
    interface_level: 'guided',
    client_capabilities: {
      vision: false,
      local_files: false,
      structured_output: false,
      parallel: false,
      context: 'short'
    },
    idempotency_key: `copy-fast-live-prepare:${runId}:${CONTROLLED_S4_DELETE_PROFILE.expected_revision}`,
    inputs: {
      runtime: 'queue',
      timeout_ms: Math.min(timeoutMs, 300_000),
      recursive_limit: recursiveLimit,
      budgets: {
        max_operations: 5,
        max_affected_instances: 10,
        recursive_limit: recursiveLimit
      },
      save_model: false,
      capture_view: false,
      targets: controlledS4DeleteTargets(),
      operations: controlledS4DeleteOperations()
    }
  });
  const prepared = assertCopyFastPreparedTask(task);
  const readiness = await bridge.verify_agent_task_authorization_ready({ task_id: task.task_id });
  assertCopyFastReadiness(readiness, prepared.session_id);
  const challengeCount = await directoryEntryCount(path.join(bridge.approvalAuthority.stateDir, 'challenges'));
  if (challengeCount !== 0) {
    throw new Error('Copy Fast live QA unexpectedly created an approval challenge.');
  }

  const handshake = await bridge.create_queue_handshake({
    expires_in_ms: 5 * 60 * 1000,
    timeoutMs
  });
  const submitArgs = {
    task_id: task.task_id,
    idempotency_key: `copy-fast-live-apply:${task.task_id}`,
    input: {
      session_contract: handshake.session_contract,
      note: 'Server-owned Copy Fast session; no Agent or user approval credential.'
    }
  };
  const applied = await bridge.submit_agent_task_input(submitArgs);
  const completed = assertCopyFastCompletedTask(applied, prepared.session_id);
  const replay = await bridge.submit_agent_task_input(submitArgs);
  if (replay.ok !== true || replay.idempotent_replay !== true || replay.task_state !== 'completed') {
    throw new Error('Copy Fast live idempotent replay did not return the completed result.');
  }

  const after = await bridge.adopt_open_model({
    runtime: 'queue',
    read_only: true,
    structural_groups: true,
    structural_group_limit: 5000,
    timeoutMs
  });
  const verification = verifyControlledS4Deletion(after, { expectedModelPath: options.modelPath });
  if (!verification.pass) throw new Error('Copy Fast live target/postcondition verification failed.');
  const queueAfter = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs });
  assertQueueIdle(queueAfter);
  const activeIdentityAfter = await bridge.get_active_model_identity({ timeoutMs });
  if (activeIdentityAfter.model_modified !== true
    || path.resolve(activeIdentityAfter.model_identity?.source_path || '') !== options.modelPath) {
    throw new Error('The post-edit active document identity or modified state is not the expected disposable model.');
  }
  const diskShaAfter = await fileSha256(options.modelPath);
  if (diskShaAfter !== diskShaBefore) {
    throw new Error('The disposable source SKP changed even though save_model=false.');
  }

  const evidence = {
    version: COPY_FAST_LIVE_VERSION,
    kind: 'copy_fast_session_live_evidence',
    captured_at: new Date().toISOString(),
    branch: currentBranch(),
    baseline_commit: currentCommit(),
    source_sha256: await sourceHashes(),
    runtime: runtimeEvidence(capabilities.runtime, handshake.session_contract),
    installed_source: installedSource,
    model: {
      ...options.model,
      disk_sha256_before: diskShaBefore,
      disk_sha256_after: diskShaAfter,
      disk_bytes_unchanged: true,
      revision_complete: before.model_revision_complete === true,
      logical_occurrences_before: before.model_revision_total_seen,
      active_document_modified_after: activeIdentityAfter.model_modified === true
    },
    prepare: {
      task_id: task.task_id,
      task_state: task.task_state,
      risk_level: task.result.risk_level,
      plan_id: task.result.plan_id,
      plan_hash: task.result.plan_hash,
      model_revision: task.result.model_revision,
      execution_mode: task.result.execution_mode,
      next_action: task.next_action.action,
      user_action_required: task.result.user_action_required,
      approval_challenge: task.result.approval_challenge,
      copy_fast_session_id: prepared.session_id,
      copy_fast_session_expires_at: task.result.copy_fast_session.expires_at,
      approval_challenges_created: challengeCount,
      configured_roots_exposed_to_agent: false
    },
    apply: {
      task_state: applied.task_state,
      submit_count: 1,
      authorization_mode: applied.result.authorization.mode,
      approved_by: applied.result.authorization.approved_by,
      copy_fast_session_id: applied.result.authorization.copy_fast_session_id,
      user_action_required: applied.result.authorization.user_action_required,
      receipt_id: applied.result.mutation_receipt.receipt_id,
      receipt_status: applied.result.mutation_receipt.status,
      model_revision_before: applied.result.model_revision_before,
      model_revision_after: completed.model_revision_after,
      revision_changed: completed.model_revision_after !== applied.result.model_revision_before,
      target_absent: verification.deleted_target_absent,
      empty_parent_absent: verification.expected_empty_parent_absent,
      structural_group_count_after: verification.structural_group_count_after,
      approval_token_exposed_to_agent: false,
      milestone_acceptance: true
    },
    replay: {
      same_idempotency_key: true,
      idempotent_replay: true,
      duplicate_mutation: false,
      task_state: replay.task_state
    },
    queue: {
      before: summarizeQueue(queueBefore),
      after: summarizeQueue(queueAfter)
    },
    release_acceptance: false,
    boundaries: [
      'This proves one current-source Copy Fast S4 live path on an exact disposable model copy.',
      'The SKP is intentionally not saved; save/reopen behavior is covered by separate reliability evidence.',
      'This does not prove broad destructive-edit reliability, visual quality, multi-Agent compatibility, or cross-version SketchUp support.'
    ]
  };
  assertCopyFastLiveEvidenceBindings(evidence);
  await assertCopyFastLiveEvidenceSchema(evidence);
  const evidencePath = path.join(runDir, 'copy-fast-session-live-evidence.json');
  await writeJson(evidencePath, evidence);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: COPY_FAST_LIVE_VERSION,
    milestone_acceptance: true,
    task_id: task.task_id,
    copy_fast_session_id: prepared.session_id,
    approval_challenges_created: challengeCount,
    idempotent_replay: true,
    duplicate_mutation: false,
    disk_bytes_unchanged: true,
    queue_after: evidence.queue.after,
    evidence_path: evidencePath,
    release_acceptance: false
  }, null, 2)}\n`);
}

export function assertCopyFastPreparedTask(task) {
  if (task?.ok !== true
    || task.task_state !== 'approved'
    || task.result?.risk_level !== 'S4'
    || task.result?.execution_mode !== 'copy_fast'
    || task.result?.user_action_required !== false
    || task.result?.approval_challenge !== null
    || task.result?.copy_fast_session?.status !== 'active'
    || task.result?.copy_fast_session?.agent_can_enable !== false
    || task.next_action?.action !== 'execute_copy_edit'
    || task.next_action?.approval_status !== 'copy_fast_active'
    || task.next_action?.user_action_required !== false
    || !Array.isArray(task.next_action?.required)
    || !task.next_action.required.includes('session_contract')) {
    throw new Error('The live plan did not enter the expected approved Copy Fast state.');
  }
  if (task.next_action.copy_fast_session_id !== task.result.copy_fast_session.session_id) {
    throw new Error('The public next action is not bound to the Copy Fast session.');
  }
  return { session_id: task.result.copy_fast_session.session_id };
}

export function assertCopyFastReadiness(readiness, sessionId) {
  if (readiness?.ok !== true
    || readiness.approval_status !== 'copy_fast_active'
    || readiness.approved_by !== 'execution-policy:copy-fast-session'
    || readiness.challenge_id !== null
    || readiness.user_action_required !== false
    || readiness.approval_token_exposed !== false
    || readiness.copy_fast_session?.session_id !== sessionId) {
    throw new Error('The server-owned Copy Fast session is not ready for execution.');
  }
}

export function assertCopyFastCompletedTask(result, sessionId) {
  const afterRevision = result?.result?.iteration?.after?.model_revision
    || result?.result?.iteration?.snapshot?.model_revision
    || result?.result?.model_revision_after;
  if (result?.ok !== true
    || result.task_state !== 'completed'
    || result.result?.authorization?.mode !== 'server_policy_copy_fast_session'
    || result.result?.authorization?.copy_fast_session_id !== sessionId
    || result.result?.authorization?.user_action_required !== false
    || result.result?.mutation_receipt?.status !== 'finalized'
    || !afterRevision) {
    throw new Error('The Copy Fast live task did not complete with a finalized bound receipt.');
  }
  return { model_revision_after: afterRevision };
}

export function assertCopyFastLiveEvidenceBindings(evidence) {
  const preparedSessionId = evidence?.prepare?.copy_fast_session_id;
  const appliedSessionId = evidence?.apply?.copy_fast_session_id;
  const initialRevision = evidence?.model?.expected_initial_revision;
  const preparedRevision = evidence?.prepare?.model_revision;
  const beforeRevision = evidence?.apply?.model_revision_before;
  const afterRevision = evidence?.apply?.model_revision_after;
  if (!preparedSessionId || preparedSessionId !== appliedSessionId) {
    throw new Error('Copy Fast live evidence is not bound to one server-owned session.');
  }
  if (!initialRevision
    || initialRevision !== preparedRevision
    || preparedRevision !== beforeRevision) {
    throw new Error('Copy Fast live evidence is not bound to one exact initial model revision.');
  }
  if (!afterRevision
    || beforeRevision === afterRevision
    || evidence?.apply?.revision_changed !== true) {
    throw new Error('Copy Fast live evidence does not prove one model revision transition.');
  }
  return true;
}

export async function assertCopyFastLiveEvidenceSchema(evidence) {
  const schema = JSON.parse(await fs.readFile(
    path.join(projectRoot, 'schema', 'copy-fast-session-live-evidence-v2.schema.json'),
    'utf8'
  ));
  const validate = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: { 'date-time': true }
  }).compile(schema);
  if (!validate(evidence)) {
    throw new Error(`Copy Fast live evidence schema failed: ${JSON.stringify(validate.errors)}`);
  }
  return true;
}

function createLiveBridge({ timeoutMs, runId, copyRoot }) {
  const stateRoot = path.join(defaultStateDir, 'agent-contract-v1', 'copy-fast-live', runId);
  return new SketchUpBridge({
    queueRuntime: new QueueRuntime({ timeoutMs }),
    executionPolicy: {
      allowed_runtimes: ['mock', 'queue'],
      allow_queue_mutation: true,
      allow_direct_expert_queue_mutation: false,
      auto_approve_risks: [],
      trusted_model_copy_auto_approval: {
        enabled: true,
        allowed_risks: ['S4'],
        allowed_roots: [copyRoot],
        max_affected_instances: 10,
        allow_save_model: false,
        session_ttl_ms: 30 * 60 * 1000
      },
      resource_limits: {
        max_operations: 5,
        max_affected_instances: 10,
        max_recursive_entities: 20_000
      }
    },
    approval: { stateDir: path.join(stateRoot, 'approvals') },
    agentContract: { rootDir: path.join(stateRoot, 'tasks') },
    sessionContract: { serverSessionId: `copy-fast-live-${runId}` }
  });
}

function assertRuntimeReady(runtime = {}) {
  const expected = getRuntimeCapabilities('queue');
  if (runtime.compatibility?.ok !== true
    || runtime.plugin?.version !== PRODUCT_VERSION
    || runtime.capability_version !== RUNTIME_CAPABILITY_VERSION
    || runtime.manifest_version !== CAPABILITY_MANIFEST_VERSION
    || runtime.boolean_operations_sha256 !== expected.boolean_operations_sha256
    || runtime.model_revision_source_sha256 !== expected.model_revision_source_sha256
    || runtime.model_revision?.strategy !== 'definition-merkle.v2') {
    throw new Error(`Loaded SketchUp runtime is not the expected current contract: ${JSON.stringify({
      plugin_version: runtime.plugin?.version || runtime.version,
      capability_version: runtime.capability_version,
      manifest_version: runtime.manifest_version,
      boolean_operations_sha256: runtime.boolean_operations_sha256,
      model_revision_source_sha256: runtime.model_revision_source_sha256,
      model_revision_strategy: runtime.model_revision?.strategy,
      compatibility: runtime.compatibility
    })}`);
  }
}

function runtimeEvidence(runtime = {}, sessionContract = {}) {
  return {
    name: 'queue',
    server_version: sessionContract.server_version || null,
    plugin_version: runtime.plugin?.version || runtime.version || null,
    sketchup_version: runtime.plugin?.sketchup_version || null,
    capability_version: runtime.capability_version || null,
    manifest_version: runtime.manifest_version || null,
    compatibility_ok: runtime.compatibility?.ok === true,
    operation_count: runtime.supported_operations?.length || null,
    boolean_operations_sha256: runtime.boolean_operations_sha256 || null,
    model_revision_source_sha256: runtime.model_revision_source_sha256 || null,
    model_revision_strategy: runtime.model_revision?.strategy || null,
    loaded_source_attestation_match: runtime.compatibility?.ok === true,
    server_process_fresh_for_session: true,
    operator_confirmed_full_sketchup_restart: true,
    handshake_id: sessionContract.handshake_id || null,
    plugin_session_id: sessionContract.session_id || null,
    document_id: sessionContract.document_id || null
  };
}

async function sourceHashes() {
  return Object.fromEntries(await Promise.all(SOURCE_PATHS.map(async (relative) => [
    relative,
    await fileSha256(path.join(projectRoot, relative))
  ])));
}

async function fileSha256(filePath) {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function directoryEntryCount(directory) {
  try {
    return (await fs.readdir(directory)).length;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
}

function currentBranch() {
  return execFileSync('git', ['branch', '--show-current'], {
    cwd: projectRoot,
    encoding: 'utf8'
  }).trim();
}

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8'
  }).trim();
}

function parseArgs(argv) {
  const result = {
    command: argv[0] && !argv[0].startsWith('--') ? argv[0] : null
  };
  for (let index = result.command ? 1 : 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--runtime') result.runtime = argv[++index];
    else if (value === '--queue-required') result.queueRequired = true;
    else if (value === '--ack-disposable-copy') result.ackDisposableCopy = true;
    else if (value === '--fresh-sketchup-confirmed') result.freshSketchUpConfirmed = true;
    else if (value === '--model-path') result.modelPath = argv[++index];
    else if (value === '--plugin-dir') result.pluginDir = argv[++index];
    else if (value === '--output-dir') result.outputDir = argv[++index];
    else if (value === '--timeout-ms') result.timeoutMs = Number(argv[++index]);
    else if (value === '--recursive-limit') result.recursiveLimit = Number(argv[++index]);
    else if (value === '--run-id') result.runId = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Expected an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function stableManifestJson(manifest) {
  return JSON.stringify(Object.fromEntries(
    Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))
  ));
}
