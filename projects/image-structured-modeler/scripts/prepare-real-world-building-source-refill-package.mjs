#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import { buildRealWorldBuildingUploadManifestTemplate } from './lib/real-world-building-source-package.mjs';

const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/real-world-building-source-refill-package';

export async function prepareRealWorldBuildingSourceRefillPackageCli({
  sourceRequest,
  outputDir = DEFAULT_OUTPUT_DIR,
  objectType = 'building_single',
  uploadSessionOutputDir = null,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!sourceRequest) throw new Error('--source-request is required.');
  const sourceRequestPath = sourceRequest;
  const sourceRequestArtifact = await readJson(resolveRepo(sourceRequestPath));
  const absoluteOutputDir = resolveRepo(outputDir);
  const uploadPackageDir = path.join(outputDir, 'upload-package');
  await fs.mkdir(path.join(resolveRepo(uploadPackageDir), 'sources'), { recursive: true });

  const sourceSlots = sourceSlotsForSourceRequest(sourceRequestArtifact);
  const uploadManifestTemplate = buildRealWorldBuildingUploadManifestTemplate({
    sourceRequest: sourceRequestArtifact,
    profileId: objectType,
    generatedAt
  });
  uploadManifestTemplate.views = uploadManifestTemplate.views.map((view) => ({
    ...view,
    source_image: suggestedSourcePath(view.kind)
  }));

  const guide = buildSourceRefillPackageGuide({
    sourceRequest: sourceRequestArtifact,
    sourceRequestPath,
    outputDir,
    uploadPackageDir,
    objectType,
    uploadSessionOutputDir: uploadSessionOutputDir || defaultUploadSessionOutputDir(outputDir),
    sourceSlots,
    uploadManifestTemplate,
    generatedAt
  });
  const guideOutput = path.join(outputDir, 'source-refill-package-guide.json');
  const markdownOutput = path.join(outputDir, 'source-refill-package-guide.md');
  const readmeOutput = path.join(outputDir, 'README.md');
  const manifestTemplateOutput = path.join(outputDir, 'upload-manifest.template.json');
  const sourceSlotsReadmeOutput = path.join(outputDir, 'source-slots.md');

  await writeJson(resolveRepo(guideOutput), guide);
  await writeJson(resolveRepo(manifestTemplateOutput), uploadManifestTemplate);
  const markdown = renderSourceRefillPackageGuideMarkdown(guide);
  await fs.writeFile(resolveRepo(markdownOutput), markdown, 'utf8');
  await fs.writeFile(resolveRepo(readmeOutput), markdown, 'utf8');
  await fs.writeFile(resolveRepo(sourceSlotsReadmeOutput), renderSourceSlotsReadme(guide), 'utf8');

  return {
    ok: true,
    guide,
    uploadManifestTemplate,
    outputDir,
    guideOutput,
    markdownOutput,
    readmeOutput,
    manifestTemplateOutput,
    sourceSlotsReadmeOutput
  };
}

export function buildSourceRefillPackageGuide({
  sourceRequest,
  sourceRequestPath,
  outputDir,
  uploadPackageDir,
  objectType,
  uploadSessionOutputDir,
  sourceSlots,
  uploadManifestTemplate,
  generatedAt
}) {
  const requiredViews = sourceRequest.view_source_requirements?.required_views
    || sourceSlots.filter((slot) => slot.required).map((slot) => slot.view);
  const missingViews = sourceRequest.upload_package_requirements?.missing_required_views || [];
  const validateUploadSession = [
    'npm run image-structured:real-world-building-upload-session --',
    '--input',
    shellArg(uploadPackageDir),
    '--object-type',
    shellArg(objectType),
    '--output-dir',
    shellArg(uploadSessionOutputDir),
    '--source-request-file',
    shellArg(sourceRequestPath),
    '--real-world-building-release-draft'
  ].join(' ');
  const validateRefillPackage = [
    'npm run image-structured:validate-real-world-building-source-refill-package --',
    '--package-dir',
    shellArg(outputDir)
  ].join(' ');
  const buildManifestFromSources = [
    'npm run image-structured:build-real-world-building-source-refill-manifest --',
    '--package-dir',
    shellArg(outputDir),
    '--force'
  ].join(' ');
  const runSourceRefillWorkflow = [
    'npm run image-structured:run-real-world-building-source-refill-workflow --',
    '--package-dir',
    shellArg(outputDir),
    '--upload-session-output-dir',
    shellArg(uploadSessionOutputDir)
  ].join(' ');
  return {
    version: 1,
    kind: 'real_world_building_source_refill_package_guide',
    generated_at: generatedAt,
    object_type: objectType,
    source_request: {
      path: sourceRequestPath,
      status: sourceRequest.status,
      accepted_asset_types: sourceRequest.accepted_asset_types || [],
      blocked_until_satisfied: sourceRequest.blocked_until_satisfied || []
    },
    output_package: {
      directory: outputDir,
      upload_package_directory: uploadPackageDir,
      manifest_template: path.join(outputDir, 'upload-manifest.template.json'),
      guide: path.join(outputDir, 'source-refill-package-guide.json'),
      guide_markdown: path.join(outputDir, 'source-refill-package-guide.md'),
      readme: path.join(outputDir, 'README.md'),
      source_slots_readme: path.join(outputDir, 'source-slots.md'),
      sources_directory: path.join(uploadPackageDir, 'sources'),
      upload_session_output_dir: uploadSessionOutputDir
    },
    package_policy: {
      direct_upload_ready: false,
      manifest_template_only: uploadManifestTemplate.template_only === true,
      real_manifest_file_names: sourceRequest.upload_package_requirements?.manifest_file_names || ['manifest.json', 'upload-manifest.json'],
      replacement_required: sourceRequest.source_asset_requirements?.needs_replacement_assets === true,
      distinct_source_images_required: sourceRequest.view_source_requirements?.distinct_source_images_required === true,
      source_image_field: sourceRequest.view_source_requirements?.source_image_field || 'views[].source_image',
      forbidden_source_kinds: sourceRequest.upload_package_requirements?.source_asset_policy?.forbidden_source_kinds || [],
      forbidden_shortcuts: sourceRequest.upload_package_requirements?.forbidden_shortcuts || []
    },
    required_views: requiredViews,
    missing_required_views: missingViews,
    source_slots: sourceSlots,
    scale_evidence: {
      required: sourceRequest.upload_package_requirements?.scale_evidence?.required !== false,
      status: sourceRequest.scale_requirement?.status || 'fail',
      current_confidence: sourceRequest.scale_requirement?.current_confidence ?? null,
      minimum_confidence: sourceRequest.scale_requirement?.minimum_confidence ?? 0.7,
      manifest_fields: sourceRequest.upload_package_requirements?.scale_evidence?.manifest_fields || [
        'dimensions',
        'known_dimensions',
        'scale_hints',
        'scale_anchors'
      ],
      acceptable_evidence: sourceRequest.scale_requirement?.acceptable_evidence || []
    },
    semantic_evidence_quality: sourceRequest.semantic_evidence_quality || null,
    upload_manifest_template: uploadManifestTemplate,
    commands: {
      build_manifest_from_sources: buildManifestFromSources,
      run_source_refill_workflow: runSourceRefillWorkflow,
      validate_refill_package: validateRefillPackage,
      require_upload_ready: `${validateRefillPackage} --require-upload-ready`,
      validate_upload_session: validateUploadSession,
      require_input_ready: `${validateUploadSession} --require-preflight-release-source-candidate --require-source-input-ready`
    },
    next_actions: [
      'Place original user-provided building photos, scans, PDFs, or CAD files under the sources directory.',
      'Run commands.build_manifest_from_sources to create upload-package/manifest.json from clearly named source files.',
      'If editing manually, copy upload-manifest.template.json to manifest.json only after every source_image points at a real uploaded file.',
      'Set template_only to false or remove it from manifest.json before validation.',
      'Keep each required view on a distinct source_image path.',
      'Add known dimensions or scale anchors when available.',
      'Run commands.run_source_refill_workflow to build and validate the refill package through one product-facing report.',
      'Run commands.require_upload_ready before upload-session validation.',
      'Run commands.require_input_ready before moving to release artifact authoring.'
    ]
  };
}

export function renderSourceRefillPackageGuideMarkdown(guide) {
  const lines = [
    '# Real-World Building Source Refill Package',
    '',
    `- Source request: \`${guide.source_request.path}\``,
    `- Source request status: \`${guide.source_request.status}\``,
    `- Direct upload ready: \`${String(guide.package_policy.direct_upload_ready)}\``,
    `- Manifest template only: \`${String(guide.package_policy.manifest_template_only)}\``,
    `- Upload package dir: \`${guide.output_package.upload_package_directory}\``,
    `- Sources dir: \`${guide.output_package.sources_directory}\``,
    `- Manifest template: \`${guide.output_package.manifest_template}\``,
    `- Required views: \`${guide.required_views.join('`, `') || 'none'}\``,
    `- Missing required views: \`${guide.missing_required_views.join('`, `') || 'none'}\``,
    '',
    '## Source Slots',
    '',
    '| View | Required | Current Status | Suggested Source Path | Request |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const slot of guide.source_slots) {
    lines.push(`| ${slot.view} | ${slot.required ? 'yes' : 'no'} | ${slot.current_status} | \`${slot.suggested_source_image}\` | ${escapeMarkdownTable(slot.request)} |`);
  }
  lines.push('', '## Manifest Policy', '');
  lines.push(`- Real manifest file names: \`${guide.package_policy.real_manifest_file_names.join('`, `')}\``);
  lines.push(`- Source image field: \`${guide.package_policy.source_image_field}\``);
  lines.push(`- Distinct source images required: \`${String(guide.package_policy.distinct_source_images_required)}\``);
  lines.push(`- Forbidden source kinds: \`${guide.package_policy.forbidden_source_kinds.join('`, `') || 'none'}\``);
  lines.push('', '## Scale Evidence', '');
  lines.push(`- Required: \`${String(guide.scale_evidence.required)}\``);
  lines.push(`- Status: \`${guide.scale_evidence.status}\``);
  lines.push(`- Minimum confidence: \`${String(guide.scale_evidence.minimum_confidence)}\``);
  lines.push(`- Manifest fields: \`${guide.scale_evidence.manifest_fields.join('`, `')}\``);
  for (const item of guide.scale_evidence.acceptable_evidence || []) lines.push(`- ${item}`);
  lines.push('', '## Commands', '');
  lines.push(`- Build manifest from sources: \`${guide.commands.build_manifest_from_sources}\``);
  lines.push(`- Run source refill workflow: \`${guide.commands.run_source_refill_workflow}\``);
  lines.push(`- Validate refill package: \`${guide.commands.validate_refill_package}\``);
  lines.push(`- Require upload ready: \`${guide.commands.require_upload_ready}\``);
  lines.push(`- Validate upload session: \`${guide.commands.validate_upload_session}\``);
  lines.push(`- Require input ready: \`${guide.commands.require_input_ready}\``);
  lines.push('', '## Next Actions', '');
  for (const action of guide.next_actions) lines.push(`- ${action}`);
  return `${lines.join('\n')}\n`;
}

function renderSourceSlotsReadme(guide) {
  const lines = [
    '# Source Files',
    '',
    `Put original real building source files in \`${guide.output_package.sources_directory}\`, then copy \`${guide.output_package.manifest_template}\` to \`${guide.output_package.upload_package_directory}/manifest.json\` and point each required view at a distinct file.`,
    '',
    '| View | Suggested File |',
    '| --- | --- |'
  ];
  for (const slot of guide.source_slots) {
    lines.push(`| ${slot.view} | \`${path.basename(slot.suggested_source_image)}\` |`);
  }
  return `${lines.join('\n')}\n`;
}

function sourceSlotsForSourceRequest(sourceRequest) {
  const slots = sourceRequest.upload_package_requirements?.required_view_slots?.length
    ? sourceRequest.upload_package_requirements.required_view_slots
    : sourceRequest.view_requirements || [];
  return slots
    .filter((slot) => slot.required !== false)
    .map((slot) => ({
      view: slot.view,
      required: slot.required !== false,
      current_status: slot.status || 'missing',
      suggested_source_image: suggestedSourcePath(slot.view),
      source_image_field: slot.source_image_field || 'views[].source_image',
      distinct_source_image_required: slot.distinct_source_image_required !== false,
      request: slot.request || '',
      acceptable_sources: slot.acceptable_sources || []
    }));
}

function suggestedSourcePath(view) {
  const names = {
    front: 'front-real-building.jpg',
    rear: 'rear-real-building.jpg',
    left: 'left-side-real-building.jpg',
    right: 'right-side-real-building.jpg',
    oblique: 'oblique-real-building.jpg',
    top: 'top-or-plan-real-building.jpg'
  };
  return path.posix.join('sources', names[view] || `${view || 'source'}-real-building.jpg`);
}

function defaultUploadSessionOutputDir(outputDir) {
  const segment = path.basename(outputDir.replace(/\/$/u, '')) || 'source-refill-package';
  return path.posix.join('output/image-structured-modeler/real-world-building-upload-session', segment);
}

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    objectType: 'building_single'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source-request') options.sourceRequest = nextValue(argv, ++index, arg);
    else if (arg === '--output-dir') options.outputDir = nextValue(argv, ++index, arg);
    else if (arg === '--object-type') options.objectType = nextValue(argv, ++index, arg);
    else if (arg === '--upload-session-output-dir') options.uploadSessionOutputDir = nextValue(argv, ++index, arg);
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
  node projects/image-structured-modeler/scripts/prepare-real-world-building-source-refill-package.mjs \\
    --source-request output/.../real-world-building-source-request.json \\
    --output-dir output/image-structured-modeler/real-world-building-source-refill-package

Options:
  --source-request <path>             Source request JSON produced by upload-session or intake.
  --output-dir <path>                 Directory to write the package guide and manifest template.
  --object-type <type>                building_single or building_group. Defaults to building_single.
  --upload-session-output-dir <path>  Output directory used in generated validation commands.
  --generated-at <iso>                Stable timestamp for tests.
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  prepareRealWorldBuildingSourceRefillPackageCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        output_dir: result.outputDir,
        guide: result.guideOutput,
        manifest_template: result.manifestTemplateOutput,
        required_views: result.guide.required_views,
        missing_required_views: result.guide.missing_required_views,
        direct_upload_ready: result.guide.package_policy.direct_upload_ready
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
