#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  annotateObservationSetWithBirdEyeLandCoverV1,
  buildBirdEyeLandCoverV1,
  landCoverReport
} from './lib/bird-eye-land-cover.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/land-cover-v1-report.json';
  const observations = await readJson(observationsPath);
  const nextObservations = await annotateObservationSetWithBirdEyeLandCoverV1(observations, { force: options.force });
  const landCover = nextObservations.land_cover_v1 || await buildBirdEyeLandCoverV1({ observations });
  const report = landCoverReport(landCover);

  if (options.updateObservations) await writeJson(resolveRepo(observationsPath), nextObservations);
  if (outputPath) await writeJson(resolveRepo(outputPath), report);

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    backend: report.summary.backend,
    masks: report.summary.masks,
    tiles: report.summary.tiles,
    unknown_land_cover_ratio: report.summary.unknown_land_cover_ratio,
    paved_surface_ratio: report.summary.paved_surface_ratio,
    vegetation_ratio: report.summary.vegetation_ratio,
    boundary_confidence: report.summary.boundary_confidence,
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
    else if (arg === '--require-ok') parsed.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-bird-eye-land-cover.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/land-cover-v1-report.json \\
    --update-observations
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
