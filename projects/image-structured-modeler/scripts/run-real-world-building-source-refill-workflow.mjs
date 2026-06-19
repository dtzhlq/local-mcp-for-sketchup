#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { buildRealWorldBuildingSourceRefillManifestCli } from './build-real-world-building-source-refill-manifest.mjs';
import { validateRealWorldBuildingSourceRefillPackageCli } from './validate-real-world-building-source-refill-package.mjs';
import { runRealWorldBuildingUploadSession } from './run-real-world-building-upload-session.mjs';

const DEFAULT_REPORT = 'source-refill-workflow-report.json';

export async function runRealWorldBuildingSourceRefillWorkflowCli({
  packageDir,
  output = null,
  markdownOutput = null,
  buildManifest = true,
  rebuildManifest = false,
  runUploadSession = false,
  uploadSessionOutputDir = null,
  requireInputReady = false,
  requirePreflightReleaseSourceCandidate = false,
  units = null,
  knownWidth = null,
  knownDepth = null,
  knownHeight = null,
  scaleBasis = null,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!packageDir) throw new Error('--package-dir is required.');
  const guidePath = path.join(packageDir, 'source-refill-package-guide.json');
  const guide = await readJson(resolveRepo(guidePath));
  if (guide.kind !== 'real_world_building_source_refill_package_guide') {
    throw new Error(`Expected source refill package guide, got ${guide.kind || 'unknown kind'}.`);
  }

  const uploadPackageDir = guide.output_package?.upload_package_directory || path.join(packageDir, 'upload-package');
  const manifestPath = path.join(uploadPackageDir, 'manifest.json');
  const workflowReport = output || path.join(packageDir, DEFAULT_REPORT);
  const workflowMarkdown = markdownOutput || workflowReport.replace(/\.json$/u, '.md');
  const steps = [];
  let manifestBuild = null;
  if (buildManifest && (rebuildManifest || !await pathExists(resolveRepo(manifestPath)))) {
    manifestBuild = await buildRealWorldBuildingSourceRefillManifestCli({
      packageDir,
      output: manifestPath,
      reportOutput: path.join(packageDir, 'source-refill-manifest-build-report.json'),
      markdownOutput: path.join(packageDir, 'source-refill-manifest-build-report.md'),
      force: rebuildManifest || !await pathExists(resolveRepo(manifestPath)),
      units,
      knownWidth,
      knownDepth,
      knownHeight,
      scaleBasis,
      generatedAt
    });
    steps.push(step('build_manifest_from_sources', manifestBuild.ok ? 'pass' : 'blocked', manifestBuild.status, {
      report: manifestBuild.reportOutput,
      manifest: manifestBuild.manifestOutput
    }));
  } else {
    steps.push(step('build_manifest_from_sources', 'skipped', buildManifest ? 'manifest_already_present' : 'disabled', {
      manifest: manifestPath
    }));
  }

  const validation = await validateRealWorldBuildingSourceRefillPackageCli({
    packageDir,
    output: path.join(packageDir, 'source-refill-package-validation.workflow.json'),
    markdownOutput: path.join(packageDir, 'source-refill-package-validation.workflow.md'),
    requireUploadReady: true,
    generatedAt
  });
  steps.push(step('validate_refill_package_require_upload_ready', validation.ok ? 'pass' : 'blocked', validation.status, {
    report: validation.output,
    failed_required_checks: validation.report.summary.failed_required_checks
  }));

  let uploadSession = null;
  if (validation.report.can_run_upload_session && runUploadSession) {
    const sessionOutputDir = uploadSessionOutputDir
      || guide.output_package?.upload_session_output_dir
      || path.join('output/image-structured-modeler/real-world-building-upload-session', `${path.basename(packageDir)}-workflow`);
    uploadSession = await runRealWorldBuildingUploadSession({
      input: uploadPackageDir,
      objectType: guide.object_type || 'building_single',
      outputDir: sessionOutputDir,
      sourceRequestFile: guide.source_request?.path || null,
      writeRealWorldBuildingReleaseDraft: true,
      requirePreflightReleaseSourceCandidate,
      requireSourceInputReady: requireInputReady,
      generatedAt
    });
    steps.push(step('run_refill_upload_session', uploadSession.ok ? 'pass' : 'blocked', uploadSession.workflow?.stage || 'upload_session_finished', {
      upload_session_summary: uploadSession.artifacts?.upload_session_summary || null
    }));
  } else {
    steps.push(step('run_refill_upload_session', 'skipped', validation.report.can_run_upload_session ? 'ready_but_not_requested' : 'blocked_until_upload_ready', {
      command: guide.commands?.require_input_ready || null
    }));
  }

  const status = workflowStatus({ manifestBuild, validation, uploadSession, runUploadSession });
  const report = {
    version: 1,
    kind: 'real_world_building_source_refill_workflow_report',
    generated_at: generatedAt,
    package_dir: packageDir,
    status,
    ok: ['ready_for_upload_session', 'upload_session_completed'].includes(status),
    guide: guidePath,
    upload_package_dir: uploadPackageDir,
    manifest: manifestPath,
    artifacts: {
      manifest_build_report: manifestBuild?.reportOutput || path.join(packageDir, 'source-refill-manifest-build-report.json'),
      manifest_build_markdown: manifestBuild?.markdownOutput || path.join(packageDir, 'source-refill-manifest-build-report.md'),
      refill_package_validation: validation.output,
      refill_package_validation_markdown: validation.markdownOutput,
      upload_session_summary: uploadSession?.artifacts?.upload_session_summary || null,
      upload_session_handoff: uploadSession?.artifacts?.upload_session_handoff || null
    },
    steps,
    commands: {
      build_manifest_from_sources: guide.commands?.build_manifest_from_sources || null,
      validate_refill_package_require_upload_ready: guide.commands?.require_upload_ready || null,
      run_refill_upload_session_require_input_ready: guide.commands?.require_input_ready || null
    },
    next_actions: nextActionsForWorkflow({ status, manifestBuild, validation, guide })
  };

  await writeJson(resolveRepo(workflowReport), report);
  await fs.mkdir(path.dirname(resolveRepo(workflowMarkdown)), { recursive: true });
  await fs.writeFile(resolveRepo(workflowMarkdown), renderWorkflowMarkdown(report), 'utf8');
  return {
    ok: report.ok,
    status,
    report,
    output: workflowReport,
    markdownOutput: workflowMarkdown,
    uploadSession
  };
}

function workflowStatus({ manifestBuild, validation, uploadSession, runUploadSession }) {
  if (manifestBuild && !manifestBuild.ok) return 'manifest_draft_needs_sources';
  if (!validation.ok || !validation.report.can_run_upload_session) return 'refill_package_invalid';
  if (!runUploadSession) return 'ready_for_upload_session';
  return uploadSession?.ok ? 'upload_session_completed' : 'upload_session_blocked';
}

function nextActionsForWorkflow({ status, manifestBuild, validation, guide }) {
  if (status === 'manifest_draft_needs_sources') {
    return manifestBuild?.report?.next_actions || ['Add or rename missing source files, then rerun the source-refill workflow.'];
  }
  if (status === 'refill_package_invalid') {
    return validation.report.next_actions || ['Fix source-refill package validation failures, then rerun the source-refill workflow.'];
  }
  if (status === 'ready_for_upload_session') {
    return [
      'Run this workflow with --run-upload-session to start the refill upload-session.',
      guide.commands?.require_input_ready || 'Run the refill upload-session command from the source-refill guide.'
    ].filter(Boolean);
  }
  if (status === 'upload_session_completed') return ['Continue with release artifact workspace preparation from the upload-session summary.'];
  return ['Inspect the upload-session summary and source request response before retrying.'];
}

function step(id, status, message, evidence = {}) {
  return { id, status, message, evidence };
}

function renderWorkflowMarkdown(report) {
  const lines = [
    '# Real-World Building Source Refill Workflow',
    '',
    `- Status: \`${report.status}\``,
    `- OK: \`${String(report.ok)}\``,
    `- Package dir: \`${report.package_dir}\``,
    `- Upload package dir: \`${report.upload_package_dir}\``,
    '',
    '| Step | Status | Message |',
    '| --- | --- | --- |'
  ];
  for (const item of report.steps) lines.push(`| ${item.id} | ${item.status} | ${String(item.message).replaceAll('|', '\\|')} |`);
  lines.push('', '## Next Actions', '');
  for (const action of report.next_actions) lines.push(`- ${action}`);
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-dir') options.packageDir = nextValue(argv, ++index, arg);
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--markdown-output') options.markdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--skip-manifest-build') options.buildManifest = false;
    else if (arg === '--rebuild-manifest') options.rebuildManifest = true;
    else if (arg === '--run-upload-session') options.runUploadSession = true;
    else if (arg === '--upload-session-output-dir') options.uploadSessionOutputDir = nextValue(argv, ++index, arg);
    else if (arg === '--require-input-ready') options.requireInputReady = true;
    else if (arg === '--require-preflight-release-source-candidate') options.requirePreflightReleaseSourceCandidate = true;
    else if (arg === '--units') options.units = nextValue(argv, ++index, arg);
    else if (arg === '--known-width') options.knownWidth = nextValue(argv, ++index, arg);
    else if (arg === '--known-depth') options.knownDepth = nextValue(argv, ++index, arg);
    else if (arg === '--known-height') options.knownHeight = nextValue(argv, ++index, arg);
    else if (arg === '--scale-basis') options.scaleBasis = nextValue(argv, ++index, arg);
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
  node projects/image-structured-modeler/scripts/run-real-world-building-source-refill-workflow.mjs \\
    --package-dir output/.../source-refill-package [--run-upload-session]

Options:
  --package-dir <path>                         Source-refill package directory.
  --output <path>                              Workflow JSON report output.
  --markdown-output <path>                     Workflow Markdown report output.
  --skip-manifest-build                        Do not build manifest.json from sources.
  --rebuild-manifest                           Rebuild manifest.json even when it exists.
  --run-upload-session                         Run refill upload-session after upload-ready validation passes.
  --upload-session-output-dir <path>           Output directory for refill upload-session.
  --require-input-ready                        Pass hard source input-ready gate to upload-session.
  --require-preflight-release-source-candidate Pass hard preflight release-source gate to upload-session.
  --known-width/depth/height <number>          Optional known dimensions for manifest builder.
  --units <unit>                               Dimension unit for known dimensions.
  --scale-basis <text>                         Evidence note for known dimensions.
  --generated-at <iso>                         Stable timestamp for tests.
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  runRealWorldBuildingSourceRefillWorkflowCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.status,
        output: result.output,
        markdown: result.markdownOutput
      }, null, 2)}\n`);
      if (!result.ok) process.exit(1);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
