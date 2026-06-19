#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  buildVisionEvidenceReviewPatch,
  renderVisionEvidenceReviewPatchMarkdown
} from './lib/vision-evidence-set-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || null;
  const reportPath = options.report || null;
  const outputPath = resolveRepo(options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json');
  const markdownOutputPath = resolveRepo(options.markdownOutput || outputPath.replace(/\.json$/u, '.md'));

  const { visionEvidenceSet, source } = reportPath
    ? await readVisionEvidenceSetFromReport(reportPath)
    : await readVisionEvidenceSetFromObservations(observationsPath || 'projects/image-structured-modeler/examples/building-group/observations.json');
  const patch = buildVisionEvidenceReviewPatch({ visionEvidenceSet, source });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownOutputPath, renderVisionEvidenceReviewPatchMarkdown(patch), 'utf8');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: patch.status,
    review_items: patch.summary.total_items,
    ground_plane_items: patch.summary.ground_plane_items,
    edge_class_items: patch.summary.edge_class_items,
    apply_allowed: patch.apply_allowed,
    compile_allowed: patch.compile_allowed,
    output: path.relative(repoRoot || scriptRoot, outputPath),
    markdown_output: path.relative(repoRoot || scriptRoot, markdownOutputPath)
  }, null, 2)}\n`);
}

async function readVisionEvidenceSetFromObservations(relativePath) {
  const absolutePath = resolveRepo(relativePath);
  const observations = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  if (observations.vision_evidence_set_v1?.kind !== 'vision_evidence_set_v1') {
    throw new Error(`${relativePath} does not contain ObservationSet.vision_evidence_set_v1`);
  }
  return {
    visionEvidenceSet: observations.vision_evidence_set_v1,
    source: `${relativePath}#vision_evidence_set_v1`
  };
}

async function readVisionEvidenceSetFromReport(relativePath) {
  const absolutePath = resolveRepo(relativePath);
  const report = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  const visionEvidenceSet = report.vision_evidence_set_v1 || report.visionEvidenceSet || report;
  if (visionEvidenceSet?.kind !== 'vision_evidence_set_v1') {
    throw new Error(`${relativePath} does not contain a vision_evidence_set_v1 payload`);
  }
  return {
    visionEvidenceSet,
    source: `${relativePath}#vision_evidence_set_v1`
  };
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot || scriptRoot, value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') parsed.observations = argv[++index];
    else if (arg === '--report') parsed.report = argv[++index];
    else if (arg === '--output') parsed.output = argv[++index];
    else if (arg === '--markdown-output') parsed.markdownOutput = argv[++index];
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.observations && parsed.report) throw new Error('Use either --observations or --report, not both');
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-vision-evidence-review-patch.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
