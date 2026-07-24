#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';
import { formatReferenceVisualQaReportMarkdown } from '../src/reference-visual-qa.mjs';

const DEFAULT_EXAMPLES = [
  {
    name: 'ambulance-reference',
    code: 'examples/acceptance-ambulance-reference.json',
    spec: 'examples/reference-visual-qa/ambulance-reference.json'
  },
  {
    name: 'switch-controller-reference',
    code: 'examples/acceptance-switch-controller.json',
    spec: 'examples/reference-visual-qa/switch-controller-reference.json'
  },
  {
    name: 'fuji-camera-reference',
    code: 'examples/acceptance-fuji-camera.json',
    spec: 'examples/reference-visual-qa/fuji-camera-reference.json'
  }
];

const options = parseArgs(process.argv.slice(2));
const bridge = new SketchUpBridge();
const outputDir = options.outputDir || 'output/reference-visual-qa';
const examples = options.examples.length ? options.examples : DEFAULT_EXAMPLES;
const results = [];

await fs.mkdir(outputDir, { recursive: true });

for (const example of examples) {
  const code = await fs.readFile(example.code, 'utf8');
  const spec = JSON.parse(await fs.readFile(example.spec, 'utf8'));
  const report = await bridge.validate_reference_model({
    code,
    spec,
    runtime: options.runtime || 'mock',
    timeoutMs: options.timeoutMs,
    includePreview: options.includePreview !== false,
    ...await freshSessionOptions(bridge, { runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs })
  });
  const exampleDir = path.join(outputDir, example.name);
  await fs.mkdir(exampleDir, { recursive: true });
  await writePreviewFiles(report, exampleDir);
  const jsonPath = path.join(exampleDir, 'report.json');
  const markdownPath = path.join(exampleDir, 'report.md');
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(markdownPath, formatReferenceVisualQaReportMarkdown(report, { title: `SketchUp Reference Visual QA: ${example.name}` }), 'utf8');
  results.push({
    name: example.name,
    ok: report.ok,
    verdict: report.verdict,
    level: report.level,
    issues: report.summary.total,
    errors: report.summary.by_severity.error,
    warnings: report.summary.by_severity.warn,
    report: markdownPath,
    preview: report.preview_files?.html
  });
}

await fs.writeFile(path.join(outputDir, 'index.md'), formatIndex(results), 'utf8');
process.stdout.write(`${JSON.stringify({ ok: results.every((result) => result.ok), output_dir: outputDir, results }, null, 2)}\n`);
if (results.some((result) => !result.ok)) process.exitCode = 1;

function parseArgs(argv) {
  const parsed = { examples: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--runtime') parsed.runtime = argv[++index];
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(argv[++index]);
    else if (arg === '--no-preview') parsed.includePreview = false;
    else if (arg === '--example') parsed.examples.push(parseExample(argv[++index]));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function parseExample(value) {
  const [name, code, spec] = value.split(':');
  if (!name || !code || !spec) throw new Error('--example must be name:code:spec');
  return { name, code, spec };
}

async function writePreviewFiles(report, dir) {
  const views = [];
  for (const view of report.preview?.views || []) {
    const fileName = `${safeFileName(view.name)}.svg`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, view.svg, 'utf8');
    views.push({ name: view.name, path: filePath });
  }
  if (report.preview?.html) {
    const htmlPath = path.join(dir, 'index.html');
    await fs.writeFile(htmlPath, report.preview.html, 'utf8');
    report.preview_files = { html: htmlPath, views };
  }
}

function formatIndex(results) {
  const lines = ['# SketchUp Reference Visual QA', '', '| Example | Verdict | Level | Errors | Warnings | Report | Preview |', '|---|---|---|---:|---:|---|---|'];
  for (const result of results) {
    lines.push(`| ${result.name} | ${result.verdict} | ${result.level} | ${result.errors} | ${result.warnings} | [report](${path.relative(path.dirname(path.join(outputDir, 'index.md')), result.report)}) | [preview](${path.relative(path.dirname(path.join(outputDir, 'index.md')), result.preview)}) |`);
  }
  lines.push('');
  return `${lines.join('\n')}`;
}

function safeFileName(value) {
  return String(value || 'view').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'view';
}
