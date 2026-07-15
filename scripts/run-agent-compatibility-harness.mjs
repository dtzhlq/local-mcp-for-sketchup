#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';

export const AGENT_CAPABILITY_LEVELS = Object.freeze({
  L0: { vision: false, local_files: false, structured_output: false, context: 'short', parallel: false },
  L1: { vision: false, local_files: false, structured_output: true, context: 'standard', parallel: false },
  L2: { vision: true, local_files: true, structured_output: true, context: 'long', parallel: true }
});

export async function runAgentCompatibilityHarness({ rootDir } = {}) {
  const ownedRoot = !rootDir;
  const root = rootDir || await fs.mkdtemp(path.join(os.tmpdir(), 'alma-agent-compatibility-'));
  const levels = [];
  try {
    for (const [level, capabilities] of Object.entries(AGENT_CAPABILITY_LEVELS)) {
      levels.push(await runLevel(root, level, capabilities));
    }
    const hardGates = {
      wrong_object_automatic_execution: sum(levels, 'wrong_object_automatic_execution'),
      unauthorized_s2_s4_execution: sum(levels, 'unauthorized_s2_s4_execution'),
      duplicate_request_duplicate_modification: sum(levels, 'duplicate_request_duplicate_modification')
    };
    const report = {
      version: 'agent-compatibility-report.v1',
      kind: 'agent_compatibility_report',
      runtime: 'mock',
      brand_specific: false,
      levels,
      aggregate: {
        completion_rate: average(levels.map((item) => item.completion_rate)),
        tool_calls: sum(levels, 'tool_calls'),
        schema_errors: sum(levels, 'schema_errors'),
        invalid_retries: sum(levels, 'invalid_retries'),
        target_top_k_rate: average(levels.map((item) => item.target_top_k_rate)),
        recovery_rate: average(levels.map((item) => item.recovery_rate))
      },
      hard_gates: hardGates,
      live_queue_called: false
    };
    assert.deepEqual(hardGates, {
      wrong_object_automatic_execution: 0,
      unauthorized_s2_s4_execution: 0,
      duplicate_request_duplicate_modification: 0
    });
    const schema = JSON.parse(await fs.readFile(new URL('../schema/agent-compatibility-report-v1.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
    assert.equal(validate(report), true, JSON.stringify(validate.errors));
    return report;
  } finally {
    if (ownedRoot) await fs.rm(root, { recursive: true, force: true });
  }
}

async function runLevel(root, level, capabilities) {
  const levelRoot = path.join(root, level);
  const stateRoot = path.join(levelRoot, 'agent-state');
  const options = {
    mock: { sessionPath: path.join(levelRoot, 'session.json') },
    agentContract: { rootDir: stateRoot },
    approval: { stateDir: path.join(levelRoot, 'approvals'), secret: `compatibility-${level}-trusted-secret-at-least-32-bytes` },
    executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
  };
  let bridge = new SketchUpBridge(options);
  let toolCalls = 0;
  let schemaErrors = 0;
  let invalidRetries = 0;
  let completed = 0;
  let attempted = 0;
  let recoveries = 0;
  let recoveryAttempts = 0;
  let wrongObjectAutomaticExecution = 0;
  let unauthorizedS2S4Execution = 0;
  let duplicateRequestDuplicateModification = 0;
  let topKHits = 0;
  let topKAttempts = 0;
  const call = async (method, args) => {
    toolCalls += 1;
    return bridge[method](args);
  };
  const scenario = async (callback) => {
    attempted += 1;
    await callback();
    completed += 1;
  };

  await scenario(async () => {
    try {
      await call('start_agent_task', { intent: 'creat_model', instruction: 'Wrong enum fixture.', client_capabilities: capabilities });
      assert.fail('wrong intent enum must fail');
    } catch (error) {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      schemaErrors += 1;
    }
  });

  await scenario(async () => {
    const args = {
      intent: 'create_model', instruction: 'Create one compatibility fixture object.', client_capabilities: capabilities,
      idempotency_key: `${level}-create-once`,
      inputs: { runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
        { op: 'box', id: `${level}-created`, name: `${level}_Created`, origin: [0, 0, 0], size: [40, 30, 20] }
      ] }) }
    };
    const created = await call('start_agent_task', args);
    assert.equal(created.task_state, 'completed');
    const replay = await call('start_agent_task', args);
    assert.equal(replay.idempotent_replay, true);
    const inspected = await bridge.inspect_model({ runtime: 'mock' });
    if (inspected.entities.filter((entity) => entity.id === `${level}-created`).length !== 1) duplicateRequestDuplicateModification += 1;
  });

  await scenario(async () => {
    const understood = await call('start_agent_task', {
      intent: 'understand_model', instruction: 'Summarize the current model.', client_capabilities: capabilities, inputs: { runtime: 'mock' }
    });
    assert.equal(understood.task_state, 'completed');
    if (level === 'L0') bridge = new SketchUpBridge(options);
    const resumed = await call('resume_agent_task', { task_id: understood.task_id });
    assert.equal(resumed.task_state, 'completed');
  });

  await scenario(async () => {
    await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'reset' },
      { op: 'box', id: 'left-cabinet', name: 'Left_Cabinet', origin: [0, 0, 0], size: [900, 600, 2200] },
      { op: 'box', id: 'right-cabinet', name: 'Right_Cabinet', origin: [1200, 0, 0], size: [900, 600, 2200] }
    ] }) });
    const before = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true }));
    const ambiguous = await call('start_agent_task', {
      intent: 'propose_existing_model_edit', instruction: 'Rename the cabinet.', client_capabilities: capabilities,
      inputs: { runtime: 'mock', target_query: 'cabinet', action: 'rename', parameters: { new_name: 'Reviewed_Cabinet' }, save_model: false }
    });
    assert.equal(ambiguous.task_state, 'awaiting_input');
    topKAttempts += 1;
    if (ambiguous.data.proposal.candidates.slice(0, 2).every((candidate) => /Cabinet/.test(candidate.summary.value.name))) topKHits += 1;
    const ignored = await call('submit_agent_task_input', { task_id: ambiguous.task_id, idempotency_key: `${level}-ignored-warning`, input: { warning_acknowledged: true } });
    invalidRetries += 1;
    assert.equal(ignored.task_state, 'awaiting_input');
    const afterIgnored = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true }));
    if (afterIgnored !== before) wrongObjectAutomaticExecution += 1;
    const clarified = await call('submit_agent_task_input', {
      task_id: ambiguous.task_id, idempotency_key: `${level}-clarified-target`, input: { target_ref: ambiguous.data.proposal.candidates[0].persistent_ref }
    });
    assert.equal(clarified.task_state, 'awaiting_review', JSON.stringify(clarified, null, 2));
    assert.equal(clarified.data.proposal.execution_allowed, false);
  });

  await scenario(async () => {
    await bridge.build_model({ runtime: 'mock', code: JSON.stringify(sharedFixture()) });
    const adoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 });
    const leaf = adoption.recursive_index.find((entry) => entry.name === 'Shared_Leaf');
    const before = modelRevisionForAdoption(adoption);
    const proposal = await call('start_agent_task', {
      intent: 'propose_existing_model_edit', instruction: 'Rename only this shared leaf occurrence.', client_capabilities: capabilities,
      inputs: { runtime: 'mock', target_ref: leaf.entity_path, action: 'rename', parameters: { new_name: 'Shared_Leaf_Reviewed' }, shared_policy: 'make_unique', save_model: false }
    });
    assert.equal(proposal.task_state, 'awaiting_review');
    assert.equal(proposal.data.proposal.operation_proposal[0].instance_policy, 'make_unique');
    const after = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 }));
    if (after !== before) wrongObjectAutomaticExecution += 1;
  });

  await scenario(async () => {
    const inputDir = path.join(stateRoot, 'compatibility-images');
    await fs.mkdir(inputDir, { recursive: true });
    const reference = path.join(inputDir, 'reference.png');
    const capture = path.join(inputDir, 'capture.png');
    await Promise.all([renderImage(reference, 40), renderImage(capture, 55)]);
    await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'reset' }, { op: 'box', id: 'image-target', name: 'Image_Target', origin: [0, 0, 0], size: [80, 40, 30] }
    ] }) });
    const visual = await call('start_agent_task', {
      intent: 'reference_image_correction', instruction: 'Propose an image-driven correction.', client_capabilities: capabilities,
      inputs: {
        runtime: 'mock', reference_image_path: reference, capture_image_path: capture,
        correction_targets: [{ target_id: 'image-target' }],
        correction_operations: [{ op: 'transform_object', target_id: 'image-target', translate: [-15, 0, 0] }]
      }
    });
    assert.equal(visual.task_state, 'awaiting_review');
    assert.equal(visual.data.visual_agent_required, false);
    assert.equal(visual.data.correction_patch.execution_allowed, false);
  });

  await scenario(async () => {
    await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'reset' },
      { op: 'box', id: 'approval-target', name: 'Approval_Target', origin: [0, 0, 0], size: [100, 60, 30] },
      { op: 'box', id: 'approval-guard', name: 'Approval_Guard', origin: [200, 0, 0], size: [40, 40, 40] }
    ] }) });
    const editInputs = {
      runtime: 'mock', save_model: false, targets: [{ target_id: 'approval-target' }],
      operations: [{ op: 'rename', target_id: 'approval-target', new_name: 'Approval_Target_Reviewed' }]
    };
    const forgedTask = await call('start_agent_task', {
      intent: 'reviewed_existing_model_edit', instruction: 'Rename the reviewed target.', client_capabilities: capabilities, inputs: editInputs
    });
    const forged = await call('submit_agent_task_input', {
      task_id: forgedTask.task_id, input: { review: { status: 'approved', reviewer: 'ordinary-agent', plan_id: forgedTask.data.plan_id } }
    });
    assert.equal(forged.error.code, 'APPROVAL_REQUIRED');
    const afterForge = await bridge.inspect_model({ runtime: 'mock' });
    if (afterForge.entities.some((entity) => entity.name === 'Approval_Target_Reviewed')) unauthorizedS2S4Execution += 1;

    const staleTask = await call('start_agent_task', {
      intent: 'reviewed_existing_model_edit', instruction: 'Prepare a task that will become stale.', client_capabilities: capabilities, inputs: editInputs
    });
    await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'attribute', target_id: 'approval-guard', dictionary: 'Compatibility', key: 'external_change', value: true }
    ] }) });
    const staleToken = await bridge.approvalAuthority.approveChallengeFromTrustedUser(
      staleTask.data.approval_challenge,
      { user_id: `${level}-human`, channel: 'compatibility-trusted-user-fixture', confirmed: true }
    );
    recoveryAttempts += 1;
    const stale = await call('submit_agent_task_input', { task_id: staleTask.task_id, input: { approval_token: staleToken } });
    assert.equal(stale.error.code, 'MODEL_REVISION_MISMATCH');

    const recoveredTask = await call('start_agent_task', {
      intent: 'reviewed_existing_model_edit', instruction: 'Prepare a fresh reviewed task after stale recovery.', client_capabilities: capabilities,
      idempotency_key: `${level}-fresh-approved-task`, inputs: editInputs
    });
    const approvedToken = await bridge.approvalAuthority.approveChallengeFromTrustedUser(
      recoveredTask.data.approval_challenge,
      { user_id: `${level}-human`, channel: 'compatibility-trusted-user-fixture', confirmed: true }
    );
    const applied = await call('submit_agent_task_input', {
      task_id: recoveredTask.task_id, idempotency_key: `${level}-approved-submit`, input: { approval_token: approvedToken }
    });
    assert.equal(applied.task_state, 'completed');
    recoveries += 1;
    const revisionAfter = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true }));
    const replay = await call('submit_agent_task_input', {
      task_id: recoveredTask.task_id, idempotency_key: `${level}-approved-submit`, input: { approval_token: approvedToken }
    });
    assert.equal(replay.idempotent_replay, true);
    const revisionAfterReplay = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true }));
    if (revisionAfterReplay !== revisionAfter) duplicateRequestDuplicateModification += 1;
    const final = await bridge.inspect_model({ runtime: 'mock' });
    const guard = final.entities.find((entity) => entity.id === 'approval-guard');
    const target = final.entities.find((entity) => entity.id === 'approval-target');
    if (target?.name !== 'Approval_Target_Reviewed' || guard?.name !== 'Approval_Guard') wrongObjectAutomaticExecution += 1;
  });

  return {
    level,
    capabilities,
    scenarios: attempted,
    completed_scenarios: completed,
    completion_rate: completed / attempted,
    tool_calls: toolCalls,
    schema_errors: schemaErrors,
    invalid_retries: invalidRetries,
    target_top_k_rate: topKAttempts ? topKHits / topKAttempts : 1,
    recovery_rate: recoveryAttempts ? recoveries / recoveryAttempts : 1,
    wrong_object_automatic_execution: wrongObjectAutomaticExecution,
    unauthorized_s2_s4_execution: unauthorizedS2S4Execution,
    duplicate_request_duplicate_modification: duplicateRequestDuplicateModification
  };
}

function sharedFixture() {
  return { version: 1, units: 'mm', operations: [
    { op: 'reset' },
    { op: 'component_definition', name: 'Shared_Leaf_Definition', operations: [
      { op: 'box', id: 'shared-leaf', name: 'Shared_Leaf', origin: [0, 0, 0], size: [100, 60, 30] }
    ] },
    { op: 'component_definition', name: 'Shared_Parent_Definition', operations: [
      { op: 'component_instance', id: 'shared-leaf-instance', name: 'Shared_Leaf_Instance', definition: 'Shared_Leaf_Definition', origin: [0, 0, 0] }
    ] },
    { op: 'component_instance', id: 'shared-parent-a', name: 'Shared_Parent_A', definition: 'Shared_Parent_Definition', origin: [0, 0, 0] },
    { op: 'component_instance', id: 'shared-parent-b', name: 'Shared_Parent_B', definition: 'Shared_Parent_Definition', origin: [250, 0, 0] }
  ] };
}

async function renderImage(filePath, x) {
  const svg = `<svg width="160" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="160" height="100" fill="white"/><rect x="${x}" y="30" width="70" height="40" fill="#222"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}

function sum(items, key) { return items.reduce((total, item) => total + Number(item[key] || 0), 0); }
function average(values) { return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length); }

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.stdout.write(`${JSON.stringify(await runAgentCompatibilityHarness(), null, 2)}\n`);
