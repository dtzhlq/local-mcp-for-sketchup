import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { formatReferenceVisualQaReportMarkdown } from '../src/reference-visual-qa.mjs';

const bridge = new SketchUpBridge();
const codePath = 'examples/acceptance-ambulance-reference.json';
const specPath = 'examples/reference-visual-qa/ambulance-reference.json';
const layoutSpecPath = 'examples/model-qa/ambulance-reference.json';
const switchCodePath = 'examples/acceptance-switch-controller.json';
const switchSpecPath = 'examples/reference-visual-qa/switch-controller-reference.json';
const switchLayoutSpecPath = 'examples/model-qa/switch-controller-demo.json';
const cameraCodePath = 'examples/acceptance-fuji-camera.json';
const cameraSpecPath = 'examples/reference-visual-qa/fuji-camera-reference.json';
const cameraLayoutSpecPath = 'examples/model-qa/fuji-camera-reference.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const schema = JSON.parse(await fs.readFile('schema/reference-visual-qa.schema.json', 'utf8'));
const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
const switchSpec = JSON.parse(await fs.readFile(switchSpecPath, 'utf8'));
const cameraSpec = JSON.parse(await fs.readFile(cameraSpecPath, 'utf8'));
const validateSpec = ajv.compile(schema);
assertValid(validateSpec, spec, specPath);
assertValid(validateSpec, switchSpec, switchSpecPath);
assertValid(validateSpec, cameraSpec, cameraSpecPath);

const code = await fs.readFile(codePath, 'utf8');
const report = await bridge.validate_reference_model({
  code,
  spec,
  runtime: 'mock',
  includePreview: true
});

assert.equal(report.kind, 'reference_visual_qa');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'pass');
assert.equal(report.summary.total, 0);
assert.ok(report.preview.views.some((view) => view.name === 'left' && view.svg.includes('<svg')));

const markdown = formatReferenceVisualQaReportMarkdown(report, { title: 'Reference QA Test' });
assert.ok(markdown.includes('No reference visual issues.'));

const switchCode = await fs.readFile(switchCodePath, 'utf8');
const switchReport = await bridge.validate_reference_model({
  code: switchCode,
  spec: switchSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(switchReport.ok, true);
assert.equal(switchReport.verdict, 'pass');
assert.equal(switchReport.summary.total, 0);

const cameraCode = await fs.readFile(cameraCodePath, 'utf8');
const cameraReport = await bridge.validate_reference_model({
  code: cameraCode,
  spec: cameraSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(cameraReport.ok, true);
assert.equal(cameraReport.verdict, 'pass');
assert.equal(cameraReport.summary.total, 0);

const badDocument = JSON.parse(code);
const badSideWindow = badDocument.operations.find((operation) => operation.id === 'amb-left-side-window');
assert.ok(badSideWindow, 'expected side window operation');
badSideWindow.origin = [badSideWindow.origin[0], badSideWindow.origin[1], badSideWindow.origin[2] - 80];

const layoutSpec = JSON.parse(await fs.readFile(layoutSpecPath, 'utf8'));
const badLayoutReport = await bridge.validate_model({
  code: JSON.stringify(badDocument),
  spec: layoutSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(badLayoutReport.ok, true, 'proportion regression should still pass layout QA');

const badReferenceReport = await bridge.validate_reference_model({
  code: JSON.stringify(badDocument),
  spec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(badReferenceReport.ok, false);
assert.equal(badReferenceReport.verdict, 'fail');
const sideWindowIssue = badReferenceReport.issues.find((issue) => issue.rule_id === 'side-window-center');
assert.ok(sideWindowIssue, 'reference QA should catch the side window proportion drift');
assert.equal(sideWindowIssue.type, 'reference.keypoint_delta');
assert.equal(sideWindowIssue.correction.target, 'parts[amb-left-side-window].shape.parameters.origin');
assert.ok(badReferenceReport.correction_suggestions.some((suggestion) => (
  suggestion.action === 'update_part_graph'
  && suggestion.part_id === 'amb-left-side-window'
  && suggestion.target === 'parts[amb-left-side-window].shape.parameters.origin'
)));

const badSwitchDocument = JSON.parse(switchCode);
const badRightThumbstick = badSwitchDocument.operations.find((operation) => operation.id === 'right-analog-stick-top-pad');
assert.ok(badRightThumbstick, 'expected right thumbstick operation');
badRightThumbstick.origin = [
  badRightThumbstick.origin[0],
  badRightThumbstick.origin[1] + 25,
  badRightThumbstick.origin[2]
];

const switchLayoutSpec = JSON.parse(await fs.readFile(switchLayoutSpecPath, 'utf8'));
const badSwitchLayoutReport = await bridge.validate_model({
  code: JSON.stringify(badSwitchDocument),
  spec: switchLayoutSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(badSwitchLayoutReport.ok, true, 'Switch control drift should still pass layout QA when it remains mounted on the shell');

const badSwitchReferenceReport = await bridge.validate_reference_model({
  code: JSON.stringify(badSwitchDocument),
  spec: switchSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(badSwitchReferenceReport.ok, false);
assert.equal(badSwitchReferenceReport.verdict, 'fail');
const rightThumbstickIssue = badSwitchReferenceReport.issues.find((issue) => issue.rule_id === 'right-thumbstick-center');
assert.ok(rightThumbstickIssue, 'reference QA should catch the right thumbstick proportion drift');
assert.equal(rightThumbstickIssue.correction.target, 'parts[right-analog-stick-top-pad].shape.parameters.origin');

const mirroredSwitchDocument = JSON.parse(switchCode);
const mirroredLeftThumbstick = mirroredSwitchDocument.operations.find((operation) => operation.id === 'left-analog-stick-top-pad');
const mirroredRightThumbstick = mirroredSwitchDocument.operations.find((operation) => operation.id === 'right-analog-stick-top-pad');
assert.ok(mirroredLeftThumbstick && mirroredRightThumbstick, 'expected Switch thumbstick operations');
const leftThumbstickX = mirroredLeftThumbstick.origin[0];
mirroredLeftThumbstick.origin[0] = mirroredRightThumbstick.origin[0];
mirroredRightThumbstick.origin[0] = leftThumbstickX;

const mirroredSwitchReferenceReport = await bridge.validate_reference_model({
  code: JSON.stringify(mirroredSwitchDocument),
  spec: switchSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(mirroredSwitchReferenceReport.ok, false);
assert.equal(mirroredSwitchReferenceReport.verdict, 'fail');
const mirroredThumbstickIssue = mirroredSwitchReferenceReport.issues.find((issue) => issue.rule_id === 'right-thumbstick-right-of-left-thumbstick');
assert.ok(mirroredThumbstickIssue, 'reference QA should catch mirrored left/right thumbstick orientation');
assert.equal(mirroredThumbstickIssue.type, 'reference.orientation_order');
assert.equal(mirroredThumbstickIssue.correction.target, 'parts[right-analog-stick-top-pad].shape.parameters.origin');

const badCameraDocument = JSON.parse(cameraCode);
const badLensCap = badCameraDocument.operations.find((operation) => operation.id === 'fuji-lens-front-cap');
assert.ok(badLensCap, 'expected Fuji lens cap operation');
badLensCap.origin = [20, badLensCap.origin[1], badLensCap.origin[2]];

const cameraLayoutSpec = JSON.parse(await fs.readFile(cameraLayoutSpecPath, 'utf8'));
const badCameraLayoutReport = await bridge.validate_model({
  code: JSON.stringify(badCameraDocument),
  spec: cameraLayoutSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(badCameraLayoutReport.ok, true, 'Fuji lens lateral drift should still pass first-pass layout QA when it remains inside the body silhouette tolerance');

const badCameraReferenceReport = await bridge.validate_reference_model({
  code: JSON.stringify(badCameraDocument),
  spec: cameraSpec,
  runtime: 'mock',
  includePreview: false
});
assert.equal(badCameraReferenceReport.ok, false);
assert.equal(badCameraReferenceReport.verdict, 'fail');
const lensIssue = badCameraReferenceReport.issues.find((issue) => issue.rule_id === 'fuji-lens-front-center');
assert.ok(lensIssue, 'reference QA should catch Fuji lens center drift');
assert.equal(lensIssue.correction.target, 'parts[fuji-lens-front-cap].shape.parameters.origin');

function assertValid(validate, value, label) {
  if (!validate(value)) {
    const errors = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('\n') || 'unknown schema error';
    throw new Error(`${label} failed schema validation:\n${errors}`);
  }
}
