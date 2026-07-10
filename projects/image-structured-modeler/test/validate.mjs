#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { materializeDslAssetPaths } from '../../../src/dsl-asset-paths.mjs';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphPhysicalConsistency } from '../../../src/product-modeling/physical-consistency-qa.mjs';
import { compilePlanToSketchUpDsl } from '../scripts/compile-plan-to-sketchup-dsl.mjs';
import { generateModelPlan } from '../scripts/generate-model-plan.mjs';
import { generatePartGraphFromObservations } from '../scripts/generate-part-graph-from-observations.mjs';
import { applyCandidatePromotionPatch } from '../scripts/apply-candidate-promotion-patch.mjs';
import { buildCandidatePromotionPatch } from '../scripts/build-candidate-promotion-patch.mjs';
import { generateYellowAxisCalibrationWorkbench } from '../scripts/generate-yellow-axis-calibration-workbench.mjs';
import { generateYellowVisibleEffect } from '../scripts/generate-yellow-visible-effect.mjs';
import {
  BUILDING_SINGLE_STRUCTURAL_PROJECTION_KIND,
  YELLOW_BUILDING_STRUCTURAL_PROJECTION_CONFIG,
  buildBuildingSingleStructuralProjection
} from '../scripts/lib/yellow-building-structural-projection.mjs';
import { applyCorrectionPatch, buildCorrectionPatchFromParameterProposals, buildCorrectionPatchFromReferenceReport } from '../scripts/lib/part-graph-corrections.mjs';
import { buildStructuredAssetIntake } from '../scripts/intake-assets.mjs';
import { exportMcpModelingBriefCli } from '../scripts/export-mcp-modeling-brief.mjs';
import { runImageStructuredReleaseGate } from '../scripts/run-release-gate.mjs';
import { runDraftingFirstBenchmark } from '../scripts/run-drafting-first-benchmark.mjs';
import { assessRealWorldBuildingSourcePackageCli } from '../scripts/assess-real-world-building-source-package.mjs';
import { preflightRealWorldBuildingSourcePackageCli } from '../scripts/preflight-real-world-building-source-package.mjs';
import { runRealWorldBuildingUploadSession } from '../scripts/run-real-world-building-upload-session.mjs';
import {
  auditRealWorldBuildingDemoCandidates,
  renderRealWorldBuildingDemoCandidateAuditMarkdown
} from '../scripts/audit-real-world-building-demo-candidates.mjs';
import { prepareRealWorldBuildingSourceRefillPackageCli } from '../scripts/prepare-real-world-building-source-refill-package.mjs';
import { buildRealWorldBuildingSourceRefillManifestCli } from '../scripts/build-real-world-building-source-refill-manifest.mjs';
import { validateRealWorldBuildingSourceRefillPackageCli } from '../scripts/validate-real-world-building-source-refill-package.mjs';
import { runRealWorldBuildingSourceRefillWorkflowCli } from '../scripts/run-real-world-building-source-refill-workflow.mjs';
import { prepareRealWorldBuildingReleaseSampleCli } from '../scripts/prepare-real-world-building-release-sample.mjs';
import { prepareRealWorldBuildingReleaseArtifactWorkspaceCli } from '../scripts/prepare-real-world-building-release-artifact-workspace.mjs';
import { validateRealWorldBuildingReleaseArtifactWorkspaceCli } from '../scripts/validate-real-world-building-release-artifact-workspace.mjs';
import { validateRealWorldBuildingReleaseSampleCli } from '../scripts/validate-real-world-building-release-sample.mjs';
import {
  DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  buildRealWorldBuildingPositiveManifest,
  buildRealWorldBuildingPositiveReleaseChecklist,
  buildRealWorldBuildingReleaseWorkOrder,
  renderRealWorldBuildingPositiveReleaseChecklistMarkdown,
  renderRealWorldBuildingReleaseWorkOrderMarkdown,
  validateRealWorldBuildingPositiveManifest
} from '../scripts/lib/real-world-building-release-sample.mjs';
import {
  assessRealWorldBuildingSourcePackage,
  buildRealWorldBuildingUploadManifestTemplate,
  buildRealWorldBuildingSourceRequestResponse,
  renderRealWorldBuildingSourceRequestMarkdown,
  renderRealWorldBuildingSourceRequestResponseMarkdown,
  renderRealWorldBuildingSourcePackageMarkdown,
  REQUIRED_BUILDING_SINGLE_SOURCE_ROLES
} from '../scripts/lib/real-world-building-source-package.mjs';
import { buildMcpModelingBrief } from '../scripts/lib/mcp-modeling-brief.mjs';
import { evaluateDiffWarningBudget, evaluateSnapshotWarningBudget } from '../scripts/lib/warning-budget.mjs';
import { makeGroundingV2SecondBuildingGroupSample } from '../scripts/lib/grounding-v2-second-sample.mjs';
import { validateGroundingV3 } from '../scripts/lib/grounding-v3.mjs';
import { validateAutoGroundPlanR10 } from '../scripts/lib/auto-ground-plan-r10.mjs';
import {
  landCoverReport,
  makeBirdEyeLandCoverV1FromObservationFixture,
  makeSyntheticBirdEyeLandCoverFixture
} from '../scripts/lib/bird-eye-land-cover.mjs';
import {
  boundaryGraphReport,
  buildBoundaryGraphV1,
  makeSyntheticBoundaryGraphFixture
} from '../scripts/lib/boundary-graph-v1.mjs';
import {
  highContrastEdgeReport,
  makeSyntheticHighContrastEdgeFixture
} from '../scripts/lib/high-contrast-edge-v1.mjs';
import { openCvEdgeReport } from '../scripts/lib/opencv-edge-v1.mjs';
import {
  BUILDING_SINGLE_SEMANTIC_EVIDENCE_KIND,
  parseBuildingSingleAnnotations,
  loadBuildingSingleVlmCandidates
} from '../scripts/lib/building-single-semantic-evidence.mjs';
import {
  applyVisionEvidencePolicyCorrectionPatch,
  buildAcceptedVisionEvidenceReviewDecision,
  buildVisionEvidencePolicyCorrectionPatch,
  makeSyntheticVisionEvidenceSetFixture,
  buildVisionEvidenceReviewPatch,
  renderVisionEvidencePolicyCorrectionPatchMarkdown,
  renderVisionEvidenceReviewPatchMarkdown,
  renderVisionEvidenceReviewWorkbenchHtml,
  visionEvidenceSetReport
} from '../scripts/lib/vision-evidence-set-v1.mjs';
import { segmentationBackendCompareReport } from '../scripts/lib/segmentation-backend-compare.mjs';
import { makePhotoGradeRealSmokeSample } from '../scripts/lib/photo-grade-real-smoke.mjs';
import { validatePhotoGradeReadiness } from '../scripts/lib/photo-grade-readiness.mjs';
import { validateGeometryFit } from '../scripts/validate-geometry-fit.mjs';
import { validateVisualRelations } from '../scripts/validate-visual-relations.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const subprojectRoot = path.join(repoRoot, 'projects', 'image-structured-modeler');

const modelPlanSchema = await readJson('schema/model-plan.schema.json');
const imageObservationSchema = await readJson('schema/image-observation.schema.json');
const imageSetObservationSchema = await readJson('schema/image-set-observation.schema.json');
const buildingSingleSemanticEvidenceSchema = await readJson('schema/building-single-semantic-evidence.schema.json');
const facadePlaneGraphSchema = await readJson('schema/facade-plane-graph.schema.json');
const structureEvidenceGraphSchema = await readJson('schema/structure-evidence-graph.schema.json');
const detectedStructureLinesSchema = await readJson('schema/detected-structure-lines.schema.json');
const axisCalibrationWorkbenchSchema = await readJson('schema/axis-calibration-workbench.schema.json');
const axisCalibrationReviewDecisionSchema = await readJson('schema/axis-calibration-review-decision.schema.json');
const axisCalibrationResultSchema = await readJson('schema/axis-calibration-result.schema.json');
const calibratedViewGraphSchema = await readJson('schema/calibrated-view-graph.schema.json');
const cornerChainTopologySchema = await readJson('schema/corner-chain-topology.schema.json');
const draftViewGraphSchema = await readJson('schema/draft-view-graph.schema.json');
const objectSurfaceGraphSchema = await readJson('schema/object-surface-graph.schema.json');
const calibratedViewReviewDecisionSchema = await readJson('schema/calibrated-view-review-decision.schema.json');
const cornerChainTopologyReviewDecisionSchema = await readJson('schema/corner-chain-topology-review-decision.schema.json');
const draftViewReviewDecisionSchema = await readJson('schema/draft-view-review-decision.schema.json');
const localDetailReviewDecisionSchema = await readJson('schema/local-detail-review-decision.schema.json');
const imageStructuredBenchmarkReportSchema = await readJson('schema/image-structured-benchmark-report.schema.json');
const autoGroundPlanR10Schema = await readJson('schema/auto-ground-plan-r10.schema.json');
const visionEvidenceSetV1Schema = await readJson('schema/vision-evidence-set-v1.schema.json');
const visionEvidenceReviewPatchSchema = await readJson('schema/vision-evidence-review-patch.schema.json');
const visionEvidenceReviewDecisionSchema = await readJson('schema/vision-evidence-review-decision.schema.json');
const visionEvidencePolicyCorrectionPatchSchema = await readJson('schema/vision-evidence-policy-correction-patch.schema.json');
const assetSetSchema = await readJson('schema/asset-set.schema.json');
const candidateGraphSchema = await readJson('schema/candidate-graph.schema.json');
const modelingBriefSchema = await readJson('schema/modeling-brief.schema.json');
const mcpModelingBriefSchema = await readJson('schema/mcp-modeling-brief.schema.json');
const structuredAssetIntakeSummarySchema = await readJson('schema/structured-asset-intake-summary.schema.json');
const candidatePromotionReviewSchema = await readJson('schema/candidate-promotion-review.schema.json');
const candidatePromotionPatchSchema = await readJson('schema/candidate-promotion-patch.schema.json');
const releaseGateReportSchema = await readJson('schema/release-gate-report.schema.json');
const releaseGateArtifactIntegrityReportSchema = await readJson('schema/release-gate-artifact-integrity-report.schema.json');
const realWorldBuildingUploadManifestSchema = await readJson('schema/real-world-building-upload-manifest.schema.json');
const realWorldBuildingManifestSchema = await readJson('schema/real-world-building-release-sample-manifest.schema.json');
const realWorldBuildingChecklistSchema = await readJson('schema/real-world-building-release-checklist.schema.json');
const realWorldBuildingReleaseWorkOrderSchema = await readJson('schema/real-world-building-release-work-order.schema.json');
const realWorldBuildingReleaseArtifactWorkspaceSchema = await readJson('schema/real-world-building-release-artifact-workspace.schema.json');
const realWorldBuildingReleaseArtifactWorkspaceValidationSchema = await readJson('schema/real-world-building-release-artifact-workspace-validation.schema.json');
const realWorldBuildingDemoCandidateAuditSchema = await readJson('schema/real-world-building-demo-candidate-audit.schema.json');
const realWorldBuildingSourcePackageSchema = await readJson('schema/real-world-building-source-package.schema.json');
const realWorldBuildingSourceRequestSchema = await readJson('schema/real-world-building-source-request.schema.json');
const realWorldBuildingSourceRequestResponseSchema = await readJson('schema/real-world-building-source-request-response.schema.json');
const realWorldBuildingSourceRefillPackageGuideSchema = await readJson('schema/real-world-building-source-refill-package-guide.schema.json');
const realWorldBuildingSourceRefillPackageValidationSchema = await readJson('schema/real-world-building-source-refill-package-validation.schema.json');
const realWorldBuildingSourceRefillManifestBuildReportSchema = await readJson('schema/real-world-building-source-refill-manifest-build-report.schema.json');
const realWorldBuildingSourceRefillWorkflowReportSchema = await readJson('schema/real-world-building-source-refill-workflow-report.schema.json');
const realWorldBuildingSourcePackageGateResultSchema = await readJson('schema/real-world-building-source-package-gate-result.schema.json');
const realWorldBuildingSourcePackagePreflightSchema = await readJson('schema/real-world-building-source-package-preflight.schema.json');
const realWorldBuildingUploadSessionSchema = await readJson('schema/real-world-building-upload-session.schema.json');
const realWorldBuildingUploadSessionHandoffSchema = await readJson('schema/real-world-building-upload-session-handoff.schema.json');
const documentAssetParseReportSchema = await readJson('schema/document-asset-parse-report.schema.json');
const manualCorrectionsSchema = await readJson('schema/manual-corrections.schema.json');
const partGraphSchema = await readRepoJson('schema/part-graph.schema.json');
const partGraphCorrectionPatchSchema = await readRepoJson('schema/part-graph-correction-patch.schema.json');
const switchWarningBudget = await readJson('examples/switch-controller/warning-budget.json');
const remoteWarningBudget = await readJson('examples/compact-remote/warning-budget.json');
const SWITCH_BASELINE_GROUPS = 24;
const SWITCH_BASELINE_INSTANCES = 4;
const SWITCH_BASELINE_SCENES = 2;
const SWITCH_BASELINE_GEOMETRY_WARNINGS = 0;
const REMOTE_BASELINE_GROUPS = 3;
const REMOTE_BASELINE_INSTANCES = 0;
const REMOTE_BASELINE_SCENES = 2;

const validateModelPlan = compileSchema(modelPlanSchema);
const validateImageObservation = compileSchema(imageObservationSchema);
const validateImageSetObservation = compileSchema(imageSetObservationSchema);
const validateBuildingSingleSemanticEvidence = compileSchema(buildingSingleSemanticEvidenceSchema);
const validateFacadePlaneGraph = compileSchema(facadePlaneGraphSchema);
const validateStructureEvidenceGraph = compileSchema(structureEvidenceGraphSchema);
const validateDetectedStructureLines = compileSchema(detectedStructureLinesSchema);
const validateAxisCalibrationWorkbench = compileSchema(axisCalibrationWorkbenchSchema);
const validateAxisCalibrationReviewDecision = compileSchema(axisCalibrationReviewDecisionSchema);
const validateAxisCalibrationResult = compileSchema(axisCalibrationResultSchema);
const validateCalibratedViewGraph = compileSchema(calibratedViewGraphSchema);
const validateCornerChainTopology = compileSchema(cornerChainTopologySchema);
const validateDraftViewGraph = compileSchema(draftViewGraphSchema);
const validateObjectSurfaceGraph = compileSchema(objectSurfaceGraphSchema);
const validateCalibratedViewReviewDecision = compileSchema(calibratedViewReviewDecisionSchema);
const validateCornerChainTopologyReviewDecision = compileSchema(cornerChainTopologyReviewDecisionSchema);
const validateDraftViewReviewDecision = compileSchema(draftViewReviewDecisionSchema);
const validateLocalDetailReviewDecision = compileSchema(localDetailReviewDecisionSchema);
const validateImageStructuredBenchmarkReport = compileSchema(imageStructuredBenchmarkReportSchema);
const validateAutoGroundPlanR10Schema = compileSchema(autoGroundPlanR10Schema);
const validateVisionEvidenceSetV1 = compileSchema(visionEvidenceSetV1Schema);
const validateVisionEvidenceReviewPatch = compileSchema(visionEvidenceReviewPatchSchema);
const validateVisionEvidenceReviewDecision = compileSchema(visionEvidenceReviewDecisionSchema);
const validateVisionEvidencePolicyCorrectionPatch = compileSchema(visionEvidencePolicyCorrectionPatchSchema);
const validateAssetSet = compileSchema(assetSetSchema);
const validateCandidateGraph = compileSchema(candidateGraphSchema);
const validateModelingBrief = compileSchema(modelingBriefSchema);
const validateMcpModelingBrief = compileSchema(mcpModelingBriefSchema);
const validateStructuredAssetIntakeSummary = compileSchema(structuredAssetIntakeSummarySchema);
const validateCandidatePromotionReview = compileSchema(candidatePromotionReviewSchema);
const validateCandidatePromotionPatch = compileSchema(candidatePromotionPatchSchema);
const validateReleaseGateReport = compileSchema(releaseGateReportSchema);
const validateReleaseGateArtifactIntegrityReport = compileSchema(releaseGateArtifactIntegrityReportSchema);
const validateRealWorldBuildingUploadManifest = compileSchema(realWorldBuildingUploadManifestSchema);
const validateRealWorldBuildingManifest = compileSchema(realWorldBuildingManifestSchema);
const validateRealWorldBuildingChecklist = compileSchema(realWorldBuildingChecklistSchema);
const validateRealWorldBuildingReleaseWorkOrder = compileSchema(realWorldBuildingReleaseWorkOrderSchema);
const validateRealWorldBuildingReleaseArtifactWorkspace = compileSchema(realWorldBuildingReleaseArtifactWorkspaceSchema);
const validateRealWorldBuildingReleaseArtifactWorkspaceValidation = compileSchema(realWorldBuildingReleaseArtifactWorkspaceValidationSchema);
const validateRealWorldBuildingDemoCandidateAudit = compileSchema(realWorldBuildingDemoCandidateAuditSchema);
const validateRealWorldBuildingSourcePackage = compileSchema(realWorldBuildingSourcePackageSchema);
const validateRealWorldBuildingSourceRequest = compileSchema(realWorldBuildingSourceRequestSchema);
const validateRealWorldBuildingSourceRequestResponse = compileSchema(realWorldBuildingSourceRequestResponseSchema);
const validateRealWorldBuildingSourceRefillPackageGuide = compileSchema(realWorldBuildingSourceRefillPackageGuideSchema);
const validateRealWorldBuildingSourceRefillPackageValidation = compileSchema(realWorldBuildingSourceRefillPackageValidationSchema);
const validateRealWorldBuildingSourceRefillManifestBuildReport = compileSchema(realWorldBuildingSourceRefillManifestBuildReportSchema);
const validateRealWorldBuildingSourceRefillWorkflowReport = compileSchema(realWorldBuildingSourceRefillWorkflowReportSchema);
const validateRealWorldBuildingSourcePackageGateResult = compileSchema(realWorldBuildingSourcePackageGateResultSchema);
const validateRealWorldBuildingSourcePackagePreflight = compileSchema(realWorldBuildingSourcePackagePreflightSchema);
const validateRealWorldBuildingUploadSession = compileSchema(realWorldBuildingUploadSessionSchema);
const validateRealWorldBuildingUploadSessionHandoff = compileSchema(realWorldBuildingUploadSessionHandoffSchema);
const validateDocumentAssetParseReport = compileSchema(documentAssetParseReportSchema);
const validateManualCorrections = compileSchema(manualCorrectionsSchema);
const validatePartGraph = compileSchema(partGraphSchema);
const validatePartGraphCorrectionPatch = compileSchema(partGraphCorrectionPatchSchema);
const validateBrokenRefFixture = compileSchema({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $ref: '#/$defs/missingDefinition',
  $defs: {}
});
assert.equal(validateBrokenRefFixture({}), false, 'schema validation must fail unresolved local refs instead of skipping nested validation');
assert.ok(validateBrokenRefFixture.errors.some((error) => error.includes('unresolved schema ref')), 'unresolved ref validation should expose a clear error');

const modelPlanExample = await readJson('examples/switch-controller/model-plan.example.json');
assertValid(validateModelPlan, modelPlanExample, 'switch controller model-plan.example.json');
const realWorldBuildingManifestExample = await readJson('examples/real-world-building-positive/manifest.example.json');
assertValid(validateRealWorldBuildingManifest, realWorldBuildingManifestExample, 'real-world building manifest.example.json');
const realWorldBuildingUploadManifestExample = await readJson('examples/real-world-building-positive/upload-manifest.example.json');
assertValid(validateRealWorldBuildingUploadManifest, realWorldBuildingUploadManifestExample, 'real-world building upload-manifest.example.json');
const preparedRealWorldBuildingManifest = buildRealWorldBuildingPositiveManifest({
  sampleId: 'schema-contract-draft',
  sourceImages: [
    'test/real-building-demo/top-view.jpg',
    'test/real-building-demo/oblique-view.jpg'
  ],
  profilePath: 'examples/product-profiles/building_group_industrial_campus.json',
  artifacts: {
    part_graph: 'projects/image-structured-modeler/examples/real-world-building-positive/part-graph.json',
    output: 'projects/image-structured-modeler/examples/real-world-building-positive/output.json',
    photo_grade_readiness_report: 'projects/image-structured-modeler/examples/real-world-building-positive/photo-grade-readiness-report.json',
    vision_evidence_report: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-v1-report.json',
    vision_evidence_review_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review-patch.json',
    vision_evidence_review_decision: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review.accepted.json',
    vision_evidence_policy_correction_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-policy-correction-patch.json',
    geometry_fit_report: 'projects/image-structured-modeler/examples/real-world-building-positive/geometry-fit-report.json'
  },
  review: {
    reviewer: 'schema contract',
    acceptedAt: '2026-06-16',
    notes: 'Schema-only draft; real assets are validated by the release manifest gate.'
  }
});
assertValid(validateRealWorldBuildingManifest, preparedRealWorldBuildingManifest, 'prepared real-world building manifest draft');
const preparedRealWorldBuildingChecklist = await buildRealWorldBuildingPositiveReleaseChecklist({
  manifest: preparedRealWorldBuildingManifest,
  manifestPath: 'output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json'
});
assertValid(validateRealWorldBuildingChecklist, preparedRealWorldBuildingChecklist, 'prepared real-world building release checklist');
const checklistWithoutVisionReview = JSON.parse(JSON.stringify(preparedRealWorldBuildingChecklist));
checklistWithoutVisionReview.checks = checklistWithoutVisionReview.checks.filter((check) => check.id !== 'vision_evidence_review');
assert.equal(validateRealWorldBuildingChecklist(checklistWithoutVisionReview), false, 'release checklist schema should reject missing VisionEvidence review check');
assert.ok(
  validateRealWorldBuildingChecklist.errors.some((error) => error.includes('vision_evidence_review')),
  'release checklist schema missing-check error should name VisionEvidence review'
);
const preparedRealWorldBuildingWorkOrder = buildRealWorldBuildingReleaseWorkOrder({
  manifest: preparedRealWorldBuildingManifest,
  checklist: preparedRealWorldBuildingChecklist,
  manifestPath: 'output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json'
});
assertValid(validateRealWorldBuildingReleaseWorkOrder, preparedRealWorldBuildingWorkOrder, 'prepared real-world building release work order');
assert.equal(preparedRealWorldBuildingWorkOrder.artifact_authoring_policy.direct_sketchup_dsl_allowed, false, 'release work order should forbid direct SketchUp DSL authoring');
assert.equal(preparedRealWorldBuildingWorkOrder.artifact_authoring_policy.promoted_geometry_requires_review, true, 'release work order should require reviewed geometry promotion');
assert.ok(
  preparedRealWorldBuildingWorkOrder.artifact_authoring_policy.required_contract_artifacts.includes('release-artifact-workspace.json'),
  'release work order should point artifact authors to release artifact workspace'
);
const workOrderWithoutVisionReviewDecision = JSON.parse(JSON.stringify(preparedRealWorldBuildingWorkOrder));
const workOrderVisionReviewTask = workOrderWithoutVisionReviewDecision.tasks.find((task) => task.id === 'vision_evidence_review');
workOrderVisionReviewTask.artifacts = workOrderVisionReviewTask.artifacts.filter((artifact) => artifact.role !== 'vision_evidence_review_decision');
assert.equal(validateRealWorldBuildingReleaseWorkOrder(workOrderWithoutVisionReviewDecision), false, 'release work-order schema should reject missing VisionEvidence accepted decision artifact');
assert.ok(
  validateRealWorldBuildingReleaseWorkOrder.errors.some((error) => error.includes('vision_evidence_review_decision')),
  'release work-order schema missing-artifact error should name VisionEvidence accepted decision'
);
assert.equal(preparedRealWorldBuildingWorkOrder.status, 'blocked_needs_source_assets', 'schema-only work order should first block on source assets');
assert.ok(preparedRealWorldBuildingWorkOrder.tasks.some((task) => task.id === 'part_graph' && task.status === 'blocked'), 'work order should expose missing PartGraph task');
assert.ok(preparedRealWorldBuildingWorkOrder.tasks.some((task) => task.id === 'compiled_output' && task.command?.includes('compile-part-graph-to-sketchup-dsl')), 'work order should include compile command when manifest paths exist');
assert.equal(preparedRealWorldBuildingChecklist.release_ready, false, 'schema-only real-world building checklist should remain blocked without real files');
assert.ok(preparedRealWorldBuildingChecklist.blockers.includes('source_assets'), 'checklist should require existing real source assets');
assert.ok(preparedRealWorldBuildingChecklist.blockers.includes('artifacts'), 'checklist should require existing release artifacts');
const preparedRealWorldBuildingChecklistMarkdown = renderRealWorldBuildingPositiveReleaseChecklistMarkdown(preparedRealWorldBuildingChecklist);
assert.ok(preparedRealWorldBuildingChecklistMarkdown.includes('Real-World Building Positive Release Checklist'), 'checklist markdown should include title');
assert.ok(preparedRealWorldBuildingChecklistMarkdown.includes('Can promote to release manifest'), 'checklist markdown should expose promotion decision');
const preparedRealWorldBuildingWorkOrderMarkdown = renderRealWorldBuildingReleaseWorkOrderMarkdown(preparedRealWorldBuildingWorkOrder);
assert.ok(preparedRealWorldBuildingWorkOrderMarkdown.includes('Real-World Building Release Work Order'), 'work order markdown should include title');
assert.ok(preparedRealWorldBuildingWorkOrderMarkdown.includes('Reviewed PartGraph artifact'), 'work order markdown should expose release artifact tasks');
assert.ok(preparedRealWorldBuildingWorkOrderMarkdown.includes('Artifact Authoring Policy'), 'work order markdown should expose artifact authoring policy');
const screenshotPathChecklist = await buildRealWorldBuildingPositiveReleaseChecklist({
  manifest: {
    ...preparedRealWorldBuildingManifest,
    source_images: ['test/real-building-demo/screenshot-source.jpg']
  },
  manifestPath: 'output/image-structured-modeler/real-world-building-positive-manifest/screenshot-manifest.draft.json'
});
assert.ok(screenshotPathChecklist.blockers.includes('source_assets'), 'checklist should block screenshot/scaffold source paths');
assert.equal(
  screenshotPathChecklist.checks.find((check) => check.id === 'source_assets').items[0].generated_path_blocker,
  true,
  'checklist should mark screenshot source path as generated/scaffold blocker'
);
const preparedRealWorldBuildingCli = await prepareRealWorldBuildingReleaseSampleCli({
  sampleId: 'schema-contract-cli-draft',
  sourceImages: [
    'test/real-building-demo/top-view.jpg',
    'test/real-building-demo/oblique-view.jpg'
  ],
  profilePath: 'examples/product-profiles/building_group_industrial_campus.json',
  artifacts: {
    part_graph: 'projects/image-structured-modeler/examples/real-world-building-positive/part-graph.json',
    output: 'projects/image-structured-modeler/examples/real-world-building-positive/output.json',
    photo_grade_readiness_report: 'projects/image-structured-modeler/examples/real-world-building-positive/photo-grade-readiness-report.json',
    vision_evidence_report: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-v1-report.json',
    vision_evidence_review_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review-patch.json',
    vision_evidence_review_decision: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review.accepted.json',
    vision_evidence_policy_correction_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-policy-correction-patch.json'
  },
  review: {
    reviewer: 'schema contract',
    accepted_at: '2026-06-16',
    notes: 'Schema-only CLI draft; real assets are validated by the release manifest gate.'
  },
  manifestOutput: 'output/image-structured-modeler/real-world-building-positive-manifest-cli/manifest.draft.json'
});
assertValid(validateRealWorldBuildingManifest, preparedRealWorldBuildingCli.manifest, 'prepared real-world building CLI manifest draft');
assertValid(validateRealWorldBuildingChecklist, preparedRealWorldBuildingCli.checklist, 'prepared real-world building CLI checklist draft');
assert.equal(preparedRealWorldBuildingCli.checklist.release_ready, false, 'prepared real-world building CLI checklist should remain blocked without real files');
await fs.access(path.join(repoRoot, preparedRealWorldBuildingCli.manifestOutput));
await fs.access(path.join(repoRoot, preparedRealWorldBuildingCli.contractSummaryOutput));
await fs.access(path.join(repoRoot, preparedRealWorldBuildingCli.checklistOutput));
await fs.access(path.join(repoRoot, preparedRealWorldBuildingCli.checklistMarkdownOutput));
await fs.access(path.join(repoRoot, preparedRealWorldBuildingCli.workOrderOutput));
await fs.access(path.join(repoRoot, preparedRealWorldBuildingCli.workOrderMarkdownOutput));
assertValid(validateRealWorldBuildingReleaseWorkOrder, preparedRealWorldBuildingCli.workOrder, 'prepared real-world building CLI work order');
assert.equal(preparedRealWorldBuildingCli.workOrder.status, 'blocked_needs_source_assets', 'prepared real-world building CLI work order should preserve source blocker');
assert.ok(preparedRealWorldBuildingCli.workOrder.tasks.some((task) => task.id === 'photo_grade_readiness' && task.status === 'blocked'), 'prepared CLI work order should expose PhotoGradeReadiness task');
assert.equal(preparedRealWorldBuildingCli.validation.status, 'manifest_invalid_release_gap_recorded', 'prepared real-world building CLI draft should write invalid status summary');
assert.equal(JSON.parse(await fs.readFile(path.join(repoRoot, preparedRealWorldBuildingCli.contractSummaryOutput), 'utf8')).closes_release_gap, false, 'prepared real-world building CLI summary should not close the release gap');
const invalidDraftValidationOutput = 'output/image-structured-modeler/real-world-building-positive-manifest-cli/invalid-draft-validation';
const invalidDraftValidation = await validateRealWorldBuildingReleaseSampleCli({
  manifestPath: preparedRealWorldBuildingCli.manifestOutput,
  outputDir: invalidDraftValidationOutput,
  requirePresent: true
});
assert.equal(invalidDraftValidation.ok, false, 'invalid real-world building draft validation should fail closed');
assert.equal(invalidDraftValidation.status, 'manifest_invalid_release_gap_recorded', 'invalid real-world building draft should return structured failure status');
assert.equal(invalidDraftValidation.metrics.manifest_present, true, 'invalid real-world building draft validation should record manifest presence');
assert.equal(invalidDraftValidation.metrics.closes_release_gap, false, 'invalid real-world building draft validation must not close release gap');
assert.ok(invalidDraftValidation.metrics.release_checklist_blocker_ids.includes('source_assets'), 'invalid draft validation should preserve source asset blocker');
assert.ok(invalidDraftValidation.metrics.release_checklist_blocker_ids.includes('artifacts'), 'invalid draft validation should preserve artifact blocker');
assert.ok(invalidDraftValidation.metrics.release_checklist_blocker_ids.includes('vision_evidence_review'), 'invalid draft validation should preserve VisionEvidence review blocker');
assertValid(validateRealWorldBuildingChecklist, JSON.parse(await fs.readFile(path.join(repoRoot, invalidDraftValidationOutput, 'release-checklist.json'), 'utf8')), 'invalid real-world building draft validation checklist');
assert.equal(JSON.parse(await fs.readFile(path.join(repoRoot, invalidDraftValidationOutput, 'manifest-contract-summary.json'), 'utf8')).closes_release_gap, false, 'invalid real-world building draft summary should not close the release gap');
assert.ok((await fs.readFile(path.join(repoRoot, invalidDraftValidationOutput, 'release-checklist.md'), 'utf8')).includes('Next Actions'), 'invalid real-world building draft checklist markdown should include next actions');
const formalManifestAbsolutePath = path.join(repoRoot, DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST);
let formalManifestBefore = null;
try {
  formalManifestBefore = await fs.readFile(formalManifestAbsolutePath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const blockedFormalStagingOutput = 'output/image-structured-modeler/real-world-building-positive-manifest-cli/formal-target-blocked/manifest.draft.json';
const blockedFormalManifestWrite = await prepareRealWorldBuildingReleaseSampleCli({
  sampleId: 'schema-contract-formal-target-blocked',
  sourceImages: [
    'test/real-building-demo/top-view.jpg',
    'test/real-building-demo/oblique-view.jpg'
  ],
  profilePath: 'examples/product-profiles/building_group_industrial_campus.json',
  artifacts: {
    part_graph: 'projects/image-structured-modeler/examples/real-world-building-positive/part-graph.json',
    output: 'projects/image-structured-modeler/examples/real-world-building-positive/output.json',
    photo_grade_readiness_report: 'projects/image-structured-modeler/examples/real-world-building-positive/photo-grade-readiness-report.json',
    vision_evidence_report: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-v1-report.json',
    vision_evidence_review_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review-patch.json',
    vision_evidence_review_decision: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review.accepted.json',
    vision_evidence_policy_correction_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-policy-correction-patch.json'
  },
  review: {
    reviewer: 'schema contract',
    accepted_at: '2026-06-16',
    notes: 'Formal target write must be blocked until validation can promote.'
  },
  manifestOutput: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  formalManifestStagingOutput: blockedFormalStagingOutput
});
assert.equal(blockedFormalManifestWrite.ok, false, 'invalid formal release manifest write should fail closed');
assert.equal(blockedFormalManifestWrite.status, 'formal_release_manifest_write_blocked', 'invalid formal release manifest write should report blocked status');
assert.equal(blockedFormalManifestWrite.manifestOutput, blockedFormalStagingOutput, 'invalid formal release manifest write should return safe staging draft path');
assert.equal(blockedFormalManifestWrite.requestedManifestOutput, DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST, 'invalid formal release manifest write should record requested formal path');
assert.equal(blockedFormalManifestWrite.validationManifestOutput, blockedFormalStagingOutput, 'invalid formal release manifest write should validate staging draft');
assert.equal(blockedFormalManifestWrite.formalManifestTargetRequested, true, 'invalid formal release manifest write should mark formal target request');
assert.equal(blockedFormalManifestWrite.formalManifestWriteBlocked, true, 'invalid formal release manifest write should not write formal manifest');
assert.ok(blockedFormalManifestWrite.formalManifestBlockers.includes('source_assets'), 'blocked formal release manifest write should preserve source asset blocker');
assert.ok(blockedFormalManifestWrite.formalManifestBlockers.includes('artifacts'), 'blocked formal release manifest write should preserve artifact blocker');
assert.ok(blockedFormalManifestWrite.formalManifestBlockers.includes('vision_evidence_review'), 'blocked formal release manifest write should preserve VisionEvidence review blocker');
assert.equal(blockedFormalManifestWrite.validation.status, 'manifest_invalid_release_gap_recorded', 'blocked formal release manifest write should still emit validation status');
assertValid(validateRealWorldBuildingReleaseWorkOrder, blockedFormalManifestWrite.workOrder, 'blocked formal release manifest work order');
assert.equal(blockedFormalManifestWrite.workOrder.status, 'blocked_needs_source_assets', 'blocked formal release manifest work order should remain blocked');
await fs.access(path.join(repoRoot, blockedFormalStagingOutput));
let formalManifestAfter = null;
try {
  formalManifestAfter = await fs.readFile(formalManifestAbsolutePath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
assert.equal(formalManifestAfter, formalManifestBefore, 'invalid formal release manifest write must not create or modify the formal manifest');
const sourceProvenanceFixtureRelative = 'output/image-structured-modeler/real-world-building-source-provenance-fixture';
const sourceProvenanceFixtureDir = path.join(repoRoot, sourceProvenanceFixtureRelative);
const sourceProvenanceSourceImages = [
  `${sourceProvenanceFixtureRelative}/source/top-view.jpg`,
  `${sourceProvenanceFixtureRelative}/source/oblique-view.jpg`
];
await fs.mkdir(path.join(sourceProvenanceFixtureDir, 'source'), { recursive: true });
await fs.writeFile(path.join(repoRoot, sourceProvenanceSourceImages[0]), 'real building top-view fixture source\n', 'utf8');
await fs.writeFile(path.join(repoRoot, sourceProvenanceSourceImages[1]), 'real building oblique-view fixture source\n', 'utf8');
const sourceProvenancePartGraph = JSON.parse(JSON.stringify(await readRepoJson('projects/image-structured-modeler/examples/building-group/part-graph.r7-final.json')));
sourceProvenancePartGraph.id = 'real-world-building-source-provenance-fixture-part-graph';
rewritePartGraphSourceImageReferences(sourceProvenancePartGraph, sourceProvenanceSourceImages);
const sourceProvenancePartGraphPath = `${sourceProvenanceFixtureRelative}/part-graph.json`;
const sourceProvenanceOutputPath = `${sourceProvenanceFixtureRelative}/output.json`;
const sourceProvenanceReadinessPath = `${sourceProvenanceFixtureRelative}/photo-grade-readiness-report.json`;
const sourceProvenanceVisionEvidenceReportPath = `${sourceProvenanceFixtureRelative}/vision-evidence-v1-report.json`;
const sourceProvenanceVisionReviewPatchPath = `${sourceProvenanceFixtureRelative}/vision-evidence-review-patch.json`;
const sourceProvenanceVisionReviewDecisionPath = `${sourceProvenanceFixtureRelative}/vision-evidence-review.accepted.json`;
const sourceProvenanceVisionPolicyPatchPath = `${sourceProvenanceFixtureRelative}/vision-evidence-policy-correction-patch.json`;
const sourceProvenanceProfile = await readRepoJson('examples/product-profiles/building_group_industrial_campus.json');
const sourceProvenanceOutput = compilePartGraphToSketchUpDsl(sourceProvenancePartGraph, sourceProvenanceProfile, { repoRoot });
await fs.writeFile(path.join(repoRoot, sourceProvenancePartGraphPath), `${JSON.stringify(sourceProvenancePartGraph, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(repoRoot, sourceProvenanceOutputPath), `${JSON.stringify(sourceProvenanceOutput, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(repoRoot, sourceProvenanceReadinessPath), `${JSON.stringify({
  version: 1,
  kind: 'photo_grade_readiness_qa',
  ok: true,
  photo_grade_readiness: 'technical_baseline',
  photo_grade_candidate: false,
  sample: {
    input_asset_status: 'available'
  },
  blockers: []
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(repoRoot, sourceProvenanceVisionEvidenceReportPath), `${JSON.stringify({
  version: 1,
  kind: 'vision_evidence_set_v1_report',
  summary: {
    default_heavy_model_required: false
  }
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(repoRoot, sourceProvenanceVisionReviewPatchPath), `${JSON.stringify({
  version: 1,
  kind: 'vision_evidence_review_patch',
  status: 'needs_review',
  apply_allowed: false,
  compile_allowed: false,
  geometry_promotion_allowed: false,
  summary: {
    total_items: 1,
    semantic_candidate_items: 1
  },
  review_items: [
    {
      id: 'semantic_candidate:source_provenance_fixture',
      review_type: 'semantic_candidate_policy',
      status: 'needs_review'
    }
  ]
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(repoRoot, sourceProvenanceVisionReviewDecisionPath), `${JSON.stringify({
  version: 1,
  kind: 'vision_evidence_review_decision',
  status: 'accepted_policy_review',
  compile_allowed: false,
  geometry_promotion_allowed: false,
  summary: {
    accepted_items: 1
  },
  accepted_items: [
    {
      id: 'semantic_candidate:source_provenance_fixture',
      decision: 'accepted_policy_review'
    }
  ]
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(repoRoot, sourceProvenanceVisionPolicyPatchPath), `${JSON.stringify({
  version: 1,
  kind: 'vision_evidence_policy_correction_patch',
  status: 'ready_for_vision_evidence_policy_update',
  apply_scope: 'vision_evidence_set_policy_only',
  apply_allowed: true,
  compile_allowed: false,
  geometry_promotion_allowed: false,
  summary: {
    total_actions: 1
  },
  actions: [
    {
      id: 'semantic_candidate:source_provenance_fixture',
      action: 'record_policy_review'
    }
  ]
}, null, 2)}\n`, 'utf8');
const sourceProvenanceAlignedManifest = buildRealWorldBuildingPositiveManifest({
  sampleId: 'source-provenance-aligned-fixture',
  sourceImages: sourceProvenanceSourceImages,
  sourceAssetKind: 'real_building_photo_or_scan',
  profilePath: 'examples/product-profiles/building_group_industrial_campus.json',
  artifacts: {
    part_graph: sourceProvenancePartGraphPath,
    output: sourceProvenanceOutputPath,
    photo_grade_readiness_report: sourceProvenanceReadinessPath,
    vision_evidence_report: sourceProvenanceVisionEvidenceReportPath,
    vision_evidence_review_patch: sourceProvenanceVisionReviewPatchPath,
    vision_evidence_review_decision: sourceProvenanceVisionReviewDecisionPath,
    vision_evidence_policy_correction_patch: sourceProvenanceVisionPolicyPatchPath
  },
  review: {
    reviewer: 'source provenance contract',
    acceptedAt: '2026-06-17',
    notes: 'Regression fixture for manifest-to-PartGraph source provenance alignment.'
  }
});
assertValid(validateRealWorldBuildingManifest, sourceProvenanceAlignedManifest, 'source provenance aligned real-world building manifest');
const sourceProvenanceAlignedValidation = await validateRealWorldBuildingPositiveManifest({
  manifest: sourceProvenanceAlignedManifest,
  manifestPath: `${sourceProvenanceFixtureRelative}/manifest.aligned.json`,
  outputDir: path.join(sourceProvenanceFixtureDir, 'aligned-validation')
});
assert.equal(sourceProvenanceAlignedValidation.metrics.source_images_align_with_part_graph, true, 'aligned real-world building manifest should prove PartGraph source provenance alignment');
assert.equal(sourceProvenanceAlignedValidation.metrics.part_graph_source_images, 2, 'aligned real-world building manifest should expose two PartGraph source images');
assert.equal(sourceProvenanceAlignedValidation.summary.qa.source_images_align_with_part_graph, true, 'aligned real-world building summary should record source provenance alignment');
await assert.rejects(
  () => validateRealWorldBuildingPositiveManifest({
    manifest: {
      ...sourceProvenanceAlignedManifest,
      sample_id: 'source-provenance-mismatch-fixture',
      source_images: [sourceProvenanceSourceImages[0]]
    },
    manifestPath: `${sourceProvenanceFixtureRelative}/manifest.mismatch.json`,
    outputDir: path.join(sourceProvenanceFixtureDir, 'mismatch-validation')
  }),
  /PartGraph source images must be listed in manifest\.source_images/,
  'real-world building manifest validation should reject PartGraph source images missing from manifest.source_images'
);
await fs.writeFile(path.join(repoRoot, sourceProvenanceSourceImages[1]), 'real building top-view fixture source\n', 'utf8');
const duplicateSourceChecklist = await buildRealWorldBuildingPositiveReleaseChecklist({
  manifest: {
    ...sourceProvenanceAlignedManifest,
    sample_id: 'source-provenance-duplicate-source-fixture'
  },
  manifestPath: `${sourceProvenanceFixtureRelative}/manifest.duplicate-source.json`
});
assert.ok(duplicateSourceChecklist.blockers.includes('source_assets'), 'duplicate source content checklist should block source assets');
assert.ok(
  duplicateSourceChecklist.checks.find((check) => check.id === 'source_assets').items.some((item) => item.duplicate_content_blocker === true),
  'duplicate source content checklist should mark duplicated source items'
);
await assert.rejects(
  () => validateRealWorldBuildingPositiveManifest({
    manifest: {
      ...sourceProvenanceAlignedManifest,
      sample_id: 'source-provenance-duplicate-source-fixture'
    },
    manifestPath: `${sourceProvenanceFixtureRelative}/manifest.duplicate-source.json`,
    outputDir: path.join(sourceProvenanceFixtureDir, 'duplicate-source-validation')
  }),
  /source images must not contain duplicate file content/,
  'real-world building manifest validation should reject duplicate source file content'
);
const inputReadySourcePackage = assessRealWorldBuildingSourcePackage({
  generatedAt: '2026-06-17T00:00:00.000Z',
  assetSet: {
    version: 1,
    kind: 'asset_set',
    id: 'real-building-source-package-input-ready-fixture',
    source_input: 'test/real-building-demo',
    assets: [
      {
        id: 'asset_front',
        path: 'test/real-building-demo/front-view.jpg',
        media_type: 'image',
        detected_view: 'front',
        quality: 'usable',
        content_sha256: 'source-package-ready-front'
      },
      {
        id: 'asset_left',
        path: 'test/real-building-demo/left-view.jpg',
        media_type: 'image',
        detected_view: 'left',
        quality: 'usable',
        content_sha256: 'source-package-ready-left'
      },
      {
        id: 'asset_oblique',
        path: 'test/real-building-demo/oblique-view.jpg',
        media_type: 'image',
        detected_view: 'oblique',
        quality: 'usable',
        content_sha256: 'source-package-ready-oblique'
      },
      {
        id: 'asset_top',
        path: 'test/real-building-demo/top-view.jpg',
        media_type: 'image',
        detected_view: 'top',
        quality: 'usable',
        content_sha256: 'source-package-ready-top'
      }
    ],
    profile_routing: {
      object_type: 'building_single',
      object_name: 'Input Ready Building Source Package Fixture',
      selected_profile: 'building_single',
      status: 'routed',
      risks: []
    },
    gates: {
      can_compile_geometry: false,
      reasons: []
    }
  },
  observationSet: {
    object: {
      profile: 'building_single'
    },
    views_detected: ['front', 'left', 'oblique', 'top'],
    scale_calibration: {
      confidence: 0.82
    }
  },
  candidateGraph: {
    candidates: REQUIRED_BUILDING_SINGLE_SOURCE_ROLES.map((role, index) => ({
      id: `source-package-ready-${index + 1}`,
      role,
      view: index % 2 === 0 ? 'front' : 'oblique',
      confidence: 0.78
    }))
  },
  checklist: {
    release_ready: false,
    can_promote_to_release_manifest: false,
    blockers: [],
    next_actions: []
  }
});
assertValid(validateRealWorldBuildingSourcePackage, inputReadySourcePackage, 'input-ready real-world building source package');
assert.equal(inputReadySourcePackage.status, 'input_ready_for_release_work', 'complete real-world building source package should be input-ready');
assert.equal(inputReadySourcePackage.input_ready_for_release_work, true, 'complete source package should allow release-sample modeling work');
assert.equal(inputReadySourcePackage.release_ready, false, 'input-ready source package must not claim release readiness');
assert.equal(inputReadySourcePackage.source_authenticity.status, 'pass', 'input-ready source package should pass source authenticity');
assert.equal(inputReadySourcePackage.view_package.status, 'pass', 'input-ready source package should pass required views');
assert.ok(inputReadySourcePackage.view_package.view_evidence.some((item) => item.view === 'left' && item.status === 'present' && item.source_images.includes('test/real-building-demo/left-view.jpg')), 'input-ready source package should expose view evidence');
assert.equal(inputReadySourcePackage.scale_package.status, 'pass', 'input-ready source package should pass scale confidence');
assert.equal(inputReadySourcePackage.semantic_package.status, 'pass', 'input-ready source package should pass semantic coverage');
assert.ok(inputReadySourcePackage.semantic_package.role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered' && item.candidate_ids.length > 0), 'input-ready source package should expose semantic role evidence');
assert.equal(inputReadySourcePackage.semantic_package.evidence_quality.status, 'review_required', 'input-ready source package should keep semantic evidence quality review-gated');
assert.equal(inputReadySourcePackage.semantic_package.evidence_quality.geometry_promotion_allowed, false, 'input-ready semantic quality must not allow geometry promotion');
assert.ok(inputReadySourcePackage.semantic_package.evidence_quality.review_required_roles.includes('rectangular_utility_ducts'), 'input-ready semantic quality should list duct role as review-required');
const inputReadyDuctRoleEvidence = inputReadySourcePackage.semantic_package.role_evidence.find((item) => item.role === 'rectangular_utility_ducts');
assert.equal(inputReadyDuctRoleEvidence.evidence_quality_status, 'review_candidate', 'duct role evidence should remain a review candidate');
assert.equal(inputReadyDuctRoleEvidence.geometry_promotion_allowed, false, 'duct role evidence must not directly allow geometry promotion');
assert.ok(inputReadyDuctRoleEvidence.quality_flags.includes('do_not_convert_to_round_pipe_or_trim'), 'duct role evidence should preserve square duct disambiguation flag');
assert.equal(inputReadySourcePackage.blockers.length, 0, 'input-ready source package should not carry source-package blockers');
assert.ok(renderRealWorldBuildingSourcePackageMarkdown(inputReadySourcePackage).includes('Input ready for release work: `true`'), 'input-ready source package markdown should expose readiness');
assertValid(validateRealWorldBuildingSourceRequest, inputReadySourcePackage.source_request, 'input-ready real-world building source request');
assert.equal(inputReadySourcePackage.source_request.status, 'input_ready_for_release_work', 'input-ready source request should expose review-work readiness');
assert.deepEqual(inputReadySourcePackage.source_request.blocked_until_satisfied, ['formal_release_manifest'], 'input-ready source request should only block formal release manifest');
assert.equal(inputReadySourcePackage.source_request.view_source_requirements.distinct_source_images_required, true, 'source request should require distinct source images for required views');
assert.deepEqual(inputReadySourcePackage.source_request.view_source_requirements.required_views, ['front', 'left', 'oblique', 'top'], 'source request should list required views for distinct source-image rule');
assert.equal(inputReadySourcePackage.source_request.view_source_requirements.blocker, 'view_sources_not_distinct', 'source request should name view source diversity blocker');
const inputReadySourceRequestMarkdown = renderRealWorldBuildingSourceRequestMarkdown(inputReadySourcePackage.source_request);
assert.ok(inputReadySourceRequestMarkdown.includes('Real-World Building Source Request'), 'source request markdown should include title');
assert.ok(inputReadySourceRequestMarkdown.includes('View Source Requirements'), 'source request markdown should include distinct view-source section');
const viewMissingSourcePackage = assessRealWorldBuildingSourcePackage({
  generatedAt: '2026-06-17T00:00:00.000Z',
  assetSet: {
    version: 1,
    kind: 'asset_set',
    id: 'real-building-source-package-view-missing-fixture',
    source_input: 'test/real-building-demo-view-missing',
    assets: [
      {
        id: 'asset_front',
        path: 'test/real-building-demo-view-missing/front-view.jpg',
        media_type: 'image',
        detected_view: 'front',
        quality: 'usable',
        content_sha256: 'view-missing-front'
      }
    ],
    profile_routing: {
      object_type: 'building_single',
      object_name: 'View Missing Building Source Package Fixture',
      selected_profile: 'building_single',
      status: 'routed',
      risks: []
    },
    gates: {
      can_compile_geometry: false,
      reasons: []
    }
  },
  observationSet: {
    object: {
      profile: 'building_single'
    },
    views_detected: ['front'],
    scale_calibration: {
      confidence: 0.82
    }
  },
  candidateGraph: {
    candidates: REQUIRED_BUILDING_SINGLE_SOURCE_ROLES.map((role, index) => ({
      id: `source-package-view-missing-${index + 1}`,
      role,
      view: 'front',
      confidence: 0.78
    }))
  },
  checklist: {
    release_ready: false,
    can_promote_to_release_manifest: false,
    blockers: [],
    next_actions: []
  }
});
assertValid(validateRealWorldBuildingSourcePackage, viewMissingSourcePackage, 'view-missing real-world building source package');
assert.equal(viewMissingSourcePackage.status, 'needs_views_or_scale', 'view-missing source package should require more views');
assert.ok(viewMissingSourcePackage.view_package.view_evidence.some((item) => item.view === 'left' && item.status === 'missing'), 'view-missing source package should expose missing view evidence');
const semanticMissingSourcePackage = assessRealWorldBuildingSourcePackage({
  generatedAt: '2026-06-17T00:00:00.000Z',
  assetSet: {
    version: 1,
    kind: 'asset_set',
    id: 'real-building-source-package-semantic-missing-fixture',
    source_input: 'test/real-building-demo-semantic-missing',
    assets: inputReadySourcePackage.source_authenticity.asset_count
      ? [
          {
            id: 'asset_front',
            path: 'test/real-building-demo-semantic-missing/front-view.jpg',
            media_type: 'image',
            detected_view: 'front',
            quality: 'usable',
            content_sha256: 'semantic-missing-front'
          },
          {
            id: 'asset_left',
            path: 'test/real-building-demo-semantic-missing/left-view.jpg',
            media_type: 'image',
            detected_view: 'left',
            quality: 'usable',
            content_sha256: 'semantic-missing-left'
          },
          {
            id: 'asset_oblique',
            path: 'test/real-building-demo-semantic-missing/oblique-view.jpg',
            media_type: 'image',
            detected_view: 'oblique',
            quality: 'usable',
            content_sha256: 'semantic-missing-oblique'
          },
          {
            id: 'asset_top',
            path: 'test/real-building-demo-semantic-missing/top-view.jpg',
            media_type: 'image',
            detected_view: 'top',
            quality: 'usable',
            content_sha256: 'semantic-missing-top'
          }
        ]
      : [],
    profile_routing: {
      object_type: 'building_single',
      object_name: 'Semantic Missing Building Source Package Fixture',
      selected_profile: 'building_single',
      status: 'routed',
      risks: []
    },
    gates: {
      can_compile_geometry: false,
      reasons: []
    }
  },
  observationSet: {
    object: {
      profile: 'building_single'
    },
    views_detected: ['front', 'left', 'oblique', 'top'],
    scale_calibration: {
      confidence: 0.82
    }
  },
  candidateGraph: {
    candidates: [
      {
        id: 'semantic-missing-front-facade',
        role: 'visible_plane_primary',
        view: 'front',
        confidence: 0.78
      }
    ]
  },
  checklist: {
    release_ready: false,
    can_promote_to_release_manifest: false,
    blockers: [],
    next_actions: []
  }
});
assertValid(validateRealWorldBuildingSourcePackage, semanticMissingSourcePackage, 'semantic-missing real-world building source package');
assert.equal(semanticMissingSourcePackage.status, 'needs_semantic_review', 'semantic-missing source package should require semantic review');
assert.equal(semanticMissingSourcePackage.semantic_package.status, 'fail', 'semantic-missing source package should fail semantic coverage');
assert.ok(semanticMissingSourcePackage.semantic_package.role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'missing'), 'semantic-missing source package should expose missing role evidence');
assert.equal(semanticMissingSourcePackage.semantic_package.evidence_quality.status, 'missing', 'semantic-missing source package should expose missing semantic quality');
assert.ok(semanticMissingSourcePackage.semantic_package.evidence_quality.flags.includes('missing_candidate'), 'semantic-missing quality should expose missing candidate flag');
assert.ok(semanticMissingSourcePackage.source_request.upload_package_requirements.next_upload_response_check_ids.includes('semantic_rectangular_utility_ducts'), 'semantic-missing source request should expose semantic response check id');
assert.ok(semanticMissingSourcePackage.source_request.upload_package_requirements.semantic_evidence.missing_roles.includes('rectangular_utility_ducts'), 'semantic-missing upload package requirements should expose missing duct role');
const duplicateContentSourcePackage = assessRealWorldBuildingSourcePackage({
  generatedAt: '2026-06-17T00:00:00.000Z',
  assetSet: {
    version: 1,
    kind: 'asset_set',
    id: 'real-building-source-package-duplicate-content-fixture',
    source_input: 'test/real-building-demo-duplicates',
    assets: [
      {
        id: 'asset_front',
        path: 'test/real-building-demo-duplicates/front-view.jpg',
        media_type: 'image',
        detected_view: 'front',
        quality: 'usable',
        content_sha256: 'duplicate-source-content-hash'
      },
      {
        id: 'asset_left',
        path: 'test/real-building-demo-duplicates/left-view.jpg',
        media_type: 'image',
        detected_view: 'left',
        quality: 'usable',
        content_sha256: 'duplicate-source-content-hash'
      },
      {
        id: 'asset_oblique',
        path: 'test/real-building-demo-duplicates/oblique-view.jpg',
        media_type: 'image',
        detected_view: 'oblique',
        quality: 'usable',
        content_sha256: 'duplicate-source-content-oblique'
      },
      {
        id: 'asset_top',
        path: 'test/real-building-demo-duplicates/top-view.jpg',
        media_type: 'image',
        detected_view: 'top',
        quality: 'usable',
        content_sha256: 'duplicate-source-content-top'
      }
    ],
    profile_routing: {
      object_type: 'building_single',
      object_name: 'Duplicate Content Building Source Package Fixture',
      selected_profile: 'building_single',
      status: 'routed',
      risks: []
    },
    gates: {
      can_compile_geometry: false,
      reasons: []
    }
  },
  observationSet: {
    object: {
      profile: 'building_single'
    },
    views_detected: ['front', 'left', 'oblique', 'top'],
    scale_calibration: {
      confidence: 0.82
    }
  },
  candidateGraph: {
    candidates: REQUIRED_BUILDING_SINGLE_SOURCE_ROLES.map((role, index) => ({
      id: `source-package-duplicate-content-${index + 1}`,
      role,
      view: index % 2 === 0 ? 'front' : 'oblique',
      confidence: 0.78
    }))
  },
  checklist: {
    release_ready: false,
    can_promote_to_release_manifest: false,
    blockers: [],
    next_actions: []
  }
});
assertValid(validateRealWorldBuildingSourcePackage, duplicateContentSourcePackage, 'duplicate-content real-world building source package');
assert.equal(duplicateContentSourcePackage.source_authenticity.status, 'fail', 'duplicate source content should fail source authenticity');
assert.equal(duplicateContentSourcePackage.input_ready_for_release_work, false, 'duplicate source content must not be input-ready');
assert.ok(duplicateContentSourcePackage.blockers.includes('duplicate_source_assets'), 'duplicate source content should expose duplicate_source_assets blocker');
assert.equal(duplicateContentSourcePackage.source_authenticity.duplicate_content_assets.length, 1, 'duplicate source content should expose duplicate group');
assert.equal(duplicateContentSourcePackage.source_request.source_asset_requirements.needs_distinct_assets, true, 'duplicate source request should ask for distinct assets');
assert.equal(duplicateContentSourcePackage.source_request.view_source_requirements.distinct_source_images_required, true, 'duplicate source request should still require distinct source images per required view');
assert.ok(duplicateContentSourcePackage.source_request.source_asset_requirements.requests.some((request) => request.includes('duplicated')), 'duplicate source request should explain duplicated files');
const inputReadyUploadManifestTemplate = buildRealWorldBuildingUploadManifestTemplate({
  sourceRequest: inputReadySourcePackage.source_request,
  profileId: inputReadySourcePackage.profile_id,
  generatedAt: inputReadySourcePackage.generated_at
});
assertValid(validateRealWorldBuildingUploadManifest, inputReadyUploadManifestTemplate, 'input-ready upload manifest template');
assert.equal(inputReadyUploadManifestTemplate.template_only, true, 'upload manifest template should be marked template-only');
assert.equal(inputReadyUploadManifestTemplate.object_type, 'building_single', 'upload manifest template should preserve object type');
assert.ok(inputReadyUploadManifestTemplate.views.some((view) => view.kind === 'top'), 'upload manifest template should include top/plan view slot');
assert.equal(inputReadyUploadManifestTemplate.view_source_requirements.distinct_source_images_required, true, 'upload manifest template should carry distinct source-image rule');
assert.equal(inputReadyUploadManifestTemplate.view_source_requirements.blocker, 'view_sources_not_distinct', 'upload manifest template should name view source diversity blocker');
assert.ok(inputReadyUploadManifestTemplate.notes.includes('distinct uploaded source file'), 'upload manifest template notes should explain distinct source files');
const badSourceReadyChecklistPackage = assessRealWorldBuildingSourcePackage({
  assetSet: {
    version: 1,
    kind: 'asset_set',
    id: 'real-building-source-package-bad-source-fixture',
    source_input: 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png',
    assets: [
      {
        id: 'asset_1',
        path: 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png',
        media_type: 'image',
        detected_view: 'front',
        quality: 'usable'
      }
    ],
    profile_routing: {
      object_type: 'building_single',
      object_name: 'Bad Source Ready Checklist Fixture',
      selected_profile: 'building_single',
      status: 'routed',
      risks: []
    },
    gates: {
      can_compile_geometry: false,
      reasons: []
    }
  },
  observationSet: {
    object: {
      profile: 'building_single'
    },
    views_detected: ['front', 'left', 'oblique', 'top'],
    scale_calibration: {
      confidence: 0.82
    },
  },
  candidateGraph: {
    candidates: REQUIRED_BUILDING_SINGLE_SOURCE_ROLES.map((role, index) => ({
      id: `source-package-bad-source-${index + 1}`,
      role,
      view: 'front',
      confidence: 0.78
    }))
  },
  checklist: {
    release_ready: true,
    can_promote_to_release_manifest: true,
    blockers: [],
    next_actions: []
  }
});
assertValid(validateRealWorldBuildingSourcePackage, badSourceReadyChecklistPackage, 'bad-source real-world building source package');
assert.equal(badSourceReadyChecklistPackage.source_authenticity.status, 'fail', 'bad-source package should fail source authenticity');
assert.equal(badSourceReadyChecklistPackage.input_ready_for_release_work, false, 'bad-source package should not be input-ready');
assert.equal(badSourceReadyChecklistPackage.release_ready, false, 'source package must not expose release_ready when source gates fail');
assertValid(validateRealWorldBuildingSourceRequest, badSourceReadyChecklistPackage.source_request, 'bad-source source request');
assert.equal(badSourceReadyChecklistPackage.source_request.status, 'needs_source_replacement', 'bad-source source request should ask for replacement assets');
assert.ok(badSourceReadyChecklistPackage.source_request.blocked_until_satisfied.includes('direct_sketchup_dsl'), 'bad-source source request should block direct DSL');
const satisfiedSourceRequestResponse = buildRealWorldBuildingSourceRequestResponse({
  previousSourceRequest: badSourceReadyChecklistPackage.source_request,
  currentAssessment: inputReadySourcePackage,
  currentPreflightReport: {
    view_package: {
      view_source_diversity: {
        status: 'pass'
      }
    }
  },
  sourceRequestPath: 'output/image-structured-modeler/source-request-response-fixture/real-world-building-source-request.json',
  generatedAt: '2026-06-17T00:00:00.000Z'
});
assertValid(validateRealWorldBuildingSourceRequestResponse, satisfiedSourceRequestResponse, 'satisfied source-request response');
assert.equal(satisfiedSourceRequestResponse.status, 'satisfied_for_release_work', 'input-ready package should satisfy previous source request');
assert.equal(satisfiedSourceRequestResponse.ok, true, 'satisfied source-request response should be ok');
assert.equal(satisfiedSourceRequestResponse.checks.find((check) => check.id === 'source_assets').satisfied, true, 'satisfied source-request response should pass source assets');
assert.equal(satisfiedSourceRequestResponse.checks.find((check) => check.id === 'view_source_diversity').satisfied, true, 'satisfied source-request response should pass view source diversity');
assert.ok(satisfiedSourceRequestResponse.summary.requested_check_ids.includes('view_source_diversity'), 'satisfied source-request response should expose requested check ids');
assert.deepEqual(satisfiedSourceRequestResponse.summary.semantic_evidence.requested_roles, [], 'satisfied source-request response should expose empty semantic requested roles when previous request did not ask for semantic refill');
assert.deepEqual(satisfiedSourceRequestResponse.summary.unsatisfied_check_ids, [], 'satisfied source-request response should expose empty unsatisfied check ids');
assert.deepEqual(satisfiedSourceRequestResponse.summary.unsatisfied_check_details, [], 'satisfied source-request response should expose empty unsatisfied check details');
assert.ok(renderRealWorldBuildingSourceRequestResponseMarkdown(satisfiedSourceRequestResponse).includes('Real-World Building Source Request Response'), 'source-request response markdown should include title');
const viewSatisfiedSourceRequestResponse = buildRealWorldBuildingSourceRequestResponse({
  previousSourceRequest: viewMissingSourcePackage.source_request,
  currentAssessment: inputReadySourcePackage,
  currentPreflightReport: {
    view_package: {
      view_source_diversity: {
        status: 'pass'
      }
    }
  },
  sourceRequestPath: 'output/image-structured-modeler/source-request-response-fixture/view-source-request.json',
  generatedAt: '2026-06-17T00:00:00.000Z'
});
assertValid(validateRealWorldBuildingSourceRequestResponse, viewSatisfiedSourceRequestResponse, 'view satisfied source-request response');
assert.equal(viewSatisfiedSourceRequestResponse.status, 'satisfied_for_release_work', 'input-ready package should satisfy previous view source request');
assert.ok(viewSatisfiedSourceRequestResponse.summary.view_evidence.requested_views.includes('left'), 'source request response should expose requested view evidence');
assert.ok(viewSatisfiedSourceRequestResponse.summary.view_evidence.requested_view_evidence.some((item) => item.view === 'left' && item.status === 'present' && item.source_images.includes('test/real-building-demo/left-view.jpg')), 'source request response should expose requested view source path');
const semanticSatisfiedSourceRequestResponse = buildRealWorldBuildingSourceRequestResponse({
  previousSourceRequest: semanticMissingSourcePackage.source_request,
  currentAssessment: inputReadySourcePackage,
  currentPreflightReport: {
    view_package: {
      view_source_diversity: {
        status: 'pass'
      }
    }
  },
  sourceRequestPath: 'output/image-structured-modeler/source-request-response-fixture/semantic-source-request.json',
  generatedAt: '2026-06-17T00:00:00.000Z'
});
assertValid(validateRealWorldBuildingSourceRequestResponse, semanticSatisfiedSourceRequestResponse, 'semantic satisfied source-request response');
assert.equal(semanticSatisfiedSourceRequestResponse.status, 'satisfied_for_release_work', 'input-ready package should satisfy previous semantic source request');
assert.ok(semanticSatisfiedSourceRequestResponse.summary.expected_check_ids.includes('semantic_rectangular_utility_ducts'), 'semantic satisfied response should expose expected semantic check id');
assert.ok(semanticSatisfiedSourceRequestResponse.summary.semantic_evidence.previous_missing_roles.includes('rectangular_utility_ducts'), 'semantic satisfied response should expose previous missing duct role');
assert.ok(semanticSatisfiedSourceRequestResponse.summary.semantic_evidence.requested_roles.includes('rectangular_utility_ducts'), 'semantic satisfied response should expose requested duct role');
assert.ok(semanticSatisfiedSourceRequestResponse.summary.semantic_evidence.satisfied_roles.includes('rectangular_utility_ducts'), 'semantic satisfied response should expose satisfied duct role');
assert.ok(semanticSatisfiedSourceRequestResponse.summary.semantic_evidence.requested_role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered' && item.candidate_ids.length > 0), 'semantic satisfied response should expose requested duct role evidence');
assert.equal(semanticSatisfiedSourceRequestResponse.summary.semantic_evidence.evidence_quality.status, 'review_required', 'semantic satisfied response should keep semantic quality review-gated');
assert.ok(semanticSatisfiedSourceRequestResponse.summary.semantic_evidence.evidence_quality.review_required_roles.includes('rectangular_utility_ducts'), 'semantic satisfied response should expose requested duct review role');
assert.deepEqual(semanticSatisfiedSourceRequestResponse.summary.semantic_evidence.unsatisfied_roles, [], 'semantic satisfied response should expose no unsatisfied semantic roles');
const unsatisfiedSourceRequestResponse = buildRealWorldBuildingSourceRequestResponse({
  previousSourceRequest: badSourceReadyChecklistPackage.source_request,
  currentAssessment: badSourceReadyChecklistPackage,
  currentPreflightReport: {
    view_package: {
      view_source_diversity: {
        status: 'fail'
      }
    }
  },
  sourceRequestPath: 'output/image-structured-modeler/source-request-response-fixture/real-world-building-source-request.json',
  generatedAt: '2026-06-17T00:00:00.000Z'
});
assertValid(validateRealWorldBuildingSourceRequestResponse, unsatisfiedSourceRequestResponse, 'unsatisfied source-request response');
assert.equal(unsatisfiedSourceRequestResponse.status, 'not_satisfied', 'bad-source package should not satisfy previous source request');
assert.equal(unsatisfiedSourceRequestResponse.ok, false, 'unsatisfied source-request response should not be ok');
assert.equal(unsatisfiedSourceRequestResponse.checks.find((check) => check.id === 'source_assets').satisfied, false, 'unsatisfied source-request response should fail source assets');
assert.equal(unsatisfiedSourceRequestResponse.checks.find((check) => check.id === 'view_source_diversity').satisfied, false, 'unsatisfied source-request response should fail view source diversity');
assert.ok(unsatisfiedSourceRequestResponse.summary.unsatisfied_check_ids.includes('source_assets'), 'unsatisfied source-request response should expose source_assets failure id');
assert.ok(unsatisfiedSourceRequestResponse.summary.unsatisfied_check_ids.includes('view_source_diversity'), 'unsatisfied source-request response should expose view_source_diversity failure id');
assert.ok(unsatisfiedSourceRequestResponse.summary.unsatisfied_check_details.some((detail) => detail.id === 'view_source_diversity' && detail.current_status === 'fail'), 'unsatisfied source-request response should expose diversity failure detail');
const semanticUnsatisfiedSourceRequestResponse = buildRealWorldBuildingSourceRequestResponse({
  previousSourceRequest: semanticMissingSourcePackage.source_request,
  currentAssessment: semanticMissingSourcePackage,
  currentPreflightReport: {
    view_package: {
      view_source_diversity: {
        status: 'pass'
      }
    }
  },
  sourceRequestPath: 'output/image-structured-modeler/source-request-response-fixture/semantic-source-request.json',
  generatedAt: '2026-06-17T00:00:00.000Z'
});
assertValid(validateRealWorldBuildingSourceRequestResponse, semanticUnsatisfiedSourceRequestResponse, 'semantic unsatisfied source-request response');
assert.equal(semanticUnsatisfiedSourceRequestResponse.status, 'partially_satisfied', 'semantic-missing current package should only partially satisfy previous source request');
assert.ok(semanticUnsatisfiedSourceRequestResponse.summary.unsatisfied_check_ids.includes('semantic_rectangular_utility_ducts'), 'semantic unsatisfied response should expose failed semantic check id');
assert.ok(semanticUnsatisfiedSourceRequestResponse.summary.semantic_evidence.unsatisfied_roles.includes('rectangular_utility_ducts'), 'semantic unsatisfied response should expose unsatisfied duct role');
assert.equal(semanticUnsatisfiedSourceRequestResponse.summary.semantic_evidence.evidence_quality.status, 'missing', 'semantic unsatisfied response should expose missing semantic quality');
assert.ok(semanticUnsatisfiedSourceRequestResponse.summary.semantic_evidence.requested_role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'missing' && item.candidate_count === 0), 'semantic unsatisfied response should expose missing requested duct role evidence');
assert.ok(renderRealWorldBuildingSourceRequestResponseMarkdown(semanticUnsatisfiedSourceRequestResponse).includes('Semantic roles unsatisfied'), 'semantic response markdown should expose semantic role summary');
const invalidPreviousSourceRequestResponse = buildRealWorldBuildingSourceRequestResponse({
  previousSourceRequest: { version: 1, kind: 'not_a_source_request' },
  currentAssessment: inputReadySourcePackage,
  sourceRequestPath: 'output/image-structured-modeler/source-request-response-fixture/not-a-source-request.json',
  generatedAt: '2026-06-17T00:00:00.000Z'
});
assertValid(validateRealWorldBuildingSourceRequestResponse, invalidPreviousSourceRequestResponse, 'invalid previous source-request response');
assert.equal(invalidPreviousSourceRequestResponse.ok, false, 'invalid previous source-request contract should fail closed');
assert.equal(invalidPreviousSourceRequestResponse.status, 'partially_satisfied', 'invalid previous source-request contract should not be satisfied');
assert.equal(invalidPreviousSourceRequestResponse.checks.find((check) => check.id === 'previous_source_request_contract').satisfied, false, 'invalid previous source-request contract should be reported');
const intakeFixtureRelative = 'output/image-structured-modeler/real-world-building-intake-dir-fixture';
const intakeFixtureDir = path.join(repoRoot, intakeFixtureRelative);
const intakeFixtureSource = 'test/建筑单体/不得不承认，建模真是项技术活啊！！！_1_不得不建模_来自小红书网页版.png';
await fs.mkdir(intakeFixtureDir, { recursive: true });
await fs.writeFile(path.join(intakeFixtureDir, 'asset-set.json'), `${JSON.stringify({
  version: 1,
  kind: 'asset_set',
  id: 'real-building-intake-dir-fixture',
  source_input: 'test/建筑单体',
  assets: [
    {
      id: 'asset_1',
      path: intakeFixtureSource,
      media_type: 'image',
      detected_view: 'front',
      quality: 'review'
    }
  ],
  profile_routing: {
    object_type: 'building_single',
    object_name: 'Intake Dir Building Fixture',
    selected_profile: 'building_single',
    status: 'routed',
    risks: []
  },
  gates: {
    can_compile_geometry: false,
    reasons: ['scale_confidence_below_publish_gate']
  }
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(intakeFixtureDir, 'modeling-brief.json'), `${JSON.stringify({
  version: 1,
  kind: 'modeling_brief',
  profile_id: 'building_single',
  status: 'review_required',
  compile_allowed: false,
  missing_inputs: ['missing_oblique_view']
}, null, 2)}\n`, 'utf8');
const preparedFromIntakeDir = await prepareRealWorldBuildingReleaseSampleCli({
  intakeDir: intakeFixtureRelative,
  review: {
    reviewer: 'schema contract',
    accepted_at: '2026-06-16',
    notes: 'Intake-dir draft regression; not a release-positive sample.'
  },
  manifestOutput: path.join(intakeFixtureRelative, 'manifest.draft.json')
});
assert.equal(preparedFromIntakeDir.manifest.source_images.length, 1, 'intake-dir real-world draft should infer source images from AssetSet');
assert.equal(preparedFromIntakeDir.manifest.source_images[0], intakeFixtureSource, 'intake-dir real-world draft should preserve source image provenance');
assert.equal(preparedFromIntakeDir.manifest.profile_path, 'examples/product-profiles/building_single_urban_oblique.json', 'intake-dir real-world draft should map building_single to release profile');
assert.equal(preparedFromIntakeDir.manifest.artifacts.part_graph, `${intakeFixtureRelative}/part-graph.candidate-promoted.json`, 'intake-dir real-world draft should infer candidate promoted PartGraph path');
assert.equal(preparedFromIntakeDir.manifest.artifacts.output, `${intakeFixtureRelative}/output.json`, 'intake-dir real-world draft should infer output DSL path');
assert.equal(preparedFromIntakeDir.manifest.artifacts.photo_grade_readiness_report, `${intakeFixtureRelative}/photo-grade-readiness-report.json`, 'intake-dir real-world draft should infer PhotoGradeReadiness path');
assert.equal(preparedFromIntakeDir.checklist.release_ready, false, 'intake-dir real-world draft should remain blocked until source and artifacts are release-ready');
assert.ok(preparedFromIntakeDir.checklist.blockers.includes('source_assets'), 'intake-dir real-world draft should preserve source blocker for screenshot/web assets');
assert.ok(preparedFromIntakeDir.checklist.blockers.includes('artifacts'), 'intake-dir real-world draft should preserve missing artifact blockers');
assert.equal(preparedFromIntakeDir.validation.status, 'manifest_invalid_release_gap_recorded', 'intake-dir real-world draft should write invalid summary status');
assertValid(validateRealWorldBuildingManifest, JSON.parse(await fs.readFile(path.join(repoRoot, preparedFromIntakeDir.manifestOutput), 'utf8')), 'intake-dir prepared real-world building manifest');
assert.equal(JSON.parse(await fs.readFile(path.join(repoRoot, preparedFromIntakeDir.contractSummaryOutput), 'utf8')).qa.release_checklist, 'fail', 'intake-dir prepared real-world building summary should record checklist failure');
assertValid(validateRealWorldBuildingChecklist, JSON.parse(await fs.readFile(path.join(repoRoot, preparedFromIntakeDir.checklistOutput), 'utf8')), 'intake-dir prepared real-world building checklist');
const realWorldBuildingDemoCandidateAudit = await auditRealWorldBuildingDemoCandidates({
  inputs: [
    'test/建筑单体',
    'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png'
  ],
  outputDir: 'output/image-structured-modeler/real-world-building-demo-candidate-audit-test',
  objectType: 'building_single',
  writeReview: false,
  writeOverlays: false
});
assert.equal(realWorldBuildingDemoCandidateAudit.kind, 'real_world_building_demo_candidate_audit', 'demo candidate audit should emit the expected kind');
assertValid(validateRealWorldBuildingDemoCandidateAudit, realWorldBuildingDemoCandidateAudit, 'real-world building demo candidate audit report');
assert.equal(realWorldBuildingDemoCandidateAudit.ok, true, 'demo candidate audit should complete');
assert.equal(realWorldBuildingDemoCandidateAudit.release_ready, false, 'demo candidate audit should not mark local screenshot/generated samples release-ready');
assert.equal(realWorldBuildingDemoCandidateAudit.release_gap, 'real_world_building_positive_release_sample_missing', 'demo candidate audit should keep the building release gap visible');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.candidates, 2, 'demo candidate audit should evaluate both fixture candidates');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.release_ready_candidates, 0, 'demo candidate audit should not find release-ready local fixtures');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.input_ready_source_packages, 0, 'demo candidate audit should not mark local screenshot/generated inputs ready for release work');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.release_selectable_candidates, 0, 'demo candidate audit should not select local screenshot/generated inputs for release work');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.formal_manifest_selectable_candidates, 0, 'demo candidate audit should not select local fixtures for formal manifest promotion');
assert.ok(realWorldBuildingDemoCandidateAudit.summary.best_structure_review_candidate, 'demo candidate audit should still expose a structure-review candidate');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.best_release_work_candidate, null, 'demo candidate audit must not expose a release-work candidate without real source assets');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.best_formal_manifest_candidate, null, 'demo candidate audit must not expose a formal manifest candidate without release readiness');
assert.ok(realWorldBuildingDemoCandidateAudit.summary.useful_structure_review_demos >= 1, 'demo candidate audit should identify at least one useful structure review demo');
assert.equal(realWorldBuildingDemoCandidateAudit.summary.recommended_next_action, 'run_refill_upload_session_with_real_sources', 'demo candidate audit should recommend refill upload session for blocked local fixtures');
for (const candidate of realWorldBuildingDemoCandidateAudit.candidates) {
  assert.equal(candidate.compile_allowed, false, 'demo candidate audit candidates must remain fail-closed for compile');
  assert.equal(candidate.input_ready_for_release_work, false, 'demo candidate audit candidate source packages must remain blocked');
  assert.ok(candidate.source_package, 'demo candidate audit should include source-package assessment');
  assert.notEqual(candidate.source_package_status, 'input_ready_for_release_work', 'demo candidate audit should not mark local fixtures input-ready');
  assert.ok(candidate.source_package.blockers.some((blocker) => blocker === 'source_assets_generated_or_scaffold' || blocker.startsWith('missing_')), 'demo candidate audit source package should expose source/view blockers');
  assert.ok(candidate.source_request, 'demo candidate audit should include a source-request summary for each candidate');
  assert.equal(candidate.source_request.request_file, candidate.artifacts.source_request, 'demo candidate source-request summary should point at the saved source request');
  assert.equal(candidate.source_request.upload_manifest_template, candidate.artifacts.upload_manifest_template, 'demo candidate source-request summary should point at the upload manifest template');
  assert.equal(candidate.source_request.view_source_diversity_required, true, 'demo candidate source request should require distinct source images for required views');
  assert.ok(candidate.source_request.required_views.includes('front'), 'demo candidate source request should list front view requirement');
  assert.ok(candidate.source_request.required_views.includes('top'), 'demo candidate source request should list top view requirement');
  assert.ok(candidate.source_request.scale_evidence_needed || candidate.source_request.source_asset_status === 'fail', 'demo candidate source request should preserve source or scale work needed');
  assert.ok(['needs_real_source_assets', 'needs_views_or_scale'].includes(candidate.release_stage), 'demo candidate audit should expose a blocked refill stage');
  assert.equal(candidate.release_candidate_assessment.selectable_for_release_work, false, 'demo candidate audit must not mark blocked local fixtures selectable for release work');
  assert.equal(candidate.release_candidate_assessment.selectable_for_formal_manifest, false, 'demo candidate audit must not mark blocked local fixtures selectable for formal manifest');
  assert.ok(['needs_real_sources', 'needs_views_or_scale'].includes(candidate.release_candidate_assessment.tier), 'demo candidate release assessment should expose a source or view/scale tier');
  assert.ok(['source_assets', 'scale_evidence', 'view_coverage'].includes(candidate.release_candidate_assessment.primary_blocker), 'demo candidate release assessment should expose the primary source blocker');
  assert.equal(candidate.release_candidate_assessment.next_action, 'run_refill_upload_session_with_real_sources', 'demo candidate release assessment should route to source refill');
  assert.ok(candidate.release_candidate_assessment.blocked_reasons.length > 0, 'demo candidate release assessment should expose blocked reasons');
  assert.ok(candidate.refill_workflow, 'demo candidate audit should include a refill workflow');
  assert.equal(candidate.refill_workflow.source_request_file, candidate.artifacts.source_request, 'refill workflow should reuse the saved source request artifact');
  assert.equal(candidate.refill_workflow.upload_manifest_template, candidate.artifacts.upload_manifest_template, 'refill workflow should reuse the saved upload manifest template');
  assert.ok(candidate.refill_workflow.source_refill_package_directory.includes('real-world-building-source-refill-package'), 'refill workflow should expose a source-refill package directory');
  assert.ok(candidate.refill_workflow.upload_package_directory.endsWith('/upload-package'), 'refill workflow should expose the upload-package directory');
  assert.equal(candidate.refill_workflow.expected_upload_contract.distinct_source_images_required, true, 'refill workflow should preserve distinct-source contract');
  assert.ok(candidate.refill_workflow.commands.prepare_source_refill_package.includes('prepare-real-world-building-source-refill-package'), 'refill workflow should expose source-refill package preparation command');
  assert.ok(candidate.refill_workflow.commands.validate_source_refill_package_require_upload_ready.includes('--require-upload-ready'), 'refill workflow should expose source-refill package upload-ready validation command');
  assert.ok(candidate.refill_workflow.commands.run_refill_upload_session.includes('image-structured:real-world-building-upload-session'), 'refill workflow should provide upload-session command');
  assert.ok(candidate.refill_workflow.commands.run_refill_upload_session.includes('--source-request-file'), 'refill workflow should validate against previous source request');
  assert.ok(candidate.refill_workflow.commands.run_refill_upload_session.includes('/upload-package'), 'refill workflow upload-session command should consume the prepared upload-package directory');
  assert.ok(candidate.release_preparation_workflow, 'demo candidate audit should include release preparation workflow');
  assert.equal(candidate.release_preparation_workflow.status, 'blocked_until_source_request_satisfied', 'demo candidate release preparation workflow should remain blocked before real source refill');
  assert.equal(candidate.release_preparation_workflow.next_action, 'run_refill_upload_session_with_real_sources', 'demo candidate release preparation workflow should route blocked candidates to source refill');
  assert.equal(candidate.release_preparation_workflow.formal_manifest, 'projects/image-structured-modeler/examples/real-world-building-positive/manifest.json', 'demo candidate release workflow should point at the guarded formal manifest path');
  assert.ok(candidate.release_preparation_workflow.expected_release_artifacts.includes('part_graph'), 'demo candidate release workflow should list PartGraph as a required release artifact');
  assert.ok(candidate.release_preparation_workflow.expected_release_artifacts.includes('compiled_output'), 'demo candidate release workflow should list compiled output as a required release artifact');
  assert.ok(candidate.release_preparation_workflow.expected_release_artifacts.includes('photo_grade_readiness_report'), 'demo candidate release workflow should list PhotoGradeReadiness as a required release artifact');
  assert.ok(candidate.release_preparation_workflow.expected_release_artifacts.includes('vision_evidence_review_decision'), 'demo candidate release workflow should list VisionEvidence accepted decision as required');
  assert.ok(candidate.release_preparation_workflow.expected_release_artifacts.includes('vision_evidence_policy_correction_patch'), 'demo candidate release workflow should list VisionEvidence policy correction as required');
  assert.ok(candidate.release_preparation_workflow.commands.run_upload_session_from_candidate_input.includes('image-structured:real-world-building-upload-session'), 'demo candidate release workflow should expose upload-session command');
  assert.ok(candidate.release_preparation_workflow.commands.prepare_source_refill_package.includes('prepare-real-world-building-source-refill-package'), 'demo candidate release workflow should expose source-refill package preparation command');
  assert.ok(candidate.release_preparation_workflow.commands.validate_source_refill_package_require_upload_ready.includes('--require-upload-ready'), 'demo candidate release workflow should expose source-refill package upload-ready validation command');
  assert.ok(candidate.release_preparation_workflow.commands.run_refill_upload_session_with_real_sources.includes('/upload-package'), 'demo candidate release workflow should expose refill upload-session command for prepared upload-package');
  assert.ok(candidate.release_preparation_workflow.commands.prepare_release_artifact_workspace.includes('prepare-real-world-building-release-artifact-workspace'), 'demo candidate release workflow should expose release workspace command');
  assert.ok(candidate.release_preparation_workflow.commands.validate_release_artifact_workspace.includes('validate-real-world-building-release-artifact-workspace'), 'demo candidate release workflow should expose workspace validation command');
  assert.ok(candidate.release_preparation_workflow.commands.prepare_manifest_draft_from_intake.includes('prepare-real-world-building'), 'demo candidate release workflow should expose manifest draft command');
  assert.ok(candidate.release_preparation_workflow.commands.validate_manifest_draft.includes('validate-real-world-building'), 'demo candidate release workflow should expose manifest draft validation command');
  assert.ok(candidate.release_preparation_workflow.commands.guarded_write_formal_manifest.includes('--manifest-output projects/image-structured-modeler/examples/real-world-building-positive/manifest.json'), 'demo candidate release workflow should expose guarded formal manifest command');
  assert.equal(candidate.release_ready, false, 'demo candidate audit candidate must not be release-ready');
  assert.ok(candidate.release_blockers.includes('artifacts'), 'demo candidate audit should preserve missing artifact blockers');
  assert.ok(candidate.release_blockers.includes('photo_grade_readiness'), 'demo candidate audit should preserve PhotoGradeReadiness blockers');
  assert.ok(candidate.next_actions.length > 0, 'demo candidate audit should provide next actions');
  await fs.access(path.join(repoRoot, candidate.artifacts.source_package));
  assertValid(validateRealWorldBuildingSourcePackage, JSON.parse(await fs.readFile(path.join(repoRoot, candidate.artifacts.source_package), 'utf8')), 'demo candidate saved source-package report');
  await fs.access(path.join(repoRoot, candidate.artifacts.source_request));
  assertValid(validateRealWorldBuildingSourceRequest, JSON.parse(await fs.readFile(path.join(repoRoot, candidate.artifacts.source_request), 'utf8')), 'demo candidate saved source-request report');
  await fs.access(path.join(repoRoot, candidate.artifacts.upload_manifest_template));
}
assert.ok(
  realWorldBuildingDemoCandidateAudit.candidates.some((candidate) => candidate.release_blockers.includes('source_assets')),
  'demo candidate audit should block non-release/generated source assets'
);
assert.ok(
  realWorldBuildingDemoCandidateAudit.candidates.some((candidate) => candidate.semantic_role_coverage.includes('visible_plane_recessed_left')),
  'demo candidate audit should surface recessed visible plane evidence'
);
const realWorldBuildingDemoCandidateAuditMarkdown = renderRealWorldBuildingDemoCandidateAuditMarkdown(realWorldBuildingDemoCandidateAudit);
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Real-World Building Demo Candidate Audit'), 'demo candidate audit markdown should include title');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Remaining release gap'), 'demo candidate audit markdown should expose remaining gap');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Best release work candidate'), 'demo candidate audit markdown should distinguish release candidates from structure-review candidates');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Release Tier'), 'demo candidate audit markdown should expose release tier');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Input Ready'), 'demo candidate audit markdown should expose source-package readiness');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Refill workflow'), 'demo candidate audit markdown should expose refill workflow');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Run refill upload session'), 'demo candidate audit markdown should expose refill upload command');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Release preparation workflow'), 'demo candidate audit markdown should expose release preparation workflow');
assert.ok(realWorldBuildingDemoCandidateAuditMarkdown.includes('Prepare release workspace'), 'demo candidate audit markdown should expose release workspace command');
await fs.access(path.join(repoRoot, 'output/image-structured-modeler/real-world-building-demo-candidate-audit-test/candidate-audit-report.json'));
assertValid(
  validateRealWorldBuildingDemoCandidateAudit,
  JSON.parse(await fs.readFile(path.join(repoRoot, 'output/image-structured-modeler/real-world-building-demo-candidate-audit-test/candidate-audit-report.json'), 'utf8')),
  'saved real-world building demo candidate audit report'
);
await fs.access(path.join(repoRoot, 'output/image-structured-modeler/real-world-building-demo-candidate-audit-test/candidate-audit-report.md'));
const preparedMcpModelingBrief = buildMcpModelingBrief({
  assetSet: {
    id: 'schema-contract-asset-set',
    gates: { reasons: ['scale_confidence_below_publish_gate'] },
    assets: [
      {
        id: 'asset_1',
        path: 'test/real-building-demo/top-view.jpg',
        media_type: 'image',
        detected_view: 'top',
        quality: 'usable'
      }
    ]
  },
  observationSet: {
    views_detected: ['top'],
    missing_views: ['oblique'],
    scale_calibration: { confidence: 0.5 },
    quality_report: { risks: ['missing_oblique_view'] },
    visual_relation_graph: { summary: { relations: 0 } }
  },
  candidateGraph: {
    profile_id: 'building_single',
    candidates: [
      {
        id: 'top_recess_candidate',
        role: 'visible_plane_recessed_left',
        source_image: 'test/real-building-demo/top-view.jpg',
        source_observation_id: 'recess_candidate',
        view: 'top',
        confidence: 0.4,
        promotion: {
          status: 'blocked',
          blockers: ['review_required']
        }
      }
    ]
  },
  modelingBrief: {
    status: 'review_required',
    compile_allowed: false,
    missing_inputs: ['scale_confidence_below_publish_gate']
  }
});
assertValid(validateMcpModelingBrief, preparedMcpModelingBrief, 'prepared MCP modeling brief draft');
assert.equal(preparedMcpModelingBrief.source_package_gate, null, 'generic MCP modeling brief should use null source-package gate when no assessment is provided');
assert.equal(preparedMcpModelingBrief.source_request_response_gate, null, 'generic MCP modeling brief should use null source-request response gate when no previous request is provided');
assert.ok(
  preparedMcpModelingBrief.candidate_disambiguation.some((item) => item.role === 'visible_plane_recessed_left' && item.blocked_interpretations.includes('merged_front_facade_plane')),
  'prepared MCP modeling brief should include recessed facade disambiguation'
);
assertMcpModelingConstraintRole(
  preparedMcpModelingBrief,
  'visible_plane_recessed_left',
  'merged_front_facade_plane',
  'prepared MCP modeling brief should summarize recessed facade constraints'
);

const observationPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'observations.json');
let observationsChecked = false;
try {
  const observationSet = JSON.parse(await fs.readFile(observationPath, 'utf8'));
  assertValid(validateImageSetObservation, observationSet, 'switch controller observations.json');
  assert.ok(observationSet.images.length > 0, 'observations.json should contain image observations');
  assert.ok(observationSet.evidence_graph, 'observations.json should contain native evidence graph');
  assert.equal(observationSet.evidence_graph.parts.length >= 6, true, 'observations evidence graph should contain core part records');
  assert.deepEqual(graphPartByIdFromGraph(observationSet.evidence_graph, 'center_grip_body').required_views, ['front', 'rear'], 'observations evidence graph should record center grip required views');
  assertVisualRelationGraph(observationSet, 'switch controller observations.json');
  assertRelationCandidate(observationSet, { type: 'right_of', item: 'right_thumbstick', anchor: 'left_thumbstick', view: 'front' }, 'switch thumbstick handedness candidate');
  assertRelationCandidate(observationSet, { type: 'right_of', item: 'abxy_cluster', anchor: 'dpad_cluster', view: 'front' }, 'switch ABXY versus D-pad candidate');
  assertRelationCandidate(observationSet, { type: 'inside', item: 'center_front_panel', anchor: 'center_grip_body', view: 'front' }, 'switch screen/panel containment candidate');
  const switchFront = observationSet.images.find((image) => image.detected_view.kind === 'front');
  const contourGroundedControls = switchFront.observations.filter((item) => [
    'left_joycon_shell',
    'right_joycon_shell',
    'center_grip_body',
    'center_front_panel',
    'abxy_cluster',
    'dpad_cluster'
  ].includes(item.component_hint));
  assert.equal(contourGroundedControls.length >= 6, true, 'Switch front controls should expose contour-grounded component observations');
  assert.ok(contourGroundedControls.every((item) => item.grounding?.method === 'edge_contour_segmentation'), 'Switch shell/screen/button candidates should carry edge contour grounding');
  assert.ok(contourGroundedControls.every((item) => item.contour?.sample_count > 5 && item.keypoints?.length >= 5), 'Switch contour-grounded controls should carry sampled contours and keypoints');
  const thumbstickControls = switchFront.observations.filter((item) => ['left_thumbstick', 'right_thumbstick'].includes(item.component_hint));
  assert.equal(thumbstickControls.length, 2, 'Switch front should expose two thumbstick contour/keypoint boxes');
  assert.ok(thumbstickControls.every((item) => item.grounding?.method === 'edge_keypoint_segmentation'), 'Switch thumbsticks should carry edge keypoint grounding');
  assert.ok(thumbstickControls.every((item) => item.grounding?.grounding_quality?.bbox_proxy === false), 'Switch grounded controls should not be bbox proxies');
  for (const observation of observationSet.images) {
    assertValid(validateImageObservation, stripCollectionOnlyFields(observation), `${observation.image.path} image observation`);
  }
  observationsChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const manualCorrectionsPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'manual-corrections.json');
let manualCorrectionsChecked = false;
try {
  const manualCorrections = JSON.parse(await fs.readFile(manualCorrectionsPath, 'utf8'));
  assertValid(validateManualCorrections, manualCorrections, 'switch controller manual-corrections.json');
  assert.ok(manualCorrections.scale.known_width > 0, 'manual corrections should provide a positive known width');
  manualCorrectionsChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const generatedModelPlanPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'model-plan.json');
let generatedModelPlanChecked = false;
try {
  const generatedModelPlan = JSON.parse(await fs.readFile(generatedModelPlanPath, 'utf8'));
  assertValid(validateModelPlan, generatedModelPlan, 'switch controller model-plan.json');
  assert.ok(generatedModelPlan.parts.length >= 6, 'generated model plan should contain core controller parts');
  assert.ok(generatedModelPlan.review.corrections_applied?.includes('scale.known_width'), 'generated model plan should record applied manual scale corrections');
  assertEvidenceAnnotations(generatedModelPlan, 'switch controller model-plan.json');
  assert.ok(generatedModelPlan.review.evidence_summary.template_prior_parts.length >= generatedModelPlan.parts.length, 'switch model plan should expose layout-prior involvement for every generated part');
  assert.ok(generatedModelPlan.review.correction_suggestions.length >= generatedModelPlan.parts.length, 'switch model plan should suggest confirmation patches for prior-assisted parts');
  assert.deepEqual(graphPartById(generatedModelPlan, 'center_grip_body').required_views, ['front', 'rear'], 'center grip evidence graph should record required front/rear views');
  assert.deepEqual(graphPartById(generatedModelPlan, 'center_grip_body').missing_views, [], 'center grip evidence graph should have front/rear coverage');
  assert.ok(graphPartById(generatedModelPlan, 'right_thumbstick').conflicts.some((conflict) => conflict.type === 'template_prior_used'), 'right thumbstick graph should expose template-prior usage');
  assert.equal(fusionPartById(generatedModelPlan, 'center_grip_body').decision, 'cross_view_confirmed', 'center grip semantic fusion should merge front/rear evidence');
  assert.ok(generatedModelPlan.review.semantic_fusion.summary.cross_view_confirmed_parts.includes('center_grip_body'), 'semantic fusion should summarize cross-view confirmed parts');
  generatedModelPlanChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const outputPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'output.json');
let outputChecked = false;
try {
  const outputCode = await fs.readFile(outputPath, 'utf8');
  const output = JSON.parse(outputCode);
  assert.equal(output.version, 1, 'compiled output should be DSL version 1');
  assert.equal(output.units, 'mm', 'compiled output should use mm');
  assert.ok(output.operations.length >= 20, 'compiled output should contain enough operations for the product model');
  assert.ok(output.operations.some((operation) => operation.op === 'component_definition'), 'compiled output should use component definitions');
  assert.ok(output.operations.some((operation) => operation.op === 'rounded_box'), 'compiled output should use rounded product primitives');
  assert.ok(output.operations.filter((operation) => operation.op === 'rounded_box').length >= 6, 'compiled output should keep rounded product primitive coverage');
  assert.equal(output.operations.some((operation) => operation.op === 'mesh'), false, 'compiled output should not regress to coarse mesh primitives');
  assert.equal(output.operations.some((operation) => operation.op === 'box'), false, 'compiled output should not regress to coarse box primitives');
  assert.ok(output.operations.filter((operation) => operation.qa?.expected_contacts?.length > 0).length >= 16, 'compiled output should carry expected-contact QA metadata for mounted/overlapping parts');
  assert.ok(output.operations.some((operation) => operation.op === 'scene'), 'compiled output should define review scenes');

  const mockSessionPath = path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-mock-session.json');
  await fs.mkdir(path.dirname(mockSessionPath), { recursive: true });
  const bridge = new SketchUpBridge({ mock: { sessionPath: mockSessionPath } });
  const result = await bridge.build_model({ runtime: 'mock', code: outputCode });
  assert.ok(result.snapshot.totals.groups >= 8, 'compiled output should create groups in mock runtime');
  assert.ok(result.snapshot.totals.instances >= 4, 'compiled output should keep LED component instances in mock runtime');
  assert.ok(result.snapshot.scenes.length >= 2, 'compiled output should create review scenes');
  assert.equal(result.snapshot.warning_summary.by_severity.error, 0, 'compiled output should not create error warnings');
  assert.ok(snapshotItemsWithExpectedContacts(result.snapshot).length >= 16, 'mock snapshot should preserve expected-contact QA metadata');
  outputChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const reviewReportPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'review', 'index.html');
let reviewReportChecked = false;
try {
  const html = await fs.readFile(reviewReportPath, 'utf8');
  assert.ok(html.includes('Review Overlays'), 'review report should include overlay section');
  assert.ok(html.includes('Model Plan Parts'), 'review report should include model plan parts');
  assert.ok(html.includes('Manual Corrections'), 'review report should include manual corrections');
  assert.ok(html.includes('Evidence Status'), 'review report should include evidence status summary');
  assert.ok(html.includes('Evidence Graph'), 'review report should include evidence graph');
  assert.ok(html.includes('Semantic Fusion'), 'review report should include semantic fusion');
  assert.ok(html.includes('Corrections Workbench'), 'review report should include corrections workbench');
  assert.ok(html.includes('correction-suggestions-data'), 'review report should embed correction suggestions for the workbench');
  assert.ok(html.includes('download-corrections'), 'review report should expose correction JSON download');
  assert.ok(html.includes('Correction Patch Suggestions'), 'review report should include correction patch suggestions');
  assert.ok(html.includes('template prior'), 'review report should expose template-prior parts');
  reviewReportChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

for (const relativePath of [
  'scripts/analyze-image-set.mjs',
  'scripts/make-review-overlay.mjs',
  'scripts/make-review-report.mjs',
  'scripts/generate-model-plan.mjs',
  'scripts/generate-part-graph-from-observations.mjs',
  'scripts/apply-part-graph-correction-patch.mjs',
  'scripts/build-part-graph-proposal-patch.mjs',
  'scripts/make-part-graph-proposal-review.mjs',
  'scripts/validate-geometry-fit.mjs',
  'scripts/validate-visual-relations.mjs',
  'scripts/validate-part-graph-quality.mjs',
  'scripts/validate-auto-ground-plan-r10.mjs',
  'scripts/validate-photo-grade-readiness.mjs',
  'scripts/make-structured-plan-r10.mjs',
  'scripts/intake-assets.mjs',
  'scripts/export-mcp-modeling-brief.mjs',
  'scripts/build-candidate-promotion-patch.mjs',
  'scripts/apply-candidate-promotion-patch.mjs',
  'scripts/run-release-gate.mjs',
  'scripts/assess-real-world-building-source-package.mjs',
  'scripts/prepare-real-world-building-release-sample.mjs',
  'scripts/prepare-real-world-building-release-artifact-workspace.mjs',
  'scripts/validate-real-world-building-release-sample.mjs',
  'scripts/validate-real-world-building-release-artifact-workspace.mjs',
  'scripts/build-vision-evidence-set-v1.mjs',
  'scripts/build-vision-evidence-review-patch.mjs',
  'scripts/build-vision-evidence-policy-correction-patch.mjs',
  'scripts/make-vision-evidence-review-workbench.mjs',
  'scripts/build-high-contrast-edge-v1.mjs',
  'scripts/build-opencv-edge-v1.mjs',
  'scripts/build-boundary-graph-v1.mjs',
  'scripts/build-segmentation-backend-compare.mjs',
  'scripts/build-boundary-groundplan-ablation.mjs',
  'scripts/build-photo-grade-real-smoke.mjs',
  'scripts/compile-plan-to-sketchup-dsl.mjs',
  'scripts/make-snapshot-report.mjs',
  'scripts/lib/part-graph-corrections.mjs',
  'scripts/lib/warning-budget.mjs',
  'scripts/lib/image-analysis.mjs',
  'scripts/lib/document-asset-parser.mjs',
  'scripts/lib/mcp-modeling-brief.mjs',
  'scripts/lib/real-world-building-release-sample.mjs',
  'scripts/lib/real-world-building-source-package.mjs',
  'scripts/lib/auto-ground-plan-r10.mjs',
  'scripts/lib/vision-evidence-set-v1.mjs',
  'scripts/lib/high-contrast-edge-v1.mjs',
  'scripts/lib/opencv-edge-v1.mjs',
  'scripts/lib/boundary-graph-v1.mjs',
  'scripts/lib/segmentation-backend-compare.mjs',
  'scripts/lib/photo-grade-readiness.mjs',
  'scripts/lib/photo-grade-real-smoke.mjs'
]) {
  await fs.access(path.join(subprojectRoot, relativePath));
}

const snapshotReportPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'review', 'snapshot-report.json');
let snapshotReportChecked = false;
try {
  const snapshotReport = JSON.parse(await fs.readFile(snapshotReportPath, 'utf8'));
  assert.equal(snapshotReport.runtime, 'mock', 'snapshot report should record mock runtime by default');
  assert.equal(snapshotReport.snapshot_summary.totals.groups, SWITCH_BASELINE_GROUPS, 'snapshot report should record current Switch group count');
  assert.equal(snapshotReport.snapshot_summary.totals.instances, SWITCH_BASELINE_INSTANCES, 'snapshot report should record current Switch instance count');
  assert.equal(snapshotReport.snapshot_summary.scenes.length, SWITCH_BASELINE_SCENES, 'snapshot report should record current Switch scene count');
  assert.equal(snapshotReport.snapshot_summary.warning_summary.by_severity.error, 0, 'snapshot report should not contain error warnings');
  assertBoundingBoxSize(snapshotReport.snapshot_summary.bounding_box, { w: 280, d: 174, h: 40 }, 'mock snapshot bbox');
  assertGeometryWarningsUseQaMetadata(snapshotReport, 'mock snapshot report');
  assertBudget(evaluateSnapshotWarningBudget(snapshotReport, switchWarningBudget), 'mock snapshot warning budget');
  snapshotReportChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const queueSnapshotReportPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'review', 'snapshot-report-queue.json');
let queueSnapshotReportChecked = false;
try {
  const queueSnapshotReport = JSON.parse(await fs.readFile(queueSnapshotReportPath, 'utf8'));
  assert.equal(queueSnapshotReport.runtime, 'queue', 'queue snapshot report should record queue runtime');
  assert.equal(queueSnapshotReport.snapshot_summary.totals.groups, SWITCH_BASELINE_GROUPS, 'queue snapshot report should record current Switch group count');
  assert.equal(queueSnapshotReport.snapshot_summary.totals.instances, SWITCH_BASELINE_INSTANCES, 'queue snapshot report should record current Switch instance count');
  assert.equal(queueSnapshotReport.snapshot_summary.scenes.length, SWITCH_BASELINE_SCENES, 'queue snapshot report should record current Switch scene count');
  assert.equal(queueSnapshotReport.snapshot_summary.warning_summary.by_severity.error, 0, 'queue snapshot report should not contain error warnings');
  assertBoundingBoxSize(queueSnapshotReport.snapshot_summary.bounding_box, { w: 280, d: 174, h: 40 }, 'queue snapshot bbox');
  assertGeometryWarningsUseQaMetadata(queueSnapshotReport, 'queue snapshot report');
  assertBudget(evaluateSnapshotWarningBudget(queueSnapshotReport, switchWarningBudget), 'queue snapshot warning budget');
  queueSnapshotReportChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const queueDiffReportPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'review', 'snapshot-diff-queue.json');
let queueDiffReportChecked = false;
try {
  const queueDiffReport = JSON.parse(await fs.readFile(queueDiffReportPath, 'utf8'));
  assert.equal(queueDiffReport.mode, 'runtime_diff', 'queue diff report should record runtime_diff mode');
  assert.equal(queueDiffReport.expected_runtime, 'mock', 'queue diff report should compare from mock runtime');
  assert.equal(queueDiffReport.actual_runtime, 'queue', 'queue diff report should compare to queue runtime');
  assert.equal(queueDiffReport.report.summary.by_severity.error, 0, 'queue diff report should not contain error diffs');
  assert.equal(queueDiffReport.warning_gate.ok, true, 'queue diff report should not contain unexpected warning buckets');
  assert.equal(queueDiffReport.expected_snapshot_summary.totals.groups, SWITCH_BASELINE_GROUPS, 'queue diff report should record mock group count');
  assert.equal(queueDiffReport.actual_snapshot_summary.totals.groups, SWITCH_BASELINE_GROUPS, 'queue diff report should record queue group count');
  assertBoundingBoxSize(queueDiffReport.expected_snapshot_summary.bounding_box, { w: 280, d: 174, h: 40 }, 'queue diff expected bbox');
  assertBoundingBoxSize(queueDiffReport.actual_snapshot_summary.bounding_box, { w: 280, d: 174, h: 40 }, 'queue diff actual bbox');
  assertGeometryWarningsUseQaMetadata({ warnings: queueDiffReport.warnings.expected }, 'queue diff expected warnings');
  assertGeometryWarningsUseQaMetadata({ warnings: queueDiffReport.warnings.actual }, 'queue diff actual warnings');
  assertBudget(evaluateDiffWarningBudget(queueDiffReport, switchWarningBudget), 'mock-to-queue diff warning budget');
  queueDiffReportChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

await assertSwitchCorrectionRegression();
await assertSwitchVisualRelationFixture();
await assertFeatureMappingCorrectionRegression();
await assertSingleImageEvidenceDowngrade();
await assertRealWorldBuildingSourcePackagePreflight();
await assertRealWorldBuildingUploadSession();
await assertStructuredAssetIntakeFailClosed();
const draftingFirstBenchmarkChecked = await assertDraftingFirstBenchmarkReports();
await assertImageStructuredReleaseGate();
await assertBuildingSingleCompileGateRegression();
await assertYellowAxisCalibrationWorkbench();
await assertYellowVisibleEffectJudgment();
const remoteChecked = await assertCompactRemoteSample();
const ambulanceEvidenceChecked = await assertAmbulancePartGraphEvidenceSample();
const buildingGroupChecked = await assertBuildingGroupObservationSample();
const r8StructuralGroundingChecked = await assertR8StructuralGroundingRepair();
const groundingV2SecondSampleChecked = await assertGroundingV2SecondBuildingSample();
const photoGradeRealSmokeChecked = await assertPhotoGradeRealSmokeSample();
const birdEyeLandCoverChecked = await assertBirdEyeLandCoverR11();
const autoGroundPlanR10Checked = await assertAutoGroundPlanR10Samples();

process.stdout.write(`${JSON.stringify({
  ok: true,
  checked: {
    model_plan_example: true,
    observations_json: observationsChecked,
    manual_corrections: manualCorrectionsChecked,
    generated_model_plan: generatedModelPlanChecked,
    compiled_output: outputChecked,
    review_report: reviewReportChecked,
    snapshot_report: snapshotReportChecked,
    queue_snapshot_report: queueSnapshotReportChecked,
    queue_diff_report: queueDiffReportChecked,
    correction_regression: true,
    visual_relation_switch_fixture: true,
    feature_mapping_regression: true,
    real_world_building_source_package_preflight: true,
    real_world_building_upload_session: true,
    structured_asset_intake: true,
    drafting_first_benchmark: draftingFirstBenchmarkChecked,
    image_structured_release_gate: true,
    real_world_building_manifest_builder: true,
    mcp_modeling_brief_builder: true,
    building_single_compile_gate: true,
    yellow_axis_calibration_workbench: true,
    yellow_visible_effect_judgment: true,
    compact_remote_sample: remoteChecked,
    ambulance_part_graph_evidence: ambulanceEvidenceChecked,
    building_group_observation_sample: buildingGroupChecked,
    r8_structural_grounding_repair: r8StructuralGroundingChecked,
    grounding_v2_second_building_sample: groundingV2SecondSampleChecked,
    photo_grade_real_smoke_sample: photoGradeRealSmokeChecked,
    bird_eye_land_cover_r11: birdEyeLandCoverChecked,
    auto_ground_plan_r10: autoGroundPlanR10Checked,
    photo_grade_readiness: true,
    visual_relation_building_group_fixture: true,
    geometry_fit_building_group_fixture: true,
    ambulance_proposal_review_chain: true,
    warning_budget: true,
    scripts: true
  }
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(subprojectRoot, relativePath), 'utf8'));
}

async function readRepoJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function writeDistinctImageVariant(sourcePath, outputPath, variantIndex) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(sourcePath)
    .modulate({
      brightness: 1 + (variantIndex * 0.01),
      saturation: 1 + (variantIndex * 0.005)
    })
    .png()
    .toFile(outputPath);
}

function rewritePartGraphSourceImageReferences(value, sourceImages, state = { index: 0 }) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) rewritePartGraphSourceImageReferences(item, sourceImages, state);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'source_image' && typeof item === 'string') {
      value[key] = sourceImages[state.index % sourceImages.length];
      state.index += 1;
      continue;
    }
    if (key === 'source_images' && Array.isArray(item)) {
      value[key] = [...sourceImages];
      continue;
    }
    rewritePartGraphSourceImageReferences(item, sourceImages, state);
  }
}

async function assertGroundingV2SecondBuildingSample() {
  const { observations, fixture } = makeGroundingV2SecondBuildingGroupSample();
  assertValid(validateImageSetObservation, observations, 'grounding v2 second building observations');
  assertVisualRelationGraph(observations, 'grounding v2 second building observations');
  assertGroundingV3ObservationGraph(observations, 'grounding v2 second building observations');
  assertRelationCandidate(observations, {
    type: 'right_of',
    item: 'primary_blue_roof_hall',
    anchor: 'warehouse_row_inner',
    view: 'top',
    min_confidence: 0.55
  }, 'second sample blue hall to inner warehouse relation');
  assertRelationCandidate(observations, {
    type: 'right_of',
    item: 'warehouse_row_inner',
    anchor: 'warehouse_row_west',
    view: 'top',
    min_confidence: 0.52
  }, 'second sample inner warehouse to west warehouse relation');
  const top = observations.images.find((image) => image.detected_view.kind === 'top');
  assert.ok(top.observations.filter((item) => item.grounding_status === 'image_grounded').length >= 12, 'second sample should expose image-grounded top-view observations');
  assert.ok(top.observations.every((item) => item.grounding?.grounding_quality?.bbox_proxy === false), 'second sample should not use bbox-proxy grounding');

  const profile = await readRepoJson('examples/product-profiles/building_group_industrial_campus.json');
  const partGraph = generatePartGraphFromObservations(observations, profile, {
    id: 'building-group-grounding-v2-second-sample-part-graph',
    productName: observations.object.name
  });
  assertValid(validatePartGraph, partGraph, 'grounding v2 second sample PartGraph');
  assert.equal(partGraph.review.part_candidate_proposal_summary.candidate_parts, 3, 'second sample should keep unstable parking grid as review candidates instead of forcing the full legacy candidate queue');
  assert.equal(partGraph.parts.some((part) => ['internal_roads', 'warehouse_row_west', 'warehouse_row_inner', 'parking_lot'].includes(part.id)), false, 'second sample default PartGraph should use R10 canonical regions instead of legacy occupancy parents');
  assert.equal(partGraph.evidence_graph.auto_ground_plan?.qa?.remaining_unknown_gap_ratio > 0.25, true, 'second sample should keep remaining unknown gap visible for review');
  assert.ok(partGraph.parts.every((part) => part.grounding_status), 'second sample PartGraph parts should carry grounding_status');
  assert.ok(partGraph.parts.every((part) => part.grounding_decision), 'second sample PartGraph parts should carry Grounding v3 promotion decisions');
  assert.ok(partGraph.parts.some((part) => part.grounding_status === 'image_grounded' || part.grounding_status === 'review_confirmed'), 'second sample should contain image/review grounded parts');
  assert.ok(partGraph.evidence_graph.grounding_summary, 'second sample evidence graph should summarize Grounding v2 provenance');
  assert.ok(partGraph.evidence_graph.ground_plan, 'second sample evidence graph should carry Grounding v3 GroundPlan');

  const output = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  const report = await validateGeometryFit({
    observations,
    fixture,
    code: JSON.stringify(output),
    mockSessionPath: path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-grounding-v2-second-sample-session.json')
  });
  assert.equal(report.version, 2, 'second sample GeometryFit should emit v2 reports');
  assert.equal(report.ok, true, 'second sample GeometryFit should pass primary grounding gates');
  assert.equal(report.summary.checked_footprints, fixture.footprint_rules.length, 'second sample GeometryFit should check every primary footprint');
  assert.equal(report.summary.checked_relations, fixture.required_relations.length, 'second sample GeometryFit should check every primary relation');
  assert.equal(report.summary.checked_scale_anchors >= 2, true, 'second sample GeometryFit should keep scale anchors in the gate');
  assert.equal(report.summary.checked_handedness_cases, fixture.negative_cases.length, 'second sample GeometryFit should retain mirror negative coverage');
  assert.ok(report.camera_calibration.site_projection, 'second sample GeometryFit should expose site projection calibration');
  assert.ok(report.camera_calibration.camera_calibrations.length >= 2, 'second sample GeometryFit should record top and oblique camera calibration entries');
  assert.equal(report.camera_calibration.multi_view_consistency.checked_items > 0, true, 'second sample GeometryFit should record top/oblique consistency presence');
  assert.equal(report.summary.primary_structures_grounding_coverage > 0, true, 'second sample should report primary grounding coverage');
  assert.equal(report.summary.photo_grade_eligible_ratio < 1, true, 'second sample should not claim full photo-grade eligibility');
  const groundingV3Report = validateGroundingV3({
    observations,
    fixture,
    geometryFit: report,
    codeDocument: output
  });
  assert.equal(groundingV3Report.version, 3, 'second sample Grounding v3 should emit v3 reports');
  assert.equal(groundingV3Report.summary.distinct_scale_anchor_families >= 2, true, 'second sample Grounding v3 should use more than parking as the scale family');
  assert.equal(groundingV3Report.summary.checked_ground_regions > 0, true, 'second sample Grounding v3 should evaluate GroundPlan regions');
  assert.equal(groundingV3Report.summary.checked_line_fits >= 2, true, 'second sample Grounding v3 should evaluate parking line fits');
  assert.equal(groundingV3Report.summary.photo_grade_candidate, false, 'second sample should remain a generalization gate, not a photo-grade claim');
  const photoGradeReadiness = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit: report,
    groundingV3: groundingV3Report,
    codeDocument: output,
    sampleId: 'building-group-second',
    sampleKind: 'generated_second_sample',
    inputAssetStatus: 'available'
  });
  assertPhotoGradeReadinessReport(photoGradeReadiness, {
    expectedReadiness: 'technical_baseline',
    label: 'second sample PhotoGradeReadiness'
  });
  assertPhotoGradeReadinessNegativeCases({
    observations,
    fixture,
    geometryFit: report,
    groundingV3: groundingV3Report,
    codeDocument: output
  });
  const savedReadiness = JSON.parse(await fs.readFile(path.join(subprojectRoot, 'examples', 'building-group-second', 'photo-grade-readiness-report.json'), 'utf8'));
  assertPhotoGradeReadinessReport(savedReadiness, {
    expectedReadiness: 'technical_baseline',
    label: 'saved second sample PhotoGradeReadiness'
  });
  return true;
}

async function assertPhotoGradeRealSmokeSample() {
  const {
    observations,
    fixture,
    sampleKind,
    inputAssetStatus
  } = makePhotoGradeRealSmokeSample();
  assertValid(validateImageSetObservation, observations, 'photo-grade real smoke observations');
  assertVisualRelationGraph(observations, 'photo-grade real smoke observations');
  assertGroundingV3ObservationGraph(observations, 'photo-grade real smoke observations');
  assert.equal(observations.object.name, 'Real Building Photo Smoke Scaffold', 'real smoke scaffold should keep a distinct object identity');
  assert.ok(observations.quality_report.risks.includes('real_building_photo_asset_not_available'), 'real smoke scaffold should record missing real-photo assets');

  const profile = await readRepoJson('examples/product-profiles/building_group_industrial_campus.json');
  const partGraph = generatePartGraphFromObservations(observations, profile, {
    id: 'building-real-photo-smoke-part-graph',
    productName: observations.object.name
  });
  assertValid(validatePartGraph, partGraph, 'photo-grade real smoke PartGraph');
  assert.ok(partGraph.parts.some((part) => part.grounding_decision === 'promoted_geometry'), 'real smoke scaffold should still exercise promoted GroundPlan geometry');

  const output = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  const report = await validateGeometryFit({
    observations,
    fixture,
    code: JSON.stringify(output),
    mockSessionPath: path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-photo-grade-real-smoke-session.json')
  });
  assert.equal(report.ok, true, 'real smoke scaffold GeometryFit should run the full geometry gate');
  const groundingV3Report = validateGroundingV3({
    observations,
    fixture,
    geometryFit: report,
    codeDocument: output
  });
  assert.equal(groundingV3Report.version, 3, 'real smoke scaffold Grounding v3 should emit v3 reports');
  const readiness = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit: report,
    groundingV3: groundingV3Report,
    codeDocument: output,
    sampleId: 'building-real-photo-smoke',
    sampleKind,
    inputAssetStatus
  });
  assertPhotoGradeReadinessReport(readiness, {
    expectedReadiness: 'review_required',
    label: 'real smoke PhotoGradeReadiness'
  });
  assert.equal(readiness.ok, true, 'real smoke scaffold should be review-gated rather than rejected');
  assert.ok(readiness.blockers.some((item) => item.gate === 'input_asset'), 'real smoke readiness should point at missing input assets');

  const savedReadiness = JSON.parse(await fs.readFile(path.join(subprojectRoot, 'examples', 'building-real-photo-smoke', 'photo-grade-readiness-report.json'), 'utf8'));
  assertPhotoGradeReadinessReport(savedReadiness, {
    expectedReadiness: 'review_required',
    label: 'saved real smoke PhotoGradeReadiness'
  });
  assert.equal(savedReadiness.sample.input_asset_status, inputAssetStatus, 'saved real smoke readiness should preserve scaffold asset status');
  return true;
}

async function assertBirdEyeLandCoverR11() {
  const base = path.join(subprojectRoot, 'examples', 'building-group');
  const observations = JSON.parse(await fs.readFile(path.join(base, 'observations.json'), 'utf8'));
  assert.ok(observations.land_cover_v1, 'building group observations should carry BirdEyeLandCover v1');
  assert.ok(observations.high_contrast_edge_v1, 'building group observations should carry HighContrastEdge v1');
  assert.ok(observations.vision_evidence_set_v1, 'building group observations should carry VisionEvidenceSet v1');
  assert.ok(observations.boundary_graph_v1, 'building group observations should carry BoundaryGraph v1');
  const report = landCoverReport(observations.land_cover_v1);
  assert.equal(report.kind, 'bird_eye_land_cover_v1_report', 'BirdEyeLandCover should emit a v1 report');
  assert.equal(report.ok, true, 'BirdEyeLandCover current building-group report should be usable');
  assert.ok(report.summary.masks > 0, 'BirdEyeLandCover should produce polygonized masks');
  assert.ok(report.summary.tiles > 0, 'BirdEyeLandCover should produce tile evidence');
  assert.ok(report.summary.vegetation_ratio > 0.03, 'BirdEyeLandCover should extract vegetation independently from object names');
  assert.ok(report.summary.paved_surface_ratio > 0.08, 'BirdEyeLandCover should extract paved/hardscape surface evidence');
  assert.ok(report.summary.unknown_land_cover_ratio < 0.45, 'BirdEyeLandCover should reduce raw unknown land-cover area for current top view');
  const edgeReport = highContrastEdgeReport(observations.high_contrast_edge_v1);
  assert.equal(edgeReport.kind, 'high_contrast_edge_v1_report', 'HighContrastEdge should emit a v1 report');
  assert.equal(edgeReport.ok, true, 'HighContrastEdge current building-group report should be usable');
  assert.ok(edgeReport.summary.accepted_edge_count >= 4, 'HighContrastEdge should accept visible vector edges');
  assert.ok(edgeReport.summary.rejected_edge_count >= 1, 'HighContrastEdge should expose rejected strong edges');
  assert.ok(edgeReport.summary.site_perimeter_confidence > 0.45, 'HighContrastEdge should rank site perimeter candidates');
  assert.ok(edgeReport.summary.site_perimeter_sides_with_rejected_alternatives >= 1, 'HighContrastEdge should show lower-rank site perimeter alternatives');
  assert.ok(edgeReport.summary.roof_seam_rejection_count >= 1, 'HighContrastEdge should reject roof/internal seam edges');
  for (const side of ['right', 'bottom']) {
    const sideCandidates = observations.high_contrast_edge_v1.site_perimeter_candidates?.[side];
    assert.ok(sideCandidates?.winner_id, `HighContrastEdge should pick a ${side} site perimeter winner`);
    assert.ok(sideCandidates.rejected_alternatives.length >= 1, `HighContrastEdge should keep rejected ${side} site perimeter alternatives`);
  }
  assert.ok(observations.opencv_edge_v1, 'building group observations should carry real OpenCV edge v1');
  const cvReport = openCvEdgeReport(observations.opencv_edge_v1);
  assert.equal(cvReport.kind, 'opencv_edge_v1_report', 'OpenCV edge backend should emit a v1 report');
  assert.equal(cvReport.summary.backend, 'opencv_clahe_canny_hough_lsd_v1', 'OpenCV edge backend should use real cv2 operations for current building-group');
  assert.ok(cvReport.summary.opencv_version, 'OpenCV edge backend should report cv2 version');
  assert.equal(cvReport.ok, true, 'OpenCV edge backend current building-group report should be usable');
  assert.ok(cvReport.summary.accepted_edge_count >= 4, 'OpenCV edge backend should accept visible vector edges');
  assert.ok(cvReport.summary.rejected_edge_count >= 1, 'OpenCV edge backend should expose rejected strong edges');
  assert.ok(cvReport.summary.site_perimeter_confidence > 0.35, 'OpenCV edge backend should rank site perimeter candidates');
  assert.ok(cvReport.summary.roof_seam_rejection_count >= 1, 'OpenCV edge backend should reject roof/internal seam edges');
  const visionReport = visionEvidenceSetReport(observations.vision_evidence_set_v1);
  assert.equal(visionReport.kind, 'vision_evidence_set_v1_report', 'VisionEvidenceSet should emit a v1 report');
  assertValid(validateVisionEvidenceSetV1, observations.vision_evidence_set_v1, 'building group VisionEvidenceSet v1');
  assert.equal(visionReport.ok, true, 'VisionEvidenceSet current building-group report should be usable');
  assert.equal(visionReport.summary.default_heavy_model_required, false, 'VisionEvidenceSet must not require heavy models by default');
  assert.ok(visionReport.summary.masks > 0, 'VisionEvidenceSet should aggregate mask evidence');
  assert.ok(visionReport.summary.edges >= cvReport.summary.accepted_edge_count, 'VisionEvidenceSet should aggregate OpenCV edge evidence');
  assert.ok(visionReport.summary.relations > 0, 'VisionEvidenceSet should aggregate VisualRelationGraph evidence');
  assert.ok(visionReport.summary.top_view_ground_plane_confidence >= 0.65, 'VisionEvidenceSet should estimate top-view ground-plane confidence');
  assert.equal(visionReport.summary.view_ground_plane_images, observations.images.length, 'VisionEvidenceSet should estimate view/ground-plane for every source image');
  assert.equal(visionReport.summary.top_view_candidates >= 1, true, 'VisionEvidenceSet should expose top-view ground-plane candidates');
  assert.equal(visionReport.summary.ground_plane_review_images >= 2, true, 'VisionEvidenceSet should keep oblique/non-planar images review-gated');
  assert.equal(visionReport.summary.preferred_top_view_usage_policy, 'planar_groundplan_candidate', 'VisionEvidenceSet should expose a machine-readable top-view usage policy');
  const groundPlaneImages = observations.vision_evidence_set_v1.view_ground_plane.images;
  assert.equal(groundPlaneImages.length, observations.images.length, 'VisionEvidenceSet should keep per-image ground-plane estimates');
  const topGroundPlane = groundPlaneImages.find((image) => image.detected_view === 'top');
  assert.ok(topGroundPlane, 'VisionEvidenceSet should include a top-view ground-plane estimate');
  assert.equal(topGroundPlane.usage_policy, 'planar_groundplan_candidate', 'top-view estimate should be allowed as a planar GroundPlan candidate');
  assert.ok(topGroundPlane.evidence_summary.accepted_boundary_edges >= 4, 'top-view ground-plane estimate should cite accepted boundary edge support');
  assert.ok(topGroundPlane.confidence_components.boundary_support > 0, 'top-view ground-plane estimate should expose boundary support component');
  assert.equal(typeof topGroundPlane.evidence_summary.camera_hint_review_required, 'boolean', 'top-view ground-plane estimate should expose camera hint review state');
  const obliqueGroundPlane = groundPlaneImages.find((image) => image.detected_view === 'oblique');
  assert.ok(obliqueGroundPlane, 'VisionEvidenceSet should include oblique ground-plane review estimates');
  assert.equal(obliqueGroundPlane.usage_policy, 'review_only_oblique_context', 'oblique images should stay review-only for planar GroundPlan');
  assert.ok(obliqueGroundPlane.risks.includes('oblique_view_not_planar_groundplan'), 'oblique ground-plane estimate should carry a planar-groundplan risk flag');
  const visionReviewPatch = buildVisionEvidenceReviewPatch({
    visionEvidenceSet: observations.vision_evidence_set_v1,
    source: 'projects/image-structured-modeler/examples/building-group/observations.json#vision_evidence_set_v1'
  });
  assertValid(validateVisionEvidenceReviewPatch, visionReviewPatch, 'building group VisionEvidence review patch');
  assert.equal(visionReviewPatch.status, 'needs_review', 'VisionEvidence review patch should require review for current ground-plane/edge policy items');
  assert.equal(visionReviewPatch.apply_allowed, false, 'VisionEvidence review patch must not be directly applyable');
  assert.equal(visionReviewPatch.compile_allowed, false, 'VisionEvidence review patch must not allow compile');
  assert.ok(visionReviewPatch.summary.ground_plane_items >= 3, 'VisionEvidence review patch should include top and oblique ground-plane review items');
  assert.ok(visionReviewPatch.review_items.some((item) => item.required_decision === 'confirm_top_view_planar_groundplan_candidate_or_downgrade'), 'VisionEvidence review patch should ask for top-view ground-plane confirmation');
  assert.ok(visionReviewPatch.review_items.some((item) => item.risk_flags.includes('oblique_view_not_planar_groundplan')), 'VisionEvidence review patch should expose oblique ground-plane risk');
  assert.ok(visionReviewPatch.review_items.some((item) => item.evidence_type === 'edge_class_policy' && item.required_decision === 'confirm_roof_seams_are_not_site_or_road_boundaries'), 'VisionEvidence review patch should keep roof seams out of boundary promotion');
  assert.ok(visionReviewPatch.review_items.every((item) => item.downstream_effect.blocked_outputs.length > 0), 'VisionEvidence review patch items should block unsafe downstream outputs');
  assert.ok(renderVisionEvidenceReviewPatchMarkdown(visionReviewPatch).includes('Vision Evidence Review Patch'), 'VisionEvidence review patch markdown should render a title');
  const visionReviewDecision = buildAcceptedVisionEvidenceReviewDecision({
    reviewPatch: visionReviewPatch,
    sourceReviewPatch: 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json'
  });
  assertValid(validateVisionEvidenceReviewDecision, visionReviewDecision, 'building group VisionEvidence review decision');
  assert.equal(visionReviewDecision.status, 'accepted_policy_review', 'VisionEvidence review decision fixture should accept policy review items');
  assert.equal(visionReviewDecision.compile_allowed, false, 'VisionEvidence review decision must not allow compile');
  assert.equal(visionReviewDecision.geometry_promotion_allowed, false, 'VisionEvidence review decision must not allow geometry promotion');
  assert.equal(visionReviewDecision.summary.accepted_items, visionReviewPatch.summary.total_items, 'VisionEvidence review decision should cover all review items in the fixture');
  const visionReviewWorkbenchHtml = renderVisionEvidenceReviewWorkbenchHtml({
    reviewPatch: visionReviewPatch,
    initialDecision: visionReviewDecision
  });
  assert.ok(visionReviewWorkbenchHtml.includes('vision-evidence-review-patch-data'), 'VisionEvidence review workbench should embed review patch data');
  assert.ok(visionReviewWorkbenchHtml.includes('vision-evidence-review-decision-json'), 'VisionEvidence review workbench should expose export textarea');
  assert.ok(visionReviewWorkbenchHtml.includes('download-vision-evidence-review'), 'VisionEvidence review workbench should expose review decision download');
  assert.ok(visionReviewWorkbenchHtml.includes('geometry_promotion_allowed'), 'VisionEvidence review workbench should keep geometry promotion policy visible');
  const visionPolicyPatch = buildVisionEvidencePolicyCorrectionPatch({
    reviewPatch: visionReviewPatch,
    reviewDecision: visionReviewDecision,
    sourceReviewPatch: 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json',
    sourceReviewDecision: 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review.accepted.json'
  });
  assertValid(validateVisionEvidencePolicyCorrectionPatch, visionPolicyPatch, 'building group VisionEvidence policy correction patch');
  assert.equal(visionPolicyPatch.status, 'ready_for_vision_evidence_policy_update', 'VisionEvidence policy correction patch should only update evidence policy metadata');
  assert.equal(visionPolicyPatch.apply_scope, 'vision_evidence_set_policy_only', 'VisionEvidence policy correction patch should be scoped to VisionEvidenceSet policy');
  assert.equal(visionPolicyPatch.apply_allowed, true, 'VisionEvidence policy correction patch should be applyable only to evidence metadata');
  assert.equal(visionPolicyPatch.compile_allowed, false, 'VisionEvidence policy correction patch must not allow compile');
  assert.equal(visionPolicyPatch.geometry_promotion_allowed, false, 'VisionEvidence policy correction patch must not allow geometry promotion');
  assert.equal(visionPolicyPatch.summary.total_actions, visionReviewPatch.summary.total_items, 'VisionEvidence policy correction patch should create one policy action per accepted review item');
  assert.equal(visionPolicyPatch.summary.geometry_promotions, 0, 'VisionEvidence policy correction patch should never promote geometry');
  assert.ok(visionPolicyPatch.actions.every((action) => action.downstream_effect.blocked_outputs.includes('direct_sketchup_dsl')), 'VisionEvidence policy correction actions should keep direct DSL blocked');
  assert.ok(renderVisionEvidencePolicyCorrectionPatchMarkdown(visionPolicyPatch).includes('Vision Evidence Policy Correction Patch'), 'VisionEvidence policy correction patch markdown should render a title');
  const appliedVisionPolicy = applyVisionEvidencePolicyCorrectionPatch({
    visionEvidenceSet: observations.vision_evidence_set_v1,
    patch: visionPolicyPatch
  });
  assert.equal(appliedVisionPolicy.applied.length, visionPolicyPatch.summary.total_actions, 'VisionEvidence policy correction patch should apply all policy actions');
  assertValid(validateVisionEvidenceSetV1, appliedVisionPolicy.visionEvidenceSet, 'policy-reviewed building group VisionEvidenceSet v1');
  assert.equal(appliedVisionPolicy.visionEvidenceSet.review.policy_correction_patches_applied[0].compile_allowed, false, 'policy-reviewed VisionEvidenceSet should keep compile blocked');
  assert.equal(appliedVisionPolicy.visionEvidenceSet.review.policy_correction_patches_applied[0].geometry_promotion_allowed, false, 'policy-reviewed VisionEvidenceSet should keep geometry promotion blocked');
  assert.ok(appliedVisionPolicy.visionEvidenceSet.view_ground_plane.images.some((image) => image.policy_review?.decision === 'confirmed_planar_groundplan_candidate'), 'policy-reviewed VisionEvidenceSet should annotate reviewed top-view policy');
  assert.ok(appliedVisionPolicy.visionEvidenceSet.edges.some((edge) => edge.class === 'roof_internal_seam' && edge.policy_review?.decision === 'confirmed_keep_roof_seam_rejected'), 'policy-reviewed VisionEvidenceSet should annotate reviewed roof seam policy');
  assert.ok(observations.vision_evidence_set_v1.edges.some((edge) => edge.source_stage === 'opencv_edge_v1'), 'VisionEvidenceSet should carry OpenCV edge source provenance');
  assert.ok(observations.vision_evidence_set_v1.edges.some((edge) => edge.source_stage === 'high_contrast_edge_v1'), 'VisionEvidenceSet should carry HighContrast edge source provenance');
  assert.equal(observations.vision_evidence_set_v1.edges.some((edge) => edge.class === 'roof_internal_seam' && edge.accepted === true && edge.review_required === false), false, 'VisionEvidenceSet must not promote roof seams as accepted geometry evidence');
  assert.ok(observations.vision_evidence_set_v1.backend_statuses.some((status) => status.backend === 'insid3_optional' && status.required === false), 'INSID3 should remain optional in the R12 evidence contract');
  const boundaryReport = boundaryGraphReport(observations.boundary_graph_v1);
  assert.equal(boundaryReport.kind, 'boundary_graph_v1_report', 'BoundaryGraph should emit a v1 report');
  assert.equal(boundaryReport.ok, true, 'BoundaryGraph current building-group report should be usable');
  assert.equal(boundaryReport.summary.source_image_backend, 'source_image_edge_detector_v1', 'BoundaryGraph should use source-image raster edges for the current building-group');
  assert.equal(boundaryReport.summary.high_contrast_edge_available, true, 'BoundaryGraph should consume HighContrastEdge evidence when present');
  assert.ok(boundaryReport.summary.high_contrast_boundary_edge_count >= 4, 'BoundaryGraph should include accepted HighContrastEdge boundary edges');
  assert.equal(boundaryReport.summary.opencv_edge_available, true, 'BoundaryGraph should consume real OpenCV edge evidence when present');
  assert.ok(boundaryReport.summary.opencv_boundary_edge_count >= 4, 'BoundaryGraph should include accepted OpenCV boundary edges');
  assert.equal(boundaryReport.summary.vision_evidence_set_available, true, 'BoundaryGraph should consume VisionEvidenceSet when present');
  assert.ok(boundaryReport.summary.vision_evidence_boundary_edge_count >= 4, 'BoundaryGraph should expose VisionEvidenceSet boundary edge contribution');
  assert.equal(boundaryReport.summary.vision_evidence_default_heavy_model_required, false, 'BoundaryGraph should not depend on heavy model evidence');
  assert.equal(boundaryReport.summary.bbox_fallback_edge_ratio, 0, 'source-image BoundaryGraph must not use bbox/prior edges as observed edges');
  assert.ok(boundaryReport.summary.source_edge_alignment_ratio >= 0.24, 'source-image BoundaryGraph should report edge pixel alignment support');
  assert.ok(observations.boundary_graph_v1.observed_edges.some((edge) => edge.method === 'source_image_gradient_line_segment'), 'BoundaryGraph should include source-image line segments');
  assert.ok(boundaryReport.summary.site_boundary_closure_ratio >= 0.8, 'BoundaryGraph should close the current site boundary');
  assert.ok(boundaryReport.summary.observed_edge_coverage_ratio >= 0.45, 'BoundaryGraph should expose visible site/road/ground-surface edges');
  assert.ok(boundaryReport.summary.road_corridor_count >= 1, 'BoundaryGraph should generate at least one road corridor hypothesis');
  assert.ok(observations.boundary_graph_v1.completed_edges.some((edge) => edge.state !== 'observed'), 'BoundaryGraph should expose completed/inferred edges under aggressive completion');

  const autoGroundPlan = validateAutoGroundPlanR10({ observations, groundingV3: observations.grounding_v3 });
  assert.equal(autoGroundPlan.summary.land_cover_v1_available, true, 'R10/R11 AutoGroundPlan should consume land_cover_v1 when present');
  assert.equal(autoGroundPlan.summary.boundary_graph_v1_available, true, 'R11.1 AutoGroundPlan should consume boundary_graph_v1 when present');
  assert.equal(autoGroundPlan.summary.vision_evidence_set_v1_available, true, 'R12 AutoGroundPlan report should expose VisionEvidenceSet availability');
  assert.ok(autoGroundPlan.summary.vision_evidence_edges >= visionReport.summary.accepted_edges, 'R12 AutoGroundPlan report should expose aggregated vision edge evidence');
  assert.equal(autoGroundPlan.summary.vision_evidence_default_heavy_model_required, false, 'R12 AutoGroundPlan must not require heavy model backends');
  assert.equal(autoGroundPlan.auto_ground_plan.site_surface.grounding_method, 'source_image_boundary_graph_site_fit', 'AutoGroundPlan should prefer source-image BoundaryGraph site surface over old bbox prior');
  assert.ok(autoGroundPlan.summary.remaining_unknown_gap_ratio <= 0.25, 'source-edge GroundPlan should keep unresolved gap visible instead of filling with bbox/prior corridors');
  assert.ok(autoGroundPlan.summary.road_candidate_review_count <= 1, 'R11.1 should resolve most road candidates through boundary completion');
  assert.ok(autoGroundPlan.auto_ground_plan.canonical_regions.some((region) => region.source_kind === 'boundary_graph_completion' && region.class === 'road'), 'R11.1 should add road regions from boundary/completion evidence');
  assert.equal(autoGroundPlan.auto_ground_plan.canonical_regions.some((region) => region.id === 'internal_roads'), false, 'R11.1 road output must not revive the rejected internal_roads prior');
  assert.ok(autoGroundPlan.auto_ground_plan.subdivision_cells.some((cell) => cell.gap_class === 'open_paved_area'), 'R11 should classify paved residual cells as open paved helper');
  assert.ok(autoGroundPlan.auto_ground_plan.subdivision_cells.some((cell) => cell.gap_class === 'vegetation_gap'), 'R11 should classify vegetation residual cells as vegetation helper/review');
  assert.equal(autoGroundPlan.auto_ground_plan.subdivision_cells
    .some((cell) => cell.gap_class === 'road_candidate'
      && cell.gap_grounding_decision === 'promoted_geometry'
      && !(cell.gap_residuals?.boundary_graph_corridor_support > 0.45)), false, 'gap-derived roads must not be promoted without BoundaryGraph residual gates');

  await fs.access(path.join(base, 'structured-plan', 'bird-eye-segmentation.png'));
  await fs.access(path.join(base, 'structured-plan', 'land-cover-v1-report.json'));
  await fs.access(path.join(base, 'structured-plan', 'edge-v1-report.json'));
  await fs.access(path.join(base, 'structured-plan', 'edge-preprocess-debug.png'));
  await fs.access(path.join(base, 'structured-plan', 'edge-candidate-classification.png'));
  await fs.access(path.join(base, 'structured-plan', 'opencv-edge-v1-report.json'));
  await fs.access(path.join(base, 'structured-plan', 'opencv-edge-preprocess-debug.png'));
  await fs.access(path.join(base, 'structured-plan', 'opencv-edge-candidate-classification.png'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-v1-report.json'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-review-patch.json'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-review-patch.md'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-review', 'index.html'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-review.accepted.json'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-policy-correction-patch.json'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-policy-correction-patch.md'));
  await fs.access(path.join(base, 'structured-plan', 'vision-evidence-v1.reviewed.json'));
  await fs.access(path.join(base, 'structured-plan', 'boundary-graph-v1-report.json'));
  await fs.access(path.join(base, 'structured-plan', 'segmentation-backend-compare.png'));
  await fs.access(path.join(base, 'structured-plan', 'segmentation-backend-compare-report.json'));
  await fs.access(path.join(base, 'structured-plan', 'boundary-groundplan-ablation.png'));
  await fs.access(path.join(base, 'structured-plan', 'boundary-groundplan-ablation-report.json'));

  const segmentationCompare = segmentationBackendCompareReport(JSON.parse(await fs.readFile(path.join(base, 'structured-plan', 'segmentation-backend-compare-report.json'), 'utf8')).segmentation_backend_compare);
  assert.equal(segmentationCompare.ok, true, 'Segmentation backend compare should pass default optional-backend skip mode');
  assert.equal(segmentationCompare.summary.insid3_available, false, 'INSID3 should not be required for default tests');
  assert.ok(['skipped_unavailable', 'configured_but_not_executed'].includes(segmentationCompare.summary.insid3_status), 'INSID3 optional backend should report an explicit skipped/configured status');
  assert.ok(segmentationCompare.summary.fused_observed_mask_count > 0, 'Segmentation backend compare should produce fused observed mask candidates');
  assert.equal(segmentationCompare.summary.promoted_geometry_count, 0, 'Segmentation backend masks must not directly promote geometry');
  const savedVisionReviewPatch = JSON.parse(await fs.readFile(path.join(base, 'structured-plan', 'vision-evidence-review-patch.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewPatch, savedVisionReviewPatch, 'saved building group VisionEvidence review patch');
  assert.equal(savedVisionReviewPatch.status, 'needs_review', 'saved VisionEvidence review patch should require review');
  const savedVisionReviewWorkbench = await fs.readFile(path.join(base, 'structured-plan', 'vision-evidence-review', 'index.html'), 'utf8');
  assert.ok(savedVisionReviewWorkbench.includes('vision-evidence-review-patch-data'), 'saved VisionEvidence review workbench should embed review patch data');
  assert.ok(savedVisionReviewWorkbench.includes('vision-evidence-review-decision-json'), 'saved VisionEvidence review workbench should expose export textarea');
  assert.ok(savedVisionReviewWorkbench.includes('projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json'), 'saved VisionEvidence review workbench should reference the review patch artifact');
  const savedVisionReviewDecision = JSON.parse(await fs.readFile(path.join(base, 'structured-plan', 'vision-evidence-review.accepted.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewDecision, savedVisionReviewDecision, 'saved building group VisionEvidence review decision');
  assert.equal(savedVisionReviewDecision.compile_allowed, false, 'saved VisionEvidence review decision should keep compile blocked');
  assert.equal(savedVisionReviewDecision.geometry_promotion_allowed, false, 'saved VisionEvidence review decision should keep geometry promotion blocked');
  const savedVisionPolicyPatch = JSON.parse(await fs.readFile(path.join(base, 'structured-plan', 'vision-evidence-policy-correction-patch.json'), 'utf8'));
  assertValid(validateVisionEvidencePolicyCorrectionPatch, savedVisionPolicyPatch, 'saved building group VisionEvidence policy correction patch');
  assert.equal(savedVisionPolicyPatch.apply_scope, 'vision_evidence_set_policy_only', 'saved VisionEvidence policy correction patch should be scoped to evidence policy only');
  assert.equal(savedVisionPolicyPatch.compile_allowed, false, 'saved VisionEvidence policy correction patch should keep compile blocked');
  assert.equal(savedVisionPolicyPatch.geometry_promotion_allowed, false, 'saved VisionEvidence policy correction patch should keep geometry promotion blocked');
  const savedReviewedVisionEvidenceSet = JSON.parse(await fs.readFile(path.join(base, 'structured-plan', 'vision-evidence-v1.reviewed.json'), 'utf8'));
  assertValid(validateVisionEvidenceSetV1, savedReviewedVisionEvidenceSet, 'saved policy-reviewed building group VisionEvidenceSet');
  assert.equal(savedReviewedVisionEvidenceSet.review.policy_correction_patches_applied[0].actions, savedVisionPolicyPatch.summary.total_actions, 'saved reviewed VisionEvidenceSet should record applied policy actions');

  const ablationReport = JSON.parse(await fs.readFile(path.join(base, 'structured-plan', 'boundary-groundplan-ablation-report.json'), 'utf8'));
  assert.equal(ablationReport.kind, 'boundary_groundplan_ablation_report', 'Boundary/GroundPlan ablation should emit a report');
  assert.equal(ablationReport.ok, true, 'Boundary/GroundPlan ablation should keep hard gates ok');
  assert.equal(ablationReport.variants.length, 4, 'Boundary/GroundPlan ablation should compare source-edge, JS fallback, OpenCV, and fused variants');
  assert.ok(ablationReport.summary.fused_opencv_boundary_edges >= 4, 'Boundary/GroundPlan ablation should expose fused OpenCV edge contribution');
  assert.ok(ablationReport.summary.fused_high_contrast_boundary_edges >= 4, 'Boundary/GroundPlan ablation should expose fused high-contrast edge contribution');

  for (const kind of ['industrial_campus', 'commercial_parking', 'courtyard_campus']) {
    const fixture = makeSyntheticBirdEyeLandCoverFixture(kind);
    const fixtureReport = landCoverReport(fixture.land_cover_v1);
    assert.equal(fixtureReport.ok, true, `${kind} synthetic BirdEyeLandCover fixture should report ok`);
    assert.ok(fixture.land_cover_v1.masks.some((mask) => mask.class === 'building_footprint'), `${kind} synthetic fixture should include buildings`);
    assert.ok(fixture.land_cover_v1.tiles.every((tile) => tile.class), `${kind} synthetic fixture tiles should be classified`);
  }
  for (const kind of ['occluded_industrial_campus', 'partial_off_frame_road', 'single_edge_parking']) {
    const fixture = makeSyntheticBoundaryGraphFixture(kind);
    const fixtureReport = boundaryGraphReport(fixture.boundary_graph_v1);
    assert.equal(fixtureReport.ok, true, `${kind} synthetic BoundaryGraph fixture should report ok`);
    assert.ok(fixture.boundary_graph_v1.corridor_hypotheses.length >= 1, `${kind} synthetic BoundaryGraph fixture should produce corridor hypotheses`);
    assert.ok(fixture.boundary_graph_v1.completed_edges.some((edge) => ['completed_occluded', 'completed_gap', 'extrapolated_off_frame', 'weak_inferred'].includes(edge.state)), `${kind} synthetic BoundaryGraph fixture should expose completion states`);
  }
  const roofSeamNegative = makeSyntheticBoundaryGraphFixture('roof_seam_negative');
  assert.equal(roofSeamNegative.boundary_graph_v1.corridor_hypotheses.some((hypothesis) => intersects(hypothesis.bbox_px, [72, 46, 170, 120])), false, 'roof seam negative should not create road corridors through building footprint');
  const syntheticRoofSeamEdge = makeSyntheticHighContrastEdgeFixture('roof_seam_negative');
  assert.ok(syntheticRoofSeamEdge.candidate_edges.some((edge) => edge.class === 'roof_internal_seam' && edge.accepted === false), 'HighContrastEdge synthetic roof seam should be rejected');
  const syntheticSiteAlternative = makeSyntheticHighContrastEdgeFixture('site_alternative');
  assert.ok(Object.values(syntheticSiteAlternative.site_perimeter_candidates).some((side) => side.rejected_alternatives.length > 0), 'HighContrastEdge should keep site perimeter alternatives as rejected evidence');
  const syntheticVisionTop = makeSyntheticVisionEvidenceSetFixture('top_view');
  assertValid(validateVisionEvidenceSetV1, syntheticVisionTop, 'synthetic top-view VisionEvidenceSet fixture');
  assert.equal(syntheticVisionTop.qa.default_heavy_model_required, false, 'synthetic VisionEvidenceSet should not require heavy models');
  assert.equal(syntheticVisionTop.view_ground_plane.summary.planar_groundplan_allowed, true, 'synthetic top view should allow planar GroundPlan');
  assert.equal(syntheticVisionTop.view_ground_plane.images[0].usage_policy, 'planar_groundplan_candidate', 'synthetic top view should expose usage policy');
  assert.equal(syntheticVisionTop.view_ground_plane.images[0].confidence_band, 'high', 'synthetic top view should expose confidence band');
  assert.equal(syntheticVisionTop.edges.some((edge) => edge.class === 'roof_internal_seam' && edge.accepted === true), false, 'synthetic VisionEvidenceSet should reject roof seams');
  const syntheticVisionOblique = makeSyntheticVisionEvidenceSetFixture('oblique');
  assertValid(validateVisionEvidenceSetV1, syntheticVisionOblique, 'synthetic oblique VisionEvidenceSet fixture');
  assert.equal(syntheticVisionOblique.view_ground_plane.summary.planar_groundplan_allowed, false, 'synthetic oblique view should require review before planar GroundPlan');
  assert.equal(syntheticVisionOblique.view_ground_plane.images[0].usage_policy, 'review_only_oblique_context', 'synthetic oblique view should stay review-only');
  assert.ok(syntheticVisionOblique.view_ground_plane.images[0].risks.includes('oblique_view_not_planar_groundplan'), 'synthetic oblique view should expose planar-groundplan risk');

  const greenRoof = makeBirdEyeLandCoverV1FromObservationFixture(minimalBirdEyeObservation([
    ['site_boundary_obs', 'site_boundary', [0, 0, 240, 180], 'mask_polygon', 'pixel_color_segmentation'],
    ['green_roof_building_obs', 'primary_blue_roof_hall', [50, 40, 90, 80], 'mask_polygon', 'pixel_color_segmentation'],
    ['green_roof_false_vegetation_obs', 'tree_row_south', [50, 40, 90, 80], 'vegetation_region', 'pixel_vegetation_segmentation']
  ]));
  assert.ok(greenRoof.tiles.some((tile) => tile.class === 'building_footprint'), 'green-roof negative should preserve building exclusion');
  assert.equal(greenRoof.tiles.some((tile) => tile.class === 'vegetation_tree' && intersects(tile.bbox_px, [50, 40, 90, 80])), false, 'green roof inside building exclusion must not become vegetation');

  const hardscapeOnly = makeBirdEyeLandCoverV1FromObservationFixture(minimalBirdEyeObservation([
    ['site_boundary_obs', 'site_boundary', [0, 0, 240, 180], 'mask_polygon', 'pixel_color_segmentation'],
    ['paved_drive_obs', 'parking_drive_aisle_center', [20, 70, 200, 40], 'gap_region', 'pixel_gap_segmentation']
  ]));
  const hardscapeObservations = minimalBirdEyeObservation([
    ['site_boundary_obs', 'site_boundary', [0, 0, 240, 180], 'mask_polygon', 'pixel_color_segmentation'],
    ['paved_drive_obs', 'parking_drive_aisle_center', [20, 70, 200, 40], 'gap_region', 'pixel_gap_segmentation']
  ]);
  hardscapeObservations.land_cover_v1 = hardscapeOnly;
  const hardscapeGroundPlan = validateAutoGroundPlanR10({ observations: hardscapeObservations });
  assert.equal(hardscapeGroundPlan.auto_ground_plan.canonical_regions.some((region) => region.class === 'road' && region.grounding_decision === 'promoted_geometry'), false, 'hardscape-only evidence must not promote road geometry');

  return true;
}

async function assertAutoGroundPlanR10Samples() {
  const base = path.join(subprojectRoot, 'examples', 'building-group');
  const observations = JSON.parse(await fs.readFile(path.join(base, 'observations.json'), 'utf8'));
  const current = validateAutoGroundPlanR10({ observations, groundingV3: observations.grounding_v3 });
  assertAutoGroundPlanR10Report(current, 'building group AutoGroundPlan R10');
  assert.equal(current.auto_ground_plan.rejected_priors.some((item) => item.id === 'internal_roads'), true, 'R10 should reject internal_roads when the prior crosses buildings');
  assert.equal(current.auto_ground_plan.canonical_regions.some((region) => region.id === 'internal_roads'), false, 'R10 should keep rejected road priors out of canonical regions');
  assert.equal(current.auto_ground_plan.canonical_regions.some((region) => ['warehouse_row_west', 'warehouse_row_inner'].includes(region.id)), false, 'R10 should keep warehouse row parents out of canonical occupancy');
  assert.equal(current.auto_ground_plan.canonical_regions.filter((region) => /^parking_stall_row/.test(region.id)).length, 2, 'R10 should canonicalize the two parking row strips');
  assert.ok(current.auto_ground_plan.canonical_regions
    .filter((region) => /^parking_stall_row/.test(region.id))
    .every((region) => region.polygon_source === 'canonical_bbox' && region.polygon_px.length === 5), 'R10 parking strips should be canonical rectangles, not raw contours');
  assert.equal(current.auto_ground_plan.evidence_candidates
    .some((candidate) => /^parking_stall_row/.test(candidate.id) && candidate.polygon_px.length > 5), true, 'R10 should retain raw parking contour evidence for diagnostics');

  const saved = JSON.parse(await fs.readFile(path.join(base, 'structured-plan', 'structured-plan-qa-report.json'), 'utf8'));
  assertAutoGroundPlanR10Report(saved, 'saved building group AutoGroundPlan R10');
  const r10PartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.r10-groundplan.json'), 'utf8'));
  assertValid(validatePartGraph, r10PartGraph, 'building group R10 GroundPlan PartGraph');
  assert.equal(r10PartGraph.parts.some((part) => ['internal_roads', 'warehouse_row_west', 'warehouse_row_inner', 'parking_lot'].includes(part.id)), false, 'R10 GroundPlan PartGraph should not emit rejected roads, raw parking lots, or warehouse row parents');
  assert.ok(r10PartGraph.evidence_graph.auto_ground_plan, 'R10 GroundPlan PartGraph should carry AutoGroundPlan metadata');

  const roadThroughBuilding = deepClone(observations);
  const roadTop = roadThroughBuilding.images.find((image) => image.detected_view.kind === 'top');
  const roadPrior = roadTop.observations.find((item) => item.component_hint === 'internal_roads');
  const blueHall = roadTop.observations.find((item) => item.component_hint === 'primary_blue_roof_hall');
  roadPrior.bbox = blueHall.bbox.slice();
  roadPrior.grounding.method = 'layout_prior';
  roadPrior.note = 'negative test road prior crossing blue hall';
  const roadNegative = validateAutoGroundPlanR10({ observations: roadThroughBuilding });
  assert.equal(roadNegative.auto_ground_plan.rejected_priors.some((item) => item.id === 'internal_roads'), true, 'road prior through blue hall should be rejected');
  assert.equal(roadNegative.auto_ground_plan.qa.road_building_overlap_ratio, 0, 'rejected road prior should not leak into canonical road/building overlap');

  const bboxOnlyParking = deepClone(observations);
  const bboxTop = bboxOnlyParking.images.find((image) => image.detected_view.kind === 'top');
  for (const hint of ['parking_stall_row_north', 'parking_stall_row_south']) {
    const row = bboxTop.observations.find((item) => item.component_hint === hint);
    row.grounding.method = 'bbox_proxy';
    row.mask.method = 'bbox_proxy';
  }
  const bboxParkingReport = validateAutoGroundPlanR10({ observations: bboxOnlyParking });
  assert.notEqual(bboxParkingReport.auto_ground_plan.parking_grid.status, 'canonicalized', 'bbox-only parking evidence should not produce a canonical parking grid');
  assert.equal(bboxParkingReport.auto_ground_plan.canonical_regions.some((region) => /^parking_stall_row/.test(region.id)), false, 'bbox-only parking rows should not enter canonical structured output');

  const { observations: secondObservations } = makeGroundingV2SecondBuildingGroupSample();
  const second = validateAutoGroundPlanR10({ observations: secondObservations, groundingV3: secondObservations.grounding_v3 });
  assertAutoGroundPlanR10Report(second, 'second sample AutoGroundPlan R10');
  assert.equal(second.auto_ground_plan.canonical_regions.some((region) => ['warehouse_row_west', 'warehouse_row_inner'].includes(region.id)), false, 'second sample should remove warehouse row parents from canonical occupancy');
  return true;
}

function assertAutoGroundPlanR10Report(report, label) {
  assert.equal(report.kind, 'auto_ground_plan_r10_qa', `${label} should emit R10 QA`);
  assert.equal(report.version, 10, `${label} should use version 10`);
  assertValid(validateAutoGroundPlanR10Schema, report.auto_ground_plan, `${label} auto_ground_plan schema`);
  assert.equal(report.ok, true, `${label} should pass hard R10 gates`);
  assert.ok(['pass', 'review'].includes(report.verdict), `${label} verdict should be pass or review`);
  assert.equal(report.summary.road_building_overlap_ratio, 0, `${label} should have no canonical road/building overlap`);
  assert.equal(report.summary.raw_contour_leakage, 0, `${label} should have no structured raw contour leakage`);
  assert.equal(report.summary.parent_child_double_occupancy, 0, `${label} should have no parent/child double occupancy`);
  assert.equal(report.summary.region_without_evidence, 0, `${label} should have no canonical region without evidence`);
  assert.ok(report.summary.canonical_regions > 0, `${label} should produce canonical regions`);
  assert.ok(report.summary.subdivision_cells > 0, `${label} should produce subdivision cells`);
  assert.ok(Number.isFinite(report.summary.gap_completion_ratio), `${label} should report gap completion ratio`);
  assert.ok(Number.isFinite(report.summary.remaining_unknown_gap_ratio), `${label} should report remaining unknown gap ratio`);
  assert.ok(report.auto_ground_plan.gap_completion?.completed_regions, `${label} should carry gap completion regions`);
  assert.ok(report.auto_ground_plan.subdivision_cells.every((cell) => cell.class), `${label} cells should have mutually exclusive classes`);
}

function assertValid(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label} failed schema validation:\n${validate.errors.join('\n')}`);
  }
}

async function assertRejectsWithMessage(fn, pattern, label) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} should reject`);
  assert.match(caught.message || '', pattern, label);
}

function bboxInsideFrame(bbox, frame) {
  if (!Array.isArray(bbox) || !Array.isArray(frame) || bbox.length < 4 || frame.length < 4) return false;
  const [x, y, width, height] = bbox.map(Number);
  const [fx, fy, fw, fh] = frame.map(Number);
  return x >= fx
    && y >= fy
    && x + width <= fx + fw + 0.01
    && y + height <= fy + fh + 0.01;
}

function polygonInsideFrame(polygon, frame) {
  if (!Array.isArray(polygon) || polygon.length < 3 || !Array.isArray(frame) || frame.length < 4) return false;
  const [fx, fy, fw, fh] = frame.map(Number);
  return polygon.every((point) => Array.isArray(point)
    && point.length === 2
    && Number(point[0]) >= fx - 0.01
    && Number(point[1]) >= fy - 0.01
    && Number(point[0]) <= fx + fw + 0.01
    && Number(point[1]) <= fy + fh + 0.01);
}

function assertBudget(result, label) {
  assert.equal(result.ok, true, `${label} failed:\n${result.issues.join('\n')}`);
}

function assertBoundingBoxSize(box, expected, label, tolerance = 0.1) {
  assert.ok(box, `${label} should exist`);
  for (const key of ['w', 'd', 'h']) {
    assert.ok(Math.abs(Number(box[key]) - expected[key]) <= tolerance, `${label}.${key} should be ${expected[key]}mm +/- ${tolerance}mm`);
  }
}

function assertGeometryWarningsUseQaMetadata(report, label) {
  const geometryWarnings = (report.warnings || []).filter((warning) => warning.type?.startsWith('geometry.bbox_'));
  assert.equal(geometryWarnings.length, SWITCH_BASELINE_GEOMETRY_WARNINGS, `${label} should keep the current expected geometry warning count`);
  const nonQaWarnings = geometryWarnings.filter((warning) => warning.classification?.source !== 'qa.expected_contacts');
  assert.deepEqual(
    nonQaWarnings.map((warning) => warning.source || warning.message),
    [],
    `${label} geometry warning classifications should come from qa.expected_contacts metadata`
  );
}

function snapshotItemsWithExpectedContacts(snapshot) {
  return [...(snapshot.groups || []), ...(snapshot.instances || [])]
    .filter((item) => item.qa?.expected_contacts?.length > 0 || item.qa?.expectedContacts?.length > 0);
}

function minimalBirdEyeObservation(entries) {
  const top = {
    version: 1,
    image: {
      path: 'synthetic://bird-eye-negative',
      width: 240,
      height: 180,
      analysis_width: 240,
      analysis_height: 180
    },
    detected_view: {
      kind: 'top',
      confidence: 0.9,
      notes: ['Synthetic bird-eye negative fixture.']
    },
    camera_hints: {
      perspective_strength: 'low',
      projection_model: 'site_affine',
      review_required: false
    },
    orientation_hints: {
      coordinate_convention: 'image_x_right_y_down',
      model_convention: 'model_x_right_y_up_z_height',
      mirror_risk: { status: 'low', confidence: 0.4, reasons: [] },
      semantic_anchors: [],
      review_required: false
    },
    metrics: {
      object_bbox: entries.find((entry) => entry[1] === 'site_boundary')?.[2] || [0, 0, 240, 180]
    },
    observations: entries.map(([id, componentHint, bbox, kind, method]) => ({
      id,
      kind,
      component_hint: componentHint,
      bbox,
      contour: {
        kind: 'sampled_polygon',
        polygon: testBboxPolygon(bbox),
        sample_count: 5,
        source: method,
        review_required: false
      },
      mask: {
        id: `${id}_mask`,
        method,
        bbox,
        polygon: testBboxPolygon(bbox),
        sampled_contour: testBboxPolygon(bbox),
        pixel_count: Math.round(bbox[2] * bbox[3]),
        review_required: false
      },
      grounding: {
        method,
        mask: `${id}_mask`,
        pixel_bbox: bbox,
        pixel_count: Math.round(bbox[2] * bbox[3]),
        contour_basis: 'sampled_polygon',
        grounding_quality: {
          version: 1,
          status: 'accepted',
          bbox_proxy: false,
          review_required: false,
          reasons: []
        },
        review_required: false
      },
      confidence: 0.8
    })),
    quality_report: {
      usable_for_modeling: true,
      risks: [],
      missing_views: []
    }
  };
  return {
    version: 1,
    object: {
      type: 'building_group',
      profile: 'building_group',
      name: 'Synthetic BirdEye Negative',
      source_images: ['synthetic://bird-eye-negative']
    },
    image_set_quality: 'high',
    views_detected: ['top'],
    missing_views: ['oblique'],
    images: [top],
    quality_report: {
      usable_for_modeling: true,
      risks: []
    }
  };
}

function testBboxPolygon([x, y, width, height]) {
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
}

function intersects(a, b) {
  return Math.max(a[0], b[0]) < Math.min(a[0] + a[2], b[0] + b[2])
    && Math.max(a[1], b[1]) < Math.min(a[1] + a[3], b[1] + b[3]);
}

function stripCollectionOnlyFields(observation) {
  const clone = structuredClone(observation);
  delete clone.metrics;
  return clone;
}

function assertVisualRelationGraph(observationSet, label) {
  assert.ok(observationSet.visual_relation_graph, `${label} should contain a VisualRelationGraph`);
  assert.equal(observationSet.visual_relation_graph.version, 1, `${label} VisualRelationGraph should be version 1`);
  for (const type of ['left_of', 'right_of', 'above', 'below', 'inside', 'aligned_with', 'touching', 'same_row', 'mirrored_pair', 'centered_on']) {
    assert.ok(observationSet.visual_relation_graph.relation_types.includes(type), `${label} VisualRelationGraph should support ${type}`);
  }
  assert.ok(observationSet.visual_relation_graph.relations.length > 0, `${label} VisualRelationGraph should contain relation candidates`);
  assert.equal(
    observationSet.evidence_graph.visual_relations.length,
    observationSet.visual_relation_graph.relations.length,
    `${label} evidence graph should carry VisualRelationGraph candidates`
  );
  const candidate = observationSet.visual_relation_graph.relations[0];
  assert.ok(candidate.source_image, `${label} relation candidate should record source image`);
  assert.ok(candidate.basis?.kind, `${label} relation candidate should record bbox/keypoint basis kind`);
  assert.equal(typeof candidate.confidence, 'number', `${label} relation candidate should record confidence`);
  assert.equal(typeof candidate.review_required, 'boolean', `${label} relation candidate should record review_required`);
}

function assertGroundingV3ObservationGraph(observationSet, label) {
  assert.ok(observationSet.grounding_v3, `${label} should contain Grounding v3 metadata`);
  assert.equal(observationSet.grounding_v3.version, 3, `${label} Grounding v3 graph should be version 3`);
  assert.ok(observationSet.grounding_v3.scale_anchor_graph.candidates.length >= 2, `${label} should expose multiple scale-anchor candidates`);
  assert.equal(observationSet.grounding_v3.scale_anchor_graph.distinct_anchor_families.length >= 2, true, `${label} scale anchor graph should not be parking-only`);
  assert.ok(observationSet.grounding_v3.ground_plan.regions.some((region) => region.class === 'gap'), `${label} GroundPlan should include explicit gap regions`);
  assert.ok(observationSet.grounding_v3.line_grid_fit.parking_grid_fits[0].line_fits.length >= 2, `${label} should fit parking lines before geometry generation`);
  assert.ok(observationSet.grounding_v3.top_view_overlay.region_overlays.length > 0, `${label} should expose top-view overlay regions`);
  assert.ok(observationSet.grounding_v3.promotion_decisions.every((decision) => ['promoted_geometry', 'review_candidate', 'helper_only', 'rejected'].includes(decision.decision)), `${label} promotion decisions should use the R9 decision enum`);
  assert.ok(observationSet.grounding_r10?.auto_ground_plan, `${label} should carry AutoGroundPlan R10 metadata`);
  assert.equal(observationSet.grounding_r10.auto_ground_plan.qa.raw_contour_leakage, 0, `${label} R10 structured plan should keep raw contours diagnostic-only`);
  assert.ok(observationSet.evidence_graph.ground_plan, `${label} evidence graph should carry GroundPlan metadata`);
}

function assertPhotoGradeReadinessReport(report, { expectedReadiness, label }) {
  assert.equal(report.kind, 'photo_grade_readiness_qa', `${label} should emit PhotoGradeReadiness reports`);
  assert.equal(report.version, 1, `${label} should use report version 1`);
  assert.equal(report.photo_grade_readiness, expectedReadiness, `${label} should report the expected readiness verdict`);
  assert.equal(report.photo_grade_candidate, expectedReadiness === 'candidate', `${label} candidate flag should match readiness`);
  assert.equal(report.gates.length, 6, `${label} should evaluate the six R9.5 gates`);
  for (const id of ['scale', 'subdivision', 'line_grid', 'top_view_overlay', 'oblique_facade', 'promotion']) {
    assert.ok(gateById(report, id), `${label} should include ${id} gate`);
  }
  assert.ok(report.thresholds.scale.minAnchors >= 3, `${label} should expose stricter scale thresholds`);
  assert.ok(report.thresholds.topViewOverlay.minMeanIou >= 0.85, `${label} should expose top-view overlay thresholds`);
  assert.equal(typeof report.summary.blockers, 'number', `${label} should summarize blockers`);
  assert.ok(report.correction_suggestions.length >= report.blockers.length, `${label} should turn blockers into correction targets`);
}

function assertPhotoGradeReadinessNegativeCases({
  observations,
  fixture,
  geometryFit,
  groundingV3,
  codeDocument
}) {
  const overlayBroken = deepClone(groundingV3);
  overlayBroken.graph.top_view_overlay.qa.mean_mask_iou = 0.42;
  overlayBroken.graph.top_view_overlay.qa.min_mask_iou = 0.38;
  const overlayReport = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit,
    groundingV3: overlayBroken,
    codeDocument,
    sampleId: 'negative-top-overlay',
    sampleKind: 'negative_test'
  });
  assert.equal(overlayReport.photo_grade_candidate, false, 'mirrored/rotated top overlay must not become a photo-grade candidate');
  assert.ok(overlayReport.blockers.some((item) => item.gate === 'top_view_overlay'), 'top overlay negative should point at top_view_overlay blockers');

  const parkingOnly = deepClone(groundingV3);
  parkingOnly.graph.scale_anchor_graph.candidates = parkingOnly.graph.scale_anchor_graph.candidates
    .filter((candidate) => candidate.family === 'parking');
  parkingOnly.graph.scale_anchor_graph.distinct_anchor_families = ['parking'];
  const parkingOnlyReport = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit,
    groundingV3: parkingOnly,
    codeDocument,
    sampleId: 'negative-parking-only-scale',
    sampleKind: 'negative_test'
  });
  assert.equal(parkingOnlyReport.photo_grade_candidate, false, 'parking-only scale anchors must not become a photo-grade candidate');
  assert.ok(parkingOnlyReport.blockers.some((item) => item.reason === 'scale_anchor_family_count_below_candidate_threshold'), 'parking-only scale negative should keep family-count blocker');

  const bboxOnlyParking = deepClone(groundingV3);
  bboxOnlyParking.graph.line_grid_fit.parking_grid_fits[0].line_fits[0].grounding_method = 'bbox_proxy';
  const bboxOnlyReport = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit,
    groundingV3: bboxOnlyParking,
    codeDocument,
    sampleId: 'negative-bbox-only-parking',
    sampleKind: 'negative_test'
  });
  assert.equal(bboxOnlyReport.ok, false, 'bbox-only parking lines should hard-fail readiness');
  assert.equal(bboxOnlyReport.photo_grade_readiness, 'rejected', 'bbox-only parking evidence should reject photo-grade readiness');
  assert.ok(bboxOnlyReport.blockers.some((item) => item.reason === 'bbox_only_parking_line_evidence'), 'bbox-only parking negative should explain line/grid evidence failure');

  const baseline = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit,
    groundingV3,
    codeDocument,
    sampleId: 'negative-baseline-detail-review',
    sampleKind: 'negative_test'
  });
  assert.ok(baseline.blockers.some((item) => item.gate === 'oblique_facade'), 'facade/opening evidence gaps should remain explicit blockers');
  assert.ok(baseline.blockers.some((item) => item.gate === 'promotion'), 'review/helper promotion states should remain explicit blockers');
}

function gateById(report, id) {
  return report.gates.find((gate) => gate.id === id);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRelationCandidate(observationSet, expected, label) {
  const relation = (observationSet.visual_relation_graph?.relations || []).find((candidate) => (
    candidate.type === expected.type
    && candidate.item === expected.item
    && candidate.anchor === expected.anchor
    && (!expected.view || candidate.view === expected.view)
  ));
  assert.ok(relation, `${label} should exist`);
  assert.ok(relation.basis.kind === 'bbox' || relation.basis.kind === 'keypoint' || relation.basis.kind === 'mixed_bbox_keypoint' || relation.basis.kind === 'semantic_anchor', `${label} should carry bbox/keypoint/semantic basis`);
  assert.ok(relation.confidence >= (expected.min_confidence || 0.35), `${label} should meet confidence floor`);
  return relation;
}

async function assertSwitchVisualRelationFixture() {
  const observations = JSON.parse(await fs.readFile(observationPath, 'utf8'));
  const fixture = JSON.parse(await fs.readFile(path.join(subprojectRoot, 'examples', 'switch-controller', 'visual-relations.fixture.json'), 'utf8'));
  const code = await fs.readFile(path.join(repoRoot, 'examples', 'acceptance-switch-controller.json'), 'utf8');
  const report = await validateVisualRelations({ observations, fixture, code });
  assert.equal(report.ok, true, 'Switch VisualRelationGraph fixture should pass against accepted Switch PartGraph output');
  assert.equal(report.verdict, 'pass', 'Switch VisualRelationGraph fixture should produce pass verdict');
  assert.equal(report.summary.checked_relations, fixture.required_relations.length, 'Switch VisualRelationGraph fixture should check every required relation');
  assert.equal(report.summary.checked_footprints, fixture.footprint_rules.length, 'Switch VisualRelationGraph fixture should check every contour-grounded footprint rule');
  assert.equal(report.summary.matched_image_relations, fixture.required_relations.length, 'Switch VisualRelationGraph fixture should match every image-space relation');
  assert.equal(report.summary.negative_cases_detected, fixture.negative_cases.length, 'Switch VisualRelationGraph fixture should detect mirror negative cases');
  assert.ok(report.negative_results[0].failed_rules.includes('thumbsticks-handedness'), 'mirror negative should fail thumbstick handedness');
  const geometryFitReport = await validateGeometryFit({
    observations,
    fixture,
    code,
    mockSessionPath: path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-switch-geometry-fit-session.json')
  });
  assert.equal(geometryFitReport.ok, true, 'Switch GeometryFit QA should pass against accepted Switch PartGraph output');
  assert.equal(geometryFitReport.summary.checked_footprints, fixture.footprint_rules.length, 'Switch GeometryFit should evaluate contour/keypoint-grounded controls');
  assert.equal(geometryFitReport.summary.grounding_issues, 0, 'Switch GeometryFit should not treat contour/keypoint controls as bbox proxies');
  assert.equal(geometryFitReport.summary.checked_handedness_cases, fixture.negative_cases.length, 'Switch GeometryFit should retain handedness negative checks');
  assert.equal(geometryFitReport.summary.max_relation_error <= 0.23, true, 'Switch GeometryFit should keep relation projection residuals within fixture tolerance');
}

async function assertSwitchCorrectionRegression() {
  const observationSet = JSON.parse(await fs.readFile(observationPath, 'utf8'));
  const regressionCorrectionsPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'manual-corrections.regression.json');
  const regressionCorrections = JSON.parse(await fs.readFile(regressionCorrectionsPath, 'utf8'));
  assertValid(validateManualCorrections, regressionCorrections, 'switch controller manual-corrections.regression.json');

  const baselinePlan = generateModelPlan(observationSet, { knownWidth: 280, knownHeight: 155, knownDepth: 42 });
  const correctedPlan = generateModelPlan(observationSet, { manualCorrections: regressionCorrections });
  const baselineStick = partById(baselinePlan, 'left_thumbstick');
  const correctedStick = partById(correctedPlan, 'left_thumbstick');
  assert.notDeepEqual(correctedStick.parameters.center, baselineStick.parameters.center, 'manual correction should move left_thumbstick in model plan');
  assert.equal(correctedStick.parameters.outer_radius, 13, 'manual correction should update left_thumbstick radius');
  assert.equal(correctedStick.evidence_status, 'manual_confirmed', 'manual correction should mark updated part as manually confirmed');
  assert.equal(correctedStick.manual_confirmed, true, 'manual correction should expose manual confirmation flag');
  assert.ok(correctedStick.evidence_sources.some((source) => source.status === 'manual_confirmed'), 'manual correction should add a manual evidence source');
  assert.equal(partById(correctedPlan, 'abxy_cluster').parameters.buttons.length, 5, 'manual correction should replace ABXY button list');
  assert.ok(correctedPlan.review.corrections_applied.includes('update:left_thumbstick'), 'model plan should record part update correction');

  const baselineDsl = compilePlanToSketchUpDsl(baselinePlan);
  const correctedDsl = compilePlanToSketchUpDsl(correctedPlan);
  assert.notDeepEqual(
    operationByName(correctedDsl, 'Left_Thumbstick_From_Image_Plan').origin,
    operationByName(baselineDsl, 'Left_Thumbstick_From_Image_Plan').origin,
    'manual correction should move left thumbstick in compiled DSL'
  );
  assert.ok(
    correctedDsl.operations.some((operation) => operation.name === 'ABXY_Home_Button_From_Image_Plan'),
    'manual correction should add the Home button to compiled DSL'
  );
  assert.equal(correctedDsl.operations.filter((operation) => operation.name?.startsWith('ABXY_') && operation.name?.endsWith('_Button_From_Image_Plan')).length, 5, 'compiled DSL should contain corrected ABXY button count');
}

async function assertFeatureMappingCorrectionRegression() {
  const base = path.join(subprojectRoot, 'examples', 'compact-remote');
  const observationSet = JSON.parse(await fs.readFile(path.join(base, 'observations.json'), 'utf8'));
  const baselineCorrections = JSON.parse(await fs.readFile(path.join(base, 'manual-corrections.json'), 'utf8'));
  const featureCorrections = JSON.parse(await fs.readFile(path.join(base, 'manual-corrections.feature-regression.json'), 'utf8'));
  assertValid(validateManualCorrections, featureCorrections, 'compact remote manual-corrections.feature-regression.json');

  const baselinePlan = generateModelPlan(observationSet, { manualCorrections: baselineCorrections });
  const correctedPlan = generateModelPlan(observationSet, { manualCorrections: featureCorrections });
  assert.equal(partById(baselinePlan, 'brand_label').feature_mapping.operation, 'text_3d', 'baseline brand label should stay a visual text marker');
  assert.equal(partById(baselinePlan, 'brand_label').feature_mapping.fallback, 'visual_marker', 'baseline brand label should expose visual marker fallback');
  assert.equal(partById(correctedPlan, 'brand_label').feature_mapping.operation, 'cut_recess', 'feature correction should map brand label to cut_recess');
  assert.equal(partById(correctedPlan, 'brand_label').feature_mapping.fallback, 'none', 'feature correction should remove visual fallback');
  assert.ok(partById(correctedPlan, 'brand_label').feature_semantics.includes('blind_recess'), 'feature correction should update feature semantics to blind_recess');

  const baselineDsl = compilePlanToSketchUpDsl(baselinePlan);
  const correctedDsl = compilePlanToSketchUpDsl(correctedPlan);
  assert.ok(
    baselineDsl.operations.some((operation) => operation.op === 'text_3d' && operation.name === 'Remote_Brand_Label_From_Image_Plan'),
    'baseline DSL should compile brand label as visual text_3d marker'
  );
  assert.equal(
    baselineDsl.operations.some((operation) => operation.op === 'cut_recess' && operation.feature_id === 'Remote_Brand_Label_Recess_From_Image_Plan'),
    false,
    'baseline DSL should not emit a real cut_recess for the brand label'
  );
  assert.ok(
    correctedDsl.operations.some((operation) => operation.op === 'cut_recess' && operation.feature_id === 'Remote_Brand_Label_Recess_From_Image_Plan'),
    'feature correction should compile brand label as a real cut_recess op'
  );
  assert.equal(
    correctedDsl.operations.some((operation) => operation.op === 'text_3d' && operation.name === 'Remote_Brand_Label_From_Image_Plan'),
    false,
    'feature correction should remove visual text_3d fallback for the brand label'
  );
}

async function assertSingleImageEvidenceDowngrade() {
  const observationSet = JSON.parse(await fs.readFile(observationPath, 'utf8'));
  const frontImage = observationSet.images.find((image) => image.detected_view.kind === 'front') || observationSet.images[0];
  const singleImageSet = structuredClone(observationSet);
  singleImageSet.images = [frontImage];
  singleImageSet.object.source_images = [frontImage.image.path];
  singleImageSet.views_detected = [frontImage.detected_view.kind];
  singleImageSet.missing_views = ['rear', 'right', 'top'].filter((view) => view !== frontImage.detected_view.kind);
  const plan = generateModelPlan(singleImageSet, { knownWidth: 280, knownHeight: 155, knownDepth: 42 });
  assert.equal(plan.review.evidence_summary.image_count, 1, 'single-image model plan should record one source image');
  assert.ok(plan.review.open_questions.some((question) => question.includes('Single-image run')), 'single-image model plan should add an explicit open question');
  assert.equal(partById(plan, 'rear_grip_pair').evidence_status, 'template_prior', 'single front image should not confirm rear grip geometry');
  assert.equal(partById(plan, 'rear_grip_pair').template_prior, true, 'single front image should mark rear grip as template prior');
  assert.deepEqual(graphPartById(plan, 'rear_grip_pair').missing_views, ['rear', 'right'], 'single front image graph should record missing rear/right evidence for rear grip');
  assert.equal(fusionPartById(plan, 'rear_grip_pair').status, 'needs_review', 'single front image semantic fusion should require review for rear grip');
  assert.equal(fusionPartById(plan, 'rear_grip_pair').decision, 'template_prior_assisted', 'single front image semantic fusion should expose template-prior decision');
  assert.ok(plan.review.evidence_graph.open_questions.some((question) => question.includes('rear_grip_pair')), 'single-image evidence graph should emit part-level open questions');
  assert.ok(plan.review.correction_suggestions.some((suggestion) => suggestion.part_id === 'rear_grip_pair'), 'single-image model plan should suggest a correction patch for rear_grip_pair');
  assert.ok(plan.review.evidence_summary.status_counts.template_prior >= 1, 'single-image model plan should count template-prior parts');
}

async function assertRealWorldBuildingSourcePackagePreflight() {
  const blockedOutput = 'output/image-structured-modeler/source-package-preflight-regression/blocked/preflight.json';
  const blocked = await preflightRealWorldBuildingSourcePackageCli({
    input: 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png',
    objectType: 'building_single',
    viewHintsFile: 'projects/image-structured-modeler/examples/building-single-anime-yellow/view-hints.json',
    output: blockedOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(blocked.ok, false, 'generated/cropped building source preflight should fail release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, blocked.report, 'blocked real-world building source package preflight');
  assert.equal(blocked.report.can_start_structured_intake, true, 'blocked source preflight can still start review/demo intake');
  assert.equal(blocked.report.release_source_candidate, false, 'blocked source preflight must not claim release-source candidate');
  assert.equal(blocked.report.status, 'blocked_source_assets', 'blocked source preflight should reject generated/scaffold path markers');
  assert.ok(blocked.report.blockers.includes('source_assets_generated_or_scaffold'), 'blocked source preflight should expose source marker blocker');
  assert.ok(blocked.report.view_package.missing_hinted_views.includes('front'), 'blocked source preflight should still request front view hint');
  assertValid(
    validateRealWorldBuildingSourcePackagePreflight,
    JSON.parse(await fs.readFile(path.join(repoRoot, blockedOutput), 'utf8')),
    'blocked saved real-world building source preflight JSON'
  );
  assert.ok((await fs.readFile(path.join(repoRoot, blocked.markdownOutput), 'utf8')).includes('Real-World Building Source Package Preflight'), 'blocked preflight markdown should include title');

  const readySourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'source-package-preflight-regression', 'real-upload-source');
  await fs.mkdir(readySourceDir, { recursive: true });
  await fs.writeFile(path.join(readySourceDir, 'front-facade.jpg'), 'placeholder front photo\n', 'utf8');
  await fs.writeFile(path.join(readySourceDir, 'left-side.jpg'), 'placeholder side photo\n', 'utf8');
  await fs.writeFile(path.join(readySourceDir, 'oblique-street.jpg'), 'placeholder oblique photo\n', 'utf8');
  await fs.writeFile(path.join(readySourceDir, 'roof-plan.dxf'), '0\n', 'utf8');
  const readyOutput = 'output/image-structured-modeler/source-package-preflight-regression/real-upload/preflight.json';
  const ready = await preflightRealWorldBuildingSourcePackageCli({
    input: 'output/image-structured-modeler/source-package-preflight-regression/real-upload-source',
    objectType: 'building_single',
    output: readyOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(ready.ok, true, 'real upload-shaped source preflight should satisfy release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, ready.report, 'ready real-world building source package preflight');
  assert.equal(ready.report.status, 'release_source_candidate', 'ready source preflight should use release-source candidate status');
  assert.equal(ready.report.can_start_structured_intake, true, 'ready source preflight should allow structured intake');
  assert.equal(ready.report.release_source_candidate, true, 'ready source preflight should be release-source candidate');
  assert.deepEqual(ready.report.view_package.missing_hinted_views, [], 'ready source preflight should cover required view labels');
  for (const view of ['front', 'left', 'oblique', 'top']) {
    assert.ok(ready.report.view_package.hinted_views.includes(view), `ready preflight should include ${view} view hint`);
  }
  assert.ok(ready.report.commands.run_intake.includes('image-structured:intake'), 'ready preflight should include intake command');
  assertValid(
    validateRealWorldBuildingSourcePackagePreflight,
    JSON.parse(await fs.readFile(path.join(repoRoot, readyOutput), 'utf8')),
    'ready saved real-world building source preflight JSON'
  );
  assert.ok((await fs.readFile(path.join(repoRoot, ready.markdownOutput), 'utf8')).includes('release_source_candidate'), 'ready preflight markdown should include status');

  const duplicateSourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'source-package-preflight-regression', 'duplicate-upload-source');
  await fs.rm(duplicateSourceDir, { recursive: true, force: true });
  await fs.mkdir(duplicateSourceDir, { recursive: true });
  for (const name of ['front-facade.jpg', 'left-side.jpg', 'oblique-street.jpg']) {
    await fs.writeFile(path.join(duplicateSourceDir, name), 'same duplicated placeholder source\n', 'utf8');
  }
  await fs.writeFile(path.join(duplicateSourceDir, 'roof-plan.dxf'), '0\n', 'utf8');
  const duplicateOutput = 'output/image-structured-modeler/source-package-preflight-regression/duplicate-upload/preflight.json';
  const duplicate = await preflightRealWorldBuildingSourcePackageCli({
    input: 'output/image-structured-modeler/source-package-preflight-regression/duplicate-upload-source',
    objectType: 'building_single',
    output: duplicateOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(duplicate.ok, false, 'duplicate source preflight should fail release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, duplicate.report, 'duplicate real-world building source package preflight');
  assert.equal(duplicate.report.release_source_candidate, false, 'duplicate source preflight must not claim release-source candidate');
  assert.ok(duplicate.report.blockers.includes('duplicate_source_assets'), 'duplicate source preflight should expose duplicate source blocker');
  assert.equal(duplicate.report.source_content.status, 'fail', 'duplicate source preflight should fail source content status');
  assert.equal(duplicate.report.source_content.duplicate_groups.length, 1, 'duplicate source preflight should expose duplicate content group');
  assert.ok(duplicate.report.checks.some((check) => check.id === 'source_content_diversity' && check.status === 'fail'), 'duplicate source preflight should fail source content diversity check');

  const manifestSourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'source-package-preflight-regression', 'manifest-upload-source');
  await fs.rm(manifestSourceDir, { recursive: true, force: true });
  await fs.mkdir(manifestSourceDir, { recursive: true });
  for (const name of ['photo-a.jpg', 'photo-b.jpg', 'photo-c.jpg', 'photo-d.jpg']) {
    await fs.writeFile(path.join(manifestSourceDir, name), `${name} placeholder source\n`, 'utf8');
  }
  const manifestUploadFixture = {
    version: 1,
    kind: 'real_world_building_upload_manifest',
    object_type: 'building_single',
    dimensions: {
      units: 'mm',
      width: 9000,
      depth: 12000,
      height: 10500,
      confidence: 0.84,
      basis: ['Regression fixture known building dimensions.']
    },
    views: [
      { source_image: 'photo-a.jpg', kind: 'front' },
      { source_image: 'photo-b.jpg', kind: 'left' },
      { source_image: 'photo-c.jpg', kind: 'oblique' },
      { source_image: 'photo-d.jpg', kind: 'top' }
    ]
  };
  assertValid(validateRealWorldBuildingUploadManifest, manifestUploadFixture, 'upload manifest source preflight fixture');
  await fs.writeFile(path.join(manifestSourceDir, 'manifest.json'), `${JSON.stringify(manifestUploadFixture, null, 2)}\n`, 'utf8');
  const manifestOutput = 'output/image-structured-modeler/source-package-preflight-regression/manifest-upload/preflight.json';
  const manifestReady = await preflightRealWorldBuildingSourcePackageCli({
    input: 'output/image-structured-modeler/source-package-preflight-regression/manifest-upload-source',
    objectType: 'building_single',
    output: manifestOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(manifestReady.ok, true, 'upload manifest source preflight should satisfy release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, manifestReady.report, 'upload manifest real-world building source package preflight');
  assert.equal(manifestReady.report.asset_count, 4, 'upload manifest JSON should not count as a source asset');
  assert.equal(manifestReady.report.media_types.includes('unknown'), false, 'upload manifest JSON should not be treated as unsupported media');
  assert.equal(manifestReady.report.metadata_files.length, 1, 'upload manifest preflight should expose parsed metadata file');
  assert.equal(manifestReady.report.scale_package.has_known_dimensions, true, 'upload manifest preflight should expose known dimensions');
  assert.equal(manifestReady.report.scale_package.sources.includes('upload_manifest'), true, 'upload manifest scale package should cite upload manifest');
  assert.deepEqual(manifestReady.report.view_package.missing_hinted_views, [], 'upload manifest preflight should cover required view labels');
  assert.equal(
    manifestReady.report.view_package.sources.every((source) => source.source === 'upload_manifest'),
    true,
    'upload manifest preflight should record upload_manifest as the view hint source'
  );
  assertValid(
    validateRealWorldBuildingSourcePackagePreflight,
    JSON.parse(await fs.readFile(path.join(repoRoot, manifestOutput), 'utf8')),
    'upload manifest saved real-world building source preflight JSON'
  );

  const singleSourceMultiViewDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'source-package-preflight-regression', 'single-source-multiview-source');
  await fs.rm(singleSourceMultiViewDir, { recursive: true, force: true });
  await fs.mkdir(singleSourceMultiViewDir, { recursive: true });
  await fs.writeFile(path.join(singleSourceMultiViewDir, 'one-photo.jpg'), 'one source photo cannot prove four views\n', 'utf8');
  await fs.writeFile(path.join(singleSourceMultiViewDir, 'manifest.json'), `${JSON.stringify({
    version: 1,
    kind: 'real_world_building_upload_manifest',
    object_type: 'building_single',
    views: [
      { source_image: 'one-photo.jpg', kind: 'front' },
      { source_image: 'one-photo.jpg', kind: 'left' },
      { source_image: 'one-photo.jpg', kind: 'oblique' },
      { source_image: 'one-photo.jpg', kind: 'top' }
    ]
  }, null, 2)}\n`, 'utf8');
  const singleSourceMultiViewOutput = 'output/image-structured-modeler/source-package-preflight-regression/single-source-multiview/preflight.json';
  const singleSourceMultiView = await preflightRealWorldBuildingSourcePackageCli({
    input: 'output/image-structured-modeler/source-package-preflight-regression/single-source-multiview-source',
    objectType: 'building_single',
    output: singleSourceMultiViewOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(singleSourceMultiView.ok, false, 'one source labeled as multiple required views should fail release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, singleSourceMultiView.report, 'single-source multiview source package preflight');
  assert.equal(singleSourceMultiView.report.status, 'blocked_source_assets', 'single-source multiview manifest should block source assets');
  assert.equal(singleSourceMultiView.report.release_source_candidate, false, 'single-source multiview manifest must not be a release-source candidate');
  assert.deepEqual(singleSourceMultiView.report.view_package.missing_hinted_views, [], 'single-source multiview manifest still has labels for all required views');
  assert.equal(singleSourceMultiView.report.view_package.status, 'fail', 'single-source multiview manifest should fail view package diversity');
  assert.equal(singleSourceMultiView.report.view_package.view_source_diversity.status, 'fail', 'single-source multiview manifest should fail source diversity');
  assert.equal(singleSourceMultiView.report.view_package.view_source_diversity.reused_source_paths.length, 1, 'single-source multiview manifest should expose reused path');
  assert.deepEqual(singleSourceMultiView.report.view_package.view_source_diversity.reused_source_paths[0].views, ['front', 'left', 'oblique', 'top'], 'single-source multiview manifest should expose all reused required views');
  assert.ok(singleSourceMultiView.report.blockers.includes('view_sources_not_distinct'), 'single-source multiview manifest should expose view source blocker');
  assert.ok(singleSourceMultiView.report.checks.some((check) => check.id === 'view_source_diversity' && check.status === 'fail'), 'single-source multiview manifest should fail view source diversity check');

  const missingReferenceManifestSourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'source-package-preflight-regression', 'missing-reference-manifest-source');
  await fs.rm(missingReferenceManifestSourceDir, { recursive: true, force: true });
  await fs.mkdir(missingReferenceManifestSourceDir, { recursive: true });
  await fs.writeFile(path.join(missingReferenceManifestSourceDir, 'photo-a.jpg'), 'photo-a placeholder source\n', 'utf8');
  await fs.writeFile(path.join(missingReferenceManifestSourceDir, 'photo-b.jpg'), 'photo-b placeholder source\n', 'utf8');
  await fs.writeFile(path.join(missingReferenceManifestSourceDir, 'photo-c.jpg'), 'photo-c placeholder source\n', 'utf8');
  await fs.writeFile(path.join(missingReferenceManifestSourceDir, 'manifest.json'), `${JSON.stringify({
    version: 1,
    kind: 'real_world_building_upload_manifest',
    object_type: 'building_single',
    views: [
      { source_image: 'photo-a.jpg', kind: 'front' },
      { source_image: 'photo-b.jpg', kind: 'left' },
      { source_image: 'photo-c.jpg', kind: 'oblique' },
      { source_image: 'missing-top.jpg', kind: 'top' }
    ],
    scale_anchors: [
      {
        source_image: 'missing-scale-anchor.jpg',
        anchor_type: 'door_width',
        width_mm: 900
      }
    ]
  }, null, 2)}\n`, 'utf8');
  const missingReferenceOutput = 'output/image-structured-modeler/source-package-preflight-regression/missing-reference-manifest/preflight.json';
  const missingReference = await preflightRealWorldBuildingSourcePackageCli({
    input: 'output/image-structured-modeler/source-package-preflight-regression/missing-reference-manifest-source',
    objectType: 'building_single',
    output: missingReferenceOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(missingReference.ok, false, 'upload manifest with missing source references should fail release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, missingReference.report, 'missing-reference upload manifest source package preflight');
  assert.equal(missingReference.report.status, 'blocked_source_metadata', 'missing-reference upload manifest should block source metadata');
  assert.equal(missingReference.report.metadata_files[0].status, 'invalid_contract', 'missing-reference upload manifest should be invalid_contract');
  assert.ok(
    missingReference.report.metadata_files[0].errors.some((error) => error.includes('missing-top.jpg')),
    'missing-reference upload manifest should report missing view source image'
  );
  assert.ok(
    missingReference.report.metadata_files[0].errors.some((error) => error.includes('missing-scale-anchor.jpg')),
    'missing-reference upload manifest should report missing scale anchor source image'
  );
  assert.equal(missingReference.report.view_package.sources.some((source) => source.source === 'upload_manifest'), false, 'missing-reference upload manifest must not contribute view hints');

  const invalidManifestSourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'source-package-preflight-regression', 'invalid-manifest-upload-source');
  await fs.rm(invalidManifestSourceDir, { recursive: true, force: true });
  await fs.mkdir(invalidManifestSourceDir, { recursive: true });
  for (const name of ['photo-a.jpg', 'photo-b.jpg', 'photo-c.jpg', 'photo-d.jpg']) {
    await fs.writeFile(path.join(invalidManifestSourceDir, name), `${name} placeholder source\n`, 'utf8');
  }
  await fs.writeFile(path.join(invalidManifestSourceDir, 'manifest.json'), `${JSON.stringify({
    version: 1,
    kind: 'real_world_building_upload_manifest',
    object_type: 'building_single',
    views: [
      { source_image: 'photo-a.jpg', kind: 'facade' }
    ]
  }, null, 2)}\n`, 'utf8');
  const invalidManifestOutput = 'output/image-structured-modeler/source-package-preflight-regression/invalid-manifest-upload/preflight.json';
  const invalidManifest = await preflightRealWorldBuildingSourcePackageCli({
    input: 'output/image-structured-modeler/source-package-preflight-regression/invalid-manifest-upload-source',
    objectType: 'building_single',
    output: invalidManifestOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(invalidManifest.ok, false, 'invalid upload manifest preflight should fail release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, invalidManifest.report, 'invalid upload manifest real-world building source package preflight');
  assert.equal(invalidManifest.report.status, 'blocked_source_metadata', 'invalid upload manifest should expose metadata block status');
  assert.equal(invalidManifest.report.can_start_structured_intake, true, 'invalid upload manifest should still allow review intake');
  assert.equal(invalidManifest.report.release_source_candidate, false, 'invalid upload manifest must not be a release-source candidate');
  assert.equal(invalidManifest.report.blockers.includes('invalid_source_metadata'), true, 'invalid upload manifest should expose metadata blocker');
  assert.equal(invalidManifest.report.metadata_files[0].status, 'invalid_contract', 'invalid upload manifest should record invalid_contract metadata status');
  assert.equal(invalidManifest.report.metadata_files[0].errors.some((error) => error.includes('views[0].kind')), true, 'invalid upload manifest should explain bad view kind');
  assert.equal(invalidManifest.report.view_package.sources.some((source) => source.source === 'upload_manifest'), false, 'invalid upload manifest should not contribute view hints');
  assert.ok((await fs.readFile(path.join(repoRoot, invalidManifest.markdownOutput), 'utf8')).includes('invalid_contract'), 'invalid manifest markdown should expose metadata contract status');

  const templateManifestSourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'source-package-preflight-regression', 'template-manifest-upload-source');
  await fs.rm(templateManifestSourceDir, { recursive: true, force: true });
  await fs.mkdir(templateManifestSourceDir, { recursive: true });
  const templateUploadManifest = buildRealWorldBuildingUploadManifestTemplate({
    sourceRequest: inputReadySourcePackage.source_request,
    profileId: 'building_single',
    generatedAt: '2026-06-17T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingUploadManifest, templateUploadManifest, 'template-only upload manifest fixture should be schema-valid');
  for (const view of templateUploadManifest.views) {
    await fs.writeFile(path.join(templateManifestSourceDir, view.source_image), `${view.source_image} placeholder source\n`, 'utf8');
  }
  await fs.writeFile(path.join(templateManifestSourceDir, 'manifest.json'), `${JSON.stringify(templateUploadManifest, null, 2)}\n`, 'utf8');
  const templateManifestOutput = 'output/image-structured-modeler/source-package-preflight-regression/template-manifest-upload/preflight.json';
  const templateManifest = await preflightRealWorldBuildingSourcePackageCli({
    input: 'output/image-structured-modeler/source-package-preflight-regression/template-manifest-upload-source',
    objectType: 'building_single',
    output: templateManifestOutput,
    requireReleaseSourceCandidate: true
  });
  assert.equal(templateManifest.ok, false, 'template-only upload manifest preflight should fail release-source requirement');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, templateManifest.report, 'template-only upload manifest real-world building source package preflight');
  assert.equal(templateManifest.report.status, 'blocked_source_metadata', 'template-only upload manifest should expose metadata block status');
  assert.equal(templateManifest.report.blockers.includes('invalid_source_metadata'), true, 'template-only upload manifest should expose metadata blocker');
  assert.equal(templateManifest.report.metadata_files[0].status, 'invalid_contract', 'template-only upload manifest should record invalid_contract metadata status');
  assert.equal(
    templateManifest.report.metadata_files[0].errors.some((error) => error.includes('template_only upload manifest')),
    true,
    'template-only upload manifest should explain that the template must be replaced'
  );
}

async function assertRealWorldBuildingUploadSession() {
  const outputDir = 'output/image-structured-modeler/upload-session-regression/blocked-demo';
  const summary = await runRealWorldBuildingUploadSession({
    input: 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png',
    objectType: 'building_single',
    objectName: 'Upload Session Regression Blocked Demo',
    viewHintsFile: 'projects/image-structured-modeler/examples/building-single-anime-yellow/view-hints.json',
    outputDir,
    writeOverlays: false,
    requirePreflightReleaseSourceCandidate: true,
    requireSourceInputReady: true
  });
  assertValid(validateRealWorldBuildingUploadSession, summary, 'blocked real-world building upload-session summary');
  assert.equal(summary.ok, false, 'blocked upload session should fail requested gates');
  assert.equal(summary.status, 'blocked_preflight', 'blocked upload session should expose preflight gate failure');
  assert.equal(summary.preflight.can_start_structured_intake, true, 'blocked upload session should still run structured intake');
  assert.equal(summary.preflight.release_source_candidate, false, 'blocked upload session should not claim release-source candidate');
  assert.deepEqual(summary.preflight.failed_requirements, ['release_source_candidate'], 'blocked upload session should expose failed preflight requirement');
  assert.equal(summary.preflight.metadata_files.length, 1, 'blocked upload session should expose explicit view-hints metadata');
  assert.equal(summary.preflight.metadata_files[0].status, 'parsed', 'blocked upload session should record parsed view-hints metadata');
  assert.equal(summary.intake.status, 'review_required', 'blocked upload session intake should remain review-required');
  assert.equal(summary.intake.source_package_status, 'blocked_source_assets', 'blocked upload session source package should stay blocked');
  assert.equal(summary.intake.source_package.gate_ok, false, 'blocked upload session source-package summary should expose failed gate');
  assert.ok(summary.intake.source_package.blockers.includes('source_assets_generated_or_scaffold'), 'blocked upload session source-package summary should expose source blocker');
	  assert.ok(summary.intake.source_package.blockers.includes('missing_top_view'), 'blocked upload session source-package summary should expose missing top view blocker');
	  assert.deepEqual(summary.intake.source_package.failed_requirements, ['input_ready_for_release_work'], 'blocked upload session source-package summary should expose failed source requirement');
	  assert.equal(summary.intake.source_package.source_status, 'fail', 'blocked upload session source-package summary should expose source status');
	  assert.ok(summary.intake.source_package.next_actions.some((action) => action.includes('Replace generated')), 'blocked upload session source-package summary should expose next actions');
  assert.equal(summary.intake.source_package.source_request.status, 'needs_source_replacement', 'blocked upload session source request should ask for source replacement');
  assert.ok(summary.intake.source_package.source_request.blocked_until_satisfied.includes('direct_sketchup_dsl'), 'blocked upload session source request should block direct DSL');
  assert.ok(summary.intake.source_package.source_request.view_requirements.some((item) => item.view === 'top' && item.status === 'missing'), 'blocked upload session source request should ask for top view');
  assert.equal(summary.intake.source_package.source_request.upload_package_requirements.manifest_required, true, 'blocked upload session source request should expose upload package manifest requirement');
  assert.ok(summary.intake.source_package.source_request.upload_package_requirements.missing_required_views.includes('top'), 'blocked upload session source request should expose missing upload package view slot');
  assert.ok(summary.intake.source_package.source_request.upload_package_requirements.next_upload_response_check_ids.includes('view_source_diversity'), 'blocked upload session source request should expose next upload diversity check id');
  assert.ok(summary.intake.source_package.source_request.upload_package_requirements.next_upload_response_check_ids.includes('scale_evidence'), 'blocked upload session source request should expose next upload scale check id');
  assertValid(validateRealWorldBuildingSourceRequest, summary.intake.source_package.source_request, 'blocked upload session source request summary');
  assert.equal(summary.gates.source_package_gate_ok, false, 'blocked upload session source-package gate should fail');
  assert.equal(summary.gates.source_request_response_ok, null, 'blocked upload session without previous request should not claim source-request response gate');
  assert.equal(summary.source_request_response, null, 'blocked upload session without previous request should not emit source-request response summary');
  assert.equal(summary.gates.can_generate_sketchup_dsl, false, 'blocked upload session should forbid direct SketchUp DSL');
  assert.equal(summary.workflow.stage, 'source_refill_required', 'blocked upload session workflow should require a source refill');
  assert.equal(summary.workflow.can_continue_without_new_upload, false, 'blocked upload session workflow should require new user sources');
  assert.equal(summary.workflow.source_request_file, summary.artifacts.source_request, 'blocked upload session workflow should point to source request artifact');
  assert.equal(summary.workflow.upload_manifest_template, summary.artifacts.upload_manifest_template, 'blocked upload session workflow should point to upload manifest template');
  assert.ok(summary.workflow.blocked_outputs.includes('direct_sketchup_dsl'), 'blocked upload session workflow should expose blocked direct DSL output');
  assert.ok(summary.workflow.required_user_inputs.includes('release_source_candidate'), 'blocked upload session workflow should expose failed preflight requirement');
  assert.ok(summary.workflow.commands.prepare_source_refill_package.includes('prepare-real-world-building-source-refill-package'), 'blocked upload session workflow should include source-refill package preparation command');
  assert.ok(summary.workflow.commands.validate_source_refill_package.includes('validate-real-world-building-source-refill-package'), 'blocked upload session workflow should include source-refill package validation command');
  assert.ok(summary.workflow.commands.validate_source_refill_package_require_upload_ready.includes('--require-upload-ready'), 'blocked upload session workflow should include source-refill upload-ready validation command');
  assert.ok(summary.workflow.commands.run_refill_upload_session.includes('--source-request-file'), 'blocked upload session workflow should include refill upload command');
  assert.ok(summary.workflow.commands.run_refill_upload_session.includes('-source-refill-package/upload-package'), 'blocked upload session workflow should point refill upload at generated upload-package directory');
  assert.ok(summary.workflow.commands.run_refill_upload_session_require_input_ready.includes('--require-source-input-ready'), 'blocked upload session workflow should include input-ready refill gate command');
  assert.ok(summary.workflow.commands.assess_source_package_input_ready.includes('assess-real-world-building-source-package'), 'blocked upload session workflow should include source-package reassessment command');
  assert.ok(summary.workflow.release_artifact_workspace.endsWith('/release-artifact-workspace.json'), 'blocked upload session workflow should expose release artifact workspace path');
  assert.ok(summary.workflow.commands.prepare_release_artifact_workspace.includes('prepare-real-world-building-release-artifact-workspace'), 'blocked upload session workflow should expose release artifact workspace command');
  assert.equal(summary.artifacts.view_hints, 'projects/image-structured-modeler/examples/building-single-anime-yellow/view-hints.json', 'blocked upload session should expose explicit view hints artifact');
  assert.ok(summary.artifacts.review_workbench.endsWith('/intake/review/index.html'), 'blocked upload session should expose review workbench path');
  assert.ok(summary.artifacts.mcp_modeling_brief.endsWith('/intake/mcp-modeling-brief.json'), 'blocked upload session should expose MCP brief path');
  assert.ok(summary.artifacts.source_request.endsWith('/intake/real-world-building-source-request.json'), 'blocked upload session should expose source request artifact');
  assert.ok(summary.artifacts.source_request_markdown.endsWith('/intake/real-world-building-source-request.md'), 'blocked upload session should expose source request markdown artifact');
  assert.ok(summary.artifacts.upload_manifest_template.endsWith('/intake/upload-manifest.template.json'), 'blocked upload session should expose upload manifest template artifact');
  assert.ok(summary.next_actions.some((action) => action.includes('Replace generated')), 'blocked upload session should carry preflight next actions');
  assert.ok(summary.next_actions.some((action) => action.includes('Do not generate SketchUp DSL')), 'blocked upload session should carry compile prohibition action');

  const savedSummary = JSON.parse(await fs.readFile(path.join(repoRoot, outputDir, 'upload-session-summary.json'), 'utf8'));
  assertValid(validateRealWorldBuildingUploadSession, savedSummary, 'saved blocked upload-session summary');
  assertValid(
    validateRealWorldBuildingSourcePackagePreflight,
    JSON.parse(await fs.readFile(path.join(repoRoot, outputDir, 'preflight', 'preflight.json'), 'utf8')),
    'saved upload-session preflight JSON'
  );
  assertValid(
    validateStructuredAssetIntakeSummary,
    JSON.parse(await fs.readFile(path.join(repoRoot, outputDir, 'intake', 'intake-summary.json'), 'utf8')),
    'saved upload-session intake summary'
  );
  assertValid(
    validateRealWorldBuildingSourceRequest,
    JSON.parse(await fs.readFile(path.join(repoRoot, outputDir, 'intake', 'real-world-building-source-request.json'), 'utf8')),
    'saved upload-session source request JSON'
  );
  assertValid(
    validateRealWorldBuildingUploadManifest,
    JSON.parse(await fs.readFile(path.join(repoRoot, outputDir, 'intake', 'upload-manifest.template.json'), 'utf8')),
    'saved upload-session upload manifest template'
  );
  assert.ok((await fs.readFile(path.join(repoRoot, outputDir, 'upload-session-summary.md'), 'utf8')).includes('Real-World Building Upload Session'), 'upload-session markdown should include title');
  assert.ok((await fs.readFile(path.join(repoRoot, outputDir, 'upload-session-summary.md'), 'utf8')).includes('## Source Request'), 'upload-session markdown should include source request section');
  assert.ok((await fs.readFile(path.join(repoRoot, outputDir, 'upload-session-summary.md'), 'utf8')).includes('## Workflow'), 'upload-session markdown should include workflow section');
  assert.ok((await fs.readFile(path.join(repoRoot, outputDir, 'intake', 'real-world-building-source-request.md'), 'utf8')).includes('Real-World Building Source Request'), 'source request markdown should include title');
  const blockedReleaseArtifactWorkspaceResult = await prepareRealWorldBuildingReleaseArtifactWorkspaceCli({
    uploadSessionSummary: summary.artifacts.upload_session_summary,
    output: path.join(outputDir, 'release-artifact-workspace.json'),
    generatedAt: '2026-06-17T00:00:00.000Z'
  });
  assert.equal(blockedReleaseArtifactWorkspaceResult.status, 'blocked_needs_source_refill', 'blocked upload session release artifact workspace should require source refill');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspace, blockedReleaseArtifactWorkspaceResult.workspace, 'blocked upload session release artifact workspace');
  assert.equal(blockedReleaseArtifactWorkspaceResult.workspace.source_input_ready, false, 'blocked workspace should not claim source input readiness');
  assert.ok(blockedReleaseArtifactWorkspaceResult.workspace.commands.prepare_source_refill_package.includes('prepare-real-world-building-source-refill-package'), 'blocked workspace should expose source-refill package preparation command');
  assert.ok(blockedReleaseArtifactWorkspaceResult.workspace.commands.validate_source_refill_package_require_upload_ready.includes('--require-upload-ready'), 'blocked workspace should expose source-refill upload-ready validation command');
  assert.ok(blockedReleaseArtifactWorkspaceResult.workspace.commands.run_refill_upload_session.includes('/upload-package'), 'blocked workspace refill command should consume the prepared upload-package directory');
  assert.equal(blockedReleaseArtifactWorkspaceResult.workspace.required_artifacts.length, 3, 'blocked workspace should still list required release artifact roles');
  const blockedReleaseArtifactWorkspaceValidation = await validateRealWorldBuildingReleaseArtifactWorkspaceCli({
    workspace: blockedReleaseArtifactWorkspaceResult.output,
    output: path.join(outputDir, 'release-artifact-workspace-validation.json'),
    generatedAt: '2026-06-17T00:00:00.000Z'
  });
  assert.equal(blockedReleaseArtifactWorkspaceValidation.ok, true, 'blocked workspace validation should pass fail-closed contract checks');
  assert.equal(blockedReleaseArtifactWorkspaceValidation.status, 'blocked_needs_source_refill_validated', 'blocked workspace validation should preserve source-refill status');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspaceValidation, blockedReleaseArtifactWorkspaceValidation.report, 'blocked upload session release artifact workspace validation');
  assert.equal(
    blockedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'blocked_source_refill_commands_present')?.status,
    'pass',
    'blocked workspace validation should check source-refill package command chain'
  );
  assert.ok((await fs.readFile(path.join(repoRoot, outputDir, 'release-artifact-workspace.md'), 'utf8')).includes('Real-World Building Release Artifact Workspace'), 'blocked workspace markdown should include title');

  const namedSourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'upload-session-regression', 'real-source-named');
  await fs.rm(namedSourceDir, { recursive: true, force: true });
  await fs.mkdir(namedSourceDir, { recursive: true });
  const sourceImage = path.join(repoRoot, 'projects', 'image-structured-modeler', 'examples', 'building-single-anime-yellow', 'input-visible-crop.png');
  await writeDistinctImageVariant(sourceImage, path.join(namedSourceDir, 'photo-a.png'), 1);
  await writeDistinctImageVariant(sourceImage, path.join(namedSourceDir, 'photo-b.png'), 2);
  await writeDistinctImageVariant(sourceImage, path.join(namedSourceDir, 'photo-c.png'), 3);
  await writeDistinctImageVariant(sourceImage, path.join(namedSourceDir, 'photo-d.png'), 4);
  const uploadSessionManifestFixture = {
    version: 1,
    kind: 'real_world_building_upload_manifest',
    object_type: 'building_single',
    dimensions: {
      units: 'mm',
      width: 9000,
      depth: 12000,
      height: 10500,
      confidence: 0.84,
      basis: ['Upload-session regression known building dimensions.']
    },
    views: [
      { source_image: 'photo-a.png', kind: 'front' },
      { source_image: 'photo-b.png', kind: 'left' },
      { source_image: 'photo-c.png', kind: 'oblique' },
      { source_image: 'photo-d.png', kind: 'top' }
    ]
  };
  assertValid(validateRealWorldBuildingUploadManifest, uploadSessionManifestFixture, 'upload-session generated hints manifest fixture');
  await fs.writeFile(path.join(namedSourceDir, 'manifest.json'), `${JSON.stringify(uploadSessionManifestFixture, null, 2)}\n`, 'utf8');
  const generatedHintsOutputDir = 'output/image-structured-modeler/upload-session-regression/generated-view-hints';
  const generatedHintsSummary = await runRealWorldBuildingUploadSession({
    input: 'output/image-structured-modeler/upload-session-regression/real-source-named',
    objectType: 'building_single',
    objectName: 'Upload Session Generated Hints Regression',
    outputDir: generatedHintsOutputDir,
    sourceRequestFile: path.join(outputDir, 'intake', 'real-world-building-source-request.json'),
    writeOverlays: false,
    requirePreflightReleaseSourceCandidate: true,
    requireSourceInputReady: true,
    writeRealWorldBuildingReleaseDraft: true,
    releaseDraftReviewer: 'upload session generated hints regression',
    releaseDraftAcceptedAt: '2026-06-17',
    releaseDraftNotes: 'Regression fixture for generated view hints and upload-session release draft wiring.'
  });
  assertValid(validateRealWorldBuildingUploadSession, generatedHintsSummary, 'generated-hints upload-session summary');
  assertValid(validateRealWorldBuildingUploadSessionHandoff, generatedHintsSummary.handoff, 'generated-hints upload-session handoff summary');
  assert.equal(generatedHintsSummary.preflight.release_source_candidate, true, 'generated-hints upload session should pass release-source preflight by upload manifest views');
  assert.equal(generatedHintsSummary.preflight.metadata_files.length, 1, 'generated-hints upload session should expose upload manifest metadata in summary');
  assert.equal(generatedHintsSummary.preflight.metadata_files[0].status, 'parsed', 'generated-hints upload session should record parsed upload manifest');
  assert.equal(generatedHintsSummary.preflight.metadata_files[0].source, 'upload_manifest', 'generated-hints upload session should record upload_manifest metadata source');
  assert.equal(generatedHintsSummary.preflight.scale_package.has_known_dimensions, true, 'generated-hints upload session should expose manifest known dimensions');
  assert.equal(generatedHintsSummary.preflight.blockers.includes('duplicate_source_assets'), false, 'generated-hints upload session should use distinct source file content');
  assert.equal(generatedHintsSummary.preflight.view_source_diversity.status, 'pass', 'generated-hints upload session should use distinct source paths for required views');
  assert.equal(generatedHintsSummary.gates.source_package_gate_ok, true, 'generated-hints upload session source input gate should pass');
  assert.equal(generatedHintsSummary.gates.source_request_response_ok, true, 'generated-hints upload session should satisfy previous source request');
  assert.equal(generatedHintsSummary.source_request_response.status, 'satisfied_for_release_work', 'generated-hints upload session should report satisfied source-request response');
  assert.equal(generatedHintsSummary.source_request_response.unsatisfied_checks, 0, 'generated-hints source-request response should satisfy all requested checks');
  assert.equal(generatedHintsSummary.workflow.stage, 'source_input_ready_needs_release_artifacts', 'generated-hints workflow should advance to release artifact work');
  assert.equal(generatedHintsSummary.workflow.can_continue_without_new_upload, true, 'generated-hints workflow should be able to continue without another upload');
  assert.equal(generatedHintsSummary.workflow.source_request_response_file, generatedHintsSummary.artifacts.source_request_response, 'generated-hints workflow should point to source-request response artifact');
  assert.equal(generatedHintsSummary.workflow.release_manifest_draft, generatedHintsSummary.artifacts.real_world_building_release_manifest_draft, 'generated-hints workflow should point to release manifest draft');
  assert.equal(generatedHintsSummary.workflow.release_work_order, generatedHintsSummary.artifacts.real_world_building_release_work_order, 'generated-hints workflow should point to release work order artifact');
  assert.equal(generatedHintsSummary.workflow.release_work_order_markdown, generatedHintsSummary.artifacts.real_world_building_release_work_order_markdown, 'generated-hints workflow should point to release work order markdown artifact');
  assert.equal(generatedHintsSummary.workflow.release_artifact_workspace, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/release-artifact-workspace.json', 'generated-hints workflow should point to release artifact workspace');
  assert.equal(generatedHintsSummary.handoff.status, 'ready_for_release_artifact_work', 'generated-hints handoff should route to release artifact work');
  assert.equal(generatedHintsSummary.handoff.primary_action.kind, 'produce_release_artifacts', 'generated-hints handoff should name release artifact production as the primary action');
  assert.equal(generatedHintsSummary.handoff.primary_action.artifact, generatedHintsSummary.workflow.release_artifact_workspace, 'generated-hints handoff should point primary action at release artifact workspace');
  assert.ok(generatedHintsSummary.handoff.primary_action.command.includes('prepare-real-world-building-release-artifact-workspace'), 'generated-hints handoff should prepare release artifact workspace');
  assert.ok(generatedHintsSummary.handoff.release_checklist_required_check_ids.includes('vision_evidence_review'), 'generated-hints handoff should expose required VisionEvidence checklist id');
  assert.ok(generatedHintsSummary.handoff.release_checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'generated-hints handoff should expose failed PhotoGradeReadiness checklist id');
  assert.ok(generatedHintsSummary.handoff.release_checklist_failed_required_check_ids.includes('vision_evidence_review'), 'generated-hints handoff should expose failed VisionEvidence checklist id');
  assert.ok(generatedHintsSummary.handoff.authoritative_artifacts.some((artifact) => artifact.role === 'release_work_order'), 'generated-hints handoff should include release work order as authoritative artifact');
  assert.equal(generatedHintsSummary.handoff.primary_action.artifact_exists, false, 'generated-hints handoff should expose missing primary release workspace artifact state');
  assert.ok(generatedHintsSummary.handoff.authoritative_artifacts.some((artifact) => artifact.role === 'upload_session_summary' && artifact.exists === true), 'generated-hints handoff should expose artifact exists state for upload-session summary');
  assert.ok(generatedHintsSummary.handoff.authoritative_artifacts.some((artifact) => artifact.role === 'release_work_order' && artifact.exists === true), 'generated-hints handoff should expose artifact exists state for release work order');
  assert.equal(generatedHintsSummary.handoff.vision_evidence.available, true, 'generated-hints handoff should expose VisionEvidence availability');
  assertVisionEvidenceWorkspaceInstance(
    generatedHintsSummary.handoff.vision_evidence,
    'rectangular_utility_ducts',
    'generated-hints handoff should preserve duct VisionEvidence semantic instance'
  );
  assertVisionEvidenceModelingHandoff(
    generatedHintsSummary.handoff.vision_evidence,
    'rectangular_utility_ducts',
    'decorative_facade_trim',
    'generated-hints handoff should preserve duct VisionEvidence modeling handoff'
  );
  assert.ok(generatedHintsSummary.workflow.required_user_inputs.includes('release_draft:artifacts'), 'generated-hints workflow should expose release artifact requirement');
  assert.ok(generatedHintsSummary.workflow.required_user_inputs.includes('release_draft:photo_grade_readiness'), 'generated-hints workflow should expose PhotoGradeReadiness requirement');
  assert.ok(generatedHintsSummary.workflow.required_user_inputs.includes('release_draft:vision_evidence_review'), 'generated-hints workflow should expose VisionEvidence review requirement');
  assert.ok(generatedHintsSummary.workflow.commands.prepare_release_sample_from_intake.includes('prepare-real-world-building'), 'generated-hints workflow should include release sample preparation command');
  assert.ok(generatedHintsSummary.workflow.commands.prepare_release_artifact_workspace.includes('prepare-real-world-building-release-artifact-workspace'), 'generated-hints workflow should include release artifact workspace command');
  assert.ok(generatedHintsSummary.workflow.commands.prepare_vision_evidence_review_workbench.includes('make-vision-evidence-review-workbench.mjs'), 'generated-hints workflow should include VisionEvidence review workbench command');
  assert.ok(generatedHintsSummary.workflow.commands.build_vision_evidence_policy_correction_patch.includes('build-vision-evidence-policy-correction-patch.mjs'), 'generated-hints workflow should include VisionEvidence policy correction command');
  assert.ok(generatedHintsSummary.workflow.commands.build_vision_evidence_policy_correction_patch.includes('vision-evidence-review.accepted.json'), 'generated-hints VisionEvidence policy correction command should require accepted review decision');
  assert.ok(generatedHintsSummary.workflow.commands.validate_release_draft.includes('--require-present'), 'generated-hints workflow should include release draft validation command');
  assert.ok(generatedHintsSummary.source_request_response.expected_check_ids.includes('view_source_diversity'), 'generated-hints upload session should expose expected response check ids');
  assert.deepEqual(generatedHintsSummary.source_request_response.missing_expected_check_ids, [], 'generated-hints upload session should expose no missing expected response checks');
  assert.ok(generatedHintsSummary.source_request_response.view_evidence.requested_view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'generated-hints upload session should expose requested view evidence');
  assert.ok(Array.isArray(generatedHintsSummary.source_request_response.semantic_evidence.current_covered_roles), 'generated-hints upload session should expose semantic evidence response summary');
  assert.ok(Array.isArray(generatedHintsSummary.source_request_response.semantic_evidence.role_evidence), 'generated-hints upload session should expose response semantic role evidence');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedHintsSummary.source_request_response.semantic_evidence.evidence_quality.status), 'generated-hints upload session should expose review-gated response semantic evidence quality');
  assert.equal(generatedHintsSummary.source_request_response.semantic_evidence.evidence_quality.geometry_promotion_allowed, false, 'generated-hints response semantic quality should block geometry promotion');
  assert.deepEqual(generatedHintsSummary.source_request_response.unsatisfied_check_ids, [], 'generated-hints upload session should expose empty unsatisfied response check ids');
  assert.deepEqual(generatedHintsSummary.source_request_response.unsatisfied_check_details, [], 'generated-hints upload session should expose empty unsatisfied response check details');
  assert.equal(generatedHintsSummary.intake.source_package.gate_ok, true, 'generated-hints upload session source-package summary should expose passed input gate');
  assert.deepEqual(generatedHintsSummary.intake.source_package.failed_requirements, [], 'generated-hints upload session source-package summary should have no failed input gate requirements');
  assert.equal(generatedHintsSummary.intake.source_package.status, 'input_ready_for_release_work', 'generated-hints upload session source-package summary should expose input-ready status');
  assert.ok(generatedHintsSummary.intake.source_package.view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'generated-hints upload session source-package summary should expose view evidence');
  assert.ok(generatedHintsSummary.intake.source_package.semantic_role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'generated-hints upload session source-package summary should expose semantic role evidence');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedHintsSummary.intake.source_package.semantic_evidence_quality.status), 'generated-hints upload session source-package summary should expose review-gated semantic evidence quality');
  assert.equal(generatedHintsSummary.intake.source_package.semantic_evidence_quality.geometry_promotion_allowed, false, 'generated-hints source-package semantic quality should block geometry promotion');
  assert.ok(generatedHintsSummary.intake.source_package.release_checklist_blockers.includes('artifacts'), 'generated-hints upload session source-package summary should expose release artifact blocker');
  assert.ok(generatedHintsSummary.intake.source_package.blockers.includes('release_photo_grade_readiness'), 'generated-hints upload session source-package summary should expose release checklist blockers');
  assert.equal(generatedHintsSummary.intake.source_package.source_request.status, 'input_ready_for_release_work', 'generated-hints upload session source request should expose input-ready status');
  assert.deepEqual(generatedHintsSummary.intake.source_package.source_request.blocked_until_satisfied, ['formal_release_manifest'], 'generated-hints source request should only block formal manifest');
  assert.deepEqual(generatedHintsSummary.intake.source_package.source_request.upload_package_requirements.missing_required_views, [], 'generated-hints source request should expose no missing upload package views');
  assert.equal(generatedHintsSummary.intake.source_package.source_request.upload_package_requirements.scale_evidence.required, false, 'generated-hints source request should expose satisfied scale evidence requirement');
  assert.ok(generatedHintsSummary.intake.source_package.source_request.upload_package_requirements.next_upload_response_check_ids.includes('view_source_diversity'), 'generated-hints source request should keep view diversity response check explicit');
  assert.equal(generatedHintsSummary.artifacts.source_package_gate_result, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-source-package.gate-result.json', 'generated-hints upload session should expose source-package gate artifact');
  assert.equal(generatedHintsSummary.artifacts.source_request, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-source-request.json', 'generated-hints upload session should expose source request artifact');
  assert.equal(generatedHintsSummary.artifacts.source_request_response, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/source-request-response.json', 'generated-hints upload session should expose source request response artifact');
  assert.equal(generatedHintsSummary.artifacts.source_request_response_markdown, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/source-request-response.md', 'generated-hints upload session should expose source request response markdown artifact');
  assert.equal(generatedHintsSummary.artifacts.upload_session_handoff, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/upload-session-handoff.json', 'generated-hints upload session should expose handoff artifact');
  assert.equal(generatedHintsSummary.artifacts.upload_session_handoff_markdown, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/upload-session-handoff.md', 'generated-hints upload session should expose handoff markdown artifact');
  assert.equal(generatedHintsSummary.artifacts.upload_manifest_template, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/upload-manifest.template.json', 'generated-hints upload session should expose upload manifest template artifact');
  assert.equal(generatedHintsSummary.artifacts.view_hints, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/view-hints.generated.json', 'generated-hints upload session should expose generated view hints');
  assert.equal(generatedHintsSummary.intake.missing_inputs.includes('missing_front_view'), false, 'generated view hints should clear missing front view');
  assert.equal(generatedHintsSummary.intake.missing_inputs.includes('missing_left_view'), false, 'generated view hints should clear missing left view');
  assert.equal(generatedHintsSummary.intake.missing_inputs.includes('missing_top_view'), false, 'generated view hints should clear missing top view');
  assert.equal(generatedHintsSummary.intake.missing_inputs.includes('missing_oblique_view'), false, 'generated view hints should clear missing oblique view');
  assert.equal(generatedHintsSummary.real_world_building_release_draft.validation_status, 'manifest_invalid_release_gap_recorded', 'generated-hints upload session release draft should fail closed with structured status');
  assert.equal(generatedHintsSummary.real_world_building_release_draft.validation_ok, false, 'generated-hints upload session release draft validation should fail closed');
  assert.equal(generatedHintsSummary.real_world_building_release_draft.release_ready, false, 'generated-hints upload session release draft should not be ready');
  assert.equal(generatedHintsSummary.real_world_building_release_draft.can_promote_to_release_manifest, false, 'generated-hints upload session release draft should not be promotable');
  assert.ok(generatedHintsSummary.real_world_building_release_draft.blockers.includes('artifacts'), 'generated-hints upload session release draft should expose artifact blocker');
  assert.ok(generatedHintsSummary.real_world_building_release_draft.blockers.includes('photo_grade_readiness'), 'generated-hints upload session release draft should expose PhotoGradeReadiness blocker');
  assert.equal(generatedHintsSummary.real_world_building_release_draft.work_order_status, 'needs_release_artifacts', 'generated-hints release work order should advance to artifact work');
  assert.ok(generatedHintsSummary.real_world_building_release_draft.work_order_blocked_required_tasks > 0, 'generated-hints release work order should expose blocked required task count');
  assert.ok(generatedHintsSummary.real_world_building_release_draft.checklist_required_check_ids.includes('vision_evidence_review'), 'generated-hints release draft summary should expose required VisionEvidence checklist id');
  assert.ok(generatedHintsSummary.real_world_building_release_draft.checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'generated-hints release draft summary should expose failed PhotoGradeReadiness checklist id');
  assert.ok(generatedHintsSummary.real_world_building_release_draft.checklist_failed_required_check_ids.includes('vision_evidence_review'), 'generated-hints release draft summary should expose failed VisionEvidence checklist id');
  assert.ok(generatedHintsSummary.real_world_building_release_draft.checklist_checks.some((check) => check.id === 'photo_grade_readiness' && check.status === 'fail'), 'generated-hints upload session release draft should summarize failed checklist checks');
  assert.equal(generatedHintsSummary.artifacts.real_world_building_release_manifest_draft, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-release/manifest.draft.json', 'generated-hints upload session should expose release manifest draft artifact');
  assert.equal(generatedHintsSummary.artifacts.real_world_building_release_contract_summary, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-release/manifest-contract-summary.json', 'generated-hints upload session should expose release contract summary artifact');
  assert.equal(generatedHintsSummary.artifacts.real_world_building_release_checklist, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-release/release-checklist.json', 'generated-hints upload session should expose release checklist artifact');
  assert.equal(generatedHintsSummary.artifacts.real_world_building_release_checklist_markdown, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-release/release-checklist.md', 'generated-hints upload session should expose release checklist markdown artifact');
  assert.equal(generatedHintsSummary.artifacts.real_world_building_release_work_order, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-release/release-work-order.json', 'generated-hints upload session should expose release work order artifact');
  assert.equal(generatedHintsSummary.artifacts.real_world_building_release_work_order_markdown, 'output/image-structured-modeler/upload-session-regression/generated-view-hints/intake/real-world-building-release/release-work-order.md', 'generated-hints upload session should expose release work order markdown artifact');
  const generatedUploadSessionMarkdown = await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'upload-session-summary.md'), 'utf8');
  assert.ok(generatedUploadSessionMarkdown.includes('Release Draft'), 'generated-hints upload session markdown should include release draft section');
  assert.ok(generatedUploadSessionMarkdown.includes('Release work order'), 'generated-hints upload session markdown should include release work order path');
  assert.ok(generatedUploadSessionMarkdown.includes('photo_grade_readiness'), 'generated-hints upload session markdown should expose release draft blockers');
  assert.ok(generatedUploadSessionMarkdown.includes('Required checklist checks'), 'generated-hints upload session markdown should expose required checklist checks');
  const generatedHints = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'view-hints.generated.json'), 'utf8'));
  const generatedSourceRequest = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'real-world-building-source-request.json'), 'utf8'));
  const generatedSourceRequestResponse = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'source-request-response.json'), 'utf8'));
  const generatedManifestTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'upload-manifest.template.json'), 'utf8'));
  const generatedReleaseWorkOrder = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'real-world-building-release', 'release-work-order.json'), 'utf8'));
  const generatedReleaseWorkOrderMarkdown = await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'real-world-building-release', 'release-work-order.md'), 'utf8');
  const generatedHandoff = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'upload-session-handoff.json'), 'utf8'));
  const generatedHandoffMarkdown = await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'upload-session-handoff.md'), 'utf8');
  const generatedReleaseArtifactWorkspaceResult = await prepareRealWorldBuildingReleaseArtifactWorkspaceCli({
    uploadSessionSummary: generatedHintsSummary.artifacts.upload_session_summary,
    output: generatedHintsSummary.workflow.release_artifact_workspace,
    generatedAt: '2026-06-17T00:00:00.000Z'
  });
  const generatedReleaseArtifactWorkspaceValidation = await validateRealWorldBuildingReleaseArtifactWorkspaceCli({
    workspace: generatedReleaseArtifactWorkspaceResult.output,
    output: path.join(generatedHintsOutputDir, 'release-artifact-workspace-validation.json'),
    requireReadyToAuthor: true,
    generatedAt: '2026-06-17T00:00:00.000Z'
  });
  const generatedReleaseArtifactWorkspaceMarkdown = await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'release-artifact-workspace.md'), 'utf8');
  const generatedReleaseArtifactWorkspaceValidationMarkdown = await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'release-artifact-workspace-validation.md'), 'utf8');
  assert.equal(generatedHints.kind, 'upload_session_view_hints', 'generated view hints should use stable kind');
  assertValid(validateRealWorldBuildingUploadSessionHandoff, generatedHandoff, 'generated-hints saved upload-session handoff');
  assert.equal(generatedHandoff.status, 'ready_for_release_artifact_work', 'generated-hints saved handoff should route to release artifact work');
  assert.equal(generatedHandoff.primary_action.artifact, generatedHintsSummary.workflow.release_artifact_workspace, 'generated-hints saved handoff should point primary action at workspace');
  assert.equal(generatedHandoff.primary_action.artifact_exists, false, 'generated-hints saved handoff should preserve missing primary release workspace artifact state');
  assert.ok(generatedHandoff.release_checklist_required_check_ids.includes('vision_evidence_review'), 'generated-hints saved handoff should preserve required VisionEvidence checklist id');
  assert.ok(generatedHandoff.release_checklist_failed_required_check_ids.includes('vision_evidence_review'), 'generated-hints saved handoff should preserve failed VisionEvidence checklist id');
  assert.ok(generatedHandoff.authoritative_artifacts.some((artifact) => artifact.role === 'upload_session_handoff' && artifact.exists === true), 'generated-hints saved handoff should expose artifact exists state for handoff file');
  assert.ok(generatedHandoff.authoritative_artifacts.some((artifact) => artifact.role === 'release_work_order' && artifact.exists === true), 'generated-hints saved handoff should expose artifact exists state for release work order');
  assert.equal(generatedHandoff.vision_evidence.available, true, 'generated-hints saved handoff should preserve VisionEvidence availability');
  assertVisionEvidenceWorkspaceInstance(
    generatedHandoff.vision_evidence,
    'rectangular_utility_ducts',
    'generated-hints saved handoff should preserve duct VisionEvidence semantic instance'
  );
  assertVisionEvidenceModelingHandoff(
    generatedHandoff.vision_evidence,
    'rectangular_utility_ducts',
    'decorative_facade_trim',
    'generated-hints saved handoff should preserve duct VisionEvidence modeling handoff'
  );
  assertVisionEvidenceModelingHandoff(
    generatedHandoff.vision_evidence,
    'shadow_or_recess_boundary',
    'cut_recess_from_shadow_only',
    'generated-hints saved handoff should preserve shadow/recess VisionEvidence modeling handoff'
  );
  assert.ok(generatedHandoffMarkdown.includes('Real-World Building Upload Session Handoff'), 'generated-hints handoff markdown should include title');
  assert.ok(generatedHandoffMarkdown.includes('Required checklist checks'), 'generated-hints handoff markdown should expose required checklist checks');
  assert.ok(generatedHandoffMarkdown.includes('## VisionEvidence Handoff'), 'generated-hints handoff markdown should expose VisionEvidence handoff section');
  assert.ok(generatedHandoffMarkdown.includes('decorative_facade_trim'), 'generated-hints handoff markdown should preserve VisionEvidence blocked interpretation');
  assert.ok(generatedHandoffMarkdown.includes('Artifact exists'), 'generated-hints handoff markdown should expose primary artifact exists state');
  assert.ok(generatedHandoffMarkdown.includes('exists=`true`'), 'generated-hints handoff markdown should expose authoritative artifact exists state');
  assertValid(validateRealWorldBuildingReleaseWorkOrder, generatedReleaseWorkOrder, 'generated-hints saved release work order');
  assert.equal(generatedReleaseWorkOrder.status, 'needs_release_artifacts', 'generated-hints saved release work order should request artifact work');
  assert.equal(generatedReleaseWorkOrder.artifact_authoring_policy.direct_sketchup_dsl_allowed, false, 'generated-hints release work order should forbid direct SketchUp DSL authoring');
  assert.ok(
    generatedReleaseWorkOrder.artifact_authoring_policy.required_contract_artifacts.includes('release-artifact-workspace.json'),
    'generated-hints release work order should point artifact authors to release artifact workspace'
  );
  assert.ok(generatedReleaseWorkOrder.tasks.some((task) => task.id === 'compiled_output' && task.command.includes('compile-part-graph-to-sketchup-dsl')), 'generated-hints saved release work order should include compile command');
  const generatedReleaseVisionReviewTask = generatedReleaseWorkOrder.tasks.find((task) => task.id === 'vision_evidence_review');
  assert.ok(generatedReleaseVisionReviewTask.command.includes('build-vision-evidence-policy-correction-patch.mjs'), 'generated-hints release work order should expose VisionEvidence policy correction command');
  assert.ok(generatedReleaseVisionReviewTask.artifacts.some((artifact) => artifact.role === 'vision_evidence_review_decision'), 'generated-hints release work order should expose VisionEvidence review decision artifact');
  assert.ok(generatedReleaseVisionReviewTask.artifacts.some((artifact) => artifact.role === 'vision_evidence_policy_correction_patch'), 'generated-hints release work order should expose VisionEvidence policy correction artifact');
  assert.ok(generatedReleaseWorkOrderMarkdown.includes('Real-World Building Release Work Order'), 'generated-hints saved release work order markdown should include title');
  assert.ok(generatedReleaseWorkOrderMarkdown.includes('Artifact Authoring Policy'), 'generated-hints saved release work order markdown should expose artifact authoring policy');
  assert.equal(generatedReleaseArtifactWorkspaceResult.status, 'ready_for_artifact_authoring', 'generated-hints release artifact workspace should route to artifact authoring');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspace, generatedReleaseArtifactWorkspaceResult.workspace, 'generated-hints release artifact workspace');
  assert.equal(
    generatedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'vision_evidence_policy_commands_present')?.status,
    'pass',
    'generated-hints workspace validation should verify VisionEvidence policy command integrity'
  );
  assert.equal(generatedReleaseArtifactWorkspaceValidation.ok, true, 'generated-hints workspace validation should pass ready-to-author contract checks');
  assert.equal(generatedReleaseArtifactWorkspaceValidation.status, 'ready_to_author_validated', 'generated-hints workspace validation should report ready-to-author validation');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspaceValidation, generatedReleaseArtifactWorkspaceValidation.report, 'generated-hints release artifact workspace validation report');
  assert.deepEqual(generatedReleaseArtifactWorkspaceValidation.report.summary.failed_required_checks, [], 'generated-hints workspace validation should have no failed required checks');
  assert.equal(
    generatedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'release_checklist_required_summary_exposed')?.status,
    'pass',
    'generated-hints workspace validation should verify release checklist required summary'
  );
  assert.equal(
    generatedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'release_checklist_summary_propagated_to_mcp_tasks')?.status,
    'pass',
    'generated-hints workspace validation should verify release checklist summary propagation to MCP tasks'
  );
  assert.equal(
    generatedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'semantic_evidence_quality_propagated')?.status,
    'pass',
    'generated-hints workspace validation should verify semantic evidence quality propagation'
  );
  assert.equal(
    generatedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'vision_evidence_instances_propagated')?.status,
    'pass',
    'generated-hints workspace validation should verify VisionEvidence semantic instance propagation'
  );
  assert.equal(
    generatedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'vision_evidence_modeling_handoff_propagated')?.status,
    'pass',
    'generated-hints workspace validation should verify VisionEvidence modeling handoff propagation'
  );
  assert.equal(
    generatedReleaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'task_packet_mcp_authoring_handoff_present')?.status,
    'pass',
    'generated-hints workspace validation should verify MCP authoring handoff propagation'
  );
  assert.deepEqual(generatedReleaseArtifactWorkspaceResult.workspace.required_artifacts.map((artifact) => artifact.role), ['part_graph', 'output', 'photo_grade_readiness_report'], 'generated-hints release artifact workspace should list required artifact roles');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.required_artifacts.every((artifact) => artifact.status === 'missing'), 'generated-hints workspace should keep missing release artifacts visible');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.release_checklist_required_check_ids.includes('vision_evidence_review'), 'generated-hints workspace should expose required VisionEvidence checklist id');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.release_checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'generated-hints workspace should expose failed PhotoGradeReadiness checklist id');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.release_checklist_failed_required_check_ids.includes('vision_evidence_review'), 'generated-hints workspace should expose failed VisionEvidence checklist id');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.review_requirements.some((requirement) => requirement.id === 'vision_evidence_review'), 'generated-hints workspace should expose VisionEvidence review requirement');
  const generatedWorkspaceVisionReviewRequirement = generatedReleaseArtifactWorkspaceResult.workspace.review_requirements.find((requirement) => requirement.id === 'vision_evidence_review');
  assert.ok(generatedWorkspaceVisionReviewRequirement.artifacts.some((artifact) => artifact.role === 'vision_evidence_review_decision' && artifact.exists === false), 'generated-hints workspace should expose missing VisionEvidence accepted decision');
  assert.ok(generatedWorkspaceVisionReviewRequirement.artifacts.some((artifact) => artifact.role === 'vision_evidence_policy_correction_patch' && artifact.exists === false), 'generated-hints workspace should expose missing VisionEvidence policy correction patch');
  assert.ok(generatedWorkspaceVisionReviewRequirement.command.includes('build-vision-evidence-policy-correction-patch.mjs'), 'generated-hints workspace VisionEvidence requirement should expose policy correction command');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.commands.build_vision_evidence_policy_correction_patch.includes('build-vision-evidence-policy-correction-patch.mjs'), 'generated-hints workspace commands should expose policy correction command');
  assert.deepEqual(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.map((packet) => packet.artifact_role), ['part_graph', 'output', 'photo_grade_readiness_report'], 'generated-hints workspace should expose release artifact task packets');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.status === 'ready_to_author' && packet.ready_to_author === true), 'generated-hints workspace task packets should be ready to author');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.input_artifacts.some((artifact) => artifact.role === 'mcp_modeling_brief')), 'generated-hints workspace task packets should point to MCP brief input');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff.kind === 'mcp_authoring_handoff'), 'generated-hints workspace task packets should expose MCP authoring handoff');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff.prompt_text.includes('VisionEvidence')), 'generated-hints workspace MCP authoring handoff should include VisionEvidence prompt context');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff.prompt_text.includes('VisionEvidence review workbench')), 'generated-hints workspace MCP authoring handoff should point to VisionEvidence review workbench');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff.evidence_digest.vision_evidence_review_workbench.endsWith('vision-evidence-review/index.html')), 'generated-hints workspace MCP authoring handoff should expose VisionEvidence workbench path');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff.evidence_digest.blocked_outputs.includes('direct_sketchup_dsl')), 'generated-hints workspace MCP authoring handoff should preserve direct DSL block');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff.evidence_digest.blocked_interpretations.includes('decorative_facade_trim')), 'generated-hints workspace MCP authoring handoff should preserve duct blocked interpretation');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_constraints.blocked_outputs.includes('direct_sketchup_dsl')), 'generated-hints workspace task packets should inherit direct DSL block');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => ['weak_review_required', 'review_required'].includes(packet.mcp_constraints.semantic_evidence_quality.status)), 'generated-hints workspace task packets should inherit semantic evidence quality');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_constraints.semantic_evidence_quality.geometry_promotion_allowed === false), 'generated-hints workspace task packets semantic quality should block geometry promotion');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.release_checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'generated-hints workspace MCP handoff should expose failed PhotoGradeReadiness checklist id');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_constraints.release_checklist_failed_required_check_ids.includes('vision_evidence_review')), 'generated-hints workspace task packets should inherit failed VisionEvidence checklist id');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.some((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'preserve_candidate_disambiguation')), 'generated-hints workspace task packets should require candidate disambiguation preservation');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'preserve_semantic_evidence_quality' && criterion.status === 'satisfied')), 'generated-hints workspace task packets should require semantic evidence quality preservation');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'use_vision_evidence_review_patch' && criterion.status === 'satisfied')), 'generated-hints workspace task packets should require VisionEvidence review patch use');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'use_vision_evidence_instances' && criterion.status === 'satisfied')), 'generated-hints workspace task packets should require VisionEvidence semantic instances');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'use_vision_evidence_modeling_handoff' && criterion.status === 'satisfied')), 'generated-hints workspace task packets should require VisionEvidence modeling handoff');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'address_failed_required_release_checks')), 'generated-hints workspace task packets should require failed release checklist handling');
  assert.equal(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.vision_evidence.available, true, 'generated-hints workspace MCP handoff should expose VisionEvidence availability');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.vision_evidence.semantic_review_roles.includes('rectangular_utility_ducts'), 'generated-hints workspace MCP handoff should expose duct VisionEvidence role');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_constraints.vision_evidence.review_patch_artifact.endsWith('vision-evidence-review-patch.json')), 'generated-hints workspace task packets should inherit VisionEvidence review patch artifact');
  assertVisionEvidenceWorkspaceInstance(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.vision_evidence, 'visible_plane_recessed_left', 'generated-hints workspace MCP handoff should locate recessed visible plane evidence');
  assertVisionEvidenceWorkspaceInstance(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.vision_evidence, 'rectangular_utility_ducts', 'generated-hints workspace MCP handoff should locate duct evidence');
  assertVisionEvidenceModelingHandoff(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.vision_evidence, 'rectangular_utility_ducts', 'decorative_facade_trim', 'generated-hints workspace MCP handoff should expose duct VisionEvidence modeling handoff');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => hasVisionEvidenceWorkspaceInstance(packet.mcp_constraints.vision_evidence, 'shadow_or_recess_boundary')), 'generated-hints workspace task packets should locate shadow/recess evidence');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => hasVisionEvidenceModelingHandoff(packet.mcp_constraints.vision_evidence, 'shadow_or_recess_boundary', 'cut_recess_from_shadow_only')), 'generated-hints workspace task packets should expose shadow VisionEvidence modeling handoff');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.some((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'source_provenance_alignment')), 'generated-hints workspace PartGraph task packet should require source provenance alignment');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.task_packets.some((packet) => packet.verification_commands.some((command) => command.includes('validate-real-world-building'))), 'generated-hints workspace task packets should expose validation command');
  assert.equal(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.can_generate_sketchup_dsl, false, 'generated-hints workspace MCP handoff should remain fail-closed for direct DSL');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.blocked_outputs.includes('direct_sketchup_dsl'), 'generated-hints workspace MCP handoff should expose blocked direct DSL');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.semantic_evidence_quality.status), 'generated-hints workspace MCP handoff should expose semantic evidence quality');
  assert.equal(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.semantic_evidence_quality.geometry_promotion_allowed, false, 'generated-hints workspace MCP handoff semantic quality should block geometry promotion');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.disambiguation_roles.includes('visible_plane_recessed_left'), 'generated-hints workspace MCP handoff should expose recessed facade disambiguation role');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.blocked_interpretations.includes('merged_front_facade_plane'), 'generated-hints workspace MCP handoff should block merged facade interpretation');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.blocked_interpretations.includes('decorative_facade_trim'), 'generated-hints workspace MCP handoff should block duct trim interpretation');
  assert.ok(generatedReleaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff.blocked_interpretations.includes('cut_recess_from_shadow_only'), 'generated-hints workspace MCP handoff should block shadow-only recess cuts');
  assert.ok(generatedReleaseArtifactWorkspaceMarkdown.includes('Required Artifacts'), 'generated-hints workspace markdown should include required artifact section');
  assert.ok(generatedReleaseArtifactWorkspaceMarkdown.includes('MCP Modeling Handoff'), 'generated-hints workspace markdown should include MCP handoff section');
  assert.ok(generatedReleaseArtifactWorkspaceMarkdown.includes('Task Packets'), 'generated-hints workspace markdown should include task packet section');
  assert.ok(generatedReleaseArtifactWorkspaceMarkdown.includes('merged_front_facade_plane'), 'generated-hints workspace markdown should expose MCP blocked interpretation');
  assert.ok(generatedReleaseArtifactWorkspaceValidationMarkdown.includes('Release Artifact Workspace Validation'), 'generated-hints workspace validation markdown should include title');
  assertValid(validateRealWorldBuildingSourceRequest, generatedSourceRequest, 'generated-hints saved source request');
  assertValid(validateRealWorldBuildingSourceRequestResponse, generatedSourceRequestResponse, 'generated-hints saved source request response');
  assertValid(validateRealWorldBuildingUploadManifest, generatedManifestTemplate, 'generated-hints saved upload manifest template');
  assert.equal(generatedSourceRequest.status, 'input_ready_for_release_work', 'generated-hints saved source request should preserve input-ready status');
  assert.equal(generatedSourceRequest.view_source_requirements.distinct_source_images_required, true, 'generated-hints saved source request should preserve distinct source-image rule');
  assert.equal(generatedSourceRequest.view_source_requirements.blocker, 'view_sources_not_distinct', 'generated-hints saved source request should preserve view source blocker');
  assert.equal(generatedSourceRequestResponse.status, 'satisfied_for_release_work', 'generated-hints saved source request response should be satisfied');
  assert.ok(generatedSourceRequestResponse.summary.expected_check_ids.includes('view_source_diversity'), 'generated-hints saved source request response should expose expected source-request check ids');
  assert.deepEqual(generatedSourceRequestResponse.summary.missing_expected_check_ids, [], 'generated-hints saved source request response should not miss expected checks');
  assert.deepEqual(generatedSourceRequestResponse.summary.unexpected_requested_check_ids, [], 'generated-hints saved source request response should not add unexpected requested checks');
  assert.ok(generatedSourceRequestResponse.summary.view_evidence.requested_view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'generated-hints saved source request response should expose requested view evidence');
  assert.ok(Array.isArray(generatedSourceRequestResponse.summary.semantic_evidence.current_covered_roles), 'generated-hints saved source request response should expose semantic evidence summary');
  assert.ok(generatedSourceRequestResponse.summary.semantic_evidence.role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'generated-hints saved source request response should expose semantic role evidence');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedSourceRequestResponse.summary.semantic_evidence.evidence_quality.status), 'generated-hints saved source request response should expose review-gated semantic evidence quality');
  assert.equal(generatedSourceRequestResponse.summary.semantic_evidence.evidence_quality.geometry_promotion_allowed, false, 'generated-hints saved source request response semantic quality should block geometry promotion');
  assert.ok(generatedSourceRequestResponse.summary.requested_check_ids.includes('view_source_diversity'), 'generated-hints saved source request response should expose requested check ids');
  assert.deepEqual(generatedSourceRequestResponse.summary.unsatisfied_check_ids, [], 'generated-hints saved source request response should expose empty unsatisfied check ids');
  assert.equal(generatedSourceRequestResponse.checks.find((check) => check.id === 'view_source_diversity').satisfied, true, 'generated-hints source request response should pass view source diversity check');
  assert.ok((await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'upload-session-summary.md'), 'utf8')).includes('Unsatisfied check ids'), 'generated-hints upload-session markdown should expose response check id summary');
  assert.ok((await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'source-request-response.md'), 'utf8')).includes('Real-World Building Source Request Response'), 'generated-hints source-request response markdown should include title');
  assert.equal(generatedManifestTemplate.template_only, true, 'generated-hints saved upload manifest template should be template-only');
  assert.equal(generatedManifestTemplate.view_source_requirements.blocker, 'view_sources_not_distinct', 'generated-hints saved upload manifest template should preserve view source blocker');
  assert.deepEqual(
    Array.from(new Set(generatedHints.views.map((view) => view.kind))).sort(),
    ['front', 'left', 'oblique', 'top'],
    'generated view hints should include required building-single views'
  );
  const generatedPreflight = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'preflight', 'preflight.json'), 'utf8'));
  assert.equal(generatedPreflight.source_content.status, 'pass', 'generated view hints preflight should pass source content diversity');
  assert.equal(
    generatedPreflight.view_package.sources.every((source) => source.source === 'upload_manifest'),
    true,
    'generated view hints upload-session preflight should use upload manifest view labels'
  );
  const generatedObservations = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'observations.json'), 'utf8'));
  assert.equal(generatedObservations.scale_calibration.strategy, 'source_metadata_known_dimensions_with_view_bbox', 'upload manifest dimensions should drive intake scale calibration');
  assert.equal(generatedObservations.scale_calibration.source_metadata_hints.length > 0, true, 'intake observations should retain source metadata scale hints');
  const generatedMcpBrief = JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'mcp-modeling-brief.json'), 'utf8'));
  assert.equal(generatedMcpBrief.evidence_summary.scale_strategy, 'source_metadata_known_dimensions_with_view_bbox', 'MCP brief should expose upload-manifest scale strategy');
  assert.equal(generatedMcpBrief.evidence_summary.scale_source_metadata_hints.length > 0, true, 'MCP brief should retain upload-manifest scale hints');
  assert.equal(generatedMcpBrief.source_request_response_gate.status, 'satisfied_for_release_work', 'MCP brief should carry satisfied source-request response gate');
  assert.ok(generatedMcpBrief.source_request_response_gate.expected_check_ids.includes('view_source_diversity'), 'MCP brief should expose expected source-request response check ids');
  assert.deepEqual(generatedMcpBrief.source_request_response_gate.missing_expected_check_ids, [], 'MCP brief should expose no missing expected response checks');
  assert.ok(generatedMcpBrief.source_request_response_gate.view_evidence.requested_view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'MCP brief should expose source-request response requested view evidence');
  assert.ok(Array.isArray(generatedMcpBrief.source_request_response_gate.semantic_evidence.current_covered_roles), 'MCP brief should expose source-request response semantic evidence summary');
  assert.ok(generatedMcpBrief.source_request_response_gate.semantic_evidence.role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'MCP brief should expose source-request response semantic role evidence');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedMcpBrief.source_request_response_gate.semantic_evidence.evidence_quality.status), 'MCP brief should expose response semantic evidence quality');
  assert.equal(generatedMcpBrief.source_request_response_gate.semantic_evidence.evidence_quality.geometry_promotion_allowed, false, 'MCP brief response semantic quality should block geometry promotion');
  assert.deepEqual(generatedMcpBrief.source_request_response_gate.unsatisfied_check_ids, [], 'MCP brief should expose no unsatisfied response checks for satisfied upload');
  assert.ok(generatedMcpBrief.source_package_gate.view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'MCP brief source package gate should expose view evidence');
  assert.ok(generatedMcpBrief.source_package_gate.semantic_role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'MCP brief source package gate should expose semantic role evidence');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedMcpBrief.source_package_gate.semantic_evidence_quality.status), 'MCP brief source package gate should expose semantic evidence quality');
  assert.equal(generatedMcpBrief.source_package_gate.semantic_evidence_quality.geometry_promotion_allowed, false, 'MCP brief source package semantic quality should block geometry promotion');
  assert.ok(generatedMcpBrief.source_package_gate.release_checklist_required_check_ids.includes('vision_evidence_review'), 'MCP brief must expose required release checklist id');
  assert.ok(generatedMcpBrief.source_package_gate.release_checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'MCP brief must expose failed required release checklist id');
  assert.ok(generatedMcpBrief.agent_contract.output_policy.release_checklist_failed_required_check_ids.includes('vision_evidence_review'), 'MCP brief agent contract must expose failed required release checklist id');
  assert.ok(generatedMcpBrief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'source_request_response'), 'MCP brief should list source-request response artifact after response validation');
  const generatedReviewWorkbench = await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'review', 'index.html'), 'utf8');
  const generatedEmbeddedMcpBrief = readEmbeddedJson(generatedReviewWorkbench, 'mcp-modeling-brief-data');
  assertValid(validateMcpModelingBrief, generatedEmbeddedMcpBrief, 'generated-hints embedded MCP brief JSON');
  assert.equal(generatedEmbeddedMcpBrief.source_request_response_gate.status, 'satisfied_for_release_work', 'generated-hints review workbench should embed response-aware MCP brief');
  assert.ok(generatedReviewWorkbench.includes('source_request_response=satisfied_for_release_work'), 'generated-hints review workbench should render response gate status');
  const generatedMcpRiskIds = generatedMcpBrief.grounding_risk_register.map((risk) => risk.id);
  assert.equal(generatedMcpRiskIds.includes('missing_view_top'), false, 'generated-hints MCP risk register should clear missing top view risk');
  assert.equal(generatedMcpRiskIds.includes('scale_confidence_below_publish_gate'), false, 'generated-hints MCP risk register should clear scale risk');
  assert.ok(generatedMcpRiskIds.includes('direct_sketchup_dsl_blocked'), 'generated-hints MCP risk register should still block direct DSL until promotion/compiler gates');
  assert.ok(generatedMcpRiskIds.includes('release_artifacts'), 'generated-hints MCP risk register should preserve release artifact blocker');
  assert.ok(generatedMcpRiskIds.includes('release_photo_grade_readiness'), 'generated-hints MCP risk register should preserve PhotoGradeReadiness blocker');
  assertValid(
    validateRealWorldBuildingManifest,
    JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'real-world-building-release', 'manifest.draft.json'), 'utf8')),
    'generated-hints upload-session release manifest draft'
  );
  assertValid(
    validateRealWorldBuildingChecklist,
    JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'real-world-building-release', 'release-checklist.json'), 'utf8')),
    'generated-hints upload-session release checklist'
  );
  assertValid(
    validateRealWorldBuildingSourcePackageGateResult,
    JSON.parse(await fs.readFile(path.join(repoRoot, generatedHintsOutputDir, 'intake', 'real-world-building-source-package.gate-result.json'), 'utf8')),
    'generated-hints upload-session source-package gate result'
  );

  const uploadSingleSourceMultiViewDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'upload-session-regression', 'single-source-multiview-source');
  await fs.rm(uploadSingleSourceMultiViewDir, { recursive: true, force: true });
  await fs.mkdir(uploadSingleSourceMultiViewDir, { recursive: true });
  await fs.copyFile(sourceImage, path.join(uploadSingleSourceMultiViewDir, 'one-photo.png'));
  await fs.writeFile(path.join(uploadSingleSourceMultiViewDir, 'manifest.json'), `${JSON.stringify({
    version: 1,
    kind: 'real_world_building_upload_manifest',
    object_type: 'building_single',
    views: [
      { source_image: 'one-photo.png', kind: 'front' },
      { source_image: 'one-photo.png', kind: 'left' },
      { source_image: 'one-photo.png', kind: 'oblique' },
      { source_image: 'one-photo.png', kind: 'top' }
    ]
  }, null, 2)}\n`, 'utf8');
  const uploadSingleSourceMultiViewOutputDir = 'output/image-structured-modeler/upload-session-regression/single-source-multiview';
  const uploadSingleSourceMultiViewSummary = await runRealWorldBuildingUploadSession({
    input: 'output/image-structured-modeler/upload-session-regression/single-source-multiview-source',
    objectType: 'building_single',
    objectName: 'Upload Session Single Source Multiview Regression',
    outputDir: uploadSingleSourceMultiViewOutputDir,
    writeOverlays: false,
    requirePreflightReleaseSourceCandidate: true
  });
  assertValid(validateRealWorldBuildingUploadSession, uploadSingleSourceMultiViewSummary, 'single-source multiview upload-session summary');
  assert.equal(uploadSingleSourceMultiViewSummary.ok, false, 'single-source multiview upload session should fail requested preflight gate');
  assert.equal(uploadSingleSourceMultiViewSummary.status, 'blocked_preflight', 'single-source multiview upload session should expose preflight block');
  assert.equal(uploadSingleSourceMultiViewSummary.preflight.status, 'blocked_source_assets', 'single-source multiview upload session should block source assets');
  assert.equal(uploadSingleSourceMultiViewSummary.preflight.blockers.includes('view_sources_not_distinct'), true, 'single-source multiview upload session should expose view source blocker');
  assert.equal(uploadSingleSourceMultiViewSummary.preflight.view_source_diversity.status, 'fail', 'single-source multiview upload session should expose view source diversity failure');
  assert.equal(uploadSingleSourceMultiViewSummary.workflow.stage, 'source_refill_required', 'single-source multiview workflow should require source refill');
  assert.equal(uploadSingleSourceMultiViewSummary.workflow.can_continue_without_new_upload, false, 'single-source multiview workflow should require new upload sources');
  assert.ok(uploadSingleSourceMultiViewSummary.workflow.required_user_inputs.includes('view_sources_not_distinct'), 'single-source multiview workflow should expose distinct source-image requirement');
  assert.equal(uploadSingleSourceMultiViewSummary.artifacts.view_hints, null, 'single-source multiview upload session should not generate view hints from conflicted labels');
  assert.equal(
    await pathExists(path.join(repoRoot, uploadSingleSourceMultiViewOutputDir, 'view-hints.generated.json')),
    false,
    'single-source multiview upload session should not write generated view hints'
  );

  const invalidManifestSourceDir = path.join(repoRoot, 'output', 'image-structured-modeler', 'upload-session-regression', 'invalid-manifest-source');
  await fs.rm(invalidManifestSourceDir, { recursive: true, force: true });
  await fs.mkdir(invalidManifestSourceDir, { recursive: true });
  for (const name of ['photo-a.png', 'photo-b.png', 'photo-c.png', 'photo-d.png']) {
    await fs.copyFile(sourceImage, path.join(invalidManifestSourceDir, name));
  }
  await fs.writeFile(path.join(invalidManifestSourceDir, 'manifest.json'), `${JSON.stringify({
    version: 1,
    kind: 'real_world_building_upload_manifest',
    object_type: 'building_single',
    views: [
      { source_image: 'photo-a.png', kind: 'facade' }
    ]
  }, null, 2)}\n`, 'utf8');
  const invalidManifestOutputDir = 'output/image-structured-modeler/upload-session-regression/invalid-manifest';
  const invalidManifestSummary = await runRealWorldBuildingUploadSession({
    input: 'output/image-structured-modeler/upload-session-regression/invalid-manifest-source',
    objectType: 'building_single',
    objectName: 'Upload Session Invalid Manifest Regression',
    outputDir: invalidManifestOutputDir,
    writeOverlays: false,
    requirePreflightReleaseSourceCandidate: true,
    requireSourceInputReady: true
  });
  assertValid(validateRealWorldBuildingUploadSession, invalidManifestSummary, 'invalid-manifest upload-session summary');
  assert.equal(invalidManifestSummary.ok, false, 'invalid-manifest upload session should fail requested gates');
  assert.equal(invalidManifestSummary.status, 'blocked_preflight', 'invalid-manifest upload session should expose preflight block');
  assert.equal(invalidManifestSummary.preflight.status, 'blocked_source_metadata', 'invalid-manifest upload session should expose metadata preflight status');
  assert.equal(invalidManifestSummary.preflight.blockers.includes('invalid_source_metadata'), true, 'invalid-manifest upload session should expose metadata blocker in summary');
  assert.equal(invalidManifestSummary.preflight.metadata_files[0].status, 'invalid_contract', 'invalid-manifest upload session should record invalid_contract metadata status');
  assert.equal(invalidManifestSummary.preflight.metadata_files[0].errors.some((error) => error.includes('views[0].kind')), true, 'invalid-manifest upload session should preserve metadata contract errors');
  assert.equal(invalidManifestSummary.workflow.stage, 'source_refill_required', 'invalid-manifest workflow should require source refill');
  assert.ok(invalidManifestSummary.workflow.required_user_inputs.includes('invalid_source_metadata'), 'invalid-manifest workflow should expose metadata blocker');
  assert.equal(invalidManifestSummary.artifacts.view_hints, null, 'invalid upload manifest should not produce generated view hints');
  assert.ok((await fs.readFile(path.join(repoRoot, invalidManifestOutputDir, 'upload-session-summary.md'), 'utf8')).includes('invalid_contract'), 'invalid-manifest upload session markdown should expose metadata contract failure');
  assertValid(
    validateRealWorldBuildingUploadSession,
    JSON.parse(await fs.readFile(path.join(repoRoot, invalidManifestOutputDir, 'upload-session-summary.json'), 'utf8')),
    'saved invalid-manifest upload-session summary'
  );
}

async function assertStructuredAssetIntakeFailClosed() {
  const input = 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png';
  const unknown = await buildStructuredAssetIntake({
    input,
    objectName: 'Unknown Intake Regression',
    outputDir: 'output/image-structured-modeler/intake-unknown-regression',
    writeOverlays: false
  });
  assertValid(validateAssetSet, unknown.assetSet, 'unknown intake asset-set.json');
  assertValid(validateImageSetObservation, unknown.observationSet, 'unknown intake observations.json');
  assertValid(validateCandidateGraph, unknown.candidateGraph, 'unknown intake candidate-graph.json');
  assertValid(validateModelingBrief, unknown.modelingBrief, 'unknown intake modeling-brief.json');
  assertValid(validateMcpModelingBrief, unknown.mcpModelingBrief, 'unknown intake mcp-modeling-brief.json');
  assertValid(validateStructuredAssetIntakeSummary, unknown.intakeSummary, 'unknown intake summary');
  assertValid(validateStructureEvidenceGraph, unknown.structureEvidenceGraph, 'unknown intake structure-evidence-graph.json');
  assertValid(validateDraftViewGraph, unknown.draftViewGraph, 'unknown intake draft-view-graph.json');
  assertValid(validateObjectSurfaceGraph, unknown.objectSurfaceGraph, 'unknown intake object-surface-graph.json');
  assertValid(validateCandidatePromotionReview, unknown.promotionReview, 'unknown intake candidate-promotion-review.draft.json');
  assertValid(validateCandidatePromotionPatch, unknown.promotionPatch, 'unknown intake candidate-promotion-patch.blocked.json');
  assert.equal(unknown.sourcePackageAssessment, null, 'unknown intake should not emit building source-package assessment');
  assert.equal(unknown.observationSet.object.profile, 'unknown_object', 'unrouted intake must not default to Switch');
  assert.equal(unknown.assetSet.profile_routing.status, 'needs_profile', 'unknown intake should require profile routing');
  assert.equal(unknown.assetSet.gates.can_compile_geometry, false, 'unknown intake should fail closed before geometry compile');
  assert.ok(unknown.assetSet.gates.reasons.includes('unknown_profile'), 'unknown intake should record the unknown profile blocker');
  assert.equal(unknown.modelingBrief.status, 'blocked', 'unknown intake modeling brief should be blocked');
  assert.equal(unknown.modelingBrief.compile_allowed, false, 'unknown intake modeling brief should never allow compile');
	  assert.equal(unknown.mcpModelingBrief.compile_permission.can_generate_sketchup_dsl, false, 'unknown intake MCP brief should forbid direct DSL');
	  assert.ok(unknown.mcpModelingBrief.compile_permission.reasons.includes('unknown_profile'), 'unknown intake MCP brief should expose profile blocker');
	  assert.equal(unknown.mcpModelingBrief.source_package_gate, null, 'unknown intake MCP brief should not claim a building source-package gate');
  assert.equal(unknown.mcpModelingBrief.agent_contract.output_policy.sketchup_dsl_allowed, false, 'unknown intake MCP agent contract should forbid SketchUp DSL');
  assert.ok(unknown.mcpModelingBrief.agent_contract.output_policy.blocked_outputs.includes('direct_sketchup_dsl'), 'unknown intake MCP agent contract should list direct DSL as blocked output');
  assert.ok(unknown.mcpModelingBrief.agent_contract.evidence_rules.some((rule) => rule.includes('only authoritative inputs')), 'unknown intake MCP agent contract should define authoritative input rule');
	  assert.equal(unknown.intakeSummary.ok, true, 'unknown intake summary should remain an audit artifact without source-package hard gate');
  assert.equal(unknown.intakeSummary.gates.source_package, null, 'unknown intake summary should not claim a building source-package gate');
  assert.equal(unknown.promotionReview.verdict, 'blocked', 'unknown promotion review should stay blocked');
  assert.equal(unknown.promotionReview.promotion_allowed, false, 'unknown promotion review should not allow promotion');
  assert.equal(unknown.promotionReview.compile_allowed, false, 'unknown promotion review should not allow direct compile');
  assert.equal(unknown.promotionReview.accepted_candidates.length, 0, 'draft promotion review should start with no accepted candidates');
  assert.equal(unknown.promotionPatch.status, 'blocked', 'unknown promotion patch should be blocked');
  assert.equal(unknown.promotionPatch.apply_allowed, false, 'unknown promotion patch should not be applyable');
  assert.equal(unknown.promotionPatch.compile_allowed, false, 'unknown promotion patch should not allow direct compile');
  assert.equal(unknown.promotionPatch.actions.length, 0, 'blocked unknown promotion patch should not contain actions');
  assert.deepEqual(unknown.draftViewGraph.view_slots.map((slot) => slot.slot_id), ['front', 'left_or_right_side', 'top', 'oblique_context'], 'unknown intake DraftViewGraph must expose fixed view slots');
  assert.equal(unknown.draftViewGraph.view_slots.every((slot) => slot.promotion_allowed === false), true, 'unknown intake draft slots must start promotion-blocked');
  assert.equal(unknown.draftViewGraph.review_policy.promotion_allowed, false, 'unknown intake DraftViewGraph must fail closed');
  assert.equal(unknown.objectSurfaceGraph.review_policy.promotion_allowed, false, 'unknown intake ObjectSurfaceGraph must fail closed');
  assert.ok(unknown.candidateGraph.candidates.length > 0, 'unknown intake should still surface review candidates');
  assert.ok(unknown.candidateGraph.candidates.every((candidate) => candidate.promotion.blockers.includes('unknown_profile')), 'unknown candidates should be blocked by profile routing');
  const unknownDraft = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'candidate-promotion-review.draft.json'), 'utf8'));
  assertValid(validateCandidatePromotionReview, unknownDraft, 'unknown intake saved candidate-promotion-review.draft.json');
  const unknownPatch = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'candidate-promotion-patch.blocked.json'), 'utf8'));
  assertValid(validateCandidatePromotionPatch, unknownPatch, 'unknown intake saved candidate-promotion-patch.blocked.json');
  const unknownMcpBrief = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'mcp-modeling-brief.json'), 'utf8'));
  assertValid(validateMcpModelingBrief, unknownMcpBrief, 'unknown intake saved mcp-modeling-brief.json');
  assertValid(validateStructureEvidenceGraph, JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'structure-evidence-graph.json'), 'utf8')), 'unknown intake saved structure-evidence-graph.json');
  assertValid(validateDraftViewGraph, JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'draft-view-graph.json'), 'utf8')), 'unknown intake saved draft-view-graph.json');
  assertValid(validateObjectSurfaceGraph, JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'object-surface-graph.json'), 'utf8')), 'unknown intake saved object-surface-graph.json');
  const unknownIntakeSummary = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'intake-summary.json'), 'utf8'));
  assertValid(validateStructuredAssetIntakeSummary, unknownIntakeSummary, 'unknown intake saved intake-summary.json');
	  const unknownMcpBriefMarkdown = await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'mcp-modeling-brief.md'), 'utf8');
	  assert.ok(unknownMcpBriefMarkdown.includes('can_generate_sketchup_dsl: `false`'), 'unknown intake saved MCP markdown should be fail-closed');
  assert.ok(unknownMcpBriefMarkdown.includes('## Agent Contract'), 'unknown intake saved MCP markdown should expose agent contract');
  assert.ok(unknownMcpBriefMarkdown.includes('direct_sketchup_dsl'), 'unknown intake saved MCP markdown should expose blocked direct DSL output');
  const unknownReview = await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-unknown-regression', 'review', 'index.html'), 'utf8');
  assert.ok(unknownReview.includes('Structured Asset Intake Review'), 'unknown intake should generate a review workbench');
  assert.ok(unknownReview.includes('candidate-graph-data'), 'unknown intake review should embed candidate graph data');
  assert.ok(unknownReview.includes('mcp-modeling-brief-data'), 'unknown intake review should embed MCP brief data');
  assert.ok(unknownReview.includes('download-mcp-brief-json'), 'unknown intake review should link MCP brief JSON');
  assert.ok(unknownReview.includes('download-mcp-brief-markdown'), 'unknown intake review should link MCP brief Markdown');
  assert.ok(unknownReview.includes('download-intake-summary'), 'unknown intake review should link intake summary');
  assert.ok(unknownReview.includes('draft-view-graph-data'), 'unknown intake review should embed DraftViewGraph data');
  assert.ok(unknownReview.includes('object-surface-graph-data'), 'unknown intake review should embed ObjectSurfaceGraph data');
  assert.ok(unknownReview.includes('candidate-promotion-review-data'), 'unknown intake review should embed promotion review draft data');
  assert.ok(unknownReview.includes('download-promotion-review'), 'unknown intake review should expose promotion review export');
  assert.ok(unknownReview.includes('unknown_profile'), 'unknown intake review should show profile blockers');
  assertValid(validateMcpModelingBrief, readEmbeddedJson(unknownReview, 'mcp-modeling-brief-data'), 'unknown intake embedded MCP brief JSON');
  assertValid(validateCandidatePromotionReview, readEmbeddedJson(unknownReview, 'candidate-promotion-review-data'), 'unknown intake embedded promotion review JSON');

  const routed = await buildStructuredAssetIntake({
    input,
    objectType: 'building_single',
    objectName: 'Anime Yellow Building Intake Regression',
    viewHintsFile: 'projects/image-structured-modeler/examples/building-single-anime-yellow/view-hints.json',
    buildingSingleAnnotations: 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-annotations.md',
    buildingSingleVlmCandidates: 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-vlm-candidates.json',
    outputDir: 'output/image-structured-modeler/intake-building-single-regression',
    writeOverlays: false,
    writeRealWorldBuildingReleaseDraft: true,
    releaseDraftReviewer: 'intake regression',
    releaseDraftAcceptedAt: '2026-06-16',
    releaseDraftNotes: 'Release draft from intake regression; not a release-positive sample.',
    requireSourceInputReady: true
  });
  assertValid(validateAssetSet, routed.assetSet, 'building-single intake asset-set.json');
  assertValid(validateImageSetObservation, routed.observationSet, 'building-single intake observations.json');
  assertValid(validateCandidateGraph, routed.candidateGraph, 'building-single intake candidate-graph.json');
  assertValid(validateModelingBrief, routed.modelingBrief, 'building-single intake modeling-brief.json');
  assertValid(validateMcpModelingBrief, routed.mcpModelingBrief, 'building-single intake mcp-modeling-brief.json');
  assertValid(validateStructuredAssetIntakeSummary, routed.intakeSummary, 'building-single intake summary');
  assertValid(validateRealWorldBuildingSourcePackage, routed.sourcePackageAssessment, 'building-single intake source-package assessment');
  assertValid(validateRealWorldBuildingSourceRequest, routed.sourcePackageAssessment.source_request, 'building-single intake source request');
  assertValid(validateRealWorldBuildingManifest, routed.realWorldBuildingReleaseDraft.manifest, 'building-single intake real-world release manifest draft');
  assertValid(validateRealWorldBuildingChecklist, routed.realWorldBuildingReleaseDraft.checklist, 'building-single intake real-world release checklist draft');
  assertValid(validateCandidatePromotionReview, routed.promotionReview, 'building-single intake candidate-promotion-review.draft.json');
  assertValid(validateCandidatePromotionPatch, routed.promotionPatch, 'building-single intake candidate-promotion-patch.blocked.json');
  assertValid(validateVisionEvidenceReviewPatch, routed.visionEvidenceReviewPatch, 'building-single intake VisionEvidence review patch');
  assertValid(validateBuildingSingleSemanticEvidence, routed.buildingSingleSemanticEvidence, 'building-single semantic evidence v1');
  assertValid(validateStructureEvidenceGraph, routed.structureEvidenceGraph, 'building-single structure evidence graph v1');
  assertValid(validateDraftViewGraph, routed.draftViewGraph, 'building-single draft view graph v1');
  assertValid(validateObjectSurfaceGraph, routed.objectSurfaceGraph, 'building-single object surface graph v1');
  assertValid(validateFacadePlaneGraph, routed.facadePlaneGraph, 'building-single facade plane graph v1');
  assertValid(validateDraftViewReviewDecision, routed.promotionReview.draft_view_review, 'building-single default draft view review decision');
  assertValid(validateLocalDetailReviewDecision, routed.promotionReview.local_detail_review, 'building-single default local detail review decision');
  assert.equal(routed.structureEvidenceGraph.kind, 'structure_evidence_graph_v1', 'building-single intake must emit StructureEvidenceGraph v1');
  assert.ok(routed.structureEvidenceGraph.edge_evidence.length > 0, 'building-single StructureEvidenceGraph should expose deterministic edge evidence');
  assert.ok(routed.structureEvidenceGraph.plane_hypotheses.length > 0, 'building-single StructureEvidenceGraph should expose plane hypotheses');
  assert.deepEqual(routed.draftViewGraph.view_slots.map((slot) => slot.slot_id), ['front', 'left_or_right_side', 'top', 'oblique_context'], 'building-single DraftViewGraph must expose fixed view slots');
  assert.equal(routed.draftViewGraph.view_slots.every((slot) => slot.promotion_allowed === false), true, 'building-single DraftViewGraph slots must start promotion-blocked');
  assert.equal(routed.draftViewGraph.review_policy.promotion_allowed, false, 'building-single DraftViewGraph must fail closed until accepted review');
  assert.equal(routed.objectSurfaceGraph.kind, 'object_surface_graph_v1', 'building-single intake must emit ObjectSurfaceGraph v1');
  assert.equal(routed.objectSurfaceGraph.review_policy.promotion_allowed, false, 'ObjectSurfaceGraph must fail closed until accepted review');
  assert.ok(routed.objectSurfaceGraph.surfaces.length > 0, 'ObjectSurfaceGraph should expose reviewable visible surfaces');
  assert.ok(routed.objectSurfaceGraph.surface_local_feature_candidates.some((detail) => detail.role === 'rectangular_utility_ducts'), 'ObjectSurfaceGraph should expose ducts as surface-local candidates');
  assert.equal(routed.facadePlaneGraph.kind, 'facade_plane_graph_v1', 'building-single intake must emit FacadePlaneGraph v1');
  assert.equal(routed.facadePlaneGraph.source_draft_view_graph, 'draft-view-graph.json', 'FacadePlaneGraph should point to its source DraftViewGraph artifact');
  assert.deepEqual(
    routed.facadePlaneGraph.planes.map((plane) => plane.id).sort(),
    ['visible_plane_primary', 'visible_plane_recessed_left'],
    'building-single FacadePlaneGraph should output visible_plane_* ids'
  );
  assert.equal(routed.facadePlaneGraph.planes.every((plane) => plane.promotion_allowed === false), true, 'FacadePlaneGraph planes must not allow promotion by default');
  assert.equal(
    routed.facadePlaneGraph.planes.every((plane) => ['visible_quad_px', 'orientation_hint', 'adjacency', 'occlusion_order', 'must_not_merge_with', 'source', 'review_required', 'promotion_allowed'].every((key) => Object.hasOwn(plane, key))),
    true,
    'FacadePlaneGraph planes must carry the v1 Drafting-first contract fields'
  );
  assert.equal(routed.facadePlaneGraph.plane_local_detail_candidates.some((detail) => detail.role === 'rectangular_utility_ducts'), true, 'FacadePlaneGraph should expose ducts as plane-local detail candidates');
  assert.equal(routed.facadePlaneGraph.plane_local_detail_candidates.some((detail) => detail.role === 'exterior_hvac_units'), true, 'FacadePlaneGraph should expose HVAC as plane-local detail candidates');
  assert.equal(routed.facadePlaneReviewOverlay.kind, 'facade_plane_review_overlay_v1', 'building-single intake should emit facade plane review overlay');
  assert.equal(routed.facadePlaneReviewOverlay.geometry_promotion_allowed, false, 'facade plane review overlay must not allow promoted geometry');
  assert.equal(routed.facadePlaneReviewOverlay.qa.no_promoted_geometry, true, 'facade plane review overlay must stay review-only');
  assert.equal(routed.buildingSingleSemanticEvidence.kind, BUILDING_SINGLE_SEMANTIC_EVIDENCE_KIND, 'building-single intake must emit BuildingSingleSemanticEvidence v1');
  assert.equal(routed.buildingSingleSemanticEvidence.summary.compile_allowed, false, 'building-single semantic evidence must not allow compile');
  assert.equal(routed.buildingSingleSemanticEvidence.summary.geometry_promotion_allowed, false, 'building-single semantic evidence must not allow geometry promotion');
  assert.deepEqual(
    ['visible_plane_recessed_left', 'rectangular_utility_ducts', 'shadow_or_recess_boundary'].filter((role) => !routed.buildingSingleSemanticEvidence.summary.critical_roles_present.includes(role)),
    [],
    'building-single semantic evidence must include critical recessed/duct/shadow roles'
  );
  assert.ok(routed.buildingSingleSemanticEvidence.summary.sources.includes('user_annotation'), 'building-single semantic evidence must include user annotation source');
  assert.ok(routed.buildingSingleSemanticEvidence.summary.sources.includes('vlm_candidate'), 'building-single semantic evidence must include fixture VLM candidate source');
  assert.ok(routed.buildingSingleSemanticEvidence.summary.sources.includes('profile_prior'), 'building-single semantic evidence must keep lower-priority profile prior provenance');
  assert.ok(routed.buildingSingleSemanticEvidence.images.every((image) => image.regions.every((region) => bboxInsideFrame(region.bbox_px, image.content_frame_bbox))), 'building-single semantic region bboxes must stay inside content frame');
  assert.ok(routed.buildingSingleSemanticEvidence.images.every((image) => image.projection_model), 'building-single semantic images must preserve projection model hints');
  assert.ok(routed.buildingSingleSemanticEvidence.images.every((image) => image.regions.every((region) => polygonInsideFrame(region.polygon_px, image.content_frame_bbox))), 'building-single semantic regions must preserve image-space polygon evidence inside the content frame');
  assert.ok(
    routed.buildingSingleSemanticEvidence.images
      .flatMap((image) => image.regions.filter((region) => region.selected_for_candidate_graph && image.view === 'oblique'))
      .every((region) => region.image_space_geometry === 'polygon_px' && region.polygon_derivation === 'weak_oblique_vp_quad_from_bbox' && region.orthographic_projection_allowed === false),
    'building-single oblique selected regions must not degrade to orthographic bbox-only evidence'
  );
  assert.equal(routed.buildingSingleReviewHelperOutput.model_status, 'review_only', 'building-single review helper must be review-only');
  assert.equal(routed.buildingSingleReviewHelperOutput.compile_allowed, false, 'building-single review helper must not compile');
  assert.equal(routed.buildingSingleReviewHelperOutput.geometry_promotion_allowed, false, 'building-single review helper must not allow geometry promotion');
  assert.ok(routed.buildingSingleReviewHelperOutput.operations.some((operation) => operation.op === 'semantic_region_overlay'), 'building-single review helper must include semantic overlay operations');
  const routedReviewOverlays = routed.buildingSingleReviewHelperOutput.operations.filter((operation) => operation.op === 'semantic_region_overlay');
  assert.ok(routedReviewOverlays.every((operation) => Array.isArray(operation.polygon_px) && operation.polygon_px.length >= 3), 'building-single review helper overlays must carry polygon_px evidence');
  assert.ok(routedReviewOverlays.every((operation) => operation.orthographic_projection_allowed === false), 'building-single review helper overlays must forbid orthographic projection promotion');
  const routedReviewLabels = routed.buildingSingleReviewHelperOutput.operations.filter((operation) => operation.op === 'label');
  const routedReviewLeaderLines = routed.buildingSingleReviewHelperOutput.operations.filter((operation) => operation.op === 'semantic_leader_line');
  const routedContentFrame = routed.buildingSingleSemanticEvidence.images[0].content_frame_bbox;
  const routedFrameRight = routedContentFrame[0] + routedContentFrame[2];
  assert.ok(routedReviewLabels.length > 0, 'building-single review helper must include labels');
  assert.ok(routedReviewLabels.every((operation) => operation.layout === 'external_right_rail' && operation.anchor_px[0] > routedFrameRight), 'building-single review helper labels must stay outside the image content frame');
  assert.ok(routedReviewLeaderLines.length >= routedReviewLabels.length, 'building-single review helper must connect external labels to semantic regions');
  assert.equal(
    routed.buildingSingleReviewHelperOutput.operations.some((operation) => ['cut_recess', 'round_pipe_geometry', 'facade_trim'].includes(operation.op)),
    false,
    'building-single review helper must not emit forbidden geometry operations'
  );
  const parsedBuildingAnnotations = parseBuildingSingleAnnotations(await fs.readFile(path.join(repoRoot, 'projects', 'image-structured-modeler', 'examples', 'building-single-anime-yellow', 'building-single-annotations.md'), 'utf8'));
  assert.ok(parsedBuildingAnnotations.some((entry) => entry.role === 'rectangular_utility_ducts' && entry.what_it_is_not.includes('round pipe')), 'building-single annotation parser must preserve duct negative semantics');
  const vlmFixtureCandidates = await loadBuildingSingleVlmCandidates(path.join(repoRoot, 'projects', 'image-structured-modeler', 'examples', 'building-single-anime-yellow', 'building-single-vlm-candidates.json'));
  assert.ok(vlmFixtureCandidates.some((candidate) => candidate.role === 'shadow_or_recess_boundary' && candidate.blocked_interpretations.includes('cut_recess_from_shadow_only')), 'building-single VLM fixture must preserve shadow negative semantics');
  const invalidVlmPath = path.join(repoRoot, 'output', 'image-structured-modeler', 'invalid-building-single-vlm-candidates.json');
  await fs.mkdir(path.dirname(invalidVlmPath), { recursive: true });
  await fs.writeFile(invalidVlmPath, `${JSON.stringify({ kind: 'building_single_vlm_candidates', version: 1, regions: [{ role: 'rectangular_utility_ducts', bbox_px: [1, 2, 3], confidence: 0.8 }] }, null, 2)}\n`, 'utf8');
  await assertRejectsWithMessage(
    () => loadBuildingSingleVlmCandidates(invalidVlmPath),
    /Invalid building-single VLM candidates/,
    'invalid building-single VLM fixture must fail closed'
  );
  assert.equal(routed.observationSet.object.profile, 'building_single', 'routed intake should select building_single when explicitly requested');
  assert.equal(routed.modelingBrief.compile_allowed, false, 'routed intake should still require promotion before compile');
  assert.equal(routed.mcpModelingBrief.compile_permission.can_generate_sketchup_dsl, false, 'routed intake MCP brief should forbid direct DSL');
  assert.equal(routed.mcpModelingBrief.source_package_gate.status, 'blocked_source_assets', 'routed intake MCP brief should carry source-package gate status');
  assert.equal(routed.mcpModelingBrief.source_package_gate.input_ready_for_release_work, false, 'routed intake MCP brief should expose blocked source-package readiness');
  assert.ok(routed.mcpModelingBrief.source_package_gate.blockers.includes('source_assets_generated_or_scaffold'), 'routed intake MCP brief should expose source-package source blocker');
  assert.ok(routed.mcpModelingBrief.source_package_gate.blockers.includes('missing_top_view'), 'routed intake MCP brief should expose source-package view blocker');
  assert.equal(routed.mcpModelingBrief.source_package_gate.source_request.status, 'needs_source_replacement', 'routed intake MCP brief should carry source request status');
  assert.ok(routed.mcpModelingBrief.source_package_gate.source_request.blocked_until_satisfied.includes('direct_sketchup_dsl'), 'routed intake MCP source request should block direct DSL');
  assert.ok(routed.mcpModelingBrief.compile_permission.reasons.includes('source_assets_generated_or_scaffold'), 'routed intake MCP compile reasons should include source-package source blocker');
  assert.ok(routed.mcpModelingBrief.prohibitions.some((item) => item.includes('recessed visible plane evidence')), 'routed intake MCP brief should keep recessed facade caution');
  assert.equal(routed.mcpModelingBrief.agent_contract.status, 'review_or_input_blocked', 'routed intake MCP agent contract should keep review/input blocked status');
  assert.equal(routed.mcpModelingBrief.agent_contract.output_policy.sketchup_dsl_allowed, false, 'routed intake MCP agent contract should forbid SketchUp DSL');
  assert.ok(routed.mcpModelingBrief.agent_contract.output_policy.allowed_outputs.includes('source_package_blocker_report'), 'routed intake MCP agent contract should allow blocker reporting');
  assert.ok(routed.mcpModelingBrief.agent_contract.required_confirmations.some((item) => item.includes('missing_top_view') || item.includes('top view')), 'routed intake MCP agent contract should request top view confirmation');
  assert.ok(routed.mcpModelingBrief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'source_package'), 'routed intake MCP agent contract should include source-package artifact');
  assert.equal(routed.mcpModelingBrief.modeling_constraint_summary.status, 'review_or_input_blocked', 'routed intake MCP constraint summary should stay blocked');
  assertMcpModelingConstraintRole(
    routed.mcpModelingBrief,
    'visible_plane_recessed_left',
    'merged_front_facade_plane',
    'routed intake MCP constraint summary should block merging recessed facade into front facade'
  );
  assertMcpModelingConstraintRole(
    routed.mcpModelingBrief,
    'rectangular_utility_ducts',
    'decorative_facade_trim',
    'routed intake MCP constraint summary should block treating ducts as trim'
  );
  assertMcpModelingConstraintRole(
    routed.mcpModelingBrief,
    'shadow_or_recess_boundary',
    'cut_recess_from_shadow_only',
    'routed intake MCP constraint summary should block shadow-only recess cuts'
  );
  const routedMcpRiskIds = routed.mcpModelingBrief.grounding_risk_register.map((risk) => risk.id);
  assert.ok(routedMcpRiskIds.includes('direct_sketchup_dsl_blocked'), 'routed intake MCP risk register should block direct DSL');
  assert.ok(routedMcpRiskIds.includes('source_assets_generated_or_scaffold'), 'routed intake MCP risk register should expose source authenticity risk');
  assert.ok(routedMcpRiskIds.includes('missing_view_top'), 'routed intake MCP risk register should expose missing top view risk');
  assert.ok(routedMcpRiskIds.includes('scale_confidence_below_publish_gate'), 'routed intake MCP risk register should expose scale risk');
  assert.ok(routedMcpRiskIds.includes('visible_plane_recessed_left_requires_separate_plane_review'), 'routed intake MCP risk register should preserve recessed facade placement risk');
  assert.ok(routedMcpRiskIds.includes('rectangular_utility_ducts_require_duct_semantics_review'), 'routed intake MCP risk register should preserve duct semantics risk');
  assert.ok(routedMcpRiskIds.includes('shadow_recess_boundary_ambiguity'), 'routed intake MCP risk register should preserve shadow/recess ambiguity');
  const routedDisambiguationByRole = new Map(routed.mcpModelingBrief.candidate_disambiguation.map((item) => [item.role, item]));
  assert.ok(routedDisambiguationByRole.get('visible_plane_recessed_left')?.blocked_interpretations.includes('merged_front_facade_plane'), 'routed MCP disambiguation should block merging recessed facade into front facade');
  assert.ok(routedDisambiguationByRole.get('rectangular_utility_ducts')?.blocked_interpretations.includes('decorative_facade_trim'), 'routed MCP disambiguation should block treating ducts as trim');
  assert.ok(routedDisambiguationByRole.get('shadow_or_recess_boundary')?.blocked_interpretations.includes('cut_recess_from_shadow_only'), 'routed MCP disambiguation should block cutting recesses from shadow alone');
  assert.equal(routed.promotionReview.compile_allowed, false, 'routed promotion review should not directly allow compile');
  assert.equal(routed.promotionReview.promotion_allowed, false, 'routed draft promotion review should wait for explicit accepted candidates');
  assert.equal(routed.realWorldBuildingReleaseDraft.checklist.release_ready, false, 'routed intake release draft should remain fail-closed');
  assert.equal(routed.sourcePackageAssessment.input_ready_for_release_work, false, 'routed intake source package should remain blocked');
  assert.equal(routed.sourcePackageAssessment.status, 'blocked_source_assets', 'routed intake source package should reject generated/cropped demo source');
  assert.equal(routed.sourcePackageAssessment.source_authenticity.status, 'fail', 'routed intake source package should fail source authenticity');
  assert.ok(routed.sourcePackageAssessment.blockers.includes('source_assets_generated_or_scaffold'), 'routed intake source package should expose generated/scaffold source blocker');
  assert.ok(routed.sourcePackageAssessment.blockers.includes('missing_top_view'), 'routed intake source package should request top/plan evidence');
  assert.equal(routed.sourcePackageAssessment.source_request.status, 'needs_source_replacement', 'routed intake source request should ask for replacement real sources first');
  assert.ok(routed.sourcePackageAssessment.source_request.accepted_asset_types.includes('cad'), 'routed intake source request should allow CAD sources');
  assert.ok(routed.sourcePackageAssessment.source_request.blocked_until_satisfied.includes('direct_sketchup_dsl'), 'routed intake source request should block direct DSL');
  assert.ok(routed.sourcePackageAssessment.source_request.source_asset_requirements.needs_replacement_assets, 'routed intake source request should require replacement assets');
  assert.equal(routed.sourcePackageAssessment.source_request.view_source_requirements.distinct_source_images_required, true, 'routed intake source request should require distinct source images per required view');
  assert.equal(routed.sourcePackageAssessment.source_request.view_source_requirements.blocker, 'view_sources_not_distinct', 'routed intake source request should name distinct view source blocker');
  assert.ok(routed.sourcePackageAssessment.source_request.view_requirements.some((item) => item.view === 'left' && item.status === 'missing'), 'routed intake source request should ask for side view');
  assert.ok(routed.sourcePackageAssessment.source_request.view_requirements.some((item) => item.view === 'oblique' && item.status === 'present'), 'routed intake source request should preserve oblique view when hints provide it');
  assert.ok(routed.sourcePackageAssessment.source_request.view_requirements.some((item) => item.view === 'top' && item.status === 'missing'), 'routed intake source request should ask for top/plan view');
  assert.equal(routed.sourcePackageAssessment.source_request.scale_requirement.minimum_confidence, 0.7, 'routed intake source request should expose scale confidence target');
  assert.ok(routed.sourcePackageAssessment.source_request.upload_package_requirements.required_view_slots.some((slot) => slot.view === 'left' && slot.distinct_source_image_required === true), 'routed intake source request should expose upload package view slots');
  assert.ok(routed.sourcePackageAssessment.source_request.upload_package_requirements.forbidden_shortcuts.some((item) => item.includes('Do not relabel one image')), 'routed intake source request should expose forbidden upload shortcuts');
	  assertValid(validateRealWorldBuildingSourcePackageGateResult, routed.sourcePackageGateResult, 'building-single intake source-package gate result');
  assert.equal(routed.sourcePackageGateResult.ok, false, 'routed intake source-package gate should fail require-source-input-ready');
  assert.deepEqual(routed.sourcePackageGateResult.failed_requirements, ['input_ready_for_release_work'], 'routed intake source-package gate should expose failed input-ready requirement');
  assert.equal(routed.sourcePackageGateOutput, 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-package.gate-result.json', 'routed intake source-package gate should write default gate-result artifact');
  assert.equal(routed.intakeSummary.ok, false, 'routed intake summary should reflect failed source-package hard gate');
  assert.equal(routed.intakeSummary.gates.source_package.status, 'blocked_source_assets', 'routed intake summary should expose source-package status');
  assert.deepEqual(routed.intakeSummary.gates.source_package.failed_requirements, ['input_ready_for_release_work'], 'routed intake summary should expose failed source-package requirement');
  assert.equal(routed.intakeSummary.artifacts.source_request, 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-request.json', 'routed intake summary should point to source-request artifact');
  assert.equal(routed.intakeSummary.artifacts.structure_evidence_graph, 'output/image-structured-modeler/intake-building-single-regression/structure-evidence-graph.json', 'routed intake summary should point to StructureEvidenceGraph artifact');
  assert.equal(routed.intakeSummary.artifacts.draft_view_graph, 'output/image-structured-modeler/intake-building-single-regression/draft-view-graph.json', 'routed intake summary should point to DraftViewGraph artifact');
  assert.equal(routed.intakeSummary.artifacts.draft_view_graph_svg, 'output/image-structured-modeler/intake-building-single-regression/draft-view-graph.svg', 'routed intake summary should point to DraftViewGraph SVG artifact');
  assert.equal(routed.intakeSummary.artifacts.draft_view_review_overlay, 'output/image-structured-modeler/intake-building-single-regression/draft-view-review-overlay.json', 'routed intake summary should point to draft view review overlay artifact');
  assert.equal(routed.intakeSummary.artifacts.object_surface_graph, 'output/image-structured-modeler/intake-building-single-regression/object-surface-graph.json', 'routed intake summary should point to ObjectSurfaceGraph artifact');
  assert.equal(routed.intakeSummary.draft_view_graph.status, 'needs_draft_view_review', 'routed intake summary should expose DraftViewGraph review status');
  assert.equal(routed.intakeSummary.object_surface_graph.promotion_allowed, false, 'routed intake summary should expose object surface fail-closed state');
  assert.equal(routed.intakeSummary.artifacts.source_request_markdown, 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-request.md', 'routed intake summary should point to source-request markdown artifact');
  assert.equal(routed.intakeSummary.artifacts.upload_manifest_template, 'output/image-structured-modeler/intake-building-single-regression/upload-manifest.template.json', 'routed intake summary should point to upload manifest template artifact');
  assert.equal(routed.intakeSummary.artifacts.source_package_gate_result, routed.sourcePackageGateOutput, 'routed intake summary should point to source-package gate artifact');
  assert.equal(routed.realWorldBuildingReleaseDraft.checklist.can_promote_to_release_manifest, false, 'routed intake release draft should not be promotable by default');
  assert.equal(routed.realWorldBuildingReleaseDraft.validation.status, 'manifest_invalid_release_gap_recorded', 'routed intake release draft should write invalid summary status');
  assert.ok(routed.realWorldBuildingReleaseDraft.checklist.blockers.includes('artifacts'), 'routed intake release draft should require release artifacts');
  assert.ok(routed.realWorldBuildingReleaseDraft.checklist.blockers.includes('photo_grade_readiness'), 'routed intake release draft should require PhotoGradeReadiness');
  assert.equal(routed.realWorldBuildingReleaseDraft.manifest.profile_path, 'examples/product-profiles/building_single_urban_oblique.json', 'routed intake release draft should map profile path');
  assert.equal(routed.realWorldBuildingReleaseDraft.manifest.artifacts.part_graph, 'output/image-structured-modeler/intake-building-single-regression/part-graph.candidate-promoted.json', 'routed intake release draft should infer candidate-promoted PartGraph artifact path');
  assert.ok(routed.promotionReview.held_candidates.length >= routed.candidateGraph.candidates.length, 'draft promotion review should hold all candidates by default');
  assert.equal(routed.promotionPatch.status, 'blocked', 'routed promotion patch should stay blocked while inputs are missing');
  assert.equal(routed.promotionPatch.apply_allowed, false, 'blocked routed promotion patch should not be applyable');
  assert.equal(routed.promotionPatch.actions.length, 0, 'blocked routed promotion patch should not contain actions');
  assert.ok(routed.modelingBrief.missing_inputs.includes('missing_front_view'), 'building-single intake should request front evidence');
  assert.ok(routed.modelingBrief.missing_inputs.includes('missing_left_view'), 'building-single intake should request side/depth evidence');
  assert.ok(routed.modelingBrief.missing_inputs.includes('missing_top_view'), 'building-single intake should request top/scale evidence');
  assert.ok(routed.candidateGraph.candidates.some((candidate) => candidate.role === 'building_main_mass'), 'building-single intake should surface building mass candidates for review');
  assert.equal(routed.candidateGraph.candidates.some((candidate) => candidate.role === 'front_facade_plane' || candidate.role === 'recessed_side_facade_plane'), false, 'building-single intake must not emit legacy buildable facade plane role names');
  for (const role of ['visible_plane_primary', 'visible_plane_recessed_left', 'rectangular_utility_ducts', 'shadow_or_recess_boundary']) {
    const candidate = routed.candidateGraph.candidates.find((item) => item.role === role);
    assert.ok(candidate, `building-single intake should surface ${role} as a review candidate`);
    assert.equal(candidate.semantic_source, 'user_annotation', `${role} should prefer user annotation semantic evidence`);
    assert.ok(candidate.semantic_evidence_id, `${role} should carry semantic evidence id`);
    assert.equal(candidate.geometry_promotion_allowed, false, `${role} semantic candidate should not allow geometry promotion`);
    assert.ok(candidate.promotion.blockers.includes('semantic_evidence_review_required'), `${role} should remain blocked until semantic review`);
    assertSemanticReviewItemHasEvidenceInstance(
      routed.visionEvidenceReviewPatch,
      role,
      `building-single VisionEvidence review patch should locate ${role} evidence`
    );
  }
  const routedShadowCandidate = routed.candidateGraph.candidates.find((item) => item.role === 'shadow_or_recess_boundary');
  assert.ok(routedShadowCandidate.blocked_interpretations.includes('cut_recess'), 'shadow candidate must block cut_recess');
  assert.ok(routedShadowCandidate.blocked_interpretations.includes('cut_recess_from_shadow_only'), 'shadow candidate must block shadow-only recess cuts');
  const routedDuctCandidate = routed.candidateGraph.candidates.find((item) => item.role === 'rectangular_utility_ducts');
  assert.ok(routedDuctCandidate.blocked_interpretations.includes('round_pipe_geometry'), 'duct candidate must block round pipe geometry');
  assert.ok(routedDuctCandidate.blocked_interpretations.includes('decorative_facade_trim'), 'duct candidate must block facade trim');
  const routedSemanticReviewItem = routed.visionEvidenceReviewPatch.review_items.find((item) => item.evidence_type === 'semantic_candidate_policy' && item.current_value?.class === 'rectangular_utility_ducts');
  assert.ok(routedSemanticReviewItem.current_value.evidence_instances.some((instance) => instance.semantic_source === 'user_annotation'), 'VisionEvidence semantic review item must carry user annotation provenance');
  assert.ok(routed.candidateGraph.candidates.every((candidate) => candidate.promotion.status !== 'eligible'), 'building-single single-image candidates should not become eligible automatically');
  const routedImage = routed.observationSet.images[0];
  assert.equal(routedImage.image.content_frame.applied, false, 'pre-cropped building-single fixture should not be cropped again');
  assert.deepEqual(routedImage.metrics.content_frame_bbox, [0, 0, routedImage.image.analysis_width, routedImage.image.analysis_height], 'pre-cropped fixture should record full-image content frame');

  const rawScreenshot = await buildStructuredAssetIntake({
    input: intakeFixtureSource,
    objectType: 'building_single',
    objectName: 'Anime Yellow Raw Screenshot Content Frame Regression',
    outputDir: 'output/image-structured-modeler/intake-building-single-content-frame-regression',
    writeOverlays: false,
    writeReview: false,
    writeMcpBrief: false
  });
  assertValid(validateImageSetObservation, rawScreenshot.observationSet, 'raw building-single screenshot content-frame observations');
  const rawScreenshotImage = rawScreenshot.observationSet.images[0];
  const rawContentFrame = rawScreenshotImage.image.content_frame;
  assert.equal(rawContentFrame.method, 'auto_screenshot_chrome_v1', 'raw screenshot should use the automatic screenshot chrome detector');
  assert.equal(rawContentFrame.applied, true, 'raw screenshot should remove the lower screenshot chrome before bboxing');
  assert.ok(rawContentFrame.removed_regions.some((region) => region.side === 'bottom' && region.reason === 'near_black_screenshot_chrome'), 'raw screenshot content frame should record the removed lower chrome panel');
  assert.ok(rawContentFrame.removed_area_ratio > 0.45, 'raw screenshot should record that a large screenshot panel was removed');
  assert.deepEqual(rawScreenshotImage.metrics.content_frame_bbox, rawContentFrame.bbox, 'raw screenshot metrics should mirror the applied content frame bbox');
  assert.ok(rawScreenshotImage.metrics.raw_edge_count > rawScreenshotImage.metrics.edge_count, 'raw screenshot should retain raw/effective edge counts after chrome filtering');
  assert.ok(rawScreenshotImage.metrics.object_bbox_ratio > 1.3, 'raw screenshot bbox ratio should reflect the visible building region, not the tall screenshot panel');
  assert.ok(rawScreenshotImage.metrics.object_bbox[1] + rawScreenshotImage.metrics.object_bbox[3] <= rawContentFrame.bbox[1] + rawContentFrame.bbox[3], 'raw screenshot object bbox should stay inside the detected content frame');
  assert.ok(rawScreenshotImage.observations.some((item) => item.id === 'auto_content_frame' && item.kind === 'helper_generated'), 'raw screenshot should expose content-frame provenance as a helper observation');
  const rawDuctCandidate = rawScreenshot.candidateGraph.candidates.find((candidate) => candidate.role === 'rectangular_utility_ducts');
  assert.ok(rawDuctCandidate, 'raw screenshot should still surface rectangular duct review candidates after chrome removal');
  assert.ok(rawDuctCandidate.bbox[1] + rawDuctCandidate.bbox[3] <= rawContentFrame.bbox[1] + rawContentFrame.bbox[3], 'raw screenshot duct candidate should be generated inside the content frame');
  const routedReview = await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'review', 'index.html'), 'utf8');
  const routedMcpBrief = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'mcp-modeling-brief.json'), 'utf8'));
  assertValid(validateMcpModelingBrief, routedMcpBrief, 'building-single saved mcp-modeling-brief.json');
  assert.equal(routedMcpBrief.source_package_gate.status, routed.sourcePackageAssessment.status, 'building-single saved MCP brief should preserve source-package gate status');
	  const routedMcpBriefMarkdown = await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'mcp-modeling-brief.md'), 'utf8');
  assert.ok(routedMcpBriefMarkdown.indexOf('## Draft View Graph') >= 0, 'building-single saved MCP markdown should start structure handoff with DraftViewGraph');
  assert.ok(routedMcpBriefMarkdown.indexOf('## Draft View Graph') < routedMcpBriefMarkdown.indexOf('## Facade Plane Graph'), 'building-single MCP markdown should describe DraftViewGraph before FacadePlaneGraph');
  assert.ok(routedMcpBriefMarkdown.indexOf('## Object Surface Graph') < routedMcpBriefMarkdown.indexOf('## Candidate Groups'), 'building-single MCP markdown should describe local surface/detail candidates before candidate groups');
  assert.ok(routedMcpBriefMarkdown.includes('## Agent Contract'), 'building-single saved MCP markdown should expose agent contract');
  assert.ok(routedMcpBriefMarkdown.includes('direct_sketchup_dsl'), 'building-single saved MCP markdown should expose blocked direct DSL output');
  assert.ok(routedMcpBriefMarkdown.includes('Do not move recessed visible plane evidence into visible_plane_primary'), 'building-single saved MCP markdown should keep recessed facade caution');
  assert.ok(routedMcpBriefMarkdown.includes('## Candidate Disambiguation'), 'building-single saved MCP markdown should expose candidate disambiguation section');
  assert.ok(routedMcpBriefMarkdown.includes('## Modeling Constraint Summary'), 'building-single saved MCP markdown should expose modeling constraint summary section');
  assert.ok(routedMcpBriefMarkdown.includes('merged_front_facade_plane'), 'building-single saved MCP markdown should expose recessed facade blocked interpretation');
  assert.ok(routedMcpBriefMarkdown.includes('decorative_facade_trim'), 'building-single saved MCP markdown should expose duct blocked interpretation');
  assert.ok(routedMcpBriefMarkdown.includes('cut_recess_from_shadow_only'), 'building-single saved MCP markdown should expose shadow blocked interpretation');
  assert.ok(routedMcpBriefMarkdown.includes('semantic_source=user_annotation') || routedMcpBriefMarkdown.includes('| user_annotation |'), 'building-single saved MCP markdown should expose user annotation semantic provenance');
  assert.ok(routedMcpBriefMarkdown.includes('## Source Package Gate'), 'building-single saved MCP markdown should expose source-package gate section');
  assert.ok(routedMcpBriefMarkdown.includes('source_assets_generated_or_scaffold'), 'building-single saved MCP markdown should expose source-package blocker');
  const routedMcpBriefRebuilt = await exportMcpModelingBriefCli({
    inputDir: 'output/image-structured-modeler/intake-building-single-regression',
    outputJson: 'output/image-structured-modeler/intake-building-single-regression/mcp-modeling-brief.rebuilt.json',
    outputMarkdown: 'output/image-structured-modeler/intake-building-single-regression/mcp-modeling-brief.rebuilt.md'
  });
  assertValid(validateMcpModelingBrief, routedMcpBriefRebuilt.brief, 'building-single rebuilt MCP brief');
  assert.equal(routedMcpBriefRebuilt.brief.source_package_gate.status, routed.sourcePackageAssessment.status, 'rebuilt MCP brief should reload source-package gate status');
  assert.ok(
    routedMcpBriefRebuilt.brief.source_package_gate.blockers.includes('source_assets_generated_or_scaffold'),
    'rebuilt MCP brief should reload source-package blockers'
  );
  assert.ok(routedReview.includes('Structured Asset Intake Review'), 'building-single intake should generate a review workbench');
  assert.ok(routedReview.includes('modeling-brief-data'), 'building-single intake review should embed modeling brief data');
  assert.ok(routedReview.includes('mcp-modeling-brief-data'), 'building-single intake review should embed MCP brief data');
  assert.ok(routedReview.includes('download-mcp-brief-json'), 'building-single intake review should link MCP brief JSON');
  assert.ok(routedReview.includes('download-mcp-brief-markdown'), 'building-single intake review should link MCP brief Markdown');
  assert.ok(routedReview.includes('download-building-single-semantic-evidence'), 'building-single intake review should link semantic evidence JSON');
  assert.ok(routedReview.includes('download-review-helper-output'), 'building-single intake review should link review helper output');
  assert.ok(routedReview.includes('building-single-semantic-evidence-data'), 'building-single intake review should embed semantic evidence data');
  assert.ok(routedReview.includes('candidate-disambiguation-table'), 'building-single intake review should visibly render MCP candidate disambiguation');
  assert.ok(routedReview.includes('modeling-constraint-summary-table'), 'building-single intake review should visibly render MCP modeling constraint summary');
  assert.ok(routedReview.includes('merged_front_facade_plane'), 'building-single intake review should expose recessed facade blocked interpretation');
  assert.ok(routedReview.includes('decorative_facade_trim'), 'building-single intake review should expose duct blocked interpretation');
  assert.ok(routedReview.includes('cut_recess_from_shadow_only'), 'building-single intake review should expose shadow blocked interpretation');
  assert.ok(routedReview.includes('download-intake-summary'), 'building-single intake review should link intake summary');
  assert.ok(routedReview.includes('download-structure-evidence-graph'), 'building-single intake review should link StructureEvidenceGraph');
  assert.ok(routedReview.includes('download-draft-view-graph'), 'building-single intake review should link DraftViewGraph JSON');
  assert.ok(routedReview.includes('download-draft-view-graph-svg'), 'building-single intake review should link DraftViewGraph SVG');
  assert.ok(routedReview.includes('download-draft-view-review-overlay'), 'building-single intake review should link draft view review overlay');
  assert.ok(routedReview.includes('download-object-surface-graph'), 'building-single intake review should link ObjectSurfaceGraph');
  assert.ok(routedReview.includes('structure-evidence-graph-data'), 'building-single intake review should embed StructureEvidenceGraph data');
  assert.ok(routedReview.includes('draft-view-graph-data'), 'building-single intake review should embed DraftViewGraph data');
  assert.ok(routedReview.includes('object-surface-graph-data'), 'building-single intake review should embed ObjectSurfaceGraph data');
  assert.ok(routedReview.includes('facade-plane-graph-data'), 'building-single intake review should embed FacadePlaneGraph data');
  assert.ok(routedReview.includes('accept-draft-view-review'), 'building-single intake review should expose accepted DraftViewGraph review control');
  assert.ok(routedReview.includes('accept-local-detail-review'), 'building-single intake review should expose local detail review control');
  assert.ok(routedReview.includes('accept-facade-plane-review'), 'building-single intake review should expose facade plane review control');
  assert.ok(routedReview.includes('download-real-world-building-source-package'), 'building-single intake review should link source-package JSON');
  assert.ok(routedReview.includes('download-real-world-building-source-package-markdown'), 'building-single intake review should link source-package Markdown');
  assert.ok(routedReview.includes('download-real-world-building-source-request'), 'building-single intake review should link source-request JSON');
  assert.ok(routedReview.includes('download-real-world-building-source-request-markdown'), 'building-single intake review should link source-request Markdown');
  assert.ok(routedReview.includes('download-real-world-building-upload-manifest-template'), 'building-single intake review should link upload manifest template');
  assert.ok(routedReview.includes('download-real-world-building-contract-summary'), 'building-single intake review should link real-world release contract summary');
  assert.ok(routedReview.includes('download-real-world-building-manifest-draft'), 'building-single intake review should link real-world release manifest draft');
  assert.ok(routedReview.includes('download-real-world-building-release-checklist'), 'building-single intake review should link real-world release checklist JSON');
  assert.ok(routedReview.includes('download-real-world-building-release-checklist-markdown'), 'building-single intake review should link real-world release checklist Markdown');
  assert.ok(routedReview.includes('download-real-world-building-release-work-order'), 'building-single intake review should link real-world release work order JSON');
  assert.ok(routedReview.includes('download-real-world-building-release-work-order-markdown'), 'building-single intake review should link real-world release work order Markdown');
  assert.ok(routedReview.includes('validation_status=manifest_invalid_release_gap_recorded'), 'building-single intake review should show release draft validation status');
  assert.ok(routedReview.includes('work_order=blocked_needs_source_assets'), 'building-single intake review should show release work order status');
  assert.ok(routedReview.includes('photo_grade_readiness'), 'building-single intake review should show release draft blockers');
  assert.ok(routedReview.includes('Run PhotoGradeReadiness'), 'building-single intake review should show release next actions');
  assert.ok(routedReview.includes('<code>source_assets</code>'), 'building-single intake review should show release source-assets check row');
  assert.ok(routedReview.includes('<code>artifacts</code>'), 'building-single intake review should show release artifacts check row');
  assert.ok(routedReview.includes('exists=true'), 'building-single intake review should show existing source item state');
  assert.ok(routedReview.includes('exists=false'), 'building-single intake review should show missing artifact item state');
  assert.ok(routedReview.includes('real-world-building-release-summary-data'), 'building-single intake review should embed release summary JSON');
  assert.ok(routedReview.includes('real-world-building-release-checklist-data'), 'building-single intake review should embed release checklist JSON');
  assert.ok(routedReview.includes('real-world-building-release-work-order-data'), 'building-single intake review should embed release work order JSON');
  assert.ok(routedReview.includes('real-world-building-source-package-data'), 'building-single intake review should embed source-package JSON');
  assert.ok(routedReview.includes('real-world-building-source-request-data'), 'building-single intake review should embed source-request JSON');
  assert.ok(routedReview.includes('accepted-candidates-json'), 'building-single intake review should expose promotion review JSON editor');
  assert.ok(routedReview.includes('candidate-promotion-review-data'), 'building-single intake review should embed promotion review draft data');
  assert.ok(routedReview.includes('missing_front_view'), 'building-single intake review should show missing view blockers');
  assertValid(validateMcpModelingBrief, readEmbeddedJson(routedReview, 'mcp-modeling-brief-data'), 'building-single embedded MCP brief JSON');
  assertValid(validateRealWorldBuildingSourcePackage, readEmbeddedJson(routedReview, 'real-world-building-source-package-data'), 'building-single embedded source-package JSON');
  assertValid(validateRealWorldBuildingSourceRequest, readEmbeddedJson(routedReview, 'real-world-building-source-request-data'), 'building-single embedded source-request JSON');
  assertValid(validateStructureEvidenceGraph, readEmbeddedJson(routedReview, 'structure-evidence-graph-data'), 'building-single embedded StructureEvidenceGraph JSON');
  assertValid(validateDraftViewGraph, readEmbeddedJson(routedReview, 'draft-view-graph-data'), 'building-single embedded DraftViewGraph JSON');
  assertValid(validateObjectSurfaceGraph, readEmbeddedJson(routedReview, 'object-surface-graph-data'), 'building-single embedded ObjectSurfaceGraph JSON');
  assertValid(validateFacadePlaneGraph, readEmbeddedJson(routedReview, 'facade-plane-graph-data'), 'building-single embedded FacadePlaneGraph JSON');
  assertValid(validateCandidatePromotionReview, readEmbeddedJson(routedReview, 'candidate-promotion-review-data'), 'building-single embedded promotion review JSON');
  assert.equal(readEmbeddedJson(routedReview, 'real-world-building-release-summary-data').closes_release_gap, false, 'building-single embedded release summary should not close gap');
  assertValid(validateRealWorldBuildingChecklist, readEmbeddedJson(routedReview, 'real-world-building-release-checklist-data'), 'building-single embedded release checklist JSON');
  assertValid(validateRealWorldBuildingReleaseWorkOrder, readEmbeddedJson(routedReview, 'real-world-building-release-work-order-data'), 'building-single embedded release work order JSON');
  assertValid(validateRealWorldBuildingManifest, JSON.parse(await fs.readFile(path.join(repoRoot, routed.realWorldBuildingReleaseDraft.manifestOutput), 'utf8')), 'building-single saved real-world release manifest draft');
  assertValid(validateRealWorldBuildingReleaseWorkOrder, JSON.parse(await fs.readFile(path.join(repoRoot, routed.realWorldBuildingReleaseDraft.workOrderOutput), 'utf8')), 'building-single saved real-world release work order');
  assertValid(validateRealWorldBuildingSourcePackage, JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'real-world-building-source-package.json'), 'utf8')), 'building-single saved source-package report');
  assert.ok((await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'real-world-building-source-package.md'), 'utf8')).includes('Real-World Building Source Package'), 'building-single saved source-package markdown should include title');
  assertValid(validateRealWorldBuildingSourceRequest, JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'real-world-building-source-request.json'), 'utf8')), 'building-single saved source-request report');
  assert.ok((await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'real-world-building-source-request.md'), 'utf8')).includes('Real-World Building Source Request'), 'building-single saved source-request markdown should include title');
  const routedUploadManifestTemplate = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'upload-manifest.template.json'), 'utf8'));
  assertValid(validateRealWorldBuildingUploadManifest, routedUploadManifestTemplate, 'building-single saved upload manifest template');
  assert.equal(routedUploadManifestTemplate.template_only, true, 'building-single saved upload manifest template should stay template-only');
  assert.ok(routedUploadManifestTemplate.views.some((view) => view.kind === 'top'), 'building-single upload manifest template should include top/plan placeholder');
  assert.equal(routedUploadManifestTemplate.view_source_requirements.blocker, 'view_sources_not_distinct', 'building-single upload manifest template should carry view source diversity blocker');
  await fs.rm(path.join(repoRoot, 'output/image-structured-modeler/intake-building-single-regression/source-refill-package'), { recursive: true, force: true });
  const routedSourceRefillPackage = await prepareRealWorldBuildingSourceRefillPackageCli({
    sourceRequest: 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-request.json',
    outputDir: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package',
    objectType: 'building_single',
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillPackageGuide, routedSourceRefillPackage.guide, 'building-single source refill package guide');
  assertValid(validateRealWorldBuildingUploadManifest, routedSourceRefillPackage.uploadManifestTemplate, 'building-single source refill upload manifest template');
  assert.equal(routedSourceRefillPackage.guide.object_type, 'building_single', 'source refill package guide should preserve object type for manifest validation');
  assert.equal(routedSourceRefillPackage.guide.package_policy.direct_upload_ready, false, 'source refill package guide should not claim direct upload readiness');
  assert.equal(routedSourceRefillPackage.guide.package_policy.manifest_template_only, true, 'source refill package guide should keep manifest template-only');
  assert.equal(routedSourceRefillPackage.guide.package_policy.distinct_source_images_required, true, 'source refill package guide should require distinct view sources');
  assert.ok(routedSourceRefillPackage.guide.source_slots.some((slot) => slot.view === 'top' && slot.suggested_source_image.includes('sources/')), 'source refill package guide should expose top source slot under sources');
  assert.ok(routedSourceRefillPackage.guide.commands.build_manifest_from_sources.includes('build-real-world-building-source-refill-manifest'), 'source refill package guide should expose manifest builder command');
  assert.ok(routedSourceRefillPackage.guide.commands.run_source_refill_workflow.includes('run-real-world-building-source-refill-workflow'), 'source refill package guide should expose source-refill workflow command');
  assert.ok(routedSourceRefillPackage.guide.commands.validate_refill_package.includes('validate-real-world-building-source-refill-package'), 'source refill package guide should expose package validation command');
  assert.ok(routedSourceRefillPackage.guide.commands.require_upload_ready.includes('--require-upload-ready'), 'source refill package guide should expose upload-ready package validation command');
  assert.ok(routedSourceRefillPackage.guide.commands.require_input_ready.includes('--source-request-file'), 'source refill package guide should keep validation tied to source request');
  assert.ok(routedSourceRefillPackage.guide.commands.require_input_ready.includes('--require-source-input-ready'), 'source refill package guide should expose hard input-ready command');
  assert.ok(routedSourceRefillPackage.guide.commands.require_input_ready.includes('/upload-package'), 'source refill package guide should validate the dedicated upload-package directory');
  assert.ok(routedSourceRefillPackage.guide.next_actions.some((action) => action.includes('template_only')), 'source refill package guide should tell users to remove template_only before validation');
  assertValid(
    validateRealWorldBuildingSourceRefillPackageGuide,
    JSON.parse(await fs.readFile(path.join(repoRoot, routedSourceRefillPackage.guideOutput), 'utf8')),
    'saved building-single source refill package guide'
  );
  assert.ok((await fs.readFile(path.join(repoRoot, routedSourceRefillPackage.markdownOutput), 'utf8')).includes('Real-World Building Source Refill Package'), 'source refill package markdown should render title');
  assert.ok((await fs.readFile(path.join(repoRoot, routedSourceRefillPackage.readmeOutput), 'utf8')).includes('Direct upload ready'), 'source refill package README should expose fail-closed upload readiness');
  assert.ok((await fs.readFile(path.join(repoRoot, routedSourceRefillPackage.sourceSlotsReadmeOutput), 'utf8')).includes('front-real-building.jpg'), 'source refill package source slots README should list suggested source files');
  const routedSourceRefillPackageValidation = await validateRealWorldBuildingSourceRefillPackageCli({
    packageDir: routedSourceRefillPackage.outputDir,
    output: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package/source-refill-package-validation.json',
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillPackageValidation, routedSourceRefillPackageValidation.report, 'building-single source refill package template validation');
  assert.equal(routedSourceRefillPackageValidation.status, 'template_package_pending', 'source refill template package should validate as pending');
  assert.equal(routedSourceRefillPackageValidation.ok, true, 'source refill template package should pass fail-closed validation');
  assert.equal(routedSourceRefillPackageValidation.report.can_run_upload_session, false, 'source refill template package should not be upload-session ready');
  assert.equal(routedSourceRefillPackageValidation.report.manifest.expected_object_type, 'building_single', 'source refill validation should expose expected manifest object type');
  assert.ok(routedSourceRefillPackageValidation.report.commands.build_manifest_from_sources.includes('build-real-world-building-source-refill-manifest'), 'source refill package validation should expose manifest builder command');
  assert.ok(routedSourceRefillPackageValidation.report.commands.run_source_refill_workflow.includes('run-real-world-building-source-refill-workflow'), 'source refill package validation should expose workflow command');
  assert.ok(routedSourceRefillPackageValidation.report.commands.require_upload_ready.includes('--require-upload-ready'), 'source refill package validation should expose upload-ready command');
  assert.ok(routedSourceRefillPackageValidation.report.summary.review_checks.includes('real_manifest_present'), 'source refill template validation should review missing real manifest');
  const sourceRefillUploadPackageDir = path.join(repoRoot, routedSourceRefillPackage.guide.output_package.upload_package_directory);
  const sourceRefillSourcesDir = path.join(sourceRefillUploadPackageDir, 'sources');
  await fs.mkdir(sourceRefillSourcesDir, { recursive: true });
  const missingSourceRefillManifestBuild = await buildRealWorldBuildingSourceRefillManifestCli({
    packageDir: routedSourceRefillPackage.outputDir,
    reportOutput: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package/source-refill-manifest-build-missing-report.json',
    force: true,
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillManifestBuildReport, missingSourceRefillManifestBuild.report, 'source refill manifest builder missing-source report');
  assert.equal(missingSourceRefillManifestBuild.status, 'manifest_draft_needs_sources', 'source refill manifest builder should not guess missing source views');
  assert.equal(missingSourceRefillManifestBuild.ok, false, 'source refill manifest builder should report incomplete when source files are missing');
  assert.ok(missingSourceRefillManifestBuild.report.missing_required_views.includes('left'), 'source refill manifest builder should report missing source views');
  const missingSourceRefillWorkflow = await runRealWorldBuildingSourceRefillWorkflowCli({
    packageDir: routedSourceRefillPackage.outputDir,
    output: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package/source-refill-workflow-missing-report.json',
    rebuildManifest: true,
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillWorkflowReport, missingSourceRefillWorkflow.report, 'source refill workflow missing-source report');
  assert.equal(missingSourceRefillWorkflow.status, 'manifest_draft_needs_sources', 'source refill workflow should stop at manifest draft when sources are missing');
  assert.equal(missingSourceRefillWorkflow.ok, false, 'source refill workflow should not pass while source views are missing');
  const sourceRefillBaseImage = path.join(repoRoot, 'projects', 'image-structured-modeler', 'examples', 'building-single-anime-yellow', 'input-visible-crop.png');
  await writeDistinctImageVariant(sourceRefillBaseImage, path.join(sourceRefillSourcesDir, 'front-real-building.jpg'), 11);
  await writeDistinctImageVariant(sourceRefillBaseImage, path.join(sourceRefillSourcesDir, 'left-side-real-building.jpg'), 12);
  await writeDistinctImageVariant(sourceRefillBaseImage, path.join(sourceRefillSourcesDir, 'oblique-real-building.jpg'), 13);
  await writeDistinctImageVariant(sourceRefillBaseImage, path.join(sourceRefillSourcesDir, 'top-or-plan-real-building.jpg'), 14);
  const readySourceRefillManifestBuild = await buildRealWorldBuildingSourceRefillManifestCli({
    packageDir: routedSourceRefillPackage.outputDir,
    reportOutput: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package/source-refill-manifest-build-ready-report.json',
    force: true,
    knownWidth: 9000,
    knownDepth: 12000,
    knownHeight: 10500,
    units: 'mm',
    scaleBasis: 'validate.mjs source refill package ready fixture',
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillManifestBuildReport, readySourceRefillManifestBuild.report, 'source refill manifest builder ready report');
  assert.equal(readySourceRefillManifestBuild.status, 'manifest_ready_for_package_validation', 'source refill manifest builder should produce a validation-ready manifest when named source files exist');
  assert.equal(readySourceRefillManifestBuild.ok, true, 'source refill manifest builder should pass when all required source files are matched');
  assertValid(validateRealWorldBuildingUploadManifest, readySourceRefillManifestBuild.manifest, 'source refill manifest builder output manifest');
  assert.deepEqual(
    readySourceRefillManifestBuild.manifest.views.map((view) => view.source_image).sort(),
    [
      'sources/front-real-building.jpg',
      'sources/left-side-real-building.jpg',
      'sources/oblique-real-building.jpg',
      'sources/top-or-plan-real-building.jpg'
    ].sort(),
    'source refill manifest builder should map all required view files'
  );
  const readySourceRefillWorkflow = await runRealWorldBuildingSourceRefillWorkflowCli({
    packageDir: routedSourceRefillPackage.outputDir,
    output: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package/source-refill-workflow-ready-report.json',
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillWorkflowReport, readySourceRefillWorkflow.report, 'source refill workflow ready report');
  assert.equal(readySourceRefillWorkflow.status, 'ready_for_upload_session', 'source refill workflow should stop at upload-session-ready when upload-session is not requested');
  assert.equal(readySourceRefillWorkflow.ok, true, 'source refill workflow should pass once the refill package is upload-ready');
  assert.equal(readySourceRefillWorkflow.report.steps.find((item) => item.id === 'run_refill_upload_session')?.status, 'skipped', 'source refill workflow should not run upload-session unless requested');
  const sourceRefillManifestBody = readySourceRefillManifestBuild.manifest;
  const wrongKindSourceRefillManifest = {
    ...sourceRefillManifestBody,
    kind: 'wrong_manifest_kind'
  };
  await fs.writeFile(path.join(sourceRefillUploadPackageDir, 'manifest.json'), `${JSON.stringify(wrongKindSourceRefillManifest, null, 2)}\n`, 'utf8');
  const routedSourceRefillWrongKindValidation = await validateRealWorldBuildingSourceRefillPackageCli({
    packageDir: routedSourceRefillPackage.outputDir,
    output: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package/source-refill-package-wrong-kind-validation.json',
    requireUploadReady: true,
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillPackageValidation, routedSourceRefillWrongKindValidation.report, 'building-single source refill wrong-kind package validation');
  assert.equal(routedSourceRefillWrongKindValidation.status, 'invalid_refill_package', 'wrong manifest kind should not be upload-session ready');
  assert.equal(routedSourceRefillWrongKindValidation.report.can_run_upload_session, false, 'wrong manifest kind should block upload-session command');
  assert.ok(routedSourceRefillWrongKindValidation.report.summary.failed_required_checks.includes('real_manifest_kind_valid'), 'wrong manifest kind should fail the manifest kind check');
  assert.equal(routedSourceRefillWrongKindValidation.report.manifest.kind, 'wrong_manifest_kind', 'wrong-kind validation should report submitted manifest kind');
  const sourceRefillRealManifest = {
    ...sourceRefillManifestBody,
    kind: 'real_world_building_upload_manifest'
  };
  await fs.writeFile(path.join(sourceRefillUploadPackageDir, 'manifest.json'), `${JSON.stringify(sourceRefillRealManifest, null, 2)}\n`, 'utf8');
  const routedSourceRefillReadyValidation = await validateRealWorldBuildingSourceRefillPackageCli({
    packageDir: routedSourceRefillPackage.outputDir,
    output: 'output/image-structured-modeler/intake-building-single-regression/source-refill-package/source-refill-package-ready-validation.json',
    requireUploadReady: true,
    generatedAt: '2026-06-18T00:00:00.000Z'
  });
  assertValid(validateRealWorldBuildingSourceRefillPackageValidation, routedSourceRefillReadyValidation.report, 'building-single source refill ready package validation');
  assert.equal(routedSourceRefillReadyValidation.status, 'ready_for_upload_session', 'filled source refill package should be ready for upload-session validation');
  assert.equal(routedSourceRefillReadyValidation.ok, true, 'filled source refill package should satisfy upload-ready validation');
  assert.equal(routedSourceRefillReadyValidation.report.can_run_upload_session, true, 'filled source refill package should allow upload-session command');
  assert.deepEqual(routedSourceRefillReadyValidation.report.summary.failed_required_checks, [], 'filled source refill package should have no failed required checks');
  assert.equal(routedSourceRefillReadyValidation.report.manifest.kind, 'real_world_building_upload_manifest', 'filled source refill package should report manifest kind');
  assert.equal(routedSourceRefillReadyValidation.report.manifest.object_type, 'building_single', 'filled source refill package should report manifest object type');
  assert.equal(routedSourceRefillReadyValidation.report.manifest.duplicate_source_content_groups.length, 0, 'filled source refill package should reject duplicate content and pass distinct files');
  assertValid(
    validateRealWorldBuildingSourcePackageGateResult,
    JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'real-world-building-source-package.gate-result.json'), 'utf8')),
    'building-single saved intake source-package gate-result JSON'
  );
  const routedIntakeSummary = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'intake-building-single-regression', 'intake-summary.json'), 'utf8'));
  assertValid(validateStructuredAssetIntakeSummary, routedIntakeSummary, 'building-single saved intake-summary.json');
  assert.equal(routedIntakeSummary.ok, false, 'building-single saved intake summary should preserve failed source-package hard gate');
  const routedSourcePackageCli = await assessRealWorldBuildingSourcePackageCli({
    intakeDir: 'output/image-structured-modeler/intake-building-single-regression',
    output: 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-package.revalidated.json',
    markdownOutput: 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-package.revalidated.md'
  });
  assertValid(validateRealWorldBuildingSourcePackage, routedSourcePackageCli.report, 'building-single source-package CLI report');
  assert.equal(routedSourcePackageCli.report.status, routed.sourcePackageAssessment.status, 'source-package CLI should reproduce intake source-package status');
  assert.equal(routedSourcePackageCli.report.input_ready_for_release_work, false, 'source-package CLI should keep routed intake blocked');
  assert.equal(routedSourcePackageCli.ok, true, 'source-package CLI default audit mode should not fail blocked intake revalidation');
  assert.deepEqual(routedSourcePackageCli.failedRequirements, [], 'source-package CLI default audit mode should not report failed hard requirements');
  assert.equal(routedSourcePackageCli.gateOutput, null, 'source-package CLI default audit mode should not write a gate-result artifact unless requested');
  assertValid(validateRealWorldBuildingSourcePackageGateResult, routedSourcePackageCli.gateResult, 'building-single source-package CLI default gate result object');
  assert.deepEqual(routedSourcePackageCli.gateResult.required_gates, {
    input_ready_for_release_work: false,
    release_ready: false
  }, 'source-package CLI default gate result should show no required gates');
  assert.ok(routedSourcePackageCli.report.blockers.includes('source_assets_generated_or_scaffold'), 'source-package CLI should preserve source blocker');
  assertValid(validateRealWorldBuildingSourcePackage, JSON.parse(await fs.readFile(path.join(repoRoot, routedSourcePackageCli.output), 'utf8')), 'building-single saved source-package CLI JSON');
  assert.ok((await fs.readFile(path.join(repoRoot, routedSourcePackageCli.markdownOutput), 'utf8')).includes('Real-World Building Source Package'), 'building-single saved source-package CLI markdown should include title');
  const routedSourcePackageCliRequireInputReady = await assessRealWorldBuildingSourcePackageCli({
    intakeDir: 'output/image-structured-modeler/intake-building-single-regression',
    output: 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-package.require-input-ready.json',
    markdownOutput: 'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-package.require-input-ready.md',
    requireInputReady: true
  });
  assertValid(validateRealWorldBuildingSourcePackage, routedSourcePackageCliRequireInputReady.report, 'building-single source-package CLI require-input-ready report');
  assert.equal(routedSourcePackageCliRequireInputReady.ok, false, 'source-package CLI require-input-ready mode should fail blocked routed intake');
  assert.ok(
    routedSourcePackageCliRequireInputReady.failedRequirements.includes('input_ready_for_release_work'),
    'source-package CLI require-input-ready mode should expose failed input-ready requirement'
  );
  assert.equal(
    routedSourcePackageCliRequireInputReady.gateOutput,
    'output/image-structured-modeler/intake-building-single-regression/real-world-building-source-package.require-input-ready.gate-result.json',
    'source-package CLI require-input-ready mode should write a default gate-result artifact'
  );
  assertValid(validateRealWorldBuildingSourcePackageGateResult, routedSourcePackageCliRequireInputReady.gateResult, 'building-single source-package CLI require-input-ready gate result');
  assert.deepEqual(routedSourcePackageCliRequireInputReady.gateResult.failed_requirements, ['input_ready_for_release_work'], 'require-input-ready gate result should preserve failed requirements');
  assertValid(
    validateRealWorldBuildingSourcePackage,
    JSON.parse(await fs.readFile(path.join(repoRoot, routedSourcePackageCliRequireInputReady.output), 'utf8')),
    'building-single saved source-package CLI require-input-ready JSON'
  );
  assertValid(
    validateRealWorldBuildingSourcePackageGateResult,
    JSON.parse(await fs.readFile(path.join(repoRoot, routedSourcePackageCliRequireInputReady.gateOutput), 'utf8')),
    'building-single saved source-package CLI require-input-ready gate result JSON'
  );
  assert.equal(JSON.parse(await fs.readFile(path.join(repoRoot, routed.realWorldBuildingReleaseDraft.contractSummaryOutput), 'utf8')).closes_release_gap, false, 'building-single saved real-world release summary should not close gap');
  assertValid(validateRealWorldBuildingChecklist, JSON.parse(await fs.readFile(path.join(repoRoot, routed.realWorldBuildingReleaseDraft.checklistOutput), 'utf8')), 'building-single saved real-world release checklist draft');
  assert.ok((await fs.readFile(path.join(repoRoot, routed.realWorldBuildingReleaseDraft.checklistMarkdownOutput), 'utf8')).includes('Real-World Building Positive Release Checklist'), 'building-single saved real-world release checklist markdown should include title');
  const selectedReview = {
    ...routed.promotionReview,
    accepted_candidates: routed.candidateGraph.candidates
      .filter((candidate) => ['visible_plane_recessed_left', 'rectangular_utility_ducts'].includes(candidate.role))
      .map((candidate) => ({
        candidate_id: candidate.id,
        role: candidate.role,
        view: candidate.view,
        source_image: candidate.source_image,
        source_observation_id: candidate.source_observation_id,
        confidence: candidate.confidence,
        promotion_status: candidate.promotion.status,
        blockers: candidate.promotion.blockers,
        reviewer_note: 'selected for blocked patch regression'
      }))
  };
  const selectedPatch = buildCandidatePromotionPatch({
    assetSet: routed.assetSet,
    candidateGraph: routed.candidateGraph,
    modelingBrief: routed.modelingBrief,
    promotionReview: selectedReview
  });
  assertValid(validateCandidatePromotionPatch, selectedPatch, 'building-single selected candidate blocked promotion patch');
  assert.equal(selectedPatch.status, 'blocked', 'selected blocked candidates should still produce a blocked promotion patch');
  assert.equal(selectedPatch.apply_allowed, false, 'blocked selected candidate patch should not be applyable');
  assert.equal(selectedPatch.actions.length, 0, 'blocked selected candidate patch should not emit actions');
  const profile = await readRepoJson('examples/product-profiles/building_single_urban_oblique.json');
  assert.throws(
    () => applyCandidatePromotionPatch({
      patch: selectedPatch,
      candidateGraph: routed.candidateGraph,
      observationSet: routed.observationSet,
      profile
    }),
    /Candidate promotion patch is not applyable/,
    'blocked promotion patch must refuse PartGraph application'
  );

  const selectedCandidates = routed.candidateGraph.candidates
    .filter((candidate) => ['visible_plane_recessed_left', 'rectangular_utility_ducts'].includes(candidate.role));
  assert.equal(selectedCandidates.length >= 2, true, 'ready regression should find side recess and duct candidates');
  const readyAssetSet = deepClone(routed.assetSet);
  readyAssetSet.gates.reasons = [];
  const readyCandidateGraph = deepClone(routed.candidateGraph);
  const selectedIds = new Set(selectedCandidates.map((candidate) => candidate.id));
  for (const candidate of readyCandidateGraph.candidates) {
    if (!selectedIds.has(candidate.id)) continue;
    candidate.promotion.status = 'review_required';
    candidate.promotion.blockers = [];
  }
  const readyModelingBrief = deepClone(routed.modelingBrief);
  readyModelingBrief.status = 'ready_for_promotion_review';
  readyModelingBrief.missing_inputs = [];
  readyModelingBrief.blockers = [];
  const acceptedDraftViewSlots = routed.draftViewGraph.view_slots.filter((slot) => slot.status !== 'unknown');
  const acceptedDraftViewReview = {
    ...deepClone(routed.promotionReview.draft_view_review),
    status: 'accepted',
    accepted_view_slot_ids: acceptedDraftViewSlots.map((slot) => slot.slot_id),
    accepted_plane_hypothesis_ids: acceptedDraftViewSlots.flatMap((slot) => slot.visible_regions || []).map((region) => region.id),
    promotion_allowed: true,
    blockers: [],
    reviewer_note: 'Synthetic regression accepts DraftViewGraph before PartGraph promotion.'
  };
  const acceptedSurfaceIds = routed.objectSurfaceGraph.surfaces.map((surface) => surface.id);
  const acceptedDetailIds = [
    ...routed.objectSurfaceGraph.surface_local_feature_candidates.map((detail) => detail.id),
    ...routed.facadePlaneGraph.plane_local_detail_candidates.map((detail) => detail.id)
  ];
  const acceptedLocalDetailReview = {
    ...deepClone(routed.promotionReview.local_detail_review),
    status: 'accepted',
    accepted_surface_ids: acceptedSurfaceIds,
    accepted_detail_ids: acceptedDetailIds,
    detail_bindings: acceptedDetailIds.map((detailId) => ({
      detail_id: detailId,
      target_surface_id: acceptedSurfaceIds[0] || null,
      target_plane_id: routed.facadePlaneGraph.planes[0]?.id || null,
      status: 'accepted'
    })),
    promotion_allowed: true,
    blockers: [],
    reviewer_note: 'Synthetic regression accepts local detail candidates before PartGraph promotion.'
  };
  assertValid(validateDraftViewReviewDecision, acceptedDraftViewReview, 'building-single synthetic accepted draft view review');
  assertValid(validateLocalDetailReviewDecision, acceptedLocalDetailReview, 'building-single synthetic accepted local detail review');
  const readyPromotionReview = {
    ...deepClone(routed.promotionReview),
    reviewer: 'validate.mjs synthetic regression',
    verdict: 'accepted_subset',
    promotion_allowed: true,
    compile_allowed: false,
    missing_inputs: [],
    blockers: [],
    profile_confirmation: {
      selected_profile: 'building_single_urban_oblique',
      status: 'confirmed',
      note: 'Synthetic regression clears profile routing for candidate promotion only.'
    },
    scale_confirmation: {
      status: 'confirmed',
      known_width: profile.default_scale.width,
      known_depth: profile.default_scale.depth,
      known_height: profile.default_scale.height,
      units: 'mm',
      note: 'Synthetic regression uses profile default dimensions; compiler gate must still validate scale confidence.'
    },
    accepted_candidates: selectedCandidates.map((candidate) => ({
      candidate_id: candidate.id,
      role: candidate.role,
      view: candidate.view,
      source_image: candidate.source_image,
      source_observation_id: candidate.source_observation_id,
      confidence: candidate.confidence,
      promotion_status: 'review_required',
      blockers: [],
      reviewer_note: 'synthetic manual acceptance for ready patch regression'
    })),
    held_candidates: readyCandidateGraph.candidates
      .filter((candidate) => !selectedIds.has(candidate.id))
      .map((candidate) => ({
        candidate_id: candidate.id,
        role: candidate.role,
        view: candidate.view,
        source_image: candidate.source_image,
        source_observation_id: candidate.source_observation_id,
        confidence: candidate.confidence,
        promotion_status: candidate.promotion.status,
        blockers: candidate.promotion.blockers
      }))
  };
  assertValid(validateCandidatePromotionReview, readyPromotionReview, 'building-single synthetic promotion review without plane acceptance');
  const noDraftingReviewPatch = buildCandidatePromotionPatch({
    assetSet: readyAssetSet,
    candidateGraph: readyCandidateGraph,
    modelingBrief: readyModelingBrief,
    promotionReview: readyPromotionReview
  });
  assertValid(validateCandidatePromotionPatch, noDraftingReviewPatch, 'building-single no-drafting-review promotion patch');
  assert.equal(noDraftingReviewPatch.status, 'blocked', 'building-single promotion must fail closed without accepted draft/local/facade review');
  assert.equal(noDraftingReviewPatch.apply_allowed, false, 'no-drafting-review patch should not be applyable');
  assert.ok(noDraftingReviewPatch.blockers.includes('accepted_draft_view_review_required'), 'no-drafting-review patch should expose accepted draft view review blocker');
  assert.ok(noDraftingReviewPatch.blockers.includes('accepted_local_detail_review_required'), 'no-drafting-review patch should expose accepted local detail review blocker');
  assert.ok(noDraftingReviewPatch.blockers.includes('accepted_facade_plane_review_required'), 'no-drafting-review patch should expose accepted plane review blocker');
  const readyPromotionReviewWithDrafting = {
    ...readyPromotionReview,
    draft_view_review: acceptedDraftViewReview,
    local_detail_review: acceptedLocalDetailReview
  };
  const noPlaneReviewPatch = buildCandidatePromotionPatch({
    assetSet: readyAssetSet,
    candidateGraph: readyCandidateGraph,
    modelingBrief: readyModelingBrief,
    promotionReview: readyPromotionReviewWithDrafting
  });
  assertValid(validateCandidatePromotionPatch, noPlaneReviewPatch, 'building-single no-plane-review promotion patch');
  assert.equal(noPlaneReviewPatch.status, 'blocked', 'building-single promotion must fail closed without accepted facade plane review');
  assert.equal(noPlaneReviewPatch.apply_allowed, false, 'no-plane-review patch should not be applyable');
  assert.equal(noPlaneReviewPatch.blockers.includes('accepted_draft_view_review_required'), false, 'no-plane-review patch should not keep draft blocker after accepted DraftViewGraph review');
  assert.equal(noPlaneReviewPatch.blockers.includes('accepted_local_detail_review_required'), false, 'no-plane-review patch should not keep local detail blocker after accepted local detail review');
  assert.ok(noPlaneReviewPatch.blockers.includes('accepted_facade_plane_review_required'), 'no-plane-review patch should expose accepted plane review blocker');
  assert.throws(
    () => applyCandidatePromotionPatch({
      patch: {
        ...deepClone(noPlaneReviewPatch),
        status: 'ready_for_part_graph_patch',
        apply_allowed: true,
        actions: selectedCandidates.map((candidate) => ({
          action: 'promote_candidate',
          candidate_id: candidate.id,
          role: candidate.role,
          view: candidate.view,
          source_image: candidate.source_image,
          source_observation_id: candidate.source_observation_id,
          confidence: candidate.confidence,
          requires_part_graph_review: true
        }))
      },
      candidateGraph: readyCandidateGraph,
      observationSet: routed.observationSet,
      profile
    }),
    /accepted facade plane review is required/,
    'applyCandidatePromotionPatch must reject forged building-single patches without accepted plane review'
  );

  const readyPromotionReviewWithPlane = {
    ...readyPromotionReviewWithDrafting,
    facade_plane_review: {
      source_facade_plane_graph: 'facade-plane-graph.json',
      status: 'accepted',
      accepted_plane_ids: routed.facadePlaneGraph.planes.map((plane) => plane.id),
      promotion_allowed: true,
      blockers: [],
      reviewer_note: 'Synthetic regression accepts visible plane graph before PartGraph promotion.'
    }
  };
  assertValid(validateCandidatePromotionReview, readyPromotionReviewWithPlane, 'building-single ready synthetic promotion review with accepted plane graph');
  const readyPatch = buildCandidatePromotionPatch({
    assetSet: readyAssetSet,
    candidateGraph: readyCandidateGraph,
    modelingBrief: readyModelingBrief,
    promotionReview: readyPromotionReviewWithPlane
  });
  assertValid(validateCandidatePromotionPatch, readyPatch, 'building-single ready synthetic promotion patch');
  assert.equal(readyPatch.status, 'ready_for_part_graph_patch', 'cleared accepted candidates should produce a ready promotion patch');
  assert.equal(readyPatch.apply_allowed, true, 'ready promotion patch should be applyable');
  assert.equal(readyPatch.compile_allowed, false, 'ready promotion patch should not directly allow compile');
  assert.equal(readyPatch.actions.length, selectedCandidates.length, 'ready patch should create one action per accepted candidate');
  assert.ok(readyPatch.actions.every((action) => action.accepted_draft_view_slot_id), 'ready patch actions should carry accepted DraftViewGraph slot ids');
  assert.ok(readyPatch.actions.every((action) => action.accepted_surface_id || action.accepted_detail_id), 'ready patch actions should carry accepted surface/detail ids');
  const applied = applyCandidatePromotionPatch({
    patch: readyPatch,
    candidateGraph: readyCandidateGraph,
    observationSet: routed.observationSet,
    profile,
    id: 'building-single-ready-promotion-regression',
    productName: 'Building Single Ready Promotion Regression'
  });
  assert.equal(applied.applied.length, selectedCandidates.length, 'ready promotion patch should apply selected candidates');
  assertValid(validatePartGraph, applied.partGraph, 'building-single ready promotion PartGraph');
  assert.equal(applied.partGraph.parts.length, selectedCandidates.length, 'ready promotion PartGraph should contain promoted selected candidates');
  assert.equal(applied.partGraph.parts.every((part) => part.promoted_geometry === true), true, 'applied candidates should be marked promoted geometry');
  assert.equal(applied.partGraph.parts.every((part) => part.review_required === true), true, 'applied candidates should still require PartGraph review');
  assert.equal(applied.partGraph.parts.every((part) => part.qa?.candidate_promotion_applied === true), true, 'applied candidates should carry promotion QA provenance');
  assert.equal(applied.partGraph.parts.every((part) => part.qa?.accepted_draft_view_slot_id), true, 'applied candidates should preserve accepted draft view provenance');
  assert.ok(applied.partGraph.parts.some((part) => part.role === 'visible_plane_recessed_left'), 'ready promotion should preserve recessed side facade role');
  assert.ok(applied.partGraph.parts.some((part) => part.role === 'rectangular_utility_ducts'), 'ready promotion should preserve rectangular duct role');
  assert.throws(
    () => compilePartGraphToSketchUpDsl(applied.partGraph, profile, { repoRoot }),
    /PartGraph compile blocked by geometry gate/,
    'candidate-promoted PartGraph must still pass compiler geometry gates before SketchUp output'
  );
}

async function assertDraftingFirstBenchmarkReports() {
  const tier0 = await runDraftingFirstBenchmark({
    tier: 'tier0',
    output: 'output/image-structured-benchmark/regression-tier0/benchmark-report.json'
  });
  assertValid(validateImageStructuredBenchmarkReport, tier0.report, 'Drafting-first Tier0 benchmark report');
  assert.equal(tier0.report.status, 'review', 'Tier0 benchmark should require review rather than pass or fail');
  assert.equal(tier0.report.false_promotion_count, 0, 'Tier0 benchmark must not allow false promotions');
  for (const id of [
    'yellow_building_single',
    'building_group',
    'building_real_photo_smoke',
    'switch_controller',
    'compact_remote',
    'ambulance',
    'fuji_camera_profile_reference'
  ]) {
    assert.ok(tier0.report.cases.some((item) => item.id === id), `Tier0 benchmark should include ${id}`);
  }
  const yellowCase = tier0.report.cases.find((item) => item.id === 'yellow_building_single');
  assert.equal(yellowCase.status, 'review', 'yellow building Tier0 benchmark should stay review-gated');
  assert.equal(yellowCase.metrics.false_promotion_count, 0, 'yellow building benchmark must not promote geometry without accepted review');
  assert.ok(yellowCase.artifacts.draft_view_graph?.endsWith('draft-view-graph.json'), 'yellow building benchmark should expose DraftViewGraph artifact');
  const cameraCase = tier0.report.cases.find((item) => item.id === 'fuji_camera_profile_reference');
  assert.equal(cameraCase.status, 'review', 'camera profile Tier0 case should be profile-reference review coverage');
  assert.equal(cameraCase.metrics.false_promotion_count, 0, 'camera profile reference must not count as image promotion');

  const savedTier0 = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-benchmark', 'regression-tier0', 'benchmark-report.json'), 'utf8'));
  assertValid(validateImageStructuredBenchmarkReport, savedTier0, 'saved Drafting-first Tier0 benchmark report');

  const tier1 = await runDraftingFirstBenchmark({
    tier: 'tier1',
    manifest: 'projects/image-structured-modeler/benchmarks/tier1-external-sample-manifest.json',
    output: 'output/image-structured-benchmark/regression-tier1/benchmark-report.json'
  });
  assertValid(validateImageStructuredBenchmarkReport, tier1.report, 'Drafting-first Tier1 benchmark report');
  assert.equal(tier1.report.status, 'blocked_external_dataset_unavailable', 'Tier1 benchmark should block cleanly when external samples are not prepared');
  assert.equal(tier1.report.false_promotion_count, 0, 'Tier1 adapter benchmark must not allow false promotions');
  assert.ok(tier1.report.cases.every((item) => item.status === 'blocked_external_dataset_unavailable'), 'Tier1 manifest samples should remain external-data blocked by default');
  const savedTier1 = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-benchmark', 'regression-tier1', 'benchmark-report.json'), 'utf8'));
  assertValid(validateImageStructuredBenchmarkReport, savedTier1, 'saved Drafting-first Tier1 benchmark report');

  return {
    tier0_cases: tier0.report.summary.case_count,
    tier1_cases: tier1.report.summary.case_count,
    false_promotion_count: tier0.report.false_promotion_count + tier1.report.false_promotion_count
  };
}

async function assertImageStructuredReleaseGate() {
  const report = await runImageStructuredReleaseGate({
    outputDir: 'output/image-structured-modeler/release-gate-regression',
    buildingSingleInput: 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png',
    writeOverlays: false
  });
  assertValid(validateReleaseGateReport, report, 'image structured release gate report');
  assert.equal(report.ok, true, 'release gate hard cases should pass');
  assert.equal(report.release_ready, false, 'release gate must not claim publish readiness while release gaps remain');
  assert.equal(report.verdict, 'technical_baseline', 'release gate should report current technical baseline');
  assert.ok(report.remaining_release_gaps.includes('real_world_building_positive_release_sample_missing'), 'release gate should require a real-world building positive release sample');
  assert.equal(report.remaining_release_gaps.includes('real_world_positive_release_sample_missing'), false, 'release gate should close the broad real-world positive gap after adding the real product-photo sample');
  assert.equal(report.remaining_release_gaps.includes('building_single_semantic_release_matrix_missing'), false, 'release gate should close the building-single semantic release-matrix gap');
  assert.equal(report.remaining_release_gaps.includes('pdf_cad_parser_release_matrix_missing'), false, 'release gate should close the PDF/CAD parser release-matrix gap');
  assert.equal(report.remaining_release_gaps.includes('human_review_ui_release_matrix_missing'), false, 'release gate should close the human review UI release-matrix gap');
  assert.equal(report.summary.release_gaps, 1, 'release gate should keep only the real-world building positive release gap visible');
  assert.equal(report.summary.hard_cases, 22, 'release gate should cover twenty-two hard cases');
  for (const id of [
    'unknown_negative_fail_closed',
    'real_world_building_source_package_preflight_fixture',
    'real_world_building_upload_session_fixture',
    'real_world_building_upload_session_generated_view_hints_fixture',
    'pdf_cad_assetset_fail_closed',
    'pdf_cad_parser_positive_review_gate',
    'pdf_cad_parser_release_matrix_fixture',
    'document_review_patch_roundtrip_fixture',
    'building_single_semantic_matrix_fixture',
    'building_single_semantic_evidence_matrix',
    'building_single_blocked_demo',
    'mcp_modeling_brief_export_fixture',
    'synthetic_ready_promotion_path',
    'human_review_roundtrip_matrix_fixture',
    'human_review_ui_release_matrix_fixture',
    'accepted_positive_release_sample_fixture',
    'real_world_positive_switch_product_fixture',
    'real_world_building_formal_manifest_write_guard',
    'real_world_building_positive_manifest_contract',
    'building_single_rhino_factory_visual_gap_guard',
    'real_world_building_demo_candidate_audit_fixture',
    'release_gate_artifact_integrity'
  ]) {
    const testCase = report.cases.find((item) => item.id === id);
    assert.ok(testCase, `release gate should include ${id}`);
    assert.equal(testCase.ok, true, `${id} should pass`);
  }
  const preflightCase = report.cases.find((item) => item.id === 'real_world_building_source_package_preflight_fixture');
  assert.equal(preflightCase.metrics.blocked_release_source_candidate, false, 'release gate preflight should reject generated/cropped source as release-source candidate');
  assert.equal(preflightCase.metrics.blocked_can_start_structured_intake, true, 'release gate preflight should still allow blocked source to enter review/demo intake');
  assert.equal(preflightCase.metrics.ready_release_source_candidate, true, 'release gate preflight should accept upload-shaped source package');
  assert.equal(preflightCase.metrics.invalid_manifest_release_source_candidate, false, 'release gate preflight should reject invalid upload manifest as release-source candidate');
  assert.ok(preflightCase.metrics.invalid_manifest_blockers.includes('invalid_source_metadata'), 'release gate preflight should expose invalid metadata blocker');
  assert.ok(preflightCase.metrics.invalid_manifest_metadata_statuses.includes('invalid_contract'), 'release gate preflight should record invalid manifest contract status');
  assert.equal(preflightCase.metrics.template_manifest_status, 'blocked_source_metadata', 'release gate preflight should reject template-only upload manifest');
  assert.ok(preflightCase.metrics.template_manifest_blockers.includes('invalid_source_metadata'), 'release gate preflight should expose template-only metadata blocker');
  assert.ok(preflightCase.metrics.template_manifest_metadata_statuses.includes('invalid_contract'), 'release gate preflight should record template-only manifest contract status');
  assert.equal(preflightCase.metrics.single_source_multiview_status, 'blocked_source_assets', 'release gate preflight should reject one source path reused across required views');
  assert.equal(preflightCase.metrics.single_source_multiview_release_source_candidate, false, 'release gate preflight should keep single-source multiview out of release-source candidate state');
  assert.ok(preflightCase.metrics.single_source_multiview_blockers.includes('view_sources_not_distinct'), 'release gate preflight should expose view source diversity blocker');
  assert.equal(preflightCase.metrics.single_source_multiview_diversity_status, 'fail', 'release gate preflight should fail view source diversity');
  for (const view of ['front', 'left', 'oblique', 'top']) {
    assert.ok(preflightCase.metrics.ready_hinted_views.includes(view), `release gate preflight should record ${view} view hint`);
  }
  const preflightBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'source-package-preflight');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, JSON.parse(await fs.readFile(path.join(preflightBase, 'blocked', 'preflight.json'), 'utf8')), 'release gate blocked preflight JSON');
  assertValid(validateRealWorldBuildingSourcePackagePreflight, JSON.parse(await fs.readFile(path.join(preflightBase, 'real-upload', 'preflight.json'), 'utf8')), 'release gate ready preflight JSON');
  const invalidManifestPreflight = JSON.parse(await fs.readFile(path.join(preflightBase, 'invalid-manifest', 'preflight.json'), 'utf8'));
  assertValid(validateRealWorldBuildingSourcePackagePreflight, invalidManifestPreflight, 'release gate invalid manifest preflight JSON');
  assert.equal(invalidManifestPreflight.status, 'blocked_source_metadata', 'release gate invalid manifest preflight should expose metadata block status');
  assert.equal(invalidManifestPreflight.metadata_files[0].status, 'invalid_contract', 'release gate invalid manifest preflight should preserve invalid_contract status');
  assert.equal(invalidManifestPreflight.view_package.sources.some((source) => source.source === 'upload_manifest'), false, 'release gate invalid manifest should not provide upload-manifest view hints');
  const templateManifestPreflight = JSON.parse(await fs.readFile(path.join(preflightBase, 'template-manifest', 'preflight.json'), 'utf8'));
  assertValid(validateRealWorldBuildingSourcePackagePreflight, templateManifestPreflight, 'release gate template manifest preflight JSON');
  assert.equal(templateManifestPreflight.status, 'blocked_source_metadata', 'release gate template manifest preflight should expose metadata block status');
  assert.equal(templateManifestPreflight.metadata_files[0].status, 'invalid_contract', 'release gate template manifest preflight should preserve invalid_contract status');
  assert.ok(templateManifestPreflight.metadata_files[0].errors.some((error) => error.includes('template_only upload manifest')), 'release gate template manifest preflight should explain template-only protection');
  const singleSourceMultiviewPreflight = JSON.parse(await fs.readFile(path.join(preflightBase, 'single-source-multiview', 'preflight.json'), 'utf8'));
  assertValid(validateRealWorldBuildingSourcePackagePreflight, singleSourceMultiviewPreflight, 'release gate single-source multiview preflight JSON');
  assert.equal(singleSourceMultiviewPreflight.status, 'blocked_source_assets', 'release gate single-source multiview preflight should block source assets');
  assert.deepEqual(singleSourceMultiviewPreflight.view_package.missing_hinted_views, [], 'release gate single-source multiview preflight should expose that labels are complete');
  assert.equal(singleSourceMultiviewPreflight.view_package.view_source_diversity.status, 'fail', 'release gate single-source multiview preflight should fail diversity');
  assert.ok((await fs.readFile(path.join(preflightBase, 'blocked', 'preflight.md'), 'utf8')).includes('Real-World Building Source Package Preflight'), 'release gate blocked preflight markdown should exist');
  assert.ok((await fs.readFile(path.join(preflightBase, 'invalid-manifest', 'preflight.md'), 'utf8')).includes('invalid_contract'), 'release gate invalid manifest markdown should expose contract failure');
  const uploadSessionCase = report.cases.find((item) => item.id === 'real_world_building_upload_session_fixture');
  assert.equal(uploadSessionCase.metrics.session_ok, false, 'release gate upload session should preserve failed requested gates');
  assert.equal(uploadSessionCase.metrics.session_status, 'blocked_preflight', 'release gate upload session should expose preflight block');
  assert.equal(uploadSessionCase.metrics.source_package_gate_ok, false, 'release gate upload session source gate should fail');
  assert.equal(uploadSessionCase.metrics.can_generate_sketchup_dsl, false, 'release gate upload session should forbid direct DSL');
  assert.ok(uploadSessionCase.metrics.source_package_summary_blockers.includes('source_assets_generated_or_scaffold'), 'release gate upload session should expose source-package summary blockers');
  assert.ok(uploadSessionCase.metrics.source_package_summary_failed_requirements.includes('input_ready_for_release_work'), 'release gate upload session should expose source-package failed requirements');
  assert.ok(uploadSessionCase.metrics.preflight_metadata_statuses.includes('parsed'), 'release gate upload session should expose preflight metadata statuses');
  assert.ok(uploadSessionCase.metrics.source_request_artifact.endsWith('real-world-building-source-request.json'), 'release gate upload session should expose source request artifact metric');
  assert.ok(uploadSessionCase.metrics.upload_manifest_template.endsWith('upload-manifest.template.json'), 'release gate upload session should expose upload manifest template metric');
  assert.ok(uploadSessionCase.metrics.invalid_manifest_preflight_blockers.includes('invalid_source_metadata'), 'release gate upload session should expose invalid manifest metadata blocker');
  assert.ok(uploadSessionCase.metrics.invalid_manifest_metadata_statuses.includes('invalid_contract'), 'release gate upload session should expose invalid manifest metadata status');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_status, 'blocked_preflight', 'release gate upload session should block single-source multiview package at preflight');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_preflight_blockers.includes('view_sources_not_distinct'), 'release gate upload session should expose single-source multiview blocker');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_view_source_diversity_status, 'fail', 'release gate upload session should expose view source diversity failure');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_view_hints_artifact, null, 'release gate upload session should not expose generated view hints for conflicted labels');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_response_session_status, 'blocked_preflight', 'release gate upload session should block bad source-request refill at preflight');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_response_preflight_blockers.includes('view_sources_not_distinct'), 'release gate upload session should expose bad refill diversity blocker');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_response_source_request_response_status, 'partially_satisfied', 'release gate bad refill should not satisfy previous source request');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_response_ok, false, 'release gate bad refill should fail source-request response gate');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_response_check_status, 'fail', 'release gate bad refill should expose failed diversity check status');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_response_check_satisfied, false, 'release gate bad refill should fail diversity response check');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_response_unsatisfied_checks > 0, 'release gate bad refill should expose unsatisfied response checks');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_response_unsatisfied_check_ids.includes('view_source_diversity'), 'release gate bad refill should expose diversity failure id in metrics');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_response_unsatisfied_check_details.some((detail) => detail.id === 'view_source_diversity' && detail.current_status === 'fail'), 'release gate bad refill should expose diversity failure detail in metrics');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_response_mcp_gate_status, 'partially_satisfied', 'release gate bad refill should expose response gate status in MCP brief metrics');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_response_mcp_reason_ids.includes('source_request_response_failed'), 'release gate bad refill should expose MCP response blocker metric');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_response_artifact.endsWith('source-request-response.json'), 'release gate bad refill should expose response artifact metric');
  assert.equal(uploadSessionCase.metrics.workflow_stage, 'source_refill_required', 'release gate blocked upload session should expose refill workflow stage metric');
  assert.ok(uploadSessionCase.metrics.workflow_required_user_inputs.includes('release_source_candidate'), 'release gate blocked upload session should expose workflow required inputs metric');
  assert.equal(uploadSessionCase.metrics.release_artifact_workspace_status, 'blocked_needs_source_refill', 'release gate blocked upload session should expose blocked workspace status');
  assert.equal(uploadSessionCase.metrics.release_artifact_workspace_artifact_count, 3, 'release gate blocked upload session should expose required artifact workspace roles');
  assert.equal(uploadSessionCase.metrics.release_artifact_workspace_validation_status, 'blocked_needs_source_refill_validated', 'release gate blocked upload session should validate fail-closed workspace status');
  assert.deepEqual(uploadSessionCase.metrics.release_artifact_workspace_validation_failed_required_checks, [], 'release gate blocked workspace validation should have no failed required checks');
  assert.equal(uploadSessionCase.metrics.vision_evidence_review_items >= 4, true, 'release gate blocked upload session should expose VisionEvidence review items');
  assert.equal(uploadSessionCase.metrics.vision_evidence_semantic_candidate_review_items >= 3, true, 'release gate blocked upload session should expose semantic VisionEvidence review items');
  assert.ok(uploadSessionCase.metrics.vision_evidence_review_patch.endsWith('vision-evidence-review-patch.json'), 'release gate blocked upload session should expose VisionEvidence patch artifact');
  assert.ok(uploadSessionCase.metrics.vision_evidence_review_workbench.endsWith('vision-evidence-review/index.html'), 'release gate blocked upload session should expose VisionEvidence workbench artifact');
  assert.equal(uploadSessionCase.metrics.invalid_manifest_workflow_stage, 'source_refill_required', 'release gate invalid manifest should expose refill workflow stage metric');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_workflow_stage, 'source_refill_required', 'release gate single-source multiview should expose refill workflow stage metric');
  assert.equal(uploadSessionCase.metrics.single_source_multiview_response_workflow_stage, 'source_response_refill_required', 'release gate bad refill should expose response refill workflow stage metric');
  assert.ok(uploadSessionCase.metrics.single_source_multiview_response_workflow_required_user_inputs.includes('source_request_response:view_source_diversity'), 'release gate bad refill should expose failed workflow response check metric');
  const uploadSessionBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'upload-session-blocked');
  assertValid(validateRealWorldBuildingUploadSession, JSON.parse(await fs.readFile(path.join(uploadSessionBase, 'upload-session-summary.json'), 'utf8')), 'release gate upload-session summary JSON');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspace, JSON.parse(await fs.readFile(path.join(uploadSessionBase, 'release-artifact-workspace.json'), 'utf8')), 'release gate blocked upload-session release artifact workspace JSON');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspaceValidation, JSON.parse(await fs.readFile(path.join(uploadSessionBase, 'release-artifact-workspace-validation.json'), 'utf8')), 'release gate blocked upload-session release artifact workspace validation JSON');
  assertValid(validateStructuredAssetIntakeSummary, JSON.parse(await fs.readFile(path.join(uploadSessionBase, 'intake', 'intake-summary.json'), 'utf8')), 'release gate upload-session intake summary JSON');
  const uploadSessionVisionReviewPatch = JSON.parse(await fs.readFile(path.join(uploadSessionBase, 'intake', 'vision-evidence-review-patch.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewPatch, uploadSessionVisionReviewPatch, 'release gate upload-session VisionEvidence review patch JSON');
  assertSemanticReviewItemHasEvidenceInstance(uploadSessionVisionReviewPatch, 'visible_plane_recessed_left', 'release gate upload-session VisionEvidence patch should locate recessed visible plane evidence');
  assertSemanticReviewItemHasEvidenceInstance(uploadSessionVisionReviewPatch, 'rectangular_utility_ducts', 'release gate upload-session VisionEvidence patch should locate duct evidence');
  assertValid(validateRealWorldBuildingSourceRequest, JSON.parse(await fs.readFile(path.join(uploadSessionBase, 'intake', 'real-world-building-source-request.json'), 'utf8')), 'release gate upload-session source request JSON');
  assertValid(validateRealWorldBuildingUploadManifest, JSON.parse(await fs.readFile(path.join(uploadSessionBase, 'intake', 'upload-manifest.template.json'), 'utf8')), 'release gate upload-session manifest template JSON');
  const invalidManifestUploadSessionBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'upload-session-invalid-manifest', 'session');
  const invalidManifestUploadSessionSummary = JSON.parse(await fs.readFile(path.join(invalidManifestUploadSessionBase, 'upload-session-summary.json'), 'utf8'));
  assertValid(validateRealWorldBuildingUploadSession, invalidManifestUploadSessionSummary, 'release gate invalid-manifest upload-session summary JSON');
  assert.equal(invalidManifestUploadSessionSummary.preflight.status, 'blocked_source_metadata', 'release gate invalid-manifest upload-session should preserve metadata preflight status');
  assert.equal(invalidManifestUploadSessionSummary.preflight.metadata_files[0].status, 'invalid_contract', 'release gate invalid-manifest upload-session should preserve metadata status in summary');
  assert.equal(invalidManifestUploadSessionSummary.artifacts.view_hints, null, 'release gate invalid-manifest upload-session should not write generated view hints');
  assert.ok((await fs.readFile(path.join(invalidManifestUploadSessionBase, 'upload-session-summary.md'), 'utf8')).includes('invalid_contract'), 'release gate invalid-manifest upload-session markdown should expose metadata status');
  const singleSourceMultiviewUploadSessionBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'upload-session-single-source-multiview', 'session');
  const singleSourceMultiviewUploadSessionSummary = JSON.parse(await fs.readFile(path.join(singleSourceMultiviewUploadSessionBase, 'upload-session-summary.json'), 'utf8'));
  assertValid(validateRealWorldBuildingUploadSession, singleSourceMultiviewUploadSessionSummary, 'release gate single-source multiview upload-session summary JSON');
  assert.equal(singleSourceMultiviewUploadSessionSummary.preflight.status, 'blocked_source_assets', 'release gate single-source multiview upload-session should preserve preflight status');
  assert.equal(singleSourceMultiviewUploadSessionSummary.preflight.view_source_diversity.status, 'fail', 'release gate single-source multiview upload-session should expose diversity status');
  assert.equal(singleSourceMultiviewUploadSessionSummary.artifacts.view_hints, null, 'release gate single-source multiview upload-session should not write generated view hints');
  assert.equal(await pathExists(path.join(singleSourceMultiviewUploadSessionBase, 'view-hints.generated.json')), false, 'release gate single-source multiview upload-session should not create view hints artifact');
  const singleSourceMultiviewResponseUploadSessionBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'upload-session-single-source-multiview-response', 'session');
  const singleSourceMultiviewResponseUploadSessionSummary = JSON.parse(await fs.readFile(path.join(singleSourceMultiviewResponseUploadSessionBase, 'upload-session-summary.json'), 'utf8'));
  const singleSourceMultiviewResponse = JSON.parse(await fs.readFile(path.join(singleSourceMultiviewResponseUploadSessionBase, 'source-request-response.json'), 'utf8'));
  const singleSourceMultiviewResponseMcpBrief = JSON.parse(await fs.readFile(path.join(singleSourceMultiviewResponseUploadSessionBase, 'intake', 'mcp-modeling-brief.json'), 'utf8'));
  const singleSourceMultiviewResponseReview = await fs.readFile(path.join(singleSourceMultiviewResponseUploadSessionBase, 'intake', 'review', 'index.html'), 'utf8');
  const singleSourceMultiviewResponseEmbeddedMcpBrief = readEmbeddedJson(singleSourceMultiviewResponseReview, 'mcp-modeling-brief-data');
  const singleSourceMultiviewResponseCheck = singleSourceMultiviewResponse.checks.find((check) => check.id === 'view_source_diversity');
  assertValid(validateRealWorldBuildingUploadSession, singleSourceMultiviewResponseUploadSessionSummary, 'release gate single-source multiview response upload-session summary JSON');
  assertValid(validateRealWorldBuildingSourceRequestResponse, singleSourceMultiviewResponse, 'release gate single-source multiview source-request response JSON');
  assertValid(validateMcpModelingBrief, singleSourceMultiviewResponseMcpBrief, 'release gate single-source multiview response MCP brief JSON');
  assertValid(validateMcpModelingBrief, singleSourceMultiviewResponseEmbeddedMcpBrief, 'release gate single-source multiview response embedded MCP brief JSON');
  assert.equal(singleSourceMultiviewResponseUploadSessionSummary.status, 'blocked_preflight', 'release gate single-source multiview response upload-session should preserve preflight block status');
  assert.equal(singleSourceMultiviewResponseUploadSessionSummary.gates.source_request_response_ok, false, 'release gate single-source multiview response upload-session should fail response gate');
  assert.equal(singleSourceMultiviewResponseUploadSessionSummary.source_request_response.ok, false, 'release gate single-source multiview response summary should be not ok');
  assert.equal(singleSourceMultiviewResponseUploadSessionSummary.source_request_response.status, 'partially_satisfied', 'release gate single-source multiview response summary should be partial');
  assert.ok(singleSourceMultiviewResponseUploadSessionSummary.source_request_response.unsatisfied_checks > 0, 'release gate single-source multiview response summary should expose unsatisfied checks');
  assert.ok(singleSourceMultiviewResponseUploadSessionSummary.source_request_response.unsatisfied_check_ids.includes('view_source_diversity'), 'release gate single-source multiview response summary should expose failed check ids');
  assert.ok(singleSourceMultiviewResponseUploadSessionSummary.source_request_response.unsatisfied_check_details.some((detail) => detail.id === 'view_source_diversity' && detail.current_status === 'fail'), 'release gate single-source multiview response summary should expose failed check details');
  assert.equal(singleSourceMultiviewResponseUploadSessionSummary.artifacts.view_hints, null, 'release gate single-source multiview response upload-session should not write generated view hints');
  assert.equal(await pathExists(path.join(singleSourceMultiviewResponseUploadSessionBase, 'view-hints.generated.json')), false, 'release gate single-source multiview response upload-session should not create view hints artifact');
  assert.ok(singleSourceMultiviewResponseCheck, 'release gate single-source multiview response should include view_source_diversity check');
  assert.equal(singleSourceMultiviewResponseCheck.requested, true, 'release gate single-source multiview response should request diversity check');
  assert.equal(singleSourceMultiviewResponseCheck.satisfied, false, 'release gate single-source multiview response should fail diversity check');
  assert.equal(singleSourceMultiviewResponseCheck.current_status, 'fail', 'release gate single-source multiview response should expose failed diversity status');
  assert.ok(singleSourceMultiviewResponse.summary.unsatisfied_check_ids.includes('view_source_diversity'), 'release gate single-source multiview response artifact should expose failed check ids');
  assert.ok(singleSourceMultiviewResponse.summary.expected_check_ids.includes('view_source_diversity'), 'release gate single-source multiview response artifact should expose expected check ids');
  assert.deepEqual(singleSourceMultiviewResponse.summary.missing_expected_check_ids, [], 'release gate single-source multiview response artifact should cover expected checks even when unsatisfied');
  assert.ok(Array.isArray(singleSourceMultiviewResponse.summary.view_evidence.requested_view_evidence), 'release gate single-source multiview response artifact should expose requested view evidence');
  assert.ok(Array.isArray(singleSourceMultiviewResponse.summary.semantic_evidence.current_covered_roles), 'release gate single-source multiview response artifact should expose semantic evidence summary');
  assert.ok(Array.isArray(singleSourceMultiviewResponse.summary.semantic_evidence.role_evidence), 'release gate single-source multiview response artifact should expose semantic role evidence');
  assert.ok(singleSourceMultiviewResponse.summary.unsatisfied_check_details.some((detail) => detail.id === 'view_source_diversity' && detail.current_status === 'fail'), 'release gate single-source multiview response artifact should expose failed check details');
  assert.equal(singleSourceMultiviewResponseMcpBrief.source_request_response_gate.status, 'partially_satisfied', 'release gate single-source multiview response MCP brief should carry response gate status');
  assert.ok(singleSourceMultiviewResponseMcpBrief.source_request_response_gate.expected_check_ids.includes('view_source_diversity'), 'release gate single-source multiview response MCP brief should expose expected check ids');
  assert.deepEqual(singleSourceMultiviewResponseMcpBrief.source_request_response_gate.missing_expected_check_ids, [], 'release gate single-source multiview response MCP brief should expose no missing expected checks');
  assert.ok(Array.isArray(singleSourceMultiviewResponseMcpBrief.source_request_response_gate.view_evidence.requested_view_evidence), 'release gate single-source multiview response MCP brief should expose requested view evidence');
  assert.ok(Array.isArray(singleSourceMultiviewResponseMcpBrief.source_request_response_gate.semantic_evidence.current_covered_roles), 'release gate single-source multiview response MCP brief should expose semantic evidence summary');
  assert.ok(Array.isArray(singleSourceMultiviewResponseMcpBrief.source_request_response_gate.semantic_evidence.role_evidence), 'release gate single-source multiview response MCP brief should expose semantic role evidence');
  assert.ok(singleSourceMultiviewResponseMcpBrief.source_request_response_gate.unsatisfied_check_ids.includes('view_source_diversity'), 'release gate single-source multiview response MCP brief should expose failed check ids');
  assert.ok(singleSourceMultiviewResponseMcpBrief.compile_permission.reasons.includes('source_request_response_failed'), 'release gate single-source multiview response MCP brief should expose response gate blocker');
  assert.ok(singleSourceMultiviewResponseMcpBrief.agent_contract.output_policy.blockers.includes('source_request_response_failed'), 'release gate single-source multiview response MCP agent contract should expose response gate blocker');
  assert.ok(singleSourceMultiviewResponseMcpBrief.agent_contract.required_confirmations.some((item) => item.includes('view_source_diversity')), 'release gate single-source multiview response MCP agent contract should request resolving diversity check');
  assert.ok(singleSourceMultiviewResponseMcpBrief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'source_request_response'), 'release gate single-source multiview response MCP brief should list response artifact');
  assert.equal(singleSourceMultiviewResponseEmbeddedMcpBrief.source_request_response_gate.status, 'partially_satisfied', 'release gate single-source multiview response review workbench should embed response-aware MCP brief');
  assert.ok(singleSourceMultiviewResponseEmbeddedMcpBrief.source_request_response_gate.unsatisfied_check_ids.includes('view_source_diversity'), 'release gate single-source multiview response review workbench should embed failed response check ids');
  assert.ok(singleSourceMultiviewResponseReview.includes('source_request_response=partially_satisfied'), 'release gate single-source multiview response review workbench should render response gate status');
  assert.ok(singleSourceMultiviewResponseReview.includes('view_source_diversity'), 'release gate single-source multiview response review workbench should render failed response check ids');
  assert.ok((await fs.readFile(path.join(singleSourceMultiviewResponseUploadSessionBase, 'source-request-response.md'), 'utf8')).includes('view_source_diversity'), 'release gate single-source multiview response markdown should expose diversity check');
  const generatedViewHintsCase = report.cases.find((item) => item.id === 'real_world_building_upload_session_generated_view_hints_fixture');
  assert.equal(generatedViewHintsCase.metrics.session_ok, true, 'release gate generated-view-hints upload session should pass requested preflight gate');
  assert.equal(generatedViewHintsCase.metrics.session_status, 'ready_for_review_work', 'release gate generated-view-hints upload session should enter review work');
  assert.equal(generatedViewHintsCase.metrics.preflight_release_source_candidate, true, 'release gate generated-view-hints upload session should preserve release-source candidate status');
  assert.ok(generatedViewHintsCase.metrics.preflight_metadata_statuses.includes('parsed'), 'release gate generated-view-hints upload session should expose parsed preflight metadata status');
  assert.equal(generatedViewHintsCase.metrics.preflight_view_source_diversity_status, 'pass', 'release gate generated-view-hints upload session should preserve view source diversity pass status');
  assert.equal(generatedViewHintsCase.metrics.source_package_gate_ok, true, 'release gate generated-view-hints upload session source input gate should pass');
  assert.deepEqual(generatedViewHintsCase.metrics.source_package_summary_failed_requirements, [], 'release gate generated-view-hints upload session should expose no source-package input gate failures');
  assert.ok(generatedViewHintsCase.metrics.source_package_view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'release gate generated-view-hints upload session should expose source-package view evidence metric');
  assert.ok(generatedViewHintsCase.metrics.source_package_semantic_role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'release gate generated-view-hints upload session should expose semantic role evidence metric');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedViewHintsCase.metrics.source_package_semantic_evidence_quality.status), 'release gate generated-view-hints upload session should expose semantic evidence quality metric');
  assert.equal(generatedViewHintsCase.metrics.source_package_semantic_evidence_quality.geometry_promotion_allowed, false, 'release gate generated-view-hints semantic quality should block geometry promotion');
  assert.ok(generatedViewHintsCase.metrics.source_package_summary_release_checklist_blockers.includes('artifacts'), 'release gate generated-view-hints upload session should expose source-package release blockers');
  assert.ok(generatedViewHintsCase.metrics.source_package_gate_result.endsWith('real-world-building-source-package.gate-result.json'), 'release gate generated-view-hints upload session should expose source-package gate result');
  assert.equal(generatedViewHintsCase.metrics.source_request_status, 'input_ready_for_release_work', 'release gate generated-view-hints upload session should expose source request status');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedViewHintsCase.metrics.source_request_semantic_evidence_quality.status), 'release gate generated-view-hints source request should expose semantic evidence quality');
  assert.equal(generatedViewHintsCase.metrics.source_request_semantic_evidence_quality.geometry_promotion_allowed, false, 'release gate generated-view-hints source request should keep semantic evidence quality review-gated');
  assert.equal(generatedViewHintsCase.metrics.source_request_view_source_blocker, 'view_sources_not_distinct', 'release gate generated-view-hints source request should preserve distinct view-source blocker');
  assert.equal(generatedViewHintsCase.metrics.source_request_upload_manifest_required, true, 'release gate generated-view-hints source request should expose upload package manifest requirement');
  assert.deepEqual(generatedViewHintsCase.metrics.source_request_missing_required_views, [], 'release gate generated-view-hints source request should expose no missing upload package views');
  assert.ok(generatedViewHintsCase.metrics.source_request_next_upload_response_check_ids.includes('view_source_diversity'), 'release gate generated-view-hints source request should expose upload package response check ids');
  assert.equal(generatedViewHintsCase.metrics.source_request_response_status, 'satisfied_for_release_work', 'release gate generated-view-hints upload session should expose source request response status');
  assert.equal(generatedViewHintsCase.metrics.source_request_response_ok, true, 'release gate generated-view-hints upload session should satisfy source request response gate');
  assert.equal(generatedViewHintsCase.metrics.source_request_response_view_source_diversity_ok, true, 'release gate generated-view-hints source request response should satisfy view source diversity');
  assert.ok(generatedViewHintsCase.metrics.source_request_response_expected_check_ids.includes('view_source_diversity'), 'release gate generated-view-hints source request response should expose expected check ids');
  assert.deepEqual(generatedViewHintsCase.metrics.source_request_response_missing_expected_check_ids, [], 'release gate generated-view-hints source request response should expose no missing expected checks');
  assert.ok(generatedViewHintsCase.metrics.source_request_response_view_evidence.requested_view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'release gate generated-view-hints source request response should expose requested view evidence metric');
  assert.ok(Array.isArray(generatedViewHintsCase.metrics.source_request_response_semantic_evidence.current_covered_roles), 'release gate generated-view-hints source request response should expose semantic evidence summary metric');
  assert.ok(generatedViewHintsCase.metrics.source_request_response_semantic_evidence.role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'release gate generated-view-hints source request response should expose semantic role evidence metric');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedViewHintsCase.metrics.source_request_response_semantic_evidence.evidence_quality.status), 'release gate generated-view-hints source request response should expose semantic evidence quality metric');
  assert.equal(generatedViewHintsCase.metrics.source_request_response_semantic_evidence.evidence_quality.geometry_promotion_allowed, false, 'release gate generated-view-hints response semantic quality should block geometry promotion');
  assert.equal(generatedViewHintsCase.metrics.workflow_stage, 'source_input_ready_needs_release_artifacts', 'release gate generated-view-hints upload session should expose release-artifact workflow stage');
  assert.ok(generatedViewHintsCase.metrics.workflow_required_user_inputs.includes('release_draft:artifacts'), 'release gate generated-view-hints upload session should expose release artifact workflow input');
  assert.ok(generatedViewHintsCase.metrics.workflow_required_user_inputs.includes('release_draft:photo_grade_readiness'), 'release gate generated-view-hints upload session should expose PhotoGradeReadiness workflow input');
  assert.ok(generatedViewHintsCase.metrics.workflow_required_user_inputs.includes('release_draft:vision_evidence_review'), 'release gate generated-view-hints upload session should expose VisionEvidence review workflow input');
  assert.deepEqual(generatedViewHintsCase.metrics.source_request_response_unsatisfied_check_ids, [], 'release gate generated-view-hints source request response should expose no unsatisfied check ids');
  assert.equal(generatedViewHintsCase.metrics.mcp_source_request_response_gate_status, 'satisfied_for_release_work', 'release gate generated-view-hints MCP brief should expose satisfied response gate');
  assert.ok(generatedViewHintsCase.metrics.mcp_source_request_response_expected_check_ids.includes('view_source_diversity'), 'release gate generated-view-hints MCP brief should expose expected response check ids');
  assert.deepEqual(generatedViewHintsCase.metrics.mcp_source_request_response_missing_expected_check_ids, [], 'release gate generated-view-hints MCP brief should expose no missing expected response checks');
  assert.ok(generatedViewHintsCase.metrics.mcp_source_request_response_view_evidence.requested_view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'release gate generated-view-hints MCP brief should expose requested view evidence metric');
  assert.ok(Array.isArray(generatedViewHintsCase.metrics.mcp_source_request_response_semantic_evidence.current_covered_roles), 'release gate generated-view-hints MCP brief should expose semantic evidence summary metric');
  assert.ok(generatedViewHintsCase.metrics.mcp_source_request_response_semantic_evidence.role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'release gate generated-view-hints MCP brief should expose response semantic role evidence metric');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedViewHintsCase.metrics.mcp_source_request_response_semantic_evidence.evidence_quality.status), 'release gate generated-view-hints MCP brief should expose response semantic evidence quality metric');
  assert.deepEqual(generatedViewHintsCase.metrics.mcp_source_request_response_unsatisfied_check_ids, [], 'release gate generated-view-hints MCP brief should expose no unsatisfied response checks');
  assert.ok(generatedViewHintsCase.metrics.mcp_source_package_view_evidence.some((item) => item.view === 'left' && item.status === 'present'), 'release gate generated-view-hints MCP brief should expose source-package view evidence metric');
  assert.ok(generatedViewHintsCase.metrics.mcp_source_package_semantic_role_evidence.some((item) => item.role === 'rectangular_utility_ducts' && item.status === 'covered'), 'release gate generated-view-hints MCP brief should expose semantic role evidence metric');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedViewHintsCase.metrics.mcp_source_package_semantic_evidence_quality.status), 'release gate generated-view-hints MCP brief should expose source-package semantic evidence quality metric');
  assert.equal(generatedViewHintsCase.metrics.mcp_source_package_semantic_evidence_quality.geometry_promotion_allowed, false, 'release gate generated-view-hints MCP source-package semantic quality should block geometry promotion');
  assert.ok(generatedViewHintsCase.metrics.mcp_release_checklist_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints MCP brief should expose required release checklist id');
  assert.ok(generatedViewHintsCase.metrics.mcp_release_checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'release gate generated-view-hints MCP brief should expose failed required release checklist id');
  assert.ok(generatedViewHintsCase.metrics.mcp_agent_contract_release_checklist_failed_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints MCP agent contract should expose failed required release checklist id');
  assert.equal(generatedViewHintsCase.metrics.vision_evidence_review_items >= 4, true, 'release gate generated-view-hints upload session should expose VisionEvidence review items');
  assert.equal(generatedViewHintsCase.metrics.vision_evidence_semantic_candidate_review_items >= 3, true, 'release gate generated-view-hints upload session should expose semantic VisionEvidence review items');
  assert.equal(generatedViewHintsCase.metrics.mcp_vision_evidence_available, true, 'release gate generated-view-hints MCP brief should expose VisionEvidence summary');
  assert.ok(generatedViewHintsCase.metrics.mcp_vision_evidence_semantic_roles.includes('rectangular_utility_ducts'), 'release gate generated-view-hints MCP brief should expose duct VisionEvidence role');
  assert.ok(generatedViewHintsCase.metrics.mcp_vision_evidence_instance_roles.includes('rectangular_utility_ducts'), 'release gate generated-view-hints MCP brief should expose duct VisionEvidence instance');
  assert.ok(generatedViewHintsCase.metrics.mcp_vision_evidence_modeling_handoff_roles.includes('rectangular_utility_ducts'), 'release gate generated-view-hints MCP brief should expose duct VisionEvidence modeling handoff');
  assert.ok(generatedViewHintsCase.metrics.mcp_vision_evidence_modeling_handoff_blocked_interpretations.includes('decorative_facade_trim'), 'release gate generated-view-hints MCP brief should block duct trim interpretation from VisionEvidence handoff');
  assert.ok(generatedViewHintsCase.metrics.source_request_artifact.endsWith('real-world-building-source-request.json'), 'release gate generated-view-hints upload session should expose source request artifact');
  assert.ok(generatedViewHintsCase.metrics.source_request_response_artifact.endsWith('source-request-response.json'), 'release gate generated-view-hints upload session should expose source request response artifact');
  assert.ok(generatedViewHintsCase.metrics.upload_manifest_template.endsWith('upload-manifest.template.json'), 'release gate generated-view-hints upload session should expose manifest template artifact');
  assert.equal(generatedViewHintsCase.metrics.upload_manifest_template_view_source_blocker, 'view_sources_not_distinct', 'release gate generated-view-hints manifest template should preserve distinct view-source blocker');
  assert.deepEqual(generatedViewHintsCase.metrics.view_hint_sources, ['upload_manifest'], 'release gate generated-view-hints upload session should consume upload package manifest view hints');
  assert.equal(generatedViewHintsCase.metrics.handoff_status, 'ready_for_release_artifact_work', 'release gate generated-view-hints upload session should expose handoff status');
  assert.equal(generatedViewHintsCase.metrics.handoff_primary_action, 'produce_release_artifacts', 'release gate generated-view-hints upload session should expose handoff primary action');
  assert.equal(generatedViewHintsCase.metrics.handoff_primary_action_artifact_exists, false, 'release gate generated-view-hints handoff should expose missing primary workspace artifact');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedViewHintsCase.metrics.handoff_semantic_evidence_quality.status), 'release gate generated-view-hints handoff should expose semantic evidence quality');
  assert.equal(generatedViewHintsCase.metrics.handoff_semantic_evidence_quality.geometry_promotion_allowed, false, 'release gate generated-view-hints handoff should keep semantic evidence quality review-gated');
  assert.equal(generatedViewHintsCase.metrics.handoff_vision_evidence_available, true, 'release gate generated-view-hints handoff should expose VisionEvidence summary');
  assert.ok(generatedViewHintsCase.metrics.handoff_vision_evidence_instance_roles.includes('rectangular_utility_ducts'), 'release gate generated-view-hints handoff should expose duct VisionEvidence instance');
  assert.ok(generatedViewHintsCase.metrics.handoff_vision_evidence_modeling_handoff_roles.includes('rectangular_utility_ducts'), 'release gate generated-view-hints handoff should expose duct VisionEvidence modeling handoff');
  assert.ok(generatedViewHintsCase.metrics.handoff_vision_evidence_modeling_handoff_blocked_interpretations.includes('decorative_facade_trim'), 'release gate generated-view-hints handoff should preserve duct blocked interpretation');
  assert.ok(generatedViewHintsCase.metrics.handoff_release_checklist_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints handoff should expose required VisionEvidence checklist id');
  assert.ok(generatedViewHintsCase.metrics.handoff_release_checklist_failed_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints handoff should expose failed VisionEvidence checklist id');
  assert.equal(generatedViewHintsCase.metrics.handoff_release_work_order_exists, true, 'release gate generated-view-hints handoff should expose existing release work order artifact');
  assert.equal(generatedViewHintsCase.metrics.handoff_upload_session_handoff_exists, true, 'release gate generated-view-hints handoff should expose existing handoff artifact');
  assert.deepEqual(generatedViewHintsCase.metrics.handoff_missing_required_artifact_roles, [], 'release gate generated-view-hints handoff should not hide missing required handoff artifacts');
  assert.ok(generatedViewHintsCase.metrics.handoff_artifact.endsWith('upload-session-handoff.json'), 'release gate generated-view-hints upload session should expose handoff artifact');
  assert.deepEqual(generatedViewHintsCase.metrics.missing_inputs, [], 'release gate generated view hints should clear missing view inputs');
  assert.equal(generatedViewHintsCase.metrics.release_ready, false, 'release gate generated-view-hints upload session should not claim release readiness');
  assert.equal(generatedViewHintsCase.metrics.release_draft_status, 'manifest_invalid_release_gap_recorded', 'release gate generated-view-hints upload session release draft should fail closed');
  assert.equal(generatedViewHintsCase.metrics.release_draft_ready, false, 'release gate generated-view-hints upload session release draft should not be ready');
  assert.equal(generatedViewHintsCase.metrics.release_draft_promotable, false, 'release gate generated-view-hints upload session release draft should not be promotable');
  assert.ok(generatedViewHintsCase.metrics.release_draft_blockers.includes('artifacts'), 'release gate generated-view-hints upload session should expose artifact blocker');
  assert.ok(generatedViewHintsCase.metrics.release_draft_blockers.includes('photo_grade_readiness'), 'release gate generated-view-hints upload session should expose PhotoGradeReadiness blocker');
  assert.ok(generatedViewHintsCase.metrics.release_draft_blockers.includes('vision_evidence_review'), 'release gate generated-view-hints upload session should expose VisionEvidence review blocker');
  assert.equal(generatedViewHintsCase.metrics.release_draft_check_statuses.photo_grade_readiness, 'fail', 'release gate generated-view-hints upload session should expose failed checklist status');
  assert.equal(generatedViewHintsCase.metrics.release_draft_check_statuses.vision_evidence_review, 'fail', 'release gate generated-view-hints upload session should expose failed VisionEvidence review checklist status');
  assert.ok(generatedViewHintsCase.metrics.release_draft_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints summary should expose VisionEvidence review as a required checklist id');
  assert.ok(generatedViewHintsCase.metrics.release_draft_failed_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints summary should expose VisionEvidence review as a failed required checklist id');
  assert.ok(generatedViewHintsCase.metrics.release_checklist_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints checklist should expose VisionEvidence review as a required check');
  assert.equal(generatedViewHintsCase.metrics.release_work_order_status, 'needs_release_artifacts', 'release gate generated-view-hints upload session should expose release work order status');
  assert.ok(generatedViewHintsCase.metrics.release_work_order_blocked_required_tasks > 0, 'release gate generated-view-hints upload session should expose blocked work order tasks');
  assert.ok(generatedViewHintsCase.metrics.release_work_order_artifact.endsWith('release-work-order.json'), 'release gate generated-view-hints upload session should expose release work order artifact');
  assert.equal(generatedViewHintsCase.metrics.release_work_order_direct_sketchup_dsl_allowed, false, 'release gate generated-view-hints work order should forbid direct SketchUp DSL');
  assert.ok(
    generatedViewHintsCase.metrics.release_work_order_required_contract_artifacts.includes('release-artifact-workspace.json'),
    'release gate generated-view-hints work order should point artifact authors to workspace'
  );
  assert.ok(generatedViewHintsCase.metrics.release_work_order_vision_review_artifact_roles.includes('vision_evidence_review_decision'), 'release gate generated-view-hints work order should expose VisionEvidence review decision artifact role');
  assert.ok(generatedViewHintsCase.metrics.release_work_order_vision_review_artifact_roles.includes('vision_evidence_policy_correction_patch'), 'release gate generated-view-hints work order should expose VisionEvidence policy correction artifact role');
  assert.ok(generatedViewHintsCase.metrics.release_work_order_vision_review_command.includes('build-vision-evidence-policy-correction-patch.mjs'), 'release gate generated-view-hints work order should expose VisionEvidence policy correction command');
  assert.equal(generatedViewHintsCase.metrics.release_artifact_workspace_status, 'ready_for_artifact_authoring', 'release gate generated-view-hints upload session should expose artifact workspace status');
  assert.deepEqual(generatedViewHintsCase.metrics.release_artifact_workspace_required_roles, ['part_graph', 'output', 'photo_grade_readiness_report'], 'release gate generated-view-hints workspace should expose required roles');
  assert.deepEqual(generatedViewHintsCase.metrics.release_artifact_workspace_missing_roles, ['part_graph', 'output', 'photo_grade_readiness_report'], 'release gate generated-view-hints workspace should keep missing roles visible');
  assert.equal(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_count, 3, 'release gate generated-view-hints workspace should expose task packet count');
  assert.deepEqual(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_statuses, ['ready_to_author'], 'release gate generated-view-hints workspace should expose task packet statuses');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints workspace should expose required VisionEvidence checklist id');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_failed_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints workspace should expose failed VisionEvidence checklist id');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_review_requirement_ids.includes('vision_evidence_review'), 'release gate generated-view-hints workspace should expose VisionEvidence review requirement');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_vision_review_artifact_roles.includes('vision_evidence_review_decision'), 'release gate generated-view-hints workspace should expose VisionEvidence accepted decision artifact role');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_vision_review_artifact_roles.includes('vision_evidence_policy_correction_patch'), 'release gate generated-view-hints workspace should expose VisionEvidence policy correction artifact role');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_missing_vision_review_artifact_roles.includes('vision_evidence_review_decision'), 'release gate generated-view-hints workspace should expose missing VisionEvidence accepted decision');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_missing_vision_review_artifact_roles.includes('vision_evidence_policy_correction_patch'), 'release gate generated-view-hints workspace should expose missing VisionEvidence policy correction patch');
  assert.ok(generatedViewHintsCase.metrics.workflow_prepare_vision_evidence_review_workbench_command.includes('make-vision-evidence-review-workbench.mjs'), 'release gate generated-view-hints workflow should expose VisionEvidence review workbench command');
  assert.ok(generatedViewHintsCase.metrics.workflow_build_vision_evidence_policy_correction_patch_command.includes('build-vision-evidence-policy-correction-patch.mjs'), 'release gate generated-view-hints workflow should expose VisionEvidence policy correction command');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_build_vision_evidence_policy_correction_patch_command.includes('build-vision-evidence-policy-correction-patch.mjs'), 'release gate generated-view-hints workspace should expose VisionEvidence policy correction command');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_acceptance_ids.includes('do_not_generate_direct_dsl_from_mcp_brief'), 'release gate generated-view-hints task packets should expose direct DSL acceptance criterion');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_acceptance_ids.includes('preserve_candidate_disambiguation'), 'release gate generated-view-hints task packets should expose disambiguation acceptance criterion');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_acceptance_ids.includes('preserve_semantic_evidence_quality'), 'release gate generated-view-hints task packets should expose semantic evidence quality acceptance criterion');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_acceptance_ids.includes('use_vision_evidence_instances'), 'release gate generated-view-hints task packets should expose VisionEvidence instance acceptance criterion');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_acceptance_ids.includes('use_vision_evidence_modeling_handoff'), 'release gate generated-view-hints task packets should expose VisionEvidence modeling handoff acceptance criterion');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_acceptance_ids.includes('address_failed_required_release_checks'), 'release gate generated-view-hints task packets should expose failed checklist acceptance criterion');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_blocked_outputs.includes('direct_sketchup_dsl'), 'release gate generated-view-hints task packets should inherit blocked direct DSL output');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_failed_required_check_ids.includes('vision_evidence_review'), 'release gate generated-view-hints task packets should inherit failed VisionEvidence checklist id');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_semantic_quality_statuses.some((status) => ['weak_review_required', 'review_required'].includes(status)), 'release gate generated-view-hints task packets should inherit semantic quality status');
  assert.deepEqual(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_semantic_geometry_allowed, [false], 'release gate generated-view-hints task packets should keep semantic geometry promotion blocked');
  assert.equal(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_mcp_authoring_handoff_count, 3, 'release gate generated-view-hints task packets should expose MCP authoring handoff for every artifact');
  assert.equal(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_mcp_authoring_handoff_prompt_has_vision_evidence, true, 'release gate generated-view-hints MCP authoring handoff prompts should mention VisionEvidence');
  assert.equal(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_mcp_authoring_handoff_prompt_has_workbench, true, 'release gate generated-view-hints MCP authoring handoff prompts should mention VisionEvidence review workbench');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_mcp_authoring_handoff_review_workbenches.some((item) => item.endsWith('vision-evidence-review/index.html')), 'release gate generated-view-hints MCP authoring handoff should expose VisionEvidence workbench path');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_mcp_authoring_handoff_blocked_interpretations.includes('decorative_facade_trim'), 'release gate generated-view-hints MCP authoring handoff should preserve duct blocked interpretation');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_mcp_authoring_handoff_blocked_interpretations.includes('cut_recess_from_shadow_only'), 'release gate generated-view-hints MCP authoring handoff should preserve shadow blocked interpretation');
  assert.equal(generatedViewHintsCase.metrics.release_artifact_workspace_validation_status, 'ready_to_author_validated', 'release gate generated-view-hints workspace validation should report ready-to-author validation');
  assert.deepEqual(generatedViewHintsCase.metrics.release_artifact_workspace_validation_failed_required_checks, [], 'release gate generated-view-hints workspace validation should have no failed required checks');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_mcp_blocked_outputs.includes('direct_sketchup_dsl'), 'release gate generated-view-hints workspace should expose blocked direct DSL');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_mcp_failed_required_check_ids.includes('photo_grade_readiness'), 'release gate generated-view-hints workspace MCP handoff should expose failed PhotoGradeReadiness checklist id');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_mcp_blocked_interpretations.includes('merged_front_facade_plane'), 'release gate generated-view-hints workspace should expose recessed facade blocked interpretation');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_mcp_blocked_interpretations.includes('decorative_facade_trim'), 'release gate generated-view-hints workspace should expose duct blocked interpretation');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_mcp_blocked_interpretations.includes('cut_recess_from_shadow_only'), 'release gate generated-view-hints workspace should expose shadow blocked interpretation');
  assert.ok(['weak_review_required', 'review_required'].includes(generatedViewHintsCase.metrics.release_artifact_workspace_mcp_semantic_evidence_quality.status), 'release gate generated-view-hints workspace should expose MCP semantic evidence quality');
  assert.equal(generatedViewHintsCase.metrics.release_artifact_workspace_mcp_semantic_evidence_quality.geometry_promotion_allowed, false, 'release gate generated-view-hints workspace MCP semantic quality should block geometry promotion');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_vision_evidence_instance_roles.includes('rectangular_utility_ducts'), 'release gate generated-view-hints workspace should expose duct VisionEvidence instances');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_vision_evidence_instance_roles.includes('shadow_or_recess_boundary'), 'release gate generated-view-hints task packets should expose shadow VisionEvidence instances');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_vision_evidence_modeling_handoff_roles.includes('rectangular_utility_ducts'), 'release gate generated-view-hints workspace should expose duct VisionEvidence modeling handoff');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_vision_evidence_modeling_handoff_blocked_interpretations.includes('decorative_facade_trim'), 'release gate generated-view-hints workspace should preserve duct blocked interpretation in VisionEvidence modeling handoff');
  assert.ok(generatedViewHintsCase.metrics.release_artifact_workspace_task_packet_vision_evidence_modeling_handoff_roles.includes('shadow_or_recess_boundary'), 'release gate generated-view-hints task packets should expose shadow VisionEvidence modeling handoff');
  assert.equal(generatedViewHintsCase.metrics.can_generate_sketchup_dsl, false, 'release gate generated-view-hints upload session should still forbid direct DSL');
  for (const view of ['front', 'left', 'oblique', 'top']) {
    assert.ok(generatedViewHintsCase.metrics.hinted_views.includes(view), `release gate generated view hints should include ${view}`);
  }
  const generatedViewHintsBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'upload-session-auto-view-hints', 'session');
  assertValid(validateRealWorldBuildingUploadSession, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'upload-session-summary.json'), 'utf8')), 'release gate generated-view-hints upload-session summary JSON');
  assertValid(validateRealWorldBuildingUploadSessionHandoff, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'upload-session-handoff.json'), 'utf8')), 'release gate generated-view-hints upload-session handoff JSON');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspace, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'release-artifact-workspace.json'), 'utf8')), 'release gate generated-view-hints release artifact workspace JSON');
  assertValid(validateRealWorldBuildingReleaseArtifactWorkspaceValidation, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'release-artifact-workspace-validation.json'), 'utf8')), 'release gate generated-view-hints release artifact workspace validation JSON');
  assertValid(validateStructuredAssetIntakeSummary, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'intake-summary.json'), 'utf8')), 'release gate generated-view-hints intake summary JSON');
  assertValid(validateVisionEvidenceSetV1, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'observations.json'), 'utf8')).vision_evidence_set_v1, 'release gate generated-view-hints observations VisionEvidenceSet');
  const generatedViewHintsVisionReviewPatch = JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'vision-evidence-review-patch.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewPatch, generatedViewHintsVisionReviewPatch, 'release gate generated-view-hints VisionEvidence review patch');
  assertSemanticReviewItemHasEvidenceInstance(generatedViewHintsVisionReviewPatch, 'shadow_or_recess_boundary', 'release gate generated-view-hints VisionEvidence patch should locate shadow/recess evidence');
  assertValid(validateRealWorldBuildingSourceRequest, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'real-world-building-source-request.json'), 'utf8')), 'release gate generated-view-hints source request JSON');
  assertValid(validateRealWorldBuildingSourceRequestResponse, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'source-request-response.json'), 'utf8')), 'release gate generated-view-hints source request response JSON');
  assertValid(validateRealWorldBuildingUploadManifest, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'upload-manifest.template.json'), 'utf8')), 'release gate generated-view-hints upload manifest template JSON');
  assertValid(validateRealWorldBuildingSourcePackageGateResult, JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'real-world-building-source-package.gate-result.json'), 'utf8')), 'release gate generated-view-hints source-package gate result');
  const generatedReleaseGateHints = JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'view-hints.generated.json'), 'utf8'));
  assert.equal(generatedReleaseGateHints.kind, 'upload_session_view_hints', 'release gate generated view hints should use stable kind');
  assertValid(
    validateRealWorldBuildingManifest,
    JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'real-world-building-release', 'manifest.draft.json'), 'utf8')),
    'release gate generated-view-hints manifest draft'
  );
  assertValid(
    validateRealWorldBuildingChecklist,
    JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'real-world-building-release', 'release-checklist.json'), 'utf8')),
    'release gate generated-view-hints release checklist'
  );
  assertValid(
    validateRealWorldBuildingReleaseWorkOrder,
    JSON.parse(await fs.readFile(path.join(generatedViewHintsBase, 'intake', 'real-world-building-release', 'release-work-order.json'), 'utf8')),
    'release gate generated-view-hints release work order'
  );
  const multimodalCase = report.cases.find((item) => item.id === 'pdf_cad_assetset_fail_closed');
  assert.ok(multimodalCase.metrics.media_types.includes('pdf'), 'release gate should record PDF asset intake');
  assert.ok(multimodalCase.metrics.media_types.includes('cad'), 'release gate should record CAD asset intake');
  assert.ok(multimodalCase.metrics.blockers.includes('pdf_extractor_required'), 'release gate should expose PDF parser blocker');
  assert.ok(multimodalCase.metrics.blockers.includes('cad_extractor_required'), 'release gate should expose CAD parser blocker');
  const multimodalBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'pdf-cad-fail-closed');
  assertValid(validateAssetSet, JSON.parse(await fs.readFile(path.join(multimodalBase, 'asset-set.json'), 'utf8')), 'release gate PDF/CAD asset-set.json');
  assertValid(validateImageSetObservation, JSON.parse(await fs.readFile(path.join(multimodalBase, 'observations.json'), 'utf8')), 'release gate PDF/CAD observations.json');
  assertValid(validateCandidateGraph, JSON.parse(await fs.readFile(path.join(multimodalBase, 'candidate-graph.json'), 'utf8')), 'release gate PDF/CAD candidate-graph.json');
  assertValid(validateModelingBrief, JSON.parse(await fs.readFile(path.join(multimodalBase, 'modeling-brief.json'), 'utf8')), 'release gate PDF/CAD modeling-brief.json');
  assertValid(validateCandidatePromotionReview, JSON.parse(await fs.readFile(path.join(multimodalBase, 'candidate-promotion-review.draft.json'), 'utf8')), 'release gate PDF/CAD candidate-promotion-review.draft.json');
  assertValid(validateCandidatePromotionPatch, JSON.parse(await fs.readFile(path.join(multimodalBase, 'candidate-promotion-patch.blocked.json'), 'utf8')), 'release gate PDF/CAD candidate-promotion-patch.blocked.json');
  const parsedDocumentCase = report.cases.find((item) => item.id === 'pdf_cad_parser_positive_review_gate');
  assert.equal(parsedDocumentCase.metrics.cad_outlines, 1, 'release gate should parse one CAD outline');
  assert.equal(parsedDocumentCase.metrics.width_mm, 9000, 'release gate parsed CAD width should match fixture');
  assert.equal(parsedDocumentCase.metrics.depth_mm, 12000, 'release gate parsed CAD depth should match fixture');
  assert.equal(parsedDocumentCase.metrics.blockers.includes('pdf_extractor_required'), false, 'parsed document path should clear PDF extractor blocker');
  assert.equal(parsedDocumentCase.metrics.blockers.includes('cad_extractor_required'), false, 'parsed document path should clear CAD extractor blocker');
  const parsedDocumentBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'pdf-cad-parser-positive');
  assertValid(validateAssetSet, JSON.parse(await fs.readFile(path.join(parsedDocumentBase, 'asset-set.json'), 'utf8')), 'release gate parsed PDF/CAD asset-set.json');
  assertValid(validateImageSetObservation, JSON.parse(await fs.readFile(path.join(parsedDocumentBase, 'observations.json'), 'utf8')), 'release gate parsed PDF/CAD observations.json');
  assertValid(validateCandidateGraph, JSON.parse(await fs.readFile(path.join(parsedDocumentBase, 'candidate-graph.json'), 'utf8')), 'release gate parsed PDF/CAD candidate-graph.json');
  assertValid(validateModelingBrief, JSON.parse(await fs.readFile(path.join(parsedDocumentBase, 'modeling-brief.json'), 'utf8')), 'release gate parsed PDF/CAD modeling-brief.json');
  assertValid(validateCandidatePromotionReview, JSON.parse(await fs.readFile(path.join(parsedDocumentBase, 'candidate-promotion-review.draft.json'), 'utf8')), 'release gate parsed PDF/CAD candidate-promotion-review.draft.json');
  assertValid(validateCandidatePromotionPatch, JSON.parse(await fs.readFile(path.join(parsedDocumentBase, 'candidate-promotion-patch.blocked.json'), 'utf8')), 'release gate parsed PDF/CAD candidate-promotion-patch.blocked.json');
  assertValid(validateDocumentAssetParseReport, JSON.parse(await fs.readFile(path.join(parsedDocumentBase, 'document-parse-report.json'), 'utf8')), 'release gate document-parse-report.json');
  const documentParserMatrixCase = report.cases.find((item) => item.id === 'pdf_cad_parser_release_matrix_fixture');
  assert.equal(documentParserMatrixCase.metrics.sample_count, 8, 'PDF/CAD parser release matrix should cover eight fixture samples');
  assert.equal(documentParserMatrixCase.metrics.positive_samples, 5, 'PDF/CAD parser release matrix should keep five positive parser fixtures');
  assert.equal(documentParserMatrixCase.metrics.fail_closed_samples, 3, 'PDF/CAD parser matrix should keep three fail-closed parser fixtures');
  const parserMatrixSamples = new Map(documentParserMatrixCase.metrics.samples.map((sample) => [sample.id, sample]));
  assert.equal(parserMatrixSamples.get('positive_pdf_dxf_outline').cad_outlines, 1, 'parser matrix positive fixture should extract one CAD outline');
  assert.equal(parserMatrixSamples.get('positive_pdf_dxf_outline').pdf_pages, 1, 'parser matrix positive fixture should count one PDF page');
  assert.equal(parserMatrixSamples.get('positive_pdf_dxf_outline').units, 'millimeter_assumed', 'parser matrix positive fixture should record assumed mm units');
  assert.equal(parserMatrixSamples.get('multi_page_pdf_dxf_outline').pdf_pages, 2, 'parser matrix multi-page fixture should count PDF pages');
  assert.equal(parserMatrixSamples.get('multi_page_pdf_dxf_outline').width_mm, 16000, 'parser matrix multi-page fixture should extract CAD width');
  assert.equal(parserMatrixSamples.get('dxf_units_meters_positive').units, 'meter', 'parser matrix should record DXF meter units');
  assert.equal(parserMatrixSamples.get('dxf_units_meters_positive').unit_scale_to_mm, 1000, 'parser matrix should normalize meter units to mm');
  assert.equal(parserMatrixSamples.get('dxf_units_meters_positive').width_mm, 9000, 'parser matrix should scale meter width to mm');
  assert.equal(parserMatrixSamples.get('dxf_layer_filter_positive').selected_layer, 'A-BUILDING-OUTLINE', 'parser matrix should prefer building outline layer over dimension geometry');
  assert.equal(parserMatrixSamples.get('dxf_layer_filter_positive').cad_candidate_outlines, 2, 'parser matrix should report multiple CAD outline candidates');
  assert.equal(parserMatrixSamples.get('dxf_multiple_outline_positive').cad_candidate_outlines, 2, 'parser matrix should report multiple building outlines');
  assert.equal(parserMatrixSamples.get('dxf_multiple_outline_positive').width_mm, 12000, 'parser matrix should choose the largest same-priority building outline');
  assert.ok(parserMatrixSamples.get('malformed_pdf_fail_closed').asset_gate_reasons.includes('pdf_extractor_required'), 'parser matrix malformed PDF should keep PDF extractor gate');
  assert.ok(parserMatrixSamples.get('dxf_without_outline_fail_closed').asset_gate_reasons.includes('cad_extractor_required'), 'parser matrix DXF without outline should keep CAD extractor gate');
  assert.ok(parserMatrixSamples.get('unsupported_cad_fail_closed').asset_gate_reasons.includes('cad_extractor_required'), 'parser matrix unsupported CAD should keep CAD extractor gate');
  const parserMatrixBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'pdf-cad-parser-matrix');
  for (const sample of documentParserMatrixCase.metrics.samples) {
    const sampleBase = path.join(parserMatrixBase, sample.id);
    assertValid(validateAssetSet, JSON.parse(await fs.readFile(path.join(sampleBase, 'asset-set.json'), 'utf8')), `parser matrix ${sample.id} asset-set.json`);
    assertValid(validateImageSetObservation, JSON.parse(await fs.readFile(path.join(sampleBase, 'observations.json'), 'utf8')), `parser matrix ${sample.id} observations.json`);
    assertValid(validateCandidateGraph, JSON.parse(await fs.readFile(path.join(sampleBase, 'candidate-graph.json'), 'utf8')), `parser matrix ${sample.id} candidate-graph.json`);
    assertValid(validateModelingBrief, JSON.parse(await fs.readFile(path.join(sampleBase, 'modeling-brief.json'), 'utf8')), `parser matrix ${sample.id} modeling-brief.json`);
    assertValid(validateCandidatePromotionReview, JSON.parse(await fs.readFile(path.join(sampleBase, 'candidate-promotion-review.draft.json'), 'utf8')), `parser matrix ${sample.id} candidate-promotion-review.draft.json`);
    assertValid(validateCandidatePromotionPatch, JSON.parse(await fs.readFile(path.join(sampleBase, 'candidate-promotion-patch.blocked.json'), 'utf8')), `parser matrix ${sample.id} candidate-promotion-patch.blocked.json`);
    assertValid(validateDocumentAssetParseReport, JSON.parse(await fs.readFile(path.join(sampleBase, 'document-parse-report.json'), 'utf8')), `parser matrix ${sample.id} document-parse-report.json`);
  }
  const documentRoundtripCase = report.cases.find((item) => item.id === 'document_review_patch_roundtrip_fixture');
  assert.equal(documentRoundtripCase.metrics.accepted_candidates, 1, 'document review roundtrip should accept one CAD candidate');
  assert.equal(documentRoundtripCase.metrics.patch_actions, 1, 'document review roundtrip should create one promotion action');
  assert.equal(documentRoundtripCase.metrics.promoted_parts, 1, 'document review roundtrip should promote one PartGraph part');
  assert.ok(documentRoundtripCase.metrics.promoted_roles.includes('building_main_mass'), 'document review roundtrip should promote building main mass');
  assert.equal(documentRoundtripCase.metrics.width_mm, 9000, 'document review roundtrip should preserve parsed CAD width');
  assert.equal(documentRoundtripCase.metrics.depth_mm, 12000, 'document review roundtrip should preserve parsed CAD depth');
  assert.match(documentRoundtripCase.metrics.compiler_gate_error, /PartGraph compile blocked by geometry gate/, 'document review roundtrip should preserve compiler gate');
  const documentRoundtripBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'document-review-roundtrip');
  assertValid(validateCandidatePromotionReview, JSON.parse(await fs.readFile(path.join(documentRoundtripBase, 'candidate-promotion-review.accepted.document-fixture.json'), 'utf8')), 'release gate document roundtrip accepted candidate-promotion-review.json');
  assertValid(validateCandidatePromotionPatch, JSON.parse(await fs.readFile(path.join(documentRoundtripBase, 'candidate-promotion-patch.ready.document-fixture.json'), 'utf8')), 'release gate document roundtrip candidate-promotion-patch.ready.json');
  assertValid(validatePartGraph, JSON.parse(await fs.readFile(path.join(documentRoundtripBase, 'part-graph.candidate-promoted.document-fixture.json'), 'utf8')), 'release gate document roundtrip PartGraph');
  const semanticMatrixCase = report.cases.find((item) => item.id === 'building_single_semantic_matrix_fixture');
  assert.equal(semanticMatrixCase.metrics.sample_count >= 3, true, 'building single semantic matrix should include at least three deterministic samples');
  assert.ok(semanticMatrixCase.metrics.samples.some((sample) => sample.id === 'tracked_blueprint_elevation_plan'), 'building single semantic matrix should include the tracked blueprint/elevation sample');
  for (const sample of semanticMatrixCase.metrics.samples) {
    for (const role of ['visible_plane_recessed_left', 'rectangular_utility_ducts', 'shadow_or_recess_boundary']) {
      assert.equal(sample.roles[role] > 0, true, `semantic matrix ${sample.id} should expose ${role}`);
    }
    assert.ok(sample.missing_inputs.length > 0, `semantic matrix ${sample.id} should keep missing inputs visible`);
  }
  const semanticMatrixBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'building-single-semantic-matrix');
  for (const sample of semanticMatrixCase.metrics.samples) {
    const sampleBase = path.join(semanticMatrixBase, sample.id);
    assertValid(validateAssetSet, JSON.parse(await fs.readFile(path.join(sampleBase, 'asset-set.json'), 'utf8')), `semantic matrix ${sample.id} asset-set.json`);
    assertValid(validateImageSetObservation, JSON.parse(await fs.readFile(path.join(sampleBase, 'observations.json'), 'utf8')), `semantic matrix ${sample.id} observations.json`);
    assertValid(validateCandidateGraph, JSON.parse(await fs.readFile(path.join(sampleBase, 'candidate-graph.json'), 'utf8')), `semantic matrix ${sample.id} candidate-graph.json`);
    assertValid(validateModelingBrief, JSON.parse(await fs.readFile(path.join(sampleBase, 'modeling-brief.json'), 'utf8')), `semantic matrix ${sample.id} modeling-brief.json`);
    assertValid(validateCandidatePromotionReview, JSON.parse(await fs.readFile(path.join(sampleBase, 'candidate-promotion-review.draft.json'), 'utf8')), `semantic matrix ${sample.id} candidate-promotion-review.draft.json`);
    assertValid(validateCandidatePromotionPatch, JSON.parse(await fs.readFile(path.join(sampleBase, 'candidate-promotion-patch.blocked.json'), 'utf8')), `semantic matrix ${sample.id} candidate-promotion-patch.blocked.json`);
  }
  const semanticEvidenceMatrixCase = report.cases.find((item) => item.id === 'building_single_semantic_evidence_matrix');
  assert.equal(semanticEvidenceMatrixCase.metrics.sample_count, 4, 'building single semantic evidence matrix should cover four deterministic samples');
  const semanticEvidenceSamples = new Map(semanticEvidenceMatrixCase.metrics.samples.map((sample) => [sample.id, sample]));
  assert.ok(semanticEvidenceSamples.get('cropped_annotated_vlm').semantic_sources.includes('user_annotation'), 'semantic evidence matrix cropped sample should include user annotation source');
  assert.ok(semanticEvidenceSamples.get('cropped_annotated_vlm').semantic_sources.includes('vlm_candidate'), 'semantic evidence matrix cropped sample should include VLM fixture source');
  assert.equal(semanticEvidenceSamples.get('cropped_annotated_vlm').geometry_promotion_allowed, false, 'semantic evidence matrix cropped sample should forbid geometry promotion');
  const semanticEvidenceMatrixBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'building-single-semantic-evidence-matrix');
  for (const sample of semanticEvidenceMatrixCase.metrics.samples) {
    const sampleBase = path.join(semanticEvidenceMatrixBase, sample.id);
    assertValid(validateAssetSet, JSON.parse(await fs.readFile(path.join(sampleBase, 'asset-set.json'), 'utf8')), `semantic evidence matrix ${sample.id} asset-set.json`);
    assertValid(validateImageSetObservation, JSON.parse(await fs.readFile(path.join(sampleBase, 'observations.json'), 'utf8')), `semantic evidence matrix ${sample.id} observations.json`);
    assertValid(validateCandidateGraph, JSON.parse(await fs.readFile(path.join(sampleBase, 'candidate-graph.json'), 'utf8')), `semantic evidence matrix ${sample.id} candidate-graph.json`);
    assertValid(validateBuildingSingleSemanticEvidence, JSON.parse(await fs.readFile(path.join(sampleBase, 'building-single-semantic-evidence.json'), 'utf8')), `semantic evidence matrix ${sample.id} building-single-semantic-evidence.json`);
    const reviewHelper = JSON.parse(await fs.readFile(path.join(sampleBase, 'review-helper-output.json'), 'utf8'));
    assert.equal(reviewHelper.model_status, 'review_only', `semantic evidence matrix ${sample.id} review helper should be review-only`);
    assert.equal(reviewHelper.compile_allowed, false, `semantic evidence matrix ${sample.id} review helper should not compile`);
    assert.equal(reviewHelper.geometry_promotion_allowed, false, `semantic evidence matrix ${sample.id} review helper should not promote geometry`);
  }
  const buildingCase = report.cases.find((item) => item.id === 'building_single_blocked_demo');
  for (const role of ['visible_plane_recessed_left', 'rectangular_utility_ducts', 'shadow_or_recess_boundary']) {
    assert.equal(buildingCase.metrics.roles[role] > 0, true, `release gate should preserve ${role} metrics`);
  }
  assert.equal(buildingCase.metrics.release_draft_bundle, true, 'building demo should write real-world release draft bundle');
  assert.equal(buildingCase.metrics.release_draft_status, 'manifest_invalid_release_gap_recorded', 'building demo release draft should fail closed with structured status');
  assert.equal(buildingCase.metrics.release_draft_ready, false, 'building demo release draft should not be ready');
  assert.ok(buildingCase.metrics.release_draft_blockers.includes('artifacts'), 'building demo release draft should require release artifacts');
  assert.ok(buildingCase.metrics.release_draft_blockers.includes('photo_grade_readiness'), 'building demo release draft should require PhotoGradeReadiness');
  assert.ok(buildingCase.metrics.release_draft_blockers.includes('vision_evidence_review'), 'building demo release draft should require VisionEvidence review');
  assert.equal(buildingCase.metrics.release_draft_review_links, true, 'building demo review should link release draft artifacts');
  assert.equal(buildingCase.metrics.release_draft_review_checks, true, 'building demo review should render release checklist rows');
  assert.equal(buildingCase.metrics.intake_summary_ok, false, 'building demo intake summary should preserve failed source-package hard gate');
  assert.equal(buildingCase.metrics.source_package_intake_gate_ok, false, 'building demo intake source-package gate should fail');
  assert.ok(
    buildingCase.metrics.source_package_intake_gate_failed.includes('input_ready_for_release_work'),
    'building demo intake source-package gate should expose failed input-ready requirement'
  );
  assert.equal(buildingCase.metrics.source_package_cli_revalidated, true, 'building demo should revalidate source package through CLI helper');
  assert.equal(buildingCase.metrics.source_package_require_input_ready_ok, false, 'building demo require-input-ready source package gate should fail');
  assert.ok(
    buildingCase.metrics.source_package_require_input_ready_failed.includes('input_ready_for_release_work'),
    'building demo require-input-ready source package gate should expose failed input-ready requirement'
  );
  assert.equal(buildingCase.metrics.source_package_require_input_ready_gate_result, true, 'building demo require-input-ready gate should write a gate-result artifact');
  assert.equal(buildingCase.metrics.vision_evidence_review_items >= 4, true, 'building demo should expose VisionEvidence review items');
  assert.equal(buildingCase.metrics.vision_evidence_semantic_candidate_review_items >= 3, true, 'building demo should expose semantic VisionEvidence review items');
  assert.ok(buildingCase.metrics.vision_evidence_review_ids.includes('semantic_candidate:visible_plane_recessed_left'), 'building demo VisionEvidence should preserve recessed facade item');
  assert.ok(buildingCase.metrics.vision_evidence_review_ids.includes('semantic_candidate:rectangular_utility_ducts'), 'building demo VisionEvidence should preserve duct item');
  assert.ok(buildingCase.metrics.vision_evidence_review_ids.includes('semantic_candidate:shadow_or_recess_boundary'), 'building demo VisionEvidence should preserve shadow/recess item');
  const mcpBriefCase = report.cases.find((item) => item.id === 'mcp_modeling_brief_export_fixture');
  assert.equal(mcpBriefCase.metrics.can_generate_sketchup_dsl, false, 'MCP brief export should forbid direct DSL for blocked input');
  assert.equal(mcpBriefCase.metrics.default_intake_brief, true, 'MCP brief export should prove default intake brief exists');
  assert.equal(mcpBriefCase.metrics.review_links, true, 'MCP brief export should prove review workbench links exist');
	  assert.equal(mcpBriefCase.metrics.source_package_gate, 'blocked_source_assets', 'MCP brief export should preserve source-package gate status');
  assert.ok(mcpBriefCase.metrics.mcp_release_checklist_required_check_ids.includes('vision_evidence_review'), 'MCP brief export should expose required release checklist id');
  assert.ok(mcpBriefCase.metrics.mcp_release_checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'MCP brief export should expose failed required release checklist id');
  assert.equal(mcpBriefCase.metrics.source_request_status, 'needs_source_replacement', 'MCP brief export should preserve source request status');
  assert.equal(mcpBriefCase.metrics.agent_contract_status, 'review_or_input_blocked', 'MCP brief export should preserve agent contract status');
  assert.ok(mcpBriefCase.metrics.agent_contract_release_checklist_failed_required_check_ids.includes('vision_evidence_review'), 'MCP brief export agent contract should expose failed required release checklist id');
  assert.ok(mcpBriefCase.metrics.blocked_outputs.includes('direct_sketchup_dsl'), 'MCP brief export should expose blocked direct DSL output');
  assert.equal(mcpBriefCase.metrics.vision_evidence_available, true, 'MCP brief export should expose VisionEvidence availability');
  assert.ok(mcpBriefCase.metrics.vision_evidence_semantic_roles.includes('rectangular_utility_ducts'), 'MCP brief export should expose duct semantic role in VisionEvidence summary');
  assert.ok(mcpBriefCase.metrics.vision_evidence_instance_roles.includes('rectangular_utility_ducts'), 'MCP brief export should expose duct VisionEvidence instance');
  assert.ok(mcpBriefCase.metrics.vision_evidence_modeling_handoff_roles.includes('rectangular_utility_ducts'), 'MCP brief export should expose duct VisionEvidence modeling handoff');
  assert.ok(mcpBriefCase.metrics.vision_evidence_modeling_handoff_blocked_interpretations.includes('decorative_facade_trim'), 'MCP brief export should block duct trim interpretation from VisionEvidence handoff');
  assert.ok(mcpBriefCase.metrics.authoritative_artifact_roles.includes('vision_evidence_review_patch'), 'MCP brief export should include VisionEvidence review patch artifact');
	  assert.ok(mcpBriefCase.metrics.reasons.includes('scale_confidence_below_publish_gate'), 'MCP brief export should expose scale blocker');
  assert.ok(mcpBriefCase.metrics.reasons.includes('source_assets_generated_or_scaffold'), 'MCP brief export should expose source-package source blocker');
  assert.ok(mcpBriefCase.metrics.risk_ids.includes('direct_sketchup_dsl_blocked'), 'MCP brief export should expose direct DSL risk id');
  assert.ok(mcpBriefCase.metrics.risk_ids.includes('missing_view_top'), 'MCP brief export should expose missing top view risk id');
  assert.ok(mcpBriefCase.metrics.risk_ids.includes('shadow_recess_boundary_ambiguity'), 'MCP brief export should expose shadow/recess risk id');
  assert.equal(mcpBriefCase.metrics.candidates >= 10, true, 'MCP brief export should carry candidate evidence');
  assert.ok(mcpBriefCase.metrics.disambiguation_roles.includes('visible_plane_recessed_left'), 'MCP brief export should expose recessed facade candidate disambiguation');
  assert.ok(mcpBriefCase.metrics.disambiguation_roles.includes('rectangular_utility_ducts'), 'MCP brief export should expose duct candidate disambiguation');
  assert.ok(mcpBriefCase.metrics.disambiguation_roles.includes('shadow_or_recess_boundary'), 'MCP brief export should expose shadow candidate disambiguation');
  assert.ok(mcpBriefCase.metrics.disambiguation_blocked_interpretations.includes('merged_front_facade_plane'), 'MCP brief export should block merged recessed/front facade interpretation');
  assert.ok(mcpBriefCase.metrics.disambiguation_blocked_interpretations.includes('decorative_facade_trim'), 'MCP brief export should block duct-as-trim interpretation');
  assert.ok(mcpBriefCase.metrics.disambiguation_blocked_interpretations.includes('cut_recess_from_shadow_only'), 'MCP brief export should block shadow-only recess cuts');
  assert.ok(mcpBriefCase.metrics.modeling_constraint_roles.includes('visible_plane_recessed_left'), 'MCP brief export should expose recessed facade modeling constraints');
  assert.ok(mcpBriefCase.metrics.modeling_constraint_roles.includes('rectangular_utility_ducts'), 'MCP brief export should expose duct modeling constraints');
  assert.ok(mcpBriefCase.metrics.modeling_constraint_roles.includes('shadow_or_recess_boundary'), 'MCP brief export should expose shadow modeling constraints');
  assert.ok(mcpBriefCase.metrics.modeling_constraint_critical_roles.includes('rectangular_utility_ducts'), 'MCP brief export should mark duct constraints critical');
  assert.ok(mcpBriefCase.metrics.modeling_constraint_blocked_interpretations.includes('decorative_facade_trim'), 'MCP brief export should summarize duct blocked interpretations');
  const mcpBriefBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'mcp-modeling-brief-export');
  const mcpBrief = JSON.parse(await fs.readFile(path.join(mcpBriefBase, 'mcp-modeling-brief.json'), 'utf8'));
  assertValid(validateMcpModelingBrief, mcpBrief, 'release gate MCP modeling brief');
	  assert.equal(mcpBrief.compile_permission.can_generate_sketchup_dsl, false, 'release gate MCP brief should remain fail-closed');
  assert.equal(mcpBrief.agent_contract.output_policy.sketchup_dsl_allowed, false, 'release gate MCP agent contract should remain fail-closed');
  assert.ok(mcpBrief.agent_contract.output_policy.blocked_outputs.includes('direct_sketchup_dsl'), 'release gate MCP agent contract should block direct DSL output');
  assert.ok(mcpBrief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'source_package'), 'release gate MCP agent contract should include source-package artifact');
  assert.ok(mcpBrief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'vision_evidence_review_patch'), 'release gate MCP agent contract should include VisionEvidence patch artifact');
  assert.equal(mcpBrief.evidence_summary.vision_evidence.available, true, 'release gate MCP brief should include VisionEvidence summary');
  assertVisionEvidenceWorkspaceInstance(mcpBrief.evidence_summary.vision_evidence, 'rectangular_utility_ducts', 'release gate MCP brief should expose duct VisionEvidence semantic instance');
  assertVisionEvidenceModelingHandoff(mcpBrief.evidence_summary.vision_evidence, 'rectangular_utility_ducts', 'decorative_facade_trim', 'release gate MCP brief should expose duct VisionEvidence modeling handoff');
	  assert.equal(mcpBrief.source_package_gate.status, 'blocked_source_assets', 'release gate MCP brief should include source-package gate');
  assert.ok(mcpBrief.source_package_gate.release_checklist_required_check_ids.includes('vision_evidence_review'), 'release gate MCP brief should expose required release checklist id');
  assert.ok(mcpBrief.source_package_gate.release_checklist_failed_required_check_ids.includes('photo_grade_readiness'), 'release gate MCP brief should expose failed required release checklist id');
  assert.equal(mcpBrief.source_package_gate.source_request.status, 'needs_source_replacement', 'release gate MCP brief should include source request status');
  assert.ok(mcpBrief.source_package_gate.source_request.blocked_until_satisfied.includes('direct_sketchup_dsl'), 'release gate MCP brief source request should block direct DSL');
	  assert.ok(mcpBrief.source_package_gate.blockers.includes('source_assets_generated_or_scaffold'), 'release gate MCP brief should include source-package blockers');
  assert.ok(mcpBrief.prohibitions.some((item) => item.includes('recessed visible plane evidence')), 'MCP brief should keep recessed facade caution');
  assert.ok(mcpBrief.prohibitions.some((item) => item.includes('rectangular utility ducts')), 'MCP brief should keep duct caution');
  assert.ok(mcpBrief.prohibitions.some((item) => item.includes('shadows into geometry')), 'MCP brief should keep shadow ambiguity caution');
  assertMcpModelingConstraintRole(mcpBrief, 'visible_plane_recessed_left', 'merged_front_facade_plane', 'MCP brief should summarize recessed facade constraints');
  assertMcpModelingConstraintRole(mcpBrief, 'rectangular_utility_ducts', 'decorative_facade_trim', 'MCP brief should summarize duct constraints');
  assertMcpModelingConstraintRole(mcpBrief, 'shadow_or_recess_boundary', 'cut_recess_from_shadow_only', 'MCP brief should summarize shadow/recess constraints');
  assert.ok(mcpBrief.grounding_risk_register.some((risk) => risk.id === 'visible_plane_recessed_left_requires_separate_plane_review' && risk.status === 'review_required'), 'MCP brief should register recessed facade risk as review-required');
  assert.ok(mcpBrief.candidate_disambiguation.some((item) => item.role === 'visible_plane_recessed_left' && item.blocked_interpretations.includes('merged_front_facade_plane')), 'MCP brief should disambiguate recessed facade from front facade');
  assert.ok(mcpBrief.candidate_disambiguation.some((item) => item.role === 'rectangular_utility_ducts' && item.blocked_interpretations.includes('decorative_facade_trim')), 'MCP brief should disambiguate ducts from facade trim');
  assert.ok(mcpBrief.candidate_disambiguation.some((item) => item.role === 'shadow_or_recess_boundary' && item.blocked_interpretations.includes('cut_recess_from_shadow_only')), 'MCP brief should disambiguate shadows from recess geometry');
	  const mcpBriefMarkdown = await fs.readFile(path.join(mcpBriefBase, 'mcp-modeling-brief.md'), 'utf8');
	  assert.ok(mcpBriefMarkdown.includes('Do not generate SketchUp DSL directly'), 'MCP brief markdown should include direct DSL prohibition');
  assert.ok(mcpBriefMarkdown.includes('## Agent Contract'), 'MCP brief markdown should include agent contract section');
  assert.ok(mcpBriefMarkdown.includes('## Candidate Disambiguation'), 'MCP brief markdown should include candidate disambiguation section');
  assert.ok(mcpBriefMarkdown.includes('## Modeling Constraint Summary'), 'MCP brief markdown should include modeling constraint summary section');
  assert.ok(mcpBriefMarkdown.includes('## Grounding Risk Register'), 'MCP brief markdown should include grounding risk register');
  assert.ok(mcpBriefMarkdown.includes('merged_front_facade_plane'), 'MCP brief markdown should include recessed facade blocked interpretation');
  assert.ok(mcpBriefMarkdown.includes('decorative_facade_trim'), 'MCP brief markdown should include duct blocked interpretation');
  assert.ok(mcpBriefMarkdown.includes('cut_recess_from_shadow_only'), 'MCP brief markdown should include shadow blocked interpretation');
  assert.ok(mcpBriefMarkdown.includes('direct_sketchup_dsl'), 'MCP brief markdown should include blocked output token');
  const defaultIntakeMcpBriefBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'building-single-blocked');
  const defaultIntakeSourcePackageGateResult = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'real-world-building-source-package.require-input-ready.gate-result.json'), 'utf8'));
  const defaultIntakeSummary = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'intake-summary.json'), 'utf8'));
  assertValid(validateStructuredAssetIntakeSummary, defaultIntakeSummary, 'release gate default intake summary');
  assert.equal(defaultIntakeSummary.ok, false, 'release gate default intake summary should preserve failed source-package hard gate');
  const defaultIntakeSourcePackageUploadGateResult = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'real-world-building-source-package.gate-result.json'), 'utf8'));
  assertValid(validateRealWorldBuildingSourcePackageGateResult, defaultIntakeSourcePackageUploadGateResult, 'release gate default intake source-package upload gate result');
  assert.equal(defaultIntakeSourcePackageUploadGateResult.ok, false, 'release gate default intake upload gate result should fail blocked intake');
  assert.deepEqual(defaultIntakeSourcePackageUploadGateResult.failed_requirements, ['input_ready_for_release_work'], 'release gate upload gate result should preserve failed input-ready requirement');
  assertValid(validateRealWorldBuildingSourcePackageGateResult, defaultIntakeSourcePackageGateResult, 'release gate default intake source-package require-input-ready gate result');
  assert.equal(defaultIntakeSourcePackageGateResult.ok, false, 'release gate source-package gate result should fail blocked intake');
  assert.deepEqual(defaultIntakeSourcePackageGateResult.failed_requirements, ['input_ready_for_release_work'], 'release gate source-package gate result should preserve failed input-ready requirement');
  const defaultIntakeMcpBrief = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'mcp-modeling-brief.json'), 'utf8'));
  assertValid(validateMcpModelingBrief, defaultIntakeMcpBrief, 'release gate default intake MCP modeling brief');
  assert.equal(defaultIntakeMcpBrief.compile_permission.can_generate_sketchup_dsl, false, 'default intake MCP brief should remain fail-closed');
  assert.equal(defaultIntakeMcpBrief.source_package_gate.status, 'blocked_source_assets', 'default intake MCP brief should embed source-package gate status');
  assert.equal(defaultIntakeMcpBrief.evidence_summary.vision_evidence.available, true, 'default intake MCP brief should embed VisionEvidence summary');
  assertMcpModelingConstraintRole(defaultIntakeMcpBrief, 'rectangular_utility_ducts', 'decorative_facade_trim', 'default intake MCP brief should summarize duct constraints');
  const defaultIntakeVisionReviewPatch = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'vision-evidence-review-patch.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewPatch, defaultIntakeVisionReviewPatch, 'release gate default intake VisionEvidence review patch');
  assertSemanticReviewItemHasEvidenceInstance(defaultIntakeVisionReviewPatch, 'rectangular_utility_ducts', 'release gate default intake VisionEvidence patch should locate duct evidence');
  const defaultIntakeMcpBriefMarkdown = await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'mcp-modeling-brief.md'), 'utf8');
  assert.ok(defaultIntakeMcpBriefMarkdown.includes('Do not generate SketchUp DSL directly'), 'default intake MCP markdown should include direct DSL prohibition');
  const defaultIntakeReleaseSummary = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'real-world-building-release', 'manifest-contract-summary.json'), 'utf8'));
  const defaultIntakeReleaseChecklist = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'real-world-building-release', 'release-checklist.json'), 'utf8'));
  const defaultIntakeReleaseWorkOrder = JSON.parse(await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'real-world-building-release', 'release-work-order.json'), 'utf8'));
  const defaultIntakeReviewHtml = await fs.readFile(path.join(defaultIntakeMcpBriefBase, 'review', 'index.html'), 'utf8');
  assert.equal(defaultIntakeReleaseSummary.closes_release_gap, false, 'release gate default intake release summary should not close the gap');
  assertValid(validateRealWorldBuildingChecklist, defaultIntakeReleaseChecklist, 'release gate default intake release checklist');
  assertValid(validateRealWorldBuildingReleaseWorkOrder, defaultIntakeReleaseWorkOrder, 'release gate default intake release work order');
  assert.equal(defaultIntakeReleaseChecklist.release_ready, false, 'release gate default intake release checklist should remain blocked');
  assert.equal(defaultIntakeReleaseWorkOrder.status, 'blocked_needs_source_assets', 'release gate default intake work order should remain source-blocked');
  assert.ok(defaultIntakeReviewHtml.includes('real-world-building-release-summary-data'), 'release gate default intake review should embed release summary');
  assert.ok(defaultIntakeReviewHtml.includes('real-world-building-release-work-order-data'), 'release gate default intake review should embed release work order');
  assert.ok(defaultIntakeReviewHtml.includes('<code>artifacts</code>'), 'release gate default intake review should show release artifact check row');
  const readyCase = report.cases.find((item) => item.id === 'synthetic_ready_promotion_path');
  assert.equal(readyCase.metrics.patch_actions >= 2, true, 'release gate ready path should create promotion actions');
  assert.match(readyCase.metrics.compiler_gate_error, /PartGraph compile blocked by geometry gate/, 'release gate should prove compiler gate is preserved');
  const reviewMatrixCase = report.cases.find((item) => item.id === 'human_review_roundtrip_matrix_fixture');
  assert.equal(reviewMatrixCase.metrics.cases, 3, 'human review roundtrip matrix should cover three cases');
  assert.equal(reviewMatrixCase.metrics.ready_cases, 2, 'human review roundtrip matrix should include two ready cases');
  assert.equal(reviewMatrixCase.metrics.blocked_cases, 1, 'human review roundtrip matrix should include one blocked case');
  assert.deepEqual(reviewMatrixCase.metrics.sources, ['document', 'image'], 'human review roundtrip matrix should cover document and image sources');
  assert.equal(reviewMatrixCase.metrics.document_promoted_parts, 1, 'human review document matrix should promote one part');
  assert.equal(reviewMatrixCase.metrics.image_promoted_parts >= 2, true, 'human review image matrix should promote multiple parts');
  assert.match(reviewMatrixCase.metrics.blocked_apply_error, /not applyable/, 'human review blocked matrix should reject application');
  const reviewMatrixBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'human-review-roundtrip-matrix');
  const reviewMatrixSummary = JSON.parse(await fs.readFile(path.join(reviewMatrixBase, 'human-review-roundtrip-matrix-summary.json'), 'utf8'));
  assert.equal(reviewMatrixSummary.cases.length, 3, 'human review matrix summary should save all cases');
  for (const relative of [
    'document-accepted/candidate-promotion-review.accepted.json',
    'image-synthetic-ready/candidate-promotion-review.accepted.json',
    'image-blocked-selection/candidate-promotion-review.blocked.json'
  ]) {
    assertValid(validateCandidatePromotionReview, JSON.parse(await fs.readFile(path.join(reviewMatrixBase, relative), 'utf8')), `human review matrix ${relative}`);
  }
  for (const relative of [
    'document-accepted/candidate-promotion-patch.ready.json',
    'image-synthetic-ready/candidate-promotion-patch.ready.json',
    'image-blocked-selection/candidate-promotion-patch.blocked.json'
  ]) {
    assertValid(validateCandidatePromotionPatch, JSON.parse(await fs.readFile(path.join(reviewMatrixBase, relative), 'utf8')), `human review matrix ${relative}`);
  }
  for (const relative of [
    'document-accepted/part-graph.candidate-promoted.json',
    'image-synthetic-ready/part-graph.candidate-promoted.json'
  ]) {
    assertValid(validatePartGraph, JSON.parse(await fs.readFile(path.join(reviewMatrixBase, relative), 'utf8')), `human review matrix ${relative}`);
  }
  const reviewUiCase = report.cases.find((item) => item.id === 'human_review_ui_release_matrix_fixture');
  assert.equal(reviewUiCase.metrics.browser, 'chrome-cdp-headless', 'human review UI release matrix should run through headless Chrome CDP');
  assert.equal(reviewUiCase.metrics.cases, 3, 'human review UI release matrix should cover three cases');
  assert.equal(reviewUiCase.metrics.ready_cases, 2, 'human review UI release matrix should include two ready cases');
  assert.equal(reviewUiCase.metrics.blocked_cases, 1, 'human review UI release matrix should include one blocked case');
  assert.deepEqual(reviewUiCase.metrics.sources, ['document', 'image'], 'human review UI release matrix should cover document and image sources');
  assert.equal(reviewUiCase.metrics.document_promoted_parts, 1, 'human review UI document case should promote one part');
  assert.equal(reviewUiCase.metrics.image_promoted_parts, 2, 'human review UI image case should promote two semantic candidates');
  assert.match(reviewUiCase.metrics.blocked_apply_error, /not applyable/, 'human review UI blocked case should reject application');
  const reviewUiBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'human-review-ui-release-matrix');
  const reviewUiSummary = JSON.parse(await fs.readFile(path.join(reviewUiBase, 'human-review-ui-release-matrix-summary.json'), 'utf8'));
  assert.equal(reviewUiSummary.browser, 'chrome-cdp-headless', 'human review UI matrix summary should record browser driver');
  assert.equal(reviewUiSummary.cases.length, 3, 'human review UI matrix summary should save all cases');
  const documentBrowserReview = JSON.parse(await fs.readFile(path.join(reviewUiBase, 'document-accepted', 'candidate-promotion-review.browser-exported.json'), 'utf8'));
  const imageBrowserReview = JSON.parse(await fs.readFile(path.join(reviewUiBase, 'image-accepted', 'candidate-promotion-review.browser-exported.json'), 'utf8'));
  const imageBlockedBrowserReview = JSON.parse(await fs.readFile(path.join(reviewUiBase, 'image-blocked-selection', 'candidate-promotion-review.browser-exported.json'), 'utf8'));
  for (const [label, review] of [
    ['document accepted browser review', documentBrowserReview],
    ['image accepted browser review', imageBrowserReview],
    ['image blocked browser review', imageBlockedBrowserReview]
  ]) {
    assertValid(validateCandidatePromotionReview, review, `human review UI ${label}`);
  }
  assert.equal(documentBrowserReview.verdict, 'accepted_subset', 'document browser-exported review should accept a subset');
  assert.equal(documentBrowserReview.profile_confirmation.status, 'confirmed', 'document browser-exported review should confirm profile');
  assert.equal(documentBrowserReview.scale_confirmation.status, 'confirmed', 'document browser-exported review should confirm scale');
  assert.deepEqual(documentBrowserReview.blockers, [], 'document browser-exported review should clear blockers after explicit UI confirmations');
  assert.ok(documentBrowserReview.resolved_blockers.includes('missing_front_view'), 'document browser-exported review should record resolved missing-view blockers');
  assert.ok(documentBrowserReview.resolved_blockers.includes('review_required'), 'document browser-exported review should record resolved candidate blockers');
  assert.equal(imageBrowserReview.verdict, 'accepted_subset', 'image browser-exported review should accept a subset');
  assert.equal(imageBrowserReview.accepted_candidates.length, 2, 'image browser-exported review should accept two semantic candidates');
  assert.equal(imageBrowserReview.profile_confirmation.status, 'confirmed', 'image browser-exported review should confirm profile');
  assert.equal(imageBrowserReview.scale_confirmation.status, 'confirmed', 'image browser-exported review should confirm scale');
  assert.deepEqual(imageBrowserReview.blockers, [], 'image browser-exported review should clear blockers after explicit UI confirmations');
  assert.ok(imageBrowserReview.resolved_blockers.includes('scale_confidence_below_publish_gate'), 'image browser-exported review should record resolved scale blocker');
  assert.equal(imageBrowserReview.draft_view_review.status, 'accepted', 'image browser-exported review should accept DraftViewGraph slots');
  assert.ok(imageBrowserReview.draft_view_review.accepted_view_slot_ids.length > 0, 'image browser-exported review should export accepted draft view ids');
  assert.equal(imageBrowserReview.local_detail_review.status, 'accepted', 'image browser-exported review should accept local surface/detail ids');
  assert.ok(imageBrowserReview.local_detail_review.accepted_surface_ids.length > 0 || imageBrowserReview.local_detail_review.accepted_detail_ids.length > 0, 'image browser-exported review should export accepted surface/detail ids');
  assert.equal(imageBrowserReview.facade_plane_review.status, 'accepted', 'image browser-exported review should accept facade plane ids');
  assert.ok(imageBrowserReview.facade_plane_review.accepted_plane_ids.length > 0, 'image browser-exported review should export accepted facade plane ids');
  assert.equal(imageBlockedBrowserReview.verdict, 'blocked', 'image blocked browser-exported review should stay blocked');
  assert.equal(imageBlockedBrowserReview.profile_confirmation.status, 'routed_unconfirmed', 'image blocked browser-exported review should not confirm profile');
  assert.equal(imageBlockedBrowserReview.scale_confirmation.status, 'needs_scale_confirmation', 'image blocked browser-exported review should not confirm scale');
  assert.equal(imageBlockedBrowserReview.blockers.length > 0, true, 'image blocked browser-exported review should keep blockers visible');
  const documentBrowserPatch = JSON.parse(await fs.readFile(path.join(reviewUiBase, 'document-accepted', 'candidate-promotion-patch.browser-ready.json'), 'utf8'));
  const imageBrowserPatch = JSON.parse(await fs.readFile(path.join(reviewUiBase, 'image-accepted', 'candidate-promotion-patch.browser-ready.json'), 'utf8'));
  const imageBlockedBrowserPatch = JSON.parse(await fs.readFile(path.join(reviewUiBase, 'image-blocked-selection', 'candidate-promotion-patch.browser-blocked.json'), 'utf8'));
  for (const [label, patch] of [
    ['document accepted browser patch', documentBrowserPatch],
    ['image accepted browser patch', imageBrowserPatch],
    ['image blocked browser patch', imageBlockedBrowserPatch]
  ]) {
    assertValid(validateCandidatePromotionPatch, patch, `human review UI ${label}`);
  }
  assert.equal(documentBrowserPatch.status, 'ready_for_part_graph_patch', 'document browser-exported review should produce a ready promotion patch');
  assert.equal(documentBrowserPatch.apply_allowed, true, 'document browser-exported patch should be applyable');
  assert.equal(documentBrowserPatch.actions.length, 1, 'document browser-exported patch should contain one action');
  assert.equal(imageBrowserPatch.status, 'ready_for_part_graph_patch', 'image browser-exported review should produce a ready promotion patch');
  assert.equal(imageBrowserPatch.apply_allowed, true, 'image browser-exported patch should be applyable');
  assert.equal(imageBrowserPatch.actions.length, 2, 'image browser-exported patch should contain two actions');
  assert.ok(imageBrowserPatch.actions.every((action) => action.accepted_draft_view_slot_id), 'image browser-exported patch actions should carry accepted draft slot ids');
  assert.ok(imageBrowserPatch.actions.every((action) => action.accepted_surface_id || action.accepted_detail_id), 'image browser-exported patch actions should carry accepted local surface/detail ids');
  assert.equal(imageBlockedBrowserPatch.status, 'blocked', 'image blocked browser-exported patch should stay blocked');
  assert.equal(imageBlockedBrowserPatch.apply_allowed, false, 'image blocked browser-exported patch should not be applyable');
  assert.equal(imageBlockedBrowserPatch.actions.length, 0, 'image blocked browser-exported patch should not contain actions');
  assertValid(validatePartGraph, JSON.parse(await fs.readFile(path.join(reviewUiBase, 'document-accepted', 'part-graph.browser-promoted.json'), 'utf8')), 'human review UI document browser-promoted PartGraph');
  assertValid(validatePartGraph, JSON.parse(await fs.readFile(path.join(reviewUiBase, 'image-accepted', 'part-graph.browser-promoted.json'), 'utf8')), 'human review UI image browser-promoted PartGraph');
  const acceptedPositiveCase = report.cases.find((item) => item.id === 'accepted_positive_release_sample_fixture');
  assert.equal(acceptedPositiveCase.metrics.profile_id, 'building_group_industrial_campus', 'accepted positive release fixture should use building group profile');
  assert.equal(acceptedPositiveCase.metrics.parts >= 10, true, 'accepted positive release fixture should contain enough parts');
  assert.equal(acceptedPositiveCase.metrics.source_images >= 2, true, 'accepted positive release fixture should keep source image provenance');
  assert.equal(acceptedPositiveCase.metrics.evidence_counts.manual_confirmed >= 5, true, 'accepted positive release fixture should include manually confirmed evidence');
  assert.equal(acceptedPositiveCase.metrics.evidence_counts.observed >= 4, true, 'accepted positive release fixture should include observed evidence');
  assert.equal(acceptedPositiveCase.metrics.scale_confidence >= 0.7, true, 'accepted positive release fixture should meet scale gate');
  assert.equal(acceptedPositiveCase.metrics.layout_issues, 0, 'accepted positive release fixture layout QA should have no issues');
  assert.equal(acceptedPositiveCase.metrics.reference_issues, 0, 'accepted positive release fixture reference QA should have no issues');
  assert.equal(acceptedPositiveCase.metrics.proposal_qa_ok, true, 'accepted positive release fixture proposal QA should pass');
  assert.equal(acceptedPositiveCase.metrics.queue_qa_ok, true, 'accepted positive release fixture queue QA should pass');
  assert.equal(acceptedPositiveCase.metrics.queue_artifact_size_bytes > 0, true, 'accepted positive release fixture should record queue artifact size');
  assert.equal(acceptedPositiveCase.metrics.physical_verdict, 'pass', 'accepted positive release fixture physical QA should pass');
  assert.equal(acceptedPositiveCase.metrics.operation_counts.cut_recess >= 1, true, 'accepted positive release fixture should compile facade feature ops');
  assert.equal(acceptedPositiveCase.metrics.operation_counts.add_raised_rib >= 1, true, 'accepted positive release fixture should compile roof feature ops');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_review_patch_status, 'needs_review', 'accepted positive release fixture should expose VisionEvidence review patch');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_review_apply_allowed, false, 'accepted positive VisionEvidence review patch should not be applyable');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_review_compile_allowed, false, 'accepted positive VisionEvidence review patch should not allow compile');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_review_items >= 5, true, 'accepted positive VisionEvidence review patch should expose review items');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_ground_plane_review_items >= 3, true, 'accepted positive VisionEvidence review patch should expose ground-plane review items');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_review_decision_status, 'accepted_policy_review', 'accepted positive release fixture should expose VisionEvidence review decision');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_review_decision_browser, 'chrome-cdp-headless', 'accepted positive VisionEvidence review decision should be exported through browser UI');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_policy_correction_status, 'ready_for_vision_evidence_policy_update', 'accepted positive release fixture should expose VisionEvidence policy correction patch');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_policy_correction_apply_scope, 'vision_evidence_set_policy_only', 'accepted positive VisionEvidence policy correction should be scoped to evidence metadata');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_policy_correction_actions >= 5, true, 'accepted positive VisionEvidence policy correction should expose policy actions');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_policy_correction_apply_allowed, true, 'accepted positive VisionEvidence policy correction should be applyable to evidence metadata');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_policy_correction_compile_allowed, false, 'accepted positive VisionEvidence policy correction should not allow compile');
  assert.equal(acceptedPositiveCase.metrics.vision_evidence_policy_correction_geometry_promotion_allowed, false, 'accepted positive VisionEvidence policy correction should not allow geometry promotion');
  const acceptedPositiveBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'accepted-positive-building-group');
  assertValid(validatePartGraph, JSON.parse(await fs.readFile(path.join(repoRoot, 'projects', 'image-structured-modeler', 'examples', 'building-group', 'part-graph.r7-final.json'), 'utf8')), 'accepted positive release source PartGraph');
  assert.equal(JSON.parse(await fs.readFile(path.join(acceptedPositiveBase, 'physical-consistency-report.json'), 'utf8')).verdict, 'pass', 'accepted positive release physical-consistency-report.json');
  assert.equal(JSON.parse(await fs.readFile(path.join(acceptedPositiveBase, 'positive-release-sample-summary.json'), 'utf8')).qa.physical_consistency, 'pass', 'accepted positive release sample summary');
  const savedAcceptedVisionReviewPatch = JSON.parse(await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-review-patch.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewPatch, savedAcceptedVisionReviewPatch, 'release gate accepted positive VisionEvidence review patch');
  assert.equal(savedAcceptedVisionReviewPatch.status, 'needs_review', 'release gate accepted positive VisionEvidence review patch should require review');
  assert.equal(savedAcceptedVisionReviewPatch.apply_allowed, false, 'release gate accepted positive VisionEvidence review patch should not be applyable');
  assert.equal(savedAcceptedVisionReviewPatch.compile_allowed, false, 'release gate accepted positive VisionEvidence review patch should not allow compile');
  assert.ok(
    savedAcceptedVisionReviewPatch.review_items.some((item) => item.required_decision === 'confirm_roof_seams_are_not_site_or_road_boundaries'),
    'release gate accepted positive VisionEvidence review patch should require roof seam review'
  );
  assert.ok(
    (await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-review-patch.md'), 'utf8')).includes('Vision Evidence Review Patch'),
    'release gate accepted positive VisionEvidence review patch markdown should include title'
  );
  const acceptedVisionReviewWorkbench = await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-review', 'index.html'), 'utf8');
  assert.ok(acceptedVisionReviewWorkbench.includes('vision-evidence-review-decision-json'), 'release gate accepted positive VisionEvidence workbench should expose decision export textarea');
  assert.ok(acceptedVisionReviewWorkbench.includes('download-vision-evidence-review'), 'release gate accepted positive VisionEvidence workbench should expose decision download');
  const savedAcceptedBrowserVisionReviewDecision = JSON.parse(await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-review', 'vision-evidence-review.browser-exported.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewDecision, savedAcceptedBrowserVisionReviewDecision, 'release gate accepted positive browser-exported VisionEvidence review decision');
  assert.equal(savedAcceptedBrowserVisionReviewDecision.reviewer, 'release-gate vision evidence browser ui', 'release gate accepted positive VisionEvidence review decision should come from browser UI');
  assert.equal(savedAcceptedBrowserVisionReviewDecision.compile_allowed, false, 'release gate accepted positive browser-exported VisionEvidence review decision should not allow compile');
  assert.equal(savedAcceptedBrowserVisionReviewDecision.geometry_promotion_allowed, false, 'release gate accepted positive browser-exported VisionEvidence review decision should not allow geometry promotion');
  const savedAcceptedVisionReviewDecision = JSON.parse(await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-review.accepted.json'), 'utf8'));
  assertValid(validateVisionEvidenceReviewDecision, savedAcceptedVisionReviewDecision, 'release gate accepted positive VisionEvidence review decision');
  assert.equal(savedAcceptedVisionReviewDecision.reviewer, savedAcceptedBrowserVisionReviewDecision.reviewer, 'release gate accepted positive VisionEvidence review decision alias should mirror browser export');
  assert.equal(savedAcceptedVisionReviewDecision.compile_allowed, false, 'release gate accepted positive VisionEvidence review decision should not allow compile');
  assert.equal(savedAcceptedVisionReviewDecision.geometry_promotion_allowed, false, 'release gate accepted positive VisionEvidence review decision should not allow geometry promotion');
  const savedAcceptedVisionPolicyPatch = JSON.parse(await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-policy-correction-patch.json'), 'utf8'));
  assertValid(validateVisionEvidencePolicyCorrectionPatch, savedAcceptedVisionPolicyPatch, 'release gate accepted positive VisionEvidence policy correction patch');
  assert.equal(savedAcceptedVisionPolicyPatch.apply_scope, 'vision_evidence_set_policy_only', 'release gate accepted positive VisionEvidence policy correction patch should be evidence-policy scoped');
  assert.equal(savedAcceptedVisionPolicyPatch.compile_allowed, false, 'release gate accepted positive VisionEvidence policy correction patch should not allow compile');
  assert.equal(savedAcceptedVisionPolicyPatch.geometry_promotion_allowed, false, 'release gate accepted positive VisionEvidence policy correction patch should not allow geometry promotion');
  assert.ok(
    (await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-policy-correction-patch.md'), 'utf8')).includes('Vision Evidence Policy Correction Patch'),
    'release gate accepted positive VisionEvidence policy correction markdown should include title'
  );
  const savedAcceptedReviewedVisionEvidenceSet = JSON.parse(await fs.readFile(path.join(acceptedPositiveBase, 'vision-evidence-v1.reviewed.json'), 'utf8'));
  assertValid(validateVisionEvidenceSetV1, savedAcceptedReviewedVisionEvidenceSet, 'release gate accepted positive reviewed VisionEvidenceSet');
  assert.equal(savedAcceptedReviewedVisionEvidenceSet.review.policy_correction_patches_applied[0].geometry_promotion_allowed, false, 'release gate accepted positive reviewed VisionEvidenceSet should keep geometry promotion blocked');
  const realWorldProductCase = report.cases.find((item) => item.id === 'real_world_positive_switch_product_fixture');
  assert.equal(realWorldProductCase.metrics.sample_scope, 'real_world_product_positive', 'real-world product fixture should label its sample scope');
  assert.equal(realWorldProductCase.metrics.release_gate_decision, 'not_building_release_positive', 'real-world product fixture should not close the building release gap');
  assert.equal(realWorldProductCase.metrics.source_images, 6, 'real-world product fixture should keep six source images');
  assert.equal(realWorldProductCase.metrics.source_images_exist, true, 'real-world product fixture should verify source image files');
  for (const view of ['front', 'rear', 'right', 'oblique']) {
    assert.ok(realWorldProductCase.metrics.views_detected.includes(view), `real-world product fixture should include ${view} view evidence`);
  }
  assert.equal(realWorldProductCase.metrics.evidence_graph_parts >= 8, true, 'real-world product fixture should keep evidence graph parts');
  assert.equal(realWorldProductCase.metrics.relation_candidates >= 100, true, 'real-world product fixture should keep visual relation candidates');
  assert.equal(realWorldProductCase.metrics.model_plan_parts >= 8, true, 'real-world product fixture should keep model-plan parts');
  assert.equal(realWorldProductCase.metrics.evidence_counts.observed >= 6, true, 'real-world product fixture should keep observed evidence counts');
  assert.ok(realWorldProductCase.metrics.missing_views.includes('top'), 'real-world product fixture should keep the missing top-view caveat');
  assert.equal(realWorldProductCase.metrics.compiled_matches_output, true, 'real-world product fixture should verify compiler freshness');
  assert.equal(realWorldProductCase.metrics.operation_counts.rounded_box >= 6, true, 'real-world product fixture should keep rounded primitives');
  assert.equal(realWorldProductCase.metrics.operation_counts.component_instance >= 4, true, 'real-world product fixture should keep component instances');
  assert.equal(realWorldProductCase.metrics.mock_groups, realWorldProductCase.metrics.queue_groups, 'real-world product fixture should match mock/queue group counts');
  assert.equal(realWorldProductCase.metrics.mock_instances, realWorldProductCase.metrics.queue_instances, 'real-world product fixture should match mock/queue instance counts');
  assert.equal(realWorldProductCase.metrics.queue_warning_gate_ok, true, 'real-world product fixture queue warning gate should pass');
  assert.equal(realWorldProductCase.metrics.visual_relation_checked >= 6, true, 'real-world product fixture should check visual relations');
  assert.equal(realWorldProductCase.metrics.geometry_fit_checked_footprints >= 8, true, 'real-world product fixture should check geometry-fit footprints');
  assert.equal(realWorldProductCase.metrics.geometry_fit_checked_relations >= 6, true, 'real-world product fixture should check geometry-fit relations');
  const realWorldProductBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'real-world-positive-switch-product');
  const realWorldProductSummary = JSON.parse(await fs.readFile(path.join(realWorldProductBase, 'real-world-positive-product-summary.json'), 'utf8'));
  assert.equal(realWorldProductSummary.release_gate_decision, 'counts_as_real_world_product_positive_not_building_release_positive', 'real-world product summary should preserve the building-scope caveat');
  assert.equal(realWorldProductSummary.source_images_exist, true, 'real-world product summary should record source image existence');
  assert.equal(realWorldProductSummary.qa.compiled_matches_output, true, 'real-world product summary should record compiler freshness');
  assert.equal(realWorldProductSummary.qa.queue_warning_gate, 'pass', 'real-world product summary should record queue warning gate pass');
  assert.equal(JSON.parse(await fs.readFile(path.join(realWorldProductBase, 'compiled-output.json'), 'utf8')).operations.length, realWorldProductCase.metrics.operations, 'real-world product compiled output should match report metrics');
  const formalManifestWriteGuardCase = report.cases.find((item) => item.id === 'real_world_building_formal_manifest_write_guard');
  assert.equal(formalManifestWriteGuardCase.status, 'formal_manifest_write_blocked', 'formal manifest write guard should block invalid formal target writes');
  assert.equal(formalManifestWriteGuardCase.metrics.requested_formal_manifest, true, 'formal manifest write guard should record requested formal target');
  assert.equal(formalManifestWriteGuardCase.metrics.formal_write_blocked, true, 'formal manifest write guard should block formal manifest writes');
  assert.equal(formalManifestWriteGuardCase.metrics.formal_manifest_unchanged, true, 'formal manifest write guard should leave formal manifest unchanged');
  assert.equal(formalManifestWriteGuardCase.metrics.release_work_order_status, 'blocked_needs_source_assets', 'formal manifest write guard should preserve release work order status');
  assert.ok(formalManifestWriteGuardCase.metrics.blockers.includes('source_assets'), 'formal manifest write guard should preserve source blocker');
  assert.ok(formalManifestWriteGuardCase.metrics.blockers.includes('artifacts'), 'formal manifest write guard should preserve artifact blocker');
  assert.equal(formalManifestWriteGuardCase.artifacts.protected_manifest.required, false, 'formal manifest write guard should not advertise protected manifest as required artifact');
  await fs.access(path.join(repoRoot, formalManifestWriteGuardCase.artifacts.staging_manifest));
  await fs.access(path.join(repoRoot, formalManifestWriteGuardCase.artifacts.release_work_order));
  await fs.access(path.join(repoRoot, formalManifestWriteGuardCase.artifacts.release_work_order_markdown));
  const realWorldBuildingManifestCase = report.cases.find((item) => item.id === 'real_world_building_positive_manifest_contract');
  assert.equal(realWorldBuildingManifestCase.status, 'manifest_missing_release_gap_recorded', 'real-world building manifest contract should record the missing manifest gap');
  assert.equal(realWorldBuildingManifestCase.metrics.manifest_present, false, 'real-world building manifest should be absent in the current repo');
  assert.equal(realWorldBuildingManifestCase.metrics.closes_release_gap, false, 'missing real-world building manifest must not close the release gap');
  assert.equal(realWorldBuildingManifestCase.metrics.release_gap, 'real_world_building_positive_release_sample_missing', 'real-world building manifest contract should name the remaining gap');
  assert.equal(realWorldBuildingManifestCase.artifacts.expected_manifest.path, 'projects/image-structured-modeler/examples/real-world-building-positive/manifest.json', 'real-world building manifest artifact should record expected manifest path');
  assert.equal(realWorldBuildingManifestCase.artifacts.expected_manifest.expected_missing, true, 'missing real-world building manifest should be explicit expected-missing artifact');
  assert.equal(realWorldBuildingManifestCase.artifacts.release_checklist, undefined, 'missing real-world building manifest should not advertise absent release-checklist artifact');
  assert.equal(realWorldBuildingManifestCase.artifacts.compiled_output, undefined, 'missing real-world building manifest should not advertise absent compiled output artifact');
  const realWorldBuildingManifestBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'real-world-building-positive-manifest');
  const realWorldBuildingManifestSummary = JSON.parse(await fs.readFile(path.join(realWorldBuildingManifestBase, 'manifest-contract-summary.json'), 'utf8'));
  assert.equal(realWorldBuildingManifestSummary.manifest_present, false, 'real-world building manifest summary should record missing manifest');
  assert.equal(realWorldBuildingManifestSummary.closes_release_gap, false, 'real-world building manifest summary should not close the gap');
  assert.equal(realWorldBuildingManifestSummary.release_gap, 'real_world_building_positive_release_sample_missing', 'real-world building manifest summary should name the release gap');
  const rhinoGuardCase = report.cases.find((item) => item.id === 'building_single_rhino_factory_visual_gap_guard');
  assert.equal(rhinoGuardCase.metrics.queue_layout_qa, 'pass', 'Rhino factory guard should prove layout QA passed');
  assert.equal(rhinoGuardCase.metrics.manual_visual_review, 'fail', 'Rhino factory guard should preserve manual visual failure');
  assert.equal(rhinoGuardCase.metrics.accepted_as_precise_reconstruction, false, 'Rhino factory guard should reject release-positive classification');
  assert.equal(rhinoGuardCase.metrics.findings >= 7, true, 'Rhino factory guard should keep known findings');
  assert.ok(rhinoGuardCase.metrics.blocking_findings.includes('F-004'), 'Rhino factory guard should include roof-shape blocker');
  assert.ok(rhinoGuardCase.metrics.blocking_findings.includes('F-006'), 'Rhino factory guard should include QA false-positive blocker');
  const rhinoGuardBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'building-single-rhino-factory-visual-gap-guard');
  assert.equal(JSON.parse(await fs.readFile(path.join(rhinoGuardBase, 'visual-gap-guard-summary.json'), 'utf8')).release_gate_decision, 'not_release_positive', 'Rhino factory guard summary should reject release-positive use');
  const demoAuditCase = report.cases.find((item) => item.id === 'real_world_building_demo_candidate_audit_fixture');
  assert.equal(demoAuditCase.metrics.release_ready_candidates, 0, 'release gate demo candidate audit should not find release-ready local fixtures');
  assert.equal(demoAuditCase.metrics.input_ready_source_packages, 0, 'release gate demo candidate audit should not find input-ready source packages');
  assert.equal(demoAuditCase.metrics.release_gap, 'real_world_building_positive_release_sample_missing', 'release gate demo candidate audit should keep the release gap visible');
  assert.equal(demoAuditCase.metrics.useful_structure_review_demos >= 1, true, 'release gate demo candidate audit should find review-demo candidates');
  const demoAuditBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'real-world-building-demo-candidate-audit');
  const demoAuditReport = JSON.parse(await fs.readFile(path.join(demoAuditBase, 'candidate-audit-report.json'), 'utf8'));
  assertValid(validateRealWorldBuildingDemoCandidateAudit, demoAuditReport, 'release gate demo candidate audit report');
  assert.equal(demoAuditReport.release_ready, false, 'saved demo candidate audit should remain blocked');
  assert.equal(demoAuditReport.summary.release_ready_candidates, 0, 'saved demo candidate audit should keep local fixtures out of release-ready');
  assert.equal(demoAuditReport.summary.input_ready_source_packages, 0, 'saved demo candidate audit should keep local source packages out of release work');
  assert.ok((await fs.readFile(path.join(demoAuditBase, 'candidate-audit-report.md'), 'utf8')).includes('Real-World Building Demo Candidate Audit'), 'saved demo candidate audit markdown should include title');
  const artifactIntegrityCase = report.cases.find((item) => item.id === 'release_gate_artifact_integrity');
  assert.equal(artifactIntegrityCase.metrics.missing_required_artifacts, 0, 'release gate artifact integrity should not allow missing required artifacts');
  assert.equal(artifactIntegrityCase.metrics.unexpected_present_artifacts, 0, 'release gate artifact integrity should not allow expected-missing paths to exist');
  assert.equal(artifactIntegrityCase.metrics.expected_missing_artifacts, 2, 'release gate artifact integrity should track the missing formal building manifest and guarded formal target');
  assert.equal(artifactIntegrityCase.metrics.checked_artifacts > 0, true, 'release gate artifact integrity should check report artifacts');
  assert.equal(artifactIntegrityCase.metrics.failed_contract_checks, 0, 'release gate artifact integrity should not allow contract drift checks to fail');
  assert.equal(artifactIntegrityCase.metrics.contract_checks >= 23, true, 'release gate artifact integrity should cover release contract drift checks');
  const artifactIntegrityBase = path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'release-gate-artifact-integrity');
  const artifactIntegrityReport = JSON.parse(await fs.readFile(path.join(artifactIntegrityBase, 'artifact-integrity-report.json'), 'utf8'));
  assertValid(validateReleaseGateArtifactIntegrityReport, artifactIntegrityReport, 'saved artifact integrity report');
  assert.equal(artifactIntegrityReport.missing_required_artifacts.length, 0, 'saved artifact integrity report should have no missing required artifacts');
  assert.equal(artifactIntegrityReport.expected_missing_artifacts, 2, 'saved artifact integrity report should preserve expected-missing count');
  assert.equal(artifactIntegrityReport.failed_contract_checks.length, 0, 'saved artifact integrity report should have no failed contract drift checks');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validate_npm_script' && check.status === 'pass'), 'saved artifact integrity report should check workspace validator npm script');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validation_schema_exists' && check.status === 'pass'), 'saved artifact integrity report should check workspace validation schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'handoff_schema_exposes_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check handoff release checklist summary schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'handoff_schema_exposes_artifact_exists_state' && check.status === 'pass'), 'saved artifact integrity report should check handoff artifact exists schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'handoff_schema_exposes_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check handoff semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'upload_session_schema_exposes_handoff_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check upload-session handoff semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'handoff_schema_exposes_vision_evidence_handoff' && check.status === 'pass'), 'saved artifact integrity report should check handoff VisionEvidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'handoff_schema_exposes_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check handoff VisionEvidence modeling handoff schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'upload_session_schema_exposes_handoff_vision_evidence' && check.status === 'pass'), 'saved artifact integrity report should check upload-session handoff VisionEvidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'vision_review_patch_schema_exposes_semantic_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check VisionEvidence semantic evidence instances schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'vision_evidence_builder_emits_semantic_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check VisionEvidence semantic evidence instance builder');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'image_observation_schema_exposes_content_frame' && check.status === 'pass'), 'saved artifact integrity report should check image observation content-frame schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'image_set_schema_exposes_content_frame' && check.status === 'pass'), 'saved artifact integrity report should check image-set content-frame schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'image_analysis_applies_content_frame_before_bbox' && check.status === 'pass'), 'saved artifact integrity report should check content-frame analysis implementation');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_vision_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check MCP brief VisionEvidence instances schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check MCP brief VisionEvidence modeling handoff schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_has_resolvable_defs' && check.status === 'pass'), 'saved artifact integrity report should check MCP brief schema $defs resolution');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'all_subproject_json_schema_refs_resolve' && check.status === 'pass' && check.checked_schemas > 0), 'saved artifact integrity report should check all subproject schema refs resolve');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_builder_emits_vision_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check MCP brief VisionEvidence instance builder');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_builder_emits_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check MCP brief VisionEvidence modeling handoff builder');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_handoff_artifact_exists_state' && check.status === 'pass'), 'saved artifact integrity report should check handoff artifact exists validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_handoff_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check handoff semantic evidence quality validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_handoff_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check handoff VisionEvidence modeling handoff validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_workspace_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check workspace semantic evidence quality validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_workspace_vision_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check workspace VisionEvidence instance validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_workspace_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check workspace VisionEvidence modeling handoff validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_workspace_mcp_authoring_handoff' && check.status === 'pass'), 'saved artifact integrity report should check workspace MCP authoring handoff validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_vision_review_semantic_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check VisionEvidence semantic instance validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_mcp_vision_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check MCP VisionEvidence instance validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_mcp_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check MCP VisionEvidence modeling handoff validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_schema_exposes_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check workspace release checklist summary schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_schema_exposes_mcp_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check workspace MCP release checklist summary schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_schema_exposes_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check workspace semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_schema_exposes_vision_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check workspace VisionEvidence instances schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_schema_exposes_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check workspace VisionEvidence modeling handoff schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_schema_exposes_mcp_authoring_handoff' && check.status === 'pass'), 'saved artifact integrity report should check workspace MCP authoring handoff schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validator_checks_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check workspace release checklist summary validator');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validator_checks_mcp_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check workspace MCP release checklist summary validator');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validator_checks_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check workspace semantic evidence quality validator');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validator_checks_vision_evidence_instances' && check.status === 'pass'), 'saved artifact integrity report should check workspace VisionEvidence instances validator');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validator_checks_vision_evidence_modeling_handoff' && check.status === 'pass'), 'saved artifact integrity report should check workspace VisionEvidence modeling handoff validator');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'workspace_validator_checks_mcp_authoring_handoff' && check.status === 'pass'), 'saved artifact integrity report should check workspace MCP authoring handoff validator');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_request_schema_exposes_upload_package_requirements' && check.status === 'pass'), 'saved artifact integrity report should check source-request upload package requirements schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_request_schema_exposes_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check source-request semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_package_schema_exposes_source_request_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check source-package embedded source-request semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_request_response_schema_exposes_expected_check_ids' && check.status === 'pass'), 'saved artifact integrity report should check source-request response expected check ids schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_request_response_schema_exposes_view_evidence_summary' && check.status === 'pass'), 'saved artifact integrity report should check source-request response view evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_request_response_schema_exposes_semantic_evidence_summary' && check.status === 'pass'), 'saved artifact integrity report should check source-request response semantic evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_request_response_schema_exposes_semantic_requested_role_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-request response requested role evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_request_response_schema_exposes_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check source-request response semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'demo_candidate_audit_schema_exposes_source_refill_package_validation_command' && check.status === 'pass'), 'saved artifact integrity report should check demo candidate source-refill package validation command schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'release_artifact_workspace_schema_exposes_source_refill_package_validation_command' && check.status === 'pass'), 'saved artifact integrity report should check workspace source-refill package validation command schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'release_artifact_workspace_validator_checks_source_refill_package_commands' && check.status === 'pass'), 'saved artifact integrity report should check workspace source-refill package command validator');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_source_response_expected_check_ids' && check.status === 'pass'), 'saved artifact integrity report should check MCP source response expected check ids schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_source_response_view_evidence' && check.status === 'pass'), 'saved artifact integrity report should check MCP source response view evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_source_response_semantic_evidence' && check.status === 'pass'), 'saved artifact integrity report should check MCP source response semantic evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_source_response_semantic_requested_role_evidence' && check.status === 'pass'), 'saved artifact integrity report should check MCP source response requested role evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_request_upload_package_requirements' && check.status === 'pass'), 'saved artifact integrity report should check source-request upload package requirements validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_request_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check source-request semantic evidence quality validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_request_response_expected_check_ids' && check.status === 'pass'), 'saved artifact integrity report should check source-request response expected check ids validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_request_response_view_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-request response view evidence validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_request_response_semantic_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-request response semantic evidence validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_request_response_semantic_requested_role_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-request response requested role evidence validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_request_response_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check source-request response semantic evidence quality validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_demo_candidate_source_refill_package_validation' && check.status === 'pass'), 'saved artifact integrity report should check demo candidate source-refill package validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_workspace_source_refill_package_validation' && check.status === 'pass'), 'saved artifact integrity report should check workspace source-refill package validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_workspace_source_refill_package_command_validator' && check.status === 'pass'), 'saved artifact integrity report should check workspace source-refill package command validator coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_refill_manifest_build_report_schema_exists' && check.status === 'pass'), 'saved artifact integrity report should check source-refill manifest builder report schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_refill_workflow_report_schema_exists' && check.status === 'pass'), 'saved artifact integrity report should check source-refill workflow report schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_refill_workflow_report_schema_exposes_ready_status' && check.status === 'pass'), 'saved artifact integrity report should check source-refill workflow ready status schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_refill_workflow_script_registered' && check.status === 'pass'), 'saved artifact integrity report should check source-refill workflow npm script');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_refill_workflow_schema' && check.status === 'pass'), 'saved artifact integrity report should check source-refill workflow validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'readme_documents_source_refill_workflow' && check.status === 'pass'), 'saved artifact integrity report should check source-refill workflow README coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'release_work_order_schema_exposes_artifact_authoring_policy' && check.status === 'pass'), 'saved artifact integrity report should check release work-order artifact authoring policy schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_work_order_artifact_authoring_policy' && check.status === 'pass'), 'saved artifact integrity report should check release work-order artifact policy validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'release_checklist_schema_requires_vision_evidence_review' && check.status === 'pass'), 'saved artifact integrity report should check release checklist VisionEvidence required check schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_release_checklist_required_check_negative' && check.status === 'pass'), 'saved artifact integrity report should check release checklist required-check regression test');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_package_schema_exposes_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check source-package release checklist summary schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_package_schema_exposes_semantic_role_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-package semantic role evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_package_schema_exposes_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check source-package semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'source_package_schema_exposes_view_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-package view evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'upload_session_schema_exposes_source_package_semantic_role_evidence' && check.status === 'pass'), 'saved artifact integrity report should check upload-session semantic role evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'upload_session_schema_exposes_source_package_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check upload-session semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'upload_session_schema_exposes_source_package_view_evidence' && check.status === 'pass'), 'saved artifact integrity report should check upload-session view evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check MCP brief release checklist summary schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_source_package_semantic_role_evidence' && check.status === 'pass'), 'saved artifact integrity report should check MCP source-package semantic role evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_source_package_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check MCP source-package semantic evidence quality schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'mcp_brief_schema_exposes_source_package_view_evidence' && check.status === 'pass'), 'saved artifact integrity report should check MCP source-package view evidence schema');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_mcp_brief_release_checklist_summary' && check.status === 'pass'), 'saved artifact integrity report should check MCP brief release checklist summary regression test');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_package_semantic_role_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-package semantic role evidence validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_package_semantic_evidence_quality' && check.status === 'pass'), 'saved artifact integrity report should check source-package semantic evidence quality validation coverage');
  assert.ok(artifactIntegrityReport.contract_checks.some((check) => check.id === 'validate_tests_source_package_view_evidence' && check.status === 'pass'), 'saved artifact integrity report should check source-package view evidence validation coverage');
  const savedReport = JSON.parse(await fs.readFile(path.join(repoRoot, 'output', 'image-structured-modeler', 'release-gate-regression', 'release-gate-report.json'), 'utf8'));
  assertValid(validateReleaseGateReport, savedReport, 'saved image structured release gate report');
}

async function assertBuildingSingleCompileGateRegression() {
  const base = path.join(subprojectRoot, 'examples', 'building-single-anime-yellow');
  const observations = JSON.parse(await fs.readFile(path.join(base, 'observations.cropped.json'), 'utf8'));
  assertValid(validateImageSetObservation, observations, 'building-single anime observations.cropped.json');
  assert.equal(observations.object.profile, 'building_single', 'building-single sample should use the building_single profile');
  assert.deepEqual(observations.views_detected, ['oblique'], 'building-single sample should only have oblique evidence');
  assert.ok(observations.missing_views.includes('front'), 'building-single sample should require a front view before geometry promotion');
  assert.ok(observations.missing_views.includes('left'), 'building-single sample should require a side/depth view before geometry promotion');
  assert.ok(observations.missing_views.includes('top'), 'building-single sample should require a top/scale view before geometry promotion');

  const profile = await readRepoJson('examples/product-profiles/building_single_urban_oblique.json');
  const partGraph = generatePartGraphFromObservations(observations, profile, {
    id: 'building-single-anime-yellow-compile-gate-regression',
    productName: observations.object.name
  });
  assertValid(validatePartGraph, partGraph, 'building-single anime PartGraph');
  assert.equal(partGraph.operations?.length || 0, 0, 'building-single failed gate should not create SketchUp overlay operations');
  assert.equal(partGraph.parts.every((part) => part.compile?.emit === false), true, 'building-single failed gate should keep every part candidate-only');
  assert.equal(partGraph.parts.every((part) => part.candidate_shape), true, 'building-single PartGraph should keep candidate shapes as review context');
  assert.equal(partGraph.parts.some((part) => part.shape), false, 'building-single failed gate should not expose compileable shapes');
  assert.equal(partGraph.parts.some((part) => partPromotedForGeometry(part)), false, 'building-single single-oblique sample must not promote geometry');
  assert.throws(
    () => compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot }),
    /PartGraph compile blocked by geometry gate.*promoted_geometry_parts 0 is below 1/,
    'building-single low-evidence PartGraph must be blocked before SketchUp DSL compile'
  );
}

async function assertYellowAxisCalibrationWorkbench() {
  const outputDir = 'output/image-structured-modeler/yellow-axis-calibration-test';
  const result = await generateYellowAxisCalibrationWorkbench({ outputDir });
  const absoluteOutputDir = path.join(repoRoot, outputDir);

  assertValid(validateAxisCalibrationWorkbench, result.workbench, 'yellow axis calibration workbench');
  assert.equal(result.workbench.review_policy.status, 'needs_axis_review', 'yellow axis workbench should require axis review');
  assert.equal(result.workbench.review_policy.derived_drafting_allowed, false, 'yellow axis workbench must not allow derived drafting before review');
  assert.equal(result.workbench.line_candidates.every((candidate) => candidate.axis_assignment === 'axis_unknown'), true, 'yellow axis candidates must start unassigned');
  assertValid(validateDetectedStructureLines, result.detectedStructureLines, 'yellow detected structure lines');
  assert.equal(result.detectedStructureLines.qa.usable_for_axis_calibration, false, 'yellow detected structure lines should not auto-approve red/green axis calibration');
  assert.equal(result.detectedStructureLines.qa.status, 'blocked_vanishing_point_cluster_review_required', 'yellow detected VP clusters should require review before axis calibration');
  assert.ok(result.detectedStructureLines.qa.blockers.includes('accepted_vanishing_point_cluster_review_required'), 'yellow detected lines should require accepted VP cluster review');
  assert.ok(result.detectedStructureLines.line_candidates.some((line) => line.extraction_method === 'local_short_segment_hough'), 'yellow detected lines should include local short structure-line candidates');
  const maxDetectedLineLength = Math.max(...result.detectedStructureLines.line_candidates.map((line) => line.length_px));
  assert.ok(maxDetectedLineLength <= 260, 'yellow detected lines should not prefer full-image global Hough lines over local short structure lines');
  assert.ok(result.detectedStructureLines.line_candidates.length <= 18, 'yellow detected lines should expose sparse clean seeds instead of dense edge candidates');
  assert.equal(result.detectedStructureLines.perspective_hypothesis.model, 'one_finite_vp_plus_parallel_candidate', 'yellow detected lines should preserve a finite VP family plus a parallel-axis candidate instead of only one VP direction');
  assert.equal(result.detectedStructureLines.perspective_hypothesis.finite_vp_family_count, 1, 'yellow detected lines should report one finite VP family at this confidence level');
  assert.equal(result.detectedStructureLines.perspective_hypothesis.parallel_family_count, 1, 'yellow detected lines should keep a parallel family for the possible single-point axis');
  assert.ok(result.detectedStructureLines.qa.blockers.includes('perspective_model_review_required_single_point_vs_two_point'), 'yellow detected lines should require perspective-model review before axis calibration');
  assert.ok(result.detectedStructureLines.line_candidates.some((line) => line.perspective_role === 'finite_vp_family_1'), 'yellow detected lines should expose finite VP seed roles');
  assert.ok(result.detectedStructureLines.line_candidates.some((line) => line.perspective_role === 'parallel_axis_seed'), 'yellow detected lines should expose parallel-axis seed roles');
  assert.ok(result.workbench.line_candidates.some((candidate) => candidate.source_kind === 'detected_structure_line_candidate'), 'yellow axis workbench should include raster-detected line candidates');
  assert.ok(result.workbench.line_candidates.some((candidate) => candidate.id === 'candidate_corner_AB'), 'yellow axis workbench should expose AB as an unassigned candidate');
  assert.ok(result.workbench.line_candidates.some((candidate) => candidate.id === 'candidate_corner_BC'), 'yellow axis workbench should expose BC as an unassigned candidate');
  assert.ok(result.workbench.line_candidates.some((candidate) => candidate.source_family_hint === 'vertical'), 'yellow axis workbench should expose vertical candidate lines');

  assertValid(validateAxisCalibrationReviewDecision, result.pendingReview, 'yellow pending axis calibration review');
  assertValid(validateAxisCalibrationResult, result.pendingResult, 'yellow pending axis calibration result');
  assert.equal(result.pendingResult.status, 'blocked_no_accepted_axis_review', 'yellow pending axis review must block calibration');
  assert.ok(result.pendingResult.blockers.includes('accepted_axis_calibration_review_required'), 'yellow pending axis result should require accepted axis review');
  assert.equal(result.pendingResult.derived_drafting_allowed, false, 'yellow pending axis result must block derived drafting');
  assert.equal(result.pendingCalibratedViewGraph.review_policy.status, 'needs_calibrated_view_review', 'yellow pending axis result should build only a blocked calibrated-view graph');
  assertValid(validateCalibratedViewGraph, result.pendingCalibratedViewGraph, 'yellow blocked calibrated view graph from pending review');
  assert.equal(result.topologyGate.corner_chain_topology_allowed, false, 'yellow topology must be blocked before accepted axis review');
  assert.equal(result.topologyGate.plan_projection_allowed, false, 'yellow plan projection must be blocked before accepted axis review');

  assertValid(validateAxisCalibrationReviewDecision, result.previousHardcodedReview, 'yellow previous-hardcoded axis review example');
  assertValid(validateAxisCalibrationResult, result.previousHardcodedResult, 'yellow previous-hardcoded axis result');
  assert.equal(result.previousHardcodedResult.status, 'blocked_insufficient_axis_support', 'yellow previous hardcoded red/green assignment must be blocked');
  assert.ok(result.previousHardcodedResult.blockers.includes('insufficient_y_green_axis_lines'), 'yellow previous hardcoded assignment should fail because y_green has only one accepted line');
  assert.ok(result.previousHardcodedResult.blockers.includes('accepted_vanishing_point_cluster_review_required'), 'yellow previous hardcoded assignment should also fail without accepted detected VP clusters');
  const previousGreenSupport = result.previousHardcodedResult.axis_support.find((support) => support.axis === 'y_green');
  assert.equal(previousGreenSupport.line_count, 1, 'yellow previous hardcoded green axis should contain exactly one line');
  assert.equal(previousGreenSupport.required_line_count, 2, 'yellow green axis should require at least two reviewed lines');

  assertValid(validateAxisCalibrationReviewDecision, result.acceptedFixtureReview, 'yellow accepted axis calibration fixture review');
  assertValid(validateAxisCalibrationResult, result.acceptedFixtureResult, 'yellow accepted axis calibration fixture result');
  assert.equal(result.acceptedFixtureResult.status, 'blocked_insufficient_axis_support', 'yellow accepted line-count fixture should still block without accepted detected VP clusters');
  assert.equal(result.acceptedFixtureResult.derived_drafting_allowed, false, 'yellow accepted line-count fixture must not allow derived drafting without VP cluster review');
  assert.equal(result.acceptedFixtureResult.promotion_allowed, false, 'yellow accepted axis fixture must not allow PartGraph promotion');
  assert.equal(result.acceptedFixtureResult.axis_support.every((support) => support.support_ok === true), true, 'yellow accepted axis fixture should satisfy every axis support minimum');
  assert.ok(result.acceptedFixtureResult.blockers.includes('accepted_vanishing_point_cluster_review_required'), 'yellow accepted line-count fixture should expose the missing VP cluster review blocker');

  for (const relative of [
    '01-original.png',
    '02-axis-calibration-workbench-overlay.png',
    '02-axis-calibration-workbench-overlay.svg',
    '03-previous-hardcoded-axis-overlay.png',
    '03-previous-hardcoded-axis-overlay.svg',
    '04-detected-structure-lines-overlay.png',
    '04-detected-structure-lines-overlay.svg',
    'detected-structure-lines.json',
    'detected-structure-lines.md',
    'axis-calibration-workbench.json',
    'axis-calibration-workbench.md',
    'axis-calibration-review.template.json',
    'axis-calibration-review.pending.json',
    'axis-calibration-result.pending.json',
    'axis-calibration-review.previous-hardcoded-example.json',
    'axis-calibration-result.previous-hardcoded-example.json',
    'axis-calibration-review.accepted-fixture.json',
    'axis-calibration-result.accepted-fixture.json',
    'calibrated-view-graph.pending.blocked.json',
    'calibrated-view-graph.previous-hardcoded.blocked.json',
    'calibrated-view-graph.accepted-fixture.json',
    'corner-chain-topology-gate.pending.blocked.json',
    'review/index.html',
    'judgment-report.json',
    'judgment-report.md'
  ]) {
    const stat = await fs.stat(path.join(absoluteOutputDir, relative));
    assert.equal(stat.size > 0, true, `yellow axis calibration artifact ${relative} should be non-empty`);
  }
  const overlaySvg = await fs.readFile(path.join(absoluteOutputDir, '02-axis-calibration-workbench-overlay.svg'), 'utf8');
  assert.ok(overlaySvg.includes('data-layer="axis-calibration-line-candidate"'), 'yellow axis workbench overlay should expose line-candidate layers');
  assert.ok(overlaySvg.includes('axis_unknown'), 'yellow axis workbench overlay should show unknown axis state');
  const previousOverlaySvg = await fs.readFile(path.join(absoluteOutputDir, '03-previous-hardcoded-axis-overlay.svg'), 'utf8');
  assert.ok(previousOverlaySvg.includes('candidate_corner_BC') && previousOverlaySvg.includes('y_green'), 'yellow previous hardcoded overlay should expose the blocked single-line green assignment');
  const detectedOverlaySvg = await fs.readFile(path.join(absoluteOutputDir, '04-detected-structure-lines-overlay.svg'), 'utf8');
  assert.ok(detectedOverlaySvg.includes('data-layer="detected-structure-line"'), 'yellow detected structure line overlay should expose raster-detected line layers');
  assert.ok(detectedOverlaySvg.includes('blocked_vanishing_point_cluster_review_required'), 'yellow detected structure line overlay should show blocked VP review status');
  const reviewHtml = await fs.readFile(path.join(absoluteOutputDir, 'review', 'index.html'), 'utf8');
  assert.ok(reviewHtml.includes('Single-line green-axis assignments stay blocked'), 'yellow axis workbench UI should explain the single-line green-axis blocker');
  assert.ok(reviewHtml.includes('previous-hardcoded=blocked_insufficient_axis_support'), 'yellow axis workbench UI should surface the previous hardcoded blocker');
  assert.ok(reviewHtml.includes('VP clusters must come from raster-detected lines'), 'yellow axis workbench UI should explain raster-detected VP cluster evidence');
}

async function assertYellowVisibleEffectJudgment() {
  const outputDir = 'output/image-structured-modeler/yellow-visible-effect-test';
  const result = await generateYellowVisibleEffect({ outputDir });
  const absoluteOutputDir = path.join(repoRoot, outputDir);
  const report = result.report;

  assert.equal(report.kind, 'yellow_visible_effect_judgment', 'yellow visible effect should write a judgment report');
  assert.equal(report.no_review_lane.patch_status, 'blocked', 'yellow no-review lane must stay blocked');
  assert.equal(report.no_review_lane.actions, 0, 'yellow no-review lane must not create promotion actions');
  assert.equal(report.no_review_lane.false_promotion_count, 0, 'yellow no-review lane must have zero false promotions');
  assert.equal(report.no_review_lane.apply_allowed, false, 'yellow no-review lane must not be applyable');
  assert.equal(report.fail_closed_checks.no_review_patch_blocked, true, 'yellow no-review fail-closed check should pass');
  assert.equal(report.fail_closed_checks.forged_ready_without_accepted_review, true, 'yellow forged ready patch must fail closed');
  assert.match(report.fail_closed_checks.forged_ready_error, /not applyable/, 'yellow forged ready failure should fail closed before PartGraph promotion');

  assertValid(validateCandidatePromotionReview, result.acceptedReview, 'yellow accepted visible effect review');
  assertValid(validateCandidatePromotionPatch, result.acceptedPatch, 'yellow accepted visible effect patch');
  assert.equal(result.acceptedPatch.status, 'blocked', 'yellow structural projection review should keep accepted-review patch blocked');
  assert.equal(result.acceptedPatch.apply_allowed, false, 'yellow structural projection review should prevent patch application');
  assert.equal(result.acceptedPatch.actions.length, 0, 'yellow structural projection review should not promote candidates');
  assert.equal(result.acceptedReview.facade_plane_review.accepted_plane_ids.length, 0, 'yellow structural projection review should reject facade plane ids for promotion');
  assert.equal(
    result.acceptedReview.accepted_candidates.some((item) => item.role === 'shadow_or_recess_boundary'),
    false,
    'yellow accepted fixture must not promote shadow/recess boundary geometry'
  );

  assert.equal(report.perspective_critique.status, 'calibration_topology_review_accepted_promotion_blocked', 'yellow perspective critique should record accepted calibration/topology with promotion still blocked');
  assert.ok(report.perspective_critique.blockers.includes('accepted_partgraph_promotion_review_required'), 'yellow projection should require accepted PartGraph promotion review');
  assert.ok(report.perspective_critique.blockers.includes('accepted_local_detail_review_required'), 'yellow projection should require accepted local-detail review');
  assert.equal(report.perspective_critique.blockers.includes('perspective_line_fit_required'), false, 'yellow projection should no longer require missing line-fit evidence');
  assert.equal(report.perspective_critique.blockers.includes('facade_plane_perspective_unverified'), false, 'yellow projection should no longer mark facade planes as perspective-unverified');
  assert.ok(report.perspective_critique.line_fit.horizon_line_px.a[1] > 450, 'yellow line-fit horizon should not use the old high bbox placeholder');
  assert.equal(report.accepted_review_lane.ok, false, 'yellow accepted-review lane should not generate geometry without accepted structural review');
  assert.equal(report.accepted_review_lane.visible_delta, 'not_obvious', 'yellow accepted-review lane should not claim visible improvement');
  assert.equal(report.judgment.visible_delta, 'partial', 'overall yellow judgment should record review-gated drafting improvement only');
  assert.equal(report.accepted_review_lane.release_profile_compile_status.status, 'not_run', 'yellow release-grade compile should not run before accepted structural review');
  assert.equal(report.accepted_review_lane.release_profile_compile_status.reason, 'calibration_topology_review_accepted_promotion_blocked', 'yellow blocked compile reason should reflect calibration/topology promotion gate');
  assert.ok(report.artifact_links.sketchup_mock_preview_png.endsWith('07-sketchup-mock-preview.png'), 'yellow report should link mock preview image');
  assert.equal(report.artifact_links.review_decision.endsWith('candidate-promotion-review.calibration-topology-promotion-blocked.yellow.json'), true, 'yellow blocked review file should name calibration/topology gate');
  assert.equal(report.artifact_links.promotion_patch.endsWith('candidate-promotion-patch.calibration-topology-promotion-blocked.yellow.json'), true, 'yellow blocked patch file should name calibration/topology gate');
  assert.equal(report.structural_projection.status, 'projection_review_ready', 'yellow structural projection should be review-ready');
  assert.ok(report.structural_projection.support_score > 0.6, 'yellow structural projection should carry meaningful line support');
  assert.ok(Math.abs(report.structural_projection.primary_plane_quad_px[0][0] - 444) < 8, 'yellow primary facade left roof corner should align with corrected structural line');
  assert.ok(Math.abs(report.structural_projection.primary_plane_quad_px[1][0] - 757) < 10, 'yellow primary facade right roof corner should align with corrected structural line');
  assert.ok(Math.abs(report.structural_projection.side_plane_quad_px[0][0] - 289) < 10, 'yellow side plane left roof corner should align with corrected structural line');
  assert.ok(Math.abs(report.structural_projection.plan_projection.depth_to_width_ratio - 0.487) < 0.02, 'yellow plan projection should preserve the visible depth-to-width ratio');
  assert.equal(report.structural_projection.plan_projection.footprint_topology, 'left_front_recess_notch', 'yellow plan projection should preserve the accepted left-front recess notch topology');
  assert.equal(report.structural_projection.plan_projection.front_edge_policy, 'main_front_edge_CD_with_left_recess_AB_behind', 'yellow plan projection must keep A-B behind the C-D main front edge');
  assert.equal(report.structural_projection.plan_projection.footprint_local.length >= 6, true, 'yellow stepped plan should use more than four footprint points');
  assert.ok(report.structural_projection.plan_projection.depth_order.some((order) => order.behind === 'AB' && order.in_front === 'CD'), 'yellow plan projection should record A-B behind C-D');
  const footprintById = new Map(report.structural_projection.plan_projection.footprint_local.map((point) => [point.id, point]));
  assert.ok(footprintById.get('A_recessed_left_front')?.xy?.[1] > 0, 'yellow A corner should be set back from the main front edge');
  assert.equal(footprintById.get('C_main_front_return_corner')?.xy?.[1], 0, 'yellow C corner should sit on the main front edge');
  assert.equal(footprintById.get('D_main_front_right_corner')?.xy?.[1], 0, 'yellow D corner should sit on the main front edge');
  const yellowFrontRecess = report.structural_projection.plan_projection.recesses?.find((recess) => recess.id === 'yellow_left_front_recess_notch');
  assert.ok(yellowFrontRecess, 'yellow plan projection should include the accepted left-front recess notch');
  assert.equal(yellowFrontRecess.recessed_edge_id, 'AB', 'yellow recess should bind A-B as the recessed edge');
  assert.equal(yellowFrontRecess.return_edge_id, 'BC', 'yellow recess should bind B-C as the return/depth edge');
  assert.equal(yellowFrontRecess.main_front_edge_id, 'CD', 'yellow recess should bind C-D as the main front edge');
  assert.ok(yellowFrontRecess.depth_to_width_ratio > 0.05, 'yellow front recess should carry a non-zero relative depth');
  assert.equal(yellowFrontRecess.promotion_allowed, false, 'yellow front recess must remain promotion-blocked until accepted promotion review');
  assert.equal(result.mockSummary.ok, false, 'yellow mock SketchUp summary should be blocked');
  assert.equal(result.mockSummary.status, 'blocked_calibration_topology_review_accepted_promotion_blocked', 'yellow mock SketchUp summary should name the calibration/topology promotion gate');
  assert.equal(result.mockSummary.operation_counts.box || 0, 0, 'yellow blocked preview should not contain box primitives');
  assert.equal(result.mockSummary.snapshot_summary.totals.groups, 0, 'yellow blocked mock snapshot should contain no groups');

  const genericProjection = await buildBuildingSingleStructuralProjection({
    sourceImagePath: path.join(repoRoot, 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png'),
    sourceImage: 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png',
    targetWidth: 900,
    targetHeight: 589,
    config: {
      ...YELLOW_BUILDING_STRUCTURAL_PROJECTION_CONFIG,
      kind: BUILDING_SINGLE_STRUCTURAL_PROJECTION_KIND,
      graph_attachment_key: 'building_single_structural_projection_v1',
      graph_attachment_source: 'building-single-structural-projection.json',
      line_evidence_source_stage: 'building_single_structural_projection_line_fit',
      plane_evidence_source_stage: 'building_single_structural_projection_line_intersections'
    }
  });
  assert.equal(genericProjection.kind, BUILDING_SINGLE_STRUCTURAL_PROJECTION_KIND, 'building_single structural projection should be available through a generic builder');
  assert.equal(genericProjection.line_evidence_source_stage, 'building_single_structural_projection_line_fit', 'generic builder should not be locked to yellow source stage');
  assert.ok(Math.abs(genericProjection.planes[0].visible_quad_px[0][0] - report.structural_projection.primary_plane_quad_px[0][0]) < 0.01, 'generic builder should reproduce the yellow structural projection when given the yellow config');
  assert.equal(genericProjection.plan_projection.footprint_topology, 'left_front_recess_notch', 'generic builder should preserve accepted left-front recess topology when configured');

  const dsl = JSON.parse(await fs.readFile(path.join(absoluteOutputDir, '06-sketchup-dsl.preview.json'), 'utf8'));
  assert.equal((dsl.operations || []).length, 0, 'yellow blocked preview DSL should contain no SketchUp operations');
  const structureGraph = JSON.parse(await fs.readFile(path.join(absoluteOutputDir, 'intake', 'structure-evidence-graph.json'), 'utf8'));
  assertValid(validateStructureEvidenceGraph, structureGraph, 'yellow structure evidence graph with structural projection');
  assert.ok(structureGraph.edge_evidence.some((edge) => edge.source_stage === 'yellow_structural_projection_line_fit'), 'yellow structure graph should include line-fit structural edges');
  assert.ok(structureGraph.view_axis_hypotheses.some((axis) => axis.axis_fit_source === 'yellow_structural_projection_line_fit'), 'yellow view axis should use line-fit structural projection');
  const facadeGraph = JSON.parse(await fs.readFile(path.join(absoluteOutputDir, 'intake', 'facade-plane-graph.json'), 'utf8'));
  assert.equal(facadeGraph.planes.every((plane) => plane.orientation_hint.projection_model === 'line_fit_perspective_projection'), true, 'yellow facade graph should use corrected line-fit plane projections');

  const calibratedGraph = JSON.parse(await fs.readFile(path.join(absoluteOutputDir, 'yellow-calibrated-view-graph.json'), 'utf8'));
  assertValid(validateCalibratedViewGraph, calibratedGraph, 'yellow calibrated view graph');
  assert.equal(calibratedGraph.projection_model, 'two_point_vertical_parallel', 'yellow calibrated graph should record two-point perspective with verticals treated as parallel');
  assert.ok(calibratedGraph.axis_families.some((axis) => axis.axis === 'x_red' && axis.image_line_ids.includes('AB') && axis.image_line_ids.includes('CD')), 'yellow red axis should bind A-B and C-D');
  assert.ok(calibratedGraph.axis_families.some((axis) => axis.axis === 'y_green' && axis.image_line_ids.includes('BC')), 'yellow green axis should bind B-C');
  assert.ok(calibratedGraph.axis_families.some((axis) => axis.axis === 'z_blue' && axis.vanishing_type === 'infinite'), 'yellow blue axis should allow vertical-parallel shift/rectified imagery');
  const calibratedReview = JSON.parse(await fs.readFile(path.join(absoluteOutputDir, 'yellow-calibrated-view-review.accepted.json'), 'utf8'));
  assertValid(validateCalibratedViewReviewDecision, calibratedReview, 'yellow accepted calibrated-view review decision');
  assert.equal(calibratedReview.status, 'accepted_for_derived_drafting', 'yellow calibrated-view review should be accepted only for derived drafting');
  assert.equal(calibratedReview.promotion_allowed, false, 'yellow calibrated-view review must not allow geometry promotion');
  const topologyGraph = JSON.parse(await fs.readFile(path.join(absoluteOutputDir, 'yellow-corner-chain-topology.json'), 'utf8'));
  assertValid(validateCornerChainTopology, topologyGraph, 'yellow corner-chain topology graph');
  assert.equal(topologyGraph.summary.accepted_topology_id, 'yellow_left_front_recess_notch_topology', 'yellow topology graph should expose the accepted left-front notch hypothesis');
  const acceptedTopology = topologyGraph.topology_hypotheses.find((hypothesis) => hypothesis.id === topologyGraph.summary.accepted_topology_id);
  assert.equal(acceptedTopology.topology, 'left_front_recess_notch', 'yellow accepted topology should be a left-front recess notch');
  assert.ok(acceptedTopology.depth_order.some((order) => order.behind === 'AB' && order.in_front === 'CD'), 'yellow accepted topology should record A-B behind C-D');
  const topologyReview = JSON.parse(await fs.readFile(path.join(absoluteOutputDir, 'yellow-corner-chain-topology-review.accepted.json'), 'utf8'));
  assertValid(validateCornerChainTopologyReviewDecision, topologyReview, 'yellow accepted corner-chain topology review decision');
  assert.equal(topologyReview.status, 'accepted_for_derived_drafting', 'yellow topology review should be accepted only for derived drafting');
  assert.equal(topologyReview.promotion_allowed, false, 'yellow topology review must not allow geometry promotion');
  const mcpBriefMarkdown = await fs.readFile(path.join(absoluteOutputDir, 'intake', 'mcp-modeling-brief.md'), 'utf8');
  const calibratedIndex = mcpBriefMarkdown.indexOf('## Calibrated View Graph');
  const topologyIndex = mcpBriefMarkdown.indexOf('## Corner Chain Topology');
  const draftIndex = mcpBriefMarkdown.indexOf('## Draft View Graph');
  assert.ok(calibratedIndex !== -1 && topologyIndex > calibratedIndex && draftIndex > topologyIndex, 'yellow MCP brief should describe calibrated view, corner topology, then draft view');

  const structureSvg = await fs.readFile(path.join(absoluteOutputDir, '02-structure-overlay.svg'), 'utf8');
  const calibratedSvg = await fs.readFile(path.join(absoluteOutputDir, '02c-calibrated-view-overlay.svg'), 'utf8');
  const topologySvg = await fs.readFile(path.join(absoluteOutputDir, '02d-corner-chain-topology-overlay.svg'), 'utf8');
  const draftSvg = await fs.readFile(path.join(absoluteOutputDir, '03-draft-view-graph.svg'), 'utf8');
  const planeSvg = await fs.readFile(path.join(absoluteOutputDir, '04-plane-review-overlay.svg'), 'utf8');
  assert.ok(structureSvg.includes('data-layer="edge-evidence"'), 'yellow structure overlay should expose edge evidence layer');
  assert.ok(structureSvg.includes('data-layer="corner-evidence"'), 'yellow structure overlay should expose corner evidence layer');
  assert.ok(structureSvg.includes('data-layer="plane-hypothesis"'), 'yellow structure overlay should expose plane hypothesis layer');
  assert.ok(calibratedSvg.includes('data-layer="calibrated-axis-line"'), 'yellow calibrated overlay should expose calibrated axis lines');
  assert.ok(calibratedSvg.includes('two_point_vertical_parallel'), 'yellow calibrated overlay should name the calibrated projection model');
  assert.ok(topologySvg.includes('data-layer="calibrated-axis-line"'), 'yellow topology overlay should expose calibrated corner-chain edges');
  assert.ok(topologySvg.includes('data-layer="corner-chain-point"'), 'yellow topology overlay should expose corner-chain points');
  assert.ok(topologySvg.includes('left_front_recess_notch'), 'yellow topology overlay should name the accepted notch topology');
  assert.ok(draftSvg.includes('data-layer="draft-view-front"'), 'yellow draft overlay should expose front draft-view layer');
  assert.ok(planeSvg.includes('data-layer="facade-plane"'), 'yellow plane overlay should expose facade plane layer');
  assert.ok(planeSvg.includes('data-layer="plane-local-detail"'), 'yellow plane overlay should expose plane-local detail layer');
  for (const relative of [
    '01-original.png',
    '02-structure-overlay.png',
    '02b-structural-projection-overlay.png',
    '02c-calibrated-view-overlay.png',
    '02c-calibrated-view-overlay.svg',
    '02d-corner-chain-topology-overlay.png',
    '02d-corner-chain-topology-overlay.svg',
    '03-draft-view-graph.png',
    '03b-facade-projection.png',
    '03c-plan-projection.png',
    '04-plane-review-overlay.png',
    '05-partgraph-preview.json',
    '06-sketchup-dsl.preview.json',
    '07-sketchup-mock-preview.png',
    '07-sketchup-mock-preview.svg',
    '07-sketchup-mock-summary.json',
    'yellow-calibrated-view-graph.json',
    'yellow-calibrated-view-graph.md',
    'yellow-calibrated-view-review.accepted.json',
    'yellow-corner-chain-topology.json',
    'yellow-corner-chain-topology.md',
    'yellow-corner-chain-topology-review.accepted.json',
    'yellow-structural-projection.json',
    'yellow-structural-methodology.md',
    'perspective-critique-report.json',
    'perspective-critique-report.md',
    'intake/calibrated-view-graph.json',
    'intake/calibrated-view-graph.md',
    'intake/calibrated-view-review.accepted.json',
    'intake/corner-chain-topology.json',
    'intake/corner-chain-topology.md',
    'intake/corner-chain-topology-review.accepted.json',
    'comparison/index.html',
    'judgment-report.json'
  ]) {
    const stat = await fs.stat(path.join(absoluteOutputDir, relative));
    assert.equal(stat.size > 0, true, `yellow visible effect artifact ${relative} should be non-empty`);
  }
  const comparisonHtml = await fs.readFile(path.join(absoluteOutputDir, 'comparison', 'index.html'), 'utf8');
  assert.ok(comparisonHtml.includes('Original + Structure Evidence'), 'yellow comparison should show original/evidence panel');
  assert.ok(comparisonHtml.includes('Line-fit Projection'), 'yellow comparison should show structural projection panel');
  assert.ok(comparisonHtml.includes('Calibration + Corner Chain'), 'yellow comparison should show calibration/topology panel');
  assert.ok(comparisonHtml.includes('yellow-calibrated-view-graph.json'), 'yellow comparison should link calibrated view graph');
  assert.ok(comparisonHtml.includes('yellow-corner-chain-topology.json'), 'yellow comparison should link corner-chain topology');
  assert.ok(comparisonHtml.includes('left_front_recess_notch'), 'yellow comparison should surface the accepted topology');
  assert.ok(comparisonHtml.includes('Facade + Plan Projection'), 'yellow comparison should show facade and plan projection panel');
  assert.ok(comparisonHtml.includes('partial'), 'yellow comparison should surface the partial drafting-visible delta');
  assert.ok(comparisonHtml.includes('Drafting-first Review Layer'), 'yellow comparison should show Drafting-first review panel');
  assert.ok(comparisonHtml.includes('Accepted Review SketchUp Preview'), 'yellow comparison should keep the SketchUp preview slot');
  assert.ok(comparisonHtml.includes('07-sketchup-mock-preview.png'), 'yellow comparison should render the mock SketchUp preview image');
  assert.ok(comparisonHtml.includes('SketchUp preview blocked'), 'yellow comparison should show blocked preview state');
}

async function assertCompactRemoteSample() {
  const base = path.join(subprojectRoot, 'examples', 'compact-remote');
  const observations = JSON.parse(await fs.readFile(path.join(base, 'observations.json'), 'utf8'));
  assertValid(validateImageSetObservation, observations, 'compact remote observations.json');
  assert.equal(observations.object.profile, 'compact_remote', 'compact remote observations should declare object profile');
  assert.ok(observations.evidence_graph, 'compact remote observations should contain native evidence graph');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'remote_body').required_views, ['front', 'right'], 'compact remote observations graph should record body front/right requirements');
  for (const observation of observations.images) {
    assertValid(validateImageObservation, stripCollectionOnlyFields(observation), `${observation.image.path} image observation`);
  }

  const manualCorrections = JSON.parse(await fs.readFile(path.join(base, 'manual-corrections.json'), 'utf8'));
  assertValid(validateManualCorrections, manualCorrections, 'compact remote manual-corrections.json');
  assert.equal(manualCorrections.object_profile, 'compact_remote', 'compact remote manual corrections should lock object profile');

  const modelPlan = JSON.parse(await fs.readFile(path.join(base, 'model-plan.json'), 'utf8'));
  assertValid(validateModelPlan, modelPlan, 'compact remote model-plan.json');
  assert.equal(modelPlan.object.profile, 'compact_remote', 'compact remote model plan should not use switch_controller profile');
  assertEvidenceAnnotations(modelPlan, 'compact remote model-plan.json');
  assert.ok(modelPlan.review.corrections_applied.includes('object.profile'), 'compact remote model plan should record profile correction');
  assert.ok(modelPlan.review.corrections_applied.includes('update:primary_button_cluster'), 'compact remote model plan should record button cluster correction');
  assert.equal(partById(modelPlan, 'primary_button_cluster').evidence_status, 'manual_confirmed', 'compact remote corrected button cluster should be manually confirmed');
  assert.equal(graphPartById(modelPlan, 'primary_button_cluster').manual_confirmed, true, 'compact remote evidence graph should carry manual confirmation');
  assert.equal(partById(modelPlan, 'speaker_grille').feature_mapping.operation, 'cut_recess', 'compact remote grille should map blind_recess to cut_recess');
  assert.equal(partById(modelPlan, 'speaker_grille').feature_mapping.fallback, 'none', 'compact remote grille should not fall back to a visual slot marker');
  assert.equal(graphPartById(modelPlan, 'speaker_grille').conflicts.some((conflict) => conflict.type === 'feature_mapping_fallback'), false, 'compact remote graph should not mark grille as fallback after real cut_recess mapping');
  assert.ok(graphPartById(modelPlan, 'brand_label').conflicts.some((conflict) => conflict.type === 'feature_mapping_fallback'), 'compact remote graph should still expose decal/text visual fallback');
  assert.notEqual(fusionPartById(modelPlan, 'speaker_grille').status, 'needs_review', 'compact remote grille semantic fusion should pass review gate after real cut_recess mapping');
  assert.equal(fusionPartById(modelPlan, 'speaker_grille').decision, 'single_view_confirmed', 'compact remote grille semantic fusion should rely on front-view grille evidence');
  assert.equal(fusionPartById(modelPlan, 'brand_label').decision, 'feature_fallback', 'compact remote brand label semantic fusion should expose visual fallback');
  assert.ok(modelPlan.review.correction_suggestions.some((suggestion) => suggestion.part_id === 'brand_label'), 'compact remote should suggest a correction patch for fallback brand label');
  assert.equal(partById(modelPlan, 'primary_button_cluster').parameters.buttons.length, 5, 'compact remote should keep corrected five-button cluster');

  const output = JSON.parse(await fs.readFile(path.join(base, 'output.json'), 'utf8'));
  assert.equal(output.version, 1, 'compact remote compiled output should be DSL version 1');
  assert.equal(output.units, 'mm', 'compact remote compiled output should use mm');
  assert.equal(output.operations.some((operation) => operation.op === 'box'), false, 'compact remote output should not regress to coarse box primitives');
  assert.equal(output.operations.some((operation) => operation.op === 'mesh'), false, 'compact remote output should not expose raw mesh primitives');
  assert.ok(output.operations.some((operation) => operation.op === 'rounded_box'), 'compact remote output should use rounded body primitives');
  assert.ok(output.operations.some((operation) => operation.op === 'add_boss'), 'compact remote output should compile convex buttons as real add_boss features');
  assert.ok(output.operations.some((operation) => operation.op === 'add_raised_rib'), 'compact remote output should compile rocker as real add_raised_rib feature');
  assert.ok(output.operations.some((operation) => operation.op === 'cut_recess'), 'compact remote output should compile grille slots as real cut_recess features');
  assert.equal(output.operations.some((operation) => operation.op === 'slot_array'), false, 'compact remote output should not use visual slot_array fallback for the grille');
  assert.ok(output.operations.some((operation) => operation.op === 'text_3d'), 'compact remote output should compile brand label text');

  const mockSessionPath = path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-remote-mock-session.json');
  await fs.mkdir(path.dirname(mockSessionPath), { recursive: true });
  const bridge = new SketchUpBridge({ mock: { sessionPath: mockSessionPath } });
  const result = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(output) });
  assert.equal(result.snapshot.totals.groups, REMOTE_BASELINE_GROUPS, 'compact remote mock snapshot should keep current group count');
  assert.equal(result.snapshot.totals.instances, REMOTE_BASELINE_INSTANCES, 'compact remote mock snapshot should keep current instance count');
  assert.equal(result.snapshot.scenes.length, REMOTE_BASELINE_SCENES, 'compact remote mock snapshot should keep current scene count');
  assert.equal(result.snapshot.warning_summary.by_severity.error, 0, 'compact remote mock build should not create error warnings');
  assertBoundingBoxSize(result.snapshot.bounding_box, { w: 44, d: 158, h: 16.6 }, 'compact remote mock bbox', 0.2);

  const reviewHtml = await fs.readFile(path.join(base, 'review', 'index.html'), 'utf8');
  assert.ok(reviewHtml.includes('Compact Media Remote'), 'compact remote review report should use sample name');
  assert.ok(reviewHtml.includes('Manual Corrections'), 'compact remote review report should include corrections');
  assert.ok(reviewHtml.includes('Evidence Status'), 'compact remote review report should include evidence status');
  assert.ok(reviewHtml.includes('Evidence Graph'), 'compact remote review report should include evidence graph');
  assert.ok(reviewHtml.includes('Semantic Fusion'), 'compact remote review report should include semantic fusion');
  assert.ok(reviewHtml.includes('Corrections Workbench'), 'compact remote review report should include corrections workbench');
  assert.ok(reviewHtml.includes('Correction Patch Suggestions'), 'compact remote review report should include correction patch suggestions');
  assert.ok(reviewHtml.includes('real feature op: cut_recess'), 'compact remote review report should show real cut_recess mapping');
  assert.ok(reviewHtml.includes('fallback: visual_marker'), 'compact remote review report should show visual fallback mappings');

  const snapshotReport = JSON.parse(await fs.readFile(path.join(base, 'review', 'snapshot-report.json'), 'utf8'));
  assert.equal(snapshotReport.runtime, 'mock', 'compact remote snapshot report should record mock runtime');
  assert.equal(snapshotReport.snapshot_summary.totals.groups, REMOTE_BASELINE_GROUPS, 'compact remote snapshot report should record current group count');
  assertBudget(evaluateSnapshotWarningBudget(snapshotReport, remoteWarningBudget), 'compact remote mock snapshot warning budget');

  const queueSnapshotPath = path.join(base, 'review', 'snapshot-report-queue.json');
  try {
    const queueSnapshotReport = JSON.parse(await fs.readFile(queueSnapshotPath, 'utf8'));
    assert.equal(queueSnapshotReport.runtime, 'queue', 'compact remote queue snapshot report should record queue runtime');
    assertBudget(evaluateSnapshotWarningBudget(queueSnapshotReport, remoteWarningBudget), 'compact remote queue snapshot warning budget');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return true;
}

async function assertAmbulancePartGraphEvidenceSample() {
  const base = path.join(subprojectRoot, 'examples', 'ambulance');
  const observations = JSON.parse(await fs.readFile(path.join(base, 'observations.json'), 'utf8'));
  assertValid(validateImageSetObservation, observations, 'ambulance observations.json');
  assert.equal(observations.object.profile, 'vehicle_ambulance', 'ambulance observations should lock vehicle_ambulance profile');
  assert.ok(observations.scale_calibration, 'ambulance observations should include scale calibration');
  assert.ok(observations.scale_calibration.confidence >= 0.7, 'ambulance scale calibration should be high enough for profile-backed R4 evidence');
  assert.ok(observations.scale_calibration.measurements.length >= 3, 'ambulance scale calibration should use multiple view measurements');
  assert.ok(observations.evidence_graph.part_matches.length >= 8, 'ambulance observations should expose cross-view part matches');
  assert.ok(observations.evidence_graph.scale_calibration, 'ambulance evidence graph should carry scale calibration');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'amb-main-body').missing_views, [], 'ambulance body should have required left/top/rear evidence');
  assert.ok(observations.images.every((image) => image.orientation_hints?.coordinate_convention === 'image_x_right_y_down'), 'ambulance observations should record image-space orientation convention');
  const sideObservation = observations.images.find((image) => image.detected_view.kind === 'left' || image.detected_view.kind === 'right');
  assert.ok(sideObservation, 'ambulance observations should include a side view for handedness review');
  assert.ok(sideObservation.orientation_hints.semantic_anchors.some((anchor) => anchor.id === 'side-front-wheel-before-rear-wheel'), 'side observation should retain a front/rear wheel mirror cue');
  assert.ok(sideObservation.orientation_hints.semantic_anchors.some((anchor) => anchor.id === 'side-cab-before-main-body'), 'side observation should retain a cab/body mirror cue');
  assert.equal(sideObservation.orientation_hints.review_required, false, 'side observation should have enough semantic anchors to avoid automatic mirror-risk review');
  assert.ok(observations.images.some((image) => image.orientation_hints.review_required), 'ambiguous non-side views should still be marked for mirror-risk review');
  const observationKinds = observations.images.flatMap((image) => image.observations || []).map((item) => item.kind);
  assert.ok(observationKinds.includes('silhouette'), 'ambulance observations should include contour/polyline silhouette evidence');
  assert.ok(observationKinds.includes('keypoint'), 'ambulance observations should include keypoint candidates');

  const partGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.generated.json'), 'utf8'));
  assertValid(validatePartGraph, partGraph, 'ambulance part-graph.generated.json');
  assert.equal(partGraph.profile_id, 'vehicle_ambulance', 'generated ambulance PartGraph should keep profile id');
  assert.equal(partGraph.evidence_graph.parts.length, partGraph.parts.length, 'generated PartGraph evidence graph should cover every part');
  assert.ok(partGraph.evidence_graph.part_matches.length >= partGraph.parts.length, 'generated PartGraph should record part matching for every part');
  assert.ok(partGraph.scale.calibration, 'generated PartGraph scale should retain calibration provenance');
  assert.ok(partGraph.review.correction_targets.length > 0, 'generated PartGraph should produce review correction targets for incomplete evidence');

  const mainBody = partGraphPartById(partGraph, 'amb-main-body');
  assert.equal(mainBody.evidence_status, 'observed', 'generated ambulance body should be observed from image evidence');
  assert.ok(mainBody.evidence_sources.some((source) => source.kind === 'silhouette'), 'generated ambulance body should carry contour evidence');
  assert.ok(mainBody.evidence_sources.some((source) => source.kind === 'keypoint'), 'generated ambulance body should carry keypoint evidence');
  assert.equal(partGraphPartById(partGraph, 'amb-left-driver-window').evidence_status, 'needs_review', 'low-confidence related evidence should stay review-gated');
  const statusCounts = countBy(partGraph.parts, 'evidence_status');
  assert.equal(statusCounts.profile_default || 0, 0, 'generated PartGraph should not leave unmatched parts as profile_default evidence');
  assert.ok((statusCounts.inferred || 0) >= 30, 'generated PartGraph should propagate cross-view inferred evidence across seed parts');
  assert.ok((statusCounts.needs_review || 0) <= 5, 'generated PartGraph should keep review-gated evidence below the R4 threshold');

  const profile = JSON.parse(await fs.readFile(path.join(repoRoot, 'examples/product-profiles/vehicle_ambulance.json'), 'utf8'));
  const document = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  assert.equal(document.metadata.source, 'part_graph_compiler', 'generated PartGraph should compile through the normal PartGraph compiler');
  assert.equal(document.operations.length, 104, 'generated PartGraph should preserve the current ambulance compiler operation count');
  assert.ok(document.operations.some((operation) => operation.qa?.generated_from_image_evidence === true), 'compiled DSL should preserve image evidence QA metadata');

  const generatedOutput = JSON.parse(await fs.readFile(path.join(base, 'output.generated.json'), 'utf8'));
  assert.equal(generatedOutput.operations.length, document.operations.length, 'generated ambulance DSL artifact should match current compiler output');
  const generatedQaReport = JSON.parse(await fs.readFile(path.join(base, 'reference-visual-qa', 'ambulance-generated', 'report.json'), 'utf8'));
  assert.equal(generatedQaReport.ok, true, 'generated ambulance PartGraph should pass reference visual QA');
  assert.equal(generatedQaReport.summary.total, 0, 'generated ambulance reference visual QA should have no issues');

  const correctionPatch = JSON.parse(await fs.readFile(path.join(base, 'correction-patch.reference-visual.json'), 'utf8'));
  assertValid(validatePartGraphCorrectionPatch, correctionPatch, 'ambulance correction-patch.reference-visual.json');
  assert.equal(correctionPatch.edits.length, 0, 'passing reference visual QA should emit an empty correction patch');
  const correctedPartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.corrected.json'), 'utf8'));
  assertValid(validatePartGraph, correctedPartGraph, 'ambulance part-graph.corrected.json');
  assert.equal(correctedPartGraph.parts.length, partGraph.parts.length, 'corrected PartGraph should preserve part count when no patch edits are needed');

  const qualityReport = JSON.parse(await fs.readFile(path.join(base, 'quality-report.json'), 'utf8'));
  assert.equal(qualityReport.ok, true, 'ambulance PartGraph quality gate should pass');
  assert.equal(qualityReport.summary.profile_default_ratio, 0, 'quality gate should reject profile-default-only generated parts');
  assert.ok(qualityReport.summary.needs_review_ratio <= 0.12, 'quality gate should keep review-gated part ratio below threshold');
  assert.ok(qualityReport.summary.parameter_proposals >= 40, 'quality gate should report parameter proposal coverage for proposal-capable parts');
  assert.ok(qualityReport.summary.parameter_proposal_parts >= 15, 'quality gate should count parts with parameter proposals');

  const skeletonPartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.skeleton.json'), 'utf8'));
  assertValid(validatePartGraph, skeletonPartGraph, 'ambulance part-graph.skeleton.json');
  assert.equal(skeletonPartGraph.parts.length, profile.required_parts.length, 'no-seed skeleton PartGraph should contain profile-required parts only');
  assert.ok(skeletonPartGraph.parts.every((part) => part.compile?.emit === false), 'no-seed skeleton parts should be candidate-only');
  assert.ok(skeletonPartGraph.parts.every((part) => part.candidate_shape), 'no-seed skeleton should keep candidate_shape review context');
  assert.equal(skeletonPartGraph.parts.some((part) => part.shape), false, 'no-seed skeleton should not expose compileable shape before proposal review');
  assert.throws(
    () => compilePartGraphToSketchUpDsl(skeletonPartGraph, profile, { repoRoot }),
    /PartGraph compile blocked by geometry gate.*promoted_geometry_parts 0 is below 1/,
    'no-seed skeleton PartGraph must be blocked before any proposal is accepted'
  );
  const skeletonStatuses = countBy(skeletonPartGraph.parts, 'evidence_status');
  assert.equal(skeletonStatuses.profile_default || 0, 0, 'no-seed skeleton should still attach image-derived or inferred evidence to profile-required parts');
  assert.ok((skeletonStatuses.needs_review || 0) >= 5, 'no-seed skeleton should keep inferred-only profile roles review-gated');
  assert.ok(skeletonPartGraph.parts.filter((part) => part.evidence_sources?.some((source) => source.status === 'inferred')).length >= 5, 'no-seed skeleton should carry partial image evidence across required profile roles');
  assert.ok(skeletonPartGraph.review.parameter_proposals.length >= skeletonPartGraph.parts.length * 2, 'no-seed skeleton should surface reviewable parameter proposals');
  assert.equal(skeletonPartGraph.review.parameter_proposal_summary.parts_with_proposals, skeletonPartGraph.parts.length, 'no-seed skeleton should propose parameters for every required role');
  assert.equal(skeletonPartGraph.review.parameter_proposal_summary.review_required, skeletonPartGraph.review.parameter_proposals.length, 'no-seed parameter proposals should stay review-gated');
  assert.ok(skeletonPartGraph.review.correction_targets.some((target) => target.path === 'parts[main_body].parameter_proposals'), 'no-seed skeleton should expose parameter proposals as correction targets');
  const skeletonBody = partGraphPartById(skeletonPartGraph, 'main_body');
  assert.ok(skeletonBody.parameter_proposals.some((proposal) => proposal.parameter === 'shape.parameters'), 'no-seed body should propose shape parameters');
  const bodyShapeProposal = skeletonBody.parameter_proposals.find((proposal) => proposal.parameter === 'shape.parameters');
  assert.equal(bodyShapeProposal.status, 'needs_review', 'no-seed body shape proposal should require review');
  assert.ok(bodyShapeProposal.basis.includes('image_scale_calibration'), 'no-seed body shape proposal should cite image scale calibration');
  assert.ok(bodyShapeProposal.image_measurements.length > 0, 'no-seed body shape proposal should retain supporting image measurements');
  assert.ok(bodyShapeProposal.proposed_value.size[0] > skeletonBody.candidate_shape.parameters.size[0], 'no-seed body proposal should be a usable scale-based candidate, not the tiny skeleton placeholder');

  const proposalReview = JSON.parse(await fs.readFile(path.join(base, 'parameter-proposal-review.accepted.json'), 'utf8'));
  const proposalPatch = JSON.parse(await fs.readFile(path.join(base, 'correction-patch.parameter-proposals.json'), 'utf8'));
  assertValid(validatePartGraphCorrectionPatch, proposalPatch, 'ambulance correction-patch.parameter-proposals.json');
  assert.equal(proposalPatch.source, 'parameter_proposal_review', 'proposal patch should record parameter proposal source');
  assert.equal(proposalPatch.edits.length, proposalReview.accepted_proposals.length, 'proposal patch should include one edit per accepted proposal');
  assert.ok(proposalPatch.edits.every((edit) => edit.action === 'set'), 'accepted proposal patch should contain set edits');
  assert.ok(proposalPatch.edits.every((edit) => edit.mark_evidence_status === 'manual_confirmed'), 'accepted proposals should mark applied parts manually confirmed');
  const builtProposalPatch = buildCorrectionPatchFromParameterProposals(skeletonPartGraph, proposalReview);
  assert.deepEqual(builtProposalPatch.edits.map((edit) => [edit.part_id, edit.path]), proposalPatch.edits.map((edit) => [edit.part_id, edit.path]), 'proposal patch builder should match the artifact edit targets');
  const proposalAppliedPartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.proposal-applied.json'), 'utf8'));
  assertValid(validatePartGraph, proposalAppliedPartGraph, 'ambulance part-graph.proposal-applied.json');
  assert.equal(partGraphPartById(proposalAppliedPartGraph, 'main_body').evidence_status, 'manual_confirmed', 'accepted proposal should mark main body as manually confirmed');
  assert.equal(partGraphPartById(proposalAppliedPartGraph, 'cab').evidence_status, 'manual_confirmed', 'accepted proposal should mark cab as manually confirmed');
  assert.equal(partGraphPartById(proposalAppliedPartGraph, 'main_body').compile.emit, true, 'accepted proposal should promote main body for compile');
  assert.equal(partGraphPartById(proposalAppliedPartGraph, 'main_body').promoted_geometry, true, 'accepted proposal should mark promoted geometry');
  assert.equal(partGraphPartById(proposalAppliedPartGraph, 'main_body').qa.promoted_geometry, true, 'accepted proposal should update promoted-geometry QA');
  assert.ok(partGraphPartById(proposalAppliedPartGraph, 'main_body').shape, 'accepted proposal should restore a compileable shape');
  assert.equal(partGraphPartById(proposalAppliedPartGraph, 'main_body').shape.parameters.size[0], bodyShapeProposal.proposed_value.size[0], 'accepted proposal should apply body shape parameters');
  assert.ok(partGraphPartById(proposalAppliedPartGraph, 'main_body').qa.parameter_proposal_applied, 'applied proposal should mark QA metadata');
  assert.ok(partGraphPartById(proposalAppliedPartGraph, 'main_body').evidence_sources.some((source) => source.kind === 'parameter_proposal_review'), 'applied proposal should append proposal review evidence');
  const proposalAppliedDocument = compilePartGraphToSketchUpDsl(proposalAppliedPartGraph, profile, { repoRoot });
  const proposalAppliedOutput = JSON.parse(await fs.readFile(path.join(base, 'output.proposal-applied.json'), 'utf8'));
  assert.deepEqual(proposalAppliedOutput, proposalAppliedDocument, 'proposal-applied ambulance DSL artifact should match current compiler output');
  const proposalReviewHtml = await fs.readFile(path.join(base, 'proposal-review', 'index.html'), 'utf8');
  assert.ok(proposalReviewHtml.includes('Parameter Proposal Review'), 'proposal review UI should declare parameter proposal review mode');
  assert.ok(proposalReviewHtml.includes('parameter-proposals-data'), 'proposal review UI should embed proposal JSON');
  assert.ok(proposalReviewHtml.includes('accepted-proposals-json'), 'proposal review UI should expose accepted proposal JSON');
  assert.ok(proposalReviewHtml.includes('download-accepted-proposals'), 'proposal review UI should expose accepted JSON download');
  assert.ok(proposalReviewHtml.includes('correction-patch.parameter-proposals.json'), 'proposal review UI should link generated proposal patch');
  assert.ok(proposalReviewHtml.includes('main_body'), 'proposal review UI should list main body proposal');
  assert.ok(proposalReviewHtml.includes('cab'), 'proposal review UI should list cab proposal');
  assert.ok(proposalReviewHtml.includes('needs_review'), 'proposal review UI should show review-gated proposal status');

  const proposalPhysicalReport = validatePartGraphPhysicalConsistency(proposalAppliedPartGraph);
  assert.equal(proposalPhysicalReport.ok, true, 'proposal-applied PartGraph physical consistency should not introduce contact errors');
  const proposalBridge = new SketchUpBridge();
  const proposalLayoutReport = await proposalBridge.validate_model({
    code: JSON.stringify(proposalAppliedDocument),
    spec: JSON.parse(await fs.readFile(path.join(repoRoot, 'examples/model-qa/ambulance-reference.json'), 'utf8')),
    runtime: 'mock',
    includePreview: false
  });
  assert.equal(proposalLayoutReport.ok, false, 'partially accepted no-seed proposal graph should remain review-gated by layout QA');
  assert.ok(proposalLayoutReport.summary.total > 0, 'proposal-applied layout QA should record review issues');
  const proposalReferenceReport = await proposalBridge.validate_reference_model({
    code: JSON.stringify(proposalAppliedDocument),
    spec: JSON.parse(await fs.readFile(path.join(repoRoot, 'examples/reference-visual-qa/ambulance-reference.json'), 'utf8')),
    runtime: 'mock',
    includePreview: false
  });
  assert.equal(proposalReferenceReport.ok, false, 'partially accepted no-seed proposal graph should remain review-gated by reference visual QA');
  assert.ok(proposalReferenceReport.summary.total > 0, 'proposal-applied reference visual QA should record review issues');

  const badPartGraph = JSON.parse(JSON.stringify(partGraph));
  const badSideWindow = partGraphPartById(badPartGraph, 'amb-left-side-window');
  badSideWindow.shape.parameters.origin = [
    badSideWindow.shape.parameters.origin[0],
    badSideWindow.shape.parameters.origin[1],
    badSideWindow.shape.parameters.origin[2] - 80
  ];
  const badDocument = compilePartGraphToSketchUpDsl(badPartGraph, profile, { repoRoot });
  const spec = JSON.parse(await fs.readFile(path.join(repoRoot, 'examples/reference-visual-qa/ambulance-reference.json'), 'utf8'));
  const bridge = new SketchUpBridge();
  const badReport = await bridge.validate_reference_model({
    code: JSON.stringify(badDocument),
    spec,
    runtime: 'mock',
    includePreview: false
  });
  assert.equal(badReport.ok, false, 'synthetic PartGraph drift should fail reference visual QA');
  const patchFromBadReport = buildCorrectionPatchFromReferenceReport(badPartGraph, badReport);
  assertValid(validatePartGraphCorrectionPatch, patchFromBadReport, 'synthetic reference visual correction patch');
  assert.ok(patchFromBadReport.edits.some((edit) => (
    edit.action === 'set'
    && edit.part_id === 'amb-left-side-window'
    && edit.path === 'parts[amb-left-side-window].shape.parameters.origin'
  )), 'reference visual QA should generate an applicable PartGraph origin correction');
  const { partGraph: correctedBadPartGraph, applied } = applyCorrectionPatch(badPartGraph, patchFromBadReport);
  assert.ok(applied.length > 0, 'synthetic correction patch should apply at least one edit');
  const correctedSideWindow = partGraphPartById(correctedBadPartGraph, 'amb-left-side-window');
  assert.ok(correctedSideWindow.shape.parameters.origin[2] > badSideWindow.shape.parameters.origin[2], 'applied correction should move the side window back toward the reference keypoint');
  assert.ok(correctedSideWindow.evidence_sources.some((source) => source.kind === 'reference_visual_correction'), 'applied correction should append reference visual correction evidence');
  const correctedBadDocument = compilePartGraphToSketchUpDsl(correctedBadPartGraph, profile, { repoRoot });
  const correctedBadReport = await bridge.validate_reference_model({
    code: JSON.stringify(correctedBadDocument),
    spec,
    runtime: 'mock',
    includePreview: false
  });
  assert.ok(correctedBadReport.summary.total < badReport.summary.total, 'applied correction patch should reduce reference visual QA issues');
  return true;
}

async function assertBuildingGroupObservationSample() {
  const base = path.join(subprojectRoot, 'examples', 'building-group');
  const observations = JSON.parse(await fs.readFile(path.join(base, 'observations.json'), 'utf8'));
  assertValid(validateImageSetObservation, observations, 'building group observations.json');
  assert.equal(observations.object.profile, 'building_group', 'building group observations should declare building_group profile');
  assert.equal(observations.images.length, 3, 'building group observations should keep the three supplied source images');
  assert.ok(observations.views_detected.includes('top'), 'building group observations should include a top/site-plan view');
  assert.ok(observations.views_detected.includes('oblique'), 'building group observations should include oblique aerial views');
  assert.deepEqual(observations.missing_views, [], 'building group observation set should satisfy the R7.0 top/oblique view gate');
  assert.equal(observations.quality_report.usable_for_modeling, true, 'building group observation set should be usable for R7 massing intake');
  assert.equal(observations.scale_calibration.strategy, 'known_site_element_anchors', 'building group scale should use known site-element anchors');
  assert.ok(observations.scale_calibration.default_scale.width >= 100000, 'building group known-element scale should estimate a site width above 100m');
  assert.ok(observations.scale_calibration.default_scale.width <= 160000, 'building group known-element scale should stay in the observed industrial-campus range');
  assert.ok(observations.scale_calibration.default_scale.depth >= 80000, 'building group known-element scale should estimate a site depth above 80m');
  assert.ok(observations.scale_calibration.default_scale.depth <= 130000, 'building group known-element scale should stay in the observed industrial-campus range');
  assert.ok(observations.scale_calibration.measurements.some((measurement) => measurement.anchor_type === 'parking_bay_width_span'), 'building group scale should include a parking bay span anchor');
  assert.ok(observations.scale_calibration.measurements.some((measurement) => measurement.anchor_type === 'parking_bay_single'), 'building group scale should include a single parking bay anchor');
  assert.ok(observations.scale_calibration.measurements.some((measurement) => measurement.anchor_type === 'parking_drive_aisle_width'), 'building group scale should include a drive aisle width anchor');
  assert.ok(observations.scale_calibration.measurements.every((measurement) => measurement.review_required === true), 'building group known-element scale anchors should stay review-gated');
  assertGroundingV3ObservationGraph(observations, 'building group observations.json');
  assert.ok(observations.evidence_graph.part_matches.length >= 8, 'building group evidence graph should expose campus component matches');
  assertVisualRelationGraph(observations, 'building group observations.json');
  assertRelationCandidate(observations, { type: 'right_of', item: 'primary_blue_roof_hall', anchor: 'warehouse_row_west', view: 'top', min_confidence: 0.55 }, 'building group blue hall relative to west warehouses');
  assertRelationCandidate(observations, { type: 'below', item: 'parking_lot', anchor: 'primary_blue_roof_hall', view: 'top', min_confidence: 0.52 }, 'building group parking relative to blue hall');
  assertRelationCandidate(observations, { type: 'inside', item: 'primary_blue_roof_hall', anchor: 'site_boundary', view: 'top', min_confidence: 0.5 }, 'building group blue hall inside site boundary');
  assertRelationCandidate(observations, { type: 'above', item: 'warehouse_west_north', anchor: 'warehouse_west_south', view: 'top', min_confidence: 0.5 }, 'building group west warehouse split candidate');
  assertRelationCandidate(observations, { type: 'right_of', item: 'warehouse_inner_north', anchor: 'warehouse_west_north', view: 'top', min_confidence: 0.48 }, 'building group four-warehouse relative candidate');
  assertRelationCandidate(observations, { type: 'inside', item: 'parking_stall_row_north', anchor: 'parking_lot', view: 'top', min_confidence: 0.48 }, 'building group parking stall row containment candidate');
  assertRelationCandidate(observations, { type: 'below', item: 'tree_row_south', anchor: 'parking_lot', view: 'top', min_confidence: 0.44 }, 'building group tree row relative candidate');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'primary_blue_roof_hall').missing_views, [], 'primary blue-roof hall should have top and oblique evidence');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'warehouse_west_north').missing_views, [], 'west north warehouse unit should have top and oblique relation evidence');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'warehouse_inner_south').missing_views, [], 'inner south warehouse unit should have top and oblique relation evidence');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'tank_farm').missing_views, [], 'tank farm should have top and oblique evidence');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'parking_lot').missing_views, [], 'parking lot should have top evidence');

  const topObservation = observations.images.find((image) => image.detected_view.kind === 'top');
  assert.ok(topObservation, 'building group observations should contain the hinted top view');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'primary_blue_roof_hall'), 'top view should include the blue-roof hall candidate');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'warehouse_row_west'), 'top view should include the west warehouse row candidate');
  const topWarehouseUnits = topObservation.observations.filter((item) => /^warehouse_(west|inner)_(north|south)$/.test(item.component_hint));
  assert.ok(topWarehouseUnits.length >= 4, 'top view should split warehouse evidence into four image-space units');
  assert.equal(topWarehouseUnits.filter((item) => item.grounding?.method === 'pixel_color_segmentation').length, 4, 'top view should include four pixel-grounded warehouse roof footprints');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'primary_blue_roof_hall' && item.grounding?.method === 'pixel_color_segmentation'), 'top view should include a pixel-grounded blue roof footprint');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'parking_stall_row_north'), 'top view should include parking stall row candidates');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'tree_row_south'), 'top view should include a tree/landscape row candidate');
  assert.equal(topObservation.observations.filter((item) => /^parking_stall_row/.test(item.component_hint) && item.grounding?.method === 'pixel_line_segmentation').length, 2, 'top view should include two pixel-line-grounded parking row candidates');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'parking_drive_aisle_center' && item.grounding?.method === 'pixel_gap_segmentation'), 'top view should include a gap-grounded drive aisle candidate');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'tree_row_south' && item.grounding?.method === 'pixel_vegetation_segmentation'), 'top view should include a pixel-grounded vegetation row candidate');
  const pixelGroundedTopObservations = topObservation.observations.filter((item) => /^pixel_/i.test(item.grounding?.method || ''));
  assert.ok(pixelGroundedTopObservations.length >= 9, 'top view should expose pixel-grounded mask/contour candidates for buildings, parking, and tree row');
  assert.ok(pixelGroundedTopObservations.every((item) => item.mask?.polygon?.length >= 5), 'pixel-grounded observations should carry sampled mask polygons');
  assert.ok(pixelGroundedTopObservations.every((item) => item.contour?.kind === 'sampled_mask_contour'), 'pixel-grounded observations should carry sampled contour evidence');
  assert.ok(pixelGroundedTopObservations.every((item) => item.grounding?.contour_basis === 'sampled_mask_contour'), 'pixel-grounded observations should link grounding to contour basis');
  const lowerRightGroundedObservations = topObservation.observations.filter((item) => [
    'parking_stall_row_north',
    'parking_stall_row_south',
    'parking_drive_aisle_center',
    'tree_row_south'
  ].includes(item.component_hint) && /^pixel_/i.test(item.grounding?.method || ''));
  assert.equal(lowerRightGroundedObservations.length, 4, 'top view should expose lower-right parking/tree pixel observations');
  assert.ok(lowerRightGroundedObservations.every((item) => item.grounding?.grounding_quality?.review_required === false), 'lower-right parking/tree observations should pass once mask/gap contours are isolated');
  assert.ok(lowerRightGroundedObservations.every((item) => item.grounding?.grounding_quality?.bbox_proxy === false), 'lower-right parking/tree observations should not be bbox proxies after contour isolation');
  const roofPixelObservations = topObservation.observations.filter((item) => ['primary_blue_roof_hall', 'warehouse_west_north', 'warehouse_west_south', 'warehouse_inner_north', 'warehouse_inner_south'].includes(item.component_hint) && item.grounding?.method === 'pixel_color_segmentation');
  assert.ok(roofPixelObservations.every((item) => item.grounding?.grounding_quality?.review_required === false), 'roof color-segmented observations should remain accepted by the first-pass grounding quality gate');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'internal_roads'), 'top view should include internal road candidates');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'scale_anchor_parking_bay_span'), 'top view should include a parking-bay scale anchor');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'scale_anchor_drive_aisle_width'), 'top view should include a drive-aisle scale anchor');
  assert.ok(topObservation.orientation_hints.semantic_anchors.some((anchor) => anchor.id === 'building-blue-hall-east-of-warehouses'), 'top view should retain a campus orientation anchor');
  assert.equal(topObservation.orientation_hints.review_required, true, 'top-view campus orientation should remain review-gated until north/up is confirmed');
  assert.equal(topObservation.camera_hints.projection_model, 'top_view_affine_bbox_to_site_xy', 'top view should expose an affine image-to-site projection hint');
  const obliqueObservation = observations.images.find((image) => image.detected_view.kind === 'oblique');
  assert.ok(obliqueObservation?.camera_hints?.horizon_line, 'oblique view should expose a review-gated horizon estimate');

  for (const observation of observations.images) {
    assertValid(validateImageObservation, stripCollectionOnlyFields(observation), `${observation.image.path} image observation`);
  }

  const overlays = await fs.readdir(path.join(base, 'review-overlays'));
  assert.equal(overlays.filter((name) => name.endsWith('-overlay.png')).length, 3, 'building group review overlays should cover all source images');

  const defaultPartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.massing.json'), 'utf8'));
  assertValid(validatePartGraph, defaultPartGraph, 'building group default R10 part-graph.massing.json');
  assert.equal(defaultPartGraph.id, 'building-group-r10-auto-groundplan-default-part-graph', 'building group default PartGraph should use the R10 auto GroundPlan identity');
  assert.equal(defaultPartGraph.profile_id, 'building_group_industrial_campus', 'building group default PartGraph should use the building profile');
  assert.equal(defaultPartGraph.scale.calibration.strategy, 'known_site_element_anchors', 'building group default PartGraph should retain known-element scale calibration');
  assert.equal(defaultPartGraph.parts.some((part) => ['internal_roads', 'warehouse_row_west', 'warehouse_row_inner', 'parking_lot'].includes(part.id)), false, 'building group default PartGraph should not emit legacy road, raw parking, or warehouse parent occupancy');
  assert.ok(defaultPartGraph.evidence_graph.auto_ground_plan?.gap_completion, 'building group default PartGraph should carry R10.5 gap completion metadata');
  assert.ok(defaultPartGraph.parts.some((part) => part.role === 'open_paved_area' && part.grounding_decision === 'helper_only'), 'building group default PartGraph should expose open paved gap helper surfaces');
  assert.ok(defaultPartGraph.parts.filter((part) => /^(road|walkway|service_yard)_candidate$/.test(part.role)).every((part) => part.grounding_decision !== 'promoted_geometry'), 'gap-derived road/walkway/service candidates should not be promoted by default');

  const partGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.legacy-massing.json'), 'utf8'));
  assertValid(validatePartGraph, partGraph, 'building group part-graph.legacy-massing.json');
  assert.equal(partGraph.profile_id, 'building_group_industrial_campus', 'building group legacy massing PartGraph should use the R7 building profile');
  assert.equal(partGraph.scale.calibration.strategy, 'known_site_element_anchors', 'building group legacy PartGraph should retain known-element scale calibration');
  assert.ok(partGraph.parts.length >= 12, 'building group legacy PartGraph should include buildings, tanks, roads, parking, site, and scale anchors');
  assert.ok(partGraph.parts.every((part) => part.qa?.review_required === true), 'building group massing parts should remain review-gated');
  assert.ok(partGraph.parts.every((part) => part.parameter_proposals?.every((proposal) => proposal.review_required === true)), 'building group massing parameter proposals should require review');
  assert.equal(partGraph.review.parameter_proposal_summary.review_required, partGraph.review.parameter_proposal_summary.total, 'all building group massing proposals should remain review-gated');
  assert.equal(partGraph.parts.filter((part) => part.shape.primitive === 'cylinder').length, 2, 'building group PartGraph should model the visible tank farm as two cylinder primitives');
  assert.ok(partGraph.parts.some((part) => part.id === 'primary_blue_roof_hall' && part.shape.parameters.size[2] >= 16000), 'blue-roof hall massing should carry a provisional industrial-hall height');
  assert.ok(partGraph.parts.some((part) => part.role === 'scale_anchor'), 'building group PartGraph should preserve visual scale-anchor parts');
  assert.ok(partGraph.evidence_graph.visual_relations.length >= 1000, 'building group PartGraph evidence graph should carry coarse and relation-derived fine visual candidates');
  assert.ok(partGraph.evidence_graph.ground_plan, 'building group PartGraph should carry Grounding v3 GroundPlan metadata');
  assert.ok(partGraph.evidence_graph.grounding_v3, 'building group PartGraph evidence graph should carry Grounding v3 summary metadata');
  assert.ok(partGraph.parts.every((part) => ['promoted_geometry', 'review_candidate', 'helper_only', 'rejected'].includes(part.grounding_decision)), 'building group PartGraph parts should carry Grounding v3 promotion decisions');
  assert.ok(partGraph.parts.some((part) => part.grounding_decision === 'promoted_geometry'), 'Grounding v3 should promote at least one evidence-backed building region');
  assert.ok(partGraphPartById(partGraph, 'primary_blue_roof_hall').relationships.some((relationship) => relationship.type === 'right_of' && relationship.target === 'warehouse_row_west'), 'building group PartGraph should map visual right-of relation into part relationships');
  assert.ok(partGraphPartById(partGraph, 'primary_blue_roof_hall').relationships.some((relationship) => relationship.type === 'inside' && relationship.target === 'site_boundary'), 'building group PartGraph should map site containment into part relationships');
  assert.ok(partGraphPartById(partGraph, 'primary_blue_roof_hall').physical_relations.some((relation) => relation.source === 'visual_relation_graph' && relation.type === 'right_of' && relation.target === 'warehouse_row_west'), 'building group PartGraph should map visual right-of relation into physical_relations');
  assert.ok(partGraphPartById(partGraph, 'parking_lot').physical_relations.some((relation) => relation.source === 'visual_relation_graph' && relation.type === 'below' && relation.target === 'primary_blue_roof_hall'), 'building group PartGraph should map parking visual relation into physical_relations');
  assertVisualRelationEvidence(partGraph, { type: 'above', subject: 'warehouse_west_north', target: 'warehouse_west_south' }, 'building group PartGraph should carry four-warehouse split relation evidence');
  assertVisualRelationEvidence(partGraph, { type: 'inside', subject: 'parking_stall_row_north', target: 'parking_lot' }, 'building group PartGraph should carry parking-stall relation evidence');
  assertVisualRelationEvidence(partGraph, { type: 'below', subject: 'tree_row_south', target: 'parking_lot' }, 'building group PartGraph should carry tree-row relation evidence');
  assert.equal(partGraph.review.part_candidate_proposal_summary.candidate_parts, 8, 'building group should surface eight relation-derived candidate parts');
  assert.equal(partGraph.review.part_candidate_proposal_summary.review_required, partGraph.review.part_candidate_proposal_summary.total, 'building group candidate-part proposals should stay review-gated');
  assert.equal(partGraph.review.part_candidate_proposals.length, 4, 'building group should group relation-derived candidate parts by parent review target');
  assert.ok(partGraph.review.parameter_proposals.filter((proposal) => proposal.proposal_kind === 'part_candidates').length === 4, 'building group candidate parts should enter the standard proposal queue');
  assert.deepEqual(graphPartByIdFromGraph(partGraph.evidence_graph, 'warehouse_west_north').status, 'needs_review', 'west north warehouse candidate should remain review-gated in the PartGraph evidence graph');
  assert.deepEqual(graphPartByIdFromGraph(partGraph.evidence_graph, 'parking_stall_row_north').missing_views, ['oblique'], 'parking stall row candidate should record missing oblique confirmation');
  const westWarehouseCandidateProposal = partGraph.review.part_candidate_proposals.find((proposal) => proposal.part_id === 'warehouse_row_west');
  assert.deepEqual(westWarehouseCandidateProposal.proposed_value.map((part) => part.id), ['warehouse_west_north', 'warehouse_west_south'], 'west warehouse row proposal should contain two reviewed candidate buildings');
  assert.ok(westWarehouseCandidateProposal.proposed_value.every((part) => part.evidence_sources.some((source) => source.grounding?.method === 'pixel_color_segmentation')), 'warehouse candidate proposals should carry pixel-grounded roof evidence');
  assert.ok(westWarehouseCandidateProposal.proposed_value.every((part) => part.shape.parameters.size[0] < 15000), 'pixel-grounded warehouse candidates should use narrow roof footprints instead of the old row-width prior');
  const parkingCandidateProposal = partGraph.review.part_candidate_proposals.find((proposal) => proposal.part_id === 'parking_lot');
  assert.deepEqual(parkingCandidateProposal.proposed_value.map((part) => part.id), ['parking_stall_row_north', 'parking_stall_row_south', 'parking_drive_aisle_center'], 'parking lot proposal should contain two stall rows and one drive aisle candidate');
  assert.ok(parkingCandidateProposal.proposed_value.every((part) => part.evidence_sources.some((source) => ['pixel_line_segmentation', 'pixel_gap_segmentation'].includes(source.grounding?.method))), 'parking candidate proposals should carry pixel-line or pixel-gap grounding evidence');
  const treeCandidateProposal = partGraph.review.part_candidate_proposals.find((proposal) => proposal.part_id === 'site_boundary');
  assert.deepEqual(treeCandidateProposal.proposed_value.map((part) => part.id), ['tree_row_south'], 'site boundary proposal should contain the reviewed tree-row candidate');
  assert.ok(treeCandidateProposal.proposed_value[0].evidence_sources.some((source) => source.grounding?.method === 'pixel_vegetation_segmentation'), 'tree-row candidate proposal should carry pixel vegetation grounding evidence');
  const detailProposals = partGraph.review.parameter_proposals.filter((proposal) => proposal.proposal_kind === 'feature_intents');
  assert.equal(detailProposals.length, 5, 'building group PartGraph should propose roofline/facade/opening feature-intent targets for core buildings');
  assert.ok(detailProposals.every((proposal) => proposal.review_required === true && proposal.status === 'needs_review'), 'building detail proposals should remain review-gated');
  assert.ok(detailProposals.some((proposal) => proposal.proposed_value.some((feature) => feature.semantic?.startsWith('roofline.'))), 'building detail proposals should include roofline feature intents');
  assert.ok(detailProposals.some((proposal) => proposal.proposed_value.some((feature) => feature.semantic?.startsWith('facade.opening.'))), 'building detail proposals should include facade/opening feature intents');
  assert.ok(detailProposals.some((proposal) => proposal.proposed_value.some((feature) => feature.operation === 'cut_slot')), 'building detail proposals should include louver/slot opening candidates');
  assert.ok(partGraph.review.correction_targets.some((target) => target.path === 'parts[primary_blue_roof_hall].feature_intents'), 'building group correction targets should point at primary hall feature intents');
  const primaryDetailProposal = detailProposals.find((proposal) => proposal.part_id === 'primary_blue_roof_hall');
  assert.equal(primaryDetailProposal.proposed_value.length, 6, 'primary hall detail proposal should include a small roofline/facade/opening subset');

  const profile = JSON.parse(await fs.readFile(path.join(repoRoot, 'examples/product-profiles/building_group_industrial_campus.json'), 'utf8'));
  const defaultCompiled = compilePartGraphToSketchUpDsl(defaultPartGraph, profile, { repoRoot });
  const output = JSON.parse(await fs.readFile(path.join(base, 'output.massing.json'), 'utf8'));
  assert.deepEqual(output, defaultCompiled, 'building group default DSL artifact should match current R10 PartGraph compiler output');
  assert.equal(output.operations.some((operation) => ['internal_roads', 'warehouse_row_west', 'warehouse_row_inner', 'parking_lot'].includes(operation.id)), false, 'building group default DSL should not emit rejected legacy occupancy');
  assert.ok(output.operations.some((operation) => /^gap_completion_open_paved_area/.test(operation.id) && operation.qa?.grounding_v3_decision === 'helper_only'), 'building group default DSL should include open paved helper surfaces only as helper geometry');
  const legacyOutput = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  assert.equal(legacyOutput.operations.filter((operation) => operation.op === 'cylinder').length, 2, 'building group legacy DSL should include tank cylinders');
  assert.ok(legacyOutput.operations.filter((operation) => operation.op === 'box').length >= 10, 'building group legacy DSL should include massing and scale-anchor boxes');

  const visualRelationFixture = JSON.parse(await fs.readFile(path.join(base, 'visual-relations.r10-groundplan.fixture.json'), 'utf8'));
  const visualRelationReport = await validateVisualRelations({ observations, fixture: visualRelationFixture, code: JSON.stringify(output) });
  assert.equal(visualRelationReport.ok, true, 'building group VisualRelationGraph fixture should pass against massing output');
  assert.equal(visualRelationReport.summary.checked_relations, visualRelationFixture.required_relations.length, 'building group VisualRelationGraph fixture should check every relation');
  assert.equal(visualRelationReport.summary.image_only_relations, 0, 'R10 default VisualRelationGraph fixture should check canonical child regions in model output');
  assert.equal(visualRelationReport.summary.negative_cases_detected, visualRelationFixture.negative_cases.length, 'building group VisualRelationGraph fixture should detect campus mirror negative cases');
  const savedVisualRelationReport = JSON.parse(await fs.readFile(path.join(base, 'visual-relation-qa', 'report.json'), 'utf8'));
  assert.equal(savedVisualRelationReport.ok, true, 'building group saved VisualRelationGraph report should pass');
  assert.equal(savedVisualRelationReport.summary.checked_relations, visualRelationFixture.required_relations.length, 'building group saved VisualRelationGraph report should stay fresh');

  const mockSessionPath = path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-building-group-mock-session.json');
  await fs.mkdir(path.dirname(mockSessionPath), { recursive: true });
  const bridge = new SketchUpBridge({ mock: { sessionPath: mockSessionPath } });
  const defaultResult = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(output) });
  assert.equal(defaultResult.snapshot.totals.groups, defaultPartGraph.parts.length, 'building group default mock snapshot should create one group per R10 part');
  assert.equal(defaultResult.snapshot.scenes.length, 2, 'building group default mock snapshot should include top and oblique review scenes');
  assert.equal(defaultResult.snapshot.warning_summary.by_severity.error, 0, 'building group default mock build should not create error warnings');
  const result = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(legacyOutput) });
  assert.equal(result.snapshot.totals.groups, partGraph.parts.length, 'building group legacy mock snapshot should create one group per massing part');
  assert.equal(result.snapshot.warning_summary.by_severity.error, 0, 'building group legacy mock build should not create error warnings');

  const acceptedCandidateReview = JSON.parse(await fs.readFile(path.join(base, 'part-candidate-review.accepted-warehouses.json'), 'utf8'));
  assert.equal(acceptedCandidateReview.verdict, 'accepted_relation_candidate_set', 'building group candidate fixture should accept the reviewed relation candidate set');
  assert.deepEqual(
    acceptedCandidateReview.accepted_proposals.map((proposal) => proposal.part_id),
    ['warehouse_row_west', 'warehouse_row_inner', 'parking_lot', 'site_boundary'],
    'building group candidate fixture should promote warehouse, parking, and tree-row candidate groups'
  );
  const candidatePatch = JSON.parse(await fs.readFile(path.join(base, 'correction-patch.part-candidates.json'), 'utf8'));
  assertValid(validatePartGraphCorrectionPatch, candidatePatch, 'building group correction-patch.part-candidates.json');
  assert.equal(candidatePatch.edits.length, 4, 'building group candidate patch should apply four reviewed parent candidate groups');
  assert.ok(candidatePatch.edits.every((edit) => edit.action === 'promote_part_candidates'), 'building group candidate patch should promote candidate parts instead of setting scalar parameters');
  const builtCandidatePatch = buildCorrectionPatchFromParameterProposals(partGraph, acceptedCandidateReview);
  assert.deepEqual(
    builtCandidatePatch.edits.map((edit) => [edit.action, edit.part_id, edit.path]),
    candidatePatch.edits.map((edit) => [edit.action, edit.part_id, edit.path]),
    'candidate proposal patch builder should match the artifact edit targets'
  );
  const candidatePartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.part-candidates-applied.json'), 'utf8'));
  assertValid(validatePartGraph, candidatePartGraph, 'building group part-graph.part-candidates-applied.json');
  assert.equal(candidatePartGraph.parts.length, partGraph.parts.length + 8, 'candidate-applied PartGraph should add eight reviewed relation-derived parts');
  assert.equal(partGraphPartById(candidatePartGraph, 'warehouse_row_west').compile.emit, false, 'west warehouse row should become a non-emitted reference container after candidate promotion');
  assert.equal(partGraphPartById(candidatePartGraph, 'warehouse_row_inner').compile.emit, false, 'inner warehouse row should become a non-emitted reference container after candidate promotion');
  assert.notEqual(partGraphPartById(candidatePartGraph, 'parking_lot').compile?.emit, false, 'parking lot should remain emitted when parking markings are promoted');
  assert.notEqual(partGraphPartById(candidatePartGraph, 'site_boundary').compile?.emit, false, 'site boundary should remain emitted when tree row is promoted');
  for (const partId of ['warehouse_west_north', 'warehouse_west_south', 'warehouse_inner_north', 'warehouse_inner_south']) {
    const candidate = partGraphPartById(candidatePartGraph, partId);
    assert.equal(candidate.evidence_status, 'manual_confirmed', `${partId} should be manual_confirmed after candidate promotion`);
    assert.equal(candidate.fallback_state, 'box_approximation', `${partId} should remain an explicit box approximation`);
    assert.equal(candidate.qa?.part_candidate_applied, true, `${partId} should record candidate-promotion QA metadata`);
    assert.equal(candidate.qa?.review_required, false, `${partId} accepted candidate should not remain review-required`);
  }
  for (const partId of ['parking_stall_row_north', 'parking_stall_row_south', 'parking_drive_aisle_center', 'tree_row_south']) {
    const candidate = partGraphPartById(candidatePartGraph, partId);
    assert.equal(candidate.evidence_status, 'manual_confirmed', `${partId} should be manual_confirmed after candidate promotion`);
    assert.equal(candidate.fallback_state, 'visual_helper', `${partId} should remain an explicit visual helper`);
    assert.equal(candidate.qa?.part_candidate_applied, true, `${partId} should record candidate-promotion QA metadata`);
    assert.equal(candidate.qa?.review_required, false, `${partId} accepted candidate should not remain review-required`);
    assert.ok(candidate.physical_relations.some((relation) => relation.source === 'visual_relation_graph'), `${partId} should carry VisualRelationGraph physical_relations after promotion`);
  }
  const candidateOutput = JSON.parse(await fs.readFile(path.join(base, 'output.part-candidates-applied.json'), 'utf8'));
  const candidateCompiled = compilePartGraphToSketchUpDsl(candidatePartGraph, profile, { repoRoot });
  assert.deepEqual(candidateOutput, candidateCompiled, 'candidate-applied building group DSL should match current PartGraph compiler output');
  const emittedCandidateIds = candidateOutput.operations.map((operation) => operation.id).filter(Boolean);
  assert.ok(!emittedCandidateIds.includes('warehouse_row_west'), 'candidate-applied DSL should not emit the original west warehouse row box');
  assert.ok(!emittedCandidateIds.includes('warehouse_row_inner'), 'candidate-applied DSL should not emit the original inner warehouse row box');
  for (const partId of ['warehouse_west_north', 'warehouse_west_south', 'warehouse_inner_north', 'warehouse_inner_south']) {
    assert.ok(emittedCandidateIds.includes(partId), `candidate-applied DSL should emit ${partId}`);
  }
  for (const partId of ['parking_stall_row_north', 'parking_stall_row_south', 'parking_drive_aisle_center', 'tree_row_south']) {
    assert.ok(emittedCandidateIds.includes(partId), `candidate-applied DSL should emit ${partId}`);
  }
  const candidateResult = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(candidateOutput) });
  assert.equal(candidateResult.snapshot.totals.groups, partGraph.parts.length + 6, 'candidate-applied mock snapshot should replace two warehouse rows and add parking/tree candidate groups');
  const candidateVisualRelationFixture = JSON.parse(await fs.readFile(path.join(base, 'visual-relations.candidates.fixture.json'), 'utf8'));
  const candidateProposalQaReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-candidates', 'report.json'), 'utf8'));
  assert.equal(candidateProposalQaReport.ok, true, 'building group warehouse candidate proposal QA should pass once lower-right mask/gap grounding is isolated');
  assert.equal(candidateProposalQaReport.review_required, false, 'candidate proposal QA should not require grounding review after lower-right segmentation is isolated');
  assert.equal(candidateProposalQaReport.compiled_matches_output, true, 'building group warehouse candidate proposal QA should verify compiled output freshness');
  assert.equal(candidateProposalQaReport.layout.verdict, 'pass', 'building group warehouse candidate layout QA should pass');
  assert.equal(candidateProposalQaReport.reference_visual.verdict, 'pass', 'building group warehouse candidate reference visual QA should pass');
  assert.equal(candidateProposalQaReport.visual_relations.verdict, 'pass', 'building group warehouse candidate visual relation QA should pass');
  assert.equal(candidateProposalQaReport.visual_relations.checked_relations, candidateVisualRelationFixture.required_relations.length, 'building group candidate visual relation QA should check every relation in the candidate fixture');
  assert.equal(candidateProposalQaReport.visual_relations.checked_footprints, candidateVisualRelationFixture.footprint_rules.length, 'building group candidate visual relation QA should check every pixel-grounded footprint rule');
  assert.equal(candidateProposalQaReport.visual_relations.matched_footprints, candidateVisualRelationFixture.footprint_rules.length, 'building group candidate visual relation QA should match every pixel-grounded footprint');
  assert.equal(candidateProposalQaReport.geometry_fit.verdict, 'pass', 'building group warehouse candidate GeometryFit QA should pass isolated lower-right grounding');
  assert.equal(candidateProposalQaReport.geometry_fit.grounding_issues, 0, 'building group GeometryFit QA should not flag isolated parking/tree contours as grounding proxies');
  assert.equal(candidateProposalQaReport.geometry_fit.checked_footprints, candidateVisualRelationFixture.footprint_rules.length, 'building group GeometryFit QA should check every pixel-grounded footprint rule');
  assert.equal(candidateProposalQaReport.geometry_fit.checked_relations, candidateVisualRelationFixture.required_relations.length, 'building group GeometryFit QA should check every projected relation rule');
  assert.equal(candidateProposalQaReport.geometry_fit.checked_scale_anchors >= 4, true, 'building group GeometryFit QA should evaluate known-element scale anchors');
  assert.equal(candidateProposalQaReport.geometry_fit.max_center_error <= 0.01, true, 'building group GeometryFit center residual should stay tight for the accepted candidate fixture');
  assert.equal(candidateProposalQaReport.geometry_fit.max_relation_error <= 0.02, true, 'building group GeometryFit relation residual should stay tight for the accepted candidate fixture');
  assert.equal(candidateProposalQaReport.physical_consistency.verdict, 'pass', 'building group warehouse candidate physical consistency should pass');
  assert.equal(candidateProposalQaReport.part_graph.parts, partGraph.parts.length + 8, 'candidate proposal QA should record eight promoted candidate parts');
  assert.equal(candidateProposalQaReport.part_graph.evidence_summary.manual_confirmed, 8, 'candidate proposal QA should record eight manual-confirmed relation candidates');
  const candidateGeometryFitReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-candidates', 'geometry-fit-report.json'), 'utf8'));
  assert.equal(candidateGeometryFitReport.ok, true, 'building group candidate GeometryFit report should pass after lower-right grounding is isolated');
  assert.equal(candidateGeometryFitReport.camera_calibration.projection_type, 'top_view_affine_bbox_to_site_xy', 'GeometryFit should calibrate top-view image space to site XY');
  assert.equal(candidateGeometryFitReport.summary.checked_footprints, candidateVisualRelationFixture.footprint_rules.length, 'saved GeometryFit report should cover every candidate footprint');
  assert.equal(candidateGeometryFitReport.summary.grounding_issues, 0, 'saved GeometryFit report should not count isolated lower-right contours as grounding proxies');
  assert.equal(candidateGeometryFitReport.summary.checked_handedness_cases, candidateVisualRelationFixture.negative_cases.length, 'saved GeometryFit report should retain handedness negative checks');
  const liveGeometryFitReport = await validateGeometryFit({
    observations,
    fixture: candidateVisualRelationFixture,
    code: JSON.stringify(candidateOutput),
    mockSessionPath: path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-building-group-geometry-fit-session.json')
  });
  assert.equal(liveGeometryFitReport.ok, true, 'GeometryFit validator should accept the isolated lower-right grounding directly against the candidate-applied DSL');
  assert.equal(liveGeometryFitReport.issues.filter((issue) => issue.type === 'geometry_fit.grounding_ambiguity').length, 0, 'GeometryFit validator should not emit grounding ambiguity issues for isolated lower-right masks');
  assert.equal(liveGeometryFitReport.summary.max_scale_error <= 0.12, true, 'GeometryFit scale residual should preserve the known-element anchor tolerance');
  const candidateGroundingV3Report = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-candidates', 'grounding-v3-report.json'), 'utf8'));
  assert.equal(candidateGroundingV3Report.version, 3, 'building group candidate Grounding v3 report should use v3 report version');
  assert.equal(candidateGroundingV3Report.summary.checked_scale_anchors >= 4, true, 'Grounding v3 should evaluate multiple scale-anchor candidates');
  assert.equal(candidateGroundingV3Report.summary.distinct_scale_anchor_families >= 2, true, 'Grounding v3 scale anchors should not be parking-only');
  assert.ok(candidateGroundingV3Report.graph.ground_plan.regions.some((region) => region.class === 'gap'), 'Grounding v3 GroundPlan should explicitly represent residual gap regions');
  assert.equal(candidateGroundingV3Report.summary.checked_line_fits >= 2, true, 'Grounding v3 should evaluate parking line fits before geometry promotion');
  assert.equal(candidateGroundingV3Report.summary.top_view_overlay_regions > 0, true, 'Grounding v3 should run top-view overlay region checks');
  assert.equal(candidateGroundingV3Report.summary.photo_grade_candidate, false, 'Grounding v3 should not claim photo-grade readiness for the current technical baseline');
  const liveGroundingV3Report = validateGroundingV3({
    observations,
    fixture: candidateVisualRelationFixture,
    geometryFit: liveGeometryFitReport,
    codeDocument: candidateOutput
  });
  assert.equal(liveGroundingV3Report.version, 3, 'Grounding v3 validator should emit v3 reports');
  assert.equal(liveGroundingV3Report.summary.distinct_scale_anchor_families >= 2, true, 'Grounding v3 live validation should preserve multi-family anchor voting');
  assert.equal(liveGroundingV3Report.summary.promoted_geometry > 0, true, 'Grounding v3 live validation should promote only evidence-backed regions');
  const candidatePhotoGradeReadiness = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-candidates', 'photo-grade-readiness-report.json'), 'utf8'));
  assertPhotoGradeReadinessReport(candidatePhotoGradeReadiness, {
    expectedReadiness: 'technical_baseline',
    label: 'building group candidate PhotoGradeReadiness'
  });
  assert.equal(gateById(candidatePhotoGradeReadiness, 'line_grid').candidate_ready, true, 'building group line/grid gate should be candidate-ready');
  assert.equal(gateById(candidatePhotoGradeReadiness, 'top_view_overlay').candidate_ready, true, 'building group top-view overlay gate should be candidate-ready');
  assert.ok(candidatePhotoGradeReadiness.blockers.some((blocker) => blocker.gate === 'scale'), 'building group readiness should explain scale review blockers');
  assert.ok(candidatePhotoGradeReadiness.blockers.some((blocker) => blocker.gate === 'subdivision'), 'building group readiness should explain subdivision gap blockers');
  assert.ok(candidatePhotoGradeReadiness.blockers.some((blocker) => blocker.gate === 'oblique_facade'), 'building group readiness should explain oblique/facade blockers');
  const livePhotoGradeReadiness = validatePhotoGradeReadiness({
    observations,
    fixture: candidateVisualRelationFixture,
    geometryFit: liveGeometryFitReport,
    groundingV3: liveGroundingV3Report,
    codeDocument: candidateOutput,
    sampleId: 'building-group-candidates',
    sampleKind: 'generated_building_group',
    inputAssetStatus: 'available'
  });
  assertPhotoGradeReadinessReport(livePhotoGradeReadiness, {
    expectedReadiness: 'technical_baseline',
    label: 'live building group candidate PhotoGradeReadiness'
  });

  const layoutQaReport = JSON.parse(await fs.readFile(path.join(base, 'layout-qa', 'building-group-massing', 'report.json'), 'utf8'));
  assert.equal(layoutQaReport.ok, true, 'building group layout QA artifact should pass');
  assert.equal(layoutQaReport.verdict, 'pass', 'building group layout QA artifact should record pass verdict');
  assert.equal(layoutQaReport.summary.total, 0, 'building group layout QA artifact should have no issues');
  assert.equal(layoutQaReport.summary.visible_items, defaultPartGraph.parts.length, 'building group layout QA should check all default R10 parts');
  assert.equal(layoutQaReport.summary.preview_views, 2, 'building group layout QA should include top/height previews');

  const referenceQaReport = JSON.parse(await fs.readFile(path.join(base, 'reference-visual-qa', 'building-group-massing', 'report.json'), 'utf8'));
  assert.equal(referenceQaReport.ok, true, 'building group reference visual QA artifact should pass');
  assert.equal(referenceQaReport.verdict, 'pass', 'building group reference visual QA artifact should record pass verdict');
  assert.equal(referenceQaReport.summary.total, 0, 'building group reference visual QA artifact should have no issues');
  assert.equal(referenceQaReport.summary.checked_items, defaultPartGraph.parts.length - 1, 'reference visual QA should ignore the reference-only site slab and check generated R10 items');
  assert.equal(referenceQaReport.summary.preview_views, 2, 'building group reference visual QA should include site/height previews');

  const queueLayoutQaReport = JSON.parse(await fs.readFile(path.join(base, 'layout-qa-queue', 'building-group-massing', 'report.json'), 'utf8'));
  assert.equal(queueLayoutQaReport.ok, true, 'building group queue layout QA artifact should pass');
  assert.equal(queueLayoutQaReport.verdict, 'pass', 'building group queue layout QA artifact should record pass verdict');
  assert.equal(queueLayoutQaReport.summary.total, 0, 'building group queue layout QA artifact should have no issues');
  assert.equal(queueLayoutQaReport.summary.visible_items, partGraph.parts.length, 'building group queue layout QA should check all massing parts');

  const queueReferenceQaReport = JSON.parse(await fs.readFile(path.join(base, 'reference-visual-qa-queue', 'building-group-massing', 'report.json'), 'utf8'));
  assert.equal(queueReferenceQaReport.ok, true, 'building group queue reference visual QA artifact should pass');
  assert.equal(queueReferenceQaReport.verdict, 'pass', 'building group queue reference visual QA artifact should record pass verdict');
  assert.equal(queueReferenceQaReport.summary.total, 0, 'building group queue reference visual QA artifact should have no issues');
  assert.equal(queueReferenceQaReport.summary.checked_items, partGraph.parts.length - 1, 'building group queue reference visual QA should ignore the reference-only site slab');

  const acceptedDetailReview = JSON.parse(await fs.readFile(path.join(base, 'parameter-proposal-review.accepted.json'), 'utf8'));
  assert.equal(acceptedDetailReview.verdict, 'accepted_subset', 'building group detail accepted review should stay subset-only');
  assert.deepEqual(acceptedDetailReview.accepted_proposals.map((proposal) => proposal.part_id), ['primary_blue_roof_hall'], 'building group detail fixture should accept only primary hall detail proposals');

  const detailPatch = JSON.parse(await fs.readFile(path.join(base, 'correction-patch.detail-proposals.json'), 'utf8'));
  assert.equal(detailPatch.source, 'parameter_proposal_review', 'building group detail patch should come from proposal review');
  assert.equal(detailPatch.edits.length, 1, 'building group detail patch should apply one reviewed proposal');
  assert.equal(detailPatch.edits[0].path, 'parts[primary_blue_roof_hall].feature_intents', 'building group detail patch should target primary hall feature intents');

  const detailAppliedPartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.detail-proposal-applied.json'), 'utf8'));
  assertValid(validatePartGraph, detailAppliedPartGraph, 'building group part-graph.detail-proposal-applied.json');
  const detailAppliedPrimary = partGraphPartById(detailAppliedPartGraph, 'primary_blue_roof_hall');
  assert.equal(detailAppliedPrimary.evidence_status, 'manual_confirmed', 'accepted building detail proposal should mark the reviewed part as manual_confirmed');
  assert.equal(detailAppliedPrimary.feature_intents.length, 6, 'accepted building detail proposal should attach primary hall feature intents');
  assert.equal(partGraphPartById(detailAppliedPartGraph, 'warehouse_row_west').feature_intents, undefined, 'unaccepted building detail proposals should not be applied');

  const detailOutput = JSON.parse(await fs.readFile(path.join(base, 'output.detail-proposal-applied.json'), 'utf8'));
  const detailCompiled = compilePartGraphToSketchUpDsl(detailAppliedPartGraph, profile, { repoRoot });
  assert.deepEqual(detailOutput, detailCompiled, 'building group detail-applied DSL should match current PartGraph compiler output');
  assert.equal(detailOutput.operations.filter((operation) => operation.op === 'add_raised_rib').length, 3, 'detail-applied DSL should include accepted roofline ribs');
  assert.equal(detailOutput.operations.filter((operation) => operation.op === 'cut_recess').length, 3, 'detail-applied DSL should include accepted facade/opening recesses');
  const detailResult = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(detailOutput) });
  assert.equal(detailResult.snapshot.totals.groups, partGraph.parts.length, 'detail-applied mock snapshot should preserve one group per massing part');
  assert.ok(detailResult.snapshot.totals.faces > result.snapshot.totals.faces, 'detail-applied mock snapshot should add feature-backed topology');
  const primarySnapshotItem = detailResult.snapshot.groups.find((group) => group.id === 'primary_blue_roof_hall');
  assert.ok(primarySnapshotItem, 'detail-applied mock snapshot should include primary hall item');
  assert.equal(primarySnapshotItem.features.length, 6, 'detail-applied mock snapshot should record accepted primary hall features');

  const proposalReviewHtml = await fs.readFile(path.join(base, 'proposal-review', 'index.html'), 'utf8');
  assert.ok(proposalReviewHtml.includes('roofline'), 'building group proposal review should expose roofline proposals');
  assert.ok(proposalReviewHtml.includes('facade.opening'), 'building group proposal review should expose facade/opening proposals');
  const proposalQaReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa', 'report.json'), 'utf8'));
  assert.equal(proposalQaReport.ok, true, 'building group detail proposal QA should pass in mock runtime');
  assert.equal(proposalQaReport.compiled_matches_output, true, 'building group detail proposal QA should verify compiled output freshness');
  assert.equal(proposalQaReport.layout.verdict, 'pass', 'building group detail proposal layout QA should pass');
  assert.equal(proposalQaReport.reference_visual.verdict, 'pass', 'building group detail proposal reference visual QA should pass');
  assert.equal(proposalQaReport.physical_consistency.verdict, 'pass', 'building group detail proposal physical consistency should pass');

  const proposalQueueQaReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-queue', 'report.json'), 'utf8'));
  assert.equal(proposalQueueQaReport.ok, true, 'building group detail proposal queue QA should pass');
  assert.equal(proposalQueueQaReport.runtime, 'queue', 'building group detail proposal queue QA should record queue runtime');
  assert.equal(proposalQueueQaReport.compiled_matches_output, true, 'building group detail proposal queue QA should verify compiled output freshness');
  assert.equal(proposalQueueQaReport.layout.verdict, 'pass', 'building group detail proposal queue layout QA should pass');
  assert.equal(proposalQueueQaReport.reference_visual.verdict, 'pass', 'building group detail proposal queue reference visual QA should pass');
  assert.equal(proposalQueueQaReport.physical_consistency.verdict, 'pass', 'building group detail proposal queue physical consistency should pass');
  assert.equal(proposalQueueQaReport.artifact.totals.groups, partGraph.parts.length, 'building group detail proposal queue artifact should preserve massing group count');
  assert.ok(proposalQueueQaReport.artifact.totals.faces >= detailResult.snapshot.totals.faces, 'building group detail proposal queue artifact should preserve feature-backed topology');
  assert.ok(proposalQueueQaReport.artifact.totals.faces > result.snapshot.totals.faces, 'building group detail proposal queue artifact should add topology beyond base massing');
  assert.ok(proposalQueueQaReport.artifact.path.endsWith('output/image-structured-building-group-detail-proposal-applied.skp'), 'building group detail proposal queue artifact should save the expected SKP');

  const acceptedAllDetailReview = JSON.parse(await fs.readFile(path.join(base, 'parameter-proposal-review.accepted-all.json'), 'utf8'));
  assert.equal(acceptedAllDetailReview.verdict, 'accepted_all_current_detail_proposals', 'building group R7 final review should accept all current detail proposals');
  assert.deepEqual(
    acceptedAllDetailReview.accepted_proposals.map((proposal) => proposal.part_id),
    ['primary_blue_roof_hall', 'warehouse_row_west', 'warehouse_row_inner', 'utility_building', 'admin_office'],
    'building group R7 final review should cover all current detail proposal targets'
  );

  const allDetailPatch = JSON.parse(await fs.readFile(path.join(base, 'correction-patch.detail-proposals-all.json'), 'utf8'));
  assert.equal(allDetailPatch.source, 'parameter_proposal_review', 'building group R7 final patch should come from proposal review');
  assert.equal(allDetailPatch.edits.length, 5, 'building group R7 final patch should apply all reviewed detail proposals');
  assert.deepEqual(
    allDetailPatch.edits.map((edit) => edit.part_id),
    ['primary_blue_roof_hall', 'warehouse_row_west', 'warehouse_row_inner', 'utility_building', 'admin_office'],
    'building group R7 final patch should preserve reviewed proposal target order'
  );

  const finalPartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.r7-final.json'), 'utf8'));
  assertValid(validatePartGraph, finalPartGraph, 'building group part-graph.r7-final.json');
  const finalFeatureCounts = Object.fromEntries(finalPartGraph.parts.filter((part) => part.feature_intents).map((part) => [part.id, part.feature_intents.length]));
  assert.deepEqual(finalFeatureCounts, {
    primary_blue_roof_hall: 6,
    warehouse_row_west: 5,
    warehouse_row_inner: 5,
    utility_building: 3,
    admin_office: 4
  }, 'building group R7 final PartGraph should attach all current roofline/facade/opening feature intents');
  assert.deepEqual(
    finalPartGraph.parts.filter((part) => part.evidence_status === 'manual_confirmed').map((part) => part.id),
    ['primary_blue_roof_hall', 'warehouse_row_west', 'warehouse_row_inner', 'utility_building', 'admin_office'],
    'building group R7 final accepted detail parts should be manual_confirmed'
  );

  const finalOutput = JSON.parse(await fs.readFile(path.join(base, 'output.r7-final.json'), 'utf8'));
  const finalCompiled = compilePartGraphToSketchUpDsl(finalPartGraph, profile, { repoRoot });
  assert.deepEqual(finalOutput, finalCompiled, 'building group R7 final DSL should match current PartGraph compiler output');
  assert.equal(finalOutput.operations.filter((operation) => operation.op === 'add_raised_rib').length, 9, 'R7 final DSL should include all accepted roofline ribs');
  assert.equal(finalOutput.operations.filter((operation) => operation.op === 'cut_recess').length, 13, 'R7 final DSL should include all accepted facade/opening recesses');
  assert.equal(finalOutput.operations.filter((operation) => operation.op === 'cut_slot').length, 1, 'R7 final DSL should include the accepted utility louver slot');
  const finalDetailResult = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(finalOutput) });
  assert.equal(finalDetailResult.snapshot.totals.groups, partGraph.parts.length, 'R7 final mock snapshot should preserve one group per massing part');
  assert.ok(finalDetailResult.snapshot.totals.faces > detailResult.snapshot.totals.faces, 'R7 final mock snapshot should add topology beyond the primary-hall subset');
  for (const [partId, count] of Object.entries(finalFeatureCounts)) {
    const snapshotItem = finalDetailResult.snapshot.groups.find((group) => group.id === partId);
    assert.ok(snapshotItem, `R7 final mock snapshot should include ${partId}`);
    assert.equal(snapshotItem.features.length, count, `R7 final mock snapshot should record all accepted features for ${partId}`);
  }

  const finalLayoutQaReport = JSON.parse(await fs.readFile(path.join(base, 'layout-qa-r7-final', 'building-group-r7-final', 'report.json'), 'utf8'));
  assert.equal(finalLayoutQaReport.ok, true, 'building group R7 final layout QA artifact should pass');
  assert.equal(finalLayoutQaReport.summary.total, 0, 'building group R7 final layout QA artifact should have no issues');
  const finalReferenceQaReport = JSON.parse(await fs.readFile(path.join(base, 'reference-visual-qa-r7-final', 'building-group-r7-final', 'report.json'), 'utf8'));
  assert.equal(finalReferenceQaReport.ok, true, 'building group R7 final reference visual QA artifact should pass');
  assert.equal(finalReferenceQaReport.summary.total, 0, 'building group R7 final reference visual QA artifact should have no issues');
  assert.equal(finalReferenceQaReport.summary.by_type['reference.feature_missing'] || 0, 0, 'R7 final reference QA should not report missing accepted feature intents');

  const finalProposalQaReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-r7-final', 'report.json'), 'utf8'));
  assert.equal(finalProposalQaReport.ok, true, 'building group R7 final proposal QA should pass in mock runtime');
  assert.equal(finalProposalQaReport.review_required, false, 'building group R7 final proposal QA should not require additional review for current accepted proposals');
  assert.equal(finalProposalQaReport.compiled_matches_output, true, 'building group R7 final proposal QA should verify compiled output freshness');
  assert.equal(finalProposalQaReport.reference_visual.verdict, 'pass', 'building group R7 final feature reference visual QA should pass');
  assert.equal(finalProposalQaReport.physical_consistency.verdict, 'pass', 'building group R7 final physical consistency should pass');

  const finalProposalQueueQaReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-r7-final-queue', 'report.json'), 'utf8'));
  assert.equal(finalProposalQueueQaReport.ok, true, 'building group R7 final queue QA should pass');
  assert.equal(finalProposalQueueQaReport.runtime, 'queue', 'building group R7 final queue QA should record queue runtime');
  assert.equal(finalProposalQueueQaReport.review_required, false, 'building group R7 final queue QA should not require additional review for current accepted proposals');
  assert.equal(finalProposalQueueQaReport.compiled_matches_output, true, 'building group R7 final queue QA should verify compiled output freshness');
  assert.equal(finalProposalQueueQaReport.layout.verdict, 'pass', 'building group R7 final queue layout QA should pass');
  assert.equal(finalProposalQueueQaReport.reference_visual.verdict, 'pass', 'building group R7 final queue reference visual QA should pass');
  assert.equal(finalProposalQueueQaReport.physical_consistency.verdict, 'pass', 'building group R7 final queue physical consistency should pass');
  assert.equal(finalProposalQueueQaReport.artifact.totals.groups, partGraph.parts.length, 'building group R7 final queue artifact should preserve massing group count');
  assert.ok(finalProposalQueueQaReport.artifact.totals.faces > proposalQueueQaReport.artifact.totals.faces, 'building group R7 final queue artifact should add topology beyond the primary-hall subset');
  assert.ok(finalProposalQueueQaReport.artifact.path.endsWith('output/image-structured-building-group-r7-final.skp'), 'building group R7 final queue artifact should save the expected SKP');

  const photorealPartGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.r7-photoreal.json'), 'utf8'));
  assertValid(validatePartGraph, photorealPartGraph, 'building group part-graph.r7-photoreal.json');
  assert.equal(photorealPartGraph.parts.filter((part) => part.shape?.primitive === 'gable_roof').length, 5, 'photoreal PartGraph should use gable roof primitives for the blue hall and split warehouses');
  assert.equal(photorealPartGraph.parts.filter((part) => /^warehouse_.*_body$/.test(part.id)).length, 4, 'photoreal PartGraph should split the two warehouse rows into four visible buildings');
  assert.equal(photorealPartGraph.operations.filter((operation) => operation.op === 'image_plane').length, 10, 'photoreal PartGraph should carry texture image planes for site, roofs, tanks, and parking');
  assert.ok(photorealPartGraph.parts.filter((part) => part.role === 'scale_anchor').every((part) => part.compile?.emit === false), 'photoreal PartGraph should keep scale anchors as evidence without rendering yellow helper boxes');

  const photorealOutput = JSON.parse(await fs.readFile(path.join(base, 'output.r7-photoreal.json'), 'utf8'));
  const photorealCompiled = compilePartGraphToSketchUpDsl(photorealPartGraph, profile, { repoRoot });
  assert.deepEqual(photorealOutput, photorealCompiled, 'building group R7 photoreal DSL should match current PartGraph compiler output');
  assert.equal(photorealOutput.operations.filter((operation) => operation.op === 'image_plane').length, 10, 'photoreal DSL should include texture image planes');
  assert.equal(photorealOutput.operations.filter((operation) => operation.op === 'gable_roof').length, 5, 'photoreal DSL should compile PartGraph gable roof primitives');
  assert.ok(photorealOutput.operations.filter((operation) => operation.op === 'cylinder').length >= 70, 'photoreal DSL should include dense tree and roof-vent cylinder detail');
  assert.ok(photorealOutput.operations.every((operation) => operation.op !== 'image_plane' || !path.isAbsolute(operation.image)), 'compiled graph operation image planes should stay portable inside committed artifacts');
  const queueReadyPhotorealOutput = materializeDslAssetPaths(photorealOutput, { repoRoot });
  assert.ok(queueReadyPhotorealOutput.operations.every((operation) => operation.op !== 'image_plane' || path.isAbsolute(operation.image)), 'queue runtime should materialize photoreal image planes before live SketchUp execution');
  const photorealMockResult = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(photorealOutput) });
  assert.ok(photorealMockResult.snapshot.totals.groups > finalDetailResult.snapshot.totals.groups, 'photoreal mock snapshot should be denser than R7 final');
  assert.ok(photorealMockResult.snapshot.totals.faces > finalDetailResult.snapshot.totals.faces, 'photoreal mock snapshot should add substantial geometry beyond R7 final');

  const photorealLayoutQaReport = JSON.parse(await fs.readFile(path.join(base, 'layout-qa-r7-photoreal', 'building-group-r7-photoreal', 'report.json'), 'utf8'));
  assert.equal(photorealLayoutQaReport.ok, true, 'building group R7 photoreal layout QA artifact should pass');
  assert.equal(photorealLayoutQaReport.summary.total, 0, 'building group R7 photoreal layout QA artifact should have no issues');
  const photorealReferenceQaReport = JSON.parse(await fs.readFile(path.join(base, 'reference-visual-qa-r7-photoreal', 'building-group-r7-photoreal', 'report.json'), 'utf8'));
  assert.equal(photorealReferenceQaReport.ok, true, 'building group R7 photoreal reference visual QA artifact should pass');
  assert.equal(photorealReferenceQaReport.summary.total, 0, 'building group R7 photoreal reference visual QA artifact should have no issues');
  const photorealProposalQaReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-r7-photoreal', 'report.json'), 'utf8'));
  assert.equal(photorealProposalQaReport.ok, true, 'building group R7 photoreal proposal QA should pass in mock runtime');
  assert.equal(photorealProposalQaReport.compiled_matches_output, true, 'building group R7 photoreal proposal QA should verify compiled output freshness');
  assert.equal(photorealProposalQaReport.physical_consistency.verdict, 'pass', 'building group R7 photoreal physical consistency should pass');

  const photorealQueueLayoutQaReport = JSON.parse(await fs.readFile(path.join(base, 'layout-qa-r7-photoreal-queue', 'building-group-r7-photoreal', 'report.json'), 'utf8'));
  assert.equal(photorealQueueLayoutQaReport.ok, true, 'building group R7 photoreal queue layout QA artifact should pass');
  assert.equal(photorealQueueLayoutQaReport.summary.total, 0, 'building group R7 photoreal queue layout QA artifact should have no issues');
  const photorealQueueReferenceQaReport = JSON.parse(await fs.readFile(path.join(base, 'reference-visual-qa-r7-photoreal-queue', 'building-group-r7-photoreal', 'report.json'), 'utf8'));
  assert.equal(photorealQueueReferenceQaReport.ok, true, 'building group R7 photoreal queue reference visual QA artifact should pass');
  assert.equal(photorealQueueReferenceQaReport.summary.total, 0, 'building group R7 photoreal queue reference visual QA artifact should have no issues');
  const photorealQueueProposalQaReport = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-r7-photoreal-queue', 'report.json'), 'utf8'));
  assert.equal(photorealQueueProposalQaReport.ok, true, 'building group R7 photoreal queue QA should pass');
  assert.equal(photorealQueueProposalQaReport.runtime, 'queue', 'building group R7 photoreal queue QA should record queue runtime');
  assert.equal(photorealQueueProposalQaReport.compiled_matches_output, true, 'building group R7 photoreal queue QA should verify compiled output freshness');
  assert.equal(photorealQueueProposalQaReport.layout.verdict, 'pass', 'building group R7 photoreal queue layout QA should pass');
  assert.equal(photorealQueueProposalQaReport.reference_visual.verdict, 'pass', 'building group R7 photoreal queue reference visual QA should pass');
  assert.equal(photorealQueueProposalQaReport.physical_consistency.verdict, 'pass', 'building group R7 photoreal queue physical consistency should pass');
  assert.ok(photorealQueueProposalQaReport.artifact.totals.groups > finalProposalQueueQaReport.artifact.totals.groups, 'building group R7 photoreal queue artifact should be denser than R7 final');
  assert.ok(photorealQueueProposalQaReport.artifact.totals.faces > finalProposalQueueQaReport.artifact.totals.faces, 'building group R7 photoreal queue artifact should add faces beyond R7 final');
  assert.ok(photorealQueueProposalQaReport.artifact.path.endsWith('output/image-structured-building-group-r7-photoreal.skp'), 'building group R7 photoreal queue artifact should save the expected SKP');
  return true;
}

async function assertR8StructuralGroundingRepair() {
  const base = path.join(subprojectRoot, 'examples', 'building-group');
  const partGraph = JSON.parse(await fs.readFile(path.join(base, 'part-graph.r8-geometry.json'), 'utf8'));
  assertValid(validatePartGraph, partGraph, 'building group part-graph.r8-geometry.json');
  assert.equal(partGraph.id, 'building-group-r8-editable-geometry-boundary-part-graph', 'R8 PartGraph should keep the editable geometry boundary identity');
  assert.equal(partGraph.review.structural_grounding.version, 1, 'R8 PartGraph should expose structural grounding metadata');
  assert.equal(partGraph.review.structural_grounding.site_region_graph.qa.max_overlap_ratio < 0.02, true, 'R8 site regions should not materially overlap');
  assert.equal(partGraph.review.structural_grounding.site_region_graph.qa.unclassified_ratio < 0.45, true, 'R8 site regions should keep unclassified gaps below review threshold');
  assert.equal(partGraph.review.structural_grounding.site_region_graph.area_ratios.road_pavement < 0.22, true, 'R8 internal road regions should not cover the entire site');
  assert.equal(partGraphPartById(partGraph, 'internal_roads').compile.emit, false, 'R8 should suppress the old internal_roads bbox proxy part');
  assert.equal(partGraph.review.structural_grounding.parking_layout_graph.vehicle_instances.length, 0, 'R8 should not invent vehicle instances without per-instance evidence');

  const output = JSON.parse(await fs.readFile(path.join(base, 'output.r8-geometry.json'), 'utf8'));
  assert.equal(output.operations.filter((operation) => operation.op === 'image_plane').length, 0, 'R8 geometry output should remain no-texture');
  const internalRoad = output.operations.find((operation) => operation.id === 'internal_roads');
  assert.equal(internalRoad?.op, 'mesh', 'R8 internal roads should compile as polygon mesh regions instead of a site-scale box');
  assert.equal(Boolean(internalRoad.qa?.site_region_graph), true, 'R8 internal road mesh should carry SiteRegionGraph QA metadata');
  assert.equal(output.operations.filter((operation) => /^parked_vehicle/.test(operation.qa?.role || '')).length, 0, 'R8 geometry should not batch-generate vehicles without instance evidence');

  const parkingLines = output.operations.filter((operation) => operation.qa?.parking_layout_graph);
  assert.ok(parkingLines.length >= 30, 'R8 should emit reviewed parking line geometry from ParkingLayoutGraph');
  assert.ok(parkingLines.every((operation) => operation.qa.parking_layout_graph.line_evidence === true), 'R8 parking lines should carry line evidence metadata');
  assert.ok(parkingLines.every((operation) => operation.qa.source_observation_ids.length > 0), 'R8 parking lines should trace back to parking line/gap observations');
  assert.equal(Math.max(...parkingLines.map((operation) => operation.qa.parking_layout_graph.projection_residuals.spacing_error_ratio)) < 0.12, true, 'R8 parking grid spacing residual should stay inside review threshold');

  const roofSurfaceFeatures = output.operations.filter((operation) => ['roof_panel_seam', 'roof_monitor', 'roof_vent', 'roof_hvac'].includes(operation.qa?.role));
  assert.ok(roofSurfaceFeatures.length >= 35, 'R8 should check roof seam/monitor/vent surface binding');
  assert.ok(roofSurfaceFeatures.every((operation) => operation.qa.roof_surface_fit?.host_part_id), 'R8 roof features should be bound to a host roof surface');
  assert.ok(roofSurfaceFeatures.every((operation) => operation.qa.roof_surface_fit.surface_distance_mm <= 80), 'R8 roof features should not float above their roof-surface threshold');
  assert.ok(output.operations.filter((operation) => operation.qa?.role === 'roof_panel_seam').every((operation) => operation.op === 'mesh'), 'R8 blue-hall roof seams should be sloped roof-plane meshes');

  const tankDetails = output.operations.filter((operation) => operation.qa?.tank_ellipse_fit);
  assert.equal(tankDetails.length >= 8, true, 'R8 tank details should inherit TankEllipseFit metadata');
  assert.equal(new Set(tankDetails.flatMap((operation) => [operation.qa.tank_ellipse_fit.tank_instance_id, ...(operation.qa.tank_ellipse_fit.tank_instance_ids || [])].filter(Boolean))).size, 2, 'R8 tank details should reference two ellipse instances');
  assert.ok(tankDetails.every((operation) => operation.qa.grounding_status !== 'image_grounded'), 'R8 tank details should not claim image-grounded status from bbox-only evidence');

  const report = JSON.parse(await fs.readFile(path.join(base, 'proposal-qa-r8-geometry', 'geometry-fit-report.json'), 'utf8'));
  assert.equal(report.verdict, 'review', 'R8 GeometryFit should remain review-gated rather than photo-grade pass');
  assert.equal(report.summary.structural_grounding_issues, 0, 'R8 structural grounding gates should pass on the repaired model');
  assert.equal(report.summary.floating_roof_features, 0, 'R8 GeometryFit should report no floating roof features after roof-surface binding');
  assert.equal(report.structural_grounding.site_region_fit.internal_roads_are_polygonal, true, 'R8 GeometryFit should confirm internal roads are polygonal');
  assert.equal(report.structural_grounding.parking_layout_fit.missing_line_evidence, 0, 'R8 GeometryFit should confirm parking lines have evidence metadata');
  assert.equal(report.structural_grounding.tank_ellipse_fit.instances, 2, 'R8 GeometryFit should confirm two tank ellipse instances');
  assert.equal(report.summary.dense_detail_helper_ratio < 0.75, true, 'R8 helper ratio should drop after disabling vehicle fillers and grounding structural details');
  assert.ok(report.correction_suggestions.some((suggestion) => suggestion.action === 'add_image_evidence_or_exclude_from_photo_grade'), 'R8 report should still warn against photo-grade claims for helper-heavy dense detail');

  const badOutput = JSON.parse(JSON.stringify(output));
  const badSeam = badOutput.operations.find((operation) => operation.qa?.role === 'roof_panel_seam');
  badSeam.qa.roof_surface_fit.surface_distance_mm = 320;
  badSeam.qa.projection_residuals.surface_distance_mm = 320;
  const badReport = await validateGeometryFit({
    observations: JSON.parse(await fs.readFile(path.join(base, 'observations.json'), 'utf8')),
    fixture: JSON.parse(await fs.readFile(path.join(base, 'visual-relations.r8-geometry.fixture.json'), 'utf8')),
    code: JSON.stringify(badOutput),
    mockSessionPath: path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'validate-r8-floating-roof-feature-session.json')
  });
  assert.equal(badReport.issues.some((issue) => issue.type === 'geometry_fit.floating_roof_feature'), true, 'GeometryFit should fail a deliberately floating R8 roof seam');
  return true;
}

function assertEvidenceAnnotations(modelPlan, label) {
  assert.ok(modelPlan.review.evidence_summary, `${label} should contain an evidence summary`);
  assert.ok(modelPlan.review.evidence_summary.status_counts, `${label} should contain evidence status counts`);
  assert.ok(modelPlan.review.evidence_graph, `${label} should contain an evidence graph`);
  assert.ok(modelPlan.review.semantic_fusion, `${label} should contain semantic fusion`);
  assert.equal(modelPlan.review.evidence_graph.version, 1, `${label} evidence graph should be version 1`);
  assert.equal(modelPlan.review.evidence_graph.parts.length, modelPlan.parts.length, `${label} evidence graph should have one node per part`);
  assert.equal(modelPlan.review.semantic_fusion.version, 1, `${label} semantic fusion should be version 1`);
  assert.equal(modelPlan.review.semantic_fusion.parts.length, modelPlan.parts.length, `${label} semantic fusion should have one node per part`);
  assert.ok(Array.isArray(modelPlan.review.correction_suggestions), `${label} should contain correction suggestions array`);
  assert.equal(
    Object.values(modelPlan.review.evidence_summary.status_counts).reduce((sum, count) => sum + count, 0),
    modelPlan.parts.length,
    `${label} evidence status counts should match part count`
  );
  assert.equal(
    modelPlan.review.semantic_fusion.summary.confirmed + modelPlan.review.semantic_fusion.summary.partial + modelPlan.review.semantic_fusion.summary.needs_review,
    modelPlan.parts.length,
    `${label} semantic fusion counts should match part count`
  );
  for (const part of modelPlan.parts) {
    assert.ok(part.evidence_status, `${label} part ${part.id} should have evidence_status`);
    assert.equal(typeof part.template_prior, 'boolean', `${label} part ${part.id} should have template_prior boolean`);
    assert.equal(typeof part.manual_confirmed, 'boolean', `${label} part ${part.id} should have manual_confirmed boolean`);
    assert.ok(Array.isArray(part.evidence_sources), `${label} part ${part.id} should have evidence_sources`);
    assert.ok(part.evidence_sources.length > 0, `${label} part ${part.id} should have at least one evidence source`);
    assert.ok(Array.isArray(part.feature_semantics), `${label} part ${part.id} should have feature_semantics`);
    const graphPart = graphPartById(modelPlan, part.id);
    assert.equal(graphPart.status, part.evidence_status, `${label} graph part ${part.id} should mirror evidence_status`);
    assert.ok(Array.isArray(graphPart.sources), `${label} graph part ${part.id} should list evidence sources`);
    assert.ok(Array.isArray(graphPart.open_questions), `${label} graph part ${part.id} should list open questions`);
    const fusionPart = fusionPartById(modelPlan, part.id);
    assert.equal(typeof fusionPart.confidence, 'number', `${label} fusion part ${part.id} should have confidence`);
    assert.deepEqual(fusionPart.required_views, graphPart.required_views, `${label} fusion part ${part.id} should mirror required views`);
    assert.deepEqual(fusionPart.missing_views, graphPart.missing_views, `${label} fusion part ${part.id} should mirror missing views`);
    assert.ok(Array.isArray(fusionPart.semantic_evidence), `${label} fusion part ${part.id} should list semantic evidence`);
  }
}

function partById(modelPlan, id) {
  const part = modelPlan.parts.find((item) => item.id === id);
  assert.ok(part, `expected model plan part ${id}`);
  return part;
}

function graphPartById(modelPlan, id) {
  const part = modelPlan.review.evidence_graph?.parts?.find((item) => item.part_id === id);
  assert.ok(part, `expected evidence graph part ${id}`);
  return part;
}

function fusionPartById(modelPlan, id) {
  const part = modelPlan.review.semantic_fusion?.parts?.find((item) => item.part_id === id);
  assert.ok(part, `expected semantic fusion part ${id}`);
  return part;
}

function graphPartByIdFromGraph(graph, id) {
  const part = graph.parts?.find((item) => item.part_id === id);
  assert.ok(part, `expected evidence graph part ${id}`);
  return part;
}

function partGraphPartById(partGraph, id) {
  const part = partGraph.parts?.find((item) => item.id === id);
  assert.ok(part, `expected PartGraph part ${id}`);
  return part;
}

function assertVisualRelationEvidence(partGraph, expected, label) {
  const relation = (partGraph.evidence_graph?.visual_relations || []).find((candidate) => (
    candidate.type === expected.type
    && candidate.subject === expected.subject
    && candidate.target === expected.target
  ));
  assert.ok(relation, label);
  assert.ok(relation.confidence >= (expected.min_confidence || 0.35), `${label} should meet confidence floor`);
  return relation;
}

function countBy(items, key) {
  const result = {};
  for (const item of items || []) {
    const value = item[key];
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function partPromotedForGeometry(part) {
  return part.promoted_geometry === true
    || part.qa?.promoted_geometry === true
    || part.grounding_decision === 'promoted_geometry'
    || (part.evidence_status === 'manual_confirmed' && part.fallback_state !== 'needs_review');
}

function operationByName(dsl, name) {
  const operation = dsl.operations.find((item) => item.name === name);
  assert.ok(operation, `expected DSL operation ${name}`);
  return operation;
}

function readEmbeddedJson(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<script id="${escapedId}" type="application/json">([\\s\\S]*?)</script>`));
  assert.ok(match, `expected embedded JSON script ${id}`);
  return JSON.parse(match[1]);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function compileSchema(schema) {
  const validate = (value) => {
    const errors = [];
    validateSchema(schema, value, schema, '$', errors);
    validate.errors = errors;
    return errors.length === 0;
  };
  validate.errors = [];
  return validate;
}

function validateSchema(schema, value, root, pathLabel, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    let resolved;
    try {
      resolved = resolveRef(root, schema.$ref);
    } catch (error) {
      errors.push(`${pathLabel} has unsupported schema ref ${schema.$ref}: ${error.message}`);
      return;
    }
    if (resolved === undefined) {
      errors.push(`${pathLabel} has unresolved schema ref ${schema.$ref}`);
      return;
    }
    return validateSchema(resolved, value, root, pathLabel, errors);
  }
  for (const itemSchema of schema.allOf || []) {
    validateSchema(itemSchema, value, root, pathLabel, errors);
  }
  if (schema.if) {
    const conditionErrors = [];
    validateSchema(schema.if, value, root, pathLabel, conditionErrors);
    if (conditionErrors.length === 0 && schema.then) validateSchema(schema.then, value, root, pathLabel, errors);
    if (conditionErrors.length > 0 && schema.else) validateSchema(schema.else, value, root, pathLabel, errors);
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${pathLabel} must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathLabel} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${pathLabel} must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`);
    return;
  }
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${pathLabel} must contain at least ${schema.minLength} characters`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${pathLabel} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${pathLabel} must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${pathLabel} must be > ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${pathLabel} must contain at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${pathLabel} must contain at most ${schema.maxItems} items`);
    if (schema.prefixItems) {
      schema.prefixItems.forEach((itemSchema, index) => {
        if (index < value.length) validateSchema(itemSchema, value[index], root, `${pathLabel}[${index}]`, errors);
      });
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(schema.items, item, root, `${pathLabel}[${index}]`, errors));
    }
    if (schema.contains) {
      const hasMatch = value.some((item, index) => {
        const containsErrors = [];
        validateSchema(schema.contains, item, root, `${pathLabel}[${index}]`, containsErrors);
        return containsErrors.length === 0;
      });
      if (!hasMatch) errors.push(`${pathLabel} must contain an item matching ${describeContainsSchema(schema.contains)}`);
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${pathLabel}.${key} is required`);
    }
    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined) validateSchema(propertySchema, value[key], root, `${pathLabel}.${key}`, errors);
    }
  }
}

function assertSemanticReviewItemHasEvidenceInstance(patch, role, message) {
  const item = (patch?.review_items || []).find((reviewItem) => reviewItem.id === `semantic_candidate:${role}`);
  assert.ok(item, `${message}: missing review item`);
  const instances = item.current_value?.evidence_instances || [];
  assert.ok(instances.length > 0, `${message}: missing evidence instances`);
  assert.ok(
    instances.some((instance) => Array.isArray(instance.bbox_px) && instance.bbox_px.length === 4 && instance.bbox_px.every((value) => Number.isFinite(value))),
    `${message}: missing bbox_px`
  );
  assert.ok(instances.some((instance) => instance.source_image && instance.source_id), `${message}: missing source provenance`);
  assert.ok(instances.some((instance) => instance.view && instance.view !== 'unknown'), `${message}: missing view label`);
  assert.ok(instances.every((instance) => instance.review_required === true), `${message}: semantic instances should remain review-required`);
}

function assertVisionEvidenceWorkspaceInstance(visionEvidence, role, message) {
  assert.ok(hasVisionEvidenceWorkspaceInstance(visionEvidence, role), message);
}

function hasVisionEvidenceWorkspaceInstance(visionEvidence, role) {
  return (visionEvidence?.semantic_evidence_instances || []).some((instance) => {
    return instance.role === role
      && Array.isArray(instance.bbox_px)
      && instance.bbox_px.length === 4
      && instance.bbox_px.every((value) => Number.isFinite(value))
      && instance.source_image
      && instance.source_id
      && instance.view
      && instance.view !== 'unknown'
      && instance.review_required === true;
  });
}

function assertVisionEvidenceModelingHandoff(visionEvidence, role, blockedInterpretation, message) {
  assert.ok(hasVisionEvidenceModelingHandoff(visionEvidence, role, blockedInterpretation), message);
}

function hasVisionEvidenceModelingHandoff(visionEvidence, role, blockedInterpretation) {
  return (visionEvidence?.modeling_handoff || []).some((item) => {
    return item.role === role
      && item.review_required === true
      && item.geometry_promotion_allowed === false
      && item.primary_instance
      && Array.isArray(item.primary_instance.bbox_px)
      && item.primary_instance.bbox_px.length === 4
      && item.primary_instance.source_id
      && (item.blocked_interpretations || []).includes(blockedInterpretation);
  });
}

function assertMcpModelingConstraintRole(brief, role, blockedInterpretation, message) {
  const summary = brief?.modeling_constraint_summary;
  assert.ok(summary, `${message}: missing modeling_constraint_summary`);
  assert.ok(summary.review_required_roles.includes(role), `${message}: missing review role ${role}`);
  assert.ok(summary.blocked_interpretations.includes(blockedInterpretation), `${message}: missing summary blocked interpretation ${blockedInterpretation}`);
  const constraint = (summary.constraints || []).find((item) => item.role === role);
  assert.ok(constraint, `${message}: missing role constraint`);
  assert.equal(constraint.review_required, true, `${message}: role should remain review-required`);
  assert.equal(constraint.geometry_promotion_allowed, false, `${message}: role should not allow geometry promotion`);
  assert.ok(constraint.blocked_interpretations.includes(blockedInterpretation), `${message}: role constraint missing blocked interpretation`);
  assert.ok(constraint.required_confirmations.length > 0, `${message}: role constraint should require confirmations`);
  if (['visible_plane_recessed_left', 'rectangular_utility_ducts', 'shadow_or_recess_boundary'].includes(role)) {
    assert.ok(summary.critical_roles.includes(role), `${message}: missing critical role ${role}`);
    assert.equal(constraint.priority, 'critical', `${message}: critical role should be prioritized`);
  }
}

function describeContainsSchema(schema) {
  const constProperties = Object.entries(schema.properties || {})
    .filter(([, propertySchema]) => propertySchema?.const !== undefined)
    .map(([key, propertySchema]) => `${key}=${JSON.stringify(propertySchema.const)}`);
  return constProperties.length > 0 ? constProperties.join(', ') : 'contains schema';
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported schema ref: ${ref}`);
  return ref.slice(2)
    .split('/')
    .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, key) => current?.[key], root);
}

function matchesType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => {
    if (item === 'array') return Array.isArray(value);
    if (item === 'integer') return Number.isInteger(value);
    if (item === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (item === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (item === 'null') return value === null;
    return typeof value === item;
  });
}
