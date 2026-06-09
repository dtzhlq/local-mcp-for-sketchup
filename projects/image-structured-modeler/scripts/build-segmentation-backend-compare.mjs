#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { annotateObservationSetWithBirdEyeLandCoverV1 } from './lib/bird-eye-land-cover.mjs';
import {
  buildSegmentationBackendCompare,
  renderSegmentationBackendCompareArtifact,
  segmentationBackendCompareReport
} from './lib/segmentation-backend-compare.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/segmentation-backend-compare-report.json';
  const outputDir = resolveRepo(options.outputDir || path.dirname(outputPath));
  let observations = await annotateObservationSetWithBirdEyeLandCoverV1(await readJson(observationsPath), { force: options.forceLandCover });
  const compare = await buildSegmentationBackendCompare({
    observations,
    options: {
      referenceMaskBank: options.referenceMaskBank,
      enableInsid3: options.enableInsid3,
      insid3Root: options.insid3Root,
      dinoV3Weights: options.dinoV3Weights
    }
  });
  observations = {
    ...observations,
    segmentation_backend_compare_v1: compare,
    observed_mask_candidates: compare.observed_mask_candidates
  };
  const report = segmentationBackendCompareReport(compare);
  if (options.updateObservations) await writeJson(resolveRepo(observationsPath), observations);
  if (outputPath) await writeJson(resolveRepo(outputPath), report);
  const artifact = await renderSegmentationBackendCompareArtifact({
    observations,
    compare,
    outputDir
  });

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    insid3_status: report.summary.insid3_status,
    insid3_available: report.summary.insid3_available,
    fused_observed_mask_count: report.summary.fused_observed_mask_count,
    promoted_geometry_count: report.summary.promoted_geometry_count,
    output: outputPath,
    png: path.relative(repoRoot, artifact.pngPath)
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
    else if (arg === '--reference-mask-bank') parsed.referenceMaskBank = argv[++index];
    else if (arg === '--insid3-root') parsed.insid3Root = argv[++index];
    else if (arg === '--dinov3-weights') parsed.dinoV3Weights = argv[++index];
    else if (arg === '--enable-insid3') parsed.enableInsid3 = true;
    else if (arg === '--update-observations') parsed.updateObservations = true;
    else if (arg === '--force-land-cover') parsed.forceLandCover = true;
    else if (arg === '--require-ok') parsed.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-segmentation-backend-compare.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/segmentation-backend-compare-report.json \\
    --output-dir projects/image-structured-modeler/examples/building-group/structured-plan \\
    --update-observations
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
