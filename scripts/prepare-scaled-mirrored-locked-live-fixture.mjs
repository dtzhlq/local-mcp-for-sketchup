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
  installReliabilityInterruptCleanup
} from './run-real-model-reliability-harness.mjs';

export const CONTROLLED_TRANSFORM_FIXTURE_VERSION = 'controlled-transform-live-fixture.v1';
export const FIXTURE_IDS = Object.freeze({
  locked_target: 'reliability-locked-target',
  guard_target: 'reliability-guard-target',
  transform_target: 'reliability-transform-target'
});
export const FIXTURE_NAMES = Object.freeze({
  locked_target: 'ALMA_Reliability_Locked_Target',
  guard_target: 'ALMA_Reliability_Guard_Target',
  transform_target: 'ALMA_Reliability_Transform_Target'
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourcePath = path.join(repoRoot, 'test', '模型', '场地模型.skp');
const defaultPreparationRoot = path.join(repoRoot, 'output', 'live-validation', 'real-model-reliability-preparation', 'scaled-mirrored-locked-derived-v1');
const defaultArtifactRoot = path.join(repoRoot, 'output', 'live-validation', 'real-model-reliability-inputs', 'scaled-mirrored-locked-derived-v1');

export function controlledTransformFixtureOperations(origin = [0, 0, 0]) {
  const [x, y, z] = origin.map(Number);
  assert([x, y, z].every(Number.isFinite), 'fixture origin must contain finite numbers');
  return [
    { op: 'material', name: 'ALMA_Reliability_Fixture', color: '#d47b28' },
    { op: 'box', id: FIXTURE_IDS.locked_target, name: FIXTURE_NAMES.locked_target, origin: [x, y, z], size: [400, 300, 250], material: 'ALMA_Reliability_Fixture' },
    { op: 'box', id: FIXTURE_IDS.guard_target, name: FIXTURE_NAMES.guard_target, origin: [x + 600, y, z], size: [400, 300, 250], material: 'ALMA_Reliability_Fixture' },
    { op: 'box', id: FIXTURE_IDS.transform_target, name: FIXTURE_NAMES.transform_target, origin: [x + 1200, y, z], size: [400, 300, 250], material: 'ALMA_Reliability_Fixture' }
  ];
}

export function buildScaledMirroredLockedContract({ artifactSha256, entities, recursiveTotal, targets }) {
  assert(/^sha256:[0-9a-f]{64}$/.test(artifactSha256));
  const identityMode = recursiveTotal <= 100000 ? 'full_recursive' : 'complete_revision_bounded_occurrence_sample';
  return {
    version: 'real-model-reliability-live-case.v1',
    kind: 'real_model_reliability_live_case',
    case_id: 'scaled-mirrored-locked',
    artifact_file: 'scaled-mirrored-locked.skp',
    artifact_sha256: artifactSha256,
    targets: Object.fromEntries(Object.entries(targets).map(([role, entity]) => [role, {
      persistent_id: String(entity.persistent_id)
    }])),
    expectations: {
      minimum_entities: entities,
      minimum_recursive_entities: recursiveTotal,
      minimum_scenes: 0,
      required_materials: [],
      uv_target_roles: [],
      hidden_target_roles: [],
      minimum_shared_occurrences: 0,
      boolean_operation: null,
      identity_mode: identityMode,
      recursive_limit: 100000
    }
  };
}

export async function prepareControlledTransformFixture({
  runtime = 'queue',
  queueRequired = false,
  sourcePath = defaultSourcePath,
  preparationRoot = defaultPreparationRoot,
  artifactRoot = defaultArtifactRoot,
  timeoutMs = 600000,
  runId = timestampId()
} = {}) {
  assertExplicitQueue(runtime, queueRequired);
  assertLiveExecutionPolicy();
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
  const unlockedPath = path.join(runDir, 'fixture-unlocked.skp');
  const finalArtifactPath = await assertSafeWorkspaceOutputPath(path.join(absoluteArtifactRoot, 'scaled-mirrored-locked.skp'), 'final artifact');
  const finalContractPath = await assertSafeWorkspaceOutputPath(path.join(absoluteArtifactRoot, 'scaled-mirrored-locked.reliability.json'), 'final contract');
  await assertMissing(finalArtifactPath, 'final artifact');
  await assertMissing(finalContractPath, 'final contract');

  const sourceSha256 = await sha256File(absoluteSourcePath);
  await fs.copyFile(absoluteSourcePath, workingPath, fsConstants.COPYFILE_EXCL);
  assert.equal(await sha256File(workingPath), sourceSha256, 'disposable source copy is not byte-exact');

  const bridge = new SketchUpBridge({});
  assertBridgePolicy(bridge);
  const uninstallCleanup = installReliabilityInterruptCleanup();
  try {
    assertQueueIdle(await bridge.queue_diagnostics({ timeoutMs }));
    const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
    await bridge.open_model({
      runtime: 'queue',
      timeoutMs,
      path: workingPath,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    await waitForDisposableModelActivation({ bridge, workingPath, timeoutMs });
    const before = await bridge.adopt_open_model({
      runtime: 'queue',
      timeoutMs,
      read_only: true,
      recursive: false,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    assert.equal(before.model_revision_complete, true);
    const origin = fixtureOrigin(before.snapshot);
    const operations = controlledTransformFixtureOperations(origin);
    const built = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({ version: 1, units: 'mm', operations }),
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const created = resolveFixtureTargets(built.snapshot?.groups || []);
    for (const entity of Object.values(created)) assert.equal(entity.locked === true, false, 'new fixture targets must begin unlocked');
    await bridge.save_model({
      runtime: 'queue',
      timeoutMs,
      path: unlockedPath,
      keep_session: true,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const selected = await bridge.set_selection({
      runtime: 'queue',
      timeoutMs,
      mode: 'replace',
      targets: [FIXTURE_IDS.locked_target],
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    assert.equal(selected.selection.length, 1, 'locked fixture target was not selected');
    assert.equal(
      selected.selection[0].id === FIXTURE_IDS.locked_target || selected.selection[0].name === FIXTURE_NAMES.locked_target,
      true,
      'selection resolved to the wrong fixture target'
    );
    const activeAfterPrepare = await bridge.create_queue_handshake({ timeoutMs });
    const activePathAfterPrepare = activeAfterPrepare.session_contract?.model_identity?.source_path || null;
    assert.equal(
      [workingPath, unlockedPath].some((candidate) => samePath(activePathAfterPrepare, candidate)),
      true,
      'prepared fixture did not remain the active working/checkpoint document'
    );
    const statePath = path.join(runDir, 'preparation-state.v1.json');
    const state = {
      version: CONTROLLED_TRANSFORM_FIXTURE_VERSION,
      kind: 'controlled_transform_live_fixture_preparation',
      status: 'awaiting_native_lock',
      prepared_at: new Date().toISOString(),
      source: { path: absoluteSourcePath, sha256: sourceSha256 },
      working_path: workingPath,
      active_path_after_prepare: activePathAfterPrepare,
      unlocked_checkpoint: { path: unlockedPath, sha256: await sha256File(unlockedPath) },
      final_artifact_path: finalArtifactPath,
      final_contract_path: finalContractPath,
      fixture_origin_mm: origin,
      fixture_ids: FIXTURE_IDS,
      fixture_names: FIXTURE_NAMES,
      model_revision_before: before.model_revision,
      model_revision_after_fixture_insert: built.snapshot?.model_revision || null,
      runtime_attestation: runtimeAttestation(capabilities.runtime),
      native_lock_instruction: 'Use SketchUp native Lock on the single selected ALMA_Reliability_Locked_Target, then run finalize.',
      original_bytes_unchanged: await sha256File(absoluteSourcePath) === sourceSha256,
      queue_clean: queueSummary(await bridge.queue_diagnostics({ timeoutMs }))
    };
    assertQueueSummaryClean(state.queue_clean);
    await validateFixtureDocument(state, 'preparation state');
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { state, state_path: statePath };
  } finally {
    uninstallCleanup();
    await cleanupReliabilityQueueArtifacts(process.pid);
  }
}

export async function finalizeControlledTransformFixture({
  runtime = 'queue',
  queueRequired = false,
  statePath,
  timeoutMs = 600000
} = {}) {
  assertExplicitQueue(runtime, queueRequired);
  assertLiveExecutionPolicy();
  assert(typeof statePath === 'string' && statePath.trim(), '--state is required for finalize');
  const absoluteStatePath = await assertSafeWorkspaceExistingFile(statePath, 'preparation state');
  const state = JSON.parse(await fs.readFile(absoluteStatePath, 'utf8'));
  await validateFixtureDocument(state, 'preparation state');
  assert.deepEqual(state.fixture_ids, FIXTURE_IDS, 'fixture ids drifted');
  assert.deepEqual(state.fixture_names, FIXTURE_NAMES, 'fixture names drifted');
  const sourcePath = await assertSafeWorkspaceExistingFile(state.source.path, 'operator source model');
  const unlockedCheckpointPath = await assertSafeWorkspaceExistingFile(state.unlocked_checkpoint.path, 'unlocked checkpoint');
  const workingPath = await assertSafeWorkspaceExistingFile(state.working_path, 'working copy');
  const activePathAfterPrepare = state.active_path_after_prepare
    ? await assertSafeWorkspaceExistingFile(state.active_path_after_prepare, 'prepared active model')
    : null;
  const finalArtifactPath = await assertSafeWorkspaceOutputPath(state.final_artifact_path, 'final artifact');
  const finalContractPath = await assertSafeWorkspaceOutputPath(state.final_contract_path, 'final contract');
  assert.equal(path.basename(finalArtifactPath), 'scaled-mirrored-locked.skp', 'unexpected final artifact filename');
  assert.equal(path.basename(finalContractPath), 'scaled-mirrored-locked.reliability.json', 'unexpected final contract filename');
  assert.equal(path.dirname(finalArtifactPath), path.dirname(finalContractPath), 'final artifact and contract must share one directory');
  assert.equal(await sha256File(sourcePath), state.source.sha256, 'operator source model changed before finalization');
  assert.equal(await sha256File(unlockedCheckpointPath), state.unlocked_checkpoint.sha256, 'unlocked checkpoint changed before finalization');
  await assertMissing(finalArtifactPath, 'final artifact');
  await assertMissing(finalContractPath, 'final contract');
  const reportPath = await assertSafeWorkspaceOutputPath(path.join(path.dirname(absoluteStatePath), 'finalization-report.v1.json'), 'finalization report');
  await assertMissing(reportPath, 'finalization report');
  const bridge = new SketchUpBridge({});
  assertBridgePolicy(bridge);
  const uninstallCleanup = installReliabilityInterruptCleanup();
  try {
    assertQueueIdle(await bridge.queue_diagnostics({ timeoutMs }));
    const handshake = await bridge.create_queue_handshake({ timeoutMs });
    const allowedActivePaths = [activePathAfterPrepare, workingPath, unlockedCheckpointPath].filter(Boolean);
    assert.equal(
      allowedActivePaths.some((candidate) => samePath(handshake.session_contract?.model_identity?.source_path, candidate)),
      true,
      'the prepared working/checkpoint copy is not the active SketchUp document'
    );
    const beforeSave = await bridge.adopt_open_model({
      runtime: 'queue',
      timeoutMs,
      read_only: true,
      recursive: true,
      recursive_limit: 100000,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const beforeTargets = resolveFixtureTargets(beforeSave.entities || []);
    assert.equal(beforeTargets.locked_target.locked, true, 'native SketchUp lock was not observed on the selected target');
    assert.equal(beforeTargets.guard_target.locked, false, 'guard target must remain unlocked');
    assert.equal(beforeTargets.transform_target.locked, false, 'transform target must remain unlocked');

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
    const finalized = await bridge.adopt_open_model({
      runtime: 'queue',
      timeoutMs,
      read_only: true,
      recursive: true,
      recursive_limit: 100000,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    const finalTargets = resolveFixtureTargets(finalized.entities || []);
    assert.equal(finalTargets.locked_target.locked, true, 'native lock did not survive fixture save/reopen');
    assert.equal(finalized.model_revision_complete, true);
    const recursiveTotal = Number(finalized.recursive_total_seen ?? finalized.recursive_index.length);
    const artifactSha256 = `sha256:${await sha256File(finalArtifactPath)}`;
    const contract = buildScaledMirroredLockedContract({
      artifactSha256,
      entities: finalized.entities.length,
      recursiveTotal,
      targets: finalTargets
    });
    await validateContract(contract);
    await fs.writeFile(finalContractPath, `${JSON.stringify(contract, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    assert.equal(await sha256File(sourcePath), state.source.sha256, 'operator source model changed during fixture preparation');
    const report = {
      version: CONTROLLED_TRANSFORM_FIXTURE_VERSION,
      kind: 'controlled_transform_live_fixture_finalization',
      status: 'ready_for_formal_live_case',
      finalized_at: new Date().toISOString(),
      derivation_class: 'controlled_fixture_overlay_on_user_authorized_real_model_copy',
      source: { sha256: state.source.sha256, original_bytes_unchanged: true },
      artifact: {
        path: finalArtifactPath,
        sha256: artifactSha256,
        bytes: (await fs.stat(finalArtifactPath)).size
      },
      contract: {
        path: finalContractPath,
        sha256: `sha256:${await sha256File(finalContractPath)}`
      },
      native_lock: {
        target_persistent_id: String(finalTargets.locked_target.persistent_id),
        observed_before_save: true,
        observed_after_reopen: true
      },
      targets: Object.fromEntries(Object.entries(finalTargets).map(([role, entity]) => [role, {
        persistent_id: String(entity.persistent_id),
        name_untrusted: entity.name,
        locked: entity.locked === true
      }])),
      identity: {
        model_revision: finalized.model_revision,
        model_revision_complete: finalized.model_revision_complete === true,
        recursive_total: recursiveTotal,
        recursive_materialized: finalized.recursive_index.length,
        recursive_truncated: finalized.recursive_truncated === true
      },
      queue_clean: queueSummary(await bridge.queue_diagnostics({ timeoutMs })),
      release_acceptance: false
    };
    assertQueueSummaryClean(report.queue_clean);
    assert.equal(report.native_lock.target_persistent_id, report.targets.locked_target.persistent_id, 'native lock target binding drifted');
    await validateFixtureDocument(report, 'finalization report');
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return { report, report_path: reportPath };
  } finally {
    uninstallCleanup();
    await cleanupReliabilityQueueArtifacts(process.pid);
  }
}

function resolveFixtureTargets(entities) {
  const targets = {};
  for (const [role, fixtureId] of Object.entries(FIXTURE_IDS)) {
    const matches = entities.filter((entity) => entity.id === fixtureId || entity.name === FIXTURE_NAMES[role]);
    assert.equal(matches.length, 1, `${role} must resolve exactly once; got ${matches.length}`);
    assert(/^[1-9]\d*$/.test(String(matches[0].persistent_id || '')), `${role} is missing a decimal SketchUp persistent_id`);
    targets[role] = matches[0];
  }
  return targets;
}

function fixtureOrigin(snapshot) {
  const bounds = snapshot?.bounding_box || snapshot?.bounds || snapshot?.model_info?.bounding_box || {};
  const min = Array.isArray(bounds.min) ? bounds.min.map(Number) : [0, 0, 0];
  const max = Array.isArray(bounds.max) ? bounds.max.map(Number) : [0, 0, 0];
  if (![...min, ...max].every(Number.isFinite)) return [10000, 10000, 0];
  const span = Math.max(1000, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return [roundMm(max[0] + span * 0.1 + 1000), roundMm(max[1] + span * 0.1 + 1000), roundMm(min[2])];
}

function roundMm(value) {
  return Math.round(value * 1000) / 1000;
}

async function validateContract(contract) {
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'schema', 'real-model-reliability-live-case-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(contract), true, JSON.stringify(validate.errors, null, 2));
}

export async function validateFixtureDocument(document, label = 'controlled transform fixture document') {
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'schema', 'controlled-transform-live-fixture-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(document), true, `${label} is invalid: ${JSON.stringify(validate.errors, null, 2)}`);
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
  assert.equal(process.env.ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES?.split(',').map((value) => value.trim()).includes('queue'), true, 'queue runtime must be explicitly allowed');
  assert.equal(process.env.ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION, '1', 'queue mutation must be explicitly allowed');
  assert.equal(process.env.ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION, '1', 'direct expert queue mutation must be explicitly allowed');
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
  assert(absolute === repoRoot || absolute.startsWith(`${repoRoot}${path.sep}`), `${label} must stay inside the workspace`);
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
  assert(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)), `${label} escapes the workspace`);
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

function samePath(left, right) {
  return typeof left === 'string' && path.resolve(left) === path.resolve(right);
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
    else if (arg === '--state') options.statePath = take();
    else if (arg === '--timeout-ms') options.timeoutMs = Number(take());
    else if (arg === '--run-id') options.runId = take();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (!['prepare', 'finalize'].includes(options.command)) {
    process.stderr.write('Usage:\n  node scripts/prepare-scaled-mirrored-locked-live-fixture.mjs prepare --runtime queue --queue-required [--source <skp>] [--run-id <id>]\n  node scripts/prepare-scaled-mirrored-locked-live-fixture.mjs finalize --runtime queue --queue-required --state <preparation-state.v1.json>\n');
    process.exitCode = 2;
  } else {
    process.stderr.write([
      '',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      `[DANGER] CONTROLLED REAL-MODEL FIXTURE ${options.command.toUpperCase()}`,
      'This run WILL switch the active SketchUp document and modify/save only',
      'workspace-contained disposable copies. The operator source is read-only.',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      ''
    ].join('\n'));
    const promise = options.command === 'prepare'
      ? prepareControlledTransformFixture(options)
      : finalizeControlledTransformFixture(options);
    promise.then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
  }
}
