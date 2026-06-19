#!/usr/bin/env node
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';

const DEFAULT_OUTPUT = 'output/image-structured-modeler/real-world-building-source-refill-package-validation/source-refill-package-validation.json';
const REAL_MANIFEST_NAMES = ['manifest.json', 'upload-manifest.json'];
const HELPER_ARTIFACT_NAMES = new Set([
  'README.md',
  'source-refill-package-guide.json',
  'source-refill-package-guide.md',
  'source-slots.md',
  'upload-manifest.template.json'
]);

export async function validateRealWorldBuildingSourceRefillPackageCli({
  packageDir,
  guidePath = null,
  sourceRequestPath = null,
  output = null,
  markdownOutput = null,
  writeMarkdown = true,
  requireUploadReady = false,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!packageDir) throw new Error('--package-dir is required.');
  const resolvedPackageDir = resolveRepo(packageDir);
  const guideFile = guidePath || path.join(packageDir, 'source-refill-package-guide.json');
  const guideRead = await readOptionalJson(resolveRepo(guideFile));
  const guide = guideRead.value;
  const effectiveSourceRequestPath = sourceRequestPath || guide?.source_request?.path || null;
  const sourceRequestRead = effectiveSourceRequestPath ? await readOptionalJson(resolveRepo(effectiveSourceRequestPath)) : { exists: false, value: null, error: null };
  const uploadPackageDir = guide?.output_package?.upload_package_directory || path.join(packageDir, 'upload-package');
  const manifestTemplatePath = guide?.output_package?.manifest_template || path.join(packageDir, 'upload-manifest.template.json');
  const uploadPackageExists = await pathExists(resolveRepo(uploadPackageDir));
  const manifestTemplateRead = await readOptionalJson(resolveRepo(manifestTemplatePath));
  const helperArtifacts = uploadPackageExists
    ? await helperArtifactsInsideUploadPackage(resolveRepo(uploadPackageDir))
    : [];
  const manifestCandidates = uploadPackageExists
    ? await manifestCandidatesForUploadPackage(resolveRepo(uploadPackageDir))
    : [];
  const selectedManifest = manifestCandidates.find((candidate) => candidate.exists) || manifestCandidates[0] || null;
  const manifestRead = selectedManifest?.exists ? await readOptionalJson(selectedManifest.absolute_path) : { exists: false, value: null, error: null };
  const manifest = manifestRead.value;
  const expectedObjectType = guide?.object_type || guide?.upload_manifest_template?.object_type || null;
  const manifestAnalysis = manifest
    ? await analyzeManifest({ manifest, uploadPackageDir, guide })
    : emptyManifestAnalysis(guide);

  const checks = buildChecks({
    guideFile,
    guideRead,
    guide,
    sourceRequestPath: effectiveSourceRequestPath,
    sourceRequestRead,
    uploadPackageDir,
    uploadPackageExists,
    manifestTemplatePath,
    manifestTemplateRead,
    selectedManifest,
    manifestRead,
    manifest,
    manifestAnalysis,
    helperArtifacts,
    expectedObjectType,
    requireUploadReady
  });
  const failedRequiredChecks = checks
    .filter((check) => check.required && check.status === 'fail')
    .map((check) => check.id);
  const canRunUploadSession = failedRequiredChecks.length === 0 && manifestAnalysis.real_manifest_ready === true;
  const status = statusForValidation({
    guideRead,
    failedRequiredChecks,
    manifest,
    manifestAnalysis,
    requireUploadReady
  });
  const report = {
    version: 1,
    kind: 'real_world_building_source_refill_package_validation',
    generated_at: generatedAt,
    package_dir: packageDir,
    upload_package_dir: uploadPackageDir,
    ok: failedRequiredChecks.length === 0,
    status,
    require_upload_ready: requireUploadReady,
    can_run_upload_session: canRunUploadSession,
    source_request: {
      path: effectiveSourceRequestPath,
      exists: sourceRequestRead.exists,
      status: sourceRequestRead.value?.status || null
    },
    guide: {
      path: guideFile,
      exists: guideRead.exists,
      valid_kind: guide?.kind === 'real_world_building_source_refill_package_guide'
    },
    manifest: {
      path: selectedManifest?.repo_path || null,
      exists: manifestRead.exists,
      parse_error: manifestRead.error,
      kind: manifest?.kind || null,
      object_type: manifest?.object_type || null,
      expected_object_type: expectedObjectType,
      template_only: manifest?.template_only === true,
      view_count: Array.isArray(manifest?.views) ? manifest.views.length : 0,
      required_views: manifestAnalysis.required_views,
      present_required_views: manifestAnalysis.present_required_views,
      missing_required_views: manifestAnalysis.missing_required_views,
      referenced_sources: manifestAnalysis.referenced_sources,
      missing_source_references: manifestAnalysis.missing_source_references,
      outside_upload_package_references: manifestAnalysis.outside_upload_package_references,
      duplicate_source_paths: manifestAnalysis.duplicate_source_paths,
      duplicate_source_content_groups: manifestAnalysis.duplicate_source_content_groups,
      helper_artifacts_inside_upload_package: helperArtifacts
    },
    summary: {
      checks: checks.length,
      passed_checks: checks.filter((check) => check.status === 'pass').length,
      failed_required_checks: failedRequiredChecks,
      review_checks: checks.filter((check) => check.status === 'review').map((check) => check.id)
    },
    checks,
    commands: commandsForValidation({ guide, packageDir, output }),
    next_actions: nextActionsForValidation({ status, guide, selectedManifest })
  };
  const outputPath = output || DEFAULT_OUTPUT;
  const markdownPath = markdownOutput || outputPath.replace(/\.json$/u, '.md');
  await writeJson(resolveRepo(outputPath), report);
  if (writeMarkdown) {
    await fs.mkdir(path.dirname(resolveRepo(markdownPath)), { recursive: true });
    await fs.writeFile(resolveRepo(markdownPath), renderSourceRefillPackageValidationMarkdown(report), 'utf8');
  }
  return {
    ok: report.ok,
    status: report.status,
    report,
    output: outputPath,
    markdownOutput: writeMarkdown ? markdownPath : null
  };
}

function buildChecks({
  guideFile,
  guideRead,
  guide,
  sourceRequestPath,
  sourceRequestRead,
  uploadPackageDir,
  uploadPackageExists,
  manifestTemplatePath,
  manifestTemplateRead,
  selectedManifest,
  manifestRead,
  manifest,
  manifestAnalysis,
  helperArtifacts,
  expectedObjectType,
  requireUploadReady
}) {
  const manifestPresentRequired = requireUploadReady;
  const manifestProvided = manifestRead.exists;
  return [
    {
      id: 'package_guide_present',
      label: 'Source refill package guide present',
      required: true,
      status: guideRead.exists && guide?.kind === 'real_world_building_source_refill_package_guide' ? 'pass' : 'fail',
      message: 'The package guide must exist and use the stable source-refill guide kind.',
      evidence: { path: guideFile, exists: guideRead.exists, parse_error: guideRead.error, kind: guide?.kind || null }
    },
    {
      id: 'source_request_present',
      label: 'Source request present',
      required: true,
      status: sourceRequestRead.exists && sourceRequestRead.value?.kind === 'real_world_building_source_request' ? 'pass' : 'fail',
      message: 'The package must stay tied to the source request it is trying to satisfy.',
      evidence: { path: sourceRequestPath, exists: sourceRequestRead.exists, parse_error: sourceRequestRead.error, kind: sourceRequestRead.value?.kind || null }
    },
    {
      id: 'upload_package_directory_present',
      label: 'Upload package directory present',
      required: true,
      status: uploadPackageExists ? 'pass' : 'fail',
      message: 'The real upload package must live in a dedicated upload-package directory.',
      evidence: { path: uploadPackageDir, exists: uploadPackageExists }
    },
    {
      id: 'helper_artifacts_separated',
      label: 'Guide helper artifacts separated',
      required: true,
      status: helperArtifacts.length === 0 ? 'pass' : 'fail',
      message: 'README, guide JSON, and template artifacts must not be inside the upload-package directory.',
      evidence: { helper_artifacts_inside_upload_package: helperArtifacts }
    },
    {
      id: 'manifest_template_present',
      label: 'Manifest template present',
      required: true,
      status: manifestTemplateRead.exists && manifestTemplateRead.value?.kind === 'real_world_building_upload_manifest' && manifestTemplateRead.value?.template_only === true ? 'pass' : 'fail',
      message: 'The guide package must keep a template-only upload manifest outside the real upload package.',
      evidence: { path: manifestTemplatePath, exists: manifestTemplateRead.exists, parse_error: manifestTemplateRead.error, template_only: manifestTemplateRead.value?.template_only ?? null }
    },
    {
      id: 'real_manifest_present',
      label: 'Real manifest present',
      required: manifestPresentRequired,
      status: manifestRead.exists ? 'pass' : manifestPresentRequired ? 'fail' : 'review',
      message: manifestRead.exists ? 'A real manifest file is present in the upload-package directory.' : 'Copy the template to manifest.json after replacing every placeholder with real source files.',
      evidence: { path: selectedManifest?.repo_path || null, exists: manifestRead.exists, parse_error: manifestRead.error }
    },
    {
      id: 'real_manifest_valid_json',
      label: 'Real manifest JSON valid',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifestRead.error ? 'fail' : 'pass',
      message: 'A submitted real manifest must parse as JSON before it can be sent to upload-session.',
      evidence: { path: selectedManifest?.repo_path || null, parse_error: manifestRead.error }
    },
    {
      id: 'real_manifest_not_template',
      label: 'Real manifest is not template-only',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifest?.template_only === true ? 'fail' : 'pass',
      message: 'A submitted manifest must remove template_only or set it to false.',
      evidence: { template_only: manifest?.template_only ?? null }
    },
    {
      id: 'real_manifest_kind_valid',
      label: 'Real manifest kind valid',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifest?.kind === 'real_world_building_upload_manifest' ? 'pass' : 'fail',
      message: 'A submitted manifest must use kind=real_world_building_upload_manifest.',
      evidence: { kind: manifest?.kind || null }
    },
    {
      id: 'real_manifest_object_type_matches',
      label: 'Real manifest object type matches guide',
      required: manifestProvided && Boolean(expectedObjectType),
      status: !manifestProvided ? 'review' : !expectedObjectType ? 'review' : manifest?.object_type === expectedObjectType ? 'pass' : 'fail',
      message: 'A submitted manifest must keep the same object_type as the source-refill guide.',
      evidence: { object_type: manifest?.object_type || null, expected_object_type: expectedObjectType }
    },
    {
      id: 'required_views_covered',
      label: 'Required views covered',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifestAnalysis.missing_required_views.length === 0 ? 'pass' : 'fail',
      message: 'The real manifest must cover every required building view from the source request.',
      evidence: {
        required_views: manifestAnalysis.required_views,
        present_required_views: manifestAnalysis.present_required_views,
        missing_required_views: manifestAnalysis.missing_required_views
      }
    },
    {
      id: 'source_references_exist',
      label: 'Source references exist',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifestAnalysis.missing_source_references.length === 0 ? 'pass' : 'fail',
      message: 'Every manifest views[].source_image path must exist inside the upload-package directory.',
      evidence: { missing_source_references: manifestAnalysis.missing_source_references }
    },
    {
      id: 'source_references_inside_upload_package',
      label: 'Source references stay inside upload package',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifestAnalysis.outside_upload_package_references.length === 0 ? 'pass' : 'fail',
      message: 'Manifest source_image references must be relative paths inside the upload-package directory.',
      evidence: { outside_upload_package_references: manifestAnalysis.outside_upload_package_references }
    },
    {
      id: 'source_paths_distinct',
      label: 'Required view source paths distinct',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifestAnalysis.duplicate_source_paths.length === 0 ? 'pass' : 'fail',
      message: 'Required views must not point at the same source_image path.',
      evidence: { duplicate_source_paths: manifestAnalysis.duplicate_source_paths }
    },
    {
      id: 'source_content_distinct',
      label: 'Required view source content distinct',
      required: manifestProvided,
      status: !manifestProvided ? 'review' : manifestAnalysis.duplicate_source_content_groups.length === 0 ? 'pass' : 'fail',
      message: 'Required view source files must not be duplicate file content.',
      evidence: { duplicate_source_content_groups: manifestAnalysis.duplicate_source_content_groups }
    }
  ];
}

async function analyzeManifest({ manifest, uploadPackageDir, guide }) {
  const requiredViews = guide?.required_views || guide?.source_slots?.filter((slot) => slot.required !== false).map((slot) => slot.view) || [];
  const requiredViewSet = new Set(requiredViews);
  const viewRecords = Array.isArray(manifest.views) ? manifest.views : [];
  const requiredRecords = viewRecords.filter((view) => requiredViewSet.has(view.kind || view.view));
  const presentRequiredViews = Array.from(new Set(requiredRecords.map((view) => view.kind || view.view))).sort();
  const missingRequiredViews = requiredViews.filter((view) => !presentRequiredViews.includes(view));
  const referencedSources = [];
  const missingSourceReferences = [];
  const outsideUploadPackageReferences = [];
  const absoluteUploadPackageDir = resolveRepo(uploadPackageDir);
  for (const view of requiredRecords) {
    const sourceImage = view.source_image || view.source || view.path || view.file || '';
    const absoluteSource = resolveRepo(path.join(uploadPackageDir, sourceImage));
    const insideUploadPackage = sourceImage.length > 0 && isInsideDirectory(absoluteSource, absoluteUploadPackageDir);
    const exists = insideUploadPackage && await pathExists(absoluteSource);
    const record = {
      view: view.kind || view.view,
      source_image: sourceImage,
      path: toRepoRelative(absoluteSource),
      exists,
      inside_upload_package: insideUploadPackage
    };
    if (exists) record.content_sha256 = await contentHash(absoluteSource);
    referencedSources.push(record);
    if (!insideUploadPackage) outsideUploadPackageReferences.push(record);
    if (!exists) missingSourceReferences.push(record);
  }
  const duplicateSourcePaths = duplicateGroups({
    records: referencedSources.filter((record) => record.source_image),
    keyForRecord: (record) => normalizeSlash(record.source_image),
    valueKey: 'source_image'
  });
  const duplicateSourceContentGroups = duplicateGroups({
    records: referencedSources.filter((record) => record.content_sha256),
    keyForRecord: (record) => record.content_sha256,
    valueKey: 'content_sha256'
  });
  const expectedObjectType = guide?.object_type || guide?.upload_manifest_template?.object_type || null;
  return {
    real_manifest_ready: manifest.template_only !== true
      && manifest.kind === 'real_world_building_upload_manifest'
      && (!expectedObjectType || manifest.object_type === expectedObjectType)
      && missingRequiredViews.length === 0
      && missingSourceReferences.length === 0
      && outsideUploadPackageReferences.length === 0
      && duplicateSourcePaths.length === 0
      && duplicateSourceContentGroups.length === 0,
    required_views: requiredViews,
    present_required_views: presentRequiredViews,
    missing_required_views: missingRequiredViews,
    referenced_sources: referencedSources,
    missing_source_references: missingSourceReferences,
    outside_upload_package_references: outsideUploadPackageReferences,
    duplicate_source_paths: duplicateSourcePaths,
    duplicate_source_content_groups: duplicateSourceContentGroups
  };
}

function emptyManifestAnalysis(guide) {
  const requiredViews = guide?.required_views || [];
  return {
    real_manifest_ready: false,
    required_views: requiredViews,
    present_required_views: [],
    missing_required_views: requiredViews,
    referenced_sources: [],
    missing_source_references: [],
    outside_upload_package_references: [],
    duplicate_source_paths: [],
    duplicate_source_content_groups: []
  };
}

function duplicateGroups({ records, keyForRecord, valueKey }) {
  const byKey = new Map();
  for (const record of records) {
    const key = keyForRecord(record);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(record);
  }
  return Array.from(byKey.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      [valueKey]: key,
      views: group.map((record) => record.view).sort(),
      source_images: Array.from(new Set(group.map((record) => record.source_image))).sort()
    }));
}

function statusForValidation({ guideRead, failedRequiredChecks, manifest, manifestAnalysis, requireUploadReady }) {
  if (!guideRead.exists) return 'missing_package_guide';
  if (failedRequiredChecks.length > 0) {
    if (!manifest && !requireUploadReady && failedRequiredChecks.every((id) => !['package_guide_present', 'source_request_present', 'upload_package_directory_present', 'manifest_template_present', 'helper_artifacts_separated'].includes(id))) {
      return 'template_package_pending';
    }
    return 'invalid_refill_package';
  }
  if (manifestAnalysis.real_manifest_ready) return 'ready_for_upload_session';
  return 'template_package_pending';
}

function commandsForValidation({ guide, packageDir, output }) {
  const validatePackage = `npm run image-structured:validate-real-world-building-source-refill-package -- --package-dir ${shellArg(packageDir)}${output ? ` --output ${shellArg(output)}` : ''}`;
  return {
    build_manifest_from_sources: guide?.commands?.build_manifest_from_sources || null,
    run_source_refill_workflow: guide?.commands?.run_source_refill_workflow || null,
    validate_package: validatePackage,
    require_upload_ready: `${validatePackage} --require-upload-ready`,
    validate_upload_session: guide?.commands?.validate_upload_session || null,
    require_input_ready: guide?.commands?.require_input_ready || null
  };
}

function nextActionsForValidation({ status, guide, selectedManifest }) {
  if (status === 'ready_for_upload_session') return [
    'Run commands.require_input_ready to validate the real upload package against the source request.'
  ];
  if (status === 'template_package_pending') return [
    'Place real source files under output_package.sources_directory.',
    `Copy ${guide?.output_package?.manifest_template || 'upload-manifest.template.json'} to ${guide?.output_package?.upload_package_directory || 'upload-package'}/manifest.json.`,
    'Remove template_only or set it to false in the real manifest.',
    'Point each required view at a distinct real source file, then rerun this validation.'
  ];
  if (!selectedManifest?.exists) return [
    'Regenerate the source refill package guide from a valid source request.'
  ];
  return [
    'Fix the failed validation checks, then rerun source-refill package validation.'
  ];
}

export function renderSourceRefillPackageValidationMarkdown(report) {
  const lines = [
    '# Real-World Building Source Refill Package Validation',
    '',
    `- Status: \`${report.status}\``,
    `- OK: \`${String(report.ok)}\``,
    `- Can run upload session: \`${String(report.can_run_upload_session)}\``,
    `- Package dir: \`${report.package_dir}\``,
    `- Upload package dir: \`${report.upload_package_dir}\``,
    '',
    '| Check | Required | Status | Message |',
    '| --- | --- | --- | --- |'
  ];
  for (const check of report.checks) {
    lines.push(`| ${escapeMarkdownTable(check.label)} | ${check.required ? 'yes' : 'no'} | ${check.status} | ${escapeMarkdownTable(check.message)} |`);
  }
  lines.push('', '## Manifest', '');
  lines.push(`- Path: \`${report.manifest.path || 'none'}\``);
  lines.push(`- Exists: \`${String(report.manifest.exists)}\``);
  lines.push(`- Template only: \`${String(report.manifest.template_only)}\``);
  lines.push(`- Required views: \`${report.manifest.required_views.join('`, `') || 'none'}\``);
  lines.push(`- Missing required views: \`${report.manifest.missing_required_views.join('`, `') || 'none'}\``);
  lines.push('', '## Commands', '');
  if (report.commands.build_manifest_from_sources) lines.push(`- Build manifest from sources: \`${report.commands.build_manifest_from_sources}\``);
  if (report.commands.run_source_refill_workflow) lines.push(`- Run source refill workflow: \`${report.commands.run_source_refill_workflow}\``);
  lines.push(`- Validate package: \`${report.commands.validate_package}\``);
  lines.push(`- Require upload ready: \`${report.commands.require_upload_ready}\``);
  if (report.commands.require_input_ready) lines.push(`- Require input ready: \`${report.commands.require_input_ready}\``);
  lines.push('', '## Next Actions', '');
  for (const action of report.next_actions) lines.push(`- ${action}`);
  return `${lines.join('\n')}\n`;
}

async function manifestCandidatesForUploadPackage(absoluteUploadPackageDir) {
  return Promise.all(REAL_MANIFEST_NAMES.map(async (name) => {
    const absolutePath = path.join(absoluteUploadPackageDir, name);
    return {
      name,
      absolute_path: absolutePath,
      repo_path: toRepoRelative(absolutePath),
      exists: await pathExists(absolutePath)
    };
  }));
}

async function helperArtifactsInsideUploadPackage(absoluteUploadPackageDir) {
  const files = await listFiles(absoluteUploadPackageDir);
  return files
    .filter((filePath) => HELPER_ARTIFACT_NAMES.has(path.basename(filePath)))
    .map((filePath) => toRepoRelative(filePath));
}

async function listFiles(absoluteInput) {
  if (!await pathExists(absoluteInput)) return [];
  const stat = await fs.stat(absoluteInput);
  if (stat.isFile()) return [absoluteInput];
  const entries = await fs.readdir(absoluteInput, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(absoluteInput, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function readOptionalJson(filePath) {
  try {
    return {
      exists: true,
      value: JSON.parse(await fs.readFile(filePath, 'utf8')),
      error: null
    };
  } catch (error) {
    return {
      exists: await pathExists(filePath),
      value: null,
      error: error.message
    };
  }
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

async function contentHash(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.readFile(filePath));
  return hash.digest('hex');
}

function parseArgs(argv) {
  const options = {
    writeMarkdown: true,
    requireUploadReady: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-dir') options.packageDir = nextValue(argv, ++index, arg);
    else if (arg === '--guide') options.guidePath = nextValue(argv, ++index, arg);
    else if (arg === '--source-request') options.sourceRequestPath = nextValue(argv, ++index, arg);
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--markdown-output') options.markdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--no-markdown') options.writeMarkdown = false;
    else if (arg === '--require-upload-ready') options.requireUploadReady = true;
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
  node projects/image-structured-modeler/scripts/validate-real-world-building-source-refill-package.mjs \\
    --package-dir output/image-structured-modeler/real-world-building-source-refill-package

Options:
  --package-dir <path>          Source refill guide package directory.
  --guide <path>                Optional explicit source-refill-package-guide.json path.
  --source-request <path>       Optional explicit source request JSON path.
  --output <path>               JSON validation output path.
  --markdown-output <path>      Markdown validation output path.
  --no-markdown                 Skip Markdown output.
  --require-upload-ready        Exit non-zero unless a real manifest and distinct sources are ready.
  --generated-at <iso>          Stable timestamp for tests.
`);
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function normalizeSlash(value) {
  return String(value).split(path.sep).join('/');
}

function isInsideDirectory(filePath, directoryPath) {
  const relative = path.relative(directoryPath, filePath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  validateRealWorldBuildingSourceRefillPackageCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.status,
        can_run_upload_session: result.report.can_run_upload_session,
        failed_required_checks: result.report.summary.failed_required_checks,
        output: result.output,
        markdown: result.markdownOutput
      }, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
