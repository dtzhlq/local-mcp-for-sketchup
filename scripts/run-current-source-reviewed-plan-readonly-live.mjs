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
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { projectRoot } from '../src/paths.mjs';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import { BOOLEAN_OPERATIONS_SHA256, MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import {
  EXISTING_MODEL_EDIT_PLAN_VERSION,
  existingModelEditPlanHash
} from '../src/existing-model-editing.mjs';
import {
  assertNoSensitivePublicEvidence,
  assertQueueIdle,
  assertReadOnlyBindingUnchanged,
  assertSafeRunId,
  summarizeQueue
} from './run-current-source-agent-readonly-live.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_OUTPUT_ROOT = path.join(projectRoot, 'output', 'live-validation', 'reviewed-plan-readonly');
const DEFAULT_ALLOWED_MODEL_ROOT = path.join(projectRoot, 'output');
const HASH_PATTERN = /^(?:sha256:)?([0-9a-f]{64})$/;

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${safeMessage(error)}\n`);
    process.exitCode = 1;
  });
}

export async function main(argv, dependencies = {}) {
  const options = parseArgs(argv);
  assertExplicitOptIn(options);
  const outputRoot = await resolveOutputRoot(options.outputDir || DEFAULT_OUTPUT_ROOT);
  const runId = options.runId || `${timestampId()}-${crypto.randomUUID().slice(0, 8)}`;
  assertSafeRunId(runId);
  const runDir = path.join(outputRoot, runId);
  const privateDir = path.join(runDir, 'private');
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(privateDir, 0o700);
  (dependencies.stderr || process.stderr).write(
    'READ-ONLY REVIEW PREPARATION: this command creates a proposal and pending approval challenge for the active disposable model. '
    + 'It does not approve, execute, mutate, save, capture, select, reset, open, import, or export the model.\n'
  );

  const bridge = dependencies.bridge || createBridge({ privateDir, timeoutMs: options.timeoutMs });
  const report = await runReviewedPlanReadOnlyFlow(options, { bridge, runDir, privateDir });
  assertNoSensitivePublicEvidence(report);
  const reportPath = path.join(runDir, 'report.json');
  await writeJson(reportPath, report);
  const output = `${JSON.stringify({ ...report, report_path: path.relative(projectRoot, reportPath) }, null, 2)}\n`;
  (dependencies.stdout || process.stdout).write(output);
  return report;
}

export async function runReviewedPlanReadOnlyFlow(options, { bridge, privateDir } = {}) {
  if (!bridge) throw new Error('runReviewedPlanReadOnlyFlow requires a bridge.');
  const timeoutMs = options.timeoutMs;
  const expectedModelSha256 = normalizeSha256(options.expectedModelSha256);
  const allowedModelRoot = await fs.realpath(path.resolve(options.allowedModelRoot || DEFAULT_ALLOWED_MODEL_ROOT));
  const startedAt = Date.now();

  const queueBefore = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs });
  assertQueueIdle(queueBefore);
  const runtime = (await bridge.get_capabilities({ runtime: 'queue', timeoutMs })).runtime;
  assertCurrentRuntime(runtime);
  const handshakeBeforeResult = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs });
  const handshakeBefore = handshakeBeforeResult.session_contract;
  await bridge.sessionContractAuthority.verify(handshakeBefore);
  assert.equal(handshakeBeforeResult.mutates_model, false);
  assert.equal(handshakeBefore.model_modified, false);
  assert.equal(handshakeBefore.model_revision_complete, true);
  assert.equal(handshakeBefore.model_revision_indexed, handshakeBefore.model_revision_total_seen);

  const activeModelPath = await assertAllowedDisposableModel({
    sourcePath: handshakeBefore.model_identity?.source_path,
    allowedModelRoot,
    expectedModelSha256
  });
  const bytesBefore = await sha256File(activeModelPath);
  const weakClient = Object.freeze({
    vision: false,
    local_files: false,
    structured_output: true,
    context: 'short',
    parallel: false
  });

  const proposalStartedAt = Date.now();
  const proposalEnvelope = await bridge.start_agent_task({
    intent: 'propose_existing_model_edit',
    instruction: options.instruction,
    interface_level: 'guided',
    client_capabilities: weakClient,
    idempotency_key: `review-plan-proposal:${expectedModelSha256}:${handshakeBefore.model_revision}:${sha256Text(options.targetQuery)}`,
    inputs: {
      runtime: 'queue',
      target_query: options.targetQuery,
      action: 'rename',
      parameters: { new_name: options.proposalNewName },
      structural_group_limit: options.structuralGroupLimit,
      recursive_limit: options.recursiveLimit,
      save_model: false,
      capture_view: false
    }
  });
  assert.equal(proposalEnvelope.ok, true, JSON.stringify(proposalEnvelope.error));
  assert.equal(proposalEnvelope.task_state, 'awaiting_review');
  const proposalProjection = await expandedEnvelopeDocument(bridge, proposalEnvelope);
  const proposal = proposalProjection.result?.proposal;
  assert.equal(proposalProjection.result?.target_discovery?.mode, 'structural_groups');
  assert.equal(proposal?.requires_clarification, false);
  assert.equal(proposal?.execution_allowed, false);
  assert.equal(proposal?.model_revision, handshakeBefore.model_revision);
  assert.equal(proposal?.selected_targets?.length, 1);
  assert.equal(proposal?.operation_proposal?.length, 1);

  const reviewedStartedAt = Date.now();
  const reviewedEnvelope = await bridge.start_agent_task({
    ...proposal.next_action.arguments,
    client_capabilities: weakClient,
    idempotency_key: `review-plan-prepare:${proposal.proposal_hash}`
  });
  assert.equal(reviewedEnvelope.ok, true, JSON.stringify(reviewedEnvelope.error));
  assert.equal(reviewedEnvelope.task_state, 'awaiting_review');
  const reviewedProjection = await expandedEnvelopeDocument(bridge, reviewedEnvelope);
  const reviewedResult = reviewedProjection.result;
  assert.equal(reviewedResult?.kind, 'reviewed_existing_model_edit_proposal');
  assert.equal(reviewedResult?.model_revision, handshakeBefore.model_revision);
  assert.equal(reviewedResult?.target_validation?.mode, 'structural_groups');
  assert.equal(reviewedResult?.target_validation?.leaf_entities_materialized, false);
  assert.equal(reviewedResult?.target_validation?.exact_targets_verified, true);
  assert.equal(reviewedResult?.target_validation?.sufficient_for_review, true);
  assert.equal(reviewedResult?.blockers?.length, 0);
  assert.equal(reviewedResult?.approval_challenge?.status, 'awaiting_trusted_user');

  const reviewedTask = await bridge.taskStore.getTask(reviewedEnvelope.task_id, { includePrivate: true });
  const plan = reviewedTask.private?.existing_edit_plan;
  assert.equal(plan?.version, EXISTING_MODEL_EDIT_PLAN_VERSION);
  assert.equal(plan?.plan_hash, existingModelEditPlanHash(plan));
  assert.equal(plan?.target_validation?.mode, 'structural_groups');
  assert.equal(plan?.targets?.[0]?.entity?.entity_path, proposal.selected_targets[0].entity_path);
  assert.equal(plan?.dsl_document?.operations?.[0]?.op, 'rename');
  assert.equal(plan?.compile_permission, 'ready_for_review');
  assert.equal(reviewedResult.approval_challenge.review_context.execution_target_validation.mode, 'structural_groups');
  assert.equal(reviewedResult.approval_challenge.review_context.execution_target_validation.leaf_entities_materialized, false);
  const listedChallenges = await bridge.approvalAuthority.listChallenges({ includeExpired: true, limit: 100 });
  const challenge = listedChallenges.find((entry) => entry.challenge_id === reviewedResult.approval_challenge.challenge_id);
  assert.ok(challenge);
  assert.equal(challenge.status, 'awaiting_trusted_user');
  assert.equal(challenge.decision, null);

  const handshakeAfterResult = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs });
  const handshakeAfter = handshakeAfterResult.session_contract;
  await bridge.sessionContractAuthority.verify(handshakeAfter);
  assertReadOnlyBindingUnchanged(handshakeBefore, handshakeAfter);
  const bytesAfter = await sha256File(activeModelPath);
  assert.equal(bytesAfter, bytesBefore);
  const queueAfter = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs });
  assertQueueIdle(queueAfter);

  const privateArtifacts = {
    handshake_before: await writePrivateJson(privateDir, 'handshake-before.json', handshakeBeforeResult),
    proposal_projection: await writePrivateJson(privateDir, 'proposal-projection.json', proposalProjection),
    reviewed_projection: await writePrivateJson(privateDir, 'reviewed-projection.json', reviewedProjection),
    reviewed_plan: await writePrivateJson(privateDir, 'reviewed-plan.json', plan),
    handshake_after: await writePrivateJson(privateDir, 'handshake-after.json', handshakeAfterResult)
  };

  return {
    version: 'current-source-reviewed-plan-readonly-live-report.v1',
    kind: 'current_source_reviewed_plan_readonly_live_report',
    captured_at: new Date().toISOString(),
    result: 'pass',
    runtime: {
      plugin_version: runtime.version,
      sketchup_version: runtime.plugin?.sketchup_version,
      ruby_version: runtime.plugin?.ruby_version,
      capability_version: runtime.capability_version,
      manifest_version: runtime.manifest_version,
      model_revision_strategy: runtime.model_revision.strategy,
      boolean_operations_sha256: `sha256:${runtime.boolean_operations_sha256}`,
      model_revision_source_sha256: `sha256:${runtime.model_revision_source_sha256}`,
      compatibility_ok: runtime.compatibility?.ok === true
    },
    model: {
      fixture_handle: `fixture:sha256:${expectedModelSha256}`,
      label_trust: 'untrusted_data',
      size_bytes: (await fs.stat(activeModelPath)).size,
      model_revision: handshakeBefore.model_revision,
      revision_indexed: handshakeBefore.model_revision_indexed,
      revision_total_seen: handshakeBefore.model_revision_total_seen,
      model_revision_complete: true,
      bytes_unchanged: true,
      revision_unchanged: true,
      document_unchanged: true,
      model_modified: false,
      source_path_disclosed: false
    },
    proposal: {
      task_state: proposalEnvelope.task_state,
      discovery_mode: proposalProjection.result.target_discovery.mode,
      projection_complete: proposalProjection.result.model_graph.projections.structural_groups.complete,
      projected_groups: proposalProjection.result.model_graph.projections.structural_groups.indexed,
      leaf_entities_materialized: false,
      selected_target_count: proposal.selected_targets.length,
      selected_entity_path: proposal.selected_targets[0].entity_path,
      operation_count: proposal.operation_proposal.length,
      risk_level: proposal.risk_level,
      execution_allowed: false
    },
    reviewed_plan: {
      task_state: reviewedEnvelope.task_state,
      plan_id: reviewedResult.plan_id,
      plan_hash: reviewedResult.plan_hash,
      plan_version: plan.version,
      compile_permission: plan.compile_permission,
      target_validation: reviewedResult.target_validation,
      execution_target_validation_policy: reviewedResult.approval_challenge.review_context.execution_target_validation,
      blocker_count: reviewedResult.blockers.length,
      approval_challenge_status: reviewedResult.approval_challenge.status,
      approval_decision_recorded: false,
      approval_token_issued: false,
      execution_allowed: false
    },
    timing: {
      total_ms: Date.now() - startedAt,
      proposal_ms: reviewedStartedAt - proposalStartedAt,
      reviewed_plan_ms: Date.now() - reviewedStartedAt,
      performance_guarantee: false
    },
    safety: {
      queue_before: summarizeQueue(queueBefore),
      queue_after: summarizeQueue(queueAfter),
      signed_handshakes_verified_at_capture: 2,
      sensitive_values_embedded_in_public_report: false,
      approval_challenge_created: true,
      approval_decision_recorded: false,
      mutation_requested: false,
      mutation_performed: false,
      save_requested: false,
      save_performed: false
    },
    artifact_hashes: Object.fromEntries(
      Object.entries(privateArtifacts).map(([name, value]) => [name, `sha256:${value.sha256}`])
    ),
    acceptance: {
      current_source_bounded_reviewed_plan_preparation: true,
      proposal_and_plan_target_binding_exact: true,
      leaf_entities_materialized: false,
      approval_or_execution_performed: false,
      live_mutation: false,
      release_acceptance: false
    },
    boundary: 'This proves proposal-to-reviewed-plan preparation with exact Group target validation on one current-source disposable model. The challenge remains pending without a user decision, and execution, mutation, save/reopen, multi-model target quality, post-approval performance, and release acceptance are not established.'
  };
}

function createBridge({ privateDir, timeoutMs }) {
  return new SketchUpBridge({
    queueRuntime: new QueueRuntime({ repoRoot: projectRoot, timeoutMs }),
    queue: { timeoutMs },
    executionPolicy: {
      allowed_runtimes: ['mock', 'queue'],
      allow_queue_mutation: false,
      allow_direct_expert_queue_mutation: false,
      auto_approve_risks: [],
      resource_limits: { max_recursive_entities: 1_000_000 }
    },
    approval: { stateDir: path.join(privateDir, 'approvals') },
    agentContract: { rootDir: path.join(privateDir, 'agent-contract') },
    sessionContract: {
      stateDir: path.join(privateDir, 'session-contracts'),
      serverSessionId: `current-source-reviewed-plan-${crypto.randomUUID()}`
    }
  });
}

export function assertExplicitOptIn(options) {
  if (options.runtime !== 'queue' || options.queueRequired !== true || options.disposableCopyConfirmed !== true) {
    throw new Error('Explicit live opt-in required: --runtime queue --queue-required --disposable-copy-confirmed.');
  }
  normalizeSha256(options.expectedModelSha256);
  if (!Number.isInteger(options.structuralGroupLimit) || options.structuralGroupLimit < 1 || options.structuralGroupLimit > 5000) {
    throw new Error('--structural-group-limit must be an integer from 1 to 5000.');
  }
  if (!Number.isInteger(options.recursiveLimit) || options.recursiveLimit < 1 || options.recursiveLimit > 1_000_000) {
    throw new Error('--recursive-limit must be an integer from 1 to 1000000.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 600_000) {
    throw new Error('--timeout-ms must be an integer from 1000 to 600000.');
  }
}

function assertCurrentRuntime(runtime) {
  assert.equal(runtime?.compatibility?.ok, true, JSON.stringify(runtime?.compatibility?.issues));
  assert.equal(runtime.version, PRODUCT_VERSION);
  assert.equal(runtime.capability_version, RUNTIME_CAPABILITY_VERSION);
  assert.equal(runtime.manifest_version, CAPABILITY_MANIFEST_VERSION);
  assert.equal(runtime.model_revision?.strategy, QUEUE_MODEL_REVISION_STRATEGY);
  assert.equal(runtime.boolean_operations_sha256, BOOLEAN_OPERATIONS_SHA256);
  assert.equal(runtime.model_revision_source_sha256, MODEL_REVISION_SOURCE_SHA256);
}

async function assertAllowedDisposableModel({ sourcePath, allowedModelRoot, expectedModelSha256 }) {
  if (typeof sourcePath !== 'string' || !sourcePath) throw new Error('The active SketchUp model has no saved source path.');
  const activePath = await fs.realpath(path.resolve(sourcePath));
  const relative = path.relative(allowedModelRoot, activePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('The active model is outside --allowed-model-root.');
  if (!/\.disposable\.skp$/i.test(path.basename(activePath))) throw new Error('The active model filename must end with .disposable.skp.');
  assert.equal(await sha256File(activePath), expectedModelSha256, 'The active disposable model SHA-256 does not match.');
  return activePath;
}

async function expandedEnvelopeDocument(bridge, envelope) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) return { result: envelope.data, next_action: envelope.next_action, artifacts: envelope.artifacts || [] };
  let offset = 0;
  let content = '';
  for (let pages = 0; pages < 10_000; pages += 1) {
    const page = await bridge.read_agent_artifact({ handle, task_id: envelope.task_id, offset, max_chars: 100000 });
    assert.equal(page.ok, true, JSON.stringify(page.error));
    content += page.data.artifact.content;
    if (page.data.artifact.eof) return JSON.parse(content);
    assert.ok(Number.isInteger(page.data.artifact.next_offset) && page.data.artifact.next_offset > offset);
    offset = page.data.artifact.next_offset;
  }
  throw new Error('Artifact pagination exceeded the safety limit.');
}

async function resolveOutputRoot(value) {
  const target = path.resolve(value);
  const outputRoot = path.resolve(projectRoot, 'output');
  const relative = path.relative(outputRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--output-dir must stay inside repository output.');
  await fs.mkdir(target, { recursive: true });
  return fs.realpath(target);
}

async function writePrivateJson(privateDir, name, value) {
  const filePath = path.join(privateDir, name);
  await writeJson(filePath, value);
  return { sha256: await sha256File(filePath) };
}

async function writeJson(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o600);
}

function parseArgs(argv) {
  const options = {
    timeoutMs: 180_000,
    recursiveLimit: 100_000,
    structuralGroupLimit: 5000,
    targetQuery: 'largest group',
    proposalNewName: 'Reviewed_Trimble_S6_Largest_Group',
    instruction: 'Propose renaming the largest Group after trusted user review. Do not execute, mutate, or save.'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = requiredValue(argv, ++index, arg);
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--disposable-copy-confirmed') options.disposableCopyConfirmed = true;
    else if (arg === '--expected-model-sha256') options.expectedModelSha256 = requiredValue(argv, ++index, arg);
    else if (arg === '--allowed-model-root') options.allowedModelRoot = requiredValue(argv, ++index, arg);
    else if (arg === '--output-dir') options.outputDir = requiredValue(argv, ++index, arg);
    else if (arg === '--run-id') options.runId = requiredValue(argv, ++index, arg);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--recursive-limit') options.recursiveLimit = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--structural-group-limit') options.structuralGroupLimit = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--target-query') options.targetQuery = requiredValue(argv, ++index, arg);
    else if (arg === '--proposal-new-name') options.proposalNewName = requiredValue(argv, ++index, arg);
    else if (arg === '--instruction') options.instruction = requiredValue(argv, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function normalizeSha256(value) {
  const match = HASH_PATTERN.exec(String(value || '').toLowerCase());
  if (!match) throw new Error('--expected-model-sha256 must be a 64-character SHA-256 digest.');
  return match[1];
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function timestampId() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-');
}

function safeMessage(error) {
  return String(error?.message || error || 'Unknown error')
    .replaceAll(/hmac_sha256:[A-Za-z0-9_-]+/g, 'hmac_sha256:[redacted]')
    .replaceAll(/(token|secret)=\S+/gi, '$1=[redacted]');
}
