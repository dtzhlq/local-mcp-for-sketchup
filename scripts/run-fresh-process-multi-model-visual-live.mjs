#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareBackgroundNormalizedImages } from '../src/background-normalized-visual-comparison.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  CAPABILITY_MANIFEST_VERSION,
  QUEUE_MODEL_REVISION_STRATEGY,
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { projectRoot } from '../src/paths.mjs';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import {
  cleanupReliabilityQueueArtifacts,
  installReliabilityInterruptCleanup
} from './run-real-model-reliability-harness.mjs';

export const FRESH_PROCESS_MULTI_MODEL_VISUAL_EVIDENCE_VERSION = 'fresh-process-multi-model-visual-evidence.v1';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CHECKPOINT_VERSION = 'fresh-process-multi-model-visual-checkpoint.v1';
const DEFAULT_RUN_DIR = path.join(
  projectRoot,
  'output',
  'live-validation',
  'visual-consistency',
  'current-source-2026-07-23-v1'
);
const DEFAULT_EVIDENCE_PATH = path.join(
  projectRoot,
  'docs',
  'evidence',
  'fresh-process-multi-model-visual-evidence-2026-07-23.json'
);
const CASES = Object.freeze({
  architecture: Object.freeze({
    domain: 'architecture',
    source: path.join(
      projectRoot,
      'output',
      'live-validation',
      'real-model-reliability-inputs',
      'architecture-golden-derived-v1',
      'architecture-building.skp'
    ),
    basename: 'architecture-visual-consistency.skp',
    recursive_limit: 20_000
  }),
  product: Object.freeze({
    domain: 'product',
    source: path.join(
      projectRoot,
      'output',
      'live-validation',
      'real-model-reliability-inputs',
      'product-boolean-manifold-derived-v1',
      'product-boolean-manifold.skp'
    ),
    basename: 'product-visual-consistency.skp',
    recursive_limit: 100_000
  })
});

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${safeMessage(error)}\n`);
    process.exitCode = 1;
  });
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.command === 'stage') return stage(options);
  if (options.command === 'aggregate') return aggregate(options);
  assertLiveOptIn(options);
  const uninstallCleanup = installReliabilityInterruptCleanup();
  try {
    if (options.command === 'capture') return await capturePhase(options, 'before');
    if (options.command === 'recapture') return await capturePhase(options, 'after');
    throw new Error(usage());
  } finally {
    uninstallCleanup();
    await cleanupReliabilityQueueArtifacts(process.pid);
  }
}

export async function stage(options = {}) {
  const runDir = await resolveRunDir(options.runDir || DEFAULT_RUN_DIR, { create: true });
  const liveWorkDir = path.join(runDir, 'live-work');
  const privateDir = path.join(runDir, 'private');
  await Promise.all([
    fs.mkdir(liveWorkDir, { recursive: true }),
    fs.mkdir(privateDir, { recursive: true, mode: 0o700 })
  ]);
  await fs.chmod(privateDir, 0o700);
  const staged = [];
  for (const [caseId, config] of Object.entries(CASES)) {
    const source = await resolveSourceModel(config.source);
    const workingCopy = path.join(liveWorkDir, config.basename);
    await assertAbsent(workingCopy, `Working copy for ${caseId} already exists; use a new --run-dir.`);
    const sourceSha256 = await sha256File(source);
    await fs.copyFile(source, workingCopy, fs.constants.COPYFILE_EXCL);
    const workingCopySha256 = await sha256File(workingCopy);
    assert.equal(workingCopySha256, sourceSha256);
    const checkpoint = {
      version: CHECKPOINT_VERSION,
      kind: 'fresh_process_multi_model_visual_checkpoint',
      case_id: caseId,
      domain: config.domain,
      phase: 'staged',
      created_at: new Date().toISOString(),
      source_model: source,
      source_sha256: sourceSha256,
      source_size_bytes: (await fs.stat(source)).size,
      working_copy: workingCopy,
      working_copy_sha256: workingCopySha256,
      working_copy_size_bytes: (await fs.stat(workingCopy)).size,
      recursive_limit: config.recursive_limit,
      before: null,
      after: null,
      comparison: null
    };
    await writePrivateJson(checkpointPath(runDir, caseId), checkpoint);
    staged.push({
      case_id: caseId,
      domain: config.domain,
      working_copy: repoRelative(workingCopy),
      fixture_handle: `fixture:sha256:${workingCopySha256}`,
      size_bytes: checkpoint.working_copy_size_bytes
    });
  }
  const result = {
    ok: true,
    phase: 'staged',
    run_dir: repoRelative(runDir),
    cases: staged,
    queue_called: false,
    next_action: 'open_exact_case_working_copy_then_run_capture_with_explicit_queue_opt_in'
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function capturePhase(options = {}, phase) {
  const caseId = requiredCaseId(options.caseId);
  const runDir = await resolveRunDir(options.runDir || DEFAULT_RUN_DIR);
  const checkpoint = await readCheckpoint(runDir, caseId, phase === 'before' ? 'staged' : 'captured');
  const phaseLabel = phase === 'before' ? 'capture' : 'recapture';
  process.stderr.write(
    `[LIVE READ-ONLY] ${phaseLabel} will bind the exact ${caseId} disposable copy, `
    + 'capture the current saved view, and leave model bytes/state unchanged. It does not reset, edit, save, or approve the model.\n'
  );
  const bridge = createBridge(runDir, options.timeoutMs);
  const queueBefore = summarizeQueue(await bridge.queue_diagnostics({
    includeFiles: true,
    timeoutMs: options.timeoutMs
  }));
  assertQueueIdle(queueBefore);
  const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: options.timeoutMs });
  assertCurrentRuntime(capabilities.runtime);
  const handshake = await bridge.create_queue_handshake({
    expires_in_ms: 5 * 60 * 1000,
    timeoutMs: options.timeoutMs
  });
  await assertActiveWorkingCopy(handshake.session_contract, checkpoint);
  assert.equal(handshake.session_contract.model_modified, false, 'The active disposable copy must be clean.');
  assert.equal(await sha256File(checkpoint.working_copy), checkpoint.working_copy_sha256);

  if (phase === 'after') {
    assert.notEqual(
      sha256Text(handshake.session_contract.session_id),
      checkpoint.before.session_fingerprint,
      'The SketchUp plugin session did not change; fully quit and reopen before recapture.'
    );
    assert.equal(
      handshake.session_contract.model_revision,
      checkpoint.before.model_revision,
      'The model revision changed across the full restart.'
    );
  }

  const adoption = await bridge.adopt_open_model({
    runtime: 'queue',
    recursive: true,
    recursive_limit: checkpoint.recursive_limit,
    read_only: true,
    timeoutMs: options.timeoutMs
  });
  assertCompleteAdoption(adoption, checkpoint, handshake.session_contract);
  const graph = buildModelGraph(adoption);
  const binding = {
    model_key: modelKeyForIdentity(modelIdentityForAdoption(adoption)),
    graph_id: graph.graph_id,
    model_revision: graph.model_revision
  };
  assert.equal(binding.model_revision, handshake.session_contract.model_revision);
  const taskId = `task_${crypto.randomUUID()}`;
  const capture = await bridge.withAgentGatewayExecution(
    { taskId, intent: 'visual_correction_qa' },
    (gatewayBridge) => bridge.agentGateway.liveVisualCaptureService.capture({
      bridge: gatewayBridge,
      taskId,
      phase,
      sessionContract: handshake.session_contract,
      expectedBinding: binding,
      recursiveLimit: checkpoint.recursive_limit,
      ...(phase === 'after' ? { sourceCaptureProvenance: checkpoint.before.provenance } : {})
    })
  );
  const captureBytes = await bridge.agentGateway.imageArtifactStore.readBuffer(capture.record.handle);
  const captureDir = path.join(runDir, 'captures', caseId);
  await fs.mkdir(captureDir, { recursive: true, mode: 0o700 });
  const imagePath = path.join(captureDir, `${phase}.png`);
  await writeFileAtomic(imagePath, captureBytes, 0o600);
  assert.equal(await sha256FileTagged(imagePath), capture.record.sha256);

  const queueAfter = summarizeQueue(await bridge.queue_diagnostics({
    includeFiles: true,
    timeoutMs: options.timeoutMs
  }));
  assertQueueIdle(queueAfter);
  assert.equal(await sha256File(checkpoint.working_copy), checkpoint.working_copy_sha256);
  assert.equal(await sha256File(checkpoint.source_model), checkpoint.source_sha256);
  const observation = {
    captured_at: new Date().toISOString(),
    task_id: taskId,
    session_fingerprint: sha256Text(handshake.session_contract.session_id),
    document_fingerprint: sha256Text(handshake.session_contract.document_id),
    model_key: binding.model_key,
    graph_id: binding.graph_id,
    model_revision: binding.model_revision,
    logical_occurrences: adoption.model_revision_total_seen,
    indexed_occurrences: adoption.model_revision_indexed,
    recursive_truncated: adoption.recursive_truncated === true,
    image: {
      path: repoRelative(imagePath),
      sha256: capture.record.sha256,
      width: capture.record.width,
      height: capture.record.height,
      size_bytes: capture.record.size_bytes
    },
    provenance: capture.provenance,
    runtime: runtimeSummary(capabilities.runtime),
    queue_before: queueBefore,
    queue_after: queueAfter,
    model_modified: handshake.session_contract.model_modified
  };
  if (phase === 'before') {
    checkpoint.phase = 'captured';
    checkpoint.before = observation;
  } else {
    assert.equal(observation.model_key, checkpoint.before.model_key);
    assert.equal(observation.graph_id, checkpoint.before.graph_id);
    assert.equal(observation.model_revision, checkpoint.before.model_revision);
    assert.equal(observation.provenance.camera_hash, checkpoint.before.provenance.camera_hash);
    assert.equal(observation.provenance.capture_spec_hash, checkpoint.before.provenance.capture_spec_hash);
    const beforeBytes = await fs.readFile(path.join(projectRoot, checkpoint.before.image.path));
    const comparisonResult = await compareBackgroundNormalizedImages({
      referenceBuffer: beforeBytes,
      captureBuffer: captureBytes
    });
    assert.equal(comparisonResult.comparison.segmentation.reliable, true);
    assert.equal(comparisonResult.comparison.structure.verdict, 'coarse_structure_pass');
    const comparisonDir = path.join(captureDir, 'background-normalized');
    await fs.mkdir(comparisonDir, { recursive: true, mode: 0o700 });
    const comparisonPath = path.join(comparisonDir, 'comparison.json');
    await writeJsonAtomic(comparisonPath, comparisonResult.comparison, 0o600);
    const artifactPaths = {};
    for (const [name, bytes] of Object.entries(comparisonResult.artifacts)) {
      const basename = `${name.replaceAll('_', '-')}.png`;
      const artifactPath = path.join(comparisonDir, basename);
      await writeFileAtomic(artifactPath, bytes, 0o600);
      artifactPaths[repoRelative(artifactPath)] = await sha256File(artifactPath);
    }
    checkpoint.phase = 'recaptured';
    checkpoint.after = observation;
    checkpoint.comparison = {
      path: repoRelative(comparisonPath),
      sha256: await sha256File(comparisonPath),
      comparison_id: comparisonResult.comparison.comparison_id,
      comparison_hash: comparisonResult.comparison.comparison_hash,
      image_bytes_equal: checkpoint.before.image.sha256 === observation.image.sha256,
      structure_verdict: comparisonResult.comparison.structure.verdict,
      intersection_over_union: comparisonResult.comparison.structure.intersection_over_union,
      dice_coefficient: comparisonResult.comparison.structure.dice_coefficient,
      appearance_mean_absolute_error: comparisonResult.comparison.appearance.mean_absolute_error,
      appearance_root_mean_square_error: comparisonResult.comparison.appearance.root_mean_square_error,
      artifacts: artifactPaths
    };
  }
  await writePrivateJson(checkpointPath(runDir, caseId), checkpoint);
  const result = {
    ok: true,
    phase: checkpoint.phase,
    case_id: caseId,
    model_revision: observation.model_revision,
    capture: observation.image,
    model_bytes_unchanged: true,
    model_modified: false,
    queue_clean: true,
    ...(phase === 'before'
      ? { next_action: 'fully_quit_sketchup_then_reopen_exact_same_working_copy_and_run_recapture' }
      : {
          fresh_plugin_session_observed: true,
          camera_hash_exact: true,
          comparison: checkpoint.comparison,
          next_action: allCasesRecaptured(await readAllCheckpoints(runDir))
            ? 'run_aggregate'
            : 'fully_quit_sketchup_then_capture_the_other_case'
        })
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export async function aggregate(options = {}) {
  const runDir = await resolveRunDir(options.runDir || DEFAULT_RUN_DIR);
  const evidencePath = await resolveEvidencePath(options.evidencePath || DEFAULT_EVIDENCE_PATH);
  const checkpoints = await readAllCheckpoints(runDir);
  assert.equal(checkpoints.length, Object.keys(CASES).length);
  for (const checkpoint of checkpoints) {
    assert.equal(checkpoint.phase, 'recaptured', `${checkpoint.case_id} has not completed recapture.`);
    assert.notEqual(checkpoint.before.session_fingerprint, checkpoint.after.session_fingerprint);
    assert.equal(checkpoint.before.model_revision, checkpoint.after.model_revision);
    assert.equal(checkpoint.before.model_key, checkpoint.after.model_key);
    assert.equal(checkpoint.before.graph_id, checkpoint.after.graph_id);
    assert.equal(checkpoint.before.provenance.camera_hash, checkpoint.after.provenance.camera_hash);
    assert.equal(checkpoint.comparison.structure_verdict, 'coarse_structure_pass');
    assert.equal(await sha256File(checkpoint.working_copy), checkpoint.working_copy_sha256);
    assert.equal(await sha256File(checkpoint.source_model), checkpoint.source_sha256);
  }
  assert.equal(new Set(checkpoints.map((entry) => entry.before.model_key)).size, checkpoints.length);
  assert.equal(new Set(checkpoints.map((entry) => entry.before.model_revision)).size, checkpoints.length);
  const sourceFiles = [
    'src/background-normalized-visual-comparison.mjs',
    'scripts/run-fresh-process-multi-model-visual-live.mjs',
    'schema/background-normalized-visual-comparison-v1.schema.json',
    'schema/fresh-process-multi-model-visual-evidence-v1.schema.json',
    'test/fresh-process-multi-model-visual-runner.mjs',
    'test/fresh-process-multi-model-visual-evidence.mjs'
  ];
  const sourceSha256 = {};
  for (const sourceFile of sourceFiles) {
    sourceSha256[sourceFile] = await sha256File(path.join(projectRoot, sourceFile));
  }
  const cases = checkpoints.map((checkpoint) => ({
    case_id: checkpoint.case_id,
    domain: checkpoint.domain,
    fixture_handle: `fixture:sha256:${checkpoint.working_copy_sha256}`,
    source_fixture_unchanged: true,
    working_copy_unchanged: true,
    size_bytes: checkpoint.working_copy_size_bytes,
    model_key_distinct: true,
    model_revision: checkpoint.before.model_revision,
    logical_occurrences: checkpoint.before.logical_occurrences,
    recursive_complete: checkpoint.before.recursive_truncated === false
      && checkpoint.before.logical_occurrences === checkpoint.before.indexed_occurrences,
    full_restart: {
      plugin_session_changed: true,
      raw_session_values_omitted: true,
      model_key_exact: true,
      graph_id_exact: true,
      model_revision_exact: true,
      camera_hash_exact: true,
      capture_spec_hash_exact: true
    },
    before_capture: publicCapture(checkpoint.before),
    after_capture: publicCapture(checkpoint.after),
    comparison: {
      path: checkpoint.comparison.path,
      sha256: checkpoint.comparison.sha256,
      comparison_id: checkpoint.comparison.comparison_id,
      comparison_hash: checkpoint.comparison.comparison_hash,
      image_bytes_equal: checkpoint.comparison.image_bytes_equal,
      structure_verdict: checkpoint.comparison.structure_verdict,
      intersection_over_union: checkpoint.comparison.intersection_over_union,
      dice_coefficient: checkpoint.comparison.dice_coefficient,
      appearance_mean_absolute_error: checkpoint.comparison.appearance_mean_absolute_error,
      appearance_root_mean_square_error: checkpoint.comparison.appearance_root_mean_square_error
    },
    queue_before: checkpoint.before.queue_before,
    queue_after: checkpoint.after.queue_after
  }));
  const artifactSha256 = {};
  for (const checkpoint of checkpoints) {
    artifactSha256[checkpoint.before.image.path] = untag(checkpoint.before.image.sha256);
    artifactSha256[checkpoint.after.image.path] = untag(checkpoint.after.image.sha256);
    artifactSha256[checkpoint.comparison.path] = checkpoint.comparison.sha256;
    Object.assign(artifactSha256, checkpoint.comparison.artifacts);
  }
  const evidence = {
    version: FRESH_PROCESS_MULTI_MODEL_VISUAL_EVIDENCE_VERSION,
    kind: 'fresh_process_multi_model_read_only_visual_consistency',
    captured_at: new Date().toISOString(),
    branch: 'codex/agent-contract-v1',
    result: 'pass',
    runtime: cases[0].before_capture.runtime,
    source_sha256: sourceSha256,
    cases,
    aggregate: {
      case_count: cases.length,
      distinct_model_keys: new Set(checkpoints.map((entry) => entry.before.model_key)).size,
      distinct_model_revisions: new Set(checkpoints.map((entry) => entry.before.model_revision)).size,
      full_restart_cases: cases.filter((entry) => entry.full_restart.plugin_session_changed).length,
      camera_hash_exact_cases: cases.filter((entry) => entry.full_restart.camera_hash_exact).length,
      coarse_structure_pass_cases: cases.filter((entry) => entry.comparison.structure_verdict === 'coarse_structure_pass').length,
      model_bytes_changed_cases: 0,
      model_modified_cases: 0,
      queue_residue_cases: 0
    },
    agent_compatibility: {
      visual_agent_required: false,
      local_files_required: false,
      structured_summary_available: true
    },
    policy_invariants: {
      read_only_capture_only: true,
      model_mutation_performed: false,
      model_save_performed: false,
      approval_challenge_created: false,
      approval_token_exposed_to_agent: false,
      image_content_policy_effect: 'none',
      visual_similarity_accepted: false
    },
    artifact_sha256: artifactSha256,
    release_acceptance: false,
    boundaries: [
      'The two cases prove server-owned current-view capture consistency across full plugin-process restarts with one SketchUp instance at a time.',
      'The first capture is an internal same-model reference; this is not an external-reference correction-quality benchmark.',
      'No model edit, save, approval, CorrectionPatch promotion, or visual-similarity acceptance occurs.',
      'Cross-version validation remains deferred by the user.'
    ]
  };
  await writeJsonAtomic(evidencePath, evidence);
  const result = {
    ok: true,
    result: evidence.result,
    cases: evidence.aggregate.case_count,
    full_restart_cases: evidence.aggregate.full_restart_cases,
    coarse_structure_pass_cases: evidence.aggregate.coarse_structure_pass_cases,
    model_bytes_changed_cases: 0,
    model_modified_cases: 0,
    queue_residue_cases: 0,
    visual_similarity_accepted: false,
    release_acceptance: false,
    evidence_path: repoRelative(evidencePath)
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function createBridge(runDir, timeoutMs = 900_000) {
  return new SketchUpBridge({
    queueRuntime: new QueueRuntime({ timeoutMs }),
    executionPolicy: {
      allowed_runtimes: ['mock', 'queue'],
      allow_queue_mutation: true,
      allow_direct_expert_queue_mutation: false,
      auto_approve_risks: [],
      resource_limits: {
        max_operations: 100,
        max_affected_instances: 100_000,
        max_recursive_entities: 100_000
      }
    },
    agentContract: { rootDir: path.join(runDir, 'private', 'agent-state') },
    approval: { stateDir: path.join(runDir, 'private', 'approvals') },
    sessionContract: { serverSessionId: FRESH_PROCESS_MULTI_MODEL_VISUAL_EVIDENCE_VERSION }
  });
}

function assertCurrentRuntime(runtime = {}) {
  assert.equal(runtime.capability_version, RUNTIME_CAPABILITY_VERSION);
  assert.equal(runtime.manifest_version, CAPABILITY_MANIFEST_VERSION);
  assert.equal(runtime.model_revision?.strategy, QUEUE_MODEL_REVISION_STRATEGY);
  assert.equal(runtime.compatibility?.ok, true);
}

async function assertActiveWorkingCopy(contract, checkpoint) {
  const sourcePath = contract?.model_identity?.source_path;
  assert.equal(typeof sourcePath, 'string');
  assert.equal(await sameRealPath(sourcePath, checkpoint.working_copy), true, 'The active model is not the exact staged working copy.');
}

function assertCompleteAdoption(adoption, checkpoint, contract) {
  assert.equal(adoption.kind, 'adopt_open_model');
  assert.equal(adoption.runtime, 'queue');
  assert.equal(adoption.read_only, true);
  assert.equal(adoption.recursive_truncated, false);
  assert.equal(adoption.model_revision_complete, true);
  assert.equal(adoption.model_revision_total_seen, adoption.model_revision_indexed);
  assert.ok(adoption.model_revision_total_seen <= checkpoint.recursive_limit);
  assert.equal(adoption.session_id, contract.session_id);
  assert.equal(adoption.document_id, contract.document_id);
  assert.equal(adoption.model_revision, contract.model_revision);
}

function publicCapture(observation) {
  return {
    image: observation.image,
    model_revision: observation.model_revision,
    logical_occurrences: observation.logical_occurrences,
    indexed_occurrences: observation.indexed_occurrences,
    recursive_truncated: observation.recursive_truncated,
    camera_hash: observation.provenance.camera_hash,
    capture_spec_hash: observation.provenance.capture_spec_hash,
    state_unchanged: observation.provenance.state_unchanged,
    view_unchanged: observation.provenance.view_unchanged,
    model_modified: observation.model_modified,
    runtime: observation.runtime
  };
}

export function runtimeSummary(runtime = {}) {
  return {
    plugin_version: runtime.plugin?.version || runtime.version || null,
    sketchup_version: runtime.plugin?.sketchup_version || null,
    capability_version: runtime.capability_version || null,
    manifest_version: runtime.manifest_version || null,
    model_revision_strategy: runtime.model_revision?.strategy || null,
    compatibility_ok: runtime.compatibility?.ok === true
  };
}

async function readAllCheckpoints(runDir) {
  return Promise.all(Object.keys(CASES).map((caseId) => readCheckpoint(runDir, caseId)));
}

async function readCheckpoint(runDir, caseId, expectedPhase = null) {
  const value = JSON.parse(await fs.readFile(checkpointPath(runDir, caseId), 'utf8'));
  assert.equal(value.version, CHECKPOINT_VERSION);
  assert.equal(value.case_id, caseId);
  if (expectedPhase) assert.equal(value.phase, expectedPhase, `${caseId} must be in ${expectedPhase} phase.`);
  return value;
}

function checkpointPath(runDir, caseId) {
  return path.join(runDir, 'private', `${caseId}.checkpoint.json`);
}

function allCasesRecaptured(checkpoints) {
  return checkpoints.every((entry) => entry.phase === 'recaptured');
}

function summarizeQueue(value) {
  const diagnostics = value?.diagnostics || value;
  return {
    queue: diagnosticCount(diagnostics?.queue_count, diagnostics?.queue),
    processing: diagnosticCount(diagnostics?.processing_count, diagnostics?.processing),
    responses: diagnosticCount(diagnostics?.response_count, diagnostics?.responses),
    lock_exists: typeof diagnostics?.lock_exists === 'boolean'
      ? diagnostics.lock_exists
      : diagnostics?.lock?.exists
  };
}

function diagnosticCount(flatValue, nestedValue) {
  for (const candidate of [flatValue, nestedValue?.count, nestedValue]) {
    if (candidate === null || candidate === undefined || typeof candidate === 'object') continue;
    const count = Number(candidate);
    if (Number.isInteger(count) && count >= 0) return count;
  }
  return null;
}

function assertQueueIdle(summary) {
  assert.deepEqual(summary, { queue: 0, processing: 0, responses: 0, lock_exists: false });
}

function parseArgs(argv) {
  const result = {
    command: argv[0] || null,
    runtime: null,
    queueRequired: false,
    caseId: null,
    runDir: DEFAULT_RUN_DIR,
    evidencePath: DEFAULT_EVIDENCE_PATH,
    timeoutMs: 900_000
  };
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--runtime') result.runtime = requiredValue(argv[++index], '--runtime');
    else if (value === '--queue-required') result.queueRequired = true;
    else if (value === '--case') result.caseId = requiredValue(argv[++index], '--case');
    else if (value === '--run-dir') result.runDir = requiredValue(argv[++index], '--run-dir');
    else if (value === '--evidence-path') result.evidencePath = requiredValue(argv[++index], '--evidence-path');
    else if (value === '--timeout-ms') result.timeoutMs = Number(requiredValue(argv[++index], '--timeout-ms'));
    else throw new Error(`Unknown option: ${value}`);
  }
  return result;
}

function requiredCaseId(value) {
  const caseId = String(value || '');
  if (!Object.hasOwn(CASES, caseId)) throw new Error(`--case must be one of: ${Object.keys(CASES).join(', ')}`);
  return caseId;
}

function assertLiveOptIn(options) {
  if (options.runtime !== 'queue' || options.queueRequired !== true) {
    throw new Error('Live capture requires explicit --runtime queue --queue-required.');
  }
}

function requiredValue(value, flag) {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/run-fresh-process-multi-model-visual-live.mjs stage [--run-dir PATH]',
    '  node scripts/run-fresh-process-multi-model-visual-live.mjs capture --case architecture|product --runtime queue --queue-required',
    '  node scripts/run-fresh-process-multi-model-visual-live.mjs recapture --case architecture|product --runtime queue --queue-required',
    '  node scripts/run-fresh-process-multi-model-visual-live.mjs aggregate [--evidence-path PATH]'
  ].join('\n');
}

async function resolveRunDir(value, { create = false } = {}) {
  const result = path.resolve(value);
  if (!isInside(path.join(projectRoot, 'output'), result)) throw new Error('--run-dir must stay inside repository output.');
  if (create) await fs.mkdir(result, { recursive: true });
  return fs.realpath(result);
}

async function resolveEvidencePath(value) {
  const result = path.resolve(value);
  if (!isInside(path.join(projectRoot, 'docs', 'evidence'), result)) {
    throw new Error('--evidence-path must stay inside docs/evidence.');
  }
  await fs.mkdir(path.dirname(result), { recursive: true });
  return result;
}

async function resolveSourceModel(value) {
  const result = await fs.realpath(path.resolve(value));
  const stat = await fs.stat(result);
  if (!stat.isFile() || path.extname(result).toLowerCase() !== '.skp') throw new Error('Visual consistency source must be an existing .skp file.');
  return result;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
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

async function writePrivateJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(filePath, value, 0o600);
}

async function writeJsonAtomic(filePath, value, mode = 0o644) {
  return writeFileAtomic(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`), mode);
}

async function writeFileAtomic(filePath, bytes, mode = 0o644) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { mode, flag: 'wx' });
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, mode);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function sha256FileTagged(filePath) {
  return `sha256:${await sha256File(filePath)}`;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function untag(value) {
  return String(value).replace(/^sha256:/, '');
}

function repoRelative(filePath) {
  const relative = path.relative(projectRoot, path.resolve(filePath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path is outside the repository.');
  return relative.split(path.sep).join('/');
}

function safeMessage(error) {
  return String(error?.stack || error?.message || error || 'Unknown error')
    .replaceAll(/hmac_sha256:[A-Za-z0-9_-]+/g, 'hmac_sha256:[redacted]')
    .replaceAll(/(token|secret)=\S+/gi, '$1=[redacted]');
}
