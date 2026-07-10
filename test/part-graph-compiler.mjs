import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { materializeDslAssetPaths } from '../src/dsl-asset-paths.mjs';
import { compilePartGraphFiles, compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';
import {
  compileParametricRecipe,
  compileParametricRecipeCandidate,
  compileParametricRecipeFirstOutput
} from '../src/product-modeling/parametric-recipe.mjs';
import { validatePartGraphPhysicalConsistency } from '../src/product-modeling/physical-consistency-qa.mjs';

const repoRoot = process.cwd();
const profilePath = 'examples/product-profiles/vehicle_ambulance.json';
const partGraphPath = 'examples/part-graphs/ambulance-reference.part-graph.json';
const outputPath = 'examples/acceptance-ambulance-reference.json';
const switchProfilePath = 'examples/product-profiles/game_controller_switch.json';
const switchPartGraphPath = 'examples/part-graphs/switch-controller-reference.part-graph.json';
const switchOutputPath = 'examples/acceptance-switch-controller.json';
const cameraProfilePath = 'examples/product-profiles/camera_fuji_x_t10.json';
const cameraPartGraphPath = 'examples/part-graphs/fuji-camera-reference.part-graph.json';
const cameraOutputPath = 'examples/acceptance-fuji-camera.json';
const parametricRecipePath = 'examples/parametric-recipes/switch-thumbstick-variants.parametric-recipe.json';
const featureMappingPlanPath = 'examples/feature-mapping-plans/switch-thumbstick-variants.feature-mapping-plan.json';
const parametricRecipePatchPath = 'examples/parametric-recipes/switch-thumbstick-variants.baseline.part-graph-correction-patch.json';
const buildingProfilePath = 'examples/product-profiles/building_group_industrial_campus.json';
const buildingPartGraphPath = 'projects/image-structured-modeler/examples/building-group/part-graph.massing.json';
const buildingOutputPath = 'projects/image-structured-modeler/examples/building-group/output.massing.json';
const buildingSingleProfilePath = 'examples/product-profiles/building_single_urban_oblique.json';
const buildingSinglePartGraphPath = 'projects/image-structured-modeler/examples/building-single-anime-yellow/part-graph.cropped.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const productProfileSchema = JSON.parse(await fs.readFile('schema/product-profile.schema.json', 'utf8'));
const partGraphSchema = JSON.parse(await fs.readFile('schema/part-graph.schema.json', 'utf8'));
const parametricRecipeSchema = JSON.parse(await fs.readFile('schema/parametric-recipe.schema.json', 'utf8'));
const correctionPatchSchema = JSON.parse(await fs.readFile('schema/part-graph-correction-patch.schema.json', 'utf8'));
const validateProfile = ajv.compile(productProfileSchema);
const validatePartGraph = ajv.compile(partGraphSchema);
const validateParametricRecipe = ajv.compile(parametricRecipeSchema);
const validateCorrectionPatch = ajv.compile(correctionPatchSchema);

const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
const partGraph = JSON.parse(await fs.readFile(partGraphPath, 'utf8'));
assertValid(validateProfile, profile, profilePath);
assertValid(validatePartGraph, partGraph, partGraphPath);
const switchProfile = JSON.parse(await fs.readFile(switchProfilePath, 'utf8'));
const switchPartGraph = JSON.parse(await fs.readFile(switchPartGraphPath, 'utf8'));
assertValid(validateProfile, switchProfile, switchProfilePath);
assertValid(validatePartGraph, switchPartGraph, switchPartGraphPath);
const parametricRecipe = JSON.parse(await fs.readFile(parametricRecipePath, 'utf8'));
const expectedFeatureMappingPlan = JSON.parse(await fs.readFile(featureMappingPlanPath, 'utf8'));
const expectedParametricRecipePatch = JSON.parse(await fs.readFile(parametricRecipePatchPath, 'utf8'));
assertValid(validateParametricRecipe, parametricRecipe, parametricRecipePath);
const cameraProfile = JSON.parse(await fs.readFile(cameraProfilePath, 'utf8'));
const cameraPartGraph = JSON.parse(await fs.readFile(cameraPartGraphPath, 'utf8'));
assertValid(validateProfile, cameraProfile, cameraProfilePath);
assertValid(validatePartGraph, cameraPartGraph, cameraPartGraphPath);
const buildingProfile = JSON.parse(await fs.readFile(buildingProfilePath, 'utf8'));
const buildingPartGraph = JSON.parse(await fs.readFile(buildingPartGraphPath, 'utf8'));
assertValid(validateProfile, buildingProfile, buildingProfilePath);
assertValid(validatePartGraph, buildingPartGraph, buildingPartGraphPath);
const buildingSingleProfile = JSON.parse(await fs.readFile(buildingSingleProfilePath, 'utf8'));
const buildingSinglePartGraph = JSON.parse(await fs.readFile(buildingSinglePartGraphPath, 'utf8'));
assertValid(validateProfile, buildingSingleProfile, buildingSingleProfilePath);
assertValid(validatePartGraph, buildingSinglePartGraph, buildingSinglePartGraphPath);

assertPhysicalGate(partGraph, 'ambulance', 24);
assertPhysicalGate(switchPartGraph, 'Switch controller', 24);
const cameraPhysicalReport = assertPhysicalGate(cameraPartGraph, 'Fuji camera', 30);
assert.equal(cameraPhysicalReport.summary.checked_relations, 30, 'Fuji camera should cover visible detail attachments in physical QA');
for (const partId of [
  'fuji-rear-eyepiece',
  'fuji-left-dial-index-mark',
  'fuji-right-dial-index-mark',
  'fuji-shutter-button',
  'fuji-lens-zoom-ring-rear',
  'fuji-lens-focus-ring-front',
  'fuji-lens-cap-left-pinch',
  'fuji-lens-cap-right-pinch',
  'fuji-lens-cap-logo-bar',
  'fuji-left-strap-lug',
  'fuji-right-strap-lug',
  'fuji-rear-menu-button',
  'fuji-rear-play-button',
  'fuji-rear-back-button'
]) {
  assertPhysicalRelationSubject(cameraPartGraph, partId, 'Fuji camera visible details should not bypass physical QA');
}

const driftedAmbulancePartGraph = deepClone(partGraph);
partById(driftedAmbulancePartGraph, 'amb-left-side-window').shape.parameters.origin[1] -= 30;
const driftedAmbulancePhysicalReport = validatePartGraphPhysicalConsistency(driftedAmbulancePartGraph);
assert.equal(driftedAmbulancePhysicalReport.ok, false, 'physical consistency should fail when an ambulance side window floats away from the body');
assert.ok(driftedAmbulancePhysicalReport.issues.some((issue) => issue.type === 'physical.face_contact_gap' && issue.item === 'amb-left-side-window'), 'physical consistency should report the ambulance side window contact gap');
assert.ok(driftedAmbulancePhysicalReport.correction_suggestions.some((suggestion) => suggestion.action === 'update_part_graph' && suggestion.target === 'parts[amb-left-side-window].shape.parameters.origin'), 'physical consistency should suggest an ambulance PartGraph origin correction');

const driftedSwitchPartGraph = deepClone(switchPartGraph);
partById(driftedSwitchPartGraph, 'left-analog-stick-top-pad').shape.parameters.origin[2] += 8;
const driftedSwitchPhysicalReport = validatePartGraphPhysicalConsistency(driftedSwitchPartGraph);
assert.equal(driftedSwitchPhysicalReport.ok, false, 'physical consistency should fail when a Switch thumbstick cap lifts off its stem');
assert.ok(driftedSwitchPhysicalReport.issues.some((issue) => issue.type === 'physical.face_contact_gap' && issue.item === 'left-analog-stick-top-pad'), 'physical consistency should report the Switch thumbstick support gap');
assert.ok(driftedSwitchPhysicalReport.correction_suggestions.some((suggestion) => suggestion.action === 'update_part_graph' && suggestion.target === 'parts[left-analog-stick-top-pad].shape.parameters.origin'), 'physical consistency should suggest a Switch PartGraph origin correction');

const driftedCameraPartGraph = deepClone(cameraPartGraph);
partById(driftedCameraPartGraph, 'fuji-lens-front-barrel').shape.parameters.origin[1] -= 12;
const driftedCameraPhysicalReport = validatePartGraphPhysicalConsistency(driftedCameraPartGraph);
assert.equal(driftedCameraPhysicalReport.ok, false, 'physical consistency should fail when a lens segment floats away from its support');
assert.ok(driftedCameraPhysicalReport.issues.some((issue) => issue.type === 'physical.face_contact_gap' && issue.item === 'fuji-lens-front-barrel'), 'physical consistency should report the lens contact gap');
assert.ok(driftedCameraPhysicalReport.correction_suggestions.some((suggestion) => suggestion.action === 'update_part_graph' && suggestion.target === 'parts[fuji-lens-front-barrel].shape.parameters.origin'), 'physical consistency should suggest a PartGraph origin correction');

const driftedCameraDetailPartGraph = deepClone(cameraPartGraph);
partById(driftedCameraDetailPartGraph, 'fuji-rear-menu-button').shape.parameters.origin[1] += 12;
const driftedCameraDetailPhysicalReport = validatePartGraphPhysicalConsistency(driftedCameraDetailPartGraph);
assert.equal(driftedCameraDetailPhysicalReport.ok, false, 'physical consistency should fail when a small Fuji detail button floats away from the body');
assert.ok(driftedCameraDetailPhysicalReport.issues.some((issue) => issue.type === 'physical.face_contact_gap' && issue.item === 'fuji-rear-menu-button'), 'physical consistency should report the small Fuji detail button contact gap');
assert.ok(driftedCameraDetailPhysicalReport.correction_suggestions.some((suggestion) => suggestion.action === 'update_part_graph' && suggestion.target === 'parts[fuji-rear-menu-button].shape.parameters.origin'), 'physical consistency should suggest a Fuji detail PartGraph origin correction');

const { featureMappingPlan, report: parametricRecipeReport } = compileParametricRecipe(parametricRecipe, { partGraph: switchPartGraph });
assert.deepEqual(featureMappingPlan, expectedFeatureMappingPlan, 'parametric recipe should compile into the reviewed static FeatureMappingPlan artifact');
assert.equal(parametricRecipeReport.ok, true, 'parametric recipe compile report should pass');
assert.equal(parametricRecipeReport.report_shape, 'parametric_recipe_compile_report_v1', 'parametric recipe report should expose the first-output report shape');
assert.equal(parametricRecipeReport.downstream_target_kind, 'part_graph', 'parametric recipe report should preserve the declared downstream target');
assert.equal(parametricRecipeReport.summary.first_output_candidate, 'baseline', 'batch fanout should require a reviewed first output candidate');
assert.deepEqual(
  parametricRecipeReport.summary.execution_order,
  [
    'left_thumbstick_recess',
    'right_thumbstick_recess',
    'left_thumbstick_stack_alignment',
    'right_thumbstick_stack_alignment'
  ],
  'parametric recipe graph should topologically order dependencies'
);

const missingFirstOutputRecipe = deepClone(parametricRecipe);
delete missingFirstOutputRecipe.compile.batch.first_output;
assert.throws(
  () => compileParametricRecipe(missingFirstOutputRecipe, { partGraph: switchPartGraph }),
  /batch\.first_output is required/,
  'batch fanout must fail closed when first-output discipline is missing'
);

const recipeFirstOutput = compileParametricRecipeFirstOutput(parametricRecipe, {
  partGraph: switchPartGraph,
  profile: switchProfile,
  compilePartGraphToSketchUpDsl,
  compileOptions: { repoRoot }
});
assert.deepEqual(recipeFirstOutput.featureMappingPlan, expectedFeatureMappingPlan, 'first-output runner should emit the reviewed FeatureMappingPlan artifact');
assert.deepEqual(recipeFirstOutput.partGraphPatch, expectedParametricRecipePatch, 'first-output runner should emit the reviewed PartGraph correction patch fixture');
assertValid(validateCorrectionPatch, recipeFirstOutput.partGraphPatch, parametricRecipePatchPath);
assertValid(validatePartGraph, recipeFirstOutput.appliedPartGraph, 'ParametricRecipe applied Switch PartGraph');
assert.equal(recipeFirstOutput.report.summary.patch_edits, 4, 'baseline first output should patch reviewed feature intents and supported shape parameter bindings');
assert.equal(recipeFirstOutput.report.summary.skipped_bindings, 2, 'baseline first output should skip only no-op pad lift bindings');
assert.deepEqual(recipeFirstOutput.report.summary.emitted_artifacts, [
  'feature_mapping_plan',
  'compile_report',
  'part_graph_correction_patch',
  'part_graph',
  'safe_json_dsl'
]);
assert.equal(partById(recipeFirstOutput.appliedPartGraph, 'left-analog-stick-groove-ring').shape.parameters.segments, 24, 'applied baseline PartGraph should update left thumbstick ring segments');
assert.equal(partById(recipeFirstOutput.appliedPartGraph, 'right-analog-stick-groove-ring').shape.parameters.segments, 24, 'applied baseline PartGraph should update right thumbstick ring segments');
assert.equal(partById(recipeFirstOutput.appliedPartGraph, 'left-warm-white-joy-con-shell').feature_intents[0].operation, 'cut_recess', 'applied baseline PartGraph should promote the left thumbstick recess feature intent');
assert.equal(partById(recipeFirstOutput.appliedPartGraph, 'right-warm-white-joy-con-shell').feature_intents[0].parameters.depth, 2.4, 'applied baseline PartGraph should promote the right thumbstick recess depth parameter');
assert.equal(operationById(recipeFirstOutput.safeJsonDsl, 'left-analog-stick-groove-ring').segments, 24, 'safe JSON DSL should compile the left thumbstick ring segment variation');
assert.equal(operationById(recipeFirstOutput.safeJsonDsl, 'right-analog-stick-groove-ring').segments, 24, 'safe JSON DSL should compile the right thumbstick ring segment variation');
assert.equal(operationByFeatureId(recipeFirstOutput.safeJsonDsl, 'left-thumbstick-recess-feature').op, 'cut_recess', 'safe JSON DSL should compile the left thumbstick recess feature intent');
assert.equal(operationByFeatureId(recipeFirstOutput.safeJsonDsl, 'right-thumbstick-recess-feature').depth, 2.4, 'safe JSON DSL should compile the right thumbstick recess depth');
const recipeMockSessionPath = path.join(repoRoot, 'output', 'product-modeling', 'sessions', 'parametric-recipe-mock.json');
await fs.mkdir(path.dirname(recipeMockSessionPath), { recursive: true });
const recipeBridge = new SketchUpBridge({ mock: { sessionPath: recipeMockSessionPath } });
const recipeBuild = await recipeBridge.build_model({ runtime: 'mock', code: JSON.stringify(recipeFirstOutput.safeJsonDsl) });
assert.equal(recipeBuild.snapshot.warning_summary.by_severity.error, 0, 'ParametricRecipe safe JSON DSL should build cleanly in mock runtime');
assert.ok(
  snapshotGroupById(recipeBuild.snapshot, 'left-warm-white-joy-con-shell').features.some((feature) => feature.id === 'left-thumbstick-recess-feature'),
  'mock snapshot should include the promoted left thumbstick recess feature'
);
assert.throws(
  () => compileParametricRecipeCandidate(parametricRecipe, { candidateId: 'taller_pad', partGraph: switchPartGraph }),
  /requires a passing first-output report/,
  'fanout candidates must require a first-output report before compiling'
);
const tallerPadCandidate = compileParametricRecipeCandidate(parametricRecipe, {
  candidateId: 'taller_pad',
  firstOutputReport: recipeFirstOutput.report,
  partGraph: switchPartGraph,
  profile: switchProfile,
  compilePartGraphToSketchUpDsl,
  compileOptions: { repoRoot }
});
assert.equal(partById(tallerPadCandidate.appliedPartGraph, 'left-analog-stick-top-pad').shape.parameters.origin[2], 33.3, 'fanout candidate should apply reviewed left pad lift after first-output report');
assert.equal(partById(tallerPadCandidate.appliedPartGraph, 'right-analog-stick-top-pad').shape.parameters.origin[2], 33.3, 'fanout candidate should apply reviewed right pad lift after first-output report');
assert.equal(operationById(tallerPadCandidate.safeJsonDsl, 'left-analog-stick-top-pad').origin[2], 33.3, 'fanout candidate should compile left pad lift into safe JSON DSL');
assert.equal(operationByFeatureId(tallerPadCandidate.safeJsonDsl, 'left-thumbstick-recess-feature').depth, 2.4, 'fanout candidate should retain reviewed feature intent promotion');

const document = await compilePartGraphFiles({ profilePath, partGraphPath, repoRoot });
assert.equal(document.version, 1);
assert.equal(document.units, 'mm');
assert.equal(document.metadata.source, 'part_graph_compiler');
assert.equal(document.metadata.profile_id, 'vehicle_ambulance');
assert.equal(document.operations.length, 104);
assert.equal(document.operations.filter((operation) => operation.op === 'cut_recess').length, 7);
assert.equal(document.operations.filter((operation) => operation.op === 'add_boss').length, 3);
assert.equal(document.operations.filter((operation) => operation.op === 'add_raised_rib').length, 3);
assert.ok(document.operations.some((operation) => operation.op === 'boolean_difference'), 'compiled DSL should keep the roof panel boolean');

const generated = JSON.parse(await fs.readFile(outputPath, 'utf8'));
assert.deepEqual(generated, document, 'acceptance ambulance JSON should be generated from the part graph compiler');

const mainBodyOp = operationById(document, 'amb-main-body');
assert.equal(mainBodyOp.qa.part_id, 'amb-main-body');
assert.equal(mainBodyOp.qa.role, 'body');
assert.equal(mainBodyOp.qa.fallback_state, 'real_feature_op');
assert.ok(mainBodyOp.qa.feature_intents.some((feature) => feature.operation === 'cut_recess'));

const stripeOp = operationById(document, 'amb-left-red-stripe');
assert.equal(stripeOp.qa.part_id, 'amb-left-red-stripe');
assert.equal(stripeOp.qa.fallback_state, 'visual_helper');

const referenceOp = operationById(document, 'ambulance-side-reference');
assert.equal(referenceOp.qa.role, 'reference_image');
assert.equal(path.isAbsolute(referenceOp.image), false, 'compiled reference image paths should stay portable inside repo artifacts');
assert.equal(referenceOp.image, 'test/救护车/AD967E86-6C30-4740-BB2F-0650387D4936_1_102_o.jpeg');
const queueReadyDocument = materializeDslAssetPaths(document, { repoRoot });
const queueReadyReferenceOp = operationById(queueReadyDocument, 'ambulance-side-reference');
assert.equal(path.isAbsolute(queueReadyReferenceOp.image), true, 'queue runtime should materialize repo-relative reference paths before SketchUp execution');
await fs.access(queueReadyReferenceOp.image);

const mockSessionPath = path.join(repoRoot, 'output', 'product-modeling', 'sessions', 'part-graph-compiler-mock.json');
await fs.mkdir(path.dirname(mockSessionPath), { recursive: true });
const bridge = new SketchUpBridge({ mock: { sessionPath: mockSessionPath } });
const build = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(document) });
assert.equal(build.snapshot.totals.groups, 57, 'compiled ambulance should keep current group count');
assert.equal(build.snapshot.scenes.length, 2, 'compiled ambulance should keep review scenes');
assert.equal(build.snapshot.warning_summary.by_severity.error, 0);

const mainBodySnapshot = snapshotGroupById(build.snapshot, 'amb-main-body');
assert.equal(mainBodySnapshot.qa.part_id, 'amb-main-body');
assert.equal(mainBodySnapshot.qa.evidence_status, 'manual_confirmed');
assert.equal(mainBodySnapshot.features.length, 10, 'main body should carry feature intent metadata after feature ops');

const stripeSnapshot = snapshotGroupById(build.snapshot, 'amb-left-red-stripe');
assert.equal(stripeSnapshot.qa.part_id, 'amb-left-red-stripe', 'box primitive should preserve part graph QA metadata');

const tireSnapshot = snapshotGroupById(build.snapshot, 'wheel-left-front-tire');
assert.equal(tireSnapshot.qa.part_id, 'wheel-left-front-tire', 'prism primitive should preserve part graph QA metadata');

const spec = JSON.parse(await fs.readFile('examples/model-qa/ambulance-reference.json', 'utf8'));
const layoutReport = await bridge.validate_model({
  code: JSON.stringify(document),
  runtime: 'mock',
  spec,
  includePreview: false
});
assert.equal(layoutReport.ok, true);
assert.equal(layoutReport.verdict, 'pass');
assert.equal(layoutReport.summary.total, 0);

const switchDocument = await compilePartGraphFiles({ profilePath: switchProfilePath, partGraphPath: switchPartGraphPath, repoRoot });
assert.equal(switchDocument.version, 1);
assert.equal(switchDocument.units, 'mm');
assert.equal(switchDocument.metadata.profile_id, 'game_controller_switch');
assert.equal(switchDocument.operations.length, 88);
assert.equal(switchDocument.operations.filter((operation) => operation.op === 'rounded_box').length, 14);
assert.equal(switchDocument.operations.filter((operation) => operation.op === 'cylinder').length, 23);
assert.equal(switchDocument.operations.filter((operation) => operation.op === 'text_3d').length, 4);
const generatedSwitch = JSON.parse(await fs.readFile(switchOutputPath, 'utf8'));
assert.deepEqual(generatedSwitch, switchDocument, 'acceptance switch JSON should be generated from the part graph compiler');

const switchBuild = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(switchDocument) });
assert.equal(switchBuild.snapshot.totals.groups, 70, 'compiled Switch controller should keep current group count');
assert.equal(switchBuild.snapshot.scenes.length, 5, 'compiled Switch controller should keep review scenes');
assert.equal(switchBuild.snapshot.warning_summary.by_severity.error, 0);

const switchGrip = operationById(switchDocument, 'center-black-switch-grip');
assert.equal(switchGrip.qa.part_id, 'center-black-switch-grip');
assert.equal(switchGrip.qa.role, 'center_grip');
assert.equal(switchGrip.qa.fallback_state, 'box_approximation');

const switchThumbstick = snapshotGroupById(switchBuild.snapshot, 'left-analog-stick-top-pad');
assert.equal(switchThumbstick.qa.part_id, 'left-analog-stick-top-pad');
assert.equal(switchThumbstick.qa.fallback_state, 'visual_helper');

const switchSpec = JSON.parse(await fs.readFile('examples/model-qa/switch-controller-demo.json', 'utf8'));
const switchLayoutReport = await bridge.validate_model({
  code: JSON.stringify(switchDocument),
  runtime: 'mock',
  spec: switchSpec,
  includePreview: false
});
assert.equal(switchLayoutReport.ok, true);
assert.equal(switchLayoutReport.verdict, 'pass');
assert.equal(switchLayoutReport.summary.total, 0);

const cameraDocument = await compilePartGraphFiles({ profilePath: cameraProfilePath, partGraphPath: cameraPartGraphPath, repoRoot });
assert.equal(cameraDocument.version, 1);
assert.equal(cameraDocument.units, 'mm');
assert.equal(cameraDocument.metadata.profile_id, 'camera_fuji_x_t10');
assert.equal(cameraDocument.operations.length, 62);
assert.equal(cameraDocument.operations.filter((operation) => operation.op === 'rounded_box').length, 17);
assert.equal(cameraDocument.operations.filter((operation) => operation.op === 'prism').length, 7);
assert.equal(cameraDocument.operations.filter((operation) => operation.op === 'cylinder').length, 4);
assert.equal(cameraDocument.operations.filter((operation) => operation.op === 'cut_recess').length, 3);
assert.equal(cameraDocument.operations.filter((operation) => operation.op === 'cut_hole').length, 3);
assert.equal(cameraDocument.operations.filter((operation) => operation.op === 'cut_slot').length, 1);
assert.equal(cameraDocument.operations.filter((operation) => operation.op === 'text_3d').length, 2);
const generatedCamera = JSON.parse(await fs.readFile(cameraOutputPath, 'utf8'));
assert.deepEqual(generatedCamera, cameraDocument, 'acceptance Fuji camera JSON should be generated from the part graph compiler');

const cameraBuild = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(cameraDocument) });
assert.equal(cameraBuild.snapshot.totals.groups, 33, 'compiled Fuji camera should keep current group count');
assert.equal(cameraBuild.snapshot.totals.faces, 1221, 'compiled Fuji camera should include feature-backed camera detail topology');
assert.equal(cameraBuild.snapshot.scenes.length, 3, 'compiled Fuji camera should keep review scenes');
assert.equal(cameraBuild.snapshot.warning_summary.by_severity.error, 0);

const cameraLens = operationById(cameraDocument, 'fuji-lens-front-cap');
assert.equal(cameraLens.qa.part_id, 'fuji-lens-front-cap');
assert.equal(cameraLens.qa.role, 'lens_cap');
assert.equal(cameraLens.qa.fallback_state, 'structured_primitive');

const cameraBody = snapshotGroupById(cameraBuild.snapshot, 'fuji-body-black-lower');
assert.equal(cameraBody.qa.fallback_state, 'real_feature_op');
assert.equal(cameraBody.features.length, 2, 'camera body should carry front lens and rear screen feature intents');

const cameraBrandText = snapshotGroupById(cameraBuild.snapshot, 'fuji-front-fujifilm-text');
assert.equal(cameraBrandText.qa.part_id, 'fuji-front-fujifilm-text');
assert.equal(cameraBrandText.qa.role, 'brand_text');

const cameraCapPinch = snapshotGroupById(cameraBuild.snapshot, 'fuji-lens-cap-left-pinch');
assert.equal(cameraCapPinch.qa.role, 'lens_cap_detail');

const cameraRearButton = snapshotGroupById(cameraBuild.snapshot, 'fuji-rear-menu-button');
assert.equal(cameraRearButton.qa.role, 'rear_control_button');

const cameraSpec = JSON.parse(await fs.readFile('examples/model-qa/fuji-camera-reference.json', 'utf8'));
const cameraLayoutReport = await bridge.validate_model({
  code: JSON.stringify(cameraDocument),
  runtime: 'mock',
  spec: cameraSpec,
  includePreview: false
});
assert.equal(cameraLayoutReport.ok, true);
assert.equal(cameraLayoutReport.verdict, 'pass');
assert.equal(cameraLayoutReport.summary.total, 0);

const buildingDocument = await compilePartGraphFiles({ profilePath: buildingProfilePath, partGraphPath: buildingPartGraphPath, repoRoot });
assert.equal(buildingDocument.version, 1);
assert.equal(buildingDocument.units, 'mm');
assert.equal(buildingDocument.metadata.profile_id, 'building_group_industrial_campus');
assert.equal(buildingDocument.operations.some((operation) => ['internal_roads', 'warehouse_row_west', 'warehouse_row_inner', 'parking_lot'].includes(operation.id)), false);
assert.ok(buildingDocument.operations.filter((operation) => operation.op === 'box').length >= 18);
assert.equal(buildingDocument.operations.filter((operation) => operation.op === 'cylinder').length, 0);
assert.ok(buildingDocument.operations.some((operation) => /^gap_completion_open_paved_area/.test(operation.id) && operation.qa?.grounding_v3_decision === 'helper_only'));
const generatedBuilding = JSON.parse(await fs.readFile(buildingOutputPath, 'utf8'));
assert.deepEqual(generatedBuilding, buildingDocument, 'building group default R10 DSL should be generated from the part graph compiler');

const buildingBuild = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(buildingDocument) });
assert.equal(buildingBuild.snapshot.totals.groups, buildingPartGraph.parts.length, 'compiled building group default R10 model should create one group per PartGraph part');
assert.equal(buildingBuild.snapshot.scenes.length, 2, 'compiled building group default R10 model should keep top/oblique review scenes');
assert.equal(buildingBuild.snapshot.warning_summary.by_severity.error, 0);
const blueHall = snapshotGroupById(buildingBuild.snapshot, 'primary_blue_roof_hall');
assert.equal(blueHall.qa.review_required, true, 'building group default R10 output should remain review-gated');
const legacyIds = new Set(['internal_roads', 'warehouse_row_west', 'warehouse_row_inner', 'parking_lot']);
assert.equal(buildingBuild.snapshot.groups.some((group) => legacyIds.has(group.id)), false, 'building group default R10 snapshot should not emit legacy occupancy parents');

const buildingLayoutSpec = JSON.parse(await fs.readFile('projects/image-structured-modeler/examples/building-group/model-qa.r10-groundplan.json', 'utf8'));
const buildingLayoutReport = await bridge.validate_model({
  code: JSON.stringify(buildingDocument),
  runtime: 'mock',
  spec: buildingLayoutSpec,
  includePreview: false
});
assert.equal(buildingLayoutReport.ok, true, 'building group layout QA should pass for the current massing DSL');
assert.equal(buildingLayoutReport.verdict, 'pass');
assert.equal(buildingLayoutReport.summary.total, 0);

const buildingReferenceSpec = JSON.parse(await fs.readFile('projects/image-structured-modeler/examples/building-group/reference-visual-qa.r10-groundplan.json', 'utf8'));
const buildingReferenceReport = await bridge.validate_reference_model({
  code: JSON.stringify(buildingDocument),
  runtime: 'mock',
  spec: buildingReferenceSpec,
  includePreview: false
});
assert.equal(buildingReferenceReport.ok, true, 'building group reference visual QA should pass for the current massing DSL');
assert.equal(buildingReferenceReport.verdict, 'pass');
assert.equal(buildingReferenceReport.summary.total, 0);

await assert.rejects(
  () => compilePartGraphFiles({ profilePath: buildingSingleProfilePath, partGraphPath: buildingSinglePartGraphPath, repoRoot }),
  /PartGraph compile blocked by geometry gate.*promoted_geometry_parts 0 is below 1/,
  'single-building oblique low-evidence PartGraph must be blocked before DSL output'
);
const promotedButUnscaledBuildingSingle = deepClone(buildingSinglePartGraph);
partById(promotedButUnscaledBuildingSingle, 'building_main_mass').promoted_geometry = true;
partById(promotedButUnscaledBuildingSingle, 'building_main_mass').qa.promoted_geometry = true;
assert.throws(
  () => compilePartGraphToSketchUpDsl(promotedButUnscaledBuildingSingle, buildingSingleProfile, { repoRoot }),
  /PartGraph compile blocked by geometry gate.*scale_confidence 0\.29 is below 0\.7/,
  'PartGraph compile policy must merge with profile scale gates instead of overriding them'
);

function assertValid(validate, value, label) {
  if (!validate(value)) {
    const errors = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('\n') || 'unknown schema error';
    throw new Error(`${label} failed schema validation:\n${errors}`);
  }
}

function assertPhysicalGate(partGraph, label, minRelations) {
  const report = validatePartGraphPhysicalConsistency(partGraph);
  assert.equal(report.ok, true, `${label} physical consistency relations should pass`);
  assert.equal(report.verdict, 'pass', `${label} physical consistency gate should pass`);
  assert.ok(report.summary.checked_relations >= minRelations, `${label} should define physical support/contact relations`);
  return report;
}

function assertPhysicalRelationSubject(partGraph, partId, label) {
  assert.ok(
    (partGraph.physical_relations || []).some((relation) => relation.subject === partId),
    `${label}: expected ${partId} to be a physical relation subject`
  );
}

function operationById(document, id) {
  const operation = document.operations.find((item) => item.id === id);
  assert.ok(operation, `expected compiled operation with id ${id}`);
  return operation;
}

function operationByFeatureId(document, featureId) {
  const operation = document.operations.find((item) => item.feature_id === featureId);
  assert.ok(operation, `expected compiled feature operation with id ${featureId}`);
  return operation;
}

function snapshotGroupById(snapshot, id) {
  const group = snapshot.groups.find((item) => item.id === id);
  assert.ok(group, `expected snapshot group with id ${id}`);
  return group;
}

function partById(partGraph, id) {
  const part = partGraph.parts.find((item) => item.id === id);
  assert.ok(part, `expected PartGraph part with id ${id}`);
  return part;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
