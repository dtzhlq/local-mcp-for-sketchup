#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  buildAssetReviewHtml,
  buildStructuredAssetIntake
} from './intake-assets.mjs';
import { preflightRealWorldBuildingSourcePackageCli } from './preflight-real-world-building-source-package.mjs';
import { renderMcpModelingBriefMarkdown } from './lib/mcp-modeling-brief.mjs';
import {
  buildRealWorldBuildingSourceRequestResponse,
  renderRealWorldBuildingSourceRequestResponseMarkdown
} from './lib/real-world-building-source-package.mjs';

const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/real-world-building-upload-session';

export async function runRealWorldBuildingUploadSession({
  input,
  objectType = 'building_single',
  objectName = 'Real World Building Upload',
  viewHintsFile = null,
  sourceRequestFile = null,
  outputDir = DEFAULT_OUTPUT_DIR,
  parseDocuments = false,
  writeOverlays = true,
  requirePreflightReleaseSourceCandidate = false,
  requireSourceInputReady = false,
  requireSourceReleaseReady = false,
  writeRealWorldBuildingReleaseDraft = false,
  releaseDraftReviewer = null,
  releaseDraftAcceptedAt = null,
  releaseDraftNotes = null,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!input) throw new Error('input is required');
  const absoluteOutputDir = resolveRepo(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });

  const preflight = await preflightRealWorldBuildingSourcePackageCli({
    input,
    objectType,
    viewHintsFile,
    output: path.join(outputDir, 'preflight', 'preflight.json'),
    markdownOutput: path.join(outputDir, 'preflight', 'preflight.md'),
    requireReleaseSourceCandidate: requirePreflightReleaseSourceCandidate,
    generatedAt
  });

  const viewHints = await prepareUploadSessionViewHints({
    outputDir,
    viewHintsFile,
    preflight,
    generatedAt
  });

  let intake = null;
  if (preflight.report.can_start_structured_intake) {
    intake = await buildStructuredAssetIntake({
      input,
      objectType,
      objectName,
      viewHintsFile: viewHints.path,
      outputDir: path.join(outputDir, 'intake'),
      parseDocuments,
      writeOverlays,
      requireSourceInputReady,
      requireSourceReleaseReady,
      writeRealWorldBuildingReleaseDraft,
      releaseDraftReviewer,
      releaseDraftAcceptedAt,
      releaseDraftNotes
    });
  }

  const sourceRequestResponse = await maybeWriteSourceRequestResponse({
    sourceRequestFile,
    outputDir,
    preflight,
    intake,
    generatedAt
  });
  await maybeWriteUploadSessionMcpBriefResponseGate({
    outputDir,
    intake,
    sourceRequestResponse
  });

  const summary = buildUploadSessionSummary({
    input,
    objectType,
    outputDir,
    generatedAt,
    preflight,
    intake,
    viewHints,
    sourceRequestResponse
  });
  await finalizeUploadSessionHandoffArtifactState(summary);
  await writeJson(resolveRepo(summary.artifacts.upload_session_summary), summary);
  await fs.writeFile(resolveRepo(summary.artifacts.upload_session_markdown), renderUploadSessionMarkdown(summary), 'utf8');
  await writeJson(resolveRepo(summary.artifacts.upload_session_handoff), summary.handoff);
  await fs.writeFile(resolveRepo(summary.artifacts.upload_session_handoff_markdown), renderUploadSessionHandoffMarkdown(summary.handoff), 'utf8');
  return summary;
}

function buildUploadSessionSummary({
  input,
  objectType,
  outputDir,
  generatedAt,
  preflight,
  intake,
  viewHints,
  sourceRequestResponse
}) {
  const artifacts = {
    upload_session_summary: path.join(outputDir, 'upload-session-summary.json'),
    upload_session_markdown: path.join(outputDir, 'upload-session-summary.md'),
    upload_session_handoff: path.join(outputDir, 'upload-session-handoff.json'),
    upload_session_handoff_markdown: path.join(outputDir, 'upload-session-handoff.md'),
    view_hints: viewHints.path,
    preflight: preflight.output,
    preflight_markdown: preflight.markdownOutput,
    intake_summary: intake?.intakeSummary?.artifacts?.intake_summary || null,
    review_workbench: intake?.intakeSummary?.artifacts?.review_workbench || null,
    mcp_modeling_brief: intake?.intakeSummary?.artifacts?.mcp_modeling_brief || null,
    mcp_modeling_brief_markdown: intake?.intakeSummary?.artifacts?.mcp_modeling_brief_markdown || null,
    vision_evidence_report: intake?.intakeSummary?.artifacts?.vision_evidence_report || null,
    vision_evidence_review_patch: intake?.intakeSummary?.artifacts?.vision_evidence_review_patch || null,
    vision_evidence_review_patch_markdown: intake?.intakeSummary?.artifacts?.vision_evidence_review_patch_markdown || null,
    vision_evidence_review_workbench: intake?.intakeSummary?.artifacts?.vision_evidence_review_workbench || null,
    source_package: intake?.intakeSummary?.artifacts?.source_package || null,
    source_request: intake?.intakeSummary?.artifacts?.source_request || null,
    source_request_markdown: intake?.intakeSummary?.artifacts?.source_request_markdown || null,
    source_request_response: sourceRequestResponse ? path.join(outputDir, 'source-request-response.json') : null,
    source_request_response_markdown: sourceRequestResponse ? path.join(outputDir, 'source-request-response.md') : null,
    upload_manifest_template: intake?.intakeSummary?.artifacts?.upload_manifest_template || null,
    source_package_gate_result: intake?.intakeSummary?.artifacts?.source_package_gate_result || null,
    real_world_building_release_manifest_draft: intake?.intakeSummary?.artifacts?.real_world_building_release_manifest_draft || null,
    real_world_building_release_contract_summary: intake?.intakeSummary?.artifacts?.real_world_building_release_contract_summary || null,
    real_world_building_release_checklist: intake?.intakeSummary?.artifacts?.real_world_building_release_checklist || null,
    real_world_building_release_checklist_markdown: intake?.intakeSummary?.artifacts?.real_world_building_release_checklist_markdown || null,
    real_world_building_release_work_order: intake?.intakeSummary?.artifacts?.real_world_building_release_work_order || null,
    real_world_building_release_work_order_markdown: intake?.intakeSummary?.artifacts?.real_world_building_release_work_order_markdown || null
  };
  const sourcePackageSummary = intake ? sourcePackageSummaryForUploadSession({
    assessment: intake.sourcePackageAssessment,
    gateResult: intake.sourcePackageGateResult
  }) : null;
  const intakeBlock = intake ? {
    profile: intake.observationSet.object.profile,
    status: intake.modelingBrief.status,
    compile_allowed: intake.modelingBrief.compile_allowed,
    assets: intake.assetSet.assets.length,
    candidates: intake.candidateGraph.summary.candidate_count,
    missing_inputs: intake.modelingBrief.missing_inputs,
    source_package_status: intake.sourcePackageAssessment?.status || null,
    input_ready_for_release_work: intake.sourcePackageAssessment?.input_ready_for_release_work === true,
    release_ready: intake.sourcePackageAssessment?.release_ready === true,
    source_package: sourcePackageSummary
  } : null;
  const sourcePackageGateOk = intake?.sourcePackageGateResult ? intake.sourcePackageGateResult.ok : null;
  const sourceRequestResponseOk = sourceRequestResponse ? sourceRequestResponse.ok : null;
  const canGenerateSketchUpDsl = intake?.mcpModelingBrief?.compile_permission?.can_generate_sketchup_dsl ?? null;
  const preflightRequirementsOk = preflight.ok === true;
  const ok = preflightRequirementsOk && (sourcePackageGateOk !== false) && (sourceRequestResponseOk !== false);
  const status = uploadSessionStatus({
    preflight,
    intake,
    sourcePackageGateOk,
    sourceRequestResponseOk
  });
  const workflow = workflowForUploadSession({
    status,
    objectType,
    outputDir,
    artifacts,
    preflight,
    intake,
    sourceRequestResponse,
    sourcePackageGateOk
  });
  const handoffVisionEvidence = uploadSessionVisionEvidenceHandoff(intake?.mcpModelingBrief);
  const summary = {
    version: 1,
    kind: 'real_world_building_upload_session',
    generated_at: generatedAt,
    ok,
    status,
    input: toRepoRelative(resolveRepo(input)),
    object_type: objectType,
    preflight: {
      ok: preflight.ok,
      status: preflight.report.status,
      can_start_structured_intake: preflight.report.can_start_structured_intake,
      release_source_candidate: preflight.report.release_source_candidate,
      failed_requirements: preflight.failedRequirements,
      blockers: preflight.report.blockers,
      warnings: preflight.report.warnings,
      metadata_files: preflight.report.metadata_files || [],
      view_source_diversity: preflight.report.view_package?.view_source_diversity || null,
      scale_package: preflight.report.scale_package
    },
    intake: intakeBlock,
    vision_evidence: intake?.intakeSummary?.vision_evidence || null,
    gates: {
      preflight_requirements_ok: preflightRequirementsOk,
      source_package_gate_ok: sourcePackageGateOk,
      source_request_response_ok: sourceRequestResponseOk,
      can_generate_sketchup_dsl: canGenerateSketchUpDsl
    },
    source_request_response: sourceRequestResponseSummary(sourceRequestResponse),
    real_world_building_release_draft: intake?.intakeSummary?.real_world_building_release_draft || null,
    artifacts,
    workflow,
    next_actions: nextActionsForUploadSession({ preflight, intake, sourcePackageGateOk, sourceRequestResponse })
  };
  summary.handoff = handoffForUploadSession(summary, { visionEvidence: handoffVisionEvidence });
  return summary;
}

async function maybeWriteUploadSessionMcpBriefResponseGate({
  outputDir,
  intake,
  sourceRequestResponse
}) {
  if (!intake?.mcpModelingBrief || !sourceRequestResponse) return;
  const responseGate = sourceRequestResponseGateForMcpBrief(sourceRequestResponse);
  const brief = intake.mcpModelingBrief;
  brief.source_request_response_gate = responseGate;
  if (responseGate.ok !== true) {
    brief.compile_permission.reasons = uniqueStrings([
      ...(brief.compile_permission.reasons || []),
      'source_request_response_failed',
      ...(responseGate.unsatisfied_check_ids || []).map((id) => `source_request_response:${id}`)
    ]);
    brief.agent_contract.output_policy.blockers = uniqueStrings([
      ...(brief.agent_contract.output_policy.blockers || []),
      'source_request_response_failed',
      ...(responseGate.unsatisfied_check_ids || [])
    ]);
    brief.agent_contract.output_policy.blocked_outputs = uniqueStrings([
      ...(brief.agent_contract.output_policy.blocked_outputs || []),
      ...(responseGate.blocked_outputs_remaining || [])
    ]);
    brief.agent_contract.required_confirmations = uniqueStrings([
      ...(brief.agent_contract.required_confirmations || []),
      ...(responseGate.unsatisfied_check_details || []).map((detail) => `Resolve source request response check ${detail.id}: ${detail.detail}`)
    ]);
  }
  brief.agent_contract.authoritative_artifacts = uniqueArtifacts([
    ...(brief.agent_contract.authoritative_artifacts || []),
    {
      role: 'source_request_response',
      path: path.join(outputDir, 'source-request-response.json'),
      required: true
    }
  ]);

  const mcpBriefPath = intake.intakeSummary?.artifacts?.mcp_modeling_brief;
  const mcpBriefMarkdownPath = intake.intakeSummary?.artifacts?.mcp_modeling_brief_markdown;
  if (mcpBriefPath) await writeJson(resolveRepo(mcpBriefPath), brief);
  if (mcpBriefMarkdownPath) {
    await fs.writeFile(resolveRepo(mcpBriefMarkdownPath), renderMcpModelingBriefMarkdown(brief), 'utf8');
  }
  const reviewWorkbenchPath = intake.intakeSummary?.artifacts?.review_workbench;
  if (reviewWorkbenchPath) {
    const intakeOutputDir = resolveRepo(path.join(outputDir, 'intake'));
    const overlayDir = path.join(intakeOutputDir, 'review-overlays');
    await fs.writeFile(
      resolveRepo(reviewWorkbenchPath),
      buildAssetReviewHtml({
        assetSet: intake.assetSet,
        observationSet: intake.observationSet,
        candidateGraph: intake.candidateGraph,
        modelingBrief: intake.modelingBrief,
        mcpModelingBrief: brief,
        promotionReview: intake.promotionReview,
        visionEvidenceReport: intake.intakeSummary?.artifacts?.vision_evidence_report
          ? await readJson(resolveRepo(intake.intakeSummary.artifacts.vision_evidence_report))
          : null,
        visionEvidenceReviewPatch: intake.intakeSummary?.artifacts?.vision_evidence_review_patch
          ? await readJson(resolveRepo(intake.intakeSummary.artifacts.vision_evidence_review_patch))
          : null,
        sourcePackageAssessment: intake.sourcePackageAssessment,
        realWorldBuildingReleaseDraft: intake.realWorldBuildingReleaseDraft,
        outputDir: intakeOutputDir,
        overlayDir: await pathExists(overlayDir) ? overlayDir : null,
        mcpBriefLinks: Boolean(mcpBriefPath || mcpBriefMarkdownPath)
      }),
      'utf8'
    );
  }
}

function sourceRequestResponseGateForMcpBrief(response) {
  return {
    ok: response.ok,
    status: response.status,
    source_request: response.source_request,
    current_source_package: response.current_source_package,
    requested_checks: response.summary.requested_checks,
    satisfied_checks: response.summary.satisfied_checks,
    unsatisfied_checks: response.summary.unsatisfied_checks,
    expected_check_ids: response.summary.expected_check_ids || [],
    requested_check_ids: response.summary.requested_check_ids || [],
    satisfied_check_ids: response.summary.satisfied_check_ids || [],
    unsatisfied_check_ids: response.summary.unsatisfied_check_ids || [],
    missing_expected_check_ids: response.summary.missing_expected_check_ids || [],
    unexpected_requested_check_ids: response.summary.unexpected_requested_check_ids || [],
    view_evidence: response.summary.view_evidence || sourceRequestResponseEmptyViewEvidence(),
    semantic_evidence: response.summary.semantic_evidence || sourceRequestResponseEmptySemanticEvidence(),
    unsatisfied_check_details: response.summary.unsatisfied_check_details || [],
    blocked_outputs_remaining: response.blocked_outputs_remaining || []
  };
}

async function maybeWriteSourceRequestResponse({
  sourceRequestFile,
  outputDir,
  preflight,
  intake,
  generatedAt
}) {
  if (!sourceRequestFile) return null;
  const sourceRequestPath = resolveRepo(sourceRequestFile);
  const previousSourceRequest = await readJson(sourceRequestPath);
  const response = buildRealWorldBuildingSourceRequestResponse({
    previousSourceRequest,
    currentAssessment: intake?.sourcePackageAssessment || null,
    currentPreflightReport: preflight?.report || null,
    sourceRequestPath: toRepoRelative(sourceRequestPath),
    generatedAt
  });
  await writeJson(resolveRepo(path.join(outputDir, 'source-request-response.json')), response);
  await fs.writeFile(
    resolveRepo(path.join(outputDir, 'source-request-response.md')),
    renderRealWorldBuildingSourceRequestResponseMarkdown(response),
    'utf8'
  );
  return response;
}

async function prepareUploadSessionViewHints({
  outputDir,
  viewHintsFile,
  preflight,
  generatedAt
}) {
  if (preflight.report.view_package?.view_source_diversity?.status === 'fail') {
    return {
      path: null,
      generated: false,
      blocked_reason: 'view_sources_not_distinct'
    };
  }
  if (viewHintsFile) {
    return {
      path: viewHintsFile,
      generated: false
    };
  }
  const sources = preflight.report.view_package?.sources || [];
  if (!sources.length) {
    return {
      path: null,
      generated: false
    };
  }
  const views = [];
  const seen = new Set();
  for (const source of sources) {
    const key = `${source.path}:${source.view}`;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push({
      source_image: source.path,
      kind: source.view,
      confidence: source.source === 'view_hints_file' ? 0.9 : source.source === 'cad_plan_default' ? 0.78 : 0.82,
      note: `Generated by upload-session from ${source.source}.`
    });
  }
  const outputPath = path.join(outputDir, 'view-hints.generated.json');
  await writeJson(resolveRepo(outputPath), {
    version: 1,
    kind: 'upload_session_view_hints',
    generated_at: generatedAt,
    source: 'real_world_building_source_package_preflight',
    views
  });
  return {
    path: outputPath,
    generated: true
  };
}

function uploadSessionStatus({ preflight, intake, sourcePackageGateOk, sourceRequestResponseOk }) {
  if (!preflight.report.can_start_structured_intake || preflight.ok === false) return 'blocked_preflight';
  if (sourcePackageGateOk === false) return 'source_gate_failed';
  if (sourceRequestResponseOk === false) return 'source_request_response_failed';
  if (!intake) return 'blocked_preflight';
  if (intake.sourcePackageAssessment?.input_ready_for_release_work === true) return 'ready_for_review_work';
  return 'review_required';
}

function nextActionsForUploadSession({ preflight, intake, sourcePackageGateOk, sourceRequestResponse }) {
  const actions = [];
  actions.push(...(preflight.report.next_actions || []));
  if (!intake) {
    actions.push('Fix preflight blockers before structured intake can run.');
    return Array.from(new Set(actions));
  }
  if (sourcePackageGateOk === false) {
    actions.push('Resolve source-package gate failures before release-sample modeling work.');
  }
  if (sourceRequestResponse?.ok === false) {
    actions.push('Upload a source package that satisfies the previous source request before release-sample modeling work.');
  }
  for (const item of intake.modelingBrief.missing_inputs || []) {
    actions.push(`Resolve intake missing input: ${item}.`);
  }
  for (const action of intake.sourcePackageAssessment?.next_actions || []) actions.push(action);
  if (intake.mcpModelingBrief?.compile_permission?.can_generate_sketchup_dsl !== true) {
    actions.push('Do not generate SketchUp DSL until candidate promotion and compiler gates pass.');
  }
  return Array.from(new Set(actions));
}

function workflowForUploadSession({
  status,
  objectType,
  outputDir,
  artifacts,
  preflight,
  intake,
  sourceRequestResponse,
  sourcePackageGateOk
}) {
  const sourceRequest = intake?.sourcePackageAssessment?.source_request || null;
  const releaseDraft = intake?.intakeSummary?.real_world_building_release_draft || null;
  const workflowStage = workflowStageForUploadSession({
    status,
    preflight,
    intake,
    sourceRequestResponse,
    sourcePackageGateOk,
    releaseDraft
  });
  const intakeDir = artifacts.intake_summary ? path.join(outputDir, 'intake') : null;
  const refillOutputDir = `${outputDir}-refill`;
  const sourceRefillPackageOutputDir = `${outputDir}-source-refill-package`;
  const sourceRefillUploadPackageDir = path.join(sourceRefillPackageOutputDir, 'upload-package');
  const prepareSourceRefillPackage = artifacts.source_request
    ? [
      'npm run image-structured:prepare-real-world-building-source-refill-package --',
      '--source-request',
      shellArg(artifacts.source_request),
      '--output-dir',
      shellArg(sourceRefillPackageOutputDir),
      '--object-type',
      shellArg(objectType),
      '--upload-session-output-dir',
      shellArg(refillOutputDir)
    ].join(' ')
    : null;
  const validateSourceRefillPackage = artifacts.source_request
    ? [
      'npm run image-structured:validate-real-world-building-source-refill-package --',
      '--package-dir',
      shellArg(sourceRefillPackageOutputDir)
    ].join(' ')
    : null;
  const runRefill = artifacts.source_request
    ? [
      'npm run image-structured:real-world-building-upload-session --',
      '--input',
      shellArg(sourceRefillUploadPackageDir),
      '--object-type',
      shellArg(objectType),
      '--output-dir',
      shellArg(refillOutputDir),
      '--source-request-file',
      shellArg(artifacts.source_request),
      '--real-world-building-release-draft'
    ].join(' ')
    : null;
  const prepareRelease = intakeDir
    ? [
      'npm run image-structured:prepare-real-world-building --',
      '--intake-dir',
      shellArg(intakeDir),
      '--manifest-output',
      shellArg(artifacts.real_world_building_release_manifest_draft || path.join(intakeDir, 'real-world-building-release', 'manifest.draft.json'))
    ].join(' ')
    : null;
  const validateDraft = artifacts.real_world_building_release_manifest_draft
    ? [
      'npm run image-structured:validate-real-world-building --',
      '--manifest',
      shellArg(artifacts.real_world_building_release_manifest_draft),
      '--output-dir',
      shellArg(path.join(outputDir, 'release-draft-validation')),
      '--require-present'
    ].join(' ')
    : null;
  const assessSourcePackage = intakeDir
    ? [
      'npm run image-structured:assess-real-world-building-source-package --',
      '--intake-dir',
      shellArg(intakeDir),
      '--require-input-ready'
    ].join(' ')
    : null;
  const releaseArtifactWorkspace = path.join(outputDir, 'release-artifact-workspace.json');
  const prepareReleaseArtifactWorkspace = [
    'npm run image-structured:prepare-real-world-building-release-artifact-workspace --',
    '--upload-session-summary',
    shellArg(path.join(outputDir, 'upload-session-summary.json')),
    '--output',
    shellArg(releaseArtifactWorkspace)
  ].join(' ');
  const validateReleaseArtifactWorkspace = [
    'npm run image-structured:validate-real-world-building-release-artifact-workspace --',
    '--workspace',
    shellArg(releaseArtifactWorkspace)
  ].join(' ');
  const visionEvidenceReviewDecision = intakeDir ? path.join(intakeDir, 'vision-evidence-review.accepted.json') : null;
  const visionEvidencePolicyCorrectionPatch = intakeDir ? path.join(intakeDir, 'vision-evidence-policy-correction-patch.json') : null;
  const prepareVisionEvidenceReviewWorkbench = artifacts.vision_evidence_review_patch && intakeDir
    ? [
      'node projects/image-structured-modeler/scripts/make-vision-evidence-review-workbench.mjs',
      '--review-patch',
      shellArg(artifacts.vision_evidence_review_patch),
      '--output-dir',
      shellArg(path.join(intakeDir, 'vision-evidence-review'))
    ].join(' ')
    : null;
  const buildVisionEvidencePolicyCorrectionPatch = artifacts.vision_evidence_review_patch && artifacts.vision_evidence_report && visionEvidenceReviewDecision && visionEvidencePolicyCorrectionPatch
    ? [
      'node projects/image-structured-modeler/scripts/build-vision-evidence-policy-correction-patch.mjs',
      '--review-patch',
      shellArg(artifacts.vision_evidence_review_patch),
      '--decision',
      shellArg(visionEvidenceReviewDecision),
      '--output',
      shellArg(visionEvidencePolicyCorrectionPatch),
      '--markdown-output',
      shellArg(visionEvidencePolicyCorrectionPatch.replace(/\.json$/u, '.md')),
      '--vision-evidence-set',
      shellArg(artifacts.vision_evidence_report),
      '--updated-vision-evidence-set',
      shellArg(path.join(path.dirname(visionEvidencePolicyCorrectionPatch), 'vision-evidence-v1.reviewed.json'))
    ].join(' ')
    : null;
  return {
    stage: workflowStage,
    can_continue_without_new_upload: [
      'source_input_ready_needs_release_artifacts',
      'release_manifest_ready'
    ].includes(workflowStage),
    source_request_file: artifacts.source_request,
    source_request_markdown: artifacts.source_request_markdown,
    source_request_response_file: artifacts.source_request_response,
    upload_manifest_template: artifacts.upload_manifest_template,
    review_workbench: artifacts.review_workbench,
    mcp_modeling_brief: artifacts.mcp_modeling_brief,
    vision_evidence_report: artifacts.vision_evidence_report,
    vision_evidence_review_patch: artifacts.vision_evidence_review_patch,
    vision_evidence_review_workbench: artifacts.vision_evidence_review_workbench,
    vision_evidence_review_decision: visionEvidenceReviewDecision,
    vision_evidence_policy_correction_patch: visionEvidencePolicyCorrectionPatch,
    release_manifest_draft: artifacts.real_world_building_release_manifest_draft,
    release_checklist: artifacts.real_world_building_release_checklist,
    release_work_order: artifacts.real_world_building_release_work_order,
    release_work_order_markdown: artifacts.real_world_building_release_work_order_markdown,
    release_artifact_workspace: releaseArtifactWorkspace,
    blocked_outputs: workflowBlockedOutputs({ sourceRequest, sourceRequestResponse, intake }),
    required_user_inputs: workflowRequiredUserInputs({ preflight, intake, sourceRequestResponse, releaseDraft }),
    commands: {
      prepare_source_refill_package: prepareSourceRefillPackage,
      validate_source_refill_package: validateSourceRefillPackage,
      validate_source_refill_package_require_upload_ready: validateSourceRefillPackage
        ? `${validateSourceRefillPackage} --require-upload-ready`
        : null,
      run_refill_upload_session: runRefill,
      run_refill_upload_session_require_input_ready: runRefill
        ? `${runRefill} --require-preflight-release-source-candidate --require-source-input-ready`
        : null,
      assess_source_package_input_ready: assessSourcePackage,
      prepare_release_sample_from_intake: prepareRelease,
      prepare_vision_evidence_review_workbench: prepareVisionEvidenceReviewWorkbench,
      build_vision_evidence_policy_correction_patch: buildVisionEvidencePolicyCorrectionPatch,
      prepare_release_artifact_workspace: prepareReleaseArtifactWorkspace,
      validate_release_artifact_workspace: validateReleaseArtifactWorkspace,
      validate_release_draft: validateDraft,
      validate_release_manifest: 'npm run image-structured:validate-real-world-building -- --require-present',
      run_release_gate: 'npm run image-structured:release-gate -- --output-dir output/image-structured-modeler/release-gate'
    }
  };
}

function workflowStageForUploadSession({
  status,
  preflight,
  intake,
  sourceRequestResponse,
  sourcePackageGateOk,
  releaseDraft
}) {
  if (!preflight.report.can_start_structured_intake || status === 'blocked_preflight' && !intake) return 'preflight_blocked';
  if (sourceRequestResponse?.ok === false) return 'source_response_refill_required';
  if (sourcePackageGateOk === false || intake?.sourcePackageAssessment?.input_ready_for_release_work !== true) {
    return 'source_refill_required';
  }
  if (releaseDraft?.can_promote_to_release_manifest === true) return 'release_manifest_ready';
  return 'source_input_ready_needs_release_artifacts';
}

function workflowBlockedOutputs({ sourceRequest, sourceRequestResponse, intake }) {
  return uniqueStrings([
    ...(sourceRequest?.blocked_until_satisfied || []),
    ...(sourceRequestResponse?.blocked_outputs_remaining || []),
    ...(intake?.mcpModelingBrief?.agent_contract?.output_policy?.blocked_outputs || [])
  ]);
}

function workflowRequiredUserInputs({ preflight, intake, sourceRequestResponse, releaseDraft }) {
  const inputs = [];
  inputs.push(...(preflight.failedRequirements || []));
  inputs.push(...(preflight.report.failed_requirements || []));
  inputs.push(...(preflight.report.blockers || []));
  inputs.push(...(intake?.modelingBrief?.missing_inputs || []));
  inputs.push(...(intake?.sourcePackageAssessment?.blockers || []));
  inputs.push(...(sourceRequestResponse?.summary?.unsatisfied_check_ids || []).map((id) => `source_request_response:${id}`));
  inputs.push(...(releaseDraft?.blockers || []).map((id) => `release_draft:${id}`));
  return uniqueStrings(inputs);
}

function renderUploadSessionMarkdown(summary) {
  const lines = [
    '# Real-World Building Upload Session',
    '',
    `- Status: \`${summary.status}\``,
    `- OK: \`${String(summary.ok)}\``,
    `- Input: \`${summary.input}\``,
    `- Object type: \`${summary.object_type}\``,
    `- Preflight: \`${summary.preflight.status}\` / release source candidate \`${String(summary.preflight.release_source_candidate)}\``,
    `- Intake: \`${summary.intake?.status || 'not_run'}\``,
    `- Source package gate ok: \`${String(summary.gates.source_package_gate_ok)}\``,
    `- Source request response ok: \`${String(summary.gates.source_request_response_ok)}\``,
    `- Can generate SketchUp DSL: \`${String(summary.gates.can_generate_sketchup_dsl)}\``,
    `- Source package blockers: \`${summary.intake?.source_package?.blockers?.join('`, `') || 'none'}\``,
    '',
    '## Artifacts',
    ''
  ];
  for (const [key, value] of Object.entries(summary.artifacts)) {
    lines.push(`- ${key}: \`${value || 'none'}\``);
  }
  lines.push('', '## Preflight Metadata', '');
  if (summary.preflight.metadata_files.length) {
    for (const metadataFile of summary.preflight.metadata_files) {
      lines.push(`- \`${metadataFile.path}\`: \`${metadataFile.status}\` (${metadataFile.source})`);
      for (const error of [
        ...(metadataFile.errors || []),
        ...(metadataFile.error ? [metadataFile.error] : [])
      ]) lines.push(`  - ${error}`);
    }
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## Release Draft', '');
  if (summary.real_world_building_release_draft) {
    const draft = summary.real_world_building_release_draft;
    lines.push(`- Validation status: \`${draft.validation_status || 'unknown'}\``);
    lines.push(`- Release ready: \`${String(draft.release_ready)}\``);
    lines.push(`- Can promote to release manifest: \`${String(draft.can_promote_to_release_manifest)}\``);
    lines.push(`- Blockers: \`${draft.blockers.join('`, `') || 'none'}\``);
    lines.push(`- Required checklist checks: \`${draft.checklist_required_check_ids?.join('`, `') || 'none'}\``);
    lines.push(`- Failed required checklist checks: \`${draft.checklist_failed_required_check_ids?.join('`, `') || 'none'}\``);
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## Source Request', '');
  if (summary.intake?.source_package?.source_request) {
    const request = summary.intake.source_package.source_request;
    lines.push(`- Status: \`${request.status}\``);
    lines.push(`- Accepted asset types: \`${request.accepted_asset_types.join('`, `')}\``);
    lines.push(`- Blocked outputs: \`${request.blocked_until_satisfied.join('`, `') || 'none'}\``);
    for (const item of request.view_requirements || []) {
      if (item.status === 'missing') lines.push(`- Missing ${item.view}: ${item.request}`);
    }
    if (request.scale_requirement?.status !== 'pass') {
      lines.push(`- Scale: provide evidence to reach confidence \`${request.scale_requirement.minimum_confidence}\` (current \`${request.scale_requirement.current_confidence}\`).`);
    }
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## Source Request Response', '');
  if (summary.source_request_response) {
    const response = summary.source_request_response;
    lines.push(`- Status: \`${response.status}\``);
    lines.push(`- OK: \`${String(response.ok)}\``);
    lines.push(`- Requested checks: \`${response.requested_checks}\``);
    lines.push(`- Satisfied checks: \`${response.satisfied_checks}\``);
    lines.push(`- Unsatisfied checks: \`${response.unsatisfied_checks}\``);
    lines.push(`- Unsatisfied check ids: \`${response.unsatisfied_check_ids?.join('`, `') || 'none'}\``);
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## Workflow', '');
  lines.push(`- Stage: \`${summary.workflow.stage}\``);
  lines.push(`- Can continue without new upload: \`${String(summary.workflow.can_continue_without_new_upload)}\``);
  lines.push(`- Source request file: \`${summary.workflow.source_request_file || 'none'}\``);
  lines.push(`- Upload manifest template: \`${summary.workflow.upload_manifest_template || 'none'}\``);
  lines.push(`- Review workbench: \`${summary.workflow.review_workbench || 'none'}\``);
  lines.push(`- Release manifest draft: \`${summary.workflow.release_manifest_draft || 'none'}\``);
  lines.push(`- Release work order: \`${summary.workflow.release_work_order || 'none'}\``);
  lines.push(`- Release artifact workspace: \`${summary.workflow.release_artifact_workspace || 'none'}\``);
  lines.push(`- Blocked outputs: \`${summary.workflow.blocked_outputs.join('`, `') || 'none'}\``);
  lines.push(`- Required user inputs: \`${summary.workflow.required_user_inputs.join('`, `') || 'none'}\``);
  lines.push('- Commands:');
  for (const [key, value] of Object.entries(summary.workflow.commands)) {
    lines.push(`  - ${key}: \`${value || 'none'}\``);
  }
  lines.push('', '## Next Actions', '');
  if (summary.next_actions.length) {
    for (const action of summary.next_actions) lines.push(`- ${action}`);
  } else {
    lines.push('- No upload-session actions recorded.');
  }
  return `${lines.join('\n')}\n`;
}

function handoffForUploadSession(summary, { visionEvidence = emptyVisionEvidenceHandoff() } = {}) {
  const sourceRequest = summary.intake?.source_package?.source_request || null;
  const releaseDraft = summary.real_world_building_release_draft || null;
  const status = handoffStatusForWorkflowStage(summary.workflow.stage);
  const primaryAction = primaryActionForHandoff({ summary, status });
  const semanticEvidenceQuality = handoffSemanticEvidenceQuality(summary);
  const blockers = uniqueStrings([
    ...(summary.preflight.blockers || []),
    ...(summary.preflight.failed_requirements || []),
    ...(summary.intake?.source_package?.blockers || []),
    ...(summary.source_request_response?.unsatisfied_check_ids || []).map((id) => `source_request_response:${id}`),
    ...(releaseDraft?.blockers || []).map((id) => `release_draft:${id}`)
  ]);
  return {
    version: 1,
    kind: 'real_world_building_upload_session_handoff',
    generated_at: summary.generated_at,
    upload_session: summary.artifacts.upload_session_summary,
    status,
    workflow_stage: summary.workflow.stage,
    ok: summary.ok,
    release_ready: summary.intake?.release_ready === true || releaseDraft?.release_ready === true,
    can_generate_sketchup_dsl: summary.gates.can_generate_sketchup_dsl === true,
    can_continue_without_new_upload: summary.workflow.can_continue_without_new_upload,
    primary_action: primaryAction,
    source_request_status: sourceRequest?.status || null,
    source_request_response_status: summary.source_request_response?.status || null,
    release_work_order_status: releaseDraft?.work_order_status || null,
    semantic_evidence_quality: semanticEvidenceQuality,
    vision_evidence: visionEvidence,
    release_checklist_required_check_ids: uniqueStrings(releaseDraft?.checklist_required_check_ids || []),
    release_checklist_failed_required_check_ids: uniqueStrings(releaseDraft?.checklist_failed_required_check_ids || []),
    release_checklist_review_required_check_ids: uniqueStrings(releaseDraft?.checklist_review_required_check_ids || []),
    blocked_outputs: summary.workflow.blocked_outputs,
    required_user_inputs: summary.workflow.required_user_inputs,
    blockers,
    next_actions: summary.next_actions,
    authoritative_artifacts: uploadSessionHandoffArtifacts(summary),
    commands: summary.workflow.commands
  };
}

function uploadSessionVisionEvidenceHandoff(mcpBrief = null) {
  const visionEvidence = mcpBrief?.evidence_summary?.vision_evidence || null;
  if (!visionEvidence?.available) return emptyVisionEvidenceHandoff();
  return {
    available: visionEvidence.available === true,
    review_required: visionEvidence.review_required === true,
    verdict: visionEvidence.verdict || null,
    semantic_review_roles: uniqueStrings(visionEvidence.semantic_review_roles || []),
    default_heavy_model_required: visionEvidence.default_heavy_model_required === true,
    review_patch_artifact: (mcpBrief.agent_contract?.authoritative_artifacts || []).find((artifact) => artifact.role === 'vision_evidence_review_patch')?.path || null,
    semantic_evidence_instances: (visionEvidence.semantic_evidence_instances || [])
      .map((instance) => ({
        role: instance.role || '',
        evidence_id: instance.evidence_id || '',
        source_id: instance.source_id || '',
        source_image: instance.source_image || '',
        view: instance.view || 'unknown',
        class: instance.class || instance.role || '',
        kind: instance.kind || 'region',
        bbox_px: normalizeBbox(instance.bbox_px || []),
        confidence: Number(instance.confidence || 0),
        backend: instance.backend || '',
        source_stage: instance.source_stage || '',
        review_required: instance.review_required === true
      }))
      .filter((instance) => instance.role && instance.evidence_id && instance.bbox_px.length === 4)
      .slice(0, 32),
    modeling_handoff: (visionEvidence.modeling_handoff || [])
      .map((item) => ({
        role: item.role || '',
        instance_count: Number(item.instance_count || 0),
        primary_instance: item.primary_instance ? {
          evidence_id: item.primary_instance.evidence_id || '',
          source_id: item.primary_instance.source_id || '',
          source_image: item.primary_instance.source_image || '',
          view: item.primary_instance.view || 'unknown',
          bbox_px: normalizeBbox(item.primary_instance.bbox_px || []),
          confidence: Number(item.primary_instance.confidence || 0)
        } : null,
        evidence_tokens: uniqueStrings(item.evidence_tokens || []),
        geometry_interpretation: item.geometry_interpretation || '',
        modeling_decision: item.modeling_decision || '',
        allowed_semantics: uniqueStrings(item.allowed_semantics || []),
        blocked_interpretations: uniqueStrings(item.blocked_interpretations || []),
        required_confirmations: uniqueStrings(item.required_confirmations || []),
        handoff_text: item.handoff_text || '',
        review_required: item.review_required === true,
        geometry_promotion_allowed: item.geometry_promotion_allowed === true
      }))
      .filter((item) => item.role && item.primary_instance?.bbox_px?.length === 4)
      .slice(0, 32)
  };
}

function emptyVisionEvidenceHandoff() {
  return {
    available: false,
    review_required: false,
    verdict: null,
    semantic_review_roles: [],
    default_heavy_model_required: false,
    review_patch_artifact: null,
    semantic_evidence_instances: [],
    modeling_handoff: []
  };
}

function handoffSemanticEvidenceQuality(summary) {
  return summary.source_request_response?.semantic_evidence?.evidence_quality
    || summary.intake?.source_package?.semantic_evidence_quality
    || semanticEvidenceQualityEmpty();
}

function handoffStatusForWorkflowStage(stage) {
  if (stage === 'preflight_blocked') return 'preflight_blocked';
  if (stage === 'source_refill_required') return 'needs_source_refill';
  if (stage === 'source_response_refill_required') return 'needs_source_request_response_refill';
  if (stage === 'source_input_ready_needs_release_artifacts') return 'ready_for_release_artifact_work';
  if (stage === 'release_manifest_ready') return 'ready_for_formal_release_validation';
  return 'review_required';
}

function primaryActionForHandoff({ summary, status }) {
  if (status === 'needs_source_refill') {
    return {
      kind: 'upload_replacement_source_package',
      label: 'Prepare replacement source package',
      command: summary.workflow.commands.prepare_source_refill_package,
      artifact: summary.workflow.source_request_file || summary.workflow.upload_manifest_template
    };
  }
  if (status === 'needs_source_request_response_refill') {
    return {
      kind: 'resubmit_source_request_response',
      label: 'Prepare a package that satisfies the previous source request',
      command: summary.workflow.commands.prepare_source_refill_package,
      artifact: summary.workflow.source_request_file
    };
  }
  if (status === 'ready_for_release_artifact_work') {
    return {
      kind: 'produce_release_artifacts',
      label: 'Open release artifact workspace and produce reviewed PartGraph, compiled output, and PhotoGradeReadiness artifacts',
      command: summary.workflow.commands.prepare_release_artifact_workspace,
      artifact: summary.workflow.release_artifact_workspace
    };
  }
  if (status === 'ready_for_formal_release_validation') {
    return {
      kind: 'validate_formal_release_manifest',
      label: 'Validate and promote the formal real-world building manifest',
      command: summary.workflow.commands.validate_release_manifest,
      artifact: summary.workflow.release_manifest_draft
    };
  }
  return {
    kind: 'inspect_preflight_blockers',
    label: 'Inspect preflight blockers before structured intake can continue',
    command: null,
    artifact: summary.artifacts.preflight
  };
}

function uploadSessionHandoffArtifacts(summary) {
  return [
    { role: 'upload_session_summary', path: summary.artifacts.upload_session_summary, required: true },
    { role: 'upload_session_markdown', path: summary.artifacts.upload_session_markdown, required: false },
    { role: 'upload_session_handoff', path: summary.artifacts.upload_session_handoff, required: true },
    { role: 'upload_session_handoff_markdown', path: summary.artifacts.upload_session_handoff_markdown, required: false },
    { role: 'preflight', path: summary.artifacts.preflight, required: true },
    { role: 'preflight_markdown', path: summary.artifacts.preflight_markdown, required: false },
    { role: 'intake_summary', path: summary.artifacts.intake_summary, required: false },
    { role: 'review_workbench', path: summary.artifacts.review_workbench, required: false },
    { role: 'mcp_modeling_brief', path: summary.artifacts.mcp_modeling_brief, required: false },
    { role: 'vision_evidence_report', path: summary.artifacts.vision_evidence_report, required: false },
    { role: 'vision_evidence_review_patch', path: summary.artifacts.vision_evidence_review_patch, required: false },
    { role: 'vision_evidence_review_workbench', path: summary.artifacts.vision_evidence_review_workbench, required: false },
    { role: 'source_package', path: summary.artifacts.source_package, required: false },
    { role: 'source_request', path: summary.artifacts.source_request, required: false },
    { role: 'source_request_markdown', path: summary.artifacts.source_request_markdown, required: false },
    { role: 'source_request_response', path: summary.artifacts.source_request_response, required: false },
    { role: 'upload_manifest_template', path: summary.artifacts.upload_manifest_template, required: false },
    { role: 'release_manifest_draft', path: summary.artifacts.real_world_building_release_manifest_draft, required: false },
    { role: 'release_checklist', path: summary.artifacts.real_world_building_release_checklist, required: false },
    { role: 'release_work_order', path: summary.artifacts.real_world_building_release_work_order, required: false },
    { role: 'release_work_order_markdown', path: summary.artifacts.real_world_building_release_work_order_markdown, required: false }
  ].filter((artifact) => artifact.path);
}

async function finalizeUploadSessionHandoffArtifactState(summary) {
  const selfOutputRoles = new Set([
    'upload_session_summary',
    'upload_session_markdown',
    'upload_session_handoff',
    'upload_session_handoff_markdown'
  ]);
  const artifacts = [];
  for (const artifact of summary.handoff.authoritative_artifacts) {
    const exists = selfOutputRoles.has(artifact.role)
      ? true
      : await pathExists(resolveRepo(artifact.path));
    artifacts.push({ ...artifact, exists });
  }
  const existsByPath = new Map(artifacts.map((artifact) => [artifact.path, artifact.exists]));
  const primaryArtifact = summary.handoff.primary_action.artifact;
  summary.handoff = {
    ...summary.handoff,
    primary_action: {
      ...summary.handoff.primary_action,
      artifact_exists: primaryArtifact ? existsByPath.get(primaryArtifact) === true : false
    },
    authoritative_artifacts: artifacts
  };
}

function renderUploadSessionHandoffMarkdown(handoff) {
  const lines = [
    '# Real-World Building Upload Session Handoff',
    '',
    `- Status: \`${handoff.status}\``,
    `- Workflow stage: \`${handoff.workflow_stage}\``,
    `- OK: \`${String(handoff.ok)}\``,
    `- Release ready: \`${String(handoff.release_ready)}\``,
    `- Can generate SketchUp DSL: \`${String(handoff.can_generate_sketchup_dsl)}\``,
    `- Can continue without new upload: \`${String(handoff.can_continue_without_new_upload)}\``,
    `- Source request status: \`${handoff.source_request_status || 'none'}\``,
    `- Source request response status: \`${handoff.source_request_response_status || 'none'}\``,
    `- Release work order status: \`${handoff.release_work_order_status || 'none'}\``,
    `- Semantic evidence quality: \`${handoff.semantic_evidence_quality?.status || 'not_applicable'}\``,
    `- VisionEvidence available: \`${String(handoff.vision_evidence?.available === true)}\``,
    `- VisionEvidence semantic instances: \`${(handoff.vision_evidence?.semantic_evidence_instances || []).length}\``,
    `- VisionEvidence modeling handoff items: \`${(handoff.vision_evidence?.modeling_handoff || []).length}\``,
    `- Required checklist checks: \`${handoff.release_checklist_required_check_ids.join('`, `') || 'none'}\``,
    `- Failed required checklist checks: \`${handoff.release_checklist_failed_required_check_ids.join('`, `') || 'none'}\``,
    '',
    '## Primary Action',
    '',
    `- Kind: \`${handoff.primary_action.kind}\``,
    `- Label: ${handoff.primary_action.label}`,
    `- Artifact: \`${handoff.primary_action.artifact || 'none'}\``,
    `- Artifact exists: \`${String(handoff.primary_action.artifact_exists)}\``,
    `- Command: \`${handoff.primary_action.command || 'none'}\``,
    '',
    '## Blockers',
    ''
  ];
  if (handoff.blockers.length) {
    for (const blocker of handoff.blockers) lines.push(`- \`${blocker}\``);
  } else {
    lines.push('- `none`');
  }
  if (handoff.vision_evidence?.available) {
    lines.push('', '## VisionEvidence Handoff', '');
    lines.push(`- Review required: \`${String(handoff.vision_evidence.review_required === true)}\``);
    lines.push(`- Semantic roles: \`${(handoff.vision_evidence.semantic_review_roles || []).join('`, `') || 'none'}\``);
    lines.push(`- Review patch: \`${handoff.vision_evidence.review_patch_artifact || 'none'}\``);
    const instances = handoff.vision_evidence.semantic_evidence_instances || [];
    if (instances.length) {
      lines.push('', '| Role | View | Source ID | BBox px | Confidence |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const instance of instances.slice(0, 8)) {
        lines.push(`| ${instance.role} | ${instance.view} | ${escapeMarkdownTable(instance.source_id || instance.evidence_id || '')} | ${escapeMarkdownTable((instance.bbox_px || []).join(', '))} | ${instance.confidence} |`);
      }
    }
    const modelingHandoff = handoff.vision_evidence.modeling_handoff || [];
    if (modelingHandoff.length) {
      lines.push('', '| Handoff Role | Decision | Primary BBox px | Blocked Interpretations |');
      lines.push('| --- | --- | --- | --- |');
      for (const item of modelingHandoff.slice(0, 8)) {
        lines.push(`| ${item.role} | ${escapeMarkdownTable(item.modeling_decision)} | ${escapeMarkdownTable((item.primary_instance?.bbox_px || []).join(', '))} | ${escapeMarkdownTable((item.blocked_interpretations || []).join(', '))} |`);
      }
    }
  }
  lines.push('', '## Authoritative Artifacts', '');
  for (const artifact of handoff.authoritative_artifacts) {
    lines.push(`- ${artifact.role}: \`${artifact.path}\` exists=\`${String(artifact.exists)}\`${artifact.required ? ' (required)' : ''}`);
  }
  lines.push('', '## Commands', '');
  for (const [key, value] of Object.entries(handoff.commands)) {
    lines.push(`- ${key}: \`${value || 'none'}\``);
  }
  lines.push('', '## Next Actions', '');
  if (handoff.next_actions.length) {
    for (const action of handoff.next_actions) lines.push(`- ${action}`);
  } else {
    lines.push('- `none`');
  }
  return `${lines.join('\n')}\n`;
}

function sourceRequestResponseSummary(response) {
  if (!response) return null;
  return {
    ok: response.ok,
    status: response.status,
    source_request: response.source_request,
    current_source_package: response.current_source_package,
    requested_checks: response.summary.requested_checks,
    satisfied_checks: response.summary.satisfied_checks,
    unsatisfied_checks: response.summary.unsatisfied_checks,
    expected_check_ids: response.summary.expected_check_ids || [],
    requested_check_ids: response.summary.requested_check_ids || [],
    satisfied_check_ids: response.summary.satisfied_check_ids || [],
    unsatisfied_check_ids: response.summary.unsatisfied_check_ids || [],
    missing_expected_check_ids: response.summary.missing_expected_check_ids || [],
    unexpected_requested_check_ids: response.summary.unexpected_requested_check_ids || [],
    view_evidence: response.summary.view_evidence || sourceRequestResponseEmptyViewEvidence(),
    semantic_evidence: response.summary.semantic_evidence || sourceRequestResponseEmptySemanticEvidence(),
    unsatisfied_check_details: response.summary.unsatisfied_check_details || [],
    blocked_outputs_remaining: response.blocked_outputs_remaining
  };
}

function sourceRequestResponseEmptySemanticEvidence() {
  return {
    previous_missing_roles: [],
    current_required_roles: [],
    current_covered_roles: [],
    current_missing_roles: [],
    requested_roles: [],
    satisfied_roles: [],
    unsatisfied_roles: [],
    evidence_quality: semanticEvidenceQualityEmpty(),
    role_evidence: [],
    requested_role_evidence: []
  };
}

function semanticEvidenceQualityEmpty() {
  return {
    status: 'not_applicable',
    required_role_count: 0,
    covered_role_count: 0,
    missing_role_count: 0,
    weak_role_count: 0,
    review_required_role_count: 0,
    geometry_promotion_allowed: false,
    weak_roles: [],
    review_required_roles: [],
    flags: []
  };
}

function sourceRequestResponseEmptyViewEvidence() {
  return {
    previous_missing_views: [],
    current_required_views: [],
    current_present_views: [],
    current_missing_views: [],
    requested_views: [],
    satisfied_views: [],
    unsatisfied_views: [],
    view_source_diversity_status: 'unknown',
    view_evidence: [],
    requested_view_evidence: []
  };
}

function sourcePackageSummaryForUploadSession({ assessment, gateResult }) {
  if (!assessment && !gateResult) return null;
  return {
    gate_ok: gateResult?.ok ?? null,
    status: assessment?.status || gateResult?.status || null,
    input_ready_for_release_work: assessment?.input_ready_for_release_work === true || gateResult?.input_ready_for_release_work === true,
    release_ready: assessment?.release_ready === true || gateResult?.release_ready === true,
    required_gates: gateResult?.required_gates || null,
    failed_requirements: gateResult?.failed_requirements || [],
    blockers: gateResult?.blockers || assessment?.blockers || [],
    next_actions: assessment?.next_actions || [],
    source_request: assessment?.source_request || null,
    source_status: assessment?.source_authenticity?.status || null,
    view_status: assessment?.view_package?.status || null,
    scale_status: assessment?.scale_package?.status || null,
    semantic_status: assessment?.semantic_package?.status || null,
    missing_views: assessment?.view_package?.missing_views || [],
    view_evidence: assessment?.view_package?.view_evidence || [],
    scale_confidence: assessment?.scale_package?.confidence ?? null,
    missing_semantic_roles: assessment?.semantic_package?.missing_roles || [],
    semantic_role_evidence: assessment?.semantic_package?.role_evidence || [],
    semantic_evidence_quality: assessment?.semantic_package?.evidence_quality || semanticEvidenceQualityEmpty(),
    release_checklist_blockers: assessment?.release_package?.blockers || []
  };
}

function parseArgs(argv) {
  const options = {
    objectType: 'building_single',
    objectName: 'Real World Building Upload',
    writeOverlays: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = nextValue(argv, ++index, arg);
    else if (arg === '--object-type') options.objectType = nextValue(argv, ++index, arg);
    else if (arg === '--object-name') options.objectName = nextValue(argv, ++index, arg);
    else if (arg === '--view-hints-file') options.viewHintsFile = nextValue(argv, ++index, arg);
    else if (arg === '--source-request-file') options.sourceRequestFile = nextValue(argv, ++index, arg);
    else if (arg === '--output-dir') options.outputDir = nextValue(argv, ++index, arg);
    else if (arg === '--parse-documents') options.parseDocuments = true;
    else if (arg === '--no-overlays') options.writeOverlays = false;
    else if (arg === '--require-preflight-release-source-candidate') options.requirePreflightReleaseSourceCandidate = true;
    else if (arg === '--require-source-input-ready') options.requireSourceInputReady = true;
    else if (arg === '--require-source-release-ready') options.requireSourceReleaseReady = true;
    else if (arg === '--real-world-building-release-draft') options.writeRealWorldBuildingReleaseDraft = true;
    else if (arg === '--release-reviewer') options.releaseDraftReviewer = nextValue(argv, ++index, arg);
    else if (arg === '--release-accepted-at') options.releaseDraftAcceptedAt = nextValue(argv, ++index, arg);
    else if (arg === '--release-notes') options.releaseDraftNotes = nextValue(argv, ++index, arg);
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
  node projects/image-structured-modeler/scripts/run-real-world-building-upload-session.mjs \\
    --input path/to/upload-package \\
    --object-type building_single \\
    --output-dir output/image-structured-modeler/upload-session

Options:
  --object-name <name>                              Human-readable target name.
  --view-hints-file <path>                         Optional view hints JSON.
  --source-request-file <path>                     Previous real-world-building-source-request.json to validate this upload against.
  --parse-documents                                Parse supported PDF/CAD metadata and DXF outlines during intake.
  --require-preflight-release-source-candidate     Exit non-zero unless preflight marks the package as a release-source candidate.
  --require-source-input-ready                     Exit non-zero unless source package can enter release-sample modeling work.
  --require-source-release-ready                   Exit non-zero unless source package is fully release-ready.
  --real-world-building-release-draft              Also write release manifest draft/checklist from intake.
  --no-overlays                                    Skip review overlay generation.
`);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).split(path.sep).join('/') || '.';
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.length))).sort();
}

function normalizeBbox(value = []) {
  if (!Array.isArray(value) || value.length < 4) return [];
  return value.slice(0, 4).map((number) => Number(number || 0));
}

function escapeMarkdownTable(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function uniqueArtifacts(artifacts) {
  const byKey = new Map();
  for (const artifact of artifacts || []) {
    if (!artifact?.role || !artifact?.path) continue;
    byKey.set(`${artifact.role}\n${artifact.path}`, artifact);
  }
  return Array.from(byKey.values());
}

function shellArg(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  runRealWorldBuildingUploadSession(options)
    .then((summary) => {
      process.stdout.write(`${JSON.stringify({
        ok: summary.ok,
        status: summary.status,
        preflight: summary.preflight.status,
        intake: summary.intake?.status || null,
        source_package_gate_ok: summary.gates.source_package_gate_ok,
        source_request_response_ok: summary.gates.source_request_response_ok,
        source_request_response_status: summary.source_request_response?.status || null,
        can_generate_sketchup_dsl: summary.gates.can_generate_sketchup_dsl,
        output: summary.artifacts.upload_session_summary,
        handoff: summary.artifacts.upload_session_handoff,
        review_workbench: summary.artifacts.review_workbench,
        mcp_modeling_brief: summary.artifacts.mcp_modeling_brief
      }, null, 2)}\n`);
      if (!summary.ok) process.exit(1);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
