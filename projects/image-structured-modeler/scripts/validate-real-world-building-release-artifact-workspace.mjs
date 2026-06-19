#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { repoRoot } from './lib/image-analysis.mjs';

const WORKSPACE_SCHEMA = 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json';
const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/real-world-building-release-artifact-workspace-validation';
const REQUIRED_PACKET_CRITERIA = [
  'use_authoritative_inputs_only',
  'do_not_generate_direct_dsl_from_mcp_brief',
  'preserve_candidate_disambiguation',
  'preserve_semantic_evidence_quality',
  'use_vision_evidence_review_patch',
  'use_vision_evidence_instances',
  'use_vision_evidence_modeling_handoff',
  'address_failed_required_release_checks'
];
const CRITICAL_DISAMBIGUATION_TOKENS = [
  'merged_front_facade_plane',
  'decorative_facade_trim',
  'cut_recess_from_shadow_only'
];
const CRITICAL_VISION_EVIDENCE_ROLES = [
  'recessed_side_facade_plane',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary'
];
const CRITICAL_VISION_EVIDENCE_BLOCKED_INTERPRETATIONS = {
  recessed_side_facade_plane: 'merged_front_facade_plane',
  rectangular_utility_ducts: 'decorative_facade_trim',
  shadow_or_recess_boundary: 'cut_recess_from_shadow_only'
};
const REQUIRED_REVIEW_REQUIREMENT_IDS = [
  'vision_evidence_review',
  'human_review',
  'validate_release_draft',
  'promote_formal_manifest'
];
const REQUIRED_RELEASE_CHECKLIST_IDS = [
  'source_assets',
  'source_authenticity',
  'artifacts',
  'photo_grade_readiness',
  'vision_evidence_review',
  'human_review'
];
const REQUIRED_VISION_EVIDENCE_REVIEW_ARTIFACT_ROLES = [
  'vision_evidence_report',
  'vision_evidence_review_patch',
  'vision_evidence_review_decision',
  'vision_evidence_policy_correction_patch'
];

export async function validateRealWorldBuildingReleaseArtifactWorkspaceCli({
  workspace,
  output = null,
  markdownOutput = null,
  requireReadyToAuthor = false,
  requireArtifactsPresent = false,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!workspace) throw new Error('workspace is required');
  const normalizedOutput = output || path.join(DEFAULT_OUTPUT_DIR, 'workspace-validation.json');
  const normalizedMarkdownOutput = markdownOutput || replaceJsonExt(normalizedOutput, '.md');
  const workspacePath = resolveRepo(workspace);
  const workspaceJson = await readJson(workspacePath);
  const schema = await readJson(resolveRepo(WORKSPACE_SCHEMA));
  const schemaValidation = validateWithSchema(schema, workspaceJson);
  const report = buildWorkspaceValidationReport({
    workspacePath: toRepoRelative(workspacePath),
    workspace: workspaceJson,
    schemaValidation,
    requireReadyToAuthor,
    requireArtifactsPresent,
    generatedAt
  });
  await writeJson(resolveRepo(normalizedOutput), report);
  await fs.writeFile(resolveRepo(normalizedMarkdownOutput), renderWorkspaceValidationMarkdown(report), 'utf8');
  return {
    ok: report.ok,
    status: report.status,
    output: normalizedOutput,
    markdownOutput: normalizedMarkdownOutput,
    report
  };
}

export function buildWorkspaceValidationReport({
  workspacePath,
  workspace,
  schemaValidation,
  requireReadyToAuthor = false,
  requireArtifactsPresent = false,
  generatedAt = new Date().toISOString()
} = {}) {
  const checks = [];
  checks.push(check({
    id: 'schema_valid',
    label: 'Workspace schema valid',
    required: true,
    status: schemaValidation.valid ? 'pass' : 'fail',
    message: schemaValidation.valid ? 'Workspace matches the release artifact workspace schema.' : schemaValidation.errors.join('; '),
    evidence: { schema: WORKSPACE_SCHEMA }
  }));

  const requiredArtifacts = Array.isArray(workspace?.required_artifacts) ? workspace.required_artifacts : [];
  const taskPackets = Array.isArray(workspace?.task_packets) ? workspace.task_packets : [];
  const reviewRequirements = Array.isArray(workspace?.review_requirements) ? workspace.review_requirements : [];
  const authoritativeArtifacts = Array.isArray(workspace?.authoritative_artifacts) ? workspace.authoritative_artifacts : [];
  const mcpHandoff = workspace?.mcp_modeling_handoff || null;
  const checklistRequiredIds = Array.isArray(workspace?.release_checklist_required_check_ids) ? workspace.release_checklist_required_check_ids : [];
  const checklistFailedRequiredIds = Array.isArray(workspace?.release_checklist_failed_required_check_ids) ? workspace.release_checklist_failed_required_check_ids : [];
  const missingChecklistRequiredIds = REQUIRED_RELEASE_CHECKLIST_IDS.filter((id) => !checklistRequiredIds.includes(id));
  const failedChecklistIdsOutsideRequired = checklistFailedRequiredIds.filter((id) => !checklistRequiredIds.includes(id));
  const failedChecklistIdsWithoutBlockers = checklistFailedRequiredIds.filter((id) => {
    const blockers = workspace?.blockers || [];
    return !blockers.includes(`release_draft:${id}`) && !blockers.includes(`work_order:${id}`);
  });
  const requiredAuthoritativeMissing = authoritativeArtifacts.filter((artifact) => artifact.required === true && artifact.exists !== true);
  checks.push(check({
    id: 'required_authoritative_artifacts_exist',
    label: 'Required authoritative artifacts exist',
    required: true,
    status: requiredAuthoritativeMissing.length === 0 ? 'pass' : 'fail',
    message: requiredAuthoritativeMissing.length === 0
      ? 'All required authoritative artifacts exist.'
      : `Missing required authoritative artifacts: ${requiredAuthoritativeMissing.map((artifact) => artifact.role).join(', ')}`,
    evidence: { missing: requiredAuthoritativeMissing.map((artifact) => ({ role: artifact.role, path: artifact.path })) }
  }));

  const requiredRoles = requiredArtifacts.map((artifact) => artifact.role).sort();
  const packetRoles = taskPackets.map((packet) => packet.artifact_role).sort();
  checks.push(check({
    id: 'task_packets_cover_required_artifacts',
    label: 'Task packets cover required artifacts',
    required: true,
    status: sameStrings(requiredRoles, packetRoles) && requiredRoles.length > 0 ? 'pass' : 'fail',
    message: sameStrings(requiredRoles, packetRoles)
      ? 'Each required release artifact has one task packet.'
      : `Required artifact roles (${requiredRoles.join(', ')}) do not match task packet roles (${packetRoles.join(', ')}).`,
    evidence: { required_roles: requiredRoles, packet_roles: packetRoles }
  }));

  const workOrderReviewTaskIds = (workspace?.tasks || [])
    .filter((task) => task.required !== false && REQUIRED_REVIEW_REQUIREMENT_IDS.includes(task.id))
    .map((task) => task.id)
    .sort();
  const reviewRequirementIds = reviewRequirements.map((requirement) => requirement.id).sort();
  checks.push(check({
    id: 'review_requirements_cover_work_order_tasks',
    label: 'Review requirements cover work-order review tasks',
    required: workOrderReviewTaskIds.length > 0,
    status: workOrderReviewTaskIds.length === 0 ? 'review' : sameStrings(workOrderReviewTaskIds, reviewRequirementIds) ? 'pass' : 'fail',
    message: workOrderReviewTaskIds.length === 0
      ? 'No review/promotion tasks were present in the workspace task list.'
      : sameStrings(workOrderReviewTaskIds, reviewRequirementIds)
        ? 'Review requirements cover the release work-order review and promotion tasks.'
        : `Review requirement ids (${reviewRequirementIds.join(', ')}) do not match work-order review task ids (${workOrderReviewTaskIds.join(', ')}).`,
    evidence: { work_order_review_task_ids: workOrderReviewTaskIds, review_requirement_ids: reviewRequirementIds }
  }));

  checks.push(check({
    id: 'release_checklist_required_summary_exposed',
    label: 'Release checklist required summary exposed',
    required: workspace?.release_checklist !== null,
    status: workspace?.release_checklist === null
      ? 'review'
      : missingChecklistRequiredIds.length === 0 && failedChecklistIdsOutsideRequired.length === 0 && failedChecklistIdsWithoutBlockers.length === 0
        ? 'pass'
        : 'fail',
    message: workspace?.release_checklist === null
      ? 'No release checklist artifact is attached to this workspace.'
      : missingChecklistRequiredIds.length === 0 && failedChecklistIdsOutsideRequired.length === 0 && failedChecklistIdsWithoutBlockers.length === 0
        ? 'Workspace exposes required and failed release checklist summaries consistently.'
        : `Release checklist summary is incomplete: ${[
          missingChecklistRequiredIds.length ? `missing required ids ${missingChecklistRequiredIds.join(', ')}` : '',
          failedChecklistIdsOutsideRequired.length ? `failed ids outside required list ${failedChecklistIdsOutsideRequired.join(', ')}` : '',
          failedChecklistIdsWithoutBlockers.length ? `failed ids without blockers ${failedChecklistIdsWithoutBlockers.join(', ')}` : ''
        ].filter(Boolean).join('; ')}`,
    evidence: {
      required_check_ids: checklistRequiredIds,
      failed_required_check_ids: checklistFailedRequiredIds,
      missing_required_check_ids: missingChecklistRequiredIds,
      failed_ids_outside_required: failedChecklistIdsOutsideRequired,
      failed_ids_without_blockers: failedChecklistIdsWithoutBlockers
    }
  }));

  const handoffChecklistRequiredIds = Array.isArray(mcpHandoff?.release_checklist_required_check_ids)
    ? mcpHandoff.release_checklist_required_check_ids.slice().sort()
    : [];
  const handoffChecklistFailedRequiredIds = Array.isArray(mcpHandoff?.release_checklist_failed_required_check_ids)
    ? mcpHandoff.release_checklist_failed_required_check_ids.slice().sort()
    : [];
  const handoffChecklistReviewRequiredIds = Array.isArray(mcpHandoff?.release_checklist_review_required_check_ids)
    ? mcpHandoff.release_checklist_review_required_check_ids.slice().sort()
    : [];
  const checklistReviewRequiredIds = Array.isArray(workspace?.release_checklist_review_required_check_ids)
    ? workspace.release_checklist_review_required_check_ids.slice().sort()
    : [];
  const normalizedChecklistRequiredIds = checklistRequiredIds.slice().sort();
  const normalizedChecklistFailedRequiredIds = checklistFailedRequiredIds.slice().sort();
  const handoffChecklistSummaryMatches = sameStrings(normalizedChecklistRequiredIds, handoffChecklistRequiredIds)
    && sameStrings(normalizedChecklistFailedRequiredIds, handoffChecklistFailedRequiredIds)
    && sameStrings(checklistReviewRequiredIds, handoffChecklistReviewRequiredIds);
  const packetChecklistSummaryMismatches = taskPackets.flatMap((packet) => {
    const constraints = packet.mcp_constraints || {};
    const packetRequired = Array.isArray(constraints.release_checklist_required_check_ids) ? constraints.release_checklist_required_check_ids.slice().sort() : [];
    const packetFailed = Array.isArray(constraints.release_checklist_failed_required_check_ids) ? constraints.release_checklist_failed_required_check_ids.slice().sort() : [];
    const packetReview = Array.isArray(constraints.release_checklist_review_required_check_ids) ? constraints.release_checklist_review_required_check_ids.slice().sort() : [];
    const misses = [];
    if (!sameStrings(normalizedChecklistRequiredIds, packetRequired)) misses.push(`${packet.artifact_role}:required_check_ids`);
    if (!sameStrings(normalizedChecklistFailedRequiredIds, packetFailed)) misses.push(`${packet.artifact_role}:failed_required_check_ids`);
    if (!sameStrings(checklistReviewRequiredIds, packetReview)) misses.push(`${packet.artifact_role}:review_required_check_ids`);
    return misses;
  });
  checks.push(check({
    id: 'release_checklist_summary_propagated_to_mcp_tasks',
    label: 'Release checklist summary propagated to MCP tasks',
    required: workspace?.release_checklist !== null,
    status: workspace?.release_checklist === null
      ? 'review'
      : handoffChecklistSummaryMatches && packetChecklistSummaryMismatches.length === 0
        ? 'pass'
        : 'fail',
    message: workspace?.release_checklist === null
      ? 'No release checklist artifact is attached to this workspace.'
      : handoffChecklistSummaryMatches && packetChecklistSummaryMismatches.length === 0
        ? 'MCP handoff and every task packet inherit the release checklist required/failed/review summary.'
        : `Release checklist summary is not fully propagated: ${[
          handoffChecklistSummaryMatches ? '' : 'mcp_modeling_handoff mismatch',
          packetChecklistSummaryMismatches.length ? `task packet mismatches ${packetChecklistSummaryMismatches.join(', ')}` : ''
        ].filter(Boolean).join('; ')}`,
    evidence: {
      workspace_required_check_ids: normalizedChecklistRequiredIds,
      workspace_failed_required_check_ids: normalizedChecklistFailedRequiredIds,
      workspace_review_required_check_ids: checklistReviewRequiredIds,
      handoff_required_check_ids: handoffChecklistRequiredIds,
      handoff_failed_required_check_ids: handoffChecklistFailedRequiredIds,
      handoff_review_required_check_ids: handoffChecklistReviewRequiredIds,
      packet_mismatches: packetChecklistSummaryMismatches
    }
  }));

  const visionEvidenceReviewBlocked = (workspace?.blockers || []).some((blocker) => [
    'release_draft:vision_evidence_review',
    'work_order:vision_evidence_review',
    'release_vision_evidence_review'
  ].includes(blocker));
  const visionReviewRequirement = reviewRequirements.find((requirement) => requirement.id === 'vision_evidence_review') || null;
  const visionReviewArtifactRoles = (visionReviewRequirement?.artifacts || []).map((artifact) => artifact.role).sort();
  const missingVisionReviewArtifactRoles = REQUIRED_VISION_EVIDENCE_REVIEW_ARTIFACT_ROLES
    .filter((role) => !visionReviewArtifactRoles.includes(role));
  checks.push(check({
    id: 'vision_evidence_review_requirement_exposed',
    label: 'VisionEvidence review requirement exposed',
    required: visionEvidenceReviewBlocked || visionReviewRequirement !== null,
    status: !(visionEvidenceReviewBlocked || visionReviewRequirement !== null)
      ? 'review'
      : visionReviewRequirement && missingVisionReviewArtifactRoles.length === 0
        ? 'pass'
        : 'fail',
    message: !(visionEvidenceReviewBlocked || visionReviewRequirement !== null)
      ? 'No VisionEvidence review blocker or requirement was present.'
      : visionReviewRequirement && missingVisionReviewArtifactRoles.length === 0
        ? 'VisionEvidence review requirement exposes every required review artifact role.'
        : `VisionEvidence review requirement is missing artifact roles: ${missingVisionReviewArtifactRoles.join(', ')}`,
    evidence: {
      blocker_present: visionEvidenceReviewBlocked,
      artifact_roles: visionReviewArtifactRoles,
      missing_roles: missingVisionReviewArtifactRoles,
      artifact_statuses: (visionReviewRequirement?.artifacts || []).map((artifact) => ({
        role: artifact.role,
        status: artifact.status,
        exists: artifact.exists
      }))
    }
  }));

  const visionReviewArtifactByRole = new Map((visionReviewRequirement?.artifacts || []).map((artifact) => [artifact.role, artifact]));
  const visionReviewPatchPath = visionReviewArtifactByRole.get('vision_evidence_review_patch')?.path || null;
  const visionReviewDecisionPath = visionReviewArtifactByRole.get('vision_evidence_review_decision')?.path || null;
  const visionPolicyPatchPath = visionReviewArtifactByRole.get('vision_evidence_policy_correction_patch')?.path || null;
  const visionEvidenceReportPath = visionReviewArtifactByRole.get('vision_evidence_report')?.path || null;
  const visionPolicyCommands = [
    workspace?.commands?.build_vision_evidence_policy_correction_patch || '',
    visionReviewRequirement?.command || ''
  ].filter(Boolean);
  const missingVisionPolicyCommandParts = visionPolicyCommands.flatMap((command, index) => requiredCommandParts({
    command,
    parts: [
      'build-vision-evidence-policy-correction-patch.mjs',
      '--review-patch',
      visionReviewPatchPath,
      '--decision',
      visionReviewDecisionPath,
      '--output',
      visionPolicyPatchPath,
      '--vision-evidence-set',
      visionEvidenceReportPath,
      '--updated-vision-evidence-set'
    ],
    prefix: index === 0 ? 'workspace.commands.build_vision_evidence_policy_correction_patch' : 'review_requirements.vision_evidence_review.command'
  }));
  const visionWorkbenchCommand = workspace?.commands?.prepare_vision_evidence_review_workbench || '';
  const missingVisionWorkbenchCommandParts = requiredCommandParts({
    command: visionWorkbenchCommand,
    parts: [
      'make-vision-evidence-review-workbench.mjs',
      '--review-patch',
      visionReviewPatchPath,
      '--output-dir'
    ],
    prefix: 'workspace.commands.prepare_vision_evidence_review_workbench'
  });
  checks.push(check({
    id: 'vision_evidence_policy_commands_present',
    label: 'VisionEvidence policy commands present',
    required: visionEvidenceReviewBlocked || visionReviewRequirement !== null,
    status: !(visionEvidenceReviewBlocked || visionReviewRequirement !== null)
      ? 'review'
      : visionPolicyCommands.length === 2 && missingVisionPolicyCommandParts.length === 0 && missingVisionWorkbenchCommandParts.length === 0
        ? 'pass'
        : 'fail',
    message: !(visionEvidenceReviewBlocked || visionReviewRequirement !== null)
      ? 'No VisionEvidence review command requirement was present.'
      : visionPolicyCommands.length === 2 && missingVisionPolicyCommandParts.length === 0 && missingVisionWorkbenchCommandParts.length === 0
        ? 'VisionEvidence review workbench and policy correction commands include the required scripts, flags, and artifact paths.'
        : `VisionEvidence policy commands are incomplete: ${[
          visionPolicyCommands.length === 2 ? '' : 'expected workspace and review requirement policy commands',
          ...missingVisionPolicyCommandParts,
          ...missingVisionWorkbenchCommandParts
        ].filter(Boolean).join(', ')}`,
    evidence: {
      policy_commands: visionPolicyCommands,
      workbench_command: visionWorkbenchCommand || null,
      missing_policy_command_parts: missingVisionPolicyCommandParts,
      missing_workbench_command_parts: missingVisionWorkbenchCommandParts
    }
  }));

  const allPacketsReady = taskPackets.length > 0 && taskPackets.every((packet) => packet.status === 'ready_to_author' && packet.ready_to_author === true);
  const readyPacketsRequired = requireReadyToAuthor || workspace?.status === 'ready_for_artifact_authoring';
  checks.push(check({
    id: 'task_packets_ready_to_author',
    label: 'Task packets ready to author',
    required: readyPacketsRequired,
    status: allPacketsReady ? 'pass' : readyPacketsRequired ? 'fail' : 'review',
    message: allPacketsReady
      ? 'All task packets are ready_to_author.'
      : 'Task packets are not all ready_to_author; this is acceptable only for blocked/refill workspaces.',
    evidence: { packet_statuses: taskPackets.map((packet) => ({ role: packet.artifact_role, status: packet.status, ready_to_author: packet.ready_to_author })) }
  }));

  const missingCriteria = taskPackets.flatMap((packet) => {
    const ids = new Set((packet.acceptance_criteria || []).map((criterion) => criterion.id));
    return REQUIRED_PACKET_CRITERIA
      .filter((id) => !ids.has(id))
      .map((id) => `${packet.artifact_role}:${id}`);
  });
  checks.push(check({
    id: 'task_packet_acceptance_criteria_present',
    label: 'Task packet acceptance criteria present',
    required: true,
    status: missingCriteria.length === 0 && taskPackets.length > 0 ? 'pass' : 'fail',
    message: missingCriteria.length === 0
      ? 'All task packets include the required acceptance criteria.'
      : `Missing task packet criteria: ${missingCriteria.join(', ')}`,
    evidence: { required_criteria: REQUIRED_PACKET_CRITERIA, missing: missingCriteria }
  }));

  const missingMcpAuthoringHandoff = taskPackets.flatMap((packet) => {
    const handoff = packet.mcp_authoring_handoff || null;
    const prompt = handoff?.prompt_text || '';
    const digest = handoff?.evidence_digest || {};
    const hasRequiredPromptTokens = prompt.includes('VisionEvidence')
      && prompt.includes('VisionEvidence review workbench')
      && prompt.includes('direct SketchUp DSL')
      && prompt.includes(packet.artifact_role || '')
      && (digest.blocked_interpretations || []).includes('decorative_facade_trim')
      && (digest.blocked_interpretations || []).includes('cut_recess_from_shadow_only')
      && (digest.blocked_outputs || []).includes('direct_sketchup_dsl')
      && digest.vision_evidence_available === true
      && Boolean(digest.vision_evidence_report)
      && Boolean(digest.vision_evidence_review_patch)
      && Boolean(digest.vision_evidence_review_workbench)
      && Number(digest.semantic_evidence_instance_count || 0) > 0
      && Number(digest.modeling_handoff_count || 0) > 0;
    return handoff && hasRequiredPromptTokens ? [] : [packet.artifact_role || packet.task_id || 'unknown'];
  });
  checks.push(check({
    id: 'task_packet_mcp_authoring_handoff_present',
    label: 'Task packet MCP authoring handoff present',
    required: true,
    status: missingMcpAuthoringHandoff.length === 0 && taskPackets.length > 0 ? 'pass' : 'fail',
    message: missingMcpAuthoringHandoff.length === 0
      ? 'All task packets include MCP authoring handoff text with VisionEvidence and fail-closed constraints.'
      : `Missing or incomplete MCP authoring handoff for: ${missingMcpAuthoringHandoff.join(', ')}`,
    evidence: {
      missing: missingMcpAuthoringHandoff,
      packet_handoffs: taskPackets.map((packet) => ({
        role: packet.artifact_role,
        has_prompt: Boolean(packet.mcp_authoring_handoff?.prompt_text),
        vision_evidence_available: packet.mcp_authoring_handoff?.evidence_digest?.vision_evidence_available === true,
        blocked_outputs: packet.mcp_authoring_handoff?.evidence_digest?.blocked_outputs || [],
        blocked_interpretations: packet.mcp_authoring_handoff?.evidence_digest?.blocked_interpretations || [],
        vision_evidence_report: packet.mcp_authoring_handoff?.evidence_digest?.vision_evidence_report || null,
        vision_evidence_review_patch: packet.mcp_authoring_handoff?.evidence_digest?.vision_evidence_review_patch || null,
        vision_evidence_review_workbench: packet.mcp_authoring_handoff?.evidence_digest?.vision_evidence_review_workbench || null
      }))
    }
  }));

  const directDslBlocked = workspace?.can_generate_sketchup_dsl === false
    && mcpHandoff?.can_generate_sketchup_dsl === false
    && (mcpHandoff?.blocked_outputs || []).includes('direct_sketchup_dsl')
    && taskPackets.every((packet) => (packet.mcp_constraints?.blocked_outputs || []).includes('direct_sketchup_dsl'));
  checks.push(check({
    id: 'direct_sketchup_dsl_fail_closed',
    label: 'Direct SketchUp DSL fail-closed',
    required: workspace?.can_generate_sketchup_dsl !== true,
    status: directDslBlocked || workspace?.can_generate_sketchup_dsl === true ? 'pass' : 'fail',
    message: directDslBlocked
      ? 'Workspace and task packets keep direct_sketchup_dsl blocked.'
      : 'Workspace does not consistently propagate the direct_sketchup_dsl block.',
    evidence: {
      workspace_can_generate_sketchup_dsl: workspace?.can_generate_sketchup_dsl,
      mcp_blocked_outputs: mcpHandoff?.blocked_outputs || [],
      packet_blocked_outputs: Array.from(new Set(taskPackets.flatMap((packet) => packet.mcp_constraints?.blocked_outputs || []))).sort()
    }
  }));

  const handoffCriticalTokens = CRITICAL_DISAMBIGUATION_TOKENS.filter((token) => (mcpHandoff?.blocked_interpretations || []).includes(token));
  const missingPacketCriticalTokens = taskPackets.flatMap((packet) => handoffCriticalTokens
    .filter((token) => !(packet.mcp_constraints?.blocked_interpretations || []).includes(token))
    .map((token) => `${packet.artifact_role}:${token}`));
  checks.push(check({
    id: 'candidate_disambiguation_propagated',
    label: 'Candidate disambiguation propagated',
    required: handoffCriticalTokens.length > 0,
    status: handoffCriticalTokens.length === 0 ? 'review' : missingPacketCriticalTokens.length === 0 ? 'pass' : 'fail',
    message: handoffCriticalTokens.length === 0
      ? 'No critical candidate disambiguation tokens were present in the MCP handoff.'
      : missingPacketCriticalTokens.length === 0
        ? 'Critical candidate disambiguation tokens are propagated to every task packet.'
        : `Missing task packet disambiguation tokens: ${missingPacketCriticalTokens.join(', ')}`,
    evidence: { critical_tokens: handoffCriticalTokens, missing: missingPacketCriticalTokens }
  }));

  const handoffSemanticQuality = mcpHandoff?.semantic_evidence_quality || {};
  const semanticQualityRequired = Number(handoffSemanticQuality.required_role_count || 0) > 0
    || (handoffSemanticQuality.review_required_roles || []).length > 0
    || (handoffSemanticQuality.flags || []).length > 0;
  const handoffSemanticRoles = CRITICAL_VISION_EVIDENCE_ROLES.filter((role) => (handoffSemanticQuality.review_required_roles || []).includes(role));
  const missingPacketSemanticQuality = taskPackets.flatMap((packet) => {
    const packetQuality = packet.mcp_constraints?.semantic_evidence_quality || {};
    const missing = [];
    if (semanticQualityRequired && packetQuality.status !== handoffSemanticQuality.status) {
      missing.push(`${packet.artifact_role}:status`);
    }
    if (semanticQualityRequired && packetQuality.geometry_promotion_allowed !== false) {
      missing.push(`${packet.artifact_role}:geometry_promotion_allowed`);
    }
    for (const role of handoffSemanticRoles) {
      if (!(packetQuality.review_required_roles || []).includes(role)) missing.push(`${packet.artifact_role}:${role}`);
    }
    return missing;
  });
  checks.push(check({
    id: 'semantic_evidence_quality_propagated',
    label: 'Semantic evidence quality propagated',
    required: semanticQualityRequired,
    status: !semanticQualityRequired ? 'review' : missingPacketSemanticQuality.length === 0 ? 'pass' : 'fail',
    message: !semanticQualityRequired
      ? 'No semantic evidence quality contract was present in the MCP handoff.'
      : missingPacketSemanticQuality.length === 0
        ? 'Semantic evidence quality and geometry-promotion block are propagated to every task packet.'
        : `Missing task packet semantic evidence quality data: ${missingPacketSemanticQuality.join(', ')}`,
    evidence: {
      handoff_status: handoffSemanticQuality.status || null,
      handoff_review_required_roles: handoffSemanticRoles,
      handoff_geometry_promotion_allowed: handoffSemanticQuality.geometry_promotion_allowed,
      missing: missingPacketSemanticQuality
    }
  }));

  const visionEvidenceRequired = mcpHandoff?.vision_evidence?.available === true
    || authoritativeArtifacts.some((artifact) => artifact.role === 'mcp:vision_evidence_review_patch' && artifact.exists === true);
  const handoffVisionRoles = CRITICAL_VISION_EVIDENCE_ROLES.filter((role) => (mcpHandoff?.vision_evidence?.semantic_review_roles || []).includes(role));
  const missingPacketVisionEvidence = taskPackets.flatMap((packet) => {
    const packetVision = packet.mcp_constraints?.vision_evidence || {};
    const packetRoles = packetVision.semantic_review_roles || [];
    const missingRoles = CRITICAL_VISION_EVIDENCE_ROLES
      .filter((role) => handoffVisionRoles.includes(role))
      .filter((role) => !packetRoles.includes(role))
      .map((role) => `${packet.artifact_role}:${role}`);
    if (visionEvidenceRequired && !packetVision.review_patch_artifact) {
      missingRoles.push(`${packet.artifact_role}:review_patch_artifact`);
    }
    return missingRoles;
  });
  checks.push(check({
    id: 'vision_evidence_review_patch_propagated',
    label: 'VisionEvidence review patch propagated',
    required: visionEvidenceRequired,
    status: !visionEvidenceRequired ? 'review' : missingPacketVisionEvidence.length === 0 ? 'pass' : 'fail',
    message: !visionEvidenceRequired
      ? 'No VisionEvidence review patch was present in the workspace.'
      : missingPacketVisionEvidence.length === 0
        ? 'VisionEvidence review patch and critical semantic roles are propagated to every task packet.'
        : `Missing task packet VisionEvidence data: ${missingPacketVisionEvidence.join(', ')}`,
    evidence: {
      handoff_roles: handoffVisionRoles,
      review_patch_artifact: mcpHandoff?.vision_evidence?.review_patch_artifact || null,
      missing: missingPacketVisionEvidence
    }
  }));

  const handoffVisionInstances = mcpHandoff?.vision_evidence?.semantic_evidence_instances || [];
  const handoffVisionInstanceRoles = CRITICAL_VISION_EVIDENCE_ROLES.filter((role) => hasVisionEvidenceInstance(handoffVisionInstances, role));
  const missingPacketVisionEvidenceInstances = taskPackets.flatMap((packet) => {
    const packetInstances = packet.mcp_constraints?.vision_evidence?.semantic_evidence_instances || [];
    return CRITICAL_VISION_EVIDENCE_ROLES
      .filter((role) => handoffVisionRoles.includes(role))
      .filter((role) => !hasVisionEvidenceInstance(packetInstances, role))
      .map((role) => `${packet.artifact_role}:${role}`);
  });
  const missingHandoffVisionEvidenceInstances = CRITICAL_VISION_EVIDENCE_ROLES
    .filter((role) => handoffVisionRoles.includes(role))
    .filter((role) => !handoffVisionInstanceRoles.includes(role));
  checks.push(check({
    id: 'vision_evidence_instances_propagated',
    label: 'VisionEvidence semantic instances propagated',
    required: visionEvidenceRequired,
    status: !visionEvidenceRequired
      ? 'review'
      : missingHandoffVisionEvidenceInstances.length === 0 && missingPacketVisionEvidenceInstances.length === 0 ? 'pass' : 'fail',
    message: !visionEvidenceRequired
      ? 'No VisionEvidence review patch was present in the workspace.'
      : missingHandoffVisionEvidenceInstances.length === 0 && missingPacketVisionEvidenceInstances.length === 0
        ? 'VisionEvidence semantic instances are propagated to MCP handoff and every task packet.'
        : `Missing VisionEvidence semantic instances: ${[...missingHandoffVisionEvidenceInstances.map((role) => `handoff:${role}`), ...missingPacketVisionEvidenceInstances].join(', ')}`,
    evidence: {
      handoff_roles: handoffVisionRoles,
      handoff_instance_roles: handoffVisionInstanceRoles,
      missing_handoff_roles: missingHandoffVisionEvidenceInstances,
      missing_packet_roles: missingPacketVisionEvidenceInstances
    }
  }));

  const handoffVisionModelingHandoff = mcpHandoff?.vision_evidence?.modeling_handoff || [];
  const handoffVisionModelingHandoffRoles = CRITICAL_VISION_EVIDENCE_ROLES.filter((role) => {
    return hasVisionEvidenceModelingHandoff(handoffVisionModelingHandoff, role, CRITICAL_VISION_EVIDENCE_BLOCKED_INTERPRETATIONS[role]);
  });
  const missingPacketVisionEvidenceModelingHandoff = taskPackets.flatMap((packet) => {
    const packetHandoff = packet.mcp_constraints?.vision_evidence?.modeling_handoff || [];
    return CRITICAL_VISION_EVIDENCE_ROLES
      .filter((role) => handoffVisionRoles.includes(role))
      .filter((role) => !hasVisionEvidenceModelingHandoff(packetHandoff, role, CRITICAL_VISION_EVIDENCE_BLOCKED_INTERPRETATIONS[role]))
      .map((role) => `${packet.artifact_role}:${role}`);
  });
  const missingHandoffVisionEvidenceModelingHandoff = CRITICAL_VISION_EVIDENCE_ROLES
    .filter((role) => handoffVisionRoles.includes(role))
    .filter((role) => !handoffVisionModelingHandoffRoles.includes(role));
  checks.push(check({
    id: 'vision_evidence_modeling_handoff_propagated',
    label: 'VisionEvidence modeling handoff propagated',
    required: visionEvidenceRequired,
    status: !visionEvidenceRequired
      ? 'review'
      : missingHandoffVisionEvidenceModelingHandoff.length === 0 && missingPacketVisionEvidenceModelingHandoff.length === 0 ? 'pass' : 'fail',
    message: !visionEvidenceRequired
      ? 'No VisionEvidence review patch was present in the workspace.'
      : missingHandoffVisionEvidenceModelingHandoff.length === 0 && missingPacketVisionEvidenceModelingHandoff.length === 0
        ? 'VisionEvidence modeling handoff is propagated to MCP handoff and every task packet.'
        : `Missing VisionEvidence modeling handoff: ${[...missingHandoffVisionEvidenceModelingHandoff.map((role) => `handoff:${role}`), ...missingPacketVisionEvidenceModelingHandoff].join(', ')}`,
    evidence: {
      handoff_roles: handoffVisionRoles,
      handoff_modeling_handoff_roles: handoffVisionModelingHandoffRoles,
      missing_handoff_roles: missingHandoffVisionEvidenceModelingHandoff,
      missing_packet_roles: missingPacketVisionEvidenceModelingHandoff
    }
  }));

  const packetsWithValidationCommands = taskPackets.filter((packet) => (packet.verification_commands || []).some((command) => command.includes('validate-real-world-building') || command.includes('release-gate')));
  checks.push(check({
    id: 'verification_commands_present',
    label: 'Verification commands present',
    required: true,
    status: packetsWithValidationCommands.length === taskPackets.length && taskPackets.length > 0 ? 'pass' : 'fail',
    message: 'Each task packet must include at least one release validation or release gate command.',
    evidence: { packets_with_commands: packetsWithValidationCommands.map((packet) => packet.artifact_role) }
  }));

  const sourceRefillCommandsRequired = workspace?.status === 'blocked_needs_source_refill';
  const sourceRefillCommandsOk = !sourceRefillCommandsRequired
    || (
      (workspace.commands?.prepare_source_refill_package || '').includes('prepare-real-world-building-source-refill-package')
      && (workspace.commands?.validate_source_refill_package_require_upload_ready || '').includes('validate-real-world-building-source-refill-package')
      && (workspace.commands?.validate_source_refill_package_require_upload_ready || '').includes('--require-upload-ready')
      && (workspace.commands?.run_refill_upload_session || '').includes('/upload-package')
      && (workspace.commands?.run_refill_upload_session || '').includes('--source-request-file')
    );
  checks.push(check({
    id: 'blocked_source_refill_commands_present',
    label: 'Blocked source refill commands present',
    required: sourceRefillCommandsRequired,
    status: sourceRefillCommandsOk ? 'pass' : sourceRefillCommandsRequired ? 'fail' : 'review',
    message: sourceRefillCommandsOk
      ? 'Blocked source-refill workspace exposes prepare, upload-ready validation, and refill upload-session commands.'
      : 'Blocked source-refill workspace is missing the source-refill package command chain.',
    evidence: {
      prepare_source_refill_package: workspace.commands?.prepare_source_refill_package || null,
      validate_source_refill_package_require_upload_ready: workspace.commands?.validate_source_refill_package_require_upload_ready || null,
      run_refill_upload_session: workspace.commands?.run_refill_upload_session || null
    }
  }));

  const missingRequiredReleaseArtifacts = requiredArtifacts.filter((artifact) => artifact.status !== 'present' || artifact.exists !== true);
  checks.push(check({
    id: 'required_release_artifacts_present',
    label: 'Required release artifacts present',
    required: requireArtifactsPresent || workspace?.status === 'ready_for_formal_validation',
    status: missingRequiredReleaseArtifacts.length === 0 ? 'pass' : (requireArtifactsPresent || workspace?.status === 'ready_for_formal_validation') ? 'fail' : 'review',
    message: missingRequiredReleaseArtifacts.length === 0
      ? 'All required release artifacts are present.'
      : `Required release artifacts are still missing: ${missingRequiredReleaseArtifacts.map((artifact) => artifact.role).join(', ')}`,
    evidence: { missing_roles: missingRequiredReleaseArtifacts.map((artifact) => artifact.role) }
  }));

  const falseReleaseReady = workspace?.release_ready === true && missingRequiredReleaseArtifacts.length > 0;
  checks.push(check({
    id: 'no_release_ready_claim_without_artifacts',
    label: 'No release-ready claim without artifacts',
    required: true,
    status: falseReleaseReady ? 'fail' : 'pass',
    message: falseReleaseReady
      ? 'Workspace claims release_ready while required release artifacts are missing.'
      : 'Workspace release_ready state is consistent with required artifact presence.',
    evidence: { release_ready: workspace?.release_ready, missing_roles: missingRequiredReleaseArtifacts.map((artifact) => artifact.role) }
  }));

  const incompleteRequiredReviewRequirements = reviewRequirements.filter((requirement) => requirement.required !== false && requirement.status !== 'pass');
  checks.push(check({
    id: 'no_release_ready_claim_without_review_requirements',
    label: 'No release-ready claim without review requirements',
    required: true,
    status: workspace?.release_ready === true && incompleteRequiredReviewRequirements.length > 0 ? 'fail' : 'pass',
    message: workspace?.release_ready === true && incompleteRequiredReviewRequirements.length > 0
      ? 'Workspace claims release_ready while required review requirements are not pass.'
      : 'Workspace release_ready state is consistent with review requirement status.',
    evidence: {
      release_ready: workspace?.release_ready,
      incomplete_review_requirements: incompleteRequiredReviewRequirements.map((requirement) => requirement.id)
    }
  }));

  const blockedSourceRefillOk = workspace?.status !== 'blocked_needs_source_refill'
    || taskPackets.every((packet) => packet.status === 'blocked_by_source_refill' && packet.ready_to_author === false);
  checks.push(check({
    id: 'blocked_source_refill_packets_not_authorable',
    label: 'Blocked source-refill packets are not authorable',
    required: workspace?.status === 'blocked_needs_source_refill',
    status: blockedSourceRefillOk ? 'pass' : 'fail',
    message: blockedSourceRefillOk
      ? 'Blocked source-refill workspace does not expose authorable task packets.'
      : 'Blocked source-refill workspace exposes task packets as authorable.',
    evidence: { workspace_status: workspace?.status, packet_statuses: taskPackets.map((packet) => packet.status) }
  }));

  const failedRequiredChecks = checks.filter((item) => item.required && item.status === 'fail').map((item) => item.id);
  const reviewChecks = checks.filter((item) => item.status === 'review').map((item) => item.id);
  return {
    version: 1,
    kind: 'real_world_building_release_artifact_workspace_validation',
    generated_at: generatedAt,
    workspace: workspacePath,
    ok: failedRequiredChecks.length === 0,
    status: validationStatus({ workspace, schemaValid: schemaValidation.valid, failedRequiredChecks, requireReadyToAuthor, requireArtifactsPresent }),
    workspace_status: workspace?.status || null,
    require_ready_to_author: requireReadyToAuthor,
    require_artifacts_present: requireArtifactsPresent,
    summary: {
      checks: checks.length,
      passed_checks: checks.filter((item) => item.status === 'pass').length,
      failed_required_checks: failedRequiredChecks,
      review_checks: reviewChecks
    },
    checks,
    next_actions: validationNextActions({ workspace, failedRequiredChecks, reviewChecks })
  };
}

export function renderWorkspaceValidationMarkdown(report) {
  const lines = [
    '# Real-World Building Release Artifact Workspace Validation',
    '',
    `- Status: \`${report.status}\``,
    `- OK: \`${String(report.ok)}\``,
    `- Workspace: \`${report.workspace}\``,
    `- Workspace status: \`${report.workspace_status || 'none'}\``,
    `- Require ready to author: \`${String(report.require_ready_to_author)}\``,
    `- Require artifacts present: \`${String(report.require_artifacts_present)}\``,
    '',
    '## Checks',
    '',
    '| Check | Required | Status | Message |',
    '| --- | --- | --- | --- |'
  ];
  for (const item of report.checks) {
    lines.push(`| ${item.id} | ${item.required ? 'yes' : 'no'} | ${item.status} | ${escapeMarkdownTable(item.message)} |`);
  }
  lines.push('', '## Next Actions', '');
  for (const action of report.next_actions) lines.push(`- ${action}`);
  return `${lines.join('\n')}\n`;
}

function check({ id, label, required, status, message, evidence = {} }) {
  return {
    id,
    label,
    required: required === true,
    status,
    message,
    evidence
  };
}

function validationStatus({ workspace, schemaValid, failedRequiredChecks, requireReadyToAuthor, requireArtifactsPresent }) {
  if (!schemaValid) return 'invalid_workspace';
  if (failedRequiredChecks.length > 0) return 'blocked';
  if (requireArtifactsPresent) return 'artifacts_present_validated';
  if (requireReadyToAuthor) return 'ready_to_author_validated';
  if (workspace?.status === 'ready_for_artifact_authoring') return 'ready_for_artifact_authoring_validated';
  if (workspace?.status === 'blocked_needs_source_refill') return 'blocked_needs_source_refill_validated';
  if (workspace?.status === 'ready_for_formal_validation') return 'ready_for_formal_validation_validated';
  return 'workspace_validated';
}

function validationNextActions({ workspace, failedRequiredChecks, reviewChecks }) {
  if (failedRequiredChecks.length > 0) {
    return [
      `Resolve failed required workspace validation checks: ${failedRequiredChecks.join(', ')}.`
    ];
  }
  if (workspace?.status === 'ready_for_artifact_authoring') {
    return [
      'Use task_packets to author the reviewed PartGraph, compiler-fresh output, and PhotoGradeReadiness report.',
      'After artifacts exist, rerun this validator with --require-artifacts-present and then validate the release draft.'
    ];
  }
  if (workspace?.status === 'blocked_needs_source_refill') {
    return [
      'Satisfy the source request with real, distinct building sources before authoring release artifacts.'
    ];
  }
  if (reviewChecks.length > 0) {
    return [
      `Review non-blocking validation checks: ${reviewChecks.join(', ')}.`
    ];
  }
  return [
    'Run release draft validation and the image structured release gate before formal promotion.'
  ];
}

function validateWithSchema(schema, value) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const valid = validate(value) === true;
  return {
    valid,
    errors: valid ? [] : (validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message || 'schema error'}`)
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') options.workspace = nextValue(argv, ++index, arg);
    else if (arg === '--output') options.output = nextValue(argv, ++index, arg);
    else if (arg === '--markdown-output') options.markdownOutput = nextValue(argv, ++index, arg);
    else if (arg === '--require-ready-to-author') options.requireReadyToAuthor = true;
    else if (arg === '--require-artifacts-present') options.requireArtifactsPresent = true;
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

function usage() {
  process.stdout.write([
    'Usage: node projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs --workspace <path> [--output <path>] [--markdown-output <path>]',
    '',
    'Validates a real-world building release artifact workspace contract without claiming release readiness.'
  ].join('\n'));
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
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

function toRepoRelative(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).split(path.sep).join('/') || '.';
}

function replaceJsonExt(filePath, ext) {
  return filePath.endsWith('.json') ? `${filePath.slice(0, -5)}${ext}` : `${filePath}${ext}`;
}

function sameStrings(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function requiredCommandParts({ command, parts, prefix }) {
  if (!command) return [`${prefix}:missing_command`];
  return (parts || [])
    .filter((part) => typeof part === 'string' && part.length > 0)
    .filter((part) => !command.includes(part))
    .map((part) => `${prefix}:${part}`);
}

function hasVisionEvidenceInstance(instances = [], role) {
  return (instances || []).some((instance) => {
    return instance.role === role
      && Array.isArray(instance.bbox_px)
      && instance.bbox_px.length === 4
      && instance.bbox_px.every((value) => Number.isFinite(value))
      && instance.source_image
      && instance.source_id
      && instance.view
      && instance.view !== 'unknown'
      && instance.review_required === true;
  });
}

function hasVisionEvidenceModelingHandoff(items = [], role, blockedInterpretation) {
  return (items || []).some((item) => {
    return item.role === role
      && item.review_required === true
      && item.geometry_promotion_allowed === false
      && item.primary_instance
      && Array.isArray(item.primary_instance.bbox_px)
      && item.primary_instance.bbox_px.length === 4
      && item.primary_instance.source_id
      && (item.blocked_interpretations || []).includes(blockedInterpretation);
  });
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  validateRealWorldBuildingReleaseArtifactWorkspaceCli(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.status,
        output: result.output,
        markdown_output: result.markdownOutput,
        failed_required_checks: result.report.summary.failed_required_checks
      }, null, 2)}\n`);
      if (!result.ok) process.exit(1);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
