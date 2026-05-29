import assert from 'node:assert/strict';
import { SketchUpBridge } from '../src/bridge.mjs';

const bridge = new SketchUpBridge();

const badControllerCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'box', name: 'Right_JoyCon_Shell', origin: [0, 0, 0], size: [60, 140, 20] },
    { op: 'cylinder', name: 'Home_Button', origin: [54, -4, 23], radius: 8, height: 4, segments: 24 }
  ]
});

const controllerSpec = {
  title: 'Controller QA Test',
  rules: {
    inside: [
      { item: 'Home_Button', parent: 'Right_JoyCon_Shell', axes: ['x', 'y'], tolerance_mm: 1 }
    ],
    support: [
      { item: 'Home_Button', parent: 'Right_JoyCon_Shell', max_gap_mm: 5, allow_penetration_mm: 1 }
    ]
  }
};

const badReport = await bridge.validate_model({
  code: badControllerCode,
  runtime: 'mock',
  spec: controllerSpec,
  includePreview: true
});

assert.equal(badReport.kind, 'model_qa');
assert.equal(badReport.ok, false);
assert.equal(badReport.verdict, 'fail');
assert.ok(badReport.issues.some((issue) => issue.type === 'layout.outside_parent_region' && issue.item === 'Home_Button'));
assert.ok(badReport.correction_suggestions.some((suggestion) => suggestion.action === 'fit_inside_parent'));
assert.ok(badReport.preview.views.some((view) => view.name === 'top' && view.svg.includes('<svg')));

const fixedControllerCode = JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'box', name: 'Right_JoyCon_Shell', origin: [0, 0, 0], size: [60, 140, 20] },
    { op: 'cylinder', name: 'Home_Button', origin: [42, 18, 23], radius: 8, height: 4, segments: 24 }
  ]
});

const fixedReport = await bridge.validate_model({
  code: fixedControllerCode,
  runtime: 'mock',
  spec: controllerSpec,
  includePreview: false
});

assert.equal(fixedReport.ok, true);
assert.equal(fixedReport.verdict, 'pass');
assert.equal(fixedReport.summary.total, 0);
assert.equal(fixedReport.preview, null);
