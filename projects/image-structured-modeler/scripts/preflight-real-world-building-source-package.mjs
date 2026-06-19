#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  preflightRealWorldBuildingSourcePackage,
  renderRealWorldBuildingSourcePackagePreflightMarkdown
} from './lib/real-world-building-source-package-preflight.mjs';

const DEFAULT_OUTPUT = 'output/image-structured-modeler/real-world-building-source-package-preflight/preflight.json';

export async function preflightRealWorldBuildingSourcePackageCli({
  input,
  objectType = 'building_single',
  viewHintsFile = null,
  output = DEFAULT_OUTPUT,
  markdownOutput = null,
  writeMarkdown = true,
  requireIntakeStartable = false,
  requireReleaseSourceCandidate = false,
  generatedAt = undefined
} = {}) {
  const report = await preflightRealWorldBuildingSourcePackage({
    input,
    objectType,
    viewHintsFile,
    ...(generatedAt ? { generatedAt } : {})
  });
  const outputPath = output;
  const markdownPath = markdownOutput || outputPath.replace(/\.json$/u, '.md');
  await writeJson(resolveRepo(outputPath), report);
  if (writeMarkdown) {
    await fs.mkdir(path.dirname(resolveRepo(markdownPath)), { recursive: true });
    await fs.writeFile(resolveRepo(markdownPath), renderRealWorldBuildingSourcePackagePreflightMarkdown(report), 'utf8');
  }
  const failedRequirements = [];
  if (requireIntakeStartable && report.can_start_structured_intake !== true) failedRequirements.push('can_start_structured_intake');
  if (requireReleaseSourceCandidate && report.release_source_candidate !== true) failedRequirements.push('release_source_candidate');
  return {
    ok: failedRequirements.length === 0,
    failedRequirements,
    report,
    output: outputPath,
    markdownOutput: writeMarkdown ? markdownPath : null
  };
}

function parseArgs(argv) {
  const options = {
    objectType: 'building_single',
    writeMarkdown: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = nextValue(argv, ++index, arg);
    else if (arg === '--object-type') options.objectType = nextValue(argv, ++index, arg);
    else if (arg === '--view-hints-file') options.viewHintsFile = nextValue(argv, ++index, arg);
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--markdown-output') options.markdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--no-markdown') options.writeMarkdown = false;
    else if (arg === '--require-intake-startable') options.requireIntakeStartable = true;
    else if (arg === '--require-release-source-candidate') options.requireReleaseSourceCandidate = true;
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
  node projects/image-structured-modeler/scripts/preflight-real-world-building-source-package.mjs \\
    --input path/to/upload-package \\
    --object-type building_single

Options:
  --object-type <type>                  building_single or building_group. Defaults to building_single.
  --view-hints-file <path>              Optional view hints JSON.
  --output <path>                       JSON output path.
  --markdown-output <path>              Markdown output path.
  --no-markdown                         Skip Markdown output.
  --require-intake-startable            Exit non-zero unless the package can start structured intake.
  --require-release-source-candidate    Exit non-zero unless paths/types/view labels look ready for release-source intake.
`);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  preflightRealWorldBuildingSourcePackageCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.report.status,
        can_start_structured_intake: result.report.can_start_structured_intake,
        release_source_candidate: result.report.release_source_candidate,
        failed_requirements: result.failedRequirements,
        blockers: result.report.blockers,
        warnings: result.report.warnings,
        output: result.output,
        markdown: result.markdownOutput
      }, null, 2)}\n`);
      if (!result.ok) process.exit(1);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
