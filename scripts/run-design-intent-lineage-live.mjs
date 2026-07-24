#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  CAPABILITY_MANIFEST_VERSION,
  QUEUE_MODEL_REVISION_STRATEGY,
  QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { projectRoot } from '../src/paths.mjs';
import { BOOLEAN_OPERATIONS_SHA256, MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import {
  assertNoSensitivePublicEvidence,
  assertQueueIdle,
  summarizeQueue
} from './run-current-source-agent-readonly-live.mjs';
import {
  cleanupReliabilityQueueArtifacts,
  installReliabilityInterruptCleanup
} from './run-real-model-reliability-harness.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CHECKPOINT_VERSION = 'design-intent-live-lineage-checkpoint.v1';
const EVIDENCE_VERSION = 'design-intent-live-lineage-evidence.v1';
const DEFAULT_SOURCE_MODEL = path.join(
  projectRoot,
  'output',
  'live-validation',
  'save-reopen-identity',
  'current-source-2026-07-22-v1',
  'target.skp'
);
const DEFAULT_RUN_DIR = path.join(
  projectRoot,
  'output',
  'live-validation',
  'design-intent-lineage',
  'current-source-2026-07-23-v1'
);
const DEFAULT_EVIDENCE_PATH = path.join(
  projectRoot,
  'docs',
  'evidence',
  'design-intent-live-lineage-evidence-2026-07-23.json'
);
const WORKING_COPY_NAME = 'design-intent-lineage.live-working.skp';
const TARGET_REFERENCE = 'save-reopen-middle-a';
const TARGET_EXPECTED_PATH = 'pid:92187';
const DIVERGENCE_MATERIAL = 'ALMA_Manual_Divergence_Red';
const WEAK_AGENT_CAPABILITIES = Object.freeze({
  vision: false,
  local_files: false,
  structured_output: true,
  context: 'short',
  parallel: false
});

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${safeMessage(error)}\n`);
    process.exitCode = 1;
  });
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.command === 'stage') return stageWorkingCopy(options);
  assertLiveOptIn(options);
  const uninstallCleanup = installReliabilityInterruptCleanup();
  try {
    if (options.command === 'capture') return captureLineage(options);
    if (options.command === 'resume') return resumeLineage(options);
    throw new Error(usage());
  } finally {
    uninstallCleanup();
    await cleanupReliabilityQueueArtifacts(process.pid);
  }
}

export async function stageWorkingCopy(options = {}) {
  const runDir = await resolveRunDir(options.runDir || DEFAULT_RUN_DIR, { create: true });
  const privateDir = path.join(runDir, 'private');
  const liveWorkDir = path.join(runDir, 'live-work');
  const sourceModel = await resolveSourceModel(options.sourceModel || DEFAULT_SOURCE_MODEL);
  const workingCopy = path.join(liveWorkDir, WORKING_COPY_NAME);
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(privateDir, 0o700);
  await fs.mkdir(liveWorkDir, { recursive: true });
  await assertAbsent(workingCopy, 'Working copy already exists; use a new --run-dir instead of overwriting live evidence.');

  const sourceSha256 = await sha256File(sourceModel);
  await fs.copyFile(sourceModel, workingCopy, fs.constants.COPYFILE_EXCL);
  const workingSha256 = await sha256File(workingCopy);
  assert.equal(workingSha256, sourceSha256, 'Staged working copy hash differs from the source fixture.');
  const sourceStat = await fs.stat(sourceModel);
  const checkpoint = {
    version: CHECKPOINT_VERSION,
    kind: 'design_intent_live_lineage_checkpoint',
    phase: 'staged',
    created_at: new Date().toISOString(),
    source_model: sourceModel,
    source_sha256: sourceSha256,
    source_size_bytes: sourceStat.size,
    working_copy: workingCopy,
    working_copy_sha256: workingSha256,
    working_copy_size_bytes: (await fs.stat(workingCopy)).size,
    capture: null,
    resume: null
  };
  await writePrivateJson(checkpointPath(runDir), checkpoint);
  const result = {
    ok: true,
    phase: 'staged',
    run_dir: repoRelative(runDir),
    working_copy: repoRelative(workingCopy),
    fixture_handle: `fixture:sha256:${workingSha256}`,
    size_bytes: checkpoint.working_copy_size_bytes,
    queue_called: false
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function captureLineage(options = {}) {
  process.stderr.write(
    '[LIVE] DesignIntent capture will inspect and save the active disposable SketchUp copy. '
    + 'It will not apply the proposed parameter change, reset the model, or approve any task.\n'
  );
  const runDir = await resolveRunDir(options.runDir || DEFAULT_RUN_DIR);
  const checkpoint = await readCheckpoint(runDir, 'staged');
  const bridge = createBridge(runDir, options.timeoutMs);
  const queueBefore = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs: options.timeoutMs });
  assertQueueIdle(queueBefore);
  const runtime = (await bridge.get_capabilities({ runtime: 'queue', timeoutMs: options.timeoutMs })).runtime;
  assertCurrentRuntime(runtime);
  const handshakeBefore = await verifiedHandshake(bridge, options.timeoutMs);
  const workingCopy = await assertActiveWorkingCopy(handshakeBefore, checkpoint);
  assert.equal(await sha256File(workingCopy), checkpoint.working_copy_sha256, 'The staged working copy changed before capture.');

  const envelope = await bridge.start_agent_task({
    intent: 'modify_design_parameters',
    instruction: 'Prepare a reviewed 130 mm design-width change for the bound test component; do not execute it.',
    interface_level: 'guided',
    client_capabilities: WEAK_AGENT_CAPABILITIES,
    idempotency_key: `design-intent-live-capture:${checkpoint.working_copy_sha256}`,
    inputs: {
      runtime: 'queue',
      save_model: false,
      recursive_limit: 5000,
      parametric_recipe: {
        version: 1,
        id: 'live-lineage-width-recipe',
        parameters: [{
          id: 'component_width_mm',
          default: 120,
          type: 'number',
          unit: 'mm',
          minimum: 100,
          maximum: 200
        }]
      },
      feature_mapping_plan: { version: 1, id: 'live-lineage-width-map' },
      part_graph: {
        version: 1,
        id: 'live-lineage-parts',
        parts: [{ id: 'save-reopen-middle-a' }]
      },
      entity_bindings: [{
        binding_id: 'save-reopen-middle-a-width',
        part_id: 'save-reopen-middle-a',
        feature_id: 'component-width',
        entity: { target_id: TARGET_REFERENCE },
        parameter_bindings: ['component_width_mm'],
        rebuild_template: [{
          op: 'box',
          id: 'live-lineage-rebuilt-component',
          name: 'Live_Lineage_Rebuilt_Component',
          origin: [0, 0, 0],
          size: [{ $parameter: 'component_width_mm' }, 70, 30]
        }]
      }],
      changes: { component_width_mm: 130 }
    }
  });
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
  assert.equal(envelope.task_state, 'awaiting_review');
  const task = await bridge.taskStore.getTask(envelope.task_id, { includePrivate: true });
  const designGraph = task.private?.design_intent_graph;
  const designStore = task.private?.design_intent_store;
  const changePlan = task.private?.design_parameter_change_plan;
  assert.equal(designGraph?.kind, 'design_intent_graph');
  assert.equal(designGraph.bindings.length, 1);
  assert.equal(designGraph.bindings[0].persistent_ref.entity_path, TARGET_EXPECTED_PATH);
  assert.equal(changePlan?.blockers?.length, 0);
  assert.equal(changePlan?.execution_allowed, false);
  assert.equal(changePlan?.operations?.length, 2);
  assert.equal(changePlan?.risk_level, 'S4');
  const historyBeforeRestart = await bridge.agentGateway.designIntentStore.history(designStore.model_key);
  assert.equal(historyBeforeRestart.version_count, 1);
  assert.equal(historyBeforeRestart.reconciliation_count, 0);

  const saved = await bridge.withFreshQueueMutationAuthorization(
    { operation: 'save_model', timeoutMs: options.timeoutMs },
    (lockedBridge) => lockedBridge.save_model({
      path: workingCopy,
      keep_session: true,
      runtime: 'queue',
      timeoutMs: options.timeoutMs
    })
  );
  assert.equal(await sameRealPath(saved.file_path, workingCopy), true, 'SketchUp saved a different model path.');
  const handshakeAfter = await verifiedHandshake(bridge, options.timeoutMs);
  assert.equal(handshakeAfter.model_revision, handshakeBefore.model_revision, 'Persistence-only save changed model revision.');
  assert.equal(handshakeAfter.model_modified, false, 'The captured model must be clean after save.');
  assert.equal(await sameRealPath(handshakeAfter.model_identity.source_path, workingCopy), true);
  const savedSha256 = await sha256File(workingCopy);
  const queueAfter = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs: options.timeoutMs });
  assertQueueIdle(queueAfter);

  checkpoint.phase = 'captured';
  checkpoint.capture = {
    captured_at: new Date().toISOString(),
    task_id: envelope.task_id,
    task_state: envelope.task_state,
    model_key: designStore.model_key,
    design_graph_id: designGraph.design_graph_id,
    design_model_revision: designGraph.model_revision,
    target_entity_path: designGraph.bindings[0].persistent_ref.entity_path,
    target_baseline_fingerprint: designGraph.bindings[0].baseline_fingerprint,
    feature_history_version_count: historyBeforeRestart.version_count,
    reconciliation_count: historyBeforeRestart.reconciliation_count,
    saved_sha256: savedSha256,
    saved_size_bytes: (await fs.stat(workingCopy)).size,
    session_fingerprint: sha256Text(handshakeAfter.session_id),
    document_fingerprint: sha256Text(handshakeAfter.document_id),
    runtime: runtimeSummary(runtime),
    queue_before: summarizeQueue(queueBefore),
    queue_after: summarizeQueue(queueAfter),
    proposal: {
      blocker_count: changePlan.blockers.length,
      operation_count: changePlan.operations.length,
      risk_level: changePlan.risk_level,
      execution_allowed: changePlan.execution_allowed
    }
  };
  await writePrivateJson(checkpointPath(runDir), checkpoint);
  const result = {
    ok: true,
    phase: 'captured',
    task_state: envelope.task_state,
    feature_history_versions: historyBeforeRestart.version_count,
    reconciliations: historyBeforeRestart.reconciliation_count,
    target_entity_path: checkpoint.capture.target_entity_path,
    model_saved_clean: true,
    proposed_change_executed: false,
    next_action: 'fully_restart_sketchup_and_open_same_working_copy'
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function resumeLineage(options = {}) {
  process.stderr.write(
    '[DANGER] DesignIntent resume will make one UNSAVED material change to the bound entity in the active disposable copy. '
    + 'It will not approve reconciliation, save the divergence, reset the model, or touch the source fixture.\n'
  );
  const runDir = await resolveRunDir(options.runDir || DEFAULT_RUN_DIR);
  const evidencePath = await resolveEvidencePath(options.evidencePath || DEFAULT_EVIDENCE_PATH);
  const checkpoint = await readCheckpoint(runDir, 'captured');
  const bridge = createBridge(runDir, options.timeoutMs);
  const queueBefore = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs: options.timeoutMs });
  assertQueueIdle(queueBefore);
  const runtime = (await bridge.get_capabilities({ runtime: 'queue', timeoutMs: options.timeoutMs })).runtime;
  assertCurrentRuntime(runtime);
  const reopenedHandshake = await verifiedHandshake(bridge, options.timeoutMs);
  const workingCopy = await assertActiveWorkingCopy(reopenedHandshake, checkpoint);
  assert.notEqual(
    sha256Text(reopenedHandshake.session_id),
    checkpoint.capture.session_fingerprint,
    'The plugin session did not change; fully quit and reopen SketchUp before resume.'
  );
  assert.equal(
    reopenedHandshake.model_revision,
    checkpoint.capture.design_model_revision,
    'The saved model revision changed across the restart.'
  );
  assert.equal(reopenedHandshake.model_modified, false, 'The reopened working copy must be clean before the divergence probe.');
  assert.equal(await sha256File(workingCopy), checkpoint.capture.saved_sha256, 'The saved working copy bytes changed before resume.');

  const resumed = await bridge.resume_agent_task({ task_id: checkpoint.capture.task_id });
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  assert.equal(resumed.task_state, checkpoint.capture.task_state);
  const resumedTask = await bridge.taskStore.getTask(resumed.task_id, { includePrivate: true });
  assert.equal(resumedTask.private?.design_intent_graph?.design_graph_id, checkpoint.capture.design_graph_id);
  assert.equal(
    resumedTask.private?.design_intent_graph?.bindings?.[0]?.baseline_fingerprint,
    checkpoint.capture.target_baseline_fingerprint
  );

  const alignedEnvelope = await bridge.start_agent_task({
    intent: 'reconcile_design_intent',
    instruction: 'Verify persisted DesignIntent lineage after a full SketchUp restart.',
    interface_level: 'guided',
    client_capabilities: WEAK_AGENT_CAPABILITIES,
    idempotency_key: `design-intent-live-aligned:${checkpoint.capture.design_graph_id}`,
    inputs: {
      runtime: 'queue',
      recursive_limit: 5000,
      design_task_id: checkpoint.capture.task_id
    }
  });
  assert.equal(alignedEnvelope.ok, true, JSON.stringify(alignedEnvelope.error));
  assert.equal(alignedEnvelope.task_state, 'completed');
  const alignedTask = await bridge.taskStore.getTask(alignedEnvelope.task_id, { includePrivate: true });
  const alignedReconciliation = alignedTask.private?.design_reconciliation;
  assert.equal(alignedReconciliation?.aligned, true);
  assert.equal(alignedReconciliation?.review_required, false);
  assert.equal(alignedReconciliation?.silent_overwrite_allowed, false);
  const historyAfterRestart = await bridge.agentGateway.designIntentStore.history(checkpoint.capture.model_key);
  assert.equal(historyAfterRestart.version_count, checkpoint.capture.feature_history_version_count);
  assert.equal(historyAfterRestart.reconciliation_count, checkpoint.capture.reconciliation_count + 1);

  const preDivergenceRevision = reopenedHandshake.model_revision;
  const mutation = await bridge.withFreshQueueMutationAuthorization(
    { operation: 'build_model', timeoutMs: options.timeoutMs },
    (lockedBridge) => lockedBridge.build_model({
      runtime: 'queue',
      timeoutMs: options.timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [
          { op: 'material', name: DIVERGENCE_MATERIAL, color: '#c83232' },
          { op: 'set_material', target_id: TARGET_REFERENCE, material: DIVERGENCE_MATERIAL }
        ]
      })
    })
  );
  assert.ok(mutation?.snapshot);
  const afterMutation = await bridge.adopt_open_model({
    runtime: 'queue',
    timeoutMs: options.timeoutMs,
    recursive: true,
    recursive_limit: 5000,
    read_only: true
  });
  const postDivergenceRevision = modelRevisionForAdoption(afterMutation);
  assert.notEqual(postDivergenceRevision, preDivergenceRevision, 'Manual divergence did not change the model revision.');
  const divergentTarget = afterMutation.recursive_index.find((entry) => entry.entity_path === checkpoint.capture.target_entity_path);
  assert.ok(divergentTarget, 'The bound entity path no longer resolves after the manual divergence.');
  assert.equal(divergentTarget.material, DIVERGENCE_MATERIAL);

  const blockedEnvelope = await bridge.start_agent_task({
    intent: 'modify_design_parameters',
    instruction: 'Attempt a second design-width change after an unreviewed manual material edit.',
    interface_level: 'guided',
    client_capabilities: WEAK_AGENT_CAPABILITIES,
    idempotency_key: `design-intent-live-blocked:${postDivergenceRevision}`,
    inputs: {
      runtime: 'queue',
      recursive_limit: 5000,
      design_task_id: checkpoint.capture.task_id,
      changes: { component_width_mm: 140 },
      save_model: false
    }
  });
  assert.equal(blockedEnvelope.ok, true, JSON.stringify(blockedEnvelope.error));
  assert.equal(blockedEnvelope.task_state, 'awaiting_input');
  const blockedTask = await bridge.taskStore.getTask(blockedEnvelope.task_id, { includePrivate: true });
  const blockedPlan = blockedTask.private?.design_parameter_change_plan;
  assert.deepEqual(blockedPlan?.blockers, ['manual_or_external_divergence_requires_reconciliation']);
  assert.equal(blockedPlan?.operations?.length, 0);
  assert.equal(blockedPlan?.execution_allowed, false);

  const reviewEnvelope = await bridge.start_agent_task({
    intent: 'reconcile_design_intent',
    instruction: 'Generate a human review for the detected manual material divergence.',
    interface_level: 'guided',
    client_capabilities: WEAK_AGENT_CAPABILITIES,
    idempotency_key: `design-intent-live-manual-review:${postDivergenceRevision}`,
    inputs: {
      runtime: 'queue',
      recursive_limit: 5000,
      design_task_id: checkpoint.capture.task_id
    }
  });
  assert.equal(reviewEnvelope.ok, true, JSON.stringify(reviewEnvelope.error));
  assert.equal(reviewEnvelope.task_state, 'awaiting_review');
  const reviewTask = await bridge.taskStore.getTask(reviewEnvelope.task_id, { includePrivate: true });
  const reconciliation = reviewTask.private?.design_reconciliation;
  const challenge = reviewTask.private?.design_reconciliation_approval;
  assert.equal(reconciliation?.aligned, false);
  assert.equal(reconciliation?.review_required, true);
  assert.equal(reconciliation?.silent_overwrite_allowed, false);
  assert.equal(reconciliation?.unexpected_divergence?.length, 1);
  assert.equal(challenge?.status, 'awaiting_trusted_user');
  assert.equal(await bridge.approvalAuthority.readDecision(challenge.challenge_id, { allowMissing: true }), null);

  const missingApproval = await bridge.submit_agent_task_input({
    task_id: reviewEnvelope.task_id,
    idempotency_key: `design-intent-live-forged-approval:${reconciliation.reconciliation_id}`,
    input: { decision: 'adopt_manual_edit' }
  });
  assert.equal(missingApproval.ok, false);
  assert.equal(missingApproval.error?.code, 'APPROVAL_REQUIRED');
  assert.equal(missingApproval.task_state, 'awaiting_review');

  const historyAfterReview = await bridge.agentGateway.designIntentStore.history(checkpoint.capture.model_key);
  assert.equal(historyAfterReview.version_count, historyAfterRestart.version_count);
  assert.equal(historyAfterReview.reconciliation_count, historyAfterRestart.reconciliation_count + 1);
  const diskSha256AfterDivergence = await sha256File(workingCopy);
  assert.equal(
    diskSha256AfterDivergence,
    checkpoint.capture.saved_sha256,
    'The unsaved divergence unexpectedly changed the on-disk working copy.'
  );
  assert.equal(await sha256File(checkpoint.source_model), checkpoint.source_sha256, 'The source fixture was modified.');
  const finalHandshake = await verifiedHandshake(bridge, options.timeoutMs);
  assert.equal(finalHandshake.model_revision, postDivergenceRevision);
  assert.equal(finalHandshake.model_modified, true);
  const queueAfter = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs: options.timeoutMs });
  assertQueueIdle(queueAfter);

  const sources = await sourceAttestation();
  const report = {
    version: EVIDENCE_VERSION,
    kind: 'design_intent_live_lineage_evidence',
    captured_at: new Date().toISOString(),
    branch: 'codex/agent-contract-v1',
    result: 'pass',
    evidence_scope: 'single_version_live_save_restart_lineage_and_unsaved_manual_divergence',
    runtime: {
      ...runtimeSummary(runtime),
      fresh_plugin_session_observed: true,
      session_changed_from_capture: true,
      raw_session_values_omitted: true
    },
    fixture: {
      source_fixture_handle: `fixture:sha256:${checkpoint.source_sha256}`,
      working_copy_artifact: repoRelative(workingCopy),
      saved_fixture_handle: `fixture:sha256:${checkpoint.capture.saved_sha256}`,
      size_bytes: checkpoint.capture.saved_size_bytes,
      source_fixture_unchanged: true,
      disposable_copy_only: true
    },
    lineage: {
      original_task_state: checkpoint.capture.task_state,
      task_resumed_by_task_id: true,
      design_graph_id_stable: true,
      target_entity_path: checkpoint.capture.target_entity_path,
      target_binding_fingerprint_stable_after_restart: true,
      model_revision_exact_after_restart: true,
      feature_history_versions_before_restart: checkpoint.capture.feature_history_version_count,
      feature_history_versions_after_restart: historyAfterRestart.version_count,
      aligned_reconciliation_completed: true,
      aligned_reconciliation_review_required: false,
      reconciliation_records_after_restart: historyAfterRestart.reconciliation_count
    },
    manual_divergence: {
      mutation_scope: 'unsaved_disposable_copy_only',
      operation: 'set_material',
      target_entity_path: checkpoint.capture.target_entity_path,
      target_path_preserved: true,
      model_revision_changed: true,
      divergent_material_observed: true,
      parameter_change_task_state: blockedEnvelope.task_state,
      blocker: blockedPlan.blockers[0],
      proposed_operation_count: blockedPlan.operations.length,
      wrong_object_modification_count: 0,
      reconciliation_task_state: reviewEnvelope.task_state,
      unexpected_divergence_count: reconciliation.unexpected_divergence.length,
      review_required: reconciliation.review_required,
      silent_overwrite_allowed: reconciliation.silent_overwrite_allowed,
      approval_challenge_status: challenge.status,
      approval_decision_recorded: false,
      approval_token_exposed: false,
      agent_supplied_decision_error_code: missingApproval.error.code,
      feature_history_versions_before_review: historyAfterRestart.version_count,
      feature_history_versions_after_review: historyAfterReview.version_count,
      feature_history_advanced_without_trusted_review: false,
      save_performed_after_divergence: false,
      disk_bytes_unchanged_after_divergence: true
    },
    agent_compatibility: {
      interface_level: 'guided',
      client_vision: false,
      client_local_files: false,
      client_context: 'short',
      client_parallel: false,
      structured_output: true,
      resume_by_task_id: true,
      server_persisted_state: true
    },
    safety: {
      explicit_queue_opt_in: true,
      explicit_disposable_copy_confirmation: true,
      live_mutation_warning_emitted: true,
      queue_before: summarizeQueue(queueBefore),
      queue_after: summarizeQueue(queueAfter),
      interrupt_cleanup_enabled: true,
      source_fixture_unchanged: true,
      approval_created_by_server: true,
      trusted_approval_recorded: false,
      reconciliation_executed: false,
      divergence_saved: false,
      sensitive_values_embedded_in_public_report: false
    },
    baseline: {
      mock_evidence_artifact: 'docs/evidence/design-intent-v1-mock-evidence.json',
      mock_evidence_sha256: `sha256:${await sha256File(path.join(projectRoot, 'docs/evidence/design-intent-v1-mock-evidence.json'))}`,
      mock_domains: ['architecture', 'product', 'interior'],
      live_domain: 'small_component_fixture'
    },
    source_attestation: sources,
    acceptance: {
      live_save_restart_lineage_stable: true,
      manual_divergence_detected: true,
      parameter_rebuild_blocked_on_divergence: true,
      reconciliation_review_generated: true,
      silent_overwrite_count: 0,
      unauthorized_reconciliation_count: 0,
      duplicate_mutation_count: 0,
      release_acceptance: false
    },
    limitations: [
      'One current SketchUp version was exercised; cross-version verification is explicitly deferred.',
      'The manual divergence was intentionally left unsaved and the reconciliation was intentionally left awaiting trusted review.',
      'This proves live lineage recovery and fail-closed divergence handling for one small component fixture, not arbitrary feature reconstruction.'
    ]
  };
  assertNoSensitivePublicEvidence(report);
  await writeJson(evidencePath, report);
  checkpoint.phase = 'resumed';
  checkpoint.resume = {
    completed_at: report.captured_at,
    evidence_path: evidencePath,
    evidence_sha256: await sha256File(evidencePath),
    post_divergence_revision: postDivergenceRevision,
    blocked_task_id: blockedEnvelope.task_id,
    reconciliation_task_id: reviewEnvelope.task_id,
    challenge_id: challenge.challenge_id,
    feature_history_version_count: historyAfterReview.version_count,
    reconciliation_count: historyAfterReview.reconciliation_count,
    queue_after: summarizeQueue(queueAfter),
    divergence_saved: false,
    trusted_decision_recorded: false
  };
  await writePrivateJson(checkpointPath(runDir), checkpoint);
  process.stdout.write(`${JSON.stringify({ ...report, evidence_path: repoRelative(evidencePath) }, null, 2)}\n`);
  return report;
}

function createBridge(runDir, timeoutMs) {
  const privateDir = path.join(runDir, 'private');
  return new SketchUpBridge({
    agentContract: {
      rootDir: path.join(privateDir, 'agent-state'),
      idempotencyLeaseMs: Math.min(30_000, Math.max(1000, Number(timeoutMs) || 120_000))
    },
    approval: { stateDir: path.join(privateDir, 'approvals') }
  });
}

async function verifiedHandshake(bridge, timeoutMs) {
  const created = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs });
  assert.equal(created.mutates_model, false);
  const contract = created.session_contract;
  await bridge.sessionContractAuthority.verify(contract);
  assert.equal(contract.model_revision_complete, true);
  assert.equal(contract.model_revision_indexed, contract.model_revision_total_seen);
  return contract;
}

async function assertActiveWorkingCopy(handshake, checkpoint) {
  assert.ok(handshake?.model_identity?.source_path, 'The active SketchUp model has no saved source path.');
  assert.equal(
    await sameRealPath(handshake.model_identity.source_path, checkpoint.working_copy),
    true,
    `Open the staged working copy before running this phase: ${repoRelative(checkpoint.working_copy)}`
  );
  return fs.realpath(checkpoint.working_copy);
}

function assertCurrentRuntime(runtime) {
  assert.equal(runtime?.compatibility?.ok, true, JSON.stringify(runtime?.compatibility?.issues));
  assert.equal(runtime.version, PRODUCT_VERSION);
  assert.equal(runtime.capability_version, RUNTIME_CAPABILITY_VERSION);
  assert.equal(runtime.manifest_version, CAPABILITY_MANIFEST_VERSION);
  assert.equal(runtime.model_revision?.strategy, QUEUE_MODEL_REVISION_STRATEGY);
  assert.equal(runtime.model_revision?.unique_entity_limit, QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT);
  assert.equal(runtime.boolean_operations_sha256, BOOLEAN_OPERATIONS_SHA256);
  assert.equal(runtime.model_revision_source_sha256, MODEL_REVISION_SOURCE_SHA256);
}

function runtimeSummary(runtime) {
  return {
    name: 'queue',
    server_version: runtime.version,
    plugin_version: runtime.version,
    sketchup_version: runtime.plugin?.sketchup_version,
    ruby_version: runtime.plugin?.ruby_version,
    capability_version: runtime.capability_version,
    manifest_version: runtime.manifest_version,
    dsl_version: runtime.dsl_version,
    occurrence_contract: runtime.occurrence_contract,
    revision_strategy: runtime.model_revision.strategy,
    revision_source_sha256: runtime.model_revision_source_sha256,
    boolean_operations_sha256: runtime.boolean_operations_sha256,
    compatibility_ok: runtime.compatibility?.ok === true
  };
}

async function sourceAttestation() {
  const files = [
    'scripts/run-design-intent-lineage-live.mjs',
    'src/agent-gateway.mjs',
    'src/design-intent-graph.mjs',
    'src/design-intent-store.mjs',
    'schema/design-intent-graph-v1.schema.json',
    'schema/design-intent-reconciliation-v1.schema.json',
    'schema/design-intent-store-v1.schema.json',
    'schema/design-intent-live-lineage-evidence-v1.schema.json',
    'test/design-intent-live-lineage-evidence.mjs'
  ];
  return Promise.all(files.map(async (relativePath) => ({
    path: relativePath,
    sha256: `sha256:${await sha256File(path.join(projectRoot, relativePath))}`
  })));
}

async function readCheckpoint(runDir, expectedPhase) {
  const filePath = checkpointPath(runDir);
  const checkpoint = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(checkpoint?.version, CHECKPOINT_VERSION, 'DesignIntent live checkpoint version is invalid.');
  assert.equal(checkpoint?.kind, 'design_intent_live_lineage_checkpoint');
  assert.equal(checkpoint?.phase, expectedPhase, `Checkpoint phase must be ${expectedPhase}.`);
  assert.equal(await isInside(runDir, checkpoint.working_copy), true, 'Checkpoint working copy escaped the run directory.');
  return checkpoint;
}

function checkpointPath(runDir) {
  return path.join(runDir, 'private', 'checkpoint.v1.json');
}

function parseArgs(argv) {
  const command = argv[0];
  if (!['stage', 'capture', 'resume'].includes(command)) throw new Error(usage());
  const options = {
    command,
    runtime: command === 'stage' ? null : 'queue',
    queueRequired: false,
    disposableCopyConfirmed: false,
    allowUnsavedDivergence: false,
    timeoutMs: 180_000
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-model') options.sourceModel = requiredValue(argv, ++index, arg);
    else if (arg === '--run-dir') options.runDir = requiredValue(argv, ++index, arg);
    else if (arg === '--evidence-path') options.evidencePath = requiredValue(argv, ++index, arg);
    else if (arg === '--runtime') options.runtime = requiredValue(argv, ++index, arg);
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--disposable-copy-confirmed') options.disposableCopyConfirmed = true;
    else if (arg === '--allow-unsaved-divergence') options.allowUnsavedDivergence = true;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--help' || arg === '-h') throw new Error(usage());
    else throw new Error(`Unknown argument: ${arg}\n${usage()}`);
  }
  return options;
}

function assertLiveOptIn(options) {
  if (options.runtime !== 'queue' || options.queueRequired !== true || options.disposableCopyConfirmed !== true) {
    throw new Error('Live phases require --runtime queue --queue-required --disposable-copy-confirmed.');
  }
  if (options.command === 'resume' && options.allowUnsavedDivergence !== true) {
    throw new Error('Resume requires --allow-unsaved-divergence because it temporarily changes the active disposable model.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 600_000) {
    throw new Error('--timeout-ms must be an integer from 1000 to 600000.');
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/run-design-intent-lineage-live.mjs stage [--source-model <skp>] [--run-dir <output-dir>]',
    '  node scripts/run-design-intent-lineage-live.mjs capture --runtime queue --queue-required --disposable-copy-confirmed [--run-dir <output-dir>]',
    '  node scripts/run-design-intent-lineage-live.mjs resume --runtime queue --queue-required --disposable-copy-confirmed --allow-unsaved-divergence [--run-dir <output-dir>] [--evidence-path <json>]'
  ].join('\n');
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

async function resolveRunDir(value, { create = false } = {}) {
  const result = path.resolve(value);
  const outputRoot = path.join(projectRoot, 'output');
  if (!await isInside(outputRoot, result)) throw new Error('--run-dir must stay inside the repository output directory.');
  if (create) await fs.mkdir(result, { recursive: true });
  return fs.realpath(result);
}

async function resolveEvidencePath(value) {
  const result = path.resolve(value);
  const evidenceRoot = path.join(projectRoot, 'docs', 'evidence');
  if (!await isInside(evidenceRoot, result)) throw new Error('--evidence-path must stay inside docs/evidence.');
  await fs.mkdir(path.dirname(result), { recursive: true });
  return result;
}

async function resolveSourceModel(value) {
  const result = await fs.realpath(path.resolve(value));
  const stat = await fs.stat(result);
  if (!stat.isFile() || path.extname(result).toLowerCase() !== '.skp') throw new Error('--source-model must be an existing .skp file.');
  return result;
}

async function isInside(root, target) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const relative = path.relative(normalizedRoot, normalizedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function sameRealPath(left, right) {
  try {
    return path.normalize(await fs.realpath(path.resolve(left))) === path.normalize(await fs.realpath(path.resolve(right)));
  } catch {
    return false;
  }
}

async function assertAbsent(filePath, message) {
  try {
    await fs.access(filePath);
    throw new Error(message);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function repoRelative(filePath) {
  const relative = path.relative(projectRoot, path.resolve(filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path is outside the repository.');
  return relative.split(path.sep).join('/');
}

async function writePrivateJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeJson(filePath, value, 0o600);
  return filePath;
}

async function writeJson(filePath, value, mode = 0o644) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, mode);
}

function safeMessage(error) {
  return String(error?.stack || error?.message || error || 'Unknown error')
    .replaceAll(/hmac_sha256:[A-Za-z0-9_-]+/g, 'hmac_sha256:[redacted]')
    .replaceAll(/(token|secret)=\S+/gi, '$1=[redacted]');
}
