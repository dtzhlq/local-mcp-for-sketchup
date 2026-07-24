import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { AgentContractError, sha256Canonical } from '../src/agent-contract.mjs';
import { existingModelEditRiskForOperation } from '../src/existing-model-editing.mjs';
import { ImmutableImageArtifactStore } from '../src/image-artifact-store.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import {
  VISUAL_APPLY_RECEIPT_VERSION,
  VISUAL_CAPTURE_PROVENANCE_VERSION,
  VISUAL_CORRECTION_QA_RESULT_VERSION,
  analyzeReferenceImageCorrection,
  analyzeReferenceImageCorrectionFromPaths,
  buildVisualCorrectionSourceLineage,
  verifyReferenceImageCorrection,
  visualCorrectionApplyReceiptHash
} from '../src/visual-correction.mjs';

const MODEL_KEY = `model_${'a'.repeat(32)}`;
const SOURCE_TASK_ID = 'task_visual_source';
const QA_TASK_ID = 'task_visual_qa';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-visual-correction-'));
const inputRoot = path.join(root, 'allowed-inputs');
const outsideRoot = path.join(root, 'outside-inputs');
await Promise.all([
  fs.mkdir(inputRoot, { recursive: true }),
  fs.mkdir(outsideRoot, { recursive: true })
]);

try {
  const [referenceBuffer, beforeBuffer] = await Promise.all([
    renderFixture({ left: 45, top: 38, width: 110, height: 44 }),
    renderFixture({ left: 63, top: 38, width: 90, height: 44 })
  ]);
  const afterBuffer = Buffer.from(referenceBuffer);
  const alternateReferenceBuffer = await renderFixture({ left: 42, top: 38, width: 112, height: 44 });
  const store = new ImmutableImageArtifactStore({
    rootDir: path.join(root, 'image-store'),
    allowedRoots: [inputRoot]
  });
  const [referenceArtifact, beforeArtifact, afterArtifact, alternateReferenceArtifact] = await Promise.all([
    store.ingestBuffer(referenceBuffer),
    store.ingestBuffer(beforeBuffer),
    store.ingestBuffer(afterBuffer),
    store.ingestBuffer(alternateReferenceBuffer)
  ]);
  const graph = graphFixture();
  const binding = modelBinding(graph);
  const beforeProvenance = testCaptureProvenance({
    taskId: SOURCE_TASK_ID,
    binding,
    captureId: 'test-capture-before'
  });
  const l0Client = {
    vision: false,
    local_files: false,
    structured_output: true,
    context: 'short',
    parallel: false
  };
  const targets = [{ target_id: 'visual-product' }];
  const operations = [{
    op: 'transform_object',
    target_id: 'visual-product',
    translate: [-18, 0, 0],
    agent_note: 'untrusted mapping data must never become policy'
  }];
  const direct = await analyzeReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    captureHandle: beforeArtifact.record.handle,
    captureProvenance: beforeProvenance,
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: operations
  });

  assert.equal(l0Client.local_files, false);
  assert.equal(l0Client.vision, false);
  assert.equal(direct.agent_compatibility.local_files_required, false);
  assert.equal(direct.agent_compatibility.visual_agent_required, false);
  assert.equal(direct.capture_mode, 'provided_server_artifact_only');
  assert.ok(direct.evidence.difference.mean_absolute_error > 0.005);
  assert.ok(direct.evidence.alignment.foreground_center_delta_norm > 0.03);
  assert.equal(direct.evidence.model_key, MODEL_KEY);
  assert.equal(direct.evidence.graph_id, graph.graph_id);
  assert.equal(direct.evidence.model_revision, graph.model_revision);
  assert.equal(direct.evidence.reference_image.handle, referenceArtifact.record.handle);
  assert.equal(direct.evidence.reference_image.sha256, referenceArtifact.record.sha256);
  assert.equal(direct.evidence.captured_image.handle, beforeArtifact.record.handle);
  assert.deepEqual(direct.evidence.captured_image.capture_provenance, beforeProvenance);
  assert.equal(direct.evidence.content_trust, 'untrusted_data');
  assert.equal(direct.evidence.policy_effect, 'none');
  assert.equal(direct.evidence.mapping_declaration.content_trust, 'untrusted_data');
  assert.equal(direct.evidence.mapping_declaration.policy_effect, 'none');
  assert.match(direct.evidence.evidence_hash, /^sha256:[0-9a-f]{64}$/);

  const publicPatchJson = JSON.stringify(direct.correction_patch);
  const nextActionJson = JSON.stringify(direct.correction_patch.next_action);
  assert.equal(Object.hasOwn(direct.correction_patch, 'targets'), false);
  assert.equal(Object.hasOwn(direct.correction_patch, 'operations'), false);
  assert.equal(publicPatchJson.includes('visual-product'), false);
  assert.equal(publicPatchJson.includes('agent_note'), false);
  assert.equal(nextActionJson.includes('translate'), false);
  assert.deepEqual(Object.keys(direct.correction_patch.next_action).sort(), ['action', 'source_visual_correction']);
  assert.equal(direct.correction_patch.next_action.source_visual_correction, `source_visual_correction:${SOURCE_TASK_ID}`);
  assert.equal(direct.correction_patch.execution_allowed, false);
  assert.equal(direct.correction_patch.review_required, true);
  assert.equal(direct.correction_patch.execution_route, 'trusted_reviewed_existing_model_edit_only');
  assert.equal(direct.correction_patch.risk_level, existingModelEditRiskForOperation('transform_object'));
  assert.equal(direct.correction_patch.content_trust, 'untrusted_data');
  assert.equal(direct.correction_patch.policy_effect, 'none');
  assert.deepEqual(direct.server_private.correction_patch.operations, [{
    op: 'transform_object',
    translate: [-18, 0, 0],
    agent_note: 'untrusted mapping data must never become policy',
    entity_path: 'pid:1001',
    edit_scope: 'instance_path',
    instance_policy: 'definition_wide'
  }]);
  assert.equal(direct.server_private.correction_patch.targets[0].entity_path, 'pid:1001');
  assert.equal(direct.server_private.correction_patch.private_payload_hash, direct.correction_patch.private_payload_hash);
  assert.match(direct.artifacts.overlay.handle, /^image-artifact:sha256:/);
  assert.equal(JSON.stringify(direct).includes(root), false, 'handle-only public/private contracts must expose no raw path');
  const overlayMetadata = await sharp(await store.readBuffer(direct.artifacts.overlay.handle)).metadata();
  assert.equal(overlayMetadata.format, 'png');

  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  await validateSchema(ajv, 'visual-correction-evidence-v1.schema.json', direct.evidence);
  await validateSchema(ajv, 'visual-correction-patch-v1.schema.json', direct.correction_patch);

  await rejectsCode(analyzeReferenceImageCorrection({
    imageArtifactStore: store,
    referenceImagePath: path.join(inputRoot, 'legacy.png'),
    captureImagePath: path.join(inputRoot, 'legacy-capture.png'),
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: operations
  }), 'INVALID_ARGUMENT');

  const lockedGraph = graphFixture({ locked: true });
  await rejectsCode(analyzeForGraph(store, referenceArtifact, beforeArtifact, lockedGraph, {
    correctionTargets: targets,
    correctionOperations: operations
  }), 'POLICY_DENIED');

  const ambiguousGraph = graphFixture({ duplicateNames: true });
  await rejectsCode(analyzeForGraph(store, referenceArtifact, beforeArtifact, ambiguousGraph, {
    correctionTargets: [{ name: 'Duplicate Visual Product' }],
    correctionOperations: operations
  }), 'INVALID_ARGUMENT');

  const truncatedGraph = graphFixture({ truncated: true });
  await rejectsCode(analyzeForGraph(store, referenceArtifact, beforeArtifact, truncatedGraph, {
    correctionTargets: targets,
    correctionOperations: operations
  }), 'MODEL_REVISION_INCOMPLETE');

  await rejectsCode(analyzeReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    captureHandle: beforeArtifact.record.handle,
    captureProvenance: beforeProvenance,
    modelGraph: graph,
    modelBinding: { ...binding, model_revision: sha256Canonical({ stale: true }) },
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: operations
  }), 'MODEL_REVISION_MISMATCH');

  await rejectsCode(analyzeReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    captureHandle: beforeArtifact.record.handle,
    captureProvenance: beforeProvenance,
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: [{ op: 'transform_object', target_id: 'visual-product' }]
  }), 'INVALID_ARGUMENT');

  await rejectsCode(analyzeReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    captureHandle: beforeArtifact.record.handle,
    captureProvenance: beforeProvenance,
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: [{ op: 'delete', target_id: 'visual-product' }]
  }), 'OPERATION_NOT_ALLOWED');

  await rejectsCode(analyzeReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    captureHandle: beforeArtifact.record.handle,
    captureProvenance: {
      ...beforeProvenance,
      kind: 'server_live_capture',
      provider: 'test_fixture',
      runtime: 'mock'
    },
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: operations
  }), 'INVALID_ARGUMENT');

  const referencePath = path.join(inputRoot, 'reference.png');
  const beforePath = path.join(inputRoot, 'before.png');
  const outsidePath = path.join(outsideRoot, 'outside.png');
  await Promise.all([
    fs.writeFile(referencePath, referenceBuffer),
    fs.writeFile(beforePath, beforeBuffer),
    fs.writeFile(outsidePath, referenceBuffer)
  ]);
  const compatible = await analyzeReferenceImageCorrectionFromPaths({
    imageArtifactStore: store,
    referenceImagePath: referencePath,
    captureImagePath: beforePath,
    captureProvenance: beforeProvenance,
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: operations
  });
  assert.equal(compatible.evidence.reference_image.handle, referenceArtifact.record.handle);
  assert.equal(JSON.stringify(compatible).includes(referencePath), false);
  await rejectsCode(analyzeReferenceImageCorrectionFromPaths({
    imageArtifactStore: store,
    referenceImagePath: outsidePath,
    captureImagePath: beforePath,
    captureProvenance: beforeProvenance,
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    correctionTargets: targets,
    correctionOperations: operations
  }), 'POLICY_DENIED');

  const plan = {
    plan_id: 'existing-edit-visual-source-plan',
    plan_hash: sha256Canonical({ plan: 'visual-source-plan' }),
    model_key: MODEL_KEY,
    model_revision: graph.model_revision,
    source_visual_correction: `source_visual_correction:${SOURCE_TASK_ID}`
  };
  const afterBinding = {
    model_key: MODEL_KEY,
    graph_id: `model-graph-${sha256Canonical({ graph: 'after' }).slice(7, 31)}`,
    model_revision: sha256Canonical({ revision: 'after-visual-correction' })
  };
  const applyReceiptCore = {
    version: VISUAL_APPLY_RECEIPT_VERSION,
    kind: 'reviewed_existing_model_edit_apply_receipt',
    receipt_id: 'visual-apply-receipt-test',
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    model_key: MODEL_KEY,
    model_revision_before: graph.model_revision,
    model_revision_after: afterBinding.model_revision,
    committed: true,
    applied_at: '2026-07-16T08:00:00.000Z'
  };
  const applyReceipt = {
    ...applyReceiptCore,
    receipt_hash: visualCorrectionApplyReceiptHash(applyReceiptCore)
  };
  const lineage = buildVisualCorrectionSourceLineage({
    evidence: direct.evidence,
    correctionPatch: direct.correction_patch,
    privateCorrectionPatch: direct.server_private.correction_patch,
    plan,
    applyReceipt
  });
  assert.equal(lineage.reference_image.handle, referenceArtifact.record.handle);
  assert.equal(lineage.apply_receipt.model_revision_after, afterBinding.model_revision);
  assert.match(lineage.lineage_hash, /^sha256:[0-9a-f]{64}$/);

  assert.throws(
    () => buildVisualCorrectionSourceLineage({
      evidence: { ...structuredClone(direct.evidence), confidence: 0 },
      correctionPatch: direct.correction_patch,
      privateCorrectionPatch: direct.server_private.correction_patch,
      plan,
      applyReceipt
    }),
    (error) => error.code === 'PLAN_HASH_MISMATCH'
  );
  assert.throws(
    () => buildVisualCorrectionSourceLineage({
      evidence: direct.evidence,
      correctionPatch: direct.correction_patch,
      privateCorrectionPatch: direct.server_private.correction_patch,
      plan
    }),
    (error) => error.code === 'PLAN_HASH_MISMATCH'
  );

  const afterProvenance = testCaptureProvenance({
    taskId: QA_TASK_ID,
    binding: afterBinding,
    captureId: 'test-capture-after'
  });
  const verified = await verifyReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    recaptureHandle: afterArtifact.record.handle,
    recaptureProvenance: afterProvenance,
    sourceLineage: lineage,
    afterModelBinding: afterBinding,
    qaTaskId: QA_TASK_ID
  });
  assert.equal(verified.report.verdict, 'pass');
  assert.equal(verified.report.improved, true);
  assert.equal(verified.report.review_required, false);
  assert.equal(verified.report.next_action, null);
  assert.equal(verified.report.model_key, MODEL_KEY);
  assert.equal(verified.report.before_model_revision, graph.model_revision);
  assert.equal(verified.report.after_model_revision, afterBinding.model_revision);
  assert.equal(verified.report.source_patch.patch_hash, direct.correction_patch.patch_hash);
  assert.equal(verified.report.source_plan.plan_hash, plan.plan_hash);
  assert.equal(verified.report.apply_receipt.receipt_hash, applyReceipt.receipt_hash);
  assert.equal(verified.report.reference_image.handle, referenceArtifact.record.handle);
  assert.equal(verified.report.recaptured_image.handle, afterArtifact.record.handle);
  assert.equal(verified.agent_compatibility.local_files_required, false);
  assert.equal(JSON.stringify(verified).includes(root), false);
  await validateSchema(ajv, 'visual-correction-qa-v1.schema.json', verified.report);
  assert.equal(verified.result.version, VISUAL_CORRECTION_QA_RESULT_VERSION);
  assert.equal(verified.result.kind, 'visual_correction_qa_result');
  assert.equal(verified.result.report.qa_hash, verified.report.qa_hash);
  assert.equal(
    verified.result.background_normalized_comparison.structure.verdict,
    'coarse_structure_pass'
  );
  assert.equal(verified.result.background_normalized_comparison.segmentation.reliable, true);
  assert.equal(verified.result.background_normalized_comparison.visual_similarity_accepted, false);
  assert.equal(verified.result.diagnostic_boundary.policy_effect, 'none');
  assert.equal(verified.result.diagnostic_boundary.target_selection_allowed, false);
  assert.equal(verified.result.diagnostic_boundary.operation_selection_allowed, false);
  assert.equal(verified.result.diagnostic_boundary.approval_state_change_allowed, false);
  assert.equal(verified.result.diagnostic_boundary.execution_authorization_allowed, false);
  assert.equal(verified.result.diagnostic_boundary.visual_similarity_accepted, false);
  assert.deepEqual(Object.keys(verified.result.image_artifacts).sort(), [
    'capture_mask',
    'capture_thumbnail',
    'overlay',
    'reference_mask',
    'reference_thumbnail',
    'registered_capture',
    'registered_reference',
    'silhouette_overlay'
  ]);
  const resultCore = structuredClone(verified.result);
  delete resultCore.result_id;
  delete resultCore.result_hash;
  assert.equal(verified.result.result_hash, sha256Canonical(resultCore));
  assert.equal(
    verified.result.result_id,
    `visual-qa-result-${verified.result.result_hash.slice(7, 31)}`
  );
  await validateSchema(
    ajv,
    'background-normalized-visual-comparison-v1.schema.json',
    verified.result.background_normalized_comparison
  );
  await validateSchema(ajv, 'visual-correction-qa-result-v1.schema.json', verified.result);
  for (const mutate of [
    (value) => { value.diagnostic_boundary.approval_state_change_allowed = true; },
    (value) => { value.diagnostic_boundary.visual_similarity_accepted = true; },
    (value) => { delete value.image_artifacts.silhouette_overlay; }
  ]) {
    const invalid = structuredClone(verified.result);
    mutate(invalid);
    const validateResult = ajv.getSchema('https://alma.local/schema/visual-correction-qa-result-v1.schema.json');
    assert.equal(validateResult(invalid), false);
  }

  await rejectsCode(verifyReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: alternateReferenceArtifact.record.handle,
    recaptureHandle: afterArtifact.record.handle,
    recaptureProvenance: afterProvenance,
    sourceLineage: lineage,
    afterModelBinding: afterBinding,
    qaTaskId: QA_TASK_ID
  }), 'INVALID_ARGUMENT');

  await rejectsCode(verifyReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    recaptureHandle: afterArtifact.record.handle,
    recaptureProvenance: afterProvenance,
    previousEvidence: direct.evidence,
    afterModelBinding: afterBinding,
    qaTaskId: QA_TASK_ID
  }), 'INVALID_ARGUMENT');

  const forgedLineage = structuredClone(lineage);
  forgedLineage.source_evidence.evidence_hash = sha256Canonical({ forged: true });
  await rejectsCode(verifyReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    recaptureHandle: afterArtifact.record.handle,
    recaptureProvenance: afterProvenance,
    sourceLineage: forgedLineage,
    afterModelBinding: afterBinding,
    qaTaskId: QA_TASK_ID
  }), 'PLAN_HASH_MISMATCH');

  const missingReceiptLineage = structuredClone(lineage);
  delete missingReceiptLineage.apply_receipt;
  await rejectsCode(verifyReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    recaptureHandle: afterArtifact.record.handle,
    recaptureProvenance: afterProvenance,
    sourceLineage: missingReceiptLineage,
    afterModelBinding: afterBinding,
    qaTaskId: QA_TASK_ID
  }), 'PLAN_HASH_MISMATCH');

  await rejectsCode(verifyReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    recaptureHandle: afterArtifact.record.handle,
    recaptureProvenance: afterProvenance,
    sourceLineage: lineage,
    afterModelBinding: { ...afterBinding, model_revision: sha256Canonical({ stale: 'qa' }) },
    qaTaskId: QA_TASK_ID
  }), 'MODEL_REVISION_MISMATCH');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    handle_only_l0: l0Client.local_files === false,
    visual_agent_required: direct.agent_compatibility.visual_agent_required,
    public_patch_target_operation_leaks: 0,
    public_next_action: direct.correction_patch.next_action,
    shared_risk_level: direct.correction_patch.risk_level,
    model_graph_target_resolution: 'unique_occurrence_only',
    locked_ambiguous_truncated_stale_rejected: true,
    untrusted_mapping_policy_effect: direct.evidence.mapping_declaration.policy_effect,
    source_lineage_bound: true,
    different_reference_rejected: true,
    forged_previous_evidence_rejected: true,
    missing_apply_receipt_rejected: true,
    recapture_verdict: verified.report.verdict,
    background_normalized_structure_verdict: verified.result.background_normalized_comparison.structure.verdict,
    background_normalized_segmentation_reliable: verified.result.background_normalized_comparison.segmentation.reliable,
    structured_result_schema_valid: true,
    structured_result_policy_negative_cases: 3,
    immutable_visual_artifact_handles: Object.keys(verified.result.image_artifacts).length,
    visual_similarity_accepted: verified.result.diagnostic_boundary.visual_similarity_accepted,
    path_compatibility_policy_fail_closed: true,
    live_capture_claimed: false,
    live_queue_called: false
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function analyzeForGraph(store, referenceArtifact, captureArtifact, graph, overrides) {
  const binding = modelBinding(graph);
  return analyzeReferenceImageCorrection({
    imageArtifactStore: store,
    referenceHandle: referenceArtifact.record.handle,
    captureHandle: captureArtifact.record.handle,
    captureProvenance: testCaptureProvenance({
      taskId: SOURCE_TASK_ID,
      binding,
      captureId: `capture-${graph.graph_id}`
    }),
    modelGraph: graph,
    modelBinding: binding,
    sourceTaskId: SOURCE_TASK_ID,
    ...overrides
  });
}

function graphFixture({ locked = false, duplicateNames = false, truncated = false } = {}) {
  const fixture = { locked, duplicateNames, truncated };
  const entries = [
    visualEntity('visual-product', duplicateNames ? 'Duplicate Visual Product' : 'Visual Product', { locked }),
    ...(duplicateNames ? [visualEntity('visual-product-copy', 'Duplicate Visual Product')] : [])
  ].map((entity) => ({ ...entity, entity_path: `pid:${entity.persistent_id}` }));
  return buildModelGraph({
    kind: 'adopt_open_model',
    version: 'adopt-open-model.test.v1',
    runtime: 'mock',
    model_revision: sha256Canonical({ fixture }),
    recursive: true,
    recursive_truncated: truncated,
    recursive_total_seen: entries.length + (truncated ? 1 : 0),
    occurrence_contract: 'canonical-occurrence-path.v1',
    entities: [],
    recursive_index: entries,
    snapshot: {
      totals: { objects: entries.length },
      materials: [],
      tags: [],
      scenes: [],
      image_references: []
    },
    classification_schemas: [],
    component_definition_summaries: []
  });
}

function visualEntity(id, name, { locked = false } = {}) {
  return {
    id,
    reference: id,
    persistent_id: id === 'visual-product' ? '1001' : '1002',
    entity_type: 'group',
    name,
    editable: true,
    locked,
    visible: true,
    allowed_operations: ['attribute', 'rename', 'transform_object'],
    bounding_box: { min: [0, 0, 0], max: [90, 40, 44], w: 90, d: 40, h: 44 }
  };
}

function modelBinding(graph) {
  return { model_key: MODEL_KEY, graph_id: graph.graph_id, model_revision: graph.model_revision };
}

function testCaptureProvenance({ taskId, binding, captureId }) {
  return {
    version: VISUAL_CAPTURE_PROVENANCE_VERSION,
    kind: 'trusted_test_capture',
    capture_id: captureId,
    provider: 'test_fixture',
    runtime: 'mock',
    source_task_id: taskId,
    model_key: binding.model_key,
    graph_id: binding.graph_id,
    model_revision: binding.model_revision,
    captured_at: '2026-07-16T07:30:00.000Z'
  };
}

async function renderFixture(rectangle) {
  const svg = `<svg width="200" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="120" fill="white"/><rect x="${rectangle.left}" y="${rectangle.top}" width="${rectangle.width}" height="${rectangle.height}" rx="4" fill="#202020"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function validateSchema(ajv, schemaName, value) {
  const schema = JSON.parse(await fs.readFile(new URL(`../schema/${schemaName}`, import.meta.url), 'utf8'));
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof AgentContractError && error.code === code,
    `expected AgentContractError ${code}`
  );
}
