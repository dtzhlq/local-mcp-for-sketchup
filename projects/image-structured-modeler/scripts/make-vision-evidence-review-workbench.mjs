#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  buildAcceptedVisionEvidenceReviewDecision,
  renderVisionEvidenceReviewWorkbenchHtml
} from './lib/vision-evidence-set-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reviewPatchPath = resolveRepo(options.reviewPatch || 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json');
  const outputDir = resolveRepo(options.outputDir || 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review');
  const outputPath = path.join(outputDir, 'index.html');
  const reviewPatch = await readJson(reviewPatchPath);
  const initialDecision = buildAcceptedVisionEvidenceReviewDecision({
    reviewPatch,
    reviewer: options.reviewer || 'vision-evidence-workbench',
    acceptedAt: options.acceptedAt || '2026-06-17',
    sourceReviewPatch: path.relative(repoRoot || scriptRoot, reviewPatchPath)
  });
  const html = renderVisionEvidenceReviewWorkbenchHtml({
    reviewPatch,
    initialDecision,
    title: options.title || 'Vision Evidence Review Workbench'
  });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: path.relative(repoRoot || scriptRoot, outputPath),
    review_items: reviewPatch.summary?.total_items ?? 0,
    initial_decision_status: initialDecision.status,
    compile_allowed: initialDecision.compile_allowed,
    geometry_promotion_allowed: initialDecision.geometry_promotion_allowed
  }, null, 2)}\n`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot || scriptRoot, value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--review-patch') parsed.reviewPatch = argv[++index];
    else if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--reviewer') parsed.reviewer = argv[++index];
    else if (arg === '--accepted-at') parsed.acceptedAt = argv[++index];
    else if (arg === '--title') parsed.title = argv[++index];
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/make-vision-evidence-review-workbench.mjs \\
    --review-patch projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json \\
    --output-dir projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
