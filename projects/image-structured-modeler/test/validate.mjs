#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { evaluateDiffWarningBudget, evaluateSnapshotWarningBudget } from '../scripts/lib/warning-budget.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const subprojectRoot = path.join(repoRoot, 'projects', 'image-structured-modeler');

const modelPlanSchema = await readJson('schema/model-plan.schema.json');
const imageObservationSchema = await readJson('schema/image-observation.schema.json');
const imageSetObservationSchema = await readJson('schema/image-set-observation.schema.json');
const manualCorrectionsSchema = await readJson('schema/manual-corrections.schema.json');
const switchWarningBudget = await readJson('examples/switch-controller/warning-budget.json');
const SWITCH_BASELINE_GROUPS = 24;
const SWITCH_BASELINE_INSTANCES = 4;
const SWITCH_BASELINE_SCENES = 2;
const SWITCH_BASELINE_GEOMETRY_WARNINGS = 0;

const validateModelPlan = compileSchema(modelPlanSchema);
const validateImageObservation = compileSchema(imageObservationSchema);
const validateImageSetObservation = compileSchema(imageSetObservationSchema);
const validateManualCorrections = compileSchema(manualCorrectionsSchema);

const modelPlanExample = await readJson('examples/switch-controller/model-plan.example.json');
assertValid(validateModelPlan, modelPlanExample, 'switch controller model-plan.example.json');

const observationPath = path.join(subprojectRoot, 'examples', 'switch-controller', 'observations.json');
let observationsChecked = false;
try {
  const observationSet = JSON.parse(await fs.readFile(observationPath, 'utf8'));
  assertValid(validateImageSetObservation, observationSet, 'switch controller observations.json');
  assert.ok(observationSet.images.length > 0, 'observations.json should contain image observations');
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
  reviewReportChecked = true;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

for (const relativePath of [
  'scripts/analyze-image-set.mjs',
  'scripts/make-review-overlay.mjs',
  'scripts/make-review-report.mjs',
  'scripts/generate-model-plan.mjs',
  'scripts/compile-plan-to-sketchup-dsl.mjs',
  'scripts/make-snapshot-report.mjs',
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
    warning_budget: true,
    scripts: true
  }
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(subprojectRoot, relativePath), 'utf8'));
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
