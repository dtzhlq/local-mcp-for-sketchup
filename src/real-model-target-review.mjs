import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from './bridge.mjs';
import { QueueRuntime, cleanupQueueArtifactsForPid } from './queue-runtime.mjs';
import {
  DEFAULT_REAL_MODEL_CANDIDATE_ROOT,
  DEFAULT_REAL_MODEL_MAX_BYTES,
  installCandidateProfileInterruptCleanup,
  observeDisposableCandidateReadOnly,
  prepareDisposableCandidateCopies,
  resolveCandidateRoots,
  runRealModelCandidateIntake,
  sanitizeCandidateError,
  verifyCandidateOriginalsUnchanged,
  verifyDisposableCopiesUnchanged
} from './real-model-candidate-intake.mjs';

export const REAL_MODEL_TARGET_REVIEW_VERSION = 'real-model-target-review.v2';
export const DEFAULT_REAL_MODEL_TARGET_REVIEW_OUTPUT = 'output/real-model-reliability/target-review/trimble-s6';
export const DEFAULT_REAL_MODEL_TARGET_CANDIDATE = 'Trimble S6.skp';
export const DEFAULT_REAL_MODEL_TARGET_CANDIDATE_LIMIT = 200;
export const MAX_REAL_MODEL_TARGET_CANDIDATE_LIMIT = 500;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_EVIDENCE_SCOPE = 'user_coordinated_single_disposable_copy_read_only_target_review';
const FORBIDDEN_LIVE_ACTIONS = Object.freeze([
  'build_model',
  'reset_model',
  'save_model',
  'save_model_version',
  'import_model',
  'export_model',
  'set_selection',
  'capture_view',
  'run_ruby_expert',
  'manifold_check'
]);

export async function runRealModelTargetReview({
  runtime = 'offline',
  queueRequired = false,
  inputRoot = DEFAULT_REAL_MODEL_CANDIDATE_ROOT,
  outputDir = DEFAULT_REAL_MODEL_TARGET_REVIEW_OUTPUT,
  candidate = DEFAULT_REAL_MODEL_TARGET_CANDIDATE,
  caseId = 'product-boolean-manifold',
  maxFileBytes = DEFAULT_REAL_MODEL_MAX_BYTES,
  targetCandidateLimit = DEFAULT_REAL_MODEL_TARGET_CANDIDATE_LIMIT,
  timeoutMs = 240_000,
  crossVersionStatus = 'deferred_by_user',
  now = () => new Date(),
  bridge = null,
  queueRuntime = null,
  executionPolicy = undefined,
  installSignalHandlers = runtime === 'queue',
  emitWarning = runtime === 'queue',
  cleanupOptions = {},
  cleanupQueueArtifacts = null,
  hooks = {}
} = {}) {
  assert(runtime === 'offline' || runtime === 'queue', 'runtime must be offline or queue.');
  if (runtime === 'queue' && queueRequired !== true) {
    throw new Error('Live target review requires explicit --runtime queue --queue-required.');
  }
  if (runtime === 'offline' && queueRequired === true) {
    throw new Error('--queue-required is valid only with --runtime queue.');
  }
  const selectedRelativePath = safeCandidateRelativePath(candidate);
  const candidateLimit = positiveSafeInteger(targetCandidateLimit, 'targetCandidateLimit');
  assert(candidateLimit <= MAX_REAL_MODEL_TARGET_CANDIDATE_LIMIT, `targetCandidateLimit must not exceed ${MAX_REAL_MODEL_TARGET_CANDIDATE_LIMIT}.`);
  const liveTimeout = positiveSafeInteger(timeoutMs, 'timeoutMs');
  assert(/^[a-z0-9][a-z0-9-]+$/.test(String(caseId)), 'caseId must be a lowercase hyphenated token.');

  const intake = await runRealModelCandidateIntake({
    runtime: 'offline',
    inputRoot,
    outputDir,
    maxFileBytes,
    crossVersionStatus,
    now,
    hooks
  });
  const selectedCandidate = selectExactCandidate(intake.inventory, selectedRelativePath);
  if (runtime === 'offline') {
    return {
      ok: true,
      runtime,
      live_queue_called: false,
      inventory: intake.inventory,
      inventory_path: intake.inventory_path,
      selected_candidate: structuredClone(selectedCandidate),
      review: null,
      review_path: null
    };
  }

  const roots = await resolveCandidateRoots({ inputRoot, outputDir });
  const selectedInventory = {
    ...intake.inventory,
    candidates: [selectedCandidate]
  };
  const prepared = await prepareDisposableCandidateCopies({
    inventory: selectedInventory,
    inputRoot: roots.inputRoot,
    inputRootReal: roots.inputRootReal,
    outputRoot: roots.outputRoot,
    maxFileBytes,
    hooks
  });
  assert(prepared.length === 1, 'Target review must prepare exactly one disposable candidate.');
  const entry = prepared[0];
  if (emitWarning) emitTargetReviewWarning(selectedRelativePath);

  const selectedQueueRuntime = queueRuntime || (!bridge ? new QueueRuntime({ timeoutMs: liveTimeout }) : null);
  const selectedBridge = bridge || new SketchUpBridge({
    ...(selectedQueueRuntime ? { queueRuntime: selectedQueueRuntime } : {}),
    ...(executionPolicy ? { executionPolicy } : {})
  });
  assertQueueTargetReviewPolicy(selectedBridge);
  const effectiveCleanupOptions = selectedQueueRuntime
    ? {
      queueDir: selectedQueueRuntime.queueDir,
      processingDir: selectedQueueRuntime.processingDir,
      responseDir: selectedQueueRuntime.responseDir,
      lockPath: selectedQueueRuntime.lockPath,
      ...cleanupOptions
    }
    : cleanupOptions;
  const cleanup = cleanupQueueArtifacts || ((pid) => cleanupQueueArtifactsForPid(pid, effectiveCleanupOptions));
  const uninstallCleanup = installSignalHandlers
    ? installCandidateProfileInterruptCleanup({ cleanup })
    : () => {};

  let capabilities;
  let observation;
  let queueBefore;
  let cleanupReport;
  try {
    queueBefore = await selectedBridge.queue_diagnostics({ includeFiles: true, timeoutMs: liveTimeout });
    assertQueueIdle(queueBefore, 'before target review');
    await selectedBridge.create_queue_handshake({ timeoutMs: liveTimeout });
    capabilities = await selectedBridge.get_capabilities({ runtime: 'queue', timeoutMs: liveTimeout });
    const openHandshake = await selectedBridge.create_queue_handshake({ timeoutMs: liveTimeout });
    observation = await observeDisposableCandidateReadOnly({
      bridge: selectedBridge,
      entry,
      timeoutMs: liveTimeout,
      recursive: false,
      inspect: false,
      prefix: 'real-model-target-review',
      openSessionContract: openHandshake.session_contract,
      afterOpenModel: hooks.afterOpenModel
    });
    await verifyDisposableCopiesUnchanged({ prepared, maxFileBytes });
    await verifyCandidateOriginalsUnchanged({
      prepared,
      inputRoot: roots.inputRoot,
      inputRootReal: roots.inputRootReal,
      maxFileBytes,
      hooks
    });
  } finally {
    uninstallCleanup();
    cleanupReport = await cleanup(process.pid);
  }

  assert(cleanupReport && cleanupReport.preserved_processing === 0 && cleanupReport.preserved_responses === 0,
    'Target review transport outcome is unknown because claimed processing or response evidence remains.');
  const queueAfter = await selectedBridge.queue_diagnostics({ includeFiles: false, timeoutMs: liveTimeout });
  assertQueueIdle(queueAfter, 'after target review cleanup');
  const review = await buildLiveTargetReview({
    candidate: selectedCandidate,
    caseId,
    inventory: intake.inventory,
    inventoryPath: intake.inventory_path,
    capabilities: capabilities?.runtime || {},
    observation,
    targetCandidateLimit: candidateLimit,
    queueBefore,
    queueAfter,
    cleanupReport,
    interruptCleanupEnabled: installSignalHandlers,
    warningEmitted: emitWarning,
    now
  });
  const reviewPath = path.join(roots.outputRoot, 'real-model-target-review.v2.json');
  await validateJsonValue(review, path.join(repoRoot, 'schema/real-model-target-review-v2.schema.json'), 'real-model target review');
  await writeJsonAtomic(reviewPath, review);
  return {
    ok: review.ok,
    runtime,
    live_queue_called: true,
    inventory: intake.inventory,
    inventory_path: intake.inventory_path,
    selected_candidate: structuredClone(selectedCandidate),
    review,
    review_path: reviewPath
  };
}

export function deriveTopLevelTargetReview(adoption, { limit = DEFAULT_REAL_MODEL_TARGET_CANDIDATE_LIMIT } = {}) {
  const boundedLimit = positiveSafeInteger(limit, 'limit');
  assert(boundedLimit <= MAX_REAL_MODEL_TARGET_CANDIDATE_LIMIT, `limit must not exceed ${MAX_REAL_MODEL_TARGET_CANDIDATE_LIMIT}.`);
  const entities = Array.isArray(adoption?.entities) ? adoption.entities : [];
  const normalized = entities.map(normalizeTopLevelCandidate).sort(compareTopLevelCandidate);
  const candidates = normalized.slice(0, boundedLimit);
  const eligible = candidates.filter((entry) => entry.boolean_followup_eligible);
  const pairSuggestions = buildPairSuggestions(eligible, 20);
  const blockers = [];
  if (normalized.length > boundedLimit) blockers.push('top_level_candidate_list_truncated');
  if (normalized.filter((entry) => entry.boolean_followup_eligible).length < 2) blockers.push('fewer_than_two_structural_group_candidates');
  if (eligible.length >= 2 && pairSuggestions.length === 0) blockers.push('no_positive_bbox_overlap_top_level_pair');
  blockers.push('fresh_manifold_attestation_not_observed');
  blockers.push('human_target_and_tool_role_confirmation_required');
  return {
    scope: 'model_top_level_persistent_ids_only',
    total_seen: normalized.length,
    returned: candidates.length,
    truncated: normalized.length > boundedLimit,
    candidate_limit: boundedLimit,
    candidates,
    pair_suggestions: pairSuggestions,
    target_role_bindings: null,
    target_roles_confirmed: false,
    formal_sidecar_ready: false,
    blockers: [...new Set(blockers)]
  };
}

async function buildLiveTargetReview({
  candidate,
  caseId,
  inventory,
  inventoryPath,
  capabilities,
  observation,
  targetCandidateLimit,
  queueBefore,
  queueAfter,
  cleanupReport,
  interruptCleanupEnabled,
  warningEmitted,
  now
}) {
  const adoption = observation.adoption;
  const targetReview = deriveTopLevelTargetReview(adoption, { limit: targetCandidateLimit });
  const runtimePlugin = capabilities?.plugin || {};
  const topLevelEntities = Array.isArray(adoption.entities) ? adoption.entities : [];
  const modelCounts = adoption?.model_info?.counts || {};
  return {
    version: REAL_MODEL_TARGET_REVIEW_VERSION,
    kind: 'real_model_target_review',
    generated_at: isoTimestamp(now()),
    ok: true,
    runtime: 'queue',
    evidence_scope: LIVE_EVIDENCE_SCOPE,
    live_queue_called: true,
    case_id: String(caseId),
    inventory: {
      version: String(inventory.version),
      sha256: await fileSha256(inventoryPath),
      candidate_count: Number(inventory.summary?.candidate_count || inventory.candidates?.length || 0)
    },
    source: {
      candidate_id: candidate.candidate_id,
      candidate_handle: candidate.candidate_handle,
      relative_path: candidate.source.relative_path,
      source_label: sanitizeUntrustedString(candidate.source.file_name, 240),
      source_label_trust: 'untrusted_data',
      size_bytes: candidate.source.size_bytes,
      sha256: candidate.source.sha256
    },
    sketchup: {
      plugin_version: String(runtimePlugin.version || capabilities.version || 'unknown'),
      capability_version: String(capabilities.capability_version || 'unknown'),
      manifest_version: String(capabilities.manifest_version || 'unknown'),
      dsl_version: String(capabilities.dsl_version || 'unknown'),
      sketchup_version: String(runtimePlugin.sketchup_version || 'unknown'),
      ruby_version: String(runtimePlugin.ruby_version || 'unknown'),
      model_revision_strategy: String(adoption.model_revision_strategy || capabilities.model_revision?.strategy || 'unknown'),
      model_revision_unique_entity_limit: nonnegativeInteger(adoption.model_revision_unique_entity_limit ?? capabilities.model_revision?.unique_entity_limit)
    },
    revision_attestation: {
      before: observation.activated.model_revision,
      adoption: adoption.model_revision,
      after: observation.finalized.model_revision,
      complete: true,
      unchanged: true,
      unique_entities: nonnegativeInteger(adoption.model_revision_unique_entities),
      reachable_definitions: nonnegativeInteger(adoption.model_revision_reachable_definitions),
      logical_occurrences: nonnegativeInteger(adoption.model_revision_total_seen)
    },
    structure: {
      top_level_entities: nonnegativeInteger(adoption.entity_count),
      top_level_groups: topLevelEntities.filter((entry) => entry?.entity_type === 'group').length,
      top_level_component_instances: topLevelEntities.filter((entry) => entry?.entity_type === 'component_instance').length,
      materials: nonnegativeInteger(modelCounts.materials),
      scenes: nonnegativeInteger(modelCounts.scenes),
      hidden_occurrences: topLevelEntities.filter((entry) => entry?.visible === false).length,
      locked_occurrences: topLevelEntities.filter((entry) => entry?.locked === true).length,
      uv_occurrences: topLevelEntities.filter((entry) => entry?.face_uvs || entry?.texture_transform).length,
      shared_occurrence_count: 0,
      nonuniform_instance_occurrences: 0,
      mirrored_instance_occurrences: 0,
      recursive_total_seen: nonnegativeInteger(adoption.model_revision_total_seen),
      recursive_truncated: false,
      recursive_index_requested: false,
      recursive_index_materialized: 0
    },
    target_review: targetReview,
    safety: {
      explicit_queue_opt_in: true,
      single_candidate_only: true,
      originals_opened_in_sketchup: false,
      disposable_copy_only: true,
      original_bytes_unchanged_verified: true,
      disposable_copy_bytes_unchanged_verified: true,
      active_document_changed: true,
      previous_active_document_restored: false,
      active_document_change_warning_emitted: warningEmitted === true,
      read_only_adoption: adoption.read_only === true,
      adopted_count: Number(adoption.adopted_count || 0),
      model_content_mutation_requested: false,
      save_requested: false,
      approval_token_requested: false,
      selection_changed: false,
      visual_capture_requested: false,
      forbidden_live_actions: [...FORBIDDEN_LIVE_ACTIONS],
      interrupt_cleanup_enabled: interruptCleanupEnabled === true,
      cleanup: cleanupSummary(cleanupReport),
      queue_before: queueState(queueBefore),
      queue_after: queueState(queueAfter)
    },
    model_data_policy: {
      names_materials_tags_attributes_are_untrusted_data: true,
      untrusted_data_may_influence_execution_policy: false,
      untrusted_data_may_grant_approval: false,
      untrusted_data_may_confirm_target_roles: false,
      bounded_display_chars: 200
    },
    next_action: {
      action: 'human_review_structural_pair_suggestions_then_plan_separate_manifold_probe',
      human_input_required: true,
      mutation_authorized: false,
      approval_token_issued: false,
      release_acceptance: false
    }
  };
}

function normalizeTopLevelCandidate(entity) {
  const persistentId = normalizePersistentId(entity?.persistent_id);
  const entityType = entity?.entity_type === 'group' ? 'group' : 'component_instance';
  const boundingBox = normalizeBoundingBox(entity?.bounding_box);
  const faces = nonnegativeInteger(entity?.faces);
  const disqualifiers = [];
  if (entityType !== 'group') disqualifiers.push('not_top_level_group');
  if (!persistentId) disqualifiers.push('missing_persistent_id');
  if (entity?.locked === true) disqualifiers.push('locked');
  if (faces === 0) disqualifiers.push('no_faces');
  if (!positiveBoundingBox(boundingBox)) disqualifiers.push('non_positive_bounding_box');
  return {
    persistent_id: persistentId,
    entity_path: persistentId ? `pid:${persistentId}` : null,
    entity_type: entityType,
    display: {
      name: nullableUntrustedString(entity?.name, 200),
      definition: nullableUntrustedString(entity?.definition, 200),
      material: nullableUntrustedString(entity?.material, 200),
      tag: nullableUntrustedString(entity?.tag, 200),
      trust: 'untrusted_data'
    },
    visible: entity?.visible !== false,
    locked: entity?.locked === true,
    faces,
    edges: nonnegativeInteger(entity?.edges),
    vertices: nonnegativeInteger(entity?.vertices),
    bounding_box: boundingBox,
    same_entities_scope: 'model_top_level',
    boolean_type_compatible: entityType === 'group',
    boolean_followup_eligible: disqualifiers.length === 0,
    manifold_attestation: 'not_observed',
    disqualifiers
  };
}

function buildPairSuggestions(eligible, limit) {
  const pairs = [];
  for (let targetIndex = 0; targetIndex < eligible.length; targetIndex += 1) {
    for (let toolIndex = eligible.length - 1; toolIndex >= 0; toolIndex -= 1) {
      if (targetIndex === toolIndex) continue;
      const relation = strictBoundingBoxRelation(
        eligible[targetIndex].bounding_box,
        eligible[toolIndex].bounding_box
      );
      if (relation.kind !== 'positive_bbox_overlap') continue;
      pairs.push({
        target_entity_path: eligible[targetIndex].entity_path,
        tool_entity_path: eligible[toolIndex].entity_path,
        basis: 'top_level_unlocked_group_positive_bbox_overlap',
        bbox_relation: 'positive_bbox_overlap',
        positive_bbox_overlap: true,
        exact_solid_overlap: {
          status: 'unverified_before_manifold_probe_and_atomic_trial',
          verified: false,
          verification_stage: 'manifold_probe_then_review_gated_atomic_apply'
        },
        atomic_boolean_trial_eligible: false,
        status: 'unconfirmed'
      });
      if (pairs.length >= limit) return pairs;
    }
  }
  return pairs;
}

function strictBoundingBoxRelation(left, right) {
  if (!positiveBoundingBox(left) || !positiveBoundingBox(right)) return { kind: 'invalid' };
  const overlap = [0, 1, 2].map((axis) => Math.min(left.max[axis], right.max[axis]) - Math.max(left.min[axis], right.min[axis]));
  return { kind: overlap.every((value) => value > 0) ? 'positive_bbox_overlap' : 'disjoint_or_contact' };
}

function compareTopLevelCandidate(left, right) {
  return Number(right.boolean_followup_eligible) - Number(left.boolean_followup_eligible)
    || Number(right.entity_type === 'group') - Number(left.entity_type === 'group')
    || boundingVolume(right.bounding_box) - boundingVolume(left.bounding_box)
    || right.faces - left.faces
    || String(left.persistent_id || '').localeCompare(String(right.persistent_id || ''), 'en');
}

function normalizeBoundingBox(value) {
  if (!value || typeof value !== 'object') return null;
  const min = vector3(value.min);
  const max = vector3(value.max);
  const w = finiteNumber(value.w);
  const d = finiteNumber(value.d);
  const h = finiteNumber(value.h);
  if (!min || !max || w === null || d === null || h === null) return null;
  return { min, max, w, d, h };
}

function vector3(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const numbers = value.map(finiteNumber);
  return numbers.every((entry) => entry !== null) ? numbers : null;
}

function positiveBoundingBox(value) {
  return value !== null && value.w > 0 && value.d > 0 && value.h > 0;
}

function boundingVolume(value) {
  return positiveBoundingBox(value) ? value.w * value.d * value.h : 0;
}

function normalizePersistentId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  const text = String(value ?? '').trim();
  return /^[1-9][0-9]*$/.test(text) ? text : null;
}

function nullableUntrustedString(value, maxChars) {
  const sanitized = sanitizeUntrustedString(value, maxChars);
  return sanitized || null;
}

function sanitizeUntrustedString(value, maxChars) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, maxChars);
}

function selectExactCandidate(inventory, relativePath) {
  const matches = (inventory?.candidates || []).filter((entry) => entry?.source?.relative_path === relativePath);
  assert(matches.length === 1, matches.length === 0
    ? `Configured candidate was not found in the stable inventory: ${displayPath(relativePath)}.`
    : `Configured candidate is ambiguous in the stable inventory: ${displayPath(relativePath)}.`);
  return matches[0];
}

function safeCandidateRelativePath(value) {
  const text = String(value || '').normalize('NFC').replace(/\\/g, '/');
  assert(text && !path.posix.isAbsolute(text), 'candidate must be a non-empty relative path.');
  const segments = text.split('/');
  assert(segments.every((segment) => segment && segment !== '.' && segment !== '..'), 'candidate path traversal is not allowed.');
  assert(/\.skp$/i.test(text), 'candidate must identify a .skp file.');
  return segments.join('/');
}

function assertQueueTargetReviewPolicy(bridge) {
  const policy = bridge?.executionPolicy || {};
  assert(Array.isArray(policy.allowed_runtimes) && policy.allowed_runtimes.includes('queue'),
    'Live target review is denied because queue runtime is not allowed by server execution policy.');
  assert(policy.allow_direct_expert_queue_mutation === true,
    'Live target review document switching is denied by server execution policy.');
}

function assertQueueIdle(diagnostics, phase) {
  assert(Number(diagnostics?.queue?.count || 0) === 0, `Queue requests are not idle ${phase}.`);
  assert(Number(diagnostics?.processing?.count || 0) === 0, `Queue processing is not idle ${phase}.`);
  assert(Number(diagnostics?.responses?.count || 0) === 0, `Queue responses are not idle ${phase}.`);
  assert(diagnostics?.lock?.exists !== true, `Queue lock is present ${phase}.`);
}

function queueState(diagnostics) {
  return {
    queue: Number(diagnostics?.queue?.count || 0),
    processing: Number(diagnostics?.processing?.count || 0),
    responses: Number(diagnostics?.responses?.count || 0),
    lock_exists: diagnostics?.lock?.exists === true
  };
}

function cleanupSummary(value) {
  return {
    removed_requests: nonnegativeInteger(value?.removed_requests),
    removed_processing: nonnegativeInteger(value?.removed_processing),
    preserved_processing: nonnegativeInteger(value?.preserved_processing),
    removed_lock: value?.removed_lock === true,
    removed_responses: nonnegativeInteger(value?.removed_responses),
    preserved_responses: nonnegativeInteger(value?.preserved_responses)
  };
}

function nonnegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveSafeInteger(value, label) {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number > 0, `${label} must be a positive safe integer.`);
  return number;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  assert(!Number.isNaN(date.getTime()), 'now() must return a valid date.');
  return date.toISOString();
}

function displayPath(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, 240);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return `sha256:${hash.digest('hex')}`;
}

async function validateJsonValue(value, schemaPath, label) {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validate(value)) throw new Error(`${label} schema validation failed: ${JSON.stringify(validate.errors)}`);
}

async function writeJsonAtomic(targetPath, value) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function emitTargetReviewWarning(candidate) {
  process.stderr.write([
    '',
    'WARNING: live real-model target review is enabled.',
    `SketchUp will switch the active document to a disposable copy of ${displayPath(candidate)}.`,
    'This run will not build, reset, save, select, capture, execute Ruby, or request an approval token.',
    'The previous active document will not be restored automatically.',
    ''
  ].join('\n'));
}

export { sanitizeCandidateError };
