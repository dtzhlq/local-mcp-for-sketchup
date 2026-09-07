import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { AgentGateway } from '../src/agent-gateway.mjs';
import { AgentTaskStore } from '../src/agent-task-store.mjs';
import { freezeDetailSpecification, evaluateDetailQuality } from '../src/detail-quality.mjs';
import { presentAgentResultEnvelope } from '../src/agent-response-projection.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-detail-contract-'));
const code = operations => JSON.stringify({ version: 1, units: 'mm', operations });
const box = (id, x = 0) => ({ op: 'box', id, name: id, origin: [x, 0, 0], size: [100, 100, 100] });
const makeBridge = name => new SketchUpBridge({
  mock: { sessionPath: path.join(root, name, 'model.json') },
  agentContract: { rootDir: path.join(root, name, 'tasks') },
  approval: { stateDir: path.join(root, name, 'approval'), secret: 'quality-test-secret-with-at-least-32-characters' },
  executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
});
try {
  // Failure after the committed build is persisted must recover only QA.
  const recovery = makeBridge('recovery');
  const validate = recovery.validate_model.bind(recovery);
  let throwOnce = true;
  recovery.validate_model = async options => {
    if (throwOnce) { throwOnce = false; throw new Error('synthetic QA interruption'); }
    return validate(options);
  };
  const interrupted = await recovery.start_agent_task({ intent: 'create_model', instruction: 'Recovery fixture', inputs: { runtime: 'mock', code: code([box('one')]) } });
  assert.equal(interrupted.task_state, 'verifying');
  assert.equal(interrupted.ok, false);
  const completed = await recovery.resume_agent_task({ task_id: interrupted.task_id });
  assert.equal(completed.task_state, 'completed');
  assert.equal(completed.ok, true);
  assert.equal((await recovery.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot.groups.length, 1);
  assert.equal((await recovery.taskStore.getTask(interrupted.task_id)).last_error, null);

  // Part budgets are persisted, cannot be evaded by a supplied empty part list,
  // and a read-only reverify is not another mutation attempt.
  const budget = makeBridge('budget');
  const specification = { version: 1, required_parts: [{ id: 'required_part', min_faces: 6 }] };
  let response = await budget.start_agent_task({ intent: 'create_model', instruction: 'Budget fixture', inputs: { runtime: 'mock', code: code([box('base')]), detail_spec: specification } });
  const taskId = response.task_id;
  for (let round = 1; round <= 3; round++) {
    response = await budget.submit_agent_task_input({ task_id: taskId, idempotency_key: `round-${round}`, input: { refinement_code: code([box(`extra_${round}`, round * 300)]), refinement_part_ids: [] } });
    assert.equal(response.task_state, 'awaiting_input', JSON.stringify(response));
  }
  const before = await budget.taskStore.getTask(taskId, { includePrivate: true });
  assert.equal(before.private.creation.per_part_failure_streak.required_part, 3);
  const blocked = await budget.submit_agent_task_input({ task_id: taskId, idempotency_key: 'over-budget', input: { refinement_code: code([box('fourth_refinement', 1200)]), refinement_part_ids: [] } });
  assert.equal(blocked.next_action.action, 'start_reviewed_existing_model_edit');
  assert.equal((await budget.inspect_model({ runtime: 'mock', includeSnapshot: true })).snapshot.groups.length, 4);
  const unchanged = await budget.submit_agent_task_input({ task_id: taskId, idempotency_key: 'read-only', input: { reverify: true } });
  assert.equal(unchanged.task_state, 'awaiting_input');
  assert.equal((await budget.taskStore.getTask(taskId, { includePrivate: true })).private.creation.per_part_failure_streak.required_part, 3);
  const changedSpec = await budget.submit_agent_task_input({ task_id: taskId, idempotency_key: 'change-spec', input: { detail_spec: { version: 1, required_parts: [{ id: 'base' }] }, reverify: true } });
  assert.equal(changedSpec.ok, false);
  assert.equal(changedSpec.task_state, 'awaiting_input');
  for (const kind of ['create_model_result', 'verify_model_result']) {
    const task = await budget.taskStore.getTask(taskId, { includePrivate: true });
    const result = { kind, quality_status: 'fail', quality_accepted: false, evidence_level: 'offline_mock', quality: { remaining: [{ type: 'large-diagnostic-'.repeat(2000) }] } };
    const projected = await presentAgentResultEnvelope({ task, taskStore: budget.taskStore, envelope: { kind: 'agent_result_envelope', task_id: taskId, task_state: 'awaiting_input', result, artifacts: [] } });
    assert.equal(projected.result.quality_status, 'fail', 'the smallest response projection retains the acceptance gate');
    assert.equal(projected.result.quality_accepted, false);
    assert.equal(projected.result.evidence_level, 'offline_mock');
    assert.equal(projected.result.remaining_count, 1);
    assert.ok(projected.result.full_result_artifact);
  }

  const repair = makeBridge('repair-negative');
  const repaired = await repair.build_model({ runtime: 'mock', code: code([
    { op: 'mesh', id: 'open_shell', name: 'open_shell', vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0], [0, 0, 100]], faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2]] },
    { op: 'manifold_repair', target_id: 'open_shell', strategy: 'seal_bbox' },
    { op: 'manifold_repair', target_id: 'open_shell', strategy: 'cleanup' }
  ]) });
  assert.equal(repaired.snapshot.groups[0].faces, 6, 'the coarse repair changes the actual mock result');
  const repairQuality = evaluateDetailQuality({ snapshot: repaired.snapshot, runtime: 'mock', trustedSnapshot: true, layoutQa: { ok: true, verdict: 'pass' }, frozenSpecification: freezeDetailSpecification({ version: 1, required_parts: [{ id: 'open_shell', min_faces: 6 }] }) });
  assert.equal(repairQuality.quality_status, 'fail');
  assert.equal(repairQuality.remaining[0].type, 'detail.bounding_box_repair_forbidden');

  // Synthetic server fixtures exercise orchestration/receipt binding only;
  // they are not live SketchUp evidence.
  for (const mode of ['valid', 'unrestored', 'wrong-revision', 'forged-input']) {
    const store = new AgentTaskStore({ rootDir: path.join(root, `capture-${mode}`) });
    const spec = freezeDetailSpecification({ version: 1, required_parts: [{ id: 'leaf', instance_path: ['root', 'leaf'], min_faces: 6 }], required_views: [{ id: 'detail', instance_path: ['root', 'leaf'], min_width: 800 }] });
    const snapshot = { model_revision: 'test-revision-1', geometry_occurrences: [{ part_id: 'minted_leaf', instance_path: ['minted_root', 'minted_leaf'], geometry_evidence: { source: 'sketchup_runtime', measured: true, complete: true, face_count: 6 } }] };
    let captureCalls = 0;
    const captureDirectories = [];
    const service = {
      validate_model: async () => ({ ok: true, verdict: 'pass' }),
      create_queue_handshake: async () => ({ session_contract: { test: true } }),
      withAgentGatewayExecution: async (_context, callback) => callback(service),
      capture_detail_views: async request => {
        captureCalls++;
        assert.equal(request.timeoutMs, 120000, 'Detail capture must not fall back to the generic 30-second queue timeout');
        captureDirectories.push(request.output_dir);
        assert.deepEqual(request.views[0].eye, [1, 2, 3], 'camera parameters must merge from scene views');
        assert.deepEqual(request.views[0].instance_path, ['minted_root', 'minted_leaf']);
        assert.equal(request.views[0].min_width, 800, 'view input cannot weaken a frozen width requirement');
        if (mode === 'forged-input') throw new Error('server capture unavailable');
        return { restored: mode !== 'unrestored', captures: [{ id: 'detail', width: 1000, height: 800, model_revision: mode === 'wrong-revision' ? 'stale-revision' : snapshot.model_revision, server_verified: true }] };
      }
    };
    const gateway = new AgentGateway({ bridge: service, taskStore: store });
    let { task } = await store.createTask({ intent: 'create_model', instruction: 'Synthetic capture contract fixture', inputs: { views: [{ id: 'detail', eye: [1, 2, 3], target: [0, 0, 0], min_width: 1 }], captures: [{ id: 'detail', width: 9999, model_revision: snapshot.model_revision, server_verified: true }] } });
    task = await store.transition(task.task_id, 'understanding');
    task = await store.transition(task.task_id, 'verifying', { patch: { private: { creation: { runtime: 'queue', frozen_spec: spec, layout_spec: {}, identity_map: { root: 'minted_root', leaf: 'minted_leaf' }, rounds: [], round: { iteration: 0, source_hash: 'test-source', phase: 'built', snapshot } } } } });
    const finalized = await gateway.finalizeCreationQuality(task);
    assert.equal(captureCalls, 1);
    assert.equal(finalized.state, mode === 'valid' ? 'completed' : 'awaiting_input');
    assert.equal(finalized.result.quality_accepted, mode === 'valid');
    assert.equal(finalized.private.creation.round.captures.length, ['unrestored', 'forged-input'].includes(mode) ? 0 : 1);
    if (mode === 'unrestored') {
      assert.equal(finalized.private.creation.round.capture_diagnostics[0].raw_result.restored, false);
      assert.match(finalized.private.creation.round.capture_diagnostics[0].error.message, /restoration/);
      let retry = await store.transition(task.task_id, 'understanding');
      retry = await store.transition(task.task_id, 'verifying');
      const retried = await gateway.finalizeCreationQuality(retry);
      assert.equal(retried.private.creation.round.capture_attempts, 2);
      assert.equal(retried.private.creation.round.capture_diagnostics.length, 2);
      assert.notEqual(captureDirectories[0], captureDirectories[1], 'reverification uses a new capture attempt directory');
    }
  }
  console.log('detail-quality-workflow-contract: durable QA recovery, frozen specification, three-attempt budget, and synthetic server view receipt contracts passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
