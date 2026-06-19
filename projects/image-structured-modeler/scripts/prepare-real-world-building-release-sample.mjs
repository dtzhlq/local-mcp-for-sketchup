#!/usr/bin/env node
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  buildRealWorldBuildingPositiveManifest,
  buildRealWorldBuildingPositiveReleaseChecklist,
  buildRealWorldBuildingReleaseWorkOrder,
  renderRealWorldBuildingPositiveReleaseChecklistMarkdown,
  renderRealWorldBuildingReleaseWorkOrderMarkdown,
  validateRealWorldBuildingPositiveManifestPath
} from './lib/real-world-building-release-sample.mjs';
import { repoRoot } from './lib/image-analysis.mjs';

const DEFAULT_MANIFEST_OUTPUT = 'output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json';
const DEFAULT_FORMAL_MANIFEST_STAGING_OUTPUT = 'output/image-structured-modeler/real-world-building-positive-manifest/formal-target-candidate/manifest.draft.json';
const FORMAL_MANIFEST_WRITE_BLOCKED_STATUS = 'formal_release_manifest_write_blocked';
const PROFILE_PATH_BY_INTAKE_PROFILE = {
  building_single: 'examples/product-profiles/building_single_urban_oblique.json',
  building_single_urban_oblique: 'examples/product-profiles/building_single_urban_oblique.json',
  building_group: 'examples/product-profiles/building_group_industrial_campus.json',
  building_group_industrial_campus: 'examples/product-profiles/building_group_industrial_campus.json'
};
const INTAKE_ARTIFACT_CANDIDATES = {
  part_graph: ['part-graph.candidate-promoted.json', 'part-graph.json'],
  output: ['output.json', 'output.dsl.json'],
  photo_grade_readiness_report: ['photo-grade-readiness-report.json'],
  vision_evidence_report: ['vision-evidence-v1-report.json'],
  vision_evidence_review_patch: ['vision-evidence-review-patch.json'],
  vision_evidence_review_decision: [
    'vision-evidence-review.accepted.json',
    path.join('vision-evidence-review', 'vision-evidence-review.browser-exported.json'),
    'vision-evidence-review-decision.json'
  ],
  vision_evidence_policy_correction_patch: ['vision-evidence-policy-correction-patch.json'],
  geometry_fit_report: ['geometry-fit-report.json'],
  grounding_v3_report: ['grounding-v3-report.json'],
  layout_qa_report: ['layout-qa-report.json'],
  reference_qa_report: ['reference-qa-report.json'],
  proposal_qa_report: ['proposal-qa-report.json'],
  queue_proposal_qa_report: ['queue-proposal-qa-report.json']
};
const REQUIRED_INTAKE_ARTIFACT_KEYS = new Set([
  'part_graph',
  'output',
  'photo_grade_readiness_report',
  'vision_evidence_report',
  'vision_evidence_review_patch',
  'vision_evidence_review_decision',
  'vision_evidence_policy_correction_patch'
]);

export async function prepareRealWorldBuildingReleaseSampleCli(options = {}) {
  const intakeDefaults = options.intakeDir ? await realWorldBuildingDefaultsFromIntakeDir(options.intakeDir) : {};
  const requestedManifestOutput = options.manifestOutput || DEFAULT_MANIFEST_OUTPUT;
  const formalManifestTargetRequested = sameResolvedPath(requestedManifestOutput, DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST);
  const validationManifestOutput = formalManifestTargetRequested
    ? options.formalManifestStagingOutput || DEFAULT_FORMAL_MANIFEST_STAGING_OUTPUT
    : requestedManifestOutput;
  const artifactOutputDir = path.dirname(validationManifestOutput);
  const checklistOutput = options.checklistOutput || path.join(artifactOutputDir, 'release-checklist.json');
  const checklistMarkdownOutput = options.checklistMarkdownOutput || path.join(artifactOutputDir, 'release-checklist.md');
  const workOrderOutput = options.workOrderOutput || path.join(artifactOutputDir, 'release-work-order.json');
  const workOrderMarkdownOutput = options.workOrderMarkdownOutput || path.join(artifactOutputDir, 'release-work-order.md');
  const manifest = buildRealWorldBuildingPositiveManifest({
    sampleId: options.sampleId || intakeDefaults.sampleId,
    sourceImages: options.sourceImages?.length ? options.sourceImages : intakeDefaults.sourceImages,
    sourceAssetKind: options.sourceAssetKind || intakeDefaults.sourceAssetKind,
    profilePath: options.profilePath || intakeDefaults.profilePath,
    artifacts: {
      ...(intakeDefaults.artifacts || {}),
      ...(options.artifacts || {})
    },
    review: options.review
  });
  const absoluteValidationManifestOutput = resolveRepo(validationManifestOutput);
  await writeJson(absoluteValidationManifestOutput, manifest);
  let checklist = null;
  let validation = null;
  let absoluteChecklistOutput = null;
  let absoluteChecklistMarkdownOutput = null;
  let workOrder = null;
  let absoluteWorkOrderOutput = null;
  let absoluteWorkOrderMarkdownOutput = null;
  let contractSummaryOutput = null;
  let absoluteContractSummaryOutput = null;
  let status = 'draft_manifest_written';
  let manifestOutput = validationManifestOutput;
  let absoluteManifestOutput = absoluteValidationManifestOutput;
  let formalManifestWriteBlocked = false;
  let formalManifestBlockers = [];
  if (options.writeChecklist !== false) {
    validation = await validateRealWorldBuildingPositiveManifestPath({
      manifestPath: validationManifestOutput,
      outputDir: artifactOutputDir,
      allowMissing: false
    });
    checklist = validation.checklist || await buildRealWorldBuildingPositiveReleaseChecklist({ manifest, manifestPath: validationManifestOutput });
    absoluteChecklistOutput = resolveRepo(checklistOutput);
    absoluteChecklistMarkdownOutput = resolveRepo(checklistMarkdownOutput);
    if (checklistOutput !== path.join(artifactOutputDir, 'release-checklist.json')) {
      await writeJson(absoluteChecklistOutput, checklist);
    }
    if (checklistMarkdownOutput !== path.join(artifactOutputDir, 'release-checklist.md')) {
      await fs.mkdir(path.dirname(absoluteChecklistMarkdownOutput), { recursive: true });
      await fs.writeFile(absoluteChecklistMarkdownOutput, renderRealWorldBuildingPositiveReleaseChecklistMarkdown(checklist), 'utf8');
    }
    workOrder = buildRealWorldBuildingReleaseWorkOrder({
      manifest,
      checklist,
      manifestPath: validationManifestOutput,
      releaseManifestPath: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST
    });
    absoluteWorkOrderOutput = resolveRepo(workOrderOutput);
    absoluteWorkOrderMarkdownOutput = resolveRepo(workOrderMarkdownOutput);
    await writeJson(absoluteWorkOrderOutput, workOrder);
    await fs.mkdir(path.dirname(absoluteWorkOrderMarkdownOutput), { recursive: true });
    await fs.writeFile(absoluteWorkOrderMarkdownOutput, renderRealWorldBuildingReleaseWorkOrderMarkdown(workOrder), 'utf8');
    contractSummaryOutput = path.join(artifactOutputDir, 'manifest-contract-summary.json');
    absoluteContractSummaryOutput = resolveRepo(contractSummaryOutput);
  }
  if (formalManifestTargetRequested) {
    const canWriteFormalManifest = validation?.ok === true
      && validation?.metrics?.closes_release_gap === true
      && checklist?.can_promote_to_release_manifest === true;
    if (canWriteFormalManifest) {
      manifestOutput = requestedManifestOutput;
      absoluteManifestOutput = resolveRepo(requestedManifestOutput);
      await writeJson(absoluteManifestOutput, manifest);
      status = 'formal_release_manifest_written';
    } else {
      formalManifestWriteBlocked = true;
      formalManifestBlockers = checklist?.blockers?.length
        ? checklist.blockers
        : ['release_checklist_not_run'];
      status = FORMAL_MANIFEST_WRITE_BLOCKED_STATUS;
    }
  }
  return {
    ok: !formalManifestWriteBlocked,
    status,
    manifest,
    manifestOutput,
    requestedManifestOutput,
    validationManifestOutput,
    absoluteManifestOutput,
    absoluteValidationManifestOutput,
    formalManifestOutput: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
    formalManifestTargetRequested,
    formalManifestWriteBlocked,
    formalManifestBlockers,
    validation,
    contractSummaryOutput,
    absoluteContractSummaryOutput,
    checklist,
    checklistOutput: checklist ? checklistOutput : null,
    checklistMarkdownOutput: checklist ? checklistMarkdownOutput : null,
    workOrder,
    workOrderOutput: workOrder ? workOrderOutput : null,
    workOrderMarkdownOutput: workOrder ? workOrderMarkdownOutput : null,
    absoluteChecklistOutput,
    absoluteChecklistMarkdownOutput,
    absoluteWorkOrderOutput,
    absoluteWorkOrderMarkdownOutput
  };
}

function parseArgs(argv) {
  const options = {
    manifestOutput: DEFAULT_MANIFEST_OUTPUT,
    formalManifestStagingOutput: DEFAULT_FORMAL_MANIFEST_STAGING_OUTPUT,
    sourceImages: [],
    sourceAssetKind: null,
    artifacts: {},
    review: {},
    writeChecklist: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--intake-dir') options.intakeDir = nextValue(argv, ++index, arg);
    else if (arg === '--sample-id') options.sampleId = nextValue(argv, ++index, arg);
    else if (arg === '--source-image') options.sourceImages.push(nextValue(argv, ++index, arg));
    else if (arg === '--source-images') {
      options.sourceImages.push(...nextValue(argv, ++index, arg).split(',').map((value) => value.trim()).filter(Boolean));
    } else if (arg === '--source-asset-kind') options.sourceAssetKind = nextValue(argv, ++index, arg);
    else if (arg === '--profile' || arg === '--profile-path') options.profilePath = nextValue(argv, ++index, arg);
    else if (arg === '--part-graph') options.artifacts.part_graph = nextValue(argv, ++index, arg);
    else if (arg === '--compiled-output' || arg === '--output-dsl') options.artifacts.output = nextValue(argv, ++index, arg);
    else if (arg === '--photo-grade-readiness-report') options.artifacts.photo_grade_readiness_report = nextValue(argv, ++index, arg);
    else if (arg === '--vision-evidence-report') options.artifacts.vision_evidence_report = nextValue(argv, ++index, arg);
    else if (arg === '--vision-evidence-review-patch') options.artifacts.vision_evidence_review_patch = nextValue(argv, ++index, arg);
    else if (arg === '--vision-evidence-review-decision') options.artifacts.vision_evidence_review_decision = nextValue(argv, ++index, arg);
    else if (arg === '--vision-evidence-policy-correction-patch') options.artifacts.vision_evidence_policy_correction_patch = nextValue(argv, ++index, arg);
    else if (arg === '--geometry-fit-report') options.artifacts.geometry_fit_report = nextValue(argv, ++index, arg);
    else if (arg === '--grounding-v3-report') options.artifacts.grounding_v3_report = nextValue(argv, ++index, arg);
    else if (arg === '--layout-qa-report') options.artifacts.layout_qa_report = nextValue(argv, ++index, arg);
    else if (arg === '--reference-qa-report') options.artifacts.reference_qa_report = nextValue(argv, ++index, arg);
    else if (arg === '--proposal-qa-report') options.artifacts.proposal_qa_report = nextValue(argv, ++index, arg);
    else if (arg === '--queue-proposal-qa-report') options.artifacts.queue_proposal_qa_report = nextValue(argv, ++index, arg);
    else if (arg === '--reviewer') options.review.reviewer = nextValue(argv, ++index, arg);
    else if (arg === '--accepted-at') options.review.accepted_at = nextValue(argv, ++index, arg);
    else if (arg === '--notes') options.review.notes = nextValue(argv, ++index, arg);
    else if (arg === '--manifest-output') options.manifestOutput = nextValue(argv, ++index, arg);
    else if (arg === '--formal-manifest-staging-output') options.formalManifestStagingOutput = nextValue(argv, ++index, arg);
    else if (arg === '--checklist-output') options.checklistOutput = nextValue(argv, ++index, arg);
    else if (arg === '--checklist-markdown-output') options.checklistMarkdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--work-order-output') options.workOrderOutput = nextValue(argv, ++index, arg);
    else if (arg === '--work-order-markdown-output') options.workOrderMarkdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--no-checklist') options.writeChecklist = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function sameResolvedPath(left, right) {
  return path.normalize(resolveRepo(left)) === path.normalize(resolveRepo(right));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  prepareRealWorldBuildingReleaseSampleCli(options)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.status,
        manifest: result.manifestOutput,
        requested_manifest: result.requestedManifestOutput,
        validation_manifest: result.validationManifestOutput,
        formal_manifest_target_requested: result.formalManifestTargetRequested,
        formal_manifest_write_blocked: result.formalManifestWriteBlocked,
        formal_manifest_blockers: result.formalManifestBlockers,
        intake_dir: options.intakeDir || null,
        sample_id: result.manifest.sample_id,
        source_images: result.manifest.source_images.length,
        artifacts: Object.keys(result.manifest.artifacts),
        release_ready: result.checklist?.release_ready ?? null,
        can_promote_to_release_manifest: result.checklist?.can_promote_to_release_manifest ?? null,
        validation_status: result.validation?.status || null,
        closes_release_gap: result.validation?.metrics?.closes_release_gap ?? null,
        contract_summary: result.contractSummaryOutput,
        checklist: result.checklistOutput,
        checklist_markdown: result.checklistMarkdownOutput,
        work_order: result.workOrderOutput,
        work_order_markdown: result.workOrderMarkdownOutput
      }, null, 2)}\n`);
      if (!result.ok) process.exit(1);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}

async function realWorldBuildingDefaultsFromIntakeDir(intakeDir) {
  const resolvedIntakeDir = resolveRepo(intakeDir);
  const assetSet = await readJson(path.join(resolvedIntakeDir, 'asset-set.json'));
  const modelingBrief = await readOptionalJson(path.join(resolvedIntakeDir, 'modeling-brief.json'));
  const sourceImages = (assetSet.assets || [])
    .filter((asset) => asset.media_type === 'image')
    .map((asset) => asset.path)
    .filter(Boolean);
  if (!sourceImages.length) {
    for (const asset of assetSet.assets || []) {
      if (asset.path) sourceImages.push(asset.path);
    }
  }
  const selectedProfile = assetSet.profile_routing?.selected_profile || modelingBrief?.profile_id || 'unknown_object';
  const sampleId = slugify([
    assetSet.profile_routing?.object_name,
    assetSet.id,
    'real-building-draft'
  ].find((value) => typeof value === 'string' && value.trim().length > 0));
  return {
    sampleId,
    sourceImages,
    sourceAssetKind: sourceAssetKindForAssets(assetSet.assets || []),
    profilePath: PROFILE_PATH_BY_INTAKE_PROFILE[selectedProfile] || null,
    artifacts: inferArtifactsFromIntakeDir(intakeDir, resolvedIntakeDir)
  };
}

function inferArtifactsFromIntakeDir(intakeDir, resolvedIntakeDir) {
  const artifacts = {};
  for (const [key, fileNames] of Object.entries(INTAKE_ARTIFACT_CANDIDATES)) {
    let selected = fileNames[0];
    let selectedExists = false;
    for (const fileName of fileNames) {
      if (pathExistsSync(path.join(resolvedIntakeDir, fileName))) {
        selected = fileName;
        selectedExists = true;
        break;
      }
    }
    if (!REQUIRED_INTAKE_ARTIFACT_KEYS.has(key) && !selectedExists) continue;
    artifacts[key] = path.posix.join(toPosixPath(intakeDir), selected);
  }
  return artifacts;
}

function sourceAssetKindForAssets(assets) {
  const mediaTypes = new Set(assets.map((asset) => asset.media_type));
  if (mediaTypes.has('cad') || mediaTypes.has('pdf')) return 'user_uploaded_real_building_asset';
  return 'real_building_photo_or_scan';
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function pathExistsSync(filePath) {
  try {
    fsSync.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function slugify(value) {
  return String(value || 'real-building-draft')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'real-building-draft';
}
