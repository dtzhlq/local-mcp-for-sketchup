#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { validateGroundingV3 } from './lib/grounding-v3.mjs';
import { validatePhotoGradeReadiness } from './lib/photo-grade-readiness.mjs';
import { validateGeometryFit } from './validate-geometry-fit.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const fixturePath = options.fixture || 'projects/image-structured-modeler/examples/building-group/visual-relations.candidates.fixture.json';
  const codePath = options.code || 'projects/image-structured-modeler/examples/building-group/output.part-candidates-applied.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/proposal-qa-candidates/photo-grade-readiness-report.json';
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
      mockSessionPath: options.mockSessionPath || path.join(path.dirname(resolveRepo(outputPath)), 'photo-grade-readiness-geometry-fit-session.json')
    });
  const groundingV3 = validateGroundingV3({
    observations,
    fixture,
    geometryFit,
    codeDocument
  });
  const report = validatePhotoGradeReadiness({
    observations,
    fixture,
    geometryFit,
    groundingV3,
    codeDocument,
    sampleId: options.sampleId || path.basename(path.dirname(resolveRepo(outputPath))),
    sampleKind: options.sampleKind || 'building_group',
    inputAssetStatus: options.inputAssetStatus || 'available'
  });

  if (outputPath) {
    const output = resolveRepo(outputPath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.writeFile(output.replace(/\.json$/i, '.md'), formatMarkdown(report), 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    photo_grade_readiness: report.photo_grade_readiness,
    photo_grade_candidate: report.photo_grade_candidate,
    candidate_ready_gates: report.summary.candidate_ready_gates,
    review_required_gates: report.summary.review_required_gates,
    failed_gates: report.summary.failed_gates,
    blockers: report.summary.blockers,
    output: outputPath
  }, null, 2)}\n`);

  if (options.requireCandidate && report.photo_grade_readiness !== 'candidate') process.exit(1);
  if (options.requireOk && !report.ok) process.exit(1);
}

function formatMarkdown(report) {
  const lines = [
    '# Photo-Grade Readiness QA',
    '',
    `Readiness: ${report.photo_grade_readiness}`,
    `Photo-grade candidate: ${report.photo_grade_candidate ? 'yes' : 'no'}`,
    `Input asset status: ${report.sample.input_asset_status}`,
    '',
    '| Gate | Verdict | Candidate-ready | Key metrics |',
    '|---|---|---:|---|'
  ];
  for (const gate of report.gates) {
    lines.push(`| ${gate.id} | ${gate.verdict} | ${gate.candidate_ready ? 'yes' : 'no'} | ${formatMetrics(gate.metrics)} |`);
  }
  lines.push('', '## Blockers', '');
  if (report.blockers.length === 0) {
    lines.push('- none');
  } else {
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.severity}: ${blocker.gate} - ${blocker.reason}`);
    }
  }
  lines.push('', '## Correction Targets', '');
  if (report.correction_suggestions.length === 0) {
    lines.push('- none');
  } else {
    for (const suggestion of report.correction_suggestions) {
      lines.push(`- ${suggestion.target}: ${suggestion.action} (${suggestion.reason})`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatMetrics(metrics = {}) {
  return Object.entries(metrics)
    .slice(0, 4)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.length : value}`)
    .join(', ');
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
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
    else if (arg === '--sample-id') options.sampleId = argv[++index];
    else if (arg === '--sample-kind') options.sampleKind = argv[++index];
    else if (arg === '--input-asset-status') options.inputAssetStatus = argv[++index];
    else if (arg === '--skip-geometry-fit') options.skipGeometryFit = true;
    else if (arg === '--require-candidate') options.requireCandidate = true;
    else if (arg === '--require-ok') options.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/validate-photo-grade-readiness.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --fixture projects/image-structured-modeler/examples/building-group/visual-relations.candidates.fixture.json \\
    --code projects/image-structured-modeler/examples/building-group/output.part-candidates-applied.json \\
    --output projects/image-structured-modeler/examples/building-group/proposal-qa-candidates/photo-grade-readiness-report.json
`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
