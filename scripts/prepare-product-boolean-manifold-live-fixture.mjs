#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';
import { waitForDisposableModelActivation } from '../src/real-model-candidate-intake.mjs';
import {
  cleanupReliabilityQueueArtifacts,
  installReliabilityInterruptCleanup,
  publicManifoldReport,
  singleManifoldTargetReport,
  stableEntityFingerprint,
  topLevelFingerprintsExcluding
} from './run-real-model-reliability-harness.mjs';
import { deriveIsolatedFixtureOrigin } from './prepare-imported-dirty-topology-live-fixture.mjs';

export const CONTROLLED_PRODUCT_BOOLEAN_FIXTURE_VERSION = 'controlled-product-boolean-live-fixture.v1';
export const BOOLEAN_TARGET_ID = 'alma-reliability-product-boolean-target';
export const BOOLEAN_TOOL_ID = 'alma-reliability-product-boolean-tool';
export const BOOLEAN_TARGET_NAME = 'ALMA_Reliability_Product_Boolean_Target';
export const BOOLEAN_TOOL_NAME = 'ALMA_Reliability_Product_Boolean_Tool';
export const BOOLEAN_TARGET_MATERIAL = 'ALMA_Reliability_Product_Boolean_Material';
export const BOOLEAN_TOOL_MATERIAL = 'ALMA_Reliability_Product_Boolean_Tool_Material';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourcePath = path.join(repoRoot, 'test', '模型', 'Trimble S6.skp');
const defaultPreparationRoot = path.join(
  repoRoot,
  'output',
  'live-validation',
  'real-model-reliability-preparation',
  'product-boolean-manifold-derived-v1'
);
const defaultArtifactRoot = path.join(
  repoRoot,
  'output',
  'live-validation',
  'real-model-reliability-inputs',
  'product-boolean-manifold-derived-v1'
);

export function controlledProductBooleanFixtureOperations(origin = [0, 0, 0]) {
  assertFinitePoint(origin, 'fixture origin');
  const [x, y, z] = origin;
  return [
    {
      op: 'material',
      name: BOOLEAN_TARGET_MATERIAL,
      color: '#f2c230'
    },
    {
      op: 'material',
      name: BOOLEAN_TOOL_MATERIAL,
      color: '#30343b',
      alpha: 0.55
    },
    {
      op: 'box',
      id: BOOLEAN_TARGET_ID,
      name: BOOLEAN_TARGET_NAME,
      origin: [x, y, z],
      size: [160, 100, 80],
      material: BOOLEAN_TARGET_MATERIAL
    },
    {
      op: 'cylinder',
      id: BOOLEAN_TOOL_ID,
      name: BOOLEAN_TOOL_NAME,
      origin: [x + 60, y + 50, z - 10],
      radius: 20,
      height: 100,
      segments: 32,
      material: BOOLEAN_TOOL_MATERIAL,
      smooth: 'all'
    }
  ];
}

export function buildProductBooleanContract({
  artifactSha256,
  entities,
  recursiveTotal,
  targetPersistentId,
  toolPersistentId
}) {
  assert(/^sha256:[0-9a-f]{64}$/.test(artifactSha256));
  assert(Number.isInteger(entities) && entities >= 3);
  assert(Number.isInteger(recursiveTotal) && recursiveTotal >= entities);
  assert(typeof targetPersistentId === 'string' && targetPersistentId.length > 0);
  assert(typeof toolPersistentId === 'string' && toolPersistentId.length > 0);
  assert.notEqual(targetPersistentId, toolPersistentId);
  return {
    version: 'real-model-reliability-live-case.v1',
    kind: 'real_model_reliability_live_case',
    case_id: 'product-boolean-manifold',
    artifact_file: 'product-boolean-manifold.skp',
    artifact_sha256: artifactSha256,
    targets: {
      boolean_target: { persistent_id: targetPersistentId },
      boolean_tool: { persistent_id: toolPersistentId }
    },
    expectations: {
      minimum_entities: entities,
      minimum_recursive_entities: recursiveTotal,
      minimum_scenes: 0,
      required_materials: [BOOLEAN_TARGET_MATERIAL],
      uv_target_roles: [],
      hidden_target_roles: [],
      minimum_shared_occurrences: 0,
      boolean_operation: 'boolean_difference',
      identity_mode: recursiveTotal <= 100000
        ? 'full_recursive'
        : 'complete_revision_bounded_occurrence_sample',
      recursive_limit: 100000
    }
  };
}

export function assertProductBooleanSnapshot(snapshot) {
  assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
  assert((snapshot.material_names || []).includes(BOOLEAN_TARGET_MATERIAL),
    'controlled product Boolean target material is missing');
  assert((snapshot.material_names || []).includes(BOOLEAN_TOOL_MATERIAL),
    'controlled product Boolean tool material is missing');
  const check = (snapshot.manifold_checks || []).at(-1);
  assert(check?.op === 'manifold_check' && check?.ok === true,
    'controlled product Boolean manifold check did not pass');
  assert(Array.isArray(check.targets) && check.targets.length === 2,
    'controlled product Boolean manifold check must contain two targets');
  const reports = check.targets.map((target) => publicManifoldReport(target));
  assert(reports.every((report) => report.is_manifold === true && report.issues.length === 0),
    'controlled product Boolean inputs must both be manifold');
  return reports;
}

export function assertProductBooleanPlacement({ sourceBounds, target, tool, marginMm = 2000 }) {
  const targetBounds = finiteBounds(target?.bounding_box, 'Boolean target bounds');
  const toolBounds = finiteBounds(tool?.bounding_box, 'Boolean tool bounds');
  const source = finiteBounds(sourceBounds, 'source bounds');
  assert(targetBounds.min[0] >= source.max[0] + marginMm - 1,
    'Boolean target is not isolated from the product-model context');
  const overlap = [0, 1, 2].map((axis) =>
    Math.min(targetBounds.max[axis], toolBounds.max[axis])
      - Math.max(targetBounds.min[axis], toolBounds.min[axis]));
  assert(overlap.every((value) => value > 0), 'Boolean target/tool do not have positive 3D overlap');
  assert(toolBounds.min[2] < targetBounds.min[2] && toolBounds.max[2] > targetBounds.max[2],
    'Boolean tool must pass completely through the target');
  return {
    isolated_from_source: true,
    positive_3d_overlap: true,
    through_cut: true,
    overlap_mm: overlap
  };
}

export async function prepareControlledProductBooleanFixture({
  runtime = 'queue',
  queueRequired = false,
  sourcePath = defaultSourcePath,
  preparationRoot = defaultPreparationRoot,
  artifactRoot = defaultArtifactRoot,
  timeoutMs = 1200000,
  runId = timestampId(),
  resumeStaged = false
} = {}) {
  assertExplicitQueue(runtime, queueRequired);
  assertLiveExecutionPolicy();
  const staged = resumeStaged
    ? await loadStagedProductBooleanFixture({
      sourcePath,
      preparationRoot,
      artifactRoot,
      runId
    })
    : await stageControlledProductBooleanFixture({
      sourcePath,
      preparationRoot,
      artifactRoot,
      runId
    });
  const {
    absoluteSourcePath,
    runDir,
    workingPath,
    finalArtifactPath,
    finalContractPath,
    reportPath,
    sourceSha256
  } = staged;

  const bridge = new SketchUpBridge({});
  assertBridgePolicy(bridge);
  const uninstallCleanup = installReliabilityInterruptCleanup();
  try {
    assertQueueIdle(await bridge.queue_diagnostics({ timeoutMs }));
    const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
    assert.equal(capabilities.runtime.compatibility?.ok, true, 'live runtime is incompatible');
    if (!resumeStaged) {
      await bridge.open_model({
        runtime: 'queue',
        timeoutMs,
        path: workingPath,
        ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
      });
    }
    await waitForDisposableModelActivation({ bridge, workingPath, timeoutMs });
    const before = await adopt(bridge, timeoutMs);
    assert.equal(before.model_revision_complete, true);
    assert.equal(before.model_modified, false, 'staged product Boolean working copy must be clean');
    assert.equal(path.resolve(before.model_info?.source_path || ''), path.resolve(workingPath),
      'active model is not the staged product Boolean working copy');
    assert.equal(
      before.entities.some((entity) =>
        [BOOLEAN_TARGET_ID, BOOLEAN_TOOL_ID].includes(entity.id)
        || [BOOLEAN_TARGET_NAME, BOOLEAN_TOOL_NAME].includes(entity.name)),
      false,
      'source already contains the controlled Boolean fixture'
    );
    const placement = deriveIsolatedFixtureOrigin(before);
    const originalFingerprints = topLevelFingerprintsExcluding(before.entities, []);

    await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: controlledProductBooleanFixtureOperations(placement.origin)
      }),
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const checked = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [{
          op: 'manifold_check',
          targets: [BOOLEAN_TARGET_ID, BOOLEAN_TOOL_ID],
          check_id: 'controlled-product-boolean-inputs',
          fail_on_non_manifold: true
        }]
      }),
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const initialManifoldReports = assertProductBooleanSnapshot(checked.snapshot);

    const afterBuild = await adopt(bridge, timeoutMs);
    assert.equal(afterBuild.model_revision_complete, true);
    const fixtureTargets = resolveFixtureTargets(afterBuild.entities);
    assert.equal(afterBuild.entities.length, before.entities.length + 2,
      'product Boolean fixture must add exactly two top-level entities');
    assert.deepEqual(
      topLevelFingerprintsExcluding(afterBuild.entities, [
        fixtureTargets.target.persistent_id,
        fixtureTargets.tool.persistent_id
      ]),
      originalFingerprints,
      'product Boolean fixture changed an original top-level entity'
    );
    const placementEvidence = assertProductBooleanPlacement({
      sourceBounds: placement.source_bounds,
      target: fixtureTargets.target,
      tool: fixtureTargets.tool,
      marginMm: placement.margin_mm
    });
    assert.equal(fixtureTargets.target.material, BOOLEAN_TARGET_MATERIAL,
      'product Boolean target material was not assigned');
    const targetFingerprint = stableEntityFingerprint(fixtureTargets.target);
    const toolFingerprint = stableEntityFingerprint(fixtureTargets.tool);

    await bridge.save_model({
      runtime: 'queue',
      timeoutMs,
      path: finalArtifactPath,
      keep_session: true,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    await bridge.open_model({
      runtime: 'queue',
      timeoutMs,
      path: finalArtifactPath,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    await waitForDisposableModelActivation({ bridge, workingPath: finalArtifactPath, timeoutMs });
    const finalized = await adopt(bridge, timeoutMs);
    assert.equal(finalized.model_revision_complete, true);
    const reopenedTargets = resolveFixtureTargets(finalized.entities, {
      targetPersistentId: String(fixtureTargets.target.persistent_id),
      toolPersistentId: String(fixtureTargets.tool.persistent_id)
    });
    assert.equal(stableEntityFingerprint(reopenedTargets.target), targetFingerprint,
      'Boolean target changed during fixture save/reopen');
    assert.equal(stableEntityFingerprint(reopenedTargets.tool), toolFingerprint,
      'Boolean tool changed during fixture save/reopen');
    assert.deepEqual(
      topLevelFingerprintsExcluding(finalized.entities, [
        reopenedTargets.target.persistent_id,
        reopenedTargets.tool.persistent_id
      ]),
      originalFingerprints,
      'original product-model context changed during fixture save/reopen'
    );
    const reopenedCheck = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [{
          op: 'manifold_check',
          targets: [
            String(reopenedTargets.target.persistent_id),
            String(reopenedTargets.tool.persistent_id)
          ],
          check_id: 'controlled-product-boolean-inputs-reopen',
          fail_on_non_manifold: true
        }]
      }),
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const reopenedManifoldReports = assertProductBooleanSnapshot(reopenedCheck.snapshot);

    const recursiveTotal = Number(finalized.recursive_total_seen ?? finalized.recursive_index.length);
    if (recursiveTotal <= 100000) {
      assert.equal(finalized.recursive_truncated, false,
        'full-recursive product Boolean fixture index is truncated');
      assert.equal(finalized.recursive_index.length, recursiveTotal,
        'full-recursive product Boolean fixture index is incomplete');
    }
    const artifactSha256 = `sha256:${await sha256File(finalArtifactPath)}`;
    const contract = buildProductBooleanContract({
      artifactSha256,
      entities: finalized.entities.length,
      recursiveTotal,
      targetPersistentId: String(reopenedTargets.target.persistent_id),
      toolPersistentId: String(reopenedTargets.tool.persistent_id)
    });
    await validateContract(contract);
    await fs.writeFile(finalContractPath, `${JSON.stringify(contract, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    assert.equal(await sha256File(absoluteSourcePath), sourceSha256,
      'operator source model changed during product Boolean fixture preparation');

    const report = {
      version: CONTROLLED_PRODUCT_BOOLEAN_FIXTURE_VERSION,
      kind: 'controlled_product_boolean_live_fixture_finalization',
      status: 'ready_for_formal_live_case',
      finalized_at: new Date().toISOString(),
      derivation_class: 'controlled_overlapping_manifold_pair_overlay_on_trimble_s6_copy',
      source: {
        sha256: sourceSha256,
        original_bytes_unchanged: true
      },
      overlay: {
        operation_count: 4,
        operations: ['material', 'material', 'box', 'cylinder'],
        geometry_mutation_performed: true,
        product_context_retained: true,
        original_top_level_entities_preserved: true,
        fixture: 'manifold_box_with_through_cylinder',
        origin_mm: placement.origin,
        separation_margin_mm: placement.margin_mm,
        ...placementEvidence
      },
      target: {
        public_id: BOOLEAN_TARGET_ID,
        persistent_id: String(reopenedTargets.target.persistent_id),
        name_untrusted: BOOLEAN_TARGET_NAME,
        material: BOOLEAN_TARGET_MATERIAL,
        initial_manifold_report: initialManifoldReports[0],
        reopened_manifold_report: reopenedManifoldReports.find((entry) =>
          entry.faces === initialManifoldReports[0].faces) || reopenedManifoldReports[0]
      },
      tool: {
        public_id: BOOLEAN_TOOL_ID,
        persistent_id: String(reopenedTargets.tool.persistent_id),
        name_untrusted: BOOLEAN_TOOL_NAME,
        material: BOOLEAN_TOOL_MATERIAL,
        initial_manifold_report: initialManifoldReports[1],
        reopened_manifold_report: reopenedManifoldReports.find((entry) =>
          entry.faces === initialManifoldReports[1].faces) || reopenedManifoldReports[1]
      },
      artifact: {
        path: finalArtifactPath,
        sha256: artifactSha256,
        bytes: (await fs.stat(finalArtifactPath)).size
      },
      contract: {
        path: finalContractPath,
        sha256: `sha256:${await sha256File(finalContractPath)}`
      },
      identity: {
        model_revision: finalized.model_revision,
        model_revision_complete: true,
        identity_mode: contract.expectations.identity_mode,
        top_level_entities_before: before.entities.length,
        top_level_entities_after: finalized.entities.length,
        recursive_total_before: Number(before.recursive_total_seen ?? before.recursive_index.length),
        recursive_total_after: recursiveTotal,
        recursive_entries_materialized: finalized.recursive_index.length,
        recursive_truncated: finalized.recursive_truncated === true
      },
      runtime_attestation: runtimeAttestation(capabilities.runtime),
      queue_clean: queueSummary(await bridge.queue_diagnostics({ timeoutMs })),
      release_acceptance: false
    };
    assertQueueSummaryClean(report.queue_clean);
    await validateFixtureDocument(report);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    return { report, report_path: reportPath };
  } finally {
    uninstallCleanup();
    await cleanupReliabilityQueueArtifacts(process.pid);
  }
}

export async function stageControlledProductBooleanFixture({
  sourcePath = defaultSourcePath,
  preparationRoot = defaultPreparationRoot,
  artifactRoot = defaultArtifactRoot,
  runId = timestampId()
} = {}) {
  assertRunId(runId);
  const absoluteSourcePath = await assertSafeWorkspaceExistingFile(sourcePath, 'source model');
  const absolutePreparationRoot = assertWorkspacePath(preparationRoot, 'preparation root');
  const absoluteArtifactRoot = assertWorkspacePath(artifactRoot, 'artifact root');
  const runDir = path.join(absolutePreparationRoot, `run-${runId}`);
  await fs.mkdir(absolutePreparationRoot, { recursive: true, mode: 0o700 });
  await assertSafeWorkspaceDirectory(absolutePreparationRoot, 'preparation root');
  await fs.mkdir(runDir, { recursive: false, mode: 0o700 });
  await assertSafeWorkspaceDirectory(runDir, 'preparation run directory');
  await fs.mkdir(absoluteArtifactRoot, { recursive: true, mode: 0o700 });
  await assertSafeWorkspaceDirectory(absoluteArtifactRoot, 'artifact root');

  const workingPath = path.join(runDir, 'working-copy.skp');
  const finalArtifactPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'product-boolean-manifold.skp'),
    'final artifact'
  );
  const finalContractPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'product-boolean-manifold.reliability.json'),
    'final contract'
  );
  const reportPath = await assertSafeWorkspaceOutputPath(
    path.join(runDir, 'finalization-report.v1.json'),
    'finalization report'
  );
  await assertMissing(finalArtifactPath, 'final artifact');
  await assertMissing(finalContractPath, 'final contract');
  await assertMissing(reportPath, 'finalization report');

  const sourceSha256 = await sha256File(absoluteSourcePath);
  await fs.copyFile(absoluteSourcePath, workingPath, fsConstants.COPYFILE_EXCL);
  assert.equal(await sha256File(workingPath), sourceSha256, 'disposable source copy is not byte-exact');
  return {
    version: 'controlled-product-boolean-live-fixture-stage.v1',
    kind: 'controlled_product_boolean_live_fixture_stage',
    queue_called: false,
    run_id: runId,
    source_sha256: sourceSha256,
    working_path: workingPath,
    absoluteSourcePath,
    runDir,
    workingPath,
    finalArtifactPath,
    finalContractPath,
    reportPath,
    sourceSha256
  };
}

export async function loadStagedProductBooleanFixture({
  sourcePath = defaultSourcePath,
  preparationRoot = defaultPreparationRoot,
  artifactRoot = defaultArtifactRoot,
  runId
} = {}) {
  assertRunId(runId);
  const absoluteSourcePath = await assertSafeWorkspaceExistingFile(sourcePath, 'source model');
  const absolutePreparationRoot = await assertSafeWorkspaceDirectory(
    assertWorkspacePath(preparationRoot, 'preparation root'),
    'preparation root'
  );
  const absoluteArtifactRoot = await assertSafeWorkspaceDirectory(
    assertWorkspacePath(artifactRoot, 'artifact root'),
    'artifact root'
  );
  const runDir = await assertSafeWorkspaceDirectory(
    path.join(absolutePreparationRoot, `run-${runId}`),
    'staged preparation run directory'
  );
  const workingPath = await assertSafeWorkspaceExistingFile(
    path.join(runDir, 'working-copy.skp'),
    'staged working copy'
  );
  const finalArtifactPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'product-boolean-manifold.skp'),
    'final artifact'
  );
  const finalContractPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'product-boolean-manifold.reliability.json'),
    'final contract'
  );
  const reportPath = await assertSafeWorkspaceOutputPath(
    path.join(runDir, 'finalization-report.v1.json'),
    'finalization report'
  );
  await assertMissing(finalArtifactPath, 'final artifact');
  await assertMissing(finalContractPath, 'final contract');
  await assertMissing(reportPath, 'finalization report');
  const sourceSha256 = await sha256File(absoluteSourcePath);
  assert.equal(await sha256File(workingPath), sourceSha256,
    'staged working copy is not byte-exact with the operator source');
  return {
    absoluteSourcePath,
    runDir,
    workingPath,
    finalArtifactPath,
    finalContractPath,
    reportPath,
    sourceSha256
  };
}

async function adopt(bridge, timeoutMs) {
  return bridge.adopt_open_model({
    runtime: 'queue',
    timeoutMs,
    read_only: true,
    recursive: true,
    recursive_limit: 100000
  });
}

function resolveFixtureTargets(entities, expected = {}) {
  assert(Array.isArray(entities));
  const targetCandidates = entities.filter((entity) =>
    expected.targetPersistentId
      ? String(entity.persistent_id || '') === expected.targetPersistentId
      : entity.id === BOOLEAN_TARGET_ID || entity.name === BOOLEAN_TARGET_NAME);
  const toolCandidates = entities.filter((entity) =>
    expected.toolPersistentId
      ? String(entity.persistent_id || '') === expected.toolPersistentId
      : entity.id === BOOLEAN_TOOL_ID || entity.name === BOOLEAN_TOOL_NAME);
  assert.equal(targetCandidates.length, 1, 'controlled Boolean target must resolve exactly once');
  assert.equal(toolCandidates.length, 1, 'controlled Boolean tool must resolve exactly once');
  assert.notEqual(String(targetCandidates[0].persistent_id || ''), String(toolCandidates[0].persistent_id || ''));
  return { target: targetCandidates[0], tool: toolCandidates[0] };
}

async function validateContract(contract) {
  const schema = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'schema', 'real-model-reliability-live-case-v1.schema.json'),
    'utf8'
  ));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(contract), true, JSON.stringify(validate.errors, null, 2));
}

export async function validateFixtureDocument(document) {
  const schema = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'schema', 'controlled-product-boolean-live-fixture-v1.schema.json'),
    'utf8'
  ));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(document), true, `fixture document is invalid: ${JSON.stringify(validate.errors, null, 2)}`);
  return document;
}

function runtimeAttestation(runtime) {
  return {
    name: runtime.name,
    server_version: runtime.version,
    plugin_version: runtime.plugin?.version || null,
    sketchup_version: runtime.plugin?.sketchup_version || null,
    capability_version: runtime.capability_version,
    manifest_version: runtime.manifest_version,
    revision_strategy: runtime.model_revision?.strategy || null,
    revision_source_sha256: runtime.model_revision_source_sha256 || null,
    compatibility_ok: runtime.compatibility?.ok === true
  };
}

function assertLiveExecutionPolicy() {
  assert.equal(
    process.env.ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES?.split(',').map((value) => value.trim()).includes('queue'),
    true,
    'queue runtime must be explicitly allowed'
  );
  assert.equal(process.env.ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION, '1',
    'queue mutation must be explicitly allowed');
  assert.equal(process.env.ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION, '1',
    'direct expert queue mutation must be explicitly allowed');
}

function assertExplicitQueue(runtime, queueRequired) {
  assert.equal(runtime, 'queue', 'live fixture preparation requires --runtime queue');
  assert.equal(queueRequired, true, 'live fixture preparation requires --runtime queue --queue-required');
}

function assertBridgePolicy(bridge) {
  assert.equal(bridge.executionPolicy.allowed_runtimes.includes('queue'), true);
  assert.equal(bridge.executionPolicy.allow_queue_mutation, true);
  assert.equal(bridge.executionPolicy.allow_direct_expert_queue_mutation, true);
}

function assertQueueIdle(diagnostics) {
  assertQueueSummaryClean(queueSummary(diagnostics));
}

function queueSummary(diagnostics) {
  return {
    queue: diagnostics.queue.count,
    processing: diagnostics.processing.count,
    responses: diagnostics.responses.count,
    lock: diagnostics.lock.exists
  };
}

function assertQueueSummaryClean(summary) {
  assert.deepEqual(summary, { queue: 0, processing: 0, responses: 0, lock: false },
    'queue is not clean');
}

function assertWorkspacePath(value, label) {
  const absolute = path.resolve(value);
  assert(
    absolute === repoRoot || absolute.startsWith(`${repoRoot}${path.sep}`),
    `${label} must stay inside the workspace`
  );
  return absolute;
}

async function assertSafeWorkspaceExistingFile(value, label) {
  const absolute = assertWorkspacePath(value, label);
  await assertNoWorkspaceSymlinkComponents(absolute, label);
  const stat = await fs.lstat(absolute).catch(() => null);
  assert(stat?.isFile() === true && stat.isSymbolicLink() === false,
    `${label} must be an existing regular file`);
  const real = await fs.realpath(absolute);
  assertWorkspacePath(real, `${label} real path`);
  return absolute;
}

async function assertSafeWorkspaceDirectory(value, label) {
  const absolute = assertWorkspacePath(value, label);
  await assertNoWorkspaceSymlinkComponents(absolute, label);
  const stat = await fs.lstat(absolute).catch(() => null);
  assert(stat?.isDirectory() === true && stat.isSymbolicLink() === false,
    `${label} must be an existing directory`);
  const real = await fs.realpath(absolute);
  assertWorkspacePath(real, `${label} real path`);
  return absolute;
}

async function assertSafeWorkspaceOutputPath(value, label) {
  const absolute = assertWorkspacePath(value, label);
  await assertSafeWorkspaceDirectory(path.dirname(absolute), `${label} parent`);
  const existing = await fs.lstat(absolute).catch(() => null);
  assert(existing === null || existing.isSymbolicLink() === false, `${label} must not be a symlink`);
  return absolute;
}

async function assertNoWorkspaceSymlinkComponents(absolute, label) {
  const relative = path.relative(repoRoot, absolute);
  assert(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)),
    `${label} escapes the workspace`);
  let cursor = repoRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const stat = await fs.lstat(cursor).catch(() => null);
    if (!stat) break;
    assert.equal(stat.isSymbolicLink(), false, `${label} crosses a symlink component`);
  }
}

async function assertMissing(filePath, label) {
  const stat = await fs.lstat(filePath).catch(() => null);
  assert.equal(stat, null, `${label} already exists; refusing to overwrite ${filePath}`);
}

function finiteBounds(value, label) {
  assert(value && Array.isArray(value.min) && Array.isArray(value.max), `${label} are missing`);
  assertFinitePoint(value.min, `${label}.min`);
  assertFinitePoint(value.max, `${label}.max`);
  return { min: value.min.map(Number), max: value.max.map(Number) };
}

function assertFinitePoint(value, label) {
  assert(Array.isArray(value) && value.length === 3 && value.every((entry) => Number.isFinite(Number(entry))),
    `${label} must contain three finite coordinates`);
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function assertRunId(value) {
  assert(
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value),
    'run id must be a short filesystem-safe identifier'
  );
}

function parseArgs(argv) {
  const options = {};
  options.command = argv.shift();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[++index];
      assert(value, `${arg} requires a value`);
      return value;
    };
    if (arg === '--source') options.sourcePath = take();
    else if (arg === '--runtime') options.runtime = take();
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--preparation-root') options.preparationRoot = take();
    else if (arg === '--artifact-root') options.artifactRoot = take();
    else if (arg === '--timeout-ms') options.timeoutMs = Number(take());
    else if (arg === '--run-id') options.runId = take();
    else if (arg === '--resume-staged') options.resumeStaged = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.resumeStaged && !options.runId) {
    process.stderr.write('--resume-staged requires the exact --run-id returned by stage.\n');
    process.exitCode = 2;
  } else if (!['stage', 'prepare'].includes(options.command)) {
    process.stderr.write(
      'Usage: node scripts/prepare-product-boolean-manifold-live-fixture.mjs stage [--source <skp>] --run-id <id>\n'
      + '   or: node scripts/prepare-product-boolean-manifold-live-fixture.mjs prepare --runtime queue --queue-required --run-id <id> [--resume-staged]\n'
    );
    process.exitCode = 2;
  } else if (options.command === 'stage') {
    stageControlledProductBooleanFixture(options)
      .then((result) => process.stdout.write(`${JSON.stringify({
        version: result.version,
        kind: result.kind,
        queue_called: result.queue_called,
        run_id: result.run_id,
        source_sha256: result.source_sha256,
        working_path: result.working_path,
        next_action: 'Launch this working_path as the only SketchUp document, start the plugin Bridge, then run prepare with --resume-staged and the same --run-id.'
      }, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  } else {
    process.stderr.write([
      '',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      '[DANGER] CONTROLLED PRODUCT BOOLEAN REAL-MODEL FIXTURE PREPARATION',
      options.resumeStaged
        ? 'This run WILL modify the already-active staged disposable copy and add two'
        : 'This run WILL switch the active SketchUp document and add two isolated',
      options.resumeStaged
        ? 'isolated manifold solids. It will not open a second initial document.'
        : 'manifold solids to a workspace-contained Trimble S6 disposable copy.',
      'The operator source is read-only. No Boolean operation is executed yet.',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      ''
    ].join('\n'));
    prepareControlledProductBooleanFixture(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
