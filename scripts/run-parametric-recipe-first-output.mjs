#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  compileParametricRecipeCandidate,
  compileParametricRecipeFirstOutput
} from '../src/product-modeling/parametric-recipe.mjs';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const recipePath = path.resolve(repoRoot, options.recipe || 'examples/parametric-recipes/switch-thumbstick-variants.parametric-recipe.json');
  const partGraphPath = path.resolve(repoRoot, options.partGraph || 'examples/part-graphs/switch-controller-reference.part-graph.json');
  const profilePath = path.resolve(repoRoot, options.profile || 'examples/product-profiles/game_controller_switch.json');
  const recipe = await readJson(recipePath);
  const partGraph = await readJson(partGraphPath);
  const profile = await readJson(profilePath);
  const firstOutputReport = options.firstOutputReport
    ? await readJson(path.resolve(repoRoot, options.firstOutputReport))
    : null;
  const result = options.candidate
    ? compileParametricRecipeCandidate(recipe, {
      candidateId: options.candidate,
      firstOutputReport,
      partGraph,
      profile,
      compilePartGraphToSketchUpDsl,
      compileOptions: { repoRoot }
    })
    : compileParametricRecipeFirstOutput(recipe, {
      partGraph,
      profile,
      compilePartGraphToSketchUpDsl,
      compileOptions: { repoRoot }
    });

  const outputDir = path.resolve(
    repoRoot,
    options.outputDir || `output/parametric-recipes/${recipe.id}/${result.report.candidate_id}`
  );
  await fs.mkdir(outputDir, { recursive: true });
  const artifacts = {
    feature_mapping_plan: path.join(outputDir, 'feature-mapping-plan.json'),
    compile_report: path.join(outputDir, 'parametric-recipe-compile-report.json'),
    part_graph_correction_patch: path.join(outputDir, 'part-graph-correction-patch.json'),
    applied_part_graph: path.join(outputDir, 'part-graph.applied.json'),
    safe_json_dsl: path.join(outputDir, 'safe-json-dsl.json')
  };
  await writeJson(artifacts.feature_mapping_plan, result.featureMappingPlan);
  await writeJson(artifacts.compile_report, result.report);
  await writeJson(artifacts.part_graph_correction_patch, result.partGraphPatch);
  await writeJson(artifacts.applied_part_graph, result.appliedPartGraph);
  await writeJson(artifacts.safe_json_dsl, result.safeJsonDsl);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    recipe_id: recipe.id,
    candidate_id: result.report.candidate_id,
    artifacts,
    summary: result.report.summary
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--recipe') options.recipe = argv[++index];
    else if (arg === '--part-graph') options.partGraph = argv[++index];
    else if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--candidate') options.candidate = argv[++index];
    else if (arg === '--first-output-report') options.firstOutputReport = argv[++index];
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
  node scripts/run-parametric-recipe-first-output.mjs \\
    --recipe examples/parametric-recipes/switch-thumbstick-variants.parametric-recipe.json \\
    --part-graph examples/part-graphs/switch-controller-reference.part-graph.json \\
    --profile examples/product-profiles/game_controller_switch.json \\
    --output-dir output/parametric-recipes/switch-thumbstick-variants/baseline

Fanout candidates must pass --first-output-report from the baseline run.
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
