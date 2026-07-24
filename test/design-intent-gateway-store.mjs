import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-design-intent-gateway-'));
const options = {
  mock: { sessionPath: path.join(root, 'mock-session.json') },
  agentContract: { rootDir: path.join(root, 'agent-state'), idempotencyLeaseMs: 25 },
  approval: {
    stateDir: path.join(root, 'approvals'),
    secret: 'design-intent-gateway-store-test-secret-is-at-least-32-bytes'
  },
  executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: [] }
};

try {
  const bridge = new SketchUpBridge(options);
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'box', id: 'main-door', name: 'Main_Door', origin: [0, 0, 0], size: [900, 160, 2100] }
    ]
  }) });

  const startArgs = {
    intent: 'modify_design_parameters',
    instruction: 'Increase the reviewed main door width to 1200 mm.',
    idempotency_key: 'design-gateway-create-v1',
    inputs: {
      runtime: 'mock',
      save_model: false,
      parametric_recipe: {
        version: 1,
        id: 'door-recipe',
        parameters: [{ id: 'door_width_mm', default: 900, type: 'number', unit: 'mm', minimum: 700, maximum: 1800 }]
      },
      feature_mapping_plan: { version: 1, id: 'door-map' },
      part_graph: { version: 1, id: 'door-parts', parts: [{ id: 'main-door' }] },
      entity_bindings: [{
        binding_id: 'main-door-width',
        part_id: 'main-door',
        feature_id: 'door-width',
        entity: { target_id: 'main-door' },
        parameter_bindings: ['door_width_mm'],
        rebuild_template: [{
          op: 'box',
          id: 'main-door',
          name: 'Main_Door',
          origin: [0, 0, 0],
          size: [{ $parameter: 'door_width_mm' }, 160, 2100]
        }]
      }],
      changes: { door_width_mm: 1200 }
    }
  };

  const proposed = await bridge.start_agent_task(startArgs);
  assert.equal(proposed.ok, true);
  assert.equal(proposed.task_state, 'awaiting_review');
  assert.equal(proposed.data.design_intent_store.version_count, 1);
  assert.equal(proposed.data.design_intent_store.reconciliation_count, 0);
  assert.equal(proposed.next_action.arguments.inputs.source_design_change.task_id, proposed.task_id);
  assert.equal(Object.hasOwn(proposed.next_action.arguments.inputs, 'targets'), false, 'promotion next_action must not expose trusted targets');
  assert.equal(Object.hasOwn(proposed.next_action.arguments.inputs, 'operations'), false, 'promotion next_action must not expose trusted operations');
  const proposedProjection = await expandedEnvelopeDocument(bridge, proposed);
  assert.ok(proposedProjection.artifacts.some((artifact) => artifact.label === 'design_intent_graph'));
  assert.ok(proposedProjection.artifacts.some((artifact) => artifact.label === 'design_intent_store_manifest'));
  const initialHandles = proposedProjection.artifacts.map((artifact) => artifact.handle);

  const startReplay = await bridge.start_agent_task(startArgs);
  assert.equal(startReplay.idempotent_replay, true);
  assert.equal(startReplay.task_id, proposed.task_id);
  const startReplayProjection = await expandedEnvelopeDocument(bridge, startReplay);
  assert.deepEqual(startReplayProjection.artifacts.map((artifact) => artifact.handle), initialHandles, 'start retry must preserve stable artifact handles');

  const restartedBeforeReview = new SketchUpBridge(options);
  const resumedProposal = await restartedBeforeReview.resume_agent_task({ task_id: proposed.task_id });
  assert.equal(resumedProposal.task_state, 'awaiting_review');
  assert.equal(resumedProposal.data.design_intent_store.design_graph_id, proposed.data.design_intent_store.design_graph_id);
  const resumedProposalProjection = await expandedEnvelopeDocument(restartedBeforeReview, resumedProposal);
  assert.deepEqual(resumedProposalProjection.artifacts.map((artifact) => artifact.handle), initialHandles);

  const tamperedPromotion = await restartedBeforeReview.start_agent_task({
    ...proposed.next_action.arguments,
    idempotency_key: 'design-gateway-tampered-promotion',
    inputs: {
      ...proposed.next_action.arguments.inputs,
      operations: [{ op: 'box', id: 'agent-override', origin: [0, 0, 0], size: [1, 1, 1] }],
      targets: [{ target_id: 'main-door' }]
    }
  });
  assert.equal(tamperedPromotion.ok, false);
  assert.equal(tamperedPromotion.error.code, 'INVALID_ARGUMENT');

  const reviewed = await restartedBeforeReview.start_agent_task({
    ...proposed.next_action.arguments,
    idempotency_key: 'design-gateway-reviewed-rebuild-v1'
  });
  assert.equal(reviewed.ok, true, 'an invalid override attempt must not poison the server-owned promotion idempotency key');
  assert.equal(reviewed.task_state, 'awaiting_review');
  const reviewedProjection = await expandedEnvelopeDocument(restartedBeforeReview, reviewed);
  assert.equal(reviewedProjection.result.source_design_change.provenance, 'server_task_binding');
  assert.equal(reviewedProjection.result.risk_level, 'S4');

  await restartedBeforeReview.approvalAuthority.recordTrustedDecision(
    reviewedProjection.result.approval_challenge,
    { decision: 'approved', user_id: 'design-reviewer', channel: 'local-user-presence-test', confirmed: true }
  );
  const applyArgs = {
    task_id: reviewed.task_id,
    idempotency_key: 'design-gateway-apply-v1',
    input: {}
  };
  const originalDesignArtifactFinalizer = restartedBeforeReview.agentGateway.registerDesignIntentArtifacts.bind(restartedBeforeReview.agentGateway);
  let designFinalizerInterrupted = false;
  restartedBeforeReview.agentGateway.registerDesignIntentArtifacts = async (...args) => {
    const handles = await originalDesignArtifactFinalizer(...args);
    if (args[0] === reviewed.task_id && !designFinalizerInterrupted) {
      designFinalizerInterrupted = true;
      throw new Error('simulated_design_finalizer_process_exit');
    }
    return handles;
  };
  const interruptedApply = await restartedBeforeReview.submit_agent_task_input(applyArgs);
  assert.equal(interruptedApply.ok, false);
  assert.equal(interruptedApply.error.code, 'MUTATION_RECOVERY_REQUIRED');
  assert.equal(interruptedApply.task_state, 'verifying');
  const historyAfterInterruptedFinalizer = await restartedBeforeReview.agentGateway.designIntentStore.history(proposed.data.design_intent_store.model_key);
  assert.equal(historyAfterInterruptedFinalizer.version_count, 2);
  const restartedDesignFinalizer = new SketchUpBridge(options);
  const applied = await restartedDesignFinalizer.resume_agent_task({ task_id: reviewed.task_id });
  assert.equal(applied.ok, true, JSON.stringify(applied.error));
  assert.equal(applied.task_state, 'completed');
  const appliedProjection = await expandedEnvelopeDocument(restartedDesignFinalizer, applied);
  assert.equal(appliedProjection.result.lineage_status, 'persisted');
  assert.equal(appliedProjection.result.design_intent_store.version_count, 2);
  assert.equal(appliedProjection.result.design_intent_store.reconciliation_count, 1);
  assert.equal(appliedProjection.result.design_intent_store.model_revision, appliedProjection.result.reconciliation.current_model_revision);
  assert.ok(appliedProjection.artifacts.some((artifact) => artifact.label === 'design_intent_reconciliation'));
  assert.equal((await restartedDesignFinalizer.agentGateway.designIntentStore.history(appliedProjection.result.design_intent_store.model_key)).version_count, 2, 'design finalizer retry must reuse the persisted FeatureHistory version');
  const modelAfterApply = await restartedDesignFinalizer.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true });
  assert.equal(modelAfterApply.entities.find((entity) => entity.id === 'main-door').bounding_box.w, 1200);
  const revisionAfterApply = modelRevisionForAdoption(modelAfterApply);

  const applyReplay = await restartedDesignFinalizer.submit_agent_task_input(applyArgs);
  assert.equal(applyReplay.idempotent_replay, true);
  assert.equal(applyReplay.task_state, 'completed');
  assert.equal(
    modelRevisionForAdoption(await restartedDesignFinalizer.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true })),
    revisionAfterApply,
    'reviewed rebuild retry must not duplicate geometry'
  );
  assert.equal((await restartedDesignFinalizer.agentGateway.designIntentStore.history(appliedProjection.result.design_intent_store.model_key)).version_count, 2);

  const restartedAfterApply = new SketchUpBridge(options);
  const resumedApplied = await restartedAfterApply.resume_agent_task({ task_id: reviewed.task_id });
  const resumedAppliedProjection = await expandedEnvelopeDocument(restartedAfterApply, resumedApplied);
  assert.equal(resumedAppliedProjection.result.lineage_status, 'persisted');
  assert.equal(resumedAppliedProjection.result.design_intent_store.version_count, 2);

  const savePath = path.join(root, 'door-save-reopen.json');
  await restartedAfterApply.save_model({ runtime: 'mock', path: savePath, keep_session: true });
  await restartedAfterApply.open_model({ runtime: 'mock', path: savePath });
  const reopened = await restartedAfterApply.start_agent_task({
    intent: 'reconcile_design_intent',
    instruction: 'Verify persisted DesignIntent lineage after save and reopen.',
    idempotency_key: 'design-gateway-save-reopen-reconcile',
    inputs: { runtime: 'mock', design_task_id: reviewed.task_id }
  });
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error));
  assert.equal(reopened.task_state, 'completed');
  const reopenedProjection = await expandedEnvelopeDocument(restartedAfterApply, reopened);
  assert.equal(reopenedProjection.result.reconciliation.aligned, true);
  assert.equal(reopenedProjection.result.design_intent_store.version_count, 2);
  assert.equal(reopenedProjection.result.design_intent_store.reconciliation_count, 2);

  await restartedAfterApply.build_model({ runtime: 'mock', code: JSON.stringify({
    version: 1,
    units: 'mm',
    operations: [
      { op: 'material', name: 'Manual_Red', color: '#cc0000' },
      { op: 'set_material', target_id: 'main-door', material: 'Manual_Red' }
    ]
  }) });
  const beforeBlockedHistory = await restartedAfterApply.agentGateway.designIntentStore.history(appliedProjection.result.design_intent_store.model_key);
  const blocked = await restartedAfterApply.start_agent_task({
    intent: 'modify_design_parameters',
    instruction: 'Attempt another parameter change after an unreviewed manual edit.',
    idempotency_key: 'design-gateway-divergence-block',
    inputs: { runtime: 'mock', design_task_id: reviewed.task_id, changes: { door_width_mm: 1300 }, save_model: false }
  });
  assert.equal(blocked.task_state, 'awaiting_input');
  assert.deepEqual(blocked.data.change_plan.blockers, ['manual_or_external_divergence_requires_reconciliation']);
  assert.equal(blocked.data.change_plan.operation_count, 0);
  const blockedProjection = await expandedEnvelopeDocument(restartedAfterApply, blocked);
  assert.equal(blockedProjection.result.change_plan.operations.length, 0);
  assert.equal((await restartedAfterApply.agentGateway.designIntentStore.history(appliedProjection.result.design_intent_store.model_key)).version_count, beforeBlockedHistory.version_count);

  const manualReview = await restartedAfterApply.start_agent_task({
    intent: 'reconcile_design_intent',
    instruction: 'Review the detected manual material divergence.',
    idempotency_key: 'design-gateway-manual-reconcile',
    inputs: { runtime: 'mock', design_task_id: reviewed.task_id }
  });
  assert.equal(manualReview.task_state, 'awaiting_review');
  const manualReviewProjection = await expandedEnvelopeDocument(restartedAfterApply, manualReview);
  assert.equal(manualReviewProjection.result.reconciliation.silent_overwrite_allowed, false);
  assert.equal(manualReviewProjection.result.reconciliation.unexpected_divergence.length, 1);
  assert.ok(manualReviewProjection.result.approval_challenge);
  const versionBeforeTrustedDecision = (await restartedAfterApply.agentGateway.designIntentStore.history(appliedProjection.result.design_intent_store.model_key)).version_count;
  assert.equal(versionBeforeTrustedDecision, 2, 'unreviewed divergence must not silently advance FeatureHistory');

  const missingTrustedDecision = await restartedAfterApply.submit_agent_task_input({
    task_id: manualReview.task_id,
    idempotency_key: 'design-gateway-manual-reconcile-missing-token',
    input: { decision: 'adopt_manual_edit' }
  });
  assert.equal(missingTrustedDecision.ok, false);
  assert.equal(missingTrustedDecision.error.code, 'APPROVAL_REQUIRED');
  assert.equal(missingTrustedDecision.task_state, 'awaiting_review', 'missing trusted approval must remain recoverable');

  await restartedAfterApply.approvalAuthority.recordTrustedDecision(
    manualReviewProjection.result.approval_challenge,
    {
      decision: 'approved',
      user_id: 'design-reviewer',
      channel: 'local-user-presence-test',
      confirmed: true,
      selection: 'adopt_manual_edit'
    }
  );
  const decisionArgs = {
    task_id: manualReview.task_id,
    idempotency_key: 'design-gateway-manual-reconcile-accept',
    input: { decision: 'adopt_manual_edit' }
  };
  const accepted = await restartedAfterApply.submit_agent_task_input(decisionArgs);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error));
  assert.equal(accepted.task_state, 'completed');
  const acceptedProjection = await expandedEnvelopeDocument(restartedAfterApply, accepted);
  assert.equal(acceptedProjection.result.lineage_status, 'persisted_after_trusted_reconciliation');
  assert.equal(acceptedProjection.result.design_intent_store.version_count, 3);
  assert.equal(acceptedProjection.result.design_intent_store.reconciliation_count, 3);
  const acceptedReplay = await restartedAfterApply.submit_agent_task_input(decisionArgs);
  assert.equal(acceptedReplay.idempotent_replay, true);
  assert.equal((await restartedAfterApply.agentGateway.designIntentStore.history(appliedProjection.result.design_intent_store.model_key)).version_count, 3);

  const forgedModelKey = await restartedAfterApply.start_agent_task({
    intent: 'reconcile_design_intent',
    instruction: 'An Agent must not select a server model identity.',
    idempotency_key: 'design-gateway-forged-model-key',
    inputs: {
      runtime: 'mock',
      design_task_id: reviewed.task_id,
      model_key: `model_${'f'.repeat(32)}`
    }
  });
  assert.equal(forgedModelKey.ok, false);
  assert.equal(forgedModelKey.error.code, 'INVALID_ARGUMENT');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime: 'mock-only-no-queue',
    immutable_design_versions: 3,
    reconciliation_records: 3,
    reviewed_rebuild_persisted: true,
    save_reopen_lineage_stable: true,
    divergence_fail_closed: true,
    trusted_reconciliation_required: true,
    opaque_source_task_promotion: true,
    tampered_override_blocked: true,
    idempotent_retry_duplicate_mutation: false,
    resume_by_task_id: true,
    client_model_key_trusted: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function expandedEnvelopeDocument(targetBridge, envelope) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) {
    return {
      result: envelope.data,
      next_action: envelope.next_action,
      artifacts: envelope.artifacts || []
    };
  }
  return JSON.parse(await readArtifactText(targetBridge, handle, envelope.task_id));
}

async function readArtifactText(targetBridge, handle, taskId) {
  const handleMatch = /^artifact:(task_[0-9a-f-]+):[0-9a-f-]+$/i.exec(String(handle));
  assert.ok(handleMatch, 'The full projection must use an opaque task artifact handle.');
  assert.equal(handleMatch[1], taskId, 'The full projection artifact must be bound to its owning task.');

  let offset = 0;
  let content = '';
  while (true) {
    const page = await targetBridge.read_agent_artifact({
      handle,
      task_id: taskId,
      offset,
      max_chars: 1024
    });
    assert.equal(page.ok, true, JSON.stringify(page.error));
    assert.equal(page.task_id, taskId);
    assert.equal(page.data?.artifact?.handle, handle);
    assert.equal(page.data?.artifact?.offset, offset);
    assert.equal(typeof page.data?.artifact?.content, 'string');
    content += page.data.artifact.content;
    if (page.data.artifact.eof) {
      assert.equal(page.data.artifact.next_offset, null);
      return content;
    }
    assert.ok(Number.isInteger(page.data.artifact.next_offset) && page.data.artifact.next_offset > offset);
    offset = page.data.artifact.next_offset;
  }
}
