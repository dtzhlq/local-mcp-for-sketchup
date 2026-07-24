import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import {
  BACKGROUND_NORMALIZED_VISUAL_COMPARISON_VERSION,
  compareBackgroundNormalizedImages
} from '../src/background-normalized-visual-comparison.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(await fs.readFile(
  path.join(root, 'schema/background-normalized-visual-comparison-v1.schema.json'),
  'utf8'
));
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);

const reference = await renderScene({
  split: 62,
  upper: [55, 130, 178],
  lower: [250, 250, 250],
  centerX: 160,
  centerY: 121,
  scale: 0.82,
  palette: 'photo'
});
const capture = await renderScene({
  split: 136,
  upper: [126, 176, 218],
  lower: [108, 149, 97],
  centerX: 198,
  centerY: 112,
  scale: 1.06,
  palette: 'render'
});
const matched = await compareBackgroundNormalizedImages({
  referenceBuffer: reference,
  captureBuffer: capture
});

assert.equal(matched.comparison.version, BACKGROUND_NORMALIZED_VISUAL_COMPARISON_VERSION);
assert.equal(validate(matched.comparison), true, JSON.stringify(validate.errors, null, 2));
assert.equal(matched.comparison.segmentation.reliable, true);
assert.equal(matched.comparison.segmentation.reference.reliable, true);
assert.equal(matched.comparison.segmentation.capture.reliable, true);
assert.ok(matched.comparison.segmentation.reference.bounds_norm[0] > 0);
assert.ok(matched.comparison.segmentation.reference.bounds_norm[2] < 1);
assert.ok(matched.comparison.segmentation.capture.bounds_norm[0] > 0);
assert.ok(matched.comparison.segmentation.capture.bounds_norm[2] < 1);
assert.equal(matched.comparison.structure.verdict, 'coarse_structure_pass');
assert.ok(matched.comparison.structure.intersection_over_union >= matched.comparison.structure.thresholds.iou_pass_min);
assert.ok(matched.comparison.structure.dice_coefficient >= matched.comparison.structure.thresholds.dice_pass_min);
assert.equal(matched.comparison.appearance.verdict, 'diagnostic_only');
assert.ok(matched.comparison.appearance.palette.yellow_fraction_delta > 0);
assert.equal(matched.comparison.agent_compatibility.visual_agent_required, false);
assert.equal(matched.comparison.agent_compatibility.local_files_required, false);
assert.equal(matched.comparison.execution_allowed, false);
assert.equal(matched.comparison.review_required, true);
assert.equal(matched.comparison.visual_similarity_accepted, false);
assert.match(matched.comparison.comparison_hash, /^sha256:[0-9a-f]{64}$/);

for (const buffer of Object.values(matched.artifacts)) {
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.format, 'png');
}
assert.deepEqual(
  [matched.comparison.inputs.reference.normalized_width, matched.comparison.inputs.reference.normalized_height],
  [256, 192]
);
assert.deepEqual(
  [matched.comparison.inputs.capture.normalized_width, matched.comparison.inputs.capture.normalized_height],
  [256, 192]
);
assert.deepEqual(
  [(await sharp(matched.artifacts.reference_mask).metadata()).width, (await sharp(matched.artifacts.reference_mask).metadata()).height],
  [256, 192]
);
assert.deepEqual(
  [(await sharp(matched.artifacts.registered_reference).metadata()).width, (await sharp(matched.artifacts.registered_reference).metadata()).height],
  [256, 256]
);

const mismatchedCapture = await renderScene({
  split: 118,
  upper: [118, 168, 210],
  lower: [96, 140, 88],
  centerX: 177,
  centerY: 118,
  scale: 1,
  palette: 'render',
  mismatchShape: 'cross'
});
const mismatched = await compareBackgroundNormalizedImages({
  referenceBuffer: reference,
  captureBuffer: mismatchedCapture
});
assert.equal(mismatched.comparison.segmentation.reliable, true);
assert.equal(mismatched.comparison.structure.verdict, 'review');
assert.equal(mismatched.comparison.execution_allowed, false);

const blank = await renderBlankScene();
const blocked = await compareBackgroundNormalizedImages({
  referenceBuffer: blank,
  captureBuffer: capture
});
assert.equal(blocked.comparison.segmentation.reliable, false);
assert.deepEqual(blocked.comparison.blockers, ['reference_foreground_segmentation_unreliable']);
assert.equal(blocked.comparison.structure.verdict, 'blocked');
assert.equal(blocked.comparison.visual_similarity_accepted, false);
assert.equal(validate(blocked.comparison), true, JSON.stringify(validate.errors, null, 2));

const customCanvas = await compareBackgroundNormalizedImages({
  referenceBuffer: reference,
  captureBuffer: capture,
  workSize: 128,
  registrationSize: 192,
  registrationPadding: 12
});
assert.equal(customCanvas.comparison.working_canvas.max_dimension, 128);
assert.deepEqual(customCanvas.comparison.registration.canvas, [192, 192]);
assert.equal((await sharp(customCanvas.artifacts.reference_mask).metadata()).width, 128);
assert.equal((await sharp(customCanvas.artifacts.reference_mask).metadata()).height, 96);
assert.equal((await sharp(customCanvas.artifacts.registered_reference).metadata()).width, 192);

await assert.rejects(
  compareBackgroundNormalizedImages({ referenceBuffer: Buffer.alloc(0), captureBuffer: capture }),
  /referenceBuffer/
);
await assert.rejects(
  compareBackgroundNormalizedImages({ referenceBuffer: reference, captureBuffer: capture, workSize: 32 }),
  /workSize/
);
await assert.rejects(
  compareBackgroundNormalizedImages({
    referenceBuffer: reference,
    captureBuffer: capture,
    registrationSize: 64,
    registrationPadding: 30
  }),
  /registrationPadding/
);

for (const mutate of [
  (value) => { value.content_trust = 'trusted'; },
  (value) => { value.policy_effect = 'execute'; },
  (value) => { value.execution_allowed = true; },
  (value) => { value.review_required = false; },
  (value) => { value.visual_similarity_accepted = true; },
  (value) => { value.agent_compatibility.visual_agent_required = true; }
]) {
  const invalid = structuredClone(matched.comparison);
  mutate(invalid);
  assert.equal(validate(invalid), false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  schema_valid: true,
  background_variants_compared: 3,
  matched_structure_verdict: matched.comparison.structure.verdict,
  mismatch_structure_verdict: mismatched.comparison.structure.verdict,
  blank_structure_verdict: blocked.comparison.structure.verdict,
  policy_negative_cases: 6,
  custom_canvas_artifacts_verified: true,
  visual_agent_required: false,
  execution_allowed: false,
  visual_similarity_accepted: false
}, null, 2)}\n`);

async function renderScene({
  split,
  upper,
  lower,
  centerX,
  centerY,
  scale,
  palette,
  missingTripod = false,
  wideBody = false,
  mismatchShape = null
}) {
  const width = 320;
  const height = 240;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const base = y < split ? upper : lower;
    for (let x = 0; x < width; x += 1) setPixel(data, width, x, y, base);
  }
  const yellow = palette === 'photo' ? [242, 190, 35] : [220, 151, 18];
  const dark = palette === 'photo' ? [43, 48, 53] : [27, 30, 32];
  const neutral = palette === 'photo' ? [178, 184, 190] : [130, 137, 144];
  const transform = ([x, y]) => [
    Math.round(centerX + x * scale),
    Math.round(centerY + y * scale)
  ];
  const rect = (x0, y0, x1, y1, color) => {
    const [left, top] = transform([x0, y0]);
    const [right, bottom] = transform([x1, y1]);
    drawRect(data, width, height, left, top, right, bottom, color);
  };
  if (mismatchShape === 'cross') {
    rect(-76, -14, 76, 16, dark);
    rect(-9, -86, 9, 92, yellow);
    return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
  }
  rect(wideBody ? -43 : -31, -58, wideBody ? 43 : 31, 12, yellow);
  rect(-39, -79, 39, -58, dark);
  rect(-31, -52, -23, 5, dark);
  rect(23, -52, 31, 5, neutral);
  rect(-10, -42, 10, -20, dark);
  rect(-28, 12, 28, 24, dark);
  if (!missingTripod) {
    drawThickLine(data, width, height, transform([-20, 22]), transform([-61, 90]), 7 * scale, yellow);
    drawThickLine(data, width, height, transform([20, 22]), transform([61, 90]), 7 * scale, yellow);
    drawThickLine(data, width, height, transform([0, 22]), transform([0, 94]), 9 * scale, yellow);
    drawThickLine(data, width, height, transform([-20, 22]), transform([-61, 90]), 2.5 * scale, dark);
    drawThickLine(data, width, height, transform([20, 22]), transform([61, 90]), 2.5 * scale, dark);
  } else {
    rect(-13, 24, 13, 55, dark);
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function renderBlankScene() {
  const width = 320;
  const height = 240;
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const color = y < 100 ? [74, 140, 190] : [244, 244, 244];
    for (let x = 0; x < width; x += 1) setPixel(data, width, x, y, color);
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function drawRect(data, width, height, left, top, right, bottom, color) {
  const minX = Math.max(0, Math.min(left, right));
  const maxX = Math.min(width, Math.max(left, right));
  const minY = Math.max(0, Math.min(top, bottom));
  const maxY = Math.min(height, Math.max(top, bottom));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) setPixel(data, width, x, y, color);
  }
}

function drawThickLine(data, width, height, start, end, thickness, color) {
  const [x0, y0] = start;
  const [x1, y1] = end;
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const radius = Math.max(1, Math.round(thickness / 2));
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + ((x1 - x0) * step) / steps);
    const y = Math.round(y0 + ((y1 - y0) * step) / steps);
    drawRect(data, width, height, x - radius, y - radius, x + radius + 1, y + radius + 1, color);
  }
}

function setPixel(data, width, x, y, color) {
  const offset = ((y * width) + x) * 3;
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
}
