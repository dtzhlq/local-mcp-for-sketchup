import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createNativeAssetDevelopment, assertEmptyNativeTemplate, assetReadbackBoundary } from '../scripts/model-accessibility/native-asset-development.mjs';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'asset-development-helper-test-')));
const empty = () => ({ model_revision: 'native-fixture-revision', model_revision_complete: true, instances: [], groups: [], totals: { faces: 0, edges: 0 },
  resource_totals: { complete: true, scope: 'all_native_stored_geometry', faces: 0, edges: 0 } });
try {
  assertEmptyNativeTemplate(empty());
  for (const altered of [{ ...empty(), instances: [{ id: 'valuable' }] }, { ...empty(), model_revision_complete: false },
    { ...empty(), resource_totals: null }, { ...empty(), resource_totals: { complete: true, scope: 'all_native_stored_geometry', faces: 1, edges: 4 } }]) {
    assert.throws(() => assertEmptyNativeTemplate(altered), /empty complete native template/);
  }
  const catalogPath = path.join(root, 'catalog.json'), source = path.join(root, 'fixture.skp');
  await fs.writeFile(source, 'offline synthetic bytes only');
  await fs.writeFile(catalogPath, JSON.stringify({ version: 1, assets: [{ id: 'local-chair', path: source, source: 'Authored fixture', license: 'Test',
    file_sha256: crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex') }] }));
  const options = { catalogPath, stateDir: path.join(root, 'state'), outputDir: path.join(root, 'output') };
  const calls = [], tasks = new Map(); let approved = false;
  const sign = async body => crypto.createHash('sha256').update('offline-test-signature').update(JSON.stringify(body)).digest('hex');
  const fake = {
    taskStore: { mutationReceiptLedger: { sign }, async getTask(id) { return structuredClone(tasks.get(id)); } },
    agentGateway: { async verifyTaskAuthorizationReady() { calls.push('readiness'); return approved
      ? { ok: true, approval_status: 'approved_pending_execution', decision_id: 'offline-fake-decision' }
      : { ok: false, code: 'APPROVAL_REQUIRED' }; } },
    async queue_diagnostics() { calls.push('queue_read'); return { queue_count: 0, processing_count: 0, response_count: 0, lock_exists: false }; },
    async get_capabilities() { calls.push('capability_read'); return { runtime: { supported_operations: ['place_component_asset'] } }; },
    async inspect_model() { calls.push('native_read_fake'); return { snapshot: empty() }; },
    async start_agent_task(input) {
      calls.push(`start:${input.intent}`);
      if (input.intent === 'discover') return { ok: true, task_state: 'completed', result: { connection_task_id: 'task_connection_fixture' } };
      const task_id = 'task_host_asset_fixture';
      const plan = { plan_id: 'plan-fixture', plan_hash: 'plan-fixture-hash', model_revision: 'native-fixture-revision', risk_level: 'S3',
        dsl_document: { operations: [{ op: 'place_component_asset', id: 'asset-fixture' }] },
        execution_contract: { save_model: true, capture_view: true, final_save_path: path.join(options.outputDir, 'saved-fixture.skp') } };
      tasks.set(task_id, { task_id, intent: input.intent, state: 'awaiting_review', inputs: input.inputs, private: { existing_edit_plan: plan },
        result: { approval_challenge: { challenge_id: 'approval-fixture' } }, artifacts: [] });
      return { ok: true, task_id, task_state: 'awaiting_review', next_action: { approval_host: { user_presence_required: true, url: 'http://127.0.0.1:3978/approvals/approval-fixture' } } };
    },
    async submit_agent_task_input() { calls.push('submit_fake'); throw new Error('Synthetic response loss; never retry'); },
    async adopt_open_model() { calls.push('adoption_read_fake'); return { model_revision: 'native-fixture-revision', model_revision_complete: true, recursive_index: [], snapshot: empty() }; }
  };
  const helper = createNativeAssetDevelopment(options, { bridge: fake });
  assert.equal(helper.config.approvalStateDir, path.join(os.homedir(), '.sketchup-mcp-replica/agent-contract-v1/approvals'));
  assert.equal(createNativeAssetDevelopment({ ...options, approvalStateDir: path.join(root, 'host-approvals') }, { bridge: fake }).config.approvalStateDir, path.join(root, 'host-approvals'));
  const prepared = await helper.prepare();
  assert.equal(prepared.mock_ready, false);
  assert.equal(prepared.approval_required, true);
  assert.equal(prepared.native_mutation_performed, false);
  assert.equal(calls.includes('submit_fake'), false);
  const position = calls.length;
  const status = await helper.status();
  assert.equal(status.ready_to_apply, false);
  assert.deepEqual(calls.slice(position), ['readiness'], 'status cannot call native, resume tasks or execute');
  const approvalRequired = await helper.apply();
  assert.equal(approvalRequired.ready_to_apply, false);
  assert.equal(calls.includes('start:discover'), false, 'missing approval blocks before connection/native access');
  assert.equal(calls.includes('submit_fake'), false);
  approved = true; // A supplied fake read-only response, not an approval issuer.
  assert.equal((await helper.status()).ready_to_apply, true);
  const applied = await helper.apply();
  assert.equal(applied.completed, false);
  assert.equal(applied.diagnostic_pass, false);
  assert.equal(calls.filter(call => call === 'submit_fake').length, 1);
  const count = calls.length;
  assert.equal((await helper.apply()).replayed_read_only, true);
  assert.equal(calls.length, count, 'stored result replay performs no native or readiness requests');
  await fs.unlink(path.join(options.outputDir, 'apply-result.json'));
  await assert.rejects(() => helper.apply(), /will not submit again/);
  assert.equal(calls.filter(call => call === 'submit_fake').length, 1);
  const radians = Math.PI / 6;
  const matrix = [Math.cos(radians), Math.sin(radians), 0, 0, -Math.sin(radians), Math.cos(radians), 0, 0, 0, 0, 1, 0, 1000 / 25.4, 1200 / 25.4, 0, 1];
  const after = { ...empty(), instances: [{ id: 'asset-fixture', persistent_id: '12', faces: 10, edges: 20 }] };
  const adoption = { model_revision: after.model_revision, model_revision_complete: true, recursive_truncated: false,
    recursive_index: [{ entity_path: 'pid:12', world_transform: matrix }] };
  assert.equal(assetReadbackBoundary({ before: empty(), after, adoption, operation: { id: 'asset-fixture' } }).passed, true);
  matrix[12] += 1;
  assert.equal(assetReadbackBoundary({ before: empty(), after, adoption, operation: { id: 'asset-fixture' } }).passed, false);
  assert.throws(() => createNativeAssetDevelopment({ ...options, outputDir: options.stateDir }, { bridge: fake }), /distinct/);
  console.log(JSON.stringify({ ok: true, real_native_calls: 0, actual_approvals_issued: 0, source_fixture_only: true,
    global_approval_directory_reused: true, status_read_only: true, unapproved_apply_no_native_call: true, interrupted_submit_not_replayed: true,
    loose_geometry_not_blank: true, raw_native_matrix_checked_in_correct_units: true }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
