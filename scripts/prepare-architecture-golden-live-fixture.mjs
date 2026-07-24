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

export const CONTROLLED_ARCHITECTURE_FIXTURE_VERSION = 'controlled-architecture-live-fixture.v1';
export const ARCHITECTURE_MATERIAL_NAME = 'ALMA_Reliability_Architecture_Material';
export const ARCHITECTURE_SCENE_NAME = 'ALMA_Reliability_Architecture_Scene';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourcePath = path.join(repoRoot, 'test', '模型', 'Fire Escape.skp');
const defaultPreparationRoot = path.join(
  repoRoot,
  'output',
  'live-validation',
  'real-model-reliability-preparation',
  'architecture-golden-derived-v1'
);
const defaultArtifactRoot = path.join(
  repoRoot,
  'output',
  'live-validation',
  'real-model-reliability-inputs',
  'architecture-golden-derived-v1'
);

export function controlledArchitectureFixtureOperations() {
  return [
    {
      op: 'material',
      name: ARCHITECTURE_MATERIAL_NAME,
      color: '#b8a68f'
    },
    {
      op: 'scene',
      name: ARCHITECTURE_SCENE_NAME
    }
  ];
}

export function buildArchitectureGoldenContract({
  artifactSha256,
  entities,
  recursiveTotal
}) {
  assert(/^sha256:[0-9a-f]{64}$/.test(artifactSha256));
  assert(Number.isInteger(entities) && entities >= 1);
  assert(Number.isInteger(recursiveTotal) && recursiveTotal >= entities);
  const identityMode = recursiveTotal <= 100000
    ? 'full_recursive'
    : 'complete_revision_bounded_occurrence_sample';
  return {
    version: 'real-model-reliability-live-case.v1',
    kind: 'real_model_reliability_live_case',
    case_id: 'architecture-golden',
    artifact_file: 'architecture-building.skp',
    artifact_sha256: artifactSha256,
    targets: {},
    expectations: {
      minimum_entities: entities,
      minimum_recursive_entities: recursiveTotal,
      minimum_scenes: 1,
      required_materials: [ARCHITECTURE_MATERIAL_NAME],
      uv_target_roles: [],
      hidden_target_roles: [],
      minimum_shared_occurrences: 0,
      boolean_operation: null,
      identity_mode: identityMode,
      recursive_limit: 100000
    }
  };
}

export function assertArchitectureSnapshot(snapshot) {
  assert(snapshot && typeof snapshot === 'object');
  const material = (snapshot.materials || []).find((entry) => entry.name === ARCHITECTURE_MATERIAL_NAME);
  assert(material, 'controlled architecture material is missing');
  assert.equal(
    (snapshot.material_names || []).includes(ARCHITECTURE_MATERIAL_NAME),
    true,
    'controlled architecture material name is missing'
  );
  assert.equal(
    (snapshot.scenes || []).some((entry) =>
      (typeof entry === 'string' ? entry : entry?.name) === ARCHITECTURE_SCENE_NAME),
    true,
    'controlled architecture Scene is missing'
  );
  return true;
}

export async function prepareControlledArchitectureFixture({
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
  const finalArtifactPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'architecture-building.skp'),
    'final artifact'
  );
  const finalContractPath = await assertSafeWorkspaceOutputPath(
    path.join(absoluteArtifactRoot, 'architecture-building.reliability.json'),
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
      recursive: true,
      recursive_limit: 100000,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    assert.equal(before.model_revision_complete, true);
    assert.equal(before.recursive_truncated, false, 'architecture fixture requires full recursive source identity');
    assert.equal(
      (before.snapshot.material_names || []).includes(ARCHITECTURE_MATERIAL_NAME),
      false,
      'source already contains the controlled architecture material'
    );
    assert.equal(
      (before.snapshot.scenes || []).some((entry) =>
        (typeof entry === 'string' ? entry : entry?.name) === ARCHITECTURE_SCENE_NAME),
      false,
      'source already contains the controlled architecture Scene'
    );

    const built = await bridge.build_model({
      runtime: 'queue',
      timeoutMs,
      code: JSON.stringify({
        version: 1,
        units: 'mm',
        operations: controlledArchitectureFixtureOperations()
      }),
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    assertArchitectureSnapshot(built.snapshot);

    const afterBuild = await bridge.adopt_open_model({
      runtime: 'queue',
      timeoutMs,
      read_only: true,
      recursive: true,
      recursive_limit: 100000,
      ...await freshSessionOptions(bridge, { runtime: 'queue', timeoutMs })
    });
    assert.equal(afterBuild.model_revision_complete, true);
    assert.equal(afterBuild.recursive_truncated, false);
    assertArchitectureSnapshot(afterBuild.snapshot);
    assert.equal(afterBuild.entities.length, before.entities.length, 'metadata-only fixture changed top-level entity count');
    assert.equal(afterBuild.recursive_total_seen, before.recursive_total_seen, 'metadata-only fixture changed recursive entity count');

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
    assertArchitectureSnapshot(finalized.snapshot);
    const recursiveTotal = Number(finalized.recursive_total_seen ?? finalized.recursive_index.length);
    assert.equal(finalized.recursive_index.length, recursiveTotal, 'full-recursive fixture index is incomplete');
    assert.equal(finalized.entities.length, before.entities.length);
    assert.equal(recursiveTotal, Number(before.recursive_total_seen ?? before.recursive_index.length));

    const artifactSha256 = `sha256:${await sha256File(finalArtifactPath)}`;
    const contract = buildArchitectureGoldenContract({
      artifactSha256,
      entities: finalized.entities.length,
      recursiveTotal
    });
    await validateContract(contract);
    await fs.writeFile(finalContractPath, `${JSON.stringify(contract, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    assert.equal(await sha256File(absoluteSourcePath), sourceSha256, 'operator source model changed during fixture preparation');

    const report = {
      version: CONTROLLED_ARCHITECTURE_FIXTURE_VERSION,
      kind: 'controlled_architecture_live_fixture_finalization',
      status: 'ready_for_formal_live_case',
      finalized_at: new Date().toISOString(),
      derivation_class: 'controlled_metadata_overlay_on_user_authorized_real_model_copy',
      source: {
        sha256: sourceSha256,
        original_bytes_unchanged: true
      },
      overlay: {
        operation_count: 2,
        operations: ['material', 'scene'],
        geometry_mutation_performed: false,
        material_name_untrusted: ARCHITECTURE_MATERIAL_NAME,
        material_persisted: true,
        scene_name_untrusted: ARCHITECTURE_SCENE_NAME,
        scene_persisted: true
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
        top_level_entities_before: before.entities.length,
        top_level_entities_after: finalized.entities.length,
        recursive_total_before: Number(before.recursive_total_seen ?? before.recursive_index.length),
        recursive_total_after: recursiveTotal,
        recursive_truncated: false
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
    path.join(repoRoot, 'schema', 'controlled-architecture-live-fixture-v1.schema.json'),
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
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.command !== 'prepare') {
    process.stderr.write(
      'Usage: node scripts/prepare-architecture-golden-live-fixture.mjs prepare --runtime queue --queue-required [--source <skp>] [--run-id <id>]\n'
    );
    process.exitCode = 2;
  } else {
    process.stderr.write([
      '',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      '[DANGER] CONTROLLED ARCHITECTURE REAL-MODEL FIXTURE PREPARATION',
      'This run WILL switch the active SketchUp document and modify/save only',
      'workspace-contained disposable copies. The operator source is read-only.',
      '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
      ''
    ].join('\n'));
    prepareControlledArchitectureFixture(options)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
