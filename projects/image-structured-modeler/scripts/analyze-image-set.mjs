#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  analyzeImage,
  applyViewHints,
  assignViewKinds,
  listImageFiles,
  makeImageSetObservation,
  readViewHints,
  renderObservationOverlay,
  repoRoot,
  subprojectRoot
} from './lib/image-analysis.mjs';
import { annotateObservationSetWithBirdEyeLandCoverV1 } from './lib/bird-eye-land-cover.mjs';
import { annotateObservationSetWithBoundaryGraphV1 } from './lib/boundary-graph-v1.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(repoRoot, options.input || 'test/手柄');
  const output = path.resolve(repoRoot, options.output || 'projects/image-structured-modeler/examples/switch-controller/observations.json');
  const overlayDir = options.overlayDir
    ? path.resolve(repoRoot, options.overlayDir)
    : path.join(subprojectRoot, 'examples', 'switch-controller', 'review-overlays');

  const imageFiles = await listImageFiles(input);
  const analyses = [];
  for (const imageFile of imageFiles) {
    analyses.push(await analyzeImage(imageFile, {
      maxDimension: Number(options.maxDimension || 900),
      edgeThreshold: options.edgeThreshold ? Number(options.edgeThreshold) : undefined
    }));
  }

  const viewHints = options.viewHintsFile
    ? await readViewHints(path.resolve(repoRoot, options.viewHintsFile))
    : null;
  const assignedViews = applyViewHints(assignViewKinds(analyses), viewHints);
  let observationSet = makeImageSetObservation({
    objectType: options.objectType || 'game_controller',
    objectName: options.objectName || 'Switch Joy-Con Grip Controller',
    analyses,
    assignedViews,
    overlayDir
  });
  observationSet = await annotateObservationSetWithBirdEyeLandCoverV1(observationSet);
  observationSet = await annotateObservationSetWithBoundaryGraphV1(observationSet);

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(observationSet, null, 2)}\n`, 'utf8');

  if (options.writeOverlays !== false) {
    await fs.mkdir(overlayDir, { recursive: true });
    for (const observation of observationSet.images) {
      const base = path.basename(observation.image.path).replace(/\.[^.]+$/, '');
      await renderObservationOverlay(observation, path.join(overlayDir, `${base}-overlay.png`));
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    images: observationSet.images.length,
    views_detected: observationSet.views_detected,
    missing_views: observationSet.missing_views,
    output,
    overlay_dir: overlayDir
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--object-type') options.objectType = argv[++index];
    else if (arg === '--object-name') options.objectName = argv[++index];
    else if (arg === '--overlay-dir') options.overlayDir = argv[++index];
    else if (arg === '--view-hints-file') options.viewHintsFile = argv[++index];
    else if (arg === '--max-dimension') options.maxDimension = argv[++index];
    else if (arg === '--edge-threshold') options.edgeThreshold = argv[++index];
    else if (arg === '--no-overlays') options.writeOverlays = false;
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
  node projects/image-structured-modeler/scripts/analyze-image-set.mjs \\
    --input test/手柄 \\
    --output projects/image-structured-modeler/examples/switch-controller/observations.json

Options:
  --object-type <type>       Object category for the image set.
  --object-name <name>       Human-readable object name.
  --overlay-dir <path>       Directory for generated review overlays.
  --view-hints-file <path>   Optional model-plan-like JSON whose views[] override CV view labels.
  --max-dimension <px>       Analysis resize bound. Default: 900.
  --edge-threshold <value>   Override automatic Sobel threshold.
  --no-overlays              Only write JSON observations.
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
