#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  applyVisionEvidencePolicyCorrectionPatch,
  buildAcceptedVisionEvidenceReviewDecision,
  buildVisionEvidencePolicyCorrectionPatch,
  renderVisionEvidencePolicyCorrectionPatchMarkdown
} from './lib/vision-evidence-set-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reviewPatchPath = resolveRepo(options.reviewPatch || 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json');
  const outputPath = resolveRepo(options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-policy-correction-patch.json');
  const markdownOutputPath = resolveRepo(options.markdownOutput || outputPath.replace(/\.json$/u, '.md'));
  const decisionOutputPath = resolveRepo(options.decisionOutput || path.join(path.dirname(outputPath), 'vision-evidence-review.accepted.json'));

  const reviewPatch = await readJson(reviewPatchPath);
  const reviewDecision = options.decision
    ? await readJson(resolveRepo(options.decision))
    : buildAcceptedVisionEvidenceReviewDecision({
      reviewPatch,
      reviewer: options.reviewer || 'agent_first_review_fixture',
      acceptedAt: options.acceptedAt || '2026-06-17',
      sourceReviewPatch: relativePath(reviewPatchPath)
    });
  const sourceReviewDecision = options.decision ? options.decision : relativePath(decisionOutputPath);
  const policyPatch = buildVisionEvidencePolicyCorrectionPatch({
    reviewPatch,
    reviewDecision,
    sourceReviewPatch: relativePath(reviewPatchPath),
    sourceReviewDecision
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (!options.decision) await writeJson(decisionOutputPath, reviewDecision);
  await writeJson(outputPath, policyPatch);
  await fs.writeFile(markdownOutputPath, renderVisionEvidencePolicyCorrectionPatchMarkdown(policyPatch), 'utf8');

  let updatedVisionEvidenceSetOutput = null;
  let applied = [];
  if (options.visionEvidenceSet && options.updatedVisionEvidenceSet) {
    const visionEvidenceSet = await readVisionEvidenceSet(options.visionEvidenceSet);
    const appliedResult = applyVisionEvidencePolicyCorrectionPatch({
      visionEvidenceSet,
      patch: policyPatch
    });
    applied = appliedResult.applied;
    updatedVisionEvidenceSetOutput = resolveRepo(options.updatedVisionEvidenceSet);
    await writeJson(updatedVisionEvidenceSetOutput, appliedResult.visionEvidenceSet);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: policyPatch.status,
    apply_scope: policyPatch.apply_scope,
    apply_allowed: policyPatch.apply_allowed,
    compile_allowed: policyPatch.compile_allowed,
    geometry_promotion_allowed: policyPatch.geometry_promotion_allowed,
    actions: policyPatch.summary.total_actions,
    ground_plane_actions: policyPatch.summary.ground_plane_actions,
    edge_class_actions: policyPatch.summary.edge_class_actions,
    applied_actions: applied.length,
    review_decision: relativePath(options.decision ? resolveRepo(options.decision) : decisionOutputPath),
    output: relativePath(outputPath),
    markdown_output: relativePath(markdownOutputPath),
    updated_vision_evidence_set: updatedVisionEvidenceSetOutput ? relativePath(updatedVisionEvidenceSetOutput) : null
  }, null, 2)}\n`);
}

async function readVisionEvidenceSet(relativePathOrAbsolute) {
  const payload = await readJson(resolveRepo(relativePathOrAbsolute));
  const visionEvidenceSet = payload.vision_evidence_set_v1 || payload.visionEvidenceSet || payload;
  if (visionEvidenceSet?.kind !== 'vision_evidence_set_v1') {
    throw new Error(`${relativePathOrAbsolute} does not contain a vision_evidence_set_v1 payload`);
  }
  return visionEvidenceSet;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot || scriptRoot, value);
}

function relativePath(filePath) {
  return path.relative(repoRoot || scriptRoot, filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--review-patch') parsed.reviewPatch = argv[++index];
    else if (arg === '--decision') parsed.decision = argv[++index];
    else if (arg === '--decision-output') parsed.decisionOutput = argv[++index];
    else if (arg === '--output') parsed.output = argv[++index];
    else if (arg === '--markdown-output') parsed.markdownOutput = argv[++index];
    else if (arg === '--vision-evidence-set') parsed.visionEvidenceSet = argv[++index];
    else if (arg === '--updated-vision-evidence-set') parsed.updatedVisionEvidenceSet = argv[++index];
    else if (arg === '--reviewer') parsed.reviewer = argv[++index];
    else if (arg === '--accepted-at') parsed.acceptedAt = argv[++index];
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (parsed.visionEvidenceSet && !parsed.updatedVisionEvidenceSet) {
    throw new Error('--updated-vision-evidence-set is required when --vision-evidence-set is provided');
  }
  if (!parsed.visionEvidenceSet && parsed.updatedVisionEvidenceSet) {
    throw new Error('--vision-evidence-set is required when --updated-vision-evidence-set is provided');
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-vision-evidence-policy-correction-patch.mjs \\
    --review-patch projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-review-patch.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/vision-evidence-policy-correction-patch.json

Options:
  --decision <path>                     Use an existing vision_evidence_review_decision JSON.
  --decision-output <path>              Write generated accepted decision fixture.
  --markdown-output <path>              Write markdown summary.
  --vision-evidence-set <path>          Optional raw VisionEvidenceSet or report to annotate.
  --updated-vision-evidence-set <path>  Output annotated VisionEvidenceSet.
`);
  process.exit(0);
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
