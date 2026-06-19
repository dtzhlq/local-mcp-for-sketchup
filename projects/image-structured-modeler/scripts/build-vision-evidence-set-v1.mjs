#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { annotateObservationSetWithBirdEyeLandCoverV1 } from './lib/bird-eye-land-cover.mjs';
import { annotateObservationSetWithHighContrastEdgeV1 } from './lib/high-contrast-edge-v1.mjs';
import { annotateObservationSetWithOpenCvEdgeV1 } from './lib/opencv-edge-v1.mjs';
import {
  annotateObservationSetWithVisionEvidenceSetV1,
  buildVisionEvidenceReviewPatch,
  buildVisionEvidenceSetV1,
  renderVisionEvidenceReviewPatchMarkdown,
  visionEvidenceSetReport
} from './lib/vision-evidence-set-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-v1-report.json';
  const outputDir = options.outputDir || path.dirname(outputPath);
  let observations = await readJson(observationsPath);
  observations = await annotateObservationSetWithBirdEyeLandCoverV1(observations, { force: options.forceLandCover || options.force });
  observations = await annotateObservationSetWithHighContrastEdgeV1(observations, { force: options.forceHighContrast || options.force });
  observations = await annotateObservationSetWithOpenCvEdgeV1(observations, {
    force: options.forceOpenCv || options.force,
    output: path.join(outputDir, 'opencv-edge-v1-report.json'),
    outputDir,
    requireOpenCv: options.requireOpenCv
  });
  observations = annotateObservationSetWithVisionEvidenceSetV1(observations, { force: true });
  const visionEvidenceSet = observations.vision_evidence_set_v1 || buildVisionEvidenceSetV1({ observations });
  const report = visionEvidenceSetReport(visionEvidenceSet);
  const reviewPatchOutputPath = options.reviewPatchOutput || path.join(outputDir, 'vision-evidence-review-patch.json');
  const reviewPatchMarkdownOutputPath = options.reviewPatchMarkdownOutput || reviewPatchOutputPath.replace(/\.json$/u, '.md');
  const reviewPatch = buildVisionEvidenceReviewPatch({
    visionEvidenceSet,
    source: `${observationsPath}#vision_evidence_set_v1`
  });

  if (options.updateObservations) await writeJson(resolveRepo(observationsPath), observations);
  if (outputPath) await writeJson(resolveRepo(outputPath), report);
  if (reviewPatchOutputPath) {
    await writeJson(resolveRepo(reviewPatchOutputPath), reviewPatch);
    await fs.writeFile(resolveRepo(reviewPatchMarkdownOutputPath), renderVisionEvidenceReviewPatchMarkdown(reviewPatch), 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    masks: report.summary.masks,
    edges: report.summary.edges,
    accepted_edges: report.summary.accepted_edges,
    rejected_edges: report.summary.rejected_edges,
    lines: report.summary.lines,
    keypoints: report.summary.keypoints,
    regions: report.summary.regions,
    scale_anchors: report.summary.scale_anchors,
    relations: report.summary.relations,
    planar_groundplan_allowed: report.summary.planar_groundplan_allowed,
    top_view_ground_plane_confidence: report.summary.top_view_ground_plane_confidence,
    view_ground_plane_images: report.summary.view_ground_plane_images,
    ground_plane_review_images: report.summary.ground_plane_review_images,
    preferred_top_view_usage_policy: report.summary.preferred_top_view_usage_policy,
    review_patch_status: reviewPatch.status,
    review_patch_items: reviewPatch.summary.total_items,
    default_heavy_model_required: report.summary.default_heavy_model_required,
    output: outputPath,
    review_patch_output: reviewPatchOutputPath,
    review_patch_markdown_output: reviewPatchMarkdownOutputPath
  }, null, 2)}\n`);

  if (options.requireOk && !report.ok) process.exit(1);
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot || scriptRoot, value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') parsed.observations = argv[++index];
    else if (arg === '--output') parsed.output = argv[++index];
    else if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--review-patch-output') parsed.reviewPatchOutput = argv[++index];
    else if (arg === '--review-patch-markdown-output') parsed.reviewPatchMarkdownOutput = argv[++index];
    else if (arg === '--update-observations') parsed.updateObservations = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--force-land-cover') parsed.forceLandCover = true;
    else if (arg === '--force-high-contrast') parsed.forceHighContrast = true;
    else if (arg === '--force-opencv') parsed.forceOpenCv = true;
    else if (arg === '--require-opencv') parsed.requireOpenCv = true;
    else if (arg === '--require-ok') parsed.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-vision-evidence-set-v1.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-v1-report.json \\
    --update-observations
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
