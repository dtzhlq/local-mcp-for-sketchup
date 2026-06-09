import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn(process.execPath, [path.join(repoRoot, 'src/mcp-server.mjs')], {
  cwd: repoRoot,
  env: { ...process.env, ALMA_SKETCHUP_ENABLE_RUBY_EXPERT: '' },
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
  const list = await request({ id: 1, method: 'tools/list' });
  const toolNames = list.result.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes('get_workflow_bundle'), 'MCP tools/list should expose get_workflow_bundle');
  assert.ok(toolNames.includes('compile_expert'), 'MCP tools/list should expose compile_expert');
  assert.ok(toolNames.includes('build_expert_model'), 'MCP tools/list should expose build_expert_model');
  assert.ok(toolNames.includes('validate_model'), 'MCP tools/list should expose validate_model');
  assert.ok(toolNames.includes('validate_reference_model'), 'MCP tools/list should expose validate_reference_model');
  assert.ok(toolNames.includes('queue_diagnostics'), 'MCP tools/list should expose queue_diagnostics');
  assert.ok(toolNames.includes('capture_view'), 'MCP tools/list should expose capture_view');
  assert.ok(toolNames.includes('run_ruby_expert'), 'MCP tools/list should expose run_ruby_expert');
  const compileTool = list.result.tools.find((tool) => tool.name === 'compile_expert');
  assert.deepEqual(compileTool.inputSchema.required, ['code']);
  assert.ok(compileTool.inputSchema.properties.maxOperations);
  const rubyExpertTool = list.result.tools.find((tool) => tool.name === 'run_ruby_expert');
  assert.deepEqual(rubyExpertTool.inputSchema.required, ['code']);
  assert.equal(rubyExpertTool.inputSchema.properties.runtime.enum[0], 'queue');

  const workflowBundle = await callTool('get_workflow_bundle', {});
  assert.equal(workflowBundle.kind, 'sketchup_mcp_workflow_bundle');
  assert.ok(workflowBundle.workflows.inspector.steps.some((step) => step.tool === 'queue_diagnostics'));
  assert.ok(workflowBundle.workflows.modeler.steps.some((step) => step.tool === 'capture_view'));

  const blockedRubyExpert = await callTool('run_ruby_expert', { code: 'Sketchup.active_model.title' });
  assert.equal(blockedRubyExpert.kind, 'run_ruby_expert');
  assert.equal(blockedRubyExpert.enabled, false);
  assert.equal(blockedRubyExpert.blocked, true);

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
    tools: ['get_workflow_bundle', 'compile_expert', 'build_expert_model', 'validate_model', 'validate_reference_model', 'queue_diagnostics', 'capture_view', 'run_ruby_expert'],
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
    }, 5000);
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
