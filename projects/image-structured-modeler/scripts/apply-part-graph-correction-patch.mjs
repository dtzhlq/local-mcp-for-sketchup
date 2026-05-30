#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  applyCorrectionPatch,
  buildCorrectionPatchFromReferenceReport,
  summarizeCorrectionPatch
} from './lib/part-graph-corrections.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const partGraphPath = path.resolve(repoRoot, options.partGraph || 'projects/image-structured-modeler/examples/ambulance/part-graph.generated.json');
  const outputPatchPath = path.resolve(repoRoot, options.outputPatch || 'projects/image-structured-modeler/examples/ambulance/correction-patch.reference-visual.json');
  const outputPartGraphPath = options.outputPartGraph
    ? path.resolve(repoRoot, options.outputPartGraph)
    : null;

  const partGraph = await readJson(partGraphPath);
  const patch = options.patch
    ? await readJson(path.resolve(repoRoot, options.patch))
    : buildCorrectionPatchFromReferenceReport(
      partGraph,
      await readJson(path.resolve(repoRoot, options.referenceReport)),
      { gain: numberOption(options.gain, 1) }
    );

  await fs.mkdir(path.dirname(outputPatchPath), { recursive: true });
  await fs.writeFile(outputPatchPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');

  let applied = [];
  if (outputPartGraphPath) {
    const result = applyCorrectionPatch(partGraph, patch);
    applied = result.applied;
    await fs.mkdir(path.dirname(outputPartGraphPath), { recursive: true });
    await fs.writeFile(outputPartGraphPath, `${JSON.stringify(result.partGraph, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    patch: outputPatchPath,
    output_part_graph: outputPartGraphPath,
    summary: summarizeCorrectionPatch(patch),
    applied: applied.length
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--part-graph') options.partGraph = argv[++index];
    else if (arg === '--reference-report') options.referenceReport = argv[++index];
    else if (arg === '--patch') options.patch = argv[++index];
    else if (arg === '--output-patch') options.outputPatch = argv[++index];
    else if (arg === '--output-part-graph') options.outputPartGraph = argv[++index];
    else if (arg === '--gain') options.gain = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.patch && !options.referenceReport) throw new Error('--reference-report or --patch is required');
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/apply-part-graph-correction-patch.mjs \\
    --part-graph projects/image-structured-modeler/examples/ambulance/part-graph.generated.json \\
    --reference-report output/reference-visual-qa/ambulance-generated/report.json \\
    --output-patch projects/image-structured-modeler/examples/ambulance/correction-patch.reference-visual.json \\
    --output-part-graph projects/image-structured-modeler/examples/ambulance/part-graph.corrected.json
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function numberOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
