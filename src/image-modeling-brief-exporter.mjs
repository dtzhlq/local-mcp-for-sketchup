#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMcpModelingBrief,
  renderMcpModelingBriefMarkdown
} from './image-modeling-brief.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function exportMcpModelingBriefCli({
  inputDir,
  assetSetPath = null,
  observationsPath = null,
  candidateGraphPath = null,
  modelingBriefPath = null,
  promotionReviewPath = null,
  sourcePackagePath = null,
  outputJson = null,
  outputMarkdown = null,
  maxCandidates = 80
} = {}) {
  if (!inputDir && (!assetSetPath || !observationsPath || !candidateGraphPath || !modelingBriefPath)) {
    throw new Error('inputDir or all explicit artifact paths are required');
  }
  const baseDir = inputDir ? resolveRepo(inputDir) : null;
  const paths = {
    assetSet: resolveInputPath(assetSetPath, baseDir, 'asset-set.json'),
    observations: resolveInputPath(observationsPath, baseDir, 'observations.json'),
    candidateGraph: resolveInputPath(candidateGraphPath, baseDir, 'candidate-graph.json'),
    modelingBrief: resolveInputPath(modelingBriefPath, baseDir, 'modeling-brief.json'),
    sourcePackage: sourcePackagePath
      ? resolveRepo(sourcePackagePath)
      : baseDir
        ? path.join(baseDir, 'real-world-building-source-package.json')
        : null,
    promotionReview: promotionReviewPath
      ? resolveRepo(promotionReviewPath)
      : baseDir
        ? path.join(baseDir, 'candidate-promotion-review.draft.json')
        : null
  };
  const promotionReview = paths.promotionReview && await pathExists(paths.promotionReview)
    ? await readJson(paths.promotionReview)
    : null;
  const sourcePackageAssessment = paths.sourcePackage && await pathExists(paths.sourcePackage)
    ? await readJson(paths.sourcePackage)
    : null;
  const brief = buildMcpModelingBrief({
    assetSet: await readJson(paths.assetSet),
    observationSet: await readJson(paths.observations),
    candidateGraph: await readJson(paths.candidateGraph),
    modelingBrief: await readJson(paths.modelingBrief),
    promotionReview,
    sourcePackageAssessment,
    source: {
      asset_set: toRepoRelative(paths.assetSet),
      observation_set: toRepoRelative(paths.observations),
      candidate_graph: toRepoRelative(paths.candidateGraph),
      modeling_brief: toRepoRelative(paths.modelingBrief),
      ...(sourcePackageAssessment ? { source_package: toRepoRelative(paths.sourcePackage) } : {}),
      ...(promotionReview ? { promotion_review: toRepoRelative(paths.promotionReview) } : {})
    },
    maxCandidates
  });
  const resolvedOutputJson = resolveRepo(outputJson || (baseDir ? path.join(baseDir, 'mcp-modeling-brief.json') : 'output/image-structured-modeler/mcp-modeling-brief.json'));
  const resolvedOutputMarkdown = resolveRepo(outputMarkdown || (baseDir ? path.join(baseDir, 'mcp-modeling-brief.md') : 'output/image-structured-modeler/mcp-modeling-brief.md'));
  await writeJson(resolvedOutputJson, brief);
  await fs.mkdir(path.dirname(resolvedOutputMarkdown), { recursive: true });
  await fs.writeFile(resolvedOutputMarkdown, renderMcpModelingBriefMarkdown(brief), 'utf8');
  return {
    ok: true,
    brief,
    outputJson: resolvedOutputJson,
    outputMarkdown: resolvedOutputMarkdown
  };
}

function resolveInputPath(explicitPath, baseDir, fileName) {
  if (explicitPath) return resolveRepo(explicitPath);
  if (!baseDir) throw new Error(`${fileName} path is required without --input-dir`);
  return path.join(baseDir, fileName);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath) || '.';
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input-dir') options.inputDir = argv[++index];
    else if (arg === '--asset-set') options.assetSetPath = argv[++index];
    else if (arg === '--observations') options.observationsPath = argv[++index];
    else if (arg === '--candidate-graph') options.candidateGraphPath = argv[++index];
    else if (arg === '--modeling-brief') options.modelingBriefPath = argv[++index];
    else if (arg === '--promotion-review') options.promotionReviewPath = argv[++index];
    else if (arg === '--source-package') options.sourcePackagePath = argv[++index];
    else if (arg === '--output-json') options.outputJson = argv[++index];
    else if (arg === '--output-md' || arg === '--output-markdown') options.outputMarkdown = argv[++index];
    else if (arg === '--max-candidates') options.maxCandidates = Number(argv[++index]);
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
  node src/image-modeling-brief-exporter.mjs \\
    --input-dir output/image-structured-modeler/building-single-intake-test

Options:
  --input-dir <dir>          Directory containing asset-set, observations, candidate-graph, and modeling-brief JSON.
  --promotion-review <path>  Optional candidate_promotion_review JSON.
  --source-package <path>    Optional real-world-building-source-package.json.
  --output-json <path>       Output JSON path. Defaults to <input-dir>/mcp-modeling-brief.json.
  --output-md <path>         Output Markdown path. Defaults to <input-dir>/mcp-modeling-brief.md.
  --max-candidates <n>       Max candidate catalog rows. Defaults to 80.
`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  exportMcpModelingBriefCli(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        output_json: toRepoRelative(result.outputJson),
        output_markdown: toRepoRelative(result.outputMarkdown),
        can_generate_sketchup_dsl: result.brief.compile_permission.can_generate_sketchup_dsl,
        candidates: result.brief.candidate_summary.candidate_count,
        blockers: result.brief.compile_permission.reasons
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
