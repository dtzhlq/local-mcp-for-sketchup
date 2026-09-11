#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../src/bridge.mjs';
import { canonicalJson } from '../../src/agent-contract.mjs';
import { prepareNativeAssetEdit } from '../../src/model-accessibility-asset-edit.mjs';

export const HOST_ASSET_DEVELOPMENT_VERSION = 'host-native-asset-development.v1';
export const HOST_ASSET_INPUT = Object.freeze({ version: 1, mode: 'place', asset: { id: 'local-chair' },
  placement: { origin_mm: [1000, 1200, 0], rotation_z_deg: 30 } });

// Host diagnostic only. Importing this module never calls SketchUp. It has no
// approval issuer, local-host setup, credential reader or model-provider call.
export function createNativeAssetDevelopment(options, dependencies = {}) {
  const config = normalizeConfig(options);
  const bridge = dependencies.bridge || new SketchUpBridge({ assetCatalogPath: config.catalogPath,
    agentContract: { rootDir: config.stateDir },
    approval: { stateDir: config.approvalStateDir, approvalHostUrl: config.approvalHostUrl },
    sessionContract: { stateDir: path.join(config.stateDir, 'sessions'), serverSessionId: HOST_ASSET_DEVELOPMENT_VERSION },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: false, auto_approve_risks: [] } });
  const filename = name => path.join(config.outputDir, name);
  const write = async (name, value) => writeExclusiveJson(filename(name), value);
  const signed = async (name, body) => write(name, { ...body, integrity_hmac: await bridge.taskStore.mutationReceiptLedger.sign(body) });
  const load = async () => {
    const { integrity_hmac, ...record } = JSON.parse(await fs.readFile(filename('prepared.json'), 'utf8'));
    if (canonicalJson(record.config) !== canonicalJson(config) || integrity_hmac !== await bridge.taskStore.mutationReceiptLedger.sign(record)) throw new Error('Prepared host record/config integrity mismatch.');
    const task = await bridge.taskStore.getTask(record.task_id, { includePrivate: true });
    if (task.intent !== 'reviewed_existing_model_edit' || task.inputs.runtime !== 'queue' || canonicalJson(task.inputs.asset_edit) !== canonicalJson(HOST_ASSET_INPUT) ||
      task.private?.existing_edit_plan?.plan_hash !== record.plan.plan_hash) throw new Error('Prepared task does not match its fixed reviewed asset plan.');
    return { record, task };
  };
  const readiness = async task => {
    try { return await bridge.agentGateway.verifyTaskAuthorizationReady({ task_id: task.task_id }); }
    catch (error) { return { ok: false, code: error.code || 'READINESS_UNAVAILABLE', message: error.message, user_action_required: true }; }
  };
  const inspect = async () => {
    // Read-only adoption requires an already open model. Unlike the older
    // inspect_model fallback, it never creates a document when none is active.
    const observed = await bridge.adopt_open_model({ runtime: 'queue', read_only: true, recursive: false, timeoutMs: config.timeoutMs });
    return { ...observed, snapshot: { ...observed.snapshot, model_revision: observed.model_revision, model_revision_complete: observed.model_revision_complete } };
  };
  const sourceRecord = () => prepareNativeAssetEdit({ assetEdit: structuredClone(HOST_ASSET_INPUT), taskId: 'host-native-asset-development-preflight',
    runtime: 'queue', catalogPath: config.catalogPath });
  return {
    config,
    async prepare() {
      await fs.mkdir(config.outputDir, { recursive: true, mode: 0o700 });
      await write('prepare-started.json', { version: HOST_ASSET_DEVELOPMENT_VERSION, created_at: new Date().toISOString(), config });
      const source = await sourceRecord();
      const queue = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: config.timeoutMs }); assertQueueIdle(queue);
      const caps = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: config.timeoutMs });
      await write('capabilities.json', caps);
      if (!caps.runtime?.supported_operations?.includes('place_component_asset')) throw new Error('Installed native plugin does not support place_component_asset; install and restart before preparing.');
      const before = await inspect(); await write('native-before.json', before);
      assertEmptyNativeTemplate(before.snapshot);
      const taskResponse = await bridge.start_agent_task({ intent: 'reviewed_existing_model_edit',
        instruction: '主机开发验证：从服务端已核验目录导入 local-chair 的完整 SKP 根，保持原尺寸，在世界坐标毫米 [1000,1200,0] 放置并绕 Z 轴旋转 30 度。保留模板资源；受审执行后保存唯一版本副本并截图。这不是正式模型验收。',
        interface_level: 'guided', client_capabilities: { vision: false, local_files: true, structured_output: true, parallel: false, context: 'short' },
        idempotency_key: `host-native-asset-prepare:${crypto.createHash('sha256').update(config.outputDir).digest('hex')}`,
        inputs: { runtime: 'queue', timeout_ms: config.timeoutMs, recursive_limit: 10000,
          asset_edit: structuredClone(HOST_ASSET_INPUT), save_model: true, save_path: filename('asset-model.skp'), capture_view: true } });
      await write('prepare-response.json', taskResponse);
      const task = taskResponse.task_id ? await bridge.taskStore.getTask(taskResponse.task_id, { includePrivate: true }) : null;
      const plan = task?.private?.existing_edit_plan;
      if (taskResponse.ok !== true || task?.state !== 'awaiting_review' || plan?.risk_level !== 'S3' || !task.result?.approval_challenge?.challenge_id ||
        plan.model_revision !== before.snapshot.model_revision || taskResponse.next_action?.approval_host?.user_presence_required !== true) {
        throw new Error('A real queue S3 review/challenge bound to the unchanged empty template was not prepared; inspect prepare-response.json.');
      }
      const approvalUrl = taskResponse.next_action.approval_host.url;
      const record = { version: HOST_ASSET_DEVELOPMENT_VERSION, kind: 'native_asset_development_prepare', prepared_at: new Date().toISOString(), config,
        task_id: task.task_id, task_state: task.state, runtime: 'queue', mock_ready: false, native_mutation_performed: false,
        approval_required: true, approval_url: approvalUrl, approval_challenge_id: task.result.approval_challenge.challenge_id,
        approval_host_status: 'not_probed_or_started_by_helper', approval_identity: 'reuse_configured_existing_local_host',
        plan: { plan_id: plan.plan_id, plan_hash: plan.plan_hash, model_revision: plan.model_revision, risk_level: plan.risk_level,
          operations: plan.dsl_document.operations, execution_contract: plan.execution_contract }, source: source.asset_record,
        formal_acceptance: false, next_action: 'The real user reviews this challenge in the configured local approval host; run status, then apply only after a trusted decision exists.' };
      await signed('prepared.json', record);
      return record;
    },
    async status() {
      const { record, task } = await load();
      const ready = await readiness(task);
      return { version: HOST_ASSET_DEVELOPMENT_VERSION, kind: 'native_asset_development_status', task_id: task.task_id, task_state: task.state,
        approval_url: record.approval_url, authorization: ready, ready_to_apply: task.state === 'awaiting_review' && ready.ok === true && ready.approval_status === 'approved_pending_execution',
        mock_ready: false, native_probe_performed: false, mutation_performed: false,
        apply_started: await exists(filename('apply-started.json')), apply_record_exists: await exists(filename('apply-result.json')) };
    },
    async apply() {
      const { record, task } = await load();
      if (await exists(filename('apply-started.json'))) {
        if (await exists(filename('apply-result.json'))) return { ...JSON.parse(await fs.readFile(filename('apply-result.json'), 'utf8')), replayed_read_only: true };
        throw new Error('A previous apply was claimed without a final host record. Inspect task/queue evidence; this helper will not submit again.');
      }
      const ready = await readiness(task);
      if (task.state !== 'awaiting_review' || ready.ok !== true || ready.approval_status !== 'approved_pending_execution') {
        return { kind: 'native_asset_development_approval_required', task_id: task.task_id, approval_url: record.approval_url,
          authorization: ready, ready_to_apply: false, mock_ready: false, native_mutation_performed: false };
      }
      const currentSource = await sourceRecord();
      if (canonicalJson(currentSource.asset_record) !== canonicalJson(record.source)) throw new Error('Native catalog/source changed since review.');
      const queue = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: config.timeoutMs }); assertQueueIdle(queue);
      const before = await inspect(); assertEmptyNativeTemplate(before.snapshot);
      if (before.snapshot.model_revision !== record.plan.model_revision) throw new Error('The empty template changed since review.');
      await write('native-before-apply.json', before);
      const connection = await bridge.start_agent_task({ intent: 'discover', inputs: { topic: 'connect', runtime: 'queue', timeout_ms: config.timeoutMs },
        instruction: 'Create a fresh read-only connection for the already approved native asset development task.', interface_level: 'guided' });
      await write('connection.json', connection);
      if (connection.ok !== true || connection.task_state !== 'completed' || !connection.result?.connection_task_id) throw new Error('Fresh Gateway connection unavailable.');
      await signed('apply-started.json', { version: HOST_ASSET_DEVELOPMENT_VERSION, task_id: task.task_id, plan_hash: record.plan.plan_hash,
        connection_task_id: connection.result.connection_task_id, decision_id: ready.decision_id, started_at: new Date().toISOString(), automatic_retry_allowed: false });
      let response, dispatchError;
      try { response = await bridge.submit_agent_task_input({ task_id: task.task_id, idempotency_key: `host-native-asset-apply:${task.task_id}`,
        input: { connection_task_id: connection.result.connection_task_id, note: 'Execute only the existing independently approved asset plan and its frozen save/capture contract.' } }); }
      catch (error) { dispatchError = { code: error.code || 'NATIVE_OUTCOME_UNKNOWN', message: error.message }; }
      await write('apply-response.json', response || { error: dispatchError });
      let after, adoption, observationError;
      try {
        after = await inspect(); await write('native-after.json', after);
        adoption = await bridge.adopt_open_model({ runtime: 'queue', read_only: true, recursive: true, recursive_limit: 10000, timeoutMs: config.timeoutMs });
        await write('native-after-adoption.json', adoption);
      } catch (error) { observationError = { code: error.code || 'READBACK_UNAVAILABLE', message: error.message }; }
      const finalTask = await bridge.taskStore.getTask(task.task_id, { includePrivate: true });
      const file = await fileReceipt(record.plan.execution_contract.final_save_path);
      const sourceAfter = await fileReceipt(record.source.source_path);
      const boundary = assetReadbackBoundary({ before: before.snapshot, after: after?.snapshot, adoption, operation: record.plan.operations[0] });
      const completed = response?.ok === true && finalTask.state === 'completed';
      const result = { version: HOST_ASSET_DEVELOPMENT_VERSION, kind: 'native_asset_development_apply', applied_at: new Date().toISOString(),
        task_id: task.task_id, task_state: finalTask.state, completed, runtime: 'queue', mock_ready: false,
        native_mutation_receipt: finalTask.result?.mutation_receipt || null, authorization: finalTask.result?.authorization || null,
        native_mutation_performed: Boolean(finalTask.result?.mutation_receipt), boundary, file_receipt: file,
        source_file_unchanged: sourceAfter.sha256 === record.source.source_sha256 && sourceAfter.bytes === record.source.size_bytes,
        artifacts: finalTask.artifacts || [], dispatch_error: dispatchError || response?.error || null, observation_error: observationError || null,
        diagnostic_pass: completed && boundary.passed && file.available === true && sourceAfter.sha256 === record.source.source_sha256,
        evidence_scope: 'host_development_only', formal_acceptance: false, cold_reopen_verified: false, automatic_retry_allowed: false };
      await write('apply-result.json', result);
      return result;
    }
  };
}

export function assertEmptyNativeTemplate(snapshot) {
  if (!snapshot || snapshot.model_revision_complete !== true || !Array.isArray(snapshot.instances) || !Array.isArray(snapshot.groups) ||
    snapshot.instances.length || snapshot.groups.length || snapshot.totals?.faces !== 0 || snapshot.totals?.edges !== 0 ||
    snapshot.resource_totals?.complete !== true || snapshot.resource_totals?.scope !== 'all_native_stored_geometry' ||
    snapshot.resource_totals.faces !== 0 || snapshot.resource_totals.edges !== 0) {
    throw new Error('A genuinely empty complete native template is required. This helper never clears an existing model.');
  }
}
export function assetReadbackBoundary({ before, after, adoption, operation }) {
  const roots = [...(after?.instances || []), ...(after?.groups || [])], matches = roots.filter(root => root.id === operation?.id);
  const root = matches.length === 1 ? matches[0] : null;
  const pathRef = root?.persistent_id ? `pid:${root.persistent_id}` : null;
  const occurrences = (adoption?.recursive_index || []).filter(entry => entry.entity_path === pathRef);
  const matrix = occurrences.length === 1 ? occurrences[0].world_transform : null;
  const radians = 30 * Math.PI / 180, expected = [Math.cos(radians), Math.sin(radians), 0, 0, -Math.sin(radians), Math.cos(radians), 0, 0, 0, 0, 1, 0, 1000 / 25.4, 1200 / 25.4, 0, 1];
  const matrixVerified = Array.isArray(matrix) && matrix.length === 16 && matrix.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) <= 1e-8);
  const checks = { exactly_one_new_complete_root: roots.length === 1 && Boolean(root?.persistent_id) && root.faces > 0 && root.edges > 0,
    complete_matching_native_revision: after?.model_revision_complete === true && adoption?.model_revision_complete === true && adoption?.recursive_truncated !== true && after.model_revision === adoption.model_revision,
    actual_native_matrix_verified: matrixVerified, blank_before_preserved_as_additive_scope: before?.instances?.length === 0 && before?.groups?.length === 0 };
  return { ...checks, passed: Object.values(checks).every(value => value === true), root_reference: pathRef,
    native_world_matrix: matrix, native_matrix_translation_units: 'SketchUp native inches', requested_origin_mm: [1000, 1200, 0], requested_rotation_z_deg: 30,
    measured_world_bounds_mm: root?.bounding_box || null, source_size_and_closeup_acceptance: 'requires_separate_review' };
}
function normalizeConfig(options = {}) {
  for (const key of ['catalogPath', 'stateDir', 'outputDir']) if (typeof options[key] !== 'string' || !path.isAbsolute(options[key])) throw new Error(`${key} must be an explicit absolute host path.`);
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('timeoutMs must be 1000..300000.');
  if (path.resolve(options.stateDir) === path.resolve(options.outputDir)) throw new Error('Task state and diagnostic output require distinct directories.');
  return { catalogPath: path.resolve(options.catalogPath), stateDir: path.resolve(options.stateDir), outputDir: path.resolve(options.outputDir), timeoutMs,
    approvalStateDir: path.resolve(options.approvalStateDir || path.join(os.homedir(), '.sketchup-mcp-replica', 'agent-contract-v1', 'approvals')),
    approvalHostUrl: options.approvalHostUrl || 'http://127.0.0.1:3978' };
}
function assertQueueIdle(value) {
  const d = value?.diagnostics || value;
  if ((d.queue_count ?? d.queue?.count) !== 0 || (d.processing_count ?? d.processing?.count) !== 0 || (d.response_count ?? d.responses_count ?? d.responses?.count) !== 0 || (d.lock_exists ?? d.lock?.exists) !== false) throw new Error('The native queue is not fully idle; no task may be submitted.');
}
async function fileReceipt(target) {
  if (typeof target !== 'string') return { available: false, path: null };
  try { const bytes = await fs.readFile(target); return { available: bytes.length > 0, path: target, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; }
  catch (error) { return { available: false, path: target, error: error.code || 'FILE_UNAVAILABLE' }; }
}
async function writeExclusiveJson(target, value) {
  const handle = await fs.open(target, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
}
async function exists(target) { try { await fs.lstat(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function parseArgs(argv) {
  const [command, ...flags] = argv;
  if (!['prepare', 'status', 'apply'].includes(command)) throw new Error('Use prepare|status|apply --catalog ABS --state-dir ABS --output-dir ABS [--approval-state-dir ABS] [--approval-host-url URL] [--timeout-ms N].');
  const names = { '--catalog': 'catalogPath', '--state-dir': 'stateDir', '--output-dir': 'outputDir', '--approval-state-dir': 'approvalStateDir', '--approval-host-url': 'approvalHostUrl', '--timeout-ms': 'timeoutMs' };
  const options = {};
  for (let index = 0; index < flags.length; index += 2) {
    const key = names[flags[index]];
    if (!key || flags[index + 1] === undefined || Object.hasOwn(options, key)) throw new Error(`Unknown, duplicate or incomplete option ${flags[index]}`);
    options[key] = key === 'timeoutMs' ? Number(flags[index + 1]) : flags[index + 1];
  }
  return { command, options };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { command, options } = parseArgs(process.argv.slice(2));
  console.log(JSON.stringify(await createNativeAssetDevelopment(options)[command](), null, 2));
}
