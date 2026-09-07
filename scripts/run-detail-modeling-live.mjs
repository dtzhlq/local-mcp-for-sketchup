#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { buildDetailedScene, buildDetailedRecipeSample } from '../src/detailed-modeling/scenes.mjs';
import { inspectCreatedDetail } from './lib/inspect-created-detail.mjs';
import { claimLiveSubmission } from './lib/claim-live-submission.mjs';

const LIVE_TIMEOUT = 600000;
const repo = fileURLToPath(new URL('..', import.meta.url));
const root = path.join(repo, 'output/detail-modeling-implementation-2026-09-06');
const argv = process.argv.slice(2);
const modelOption = argv.indexOf('--model-name');
let modelName;
if (modelOption >= 0) {
  modelName = argv[modelOption + 1];
  if (!modelName || modelName.startsWith('--')) throw new Error('model-name requires an explicit file name');
  argv.splice(modelOption, 2);
  if (argv.includes('--model-name')) throw new Error('Duplicate model-name');
}
const [action, label = 'sample-window', argument, extra] = argv;
if (modelName && (!['inspect','capture','save','ops','inspect-created','inspect-addition','inspect-observed','open-test','display','create-addition'].includes(action) || !/^[a-z0-9][a-z0-9-]*\.skp$/.test(modelName) || !(modelName === `${label}.skp` || modelName.startsWith(`${label}-`)))) throw new Error('model-name must be an independent test copy with the exact label prefix');
const activeModelName = modelName || `${label}.skp`;
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('A safe unique test label is required.');
const dir = path.join(root, 'evidence', label);
await fs.mkdir(dir, { recursive: true });
const bridge = new SketchUpBridge({
  queue: { timeoutMs: LIVE_TIMEOUT },
  executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: true },
  agentContract: { rootDir: path.join(root, 'agent-state') },
  sessionContract: { serverSessionId: 'detail-modeling-live-implementation' },
  mock: { sessionPath: path.join(root, 'offline-unused.json') }
});
const write = async (name, data) => fs.writeFile(path.join(dir, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const fresh = async () => (await bridge.create_queue_handshake({ timeoutMs: LIVE_TIMEOUT })).session_contract;
const active = async () => {
  const info = await bridge.get_model_info({ runtime: 'queue', timeoutMs: LIVE_TIMEOUT });
  if (!info.source_path || path.resolve(info.source_path)!==path.join(root, 'models', activeModelName)) throw new Error('Live mutations require the exact saved independent test model named by this label.');
  return info;
};
const build = async operations => {
  await active();
  return bridge.build_model({ runtime: 'queue', timeoutMs: LIVE_TIMEOUT, code: JSON.stringify({ version: 1, units: 'mm', operations }), session_contract: await fresh() });
};

if (action === 'capabilities') {
  const result = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: LIVE_TIMEOUT });
  await write('capabilities.json', result); console.log(JSON.stringify({ compatibility: result.runtime?.compatibility, runtime: result.runtime?.capability_version, native_appearance: result.runtime?.native_appearance }));
} else if (action === 'init') {
  const file = path.join(root, 'models', `${label}.skp`);
  await fs.copyFile(path.join(root, 'backups/pre-detail-current-template.skp'), file, fs.constants.COPYFILE_EXCL);
  const opened = await bridge.open_model({ path: file, runtime: 'queue', timeoutMs: LIVE_TIMEOUT, session_contract: await fresh() });
  await write('open.json', opened); console.log(JSON.stringify({ opened: opened.file_path, open_status: opened.open_status }));
} else if (action === 'open-test') {
  const file=path.join(root,'models',activeModelName);
  if(path.dirname(await fs.realpath(file))!==await fs.realpath(path.join(root,'models')))throw new Error('Test model symlink escaped the test directory.');
  const opened=await bridge.open_model({path:file,runtime:'queue',timeoutMs:LIVE_TIMEOUT,session_contract:await fresh()});
  await write(`open-${argument||'current'}.json`,opened);console.log(JSON.stringify({opened:opened.file_path,open_status:opened.open_status}));
} else if (action === 'reset-test') {
  await active();
  const result = await bridge.reset_model({ runtime: 'queue', timeoutMs: LIVE_TIMEOUT, session_contract: await fresh() });
  await write('empty-test-model.json', result); console.log(JSON.stringify({ totals: result.snapshot?.totals || result.totals }));
} else if (action === 'create' || action === 'retry-create' || action === 'create-from-bundle') {
  await active();
  const parameters = extra ? JSON.parse(await fs.readFile(extra, 'utf8')) : {};
  const bundle = action === 'retry-create' ? JSON.parse(await fs.readFile(path.join(dir, 'frozen-bundle.json'), 'utf8')) : action === 'create-from-bundle' ? JSON.parse(await fs.readFile(argument, 'utf8')) : ['kitchen', 'entry-facade'].includes(argument) ? buildDetailedScene({ scene: argument, parameters }) : buildDetailedRecipeSample({ kind: argument || 'window', id: label, parameters });
  if (action !== 'retry-create') await write('frozen-bundle.json', bundle);
  const display = new Set(['reset', 'scene', 'style', 'camera', 'rendering_options', 'shadow']);
  const creation = { ...bundle.dsl, operations: bundle.dsl.operations.filter(op => !display.has(op.op)) };
  const inputs = { runtime: 'queue', session_contract: await fresh(), code: JSON.stringify(creation), detail_spec: bundle.detail_spec, views: bundle.views, include_preview: false };
  const result = action === 'retry-create' ? await bridge.submit_agent_task_input({ task_id: JSON.parse(await fs.readFile(path.join(dir, 'create-result.json'), 'utf8')).task_id, input: inputs }) : await bridge.start_agent_task({ intent: 'create_model', instruction: `按照冻结的构件、尺寸和细节规范，构造并检查 ${label}；质量缺项必须保持未完成。`, interface_level: 'expert',
    client_capabilities: { vision: true, local_files: true, structured_output: true, context: 'long' },
    idempotency_key: `detail-live-${label}`, inputs });
  const artifactLabel = action === 'retry-create' ? `${action}-${argument || 'next'}` : 'create';
  await write(`${artifactLabel}-result.json`, result);
  if (result.task_id) await write(`${artifactLabel}-task.json`, await bridge.taskStore.getTask(result.task_id, { includePrivate: true }));
  console.log(JSON.stringify({ ok: result.ok, task_id: result.task_id, state: result.task_state, error: result.error, result: result.result, next_action: result.next_action }));
} else if (action === 'create-addition') {
  if (!extra || !/^[a-z0-9-]+$/.test(extra)) throw new Error('A unique addition label is required after the bundle path');
  const additionDir = path.join(dir, 'additions', extra);
  const bundle = JSON.parse(await fs.readFile(argument, 'utf8'));
  if (!bundle.detail_spec || !Array.isArray(bundle.dsl?.operations) || bundle.dsl.operations.some(op => ['reset','scene','style','camera','rendering_options','shadow'].includes(op.op))) throw new Error('Addition requires explicit additive geometry and its own detail specification');
  await active();
  await fs.mkdir(path.dirname(additionDir), { recursive: true });
  // Claim the evidence directory before submitting any native mutation. A retry
  // must recover the original task rather than silently creating a second one.
  await fs.mkdir(additionDir, { recursive: false });
  const record = async (name, value) => fs.writeFile(path.join(additionDir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await record('frozen-bundle.json', bundle);
  const result = await bridge.start_agent_task({ intent: 'create_model', instruction: `仅补建 ${label}/${extra} 冻结规范中的新构件；保留现有模型和原任务要求，质量失败必须保持待修正。`, interface_level: 'expert',
    client_capabilities: { vision: true, local_files: true, structured_output: true, context: 'long' },
    idempotency_key: `detail-addition-${label}-${extra}`, inputs: { runtime: 'queue', session_contract: await fresh(), code: JSON.stringify(bundle.dsl), detail_spec: bundle.detail_spec, views: bundle.views, include_preview: false } });
  await record('create-result.json', result);
  if (result.task_id) await record('create-task.json', await bridge.taskStore.getTask(result.task_id, { includePrivate: true }));
  console.log(JSON.stringify({ ok: result.ok, task_id: result.task_id, state: result.task_state, error: result.error, result: result.result, next_action: result.next_action, original_task_unchanged: true }));
} else if (action === 'inspect-created' || action === 'inspect-addition' || action === 'inspect-observed') {
  if (!argument || !/^[a-z0-9-]+$/.test(argument)) throw new Error('A unique inspection label is required.');
  if (action === 'inspect-addition' && (!extra || !/^[a-z0-9-]+$/.test(extra))) throw new Error('An explicit safe addition label is required.');
  const inspectionLabel = action === 'inspect-addition' ? `addition-${extra}-${argument}` : argument;
  const artifact = `independent-inspection-${inspectionLabel}.json`;
  try { await fs.access(path.join(dir, artifact)); throw new Error('Inspection artifact already exists.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const taskDir = action === 'inspect-addition' ? path.join(dir, 'additions', extra) : dir;
  const original = JSON.parse(await fs.readFile(path.join(taskDir, 'create-result.json'), 'utf8'));
  const observed = action === 'inspect-observed' ? JSON.parse(await fs.readFile(extra, 'utf8')) : null;
  if (observed && (observed.scope !== 'independent_inspection_only' || !observed.occurrence_path_map)) throw new Error('Observed bindings must explicitly remain independent inspection only');
  const result = await inspectCreatedDetail({ bridge, taskId: original.task_id, assertActive: active, timeoutMs: LIVE_TIMEOUT,
    observedOccurrencePathMap: observed?.occurrence_path_map,
    outputDir: path.join(root, 'captures', label, `independent-${inspectionLabel}`) });
  await write(artifact, result);
  console.log(JSON.stringify({ quality_accepted: result.quality_accepted, quality_status: result.quality.quality_status,
    remaining: result.quality.remaining, errors: result.errors, source_task_unchanged: true }));
} else if (action === 'inspect') {
  await active();
  const result = await bridge.inspect_model({ runtime: 'queue', timeoutMs: LIVE_TIMEOUT, includeSnapshot: true });
  await write(`inspect-${argument || 'current'}.json`, result);
  const occurrences = result.snapshot?.geometry_occurrences || [];
  console.log(JSON.stringify({ totals: result.snapshot?.totals, occurrences: occurrences.length, errors: occurrences.filter(o => !o.geometry_evidence?.measured).slice(0, 5), holes: occurrences.flatMap(o => o.geometry_evidence?.through_holes || []).length }));
} else if (action === 'save') {
  const info = await active();
  const result = await bridge.save_model({ path: info.source_path, keep_session: true, runtime: 'queue', timeoutMs: LIVE_TIMEOUT, session_contract: await fresh() });
  await write(`save-${argument || 'current'}.json`, result); console.log(JSON.stringify({ file: result.file_path, size: result.file_size_bytes }));
} else if (action === 'reopen') {
  const info = await active();
  const result = await bridge.open_model({ path: info.source_path, runtime: 'queue', timeoutMs: LIVE_TIMEOUT, session_contract: await fresh() });
  await write(`reopen-${argument || 'current'}.json`, result);
  console.log(JSON.stringify({ file: result.file_path, open_status: result.open_status }));
} else if (action === 'capture') {
  await active();
  const views = extra ? JSON.parse(await fs.readFile(extra, 'utf8')) : JSON.parse(await fs.readFile(path.join(dir, 'frozen-bundle.json'), 'utf8')).views.map(({ target_id, ...view }) => view);
  const result = await bridge.capture_detail_views({ views, output_dir: path.join(root, 'captures', label, argument || 'current'), runtime: 'queue', timeoutMs: LIVE_TIMEOUT, session_contract: await fresh() });
  await write(`capture-${argument || 'current'}.json`, result);
  console.log(JSON.stringify({ restored: result.restored, scope: result.capture_scope, restoration: result.restoration, captures: result.captures?.map(c => ({ id: c.id, verified: c.server_verified, file: c.file_path })) }));
} else if (action === 'display') {
  const bundle = JSON.parse(await fs.readFile(path.join(dir, 'frozen-bundle.json'), 'utf8'));
  const result = await build(bundle.dsl.operations.filter(op => ['scene', 'style', 'camera', 'rendering_options', 'shadow'].includes(op.op)));
  await write('display-result.json', result); console.log(JSON.stringify({ totals: result.snapshot?.totals }));
} else if (action === 'ops') {
  const artifact = `ops-${path.basename(argument).replace(/[^a-zA-Z0-9.-]/g, '-')}`;
  const operations = JSON.parse(await fs.readFile(argument, 'utf8'));
  await claimLiveSubmission(dir, artifact, { submitted_at: new Date().toISOString(), model_name: activeModelName, operations });
  const result = await build(operations.operations || operations);
  await write(artifact, result); console.log(JSON.stringify({ totals: result.snapshot?.totals, warnings: result.snapshot?.warnings?.filter(w => w.severity === 'error') }));
} else if (action === 'refine') {
  await active();
  const code = await fs.readFile(argument, 'utf8');
  JSON.parse(code);
  const artifact = `refine-${path.basename(argument).replace(/[^a-zA-Z0-9.-]/g, '-')}`;
  await claimLiveSubmission(dir, artifact, { submitted_at: new Date().toISOString(), model_name: activeModelName, code });
  const original = JSON.parse(await fs.readFile(path.join(dir, 'create-result.json'), 'utf8'));
  const result = await bridge.submit_agent_task_input({ task_id: original.task_id, input: { runtime: 'queue', session_contract: await fresh(), refinement_code: code } });
  await write(artifact, result);
  await write(`${artifact}.task.json`, await bridge.taskStore.getTask(original.task_id, { includePrivate: true }));
  console.log(JSON.stringify({ ok: result.ok, state: result.task_state, error: result.error, result: result.result }));
} else if (action === 'reverify') {
  const original = JSON.parse(await fs.readFile(path.join(dir, 'create-result.json'), 'utf8'));
  const result = await bridge.submit_agent_task_input({ task_id: original.task_id, input: { reverify: true } });
  await write(`reverify-${argument || 'current'}.json`, result); console.log(JSON.stringify({ ok: result.ok, state: result.task_state, error: result.error, result: result.result }));
} else throw new Error('Expected capabilities, init, reset-test, create, create-from-bundle, inspect, display, ops, reverify, capture, reopen or save.');
