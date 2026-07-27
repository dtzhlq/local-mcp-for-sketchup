import sharp from 'sharp';
import { AgentContractError, markUntrustedData, sha256Canonical } from './agent-contract.mjs';
import { compareBackgroundNormalizedImages } from './background-normalized-visual-comparison.mjs';
import { validateExistingModelEditOperations } from './existing-model-editing.mjs';
import { validateExpertDocument } from './expert-compiler.mjs';
import { ImmutableImageArtifactStore } from './image-artifact-store.mjs';
import { validateModelGraphSemantics } from './model-graph.mjs';
import { validateReferenceVisualSnapshot } from './reference-visual-qa.mjs';

export const VISUAL_EVIDENCE_VERSION = 'visual-correction-evidence.v1';
export const VISUAL_CORRECTION_PATCH_VERSION = 'visual-correction-patch.v1';
export const VISUAL_CORRECTION_QA_VERSION = 'visual-correction-qa.v1';
export const VISUAL_CORRECTION_QA_RESULT_VERSION = 'visual-correction-qa-result.v1';
export const VISUAL_SOURCE_LINEAGE_VERSION = 'visual-correction-source-lineage.v1';
export const VISUAL_CAPTURE_PROVENANCE_VERSION = 'visual-capture-provenance.v1';
export const VISUAL_APPLY_RECEIPT_VERSION = 'visual-correction-apply-receipt.v1';

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MODEL_KEY_PATTERN = /^model_[0-9a-f]{32}$/;
const GRAPH_ID_PATTERN = /^model-graph-[0-9a-f]{24}$/;
const IMAGE_HANDLE_PATTERN = /^image-artifact:sha256:[0-9a-f]{64}$/;
const SOURCE_TASK_PATTERN = /^task_[A-Za-z0-9_-]+$/;

export async function analyzeReferenceImageCorrection({
  imageArtifactStore,
  referenceHandle,
  captureHandle,
  captureProvenance,
  modelGraph,
  modelBinding,
  sourceTaskId,
  modelSnapshot,
  referenceSpec,
  correctionTargets = [],
  correctionOperations = [],
  referenceImagePath,
  captureImagePath,
  allowedRoots,
  outputDir
} = {}) {
  rejectPathArguments({ referenceImagePath, captureImagePath, allowedRoots, outputDir }, 'analyzeReferenceImageCorrectionFromPaths');
  assertArtifactStore(imageArtifactStore);
  const binding = assertCurrentModelBinding(modelGraph, modelBinding);
  const taskId = requiredSourceTaskId(sourceTaskId);
  const provenance = assertCaptureProvenance(captureProvenance, binding, taskId, 'before');
  const [reference, capture] = await Promise.all([
    readNormalizedImage(imageArtifactStore, referenceHandle),
    readNormalizedImage(imageArtifactStore, captureHandle)
  ]);
  assertCaptureArtifactBinding(provenance, capture.record);
  const resolvedTargets = resolveCorrectionTargets(modelGraph, correctionTargets);
  const operationValidation = validateAndBindCorrectionOperations(modelGraph, resolvedTargets, correctionOperations);
  const comparison = compareImages(reference, capture);
  const referenceQa = referenceSpec && modelSnapshot
    ? validateReferenceVisualSnapshot(modelSnapshot, { spec: referenceSpec, includePreview: false })
    : null;
  const confidence = evidenceConfidence(comparison, referenceQa);
  const blockers = [];
  if (comparison.foreground.reference.coverage === 0 || comparison.foreground.capture.coverage === 0) {
    blockers.push('foreground_not_detected');
  }
  const mappingDeclaration = {
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    declared_target_count: correctionTargets.length,
    declared_operation_count: correctionOperations.length
  };
  const evidenceCore = {
    version: VISUAL_EVIDENCE_VERSION,
    kind: 'reference_image_existing_model_evidence',
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    source_task_id: taskId,
    model_key: binding.model_key,
    graph_id: binding.graph_id,
    model_revision: binding.model_revision,
    reference_image: publicImageBinding(reference.record),
    captured_image: {
      ...publicImageBinding(capture.record),
      capture_provenance: provenance
    },
    alignment: comparison.alignment,
    difference: comparison.difference,
    foreground: comparison.foreground,
    reference_model_qa: referenceQa ? markUntrustedData(referenceQa, 'image_derived_reference_spec') : null,
    confidence,
    mapping_declaration: mappingDeclaration,
    blockers
  };
  const evidenceHash = sha256Canonical(evidenceCore);
  const evidence = {
    ...evidenceCore,
    evidence_id: `visual-evidence-${evidenceHash.slice(7, 31)}`,
    evidence_hash: evidenceHash
  };

  const privatePayloadCore = {
    version: 'visual-correction-private-payload.v1',
    kind: 'server_private_visual_correction_payload',
    source_task_id: taskId,
    model_key: binding.model_key,
    graph_id: binding.graph_id,
    model_revision: binding.model_revision,
    evidence_id: evidence.evidence_id,
    evidence_hash: evidence.evidence_hash,
    targets: resolvedTargets.map((entry) => structuredClone(entry.target)),
    operations: structuredClone(operationValidation.operations),
    operation_contracts: structuredClone(operationValidation.operation_contracts),
    risk_level: operationValidation.risk_level,
    mapping_declaration: mappingDeclaration
  };
  const privatePayloadHash = sha256Canonical(privatePayloadCore);
  const opaqueSource = `source_visual_correction:${taskId}`;
  const patchCore = {
    version: VISUAL_CORRECTION_PATCH_VERSION,
    kind: 'visual_correction_patch',
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    source_task_id: taskId,
    model_key: binding.model_key,
    graph_id: binding.graph_id,
    model_revision: binding.model_revision,
    evidence_id: evidence.evidence_id,
    evidence_hash: evidence.evidence_hash,
    reference_image: publicImageBinding(reference.record),
    captured_image: {
      ...publicImageBinding(capture.record),
      capture_provenance: provenance
    },
    private_payload_hash: privatePayloadHash,
    mapping_declaration: mappingDeclaration,
    risk_level: operationValidation.risk_level,
    blockers,
    execution_allowed: false,
    review_required: true,
    execution_route: 'trusted_reviewed_existing_model_edit_only',
    next_action: blockers.length
      ? { action: 'submit_better_visual_evidence', source_visual_correction: null }
      : { action: 'start_reviewed_existing_model_edit', source_visual_correction: opaqueSource }
  };
  const patchHash = sha256Canonical(patchCore);
  const correctionPatch = {
    ...patchCore,
    correction_patch_id: `visual-patch-${patchHash.slice(7, 31)}`,
    patch_hash: patchHash
  };
  const privateCorrectionPatch = {
    ...privatePayloadCore,
    private_payload_hash: privatePayloadHash,
    correction_patch_id: correctionPatch.correction_patch_id,
    patch_hash: correctionPatch.patch_hash
  };
  const artifacts = await buildVisualArtifacts(imageArtifactStore, reference, capture, 'before_correction');
  return {
    evidence,
    correction_patch: correctionPatch,
    server_private: { correction_patch: privateCorrectionPatch },
    artifacts,
    agent_compatibility: {
      visual_agent_required: false,
      local_files_required: false,
      structured_summary_available: true
    },
    capture_mode: provenance.kind === 'server_live_capture' ? 'server_live_current_view' : 'provided_server_artifact_only'
  };
}

export async function analyzeReferenceImageCorrectionFromPaths({
  imageArtifactStore,
  referenceImagePath,
  captureImagePath,
  ...options
} = {}) {
  assertArtifactStore(imageArtifactStore);
  const [reference, capture] = await Promise.all([
    imageArtifactStore.ingestPath(referenceImagePath),
    imageArtifactStore.ingestPath(captureImagePath)
  ]);
  return analyzeReferenceImageCorrection({
    ...options,
    imageArtifactStore,
    referenceHandle: reference.record.handle,
    captureHandle: capture.record.handle
  });
}

export function buildVisualCorrectionSourceLineage({
  evidence,
  correctionPatch,
  privateCorrectionPatch,
  plan,
  applyReceipt
} = {}) {
  assertEvidenceIntegrity(evidence);
  assertPatchIntegrity(correctionPatch);
  assertPrivatePatchIntegrity(privateCorrectionPatch, correctionPatch);
  const sourcePlan = normalizeSourcePlan(plan, evidence);
  const receipt = assertApplyReceipt(applyReceipt);
  if (receipt.plan_id !== sourcePlan.plan_id || receipt.plan_hash !== sourcePlan.plan_hash) {
    throw lineageError('The visual correction apply receipt does not match the reviewed plan.');
  }
  if (receipt.model_key !== evidence.model_key) {
    throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The apply receipt model identity differs from the visual source.');
  }
  if (receipt.model_revision_before !== evidence.model_revision) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The apply receipt does not begin at the visual evidence revision.');
  }
  if (correctionPatch.evidence_id !== evidence.evidence_id
    || correctionPatch.evidence_hash !== evidence.evidence_hash
    || privateCorrectionPatch.evidence_id !== evidence.evidence_id
    || privateCorrectionPatch.evidence_hash !== evidence.evidence_hash) {
    throw lineageError('The visual patch is not bound to the supplied evidence.');
  }
  const core = {
    version: VISUAL_SOURCE_LINEAGE_VERSION,
    kind: 'visual_correction_source_lineage',
    source_visual_correction: `source_visual_correction:${evidence.source_task_id}`,
    source_task_id: evidence.source_task_id,
    model_key: evidence.model_key,
    graph_id: evidence.graph_id,
    before_model_revision: evidence.model_revision,
    reference_image: structuredClone(evidence.reference_image),
    before_capture: structuredClone(evidence.captured_image),
    source_evidence: {
      evidence_id: evidence.evidence_id,
      evidence_hash: evidence.evidence_hash,
      difference_mean_absolute_error: evidence.difference.mean_absolute_error
    },
    source_patch: {
      correction_patch_id: correctionPatch.correction_patch_id,
      patch_hash: correctionPatch.patch_hash,
      private_payload_hash: correctionPatch.private_payload_hash,
      risk_level: correctionPatch.risk_level
    },
    source_plan: sourcePlan,
    apply_receipt: receipt
  };
  return { ...core, lineage_hash: sha256Canonical(core) };
}

export async function verifyReferenceImageCorrection({
  imageArtifactStore,
  referenceHandle,
  recaptureHandle,
  recaptureProvenance,
  sourceLineage,
  afterModelBinding,
  qaTaskId,
  referenceImagePath,
  captureImagePath,
  recaptureImagePath,
  previousEvidence,
  allowedRoots,
  outputDir
} = {}) {
  rejectPathArguments({ referenceImagePath, captureImagePath, recaptureImagePath, previousEvidence, allowedRoots, outputDir }, 'verifyReferenceImageCorrectionFromPaths');
  assertArtifactStore(imageArtifactStore);
  const lineage = assertSourceLineage(sourceLineage);
  const binding = normalizeModelBinding(afterModelBinding);
  const taskId = requiredSourceTaskId(qaTaskId);
  if (binding.model_key !== lineage.model_key) {
    throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The current model identity differs from the visual correction lineage.');
  }
  if (binding.model_revision !== lineage.apply_receipt.model_revision_after) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The current model revision is stale for visual correction QA.');
  }
  const provenance = assertCaptureProvenance(recaptureProvenance, binding, taskId, 'after');
  if (referenceHandle !== lineage.reference_image.handle) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction QA must reuse the exact source reference image handle.');
  }
  const [reference, recapture] = await Promise.all([
    readNormalizedImage(imageArtifactStore, referenceHandle),
    readNormalizedImage(imageArtifactStore, recaptureHandle)
  ]);
  assertCaptureArtifactBinding(provenance, recapture.record);
  if (reference.record.sha256 !== lineage.reference_image.sha256) {
    throw lineageError('The source reference image hash does not match its lineage.');
  }
  const comparison = compareImages(reference, recapture);
  const backgroundNormalized = await compareBackgroundNormalizedImages({
    referenceBuffer: reference.buffer,
    captureBuffer: recapture.buffer
  });
  const previousMae = lineage.source_evidence.difference_mean_absolute_error;
  const improved = comparison.difference.mean_absolute_error < previousMae;
  const pass = comparison.difference.mean_absolute_error <= 0.02
    && comparison.alignment.foreground_center_delta_norm <= 0.03;
  const core = {
    version: VISUAL_CORRECTION_QA_VERSION,
    kind: 'visual_correction_qa',
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    qa_task_id: taskId,
    source_task_id: lineage.source_task_id,
    source_lineage_hash: lineage.lineage_hash,
    model_key: lineage.model_key,
    before_graph_id: lineage.graph_id,
    after_graph_id: binding.graph_id,
    before_model_revision: lineage.before_model_revision,
    after_model_revision: binding.model_revision,
    source_evidence: structuredClone(lineage.source_evidence),
    source_patch: structuredClone(lineage.source_patch),
    source_plan: structuredClone(lineage.source_plan),
    apply_receipt: structuredClone(lineage.apply_receipt),
    reference_image: publicImageBinding(reference.record),
    recaptured_image: {
      ...publicImageBinding(recapture.record),
      capture_provenance: provenance
    },
    alignment: comparison.alignment,
    difference: comparison.difference,
    improved,
    verdict: pass ? 'pass' : improved ? 'review' : 'fail',
    review_required: !pass,
    next_action: pass
      ? null
      : { action: 'review_visual_residuals', source_visual_correction: lineage.source_visual_correction }
  };
  const qaHash = sha256Canonical(core);
  const report = {
    ...core,
    qa_id: `visual-qa-${qaHash.slice(7, 31)}`,
    qa_hash: qaHash
  };
  const [visualArtifacts, normalizedArtifacts] = await Promise.all([
    buildVisualArtifacts(imageArtifactStore, reference, recapture, 'after_correction'),
    ingestRenderedVisualArtifacts(
      imageArtifactStore,
      backgroundNormalized.artifacts,
      'background_normalized'
    )
  ]);
  const artifacts = { ...visualArtifacts, ...normalizedArtifacts };
  const resultCore = {
    version: VISUAL_CORRECTION_QA_RESULT_VERSION,
    kind: 'visual_correction_qa_result',
    report,
    background_normalized_comparison: backgroundNormalized.comparison,
    image_artifacts: artifacts,
    visual_agent_required: false,
    local_files_required: false,
    structured_summary_available: true,
    capture_mode: provenance.kind === 'server_live_capture' ? 'server_live_current_view' : 'provided_server_artifact_only',
    diagnostic_boundary: {
      content_trust: 'untrusted_data',
      policy_effect: 'none',
      target_selection_allowed: false,
      operation_selection_allowed: false,
      approval_state_change_allowed: false,
      execution_authorization_allowed: false,
      visual_similarity_accepted: false
    }
  };
  const resultHash = sha256Canonical(resultCore);
  const result = {
    ...resultCore,
    result_id: `visual-qa-result-${resultHash.slice(7, 31)}`,
    result_hash: resultHash
  };
  return {
    report,
    background_normalized_comparison: backgroundNormalized.comparison,
    result,
    artifacts,
    agent_compatibility: {
      visual_agent_required: false,
      local_files_required: false,
      structured_summary_available: true
    },
    capture_mode: result.capture_mode
  };
}

export async function verifyReferenceImageCorrectionFromPaths({
  imageArtifactStore,
  referenceImagePath,
  recaptureImagePath,
  ...options
} = {}) {
  assertArtifactStore(imageArtifactStore);
  const [reference, recapture] = await Promise.all([
    imageArtifactStore.ingestPath(referenceImagePath),
    imageArtifactStore.ingestPath(recaptureImagePath)
  ]);
  return verifyReferenceImageCorrection({
    ...options,
    imageArtifactStore,
    referenceHandle: reference.record.handle,
    recaptureHandle: recapture.record.handle
  });
}

export function visualCorrectionApplyReceiptHash(receipt) {
  const core = structuredClone(receipt || {});
  delete core.receipt_hash;
  return sha256Canonical(core);
}

function assertArtifactStore(store) {
  if (!(store instanceof ImmutableImageArtifactStore)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction requires an ImmutableImageArtifactStore.');
  }
}

function rejectPathArguments(values, wrapper) {
  if (Object.values(values).some((value) => value !== undefined)) {
    throw new AgentContractError('INVALID_ARGUMENT', `The handle-only visual contract does not accept paths or legacy evidence; use ${wrapper} for controlled path compatibility.`);
  }
}

function normalizeModelBinding(value) {
  const binding = {
    model_key: String(value?.model_key || ''),
    graph_id: String(value?.graph_id || ''),
    model_revision: String(value?.model_revision || '')
  };
  if (!MODEL_KEY_PATTERN.test(binding.model_key)) {
    throw new AgentContractError('MODEL_IDENTITY_UNAVAILABLE', 'Visual correction requires a server-derived model_key.');
  }
  if (!GRAPH_ID_PATTERN.test(binding.graph_id) || !SHA256_PATTERN.test(binding.model_revision)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction requires a valid graph and model revision binding.');
  }
  return binding;
}

function assertCurrentModelBinding(graph, value) {
  try {
    validateModelGraphSemantics(graph);
  } catch (error) {
    throw new AgentContractError('MODEL_GRAPH_INTEGRITY_ERROR', 'Visual correction requires an intact ModelGraph.', {
      details: { reason: error?.code || 'invalid_model_graph' }
    });
  }
  if (graph.completeness?.recursive_truncated === true || graph.completeness?.complete !== true) {
    throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Visual correction cannot map targets from an incomplete or truncated ModelGraph.');
  }
  const binding = normalizeModelBinding(value);
  if (binding.graph_id !== graph.graph_id) {
    throw new AgentContractError('MODEL_GRAPH_INTEGRITY_ERROR', 'The server ModelGraph binding does not match the current graph.');
  }
  if (binding.model_revision !== graph.model_revision) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The visual correction source revision is stale.');
  }
  return binding;
}

function requiredSourceTaskId(value) {
  const taskId = String(value || '');
  if (!SOURCE_TASK_PATTERN.test(taskId)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction requires a server task_id.');
  }
  return taskId;
}

function assertCaptureProvenance(value, binding, sourceTaskId, expectedPhase) {
  const provenance = structuredClone(value || {});
  const validKind = provenance.kind === 'trusted_test_capture'
    || provenance.kind === 'server_live_capture';
  if (provenance.version !== VISUAL_CAPTURE_PROVENANCE_VERSION
    || !validKind
    || typeof provenance.capture_id !== 'string'
    || !provenance.capture_id
    || provenance.source_task_id !== sourceTaskId
    || provenance.model_key !== binding.model_key
    || provenance.graph_id !== binding.graph_id
    || provenance.model_revision !== binding.model_revision
    || !Number.isFinite(Date.parse(provenance.captured_at))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Image capture provenance is missing or does not match the bound model/task.');
  }
  if (provenance.kind === 'trusted_test_capture'
    && (provenance.provider !== 'test_fixture' || provenance.runtime !== 'mock')) {
    throw new AgentContractError('INVALID_ARGUMENT', 'A trusted test capture must remain explicitly mock/test provenance.');
  }
  if (provenance.kind === 'server_live_capture'
    && (provenance.provider !== 'sketchup_capture_view' || provenance.runtime !== 'queue')) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Live capture provenance must come from server-side SketchUp capture_view.');
  }
  if (provenance.kind === 'server_live_capture') {
    const { receipt_id: receiptId, receipt_hash: receiptHash, ...receiptCore } = provenance;
    const expectedReceiptHash = sha256Canonical({
      receipt_version: 'server-live-visual-capture-receipt.v1',
      ...receiptCore
    });
    if (provenance.phase !== expectedPhase
      || !IMAGE_HANDLE_PATTERN.test(String(provenance.image_handle || ''))
      || !SHA256_PATTERN.test(String(provenance.image_sha256 || ''))
      || !SHA256_PATTERN.test(String(provenance.capture_spec_hash || ''))
      || !SHA256_PATTERN.test(String(provenance.camera_hash || ''))
      || !SHA256_PATTERN.test(String(provenance.session_binding_hash || ''))
      || provenance.state_unchanged !== true
      || provenance.view_unchanged !== true
      || !/^live-capture-receipt-[0-9a-f]{24}$/.test(String(receiptId || ''))
      || receiptHash !== expectedReceiptHash
      || receiptId !== `live-capture-receipt-${receiptHash.slice(7, 31)}`) {
      throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Live capture provenance receipt is incomplete or failed integrity validation.');
    }
  }
  return provenance;
}

function assertCaptureArtifactBinding(provenance, record) {
  if (provenance.kind !== 'server_live_capture') return;
  if (provenance.image_handle !== record.handle || provenance.image_sha256 !== record.sha256) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Live capture provenance does not match the immutable image bytes.');
  }
}

async function readNormalizedImage(store, handle) {
  if (!IMAGE_HANDLE_PATTERN.test(String(handle || ''))) {
    throw new AgentContractError('ARTIFACT_NOT_FOUND', 'Visual correction requires a valid immutable image handle.');
  }
  const [record, buffer] = await Promise.all([store.inspect(handle), store.readBuffer(handle)]);
  let normalized;
  try {
    normalized = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: 40_000_000,
      sequentialRead: true
    }).flatten({ background: '#ffffff' })
      .resize(128, 128, { fit: 'contain', background: '#ffffff' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new AgentContractError('INVALID_ARGUMENT', 'The immutable image could not be normalized for visual evidence.');
  }
  return {
    record,
    buffer,
    data: normalized.data,
    width: normalized.info.width,
    height: normalized.info.height,
    channels: normalized.info.channels
  };
}

function publicImageBinding(record) {
  return {
    handle: record.handle,
    sha256: record.sha256,
    media_type: record.media_type,
    format: record.format,
    size_bytes: record.size_bytes,
    width: record.width,
    height: record.height,
    channels: record.channels,
    content_trust: 'untrusted_data',
    policy_effect: 'none'
  };
}

function resolveCorrectionTargets(graph, values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction requires at least one mapped occurrence target.');
  }
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const resolved = resolveOccurrence(graph, value, 'correction target');
    if (seen.has(resolved.node.node_id)) continue;
    seen.add(resolved.node.node_id);
    result.push({ node: resolved.node, target: canonicalEditingTarget(resolved.node, resolved.input) });
  }
  return result;
}

function resolveOccurrence(graph, value, context) {
  const input = typeof value === 'string' ? { target_id: value } : structuredClone(value || {});
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentContractError('INVALID_ARGUMENT', `Visual ${context} must be an occurrence reference.`);
  }
  const selectors = [
    selector(input, ['node_id'], 'node_id'),
    selector(input, ['entity_path', 'entityPath', 'target_path', 'targetPath'], 'entity_path'),
    selector(input, ['persistent_id', 'persistentId'], 'persistent_id'),
    selector(input, ['target_id', 'targetId', 'id', 'reference'], 'target_id'),
    selector(input, ['name'], 'name')
  ].filter(Boolean);
  if (selectors.length !== 1) {
    throw new AgentContractError('INVALID_ARGUMENT', `Visual ${context} requires exactly one occurrence selector.`);
  }
  const selected = selectors[0];
  const occurrences = graph.nodes.filter((node) => node.node_type === 'occurrence');
  const matches = occurrences.filter((node) => occurrenceMatches(node, selected));
  if (matches.length !== 1) {
    throw new AgentContractError('INVALID_ARGUMENT', matches.length
      ? `Visual ${context} is ambiguous in the current ModelGraph.`
      : `Visual ${context} does not resolve in the current ModelGraph.`);
  }
  const node = matches[0];
  if (node.synthetic === true || node.editable !== true) {
    throw new AgentContractError('POLICY_DENIED', `Visual ${context} is not an editable authoritative occurrence.`);
  }
  if (node.locked === true || node.effective_locked === true) {
    throw new AgentContractError('POLICY_DENIED', `Visual ${context} or an occurrence ancestor is locked.`);
  }
  return { node, input };
}

function selector(input, keys, kind) {
  const present = keys.filter((key) => input[key] !== undefined && input[key] !== null && input[key] !== '');
  if (!present.length) return null;
  const values = [...new Set(present.map((key) => String(input[key])))];
  if (values.length !== 1) {
    throw new AgentContractError('INVALID_ARGUMENT', `Visual occurrence ${kind} aliases disagree.`);
  }
  return { kind, value: values[0] };
}

function occurrenceMatches(node, selected) {
  switch (selected.kind) {
  case 'node_id': return node.node_id === selected.value;
  case 'entity_path': return node.entity_path === selected.value;
  case 'persistent_id': return String(node.persistent_id ?? '') === selected.value;
  case 'name': return node.name === selected.value;
  default:
    return [node.reference, node.persistent_id, node.node_id, node.entity_path]
      .some((candidate) => String(candidate ?? '') === selected.value);
  }
}

function canonicalEditingTarget(node, input) {
  if (node.entity_path) {
    const instancePolicy = input.instance_policy ?? input.instancePolicy;
    if (node.shared_definition === true && !['definition_wide', 'make_unique'].includes(instancePolicy)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'A shared-definition visual target requires an explicit instance policy.');
    }
    const policy = instancePolicy || 'definition_wide';
    const target = {
      node_id: node.node_id,
      entity_path: node.entity_path,
      edit_scope: 'instance_path',
      instance_policy: policy
    };
    if (policy === 'make_unique') {
      const instanceId = input.instance_id ?? input.instanceId;
      if (typeof instanceId !== 'string' || !instanceId.trim()) {
        throw new AgentContractError('INVALID_ARGUMENT', 'make_unique visual correction requires an explicit instance_id.');
      }
      target.instance_id = instanceId;
    }
    return target;
  }
  return {
    node_id: node.node_id,
    target_id: node.reference,
    edit_scope: 'top_level'
  };
}

function validateAndBindCorrectionOperations(graph, resolvedTargets, operations) {
  const firstValidation = validateExistingModelEditOperations(operations);
  const byNode = new Map(resolvedTargets.map((entry) => [entry.node.node_id, entry]));
  const bound = firstValidation.operations.map((operation, index) => bindOperation(graph, byNode, operation, index));
  const finalValidation = validateExistingModelEditOperations(bound);
  try {
    validateExpertDocument(finalValidation.expert_validation_document, { maxOperations: 200 });
  } catch (error) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Visual correction operations failed the shared safe-DSL contract.', {
      details: { reason: String(error?.message || 'expert_document_invalid') }
    });
  }
  return finalValidation;
}

function bindOperation(graph, declaredTargets, operation, index) {
  const normalized = structuredClone(operation);
  const primary = operationPrimaryReference(operation);
  const targetArray = Array.isArray(operation.targets) ? operation.targets : [];
  if (!primary && targetArray.length === 0) {
    throw new AgentContractError('INVALID_ARGUMENT', `Visual correction operation ${index} does not identify a mapped target.`);
  }
  if (primary) {
    const resolved = resolveOccurrence(graph, primary, `operation ${index} target`);
    const declared = declaredTargets.get(resolved.node.node_id);
    assertOperationTargetAllowed(declared, resolved.node, operation.op, index);
    clearPrimaryTargetAliases(normalized);
    Object.assign(normalized, editingOperationTarget(declared.target));
  }
  if (targetArray.length) {
    normalized.targets = targetArray.map((target) => {
      const resolved = resolveOccurrence(graph, target, `operation ${index} auxiliary target`);
      const declared = declaredTargets.get(resolved.node.node_id);
      assertOperationTargetAllowed(declared, resolved.node, operation.op, index);
      return editingOperationTarget(declared.target);
    });
  }
  const toolValues = operation.tools ?? operation.tool_ids ?? operation.toolIds;
  if (toolValues !== undefined) {
    const list = Array.isArray(toolValues) ? toolValues : [toolValues];
    normalized.tools = list.map((target) => {
      const resolved = resolveOccurrence(graph, target, `operation ${index} tool target`);
      const declared = declaredTargets.get(resolved.node.node_id);
      assertOperationTargetAllowed(declared, resolved.node, operation.op, index);
      return editingOperationTarget(declared.target);
    });
    delete normalized.tool_ids;
    delete normalized.toolIds;
  }
  return normalized;
}

function operationPrimaryReference(operation) {
  const pathValue = operation.entity_path ?? operation.entityPath ?? operation.target_path ?? operation.targetPath;
  if (pathValue !== undefined) return { entity_path: pathValue };
  const targetId = operation.target_id ?? operation.targetId ?? operation.object_id ?? operation.objectId ?? operation.target ?? operation.object;
  return targetId === undefined ? null : { target_id: targetId };
}

function assertOperationTargetAllowed(declared, node, operation, index) {
  if (!declared) {
    throw new AgentContractError('INVALID_ARGUMENT', `Visual correction operation ${index} references an undeclared target.`);
  }
  if (!Array.isArray(node.allowed_operations) || !node.allowed_operations.includes(operation)) {
    throw new AgentContractError('OPERATION_NOT_ALLOWED', `Visual correction operation ${operation} is not allowed for its ModelGraph occurrence.`);
  }
}

function clearPrimaryTargetAliases(operation) {
  for (const key of ['entity_path', 'entityPath', 'target_path', 'targetPath', 'target_id', 'targetId', 'object_id', 'objectId', 'target', 'object', 'edit_scope', 'editScope', 'instance_policy', 'instancePolicy', 'instance_id', 'instanceId']) {
    delete operation[key];
  }
}

function editingOperationTarget(target) {
  const result = structuredClone(target);
  delete result.node_id;
  return result;
}

function assertEvidenceIntegrity(evidence) {
  if (!evidence || evidence.version !== VISUAL_EVIDENCE_VERSION || evidence.kind !== 'reference_image_existing_model_evidence') {
    throw lineageError('The source visual evidence contract is invalid.');
  }
  const core = structuredClone(evidence);
  delete core.evidence_id;
  delete core.evidence_hash;
  const expected = sha256Canonical(core);
  if (evidence.evidence_hash !== expected || evidence.evidence_id !== `visual-evidence-${expected.slice(7, 31)}`) {
    throw lineageError('The source visual evidence hash is invalid.');
  }
}

function assertPatchIntegrity(patch) {
  if (!patch || patch.version !== VISUAL_CORRECTION_PATCH_VERSION || patch.kind !== 'visual_correction_patch') {
    throw lineageError('The source visual correction patch contract is invalid.');
  }
  const core = structuredClone(patch);
  delete core.correction_patch_id;
  delete core.patch_hash;
  const expected = sha256Canonical(core);
  if (patch.patch_hash !== expected || patch.correction_patch_id !== `visual-patch-${expected.slice(7, 31)}`) {
    throw lineageError('The source visual correction patch hash is invalid.');
  }
  if (Object.hasOwn(patch, 'targets') || Object.hasOwn(patch, 'operations')) {
    throw lineageError('The public visual correction patch leaked private execution fields.');
  }
}

function assertPrivatePatchIntegrity(privatePatch, publicPatch) {
  if (!privatePatch || privatePatch.version !== 'visual-correction-private-payload.v1'
    || privatePatch.kind !== 'server_private_visual_correction_payload') {
    throw lineageError('The server-private visual correction payload is missing.');
  }
  const core = structuredClone(privatePatch);
  delete core.private_payload_hash;
  delete core.correction_patch_id;
  delete core.patch_hash;
  const expected = sha256Canonical(core);
  if (privatePatch.private_payload_hash !== expected
    || publicPatch.private_payload_hash !== expected
    || privatePatch.correction_patch_id !== publicPatch.correction_patch_id
    || privatePatch.patch_hash !== publicPatch.patch_hash) {
    throw lineageError('The server-private visual correction payload hash is invalid.');
  }
}

function normalizeSourcePlan(value, evidence) {
  const plan = {
    plan_id: String(value?.plan_id || ''),
    plan_hash: String(value?.plan_hash || ''),
    model_key: String(value?.model_key || ''),
    model_revision: String(value?.model_revision || ''),
    source_visual_correction: String(value?.source_visual_correction || '')
  };
  if (!plan.plan_id || !SHA256_PATTERN.test(plan.plan_hash)
    || plan.model_key !== evidence.model_key
    || plan.model_revision !== evidence.model_revision
    || plan.source_visual_correction !== `source_visual_correction:${evidence.source_task_id}`) {
    throw lineageError('The reviewed plan is not bound to the source visual correction.');
  }
  return plan;
}

function assertApplyReceipt(value) {
  const receipt = structuredClone(value || {});
  if (receipt.version !== VISUAL_APPLY_RECEIPT_VERSION
    || receipt.kind !== 'reviewed_existing_model_edit_apply_receipt'
    || typeof receipt.receipt_id !== 'string'
    || !receipt.receipt_id
    || typeof receipt.plan_id !== 'string'
    || !receipt.plan_id
    || !SHA256_PATTERN.test(String(receipt.plan_hash || ''))
    || !MODEL_KEY_PATTERN.test(String(receipt.model_key || ''))
    || !SHA256_PATTERN.test(String(receipt.model_revision_before || ''))
    || !SHA256_PATTERN.test(String(receipt.model_revision_after || ''))
    || receipt.committed !== true
    || !Number.isFinite(Date.parse(receipt.applied_at))
    || receipt.receipt_hash !== visualCorrectionApplyReceiptHash(receipt)) {
    throw lineageError('The reviewed edit apply receipt is missing or invalid.');
  }
  return receipt;
}

function assertSourceLineage(value) {
  const lineage = structuredClone(value || {});
  if (lineage.version !== VISUAL_SOURCE_LINEAGE_VERSION
    || lineage.kind !== 'visual_correction_source_lineage'
    || !MODEL_KEY_PATTERN.test(String(lineage.model_key || ''))
    || !GRAPH_ID_PATTERN.test(String(lineage.graph_id || ''))
    || !SHA256_PATTERN.test(String(lineage.before_model_revision || ''))
    || !IMAGE_HANDLE_PATTERN.test(String(lineage.reference_image?.handle || ''))
    || !SHA256_PATTERN.test(String(lineage.reference_image?.sha256 || ''))
    || !Number.isFinite(lineage.source_evidence?.difference_mean_absolute_error)) {
    throw lineageError('Visual correction QA requires a complete source lineage object.');
  }
  const core = structuredClone(lineage);
  delete core.lineage_hash;
  if (lineage.lineage_hash !== sha256Canonical(core)) {
    throw lineageError('The visual correction source lineage hash is invalid.');
  }
  assertApplyReceipt(lineage.apply_receipt);
  if (lineage.source_plan?.plan_id !== lineage.apply_receipt.plan_id
    || lineage.source_plan?.plan_hash !== lineage.apply_receipt.plan_hash
    || lineage.source_plan?.model_key !== lineage.model_key
    || lineage.source_plan?.model_revision !== lineage.before_model_revision
    || lineage.apply_receipt.model_key !== lineage.model_key
    || lineage.apply_receipt.model_revision_before !== lineage.before_model_revision
    || lineage.source_visual_correction !== `source_visual_correction:${lineage.source_task_id}`) {
    throw lineageError('The visual correction lineage fields disagree.');
  }
  return lineage;
}

function lineageError(message) {
  return new AgentContractError('PLAN_HASH_MISMATCH', message);
}

async function buildVisualArtifacts(store, reference, capture, phase) {
  const [overlay, referenceThumbnail, captureThumbnail] = await Promise.all([
    renderOverlay(reference, capture),
    renderThumbnail(reference.buffer),
    renderThumbnail(capture.buffer)
  ]);
  const [overlayArtifact, referenceArtifact, captureArtifact] = await Promise.all([
    store.ingestBuffer(overlay, { mediaType: 'image/png' }),
    store.ingestBuffer(referenceThumbnail, { mediaType: 'image/png' }),
    store.ingestBuffer(captureThumbnail, { mediaType: 'image/png' })
  ]);
  return {
    overlay: artifactSummary(overlayArtifact.record, `${phase}_difference_overlay`),
    reference_thumbnail: artifactSummary(referenceArtifact.record, 'reference_thumbnail'),
    capture_thumbnail: artifactSummary(captureArtifact.record, `${phase}_capture_thumbnail`)
  };
}

async function ingestRenderedVisualArtifacts(store, buffers, rolePrefix) {
  const entries = await Promise.all(Object.entries(buffers || {}).map(async ([label, buffer]) => {
    const artifact = await store.ingestBuffer(buffer, { mediaType: 'image/png' });
    return [label, artifactSummary(artifact.record, `${rolePrefix}_${label}`)];
  }));
  return Object.fromEntries(entries);
}

function artifactSummary(record, role) {
  return { role, ...publicImageBinding(record) };
}

async function renderThumbnail(buffer) {
  return sharp(buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
    .flatten({ background: '#ffffff' })
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

async function renderOverlay(reference, capture) {
  const pixels = Buffer.alloc(reference.width * reference.height * 4);
  for (let pixel = 0; pixel < reference.width * reference.height; pixel += 1) {
    const source = pixel * 3;
    const target = pixel * 4;
    const referenceLuma = (reference.data[source] + reference.data[source + 1] + reference.data[source + 2]) / 3;
    const captureLuma = (capture.data[source] + capture.data[source + 1] + capture.data[source + 2]) / 3;
    pixels[target] = 255 - referenceLuma;
    pixels[target + 1] = 255 - captureLuma;
    pixels[target + 2] = 255 - captureLuma;
    pixels[target + 3] = 255;
  }
  return sharp(pixels, {
    raw: { width: reference.width, height: reference.height, channels: 4 }
  }).png().toBuffer();
}

function compareImages(reference, capture) {
  let absolute = 0;
  let squared = 0;
  for (let index = 0; index < reference.data.length; index += 1) {
    const delta = (reference.data[index] - capture.data[index]) / 255;
    absolute += Math.abs(delta);
    squared += delta * delta;
  }
  const count = reference.data.length;
  const referenceForeground = foregroundSummary(reference);
  const captureForeground = foregroundSummary(capture);
  const dx = captureForeground.center[0] - referenceForeground.center[0];
  const dy = captureForeground.center[1] - referenceForeground.center[1];
  return {
    alignment: {
      method: 'normalized_canvas_and_foreground_centroid.v1',
      scale: [1, 1],
      translation_norm: [round(dx), round(dy)],
      foreground_center_delta_norm: round(Math.hypot(dx, dy))
    },
    difference: {
      method: 'normalized_rgb.v1',
      mean_absolute_error: round(absolute / count),
      root_mean_square_error: round(Math.sqrt(squared / count)),
      compared_pixels: reference.width * reference.height
    },
    foreground: { reference: referenceForeground, capture: captureForeground }
  };
}

function foregroundSummary(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * image.channels;
      const luminance = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / (3 * 255);
      if (luminance >= 0.94) continue;
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!pixels) return { coverage: 0, bounds_norm: [0, 0, 0, 0], center: [0.5, 0.5] };
  return {
    coverage: round(pixels / (image.width * image.height)),
    bounds_norm: [round(minX / image.width), round(minY / image.height), round((maxX + 1) / image.width), round((maxY + 1) / image.height)],
    center: [round((minX + maxX + 1) / (2 * image.width)), round((minY + maxY + 1) / (2 * image.height))]
  };
}

function evidenceConfidence(comparison, referenceQa) {
  const foreground = Math.min(comparison.foreground.reference.coverage, comparison.foreground.capture.coverage);
  const qaPenalty = Math.min(0.2, Number(referenceQa?.summary?.total || 0) * 0.02);
  return round(Math.max(0, Math.min(1, 0.65 + Math.min(0.25, foreground * 2) - qaPenalty)));
}

function round(value) {
  return Number(Number(value).toFixed(6));
}
