import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { compilePartGraphToSketchUpDsl } from '../../../../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphPhysicalConsistency } from '../../../../src/product-modeling/physical-consistency-qa.mjs';
import { repoRoot } from './image-analysis.mjs';

export const DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST = 'projects/image-structured-modeler/examples/real-world-building-positive/manifest.json';
export const REAL_WORLD_BUILDING_RELEASE_GAP = 'real_world_building_positive_release_sample_missing';

const BUILDING_SINGLE_PROFILE = 'examples/product-profiles/building_single_urban_oblique.json';
const BUILDING_GROUP_PROFILE = 'examples/product-profiles/building_group_industrial_campus.json';
const REAL_BUILDING_ASSET_KINDS = [
  'real_building_photo',
  'real_building_scan',
  'real_building_photo_or_scan',
  'user_uploaded_real_building_asset'
];
const REQUIRED_ARTIFACTS = [
  'part_graph',
  'output',
  'photo_grade_readiness_report'
];
const REQUIRED_VISION_EVIDENCE_ARTIFACTS = [
  'vision_evidence_report',
  'vision_evidence_review_patch',
  'vision_evidence_review_decision',
  'vision_evidence_policy_correction_patch'
];
const OPTIONAL_QA_ARTIFACTS = [
  'geometry_fit_report',
  'grounding_v3_report',
  'layout_qa_report',
  'reference_qa_report',
  'proposal_qa_report',
  'queue_proposal_qa_report'
];
const GENERATED_SOURCE_PATH_MARKERS = [
  'chatgpt image',
  'building-single-anime-yellow',
  'input-visible-crop',
  'building-real-photo-smoke',
  'manual-top-reference',
  'manual-oblique-reference',
  'generated',
  'scaffold',
  'screenshot',
  'screen shot',
  '\u622a\u5c4f',
  '\u622a\u56fe',
  '\u5c0f\u7ea2\u4e66\u7f51\u9875\u7248'
];

export function buildRealWorldBuildingPositiveManifest({
  sampleId,
  sourceImages,
  inputAssetStatus = 'available',
  sourceAuthenticity = 'real_user_provided',
  sourceAssetKind = 'real_building_photo_or_scan',
  profilePath,
  artifacts,
  review
} = {}) {
  assertTruthy(typeof sampleId === 'string' && sampleId.length > 0, 'real-world building manifest sampleId is required');
  const normalizedSourceImages = normalizeStringArray(sourceImages);
  assertTruthy(normalizedSourceImages.length > 0, 'real-world building manifest sourceImages must contain at least one source asset');
  assertEqual(inputAssetStatus, 'available', 'real-world building manifest input asset status must be available');
  assertEqual(sourceAuthenticity, 'real_user_provided', 'real-world building manifest source authenticity must be real_user_provided');
  assertIncludes(REAL_BUILDING_ASSET_KINDS, sourceAssetKind, 'real-world building manifest source asset kind must be supported');

  const normalizedArtifacts = normalizeArtifacts(artifacts);
  assertTruthy(normalizedArtifacts.part_graph, 'real-world building manifest artifacts.part_graph is required');
  assertTruthy(normalizedArtifacts.output, 'real-world building manifest artifacts.output is required');
  assertTruthy(normalizedArtifacts.photo_grade_readiness_report, 'real-world building manifest artifacts.photo_grade_readiness_report is required');
  assertTruthy(normalizedArtifacts.vision_evidence_report, 'real-world building manifest artifacts.vision_evidence_report is required');
  assertTruthy(normalizedArtifacts.vision_evidence_review_patch, 'real-world building manifest artifacts.vision_evidence_review_patch is required');
  assertTruthy(normalizedArtifacts.vision_evidence_review_decision, 'real-world building manifest artifacts.vision_evidence_review_decision is required');
  assertTruthy(normalizedArtifacts.vision_evidence_policy_correction_patch, 'real-world building manifest artifacts.vision_evidence_policy_correction_patch is required');

  const manifest = {
    version: 1,
    kind: 'real_world_building_positive_release_sample_manifest',
    sample_id: sampleId,
    sample_scope: 'real_world_building_positive',
    input_asset_status: inputAssetStatus,
    source_authenticity: sourceAuthenticity,
    source_asset_kind: sourceAssetKind,
    source_images: normalizedSourceImages,
    artifacts: normalizedArtifacts
  };
  if (profilePath) manifest.profile_path = profilePath;

  const normalizedReview = normalizeReview(review);
  if (Object.keys(normalizedReview).length > 0) manifest.review = normalizedReview;
  return manifest;
}

export async function buildRealWorldBuildingPositiveReleaseChecklist({
  manifest,
  manifestPath = DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  releaseManifestPath = DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST
} = {}) {
  assertTruthy(manifest && typeof manifest === 'object', 'real-world building checklist manifest is required');
  const checks = [];
  const sourceImages = Array.isArray(manifest.source_images) ? manifest.source_images : [];
  const sourceItems = await Promise.all(sourceImages.map(async (sourceImage) => {
    const markers = generatedSourcePathMarkers(sourceImage);
    const exists = typeof sourceImage === 'string' && sourceImage.length > 0
      ? await pathExists(resolveRepo(sourceImage))
      : false;
    const contentSha256 = exists ? await contentHash(resolveRepo(sourceImage)) : null;
    return {
      path: sourceImage || '',
      status: exists && markers.length === 0 ? 'pass' : 'fail',
      exists,
      content_sha256: contentSha256,
      generated_path_blocker: markers.length > 0,
      duplicate_content_blocker: false,
      blockers: markers
    };
  }));
  const duplicateSourceContentGroups = duplicateSourceContentGroupsForItems(sourceItems);
  const duplicatedSourcePaths = new Set(duplicateSourceContentGroups.flatMap((group) => group.paths));
  for (const item of sourceItems) {
    if (duplicatedSourcePaths.has(item.path)) {
      item.status = 'fail';
      item.duplicate_content_blocker = true;
      item.blockers = Array.from(new Set([...(item.blockers || []), 'duplicate_source_asset_content']));
    }
  }
  const sourceStatus = sourceItems.length > 0 && sourceItems.every((item) => item.status === 'pass') ? 'pass' : 'fail';
  checks.push({
    id: 'source_assets',
    label: 'Real source building assets',
    required: true,
    status: sourceStatus,
    message: sourceStatus === 'pass'
      ? 'All listed source assets exist, are distinct, and do not look like generated/scaffold paths.'
      : 'Source images must exist, be distinct files, and be real user-provided building photos or scans.',
    items: sourceItems,
    duplicate_content_groups: duplicateSourceContentGroups
  });

  const assetKindOk = REAL_BUILDING_ASSET_KINDS.includes(manifest.source_asset_kind);
  checks.push({
    id: 'source_authenticity',
    label: 'Source authenticity contract',
    required: true,
    status: manifest.source_authenticity === 'real_user_provided' && assetKindOk ? 'pass' : 'fail',
    message: 'Manifest must declare real_user_provided source authenticity and a supported real-building asset kind.'
  });

  const artifactItems = [];
  for (const key of REQUIRED_ARTIFACTS) {
    const artifactPath = manifest.artifacts?.[key] || '';
    const exists = artifactPath.length > 0 && await pathExists(resolveRepo(artifactPath));
    artifactItems.push({
      role: key,
      path: artifactPath,
      required: true,
      exists,
      status: exists ? 'pass' : 'fail'
    });
  }
  for (const key of OPTIONAL_QA_ARTIFACTS) {
    const artifactPath = manifest.artifacts?.[key] || '';
    if (!artifactPath) continue;
    const exists = await pathExists(resolveRepo(artifactPath));
    artifactItems.push({
      role: key,
      path: artifactPath,
      required: false,
      exists,
      status: exists ? 'pass' : 'fail'
    });
  }
  const artifactStatus = artifactItems
    .filter((item) => item.required || item.path)
    .every((item) => item.status === 'pass')
    ? 'pass'
    : 'fail';
  checks.push({
    id: 'artifacts',
    label: 'Compiled model artifacts and QA reports',
    required: true,
    status: artifactStatus,
    message: artifactStatus === 'pass'
      ? 'Required PartGraph, output DSL, and PhotoGradeReadiness report paths exist.'
      : 'Required PartGraph, output DSL, and PhotoGradeReadiness report paths must exist before promotion.',
    items: artifactItems
  });

  checks.push(await buildPhotoGradeReadinessCheck(manifest.artifacts?.photo_grade_readiness_report));
  checks.push(await buildVisionEvidenceReviewCheck(manifest.artifacts || {}));

  const review = manifest.review || {};
  const reviewPresent = ['reviewer', 'accepted_at', 'notes']
    .every((key) => typeof review[key] === 'string' && review[key].trim().length > 0);
  checks.push({
    id: 'human_review',
    label: 'Human release review',
    required: true,
    status: reviewPresent ? 'pass' : 'fail',
    message: reviewPresent
      ? 'Reviewer, accepted_at, and notes are present.'
      : 'Reviewer, accepted_at, and notes must be filled before this can become the release manifest.'
  });

  const releaseTarget = normalizePathForCompare(manifestPath) === normalizePathForCompare(releaseManifestPath);
  checks.push({
    id: 'release_manifest_target',
    label: 'Formal release manifest target',
    required: false,
    status: releaseTarget ? 'pass' : 'review',
    message: releaseTarget
      ? 'Checklist was generated for the formal release manifest path.'
      : `Draft is not yet written to ${releaseManifestPath}; promote only after all required checks pass.`
  });

  const blockers = checks
    .filter((check) => check.required && check.status === 'fail')
    .map((check) => check.id);
  const releaseReady = blockers.length === 0;
  return {
    version: 1,
    kind: 'real_world_building_positive_release_checklist',
    manifest: manifestPath,
    release_manifest: releaseManifestPath,
    sample_id: manifest.sample_id || 'missing_sample_id',
    release_ready: releaseReady,
    can_promote_to_release_manifest: releaseReady,
    checks,
    blockers,
    commands: {
      validate_draft: `npm run image-structured:validate-real-world-building -- --manifest ${cliArg(manifestPath)} --output-dir output/image-structured-modeler/real-world-building-positive-manifest/draft-validation --require-present`,
      validate_release_manifest: 'npm run image-structured:validate-real-world-building -- --require-present',
      run_release_gate: 'npm run image-structured:release-gate -- --output-dir output/image-structured-modeler/release-gate'
    },
    next_actions: releaseReady
      ? nextActionsForReadyChecklist({ manifestPath, releaseManifestPath })
      : nextActionsForBlockedChecklist(blockers)
  };
}

export function renderRealWorldBuildingPositiveReleaseChecklistMarkdown(checklist) {
  const lines = [
    '# Real-World Building Positive Release Checklist',
    '',
    `- Sample: \`${checklist.sample_id}\``,
    `- Manifest: \`${checklist.manifest}\``,
    `- Release ready: \`${String(checklist.release_ready)}\``,
    `- Can promote to release manifest: \`${String(checklist.can_promote_to_release_manifest)}\``,
    ''
  ];
  if (checklist.blockers.length > 0) {
    lines.push(`Blockers: \`${checklist.blockers.join('`, `')}\``, '');
  }
  lines.push('| Check | Required | Status | Message |');
  lines.push('| --- | --- | --- | --- |');
  for (const check of checklist.checks) {
    lines.push(`| ${escapeMarkdownTable(check.label)} | ${check.required ? 'yes' : 'no'} | ${check.status} | ${escapeMarkdownTable(check.message || '')} |`);
  }
  lines.push('');
  for (const check of checklist.checks.filter((item) => Array.isArray(item.items) && item.items.length > 0)) {
    lines.push(`## ${check.label}`);
    for (const item of check.items) {
      const role = item.role ? `${item.role}: ` : '';
      const pathValue = item.path || '(missing)';
      const generated = item.generated_path_blocker ? '; generated/scaffold path blocker' : '';
      const duplicate = item.duplicate_content_blocker ? '; duplicate content blocker' : '';
      const exists = item.exists === undefined ? '' : `; exists=${String(item.exists)}`;
      lines.push(`- ${item.status}: ${role}\`${pathValue}\`${exists}${generated}${duplicate}`);
    }
    lines.push('');
  }
  lines.push('## Commands');
  lines.push(`- Validate draft: \`${checklist.commands.validate_draft}\``);
  lines.push(`- Validate release manifest: \`${checklist.commands.validate_release_manifest}\``);
  lines.push(`- Release gate: \`${checklist.commands.run_release_gate}\``);
  lines.push('');
  lines.push('## Next Actions');
  for (const action of checklist.next_actions) {
    lines.push(`- ${action}`);
  }
  return `${lines.join('\n')}\n`;
}

export function buildRealWorldBuildingReleaseWorkOrder({
  manifest,
  checklist,
  manifestPath = DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  releaseManifestPath = DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST
} = {}) {
  assertTruthy(manifest && typeof manifest === 'object', 'real-world building release work order manifest is required');
  assertTruthy(checklist && typeof checklist === 'object', 'real-world building release work order checklist is required');
  const taskById = new Map((checklist.checks || []).map((check) => [check.id, check]));
  const artifactCheck = taskById.get('artifacts') || {};
  const artifactItems = artifactCheck.items || [];
  const artifactItemByRole = new Map(artifactItems.map((item) => [item.role, item]));
  const profilePath = manifest.profile_path || inferProfilePathFromArtifacts(manifest.artifacts);
	  const tasks = [
    sourceTaskFromChecklist(taskById.get('source_assets')),
    sourceAuthenticityTaskFromChecklist(taskById.get('source_authenticity')),
    artifactTask({
      id: 'part_graph',
      label: 'Reviewed PartGraph artifact',
      role: 'part_graph',
      manifest,
      artifactItemByRole,
      command: null,
      instructions: [
        'Export a candidate-promoted PartGraph from accepted review/promotion artifacts.',
        'Keep all geometry source provenance aligned with manifest.source_images.'
      ]
    }),
    artifactTask({
      id: 'compiled_output',
      label: 'Compiler-fresh SketchUp DSL output',
      role: 'output',
      manifest,
      artifactItemByRole,
      command: manifest.artifacts?.part_graph && manifest.artifacts?.output && profilePath
        ? `node scripts/compile-part-graph-to-sketchup-dsl.mjs --profile ${cliArg(profilePath)} --part-graph ${cliArg(manifest.artifacts.part_graph)} --output ${cliArg(manifest.artifacts.output)}`
        : null,
      instructions: [
        'Compile the reviewed PartGraph with the current PartGraph compiler.',
        'The stored output must match a fresh compiler run during validation.'
      ]
    }),
    artifactTask({
      id: 'photo_grade_readiness',
      label: 'PhotoGradeReadiness report',
      role: 'photo_grade_readiness_report',
      manifest,
      artifactItemByRole,
      command: null,
      instructions: [
        'Run the appropriate PhotoGradeReadiness workflow for this building sample.',
        'Resolve review_required or input-asset blockers before release promotion.'
      ],
      checklistCheck: taskById.get('photo_grade_readiness')
    }),
    visionEvidenceReviewTaskFromChecklist(taskById.get('vision_evidence_review'), manifest),
    optionalArtifactTask({
      id: 'optional_qa_reports',
      label: 'Optional QA reports',
      roles: OPTIONAL_QA_ARTIFACTS,
      manifest,
      artifactItemByRole
    }),
    humanReviewTaskFromChecklist(taskById.get('human_review'), manifest),
    {
      id: 'validate_release_draft',
      label: 'Validate release draft',
      required: true,
      status: checklist.release_ready ? 'pass' : 'blocked',
      blockers: checklist.blockers || [],
      command: checklist.commands?.validate_draft || `npm run image-structured:validate-real-world-building -- --manifest ${cliArg(manifestPath)} --output-dir output/image-structured-modeler/real-world-building-positive-manifest/draft-validation --require-present`,
      instructions: ['Run after source assets, release artifacts, VisionEvidence review, PhotoGradeReadiness, and human review are complete.']
    },
    {
      id: 'promote_formal_manifest',
      label: 'Promote formal release manifest',
      required: true,
      status: checklist.can_promote_to_release_manifest ? 'pass' : 'blocked',
      blockers: checklist.blockers || [],
      command: `npm run image-structured:prepare-real-world-building -- --manifest-output ${cliArg(releaseManifestPath)} --sample-id ${cliArg(manifest.sample_id || 'real-building-sample')} ${manifest.source_images.map((sourceImage) => `--source-image ${cliArg(sourceImage)}`).join(' ')} ${manifest.profile_path ? `--profile ${cliArg(manifest.profile_path)}` : ''} --part-graph ${cliArg(manifest.artifacts?.part_graph || 'path/to/part-graph.json')} --compiled-output ${cliArg(manifest.artifacts?.output || 'path/to/output.json')} --photo-grade-readiness-report ${cliArg(manifest.artifacts?.photo_grade_readiness_report || 'path/to/photo-grade-readiness-report.json')} --vision-evidence-report ${cliArg(manifest.artifacts?.vision_evidence_report || 'path/to/vision-evidence-v1-report.json')} --vision-evidence-review-patch ${cliArg(manifest.artifacts?.vision_evidence_review_patch || 'path/to/vision-evidence-review-patch.json')} --vision-evidence-review-decision ${cliArg(manifest.artifacts?.vision_evidence_review_decision || 'path/to/vision-evidence-review.accepted.json')} --vision-evidence-policy-correction-patch ${cliArg(manifest.artifacts?.vision_evidence_policy_correction_patch || 'path/to/vision-evidence-policy-correction-patch.json')}`.replace(/\s+/g, ' ').trim(),
      instructions: ['Only run against the formal manifest path after every required task is pass.']
    }
  ];
  const requiredTasks = tasks.filter((task) => task.required !== false);
  const blockedRequiredTasks = requiredTasks.filter((task) => task.status !== 'pass');
  const status = checklist.can_promote_to_release_manifest === true
    ? 'ready_for_formal_manifest'
    : blockedRequiredTasks.some((task) => ['source_assets', 'source_authenticity'].includes(task.id))
      ? 'blocked_needs_source_assets'
      : blockedRequiredTasks.some((task) => ['part_graph', 'compiled_output', 'photo_grade_readiness', 'vision_evidence_review'].includes(task.id))
        ? 'needs_release_artifacts'
        : blockedRequiredTasks.some((task) => task.id === 'human_review')
          ? 'needs_human_review'
          : 'blocked_release_validation';
  return {
    version: 1,
    kind: 'real_world_building_release_work_order',
    manifest: manifestPath,
    release_manifest: releaseManifestPath,
    sample_id: manifest.sample_id || 'missing_sample_id',
    status,
    release_ready: checklist.release_ready === true,
    can_promote_to_release_manifest: checklist.can_promote_to_release_manifest === true,
    blockers: checklist.blockers || [],
    artifact_authoring_policy: releaseWorkOrderArtifactAuthoringPolicy(),
    required_task_count: requiredTasks.length,
    blocked_required_task_count: blockedRequiredTasks.length,
    tasks,
    commands: {
      validate_draft: checklist.commands?.validate_draft || null,
      validate_release_manifest: checklist.commands?.validate_release_manifest || 'npm run image-structured:validate-real-world-building -- --require-present',
      run_release_gate: checklist.commands?.run_release_gate || 'npm run image-structured:release-gate -- --output-dir output/image-structured-modeler/release-gate'
    },
    next_actions: releaseWorkOrderNextActions({ status, tasks, checklist })
  };
}

function releaseWorkOrderArtifactAuthoringPolicy() {
  return {
    direct_sketchup_dsl_allowed: false,
    promoted_geometry_requires_review: true,
    vision_evidence_policy_review_required: true,
    semantic_evidence_quality_source: 'source_request_or_mcp_brief_or_release_artifact_workspace',
    required_contract_artifacts: [
      'real-world-building-source-request.json',
      'mcp-modeling-brief.json',
      'vision-evidence-review-patch.json',
      'release-artifact-workspace.json'
    ],
    blocked_outputs_until_policy_satisfied: [
      'direct_sketchup_dsl',
      'promoted_part_graph_geometry_without_review',
      'formal_release_manifest'
    ],
    instructions: [
      'Read semantic_evidence_quality from source request, MCP brief, or release artifact workspace before authoring PartGraph geometry.',
      'Do not use release work-order task labels as geometry evidence.',
      'Use release-artifact-workspace task_packets for MCP/modeling artifact authoring constraints.'
    ]
  };
}

export function renderRealWorldBuildingReleaseWorkOrderMarkdown(workOrder) {
  const lines = [
    '# Real-World Building Release Work Order',
    '',
    `- Sample: \`${workOrder.sample_id}\``,
    `- Status: \`${workOrder.status}\``,
    `- Manifest: \`${workOrder.manifest}\``,
    `- Release ready: \`${String(workOrder.release_ready)}\``,
    `- Can promote to release manifest: \`${String(workOrder.can_promote_to_release_manifest)}\``,
    `- Blockers: \`${workOrder.blockers.join('`, `') || 'none'}\``,
    `- Direct SketchUp DSL allowed: \`${String(workOrder.artifact_authoring_policy?.direct_sketchup_dsl_allowed === true)}\``,
    `- Semantic evidence quality source: \`${workOrder.artifact_authoring_policy?.semantic_evidence_quality_source || 'none'}\``,
    '',
    '| Task | Required | Status | Command |',
    '| --- | --- | --- | --- |'
  ];
  for (const task of workOrder.tasks) {
    lines.push(`| ${escapeMarkdownTable(task.label)} | ${task.required === false ? 'no' : 'yes'} | ${task.status} | ${escapeMarkdownTable(task.command || '')} |`);
  }
  lines.push('');
  for (const task of workOrder.tasks) {
    lines.push(`## ${task.label}`);
    lines.push(`- Task id: \`${task.id}\``);
    lines.push(`- Status: \`${task.status}\``);
    if (task.artifact_role) lines.push(`- Artifact role: \`${task.artifact_role}\``);
    if (task.artifact_path) lines.push(`- Artifact path: \`${task.artifact_path}\``);
    if (task.blockers?.length) lines.push(`- Blockers: \`${task.blockers.join('`, `')}\``);
    if (task.command) lines.push(`- Command: \`${task.command}\``);
    for (const instruction of task.instructions || []) lines.push(`- ${instruction}`);
    lines.push('');
  }
  if (workOrder.artifact_authoring_policy) {
    lines.push('## Artifact Authoring Policy');
    lines.push(`- Direct SketchUp DSL allowed: \`${String(workOrder.artifact_authoring_policy.direct_sketchup_dsl_allowed === true)}\``);
    lines.push(`- Promoted geometry requires review: \`${String(workOrder.artifact_authoring_policy.promoted_geometry_requires_review === true)}\``);
    lines.push(`- VisionEvidence policy review required: \`${String(workOrder.artifact_authoring_policy.vision_evidence_policy_review_required === true)}\``);
    lines.push(`- Semantic evidence quality source: \`${workOrder.artifact_authoring_policy.semantic_evidence_quality_source}\``);
    lines.push(`- Blocked outputs: \`${(workOrder.artifact_authoring_policy.blocked_outputs_until_policy_satisfied || []).join('`, `') || 'none'}\``);
    for (const instruction of workOrder.artifact_authoring_policy.instructions || []) lines.push(`- ${instruction}`);
    lines.push('');
  }
  lines.push('## Commands');
  lines.push(`- Validate draft: \`${workOrder.commands.validate_draft || 'none'}\``);
  lines.push(`- Validate release manifest: \`${workOrder.commands.validate_release_manifest}\``);
  lines.push(`- Release gate: \`${workOrder.commands.run_release_gate}\``);
  lines.push('');
  lines.push('## Next Actions');
  for (const action of workOrder.next_actions) lines.push(`- ${action}`);
  return `${lines.join('\n')}\n`;
}

export async function validateRealWorldBuildingPositiveManifestPath({
  manifestPath = DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  outputDir = 'output/image-structured-modeler/real-world-building-positive-manifest',
  allowMissing = true
} = {}) {
  const absoluteOutputDir = resolveRepo(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const absoluteManifestPath = resolveRepo(manifestPath);
  if (!await pathExists(absoluteManifestPath)) {
    const summary = missingManifestSummary(manifestPath);
    await writeJson(path.join(absoluteOutputDir, 'manifest-contract-summary.json'), summary);
    return {
      ok: allowMissing,
      status: 'manifest_missing_release_gap_recorded',
      metrics: {
        manifest_present: false,
        closes_release_gap: false,
        release_gap: REAL_WORLD_BUILDING_RELEASE_GAP
      },
      summary
    };
  }
  const manifest = await readJson(absoluteManifestPath);
  const checklist = await buildRealWorldBuildingPositiveReleaseChecklist({ manifest, manifestPath });
  await writeJson(path.join(absoluteOutputDir, 'release-checklist.json'), checklist);
  await fs.writeFile(path.join(absoluteOutputDir, 'release-checklist.md'), renderRealWorldBuildingPositiveReleaseChecklistMarkdown(checklist), 'utf8');
  let validation;
  try {
    validation = await validateRealWorldBuildingPositiveManifest({
      manifest,
      manifestPath,
      outputDir: absoluteOutputDir
    });
  } catch (error) {
    const summary = invalidManifestSummary({
      manifestPath,
      manifest,
      checklist,
      error
    });
    await writeJson(path.join(absoluteOutputDir, 'manifest-contract-summary.json'), summary);
    return {
      ok: false,
      status: 'manifest_invalid_release_gap_recorded',
      metrics: summary.metrics,
      summary,
      checklist,
      error: error.message
    };
  }
  validation.metrics.release_checklist_ready = checklist.release_ready;
  validation.metrics.release_checklist_blockers = checklist.blockers.length;
  validation.summary.qa.release_checklist = checklist.release_ready ? 'pass' : 'fail';
  await writeJson(path.join(absoluteOutputDir, 'manifest-contract-summary.json'), validation.summary);
  return {
    ok: true,
    status: 'real_world_building_positive_pass',
    checklist,
    ...validation
  };
}

export async function validateRealWorldBuildingPositiveManifest({ manifest, manifestPath, outputDir }) {
  assertEqual(manifest.version, 1, 'real-world building manifest version must be 1');
  assertEqual(manifest.kind, 'real_world_building_positive_release_sample_manifest', 'real-world building manifest kind must match');
  assertEqual(manifest.sample_scope, 'real_world_building_positive', 'real-world building manifest must declare building-positive scope');
  assertEqual(manifest.input_asset_status, 'available', 'real-world building manifest must use available source assets');
  assertEqual(manifest.source_authenticity, 'real_user_provided', 'real-world building manifest must declare real user-provided source authenticity');
  assertIncludes(REAL_BUILDING_ASSET_KINDS, manifest.source_asset_kind, 'real-world building manifest must declare a real building asset kind');
  assertTruthy(Array.isArray(manifest.source_images) && manifest.source_images.length >= 1, 'real-world building manifest must list source images/assets');
  for (const sourceImage of manifest.source_images) {
    assertTruthy(typeof sourceImage === 'string' && sourceImage.length > 0, 'real-world building source image path must be a non-empty string');
    assertNoGeneratedSourcePath(sourceImage, 'real-world building source image must not be a generated/scaffold asset');
    assertTruthy(await pathExists(resolveRepo(sourceImage)), `real-world building source image must exist: ${sourceImage}`);
  }
  await assertDistinctSourceImages(manifest.source_images, 'real-world building source images must not contain duplicate file content');
  assertTruthy(manifest.artifacts?.part_graph, 'real-world building manifest must point at a PartGraph artifact');
  assertTruthy(manifest.artifacts?.output, 'real-world building manifest must point at a compiled DSL output artifact');
  assertTruthy(manifest.artifacts?.photo_grade_readiness_report, 'real-world building manifest must include PhotoGradeReadiness artifact');
  assertTruthy(manifest.artifacts?.vision_evidence_report, 'real-world building manifest must include VisionEvidence report artifact');
  assertTruthy(manifest.artifacts?.vision_evidence_review_patch, 'real-world building manifest must include VisionEvidence review patch artifact');
  assertTruthy(manifest.artifacts?.vision_evidence_review_decision, 'real-world building manifest must include VisionEvidence review decision artifact');
  assertTruthy(manifest.artifacts?.vision_evidence_policy_correction_patch, 'real-world building manifest must include VisionEvidence policy correction patch artifact');
  assertTruthy(
    typeof manifest.review?.reviewer === 'string'
      && manifest.review.reviewer.trim().length > 0
      && typeof manifest.review?.accepted_at === 'string'
      && manifest.review.accepted_at.trim().length > 0
      && typeof manifest.review?.notes === 'string'
      && manifest.review.notes.trim().length > 0,
    'real-world building manifest must include reviewer, accepted_at, and notes after human review'
  );

  const partGraph = await readJson(resolveRepo(manifest.artifacts.part_graph));
  const storedOutput = await readJson(resolveRepo(manifest.artifacts.output));
  const profile = await profileForReleaseManifest(manifest, partGraph);
  const compiledOutput = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  const physicalQa = validatePartGraphPhysicalConsistency(partGraph);
  const readiness = await readJson(resolveRepo(manifest.artifacts.photo_grade_readiness_report));
  const visionEvidenceReviewCheck = await buildVisionEvidenceReviewCheck(manifest.artifacts || {});
  const sourceImages = sourceImagesForPartGraph(partGraph);
  await writeJson(path.join(outputDir, 'compiled-output.json'), compiledOutput);
  await writeJson(path.join(outputDir, 'physical-consistency-report.json'), physicalQa);

  assertTruthy((partGraph.parts || []).length > 0, 'real-world building PartGraph must contain parts');
  assertTruthy(['building_single_urban_oblique', 'building_group_industrial_campus'].includes(partGraph.profile_id), 'real-world building PartGraph must use a supported building profile');
  assertTruthy((partGraph.parts || []).some((part) => part.evidence_status === 'manual_confirmed' || part.grounding_decision === 'promoted_geometry'), 'real-world building PartGraph must contain confirmed/promoted geometry evidence');
  assertEqual(JSON.stringify(compiledOutput), JSON.stringify(storedOutput), 'real-world building output must match current compiler output');
  assertEqual(physicalQa.verdict, 'pass', 'real-world building physical consistency must pass');
  assertEqual(readiness.kind, 'photo_grade_readiness_qa', 'real-world building readiness report kind must match');
  assertEqual(readiness.ok, true, 'real-world building readiness report must be ok');
  assertIncludes(['technical_baseline', 'candidate'], readiness.photo_grade_readiness, 'real-world building readiness must be technical baseline or candidate');
  assertEqual(readiness.sample?.input_asset_status, 'available', 'real-world building readiness must use available input assets');
  assertEqual(readiness.photo_grade_readiness === 'review_required', false, 'real-world building readiness must not be review_required');
  assertEqual(readiness.blockers?.some((blocker) => blocker.gate === 'input_asset'), false, 'real-world building readiness must not have input-asset blockers');
  assertEqual(visionEvidenceReviewCheck.status, 'pass', 'real-world building VisionEvidence review artifacts must pass policy review checks');
  assertTruthy(sourceImages.length > 0, 'real-world building PartGraph must list source image provenance');
  for (const sourceImage of sourceImages) {
    assertNoGeneratedSourcePath(sourceImage, 'real-world building PartGraph source image must not be generated/scaffold');
  }
  assertManifestSourceImagesCoverPartGraph({
    manifestSourceImages: manifest.source_images,
    partGraphSourceImages: sourceImages
  });
  await assertOptionalQaArtifactPass(manifest.artifacts.geometry_fit_report, 'real-world building GeometryFit');
  await assertOptionalQaArtifactPass(manifest.artifacts.grounding_v3_report, 'real-world building Grounding v3');
  await assertOptionalQaArtifactPass(manifest.artifacts.layout_qa_report, 'real-world building layout QA');
  await assertOptionalQaArtifactPass(manifest.artifacts.reference_qa_report, 'real-world building reference QA');
  await assertOptionalQaArtifactPass(manifest.artifacts.proposal_qa_report, 'real-world building proposal QA');
  await assertOptionalQaArtifactPass(manifest.artifacts.queue_proposal_qa_report, 'real-world building queue proposal QA');

  const metrics = {
    manifest_present: true,
    closes_release_gap: true,
    sample_id: manifest.sample_id,
    sample_scope: manifest.sample_scope,
    source_asset_kind: manifest.source_asset_kind,
    source_authenticity: manifest.source_authenticity,
    source_images: manifest.source_images.length,
    source_images_align_with_part_graph: true,
    profile_id: partGraph.profile_id,
    parts: partGraph.parts.length,
    part_graph_source_images: sourceImages.length,
    operations: compiledOutput.operations?.length || 0,
    physical_verdict: physicalQa.verdict,
    photo_grade_readiness: readiness.photo_grade_readiness,
    photo_grade_candidate: readiness.photo_grade_candidate === true,
    vision_evidence_review_items: visionEvidenceReviewCheck.metrics?.review_items || 0,
    vision_evidence_policy_actions: visionEvidenceReviewCheck.metrics?.policy_actions || 0,
    compiled_matches_output: true
  };
  return {
    metrics,
    summary: {
      version: 1,
      kind: 'real_world_building_positive_manifest_contract_summary',
      manifest: manifestPath,
      manifest_present: true,
      closes_release_gap: true,
      sample_id: manifest.sample_id,
      sample_scope: manifest.sample_scope,
      source_images: manifest.source_images,
      part_graph_source_images: sourceImages,
      source_asset_kind: manifest.source_asset_kind,
      source_authenticity: manifest.source_authenticity,
      artifacts: manifest.artifacts,
      qa: {
        compiled_matches_output: true,
        physical_consistency: physicalQa.verdict,
        photo_grade_readiness: readiness.photo_grade_readiness,
        photo_grade_candidate: readiness.photo_grade_candidate === true,
        vision_evidence_review: visionEvidenceReviewCheck.status,
        source_images_align_with_part_graph: true,
        release_checklist: 'pending'
      },
      metrics
    }
  };
}

export function missingManifestSummary(manifestPath = DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST) {
  return {
    version: 1,
    kind: 'real_world_building_positive_manifest_contract_summary',
    manifest: manifestPath,
    manifest_present: false,
    closes_release_gap: false,
    release_gap: REAL_WORLD_BUILDING_RELEASE_GAP,
    next_action: 'Add a manifest.json with real user-provided building source assets, compiled PartGraph output, and QA reports.'
  };
}

export function invalidManifestSummary({ manifestPath, manifest, checklist, error }) {
  return {
    version: 1,
    kind: 'real_world_building_positive_manifest_contract_summary',
    manifest: manifestPath,
    manifest_present: true,
    closes_release_gap: false,
    release_gap: REAL_WORLD_BUILDING_RELEASE_GAP,
    sample_id: manifest?.sample_id || 'unknown',
    sample_scope: manifest?.sample_scope || 'unknown',
    source_images: Array.isArray(manifest?.source_images) ? manifest.source_images : [],
    source_asset_kind: manifest?.source_asset_kind || 'unknown',
    source_authenticity: manifest?.source_authenticity || 'unknown',
    artifacts: manifest?.artifacts || {},
    error: error?.message || String(error),
    qa: {
      release_checklist: checklist?.release_ready ? 'pass' : 'fail'
    },
    metrics: {
      manifest_present: true,
      closes_release_gap: false,
      release_gap: REAL_WORLD_BUILDING_RELEASE_GAP,
      sample_id: manifest?.sample_id || 'unknown',
      release_checklist_ready: checklist?.release_ready === true,
      release_checklist_blockers: checklist?.blockers?.length || 0,
      release_checklist_blocker_ids: checklist?.blockers || []
    },
    next_action: 'Open release-checklist.md, resolve every required blocker, then rerun validate-real-world-building with --require-present.'
  };
}

function sourceTaskFromChecklist(check = {}) {
  return {
    id: 'source_assets',
    label: 'Real source building assets',
    required: true,
    status: check.status === 'pass' ? 'pass' : 'blocked',
    blockers: check.status === 'pass' ? [] : ['source_assets'],
    command: null,
    instructions: [
      'Use existing real user-provided building photos, scans, PDFs, or CAD sources.',
      'Do not use generated images, screenshots, scaffold assets, or duplicated source content.'
    ],
    items: check.items || []
  };
}

function sourceAuthenticityTaskFromChecklist(check = {}) {
  return {
    id: 'source_authenticity',
    label: 'Source authenticity declaration',
    required: true,
    status: check.status === 'pass' ? 'pass' : 'blocked',
    blockers: check.status === 'pass' ? [] : ['source_authenticity'],
    command: null,
    instructions: [
      'Manifest must declare source_authenticity=real_user_provided.',
      'Manifest source_asset_kind must be a supported real-building kind.'
    ]
  };
}

function artifactTask({
  id,
  label,
  role,
  manifest,
  artifactItemByRole,
  command,
  instructions,
  checklistCheck = null
}) {
  const item = artifactItemByRole.get(role);
  const artifactPath = manifest.artifacts?.[role] || item?.path || null;
  const artifactPass = item?.status === 'pass';
  const checklistPass = checklistCheck ? checklistCheck.status === 'pass' : true;
  return {
    id,
    label,
    required: true,
    status: artifactPass && checklistPass ? 'pass' : 'blocked',
    blockers: artifactPass && checklistPass ? [] : [id],
    artifact_role: role,
    artifact_path: artifactPath,
    artifact_exists: item?.exists === true,
    command,
    instructions
  };
}

function optionalArtifactTask({ id, label, roles, manifest, artifactItemByRole }) {
  const items = roles
    .filter((role) => manifest.artifacts?.[role] || artifactItemByRole.has(role))
    .map((role) => {
      const item = artifactItemByRole.get(role);
      return {
        role,
        path: manifest.artifacts?.[role] || item?.path || '',
        status: item?.status || 'missing',
        exists: item?.exists === true
      };
    });
  const failed = items.filter((item) => item.status !== 'pass');
  return {
    id,
    label,
    required: false,
    status: failed.length ? 'review' : 'pass',
    blockers: failed.map((item) => item.role),
    command: null,
    instructions: [
      'Optional QA reports are checked when declared in manifest.artifacts.',
      'Declared optional QA artifacts must exist and must not fail validation.'
    ],
    items
  };
}

function visionEvidenceReviewTaskFromChecklist(check = {}, manifest = {}) {
  const artifacts = manifest.artifacts || {};
  const policyPatchPath = artifacts.vision_evidence_policy_correction_patch || 'path/to/vision-evidence-policy-correction-patch.json';
  const reviewedSetPath = path.join(path.dirname(policyPatchPath), 'vision-evidence-v1.reviewed.json');
  const command = [
    'node projects/image-structured-modeler/scripts/build-vision-evidence-policy-correction-patch.mjs',
    '--review-patch',
    cliArg(artifacts.vision_evidence_review_patch || 'path/to/vision-evidence-review-patch.json'),
    '--decision',
    cliArg(artifacts.vision_evidence_review_decision || 'path/to/vision-evidence-review.accepted.json'),
    '--output',
    cliArg(policyPatchPath),
    '--markdown-output',
    cliArg(policyPatchPath.replace(/\.json$/u, '.md')),
    '--vision-evidence-set',
    cliArg(artifacts.vision_evidence_report || 'path/to/vision-evidence-v1-report.json'),
    '--updated-vision-evidence-set',
    cliArg(reviewedSetPath)
  ].join(' ');
  return {
    id: 'vision_evidence_review',
    label: 'VisionEvidence policy review',
    required: true,
    status: check.status === 'pass' ? 'pass' : 'blocked',
    blockers: check.status === 'pass' ? [] : ['vision_evidence_review'],
    command,
    instructions: [
      'Open the VisionEvidence review workbench and export an accepted review decision.',
      'Build the VisionEvidence policy correction patch from that decision.',
      'Keep compile_allowed=false and geometry_promotion_allowed=false in every VisionEvidence review artifact.'
    ],
    artifacts: REQUIRED_VISION_EVIDENCE_ARTIFACTS.map((role) => ({
      role,
      path: manifest.artifacts?.[role] || '',
      exists: (check.items || []).find((item) => item.role === role)?.exists === true,
      status: (check.items || []).find((item) => item.role === role)?.status || 'missing'
    })),
    metrics: check.metrics || null
  };
}

function humanReviewTaskFromChecklist(check = {}, manifest = {}) {
  const review = manifest.review || {};
  return {
    id: 'human_review',
    label: 'Human release review',
    required: true,
    status: check.status === 'pass' ? 'pass' : 'blocked',
    blockers: check.status === 'pass' ? [] : ['human_review'],
    command: null,
    instructions: [
      'Open the review workbench and release checklist.',
      'Fill reviewer, accepted_at, and notes only after the visible model and evidence are accepted.'
    ],
    review: {
      reviewer_present: typeof review.reviewer === 'string' && review.reviewer.trim().length > 0,
      accepted_at_present: typeof review.accepted_at === 'string' && review.accepted_at.trim().length > 0,
      notes_present: typeof review.notes === 'string' && review.notes.trim().length > 0
    }
  };
}

function releaseWorkOrderNextActions({ status, tasks, checklist }) {
  if (status === 'ready_for_formal_manifest') {
    return [
      'Validate the formal release manifest.',
      'Run the release gate and confirm the real_world_building_positive_release_sample_missing gap is gone.'
    ];
  }
  const actions = [];
  for (const task of tasks.filter((item) => item.required !== false && item.status !== 'pass')) {
    if (task.command) actions.push(`Run: ${task.command}`);
    for (const instruction of task.instructions || []) actions.push(instruction);
  }
  actions.push(...(checklist.next_actions || []));
  return Array.from(new Set(actions));
}

function inferProfilePathFromArtifacts(artifacts = {}) {
  const partGraphPath = artifacts.part_graph || '';
  if (partGraphPath.includes('building-group')) return BUILDING_GROUP_PROFILE;
  return BUILDING_SINGLE_PROFILE;
}

async function profileForReleaseManifest(manifest, partGraph) {
  if (manifest.profile_path) return await readJson(resolveRepo(manifest.profile_path));
  if (partGraph.profile_id === 'building_group_industrial_campus') return await readJson(resolveRepo(BUILDING_GROUP_PROFILE));
  if (partGraph.profile_id === 'building_single_urban_oblique') return await readJson(resolveRepo(BUILDING_SINGLE_PROFILE));
  throw new Error(`Unsupported real-world building profile_id: ${partGraph.profile_id || 'missing'}`);
}

async function assertOptionalQaArtifactPass(relativePath, label) {
  if (!relativePath) return;
  const report = await readJson(resolveRepo(relativePath));
  if (report.ok !== undefined) assertEqual(report.ok, true, `${label} must be ok`);
  if (report.verdict) assertIncludes(['pass', 'technical_baseline', 'review'], report.verdict, `${label} verdict must not fail`);
  if (report.summary?.by_severity?.error !== undefined) assertEqual(report.summary.by_severity.error, 0, `${label} must not have error issues`);
  if (report.report?.summary?.by_severity?.error !== undefined) assertEqual(report.report.summary.by_severity.error, 0, `${label} diff report must not have error issues`);
  if (report.review_required !== undefined) assertEqual(report.review_required, false, `${label} must not require review`);
  if (report.compiled_matches_output !== undefined) assertEqual(report.compiled_matches_output, true, `${label} must verify compiler freshness`);
}

function sourceImagesForPartGraph(partGraph) {
  const sources = new Set();
  collectSourceImageReferences(partGraph.evidence_graph, sources);
  collectSourceImageReferences(partGraph.parts || [], sources);
  return Array.from(sources).filter(Boolean).sort();
}

function collectSourceImageReferences(value, sources) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceImageReferences(item, sources);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'source_image' && typeof item === 'string' && item.length > 0) {
      sources.add(item);
      continue;
    }
    if (key === 'source_images' && Array.isArray(item)) {
      for (const sourceImage of item) {
        if (typeof sourceImage === 'string' && sourceImage.length > 0) sources.add(sourceImage);
      }
      continue;
    }
    collectSourceImageReferences(item, sources);
  }
}

function assertManifestSourceImagesCoverPartGraph({ manifestSourceImages, partGraphSourceImages }) {
  const manifestSourceSet = new Set(manifestSourceImages.map(normalizeSourcePathForCompare));
  const missing = partGraphSourceImages.filter((sourceImage) => !manifestSourceSet.has(normalizeSourcePathForCompare(sourceImage)));
  if (missing.length > 0) {
    throw new Error(`real-world building PartGraph source images must be listed in manifest.source_images: missing ${missing.join(', ')}`);
  }
}

function normalizeSourcePathForCompare(sourcePath) {
  return normalizePathForCompare(path.relative(repoRoot, resolveRepo(sourcePath)));
}

function normalizeArtifacts(artifacts = {}) {
  const normalized = {};
  for (const key of [
    'part_graph',
    'output',
    'photo_grade_readiness_report',
    'vision_evidence_report',
    'vision_evidence_review_patch',
    'vision_evidence_review_decision',
    'vision_evidence_policy_correction_patch',
    'geometry_fit_report',
    'grounding_v3_report',
    'layout_qa_report',
    'reference_qa_report',
    'proposal_qa_report',
    'queue_proposal_qa_report'
  ]) {
    const value = artifacts[key];
    if (typeof value === 'string' && value.length > 0) normalized[key] = value;
  }
  return normalized;
}

function normalizeReview(review = {}) {
  const normalized = {};
  if (typeof review.reviewer === 'string' && review.reviewer.length > 0) normalized.reviewer = review.reviewer;
  const acceptedAt = review.accepted_at || review.acceptedAt;
  if (typeof acceptedAt === 'string' && acceptedAt.length > 0) normalized.accepted_at = acceptedAt;
  if (typeof review.notes === 'string' && review.notes.length > 0) normalized.notes = review.notes;
  return normalized;
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function assertNoGeneratedSourcePath(sourcePath, message) {
  const markers = generatedSourcePathMarkers(sourcePath);
  if (markers.length > 0) {
    throw new Error(`${message}: ${sourcePath}`);
  }
}

async function assertDistinctSourceImages(sourceImages, message) {
  const items = await Promise.all((sourceImages || []).map(async (sourceImage) => ({
    path: sourceImage,
    exists: await pathExists(resolveRepo(sourceImage)),
    content_sha256: await contentHash(resolveRepo(sourceImage))
  })));
  const duplicateGroups = duplicateSourceContentGroupsForItems(items);
  if (duplicateGroups.length > 0) {
    throw new Error(`${message}: ${duplicateGroups.map((group) => group.paths.join(' = ')).join('; ')}`);
  }
}

function duplicateSourceContentGroupsForItems(items) {
  const groups = new Map();
  for (const item of items || []) {
    if (!item.exists || !item.content_sha256) continue;
    if (!groups.has(item.content_sha256)) groups.set(item.content_sha256, []);
    groups.get(item.content_sha256).push(item);
  }
  return Array.from(groups.entries())
    .filter(([, groupItems]) => groupItems.length > 1)
    .map(([contentHashValue, groupItems]) => ({
      content_sha256: contentHashValue,
      paths: groupItems.map((item) => item.path).sort()
    }))
    .sort((a, b) => a.content_sha256.localeCompare(b.content_sha256));
}

async function contentHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function buildPhotoGradeReadinessCheck(readinessPath) {
  const missing = !readinessPath || readinessPath.length === 0;
  if (missing) {
    return {
      id: 'photo_grade_readiness',
      label: 'PhotoGradeReadiness gate',
      required: true,
      status: 'fail',
      message: 'PhotoGradeReadiness report path is required.'
    };
  }
  if (!await pathExists(resolveRepo(readinessPath))) {
    return {
      id: 'photo_grade_readiness',
      label: 'PhotoGradeReadiness gate',
      required: true,
      status: 'fail',
      message: `PhotoGradeReadiness report does not exist: ${readinessPath}`
    };
  }
  try {
    const readiness = await readJson(resolveRepo(readinessPath));
    const ready = readiness.kind === 'photo_grade_readiness_qa'
      && readiness.ok === true
      && ['technical_baseline', 'candidate'].includes(readiness.photo_grade_readiness)
      && readiness.photo_grade_readiness !== 'review_required'
      && readiness.sample?.input_asset_status === 'available'
      && !(readiness.blockers || []).some((blocker) => blocker.gate === 'input_asset');
    return {
      id: 'photo_grade_readiness',
      label: 'PhotoGradeReadiness gate',
      required: true,
      status: ready ? 'pass' : 'fail',
      message: ready
        ? `PhotoGradeReadiness is ${readiness.photo_grade_readiness}.`
        : 'PhotoGradeReadiness must be ok, use available input assets, and be technical_baseline or candidate.'
    };
  } catch (error) {
    return {
      id: 'photo_grade_readiness',
      label: 'PhotoGradeReadiness gate',
      required: true,
      status: 'fail',
      message: `PhotoGradeReadiness report could not be parsed: ${error.message}`
    };
  }
}

async function buildVisionEvidenceReviewCheck(artifacts = {}) {
  const artifactItems = await Promise.all(REQUIRED_VISION_EVIDENCE_ARTIFACTS.map(async (role) => {
    const artifactPath = artifacts[role] || '';
    const exists = artifactPath.length > 0 && await pathExists(resolveRepo(artifactPath));
    return {
      role,
      path: artifactPath,
      required: true,
      exists,
      status: exists ? 'pass' : 'fail'
    };
  }));
  const missing = artifactItems.filter((item) => item.status !== 'pass');
  if (missing.length > 0) {
    return {
      id: 'vision_evidence_review',
      label: 'VisionEvidence policy review',
      required: true,
      status: 'fail',
      message: `VisionEvidence release artifacts are missing: ${missing.map((item) => item.role).join(', ')}`,
      items: artifactItems
    };
  }
  try {
    const report = await readJson(resolveRepo(artifacts.vision_evidence_report));
    const patch = await readJson(resolveRepo(artifacts.vision_evidence_review_patch));
    const decision = await readJson(resolveRepo(artifacts.vision_evidence_review_decision));
    const policyPatch = await readJson(resolveRepo(artifacts.vision_evidence_policy_correction_patch));
    const reviewItemCount = patch.summary?.total_items || 0;
    const acceptedItemCount = decision.summary?.accepted_items || 0;
    const valid = report.kind === 'vision_evidence_set_v1_report'
      && patch.kind === 'vision_evidence_review_patch'
      && patch.status === 'needs_review'
      && patch.apply_allowed === false
      && patch.compile_allowed === false
      && reviewItemCount > 0
      && decision.kind === 'vision_evidence_review_decision'
      && decision.status === 'accepted_policy_review'
      && decision.compile_allowed === false
      && decision.geometry_promotion_allowed === false
      && acceptedItemCount >= reviewItemCount
      && policyPatch.kind === 'vision_evidence_policy_correction_patch'
      && policyPatch.status === 'ready_for_vision_evidence_policy_update'
      && policyPatch.apply_scope === 'vision_evidence_set_policy_only'
      && policyPatch.compile_allowed === false
      && policyPatch.geometry_promotion_allowed === false;
    return {
      id: 'vision_evidence_review',
      label: 'VisionEvidence policy review',
      required: true,
      status: valid ? 'pass' : 'fail',
      message: valid
        ? 'VisionEvidence review decision and policy correction are present and remain evidence-metadata scoped.'
        : 'VisionEvidence review artifacts must be accepted policy review artifacts and must not allow compile or geometry promotion.',
      items: artifactItems,
      metrics: {
        review_items: reviewItemCount,
        accepted_items: acceptedItemCount,
        semantic_candidate_items: patch.summary?.semantic_candidate_items || 0,
        policy_actions: policyPatch.summary?.total_actions || 0,
        default_heavy_model_required: report.summary?.default_heavy_model_required === true
      }
    };
  } catch (error) {
    return {
      id: 'vision_evidence_review',
      label: 'VisionEvidence policy review',
      required: true,
      status: 'fail',
      message: `VisionEvidence review artifacts could not be parsed: ${error.message}`,
      items: artifactItems
    };
  }
}

export function generatedSourcePathMarkers(sourcePath) {
  if (typeof sourcePath !== 'string') return ['missing_path'];
  const normalized = sourcePath.toLowerCase();
  return GENERATED_SOURCE_PATH_MARKERS.filter((marker) => normalized.includes(marker));
}

function nextActionsForReadyChecklist({ manifestPath, releaseManifestPath }) {
  if (normalizePathForCompare(manifestPath) === normalizePathForCompare(releaseManifestPath)) {
    return [
      'Run the release manifest validation command.',
      'Run the release gate and confirm the remaining release gap is gone.'
    ];
  }
  return [
    `Copy or regenerate this reviewed manifest at ${releaseManifestPath}.`,
    'Run the release manifest validation command.',
    'Run the release gate and confirm the remaining release gap is gone.'
  ];
}

function nextActionsForBlockedChecklist(blockers) {
  const actions = [];
  if (blockers.includes('source_assets')) actions.push('Replace source_images with existing real user-provided building photos or scans.');
  if (blockers.includes('source_authenticity')) actions.push('Set source_authenticity to real_user_provided and source_asset_kind to a supported real-building kind.');
  if (blockers.includes('artifacts')) actions.push('Generate or point to the reviewed PartGraph, compiler-fresh output DSL, and QA report artifacts.');
  if (blockers.includes('photo_grade_readiness')) actions.push('Run PhotoGradeReadiness and resolve review_required or input-asset blockers.');
  if (blockers.includes('vision_evidence_review')) actions.push('Export an accepted VisionEvidence review decision and build the evidence-policy correction patch before release promotion.');
  if (blockers.includes('human_review')) actions.push('Fill reviewer, accepted_at, and notes after human review accepts the sample.');
  if (actions.length === 0) actions.push('Resolve failed required checks before promoting this manifest.');
  return actions;
}

function normalizePathForCompare(value) {
  return path.normalize(value || '');
}

function cliArg(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertTruthy(value, message) {
  if (!value) throw new Error(message);
}

function assertIncludes(values, expected, message) {
  if (!Array.isArray(values) || !values.includes(expected)) throw new Error(`${message}: ${expected} not found`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
