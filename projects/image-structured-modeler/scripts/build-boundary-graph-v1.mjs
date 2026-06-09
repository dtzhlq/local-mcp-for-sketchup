#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { annotateObservationSetWithBirdEyeLandCoverV1 } from './lib/bird-eye-land-cover.mjs';
import { annotateObservationSetWithHighContrastEdgeV1 } from './lib/high-contrast-edge-v1.mjs';
import { annotateObservationSetWithOpenCvEdgeV1 } from './lib/opencv-edge-v1.mjs';
import {
  annotateObservationSetWithBoundaryGraphV1,
  boundaryGraphReport,
  buildBoundaryGraphV1
} from './lib/boundary-graph-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/boundary-graph-v1-report.json';
  const outputDir = path.dirname(outputPath);
  const observations = await readJson(observationsPath);
  let nextObservations = await annotateObservationSetWithBirdEyeLandCoverV1(observations, { force: options.forceLandCover });
  nextObservations = await annotateObservationSetWithHighContrastEdgeV1(nextObservations, { force: options.forceHighContrast || options.force });
  nextObservations = await annotateObservationSetWithOpenCvEdgeV1(nextObservations, {
    force: options.forceOpenCv || options.force,
    output: path.join(outputDir, 'opencv-edge-v1-report.json'),
    outputDir,
    requireOpenCv: options.requireOpenCv
  });
  nextObservations = await annotateObservationSetWithBoundaryGraphV1(nextObservations, { force: options.force });
  const boundaryGraph = nextObservations.boundary_graph_v1 || buildBoundaryGraphV1({
    observations: nextObservations,
    landCover: nextObservations.land_cover_v1
  });
  const report = boundaryGraphReport(boundaryGraph);

  if (options.updateObservations) await writeJson(resolveRepo(observationsPath), nextObservations);
  if (outputPath) await writeJson(resolveRepo(outputPath), report);

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    observed_edges: report.summary.observed_edges,
    completed_edges: report.summary.completed_edges,
    road_corridor_count: report.summary.road_corridor_count,
    site_boundary_closure_ratio: report.summary.site_boundary_closure_ratio,
    observed_edge_coverage_ratio: report.summary.observed_edge_coverage_ratio,
    opencv_boundary_edge_count: report.summary.opencv_boundary_edge_count,
    high_contrast_boundary_edge_count: report.summary.high_contrast_boundary_edge_count,
    inferred_geometry_area_ratio: report.summary.inferred_geometry_area_ratio,
    output: outputPath
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
  node projects/image-structured-modeler/scripts/build-boundary-graph-v1.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/boundary-graph-v1-report.json \\
    --update-observations
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
