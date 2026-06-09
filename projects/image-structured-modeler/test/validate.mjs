#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphPhysicalConsistency } from '../../../src/product-modeling/physical-consistency-qa.mjs';
import { compilePlanToSketchUpDsl } from '../scripts/compile-plan-to-sketchup-dsl.mjs';
import { generateModelPlan } from '../scripts/generate-model-plan.mjs';
import { generatePartGraphFromObservations } from '../scripts/generate-part-graph-from-observations.mjs';
import { applyCorrectionPatch, buildCorrectionPatchFromParameterProposals, buildCorrectionPatchFromReferenceReport } from '../scripts/lib/part-graph-corrections.mjs';
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
const autoGroundPlanR10Schema = await readJson('schema/auto-ground-plan-r10.schema.json');
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
const validateAutoGroundPlanR10Schema = compileSchema(autoGroundPlanR10Schema);
const validateManualCorrections = compileSchema(manualCorrectionsSchema);
const validatePartGraph = compileSchema(partGraphSchema);
const validatePartGraphCorrectionPatch = compileSchema(partGraphCorrectionPatchSchema);

const modelPlanExample = await readJson('examples/switch-controller/model-plan.example.json');
assertValid(validateModelPlan, modelPlanExample, 'switch controller model-plan.example.json');

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
  'scripts/lib/auto-ground-plan-r10.mjs',
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
  const boundaryReport = boundaryGraphReport(observations.boundary_graph_v1);
  assert.equal(boundaryReport.kind, 'boundary_graph_v1_report', 'BoundaryGraph should emit a v1 report');
  assert.equal(boundaryReport.ok, true, 'BoundaryGraph current building-group report should be usable');
  assert.equal(boundaryReport.summary.source_image_backend, 'source_image_edge_detector_v1', 'BoundaryGraph should use source-image raster edges for the current building-group');
  assert.equal(boundaryReport.summary.high_contrast_edge_available, true, 'BoundaryGraph should consume HighContrastEdge evidence when present');
  assert.ok(boundaryReport.summary.high_contrast_boundary_edge_count >= 4, 'BoundaryGraph should include accepted HighContrastEdge boundary edges');
  assert.equal(boundaryReport.summary.opencv_edge_available, true, 'BoundaryGraph should consume real OpenCV edge evidence when present');
  assert.ok(boundaryReport.summary.opencv_boundary_edge_count >= 4, 'BoundaryGraph should include accepted OpenCV boundary edges');
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
  assert.ok(bodyShapeProposal.proposed_value.size[0] > skeletonBody.shape.parameters.size[0], 'no-seed body proposal should be a usable scale-based candidate, not the tiny skeleton placeholder');

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
  assert.ok(photorealOutput.operations.every((operation) => operation.op !== 'image_plane' || path.isAbsolute(operation.image)), 'compiled graph operation image planes should resolve texture paths for live SketchUp');
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

function operationByName(dsl, name) {
  const operation = dsl.operations.find((item) => item.name === name);
  assert.ok(operation, `expected DSL operation ${name}`);
  return operation;
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
    return validateSchema(resolveRef(root, schema.$ref), value, root, pathLabel, errors);
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

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported schema ref: ${ref}`);
  return ref.slice(2).split('/').reduce((current, key) => current?.[key], root);
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
