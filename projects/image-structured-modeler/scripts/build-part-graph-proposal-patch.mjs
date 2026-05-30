#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  applyCorrectionPatch,
  buildCorrectionPatchFromParameterProposals,
  summarizeCorrectionPatch
} from './lib/part-graph-corrections.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const partGraphPath = path.resolve(repoRoot, options.partGraph || 'projects/image-structured-modeler/examples/ambulance/part-graph.skeleton.json');
  const reviewPath = options.review
    ? path.resolve(repoRoot, options.review)
    : null;
  const outputPatchPath = path.resolve(repoRoot, options.outputPatch || 'projects/image-structured-modeler/examples/ambulance/correction-patch.parameter-proposals.json');
  const outputPartGraphPath = options.outputPartGraph
    ? path.resolve(repoRoot, options.outputPartGraph)
    : null;

  const partGraph = await readJson(partGraphPath);
  const review = reviewPath ? await readJson(reviewPath) : {};
  const patch = buildCorrectionPatchFromParameterProposals(partGraph, review, {
    markEvidenceStatus: options.markEvidenceStatus
  });

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
    else if (arg === '--review') options.review = argv[++index];
    else if (arg === '--output-patch') options.outputPatch = argv[++index];
    else if (arg === '--output-part-graph') options.outputPartGraph = argv[++index];
    else if (arg === '--mark-evidence-status') options.markEvidenceStatus = argv[++index];
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
  node projects/image-structured-modeler/scripts/build-part-graph-proposal-patch.mjs \\
    --part-graph projects/image-structured-modeler/examples/ambulance/part-graph.skeleton.json \\
    --review projects/image-structured-modeler/examples/ambulance/parameter-proposal-review.accepted.json \\
    --output-patch projects/image-structured-modeler/examples/ambulance/correction-patch.parameter-proposals.json \\
    --output-part-graph projects/image-structured-modeler/examples/ambulance/part-graph.proposal-applied.json
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
