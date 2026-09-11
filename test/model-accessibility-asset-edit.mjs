import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import { prepareNativeAssetEdit, validateNativeAssetOperation } from '../src/model-accessibility-asset-edit.mjs';
import { prepareAgentGatewayCreationDsl } from '../src/agent-dsl-policy.mjs';
import { validateExistingModelEditOperations, prepareExistingModelEdit } from '../src/existing-model-editing.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { OPERATION_REGISTRY } from '../src/capabilities.mjs';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'native-asset-contract-')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const asset = path.join(root, 'chair.skp'), catalogPath = path.join(root, 'catalog.json');
const bytes = Buffer.from('OFFLINE TEST ONLY: not native SKP geometry');
const entry = { id: 'test-chair', name: 'Test chair', path: 'chair.skp', kind: 'skp', source: 'authored test fixture', license: 'test-only', file_sha256: sha(bytes), axes: { up: '+Z', units: 'mm' } };
const writeCatalog = entries => fs.writeFile(catalogPath, JSON.stringify({ version: 1, assets: entries }));
const input = { version: 1, mode: 'place', asset: { id: entry.id }, placement: { origin_mm: [1000, 600, 0], rotation_z_deg: 30 } };
const prepare = (assetEdit = input, more = {}) => prepareNativeAssetEdit({ assetEdit, taskId: 'task_test-native-asset', catalogPath, ...more });
let checks = 0;
const check = callback => { callback(); checks++; };
try {
  await fs.writeFile(asset, bytes);
  await writeCatalog([entry]);
  const schema = JSON.parse(await fs.readFile(new URL('../schema/model-accessibility-asset-edit-v1.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ strict: false }).compile(schema);
  check(() => assert.equal(validate(input), true));
  const planned = await prepare();
  check(() => assert.equal(planned.operations[0].source_sha256, sha(bytes)));
  check(() => assert.equal(planned.operations[0].source_path, asset));
  check(() => assert.deepEqual(planned.targets, []));
  check(() => assert.equal(planned.asset_record.native_verified, false));
  check(() => assert.equal((validateExistingModelEditOperations(planned.operations)).risk_level, 'S3'));
  check(() => assert.equal(validateExistingModelEditOperations(planned.operations).expert_validation_document.operations[0].confirmed, true));
  check(() => assert.deepEqual((validateNativeAssetOperation(planned.operations[0])).origin, [1000, 600, 0]));
  check(() => assert.throws(() => prepareAgentGatewayCreationDsl(JSON.stringify({ version: 1, units: 'mm', operations: planned.operations })), /additive creation operations only/));
  check(() => assert.equal(OPERATION_REGISTRY.place_component_asset.runtime_support.mock, 'unsupported'));
  const replacement = { ...input, mode: 'replace', target: { entity_path: 'pid:345' } };
  check(() => assert.equal(validate(replacement), true));
  const replacePlan = await prepare(replacement);
  check(() => assert.deepEqual(replacePlan.targets, [{ entity_path: 'pid:345' }]));
  check(() => assert.equal(replacePlan.operations[0].op, 'replace_component_asset'));
  for (const modify of [
    value => { value.asset.catalog_path = '/other/private-file'; },
    value => { value.asset.path = '/other/source.skp'; },
    value => { value.placement.scale = 2; },
    value => { delete value.placement.rotation_z_deg; },
    value => { value.placement.origin_mm = [1, 2]; },
    value => { value.target = { target_id: 'existing' }; },
    value => { value.asset.id = 'missing-stool'; }
  ]) {
    const changed = structuredClone(input); modify(changed);
    await assert.rejects(() => prepare(changed)); checks++;
  }
  for (const target of [{}, { entity_path: 'pid:1.2' }, { entity_path: 'pid:1', target_id: 'B' }, { target_id: '' }]) {
    await assert.rejects(() => prepare({ ...input, mode: 'replace', target })); checks++;
  }
  for (const catalog of [[entry, entry], [{ ...entry, file_sha256: '0'.repeat(64) }], [{ ...entry, path: 'recipe.mjs' }], [{ ...entry, license: 'unknown' }], [{ ...entry, path: null }]]) {
    await writeCatalog(catalog);
    await assert.rejects(() => prepare()); checks++;
  }
  await writeCatalog([entry]);
  await assert.rejects(() => prepare(input, { runtime: 'mock' }), /queue runtime/); checks++;
  await assert.rejects(() => prepare(input, { catalogPath: null }), /not configured/); checks++;
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(root, 'model.json') }, agentContract: { rootDir: path.join(root, 'state') } });
  await assert.rejects(() => prepareExistingModelEdit({ bridge, runtime: 'mock', instruction: 'Offline native asset must not execute in mock.', operations: planned.operations, targets: [] }), /unsupported by mock/); checks++;
  const start = await bridge.start_agent_task({ intent: 'reviewed_existing_model_edit', instruction: 'Reject arbitrary native source injection.', inputs: { runtime: 'mock', operations: planned.operations, targets: [] } });
  check(() => assert.equal(start.error?.code, 'OPERATION_NOT_ALLOWED'));
  check(() => assert.match(start.error.message, /server-configured catalog/));
  const afterBytes = await fs.readFile(asset);
  check(() => assert.deepEqual(afterBytes, bytes));
  const rawMain = await fs.readFile(new URL('../sketchup_plugin/alma_sketchup_mcp.rb', import.meta.url), 'utf8');
  check(() => assert.match(rawMain, /when 'place_component_asset', 'replace_component_asset'\s+apply_native_component_asset/));
  const packageSource = await fs.readFile(new URL('../scripts/package-sketchup-plugin.mjs', import.meta.url), 'utf8');
  check(() => assert.match(packageSource, /native_asset_operations\.rb/));
  // Exercise the real Gateway/plan/approval compiler with a deliberately mock
  // adoption callback. No queue runtime is constructed or native claim made.
  const planBridge = new SketchUpBridge({ assetCatalogPath: catalogPath,
    mock: { sessionPath: path.join(root, 'plan-model.json') }, agentContract: { rootDir: path.join(root, 'plan-state') },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, auto_approve_risks: [] },
    approval: { stateDir: path.join(root, 'plan-approval'), secret: 'native-asset-plan-offline-test-secret-over-32-bytes' } });
  await planBridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'component_definition', name: 'Shared', size: [20, 30, 40] },
    { op: 'component_instance', id: 'A', name: 'A', definition: 'Shared', origin: [0, 0, 0] },
    { op: 'component_instance', id: 'B', name: 'B', definition: 'Shared', origin: [0, 0, 0] }
  ] }) });
  const beforePlan = await fs.readFile(planBridge.mockRuntime.sessionPath, 'utf8');
  const mockAdopt = planBridge.adopt_open_model.bind(planBridge);
  planBridge.adopt_open_model = options => mockAdopt({ ...options, runtime: 'mock' });
  const selectMock = planBridge.selectRuntime.bind(planBridge);
  planBridge.selectRuntime = (runtime, options) => { assert.equal(runtime, 'mock', 'Offline plan must never select queue runtime'); return selectMock(runtime, options); };
  for (const assetEdit of [input, { ...input, mode: 'replace', target: { target_id: 'B' } }]) {
    const envelope = await planBridge.start_agent_task({ intent: 'reviewed_existing_model_edit', instruction: 'Offline plan only: exact configured native asset.', idempotency_key: `offline-${assetEdit.mode}`,
      inputs: { runtime: 'queue', asset_edit: assetEdit, save_model: false } });
    check(() => assert.equal(envelope.error, null, JSON.stringify(envelope.error)));
    check(() => assert.equal(envelope.task_state, 'awaiting_review'));
    const task = await planBridge.taskStore.getTask(envelope.task_id, { includePrivate: true });
    check(() => assert.equal(task.private.existing_edit_plan.risk_level, 'S3'));
    check(() => assert.equal(task.private.existing_edit_plan.compile_permission, 'ready_for_review'));
    check(() => assert.equal(task.private.existing_edit_plan.dsl_document.operations[0].source_sha256, sha(bytes)));
    check(() => assert.equal(task.private.native_asset_edit.asset_record.native_verified, false));
    check(() => assert.ok(task.result.approval_challenge));
    const changed = await planBridge.submit_agent_task_input({ task_id: envelope.task_id, idempotency_key: `change-frozen-${assetEdit.mode}`, input: { asset_edit: input } });
    check(() => assert.equal(changed.error?.code, 'INVALID_ARGUMENT'));
    const afterPlan = await fs.readFile(planBridge.mockRuntime.sessionPath, 'utf8');
    check(() => assert.equal(afterPlan, beforePlan));
  }
  console.log(`${checks} native asset offline contract checks passed; model calls=0; native calls=0; no SKP geometry acceptance.`);
} finally { await fs.rm(root, { recursive: true, force: true }); }
