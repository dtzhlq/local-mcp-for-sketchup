#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { SketchUpBridge } from '../src/bridge.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';
import { compareSnapshots } from '../src/snapshot-diff.mjs';
import { formatSnapshotReportMarkdown } from '../src/snapshot-report.mjs';

const DEFAULT_EXAMPLES = [
  'examples/golden-architecture.json',
  'examples/golden-product.json',
  'examples/structured-product-helpers.json',
  'examples/appearance-texture-slice.json'
];

const DEFAULT_BUDGETS = {
  max_faces: 5000,
  max_edges: 10000,
  max_vertices: 5000,
  max_groups: 120,
  max_instances: 80,
  max_artifact_size_bytes: 5_000_000
};

const bridge = new SketchUpBridge();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const examples = options.examples.length > 0 ? options.examples : DEFAULT_EXAMPLES;
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.mkdir(options.artifactDir, { recursive: true });

  const results = [];
  const run = async (activeBridge) => {
    for (const examplePath of examples) {
      const result = await runExample(examplePath, options, activeBridge);
      results.push(result);
      process.stderr.write(`${result.report.verdict === 'pass' ? 'PASS' : 'REVIEW'} ${result.name} -> ${result.markdown_path}\n`);
    }
  };
  await run(bridge);

  const aggregate = aggregateResult(results);
  const indexJsonPath = path.join(options.outputDir, 'index.json');
  const indexMarkdownPath = path.join(options.outputDir, 'index.md');
  await fs.writeFile(indexJsonPath, `${JSON.stringify({ generated_at: new Date().toISOString(), options: publicOptions(options), aggregate, results }, null, 2)}\n`, 'utf8');
  await fs.writeFile(indexMarkdownPath, formatIndexMarkdown(results, options, aggregate), 'utf8');
  process.stdout.write(`${JSON.stringify({ ...aggregate, count: results.length, index_json: indexJsonPath, index_markdown: indexMarkdownPath }, null, 2)}\n`);
  if (!aggregate.ok) process.exitCode = 1;
}

async function runExample(examplePath, options, activeBridge) {
  const absoluteExamplePath = path.resolve(examplePath);
  const code = await fs.readFile(absoluteExamplePath, 'utf8');
  const name = path.basename(examplePath, path.extname(examplePath));
  const safeName = name.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  const artifactExtension = options.runtime === 'queue' ? 'skp' : 'json';
  const artifactPath = path.join(options.artifactDir, `${safeName}.${artifactExtension}`);

  await activeBridge.reset_model({ runtime: options.runtime, timeoutMs: options.timeoutMs, ...await freshSessionOptions(activeBridge, options) });
  const buildStarted = performance.now();
  await activeBridge.build_model({ code, runtime: options.runtime, timeoutMs: options.timeoutMs, ...await freshSessionOptions(activeBridge, options) });
  const buildMs = Math.round(performance.now() - buildStarted);
  const saveStarted = performance.now();
  const saved = await activeBridge.save_model({ path: artifactPath, keep_session: true, runtime: options.runtime, timeoutMs: options.timeoutMs, ...await freshSessionOptions(activeBridge, options) });
  const saveMs = Math.round(performance.now() - saveStarted);
  const report = compareSnapshots(saved.snapshot, saved.snapshot, { budgets: options.budgets, topIssueLimit: options.topIssueLimit });
  const metrics = metricsFromSnapshot(saved.snapshot, saved.file_size_bytes, buildMs, saveMs);
  const jsonPath = path.join(options.outputDir, `${safeName}.json`);
  const markdownPath = path.join(options.outputDir, `${safeName}.md`);
  await fs.writeFile(jsonPath, `${JSON.stringify({ name, example_path: examplePath, runtime: options.runtime, artifact_path: artifactPath, metrics, report }, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, formatSnapshotReportMarkdown(report, { title: `SketchUp Performance Budget: ${name}` }), 'utf8');
  return {
    name,
    example_path: examplePath,
    runtime: options.runtime,
    artifact_path: artifactPath,
    json_path: jsonPath,
    markdown_path: markdownPath,
    metrics,
    report
  };
}

function metricsFromSnapshot(snapshot, fileSizeBytes, buildMs, saveMs) {
  return {
    build_ms: buildMs,
    save_ms: saveMs,
    faces: snapshot?.totals?.faces || 0,
    edges: snapshot?.totals?.edges || 0,
    vertices: snapshot?.totals?.vertices || 0,
    groups: snapshot?.totals?.groups || 0,
    instances: snapshot?.totals?.instances || 0,
    component_definitions: snapshot?.component_definitions?.length || 0,
    materials: snapshot?.material_names?.length || 0,
    artifact_size_bytes: snapshot?.artifact_size_bytes || fileSizeBytes || 0
  };
}

function formatIndexMarkdown(results, options, aggregate) {
  const lines = [];
  lines.push('# SketchUp Performance Budget Index');
  lines.push('');
  lines.push(`- Verdict: **${aggregate.verdict}**`);
  lines.push(`- Level: **${aggregate.level}**`);
  lines.push(`- OK: **${aggregate.ok ? 'true' : 'false'}**`);
  lines.push(`- Runtime: \`${options.runtime}\``);
  lines.push(`- Generated at: \`${new Date().toISOString()}\``);
  lines.push('');
  lines.push('## Budgets');
  lines.push('');
  lines.push('| Budget | Limit |');
  lines.push('|---|---:|');
  for (const [key, value] of Object.entries(options.budgets)) {
    lines.push(`| \`${escapeMarkdown(key)}\` | ${value} |`);
  }
  lines.push('');
  lines.push('| Example | Verdict | Faces | Edges | Vertices | Groups | Instances | Artifact Bytes | Build ms | Save ms | Report |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const result of results) {
    const metrics = result.metrics;
    lines.push(`| ${escapeMarkdown(result.name)} | ${escapeMarkdown(result.report.verdict)} | ${metrics.faces} | ${metrics.edges} | ${metrics.vertices} | ${metrics.groups} | ${metrics.instances} | ${metrics.artifact_size_bytes} | ${metrics.build_ms} | ${metrics.save_ms} | [md](${path.basename(result.markdown_path)}) |`);
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
    ok: results.every((result) => result.report.verdict === 'pass'),
    level: worst,
    verdict: worst === 'ok' ? 'pass' : worst === 'error' ? 'fail' : 'review'
  };
}

function parseArgs(argv) {
  const options = {
    examples: [],
    runtime: 'mock',
    outputDir: 'output/performance-budgets',
    artifactDir: null,
    timeoutMs: undefined,
    topIssueLimit: 10,
    budgets: { ...DEFAULT_BUDGETS }
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--example') options.examples.push(argv[++index]);
    else if (arg === '--examples') options.examples.push(...argv[++index].split(',').map((item) => item.trim()).filter(Boolean));
    else if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--artifact-dir') options.artifactDir = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--top-issues') options.topIssueLimit = Number(argv[++index]);
    else if (arg === '--max-faces') options.budgets.max_faces = Number(argv[++index]);
    else if (arg === '--max-edges') options.budgets.max_edges = Number(argv[++index]);
    else if (arg === '--max-vertices') options.budgets.max_vertices = Number(argv[++index]);
    else if (arg === '--max-groups') options.budgets.max_groups = Number(argv[++index]);
    else if (arg === '--max-instances') options.budgets.max_instances = Number(argv[++index]);
    else if (arg === '--max-artifact-size-bytes') options.budgets.max_artifact_size_bytes = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') return usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['mock', 'queue'].includes(options.runtime)) throw new Error('--runtime must be mock or queue');
  options.artifactDir ||= path.join(options.outputDir, 'artifacts');
  return options;
}

function publicOptions(options) {
  return {
    examples: options.examples,
    runtime: options.runtime,
    outputDir: options.outputDir,
    artifactDir: options.artifactDir,
    timeoutMs: options.timeoutMs,
    topIssueLimit: options.topIssueLimit,
    budgets: options.budgets
  };
}

function usage() {
  process.stdout.write(`Usage:\n  node scripts/run-performance-budgets.mjs [--runtime mock|queue] [--example examples/golden-product.json]\n`);
  process.exit(0);
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
