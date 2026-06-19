#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';

const REQUIRED_RELEASE_ARTIFACTS = [
  {
    role: 'part_graph',
    task_id: 'part_graph',
    label: 'Reviewed PartGraph artifact'
  },
  {
    role: 'output',
    task_id: 'compiled_output',
    label: 'Compiler-fresh SketchUp DSL output'
  },
  {
    role: 'photo_grade_readiness_report',
    task_id: 'photo_grade_readiness',
    label: 'PhotoGradeReadiness report'
  }
];
const RELEASE_REVIEW_TASK_IDS = [
  'vision_evidence_review',
  'human_review',
  'validate_release_draft',
  'promote_formal_manifest'
];
const CRITICAL_VISION_EVIDENCE_ROLES = [
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary'
];

export async function prepareRealWorldBuildingReleaseArtifactWorkspaceCli({
  uploadSessionSummary,
  output = null,
  markdownOutput = null,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!uploadSessionSummary) throw new Error('uploadSessionSummary is required');
  const normalizedOutput = output || path.join(path.dirname(uploadSessionSummary), 'release-artifact-workspace.json');
  const normalizedMarkdownOutput = markdownOutput || replaceJsonExt(normalizedOutput, '.md');
  const summary = await readJson(resolveRepo(uploadSessionSummary));
  const workspace = await buildRealWorldBuildingReleaseArtifactWorkspace({
    uploadSessionSummary,
    summary,
    workspaceOutput: normalizedOutput,
    generatedAt
  });
  await writeJson(resolveRepo(normalizedOutput), workspace);
  await fs.writeFile(resolveRepo(normalizedMarkdownOutput), renderRealWorldBuildingReleaseArtifactWorkspaceMarkdown(workspace), 'utf8');
  return {
    ok: [
      'ready_for_artifact_authoring',
      'needs_human_review',
      'ready_for_formal_validation'
    ].includes(workspace.status),
    status: workspace.status,
    output: normalizedOutput,
    markdownOutput: normalizedMarkdownOutput,
    workspace
  };
}

export async function buildRealWorldBuildingReleaseArtifactWorkspace({
  uploadSessionSummary,
  summary,
  workspaceOutput = null,
  generatedAt = new Date().toISOString()
} = {}) {
  if (!summary || typeof summary !== 'object') throw new Error('summary is required');
  const releaseWorkOrder = await readOptionalJson(summary.artifacts?.real_world_building_release_work_order);
  const releaseManifestDraft = await readOptionalJson(summary.artifacts?.real_world_building_release_manifest_draft);
  const releaseChecklist = await readOptionalJson(summary.artifacts?.real_world_building_release_checklist);
  const handoff = await readOptionalJson(summary.artifacts?.upload_session_handoff);
  const mcpBrief = await readOptionalJson(summary.artifacts?.mcp_modeling_brief);
  const visionEvidenceReviewPatch = await readOptionalJson(
    summary.artifacts?.vision_evidence_review_patch || authoritativeArtifactPath(mcpBrief, 'vision_evidence_review_patch')
  );
  const taskById = new Map((releaseWorkOrder?.tasks || []).map((task) => [task.id, task]));
  const requiredArtifacts = await Promise.all(REQUIRED_RELEASE_ARTIFACTS.map(async (artifact) => {
    const task = taskById.get(artifact.task_id) || null;
    const artifactPath = releaseManifestDraft?.artifacts?.[artifact.role] || task?.artifact_path || null;
    const exists = artifactPath ? await pathExists(resolveRepo(artifactPath)) : false;
    return {
      role: artifact.role,
      task_id: artifact.task_id,
      label: artifact.label,
      path: artifactPath,
      exists,
      status: artifactPath ? exists ? 'present' : 'missing' : 'not_declared',
      command: task?.command || null,
      instructions: task?.instructions || [],
      blockers: task?.blockers || []
    };
  }));
  const tasks = await Promise.all((releaseWorkOrder?.tasks || []).map(async (task) => {
    const artifactExists = task.artifact_path ? await pathExists(resolveRepo(task.artifact_path)) : null;
    return {
      id: task.id,
      label: task.label,
      required: task.required !== false,
      status: task.status,
      artifact_role: task.artifact_role || null,
      artifact_path: task.artifact_path || null,
      artifact_exists: artifactExists,
      blockers: task.blockers || [],
      command: task.command || null,
      instructions: task.instructions || []
    };
  }));
  const status = releaseArtifactWorkspaceStatus({ summary, releaseWorkOrder });
  const mcpModelingHandoff = mcpModelingHandoffForWorkspace({
    mcpBrief,
    visionEvidenceReviewPatch
  });
  const authoritativeArtifacts = await authoritativeArtifactsForWorkspace({
    summary,
    releaseWorkOrder,
    releaseChecklist,
    mcpBrief
  });
  const taskPackets = releaseArtifactTaskPackets({
    status,
    summary,
    releaseWorkOrder,
    requiredArtifacts,
    tasks,
    authoritativeArtifacts,
    mcpModelingHandoff
  });
  const reviewRequirements = await releaseReviewRequirementsForWorkspace({
    releaseWorkOrder,
    releaseChecklist
  });
  const releaseChecklistSummary = releaseChecklistSummaryForWorkspace({ summary, releaseChecklist });
  const blockers = uniqueStrings([
    ...(summary.workflow?.required_user_inputs || []),
    ...(summary.intake?.source_package?.blockers || []),
    ...(summary.real_world_building_release_draft?.blockers || []).map((blocker) => `release_draft:${blocker}`),
    ...(releaseWorkOrder?.blockers || []).map((blocker) => `work_order:${blocker}`),
    ...requiredArtifacts.filter((artifact) => artifact.status !== 'present').map((artifact) => `artifact:${artifact.role}`)
  ]);
  return {
    version: 1,
    kind: 'real_world_building_release_artifact_workspace',
    generated_at: generatedAt,
    upload_session_summary: toRepoRelative(resolveRepo(uploadSessionSummary)),
    status,
    workflow_stage: summary.workflow?.stage || null,
    handoff_status: handoff?.status || summary.handoff?.status || null,
    source_input_ready: summary.intake?.input_ready_for_release_work === true,
    release_ready: summary.real_world_building_release_draft?.release_ready === true || releaseWorkOrder?.release_ready === true,
    can_promote_to_release_manifest: summary.real_world_building_release_draft?.can_promote_to_release_manifest === true || releaseWorkOrder?.can_promote_to_release_manifest === true,
    can_generate_sketchup_dsl: summary.gates?.can_generate_sketchup_dsl === true,
    release_work_order_status: releaseWorkOrder?.status || summary.real_world_building_release_draft?.work_order_status || null,
    release_work_order: summary.artifacts?.real_world_building_release_work_order || null,
    release_manifest_draft: summary.artifacts?.real_world_building_release_manifest_draft || null,
    release_checklist: summary.artifacts?.real_world_building_release_checklist || null,
    release_checklist_required_check_ids: releaseChecklistSummary.required_check_ids,
    release_checklist_failed_required_check_ids: releaseChecklistSummary.failed_required_check_ids,
    release_checklist_review_required_check_ids: releaseChecklistSummary.review_required_check_ids,
    mcp_modeling_handoff: mcpModelingHandoff,
    required_artifacts: requiredArtifacts,
    tasks,
    task_packets: taskPackets,
    review_requirements: reviewRequirements,
    blockers,
    authoritative_artifacts: authoritativeArtifacts,
    commands: {
      prepare_source_refill_package: summary.workflow?.commands?.prepare_source_refill_package || null,
      validate_source_refill_package_require_upload_ready: summary.workflow?.commands?.validate_source_refill_package_require_upload_ready || null,
      run_refill_upload_session: summary.workflow?.commands?.run_refill_upload_session_require_input_ready || summary.workflow?.commands?.run_refill_upload_session || null,
      prepare_release_sample_from_intake: summary.workflow?.commands?.prepare_release_sample_from_intake || null,
      prepare_vision_evidence_review_workbench: summary.workflow?.commands?.prepare_vision_evidence_review_workbench || null,
      build_vision_evidence_policy_correction_patch: summary.workflow?.commands?.build_vision_evidence_policy_correction_patch || visionEvidenceReviewCommandFromRequirements(reviewRequirements),
      validate_release_artifact_workspace: summary.workflow?.commands?.validate_release_artifact_workspace || validationCommandForWorkspace(workspaceOutput),
      validate_release_draft: summary.workflow?.commands?.validate_release_draft || releaseWorkOrder?.commands?.validate_draft || null,
      validate_release_manifest: summary.workflow?.commands?.validate_release_manifest || releaseWorkOrder?.commands?.validate_release_manifest || null,
      run_release_gate: summary.workflow?.commands?.run_release_gate || releaseWorkOrder?.commands?.run_release_gate || null
    },
    next_actions: releaseArtifactWorkspaceNextActions({
      status,
      summary,
      releaseWorkOrder,
      requiredArtifacts,
      reviewRequirements
    })
  };
}

export function renderRealWorldBuildingReleaseArtifactWorkspaceMarkdown(workspace) {
  const lines = [
    '# Real-World Building Release Artifact Workspace',
    '',
    `- Status: \`${workspace.status}\``,
    `- Workflow stage: \`${workspace.workflow_stage || 'none'}\``,
    `- Handoff status: \`${workspace.handoff_status || 'none'}\``,
    `- Source input ready: \`${String(workspace.source_input_ready)}\``,
    `- Release ready: \`${String(workspace.release_ready)}\``,
    `- Can promote to release manifest: \`${String(workspace.can_promote_to_release_manifest)}\``,
    `- Can generate SketchUp DSL: \`${String(workspace.can_generate_sketchup_dsl)}\``,
    `- Release work order status: \`${workspace.release_work_order_status || 'none'}\``,
    `- Required checklist checks: \`${workspace.release_checklist_required_check_ids.join('`, `') || 'none'}\``,
    `- Failed required checklist checks: \`${workspace.release_checklist_failed_required_check_ids.join('`, `') || 'none'}\``,
    '',
    '## Required Artifacts',
    '',
    '| Role | Task | Status | Exists | Path |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const artifact of workspace.required_artifacts) {
    lines.push(`| ${artifact.role} | ${artifact.task_id} | ${artifact.status} | ${String(artifact.exists)} | ${escapeMarkdownTable(artifact.path || '')} |`);
  }
  lines.push('', '## Tasks', '', '| Task | Required | Status | Command |', '| --- | --- | --- | --- |');
  for (const task of workspace.tasks) {
    lines.push(`| ${escapeMarkdownTable(task.label)} | ${task.required ? 'yes' : 'no'} | ${task.status} | ${escapeMarkdownTable(task.command || '')} |`);
  }
  lines.push('', '## MCP Modeling Handoff', '');
  if (workspace.mcp_modeling_handoff) {
    lines.push(`- Status: \`${workspace.mcp_modeling_handoff.status || 'none'}\``);
    lines.push(`- Can generate SketchUp DSL: \`${String(workspace.mcp_modeling_handoff.can_generate_sketchup_dsl)}\``);
    lines.push(`- Blocked outputs: \`${workspace.mcp_modeling_handoff.blocked_outputs.join('`, `') || 'none'}\``);
    lines.push(`- Release checklist required checks: \`${(workspace.mcp_modeling_handoff.release_checklist_required_check_ids || []).join('`, `') || 'none'}\``);
    lines.push(`- Release checklist failed required checks: \`${(workspace.mcp_modeling_handoff.release_checklist_failed_required_check_ids || []).join('`, `') || 'none'}\``);
    lines.push(`- Risk IDs: \`${workspace.mcp_modeling_handoff.risk_ids.join('`, `') || 'none'}\``);
    lines.push(`- Semantic evidence quality: \`${workspace.mcp_modeling_handoff.semantic_evidence_quality?.status || 'unknown'}\``);
    lines.push(`- VisionEvidence available: \`${String(workspace.mcp_modeling_handoff.vision_evidence?.available === true)}\``);
    lines.push(`- VisionEvidence semantic roles: \`${(workspace.mcp_modeling_handoff.vision_evidence?.semantic_review_roles || []).join('`, `') || 'none'}\``);
    lines.push(`- VisionEvidence semantic evidence instances: \`${(workspace.mcp_modeling_handoff.vision_evidence?.semantic_evidence_instances || []).length}\``);
    lines.push(`- VisionEvidence modeling handoff items: \`${(workspace.mcp_modeling_handoff.vision_evidence?.modeling_handoff || []).length}\``);
    const semanticInstances = workspace.mcp_modeling_handoff.vision_evidence?.semantic_evidence_instances || [];
    if (semanticInstances.length > 0) {
      lines.push('', '| VisionEvidence Role | View | Source ID | BBox px | Confidence |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const instance of semanticInstances.slice(0, 12)) {
        lines.push(`| ${instance.role} | ${instance.view} | ${escapeMarkdownTable(instance.source_id || instance.evidence_id || '')} | ${escapeMarkdownTable((instance.bbox_px || []).join(', '))} | ${instance.confidence} |`);
      }
    }
    const modelingHandoff = workspace.mcp_modeling_handoff.vision_evidence?.modeling_handoff || [];
    if (modelingHandoff.length > 0) {
      lines.push('', '| VisionEvidence Handoff Role | Modeling Decision | Primary BBox px | Blocked Interpretations |');
      lines.push('| --- | --- | --- | --- |');
      for (const item of modelingHandoff.slice(0, 12)) {
        const bbox = item.primary_instance?.bbox_px?.join(', ') || '';
        lines.push(`| ${item.role} | ${escapeMarkdownTable(item.modeling_decision)} | ${escapeMarkdownTable(bbox)} | ${escapeMarkdownTable((item.blocked_interpretations || []).join(', '))} |`);
      }
    }
    lines.push('');
    lines.push('| Role | Candidate | Modeling Decision | Blocked Interpretations |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of workspace.mcp_modeling_handoff.critical_disambiguations) {
      lines.push(`| ${item.role} | ${item.candidate_id} | ${escapeMarkdownTable(item.modeling_decision)} | ${escapeMarkdownTable(item.blocked_interpretations.join(', '))} |`);
    }
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## Authoritative Artifacts', '');
  for (const artifact of workspace.authoritative_artifacts) {
    lines.push(`- ${artifact.role}: \`${artifact.path}\`${artifact.required ? ' (required)' : ''}; exists=\`${String(artifact.exists)}\``);
  }
  lines.push('', '## Task Packets', '');
  lines.push('| Task | Status | Artifact | MCP Handoff | Acceptance Criteria | Verification Commands |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const packet of workspace.task_packets) {
    lines.push(`| ${packet.task_id} | ${packet.status} | ${escapeMarkdownTable(packet.artifact_path || '')} | ${packet.mcp_authoring_handoff ? 'yes' : 'no'} | ${packet.acceptance_criteria.length} | ${packet.verification_commands.length} |`);
  }
  for (const packet of workspace.task_packets) {
    if (!packet.mcp_authoring_handoff) continue;
    lines.push('', `### MCP Authoring Handoff: ${packet.artifact_role}`, '');
    lines.push(`- Prompt: ${packet.mcp_authoring_handoff.prompt_text}`);
    lines.push(`- Required actions: \`${packet.mcp_authoring_handoff.required_actions.length}\``);
    lines.push(`- Forbidden actions: \`${packet.mcp_authoring_handoff.forbidden_actions.length}\``);
    lines.push(`- VisionEvidence roles: \`${(packet.mcp_authoring_handoff.evidence_digest?.vision_evidence_roles || []).join('`, `') || 'none'}\``);
    lines.push(`- Blocked interpretations: \`${(packet.mcp_authoring_handoff.evidence_digest?.blocked_interpretations || []).join('`, `') || 'none'}\``);
  }
  lines.push('', '## Review Requirements', '');
  lines.push('| Requirement | Status | Blockers | Required Artifacts |');
  lines.push('| --- | --- | --- | --- |');
  for (const requirement of workspace.review_requirements || []) {
    const artifacts = (requirement.artifacts || []).map((artifact) => `${artifact.role}:${artifact.status}`).join(', ');
    lines.push(`| ${requirement.id} | ${requirement.status} | ${escapeMarkdownTable((requirement.blockers || []).join(', '))} | ${escapeMarkdownTable(artifacts || 'none')} |`);
  }
  lines.push('', '## Commands', '');
  for (const [key, value] of Object.entries(workspace.commands)) {
    lines.push(`- ${key}: \`${value || 'none'}\``);
  }
  lines.push('', '## Next Actions', '');
  if (workspace.next_actions.length) {
    for (const action of workspace.next_actions) lines.push(`- ${action}`);
  } else {
    lines.push('- `none`');
  }
  return `${lines.join('\n')}\n`;
}

function releaseChecklistSummaryForWorkspace({ summary, releaseChecklist }) {
  const draft = summary.real_world_building_release_draft || {};
  const checks = Array.isArray(draft.checklist_checks) && draft.checklist_checks.length > 0
    ? draft.checklist_checks
    : (releaseChecklist?.checks || []).map((check) => ({
      id: check.id,
      status: check.status,
      required: check.required === true
    }));
  const requiredChecks = checks.filter((check) => check.required === true);
  return {
    required_check_ids: uniqueStrings(draft.checklist_required_check_ids || requiredChecks.map((check) => check.id)),
    failed_required_check_ids: uniqueStrings(draft.checklist_failed_required_check_ids || requiredChecks.filter((check) => check.status === 'fail').map((check) => check.id)),
    review_required_check_ids: uniqueStrings(draft.checklist_review_required_check_ids || requiredChecks.filter((check) => check.status === 'review').map((check) => check.id))
  };
}

function mcpModelingHandoffForWorkspace({ mcpBrief, visionEvidenceReviewPatch = null } = {}) {
  if (!mcpBrief) return null;
  const disambiguations = mcpBrief.candidate_disambiguation || [];
  const visionEvidence = mcpBrief.evidence_summary?.vision_evidence || {};
  const semanticEvidenceInstances = semanticEvidenceInstancesForWorkspace(visionEvidenceReviewPatch);
  const modelingHandoff = visionEvidenceModelingHandoffForWorkspace(visionEvidence);
  const semanticEvidenceQuality = semanticEvidenceQualityFromMcpBrief(mcpBrief);
  const releaseChecklistSummary = releaseChecklistSummaryFromMcpBrief(mcpBrief);
  const criticalRoles = new Set([
    'visible_plane_recessed_left',
    'rectangular_utility_ducts',
    'shadow_or_recess_boundary',
    'visible_plane_primary'
  ]);
  return {
    status: mcpBrief.agent_contract?.status || null,
    can_generate_sketchup_dsl: mcpBrief.compile_permission?.can_generate_sketchup_dsl === true,
    can_promote_candidates: mcpBrief.compile_permission?.can_promote_candidates === true,
    allowed_outputs: mcpBrief.agent_contract?.output_policy?.allowed_outputs || [],
    blocked_outputs: mcpBrief.agent_contract?.output_policy?.blocked_outputs || [],
    release_checklist_required_check_ids: releaseChecklistSummary.required_check_ids,
    release_checklist_failed_required_check_ids: releaseChecklistSummary.failed_required_check_ids,
    release_checklist_review_required_check_ids: releaseChecklistSummary.review_required_check_ids,
    risk_ids: uniqueStrings((mcpBrief.grounding_risk_register || []).map((risk) => risk.id)),
    semantic_evidence_quality: semanticEvidenceQuality,
    disambiguation_roles: uniqueStrings(disambiguations.map((item) => item.role)),
    blocked_interpretations: uniqueStrings(disambiguations.flatMap((item) => item.blocked_interpretations || [])),
    required_confirmations: uniqueStrings([
      ...(mcpBrief.agent_contract?.required_confirmations || []),
      ...disambiguations.flatMap((item) => item.required_confirmations || [])
    ]),
    vision_evidence: {
      available: visionEvidence.available === true,
      review_required: visionEvidence.review_required === true,
      verdict: visionEvidence.verdict || null,
      semantic_review_roles: uniqueStrings(visionEvidence.semantic_review_roles || []),
      default_heavy_model_required: visionEvidence.default_heavy_model_required === true,
      review_patch_artifact: authoritativeArtifactPath(mcpBrief, 'vision_evidence_review_patch'),
      semantic_evidence_instances: semanticEvidenceInstances,
      modeling_handoff: modelingHandoff
    },
    critical_disambiguations: disambiguations
      .filter((item) => criticalRoles.has(item.role))
      .map((item) => ({
        candidate_id: item.candidate_id,
        role: item.role,
        view: item.view,
        modeling_decision: item.modeling_decision,
        blocked_interpretations: item.blocked_interpretations || [],
        required_confirmations: item.required_confirmations || [],
        handoff_text: item.handoff_text || ''
      }))
  };
}

function releaseChecklistSummaryFromMcpBrief(mcpBrief) {
  const outputPolicy = mcpBrief?.agent_contract?.output_policy || {};
  const sourcePackageGate = mcpBrief?.source_package_gate || {};
  return {
    required_check_ids: uniqueStrings(outputPolicy.release_checklist_required_check_ids || sourcePackageGate.release_checklist_required_check_ids || []),
    failed_required_check_ids: uniqueStrings(outputPolicy.release_checklist_failed_required_check_ids || sourcePackageGate.release_checklist_failed_required_check_ids || []),
    review_required_check_ids: uniqueStrings(outputPolicy.release_checklist_review_required_check_ids || sourcePackageGate.release_checklist_review_required_check_ids || [])
  };
}

function semanticEvidenceQualityFromMcpBrief(mcpBrief) {
  return mcpBrief?.source_package_gate?.semantic_evidence_quality
    || mcpBrief?.source_request_response_gate?.semantic_evidence?.evidence_quality
    || emptySemanticEvidenceQuality();
}

function semanticEvidenceInstancesForWorkspace(visionEvidenceReviewPatch = null) {
  const instances = [];
  for (const item of visionEvidenceReviewPatch?.review_items || []) {
    if (item.evidence_type !== 'semantic_candidate_policy') continue;
    const role = item.current_value?.role || item.current_value?.class || item.id?.replace(/^semantic_candidate:/, '') || 'semantic_candidate';
    for (const instance of item.current_value?.evidence_instances || []) {
      instances.push({
        role,
        review_item_id: item.id,
        evidence_id: instance.evidence_id || '',
        source_id: instance.source_id || '',
        source_image: instance.source_image || '',
        view: instance.view || 'unknown',
        class: instance.class || role,
        kind: instance.kind || 'region',
        bbox_px: normalizeBbox(instance.bbox_px || []),
        confidence: Number(instance.confidence || 0),
        backend: instance.backend || '',
        source_stage: instance.source_stage || '',
        review_required: instance.review_required === true
      });
    }
  }
  const seen = new Set();
  return instances
    .filter((instance) => instance.role && instance.evidence_id && instance.bbox_px.length === 4)
    .sort((a, b) => semanticEvidenceInstancePriority(a) - semanticEvidenceInstancePriority(b)
      || (b.confidence || 0) - (a.confidence || 0)
      || String(a.source_id).localeCompare(String(b.source_id)))
    .filter((instance) => {
      const key = `${instance.role}:${instance.source_id}:${instance.bbox_px.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 32);
}

function visionEvidenceModelingHandoffForWorkspace(visionEvidence = {}) {
  const items = [];
  for (const item of visionEvidence.modeling_handoff || []) {
    items.push({
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
    });
  }
  return items
    .filter((item) => item.role && item.primary_instance?.bbox_px?.length === 4)
    .sort((a, b) => semanticEvidenceInstancePriority(a) - semanticEvidenceInstancePriority(b)
      || String(a.role).localeCompare(String(b.role)))
    .slice(0, 32);
}

function semanticEvidenceInstancePriority(instance) {
  const index = CRITICAL_VISION_EVIDENCE_ROLES.indexOf(instance.role);
  return index === -1 ? 999 : index;
}

function normalizeBbox(value = []) {
  if (!Array.isArray(value) || value.length < 4) return [];
  return value.slice(0, 4).map((number) => Number(number || 0));
}

function authoritativeArtifactPath(mcpBrief, role) {
  return (mcpBrief.agent_contract?.authoritative_artifacts || []).find((artifact) => artifact.role === role)?.path || null;
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

function emptySemanticEvidenceQuality() {
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

function releaseArtifactTaskPackets({
  status,
  summary,
  releaseWorkOrder,
  requiredArtifacts,
  tasks,
  authoritativeArtifacts,
  mcpModelingHandoff
}) {
  const taskById = new Map((tasks || []).map((task) => [task.id, task]));
  return (requiredArtifacts || []).map((artifact) => {
    const task = taskById.get(artifact.task_id) || null;
    const packetStatus = taskPacketStatus({ workspaceStatus: status, artifact, task });
    const validationCommands = uniqueStrings([
      task?.command || '',
      releaseWorkOrder?.commands?.validate_draft || '',
      summary.workflow?.commands?.validate_release_draft || '',
      summary.workflow?.commands?.validate_release_manifest || '',
      summary.workflow?.commands?.run_release_gate || '',
      releaseWorkOrder?.commands?.run_release_gate || ''
    ]);
    const mcpConstraints = {
      can_generate_sketchup_dsl: mcpModelingHandoff?.can_generate_sketchup_dsl === true,
      can_promote_candidates: mcpModelingHandoff?.can_promote_candidates === true,
      blocked_outputs: uniqueStrings(mcpModelingHandoff?.blocked_outputs || []),
      release_checklist_required_check_ids: uniqueStrings(mcpModelingHandoff?.release_checklist_required_check_ids || []),
      release_checklist_failed_required_check_ids: uniqueStrings(mcpModelingHandoff?.release_checklist_failed_required_check_ids || []),
      release_checklist_review_required_check_ids: uniqueStrings(mcpModelingHandoff?.release_checklist_review_required_check_ids || []),
      blocked_interpretations: uniqueStrings(mcpModelingHandoff?.blocked_interpretations || []),
      required_confirmations: uniqueStrings(mcpModelingHandoff?.required_confirmations || []),
      risk_ids: uniqueStrings(mcpModelingHandoff?.risk_ids || []),
      semantic_evidence_quality: mcpModelingHandoff?.semantic_evidence_quality || emptySemanticEvidenceQuality(),
      vision_evidence: mcpModelingHandoff?.vision_evidence || emptyVisionEvidenceHandoff()
    };
    const inputArtifacts = taskPacketInputArtifacts(authoritativeArtifacts);
    const acceptanceCriteria = acceptanceCriteriaForArtifactPacket({
      artifact,
      packetStatus,
      mcpConstraints
    });
    const completionEvidence = completionEvidenceForArtifactPacket({
      artifact,
      task,
      summary,
      authoritativeArtifacts
    });
    return {
      task_id: artifact.task_id,
      artifact_role: artifact.role,
      artifact_path: artifact.path,
      status: packetStatus,
      ready_to_author: packetStatus === 'ready_to_author',
      work_order_task_status: task?.status || null,
      input_artifacts: inputArtifacts,
      mcp_constraints: mcpConstraints,
      mcp_authoring_handoff: mcpAuthoringHandoffForArtifactPacket({
        artifact,
        packetStatus,
        inputArtifacts,
        mcpConstraints,
        acceptanceCriteria,
        validationCommands
      }),
      acceptance_criteria: acceptanceCriteria,
      completion_evidence: completionEvidence,
      verification_commands: validationCommands,
      next_action: taskPacketNextAction({ artifact, task, packetStatus })
    };
  });
}

function taskPacketStatus({ workspaceStatus, artifact, task }) {
  if (artifact?.status === 'present') return 'artifact_present_needs_validation';
  if (workspaceStatus === 'blocked_needs_source_refill') return 'blocked_by_source_refill';
  if (workspaceStatus === 'ready_for_artifact_authoring') return 'ready_to_author';
  if (workspaceStatus === 'needs_human_review') return 'needs_human_review';
  if (workspaceStatus === 'ready_for_formal_validation') return 'ready_for_formal_validation';
  if (task?.status === 'blocked') return 'blocked_by_release_validation';
  return 'blocked_by_release_validation';
}

function taskPacketInputArtifacts(authoritativeArtifacts) {
  const importantRoles = new Set([
    'upload_session_summary',
    'upload_session_handoff',
    'intake_summary',
    'mcp_modeling_brief',
    'review_workbench',
    'source_package',
    'source_request_response',
    'release_manifest_draft',
    'release_checklist',
    'release_work_order'
  ]);
  return (authoritativeArtifacts || [])
    .filter((artifact) => importantRoles.has(artifact.role) || artifact.role.startsWith('mcp:'))
    .map((artifact) => ({
      role: artifact.role,
      path: artifact.path,
      required: artifact.required === true,
      exists: artifact.exists === true
    }));
}

function mcpAuthoringHandoffForArtifactPacket({
  artifact,
  packetStatus,
  inputArtifacts,
  mcpConstraints,
  acceptanceCriteria,
  validationCommands
}) {
  const visionEvidence = mcpConstraints.vision_evidence || emptyVisionEvidenceHandoff();
  const modelingHandoff = visionEvidence.modeling_handoff || [];
  const semanticInstances = visionEvidence.semantic_evidence_instances || [];
  const visionEvidenceReportArtifact = inputArtifacts.find((item) => item.role === 'mcp:vision_evidence_report')?.path || null;
  const visionEvidenceReviewWorkbench = inputArtifacts.find((item) => item.role === 'mcp:vision_evidence_review_workbench')?.path || null;
  const reviewWorkbench = inputArtifacts.find((item) => item.role === 'review_workbench')?.path || null;
  const blockedInterpretations = uniqueStrings([
    ...(mcpConstraints.blocked_interpretations || []),
    ...modelingHandoff.flatMap((item) => item.blocked_interpretations || [])
  ]);
  const requiredConfirmations = uniqueStrings([
    ...(mcpConstraints.required_confirmations || []),
    ...modelingHandoff.flatMap((item) => item.required_confirmations || [])
  ]);
  const requiredActions = [
    `Author only the ${artifact.role} artifact at ${artifact.path || 'the declared artifact path'}.`,
    'Read the MCP modeling brief, upload-session handoff, source package, release checklist, and VisionEvidence review patch before authoring.',
    'Open the VisionEvidence review workbench before converting visual candidates into authoring decisions.',
    'Use VisionEvidence semantic evidence instances with source image, view, bbox, and confidence as review-gated evidence.',
    'Preserve candidate disambiguation and required confirmations in the produced artifact.',
    'Run the packet verification commands before marking the artifact complete.'
  ];
  const forbiddenActions = [
    'Do not generate direct SketchUp DSL from MCP brief text while direct_sketchup_dsl is blocked.',
    'Do not promote weak or review-required semantic candidates to geometry without accepted review evidence.',
    'Do not merge recessed side facade evidence into the front facade plane.',
    'Do not model rectangular utility ducts as decorative facade trim.',
    'Do not cut recess geometry from shadow-only evidence.'
  ];
  return {
    kind: 'mcp_authoring_handoff',
    artifact_role: artifact.role,
    artifact_path: artifact.path || null,
    status: packetStatus,
    prompt_text: [
      `You are authoring the ${artifact.role} release artifact for a real-world building sample.`,
      `Write only ${artifact.path || 'the declared artifact path'} and keep direct SketchUp DSL blocked unless the release validator later permits it.`,
      `Use these authoritative input artifact roles: ${inputArtifacts.map((item) => item.role).join(', ') || 'none'}.`,
      `Open the VisionEvidence review workbench at ${visionEvidenceReviewWorkbench || 'the declared VisionEvidence review workbench path'} before converting visual candidates into authoring decisions.`,
      `VisionEvidence roles: ${(visionEvidence.semantic_review_roles || []).join(', ') || 'none'}.`,
      `Critical blocked interpretations: ${blockedInterpretations.join(', ') || 'none'}.`,
      `Required confirmations: ${requiredConfirmations.join('; ') || 'none'}.`,
      `Failed required release checks still visible to this packet: ${(mcpConstraints.release_checklist_failed_required_check_ids || []).join(', ') || 'none'}.`
    ].join(' '),
    evidence_digest: {
      input_artifact_roles: inputArtifacts.map((item) => item.role),
      input_artifact_paths: inputArtifacts.map((item) => item.path).filter(Boolean),
      blocked_outputs: mcpConstraints.blocked_outputs || [],
      blocked_interpretations: blockedInterpretations,
      required_confirmations: requiredConfirmations,
      release_checklist_failed_required_check_ids: mcpConstraints.release_checklist_failed_required_check_ids || [],
      semantic_evidence_quality_status: mcpConstraints.semantic_evidence_quality?.status || 'unknown',
      geometry_promotion_allowed: mcpConstraints.semantic_evidence_quality?.geometry_promotion_allowed === true,
      vision_evidence_available: visionEvidence.available === true,
      review_workbench: reviewWorkbench,
      vision_evidence_report: visionEvidenceReportArtifact,
      vision_evidence_review_patch: visionEvidence.review_patch_artifact || null,
      vision_evidence_review_workbench: visionEvidenceReviewWorkbench,
      vision_evidence_roles: visionEvidence.semantic_review_roles || [],
      semantic_evidence_instance_count: semanticInstances.length,
      semantic_evidence_instance_roles: uniqueStrings(semanticInstances.map((instance) => instance.role)),
      modeling_handoff_count: modelingHandoff.length,
      modeling_handoff_roles: uniqueStrings(modelingHandoff.map((item) => item.role))
    },
    required_actions: requiredActions,
    forbidden_actions: forbiddenActions,
    acceptance_criteria_ids: (acceptanceCriteria || []).map((criterion) => criterion.id),
    verification_commands: validationCommands || []
  };
}

function acceptanceCriteriaForArtifactPacket({ artifact, packetStatus, mcpConstraints }) {
  const baseStatus = packetStatus === 'blocked_by_source_refill' || packetStatus === 'blocked_by_release_validation'
    ? 'blocked'
    : 'pending';
  const directDslBlockStatus = mcpConstraints.blocked_outputs.includes('direct_sketchup_dsl') && mcpConstraints.can_generate_sketchup_dsl === false
    ? 'satisfied'
    : baseStatus;
  const disambiguationStatus = [
    'merged_front_facade_plane',
    'decorative_facade_trim',
    'cut_recess_from_shadow_only'
  ].every((token) => mcpConstraints.blocked_interpretations.includes(token))
    ? 'satisfied'
    : baseStatus;
  const visionEvidenceStatus = (
    mcpConstraints.vision_evidence?.available === true
    && mcpConstraints.vision_evidence?.review_patch_artifact
	    && [
	      'visible_plane_recessed_left',
	      'rectangular_utility_ducts',
	      'shadow_or_recess_boundary'
    ].every((role) => (mcpConstraints.vision_evidence?.semantic_review_roles || []).includes(role))
  ) ? 'satisfied' : baseStatus;
  const visionEvidenceInstanceStatus = CRITICAL_VISION_EVIDENCE_ROLES.every((role) => {
    return (mcpConstraints.vision_evidence?.semantic_evidence_instances || []).some((instance) => {
      return instance.role === role
        && Array.isArray(instance.bbox_px)
        && instance.bbox_px.length === 4
        && instance.review_required === true;
    });
  }) ? 'satisfied' : baseStatus;
  const criticalVisionEvidenceBlockedInterpretations = {
    visible_plane_recessed_left: 'merged_front_facade_plane',
    rectangular_utility_ducts: 'decorative_facade_trim',
    shadow_or_recess_boundary: 'cut_recess_from_shadow_only'
  };
  const visionEvidenceModelingHandoffStatus = CRITICAL_VISION_EVIDENCE_ROLES.every((role) => {
    const blockedInterpretation = criticalVisionEvidenceBlockedInterpretations[role];
    return (mcpConstraints.vision_evidence?.modeling_handoff || []).some((item) => {
      return item.role === role
        && item.review_required === true
        && item.geometry_promotion_allowed === false
        && item.primary_instance?.bbox_px?.length === 4
        && (item.blocked_interpretations || []).includes(blockedInterpretation);
    });
  }) ? 'satisfied' : baseStatus;
  const semanticQuality = mcpConstraints.semantic_evidence_quality || emptySemanticEvidenceQuality();
  const semanticQualityRequired = Number(semanticQuality.required_role_count || 0) > 0
    || (semanticQuality.review_required_roles || []).length > 0
    || (semanticQuality.flags || []).length > 0;
  const semanticQualityStatus = semanticQualityRequired && semanticQuality.geometry_promotion_allowed === false
    ? 'satisfied'
    : baseStatus;
  const failedRequiredChecks = mcpConstraints.release_checklist_failed_required_check_ids || [];
  const releaseChecklistStatus = failedRequiredChecks.length === 0
    ? 'satisfied'
    : baseStatus;
  const criteria = [
    criterion('use_authoritative_inputs_only', baseStatus, 'Use only upload-session, review workbench, source package, release work order, and MCP brief artifacts listed in input_artifacts.', 'input_artifacts list'),
    criterion('do_not_generate_direct_dsl_from_mcp_brief', directDslBlockStatus, 'Do not emit SketchUp DSL directly from the MCP brief while direct_sketchup_dsl is blocked.', 'mcp_constraints.blocked_outputs'),
    criterion('preserve_candidate_disambiguation', disambiguationStatus, 'Preserve candidate disambiguation: recessed planes stay separate, rectangular ducts stay utility candidates, and shadows stay review markers until confirmed.', 'mcp_constraints.blocked_interpretations'),
    criterion('preserve_semantic_evidence_quality', semanticQualityStatus, 'Preserve semantic evidence quality: weak/review-required semantic roles remain review-gated and geometry promotion stays blocked until confirmed.', 'mcp_constraints.semantic_evidence_quality'),
    criterion('use_vision_evidence_review_patch', visionEvidenceStatus, 'Use the VisionEvidence review patch before authoring release artifacts; recessed facade, rectangular duct, and shadow/recess semantic policies must stay review-gated until confirmed.', 'mcp_constraints.vision_evidence.review_patch_artifact'),
    criterion('use_vision_evidence_instances', visionEvidenceInstanceStatus, 'Use VisionEvidence semantic evidence instances with source image, view, bbox, and confidence before authoring release artifacts.', 'mcp_constraints.vision_evidence.semantic_evidence_instances'),
    criterion('use_vision_evidence_modeling_handoff', visionEvidenceModelingHandoffStatus, 'Use VisionEvidence modeling handoff decisions with primary bbox, blocked interpretations, and required confirmations before authoring release artifacts.', 'mcp_constraints.vision_evidence.modeling_handoff'),
    criterion('address_failed_required_release_checks', releaseChecklistStatus, 'Address failed required release checklist checks before claiming this artifact task complete.', `mcp_constraints.release_checklist_failed_required_check_ids=${failedRequiredChecks.join(',') || 'none'}`)
  ];
  if (artifact.role === 'part_graph') {
    criteria.push(
      criterion('part_graph_exists', baseStatus, 'Write a reviewed PartGraph artifact at the declared path.', artifact.path || 'artifact path not declared'),
      criterion('accepted_candidates_only', baseStatus, 'Promote only accepted candidate-promotion-review evidence; do not promote blocked or review-only candidates.', 'candidate_promotion_review'),
      criterion('source_provenance_alignment', baseStatus, 'Every source_image/source_images reference used by PartGraph evidence must be covered by the release manifest source_images.', 'manifest source_images')
    );
  } else if (artifact.role === 'output') {
    criteria.push(
      criterion('compiled_from_reviewed_part_graph', baseStatus, 'Compile output from the reviewed PartGraph, not from raw image text or MCP brief prose.', 'compile command'),
      criterion('compiler_fresh_output', baseStatus, 'Output must be compiler-fresh and match a recompile during release manifest validation.', 'validate-real-world-building'),
      criterion('physical_consistency_pass', baseStatus, 'Physical consistency QA must pass for the compiled building model.', 'physical-consistency report')
    );
  } else if (artifact.role === 'photo_grade_readiness_report') {
    criteria.push(
      criterion('photo_grade_readiness_report_exists', baseStatus, 'Write a PhotoGradeReadiness report at the declared path.', artifact.path || 'artifact path not declared'),
      criterion('photo_grade_release_blockers_resolved', baseStatus, 'Resolve photo-grade source, geometry, scale, and review blockers before claiming release readiness.', 'PhotoGradeReadiness blockers'),
      criterion('human_review_trace_present', baseStatus, 'Keep human review notes linked to the source evidence and release checklist.', 'release checklist human_review')
    );
  }
  return criteria;
}

function criterion(id, status, requirement, evidence) {
  return {
    id,
    status,
    requirement,
    evidence
  };
}

function completionEvidenceForArtifactPacket({ artifact, task, summary, authoritativeArtifacts }) {
  const existsByRole = new Map((authoritativeArtifacts || []).map((item) => [item.role, item.exists === true]));
  return [
    {
      id: `${artifact.role}_path`,
      kind: 'artifact_path',
      path: artifact.path,
      required: true,
      exists: artifact.exists === true
    },
    {
      id: `${artifact.role}_work_order_task`,
      kind: 'work_order_task',
      path: summary.artifacts?.real_world_building_release_work_order || null,
      required: true,
      exists: task !== null
    },
    {
      id: 'release_manifest_draft',
      kind: 'release_manifest_draft',
      path: summary.artifacts?.real_world_building_release_manifest_draft || null,
      required: true,
      exists: existsByRole.get('release_manifest_draft') === true
    },
    {
      id: 'release_checklist',
      kind: 'release_checklist',
      path: summary.artifacts?.real_world_building_release_checklist || null,
      required: true,
      exists: existsByRole.get('release_checklist') === true
    }
  ];
}

function taskPacketNextAction({ artifact, task, packetStatus }) {
  if (packetStatus === 'blocked_by_source_refill') return 'Satisfy the source request with real, distinct building sources before authoring release artifacts.';
  if (packetStatus === 'artifact_present_needs_validation') return `Validate ${artifact.role} through the release checklist and release gate before promotion.`;
  if (packetStatus === 'ready_to_author') return task?.instructions?.[0] || `Create ${artifact.role} at ${artifact.path || 'the declared path'}.`;
  if (packetStatus === 'needs_human_review') return 'Complete human review fields and confirm release checklist status.';
  if (packetStatus === 'ready_for_formal_validation') return 'Run draft validation and release gate before writing the formal manifest.';
  return 'Inspect upload-session summary, release checklist, and work order blockers before continuing.';
}

function releaseArtifactWorkspaceStatus({ summary, releaseWorkOrder }) {
  const workflowStage = summary.workflow?.stage || null;
  if ([
    'preflight_blocked',
    'source_refill_required',
    'source_response_refill_required'
  ].includes(workflowStage)) return 'blocked_needs_source_refill';
  if (releaseWorkOrder?.status === 'needs_release_artifacts') return 'ready_for_artifact_authoring';
  if (releaseWorkOrder?.status === 'needs_human_review') return 'needs_human_review';
  if (releaseWorkOrder?.status === 'ready_for_formal_manifest' || workflowStage === 'release_manifest_ready') return 'ready_for_formal_validation';
  if (workflowStage === 'source_input_ready_needs_release_artifacts') return 'ready_for_artifact_authoring';
  return 'blocked_release_validation';
}

async function authoritativeArtifactsForWorkspace({
  summary,
  releaseWorkOrder,
  releaseChecklist,
  mcpBrief
}) {
  const artifacts = [
    { role: 'upload_session_summary', path: summary.artifacts?.upload_session_summary, required: true },
    { role: 'upload_session_handoff', path: summary.artifacts?.upload_session_handoff, required: true },
    { role: 'preflight', path: summary.artifacts?.preflight, required: true },
    { role: 'intake_summary', path: summary.artifacts?.intake_summary, required: false },
    { role: 'mcp_modeling_brief', path: summary.artifacts?.mcp_modeling_brief, required: false },
    { role: 'review_workbench', path: summary.artifacts?.review_workbench, required: false },
    { role: 'source_package', path: summary.artifacts?.source_package, required: false },
    { role: 'source_request', path: summary.artifacts?.source_request, required: false },
    { role: 'source_request_response', path: summary.artifacts?.source_request_response, required: false },
    { role: 'upload_manifest_template', path: summary.artifacts?.upload_manifest_template, required: false },
    { role: 'release_manifest_draft', path: summary.artifacts?.real_world_building_release_manifest_draft, required: false },
    { role: 'release_checklist', path: summary.artifacts?.real_world_building_release_checklist, required: false },
    { role: 'release_work_order', path: summary.artifacts?.real_world_building_release_work_order, required: false }
  ].filter((artifact) => artifact.path);
  if (releaseWorkOrder?.manifest) artifacts.push({ role: 'work_order_manifest', path: releaseWorkOrder.manifest, required: false });
  if (releaseChecklist?.manifest) artifacts.push({ role: 'checklist_manifest', path: releaseChecklist.manifest, required: false });
  if (mcpBrief?.agent_contract?.authoritative_artifacts) {
    for (const artifact of mcpBrief.agent_contract.authoritative_artifacts) {
      artifacts.push({ role: `mcp:${artifact.role}`, path: artifact.path, required: artifact.required === true });
    }
  }
  const unique = uniqueArtifacts(artifacts);
  return Promise.all(unique.map(async (artifact) => ({
    ...artifact,
    exists: await pathExists(resolveRepo(artifact.path))
  })));
}

async function releaseReviewRequirementsForWorkspace({ releaseWorkOrder, releaseChecklist }) {
  const checklistById = new Map((releaseChecklist?.checks || []).map((check) => [check.id, check]));
  return Promise.all((releaseWorkOrder?.tasks || [])
    .filter((task) => RELEASE_REVIEW_TASK_IDS.includes(task.id))
    .map(async (task) => {
      const artifacts = await Promise.all((task.artifacts || []).map(async (artifact) => {
        const artifactPath = typeof artifact.path === 'string' && artifact.path.length > 0 ? artifact.path : null;
        const exists = artifactPath ? await pathExists(resolveRepo(artifactPath)) : false;
        return {
          role: artifact.role,
          path: artifactPath,
          exists,
          status: artifact.status || (exists ? 'pass' : 'fail')
        };
      }));
      return {
        id: task.id,
        label: task.label,
        required: task.required !== false,
        status: task.status,
        checklist_status: checklistById.get(task.id)?.status || null,
        blockers: task.blockers || [],
        command: task.command || null,
        instructions: task.instructions || [],
        artifacts,
        review: task.review || null,
        metrics: task.metrics || null
      };
    }));
}

function releaseArtifactWorkspaceNextActions({
  status,
  summary,
  releaseWorkOrder,
  requiredArtifacts,
  reviewRequirements
}) {
  if (status === 'blocked_needs_source_refill') {
    return uniqueStrings([
      ...(summary.next_actions || []),
      'Upload a replacement source package that satisfies the source request before producing release artifacts.'
    ]);
  }
  if (status === 'ready_for_artifact_authoring') {
    return uniqueStrings([
      'Produce the reviewed PartGraph, compiler-fresh output, and PhotoGradeReadiness report listed in required_artifacts.',
      ...reviewRequirements.filter((requirement) => requirement.status !== 'pass').map((requirement) => `Complete release review requirement ${requirement.id}.`),
      ...(releaseWorkOrder?.next_actions || []),
      ...requiredArtifacts.filter((artifact) => artifact.status !== 'present').map((artifact) => `Create or update ${artifact.role}: ${artifact.path || 'path not declared'}.`)
    ]);
  }
  if (status === 'needs_human_review') {
    return uniqueStrings([
      ...(releaseWorkOrder?.next_actions || []),
      'Fill reviewer, accepted_at, and notes after human review before formal validation.'
    ]);
  }
  if (status === 'ready_for_formal_validation') {
    return uniqueStrings([
      'Run the draft validation command, then promote only if the release checklist remains ready.',
      releaseWorkOrder?.commands?.validate_draft || ''
    ]);
  }
  return uniqueStrings([
    ...(summary.next_actions || []),
    ...(releaseWorkOrder?.next_actions || []),
    'Inspect upload-session summary, release checklist, and release work order before continuing.'
  ]);
}

function visionEvidenceReviewCommandFromRequirements(reviewRequirements) {
  return (reviewRequirements || []).find((requirement) => requirement.id === 'vision_evidence_review')?.command || null;
}

function validationCommandForWorkspace(workspaceOutput) {
  if (!workspaceOutput) return null;
  return [
    'npm run image-structured:validate-real-world-building-release-artifact-workspace --',
    '--workspace',
    cliArg(toRepoRelative(resolveRepo(workspaceOutput)))
  ].join(' ');
}

function cliArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--upload-session-summary') options.uploadSessionSummary = args[++index];
    else if (arg === '--output') options.output = args[++index];
    else if (arg === '--markdown-output') options.markdownOutput = args[++index];
    else if (arg === '--generated-at') options.generatedAt = args[++index];
    else if (arg === '--help') {
      process.stdout.write([
        'Usage: node projects/image-structured-modeler/scripts/prepare-real-world-building-release-artifact-workspace.mjs --upload-session-summary <path> [--output <path>] [--markdown-output <path>]',
        '',
        'Builds a fail-closed release artifact workspace from a real-world building upload-session summary.'
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function readOptionalJson(filePath) {
  if (!filePath) return null;
  const absolute = resolveRepo(filePath);
  if (!await pathExists(absolute)) return null;
  return readJson(absolute);
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

function replaceJsonExt(filePath, ext) {
  return filePath.endsWith('.json') ? `${filePath.slice(0, -5)}${ext}` : `${filePath}${ext}`;
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).split(path.sep).join('/') || '.';
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.length > 0))).sort();
}

function uniqueArtifacts(artifacts) {
  const byKey = new Map();
  for (const artifact of artifacts || []) {
    if (!artifact?.role || !artifact?.path) continue;
    byKey.set(`${artifact.role}\n${artifact.path}`, artifact);
  }
  return Array.from(byKey.values());
}

function escapeMarkdownTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  prepareRealWorldBuildingReleaseArtifactWorkspaceCli(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        status: result.status,
        output: result.output,
        markdown_output: result.markdownOutput
      }, null, 2)}\n`);
      if (result.status === 'blocked_release_validation') process.exit(1);
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exit(1);
    });
}
