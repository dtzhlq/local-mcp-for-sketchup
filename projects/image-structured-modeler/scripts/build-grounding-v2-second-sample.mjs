#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { generatePartGraphFromObservations } from './generate-part-graph-from-observations.mjs';
import { makeGroundingV2SecondBuildingGroupSample } from './lib/grounding-v2-second-sample.mjs';
import { validateGroundingV3 } from './lib/grounding-v3.mjs';
import { repoRoot } from './lib/image-analysis.mjs';
import { validateGeometryFit } from './validate-geometry-fit.mjs';

const defaultOutputDir = 'projects/image-structured-modeler/examples/building-group-second';
const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = resolveRepo(options.outputDir || defaultOutputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const profile = await readJson(options.profile || 'examples/product-profiles/building_group_industrial_campus.json');
  const { observations, fixture } = makeGroundingV2SecondBuildingGroupSample();
  const partGraph = generatePartGraphFromObservations(observations, profile, {
    id: 'building-group-grounding-v2-second-sample-part-graph',
    productName: observations.object.name
  });
  const outputDsl = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  const geometryFit = await validateGeometryFit({
    observations,
    fixture,
    code: JSON.stringify(outputDsl),
    mockSessionPath: path.join(outputDir, 'geometry-fit-mock-session.json')
  });
  const groundingV3 = validateGroundingV3({
    observations,
    fixture,
    geometryFit,
    codeDocument: outputDsl
  });

  await writeJson(path.join(outputDir, 'observations.json'), observations);
  await writeJson(path.join(outputDir, 'visual-relations.fixture.json'), fixture);
  await writeJson(path.join(outputDir, 'part-graph.massing.json'), partGraph);
  await writeJson(path.join(outputDir, 'output.massing.json'), outputDsl);
  await writeJson(path.join(outputDir, 'geometry-fit-report.json'), geometryFit);
  await writeJson(path.join(outputDir, 'grounding-v3-report.json'), groundingV3);

  process.stdout.write(`${JSON.stringify({
    ok: geometryFit.ok,
    verdict: geometryFit.verdict,
    output_dir: path.relative(repoRoot, outputDir),
    parts: partGraph.parts.length,
    part_candidate_proposals: partGraph.review?.part_candidate_proposals?.length || 0,
    checked_footprints: geometryFit.summary.checked_footprints,
    checked_relations: geometryFit.summary.checked_relations,
    checked_scale_anchors: geometryFit.summary.checked_scale_anchors,
    grounding_v3: groundingV3.verdict,
    grounding_v3_regions: groundingV3.summary.checked_ground_regions,
    dense_detail_helper_ratio: geometryFit.summary.dense_detail_helper_ratio
  }, null, 2)}\n`);
  if (options.requirePass && !geometryFit.ok) process.exit(1);
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
    if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--profile') parsed.profile = argv[++index];
    else if (arg === '--require-pass') parsed.requirePass = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-grounding-v2-second-sample.mjs \\
    --output-dir projects/image-structured-modeler/examples/building-group-second
`);
  process.exit(0);
}

await main();
