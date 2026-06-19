#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  validateRealWorldBuildingPositiveManifestPath
} from './lib/real-world-building-release-sample.mjs';

const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/real-world-building-positive-manifest';

export async function validateRealWorldBuildingReleaseSampleCli({
  manifestPath = DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  outputDir = DEFAULT_OUTPUT_DIR,
  requirePresent = false
} = {}) {
  return await validateRealWorldBuildingPositiveManifestPath({
    manifestPath,
    outputDir,
    allowMissing: !requirePresent
  });
}

function parseArgs(argv) {
  const options = {
    manifestPath: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
    outputDir: DEFAULT_OUTPUT_DIR,
    requirePresent: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') options.manifestPath = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--require-present') options.requirePresent = true;
    else if (arg === '--allow-missing') options.requirePresent = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  validateRealWorldBuildingReleaseSampleCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.status,
        manifest_present: result.metrics.manifest_present,
        closes_release_gap: result.metrics.closes_release_gap,
        release_gap: result.metrics.release_gap || null,
        summary: path.join(options.outputDir, 'manifest-contract-summary.json'),
        release_checklist: result.metrics.manifest_present
          ? path.join(options.outputDir, 'release-checklist.json')
          : null,
        release_checklist_markdown: result.metrics.manifest_present
          ? path.join(options.outputDir, 'release-checklist.md')
          : null,
        error: result.error || null
      }, null, 2)}\n`);
      if (!result.ok) process.exit(1);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
