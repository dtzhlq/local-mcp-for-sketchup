import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from './bridge.mjs';
import { cleanupQueueArtifactsForPid } from './queue-runtime.mjs';
import { AgentContractError } from './agent-contract.mjs';

export const REAL_MODEL_CANDIDATE_INVENTORY_VERSION = 'real-model-candidate-inventory.v1';
export const REAL_MODEL_CANDIDATE_PROFILE_VERSION = 'real-model-candidate-profile.v1';
export const DEFAULT_REAL_MODEL_CANDIDATE_ROOT = 'test/模型';
export const DEFAULT_REAL_MODEL_CANDIDATE_OUTPUT = 'output/real-model-reliability/intake';
export const DEFAULT_REAL_MODEL_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_REAL_MODEL_RECURSIVE_LIMIT = 10_000;
export const MAX_REAL_MODEL_RECURSIVE_LIMIT = 100_000;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKP_MEDIA_TYPE = 'application/vnd.sketchup.skp';
const CROSS_VERSION_STATUSES = new Set(['not_run', 'planned', 'deferred_by_user']);

export async function runRealModelCandidateIntake({
  runtime = 'offline',
  queueRequired = false,
  inputRoot = DEFAULT_REAL_MODEL_CANDIDATE_ROOT,
  outputDir = DEFAULT_REAL_MODEL_CANDIDATE_OUTPUT,
  maxFileBytes = DEFAULT_REAL_MODEL_MAX_BYTES,
  recursiveLimit = DEFAULT_REAL_MODEL_RECURSIVE_LIMIT,
  timeoutMs = 240_000,
  crossVersionStatus = 'not_run',
  now = () => new Date(),
  bridge = null,
  installSignalHandlers = runtime === 'queue',
  emitWarning = runtime === 'queue',
  cleanupOptions = {},
  cleanupQueueArtifacts = (pid) => cleanupQueueArtifactsForPid(pid, cleanupOptions),
  hooks = {}
} = {}) {
  assert(['offline', 'queue'].includes(runtime), 'runtime must be offline or queue.');
  if (runtime === 'queue' && queueRequired !== true) {
    throw new Error('Live candidate profiling requires explicit --runtime queue --queue-required.');
  }
  if (runtime === 'offline' && queueRequired === true) {
    throw new Error('--queue-required is valid only with --runtime queue.');
  }
  const byteLimit = positiveSafeInteger(maxFileBytes, 'maxFileBytes');
  const indexLimit = positiveSafeInteger(recursiveLimit, 'recursiveLimit');
  assert(indexLimit <= MAX_REAL_MODEL_RECURSIVE_LIMIT, `recursiveLimit must not exceed ${MAX_REAL_MODEL_RECURSIVE_LIMIT}.`);
  const liveTimeout = positiveSafeInteger(timeoutMs, 'timeoutMs');
  assert(CROSS_VERSION_STATUSES.has(crossVersionStatus), 'crossVersionStatus must be not_run, planned, or deferred_by_user.');

  const roots = await resolveCandidateRoots({ inputRoot, outputDir });
  const inventory = await buildCandidateInventory({
    ...roots,
    maxFileBytes: byteLimit,
    crossVersionStatus,
    now,
    hooks
  });
  await fs.mkdir(roots.outputRoot, { recursive: true, mode: 0o700 });
  const inventoryPath = path.join(roots.outputRoot, 'real-model-candidate-inventory.v1.json');
  await validateJsonValue(inventory, path.join(repoRoot, 'schema/real-model-candidate-inventory-v1.schema.json'), 'candidate inventory');
  await writeJsonAtomic(inventoryPath, inventory);

  if (runtime === 'offline') {
    return {
      ok: true,
      runtime,
      live_queue_called: false,
      inventory,
      inventory_path: inventoryPath,
      profile: null,
      profile_path: null
    };
  }

  const prepared = await prepareDisposableCandidateCopies({
    inventory,
    inputRoot: roots.inputRoot,
    inputRootReal: roots.inputRootReal,
    outputRoot: roots.outputRoot,
    maxFileBytes: byteLimit,
    hooks
  });
  if (emitWarning) emitLiveProfileWarning();
  const selectedBridge = bridge || new SketchUpBridge({});
  assertQueueProfilePolicy(selectedBridge);
  const uninstallCleanup = installSignalHandlers
    ? installCandidateProfileInterruptCleanup({ cleanup: cleanupQueueArtifacts })
    : () => {};

  let profile;
  try {
    profile = await profilePreparedCandidates({
      bridge: selectedBridge,
      prepared,
      inventory,
      inventoryPath,
      timeoutMs: liveTimeout,
      recursiveLimit: indexLimit,
      crossVersionStatus,
      now,
      interruptCleanupEnabled: installSignalHandlers,
      warningEmitted: emitWarning,
      hooks
    });
    await verifyDisposableCopiesUnchanged({ prepared, maxFileBytes: byteLimit });
    await verifyCandidateOriginalsUnchanged({
      prepared,
      inputRoot: roots.inputRoot,
      inputRootReal: roots.inputRootReal,
      maxFileBytes: byteLimit,
      hooks
    });
    profile.safety.disposable_copy_bytes_unchanged_verified = true;
    profile.safety.original_bytes_unchanged_verified = true;
  } finally {
    uninstallCleanup();
    await cleanupQueueArtifacts(process.pid);
  }

  const profilePath = path.join(roots.outputRoot, 'real-model-candidate-profile.v1.json');
  await validateJsonValue(profile, path.join(repoRoot, 'schema/real-model-candidate-profile-v1.schema.json'), 'candidate profile');
  await writeJsonAtomic(profilePath, profile);
  return {
    ok: profile.ok,
    runtime,
    live_queue_called: true,
    inventory,
    inventory_path: inventoryPath,
    profile,
    profile_path: profilePath
  };
}

export async function buildCandidateInventory({
  inputRoot,
  inputRootReal,
  outputRoot,
  maxFileBytes = DEFAULT_REAL_MODEL_MAX_BYTES,
  crossVersionStatus = 'not_run',
  now = () => new Date(),
  hooks = {}
} = {}) {
  if (!inputRoot || !inputRootReal || !outputRoot) {
    const roots = await resolveCandidateRoots({ inputRoot: inputRoot || DEFAULT_REAL_MODEL_CANDIDATE_ROOT, outputDir: outputRoot || DEFAULT_REAL_MODEL_CANDIDATE_OUTPUT });
    inputRoot = roots.inputRoot;
    inputRootReal = roots.inputRootReal;
    outputRoot = roots.outputRoot;
  }
  const scan = await scanCandidateTree({ inputRoot, inputRootReal });
  assert(scan.models.length > 0, 'Configured input root contains no regular .skp candidate files.');
  const generatedAt = isoTimestamp(now());
  const candidates = [];
  for (const relativePath of scan.models) {
    const observed = await readStableCandidateFile({
      inputRoot,
      inputRootReal,
      relativePath,
      maxFileBytes,
      label: `Candidate ${displayPath(relativePath)}`,
      afterOpen: hooks.afterOpen
    });
    const candidateToken = sha256Hex(`${observed.sha256}\0${relativePath}`).slice(0, 24);
    candidates.push({
      candidate_id: `candidate_${candidateToken}`,
      candidate_handle: `candidate:sha256:${candidateToken}`,
      media_type: SKP_MEDIA_TYPE,
      source: {
        scope: 'configured_input_root',
        relative_path: relativePath,
        file_name: path.posix.basename(relativePath),
        size_bytes: observed.sizeBytes,
        mtime: observed.mtime,
        sha256: observed.sha256
      },
      trust: {
        classification: 'untrusted_data',
        may_influence_execution_policy: false,
        may_grant_approval: false
      },
      intake: {
        status: 'awaiting_live_profile',
        regular_file_verified: true,
        symbolic_link: false,
        stable_read_verified: true,
        sketchup_header_verified: true,
        original_modified: false
      }
    });
  }
  candidates.sort((left, right) => left.source.relative_path.localeCompare(right.source.relative_path, 'en'));
  const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.source.size_bytes, 0);
  return {
    version: REAL_MODEL_CANDIDATE_INVENTORY_VERSION,
    kind: 'real_model_candidate_inventory',
    generated_at: generatedAt,
    source_root: {
      scope: sourceRootScope(inputRoot),
      label: sourceRootLabel(inputRoot),
      absolute_path_disclosed: false
    },
    policy: {
      originals_read_only: true,
      regular_skp_only: true,
      symbolic_links_rejected: true,
      stable_descriptor_read_required: true,
      max_file_bytes: maxFileBytes,
      live_queue_called: false,
      disposable_copy_required_for_live_profile: true,
      model_content_is_untrusted_data: true,
      formal_corpus_acceptance: false
    },
    cross_version: crossVersionState(crossVersionStatus),
    summary: {
      candidate_count: candidates.length,
      unique_content_hashes: new Set(candidates.map((candidate) => candidate.source.sha256)).size,
      total_bytes: totalBytes,
      ignored_non_skp_regular_files: scan.ignoredRegularFiles,
      ignored_directories: scan.directories
    },
    candidates
  };
}

export async function prepareDisposableCandidateCopies({
  inventory,
  inputRoot,
  inputRootReal,
  outputRoot,
  maxFileBytes = DEFAULT_REAL_MODEL_MAX_BYTES,
  hooks = {}
}) {
  const runRoot = path.join(outputRoot, 'live-work', `preflight-${crypto.randomUUID()}`);
  await fs.mkdir(runRoot, { recursive: true, mode: 0o700 });
  const prepared = [];
  try {
    for (const candidate of inventory.candidates) {
      const caseDir = path.join(runRoot, candidate.candidate_id);
      await fs.mkdir(caseDir, { mode: 0o700 });
      const workingPath = path.join(caseDir, 'candidate.skp');
      const copied = await copyStableCandidateFile({
        inputRoot,
        inputRootReal,
        relativePath: candidate.source.relative_path,
        destinationPath: workingPath,
        maxFileBytes,
        label: `Candidate ${candidate.candidate_id}`,
        afterOpen: hooks.afterCopyOpen
      });
      assert(copied.sha256 === candidate.source.sha256, `Candidate ${candidate.candidate_id} changed after inventory generation.`);
      assert(copied.sizeBytes === candidate.source.size_bytes, `Candidate ${candidate.candidate_id} size changed after inventory generation.`);
      prepared.push({ candidate, workingPath, caseDir, copiedSha256: copied.sha256 });
    }
    return prepared.sort((left, right) =>
      left.candidate.source.size_bytes - right.candidate.source.size_bytes
      || left.candidate.candidate_id.localeCompare(right.candidate.candidate_id)
    );
  } catch (error) {
    await fs.rm(runRoot, { recursive: true, force: true });
    throw error;
  }
}

export function installCandidateProfileInterruptCleanup({
  cleanup = (pid) => cleanupQueueArtifactsForPid(pid),
  pid = process.pid,
  exit = (code) => process.exit(code)
} = {}) {
  let stopping = false;
  const handlers = new Map();
  for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => {
      if (stopping) return;
      stopping = true;
      void cleanup(pid)
        .catch((error) => process.stderr.write(`[candidate-profile-cleanup] ${sanitizeCandidateError(error)}\n`))
        .finally(() => exit(exitCode));
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

export function cleanupCandidateProfileQueueArtifacts(pid = process.pid, options = {}) {
  return cleanupQueueArtifactsForPid(pid, options);
}

async function profilePreparedCandidates({
  bridge,
  prepared,
  inventory,
  inventoryPath,
  timeoutMs,
  recursiveLimit,
  crossVersionStatus,
  now,
  interruptCleanupEnabled,
  warningEmitted,
  hooks
}) {
  const initialHandshake = await bridge.create_queue_handshake({ timeoutMs });
  const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
  const runtimeCapabilities = capabilities?.runtime || {};
  const sketchupVersion = String(runtimeCapabilities?.plugin?.sketchup_version || 'unknown');
  assert(sketchupVersion !== 'unknown', 'Live candidate profiling requires a reported SketchUp version.');
  const profiles = [];
  let stop = false;
  for (const entry of prepared) {
    if (stop) {
      profiles.push(notRunProfile(entry.candidate, 'not_run_after_previous_profile_failure'));
      continue;
    }
    try {
      const openContract = profiles.length === 0
        ? initialHandshake.session_contract
        : (await bridge.create_queue_handshake({ timeoutMs })).session_contract;
      const observation = await observeDisposableCandidateReadOnly({
        bridge,
        entry,
        timeoutMs,
        recursive: true,
        recursiveLimit,
        inspect: true,
        prefix: 'real-model-candidate-profile',
        openSessionContract: openContract,
        afterOpenModel: hooks.afterOpenModel
      });
      profiles.push(profileFromObservation({
        candidate: entry.candidate,
        inspected: observation.inspected,
        adoption: observation.adoption,
        beforeRevision: observation.adoption.model_revision,
        afterRevision: observation.finalized.model_revision,
        opened: observation.opened,
        recursiveLimit
      }));
    } catch (error) {
      stop = true;
      profiles.push(failedProfile(entry.candidate, error));
    }
  }
  const ok = profiles.length === prepared.length && profiles.every((profile) => profile.status === 'profiled');
  return {
    version: REAL_MODEL_CANDIDATE_PROFILE_VERSION,
    kind: 'real_model_candidate_profile',
    generated_at: isoTimestamp(now()),
    ok,
    runtime: 'queue',
    evidence_scope: 'user_coordinated_disposable_copy_read_only_profile',
    live_queue_called: true,
    inventory: {
      version: inventory.version,
      sha256: await fileSha256(inventoryPath),
      candidate_count: inventory.candidates.length
    },
    safety: {
      explicit_queue_opt_in: true,
      preflight_all_candidates_before_queue: true,
      originals_opened_in_sketchup: false,
      disposable_copy_only: true,
      model_content_mutation_requested: false,
      save_requested: false,
      read_only_adoption_required: true,
      complete_revision_unchanged_required: true,
      candidates_profiled_smallest_first: true,
      disposable_copy_bytes_unchanged_verified: false,
      original_bytes_unchanged_verified: false,
      interrupt_cleanup_enabled: interruptCleanupEnabled === true,
      active_document_change_warning_emitted: warningEmitted === true,
      active_document_changed: true,
      previous_active_document_restored: false
    },
    model_data_policy: {
      names_materials_tags_scenes_attributes_are_untrusted_data: true,
      untrusted_data_may_influence_execution_policy: false,
      untrusted_data_may_grant_approval: false,
      bounded_display_values_per_category: 50,
      bounded_display_value_chars: 200
    },
    cross_version: {
      ...crossVersionState(crossVersionStatus),
      observed_versions: [sketchupVersion],
      complete: false
    },
    sketchup: {
      version: sketchupVersion,
      plugin_version: String(runtimeCapabilities?.plugin?.version || runtimeCapabilities?.version || 'unknown'),
      capability_version: String(runtimeCapabilities?.capability_version || 'unknown')
    },
    summary: {
      candidates: profiles.length,
      profiled: profiles.filter((profile) => profile.status === 'profiled').length,
      failed: profiles.filter((profile) => profile.status === 'failed').length,
      not_run: profiles.filter((profile) => profile.status === 'not_run').length,
      formal_cases_accepted: 0
    },
    profiles,
    next_action: {
      action: 'review_candidate_profiles_and_assign_formal_corpus_cases',
      formal_sidecars_generated: false,
      note: 'A human must review domain fit, target roles, and expectations before any *.reliability.json sidecar is created or any mutation gate is run.'
    }
  };
}

export async function observeDisposableCandidateReadOnly({
  bridge,
  entry,
  timeoutMs,
  recursive = true,
  recursiveLimit = DEFAULT_REAL_MODEL_RECURSIVE_LIMIT,
  inspect = true,
  prefix = 'real-model-candidate-profile',
  openSessionContract,
  afterOpenModel
}) {
  assert(openSessionContract && typeof openSessionContract === 'object', 'A fresh Session Contract is required before opening a disposable candidate.');
  const opened = await bridge.open_model({
    runtime: 'queue',
    timeoutMs,
    path: entry.workingPath,
    session_contract: openSessionContract
  });
  if (typeof afterOpenModel === 'function') await afterOpenModel({ entry, opened });
  const activated = await waitForDisposableModelActivation({ bridge, workingPath: entry.workingPath, timeoutMs });
  const inspected = inspect
    ? await bridge.inspect_model({
      runtime: 'queue',
      timeoutMs,
      includeEntities: true,
      includeSnapshot: true,
      includeHidden: true
    })
    : null;
  const adoption = await bridge.adopt_open_model({
    runtime: 'queue',
    timeoutMs,
    recursive,
    ...(recursive ? { recursive_limit: recursiveLimit } : {}),
    read_only: true,
    prefix
  });
  const finalized = (await bridge.create_queue_handshake({ timeoutMs })).session_contract;
  assertDisposableIdentity(activated.model_identity, entry.workingPath, entry.candidate.candidate_id);
  assertDisposableIdentity(adoption.model_identity, entry.workingPath, entry.candidate.candidate_id);
  assertDisposableIdentity(finalized.model_identity, entry.workingPath, entry.candidate.candidate_id);
  assert(adoption.read_only === true, `Candidate ${entry.candidate.candidate_id} did not return read-only adoption attestation.`);
  assert(Number(adoption.adopted_count || 0) === 0, `Candidate ${entry.candidate.candidate_id} read-only profile unexpectedly adopted entities.`);
  const beforeRevision = adoption.model_revision;
  const revisionsComplete = adoption.model_revision_complete === true
    && finalized.model_revision_complete === true;
  const revisionUnchanged = beforeRevision === finalized.model_revision;
  assert(revisionsComplete, `Candidate ${entry.candidate.candidate_id} has an incomplete model revision; profile cannot attest read-only state.`);
  assert(revisionUnchanged, `Candidate ${entry.candidate.candidate_id} changed during read-only profiling.`);
  return { opened, activated, inspected, adoption, finalized };
}

export async function waitForDisposableModelActivation({ bridge, workingPath, timeoutMs }) {
  const started = Date.now();
  let lastIdentity = null;
  while (Date.now() - started < timeoutMs) {
    const observed = typeof bridge.get_active_model_identity === 'function'
      ? await bridge.get_active_model_identity({ timeoutMs })
      : (await bridge.create_queue_handshake({ timeoutMs })).session_contract;
    lastIdentity = observed?.model_identity || null;
    if (samePath(lastIdentity?.source_path, workingPath)) return observed;
    await shortDelay(250);
  }
  const observed = lastIdentity?.source_path ? '<different-active-document>' : '<no-active-source-path>';
  throw new AgentContractError(
    'HANDSHAKE_DOCUMENT_MISMATCH',
    `Disposable candidate did not become the active SketchUp document before timeout (${observed}).`,
    {
      details: { pending_mdi_activation: true, observed },
      nextAction: { action: 'focus_opened_model_then_retry_profile' }
    }
  );
}

function profileFromObservation({ candidate, inspected, adoption, beforeRevision, afterRevision, opened, recursiveLimit }) {
  const snapshot = inspected?.snapshot || adoption?.snapshot || {};
  const recursiveIndex = Array.isArray(adoption?.recursive_index) ? adoption.recursive_index : [];
  const topEntities = Array.isArray(inspected?.entities) ? inspected.entities : [];
  const structure = structureSummary({ snapshot, adoption, recursiveIndex, topEntities, recursiveLimit });
  return {
    candidate_id: candidate.candidate_id,
    candidate_handle: candidate.candidate_handle,
    source_sha256: candidate.source.sha256,
    status: 'profiled',
    error: null,
    live_observation: {
      open_status: opened?.open_status === 'pending_mdi_activation' ? 'activated_after_wait' : 'activated',
      source_path: '<disposable-working-copy>',
      original_opened: false,
      read_only: adoption.read_only === true,
      adopted_count: Number(adoption.adopted_count || 0)
    },
    revision_attestation: {
      before: beforeRevision,
      after: afterRevision,
      complete: true,
      unchanged: beforeRevision === afterRevision,
      ...(adoption?.model_revision_strategy ? { strategy: String(adoption.model_revision_strategy) } : {}),
      ...(Number.isSafeInteger(adoption?.model_revision_unique_entity_limit) ? { unique_entity_limit: adoption.model_revision_unique_entity_limit } : {}),
      ...(Number.isSafeInteger(adoption?.model_revision_unique_entities) ? { unique_entities: adoption.model_revision_unique_entities } : {}),
      ...(Number.isSafeInteger(adoption?.model_revision_reachable_definitions) ? { reachable_definitions: adoption.model_revision_reachable_definitions } : {})
    },
    structure,
    candidate_case_signals: candidateCaseSignals(structure),
    untrusted_model_data: boundedUntrustedModelData({ snapshot, adoption }),
    formal_sidecar: {
      generated: false,
      review_required: true,
      accepted_case_id: null,
      reason: 'Domain fit, persistent-id target roles, and mutation expectations require human review.'
    }
  };
}

function structureSummary({ snapshot, adoption, recursiveIndex, topEntities, recursiveLimit }) {
  const entityTypeCounts = countBy(recursiveIndex, (entry) => String(entry?.entity_type || 'unknown'));
  const instanceEntries = recursiveIndex.filter((entry) => ['group', 'component_instance'].includes(entry?.entity_type));
  const transforms = instanceEntries.map((entry) => transformSignals(entry?.world_transform || entry?.transformation || entry?.transform)).filter(Boolean);
  const sharedDefinitions = new Set(recursiveIndex.filter((entry) => entry?.shared_definition === true || Number(entry?.affected_instance_count || 0) > 1)
    .map((entry) => entry?.definition_persistent_id || entry?.definition_name || entry?.parent_definition)
    .filter(Boolean).map(String));
  const modelInfo = inspectedModelInfo(snapshot, adoption);
  const allObserved = recursiveIndex.length ? recursiveIndex : topEntities;
  return {
    top_level_entities: Number(adoption?.entity_count ?? topEntities.length),
    recursive_indexed: recursiveIndex.length,
    recursive_total_seen: Number(adoption?.recursive_total_seen ?? recursiveIndex.length),
    recursive_truncated: adoption?.recursive_truncated === true,
    recursive_limit: recursiveLimit,
    max_occurrence_depth: recursiveIndex.reduce((max, entry) => Math.max(max, Array.isArray(entry?.path_segments) ? entry.path_segments.length : pathDepth(entry?.entity_path)), 0),
    entity_type_counts: {
      group: entityTypeCounts.group || 0,
      component_instance: entityTypeCounts.component_instance || 0,
      face: entityTypeCounts.face || 0,
      edge: entityTypeCounts.edge || 0,
      unknown: entityTypeCounts.unknown || 0
    },
    geometry_totals: normalizeTotals(snapshot?.totals),
    component_definitions: Number(modelInfo?.counts?.component_definitions ?? snapshot?.component_definitions?.length ?? 0),
    materials: Number(modelInfo?.counts?.materials ?? snapshot?.materials?.length ?? 0),
    tags: Number(modelInfo?.counts?.tags ?? snapshot?.tags?.length ?? 0),
    scenes: Number(modelInfo?.counts?.scenes ?? snapshot?.scenes?.length ?? 0),
    classification_schemas: Number(modelInfo?.counts?.classification_schemas ?? snapshot?.classification_schemas?.length ?? 0),
    hidden_occurrences: allObserved.filter((entry) => entry?.visible === false || entry?.hidden === true).length,
    locked_occurrences: allObserved.filter((entry) => entry?.locked === true).length,
    attributed_occurrences: allObserved.filter((entry) => hasNonEmptyObject(entry?.attributes)).length,
    classified_occurrences: allObserved.filter((entry) => entry?.classification || entry?.native_classification).length,
    uv_occurrences: allObserved.filter((entry) => entry?.face_uvs || entry?.texture_transform).length,
    shared_definition_count: sharedDefinitions.size,
    shared_occurrence_count: recursiveIndex.filter((entry) => entry?.shared_definition === true || Number(entry?.affected_instance_count || 0) > 1).length,
    scaled_instance_occurrences: transforms.filter((entry) => entry.scaled).length,
    nonuniform_instance_occurrences: transforms.filter((entry) => entry.nonuniform).length,
    mirrored_instance_occurrences: transforms.filter((entry) => entry.mirrored).length,
    warning_count: warningCount(snapshot?.warning_summary)
  };
}

function candidateCaseSignals(structure) {
  const appearanceEvidence = [];
  if (structure.materials > 0) appearanceEvidence.push('materials_present');
  if (structure.scenes > 0) appearanceEvidence.push('scenes_present');
  if (structure.hidden_occurrences > 0) appearanceEvidence.push('hidden_occurrences_present');
  if (structure.uv_occurrences > 0) appearanceEvidence.push('uv_or_texture_metadata_present');
  const sharedEvidence = [];
  if (structure.shared_definition_count > 0) sharedEvidence.push('shared_definitions_present');
  if (structure.max_occurrence_depth >= 3) sharedEvidence.push('deep_occurrence_path_present');
  if (structure.recursive_total_seen >= 5_000) sharedEvidence.push('large_recursive_index_present');
  const transformEvidence = [];
  if (structure.locked_occurrences > 0) transformEvidence.push('locked_occurrences_present');
  if (structure.nonuniform_instance_occurrences > 0) transformEvidence.push('nonuniform_scale_present');
  if (structure.mirrored_instance_occurrences > 0) transformEvidence.push('mirrored_transform_present');
  return [
    signal('appearance-scenes-hidden', appearanceEvidence),
    signal('deep-shared-components', sharedEvidence),
    signal('scaled-mirrored-locked', transformEvidence),
    {
      case_id: 'imported-dirty-topology',
      status: 'not_observable_without_reviewed_topology_probe',
      evidence_signals: [],
      human_review_required: true
    },
    ...['architecture-golden', 'interior-expression', 'product-boolean-manifold'].map((caseId) => ({
      case_id: caseId,
      status: 'semantic_domain_not_inferred',
      evidence_signals: [],
      human_review_required: true
    }))
  ];
}

function signal(caseId, evidenceSignals) {
  return {
    case_id: caseId,
    status: evidenceSignals.length ? 'candidate_signal_present' : 'insufficient_evidence',
    evidence_signals: evidenceSignals,
    human_review_required: true
  };
}

function boundedUntrustedModelData({ snapshot, adoption }) {
  const definitions = snapshot?.component_definition_summaries || adoption?.component_definition_summaries || [];
  const values = {
    material_names: snapshot?.material_names || (snapshot?.materials || []).map((entry) => entry?.name || entry),
    scene_names: (snapshot?.scenes || []).map((entry) => entry?.name || entry),
    tag_names: (snapshot?.tags || []).map((entry) => entry?.name || entry),
    component_definition_names: definitions.map((entry) => entry?.name || entry?.definition_name || entry)
  };
  return Object.fromEntries(Object.entries(values).map(([key, entries]) => [key, boundedStrings(entries)]));
}

function boundedStrings(values, maxValues = 50, maxChars = 200) {
  const source = Array.isArray(values) ? values : [];
  const normalized = source.map((value) => sanitizeUntrustedString(value, maxChars)).filter(Boolean);
  return {
    values: normalized.slice(0, maxValues),
    total_seen: normalized.length,
    truncated: normalized.length > maxValues
  };
}

function sanitizeUntrustedString(value, maxChars) {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  return raw.replace(/[\u0000-\u001f\u007f]/g, '\uFFFD').slice(0, maxChars);
}

function failedProfile(candidate, error) {
  const details = boundedProfileErrorDetails(error?.details);
  return {
    candidate_id: candidate.candidate_id,
    candidate_handle: candidate.candidate_handle,
    source_sha256: candidate.source.sha256,
    status: 'failed',
    error: {
      code: stableProfileErrorCode(error),
      message: sanitizeCandidateError(error),
      retryable: error?.retryable === true,
      next_action: error?.next_action && typeof error.next_action === 'object'
        ? { action: sanitizeMachineToken(error.next_action.action, 'inspect_queue_and_active_document_before_retry') }
        : { action: 'inspect_queue_and_active_document_before_retry' },
      ...(details ? { details } : {})
    }
  };
}

function boundedProfileErrorDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  if (typeof value.strategy === 'string') result.strategy = sanitizeMachineToken(value.strategy, 'unknown');
  for (const key of ['total_seen', 'indexed', 'unique_entities']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  if (Array.isArray(value.blockers)) {
    result.blockers = value.blockers.slice(0, 20).map((entry) => sanitizeMachineToken(entry, 'unknown'));
  }
  if (value.pending_mdi_activation === true) result.pending_mdi_activation = true;
  if (typeof value.observed === 'string' && /^<[a-z-]+>$/.test(value.observed)) result.observed = value.observed;
  return Object.keys(result).length ? result : null;
}

function sanitizeMachineToken(value, fallback) {
  const token = String(value || '').slice(0, 120);
  return /^[a-zA-Z0-9_.:-]+$/.test(token) ? token : fallback;
}

function notRunProfile(candidate, reason) {
  return {
    candidate_id: candidate.candidate_id,
    candidate_handle: candidate.candidate_handle,
    source_sha256: candidate.source.sha256,
    status: 'not_run',
    error: {
      code: 'PROFILE_NOT_RUN',
      message: reason,
      retryable: true,
      next_action: { action: 'resolve_previous_failure_then_start_new_profile_run' }
    }
  };
}

export async function verifyCandidateOriginalsUnchanged({ prepared, inputRoot, inputRootReal, maxFileBytes, hooks = {} }) {
  for (const entry of prepared) {
    const observed = await readStableCandidateFile({
      inputRoot,
      inputRootReal,
      relativePath: entry.candidate.source.relative_path,
      maxFileBytes,
      label: `Candidate ${entry.candidate.candidate_id}`,
      afterOpen: hooks.afterFinalOriginalOpen
    });
    assert(observed.sha256 === entry.candidate.source.sha256, `Candidate ${entry.candidate.candidate_id} original changed during live profiling.`);
  }
}

export async function verifyDisposableCopiesUnchanged({ prepared, maxFileBytes }) {
  for (const entry of prepared) {
    const caseDirReal = await fs.realpath(entry.caseDir);
    const observed = await readStableCandidateFile({
      inputRoot: entry.caseDir,
      inputRootReal: caseDirReal,
      relativePath: 'candidate.skp',
      maxFileBytes,
      label: `Disposable copy ${entry.candidate.candidate_id}`
    });
    assert(observed.sha256 === entry.candidate.source.sha256, `Disposable copy ${entry.candidate.candidate_id} changed during live profiling.`);
  }
}

export async function resolveCandidateRoots({ inputRoot, outputDir }) {
  const resolvedInput = resolveRepoOrAbsolute(inputRoot);
  const inputLstat = await fs.lstat(resolvedInput, { bigint: true }).catch(() => null);
  assert(inputLstat, 'Configured input root is missing.');
  assert(!inputLstat.isSymbolicLink(), 'Configured input root must not be a symbolic link.');
  assert(inputLstat.isDirectory(), 'Configured input root must be a directory.');
  const inputReal = await fs.realpath(resolvedInput);
  const resolvedOutput = resolveRepoOrAbsolute(outputDir);
  const outputLstat = await fs.lstat(resolvedOutput, { bigint: true }).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  assert(!outputLstat?.isSymbolicLink(), 'Output directory must not be a symbolic link.');
  assert(!outputLstat || outputLstat.isDirectory(), 'Output path must be a directory.');
  const canonicalOutput = await canonicalPotentialPath(resolvedOutput);
  assert(
    !isWithin(resolvedInput, resolvedOutput) && !isWithin(inputReal, canonicalOutput),
    'Output directory must be outside the configured input root.'
  );
  return { inputRoot: resolvedInput, inputRootReal: inputReal, outputRoot: resolvedOutput };
}

async function canonicalPotentialPath(targetPath) {
  const suffix = [];
  let cursor = path.resolve(targetPath);
  while (true) {
    try {
      const canonicalParent = await fs.realpath(cursor);
      return path.resolve(canonicalParent, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      assert(parent !== cursor, 'Output path has no resolvable parent.');
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function scanCandidateTree({ inputRoot, inputRootReal }) {
  const models = [];
  let ignoredRegularFiles = 0;
  let directories = 0;
  const walk = async (absoluteDir, relativeDir = '') => {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(path.join(relativeDir, entry.name));
      const absolutePath = safeChildPath(inputRoot, relativePath);
      const stats = await fs.lstat(absolutePath, { bigint: true });
      assert(!stats.isSymbolicLink(), `Candidate input contains a symbolic link: ${displayPath(relativePath)}.`);
      if (stats.isDirectory()) {
        directories += 1;
        const realDirectory = await fs.realpath(absolutePath);
        assert(isWithin(inputRootReal, realDirectory), `Candidate directory escapes configured input root: ${displayPath(relativePath)}.`);
        await walk(absolutePath, relativePath);
      } else if (stats.isFile()) {
        if (/\.skp$/i.test(entry.name)) models.push(relativePath);
        else ignoredRegularFiles += 1;
      } else {
        throw new Error(`Candidate input contains a non-regular entry: ${displayPath(relativePath)}.`);
      }
    }
  };
  await walk(inputRoot);
  models.sort((left, right) => left.localeCompare(right, 'en'));
  return { models, ignoredRegularFiles, directories };
}

async function readStableCandidateFile(options) {
  return withStableCandidateFile(options, async (handle, before) => {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    let header = Buffer.alloc(0);
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
      hash.update(chunk);
      bytes += chunk.length;
      if (header.length < 96) header = Buffer.concat([header, chunk.subarray(0, 96 - header.length)]);
    }
    assert(BigInt(bytes) === before.size, `${options.label} byte count changed while being read.`);
    assertSketchUpHeader(header, options.label);
    return {
      sha256: `sha256:${hash.digest('hex')}`,
      sizeBytes: bytes,
      mtime: new Date(Number(before.mtimeNs / 1_000_000n)).toISOString()
    };
  });
}

async function copyStableCandidateFile(options) {
  return withStableCandidateFile(options, async (sourceHandle, before) => {
    const destinationHandle = await fs.open(options.destinationPath, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let position = 0;
    let header = Buffer.alloc(0);
    try {
      for await (const chunk of sourceHandle.createReadStream({ autoClose: false, start: 0 })) {
        hash.update(chunk);
        if (header.length < 96) header = Buffer.concat([header, chunk.subarray(0, 96 - header.length)]);
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await destinationHandle.write(chunk, offset, chunk.length - offset, position);
          assert(bytesWritten > 0, `${options.label} disposable copy made no progress.`);
          offset += bytesWritten;
          position += bytesWritten;
        }
      }
      assert(BigInt(position) === before.size, `${options.label} disposable copy byte count changed.`);
      assertSketchUpHeader(header, options.label);
      await destinationHandle.truncate(position);
      await destinationHandle.sync();
      return { sha256: `sha256:${hash.digest('hex')}`, sizeBytes: position };
    } catch (error) {
      await fs.rm(options.destinationPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await destinationHandle.close();
    }
  });
}

async function withStableCandidateFile({ inputRoot, inputRootReal, relativePath, maxFileBytes, label, afterOpen }, consume) {
  const filePath = safeChildPath(inputRoot, relativePath);
  const beforePath = await fs.lstat(filePath, { bigint: true }).catch(() => null);
  assert(beforePath, `${label} is missing.`);
  assert(!beforePath.isSymbolicLink(), `${label} must not be a symbolic link.`);
  assert(beforePath.isFile(), `${label} must be a regular file.`);
  assert(beforePath.size <= BigInt(maxFileBytes), `${label} exceeds the configured max file size.`);
  const beforeRealPath = await fs.realpath(filePath);
  assert(isWithin(inputRootReal, beforeRealPath), `${label} real path escapes configured input root.`);
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (error) {
    throw new Error(`${label} could not be opened without following links (${String(error?.code || 'open_failed')}).`);
  }
  try {
    const beforeHandle = await handle.stat({ bigint: true });
    assert(beforeHandle.isFile(), `${label} open descriptor is not a regular file.`);
    assert(sameFileIdentityAndSize(beforePath, beforeHandle), `${label} changed between lstat and open.`);
    if (typeof afterOpen === 'function') await afterOpen({ label, relative_path: relativePath, file_path: filePath });
    const result = await consume(handle, beforeHandle);
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(filePath, { bigint: true }).catch(() => null),
      fs.realpath(filePath).catch(() => null)
    ]);
    assert(afterPath?.isFile() && !afterPath.isSymbolicLink(), `${label} path changed type while being read.`);
    assert(afterRealPath && isWithin(inputRootReal, afterRealPath), `${label} real path escaped configured input root while being read.`);
    assert(sameFileIdentityAndSize(beforeHandle, afterHandle), `${label} descriptor inode or size changed while being read.`);
    assert(sameFileIdentityAndSize(beforeHandle, afterPath), `${label} path was replaced while being read.`);
    assert(beforeHandle.mtimeNs === afterHandle.mtimeNs && beforeHandle.ctimeNs === afterHandle.ctimeNs, `${label} timestamps changed while being read.`);
    return result;
  } finally {
    await handle.close();
  }
}

function assertQueueProfilePolicy(bridge) {
  const policy = bridge?.executionPolicy || {};
  assert(
    Array.isArray(policy.allowed_runtimes)
      && policy.allowed_runtimes.includes('queue')
      && policy.allow_queue_mutation === true
      && policy.allow_direct_expert_queue_mutation === true,
    'Live candidate profiling is denied by execution policy. The user-run host must explicitly allow queue and direct expert document switching.'
  );
}

function assertSketchUpHeader(header, label) {
  const signature = Buffer.from('SketchUp Model', 'utf16le');
  assert(Buffer.isBuffer(header) && header.indexOf(signature) >= 0 && header.indexOf(signature) <= 16, `${label} does not have a recognized SketchUp model header.`);
}

function assertDisposableIdentity(identity, workingPath, candidateId) {
  assert(identity && samePath(identity.source_path, workingPath), `Candidate ${candidateId} active document identity does not match its disposable working copy.`);
}

function transformSignals(value) {
  const matrix = Array.isArray(value) ? value.map(Number) : null;
  if (!matrix || matrix.length < 16 || matrix.some((entry) => !Number.isFinite(entry))) return null;
  const x = vectorLength(matrix[0], matrix[1], matrix[2]);
  const y = vectorLength(matrix[4], matrix[5], matrix[6]);
  const z = vectorLength(matrix[8], matrix[9], matrix[10]);
  const determinant = determinant3(matrix[0], matrix[4], matrix[8], matrix[1], matrix[5], matrix[9], matrix[2], matrix[6], matrix[10]);
  const epsilon = 1e-6;
  return {
    scaled: [x, y, z].some((scale) => Math.abs(scale - 1) > epsilon),
    nonuniform: Math.max(x, y, z) - Math.min(x, y, z) > epsilon,
    mirrored: determinant < -epsilon
  };
}

function inspectedModelInfo(snapshot, adoption) {
  return adoption?.model_info || {
    counts: {
      component_definitions: snapshot?.component_definitions?.length || 0,
      materials: snapshot?.materials?.length || 0,
      tags: snapshot?.tags?.length || 0,
      scenes: snapshot?.scenes?.length || 0,
      classification_schemas: snapshot?.classification_schemas?.length || 0
    }
  };
}

function normalizeTotals(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    groups: nonnegativeInteger(source.groups),
    instances: nonnegativeInteger(source.instances),
    faces: nonnegativeInteger(source.faces),
    edges: nonnegativeInteger(source.edges),
    vertices: nonnegativeInteger(source.vertices)
  };
}

function warningCount(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, entry) => sum + (Array.isArray(entry) ? entry.length : Number.isFinite(Number(entry)) ? Number(entry) : entry ? 1 : 0), 0);
}

function crossVersionState(status) {
  return {
    status,
    required_for_current_milestone: false,
    reason: status === 'deferred_by_user'
      ? 'User explicitly deferred cross-version validation for the current real-model intake milestone.'
      : status === 'planned'
        ? 'Cross-version validation is planned as a later separately coordinated gate.'
        : 'Cross-version validation has not been run.'
  };
}

function sourceRootScope(inputRoot) {
  return isWithin(repoRoot, inputRoot) ? 'workspace' : 'configured_external_root';
}

function sourceRootLabel(inputRoot) {
  if (!isWithin(repoRoot, inputRoot)) return '<configured-external-root>';
  return normalizeRelativePath(path.relative(repoRoot, inputRoot));
}

function sameFileIdentityAndSize(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function safeChildPath(root, relativePath) {
  assert(!path.isAbsolute(relativePath), 'Candidate relative path must not be absolute.');
  const resolved = path.resolve(root, relativePath);
  assert(isWithin(root, resolved), 'Candidate relative path escapes configured input root.');
  return resolved;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativePath(value) {
  return String(value).split(path.sep).join('/');
}

function resolveRepoOrAbsolute(value) {
  assert(typeof value === 'string' && value.trim(), 'Path option must be a non-empty string.');
  return path.resolve(path.isAbsolute(value) ? value : path.join(repoRoot, value));
}

function displayPath(value) {
  return normalizeRelativePath(value).replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 300);
}

function samePath(left, right) {
  if (!left || !right) return false;
  return path.resolve(String(left)) === path.resolve(String(right));
}

function pathDepth(value) {
  return String(value || '').split('/').filter(Boolean).length;
}

function countBy(values, keyFor) {
  const result = {};
  for (const value of values) {
    const key = keyFor(value);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function hasNonEmptyObject(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length);
}

function vectorLength(x, y, z) {
  return Math.hypot(x, y, z);
}

function determinant3(a, b, c, d, e, f, g, h, i) {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function nonnegativeInteger(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function positiveSafeInteger(value, label) {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number > 0, `${label} must be a positive safe integer.`);
  return number;
}

function stableProfileErrorCode(error) {
  const code = String(error?.code || 'PROFILE_FAILED').toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'PROFILE_FAILED';
}

export function sanitizeCandidateError(error) {
  return String(error?.message || error || 'Candidate profile failed.')
    .replaceAll(repoRoot, '<workspace>')
    .replace(/\/(Users|home)\/[^\s"']+/g, '<redacted-path>')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 600);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  assert(Number.isFinite(date.getTime()), 'now() must return a valid date.');
  return date.toISOString();
}

function emitLiveProfileWarning() {
  process.stderr.write([
    '',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    '[CAUTION] REAL-MODEL CANDIDATE LIVE PROFILE',
    'This run WILL switch the active SketchUp document among disposable copies.',
    'It WILL NOT request model edits or saves, and it never opens the originals.',
    'Close valuable unsaved work. On macOS, focus a newly opened copy if asked.',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ''
  ].join('\n'));
}

function shortDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
