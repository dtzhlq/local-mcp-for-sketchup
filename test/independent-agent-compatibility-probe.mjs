import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { callTool, SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import {
  buildIndependentAgentPrompt,
  evaluateProbe,
  initializeProbeFixture,
  prepareProbeFixtureResources,
  probeFixtureConfig,
  validateAuditChain
} from '../scripts/run-independent-agent-compatibility-probe.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = path.join(projectRoot, 'scripts', 'independent-agent-probe-tool.mjs');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-independent-agent-probe-test-'));
const sharedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-independent-agent-shared-probe-test-'));
const visualRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-independent-agent-visual-probe-test-'));
const negativeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-independent-agent-probe-negative-test-'));

try {
  const bridge = probeBridge(root);
  await initializeFixture(bridge);
  const revisionBefore = await revision(bridge);
  const understandArgs = {
    intent: 'understand_model',
    instruction: 'Summarize the current mock model while keeping detailed entities server-side.',
    interface_level: 'guided',
    client_capabilities: {
      vision: false,
      local_files: false,
      structured_output: false,
      context: 'short',
      parallel: false
    },
    idempotency_key: 'independent-agent-understand-v1',
    inputs: { runtime: 'mock', include_entities: true }
  };
  const understand = await invoke(root, 'start_agent_task', understandArgs);
  assert.equal(understand.task_state, 'completed');
  assert.equal(understand.idempotent_replay, false);
  const replay = await invoke(root, 'start_agent_task', understandArgs);
  assert.equal(replay.task_id, understand.task_id);
  assert.equal(replay.idempotent_replay, true);
  const resumed = await invoke(root, 'resume_agent_task', { task_id: understand.task_id });
  assert.equal(resumed.task_id, understand.task_id);
  assert.equal(resumed.task_state, 'completed');
  const ambiguous = await invoke(root, 'start_agent_task', {
    intent: 'propose_existing_model_edit',
    instruction: 'Rename the cabinet.',
    interface_level: 'expert',
    client_capabilities: {
      vision: true,
      local_files: true,
      structured_output: true,
      context: 'long',
      parallel: true
    },
    idempotency_key: 'independent-agent-ambiguous-edit-v1',
    inputs: {
      runtime: 'mock',
      target_query: 'cabinet',
      action: 'rename',
      parameters: { new_name: 'Reviewed_Cabinet' },
      candidate_limit: 2,
      save_model: false
    }
  });
  assert.equal(ambiguous.task_state, 'awaiting_input');

  const revisionAfter = await revision(bridge);
  const auditEvents = parseJsonLines(await fs.readFile(path.join(root, 'tool-audit.jsonl'), 'utf8'));
  const finalResponse = {
    version: 'independent-agent-probe-response.v1',
    status: 'completed',
    understand_task_id: understand.task_id,
    replay_task_id: replay.task_id,
    replay_idempotent: replay.idempotent_replay,
    resumed_task_id: resumed.task_id,
    ambiguous_task_id: ambiguous.task_id,
    ambiguous_task_state: ambiguous.task_state,
    stopped_before_execution: true,
    notes: 'The independent-process contract stopped before selecting either ambiguous target.'
  };
  const agentEvents = Array.from({ length: 4 }, (_, index) => ({
    type: 'item.completed',
    item: {
      id: `item_${index + 1}`,
      type: 'command_execution',
      command: `${process.execPath} ${adapterPath} ${auditEvents[index].tool} '{...}'`
    }
  }));
  const evaluated = await evaluateProbe({
    bridge,
    auditEvents,
    finalResponse,
    revisionBefore,
    revisionAfter,
    agentEvents
  });
  assert.equal(evaluated.hash_chain_valid, true);
  assert.deepEqual(evaluated.observed_workflow, {
    understand_completed: true,
    same_request_replayed: true,
    same_task_resumed: true,
    ambiguous_edit_awaiting_input: true,
    ambiguous_edit_execution_allowed: false,
    unexpected_tool_calls: 0,
    agent_final_claims_match_audit: true
  });
  assert.equal(validateAuditChain(auditEvents), true);
  const tampered = structuredClone(auditEvents);
  tampered[1].task_state = 'failed';
  assert.equal(validateAuditChain(tampered), false);
  const privateAmbiguous = await bridge.taskStore.getTask(ambiguous.task_id, { includePrivate: true });
  assert.deepEqual(privateAmbiguous.client_capabilities, {
    vision: false,
    local_files: false,
    structured_output: false,
    context: 'short',
    parallel: false
  });
  assert.equal(privateAmbiguous.interface_level, 'guided');
  assert.notEqual(auditEvents[3].requested_args_hash, auditEvents[3].dispatched_args_hash);
  assert.equal(auditEvents[3].trusted_profile, 'L0');

  await assert.rejects(
    evaluateProbe({
      bridge,
      auditEvents,
      finalResponse,
      revisionBefore,
      revisionAfter,
      agentEvents: [...agentEvents, {
        type: 'item.completed',
        item: { type: 'command_execution', command: 'ls' }
      }]
    }),
    /Expected four/
  );
  await assert.rejects(invoke(negativeRoot, 'build_model', { runtime: 'mock', code: '{}' }), (error) => {
    assert.equal(error.exitCode, 2);
    assert.equal(error.result.error.code, 'TOOL_NOT_ALLOWED');
    return true;
  });
  await assert.rejects(invokeRaw(negativeRoot, 'start_agent_task', '[]'), (error) => {
    assert.equal(error.exitCode, 2);
    assert.equal(error.result.error.code, 'INVALID_JSON_ARGUMENTS');
    return true;
  });
  const negativeAudit = parseJsonLines(await fs.readFile(path.join(negativeRoot, 'tool-audit.jsonl'), 'utf8'));
  assert.equal(negativeAudit.length, 2);
  assert.equal(validateAuditChain(negativeAudit), true);

  const sharedConfig = probeFixtureConfig('shared_sensor_instances');
  const sharedBridge = probeBridge(sharedRoot);
  await initializeProbeFixture(sharedBridge, sharedConfig.id);
  const sharedRevisionBefore = await revision(sharedBridge);
  const sharedUnderstandArgs = {
    ...understandArgs,
    idempotency_key: sharedConfig.understand_idempotency_key
  };
  const sharedUnderstand = await invoke(sharedRoot, 'start_agent_task', sharedUnderstandArgs);
  const sharedReplay = await invoke(sharedRoot, 'start_agent_task', sharedUnderstandArgs);
  const sharedResumed = await invoke(sharedRoot, 'resume_agent_task', { task_id: sharedUnderstand.task_id });
  const sharedAmbiguous = await invoke(sharedRoot, 'start_agent_task', {
    intent: 'propose_existing_model_edit',
    instruction: sharedConfig.instruction,
    interface_level: 'expert',
    client_capabilities: {
      vision: true,
      local_files: true,
      structured_output: true,
      context: 'long',
      parallel: true
    },
    idempotency_key: sharedConfig.ambiguous_idempotency_key,
    inputs: {
      runtime: 'mock',
      target_query: sharedConfig.target_query,
      action: 'rename',
      parameters: { new_name: sharedConfig.new_name },
      candidate_limit: sharedConfig.candidate_limit,
      save_model: false
    }
  });
  assert.equal(sharedUnderstand.task_state, 'completed');
  assert.equal(sharedReplay.task_id, sharedUnderstand.task_id);
  assert.equal(sharedReplay.idempotent_replay, true);
  assert.equal(sharedResumed.task_id, sharedUnderstand.task_id);
  assert.equal(sharedAmbiguous.task_state, 'awaiting_input');
  const sharedRevisionAfter = await revision(sharedBridge);
  const sharedAuditEvents = parseJsonLines(
    await fs.readFile(path.join(sharedRoot, 'tool-audit.jsonl'), 'utf8')
  );
  const sharedFinalResponse = {
    version: 'independent-agent-probe-response.v1',
    status: 'completed',
    understand_task_id: sharedUnderstand.task_id,
    replay_task_id: sharedReplay.task_id,
    replay_idempotent: sharedReplay.idempotent_replay,
    resumed_task_id: sharedResumed.task_id,
    ambiguous_task_id: sharedAmbiguous.task_id,
    ambiguous_task_state: sharedAmbiguous.task_state,
    stopped_before_execution: true,
    notes: 'The shared-component fixture stopped before selecting either sensor instance.'
  };
  const sharedAgentEvents = Array.from({ length: 4 }, (_, index) => ({
    type: 'item.completed',
    item: {
      id: `shared_item_${index + 1}`,
      type: 'command_execution',
      command: `${process.execPath} ${adapterPath} ${sharedAuditEvents[index].tool} '{...}'`
    }
  }));
  const sharedEvaluated = await evaluateProbe({
    bridge: sharedBridge,
    auditEvents: sharedAuditEvents,
    finalResponse: sharedFinalResponse,
    revisionBefore: sharedRevisionBefore,
    revisionAfter: sharedRevisionAfter,
    agentEvents: sharedAgentEvents,
    fixture: sharedConfig.id
  });
  assert.equal(sharedEvaluated.hash_chain_valid, true);
  assert.equal(sharedEvaluated.observed_workflow.ambiguous_edit_execution_allowed, false);
  assert.equal(sharedRevisionBefore, sharedRevisionAfter);
  const sharedPrivateTask = await sharedBridge.taskStore.getTask(
    sharedAmbiguous.task_id,
    { includePrivate: true }
  );
  assert.equal(sharedPrivateTask.result.proposal.execution_allowed, false);
  assert.equal(sharedPrivateTask.result.proposal.requires_clarification, true);
  assert.ok(sharedPrivateTask.result.proposal.candidates.length >= 2);
  const sharedCandidateNames = new Set(
    sharedPrivateTask.result.proposal.candidates.map((candidate) => candidate.summary.value.name)
  );
  assert.equal(sharedConfig.candidate_names.every((name) => sharedCandidateNames.has(name)), true);
  const sharedPrompt = buildIndependentAgentPrompt({
    nodePath: process.execPath,
    adapterPath,
    fixture: sharedConfig.id
  });
  assert.match(sharedPrompt, /Rename the survey pod/);
  assert.match(sharedPrompt, /independent-agent-understand-shared-pod-v2/);
  assert.match(sharedPrompt, /independent-agent-ambiguous-edit-shared-pod-v2/);

  const visualConfig = probeFixtureConfig('image_summary_no_vision');
  const visualBridge = probeBridge(visualRoot);
  await initializeProbeFixture(visualBridge, visualConfig.id);
  const visualResources = await prepareProbeFixtureResources(visualBridge, visualConfig.id);
  const visualRevisionBefore = await revision(visualBridge);
  const visualStarted = await invoke(visualRoot, 'start_agent_task', {
    intent: 'reference_image_correction',
    instruction: visualConfig.instruction,
    interface_level: 'expert',
    client_capabilities: {
      vision: true,
      local_files: true,
      structured_output: true,
      context: 'long',
      parallel: true
    },
    idempotency_key: visualConfig.visual_idempotency_key,
    inputs: {
      runtime: 'mock',
      reference_image_handle: visualResources.reference_handle,
      capture_image_handle: visualResources.capture_handle,
      correction_targets: [{ target_id: 'image-summary-target' }],
      correction_operations: [{
        op: 'transform_object',
        target_id: 'image-summary-target',
        translate: [-18, 0, 0]
      }],
      save_model: false
    }
  });
  assert.equal(visualStarted.task_state, 'awaiting_review');
  assert.ok(JSON.stringify(visualStarted).length <= 4096);
  assert.equal(
    visualStarted.data.visual_agent_required,
    false,
    JSON.stringify(visualStarted, null, 2)
  );
  assert.equal(visualStarted.data.local_files_required, false);
  assert.equal(visualStarted.data.correction_patch.execution_allowed, false);
  assert.ok(visualStarted.data.evidence.alignment);
  assert.ok(visualStarted.data.evidence.difference);
  const overlayHandle = visualStarted.data.image_artifacts.overlay.handle;
  const visualImageRead = await invoke(visualRoot, 'read_agent_artifact', {
    handle: overlayHandle,
    task_id: visualStarted.task_id,
    offset: 0,
    max_chars: 256
  });
  assert.equal(visualImageRead.data.artifact.encoding, 'omitted');
  assert.equal(visualImageRead.data.artifact.content_omitted_for_capability, true);
  assert.equal(Object.hasOwn(visualImageRead.data.artifact, 'content'), false);
  const visualRevisionAfter = await revision(visualBridge);
  const visualAuditEvents = parseJsonLines(
    await fs.readFile(path.join(visualRoot, 'tool-audit.jsonl'), 'utf8')
  );
  const visualFinalResponse = {
    version: 'independent-agent-image-summary-probe-response.v1',
    status: 'completed',
    visual_task_id: visualStarted.task_id,
    visual_task_state: visualStarted.task_state,
    structured_summary_inline: true,
    visual_agent_required: visualStarted.data.visual_agent_required,
    local_files_required: visualStarted.data.local_files_required,
    correction_execution_allowed: visualStarted.data.correction_patch.execution_allowed,
    image_artifact_handle: overlayHandle,
    image_artifact_encoding: visualImageRead.data.artifact.encoding,
    image_content_omitted_for_capability: visualImageRead.data.artifact.content_omitted_for_capability,
    stopped_before_execution: true,
    notes: 'The L0 Agent used the inline structured visual summary and received image metadata only.'
  };
  const visualAgentEvents = Array.from({ length: visualAuditEvents.length }, (_, index) => ({
    type: 'item.completed',
    item: {
      id: `visual_item_${index + 1}`,
      type: 'command_execution',
      command: `${process.execPath} ${adapterPath} ${visualAuditEvents[index].tool} '{...}'`
    }
  }));
  const visualEvaluated = await evaluateProbe({
    bridge: visualBridge,
    auditEvents: visualAuditEvents,
    finalResponse: visualFinalResponse,
    revisionBefore: visualRevisionBefore,
    revisionAfter: visualRevisionAfter,
    agentEvents: visualAgentEvents,
    fixture: visualConfig.id,
    fixtureResources: visualResources
  });
  assert.equal(visualEvaluated.hash_chain_valid, true);
  assert.equal(visualEvaluated.observed_workflow.structured_summary_inline, true);
  assert.equal(visualEvaluated.observed_workflow.image_artifact_metadata_only, true);
  assert.equal(visualRevisionBefore, visualRevisionAfter);
  const visualPrompt = buildIndependentAgentPrompt({
    nodePath: process.execPath,
    adapterPath,
    fixture: visualConfig.id,
    fixtureResources: visualResources
  });
  assert.match(visualPrompt, /no-vision compatibility benchmark/);
  assert.match(visualPrompt, /read_agent_artifact/);
  assert.match(visualPrompt, /exactly two Gateway calls/);
  assert.match(visualPrompt, /image-summary-v3/);
  assert.throws(() => probeFixtureConfig('not-a-fixture'), /Unknown independent Agent fixture/);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    fixture_families: 3,
    workflow_families: 2,
    independent_process_adapter_calls: auditEvents.length + sharedAuditEvents.length + visualAuditEvents.length,
    exact_idempotent_replay: true,
    resume_by_task_id: true,
    ambiguous_edit_stopped: true,
    shared_component_ambiguity_stopped: true,
    no_vision_image_summary_completed: true,
    structured_summary_inline: true,
    visual_gateway_calls: visualAuditEvents.length,
    image_artifact_metadata_only: true,
    model_revisions_unchanged: revisionBefore === revisionAfter
      && sharedRevisionBefore === sharedRevisionAfter
      && visualRevisionBefore === visualRevisionAfter,
    trusted_l0_override: true,
    audit_hash_chain_valid: true,
    rejected_negative_cases: 3,
    live_queue_called: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(sharedRoot, { recursive: true, force: true });
  await fs.rm(visualRoot, { recursive: true, force: true });
  await fs.rm(negativeRoot, { recursive: true, force: true });
}

async function invoke(probeRoot, tool, args) {
  return invokeRaw(probeRoot, tool, JSON.stringify(args));
}

async function invokeRaw(probeRoot, tool, rawArgs) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [adapterPath, tool, rawArgs], {
      env: {
        ...process.env,
        ALMA_INDEPENDENT_AGENT_PROBE_ROOT: probeRoot
      },
      maxBuffer: 2 * 1024 * 1024
    });
    return JSON.parse(stdout);
  } catch (error) {
    error.exitCode = error.code;
    let result = null;
    try {
      result = JSON.parse(String(error?.stdout || ''));
    } catch {
      // Preserve the child error if it did not return a JSON envelope.
    }
    error.result = result;
    throw error;
  }
}

function probeBridge(probeRoot) {
  return new SketchUpBridge({
    mock: { sessionPath: path.join(probeRoot, 'mock-session.json') },
    agentContract: { rootDir: path.join(probeRoot, 'agent-state') },
    approval: {
      stateDir: path.join(probeRoot, 'approvals'),
      secret: 'independent-agent-probe-local-secret-at-least-32-bytes'
    },
    executionPolicy: {
      allowed_runtimes: ['mock'],
      allow_queue_mutation: false,
      allow_direct_expert_queue_mutation: false,
      auto_approve_risks: []
    }
  });
}

async function initializeFixture(bridge) {
  await callTool('build_model', {
    runtime: 'mock',
    code: JSON.stringify({
      version: 1,
      units: 'mm',
      operations: [
        { op: 'reset' },
        { op: 'box', id: 'left-cabinet', name: 'Left_Cabinet', origin: [0, 0, 0], size: [900, 600, 2200] },
        { op: 'box', id: 'right-cabinet', name: 'Right_Cabinet', origin: [1200, 0, 0], size: [900, 600, 2200] }
      ]
    })
  }, bridge);
}

async function revision(bridge) {
  return modelRevisionForAdoption(await callTool('adopt_open_model', {
    runtime: 'mock',
    recursive: true,
    read_only: true
  }, bridge));
}

function parseJsonLines(value) {
  return String(value).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
