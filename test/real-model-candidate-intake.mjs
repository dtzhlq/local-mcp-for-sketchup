import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  installCandidateProfileInterruptCleanup,
  runRealModelCandidateIntake
} from '../src/real-model-candidate-intake.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-real-model-candidate-'));
  let assertions = 0;
  try {
  const offlineRoot = path.join(root, 'offline-input');
  const offlineOutput = path.join(root, 'offline-output');
  await fs.mkdir(offlineRoot, { recursive: true });
  await fs.writeFile(path.join(offlineRoot, 'alpha.skp'), sketchUpFixture('alpha'));
  await fs.writeFile(path.join(offlineRoot, '模型.SKP'), sketchUpFixture('unicode'));
  await fs.writeFile(path.join(offlineRoot, 'notes.txt'), 'ignored\n', 'utf8');
  const noQueueBridge = new Proxy({}, {
    get() { throw new Error('offline intake instantiated or called the queue bridge'); }
  });
  const offline = await runRealModelCandidateIntake({
    inputRoot: offlineRoot,
    outputDir: offlineOutput,
    crossVersionStatus: 'deferred_by_user',
    now: () => new Date('2026-07-20T08:00:00.000Z'),
    bridge: noQueueBridge
  });
  assert.equal(offline.ok, true);
  assert.equal(offline.runtime, 'offline');
  assert.equal(offline.live_queue_called, false);
  assert.equal(offline.inventory.summary.candidate_count, 2);
  assert.equal(offline.inventory.summary.ignored_non_skp_regular_files, 1);
  assert.equal(offline.inventory.cross_version.status, 'deferred_by_user');
  assert.ok(offline.inventory.candidates.every((candidate) => candidate.intake.sketchup_header_verified));
  assert.ok(offline.inventory.candidates.every((candidate) => candidate.trust.may_grant_approval === false));
  assert.ok(offline.inventory.candidates.every((candidate) => !path.isAbsolute(candidate.source.relative_path)));
  assertions += 9;

  const inventorySchema = await compileSchema('schema/real-model-candidate-inventory-v1.schema.json');
  assert.equal(inventorySchema(offline.inventory), true, JSON.stringify(inventorySchema.errors));
  const unsafeInventory = structuredClone(offline.inventory);
  unsafeInventory.candidates[0].source.relative_path = '../escape.skp';
  assert.equal(inventorySchema(unsafeInventory), false);
  const extraInventory = structuredClone(offline.inventory);
  extraInventory.candidates[0].source.absolute_path = '/secret/model.skp';
  assert.equal(inventorySchema(extraInventory), false);
  assertions += 3;

  const invalidHeaderRoot = path.join(root, 'invalid-header');
  await fs.mkdir(invalidHeaderRoot);
  await fs.writeFile(path.join(invalidHeaderRoot, 'renamed.skp'), 'not really a SketchUp model');
  await assert.rejects(
    runRealModelCandidateIntake({ inputRoot: invalidHeaderRoot, outputDir: path.join(root, 'invalid-header-output') }),
    /recognized SketchUp model header/
  );
  assertions += 1;

  const oversizedRoot = path.join(root, 'oversized');
  await fs.mkdir(oversizedRoot);
  await fs.writeFile(path.join(oversizedRoot, 'large.skp'), sketchUpFixture('larger-than-budget'));
  await assert.rejects(
    runRealModelCandidateIntake({ inputRoot: oversizedRoot, outputDir: path.join(root, 'oversized-output'), maxFileBytes: 16 }),
    /exceeds the configured max file size/
  );
  assertions += 1;

  const symlinkRoot = path.join(root, 'symlink-input');
  await fs.mkdir(symlinkRoot);
  const symlinkTarget = path.join(root, 'symlink-target.skp');
  await fs.writeFile(symlinkTarget, sketchUpFixture('symlink'));
  await fs.symlink(symlinkTarget, path.join(symlinkRoot, 'linked.skp'));
  await assert.rejects(
    runRealModelCandidateIntake({ inputRoot: symlinkRoot, outputDir: path.join(root, 'symlink-output') }),
    /symbolic link/
  );
  assertions += 1;

  const rootSymlink = path.join(root, 'root-symlink');
  await fs.symlink(offlineRoot, rootSymlink);
  await assert.rejects(
    runRealModelCandidateIntake({ inputRoot: rootSymlink, outputDir: path.join(root, 'root-symlink-output') }),
    /input root must not be a symbolic link/
  );
  assertions += 1;

  await assert.rejects(
    runRealModelCandidateIntake({ inputRoot: offlineRoot, outputDir: path.join(offlineRoot, 'generated') }),
    /Output directory must be outside/
  );
  assertions += 1;

  const racingRoot = path.join(root, 'racing-input');
  await fs.mkdir(racingRoot);
  const racingPath = path.join(racingRoot, 'race.skp');
  await fs.writeFile(racingPath, sketchUpFixture('before'));
  let raced = false;
  await assert.rejects(
    runRealModelCandidateIntake({
      inputRoot: racingRoot,
      outputDir: path.join(root, 'racing-output'),
      hooks: {
        afterOpen: async ({ file_path: filePath }) => {
          if (raced) return;
          raced = true;
          await fs.writeFile(filePath, sketchUpFixture('replacement-content-is-different'));
        }
      }
    }),
    /changed while being read|timestamps changed|byte count changed/
  );
  assert.equal(raced, true);
  assertions += 2;

  let forbiddenBridgeCalls = 0;
  await assert.rejects(
    runRealModelCandidateIntake({
      runtime: 'queue',
      queueRequired: false,
      inputRoot: '/missing-is-not-inspected',
      outputDir: path.join(root, 'missing-flag-output'),
      bridge: new Proxy({}, { get() { forbiddenBridgeCalls += 1; return undefined; } })
    }),
    /requires explicit --runtime queue --queue-required/
  );
  assert.equal(forbiddenBridgeCalls, 0);
  assertions += 2;

  const excessiveIndexBridge = new FakeProfileBridge();
  await assert.rejects(
    runRealModelCandidateIntake({
      runtime: 'queue',
      queueRequired: true,
      inputRoot: offlineRoot,
      outputDir: path.join(root, 'excessive-index-output'),
      recursiveLimit: 100_001,
      bridge: excessiveIndexBridge,
      installSignalHandlers: false,
      emitWarning: false
    }),
    /recursiveLimit must not exceed 100000/
  );
  assert.equal(excessiveIndexBridge.calls.length, 0, 'oversized recursive output requests must fail before queue use');
  assertions += 2;

  const preflightBridge = new FakeProfileBridge();
  let copiedCandidates = 0;
  await assert.rejects(
    runRealModelCandidateIntake({
      runtime: 'queue',
      queueRequired: true,
      inputRoot: offlineRoot,
      outputDir: path.join(root, 'preflight-failure-output'),
      bridge: preflightBridge,
      installSignalHandlers: false,
      emitWarning: false,
      hooks: {
        afterCopyOpen: async () => {
          copiedCandidates += 1;
          if (copiedCandidates === 2) throw new Error('simulated second-candidate preflight failure');
        }
      }
    }),
    /simulated second-candidate preflight failure/
  );
  assert.equal(copiedCandidates, 2);
  assert.equal(preflightBridge.calls.length, 0, 'all candidate preflight must finish before the first queue call');
  assertions += 3;

  const deniedBridge = new FakeProfileBridge();
  deniedBridge.executionPolicy = {
    allowed_runtimes: ['mock'],
    allow_queue_mutation: false,
    allow_direct_expert_queue_mutation: false
  };
  await assert.rejects(
    runRealModelCandidateIntake({
      runtime: 'queue',
      queueRequired: true,
      inputRoot: liveInputForPolicy(root),
      outputDir: path.join(root, 'policy-denied-output'),
      bridge: deniedBridge,
      installSignalHandlers: false,
      emitWarning: false
    }),
    /denied by execution policy/
  );
  assert.equal(deniedBridge.calls.length, 0, 'queue flags must not elevate server execution policy');
  assertions += 2;

  const cliInput = path.join(root, 'cli-input');
  const cliOutput = path.join(root, 'cli-output');
  const isolatedState = path.join(root, 'must-not-be-created-state');
  await fs.mkdir(cliInput);
  await fs.writeFile(path.join(cliInput, 'cli.skp'), sketchUpFixture('cli'));
  const cli = await runProcess(process.execPath, [
    path.join(repoRoot, 'scripts', 'intake-real-model-corpus.mjs'),
    '--input-root', cliInput,
    '--output-dir', cliOutput
  ], {
    ...process.env,
    ALMA_SKETCHUP_STATE_DIR: isolatedState,
    ALMA_SKETCHUP_QUEUE_DIR: path.join(isolatedState, 'queue'),
    ALMA_SKETCHUP_RESPONSE_DIR: path.join(isolatedState, 'responses'),
    ALMA_SKETCHUP_PROCESSING_DIR: path.join(isolatedState, 'processing')
  });
  assert.equal(cli.code, 0, cli.stderr);
  assert.match(cli.stdout, /"live_queue_called": false/);
  assert.equal(await exists(isolatedState), false, 'default CLI must not create or inspect queue state');
  assertions += 3;

  const liveInput = path.join(root, 'live-input');
  const liveOutput = path.join(root, 'live-output');
  await fs.mkdir(liveInput);
  const liveOriginal = path.join(liveInput, 'profile.skp');
  const liveBytes = sketchUpFixture('profile-source');
  await fs.writeFile(liveOriginal, liveBytes);
  const fakeBridge = new FakeProfileBridge();
  let cleanupCalls = 0;
  const live = await runRealModelCandidateIntake({
    runtime: 'queue',
    queueRequired: true,
    inputRoot: liveInput,
    outputDir: liveOutput,
    crossVersionStatus: 'deferred_by_user',
    now: () => new Date('2026-07-20T08:30:00.000Z'),
    bridge: fakeBridge,
    installSignalHandlers: false,
    emitWarning: false,
    cleanupQueueArtifacts: async () => { cleanupCalls += 1; }
  });
  assert.equal(live.ok, true);
  assert.equal(live.profile.summary.profiled, 1);
  assert.equal(live.profile.summary.formal_cases_accepted, 0);
  assert.equal(live.profile.safety.model_content_mutation_requested, false);
  assert.equal(live.profile.safety.save_requested, false);
  assert.equal(live.profile.safety.originals_opened_in_sketchup, false);
  assert.equal(live.profile.safety.disposable_copy_bytes_unchanged_verified, true);
  assert.equal(live.profile.safety.original_bytes_unchanged_verified, true);
  assert.equal(live.profile.safety.interrupt_cleanup_enabled, false);
  assert.equal(live.profile.safety.active_document_change_warning_emitted, false);
  assert.equal(live.profile.profiles[0].revision_attestation.unchanged, true);
  assert.equal(live.profile.profiles[0].revision_attestation.strategy, 'definition-merkle.v1');
  assert.equal(live.profile.profiles[0].revision_attestation.unique_entity_limit, 1_000_000);
  assert.equal(fakeBridge.lastAdoptionOptions.recursive_limit, 10_000, 'candidate profiling must default to a bounded recursive sample');
  assert.equal(fakeBridge.calls.filter((call) => call === 'get_active_model_identity').length, 1, 'activation must use one lightweight identity probe');
  assert.equal(fakeBridge.calls.filter((call) => call === 'create_queue_handshake').length, 2, 'activation must not add a full-revision handshake');
  assert.equal(live.profile.profiles[0].formal_sidecar.generated, false);
  assert.ok(fakeBridge.calls.every((call) => !['build_model', 'save_model', 'save_model_version', 'reset_model', 'import_model', 'run_ruby_expert'].includes(call)));
  assert.ok(fakeBridge.openedPaths.every((openedPath) => openedPath !== liveOriginal && openedPath.endsWith(`${path.sep}candidate.skp`)));
  assert.deepEqual(await fs.readFile(liveOriginal), liveBytes);
  assert.equal(cleanupCalls, 1);
  assertions += 21;

  const profileSchema = await compileSchema('schema/real-model-candidate-profile-v1.schema.json');
  assert.equal(profileSchema(live.profile), true, JSON.stringify(profileSchema.errors));
  const unsafeProfile = structuredClone(live.profile);
  unsafeProfile.profiles[0].live_observation.source_path = liveOriginal;
  assert.equal(profileSchema(unsafeProfile), false);
  const elevatedProfile = structuredClone(live.profile);
  elevatedProfile.profiles[0].formal_sidecar.generated = true;
  assert.equal(profileSchema(elevatedProfile), false);
  assertions += 3;

  const failingBridge = new FakeProfileBridge({ failInspection: true });
  let failureCleanupCalls = 0;
  const failed = await runRealModelCandidateIntake({
    runtime: 'queue',
    queueRequired: true,
    inputRoot: offlineRoot,
    outputDir: path.join(root, 'failed-live-output'),
    bridge: failingBridge,
    installSignalHandlers: false,
    emitWarning: false,
    cleanupQueueArtifacts: async () => { failureCleanupCalls += 1; }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.profile.summary.failed, 1);
  assert.equal(failed.profile.summary.not_run, 1);
  assert.equal(failingBridge.openedPaths.length, 1, 'a profile failure must stop subsequent document switches');
  assert.equal(failureCleanupCalls, 1, 'normal exception path must clean this process queue artifacts');
  assert.doesNotMatch(failed.profile.profiles[0].error.message, /\/Users\//);
  assertions += 6;

  const pendingMdiBridge = new FakeProfileBridge({ neverActivate: true });
  const pendingMdi = await runRealModelCandidateIntake({
    runtime: 'queue',
    queueRequired: true,
    inputRoot: liveInput,
    outputDir: path.join(root, 'pending-mdi-output'),
    bridge: pendingMdiBridge,
    timeoutMs: 5,
    installSignalHandlers: false,
    emitWarning: false,
    cleanupQueueArtifacts: async () => {}
  });
  assert.equal(pendingMdi.ok, false);
  assert.equal(pendingMdi.profile.profiles[0].error.code, 'HANDSHAKE_DOCUMENT_MISMATCH');
  assert.equal(pendingMdi.profile.profiles[0].error.next_action.action, 'focus_opened_model_then_retry_profile');
  assert.equal(pendingMdi.profile.profiles[0].error.details.pending_mdi_activation, true);
  assertions += 4;

  let signalCleanupPid = null;
  let signalExitCode = null;
  let resolveSignal;
  const signalDone = new Promise((resolve) => { resolveSignal = resolve; });
  const uninstall = installCandidateProfileInterruptCleanup({
    pid: 424242,
    cleanup: async (pid) => { signalCleanupPid = pid; },
    exit: (code) => { signalExitCode = code; resolveSignal(); }
  });
  process.emit('SIGTERM');
  await signalDone;
  uninstall();
  assert.equal(signalCleanupPid, 424242);
  assert.equal(signalExitCode, 143);
  assertions += 2;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    default_runtime: 'offline',
    default_live_queue_called: false,
    stable_read_race_failed_closed: true,
    symlink_failed_closed: true,
    invalid_header_failed_closed: true,
    disposable_copy_live_profile_contract: true,
    mutating_methods_called_by_fake_profile: 0,
    interrupt_cleanup_verified: true
  }, null, 2)}\n`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

class FakeProfileBridge {
  constructor({ failInspection = false, neverActivate = false } = {}) {
    this.executionPolicy = {
      allowed_runtimes: ['mock', 'queue'],
      allow_queue_mutation: true,
      allow_direct_expert_queue_mutation: true
    };
    this.failInspection = failInspection;
    this.neverActivate = neverActivate;
    this.currentPath = null;
    this.calls = [];
    this.openedPaths = [];
    this.revision = `sha256:${'a'.repeat(64)}`;
    this.lastAdoptionOptions = null;
  }

  async create_queue_handshake() {
    this.calls.push('create_queue_handshake');
    return {
      session_contract: {
        model_identity: { source_path: this.neverActivate ? null : this.currentPath, title: 'Untrusted fixture title' },
        model_revision: this.revision,
        model_revision_complete: true
      }
    };
  }

  async get_active_model_identity() {
    this.calls.push('get_active_model_identity');
    return {
      kind: 'active_model_identity',
      model_identity: { source_path: this.neverActivate ? null : this.currentPath, title: 'Untrusted fixture title' },
      activation_confirmed: !this.neverActivate,
      pending_open: this.neverActivate
    };
  }

  async get_capabilities() {
    this.calls.push('get_capabilities');
    return {
      runtime: {
        version: '0.1.0-rc.2',
        capability_version: 'capabilities.fixture',
        plugin: { version: '0.1.0-rc.2', sketchup_version: '26.2' }
      }
    };
  }

  async open_model({ path: inputPath }) {
    this.calls.push('open_model');
    this.currentPath = inputPath;
    this.openedPaths.push(inputPath);
    return { open_status: 'activated', opened: true };
  }

  async inspect_model() {
    this.calls.push('inspect_model');
    if (this.failInspection) throw new Error('/Users/private/model.skp contained simulated failure');
    return {
      entities: [{ id: 'top-1', entity_type: 'component_instance', visible: true, locked: false }],
      snapshot: fixtureSnapshot()
    };
  }

  async adopt_open_model(options) {
    this.calls.push('adopt_open_model');
    this.lastAdoptionOptions = options;
    assert.equal(options.read_only, true);
    return {
      read_only: true,
      adopted_count: 0,
      existing_count: 1,
      entity_count: 1,
      recursive: true,
      recursive_truncated: false,
      recursive_total_seen: 3,
      model_identity: { source_path: this.currentPath },
      model_revision: this.revision,
      model_revision_complete: true,
      model_revision_strategy: 'definition-merkle.v1',
      model_revision_unique_entity_limit: 1_000_000,
      model_revision_unique_entities: 3,
      model_revision_reachable_definitions: 1,
      model_info: {
        counts: { component_definitions: 1, materials: 1, tags: 1, scenes: 1, classification_schemas: 0 }
      },
      component_definition_summaries: [{ name: 'Untrusted definition' }],
      recursive_index: [
        {
          entity_path: 'pid:1',
          path_segments: [{ reference: '1' }],
          entity_type: 'component_instance',
          visible: true,
          locked: true,
          definition_name: 'Shared',
          shared_definition: true,
          affected_instance_count: 2,
          world_transform: [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
        },
        {
          entity_path: 'pid:1/2',
          path_segments: [{ reference: '1' }, { reference: '2' }],
          entity_type: 'face',
          visible: false,
          face_uvs: { mode: 'fixture' },
          attributes: { fixture: true }
        },
        {
          entity_path: 'pid:1/3',
          path_segments: [{ reference: '1' }, { reference: '3' }],
          entity_type: 'edge',
          visible: true
        }
      ],
      snapshot: fixtureSnapshot()
    };
  }
}

function fixtureSnapshot() {
  return {
    totals: { groups: 0, instances: 1, faces: 1, edges: 1, vertices: 2 },
    materials: [{ name: 'Material from model' }],
    material_names: ['Material from model'],
    tags: [{ name: 'Tag from model' }],
    scenes: [{ name: 'Scene from model' }],
    component_definitions: ['Shared'],
    component_definition_summaries: [{ name: 'Shared' }],
    classification_schemas: [],
    warning_summary: { warnings: 0 }
  };
}

function sketchUpFixture(label) {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe, 0xff, 0x0e]),
    Buffer.from('SketchUp Model', 'utf16le'),
    Buffer.from([0xff, 0xfe, 0xff, 0x0a]),
    Buffer.from(`{fixture:${label}}`, 'utf16le')
  ]);
}

function liveInputForPolicy(baseRoot) {
  return path.join(baseRoot, 'offline-input');
}

async function compileSchema(relativePath) {
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
  return new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
}

function runProcess(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

await main();
