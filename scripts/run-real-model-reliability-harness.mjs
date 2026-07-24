#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';
import { cleanupQueueArtifactsForPid } from '../src/queue-runtime.mjs';
import { MAX_HANDSHAKE_TTL_MS } from '../src/session-contract.mjs';
import { compareSnapshots } from '../src/snapshot-diff.mjs';
import { waitForDisposableModelActivation } from '../src/real-model-candidate-intake.mjs';

export const REAL_MODEL_RELIABILITY_REPORT_VERSION = 'real-model-reliability-report.v1';
export const DEFAULT_RELIABILITY_MANIFEST = 'test/reliability-corpus/manifest.json';
export const RELIABILITY_HANDSHAKE_TTL_MS = MAX_HANDSHAKE_TTL_MS;
export const RELIABILITY_ACTIVATION_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_RELIABILITY_ACTIVATION_SETTLE_MS = 60 * 1000;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function freshReliabilitySessionOptions(bridge, { runtime = 'mock', timeoutMs } = {}) {
  return freshSessionOptions(bridge, {
    runtime,
    timeoutMs,
    expiresInMs: RELIABILITY_HANDSHAKE_TTL_MS
  });
}

export async function withFreshReliabilityQueueMutation(
  bridge,
  { operation, timeoutMs } = {},
  callback
) {
  assert(
    typeof bridge?.withFreshQueueMutationAuthorization === 'function',
    'Bridge does not support atomic fresh queue authorization.'
  );
  return bridge.withFreshQueueMutationAuthorization({
    operation,
    timeoutMs,
    expiresInMs: RELIABILITY_HANDSHAKE_TTL_MS
  }, callback);
}

export async function runRealModelReliabilityHarness({
  runtime = 'mock',
  queueRequired = false,
  timeoutMs = runtime === 'queue' ? 240000 : 30000,
  outputDir = `output/real-model-reliability/${runtime}`,
  manifestPath = DEFAULT_RELIABILITY_MANIFEST,
  liveArtifactRoot = null,
  installSignalHandlers = runtime === 'queue',
  cleanupOptions = {},
  preflightHooks = {}
} = {}) {
  if (!['mock', 'queue'].includes(runtime)) throw new Error('runtime must be mock or queue');
  if (runtime === 'mock' && queueRequired === true) throw new Error('--queue-required is valid only with --runtime queue.');
  if (runtime === 'mock' && liveArtifactRoot) throw new Error('--live-artifact-root is valid only with --runtime queue.');
  if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) throw new Error('timeoutMs must be a positive number');
  timeoutMs = Number(timeoutMs);
  if (runtime === 'queue' && queueRequired !== true) {
    throw new Error('Live reliability validation requires explicit --runtime queue --queue-required.');
  }

  const absoluteManifestPath = resolveRepoPath(manifestPath);
  const manifest = await loadAndValidateJson(
    absoluteManifestPath,
    path.join(repoRoot, 'schema/real-model-reliability-corpus-v1.schema.json'),
    'reliability corpus manifest'
  );
  await validateManifestSemantics(manifest);
  const manifestSha256 = await fileSha256(absoluteManifestPath);
  const absoluteOutputDir = path.resolve(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  let livePreflight = null;
  if (runtime === 'queue') {
    livePreflight = await preflightLiveCorpus({
      manifest,
      liveArtifactRoot,
      outputDir: absoluteOutputDir,
      hooks: preflightHooks
    });
    process.stderr.write([
      '',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      '[DANGER] REAL-MODEL RELIABILITY LIVE GATE',
      'This run WILL open, modify, save, and reopen disposable copies in the',
      'currently running SketchUp session. The active model/document will change.',
      'Close valuable unsaved work and confirm the external corpus before continuing.',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      ''
    ].join('\n'));
  }

  const uninstallCleanup = runtime === 'queue' && installSignalHandlers
    ? installReliabilityInterruptCleanup({ cleanupOptions })
    : () => {};

  try {
    const execution = runtime === 'mock'
      ? await runMockCorpus({ manifest, outputDir: absoluteOutputDir })
      : await runQueueCorpus({ manifest, preflight: livePreflight, outputDir: absoluteOutputDir, timeoutMs });
    const results = execution.results;
    const taskResults = results.flatMap((result) => result.tasks);
    const recoveryAttempts = execution.counters.recovery_attempts;
    const report = {
      version: REAL_MODEL_RELIABILITY_REPORT_VERSION,
      kind: 'real_model_reliability_report',
      ok: results.length === manifest.cases.length && results.every((result) => result.ok),
      runtime,
      evidence_scope: runtime === 'mock' ? 'deterministic_mock_only' : 'user_coordinated_live_artifacts',
      live_sketchup_version_matrix: runtime === 'mock'
        ? 'not_run_requires_explicit_user_coordination'
        : { versions: [execution.sketchup_version], complete: false },
      live_queue_called: runtime === 'queue',
      manifest: {
        version: manifest.version,
        sha256: manifestSha256,
        path: repoRelativeOrLabel(absoluteManifestPath),
        repository_tracked_skp_count: manifest.repository_live_artifacts.tracked_skp_count,
        external_live_artifacts_required: manifest.cases.length,
        external_live_artifacts_verified: runtime === 'queue' ? livePreflight.length : 0
      },
      safety: {
        default_runtime: manifest.default_runtime,
        explicit_queue_opt_in: runtime === 'queue' ? queueRequired === true : false,
        fresh_handshake_per_guarded_operation: true,
        preflight_before_queue: true,
        interrupt_cleanup_enabled: runtime === 'queue' ? installSignalHandlers === true : false,
        active_model_mutation_warning_emitted: runtime === 'queue',
        disposable_copy_only: runtime === 'queue'
      },
      corpus_cases: results.length,
      passed_cases: results.filter((result) => result.ok).length,
      tasks: {
        total: taskResults.length,
        passed: taskResults.filter((task) => task.status === 'passed').length,
        failed: taskResults.filter((task) => task.status === 'failed').length
      },
      metrics: {
        task_success_rate: taskResults.length ? taskResults.filter((task) => task.status === 'passed').length / taskResults.length : 0,
        wrong_object_modification_count: execution.counters.wrong_object_modifications,
        silent_geometry_corruption_count: execution.counters.silent_geometry_corruption,
        recovery_attempts: recoveryAttempts,
        recoveries: execution.counters.recoveries,
        recovery_rate: recoveryAttempts ? execution.counters.recoveries / recoveryAttempts : 1
      },
      coverage: coverageSummary(manifest, taskResults),
      results
    };
    await validateReport(report);
    const reportPath = path.join(absoluteOutputDir, 'real-model-reliability-report.v1.json');
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return { report, report_path: reportPath };
  } finally {
    uninstallCleanup();
    if (runtime === 'queue') await cleanupReliabilityQueueArtifacts(process.pid, cleanupOptions);
  }
}

export function installReliabilityInterruptCleanup({
  pid = process.pid,
  cleanupOptions = {},
  exit = (code) => process.exit(code)
} = {}) {
  let stopping = false;
  const handlers = new Map();
  for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => {
      if (stopping) return;
      stopping = true;
      void cleanupReliabilityQueueArtifacts(pid, cleanupOptions)
        .catch((error) => process.stderr.write(`[reliability-cleanup] ${String(error?.message || error)}\n`))
        .finally(() => exit(exitCode));
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  };
}

export function cleanupReliabilityQueueArtifacts(pid = process.pid, options = {}) {
  return cleanupQueueArtifactsForPid(pid, {
    ...options,
    removeReadOnlyProcessing: options.removeReadOnlyProcessing ?? true
  });
}

async function runMockCorpus({ manifest, outputDir }) {
  const counters = emptyCounters();
  const results = [];
  for (const [index, corpusCase] of manifest.cases.entries()) {
    const bridge = new SketchUpBridge({
      mock: { sessionPath: path.join(outputDir, `.mock-${index}-${corpusCase.id}.session.json`) }
    });
    const started = Date.now();
    try {
      const execution = await runMockCase(bridge, corpusCase, { outputDir, counters });
      results.push({
        id: corpusCase.id,
        domain: corpusCase.domain,
        evidence_class: corpusCase.mock.evidence_class,
        source_kind: corpusCase.mock.source_kind,
        live_requirement: corpusCase.live.status,
        ok: true,
        duration_ms: Date.now() - started,
        tasks: materializeTasks(corpusCase, execution.task_evidence),
        details: execution.details
      });
    } catch (error) {
      results.push(reliabilityFailedCaseResult(corpusCase, Date.now() - started, error, 'mock'));
    }
  }
  return { counters, results, sketchup_version: null };
}

async function runMockCase(bridge, corpusCase, context) {
  switch (corpusCase.mock.runner) {
    case 'repository_document': return runMockRepositoryDocument(bridge, corpusCase, context);
    case 'deep_shared_generated': return runMockDeepShared(bridge, corpusCase, context);
    case 'dirty_import_generated': return runMockDirtyImport(bridge, corpusCase, context);
    case 'transform_locked_generated': return runMockTransformLocked(bridge, corpusCase, context);
    default: throw new Error(`Unsupported reliability mock runner: ${corpusCase.mock.runner}`);
  }
}

async function runMockRepositoryDocument(bridge, corpusCase, { outputDir, counters }) {
  const document = await fs.readFile(resolveRepoPath(corpusCase.mock.source), 'utf8');
  let built = await bridge.build_model({ runtime: 'mock', code: document });
  if (corpusCase.id === 'appearance-scenes-hidden') {
    built = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
      version: 1,
      units: 'mm',
      operations: [{ op: 'set_visibility', target_id: 'appearance-reference-id', visible: false }]
    }) });
  }
  const before = await adopt(bridge, 'mock', 30000);
  const beforeSnapshot = built.snapshot;
  const materialBefore = materialSignature(beforeSnapshot);
  const uvBefore = uvSignature(beforeSnapshot);
  const presentationBefore = presentationSignature(beforeSnapshot);

  if (corpusCase.tasks.includes('boolean_manifold')) {
    assert(beforeSnapshot.manifold_checks.length >= 2, 'product fixture must record manifold check and repair evidence');
    assert(beforeSnapshot.manifold_checks.every((check) => check.ok), 'product boolean/manifold fixture must finish manifold');
    assert(beforeSnapshot.groups.some((group) => group.id === 'body-intersection' && group.material === 'Boolean_Test_Body'), 'boolean result must preserve the body material');
  }
  if (corpusCase.tasks.includes('uv_material_preservation')) {
    assert(uvBefore.length > 0, 'appearance fixture must contain structured UV/texture transforms');
    assert(presentationBefore.hidden_entities > 0, 'appearance fixture must contain a hidden object');
  }
  if (corpusCase.tasks.includes('scene_visibility_preservation')) {
    assert(beforeSnapshot.scenes.length > 0, `${corpusCase.id} must contain at least one Scene`);
  }

  const reopened = await mockSaveReopenProof(bridge, corpusCase.id, beforeSnapshot, before, { outputDir, counters });
  const taskEvidence = {};
  if (corpusCase.tasks.includes('boolean_manifold')) {
    taskEvidence.boolean_manifold = {
      manifold_checks: beforeSnapshot.manifold_checks.length,
      all_manifold: true,
      result_material: 'Boolean_Test_Body'
    };
  }
  if (corpusCase.tasks.includes('material_preservation')) {
    assert(materialBefore === materialSignature(reopened.snapshot), 'material signature changed after save/reopen');
    taskEvidence.material_preservation = { signature: materialBefore, materials: reopened.snapshot.material_names.length };
  }
  if (corpusCase.tasks.includes('uv_material_preservation')) {
    assert(uvBefore === uvSignature(reopened.snapshot), 'UV/texture signature changed after save/reopen');
    assert(materialBefore === materialSignature(reopened.snapshot), 'material signature changed after UV save/reopen');
    taskEvidence.uv_material_preservation = { uv_signature: uvBefore, material_signature: materialBefore };
  }
  if (corpusCase.tasks.includes('scene_visibility_preservation')) {
    assert(presentationBefore.hash === presentationSignature(reopened.snapshot).hash, 'Scene/visibility signature changed after save/reopen');
    taskEvidence.scene_visibility_preservation = presentationBefore;
  }
  if (corpusCase.tasks.includes('save_reopen_identity')) taskEvidence.save_reopen_identity = reopened.identity_evidence;
  return {
    details: {
      groups: reopened.snapshot.groups.length,
      instances: reopened.snapshot.instances.length,
      scenes: reopened.snapshot.scenes.length,
      hidden_entities: presentationBefore.hidden_entities,
      save_reopen_error_diffs: reopened.diff.summary.by_severity.error
    },
    task_evidence: taskEvidence
  };
}

async function runMockDeepShared(bridge, corpusCase, { outputDir, counters }) {
  const instances = Array.from({ length: 80 }, (_, index) => ({
    op: 'component_instance', id: `shared-parent-${index}`, name: `Shared_Parent_${index}`,
    definition: 'Shared_Parent_Definition', origin: [index * 120, 0, 0]
  }));
  const built = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'reset' },
    { op: 'component_definition', name: 'Shared_Leaf_Definition', operations: [
      { op: 'box', id: 'shared-leaf', name: 'Shared_Leaf', origin: [0, 0, 0], size: [100, 60, 30] }
    ] },
    { op: 'component_definition', name: 'Shared_Parent_Definition', operations: [
      { op: 'component_instance', id: 'shared-leaf-instance', name: 'Shared_Leaf_Instance', definition: 'Shared_Leaf_Definition', origin: [0, 0, 0] }
    ] },
    ...instances
  ] }) });
  const before = await adopt(bridge, 'mock', 30000);
  const leaves = before.recursive_index.filter((entry) => entry.name === 'Shared_Leaf');
  assert(before.recursive_truncated === false, 'large recursive index must not truncate');
  assert(before.recursive_index.length >= 1600, 'large recursive index must retain the adversarial depth/width fixture');
  assert(leaves.length === 80, 'shared leaf must have 80 occurrences');
  assert(before.recursive_index.some((entry) => entry.affected_instance_count === 80), 'shared definition impact count must be explicit');
  const reopened = await mockSaveReopenProof(bridge, corpusCase.id, built.snapshot, before, { outputDir, counters });
  return {
    details: {
      recursive_entities: before.recursive_index.length,
      shared_leaf_occurrences: leaves.length,
      save_reopen_identity_stable: reopened.identity_evidence.exact_match
    },
    task_evidence: {
      large_recursive_index: { entries: before.recursive_index.length, truncated: false },
      shared_definition_identity: { occurrences: leaves.length, affected_instance_count: 80 },
      save_reopen_identity: reopened.identity_evidence
    }
  };
}

async function runMockDirtyImport(bridge, corpusCase, { outputDir, counters }) {
  const dirtyPath = path.join(outputDir, `${corpusCase.id}.import.json`);
  await fs.writeFile(dirtyPath, `${JSON.stringify({ model: {
    version: 1,
    units: 'mm',
    groups: [{
      id: 'dirty-cad-shell', name: 'Imported_Dirty_CAD_Shell', kind: 'mesh', faces: 1, edges: 3,
      vertices: [[0, 0, 0], [100, 0, 0], [0, 100, 0]], mesh_faces: [[0, 1, 2]],
      bounding_box: { min: [0, 0, 0], max: [100, 100, 20], w: 100, d: 100, h: 20 }
    }]
  } }, null, 2)}\n`, 'utf8');
  await bridge.import_model({ runtime: 'mock', path: dirtyPath, mode: 'replace' });
  let checked = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'manifold_check', target_id: 'dirty-cad-shell', check_id: 'dirty-before', fail_on_non_manifold: false }
  ] }) });
  assert(checked.snapshot.manifold_checks.at(-1).ok === false, 'dirty topology must be detected before repair');
  counters.recovery_attempts += 1;
  checked = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'manifold_repair', target_id: 'dirty-cad-shell', repair_id: 'dirty-repair', strategy: 'seal_bbox', fail_on_non_manifold: true },
    { op: 'manifold_check', target_id: 'dirty-cad-shell', check_id: 'dirty-after', fail_on_non_manifold: true }
  ] }) });
  assert(checked.snapshot.manifold_checks.at(-1).ok === true, 'dirty topology repair must finish manifold');
  counters.recoveries += 1;
  return {
    details: { imported: true, dirty_topology_detected: true, repair_recovered: true },
    task_evidence: {
      abnormal_topology_detection: { detected: true, initial_manifold: false },
      manifold_repair: { repaired: true, final_manifold: true },
      recovery: { attempts: 1, recoveries: 1 }
    }
  };
}

async function runMockTransformLocked(bridge, corpusCase, { outputDir, counters }) {
  const rawPath = path.join(outputDir, `${corpusCase.id}.source.json`);
  await fs.writeFile(rawPath, `${JSON.stringify({ model: {
    groups: [
      boxModel('locked-object', 'Locked_Object', [0, 0, 0], [100, 60, 20], true),
      boxModel('guard-object', 'Guard_Object', [200, 0, 0], [40, 40, 40], false),
      boxModel('transform-object', 'Transform_Object', [300, 0, 0], [50, 30, 20], false)
    ]
  } }, null, 2)}\n`, 'utf8');
  await bridge.open_model({ runtime: 'mock', path: rawPath });
  const before = await adopt(bridge, 'mock', 30000);
  const beforeRevision = modelRevisionForAdoption(before);
  const guardBefore = stableEntityFingerprint(before.entities.find((entity) => entity.id === 'guard-object'));
  counters.recovery_attempts += 1;
  await assertRejects(
    bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'attribute', target_id: 'guard-object', dictionary: 'Reliability', key: 'must_rollback', value: true },
      { op: 'transform_object', target_id: 'locked-object', translate: [10, 0, 0] }
    ] }) }),
    /target is locked/
  );
  const afterFailure = await adopt(bridge, 'mock', 30000);
  assert(modelRevisionForAdoption(afterFailure) === beforeRevision, 'failed locked batch must preserve model revision');
  assert(stableEntityFingerprint(afterFailure.entities.find((entity) => entity.id === 'guard-object')) === guardBefore, 'failed batch must roll back the guard write');
  counters.recoveries += 1;
  const transformed = await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'transform_object', target_id: 'transform-object', scale: [1.5, 0.75, 2], mirror: 'x', pivot: 'center' }
  ] }) });
  const object = transformed.snapshot.groups.find((group) => group.id === 'transform-object');
  assert(object.transform.object_transform.mirror.includes('x'), 'transform fixture must be mirrored');
  const afterTransform = await adopt(bridge, 'mock', 30000);
  const wrongObject = stableEntityFingerprint(afterTransform.entities.find((entity) => entity.id === 'guard-object')) !== guardBefore;
  if (wrongObject) counters.wrong_object_modifications += 1;
  assert(!wrongObject, 'unrelated guard object changed during transform');
  const reopened = await mockSaveReopenProof(bridge, corpusCase.id, transformed.snapshot, afterTransform, { outputDir, counters });
  return {
    details: {
      locked_mutation_rejected: true,
      rollback_verified: true,
      mirrored: true,
      nonuniform_scale: true,
      save_reopen_identity_stable: reopened.identity_evidence.exact_match
    },
    task_evidence: {
      locked_fail_closed: { rejected: true },
      rollback: { revision_preserved: true, guard_write_absent: true },
      nonuniform_mirror: { mirrored_axes: ['x'], scale: [1.5, 0.75, 2] },
      wrong_object_isolation: { guard_unchanged: true },
      save_reopen_identity: reopened.identity_evidence
    }
  };
}

async function mockSaveReopenProof(bridge, caseId, beforeSnapshot, beforeAdoption, { outputDir, counters }) {
  const savePath = path.join(outputDir, `${caseId}.saved.json`);
  await bridge.save_model({ runtime: 'mock', path: savePath, keep_session: true });
  const reopened = await bridge.open_model({ runtime: 'mock', path: savePath });
  const afterAdoption = await adopt(bridge, 'mock', 30000);
  const diff = compareSnapshots(beforeSnapshot, reopened.snapshot, { toleranceMm: 0 });
  if (diff.summary.by_severity.error > 0) counters.silent_geometry_corruption += 1;
  assert(diff.summary.by_severity.error === 0, `save/reopen geometry errors: ${JSON.stringify(diff.top_issues)}`);
  const beforeIdentity = identitySignature(beforeAdoption);
  const afterIdentity = identitySignature(afterAdoption);
  assert(sha256Canonical(beforeIdentity) === sha256Canonical(afterIdentity), 'persistent occurrence identity changed after save/reopen');
  return {
    snapshot: reopened.snapshot,
    diff,
    identity_evidence: {
      exact_match: true,
      entries_before: beforeIdentity.length,
      entries_after: afterIdentity.length,
      signature: sha256Canonical(beforeIdentity),
      snapshot_error_diffs: diff.summary.by_severity.error
    }
  };
}

export async function preflightLiveCorpus({ manifest, liveArtifactRoot, outputDir, hooks = {} }) {
  if (!liveArtifactRoot) {
    throw new Error('Live reliability validation requires --live-artifact-root containing all external .skp artifacts and hash-bound sidecars.');
  }
  const root = path.resolve(liveArtifactRoot);
  const rootStats = await fs.stat(root).catch(() => null);
  assert(rootStats?.isDirectory(), 'Live reliability artifact root is missing or is not a directory.');
  const rootRealPath = await fs.realpath(root);
  const schemaPath = path.join(repoRoot, 'schema/real-model-reliability-live-case-v1.schema.json');
  const workingParent = path.join(path.resolve(outputDir), 'live-work');
  await fs.mkdir(workingParent, { recursive: true, mode: 0o700 });
  const workingRoot = path.join(workingParent, `preflight-${crypto.randomUUID()}`);
  await fs.mkdir(workingRoot, { mode: 0o700 });
  const results = [];
  try {
    for (const [index, corpusCase] of manifest.cases.entries()) {
      const contractText = await readStableExternalFile({
        root,
        rootRealPath,
        relativePath: corpusCase.live.contract,
        label: `Live contract ${corpusCase.id}`,
        afterOpen: hooks.afterOpen
      }).catch((error) => {
        throw externalPreflightError(new Error(`Live contract ${corpusCase.id} is invalid or missing: ${String(error?.message || error)}`), root);
      });
      let contract;
      try {
        contract = JSON.parse(contractText);
      } catch (error) {
        throw externalPreflightError(new Error(`Live contract ${corpusCase.id} is invalid or missing: ${String(error?.message || error)}`), root);
      }
      await validateJsonValue(contract, schemaPath, `live contract ${corpusCase.id}`).catch((error) => {
        throw externalPreflightError(new Error(`Live contract ${corpusCase.id} is invalid or missing: ${String(error?.message || error)}`), root);
      });
      assert(contract.case_id === corpusCase.id, `Live contract case_id mismatch for ${corpusCase.id}`);
      assert(contract.artifact_file === corpusCase.live.artifact, `Live contract artifact_file mismatch for ${corpusCase.id}`);

      const caseDir = path.join(workingRoot, `${String(index + 1).padStart(2, '0')}-${corpusCase.id}`);
      await fs.mkdir(caseDir, { mode: 0o700 });
      const artifactExtension = path.extname(corpusCase.live.artifact) || '.skp';
      const workingPath = path.join(caseDir, `${corpusCase.id}.live-working${artifactExtension}`);
      const actualSha256 = await copyStableExternalFile({
        root,
        rootRealPath,
        relativePath: corpusCase.live.artifact,
        destinationPath: workingPath,
        label: `External live artifact ${corpusCase.id}`,
        afterOpen: hooks.afterOpen
      });
      assert(actualSha256 === contract.artifact_sha256, `Live artifact sha256 mismatch for ${corpusCase.id}`);
      assertRequiredLiveRoles(corpusCase, contract);
      results.push({
        corpus_case: corpusCase,
        artifact_path: safeChildPath(root, corpusCase.live.artifact),
        contract_path: safeChildPath(root, corpusCase.live.contract),
        working_path: workingPath,
        case_dir: caseDir,
        contract,
        sha256: actualSha256
      });
    }
    return results;
  } catch (error) {
    await fs.rm(workingRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function runQueueCorpus({
  manifest,
  preflight,
  outputDir,
  timeoutMs,
  activationSettleMs = 0,
  activePreparedModel = false
}) {
  activationSettleMs = reliabilityActivationSettleMs(activationSettleMs);
  assert(typeof activePreparedModel === 'boolean', 'activePreparedModel must be boolean');
  assert(!activePreparedModel || preflight.length === 1, 'activePreparedModel is limited to one hash-bound live case');
  const counters = emptyCounters();
  const results = [];
  const bridge = new SketchUpBridge({});
  assert(
    bridge.executionPolicy.allowed_runtimes.includes('queue')
      && bridge.executionPolicy.allow_queue_mutation === true
      && bridge.executionPolicy.allow_direct_expert_queue_mutation === true,
    'Live reliability validation is denied by execution policy. The user-run host must explicitly allow queue and direct expert mutation.'
  );
  // Capabilities and active-document identity are revision-free reads. Every
  // mutating/document-switch action still obtains its own one-shot contract.
  const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
  const sketchupVersion = String(capabilities?.runtime?.plugin?.sketchup_version || capabilities?.plugin?.sketchup_version || 'unknown');
  assert(sketchupVersion !== 'unknown', 'Live reliability validation requires a reported SketchUp version.');
  let stopAfterFailure = false;
  for (const [index, prepared] of preflight.entries()) {
    const corpusCase = prepared.corpus_case;
    const started = Date.now();
    if (stopAfterFailure) {
      results.push(reliabilityFailedCaseResult(corpusCase, 0, new Error('not_run_after_previous_live_failure'), 'queue'));
      continue;
    }
    try {
      const caseDir = prepared.case_dir;
      const workingPath = prepared.working_path;
      if (!activePreparedModel) {
        await withFreshReliabilityQueueMutation(
          bridge,
          { operation: 'open_model', timeoutMs },
          (lockedBridge) => lockedBridge.open_model({
            runtime: 'queue', timeoutMs, path: workingPath
          })
        );
      }
      await waitForReliabilityModelActivation({ bridge, workingPath, timeoutMs });
      if (activationSettleMs > 0) {
        process.stderr.write(
          `[OPERATOR SETTLE] ${corpusCase.id}: queue is idle for ${activationSettleMs}ms after model activation; close unrelated blank/test windows now.\n`
        );
        await new Promise((resolve) => setTimeout(resolve, activationSettleMs));
      }
      const before = await adopt(bridge, 'queue', timeoutMs, liveIdentityExpectation(prepared.contract.expectations));
      const targets = resolveLiveTargets(before, prepared.contract.targets);
      validateLiveBaseline(corpusCase, before, targets, prepared.contract.expectations);
      const execution = await runLiveCaseActions(bridge, corpusCase, prepared.contract, targets, before, {
        caseDir,
        counters,
        timeoutMs,
        runtimeCapabilities: capabilities.runtime
      });
      results.push({
        id: corpusCase.id,
        domain: corpusCase.domain,
        evidence_class: 'external_live_artifact',
        source_kind: 'external_skp',
        live_requirement: 'satisfied_by_hash_bound_external_artifact',
        ok: true,
        duration_ms: Date.now() - started,
        tasks: materializeTasks(corpusCase, execution.task_evidence),
        details: {
          ...execution.details,
          artifact_sha256: prepared.sha256,
          document_open_mode: activePreparedModel ? 'preopened_single_window' : 'queue_open_model'
        }
      });
    } catch (error) {
      stopAfterFailure = true;
      results.push(reliabilityFailedCaseResult(corpusCase, Date.now() - started, error, 'queue'));
    }
  }
  return {
    counters,
    results,
    sketchup_version: sketchupVersion,
    runtime: {
      name: capabilities.runtime.name,
      server_version: capabilities.runtime.version,
      plugin_version: capabilities.runtime.plugin?.version || null,
      sketchup_version: capabilities.runtime.plugin?.sketchup_version || null,
      ruby_version: capabilities.runtime.plugin?.ruby_version || null,
      capability_version: capabilities.runtime.capability_version,
      manifest_version: capabilities.runtime.manifest_version,
      dsl_version: capabilities.runtime.dsl_version,
      occurrence_contract: capabilities.runtime.occurrence_contract,
      revision_strategy: capabilities.runtime.model_revision?.strategy || null,
      revision_source_sha256: capabilities.runtime.model_revision_source_sha256 || null,
      compatibility_ok: capabilities.runtime.compatibility?.ok === true
    }
  };
}

async function runLiveCaseActions(bridge, corpusCase, contract, targets, before, { caseDir, counters, timeoutMs, runtimeCapabilities }) {
  const taskEvidence = baselineLiveTaskEvidence(corpusCase, before, targets, contract.expectations);
  const identityExpectation = liveIdentityExpectation(contract.expectations);
  let current = before;
  if (corpusCase.tasks.includes('boolean_manifold')) {
    const operation = contract.expectations.boolean_operation;
    const resultId = `reliability-${corpusCase.id}-result`;
    const targetMaterial = targets.boolean_target.material || null;
    const targetPersistentId = String(targets.boolean_target.persistent_id || '');
    const toolPersistentId = String(targets.boolean_tool.persistent_id || '');
    assert(targetPersistentId && toolPersistentId && targetPersistentId !== toolPersistentId,
      'live boolean inputs require two distinct persistent ids');
    const targetFingerprintBefore = stableEntityFingerprint(targets.boolean_target);
    const toolFingerprintBefore = stableEntityFingerprint(targets.boolean_tool);
    const nonInputFingerprintsBefore = topLevelFingerprintsExcluding(
      before.entities,
      [targetPersistentId, toolPersistentId]
    );
    if (corpusCase.tasks.includes('material_preservation')) {
      assert(targetMaterial, 'live boolean material-preservation target must have a material');
    }
    const built = await withFreshReliabilityQueueMutation(
      bridge,
      { operation: 'build_model', timeoutMs },
      (lockedBridge) => lockedBridge.build_model({
        runtime: 'queue', timeoutMs,
        code: JSON.stringify({ version: 1, units: 'mm', operations: [
          { op: operation, target_id: targetId(targets.boolean_target), tool_ids: [targetId(targets.boolean_tool)], result_id: resultId, result_name: 'Reliability_Boolean_Result', keep_tools: true },
          { op: 'manifold_check', target_id: resultId, check_id: 'reliability-live-boolean', fail_on_non_manifold: true }
        ] })
      })
    );
    assert(built.snapshot.manifold_checks.at(-1)?.ok === true, 'live boolean result must be manifold');
    const booleanResult = built.snapshot.groups.find((group) => group.id === resultId || group.name === 'Reliability_Boolean_Result');
    if (targetMaterial) assert(booleanResult?.material === targetMaterial, 'live boolean result did not preserve target material');
    current = await adopt(bridge, 'queue', timeoutMs, identityExpectation);
    const isolation = inspectBooleanIsolationEvidence({
      beforeEntities: before.entities,
      afterEntities: current.entities,
      targetBefore: targets.boolean_target,
      toolBefore: targets.boolean_tool,
      resultId,
      resultName: 'Reliability_Boolean_Result',
      targetFingerprintBefore,
      toolFingerprintBefore,
      nonInputFingerprintsBefore
    });
    if (!isolation.tool_preserved_unchanged || !isolation.non_input_top_level_entities_unchanged) {
      counters.wrong_object_modifications += 1;
    }
    assert(isolation.top_level_entity_count_preserved, 'live boolean changed the top-level entity count');
    assert(isolation.exact_target_replaced, 'live boolean did not replace the exact target with a changed result');
    assert(isolation.tool_preserved_unchanged, 'live boolean changed the preserved tool');
    assert(isolation.non_input_top_level_entities_unchanged, 'live boolean changed a non-input top-level entity');
    const adoptedResult = isolation.result;
    if (targetMaterial) assert(adoptedResult.material === targetMaterial,
      'adopted live boolean result did not preserve target material');
    taskEvidence.boolean_manifold = {
      operation,
      result_id: resultId,
      result_persistent_id: isolation.result_persistent_id,
      manifold: true,
      material_preserved: targetMaterial ? true : null,
      exact_target_replaced: isolation.exact_target_replaced,
      tool_preserved_unchanged: isolation.tool_preserved_unchanged,
      non_input_top_level_entities_unchanged: isolation.non_input_top_level_entities_unchanged
    };
  }
  if (corpusCase.tasks.includes('abnormal_topology_detection')) {
    const target = targetId(targets.repair_target);
    const targetPersistentId = String(targets.repair_target.persistent_id || '');
    const targetFingerprintBefore = stableEntityFingerprint(targets.repair_target);
    const nonTargetFingerprintsBefore = topLevelFingerprintsExcluding(before.entities, targetPersistentId);
    counters.recovery_attempts += 1;
    let repaired;
    try {
      repaired = await withFreshReliabilityQueueMutation(
        bridge,
        { operation: 'build_model', timeoutMs },
        (lockedBridge) => lockedBridge.build_model({
          runtime: 'queue', timeoutMs,
          code: JSON.stringify({ version: 1, units: 'mm', operations: [
            { op: 'manifold_repair', target_id: target, repair_id: 'reliability-live-repair', strategy: 'cleanup', fail_on_non_manifold: true },
            { op: 'manifold_check', target_id: target, check_id: 'reliability-live-dirty-after', fail_on_non_manifold: true }
          ] })
        })
      );
    } catch (error) {
      throw annotateReliabilityFailure(error, {
        failedTaskId: 'manifold_repair',
        taskEvidence
      });
    }
    const repairCheck = [...repaired.snapshot.manifold_checks].reverse().find((entry) => entry?.op === 'manifold_repair');
    assert(repairCheck?.ok === true, 'live manifold repair did not report success');
    assert(repairCheck.before?.is_manifold === false, 'live manifold repair did not bind a non-manifold before state');
    assert(repairCheck.after?.is_manifold === true, 'live manifold repair did not bind a manifold after state');
    const initialReport = repairCheck.before;
    const expectedIssueCodes = contract.expectations.expected_topology_issue_codes || [];
    for (const issueCode of expectedIssueCodes) {
      assert(initialReport.issues.includes(issueCode), `live dirty topology target is missing expected issue ${issueCode}`);
    }
    taskEvidence.abnormal_topology_detection = {
      detected: true,
      initial_manifold: false,
      report: publicManifoldReport(initialReport),
      expected_issue_codes: [...expectedIssueCodes]
    };
    const finalCheck = repaired.snapshot.manifold_checks.at(-1);
    assert(finalCheck?.ok === true, 'live manifold repair did not recover');
    const finalReport = singleManifoldTargetReport(finalCheck, 'final dirty-topology check');
    assert(finalReport.is_manifold === true, 'live repaired target is not manifold');
    assert(
      Array.isArray(finalReport.issues) && finalReport.issues.length === 0,
      'live repaired target retained topology issue codes'
    );
    counters.recoveries += 1;
    current = await adopt(bridge, 'queue', timeoutMs, identityExpectation);
    const refreshedTargets = resolveLiveTargets(current, contract.targets);
    const targetFingerprintAfter = stableEntityFingerprint(refreshedTargets.repair_target);
    const nonTargetFingerprintsAfter = topLevelFingerprintsExcluding(current.entities, targetPersistentId);
    const nonTargetsUnchanged = canonicalFingerprintsEqual(nonTargetFingerprintsBefore, nonTargetFingerprintsAfter);
    if (!nonTargetsUnchanged) counters.wrong_object_modifications += 1;
    assert(current.entities.length === before.entities.length, 'live dirty-topology repair changed top-level entity count');
    assert(targetFingerprintAfter !== targetFingerprintBefore, 'live dirty-topology repair did not change the exact repair target');
    assert(nonTargetsUnchanged, 'live dirty-topology repair changed a non-target top-level entity');
    taskEvidence.manifold_repair = {
      repaired: true,
      strategy: 'cleanup',
      before: publicManifoldReport(repairCheck.before),
      after: publicManifoldReport(repairCheck.after),
      final_manifold: true
    };
    taskEvidence.recovery = {
      attempts: 1,
      recoveries: 1,
      exact_target_changed: true,
      non_target_top_level_entities_unchanged: true
    };
  }
  if (corpusCase.tasks.includes('locked_fail_closed')) {
    const revision = modelRevisionForAdoption(current);
    const guardBefore = stableEntityFingerprint(targets.guard_target);
    const lockedBefore = stableEntityFingerprint(targets.locked_target);
    const transformBefore = stableEntityFingerprint(targets.transform_target);
    counters.recovery_attempts += 1;
    await assertRejects(withFreshReliabilityQueueMutation(
      bridge,
      { operation: 'build_model', timeoutMs },
      (lockedBridge) => lockedBridge.build_model({
        runtime: 'queue', timeoutMs,
        code: JSON.stringify({ version: 1, units: 'mm', operations: [
          { op: 'attribute', target_id: targetId(targets.guard_target), dictionary: 'Reliability', key: 'must_rollback', value: true },
          { op: 'transform_object', target_id: targetId(targets.locked_target), translate: [10, 0, 0] }
        ] })
      })
    ), /locked|MUTATION_EXECUTION_FAILED/i);
    const afterFailure = await adopt(bridge, 'queue', timeoutMs, identityExpectation);
    const refreshedTargets = resolveLiveTargets(afterFailure, contract.targets);
    assert(modelRevisionForAdoption(afterFailure) === revision, 'live locked failure changed model revision');
    assert(stableEntityFingerprint(refreshedTargets.guard_target) === guardBefore, 'live locked failure did not roll back guard mutation');
    assert(stableEntityFingerprint(refreshedTargets.locked_target) === lockedBefore, 'live locked failure changed the locked target');
    counters.recoveries += 1;
    taskEvidence.locked_fail_closed = { rejected: true };
    taskEvidence.rollback = { revision_preserved: true, guard_unchanged: true, locked_target_unchanged: true };
    const transformed = await withFreshReliabilityQueueMutation(
      bridge,
      { operation: 'build_model', timeoutMs },
      (lockedBridge) => lockedBridge.build_model({
        runtime: 'queue', timeoutMs,
        code: JSON.stringify({ version: 1, units: 'mm', operations: [
          { op: 'transform_object', target_id: targetId(refreshedTargets.transform_target), scale: [1.5, 0.75, 2], mirror: 'x', pivot: 'center' }
        ] })
      })
    );
    current = await adopt(bridge, 'queue', timeoutMs, identityExpectation);
    const finalTargets = resolveLiveTargets(current, contract.targets);
    const verification = verifyLockedTransformEvidence({
      transformedSnapshot: transformed.snapshot,
      beforeFingerprints: { guard: guardBefore, locked: lockedBefore, transform: transformBefore },
      beforeTransformTarget: refreshedTargets.transform_target,
      afterTargets: finalTargets
    });
    if (!verification.guard_unchanged || !verification.locked_target_unchanged) counters.wrong_object_modifications += 1;
    taskEvidence.nonuniform_mirror = {
      mirror: 'x',
      scale: [1.5, 0.75, 2],
      exact_target_changed: verification.exact_target_changed
    };
    taskEvidence.wrong_object_isolation = {
      guard_unchanged: verification.guard_unchanged,
      locked_target_unchanged: verification.locked_target_unchanged
    };
  }

  if (corpusCase.tasks.includes('save_reopen_identity')) {
    const proof = await liveSaveReopenProof(bridge, corpusCase.id, current, {
      caseDir,
      counters,
      timeoutMs,
      runtimeCapabilities,
      identityExpectation
    });
    taskEvidence.save_reopen_identity = proof.identity_evidence;
    applyPostReopenPreservationEvidence(corpusCase, taskEvidence, current.snapshot, proof.after.snapshot);
    current = proof.after;
  }
  let implicitSaveReopenIdentity = null;
  if (caseRequiresImplicitSaveReopen(corpusCase)) {
    const proof = await liveSaveReopenProof(bridge, corpusCase.id, current, {
      caseDir,
      counters,
      timeoutMs,
      runtimeCapabilities,
      identityExpectation
    });
    implicitSaveReopenIdentity = proof.identity_evidence;
    current = proof.after;
  }
  ensureAllTaskEvidence(corpusCase, taskEvidence);
  return {
    task_evidence: taskEvidence,
    details: {
      entities: current.entities.length,
      recursive_entities: current.recursive_index.length,
      model_revision: current.model_revision,
      source_kind: 'external_skp_hash_bound_sidecar',
      ...(implicitSaveReopenIdentity
        ? { case_save_reopen_identity: implicitSaveReopenIdentity }
        : {})
    }
  };
}

export function caseRequiresImplicitSaveReopen(corpusCase) {
  const tasks = Array.isArray(corpusCase?.tasks) ? corpusCase.tasks : [];
  return !tasks.includes('save_reopen_identity');
}

export function verifyLockedTransformEvidence({
  transformedSnapshot,
  beforeFingerprints,
  beforeTransformTarget,
  afterTargets
}) {
  const matches = (transformedSnapshot?.groups || []).filter((group) =>
    String(group.persistent_id || '') === String(beforeTransformTarget?.persistent_id || '')
    || (beforeTransformTarget?.id && group.id === beforeTransformTarget.id)
    || (beforeTransformTarget?.name && group.name === beforeTransformTarget.name));
  assert(matches.length === 1, `live transform result must contain exactly one contract-bound transform target; got ${matches.length}`);
  const snapshotTransform = matches[0].transform?.object_transform;
  assert(numberArrayEquals(snapshotTransform?.scale, [1.5, 0.75, 2]), 'live transform target did not retain the requested nonuniform scale metadata');
  assert(stringArrayEquals(snapshotTransform?.mirror, ['x']), 'live transform target did not retain mirror-x metadata');

  const guardUnchanged = stableEntityFingerprint(afterTargets?.guard_target) === beforeFingerprints?.guard;
  const lockedUnchanged = stableEntityFingerprint(afterTargets?.locked_target) === beforeFingerprints?.locked;
  const transformChanged = stableEntityFingerprint(afterTargets?.transform_target) !== beforeFingerprints?.transform;
  const adoptedTransform = afterTargets?.transform_target?.transform?.object_transform;
  assert(numberArrayEquals(adoptedTransform?.scale, [1.5, 0.75, 2]), 'adopted transform target lost nonuniform scale metadata');
  assert(stringArrayEquals(adoptedTransform?.mirror, ['x']), 'adopted transform target lost mirror-x metadata');
  assert(transformChanged, 'live transform did not change the contract-bound transform target');
  assert(guardUnchanged && lockedUnchanged, 'live transform changed a non-target fixture object');
  return {
    exact_target_changed: transformChanged,
    guard_unchanged: guardUnchanged,
    locked_target_unchanged: lockedUnchanged,
    scale: [1.5, 0.75, 2],
    mirror: ['x']
  };
}

export function inspectBooleanIsolationEvidence({
  beforeEntities,
  afterEntities,
  targetBefore,
  toolBefore,
  resultId,
  resultName,
  targetFingerprintBefore = stableEntityFingerprint(targetBefore),
  toolFingerprintBefore = stableEntityFingerprint(toolBefore),
  nonInputFingerprintsBefore = topLevelFingerprintsExcluding(
    beforeEntities,
    [targetBefore?.persistent_id, toolBefore?.persistent_id]
  )
}) {
  assert(Array.isArray(beforeEntities) && Array.isArray(afterEntities),
    'live boolean isolation requires before/after top-level entities');
  const targetPersistentId = String(targetBefore?.persistent_id || '');
  const toolPersistentId = String(toolBefore?.persistent_id || '');
  assert(targetPersistentId && toolPersistentId && targetPersistentId !== toolPersistentId,
    'live boolean isolation requires two distinct persistent ids');
  const resultCandidates = afterEntities.filter((entity) =>
    entity?.id === resultId || entity?.name === resultName);
  assert(resultCandidates.length === 1, `live boolean result must resolve exactly once; got ${resultCandidates.length}`);
  const result = resultCandidates[0];
  const resultPersistentId = String(result.persistent_id || '');
  assert(resultPersistentId, 'live boolean result has no persistent id');
  assert(
    resultPersistentId !== targetPersistentId && resultPersistentId !== toolPersistentId,
    'live boolean result reused an input persistent id'
  );
  const remainingTargets = afterEntities.filter((entity) =>
    String(entity?.persistent_id || '') === targetPersistentId);
  const remainingTools = afterEntities.filter((entity) =>
    String(entity?.persistent_id || '') === toolPersistentId);
  assert(remainingTargets.length === 0, 'live boolean target was not replaced by the reviewed result');
  assert(remainingTools.length === 1, 'live boolean keep_tools did not preserve exactly one tool');
  const nonInputFingerprintsAfter = topLevelFingerprintsExcluding(
    afterEntities,
    [toolPersistentId, resultPersistentId]
  );
  return {
    result,
    result_persistent_id: resultPersistentId,
    exact_target_replaced: stableEntityFingerprint(result) !== targetFingerprintBefore,
    tool_preserved_unchanged: stableEntityFingerprint(remainingTools[0]) === toolFingerprintBefore,
    non_input_top_level_entities_unchanged: canonicalFingerprintsEqual(
      nonInputFingerprintsBefore,
      nonInputFingerprintsAfter
    ),
    top_level_entity_count_preserved: afterEntities.length === beforeEntities.length
  };
}

async function liveSaveReopenProof(bridge, caseId, before, { caseDir, counters, timeoutMs, runtimeCapabilities, identityExpectation }) {
  const savePath = path.join(caseDir, `${caseId}.verified.skp`);
  await withFreshReliabilityQueueMutation(
    bridge,
    { operation: 'save_model', timeoutMs },
    (lockedBridge) => lockedBridge.save_model({
      runtime: 'queue', timeoutMs, path: savePath, keep_session: true
    })
  );
  await withFreshReliabilityQueueMutation(
    bridge,
    { operation: 'open_model', timeoutMs },
    (lockedBridge) => lockedBridge.open_model({
      runtime: 'queue', timeoutMs, path: savePath
    })
  );
  await waitForReliabilityModelActivation({ bridge, workingPath: savePath, timeoutMs });
  const after = await adopt(bridge, 'queue', timeoutMs, identityExpectation);
  const beforeIdentity = identitySignature(before);
  const afterIdentity = identitySignature(after);
  const exactIdentity = sha256Canonical(beforeIdentity) === sha256Canonical(afterIdentity);
  const beforeTotal = Number(before.recursive_total_seen ?? beforeIdentity.length);
  const afterTotal = Number(after.recursive_total_seen ?? afterIdentity.length);
  const beforeRevision = modelRevisionForAdoption(before);
  const afterRevision = modelRevisionForAdoption(after);
  const revisionStrategy = after.model_revision_strategy || runtimeCapabilities?.model_revision?.strategy || null;
  const revisionSourceSha256 = after.model_revision_source_sha256 || runtimeCapabilities?.model_revision_source_sha256 || null;
  const diff = compareSnapshots(
    snapshotForReliabilityCompare(before.snapshot, runtimeCapabilities),
    snapshotForReliabilityCompare(after.snapshot, runtimeCapabilities),
    { toleranceMm: 0 }
  );
  const diagnostic = {
    version: 'real-model-save-reopen-diagnostic.v1',
    kind: 'real_model_save_reopen_diagnostic',
    case_id: caseId,
    exact_identity: exactIdentity,
    identity_mode: identityExpectation.mode,
    identity_entries_before: beforeIdentity.length,
    identity_entries_after: afterIdentity.length,
    identity_total_before: beforeTotal,
    identity_total_after: afterTotal,
    identity_signature_before: sha256Canonical(beforeIdentity),
    identity_signature_after: sha256Canonical(afterIdentity),
    model_revision_before: beforeRevision,
    model_revision_after: afterRevision,
    model_revision_exact_match: beforeRevision === afterRevision,
    model_revision_strategy: revisionStrategy,
    model_revision_source_sha256: revisionSourceSha256,
    source_path_after_reopen_verified: after.model_info?.source_path === savePath,
    runtime_descriptor_source: 'fresh_live_capabilities',
    runtime_compatibility_ok: runtimeCapabilities?.compatibility?.ok === true,
    snapshot_diff: diff
  };
  await fs.writeFile(
    path.join(caseDir, `${caseId}.save-reopen-diagnostic.json`),
    `${JSON.stringify(diagnostic, null, 2)}\n`,
    'utf8'
  );
  if (diff.summary.by_severity.error > 0) counters.silent_geometry_corruption += 1;
  assert(exactIdentity, 'live save/reopen persistent identity changed');
  assert(beforeTotal === afterTotal, 'live save/reopen recursive occurrence total changed');
  assert(before.model_revision_complete === true && after.model_revision_complete === true, 'live save/reopen requires complete model revisions');
  if (identityExpectation.mode === 'full_recursive') {
    assert(before.recursive_truncated === false && after.recursive_truncated === false, 'full-recursive identity evidence must not truncate');
    assert(beforeIdentity.length === beforeTotal && afterIdentity.length === afterTotal, 'full-recursive identity evidence must materialize every occurrence');
  } else {
    assert(beforeIdentity.length <= identityExpectation.recursive_limit && afterIdentity.length <= identityExpectation.recursive_limit, 'bounded identity sample exceeded its contract limit');
  }
  assert(beforeRevision === afterRevision, 'live save/reopen model revision changed');
  assert(revisionStrategy === runtimeCapabilities?.model_revision?.strategy, 'live save/reopen revision strategy does not match fresh capabilities');
  assert(revisionSourceSha256 === runtimeCapabilities?.model_revision_source_sha256, 'live save/reopen revision source does not match fresh capabilities');
  assert(after.model_info?.source_path === savePath, 'live save/reopen did not activate the verified copy');
  assert(diff.summary.by_severity.error === 0, 'live save/reopen produced geometry errors');
  return {
    after,
    identity_evidence: {
      exact_match: true,
      identity_mode: identityExpectation.mode,
      entries_before: beforeIdentity.length,
      entries_after: afterIdentity.length,
      total_before: beforeTotal,
      total_after: afterTotal,
      recursive_limit: identityExpectation.recursive_limit,
      signature: sha256Canonical(beforeIdentity),
      snapshot_error_diffs: 0,
      model_revision_before: beforeRevision,
      model_revision_after: afterRevision,
      model_revision_exact_match: true,
      model_revision_strategy: revisionStrategy,
      model_revision_source_sha256: revisionSourceSha256,
      recursive_truncated_before: before.recursive_truncated === true,
      recursive_truncated_after: after.recursive_truncated === true,
      active_verified_copy_after_reopen: true
    }
  };
}

export function snapshotForReliabilityCompare(snapshot, runtimeCapabilities) {
  assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'snapshot is required for reliability comparison');
  assert(runtimeCapabilities && typeof runtimeCapabilities === 'object' && !Array.isArray(runtimeCapabilities), 'fresh runtime capabilities are required for reliability comparison');
  return {
    ...snapshot,
    runtime: snapshot.runtime || runtimeCapabilities
  };
}

function baselineLiveTaskEvidence(corpusCase, before, targets, expectations) {
  const evidence = {};
  if (corpusCase.tasks.includes('material_preservation')) {
    evidence.material_preservation = { initial_signature: materialSignature(before.snapshot), required_materials: expectations.required_materials };
  }
  if (corpusCase.tasks.includes('uv_material_preservation')) {
    evidence.uv_material_preservation = { initial_signature: uvSignature(before.snapshot), target_roles: expectations.uv_target_roles };
  }
  if (corpusCase.tasks.includes('scene_visibility_preservation')) {
    evidence.scene_visibility_preservation = presentationSignature(before.snapshot);
  }
  if (corpusCase.tasks.includes('large_recursive_index')) {
    evidence.large_recursive_index = {
      materialized_entries: before.recursive_index.length,
      total_entries: Number(before.recursive_total_seen ?? before.recursive_index.length),
      truncated: before.recursive_truncated === true,
      identity_mode: liveIdentityExpectation(expectations).mode
    };
  }
  if (corpusCase.tasks.includes('shared_definition_identity')) {
    const shared = before.recursive_index.filter((entry) => entry.shared_definition === true);
    evidence.shared_definition_identity = { shared_occurrences: shared.length };
  }
  return evidence;
}

function applyPostReopenPreservationEvidence(corpusCase, evidence, beforeSnapshot, afterSnapshot) {
  if (corpusCase.tasks.includes('material_preservation')) {
    const preSaveSignature = materialSignature(beforeSnapshot);
    const postReopenSignature = materialSignature(afterSnapshot);
    assert(preSaveSignature === postReopenSignature, 'live material signature changed after save/reopen');
    evidence.material_preservation.pre_save_signature = preSaveSignature;
    evidence.material_preservation.post_reopen_signature = postReopenSignature;
    evidence.material_preservation.preserved_across_save_reopen = true;
  }
  if (corpusCase.tasks.includes('uv_material_preservation')) {
    const preSaveSignature = uvSignature(beforeSnapshot);
    const postReopenSignature = uvSignature(afterSnapshot);
    assert(preSaveSignature === postReopenSignature, 'live UV signature changed after save/reopen');
    evidence.uv_material_preservation.pre_save_signature = preSaveSignature;
    evidence.uv_material_preservation.post_reopen_signature = postReopenSignature;
    evidence.uv_material_preservation.preserved_across_save_reopen = true;
  }
  if (corpusCase.tasks.includes('scene_visibility_preservation')) {
    const preSave = presentationSignature(beforeSnapshot);
    const postReopen = presentationSignature(afterSnapshot);
    assert(preSave.hash === postReopen.hash, 'live Scene/visibility signature changed after save/reopen');
    evidence.scene_visibility_preservation.pre_save_hash = preSave.hash;
    evidence.scene_visibility_preservation.post_reopen_hash = postReopen.hash;
    evidence.scene_visibility_preservation.preserved_across_save_reopen = true;
  }
}

export function validateLiveBaseline(corpusCase, adoption, targets, expectations) {
  const identityExpectation = liveIdentityExpectation(expectations);
  assert(adoption.entities.length >= expectations.minimum_entities, `${corpusCase.id} has too few top-level entities`);
  assert(adoption.model_revision_complete === true, `${corpusCase.id} model revision is incomplete`);
  const recursiveTotal = Number(adoption.recursive_total_seen ?? adoption.recursive_index.length);
  assert(recursiveTotal >= expectations.minimum_recursive_entities, `${corpusCase.id} recursive occurrence total is too small`);
  if (identityExpectation.mode === 'full_recursive') {
    assert(adoption.recursive_truncated === false, `${corpusCase.id} full recursive index is truncated`);
    assert(adoption.recursive_index.length === recursiveTotal, `${corpusCase.id} full recursive index did not materialize every occurrence`);
  } else {
    assert(adoption.recursive_index.length <= identityExpectation.recursive_limit, `${corpusCase.id} bounded recursive sample exceeded its limit`);
    assert(adoption.recursive_index.length > 0, `${corpusCase.id} bounded recursive sample is empty`);
  }
  assert(adoption.snapshot.scenes.length >= expectations.minimum_scenes, `${corpusCase.id} has too few Scenes`);
  for (const material of expectations.required_materials) assert(adoption.snapshot.material_names.includes(material), `${corpusCase.id} is missing material ${material}`);
  for (const role of expectations.uv_target_roles) {
    assert(hasUvEvidence(targets[role]), `${corpusCase.id} target ${role} has no UV evidence`);
  }
  for (const role of expectations.hidden_target_roles) assert(targets[role]?.visible === false, `${corpusCase.id} target ${role} is not hidden`);
  const shared = adoption.recursive_index.filter((entry) => entry.shared_definition === true).length;
  assert(shared >= expectations.minimum_shared_occurrences, `${corpusCase.id} has too few shared occurrences`);
}

function resolveLiveTargets(adoption, targetContract) {
  const result = {};
  for (const [role, selector] of Object.entries(targetContract)) {
    const candidates = adoption.entities.filter((entity) => String(entity.persistent_id || '') === selector.persistent_id);
    assert(candidates.length === 1, `Live target role ${role} must resolve to exactly one top-level persistent_id; got ${candidates.length}`);
    result[role] = candidates[0];
  }
  return result;
}

function assertRequiredLiveRoles(corpusCase, contract) {
  const required = [];
  if (corpusCase.tasks.includes('boolean_manifold')) required.push('boolean_target', 'boolean_tool');
  if (corpusCase.tasks.includes('abnormal_topology_detection')) required.push('repair_target');
  if (corpusCase.tasks.includes('locked_fail_closed')) required.push('locked_target', 'guard_target', 'transform_target');
  required.push(...contract.expectations.uv_target_roles, ...contract.expectations.hidden_target_roles);
  for (const role of new Set(required)) assert(contract.targets[role], `Live contract ${corpusCase.id} is missing target role ${role}`);
  if (corpusCase.tasks.includes('boolean_manifold')) assert(contract.expectations.boolean_operation, `Live contract ${corpusCase.id} requires boolean_operation`);
  if (corpusCase.tasks.includes('abnormal_topology_detection')) {
    assert(
      Array.isArray(contract.expectations.expected_topology_issue_codes)
        && contract.expectations.expected_topology_issue_codes.length > 0,
      `Live contract ${corpusCase.id} must bind expected_topology_issue_codes`
    );
  }
  if (corpusCase.tasks.includes('material_preservation')) {
    assert(contract.expectations.required_materials.length > 0, `Live contract ${corpusCase.id} must name at least one required material`);
  }
  if (corpusCase.tasks.includes('uv_material_preservation')) {
    assert(contract.expectations.uv_target_roles.length > 0, `Live contract ${corpusCase.id} must bind at least one UV target role`);
  }
  if (corpusCase.tasks.includes('scene_visibility_preservation')) {
    assert(contract.expectations.minimum_scenes > 0, `Live contract ${corpusCase.id} must require at least one Scene`);
  }
  if (corpusCase.id === 'appearance-scenes-hidden') {
    assert(contract.expectations.hidden_target_roles.length > 0, `Live contract ${corpusCase.id} must bind at least one hidden target role`);
  }
  if (corpusCase.tasks.includes('large_recursive_index')) {
    assert(contract.expectations.minimum_recursive_entities >= 1000, `Live contract ${corpusCase.id} large recursive index minimum must be at least 1000`);
  }
  if (corpusCase.tasks.includes('shared_definition_identity')) {
    assert(contract.expectations.minimum_shared_occurrences >= 2, `Live contract ${corpusCase.id} must require multiple shared occurrences`);
  }
}

function materializeTasks(corpusCase, evidence) {
  ensureAllTaskEvidence(corpusCase, evidence);
  return corpusCase.tasks.map((taskId) => ({ task_id: taskId, status: 'passed', evidence: evidence[taskId] }));
}

function ensureAllTaskEvidence(corpusCase, evidence) {
  for (const taskId of corpusCase.tasks) assert(evidence[taskId], `${corpusCase.id} did not produce evidence for ${taskId}`);
}

export function reliabilityFailedCaseResult(corpusCase, durationMs, error, runtime) {
  const taskEvidence = boundedPartialTaskEvidence(error?.reliability_task_evidence, corpusCase.tasks);
  const completedTaskIds = Object.keys(taskEvidence);
  return {
    id: corpusCase.id,
    domain: corpusCase.domain,
    evidence_class: runtime === 'mock' ? corpusCase.mock.evidence_class : 'external_live_artifact',
    source_kind: runtime === 'mock' ? corpusCase.mock.source_kind : 'external_skp',
    live_requirement: runtime === 'mock' ? corpusCase.live.status : 'satisfied_by_hash_bound_external_artifact',
    ok: false,
    duration_ms: durationMs,
    tasks: corpusCase.tasks.map((taskId) => taskEvidence[taskId]
      ? { task_id: taskId, status: 'passed', evidence: taskEvidence[taskId] }
      : { task_id: taskId, status: 'failed', evidence: {} }),
    details: {
      failure: publicReliabilityFailure(error),
      completed_task_ids: completedTaskIds,
      ...(corpusCase.tasks.includes(error?.reliability_failed_task)
        ? { failed_task_id: error.reliability_failed_task }
        : {})
    },
    error: sanitizeError(error)
  };
}

function coverageSummary(manifest, taskResults) {
  const result = {};
  for (const taskId of [...new Set(manifest.cases.flatMap((entry) => entry.tasks))].sort()) {
    const matching = taskResults.filter((task) => task.task_id === taskId);
    result[taskId] = {
      cases: matching.length,
      passed: matching.filter((task) => task.status === 'passed').length,
      status: matching.length > 0 && matching.every((task) => task.status === 'passed') ? 'passed' : 'failed'
    };
  }
  return result;
}

function materialSignature(snapshot) {
  return sha256Canonical({
    materials: [...(snapshot.materials || [])]
      .map((material) => structuredClone(material))
      .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''))),
    material_names: [...(snapshot.material_names || [])].sort(),
    assignments: [...(snapshot.groups || []), ...(snapshot.instances || [])]
      .map((item) => ({ id: item.id || null, name: item.name || null, material: item.material || null, back_material: item.back_material || null }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  });
}

function uvSignature(snapshot) {
  const entries = [...(snapshot.groups || []), ...(snapshot.instances || [])]
    .filter(hasUvEvidence)
    .map((item) => ({ id: item.id || null, name: item.name || null, texture_transform: item.texture_transform || null, face_uvs: item.face_uvs || null }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return entries.length ? sha256Canonical(entries) : '';
}

function hasUvEvidence(item) {
  return Boolean(item?.texture_transform)
    || (Array.isArray(item?.face_uvs) && item.face_uvs.length > 0);
}

function presentationSignature(snapshot) {
  const entities = [...(snapshot.groups || []), ...(snapshot.instances || [])]
    .map((item) => ({ id: item.id || null, name: item.name || null, visible: item.visible !== false }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const scenes = (snapshot.scenes || [])
    .map((scene) => typeof scene === 'object' && scene !== null ? structuredClone(scene) : { name: String(scene) })
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
  return {
    hash: sha256Canonical({
      entities,
      scenes,
      view_state: snapshot.view_state || null,
      style_state: snapshot.style_state || null,
      shadow_state: snapshot.shadow_state || null,
      rendering_options: snapshot.rendering_options || null
    }),
    scenes: scenes.length,
    hidden_entities: entities.filter((entity) => entity.visible === false).length
  };
}

function identitySignature(adoption) {
  return (adoption.recursive_index || []).map((entry) => ({
    entity_path: entry.entity_path,
    persistent_id_path: entry.persistent_id_path || null,
    entity_type: entry.entity_type,
    reference: entry.reference || null,
    name: entry.name || null,
    definition_name: entry.definition_name || null,
    parent_definition: entry.parent_definition || null,
    shared_definition: entry.shared_definition === true,
    affected_instance_count: entry.affected_instance_count,
    editable: entry.editable === true,
    edit_scope: entry.edit_scope || null
  })).sort((left, right) => String(left.entity_path).localeCompare(String(right.entity_path)));
}

export function publicManifoldReport(report) {
  assert(report && typeof report === 'object' && !Array.isArray(report), 'manifold report is required');
  assert(Array.isArray(report.issues), 'manifold report issues must be an array');
  return {
    is_manifold: report.is_manifold === true,
    method: String(report.method || ''),
    faces: Number(report.faces || 0),
    edges: Number(report.edges || 0),
    vertices: Number(report.vertices || 0),
    issues: [...report.issues].map(String).sort()
  };
}

export function singleManifoldTargetReport(check, label = 'manifold check') {
  assert(Array.isArray(check?.targets), `${label} did not include target reports`);
  assert(check.targets.length === 1, `${label} must include exactly one target report`);
  return {
    ...check.targets[0],
    issues: [...(check.targets[0].issues || [])].map(String).sort()
  };
}

export function topLevelFingerprintsExcluding(entities, excludedPersistentIds) {
  assert(Array.isArray(entities), 'top-level entities must be an array');
  const excluded = new Set(
    (Array.isArray(excludedPersistentIds) ? excludedPersistentIds : [excludedPersistentIds])
      .map((value) => String(value || ''))
      .filter(Boolean)
  );
  const rows = entities
    .filter((entity) => !excluded.has(String(entity?.persistent_id || '')))
    .map((entity) => {
      const persistentId = String(entity?.persistent_id || '');
      assert(persistentId, 'top-level isolation evidence requires persistent ids');
      return [persistentId, stableEntityFingerprint(entity)];
    })
    .sort((left, right) => left[0].localeCompare(right[0]));
  assert(new Set(rows.map(([persistentId]) => persistentId)).size === rows.length, 'top-level persistent ids must be unique');
  return rows;
}

function canonicalFingerprintsEqual(left, right) {
  return sha256Canonical(left) === sha256Canonical(right);
}

export function stableEntityFingerprint(entity) {
  return sha256Canonical({
    id: entity?.id || null,
    persistent_id: entity?.persistent_id || null,
    entity_type: entity?.entity_type || entity?.kind || null,
    faces: Number.isFinite(Number(entity?.faces)) ? Number(entity.faces) : null,
    edges: Number.isFinite(Number(entity?.edges)) ? Number(entity.edges) : null,
    vertices: Number.isFinite(Number(entity?.vertices)) ? Number(entity.vertices) : null,
    bounding_box: entity?.bounding_box || null,
    material: entity?.material || null,
    attributes: entity?.attributes || null,
    transform: entity?.transform || entity?.transformation || null,
    visible: entity?.visible !== false,
    locked: entity?.locked === true
  });
}

function targetId(entity) {
  const value = entity?.persistent_id || entity?.id;
  assert(value, 'Live reliability target has no stable id or persistent_id');
  return String(value);
}

function numberArrayEquals(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => Number(value) === expected[index]);
}

function stringArrayEquals(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => String(value) === expected[index]);
}

function boxModel(id, name, origin, size, locked) {
  const max = origin.map((value, axis) => value + size[axis]);
  return {
    id, name, kind: 'box', faces: 6, edges: 12,
    bounding_box: { min: origin, max, w: size[0], d: size[1], h: size[2] }, locked
  };
}

async function adopt(bridge, runtime, timeoutMs, identityExpectation = { mode: 'full_recursive', recursive_limit: 100000 }) {
  const options = {
    runtime,
    timeoutMs,
    recursive: true,
    recursive_limit: identityExpectation.recursive_limit,
    read_only: true,
    prefix: 'real-model-reliability'
  };
  return bridge.adopt_open_model(options);
}

export function reliabilityActivationTimeout(timeoutMs) {
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0, 'timeoutMs must be a positive finite number');
  return Math.min(timeoutMs, RELIABILITY_ACTIVATION_TIMEOUT_MS);
}

export function reliabilityActivationSettleMs(value = 0) {
  const settleMs = Number(value);
  assert(
    Number.isInteger(settleMs)
      && settleMs >= 0
      && settleMs <= MAX_RELIABILITY_ACTIVATION_SETTLE_MS,
    `activationSettleMs must be an integer between 0 and ${MAX_RELIABILITY_ACTIVATION_SETTLE_MS}`
  );
  return settleMs;
}

async function waitForReliabilityModelActivation({ bridge, workingPath, timeoutMs }) {
  return waitForDisposableModelActivation({
    bridge,
    workingPath,
    timeoutMs: reliabilityActivationTimeout(timeoutMs)
  });
}

export function liveIdentityExpectation(expectations = {}) {
  const mode = expectations.identity_mode || 'full_recursive';
  assert(['full_recursive', 'complete_revision_bounded_occurrence_sample'].includes(mode), `unsupported live identity mode: ${mode}`);
  const recursiveLimit = Number(expectations.recursive_limit ?? 100000);
  assert(Number.isInteger(recursiveLimit) && recursiveLimit >= 1 && recursiveLimit <= 100000, 'live recursive_limit must be an integer between 1 and 100000');
  return { mode, recursive_limit: recursiveLimit };
}

function emptyCounters() {
  return { wrong_object_modifications: 0, silent_geometry_corruption: 0, recovery_attempts: 0, recoveries: 0 };
}

async function validateReport(report) {
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'schema/real-model-reliability-report-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validate(report)) throw new Error(`Reliability report schema validation failed: ${JSON.stringify(validate.errors)}`);
}

async function loadAndValidateJson(filePath, schemaPath, label) {
  const [value, schema] = await Promise.all([
    fs.readFile(filePath, 'utf8').then(JSON.parse),
    fs.readFile(schemaPath, 'utf8').then(JSON.parse)
  ]);
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validate(value)) throw new Error(`${label} is invalid: ${JSON.stringify(validate.errors)}`);
  return value;
}

async function validateJsonValue(value, schemaPath, label) {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validate(value)) throw new Error(`${label} is invalid: ${JSON.stringify(validate.errors)}`);
  return value;
}

async function readStableExternalFile(options) {
  return withStableExternalFile(options, async (handle, before) => {
    assert(before.size <= 1024n * 1024n, `${options.label} exceeds the 1 MiB sidecar limit.`);
    return handle.readFile('utf8');
  });
}

async function copyStableExternalFile({ destinationPath, ...options }) {
  return withStableExternalFile(options, async (sourceHandle) => {
    const destinationHandle = await fs.open(destinationPath, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    let position = 0;
    try {
      for await (const chunk of sourceHandle.createReadStream({ autoClose: false, start: 0 })) {
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await destinationHandle.write(chunk, offset, chunk.length - offset, position);
          assert(bytesWritten > 0, `${options.label} disposable copy made no progress.`);
          offset += bytesWritten;
          position += bytesWritten;
        }
      }
      await destinationHandle.truncate(position);
      await destinationHandle.sync();
      return `sha256:${hash.digest('hex')}`;
    } catch (error) {
      await fs.rm(destinationPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await destinationHandle.close();
    }
  });
}

async function withStableExternalFile({ root, rootRealPath, relativePath, label, afterOpen }, consume) {
  const filePath = safeChildPath(root, relativePath);
  const beforePath = await fs.lstat(filePath, { bigint: true }).catch(() => null);
  assert(beforePath, `${label} is missing.`);
  assert(!beforePath.isSymbolicLink(), `${label} must not be a symbolic link.`);
  assert(beforePath.isFile(), `${label} must be a regular file.`);
  const beforeRealPath = await fs.realpath(filePath);
  assert(isWithin(rootRealPath, beforeRealPath), `${label} real path escapes --live-artifact-root.`);

  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    throw new Error(`${label} could not be opened without following links: ${String(error?.code || error?.message || error)}`);
  }
  try {
    const beforeHandle = await handle.stat({ bigint: true });
    assert(beforeHandle.isFile(), `${label} open descriptor is not a regular file.`);
    assert(sameFileIdentityAndSize(beforePath, beforeHandle), `${label} changed between lstat and O_NOFOLLOW open.`);
    if (typeof afterOpen === 'function') await afterOpen({ label, relative_path: relativePath, file_path: filePath });
    const result = await consume(handle, beforeHandle);
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(filePath, { bigint: true }).catch(() => null),
      fs.realpath(filePath).catch(() => null)
    ]);
    assert(afterPath?.isFile() && !afterPath.isSymbolicLink(), `${label} path changed type while being read.`);
    assert(afterRealPath && isWithin(rootRealPath, afterRealPath), `${label} real path escaped --live-artifact-root while being read.`);
    assert(sameFileIdentityAndSize(beforeHandle, afterHandle), `${label} descriptor inode or size changed while being read.`);
    assert(sameFileIdentityAndSize(beforeHandle, afterPath), `${label} path was replaced while being read.`);
    assert(beforeHandle.mtimeNs === afterHandle.mtimeNs && beforeHandle.ctimeNs === afterHandle.ctimeNs, `${label} timestamps changed while being read.`);
    return result;
  } finally {
    await handle.close();
  }
}

function sameFileIdentityAndSize(left, right) {
  return Boolean(left && right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size;
}

async function validateManifestSemantics(manifest) {
  for (const [label, values] of [
    ['case id', manifest.cases.map((entry) => entry.id)],
    ['live artifact', manifest.cases.map((entry) => entry.live.artifact)],
    ['live contract', manifest.cases.map((entry) => entry.live.contract)]
  ]) {
    assert(new Set(values).size === values.length, `Reliability manifest contains duplicate ${label}.`);
  }
  const requiredDomains = [
    'architecture', 'interior', 'product', 'shared_component', 'imported_cad', 'appearance', 'transform_edge_case'
  ];
  const requiredCaseIds = [
    'architecture-golden', 'interior-expression', 'product-boolean-manifold', 'deep-shared-components',
    'imported-dirty-topology', 'appearance-scenes-hidden', 'scaled-mirrored-locked'
  ];
  const domains = new Set(manifest.cases.map((entry) => entry.domain));
  for (const domain of requiredDomains) assert(domains.has(domain), `Reliability manifest is missing required domain ${domain}.`);
  const caseIds = new Set(manifest.cases.map((entry) => entry.id));
  for (const caseId of requiredCaseIds) assert(caseIds.has(caseId), `Reliability manifest is missing required case ${caseId}.`);
  for (const corpusCase of manifest.cases) {
    if (corpusCase.mock.source_kind !== 'repository_json_fixture') continue;
    assert(!path.isAbsolute(corpusCase.mock.source), `Mock fixture path must be repository-relative for ${corpusCase.id}.`);
    const sourcePath = resolveRepoPath(corpusCase.mock.source);
    assert(isWithin(repoRoot, sourcePath), `Mock fixture path escapes repository root for ${corpusCase.id}.`);
    const stats = await fs.stat(sourcePath).catch(() => null);
    assert(stats?.isFile(), `Mock fixture is missing for ${corpusCase.id}: ${corpusCase.mock.source}`);
  }
}

function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
  });
}

function safeChildPath(root, relative) {
  const resolved = path.resolve(root, relative);
  if (!isWithin(root, resolved)) throw new Error('Live corpus path escapes --live-artifact-root.');
  return resolved;
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
}

function repoRelativeOrLabel(value) {
  const relative = path.relative(repoRoot, value);
  return relative && !relative.startsWith('..') ? relative : '<external-manifest>';
}

function externalPreflightError(error, root) {
  const safe = String(error?.message || error).replaceAll(root, '<live-artifact-root>');
  return new Error(safe);
}

export function publicReliabilityFailure(error) {
  const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(String(error?.code || ''))
    ? String(error.code)
    : 'INTERNAL_ERROR';
  const value = {
    code,
    retryable: error?.retryable === true
  };
  const details = error?.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details
    : {};
  if (['start', 'precommit_execution', 'precommit_serialization', 'commit', 'postcommit_finalize', 'save'].includes(details.phase)) {
    value.phase = details.phase;
  }
  if (['not_started', 'not_committed', 'outcome_unknown', 'committed'].includes(details.commit_state)) {
    value.commit_state = details.commit_state;
  }
  if (typeof details.commit_confirmed === 'boolean') value.commit_confirmed = details.commit_confirmed;
  if (typeof details.abort_succeeded === 'boolean') value.abort_succeeded = details.abort_succeeded;
  if (KNOWN_OPERATION_FAILURE_CODES.has(details.operation_failure_code)) {
    value.operation_failure_code = details.operation_failure_code;
  }
  const nextAction = error?.next_action?.action;
  if (/^[a-z][a-z0-9_]{1,80}$/.test(String(nextAction || ''))) value.next_action = nextAction;
  return value;
}

function sanitizeError(error) {
  const value = String(error?.message || error || 'unknown reliability failure');
  return value.replaceAll(/\/(Users|home)\/[^\s"']+/g, '<redacted-path>');
}

function annotateReliabilityFailure(error, { failedTaskId, taskEvidence }) {
  const failure = error instanceof Error ? error : new Error(String(error || 'unknown reliability failure'));
  failure.reliability_failed_task = failedTaskId;
  failure.reliability_task_evidence = boundedPartialTaskEvidence(taskEvidence);
  return failure;
}

function boundedPartialTaskEvidence(value, allowedTaskIds = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(allowedTaskIds.length ? allowedTaskIds : Object.keys(value));
  return Object.fromEntries(Object.entries(value)
    .filter(([taskId, evidence]) => (
      allowed.has(taskId)
      && evidence
      && typeof evidence === 'object'
      && !Array.isArray(evidence)
      && Object.keys(evidence).length > 0
    ))
    .map(([taskId, evidence]) => [taskId, structuredClone(evidence)]));
}

const KNOWN_OPERATION_FAILURE_CODES = new Set([
  'boolean_input_resolution_failed',
  'boolean_input_not_group',
  'boolean_input_scope_mismatch',
  'boolean_input_not_manifold',
  'boolean_duplicate_input',
  'boolean_result_identity_conflict',
  'boolean_solid_operation_unavailable',
  'boolean_input_copy_failed',
  'boolean_split_result_count_mismatch',
  'boolean_split_result_type_invalid',
  'boolean_solid_volume_invalid',
  'boolean_target_volume_not_reduced',
  'boolean_solid_operation_failed',
  'boolean_result_not_manifold',
  'boolean_cleanup_failed',
  'boolean_postcondition_failed',
  'boolean_internal_failure'
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(promise, pattern) {
  try {
    await promise;
  } catch (error) {
    if (!pattern.test(String(error?.message || error)) && !pattern.test(String(error?.code || ''))) throw error;
    return error;
  }
  throw new Error(`Expected operation to reject with ${pattern}`);
}

function parseArgs(argv) {
  const options = {};
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = takeValue(index++, arg);
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(takeValue(index++, arg));
    else if (arg === '--output-dir') options.outputDir = takeValue(index++, arg);
    else if (arg === '--manifest') options.manifestPath = takeValue(index++, arg);
    else if (arg === '--live-artifact-root') options.liveArtifactRoot = takeValue(index++, arg);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:\n  node scripts/run-real-model-reliability-harness.mjs [--runtime mock] [--output-dir output/real-model-reliability/mock]\n  node scripts/run-real-model-reliability-harness.mjs --runtime queue --queue-required --live-artifact-root /path/to/hash-bound-corpus [--timeout-ms 240000]\n`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runRealModelReliabilityHarness(parseArgs(process.argv.slice(2)))
    .then(({ report, report_path: reportPath }) => {
      process.stdout.write(`${JSON.stringify({ ...report, artifact: reportPath }, null, 2)}\n`);
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      // Queue cleanup is owned by runRealModelReliabilityHarness once live
      // transport starts. Parse/preflight/mock failures must not even inspect
      // the user's default queue directories.
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
