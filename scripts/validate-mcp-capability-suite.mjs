#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getOperationNames } from '../src/capabilities.mjs';
import { defaultQueueDir, defaultResponseDir } from '../src/paths.mjs';
import { cleanupQueueArtifactsForPid } from '../src/queue-runtime.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(options.outputDir || 'output/mcp-capability-suite');
const timeoutMs = options.timeoutMs || 180000;
const queueRequired = options.queueRequired === true;
const requestedRuntime = options.runtime || 'mock';
if (queueRequired && requestedRuntime !== 'queue') {
  throw new Error('--queue-required is only valid together with --runtime queue');
}
if (requestedRuntime === 'queue') {
  process.stderr.write('[DANGER] --runtime queue will reset and modify the model currently open in SketchUp. Close valuable unsaved work and confirm the intended model before continuing.\n');
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

const mockSessionPath = path.join(outputDir, 'mock-session.json');
const server = spawn(process.execPath, [path.join(repoRoot, 'src/mcp-server.mjs')], {
  cwd: repoRoot,
  env: {
    ...process.env,
    ALMA_SKETCHUP_ENABLE_RUBY_EXPERT: '',
    ALMA_SKETCHUP_MOCK_SESSION_PATH: mockSessionPath
  },
  stdio: ['pipe', 'pipe', 'pipe']
});
let stopServerPromise = null;

const handleSignal = (signal) => {
  void stopServer(signal).finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
};
process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));

const resolvers = new Map();
const usedTools = new Set();
const skippedTools = new Set();
const stepResults = [];
let buffer = '';
let stderr = '';
let idCounter = 1000;

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
  const list = await request({ method: 'tools/list' }, { timeoutMs: 10000 });
  const tools = list.result.tools;
  const toolNames = tools.map((tool) => tool.name).sort();
  assert.equal(toolNames.length, 36, 'MCP server should expose the current 36-tool surface');
  for (const requiredTool of ['prepare_image_modeling_brief', 'compile_reviewed_part_graph', 'prepare_existing_model_edit', 'apply_reviewed_model_edit']) {
    assert.ok(toolNames.includes(requiredTool), `MCP server should expose ${requiredTool}`);
  }

  await runStep('get_docs', async () => {
    const docs = await callTool('get_docs', {});
    assert.ok(docs.docs.includes('iterate_model'));
    assert.ok(docs.docs.includes('Capability Baseline'));
    return { chars: docs.docs.length };
  });

  await runStep('get_workflow_bundle', async () => {
    const bundle = await callTool('get_workflow_bundle', {});
    assert.equal(bundle.kind, 'sketchup_mcp_workflow_bundle');
    assert.ok(bundle.workflows.iterator.steps.some((step) => step.tool === 'iterate_model'));
    return { version: bundle.version, workflows: Object.keys(bundle.workflows).length };
  });

  await runStep('queue_diagnostics', async () => {
    const diagnostics = await callTool('queue_diagnostics', { includeFiles: true, timeoutMs: 5000 });
    assert.equal(diagnostics.kind, 'queue_diagnostics');
    return {
      pending: diagnostics.queue?.count,
      responses: diagnostics.responses?.count,
      lock_present: diagnostics.lock?.present
    };
  });

  await runStep('prepare_image_modeling_brief:blocked', async () => {
    const prepared = await callTool('prepare_image_modeling_brief', {
      input_dir: path.join(outputDir, 'missing-image-input'),
      output_dir: path.join(outputDir, 'image-brief-blocked')
    });
    assert.equal(prepared.blocked, true);
    assert.equal(prepared.compile_allowed, false);
    assert.ok(prepared.blockers.includes('missing_asset_set_artifact'));
    await fs.access(prepared.artifacts.gate_report);
    return { blocked: true, blockers: prepared.blockers };
  }, { tool: 'prepare_image_modeling_brief' });

  await runStep('compile_reviewed_part_graph:blocked', async () => {
    const missingDir = path.join(outputDir, 'missing-image-input');
    const compiled = await callTool('compile_reviewed_part_graph', {
      mcp_brief_path: path.join(missingDir, 'mcp-modeling-brief.json'),
      promotion_review_path: path.join(missingDir, 'candidate-promotion-review.json'),
      part_graph_path: path.join(missingDir, 'part-graph.json'),
      profile_path: path.join(missingDir, 'product-profile.json'),
      output_dir: path.join(outputDir, 'image-compile-blocked')
    });
    assert.equal(compiled.blocked, true);
    assert.equal(compiled.preview_only, true);
    assert.equal(compiled.queue_called, false);
    assert.equal(compiled.artifacts.safe_json_dsl_preview, undefined);
    await fs.access(compiled.artifacts.gate_report);
    return { blocked: true, preview_only: true, queue_called: false };
  }, { tool: 'compile_reviewed_part_graph' });

  await runStep('get_capabilities:mock', async () => {
    const capabilities = await callTool('get_capabilities', { runtime: 'mock' });
    assert.equal(capabilities.runtime.name, 'mock');
    assert.equal(capabilities.runtime.supported_operations.length, getOperationNames().length);
    return {
      operations: capabilities.runtime.supported_operations.length,
      component_scope: Object.values(capabilities.runtime.operation_support || {}).filter((item) => item.component_scope?.status === 'supported').length
    };
  }, { tool: 'get_capabilities' });

  const baseCode = JSON.stringify(baseModelDsl());
  let baseSnapshot;
  let adoptedModel;
  let existingEditPlan;
  await runStep('reset_model:mock', async () => {
    const reset = await callTool('reset_model', { runtime: 'mock' });
    assert.equal(reset.snapshot.totals.groups, 0);
    return { groups: 0 };
  });

  await runStep('build_model:mock', async () => {
    const built = await callTool('build_model', { code: baseCode, runtime: 'mock' });
    baseSnapshot = built.snapshot;
    assert.ok(baseSnapshot.totals.groups >= 17, `groups=${baseSnapshot.totals.groups}`);
    assert.equal(baseSnapshot.warning_summary.total, 0, JSON.stringify(baseSnapshot.warnings, null, 2));
    return {
      groups: baseSnapshot.totals.groups,
      faces: baseSnapshot.totals.faces,
      operations_in_fixture: JSON.parse(baseCode).operations.length
    };
  });

  await runStep('get_model_info', async () => {
    const info = await callTool('get_model_info', { runtime: 'mock' });
    assert.equal(info.kind, 'model_info');
    assert.equal(info.totals.groups, baseSnapshot.totals.groups);
    return { groups: info.totals.groups, materials: info.counts.materials };
  });

  await runStep('list_entities', async () => {
    const listed = await callTool('list_entities', { runtime: 'mock', kind: 'box' });
    assert.ok(listed.entities.some((item) => item.id === 'suite-base-panel'));
    return { box_entities: listed.entities.length };
  });

  await runStep('inspect_model', async () => {
    const inspected = await callTool('inspect_model', { runtime: 'mock', includeSnapshot: true });
    assert.equal(inspected.kind, 'inspect_model');
    assert.equal(inspected.snapshot.totals.groups, baseSnapshot.totals.groups);
    return { entities: inspected.entities.length, snapshot_groups: inspected.snapshot.totals.groups };
  });

  await runStep('adopt_open_model', async () => {
    const adopted = await callTool('adopt_open_model', { runtime: 'mock', recursive: true, prefix: 'suite' });
    adoptedModel = adopted;
    assert.equal(adopted.kind, 'adopt_open_model');
    assert.ok(adopted.existing_count >= 1);
    assert.ok(Array.isArray(adopted.recursive_index));
    return { existing: adopted.existing_count, nested: adopted.recursive_index.length };
  });

  await runStep('prepare_existing_model_edit', async () => {
    const target = adoptedModel.recursive_index.find((entry) => entry.entity_type === 'face');
    assert.ok(target?.entity_path);
    const prepared = await callTool('prepare_existing_model_edit', {
      runtime: 'mock',
      instruction: 'Hide one reviewed existing-model face.',
      targets: [{ entity_path: target.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' }],
      operations: [{ op: 'set_visibility', entity_path: target.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide', visible: false }],
      output_dir: path.join(outputDir, 'existing-edit-prepare')
    });
    assert.equal(prepared.plan.compile_permission, 'ready_for_review');
    existingEditPlan = prepared.plan;
    return { plan_id: prepared.plan.plan_id, risk: prepared.plan.risk_level };
  });

  await runStep('apply_reviewed_model_edit', async () => {
    const applied = await callTool('apply_reviewed_model_edit', {
      runtime: 'mock',
      plan: existingEditPlan,
      review: { status: 'approved', plan_id: existingEditPlan.plan_id, reviewer: 'mcp-capability-suite' },
      output_dir: path.join(outputDir, 'existing-edit-apply'),
      save_model: false
    });
    assert.equal(applied.ok, true);
    await fs.access(applied.artifacts.review);
    return { plan_id: applied.plan_id, risk: applied.risk_level };
  });

  await runStep('resolve_model_targets', async () => {
    const resolved = await callTool('resolve_model_targets', {
      runtime: 'mock',
      targets: ['suite-base-panel']
    });
    assert.equal(resolved.kind, 'target_resolution');
    assert.equal(resolved.ok, true);
    assert.equal(resolved.selected_targets[0].id, 'suite-base-panel');
    return { selected: resolved.selected_targets.map((target) => target.id) };
  });

  await runStep('set_selection', async () => {
    const selected = await callTool('set_selection', { runtime: 'mock', targets: ['suite-base-panel', 'suite-component-instance'] });
    assert.equal(selected.selection.length, 2);
    return { selected: selected.selection.map((item) => item.id) };
  });

  await runStep('get_selection', async () => {
    const selected = await callTool('get_selection', { runtime: 'mock' });
    assert.equal(selected.selection.length, 2);
    return { selected: selected.selection.length };
  });

  await runStep('analyze_selection_geometry', async () => {
    const analysis = await callTool('analyze_selection_geometry', {
      runtime: 'mock',
      includeDetails: false
    });
    assert.equal(analysis.kind, 'selection_geometry_analysis');
    assert.equal(analysis.entities.length, 2);
    return { entities: analysis.entities.length, uncertainties: analysis.uncertainties.length };
  });

  await runStep('plan_modification_intent', async () => {
    await callTool('set_selection', { runtime: 'mock', targets: ['suite-base-panel'] });
    const intent = await callTool('plan_modification_intent', {
      runtime: 'mock',
      instruction: 'mark the selected suite entities as reviewed',
      action: 'set_attribute',
      parameters: { dictionary: 'CapabilitySuite', key: 'reviewed', value: true },
      output_dir: path.join(outputDir, 'modification-intent')
    });
    assert.equal(intent.kind, 'modification_intent');
    assert.equal(intent.safe_to_execute, true);
    assert.equal(intent.requires_confirmation, false);
    assert.equal(intent.patch.operations[0].op, 'attribute');
    await fs.access(intent.artifacts.intent_manifest);
    return { safe_to_execute: true, patch_operations: intent.patch.operations.length };
  });

  let savedModel;
  await runStep('save_model', async () => {
    savedModel = await callTool('save_model', {
      runtime: 'mock',
      path: path.join(outputDir, 'mock-model.json')
    });
    assert.ok(savedModel.file_size_bytes > 0);
    await fs.access(savedModel.file_path);
    return { path: savedModel.file_path, bytes: savedModel.file_size_bytes };
  });

  let versionedModel;
  await runStep('save_model_version', async () => {
    versionedModel = await callTool('save_model_version', {
      runtime: 'mock',
      path: path.join(outputDir, 'mock-model-version.json'),
      label: 'suite'
    });
    assert.ok(versionedModel.file_path.endsWith('mock-model-version-suite.json'));
    await fs.access(versionedModel.file_path);
    return { path: versionedModel.file_path, bytes: versionedModel.file_size_bytes };
  });

  await runStep('open_model', async () => {
    const opened = await callTool('open_model', { runtime: 'mock', path: versionedModel.file_path });
    assert.equal(opened.kind, 'open_model');
    assert.equal(opened.snapshot.totals.groups, baseSnapshot.totals.groups);
    return { groups: opened.snapshot.totals.groups };
  });

  let exportedModel;
  await runStep('export_model', async () => {
    exportedModel = await callTool('export_model', {
      runtime: 'mock',
      path: path.join(outputDir, 'mock-export.json'),
      format: 'json'
    });
    assert.equal(exportedModel.kind, 'export_model');
    await fs.access(exportedModel.file_path);
    return { path: exportedModel.file_path, bytes: exportedModel.file_size_bytes };
  });

  await runStep('import_model', async () => {
    const imported = await callTool('import_model', {
      runtime: 'mock',
      path: exportedModel.file_path,
      mode: 'append',
      prefix: 'SuiteImported'
    });
    assert.ok(imported.snapshot.totals.groups > baseSnapshot.totals.groups);
    return { groups_after_append: imported.snapshot.totals.groups };
  });

  const expertSource = [
    'const ops = [];',
    'ops.push({ op: "reset" });',
    'ops.push({ op: "material", name: "Suite_Expert_Mat", color: "#4466aa" });',
    'ops.push({ op: "box", id: "suite-expert-box", name: "Suite_Expert_Box", origin: [0, 0, 0], size: [24, 18, 12], material: "Suite_Expert_Mat" });',
    'dsl(ops);'
  ].join('\n');

  await runStep('compile_expert', async () => {
    const compiled = await callTool('compile_expert', { code: expertSource, seed: 7 });
    assert.equal(compiled.expert.operations, 3);
    return { operations: compiled.expert.operations };
  });

  await runStep('build_expert_model', async () => {
    const built = await callTool('build_expert_model', { code: expertSource, seed: 7, runtime: 'mock' });
    assert.equal(built.snapshot.totals.groups, 1);
    assert.equal(built.snapshot.groups[0].id, 'suite-expert-box');
    return { groups: built.snapshot.totals.groups };
  });

  const pythonSource = await fs.readFile(path.join(repoRoot, 'examples/python-sdk-official-api-expression-r3-fixture.py'), 'utf8');
  await runStep('compile_python_sdk', async () => {
    const compiled = await callTool('compile_python_sdk', { code: pythonSource, pythonTimeoutMs: 20000 });
    assert.equal(compiled.python_sdk.operations, 12);
    return { operations: compiled.python_sdk.operations, result_keys: Object.keys(compiled.result || {}).length };
  });

  await runStep('evaluate_py:python_sdk', async () => {
    const evaluated = await callTool('evaluate_py', {
      code: pythonSource,
      input_format: 'python_sdk',
      runtime: 'mock',
      pythonTimeoutMs: 20000
    });
    assert.equal(evaluated.compatibility_mode, 'python_sdk_facade_compiler');
    assert.equal(evaluated.snapshot.warning_summary.total, 0);
    return { groups: evaluated.snapshot.totals.groups, faces: evaluated.snapshot.totals.faces };
  }, { tool: 'evaluate_py' });

  await runStep('evaluate_py:json_dsl', async () => {
    const evaluated = await callTool('evaluate_py', { code: baseCode, input_format: 'json_dsl', runtime: 'mock' });
    assert.equal(evaluated.compatibility_mode, 'safe_json_dsl');
    assert.equal(evaluated.snapshot.warning_summary.total, 0);
    baseSnapshot = evaluated.snapshot;
    return { groups: evaluated.snapshot.totals.groups, faces: evaluated.snapshot.totals.faces };
  }, { tool: 'evaluate_py' });

  let buildReport;
  await runStep('build_report', async () => {
    buildReport = await callTool('build_report', {
      runtime: 'mock',
      output_dir: path.join(outputDir, 'build-report'),
      validate_model: true,
      includePreview: false
    });
    assert.equal(buildReport.kind, 'build_report');
    assert.ok(buildReport.summary.model_qa.ok);
    await fs.access(buildReport.artifacts.manifest);
    return { groups: buildReport.summary.totals.groups, manifest: buildReport.artifacts.manifest };
  });

  let iteration;
  await runStep('iterate_model', async () => {
    iteration = await callTool('iterate_model', {
      code: JSON.stringify(iterationPatchDsl()),
      input_format: 'json_dsl',
      runtime: 'mock',
      output_dir: path.join(outputDir, 'iteration'),
      label: 'suite',
      targets: ['suite-base-panel'],
      validate_model: true,
      includePreview: false
    });
    assert.equal(iteration.kind, 'model_iteration');
    assert.equal(iteration.change_summary.totals_delta.groups, 1);
    assert.ok(iteration.change_summary.added.some((item) => item.id === 'suite-iteration-addon'));
    assert.ok(iteration.model_qa.ok);
    await fs.access(iteration.artifacts.manifest);
    return {
      before_groups: iteration.before.model_info.totals.groups,
      after_groups: iteration.after.model_info.totals.groups,
      manifest: iteration.artifacts.manifest
    };
  });

  await runStep('compare_snapshots', async () => {
    const compared = await callTool('compare_snapshots', {
      expected: iteration.after.model_info ? await readJson(iteration.artifacts.after_snapshot) : baseSnapshot,
      actual: await readJson(iteration.artifacts.after_snapshot),
      toleranceMm: 0.1
    });
    assert.equal(compared.ok, true);
    return { verdict: compared.verdict, diffs: compared.summary.total };
  });

  await runStep('compare_model', async () => {
    const compared = await callTool('compare_model', {
      code: baseCode,
      expected_runtime: 'mock',
      actual_runtime: 'mock',
      include_snapshots: false
    });
    assert.equal(compared.report.ok, true);
    return { verdict: compared.report.verdict };
  });

  await runStep('validate_model', async () => {
    const qa = await callTool('validate_model', {
      code: JSON.stringify(layoutQaDsl()),
      runtime: 'mock',
      includePreview: false,
      spec: {
        rules: {
          inside: [{ item: 'Suite_QA_Button', parent: 'Suite_QA_Base', axes: ['x', 'y'], tolerance_mm: 1 }],
          support: [{ item: 'Suite_QA_Button', parent: 'Suite_QA_Base', max_gap_mm: 1 }]
        }
      }
    });
    assert.equal(qa.kind, 'model_qa');
    assert.equal(qa.ok, true);
    return { verdict: qa.verdict, issues: qa.issues.length };
  });

  await runStep('validate_reference_model', async () => {
    const qa = await callTool('validate_reference_model', {
      code: JSON.stringify(referenceQaDsl()),
      runtime: 'mock',
      includePreview: false,
      spec: {
        rules: {
          views: [{ name: 'front', axes: ['x', 'z'], frame: { items: ['suite-ref-panel'] } }],
          keypoints: [{
            id: 'suite-ref-panel-center',
            view: 'front',
            item: 'suite-ref-panel',
            expected: [0.5, 0.5],
            correction_target: { part_id: 'suite-ref-panel', path: 'parts[suite-ref-panel].shape.parameters.origin' }
          }]
        }
      }
    });
    assert.equal(qa.kind, 'reference_visual_qa');
    assert.equal(qa.ok, true);
    return { verdict: qa.verdict, issues: qa.issues.length };
  });

  await runStep('run_ruby_expert:block', async () => {
    const blocked = await callTool('run_ruby_expert', { code: 'Sketchup.active_model.title', runtime: 'queue', timeoutMs: 10000 });
    assert.equal(blocked.kind, 'run_ruby_expert');
    assert.equal(blocked.blocked, true);
    return { blocked: true, enabled: blocked.enabled };
  }, { tool: 'run_ruby_expert' });

  const queue = await maybeRunQueueSuite(baseCode);
  const expectedTools = new Set(toolNames);
  const missingTools = [...expectedTools].filter((tool) => !usedTools.has(tool) && !skippedTools.has(tool));
  const ok = missingTools.length === 0 && (!queueRequired || queue.ok === true);
  const report = {
    kind: 'mcp_capability_suite_report',
    ok,
    mode: requestedRuntime,
    output_dir: outputDir,
    tools: {
      exposed: toolNames,
      used: [...usedTools].sort(),
      skipped: [...skippedTools].sort(),
      missing: missingTools,
      count: toolNames.length
    },
    dsl_operations: {
      registered: getOperationNames().length,
      fixture_operations: JSON.parse(baseCode).operations.length
    },
    queue,
    steps: stepResults
  };

  await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'report.md'), renderMarkdownReport(report), 'utf8');
  if (!ok) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await stopServer('SIGTERM');
}

async function maybeRunQueueSuite(baseCode) {
  if (requestedRuntime === 'mock') {
    recordSkipped('capture_view', 'queue runtime not requested');
    return { ok: null, skipped: true, reason: 'queue runtime not requested' };
  }

  const queue = {
    ok: false,
    skipped: false,
    reason: null,
    capabilities: null,
    artifacts: {}
  };
  try {
    await runStep('get_capabilities:queue', async () => {
      const capabilities = await callTool('get_capabilities', { runtime: 'queue', timeoutMs });
      assert.equal(capabilities.runtime.name, 'queue');
      queue.capabilities = {
        plugin: capabilities.runtime.plugin,
        compatibility: capabilities.runtime.compatibility,
        operations: capabilities.runtime.supported_operations?.length
      };
      return queue.capabilities;
    }, { tool: 'get_capabilities' });
  } catch (error) {
    queue.reason = error.message;
    if (queueRequired) throw error;
    recordSkipped('capture_view', `queue unavailable: ${error.message}`);
    queue.skipped = true;
    return queue;
  }

  await runStep('reset_model:queue', async () => {
    const reset = await callTool('reset_model', { runtime: 'queue', timeoutMs });
    assert.equal(reset.snapshot.totals.groups, 0);
    return { groups: 0 };
  }, { tool: 'reset_model' });

  await runStep('build_model:queue', async () => {
    const built = await callTool('build_model', { code: baseCode, runtime: 'queue', timeoutMs });
    assert.ok(built.snapshot.totals.groups >= 17);
    assert.equal(built.snapshot.warning_summary.total, 0);
    return { groups: built.snapshot.totals.groups, faces: built.snapshot.totals.faces };
  }, { tool: 'build_model' });

  await runStep('build_report:queue', async () => {
    const report = await callTool('build_report', {
      runtime: 'queue',
      output_dir: path.join(outputDir, 'queue-build-report'),
      capture_view: true,
      validate_model: true,
      includePreview: false,
      timeoutMs
    });
    assert.equal(report.kind, 'build_report');
    assert.ok(report.saved_model.file_path.endsWith('.skp'));
    queue.artifacts.build_report = report.artifacts.manifest;
    queue.artifacts.skp = report.saved_model.file_path;
    queue.artifacts.capture = report.capture?.file_path;
    return { skp: report.saved_model.file_path, capture: report.capture?.file_path };
  }, { tool: 'build_report' });

  await runStep('capture_view:queue', async () => {
    const capture = await callTool('capture_view', {
      runtime: 'queue',
      path: path.join(outputDir, 'queue-iso.png'),
      view: 'iso',
      width: 1280,
      height: 720,
      timeoutMs
    });
    assert.ok(capture.file_path.endsWith('.png'));
    queue.artifacts.iso_capture = capture.file_path;
    return { path: capture.file_path, bytes: capture.file_size_bytes };
  }, { tool: 'capture_view' });

  await runStep('iterate_model:queue', async () => {
    const iteration = await callTool('iterate_model', {
      code: JSON.stringify(iterationPatchDsl({ id: 'suite-queue-iteration-addon', name: 'Suite_Queue_Iteration_Addon', origin: [420, 0, 0] })),
      input_format: 'json_dsl',
      runtime: 'queue',
      output_dir: path.join(outputDir, 'queue-iteration'),
      label: 'queue-suite',
      capture_view: true,
      validate_model: true,
      includePreview: false,
      timeoutMs
    });
    assert.equal(iteration.kind, 'model_iteration');
    assert.equal(iteration.change_summary.totals_delta.groups, 1);
    queue.artifacts.iteration_manifest = iteration.artifacts.manifest;
    queue.artifacts.iteration_model = iteration.saved_model.file_path;
    return { manifest: iteration.artifacts.manifest, model: iteration.saved_model.file_path };
  }, { tool: 'iterate_model' });

  queue.ok = true;
  return queue;
}

async function runStep(name, callback, { tool = name.split(':')[0] } = {}) {
  const startedAt = Date.now();
  try {
    const result = await callback();
    usedTools.add(tool);
    stepResults.push({ name, tool, ok: true, duration_ms: Date.now() - startedAt, result });
    return result;
  } catch (error) {
    stepResults.push({ name, tool, ok: false, duration_ms: Date.now() - startedAt, error: error.message });
    throw error;
  }
}

function recordSkipped(tool, reason) {
  skippedTools.add(tool);
  stepResults.push({ name: `${tool}:skipped`, tool, ok: null, skipped: true, reason });
}

async function callTool(name, args) {
  const response = await request({
    method: 'tools/call',
    params: {
      name,
      arguments: args
    }
  }, { timeoutMs: Math.max(timeoutMs + 5000, 15000) });
  if (response.error) throw new Error(response.error.message);
  usedTools.add(name);
  return JSON.parse(response.result.content[0].text);
}

function request(message, { timeoutMs: requestTimeoutMs = 15000 } = {}) {
  const id = message.id ?? nextId();
  const payload = { jsonrpc: '2.0', ...message, id };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for MCP response ${id}. stderr: ${stderr}`));
    }, requestTimeoutMs);
    resolvers.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
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

function baseModelDsl() {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Suite_Base', color: '#d8dde2' },
      { op: 'material', name: 'Suite_Accent', color: '#2f80ed' },
      { op: 'material', name: 'Suite_Glass', color: '#88ccee', alpha: 0.45 },
      { op: 'tag', name: 'Suite_Test_Tag', color: '#336699', visible: true },
      { op: 'image_reference', name: 'Suite_Ref_Image', path: '/tmp/suite-ref.png', width: 200, height: 100, role: 'reference' },
      { op: 'box', id: 'suite-base-panel', name: 'Suite_Base_Panel', origin: [0, 0, 0], size: [120, 80, 10], material: 'Suite_Base' },
      { op: 'assign_tag', target_id: 'suite-base-panel', tag: 'Suite_Test_Tag' },
      { op: 'attribute', target_id: 'suite-base-panel', dictionary: 'Suite', attributes: { role: 'base', revision: 1 } },
      { op: 'classification', target_id: 'suite-base-panel', system: 'SuiteIFC', type: 'IfcProxy', identifier: 'SUITE-BASE' },
      { op: 'texture_transform', target_id: 'suite-base-panel', projection: 'box', offset: [2, 4], scale: [1, 1], rotation: 0, material: 'Suite_Base' },
      { op: 'geometry_input', id: 'suite-geometry-panel', name: 'Suite_Geometry_Panel', vertices: [[0, 100, 0], [100, 100, 0], [100, 150, 0], [0, 150, 0]], faces: [[0, 1, 2, 3]], material: 'Suite_Accent' },
      { op: 'face_uv', target_id: 'suite-geometry-panel', uv_id: 'front', uv: [[0, 0], [1, 0], [1, 1], [0, 1]], image_reference: 'Suite_Ref_Image' },
      { op: 'curve', id: 'suite-curve', name: 'Suite_Curve', points: [[0, 170, 10], [50, 190, 10], [100, 170, 10]] },
      { op: 'arc_curve', id: 'suite-arc', name: 'Suite_Arc', center: [140, 150, 15], radius: 25, start_angle: 0, end_angle: 120, segments: 6 },
      { op: 'mesh', id: 'suite-mesh', name: 'Suite_Tetra_Mesh', vertices: [[150, 0, 0], [190, 0, 0], [170, 40, 0], [170, 18, 35]], faces: [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]], material: 'Suite_Accent', smooth: 'all' },
      { op: 'rounded_box', name: 'Suite_Rounded_Box', origin: [150, 60, 0], size: [60, 40, 16], radius: 8, segments: 4, material: 'Suite_Base', smooth: 'all' },
      { op: 'beveled_panel', name: 'Suite_Beveled_Panel', origin: [220, 0, 0], size: [70, 42, 8], bevel: 6, material: 'Suite_Base' },
      { op: 'recess', name: 'Suite_Recess', center: [250, 80, 14], size: [48, 24], depth: 4, radius: 6, segments: 4, material: 'Suite_Accent' },
      { op: 'engraved_line', name: 'Suite_Engraved_Line', points: [[220, 120, 12], [280, 120, 12]], width: 3, depth: 1, material: 'Suite_Accent' },
      { op: 'slot', name: 'Suite_Slot', center: [330, 20, 12], length: 52, width: 10, depth: 3, segments: 4, material: 'Suite_Accent' },
      { op: 'button_on_panel', name: 'Suite_Button', center: [340, 80, 14], radius: 12, height: 5, segments: 12, material: 'Suite_Accent' },
      { op: 'wall', name: 'Suite_Wall', start: [0, 230, 0], end: [160, 230, 0], height: 80, thickness: 12, openings: [{ name: 'Suite_Wall_Window', x: 55, y: 28, width: 40, height: 24 }], material: 'Suite_Base' },
      { op: 'curtain_wall', name: 'Suite_Curtain_Wall', start: [190, 230, 0], end: [310, 230, 0], height: 80, module_width: 40, row_count: 2, mullion_width: 5, thickness: 8, panel_thickness: 3, frame_material: 'Suite_Base', panel_material: 'Suite_Glass' },
      { op: 'floor_slab', name: 'Suite_Floor_Slab', origin: [0, 330, 0], width: 120, depth: 80, thickness: 8, material: 'Suite_Base' },
      { op: 'stairs', name: 'Suite_Stairs', origin: [150, 330, 0], steps: 3, width: 80, tread_depth: 24, riser_height: 8, direction: 'y', material: 'Suite_Base' },
      { op: 'component_definition', name: 'Suite_Component_Def', operations: [
        { op: 'box', id: 'suite-component-part', name: 'Suite_Component_Part', origin: [0, 0, 0], size: [18, 18, 18], material: 'Suite_Accent' },
        { op: 'text_3d', name: 'Suite_Component_Label', center: [9, 9, 20], text: 'S', height: 6, extrusion: 1, material: 'Suite_Base' }
      ] },
      { op: 'component_instance', id: 'suite-component-instance', name: 'Suite_Component_Instance', definition: 'Suite_Component_Def', origin: [430, 0, 0], transform: { rotateZ: 15 } },
      { op: 'camera', eye: [420, -420, 260], target: [160, 160, 40], up: [0, 0, 1], fov: 35 },
      { op: 'scene', name: 'Suite_Iso', camera: { eye: [420, -420, 260], target: [160, 160, 40], up: [0, 0, 1], fov: 35 }, transition_time: 1.2 },
      { op: 'style', name: 'Suite_Style', display_edges: true, profiles: true, profile_width: 2, face_style: 'shaded_with_textures', background_color: '#f7f7f2' },
      { op: 'shadow', display: true, time: '2026-07-02T14:30:00+08:00', light: 70, dark: 35, use_sun_for_shading: true },
      { op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, transparency: true },
      { op: 'selection', mode: 'replace', targets: ['suite-base-panel'] }
    ]
  };
}

function iterationPatchDsl({ id = 'suite-iteration-addon', name = 'Suite_Iteration_Addon', origin = [390, 70, 0] } = {}) {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'material', name: 'Suite_Iteration_Mat', color: '#dd8844' },
      { op: 'box', id, name, origin, size: [32, 24, 18], material: 'Suite_Iteration_Mat' }
    ]
  };
}

function layoutQaDsl() {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'suite-qa-base', name: 'Suite_QA_Base', origin: [0, 0, 0], size: [100, 80, 10] },
      { op: 'box', id: 'suite-qa-button', name: 'Suite_QA_Button', origin: [35, 25, 10], size: [20, 20, 5] }
    ]
  };
}

function referenceQaDsl() {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'suite-ref-panel', name: 'Suite_Ref_Panel', origin: [0, 0, 0], size: [100, 40, 20], qa: { part_id: 'suite-ref-panel', role: 'panel' } }
    ]
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function renderMarkdownReport(report) {
  const lines = [
    '# MCP Capability Suite',
    '',
    `- Verdict: ${report.ok ? 'pass' : 'partial/fail'}`,
    `- Tools used: ${report.tools.used.length}/${report.tools.count}`,
    `- Registered DSL operations: ${report.dsl_operations.registered}`,
    `- Fixture operations: ${report.dsl_operations.fixture_operations}`,
    `- Queue: ${report.queue.ok === true ? 'pass' : report.queue.skipped ? `skipped - ${report.queue.reason}` : 'not run'}`,
    '',
    '## Steps',
    '',
    '| Step | Tool | Result | Detail |',
    '|---|---|---|---|'
  ];
  for (const step of report.steps) {
    const result = step.skipped ? 'skipped' : step.ok ? 'pass' : 'fail';
    const detail = step.error || step.reason || JSON.stringify(step.result || {});
    lines.push(`| ${step.name} | ${step.tool} | ${result} | ${detail.replace(/\|/g, '\\|')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') parsed.runtime = argv[++index];
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(argv[++index]);
    else if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--queue-required') parsed.queueRequired = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.runtime && !['mock', 'queue'].includes(parsed.runtime)) {
    throw new Error('--runtime must be mock or queue');
  }
  return parsed;
}

function stopServer(signal = 'SIGTERM') {
  if (stopServerPromise) return stopServerPromise;
  stopServerPromise = (async () => {
    const childPid = server.pid;
    if (server.exitCode === null && !server.killed) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill(signal);
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
    if (childPid) {
      await cleanupQueueArtifactsForPid(childPid, {
        queueDir: defaultQueueDir,
        responseDir: defaultResponseDir
      });
    }
  })();
  return stopServerPromise;
}
