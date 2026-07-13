#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCalibrationBenchmark } from './run-calibration-benchmark.mjs';

const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/yellow-axis-calibration';

export async function generateYellowAxisCalibrationWorkbench(options = {}) {
  return runCalibrationBenchmark({
    outputDir: options.outputDir || DEFAULT_OUTPUT_DIR,
    truth: options.truth,
    topologySeed: options.topologySeed
  });
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output-dir') options.outputDir = args[++index];
    else if (args[index] === '--truth') options.truth = args[++index];
    else if (args[index] === '--topology-seed') options.topologySeed = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateYellowAxisCalibrationWorkbench(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        output_dir: result.outputDir,
        backend: result.structureLineEvidence.backend.id,
        raw_segments: result.structureLineEvidence.summary.raw_segment_count,
        eligible_segments: result.structureLineEvidence.summary.eligible_segment_count,
        seed_segments: result.structureLineEvidence.summary.seed_segment_count,
        horizontal_families: result.perspectiveCalibration.summary.horizontal_family_count,
        vertical_families: result.perspectiveCalibration.summary.vertical_family_count,
        calibration_status: result.pendingReviewResult.status,
        topology_status: result.pendingTopologyReviewResult.status,
        promotion_allowed: false
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
