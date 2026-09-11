import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { getModelAccessibilityWorkflowGuide } from '../src/model-accessibility-workflows.mjs';
import { compileModelAccessibilityTask } from '../src/model-accessibility-tasks.mjs';
import { validateExistingModelEditOperations } from '../src/existing-model-editing.mjs';
import { AGENT_GATEWAY_TOOL_NAMES, TOOL_REGISTRY } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';

// Pure discovery calls plus offline compiler/registry validation. No native
// session, actual approval, save, lifecycle or provider-model acceptance.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-guidance-'));
const validator = new ToolInputValidator(TOOL_REGISTRY);
const names = ['window', 'door', 'cabinet', 'sink_counter', 'asset_query', 'asset_place', 'array_align', 'edit_single', 'edit_linked', 'asset_replace', 'mirror_layout', 'native_pbr', 'native_hdr', 'local_repair', 'save_reopen_resume'];
let nativeCalls = 0, writes = 0;
const bridge = new SketchUpBridge({ agentContract: { rootDir: path.join(dir, 'tasks') },
  approval: { stateDir: path.join(dir, 'approval'), secret: 'workflow-guidance-offline-secret-over-32-bytes' } });
for (const method of ['inspect_model', 'get_capabilities', 'queue_diagnostics', 'create_queue_handshake']) bridge[method] = async () => { nativeCalls++; throw new Error('Workflow discovery must not query native state.'); };
for (const method of ['build_model', 'save_model', 'apply_reviewed_model_edit', 'close_reopen_saved_model']) bridge[method] = async () => { writes++; throw new Error('Discovery must not mutate.'); };
const responses = new Map();
const validateCall = call => {
  assert.ok(AGENT_GATEWAY_TOOL_NAMES.includes(call.tool), `Only four public Gateway tools: ${call.tool}`);
  validator.validate(call.tool, call.arguments);
};
async function call(name, args) {
  validateCall({ tool: name, arguments: args });
  const response = await bridge[name](args);
  assert.ok(JSON.stringify(response).length <= 4096, `${args.inputs?.task_name || name} exceeds default short context`);
  return response;
}
try {
  assert.equal(AGENT_GATEWAY_TOOL_NAMES.length, 4);
  const catalog = await call('start_agent_task', { intent: 'discover', instruction: 'List modeling workflows.', inputs: { topic: 'workflows' } });
  assert.deepEqual(catalog.result.task_names, names);
  for (const task_name of names) {
    const response = await call('start_agent_task', { intent: 'discover', instruction: 'Read this workflow.', inputs: { topic: 'workflows', task_name } });
    assert.equal(response.ok, true, JSON.stringify(response.error));
    assert.equal(response.task_state, 'completed');
    assert.equal(response.result.task_name, task_name);
    assert.equal(response.result.topic, 'workflows');
    assert.equal(response.result.evidence_level, 'preflight_only');
    assert.equal(response.result.quality_accepted, false);
    assert.equal(response.result.template_only, task_name !== 'asset_query');
    assert.ok(response.result.next_step && response.result.limits, 'Support boundaries must remain inline');
    validateCall(response.result.next_call);
    if (response.result.call_template) validateCall(response.result.call_template);
    // Exact selected core fields survive even if status overhead causes the
    // generic envelope to choose its compact projection. Never read an artifact.
    const raw = getModelAccessibilityWorkflowGuide({ task: task_name });
    for (const field of ['next_call', 'call_template', 'fixed_design', 'next_step', 'limits']) assert.deepEqual(response.result[field], raw[field], `${task_name}.${field} must remain inline`);
    assert.equal(response.result.read_contract, undefined);
    assert.equal(response.result.workflow, undefined, 'Selected workflow must be flat');
    responses.set(task_name, response);
  }
  for (const kind of names.slice(0, 4)) {
    const selected = responses.get(kind).result;
    assert.equal(selected.next_call.arguments.intent, 'preflight_model');
    assert.equal(selected.next_call.arguments.inputs.task.kind, kind);
    assert.doesNotThrow(() => compileModelAccessibilityTask(selected.next_call.arguments.inputs.task));
    assert.ok(selected.fixed_design, 'Hidden construction defaults cannot disappear from selected guidance');
    assert.match(selected.next_step, /connection_task_id/);
  }
  for (const name of ['asset_place', 'asset_replace']) {
    const selected = responses.get(name).result;
    assert.equal(selected.next_call.arguments.inputs.topic, 'assets');
    assert.equal(selected.call_template.arguments.intent, 'reviewed_existing_model_edit');
    assert.equal(selected.call_template.arguments.inputs.asset_edit.mode, name === 'asset_place' ? 'place' : 'replace');
    assert.equal(selected.call_template.arguments.inputs.asset_edit.asset.path, undefined);
    assert.match(selected.next_step, /host review/);
  }
  for (const [name, scope] of [['edit_single', 'single'], ['edit_linked', 'all']]) {
    const selected = responses.get(name).result;
    assert.equal(selected.call_template.arguments.intent, 'modify_design_parameters');
    const inputs = selected.call_template.arguments.inputs;
    assert.equal(inputs.parameter_edit.scope, scope);
    assert.deepEqual(selected.next_call.arguments.inputs, { topic: 'parameter_sources', runtime: 'queue' });
    assert.ok(inputs.parameter_edit.creation_task_id && inputs.parameter_edit.targets[0].target_id && inputs.parameter_edit.changes.width_mm);
    assert.equal(inputs.assemblyRebuild, undefined);
    assert.equal(inputs.design_task_id, undefined);
    assert.match(selected.limits, /baseline blocks/);
    assert.match(selected.limits, /saved_delivery_task_id/);
  }
  for (const name of ['array_align', 'mirror_layout', 'local_repair']) {
    const inputs = responses.get(name).result.call_template.arguments.inputs;
    assert.ok(inputs.targets.length > 0, 'Gateway reviewed preparation requires explicit targets');
    assert.doesNotThrow(() => validateExistingModelEditOperations(inputs.operations), `${name} must pass the actual reviewed operation validator`);
  }
  assert.match(responses.get('mirror_layout').result.limits, /not a copy/);
  assert.match(responses.get('local_repair').result.limits, /max 3/);
  const repair = responses.get('local_repair').result.call_template.arguments.inputs;
  for (const entry of [...repair.targets, ...repair.operations]) {
    assert.match(entry.entity_path, /^pid:[1-9][0-9]*(?:\.[1-9][0-9]*)*$/, 'Native canonical occurrence paths use one pid prefix and dot-separated ancestors');
    assert.equal(entry.instance_policy, 'make_unique');
    assert.ok(entry.instance_id);
  }
  for (const name of ['native_pbr', 'native_hdr']) {
    const selected = responses.get(name).result;
    assert.equal(selected.call_template.arguments.intent, 'apply_native_appearance');
    assert.equal(selected.call_template.arguments.inputs.appearance.kind, name);
    assert.match(selected.limits, /SHA/);
    assert.match(selected.limits, /unaccepted/);
    assert.match(selected.next_step, /host review/);
    assert.match(selected.next_step, /reopen_delivered_model/);
    assert.match(selected.next_step, /deliver saved artifacts and stop/);
    assert.match(selected.next_step, /Only on explicit user request/);
  }
  const save = responses.get('save_reopen_resume').result;
  assert.equal(save.call_template.arguments.intent, 'deliver_model');
  assert.match(save.next_step, /saved_delivery_task_id/);
  assert.match(save.next_step, /reopen_delivered_model/);
  assert.match(save.limits, /No app restart or parameter rebind claim/);
  for (const [alias, actual] of [['resize_single', 'edit_single'], ['resize_linked', 'edit_linked'], ['asset_import', 'asset_place'], ['replace_asset', 'asset_replace'], ['save_reopen', 'save_reopen_resume'], ['1', 'window'], ['15', 'save_reopen_resume'], ['modify_single_instance', 'edit_single']]) assert.equal(getModelAccessibilityWorkflowGuide({ task: alias }).task_name, actual);
  assert.throws(() => getModelAccessibilityWorkflowGuide({ task: 'imaginary_auto_model' }), error => error.code === 'INVALID_ARGUMENT' && error.details.field === 'task_name');

  const invalid = await call('start_agent_task', { intent: 'verify_model', instruction: 'Do not mistake a description for verified geometry.', inputs: { task: { kind: 'window' } } });
  assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
  validateCall(invalid.next_action);
  assert.equal(invalid.next_action.arguments.inputs.topic, 'workflows');
  const recovery = await call(invalid.next_action.tool, invalid.next_action.arguments);
  assert.equal(recovery.ok, true);
  assert.equal(recovery.result.task_name, 'save_reopen_resume');
  assert.equal(nativeCalls, 0);
  assert.equal(writes, 0);
  console.log(JSON.stringify({ ok: true, workflows: names.length, max_response_chars: Math.max(...[...responses.values()].map(value => JSON.stringify(value).length)), artifact_reads: 0, native_calls: nativeCalls, writes, evidence: 'offline_discovery_and_contracts_only' }));
} finally { await fs.rm(dir, { recursive: true, force: true }); }
