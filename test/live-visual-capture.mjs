import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { SketchUpBridge } from '../src/bridge.mjs';
import { ImmutableImageArtifactStore } from '../src/image-artifact-store.mjs';
import { LiveVisualCaptureService, safeLiveVisualCaptureSpec } from '../src/live-visual-capture.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { listToolDefinitions } from '../src/tool-registry.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';

async function main() {
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-live-visual-capture-'));
try {
  const png = await sharp({
    create: { width: 80, height: 48, channels: 4, background: { r: 42, g: 110, b: 185, alpha: 1 } }
  }).png().toBuffer();
  const imageStore = new ImmutableImageArtifactStore({ rootDir: path.join(root, 'image-store') });
  const tempRoot = path.join(root, 'capture-tmp');
  const service = new LiveVisualCaptureService({ imageArtifactStore: imageStore, tempRoot });
  const adoption = adoptionFixture();
  const identityHint = { ...adoption.model_identity, document_id: adoption.document_id };
  const binding = {
    model_key: modelKeyForIdentity(modelIdentityForAdoption(adoption, { identityHint })),
    graph_id: 'model-graph-111111111111111111111111',
    model_revision: adoption.model_revision
  };
  const contract = {
    runtime: 'queue',
    session_id: adoption.session_id,
    document_id: adoption.document_id,
    model_identity: adoption.model_identity,
    model_revision: adoption.model_revision
  };

  const beforeBridge = new FakeAuthorizedCaptureBridge({ adoption, png });
  const before = await service.capture({
    bridge: beforeBridge,
    taskId: 'task_11111111-1111-4111-8111-111111111111',
    phase: 'before',
    sessionContract: contract,
    expectedBinding: binding,
    recursiveLimit: 321
  });
  assert.match(before.record.handle, /^image-artifact:sha256:/);
  assert.equal(before.provenance.image_handle, before.record.handle);
  assert.equal(before.provenance.image_sha256, before.record.sha256);
  assert.equal(before.provenance.kind, 'server_live_capture');
  assert.equal(before.provenance.state_unchanged, true);
  assert.equal(before.provenance.view_unchanged, true);
  assert.equal(Object.hasOwn(before.provenance, 'file_path'), false);
  assert.equal(Object.hasOwn(before.provenance, 'session_id'), false);
  await assertLiveProvenanceSchema(before.provenance);
  assert.deepEqual(beforeBridge.sequence, ['authorize:capture_view', 'adopt', 'capture', 'adopt']);
  assert.equal(beforeBridge.allCallsHeldLock, true);
  assert.equal(beforeBridge.captureOptions.view, 'current');
  assert.equal(beforeBridge.captureOptions.zoom_extents, false);
  assert.equal(beforeBridge.captureOptions.server_visual_capture, true);
  assert.equal(Object.hasOwn(beforeBridge.captureOptions, 'scene'), false);
  assert.deepEqual(safeLiveVisualCaptureSpec(), {
    view: 'current', scene: null, width: 1280, height: 720, antialias: true, compression: 1, zoom_extents: false
  });
  await assertDirectoryEmptyOrMissing(tempRoot);

  const afterBridge = new FakeAuthorizedCaptureBridge({ adoption, png });
  const after = await service.capture({
    bridge: afterBridge,
    taskId: 'task_22222222-2222-4222-8222-222222222222',
    phase: 'after',
    sessionContract: contract,
    expectedBinding: binding,
    recursiveLimit: 321,
    sourceCaptureProvenance: before.provenance
  });
  assert.equal(after.provenance.phase, 'after');
  assert.equal(after.provenance.camera_hash, before.provenance.camera_hash);
  assert.equal(after.provenance.capture_spec_hash, before.provenance.capture_spec_hash);
  await assertDirectoryEmptyOrMissing(tempRoot);

  const driftBridge = new FakeAuthorizedCaptureBridge({
    adoption,
    png,
    afterPatch: { model_revision: `sha256:${'2'.repeat(64)}` }
  });
  await assert.rejects(
    service.capture({
      bridge: driftBridge,
      taskId: 'task_33333333-3333-4333-8333-333333333333',
      phase: 'before',
      sessionContract: contract,
      expectedBinding: binding
    }),
    (error) => error?.code === 'MODEL_REVISION_MISMATCH'
  );
  await assertDirectoryEmptyOrMissing(tempRoot);

  await testTemporaryRootSymlinks({ root, imageStore, adoption, png, contract, binding });
  await testTransientImageIngress(root, png);
  await testForgedLiveInputsFailBeforeQueue(root);
  await testRubyCaptureSourceContract();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    queue_sequence: beforeBridge.sequence,
    safe_current_view: true,
    revision_drift_blocked: true,
    temporary_capture_cleaned: true,
    temporary_symlink_escape_blocked: true,
    transient_base64_persisted: false,
    forged_live_capture_blocked: true,
    ruby_requires_active_model: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
}

class FakeAuthorizedCaptureBridge {
  constructor({ adoption, png, afterPatch = {} }) {
    this.adoption = structuredClone(adoption);
    this.png = Buffer.from(png);
    this.afterPatch = structuredClone(afterPatch);
    this.sequence = [];
    this.locked = false;
    this.allCallsHeldLock = true;
    this.adoptionCount = 0;
    this.captureOptions = null;
  }

  async withLiveMutationAuthorization({ operation, session_contract }, callback) {
    assert.equal(operation, 'capture_view');
    assert.equal(session_contract.session_id, this.adoption.session_id);
    this.sequence.push(`authorize:${operation}`);
    this.locked = true;
    try {
      return await callback(this);
    } finally {
      this.locked = false;
    }
  }

  async adopt_open_model(options) {
    this.observeLock();
    this.sequence.push('adopt');
    assert.equal(options.runtime, 'queue');
    assert.equal(options.read_only, true);
    this.adoptionCount += 1;
    return this.adoptionCount === 1
      ? structuredClone(this.adoption)
      : { ...structuredClone(this.adoption), ...structuredClone(this.afterPatch) };
  }

  async capture_view(options) {
    this.observeLock();
    this.sequence.push('capture');
    this.captureOptions = structuredClone(options);
    await fs.writeFile(options.path, this.png);
    const camera = cameraFixture();
    return {
      kind: 'capture_view',
      runtime: 'queue',
      file_path: options.path,
      view: options.view,
      scene: null,
      width: options.width,
      height: options.height,
      antialias: options.antialias,
      compression: options.compression,
      camera,
      captured_at: '2026-07-16T06:00:00.000Z',
      read_only_attestation: {
        version: 'capture-view-read-only-attestation.v1',
        server_visual_capture: true,
        session_id: this.adoption.session_id,
        document_id: this.adoption.document_id,
        model_identity: structuredClone(this.adoption.model_identity),
        model_revision_before: this.adoption.model_revision,
        model_revision_after: this.afterPatch.model_revision || this.adoption.model_revision,
        model_revision_complete_before: true,
        model_revision_complete_after: true,
        camera_before: camera,
        camera_after: camera,
        model_modified_before: false,
        model_modified_after: false,
        state_unchanged: !this.afterPatch.model_revision,
        view_unchanged: true
      }
    };
  }

  observeLock() {
    if (!this.locked) this.allCallsHeldLock = false;
  }
}

async function testTransientImageIngress(testRoot, png) {
  const taskRoot = path.join(testRoot, 'transient-agent-state');
  const bridge = new SketchUpBridge({
    agentContract: { rootDir: taskRoot },
    executionPolicy: { allowed_runtimes: ['mock'] }
  });
  const raw = png.toString('base64');
  const started = await bridge.start_agent_task({
    intent: 'image_artifact',
    instruction: 'Register opaque reference bytes without local files.',
    idempotency_key: 'transient-image-start',
    inputs: { image_base64: raw, media_type: 'image/png' }
  });
  assert.equal(started.ok, true);
  assert.equal(started.task_state, 'completed');
  assert.match(started.data.image.handle, /^image-artifact:sha256:/);
  const persisted = await bridge.taskStore.getTask(started.task_id, { includePrivate: true });
  assert.equal(persisted.inputs.image_base64, undefined);
  assert.equal(persisted.inputs.media_type, undefined);
  assert.equal(persisted.inputs.image_handle, started.data.image.handle);

  const awaiting = await bridge.start_agent_task({
    intent: 'image_artifact',
    instruction: 'Await transient image input.'
  });
  assert.equal(awaiting.task_state, 'awaiting_input');
  const submitted = await bridge.submit_agent_task_input({
    task_id: awaiting.task_id,
    idempotency_key: 'transient-image-submit',
    input: { image_base64: raw, media_type: 'image/png' }
  });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.task_state, 'completed');
  assert.equal((await bridge.taskStore.getTask(awaiting.task_id, { includePrivate: true })).inputs.image_base64, undefined);
  assert.equal(await directoryContains(taskRoot, raw), false, 'raw base64 must not enter task or idempotency persistence');
}

async function assertLiveProvenanceSchema(provenance) {
  const schema = JSON.parse(await fs.readFile(new URL('../schema/visual-correction-evidence-v1.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`${schema.$id}#/$defs/capture_provenance`);
  assert.ok(validate(provenance), JSON.stringify(validate.errors));
}

async function testTemporaryRootSymlinks({ root: testRoot, imageStore, adoption, png, contract, binding }) {
  const outside = path.join(testRoot, 'symlink-outside');
  await fs.mkdir(outside, { recursive: true });
  const linkedRoot = path.join(testRoot, 'linked-capture-root');
  await fs.symlink(outside, linkedRoot);
  const linkedRootService = new LiveVisualCaptureService({ imageArtifactStore: imageStore, tempRoot: linkedRoot });
  const linkedRootBridge = new FakeAuthorizedCaptureBridge({ adoption, png });
  await assert.rejects(
    linkedRootService.capture({
      bridge: linkedRootBridge,
      taskId: 'task_44444444-4444-4444-8444-444444444444',
      phase: 'before', sessionContract: contract, expectedBinding: binding
    }),
    (error) => error?.code === 'ARTIFACT_INTEGRITY_ERROR'
  );
  assert.deepEqual(linkedRootBridge.sequence, []);

  const safeRoot = path.join(testRoot, 'safe-capture-root');
  await fs.mkdir(safeRoot, { recursive: true });
  const taskId = 'task_55555555-5555-4555-8555-555555555555';
  await fs.symlink(outside, path.join(safeRoot, taskId));
  const linkedTaskService = new LiveVisualCaptureService({ imageArtifactStore: imageStore, tempRoot: safeRoot });
  const linkedTaskBridge = new FakeAuthorizedCaptureBridge({ adoption, png });
  await assert.rejects(
    linkedTaskService.capture({
      bridge: linkedTaskBridge,
      taskId,
      phase: 'before', sessionContract: contract, expectedBinding: binding
    }),
    (error) => error?.code === 'ARTIFACT_INTEGRITY_ERROR'
  );
  assert.deepEqual(linkedTaskBridge.sequence, []);
}

async function testForgedLiveInputsFailBeforeQueue(testRoot) {
  let queueCalls = 0;
  const queueRuntime = new Proxy({}, {
    get() {
      return async () => { queueCalls += 1; throw new Error('queue must not be called'); };
    }
  });
  const bridge = new SketchUpBridge({
    queueRuntime,
    agentContract: { rootDir: path.join(testRoot, 'forged-live-state') },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true }
  });
  const forgedHandle = `image-artifact:sha256:${'a'.repeat(64)}`;
  const forged = await bridge.start_agent_task({
    intent: 'reference_image_correction',
    instruction: 'An Agent capture handle must not impersonate live SketchUp.',
    inputs: {
      runtime: 'queue',
      reference_image_handle: forgedHandle,
      capture_image_handle: forgedHandle,
      session_contract: { runtime: 'queue' }
    }
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.error.code, 'INVALID_ARGUMENT');
  const provenance = await bridge.start_agent_task({
    intent: 'reference_image_correction',
    instruction: 'An Agent provenance claim must fail before queue.',
    inputs: {
      runtime: 'queue',
      reference_image_handle: forgedHandle,
      capture_provenance: { kind: 'server_live_capture' }
    }
  });
  assert.equal(provenance.ok, false);
  assert.equal(provenance.error.code, 'INVALID_ARGUMENT');
  const forgedFlag = await bridge.start_agent_task({
    intent: 'reference_image_correction',
    instruction: 'An Agent cannot request the internal server capture flag.',
    inputs: {
      runtime: 'queue',
      reference_image_handle: forgedHandle,
      server_visual_capture: true
    }
  });
  assert.equal(forgedFlag.ok, false);
  assert.equal(forgedFlag.error.code, 'INVALID_ARGUMENT');
  const validator = new ToolInputValidator(listToolDefinitions());
  assert.throws(
    () => validator.validate('capture_view', { runtime: 'queue', server_visual_capture: true }),
    (error) => error?.code === 'INVALID_ARGUMENT'
  );
  assert.equal(queueCalls, 0);
}

async function testRubyCaptureSourceContract() {
  const source = await fs.readFile(new URL('../sketchup_plugin/alma_sketchup_mcp.rb', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  def capture_view(params)'), source.indexOf('  def run_ruby_expert(params)'));
  assert.match(method, /model = active_model_required\('capture_view'\)/);
  assert.doesNotMatch(method, /active_model_or_new/);
  assert.match(method, /server visual capture requires view=current/);
  assert.match(method, /server visual capture does not accept a scene/);
  assert.match(method, /server visual capture requires zoom_extents=false/);
  assert.match(method, /capture-view-read-only-attestation\.v1/);
}

function adoptionFixture() {
  return {
    kind: 'adopt_open_model',
    runtime: 'queue',
    read_only: true,
    session_id: 'session-live-fixture',
    document_id: 'document-live-fixture',
    model_identity: {
      model_guid: 'guid-live-fixture',
      runtime_object_id: '701',
      title: 'Live Fixture',
      source_path: path.join(os.tmpdir(), 'live-visual-fixture.skp')
    },
    model_revision: `sha256:${'1'.repeat(64)}`,
    model_revision_complete: true,
    model_revision_total_seen: 4,
    model_revision_indexed: 4,
    occurrence_contract: 'canonical-occurrence-path.v1'
  };
}

function cameraFixture() {
  return { eye: [1000, -1000, 800], target: [0, 0, 0], up: [0, 0, 1], fov: 35 };
}

async function assertDirectoryEmptyOrMissing(directory) {
  try {
    assert.deepEqual(await fs.readdir(directory), []);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function directoryContains(directory, needle) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContains(candidate, needle)) return true;
    } else if (entry.isFile()) {
      const bytes = await fs.readFile(candidate);
      if (bytes.includes(Buffer.from(needle))) return true;
    }
  }
  return false;
}

await main();
