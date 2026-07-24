import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { VISUAL_CAPTURE_PROVENANCE_VERSION } from './visual-correction.mjs';

export const LIVE_VISUAL_CAPTURE_RECEIPT_VERSION = 'server-live-visual-capture-receipt.v1';

const SAFE_CAPTURE_SPEC = Object.freeze({
  view: 'current',
  scene: null,
  width: 1280,
  height: 720,
  antialias: true,
  compression: 1,
  zoom_extents: false
});

/**
 * Produces queue captures that an Agent cannot impersonate with a path, handle,
 * or provenance claim. The queue lock and Session Contract remain active for
 * the complete read-only adoption -> capture -> read-only adoption sequence.
 */
export class LiveVisualCaptureService {
  constructor({ imageArtifactStore, tempRoot } = {}) {
    if (!imageArtifactStore || typeof imageArtifactStore.ingestBuffer !== 'function') {
      throw new Error('LiveVisualCaptureService requires an immutable image artifact store.');
    }
    this.imageArtifactStore = imageArtifactStore;
    this.tempRoot = path.resolve(String(tempRoot || path.join(process.cwd(), '.alma-live-visual-captures')));
  }

  async capture({
    bridge,
    taskId,
    phase,
    sessionContract,
    expectedBinding,
    recursiveLimit = 5000,
    sourceCaptureProvenance = null
  } = {}) {
    assertCaptureRequest({ bridge, taskId, phase, sessionContract, expectedBinding });
    let taskTempRoot = null;
    let taskTempRootOwned = false;
    let tempDir = null;
    let tempDirOwned = false;
    try {
      const realTempRoot = await ensurePrivateRealDirectory(this.tempRoot);
      taskTempRoot = path.join(realTempRoot, safeTaskId(taskId));
      await ensurePrivateRealDirectory(taskTempRoot, { within: realTempRoot });
      taskTempRootOwned = true;
      tempDir = await fs.mkdtemp(path.join(taskTempRoot, `${phase}-`));
      await ensurePrivateRealDirectory(tempDir, { within: realTempRoot });
      tempDirOwned = true;
      const capturePath = path.join(tempDir, 'capture.png');
      const locked = await bridge.withLiveMutationAuthorization({
        runtime: 'queue',
        session_contract: sessionContract,
        operation: 'capture_view'
      }, async (authorizedBridge) => {
        const before = await authorizedBridge.adopt_open_model({
          runtime: 'queue',
          recursive: true,
          recursive_limit: recursiveLimit,
          read_only: true
        });
        assertAdoptionBinding(before, sessionContract, expectedBinding, 'before capture');

        const capture = await authorizedBridge.capture_view({
          path: capturePath,
          runtime: 'queue',
          view: SAFE_CAPTURE_SPEC.view,
          width: SAFE_CAPTURE_SPEC.width,
          height: SAFE_CAPTURE_SPEC.height,
          antialias: SAFE_CAPTURE_SPEC.antialias,
          compression: SAFE_CAPTURE_SPEC.compression,
          zoom_extents: SAFE_CAPTURE_SPEC.zoom_extents,
          server_visual_capture: true
        });

        const after = await authorizedBridge.adopt_open_model({
          runtime: 'queue',
          recursive: true,
          recursive_limit: recursiveLimit,
          read_only: true
        });
        assertAdoptionBinding(after, sessionContract, expectedBinding, 'after capture');
        assertSameReadOnlyAdoption(before, after);
        assertCaptureResponse(capture, { capturePath, before, after });
        const buffer = await readPrivateCapture(capturePath, this.imageArtifactStore.limits?.max_bytes);
        return { before, after, capture, buffer };
      });

      const ingested = await this.imageArtifactStore.ingestBuffer(locked.buffer, { mediaType: 'image/png' });
      const provenance = liveCaptureProvenance({
        taskId,
        phase,
        binding: expectedBinding,
        record: ingested.record,
        before: locked.before,
        after: locked.after,
        capture: locked.capture,
        sourceCaptureProvenance
      });
      return {
        record: structuredClone(ingested.record),
        provenance,
        capture_mode: 'server_live_current_view',
        cas_reused: ingested.cas_reused === true
      };
    } finally {
      if (tempDirOwned) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      if (taskTempRootOwned) await removeIfEmpty(taskTempRoot);
    }
  }
}

export function safeLiveVisualCaptureSpec() {
  return structuredClone(SAFE_CAPTURE_SPEC);
}

function assertCaptureRequest({ bridge, taskId, phase, sessionContract, expectedBinding }) {
  if (!bridge || typeof bridge.withLiveMutationAuthorization !== 'function') {
    throw new AgentContractError('HANDSHAKE_INVALID', 'The live visual capture bridge cannot enforce a Session Contract.');
  }
  safeTaskId(taskId);
  if (!['before', 'after'].includes(phase)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Live visual capture phase must be before or after.');
  }
  if (!sessionContract || sessionContract.runtime !== 'queue') {
    throw new AgentContractError('HANDSHAKE_REQUIRED', 'A fresh queue Session Contract is required for live visual capture.');
  }
  if (!/^model_[0-9a-f]{32}$/.test(String(expectedBinding?.model_key || ''))
    || !/^model-graph-[0-9a-f]{24}$/.test(String(expectedBinding?.graph_id || ''))
    || !/^sha256:[0-9a-f]{64}$/.test(String(expectedBinding?.model_revision || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Live visual capture requires a complete server-owned ModelGraph binding.');
  }
}

function assertAdoptionBinding(adoption, contract, binding, context) {
  if (adoption?.kind !== 'adopt_open_model'
    || adoption.runtime !== 'queue'
    || adoption.read_only !== true
    || adoption.model_revision_complete !== true
    || adoption.model_revision_total_seen !== adoption.model_revision_indexed) {
    throw new AgentContractError('MODEL_REVISION_INCOMPLETE', `The ${context} adoption is not a complete read-only model observation.`);
  }
  if (adoption.session_id !== contract.session_id) {
    throw new AgentContractError('HANDSHAKE_SESSION_MISMATCH', `The SketchUp plugin session changed ${context}.`);
  }
  if (adoption.document_id !== contract.document_id) {
    throw new AgentContractError('HANDSHAKE_DOCUMENT_MISMATCH', `The active SketchUp document changed ${context}.`);
  }
  if (canonicalJson(adoption.model_identity) !== canonicalJson(contract.model_identity)) {
    throw new AgentContractError('HANDSHAKE_MODEL_IDENTITY_MISMATCH', `The active SketchUp model identity changed ${context}.`);
  }
  if (adoption.model_revision !== contract.model_revision || adoption.model_revision !== binding.model_revision) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', `The active SketchUp model revision changed ${context}.`);
  }
  const identityHint = { ...adoption.model_identity, document_id: adoption.document_id };
  const modelKey = modelKeyForIdentity(modelIdentityForAdoption(adoption, { identityHint }));
  if (modelKey !== binding.model_key) {
    throw new AgentContractError('MODEL_IDENTITY_MISMATCH', `The active SketchUp model key changed ${context}.`);
  }
}

function assertSameReadOnlyAdoption(before, after) {
  for (const field of [
    'session_id', 'document_id', 'model_revision', 'model_revision_complete',
    'model_revision_total_seen', 'model_revision_indexed', 'occurrence_contract'
  ]) {
    if (before[field] !== after[field]) {
      const code = field === 'model_revision' ? 'MODEL_REVISION_MISMATCH' : 'HANDSHAKE_DOCUMENT_MISMATCH';
      throw new AgentContractError(code, `Live capture changed or crossed the model binding field ${field}.`);
    }
  }
  if (canonicalJson(before.model_identity) !== canonicalJson(after.model_identity)) {
    throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'Live capture crossed to a different SketchUp model identity.');
  }
}

function assertCaptureResponse(capture, { capturePath, before, after }) {
  if (!capture || capture.kind !== 'capture_view' || capture.runtime !== 'queue') {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'SketchUp did not return a live capture result.');
  }
  if (path.resolve(String(capture.file_path || '')) !== path.resolve(capturePath)) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'SketchUp returned a capture path other than the server-owned temporary path.');
  }
  if (capture.view !== SAFE_CAPTURE_SPEC.view
    || capture.scene !== null
    || capture.width !== SAFE_CAPTURE_SPEC.width
    || capture.height !== SAFE_CAPTURE_SPEC.height
    || capture.antialias !== SAFE_CAPTURE_SPEC.antialias
    || Number(capture.compression) !== SAFE_CAPTURE_SPEC.compression) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'SketchUp did not honor the server-owned safe capture specification.');
  }
  const attestation = capture.read_only_attestation;
  if (!attestation
    || attestation.version !== 'capture-view-read-only-attestation.v1'
    || attestation.server_visual_capture !== true
    || attestation.session_id !== before.session_id
    || attestation.document_id !== before.document_id
    || attestation.model_revision_before !== before.model_revision
    || attestation.model_revision_after !== after.model_revision
    || attestation.model_revision_complete_before !== true
    || attestation.model_revision_complete_after !== true
    || attestation.state_unchanged !== true
    || attestation.view_unchanged !== true
    || attestation.model_modified_before !== attestation.model_modified_after) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'SketchUp could not attest that live capture preserved model and view state.');
  }
  if (canonicalJson(attestation.model_identity) !== canonicalJson(before.model_identity)
    || canonicalJson(attestation.camera_before) !== canonicalJson(attestation.camera_after)
    || canonicalJson(capture.camera) !== canonicalJson(attestation.camera_before)) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The live capture camera or model identity changed during capture.');
  }
}

function liveCaptureProvenance({ taskId, phase, binding, record, before, after, capture, sourceCaptureProvenance }) {
  const captureSpecHash = sha256Canonical(SAFE_CAPTURE_SPEC);
  const cameraHash = sha256Canonical(capture.camera);
  if (phase === 'after') {
    if (!sourceCaptureProvenance
      || sourceCaptureProvenance.kind !== 'server_live_capture'
      || sourceCaptureProvenance.capture_spec_hash !== captureSpecHash) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Live visual QA requires the original server capture specification.');
    }
    if (sourceCaptureProvenance.camera_hash !== cameraHash) {
      throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The current SketchUp camera no longer matches the reviewed source capture.');
    }
  }
  const capturedAt = String(capture.captured_at || new Date().toISOString());
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'SketchUp returned an invalid live capture timestamp.');
  }
  const captureId = `visual-capture-${sha256Canonical({ task_id: taskId, phase, image_sha256: record.sha256, model_revision: binding.model_revision }).slice(7, 31)}`;
  const receiptCore = {
    version: VISUAL_CAPTURE_PROVENANCE_VERSION,
    kind: 'server_live_capture',
    capture_id: captureId,
    provider: 'sketchup_capture_view',
    runtime: 'queue',
    source_task_id: taskId,
    phase,
    model_key: binding.model_key,
    graph_id: binding.graph_id,
    model_revision: binding.model_revision,
    image_handle: record.handle,
    image_sha256: record.sha256,
    capture_spec_hash: captureSpecHash,
    camera_hash: cameraHash,
    session_binding_hash: sha256Canonical({
      session_id: before.session_id,
      document_id: before.document_id,
      model_identity: before.model_identity,
      after_session_id: after.session_id,
      after_document_id: after.document_id
    }),
    state_unchanged: true,
    view_unchanged: true,
    captured_at: capturedAt
  };
  const receiptHash = sha256Canonical({
    receipt_version: LIVE_VISUAL_CAPTURE_RECEIPT_VERSION,
    ...receiptCore
  });
  return {
    ...receiptCore,
    receipt_id: `live-capture-receipt-${receiptHash.slice(7, 31)}`,
    receipt_hash: receiptHash
  };
}

async function readPrivateCapture(filePath, configuredMaxBytes) {
  const maxBytes = Number(configuredMaxBytes || 20 * 1024 * 1024);
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) {
      throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The server capture is not a bounded regular file.');
    }
    const buffer = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || buffer.length !== before.size) {
      throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The server capture changed while it was being ingested.');
    }
    return Buffer.from(buffer);
  } catch (error) {
    if (error instanceof AgentContractError) throw error;
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The server-owned live capture could not be read safely.', { cause: error });
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function removeIfEmpty(directory) {
  try {
    if ((await fs.readdir(directory)).length === 0) await fs.rmdir(directory);
  } catch (_) {
    // A concurrent task or prior cleanup owns any remaining entry.
  }
}

async function ensurePrivateRealDirectory(directory, { within } = {}) {
  const candidate = path.resolve(directory);
  let stat;
  try {
    stat = await fs.lstat(candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await fs.mkdir(candidate, { recursive: true, mode: 0o700 });
    stat = await fs.lstat(candidate);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The live visual capture temporary root must be a real directory.');
  }
  const real = await fs.realpath(candidate);
  if (within && !isWithin(real, await fs.realpath(within))) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The live visual capture temporary directory escaped its private root.');
  }
  await fs.chmod(real, 0o700);
  return real;
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeTaskId(value) {
  const taskId = String(value || '');
  if (!/^task_[0-9a-f-]+$/i.test(taskId)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Live visual capture requires a server task_id.');
  }
  return taskId;
}
