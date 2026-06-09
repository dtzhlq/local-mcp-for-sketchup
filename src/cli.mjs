#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from './bridge.mjs';
import { formatModelQaReportMarkdown } from './model-qa.mjs';
import { formatReferenceVisualQaReportMarkdown } from './reference-visual-qa.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { formatSnapshotReportMarkdown } from './snapshot-report.mjs';

const bridge = new SketchUpBridge();

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  const options = parseArgs(argv);

  switch (command) {
    case 'get_docs':
      return output(await bridge.get_docs(), options);
    case 'get_capabilities':
      return output(await bridge.get_capabilities({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs }), options);
    case 'queue_diagnostics':
      return output(await bridge.queue_diagnostics({ includeFiles: options.includeFiles === true, timeoutMs: options.timeoutMs }), options);
    case 'reset_model':
      return output(await bridge.reset_model({ runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs }), options);
    case 'build_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.build_model({ code, runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs }), options);
    }
    case 'compile_expert': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.compile_expert({ code, ...expertOptions(options) }), options);
    }
    case 'build_expert_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.build_expert_model({ code, runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs, ...expertOptions(options) }), options);
    }
    case 'save_model':
      return output(await bridge.save_model({ path: options.path, keep_session: options.keepSession !== false, runtime: options.runtime || 'mock', timeoutMs: options.timeoutMs }), options);
    case 'capture_view':
      return output(await bridge.capture_view({
        path: options.path,
        view: options.view,
        width: options.width,
        height: options.height,
        antialias: options.antialias,
        compression: options.compression,
        zoom_extents: options.zoomExtents,
        runtime: options.runtime || 'queue',
        timeoutMs: options.timeoutMs
      }), options);
    case 'compare_snapshots': {
      const expected = await readSnapshotJson(options.expectedFile, 'expected');
      const actual = await readSnapshotJson(options.actualFile, 'actual');
      return output(compareSnapshots(expected, actual, { toleranceMm: options.toleranceMm, topologyTolerance: topologyToleranceOptions(options), budgets: budgetOptions(options), topIssueLimit: options.topIssueLimit }), options, { markdownTitle: 'SketchUp Snapshot Compare Report' });
    }
    case 'compare_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      return output(await bridge.compare_model({
        code,
        expected_runtime: options.expectedRuntime || 'mock',
        actual_runtime: options.actualRuntime || 'queue',
        timeoutMs: options.timeoutMs,
        reset_first: options.resetFirst !== false,
        toleranceMm: options.toleranceMm,
        topologyTolerance: topologyToleranceOptions(options),
        budgets: budgetOptions(options),
        topIssueLimit: options.topIssueLimit,
        include_snapshots: options.includeSnapshots === true
      }), options, { markdownTitle: 'SketchUp Model Runtime Compare Report' });
    }
    case 'validate_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      const snapshot = options.snapshotFile ? await readSnapshotJson(options.snapshotFile, 'snapshot') : undefined;
      const spec = options.specFile ? JSON.parse(await fs.readFile(options.specFile, 'utf8')) : undefined;
      const result = await bridge.validate_model({
        code,
        snapshot,
        spec,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        includePreview: options.includePreview !== false,
        strictCollisions: options.strictCollisions,
        strictUnanchored: options.strictUnanchored,
        floatingDetails: options.floatingDetails
      });
      if (options.previewDir) {
        await writePreviewFiles(result, options.previewDir);
      }
      return output(result, options, { markdownTitle: 'SketchUp Model QA Report' });
    }
    case 'validate_reference_model': {
      const code = options.codeFile ? await fs.readFile(options.codeFile, 'utf8') : options.code;
      const snapshot = options.snapshotFile ? await readSnapshotJson(options.snapshotFile, 'snapshot') : undefined;
      const spec = options.specFile ? JSON.parse(await fs.readFile(options.specFile, 'utf8')) : undefined;
      const result = await bridge.validate_reference_model({
        code,
        snapshot,
        spec,
        runtime: options.runtime || 'mock',
        timeoutMs: options.timeoutMs,
        includePreview: options.includePreview !== false
      });
      if (options.previewDir) {
        await writePreviewFiles(result, options.previewDir);
      }
      return output(result, options, { markdownTitle: 'SketchUp Reference Visual QA Report' });
    }
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--expected-runtime') options.expectedRuntime = argv[++index];
    else if (arg === '--actual-runtime') options.actualRuntime = argv[++index];
    else if (arg === '--code') options.code = argv[++index];
    else if (arg === '--code-file') options.codeFile = argv[++index];
    else if (arg === '--path') options.path = argv[++index];
    else if (arg === '--view') options.view = argv[++index];
    else if (arg === '--width') options.width = Number(argv[++index]);
    else if (arg === '--height') options.height = Number(argv[++index]);
    else if (arg === '--compression') options.compression = Number(argv[++index]);
    else if (arg === '--output-file') options.outputFile = argv[++index];
    else if (arg === '--format') options.format = argv[++index];
    else if (arg === '--expected-file') options.expectedFile = argv[++index];
    else if (arg === '--actual-file') options.actualFile = argv[++index];
    else if (arg === '--snapshot-file') options.snapshotFile = argv[++index];
    else if (arg === '--spec-file') options.specFile = argv[++index];
    else if (arg === '--preview-dir') options.previewDir = argv[++index];
    else if (arg === '--tolerance-mm') options.toleranceMm = Number(argv[++index]);
    else if (arg === '--face-tolerance') options.faceTolerance = Number(argv[++index]);
    else if (arg === '--edge-tolerance') options.edgeTolerance = Number(argv[++index]);
    else if (arg === '--group-tolerance') options.groupTolerance = Number(argv[++index]);
    else if (arg === '--instance-tolerance') options.instanceTolerance = Number(argv[++index]);
    else if (arg === '--top-issues') options.topIssueLimit = Number(argv[++index]);
    else if (arg === '--max-faces') options.maxFaces = Number(argv[++index]);
    else if (arg === '--max-edges') options.maxEdges = Number(argv[++index]);
    else if (arg === '--max-vertices') options.maxVertices = Number(argv[++index]);
    else if (arg === '--max-groups') options.maxGroups = Number(argv[++index]);
    else if (arg === '--max-instances') options.maxInstances = Number(argv[++index]);
    else if (arg === '--max-artifact-size-bytes') options.maxArtifactSizeBytes = Number(argv[++index]);
    else if (arg === '--max-operations') options.maxOperations = Number(argv[++index]);
    else if (arg === '--max-loop-iterations') options.maxLoopIterations = Number(argv[++index]);
    else if (arg === '--max-statements') options.maxStatements = Number(argv[++index]);
    else if (arg === '--max-output-bytes') options.maxOutputBytes = Number(argv[++index]);
    else if (arg === '--expert-timeout-ms') options.expertTimeoutMs = Number(argv[++index]);
    else if (arg === '--seed') options.seed = Number(argv[++index]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--no-keep-session') options.keepSession = false;
    else if (arg === '--no-reset-first') options.resetFirst = false;
    else if (arg === '--include-snapshots') options.includeSnapshots = true;
    else if (arg === '--include-files') options.includeFiles = true;
    else if (arg === '--antialias') options.antialias = true;
    else if (arg === '--no-antialias') options.antialias = false;
    else if (arg === '--zoom-extents') options.zoomExtents = true;
    else if (arg === '--no-zoom-extents') options.zoomExtents = false;
    else if (arg === '--no-preview') options.includePreview = false;
    else if (arg === '--strict-collisions') options.strictCollisions = true;
    else if (arg === '--loose-collisions') options.strictCollisions = false;
    else if (arg === '--strict-unanchored') options.strictUnanchored = true;
    else if (arg === '--no-floating-details') options.floatingDetails = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function expertOptions(options) {
  return {
    seed: options.seed,
    maxOperations: options.maxOperations,
    maxLoopIterations: options.maxLoopIterations,
    maxStatements: options.maxStatements,
    maxOutputBytes: options.maxOutputBytes,
    expertTimeoutMs: options.expertTimeoutMs
  };
}

async function readSnapshotJson(filePath, label) {
  if (!filePath) throw new Error(`compare_snapshots requires --${label}-file`);
  const document = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!document.snapshot) return document;
  return {
    ...document.snapshot,
    artifact_size_bytes: document.snapshot.artifact_size_bytes ?? document.file_size_bytes
  };
}

function topologyToleranceOptions(options) {
  return {
    faces: options.faceTolerance,
    edges: options.edgeTolerance,
    groups: options.groupTolerance,
    instances: options.instanceTolerance
  };
}

function budgetOptions(options) {
  return {
    max_faces: options.maxFaces,
    max_edges: options.maxEdges,
    max_vertices: options.maxVertices,
    max_groups: options.maxGroups,
    max_instances: options.maxInstances,
    max_artifact_size_bytes: options.maxArtifactSizeBytes
  };
}

async function output(value, options, { markdownTitle } = {}) {
  const rendered = renderOutput(value, options, { markdownTitle });
  if (options.outputFile) {
    await fs.writeFile(options.outputFile, rendered, 'utf8');
    process.stderr.write(`Wrote ${options.format || 'json'} output to ${options.outputFile}\n`);
    return;
  }
  process.stdout.write(rendered);
}

function renderOutput(value, options, { markdownTitle } = {}) {
  if (options.format === 'markdown') {
    if (value?.kind === 'model_qa') {
      return formatModelQaReportMarkdown(value, { title: markdownTitle || 'SketchUp Model QA Report' });
    }
    if (value?.kind === 'reference_visual_qa') {
      return formatReferenceVisualQaReportMarkdown(value, { title: markdownTitle || 'SketchUp Reference Visual QA Report' });
    }
    return formatSnapshotReportMarkdown(value, { title: markdownTitle || 'SketchUp QA Report' });
  }
  if (options.format === 'dsl') {
    if (typeof value.code !== 'string') throw new Error('--format dsl requires a compile_expert result');
    return value.code;
  }
  if (options.format && options.format !== 'json') {
    throw new Error(`Unknown format: ${options.format}`);
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writePreviewFiles(report, previewDir) {
  if (!report.preview) return;
  await fs.mkdir(previewDir, { recursive: true });
  const viewFiles = [];
  for (const view of report.preview.views || []) {
    const fileName = `${safeFileName(view.name)}.svg`;
    const filePath = path.join(previewDir, fileName);
    await fs.writeFile(filePath, view.svg, 'utf8');
    viewFiles.push({ name: view.name, path: filePath });
  }
  const htmlPath = path.join(previewDir, 'index.html');
  await fs.writeFile(htmlPath, report.preview.html, 'utf8');
  report.preview_files = { html: htmlPath, views: viewFiles };
}

function safeFileName(value) {
  return String(value || 'view').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'view';
}

function usage() {
  process.stdout.write(`Usage:
  node src/cli.mjs get_docs
  node src/cli.mjs get_capabilities [--runtime mock|queue]
  node src/cli.mjs queue_diagnostics [--include-files]
  node src/cli.mjs reset_model [--runtime mock|queue]
  node src/cli.mjs build_model --code-file examples/demo-room.json [--runtime mock|queue]
  node src/cli.mjs compile_expert --code-file examples/expert-parametric-fixture.js [--format dsl]
  node src/cli.mjs build_expert_model --code-file examples/expert-parametric-fixture.js [--runtime mock|queue]
  node src/cli.mjs save_model --path output/model.json [--runtime mock|queue] [--no-keep-session]
  node src/cli.mjs capture_view --path output/capture.png [--view current|top|front|right|iso] [--width 1280] [--height 720] [--runtime queue]
  node src/cli.mjs compare_snapshots --expected-file output/mock-a.json --actual-file output/mock-b.json [--tolerance-mm 1] [--face-tolerance 1] [--edge-tolerance 3] [--max-faces 5000] [--max-artifact-size-bytes 50000000] [--format markdown] [--output-file output/report.md]
  node src/cli.mjs compare_model --code-file examples/demo-room.json [--expected-runtime mock] [--actual-runtime queue] [--timeout-ms 60000] [--face-tolerance 1] [--edge-tolerance 3] [--format markdown] [--output-file output/report.md]
  node src/cli.mjs validate_model --code-file examples/demo-room.json [--runtime mock|queue] [--spec-file examples/model-qa/spec.json] [--preview-dir output/model-qa/demo] [--format markdown] [--output-file output/model-qa/demo.md]
  node src/cli.mjs validate_reference_model --code-file examples/acceptance-ambulance-reference.json [--runtime mock|queue] [--spec-file examples/reference-visual-qa/ambulance-reference.json] [--preview-dir output/reference-visual-qa/ambulance-reference] [--format markdown] [--output-file output/reference-visual-qa/ambulance-reference/report.md]

Runtime notes:
  mock  - deterministic offline runtime for tests and Alma iteration.
  queue - sends requests to the SketchUp Ruby plugin through ~/.sketchup-mcp-replica.
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
