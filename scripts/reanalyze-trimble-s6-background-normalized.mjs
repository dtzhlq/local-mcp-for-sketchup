#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareBackgroundNormalizedImages } from '../src/background-normalized-visual-comparison.mjs';

export const TRIMBLE_S6_BACKGROUND_NORMALIZED_VISUAL_EVIDENCE_VERSION = 'trimble-s6-background-normalized-visual-evidence.v1';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDiagnosticDir = path.join(
  projectRoot,
  'output',
  'live-validation',
  'visual-correction',
  'trimble-s6-reference-correction-2026-07-22',
  'clean-p3-policy-bound-v3',
  'structured-reference-diagnostic',
  'front-full-v4'
);
const outputDir = path.join(sourceDiagnosticDir, 'background-normalized-v1');
const evidencePath = path.join(
  projectRoot,
  'docs',
  'evidence',
  'trimble-s6-background-normalized-visual-evidence-2026-07-23.json'
);
const sourceDiagnosticPath = path.join(sourceDiagnosticDir, 'diagnostic.json');
const referencePath = path.join(sourceDiagnosticDir, 'reference.png');
const capturePath = path.join(sourceDiagnosticDir, 'capture.png');
const [diagnostic, referenceBuffer, captureBuffer] = await Promise.all([
  readJson(sourceDiagnosticPath),
  fs.readFile(referencePath),
  fs.readFile(capturePath)
]);

const referenceSha = sha256(referenceBuffer);
const captureSha = sha256(captureBuffer);
if (referenceSha !== diagnostic.reference.sha256) {
  throw new Error('The reference bytes do not match the immutable source diagnostic binding.');
}
if (captureSha !== diagnostic.capture.sha256) {
  throw new Error('The capture bytes do not match the immutable source diagnostic binding.');
}
if (diagnostic.promoted_or_executed !== false
  || diagnostic.correction_patch.execution_allowed !== false
  || diagnostic.release_acceptance !== false) {
  throw new Error('The source diagnostic trust boundary is not safe for offline reanalysis.');
}

const result = await compareBackgroundNormalizedImages({
  referenceBuffer,
  captureBuffer
});
if (result.comparison.inputs.reference.sha256 !== referenceSha
  || result.comparison.inputs.capture.sha256 !== captureSha) {
  throw new Error('The comparison input hashes do not match the source images.');
}
if (result.comparison.execution_allowed !== false
  || result.comparison.review_required !== true
  || result.comparison.visual_similarity_accepted !== false) {
  throw new Error('The background-normalized comparison changed the visual safety boundary.');
}

await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
const artifactBuffers = {
  'reference-mask.png': result.artifacts.reference_mask,
  'capture-mask.png': result.artifacts.capture_mask,
  'registered-reference.png': result.artifacts.registered_reference,
  'registered-capture.png': result.artifacts.registered_capture,
  'silhouette-overlay.png': result.artifacts.silhouette_overlay
};
const artifactBindings = {};
for (const [basename, bytes] of Object.entries(artifactBuffers)) {
  const target = path.join(outputDir, basename);
  await writeFileAtomic(target, bytes);
  artifactBindings[relative(target)] = {
    sha256: sha256Hex(bytes),
    size_bytes: bytes.length
  };
}

const comparisonPath = path.join(outputDir, 'comparison.json');
await writeJsonAtomic(comparisonPath, result.comparison);
const sourceFiles = [
  'src/background-normalized-visual-comparison.mjs',
  'scripts/reanalyze-trimble-s6-background-normalized.mjs',
  'schema/background-normalized-visual-comparison-v1.schema.json',
  'schema/trimble-s6-background-normalized-visual-evidence-v1.schema.json',
  'test/background-normalized-visual-comparison.mjs',
  'test/trimble-s6-background-normalized-visual-evidence.mjs'
];
const sourceSha256 = {};
for (const sourceFile of sourceFiles) {
  sourceSha256[sourceFile] = sha256Hex(await fs.readFile(path.join(projectRoot, sourceFile)));
}
const branch = await gitOutput(['branch', '--show-current']);
const baselineCommit = await gitOutput(['rev-parse', 'HEAD']);
const comparisonSha = sha256Hex(await fs.readFile(comparisonPath));
const sourceDiagnosticSha = sha256Hex(await fs.readFile(sourceDiagnosticPath));
const captureBounds = result.comparison.segmentation.capture.bounds_norm;
const captureBoundsFullWidth = captureBounds[0] === 0 && captureBounds[2] === 1;
const structureBelowPassThreshold = result.comparison.structure.verdict !== 'coarse_structure_pass';
const evidence = {
  version: TRIMBLE_S6_BACKGROUND_NORMALIZED_VISUAL_EVIDENCE_VERSION,
  kind: 'post_apply_background_normalized_visual_diagnostic',
  analyzed_at: new Date().toISOString(),
  branch,
  baseline_commit: baselineCommit,
  source_sha256: sourceSha256,
  source_diagnostic: {
    path: relative(sourceDiagnosticPath),
    sha256: sourceDiagnosticSha,
    task_id: diagnostic.diagnostic_task_id,
    source_mutation_task_id: diagnostic.source_mutation_task_id,
    model_revision: diagnostic.capture.provenance.model_revision,
    reference_sha256: referenceSha,
    capture_sha256: captureSha,
    prior_capture_foreground_bounds_full_width: diagnostic.structured_metrics.foreground.capture.bounds_norm[0] === 0
      && diagnostic.structured_metrics.foreground.capture.bounds_norm[2] === 1,
    promoted_or_executed: false
  },
  comparison: {
    path: relative(comparisonPath),
    sha256: comparisonSha,
    comparison_id: result.comparison.comparison_id,
    comparison_hash: result.comparison.comparison_hash,
    segmentation_method: result.comparison.segmentation.method,
    segmentation_reliable: result.comparison.segmentation.reliable,
    reference_bounds_norm: result.comparison.segmentation.reference.bounds_norm,
    capture_bounds_norm: captureBounds,
    capture_bounds_full_width: captureBoundsFullWidth,
    structure: {
      verdict: result.comparison.structure.verdict,
      intersection_over_union: result.comparison.structure.intersection_over_union,
      dice_coefficient: result.comparison.structure.dice_coefficient,
      aspect_ratio_log_delta: result.comparison.structure.aspect_ratio_log_delta,
      thresholds: result.comparison.structure.thresholds
    },
    appearance: {
      verdict: result.comparison.appearance.verdict,
      mean_absolute_error: result.comparison.appearance.mean_absolute_error,
      root_mean_square_error: result.comparison.appearance.root_mean_square_error,
      yellow_fraction_delta: result.comparison.appearance.palette.yellow_fraction_delta,
      dark_fraction_delta: result.comparison.appearance.palette.dark_fraction_delta,
      light_neutral_fraction_delta: result.comparison.appearance.palette.light_neutral_fraction_delta
    }
  },
  artifact_sha256: {
    [relative(comparisonPath)]: comparisonSha,
    ...Object.fromEntries(Object.entries(artifactBindings).map(([name, binding]) => [name, binding.sha256]))
  },
  policy_invariants: {
    execution_mode: 'offline_immutable_image_bytes_only',
    queue_runtime_invoked: false,
    sketchup_capture_invoked: false,
    live_model_mutation_performed: false,
    correction_patch_persisted: false,
    approval_challenge_created: false,
    approval_token_exposed_to_agent: false,
    image_content_policy_effect: 'none',
    agent_visual_capability_required: false,
    agent_local_file_capability_required: false,
    visual_similarity_accepted: false
  },
  release_acceptance: false,
  release_blockers: [
    ...(structureBelowPassThreshold ? ['coarse_structure_below_fixed_pass_threshold'] : []),
    'appearance_residual_is_diagnostic_only',
    'camera_pose_comparability_not_independently_established',
    'single_model_pair_only',
    'fresh_process_multi_model_visual_proof_incomplete',
    'cross_version_deferred_by_user'
  ],
  boundaries: [
    'This evidence reanalyzes immutable reference and capture bytes from the existing reviewed Trimble S6 correction chain; it does not invoke SketchUp or the queue.',
    'Row-conditioned border flood segmentation removes the prior full-width sky/ground foreground error without changing the fixed pass thresholds.',
    structureBelowPassThreshold
      ? 'The coarse silhouette result is below the fixed IoU or Dice threshold and remains review-only.'
      : 'The registered silhouette clears the fixed coarse-structure thresholds, but the overall result remains review-required and is not visual-similarity acceptance.',
    'Appearance residuals are diagnostic only; they do not prove material, dimensional, camera, or photo-grade equivalence.',
    'No image-derived value can select a target, operation, execution policy, approval state, or release status.'
  ]
};
await writeJsonAtomic(evidencePath, evidence);

process.stdout.write(`${JSON.stringify({
  ok: true,
  execution_mode: evidence.policy_invariants.execution_mode,
  segmentation_reliable: evidence.comparison.segmentation_reliable,
  prior_capture_foreground_bounds_full_width: evidence.source_diagnostic.prior_capture_foreground_bounds_full_width,
  capture_foreground_bounds_full_width: evidence.comparison.capture_bounds_full_width,
  capture_foreground_bounds_norm: evidence.comparison.capture_bounds_norm,
  structure: evidence.comparison.structure,
  appearance: evidence.comparison.appearance,
  visual_similarity_accepted: false,
  release_acceptance: false,
  comparison_path: evidence.comparison.path,
  evidence_path: relative(evidencePath)
}, null, 2)}\n`);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJsonAtomic(filePath, value) {
  await writeFileAtomic(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function writeFileAtomic(filePath, bytes) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function gitOutput(args) {
  const result = await execFileAsync('git', args, { cwd: projectRoot, encoding: 'utf8' });
  return result.stdout.trim();
}

function relative(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function sha256(buffer) {
  return `sha256:${sha256Hex(buffer)}`;
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
