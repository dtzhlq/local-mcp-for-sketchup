#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { generatePartGraphFromObservations } from './generate-part-graph-from-observations.mjs';
import { validateGroundingV3 } from './lib/grounding-v3.mjs';
import { repoRoot } from './lib/image-analysis.mjs';
import { makePhotoGradeRealSmokeSample } from './lib/photo-grade-real-smoke.mjs';
import { validatePhotoGradeReadiness } from './lib/photo-grade-readiness.mjs';
import { validateAutoGroundPlanR10 } from './lib/auto-ground-plan-r10.mjs';
import { validateGeometryFit } from './validate-geometry-fit.mjs';

const defaultOutputDir = 'projects/image-structured-modeler/examples/building-real-photo-smoke';
const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = resolveRepo(options.outputDir || defaultOutputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const profile = await readJson(options.profile || 'examples/product-profiles/building_group_industrial_campus.json');
  const {
    observations,
    fixture,
    sampleKind,
    inputAssetStatus
  } = makePhotoGradeRealSmokeSample();
  const partGraph = generatePartGraphFromObservations(observations, profile, {
    id: 'building-real-photo-smoke-part-graph',
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
  const photoGradeReadiness = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit,
    groundingV3,
    codeDocument: outputDsl,
    sampleId: 'building-real-photo-smoke',
    sampleKind,
    inputAssetStatus
  });
  const autoGroundPlanR10 = validateAutoGroundPlanR10({ observations, groundingV3 });

  await writeJson(path.join(outputDir, 'observations.json'), observations);
  await writeJson(path.join(outputDir, 'visual-relations.fixture.json'), fixture);
  await writeJson(path.join(outputDir, 'part-graph.massing.json'), partGraph);
  await writeJson(path.join(outputDir, 'output.massing.json'), outputDsl);
  await writeJson(path.join(outputDir, 'geometry-fit-report.json'), geometryFit);
  await writeJson(path.join(outputDir, 'grounding-v3-report.json'), groundingV3);
  await writeJson(path.join(outputDir, 'structured-plan-qa-report.json'), autoGroundPlanR10);
  await writeJson(path.join(outputDir, 'photo-grade-readiness-report.json'), photoGradeReadiness);

  process.stdout.write(`${JSON.stringify({
    ok: photoGradeReadiness.ok,
    verdict: photoGradeReadiness.verdict,
    photo_grade_readiness: photoGradeReadiness.photo_grade_readiness,
    photo_grade_candidate: photoGradeReadiness.photo_grade_candidate,
    output_dir: path.relative(repoRoot, outputDir),
    input_asset_status: inputAssetStatus,
    parts: partGraph.parts.length,
    grounding_v3: groundingV3.verdict,
    auto_ground_plan_r10: autoGroundPlanR10.verdict,
    auto_ground_plan_gap_ratio: autoGroundPlanR10.summary.gap_ratio,
    blockers: photoGradeReadiness.summary.blockers
  }, null, 2)}\n`);
  if (options.requireOk && !photoGradeReadiness.ok) process.exit(1);
  if (options.requireCandidate && !photoGradeReadiness.photo_grade_candidate) process.exit(1);
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
    else if (arg === '--require-ok') parsed.requireOk = true;
    else if (arg === '--require-candidate') parsed.requireCandidate = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-photo-grade-real-smoke.mjs \\
    --output-dir projects/image-structured-modeler/examples/building-real-photo-smoke
`);
  process.exit(0);
}

await main();
