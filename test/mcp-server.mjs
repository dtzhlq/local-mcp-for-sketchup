import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_GATEWAY_TOOL_NAMES, EXPERT_TOOL_NAMES, SESSION_CONTRACT_TOOL_NAMES, listToolNames } from '../src/tool-registry.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pythonSdkSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-facade-fixture.py'), 'utf8');
const mcpMockSessionPath = path.join(repoRoot, 'output', 'test-mcp-server-session.json');
await fs.rm(mcpMockSessionPath, { force: true });
await fs.rm(`${mcpMockSessionPath}.lock`, { force: true });
const server = spawn(process.execPath, [path.join(repoRoot, 'src/mcp-server.mjs')], {
  cwd: repoRoot,
  env: { ...process.env, LOCAL_MCP_FOR_SKETCHUP_ENABLE_RUBY_EXPERT: '', LOCAL_MCP_FOR_SKETCHUP_MOCK_SESSION_PATH: mcpMockSessionPath },
  stdio: ['pipe', 'pipe', 'pipe']
});

const resolvers = new Map();
let buffer = '';
let stderr = '';
let idCounter = 100;

server.stdout.setEncoding('utf8');
server.stderr.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.trim()) handleResponseLine(line);
    newline = buffer.indexOf('\n');
  }
});
server.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  const initialized = await request({ id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(initialized.result.serverInfo.version, PRODUCT_VERSION);
  const list = await request({ id: 1, method: 'tools/list' });
  const toolNames = list.result.tools.map((tool) => tool.name);
  const registryToolMap = new Map(list.result.tools.map((tool) => [tool.name, tool]));
  assert.equal(toolNames.length, 41, 'MCP tools/list should expose 36 expert tools, 4 Agent Gateway tools, and the fresh handshake tool');
  assert.equal(EXPERT_TOOL_NAMES.length, 36, 'the original 36-tool expert surface must remain available');
  assert.equal(AGENT_GATEWAY_TOOL_NAMES.length, 4);
  assert.deepEqual(SESSION_CONTRACT_TOOL_NAMES, ['create_queue_handshake']);
  assert.deepEqual(toolNames, listToolNames(), 'stdio MCP must expose the shared tool registry without drift');
  const docsTool = list.result.tools.find((tool) => tool.name === 'get_docs');
  assert.ok(docsTool.inputSchema.properties.topic.enum.includes('existing_model_edit'));
  assert.ok(docsTool.inputSchema.properties.topic.enum.includes('copy_fast'));
  assert.ok(docsTool.inputSchema.properties.topic.enum.includes('image_artifacts'));
  assert.deepEqual(docsTool.inputSchema.properties.detail.enum, ['summary', 'standard', 'full']);
  assert.ok(toolNames.includes('prepare_image_modeling_brief'), 'MCP tools/list should expose prepare_image_modeling_brief');
  assert.ok(toolNames.includes('compile_reviewed_part_graph'), 'MCP tools/list should expose compile_reviewed_part_graph');
  assert.ok(toolNames.includes('prepare_existing_model_edit'), 'MCP tools/list should expose prepare_existing_model_edit');
  assert.ok(toolNames.includes('apply_reviewed_model_edit'), 'MCP tools/list should expose apply_reviewed_model_edit');
  for (const toolName of AGENT_GATEWAY_TOOL_NAMES) assert.ok(toolNames.includes(toolName), `MCP tools/list should expose ${toolName}`);
  assert.ok(toolNames.includes('get_workflow_bundle'), 'MCP tools/list should expose get_workflow_bundle');
  assert.ok(toolNames.includes('compile_expert'), 'MCP tools/list should expose compile_expert');
  assert.ok(toolNames.includes('compile_python_sdk'), 'MCP tools/list should expose compile_python_sdk');
  assert.ok(toolNames.includes('build_expert_model'), 'MCP tools/list should expose build_expert_model');
  assert.ok(toolNames.includes('validate_model'), 'MCP tools/list should expose validate_model');
  assert.ok(toolNames.includes('validate_reference_model'), 'MCP tools/list should expose validate_reference_model');
  assert.ok(toolNames.includes('queue_diagnostics'), 'MCP tools/list should expose queue_diagnostics');
  assert.ok(toolNames.includes('create_queue_handshake'), 'MCP tools/list should expose create_queue_handshake');
  assert.ok(toolNames.includes('capture_view'), 'MCP tools/list should expose capture_view');
  assert.ok(toolNames.includes('run_ruby_expert'), 'MCP tools/list should expose run_ruby_expert');
  for (const toolName of ['inspect_model', 'list_entities', 'get_model_info', 'adopt_open_model', 'resolve_model_targets', 'get_selection', 'analyze_selection_geometry', 'plan_modification_intent', 'set_selection', 'open_model', 'import_model', 'export_model', 'save_model_version', 'evaluate_py', 'build_report', 'iterate_model']) {
    assert.ok(toolNames.includes(toolName), `MCP tools/list should expose ${toolName}`);
  }
  const compileTool = list.result.tools.find((tool) => tool.name === 'compile_expert');
  assert.deepEqual(compileTool.inputSchema.required, ['code']);
  assert.ok(compileTool.inputSchema.properties.maxOperations);
  const compilePythonTool = list.result.tools.find((tool) => tool.name === 'compile_python_sdk');
  assert.deepEqual(compilePythonTool.inputSchema.required, ['code']);
  assert.ok(compilePythonTool.inputSchema.properties.pythonTimeoutMs);
  const evaluatePyTool = list.result.tools.find((tool) => tool.name === 'evaluate_py');
  assert.ok(evaluatePyTool.inputSchema.properties.input_format.enum.includes('python_sdk'));
  const iterateTool = list.result.tools.find((tool) => tool.name === 'iterate_model');
  assert.equal(iterateTool.inputSchema.required, undefined);
  assert.ok(iterateTool.inputSchema.properties.targets);
  assert.ok(iterateTool.inputSchema.properties.target_query);
  assert.ok(iterateTool.inputSchema.properties.preview_only);
  assert.ok(iterateTool.inputSchema.properties.intent);
  assert.ok(iterateTool.inputSchema.properties.intent_file);
  assert.ok(iterateTool.inputSchema.properties.input_format.enum.includes('python_sdk'));
  const adoptTool = list.result.tools.find((tool) => tool.name === 'adopt_open_model');
  assert.ok(adoptTool.inputSchema.properties.recursive);
  const startTaskTool = list.result.tools.find((tool) => tool.name === 'start_agent_task');
  assert.deepEqual(startTaskTool.inputSchema.required, ['intent', 'instruction']);
  assert.ok(startTaskTool.inputSchema.properties.intent.enum.includes('propose_existing_model_edit'));
  assert.ok(startTaskTool.inputSchema.properties.intent.enum.includes('modify_design_parameters'));
  assert.ok(startTaskTool.inputSchema.properties.intent.enum.includes('reconcile_design_intent'));
  assert.ok(startTaskTool.inputSchema.properties.intent.enum.includes('reference_image_correction'));
  assert.ok(startTaskTool.inputSchema.properties.intent.enum.includes('visual_correction_qa'));
  assert.equal(startTaskTool.inputSchema.properties.execution_policy, undefined, 'Agents must not be able to submit execution policy');
  const applyExistingTool = list.result.tools.find((tool) => tool.name === 'apply_reviewed_model_edit');
  assert.equal(Object.hasOwn(applyExistingTool.inputSchema.properties, 'approval_token'), false, 'public expert schema must not accept approval credentials');
  assert.ok(applyExistingTool.inputSchema.properties.session_contract);
  const submitTaskTool = list.result.tools.find((tool) => tool.name === 'submit_agent_task_input');
  assert.equal(JSON.stringify(submitTaskTool.inputSchema).includes('approval_token'), false, 'Agent task schema must not publish an approval-token field');
  const readArtifactTool = list.result.tools.find((tool) => tool.name === 'read_agent_artifact');
  assert.ok(readArtifactTool.inputSchema.properties.offset, 'artifact reads must expose resumable offset pagination');
  assert.equal(readArtifactTool.inputSchema.properties.max_chars.type, 'integer');
  assert.match('image-artifact:sha256:'.concat('a'.repeat(64)), new RegExp(readArtifactTool.inputSchema.properties.handle.pattern), 'immutable image handles must be readable without local files');
  const unknownTool = await request({
    id: nextId(), method: 'tools/call', params: { name: 'not_a_registered_tool', arguments: {} }
  });
  assert.equal(unknownTool.error.data.code, 'INVALID_ARGUMENT');
  const unexpectedToolField = await request({
    id: nextId(), method: 'tools/call', params: { name: 'get_docs', arguments: { unexpected_field: true } }
  });
  assert.equal(unexpectedToolField.error.data.code, 'INVALID_ARGUMENT');
  const wrongNestedToolField = await request({
    id: nextId(),
    method: 'tools/call',
    params: {
      name: 'start_agent_task',
      arguments: {
        intent: 'understand_model',
        instruction: 'Invalid nested capability fixture.',
        client_capabilities: { context: 'unbounded' }
      }
    }
  });
  assert.equal(wrongNestedToolField.error.data.code, 'INVALID_ARGUMENT');
  const forbiddenGatewayToken = await request({
    id: nextId(),
    method: 'tools/call',
    params: {
      name: 'start_agent_task',
      arguments: {
        intent: 'understand_model',
        instruction: 'Reject an Agent-supplied approval credential before task persistence.',
        inputs: { nested: { approval_token: 'forged-public-credential' } }
      }
    }
  });
  assert.equal(forbiddenGatewayToken.error.data.code, 'APPROVAL_TOKEN_FORBIDDEN');
  const forbiddenExpertToken = await request({
    id: nextId(),
    method: 'tools/call',
    params: { name: 'apply_reviewed_model_edit', arguments: { approval_token: 'forged-public-credential' } }
  });
  assert.equal(forbiddenExpertToken.error.data.code, 'INVALID_ARGUMENT');
  const buildReportTool = list.result.tools.find((tool) => tool.name === 'build_report');
  assert.equal(buildReportTool.inputSchema.properties.strictCollisions.type, 'boolean');
  assert.equal(buildReportTool.inputSchema.properties.strictUnanchored.type, 'boolean');
  assert.equal(buildReportTool.inputSchema.properties.floatingDetails.type, 'boolean');
  const handshakeTool = list.result.tools.find((tool) => tool.name === 'create_queue_handshake');
  assert.equal(handshakeTool.inputSchema.properties.expires_in_ms.maximum, 300000);
  const importTool = list.result.tools.find((tool) => tool.name === 'import_model');
  assert.ok(importTool.description.includes('queue supports append only'));
  assert.ok(importTool.inputSchema.properties.mode.description.includes('OPERATION_NOT_ALLOWED'));
  for (const toolName of ['build_model', 'reset_model', 'save_model', 'open_model', 'import_model', 'export_model', 'adopt_open_model', 'set_selection', 'capture_view', 'run_ruby_expert', 'evaluate_py', 'build_report', 'iterate_model', 'compare_model', 'validate_model', 'validate_reference_model']) {
    const liveTool = list.result.tools.find((tool) => tool.name === toolName);
    assert.ok(liveTool.inputSchema.properties.session_contract, `${toolName} must expose the live Session Contract input`);
  }
  const imageCompileTool = list.result.tools.find((tool) => tool.name === 'compile_reviewed_part_graph');
  assert.deepEqual(imageCompileTool.inputSchema.required, ['mcp_brief_path', 'promotion_review_path', 'part_graph_path', 'profile_path']);
  const resolveTool = list.result.tools.find((tool) => tool.name === 'resolve_model_targets');
  assert.ok(resolveTool.inputSchema.properties.query);
  const analyzeSelectionTool = list.result.tools.find((tool) => tool.name === 'analyze_selection_geometry');
  assert.ok(analyzeSelectionTool.inputSchema.properties.assume);
  const planIntentTool = list.result.tools.find((tool) => tool.name === 'plan_modification_intent');
  assert.ok(planIntentTool.inputSchema.properties.action.enum.includes('set_attribute'));
  assert.ok(planIntentTool.inputSchema.properties.output_dir);
  const rubyExpertTool = list.result.tools.find((tool) => tool.name === 'run_ruby_expert');
  assert.deepEqual(rubyExpertTool.inputSchema.required, ['code']);
  assert.equal(rubyExpertTool.inputSchema.properties.runtime.enum[0], 'queue');
  assert.ok(rubyExpertTool.inputSchema.properties.session_contract);

  const workflowBundle = await callTool('get_workflow_bundle', {});
  assert.equal(workflowBundle.kind, 'sketchup_mcp_workflow_bundle');
  assert.ok(workflowBundle.workflows.inspector.steps.some((step) => step.tool === 'queue_diagnostics'));
  assert.ok(workflowBundle.workflows.modeler.steps.some((step) => step.tool === 'capture_view'));
  assert.ok(workflowBundle.workflows.iterator.steps.some((step) => step.tool === 'iterate_model'));
  for (const workflow of ['create', 'understand', 'reviewed_existing_model_edit', 'image_artifact', 'verify']) {
    assert.ok(workflowBundle.workflows[workflow], `workflow bundle should include ${workflow}`);
  }
  assert.ok(workflowBundle.workflows.propose_existing_model_edit);
  assert.equal(JSON.stringify(workflowBundle).includes('read-only nested index'), false, 'workflow bundle must not retain obsolete nested-read-only wording');
  assert.ok(workflowBundle.guardrails.some((item) => item.includes('untrusted data')));
  assert.ok(workflowBundle.guardrails.some((item) => item.includes('S2-S4')));
  assert.equal(JSON.stringify(workflowBundle).includes('approval_token'), false, 'workflow examples must never instruct an Agent to relay approval credentials');
  for (const [workflowName, workflow] of Object.entries(workflowBundle.workflows)) {
    const entries = [['guided_entry', workflow.guided_entry], ...(workflow.steps || []).map((step, index) => [`step_${index}`, step])];
    for (const [entryName, entry] of entries) {
      if (!entry?.tool) continue;
      const definition = registryToolMap.get(entry.tool);
      assert.ok(definition, `${workflowName}.${entryName} must reference a registered tool`);
      for (const required of definition.inputSchema?.required || []) {
        assert.ok(Object.hasOwn(entry.arguments || {}, required), `${workflowName}.${entryName} must include a placeholder for required argument ${required}`);
      }
    }
  }
  const verifySteps = workflowBundle.workflows.verify.steps;
  for (const toolName of ['compare_model', 'capture_view', 'save_model_version']) {
    const index = verifySteps.findIndex((step) => step.tool === toolName);
    assert.ok(index > 0 && verifySteps[index - 1].tool === 'create_queue_handshake', `${toolName} must be immediately preceded by a fresh queue handshake`);
    assert.ok(verifySteps[index].arguments.session_contract, `${toolName} must consume the fresh Session Contract`);
  }
  const verifyContracts = verifySteps.filter((step) => ['compare_model', 'capture_view', 'save_model_version'].includes(step.tool)).map((step) => step.arguments.session_contract);
  assert.equal(new Set(verifyContracts).size, verifyContracts.length, 'workflow examples must not reuse a Session Contract after mutation');

  const docsOverview = await callTool('get_docs', {});
  assert.equal(docsOverview.contract_version, 'get_docs.v2');
  assert.equal(docsOverview.topic, 'overview');
  assert.equal(docsOverview.truncated, false);
  assert.ok(docsOverview.docs.length < 12000, 'default docs response should fit short-context Agents');
  const docsSlice = await callTool('get_docs', { topic: 'dsl', detail: 'summary', max_chars: 500 });
  assert.equal(docsSlice.truncated, true);
  assert.ok(docsSlice.docs.length <= 500);
  assert.equal(docsSlice.next_action.tool, 'get_docs');
  const structuredDocs = await request({
    method: 'tools/call',
    params: { name: 'get_docs', arguments: { topic: 'existing_model_edit', max_chars: 1000 } }
  });
  assert.equal(structuredDocs.result.structuredContent.kind, 'sketchup_mcp_docs');
  assert.equal(structuredDocs.result.structuredContent.topic, 'existing_model_edit');
  assert.equal(JSON.parse(structuredDocs.result.content[0].text).topic, 'existing_model_edit');
  const copyFastDocs = await callTool('get_docs', { topic: 'copy_fast', detail: 'summary', max_chars: 5000 });
  assert.equal(copyFastDocs.topic, 'copy_fast');
  assert.equal(copyFastDocs.truncated, false);
  assert.match(copyFastDocs.docs, /next_action=execute_copy_edit/);
  assert.match(copyFastDocs.docs, /user_action_required=false/);
  assert.match(copyFastDocs.docs, /never by Agent input/);

  const blockedRubyExpert = await callTool('run_ruby_expert', { code: 'Sketchup.active_model.title' });
  assert.equal(blockedRubyExpert.kind, 'run_ruby_expert');
  assert.equal(blockedRubyExpert.enabled, false);
  assert.equal(blockedRubyExpert.blocked, true);

  const blockedQueueReplace = await request({
    method: 'tools/call',
    params: { name: 'import_model', arguments: { runtime: 'queue', path: 'must-not-be-read.skp', mode: 'replace' } }
  });
  assert.equal(blockedQueueReplace.error.data.code, 'OPERATION_NOT_ALLOWED');
  assert.equal(blockedQueueReplace.error.data.retryable, false);
  assert.equal(blockedQueueReplace.error.data.next_action.action, 'prepare_new_plan');
  assert.deepEqual(blockedQueueReplace.error.data.next_action.allowed_queue_modes, ['append']);

  const expertSource = [
    'const ops = [];',
    'ops.push({ op: "reset" });',
    'ops.push({ op: "box", name: "MCP_Expert_Box", origin: [0, 0, 0], size: [10, 20, 30] });',
    'dsl(ops);'
  ].join('\n');

  const compiled = await callTool('compile_expert', { code: expertSource, seed: 3 });
  assert.equal(compiled.expert.operations, 2);
  assert.equal(compiled.document.operations[1].name, 'MCP_Expert_Box');

  const built = await callTool('build_expert_model', { code: expertSource, runtime: 'mock', seed: 3 });
  assert.equal(built.compiled.expert.operations, 2);
  assert.equal(built.snapshot.totals.groups, 1);
  assert.equal(built.snapshot.warnings.length, 0);
  assert.ok(built.snapshot.groups.some((group) => group.name === 'MCP_Expert_Box'));

  const pythonCompiled = await callTool('compile_python_sdk', { code: pythonSdkSource });
  assert.equal(pythonCompiled.python_sdk.compiler_version, 'python-sdk-facade-compiler-0.1.0');
  assert.equal(pythonCompiled.python_sdk.operations, 7);
  assert.equal(pythonCompiled.result.panel, 'sdk-panel');

  const pythonEvaluated = await callTool('evaluate_py', { code: pythonSdkSource, input_format: 'python_sdk', runtime: 'mock', pythonTimeoutMs: 20000 });
  assert.equal(pythonEvaluated.compatibility_mode, 'python_sdk_facade_compiler');
  assert.equal(pythonEvaluated.executed, true);
  assert.equal(pythonEvaluated.blocked, false);
  assert.equal(pythonEvaluated.snapshot.totals.groups, 4);
  assert.equal(pythonEvaluated.snapshot.warning_summary.total, 0);

  const apiDsl = JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'image_reference', name: 'MCP_Ref_Image', path: '/tmp/mcp-ref.png', width: 100, height: 60 },
      { op: 'geometry_input', id: 'mcp-api-panel', name: 'MCP_API_Panel', vertices: [[0, 0, 0], [80, 0, 0], [80, 40, 0], [0, 40, 0]], faces: [[0, 1, 2, 3]] },
      { op: 'curve', id: 'mcp-api-curve', name: 'MCP_API_Curve', points: [[0, 0, 10], [30, 10, 10], [80, 0, 10]] },
      { op: 'arc_curve', id: 'mcp-api-arc', name: 'MCP_API_Arc', center: [0, 0, 20], radius: 25, start_angle: 0, end_angle: 90, segments: 4 },
      { op: 'face_uv', target_id: 'mcp-api-panel', uv_id: 'front', uv: [[0, 0], [1, 0], [1, 1], [0, 1]], image_reference: 'MCP_Ref_Image' }
    ]
  });
  const evaluated = await callTool('evaluate_py', { code: apiDsl, input_format: 'json_dsl', runtime: 'mock' });
  assert.equal(evaluated.kind, 'evaluate_py');
  assert.equal(evaluated.compatibility_mode, 'safe_json_dsl');
  assert.equal(evaluated.blocked, false);
  assert.equal(evaluated.snapshot.totals.groups, 3);
  assert.equal(evaluated.snapshot.warning_summary.total, 0);
  assert.equal(evaluated.snapshot.image_references[0].name, 'MCP_Ref_Image');
  assert.equal(evaluated.snapshot.groups.find((group) => group.id === 'mcp-api-panel').face_uvs[0].id, 'front');

  const inspected = await callTool('inspect_model', { runtime: 'mock', includeSnapshot: false });
  assert.equal(inspected.kind, 'inspect_model');
  assert.equal(inspected.entities.length, 3);
  const listedCurves = await callTool('list_entities', { runtime: 'mock', kind: 'curve' });
  assert.equal(listedCurves.entities.length, 1);
  const modelInfo = await callTool('get_model_info', { runtime: 'mock' });
  assert.equal(modelInfo.kind, 'model_info');
  assert.equal(modelInfo.counts.image_references, 1);
  const selected = await callTool('set_selection', { runtime: 'mock', targets: ['mcp-api-panel'] });
  assert.equal(selected.selection.length, 1);
  const currentSelection = await callTool('get_selection', { runtime: 'mock' });
  assert.equal(currentSelection.selection[0].id, 'mcp-api-panel');
  const selectionGeometry = await callTool('analyze_selection_geometry', { runtime: 'mock', assume: 'road', includeDetails: false });
  assert.equal(selectionGeometry.kind, 'selection_geometry_analysis');
  assert.equal(selectionGeometry.entities.length, 1);
  assert.equal(selectionGeometry.entities[0].geometry.source, 'bounding_box_approximation');
  assert.ok(selectionGeometry.uncertainties.some((item) => item.type === 'geometry.bbox_only'));
  const intentDir = path.join(repoRoot, 'output', 'test-mcp-intent');
  await fs.rm(intentDir, { recursive: true, force: true });
  const plannedIntent = await callTool('plan_modification_intent', {
    runtime: 'mock',
    instruction: 'mark selected panel as reviewed',
    action: 'set_attribute',
    parameters: { dictionary: 'IntentTest', key: 'reviewed', value: true },
    output_dir: intentDir
  });
  assert.equal(plannedIntent.kind, 'modification_intent');
  assert.equal(plannedIntent.safe_to_execute, true);
  assert.equal(plannedIntent.requires_confirmation, false);
  assert.equal(plannedIntent.patch.operations[0].op, 'attribute');
  assert.ok(plannedIntent.artifacts.modification_intent.endsWith('modification-intent.json'));
  await fs.access(plannedIntent.artifacts.selection_geometry);
  await fs.access(plannedIntent.artifacts.intent_manifest);
  const adopted = await callTool('adopt_open_model', { runtime: 'mock', recursive: true });
  assert.equal(adopted.kind, 'adopt_open_model');
  assert.equal(adopted.existing_count, 3);
  const resolvedPanel = await callTool('resolve_model_targets', { runtime: 'mock', query: 'largest panel' });
  assert.equal(resolvedPanel.kind, 'target_resolution');
  assert.equal(resolvedPanel.ok, true);
  assert.equal(resolvedPanel.selected_targets[0].id, 'mcp-api-panel');

  const iterationDir = path.join(repoRoot, 'output', 'test-mcp-iteration');
  await fs.rm(iterationDir, { recursive: true, force: true });
  const iterationPatch = JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'attribute', target_id: '$target', dictionary: 'MCP', key: 'iteration', value: 'target-query' },
      { op: 'material', name: 'MCP_Iteration_Accent', color: '#dd8844' },
      { op: 'box', id: 'mcp-iteration-addon', name: 'MCP_Iteration_Addon', origin: [90, 0, 0], size: [20, 20, 10], material: 'MCP_Iteration_Accent' }
    ]
  });
  const iteration = await callTool('iterate_model', {
    code: iterationPatch,
    input_format: 'json_dsl',
    runtime: 'mock',
    output_dir: iterationDir,
    label: 'mcp-iteration',
    target_query: 'largest panel',
    validate_model: false,
    includePreview: false
  });
  assert.equal(iteration.kind, 'model_iteration');
  assert.equal(iteration.before.model_info.totals.groups, 3);
  assert.equal(iteration.after.model_info.totals.groups, 4);
  assert.equal(iteration.change_summary.totals_delta.groups, 1);
  assert.ok(iteration.change_summary.added.some((item) => item.id === 'mcp-iteration-addon'));
  assert.equal(iteration.target_resolution.selected_targets[0].id, 'mcp-api-panel');
  assert.equal(iteration.target_selection[0].id, 'mcp-api-panel');
  assert.ok(iteration.saved_model.file_path.endsWith('model-mcp-iteration.json'));
  await fs.access(iteration.artifacts.manifest);
  await fs.access(iteration.artifacts.target_resolution);
  await fs.access(iteration.artifacts.resolved_input);
  await fs.access(iteration.artifacts.before_snapshot);
  await fs.access(iteration.artifacts.after_snapshot);
  await fs.access(iteration.artifacts.snapshot_diff);

  const intentIterationDir = path.join(repoRoot, 'output', 'test-mcp-iteration-from-intent');
  await fs.rm(intentIterationDir, { recursive: true, force: true });
  const intentIteration = await callTool('iterate_model', {
    intent: plannedIntent,
    runtime: 'mock',
    output_dir: intentIterationDir,
    validate_model: false,
    save_model: false
  });
  assert.equal(intentIteration.kind, 'model_iteration');
  assert.equal(intentIteration.modification_intent.intent_id, plannedIntent.intent_id);
  assert.equal(intentIteration.evaluation.compatibility_mode, 'safe_json_dsl');
  await fs.access(intentIteration.artifacts.modification_intent);
  await fs.access(intentIteration.artifacts.intent_patch);

  const blockedIntent = await callTool('plan_modification_intent', {
    runtime: 'mock',
    instruction: 'delete selected panel',
    action: 'delete_targets'
  });
  assert.equal(blockedIntent.requires_confirmation, true);
  const blockedIntentIteration = await callTool('iterate_model', {
    intent: blockedIntent,
    runtime: 'mock',
    output_dir: path.join(repoRoot, 'output', 'test-mcp-blocked-intent-iteration'),
    validate_model: false,
    save_model: false
  });
  assert.equal(blockedIntentIteration.kind, 'model_iteration_preview');
  assert.equal(blockedIntentIteration.blocked, true);

  const blockedPython = await callTool('evaluate_py', { code: 'print("hello")', input_format: 'auto', runtime: 'mock' });
  assert.equal(blockedPython.blocked, true);
  assert.equal(blockedPython.executed, false);

  const reportDir = path.join(repoRoot, 'output', 'test-mcp-build-report');
  await fs.rm(reportDir, { recursive: true, force: true });
  const buildReport = await callTool('build_report', {
    code: apiDsl,
    runtime: 'mock',
    output_dir: reportDir,
    validate_model: false,
    includePreview: false
  });
  assert.equal(buildReport.kind, 'build_report');
  assert.equal(buildReport.summary.totals.groups, 3);
  assert.ok(buildReport.artifacts.snapshot.endsWith('snapshot.json'));
  await fs.access(buildReport.artifacts.manifest);

  const qa = await callTool('validate_model', {
    code: JSON.stringify({
      version: 1,
      units: 'mm',
      operations: [
        { op: 'reset' },
        { op: 'box', name: 'MCP_QA_Panel', origin: [0, 0, 0], size: [100, 80, 10] },
        { op: 'box', name: 'MCP_QA_Button', origin: [35, 25, 10], size: [20, 20, 5] }
      ]
    }),
    runtime: 'mock',
    includePreview: false,
    spec: {
      rules: {
        inside: [{ item: 'MCP_QA_Button', parent: 'MCP_QA_Panel', axes: ['x', 'y'], tolerance_mm: 1 }],
        support: [{ item: 'MCP_QA_Button', parent: 'MCP_QA_Panel', max_gap_mm: 1 }]
      }
    }
  });
  assert.equal(qa.kind, 'model_qa');
  assert.equal(qa.ok, true);

  const referenceQa = await callTool('validate_reference_model', {
    code: JSON.stringify({
      version: 1,
      units: 'mm',
      operations: [
        { op: 'reset' },
        { op: 'box', id: 'mcp-ref-panel', name: 'MCP_Ref_Panel', origin: [0, 0, 0], size: [100, 40, 20], qa: { part_id: 'mcp-ref-panel', role: 'panel' } }
      ]
    }),
    runtime: 'mock',
    includePreview: false,
    spec: {
      rules: {
        views: [{ name: 'front', axes: ['x', 'z'], frame: { items: ['mcp-ref-panel'] } }],
        keypoints: [{
          id: 'panel-center',
          view: 'front',
          item: 'mcp-ref-panel',
          expected: [0.5, 0.5],
          correction_target: { part_id: 'mcp-ref-panel', path: 'parts[mcp-ref-panel].shape.parameters.origin' }
        }]
      }
    }
  });
  assert.equal(referenceQa.kind, 'reference_visual_qa');
  assert.equal(referenceQa.ok, true);

  console.log(JSON.stringify({
    ok: true,
    tools: ['get_workflow_bundle', 'compile_expert', 'compile_python_sdk', 'build_expert_model', 'validate_model', 'validate_reference_model', 'queue_diagnostics', 'capture_view', 'run_ruby_expert', 'inspect_model', 'adopt_open_model', 'resolve_model_targets', 'analyze_selection_geometry', 'plan_modification_intent', 'evaluate_py', 'build_report', 'iterate_model'],
    groups: built.snapshot.totals.groups
  }, null, 2));
} finally {
  server.kill('SIGTERM');
}

async function callTool(name, args) {
  const response = await request({
    id: nextId(),
    method: 'tools/call',
    params: {
      name,
      arguments: args
    }
  });
  assert.ifError(response.error);
  const text = response.result.content[0].text;
  return JSON.parse(text);
}

function request(message) {
  const id = message.id ?? nextId();
  const payload = { jsonrpc: '2.0', ...message, id };
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for MCP response ${id}. stderr: ${stderr}`));
    }, 10000);
    resolvers.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject
    });
    server.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}

function handleResponseLine(line) {
  let response;
  try {
    response = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON-RPC response: ${line}\n${error.message}`);
  }
  const resolver = resolvers.get(response.id);
  if (!resolver) return;
  resolvers.delete(response.id);
  resolver.resolve(response);
}

function nextId() {
  idCounter += 1;
  return idCounter;
}
