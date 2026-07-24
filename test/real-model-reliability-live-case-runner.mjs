import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareSnapshots } from '../src/snapshot-diff.mjs';
import {
  caseRequiresImplicitSaveReopen,
  RELIABILITY_ACTIVATION_TIMEOUT_MS,
  RELIABILITY_HANDSHAKE_TTL_MS,
  MAX_RELIABILITY_ACTIVATION_SETTLE_MS,
  liveIdentityExpectation,
  publicReliabilityFailure,
  publicManifoldReport,
  inspectBooleanIsolationEvidence,
  reliabilityFailedCaseResult,
  singleManifoldTargetReport,
  snapshotForReliabilityCompare,
  stableEntityFingerprint,
  topLevelFingerprintsExcluding,
  reliabilityActivationTimeout,
  reliabilityActivationSettleMs,
  verifyLockedTransformEvidence,
  validateLiveBaseline
} from '../scripts/run-real-model-reliability-harness.mjs';
import {
  runRealModelReliabilityLiveCase,
  validateActivePreparedWorkingCopy
} from '../scripts/run-real-model-reliability-live-case.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-reliability-live-case-'));
try {
  assert.equal(
    RELIABILITY_HANDSHAKE_TTL_MS,
    300000,
    'trusted real-model reliability workflows use the existing bounded five-minute handshake maximum'
  );
  assert.equal(RELIABILITY_ACTIVATION_TIMEOUT_MS, 900000);
  assert.equal(MAX_RELIABILITY_ACTIVATION_SETTLE_MS, 60000);
  assert.equal(reliabilityActivationTimeout(3600000), 900000);
  assert.equal(reliabilityActivationTimeout(30000), 30000);
  assert.throws(() => reliabilityActivationTimeout(0), /positive finite/);
  assert.equal(reliabilityActivationSettleMs(), 0);
  assert.equal(reliabilityActivationSettleMs(15000), 15000);
  assert.throws(() => reliabilityActivationSettleMs(-1), /between 0 and 60000/);
  assert.throws(() => reliabilityActivationSettleMs(60001), /between 0 and 60000/);
  await assert.rejects(
    runRealModelReliabilityLiveCase({
      caseId: 'deep-shared-components',
      queueRequired: false,
      liveArtifactRoot: path.join(root, 'missing')
    }),
    /--runtime queue --queue-required/,
    'missing destructive opt-in must fail before artifact or queue access'
  );
  await assert.rejects(
    runRealModelReliabilityLiveCase({
      caseId: 'not-a-case',
      queueRequired: true,
      liveArtifactRoot: path.join(root, 'missing'),
      outputDir: path.join(root, 'unknown-case')
    }),
    /unknown or duplicate reliability case/,
    'unknown case must fail before preflight or queue access'
  );
  await assert.rejects(
    runRealModelReliabilityLiveCase({
      caseId: 'deep-shared-components',
      queueRequired: true,
      liveArtifactRoot: path.join(root, 'missing'),
      outputDir: path.join(root, 'missing-root')
    }),
    /artifact root is missing or is not a directory/,
    'missing artifact root must fail before queue access'
  );
  const preparationInput = path.join(root, 'preparation-input');
  const preparationOutput = path.join(root, 'preparation-output');
  await fs.mkdir(preparationInput);
  const preparationBytes = Buffer.from('small disposable SketchUp fixture for filesystem-only preparation');
  const preparationSha256 = `sha256:${crypto.createHash('sha256').update(preparationBytes).digest('hex')}`;
  const preparationContract = JSON.parse(await fs.readFile(
    path.resolve('output/live-validation/real-model-reliability-inputs/imported-dirty-topology-derived-v1/imported-dirty-topology.reliability.json'),
    'utf8'
  ));
  preparationContract.artifact_sha256 = preparationSha256;
  const preparationSource = path.join(preparationInput, 'imported-dirty-topology.skp');
  await fs.writeFile(preparationSource, preparationBytes);
  await fs.writeFile(
    path.join(preparationInput, 'imported-dirty-topology.reliability.json'),
    `${JSON.stringify(preparationContract, null, 2)}\n`,
    'utf8'
  );
  const preparationResult = await runRealModelReliabilityLiveCase({
    caseId: 'imported-dirty-topology',
    prepareOnly: true,
    liveArtifactRoot: preparationInput,
    outputDir: preparationOutput
  });
  assert.equal(preparationResult.preparation.queue_called, false);
  assert.equal(preparationResult.preparation.artifacts.source_sha256, preparationSha256);
  assert.equal(preparationResult.preparation.artifacts.working_copy_sha256, preparationSha256);
  assert.equal(await exists(preparationResult.preparation_path), true);
  assert.equal(await fs.readFile(preparationResult.launch_path, 'utf8'), preparationBytes.toString('utf8'));
  const validatedPrepared = await validateActivePreparedWorkingCopy({
    prepared: {
      corpus_case: { id: 'imported-dirty-topology' },
      artifact_path: preparationSource,
      sha256: preparationSha256
    },
    requestedPath: preparationResult.launch_path,
    outputDir: preparationOutput
  });
  assert.equal(validatedPrepared.working_path, preparationResult.launch_path);
  const outsidePrepared = path.join(root, 'outside-prepared.skp');
  await fs.writeFile(outsidePrepared, preparationBytes);
  await assert.rejects(
    validateActivePreparedWorkingCopy({
      prepared: {
        corpus_case: { id: 'imported-dirty-topology' },
        artifact_path: preparationSource,
        sha256: preparationSha256
      },
      requestedPath: outsidePrepared,
      outputDir: preparationOutput
    }),
    /must remain inside/
  );
  const snapshot = {
    totals: { groups: 1, instances: 0, faces: 6, edges: 12, vertices: 8 },
    groups: [{ name: 'fixture', faces: 6, edges: 12 }]
  };
  const runtimeCapabilities = {
    name: 'queue',
    dsl_version: 1,
    manifest_version: 'fixture-manifest',
    compatibility: { ok: true }
  };
  const normalized = snapshotForReliabilityCompare(snapshot, runtimeCapabilities);
  assert.equal(compareSnapshots(normalized, normalized, { toleranceMm: 0 }).ok, true);
  const incompatible = snapshotForReliabilityCompare(snapshot, {
    ...runtimeCapabilities,
    compatibility: { ok: false }
  });
  assert.equal(compareSnapshots(normalized, incompatible, { toleranceMm: 0 }).ok, false, 'runtime incompatibility must remain an error');
  const missingGeometry = snapshotForReliabilityCompare({ ...snapshot, groups: [] }, runtimeCapabilities);
  assert.equal(compareSnapshots(normalized, missingGeometry, { toleranceMm: 0 }).ok, false, 'runtime normalization must not hide geometry loss');
  assert.deepEqual(liveIdentityExpectation({}), { mode: 'full_recursive', recursive_limit: 100000 });
  assert.deepEqual(liveIdentityExpectation({
    identity_mode: 'complete_revision_bounded_occurrence_sample',
    recursive_limit: 25
  }), { mode: 'complete_revision_bounded_occurrence_sample', recursive_limit: 25 });
  assert.equal(
    caseRequiresImplicitSaveReopen({ tasks: ['abnormal_topology_detection', 'manifold_repair', 'recovery'] }),
    true,
    'a formal case without a named identity task must still produce the verified save/reopen artifact'
  );
  assert.equal(
    caseRequiresImplicitSaveReopen({ tasks: ['material_preservation', 'save_reopen_identity'] }),
    false,
    'a named save/reopen task must not run the invariant twice'
  );
  const dirtyReport = {
    is_manifold: false,
    method: 'sketchup_manifold_api',
    faces: 6,
    edges: 13,
    vertices: 10,
    issues: ['sketchup_manifold_false', 'boundary_edges'],
    name: 'untrusted-model-name'
  };
  assert.deepEqual(publicManifoldReport(dirtyReport), {
    is_manifold: false,
    method: 'sketchup_manifold_api',
    faces: 6,
    edges: 13,
    vertices: 10,
    issues: ['boundary_edges', 'sketchup_manifold_false']
  });
  assert.deepEqual(
    singleManifoldTargetReport({ targets: [dirtyReport] }, 'fixture check').issues,
    ['boundary_edges', 'sketchup_manifold_false']
  );
  const classifiedFailure = new Error('The SketchUp model transaction failed before commit. /Users/private/model.skp');
  classifiedFailure.code = 'MUTATION_EXECUTION_FAILED';
  classifiedFailure.retryable = false;
  classifiedFailure.next_action = { action: 'inspect_failure_then_start_new_task' };
  classifiedFailure.details = {
    phase: 'precommit_execution',
    commit_state: 'not_committed',
    abort_succeeded: true,
    operation_failure_code: 'boolean_input_not_manifold',
    untrusted_detail: '/Users/private/model.skp'
  };
  classifiedFailure.reliability_failed_task = 'manifold_repair';
  classifiedFailure.reliability_task_evidence = {
    abnormal_topology_detection: {
      detected: true,
      initial_manifold: false,
      report: publicManifoldReport(dirtyReport),
      expected_issue_codes: ['boundary_edges']
    },
    not_a_case_task: { secret: true }
  };
  assert.deepEqual(publicReliabilityFailure(classifiedFailure), {
    code: 'MUTATION_EXECUTION_FAILED',
    retryable: false,
    phase: 'precommit_execution',
    commit_state: 'not_committed',
    abort_succeeded: true,
    operation_failure_code: 'boolean_input_not_manifold',
    next_action: 'inspect_failure_then_start_new_task'
  });
  const classifiedResult = reliabilityFailedCaseResult({
    id: 'imported-dirty-topology',
    domain: 'imported_cad',
    tasks: ['abnormal_topology_detection', 'manifold_repair', 'recovery'],
    mock: { evidence_class: 'deterministic_mock_fixture', source_kind: 'generated_mock_fixture' },
    live: { status: 'external_live_required' }
  }, 42, classifiedFailure, 'queue');
  assert.equal(classifiedResult.tasks[0].status, 'passed');
  assert.equal(classifiedResult.tasks[1].status, 'failed');
  assert.equal(classifiedResult.tasks[2].status, 'failed');
  assert.deepEqual(classifiedResult.details.completed_task_ids, ['abnormal_topology_detection']);
  assert.equal(classifiedResult.details.failed_task_id, 'manifold_repair');
  assert.equal(classifiedResult.details.failure.operation_failure_code, 'boolean_input_not_manifold');
  assert.equal(classifiedResult.error.includes('/Users/'), false);
  const harnessAssertionSource = await fs.readFile(
    new URL('../scripts/run-real-model-reliability-harness.mjs', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(
    harnessAssertionSource,
    /\bassert\.(?:deepEqual|equal|ok|match|throws)\s*\(/,
    'the live harness uses its local assertion function and must not call node:assert methods on it'
  );
  assert.throws(
    () => singleManifoldTargetReport({ targets: [dirtyReport, dirtyReport] }, 'fixture check'),
    /exactly one target report/
  );
  assert.deepEqual(
    topLevelFingerprintsExcluding([
      { persistent_id: '20', name: 'support' },
      { persistent_id: '10', name: 'repair' }
    ], '10').map(([persistentId]) => persistentId),
    ['20']
  );
  assert.deepEqual(
    topLevelFingerprintsExcluding([
      { persistent_id: '30', name: 'unrelated' },
      { persistent_id: '20', name: 'tool' },
      { persistent_id: '10', name: 'target' }
    ], ['10', '20']).map(([persistentId]) => persistentId),
    ['30']
  );
  const booleanTarget = {
    id: 'boolean-target',
    persistent_id: '10',
    name: 'Boolean Target',
    entity_type: 'group',
    faces: 6,
    edges: 12,
    vertices: 8,
    material: 'Target Material',
    bounding_box: { min: [0, 0, 0], max: [100, 80, 40] }
  };
  const booleanTool = {
    id: 'boolean-tool',
    persistent_id: '20',
    name: 'Boolean Tool',
    entity_type: 'group',
    faces: 26,
    edges: 72,
    vertices: 48,
    bounding_box: { min: [30, 30, -10], max: [50, 50, 50] }
  };
  const booleanUnrelated = {
    id: 'unrelated',
    persistent_id: '30',
    name: 'Unrelated',
    entity_type: 'group',
    faces: 6,
    edges: 12,
    vertices: 8,
    bounding_box: { min: [1000, 0, 0], max: [1100, 100, 100] }
  };
  const booleanResult = {
    id: 'reliability-product-boolean-manifold-result',
    persistent_id: '40',
    name: 'Reliability_Boolean_Result',
    entity_type: 'group',
    faces: 34,
    edges: 84,
    vertices: 56,
    material: 'Target Material',
    bounding_box: { min: [0, 0, 0], max: [100, 80, 40] }
  };
  const booleanIsolation = inspectBooleanIsolationEvidence({
    beforeEntities: [booleanTarget, booleanTool, booleanUnrelated],
    afterEntities: [booleanResult, booleanTool, booleanUnrelated],
    targetBefore: booleanTarget,
    toolBefore: booleanTool,
    resultId: booleanResult.id,
    resultName: booleanResult.name
  });
  assert.equal(booleanIsolation.result_persistent_id, '40');
  assert.equal(booleanIsolation.exact_target_replaced, true);
  assert.equal(booleanIsolation.tool_preserved_unchanged, true);
  assert.equal(booleanIsolation.non_input_top_level_entities_unchanged, true);
  assert.equal(booleanIsolation.top_level_entity_count_preserved, true);
  const wrongBooleanIsolation = inspectBooleanIsolationEvidence({
    beforeEntities: [booleanTarget, booleanTool, booleanUnrelated],
    afterEntities: [booleanResult, { ...booleanTool, faces: 25 }, booleanUnrelated],
    targetBefore: booleanTarget,
    toolBefore: booleanTool,
    resultId: booleanResult.id,
    resultName: booleanResult.name
  });
  assert.equal(wrongBooleanIsolation.tool_preserved_unchanged, false);
  assert.throws(() => inspectBooleanIsolationEvidence({
    beforeEntities: [booleanTarget, booleanTool, booleanUnrelated],
    afterEntities: [booleanTarget, booleanTool, booleanUnrelated],
    targetBefore: booleanTarget,
    toolBefore: booleanTool,
    resultId: booleanResult.id,
    resultName: booleanResult.name
  }), /resolve exactly once/);
  const caseFixture = { id: 'large-fixture', tasks: [] };
  const adoptionFixture = {
    entities: [{}],
    recursive_index: [{ entity_path: 'pid:1' }, { entity_path: 'pid:2' }],
    recursive_total_seen: 200,
    recursive_truncated: true,
    model_revision_complete: true,
    snapshot: { scenes: [], material_names: [] }
  };
  const boundedExpectations = {
    minimum_entities: 1,
    minimum_recursive_entities: 200,
    minimum_scenes: 0,
    required_materials: [],
    uv_target_roles: [],
    hidden_target_roles: [],
    minimum_shared_occurrences: 0,
    identity_mode: 'complete_revision_bounded_occurrence_sample',
    recursive_limit: 2
  };
  assert.doesNotThrow(() => validateLiveBaseline(caseFixture, adoptionFixture, {}, boundedExpectations));
  assert.throws(
    () => validateLiveBaseline(caseFixture, { ...adoptionFixture, model_revision_complete: false }, {}, boundedExpectations),
    /model revision is incomplete/,
    'bounded sampling must still require a complete global revision'
  );
  assert.throws(
    () => validateLiveBaseline(caseFixture, adoptionFixture, {}, { ...boundedExpectations, identity_mode: 'full_recursive' }),
    /full recursive index is truncated/,
    'full mode must reject a truncated occurrence index'
  );
  const appearanceExpectations = {
    ...boundedExpectations,
    uv_target_roles: ['uv_target']
  };
  assert.doesNotThrow(
    () => validateLiveBaseline(
      caseFixture,
      adoptionFixture,
      { uv_target: { face_uvs: [{ id: 'front' }] } },
      appearanceExpectations
    ),
    'persisted face_uvs must satisfy the UV evidence contract'
  );
  assert.throws(
    () => validateLiveBaseline(
      caseFixture,
      adoptionFixture,
      { uv_target: { face_uvs: [] } },
      appearanceExpectations
    ),
    /has no UV evidence/,
    'an empty face_uvs array must fail closed'
  );
  const lockedTarget = { id: 'locked', persistent_id: '101', name: 'Locked', locked: true, bounding_box: { min: [0, 0, 0], max: [1, 1, 1] } };
  const guardTarget = { id: 'guard', persistent_id: '102', name: 'Guard', locked: false, bounding_box: { min: [2, 0, 0], max: [3, 1, 1] } };
  const transformBefore = { id: 'transform', persistent_id: '103', name: 'Transform', locked: false, bounding_box: { min: [4, 0, 0], max: [5, 1, 1] } };
  const transformAfter = {
    ...transformBefore,
    transform: { object_transform: { scale: [1.5, 0.75, 2], mirror: ['x'] } },
    bounding_box: { min: [3.75, 0.125, -0.5], max: [5.25, 0.875, 1.5] }
  };
  const beforeFingerprints = {
    locked: stableEntityFingerprint(lockedTarget),
    guard: stableEntityFingerprint(guardTarget),
    transform: stableEntityFingerprint(transformBefore)
  };
  const transformVerification = verifyLockedTransformEvidence({
    transformedSnapshot: { groups: [
      { ...transformAfter, transform: { object_transform: { scale: [1.5, 0.75, 2], mirror: ['x'] } } }
    ] },
    beforeFingerprints,
    beforeTransformTarget: transformBefore,
    afterTargets: { locked_target: lockedTarget, guard_target: guardTarget, transform_target: transformAfter }
  });
  assert.deepEqual(transformVerification, {
    exact_target_changed: true,
    guard_unchanged: true,
    locked_target_unchanged: true,
    scale: [1.5, 0.75, 2],
    mirror: ['x']
  });
  assert.throws(() => verifyLockedTransformEvidence({
    transformedSnapshot: { groups: [{ id: 'unrelated', transform: { object_transform: { scale: [1.5, 0.75, 2], mirror: ['x'] } } }] },
    beforeFingerprints,
    beforeTransformTarget: transformBefore,
    afterTargets: { locked_target: lockedTarget, guard_target: guardTarget, transform_target: transformAfter }
  }), /exactly one contract-bound transform target/, 'an unrelated mirrored group must not satisfy the target proof');
  assert.throws(() => verifyLockedTransformEvidence({
    transformedSnapshot: { groups: [{ ...transformAfter, transform: { object_transform: { scale: [1.5, 0.75, 2], mirror: ['x'] } } }] },
    beforeFingerprints,
    beforeTransformTarget: transformBefore,
    afterTargets: { locked_target: lockedTarget, guard_target: { ...guardTarget, material: 'unexpected' }, transform_target: transformAfter }
  }), /non-target fixture object/, 'wrong-object mutation must fail closed');
  assert.throws(() => verifyLockedTransformEvidence({
    transformedSnapshot: { groups: [{ ...transformAfter, transform: { object_transform: { scale: [1, 1, 1], mirror: ['x'] } } }] },
    beforeFingerprints,
    beforeTransformTarget: transformBefore,
    afterTargets: { locked_target: lockedTarget, guard_target: guardTarget, transform_target: transformAfter }
  }), /nonuniform scale metadata/, 'wrong transform metadata must fail closed');
  const harnessSource = await fs.readFile(path.resolve('scripts/run-real-model-reliability-harness.mjs'), 'utf8');
  assert.match(harnessSource, /waitForReliabilityModelActivation\(\{ bridge, workingPath, timeoutMs \}\)/);
  assert.match(harnessSource, /waitForReliabilityModelActivation\(\{ bridge, workingPath: savePath, timeoutMs \}\)/);
  const candidateIntakeSource = await fs.readFile(path.resolve('src/real-model-candidate-intake.mjs'), 'utf8');
  const liveCaseSource = await fs.readFile(path.resolve('scripts/run-real-model-reliability-live-case.mjs'), 'utf8');
  assert.match(candidateIntakeSource, /bridge\.get_active_model_identity\(\{ timeoutMs \}\)/);
  assert.doesNotMatch(
    harnessSource,
    /operation: 'adopt_open_model'/,
    'read-only adoption must not pay for a redundant full-revision transport guard after lightweight activation clears the pending open'
  );
  assert.match(harnessSource, /live-working/);
  assert.match(harnessSource, /document_open_mode: activePreparedModel \? 'preopened_single_window' : 'queue_open_model'/);
  assert.match(liveCaseSource, /--prepare-only/);
  assert.match(liveCaseSource, /--active-working-copy/);
  assert.match(harnessSource, /\[OPERATOR SETTLE\]/);
  assert.equal(await exists(path.join(root, 'state')), false);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    default_runtime: 'queue_only',
    explicit_queue_opt_in_required: true,
    unknown_case_fails_before_preflight: true,
    missing_root_fails_before_queue: true,
    live_queue_called: false,
    runtime_metadata_normalized_from_fresh_capabilities: true,
    runtime_incompatibility_fail_closed: true,
    geometry_loss_fail_closed: true,
    mdi_activation_wait_before_adoption: true,
    mdi_activation_wait_after_reopen: true,
    bounded_sample_requires_complete_global_revision: true,
    full_recursive_rejects_truncation: true,
    face_uv_payload_satisfies_uv_contract: true,
    empty_face_uv_payload_fails_closed: true,
    implicit_verified_artifact_for_dirty_topology: true,
    topology_reports_are_structured_and_sanitized: true,
    lightweight_activation_clears_matching_pending_open: true,
    redundant_guarded_read_only_adoption_removed: true,
    filesystem_only_preparation_queue_called: false,
    single_window_active_copy_mode: true,
    active_copy_allowed_root_enforced: true,
    explicit_post_activation_operator_settle: true,
    tests: 67
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
