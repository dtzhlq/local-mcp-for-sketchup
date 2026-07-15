import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { SketchUpBridge } from '../src/bridge.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { analyzeReferenceImageCorrection, verifyReferenceImageCorrection } from '../src/visual-correction.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-visual-correction-'));
const stateDir = path.join(root, 'agent-state');
const inputDir = path.join(stateDir, 'input-images');
await fs.mkdir(inputDir, { recursive: true });
const referencePath = path.join(inputDir, 'reference.png');
const beforePath = path.join(inputDir, 'before.png');
const afterPath = path.join(inputDir, 'after.png');
await Promise.all([
  renderFixture(referencePath, { left: 45, top: 38, width: 110, height: 44 }),
  renderFixture(beforePath, { left: 63, top: 38, width: 90, height: 44 })
]);
await fs.copyFile(referencePath, afterPath);

const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(root, 'session.json') },
  agentContract: { rootDir: stateDir },
  approval: { stateDir: path.join(root, 'approvals'), secret: 'visual-correction-test-secret-at-least-32-bytes' },
  executionPolicy: { allowed_runtimes: ['mock'] }
});

await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
  { op: 'reset' },
  { op: 'box', id: 'visual-product', name: 'Visual Product', origin: [20, 0, 0], size: [90, 40, 44] }
] }) });
const adoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true });
const modelGraph = buildModelGraph(adoption);
const targets = [{ target_id: 'visual-product' }];
const operations = [{ op: 'transform_object', target_id: 'visual-product', translate: [-18, 0, 0] }];
const direct = await analyzeReferenceImageCorrection({
  referenceImagePath: referencePath,
  captureImagePath: beforePath,
  modelGraph,
  modelSnapshot: adoption.snapshot,
  correctionTargets: targets,
  correctionOperations: operations,
  outputDir: path.join(stateDir, 'direct'),
  allowedRoots: [stateDir]
});
assert.ok(direct.evidence.difference.mean_absolute_error > 0.005);
assert.ok(direct.evidence.alignment.foreground_center_delta_norm > 0.03);
assert.equal(direct.correction_patch.execution_allowed, false);
assert.equal(direct.correction_patch.review_required, true);
assert.equal(direct.correction_patch.execution_route, 'trusted_reviewed_existing_model_edit_only');
assert.equal(direct.correction_patch.next_action.tool, 'start_agent_task');
assert.equal(direct.correction_patch.next_action.arguments.intent, 'reviewed_existing_model_edit');
assert.equal(direct.correction_patch.risk_level, 'S2');

const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const [schemaName, value] of [
  ['visual-correction-evidence-v1.schema.json', direct.evidence],
  ['visual-correction-patch-v1.schema.json', direct.correction_patch]
]) {
  const schema = JSON.parse(await fs.readFile(new URL(`../schema/${schemaName}`, import.meta.url), 'utf8'));
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

const task = await bridge.start_agent_task({
  intent: 'reference_image_correction',
  instruction: 'Align the existing product with the supplied reference image.',
  client_capabilities: { vision: false, local_files: false, structured_output: true, context: 'short', parallel: false },
  inputs: {
    runtime: 'mock',
    reference_image_path: referencePath,
    capture_image_path: beforePath,
    correction_targets: targets,
    correction_operations: operations
  }
});
assert.equal(task.ok, true);
assert.equal(task.task_state, 'awaiting_review');
assert.equal(task.data.visual_agent_required, false);
assert.equal(task.data.correction_patch.execution_allowed, false);
assert.ok(task.artifacts.some((artifact) => artifact.media_type === 'image/png'));
assert.equal(task.next_action.tool, 'start_agent_task');

const overlayHandle = task.artifacts.find((artifact) => artifact.media_type === 'image/png').handle;
const overlay = await bridge.read_agent_artifact({ handle: overlayHandle, max_chars: 256 });
assert.equal(overlay.ok, true);
assert.equal(overlay.data.artifact.encoding, 'base64');

const verified = await verifyReferenceImageCorrection({
  referenceImagePath: referencePath,
  captureImagePath: afterPath,
  previousEvidence: direct.evidence,
  allowedRoots: [stateDir],
  outputDir: path.join(stateDir, 'direct-qa')
});
assert.equal(verified.report.verdict, 'pass');
assert.equal(verified.report.improved, true);
assert.equal(verified.report.review_required, false);
const qaSchema = JSON.parse(await fs.readFile(new URL('../schema/visual-correction-qa-v1.schema.json', import.meta.url), 'utf8'));
const validateQa = ajv.compile(qaSchema);
assert.equal(validateQa(verified.report), true, JSON.stringify(validateQa.errors));

const qaTask = await bridge.start_agent_task({
  intent: 'visual_correction_qa',
  instruction: 'Verify the recaptured model against the reference.',
  client_capabilities: { vision: false, local_files: false },
  inputs: { reference_image_path: referencePath, capture_image_path: afterPath, previous_evidence: direct.evidence }
});
assert.equal(qaTask.ok, true);
assert.equal(qaTask.task_state, 'completed');
assert.equal(qaTask.data.report.verdict, 'pass');

const outsidePath = path.join(root, 'outside.png');
await fs.copyFile(referencePath, outsidePath);
await assert.rejects(
  analyzeReferenceImageCorrection({ referenceImagePath: outsidePath, captureImagePath: beforePath, modelGraph, correctionTargets: targets, correctionOperations: operations, allowedRoots: [stateDir] }),
  /outside configured allowed roots/
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  visual_agent_required: false,
  initial_mae: direct.evidence.difference.mean_absolute_error,
  initial_alignment_delta: direct.evidence.alignment.foreground_center_delta_norm,
  patch_execution_allowed: direct.correction_patch.execution_allowed,
  trusted_review_route: direct.correction_patch.execution_route,
  recapture_verdict: verified.report.verdict,
  path_policy_fail_closed: true,
  live_queue_called: false
}, null, 2)}\n`);

async function renderFixture(filePath, rectangle) {
  const svg = `<svg width="200" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="120" fill="white"/><rect x="${rectangle.left}" y="${rectangle.top}" width="${rectangle.width}" height="${rectangle.height}" rx="4" fill="#202020"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(filePath);
}
