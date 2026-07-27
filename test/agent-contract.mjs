import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  AGENT_TASK_STATES,
  AgentContractError,
  ERROR_CODE_REGISTRY,
  assertTaskTransition,
  createResultEnvelope,
  normalizeClientCapabilities,
  normalizeExecutionPolicy,
  publicExecutionPolicy,
  serverPolicyAutoApprovalMode,
  trustedModelCopyAutoApprovalBinding
} from '../src/agent-contract.mjs';
import { AgentTaskStore } from '../src/agent-task-store.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-mcp-agent-contract-'));
try {
  const capabilities = normalizeClientCapabilities({ vision: true, local_files: false, structured_output: true, context: 'long', parallel: true, admin: true });
  assert.deepEqual(capabilities, { vision: true, local_files: false, structured_output: true, parallel: true, context: 'long' });
  const policy = normalizeExecutionPolicy({
    auto_approve_risks: ['S1', 'S4'],
    allowed_runtimes: ['mock', 'queue'],
    allow_queue_mutation: true,
    allow_direct_expert_queue_mutation: true
  });
  assert.deepEqual(policy.auto_approve_risks, ['S1'], 'client input must never auto-approve S2-S4');
  assert.equal(policy.allow_queue_mutation, true);
  assert.equal(policy.allow_direct_expert_queue_mutation, true);
  const copyRoot = path.join(root, 'trusted-copies');
  const scopedPolicy = normalizeExecutionPolicy({
    allowed_runtimes: ['mock', 'queue'],
    allow_queue_mutation: true,
    trusted_model_copy_auto_approval: {
      enabled: true,
      allowed_risks: ['S1', 'S2', 'S3', 'S4'],
      allowed_roots: [copyRoot],
      max_affected_instances: 5,
      allow_save_model: false
    }
  });
  assert.equal(scopedPolicy.trusted_model_copy_auto_approval.enabled, true);
  assert.deepEqual(scopedPolicy.trusted_model_copy_auto_approval.allowed_risks, ['S1', 'S2', 'S3', 'S4']);
  const publicScopedPolicy = publicExecutionPolicy(scopedPolicy);
  assert.equal(publicScopedPolicy.trusted_model_copy_auto_approval.allowed_root_count, 1);
  assert.equal(publicScopedPolicy.copy_fast_mode.enabled, true);
  assert.equal(publicScopedPolicy.copy_fast_mode.user_action_required_per_edit, false);
  assert.equal(publicScopedPolicy.copy_fast_mode.agent_can_enable, false);
  assert.equal(Object.hasOwn(publicScopedPolicy.trusted_model_copy_auto_approval, 'allowed_roots'), false, 'public tasks must not expose configured local roots');
  const copyBinding = trustedModelCopyAutoApprovalBinding({
    executionPolicy: scopedPolicy,
    riskLevel: 'S4',
    affectedInstanceCount: 1,
    modelSourcePath: path.join(copyRoot, 'fixture.skp'),
    saveModel: false
  });
  assert.match(copyBinding.binding_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(trustedModelCopyAutoApprovalBinding({
    executionPolicy: scopedPolicy,
    riskLevel: 'S4',
    affectedInstanceCount: 1,
    modelSourcePath: path.join(root, 'outside.skp'),
    saveModel: false
  }), null, 'outside-root models must fail closed');
  assert.equal(trustedModelCopyAutoApprovalBinding({
    executionPolicy: scopedPolicy,
    riskLevel: 'S4',
    affectedInstanceCount: 1,
    modelSourcePath: path.join(copyRoot, 'fixture.skp'),
    saveModel: true
  }), null, 'saving must require an explicit trusted-copy policy grant');
  const saveScopedPolicy = normalizeExecutionPolicy({
    trusted_model_copy_auto_approval: {
      enabled: true,
      allowed_risks: ['S4'],
      allowed_roots: [copyRoot],
      max_affected_instances: 5,
      allow_save_model: true
    }
  });
  assert.ok(trustedModelCopyAutoApprovalBinding({
    executionPolicy: saveScopedPolicy,
    riskLevel: 'S4',
    affectedInstanceCount: 1,
    modelSourcePath: path.join(copyRoot, 'fixture.skp'),
    saveModel: true,
    savePath: path.join(copyRoot, 'saved-copy.skp')
  }));
  assert.equal(trustedModelCopyAutoApprovalBinding({
    executionPolicy: saveScopedPolicy,
    riskLevel: 'S4',
    affectedInstanceCount: 1,
    modelSourcePath: path.join(copyRoot, 'fixture.skp'),
    saveModel: true,
    savePath: path.join(root, 'outside-save.skp')
  }), null, 'Copy Fast save targets outside the matched copy root must fail closed');
  assert.equal(serverPolicyAutoApprovalMode({
    auto_approval_eligible: true,
    risk_level: 'S4',
    affected_instance_count: 1,
    execution_contract: { save_model: false },
    trusted_model_copy_auto_approval: copyBinding
  }, scopedPolicy), null, 'a trusted-copy binding without a server-owned Copy Fast session must not authorize execution');
  assert.equal(normalizeExecutionPolicy({ allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true }).allow_direct_expert_queue_mutation, false, 'Gateway queue permission must not enable direct expert mutation');
  assertTaskTransition('created', 'understanding');
  assertTaskTransition('understanding', 'approved');
  assertTaskTransition('awaiting_review', 'awaiting_input');
  assertTaskTransition('approved', 'awaiting_input');
  assert.throws(() => assertTaskTransition('completed', 'executing'), (error) => error instanceof AgentContractError && error.code === 'TASK_STATE_CONFLICT');
  assert.ok(Object.keys(ERROR_CODE_REGISTRY).includes('APPROVAL_REPLAYED'));
  assert.ok(Object.keys(ERROR_CODE_REGISTRY).includes('HANDSHAKE_MODEL_REVISION_MISMATCH'));
  assert.equal(Object.keys(ERROR_CODE_REGISTRY).length, 40);
  assert.equal(ERROR_CODE_REGISTRY.APPROVAL_TOKEN_FORBIDDEN.retryable, false);
  assert.equal(ERROR_CODE_REGISTRY.APPROVAL_TOKEN_FORBIDDEN.next_action.action, 'remove_approval_token_and_resume_task');
  assert.equal(ERROR_CODE_REGISTRY.ARTIFACT_INTEGRITY_ERROR.retryable, false);
  assert.equal(ERROR_CODE_REGISTRY.ARTIFACT_INTEGRITY_ERROR.next_action.action, 'reingest_artifact_and_report_corruption');
  assert.equal(ERROR_CODE_REGISTRY.QUEUE_STALE_LOCK.next_action.action, 'inspect_and_clear_stale_queue_lock');
  assert.equal(ERROR_CODE_REGISTRY.MUTATION_EXECUTION_FAILED.retryable, false);
  assert.equal(ERROR_CODE_REGISTRY.MUTATION_EXECUTION_FAILED.next_action.action, 'inspect_failure_then_start_new_task');
  assert.equal(ERROR_CODE_REGISTRY.MUTATION_RECOVERY_REQUIRED.retryable, true);
  assert.equal(ERROR_CODE_REGISTRY.MUTATION_RECOVERY_REQUIRED.next_action.action, 'resume_task_finalization');
  assert.equal(ERROR_CODE_REGISTRY.MUTATION_RECEIPT_INVALID.retryable, false);

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
  assert.equal(read.offset, 0);
  assert.equal(read.next_offset, 256);
  let assembled = '';
  let offset = 0;
  do {
    const page = await store.readArtifact(artifact.handle, { maxChars: 256, offset });
    assembled += page.content;
    offset = page.next_offset;
    if (page.eof) break;
  } while (offset !== null);
  assert.equal(assembled, await fs.readFile(artifactPath, 'utf8'), 'offset pagination must make the complete artifact readable');
  await assert.rejects(store.readArtifact(artifact.handle, { offset: read.total_chars + 1 }), (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(store.readArtifact(artifact.handle, { maxChars: 256.5 }), (error) => error.code === 'INVALID_ARGUMENT');

  const task = await store.getTask(created.task.task_id, { includePrivate: true });
  const envelope = createResultEnvelope({ task, data: { stored: true } });
  assert.deepEqual(envelope.result, { stored: true });
  assert.deepEqual(envelope.data, envelope.result);
  assert.deepEqual(envelope.warnings, []);
  const explicitResultEnvelope = createResultEnvelope({ task, data: null, result: { canonical: true } });
  assert.deepEqual(explicitResultEnvelope.data, explicitResultEnvelope.result, 'data must remain a compatibility alias of the canonical result');
  const warningEnvelope = createResultEnvelope({
    task,
    data: {
      snapshot: { warnings: [] },
      qa: { issues: [{ type: 'fixture.warning', message: 'Review this fixture.', severity: 'warn' }] }
    }
  });
  assert.deepEqual(warningEnvelope.warnings, [{ code: 'fixture.warning', message: 'Review this fixture.', severity: 'warn' }]);
  const recoverableError = {
    code: 'HANDSHAKE_REQUIRED',
    message: 'A fresh live Session Contract is required.',
    retryable: false,
    next_action: ERROR_CODE_REGISTRY.HANDSHAKE_REQUIRED.next_action
  };
  const taskWithError = { ...task, last_error: recoverableError };
  const recoverableEnvelope = createResultEnvelope({ task: taskWithError, ok: false, error: recoverableError, data: null });
  const artifactIntegrityError = new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The immutable artifact failed validation.');
  const artifactIntegrityEnvelope = createResultEnvelope({ task, ok: false, error: artifactIntegrityError, data: null });
  const mutationRecoveryEnvelope = createResultEnvelope({ task, ok: false, error: new AgentContractError('MUTATION_RECOVERY_REQUIRED', 'Resume server finalization.'), data: null });
  const mutationReceiptInvalidEnvelope = createResultEnvelope({ task, ok: false, error: new AgentContractError('MUTATION_RECEIPT_INVALID', 'Receipt binding failed.'), data: null });
  const approvalTokenForbiddenEnvelope = createResultEnvelope({ task, ok: false, error: new AgentContractError('APPROVAL_TOKEN_FORBIDDEN', 'Agent-supplied approval credentials are forbidden.'), data: null });
  await validateSchemas({ root, task, envelope, artifact });
  await validateSchemas({ root, task, envelope: warningEnvelope, artifact });
  await validateSchemas({ root, task: taskWithError, envelope: recoverableEnvelope, artifact });
  await validateSchemas({ root, task, envelope: artifactIntegrityEnvelope, artifact });
  await validateSchemas({ root, task, envelope: mutationRecoveryEnvelope, artifact });
  await validateSchemas({ root, task, envelope: mutationReceiptInvalidEnvelope, artifact });
  await validateSchemas({ root, task, envelope: approvalTokenForbiddenEnvelope, artifact });

  const restartedStore = new AgentTaskStore({ rootDir: root });
  assert.equal((await restartedStore.getTask(task.task_id)).task_id, task.task_id, 'tasks must survive store restart');

  process.stdout.write(`${JSON.stringify({ ok: true, task_states: AGENT_TASK_STATES.length, stable_errors: Object.keys(ERROR_CODE_REGISTRY).length, persisted_task: task.task_id }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function validateSchemas({ task, envelope, artifact }) {
  const schemaDir = path.resolve('schema');
  const names = ['artifact-handle-v1.schema.json', 'agent-task-v1.schema.json', 'agent-result-envelope-v1.schema.json', 'approval-challenge-v1.schema.json'];
  const schemas = await Promise.all(names.map(async (name) => JSON.parse(await fs.readFile(path.join(schemaDir, name), 'utf8'))));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  for (const schema of schemas) ajv.addSchema(schema);
  assert.equal(ajv.validate('https://local-mcp-for-sketchup.invalid/local-mcp-for-sketchup/artifact-handle-v1.schema.json', artifact), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate('https://local-mcp-for-sketchup.invalid/local-mcp-for-sketchup/agent-task-v1.schema.json', task), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate('https://local-mcp-for-sketchup.invalid/local-mcp-for-sketchup/agent-result-envelope-v1.schema.json', envelope), true, JSON.stringify(ajv.errors));
}
