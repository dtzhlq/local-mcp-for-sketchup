#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  assessRealWorldBuildingSourcePackage,
  buildRealWorldBuildingSourcePackageGateResult,
  renderRealWorldBuildingSourcePackageMarkdown
} from './lib/real-world-building-source-package.mjs';

const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/real-world-building-source-package';

export async function assessRealWorldBuildingSourcePackageCli({
  intakeDir = null,
  assetSetPath = null,
  observationsPath = null,
  candidateGraphPath = null,
  releaseChecklistPath = null,
  useReleaseChecklist = true,
  output = null,
  markdownOutput = null,
  gateOutput = null,
  writeMarkdown = true,
  requireInputReady = false,
  requireReleaseReady = false,
  generatedAt = undefined
} = {}) {
  if (!intakeDir && (!assetSetPath || !observationsPath || !candidateGraphPath)) {
    throw new Error('Either --intake-dir or all of --asset-set, --observations, and --candidate-graph is required.');
  }
  const resolvedIntakeDir = intakeDir ? resolveRepo(intakeDir) : null;
  const assetSet = await readJson(resolveRepo(assetSetPath || path.join(intakeDir, 'asset-set.json')));
  const observationSet = await readJson(resolveRepo(observationsPath || path.join(intakeDir, 'observations.json')));
  const candidateGraph = await readJson(resolveRepo(candidateGraphPath || path.join(intakeDir, 'candidate-graph.json')));
  const checklist = useReleaseChecklist
    ? await readOptionalJson(resolveRepo(releaseChecklistPath || defaultReleaseChecklistPath(resolvedIntakeDir)))
    : null;
  const report = assessRealWorldBuildingSourcePackage({
    assetSet,
    observationSet,
    candidateGraph,
    checklist,
    ...(generatedAt ? { generatedAt } : {})
  });
  const outputPath = output || (intakeDir
    ? path.join(intakeDir, 'real-world-building-source-package.json')
    : path.join(DEFAULT_OUTPUT_DIR, 'real-world-building-source-package.json'));
  const markdownPath = markdownOutput || outputPath.replace(/\.json$/u, '.md');
  await writeJson(resolveRepo(outputPath), report);
  if (writeMarkdown) {
    await fs.mkdir(path.dirname(resolveRepo(markdownPath)), { recursive: true });
    await fs.writeFile(resolveRepo(markdownPath), renderRealWorldBuildingSourcePackageMarkdown(report), 'utf8');
  }
  const gateResult = buildRealWorldBuildingSourcePackageGateResult({
    report,
    requireInputReady,
    requireReleaseReady,
    sourcePackagePath: outputPath,
    sourcePackageMarkdownPath: writeMarkdown ? markdownPath : null
  });
  const ok = gateResult.ok;
  const failedRequirements = gateResult.failed_requirements;
  const gateOutputPath = gateOutput || (requireInputReady || requireReleaseReady
    ? defaultGateOutputPath(outputPath)
    : null);
  if (gateOutputPath) await writeJson(resolveRepo(gateOutputPath), gateResult);
  return {
    ok,
    report,
    gateResult,
    failedRequirements,
    output: outputPath,
    markdownOutput: writeMarkdown ? markdownPath : null,
    gateOutput: gateOutputPath
  };
}

function defaultReleaseChecklistPath(resolvedIntakeDir) {
  if (!resolvedIntakeDir) return null;
  return path.join(resolvedIntakeDir, 'real-world-building-release', 'release-checklist.json');
}

function defaultGateOutputPath(outputPath) {
  return outputPath.endsWith('.json')
    ? outputPath.replace(/\.json$/u, '.gate-result.json')
    : `${outputPath}.gate-result.json`;
}

function parseArgs(argv) {
  const options = {
    useReleaseChecklist: true,
    writeMarkdown: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--intake-dir') options.intakeDir = nextValue(argv, ++index, arg);
    else if (arg === '--asset-set') options.assetSetPath = nextValue(argv, ++index, arg);
    else if (arg === '--observations') options.observationsPath = nextValue(argv, ++index, arg);
    else if (arg === '--candidate-graph') options.candidateGraphPath = nextValue(argv, ++index, arg);
    else if (arg === '--release-checklist') options.releaseChecklistPath = nextValue(argv, ++index, arg);
    else if (arg === '--no-release-checklist') options.useReleaseChecklist = false;
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--markdown-output') options.markdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--gate-output') options.gateOutput = nextValue(argv, ++index, arg);
    else if (arg === '--no-markdown') options.writeMarkdown = false;
    else if (arg === '--require-input-ready') options.requireInputReady = true;
    else if (arg === '--require-release-ready') options.requireReleaseReady = true;
    else if (arg === '--generated-at') options.generatedAt = nextValue(argv, ++index, arg);
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/assess-real-world-building-source-package.mjs \\
    --intake-dir output/image-structured-modeler/intake-building-single-regression

Options:
  --intake-dir <dir>          Existing intake directory.
  --asset-set <path>          Explicit asset-set.json path.
  --observations <path>       Explicit observations.json path.
  --candidate-graph <path>    Explicit candidate-graph.json path.
  --release-checklist <path>  Optional release-checklist.json path.
  --no-release-checklist      Ignore release checklist even if present.
  --output <path>             JSON output path.
  --markdown-output <path>    Markdown output path.
  --gate-output <path>        Gate result JSON output path.
  --no-markdown               Skip Markdown output.
  --require-input-ready       Exit non-zero unless source package can enter release-sample modeling work.
  --require-release-ready     Exit non-zero unless source package is fully release-ready.
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readOptionalJson(filePath) {
  if (!filePath) return null;
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(relativeOrAbsolute) {
  if (!relativeOrAbsolute) return null;
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  assessRealWorldBuildingSourcePackageCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.report.status,
        input_ready_for_release_work: result.report.input_ready_for_release_work,
        release_ready: result.report.release_ready,
        failed_requirements: result.failedRequirements,
        blockers: result.report.blockers,
        output: result.output,
        markdown: result.markdownOutput,
        gate_output: result.gateOutput
      }, null, 2)}\n`);
      if (!result.ok) process.exit(1);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
