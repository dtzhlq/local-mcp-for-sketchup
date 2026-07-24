#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { waitForDisposableModelActivation } from '../src/real-model-candidate-intake.mjs';
import {
  RELIABILITY_HANDSHAKE_TTL_MS,
  cleanupReliabilityQueueArtifacts,
  freshReliabilitySessionOptions,
  installReliabilityInterruptCleanup,
  publicManifoldReport,
  singleManifoldTargetReport,
  topLevelFingerprintsExcluding
} from './run-real-model-reliability-harness.mjs';

export const CONTROLLED_DIRTY_TOPOLOGY_FIXTURE_VERSION = 'controlled-dirty-topology-live-fixture.v1';
export const CONTROLLED_FIXTURE_ACTIVATION_TIMEOUT_MS = 10 * 60 * 1000;
export const DIRTY_TOPOLOGY_TARGET_ID = 'alma-reliability-dirty-topology-target';
export const DIRTY_TOPOLOGY_TARGET_NAME = 'ALMA_Reliability_Dirty_Topology_Target';
export const EXPECTED_DIRTY_TOPOLOGY_ISSUES = Object.freeze(['boundary_edges']);
export { RELIABILITY_HANDSHAKE_TTL_MS };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourcePath = path.join(repoRoot, 'test', '模型', 'Revit import Complete.skp');
const defaultPreparationRoot = path.join(
  repoRoot,
  'output',
  'live-validation',
  'real-model-reliability-preparation',
  'imported-dirty-topology-derived-v1'
);
const defaultArtifactRoot = path.join(
  repoRoot,
  'output',
  'live-validation',
  'real-model-reliability-inputs',
  'imported-dirty-topology-derived-v1'
);
const defaultSourceProfilePath = path.join(
  repoRoot,
  'output',
  'real-model-reliability',
  'intake',
  'real-model-candidate-profile.v1.json'
);

export function controlledDirtyTopologyFixtureOperations(origin = [0, 0, 0]) {
  assertFinitePoint(origin, 'fixture origin');
  const [x, y, z] = origin;
  return [{
    op: 'geometry_input',
    id: DIRTY_TOPOLOGY_TARGET_ID,
    name: DIRTY_TOPOLOGY_TARGET_NAME,
    vertices: [
      [x, y, z],
      [x + 100, y, z],
      [x + 100, y + 100, z],
      [x, y + 100, z],
      [x, y, z + 100],
      [x + 100, y, z + 100],
      [x + 100, y + 100, z + 100],
      [x, y + 100, z + 100],
      [x + 150, y, z],
      [x + 150, y + 100, z]
    ],
    faces: [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ],
    edges: [[8, 9]]
  }];
}

export function deriveIsolatedFixtureOrigin(adoption, marginMm = 2000) {
  assert(Number.isFinite(marginMm) && marginMm >= 1000, 'fixture isolation margin must be at least 1000 mm');
  const bounds = aggregateBounds([
    ...(adoption?.entities || []).map((entity) => entity?.bounding_box),
    adoption?.snapshot?.bounding_box
  ]);
  assert(bounds, 'source model did not expose a finite world bounding box');
  return {
    origin: [bounds.max[0] + marginMm, bounds.min[1], bounds.min[2]],
    source_bounds: bounds,
    margin_mm: marginMm
  };
}

export function buildImportedDirtyTopologyContract({
  artifactSha256,
  entities,
  recursiveTotal,
  repairTargetPersistentId
}) {
  assert(/^sha256:[0-9a-f]{64}$/.test(artifactSha256));
  assert(Number.isInteger(entities) && entities >= 2);
  assert(Number.isInteger(recursiveTotal) && recursiveTotal >= entities);
  assert(typeof repairTargetPersistentId === 'string' && repairTargetPersistentId.length > 0);
  return {
    version: 'real-model-reliability-live-case.v1',
    kind: 'real_model_reliability_live_case',
    case_id: 'imported-dirty-topology',
    artifact_file: 'imported-dirty-topology.skp',
    artifact_sha256: artifactSha256,
    targets: {
      repair_target: {
        persistent_id: repairTargetPersistentId
      }
    },
    expectations: {
      minimum_entities: entities,
      minimum_recursive_entities: recursiveTotal,
      minimum_scenes: 0,
      required_materials: [],
      uv_target_roles: [],
      hidden_target_roles: [],
      minimum_shared_occurrences: 0,
      boolean_operation: null,
      expected_topology_issue_codes: [...EXPECTED_DIRTY_TOPOLOGY_ISSUES],
      identity_mode: recursiveTotal <= 100000
        ? 'full_recursive'
        : 'complete_revision_bounded_occurrence_sample',
      recursive_limit: 100000
    }
  };
}

export function assertDirtyTopologySnapshot(snapshot, expectedIssues = EXPECTED_DIRTY_TOPOLOGY_ISSUES) {
  assert(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
  const check = (snapshot.manifold_checks || []).at(-1);
  assert(check?.op === 'manifold_check', 'controlled dirty-topology probe is missing');
  assert.equal(check.ok, false, 'controlled dirty-topology target unexpectedly passed');
  const report = singleManifoldTargetReport(check, 'controlled dirty-topology probe');
  assert.equal(report.is_manifold, false, 'controlled dirty-topology target must be non-manifold');
  for (const issue of expectedIssues) {
    assert(report.issues.includes(issue), `controlled dirty-topology target is missing ${issue}`);
  }
  assert.equal(Number(report.faces), 6, 'controlled dirty-topology target must retain the six closed-box faces');
  assert(Number(report.edges) >= 13, 'controlled dirty-topology target must include the isolated loose edge');
  assert(Number(report.vertices) >= 10, 'controlled dirty-topology target must include the two loose-edge vertices');
  return publicManifoldReport(report);
}

export async function prepareControlledImportedDirtyTopologyFixture({
  runtime = 'queue',
  queueRequired = false,
  sourcePath = defaultSourcePath,
  preparationRoot = defaultPreparationRoot,
  artifactRoot = defaultArtifactRoot,
  timeoutMs = 3600000,
  runId = timestampId(),
  resumePristineWorkingCopy = false,
  resumeSavedArtifactAfterDocumentFocusDrift = false
} = {}) {
  assertExplicitQueue(runtime, queueRequired);
  assertLiveExecutionPolicy();
  assert.equal(
    resumePristineWorkingCopy && resumeSavedArtifactAfterDocumentFocusDrift,
    false,
    'working-copy resume and saved-artifact recovery modes are mutually exclusive'
  );
  const absoluteSourcePath = await assertSafeWorkspaceExistingFile(sourcePath, 'source model');
  const absolutePreparationRoot = assertWorkspacePath(preparationRoot, 'preparation root');
  const absoluteArtifactRoot = assertWorkspacePath(artifactRoot, 'artifact root');
  const runDir = path.join(absolutePreparationRoot, `run-${runId}`);
  await fs.mkdir(absolutePreparationRoot, { recursive: true, mode: 0o700 });
  await assertSafeWorkspaceDirectory(absolutePreparationRoot, 'preparation root');
  if (resumePristineWorkingCopy || resumeSavedArtifactAfterDocumentFocusDrift) {
    await assertSafeWorkspaceDirectory(runDir, 'preparation run directory');
  } else {
    await fs.mkdir(runDir, { recursive: false, mode: 0o700 });
  }
  await assertSafeWorkspaceDirectory(runDir, 'preparation run directory');
  await fs.mkdir(absoluteArtifactRoot, { recursive: true, mode: 0o700 });
  await assertSafeWorkspaceDirectory(absoluteArtifactRoot, 'artifact root');

  const workingPath = path.join(runDir, 'working-copy.skp');
  const finalArtifactPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'imported-dirty-topology.skp'),
    'final artifact'
  );
  const finalContractPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'imported-dirty-topology.reliability.json'),
    'final contract'
  );
  const reportPath = await assertSafeWorkspaceOutputPath(
    path.join(runDir, 'finalization-report.v1.json'),
    'finalization report'
  );
  if (resumeSavedArtifactAfterDocumentFocusDrift) {
    await assertSafeWorkspaceExistingFile(finalArtifactPath, 'saved artifact recovery input');
  } else {
    await assertMissing(finalArtifactPath, 'final artifact');
  }
  await assertMissing(finalContractPath, 'final contract');
  await assertMissing(reportPath, 'finalization report');

  const sourceSha256 = await sha256File(absoluteSourcePath);
  if (resumePristineWorkingCopy || resumeSavedArtifactAfterDocumentFocusDrift) {
    assert.equal(
      await assertSafeWorkspaceExistingFile(workingPath, 'resumed working copy'),
      workingPath
    );
  } else {
    await fs.copyFile(absoluteSourcePath, workingPath, fsConstants.COPYFILE_EXCL);
  }
  assert.equal(await sha256File(workingPath), sourceSha256, 'disposable source copy is not byte-exact');

  const bridge = new SketchUpBridge({});
  assertBridgePolicy(bridge);
  const uninstallCleanup = installReliabilityInterruptCleanup();
  try {
    assertQueueIdle(await bridge.queue_diagnostics({ timeoutMs }));
    const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
    assert.equal(capabilities.runtime.compatibility?.ok, true, 'live runtime is incompatible');
    if (resumeSavedArtifactAfterDocumentFocusDrift) {
      return finalizeRecoveredSavedArtifact({
        bridge,
        capabilities,
        timeoutMs,
        absoluteSourcePath,
        sourceSha256,
        workingPath,
        finalArtifactPath,
        finalContractPath,
        reportPath
      });
    }
    if (!resumePristineWorkingCopy) {
      await bridge.open_model({
        runtime: 'queue',
        timeoutMs,
        path: workingPath,
        ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
      });
    }
    const activationContract = await waitForControlledFixtureActivation({ bridge, workingPath, timeoutMs });
    assertActivePristineWorkingCopy(activationContract, workingPath);
    const before = await adoptBounded(bridge, timeoutMs);
    assert.equal(before.model_revision_complete, true);
    assert.equal(
      before.entities.some((entity) =>
        entity.id === DIRTY_TOPOLOGY_TARGET_ID || entity.name === DIRTY_TOPOLOGY_TARGET_NAME),
      false,
      'source already contains the controlled dirty-topology target'
    );
    const placement = deriveIsolatedFixtureOrigin(before);
    const originalFingerprints = topLevelFingerprintsExcluding(before.entities, '__no-matching-persistent-id__');

    await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: controlledDirtyTopologyFixtureOperations(placement.origin)
      }),
      ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const checked = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [{
          op: 'manifold_check',
          target_id: DIRTY_TOPOLOGY_TARGET_ID,
          check_id: 'controlled-dirty-topology-baseline',
          fail_on_non_manifold: false
        }]
      }),
      ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const initialTopology = assertDirtyTopologySnapshot(checked.snapshot);
    const afterBuild = await adoptBounded(bridge, timeoutMs);
    assert.equal(afterBuild.model_revision_complete, true);
    const targets = afterBuild.entities.filter((entity) =>
      entity.id === DIRTY_TOPOLOGY_TARGET_ID || entity.name === DIRTY_TOPOLOGY_TARGET_NAME);
    assert.equal(targets.length, 1, 'controlled dirty-topology target must resolve exactly once');
    const repairTarget = targets[0];
    const repairTargetPersistentId = String(repairTarget.persistent_id || '');
    assert(repairTargetPersistentId, 'controlled dirty-topology target has no persistent id');
    assertFixtureIsolation(repairTarget, placement);
    assert.equal(afterBuild.entities.length, before.entities.length + 1, 'fixture must add exactly one top-level target');
    assert.deepEqual(
      topLevelFingerprintsExcluding(afterBuild.entities, repairTargetPersistentId),
      originalFingerprints,
      'fixture preparation changed a source top-level entity'
    );

    await bridge.save_model({
      runtime: 'queue',
      timeoutMs,
      path: finalArtifactPath,
      keep_session: true,
      ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    await bridge.open_model({
      runtime: 'queue',
      timeoutMs,
      path: finalArtifactPath,
      ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    await waitForControlledFixtureActivation({ bridge, workingPath: finalArtifactPath, timeoutMs });
    const finalized = await adoptBounded(bridge, timeoutMs);
    assert.equal(finalized.model_revision_complete, true);
    const finalizedTargets = finalized.entities.filter((entity) =>
      String(entity.persistent_id || '') === repairTargetPersistentId);
    assert.equal(finalizedTargets.length, 1, 'repair target identity drifted after save/reopen');
    assertFixtureIsolation(finalizedTargets[0], placement);
    assert.deepEqual(
      topLevelFingerprintsExcluding(finalized.entities, repairTargetPersistentId),
      originalFingerprints,
      'source top-level entity changed after fixture save/reopen'
    );
    const rechecked = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: [{
          op: 'manifold_check',
          target_id: repairTargetPersistentId,
          check_id: 'controlled-dirty-topology-reopen',
          fail_on_non_manifold: false
        }]
      }),
      ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const reopenedTopology = assertDirtyTopologySnapshot(rechecked.snapshot);

    const recursiveTotal = Number(finalized.recursive_total_seen ?? finalized.recursive_index.length);
    const artifactSha256 = `sha256:${await sha256File(finalArtifactPath)}`;
    const contract = buildImportedDirtyTopologyContract({
      artifactSha256,
      entities: finalized.entities.length,
      recursiveTotal,
      repairTargetPersistentId
    });
    await validateContract(contract);
    await fs.writeFile(finalContractPath, `${JSON.stringify(contract, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    assert.equal(await sha256File(absoluteSourcePath), sourceSha256, 'operator source model changed during fixture preparation');

    const report = {
      version: CONTROLLED_DIRTY_TOPOLOGY_FIXTURE_VERSION,
      kind: 'controlled_dirty_topology_live_fixture_finalization',
      status: 'ready_for_formal_live_case',
      finalized_at: new Date().toISOString(),
      derivation_class: 'controlled_loose_edge_overlay_on_user_authorized_imported_model_copy',
      working_copy_mode: resumePristineWorkingCopy
        ? 'resumed_byte_exact_pristine_copy'
        : 'new_byte_exact_copy',
      recovery: null,
      source: {
        sha256: sourceSha256,
        original_bytes_unchanged: true
      },
      overlay: {
        operation_count: 1,
        operations: ['geometry_input'],
        geometry_mutation_performed: true,
        imported_context_retained: true,
        original_top_level_entities_preserved: true,
        defect_fixture: 'closed_box_plus_one_isolated_loose_edge',
        origin_mm: placement.origin,
        separation_margin_mm: placement.margin_mm
      },
      repair_target: {
        public_id: DIRTY_TOPOLOGY_TARGET_ID,
        persistent_id: repairTargetPersistentId,
        name_untrusted: DIRTY_TOPOLOGY_TARGET_NAME,
        expected_issue_codes: [...EXPECTED_DIRTY_TOPOLOGY_ISSUES],
        initial_report: initialTopology,
        reopened_report: reopenedTopology,
        repair_performed_during_preparation: false
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
      session_contract_ttl_ms: RELIABILITY_HANDSHAKE_TTL_MS,
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

async function adoptBounded(bridge, timeoutMs) {
  return bridge.adopt_open_model({
    runtime: 'queue',
    timeoutMs,
    read_only: true,
    recursive: true,
    recursive_limit: 100000,
    ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
  });
}

async function finalizeRecoveredSavedArtifact({
  bridge,
  capabilities,
  timeoutMs,
  absoluteSourcePath,
  sourceSha256,
  workingPath,
  finalArtifactPath,
  finalContractPath,
  reportPath
}) {
  const activationContract = await waitForControlledFixtureActivation({
    bridge,
    workingPath: finalArtifactPath,
    timeoutMs
  });
  assertActiveSavedArtifact(activationContract, finalArtifactPath);
  const finalized = await adoptBounded(bridge, timeoutMs);
  assert.equal(finalized.model_revision_complete, true);
  const targets = finalized.entities.filter((entity) =>
    entity.id === DIRTY_TOPOLOGY_TARGET_ID || entity.name === DIRTY_TOPOLOGY_TARGET_NAME);
  assert.equal(targets.length, 1, 'saved artifact must contain exactly one controlled dirty-topology target');
  const repairTarget = targets[0];
  const repairTargetPersistentId = String(repairTarget.persistent_id || '');
  assert(repairTargetPersistentId, 'saved artifact repair target has no persistent id');

  const sourceBaseline = await loadSourceBaselineProfile(sourceSha256);
  const nonTargets = finalized.entities.filter((entity) =>
    String(entity.persistent_id || '') !== repairTargetPersistentId);
  assert.equal(
    nonTargets.length,
    sourceBaseline.top_level_entities,
    'saved artifact non-target top-level count does not match the hash-bound source baseline'
  );
  assert.equal(
    finalized.entities.length,
    sourceBaseline.top_level_entities + 1,
    'saved artifact must add exactly one top-level controlled target'
  );
  const sourceBounds = aggregateBounds(nonTargets.map((entity) => entity?.bounding_box));
  assert(sourceBounds, 'saved artifact non-target entities have no finite source bounds');
  const recoveredPlacement = {
    origin: [sourceBounds.max[0] + 2000, sourceBounds.min[1], sourceBounds.min[2]],
    source_bounds: sourceBounds,
    margin_mm: 2000
  };
  assertFixtureIsolation(repairTarget, recoveredPlacement);

  const rechecked = await bridge.build_model({
    runtime: 'queue',
    timeoutMs,
    code: JSON.stringify({
      version: 1,
      units: 'mm',
      operations: [{
        op: 'manifold_check',
        target_id: repairTargetPersistentId,
        check_id: 'controlled-dirty-topology-recovered-artifact',
        fail_on_non_manifold: false
      }]
    }),
    ...await freshReliabilitySessionOptions(bridge, { runtime: 'queue', timeoutMs })
  });
  const reopenedTopology = assertDirtyTopologySnapshot(rechecked.snapshot);
  const recursiveTotal = Number(finalized.recursive_total_seen ?? finalized.recursive_index.length);
  const artifactSha256 = `sha256:${await sha256File(finalArtifactPath)}`;
  const contract = buildImportedDirtyTopologyContract({
    artifactSha256,
    entities: finalized.entities.length,
    recursiveTotal,
    repairTargetPersistentId
  });
  await validateContract(contract);
  await fs.writeFile(finalContractPath, `${JSON.stringify(contract, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
  assert.equal(await sha256File(absoluteSourcePath), sourceSha256, 'operator source changed during recovery finalization');
  assert.equal(await sha256File(workingPath), sourceSha256, 'pristine working copy changed during recovery finalization');

  const report = {
    version: CONTROLLED_DIRTY_TOPOLOGY_FIXTURE_VERSION,
    kind: 'controlled_dirty_topology_live_fixture_finalization',
    status: 'ready_for_formal_live_case',
    finalized_at: new Date().toISOString(),
    derivation_class: 'controlled_loose_edge_overlay_on_user_authorized_imported_model_copy',
    working_copy_mode: 'recovered_saved_artifact_after_document_focus_drift',
    recovery: {
      mode: 'post_save_active_artifact_recovery',
      reason_code: 'HANDSHAKE_DOCUMENT_MISMATCH',
      active_artifact_path_verified: true,
      artifact_clean_after_save: true,
      source_profile_path: sourceBaseline.path,
      source_profile_sha256: sourceBaseline.sha256,
      source_top_level_entities: sourceBaseline.top_level_entities,
      artifact_non_target_top_level_entities: nonTargets.length,
      pre_save_isolation_assertions_precede_guarded_save_in_preparer: true
    },
    source: {
      sha256: sourceSha256,
      original_bytes_unchanged: true
    },
    overlay: {
      operation_count: 1,
      operations: ['geometry_input'],
      geometry_mutation_performed: true,
      imported_context_retained: true,
      original_top_level_entities_preserved: true,
      defect_fixture: 'closed_box_plus_one_isolated_loose_edge',
      origin_mm: recoveredPlacement.origin,
      separation_margin_mm: recoveredPlacement.margin_mm
    },
    repair_target: {
      public_id: DIRTY_TOPOLOGY_TARGET_ID,
      persistent_id: repairTargetPersistentId,
      name_untrusted: DIRTY_TOPOLOGY_TARGET_NAME,
      expected_issue_codes: [...EXPECTED_DIRTY_TOPOLOGY_ISSUES],
      initial_report: reopenedTopology,
      reopened_report: reopenedTopology,
      repair_performed_during_preparation: false
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
      top_level_entities_before: sourceBaseline.top_level_entities,
      top_level_entities_after: finalized.entities.length,
      recursive_total_before: sourceBaseline.logical_occurrences,
      recursive_total_after: recursiveTotal,
      recursive_entries_materialized: finalized.recursive_index.length,
      recursive_truncated: finalized.recursive_truncated === true
    },
    runtime_attestation: runtimeAttestation(capabilities.runtime),
    session_contract_ttl_ms: RELIABILITY_HANDSHAKE_TTL_MS,
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
}

export function controlledFixtureActivationTimeout(timeoutMs) {
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0, 'timeoutMs must be a positive finite number');
  return Math.min(timeoutMs, CONTROLLED_FIXTURE_ACTIVATION_TIMEOUT_MS);
}

export function assertActivePristineWorkingCopy(contract, workingPath) {
  assert(contract && typeof contract === 'object', 'active working-copy Session Contract is missing');
  assert.equal(contract.model_revision_complete, true, 'active working-copy revision must be complete');
  assert.equal(contract.model_modified, false, 'active working copy has unsaved modifications and cannot be resumed');
  assert.equal(
    path.resolve(String(contract.model_identity?.source_path || '')),
    path.resolve(workingPath),
    'active SketchUp document is not the requested working copy'
  );
  return contract;
}

export function assertActiveSavedArtifact(contract, artifactPath) {
  assert(contract && typeof contract === 'object', 'active saved-artifact Session Contract is missing');
  assert.equal(contract.model_revision_complete, true, 'active saved-artifact revision must be complete');
  assert.equal(contract.model_modified, false, 'active saved artifact must be clean after save');
  assert.equal(
    path.resolve(String(contract.model_identity?.source_path || '')),
    path.resolve(artifactPath),
    'active SketchUp document is not the saved artifact'
  );
  return contract;
}

async function waitForControlledFixtureActivation({ bridge, workingPath, timeoutMs }) {
  const activationTimeoutMs = controlledFixtureActivationTimeout(timeoutMs);
  return waitForDisposableModelActivation({
    bridge,
    workingPath,
    timeoutMs: activationTimeoutMs
  });
}

async function validateContract(contract) {
  const schema = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'schema', 'real-model-reliability-live-case-v1.schema.json'),
    'utf8'
  ));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(contract), true, JSON.stringify(validate.errors, null, 2));
}

async function loadSourceBaselineProfile(sourceSha256) {
  const profilePath = await assertSafeWorkspaceExistingFile(defaultSourceProfilePath, 'source baseline profile');
  const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
  const matches = (profile.profiles || []).filter((entry) =>
    entry?.source_sha256 === `sha256:${sourceSha256}` && entry?.status === 'profiled');
  assert.equal(matches.length, 1, 'hash-bound source baseline profile must resolve exactly once');
  const structure = matches[0].structure || {};
  assert(Number.isInteger(structure.top_level_entities) && structure.top_level_entities >= 1);
  assert(Number.isInteger(structure.recursive_total_seen) && structure.recursive_total_seen >= structure.top_level_entities);
  assert.equal(matches[0].revision_attestation?.complete, true, 'source baseline revision must be complete');
  return {
    path: profilePath,
    sha256: `sha256:${await sha256File(profilePath)}`,
    top_level_entities: structure.top_level_entities,
    logical_occurrences: structure.recursive_total_seen
  };
}

export async function validateFixtureDocument(document) {
  const schema = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'schema', 'controlled-dirty-topology-live-fixture-v1.schema.json'),
    'utf8'
  ));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(document), true, `fixture document is invalid: ${JSON.stringify(validate.errors, null, 2)}`);
  return document;
}

function assertFixtureIsolation(target, placement) {
  const targetBounds = finiteBounds(target?.bounding_box);
  assert(targetBounds, 'controlled dirty-topology target has no finite bounding box');
  assert(
    targetBounds.min[0] >= placement.source_bounds.max[0] + placement.margin_mm,
    'controlled dirty-topology target overlaps the imported source bounds'
  );
}

function aggregateBounds(values) {
  const bounds = values.map(finiteBounds).filter(Boolean);
  if (!bounds.length) return null;
  return {
    min: [0, 1, 2].map((axis) => Math.min(...bounds.map((entry) => entry.min[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...bounds.map((entry) => entry.max[axis])))
  };
}

function finiteBounds(value) {
  if (!value || !Array.isArray(value.min) || !Array.isArray(value.max)) return null;
  if (value.min.length !== 3 || value.max.length !== 3) return null;
  const min = value.min.map(Number);
  const max = value.max.map(Number);
  if (![...min, ...max].every(Number.isFinite)) return null;
  if (max.some((axis, index) => axis < min[index])) return null;
  return { min, max };
}

function assertFinitePoint(value, label) {
  assert(
    Array.isArray(value) && value.length === 3 && value.every((entry) => Number.isFinite(Number(entry))),
    `${label} must contain three finite coordinates`
  );
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
  assert.equal(process.env.ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION, '1', 'queue mutation must be explicitly allowed');
  assert.equal(
    process.env.ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION,
    '1',
    'direct expert queue mutation must be explicitly allowed'
  );
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
  assert.deepEqual(summary, { queue: 0, processing: 0, responses: 0, lock: false }, 'queue is not clean');
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
  assert(stat?.isFile() === true && stat.isSymbolicLink() === false, `${label} must be an existing regular file`);
  const real = await fs.realpath(absolute);
  assertWorkspacePath(real, `${label} real path`);
  return absolute;
}

async function assertSafeWorkspaceDirectory(value, label) {
  const absolute = assertWorkspacePath(value, label);
  await assertNoWorkspaceSymlinkComponents(absolute, label);
  const stat = await fs.lstat(absolute).catch(() => null);
  assert(stat?.isDirectory() === true && stat.isSymbolicLink() === false, `${label} must be an existing directory`);
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
  assert(
    relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)),
    `${label} escapes the workspace`
  );
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

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
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
    else if (arg === '--resume-pristine-working-copy') options.resumePristineWorkingCopy = true;
    else if (arg === '--resume-saved-artifact-after-document-focus-drift') {
      options.resumeSavedArtifactAfterDocumentFocusDrift = true;
    }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== 'prepare') {
    process.stderr.write(
      'Usage: node scripts/prepare-imported-dirty-topology-live-fixture.mjs prepare --runtime queue --queue-required [--source <skp>] [--run-id <id>] [--resume-pristine-working-copy | --resume-saved-artifact-after-document-focus-drift]\n'
    );
    process.exitCode = 2;
  } else {
    const recoveryOnly = options.resumeSavedArtifactAfterDocumentFocusDrift === true;
    process.stderr.write((recoveryOnly
      ? [
          '',
          '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
          '[NOTICE] CONTROLLED DIRTY-TOPOLOGY SAVED-ARTIFACT RECOVERY',
          'This run performs read-only adoption and topology verification on the',
          'already saved active artifact. It does NOT add or repair geometry.',
          '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
          ''
        ]
      : [
          '',
          '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
          '[DANGER] CONTROLLED IMPORTED DIRTY-TOPOLOGY FIXTURE PREPARATION',
          'This run WILL switch the active SketchUp document, add a deliberately',
          'non-manifold target to a workspace disposable copy, and save that copy.',
          'The operator source is read-only and the repair is NOT run in this step.',
          '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
          ''
        ]).join('\n'));
    prepareControlledImportedDirtyTopologyFixture(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
