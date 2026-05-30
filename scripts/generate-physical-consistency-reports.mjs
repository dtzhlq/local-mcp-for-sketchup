#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  formatPhysicalConsistencyQaReportMarkdown,
  validatePartGraphPhysicalConsistency
} from '../src/product-modeling/physical-consistency-qa.mjs';

const DEFAULT_SAMPLES = [
  {
    name: 'ambulance-reference',
    partGraph: 'examples/part-graphs/ambulance-reference.part-graph.json'
  },
  {
    name: 'switch-controller-reference',
    partGraph: 'examples/part-graphs/switch-controller-reference.part-graph.json'
  },
  {
    name: 'fuji-camera-reference',
    partGraph: 'examples/part-graphs/fuji-camera-reference.part-graph.json'
  }
];

const options = parseArgs(process.argv.slice(2));
const outputDir = options.outputDir || 'output/physical-consistency-qa';
const samples = options.samples.length ? options.samples : DEFAULT_SAMPLES;
const results = [];

await fs.mkdir(outputDir, { recursive: true });
for (const sample of samples) {
  const result = await evaluateSample(sample, { outputDir });
  results.push(result);
}

const report = {
  kind: 'physical_consistency_qa_batch',
  ok: results.every((result) => result.ok),
  samples: results
};
await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(outputDir, 'index.md'), formatBatchMarkdown(report), 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: report.ok,
  output_dir: outputDir,
  samples: results.map((result) => ({
    name: result.name,
    ok: result.ok,
    verdict: result.verdict,
    checked_relations: result.summary.checked_relations,
    issues: result.summary.total,
    errors: result.summary.by_severity.error,
    warnings: result.summary.by_severity.warn
  }))
}, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

async function evaluateSample(sample, options) {
  const partGraph = JSON.parse(await fs.readFile(sample.partGraph, 'utf8'));
  const report = validatePartGraphPhysicalConsistency(partGraph);
  const sampleDir = path.join(options.outputDir, sample.name);
  await fs.mkdir(sampleDir, { recursive: true });
  await fs.writeFile(path.join(sampleDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(sampleDir, 'report.md'), formatPhysicalConsistencyQaReportMarkdown(report, { title: `${sample.name} Physical Consistency QA` }), 'utf8');
  return {
    name: sample.name,
    part_graph: sample.partGraph,
    ok: report.ok,
    verdict: report.verdict,
    level: report.level,
    summary: report.summary,
    report: path.join(sampleDir, 'report.md')
  };
}

function parseArgs(argv) {
  const parsed = { samples: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--sample') parsed.samples.push(parseSample(argv[++index]));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function parseSample(value) {
  const [name, partGraph] = value.split(':');
  if (!name || !partGraph) throw new Error('--sample must be name:partGraph');
  return { name, partGraph };
}

function formatBatchMarkdown(report) {
  const lines = [
    '# Physical Consistency QA',
    '',
    '| Sample | Verdict | Relations | Issues | Errors | Warnings | Report |',
    '|---|---|---:|---:|---:|---:|---|'
  ];
  for (const sample of report.samples) {
    lines.push([
      sample.name,
      sample.verdict,
      sample.summary.checked_relations,
      sample.summary.total,
      sample.summary.by_severity.error,
      sample.summary.by_severity.warn,
      `\`${sample.report}\``
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
