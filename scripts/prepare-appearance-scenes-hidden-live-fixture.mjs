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

export const CONTROLLED_APPEARANCE_FIXTURE_VERSION = 'controlled-appearance-live-fixture.v1';
export const APPEARANCE_FIXTURE_IDS = Object.freeze({
  uv_target: 'reliability-appearance-uv-target',
  hidden_target: 'reliability-appearance-hidden-target'
});
export const APPEARANCE_FIXTURE_NAMES = Object.freeze({
  uv_target: 'ALMA_Reliability_Appearance_UV_Target',
  hidden_target: 'ALMA_Reliability_Appearance_Hidden_Target'
});
export const APPEARANCE_MATERIAL_NAME = 'ALMA_Reliability_Appearance_Texture';
export const APPEARANCE_SCENE_NAME = 'ALMA_Reliability_Appearance_Scene';
export const APPEARANCE_UV_ID = 'reliability-appearance-face-uv';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourcePath = path.join(repoRoot, 'test', '模型', 'Fire Escape.skp');
const defaultTexturePath = path.join(repoRoot, 'test', 'ScreenShot_2026-04-30_165028_429.png');
const defaultPreparationRoot = path.join(repoRoot, 'output', 'live-validation', 'real-model-reliability-preparation', 'appearance-scenes-hidden-derived-v1');
const defaultArtifactRoot = path.join(repoRoot, 'output', 'live-validation', 'real-model-reliability-inputs', 'appearance-scenes-hidden-derived-v1');

export function controlledAppearanceFixtureOperations(origin = [0, 0, 0], texturePath = defaultTexturePath) {
  const [x, y, z] = origin.map(Number);
  assert([x, y, z].every(Number.isFinite), 'fixture origin must contain finite numbers');
  assert(typeof texturePath === 'string' && texturePath.trim(), 'fixture texture path is required');
  return [
    {
      op: 'material',
      name: APPEARANCE_MATERIAL_NAME,
      color: '#6a8fc8',
      texture: { path: path.resolve(texturePath), width: 1200, height: 800 }
    },
    {
      op: 'box',
      id: APPEARANCE_FIXTURE_IDS.uv_target,
      name: APPEARANCE_FIXTURE_NAMES.uv_target,
      origin: [x, y, z],
      size: [1200, 800, 40],
      material: APPEARANCE_MATERIAL_NAME
    },
    {
      op: 'face_uv',
      target_id: APPEARANCE_FIXTURE_IDS.uv_target,
      uv_id: APPEARANCE_UV_ID,
      face_selector: { type: 'index', value: 0 },
      projection: 'explicit',
      material: APPEARANCE_MATERIAL_NAME,
      uv: [[0, 0], [2, 0], [2, 1], [0, 1]]
    },
    {
      op: 'box',
      id: APPEARANCE_FIXTURE_IDS.hidden_target,
      name: APPEARANCE_FIXTURE_NAMES.hidden_target,
      origin: [x + 1600, y, z],
      size: [500, 500, 500],
      material: APPEARANCE_MATERIAL_NAME
    },
    {
      op: 'set_visibility',
      target_id: APPEARANCE_FIXTURE_IDS.hidden_target,
      visible: false
    },
    {
      op: 'scene',
      name: APPEARANCE_SCENE_NAME
    }
  ];
}

export function buildAppearanceScenesHiddenContract({
  artifactSha256,
  entities,
  recursiveTotal,
  targets
}) {
  assert(/^sha256:[0-9a-f]{64}$/.test(artifactSha256));
  assert(Number.isInteger(entities) && entities >= 2);
  assert(Number.isInteger(recursiveTotal) && recursiveTotal >= entities);
  const identityMode = recursiveTotal <= 100000 ? 'full_recursive' : 'complete_revision_bounded_occurrence_sample';
  return {
    version: 'real-model-reliability-live-case.v1',
    kind: 'real_model_reliability_live_case',
    case_id: 'appearance-scenes-hidden',
    artifact_file: 'appearance-scenes-hidden.skp',
    artifact_sha256: artifactSha256,
    targets: Object.fromEntries(Object.entries(targets).map(([role, entity]) => [role, {
      persistent_id: String(entity.persistent_id)
    }])),
    expectations: {
      minimum_entities: entities,
      minimum_recursive_entities: recursiveTotal,
      minimum_scenes: 1,
      required_materials: [APPEARANCE_MATERIAL_NAME],
      uv_target_roles: ['uv_target'],
      hidden_target_roles: ['hidden_target'],
      minimum_shared_occurrences: 0,
      boolean_operation: null,
      identity_mode: identityMode,
      recursive_limit: 100000
    }
  };
}

export async function prepareControlledAppearanceFixture({
  runtime = 'queue',
  queueRequired = false,
  sourcePath = defaultSourcePath,
  texturePath = defaultTexturePath,
  preparationRoot = defaultPreparationRoot,
  artifactRoot = defaultArtifactRoot,
  timeoutMs = 600000,
  runId = timestampId()
} = {}) {
  assertExplicitQueue(runtime, queueRequired);
  assertLiveExecutionPolicy();
  const absoluteSourcePath = await assertSafeWorkspaceExistingFile(sourcePath, 'source model');
  const absoluteTexturePath = await assertSafeWorkspaceExistingFile(texturePath, 'texture image');
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
    path.join(absoluteArtifactRoot, 'appearance-scenes-hidden.skp'),
    'final artifact'
  );
  const finalContractPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'appearance-scenes-hidden.reliability.json'),
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
  const textureSha256 = await sha256File(absoluteTexturePath);
  await fs.copyFile(absoluteSourcePath, workingPath, fsConstants.COPYFILE_EXCL);
  assert.equal(await sha256File(workingPath), sourceSha256, 'disposable source copy is not byte-exact');

  const bridge = new SketchUpBridge({});
  assertBridgePolicy(bridge);
  const uninstallCleanup = installReliabilityInterruptCleanup();
  try {
    assertQueueIdle(await bridge.queue_diagnostics({ timeoutMs }));
    const capabilities = await bridge.get_capabilities({ runtime: 'queue', timeoutMs });
    assert.equal(capabilities.runtime.compatibility?.ok, true, 'live runtime is incompatible');
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
    const operations = controlledAppearanceFixtureOperations(origin, absoluteTexturePath);
    const built = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({ version: 1, units: 'mm', operations }),
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    assertNoAppearanceWarnings(built.snapshot);
    const builtTargets = resolveAppearanceTargets(built.snapshot?.groups || []);
    assertAppearanceSnapshot(built.snapshot, builtTargets);

    const afterBuild = await bridge.adopt_open_model({
      runtime: 'queue',
      timeoutMs,
      read_only: true,
      recursive: true,
      recursive_limit: 100000,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    assert.equal(afterBuild.model_revision_complete, true);
    const adoptedTargets = resolveAppearanceTargets(afterBuild.entities || []);
    assertAppearanceSnapshot(afterBuild.snapshot, adoptedTargets);
    assert.equal(afterBuild.recursive_truncated, false, 'controlled appearance fixture must fit the full-recursive contract');

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
    assert.equal(finalized.model_revision_complete, true);
    assert.equal(finalized.recursive_truncated, false);
    assertNoAppearanceWarnings(finalized.snapshot);
    const finalTargets = resolveAppearanceTargets(finalized.entities || []);
    assertAppearanceSnapshot(finalized.snapshot, finalTargets);
    const recursiveTotal = Number(finalized.recursive_total_seen ?? finalized.recursive_index.length);
    assert.equal(finalized.recursive_index.length, recursiveTotal, 'full-recursive fixture index is incomplete');

    const artifactSha256 = `sha256:${await sha256File(finalArtifactPath)}`;
    const contract = buildAppearanceScenesHiddenContract({
      artifactSha256,
      entities: finalized.entities.length,
      recursiveTotal,
      targets: finalTargets
    });
    await validateContract(contract);
    await fs.writeFile(finalContractPath, `${JSON.stringify(contract, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    assert.equal(await sha256File(absoluteSourcePath), sourceSha256, 'operator source model changed during fixture preparation');
    assert.equal(await sha256File(absoluteTexturePath), textureSha256, 'texture input changed during fixture preparation');

    const material = finalized.snapshot.materials.find((entry) => entry.name === APPEARANCE_MATERIAL_NAME);
    const scene = finalized.snapshot.scenes.find((entry) =>
      (typeof entry === 'string' ? entry : entry?.name) === APPEARANCE_SCENE_NAME);
    const report = {
      version: CONTROLLED_APPEARANCE_FIXTURE_VERSION,
      kind: 'controlled_appearance_live_fixture_finalization',
      status: 'ready_for_formal_live_case',
      finalized_at: new Date().toISOString(),
      derivation_class: 'controlled_fixture_overlay_on_user_authorized_real_model_copy',
      source: {
        sha256: sourceSha256,
        original_bytes_unchanged: true
      },
      texture: {
        sha256: textureSha256,
        input_bytes_unchanged: true,
        embedded_material_texture_observed: Boolean(material?.texture)
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
      targets: Object.fromEntries(Object.entries(finalTargets).map(([role, entity]) => [role, {
        persistent_id: String(entity.persistent_id),
        name_untrusted: entity.name,
        visible: entity.visible !== false,
        face_uv_payload_count: Array.isArray(entity.face_uvs) ? entity.face_uvs.length : 0
      }])),
      appearance: {
        material_name_untrusted: APPEARANCE_MATERIAL_NAME,
        scene_name_untrusted: typeof scene === 'string' ? scene : scene?.name,
        uv_id: APPEARANCE_UV_ID,
        face_uv_operation_applied_without_warning: true,
        face_uv_payload_persisted: true,
        textured_material_persisted: Boolean(material?.texture),
        hidden_target_persisted: finalTargets.hidden_target.visible === false
      },
      identity: {
        model_revision: finalized.model_revision,
        model_revision_complete: finalized.model_revision_complete === true,
        recursive_total: recursiveTotal,
        recursive_materialized: finalized.recursive_index.length,
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

export function resolveAppearanceTargets(entities) {
  const targets = {};
  for (const [role, fixtureId] of Object.entries(APPEARANCE_FIXTURE_IDS)) {
    const matches = entities.filter((entity) =>
      entity.id === fixtureId || entity.name === APPEARANCE_FIXTURE_NAMES[role]);
    assert.equal(matches.length, 1, `${role} must resolve exactly once; got ${matches.length}`);
    assert(/^[1-9]\d*$/.test(String(matches[0].persistent_id || '')), `${role} is missing a decimal SketchUp persistent_id`);
    targets[role] = matches[0];
  }
  return targets;
}

export function assertAppearanceSnapshot(snapshot, targets) {
  assert(snapshot && typeof snapshot === 'object');
  assert(targets?.uv_target && targets?.hidden_target);
  assert.equal(targets.hidden_target.visible, false, 'hidden target is visible');
  assert.equal(Array.isArray(targets.uv_target.face_uvs), true, 'UV target has no face_uv payload');
  assert.equal(targets.uv_target.face_uvs.length, 1, 'UV target must contain exactly one face_uv payload');
  assert.equal(targets.uv_target.face_uvs[0].id, APPEARANCE_UV_ID, 'UV payload id drifted');
  assert.equal(targets.uv_target.face_uvs[0].material, APPEARANCE_MATERIAL_NAME, 'UV payload material drifted');
  assert.equal(targets.uv_target.material, APPEARANCE_MATERIAL_NAME, 'UV target material drifted');
  const material = (snapshot.materials || []).find((entry) => entry.name === APPEARANCE_MATERIAL_NAME);
  assert(material, 'appearance material is missing');
  assert(material.texture, 'appearance material texture is missing');
  assert.equal((snapshot.material_names || []).includes(APPEARANCE_MATERIAL_NAME), true, 'appearance material name is missing');
  assert.equal(
    (snapshot.scenes || []).some((entry) => (typeof entry === 'string' ? entry : entry?.name) === APPEARANCE_SCENE_NAME),
    true,
    'appearance Scene is missing'
  );
  return true;
}

function assertNoAppearanceWarnings(snapshot) {
  const appearanceWarning = (snapshot?.warnings || []).find((entry) =>
    ['geometry.texture_position_failed', 'material.missing_texture'].includes(entry?.code));
  assert.equal(appearanceWarning, undefined, `appearance fixture warning: ${appearanceWarning?.code || 'unknown'}`);
}

function fixtureOrigin(snapshot) {
  const bounds = snapshot?.bounding_box || snapshot?.bounds || {};
  const min = Array.isArray(bounds.min) ? bounds.min.map(Number) : [0, 0, 0];
  const max = Array.isArray(bounds.max) ? bounds.max.map(Number) : [0, 0, 0];
  if (![...min, ...max].every(Number.isFinite)) return [10000, 10000, 0];
  const span = Math.max(1000, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return [
    roundMm(max[0] + span * 0.1 + 1000),
    roundMm(max[1] + span * 0.1 + 1000),
    roundMm(min[2])
  ];
}

function roundMm(value) {
  return Math.round(value * 1000) / 1000;
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
    path.join(repoRoot, 'schema', 'controlled-appearance-live-fixture-v1.schema.json'),
    'utf8'
  ));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(document), true, JSON.stringify(validate.errors, null, 2));
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
    boolean_operations_sha256: runtime.boolean_operations_sha256 || null,
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
    else if (arg === '--texture') options.texturePath = take();
    else if (arg === '--runtime') options.runtime = take();
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--preparation-root') options.preparationRoot = take();
    else if (arg === '--artifact-root') options.artifactRoot = take();
    else if (arg === '--timeout-ms') options.timeoutMs = Number(take());
    else if (arg === '--run-id') options.runId = take();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== 'prepare') {
    process.stderr.write('Usage: node scripts/prepare-appearance-scenes-hidden-live-fixture.mjs prepare --runtime queue --queue-required [--source <skp>] [--texture <image>] [--run-id <id>]\n');
    process.exitCode = 2;
  } else {
    process.stderr.write([
      '',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      '[DANGER] CONTROLLED APPEARANCE REAL-MODEL FIXTURE PREPARATION',
      'This run WILL switch the active SketchUp document and modify/save only',
      'workspace-contained disposable copies. The operator source is read-only.',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      ''
    ].join('\n'));
    prepareControlledAppearanceFixture(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
