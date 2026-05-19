#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { renderObservationOverlay, repoRoot, subprojectRoot } from './lib/image-analysis.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(repoRoot, options.input || 'projects/image-structured-modeler/examples/switch-controller/observations.json');
  const outputDir = path.resolve(repoRoot, options.outputDir || path.join(subprojectRoot, 'examples', 'switch-controller', 'review-overlays'));
  const raw = await fs.readFile(input, 'utf8');
  const observationSet = JSON.parse(raw);

  await fs.mkdir(outputDir, { recursive: true });
  const overlays = [];
  for (const observation of observationSet.images || []) {
    const base = path.basename(observation.image.path).replace(/\.[^.]+$/, '');
    const outputPath = path.join(outputDir, `${base}-overlay.png`);
    overlays.push(await renderObservationOverlay(observation, outputPath));
  }

  process.stdout.write(`${JSON.stringify({ ok: true, count: overlays.length, output_dir: outputDir, overlays }, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/make-review-overlay.mjs \\
    --input projects/image-structured-modeler/examples/switch-controller/observations.json \\
    --output-dir projects/image-structured-modeler/examples/switch-controller/review-overlays
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
