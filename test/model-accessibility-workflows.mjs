import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getModelAccessibilityWorkflows } from '../src/model-accessibility-workflows.mjs';
import { TOOL_REGISTRY } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';
import { OPERATION_REGISTRY } from '../src/capabilities.mjs';
import { callTool, SketchUpBridge } from '../src/bridge.mjs';

const validator = new ToolInputValidator(TOOL_REGISTRY);
const catalog = getModelAccessibilityWorkflows();
assert.deepEqual(catalog.workflows.map(item => item.task_number), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
assert.ok(JSON.stringify(catalog).length < 4096, 'Discovery directory must remain small enough for short contexts.');
assert.throws(() => getModelAccessibilityWorkflows({ task: 'automatic_universal_alignment' }), error => error.code === 'INVALID_ARGUMENT');
assert.throws(() => getModelAccessibilityWorkflows({ task: {} }), error => error.code === 'INVALID_ARGUMENT');
assert.equal(getModelAccessibilityWorkflows({ task: '9' }).task, 'resize_linked');
assert.equal(getModelAccessibilityWorkflows({ task: 'pbr' }).task, 'native_pbr');
const saveWorkflow = getModelAccessibilityWorkflows({ task: 'save_reopen' });
assert.equal(saveWorkflow.support, 'guided_saved_document_lifecycle_then_parameter_rebinding');
assert.equal(saveWorkflow.execution_route.gateway_save.intent, 'deliver_model');
assert.deepEqual(saveWorkflow.execution_route.gateway_save.inputs, ['runtime', 'source_task_id', 'connection_task_id']);
assert.ok(saveWorkflow.limits.some(value => value.includes('cold_reopen_verified=false')));
assert.equal(saveWorkflow.execution_route.gateway_reopen.intent, 'reopen_delivered_model');
assert.deepEqual(saveWorkflow.execution_route.gateway_reopen.inputs, ['runtime', 'saved_delivery_task_id', 'connection_task_id']);
assert.ok(saveWorkflow.limits.some(value => value.includes('无凭据不再保存')));

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-accessibility-workflows-'));
try {
  const bridge = new SketchUpBridge({
    mock: { sessionPath: path.join(root, 'mock-model.json') },
    agentContract: { rootDir: path.join(root, 'tasks') },
    approval: { stateDir: path.join(root, 'approval'), secret: 'workflow-fixture-server-secret-32-bytes' },
    executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
  });
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'component_definition', name: 'Existing', operations: [
      { op: 'box', id: 'board', name: 'Board', origin: [0, 0, 0], size: [100, 20, 200] }
    ] },
    { op: 'component_instance', id: 'one', name: 'One', definition: 'Existing', origin: [0, 0, 0] },
    { op: 'component_instance', id: 'two', name: 'Two', definition: 'Existing', origin: [300, 0, 0] }
  ] }) });
  const before = await fs.readFile(path.join(root, 'mock-model.json'), 'utf8');
  for (const item of catalog.workflows) {
    const workflow = getModelAccessibilityWorkflows({ task: item.task });
    assert.ok(JSON.stringify(workflow).length < 4096, `${item.task} should be a bounded selected workflow`);
    assert.equal(workflow.entry_is_complete_mutation_example, false);
    assert.equal(workflow.execution_allowed_by_this_document, false);
    assert.ok(workflow.required_design_inputs.length > 0);
    validator.validate(workflow.entry.tool, workflow.entry.arguments);
    if (workflow.prepare_example) validator.validate(workflow.prepare_example.tool, workflow.prepare_example.arguments);
    for (const contract of workflow.execution_route.tools) {
      const schema = validator.schemaFor(contract.tool);
      for (const field of contract.fields) assert.ok(Object.hasOwn(schema.properties || {}, field), `${contract.tool}.${field} must exist`);
    }
    for (const contract of workflow.execution_route.operations) {
      const definition = OPERATION_REGISTRY[contract.op];
      assert.ok(definition, `${contract.op} must be a registered operation`);
      const fields = [...definition.schema.required, ...definition.schema.optional];
      for (const field of contract.fields) assert.ok(fields.includes(field), `${contract.op}.${field} must exist`);
    }
    // Execute exactly the published entry against an isolated model, changing
    // only runtime to mock. No native session, provider model or approval runs.
    const args = structuredClone(workflow.entry.arguments);
    if (args.runtime) args.runtime = 'mock';
    if (args.inputs?.runtime) args.inputs.runtime = 'mock';
    const result = await callTool(workflow.entry.tool, args, bridge);
    if (workflow.entry.tool === 'start_agent_task') {
      assert.equal(result.ok, true, `${item.task}: ${JSON.stringify(result.error)}`);
      assert.equal(result.task_state, workflow.entry_kind === 'request_missing_design_inputs' ? 'awaiting_input' : 'completed');
    }
    assert.equal(await fs.readFile(path.join(root, 'mock-model.json'), 'utf8'), before, `${item.task} entry must not mutate existing/shared objects`);
  }
  const mutableResult = getModelAccessibilityWorkflows({ task: 'native_hdr' });
  mutableResult.entry.arguments.inputs.runtime = 'mock';
  mutableResult.execution_route.operations[0].fields.push('invented_field');
  assert.equal(getModelAccessibilityWorkflows({ task: 'native_hdr' }).entry.arguments.inputs.runtime, 'queue');
  assert.equal(getModelAccessibilityWorkflows({ task: 'native_hdr' }).execution_route.operations[0].fields.includes('invented_field'), false);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('model-accessibility-workflows: 11 workflow entries and real tool/operation fields validated; isolated mock entries preserve shared model bytes; no live or cross-model acceptance claimed');
