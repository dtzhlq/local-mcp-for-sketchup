import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { SessionContractAuthority } from '../src/session-contract.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import { TOOL_REGISTRY } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';

const validator = new ToolInputValidator(TOOL_REGISTRY);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-connection-'));
const privateModelPath = path.join(root, 'private-existing-model.skp');
let now = Date.parse('2026-09-08T08:00:00.000Z');

async function main() {
try {
  const runtime = new FakeQueueRuntime();
  const authority = new SessionContractAuthority({ stateDir: path.join(root, 'session'),
    secret: 'connection-test-only-session-secret-32-bytes', now: () => now, serverSessionId: 'connection-test-server' });
  const options = { queueRuntime: runtime, sessionContractAuthority: authority,
    agentContract: { rootDir: path.join(root, 'tasks') },
    approval: { stateDir: path.join(root, 'approval'), secret: 'connection-test-only-approval-secret-32-bytes' },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: false } };
  const bridge = new SketchUpBridge(options);
  const connect = () => call(bridge, 'start_agent_task', { intent: 'discover', instruction: 'Connect read-only to the active saved model.', inputs: { topic: 'connect', runtime: 'queue' } });
  const createArgs = (id, key) => ({ intent: 'create_model', instruction: 'Test signed connection transport with an empty DSL.',
    idempotency_key: key, inputs: { runtime: 'queue', code: emptyDsl(), connection_task_id: id } });

  const connection = await connect();
  assert.equal(connection.ok, true);
  const fullConnection = await completeResult(bridge, connection);
  assert.equal(fullConnection.connection_task_id, connection.task_id);
  assert.equal(Object.hasOwn(fullConnection, 'session_contract'), false, 'Only opaque connection state may be returned');
  assert.equal(runtime.mutationCount, 0, 'Connection must be entirely read-only');
  const storedConnection = await bridge.taskStore.getTask(connection.task_id, { includePrivate: true });
  const signed = storedConnection.private.connection.session_contract;
  assert.equal(signed.model_identity.source_path, privateModelPath, 'Server must preserve the exact signed payload');
  await authority.verify(signed, { runtimeState: runtime.state });

  const request = createArgs(connection.task_id, 'connected-create');
  const created = await call(bridge, 'start_agent_task', request);
  assert.equal(created.error, null);
  assert.equal(created.task_state, 'completed');
  assert.equal(runtime.mutationCount, 1);
  const storedCreation = await bridge.taskStore.getTask(created.task_id, { includePrivate: true });
  assert.deepEqual(storedCreation.inputs.session_contract, signed, 'Connection resolution must not sanitize or re-sign the original payload');
  assert.equal(runtime.guards[0].handshake_id, signed.handshake_id);

  // Replay remains a replay after the first build has changed the native revision.
  const replay = await call(bridge, 'start_agent_task', request);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.task_id, created.task_id);
  assert.equal(runtime.mutationCount, 1);

  const pending = await call(bridge, 'start_agent_task', { intent: 'create_model', instruction: 'Await a connection.',
    idempotency_key: 'submit-connect-start', inputs: { runtime: 'queue', code: emptyDsl() } });
  assert.equal(pending.task_state, 'awaiting_input');
  assert.equal(pending.error.code, 'HANDSHAKE_REQUIRED');
  const freshForSubmit = await connect();
  const submitted = await call(bridge, 'submit_agent_task_input', { task_id: pending.task_id,
    idempotency_key: 'submit-connection', input: { connection_task_id: freshForSubmit.task_id } });
  assert.equal(submitted.error, null);
  assert.equal(submitted.task_state, 'completed');
  assert.equal(runtime.mutationCount, 2, 'Submit must resolve the server connection as well as start');

  const wrongSource = await call(bridge, 'start_agent_task', { intent: 'discover', instruction: 'List tasks.', inputs: { topic: 'tasks' } });
  await expectDenied(() => call(bridge, 'start_agent_task', createArgs(wrongSource.task_id, 'wrong-source')), ['INVALID_ARGUMENT', 'HANDSHAKE_INVALID', 'HANDSHAKE_REQUIRED']);
  assert.equal(runtime.mutationCount, 2, 'An arbitrary existing task cannot supply a connection');

  const staleIdentity = await connect();
  runtime.state.model_identity.source_path = path.join(root, 'different-model.skp');
  await expectDenied(() => call(bridge, 'start_agent_task', createArgs(staleIdentity.task_id, 'changed-source')), ['HANDSHAKE_MODEL_IDENTITY_MISMATCH']);
  assert.equal(runtime.mutationCount, 2, 'A signed connection cannot move to another active saved model');
  runtime.state.model_identity.source_path = privateModelPath;

  const expiring = await connect();
  now += 10 * 60 * 1000;
  await expectDenied(() => call(bridge, 'start_agent_task', createArgs(expiring.task_id, 'expired-connection')), ['HANDSHAKE_EXPIRED']);
  assert.equal(runtime.mutationCount, 2);

  const readOnlyBridge = new SketchUpBridge({ ...options,
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: false, allow_direct_expert_queue_mutation: false } });
  const readOnlyConnection = await call(readOnlyBridge, 'start_agent_task', { intent: 'discover', instruction: 'Read-only connection.', inputs: { topic: 'connect', runtime: 'queue' } });
  assert.equal(readOnlyConnection.error, null);
  assert.equal((await completeResult(readOnlyBridge, readOnlyConnection)).gateway_creation_allowed, false);
  await expectDenied(() => call(readOnlyBridge, 'start_agent_task', createArgs(readOnlyConnection.task_id, 'readonly-no-escalation')), ['POLICY_DENIED']);
  await assert.rejects(() => bridge.build_model({ code: emptyDsl(), runtime: 'queue', session_contract: signed }), error => error.code === 'POLICY_DENIED');
  assert.equal(runtime.mutationCount, 2, 'Read-only connect never expands Gateway or direct-expert authorization');

  console.log('model-accessibility-connection: signed saved-model connection stays private; start/submit and replay work; wrong source, changed identity, expiry and policy expansion fail closed in an isolated fake queue; no live execution');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
}

async function call(bridge, tool, args) {
  validator.validate(tool, args);
  const result = await bridge[tool](args);
  assert.ok(JSON.stringify(result).length <= 4096, `${tool} must fit the default short context`);
  assertPrivate(result);
  return result;
}

function assertPrivate(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(privateModelPath), false, 'The saved source path must not appear in a no-files response');
  assert.equal(text.includes('hmac_sha256:'), false, 'Raw signed connection material must stay server-side');
}

async function completeResult(bridge, response) {
  const handle = response.presentation?.full_result_artifact;
  if (!handle) return response.result;
  let offset = 0, content = '';
  for (let pages = 0; pages < 256; pages++) {
    const page = await call(bridge, 'read_agent_artifact', { task_id: response.task_id, handle, offset, max_chars: 1500 });
    content += page.result.artifact.content;
    if (page.result.artifact.eof) {
      assertPrivate(JSON.parse(content));
      return JSON.parse(content).result;
    }
    offset = page.result.artifact.next_offset;
  }
  throw new Error('Connection artifact did not finish within its bounded page limit');
}

async function expectDenied(action, expectedCodes) {
  try {
    const response = await action();
    assert.equal(response.ok, false);
    assert.ok(expectedCodes.includes(response.error?.code), `Expected ${expectedCodes}, got ${response.error?.code}`);
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    assert.ok(expectedCodes.includes(error.code), `Expected ${expectedCodes}, got ${error.code}`);
  }
}

function emptyDsl() { return JSON.stringify({ version: 1, units: 'mm', operations: [] }); }
function revision(number) { return `sha256:${String(number).padStart(64, '0')}`; }
function emptySnapshot() {
  return { totals: { faces: 0, edges: 0, vertices: 0, groups: 0, instances: 0 }, groups: [], instances: [],
    component_definitions: [], materials: [], material_names: [], tags: [], scenes: [], image_references: [],
    warnings: [], warning_messages: [], warning_summary: { total: 0, by_severity: {}, by_category: {} },
    bounding_box: { min: [0, 0, 0], max: [0, 0, 0], w: 0, d: 0, h: 0 }, selection: [] };
}

class FakeQueueRuntime {
  constructor() {
    const capabilities = getRuntimeCapabilities('queue');
    this.capabilities = { ...capabilities, plugin: { name: 'Fake Queue', version: PRODUCT_VERSION, sketchup_version: '26.2.242', ruby_version: '3.2' } };
    this.state = { kind: 'queue_session_state', runtime: 'queue', session_id: 'fixture-plugin', document_id: 'fixture-document',
      model_identity: { model_guid: 'fixture-model', runtime_object_id: '1234', title: 'Saved Fixture', source_path: privateModelPath },
      model_revision: revision(1), model_revision_strategy: capabilities.model_revision.strategy,
      model_revision_unique_entity_limit: capabilities.model_revision.unique_entity_limit,
      model_revision_complete: true, model_revision_total_seen: 10, model_revision_indexed: 10, model_modified: false,
      plugin_version: PRODUCT_VERSION, queue_state: 'idle', capability_version: capabilities.capability_version,
      manifest_version: capabilities.manifest_version, dsl_version: capabilities.dsl_version, occurrence_contract: capabilities.occurrence_contract,
      boolean_operations_sha256: capabilities.boolean_operations_sha256, model_revision_source_sha256: capabilities.model_revision_source_sha256 };
    this.mutationCount = 0;
    this.guards = [];
  }
  async getCapabilities() { return structuredClone(this.capabilities); }
  async diagnostics() { return { queue: { count: 0 }, processing: { count: 0 }, responses: { count: 0 }, lock: { exists: false } }; }
  async inspectModel() { return { summary: { source_path: this.state.model_identity.source_path, entity_count: 0 }, entities: [] }; }
  async createFreshHandshakeProbe() { return structuredClone(this.state); }
  async getSessionState() { return structuredClone(this.state); }
  async withExclusiveAccess(callback) { return callback(); }
  async assertIdleForMutation() { return { queue_state: 'idle' }; }
  async withMutationGuard(guard, callback) { this.guards.push(structuredClone(guard)); return callback(); }
  async buildModel() {
    this.mutationCount++;
    this.state.model_revision = revision(this.mutationCount + 1);
    this.state.model_modified = true;
    return emptySnapshot();
  }
}

await main();
