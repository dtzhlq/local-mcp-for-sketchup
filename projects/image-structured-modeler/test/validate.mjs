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
import { applyCorrectionPatch, buildCorrectionPatchFromParameterProposals, buildCorrectionPatchFromReferenceReport } from '../scripts/lib/part-graph-corrections.mjs';
import { evaluateDiffWarningBudget, evaluateSnapshotWarningBudget } from '../scripts/lib/warning-budget.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const subprojectRoot = path.join(repoRoot, 'projects', 'image-structured-modeler');

const modelPlanSchema = await readJson('schema/model-plan.schema.json');
const imageObservationSchema = await readJson('schema/image-observation.schema.json');
const imageSetObservationSchema = await readJson('schema/image-set-observation.schema.json');
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
  'scripts/validate-part-graph-quality.mjs',
  'scripts/compile-plan-to-sketchup-dsl.mjs',
  'scripts/make-snapshot-report.mjs',
  'scripts/lib/part-graph-corrections.mjs',
  'scripts/lib/warning-budget.mjs',
  'scripts/lib/image-analysis.mjs'
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
await assertFeatureMappingCorrectionRegression();
await assertSingleImageEvidenceDowngrade();
const remoteChecked = await assertCompactRemoteSample();
const ambulanceEvidenceChecked = await assertAmbulancePartGraphEvidenceSample();
const buildingGroupChecked = await assertBuildingGroupObservationSample();

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
    feature_mapping_regression: true,
    compact_remote_sample: remoteChecked,
    ambulance_part_graph_evidence: ambulanceEvidenceChecked,
    building_group_observation_sample: buildingGroupChecked,
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

function stripCollectionOnlyFields(observation) {
  const clone = structuredClone(observation);
  delete clone.metrics;
  return clone;
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
  assert.ok(observations.scale_calibration.default_scale.width >= 500000, 'building group scale calibration should use campus-scale defaults in mm');
  assert.ok(observations.scale_calibration.measurements.some((measurement) => measurement.view === 'top'), 'building group scale calibration should include a top-view measurement');
  assert.ok(observations.evidence_graph.part_matches.length >= 8, 'building group evidence graph should expose campus component matches');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'primary_blue_roof_hall').missing_views, [], 'primary blue-roof hall should have top and oblique evidence');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'tank_farm').missing_views, [], 'tank farm should have top and oblique evidence');
  assert.deepEqual(graphPartByIdFromGraph(observations.evidence_graph, 'parking_lot').missing_views, [], 'parking lot should have top evidence');

  const topObservation = observations.images.find((image) => image.detected_view.kind === 'top');
  assert.ok(topObservation, 'building group observations should contain the hinted top view');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'primary_blue_roof_hall'), 'top view should include the blue-roof hall candidate');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'warehouse_row_west'), 'top view should include the west warehouse row candidate');
  assert.ok(topObservation.observations.some((item) => item.component_hint === 'internal_roads'), 'top view should include internal road candidates');
  assert.ok(topObservation.orientation_hints.semantic_anchors.some((anchor) => anchor.id === 'building-blue-hall-east-of-warehouses'), 'top view should retain a campus orientation anchor');
  assert.equal(topObservation.orientation_hints.review_required, true, 'top-view campus orientation should remain review-gated until north/up is confirmed');

  for (const observation of observations.images) {
    assertValid(validateImageObservation, stripCollectionOnlyFields(observation), `${observation.image.path} image observation`);
  }

  const overlays = await fs.readdir(path.join(base, 'review-overlays'));
  assert.equal(overlays.filter((name) => name.endsWith('-overlay.png')).length, 3, 'building group review overlays should cover all source images');
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
