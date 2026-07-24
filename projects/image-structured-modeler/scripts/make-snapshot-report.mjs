#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { freshSessionOptions } from '../../../src/live-session-contract.mjs';
import { formatSnapshotReportMarkdown } from '../../../src/snapshot-report.mjs';
import { classifySnapshotWarnings, createWarningGate, summarizeWarningClassifications } from './lib/warning-budget.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_OUTPUT_DSL = 'projects/image-structured-modeler/examples/switch-controller/output.json';
const DEFAULT_OUTPUT_DIR = 'projects/image-structured-modeler/examples/switch-controller/review';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDslPath = path.resolve(repoRoot, options.outputDsl);
  const outputDir = path.resolve(repoRoot, options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const code = await fs.readFile(outputDslPath, 'utf8');
  const dsl = JSON.parse(code);
  const bridge = await createBridge();

  const report = options.compareRuntime
    ? await createRuntimeDiffReport({ bridge, code, dsl, options, outputDslPath })
    : await createRuntimeSnapshotReport({ bridge, code, dsl, options, outputDslPath });

  const jsonPath = path.join(outputDir, options.jsonName);
  const markdownPath = path.join(outputDir, options.markdownName);
  const markdown = options.compareRuntime ? formatDiffMarkdown(report) : formatMarkdown(report);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, `${markdown.trimEnd()}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: report.report ? report.report.ok === true : true,
    mode: report.mode,
    runtime: report.runtime,
    expected_runtime: report.expected_runtime,
    actual_runtime: report.actual_runtime,
    json: jsonPath,
    markdown: markdownPath
  }, null, 2)}\n`);
}

async function createBridge() {
  const mockSessionPath = path.join(repoRoot, 'output', 'image-structured-modeler', 'sessions', 'snapshot-mock-session.json');
  await fs.mkdir(path.dirname(mockSessionPath), { recursive: true });
  return new SketchUpBridge({
    mock: { sessionPath: mockSessionPath }
  });
}

async function createRuntimeSnapshotReport({ bridge, code, dsl, options, outputDslPath }) {
  const built = await bridge.build_model({ runtime: options.runtime, code, timeoutMs: options.timeoutMs, ...await freshSessionOptions(bridge, { runtime: options.runtime, timeoutMs: options.timeoutMs }) });
  let saved;
  if (options.saveSkp) {
    saved = await bridge.save_model({
      runtime: options.runtime,
      path: path.resolve(repoRoot, options.saveSkp),
      timeoutMs: options.timeoutMs,
      ...await freshSessionOptions(bridge, { runtime: options.runtime, timeoutMs: options.timeoutMs })
    });
  }

  const snapshot = saved?.snapshot || built.snapshot;
  const report = createSnapshotReport({
    dsl,
    snapshot,
    runtime: options.runtime,
    outputDslPath: path.relative(repoRoot, outputDslPath),
    saveSkp: saved?.file_path ? path.relative(repoRoot, saved.file_path) : undefined,
    fileSizeBytes: saved?.file_size_bytes
  });
  return report;
}

async function createRuntimeDiffReport({ bridge, code, dsl, options, outputDslPath }) {
  const comparison = await bridge.compare_model({
    code,
    expected_runtime: options.runtime,
    actual_runtime: options.compareRuntime,
    timeoutMs: options.timeoutMs,
    reset_first: true,
    toleranceMm: options.toleranceMm,
    topologyTolerance: options.topologyTolerance,
    budgets: options.budgets,
    topIssueLimit: options.topIssueLimit,
    include_snapshots: true,
    ...await freshSessionOptions(bridge, {
      runtime: options.runtime === 'queue' || options.compareRuntime === 'queue' ? 'queue' : 'mock',
      timeoutMs: options.timeoutMs
    })
  });
  return createDiffReport({
    dsl,
    comparison,
    outputDslPath: path.relative(repoRoot, outputDslPath)
  });
}

function createSnapshotReport({ dsl, snapshot, runtime, outputDslPath, saveSkp, fileSizeBytes }) {
  const classifiedWarnings = classifySnapshotWarnings(snapshot);
  return {
    generated_at: new Date().toISOString(),
    mode: 'runtime_snapshot',
    runtime,
    source: {
      output_dsl: outputDslPath,
      saved_skp: saveSkp,
      file_size_bytes: fileSizeBytes
    },
    operation_counts: operationCounts(dsl.operations || []),
    snapshot_summary: snapshotSummary(snapshot),
    warning_classification_summary: summarizeWarningClassifications(classifiedWarnings),
    warnings: classifiedWarnings,
    next_actions: nextActions(classifiedWarnings)
  };
}

function createDiffReport({ dsl, comparison, outputDslPath }) {
  const expectedWarnings = classifySnapshotWarnings(comparison.expected);
  const actualWarnings = classifySnapshotWarnings(comparison.actual);
  const warningGate = createWarningGate({ expectedWarnings, actualWarnings });
  return {
    generated_at: new Date().toISOString(),
    mode: 'runtime_diff',
    source: {
      output_dsl: outputDslPath
    },
    expected_runtime: comparison.expected_runtime,
    actual_runtime: comparison.actual_runtime,
    reset_first: comparison.reset_first,
    operation_counts: operationCounts(dsl.operations || []),
    report: comparison.report,
    warning_gate: warningGate,
    expected_snapshot_summary: snapshotSummary(comparison.expected),
    actual_snapshot_summary: snapshotSummary(comparison.actual),
    warning_classification_summary: {
      expected: summarizeWarningClassifications(expectedWarnings),
      actual: summarizeWarningClassifications(actualWarnings)
    },
    warnings: {
      expected: expectedWarnings,
      actual: actualWarnings
    },
    next_actions: diffNextActions(comparison.report, warningGate)
  };
}

function snapshotSummary(snapshot = {}) {
  return {
    totals: snapshot.totals,
    bounding_box: snapshot.bounding_box,
    scenes: (snapshot.scenes || []).map((scene) => scene.name),
    material_names: snapshot.material_names || [],
    rendering_options: snapshot.rendering_options,
    warning_summary: snapshot.warning_summary
  };
}

function operationCounts(operations) {
  return operations.reduce((acc, operation) => {
    acc[operation.op] = (acc[operation.op] || 0) + 1;
    return acc;
  }, {});
}

function nextActions(classifiedWarnings) {
  const needsReview = classifiedWarnings.filter((warning) => !warning.classification.expected);
  const actions = [
    'Move this report generation into the regular image-structured build/check loop.',
    'Use expected warning buckets as the first warning budget allowlist.'
  ];
  if (needsReview.length > 0) {
    actions.push(`Inspect ${needsReview.length} unclassified geometry warnings before treating overlap count as a failure.`);
  } else {
    actions.push('Reduce expected overlap buckets with more accurate contact/recess primitives.');
  }
  return actions;
}

function diffNextActions(diffReport, warningGate) {
  const actions = [];
  if (diffReport.summary?.by_severity?.error > 0) {
    actions.push('Resolve mock/queue error-level snapshot diffs before trusting the queue artifact.');
  }
  if ((diffReport.summary?.by_severity?.warn || 0) > 0) {
    actions.push('Review warning-level snapshot diffs and decide whether they need topology tolerance or real geometry fixes.');
  }
  if (!warningGate.ok) {
    actions.push('Classify or fix unexpected warning buckets before making warning budget strict.');
  }
  if (actions.length === 0) {
    actions.push('Promote this diff report into the regular image-structured test loop as the queue parity baseline.');
    actions.push('Reload the SketchUp plugin after QA metadata changes, then verify queue-side warning classifications use runtime metadata.');
  }
  return actions;
}

function formatMarkdown(report) {
  const lines = [];
  lines.push('# Switch Controller Snapshot Report');
  lines.push('');
  lines.push(`- Generated: \`${report.generated_at}\``);
  lines.push(`- Runtime: \`${report.runtime}\``);
  lines.push(`- Output DSL: \`${report.source.output_dsl}\``);
  if (report.source.saved_skp) lines.push(`- Saved SKP: \`${report.source.saved_skp}\``);
  if (report.source.file_size_bytes) lines.push(`- File size: \`${report.source.file_size_bytes} bytes\``);
  lines.push('');
  appendTotals(lines, report.snapshot_summary);
  appendOperationCounts(lines, report.operation_counts);
  appendWarningSummary(lines, report);
  appendWarnings(lines, report.warnings);
  appendNextActions(lines, report.next_actions);
  return `${lines.join('\n')}\n`;
}

function formatDiffMarkdown(report) {
  const baseMarkdown = formatSnapshotReportMarkdown({
    expected_runtime: report.expected_runtime,
    actual_runtime: report.actual_runtime,
    reset_first: report.reset_first,
    report: report.report
  }, { title: 'Switch Controller Mock/Queue Snapshot Diff Report' });
  const lines = baseMarkdown.trimEnd().split('\n');
  lines.push('');
  appendSnapshotPairSummary(lines, report);
  appendWarningDelta(lines, report);
  appendDiffNextActions(lines, report.next_actions);
  return `${lines.join('\n')}\n`;
}

function appendTotals(lines, snapshot) {
  lines.push('## Snapshot Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---:|');
  lines.push(`| Groups | ${snapshot.totals?.groups ?? 0} |`);
  lines.push(`| Component instances | ${snapshot.totals?.instances ?? 0} |`);
  lines.push(`| Faces | ${snapshot.totals?.faces ?? 0} |`);
  lines.push(`| Edges | ${snapshot.totals?.edges ?? 0} |`);
  lines.push(`| Vertices | ${snapshot.totals?.vertices ?? 0} |`);
  lines.push(`| Scenes | ${snapshot.scenes?.length ?? 0} |`);
  lines.push('');
  const box = snapshot.bounding_box;
  if (box) {
    lines.push(`Bounding box: \`${box.w} x ${box.d} x ${box.h} mm\``);
    lines.push('');
  }
}

function appendOperationCounts(lines, counts) {
  lines.push('## Operation Counts');
  lines.push('');
  lines.push('| Operation | Count |');
  lines.push('|---|---:|');
  for (const [operation, count] of Object.entries(counts)) {
    lines.push(`| \`${escapeMarkdown(operation)}\` | ${count} |`);
  }
  lines.push('');
}

function appendWarningSummary(lines, report) {
  lines.push('## Warning Classification');
  lines.push('');
  lines.push('| Bucket | Total | Expected | Needs Review |');
  lines.push('|---|---:|---:|---:|');
  for (const [bucket, item] of Object.entries(report.warning_classification_summary)) {
    lines.push(`| \`${escapeMarkdown(bucket)}\` | ${item.total} | ${item.expected} | ${item.needs_review} |`);
  }
  if (Object.keys(report.warning_classification_summary).length === 0) {
    lines.push('| none | 0 | 0 | 0 |');
  }
  lines.push('');
}

function appendWarnings(lines, warnings) {
  lines.push('## Warning Details');
  lines.push('');
  if (warnings.length === 0) {
    lines.push('No warnings.');
    lines.push('');
    return;
  }
  lines.push('| Bucket | Type | Expected | Classification Source | Object Source | Note |');
  lines.push('|---|---|---|---|---|---|');
  for (const warning of warnings) {
    lines.push(`| \`${escapeMarkdown(warning.classification.bucket)}\` | \`${escapeMarkdown(warning.type)}\` | ${warning.classification.expected ? 'yes' : 'no'} | \`${escapeMarkdown(warning.classification.source || '')}\` | \`${escapeMarkdown(warning.source || '')}\` | ${escapeMarkdown(warning.classification.note)} |`);
  }
  lines.push('');
}

function appendNextActions(lines, actions) {
  lines.push('## Next Actions');
  lines.push('');
  for (const action of actions) lines.push(`- ${escapeMarkdown(action)}`);
  lines.push('');
}

function appendSnapshotPairSummary(lines, report) {
  lines.push('## Snapshot Pair Summary');
  lines.push('');
  lines.push('| Metric | Expected | Actual |');
  lines.push('|---|---:|---:|');
  const expectedTotals = report.expected_snapshot_summary.totals || {};
  const actualTotals = report.actual_snapshot_summary.totals || {};
  for (const metric of ['groups', 'instances', 'faces', 'edges', 'vertices']) {
    lines.push(`| ${escapeMarkdown(metric)} | ${expectedTotals[metric] ?? 0} | ${actualTotals[metric] ?? 0} |`);
  }
  lines.push(`| scenes | ${report.expected_snapshot_summary.scenes?.length ?? 0} | ${report.actual_snapshot_summary.scenes?.length ?? 0} |`);
  lines.push('');
  appendBoundingBoxPair(lines, report.expected_snapshot_summary.bounding_box, report.actual_snapshot_summary.bounding_box);
}

function appendBoundingBoxPair(lines, expectedBox, actualBox) {
  if (!expectedBox && !actualBox) return;
  const expectedLabel = expectedBox ? `${expectedBox.w} x ${expectedBox.d} x ${expectedBox.h} mm` : '-';
  const actualLabel = actualBox ? `${actualBox.w} x ${actualBox.d} x ${actualBox.h} mm` : '-';
  lines.push(`Bounding boxes: expected \`${expectedLabel}\`, actual \`${actualLabel}\``);
  lines.push('');
}

function appendWarningDelta(lines, report) {
  const expectedSummary = report.warning_classification_summary.expected || {};
  const actualSummary = report.warning_classification_summary.actual || {};
  const buckets = Array.from(new Set([...Object.keys(expectedSummary), ...Object.keys(actualSummary)])).sort();
  lines.push('## Warning Classification Delta');
  lines.push('');
  lines.push(`- Warning gate: **${report.warning_gate.ok ? 'pass' : 'review'}**`);
  lines.push(`- Unexpected warnings: expected runtime \`${report.warning_gate.expected_unexpected_count}\`, actual runtime \`${report.warning_gate.actual_unexpected_count}\``);
  lines.push('');
  lines.push('| Bucket | Expected Total | Actual Total | Delta | Expected Needs Review | Actual Needs Review |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  if (buckets.length === 0) {
    lines.push('| none | 0 | 0 | 0 | 0 | 0 |');
  }
  for (const bucket of buckets) {
    const expected = expectedSummary[bucket] || {};
    const actual = actualSummary[bucket] || {};
    const expectedTotal = expected.total || 0;
    const actualTotal = actual.total || 0;
    lines.push(`| \`${escapeMarkdown(bucket)}\` | ${expectedTotal} | ${actualTotal} | ${actualTotal - expectedTotal} | ${expected.needs_review || 0} | ${actual.needs_review || 0} |`);
  }
  lines.push('');
}

function appendDiffNextActions(lines, actions) {
  lines.push('## Image Structured Next Actions');
  lines.push('');
  for (const action of actions) lines.push(`- ${escapeMarkdown(action)}`);
  lines.push('');
}

function parseArgs(argv) {
  const options = {
    outputDsl: DEFAULT_OUTPUT_DSL,
    outputDir: DEFAULT_OUTPUT_DIR,
    runtime: 'mock',
    compareRuntime: undefined,
    timeoutMs: undefined,
    saveSkp: undefined,
    jsonName: undefined,
    markdownName: undefined,
    toleranceMm: 1,
    topIssueLimit: 10,
    topologyTolerance: {},
    budgets: {}
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dsl') options.outputDsl = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--compare-runtime') options.compareRuntime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--save-skp') options.saveSkp = argv[++index];
    else if (arg === '--json-name') options.jsonName = argv[++index];
    else if (arg === '--markdown-name') options.markdownName = argv[++index];
    else if (arg === '--tolerance-mm') options.toleranceMm = Number(argv[++index]);
    else if (arg === '--top-issues') options.topIssueLimit = Number(argv[++index]);
    else if (arg === '--face-tolerance') options.topologyTolerance.faces = Number(argv[++index]);
    else if (arg === '--edge-tolerance') options.topologyTolerance.edges = Number(argv[++index]);
    else if (arg === '--group-tolerance') options.topologyTolerance.groups = Number(argv[++index]);
    else if (arg === '--instance-tolerance') options.topologyTolerance.instances = Number(argv[++index]);
    else if (arg === '--max-faces') options.budgets.max_faces = Number(argv[++index]);
    else if (arg === '--max-edges') options.budgets.max_edges = Number(argv[++index]);
    else if (arg === '--max-vertices') options.budgets.max_vertices = Number(argv[++index]);
    else if (arg === '--max-groups') options.budgets.max_groups = Number(argv[++index]);
    else if (arg === '--max-instances') options.budgets.max_instances = Number(argv[++index]);
    else if (arg === '--max-artifact-size-bytes') options.budgets.max_artifact_size_bytes = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['mock', 'queue'].includes(options.runtime)) throw new Error('--runtime must be mock or queue');
  if (options.compareRuntime && !['mock', 'queue'].includes(options.compareRuntime)) throw new Error('--compare-runtime must be mock or queue');
  if (options.compareRuntime && options.saveSkp) throw new Error('--save-skp is only supported for single-runtime snapshot reports');
  if (!options.jsonName) options.jsonName = options.compareRuntime ? `snapshot-diff-${options.compareRuntime}.json` : 'snapshot-report.json';
  if (!options.markdownName) options.markdownName = options.compareRuntime ? `snapshot-diff-${options.compareRuntime}.md` : 'snapshot-report.md';
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/make-snapshot-report.mjs
  node projects/image-structured-modeler/scripts/make-snapshot-report.mjs --runtime queue --timeout-ms 180000 --save-skp output/image-structured-switch-controller.skp
  node projects/image-structured-modeler/scripts/make-snapshot-report.mjs --compare-runtime queue --timeout-ms 180000
	`);
  process.exit(0);
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
