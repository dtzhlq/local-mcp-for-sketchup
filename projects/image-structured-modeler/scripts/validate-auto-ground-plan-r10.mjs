#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { validateAutoGroundPlanR10 } from './lib/auto-ground-plan-r10.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/structured-plan-qa-report.json';
  const observations = await readJson(observationsPath);
  const report = validateAutoGroundPlanR10({ observations });

  if (outputPath) {
    const output = resolveRepo(outputPath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.writeFile(output.replace(/\.json$/i, '.md'), formatMarkdown(report), 'utf8');
  }

  if (options.updateObservations) {
    const nextObservations = {
      ...observations,
      grounding_r10: {
        version: 10,
        auto_ground_plan: report.auto_ground_plan
      },
      evidence_graph: {
        ...(observations.evidence_graph || {}),
        auto_ground_plan: report.auto_ground_plan
      }
    };
    await writeJson(resolveRepo(observationsPath), nextObservations);
  }

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    canonical_regions: report.summary.canonical_regions,
    subdivision_cells: report.summary.subdivision_cells,
    road_building_overlap_ratio: report.summary.road_building_overlap_ratio,
    raw_contour_leakage: report.summary.raw_contour_leakage,
    parent_child_double_occupancy: report.summary.parent_child_double_occupancy,
    layout_prior_conflict_count: report.summary.layout_prior_conflict_count,
    gap_ratio: report.summary.gap_ratio,
    gap_completion_ratio: report.summary.gap_completion_ratio,
    remaining_unknown_gap_ratio: report.summary.remaining_unknown_gap_ratio,
    road_candidate_review_count: report.summary.road_candidate_review_count,
    output: outputPath
  }, null, 2)}\n`);

  if (options.requirePass && report.verdict !== 'pass') process.exit(1);
  if (options.requireOk && !report.ok) process.exit(1);
}

function formatMarkdown(report) {
  const summary = report.summary || {};
  const lines = [
    '# Auto GroundPlan R10 QA',
    '',
    `Verdict: ${report.verdict}`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Evidence candidates | ${summary.checked_evidence_candidates || 0} |`,
    `| Canonical regions | ${summary.canonical_regions || 0} |`,
    `| Subdivision cells | ${summary.subdivision_cells || 0} |`,
    `| Road/building overlap | ${summary.road_building_overlap_ratio || 0} |`,
    `| Raw contour leakage | ${summary.raw_contour_leakage || 0} |`,
    `| Parent/child double occupancy | ${summary.parent_child_double_occupancy || 0} |`,
    `| Canonical overlap | ${summary.canonical_region_overlap_ratio || 0} |`,
    `| Gap ratio | ${summary.gap_ratio || 0} |`,
    `| Gap completion ratio | ${summary.gap_completion_ratio || 0} |`,
    `| Remaining unknown gap ratio | ${summary.remaining_unknown_gap_ratio || 0} |`,
    `| Open paved helper ratio | ${summary.open_paved_area_ratio || 0} |`,
    `| Road candidate review count | ${summary.road_candidate_review_count || 0} |`,
    `| Rejected priors | ${summary.rejected_priors || 0} |`,
    '',
    '## Issues',
    ''
  ];
  if (!report.issues?.length) {
    lines.push('- none');
  } else {
    for (const issue of report.issues) lines.push(`- ${issue.severity}: ${issue.rule_id} - ${issue.message}`);
  }
  lines.push('', '## Correction Targets', '');
  if (!report.correction_suggestions?.length) {
    lines.push('- none');
  } else {
    for (const suggestion of report.correction_suggestions) {
      lines.push(`- ${suggestion.target}: ${suggestion.action} (${suggestion.reason})`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.resolve(repoRoot || scriptRoot, relativePath);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--update-observations') options.updateObservations = true;
    else if (arg === '--require-pass') options.requirePass = true;
    else if (arg === '--require-ok') options.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/validate-auto-ground-plan-r10.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/structured-plan-qa-report.json
`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
