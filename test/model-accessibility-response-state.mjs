import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { presentAgentResultEnvelope } from '../src/agent-response-projection.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-response-state-'));
try {
  const bridge = new SketchUpBridge({ agentContract: { rootDir: root } });
  const created = await bridge.start_agent_task({ intent: 'discover', instruction: 'Inspect the public contract.' });
  const task = await bridge.taskStore.getTask(created.task_id, { includePrivate: true });
  for (const kind of ['window', 'door', 'cabinet', 'sink_counter', 'asset_placement']) {
    const contract = await bridge.start_agent_task({ intent: 'discover', instruction: 'Read the selected parameter contract.', inputs: { topic: 'tasks', kind, detail: 'parameters', ...(kind === 'asset_placement' ? { asset_id: 'detail-reading_chair' } : {}) } });
    assert.ok(JSON.stringify(contract).length <= 4096);
    assert.ok(contract.result.parameter_rules.width_mm, 'Numeric ranges must be inline, without required artifact pagination');
    assert.match(contract.result.next_step, /preflight/i);
  }
  const catalogFile = path.join(root, 'catalog.json');
  const assets = [];
  for (const [name, width] of [['chair', 726], ['stool', 440], ['armchair', 886]]) {
    const file = path.join(root, `${name}.skp`);
    await fs.writeFile(file, 'test catalog bytes, not native geometry');
    assets.push({ id: `local-${name}`, name, kind: 'skp_component', path: file,
      default_dimensions_mm: { width, depth: 440, height: 900 },
      axes: { units: 'mm', up: '+Z', origin_mm: [0, 0, 0], dimension_axes: { width: '+X', depth: '+Y', height: '+Z' } },
      source: 'Project-authored constructive furniture source', license: 'project source terms',
      dimensions_evidence: { source: 'host_recorded_native_component_bounds', native_verified: false } });
  }
  await fs.writeFile(catalogFile, JSON.stringify({ version: 1, assets }));
  const catalogBridge = new SketchUpBridge({ assetCatalogPath: catalogFile, agentContract: { rootDir: path.join(root, 'catalog-state') } });
  const catalog = await catalogBridge.start_agent_task({ intent: 'discover', instruction: 'Read all local assets.', inputs: { topic: 'assets' } });
  assert.ok(JSON.stringify(catalog).length <= 4096);
  assert.equal(catalog.result.assets.length, 3, 'All three short records must be readable without artifact paging');
  assert.equal(catalog.result.profiles.length, 1);
  for (const asset of catalog.result.assets) {
    assert.match(asset.file, /\.skp$/);
    assert.ok(asset.dimensions_mm.width <= 900);
    assert.deepEqual(catalog.result.profiles[asset.profile].axes.origin_mm, [0, 0, 0]);
    assert.equal(catalog.result.profiles[asset.profile].license, 'project source terms');
  }
  assert.equal(catalog.result.native_geometry_verified, false);
  assert.ok(catalog.result.catalog_handle, 'The requested result JSON is already saved');
  assert.equal(JSON.stringify(catalog).includes(root), false, 'Host source paths remain private');
  for (const [kind, stage, applied, unknown] of [
    ['modify_design_parameters_result', 'awaiting_review', false, false],
    ['modify_design_parameters_result', 'applied', true, false],
    ['modify_design_parameters_result', 'replacement_outcome_unknown', null, true],
    ['model_accessibility_appearance', 'review_required', false, false]
  ]) {
    const result = { kind, stage, reviewed_task_id: task.task_id, geometry_applied: applied, outcome_unknown: unknown,
      quality_accepted: false, saved: false, quality_status: 'not_evaluated', evidence_level: 'fixture_only',
      optional_validation: 'Close/reopen only on explicit user request.',
      status: { execution_status: stage, recovery_class: unknown ? 'runtime_blocked' : 'user_approval', resume: { tool: 'resume_agent_task', arguments: { task_id: task.task_id } } },
      diagnostic_detail: 'Long readback evidence. '.repeat(2000), blockers: [],
      native_readback: kind === 'model_accessibility_appearance' ? { ok: false, details: 'native result '.repeat(2000) } : undefined };
    const envelope = { kind: 'agent_result_envelope', task_id: task.task_id, task_state: 'awaiting_input', result, artifacts: [],
      next_action: { action: 'resume_agent_task', tool: 'resume_agent_task', arguments: { task_id: task.task_id } } };
    const shown = await presentAgentResultEnvelope({ envelope, task, taskStore: bridge.taskStore });
    assert.ok(JSON.stringify(shown).length <= 4096);
    assert.equal(shown.result.stage, stage);
    assert.equal(shown.result.geometry_applied, applied);
    assert.equal(shown.result.outcome_unknown, unknown);
    assert.equal(shown.result.quality_accepted, false);
    assert.equal(shown.result.saved, false);
    assert.equal(shown.result.optional_validation, result.optional_validation);
    assert.equal(shown.result.reviewed_task_id, task.task_id);
    assert.equal(shown.result.status.resume.arguments.task_id, task.task_id);
    assert.equal(shown.next_action.arguments.task_id, task.task_id);
    assert.ok(shown.presentation.full_result_artifact);
  }
  console.log('response-state: bounded parameter/appearance responses retain execution uncertainty, quality, save status and exact recovery task');
} finally { await fs.rm(root, { recursive: true, force: true }); }
