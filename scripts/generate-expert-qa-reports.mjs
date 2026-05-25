#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { SketchUpBridge } from '../src/bridge.mjs';

const DEFAULT_EXPERT_EXAMPLES = [
  'examples/expert-parametric-fixture.js'
];

const DEFAULT_BUDGETS = {
  max_faces: 2000,
  max_edges: 5000,
  max_vertices: 3000,
  max_groups: 20,
  max_instances: 40,
  max_artifact_size_bytes: 5_000_000
};

const bridge = new SketchUpBridge();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const examples = options.examples.length > 0 ? options.examples : DEFAULT_EXPERT_EXAMPLES;
  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.mkdir(options.artifactDir, { recursive: true });

  const results = [];
  const run = async (activeBridge) => {
    for (const examplePath of examples) {
      const result = await runExpertExample(examplePath, options, activeBridge);
      results.push(result);
      process.stderr.write(`${result.report.verdict === 'pass' ? 'PASS' : 'REVIEW'} ${result.name} -> ${result.markdown_path}\n`);
    }
  };

  if (options.runtime === 'queue') {
    await bridge.withRuntimeLock('queue', { timeoutMs: options.timeoutMs }, run);
  } else {
    await run(bridge);
  }

  const aggregate = aggregateResult(results);
  const indexJsonPath = path.join(options.outputDir, 'index.json');
  const indexMarkdownPath = path.join(options.outputDir, 'index.md');
  await fs.writeFile(indexJsonPath, `${JSON.stringify({ generated_at: new Date().toISOString(), options: publicOptions(options), aggregate, results }, null, 2)}\n`, 'utf8');
  await fs.writeFile(indexMarkdownPath, formatIndexMarkdown(results, options, aggregate), 'utf8');
  process.stdout.write(`${JSON.stringify({ ...aggregate, count: results.length, index_json: indexJsonPath, index_markdown: indexMarkdownPath }, null, 2)}\n`);
  if (!aggregate.ok) process.exitCode = 1;
}

async function runExpertExample(examplePath, options, activeBridge) {
  const absoluteExamplePath = path.resolve(examplePath);
  const source = await fs.readFile(absoluteExamplePath, 'utf8');
  const name = path.basename(examplePath, path.extname(examplePath));
  const safeName = name.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  const artifactExtension = options.runtime === 'queue' ? 'skp' : 'json';
  const artifactPath = path.resolve(options.artifactDir, `${safeName}.${artifactExtension}`);

  await activeBridge.reset_model({ runtime: options.runtime, timeoutMs: options.timeoutMs });
  const buildStarted = performance.now();
  const built = await activeBridge.build_expert_model({
    code: source,
    runtime: options.runtime,
    timeoutMs: options.timeoutMs,
    seed: options.seed,
    maxOperations: options.expertLimits.maxOperations,
    maxLoopIterations: options.expertLimits.maxLoopIterations,
    maxStatements: options.expertLimits.maxStatements,
    maxOutputBytes: options.expertLimits.maxOutputBytes,
    expertTimeoutMs: options.expertLimits.expertTimeoutMs
  });
  const buildMs = Math.round(performance.now() - buildStarted);

  const saveStarted = performance.now();
  const saved = await activeBridge.save_model({ path: artifactPath, keep_session: true, runtime: options.runtime, timeoutMs: options.timeoutMs });
  const saveMs = Math.round(performance.now() - saveStarted);
  const snapshot = saved.snapshot || built.snapshot;
  const metrics = metricsFromSnapshot(snapshot, saved.file_size_bytes, buildMs, saveMs, built.compiled.expert);
  const report = evaluateExpertQa({ compiled: built.compiled, snapshot, metrics, budgets: options.budgets });

  const jsonPath = path.join(options.outputDir, `${safeName}.json`);
  const markdownPath = path.join(options.outputDir, `${safeName}.md`);
  const output = {
    name,
    example_path: examplePath,
    runtime: options.runtime,
    artifact_path: artifactPath,
    compiled: built.compiled,
    metrics,
    report
  };
  await fs.writeFile(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, formatExpertQaMarkdown(output), 'utf8');
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

function evaluateExpertQa({ compiled, snapshot, metrics, budgets }) {
  const issues = [];
  if (!compiled?.document?.operations || !Array.isArray(compiled.document.operations)) {
    issues.push(issue('expert.compile_output_missing', 'error', 'compiled.document.operations', 'Compiled Expert output is missing operations array'));
  }
  if (!compiled?.expert?.operations || compiled.expert.operations !== compiled.document.operations.length) {
    issues.push(issue('expert.operation_count_mismatch', 'error', 'compiled.expert.operations', 'Compiled operation metadata does not match operations length', compiled?.document?.operations?.length, compiled?.expert?.operations));
  }
  if (!snapshot?.runtime) {
    issues.push(issue('snapshot.runtime_missing', 'error', 'snapshot.runtime', 'Snapshot is missing runtime descriptor'));
  } else if (snapshot.runtime.compatibility?.ok === false) {
    issues.push(issue('runtime.compatibility_failed', 'error', 'snapshot.runtime.compatibility', 'Runtime compatibility check failed', true, snapshot.runtime.compatibility));
  }

  for (const warning of snapshot?.warnings || []) {
    const severity = warning.severity === 'error' ? 'error' : 'warn';
    issues.push(issue('snapshot.warning', severity, 'snapshot.warnings', warning.message || warning.type || 'Snapshot warning emitted', null, warning));
  }

  for (const budgetIssue of budgetIssues(metrics, budgets)) issues.push(budgetIssue);
  const summary = summarizeIssues(issues);
  const level = reportLevel(summary);
  return {
    ok: summary.by_severity.error === 0,
    level,
    verdict: verdictForLevel(level),
    summary,
    top_issues: issues.slice(0, 10),
    budgets,
    issues
  };
}

function budgetIssues(metrics, budgets) {
  const issues = [];
  checkBudget(issues, metrics, 'faces', budgets.max_faces, 'error');
  checkBudget(issues, metrics, 'edges', budgets.max_edges, 'warn');
  checkBudget(issues, metrics, 'vertices', budgets.max_vertices, 'warn');
  checkBudget(issues, metrics, 'groups', budgets.max_groups, 'warn');
  checkBudget(issues, metrics, 'instances', budgets.max_instances, 'warn');
  checkBudget(issues, metrics, 'artifact_size_bytes', budgets.max_artifact_size_bytes, 'warn');
  return issues;
}

function checkBudget(issues, metrics, metric, max, severity) {
  if (max === undefined || max === null || Number.isNaN(Number(max))) return;
  const actual = Number(metrics[metric] || 0);
  const limit = Number(max);
  if (actual > limit) {
    issues.push(issue('budget.exceeded', severity, `metrics.${metric}`, `${metric} exceeds budget`, limit, actual, { over_by: actual - limit }));
  }
}

function metricsFromSnapshot(snapshot, fileSizeBytes, buildMs, saveMs, expert) {
  return {
    build_ms: buildMs,
    save_ms: saveMs,
    expert_operations: expert?.operations || 0,
    expert_statements: expert?.stats?.statements || 0,
    expert_loop_iterations: expert?.stats?.loop_iterations || 0,
    faces: snapshot?.totals?.faces || 0,
    edges: snapshot?.totals?.edges || 0,
    vertices: snapshot?.totals?.vertices || 0,
    groups: snapshot?.totals?.groups || 0,
    instances: snapshot?.totals?.instances || 0,
    component_definitions: snapshot?.component_definitions?.length || 0,
    materials: snapshot?.material_names?.length || 0,
    warnings: snapshot?.warnings?.length || 0,
    artifact_size_bytes: snapshot?.artifact_size_bytes || fileSizeBytes || 0
  };
}

function formatExpertQaMarkdown(result) {
  const { report, metrics, compiled } = result;
  const lines = [];
  lines.push(`# Expert Mode QA: ${result.name}`);
  lines.push('');
  lines.push(`- Verdict: **${report.verdict}**`);
  lines.push(`- Level: **${report.level}**`);
  lines.push(`- OK: **${report.ok ? 'true' : 'false'}**`);
  lines.push(`- Runtime: \`${result.runtime}\``);
  lines.push(`- Example: \`${result.example_path}\``);
  lines.push(`- Artifact: \`${result.artifact_path}\``);
  lines.push('');
  lines.push('## Compiler');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---:|');
  lines.push(`| Operations | ${compiled.expert.operations} |`);
  lines.push(`| Seed | ${compiled.expert.seed} |`);
  lines.push(`| Statements | ${compiled.expert.stats.statements} |`);
  lines.push(`| Loop iterations | ${compiled.expert.stats.loop_iterations} |`);
  lines.push('');
  lines.push('## Runtime Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---:|');
  for (const key of ['faces', 'edges', 'vertices', 'groups', 'instances', 'component_definitions', 'materials', 'warnings', 'artifact_size_bytes', 'build_ms', 'save_ms']) {
    lines.push(`| \`${key}\` | ${metrics[key]} |`);
  }
  lines.push('');
  lines.push('## Budgets');
  lines.push('');
  lines.push('| Budget | Limit |');
  lines.push('|---|---:|');
  for (const [key, value] of Object.entries(report.budgets)) {
    lines.push(`| \`${escapeMarkdown(key)}\` | ${value} |`);
  }
  if (report.issues.length > 0) {
    lines.push('');
    lines.push('## Issues');
    lines.push('');
    lines.push('| Severity | Type | Path | Message |');
    lines.push('|---|---|---|---|');
    for (const item of report.issues) {
      lines.push(`| ${escapeMarkdown(item.severity)} | ${escapeMarkdown(item.type)} | \`${escapeMarkdown(item.path)}\` | ${escapeMarkdown(item.message)} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatIndexMarkdown(results, options, aggregate) {
  const lines = [];
  lines.push('# Expert Mode QA Report Index');
  lines.push('');
  lines.push(`- Verdict: **${aggregate.verdict}**`);
  lines.push(`- Level: **${aggregate.level}**`);
  lines.push(`- OK: **${aggregate.ok ? 'true' : 'false'}**`);
  lines.push(`- Runtime: \`${options.runtime}\``);
  lines.push(`- Seed: \`${options.seed}\``);
  lines.push(`- Generated at: \`${new Date().toISOString()}\``);
  lines.push('');
  lines.push('| Example | Verdict | Operations | Faces | Edges | Vertices | Groups | Instances | Warnings | Artifact Bytes | Build ms | Save ms | Report |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const result of results) {
    const metrics = result.metrics;
    lines.push(`| ${escapeMarkdown(result.name)} | ${escapeMarkdown(result.report.verdict)} | ${metrics.expert_operations} | ${metrics.faces} | ${metrics.edges} | ${metrics.vertices} | ${metrics.groups} | ${metrics.instances} | ${metrics.warnings} | ${metrics.artifact_size_bytes} | ${metrics.build_ms} | ${metrics.save_ms} | [md](${path.basename(result.markdown_path)}) |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function summarizeIssues(issues) {
  const summary = {
    total: issues.length,
    by_severity: { error: 0, warn: 0, info: 0 },
    by_type: {}
  };
  for (const item of issues) {
    summary.by_severity[item.severity] = (summary.by_severity[item.severity] || 0) + 1;
    summary.by_type[item.type] = (summary.by_type[item.type] || 0) + 1;
  }
  return summary;
}

function reportLevel(summary) {
  if (summary.by_severity.error > 0) return 'error';
  if (summary.by_severity.warn > 0) return 'warn';
  if (summary.by_severity.info > 0) return 'info';
  return 'ok';
}

function verdictForLevel(level) {
  if (level === 'error') return 'fail';
  if (level === 'warn') return 'review';
  if (level === 'info') return 'pass_with_notes';
  return 'pass';
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

function issue(type, severity, pathName, message, expected, actual, details) {
  return {
    type,
    severity,
    path: pathName,
    message,
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
    ...(details !== undefined ? { details } : {})
  };
}

function parseArgs(argv) {
  const options = {
    examples: [],
    runtime: 'mock',
    outputDir: 'output/qa-reports/expert',
    artifactDir: null,
    timeoutMs: undefined,
    seed: 7,
    expertLimits: {},
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
    else if (arg === '--seed') options.seed = Number(argv[++index]);
    else if (arg === '--max-operations') options.expertLimits.maxOperations = Number(argv[++index]);
    else if (arg === '--max-loop-iterations') options.expertLimits.maxLoopIterations = Number(argv[++index]);
    else if (arg === '--max-statements') options.expertLimits.maxStatements = Number(argv[++index]);
    else if (arg === '--max-output-bytes') options.expertLimits.maxOutputBytes = Number(argv[++index]);
    else if (arg === '--expert-timeout-ms') options.expertLimits.expertTimeoutMs = Number(argv[++index]);
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
    seed: options.seed,
    expertLimits: options.expertLimits,
    budgets: options.budgets
  };
}

function usage() {
  process.stdout.write(`Usage:\n  node scripts/generate-expert-qa-reports.mjs [--runtime mock|queue] [--example examples/expert-parametric-fixture.js]\n`);
  process.exit(0);
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
