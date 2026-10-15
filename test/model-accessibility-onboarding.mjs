import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { getModelAccessibilityTaskCatalog, MODEL_ACCESSIBILITY_TASK_KINDS } from '../src/model-accessibility-tasks.mjs';
import { getModelAccessibilityWorkflowGuide, getModelAccessibilityWorkflows } from '../src/model-accessibility-workflows.mjs';
import { compileTraditionalScenePlan } from '../src/traditional-timber/scene-plan.mjs';
import { FIRST_USE_GUIDE } from '../src/model-accessibility-guidance.mjs';
import { TOOL_DOCS } from '../src/docs.mjs';

const names = getModelAccessibilityWorkflowGuide().task_names;
for (const kind of MODEL_ACCESSIBILITY_TASK_KINDS) {
  assert.ok(names.includes(kind), `${kind} must be discoverable through workflows`);
  assert.ok(getModelAccessibilityWorkflows().workflows.some(w => w.task === kind));
  const task = getModelAccessibilityTaskCatalog({ task: kind }).tasks[0];
  assert.equal(task.workflow.arguments.inputs.task_name, kind);
  assert.ok(task.workflow.arguments.instruction);
  assert.ok(getModelAccessibilityWorkflowGuide({ task: kind }).next_call);
}
assert.equal(getModelAccessibilityWorkflowGuide({ task: '7' }).task_name, 'array_align', 'original numeric aliases remain stable');
assert.equal(getModelAccessibilityWorkflowGuide({ task: '15' }).task_name, 'save_reopen_resume');
assert.match(FIRST_USE_GUIDE.scenes, /scene_plan/);
assert.match(FIRST_USE_GUIDE.layout, /layout_edit/);
assert.match(getModelAccessibilityWorkflowGuide({ task: 'save_reopen_resume' }).next_step, /deliver and stop.*explicitly/);
assert.match(getModelAccessibilityWorkflows({ task: 'save_reopen' }).execution_route.steps[0], /仅用户明确要求/);
assert.doesNotMatch(TOOL_DOCS, /model-accessibility-support-2026-09-11|model-accessibility-quickstart|15 workflow categories/);
const scene = getModelAccessibilityWorkflowGuide({ task: 'traditional_scene' }).next_call.arguments.inputs.scene_plan;
assert.equal(compileTraditionalScenePlan(scene).jobs.length, 2, 'inline scene is a compilable two-root example');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'model-onboarding-'));
try {
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(root, 'model.json') }, agentContract: { rootDir: path.join(root, 'tasks') }, approval: { stateDir: path.join(root, 'approval') } });
  let writes = 0;
  bridge.build_model = async () => { writes++; throw new Error('Discovery must not build geometry.'); };
  const discover = async inputs => {
    const response = await bridge.start_agent_task({ intent: 'discover', instruction: 'Discover a supported modeling task and next step.', inputs });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.ok(JSON.stringify(response).length <= 4096, `short response exceeded its bound: ${JSON.stringify(inputs)}`);
    return response;
  };
  const first = await discover({ topic: 'start' });
  assert.match(JSON.stringify(first.data), /traditional_scene/);
  assert.match(JSON.stringify(first.data), /layout_edit/);
  assert.match(JSON.stringify(first.data), /explicit user request|explicitly requests|explicit user/);
  const workflows = await discover({ topic: 'workflows' });
  for (const kind of MODEL_ACCESSIBILITY_TASK_KINDS) assert.ok(workflows.data.task_names.includes(kind));
  for (const task_name of names) {
    const result = await discover({ topic: 'workflows', task_name });
    assert.equal(result.data.task_name, task_name);
    if (['traditional_assembly', 'traditional_scene'].includes(task_name)) assert.equal(result.data.next_call.tool, 'start_agent_task', 'common assembly entry stays inline without source/artifact reads');
    if (task_name === 'array_align') {
      assert.equal(result.data.call_template.arguments.inputs.layout_edit.mode, 'array');
      assert.equal(result.data.align_template.arguments.inputs.layout_edit.mode, 'align');
    }
    if (task_name === 'mirror_layout') assert.equal(result.data.call_template.arguments.inputs.layout_edit.mode, 'mirror_copy');
    if (['edit_single', 'edit_linked'].includes(task_name)) {
      assert.match(result.data.next_step, /parameter_edit.structure_change/);
      assert.match(result.data.next_step, /insert_bay.*remove_bay.*segment_id.*bay_index.*length_mm/);
      assert.match(result.data.next_step, /straight\/rectangular/);
      assert.match(result.data.limits, /changes and structure_change are exclusive/);
    }
  }
  const parameters = await discover({ topic: 'tasks', kind: 'traditional_assembly', detail: 'parameters' });
  assert.equal(parameters.data.parameters.by_stored_plan, true);
  assert.ok((parameters.data.family_names || Object.keys(parameters.data.family_catalog)).includes('roof_unit'));
  assert.equal(parameters.data.scene_composition.input_field, 'inputs.scene_plan');
  assert.equal(parameters.data.parameter_rules, undefined, 'assembly plan fields are not scalar parameter-rule objects');
  const example = await discover({ topic: 'tasks', kind: 'traditional_assembly', detail: 'examples' });
  assert.equal(example.data.task_input.kind, 'traditional_assembly');
  assert.ok(example.data.task_input.assembly.parameter_bindings);
  assert.equal(writes, 0);
  const narrow = new SketchUpBridge({ mock: { sessionPath: path.join(root, 'narrow-model.json') }, agentContract: { rootDir: path.join(root, 'narrow-tasks') },
    approval: { stateDir: path.join(root, 'narrow-approval') }, agentResponsePolicy: { max_context_chars: { guided: 2048 } } });
  for (const inputs of [{ topic: 'start' }, { topic: 'tasks', kind: 'traditional_assembly', detail: 'parameters' }, { topic: 'workflows', task_name: 'edit_single' }]) {
    const response = await narrow.start_agent_task({ intent: 'discover', instruction: 'Read bounded modeling discovery.', inputs });
    assert.equal(response.ok, true);
    assert.ok(JSON.stringify(response).length <= 2048);
    if (inputs.topic !== 'start') assert.equal(response.data.next_call.tool, 'read_agent_artifact', 'minimum host context keeps a task-bound route to complete inputs');
  }
  console.log('Onboarding passed: creation/workflow catalog consistency, stable aliases, inline scene/assembly examples, complete parameter projection and bounded public discovery without model writes.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
