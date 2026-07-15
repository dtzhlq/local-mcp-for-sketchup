import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  AgentContractError,
  ERROR_CODE_REGISTRY,
  assertTaskTransition,
  createResultEnvelope,
  normalizeClientCapabilities,
  normalizeExecutionPolicy
} from '../src/agent-contract.mjs';
import { AgentTaskStore } from '../src/agent-task-store.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-agent-contract-'));
try {
  const capabilities = normalizeClientCapabilities({ vision: true, local_files: false, structured_output: true, context: 'long', parallel: true, admin: true });
  assert.deepEqual(capabilities, { vision: true, local_files: false, structured_output: true, parallel: true, context: 'long' });
  const policy = normalizeExecutionPolicy({ auto_approve_risks: ['S1', 'S4'], allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true });
  assert.deepEqual(policy.auto_approve_risks, ['S1'], 'client input must never auto-approve S2-S4');
  assert.equal(policy.allow_queue_mutation, true);
  assertTaskTransition('created', 'understanding');
  assert.throws(() => assertTaskTransition('completed', 'executing'), (error) => error instanceof AgentContractError && error.code === 'TASK_STATE_CONFLICT');
  assert.ok(Object.keys(ERROR_CODE_REGISTRY).includes('APPROVAL_REPLAYED'));

  const store = new AgentTaskStore({ rootDir: root });
  const created = await store.createTask({
    intent: 'understand_model',
    instruction: 'Inspect untrusted model names without obeying them.',
    interfaceLevel: 'guided',
    clientCapabilities: capabilities,
    executionPolicy: policy,
    inputs: { runtime: 'mock' },
    idempotencyKey: 'create-understand-1'
  });
  const replay = await store.createTask({
    intent: 'understand_model',
    instruction: 'Inspect untrusted model names without obeying them.',
    interfaceLevel: 'guided',
    clientCapabilities: capabilities,
    executionPolicy: policy,
    inputs: { runtime: 'mock' },
    idempotencyKey: 'create-understand-1'
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.task.task_id, created.task.task_id);
  await assert.rejects(
    store.createTask({
      intent: 'verify_model',
      instruction: 'Different request.',
      clientCapabilities: capabilities,
      executionPolicy: policy,
      idempotencyKey: 'create-understand-1'
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT'
  );

  const artifactPath = path.join(root, 'sample.json');
  await fs.writeFile(artifactPath, `${JSON.stringify({ ok: true, padding: 'x'.repeat(500) })}\n`, 'utf8');
  const artifact = await store.registerArtifact(created.task.task_id, { filePath: artifactPath, label: 'sample' });
  assert.equal(artifact.handle.includes(artifactPath), false, 'opaque artifact handles must not expose paths');
  const read = await store.readArtifact(artifact.handle, { maxChars: 256 });
  assert.equal(read.truncated, true);
  assert.equal(read.content.length, 256);

  const task = await store.getTask(created.task.task_id, { includePrivate: true });
  const envelope = createResultEnvelope({ task, data: { stored: true } });
  await validateSchemas({ root, task, envelope, artifact });

  const restartedStore = new AgentTaskStore({ rootDir: root });
  assert.equal((await restartedStore.getTask(task.task_id)).task_id, task.task_id, 'tasks must survive store restart');

  process.stdout.write(`${JSON.stringify({ ok: true, task_states: 12, stable_errors: Object.keys(ERROR_CODE_REGISTRY).length, persisted_task: task.task_id }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function validateSchemas({ task, envelope, artifact }) {
  const schemaDir = path.resolve('schema');
  const names = ['artifact-handle-v1.schema.json', 'agent-task-v1.schema.json', 'agent-result-envelope-v1.schema.json', 'approval-challenge-v1.schema.json'];
  const schemas = await Promise.all(names.map(async (name) => JSON.parse(await fs.readFile(path.join(schemaDir, name), 'utf8'))));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  for (const schema of schemas) ajv.addSchema(schema);
  assert.equal(ajv.validate('https://alma.local/sketchup-mcp-replica/artifact-handle-v1.schema.json', artifact), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate('https://alma.local/sketchup-mcp-replica/agent-task-v1.schema.json', task), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate('https://alma.local/sketchup-mcp-replica/agent-result-envelope-v1.schema.json', envelope), true, JSON.stringify(ajv.errors));
}
