#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { validateAutoGroundPlanR10 } from './lib/auto-ground-plan-r10.mjs';
import {
  annotateObservationSetWithBirdEyeLandCoverV1,
  landCoverReport,
  renderBirdEyeSegmentationArtifact
} from './lib/bird-eye-land-cover.mjs';
import { annotateObservationSetWithHighContrastEdgeV1 } from './lib/high-contrast-edge-v1.mjs';
import { annotateObservationSetWithOpenCvEdgeV1 } from './lib/opencv-edge-v1.mjs';
import {
  annotateObservationSetWithBoundaryGraphV1,
  boundaryGraphReport
} from './lib/boundary-graph-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputDir = resolveRepo(options.outputDir || 'projects/image-structured-modeler/examples/building-group/structured-plan');
  let observations = await annotateObservationSetWithBirdEyeLandCoverV1(await readJson(observationsPath), { force: options.force });
  observations = await annotateObservationSetWithHighContrastEdgeV1(observations, { force: options.force });
  observations = await annotateObservationSetWithOpenCvEdgeV1(observations, {
    force: options.force,
    output: path.join(outputDir, 'opencv-edge-v1-report.json'),
    outputDir
  });
  observations = await annotateObservationSetWithBoundaryGraphV1(observations, { force: options.force });
  const groundPlan = validateAutoGroundPlanR10({ observations });
  const artifact = await renderBirdEyeSegmentationArtifact({
    observations,
    landCover: observations.land_cover_v1,
    boundaryGraph: observations.boundary_graph_v1,
    autoGroundPlan: groundPlan.auto_ground_plan,
    outputDir,
    basename: options.basename || 'bird-eye-segmentation'
  });
  const report = landCoverReport(observations.land_cover_v1);
  const boundaryReport = boundaryGraphReport(observations.boundary_graph_v1);
  await writeJson(path.join(outputDir, 'land-cover-v1-report.json'), report);
  await writeJson(path.join(outputDir, 'boundary-graph-v1-report.json'), boundaryReport);

  process.stdout.write(`${JSON.stringify({
    ok: groundPlan.ok && report.ok,
    verdict: groundPlan.verdict,
    land_cover_verdict: report.verdict,
    boundary_graph_verdict: boundaryReport.verdict,
    png: path.relative(repoRoot, artifact.pngPath),
    svg: path.relative(repoRoot, artifact.svgPath),
    remaining_unknown_gap_ratio: groundPlan.summary.remaining_unknown_gap_ratio,
    unknown_land_cover_ratio: report.summary.unknown_land_cover_ratio,
    road_corridor_count: boundaryReport.summary.road_corridor_count
  }, null, 2)}\n`);

  if (options.requireOk && (!groundPlan.ok || !report.ok)) process.exit(1);
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
    else if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--basename') parsed.basename = argv[++index];
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--require-ok') parsed.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/make-bird-eye-segmentation.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output-dir projects/image-structured-modeler/examples/building-group/structured-plan
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
