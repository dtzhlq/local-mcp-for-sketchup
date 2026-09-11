import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { writeParameterFixtureState, verifyParameterFixtureState, PARAMETER_FIXTURE_STATE_FILENAME } from '../scripts/model-accessibility/parameter-fixture-state.mjs';
import { createGatewayAdapter, gatewayHostOptions } from '../scripts/model-accessibility/gateway-adapter.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parameter-fixture-state-'));
const directory = path.join(root, 'state'); await fs.mkdir(directory);
const sign = async body => crypto.createHmac('sha256', 'offline-test-only-not-a-user-key').update(JSON.stringify(body)).digest('hex');
const tasks = new Map(), sourceRefs = [], documentBinding = `sha256:${'c'.repeat(64)}`;
for (let i = 0; i < 2; i++) {
  const id = `task_${crypto.randomUUID()}`, sourceTask = { id: i ? 'ABC' : 'D', kind: 'cabinet' };
  const core = { version: 'model-accessibility-parameter-source.v1', creation_task_id: id, parameter_revision: 0, runtime: 'mock' };
  const source = { ...core, source_record_hash: sha256Canonical(core) };
  tasks.set(id, { task_id: id, intent: 'create_model', inputs: { runtime: 'mock', task: sourceTask }, private: { creation: {
    parameter_source: source, parameter_edit_support: { baseline_captured: true }, parameter_source_document_binding: documentBinding } } });
  sourceRefs.push({ task_id: id, source_record_hash: source.source_record_hash, source_hash: sha256Canonical(sourceTask) });
}
let gatewayCalls = 0, nativeCalls = 0;
const bridge = { taskStore: { rootDir: path.join(directory, 'tasks'), mutationReceiptLedger: { sign },
  async getTask(id, options) { assert.equal(options.includePrivate, true); return structuredClone(tasks.get(id)); } },
  async start_agent_task() { gatewayCalls++; return { task_id: sourceRefs[0].task_id, result: { kind: 'public_source_discovery' } }; },
  async adopt_open_model() { nativeCalls++; throw new Error('Native reads forbidden in attachment verification.'); } };
const record = { fixture_ready: true, formal_acceptance: false, runtime: 'mock', case_id: 'edit_single.development', creation_sources: sourceRefs, document_binding: documentBinding };
const request = { intent: 'discover', instruction: 'Read public parameter source discovery.', inputs: { topic: 'parameter_sources', runtime: 'mock' } };
try {
  await writeParameterFixtureState({ bridge, stateRoot: directory, record });
  assert.deepEqual(await verifyParameterFixtureState({ bridge, stateRoot: directory, runtime: 'mock' }),
    { verified: true, fixture_ready: true, runtime: 'mock', case_id: 'edit_single.development', formal_acceptance: false });
  const adapter = createGatewayAdapter({ stateRoot: directory, initializedFixtureStateRoot: directory, runtime: 'mock' }, { createBridge: () => bridge, env: {} });
  const result = await adapter.callGateway('start_agent_task', request);
  assert.equal(result.result.kind, 'public_source_discovery');
  assert.equal(JSON.stringify(result).includes('source_record_hash'), false);
  assert.equal(gatewayCalls, 1); assert.equal(nativeCalls, 0);
  const defaultAdapter = createGatewayAdapter({ stateRoot: directory, runtime: 'mock' }, { createBridge: () => bridge, env: {} });
  await assert.rejects(defaultAdapter.callGateway('start_agent_task', request), error => error.code === 'EEXIST');
  assert.throws(() => gatewayHostOptions({ stateRoot: directory, initializedFixtureStateRoot: root, runtime: 'mock' }, {}));
  const advanced = tasks.get(sourceRefs[0].task_id); advanced.private.creation.parameter_source.parameter_revision = 1;
  await assert.rejects(verifyParameterFixtureState({ bridge, stateRoot: directory, runtime: 'mock' }), /changed|initial/);
  advanced.private.creation.parameter_source.parameter_revision = 0;
  await assert.rejects(verifyParameterFixtureState({ bridge, stateRoot: directory, runtime: 'queue' }), /binding/);
  const filename = path.join(directory, PARAMETER_FIXTURE_STATE_FILENAME), bytes = await fs.readFile(filename);
  const changed = JSON.parse(bytes); changed.case_id = 'edit_linked.development'; await fs.writeFile(filename, JSON.stringify(changed));
  await assert.rejects(verifyParameterFixtureState({ bridge, stateRoot: directory, runtime: 'mock' }), /signature/);
  await fs.writeFile(filename, bytes);
  advanced.private.creation.parameter_source_document_binding = `sha256:${'d'.repeat(64)}`;
  await assert.rejects(verifyParameterFixtureState({ bridge, stateRoot: directory, runtime: 'mock' }), /changed/);
  advanced.private.creation.parameter_source_document_binding = documentBinding;
  const preserved = path.join(directory, 'ready-copy.json'); await fs.rename(filename, preserved);
  await assert.rejects(verifyParameterFixtureState({ bridge, stateRoot: directory, runtime: 'mock' }), error => error.code === 'ENOENT');
  await fs.symlink(preserved, filename);
  await assert.rejects(verifyParameterFixtureState({ bridge, stateRoot: directory, runtime: 'mock' }), /Invalid initialized/);
  const linkedRoot = path.join(root, 'linked-state'); await fs.symlink(directory, linkedRoot);
  const linkedAdapter = createGatewayAdapter({ stateRoot: linkedRoot, initializedFixtureStateRoot: linkedRoot, runtime: 'mock' }, { createBridge: () => bridge, env: {} });
  await assert.rejects(linkedAdapter.callGateway('start_agent_task', request), /ordinary directory/);
  const fileRoot = path.join(root, 'not-a-directory'); await fs.writeFile(fileRoot, 'test');
  const fileAdapter = createGatewayAdapter({ stateRoot: fileRoot, initializedFixtureStateRoot: fileRoot, runtime: 'mock' }, { createBridge: () => bridge, env: {} });
  await assert.rejects(fileAdapter.callGateway('start_agent_task', request), /ordinary directory/);
  assert.equal(gatewayCalls, 1); assert.equal(nativeCalls, 0);
  console.log('parameter fixture state: explicit signed initialized attachment, default-new-directory preservation, source/signature/document/runtime drift rejection; no native calls or approval decisions');
} finally { await fs.rm(root, { recursive: true, force: true }); }
