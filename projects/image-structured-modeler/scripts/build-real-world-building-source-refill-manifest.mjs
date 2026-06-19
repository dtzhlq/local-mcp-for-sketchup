#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  '.pdf',
  '.dxf',
  '.dwg',
  '.ifc'
]);

const VIEW_KEYWORDS = {
  front: ['front', 'facade', 'elevation-front', 'front-elevation'],
  rear: ['rear', 'back', 'rear-elevation'],
  left: ['left', 'side-left', 'left-side', 'side-elevation', 'left-elevation'],
  right: ['right', 'side-right', 'right-side', 'right-elevation'],
  oblique: ['oblique', 'perspective', 'angle', 'angled', 'iso', 'isometric', 'three-quarter'],
  top: ['top', 'plan', 'roof', 'site-plan', 'floor-plan', 'outline']
};

export async function buildRealWorldBuildingSourceRefillManifestCli({
  packageDir,
  guidePath = null,
  output = null,
  reportOutput = null,
  markdownOutput = null,
  force = false,
  requireComplete = false,
  units = null,
  knownWidth = null,
  knownDepth = null,
  knownHeight = null,
  scaleBasis = null,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!packageDir) throw new Error('--package-dir is required.');
  const guideFile = guidePath || path.join(packageDir, 'source-refill-package-guide.json');
  const guide = await readJson(resolveRepo(guideFile));
  if (guide.kind !== 'real_world_building_source_refill_package_guide') {
    throw new Error(`Expected source refill package guide, got ${guide.kind || 'unknown kind'}.`);
  }

  const uploadPackageDir = guide.output_package?.upload_package_directory || path.join(packageDir, 'upload-package');
  const sourcesDir = guide.output_package?.sources_directory || path.join(uploadPackageDir, 'sources');
  const manifestOutput = output || path.join(uploadPackageDir, 'manifest.json');
  const reportPath = reportOutput || path.join(packageDir, 'source-refill-manifest-build-report.json');
  const markdownPath = markdownOutput || reportPath.replace(/\.json$/u, '.md');
  if (!force && await pathExists(resolveRepo(manifestOutput))) {
    throw new Error(`Refusing to overwrite existing manifest: ${manifestOutput}. Pass --force to replace it.`);
  }

  const files = await sourceFiles(resolveRepo(sourcesDir), sourcesDir);
  const slots = (guide.source_slots || []).filter((slot) => slot.required !== false);
  const assignments = assignSourcesToSlots({ files, slots });
  const missingViews = assignments.filter((assignment) => !assignment.source_image).map((assignment) => assignment.view);
  const duplicateSourceImages = duplicateValues(assignments.map((assignment) => assignment.source_image).filter(Boolean));
  const template = guide.upload_manifest_template || {};
  const dimensions = dimensionsFromOptions({ units, knownWidth, knownDepth, knownHeight, scaleBasis });
  const manifest = {
    ...template,
    kind: 'real_world_building_upload_manifest',
    template_only: false,
    generated_at: generatedAt,
    object_type: guide.object_type || template.object_type || 'building_single',
    source_request_status: guide.source_request?.status || template.source_request_status || null,
    views: assignments.map((assignment) => ({
      source_image: assignment.source_image || assignment.suggested_source_image,
      kind: assignment.view,
      confidence: assignment.source_image ? assignment.confidence : 0,
      note: assignment.source_image
        ? `Matched ${assignment.source_image} from upload-package sources.`
        : `Missing source file. Rename or add a real source matching ${assignment.view}, then rerun this command.`
    }))
  };
  if (dimensions) manifest.dimensions = dimensions;

  const status = missingViews.length === 0 && duplicateSourceImages.length === 0
    ? 'manifest_ready_for_package_validation'
    : 'manifest_draft_needs_sources';
  const report = {
    version: 1,
    kind: 'real_world_building_source_refill_manifest_build_report',
    generated_at: generatedAt,
    package_dir: packageDir,
    guide: guideFile,
    upload_package_dir: uploadPackageDir,
    sources_dir: sourcesDir,
    manifest_output: manifestOutput,
    ok: status === 'manifest_ready_for_package_validation',
    status,
    object_type: manifest.object_type,
    source_files: files,
    assignments,
    missing_required_views: missingViews,
    duplicate_source_images: duplicateSourceImages,
    commands: {
      validate_refill_package: guide.commands?.validate_refill_package || null,
      require_upload_ready: guide.commands?.require_upload_ready || null,
      require_input_ready: guide.commands?.require_input_ready || null
    },
    next_actions: nextActionsForReport({ status, sourcesDir, missingViews })
  };

  await writeJson(resolveRepo(manifestOutput), manifest);
  await writeJson(resolveRepo(reportPath), report);
  await fs.mkdir(path.dirname(resolveRepo(markdownPath)), { recursive: true });
  await fs.writeFile(resolveRepo(markdownPath), renderManifestBuildMarkdown(report), 'utf8');

  if (requireComplete && !report.ok) {
    const error = new Error(`Source refill manifest is incomplete: missing ${missingViews.join(', ') || 'unknown views'}.`);
    error.report = report;
    throw error;
  }
  return {
    ok: report.ok,
    status,
    manifest,
    report,
    manifestOutput,
    reportOutput: reportPath,
    markdownOutput: markdownPath
  };
}

function assignSourcesToSlots({ files, slots }) {
  const used = new Set();
  return slots.map((slot) => {
    const match = bestFileForView({ view: slot.view, files, used });
    if (match) used.add(match.path);
    return {
      view: slot.view,
      required: slot.required !== false,
      suggested_source_image: slot.suggested_source_image,
      source_image: match?.path || null,
      matched_file: match?.absolute_path || null,
      confidence: match ? match.confidence : 0,
      match_reason: match?.reason || 'missing'
    };
  });
}

function bestFileForView({ view, files, used }) {
  const candidates = files
    .filter((file) => !used.has(file.path))
    .map((file) => scoreFileForView({ file, view }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  const winner = candidates[0];
  if (!winner) return null;
  return {
    ...winner.file,
    confidence: winner.score >= 100 ? 0.95 : 0.74,
    reason: winner.reason
  };
}

function scoreFileForView({ file, view }) {
  const normalized = normalizeName(file.path);
  const basename = normalizeName(path.basename(file.path));
  const keywords = VIEW_KEYWORDS[view] || [view];
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeName(keyword);
    if (basename.includes(normalizedKeyword)) {
      return { file, score: normalizedKeyword === view ? 100 : 80, reason: `filename_keyword:${keyword}` };
    }
  }
  if (normalized.includes(`/${view}-`) || normalized.includes(`/${view}_`)) {
    return { file, score: 70, reason: `path_keyword:${view}` };
  }
  return { file, score: 0, reason: 'none' };
}

async function sourceFiles(absoluteSourcesDir, repoSourcesDir) {
  const files = await listFiles(absoluteSourcesDir);
  return files
    .filter((filePath) => SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => ({
      path: normalizeSlash(path.relative(resolveRepo(path.dirname(repoSourcesDir)), filePath)),
      absolute_path: toRepoRelative(filePath),
      extension: path.extname(filePath).toLowerCase()
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function listFiles(absoluteInput) {
  if (!await pathExists(absoluteInput)) return [];
  const stat = await fs.stat(absoluteInput);
  if (stat.isFile()) return [absoluteInput];
  const entries = await fs.readdir(absoluteInput, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(absoluteInput, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function dimensionsFromOptions({ units, knownWidth, knownDepth, knownHeight, scaleBasis }) {
  const values = {
    width: numberOrNull(knownWidth),
    depth: numberOrNull(knownDepth),
    height: numberOrNull(knownHeight)
  };
  if (Object.values(values).every((value) => value === null)) return null;
  return {
    units: units || 'mm',
    ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null)),
    confidence: 0.72,
    basis: [scaleBasis || 'source refill manifest builder user-provided known dimensions']
  };
}

function nextActionsForReport({ status, sourcesDir, missingViews }) {
  if (status === 'manifest_ready_for_package_validation') return [
    'Run commands.require_upload_ready before starting the refill upload-session.'
  ];
  return [
    `Add or rename real source files under ${sourcesDir} for missing views: ${missingViews.join(', ') || 'none'}.`,
    'Use view keywords such as front, left, oblique, top, plan, roof, perspective, or elevation in source file names.',
    'Rerun this manifest builder, then run commands.require_upload_ready.'
  ];
}

function renderManifestBuildMarkdown(report) {
  const lines = [
    '# Real-World Building Source Refill Manifest Build',
    '',
    `- Status: \`${report.status}\``,
    `- OK: \`${String(report.ok)}\``,
    `- Manifest output: \`${report.manifest_output}\``,
    `- Sources dir: \`${report.sources_dir}\``,
    '',
    '| View | Source Image | Confidence | Match |',
    '| --- | --- | --- | --- |'
  ];
  for (const assignment of report.assignments) {
    lines.push(`| ${assignment.view} | \`${assignment.source_image || assignment.suggested_source_image || 'missing'}\` | ${assignment.confidence} | ${assignment.match_reason} |`);
  }
  lines.push('', '## Next Actions', '');
  for (const action of report.next_actions) lines.push(`- ${action}`);
  return `${lines.join('\n')}\n`;
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-dir') options.packageDir = nextValue(argv, ++index, arg);
    else if (arg === '--guide') options.guidePath = nextValue(argv, ++index, arg);
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--report-output') options.reportOutput = nextValue(argv, ++index, arg);
    else if (arg === '--markdown-output') options.markdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--force') options.force = true;
    else if (arg === '--require-complete') options.requireComplete = true;
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
  node projects/image-structured-modeler/scripts/build-real-world-building-source-refill-manifest.mjs \\
    --package-dir output/.../source-refill-package [--force]

Options:
  --package-dir <path>       Source-refill package directory.
  --guide <path>             Optional explicit source-refill-package-guide.json.
  --output <path>            Manifest output. Defaults to upload-package/manifest.json.
  --report-output <path>     JSON report output.
  --markdown-output <path>   Markdown report output.
  --force                    Replace an existing manifest output.
  --require-complete         Exit non-zero when required views cannot be matched.
  --known-width <number>     Optional known building width.
  --known-depth <number>     Optional known building depth.
  --known-height <number>    Optional known building height.
  --units <unit>             Dimension unit, defaults to mm when dimensions are provided.
  --scale-basis <text>       Evidence note for known dimensions.
  --generated-at <iso>       Stable timestamp for tests.
`);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeName(value) {
  return normalizeSlash(String(value).toLowerCase()).replaceAll('_', '-').replaceAll(' ', '-');
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

function toRepoRelative(filePath) {
  return normalizeSlash(path.relative(repoRoot, filePath));
}

function normalizeSlash(value) {
  return String(value).replaceAll(path.sep, '/');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  buildRealWorldBuildingSourceRefillManifestCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.status,
        manifest: result.manifestOutput,
        report: result.reportOutput,
        missing_required_views: result.report.missing_required_views
      }, null, 2)}\n`);
    })
    .catch((error) => {
      if (error.report) {
        process.stderr.write(`${JSON.stringify({
          ok: false,
          status: error.report.status,
          missing_required_views: error.report.missing_required_views,
          report: error.report
        }, null, 2)}\n`);
      } else {
        process.stderr.write(`${error.stack || error.message}\n`);
      }
      process.exit(1);
    });
}
