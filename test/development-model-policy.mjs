import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { normalizeExecutionPolicy, developmentModelAutoApprovalBinding, serverPolicyAutoApprovalMode } from '../src/agent-contract.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { straightCorridorTask } from '../src/traditional-timber/examples.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'development-model-policy-'));
const options = { mock: { sessionPath: path.join(directory, 'model.json') }, agentContract: { rootDir: path.join(directory, 'tasks') },
  approval: { stateDir: path.join(directory, 'approvals') }, executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] } };
const development = keys => ({ enabled: true, authorization_ref: 'human-instruction:development-fixture', allowed_model_keys: keys,
  allowed_roots: [directory], allowed_risks: ['S1', 'S2'], max_affected_instances: 2, allow_save_model: true });
try {
  const bridge = new SketchUpBridge(options);
  const small = straightCorridorTask('dev-policy-corridor');
  small.parameters = { bay_lengths_mm: [1500], width_mm: 1000, column_height_mm: 2800, rise_mm: 300, eave_mm: 250 };
  Object.assign(small.assembly.assemblies[1].parameters, { tile_pitch_mm: 1000, tile_length_mm: 1000, rafter_spacing_mm: 1000 });
  small.instances = [{ id: 'selected', origin_mm: [0, 0, 0] }, { id: 'protected-shared', origin_mm: [0, 4000, 0] }];
  delete small.placement;
  const created = await bridge.start_agent_task({ intent: 'create_model', instruction: 'Create small isolated mock fixture.', idempotency_key: 'dev-policy-create', inputs: { runtime: 'mock', task: small } });
  const source = (await bridge.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.parameter_source;
  assert.ok(source);
  const key = modelKeyForIdentity(modelIdentityForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true })));
  const policy = normalizeExecutionPolicy({ ...options.executionPolicy, development_model_auto_approval: development([key]) });
  const bindingArgs = { executionPolicy: policy, modelKey: key, riskLevel: 'S2', affectedInstanceCount: 1 };
  assert.ok(developmentModelAutoApprovalBinding(bindingArgs));
  assert.equal(developmentModelAutoApprovalBinding({ ...bindingArgs, modelKey: 'model_' + 'f'.repeat(32) }), null);
  assert.equal(developmentModelAutoApprovalBinding({ ...bindingArgs, riskLevel: 'S3' }), null);
  assert.equal(developmentModelAutoApprovalBinding({ ...bindingArgs, affectedInstanceCount: 3 }), null);
  assert.equal(developmentModelAutoApprovalBinding({ ...bindingArgs, saveModel: true, savePath: '/outside/development.skp' }), null);
  assert.ok(developmentModelAutoApprovalBinding({ ...bindingArgs, modelKey: 'model_' + 'f'.repeat(32), modelSourcePath: path.join(directory, 'sample.skp') }));
  assert.equal(normalizeExecutionPolicy({ development_model_auto_approval: { ...development([key]), authorization_ref: '' } }).development_model_auto_approval.enabled, false);

  const planned = await bridge.start_agent_task({ intent: 'modify_design_parameters', instruction: 'Only change selected bay length.', idempotency_key: 'dev-policy-edit',
    inputs: { runtime: 'mock', parameter_edit: { creation_task_id: created.task_id, scope: 'single', targets: [source.entries[0].target], changes: { bay_lengths_mm: [1800] } },
      // Public inputs cannot grant the server execution policy.
      development_model_auto_approval: development([key]) } });
  const staged = await bridge.submit_agent_task_input({ task_id: planned.task_id, idempotency_key: 'dev-policy-stage', input: {} });
  assert.equal(staged.task_state, 'awaiting_review', JSON.stringify(staged.error));
  const original = await bridge.taskStore.getTask(planned.task_id, { includePrivate: true });
  const childId = original.private.parameter_execution.reviewed_task_id;
  const oldChild = await bridge.taskStore.getTask(childId, { includePrivate: true });
  assert.ok(oldChild.result.approval_challenge);
  await assert.rejects(bridge.verify_agent_task_authorization_ready({ task_id: childId }), error => error.code === 'APPROVAL_REQUIRED');
  // A different, additive fixture changes the overall revision while the
  // original root and shared source fingerprints remain untouched.
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'box', id: 'independent-reference', name: 'IndependentReference', origin: [-500, -500, 0], size: [100, 100, 100] }
  ] }) });

  let writes = 0;
  const authorized = new SketchUpBridge({ ...options, executionPolicy: policy,
    dslDispatchGuard: document => { writes++; assert.equal(document.operations.length, 1); assert.equal(document.operations[0].op, 'replace_component_definition'); } });
  const prepare = authorized.agentGateway.prepareReviewedExistingEdit.bind(authorized.agentGateway);
  authorized.agentGateway.prepareReviewedExistingEdit = async task => { await prepare(task); throw new Error('fixture process loss after child refresh'); };
  const interrupted = await authorized.submit_agent_task_input({ task_id: planned.task_id, idempotency_key: 'dev-policy-refresh', input: {} });
  assert.equal(interrupted.ok, false);
  const pending = await authorized.taskStore.getTask(planned.task_id, { includePrivate: true });
  assert.ok(pending.private.parameter_execution.review_refresh_pending);
  assert.equal(writes, 0);
  authorized.agentGateway.prepareReviewedExistingEdit = prepare;
  const resumed = await authorized.resume_agent_task({ task_id: planned.task_id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  const recovered = await authorized.taskStore.getTask(planned.task_id, { includePrivate: true });
  assert.equal(recovered.private.parameter_execution.reviewed_task_id, childId);
  assert.equal(recovered.private.parameter_execution.review_refresh_pending, undefined);
  assert.equal(recovered.private.parameter_execution.review_refresh_audit[0].old_plan_hash, oldChild.private.existing_edit_plan.plan_hash);
  const child = await authorized.taskStore.getTask(childId, { includePrivate: true });
  assert.equal(child.state, 'approved');
  assert.equal(child.result.approval_challenge, null);
  assert.equal(serverPolicyAutoApprovalMode(child.private.existing_edit_plan, authorized.executionPolicy), 'server_policy_development_models');
  const ready = await authorized.verify_agent_task_authorization_ready({ task_id: childId });
  assert.equal(ready.approved_by, 'execution-policy:development-models');
  assert.equal(ready.approval_token_exposed, false);
  assert.equal(serverPolicyAutoApprovalMode(child.private.existing_edit_plan,
    normalizeExecutionPolicy({ ...options.executionPolicy, development_model_auto_approval: { ...development([key]), authorization_ref: 'changed-policy' } })), null);
  const applied = await authorized.submit_agent_task_input({ task_id: planned.task_id, idempotency_key: 'dev-policy-apply', input: {} });
  assert.equal(applied.task_state, 'completed', JSON.stringify(applied.error));
  assert.equal(applied.result.geometry_applied, true);
  assert.equal(writes, 1, 'existing staged definitions must never be built again');
  const after = (await authorized.taskStore.getTask(created.task_id, { includePrivate: true })).private.creation.parameter_source;
  assert.deepEqual(after.entries[0].source.task.parameters.bay_lengths_mm, [1800]);
  assert.deepEqual(after.entries[1].source.task.parameters.bay_lengths_mm, [1500]);
  assert.equal(after.entries[1].source_definition, source.entries[1].source_definition);
  console.log('Development policy: default review, exact document/path/risk/save scope, no credentials, same-child revision refresh and crash recovery without restaging passed.');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
