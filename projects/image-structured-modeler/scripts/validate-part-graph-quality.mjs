#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './lib/image-analysis.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(repoRoot, options.input || 'projects/image-structured-modeler/examples/ambulance/part-graph.generated.json');
  const output = options.output ? path.resolve(repoRoot, options.output) : null;
  const partGraph = JSON.parse(await fs.readFile(input, 'utf8'));
  const report = validatePartGraphQuality(partGraph, {
    maxProfileDefaultRatio: numberOption(options.maxProfileDefaultRatio, 0.05),
    maxNeedsReviewRatio: numberOption(options.maxNeedsReviewRatio, 0.12),
    minObservedParts: numberOption(options.minObservedParts, 8),
    minInferredParts: numberOption(options.minInferredParts, 20),
    minScaleConfidence: numberOption(options.minScaleConfidence, 0.7)
  });

  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ ok: report.ok, output, summary: report.summary, issues: report.issues }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

export function validatePartGraphQuality(partGraph, thresholds = {}) {
  const parts = partGraph.parts || [];
  const statusCounts = countBy(parts, 'evidence_status');
  const fallbackCounts = countBy(parts, 'fallback_state');
  const parameterProposals = parts.flatMap((part) => part.parameter_proposals || []);
  const parameterProposalParts = new Set(parameterProposals.map((proposal) => proposal.part_id).filter(Boolean));
  const total = Math.max(1, parts.length);
  const summary = {
    part_count: parts.length,
    evidence_status: statusCounts,
    fallback_state: fallbackCounts,
    observed_parts: statusCounts.observed || 0,
    inferred_parts: statusCounts.inferred || 0,
    profile_default_parts: statusCounts.profile_default || 0,
    needs_review_parts: statusCounts.needs_review || 0,
    profile_default_ratio: round((statusCounts.profile_default || 0) / total, 3),
    needs_review_ratio: round((statusCounts.needs_review || 0) / total, 3),
    correction_targets: partGraph.review?.correction_targets?.length || 0,
    parameter_proposals: parameterProposals.length,
    parameter_proposal_parts: parameterProposalParts.size,
    review_required_parameter_proposals: parameterProposals.filter((proposal) => proposal.review_required).length,
    scale_confidence: partGraph.scale?.confidence ?? 0
  };
  const issues = [];
  if (summary.profile_default_ratio > thresholds.maxProfileDefaultRatio) {
    issues.push(`profile_default_ratio ${summary.profile_default_ratio} exceeds ${thresholds.maxProfileDefaultRatio}`);
  }
  if (summary.needs_review_ratio > thresholds.maxNeedsReviewRatio) {
    issues.push(`needs_review_ratio ${summary.needs_review_ratio} exceeds ${thresholds.maxNeedsReviewRatio}`);
  }
  if (summary.observed_parts < thresholds.minObservedParts) {
    issues.push(`observed_parts ${summary.observed_parts} is below ${thresholds.minObservedParts}`);
  }
  if (summary.inferred_parts < thresholds.minInferredParts) {
    issues.push(`inferred_parts ${summary.inferred_parts} is below ${thresholds.minInferredParts}`);
  }
  if (summary.scale_confidence < thresholds.minScaleConfidence) {
    issues.push(`scale_confidence ${summary.scale_confidence} is below ${thresholds.minScaleConfidence}`);
  }
  return {
    kind: 'part_graph_quality_gate',
    ok: issues.length === 0,
    thresholds,
    summary,
    issues
  };
}

function countBy(items, key) {
  const result = {};
  for (const item of items) result[item[key]] = (result[item[key]] || 0) + 1;
  return result;
}

function numberOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--max-profile-default-ratio') options.maxProfileDefaultRatio = argv[++index];
    else if (arg === '--max-needs-review-ratio') options.maxNeedsReviewRatio = argv[++index];
    else if (arg === '--min-observed-parts') options.minObservedParts = argv[++index];
    else if (arg === '--min-inferred-parts') options.minInferredParts = argv[++index];
    else if (arg === '--min-scale-confidence') options.minScaleConfidence = argv[++index];
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
  node projects/image-structured-modeler/scripts/validate-part-graph-quality.mjs \\
    --input projects/image-structured-modeler/examples/ambulance/part-graph.generated.json \\
    --output projects/image-structured-modeler/examples/ambulance/quality-report.json
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
