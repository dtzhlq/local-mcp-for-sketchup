#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { compilePartGraphFiles } from '../src/product-modeling/part-graph-compiler.mjs';

const options = parseArgs(process.argv.slice(2));
try {
  const document = await compilePartGraphFiles({
    profilePath: options.profile,
    partGraphPath: options.partGraph,
    repoRoot: options.repoRoot || process.cwd()
  });
  const rendered = `${JSON.stringify(document, null, 2)}\n`;

  if (options.output) {
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    await fs.writeFile(options.output, rendered, 'utf8');
  } else {
    process.stdout.write(rendered);
  }
} catch (error) {
  if (options.output) await fs.rm(options.output, { force: true });
  throw error;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') parsed.profile = argv[++index];
    else if (arg === '--part-graph' || arg === '--input') parsed.partGraph = argv[++index];
    else if (arg === '--output') parsed.output = argv[++index];
    else if (arg === '--repo-root') parsed.repoRoot = argv[++index];
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed.profile) throw new Error('--profile is required');
  if (!parsed.partGraph) throw new Error('--part-graph is required');
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node scripts/compile-part-graph-to-sketchup-dsl.mjs \\
    --profile examples/product-profiles/vehicle_ambulance.json \\
    --part-graph examples/part-graphs/ambulance-reference.part-graph.json \\
    --output examples/acceptance-ambulance-reference.json
`);
  process.exit(0);
}
