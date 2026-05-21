#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { formatSnapshotReportMarkdown } from '../src/snapshot-report.mjs';

const DEFAULT_EXAMPLES = [
  'examples/demo-room.json',
  'examples/editing-identity.json',
  'examples/golden-architecture.json',
  'examples/golden-product.json'
];

const bridge = new SketchUpBridge();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const examples = options.examples.length > 0 ? options.examples : DEFAULT_EXAMPLES;
  await fs.mkdir(options.outputDir, { recursive: true });

  const results = [];
  for (const examplePath of examples) {
    const result = await runExample(examplePath, options);
    results.push(result);
    process.stderr.write(`${result.report.ok ? 'PASS' : 'FAIL'} ${result.name} -> ${result.markdown_path}\n`);
  }

  const indexMarkdown = formatIndexMarkdown(results, options);
  const indexJsonPath = path.join(options.outputDir, 'index.json');
  const indexMarkdownPath = path.join(options.outputDir, 'index.md');
  await fs.writeFile(indexJsonPath, `${JSON.stringify({ generated_at: new Date().toISOString(), options: publicOptions(options), results }, null, 2)}\n`, 'utf8');
  await fs.writeFile(indexMarkdownPath, indexMarkdown, 'utf8');
  const aggregate = aggregateResult(results);
  process.stdout.write(`${JSON.stringify({ ok: aggregate.ok, level: aggregate.level, verdict: aggregate.verdict, count: results.length, index_json: indexJsonPath, index_markdown: indexMarkdownPath }, null, 2)}\n`);
}

async function runExample(examplePath, options) {
  const absoluteExamplePath = path.resolve(examplePath);
  const code = await fs.readFile(absoluteExamplePath, 'utf8');
  const name = path.basename(examplePath, path.extname(examplePath));
  const result = await bridge.compare_model({
    code,
    expected_runtime: options.expectedRuntime,
    actual_runtime: options.actualRuntime,
    timeoutMs: options.timeoutMs,
    reset_first: options.resetFirst,
    toleranceMm: options.toleranceMm,
    topologyTolerance: options.topologyTolerance,
    budgets: options.budgets,
    topIssueLimit: options.topIssueLimit,
    include_snapshots: options.includeSnapshots
  });
  const safeName = name.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  const jsonPath = path.join(options.outputDir, `${safeName}.json`);
  const markdownPath = path.join(options.outputDir, `${safeName}.md`);
  const markdown = formatSnapshotReportMarkdown(result, { title: `SketchUp QA: ${name}` });
  await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, markdown, 'utf8');
  return {
    name,
    example_path: examplePath,
    json_path: jsonPath,
    markdown_path: markdownPath,
    report: result.report
  };
}

function formatIndexMarkdown(results, options) {
  const lines = [];
  const aggregate = aggregateResult(results);
  lines.push('# SketchUp QA Report Index');
  lines.push('');
  lines.push(`- Verdict: **${aggregate.verdict}**`);
  lines.push(`- Level: **${aggregate.level}**`);
  lines.push(`- OK: **${aggregate.ok ? 'true' : 'false'}**`);
  lines.push(`- Expected runtime: \`${options.expectedRuntime}\``);
  lines.push(`- Actual runtime: \`${options.actualRuntime}\``);
  lines.push(`- Generated at: \`${new Date().toISOString()}\``);
  lines.push('');
  lines.push('| Example | Verdict | Level | Total Diffs | Errors | Warnings | Report |');
  lines.push('|---|---|---|---:|---:|---:|---|');
  for (const result of results) {
    const summary = result.report.summary || {};
    lines.push(`| ${escapeMarkdown(result.name)} | ${escapeMarkdown(result.report.verdict)} | ${escapeMarkdown(result.report.level)} | ${summary.total || 0} | ${summary.by_severity?.error || 0} | ${summary.by_severity?.warn || 0} | [md](${path.basename(result.markdown_path)}) |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function aggregateResult(results) {
  const severityRank = { ok: 0, info: 1, warn: 2, error: 3 };
  const worst = results.reduce((current, result) => {
    const level = result.report.level || 'ok';
    return severityRank[level] > severityRank[current] ? level : current;
  }, 'ok');
  return {
    ok: results.every((result) => result.report.ok),
    level: worst,
    verdict: verdictForLevel(worst)
  };
}

function verdictForLevel(level) {
  if (level === 'error') return 'fail';
  if (level === 'warn') return 'review';
  if (level === 'info') return 'pass_with_notes';
  return 'pass';
}

function parseArgs(argv) {
  const options = {
    examples: [],
    outputDir: 'output/qa-reports',
    expectedRuntime: 'mock',
    actualRuntime: 'mock',
    timeoutMs: undefined,
    resetFirst: true,
    toleranceMm: 1,
    topIssueLimit: 10,
    includeSnapshots: false,
    topologyTolerance: {},
    budgets: {}
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--example') options.examples.push(argv[++index]);
    else if (arg === '--examples') options.examples.push(...argv[++index].split(',').map((item) => item.trim()).filter(Boolean));
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--expected-runtime') options.expectedRuntime = argv[++index];
    else if (arg === '--actual-runtime') options.actualRuntime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--no-reset-first') options.resetFirst = false;
    else if (arg === '--tolerance-mm') options.toleranceMm = Number(argv[++index]);
    else if (arg === '--top-issues') options.topIssueLimit = Number(argv[++index]);
    else if (arg === '--face-tolerance') options.topologyTolerance.faces = Number(argv[++index]);
    else if (arg === '--edge-tolerance') options.topologyTolerance.edges = Number(argv[++index]);
    else if (arg === '--group-tolerance') options.topologyTolerance.groups = Number(argv[++index]);
    else if (arg === '--instance-tolerance') options.topologyTolerance.instances = Number(argv[++index]);
    else if (arg === '--include-snapshots') options.includeSnapshots = true;
    else if (arg === '--max-faces') options.budgets.max_faces = Number(argv[++index]);
    else if (arg === '--max-edges') options.budgets.max_edges = Number(argv[++index]);
    else if (arg === '--max-vertices') options.budgets.max_vertices = Number(argv[++index]);
    else if (arg === '--max-groups') options.budgets.max_groups = Number(argv[++index]);
    else if (arg === '--max-instances') options.budgets.max_instances = Number(argv[++index]);
    else if (arg === '--max-artifact-size-bytes') options.budgets.max_artifact_size_bytes = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function publicOptions(options) {
  return {
    outputDir: options.outputDir,
    expectedRuntime: options.expectedRuntime,
    actualRuntime: options.actualRuntime,
    timeoutMs: options.timeoutMs,
    resetFirst: options.resetFirst,
    toleranceMm: options.toleranceMm,
    topIssueLimit: options.topIssueLimit,
    includeSnapshots: options.includeSnapshots,
    topologyTolerance: options.topologyTolerance,
    budgets: options.budgets
  };
}

function usage() {
  process.stdout.write(`Usage:\n  node scripts/generate-qa-reports.mjs [--example examples/demo-room.json] [--output-dir output/qa-reports]\n  node scripts/generate-qa-reports.mjs --expected-runtime mock --actual-runtime queue --timeout-ms 60000\n`);
  process.exit(0);
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
