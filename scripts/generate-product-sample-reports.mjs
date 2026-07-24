#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { freshSessionOptions } from '../src/live-session-contract.mjs';
import { compilePartGraphFiles } from '../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphPhysicalConsistency } from '../src/product-modeling/physical-consistency-qa.mjs';

const DEFAULT_SAMPLES = [
  {
    name: 'ambulance-reference',
    profile: 'examples/product-profiles/vehicle_ambulance.json',
    partGraph: 'examples/part-graphs/ambulance-reference.part-graph.json',
    code: 'examples/acceptance-ambulance-reference.json',
    layoutSpec: 'examples/model-qa/ambulance-reference.json',
    referenceSpec: 'examples/reference-visual-qa/ambulance-reference.json'
  },
  {
    name: 'switch-controller-reference',
    profile: 'examples/product-profiles/game_controller_switch.json',
    partGraph: 'examples/part-graphs/switch-controller-reference.part-graph.json',
    code: 'examples/acceptance-switch-controller.json',
    layoutSpec: 'examples/model-qa/switch-controller-demo.json',
    referenceSpec: 'examples/reference-visual-qa/switch-controller-reference.json'
  },
  {
    name: 'fuji-camera-reference',
    profile: 'examples/product-profiles/camera_fuji_x_t10.json',
    partGraph: 'examples/part-graphs/fuji-camera-reference.part-graph.json',
    code: 'examples/acceptance-fuji-camera.json',
    layoutSpec: 'examples/model-qa/fuji-camera-reference.json',
    referenceSpec: 'examples/reference-visual-qa/fuji-camera-reference.json'
  }
];

const options = parseArgs(process.argv.slice(2));
const outputDir = options.outputDir || 'output/product-sample-qa';
const samples = options.samples.length ? options.samples : DEFAULT_SAMPLES;
const bridge = new SketchUpBridge();
const results = [];
const runtime = options.runtime || 'mock';
const saveArtifacts = options.saveArtifacts || runtime === 'queue';

await fs.mkdir(outputDir, { recursive: true });
if (saveArtifacts) await fs.mkdir(path.join(outputDir, 'artifacts'), { recursive: true });

for (const sample of samples) {
  const result = await evaluateSample(sample, {
    runtime,
    timeoutMs: options.timeoutMs,
    outputDir,
    saveArtifacts
  });
  results.push(result);
}

const report = {
  kind: 'product_sample_qa',
  ok: results.every((result) => result.ok),
  runtime,
  timeout_ms: options.timeoutMs ?? null,
  artifacts_saved: saveArtifacts,
  samples: results
};

await fs.writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(outputDir, 'index.md'), formatMarkdown(report), 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: report.ok,
  output_dir: outputDir,
  samples: results.map((result) => ({
    name: result.name,
    ok: result.ok,
    compiled_matches_output: result.compiled_matches_output,
    layout: result.layout.verdict,
    reference_visual: result.reference_visual.verdict,
    physical_consistency: result.physical_consistency.verdict,
    fallback_ratios: result.fallback_ratios,
    artifact: result.artifact?.path
  }))
}, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

async function evaluateSample(sample, options) {
  const [profile, partGraph, outputDocument, layoutSpec, referenceSpec] = await Promise.all([
    readJson(sample.profile),
    readJson(sample.partGraph),
    readJson(sample.code),
    readJson(sample.layoutSpec),
    readJson(sample.referenceSpec)
  ]);
  const compiled = await compilePartGraphFiles({
    profilePath: sample.profile,
    partGraphPath: sample.partGraph,
    repoRoot: process.cwd()
  });
  const compiledMatchesOutput = stableJson(compiled) === stableJson(outputDocument);
  const code = JSON.stringify(outputDocument);
  const layout = await bridge.validate_model({
    code,
    spec: layoutSpec,
    runtime: options.runtime,
    timeoutMs: options.timeoutMs,
    includePreview: false,
    ...await freshSessionOptions(bridge, options)
  });
  const referenceVisual = await bridge.validate_reference_model({
    code,
    spec: referenceSpec,
    runtime: options.runtime,
    timeoutMs: options.timeoutMs,
    includePreview: false,
    ...await freshSessionOptions(bridge, options)
  });
  const physicalConsistency = validatePartGraphPhysicalConsistency(partGraph);
  const artifact = options.saveArtifacts
    ? await saveSampleArtifact(sample, { runtime: options.runtime, timeoutMs: options.timeoutMs, outputDir: options.outputDir })
    : null;
  const fallback = countBy(partGraph.parts || [], 'fallback_state');
  const evidence = countBy(partGraph.parts || [], 'evidence_status');
  const partCount = Math.max(1, (partGraph.parts || []).length);
  return {
    name: sample.name,
    product_type: partGraph.product?.type || profile.product_type,
    profile_id: partGraph.profile_id || profile.profile_id,
    part_graph: sample.partGraph,
    code: sample.code,
    ok: compiledMatchesOutput && layout.ok && referenceVisual.ok && physicalConsistency.ok,
    compiled_matches_output: compiledMatchesOutput,
    part_count: partGraph.parts?.length || 0,
    fallback_summary: fallback,
    fallback_ratios: ratiosFor(fallback, partCount),
    evidence_summary: evidence,
    evidence_ratios: ratiosFor(evidence, partCount),
    scale_confidence: partGraph.scale?.confidence ?? null,
    layout: summarizeQa(layout),
    reference_visual: summarizeQa(referenceVisual),
    physical_consistency: summarizeQa(physicalConsistency, { checked_relations: physicalConsistency.summary.checked_relations }),
    artifact
  };
}

async function saveSampleArtifact(sample, options) {
  const filePath = path.resolve(options.outputDir, 'artifacts', `${sample.name}.${options.runtime === 'queue' ? 'skp' : 'json'}`);
  const saved = await bridge.save_model({
    path: filePath,
    runtime: options.runtime,
    timeoutMs: options.timeoutMs,
    ...await freshSessionOptions(bridge, options)
  });
  return {
    path: saved.file_path,
    size_bytes: saved.file_size_bytes ?? saved.snapshot?.artifact_size_bytes ?? null,
    totals: saved.snapshot?.totals || null
  };
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
  for (const item of items) result[item[key]] = (result[item[key]] || 0) + 1;
  return result;
}

function ratiosFor(counts, total) {
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, round(count / total, 3)]));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function stableJson(value) {
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const parsed = { samples: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--runtime') parsed.runtime = argv[++index];
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(argv[++index]);
    else if (arg === '--save-artifacts') parsed.saveArtifacts = true;
    else if (arg === '--no-save-artifacts') parsed.saveArtifacts = false;
    else if (arg === '--sample') parsed.samples.push(parseSample(argv[++index]));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function parseSample(value) {
  const [name, profile, partGraph, code, layoutSpec, referenceSpec] = value.split(':');
  if (!name || !profile || !partGraph || !code || !layoutSpec || !referenceSpec) {
    throw new Error('--sample must be name:profile:partGraph:code:layoutSpec:referenceSpec');
  }
  return { name, profile, partGraph, code, layoutSpec, referenceSpec };
}

function formatMarkdown(report) {
  const lines = [
    '# Product Sample QA',
    '',
    `Runtime: ${report.runtime}`,
    '',
    '| Sample | Product | Parts | Compiled | Layout | Reference Visual | Physical | Fallback Ratios | Evidence Ratios | Scale Confidence |',
    '|---|---|---:|---|---|---|---|---|---|---:|'
  ];
  for (const sample of report.samples) {
    lines.push([
      sample.name,
      sample.product_type,
      sample.part_count,
      sample.compiled_matches_output ? 'match' : 'stale',
      `${sample.layout.verdict} (${sample.layout.issues})`,
      `${sample.reference_visual.verdict} (${sample.reference_visual.issues})`,
      `${sample.physical_consistency.verdict} (${sample.physical_consistency.checked_relations} rel / ${sample.physical_consistency.issues} issues)`,
      formatRatios(sample.fallback_ratios),
      formatRatios(sample.evidence_ratios),
      sample.scale_confidence ?? ''
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  if (report.samples.some((sample) => sample.artifact)) {
    lines.push('', '## Artifacts', '');
    for (const sample of report.samples) {
      if (!sample.artifact) continue;
      const totals = sample.artifact.totals
        ? ` — ${sample.artifact.totals.groups} groups / ${sample.artifact.totals.faces} faces / ${sample.artifact.totals.edges} edges`
        : '';
      const size = sample.artifact.size_bytes ? ` — ${sample.artifact.size_bytes} bytes` : '';
      lines.push(`- ${sample.name}: \`${sample.artifact.path}\`${totals}${size}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatRatios(ratios) {
  return Object.entries(ratios)
    .map(([key, value]) => `${key} ${value}`)
    .join('<br>');
}
