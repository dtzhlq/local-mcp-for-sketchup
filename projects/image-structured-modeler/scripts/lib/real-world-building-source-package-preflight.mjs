import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { repoRoot } from './image-analysis.mjs';
import { generatedSourcePathMarkers } from './real-world-building-release-sample.mjs';
import {
  discoverRealWorldBuildingSourceMetadata,
  viewRecordsFromSourceMetadata
} from './real-world-building-source-metadata.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const CAD_EXTENSIONS = new Set(['.dwg', '.dxf', '.ifc', '.step', '.stp', '.skp']);
const SUPPORTED_MEDIA_TYPES = new Set(['image', 'pdf', 'cad']);

export async function preflightRealWorldBuildingSourcePackage({
  input,
  objectType = 'building_single',
  viewHintsFile = null,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!input) throw new Error('input is required');
  const absoluteInput = resolveRepo(input);
  const sourceAssets = await sourceAssetDescriptors(absoluteInput, viewHintsFile);
  const mediaTypes = Array.from(new Set(sourceAssets.map((asset) => asset.media_type))).sort();
  const supportedAssets = sourceAssets.filter((asset) => SUPPORTED_MEDIA_TYPES.has(asset.media_type));
  const unsupportedAssets = sourceAssets.filter((asset) => !SUPPORTED_MEDIA_TYPES.has(asset.media_type));
  const generatedAssets = sourceAssets.filter((asset) => asset.generated_path_markers.length > 0);
  const duplicateContentGroups = duplicateSourceContentGroups(supportedAssets);
  const sourceMetadata = sourceAssets.sourceMetadata;
  const invalidMetadataFiles = sourceMetadata.metadata_file_records.filter((record) => record.status !== 'parsed');
  const profileId = profileIdForObjectType(objectType);
  const requiredViews = requiredViewsForProfile(profileId);
  const viewSources = collectViewSources(sourceAssets);
  const hintedViews = Array.from(new Set(viewSources.map((source) => source.view))).sort();
  const missingHintedViews = requiredViews.filter((view) => !hintedViews.includes(view));
  const viewSourceDiversity = buildViewSourceDiversity({ viewSources, requiredViews });
  const viewPackageStatus = requiredViews.length === 0
    ? 'review'
    : viewSourceDiversity.status === 'fail'
      ? 'fail'
      : missingHintedViews.length === 0 ? 'pass' : 'review';
  const scalePackage = buildScalePackage(sourceMetadata);

  const checks = [
    {
      id: 'source_assets_present',
      required: true,
      status: supportedAssets.length > 0 ? 'pass' : 'fail',
      message: supportedAssets.length > 0
        ? 'At least one supported image, PDF, or CAD source asset is present.'
        : 'Upload at least one supported image, PDF, or CAD source asset.'
    },
    {
      id: 'supported_media_types',
      required: true,
      status: unsupportedAssets.length === 0 ? 'pass' : 'fail',
      message: unsupportedAssets.length === 0
        ? 'All uploaded files use supported media types.'
        : 'Unsupported files are present; keep source packages to images, PDFs, or CAD files.'
    },
    {
      id: 'source_authenticity_path',
      required: true,
      status: generatedAssets.length === 0 ? 'pass' : 'fail',
      message: generatedAssets.length === 0
        ? 'Source paths do not contain known generated, screenshot, scaffold, or web-source markers.'
        : 'Some paths look like generated, screenshot, scaffold, cropped demo, or web-source assets.'
    },
    {
      id: 'source_content_diversity',
      required: true,
      status: duplicateContentGroups.length === 0 ? 'pass' : 'fail',
      message: duplicateContentGroups.length === 0
        ? 'Source assets have distinct file content hashes.'
        : 'Duplicate source files are present; repeated uploads cannot satisfy multiple required views.'
    },
    {
      id: 'view_hint_package',
      required: false,
      status: requiredViews.length === 0 ? 'review' : missingHintedViews.length === 0 ? 'pass' : 'review',
      message: missingHintedViews.length === 0
        ? 'Filename or view-hints metadata covers the expected building views for intake.'
        : 'Add filename labels or a view-hints file before expecting release-source readiness.'
    },
    {
      id: 'view_source_diversity',
      required: true,
      status: viewSourceDiversity.status,
      message: viewSourceDiversity.status === 'fail'
        ? 'One source asset is labeled as multiple required building views; upload distinct source assets for those views.'
        : 'Required view labels are not reusing the same source path.'
    },
    {
      id: 'metadata_package',
      required: true,
      status: invalidMetadataFiles.length === 0 ? 'pass' : 'fail',
      message: invalidMetadataFiles.length === 0
        ? 'Upload metadata files are parseable and match the supported upload-manifest contract.'
        : 'One or more upload metadata files are invalid JSON or do not match the upload-manifest contract.'
    }
  ];

  const blockers = [];
  if (!['building_single', 'building_group'].includes(profileId)) blockers.push('blocked_profile');
  if (supportedAssets.length === 0) blockers.push('missing_supported_source_assets');
  if (unsupportedAssets.length > 0) blockers.push('unsupported_source_asset_type');
  if (generatedAssets.length > 0) blockers.push('source_assets_generated_or_scaffold');
  if (duplicateContentGroups.length > 0) blockers.push('duplicate_source_assets');
  if (viewSourceDiversity.status === 'fail') blockers.push('view_sources_not_distinct');
  if (invalidMetadataFiles.length > 0) blockers.push('invalid_source_metadata');
  const hardBlocked = blockers.length > 0;
  const canStartStructuredIntake = supportedAssets.length > 0 && unsupportedAssets.length === 0;
  const releaseSourceCandidate = canStartStructuredIntake
    && !hardBlocked
    && requiredViews.length > 0
    && missingHintedViews.length === 0;
  const status = statusForPreflight({
    profileId,
    canStartStructuredIntake,
    invalidMetadataFiles,
    hardBlocked,
    releaseSourceCandidate,
    missingHintedViews
  });

  return {
    version: 1,
    kind: 'real_world_building_source_package_preflight',
    generated_at: generatedAt,
    input: toRepoRelative(absoluteInput),
    profile_id: profileId,
    status,
    can_start_structured_intake: canStartStructuredIntake,
    release_source_candidate: releaseSourceCandidate,
    asset_count: sourceAssets.length,
    supported_asset_count: supportedAssets.length,
    media_types: mediaTypes,
    source_assets: sourceAssets,
    source_content: {
      status: duplicateContentGroups.length === 0 ? 'pass' : 'fail',
      duplicate_groups: duplicateContentGroups
    },
    metadata_files: sourceMetadata.metadata_file_records,
    view_package: {
      status: viewPackageStatus,
      required_views: requiredViews,
      hinted_views: hintedViews,
      missing_hinted_views: missingHintedViews,
      view_source_diversity: viewSourceDiversity,
      sources: viewSources
    },
    scale_package: scalePackage,
    checks,
    blockers: Array.from(new Set(blockers)),
    warnings: warningsForPreflight({
      requiredViews,
      missingHintedViews,
      releaseSourceCandidate,
      scalePackage,
      invalidMetadataFiles,
      duplicateContentGroups,
      viewSourceDiversity
    }),
    next_actions: nextActionsForPreflight({
      canStartStructuredIntake,
      unsupportedAssets,
      generatedAssets,
      duplicateContentGroups,
      viewSourceDiversity,
      invalidMetadataFiles,
      missingHintedViews,
      releaseSourceCandidate,
      scalePackage
    }),
    commands: commandsForPreflight({ input: toRepoRelative(absoluteInput), objectType })
  };
}

export function renderRealWorldBuildingSourcePackagePreflightMarkdown(report) {
  const lines = [
    '# Real-World Building Source Package Preflight',
    '',
    `- Status: \`${report.status}\``,
    `- Can start structured intake: \`${String(report.can_start_structured_intake)}\``,
    `- Release source candidate: \`${String(report.release_source_candidate)}\``,
    `- Profile: \`${report.profile_id}\``,
    `- Assets: \`${report.supported_asset_count}/${report.asset_count}\` supported`,
    `- Source content: \`${report.source_content?.status || 'unknown'}\``,
    '',
    '## Checks',
    '',
    '| Check | Required | Status | Message |',
    '| --- | --- | --- | --- |'
  ];
  for (const check of report.checks) {
    lines.push(`| ${escapeMarkdownTable(check.id)} | ${check.required ? 'yes' : 'no'} | ${check.status} | ${escapeMarkdownTable(check.message)} |`);
  }
  lines.push('', '## Metadata Files', '');
  if (report.metadata_files.length) {
    for (const metadataFile of report.metadata_files) {
      lines.push(`- \`${metadataFile.path}\`: \`${metadataFile.status}\` (${metadataFile.source})`);
      for (const error of [
        ...(metadataFile.errors || []),
        ...(metadataFile.error ? [metadataFile.error] : [])
      ]) lines.push(`  - ${error}`);
    }
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## View Hints', '');
  lines.push(`- Required: \`${report.view_package.required_views.join('`, `') || 'none'}\``);
  lines.push(`- Hinted: \`${report.view_package.hinted_views.join('`, `') || 'none'}\``);
  lines.push(`- Missing hints: \`${report.view_package.missing_hinted_views.join('`, `') || 'none'}\``);
  lines.push(`- Source diversity: \`${report.view_package.view_source_diversity?.status || 'unknown'}\``);
  const reusedSourcePaths = report.view_package.view_source_diversity?.reused_source_paths || [];
  if (reusedSourcePaths.length) {
    for (const item of reusedSourcePaths) {
      lines.push(`  - \`${item.path}\` is labeled as \`${item.views.join('`, `')}\``);
    }
  }
  lines.push('', '## Scale Hints', '');
  lines.push(`- Status: \`${report.scale_package?.status || 'missing'}\``);
  lines.push(`- Known dimensions: \`${String(report.scale_package?.has_known_dimensions === true)}\``);
  lines.push(`- Scale anchors: \`${String(report.scale_package?.has_scale_anchors === true)}\``);
  lines.push(`- Sources: \`${(report.scale_package?.sources || []).join('`, `') || 'none'}\``);
  lines.push('', '## Blockers', '');
  if (report.blockers.length) {
    for (const blocker of report.blockers) lines.push(`- \`${blocker}\``);
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## Next Actions', '');
  if (report.next_actions.length) {
    for (const action of report.next_actions) lines.push(`- ${action}`);
  } else {
    lines.push('- No preflight actions recorded.');
  }
  lines.push('', '## Commands', '');
  lines.push(`- Intake: \`${report.commands.run_intake}\``);
  lines.push(`- Source gate: \`${report.commands.run_intake_source_gate}\``);
  lines.push(`- Release gate: \`${report.commands.run_release_gate}\``);
  return `${lines.join('\n')}\n`;
}

function statusForPreflight({
  profileId,
  canStartStructuredIntake,
  invalidMetadataFiles,
  hardBlocked,
  releaseSourceCandidate,
  missingHintedViews
}) {
  if (!['building_single', 'building_group'].includes(profileId)) return 'blocked_profile';
  if (invalidMetadataFiles.length > 0) return 'blocked_source_metadata';
  if (!canStartStructuredIntake || hardBlocked) return 'blocked_source_assets';
  if (releaseSourceCandidate) return 'release_source_candidate';
  if (missingHintedViews.length > 0) return 'needs_view_hints';
  return 'ready_for_intake';
}

async function sourceAssetDescriptors(absoluteInput, viewHintsFile) {
  const files = await listFiles(absoluteInput);
  const sourceMetadata = await discoverRealWorldBuildingSourceMetadata({
    input: absoluteInput,
    allFiles: files,
    viewHintsFile
  });
  const sourceFiles = files.filter((filePath) => !sourceMetadata.metadataFiles.has(path.resolve(filePath)));
  const assets = await Promise.all(sourceFiles.map(async (filePath) => {
    const stat = await fs.stat(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const repoRelativePath = toRepoRelative(filePath);
    const mediaType = mediaTypeForExtension(extension);
    const generatedMarkers = generatedSourcePathMarkers(repoRelativePath);
    const viewHintSources = [
      ...viewRecordsFromSourceMetadata({ filePath, sourceMetadata }),
      ...viewRecordsFromFilename({ filePath, mediaType })
    ];
    const viewHints = Array.from(new Set(viewHintSources.map((item) => item.view))).sort();
    return {
      path: repoRelativePath,
      media_type: mediaType,
      extension,
      size_bytes: stat.size,
      content_sha256: await contentHash(filePath),
      status: mediaType === 'unknown' || generatedMarkers.length > 0 ? 'fail' : viewHints.length > 0 ? 'pass' : 'review',
      generated_path_markers: generatedMarkers,
      view_hints: viewHints,
      view_hint_sources: viewHintSources
    };
  }));
  assets.sourceMetadata = sourceMetadata;
  return assets;
}

async function listFiles(absoluteInput) {
  const stat = await fs.stat(absoluteInput);
  if (stat.isFile()) return [absoluteInput];
  const entries = await fs.readdir(absoluteInput, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(absoluteInput, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function viewRecordsFromFilename({ filePath, mediaType }) {
  const name = path.basename(filePath).toLowerCase();
  const records = [];
  if (/(^|[-_. ])front|facade|elevation/.test(name)) records.push({ view: 'front', source: 'filename' });
  if (/(^|[-_. ])rear|back/.test(name)) records.push({ view: 'rear', source: 'filename' });
  if (/(^|[-_. ])right/.test(name)) records.push({ view: 'right', source: 'filename' });
  if (/(^|[-_. ])left|side/.test(name)) records.push({ view: 'left', source: 'filename' });
  if (/oblique|quarter|perspective|street/.test(name)) records.push({ view: 'oblique', source: 'filename' });
  if (/top|roof|plan|site|floor/.test(name)) records.push({ view: 'top', source: 'filename' });
  if (mediaType === 'cad' && !records.some((record) => record.view === 'top')) {
    records.push({ view: 'top', source: 'cad_plan_default' });
  }
  return records;
}

function collectViewSources(sourceAssets) {
  const sources = [];
  for (const asset of sourceAssets) {
    for (const record of asset.view_hint_sources || []) {
      sources.push({
        view: record.view,
        path: asset.path,
        source: record.source,
        ...(record.metadata_path ? { metadata_path: record.metadata_path } : {})
      });
    }
  }
  return sources.sort((a, b) => `${a.view}:${a.path}`.localeCompare(`${b.view}:${b.path}`));
}

function buildViewSourceDiversity({ viewSources, requiredViews }) {
  const requiredViewSet = new Set(requiredViews || []);
  if (requiredViewSet.size === 0) {
    return {
      status: 'review',
      distinct_source_paths_for_required_views: 0,
      source_groups: [],
      reused_source_paths: []
    };
  }
  const sourceGroups = new Map();
  for (const source of viewSources || []) {
    if (!requiredViewSet.has(source.view)) continue;
    if (!sourceGroups.has(source.path)) sourceGroups.set(source.path, []);
    sourceGroups.get(source.path).push(source);
  }
  const sourceGroupRecords = Array.from(sourceGroups.entries())
    .map(([sourcePath, sources]) => ({
      path: sourcePath,
      views: Array.from(new Set(sources.map((source) => source.view))).sort(),
      sources: Array.from(new Set(sources.map((source) => source.source))).sort(),
      metadata_paths: Array.from(new Set(sources.map((source) => source.metadata_path).filter(Boolean))).sort()
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const reusedSourcePaths = sourceGroupRecords.filter((group) => group.views.length > 1);
  return {
    status: reusedSourcePaths.length === 0 ? 'pass' : 'fail',
    distinct_source_paths_for_required_views: sourceGroupRecords.length,
    source_groups: sourceGroupRecords,
    reused_source_paths: reusedSourcePaths
  };
}

function buildScalePackage(sourceMetadata) {
  const hints = sourceMetadata?.scale_hints || [];
  const knownDimensions = hints.filter((hint) => hint.kind === 'known_dimensions');
  const scaleAnchors = hints.filter((hint) => hint.kind === 'scale_anchor');
  const sources = Array.from(new Set(hints.map((hint) => hint.source))).sort();
  return {
    status: knownDimensions.length > 0 || scaleAnchors.length > 0 ? 'review' : 'missing',
    has_known_dimensions: knownDimensions.length > 0,
    has_scale_anchors: scaleAnchors.length > 0,
    hints,
    sources,
    next_actions: knownDimensions.length > 0 || scaleAnchors.length > 0
      ? ['Review source metadata scale hints during intake; do not treat them as final geometry permission.']
      : ['Provide known dimensions, CAD/PDF scale evidence, or reliable scale anchors before release work.']
  };
}

function warningsForPreflight({
  requiredViews,
  missingHintedViews,
  releaseSourceCandidate,
  scalePackage,
  invalidMetadataFiles,
  duplicateContentGroups,
  viewSourceDiversity
}) {
  const warnings = [];
  if (!releaseSourceCandidate) {
    warnings.push('Preflight does not prove visual semantic coverage, scale confidence, or final release readiness.');
  }
  if (missingHintedViews.length > 0) {
    warnings.push(`Missing expected view labels before release-source work: ${missingHintedViews.join(', ')}.`);
  }
  if (invalidMetadataFiles.length > 0) warnings.push('One or more upload metadata files are invalid; fix metadata before release-source work.');
  if (duplicateContentGroups.length > 0) warnings.push('Duplicate source file content was detected; repeated copies cannot count as independent building views.');
  if (viewSourceDiversity?.status === 'fail') warnings.push('One source path is labeled as multiple required views; labels alone cannot prove distinct building viewpoints.');
  if (scalePackage?.status === 'missing') warnings.push('No known dimension or scale-anchor metadata was found in the upload package.');
  if (requiredViews.length === 0) warnings.push('Unknown profile has no building-source view contract.');
  return warnings;
}

function nextActionsForPreflight({
  canStartStructuredIntake,
  unsupportedAssets,
  generatedAssets,
  duplicateContentGroups,
  viewSourceDiversity,
  invalidMetadataFiles,
  missingHintedViews,
  releaseSourceCandidate,
  scalePackage
}) {
  const actions = [];
  if (!canStartStructuredIntake) actions.push('Upload supported images, PDFs, or CAD files before running structured intake.');
  if (unsupportedAssets.length > 0) actions.push('Remove or replace unsupported files from the upload package.');
  if (generatedAssets.length > 0) actions.push('Replace generated, screenshot, scaffold, cropped demo, or social-web source paths with original user-provided building assets.');
  if (duplicateContentGroups.length > 0) actions.push('Replace duplicated source files with distinct real views or drawings; one file copied under multiple view labels is not enough.');
  if (viewSourceDiversity?.status === 'fail') actions.push('Split multi-view labels across distinct uploaded source assets; one source file cannot satisfy multiple required views.');
  if (invalidMetadataFiles.length > 0) actions.push('Fix or remove invalid upload metadata files before release-source work.');
  for (const view of missingHintedViews) actions.push(`Add or label a ${view} view in filenames or a view-hints file.`);
  if (scalePackage?.status === 'missing') actions.push('Add known building dimensions, CAD/PDF scale evidence, or scale anchors to the upload manifest when available.');
  if (scalePackage?.status === 'review') actions.push('Review upload manifest scale hints during structured intake before trusting model dimensions.');
  if (releaseSourceCandidate) actions.push('Run structured intake with the source input gate, then inspect source-package and MCP brief outputs.');
  return Array.from(new Set(actions));
}

function duplicateSourceContentGroups(assets) {
  const groups = new Map();
  for (const asset of assets || []) {
    if (!asset.content_sha256) continue;
    if (!groups.has(asset.content_sha256)) groups.set(asset.content_sha256, []);
    groups.get(asset.content_sha256).push(asset);
  }
  return Array.from(groups.entries())
    .filter(([, items]) => items.length > 1)
    .map(([contentHashValue, items]) => ({
      content_sha256: contentHashValue,
      paths: items.map((item) => item.path).sort(),
      media_types: Array.from(new Set(items.map((item) => item.media_type))).sort(),
      view_hints: Array.from(new Set(items.flatMap((item) => item.view_hints || []))).sort()
    }))
    .sort((a, b) => a.content_sha256.localeCompare(b.content_sha256));
}

async function contentHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function commandsForPreflight({ input, objectType }) {
  const base = `npm run image-structured:intake -- --input ${cliArg(input)} --object-type ${cliArg(objectType)} --output-dir output/image-structured-modeler/upload-intake`;
  return {
    run_intake: base,
    run_intake_source_gate: `${base} --require-source-input-ready`,
    run_release_gate: 'npm run image-structured:release-gate -- --output-dir output/image-structured-modeler/release-gate'
  };
}

function mediaTypeForExtension(extension) {
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (CAD_EXTENSIONS.has(extension)) return 'cad';
  return 'unknown';
}

function profileIdForObjectType(objectType) {
  if (objectType === 'building_single') return 'building_single';
  if (objectType === 'building_group') return 'building_group';
  return 'unknown_object';
}

function requiredViewsForProfile(profileId) {
  if (profileId === 'building_single') return ['front', 'left', 'oblique', 'top'];
  if (profileId === 'building_group') return ['oblique', 'top'];
  return [];
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).split(path.sep).join('/') || '.';
}

function cliArg(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
