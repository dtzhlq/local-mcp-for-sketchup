#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  annotateObservationSetWithHighContrastEdgeV1,
  buildHighContrastEdgeV1,
  highContrastEdgeReport,
  renderHighContrastEdgeArtifacts
} from './lib/high-contrast-edge-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/edge-v1-report.json';
  const outputDir = resolveRepo(options.outputDir || path.dirname(outputPath));
  const observations = await readJson(observationsPath);
  const nextObservations = await annotateObservationSetWithHighContrastEdgeV1(observations, { force: options.force });
  const highContrastEdge = nextObservations.high_contrast_edge_v1 || await buildHighContrastEdgeV1({ observations: nextObservations });
  const report = highContrastEdgeReport(highContrastEdge);

  if (options.updateObservations) await writeJson(resolveRepo(observationsPath), nextObservations);
  if (outputPath) await writeJson(resolveRepo(outputPath), report);
  const artifacts = await renderHighContrastEdgeArtifacts({
    observations: nextObservations,
    highContrastEdge,
    outputDir,
    basename: 'edge'
  });

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    accepted_edge_count: report.summary.accepted_edge_count,
    rejected_edge_count: report.summary.rejected_edge_count,
    site_perimeter_confidence: report.summary.site_perimeter_confidence,
    road_boundary_confidence: report.summary.road_boundary_confidence,
    roof_seam_rejection_count: report.summary.roof_seam_rejection_count,
    output: outputPath,
    preprocess_png: path.relative(repoRoot, artifacts.preprocessPngPath),
    classification_png: path.relative(repoRoot, artifacts.classificationPngPath)
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
    else if (arg === '--update-observations') parsed.updateObservations = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--require-ok') parsed.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-high-contrast-edge-v1.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/edge-v1-report.json \\
    --output-dir projects/image-structured-modeler/examples/building-group/structured-plan \\
    --update-observations
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
