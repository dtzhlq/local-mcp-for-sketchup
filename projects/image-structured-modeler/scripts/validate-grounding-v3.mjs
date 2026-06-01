#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { validateGroundingV3 } from './lib/grounding-v3.mjs';
import { validateGeometryFit } from './validate-geometry-fit.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const fixturePath = options.fixture || 'projects/image-structured-modeler/examples/building-group/visual-relations.candidates.fixture.json';
  const codePath = options.code || 'projects/image-structured-modeler/examples/building-group/output.part-candidates-applied.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/proposal-qa-candidates/grounding-v3-report.json';
  const observations = await readJson(observationsPath);
  const fixture = await readJson(fixturePath);
  const codeDocument = await readJson(codePath);

  const geometryFit = options.skipGeometryFit
    ? null
    : await validateGeometryFit({
      observations,
      fixture,
      code: JSON.stringify(codeDocument),
      runtime: options.runtime || 'mock',
      timeoutMs: options.timeoutMs,
      mockSessionPath: options.mockSessionPath || path.join(path.dirname(resolveRepo(outputPath)), 'grounding-v3-geometry-fit-session.json')
    });
  const report = validateGroundingV3({
    observations,
    fixture,
    geometryFit,
    codeDocument
  });

  if (outputPath) {
    const output = resolveRepo(outputPath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.writeFile(output.replace(/\.json$/i, '.md'), formatMarkdown(report), 'utf8');
  }

  if (options.updateObservations) {
    const nextObservations = {
      ...observations,
      grounding_v3: report.graph,
      evidence_graph: {
        ...(observations.evidence_graph || {}),
        ground_plan: report.graph.ground_plan
      }
    };
    await writeJson(resolveRepo(observationsPath), nextObservations);
  }

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    checked_scale_anchors: report.summary.checked_scale_anchors,
    distinct_scale_anchor_families: report.summary.distinct_scale_anchor_families,
    checked_ground_regions: report.summary.checked_ground_regions,
    checked_line_fits: report.summary.checked_line_fits,
    top_view_overlay_regions: report.summary.top_view_overlay_regions,
    promoted_geometry: report.summary.promoted_geometry,
    review_candidate: report.summary.review_candidate,
    helper_only: report.summary.helper_only,
    photo_grade_candidate: report.summary.photo_grade_candidate,
    issues: report.summary.total_issues,
    output: outputPath
  }, null, 2)}\n`);

  if (options.requirePass && !report.ok) process.exit(1);
}

function formatMarkdown(report) {
  const lines = [
    '# Grounding v3 QA',
    '',
    `Verdict: ${report.verdict}`,
    `Photo-grade candidate: ${report.summary.photo_grade_candidate ? 'yes' : 'no'}`,
    '',
    '| Gate | Value |',
    '|---|---:|',
    `| Scale anchors | ${report.summary.checked_scale_anchors} |`,
    `| Anchor families | ${report.summary.distinct_scale_anchor_families} |`,
    `| Ground regions | ${report.summary.checked_ground_regions} |`,
    `| Subdivision overlap | ${report.summary.subdivision_overlap_ratio} |`,
    `| Subdivision gap | ${report.summary.subdivision_gap_ratio} |`,
    `| Line fits | ${report.summary.checked_line_fits} |`,
    `| Parking count residual | ${report.summary.parking_grid_count_residual} |`,
    `| Overlay mean IoU | ${report.summary.top_view_overlay_mean_iou} |`,
    `| Promoted geometry | ${report.summary.promoted_geometry} |`,
    `| Review candidates | ${report.summary.review_candidate} |`,
    `| Helper only | ${report.summary.helper_only} |`,
    '',
    '## Issues',
    ''
  ];
  if (report.issues.length === 0) {
    lines.push('- none');
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${issue.severity}: ${issue.type} - ${issue.message}`);
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
    else if (arg === '--fixture') options.fixture = argv[++index];
    else if (arg === '--code') options.code = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--mock-session-path') options.mockSessionPath = argv[++index];
    else if (arg === '--update-observations') options.updateObservations = true;
    else if (arg === '--skip-geometry-fit') options.skipGeometryFit = true;
    else if (arg === '--require-pass') options.requirePass = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/validate-grounding-v3.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --fixture projects/image-structured-modeler/examples/building-group/visual-relations.candidates.fixture.json \\
    --code projects/image-structured-modeler/examples/building-group/output.part-candidates-applied.json \\
    --output projects/image-structured-modeler/examples/building-group/proposal-qa-candidates/grounding-v3-report.json
`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
