#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphFiles } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphPhysicalConsistency } from '../../../src/product-modeling/physical-consistency-qa.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const DEFAULTS = {
  name: 'ambulance-proposal-applied',
  profile: 'examples/product-profiles/vehicle_ambulance.json',
  partGraph: 'projects/image-structured-modeler/examples/ambulance/part-graph.proposal-applied.json',
  code: 'projects/image-structured-modeler/examples/ambulance/output.proposal-applied.json',
  layoutSpec: 'examples/model-qa/ambulance-reference.json',
  referenceSpec: 'examples/reference-visual-qa/ambulance-reference.json',
  outputDir: 'output/image-structured-proposal-qa/ambulance'
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = options.runtime || 'mock';
  const outputDir = resolveRepo(options.outputDir || DEFAULTS.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const paths = {
    profile: options.profile || DEFAULTS.profile,
    partGraph: options.partGraph || DEFAULTS.partGraph,
    code: options.code || DEFAULTS.code,
    layoutSpec: options.layoutSpec || DEFAULTS.layoutSpec,
    referenceSpec: options.referenceSpec || DEFAULTS.referenceSpec
  };

  const [partGraph, codeDocument, layoutSpec, referenceSpec] = await Promise.all([
    readJson(paths.partGraph),
    readJson(paths.code),
    readJson(paths.layoutSpec),
    readJson(paths.referenceSpec)
  ]);
  const compiled = await compilePartGraphFiles({
    profilePath: paths.profile,
    partGraphPath: paths.partGraph,
    repoRoot
  });
  const compiledMatchesOutput = JSON.stringify(compiled) === JSON.stringify(codeDocument);
  const code = JSON.stringify(codeDocument);
  const bridge = new SketchUpBridge();
  const layout = await bridge.validate_model({
    code,
    spec: layoutSpec,
    runtime,
    timeoutMs: options.timeoutMs,
    includePreview: false
  });
  const referenceVisual = await bridge.validate_reference_model({
    code,
    spec: referenceSpec,
    runtime,
    timeoutMs: options.timeoutMs,
    includePreview: false
  });
  const physicalConsistency = validatePartGraphPhysicalConsistency(partGraph);
  const artifact = options.saveSkp || options.saveArtifact
    ? await bridge.save_model({
      path: resolveRepo(options.saveSkp || path.join(outputDir, `${options.name || DEFAULTS.name}.${runtime === 'queue' ? 'skp' : 'json'}`)),
      runtime,
      timeoutMs: options.timeoutMs
    })
    : null;

  const report = {
    kind: 'proposal_review_qa',
    name: options.name || DEFAULTS.name,
    runtime,
    timeout_ms: options.timeoutMs ?? null,
    ok: compiledMatchesOutput && layout.ok && referenceVisual.ok && physicalConsistency.ok,
    review_required: !(compiledMatchesOutput && layout.ok && referenceVisual.ok && physicalConsistency.ok),
    compiled_matches_output: compiledMatchesOutput,
    source_paths: paths,
    part_graph: {
      id: partGraph.id,
      parts: partGraph.parts?.length || 0,
      evidence_summary: countBy(partGraph.parts || [], 'evidence_status')
    },
    layout: summarizeQa(layout),
    reference_visual: summarizeQa(referenceVisual),
    physical_consistency: summarizeQa(physicalConsistency, {
      checked_relations: physicalConsistency.summary.checked_relations
    }),
    artifact: artifact
      ? {
        path: artifact.file_path,
        size_bytes: artifact.file_size_bytes ?? artifact.snapshot?.artifact_size_bytes ?? null,
        totals: artifact.snapshot?.totals || null
      }
      : null
  };

  await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'report.md'), formatMarkdown(report), 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    review_required: report.review_required,
    output_dir: path.relative(repoRoot, outputDir) || '.',
    runtime: report.runtime,
    compiled_matches_output: report.compiled_matches_output,
    layout: report.layout.verdict,
    reference_visual: report.reference_visual.verdict,
    physical_consistency: report.physical_consistency.verdict,
    artifact: report.artifact?.path || null
  }, null, 2)}\n`);

  if (options.requirePass && !report.ok) process.exitCode = 1;
}

function summarizeQa(report, extra = {}) {
  return {
    ok: report.ok,
    verdict: report.verdict,
    level: report.level,
    issues: report.summary?.total || 0,
    errors: report.summary?.by_severity?.error || 0,
    warnings: report.summary?.by_severity?.warn || 0,
    ...extra
  };
}

function countBy(items, key) {
  const result = {};
  for (const item of items) {
    const value = item[key] ?? 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function formatMarkdown(report) {
  const lines = [
    '# Proposal Review QA',
    '',
    `Runtime: ${report.runtime}`,
    `Acceptance ready: ${report.ok ? 'yes' : 'no'}`,
    `Review required: ${report.review_required ? 'yes' : 'no'}`,
    '',
    '| Gate | Verdict | Issues | Errors | Warnings |',
    '|---|---|---:|---:|---:|',
    formatGate('Compile freshness', report.compiled_matches_output ? 'pass' : 'stale', report.compiled_matches_output ? 0 : 1, report.compiled_matches_output ? 0 : 1, 0),
    formatGate('Layout QA', report.layout.verdict, report.layout.issues, report.layout.errors, report.layout.warnings),
    formatGate('Reference Visual QA', report.reference_visual.verdict, report.reference_visual.issues, report.reference_visual.errors, report.reference_visual.warnings),
    formatGate('Physical Consistency', report.physical_consistency.verdict, report.physical_consistency.issues, report.physical_consistency.errors, report.physical_consistency.warnings),
    '',
    '## PartGraph',
    '',
    `- ID: \`${report.part_graph.id}\``,
    `- Parts: ${report.part_graph.parts}`,
    `- Evidence: ${Object.entries(report.part_graph.evidence_summary).map(([key, count]) => `${key} ${count}`).join(', ') || 'none'}`
  ];
  if (report.artifact) {
    const totals = report.artifact.totals
      ? ` (${report.artifact.totals.groups} groups / ${report.artifact.totals.faces} faces / ${report.artifact.totals.edges} edges)`
      : '';
    lines.push('', '## Artifact', '', `- \`${report.artifact.path}\`${totals}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatGate(name, verdict, issues, errors, warnings) {
  return `| ${name} | ${verdict} | ${issues} | ${errors} | ${warnings} |`;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--name') options.name = argv[++index];
    else if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--part-graph') options.partGraph = argv[++index];
    else if (arg === '--code') options.code = argv[++index];
    else if (arg === '--layout-spec') options.layoutSpec = argv[++index];
    else if (arg === '--reference-spec') options.referenceSpec = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--save-skp') options.saveSkp = argv[++index];
    else if (arg === '--save-artifact') options.saveArtifact = true;
    else if (arg === '--require-pass') options.requirePass = true;
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
  node projects/image-structured-modeler/scripts/run-proposal-review-qa.mjs \\
    --runtime mock \\
    --output-dir output/image-structured-proposal-qa/ambulance

Use --runtime queue --timeout-ms 180000 --save-skp output/image-structured-ambulance-proposal-applied.skp
to build the currently accepted proposal-applied PartGraph in SketchUp and save a live artifact.
By default the script records review-gate results without failing when QA is not acceptance-ready.
Pass --require-pass when the proposal-applied graph must satisfy all gates.
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
