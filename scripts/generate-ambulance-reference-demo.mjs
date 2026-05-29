#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { compilePartGraphFiles } from '../src/product-modeling/part-graph-compiler.mjs';

const DEFAULT_PROFILE = 'examples/product-profiles/vehicle_ambulance.json';
const DEFAULT_PART_GRAPH = 'examples/part-graphs/ambulance-reference.part-graph.json';

const options = parseArgs(process.argv.slice(2));
const document = await compilePartGraphFiles({
  profilePath: options.profile || DEFAULT_PROFILE,
  partGraphPath: options.partGraph || DEFAULT_PART_GRAPH,
  repoRoot: process.cwd()
});
const rendered = `${JSON.stringify(document, null, 2)}\n`;

if (options.output) {
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, rendered, 'utf8');
} else {
  process.stdout.write(rendered);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') parsed.output = argv[++index];
    else if (arg === '--profile') parsed.profile = argv[++index];
    else if (arg === '--part-graph' || arg === '--input') parsed.partGraph = argv[++index];
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/generate-ambulance-reference-demo.mjs \\
    --output examples/acceptance-ambulance-reference.json

Optional:
  --profile examples/product-profiles/vehicle_ambulance.json
  --part-graph examples/part-graphs/ambulance-reference.part-graph.json
`);
  process.exit(0);
}
