#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStructuredAssetIntake } from './intake-assets.mjs';
import { repoRoot } from './lib/image-analysis.mjs';

const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/real-world-building-demo-candidate-audit';
const DEFAULT_LOCAL_CANDIDATES = [
  'test/建筑单体',
  'test/建筑群/建筑单体',
  'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png'
];
const REQUIRED_BUILDING_SINGLE_DEMO_ROLES = [
  'visible_plane_primary',
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary',
  'upper_window_bands',
  'exterior_hvac_units',
  'ground_floor_storefront'
];
const RELEASE_GAP = 'real_world_building_positive_release_sample_missing';

export async function auditRealWorldBuildingDemoCandidates({
  inputs = [],
  outputDir = DEFAULT_OUTPUT_DIR,
  objectType = 'building_single',
  objectNamePrefix = 'Real-World Building Demo Candidate',
  parseDocuments = false,
  writeReview = false,
  writeOverlays = false,
  maxDimension = 900
} = {}) {
  const selectedInputs = inputs.length ? inputs : await defaultCandidateInputs();
  if (!selectedInputs.length) throw new Error('No real-world building demo candidate inputs were provided or found.');
  const absoluteOutputDir = resolveRepo(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });

  const candidates = [];
  for (const [index, input] of selectedInputs.entries()) {
    const id = `candidate-${String(index + 1).padStart(2, '0')}-${safeSegment(input)}`;
    const candidateOutputDir = path.join(outputDir, id);
    const result = await buildStructuredAssetIntake({
      input,
      objectType,
      objectName: `${objectNamePrefix} ${index + 1}`,
      outputDir: candidateOutputDir,
      parseDocuments,
      writeReview,
      writeOverlays,
      writeMcpBrief: true,
      writeRealWorldBuildingReleaseDraft: true
    });
    const roleCounts = countBy(result.candidateGraph.candidates, 'role');
    const semanticRoleCoverage = REQUIRED_BUILDING_SINGLE_DEMO_ROLES
      .filter((role) => (roleCounts[role] || 0) > 0);
    const checklist = result.realWorldBuildingReleaseDraft?.checklist || null;
    const blockers = checklist?.blockers || [];
    const sourcePackage = result.sourcePackageAssessment || null;
    const missingInputs = result.modelingBrief.missing_inputs || [];
    const releaseStage = releaseStageForCandidate({ checklist, sourcePackage });
    const releasePreparationWorkflow = releasePreparationWorkflowForCandidate({
      candidateId: id,
      candidateOutputDir,
      input,
      objectType,
      sourcePackage,
      checklist,
      manifestDraft: result.realWorldBuildingReleaseDraft?.manifestOutput || null
    });
    const candidate = {
      id,
      input,
      output_dir: candidateOutputDir,
      profile: result.observationSet.object?.profile || result.modelingBrief.profile_id,
      asset_count: result.assetSet.assets.length,
      media_types: Array.from(new Set(result.assetSet.assets.map((asset) => asset.media_type))).sort(),
      views_detected: result.observationSet.views_detected || [],
      candidate_count: result.candidateGraph.candidates.length,
      role_counts: roleCounts,
      semantic_role_coverage: semanticRoleCoverage,
      semantic_role_missing: REQUIRED_BUILDING_SINGLE_DEMO_ROLES.filter((role) => !semanticRoleCoverage.includes(role)),
      compile_allowed: result.modelingBrief.compile_allowed === true,
      modeling_status: result.modelingBrief.status,
      missing_inputs: missingInputs,
      input_ready_for_release_work: sourcePackage?.input_ready_for_release_work === true,
      source_package_status: sourcePackage?.status || 'not_assessed',
      source_package: sourcePackage ? {
        status: sourcePackage.status,
        input_ready_for_release_work: sourcePackage.input_ready_for_release_work,
        source_status: sourcePackage.source_authenticity.status,
        view_status: sourcePackage.view_package.status,
        scale_status: sourcePackage.scale_package.status,
        semantic_status: sourcePackage.semantic_package.status,
        blockers: sourcePackage.blockers,
        next_actions: sourcePackage.next_actions
      } : null,
      source_request: sourceRequestSummary({
        sourcePackage,
        candidateOutputDir
      }),
      release_ready: checklist?.release_ready === true,
      can_promote_to_release_manifest: checklist?.can_promote_to_release_manifest === true,
      release_blockers: blockers,
      release_checks: checklist?.checks?.map((check) => ({
        id: check.id,
        status: check.status,
        required: check.required === true
      })) || [],
      next_actions: nextActionsForCandidate({ checklist, missingInputs, sourcePackage }),
      release_stage: releaseStage,
      refill_workflow: refillWorkflowForCandidate({
        candidateId: id,
        candidateOutputDir,
        objectType,
        sourcePackage
      }),
      release_preparation_workflow: releasePreparationWorkflow,
      release_candidate_assessment: releaseCandidateAssessmentForCandidate({
        checklist,
        sourcePackage,
        releaseStage,
        releasePreparationWorkflow
      }),
      classification: classifyCandidate({
        checklist,
        semanticRoleCoverage,
        sourcePackage,
        compileAllowed: result.modelingBrief.compile_allowed === true
      }),
      score: scoreCandidate({
        semanticRoleCoverage,
        viewsDetected: result.observationSet.views_detected || [],
        candidateCount: result.candidateGraph.candidates.length,
        sourcePackage,
        blockers,
        missingInputs
      }),
      artifacts: {
        asset_set: path.join(candidateOutputDir, 'asset-set.json'),
        observations: path.join(candidateOutputDir, 'observations.json'),
        candidate_graph: path.join(candidateOutputDir, 'candidate-graph.json'),
        modeling_brief: path.join(candidateOutputDir, 'modeling-brief.json'),
        mcp_modeling_brief: path.join(candidateOutputDir, 'mcp-modeling-brief.json'),
        source_package: sourcePackage ? path.join(candidateOutputDir, 'real-world-building-source-package.json') : null,
        source_request: sourcePackage ? path.join(candidateOutputDir, 'real-world-building-source-request.json') : null,
        source_request_markdown: sourcePackage ? path.join(candidateOutputDir, 'real-world-building-source-request.md') : null,
        upload_manifest_template: sourcePackage ? path.join(candidateOutputDir, 'upload-manifest.template.json') : null,
        review_workbench: writeReview ? path.join(candidateOutputDir, 'review', 'index.html') : null,
        manifest_draft: result.realWorldBuildingReleaseDraft?.manifestOutput || null,
        release_checklist: result.realWorldBuildingReleaseDraft?.checklistOutput || null,
        release_checklist_markdown: result.realWorldBuildingReleaseDraft?.checklistMarkdownOutput || null,
        contract_summary: result.realWorldBuildingReleaseDraft?.contractSummaryOutput || null
      }
    };
    candidates.push(candidate);
  }

  const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);
  const releaseWorkCandidates = sortedCandidates.filter((candidate) => candidate.release_candidate_assessment.selectable_for_release_work);
  const formalManifestCandidates = sortedCandidates.filter((candidate) => candidate.release_candidate_assessment.selectable_for_formal_manifest);
  const report = {
    version: 1,
    kind: 'real_world_building_demo_candidate_audit',
    generated_at: new Date().toISOString(),
    ok: true,
    release_ready: candidates.some((candidate) => candidate.release_ready),
    release_gap: RELEASE_GAP,
    summary: {
      candidates: candidates.length,
      release_ready_candidates: candidates.filter((candidate) => candidate.release_ready).length,
      input_ready_source_packages: candidates.filter((candidate) => candidate.input_ready_for_release_work).length,
      release_selectable_candidates: releaseWorkCandidates.length,
      formal_manifest_selectable_candidates: formalManifestCandidates.length,
      useful_structure_review_demos: candidates.filter((candidate) => candidate.classification === 'useful_structure_review_demo').length,
      blocked_candidates: candidates.filter((candidate) => !candidate.release_ready).length,
      best_candidate: sortedCandidates[0]?.id || null,
      best_structure_review_candidate: sortedCandidates[0]?.id || null,
      best_release_work_candidate: releaseWorkCandidates[0]?.id || null,
      best_formal_manifest_candidate: formalManifestCandidates[0]?.id || null,
      recommended_next_action: releaseWorkCandidates[0]?.release_preparation_workflow?.next_action
        || sortedCandidates[0]?.release_preparation_workflow?.next_action
        || null
    },
    candidates
  };
  await writeJson(path.join(absoluteOutputDir, 'candidate-audit-report.json'), report);
  await fs.writeFile(path.join(absoluteOutputDir, 'candidate-audit-report.md'), renderRealWorldBuildingDemoCandidateAuditMarkdown(report), 'utf8');
  return report;
}

export function renderRealWorldBuildingDemoCandidateAuditMarkdown(report) {
  const lines = [
    '# Real-World Building Demo Candidate Audit',
    '',
    `- Release ready: \`${String(report.release_ready)}\``,
    `- Remaining release gap: \`${report.release_gap}\``,
    `- Candidates: \`${report.summary.candidates}\``,
    `- Best structure review candidate: \`${report.summary.best_structure_review_candidate || report.summary.best_candidate || 'none'}\``,
    `- Best release work candidate: \`${report.summary.best_release_work_candidate || 'none'}\``,
    `- Release-selectable candidates: \`${String(report.summary.release_selectable_candidates || 0)}\``,
    '',
    '| Candidate | Classification | Score | Release Tier | Release Work | Input Ready | Release Ready | Semantic Roles | Blockers |',
    '| --- | --- | ---: | --- | --- | --- | --- | ---: | --- |'
  ];
  for (const candidate of report.candidates) {
    lines.push([
      `\`${escapeMarkdownTable(candidate.id)}\``,
      escapeMarkdownTable(candidate.classification),
      String(candidate.score),
      `\`${candidate.release_candidate_assessment?.tier || 'unknown'}\``,
      `\`${String(candidate.release_candidate_assessment?.selectable_for_release_work === true)}\``,
      `\`${String(candidate.input_ready_for_release_work)}\``,
      `\`${String(candidate.release_ready)}\``,
      String(candidate.semantic_role_coverage.length),
      candidate.release_blockers.length ? `\`${candidate.release_blockers.join('`, `')}\`` : '`none`'
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  for (const candidate of report.candidates) {
    lines.push(`## ${candidate.id}`);
    lines.push('');
    lines.push(`- Input: \`${candidate.input}\``);
    lines.push(`- Views: \`${candidate.views_detected.join('`, `') || 'none'}\``);
    lines.push(`- Compile allowed: \`${String(candidate.compile_allowed)}\``);
    lines.push(`- Release stage: \`${candidate.release_stage}\``);
    if (candidate.release_candidate_assessment) {
      lines.push(`- Release candidate tier: \`${candidate.release_candidate_assessment.tier}\`; selectable for release work \`${String(candidate.release_candidate_assessment.selectable_for_release_work)}\`; primary blocker \`${candidate.release_candidate_assessment.primary_blocker || 'none'}\``);
    }
    lines.push(`- Source package: \`${candidate.source_package_status}\` / input ready \`${String(candidate.input_ready_for_release_work)}\``);
    if (candidate.release_preparation_workflow) {
      lines.push(`- Release preparation workflow: \`${candidate.release_preparation_workflow.status}\`; next action \`${candidate.release_preparation_workflow.next_action}\``);
    }
    if (candidate.source_request) {
      lines.push(`- Source request: \`${candidate.source_request.status}\`; missing views \`${candidate.source_request.missing_views.join('`, `') || 'none'}\`; scale evidence needed \`${String(candidate.source_request.scale_evidence_needed)}\``);
    }
    if (candidate.refill_workflow) {
      lines.push('- Refill workflow:');
      lines.push(`  - Source refill package: \`${candidate.refill_workflow.source_refill_package_directory || 'none'}\``);
      lines.push(`  - Upload package: \`${candidate.refill_workflow.upload_package_directory || candidate.refill_workflow.upload_package_placeholder || 'none'}\``);
      lines.push(`  - Source request: \`${candidate.refill_workflow.source_request_file || 'none'}\``);
      lines.push(`  - Upload manifest template: \`${candidate.refill_workflow.upload_manifest_template || 'none'}\``);
      lines.push(`  - Prepare source refill package: \`${candidate.refill_workflow.commands.prepare_source_refill_package}\``);
      lines.push(`  - Validate source refill package: \`${candidate.refill_workflow.commands.validate_source_refill_package_require_upload_ready}\``);
      lines.push(`  - Run refill upload session: \`${candidate.refill_workflow.commands.run_refill_upload_session}\``);
    }
    if (candidate.release_preparation_workflow) {
      lines.push('- Release commands:');
      lines.push(`  - Run upload session: \`${candidate.release_preparation_workflow.commands.run_upload_session_from_candidate_input}\``);
      lines.push(`  - Prepare release workspace: \`${candidate.release_preparation_workflow.commands.prepare_release_artifact_workspace}\``);
      lines.push(`  - Prepare manifest draft: \`${candidate.release_preparation_workflow.commands.prepare_manifest_draft_from_intake}\``);
      lines.push(`  - Guard formal manifest: \`${candidate.release_preparation_workflow.commands.guarded_write_formal_manifest}\``);
    }
    lines.push(`- Missing inputs: \`${candidate.missing_inputs.join('`, `') || 'none'}\``);
    lines.push(`- Covered semantic roles: \`${candidate.semantic_role_coverage.join('`, `') || 'none'}\``);
    lines.push('- Next actions:');
    for (const action of candidate.next_actions) lines.push(`  - ${action}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function sourceRequestSummary({ sourcePackage, candidateOutputDir }) {
  const request = sourcePackage?.source_request || null;
  if (!request) return null;
  const viewRequirements = request.view_requirements || [];
  const missingViews = viewRequirements
    .filter((item) => item.required === true && item.status === 'missing')
    .map((item) => item.view);
  const presentViews = viewRequirements
    .filter((item) => item.required === true && item.status === 'present')
    .map((item) => item.view);
  return {
    status: request.status,
    request_file: path.join(candidateOutputDir, 'real-world-building-source-request.json'),
    request_markdown: path.join(candidateOutputDir, 'real-world-building-source-request.md'),
    upload_manifest_template: path.join(candidateOutputDir, 'upload-manifest.template.json'),
    accepted_asset_types: request.accepted_asset_types || [],
    blocked_until_satisfied: request.blocked_until_satisfied || [],
    source_asset_status: request.source_asset_requirements?.status || 'fail',
    source_asset_requests: request.source_asset_requirements?.requests || [],
    needs_replacement_assets: request.source_asset_requirements?.needs_replacement_assets === true,
    needs_supported_assets: request.source_asset_requirements?.needs_supported_assets === true,
    needs_distinct_assets: request.source_asset_requirements?.needs_distinct_assets === true,
    required_views: viewRequirements
      .filter((item) => item.required === true)
      .map((item) => item.view),
    present_views: presentViews,
    missing_views: missingViews,
    view_source_diversity_required: request.view_source_requirements?.distinct_source_images_required === true,
    view_source_image_field: request.view_source_requirements?.source_image_field || 'views[].source_image',
    scale_status: request.scale_requirement?.status || 'fail',
    scale_confidence: Number(request.scale_requirement?.current_confidence || 0),
    minimum_scale_confidence: Number(request.scale_requirement?.minimum_confidence || 0.7),
    scale_evidence_needed: request.scale_requirement?.status !== 'pass',
    acceptable_scale_evidence: request.scale_requirement?.acceptable_evidence || [],
    semantic_status: request.semantic_requirements?.status || 'review',
    missing_semantic_roles: request.semantic_requirements?.missing_roles || []
  };
}

function releasePreparationWorkflowForCandidate({
  candidateId,
  candidateOutputDir,
  input,
  objectType,
  sourcePackage,
  checklist,
  manifestDraft
}) {
  const uploadSessionOutputDir = `output/image-structured-modeler/real-world-building-upload-session/${candidateId}`;
  const uploadSessionSummary = path.join(uploadSessionOutputDir, 'upload-session-summary.json');
  const releaseWorkspace = path.join(uploadSessionOutputDir, 'release-artifact-workspace.json');
  const releaseWorkspaceValidation = path.join(uploadSessionOutputDir, 'release-artifact-workspace-validation.json');
  const draftValidationOutputDir = path.join(uploadSessionOutputDir, 'manifest-draft-validation');
  const sourceRefillPackage = sourceRefillPackagePathsForCandidate({
    candidateId,
    candidateOutputDir,
    objectType,
    uploadSessionOutputDir: `${uploadSessionOutputDir}-refill`
  });
  const sourceInputReady = sourcePackage?.input_ready_for_release_work === true;
  const releaseReady = checklist?.release_ready === true;
  const status = releaseReady
    ? 'ready_for_formal_manifest_guard'
    : sourceInputReady
      ? 'ready_for_release_artifact_authoring'
      : 'blocked_until_source_request_satisfied';
  const nextAction = releaseReady
    ? 'run_guarded_formal_manifest_write'
    : sourceInputReady
      ? 'prepare_release_artifact_workspace'
      : 'run_refill_upload_session_with_real_sources';
  const runUploadSession = [
    'npm run image-structured:real-world-building-upload-session --',
    '--input',
    shellArg(input),
    '--object-type',
    shellArg(objectType),
    '--output-dir',
    shellArg(uploadSessionOutputDir),
    '--real-world-building-release-draft'
  ].join(' ');
  return {
    purpose: 'advance a selected building demo candidate through upload-session, release artifact workspace, manifest draft validation, and guarded formal manifest write',
    status,
    next_action: nextAction,
    blocked: !sourceInputReady || !releaseReady,
    blockers: sourceInputReady ? checklist?.blockers || [] : sourcePackage?.blockers || [],
    expected_release_artifacts: [
      'part_graph',
      'compiled_output',
      'photo_grade_readiness_report',
      'vision_evidence_review_decision',
      'vision_evidence_policy_correction_patch',
      'human_review'
    ],
    upload_session_summary: uploadSessionSummary,
    release_artifact_workspace: releaseWorkspace,
    release_artifact_workspace_validation: releaseWorkspaceValidation,
    manifest_draft: manifestDraft || path.join(candidateOutputDir, 'real-world-building-release', 'manifest.draft.json'),
    formal_manifest: 'projects/image-structured-modeler/examples/real-world-building-positive/manifest.json',
    commands: {
      run_upload_session_from_candidate_input: runUploadSession,
      prepare_source_refill_package: sourceRefillPackage.commands.prepare_source_refill_package,
      validate_source_refill_package_require_upload_ready: sourceRefillPackage.commands.validate_source_refill_package_require_upload_ready,
      run_refill_upload_session_with_real_sources: sourceRefillPackage.commands.run_refill_upload_session_require_input_ready,
      prepare_release_artifact_workspace: [
        'npm run image-structured:prepare-real-world-building-release-artifact-workspace --',
        '--upload-session-summary',
        shellArg(uploadSessionSummary),
        '--output',
        shellArg(releaseWorkspace)
      ].join(' '),
      validate_release_artifact_workspace: [
        'npm run image-structured:validate-real-world-building-release-artifact-workspace --',
        '--workspace',
        shellArg(releaseWorkspace),
        '--output',
        shellArg(releaseWorkspaceValidation),
        '--require-ready-to-author'
      ].join(' '),
      prepare_manifest_draft_from_intake: [
        'npm run image-structured:prepare-real-world-building --',
        '--intake-dir',
        shellArg(candidateOutputDir)
      ].join(' '),
      validate_manifest_draft: [
        'npm run image-structured:validate-real-world-building --',
        '--manifest',
        shellArg(manifestDraft || path.join(candidateOutputDir, 'real-world-building-release', 'manifest.draft.json')),
        '--output-dir',
        shellArg(draftValidationOutputDir),
        '--require-present'
      ].join(' '),
      guarded_write_formal_manifest: [
        'npm run image-structured:prepare-real-world-building --',
        '--intake-dir',
        shellArg(candidateOutputDir),
        '--manifest-output',
        'projects/image-structured-modeler/examples/real-world-building-positive/manifest.json'
      ].join(' ')
    }
  };
}

function releaseStageForCandidate({ checklist, sourcePackage }) {
  if (checklist?.release_ready === true) return 'release_positive_ready';
  if (!sourcePackage) return 'needs_structured_intake';
  if (sourcePackage.source_authenticity?.status !== 'pass') return 'needs_real_source_assets';
  if (sourcePackage.view_package?.status !== 'pass' || sourcePackage.scale_package?.status !== 'pass') return 'needs_views_or_scale';
  if (sourcePackage.semantic_package?.status !== 'pass') return 'needs_semantic_confirmation';
  if (sourcePackage.input_ready_for_release_work === true) return 'source_input_ready_needs_review_artifacts';
  return 'review_blocked';
}

function releaseCandidateAssessmentForCandidate({
  checklist,
  sourcePackage,
  releaseStage,
  releasePreparationWorkflow
}) {
  const releaseReady = checklist?.release_ready === true;
  const sourceInputReady = sourcePackage?.input_ready_for_release_work === true;
  const selectableForReleaseWork = releaseReady || sourceInputReady;
  const blockers = [
    ...(sourcePackage?.blockers || []),
    ...(checklist?.blockers || [])
  ];
  return {
    selectable_for_release_work: selectableForReleaseWork,
    selectable_for_formal_manifest: checklist?.can_promote_to_release_manifest === true,
    tier: releaseCandidateTier({ releaseReady, sourceInputReady, releaseStage }),
    primary_blocker: primaryReleaseCandidateBlocker({ releaseStage, blockers }),
    blocked_reasons: [...new Set(blockers)],
    next_action: releasePreparationWorkflow?.next_action || null,
    message: selectableForReleaseWork
      ? 'Candidate source package is ready for release artifact work; continue through release-artifact workspace and checklist.'
      : 'Candidate is not selectable for release work yet; satisfy its source request with real, distinct building source assets first.'
  };
}

function releaseCandidateTier({ releaseReady, sourceInputReady, releaseStage }) {
  if (releaseReady) return 'release_positive_ready';
  if (sourceInputReady) return 'source_input_ready';
  if (releaseStage === 'needs_real_source_assets') return 'needs_real_sources';
  if (releaseStage === 'needs_views_or_scale') return 'needs_views_or_scale';
  if (releaseStage === 'needs_semantic_confirmation') return 'needs_semantic_confirmation';
  return 'not_selectable';
}

function primaryReleaseCandidateBlocker({ releaseStage, blockers }) {
  if (releaseStage === 'needs_real_source_assets') return 'source_assets';
  if (releaseStage === 'needs_views_or_scale') {
    if (blockers.some((blocker) => blocker.includes('scale'))) return 'scale_evidence';
    return 'view_coverage';
  }
  if (releaseStage === 'needs_semantic_confirmation') return 'semantic_confirmation';
  if (blockers.includes('artifacts')) return 'release_artifacts';
  if (blockers.includes('photo_grade_readiness')) return 'photo_grade_readiness';
  if (blockers.includes('vision_evidence_review')) return 'vision_evidence_review';
  if (blockers.includes('human_review')) return 'human_review';
  return blockers[0] || null;
}

function refillWorkflowForCandidate({
  candidateId,
  candidateOutputDir,
  objectType,
  sourcePackage
}) {
  const request = sourcePackage?.source_request || null;
  if (!request) return null;
  const workflow = sourceRefillPackagePathsForCandidate({
    candidateId,
    candidateOutputDir,
    objectType,
    uploadSessionOutputDir: `output/image-structured-modeler/real-world-building-upload-session/${candidateId}-refill`
  });
  return {
    purpose: 'validate a new upload package against this candidate source request',
    upload_package_placeholder: workflow.upload_package_directory,
    source_refill_package_directory: workflow.package_directory,
    upload_package_directory: workflow.upload_package_directory,
    source_request_file: workflow.source_request_file,
    source_request_markdown: workflow.source_request_markdown,
    upload_manifest_template: workflow.upload_manifest_template,
    expected_upload_contract: {
      accepted_asset_types: request.accepted_asset_types || [],
      required_views: request.view_source_requirements?.required_views || [],
      distinct_source_images_required: request.view_source_requirements?.distinct_source_images_required === true,
      source_image_field: request.view_source_requirements?.source_image_field || 'views[].source_image',
      minimum_scale_confidence: Number(request.scale_requirement?.minimum_confidence || 0.7)
    },
    commands: {
      prepare_source_refill_package: workflow.commands.prepare_source_refill_package,
      validate_source_refill_package: workflow.commands.validate_source_refill_package,
      validate_source_refill_package_require_upload_ready: workflow.commands.validate_source_refill_package_require_upload_ready,
      run_refill_upload_session: workflow.commands.run_refill_upload_session,
      require_input_ready: workflow.commands.run_refill_upload_session_require_input_ready
    }
  };
}

function sourceRefillPackagePathsForCandidate({
  candidateId,
  candidateOutputDir,
  objectType,
  uploadSessionOutputDir
}) {
  const sourceRequestFile = path.join(candidateOutputDir, 'real-world-building-source-request.json');
  const packageDirectory = `output/image-structured-modeler/real-world-building-source-refill-package/${candidateId}`;
  const uploadPackageDirectory = path.join(packageDirectory, 'upload-package');
  const runRefillUploadSession = [
    'npm run image-structured:real-world-building-upload-session --',
    '--input',
    shellArg(uploadPackageDirectory),
    '--object-type',
    shellArg(objectType),
    '--output-dir',
    shellArg(uploadSessionOutputDir),
    '--source-request-file',
    shellArg(sourceRequestFile),
    '--real-world-building-release-draft'
  ].join(' ');
  const validateSourceRefillPackage = [
    'npm run image-structured:validate-real-world-building-source-refill-package --',
    '--package-dir',
    shellArg(packageDirectory)
  ].join(' ');
  return {
    package_directory: packageDirectory,
    upload_package_directory: uploadPackageDirectory,
    source_request_file: sourceRequestFile,
    source_request_markdown: path.join(candidateOutputDir, 'real-world-building-source-request.md'),
    upload_manifest_template: path.join(candidateOutputDir, 'upload-manifest.template.json'),
    commands: {
      prepare_source_refill_package: [
        'npm run image-structured:prepare-real-world-building-source-refill-package --',
        '--source-request',
        shellArg(sourceRequestFile),
        '--output-dir',
        shellArg(packageDirectory),
        '--object-type',
        shellArg(objectType),
        '--upload-session-output-dir',
        shellArg(uploadSessionOutputDir)
      ].join(' '),
      validate_source_refill_package: validateSourceRefillPackage,
      validate_source_refill_package_require_upload_ready: `${validateSourceRefillPackage} --require-upload-ready`,
      run_refill_upload_session: runRefillUploadSession,
      run_refill_upload_session_require_input_ready: `${runRefillUploadSession} --require-preflight-release-source-candidate --require-source-input-ready`
    }
  };
}

async function defaultCandidateInputs() {
  const found = [];
  for (const input of DEFAULT_LOCAL_CANDIDATES) {
    if (await pathExists(resolveRepo(input))) found.push(input);
  }
  return found;
}

function classifyCandidate({ checklist, semanticRoleCoverage, sourcePackage, compileAllowed }) {
  if (checklist?.release_ready === true) return 'release_positive_ready';
  if (compileAllowed) return 'unsafe_compile_allowed_candidate';
  if (sourcePackage?.input_ready_for_release_work === true) return 'input_ready_release_work_candidate';
  if (semanticRoleCoverage.length >= 4) return 'useful_structure_review_demo';
  if (semanticRoleCoverage.length > 0) return 'partial_structure_review_demo';
  return 'low_signal_candidate';
}

function scoreCandidate({ semanticRoleCoverage, viewsDetected, candidateCount, sourcePackage, blockers, missingInputs }) {
  return Math.round(
    semanticRoleCoverage.length * 12
    + viewsDetected.length * 4
    + Math.min(candidateCount, 30) / 2
    + (sourcePackage?.input_ready_for_release_work ? 24 : 0)
    - blockers.length * 3
    - (sourcePackage?.blockers?.length || 0)
    - missingInputs.length
  );
}

function nextActionsForCandidate({ checklist, missingInputs, sourcePackage }) {
  const actions = [...new Set([
    ...(sourcePackage?.next_actions || []),
    ...(checklist?.next_actions || [])
  ])];
  for (const missing of missingInputs || []) {
    if (missing === 'missing_oblique_view') actions.push('Add an oblique building view before attempting release promotion.');
    if (missing === 'missing_front_view') actions.push('Add a front/elevation view before attempting release promotion.');
    if (missing === 'missing_left_view') actions.push('Add a side view to separate recessed side facade evidence from front facade evidence.');
    if (missing === 'missing_top_view') actions.push('Add a top/plan view or CAD/PDF outline before attempting release promotion.');
    if (missing === 'scale_confidence_below_publish_gate') actions.push('Provide known dimensions or CAD/PDF scale evidence.');
  }
  return [...new Set(actions)];
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items || []) {
    const value = item[key] || 'unknown';
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function safeSegment(input) {
  const base = path.basename(input).replace(/\.[^.]+$/, '');
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'input';
}

function parseArgs(argv) {
  const options = {
    inputs: [],
    outputDir: DEFAULT_OUTPUT_DIR,
    objectType: 'building_single',
    parseDocuments: false,
    writeReview: false,
    writeOverlays: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.inputs.push(argv[++index]);
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--object-type') options.objectType = argv[++index];
    else if (arg === '--parse-documents') options.parseDocuments = true;
    else if (arg === '--write-review') options.writeReview = true;
    else if (arg === '--write-overlays') options.writeOverlays = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/audit-real-world-building-demo-candidates.mjs \\
    --input test/建筑单体 \\
    --output-dir output/image-structured-modeler/real-world-building-demo-candidate-audit

Options:
  --input <path>          Candidate image/PDF/CAD file or directory. Repeatable.
  --output-dir <path>     Output directory for candidate intakes and audit report.
  --object-type <type>    Candidate profile hint, default building_single.
  --parse-documents       Parse supported PDF/CAD assets.
  --write-review          Write per-candidate review/index.html workbenches.
  --write-overlays        Write per-candidate review overlay images.
`);
}

function resolveRepo(value) {
  return path.resolve(repoRoot, value);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  auditRealWorldBuildingDemoCandidates(options)
    .then((report) => {
      process.stdout.write(`${JSON.stringify({
        ok: report.ok,
        release_ready: report.release_ready,
        candidates: report.summary.candidates,
        release_ready_candidates: report.summary.release_ready_candidates,
        release_selectable_candidates: report.summary.release_selectable_candidates,
        best_candidate: report.summary.best_candidate,
        best_structure_review_candidate: report.summary.best_structure_review_candidate,
        best_release_work_candidate: report.summary.best_release_work_candidate,
        output: path.join(options.outputDir, 'candidate-audit-report.json'),
        release_gap: report.release_gap
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
