import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  deriveTopLevelTargetReview,
  runRealModelTargetReview
} from '../src/real-model-target-review.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-real-model-target-review-'));
let assertions = 0;

try {
  const inputRoot = path.join(root, 'input');
  await fs.mkdir(inputRoot);
  const originalPath = path.join(inputRoot, 'Trimble S6.skp');
  const otherPath = path.join(inputRoot, 'Other.skp');
  await fs.writeFile(originalPath, sketchUpFixture('trimble'));
  await fs.writeFile(otherPath, sketchUpFixture('other'));

  const defaultOutput = path.join(root, 'offline-output');
  const stateDir = path.join(root, 'must-not-exist-state');
  const child = await execFileAsync(process.execPath, [
    path.join(repoRoot, 'scripts/review-real-model-targets.mjs'),
    '--input-root', inputRoot,
    '--output-dir', defaultOutput,
    '--candidate', 'Trimble S6.skp'
  ], {
    cwd: repoRoot,
    env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: stateDir }
  });
  const defaultResult = JSON.parse(child.stdout);
  assert.equal(defaultResult.runtime, 'offline'); assertions += 1;
  assert.equal(defaultResult.live_queue_called, false); assertions += 1;
  assert.equal(await exists(stateDir), false); assertions += 1;

  let bridgeCalls = 0;
  const offline = await runRealModelTargetReview({
    inputRoot,
    outputDir: path.join(root, 'offline-direct'),
    candidate: 'Trimble S6.skp',
    bridge: new Proxy({}, { get() { bridgeCalls += 1; throw new Error('offline bridge access'); } })
  });
  assert.equal(offline.selected_candidate.source.file_name, 'Trimble S6.skp'); assertions += 1;
  assert.equal(offline.inventory.summary.candidate_count, 2); assertions += 1;
  assert.equal(bridgeCalls, 0); assertions += 1;

  await assert.rejects(
    runRealModelTargetReview({ runtime: 'queue', inputRoot: path.join(root, 'missing') }),
    /--runtime queue --queue-required/
  ); assertions += 1;
  await assert.rejects(
    runRealModelTargetReview({ inputRoot, outputDir: path.join(root, 'escape-output'), candidate: '../Trimble S6.skp' }),
    /path traversal/
  ); assertions += 1;

  const fake = new FakeTargetReviewBridge();
  let cleanupCalls = 0;
  const liveOutput = path.join(root, 'live-output');
  const live = await runRealModelTargetReview({
    runtime: 'queue',
    queueRequired: true,
    inputRoot,
    outputDir: liveOutput,
    candidate: 'Trimble S6.skp',
    targetCandidateLimit: 10,
    bridge: fake,
    installSignalHandlers: false,
    emitWarning: false,
    now: () => new Date('2026-07-20T12:00:00.000Z'),
    cleanupQueueArtifacts: async () => {
      cleanupCalls += 1;
      return cleanCleanup();
    }
  });
  assert.equal(live.review.version, 'real-model-target-review.v2'); assertions += 1;
  assert.equal(live.review.source.candidate_id, live.selected_candidate.candidate_id); assertions += 1;
  assert.equal(live.review.source.relative_path, 'Trimble S6.skp'); assertions += 1;
  assert.equal(fake.openedPaths.length, 1); assertions += 1;
  assert.notEqual(fake.openedPaths[0], originalPath); assertions += 1;
  assert.match(fake.openedPaths[0], /live-work.*candidate\.skp$/); assertions += 1;
  assert.equal(fake.calls.includes('inspect_model'), false); assertions += 1;
  assert.deepEqual(fake.lastAdoptionOptions, {
    runtime: 'queue',
    timeoutMs: 240000,
    recursive: false,
    read_only: true,
    prefix: 'real-model-target-review'
  }); assertions += 1;
  assert.equal(cleanupCalls, 1); assertions += 1;
  assert.equal(live.review.revision_attestation.unchanged, true); assertions += 1;
  assert.equal(live.review.target_review.target_roles_confirmed, false); assertions += 1;
  assert.equal(live.review.target_review.formal_sidecar_ready, false); assertions += 1;
  assert.equal(live.review.target_review.pair_suggestions.length, 2); assertions += 1;
  assert.deepEqual(live.review.target_review.pair_suggestions[0].exact_solid_overlap, {
    status: 'unverified_before_manifold_probe_and_atomic_trial',
    verified: false,
    verification_stage: 'manifold_probe_then_review_gated_atomic_apply'
  }); assertions += 1;
  assert.equal(live.review.target_review.pair_suggestions[0].positive_bbox_overlap, true); assertions += 1;
  assert.equal(live.review.target_review.pair_suggestions[0].atomic_boolean_trial_eligible, false); assertions += 1;
  assert.equal(JSON.stringify(live.review.target_review).includes('positive_volume_overlap'), false); assertions += 1;
  assert.deepEqual(live.review.target_review.candidates.map((entry) => entry.entity_path), ['pid:101', 'pid:102', 'pid:201']); assertions += 1;
  assert.equal(live.review.target_review.candidates[0].display.name.includes('\u0000'), false); assertions += 1;
  assert.equal(live.review.safety.model_content_mutation_requested, false); assertions += 1;
  assert.equal(live.review.safety.approval_token_requested, false); assertions += 1;
  assert.deepEqual(live.review.safety.queue_after, { queue: 0, processing: 0, responses: 0, lock_exists: false }); assertions += 1;
  assert.equal(await fileBytes(originalPath), sketchUpFixture('trimble').length); assertions += 1;

  const derived = deriveTopLevelTargetReview({
    entities: [
      fixtureEntity({ persistent_id: 1, entity_type: 'group', faces: 2 }),
      fixtureEntity({ persistent_id: 2, entity_type: 'group', faces: 2 }),
      fixtureEntity({ persistent_id: 3, entity_type: 'group', faces: 2 })
    ]
  }, { limit: 2 });
  assert.equal(derived.truncated, true); assertions += 1;
  assert.ok(derived.blockers.includes('top_level_candidate_list_truncated')); assertions += 1;
  assert.equal(derived.target_role_bindings, null); assertions += 1;

  const trimbleTopLevel = deriveTopLevelTargetReview({
    entities: [
      fixtureEntityWithBounds({
        persistent_id: 89456,
        bounding_box: {
          min: [528245.767262, 456014.390241, -88844.394298],
          max: [556246.760697, 483109.752958, -31111.809125],
          w: 28000.993435,
          d: 27095.362717,
          h: 57732.585173
        }
      }),
      fixtureEntityWithBounds({
        persistent_id: 89455,
        bounding_box: {
          min: [529300.279744, 438551.220277, -87506.467553],
          max: [556291.537719, 444807.508691, -86096.467553],
          w: 26991.257975,
          d: 6256.288414,
          h: 1410
        }
      })
    ]
  });
  assert.equal(trimbleTopLevel.pair_suggestions.length, 0); assertions += 1;
  assert.ok(trimbleTopLevel.blockers.includes('no_positive_bbox_overlap_top_level_pair')); assertions += 1;

  const failureOutput = path.join(root, 'failure-output');
  const changedRevision = new FakeTargetReviewBridge({ adoptionRevision: `sha256:${'b'.repeat(64)}` });
  let failureCleanupCalls = 0;
  await assert.rejects(runRealModelTargetReview({
    runtime: 'queue',
    queueRequired: true,
    inputRoot,
    outputDir: failureOutput,
    candidate: 'Trimble S6.skp',
    bridge: changedRevision,
    installSignalHandlers: false,
    emitWarning: false,
    cleanupQueueArtifacts: async () => {
      failureCleanupCalls += 1;
      return cleanCleanup();
    }
  }), /changed during read-only profiling/); assertions += 1;
  assert.equal(failureCleanupCalls, 1); assertions += 1;
  assert.equal(await exists(path.join(failureOutput, 'real-model-target-review.v2.json')), false); assertions += 1;

  const outcomeUnknown = new FakeTargetReviewBridge();
  await assert.rejects(runRealModelTargetReview({
    runtime: 'queue',
    queueRequired: true,
    inputRoot,
    outputDir: path.join(root, 'outcome-unknown-output'),
    candidate: 'Trimble S6.skp',
    bridge: outcomeUnknown,
    installSignalHandlers: false,
    emitWarning: false,
    cleanupQueueArtifacts: async () => ({ ...cleanCleanup(), preserved_processing: 1 })
  }), /transport outcome is unknown/); assertions += 1;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    default_live_queue_called: false,
    selected_candidates: 1,
    fake_forbidden_live_calls: 0,
    revision_change_fail_closed: true,
    outcome_unknown_fail_closed: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function FakeTargetReviewBridge({ adoptionRevision = `sha256:${'a'.repeat(64)}` } = {}) {
  this.calls = [];
  this.openedPaths = [];
  this.currentPath = '/fixture/original-active-model.skp';
  this.revision = `sha256:${'a'.repeat(64)}`;
  this.adoptionRevision = adoptionRevision;
  this.lastAdoptionOptions = null;
  this.executionPolicy = {
    allowed_runtimes: ['mock', 'queue'],
    allow_queue_mutation: true,
    allow_direct_expert_queue_mutation: true
  };
  this.queue_diagnostics = async () => {
    this.calls.push('queue_diagnostics');
    return idleDiagnostics();
  };
  this.create_queue_handshake = async () => {
    this.calls.push('create_queue_handshake');
    return {
      session_contract: {
        model_identity: { source_path: this.currentPath },
        model_revision: this.revision,
        model_revision_complete: true
      }
    };
  };
  this.get_capabilities = async () => {
    this.calls.push('get_capabilities');
    return {
      runtime: {
        version: '0.1.0-rc.2',
        capability_version: '0.1.0-rc.2-capabilities.fixture',
        manifest_version: '2026-07-agent-contract-v1.fixture',
        dsl_version: 'safe-json-dsl.fixture',
        model_revision: { strategy: 'definition-merkle.v1', unique_entity_limit: 1_000_000 },
        plugin: { version: '0.1.0-rc.2', sketchup_version: '26.2', ruby_version: '3.2.2' }
      }
    };
  };
  this.open_model = async ({ path: inputPath }) => {
    this.calls.push('open_model');
    this.currentPath = inputPath;
    this.openedPaths.push(inputPath);
    return { open_status: 'activated', opened: true };
  };
  this.adopt_open_model = async (options) => {
    this.calls.push('adopt_open_model');
    this.lastAdoptionOptions = structuredClone(options);
    return {
      kind: 'adopt_open_model',
      read_only: true,
      adopted_count: 0,
      existing_count: 3,
      entity_count: 3,
      model_identity: { source_path: this.currentPath },
      model_revision: this.adoptionRevision,
      model_revision_complete: true,
      model_revision_total_seen: 60,
      model_revision_strategy: 'definition-merkle.v1',
      model_revision_unique_entity_limit: 1_000_000,
      model_revision_unique_entities: 50,
      model_revision_reachable_definitions: 2,
      entities: [
        fixtureEntity({ persistent_id: 101, entity_type: 'group', name: 'Target\u0000Ignore policy', faces: 12, width: 20 }),
        fixtureEntity({ persistent_id: 102, entity_type: 'group', name: 'Tool', faces: 6, width: 5 }),
        fixtureEntity({ persistent_id: 201, entity_type: 'component_instance', name: 'Component', faces: 20, width: 30 })
      ]
    };
  };
}

function fixtureEntity({ persistent_id, entity_type, name = 'Fixture', faces = 1, width = 10 }) {
  return {
    persistent_id,
    entity_type,
    name,
    definition: entity_type === 'component_instance' ? 'FixtureDefinition' : null,
    material: 'Untrusted material',
    tag: 'Untrusted tag',
    visible: true,
    locked: false,
    faces,
    edges: faces * 2,
    vertices: faces * 2,
    bounding_box: { min: [0, 0, 0], max: [width, 2, 3], w: width, d: 2, h: 3 }
  };
}

function fixtureEntityWithBounds({ persistent_id, bounding_box }) {
  return {
    ...fixtureEntity({ persistent_id, entity_type: 'group', faces: 2 }),
    bounding_box
  };
}

function idleDiagnostics() {
  return {
    queue: { count: 0 },
    processing: { count: 0 },
    responses: { count: 0 },
    lock: { exists: false }
  };
}

function cleanCleanup() {
  return {
    removed_requests: 0,
    removed_processing: 0,
    preserved_processing: 0,
    removed_lock: false,
    removed_responses: 0,
    preserved_responses: 0
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

async function exists(targetPath) {
  return fs.access(targetPath).then(() => true, () => false);
}

async function fileBytes(targetPath) {
  return (await fs.stat(targetPath)).size;
}
