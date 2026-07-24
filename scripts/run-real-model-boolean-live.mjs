#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  CAPABILITY_MANIFEST_VERSION,
  QUEUE_MODEL_REVISION_STRATEGY,
  QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { versionedModelSavePath } from '../src/existing-model-editing.mjs';
import { defaultStateDir, projectRoot } from '../src/paths.mjs';
import { BOOLEAN_OPERATIONS_SHA256, MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';

const CASE_RELATIVE_ROOT = path.join(
  'output',
  'real-model-reliability',
  'intake',
  'live-work',
  'preflight-176129c4-e1ef-4b53-b991-8f7b936df118',
  'candidate_e2ef3c5f82332f9174066759'
);
const CASE_ROOT = path.resolve(projectRoot, CASE_RELATIVE_ROOT);
const OUTPUT_ROOT = path.resolve(projectRoot, 'output', 'real-model-reliability', 'boolean-live', 'portal-structure');
const READONLY_DISCOVERY_ROOT = path.join(
  OUTPUT_ROOT,
  'readonly-probe-2026-07-21T06-31-04Z-90dd4d46'
);
const WORKSPACE_BOOLEAN_SOURCE = path.resolve(projectRoot, 'sketchup_plugin', 'alma_sketchup_mcp', 'boolean_operations.rb');
const WORKSPACE_MODEL_REVISION_SOURCE = path.resolve(projectRoot, 'sketchup_plugin', 'alma_sketchup_mcp', 'model_revision.rb');
const INSTALLED_BOOLEAN_SOURCE = path.join(
  homedir(),
  'Library',
  'Application Support',
  'SketchUp 2026',
  'SketchUp',
  'Plugins',
  'alma_sketchup_mcp',
  'boolean_operations.rb'
);
const INSTALLED_MODEL_REVISION_SOURCE = path.join(
  homedir(),
  'Library',
  'Application Support',
  'SketchUp 2026',
  'SketchUp',
  'Plugins',
  'alma_sketchup_mcp',
  'model_revision.rb'
);

export const PORTAL_BOOLEAN_LIVE_VERSION = 'portal-structure-s3-boolean-live.v8';
export const PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE = Object.freeze({
  evidence_kind: 'bbox_candidate_only',
  bbox_relation: 'positive_bbox_overlap_unverified',
  exact_solid_overlap: Object.freeze({
    status: 'unverified_before_atomic_trial',
    verified: false,
    verification_stage: 'review_gated_atomic_apply'
  }),
  approved_action: 'review_gated_atomic_boolean_trial',
  success_preconditions: Object.freeze([
    'target_exact_volume_strictly_reduced',
    'result_manifold'
  ]),
  failure_disposition: 'abort_before_commit'
});
export const PORTAL_BOOLEAN_RECURSIVE_POLICY = Object.freeze({
  observed_complete_entity_count: 11_474,
  recursive_limit: 20_000,
  max_recursive_entities: 20_000,
  baseline_headroom_entities: 8_526
});
export const PORTAL_BOOLEAN_EXECUTION_POLICY = Object.freeze({
  allowed_runtimes: Object.freeze(['mock', 'queue']),
  allow_queue_mutation: true,
  allow_direct_expert_queue_mutation: false,
  auto_approve_risks: Object.freeze([]),
  resource_limits: Object.freeze({
    max_operations: 1,
    max_affected_instances: 2,
    max_recursive_entities: PORTAL_BOOLEAN_RECURSIVE_POLICY.max_recursive_entities,
    auto_approve_s1_max_affected_instances: 1
  })
});
export const PORTAL_BOOLEAN_CURRENT_RUNTIME = Object.freeze({
  capability_version: RUNTIME_CAPABILITY_VERSION,
  manifest_version: CAPABILITY_MANIFEST_VERSION,
  model_revision_strategy: QUEUE_MODEL_REVISION_STRATEGY,
  model_revision_unique_entity_limit: QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
  boolean_operations_sha256: BOOLEAN_OPERATIONS_SHA256,
  model_revision_source_sha256: MODEL_REVISION_SOURCE_SHA256
});
export const PORTAL_BOOLEAN_BINDING = Object.freeze({
  source_path: path.join(CASE_ROOT, 'candidate.skp'),
  source_sha256: '4a75190929bfa47b1506a8ed037a08e0f08e1632169d9bb550c4a9219b43e90c',
  model_revision: 'sha256:c03d317c25883606f0f8d7819610823118d916694d5a5d323deabe2ac7bcdf36',
  document_id: 'document_baaef9d1d43e79fc755c54b849181c30406b8a10f3ccbf64441ab99af896baba',
  model_identity_sha256: 'sha256:d51e2f277f8d2349051afa5d82250b106116bf433fa2877fcdaec99c1b641719',
  capability_version: '0.1.0-rc.2-capabilities.7',
  manifest_version: '2026-07-agent-contract-v1.4',
  structural_groups_version: 'structural-groups.v1',
  boolean_operations_sha256: '2e3d686ba926f8b43f5a9847e05471587a217b536fd901811f10444948c2c444',
  target_path: 'pid:11543',
  tool_path: 'pid:11635',
  operation: 'boolean_difference',
  risk_level: 'S3',
  result_id: 'portal-structure-s3-boolean-result-v8',
  result_name: 'Portal_S3_Boolean_Result_v8',
  recursive_limit: PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit,
  structural_group_limit: 500,
  baseline_group_count: 18,
  artifacts: Object.freeze({
    capabilities: Object.freeze({
      path: path.join(READONLY_DISCOVERY_ROOT, 'capabilities.json'),
      sha256: '1aad10601fabf8408362eb4a41854be04940d1c0b7fdaeba2dc88e6f855e2cff'
    }),
    queue_before: Object.freeze({
      path: path.join(READONLY_DISCOVERY_ROOT, 'queue-before-adoption.json'),
      sha256: 'a6e710e81d80465e55902729bb047d910c56c86838f1b537e4181112502609df'
    }),
    structural: Object.freeze({
      path: path.join(READONLY_DISCOVERY_ROOT, 'structural-adoption.json'),
      sha256: 'c0050321bf08b6ad6d74dc1536a5eaab5ccdc8c65a6db19bdf0f013908040837'
    }),
    review: Object.freeze({
      path: path.join(READONLY_DISCOVERY_ROOT, 'recursive-target-review-v2.json'),
      sha256: '2339a9876535abc903377e78e5a85488d3cc562ee72fbd83960c75698d809955'
    }),
    queue_after: Object.freeze({
      path: path.join(READONLY_DISCOVERY_ROOT, 'queue-after-adoption.json'),
      sha256: 'a6e710e81d80465e55902729bb047d910c56c86838f1b537e4181112502609df'
    })
  }),
  geometry: Object.freeze({
    'pid:11543': Object.freeze({
      faces: 38,
      edges: 108,
      vertices: 72,
      volume: 61350393.972267,
      bounding_box: Object.freeze({
        min: Object.freeze([-7286.931445, 376.95, -1916.983936]),
        max: Object.freeze([-4037.70638, 642.25, -318.145223])
      })
    }),
    'pid:11635': Object.freeze({
      faces: 8,
      edges: 18,
      vertices: 12,
      volume: 723623.440001,
      bounding_box: Object.freeze({
        min: Object.freeze([-6024.107717, 376.95, -1510.638035]),
        max: Object.freeze([-5830.315299, 503.15, -814.163406])
      })
    })
  })
});
export const PORTAL_BOOLEAN_V8_LOADED_RUNTIME = Object.freeze({
  capability_version: PORTAL_BOOLEAN_BINDING.capability_version,
  manifest_version: PORTAL_BOOLEAN_BINDING.manifest_version,
  model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
  model_revision_unique_entity_limit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit,
  boolean_operations_sha256: PORTAL_BOOLEAN_BINDING.boolean_operations_sha256,
  model_revision_source_sha256: 'b5c4c64c346c5abe1258be32c8027d542a4ccc28e2afc70c48debf3fcb886134'
});

const LIVE_COMMANDS = new Set(['prepare', 'apply', 'verify-reopen']);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function portalIdempotencyKey(phase, modelRevision) {
  assert(/^sha256:[0-9a-f]{64}$/.test(String(modelRevision || '')), `Cannot create ${phase} idempotency key without a complete v2 model revision.`);
  return `${PORTAL_BOOLEAN_LIVE_VERSION}:${phase}:${PORTAL_BOOLEAN_BINDING.source_sha256}:${PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy}:${modelRevision}`;
}

export function portalPrepareReuseDisposition(record) {
  if (record?.kind !== 'portal_structure_s3_boolean_prepare') return 'invalid';
  if (record.version === PORTAL_BOOLEAN_LIVE_VERSION) return 'current';
  if ([
    'portal-structure-s3-boolean-live.v1',
    'portal-structure-s3-boolean-live.v2',
    'portal-structure-s3-boolean-live.v3',
    'portal-structure-s3-boolean-live.v4',
    'portal-structure-s3-boolean-live.v5',
    'portal-structure-s3-boolean-live.v6',
    'portal-structure-s3-boolean-live.v7'
  ].includes(record.version)) return 'superseded';
  return 'invalid';
}

export function assertPortalRecursiveIndexCapacity(totalSeen) {
  assert(Number.isInteger(totalSeen) && totalSeen >= 0, 'Portal recursive entity count is unavailable.');
  assert(totalSeen <= PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit,
    `Portal recursive entity count ${totalSeen} exceeds the trusted ${PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit}-entity workflow limit.`);
  return {
    total_seen: totalSeen,
    recursive_limit: PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit,
    headroom_entities: PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit - totalSeen,
    within_trusted_policy: true
  };
}

if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${safeError(error).message}\n`);
    process.exitCode = 1;
  });
}

export async function main(argv, dependencies = {}) {
  const options = parseArgs(argv);
  if (!options.command) throw new Error(usage());
  if (!['prepare', 'status', 'apply', 'verify-reopen'].includes(options.command)) throw new Error(usage());
  if (LIVE_COMMANDS.has(options.command)) {
    assertExplicitLiveOptIn(options, { requireActiveSavedCopy: options.command === 'verify-reopen' });
    dependencies.stderr?.write?.(dangerMessage(options.command));
    if (!dependencies.stderr) process.stderr.write(dangerMessage(options.command));
  }
  const bridge = dependencies.bridge || createProductionBridge(options);
  const result = await runCommand(options, { ...dependencies, bridge });
  const safe = sanitizeForEvidence(result);
  assertNoSensitiveEvidence(safe);
  const output = `${JSON.stringify(safe, null, 2)}\n`;
  if (dependencies.stdout?.write) dependencies.stdout.write(output);
  else process.stdout.write(output);
  return safe;
}

export async function runCommand(options, dependencies = {}) {
  const bridge = dependencies.bridge;
  if (!bridge) throw new Error('run-real-model-boolean-live requires a bridge dependency.');
  if (options.command === 'prepare') return prepareWorkflow(options, { ...dependencies, bridge });
  if (options.command === 'status') return statusWorkflow(options, { ...dependencies, bridge });
  if (options.command === 'apply') return applyWorkflow(options, { ...dependencies, bridge });
  if (options.command === 'verify-reopen') return verifyReopenWorkflow(options, { ...dependencies, bridge });
  throw new Error(usage());
}

export function assertExplicitLiveOptIn(options = {}, { requireActiveSavedCopy = false } = {}) {
  if (options.runtime !== 'queue' || options.queueRequired !== true || options.disposableCopyConfirmed !== true) {
    throw new Error('Live Portal boolean work requires --runtime queue --queue-required --disposable-copy-confirmed. No queue request was created.');
  }
  if (requireActiveSavedCopy && options.activeSavedCopyConfirmed !== true) {
    throw new Error('verify-reopen requires --active-saved-copy-confirmed after the user manually opens the saved result copy. No queue request was created.');
  }
}

export async function loadPinnedPortalBindings({ fsImpl = fs } = {}) {
  return loadPinnedPortalBindingsForRuntime(PORTAL_BOOLEAN_CURRENT_RUNTIME, { fsImpl });
}

export async function loadHistoricalPinnedPortalBindingsForLocalCapture({ fsImpl = fs } = {}) {
  return loadPinnedPortalBindingsForRuntime(PORTAL_BOOLEAN_V8_LOADED_RUNTIME, { fsImpl });
}

async function loadPinnedPortalBindingsForRuntime(expectedRuntime, { fsImpl }) {
  const loaded = {};
  for (const [label, artifact] of Object.entries(PORTAL_BOOLEAN_BINDING.artifacts)) {
    const buffer = await fsImpl.readFile(artifact.path);
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    assertArtifactHash(label, actualHash, artifact.sha256);
    loaded[label] = JSON.parse(buffer.toString('utf8'));
  }
  assertPinnedCapabilities(loaded.capabilities, { expectedRuntime });
  assertQueueIdle(loaded.queue_before);
  assertPinnedStructuralEvidence(loaded.structural);
  assertPinnedPortalReview(loaded.review);
  assertQueueIdle(loaded.queue_after);
  return {
    ...loaded,
    lineage: publicPinnedLineage()
  };
}

export function assertArtifactHash(label, actual, expected) {
  if (actual !== expected) throw new Error(`Pinned ${label} artifact hash drifted; expected ${expected}, received ${actual}.`);
}

export function assertPinnedCapabilities(value, { expectedRuntime = PORTAL_BOOLEAN_CURRENT_RUNTIME } = {}) {
  const runtime = value?.runtime;
  assert(runtime?.name === 'queue', 'Pinned capability evidence must be queue runtime.');
  assert(runtime?.capability_version === PORTAL_BOOLEAN_BINDING.capability_version, 'Pinned capability version drifted.');
  assert(runtime?.manifest_version === PORTAL_BOOLEAN_BINDING.manifest_version, 'Pinned manifest version drifted.');
  assert(runtime?.read_only_probes?.structural_groups?.version === PORTAL_BOOLEAN_BINDING.structural_groups_version, 'Pinned structural probe capability drifted.');
  assert(runtime?.read_only_probes?.structural_groups?.mutates_model === false, 'Pinned structural probe must be read-only.');
  assert(runtime?.supported_operations?.includes(PORTAL_BOOLEAN_BINDING.operation), 'Pinned runtime does not expose boolean_difference.');
  assert(runtime?.model_revision?.strategy === expectedRuntime.model_revision_strategy, 'Pinned runtime model revision strategy drifted.');
  assert(runtime?.model_revision?.unique_entity_limit === expectedRuntime.model_revision_unique_entity_limit, 'Pinned runtime model revision safety limit drifted.');
  assert(runtime?.boolean_operations_sha256 === expectedRuntime.boolean_operations_sha256, 'Pinned runtime Boolean source attestation drifted.');
  assert(runtime?.model_revision_source_sha256 === expectedRuntime.model_revision_source_sha256, 'Pinned runtime Model Revision source attestation drifted.');
}

export function assertPinnedStructuralEvidence(value) {
  assert(value?.kind === 'adopt_open_model' && value?.runtime === 'queue' && value?.read_only === true, 'Pinned structural evidence must be a live read-only adoption.');
  assert(value?.model_info?.source_path === PORTAL_BOOLEAN_BINDING.source_path, 'Pinned structural source_path drifted.');
  assert(value?.document_id === PORTAL_BOOLEAN_BINDING.document_id, 'Pinned structural document_id drifted.');
  assertCompleteRevision(value, PORTAL_BOOLEAN_BINDING.model_revision, {
    expectedStrategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
    expectedLimit: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit
  });
  assert(value?.model_modified === false, 'Pinned structural discovery must come from a clean model.');
  assertStructuralPair(value, {
    expectedRevision: PORTAL_BOOLEAN_BINDING.model_revision,
    expectedSourcePath: PORTAL_BOOLEAN_BINDING.source_path,
    expectedGroupCount: PORTAL_BOOLEAN_BINDING.baseline_group_count,
    requireBaselineGeometry: true
  });
}

export function assertPinnedPortalReview(value) {
  const recommendation = value?.review?.recommended_proposal;
  assert(value?.version === 'real-model-recursive-target-review.v2', 'Pinned recursive review must use the v2 bbox/exact-solid contract.');
  assert(value?.kind === 'real_model_recursive_target_review' && value?.runtime === 'offline' && value?.live_queue_called === false, 'Pinned recursive review must remain offline.');
  assert(value?.source?.sha256 === `sha256:${PORTAL_BOOLEAN_BINDING.source_sha256}`, 'Pinned recursive review source hash drifted.');
  assert(value?.model?.revision === PORTAL_BOOLEAN_BINDING.model_revision && value?.model?.revision_complete === true, 'Pinned recursive review revision drifted or is incomplete.');
  assert(value?.model?.revision_strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy, 'Pinned recursive review model revision strategy drifted.');
  assert(value?.model?.revision_unique_entity_limit === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit, 'Pinned recursive review model revision safety limit drifted.');
  assert(value?.model?.document_id === PORTAL_BOOLEAN_BINDING.document_id, 'Pinned recursive review document_id drifted.');
  assert(value?.model?.model_identity_sha256 === PORTAL_BOOLEAN_BINDING.model_identity_sha256, 'Pinned recursive review model identity drifted.');
  assert(value?.review?.status === 'server_recommended' && value?.review?.operation === 'difference', 'Pinned recursive review is no longer server_recommended difference.');
  assert(recommendation?.target?.entity_path === PORTAL_BOOLEAN_BINDING.target_path, 'Pinned recursive target path drifted.');
  assert(recommendation?.tool?.entity_path === PORTAL_BOOLEAN_BINDING.tool_path, 'Pinned recursive tool path drifted.');
  assert(recommendation?.bbox_relation === 'containment' && recommendation?.positive_bbox_overlap === true, 'Pinned v2 review no longer carries positive AABB containment.');
  assert(JSON.stringify(recommendation?.exact_solid_overlap) === JSON.stringify(PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE.exact_solid_overlap),
    'Pinned v2 review exact-solid status drifted from the unverified atomic-trial disclosure.');
  assert(recommendation?.atomic_boolean_trial_eligible === true, 'Pinned v2 review no longer marks this pair eligible for a review-gated atomic trial.');
  for (const role of ['target', 'tool']) {
    const attestation = recommendation?.[role]?.manifold_attestation;
    assert(attestation?.status === 'fresh_manifold' && attestation?.exact_fresh_match === true && attestation?.is_manifold === true, `Pinned ${role} manifold attestation is not exact/fresh/manifold.`);
    assert(attestation?.attested_model_revision === PORTAL_BOOLEAN_BINDING.model_revision, `Pinned ${role} manifold revision drifted.`);
  }
  assert(recommendation?.confirmed === false && recommendation?.authorized === false && recommendation?.trusted_approval_required === true, 'Pinned recommendation must remain unconfirmed, unauthorized, and approval-gated.');
  assert(value?.safety?.model_mutation_authorized === false && value?.next_action?.mutation_authorized === false, 'Pinned review must not authorize mutation.');
  assert(value?.next_action?.approval_token_issued === false, 'Pinned review must not issue an approval token.');
}

export function buildPortalBooleanTaskInputs(runDir) {
  assertDirectChildRunDir(runDir, OUTPUT_ROOT);
  const savePath = path.join(runDir, 'approved-model.skp');
  assert(!samePath(savePath, PORTAL_BOOLEAN_BINDING.source_path), 'save_path must never overwrite the disposable source copy.');
  const target = persistentTarget(PORTAL_BOOLEAN_BINDING.target_path);
  const tool = persistentTarget(PORTAL_BOOLEAN_BINDING.tool_path);
  return {
    runtime: 'queue',
    recursive_limit: PORTAL_BOOLEAN_BINDING.recursive_limit,
    budgets: {
      max_operations: 1,
      max_affected_instances: 2,
      recursive_limit: PORTAL_BOOLEAN_BINDING.recursive_limit
    },
    save_model: true,
    save_path: savePath,
    capture_view: false,
    targets: [target, tool],
    operations: [{
      op: PORTAL_BOOLEAN_BINDING.operation,
      ...target,
      tools: [{ ...tool }],
      result_id: PORTAL_BOOLEAN_BINDING.result_id,
      result_name: PORTAL_BOOLEAN_BINDING.result_name,
      keep_originals: true,
      keep_tools: true
    }]
  };
}

export function assertPreparedTask(task, { expectedRevision } = {}) {
  assert(/^sha256:[0-9a-f]{64}$/.test(String(expectedRevision || '')), 'Prepared task validation requires the current v2 model revision.');
  assert(task?.ok === true, `Portal boolean task preparation failed: ${task?.error?.code || 'unknown_error'}.`);
  assert(task?.task_state === 'awaiting_review', `Portal boolean task must stop at awaiting_review, received ${task?.task_state || 'unknown'}.`);
  assert(task?.result?.kind === 'reviewed_existing_model_edit_proposal', 'Portal boolean task returned the wrong proposal kind.');
  assert(task?.result?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Portal boolean task must be S3.');
  assert(task?.result?.model_revision === expectedRevision, 'Prepared plan revision drifted.');
  assert(task?.result?.operation_count === 1, 'Prepared plan must contain exactly one operation.');
  assert(Array.isArray(task?.result?.blockers) && task.result.blockers.length === 0, 'Prepared plan has blockers.');
  assert(typeof task?.result?.plan_id === 'string' && typeof task?.result?.plan_hash === 'string', 'Prepared plan has no stable plan binding.');
  assert(typeof task?.result?.approval_challenge?.challenge_id === 'string', 'Prepared task has no approval challenge.');
  assertApprovalChallengeBinding(task.result.approval_challenge, {
    taskId: task.task_id,
    planId: task.result.plan_id,
    planHash: task.result.plan_hash,
    reviewContextSha256: sha256Canonical(task.result.approval_challenge.review_context),
    expectedRevision
  });
  assertApprovalReviewContext(task.result.approval_challenge.review_context, {
    planId: task.result.plan_id
  });
  assert(task?.next_action?.action === 'request_user_approval', 'Prepared task must request trusted user approval.');
  assertNoPublicApprovalToken(task);
  assert(task?.next_action?.approval_host?.user_presence_required === true, 'Prepared task does not require trusted local user presence.');
  assert(typeof task?.next_action?.approval_host?.url === 'string', 'Prepared task has no local approval URL.');
}

export function assertTrustedApprovalReady(task, expectedRevision) {
  const state = taskState(task);
  assert(state === 'awaiting_review', `Task must remain awaiting_review before apply; received ${state || 'unknown'}.`);
  assert(task?.result?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Only the pinned S3 task may be applied.');
  assert(task?.result?.model_revision === expectedRevision, 'Approved task revision does not match the prepared v2 revision.');
  assert(task?.next_action?.approval_status === 'approved_pending_execution', 'Trusted local approval is not approved_pending_execution. No queue request was created.');
  assertNoPublicApprovalToken(task);
}

export function assertNoPublicApprovalToken(value) {
  const serialized = JSON.stringify(value);
  assert(!/"approval_token(?:_hash)?"\s*:/i.test(serialized), 'Public task output exposed an approval token to the Agent.');
  return true;
}

export function classifyApplyAttempt({ task, prepareRecord, applyRecord = null, failureRecord = null } = {}) {
  if (failureRecord) {
    if (failureRecord.rollback_confirmed === true && failureRecord.mutation_committed === false) {
      throw new Error('A prior attempt was confirmed aborted before commit. The consumed task/approval cannot be replayed; correct the candidate or implementation and create a new reviewed task.');
    }
    if (failureRecord.outcome_unknown === true) {
      throw new Error('A prior post-submit attempt has no confirmed durable receipt. Outcome is unknown; inspect/resume the task and active disposable copy. Automatic replay is forbidden.');
    }
    throw new Error('A prior post-submit attempt has a committed/recoverable mutation but incomplete workflow QA. Resume/finalize and inspect it; automatic mutation replay is forbidden.');
  }
  if (taskState(task) === 'completed') {
    assert(applyRecord?.live_mutation_performed === true && applyRecord?.task_state === 'completed', 'Completed task has no matching safe apply evidence; do not replay it.');
    return { action: 'return_idempotent_evidence', idempotent_replay: true };
  }
  assertTrustedApprovalReady(task, prepareRecord?.model?.revision);
  return { action: 'execute_once', idempotent_replay: false };
}

export function sanitizeForEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeForEvidence);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value.replace(/hmac_sha256:[A-Za-z0-9_-]+/g, '[REDACTED_SESSION_SIGNATURE]');
    return value;
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (['approval_token', 'signature', 'nonce', 'session_contract'].includes(key.toLowerCase())) continue;
    result[key] = sanitizeForEvidence(child);
  }
  return result;
}

export function assertNoSensitiveEvidence(value) {
  const serialized = JSON.stringify(value);
  assert(!/hmac_sha256:[A-Za-z0-9_-]+/.test(serialized), 'Evidence contains a Session Contract signature.');
  assert(!/"(?:approval_token|signature|nonce|session_contract)"\s*:/.test(serialized), 'Evidence contains a private authorization/session field.');
}

export async function assertInstalledBooleanSource({
  fsImpl = fs,
  workspacePath = WORKSPACE_BOOLEAN_SOURCE,
  installedPath = INSTALLED_BOOLEAN_SOURCE,
  workspaceModelRevisionPath = WORKSPACE_MODEL_REVISION_SOURCE,
  installedModelRevisionPath = INSTALLED_MODEL_REVISION_SOURCE
} = {}) {
  const [workspace, installed, workspaceModelRevision, installedModelRevision] = await Promise.all([
    fsImpl.readFile(workspacePath),
    fsImpl.readFile(installedPath),
    fsImpl.readFile(workspaceModelRevisionPath),
    fsImpl.readFile(installedModelRevisionPath)
  ]);
  const workspaceSha256 = crypto.createHash('sha256').update(workspace).digest('hex');
  const installedSha256 = crypto.createHash('sha256').update(installed).digest('hex');
  const workspaceModelRevisionSha256 = crypto.createHash('sha256').update(workspaceModelRevision).digest('hex');
  const installedModelRevisionSha256 = crypto.createHash('sha256').update(installedModelRevision).digest('hex');
  assert(
    workspaceSha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256,
    `Workspace boolean_operations.rb does not match the tracked runtime source attestation (${PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256}). Regenerate the runtime source manifest before live work. No queue request was created.`
  );
  assert(
    workspaceSha256 === installedSha256,
    `Installed boolean_operations.rb does not match the current workspace source (workspace=${workspaceSha256}, installed=${installedSha256}). Reinstall the plugin and fully restart SketchUp before live work. No queue request was created.`
  );
  assert(
    workspaceModelRevisionSha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
    `Workspace model_revision.rb does not match the tracked runtime source attestation (${PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256}). Regenerate the runtime source manifest before live work. No queue request was created.`
  );
  assert(
    workspaceModelRevisionSha256 === installedModelRevisionSha256,
    `Installed model_revision.rb does not match the current workspace source (workspace=${workspaceModelRevisionSha256}, installed=${installedModelRevisionSha256}). Reinstall the plugin and fully restart SketchUp before live work. No queue request was created.`
  );
  return {
    boolean_operations: {
      workspace_sha256: workspaceSha256,
      installed_sha256: installedSha256,
      exact_match: true
    },
    model_revision: {
      workspace_sha256: workspaceModelRevisionSha256,
      installed_sha256: installedModelRevisionSha256,
      exact_match: true
    },
    exact_match: true,
    installed_path_exposed: false
  };
}

export function assertQueueIdle(value) {
  const summary = summarizeQueue(value);
  if (summary.queue !== 0 || summary.processing !== 0 || summary.responses !== 0 || summary.lock_exists !== false) {
    throw new Error(`Queue is not idle: ${JSON.stringify(summary)}`);
  }
}

export function summarizeQueue(value) {
  const diagnostics = value?.diagnostics || value;
  return {
    queue: diagnosticCount(diagnostics?.queue_count, diagnostics?.queue),
    processing: diagnosticCount(diagnostics?.processing_count, diagnostics?.processing),
    responses: diagnosticCount(diagnostics?.response_count, diagnostics?.responses),
    lock_exists: diagnosticLockState(diagnostics)
  };
}

export function assertLivePortalBinding({ capabilities, handshake, adoption, expectedRevision, expectedSourcePath = PORTAL_BOOLEAN_BINDING.source_path } = {}) {
  const runtime = capabilities?.runtime;
  assert(runtime?.capability_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version, 'Live capability version is not the current capability .7 contract.');
  assert(runtime?.manifest_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version, 'Live manifest version drifted.');
  assert(runtime?.model_revision?.strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy, 'Live runtime model revision strategy is not definition-merkle.v2.');
  assert(runtime?.model_revision?.unique_entity_limit === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit, 'Live runtime model revision safety limit drifted.');
  assert(runtime?.supported_operations?.includes(PORTAL_BOOLEAN_BINDING.operation), 'Live runtime does not expose boolean_difference.');
  assert(runtime?.read_only_probes?.structural_groups?.version === PORTAL_BOOLEAN_BINDING.structural_groups_version, 'Live runtime does not expose structural-groups.v1.');
  assert(runtime?.boolean_operations_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256, 'Live runtime did not attest the exact loaded boolean_operations.rb source.');
  assert(runtime?.model_revision_source_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256, 'Live runtime did not attest the exact loaded model_revision.rb source.');
  const session = handshake?.session_contract;
  assert(session?.kind === 'fresh_queue_handshake' && session?.runtime === 'queue', 'Live handshake kind/runtime is invalid.');
  assert(session?.queue_state === 'idle', 'Live handshake was not issued against an idle queue.');
  assert(session?.capability_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version, 'Live handshake capability version drifted.');
  assert(session?.manifest_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version, 'Live handshake manifest version drifted.');
  assert(session?.model_revision_strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy, 'Live handshake model revision strategy drifted.');
  assert(session?.model_revision_unique_entity_limit === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit, 'Live handshake model revision safety limit drifted.');
  assert(session?.boolean_operations_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256, 'Live handshake Boolean source attestation drifted.');
  assert(session?.model_revision_source_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256, 'Live handshake Model Revision source attestation drifted.');
  assert(session?.model_modified === false, 'Live Portal prepare/apply requires a clean saved disposable copy; the active model has unsaved changes.');
  assert(typeof session?.session_id === 'string' && session.session_id.length > 0, 'Live handshake session binding is missing.');
  assert(typeof session?.document_id === 'string' && session.document_id.length > 0, 'Live handshake document binding is missing.');
  assert(session?.model_identity?.source_path === expectedSourcePath, 'Live active source_path is not the required disposable copy.');
  const boundRevision = expectedRevision || session?.model_revision;
  assert(/^sha256:[0-9a-f]{64}$/.test(String(boundRevision || '')), 'Live handshake has no valid current v2 revision binding.');
  assert(session?.model_revision === boundRevision && session?.model_revision_complete === true, 'Live handshake revision drifted or is incomplete.');
  assert(typeof session?.signature === 'string' && session.signature.startsWith('hmac_sha256:'), 'Live handshake has no private signature.');
  assertCompleteRevision(adoption, boundRevision);
  assertPortalRecursiveIndexCapacity(adoption.model_revision_total_seen);
  assert(adoption?.model_modified === false, 'Live read-only adoption reports unsaved model changes.');
  assert(adoption?.model_info?.source_path === expectedSourcePath, 'Live adoption source_path is not the required disposable copy.');
  assert(adoption?.document_id === session?.document_id, 'Live adoption document differs from the fresh handshake.');
  assert(adoption?.session_id === session?.session_id, 'Live adoption session differs from the fresh handshake.');
  assertStructuralPair(adoption, {
    expectedRevision: boundRevision,
    expectedSourcePath,
    expectedGroupCount: PORTAL_BOOLEAN_BINDING.baseline_group_count,
    requireBaselineGeometry: true
  });
  return boundRevision;
}

export function assertReopenSessionBinding(handshake, adoption) {
  const session = handshake?.session_contract;
  assert(session?.kind === 'fresh_queue_handshake' && session?.runtime === 'queue', 'Reopened Session Contract kind/runtime is invalid.');
  assert(session?.queue_state === 'idle', 'Reopened Session Contract was not issued against an idle queue.');
  assert(session?.capability_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version && session?.manifest_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version, 'Reopened Session Contract capability/manifest binding drifted.');
  assert(session?.model_revision_strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy, 'Reopened Session Contract model revision strategy drifted.');
  assert(session?.model_revision_unique_entity_limit === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit, 'Reopened Session Contract model revision safety limit drifted.');
  assert(session?.boolean_operations_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256, 'Reopened Session Contract Boolean source attestation drifted.');
  assert(session?.model_revision_source_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256, 'Reopened Session Contract Model Revision source attestation drifted.');
  assert(session?.model_modified === false, 'Reopened saved result has unsaved changes and cannot prove save/reopen stability.');
  assert(session?.model_revision_complete === true && /^sha256:[0-9a-f]{64}$/.test(String(session?.model_revision || '')), 'Reopened Session Contract revision binding is incomplete.');
  assert(typeof session?.signature === 'string' && session.signature.startsWith('hmac_sha256:'), 'Reopened Session Contract has no private signature.');
  assert(adoption?.session_id === session.session_id, 'Reopened adoption session differs from the fresh Session Contract.');
  assert(adoption?.document_id === session.document_id, 'Reopened adoption document differs from the fresh Session Contract.');
  assert(adoption?.model_info?.source_path === session.model_identity?.source_path, 'Reopened adoption source path differs from the fresh Session Contract.');
  assert(adoption?.model_revision === session.model_revision && adoption?.model_revision_complete === true, 'Reopened adoption revision differs from the fresh Session Contract or is incomplete.');
  assert(adoption?.model_revision_strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy, 'Reopened adoption model revision strategy drifted.');
  assert(adoption?.model_modified === false, 'Reopened adoption reports unsaved changes.');
  return true;
}

export async function prepareWorkflow(options, { bridge, fsImpl = fs } = {}) {
  await loadPinnedPortalBindings({ fsImpl });
  await assertSourceHashUnchanged({ fsImpl });
  const installedBooleanSource = await assertInstalledBooleanSource({ fsImpl });
  const existing = await loadLatest({ fsImpl, allowMissing: true });
  let supersededLineage = null;
  if (existing) {
    const previous = await readJson(path.join(existing.run_dir, 'prepare.json'), fsImpl);
    const supersededSecurityContract = portalPrepareReuseDisposition(previous) === 'superseded';
    if (!supersededSecurityContract) {
      assertRunRecordBinding(previous, existing);
      const persistedTask = await readPersistedPortalTask(bridge, existing.task_id);
      assertPortalTaskBinding(persistedTask, previous, existing);
      const task = await bridge.resume_agent_task({ task_id: existing.task_id });
      assertPortalTaskBinding(task, previous, existing);
      if (['awaiting_review', 'completed'].includes(task?.task_state)) {
        const replay = {
          ...previous,
          replayed_prepare: true,
          live_queue_called_for_replay: false,
          next_action: task.task_state === 'completed' ? null : previous.next_action
        };
        assertNoSensitiveEvidence(replay);
        return replay;
      }
      throw new Error(`Existing Portal boolean task ${existing.task_id} is ${task?.task_state || 'unknown'}; inspect status instead of creating another challenge.`);
    }
    supersededLineage = await recordSupersededPortalRun(existing, previous, fsImpl);
  }

  const runDir = await createExclusiveRunDir(fsImpl);
  const taskInputs = buildPortalBooleanTaskInputs(runDir);
  let sourceShaBefore = null;
  let sourceShaAfter = null;
  let capabilities = null;
  let queueBefore = null;
  let queueAfter = null;
  let handshake = null;
  let adoption = null;
  let task = null;
  let preparePersisted = false;
  let latestUpdated = false;
  try {
    sourceShaBefore = await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl);
    capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: options.timeoutMs });
    queueBefore = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
    assertQueueIdle(queueBefore);
    handshake = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs: options.timeoutMs });
    adoption = await readOnlyPairAdoption(bridge, options.timeoutMs);
    const currentRevision = assertLivePortalBinding({
      capabilities,
      handshake,
      adoption,
      expectedRevision: PORTAL_BOOLEAN_BINDING.model_revision
    });
    assert(sourceShaBefore === PORTAL_BOOLEAN_BINDING.source_sha256, 'Disposable source hash drifted during prepare preflight.');

    task = await bridge.start_agent_task({
      intent: 'reviewed_existing_model_edit',
      instruction: pinnedInstruction(),
      interface_level: 'guided',
      client_capabilities: { vision: false, local_files: false, structured_output: true, parallel: false, context: 'short' },
      idempotency_key: portalIdempotencyKey('prepare', currentRevision),
      inputs: taskInputs
    });
    assertPreparedTask(task, { expectedRevision: currentRevision });
    const approvalExecution = task.result.approval_challenge.review_context.execution;
    queueAfter = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
    assertQueueIdle(queueAfter);
    sourceShaAfter = await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl);
    assert(sourceShaAfter === sourceShaBefore, 'Disposable source file changed during prepare.');

    const record = {
    version: PORTAL_BOOLEAN_LIVE_VERSION,
    kind: 'portal_structure_s3_boolean_prepare',
    run_id: path.basename(runDir),
    prepared_at: new Date().toISOString(),
    task_id: task.task_id,
    task_state: task.task_state,
    runtime: 'queue',
    risk_level: task.result.risk_level,
    plan_id: task.result.plan_id,
    plan_hash: task.result.plan_hash,
    source: {
      path: PORTAL_BOOLEAN_BINDING.source_path,
      sha256_before: sourceShaBefore,
      sha256_after: sourceShaAfter,
      file_unchanged: true,
      disposable_copy_only: true
    },
    model: {
      document_id: adoption.document_id,
      revision: adoption.model_revision,
      revision_strategy: adoption.model_revision_strategy,
      revision_source_sha256: handshake.session_contract.model_revision_source_sha256,
      revision_complete: adoption.model_revision_complete === true,
      modified: adoption.model_modified
    },
    pair: publicPairSummary(adoption),
    operation: publicOperationSummary(taskInputs.operations[0]),
    geometry_validation: structuredClone(PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE),
    save: {
      requested_base_path: taskInputs.save_path,
      final_path: approvalExecution.final_save_path,
      final_path_matches_versioned_plan: approvalExecution.final_save_path === versionedModelSavePath(taskInputs.save_path, task.result.plan_id),
      overwrite_existing: approvalExecution.overwrite_existing,
      overwrites_source: false,
      save_copy_required: true
    },
    approval: {
      challenge_id: task.result.approval_challenge.challenge_id,
      review_context_sha256: sha256Canonical(task.result.approval_challenge.review_context),
      expires_at: task.result.approval_challenge.expires_at,
      url: task.next_action.approval_host.url,
      state: 'awaiting_trusted_user',
      trusted_token_copied_to_evidence: false,
      agent_self_approval_accepted: false
    },
    live_preflight: {
      recursive_index_policy: {
        mode: 'complete_recursive_index',
        preflight_observed_entity_count: adoption.model_revision_total_seen,
        requested_recursive_limit: taskInputs.recursive_limit,
        server_max_recursive_entities: PORTAL_BOOLEAN_EXECUTION_POLICY.resource_limits.max_recursive_entities,
        generic_prepare_complete_index_validated: true,
        generic_prepare_blockers: [],
        ...assertPortalRecursiveIndexCapacity(adoption.model_revision_total_seen)
      },
      capability_version: capabilities.runtime.capability_version,
      manifest_version: capabilities.runtime.manifest_version,
      model_revision_strategy: capabilities.runtime.model_revision.strategy,
      model_revision_source_sha256: capabilities.runtime.model_revision_source_sha256,
      queue_before: summarizeQueue(queueBefore),
      queue_after: summarizeQueue(queueAfter),
      fresh_handshake: publicSessionSummary(handshake.session_contract),
      current_discovery_evidence: publicPinnedLineage(),
      historical_workflow_lineage: {
        versions: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'],
        lineage_only: true,
        prior_plan_or_approval_replay_allowed: false
      },
      superseded_portal_run: supersededLineage,
      installed_runtime_sources: installedBooleanSource
    },
    live_mutation_performed: false,
    release_acceptance: false,
    next_action: 'A real user must approve this exact S3 plan in the local approval page. Then run apply with the same task_id.'
    };
    assertNoSensitiveEvidence(record);
    await writeJsonExclusive(path.join(runDir, 'prepare.json'), record, fsImpl);
    preparePersisted = true;
    await writeLatest({ version: PORTAL_BOOLEAN_LIVE_VERSION, run_id: record.run_id, run_dir: runDir, task_id: task.task_id }, fsImpl);
    latestUpdated = true;
    return record;
  } catch (error) {
    try {
      if (!queueAfter) queueAfter = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
    } catch {
      queueAfter = null;
    }
    try {
      if (!sourceShaAfter) sourceShaAfter = await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl);
    } catch {
      sourceShaAfter = null;
    }
    const failure = buildPrepareFailureEvidence({
      runDir,
      error,
      task,
      sourceShaBefore,
      sourceShaAfter,
      capabilities,
      queueBefore,
      queueAfter,
      handshake,
      adoption,
      preparePersisted,
      latestUpdated
    });
    try {
      await writeJsonExclusive(path.join(runDir, 'prepare-failure.json'), failure, fsImpl);
    } catch (evidenceError) {
      error.prepare_failure_evidence_error = safeError(evidenceError);
    }
    throw error;
  }
}

export function buildPrepareFailureEvidence({
  runDir,
  error,
  task = null,
  sourceShaBefore = null,
  sourceShaAfter = null,
  capabilities = null,
  queueBefore = null,
  queueAfter = null,
  handshake = null,
  adoption = null,
  preparePersisted = false,
  latestUpdated = false
} = {}) {
  const challenge = task?.result?.approval_challenge;
  const record = {
    version: PORTAL_BOOLEAN_LIVE_VERSION,
    kind: 'portal_structure_s3_boolean_prepare_failure',
    run_id: runDir ? path.basename(runDir) : null,
    recorded_at: new Date().toISOString(),
    runtime: 'queue',
    error: safeError(error),
    task: {
      task_id: task?.task_id || null,
      task_state: taskState(task) || null,
      plan_id: task?.result?.plan_id || null,
      plan_hash: task?.result?.plan_hash || null,
      risk_level: task?.result?.risk_level || null,
      blockers: Array.isArray(task?.result?.blockers) ? sanitizeForEvidence(task.result.blockers) : []
    },
    approval: {
      challenge_issued: typeof challenge?.challenge_id === 'string',
      challenge_id: challenge?.challenge_id || null,
      trusted_token_copied_to_evidence: false,
      agent_self_approval_accepted: false
    },
    source: {
      path: PORTAL_BOOLEAN_BINDING.source_path,
      sha256_before: sourceShaBefore,
      sha256_after: sourceShaAfter,
      file_unchanged: sourceShaBefore && sourceShaAfter ? sourceShaBefore === sourceShaAfter : null
    },
    model: {
      revision: adoption?.model_revision || handshake?.session_contract?.model_revision || null,
      revision_complete: adoption?.model_revision_complete === true || handshake?.session_contract?.model_revision_complete === true,
      modified: adoption?.model_modified ?? handshake?.session_contract?.model_modified ?? null,
      preflight_observed_entity_count: adoption?.model_revision_total_seen ?? null,
      requested_recursive_limit: PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit
    },
    runtime_attestation: capabilities?.runtime ? {
      capability_version: capabilities.runtime.capability_version,
      manifest_version: capabilities.runtime.manifest_version,
      model_revision_strategy: capabilities.runtime.model_revision?.strategy,
      boolean_operations_sha256: capabilities.runtime.boolean_operations_sha256,
      model_revision_source_sha256: capabilities.runtime.model_revision_source_sha256
    } : null,
    queue: {
      before: queueBefore ? summarizeQueue(queueBefore) : null,
      after: queueAfter ? summarizeQueue(queueAfter) : null
    },
    persistence: {
      prepare_json_written: preparePersisted === true,
      latest_json_updated: latestUpdated === true
    },
    live_mutation_performed: false,
    model_save_performed: false,
    automatic_retry_performed: false,
    release_acceptance: false,
    next_action: 'Inspect the failure evidence and durable task state. Do not apply or reuse an unbound approval challenge.'
  };
  const safe = sanitizeForEvidence(record);
  assertNoSensitiveEvidence(safe);
  return safe;
}

async function recordSupersededPortalRun(existing, previous, fsImpl) {
  const markerPath = path.join(existing.run_dir, 'superseded-by-portal-v8.json');
  const marker = {
    version: PORTAL_BOOLEAN_LIVE_VERSION,
    kind: 'portal_structure_s3_boolean_supersession',
    recorded_at: new Date().toISOString(),
    superseded_workflow_version: previous?.version || 'unknown',
    superseded_task_id: existing.task_id,
    superseded_run_id: existing.run_id,
    reason: 'review_v2_candidate_rebinding',
    lineage_only: true,
    current_acceptance: false,
    release_acceptance: false,
    prior_plan_or_approval_replay_allowed: false,
    live_queue_called: false,
    live_mutation_performed: false
  };
  try {
    await writeJsonExclusive(markerPath, marker, fsImpl);
    return marker;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingMarker = await readJson(markerPath, fsImpl);
    assert(existingMarker?.version === marker.version
      && existingMarker?.kind === marker.kind
      && existingMarker?.reason === marker.reason
      && existingMarker?.superseded_task_id === marker.superseded_task_id
      && existingMarker?.superseded_run_id === marker.superseded_run_id
      && existingMarker?.prior_plan_or_approval_replay_allowed === false, 'Existing Portal supersession marker drifted.');
    return existingMarker;
  }
}

export async function statusWorkflow(options, { bridge, fsImpl = fs } = {}) {
  const latest = await requiredLatest(options.taskId, fsImpl);
  await assertSourceHashUnchanged({ fsImpl });
  const prepareRecord = await readJson(path.join(latest.run_dir, 'prepare.json'), fsImpl);
  assertRunRecordBinding(prepareRecord, latest);
  const persistedTask = await readPersistedPortalTask(bridge, latest.task_id);
  if (taskState(persistedTask) === 'failed') assertPortalFailedTaskBinding(persistedTask, prepareRecord, latest);
  else assertPortalTaskBinding(persistedTask, prepareRecord, latest);
  const task = await bridge.resume_agent_task({ task_id: latest.task_id });
  if (taskState(task) === 'failed') assertPortalFailedTaskBinding(task, prepareRecord, latest);
  else assertPortalTaskBinding(task, prepareRecord, latest);
  const taskError = task?.error || task?.last_error || persistedTask?.last_error || null;
  const mutationOutcome = classifyTaskMutationOutcome({
    taskState: taskState(task),
    taskError,
    durableReceiptConfirmed: Boolean(
      task?.result?.mutation_receipt?.receipt_id
      || persistedTask?.result?.mutation_receipt?.receipt_id
    )
  });
  const record = {
    version: PORTAL_BOOLEAN_LIVE_VERSION,
    kind: 'portal_structure_s3_boolean_status',
    checked_at: new Date().toISOString(),
    task_id: task.task_id,
    task_state: task.task_state,
    risk_level: task.result?.risk_level || null,
    plan_id: task.result?.plan_id || null,
    plan_hash: task.result?.plan_hash || null,
    approval_status: task.task_state === 'failed'
      ? 'consumed_failed'
      : task.next_action?.approval_status || (task.task_state === 'completed' ? 'consumed' : 'awaiting_trusted_user'),
    approval_url: task.next_action?.approval_host?.url || null,
    trusted_token_copied_to_evidence: false,
    queue_called: false,
    source_sha256: PORTAL_BOOLEAN_BINDING.source_sha256,
    error: taskError ? { ...safeError(taskError), details: publicMutationFailureDetails(taskError) } : null,
    mutation_outcome: mutationOutcome,
    next_action: task.next_action?.action || taskError?.next_action?.action || null
  };
  assertNoSensitiveEvidence(record);
  await writeJsonAtomic(path.join(latest.run_dir, 'status-latest.json'), record, fsImpl);
  await writeTerminalStatusSnapshot(latest.run_dir, record, fsImpl);
  return record;
}

export async function writeTerminalStatusSnapshot(runDir, record, fsImpl = fs) {
  if (!['completed', 'failed'].includes(record?.task_state)) return null;

  const terminalPath = path.join(runDir, 'status-terminal.json');
  try {
    await writeJsonExclusive(terminalPath, record, fsImpl);
    return structuredClone(record);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  const existing = await readJson(terminalPath, fsImpl);
  const normalize = (value) => ({ ...value, checked_at: null });
  assert(
    sha256Canonical(normalize(existing)) === sha256Canonical(normalize(record)),
    'Immutable terminal status evidence conflicts with the current terminal task state.'
  );
  return existing;
}

export async function applyWorkflow(options, {
  bridge,
  fsImpl = fs,
  loadPinnedBindings = loadPinnedPortalBindings,
  assertSourceBinding = assertSourceHashUnchanged,
  assertInstalledSource = assertInstalledBooleanSource,
  readPersistedTask = readPersistedPortalTask,
  verifyAuthorizationReady = verifyPortalAuthorizationReady
} = {}) {
  const latest = await requiredLatest(options.taskId, fsImpl);
  const prepareRecord = await readJson(path.join(latest.run_dir, 'prepare.json'), fsImpl);
  assertRunRecordBinding(prepareRecord, latest);
  const existingApply = await readJson(path.join(latest.run_dir, 'apply.json'), fsImpl, { allowMissing: true });
  if (existingApply) assertApplyRecordBinding(existingApply, prepareRecord, latest);
  const existingFailure = await firstExistingJson([
    path.join(latest.run_dir, 'apply-precommit-abort.json'),
    path.join(latest.run_dir, 'apply-outcome-unknown.json'),
    path.join(latest.run_dir, 'apply-post-submit-failure.json')
  ], fsImpl);
  const persistedTask = await readPersistedTask(bridge, latest.task_id);
  if (taskState(persistedTask) === 'failed') assertPortalFailedTaskBinding(persistedTask, prepareRecord, latest);
  else assertPortalTaskBinding(persistedTask, prepareRecord, latest);
  const taskBefore = await bridge.resume_agent_task({ task_id: latest.task_id });
  if (taskState(taskBefore) === 'failed') assertPortalFailedTaskBinding(taskBefore, prepareRecord, latest);
  else assertPortalTaskBinding(taskBefore, prepareRecord, latest);
  const decision = classifyApplyAttempt({ task: taskBefore, prepareRecord, applyRecord: existingApply, failureRecord: existingFailure });
  if (decision.action === 'return_idempotent_evidence') {
    return { ...existingApply, idempotent_replay: true, live_queue_called_for_replay: false };
  }

  const authorizationReady = await verifyAuthorizationReady(bridge, latest.task_id);
  assertPortalAuthorizationReady(authorizationReady, prepareRecord, latest);

  await loadPinnedBindings({ fsImpl });
  await assertSourceBinding({ fsImpl });
  await assertInstalledSource({ fsImpl });
  await assertPortalSaveTargetAvailable({
    runDir: latest.run_dir,
    finalPath: prepareRecord.save.final_path,
    fsImpl
  });

  const sourceShaBefore = await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl);
  let submissionStarted = false;
  let submissionResult = null;
  try {
    const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: options.timeoutMs });
    const queueBefore = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
    assertQueueIdle(queueBefore);
    const handshake = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs: options.timeoutMs });
    const adoptionBefore = await readOnlyPairAdoption(bridge, options.timeoutMs);
    assertLivePortalBinding({ capabilities, handshake, adoption: adoptionBefore, expectedRevision: prepareRecord.model.revision });
    const sourceShaPreSubmit = await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl);
    assert(sourceShaPreSubmit === sourceShaBefore, 'Disposable source hash drifted immediately before submit.');

    submissionStarted = true;
    const result = await bridge.submit_agent_task_input({
      task_id: latest.task_id,
      idempotency_key: portalIdempotencyKey('apply', prepareRecord.model.revision),
      input: {
        session_contract: handshake.session_contract,
        note: 'Approved by the independently authenticated local approval host for the pinned Portal Structure S3 boolean pair.'
      }
    });
    submissionResult = result;
    if (result?.ok !== true || result?.task_state !== 'completed') {
      const error = new Error(`Reviewed mutation did not complete: ${result?.error?.code || result?.task_state || 'unknown'}.`);
      error.code = result?.error?.code || 'MUTATION_OUTCOME_UNCONFIRMED';
      throw error;
    }
    const queueAfterSubmit = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
    assertQueueIdle(queueAfterSubmit);

    const postPhase1 = await readOnlyStructuralAdoption(bridge, options.timeoutMs, [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path]);
    const postSummary = assertPostApplyPhase1(postPhase1, adoptionBefore);
    const postPhase2 = await readOnlyStructuralAdoption(bridge, options.timeoutMs, [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path, postSummary.result_path]);
    const postAudit = assertPostApplyPhase2(postPhase2, postPhase1, postSummary);
    const queueAfterAudit = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
    assertQueueIdle(queueAfterAudit);
    const sourceShaAfter = await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl);
    assert(sourceShaAfter === sourceShaBefore, 'Disposable source file was overwritten by apply.');
    const savedCopy = await findSavedCopy(latest.run_dir, fsImpl);
    assert(samePath(savedCopy, prepareRecord.save.final_path), 'SketchUp saved a model artifact outside the exact approved final save target.');
    const savedCopySha = await sha256File(savedCopy, fsImpl);

    const record = {
      version: PORTAL_BOOLEAN_LIVE_VERSION,
      kind: 'portal_structure_s3_boolean_apply',
      applied_at: new Date().toISOString(),
      task_id: latest.task_id,
      task_state: result.task_state,
      ok: true,
      plan_id: prepareRecord.plan_id,
      plan_hash: prepareRecord.plan_hash,
      idempotency_key_sha256: sha256Text(portalIdempotencyKey('apply', prepareRecord.model.revision)),
      risk_level: result.result?.risk_level || PORTAL_BOOLEAN_BINDING.risk_level,
      authorization: {
        mode: result.result?.authorization?.mode || 'trusted_local_approval',
        challenge_id: result.result?.authorization?.challenge_id || prepareRecord.approval.challenge_id,
        trusted_token_copied_to_evidence: false,
        agent_self_approval_accepted: false
      },
      source: {
        path: PORTAL_BOOLEAN_BINDING.source_path,
        sha256_before: sourceShaBefore,
        sha256_after: sourceShaAfter,
        file_unchanged: true
      },
      model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
      model_revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
      model_revision_before: prepareRecord.model.revision,
      model_revision_after: postPhase2.model_revision,
      pair: publicPairSummary(postPhase2),
      result: postAudit,
      saved_copy: {
        path: savedCopy,
        approved_final_path: prepareRecord.save.final_path,
        exact_approved_target: true,
        sha256: savedCopySha,
        source_overwritten: false,
        active_source_identity_preserved: postPhase2.model_info.source_path === PORTAL_BOOLEAN_BINDING.source_path
      },
      queues: {
        before: summarizeQueue(queueBefore),
        after_submit: summarizeQueue(queueAfterSubmit),
        after_audit: summarizeQueue(queueAfterAudit)
      },
      mutation_receipt: result.result?.mutation_receipt || null,
      failure_policy: outcomeUnknownPolicy(),
      live_mutation_performed: true,
      duplicate_mutation_performed: false,
      release_acceptance: false,
      next_action: 'Manually open the saved copy, then run verify-reopen with explicit active-copy confirmation.'
    };
    assertNoSensitiveEvidence(record);
    await writeJsonExclusive(path.join(latest.run_dir, 'apply.json'), record, fsImpl);
    return record;
  } catch (error) {
    if (!submissionStarted) throw error;
    const failure = buildOutcomeUnknownEvidence({
      taskId: latest.task_id,
      runId: latest.run_id,
      error,
      sourceShaBefore,
      sourceShaAfter: await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl).catch(() => null),
      durableReceipt: submissionResult?.result?.mutation_receipt
        || submissionResult?.error?.details?.receipt_id
        || null,
      taskState: submissionResult?.task_state || null,
      taskError: submissionResult?.error || null
    });
    assertNoSensitiveEvidence(failure);
    const failureName = failure.rollback_confirmed
      ? 'apply-precommit-abort.json'
      : failure.outcome_unknown
        ? 'apply-outcome-unknown.json'
        : 'apply-post-submit-failure.json';
    await writeJsonExclusive(path.join(latest.run_dir, failureName), failure, fsImpl).catch(async (writeError) => {
      if (writeError?.code !== 'EEXIST') throw writeError;
    });
    throw new Error(`${failure.error.code}: ${failure.error.message} ${failure.next_action}`);
  }
}

export async function verifyReopenWorkflow(options, { bridge, fsImpl = fs } = {}) {
  const latest = await requiredLatest(options.taskId, fsImpl);
  const prepareRecord = await readJson(path.join(latest.run_dir, 'prepare.json'), fsImpl);
  assertRunRecordBinding(prepareRecord, latest);
  const persistedTask = await readPersistedPortalTask(bridge, latest.task_id);
  assertPortalTaskBinding(persistedTask, prepareRecord, latest);
  const applyRecord = await readJson(path.join(latest.run_dir, 'apply.json'), fsImpl);
  assertApplyRecordBinding(applyRecord, prepareRecord, latest);
  await assertSourceHashUnchanged({ fsImpl });
  const installedBooleanSource = await assertInstalledBooleanSource({ fsImpl });
  const savedPath = applyRecord?.saved_copy?.path;
  assertDirectChildFile(savedPath, latest.run_dir);
  const savedShaBefore = await sha256File(savedPath, fsImpl);
  assert(savedShaBefore === applyRecord.saved_copy.sha256, 'Saved result copy hash drifted before reopen verification.');
  const queueBefore = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
  assertQueueIdle(queueBefore);
  const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: options.timeoutMs });
  const handshake = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs: options.timeoutMs });
  const expectedPaths = [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path, applyRecord.result.result_path];
  const reopened = await readOnlyStructuralAdoption(bridge, options.timeoutMs, expectedPaths);
  assert(capabilities?.runtime?.capability_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version
    && capabilities?.runtime?.manifest_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version
    && capabilities?.runtime?.model_revision?.strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy
    && capabilities?.runtime?.boolean_operations_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256
    && capabilities?.runtime?.model_revision_source_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256, 'Reopen verification capability/source binding drifted.');
  assertReopenSessionBinding(handshake, reopened);
  assert(handshake?.session_contract?.model_identity?.source_path === savedPath, 'The saved result copy is not the active SketchUp document.');
  assert(handshake?.session_contract?.model_revision === applyRecord.model_revision_after, 'Reopened Session Contract revision differs from apply evidence.');
  assert(reopened?.model_info?.source_path === savedPath, 'Reopened adoption is not routed to the saved result copy.');
  assertCompleteRevision(reopened, applyRecord.model_revision_after);
  const reopenedAudit = assertPostApplyPhase2(reopened, reopened, {
    result_path: applyRecord.result.result_path,
    result_name: PORTAL_BOOLEAN_BINDING.result_name,
    before_group_count: PORTAL_BOOLEAN_BINDING.baseline_group_count,
    after_group_count: PORTAL_BOOLEAN_BINDING.baseline_group_count + 1
  });
  assert(structuralIdentityHash(reopened) === applyRecord.result.structural_identity_sha256, 'Structural identity drifted across save/reopen.');
  const queueAfter = await bridge.queue_diagnostics({ includeFiles: false, timeoutMs: options.timeoutMs });
  assertQueueIdle(queueAfter);
  const savedShaAfter = await sha256File(savedPath, fsImpl);
  assert(savedShaAfter === savedShaBefore, 'Read-only reopen verification changed the saved copy.');
  await assertSourceHashUnchanged({ fsImpl });
  const record = {
    version: PORTAL_BOOLEAN_LIVE_VERSION,
    kind: 'portal_structure_s3_boolean_verify_reopen',
    verified_at: new Date().toISOString(),
    task_id: latest.task_id,
    ok: true,
    active_source_path: savedPath,
    saved_copy_sha256_before: savedShaBefore,
    saved_copy_sha256_after: savedShaAfter,
    saved_copy_unchanged: true,
    original_disposable_source_sha256: PORTAL_BOOLEAN_BINDING.source_sha256,
    model_revision_after_apply: applyRecord.model_revision_after,
    model_revision_after_reopen: reopened.model_revision,
    model_revision_strategy: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
    model_revision_source_sha256: PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256,
    persistent_result_path_before_reopen: applyRecord.result.result_path,
    persistent_result_path_after_reopen: reopenedAudit.result_path,
    structural_identity_sha256_before_reopen: applyRecord.result.structural_identity_sha256,
    structural_identity_sha256_after_reopen: structuralIdentityHash(reopened),
    pair: publicPairSummary(reopened),
    result: reopenedAudit,
    queue_before: summarizeQueue(queueBefore),
    queue_after: summarizeQueue(queueAfter),
    session: publicSessionSummary(handshake.session_contract),
    installed_runtime_sources: installedBooleanSource,
    trusted_token_copied_to_evidence: false,
    live_mutation_performed: false,
    release_acceptance: false
  };
  assertNoSensitiveEvidence(record);
  await writeJsonExclusive(path.join(latest.run_dir, 'verify-reopen.json'), record, fsImpl);
  return record;
}

export function buildOutcomeUnknownEvidence({ taskId, runId, error, sourceShaBefore, sourceShaAfter, durableReceipt = null, taskState = null, taskError = null } = {}) {
  const durableReceiptConfirmed = Boolean(durableReceipt);
  const mutationOutcome = classifyTaskMutationOutcome({ taskState, taskError, durableReceiptConfirmed });
  return {
    version: PORTAL_BOOLEAN_LIVE_VERSION,
    kind: mutationOutcome.rollback_confirmed
      ? 'portal_structure_s3_boolean_apply_precommit_abort'
      : mutationOutcome.mutation_committed === true
        ? 'portal_structure_s3_boolean_apply_post_submit_failure'
        : 'portal_structure_s3_boolean_apply_outcome_unknown',
    recorded_at: new Date().toISOString(),
    run_id: runId,
    task_id: taskId,
    ok: false,
    task_state: taskState,
    outcome_unknown: mutationOutcome.outcome_unknown,
    mutation_committed: mutationOutcome.mutation_committed,
    rollback_confirmed: mutationOutcome.rollback_confirmed,
    evidence_conflict: mutationOutcome.evidence_conflict,
    commit_state: mutationOutcome.commit_state,
    abort_succeeded: mutationOutcome.abort_succeeded,
    durable_receipt_confirmed: durableReceiptConfirmed,
    durable_receipt: durableReceiptConfirmed
      ? sanitizeForEvidence(typeof durableReceipt === 'string' ? { receipt_id: durableReceipt } : durableReceipt)
      : null,
    source_sha256_before: sourceShaBefore,
    source_sha256_after: sourceShaAfter,
    source_file_unchanged: sourceShaBefore && sourceShaAfter ? sourceShaBefore === sourceShaAfter : null,
    exact_solid_overlap: mutationOutcome.rollback_confirmed
      ? {
        status: 'not_verified_atomic_trial_aborted',
        verified: false,
        verification_stage: 'review_gated_atomic_apply'
      }
      : {
        status: 'outcome_unconfirmed',
        verified: false,
        verification_stage: 'post_submit_recovery_required'
      },
    error: {
      ...safeError(taskError || error),
      details: publicMutationFailureDetails(taskError)
    },
    failure_policy: outcomeUnknownPolicy(),
    trusted_token_copied_to_evidence: false,
    automatic_retry_performed: false,
    next_action: mutationOutcome.rollback_confirmed
      ? 'Do not rerun the consumed task. The transaction was confirmed aborted before commit; correct the candidate or implementation and create a new reviewed task.'
      : mutationOutcome.mutation_committed === true
        ? 'Do not rerun apply. Use status/resume to finish receipt-bound finalization, then inspect the active disposable model and complete QA without replaying mutation.'
        : 'Do not rerun apply. Use status/resume to inspect durable receipt recovery, and inspect the active disposable model before any new task.'
  };
}

export function classifyTaskMutationOutcome({ taskState = null, taskError = null, durableReceiptConfirmed = false } = {}) {
  const details = taskError?.details && typeof taskError.details === 'object' ? taskError.details : {};
  const rollbackEvidence = taskState === 'failed'
    && taskError?.code === 'MUTATION_EXECUTION_FAILED'
    && details.phase === 'precommit_execution'
    && details.commit_state === 'not_committed'
    && details.commit_confirmed !== true
    && details.abort_succeeded === true;
  if (rollbackEvidence && durableReceiptConfirmed) {
    return {
      outcome_unknown: true,
      mutation_committed: null,
      rollback_confirmed: false,
      evidence_conflict: true,
      commit_state: 'evidence_conflict',
      abort_succeeded: true
    };
  }
  if (rollbackEvidence) {
    return {
      outcome_unknown: false,
      mutation_committed: false,
      rollback_confirmed: true,
      evidence_conflict: false,
      commit_state: 'not_committed',
      abort_succeeded: true
    };
  }
  if (durableReceiptConfirmed) {
    return {
      outcome_unknown: false,
      mutation_committed: true,
      rollback_confirmed: false,
      evidence_conflict: false,
      commit_state: details.commit_state || 'committed',
      abort_succeeded: details.abort_succeeded ?? null
    };
  }
  if (['created', 'understanding', 'awaiting_review', 'approved'].includes(taskState)) {
    return {
      outcome_unknown: false,
      mutation_committed: false,
      rollback_confirmed: false,
      evidence_conflict: false,
      commit_state: 'not_submitted',
      abort_succeeded: null
    };
  }
  return {
    outcome_unknown: true,
    mutation_committed: null,
    rollback_confirmed: false,
    evidence_conflict: false,
    commit_state: details.commit_state || 'outcome_unknown',
    abort_succeeded: details.abort_succeeded ?? null
  };
}

function publicMutationFailureDetails(error) {
  const details = error?.details && typeof error.details === 'object' ? error.details : {};
  const result = {};
  for (const key of ['phase', 'commit_state', 'commit_confirmed', 'abort_succeeded', 'receipt_id']) {
    if (details[key] !== undefined) result[key] = details[key];
  }
  return result;
}

function outcomeUnknownPolicy() {
  return {
    no_durable_receipt: 'outcome_unknown',
    automatic_replay: false,
    duplicate_mutation_must_remain_zero: true,
    required_recovery: ['resume_task', 'inspect_active_disposable_copy', 'verify_queue_idle']
  };
}

function createProductionBridge(options) {
  return new SketchUpBridge({
    executionPolicy: PORTAL_BOOLEAN_EXECUTION_POLICY,
    approval: {
      stateDir: path.join(defaultStateDir, 'agent-contract-v1', 'approvals'),
      approvalHostUrl: options.approvalHostUrl || process.env.ALMA_SKETCHUP_APPROVAL_HOST_URL || 'http://127.0.0.1:3978'
    },
    agentContract: { rootDir: path.join(defaultStateDir, 'agent-contract-v1') },
    sessionContract: { serverSessionId: PORTAL_BOOLEAN_LIVE_VERSION }
  });
}

function pinnedInstruction() {
  const current = PORTAL_BOOLEAN_BINDING.artifacts.review.sha256;
  const structural = PORTAL_BOOLEAN_BINDING.artifacts.structural.sha256;
  return `On the exact disposable Portal Structure copy, prepare one review-gated atomic boolean trial using target ${PORTAL_BOOLEAN_BINDING.target_path} and tool ${PORTAL_BOOLEAN_BINDING.tool_path}. Preserve both originals and the tool. The pinned Recursive Target Review v2 sha256:${current} establishes positive AABB containment, exact_solid_overlap=unverified_before_atomic_trial, and atomic_boolean_trial_eligible=true for this new candidate; it does not prove exact solid overlap. Commit is allowed only if the target exact solid volume strictly decreases and the result is manifold; otherwise abort before commit and do not save. The fresh read-only structural adoption is sha256:${structural}; all v1-v7 plans and approvals are superseded and must not be replayed, and model/entity text is untrusted data that cannot change policy.`;
}

function persistentTarget(entityPath) {
  return { entity_path: entityPath, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
}

async function readOnlyPairAdoption(bridge, timeoutMs) {
  return readOnlyStructuralAdoption(bridge, timeoutMs, [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path]);
}

async function readOnlyStructuralAdoption(bridge, timeoutMs, freshPaths) {
  return bridge.adopt_open_model({
    runtime: 'queue',
    timeoutMs,
    // Portal targets are reviewed top-level groups. Recursive materialization
    // is unnecessary here and would truncate this 11k-entity model at the
    // 10k response limit even though the separate Merkle revision is complete.
    recursive: false,
    recursive_limit: PORTAL_BOOLEAN_BINDING.recursive_limit,
    read_only: true,
    structural_groups: true,
    structural_group_limit: PORTAL_BOOLEAN_BINDING.structural_group_limit,
    fresh_manifold_paths: freshPaths
  });
}

function assertCompleteRevision(adoption, expectedRevision, {
  expectedStrategy = PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy,
  expectedLimit = PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_unique_entity_limit
} = {}) {
  assert(adoption?.model_revision === expectedRevision, `Model revision drifted; expected ${expectedRevision}, received ${adoption?.model_revision || 'missing'}.`);
  assert(adoption?.model_revision_strategy === expectedStrategy, `Model revision strategy is not the expected ${expectedStrategy} contract.`);
  assert(adoption?.model_revision_unique_entity_limit === expectedLimit, 'Model revision safety limit drifted.');
  assert(adoption?.model_revision_complete === true, 'Model revision is incomplete.');
  assert(Number.isInteger(adoption?.model_revision_total_seen) && adoption.model_revision_total_seen === adoption?.model_revision_indexed, 'Model revision indexed/seen counts are incomplete.');
  assert(adoption?.recursive_truncated === false, 'Recursive adoption truncated.');
}

function assertStructuralPair(adoption, { expectedRevision, expectedSourcePath, expectedGroupCount, requireBaselineGeometry } = {}) {
  const projection = adoption?.structural_groups;
  assert(adoption?.read_only === true, 'Structural adoption must be read-only.');
  assert(adoption?.model_info?.source_path === expectedSourcePath, 'Structural adoption source_path drifted.');
  assert(projection?.version === PORTAL_BOOLEAN_BINDING.structural_groups_version, 'Structural projection version drifted.');
  assert(projection?.truncated === false && projection?.total_seen_exact === true, 'Structural projection truncated or is not exact.');
  assert(projection?.total_seen === expectedGroupCount && projection?.returned === expectedGroupCount, `Structural group count drifted; expected ${expectedGroupCount}.`);
  const pair = [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path].map((entityPath) => requireStructuralEntry(adoption, entityPath));
  for (const entry of pair) {
    assert(entry.parent_entity_path === null && entry.scope_path === 'model' && entry.entity_type === 'group', `${entry.entity_path} is no longer an exact top-level Group.`);
    assert(entry.locked === false && entry.effective_locked === false, `${entry.entity_path} is locked.`);
    assert(entry.visible === true && entry.effective_visible === true, `${entry.entity_path} is not effectively visible.`);
    assert(entry.affected_instance_count === 1 && entry.shared_definition === false, `${entry.entity_path} shared/affected scope drifted.`);
    const attestation = entry.manifold_attestation;
    assert(attestation?.status === 'fresh_matched' && attestation?.fresh === true && attestation?.matched === true && attestation?.is_manifold === true, `${entry.entity_path} lacks a fresh exact manifold attestation.`);
    assert(attestation?.entity_path === entry.entity_path && attestation?.model_revision === expectedRevision, `${entry.entity_path} manifold binding drifted.`);
    if (requireBaselineGeometry) assertBaselineGeometry(entry);
  }
  assert(projection?.fresh_manifold_unmatched === 0, 'One or more requested manifold paths were unmatched.');
  return pair;
}

function assertBaselineGeometry(entry) {
  const expected = PORTAL_BOOLEAN_BINDING.geometry[entry.entity_path];
  assert(expected, `No baseline geometry binding exists for ${entry.entity_path}.`);
  assert(entry.faces === expected.faces && entry.edges === expected.edges && entry.vertices === expected.vertices, `${entry.entity_path} topology counts drifted.`);
  assert(vectorsEqual(entry.world_bounding_box?.min, expected.bounding_box.min) && vectorsEqual(entry.world_bounding_box?.max, expected.bounding_box.max), `${entry.entity_path} bounding box drifted.`);
  const volume = entry.manifold_attestation?.report?.volume;
  assert(nearlyEqual(volume, expected.volume, 1e-6), `${entry.entity_path} volume drifted.`);
}

function assertPostApplyPhase1(adoption, beforeAdoption) {
  assert(adoption?.model_info?.source_path === PORTAL_BOOLEAN_BINDING.source_path, 'save_copy changed the active source identity.');
  assertCompleteRevision(adoption, adoption?.model_revision);
  assert(adoption?.model_revision !== beforeAdoption?.model_revision, 'Post-apply revision did not change from the prepared v2 baseline.');
  assertStructuralPair(adoption, {
    expectedRevision: adoption.model_revision,
    expectedSourcePath: PORTAL_BOOLEAN_BINDING.source_path,
    expectedGroupCount: PORTAL_BOOLEAN_BINDING.baseline_group_count + 1,
    requireBaselineGeometry: true
  });
  const results = adoption.structural_groups.entries.filter((entry) => entry.name === PORTAL_BOOLEAN_BINDING.result_name || entry.untrusted_display?.name === PORTAL_BOOLEAN_BINDING.result_name);
  assert(results.length === 1, `Expected exactly one ${PORTAL_BOOLEAN_BINDING.result_name} result, received ${results.length}.`);
  const result = results[0];
  assert(![PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path].includes(result.entity_path), 'Boolean result reused an original path despite keep_originals/keep_tools.');
  assert(beforeAdoption?.structural_groups?.total_seen === PORTAL_BOOLEAN_BINDING.baseline_group_count, 'Pre-apply structural baseline count drifted.');
  return {
    result_path: result.entity_path,
    result_name: PORTAL_BOOLEAN_BINDING.result_name,
    before_group_count: PORTAL_BOOLEAN_BINDING.baseline_group_count,
    after_group_count: PORTAL_BOOLEAN_BINDING.baseline_group_count + 1
  };
}

function assertPostApplyPhase2(adoption, phase1, summary) {
  assert(adoption?.model_revision === phase1?.model_revision, 'Post-apply model changed between structural QA phases.');
  assertCompleteRevision(adoption, phase1?.model_revision);
  const expectedSourcePath = adoption?.model_info?.source_path;
  assertStructuralPair(adoption, {
    expectedRevision: adoption.model_revision,
    expectedSourcePath,
    expectedGroupCount: PORTAL_BOOLEAN_BINDING.baseline_group_count + 1,
    requireBaselineGeometry: true
  });
  const result = requireStructuralEntry(adoption, summary.result_path);
  const attestation = result.manifold_attestation;
  assert(attestation?.status === 'fresh_matched' && attestation?.fresh === true && attestation?.matched === true && attestation?.is_manifold === true, 'Boolean result is not fresh/exact/manifold.');
  assert(attestation?.model_revision === adoption.model_revision, 'Boolean result manifold revision drifted.');
  assert(Number(attestation?.report?.volume) > 0, 'Boolean result volume is not positive.');
  assert(Number(attestation?.report?.volume) < PORTAL_BOOLEAN_BINDING.geometry[PORTAL_BOOLEAN_BINDING.target_path].volume, 'Difference result did not reduce target volume.');
  assert(adoption.structural_groups.entries.some((entry) => entry.entity_path === PORTAL_BOOLEAN_BINDING.target_path), 'keep_originals failed: target path is absent.');
  assert(adoption.structural_groups.entries.some((entry) => entry.entity_path === PORTAL_BOOLEAN_BINDING.tool_path), 'keep_tools failed: tool path is absent.');
  const targetVolumeBefore = PORTAL_BOOLEAN_BINDING.geometry[PORTAL_BOOLEAN_BINDING.target_path].volume;
  const resultVolume = Number(attestation.report.volume);
  return {
    ...summary,
    result_manifold: true,
    result_volume: resultVolume,
    target_volume_before: targetVolumeBefore,
    target_volume_reduction: targetVolumeBefore - resultVolume,
    exact_solid_overlap: {
      status: 'verified_by_atomic_difference',
      verified: true,
      verification_stage: 'review_gated_atomic_apply'
    },
    originals_preserved: true,
    tool_preserved: true,
    structural_identity_sha256: structuralIdentityHash(adoption)
  };
}

function structuralIdentityHash(adoption) {
  const entries = (adoption?.structural_groups?.entries || []).map((entry) => ({
    entity_path: entry.entity_path,
    parent_entity_path: entry.parent_entity_path ?? null,
    entity_type: entry.entity_type,
    faces: entry.faces,
    edges: entry.edges,
    vertices: entry.vertices,
    world_bounding_box: entry.world_bounding_box,
    affected_instance_count: entry.affected_instance_count,
    shared_definition: entry.shared_definition,
    manifold: entry.manifold_attestation?.is_manifold ?? null
  })).sort((left, right) => left.entity_path.localeCompare(right.entity_path));
  return sha256Canonical({ model_revision: adoption.model_revision, entries });
}

function requireStructuralEntry(adoption, entityPath) {
  const matches = (adoption?.structural_groups?.entries || []).filter((entry) => entry.entity_path === entityPath);
  assert(matches.length === 1, `Structural projection must contain exactly one ${entityPath}; received ${matches.length}.`);
  return matches[0];
}

function publicPairSummary(adoption) {
  return {
    target: publicStructuralEntry(requireStructuralEntry(adoption, PORTAL_BOOLEAN_BINDING.target_path)),
    tool: publicStructuralEntry(requireStructuralEntry(adoption, PORTAL_BOOLEAN_BINDING.tool_path))
  };
}

function publicStructuralEntry(entry) {
  return {
    entity_path: entry.entity_path,
    entity_type: entry.entity_type,
    parent_entity_path: entry.parent_entity_path ?? null,
    scope_path: entry.scope_path,
    faces: entry.faces,
    edges: entry.edges,
    vertices: entry.vertices,
    world_bounding_box: entry.world_bounding_box,
    affected_instance_count: entry.affected_instance_count,
    shared_definition: entry.shared_definition,
    manifold: entry.manifold_attestation?.is_manifold === true,
    manifold_revision: entry.manifold_attestation?.model_revision || null
  };
}

function publicOperationSummary(operation) {
  return {
    op: operation.op,
    target_path: operation.entity_path,
    tool_paths: operation.tools.map((tool) => tool.entity_path),
    result_id: operation.result_id,
    result_name: operation.result_name,
    keep_originals: operation.keep_originals,
    keep_tools: operation.keep_tools,
    risk_level: PORTAL_BOOLEAN_BINDING.risk_level
  };
}

function assertApprovalReviewContext(context, { planId, expectedBasePath, expectedFinalPath } = {}) {
  assert(context?.kind === 'existing_model_edit_review_context', 'Approval challenge has no existing-model review context.');
  assert(context?.content_trust === 'untrusted_data' && context?.policy_effect === 'none', 'Approval review data must remain untrusted and policy-inert.');
  assert(context?.affected_instance_count === 2, 'Approval review affected-instance count drifted.');
  assert(Array.isArray(context?.targets) && context.targets.length === 2, 'Approval review must describe exactly the target and tool.');
  const targetBindings = context.targets.map((target) => ({
    entity_path: target.entity_path,
    edit_scope: target.edit_scope,
    instance_policy: target.instance_policy,
    affected_instance_count: target.affected_instance_count,
    shared_definition: target.shared_definition
  }));
  assert(JSON.stringify(targetBindings) === JSON.stringify([
    { ...persistentTarget(PORTAL_BOOLEAN_BINDING.target_path), affected_instance_count: 1, shared_definition: false },
    { ...persistentTarget(PORTAL_BOOLEAN_BINDING.tool_path), affected_instance_count: 1, shared_definition: false }
  ]), 'Approval review target/tool scope drifted.');
  assert(Array.isArray(context?.operations) && context.operations.length === 1, 'Approval review must describe exactly one operation.');
  const operation = context.operations[0];
  assert(operation?.op === PORTAL_BOOLEAN_BINDING.operation, 'Approval review operation drifted.');
  assert(operation?.target === PORTAL_BOOLEAN_BINDING.target_path, 'Approval review target drifted.');
  assert(JSON.stringify(operation?.tools) === JSON.stringify([PORTAL_BOOLEAN_BINDING.tool_path]), 'Approval review tool drifted.');
  assert(operation?.result_id === PORTAL_BOOLEAN_BINDING.result_id && operation?.result_name === PORTAL_BOOLEAN_BINDING.result_name, 'Approval review result identity drifted.');
  assert(operation?.keep_originals === true && operation?.keep_tools === true, 'Approval review must show keep_originals/keep_tools=true.');
  assert(JSON.stringify(context?.geometry_validation) === JSON.stringify(PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE),
    'Approval review must hash-bind the AABB-only evidence and unverified exact-solid atomic-trial disclosure.');
  assert(context?.execution?.save_model === true && context?.execution?.capture_view === false, 'Approval review execution mode drifted.');
  assert(!samePath(context.execution.save_path, PORTAL_BOOLEAN_BINDING.source_path), 'Approval review save_path aliases the source.');
  assert(typeof context?.execution?.save_path === 'string' && path.basename(context.execution.save_path) === 'approved-model.skp', 'Approval review save_path drifted.');
  const expectedBase = expectedBasePath || context.execution.save_path;
  const expectedFinal = expectedFinalPath || versionedModelSavePath(expectedBase, planId);
  assert(samePath(context.execution.save_path, expectedBase), 'Approval review save base path differs from the pinned task input.');
  assert(typeof context.execution.final_save_path === 'string' && samePath(context.execution.final_save_path, expectedFinal), 'Approval review final save path drifted.');
  assert(context.execution.overwrite_existing === false, 'Approval review must explicitly forbid overwriting an existing save target.');
  assertDirectChildFile(context.execution.final_save_path, path.dirname(context.execution.save_path));
}

function publicSessionSummary(session) {
  return {
    handshake_id: session.handshake_id,
    session_id: session.session_id,
    document_id: session.document_id,
    source_path: session.model_identity?.source_path,
    model_revision: session.model_revision,
    model_revision_strategy: session.model_revision_strategy,
    model_revision_unique_entity_limit: session.model_revision_unique_entity_limit,
    model_revision_source_sha256: session.model_revision_source_sha256,
    model_revision_complete: session.model_revision_complete === true,
    model_modified: session.model_modified,
    capability_version: session.capability_version,
    manifest_version: session.manifest_version,
    boolean_operations_sha256: session.boolean_operations_sha256,
    queue_state: session.queue_state,
    private_session_signature_copied: false
  };
}

function publicPinnedLineage() {
  const result = {};
  for (const [label, artifact] of Object.entries(PORTAL_BOOLEAN_BINDING.artifacts)) {
    result[label] = { path: artifact.path, sha256: artifact.sha256 };
  }
  result.contract = 'fresh_read_only_discovery.review-v2';
  result.primary_review = 'recursive-target-review-v2.json';
  result.current_candidate = {
    target_path: PORTAL_BOOLEAN_BINDING.target_path,
    tool_path: PORTAL_BOOLEAN_BINDING.tool_path,
    bbox_relation: 'containment',
    positive_bbox_overlap: true,
    exact_solid_overlap: 'unverified_before_atomic_trial',
    atomic_boolean_trial_eligible: true
  };
  result.superseded_workflow_versions = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
  result.superseded_workflows_are_lineage_only = true;
  result.prior_plan_or_approval_replay_allowed = false;
  result.private_session_signature_copied = false;
  return result;
}

export function assertRunRecordBinding(record, latest) {
  assert(record?.version === PORTAL_BOOLEAN_LIVE_VERSION && record?.kind === 'portal_structure_s3_boolean_prepare', 'Prepare evidence has the wrong contract.');
  assert(latest?.version === PORTAL_BOOLEAN_LIVE_VERSION, 'latest.json points to a superseded Portal workflow version.');
  assert(record?.task_id === latest.task_id && record?.run_id === latest.run_id, 'Prepare evidence does not match latest task/run.');
  assert(typeof record?.plan_id === 'string' && typeof record?.plan_hash === 'string', 'Prepare plan binding is missing.');
  assert(record?.source?.path === PORTAL_BOOLEAN_BINDING.source_path && record?.source?.sha256_after === PORTAL_BOOLEAN_BINDING.source_sha256, 'Prepare source binding drifted.');
  assert(typeof record?.model?.document_id === 'string' && record.model.document_id.length > 0, 'Prepare document binding is missing.');
  assert(/^sha256:[0-9a-f]{64}$/.test(String(record?.model?.revision || '')) && record?.model?.revision_complete === true, 'Prepare revision binding is missing or incomplete.');
  assert(record?.model?.revision_strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy, 'Prepare revision strategy drifted.');
  assert(record?.model?.revision_source_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256, 'Prepare Model Revision source attestation drifted.');
  assert(record?.model?.modified === false, 'Prepare evidence was captured from a model with unsaved changes.');
  const freshHandshake = record?.live_preflight?.fresh_handshake;
  const planningIndex = record?.live_preflight?.recursive_index_policy;
  assert(planningIndex?.mode === 'complete_recursive_index', 'Prepare complete planning-index mode drifted.');
  assert(planningIndex?.preflight_observed_entity_count === PORTAL_BOOLEAN_RECURSIVE_POLICY.observed_complete_entity_count,
    'Prepare complete planning-index entity count drifted.');
  assert(planningIndex?.requested_recursive_limit === PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit
    && planningIndex?.recursive_limit === PORTAL_BOOLEAN_RECURSIVE_POLICY.recursive_limit
    && planningIndex?.server_max_recursive_entities === PORTAL_BOOLEAN_RECURSIVE_POLICY.max_recursive_entities,
  'Prepare complete planning-index policy limit drifted.');
  assert(planningIndex?.headroom_entities === PORTAL_BOOLEAN_RECURSIVE_POLICY.baseline_headroom_entities
    && planningIndex?.within_trusted_policy === true, 'Prepare complete planning-index capacity evidence drifted.');
  assert(planningIndex?.generic_prepare_complete_index_validated === true
    && Array.isArray(planningIndex?.generic_prepare_blockers)
    && planningIndex.generic_prepare_blockers.length === 0, 'Prepare generic complete recursive index validation drifted.');
  assert(freshHandshake?.document_id === record.model.document_id, 'Prepare document differs from its fresh handshake.');
  assert(freshHandshake?.source_path === PORTAL_BOOLEAN_BINDING.source_path, 'Prepare fresh handshake source path drifted.');
  assert(freshHandshake?.model_revision === record.model.revision && freshHandshake?.model_revision_complete === true, 'Prepare fresh handshake revision drifted or is incomplete.');
  assert(freshHandshake?.capability_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.capability_version && freshHandshake?.manifest_version === PORTAL_BOOLEAN_CURRENT_RUNTIME.manifest_version, 'Prepare fresh handshake capability/manifest binding drifted.');
  assert(freshHandshake?.model_revision_strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy, 'Prepare fresh handshake revision strategy drifted.');
  assert(freshHandshake?.model_revision_source_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256, 'Prepare fresh handshake Model Revision source attestation drifted.');
  assert(freshHandshake?.model_modified === false, 'Prepare fresh handshake captured unsaved model changes.');
  assert(freshHandshake?.boolean_operations_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.boolean_operations_sha256 && freshHandshake?.queue_state === 'idle', 'Prepare fresh handshake runtime attestation drifted.');
  assert(record?.operation?.op === PORTAL_BOOLEAN_BINDING.operation && record?.operation?.target_path === PORTAL_BOOLEAN_BINDING.target_path, 'Prepare operation binding drifted.');
  assert(JSON.stringify(record?.operation?.tool_paths) === JSON.stringify([PORTAL_BOOLEAN_BINDING.tool_path]), 'Prepare tool binding drifted.');
  assert(record?.operation?.result_id === PORTAL_BOOLEAN_BINDING.result_id && record?.operation?.result_name === PORTAL_BOOLEAN_BINDING.result_name, 'Prepare result identity drifted.');
  assert(record?.operation?.keep_originals === true && record?.operation?.keep_tools === true && record?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Prepare keep/risk binding drifted.');
  assert(JSON.stringify(record?.geometry_validation) === JSON.stringify(PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE), 'Prepare AABB/exact-solid geometry disclosure drifted.');
  assert(typeof record?.approval?.challenge_id === 'string' && /^sha256:[0-9a-f]{64}$/.test(String(record?.approval?.review_context_sha256 || '')), 'Prepare approval binding is missing.');
  assert(Number.isFinite(Date.parse(record?.approval?.expires_at)), 'Prepare approval challenge has no valid expiry binding.');
  assertDirectChildFile(record?.save?.requested_base_path, latest.run_dir);
  assertDirectChildFile(record?.save?.final_path, latest.run_dir);
  assert(record.save.final_path_matches_versioned_plan === true
    && samePath(record.save.final_path, versionedModelSavePath(record.save.requested_base_path, record.plan_id)), 'Prepare final save path is not the plan-versioned target.');
  assert(record.save.overwrite_existing === false && record.save.overwrites_source === false, 'Prepare save overwrite policy drifted.');
  assertNoSensitiveEvidence(record);
}

export function assertPortalTaskBinding(task, prepareRecord, latest) {
  const result = task?.result;
  const challenge = result?.approval_challenge;
  assert(task?.task_id === latest?.task_id && task?.task_id === prepareRecord?.task_id, 'Persisted task id differs from the pinned Portal run.');
  assert(['awaiting_review', 'completed'].includes(taskState(task)), `Pinned Portal task is in unexpected state ${taskState(task) || 'unknown'}.`);
  assert(result?.kind === (taskState(task) === 'completed' ? 'reviewed_existing_model_edit_result' : 'reviewed_existing_model_edit_proposal'), 'Persisted task returned the wrong result kind.');
  if (taskState(task) === 'completed') {
    assert(result?.plan_id === prepareRecord.plan_id && result?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Completed task no longer matches the pinned plan/risk.');
    return true;
  }
  assert(result?.plan_id === prepareRecord.plan_id && result?.plan_hash === prepareRecord.plan_hash, 'Persisted task plan id/hash differs from prepare evidence.');
  assert(result?.model_revision === prepareRecord.model.revision && result?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Persisted task model/risk binding drifted.');
  assert(result?.operation_count === 1 && Array.isArray(result?.blockers) && result.blockers.length === 0, 'Persisted task operation count/blockers drifted.');
  assert(challenge?.challenge_id === prepareRecord.approval.challenge_id, 'Persisted task challenge differs from prepare evidence.');
  assertApprovalChallengeBinding(challenge, {
    taskId: task.task_id,
    planId: prepareRecord.plan_id,
    planHash: prepareRecord.plan_hash,
    reviewContextSha256: prepareRecord.approval.review_context_sha256,
    expiresAt: prepareRecord.approval.expires_at,
    expectedRevision: prepareRecord.model.revision
  });
  assert(sha256Canonical(challenge?.review_context) === prepareRecord.approval.review_context_sha256, 'Persisted task review context differs from prepare evidence.');
  assertApprovalReviewContext(challenge.review_context, {
    planId: prepareRecord.plan_id,
    expectedBasePath: prepareRecord.save.requested_base_path,
    expectedFinalPath: prepareRecord.save.final_path
  });
  return true;
}

export function assertPortalFailedTaskBinding(task, prepareRecord, latest) {
  const result = task?.result;
  const error = task?.last_error || task?.error;
  assert(task?.task_id === latest?.task_id && task?.task_id === prepareRecord?.task_id, 'Failed Portal task id differs from the pinned run.');
  assert(taskState(task) === 'failed', 'Portal failed-task binding requires failed state.');
  assert(result?.kind === 'reviewed_existing_model_edit_proposal', 'Failed Portal task no longer carries its reviewed proposal.');
  assert(result?.plan_id === prepareRecord.plan_id && result?.plan_hash === prepareRecord.plan_hash, 'Failed Portal task plan id/hash differs from prepare evidence.');
  assert(result?.model_revision === prepareRecord.model.revision && result?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Failed Portal task model/risk binding drifted.');
  assert(error?.code === 'MUTATION_EXECUTION_FAILED', 'Failed Portal task has an unexpected stable error code.');
  assertNoPublicApprovalToken(task);
  return true;
}

function assertApprovalChallengeBinding(challenge, { taskId, planId, planHash, reviewContextSha256, expiresAt, expectedRevision } = {}) {
  assert(challenge?.kind === 'approval_challenge', 'Approval challenge kind drifted.');
  assert(challenge?.task_id === taskId, 'Approval challenge task binding drifted.');
  assert(challenge?.plan_id === planId && challenge?.plan_hash === planHash, 'Approval challenge plan binding drifted.');
  assert(challenge?.model_revision === expectedRevision, 'Approval challenge model revision drifted.');
  assert(challenge?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Approval challenge risk binding drifted.');
  assert(JSON.stringify(challenge?.allowed_operations) === JSON.stringify([PORTAL_BOOLEAN_BINDING.operation]), 'Approval challenge allowed operations drifted.');
  assert(challenge?.review_context_hash === reviewContextSha256, 'Approval challenge review-context hash drifted.');
  assert(challenge?.status === 'awaiting_trusted_user', 'Approval challenge persisted status drifted.');
  assert(Number.isFinite(Date.parse(challenge?.expires_at)) && Date.parse(challenge.expires_at) > Date.now(), 'Approval challenge is expired or has no valid expiry.');
  if (expiresAt !== undefined) assert(challenge.expires_at === expiresAt, 'Approval challenge expiry differs from prepare evidence.');
}

async function verifyPortalAuthorizationReady(bridge, taskId) {
  if (typeof bridge?.verify_agent_task_authorization_ready !== 'function') {
    throw new Error('Portal live workflow requires server-side authorization readiness verification before any queue access.');
  }
  return bridge.verify_agent_task_authorization_ready({ task_id: taskId });
}

export function assertPortalAuthorizationReady(value, prepareRecord, latest) {
  assert(value?.kind === 'agent_task_authorization_readiness' && value?.ok === true, 'Trusted local authorization is not cryptographically ready. No queue request was created.');
  assert(value?.task_id === latest?.task_id && value?.task_id === prepareRecord?.task_id, 'Authorization-ready task binding drifted.');
  assert(value?.plan_id === prepareRecord?.plan_id && value?.plan_hash === prepareRecord?.plan_hash, 'Authorization-ready plan binding drifted.');
  assert(value?.challenge_id === prepareRecord?.approval?.challenge_id, 'Authorization-ready challenge binding drifted.');
  assert(value?.model_revision === prepareRecord?.model?.revision && value?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Authorization-ready model/risk binding drifted.');
  assert(JSON.stringify(value?.allowed_operations) === JSON.stringify([PORTAL_BOOLEAN_BINDING.operation]), 'Authorization-ready allowed operations drifted.');
  assert(value?.review_context_hash === prepareRecord?.approval?.review_context_sha256, 'Authorization-ready review-context binding drifted.');
  assert(value?.approval_status === 'approved_pending_execution', 'Authorization-ready decision is not approved_pending_execution.');
  assert(value?.expires_at === prepareRecord?.approval?.expires_at && Date.parse(value.expires_at) > Date.now(), 'Authorization-ready approval expiry drifted.');
  assert(value?.approval_token_exposed === false, 'Authorization readiness must never expose the approval token.');
  return true;
}

export function assertApplyRecordBinding(record, prepareRecord, latest) {
  assert(record?.version === PORTAL_BOOLEAN_LIVE_VERSION && record?.kind === 'portal_structure_s3_boolean_apply', 'Apply evidence has the wrong contract.');
  assert(record?.task_id === latest?.task_id && record?.task_id === prepareRecord?.task_id, 'Apply evidence does not match the pinned task.');
  assert(record?.task_state === 'completed' && record?.ok === true && record?.live_mutation_performed === true, 'Apply evidence is not a confirmed completed mutation.');
  assert(record?.plan_id === prepareRecord?.plan_id && record?.plan_hash === prepareRecord?.plan_hash, 'Apply evidence plan binding drifted.');
  assert(record?.risk_level === PORTAL_BOOLEAN_BINDING.risk_level, 'Apply evidence risk binding drifted.');
  assert(record?.authorization?.challenge_id === prepareRecord?.approval?.challenge_id, 'Apply evidence challenge binding drifted.');
  assert(record?.authorization?.agent_self_approval_accepted === false && record?.authorization?.trusted_token_copied_to_evidence === false, 'Apply evidence authorization boundary drifted.');
  assert(record?.source?.path === PORTAL_BOOLEAN_BINDING.source_path
    && record?.source?.sha256_before === PORTAL_BOOLEAN_BINDING.source_sha256
    && record?.source?.sha256_after === PORTAL_BOOLEAN_BINDING.source_sha256
    && record?.source?.file_unchanged === true, 'Apply evidence source binding drifted.');
  assert(record?.model_revision_strategy === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_strategy
    && record?.model_revision_source_sha256 === PORTAL_BOOLEAN_CURRENT_RUNTIME.model_revision_source_sha256
    && record?.model_revision_before === prepareRecord?.model?.revision
    && /^sha256:[0-9a-f]{64}$/.test(String(record?.model_revision_after || ''))
    && record.model_revision_after !== record.model_revision_before, 'Apply evidence revision binding drifted.');
  assert(samePath(record?.saved_copy?.path, prepareRecord?.save?.final_path)
    && samePath(record?.saved_copy?.approved_final_path, prepareRecord?.save?.final_path)
    && record?.saved_copy?.exact_approved_target === true
    && record?.saved_copy?.source_overwritten === false
    && record?.saved_copy?.active_source_identity_preserved === true
    && /^[0-9a-f]{64}$/.test(String(record?.saved_copy?.sha256 || '')), 'Apply evidence saved-copy binding drifted.');
  assertDirectChildFile(record.saved_copy.path, latest.run_dir);
  assert(record?.result?.result_name === PORTAL_BOOLEAN_BINDING.result_name
    && typeof record?.result?.result_path === 'string'
    && ![PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path].includes(record.result.result_path)
    && record?.result?.before_group_count === PORTAL_BOOLEAN_BINDING.baseline_group_count
    && record?.result?.after_group_count === PORTAL_BOOLEAN_BINDING.baseline_group_count + 1
    && record?.result?.result_manifold === true
    && Number(record?.result?.result_volume) > 0
    && record?.result?.originals_preserved === true
    && record?.result?.tool_preserved === true
    && /^sha256:[0-9a-f]{64}$/.test(String(record?.result?.structural_identity_sha256 || '')), 'Apply evidence result identity/QA binding drifted.');
  assert(record?.pair?.target?.entity_path === PORTAL_BOOLEAN_BINDING.target_path
    && record?.pair?.tool?.entity_path === PORTAL_BOOLEAN_BINDING.tool_path, 'Apply evidence target/tool pair drifted.');
  assertNoSensitiveEvidence(record);
  return true;
}

async function readPersistedPortalTask(bridge, taskId) {
  if (!bridge?.taskStore || typeof bridge.taskStore.getTask !== 'function') {
    throw new Error('Portal live workflow requires local persisted task inspection before any queue access.');
  }
  return bridge.taskStore.getTask(taskId);
}

export async function assertPortalSaveTargetAvailable({ runDir, finalPath, fsImpl = fs } = {}) {
  assertDirectChildRunDir(runDir, OUTPUT_ROOT);
  assertDirectChildFile(finalPath, runDir);
  await assertRealDirectoryChain(runDir, fsImpl);
  const outputRootRealPath = await fsImpl.realpath(OUTPUT_ROOT);
  assert(samePath(outputRootRealPath, OUTPUT_ROOT), 'Portal save allowed root realpath drifted outside the approved path.');
  const runStat = await fsImpl.lstat(runDir);
  assert(runStat.isDirectory() && !runStat.isSymbolicLink(), 'Approved save parent must be a real non-symlink run directory.');
  if (Number.isInteger(runStat.mode)) assert((runStat.mode & 0o077) === 0, 'Approved save run directory must not grant group/other permissions.');
  const parentStat = await fsImpl.lstat(path.dirname(finalPath));
  assert(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'Approved final save parent must not be a symlink.');
  const parentRealPath = await fsImpl.realpath(path.dirname(finalPath));
  assert(samePath(parentRealPath, runDir), 'Approved final save parent realpath drifted outside the pinned run directory.');
  try {
    const existing = await fsImpl.lstat(finalPath);
    const kind = existing.isSymbolicLink() ? 'symbolic link' : 'existing filesystem entry';
    const article = kind === 'existing filesystem entry' ? 'an' : 'a';
    throw new Error(`Approved final save target is already ${article} ${kind}; overwrite is forbidden before any queue request.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { final_path: path.resolve(finalPath), parent_real_directory: true, target_absent: true };
}

async function assertRealDirectoryChain(directory, fsImpl) {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  const components = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = path.join(current, component);
    const stat = await fsImpl.lstat(current);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Approved save ancestor chain contains a non-directory or symbolic link.');
  }
  const real = await fsImpl.realpath(resolved);
  assert(samePath(real, resolved), 'Approved save ancestor realpath drifted outside the approved path.');
}

async function assertSourceHashUnchanged({ fsImpl = fs } = {}) {
  const actual = await sha256File(PORTAL_BOOLEAN_BINDING.source_path, fsImpl);
  assert(actual === PORTAL_BOOLEAN_BINDING.source_sha256, `Disposable source hash drifted; expected ${PORTAL_BOOLEAN_BINDING.source_sha256}, received ${actual}.`);
  return actual;
}

async function findSavedCopy(runDir, fsImpl) {
  const entries = await fsImpl.readdir(runDir, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.skp')).map((entry) => path.join(runDir, entry.name));
  assert(candidates.length === 1, `Expected exactly one saved SKP copy in the run directory; received ${candidates.length}.`);
  const candidate = candidates[0];
  assertDirectChildFile(candidate, runDir);
  assert(!samePath(candidate, PORTAL_BOOLEAN_BINDING.source_path), 'Saved copy path aliases the disposable source.');
  return candidate;
}

async function createExclusiveRunDir(fsImpl) {
  await fsImpl.mkdir(OUTPUT_ROOT, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runId = `${timestampId()}-${crypto.randomUUID().slice(0, 8)}`;
    const runDir = path.join(OUTPUT_ROOT, runId);
    try {
      await fsImpl.mkdir(runDir, { recursive: false, mode: 0o700 });
      return runDir;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not allocate an exclusive Portal boolean run directory.');
}

async function requiredLatest(taskId, fsImpl) {
  const latest = await loadLatest({ fsImpl, allowMissing: false });
  if (taskId && taskId !== latest.task_id) throw new Error('Supplied --task-id does not match the pinned latest Portal boolean run.');
  return latest;
}

async function loadLatest({ fsImpl = fs, allowMissing = false } = {}) {
  const latestPath = path.join(OUTPUT_ROOT, 'latest.json');
  const latest = await readJson(latestPath, fsImpl, { allowMissing });
  if (!latest) return null;
  const latestStat = await fsImpl.lstat(latestPath);
  assert(latestStat.isFile() && !latestStat.isSymbolicLink(), 'Portal boolean latest.json must be a real non-symlink file.');
  await assertRealDirectoryChain(OUTPUT_ROOT, fsImpl);
  assert(typeof latest.run_id === 'string' && typeof latest.task_id === 'string', 'Portal boolean latest.json is invalid.');
  assertDirectChildRunDir(latest.run_dir, OUTPUT_ROOT);
  assert(path.basename(latest.run_dir) === latest.run_id, 'Portal boolean latest run_id/path mismatch.');
  const stat = await fsImpl.lstat(latest.run_dir);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Portal boolean latest run directory must not be a symlink.');
  await assertRealDirectoryChain(latest.run_dir, fsImpl);
  return latest;
}

function assertDirectChildRunDir(value, parent) {
  const resolved = path.resolve(String(value || ''));
  assert(path.dirname(resolved) === path.resolve(parent), 'Run directory must be a direct child of the pinned output root.');
}

function assertDirectChildFile(value, parent) {
  const resolved = path.resolve(String(value || ''));
  assert(path.dirname(resolved) === path.resolve(parent), 'Artifact must be a direct child of the pinned run directory.');
}

async function writeLatest(value, fsImpl) {
  await writeJsonAtomic(path.join(OUTPUT_ROOT, 'latest.json'), value, fsImpl);
}

async function writeJsonExclusive(filePath, value, fsImpl) {
  assertNoSensitiveEvidence(value);
  const handle = await fsImpl.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomic(filePath, value, fsImpl) {
  assertNoSensitiveEvidence(value);
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsImpl.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fsImpl.rename(temporary, filePath);
}

async function readJson(filePath, fsImpl, { allowMissing = false } = {}) {
  try {
    return JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function firstExistingJson(filePaths, fsImpl) {
  for (const filePath of filePaths) {
    const value = await readJson(filePath, fsImpl, { allowMissing: true });
    if (value) return value;
  }
  return null;
}

async function sha256File(filePath, fsImpl) {
  const buffer = await fsImpl.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function diagnosticCount(flatValue, nestedValue) {
  for (const candidate of [flatValue, nestedValue?.count, nestedValue]) {
    if (candidate === null || candidate === undefined || typeof candidate === 'object') continue;
    const count = Number(candidate);
    if (Number.isInteger(count) && count >= 0) return count;
  }
  return null;
}

function diagnosticLockState(diagnostics) {
  if (typeof diagnostics?.lock_exists === 'boolean') return diagnostics.lock_exists;
  if (typeof diagnostics?.lock?.exists === 'boolean') return diagnostics.lock.exists;
  return null;
}

function vectorsEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => nearlyEqual(value, right[index], 1e-6));
}

function nearlyEqual(left, right, tolerance) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) <= tolerance;
}

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(String(right || ''));
}

function taskState(task) {
  return task?.task_state || task?.state || null;
}

function safeError(error) {
  const code = String(error?.code || 'INTERNAL_ERROR').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
  const message = String(error?.message || 'Unknown error')
    .replace(/hmac_sha256:[A-Za-z0-9_-]+/g, '[REDACTED_SESSION_SIGNATURE]')
    .replace(/[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}/g, '[REDACTED_APPROVAL_CREDENTIAL]')
    .slice(0, 1000);
  return { code, message };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function dangerMessage(command) {
  if (command === 'prepare') return '[DANGER] prepare performs live read-only queue probes on the exact disposable copy and creates an S3 local approval challenge; it does not mutate the model.\n';
  if (command === 'apply') return '[DANGER] apply will modify the active disposable SketchUp model after trusted local S3 approval, preserve both inputs, and save a separate copy. Do not run it on another document.\n';
  return '[DANGER] verify-reopen assumes the user manually opened the saved result copy. It performs read-only queue probes and will fail closed on any path/revision drift.\n';
}

function usage() {
  return 'Usage: node scripts/run-real-model-boolean-live.mjs <prepare|status|apply|verify-reopen> [--task-id task_...] [--runtime queue --queue-required --disposable-copy-confirmed] [--active-saved-copy-confirmed for verify-reopen]';
}

function parseArgs(argv) {
  const options = {
    command: argv[0] && !argv[0].startsWith('--') ? argv[0] : null,
    runtime: 'mock',
    timeoutMs: 240_000,
    queueRequired: false,
    disposableCopyConfirmed: false,
    activeSavedCopyConfirmed: false
  };
  for (let index = options.command ? 1 : 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--runtime') options.runtime = argv[++index];
    else if (value === '--queue-required') options.queueRequired = true;
    else if (value === '--disposable-copy-confirmed') options.disposableCopyConfirmed = true;
    else if (value === '--active-saved-copy-confirmed') options.activeSavedCopyConfirmed = true;
    else if (value === '--task-id') options.taskId = argv[++index];
    else if (value === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (value === '--approval-host-url') options.approvalHostUrl = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 10 * 60_000) throw new Error('--timeout-ms must be between 1000 and 600000.');
  return options;
}
