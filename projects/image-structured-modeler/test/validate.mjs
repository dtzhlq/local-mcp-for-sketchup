#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../../../src/bridge.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const subprojectRoot = path.join(repoRoot, 'projects', 'image-structured-modeler');

const ajv = new Ajv2020({ allErrors: true, strict: false });
const modelPlanSchema = await readJson('schema/model-plan.schema.json');
const imageObservationSchema = await readJson('schema/image-observation.schema.json');
const imageSetObservationSchema = await readJson('schema/image-set-observation.schema.json');
const manualCorrectionsSchema = await readJson('schema/manual-corrections.schema.json');

const validateModelPlan = ajv.compile(modelPlanSchema);
const validateImageObservation = ajv.compile(imageObservationSchema);
const validateImageSetObservation = ajv.compile(imageSetObservationSchema);
const validateManualCorrections = ajv.compile(manualCorrectionsSchema);

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
  assert.ok(output.operations.some((operation) => operation.op === 'scene'), 'compiled output should define review scenes');

  const bridge = new SketchUpBridge();
  const result = await bridge.build_model({ runtime: 'mock', code: outputCode });
  assert.ok(result.snapshot.totals.groups >= 8, 'compiled output should create groups in mock runtime');
  assert.ok(result.snapshot.totals.instances >= 8, 'compiled output should create component instances in mock runtime');
  assert.ok(result.snapshot.scenes.length >= 2, 'compiled output should create review scenes');
  assert.equal(result.snapshot.warning_summary.by_severity.error, 0, 'compiled output should not create error warnings');
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
  'scripts/lib/image-analysis.mjs'
]) {
  await fs.access(path.join(subprojectRoot, relativePath));
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
    scripts: true
  }
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(subprojectRoot, relativePath), 'utf8'));
}

function assertValid(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label} failed schema validation:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`);
  }
}

function stripCollectionOnlyFields(observation) {
  const clone = structuredClone(observation);
  delete clone.metrics;
  return clone;
}
