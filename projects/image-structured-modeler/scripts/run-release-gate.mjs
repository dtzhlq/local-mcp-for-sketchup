#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { validatePartGraphPhysicalConsistency } from '../../../src/product-modeling/physical-consistency-qa.mjs';
import { applyCandidatePromotionPatch } from './apply-candidate-promotion-patch.mjs';
import { buildCandidatePromotionPatch } from './build-candidate-promotion-patch.mjs';
import { compilePlanToSketchUpDsl } from './compile-plan-to-sketchup-dsl.mjs';
import { buildStructuredAssetIntake } from './intake-assets.mjs';
import { auditRealWorldBuildingDemoCandidates } from './audit-real-world-building-demo-candidates.mjs';
import { prepareRealWorldBuildingSourceRefillPackageCli } from './prepare-real-world-building-source-refill-package.mjs';
import { validateRealWorldBuildingSourceRefillPackageCli } from './validate-real-world-building-source-refill-package.mjs';
import { prepareRealWorldBuildingReleaseSampleCli } from './prepare-real-world-building-release-sample.mjs';
import { prepareRealWorldBuildingReleaseArtifactWorkspaceCli } from './prepare-real-world-building-release-artifact-workspace.mjs';
import { validateRealWorldBuildingReleaseArtifactWorkspaceCli } from './validate-real-world-building-release-artifact-workspace.mjs';
import { assessRealWorldBuildingSourcePackageCli } from './assess-real-world-building-source-package.mjs';
import { preflightRealWorldBuildingSourcePackageCli } from './preflight-real-world-building-source-package.mjs';
import { runRealWorldBuildingUploadSession } from './run-real-world-building-upload-session.mjs';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  buildMcpModelingBrief,
  renderMcpModelingBriefMarkdown
} from './lib/mcp-modeling-brief.mjs';
import {
  DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
  validateRealWorldBuildingPositiveManifestPath
} from './lib/real-world-building-release-sample.mjs';
import {
  applyVisionEvidencePolicyCorrectionPatch,
  buildAcceptedVisionEvidenceReviewDecision,
  buildVisionEvidencePolicyCorrectionPatch,
  buildVisionEvidenceReviewPatch,
  renderVisionEvidencePolicyCorrectionPatchMarkdown,
  renderVisionEvidenceReviewPatchMarkdown,
  renderVisionEvidenceReviewWorkbenchHtml
} from './lib/vision-evidence-set-v1.mjs';

const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/release-gate';
const CANONICAL_SINGLE_INPUT = 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png';
const CANONICAL_SINGLE_VIEW_HINTS = 'projects/image-structured-modeler/examples/building-single-anime-yellow/view-hints.json';
const CANONICAL_SINGLE_ANNOTATIONS = 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-annotations.md';
const CANONICAL_SINGLE_VLM_CANDIDATES = 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-vlm-candidates.json';
const USER_BUILDING_SINGLE_INPUT = 'test/建筑单体';
const TRACKED_BUILDING_SINGLE_BLUEPRINT_INPUT = 'test/建筑群/建筑单体';
const MULTIMODAL_FIXTURE_INPUT = 'projects/image-structured-modeler/examples/multimodal-intake';
const MULTIMODAL_PARSER_MATRIX_INPUT = 'projects/image-structured-modeler/examples/multimodal-parser-matrix';
const BUILDING_SINGLE_PROFILE = 'examples/product-profiles/building_single_urban_oblique.json';
const BUILDING_GROUP_PROFILE = 'examples/product-profiles/building_group_industrial_campus.json';
const REAL_WORLD_BUILDING_UPLOAD_MANIFEST_SCHEMA = 'projects/image-structured-modeler/schema/real-world-building-upload-manifest.schema.json';
const ACCEPTED_POSITIVE_BUILDING_GROUP = {
  observations: 'projects/image-structured-modeler/examples/building-group/observations.json',
  partGraph: 'projects/image-structured-modeler/examples/building-group/part-graph.r7-final.json',
  output: 'projects/image-structured-modeler/examples/building-group/output.r7-final.json',
  layoutQa: 'projects/image-structured-modeler/examples/building-group/layout-qa-r7-final/building-group-r7-final/report.json',
  referenceQa: 'projects/image-structured-modeler/examples/building-group/reference-visual-qa-r7-final/building-group-r7-final/report.json',
  proposalQa: 'projects/image-structured-modeler/examples/building-group/proposal-qa-r7-final/report.json',
  queueProposalQa: 'projects/image-structured-modeler/examples/building-group/proposal-qa-r7-final-queue/report.json'
};
const REAL_WORLD_SWITCH_PRODUCT = {
  observations: 'projects/image-structured-modeler/examples/switch-controller/observations.json',
  modelPlan: 'projects/image-structured-modeler/examples/switch-controller/model-plan.json',
  output: 'projects/image-structured-modeler/examples/switch-controller/output.json',
  snapshot: 'projects/image-structured-modeler/examples/switch-controller/review/snapshot-report.json',
  queueSnapshot: 'projects/image-structured-modeler/examples/switch-controller/review/snapshot-report-queue.json',
  queueDiff: 'projects/image-structured-modeler/examples/switch-controller/review/snapshot-diff-queue.json',
  visualRelation: 'projects/image-structured-modeler/examples/switch-controller/visual-relation-qa/report.json',
  geometryFit: 'projects/image-structured-modeler/examples/switch-controller/visual-relation-qa/geometry-fit-report.json'
};
const RHINO_FACTORY_VISUAL_GAP = {
  findings: 'projects/image-structured-modeler/examples/building-single-rhino-factory/test-findings.json',
  modelQa: 'projects/image-structured-modeler/examples/building-single-rhino-factory/model-qa-report.md',
  queueModelQa: 'projects/image-structured-modeler/examples/building-single-rhino-factory/model-qa-report-queue.md'
};
const REQUIRED_BUILDING_SINGLE_ROLES = [
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary'
];
const RELEASE_CONTRACT_DRIFT_CHECKS = [
  {
    id: 'prepare_workspace_script_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/scripts/prepare-real-world-building-release-artifact-workspace.mjs'
  },
  {
    id: 'validate_workspace_script_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs'
  },
  {
    id: 'workspace_schema_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json'
  },
  {
    id: 'workspace_validation_schema_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace-validation.schema.json'
  },
  {
    id: 'artifact_integrity_schema_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/schema/release-gate-artifact-integrity-report.schema.json'
  },
  {
    id: 'image_observation_schema_exposes_content_frame',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/image-observation.schema.json',
    token: 'auto_screenshot_chrome_v1'
  },
  {
    id: 'image_set_schema_exposes_content_frame',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/image-set-observation.schema.json',
    token: 'content_frame'
  },
  {
    id: 'image_analysis_applies_content_frame_before_bbox',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/lib/image-analysis.mjs',
    token: 'detectContentFrame'
  },
  {
    id: 'workspace_prepare_npm_script',
    kind: 'package_script_contains',
    script: 'image-structured:prepare-real-world-building-release-artifact-workspace',
    token: 'prepare-real-world-building-release-artifact-workspace.mjs'
  },
  {
    id: 'workspace_validate_npm_script',
    kind: 'package_script_contains',
    script: 'image-structured:validate-real-world-building-release-artifact-workspace',
    token: 'validate-real-world-building-release-artifact-workspace.mjs'
  },
  {
    id: 'upload_session_schema_exposes_workspace_validator_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json',
    token: 'validate_release_artifact_workspace'
  },
  {
    id: 'handoff_schema_exposes_workspace_validator_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json',
    token: 'validate_release_artifact_workspace'
  },
  {
    id: 'handoff_schema_exposes_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json',
    token: 'release_checklist_failed_required_check_ids'
  },
  {
    id: 'handoff_schema_exposes_artifact_exists_state',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json',
    token: 'artifact_exists'
  },
  {
    id: 'handoff_schema_exposes_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json',
    token: 'Handoff semantic evidence quality gate'
  },
  {
    id: 'handoff_schema_exposes_vision_evidence_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json',
    token: 'vision_evidence'
  },
  {
    id: 'handoff_schema_exposes_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json',
    token: 'modeling_handoff'
  },
  {
    id: 'upload_session_schema_exposes_handoff_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json',
    token: 'Handoff semantic evidence quality gate'
  },
  {
    id: 'upload_session_schema_exposes_handoff_vision_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json',
    token: 'vision_evidence'
  },
  {
    id: 'vision_review_patch_schema_exposes_semantic_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/vision-evidence-review-patch.schema.json',
    token: 'evidence_instances'
  },
  {
    id: 'vision_evidence_builder_emits_semantic_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/lib/vision-evidence-set-v1.mjs',
    token: 'semanticEvidenceInstance'
  },
  {
    id: 'mcp_brief_schema_exposes_vision_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'semantic_evidence_instances'
  },
  {
    id: 'mcp_brief_schema_exposes_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'modeling_handoff'
  },
  {
    id: 'mcp_brief_schema_has_resolvable_defs',
    kind: 'json_schema_defs',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    defs: [
      'viewEvidenceList',
      'semanticRoleEvidenceList',
      'semanticEvidenceQuality',
      'viewEvidenceSummary',
      'semanticEvidenceSummary',
      'visionEvidenceSummary',
      'semanticEvidenceInstance',
      'visionEvidenceModelingHandoff'
    ]
  },
  {
    id: 'all_subproject_json_schema_refs_resolve',
    kind: 'json_schema_refs_resolvable',
    path: 'projects/image-structured-modeler/schema'
  },
  {
    id: 'mcp_brief_builder_emits_vision_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/lib/mcp-modeling-brief.mjs',
    token: 'semanticEvidenceInstancesForMcpBrief'
  },
  {
    id: 'mcp_brief_builder_emits_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/lib/mcp-modeling-brief.mjs',
    token: 'visionEvidenceModelingHandoff'
  },
  {
    id: 'validate_tests_handoff_artifact_exists_state',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'generated-hints handoff should expose artifact exists state for upload-session summary'
  },
  {
    id: 'validate_tests_handoff_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'release gate generated-view-hints handoff should keep semantic evidence quality review-gated'
  },
  {
    id: 'validate_tests_handoff_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'generated-hints saved handoff should preserve duct VisionEvidence modeling handoff'
  },
  {
    id: 'validate_tests_workspace_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'generated-hints workspace validation should verify semantic evidence quality propagation'
  },
  {
    id: 'validate_tests_workspace_vision_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'generated-hints workspace validation should verify VisionEvidence semantic instance propagation'
  },
  {
    id: 'validate_tests_workspace_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'generated-hints workspace validation should verify VisionEvidence modeling handoff propagation'
  },
  {
    id: 'validate_tests_workspace_mcp_authoring_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'generated-hints workspace validation should verify MCP authoring handoff propagation'
  },
  {
    id: 'validate_tests_vision_review_semantic_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'assertSemanticReviewItemHasEvidenceInstance'
  },
  {
    id: 'validate_tests_mcp_vision_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'MCP brief export should expose duct VisionEvidence instance'
  },
  {
    id: 'validate_tests_mcp_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'MCP brief export should expose duct VisionEvidence modeling handoff'
  },
  {
    id: 'workspace_schema_exposes_task_packets',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'task_packets'
  },
  {
    id: 'workspace_schema_exposes_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'release_checklist_failed_required_check_ids'
  },
  {
    id: 'workspace_schema_exposes_mcp_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'release_checklist_review_required_check_ids'
  },
  {
    id: 'workspace_schema_exposes_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'semantic_evidence_quality'
  },
  {
    id: 'workspace_schema_exposes_vision_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'semantic_evidence_instances'
  },
  {
    id: 'workspace_schema_exposes_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'modeling_handoff'
  },
  {
    id: 'workspace_schema_exposes_mcp_authoring_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'mcp_authoring_handoff'
  },
  {
    id: 'workspace_validator_checks_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs',
    token: 'release_checklist_required_summary_exposed'
  },
  {
    id: 'workspace_validator_checks_mcp_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs',
    token: 'release_checklist_summary_propagated_to_mcp_tasks'
  },
  {
    id: 'workspace_validator_checks_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs',
    token: 'semantic_evidence_quality_propagated'
  },
  {
    id: 'workspace_validator_checks_vision_evidence_instances',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs',
    token: 'vision_evidence_instances_propagated'
  },
  {
    id: 'workspace_validator_checks_vision_evidence_modeling_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs',
    token: 'vision_evidence_modeling_handoff_propagated'
  },
  {
    id: 'workspace_validator_checks_mcp_authoring_handoff',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs',
    token: 'task_packet_mcp_authoring_handoff_present'
  },
  {
    id: 'release_checklist_schema_requires_vision_evidence_review',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-checklist.schema.json',
    token: '"const": "vision_evidence_review"'
  },
  {
    id: 'release_checklist_schema_requires_photo_grade_readiness',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-checklist.schema.json',
    token: '"const": "photo_grade_readiness"'
  },
  {
    id: 'release_work_order_schema_exposes_artifact_authoring_policy',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-work-order.schema.json',
    token: 'artifact_authoring_policy'
  },
  {
    id: 'source_package_schema_exposes_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-package.schema.json',
    token: 'failed_required_check_ids'
  },
  {
    id: 'source_package_schema_exposes_semantic_role_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-package.schema.json',
    token: 'role_evidence'
  },
  {
    id: 'source_package_schema_exposes_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-package.schema.json',
    token: 'evidence_quality'
  },
  {
    id: 'source_package_schema_exposes_view_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-package.schema.json',
    token: 'view_evidence'
  },
  {
    id: 'upload_session_schema_exposes_source_package_semantic_role_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json',
    token: 'semantic_role_evidence'
  },
  {
    id: 'upload_session_schema_exposes_source_package_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json',
    token: 'semantic_evidence_quality'
  },
  {
    id: 'upload_session_schema_exposes_source_package_view_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json',
    token: 'view_evidence'
  },
  {
    id: 'source_request_schema_exposes_upload_package_requirements',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-request.schema.json',
    token: 'upload_package_requirements'
  },
  {
    id: 'source_request_schema_exposes_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-request.schema.json',
    token: 'Current semantic evidence quality gate inherited from the source-package assessment.'
  },
  {
    id: 'source_package_schema_exposes_source_request_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-package.schema.json',
    token: 'semantic_evidence_quality'
  },
  {
    id: 'source_request_response_schema_exposes_expected_check_ids',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-request-response.schema.json',
    token: 'missing_expected_check_ids'
  },
  {
    id: 'source_request_response_schema_exposes_view_evidence_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-request-response.schema.json',
    token: 'requested_view_evidence'
  },
  {
    id: 'source_request_response_schema_exposes_semantic_evidence_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-request-response.schema.json',
    token: 'semantic_evidence'
  },
  {
    id: 'source_request_response_schema_exposes_semantic_requested_role_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-request-response.schema.json',
    token: 'requested_role_evidence'
  },
  {
    id: 'source_request_response_schema_exposes_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-request-response.schema.json',
    token: 'evidence_quality'
  },
  {
    id: 'source_refill_package_guide_schema_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-package-guide.schema.json'
  },
  {
    id: 'source_refill_package_validation_schema_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-package-validation.schema.json'
  },
  {
    id: 'source_refill_manifest_build_report_schema_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-manifest-build-report.schema.json'
  },
  {
    id: 'source_refill_workflow_report_schema_exists',
    kind: 'path_exists',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-workflow-report.schema.json'
  },
  {
    id: 'source_refill_guide_schema_exposes_object_type',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-package-guide.schema.json',
    token: '"object_type"'
  },
  {
    id: 'source_refill_validation_schema_exposes_manifest_identity',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-package-validation.schema.json',
    token: 'expected_object_type'
  },
  {
    id: 'source_refill_guide_schema_exposes_package_validation_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-package-guide.schema.json',
    token: 'validate_refill_package'
  },
  {
    id: 'source_refill_guide_schema_exposes_manifest_builder_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-package-guide.schema.json',
    token: 'build_manifest_from_sources'
  },
  {
    id: 'source_refill_manifest_build_report_schema_exposes_status',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-manifest-build-report.schema.json',
    token: 'manifest_ready_for_package_validation'
  },
  {
    id: 'source_refill_workflow_report_schema_exposes_ready_status',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-source-refill-workflow-report.schema.json',
    token: 'ready_for_upload_session'
  },
  {
    id: 'source_refill_validator_checks_manifest_kind',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-source-refill-package.mjs',
    token: 'real_manifest_kind_valid'
  },
  {
    id: 'upload_session_schema_exposes_source_refill_package_validation_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json',
    token: 'validate_source_refill_package_require_upload_ready'
  },
  {
    id: 'handoff_schema_exposes_source_refill_package_validation_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json',
    token: 'validate_source_refill_package_require_upload_ready'
  },
  {
    id: 'demo_candidate_audit_schema_exposes_source_refill_package_validation_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-demo-candidate-audit.schema.json',
    token: 'validate_source_refill_package_require_upload_ready'
  },
  {
    id: 'release_artifact_workspace_schema_exposes_source_refill_package_validation_command',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json',
    token: 'validate_source_refill_package_require_upload_ready'
  },
  {
    id: 'release_artifact_workspace_validator_checks_source_refill_package_commands',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/scripts/validate-real-world-building-release-artifact-workspace.mjs',
    token: 'blocked_source_refill_commands_present'
  },
  {
    id: 'source_refill_package_script_registered',
    kind: 'package_script_contains',
    script: 'image-structured:prepare-real-world-building-source-refill-package',
    token: 'prepare-real-world-building-source-refill-package.mjs'
  },
  {
    id: 'source_refill_package_validation_script_registered',
    kind: 'package_script_contains',
    script: 'image-structured:validate-real-world-building-source-refill-package',
    token: 'validate-real-world-building-source-refill-package.mjs'
  },
  {
    id: 'source_refill_manifest_builder_script_registered',
    kind: 'package_script_contains',
    script: 'image-structured:build-real-world-building-source-refill-manifest',
    token: 'build-real-world-building-source-refill-manifest.mjs'
  },
  {
    id: 'source_refill_workflow_script_registered',
    kind: 'package_script_contains',
    script: 'image-structured:run-real-world-building-source-refill-workflow',
    token: 'run-real-world-building-source-refill-workflow.mjs'
  },
  {
    id: 'validate_tests_source_refill_package_guide',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source refill package guide should not claim direct upload readiness'
  },
  {
    id: 'validate_tests_source_refill_package_validation',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source refill template package should validate as pending'
  },
  {
    id: 'validate_tests_source_refill_manifest_identity',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'wrong manifest kind should not be upload-session ready'
  },
  {
    id: 'validate_tests_source_refill_manifest_builder',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source refill manifest builder should produce a validation-ready manifest'
  },
  {
    id: 'validate_tests_source_refill_manifest_builder_schema',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source refill manifest builder ready report'
  },
  {
    id: 'validate_tests_source_refill_workflow_schema',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source refill workflow ready report'
  },
  {
    id: 'validate_tests_workflow_source_refill_package_validation',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'blocked upload session workflow should include source-refill upload-ready validation command'
  },
  {
    id: 'validate_tests_demo_candidate_source_refill_package_validation',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'refill workflow should expose source-refill package upload-ready validation command'
  },
  {
    id: 'validate_tests_workspace_source_refill_package_validation',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'blocked workspace should expose source-refill upload-ready validation command'
  },
  {
    id: 'validate_tests_workspace_source_refill_package_command_validator',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'blocked workspace validation should check source-refill package command chain'
  },
  {
    id: 'readme_documents_source_refill_package',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'prepare-real-world-building-source-refill-package'
  },
  {
    id: 'readme_documents_source_refill_package_validation',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'validate-real-world-building-source-refill-package'
  },
  {
    id: 'readme_documents_source_refill_manifest_builder',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'build-real-world-building-source-refill-manifest'
  },
  {
    id: 'readme_documents_source_refill_workflow',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'run-real-world-building-source-refill-workflow'
  },
  {
    id: 'mcp_brief_schema_exposes_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'release_checklist_failed_required_check_ids'
  },
  {
    id: 'mcp_brief_schema_exposes_source_response_expected_check_ids',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'missing_expected_check_ids'
  },
  {
    id: 'mcp_brief_schema_exposes_source_response_view_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'requested_view_evidence'
  },
  {
    id: 'mcp_brief_schema_exposes_source_response_semantic_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'semantic_evidence'
  },
  {
    id: 'mcp_brief_schema_exposes_source_response_semantic_requested_role_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'requested_role_evidence'
  },
  {
    id: 'mcp_brief_schema_exposes_source_package_semantic_role_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'semantic_role_evidence'
  },
  {
    id: 'mcp_brief_schema_exposes_source_package_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'semantic_evidence_quality'
  },
  {
    id: 'mcp_brief_schema_exposes_source_package_view_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/schema/mcp-modeling-brief.schema.json',
    token: 'view_evidence'
  },
  {
    id: 'readme_documents_workspace_validator',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'validate-real-world-building-release-artifact-workspace'
  },
  {
    id: 'plan_documents_workspace_validator',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/PLAN.md',
    token: 'validate-real-world-building-release-artifact-workspace'
  },
  {
    id: 'memo_documents_workspace_validator',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/MEMO.md',
    token: 'ready_to_author_validated'
  },
  {
    id: 'readme_documents_artifact_integrity_schema',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'release-gate-artifact-integrity-report.schema.json'
  },
  {
    id: 'plan_documents_artifact_integrity_schema',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/PLAN.md',
    token: 'release-gate-artifact-integrity-report.schema.json'
  },
  {
    id: 'memo_documents_artifact_integrity_schema',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/MEMO.md',
    token: 'release-gate-artifact-integrity-report.schema.json'
  },
  {
    id: 'validate_tests_workspace_validation_schema',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'validateRealWorldBuildingReleaseArtifactWorkspaceValidation'
  },
  {
    id: 'validate_tests_artifact_integrity_schema',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'validateReleaseGateArtifactIntegrityReport'
  },
  {
    id: 'validate_tests_release_checklist_required_check_negative',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'release checklist schema should reject missing VisionEvidence review check'
  },
  {
    id: 'validate_tests_work_order_artifact_authoring_policy',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'release work order should forbid direct SketchUp DSL authoring'
  },
  {
    id: 'validate_tests_mcp_brief_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'MCP brief must expose failed required release checklist id'
  },
  {
    id: 'validate_tests_source_request_upload_package_requirements',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source request should expose upload package manifest requirement'
  },
  {
    id: 'validate_tests_source_request_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source request should keep semantic evidence quality review-gated'
  },
  {
    id: 'validate_tests_source_request_response_expected_check_ids',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source request response should expose expected source-request check ids'
  },
  {
    id: 'validate_tests_source_request_response_view_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'source request response should expose requested view evidence'
  },
  {
    id: 'validate_tests_source_request_response_semantic_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'semantic satisfied response should expose requested duct role'
  },
  {
    id: 'validate_tests_source_request_response_semantic_requested_role_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'semantic satisfied response should expose requested duct role evidence'
  },
  {
    id: 'validate_tests_source_request_response_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'semantic satisfied response should keep semantic quality review-gated'
  },
  {
    id: 'validate_tests_source_package_semantic_role_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'input-ready source package should expose semantic role evidence'
  },
  {
    id: 'validate_tests_source_package_semantic_evidence_quality',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'input-ready source package should keep semantic evidence quality review-gated'
  },
  {
    id: 'validate_tests_source_package_view_evidence',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/test/validate.mjs',
    token: 'input-ready source package should expose view evidence'
  },
  {
    id: 'readme_documents_checklist_required_checks',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'real-world-building-release-checklist.schema.json'
  },
  {
    id: 'readme_documents_mcp_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/README.md',
    token: 'MCP brief source-package gate and agent contract now expose release checklist'
  },
  {
    id: 'memo_documents_checklist_required_checks',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/MEMO.md',
    token: 'Release checklist schema 已加 required-check 覆盖校验'
  },
  {
    id: 'memo_documents_mcp_release_checklist_summary',
    kind: 'file_contains',
    path: 'projects/image-structured-modeler/MEMO.md',
    token: 'MCP brief source-package gate 和 agent_contract.output_policy 现在直接暴露 release checklist'
  }
];

export async function runImageStructuredReleaseGate({
  outputDir = DEFAULT_OUTPUT_DIR,
  buildingSingleInput = null,
  writeOverlays = true
} = {}) {
  const absoluteOutputDir = resolveRepo(outputDir);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const profile = await readJson(resolveRepo(BUILDING_SINGLE_PROFILE));
  const cases = [];

  const unknownCase = await collectCase('unknown_negative_fail_closed', async () => {
    const result = await buildStructuredAssetIntake({
      input: CANONICAL_SINGLE_INPUT,
      objectName: 'Release Gate Unknown Negative',
      outputDir: path.join(outputDir, 'unknown-negative'),
      writeOverlays: false
    });
    const applyError = captureError(() => applyCandidatePromotionPatch({
      patch: result.promotionPatch,
      candidateGraph: result.candidateGraph,
      observationSet: result.observationSet,
      profile
    }));
    assertEqual(result.observationSet.object.profile, 'unknown_object', 'unknown input must route to unknown_object');
    assertEqual(result.assetSet.gates.can_compile_geometry, false, 'unknown input must not compile geometry');
    assertEqual(result.promotionPatch.status, 'blocked', 'unknown promotion patch must be blocked');
    assertEqual(result.promotionPatch.apply_allowed, false, 'unknown promotion patch must not be applyable');
    assertEqual(result.promotionPatch.actions.length, 0, 'unknown promotion patch must not emit actions');
    assertIncludes(result.assetSet.gates.reasons, 'unknown_profile', 'unknown blocker must be explicit');
    assertMatch(applyError?.message || '', /not applyable/, 'blocked unknown patch must reject application');
    return {
      status: 'blocked',
      artifacts: artifactsFor(path.join(outputDir, 'unknown-negative')),
      metrics: {
        assets: result.assetSet.assets.length,
        candidates: result.candidateGraph.candidates.length,
        blockers: result.promotionPatch.blockers
      }
    };
  });
  cases.push(unknownCase);

  const sourcePackagePreflightCase = await collectCase('real_world_building_source_package_preflight_fixture', async () => {
    const blockedPreflight = await preflightRealWorldBuildingSourcePackageCli({
      input: CANONICAL_SINGLE_INPUT,
      objectType: 'building_single',
      viewHintsFile: CANONICAL_SINGLE_VIEW_HINTS,
      output: path.join(outputDir, 'source-package-preflight', 'blocked', 'preflight.json'),
      requireReleaseSourceCandidate: true
    });
    assertEqual(blockedPreflight.ok, false, 'generated/cropped canonical source must fail release-source preflight');
    assertEqual(blockedPreflight.report.can_start_structured_intake, true, 'canonical source can still start review/demo intake');
    assertEqual(blockedPreflight.report.release_source_candidate, false, 'canonical source must not be release-source candidate');
    assertIncludes(
      blockedPreflight.report.blockers,
      'source_assets_generated_or_scaffold',
      'canonical source preflight must expose generated/scaffold blocker'
    );

    const sourceDir = path.join(absoluteOutputDir, 'source-package-preflight', 'real-upload-source');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'front-facade.jpg'), 'placeholder front photo\n', 'utf8');
    await fs.writeFile(path.join(sourceDir, 'left-side.jpg'), 'placeholder side photo\n', 'utf8');
    await fs.writeFile(path.join(sourceDir, 'oblique-street.jpg'), 'placeholder oblique photo\n', 'utf8');
    await fs.writeFile(path.join(sourceDir, 'roof-plan.dxf'), '0\n', 'utf8');
    const readyPreflight = await preflightRealWorldBuildingSourcePackageCli({
      input: path.join(outputDir, 'source-package-preflight', 'real-upload-source'),
      objectType: 'building_single',
      output: path.join(outputDir, 'source-package-preflight', 'real-upload', 'preflight.json'),
      requireReleaseSourceCandidate: true
    });
    assertEqual(readyPreflight.ok, true, 'real upload-shaped source package should pass release-source preflight');
    assertEqual(readyPreflight.report.status, 'release_source_candidate', 'ready preflight should expose release-source candidate status');
    assertEqual(readyPreflight.report.release_source_candidate, true, 'ready preflight should expose release-source candidate flag');
    assertEqual(readyPreflight.report.view_package.missing_hinted_views.length, 0, 'ready preflight should cover required view labels');
    for (const view of ['front', 'left', 'oblique', 'top']) {
      assertIncludes(readyPreflight.report.view_package.hinted_views, view, `ready preflight must include ${view} view hint`);
    }

    const duplicateSourceDir = path.join(absoluteOutputDir, 'source-package-preflight', 'duplicate-source');
    await fs.rm(duplicateSourceDir, { recursive: true, force: true });
    await fs.mkdir(duplicateSourceDir, { recursive: true });
    for (const name of ['front-facade.jpg', 'left-side.jpg', 'oblique-street.jpg']) {
      await fs.writeFile(path.join(duplicateSourceDir, name), 'same duplicated placeholder source\n', 'utf8');
    }
    await fs.writeFile(path.join(duplicateSourceDir, 'roof-plan.dxf'), '0\n', 'utf8');
    const duplicatePreflight = await preflightRealWorldBuildingSourcePackageCli({
      input: path.join(outputDir, 'source-package-preflight', 'duplicate-source'),
      objectType: 'building_single',
      output: path.join(outputDir, 'source-package-preflight', 'duplicate-source', 'preflight.json'),
      requireReleaseSourceCandidate: true
    });
    assertEqual(duplicatePreflight.ok, false, 'duplicate source content must fail release-source preflight');
    assertEqual(duplicatePreflight.report.release_source_candidate, false, 'duplicate source content must not be a release-source candidate');
    assertIncludes(
      duplicatePreflight.report.blockers,
      'duplicate_source_assets',
      'duplicate source preflight must expose duplicate_source_assets blocker'
    );
    assertEqual(duplicatePreflight.report.source_content.status, 'fail', 'duplicate source preflight must fail source content status');
    assertTruthy(
      duplicatePreflight.report.checks.some((check) => check.id === 'source_content_diversity' && check.status === 'fail'),
      'duplicate source preflight must fail source content diversity check'
    );

    const singleSourceMultiViewDir = path.join(absoluteOutputDir, 'source-package-preflight', 'single-source-multiview-source');
    await fs.rm(singleSourceMultiViewDir, { recursive: true, force: true });
    await fs.mkdir(singleSourceMultiViewDir, { recursive: true });
    await fs.writeFile(path.join(singleSourceMultiViewDir, 'one-photo.jpg'), 'one source photo cannot prove four views\n', 'utf8');
    await writeJson(path.join(singleSourceMultiViewDir, 'manifest.json'), {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      object_type: 'building_single',
      views: [
        { source_image: 'one-photo.jpg', kind: 'front' },
        { source_image: 'one-photo.jpg', kind: 'left' },
        { source_image: 'one-photo.jpg', kind: 'oblique' },
        { source_image: 'one-photo.jpg', kind: 'top' }
      ]
    });
    const singleSourceMultiViewPreflight = await preflightRealWorldBuildingSourcePackageCli({
      input: path.join(outputDir, 'source-package-preflight', 'single-source-multiview-source'),
      objectType: 'building_single',
      output: path.join(outputDir, 'source-package-preflight', 'single-source-multiview', 'preflight.json'),
      requireReleaseSourceCandidate: true
    });
    assertEqual(singleSourceMultiViewPreflight.ok, false, 'one source labeled as multiple required views must fail release-source preflight');
    assertEqual(singleSourceMultiViewPreflight.report.status, 'blocked_source_assets', 'single-source multiview preflight must block source assets');
    assertEqual(singleSourceMultiViewPreflight.report.release_source_candidate, false, 'single-source multiview preflight must not be release-source candidate');
    assertEqual(singleSourceMultiViewPreflight.report.view_package.missing_hinted_views.length, 0, 'single-source multiview preflight should still record all labels');
    assertEqual(singleSourceMultiViewPreflight.report.view_package.view_source_diversity.status, 'fail', 'single-source multiview preflight must fail view source diversity');
    assertIncludes(
      singleSourceMultiViewPreflight.report.blockers,
      'view_sources_not_distinct',
      'single-source multiview preflight must expose view_sources_not_distinct blocker'
    );
    assertTruthy(
      singleSourceMultiViewPreflight.report.checks.some((check) => check.id === 'view_source_diversity' && check.status === 'fail'),
      'single-source multiview preflight must fail view source diversity check'
    );

    const invalidManifestSourceDir = path.join(absoluteOutputDir, 'source-package-preflight', 'invalid-manifest-source');
    await fs.rm(invalidManifestSourceDir, { recursive: true, force: true });
    await fs.mkdir(invalidManifestSourceDir, { recursive: true });
    for (const name of ['photo-a.jpg', 'photo-b.jpg', 'photo-c.jpg', 'photo-d.jpg']) {
      await fs.writeFile(path.join(invalidManifestSourceDir, name), `${name} placeholder source\n`, 'utf8');
    }
    await writeJson(path.join(invalidManifestSourceDir, 'manifest.json'), {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      object_type: 'building_single',
      views: [
        { source_image: 'photo-a.jpg', kind: 'facade' }
      ]
    });
    const invalidManifestPreflight = await preflightRealWorldBuildingSourcePackageCli({
      input: path.join(outputDir, 'source-package-preflight', 'invalid-manifest-source'),
      objectType: 'building_single',
      output: path.join(outputDir, 'source-package-preflight', 'invalid-manifest', 'preflight.json'),
      requireReleaseSourceCandidate: true
    });
    assertEqual(invalidManifestPreflight.ok, false, 'invalid upload manifest source package must fail release-source preflight');
    assertEqual(invalidManifestPreflight.report.status, 'blocked_source_metadata', 'invalid upload manifest source package must expose metadata block status');
    assertIncludes(
      invalidManifestPreflight.report.blockers,
      'invalid_source_metadata',
      'invalid upload manifest preflight must expose invalid source metadata blocker'
    );
    assertTruthy(
      invalidManifestPreflight.report.metadata_files.some((record) => record.status === 'invalid_contract'),
      'invalid upload manifest preflight must record invalid_contract metadata status'
    );
    assertTruthy(
      invalidManifestPreflight.report.metadata_files.some((record) => (record.errors || []).some((error) => error.includes('views[0].kind'))),
      'invalid upload manifest preflight must report the bad view kind'
    );
    assertEqual(
      invalidManifestPreflight.report.view_package.sources.some((source) => source.source === 'upload_manifest'),
      false,
      'invalid upload manifest must not contribute view hints'
    );

    const missingReferenceManifestSourceDir = path.join(absoluteOutputDir, 'source-package-preflight', 'missing-reference-manifest-source');
    await fs.rm(missingReferenceManifestSourceDir, { recursive: true, force: true });
    await fs.mkdir(missingReferenceManifestSourceDir, { recursive: true });
    for (const name of ['photo-a.jpg', 'photo-b.jpg', 'photo-c.jpg']) {
      await fs.writeFile(path.join(missingReferenceManifestSourceDir, name), `${name} placeholder source\n`, 'utf8');
    }
    await writeJson(path.join(missingReferenceManifestSourceDir, 'manifest.json'), {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      object_type: 'building_single',
      views: [
        { source_image: 'photo-a.jpg', kind: 'front' },
        { source_image: 'photo-b.jpg', kind: 'left' },
        { source_image: 'photo-c.jpg', kind: 'oblique' },
        { source_image: 'missing-top.jpg', kind: 'top' }
      ],
      scale_anchors: [
        {
          source_image: 'missing-scale-anchor.jpg',
          anchor_type: 'door_width',
          width_mm: 900
        }
      ]
    });
    const missingReferencePreflight = await preflightRealWorldBuildingSourcePackageCli({
      input: path.join(outputDir, 'source-package-preflight', 'missing-reference-manifest-source'),
      objectType: 'building_single',
      output: path.join(outputDir, 'source-package-preflight', 'missing-reference-manifest', 'preflight.json'),
      requireReleaseSourceCandidate: true
    });
    assertEqual(missingReferencePreflight.ok, false, 'upload manifest with missing source references must fail release-source preflight');
    assertEqual(missingReferencePreflight.report.status, 'blocked_source_metadata', 'missing-reference upload manifest must expose metadata preflight status');
    assertTruthy(
      missingReferencePreflight.report.metadata_files.some((record) => (record.errors || []).some((error) => error.includes('missing-top.jpg'))),
      'missing-reference upload manifest preflight must report missing view source'
    );
    assertTruthy(
      missingReferencePreflight.report.metadata_files.some((record) => (record.errors || []).some((error) => error.includes('missing-scale-anchor.jpg'))),
      'missing-reference upload manifest preflight must report missing scale anchor source'
    );
    assertEqual(
      missingReferencePreflight.report.view_package.sources.some((source) => source.source === 'upload_manifest'),
      false,
      'missing-reference upload manifest must not contribute view hints'
    );

    const templateManifestSourceDir = path.join(absoluteOutputDir, 'source-package-preflight', 'template-manifest-source');
    await fs.rm(templateManifestSourceDir, { recursive: true, force: true });
    await fs.mkdir(templateManifestSourceDir, { recursive: true });
    for (const name of ['front-photo.jpg', 'left-photo.jpg', 'oblique-photo.jpg', 'top-photo.jpg']) {
      await fs.writeFile(path.join(templateManifestSourceDir, name), `${name} placeholder source\n`, 'utf8');
    }
    await writeJson(path.join(templateManifestSourceDir, 'manifest.json'), {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      template_only: true,
      object_type: 'building_single',
      views: [
        { source_image: 'front-photo.jpg', kind: 'front' },
        { source_image: 'left-photo.jpg', kind: 'left' },
        { source_image: 'oblique-photo.jpg', kind: 'oblique' },
        { source_image: 'top-photo.jpg', kind: 'top' }
      ]
    });
    const templateManifestPreflight = await preflightRealWorldBuildingSourcePackageCli({
      input: path.join(outputDir, 'source-package-preflight', 'template-manifest-source'),
      objectType: 'building_single',
      output: path.join(outputDir, 'source-package-preflight', 'template-manifest', 'preflight.json'),
      requireReleaseSourceCandidate: true
    });
    assertEqual(templateManifestPreflight.ok, false, 'template-only upload manifest source package must fail release-source preflight');
    assertEqual(templateManifestPreflight.report.status, 'blocked_source_metadata', 'template-only upload manifest must expose metadata preflight status');
    assertIncludes(templateManifestPreflight.report.blockers, 'invalid_source_metadata', 'template-only upload manifest must expose invalid source metadata blocker');
    assertTruthy(
      templateManifestPreflight.report.metadata_files.some((record) => (record.errors || []).some((error) => error.includes('template_only upload manifest'))),
      'template-only upload manifest preflight must explain template-only protection'
    );
    return {
      status: 'review',
      artifacts: {
        blocked_preflight: path.join(outputDir, 'source-package-preflight', 'blocked', 'preflight.json'),
        blocked_preflight_markdown: path.join(outputDir, 'source-package-preflight', 'blocked', 'preflight.md'),
        ready_preflight: path.join(outputDir, 'source-package-preflight', 'real-upload', 'preflight.json'),
        ready_preflight_markdown: path.join(outputDir, 'source-package-preflight', 'real-upload', 'preflight.md'),
        duplicate_preflight: path.join(outputDir, 'source-package-preflight', 'duplicate-source', 'preflight.json'),
        duplicate_preflight_markdown: path.join(outputDir, 'source-package-preflight', 'duplicate-source', 'preflight.md'),
        single_source_multiview_preflight: path.join(outputDir, 'source-package-preflight', 'single-source-multiview', 'preflight.json'),
        single_source_multiview_preflight_markdown: path.join(outputDir, 'source-package-preflight', 'single-source-multiview', 'preflight.md'),
        invalid_manifest_preflight: path.join(outputDir, 'source-package-preflight', 'invalid-manifest', 'preflight.json'),
        invalid_manifest_preflight_markdown: path.join(outputDir, 'source-package-preflight', 'invalid-manifest', 'preflight.md'),
        missing_reference_manifest_preflight: path.join(outputDir, 'source-package-preflight', 'missing-reference-manifest', 'preflight.json'),
        missing_reference_manifest_preflight_markdown: path.join(outputDir, 'source-package-preflight', 'missing-reference-manifest', 'preflight.md'),
        template_manifest_preflight: path.join(outputDir, 'source-package-preflight', 'template-manifest', 'preflight.json'),
        template_manifest_preflight_markdown: path.join(outputDir, 'source-package-preflight', 'template-manifest', 'preflight.md')
      },
      metrics: {
        blocked_status: blockedPreflight.report.status,
        blocked_release_source_candidate: blockedPreflight.report.release_source_candidate,
        blocked_can_start_structured_intake: blockedPreflight.report.can_start_structured_intake,
        ready_status: readyPreflight.report.status,
        ready_release_source_candidate: readyPreflight.report.release_source_candidate,
        ready_hinted_views: readyPreflight.report.view_package.hinted_views,
        duplicate_status: duplicatePreflight.report.status,
        duplicate_release_source_candidate: duplicatePreflight.report.release_source_candidate,
        duplicate_blockers: duplicatePreflight.report.blockers,
        duplicate_source_content_status: duplicatePreflight.report.source_content.status,
        single_source_multiview_status: singleSourceMultiViewPreflight.report.status,
        single_source_multiview_release_source_candidate: singleSourceMultiViewPreflight.report.release_source_candidate,
        single_source_multiview_blockers: singleSourceMultiViewPreflight.report.blockers,
        single_source_multiview_diversity_status: singleSourceMultiViewPreflight.report.view_package.view_source_diversity.status,
        invalid_manifest_status: invalidManifestPreflight.report.status,
        invalid_manifest_release_source_candidate: invalidManifestPreflight.report.release_source_candidate,
        invalid_manifest_blockers: invalidManifestPreflight.report.blockers,
        invalid_manifest_metadata_statuses: invalidManifestPreflight.report.metadata_files.map((record) => record.status),
        missing_reference_manifest_status: missingReferencePreflight.report.status,
        missing_reference_manifest_metadata_statuses: missingReferencePreflight.report.metadata_files.map((record) => record.status),
        missing_reference_manifest_errors: missingReferencePreflight.report.metadata_files.flatMap((record) => record.errors || []),
        template_manifest_status: templateManifestPreflight.report.status,
        template_manifest_blockers: templateManifestPreflight.report.blockers,
        template_manifest_metadata_statuses: templateManifestPreflight.report.metadata_files.map((record) => record.status)
      }
    };
  });
  cases.push(sourcePackagePreflightCase);

  const uploadSessionCase = await collectCase('real_world_building_upload_session_fixture', async () => {
    const summary = await runRealWorldBuildingUploadSession({
      input: CANONICAL_SINGLE_INPUT,
      objectType: 'building_single',
      objectName: 'Release Gate Upload Session Blocked Fixture',
      viewHintsFile: CANONICAL_SINGLE_VIEW_HINTS,
      outputDir: path.join(outputDir, 'upload-session-blocked'),
      writeOverlays: false,
      requirePreflightReleaseSourceCandidate: true,
      requireSourceInputReady: true
    });
    assertEqual(summary.ok, false, 'blocked upload session must fail requested gates');
    assertEqual(summary.status, 'blocked_preflight', 'blocked upload session must expose preflight block');
    assertEqual(summary.preflight.can_start_structured_intake, true, 'blocked upload session should still run review/demo intake');
    assertEqual(summary.preflight.release_source_candidate, false, 'blocked upload session must not claim release-source candidate');
    assertEqual(summary.intake?.status, 'review_required', 'blocked upload session intake should remain review_required');
    assertEqual(summary.gates.source_package_gate_ok, false, 'blocked upload session source gate should fail');
    assertEqual(summary.gates.can_generate_sketchup_dsl, false, 'blocked upload session must forbid direct SketchUp DSL');
    assertEqual(summary.workflow.stage, 'source_refill_required', 'blocked upload session workflow must require source refill');
    assertEqual(summary.workflow.can_continue_without_new_upload, false, 'blocked upload session workflow must require new source upload');
    assertEqual(summary.handoff.status, 'needs_source_refill', 'blocked upload session handoff must require source refill');
    assertEqual(summary.handoff.primary_action.kind, 'upload_replacement_source_package', 'blocked upload session handoff must direct replacement source upload');
    assertEqual(summary.handoff.primary_action.artifact, summary.artifacts.source_request, 'blocked upload session handoff must point at source request artifact');
    assertTruthy(
      summary.handoff.primary_action.command?.includes('prepare-real-world-building-source-refill-package'),
      'blocked upload session handoff primary action must prepare a source-refill package'
    );
    assertEqual(summary.workflow.source_request_file, summary.artifacts.source_request, 'blocked upload session workflow must point at source request artifact');
    assertEqual(summary.workflow.upload_manifest_template, summary.artifacts.upload_manifest_template, 'blocked upload session workflow must point at upload manifest template');
    assertIncludes(summary.workflow.blocked_outputs, 'direct_sketchup_dsl', 'blocked upload session workflow must expose blocked direct DSL output');
    assertTruthy(
      summary.workflow.commands.prepare_source_refill_package?.includes('prepare-real-world-building-source-refill-package'),
      'blocked upload session workflow must include a source-refill package preparation command'
    );
    assertTruthy(
      summary.workflow.commands.validate_source_refill_package_require_upload_ready?.includes('validate-real-world-building-source-refill-package')
        && summary.workflow.commands.validate_source_refill_package_require_upload_ready.includes('--require-upload-ready'),
      'blocked upload session workflow must include a source-refill package upload-ready validation command'
    );
    assertTruthy(
      summary.workflow.commands.run_refill_upload_session?.includes('--source-request-file'),
      'blocked upload session workflow must include a refill command tied to source request'
    );
    assertTruthy(
      summary.workflow.commands.run_refill_upload_session?.includes('-source-refill-package/upload-package'),
      'blocked upload session workflow must point refill command at the prepared upload-package directory'
    );
    assertEqual(summary.intake?.source_package?.gate_ok, false, 'blocked upload session source-package summary should expose failed gate');
    assertIncludes(
      summary.intake?.source_package?.blockers || [],
      'source_assets_generated_or_scaffold',
      'blocked upload session source-package summary should expose source blocker'
    );
    assertEqual(summary.intake?.source_package?.source_request?.status, 'needs_source_replacement', 'blocked upload session should expose source request status');
    assertIncludes(
      summary.intake?.source_package?.source_request?.blocked_until_satisfied || [],
      'direct_sketchup_dsl',
      'blocked upload session source request must block direct DSL'
    );
    assertTruthy(
      (summary.intake?.source_package?.source_request?.view_requirements || []).some((item) => item.view === 'top' && item.status === 'missing'),
      'blocked upload session source request must ask for top/plan view'
    );
    assertIncludes(
      summary.intake?.source_package?.source_request?.upload_package_requirements?.next_upload_response_check_ids || [],
      'view_source_diversity',
      'blocked upload session source request must expose upload package response check ids'
    );
    for (const artifact of [
      'upload_session_summary',
      'upload_session_markdown',
      'upload_session_handoff',
      'upload_session_handoff_markdown',
      'view_hints',
      'preflight',
      'preflight_markdown',
      'intake_summary',
      'review_workbench',
      'mcp_modeling_brief',
      'mcp_modeling_brief_markdown',
      'vision_evidence_report',
      'vision_evidence_review_patch',
      'vision_evidence_review_patch_markdown',
      'vision_evidence_review_workbench',
      'source_package',
      'source_request',
      'source_request_markdown',
      'upload_manifest_template',
      'source_package_gate_result'
    ]) {
      assertTruthy(summary.artifacts[artifact], `blocked upload session should expose ${artifact}`);
    }
    assertTruthy(summary.preflight.metadata_files.some((record) => record.status === 'parsed'), 'blocked upload session should expose parsed preflight metadata files');
    assertEqual(summary.vision_evidence?.review_patch_status, 'needs_review', 'blocked upload session should expose VisionEvidence review patch status');
    assertTruthy(summary.vision_evidence?.semantic_candidate_review_items >= 3, 'blocked upload session should expose building-single semantic VisionEvidence review items');
    const blockedUploadVisionReviewPatch = await readJson(resolveRepo(summary.artifacts.vision_evidence_review_patch));
    const blockedUploadVisionWorkbench = await fs.readFile(resolveRepo(summary.artifacts.vision_evidence_review_workbench), 'utf8');
    assertIncludes(
      blockedUploadVisionReviewPatch.review_items.map((item) => item.id),
      'semantic_candidate:visible_plane_recessed_left',
      'blocked upload session VisionEvidence patch should include recessed facade review item'
    );
    assertIncludes(
      blockedUploadVisionReviewPatch.review_items.map((item) => item.id),
      'semantic_candidate:rectangular_utility_ducts',
      'blocked upload session VisionEvidence patch should include rectangular duct review item'
    );
    assertSemanticReviewItemHasEvidenceInstance(
      blockedUploadVisionReviewPatch,
      'visible_plane_recessed_left',
      'blocked upload session VisionEvidence patch should locate recessed visible plane evidence'
    );
    assertSemanticReviewItemHasEvidenceInstance(
      blockedUploadVisionReviewPatch,
      'rectangular_utility_ducts',
      'blocked upload session VisionEvidence patch should locate rectangular duct evidence'
    );
    assertTruthy(blockedUploadVisionWorkbench.includes('vision-evidence-review-decision-json'), 'blocked upload session VisionEvidence workbench should expose decision export');
    const sourceRequestArtifact = await readJson(resolveRepo(summary.artifacts.source_request));
    const uploadSessionHandoff = await readJson(resolveRepo(summary.artifacts.upload_session_handoff));
    const uploadSessionHandoffMarkdown = await fs.readFile(resolveRepo(summary.artifacts.upload_session_handoff_markdown), 'utf8');
    const uploadManifestTemplate = await readJson(resolveRepo(summary.artifacts.upload_manifest_template));
    const sourceRefillPackage = await prepareRealWorldBuildingSourceRefillPackageCli({
      sourceRequest: summary.artifacts.source_request,
      outputDir: path.join(outputDir, 'upload-session-blocked', 'source-refill-package'),
      objectType: 'building_single',
      generatedAt: '2026-06-17T00:00:00.000Z'
    });
    const sourceRefillPackageValidation = await validateRealWorldBuildingSourceRefillPackageCli({
      packageDir: sourceRefillPackage.outputDir,
      output: path.join(outputDir, 'upload-session-blocked', 'source-refill-package', 'source-refill-package-validation.json'),
      generatedAt: '2026-06-17T00:00:00.000Z'
    });
    const releaseArtifactWorkspaceResult = await prepareRealWorldBuildingReleaseArtifactWorkspaceCli({
      uploadSessionSummary: summary.artifacts.upload_session_summary,
      output: path.join(outputDir, 'upload-session-blocked', 'release-artifact-workspace.json'),
      generatedAt: '2026-06-17T00:00:00.000Z'
    });
    const releaseArtifactWorkspaceValidation = await validateRealWorldBuildingReleaseArtifactWorkspaceCli({
      workspace: releaseArtifactWorkspaceResult.output,
      output: path.join(outputDir, 'upload-session-blocked', 'release-artifact-workspace-validation.json'),
      generatedAt: '2026-06-17T00:00:00.000Z'
    });
    assertEqual(uploadSessionHandoff.kind, 'real_world_building_upload_session_handoff', 'blocked upload session handoff should use stable kind');
    assertEqual(uploadSessionHandoff.status, 'needs_source_refill', 'blocked upload session handoff should require source refill');
    assertEqual(uploadSessionHandoff.semantic_evidence_quality?.geometry_promotion_allowed, false, 'blocked upload session handoff should keep semantic evidence quality review-gated');
    assertEqual(uploadSessionHandoff.primary_action.artifact_exists, true, 'blocked upload session handoff should expose existing source-request primary artifact');
    assertTruthy(
      uploadSessionHandoff.authoritative_artifacts.some((artifact) => artifact.role === 'source_request' && artifact.exists === true),
      'blocked upload session handoff should expose source-request artifact exists state'
    );
    assertTruthy(uploadSessionHandoffMarkdown.includes('Real-World Building Upload Session Handoff'), 'blocked upload session handoff markdown should render title');
    assertTruthy(uploadSessionHandoffMarkdown.includes('Semantic evidence quality'), 'blocked upload session handoff markdown should render semantic evidence quality');
    assertTruthy(uploadSessionHandoffMarkdown.includes('Artifact exists'), 'blocked upload session handoff markdown should render primary artifact exists state');
    assertTruthy(uploadSessionHandoffMarkdown.includes('exists=`true`'), 'blocked upload session handoff markdown should render authoritative artifact exists state');
    assertEqual(releaseArtifactWorkspaceResult.workspace.kind, 'real_world_building_release_artifact_workspace', 'blocked upload session workspace should use stable kind');
    assertEqual(releaseArtifactWorkspaceResult.status, 'blocked_needs_source_refill', 'blocked upload session workspace should require source refill');
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.commands.prepare_source_refill_package?.includes('prepare-real-world-building-source-refill-package'),
      'blocked upload session workspace should expose source-refill package preparation command'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.commands.validate_source_refill_package_require_upload_ready?.includes('--require-upload-ready'),
      'blocked upload session workspace should expose source-refill package upload-ready validation command'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.commands.run_refill_upload_session?.includes('/upload-package'),
      'blocked upload session workspace should run refill upload-session from the prepared upload-package directory'
    );
    assertEqual(releaseArtifactWorkspaceValidation.ok, true, 'blocked upload session workspace validation should pass fail-closed contract');
    assertEqual(releaseArtifactWorkspaceValidation.status, 'blocked_needs_source_refill_validated', 'blocked upload session workspace validation should preserve source-refill status');
    assertEqual(sourceRequestArtifact.kind, 'real_world_building_source_request', 'blocked upload session source-request artifact should use stable kind');
    assertEqual(sourceRequestArtifact.status, 'needs_source_replacement', 'blocked upload session source-request artifact should ask for source replacement');
    assertTruthy(['weak_review_required', 'review_required'].includes(sourceRequestArtifact.semantic_evidence_quality?.status), 'blocked upload session source request should expose semantic evidence quality');
    assertEqual(sourceRequestArtifact.semantic_evidence_quality?.geometry_promotion_allowed, false, 'blocked upload session source request should keep semantic evidence quality review-gated');
    assertEqual(sourceRequestArtifact.semantic_requirements?.evidence_quality?.geometry_promotion_allowed, false, 'blocked upload session source request semantic requirements should block geometry promotion');
    assertEqual(sourceRequestArtifact.upload_package_requirements?.manifest_required, true, 'blocked upload session source-request artifact should expose upload package manifest requirement');
    assertEqual(sourceRequestArtifact.upload_package_requirements?.semantic_evidence?.evidence_quality?.geometry_promotion_allowed, false, 'blocked upload session source request upload requirements should carry semantic quality gate');
    assertIncludes(
      sourceRequestArtifact.upload_package_requirements?.missing_required_views || [],
      'top',
      'blocked upload session source-request artifact should expose missing upload package top view'
    );
    assertIncludes(
      sourceRequestArtifact.upload_package_requirements?.next_upload_response_check_ids || [],
      'scale_evidence',
      'blocked upload session source-request artifact should expose scale evidence response check id'
    );
    assertEqual(uploadManifestTemplate.kind, 'real_world_building_upload_manifest', 'blocked upload session manifest template should use upload manifest kind');
    assertEqual(uploadManifestTemplate.template_only, true, 'blocked upload session manifest template must be marked template-only');
    assertIncludes(
      uploadManifestTemplate.views.map((view) => view.kind),
      'top',
      'blocked upload session manifest template should include top/plan placeholder'
    );
    assertEqual(sourceRefillPackage.guide.kind, 'real_world_building_source_refill_package_guide', 'blocked upload session source refill guide should use stable kind');
    assertEqual(sourceRefillPackage.guide.package_policy.direct_upload_ready, false, 'source refill guide must stay fail-closed until user creates a real manifest');
    assertEqual(sourceRefillPackage.guide.package_policy.manifest_template_only, true, 'source refill guide manifest must remain template-only');
    assertEqual(sourceRefillPackage.guide.package_policy.distinct_source_images_required, true, 'source refill guide must preserve distinct source view requirement');
    assertIncludes(sourceRefillPackage.guide.required_views, 'top', 'source refill guide must expose top/plan required view');
    assertTruthy(
      sourceRefillPackage.guide.commands.build_manifest_from_sources.includes('build-real-world-building-source-refill-manifest'),
      'source refill guide must expose manifest builder command'
    );
    assertTruthy(
      sourceRefillPackage.guide.commands.run_source_refill_workflow.includes('run-real-world-building-source-refill-workflow'),
      'source refill guide must expose one-command workflow'
    );
    assertTruthy(
      sourceRefillPackage.guide.commands.validate_refill_package.includes('validate-real-world-building-source-refill-package')
        && sourceRefillPackage.guide.commands.require_upload_ready.includes('--require-upload-ready'),
      'source refill guide must expose package validation before upload-session validation'
    );
    assertTruthy(
      sourceRefillPackage.guide.commands.require_input_ready.includes('--source-request-file') && sourceRefillPackage.guide.commands.require_input_ready.includes('--require-source-input-ready'),
      'source refill guide must expose hard refill validation command'
    );
    assertTruthy(
      sourceRefillPackage.guide.commands.require_input_ready.includes('/upload-package'),
      'source refill guide validation command must point at the dedicated upload-package directory'
    );
    assertEqual(sourceRefillPackageValidation.status, 'template_package_pending', 'source refill package validation must keep template package pending');
    assertEqual(sourceRefillPackageValidation.ok, true, 'source refill template package should pass fail-closed validation');
    assertEqual(sourceRefillPackageValidation.report.can_run_upload_session, false, 'source refill template package must not be upload-session ready');

    const invalidManifestSourceDir = path.join(absoluteOutputDir, 'upload-session-invalid-manifest', 'source');
    await fs.rm(invalidManifestSourceDir, { recursive: true, force: true });
    await fs.mkdir(invalidManifestSourceDir, { recursive: true });
    const sourceImage = resolveRepo(CANONICAL_SINGLE_INPUT);
    for (const name of ['photo-a.png', 'photo-b.png', 'photo-c.png', 'photo-d.png']) {
      await fs.copyFile(sourceImage, path.join(invalidManifestSourceDir, name));
    }
    await writeJson(path.join(invalidManifestSourceDir, 'manifest.json'), {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      object_type: 'building_single',
      views: [
        { source_image: 'photo-a.png', kind: 'facade' }
      ]
    });
    const invalidManifestSummary = await runRealWorldBuildingUploadSession({
      input: path.join(outputDir, 'upload-session-invalid-manifest', 'source'),
      objectType: 'building_single',
      objectName: 'Release Gate Upload Session Invalid Manifest Fixture',
      outputDir: path.join(outputDir, 'upload-session-invalid-manifest', 'session'),
      writeOverlays: false,
      requirePreflightReleaseSourceCandidate: true,
      requireSourceInputReady: true
    });
    assertEqual(invalidManifestSummary.ok, false, 'invalid-manifest upload session must fail requested gates');
    assertEqual(invalidManifestSummary.status, 'blocked_preflight', 'invalid-manifest upload session must expose preflight block');
    assertEqual(invalidManifestSummary.preflight.status, 'blocked_source_metadata', 'invalid-manifest upload session must expose metadata preflight status');
    assertIncludes(
      invalidManifestSummary.preflight.blockers,
      'invalid_source_metadata',
      'invalid-manifest upload session must expose metadata blocker'
    );
    assertTruthy(
      invalidManifestSummary.preflight.metadata_files.some((record) => record.status === 'invalid_contract'),
      'invalid-manifest upload session must expose invalid_contract metadata status in summary'
    );
    assertEqual(invalidManifestSummary.workflow.stage, 'source_refill_required', 'invalid-manifest upload session workflow must require source refill');
    assertIncludes(invalidManifestSummary.workflow.required_user_inputs, 'invalid_source_metadata', 'invalid-manifest workflow must expose metadata blocker');
    assertEqual(invalidManifestSummary.artifacts.view_hints, null, 'invalid-manifest upload session must not generate view hints from bad metadata');

    const singleSourceMultiViewDir = path.join(absoluteOutputDir, 'upload-session-single-source-multiview', 'source');
    await fs.rm(singleSourceMultiViewDir, { recursive: true, force: true });
    await fs.mkdir(singleSourceMultiViewDir, { recursive: true });
    await fs.copyFile(sourceImage, path.join(singleSourceMultiViewDir, 'one-photo.png'));
    await writeJson(path.join(singleSourceMultiViewDir, 'manifest.json'), {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      object_type: 'building_single',
      views: [
        { source_image: 'one-photo.png', kind: 'front' },
        { source_image: 'one-photo.png', kind: 'left' },
        { source_image: 'one-photo.png', kind: 'oblique' },
        { source_image: 'one-photo.png', kind: 'top' }
      ]
    });
    const singleSourceMultiViewSummary = await runRealWorldBuildingUploadSession({
      input: path.join(outputDir, 'upload-session-single-source-multiview', 'source'),
      objectType: 'building_single',
      objectName: 'Release Gate Upload Session Single Source Multiview Fixture',
      outputDir: path.join(outputDir, 'upload-session-single-source-multiview', 'session'),
      writeOverlays: false,
      requirePreflightReleaseSourceCandidate: true
    });
    assertEqual(singleSourceMultiViewSummary.ok, false, 'single-source multiview upload session must fail requested preflight gate');
    assertEqual(singleSourceMultiViewSummary.status, 'blocked_preflight', 'single-source multiview upload session must expose preflight block');
    assertEqual(singleSourceMultiViewSummary.preflight.status, 'blocked_source_assets', 'single-source multiview upload session must block source assets');
    assertIncludes(
      singleSourceMultiViewSummary.preflight.blockers,
      'view_sources_not_distinct',
      'single-source multiview upload session must expose view_sources_not_distinct blocker'
    );
    assertEqual(singleSourceMultiViewSummary.preflight.view_source_diversity?.status, 'fail', 'single-source multiview upload session must expose view source diversity failure');
    assertEqual(singleSourceMultiViewSummary.workflow.stage, 'source_refill_required', 'single-source multiview workflow must require source refill');
    assertIncludes(singleSourceMultiViewSummary.workflow.required_user_inputs, 'view_sources_not_distinct', 'single-source multiview workflow must expose distinct source-image blocker');
    assertEqual(singleSourceMultiViewSummary.artifacts.view_hints, null, 'single-source multiview upload session must not generate view hints from conflicted labels');
    assertEqual(
      await pathExists(resolveRepo(path.join(outputDir, 'upload-session-single-source-multiview', 'session', 'view-hints.generated.json'))),
      false,
      'single-source multiview upload session must not write generated view hints'
    );

    const singleSourceMultiViewResponseDir = path.join(absoluteOutputDir, 'upload-session-single-source-multiview-response', 'source');
    await fs.rm(singleSourceMultiViewResponseDir, { recursive: true, force: true });
    await fs.mkdir(singleSourceMultiViewResponseDir, { recursive: true });
    await fs.copyFile(sourceImage, path.join(singleSourceMultiViewResponseDir, 'one-photo.png'));
    await writeJson(path.join(singleSourceMultiViewResponseDir, 'manifest.json'), {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      object_type: 'building_single',
      views: [
        { source_image: 'one-photo.png', kind: 'front' },
        { source_image: 'one-photo.png', kind: 'left' },
        { source_image: 'one-photo.png', kind: 'oblique' },
        { source_image: 'one-photo.png', kind: 'top' }
      ]
    });
    const singleSourceMultiViewResponseSummary = await runRealWorldBuildingUploadSession({
      input: path.join(outputDir, 'upload-session-single-source-multiview-response', 'source'),
      objectType: 'building_single',
      objectName: 'Release Gate Upload Session Single Source Multiview Response Fixture',
      outputDir: path.join(outputDir, 'upload-session-single-source-multiview-response', 'session'),
      sourceRequestFile: path.join(outputDir, 'upload-session-blocked', 'intake', 'real-world-building-source-request.json'),
      writeOverlays: false,
      requirePreflightReleaseSourceCandidate: true
    });
    assertEqual(singleSourceMultiViewResponseSummary.ok, false, 'single-source multiview response upload session must fail requested gates');
    assertEqual(singleSourceMultiViewResponseSummary.status, 'blocked_preflight', 'single-source multiview response upload session must expose preflight block');
    assertIncludes(
      singleSourceMultiViewResponseSummary.preflight.blockers,
      'view_sources_not_distinct',
      'single-source multiview response upload session must expose view source blocker'
    );
    assertEqual(
      singleSourceMultiViewResponseSummary.gates.source_request_response_ok,
      false,
      'single-source multiview response upload session must fail previous source request response gate'
    );
    assertEqual(singleSourceMultiViewResponseSummary.workflow.stage, 'source_response_refill_required', 'single-source multiview response workflow must require another refill');
    assertIncludes(
      singleSourceMultiViewResponseSummary.workflow.required_user_inputs,
      'source_request_response:view_source_diversity',
      'single-source multiview response workflow must expose failed response check'
    );
    assertEqual(
      singleSourceMultiViewResponseSummary.workflow.source_request_response_file,
      singleSourceMultiViewResponseSummary.artifacts.source_request_response,
      'single-source multiview response workflow must point at source-request response artifact'
    );
    assertEqual(
      singleSourceMultiViewResponseSummary.source_request_response?.status,
      'partially_satisfied',
      'single-source multiview response upload session should expose partial source request response'
    );
    assertTruthy(
      singleSourceMultiViewResponseSummary.source_request_response?.unsatisfied_checks > 0,
      'single-source multiview response upload session must expose unsatisfied checks'
    );
    assertTruthy(
      singleSourceMultiViewResponseSummary.artifacts.source_request_response?.endsWith('source-request-response.json'),
      'single-source multiview response upload session must expose source request response artifact'
    );
    assertTruthy(
      singleSourceMultiViewResponseSummary.artifacts.source_request_response_markdown?.endsWith('source-request-response.md'),
      'single-source multiview response upload session must expose source request response markdown'
    );
    assertEqual(singleSourceMultiViewResponseSummary.artifacts.view_hints, null, 'single-source multiview response upload session must not generate view hints from conflicted labels');
    assertEqual(
      await pathExists(resolveRepo(path.join(outputDir, 'upload-session-single-source-multiview-response', 'session', 'view-hints.generated.json'))),
      false,
      'single-source multiview response upload session must not write generated view hints'
    );
    const singleSourceMultiViewResponseArtifact = await readJson(resolveRepo(singleSourceMultiViewResponseSummary.artifacts.source_request_response));
    const singleSourceMultiViewResponseMcpBrief = await readJson(resolveRepo(singleSourceMultiViewResponseSummary.artifacts.mcp_modeling_brief));
    const singleSourceMultiViewResponseReview = await fs.readFile(resolveRepo(singleSourceMultiViewResponseSummary.artifacts.review_workbench), 'utf8');
    const singleSourceMultiViewResponseCheck = singleSourceMultiViewResponseArtifact.checks.find((check) => check.id === 'view_source_diversity');
    assertEqual(singleSourceMultiViewResponseArtifact.kind, 'real_world_building_source_request_response', 'single-source multiview response artifact should use stable kind');
    assertEqual(singleSourceMultiViewResponseArtifact.ok, false, 'single-source multiview response artifact must fail previous source request');
    assertEqual(singleSourceMultiViewResponseArtifact.status, 'partially_satisfied', 'single-source multiview response artifact should be partial, not satisfied');
    assertTruthy(singleSourceMultiViewResponseCheck, 'single-source multiview response artifact must include view_source_diversity check');
    assertEqual(singleSourceMultiViewResponseCheck.requested, true, 'single-source multiview response must request view source diversity check');
    assertEqual(singleSourceMultiViewResponseCheck.satisfied, false, 'single-source multiview response must fail view source diversity check');
    assertEqual(singleSourceMultiViewResponseCheck.current_status, 'fail', 'single-source multiview response must expose current diversity failure');
    assertEqual(singleSourceMultiViewResponseMcpBrief.source_request_response_gate?.status, 'partially_satisfied', 'single-source multiview response MCP brief must carry response gate status');
    assertIncludes(
      singleSourceMultiViewResponseMcpBrief.source_request_response_gate?.unsatisfied_check_ids || [],
      'view_source_diversity',
      'single-source multiview response MCP brief must expose failed response check ids'
    );
    assertIncludes(
      singleSourceMultiViewResponseMcpBrief.compile_permission?.reasons || [],
      'source_request_response_failed',
      'single-source multiview response MCP brief must expose source-request response blocker'
    );
    assertTruthy(
      singleSourceMultiViewResponseReview.includes('source_request_response=partially_satisfied'),
      'single-source multiview response review workbench must render response gate status'
    );
    assertTruthy(
      singleSourceMultiViewResponseReview.includes('view_source_diversity'),
      'single-source multiview response review workbench must render failed response check ids'
    );
    return {
      status: 'blocked',
      artifacts: {
        ...summary.artifacts,
        invalid_manifest_upload_session_summary: invalidManifestSummary.artifacts.upload_session_summary,
        invalid_manifest_upload_session_markdown: invalidManifestSummary.artifacts.upload_session_markdown,
        single_source_multiview_upload_session_summary: singleSourceMultiViewSummary.artifacts.upload_session_summary,
        single_source_multiview_upload_session_markdown: singleSourceMultiViewSummary.artifacts.upload_session_markdown,
        single_source_multiview_response_upload_session_summary: singleSourceMultiViewResponseSummary.artifacts.upload_session_summary,
        single_source_multiview_response_upload_session_markdown: singleSourceMultiViewResponseSummary.artifacts.upload_session_markdown,
        single_source_multiview_response_artifact: singleSourceMultiViewResponseSummary.artifacts.source_request_response,
        single_source_multiview_response_markdown: singleSourceMultiViewResponseSummary.artifacts.source_request_response_markdown,
        source_refill_package_guide: sourceRefillPackage.guideOutput,
        source_refill_package_markdown: sourceRefillPackage.markdownOutput,
        source_refill_package_readme: sourceRefillPackage.readmeOutput,
        source_refill_package_manifest_template: sourceRefillPackage.manifestTemplateOutput,
        source_refill_package_sources_readme: sourceRefillPackage.sourceSlotsReadmeOutput,
        source_refill_package_validation: sourceRefillPackageValidation.output,
        source_refill_package_validation_markdown: sourceRefillPackageValidation.markdownOutput,
        release_artifact_workspace: releaseArtifactWorkspaceResult.output,
        release_artifact_workspace_markdown: releaseArtifactWorkspaceResult.markdownOutput,
        release_artifact_workspace_validation: releaseArtifactWorkspaceValidation.output,
        release_artifact_workspace_validation_markdown: releaseArtifactWorkspaceValidation.markdownOutput
      },
      metrics: {
        session_ok: summary.ok,
        session_status: summary.status,
        preflight_status: summary.preflight.status,
        intake_status: summary.intake?.status || null,
        source_package_gate_ok: summary.gates.source_package_gate_ok,
        can_generate_sketchup_dsl: summary.gates.can_generate_sketchup_dsl,
        source_request_artifact: summary.artifacts.source_request,
        upload_manifest_template: summary.artifacts.upload_manifest_template,
        source_refill_package_direct_upload_ready: sourceRefillPackage.guide.package_policy.direct_upload_ready,
        source_refill_package_required_views: sourceRefillPackage.guide.required_views,
        source_refill_package_missing_required_views: sourceRefillPackage.guide.missing_required_views,
        source_refill_package_manifest_builder_command: sourceRefillPackage.guide.commands.build_manifest_from_sources,
        source_refill_package_workflow_command: sourceRefillPackage.guide.commands.run_source_refill_workflow,
        source_refill_package_validate_command_has_source_request: sourceRefillPackage.guide.commands.require_input_ready.includes('--source-request-file'),
        source_refill_package_validation_status: sourceRefillPackageValidation.status,
        source_refill_package_validation_can_run_upload_session: sourceRefillPackageValidation.report.can_run_upload_session,
        source_refill_package_validation_failed_required_checks: sourceRefillPackageValidation.report.summary.failed_required_checks,
        source_package_summary_blockers: summary.intake?.source_package?.blockers || [],
        source_package_summary_failed_requirements: summary.intake?.source_package?.failed_requirements || [],
        source_package_view_evidence: summary.intake?.source_package?.view_evidence || [],
        source_package_semantic_role_evidence: summary.intake?.source_package?.semantic_role_evidence || [],
        source_package_semantic_evidence_quality: summary.intake?.source_package?.semantic_evidence_quality || null,
        handoff_semantic_evidence_quality: uploadSessionHandoff.semantic_evidence_quality || null,
        vision_evidence_review_items: summary.vision_evidence?.review_items || 0,
        vision_evidence_semantic_candidate_review_items: summary.vision_evidence?.semantic_candidate_review_items || 0,
        vision_evidence_review_patch: summary.artifacts.vision_evidence_review_patch,
        vision_evidence_review_workbench: summary.artifacts.vision_evidence_review_workbench,
        workflow_stage: summary.workflow.stage,
        workflow_required_user_inputs: summary.workflow.required_user_inputs,
        release_artifact_workspace_status: releaseArtifactWorkspaceResult.status,
        release_artifact_workspace_artifact_count: releaseArtifactWorkspaceResult.workspace.required_artifacts.length,
        release_artifact_workspace_validation_status: releaseArtifactWorkspaceValidation.status,
        release_artifact_workspace_validation_failed_required_checks: releaseArtifactWorkspaceValidation.report.summary.failed_required_checks,
        preflight_metadata_statuses: summary.preflight.metadata_files.map((record) => record.status),
        invalid_manifest_status: invalidManifestSummary.status,
        invalid_manifest_workflow_stage: invalidManifestSummary.workflow.stage,
        invalid_manifest_preflight_blockers: invalidManifestSummary.preflight.blockers,
        invalid_manifest_metadata_statuses: invalidManifestSummary.preflight.metadata_files.map((record) => record.status),
        single_source_multiview_status: singleSourceMultiViewSummary.status,
        single_source_multiview_workflow_stage: singleSourceMultiViewSummary.workflow.stage,
        single_source_multiview_preflight_blockers: singleSourceMultiViewSummary.preflight.blockers,
        single_source_multiview_view_source_diversity_status: singleSourceMultiViewSummary.preflight.view_source_diversity?.status || null,
        single_source_multiview_view_hints_artifact: singleSourceMultiViewSummary.artifacts.view_hints,
        single_source_multiview_response_session_status: singleSourceMultiViewResponseSummary.status,
        single_source_multiview_response_workflow_stage: singleSourceMultiViewResponseSummary.workflow.stage,
        single_source_multiview_response_workflow_required_user_inputs: singleSourceMultiViewResponseSummary.workflow.required_user_inputs,
        single_source_multiview_response_preflight_blockers: singleSourceMultiViewResponseSummary.preflight.blockers,
        single_source_multiview_response_source_request_response_status: singleSourceMultiViewResponseSummary.source_request_response?.status || null,
        single_source_multiview_response_ok: singleSourceMultiViewResponseSummary.gates.source_request_response_ok,
        single_source_multiview_response_check_status: singleSourceMultiViewResponseCheck.current_status,
        single_source_multiview_response_check_satisfied: singleSourceMultiViewResponseCheck.satisfied,
        single_source_multiview_response_unsatisfied_checks: singleSourceMultiViewResponseSummary.source_request_response?.unsatisfied_checks || 0,
        single_source_multiview_response_unsatisfied_check_ids: singleSourceMultiViewResponseSummary.source_request_response?.unsatisfied_check_ids || [],
        single_source_multiview_response_unsatisfied_check_details: singleSourceMultiViewResponseSummary.source_request_response?.unsatisfied_check_details || [],
        single_source_multiview_response_view_evidence: singleSourceMultiViewResponseSummary.source_request_response?.view_evidence || null,
        single_source_multiview_response_semantic_evidence: singleSourceMultiViewResponseSummary.source_request_response?.semantic_evidence || null,
        single_source_multiview_response_mcp_gate_status: singleSourceMultiViewResponseMcpBrief.source_request_response_gate?.status || null,
        single_source_multiview_response_mcp_view_evidence: singleSourceMultiViewResponseMcpBrief.source_request_response_gate?.view_evidence || null,
        single_source_multiview_response_mcp_semantic_evidence: singleSourceMultiViewResponseMcpBrief.source_request_response_gate?.semantic_evidence || null,
        single_source_multiview_response_mcp_reason_ids: singleSourceMultiViewResponseMcpBrief.compile_permission?.reasons || [],
        single_source_multiview_response_artifact: singleSourceMultiViewResponseSummary.artifacts.source_request_response,
        next_actions: summary.next_actions
      }
    };
  });
  cases.push(uploadSessionCase);

  const uploadSessionGeneratedViewHintsCase = await collectCase('real_world_building_upload_session_generated_view_hints_fixture', async () => {
    const sourceDir = path.join(absoluteOutputDir, 'upload-session-auto-view-hints', 'source');
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.mkdir(sourceDir, { recursive: true });
    const sourceImage = resolveRepo(CANONICAL_SINGLE_INPUT);
    const uploadManifest = {
      version: 1,
      kind: 'real_world_building_upload_manifest',
      object_type: 'building_single',
      dimensions: {
        units: 'mm',
        width: 9000,
        depth: 12000,
        height: 10500,
        confidence: 0.84,
        basis: ['Release gate fixture known building dimensions.']
      },
      views: [
        { source_image: 'photo-a.png', kind: 'front' },
        { source_image: 'photo-b.png', kind: 'left' },
        { source_image: 'photo-c.png', kind: 'oblique' },
        { source_image: 'photo-d.png', kind: 'top' }
      ]
    };
    await writeDistinctImageVariant(sourceImage, path.join(sourceDir, 'photo-a.png'), 1);
    await writeDistinctImageVariant(sourceImage, path.join(sourceDir, 'photo-b.png'), 2);
    await writeDistinctImageVariant(sourceImage, path.join(sourceDir, 'photo-c.png'), 3);
    await writeDistinctImageVariant(sourceImage, path.join(sourceDir, 'photo-d.png'), 4);
    await writeJson(path.join(sourceDir, 'manifest.json'), uploadManifest);
    const summary = await runRealWorldBuildingUploadSession({
      input: path.join(outputDir, 'upload-session-auto-view-hints', 'source'),
      objectType: 'building_single',
      objectName: 'Release Gate Upload Session Generated View Hints Fixture',
      outputDir: path.join(outputDir, 'upload-session-auto-view-hints', 'session'),
      sourceRequestFile: path.join(outputDir, 'upload-session-blocked', 'intake', 'real-world-building-source-request.json'),
      writeOverlays: false,
      requirePreflightReleaseSourceCandidate: true,
      requireSourceInputReady: true,
      writeRealWorldBuildingReleaseDraft: true,
      releaseDraftReviewer: 'release gate generated view hints fixture',
      releaseDraftAcceptedAt: '2026-06-17',
      releaseDraftNotes: 'Release gate fixture; validates upload-session release draft artifact wiring without claiming release readiness.'
    });
    assertEqual(summary.ok, true, 'generated-view-hints upload session should pass requested preflight gate');
    assertEqual(summary.status, 'ready_for_review_work', 'generated-view-hints upload session should enter review work');
    assertEqual(summary.preflight.release_source_candidate, true, 'generated-view-hints upload session should preserve release-source preflight candidate status');
    assertTruthy(summary.preflight.metadata_files.some((record) => record.source === 'upload_manifest' && record.status === 'parsed'), 'generated-view-hints upload session should expose parsed upload manifest metadata in summary');
    assertEqual(summary.preflight.scale_package?.has_known_dimensions, true, 'generated-view-hints upload session should expose upload-manifest known dimensions');
    assertEqual(summary.preflight.blockers.includes('duplicate_source_assets'), false, 'generated-view-hints upload session should use distinct source file content');
    assertEqual(summary.preflight.view_source_diversity?.status, 'pass', 'generated-view-hints upload session should use distinct source paths for required views');
    assertEqual(summary.gates.source_package_gate_ok, true, 'generated-view-hints upload session source input gate should pass');
    assertEqual(summary.gates.source_request_response_ok, true, 'generated-view-hints upload session should satisfy previous source request');
    assertEqual(summary.source_request_response?.status, 'satisfied_for_release_work', 'generated-view-hints upload session should expose satisfied source-request response');
    assertEqual(summary.source_request_response?.unsatisfied_checks, 0, 'generated-view-hints source-request response should satisfy requested checks');
    assertEqual(summary.workflow.stage, 'source_input_ready_needs_release_artifacts', 'generated-view-hints workflow should advance to release artifact work');
    assertEqual(summary.workflow.can_continue_without_new_upload, true, 'generated-view-hints workflow should continue without another upload');
    assertEqual(summary.handoff.status, 'ready_for_release_artifact_work', 'generated-view-hints handoff should route to release artifact work');
    assertEqual(summary.handoff.primary_action.kind, 'produce_release_artifacts', 'generated-view-hints handoff must request release artifacts');
    assertEqual(summary.workflow.source_request_response_file, summary.artifacts.source_request_response, 'generated-view-hints workflow should point to source-request response artifact');
    assertEqual(summary.workflow.release_manifest_draft, summary.artifacts.real_world_building_release_manifest_draft, 'generated-view-hints workflow should point to release manifest draft');
    assertEqual(summary.workflow.release_work_order, summary.artifacts.real_world_building_release_work_order, 'generated-view-hints workflow should point to release work order artifact');
    assertEqual(summary.workflow.release_work_order_markdown, summary.artifacts.real_world_building_release_work_order_markdown, 'generated-view-hints workflow should point to release work order markdown artifact');
    assertEqual(summary.workflow.release_artifact_workspace, path.join(outputDir, 'upload-session-auto-view-hints', 'session', 'release-artifact-workspace.json'), 'generated-view-hints workflow should point to release artifact workspace');
    assertIncludes(summary.workflow.required_user_inputs, 'release_draft:artifacts', 'generated-view-hints workflow must expose release artifact requirement');
    assertIncludes(summary.workflow.required_user_inputs, 'release_draft:photo_grade_readiness', 'generated-view-hints workflow must expose PhotoGradeReadiness requirement');
    assertIncludes(summary.workflow.required_user_inputs, 'release_draft:vision_evidence_review', 'generated-view-hints workflow must expose VisionEvidence review requirement');
    assertTruthy(
      summary.workflow.commands.prepare_release_sample_from_intake?.includes('prepare-real-world-building'),
      'generated-view-hints workflow should include release sample preparation command'
    );
    assertTruthy(
      summary.workflow.commands.prepare_release_artifact_workspace?.includes('prepare-real-world-building-release-artifact-workspace'),
      'generated-view-hints workflow should include release artifact workspace command'
    );
    assertTruthy(
      summary.workflow.commands.prepare_vision_evidence_review_workbench?.includes('make-vision-evidence-review-workbench.mjs'),
      'generated-view-hints workflow should include VisionEvidence review workbench command'
    );
    assertTruthy(
      summary.workflow.commands.build_vision_evidence_policy_correction_patch?.includes('build-vision-evidence-policy-correction-patch.mjs'),
      'generated-view-hints workflow should include VisionEvidence policy correction command'
    );
    assertTruthy(
      summary.workflow.commands.build_vision_evidence_policy_correction_patch?.includes('vision-evidence-review.accepted.json'),
      'generated-view-hints VisionEvidence policy correction command should require accepted review decision'
    );
    assertTruthy(
      summary.workflow.commands.validate_release_draft?.includes('--require-present'),
      'generated-view-hints workflow should include release draft validation command'
    );
    assertEqual(summary.intake?.source_package?.gate_ok, true, 'generated-view-hints upload session source-package summary should expose passed input gate');
    assertIncludes(
      summary.intake?.source_package?.release_checklist_blockers || [],
      'artifacts',
      'generated-view-hints upload session source-package summary should expose release artifact blocker'
    );
    assertEqual(summary.intake?.missing_inputs.includes('missing_front_view'), false, 'generated view hints must clear missing front view');
    assertEqual(summary.intake?.missing_inputs.includes('missing_left_view'), false, 'generated view hints must clear missing left view');
    assertEqual(summary.intake?.missing_inputs.includes('missing_oblique_view'), false, 'generated view hints must clear missing oblique view');
    assertEqual(summary.intake?.missing_inputs.includes('missing_top_view'), false, 'generated view hints must clear missing top view');
    assertEqual(summary.gates.can_generate_sketchup_dsl, false, 'generated-view-hints upload session must still forbid direct SketchUp DSL');
    assertTruthy(summary.artifacts.view_hints?.endsWith('view-hints.generated.json'), 'generated-view-hints upload session should expose generated view hints artifact');
    assertTruthy(summary.artifacts.upload_session_handoff?.endsWith('upload-session-handoff.json'), 'generated-view-hints upload session should expose handoff artifact');
    assertTruthy(summary.artifacts.upload_session_handoff_markdown?.endsWith('upload-session-handoff.md'), 'generated-view-hints upload session should expose handoff markdown artifact');
    assertTruthy(summary.artifacts.real_world_building_release_manifest_draft?.endsWith('real-world-building-release/manifest.draft.json'), 'generated-view-hints upload session should expose release manifest draft artifact');
    assertTruthy(summary.artifacts.real_world_building_release_contract_summary?.endsWith('real-world-building-release/manifest-contract-summary.json'), 'generated-view-hints upload session should expose release contract summary artifact');
    assertTruthy(summary.artifacts.real_world_building_release_checklist?.endsWith('real-world-building-release/release-checklist.json'), 'generated-view-hints upload session should expose release checklist artifact');
    assertTruthy(summary.artifacts.real_world_building_release_checklist_markdown?.endsWith('real-world-building-release/release-checklist.md'), 'generated-view-hints upload session should expose release checklist markdown artifact');
    assertTruthy(summary.artifacts.real_world_building_release_work_order?.endsWith('real-world-building-release/release-work-order.json'), 'generated-view-hints upload session should expose release work order artifact');
    assertTruthy(summary.artifacts.real_world_building_release_work_order_markdown?.endsWith('real-world-building-release/release-work-order.md'), 'generated-view-hints upload session should expose release work order markdown artifact');
    assertTruthy(summary.artifacts.source_request?.endsWith('real-world-building-source-request.json'), 'generated-view-hints upload session should expose source request artifact');
    assertTruthy(summary.artifacts.source_request_markdown?.endsWith('real-world-building-source-request.md'), 'generated-view-hints upload session should expose source request markdown artifact');
    assertTruthy(summary.artifacts.source_request_response?.endsWith('source-request-response.json'), 'generated-view-hints upload session should expose source request response artifact');
    assertTruthy(summary.artifacts.source_request_response_markdown?.endsWith('source-request-response.md'), 'generated-view-hints upload session should expose source request response markdown artifact');
    assertTruthy(summary.artifacts.upload_manifest_template?.endsWith('upload-manifest.template.json'), 'generated-view-hints upload session should expose upload manifest template artifact');
    assertTruthy(summary.artifacts.source_package_gate_result?.endsWith('real-world-building-source-package.gate-result.json'), 'generated-view-hints upload session should expose source-package gate artifact');
    assertTruthy(summary.artifacts.vision_evidence_report?.endsWith('vision-evidence-v1-report.json'), 'generated-view-hints upload session should expose VisionEvidence report artifact');
    assertTruthy(summary.artifacts.vision_evidence_review_patch?.endsWith('vision-evidence-review-patch.json'), 'generated-view-hints upload session should expose VisionEvidence review patch artifact');
    assertTruthy(summary.artifacts.vision_evidence_review_workbench?.endsWith('vision-evidence-review/index.html'), 'generated-view-hints upload session should expose VisionEvidence review workbench artifact');
    const preflightReport = await readJson(resolveRepo(summary.artifacts.preflight));
    assertEqual(preflightReport.asset_count, 4, 'generated-view-hints upload session should not count upload manifest as a source asset');
    assertTruthy(preflightReport.view_package.sources.every((source) => source.source === 'upload_manifest'), 'generated-view-hints upload session should source view labels from upload manifest');
    assertEqual(preflightReport.scale_package.has_known_dimensions, true, 'generated-view-hints upload session preflight should expose upload-manifest known dimensions');
    const observations = await readJson(path.join(outputDir, 'upload-session-auto-view-hints', 'session', 'intake', 'observations.json'));
    assertEqual(observations.scale_calibration.strategy, 'source_metadata_known_dimensions_with_view_bbox', 'generated-view-hints upload session should carry upload-manifest scale into observations');
    const mcpBrief = await readJson(path.join(outputDir, 'upload-session-auto-view-hints', 'session', 'intake', 'mcp-modeling-brief.json'));
    assertEqual(mcpBrief.evidence_summary.scale_strategy, 'source_metadata_known_dimensions_with_view_bbox', 'generated-view-hints upload session should carry upload-manifest scale into MCP brief');
    assertEqual(mcpBrief.evidence_summary.vision_evidence?.available, true, 'generated-view-hints upload session MCP brief should expose VisionEvidence availability');
    assertIncludes(
      mcpBrief.evidence_summary.vision_evidence?.semantic_review_roles || [],
      'visible_plane_recessed_left',
      'generated-view-hints MCP brief should expose recessed facade VisionEvidence role'
    );
    assertVisionEvidenceWorkspaceInstance(
      mcpBrief.evidence_summary.vision_evidence,
      'rectangular_utility_ducts',
      'generated-view-hints MCP brief should expose duct VisionEvidence semantic instance'
    );
    assertTruthy(
      hasVisionEvidenceModelingHandoff(mcpBrief.evidence_summary.vision_evidence, 'rectangular_utility_ducts', 'decorative_facade_trim'),
      'generated-view-hints MCP brief should expose duct VisionEvidence modeling handoff'
    );
    assertTruthy(
      mcpBrief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'vision_evidence_review_patch'),
      'generated-view-hints MCP brief should include VisionEvidence review patch as an authoritative artifact'
    );
    assertEqual(mcpBrief.source_request_response_gate?.status, 'satisfied_for_release_work', 'generated-view-hints upload session MCP brief should carry satisfied source-request response gate');
    assertEqual((mcpBrief.source_request_response_gate?.unsatisfied_check_ids || []).length, 0, 'generated-view-hints upload session MCP brief should expose no unsatisfied response checks');
    assertIncludes(
      mcpBrief.source_package_gate?.release_checklist_required_check_ids || [],
      'vision_evidence_review',
      'generated-view-hints upload session MCP brief must expose required release checklist id'
    );
    assertIncludes(
      mcpBrief.source_package_gate?.release_checklist_failed_required_check_ids || [],
      'photo_grade_readiness',
      'generated-view-hints upload session MCP brief must expose failed required release checklist id'
    );
    assertIncludes(
      mcpBrief.agent_contract.output_policy.release_checklist_failed_required_check_ids || [],
      'vision_evidence_review',
      'generated-view-hints upload session MCP agent contract must expose failed required release checklist id'
    );
    const generatedReview = await fs.readFile(resolveRepo(summary.artifacts.review_workbench), 'utf8');
    const generatedVisionReviewPatch = await readJson(resolveRepo(summary.artifacts.vision_evidence_review_patch));
    const generatedVisionReviewWorkbench = await fs.readFile(resolveRepo(summary.artifacts.vision_evidence_review_workbench), 'utf8');
    assertTruthy(
      generatedReview.includes('source_request_response=satisfied_for_release_work'),
      'generated-view-hints review workbench must render satisfied source-request response gate'
    );
    assertTruthy(generatedReview.includes('open-vision-evidence-review-workbench'), 'generated-view-hints review workbench must link VisionEvidence review workbench');
    assertIncludes(
      generatedVisionReviewPatch.review_items.map((item) => item.id),
      'semantic_candidate:rectangular_utility_ducts',
      'generated-view-hints VisionEvidence patch should include rectangular duct review item'
    );
    assertSemanticReviewItemHasEvidenceInstance(
      generatedVisionReviewPatch,
      'shadow_or_recess_boundary',
      'generated-view-hints VisionEvidence patch should locate shadow/recess evidence'
    );
    assertTruthy(generatedVisionReviewWorkbench.includes('semantic_candidate:shadow_or_recess_boundary'), 'generated-view-hints VisionEvidence workbench should render shadow/recess item');
    assertTruthy(generatedReview.includes('download-real-world-building-release-work-order'), 'generated-view-hints review workbench must link release work order JSON');
    assertTruthy(generatedReview.includes('real-world-building-release-work-order-data'), 'generated-view-hints review workbench must embed release work order JSON');
    assertEqual(summary.real_world_building_release_draft?.validation_status, 'manifest_invalid_release_gap_recorded', 'generated-view-hints upload session release draft should fail closed with structured status');
    assertEqual(summary.real_world_building_release_draft?.validation_ok, false, 'generated-view-hints upload session release draft validation should fail closed');
    assertEqual(summary.real_world_building_release_draft?.release_ready, false, 'generated-view-hints upload session release draft must not be ready');
    assertEqual(summary.real_world_building_release_draft?.can_promote_to_release_manifest, false, 'generated-view-hints upload session release draft must not be promotable');
    assertIncludes(summary.real_world_building_release_draft?.blockers || [], 'artifacts', 'generated-view-hints upload session release draft must expose artifact blocker');
    assertIncludes(summary.real_world_building_release_draft?.blockers || [], 'photo_grade_readiness', 'generated-view-hints upload session release draft must expose PhotoGradeReadiness blocker');
    assertIncludes(summary.real_world_building_release_draft?.blockers || [], 'vision_evidence_review', 'generated-view-hints upload session release draft must expose VisionEvidence review blocker');
    assertEqual(summary.real_world_building_release_draft?.work_order_status, 'needs_release_artifacts', 'generated-view-hints upload session release work order should advance to artifact work');
    assertTruthy((summary.real_world_building_release_draft?.work_order_blocked_required_tasks || 0) > 0, 'generated-view-hints upload session release work order should expose blocked required task count');
    const generatedHints = await readJson(resolveRepo(summary.artifacts.view_hints));
    const uploadSessionHandoff = await readJson(resolveRepo(summary.artifacts.upload_session_handoff));
    const uploadSessionHandoffMarkdown = await fs.readFile(resolveRepo(summary.artifacts.upload_session_handoff_markdown), 'utf8');
    const sourceRequestArtifact = await readJson(resolveRepo(summary.artifacts.source_request));
    const sourceRequestResponseArtifact = await readJson(resolveRepo(summary.artifacts.source_request_response));
    const uploadManifestTemplate = await readJson(resolveRepo(summary.artifacts.upload_manifest_template));
    const releaseChecklist = await readJson(resolveRepo(summary.artifacts.real_world_building_release_checklist));
    const releaseWorkOrder = await readJson(resolveRepo(summary.artifacts.real_world_building_release_work_order));
    const releaseWorkOrderMarkdown = await fs.readFile(resolveRepo(summary.artifacts.real_world_building_release_work_order_markdown), 'utf8');
    const releaseArtifactWorkspaceResult = await prepareRealWorldBuildingReleaseArtifactWorkspaceCli({
      uploadSessionSummary: summary.artifacts.upload_session_summary,
      output: summary.workflow.release_artifact_workspace,
      generatedAt: '2026-06-17T00:00:00.000Z'
    });
    const releaseArtifactWorkspaceValidation = await validateRealWorldBuildingReleaseArtifactWorkspaceCli({
      workspace: releaseArtifactWorkspaceResult.output,
      output: path.join(outputDir, 'upload-session-auto-view-hints', 'session', 'release-artifact-workspace-validation.json'),
      requireReadyToAuthor: true,
      generatedAt: '2026-06-17T00:00:00.000Z'
    });
    assertEqual(generatedHints.kind, 'upload_session_view_hints', 'generated view hints should use stable kind');
    assertEqual(uploadSessionHandoff.kind, 'real_world_building_upload_session_handoff', 'generated-view-hints handoff should use stable kind');
    assertEqual(uploadSessionHandoff.status, 'ready_for_release_artifact_work', 'generated-view-hints handoff should route to artifact work');
    assertTruthy(['weak_review_required', 'review_required'].includes(uploadSessionHandoff.semantic_evidence_quality?.status), 'generated-view-hints handoff should expose semantic evidence quality');
    assertEqual(uploadSessionHandoff.semantic_evidence_quality?.geometry_promotion_allowed, false, 'generated-hints handoff should keep semantic evidence quality review-gated');
    assertEqual(uploadSessionHandoff.vision_evidence?.available, true, 'generated-view-hints handoff should expose VisionEvidence availability');
    assertVisionEvidenceWorkspaceInstance(
      uploadSessionHandoff.vision_evidence,
      'rectangular_utility_ducts',
      'generated-view-hints handoff should preserve duct VisionEvidence semantic instance'
    );
    assertTruthy(
      hasVisionEvidenceModelingHandoff(uploadSessionHandoff.vision_evidence, 'rectangular_utility_ducts', 'decorative_facade_trim'),
      'generated-view-hints handoff should preserve duct VisionEvidence modeling handoff'
    );
    assertTruthy(
      hasVisionEvidenceModelingHandoff(uploadSessionHandoff.vision_evidence, 'shadow_or_recess_boundary', 'cut_recess_from_shadow_only'),
      'generated-view-hints handoff should preserve shadow/recess VisionEvidence modeling handoff'
    );
    assertEqual(uploadSessionHandoff.primary_action.artifact, summary.workflow.release_artifact_workspace, 'generated-view-hints handoff should point primary action at release artifact workspace');
    assertEqual(uploadSessionHandoff.primary_action.artifact_exists, false, 'generated-view-hints handoff should expose missing release workspace primary artifact');
    assertTruthy(uploadSessionHandoff.primary_action.command?.includes('prepare-real-world-building-release-artifact-workspace'), 'generated-view-hints handoff should use workspace command');
    assertTruthy(uploadSessionHandoff.commands.build_vision_evidence_policy_correction_patch?.includes('build-vision-evidence-policy-correction-patch.mjs'), 'generated-view-hints handoff should expose VisionEvidence policy correction command');
    assertTruthy(
      uploadSessionHandoff.authoritative_artifacts.some((artifact) => artifact.role === 'upload_session_handoff' && artifact.exists === true),
      'generated-view-hints handoff should expose self handoff artifact exists state'
    );
    assertTruthy(
      uploadSessionHandoff.authoritative_artifacts.some((artifact) => artifact.role === 'release_work_order' && artifact.exists === true),
      'generated-view-hints handoff should expose release work order artifact exists state'
    );
    assertTruthy(uploadSessionHandoffMarkdown.includes('Primary Action'), 'generated-view-hints handoff markdown should render primary action');
    assertTruthy(uploadSessionHandoffMarkdown.includes('Semantic evidence quality'), 'generated-view-hints handoff markdown should render semantic evidence quality');
    assertTruthy(uploadSessionHandoffMarkdown.includes('## VisionEvidence Handoff'), 'generated-view-hints handoff markdown should render VisionEvidence handoff');
    assertTruthy(uploadSessionHandoffMarkdown.includes('decorative_facade_trim'), 'generated-view-hints handoff markdown should render duct blocked interpretation');
    assertTruthy(uploadSessionHandoffMarkdown.includes('Artifact exists'), 'generated-view-hints handoff markdown should render primary artifact exists state');
    assertTruthy(uploadSessionHandoffMarkdown.includes('exists=`true`'), 'generated-view-hints handoff markdown should render authoritative artifact exists state');
    assertEqual(releaseWorkOrder.kind, 'real_world_building_release_work_order', 'generated-view-hints release work order should use stable kind');
    assertEqual(releaseWorkOrder.status, 'needs_release_artifacts', 'generated-view-hints release work order should request release artifacts');
    assertIncludes(releaseWorkOrder.blockers, 'artifacts', 'generated-view-hints release work order must expose artifact blocker');
    assertIncludes(releaseWorkOrder.blockers, 'photo_grade_readiness', 'generated-view-hints release work order must expose PhotoGradeReadiness blocker');
    assertEqual(releaseWorkOrder.artifact_authoring_policy?.direct_sketchup_dsl_allowed, false, 'generated-view-hints release work order must forbid direct SketchUp DSL authoring');
    assertEqual(releaseWorkOrder.artifact_authoring_policy?.promoted_geometry_requires_review, true, 'generated-view-hints release work order must require reviewed geometry promotion');
    assertIncludes(
      releaseWorkOrder.artifact_authoring_policy?.required_contract_artifacts || [],
      'release-artifact-workspace.json',
      'generated-view-hints release work order must point artifact authors to release artifact workspace'
    );
    assertTruthy(releaseWorkOrderMarkdown.includes('Artifact Authoring Policy'), 'generated-view-hints release work order markdown should render artifact authoring policy');
    assertTruthy(releaseWorkOrder.tasks.some((task) => task.id === 'compiled_output' && task.command?.includes('compile-part-graph-to-sketchup-dsl')), 'generated-view-hints release work order must include compile command');
    const releaseWorkOrderVisionReviewTask = releaseWorkOrder.tasks.find((task) => task.id === 'vision_evidence_review');
    assertTruthy(
      releaseWorkOrderVisionReviewTask?.command?.includes('build-vision-evidence-policy-correction-patch.mjs'),
      'generated-view-hints release work order must expose VisionEvidence policy correction command'
    );
    assertIncludes(
      (releaseWorkOrderVisionReviewTask?.artifacts || []).map((artifact) => artifact.role),
      'vision_evidence_review_decision',
      'generated-view-hints release work order must expose VisionEvidence review decision artifact'
    );
    assertIncludes(
      (releaseWorkOrderVisionReviewTask?.artifacts || []).map((artifact) => artifact.role),
      'vision_evidence_policy_correction_patch',
      'generated-view-hints release work order must expose VisionEvidence policy correction artifact'
    );
    assertTruthy(releaseWorkOrderMarkdown.includes('# Real-World Building Release Work Order'), 'generated-view-hints release work order markdown should render a title');
    assertEqual(releaseArtifactWorkspaceResult.workspace.kind, 'real_world_building_release_artifact_workspace', 'generated-view-hints workspace should use stable kind');
    assertEqual(releaseArtifactWorkspaceResult.status, 'ready_for_artifact_authoring', 'generated-view-hints workspace should be ready for artifact authoring');
    assertEqual(releaseArtifactWorkspaceValidation.ok, true, 'generated-view-hints workspace validation should pass ready-to-author contract');
    assertEqual(releaseArtifactWorkspaceValidation.status, 'ready_to_author_validated', 'generated-view-hints workspace validation should report ready-to-author validation');
    assertEqual(
      releaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'release_checklist_required_summary_exposed')?.status,
      'pass',
      'generated-view-hints workspace validation must verify release checklist required summary'
    );
    assertEqual(
      releaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'release_checklist_summary_propagated_to_mcp_tasks')?.status,
      'pass',
      'generated-view-hints workspace validation must verify release checklist summary propagation to MCP tasks'
    );
    assertEqual(
      releaseArtifactWorkspaceValidation.report.checks.find((check) => check.id === 'task_packet_mcp_authoring_handoff_present')?.status,
      'pass',
      'generated-view-hints workspace validation must verify MCP authoring handoff propagation'
    );
    assertEqual(releaseArtifactWorkspaceResult.workspace.required_artifacts.length, 3, 'generated-view-hints workspace should expose three required release artifacts');
    assertEqual(releaseArtifactWorkspaceResult.workspace.task_packets.length, 3, 'generated-view-hints workspace should expose one task packet per required release artifact');
    assertIncludes(
      releaseArtifactWorkspaceResult.workspace.review_requirements.map((requirement) => requirement.id),
      'vision_evidence_review',
      'generated-view-hints workspace must expose VisionEvidence review requirement'
    );
    const visionReviewRequirement = releaseArtifactWorkspaceResult.workspace.review_requirements.find((requirement) => requirement.id === 'vision_evidence_review');
    assertIncludes(
      visionReviewRequirement.artifacts.map((artifact) => artifact.role),
      'vision_evidence_review_decision',
      'generated-view-hints workspace VisionEvidence review requirement must expose accepted decision artifact'
    );
    assertIncludes(
      visionReviewRequirement.artifacts.map((artifact) => artifact.role),
      'vision_evidence_policy_correction_patch',
      'generated-view-hints workspace VisionEvidence review requirement must expose policy correction patch artifact'
    );
    assertTruthy(
      visionReviewRequirement.command?.includes('build-vision-evidence-policy-correction-patch.mjs'),
      'generated-view-hints workspace VisionEvidence review requirement must expose policy correction command'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.commands.build_vision_evidence_policy_correction_patch?.includes('build-vision-evidence-policy-correction-patch.mjs'),
      'generated-view-hints workspace commands must expose VisionEvidence policy correction command'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.status === 'ready_to_author' && packet.ready_to_author === true),
      'generated-view-hints workspace task packets should be ready for artifact authoring'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.some((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'do_not_generate_direct_dsl_from_mcp_brief')),
      'generated-view-hints workspace task packets must carry direct-DSL acceptance criterion'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.some((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'preserve_candidate_disambiguation')),
      'generated-view-hints workspace task packets must carry candidate-disambiguation acceptance criterion'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'use_vision_evidence_review_patch' && criterion.status === 'satisfied')),
      'generated-view-hints workspace task packets must require VisionEvidence review patch use'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'use_vision_evidence_instances' && criterion.status === 'satisfied')),
      'generated-view-hints workspace task packets must require VisionEvidence semantic instances'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'use_vision_evidence_modeling_handoff' && criterion.status === 'satisfied')),
      'generated-view-hints workspace task packets must require VisionEvidence modeling handoff'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.acceptance_criteria.some((criterion) => criterion.id === 'address_failed_required_release_checks')),
      'generated-view-hints workspace task packets must require failed release checklist handling'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff?.kind === 'mcp_authoring_handoff'),
      'generated-view-hints workspace task packets must expose MCP authoring handoff'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff?.prompt_text?.includes('VisionEvidence')),
      'generated-view-hints workspace MCP authoring handoff must include VisionEvidence prompt context'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff?.prompt_text?.includes('VisionEvidence review workbench')),
      'generated-view-hints workspace MCP authoring handoff must point to VisionEvidence review workbench'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff?.evidence_digest?.vision_evidence_review_workbench?.endsWith('vision-evidence-review/index.html')),
      'generated-view-hints workspace MCP authoring handoff must expose VisionEvidence review workbench path'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff?.evidence_digest?.blocked_outputs?.includes('direct_sketchup_dsl')),
      'generated-view-hints workspace MCP authoring handoff must preserve direct DSL block'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_constraints.blocked_outputs.includes('direct_sketchup_dsl')),
      'generated-view-hints workspace task packets must inherit MCP blocked direct DSL output'
    );
    assertIncludes(
      releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.release_checklist_failed_required_check_ids || [],
      'photo_grade_readiness',
      'generated-view-hints workspace MCP handoff must expose failed PhotoGradeReadiness checklist id'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_constraints.release_checklist_failed_required_check_ids.includes('vision_evidence_review')),
      'generated-view-hints workspace task packets must inherit failed VisionEvidence checklist id'
    );
    assertEqual(
      releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.vision_evidence?.available,
      true,
      'generated-view-hints workspace MCP handoff must expose VisionEvidence availability'
    );
    assertIncludes(
      releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.vision_evidence?.semantic_review_roles || [],
      'rectangular_utility_ducts',
      'generated-view-hints workspace MCP handoff must expose duct VisionEvidence role'
    );
    assertVisionEvidenceWorkspaceInstance(
      releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.vision_evidence,
      'visible_plane_recessed_left',
      'generated-view-hints workspace MCP handoff must locate recessed visible plane evidence'
    );
    assertTruthy(
      hasVisionEvidenceModelingHandoff(releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.vision_evidence, 'rectangular_utility_ducts', 'decorative_facade_trim'),
      'generated-view-hints workspace MCP handoff must expose duct VisionEvidence modeling handoff'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_constraints.vision_evidence?.review_patch_artifact?.endsWith('vision-evidence-review-patch.json')),
      'generated-view-hints workspace task packets must inherit VisionEvidence review patch artifact'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => hasVisionEvidenceWorkspaceInstance(packet.mcp_constraints.vision_evidence, 'shadow_or_recess_boundary')),
      'generated-view-hints workspace task packets must locate shadow/recess evidence'
    );
    assertTruthy(
      releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => hasVisionEvidenceModelingHandoff(packet.mcp_constraints.vision_evidence, 'shadow_or_recess_boundary', 'cut_recess_from_shadow_only')),
      'generated-view-hints workspace task packets must expose shadow VisionEvidence modeling handoff'
    );
    assertIncludes(
      releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.blocked_interpretations || [],
      'merged_front_facade_plane',
      'generated-view-hints workspace MCP handoff must block merged facade interpretation'
    );
    assertIncludes(
      releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.blocked_interpretations || [],
      'decorative_facade_trim',
      'generated-view-hints workspace MCP handoff must block duct-as-trim interpretation'
    );
    assertIncludes(
      releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.blocked_interpretations || [],
      'cut_recess_from_shadow_only',
      'generated-view-hints workspace MCP handoff must block shadow-only recess cuts'
    );
    assertEqual(sourceRequestArtifact.kind, 'real_world_building_source_request', 'generated-view-hints source-request artifact should use stable kind');
    assertEqual(sourceRequestArtifact.status, 'input_ready_for_release_work', 'generated-view-hints source-request artifact should reflect input-ready source package');
    assertTruthy(['weak_review_required', 'review_required'].includes(sourceRequestArtifact.semantic_evidence_quality?.status), 'generated-view-hints source request should expose semantic evidence quality');
    assertEqual(sourceRequestArtifact.semantic_evidence_quality?.geometry_promotion_allowed, false, 'generated-view-hints source request should keep semantic evidence quality review-gated');
    assertEqual(sourceRequestArtifact.semantic_requirements?.evidence_quality?.geometry_promotion_allowed, false, 'generated-view-hints source request semantic requirements should block geometry promotion');
    assertEqual(sourceRequestArtifact.view_source_requirements?.blocker, 'view_sources_not_distinct', 'generated-view-hints source request must carry distinct view-source blocker');
    assertEqual(sourceRequestArtifact.upload_package_requirements?.scale_evidence?.required, false, 'generated-view-hints source request should expose satisfied scale evidence requirement');
    assertEqual(sourceRequestArtifact.upload_package_requirements?.semantic_evidence?.evidence_quality?.geometry_promotion_allowed, false, 'generated-view-hints source request upload requirements should carry semantic quality gate');
    assertEqual(sourceRequestArtifact.upload_package_requirements?.missing_required_views?.length, 0, 'generated-view-hints source request should expose no missing upload package view slots');
    assertIncludes(
      sourceRequestArtifact.upload_package_requirements?.next_upload_response_check_ids || [],
      'view_source_diversity',
      'generated-view-hints source request should keep view diversity response check explicit'
    );
    assertEqual(sourceRequestResponseArtifact.kind, 'real_world_building_source_request_response', 'generated-view-hints source-request response artifact should use stable kind');
    assertEqual(sourceRequestResponseArtifact.status, 'satisfied_for_release_work', 'generated-view-hints source-request response artifact should be satisfied');
    assertIncludes(
      sourceRequestResponseArtifact.summary.expected_check_ids || [],
      'view_source_diversity',
      'generated-view-hints source-request response must expose expected check ids'
    );
    assertEqual(
      (sourceRequestResponseArtifact.summary.missing_expected_check_ids || []).length,
      0,
      'generated-view-hints source-request response must cover expected check ids'
    );
    assertTruthy(
      Array.isArray(sourceRequestResponseArtifact.summary.semantic_evidence?.current_covered_roles),
      'generated-view-hints source-request response must expose semantic evidence summary'
    );
    assertEqual(
      sourceRequestResponseArtifact.checks.find((check) => check.id === 'view_source_diversity')?.satisfied,
      true,
      'generated-view-hints source-request response must satisfy view source diversity check'
    );
    assertEqual(uploadManifestTemplate.template_only, true, 'generated-view-hints manifest template must stay template-only');
    assertEqual(uploadManifestTemplate.view_source_requirements?.blocker, 'view_sources_not_distinct', 'generated-view-hints manifest template must carry distinct view-source blocker');
    assertIncludes(uploadManifestTemplate.views.map((view) => view.kind), 'front', 'generated-view-hints manifest template should include front placeholder');
    assertEqual(releaseChecklist.kind, 'real_world_building_positive_release_checklist', 'generated-view-hints release checklist should use stable kind');
    assertIncludes(
      releaseChecklist.checks.filter((check) => check.required).map((check) => check.id),
      'vision_evidence_review',
      'generated-view-hints release checklist must carry required VisionEvidence review check'
    );
    const hintedViews = Array.from(new Set(generatedHints.views.map((view) => view.kind))).sort();
    for (const view of ['front', 'left', 'oblique', 'top']) {
      assertIncludes(hintedViews, view, `generated view hints must include ${view}`);
    }
    return {
      status: 'ready_for_review_work',
      artifacts: {
        source_dir: path.join(outputDir, 'upload-session-auto-view-hints', 'source'),
        upload_manifest: path.join(outputDir, 'upload-session-auto-view-hints', 'source', 'manifest.json'),
        upload_manifest_schema: REAL_WORLD_BUILDING_UPLOAD_MANIFEST_SCHEMA,
        ...summary.artifacts,
        release_artifact_workspace: releaseArtifactWorkspaceResult.output,
        release_artifact_workspace_markdown: releaseArtifactWorkspaceResult.markdownOutput,
        release_artifact_workspace_validation: releaseArtifactWorkspaceValidation.output,
        release_artifact_workspace_validation_markdown: releaseArtifactWorkspaceValidation.markdownOutput
      },
      metrics: {
        upload_manifest_contract: uploadManifest.kind,
        session_ok: summary.ok,
        session_status: summary.status,
        preflight_release_source_candidate: summary.preflight.release_source_candidate,
        preflight_metadata_statuses: summary.preflight.metadata_files.map((record) => record.status),
        preflight_view_source_diversity_status: summary.preflight.view_source_diversity?.status || null,
        source_package_gate_ok: summary.gates.source_package_gate_ok,
        source_package_gate_result: summary.artifacts.source_package_gate_result,
        source_package_summary_failed_requirements: summary.intake?.source_package?.failed_requirements || [],
        source_package_view_evidence: summary.intake?.source_package?.view_evidence || [],
        source_package_semantic_role_evidence: summary.intake?.source_package?.semantic_role_evidence || [],
        source_package_semantic_evidence_quality: summary.intake?.source_package?.semantic_evidence_quality || null,
        source_package_summary_release_checklist_blockers: summary.intake?.source_package?.release_checklist_blockers || [],
        workflow_stage: summary.workflow.stage,
        workflow_required_user_inputs: summary.workflow.required_user_inputs,
        handoff_status: summary.handoff.status,
        handoff_primary_action: summary.handoff.primary_action.kind,
        handoff_primary_action_artifact_exists: uploadSessionHandoff.primary_action.artifact_exists,
        handoff_semantic_evidence_quality: uploadSessionHandoff.semantic_evidence_quality || null,
        handoff_vision_evidence_available: uploadSessionHandoff.vision_evidence?.available === true,
        handoff_vision_evidence_instance_roles: Array.from(new Set((uploadSessionHandoff.vision_evidence?.semantic_evidence_instances || []).map((instance) => instance.role))).sort(),
        handoff_vision_evidence_modeling_handoff_roles: Array.from(new Set((uploadSessionHandoff.vision_evidence?.modeling_handoff || []).map((item) => item.role))).sort(),
        handoff_vision_evidence_modeling_handoff_blocked_interpretations: Array.from(new Set((uploadSessionHandoff.vision_evidence?.modeling_handoff || []).flatMap((item) => item.blocked_interpretations || []))).sort(),
        handoff_release_checklist_required_check_ids: uploadSessionHandoff.release_checklist_required_check_ids || [],
        handoff_release_checklist_failed_required_check_ids: uploadSessionHandoff.release_checklist_failed_required_check_ids || [],
        handoff_release_work_order_exists: uploadSessionHandoff.authoritative_artifacts.some((artifact) => artifact.role === 'release_work_order' && artifact.exists === true),
        handoff_upload_session_handoff_exists: uploadSessionHandoff.authoritative_artifacts.some((artifact) => artifact.role === 'upload_session_handoff' && artifact.exists === true),
        handoff_missing_required_artifact_roles: uploadSessionHandoff.authoritative_artifacts.filter((artifact) => artifact.required && artifact.exists !== true).map((artifact) => artifact.role),
        handoff_artifact: summary.artifacts.upload_session_handoff,
        view_hint_sources: Array.from(new Set(preflightReport.view_package.sources.map((source) => source.source))).sort(),
        scale_hint_sources: preflightReport.scale_package.sources,
        scale_strategy: observations.scale_calibration.strategy,
        generated_view_hints: summary.artifacts.view_hints,
        source_request_artifact: summary.artifacts.source_request,
        source_request_response_artifact: summary.artifacts.source_request_response,
        vision_evidence_review_items: summary.vision_evidence?.review_items || 0,
        vision_evidence_semantic_candidate_review_items: summary.vision_evidence?.semantic_candidate_review_items || 0,
        vision_evidence_review_patch: summary.artifacts.vision_evidence_review_patch,
        vision_evidence_review_workbench: summary.artifacts.vision_evidence_review_workbench,
        mcp_vision_evidence_available: mcpBrief.evidence_summary.vision_evidence?.available === true,
        mcp_vision_evidence_semantic_roles: mcpBrief.evidence_summary.vision_evidence?.semantic_review_roles || [],
        mcp_vision_evidence_instance_roles: Array.from(new Set((mcpBrief.evidence_summary.vision_evidence?.semantic_evidence_instances || []).map((instance) => instance.role))).sort(),
        mcp_vision_evidence_modeling_handoff_roles: Array.from(new Set((mcpBrief.evidence_summary.vision_evidence?.modeling_handoff || []).map((item) => item.role))).sort(),
        mcp_vision_evidence_modeling_handoff_blocked_interpretations: Array.from(new Set((mcpBrief.evidence_summary.vision_evidence?.modeling_handoff || []).flatMap((item) => item.blocked_interpretations || []))).sort(),
        upload_manifest_template: summary.artifacts.upload_manifest_template,
        source_request_status: sourceRequestArtifact.status,
        source_request_semantic_evidence_quality: sourceRequestArtifact.semantic_evidence_quality || null,
        source_request_view_source_blocker: sourceRequestArtifact.view_source_requirements?.blocker || null,
        source_request_upload_manifest_required: sourceRequestArtifact.upload_package_requirements?.manifest_required === true,
        source_request_missing_required_views: sourceRequestArtifact.upload_package_requirements?.missing_required_views || [],
        source_request_next_upload_response_check_ids: sourceRequestArtifact.upload_package_requirements?.next_upload_response_check_ids || [],
        source_request_response_status: sourceRequestResponseArtifact.status,
        source_request_response_ok: summary.gates.source_request_response_ok,
        source_request_response_view_source_diversity_ok: sourceRequestResponseArtifact.checks.find((check) => check.id === 'view_source_diversity')?.satisfied === true,
        source_request_response_expected_check_ids: sourceRequestResponseArtifact.summary.expected_check_ids || [],
        source_request_response_missing_expected_check_ids: sourceRequestResponseArtifact.summary.missing_expected_check_ids || [],
        source_request_response_unsatisfied_check_ids: sourceRequestResponseArtifact.summary.unsatisfied_check_ids || [],
        source_request_response_view_evidence: sourceRequestResponseArtifact.summary.view_evidence || null,
        source_request_response_semantic_evidence: sourceRequestResponseArtifact.summary.semantic_evidence || null,
        mcp_source_request_response_gate_status: mcpBrief.source_request_response_gate?.status || null,
        mcp_source_request_response_expected_check_ids: mcpBrief.source_request_response_gate?.expected_check_ids || [],
        mcp_source_request_response_missing_expected_check_ids: mcpBrief.source_request_response_gate?.missing_expected_check_ids || [],
        mcp_source_request_response_unsatisfied_check_ids: mcpBrief.source_request_response_gate?.unsatisfied_check_ids || [],
        mcp_source_request_response_view_evidence: mcpBrief.source_request_response_gate?.view_evidence || null,
        mcp_source_request_response_semantic_evidence: mcpBrief.source_request_response_gate?.semantic_evidence || null,
        mcp_source_package_semantic_role_evidence: mcpBrief.source_package_gate?.semantic_role_evidence || [],
        mcp_source_package_semantic_evidence_quality: mcpBrief.source_package_gate?.semantic_evidence_quality || null,
        mcp_source_package_view_evidence: mcpBrief.source_package_gate?.view_evidence || [],
        mcp_release_checklist_required_check_ids: mcpBrief.source_package_gate?.release_checklist_required_check_ids || [],
        mcp_release_checklist_failed_required_check_ids: mcpBrief.source_package_gate?.release_checklist_failed_required_check_ids || [],
        mcp_agent_contract_release_checklist_failed_required_check_ids: mcpBrief.agent_contract.output_policy.release_checklist_failed_required_check_ids || [],
        upload_manifest_template_view_source_blocker: uploadManifestTemplate.view_source_requirements?.blocker || null,
        hinted_views: hintedViews,
        missing_inputs: summary.intake?.missing_inputs || [],
        input_ready_for_release_work: summary.intake?.input_ready_for_release_work === true,
        release_ready: summary.intake?.release_ready === true,
        release_draft_status: summary.real_world_building_release_draft?.validation_status || null,
        release_draft_blockers: summary.real_world_building_release_draft?.blockers || [],
        release_draft_check_statuses: Object.fromEntries((summary.real_world_building_release_draft?.checklist_checks || []).map((check) => [check.id, check.status])),
        release_draft_required_check_ids: summary.real_world_building_release_draft?.checklist_required_check_ids || [],
        release_draft_failed_required_check_ids: summary.real_world_building_release_draft?.checklist_failed_required_check_ids || [],
        release_checklist_required_check_ids: releaseChecklist.checks.filter((check) => check.required).map((check) => check.id).sort(),
        release_draft_ready: summary.real_world_building_release_draft?.release_ready === true,
        release_draft_promotable: summary.real_world_building_release_draft?.can_promote_to_release_manifest === true,
        release_work_order_status: summary.real_world_building_release_draft?.work_order_status || null,
        release_work_order_blocked_required_tasks: summary.real_world_building_release_draft?.work_order_blocked_required_tasks ?? null,
        release_work_order_artifact: summary.artifacts.real_world_building_release_work_order,
        release_work_order_direct_sketchup_dsl_allowed: releaseWorkOrder.artifact_authoring_policy?.direct_sketchup_dsl_allowed === true,
        release_work_order_required_contract_artifacts: releaseWorkOrder.artifact_authoring_policy?.required_contract_artifacts || [],
        release_work_order_vision_review_artifact_roles: (releaseWorkOrder.tasks.find((task) => task.id === 'vision_evidence_review')?.artifacts || []).map((artifact) => artifact.role).sort(),
        release_work_order_vision_review_command: releaseWorkOrder.tasks.find((task) => task.id === 'vision_evidence_review')?.command || null,
        workflow_prepare_vision_evidence_review_workbench_command: summary.workflow.commands.prepare_vision_evidence_review_workbench,
        workflow_build_vision_evidence_policy_correction_patch_command: summary.workflow.commands.build_vision_evidence_policy_correction_patch,
        release_artifact_workspace_status: releaseArtifactWorkspaceResult.status,
        release_artifact_workspace: releaseArtifactWorkspaceResult.output,
        release_artifact_workspace_required_roles: releaseArtifactWorkspaceResult.workspace.required_artifacts.map((artifact) => artifact.role),
        release_artifact_workspace_missing_roles: releaseArtifactWorkspaceResult.workspace.required_artifacts.filter((artifact) => artifact.status !== 'present').map((artifact) => artifact.role),
        release_artifact_workspace_task_packet_count: releaseArtifactWorkspaceResult.workspace.task_packets.length,
        release_artifact_workspace_task_packet_statuses: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.map((packet) => packet.status))).sort(),
        release_artifact_workspace_task_packet_acceptance_ids: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.flatMap((packet) => packet.acceptance_criteria.map((criterion) => criterion.id)))).sort(),
        release_artifact_workspace_task_packet_blocked_outputs: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.flatMap((packet) => packet.mcp_constraints.blocked_outputs))).sort(),
        release_artifact_workspace_task_packet_failed_required_check_ids: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.flatMap((packet) => packet.mcp_constraints.release_checklist_failed_required_check_ids || []))).sort(),
        release_artifact_workspace_task_packet_semantic_quality_statuses: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.map((packet) => packet.mcp_constraints.semantic_evidence_quality?.status || 'missing'))).sort(),
        release_artifact_workspace_task_packet_semantic_geometry_allowed: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.map((packet) => packet.mcp_constraints.semantic_evidence_quality?.geometry_promotion_allowed === true))).sort(),
        release_artifact_workspace_task_packet_mcp_authoring_handoff_count: releaseArtifactWorkspaceResult.workspace.task_packets.filter((packet) => packet.mcp_authoring_handoff?.kind === 'mcp_authoring_handoff').length,
        release_artifact_workspace_task_packet_mcp_authoring_handoff_prompt_has_vision_evidence: releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff?.prompt_text?.includes('VisionEvidence')),
        release_artifact_workspace_task_packet_mcp_authoring_handoff_prompt_has_workbench: releaseArtifactWorkspaceResult.workspace.task_packets.every((packet) => packet.mcp_authoring_handoff?.prompt_text?.includes('VisionEvidence review workbench')),
        release_artifact_workspace_task_packet_mcp_authoring_handoff_review_workbenches: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.map((packet) => packet.mcp_authoring_handoff?.evidence_digest?.vision_evidence_review_workbench).filter(Boolean))).sort(),
        release_artifact_workspace_task_packet_mcp_authoring_handoff_blocked_interpretations: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.flatMap((packet) => packet.mcp_authoring_handoff?.evidence_digest?.blocked_interpretations || []))).sort(),
        release_artifact_workspace_vision_evidence_instance_roles: Array.from(new Set((releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.vision_evidence?.semantic_evidence_instances || []).map((instance) => instance.role))).sort(),
        release_artifact_workspace_task_packet_vision_evidence_instance_roles: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.flatMap((packet) => (packet.mcp_constraints.vision_evidence?.semantic_evidence_instances || []).map((instance) => instance.role)))).sort(),
        release_artifact_workspace_vision_evidence_modeling_handoff_roles: Array.from(new Set((releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.vision_evidence?.modeling_handoff || []).map((item) => item.role))).sort(),
        release_artifact_workspace_vision_evidence_modeling_handoff_blocked_interpretations: Array.from(new Set((releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.vision_evidence?.modeling_handoff || []).flatMap((item) => item.blocked_interpretations || []))).sort(),
        release_artifact_workspace_task_packet_vision_evidence_modeling_handoff_roles: Array.from(new Set(releaseArtifactWorkspaceResult.workspace.task_packets.flatMap((packet) => (packet.mcp_constraints.vision_evidence?.modeling_handoff || []).map((item) => item.role)))).sort(),
        release_artifact_workspace_required_check_ids: releaseArtifactWorkspaceResult.workspace.release_checklist_required_check_ids || [],
        release_artifact_workspace_failed_required_check_ids: releaseArtifactWorkspaceResult.workspace.release_checklist_failed_required_check_ids || [],
        release_artifact_workspace_review_requirement_ids: releaseArtifactWorkspaceResult.workspace.review_requirements.map((requirement) => requirement.id).sort(),
        release_artifact_workspace_vision_review_artifact_roles: (releaseArtifactWorkspaceResult.workspace.review_requirements.find((requirement) => requirement.id === 'vision_evidence_review')?.artifacts || []).map((artifact) => artifact.role).sort(),
        release_artifact_workspace_missing_vision_review_artifact_roles: (releaseArtifactWorkspaceResult.workspace.review_requirements.find((requirement) => requirement.id === 'vision_evidence_review')?.artifacts || []).filter((artifact) => artifact.exists !== true).map((artifact) => artifact.role).sort(),
        release_artifact_workspace_build_vision_evidence_policy_correction_patch_command: releaseArtifactWorkspaceResult.workspace.commands.build_vision_evidence_policy_correction_patch,
        release_artifact_workspace_validation_status: releaseArtifactWorkspaceValidation.status,
        release_artifact_workspace_validation_failed_required_checks: releaseArtifactWorkspaceValidation.report.summary.failed_required_checks,
        release_artifact_workspace_mcp_blocked_outputs: releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.blocked_outputs || [],
        release_artifact_workspace_mcp_failed_required_check_ids: releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.release_checklist_failed_required_check_ids || [],
        release_artifact_workspace_mcp_blocked_interpretations: releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.blocked_interpretations || [],
        release_artifact_workspace_mcp_semantic_evidence_quality: releaseArtifactWorkspaceResult.workspace.mcp_modeling_handoff?.semantic_evidence_quality || null,
        can_generate_sketchup_dsl: summary.gates.can_generate_sketchup_dsl
      }
    };
  });
  cases.push(uploadSessionGeneratedViewHintsCase);

  const multimodalCase = await collectCase('pdf_cad_assetset_fail_closed', async () => {
    const result = await buildStructuredAssetIntake({
      input: MULTIMODAL_FIXTURE_INPUT,
      objectType: 'building_single',
      objectName: 'Release Gate Multimodal Fixture',
      outputDir: path.join(outputDir, 'pdf-cad-fail-closed'),
      writeOverlays: false
    });
    const mediaTypes = Array.from(new Set(result.assetSet.assets.map((asset) => asset.media_type))).sort();
    const applyError = captureError(() => applyCandidatePromotionPatch({
      patch: result.promotionPatch,
      candidateGraph: result.candidateGraph,
      observationSet: result.observationSet,
      profile
    }));
    assertTruthy(mediaTypes.includes('pdf'), 'multimodal fixture must include a PDF asset');
    assertTruthy(mediaTypes.includes('cad'), 'multimodal fixture must include a CAD asset');
    assertEqual(result.assetSet.gates.can_compile_geometry, false, 'PDF/CAD intake must fail closed without extractors');
    assertIncludes(result.assetSet.gates.reasons, 'pdf_extractor_required', 'PDF extractor blocker must be explicit');
    assertIncludes(result.assetSet.gates.reasons, 'cad_extractor_required', 'CAD extractor blocker must be explicit');
    assertEqual(result.modelingBrief.compile_allowed, false, 'PDF/CAD modeling brief must not allow compile');
    assertEqual(result.promotionPatch.status, 'blocked', 'PDF/CAD promotion patch must stay blocked');
    assertEqual(result.promotionPatch.apply_allowed, false, 'PDF/CAD promotion patch must not be applyable');
    assertMatch(applyError?.message || '', /not applyable/, 'blocked PDF/CAD patch must reject application');
    return {
      status: 'blocked',
      artifacts: artifactsFor(path.join(outputDir, 'pdf-cad-fail-closed')),
      metrics: {
        assets: result.assetSet.assets.length,
        media_types: mediaTypes,
        candidates: result.candidateGraph.candidates.length,
        missing_inputs: result.modelingBrief.missing_inputs,
        blockers: result.promotionPatch.blockers,
        apply_error: applyError.message
      }
    };
  });
  cases.push(multimodalCase);

  const documentParserCase = await collectCase('pdf_cad_parser_positive_review_gate', async () => {
    const result = await buildStructuredAssetIntake({
      input: MULTIMODAL_FIXTURE_INPUT,
      objectType: 'building_single',
      objectName: 'Release Gate Parsed Multimodal Fixture',
      outputDir: path.join(outputDir, 'pdf-cad-parser-positive'),
      parseDocuments: true,
      writeOverlays: false
    });
    const mediaTypes = Array.from(new Set(result.assetSet.assets.map((asset) => asset.media_type))).sort();
    const blockers = result.promotionPatch.blockers || [];
    const applyError = captureError(() => applyCandidatePromotionPatch({
      patch: result.promotionPatch,
      candidateGraph: result.candidateGraph,
      observationSet: result.observationSet,
      profile
    }));
    assertTruthy(result.documentParseReport, 'document parser positive case must emit document parse report');
    assertEqual(result.documentParseReport.ok, true, 'document parser positive case must parse CAD geometry');
    assertEqual(result.documentParseReport.summary.cad_outlines, 1, 'document parser must extract one CAD outline');
    assertTruthy(mediaTypes.includes('pdf') && mediaTypes.includes('cad'), 'document parser positive case must include PDF and CAD assets');
    assertEqual(result.assetSet.gates.reasons.includes('pdf_extractor_required'), false, 'parsed PDF must not keep extractor blocker');
    assertEqual(result.assetSet.gates.reasons.includes('cad_extractor_required'), false, 'parsed CAD must not keep extractor blocker');
    assertEqual(result.modelingBrief.compile_allowed, false, 'parsed document brief must not directly allow compile');
    assertTruthy(result.candidateGraph.candidates.some((candidate) => candidate.role === 'building_main_mass'), 'parsed CAD should expose a building mass candidate');
    assertTruthy(result.candidateGraph.candidates.some((candidate) => candidate.role === 'document_scale_anchor'), 'parsed CAD should expose a document scale anchor candidate');
    assertEqual(result.promotionPatch.status, 'blocked', 'parsed document promotion patch must remain blocked until review/views are supplied');
    assertMatch(applyError?.message || '', /not applyable/, 'blocked parsed document patch must reject application');
    return {
      status: 'parsed_review_required',
      artifacts: {
        ...artifactsFor(path.join(outputDir, 'pdf-cad-parser-positive')),
        document_parse_report: path.join(outputDir, 'pdf-cad-parser-positive', 'document-parse-report.json')
      },
      metrics: {
        assets: result.assetSet.assets.length,
        media_types: mediaTypes,
        candidates: result.candidateGraph.candidates.length,
        cad_outlines: result.documentParseReport.summary.cad_outlines,
        width_mm: result.documentParseReport.extracted_geometry?.width_mm,
        depth_mm: result.documentParseReport.extracted_geometry?.depth_mm,
        missing_inputs: result.modelingBrief.missing_inputs,
        blockers,
        apply_error: applyError.message
      },
      context: {
        assetSet: result.assetSet,
        observationSet: result.observationSet,
        candidateGraph: result.candidateGraph,
        modelingBrief: result.modelingBrief,
        promotionReview: result.promotionReview,
        documentParseReport: result.documentParseReport
      }
    };
  });
  cases.push(stripContext(documentParserCase));

  const documentParserMatrixCase = await collectCase('pdf_cad_parser_release_matrix_fixture', async () => {
    const matrixSamples = [
      {
        id: 'positive_pdf_dxf_outline',
        input: MULTIMODAL_FIXTURE_INPUT,
        expectOk: true,
        expectedCadOutlines: 1,
        expectedCadCandidateOutlines: 1,
        expectedPdfPages: 1,
        expectedWidthMm: 9000,
        expectedDepthMm: 12000,
        expectedUnits: 'millimeter_assumed',
        expectedSelectedLayer: 'OUTLINE',
        clearedBlockers: ['pdf_extractor_required', 'cad_extractor_required']
      },
      {
        id: 'multi_page_pdf_dxf_outline',
        input: path.join(MULTIMODAL_PARSER_MATRIX_INPUT, 'multi-page-pdf-dxf'),
        expectOk: true,
        expectedCadOutlines: 1,
        expectedCadCandidateOutlines: 1,
        expectedPdfPages: 2,
        expectedWidthMm: 16000,
        expectedDepthMm: 8000,
        expectedUnits: 'millimeter',
        expectedSelectedLayer: 'A-BUILDING-OUTLINE',
        clearedBlockers: ['pdf_extractor_required', 'cad_extractor_required']
      },
      {
        id: 'dxf_units_meters_positive',
        input: path.join(MULTIMODAL_PARSER_MATRIX_INPUT, 'dxf-units-meters'),
        expectOk: true,
        expectedCadOutlines: 1,
        expectedCadCandidateOutlines: 1,
        expectedPdfPages: 0,
        expectedWidthMm: 9000,
        expectedDepthMm: 12000,
        expectedUnits: 'meter',
        expectedUnitScaleToMm: 1000,
        expectedSelectedLayer: 'A-BUILDING-OUTLINE',
        clearedBlockers: ['cad_extractor_required']
      },
      {
        id: 'dxf_layer_filter_positive',
        input: path.join(MULTIMODAL_PARSER_MATRIX_INPUT, 'dxf-layered-outline'),
        expectOk: true,
        expectedCadOutlines: 1,
        expectedCadCandidateOutlines: 2,
        expectedPdfPages: 0,
        expectedWidthMm: 9000,
        expectedDepthMm: 12000,
        expectedUnits: 'millimeter',
        expectedSelectedLayer: 'A-BUILDING-OUTLINE',
        clearedBlockers: ['cad_extractor_required']
      },
      {
        id: 'dxf_multiple_outline_positive',
        input: path.join(MULTIMODAL_PARSER_MATRIX_INPUT, 'dxf-multiple-outline'),
        expectOk: true,
        expectedCadOutlines: 1,
        expectedCadCandidateOutlines: 2,
        expectedPdfPages: 0,
        expectedWidthMm: 12000,
        expectedDepthMm: 10000,
        expectedUnits: 'millimeter',
        expectedSelectedLayer: 'A-BUILDING-OUTLINE',
        clearedBlockers: ['cad_extractor_required']
      },
      {
        id: 'malformed_pdf_fail_closed',
        input: path.join(MULTIMODAL_PARSER_MATRIX_INPUT, 'malformed-pdf'),
        expectOk: false,
        expectedCadOutlines: 0,
        requiredBlockers: ['pdf_extractor_required']
      },
      {
        id: 'dxf_without_outline_fail_closed',
        input: path.join(MULTIMODAL_PARSER_MATRIX_INPUT, 'dxf-no-outline'),
        expectOk: false,
        expectedCadOutlines: 0,
        requiredBlockers: ['cad_extractor_required']
      },
      {
        id: 'unsupported_cad_fail_closed',
        input: path.join(MULTIMODAL_PARSER_MATRIX_INPUT, 'unsupported-cad'),
        expectOk: false,
        expectedCadOutlines: 0,
        requiredBlockers: ['cad_extractor_required']
      }
    ];
    const sampleMetrics = [];
    for (const sample of matrixSamples) {
      const result = await buildStructuredAssetIntake({
        input: sample.input,
        objectType: 'building_single',
        objectName: `Release Gate PDF CAD Parser Matrix ${sample.id}`,
        outputDir: path.join(outputDir, 'pdf-cad-parser-matrix', sample.id),
        parseDocuments: true,
        writeOverlays: false
      });
      assertTruthy(result.documentParseReport, `${sample.id} must emit a document parse report`);
      assertEqual(result.documentParseReport.ok, sample.expectOk, `${sample.id} parser ok flag must match expectation`);
      assertEqual(result.documentParseReport.summary.cad_outlines, sample.expectedCadOutlines, `${sample.id} CAD outline count must match expectation`);
      if (sample.expectedCadCandidateOutlines !== undefined) {
        assertEqual(result.documentParseReport.summary.cad_candidate_outlines, sample.expectedCadCandidateOutlines, `${sample.id} candidate outline count must match expectation`);
      }
      if (sample.expectedPdfPages !== undefined) {
        assertEqual(result.documentParseReport.summary.pdf_pages, sample.expectedPdfPages, `${sample.id} PDF page count must match expectation`);
      }
      if (sample.expectedWidthMm !== undefined) {
        assertEqual(result.documentParseReport.extracted_geometry?.width_mm, sample.expectedWidthMm, `${sample.id} extracted width must match expectation`);
      }
      if (sample.expectedDepthMm !== undefined) {
        assertEqual(result.documentParseReport.extracted_geometry?.depth_mm, sample.expectedDepthMm, `${sample.id} extracted depth must match expectation`);
      }
      if (sample.expectedUnits) {
        assertEqual(result.documentParseReport.extracted_geometry?.units, sample.expectedUnits, `${sample.id} extracted units must match expectation`);
      }
      if (sample.expectedUnitScaleToMm !== undefined) {
        assertEqual(result.documentParseReport.extracted_geometry?.unit_scale_to_mm, sample.expectedUnitScaleToMm, `${sample.id} unit scale must match expectation`);
      }
      if (sample.expectedSelectedLayer) {
        assertEqual(result.documentParseReport.extracted_geometry?.layer, sample.expectedSelectedLayer, `${sample.id} selected CAD layer must match expectation`);
      }
      for (const blocker of sample.requiredBlockers || []) {
        assertIncludes(result.assetSet.gates.reasons, blocker, `${sample.id} must keep ${blocker}`);
      }
      for (const blocker of sample.clearedBlockers || []) {
        assertEqual(result.assetSet.gates.reasons.includes(blocker), false, `${sample.id} must clear ${blocker}`);
      }
      assertEqual(result.modelingBrief.compile_allowed, false, `${sample.id} parser matrix sample must not directly allow compile`);
      assertEqual(result.promotionPatch.apply_allowed, false, `${sample.id} parser matrix patch must not be applyable`);
      assertEqual(result.promotionPatch.actions.length, 0, `${sample.id} parser matrix blocked patch must not emit actions`);
      sampleMetrics.push({
        id: sample.id,
        input: sample.input,
        ok: result.documentParseReport.ok,
        status: result.documentParseReport.status,
        parsed_assets: result.documentParseReport.summary.parsed_assets,
        pdf_assets: result.documentParseReport.summary.pdf_assets,
        cad_assets: result.documentParseReport.summary.cad_assets,
        cad_outlines: result.documentParseReport.summary.cad_outlines,
        cad_candidate_outlines: result.documentParseReport.summary.cad_candidate_outlines,
        pdf_pages: result.documentParseReport.summary.pdf_pages,
        width_mm: result.documentParseReport.extracted_geometry?.width_mm || null,
        depth_mm: result.documentParseReport.extracted_geometry?.depth_mm || null,
        units: result.documentParseReport.extracted_geometry?.units || null,
        unit_scale_to_mm: result.documentParseReport.extracted_geometry?.unit_scale_to_mm || null,
        selected_layer: result.documentParseReport.extracted_geometry?.layer || null,
        parser_blockers: result.documentParseReport.blockers,
        asset_gate_reasons: result.assetSet.gates.reasons
      });
    }
    return {
      status: 'parser_release_matrix_guarded',
      artifacts: {
        dir: path.join(outputDir, 'pdf-cad-parser-matrix')
      },
      metrics: {
        sample_count: sampleMetrics.length,
        positive_samples: sampleMetrics.filter((sample) => sample.ok).length,
        fail_closed_samples: sampleMetrics.filter((sample) => !sample.ok).length,
        samples: sampleMetrics
      }
    };
  });
  cases.push(documentParserMatrixCase);

  const documentRoundtripCase = await collectCase('document_review_patch_roundtrip_fixture', async () => {
    if (!documentParserCase.ok) throw new Error('pdf_cad_parser_positive_review_gate must pass before document review roundtrip');
    const ready = makeAcceptedDocumentReviewRoundtrip({
      assetSet: documentParserCase.context.assetSet,
      candidateGraph: documentParserCase.context.candidateGraph,
      modelingBrief: documentParserCase.context.modelingBrief,
      promotionReview: documentParserCase.context.promotionReview,
      observationSet: documentParserCase.context.observationSet,
      documentParseReport: documentParserCase.context.documentParseReport,
      profile
    });
    const patch = buildCandidatePromotionPatch({
      assetSet: ready.assetSet,
      candidateGraph: ready.candidateGraph,
      modelingBrief: ready.modelingBrief,
      promotionReview: ready.promotionReview,
      sourceReview: 'candidate-promotion-review.accepted.document-fixture.json'
    });
    const applied = applyCandidatePromotionPatch({
      patch,
      candidateGraph: ready.candidateGraph,
      observationSet: documentParserCase.context.observationSet,
      profile,
      id: 'release-gate-document-review-roundtrip',
      productName: 'Release Gate Document Review Roundtrip'
    });
    const compileError = captureError(() => compilePartGraphToSketchUpDsl(applied.partGraph, profile, { repoRoot }));
    const roundtripDir = path.join(absoluteOutputDir, 'document-review-roundtrip');
    await fs.mkdir(roundtripDir, { recursive: true });
    await writeJson(path.join(roundtripDir, 'candidate-promotion-review.accepted.document-fixture.json'), ready.promotionReview);
    await writeJson(path.join(roundtripDir, 'candidate-promotion-patch.ready.document-fixture.json'), patch);
    await writeJson(path.join(roundtripDir, 'part-graph.candidate-promoted.document-fixture.json'), applied.partGraph);
    const promotedMainMass = applied.partGraph.parts.find((part) => part.role === 'building_main_mass');
    assertEqual(patch.status, 'ready_for_part_graph_patch', 'accepted document review must build a ready patch');
    assertEqual(patch.apply_allowed, true, 'accepted document review patch must be applyable');
    assertEqual(patch.compile_allowed, false, 'accepted document review patch must not directly allow compile');
    assertEqual(applied.applied.length, ready.selectedCandidates.length, 'document review patch must apply selected candidates');
    assertEqual(applied.partGraph.parts.length, ready.selectedCandidates.length, 'document review roundtrip must only promote selected candidates');
    assertTruthy(promotedMainMass, 'document review roundtrip must promote the CAD building main mass');
    assertEqual(promotedMainMass.evidence_sources?.[0]?.kind, 'candidate_promotion_review', 'promoted document part must keep review evidence provenance');
    assertEqual(promotedMainMass.evidence_sources?.[0]?.status, 'manual_confirmed', 'promoted document part must be manually confirmed');
    assertEqual(promotedMainMass.review_required, true, 'promoted document part must still require PartGraph review');
    assertMatch(compileError?.message || '', /PartGraph compile blocked by geometry gate/, 'document review roundtrip must preserve compiler QA gate');
    return {
      status: 'roundtrip_gate_preserved',
      artifacts: {
        dir: path.join(outputDir, 'document-review-roundtrip'),
        promotion_review: path.join(outputDir, 'document-review-roundtrip', 'candidate-promotion-review.accepted.document-fixture.json'),
        promotion_patch: path.join(outputDir, 'document-review-roundtrip', 'candidate-promotion-patch.ready.document-fixture.json'),
        part_graph: path.join(outputDir, 'document-review-roundtrip', 'part-graph.candidate-promoted.document-fixture.json')
      },
      metrics: {
        accepted_candidates: ready.selectedCandidates.length,
        patch_actions: patch.actions.length,
        promoted_parts: applied.partGraph.parts.length,
        promoted_roles: applied.partGraph.parts.map((part) => part.role),
        source_review: patch.source_review,
        source_candidate_id: ready.selectedCandidates[0].id,
        width_mm: ready.promotionReview.scale_confirmation.known_width,
        depth_mm: ready.promotionReview.scale_confirmation.known_depth,
        compiler_gate_error: compileError.message
      }
    };
  });
  cases.push(documentRoundtripCase);

  const semanticMatrixCase = await collectCase('building_single_semantic_matrix_fixture', async () => {
    const baseSamples = [
      {
        id: 'canonical_oblique_hinted',
        input: CANONICAL_SINGLE_INPUT,
        viewHintsFile: CANONICAL_SINGLE_VIEW_HINTS,
        requiredRoles: [
          'building_main_mass',
          'visible_plane_primary',
          'visible_plane_recessed_left',
          'roof_parapet_and_rail',
          'ground_floor_storefront',
          'upper_window_bands',
          'exterior_hvac_units',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary'
        ]
      },
      {
        id: 'canonical_front_unhinted',
        input: CANONICAL_SINGLE_INPUT,
        viewHintsFile: null,
        requiredRoles: [
          'visible_plane_primary',
          'visible_plane_recessed_left',
          'ground_floor_storefront',
          'upper_window_bands',
          'exterior_hvac_units',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary'
        ]
      },
      {
        id: 'tracked_blueprint_elevation_plan',
        input: TRACKED_BUILDING_SINGLE_BLUEPRINT_INPUT,
        viewHintsFile: null,
        requiredRoles: [
          'visible_plane_primary',
          'visible_plane_recessed_left',
          'upper_window_bands',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary'
        ]
      }
    ];
    const samples = [...baseSamples];
    if (await pathExists(resolveRepo(USER_BUILDING_SINGLE_INPUT))) {
      samples.push({
        id: 'user_two_image_demo',
        input: USER_BUILDING_SINGLE_INPUT,
        viewHintsFile: null,
        requiredRoles: [
          'visible_plane_primary',
          'visible_plane_recessed_left',
          'ground_floor_storefront',
          'upper_window_bands',
          'exterior_hvac_units',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary'
        ]
      });
    }
    const sampleMetrics = [];
    for (const sample of samples) {
      const result = await buildStructuredAssetIntake({
        input: sample.input,
        objectType: 'building_single',
        objectName: `Release Gate Building Single Semantic Matrix ${sample.id}`,
        viewHintsFile: sample.viewHintsFile,
        outputDir: path.join(outputDir, 'building-single-semantic-matrix', sample.id),
        writeOverlays: false
      });
      const roleCounts = countBy(result.candidateGraph.candidates, 'role');
      for (const role of sample.requiredRoles) {
        assertTruthy(roleCounts[role] > 0, `${sample.id} must expose ${role} candidates`);
      }
      for (const role of ['visible_plane_recessed_left', 'rectangular_utility_ducts', 'shadow_or_recess_boundary']) {
        const candidates = result.candidateGraph.candidates.filter((candidate) => candidate.role === role);
        assertTruthy(candidates.length > 0, `${sample.id} must expose ${role}`);
        assertTruthy(
          candidates.every((candidate) => candidate.promotion.status !== 'eligible'),
          `${sample.id} ${role} candidates must not auto-promote`
        );
        assertTruthy(
          candidates.some((candidate) => candidate.promotion.blockers.includes('review_required')),
          `${sample.id} ${role} candidates must stay review-gated`
        );
      }
      assertTruthy(
        result.candidateGraph.candidates.every((candidate) => candidate.promotion.status !== 'eligible'),
        `${sample.id} must not auto-eligible candidates from current image evidence`
      );
      assertEqual(result.modelingBrief.compile_allowed, false, `${sample.id} must not allow direct compile`);
      assertEqual(result.promotionPatch.status, 'blocked', `${sample.id} promotion patch must be blocked`);
      assertEqual(result.promotionPatch.apply_allowed, false, `${sample.id} promotion patch must not be applyable`);
      assertEqual(result.promotionPatch.actions.length, 0, `${sample.id} blocked patch must not emit actions`);
      sampleMetrics.push({
        id: sample.id,
        input: sample.input,
        view_hints_used: sample.viewHintsFile,
        views_detected: result.observationSet.views_detected,
        candidates: result.candidateGraph.candidates.length,
        roles: roleCounts,
        missing_inputs: result.modelingBrief.missing_inputs,
        required_roles: sample.requiredRoles
      });
    }
    return {
      status: 'semantic_matrix_review_required',
      artifacts: {
        dir: path.join(outputDir, 'building-single-semantic-matrix')
      },
      metrics: {
        sample_count: sampleMetrics.length,
        optional_user_demo_included: sampleMetrics.some((sample) => sample.id === 'user_two_image_demo'),
        samples: sampleMetrics
      }
    };
  });
  cases.push(semanticMatrixCase);

  const semanticEvidenceMatrixCase = await collectCase('building_single_semantic_evidence_matrix', async () => {
    const samples = [
      {
        id: 'cropped_annotated_vlm',
        input: CANONICAL_SINGLE_INPUT,
        viewHintsFile: CANONICAL_SINGLE_VIEW_HINTS,
        annotations: CANONICAL_SINGLE_ANNOTATIONS,
        vlmCandidates: CANONICAL_SINGLE_VLM_CANDIDATES,
        expectedSources: ['user_annotation', 'vlm_candidate', 'profile_prior'],
        requiredRoles: [
          'visible_plane_primary',
          'visible_plane_recessed_left',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary',
          'exterior_hvac_units',
          'upper_window_bands',
          'ground_floor_storefront',
          'roof_parapet_and_rail'
        ]
      },
      {
        id: 'raw_screenshot_content_frame',
        input: USER_BUILDING_SINGLE_INPUT,
        viewHintsFile: null,
        annotations: null,
        vlmCandidates: null,
        expectedSources: ['profile_prior'],
        requiredRoles: [
          'visible_plane_recessed_left',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary'
        ]
      },
      {
        id: 'front_unhinted_auto_discovered_annotations',
        input: CANONICAL_SINGLE_INPUT,
        viewHintsFile: null,
        annotations: null,
        vlmCandidates: null,
        expectedSources: ['user_annotation', 'vlm_candidate', 'profile_prior'],
        requiredRoles: [
          'visible_plane_primary',
          'visible_plane_recessed_left',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary'
        ]
      },
      {
        id: 'tracked_blueprint_elevation_profile_prior',
        input: TRACKED_BUILDING_SINGLE_BLUEPRINT_INPUT,
        viewHintsFile: null,
        annotations: null,
        vlmCandidates: null,
        expectedSources: ['profile_prior'],
        requiredRoles: [
          'visible_plane_primary',
          'visible_plane_recessed_left',
          'rectangular_utility_ducts',
          'shadow_or_recess_boundary'
        ]
      }
    ];
    const sampleMetrics = [];
    for (const sample of samples) {
      const result = await buildStructuredAssetIntake({
        input: sample.input,
        objectType: 'building_single',
        objectName: `Release Gate Building Single Semantic Evidence ${sample.id}`,
        viewHintsFile: sample.viewHintsFile,
        buildingSingleAnnotations: sample.annotations,
        buildingSingleVlmCandidates: sample.vlmCandidates,
        outputDir: path.join(outputDir, 'building-single-semantic-evidence-matrix', sample.id),
        writeOverlays: false
      });
      const evidence = result.buildingSingleSemanticEvidence;
      assertTruthy(evidence?.kind === 'building_single_semantic_evidence_v1', `${sample.id} must emit BuildingSingleSemanticEvidence v1`);
      assertEqual(evidence.summary.compile_allowed, false, `${sample.id} semantic evidence must not allow compile`);
      assertEqual(evidence.summary.geometry_promotion_allowed, false, `${sample.id} semantic evidence must not allow geometry promotion`);
      assertTruthy(result.buildingSingleReviewHelperOutput?.model_status === 'review_only', `${sample.id} must emit review-only helper output`);
      assertEqual(result.buildingSingleReviewHelperOutput.compile_allowed, false, `${sample.id} review helper must not compile`);
      assertEqual(result.buildingSingleReviewHelperOutput.geometry_promotion_allowed, false, `${sample.id} review helper must not promote geometry`);
      assertTruthy(
        result.buildingSingleReviewHelperOutput.operations.some((operation) => operation.op === 'semantic_region_overlay'),
        `${sample.id} review helper must include semantic overlays`
      );
      assertEqual(
        result.buildingSingleReviewHelperOutput.operations.some((operation) => ['cut_recess', 'round_pipe_geometry', 'facade_trim'].includes(operation.op)),
        false,
        `${sample.id} review helper must not emit forbidden geometry ops`
      );
      for (const role of sample.requiredRoles) {
        assertTruthy(evidence.summary.roles.includes(role), `${sample.id} semantic evidence must include ${role}`);
        assertTruthy(result.candidateGraph.candidates.some((candidate) => candidate.role === role), `${sample.id} CandidateGraph must include ${role}`);
      }
      for (const source of sample.expectedSources) {
        assertTruthy(evidence.summary.sources.includes(source), `${sample.id} semantic evidence must include source ${source}`);
      }
      const criticalCandidates = result.candidateGraph.candidates.filter((candidate) => REQUIRED_BUILDING_SINGLE_ROLES.includes(candidate.role));
      assertTruthy(criticalCandidates.length >= REQUIRED_BUILDING_SINGLE_ROLES.length, `${sample.id} must expose critical semantic candidates`);
      assertTruthy(
        criticalCandidates.every((candidate) => candidate.promotion.status !== 'eligible'),
        `${sample.id} critical semantic candidates must not be eligible`
      );
      assertTruthy(
        criticalCandidates.some((candidate) => candidate.blocked_interpretations?.includes('merged_front_facade_plane')),
        `${sample.id} must block recessed facade merge interpretation`
      );
      assertTruthy(
        criticalCandidates.some((candidate) => candidate.blocked_interpretations?.includes('round_pipe_geometry')),
        `${sample.id} must block duct round-pipe interpretation`
      );
      assertTruthy(
        criticalCandidates.some((candidate) => candidate.blocked_interpretations?.includes('cut_recess')),
        `${sample.id} must block shadow cut_recess interpretation`
      );
      assertEqual(result.modelingBrief.compile_allowed, false, `${sample.id} modeling brief must remain compile-blocked`);
      assertEqual(result.promotionPatch.apply_allowed, false, `${sample.id} promotion patch must remain blocked`);
      sampleMetrics.push({
        id: sample.id,
        input: sample.input,
        view_hints_used: sample.viewHintsFile,
        semantic_roles: evidence.summary.roles,
        semantic_sources: evidence.summary.sources,
        critical_roles_present: evidence.summary.critical_roles_present,
        selected_regions: evidence.summary.selected_region_count,
        review_helper_model_status: result.buildingSingleReviewHelperOutput.model_status,
        review_helper_operations: result.buildingSingleReviewHelperOutput.operations.length,
        geometry_promotion_allowed: evidence.summary.geometry_promotion_allowed,
        candidate_semantic_sources: Array.from(new Set(result.candidateGraph.candidates.map((candidate) => candidate.semantic_source).filter(Boolean))).sort()
      });
    }
    return {
      status: 'building_single_semantic_evidence_review_only',
      artifacts: {
        dir: path.join(outputDir, 'building-single-semantic-evidence-matrix')
      },
      metrics: {
        sample_count: sampleMetrics.length,
        samples: sampleMetrics
      }
    };
  });
  cases.push(semanticEvidenceMatrixCase);

  const selectedInput = buildingSingleInput || await chooseBuildingSingleInput();
  const useViewHints = selectedInput === CANONICAL_SINGLE_INPUT ? CANONICAL_SINGLE_VIEW_HINTS : null;
  const buildingCase = await collectCase('building_single_blocked_demo', async () => {
    const result = await buildStructuredAssetIntake({
      input: selectedInput,
      objectType: 'building_single',
      objectName: 'Release Gate Building Single Demo',
      viewHintsFile: useViewHints,
      outputDir: path.join(outputDir, 'building-single-blocked'),
      writeOverlays,
      writeRealWorldBuildingReleaseDraft: true,
      releaseDraftReviewer: 'release-gate building-single blocked fixture',
      releaseDraftAcceptedAt: '2026-06-16',
      releaseDraftNotes: 'Blocked release-gate fixture; not a real-world release-positive building sample.',
      requireSourceInputReady: true
    });
    const promotionPatch = buildCandidatePromotionPatch({
      assetSet: result.assetSet,
      candidateGraph: result.candidateGraph,
      modelingBrief: result.modelingBrief,
      promotionReview: result.promotionReview
    });
    await writeJson(path.join(absoluteOutputDir, 'building-single-blocked', 'candidate-promotion-patch.json'), promotionPatch);
    const applyError = captureError(() => applyCandidatePromotionPatch({
      patch: promotionPatch,
      candidateGraph: result.candidateGraph,
      observationSet: result.observationSet,
      profile
    }));
    const roleCounts = countBy(result.candidateGraph.candidates, 'role');
    assertEqual(result.observationSet.object.profile, 'building_single', 'building demo must use building_single profile');
    assertEqual(result.modelingBrief.compile_allowed, false, 'building demo must not compile directly');
    assertEqual(promotionPatch.status, 'blocked', 'building demo promotion patch must be blocked');
    assertEqual(promotionPatch.apply_allowed, false, 'building demo promotion patch must not be applyable');
    assertEqual(promotionPatch.actions.length, 0, 'building demo blocked patch must not emit actions');
    assertMatch(applyError?.message || '', /not applyable/, 'blocked building patch must reject application');
    for (const role of REQUIRED_BUILDING_SINGLE_ROLES) {
      assertTruthy(roleCounts[role] > 0, `building demo must expose ${role} candidates`);
    }
    assertTruthy(
      result.candidateGraph.candidates.every((candidate) => candidate.promotion.status !== 'eligible'),
      'building demo must not auto-eligible candidates from current image evidence'
    );
    assertTruthy(result.realWorldBuildingReleaseDraft, 'building demo must write release draft bundle');
    assertEqual(result.realWorldBuildingReleaseDraft.validation.status, 'manifest_invalid_release_gap_recorded', 'building demo release draft must fail closed with structured summary');
    assertEqual(result.realWorldBuildingReleaseDraft.validation.metrics.closes_release_gap, false, 'building demo release draft must not close release gap');
    assertIncludes(result.realWorldBuildingReleaseDraft.checklist.blockers, 'artifacts', 'building demo release draft must require release artifacts');
    assertIncludes(result.realWorldBuildingReleaseDraft.checklist.blockers, 'photo_grade_readiness', 'building demo release draft must require PhotoGradeReadiness');
    assertEqual(result.realWorldBuildingReleaseDraft.workOrder.status, 'blocked_needs_source_assets', 'building demo release work order must require real source assets first');
    assertIncludes(result.realWorldBuildingReleaseDraft.workOrder.blockers, 'source_assets', 'building demo release work order must expose source asset blocker');
    assertTruthy(result.sourcePackageAssessment, 'building demo must emit a source-package assessment');
    assertEqual(result.sourcePackageAssessment.input_ready_for_release_work, false, 'building demo source package must not be input-ready');
    assertIncludes(result.sourcePackageAssessment.blockers, 'source_assets_generated_or_scaffold', 'building demo source package must reject generated/scaffold sources');
    assertIncludes(result.sourcePackageAssessment.blockers, 'missing_top_view', 'building demo source package must request top/plan evidence');
    assertEqual(result.sourcePackageGateResult.ok, false, 'building demo intake source-package gate must fail require-source-input-ready');
    assertIncludes(
      result.sourcePackageGateResult.failed_requirements,
      'input_ready_for_release_work',
      'building demo intake source-package gate must expose failed input-ready requirement'
    );
    assertTruthy(result.sourcePackageGateOutput, 'building demo intake source-package gate must write gate result artifact');
    assertEqual(result.intakeSummary.ok, false, 'building demo intake summary must reflect failed source-package gate');
    assertEqual(result.intakeSummary.gates.source_package.status, result.sourcePackageAssessment.status, 'building demo intake summary must expose source-package gate status');
    assertEqual(result.intakeSummary.vision_evidence?.review_patch_status, 'needs_review', 'building demo intake summary must expose VisionEvidence review patch status');
    assertTruthy(result.intakeSummary.vision_evidence?.semantic_candidate_review_items >= 3, 'building demo intake summary must expose semantic VisionEvidence review items');
    const sourcePackageCli = await assessRealWorldBuildingSourcePackageCli({
      intakeDir: path.join(outputDir, 'building-single-blocked'),
      output: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.revalidated.json'),
      markdownOutput: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.revalidated.md')
    });
    assertEqual(sourcePackageCli.report.status, result.sourcePackageAssessment.status, 'source-package CLI should reproduce intake source-package status');
    assertEqual(sourcePackageCli.report.input_ready_for_release_work, false, 'source-package CLI must keep blocked demo out of release work');
    assertEqual(sourcePackageCli.ok, true, 'source-package CLI default audit mode should not fail blocked demo revalidation');
    const sourcePackageCliRequireInputReady = await assessRealWorldBuildingSourcePackageCli({
      intakeDir: path.join(outputDir, 'building-single-blocked'),
      output: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.require-input-ready.json'),
      markdownOutput: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.require-input-ready.md'),
      requireInputReady: true
    });
    assertEqual(sourcePackageCliRequireInputReady.ok, false, 'source-package CLI require-input-ready mode must fail blocked demo');
    assertIncludes(
      sourcePackageCliRequireInputReady.failedRequirements,
      'input_ready_for_release_work',
      'source-package CLI require-input-ready mode must expose failed input-ready requirement'
    );
    assertTruthy(sourcePackageCliRequireInputReady.gateOutput, 'source-package CLI require-input-ready mode must write a gate result artifact');
    const releaseDraftDir = path.join(absoluteOutputDir, 'building-single-blocked', 'real-world-building-release');
    const releaseDraftSummary = await readJson(path.join(releaseDraftDir, 'manifest-contract-summary.json'));
    const releaseDraftChecklist = await readJson(path.join(releaseDraftDir, 'release-checklist.json'));
    const releaseWorkOrder = await readJson(path.join(releaseDraftDir, 'release-work-order.json'));
    const releaseWorkOrderMarkdown = await fs.readFile(path.join(releaseDraftDir, 'release-work-order.md'), 'utf8');
    const sourcePackageReport = await readJson(path.join(absoluteOutputDir, 'building-single-blocked', 'real-world-building-source-package.json'));
    const intakeSummary = await readJson(path.join(absoluteOutputDir, 'building-single-blocked', 'intake-summary.json'));
    const visionReviewPatch = await readJson(path.join(absoluteOutputDir, 'building-single-blocked', 'vision-evidence-review-patch.json'));
    const visionReviewWorkbench = await fs.readFile(path.join(absoluteOutputDir, 'building-single-blocked', 'vision-evidence-review', 'index.html'), 'utf8');
    const intakeSourcePackageGateResult = await readJson(path.join(absoluteOutputDir, 'building-single-blocked', 'real-world-building-source-package.gate-result.json'));
    const sourcePackageGateResult = await readJson(resolveRepo(sourcePackageCliRequireInputReady.gateOutput));
    const releaseDraftReviewHtml = await fs.readFile(path.join(absoluteOutputDir, 'building-single-blocked', 'review', 'index.html'), 'utf8');
    assertEqual(releaseDraftSummary.closes_release_gap, false, 'building demo release summary must not close release gap');
    assertEqual(releaseDraftSummary.qa.release_checklist, 'fail', 'building demo release summary must record failed checklist');
    assertEqual(releaseDraftChecklist.release_ready, false, 'building demo release checklist must not be ready');
    assertEqual(releaseWorkOrder.kind, 'real_world_building_release_work_order', 'building demo release work order must use stable kind');
    assertEqual(releaseWorkOrder.status, 'blocked_needs_source_assets', 'building demo release work order must stay source-blocked');
    assertIncludes(releaseWorkOrder.blockers, 'source_assets', 'building demo release work order must preserve source blocker');
    assertTruthy(releaseWorkOrder.tasks.some((task) => task.id === 'source_assets' && task.status === 'blocked'), 'building demo release work order must block source asset task');
    assertTruthy(releaseWorkOrderMarkdown.includes('# Real-World Building Release Work Order'), 'building demo release work order markdown must render a title');
    assertEqual(sourcePackageReport.input_ready_for_release_work, false, 'building demo saved source package must remain blocked');
    assertEqual(intakeSummary.ok, false, 'building demo saved intake summary must preserve failed source-package gate');
    assertEqual(intakeSummary.real_world_building_release_draft?.work_order_status, 'blocked_needs_source_assets', 'building demo saved intake summary must expose release work order status');
    assertEqual(intakeSummary.gates.source_package.status, result.sourcePackageAssessment.status, 'building demo saved intake summary must preserve source-package status');
    assertEqual(intakeSummary.vision_evidence.semantic_candidate_review_items, visionReviewPatch.summary.semantic_candidate_items, 'building demo saved intake summary must mirror VisionEvidence semantic review item count');
    assertIncludes(
      visionReviewPatch.review_items.map((item) => item.id),
      'semantic_candidate:visible_plane_recessed_left',
      'building demo VisionEvidence patch must include recessed side facade item'
    );
    assertIncludes(
      visionReviewPatch.review_items.map((item) => item.id),
      'semantic_candidate:rectangular_utility_ducts',
      'building demo VisionEvidence patch must include rectangular duct item'
    );
    assertIncludes(
      visionReviewPatch.review_items.map((item) => item.id),
      'semantic_candidate:shadow_or_recess_boundary',
      'building demo VisionEvidence patch must include shadow/recess boundary item'
    );
    assertSemanticReviewItemHasEvidenceInstance(
      visionReviewPatch,
      'visible_plane_recessed_left',
      'building demo VisionEvidence patch must locate recessed visible plane evidence'
    );
    assertSemanticReviewItemHasEvidenceInstance(
      visionReviewPatch,
      'rectangular_utility_ducts',
      'building demo VisionEvidence patch must locate rectangular duct evidence'
    );
    assertSemanticReviewItemHasEvidenceInstance(
      visionReviewPatch,
      'shadow_or_recess_boundary',
      'building demo VisionEvidence patch must locate shadow/recess evidence'
    );
    assertTruthy(visionReviewWorkbench.includes('vision-evidence-review-decision-json'), 'building demo VisionEvidence workbench must expose decision export textarea');
    assertEqual(intakeSourcePackageGateResult.ok, false, 'building demo saved intake source-package gate result must fail');
    assertIncludes(intakeSourcePackageGateResult.failed_requirements, 'input_ready_for_release_work', 'building demo saved intake gate result must preserve input-ready failure');
    assertEqual(sourcePackageGateResult.kind, 'real_world_building_source_package_gate_result', 'building demo require-input-ready gate result must use stable kind');
    assertEqual(sourcePackageGateResult.ok, false, 'building demo require-input-ready gate result must be failed');
    assertIncludes(sourcePackageGateResult.failed_requirements, 'input_ready_for_release_work', 'building demo gate result must expose input-ready failure');
    assertTruthy(releaseDraftReviewHtml.includes('download-real-world-building-source-package'), 'building demo review must link source-package report');
    assertTruthy(releaseDraftReviewHtml.includes('real-world-building-source-package-data'), 'building demo review must embed source-package JSON');
    assertTruthy(releaseDraftReviewHtml.includes('download-real-world-building-source-request'), 'building demo review must link source-request report');
    assertTruthy(releaseDraftReviewHtml.includes('download-real-world-building-upload-manifest-template'), 'building demo review must link upload manifest template');
    assertTruthy(releaseDraftReviewHtml.includes('real-world-building-source-request-data'), 'building demo review must embed source-request JSON');
    assertTruthy(releaseDraftReviewHtml.includes('download-real-world-building-contract-summary'), 'building demo review must link release summary');
    assertTruthy(releaseDraftReviewHtml.includes('real-world-building-release-summary-data'), 'building demo review must embed release summary JSON');
    assertTruthy(releaseDraftReviewHtml.includes('real-world-building-release-checklist-data'), 'building demo review must embed release checklist JSON');
    assertTruthy(releaseDraftReviewHtml.includes('download-real-world-building-release-work-order'), 'building demo review must link release work order JSON');
    assertTruthy(releaseDraftReviewHtml.includes('real-world-building-release-work-order-data'), 'building demo review must embed release work order JSON');
    assertTruthy(releaseDraftReviewHtml.includes('download-vision-evidence-report'), 'building demo review must link VisionEvidence report');
    assertTruthy(releaseDraftReviewHtml.includes('open-vision-evidence-review-workbench'), 'building demo review must link VisionEvidence review workbench');
    assertTruthy(releaseDraftReviewHtml.includes('vision-evidence-review-patch-data'), 'building demo review must embed VisionEvidence review patch JSON');
    assertTruthy(releaseDraftReviewHtml.includes('<code>artifacts</code>'), 'building demo review must show release artifact check row');
    assertTruthy(releaseDraftReviewHtml.includes('exists=false'), 'building demo review must show missing release artifact item state');
    return {
      status: 'blocked',
      artifacts: {
        ...artifactsFor(path.join(outputDir, 'building-single-blocked')),
        source_package_intake_gate_result: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.gate-result.json'),
        source_request: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-request.json'),
        source_request_markdown: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-request.md'),
        upload_manifest_template: path.join(outputDir, 'building-single-blocked', 'upload-manifest.template.json'),
        source_package_revalidated: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.revalidated.json'),
        source_package_revalidated_markdown: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.revalidated.md'),
        source_package_require_input_ready: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.require-input-ready.json'),
        source_package_require_input_ready_markdown: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.require-input-ready.md'),
        source_package_require_input_ready_gate_result: sourcePackageCliRequireInputReady.gateOutput,
        vision_evidence_report: path.join(outputDir, 'building-single-blocked', 'vision-evidence-v1-report.json'),
        vision_evidence_review_patch: path.join(outputDir, 'building-single-blocked', 'vision-evidence-review-patch.json'),
        vision_evidence_review_patch_markdown: path.join(outputDir, 'building-single-blocked', 'vision-evidence-review-patch.md'),
        vision_evidence_review_workbench: path.join(outputDir, 'building-single-blocked', 'vision-evidence-review', 'index.html'),
        release_work_order: path.join(outputDir, 'building-single-blocked', 'real-world-building-release', 'release-work-order.json'),
        release_work_order_markdown: path.join(outputDir, 'building-single-blocked', 'real-world-building-release', 'release-work-order.md')
      },
      metrics: {
        input: selectedInput,
        view_hints_used: useViewHints || null,
        assets: result.assetSet.assets.length,
        candidates: result.candidateGraph.candidates.length,
        roles: roleCounts,
        missing_inputs: result.modelingBrief.missing_inputs,
        blockers: promotionPatch.blockers,
        apply_error: applyError.message,
        release_draft_bundle: true,
        release_draft_status: result.realWorldBuildingReleaseDraft.validation.status,
        release_draft_ready: result.realWorldBuildingReleaseDraft.checklist.release_ready,
        release_draft_blockers: result.realWorldBuildingReleaseDraft.checklist.blockers,
        release_work_order_status: result.realWorldBuildingReleaseDraft.workOrder.status,
        release_work_order_blocked_required_tasks: result.realWorldBuildingReleaseDraft.workOrder.blocked_required_task_count,
        intake_summary_ok: result.intakeSummary.ok,
        source_package_status: result.sourcePackageAssessment.status,
        input_ready_for_release_work: result.sourcePackageAssessment.input_ready_for_release_work,
        source_package_blockers: result.sourcePackageAssessment.blockers,
        source_package_intake_gate_ok: result.sourcePackageGateResult.ok,
        source_package_intake_gate_failed: result.sourcePackageGateResult.failed_requirements,
        source_package_cli_revalidated: true,
        source_package_require_input_ready_ok: sourcePackageCliRequireInputReady.ok,
        source_package_require_input_ready_failed: sourcePackageCliRequireInputReady.failedRequirements,
        source_package_require_input_ready_gate_result: true,
        vision_evidence_review_items: visionReviewPatch.summary.total_items,
        vision_evidence_semantic_candidate_review_items: visionReviewPatch.summary.semantic_candidate_items,
        vision_evidence_review_ids: visionReviewPatch.review_items.map((item) => item.id),
        release_draft_review_links: true,
        release_draft_review_checks: true
      },
      context: {
        assetSet: result.assetSet,
        observationSet: result.observationSet,
        candidateGraph: result.candidateGraph,
        modelingBrief: result.modelingBrief,
        promotionReview: result.promotionReview,
        sourcePackageAssessment: result.sourcePackageAssessment
      }
    };
  });
  cases.push(stripContext(buildingCase));

  const mcpBriefCase = await collectCase('mcp_modeling_brief_export_fixture', async () => {
    if (!buildingCase.ok) throw new Error('building_single_blocked_demo must pass before MCP modeling brief export');
    const brief = buildMcpModelingBrief({
      assetSet: buildingCase.context.assetSet,
      observationSet: buildingCase.context.observationSet,
      candidateGraph: buildingCase.context.candidateGraph,
      modelingBrief: buildingCase.context.modelingBrief,
      promotionReview: buildingCase.context.promotionReview,
      sourcePackageAssessment: buildingCase.context.sourcePackageAssessment,
      source: {
        asset_set: path.join(outputDir, 'building-single-blocked', 'asset-set.json'),
        observation_set: path.join(outputDir, 'building-single-blocked', 'observations.json'),
        candidate_graph: path.join(outputDir, 'building-single-blocked', 'candidate-graph.json'),
        modeling_brief: path.join(outputDir, 'building-single-blocked', 'modeling-brief.json'),
        source_package: path.join(outputDir, 'building-single-blocked', 'real-world-building-source-package.json'),
        promotion_review: path.join(outputDir, 'building-single-blocked', 'candidate-promotion-review.draft.json'),
        vision_evidence_report: path.join(outputDir, 'building-single-blocked', 'vision-evidence-v1-report.json'),
        vision_evidence_review_patch: path.join(outputDir, 'building-single-blocked', 'vision-evidence-review-patch.json'),
        vision_evidence_review_workbench: path.join(outputDir, 'building-single-blocked', 'vision-evidence-review', 'index.html')
      }
    });
    const intakeBrief = await readJson(path.join(absoluteOutputDir, 'building-single-blocked', 'mcp-modeling-brief.json'));
    const intakeBriefMarkdown = await fs.readFile(path.join(absoluteOutputDir, 'building-single-blocked', 'mcp-modeling-brief.md'), 'utf8');
    const intakeReviewHtml = await fs.readFile(path.join(absoluteOutputDir, 'building-single-blocked', 'review', 'index.html'), 'utf8');
    const markdown = renderMcpModelingBriefMarkdown(brief);
    const briefDir = path.join(absoluteOutputDir, 'mcp-modeling-brief-export');
    await fs.mkdir(briefDir, { recursive: true });
    await writeJson(path.join(briefDir, 'mcp-modeling-brief.json'), brief);
    await fs.writeFile(path.join(briefDir, 'mcp-modeling-brief.md'), markdown, 'utf8');
    assertEqual(brief.compile_permission.can_generate_sketchup_dsl, false, 'blocked MCP brief must forbid direct SketchUp DSL generation');
    assertIncludes(brief.compile_permission.reasons, 'scale_confidence_below_publish_gate', 'MCP brief must expose scale blocker');
    assertEqual(brief.source_package_gate?.status, buildingCase.context.sourcePackageAssessment.status, 'MCP brief must carry source-package gate status');
    assertEqual(brief.source_package_gate?.input_ready_for_release_work, false, 'MCP brief must keep blocked source-package readiness visible');
    assertIncludes(brief.source_package_gate?.blockers || [], 'source_assets_generated_or_scaffold', 'MCP brief must expose source-package source blocker');
    assertIncludes(brief.source_package_gate?.release_checklist_required_check_ids || [], 'vision_evidence_review', 'MCP brief must expose required release checklist id');
    assertIncludes(brief.source_package_gate?.release_checklist_failed_required_check_ids || [], 'photo_grade_readiness', 'MCP brief must expose failed required release checklist id');
    assertEqual(brief.agent_contract.output_policy.sketchup_dsl_allowed, false, 'MCP agent contract must forbid SketchUp DSL for blocked input');
    assertIncludes(brief.agent_contract.output_policy.blocked_outputs, 'direct_sketchup_dsl', 'MCP agent contract must list direct DSL as blocked output');
    assertIncludes(brief.agent_contract.output_policy.release_checklist_failed_required_check_ids || [], 'vision_evidence_review', 'MCP agent contract must expose failed required release checklist id');
    assertTruthy(brief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'source_package'), 'MCP agent contract must name source-package artifact');
    assertTruthy(brief.agent_contract.authoritative_artifacts.some((artifact) => artifact.role === 'vision_evidence_review_patch'), 'MCP agent contract must name VisionEvidence review patch artifact');
    assertEqual(brief.evidence_summary.vision_evidence?.available, true, 'MCP brief must expose VisionEvidence availability');
    assertIncludes(
      brief.evidence_summary.vision_evidence?.semantic_review_roles || [],
      'rectangular_utility_ducts',
      'MCP brief must expose duct role in VisionEvidence summary'
    );
    assertVisionEvidenceWorkspaceInstance(
      brief.evidence_summary.vision_evidence,
      'rectangular_utility_ducts',
      'MCP brief must expose duct VisionEvidence semantic instance'
    );
    assertTruthy(
      hasVisionEvidenceModelingHandoff(brief.evidence_summary.vision_evidence, 'rectangular_utility_ducts', 'decorative_facade_trim'),
      'MCP brief must expose duct VisionEvidence modeling handoff'
    );
    assertTruthy(brief.agent_contract.evidence_rules.some((rule) => rule.includes('review candidates')), 'MCP agent contract must explain candidate evidence boundary');
    assertEqual(brief.source_package_gate?.source_request?.status, 'needs_source_replacement', 'MCP brief must carry source request status');
    assertIncludes(
      brief.source_package_gate?.source_request?.blocked_until_satisfied || [],
      'direct_sketchup_dsl',
      'MCP brief source request must block direct DSL'
    );
    assertTruthy(brief.candidate_summary.candidate_count >= 10, 'MCP brief must carry candidate evidence');
    assertTruthy(brief.candidate_groups.some((group) => group.role === 'visible_plane_recessed_left'), 'MCP brief must preserve recessed facade role');
    assertTruthy(brief.candidate_groups.some((group) => group.role === 'rectangular_utility_ducts'), 'MCP brief must preserve utility duct role');
    const disambiguationByRole = new Map(brief.candidate_disambiguation.map((item) => [item.role, item]));
    assertIncludes(disambiguationByRole.get('visible_plane_recessed_left')?.blocked_interpretations || [], 'merged_front_facade_plane', 'MCP brief disambiguation must block merging recessed facade into front facade');
    assertIncludes(disambiguationByRole.get('rectangular_utility_ducts')?.blocked_interpretations || [], 'decorative_facade_trim', 'MCP brief disambiguation must block treating ducts as trim');
    assertIncludes(disambiguationByRole.get('shadow_or_recess_boundary')?.blocked_interpretations || [], 'cut_recess_from_shadow_only', 'MCP brief disambiguation must block shadow-only recess cuts');
    assertEqual(brief.modeling_constraint_summary.status, 'review_or_input_blocked', 'MCP brief modeling constraint summary must remain fail-closed');
    const modelingConstraintByRole = new Map(brief.modeling_constraint_summary.constraints.map((item) => [item.role, item]));
    assertIncludes(brief.modeling_constraint_summary.critical_roles, 'visible_plane_recessed_left', 'MCP brief constraints must prioritize recessed facade role');
    assertIncludes(brief.modeling_constraint_summary.critical_roles, 'rectangular_utility_ducts', 'MCP brief constraints must prioritize duct role');
    assertIncludes(brief.modeling_constraint_summary.critical_roles, 'shadow_or_recess_boundary', 'MCP brief constraints must prioritize shadow/recess role');
    assertIncludes(modelingConstraintByRole.get('visible_plane_recessed_left')?.blocked_interpretations || [], 'merged_front_facade_plane', 'MCP brief constraints must block merging recessed facade into front facade');
    assertIncludes(modelingConstraintByRole.get('rectangular_utility_ducts')?.blocked_interpretations || [], 'decorative_facade_trim', 'MCP brief constraints must block treating ducts as trim');
    assertIncludes(modelingConstraintByRole.get('shadow_or_recess_boundary')?.blocked_interpretations || [], 'cut_recess_from_shadow_only', 'MCP brief constraints must block shadow-only recess cuts');
    const riskIds = brief.grounding_risk_register.map((risk) => risk.id);
    assertIncludes(riskIds, 'direct_sketchup_dsl_blocked', 'MCP brief risk register must block direct DSL');
    assertIncludes(riskIds, 'source_assets_generated_or_scaffold', 'MCP brief risk register must expose source authenticity blocker');
    assertIncludes(riskIds, 'missing_view_top', 'MCP brief risk register must expose missing top view');
    assertIncludes(riskIds, 'scale_confidence_below_publish_gate', 'MCP brief risk register must expose scale blocker');
    assertIncludes(riskIds, 'visible_plane_recessed_left_requires_separate_plane_review', 'MCP brief risk register must preserve recessed facade risk');
    assertIncludes(riskIds, 'rectangular_utility_ducts_require_duct_semantics_review', 'MCP brief risk register must preserve duct semantics risk');
    assertIncludes(riskIds, 'shadow_recess_boundary_ambiguity', 'MCP brief risk register must preserve shadow/recess ambiguity');
    assertTruthy(markdown.includes('Do not generate SketchUp DSL directly'), 'MCP brief markdown must state direct-DSL prohibition');
    assertTruthy(markdown.includes('## Agent Contract'), 'MCP brief markdown must expose agent contract');
    assertTruthy(markdown.includes('## Candidate Disambiguation'), 'MCP brief markdown must expose candidate disambiguation');
    assertTruthy(markdown.includes('## Modeling Constraint Summary'), 'MCP brief markdown must expose modeling constraint summary');
    assertTruthy(markdown.includes('## Grounding Risk Register'), 'MCP brief markdown must expose grounding risk register');
    assertTruthy(markdown.includes('merged_front_facade_plane'), 'MCP brief markdown must expose recessed facade blocked interpretation');
    assertTruthy(markdown.includes('decorative_facade_trim'), 'MCP brief markdown must expose duct blocked interpretation');
    assertTruthy(markdown.includes('cut_recess_from_shadow_only'), 'MCP brief markdown must expose shadow blocked interpretation');
    assertTruthy(markdown.includes('shadow_recess_boundary_ambiguity'), 'MCP brief markdown must expose shadow/recess risk id');
    assertTruthy(markdown.includes('direct_sketchup_dsl'), 'MCP brief markdown must expose blocked output token');
    assertTruthy(markdown.includes('## Source Package Gate'), 'MCP brief markdown must expose source-package gate section');
    assertTruthy(markdown.includes('### VisionEvidence Semantic Instances'), 'MCP brief markdown must expose VisionEvidence semantic instances');
    assertTruthy(markdown.includes('### VisionEvidence Modeling Handoff'), 'MCP brief markdown must expose VisionEvidence modeling handoff');
    assertTruthy(markdown.includes('source_assets_generated_or_scaffold'), 'MCP brief markdown must expose source-package blocker');
    assertTruthy(markdown.includes('release_checklist_failed_required_check_ids'), 'MCP brief markdown must expose release checklist failed required ids');
    assertTruthy(markdown.includes('Do not move recessed visible plane evidence into visible_plane_primary'), 'MCP brief markdown must preserve recess placement caution');
    assertTruthy(markdown.includes('Do not treat rectangular utility ducts as decorative facade trim'), 'MCP brief markdown must preserve duct semantics caution');
    assertTruthy(markdown.includes('Do not convert shadows into geometry'), 'MCP brief markdown must preserve light/shadow ambiguity caution');
	    assertEqual(intakeBrief.kind, 'mcp_modeling_brief', 'intake must write MCP brief by default');
	    assertEqual(intakeBrief.compile_permission.can_generate_sketchup_dsl, false, 'default intake MCP brief must stay fail-closed');
    assertEqual(intakeBrief.agent_contract.output_policy.sketchup_dsl_allowed, false, 'default intake MCP agent contract must stay fail-closed');
	    assertEqual(intakeBrief.candidate_summary.candidate_count, brief.candidate_summary.candidate_count, 'default intake MCP brief must match exported candidate count');
    assertVisionEvidenceWorkspaceInstance(
      intakeBrief.evidence_summary.vision_evidence,
      'rectangular_utility_ducts',
      'default intake MCP brief should expose duct VisionEvidence semantic instance'
    );
    assertTruthy(
      hasVisionEvidenceModelingHandoff(intakeBrief.evidence_summary.vision_evidence, 'rectangular_utility_ducts', 'decorative_facade_trim'),
      'default intake MCP brief should expose duct VisionEvidence modeling handoff'
    );
    assertIncludes(intakeBrief.modeling_constraint_summary.critical_roles, 'rectangular_utility_ducts', 'default intake MCP brief should preserve duct constraint summary');
    assertIncludes(
      (intakeBrief.modeling_constraint_summary.constraints || []).find((item) => item.role === 'rectangular_utility_ducts')?.blocked_interpretations || [],
      'decorative_facade_trim',
      'default intake MCP brief constraints should block ducts-as-trim'
    );
	    assertTruthy(intakeBriefMarkdown.includes('Do not generate SketchUp DSL directly'), 'default intake MCP brief markdown must state direct-DSL prohibition');
    assertTruthy(intakeBriefMarkdown.includes('## Modeling Constraint Summary'), 'default intake MCP brief markdown must expose modeling constraint summary');
    assertTruthy(intakeBriefMarkdown.includes('### VisionEvidence Semantic Instances'), 'default intake MCP brief markdown must expose VisionEvidence semantic instances');
    assertTruthy(intakeBriefMarkdown.includes('### VisionEvidence Modeling Handoff'), 'default intake MCP brief markdown must expose VisionEvidence modeling handoff');
    assertTruthy(intakeBriefMarkdown.includes('## Agent Contract'), 'default intake MCP brief markdown must expose agent contract');
    assertTruthy(intakeReviewHtml.includes('mcp-modeling-brief-data'), 'default review workbench must embed MCP brief JSON');
    assertTruthy(intakeReviewHtml.includes('modeling-constraint-summary-table'), 'default review workbench must render MCP modeling constraint summary');
    assertTruthy(intakeReviewHtml.includes('download-mcp-brief-json'), 'default review workbench must link MCP brief JSON');
    assertTruthy(intakeReviewHtml.includes('download-mcp-brief-markdown'), 'default review workbench must link MCP brief Markdown');
    assertTruthy(intakeReviewHtml.includes('open-vision-evidence-review-workbench'), 'default review workbench must link VisionEvidence workbench');
    return {
      status: 'mcp_brief_fail_closed',
      artifacts: {
        dir: path.join(outputDir, 'mcp-modeling-brief-export'),
        json: path.join(outputDir, 'mcp-modeling-brief-export', 'mcp-modeling-brief.json'),
        markdown: path.join(outputDir, 'mcp-modeling-brief-export', 'mcp-modeling-brief.md')
      },
      metrics: {
        default_intake_brief: true,
        can_generate_sketchup_dsl: brief.compile_permission.can_generate_sketchup_dsl,
        can_promote_candidates: brief.compile_permission.can_promote_candidates,
        candidates: brief.candidate_summary.candidate_count,
        candidate_groups: brief.candidate_groups.length,
        reasons: brief.compile_permission.reasons,
        source_package_gate: brief.source_package_gate?.status || null,
        mcp_release_checklist_required_check_ids: brief.source_package_gate?.release_checklist_required_check_ids || [],
        mcp_release_checklist_failed_required_check_ids: brief.source_package_gate?.release_checklist_failed_required_check_ids || [],
        source_request_status: brief.source_package_gate?.source_request?.status || null,
        agent_contract_status: brief.agent_contract.status,
        agent_contract_release_checklist_failed_required_check_ids: brief.agent_contract.output_policy.release_checklist_failed_required_check_ids || [],
        blocked_outputs: brief.agent_contract.output_policy.blocked_outputs,
        disambiguation_roles: Array.from(new Set(brief.candidate_disambiguation.map((item) => item.role))).sort(),
        disambiguation_blocked_interpretations: Array.from(new Set(brief.candidate_disambiguation.flatMap((item) => item.blocked_interpretations || []))).sort(),
        modeling_constraint_roles: brief.modeling_constraint_summary.constraints.map((item) => item.role).sort(),
        modeling_constraint_critical_roles: brief.modeling_constraint_summary.critical_roles,
        modeling_constraint_blocked_interpretations: brief.modeling_constraint_summary.blocked_interpretations,
        risk_ids: riskIds,
        vision_evidence_available: brief.evidence_summary.vision_evidence?.available === true,
        vision_evidence_semantic_roles: brief.evidence_summary.vision_evidence?.semantic_review_roles || [],
        vision_evidence_instance_roles: Array.from(new Set((brief.evidence_summary.vision_evidence?.semantic_evidence_instances || []).map((instance) => instance.role))).sort(),
        vision_evidence_modeling_handoff_roles: Array.from(new Set((brief.evidence_summary.vision_evidence?.modeling_handoff || []).map((item) => item.role))).sort(),
        vision_evidence_modeling_handoff_blocked_interpretations: Array.from(new Set((brief.evidence_summary.vision_evidence?.modeling_handoff || []).flatMap((item) => item.blocked_interpretations || []))).sort(),
        authoritative_artifact_roles: brief.agent_contract.authoritative_artifacts.map((artifact) => artifact.role),
	        prohibitions: brief.prohibitions.length,
        review_links: true
      }
    };
  });
  cases.push(mcpBriefCase);

  const readyCase = await collectCase('synthetic_ready_promotion_path', async () => {
    if (!buildingCase.ok) throw new Error('building_single_blocked_demo must pass before synthetic ready promotion');
    const ready = makeSyntheticReadyPromotion({
      assetSet: buildingCase.context.assetSet,
      candidateGraph: buildingCase.context.candidateGraph,
      modelingBrief: buildingCase.context.modelingBrief,
      promotionReview: buildingCase.context.promotionReview,
      profile,
      observationSet: buildingCase.context.observationSet
    });
    const patch = buildCandidatePromotionPatch({
      assetSet: ready.assetSet,
      candidateGraph: ready.candidateGraph,
      modelingBrief: ready.modelingBrief,
      promotionReview: ready.promotionReview,
      sourceReview: 'candidate-promotion-review.ready.synthetic.json'
    });
    const applied = applyCandidatePromotionPatch({
      patch,
      candidateGraph: ready.candidateGraph,
      observationSet: buildingCase.context.observationSet,
      profile,
      id: 'release-gate-building-single-ready-promotion',
      productName: 'Release Gate Building Single Ready Promotion'
    });
    const compileError = captureError(() => compilePartGraphToSketchUpDsl(applied.partGraph, profile, { repoRoot }));
    const readyDir = path.join(absoluteOutputDir, 'synthetic-ready-promotion');
    await fs.mkdir(readyDir, { recursive: true });
    await writeJson(path.join(readyDir, 'candidate-promotion-review.ready.synthetic.json'), ready.promotionReview);
    await writeJson(path.join(readyDir, 'candidate-promotion-patch.ready.synthetic.json'), patch);
    await writeJson(path.join(readyDir, 'part-graph.candidate-promoted.synthetic.json'), applied.partGraph);
    assertEqual(patch.status, 'ready_for_part_graph_patch', 'synthetic review must build a ready patch');
    assertEqual(patch.apply_allowed, true, 'synthetic ready patch must be applyable');
    assertEqual(patch.compile_allowed, false, 'promotion patch must not directly allow compile');
    assertEqual(applied.applied.length, ready.selectedCandidates.length, 'ready patch must apply all selected candidates');
    assertTruthy(
      applied.partGraph.parts.every((part) => part.promoted_geometry === true && part.review_required === true),
      'promoted candidates must retain review-required provenance'
    );
    assertTruthy(
      applied.partGraph.parts.some((part) => part.role === 'visible_plane_recessed_left')
        && applied.partGraph.parts.some((part) => part.role === 'rectangular_utility_ducts'),
      'ready promotion must preserve recess and duct roles'
    );
    assertMatch(compileError?.message || '', /PartGraph compile blocked by geometry gate/, 'compiler gate must still block insufficient ready sample');
    return {
      status: 'gate_preserved',
      artifacts: {
        dir: path.join(outputDir, 'synthetic-ready-promotion'),
        promotion_review: path.join(outputDir, 'synthetic-ready-promotion', 'candidate-promotion-review.ready.synthetic.json'),
        promotion_patch: path.join(outputDir, 'synthetic-ready-promotion', 'candidate-promotion-patch.ready.synthetic.json'),
        part_graph: path.join(outputDir, 'synthetic-ready-promotion', 'part-graph.candidate-promoted.synthetic.json')
      },
      metrics: {
        accepted_candidates: ready.selectedCandidates.length,
        patch_actions: patch.actions.length,
        promoted_parts: applied.partGraph.parts.length,
        compiler_gate_error: compileError.message
      }
    };
  });
  cases.push(readyCase);

  const reviewRoundtripMatrixCase = await collectCase('human_review_roundtrip_matrix_fixture', async () => {
    if (!documentParserCase.ok) throw new Error('pdf_cad_parser_positive_review_gate must pass before human review matrix');
    if (!buildingCase.ok) throw new Error('building_single_blocked_demo must pass before human review matrix');
    const matrixDir = path.join(absoluteOutputDir, 'human-review-roundtrip-matrix');
    await fs.mkdir(matrixDir, { recursive: true });

    const documentReady = makeAcceptedDocumentReviewRoundtrip({
      assetSet: documentParserCase.context.assetSet,
      candidateGraph: documentParserCase.context.candidateGraph,
      modelingBrief: documentParserCase.context.modelingBrief,
      promotionReview: documentParserCase.context.promotionReview,
      observationSet: documentParserCase.context.observationSet,
      documentParseReport: documentParserCase.context.documentParseReport,
      profile
    });
    const documentPatch = buildCandidatePromotionPatch({
      assetSet: documentReady.assetSet,
      candidateGraph: documentReady.candidateGraph,
      modelingBrief: documentReady.modelingBrief,
      promotionReview: documentReady.promotionReview,
      sourceReview: 'human-review-roundtrip-matrix/document-accepted/candidate-promotion-review.accepted.json'
    });
    const documentApplied = applyCandidatePromotionPatch({
      patch: documentPatch,
      candidateGraph: documentReady.candidateGraph,
      observationSet: documentParserCase.context.observationSet,
      profile,
      id: 'release-gate-human-review-document-accepted',
      productName: 'Release Gate Human Review Document Accepted'
    });
    const documentCompileError = captureError(() => compilePartGraphToSketchUpDsl(documentApplied.partGraph, profile, { repoRoot }));
    const documentDir = path.join(matrixDir, 'document-accepted');
    await writeJson(path.join(documentDir, 'candidate-promotion-review.accepted.json'), documentReady.promotionReview);
    await writeJson(path.join(documentDir, 'candidate-promotion-patch.ready.json'), documentPatch);
    await writeJson(path.join(documentDir, 'part-graph.candidate-promoted.json'), documentApplied.partGraph);

    const imageReady = makeSyntheticReadyPromotion({
      assetSet: buildingCase.context.assetSet,
      candidateGraph: buildingCase.context.candidateGraph,
      modelingBrief: buildingCase.context.modelingBrief,
      promotionReview: buildingCase.context.promotionReview,
      profile,
      observationSet: buildingCase.context.observationSet
    });
    const imagePatch = buildCandidatePromotionPatch({
      assetSet: imageReady.assetSet,
      candidateGraph: imageReady.candidateGraph,
      modelingBrief: imageReady.modelingBrief,
      promotionReview: imageReady.promotionReview,
      sourceReview: 'human-review-roundtrip-matrix/image-synthetic-ready/candidate-promotion-review.accepted.json'
    });
    const imageApplied = applyCandidatePromotionPatch({
      patch: imagePatch,
      candidateGraph: imageReady.candidateGraph,
      observationSet: buildingCase.context.observationSet,
      profile,
      id: 'release-gate-human-review-image-synthetic-ready',
      productName: 'Release Gate Human Review Image Synthetic Ready'
    });
    const imageCompileError = captureError(() => compilePartGraphToSketchUpDsl(imageApplied.partGraph, profile, { repoRoot }));
    const imageDir = path.join(matrixDir, 'image-synthetic-ready');
    await writeJson(path.join(imageDir, 'candidate-promotion-review.accepted.json'), imageReady.promotionReview);
    await writeJson(path.join(imageDir, 'candidate-promotion-patch.ready.json'), imagePatch);
    await writeJson(path.join(imageDir, 'part-graph.candidate-promoted.json'), imageApplied.partGraph);

    const blockedSelection = makeBlockedImageSelectionReview({
      candidateGraph: buildingCase.context.candidateGraph,
      promotionReview: buildingCase.context.promotionReview
    });
    const blockedPatch = buildCandidatePromotionPatch({
      assetSet: buildingCase.context.assetSet,
      candidateGraph: buildingCase.context.candidateGraph,
      modelingBrief: buildingCase.context.modelingBrief,
      promotionReview: blockedSelection.promotionReview,
      sourceReview: 'human-review-roundtrip-matrix/image-blocked-selection/candidate-promotion-review.blocked.json'
    });
    const blockedApplyError = captureError(() => applyCandidatePromotionPatch({
      patch: blockedPatch,
      candidateGraph: buildingCase.context.candidateGraph,
      observationSet: buildingCase.context.observationSet,
      profile
    }));
    const blockedDir = path.join(matrixDir, 'image-blocked-selection');
    await writeJson(path.join(blockedDir, 'candidate-promotion-review.blocked.json'), blockedSelection.promotionReview);
    await writeJson(path.join(blockedDir, 'candidate-promotion-patch.blocked.json'), blockedPatch);

    const casesSummary = [
      {
        id: 'document_accepted_ready_patch',
        source: 'document',
        review_verdict: documentReady.promotionReview.verdict,
        patch_status: documentPatch.status,
        apply_allowed: documentPatch.apply_allowed,
        patch_actions: documentPatch.actions.length,
        promoted_parts: documentApplied.partGraph.parts.length,
        compiler_gate_error: documentCompileError?.message || null
      },
      {
        id: 'image_synthetic_ready_patch',
        source: 'image',
        review_verdict: imageReady.promotionReview.verdict,
        patch_status: imagePatch.status,
        apply_allowed: imagePatch.apply_allowed,
        patch_actions: imagePatch.actions.length,
        promoted_parts: imageApplied.partGraph.parts.length,
        compiler_gate_error: imageCompileError?.message || null
      },
      {
        id: 'image_blocked_selection_rejects_apply',
        source: 'image',
        review_verdict: blockedSelection.promotionReview.verdict,
        patch_status: blockedPatch.status,
        apply_allowed: blockedPatch.apply_allowed,
        patch_actions: blockedPatch.actions.length,
        selected_candidates: blockedSelection.selectedCandidates.length,
        apply_error: blockedApplyError?.message || null
      }
    ];
    await writeJson(path.join(matrixDir, 'human-review-roundtrip-matrix-summary.json'), {
      version: 1,
      kind: 'human_review_roundtrip_matrix_summary',
      cases: casesSummary
    });

    assertEqual(documentReady.promotionReview.verdict, 'accepted_subset', 'document matrix review must accept a subset');
    assertEqual(documentPatch.status, 'ready_for_part_graph_patch', 'document matrix patch must be ready');
    assertEqual(documentPatch.apply_allowed, true, 'document matrix patch must be applyable');
    assertEqual(documentApplied.partGraph.parts.length, 1, 'document matrix must promote one part');
    assertMatch(documentCompileError?.message || '', /PartGraph compile blocked by geometry gate/, 'document matrix compile gate must remain active');

    assertEqual(imageReady.promotionReview.verdict, 'accepted_subset', 'image matrix review must accept a subset');
    assertEqual(imagePatch.status, 'ready_for_part_graph_patch', 'image matrix patch must be ready');
    assertEqual(imagePatch.apply_allowed, true, 'image matrix patch must be applyable');
    assertTruthy(imageApplied.partGraph.parts.length >= 2, 'image matrix must promote multiple semantic candidates');
    assertMatch(imageCompileError?.message || '', /PartGraph compile blocked by geometry gate/, 'image matrix compile gate must remain active');

    assertEqual(blockedSelection.promotionReview.verdict, 'blocked', 'blocked matrix review must remain blocked');
    assertEqual(blockedPatch.status, 'blocked', 'blocked matrix patch must remain blocked');
    assertEqual(blockedPatch.apply_allowed, false, 'blocked matrix patch must not be applyable');
    assertEqual(blockedPatch.actions.length, 0, 'blocked matrix patch must not emit actions');
    assertMatch(blockedApplyError?.message || '', /not applyable/, 'blocked matrix patch must reject application');

    return {
      status: 'roundtrip_matrix_guarded',
      artifacts: {
        dir: path.join(outputDir, 'human-review-roundtrip-matrix'),
        summary: path.join(outputDir, 'human-review-roundtrip-matrix', 'human-review-roundtrip-matrix-summary.json')
      },
      metrics: {
        cases: casesSummary.length,
        ready_cases: casesSummary.filter((item) => item.patch_status === 'ready_for_part_graph_patch').length,
        blocked_cases: casesSummary.filter((item) => item.patch_status === 'blocked').length,
        sources: Array.from(new Set(casesSummary.map((item) => item.source))).sort(),
        document_promoted_parts: documentApplied.partGraph.parts.length,
        image_promoted_parts: imageApplied.partGraph.parts.length,
        blocked_apply_error: blockedApplyError.message
      }
    };
  });
  cases.push(reviewRoundtripMatrixCase);

  const reviewUiMatrixCase = await collectCase('human_review_ui_release_matrix_fixture', async () => {
    if (!documentParserCase.ok) throw new Error('pdf_cad_parser_positive_review_gate must pass before browser UI roundtrip');
    if (!buildingCase.ok) throw new Error('building_single_blocked_demo must pass before browser UI roundtrip');
    const uiDir = path.join(absoluteOutputDir, 'human-review-ui-release-matrix');
    await fs.rm(uiDir, { recursive: true, force: true });
    await fs.mkdir(uiDir, { recursive: true });

    const documentDir = path.join(uiDir, 'document-accepted');
    const documentExported = await runReviewUiBrowserRoundtrip({
      reviewHtmlPath: resolveRepo(path.join(outputDir, 'pdf-cad-parser-positive', 'review', 'index.html')),
      outputDir: documentDir,
      candidateIds: ['top_cad_document_outline'],
      knownScale: {
        width: documentParserCase.context.documentParseReport.extracted_geometry.width_mm,
        depth: documentParserCase.context.documentParseReport.extracted_geometry.depth_mm,
        height: profile.default_scale.height
      },
      reviewer: 'release-gate browser ui regression',
      notes: 'Browser-exported review confirms parsed CAD outline for PartGraph promotion regression.'
    });
    const documentPatch = buildCandidatePromotionPatch({
      assetSet: documentParserCase.context.assetSet,
      candidateGraph: documentParserCase.context.candidateGraph,
      modelingBrief: documentParserCase.context.modelingBrief,
      promotionReview: documentExported.promotionReview,
      sourceReview: 'human-review-ui-release-matrix/document-accepted/candidate-promotion-review.browser-exported.json'
    });
    const documentApplied = applyCandidatePromotionPatch({
      patch: documentPatch,
      candidateGraph: documentParserCase.context.candidateGraph,
      observationSet: documentParserCase.context.observationSet,
      profile,
      id: 'release-gate-human-review-browser-ui',
      productName: 'Release Gate Human Review Browser UI'
    });
    const documentCompileError = captureError(() => compilePartGraphToSketchUpDsl(documentApplied.partGraph, profile, { repoRoot }));
    await writeJson(path.join(documentDir, 'candidate-promotion-patch.browser-ready.json'), documentPatch);
    await writeJson(path.join(documentDir, 'part-graph.browser-promoted.json'), documentApplied.partGraph);

    const imageCandidateIds = ['visible_plane_recessed_left', 'rectangular_utility_ducts']
      .map((role) => buildingCase.context.candidateGraph.candidates.find((candidate) => candidate.role === role)?.id)
      .filter(Boolean);
    assertEqual(imageCandidateIds.length, 2, 'browser UI image matrix needs recessed facade and duct candidates');

    const imageAcceptedDir = path.join(uiDir, 'image-accepted');
    const imageAcceptedExported = await runReviewUiBrowserRoundtrip({
      reviewHtmlPath: resolveRepo(path.join(outputDir, 'building-single-blocked', 'review', 'index.html')),
      outputDir: imageAcceptedDir,
      candidateIds: imageCandidateIds,
      knownScale: {
        width: profile.default_scale.width,
        depth: profile.default_scale.depth,
        height: profile.default_scale.height
      },
      reviewer: 'release-gate browser ui image accepted regression',
      notes: 'Browser-exported review confirms image semantic candidates after explicit blocker resolution.'
    });
    const imageAcceptedPatch = buildCandidatePromotionPatch({
      assetSet: buildingCase.context.assetSet,
      candidateGraph: buildingCase.context.candidateGraph,
      modelingBrief: buildingCase.context.modelingBrief,
      promotionReview: withAcceptedDraftingFirstReview(imageAcceptedExported.promotionReview, {
        observationSet: buildingCase.context.observationSet
      }),
      sourceReview: 'human-review-ui-release-matrix/image-accepted/candidate-promotion-review.browser-exported.json'
    });
    const imageAcceptedApplied = applyCandidatePromotionPatch({
      patch: imageAcceptedPatch,
      candidateGraph: buildingCase.context.candidateGraph,
      observationSet: buildingCase.context.observationSet,
      profile,
      id: 'release-gate-human-review-browser-ui-image-accepted',
      productName: 'Release Gate Human Review Browser UI Image Accepted'
    });
    const imageAcceptedCompileError = captureError(() => compilePartGraphToSketchUpDsl(imageAcceptedApplied.partGraph, profile, { repoRoot }));
    await writeJson(path.join(imageAcceptedDir, 'candidate-promotion-patch.browser-ready.json'), imageAcceptedPatch);
    await writeJson(path.join(imageAcceptedDir, 'part-graph.browser-promoted.json'), imageAcceptedApplied.partGraph);

    const imageBlockedDir = path.join(uiDir, 'image-blocked-selection');
    const imageBlockedExported = await runReviewUiBrowserRoundtrip({
      reviewHtmlPath: resolveRepo(path.join(outputDir, 'building-single-blocked', 'review', 'index.html')),
      outputDir: imageBlockedDir,
      candidateIds: imageCandidateIds,
      knownScale: {
        width: profile.default_scale.width,
        depth: profile.default_scale.depth,
        height: profile.default_scale.height
      },
      reviewer: 'release-gate browser ui blocked regression',
      notes: 'Browser-exported review selects image candidates but intentionally leaves confirmations and blockers unresolved.',
      confirmProfile: false,
      confirmScale: false,
      resolveMissingInputs: false,
      resolveCandidateBlockers: false
    });
    const imageBlockedPatch = buildCandidatePromotionPatch({
      assetSet: buildingCase.context.assetSet,
      candidateGraph: buildingCase.context.candidateGraph,
      modelingBrief: buildingCase.context.modelingBrief,
      promotionReview: imageBlockedExported.promotionReview,
      sourceReview: 'human-review-ui-release-matrix/image-blocked-selection/candidate-promotion-review.browser-exported.json'
    });
    const imageBlockedApplyError = captureError(() => applyCandidatePromotionPatch({
      patch: imageBlockedPatch,
      candidateGraph: buildingCase.context.candidateGraph,
      observationSet: buildingCase.context.observationSet,
      profile
    }));
    await writeJson(path.join(imageBlockedDir, 'candidate-promotion-patch.browser-blocked.json'), imageBlockedPatch);

    const casesSummary = [
      {
        id: 'document_accepted_browser_ready_patch',
        source: 'document',
        review_verdict: documentExported.promotionReview.verdict,
        patch_status: documentPatch.status,
        apply_allowed: documentPatch.apply_allowed,
        selected_candidates: documentExported.promotionReview.accepted_candidates.length,
        resolved_blockers: documentExported.promotionReview.resolved_blockers.length,
        patch_actions: documentPatch.actions.length,
        promoted_parts: documentApplied.partGraph.parts.length,
        compiler_gate_error: documentCompileError?.message || null
      },
      {
        id: 'image_accepted_browser_ready_patch',
        source: 'image',
        review_verdict: imageAcceptedExported.promotionReview.verdict,
        patch_status: imageAcceptedPatch.status,
        apply_allowed: imageAcceptedPatch.apply_allowed,
        selected_candidates: imageAcceptedExported.promotionReview.accepted_candidates.length,
        resolved_blockers: imageAcceptedExported.promotionReview.resolved_blockers.length,
        patch_actions: imageAcceptedPatch.actions.length,
        promoted_parts: imageAcceptedApplied.partGraph.parts.length,
        compiler_gate_error: imageAcceptedCompileError?.message || null
      },
      {
        id: 'image_blocked_browser_selection_rejects_apply',
        source: 'image',
        review_verdict: imageBlockedExported.promotionReview.verdict,
        patch_status: imageBlockedPatch.status,
        apply_allowed: imageBlockedPatch.apply_allowed,
        selected_candidates: imageBlockedExported.promotionReview.accepted_candidates.length,
        unresolved_blockers: imageBlockedPatch.blockers.length,
        patch_actions: imageBlockedPatch.actions.length,
        apply_error: imageBlockedApplyError?.message || null
      }
    ];
    await writeJson(path.join(uiDir, 'human-review-ui-release-matrix-summary.json'), {
      version: 1,
      kind: 'human_review_ui_release_matrix_summary',
      browser: documentExported.browser,
      cases: casesSummary
    });

    assertEqual(documentExported.promotionReview.verdict, 'accepted_subset', 'document browser UI review must export accepted subset');
    assertEqual(documentExported.promotionReview.profile_confirmation.status, 'confirmed', 'document browser UI review must confirm profile');
    assertEqual(documentExported.promotionReview.scale_confirmation.status, 'confirmed', 'document browser UI review must confirm scale');
    assertEqual(documentExported.promotionReview.blockers.length, 0, 'document browser UI review must clear blockers after explicit confirmations');
    assertTruthy(documentExported.promotionReview.resolved_blockers.includes('missing_front_view'), 'document browser UI review must record resolved missing view blockers');
    assertTruthy(documentExported.promotionReview.resolved_blockers.includes('review_required'), 'document browser UI review must record resolved candidate blockers');
    assertEqual(documentPatch.status, 'ready_for_part_graph_patch', 'document browser UI exported review must produce ready patch');
    assertEqual(documentPatch.apply_allowed, true, 'document browser UI exported patch must be applyable');
    assertEqual(documentPatch.actions.length, 1, 'document browser UI exported patch must promote the selected CAD candidate');
    assertEqual(documentApplied.partGraph.parts.length, 1, 'document browser UI roundtrip must create one promoted PartGraph part');
    assertMatch(documentCompileError?.message || '', /PartGraph compile blocked by geometry gate/, 'document browser UI roundtrip must keep compiler QA gate');

    assertEqual(imageAcceptedExported.promotionReview.verdict, 'accepted_subset', 'image browser UI review must export accepted subset');
    assertEqual(imageAcceptedExported.promotionReview.profile_confirmation.status, 'confirmed', 'image browser UI review must confirm profile');
    assertEqual(imageAcceptedExported.promotionReview.scale_confirmation.status, 'confirmed', 'image browser UI review must confirm scale');
    assertEqual(imageAcceptedExported.promotionReview.blockers.length, 0, 'image browser UI review must clear blockers after explicit confirmations');
    assertTruthy(imageAcceptedExported.promotionReview.resolved_blockers.includes('scale_confidence_below_publish_gate'), 'image browser UI review must record resolved scale blocker');
    assertEqual(imageAcceptedPatch.status, 'ready_for_part_graph_patch', 'image browser UI exported review must produce ready patch');
    assertEqual(imageAcceptedPatch.apply_allowed, true, 'image browser UI exported patch must be applyable');
    assertEqual(imageAcceptedPatch.actions.length, imageCandidateIds.length, 'image browser UI exported patch must promote selected semantic candidates');
    assertEqual(imageAcceptedApplied.partGraph.parts.length, imageCandidateIds.length, 'image browser UI roundtrip must promote selected image candidates');
    assertMatch(imageAcceptedCompileError?.message || '', /PartGraph compile blocked by geometry gate/, 'image browser UI roundtrip must keep compiler QA gate');

    assertEqual(imageBlockedExported.promotionReview.verdict, 'blocked', 'blocked browser UI review must stay blocked');
    assertTruthy(imageBlockedExported.promotionReview.blockers.length > 0, 'blocked browser UI review must keep blockers visible');
    assertEqual(imageBlockedExported.promotionReview.profile_confirmation.status, 'routed_unconfirmed', 'blocked browser UI review must not confirm profile');
    assertEqual(imageBlockedExported.promotionReview.scale_confirmation.status, 'needs_scale_confirmation', 'blocked browser UI review must not confirm scale');
    assertEqual(imageBlockedPatch.status, 'blocked', 'blocked browser UI patch must stay blocked');
    assertEqual(imageBlockedPatch.apply_allowed, false, 'blocked browser UI patch must not be applyable');
    assertEqual(imageBlockedPatch.actions.length, 0, 'blocked browser UI patch must not emit actions');
    assertMatch(imageBlockedApplyError?.message || '', /not applyable/, 'blocked browser UI patch must reject application');
    return {
      status: 'browser_ui_release_matrix_guarded',
      artifacts: {
        dir: path.join(outputDir, 'human-review-ui-release-matrix'),
        summary: path.join(outputDir, 'human-review-ui-release-matrix', 'human-review-ui-release-matrix-summary.json')
      },
      metrics: {
        browser: documentExported.browser,
        cases: casesSummary.length,
        ready_cases: casesSummary.filter((item) => item.patch_status === 'ready_for_part_graph_patch').length,
        blocked_cases: casesSummary.filter((item) => item.patch_status === 'blocked').length,
        sources: Array.from(new Set(casesSummary.map((item) => item.source))).sort(),
        document_promoted_parts: documentApplied.partGraph.parts.length,
        image_promoted_parts: imageAcceptedApplied.partGraph.parts.length,
        blocked_apply_error: imageBlockedApplyError.message
      }
    };
  });
  cases.push(reviewUiMatrixCase);

  const acceptedPositiveCase = await collectCase('accepted_positive_release_sample_fixture', async () => {
    const observations = await readJson(resolveRepo(ACCEPTED_POSITIVE_BUILDING_GROUP.observations));
    const positiveProfile = await readJson(resolveRepo(BUILDING_GROUP_PROFILE));
    const partGraph = await readJson(resolveRepo(ACCEPTED_POSITIVE_BUILDING_GROUP.partGraph));
    const storedOutput = await readJson(resolveRepo(ACCEPTED_POSITIVE_BUILDING_GROUP.output));
    const compiledOutput = compilePartGraphToSketchUpDsl(partGraph, positiveProfile, { repoRoot });
    const layoutQa = await readJson(resolveRepo(ACCEPTED_POSITIVE_BUILDING_GROUP.layoutQa));
    const referenceQa = await readJson(resolveRepo(ACCEPTED_POSITIVE_BUILDING_GROUP.referenceQa));
    const proposalQa = await readJson(resolveRepo(ACCEPTED_POSITIVE_BUILDING_GROUP.proposalQa));
    const queueProposalQa = await readJson(resolveRepo(ACCEPTED_POSITIVE_BUILDING_GROUP.queueProposalQa));
    const physicalQa = validatePartGraphPhysicalConsistency(partGraph);
    const evidenceCounts = countBy(partGraph.parts || [], 'evidence_status');
    const sourceImages = sourceImagesForPartGraph(partGraph);
    const visionReviewPatch = buildVisionEvidenceReviewPatch({
      visionEvidenceSet: observations.vision_evidence_set_v1,
      source: `${ACCEPTED_POSITIVE_BUILDING_GROUP.observations}#vision_evidence_set_v1`
    });
    const positiveDir = path.join(absoluteOutputDir, 'accepted-positive-building-group');
    const visionReviewPatchArtifact = path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-review-patch.json');
    const visionReviewWorkbenchDir = path.join(positiveDir, 'vision-evidence-review');
    const visionReviewWorkbenchArtifact = path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-review', 'index.html');
    const visionReviewDecisionArtifact = path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-review', 'vision-evidence-review.browser-exported.json');
    const initialVisionReviewDecision = buildAcceptedVisionEvidenceReviewDecision({
      reviewPatch: visionReviewPatch,
      sourceReviewPatch: visionReviewPatchArtifact
    });
    await fs.mkdir(visionReviewWorkbenchDir, { recursive: true });
    await fs.writeFile(path.join(visionReviewWorkbenchDir, 'index.html'), renderVisionEvidenceReviewWorkbenchHtml({
      reviewPatch: visionReviewPatch,
      initialDecision: initialVisionReviewDecision,
      title: 'Accepted Positive Vision Evidence Review'
    }), 'utf8');
    const visionReviewBrowserExported = await runVisionEvidenceReviewUiBrowserRoundtrip({
      reviewHtmlPath: path.join(visionReviewWorkbenchDir, 'index.html'),
      outputDir: visionReviewWorkbenchDir,
      reviewer: 'release-gate vision evidence browser ui',
      acceptedAt: '2026-06-17',
      notes: 'Browser-exported review confirms evidence policy only; no geometry promotion.'
    });
    const visionReviewDecision = visionReviewBrowserExported.reviewDecision;
    const visionPolicyPatch = buildVisionEvidencePolicyCorrectionPatch({
      reviewPatch: visionReviewPatch,
      reviewDecision: visionReviewDecision,
      sourceReviewPatch: visionReviewPatchArtifact,
      sourceReviewDecision: visionReviewDecisionArtifact
    });
    const appliedVisionPolicy = applyVisionEvidencePolicyCorrectionPatch({
      visionEvidenceSet: observations.vision_evidence_set_v1,
      patch: visionPolicyPatch
    });
    await fs.mkdir(positiveDir, { recursive: true });
    await writeJson(path.join(positiveDir, 'compiled-output.json'), compiledOutput);
    await writeJson(path.join(positiveDir, 'physical-consistency-report.json'), physicalQa);
    await writeJson(path.join(positiveDir, 'vision-evidence-review-patch.json'), visionReviewPatch);
    await fs.writeFile(path.join(positiveDir, 'vision-evidence-review-patch.md'), renderVisionEvidenceReviewPatchMarkdown(visionReviewPatch), 'utf8');
    await writeJson(path.join(positiveDir, 'vision-evidence-review.accepted.json'), visionReviewDecision);
    await writeJson(path.join(positiveDir, 'vision-evidence-policy-correction-patch.json'), visionPolicyPatch);
    await fs.writeFile(path.join(positiveDir, 'vision-evidence-policy-correction-patch.md'), renderVisionEvidencePolicyCorrectionPatchMarkdown(visionPolicyPatch), 'utf8');
    await writeJson(path.join(positiveDir, 'vision-evidence-v1.reviewed.json'), appliedVisionPolicy.visionEvidenceSet);
    await writeJson(path.join(positiveDir, 'positive-release-sample-summary.json'), {
      version: 1,
      kind: 'accepted_positive_release_sample_summary',
      sample_id: 'building_group_r7_final',
      profile: partGraph.profile_id,
      source_part_graph: ACCEPTED_POSITIVE_BUILDING_GROUP.partGraph,
      source_output: ACCEPTED_POSITIVE_BUILDING_GROUP.output,
      source_images: sourceImages,
      evidence_counts: evidenceCounts,
      operations: operationCounts(compiledOutput.operations || []),
      vision_evidence_review: {
        status: visionReviewPatch.status,
        review_items: visionReviewPatch.summary.total_items,
        apply_allowed: visionReviewPatch.apply_allowed,
        compile_allowed: visionReviewPatch.compile_allowed,
        decision_status: visionReviewDecision.status,
        policy_correction_status: visionPolicyPatch.status,
        policy_correction_actions: visionPolicyPatch.summary.total_actions,
        policy_correction_apply_scope: visionPolicyPatch.apply_scope,
        policy_correction_compile_allowed: visionPolicyPatch.compile_allowed,
        policy_correction_geometry_promotion_allowed: visionPolicyPatch.geometry_promotion_allowed,
        browser_export: visionReviewBrowserExported.browser
      },
      qa: {
        layout: layoutQa.verdict,
        reference_visual: referenceQa.verdict,
        proposal_review: proposalQa.ok === true ? 'pass' : 'fail',
        queue_proposal_review: queueProposalQa.ok === true ? 'pass' : 'fail',
        physical_consistency: physicalQa.verdict
      }
    });
    assertEqual(partGraph.profile_id, positiveProfile.profile_id, 'accepted positive sample profile must match product profile');
    assertEqual(JSON.stringify(compiledOutput), JSON.stringify(storedOutput), 'accepted positive sample output must match current compiler output');
    assertTruthy((partGraph.parts || []).length >= 10, 'accepted positive sample must contain enough PartGraph parts');
    assertTruthy((evidenceCounts.manual_confirmed || 0) >= 5, 'accepted positive sample must contain manually confirmed parts');
    assertTruthy((evidenceCounts.observed || 0) >= 4, 'accepted positive sample must contain observed parts');
    assertTruthy(Number(partGraph.scale?.confidence || 0) >= 0.7, 'accepted positive sample must meet scale confidence gate');
    assertTruthy(sourceImages.length >= 2, 'accepted positive sample must keep source image provenance');
    for (const sourceImage of sourceImages) {
      assertTruthy(await pathExists(resolveRepo(sourceImage)), `accepted positive source image must exist: ${sourceImage}`);
    }
    assertEqual(layoutQa.ok, true, 'accepted positive sample layout QA must pass');
    assertEqual(layoutQa.summary?.total, 0, 'accepted positive sample layout QA must have no issues');
    assertEqual(referenceQa.ok, true, 'accepted positive sample reference visual QA must pass');
    assertEqual(referenceQa.summary?.total, 0, 'accepted positive sample reference QA must have no issues');
    assertEqual(proposalQa.ok, true, 'accepted positive sample proposal QA must pass');
    assertEqual(proposalQa.review_required, false, 'accepted positive sample proposal QA must not require review');
    assertEqual(proposalQa.compiled_matches_output, true, 'accepted positive sample proposal QA must verify output freshness');
    assertEqual(proposalQa.physical_consistency?.verdict, 'pass', 'accepted positive sample proposal QA physical gate must pass');
    assertEqual(queueProposalQa.ok, true, 'accepted positive sample queue QA must pass');
    assertEqual(queueProposalQa.review_required, false, 'accepted positive sample queue QA must not require review');
    assertTruthy(Number(queueProposalQa.artifact?.size_bytes || 0) > 0, 'accepted positive sample queue QA must record a saved artifact');
    assertEqual(physicalQa.verdict, 'pass', 'accepted positive sample physical consistency must pass');
    assertEqual(visionReviewPatch.status, 'needs_review', 'accepted positive sample should keep VisionEvidence review patch visible');
    assertEqual(visionReviewPatch.apply_allowed, false, 'accepted positive VisionEvidence review patch must not be directly applyable');
    assertEqual(visionReviewPatch.compile_allowed, false, 'accepted positive VisionEvidence review patch must not allow compile');
    assertTruthy(visionReviewPatch.summary.ground_plane_items >= 3, 'accepted positive VisionEvidence review patch should expose per-image ground-plane review');
    assertTruthy(visionReviewPatch.review_items.some((item) => item.required_decision === 'confirm_roof_seams_are_not_site_or_road_boundaries'), 'accepted positive VisionEvidence review patch should protect roof seams from boundary promotion');
    assertEqual(visionReviewDecision.status, 'accepted_policy_review', 'accepted positive VisionEvidence review decision should record accepted policy review');
    assertEqual(visionReviewDecision.reviewer, 'release-gate vision evidence browser ui', 'accepted positive VisionEvidence review decision should come from browser UI export');
    assertEqual(visionReviewDecision.compile_allowed, false, 'accepted positive VisionEvidence review decision must not allow compile');
    assertEqual(visionReviewDecision.geometry_promotion_allowed, false, 'accepted positive VisionEvidence review decision must not allow geometry promotion');
    assertEqual(visionPolicyPatch.status, 'ready_for_vision_evidence_policy_update', 'accepted positive VisionEvidence policy correction should be ready for evidence metadata update');
    assertEqual(visionPolicyPatch.apply_scope, 'vision_evidence_set_policy_only', 'accepted positive VisionEvidence policy correction must be scoped to evidence policy');
    assertEqual(visionPolicyPatch.apply_allowed, true, 'accepted positive VisionEvidence policy correction should be applyable to evidence metadata');
    assertEqual(visionPolicyPatch.compile_allowed, false, 'accepted positive VisionEvidence policy correction must not allow compile');
    assertEqual(visionPolicyPatch.geometry_promotion_allowed, false, 'accepted positive VisionEvidence policy correction must not allow geometry promotion');
    assertEqual(visionPolicyPatch.summary.total_actions, visionReviewPatch.summary.total_items, 'accepted positive VisionEvidence policy correction should cover all accepted review items');
    assertEqual(appliedVisionPolicy.applied.length, visionPolicyPatch.summary.total_actions, 'accepted positive VisionEvidence policy correction should apply all metadata actions');
    assertTruthy(appliedVisionPolicy.visionEvidenceSet.view_ground_plane.images.some((image) => image.policy_review?.decision === 'confirmed_planar_groundplan_candidate'), 'accepted positive reviewed VisionEvidenceSet should annotate top-view policy review');
    assertTruthy(appliedVisionPolicy.visionEvidenceSet.edges.some((edge) => edge.class === 'roof_internal_seam' && edge.policy_review?.decision === 'confirmed_keep_roof_seam_rejected' && edge.accepted !== true), 'accepted positive reviewed VisionEvidenceSet should keep roof seams rejected');
    assertTruthy((compiledOutput.operations || []).some((operation) => operation.op === 'cut_recess'), 'accepted positive sample must compile facade/opening feature operations');
    assertTruthy((compiledOutput.operations || []).some((operation) => operation.op === 'add_raised_rib'), 'accepted positive sample must compile roofline feature operations');
    return {
      status: 'accepted_positive_pass',
      artifacts: {
        dir: path.join(outputDir, 'accepted-positive-building-group'),
        source_part_graph: ACCEPTED_POSITIVE_BUILDING_GROUP.partGraph,
        source_output: ACCEPTED_POSITIVE_BUILDING_GROUP.output,
        compiled_output: path.join(outputDir, 'accepted-positive-building-group', 'compiled-output.json'),
        physical_consistency_report: path.join(outputDir, 'accepted-positive-building-group', 'physical-consistency-report.json'),
        vision_evidence_review_patch: path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-review-patch.json'),
        vision_evidence_review_patch_markdown: path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-review-patch.md'),
        vision_evidence_review_workbench: visionReviewWorkbenchArtifact,
        vision_evidence_review_decision: visionReviewDecisionArtifact,
        vision_evidence_review_decision_alias: path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-review.accepted.json'),
        vision_evidence_policy_correction_patch: path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-policy-correction-patch.json'),
        vision_evidence_policy_correction_patch_markdown: path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-policy-correction-patch.md'),
        vision_evidence_reviewed_set: path.join(outputDir, 'accepted-positive-building-group', 'vision-evidence-v1.reviewed.json'),
        summary: path.join(outputDir, 'accepted-positive-building-group', 'positive-release-sample-summary.json')
      },
      metrics: {
        sample_id: 'building_group_r7_final',
        profile_id: partGraph.profile_id,
        parts: partGraph.parts.length,
        source_images: sourceImages.length,
        evidence_counts: evidenceCounts,
        scale_confidence: partGraph.scale.confidence,
        operations: compiledOutput.operations.length,
        operation_counts: operationCounts(compiledOutput.operations || []),
        layout_issues: layoutQa.summary.total,
        reference_issues: referenceQa.summary.total,
        proposal_qa_ok: proposalQa.ok,
        queue_qa_ok: queueProposalQa.ok,
        queue_artifact_size_bytes: queueProposalQa.artifact?.size_bytes,
        vision_evidence_review_patch_status: visionReviewPatch.status,
        vision_evidence_review_items: visionReviewPatch.summary.total_items,
        vision_evidence_review_apply_allowed: visionReviewPatch.apply_allowed,
        vision_evidence_review_compile_allowed: visionReviewPatch.compile_allowed,
        vision_evidence_ground_plane_review_items: visionReviewPatch.summary.ground_plane_items,
        vision_evidence_review_decision_status: visionReviewDecision.status,
        vision_evidence_review_decision_browser: visionReviewBrowserExported.browser,
        vision_evidence_policy_correction_status: visionPolicyPatch.status,
        vision_evidence_policy_correction_actions: visionPolicyPatch.summary.total_actions,
        vision_evidence_policy_correction_apply_scope: visionPolicyPatch.apply_scope,
        vision_evidence_policy_correction_apply_allowed: visionPolicyPatch.apply_allowed,
        vision_evidence_policy_correction_compile_allowed: visionPolicyPatch.compile_allowed,
        vision_evidence_policy_correction_geometry_promotion_allowed: visionPolicyPatch.geometry_promotion_allowed,
        physical_verdict: physicalQa.verdict
      }
    };
  });
  cases.push(acceptedPositiveCase);

  const realWorldProductCase = await collectCase('real_world_positive_switch_product_fixture', async () => {
    const observations = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.observations));
    const modelPlan = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.modelPlan));
    const storedOutput = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.output));
    const snapshot = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.snapshot));
    const queueSnapshot = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.queueSnapshot));
    const queueDiff = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.queueDiff));
    const visualRelation = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.visualRelation));
    const geometryFit = await readJson(resolveRepo(REAL_WORLD_SWITCH_PRODUCT.geometryFit));
    const compiledOutput = compilePlanToSketchUpDsl(modelPlan);
    const sourceImages = sourceImagesForObservationSet(observations);
    const views = viewsForObservationSet(observations);
    const sourceExistence = [];
    for (const sourceImage of sourceImages) {
      sourceExistence.push({
        path: sourceImage,
        exists: await pathExists(resolveRepo(sourceImage))
      });
    }
    const relationCandidates = (observations.images || [])
      .reduce((total, image) => total + (image.relation_candidates || []).length, 0);
    const evidenceSummary = modelPlan.review?.evidence_summary || {};
    const operationSummary = operationCounts(compiledOutput.operations || []);
    const productDir = path.join(absoluteOutputDir, 'real-world-positive-switch-product');
    await fs.mkdir(productDir, { recursive: true });
    await writeJson(path.join(productDir, 'compiled-output.json'), compiledOutput);
    await writeJson(path.join(productDir, 'real-world-positive-product-summary.json'), {
      version: 1,
      kind: 'real_world_positive_product_release_sample_summary',
      sample_id: 'switch_controller_real_photos',
      sample_scope: 'real_world_product_positive',
      release_gate_decision: 'counts_as_real_world_product_positive_not_building_release_positive',
      source_observations: REAL_WORLD_SWITCH_PRODUCT.observations,
      source_model_plan: REAL_WORLD_SWITCH_PRODUCT.modelPlan,
      source_output: REAL_WORLD_SWITCH_PRODUCT.output,
      source_images: sourceImages,
      source_images_exist: sourceExistence.every((item) => item.exists),
      views_detected: views,
      image_set_quality: observations.image_set_quality,
      evidence_summary: evidenceSummary,
      operations: operationSummary,
      qa: {
        compiled_matches_output: JSON.stringify(compiledOutput) === JSON.stringify(storedOutput),
        mock_snapshot_errors: warningErrors(snapshot),
        queue_snapshot_errors: warningErrors(queueSnapshot),
        queue_warning_gate: queueDiff.warning_gate?.ok === true ? 'pass' : 'fail',
        visual_relation: visualRelation.ok === true ? 'pass' : 'fail',
        geometry_fit: geometryFit.ok === true ? 'pass' : 'fail'
      }
    });
    assertEqual(observations.object?.profile, 'switch_controller', 'real-world product sample must use the switch_controller profile');
    assertEqual(observations.object?.type, 'game_controller', 'real-world product sample must keep the game controller object type');
    assertEqual(observations.quality_report?.usable_for_modeling, true, 'real-world product sample must be usable for modeling');
    assertTruthy(sourceImages.length >= 6, 'real-world product sample must keep six real source photo paths');
    assertTruthy(sourceExistence.every((item) => item.exists), 'real-world product source photos must exist in the workspace');
    assertEqual((observations.images || []).length, sourceImages.length, 'real-world product sample must keep one observation record per source photo');
    for (const view of ['front', 'rear', 'right', 'oblique']) {
      assertTruthy(views.includes(view), `real-world product sample must include a ${view} view`);
    }
    assertTruthy((observations.evidence_graph?.parts || []).length >= 8, 'real-world product sample must keep native evidence graph parts');
    assertTruthy(relationCandidates >= 100, 'real-world product sample must keep visual relation candidates');
    assertTruthy((modelPlan.parts || []).length >= 8, 'real-world product model plan must contain core parts');
    assertEqual(evidenceSummary.image_count, sourceImages.length, 'real-world product evidence summary must match source image count');
    assertTruthy((evidenceSummary.status_counts?.observed || 0) >= 6, 'real-world product sample must keep observed part evidence');
    assertTruthy((evidenceSummary.missing_views || []).includes('top'), 'real-world product sample must keep the missing top-view caveat visible');
    assertTruthy((evidenceSummary.template_prior_parts || []).length >= modelPlan.parts.length, 'real-world product sample must expose profile/template prior usage');
    assertEqual(JSON.stringify(compiledOutput), JSON.stringify(storedOutput), 'real-world product output must match current compiler output');
    assertTruthy((compiledOutput.operations || []).length >= 40, 'real-world product output must contain a detailed DSL operation set');
    assertTruthy((operationSummary.rounded_box || 0) >= 6, 'real-world product output must keep rounded product primitives');
    assertTruthy((operationSummary.component_instance || 0) >= 4, 'real-world product output must keep component instances');
    assertEqual(snapshot.runtime, 'mock', 'real-world product mock snapshot must record mock runtime');
    assertEqual(queueSnapshot.runtime, 'queue', 'real-world product queue snapshot must record queue runtime');
    assertEqual(warningErrors(snapshot), 0, 'real-world product mock snapshot must have no error warnings');
    assertEqual(warningErrors(queueSnapshot), 0, 'real-world product queue snapshot must have no error warnings');
    assertEqual(snapshot.snapshot_summary?.totals?.groups, queueSnapshot.snapshot_summary?.totals?.groups, 'real-world product mock/queue group counts must match');
    assertEqual(snapshot.snapshot_summary?.totals?.instances, queueSnapshot.snapshot_summary?.totals?.instances, 'real-world product mock/queue instance counts must match');
    assertEqual(snapshot.snapshot_summary?.scenes?.length, queueSnapshot.snapshot_summary?.scenes?.length, 'real-world product mock/queue scene counts must match');
    assertEqual(queueDiff.warning_gate?.ok, true, 'real-world product queue diff warning gate must pass');
    assertEqual(queueDiff.report?.summary?.by_severity?.error || 0, 0, 'real-world product queue diff must have no error differences');
    assertEqual(visualRelation.ok, true, 'real-world product visual relation QA must pass');
    assertEqual(visualRelation.summary?.total_issues || 0, 0, 'real-world product visual relation QA must have no issues');
    assertEqual(geometryFit.ok, true, 'real-world product geometry fit QA must pass');
    assertEqual(geometryFit.summary?.total_issues || 0, 0, 'real-world product geometry fit QA must have no issues');
    assertTruthy((geometryFit.summary?.checked_footprints || 0) >= 8, 'real-world product geometry fit must check grounded footprints');
    assertTruthy((geometryFit.summary?.checked_relations || 0) >= 6, 'real-world product geometry fit must check visual relations');
    return {
      status: 'real_world_product_positive_pass',
      artifacts: {
        dir: path.join(outputDir, 'real-world-positive-switch-product'),
        source_observations: REAL_WORLD_SWITCH_PRODUCT.observations,
        source_model_plan: REAL_WORLD_SWITCH_PRODUCT.modelPlan,
        source_output: REAL_WORLD_SWITCH_PRODUCT.output,
        compiled_output: path.join(outputDir, 'real-world-positive-switch-product', 'compiled-output.json'),
        summary: path.join(outputDir, 'real-world-positive-switch-product', 'real-world-positive-product-summary.json'),
        mock_snapshot: REAL_WORLD_SWITCH_PRODUCT.snapshot,
        queue_snapshot: REAL_WORLD_SWITCH_PRODUCT.queueSnapshot,
        queue_diff: REAL_WORLD_SWITCH_PRODUCT.queueDiff,
        visual_relation: REAL_WORLD_SWITCH_PRODUCT.visualRelation,
        geometry_fit: REAL_WORLD_SWITCH_PRODUCT.geometryFit
      },
      metrics: {
        sample_id: 'switch_controller_real_photos',
        sample_scope: 'real_world_product_positive',
        release_gate_decision: 'not_building_release_positive',
        source_images: sourceImages.length,
        source_images_exist: sourceExistence.every((item) => item.exists),
        views_detected: views,
        image_set_quality: observations.image_set_quality,
        evidence_graph_parts: observations.evidence_graph?.parts?.length || 0,
        relation_candidates: relationCandidates,
        model_plan_parts: modelPlan.parts.length,
        evidence_counts: evidenceSummary.status_counts || {},
        missing_views: evidenceSummary.missing_views || [],
        operation_counts: operationSummary,
        operations: compiledOutput.operations.length,
        compiled_matches_output: true,
        mock_groups: snapshot.snapshot_summary?.totals?.groups,
        queue_groups: queueSnapshot.snapshot_summary?.totals?.groups,
        mock_instances: snapshot.snapshot_summary?.totals?.instances,
        queue_instances: queueSnapshot.snapshot_summary?.totals?.instances,
        queue_warning_gate_ok: queueDiff.warning_gate?.ok,
        visual_relation_checked: visualRelation.summary?.checked_relations,
        geometry_fit_checked_footprints: geometryFit.summary?.checked_footprints,
        geometry_fit_checked_relations: geometryFit.summary?.checked_relations
      }
    };
  });
  cases.push(realWorldProductCase);

  const formalManifestWriteGuardCase = await collectCase('real_world_building_formal_manifest_write_guard', async () => {
    const guardDir = path.join(outputDir, 'real-world-building-formal-manifest-write-guard');
    const stagingManifest = path.join(guardDir, 'manifest.draft.json');
    const formalManifestAbsolutePath = resolveRepo(DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST);
    const formalManifestBefore = await readOptionalText(formalManifestAbsolutePath);
    const blocked = await prepareRealWorldBuildingReleaseSampleCli({
      sampleId: 'release-gate-formal-target-blocked',
      sourceImages: [
        'test/real-building-demo/top-view.jpg',
        'test/real-building-demo/oblique-view.jpg'
      ],
      sourceAssetKind: 'real_building_photo_or_scan',
      profilePath: BUILDING_GROUP_PROFILE,
      artifacts: {
        part_graph: 'projects/image-structured-modeler/examples/real-world-building-positive/part-graph.json',
        output: 'projects/image-structured-modeler/examples/real-world-building-positive/output.json',
        photo_grade_readiness_report: 'projects/image-structured-modeler/examples/real-world-building-positive/photo-grade-readiness-report.json',
        vision_evidence_report: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-v1-report.json',
        vision_evidence_review_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review-patch.json',
        vision_evidence_review_decision: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-review.accepted.json',
        vision_evidence_policy_correction_patch: 'projects/image-structured-modeler/examples/real-world-building-positive/vision-evidence-policy-correction-patch.json'
      },
      review: {
        reviewer: 'release gate formal manifest guard',
        accepted_at: '2026-06-16',
        notes: 'Invalid draft intentionally targets the formal release manifest path; guard must keep it staged.'
      },
      manifestOutput: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
      formalManifestStagingOutput: stagingManifest
    });
    const formalManifestAfter = await readOptionalText(formalManifestAbsolutePath);
    assertEqual(blocked.ok, false, 'invalid formal manifest prepare request must fail closed');
    assertEqual(blocked.status, 'formal_release_manifest_write_blocked', 'invalid formal manifest prepare request must expose blocked status');
    assertEqual(blocked.formalManifestWriteBlocked, true, 'invalid formal manifest prepare request must record write block');
    assertEqual(blocked.manifestOutput, stagingManifest, 'invalid formal manifest prepare request must write only staging draft');
    assertEqual(blocked.requestedManifestOutput, DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST, 'invalid formal manifest prepare request must retain requested formal path');
    assertEqual(blocked.workOrder.status, 'blocked_needs_source_assets', 'formal manifest guard work order must stay source-blocked');
    assertIncludes(blocked.formalManifestBlockers, 'source_assets', 'formal manifest guard must preserve source blocker');
    assertIncludes(blocked.formalManifestBlockers, 'artifacts', 'formal manifest guard must preserve artifact blocker');
    assertIncludes(blocked.formalManifestBlockers, 'vision_evidence_review', 'formal manifest guard must preserve VisionEvidence review blocker');
    assertEqual(await pathExists(resolveRepo(blocked.workOrderOutput)), true, 'formal manifest guard must write release work order');
    assertEqual(await pathExists(resolveRepo(blocked.workOrderMarkdownOutput)), true, 'formal manifest guard must write release work order markdown');
    assertEqual(formalManifestAfter, formalManifestBefore, 'invalid formal manifest prepare request must not modify formal manifest');
    assertEqual(await pathExists(resolveRepo(stagingManifest)), true, 'formal manifest guard must retain a staging draft for review');
    return {
      status: 'formal_manifest_write_blocked',
      artifacts: {
        dir: guardDir,
        staging_manifest: stagingManifest,
        summary: blocked.contractSummaryOutput,
        release_checklist: blocked.checklistOutput,
        release_checklist_markdown: blocked.checklistMarkdownOutput,
        release_work_order: blocked.workOrderOutput,
        release_work_order_markdown: blocked.workOrderMarkdownOutput,
        protected_manifest: {
          path: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
          required: false,
          expected_missing: formalManifestBefore === null
        }
      },
      metrics: {
        requested_formal_manifest: blocked.formalManifestTargetRequested,
        formal_write_blocked: blocked.formalManifestWriteBlocked,
        validation_status: blocked.validation?.status || null,
        blockers: blocked.formalManifestBlockers,
        release_work_order_status: blocked.workOrder.status,
        formal_manifest_unchanged: formalManifestAfter === formalManifestBefore
      }
    };
  });
  cases.push(formalManifestWriteGuardCase);

  const realWorldBuildingManifestCase = await collectCase('real_world_building_positive_manifest_contract', async () => {
    const contractDir = path.join(absoluteOutputDir, 'real-world-building-positive-manifest');
    const validation = await validateRealWorldBuildingPositiveManifestPath({
      manifestPath: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
      outputDir: contractDir
    });
    const contractArtifacts = {
      dir: path.join(outputDir, 'real-world-building-positive-manifest'),
      expected_manifest: {
        path: DEFAULT_REAL_WORLD_BUILDING_POSITIVE_MANIFEST,
        required: validation.metrics.manifest_present === true,
        expected_missing: validation.metrics.manifest_present !== true
      },
      summary: path.join(outputDir, 'real-world-building-positive-manifest', 'manifest-contract-summary.json')
    };
    if (validation.metrics.manifest_present === true) {
      contractArtifacts.compiled_output = path.join(outputDir, 'real-world-building-positive-manifest', 'compiled-output.json');
      contractArtifacts.physical_consistency_report = path.join(outputDir, 'real-world-building-positive-manifest', 'physical-consistency-report.json');
      contractArtifacts.release_checklist = path.join(outputDir, 'real-world-building-positive-manifest', 'release-checklist.json');
      contractArtifacts.release_checklist_markdown = path.join(outputDir, 'real-world-building-positive-manifest', 'release-checklist.md');
    }
    return {
      status: validation.status,
      artifacts: contractArtifacts,
      metrics: validation.metrics
    };
  });
  cases.push(realWorldBuildingManifestCase);

  const rhinoFactoryGuardCase = await collectCase('building_single_rhino_factory_visual_gap_guard', async () => {
    const findings = await readJson(resolveRepo(RHINO_FACTORY_VISUAL_GAP.findings));
    const modelQa = await fs.readFile(resolveRepo(RHINO_FACTORY_VISUAL_GAP.modelQa), 'utf8');
    const queueModelQa = await fs.readFile(resolveRepo(RHINO_FACTORY_VISUAL_GAP.queueModelQa), 'utf8');
    const findingIds = new Set((findings.findings || []).map((finding) => finding.id));
    const classificationCounts = {};
    for (const finding of findings.findings || []) {
      for (const key of finding.classifications || []) {
        classificationCounts[key] = (classificationCounts[key] || 0) + 1;
      }
    }
    const guardDir = path.join(absoluteOutputDir, 'building-single-rhino-factory-visual-gap-guard');
    await fs.mkdir(guardDir, { recursive: true });
    await writeJson(path.join(guardDir, 'visual-gap-guard-summary.json'), {
      version: 1,
      kind: 'visual_gap_guard_summary',
      sample_id: findings.sample_id,
      queue_layout_qa: findings.acceptance?.queue_layout_qa,
      manual_visual_review: findings.acceptance?.manual_visual_review,
      accepted_as_precise_reconstruction: findings.acceptance?.accepted_as_precise_reconstruction,
      finding_ids: Array.from(findingIds).sort(),
      classification_counts: classificationCounts,
      release_gate_decision: 'not_release_positive'
    });
    assertEqual(findings.acceptance?.queue_layout_qa, 'pass', 'Rhino factory guard must prove layout QA can pass');
    assertEqual(findings.acceptance?.manual_visual_review, 'fail', 'Rhino factory guard must keep manual visual failure visible');
    assertEqual(findings.acceptance?.accepted_as_precise_reconstruction, false, 'Rhino factory guard must not accept failed visual sample as precise reconstruction');
    assertTruthy((findings.findings || []).length >= 7, 'Rhino factory guard must keep all known findings');
    assertTruthy(findingIds.has('F-004'), 'Rhino factory guard must include rectangular-vs-curved skylight failure');
    assertTruthy(findingIds.has('F-006'), 'Rhino factory guard must include layout-QA false-positive failure');
    assertTruthy(modelQa.includes('OK: **true**') && modelQa.includes('Total issues | 0'), 'Rhino factory guard must prove mock layout QA passed with zero issues');
    assertTruthy(queueModelQa.includes('OK: **true**') && queueModelQa.includes('Total issues | 0'), 'Rhino factory guard must prove queue layout QA passed with zero issues');
    return {
      status: 'visual_gap_not_release_positive',
      artifacts: {
        dir: path.join(outputDir, 'building-single-rhino-factory-visual-gap-guard'),
        findings: RHINO_FACTORY_VISUAL_GAP.findings,
        summary: path.join(outputDir, 'building-single-rhino-factory-visual-gap-guard', 'visual-gap-guard-summary.json')
      },
      metrics: {
        sample_id: findings.sample_id,
        queue_layout_qa: findings.acceptance.queue_layout_qa,
        manual_visual_review: findings.acceptance.manual_visual_review,
        accepted_as_precise_reconstruction: findings.acceptance.accepted_as_precise_reconstruction,
        findings: findings.findings.length,
        classifications: classificationCounts,
        blocking_findings: ['F-004', 'F-006']
      }
    };
  });
  cases.push(rhinoFactoryGuardCase);

  const demoCandidateAuditCase = await collectCase('real_world_building_demo_candidate_audit_fixture', async () => {
    const auditInputs = [CANONICAL_SINGLE_INPUT];
    if (await pathExists(resolveRepo(USER_BUILDING_SINGLE_INPUT))) auditInputs.push(USER_BUILDING_SINGLE_INPUT);
    const audit = await auditRealWorldBuildingDemoCandidates({
      inputs: auditInputs,
      outputDir: path.join(outputDir, 'real-world-building-demo-candidate-audit'),
      objectType: 'building_single',
      writeReview: false,
      writeOverlays: false
    });
    assertEqual(audit.ok, true, 'real-world building candidate audit must complete');
    assertEqual(audit.release_ready, false, 'local demo candidate audit must not close the building release gap');
    assertTruthy(audit.candidates.length >= 1, 'real-world building candidate audit must evaluate candidates');
    assertEqual(audit.summary.input_ready_source_packages, 0, 'local demo candidate audit must not find input-ready source packages');
    assertEqual(audit.summary.release_selectable_candidates, 0, 'local demo candidate audit must not select generated/screenshot inputs for release work');
    assertEqual(audit.summary.formal_manifest_selectable_candidates, 0, 'local demo candidate audit must not select generated/screenshot inputs for formal manifest promotion');
    assertTruthy(audit.summary.best_structure_review_candidate, 'candidate audit must keep a structure-review best candidate when semantic coverage exists');
    assertEqual(audit.summary.best_release_work_candidate, null, 'candidate audit must keep release-work best candidate empty until real sources pass');
    assertEqual(audit.summary.best_formal_manifest_candidate, null, 'candidate audit must keep formal-manifest best candidate empty until release-ready');
    assertTruthy(
      audit.candidates.every((candidate) => candidate.input_ready_for_release_work === false),
      'candidate audit must keep local source packages blocked'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.release_candidate_assessment?.selectable_for_release_work === false),
      'candidate audit must keep blocked local demos unselectable for release work'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.release_candidate_assessment?.selectable_for_formal_manifest === false),
      'candidate audit must keep blocked local demos unselectable for formal manifest'
    );
    assertTruthy(
      audit.candidates.every((candidate) => ['needs_real_sources', 'needs_views_or_scale'].includes(candidate.release_candidate_assessment?.tier)),
      'candidate audit must expose release candidate tiers for blocked local demos'
    );
    assertTruthy(
      audit.candidates.some((candidate) => candidate.semantic_role_coverage.includes('visible_plane_recessed_left')),
      'candidate audit must preserve recessed facade coverage'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.release_blockers.includes('artifacts')),
      'candidate audit must keep missing release artifacts visible'
    );
    assertTruthy(
      audit.candidates.some((candidate) => candidate.release_blockers.includes('source_assets')),
      'candidate audit must flag non-release source assets when present'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.source_request?.request_file === candidate.artifacts.source_request),
      'candidate audit must expose saved source-request artifacts per candidate'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.source_request?.upload_manifest_template === candidate.artifacts.upload_manifest_template),
      'candidate audit must expose saved upload manifest templates per candidate'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.source_request?.view_source_diversity_required === true),
      'candidate audit source requests must require distinct source images'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.refill_workflow?.commands?.run_refill_upload_session?.includes('--source-request-file')),
      'candidate audit must provide refill upload-session commands tied to the source request'
    );
    assertEqual(
      audit.summary.recommended_next_action,
      'run_refill_upload_session_with_real_sources',
      'candidate audit must recommend real-source refill for blocked local demos'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.release_preparation_workflow?.commands?.run_upload_session_from_candidate_input?.includes('image-structured:real-world-building-upload-session')),
      'candidate audit must expose release preparation upload-session commands'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.release_preparation_workflow?.commands?.prepare_release_artifact_workspace?.includes('prepare-real-world-building-release-artifact-workspace')),
      'candidate audit must expose release artifact workspace preparation commands'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.release_preparation_workflow?.commands?.guarded_write_formal_manifest?.includes('--manifest-output projects/image-structured-modeler/examples/real-world-building-positive/manifest.json')),
      'candidate audit must expose guarded formal manifest commands'
    );
    assertTruthy(
      audit.candidates.every((candidate) => candidate.release_preparation_workflow?.expected_release_artifacts?.includes('vision_evidence_policy_correction_patch')),
      'candidate audit must keep VisionEvidence policy review in release preparation workflow'
    );
    assertTruthy(
      audit.candidates.every((candidate) => ['needs_real_source_assets', 'needs_views_or_scale'].includes(candidate.release_stage)),
      'candidate audit must expose blocked release stages for local demos'
    );
    return {
      status: 'candidate_audit_blocked',
      artifacts: {
        dir: path.join(outputDir, 'real-world-building-demo-candidate-audit'),
        report: path.join(outputDir, 'real-world-building-demo-candidate-audit', 'candidate-audit-report.json'),
        markdown: path.join(outputDir, 'real-world-building-demo-candidate-audit', 'candidate-audit-report.md')
      },
      metrics: {
        candidates: audit.summary.candidates,
        release_ready_candidates: audit.summary.release_ready_candidates,
        input_ready_source_packages: audit.summary.input_ready_source_packages,
        release_selectable_candidates: audit.summary.release_selectable_candidates,
        formal_manifest_selectable_candidates: audit.summary.formal_manifest_selectable_candidates,
        useful_structure_review_demos: audit.summary.useful_structure_review_demos,
        best_candidate: audit.summary.best_candidate,
        best_structure_review_candidate: audit.summary.best_structure_review_candidate,
        best_release_work_candidate: audit.summary.best_release_work_candidate,
        best_formal_manifest_candidate: audit.summary.best_formal_manifest_candidate,
        release_gap: audit.release_gap
      }
    };
  });
  cases.push(demoCandidateAuditCase);

  const artifactIntegrityCase = await collectCase('release_gate_artifact_integrity', async () => {
    const integrityDir = path.join(absoluteOutputDir, 'release-gate-artifact-integrity');
    await fs.mkdir(integrityDir, { recursive: true });
    const integrity = await validateReleaseGateArtifactIntegrity(cases);
    await writeJson(path.join(integrityDir, 'artifact-integrity-report.json'), integrity);
    assertEqual(integrity.missing_required_artifacts.length, 0, 'release gate report must not advertise missing required artifacts');
    assertEqual(integrity.unexpected_present_artifacts.length, 0, 'release gate expected-missing artifact markers must not point at present files');
    assertEqual(integrity.failed_contract_checks.length, 0, 'release gate contract drift checks must pass');
    return {
      status: 'artifact_paths_verified',
      artifacts: {
        dir: path.join(outputDir, 'release-gate-artifact-integrity'),
        report: path.join(outputDir, 'release-gate-artifact-integrity', 'artifact-integrity-report.json')
      },
      metrics: {
        checked_artifacts: integrity.checked_artifacts,
        required_artifacts: integrity.required_artifacts,
        expected_missing_artifacts: integrity.expected_missing_artifacts,
        missing_required_artifacts: integrity.missing_required_artifacts.length,
        unexpected_present_artifacts: integrity.unexpected_present_artifacts.length,
        contract_checks: integrity.contract_checks.length,
        failed_contract_checks: integrity.failed_contract_checks.length
      }
    };
  });
  cases.push(artifactIntegrityCase);

  const remainingReleaseGaps = realWorldBuildingManifestCase.metrics?.closes_release_gap === true
    ? []
    : ['real_world_building_positive_release_sample_missing'];
  const hardOk = cases.every((item) => item.ok);
  const report = {
    version: 1,
    kind: 'image_structured_release_gate_report',
    generated_at: new Date().toISOString(),
    ok: hardOk,
    release_ready: hardOk && remainingReleaseGaps.length === 0,
    verdict: hardOk
      ? remainingReleaseGaps.length === 0 ? 'release_candidate' : 'technical_baseline'
      : 'blocked',
    summary: {
      hard_cases: cases.length,
      passed_cases: cases.filter((item) => item.ok).length,
      failed_cases: cases.filter((item) => !item.ok).length,
      release_gaps: remainingReleaseGaps.length
    },
    cases,
    remaining_release_gaps: remainingReleaseGaps
  };
  await writeJson(path.join(absoluteOutputDir, 'release-gate-report.json'), report);
  return report;
}

function makeSyntheticReadyPromotion({ assetSet, candidateGraph, modelingBrief, promotionReview, profile, observationSet = null }) {
  const selectedCandidates = candidateGraph.candidates
    .filter((candidate) => REQUIRED_BUILDING_SINGLE_ROLES.slice(0, 2).includes(candidate.role));
  if (selectedCandidates.length < 2) {
    throw new Error('Synthetic ready promotion needs recessed facade and rectangular duct candidates');
  }
  const selectedIds = new Set(selectedCandidates.map((candidate) => candidate.id));
  const readyAssetSet = cloneJson(assetSet);
  readyAssetSet.gates.reasons = [];
  const readyCandidateGraph = cloneJson(candidateGraph);
  for (const candidate of readyCandidateGraph.candidates) {
    if (!selectedIds.has(candidate.id)) continue;
    candidate.promotion.status = 'review_required';
    candidate.promotion.blockers = [];
  }
  const readyModelingBrief = cloneJson(modelingBrief);
  readyModelingBrief.status = 'ready_for_promotion_review';
  readyModelingBrief.missing_inputs = [];
  readyModelingBrief.blockers = [];
  const readyPromotionReview = withAcceptedDraftingFirstReview({
    ...cloneJson(promotionReview),
    reviewer: 'release-gate synthetic regression',
    verdict: 'accepted_subset',
    promotion_allowed: true,
    compile_allowed: false,
    missing_inputs: [],
    blockers: [],
    profile_confirmation: {
      selected_profile: profile.profile_id,
      status: 'confirmed',
      note: 'Synthetic release gate clears profile routing to exercise promotion application.'
    },
    scale_confirmation: {
      status: 'confirmed',
      known_width: profile.default_scale.width,
      known_depth: profile.default_scale.depth,
      known_height: profile.default_scale.height,
      units: 'mm',
      note: 'Synthetic release gate uses profile dimensions; compiler gate must still validate evidence strength.'
    },
    accepted_candidates: selectedCandidates.map((candidate) => ({
      candidate_id: candidate.id,
      role: candidate.role,
      view: candidate.view,
      source_image: candidate.source_image,
      source_observation_id: candidate.source_observation_id,
      confidence: candidate.confidence,
      promotion_status: 'review_required',
      blockers: [],
      reviewer_note: 'synthetic manual acceptance for release gate'
    })),
    held_candidates: readyCandidateGraph.candidates
      .filter((candidate) => !selectedIds.has(candidate.id))
      .map((candidate) => ({
        candidate_id: candidate.id,
        role: candidate.role,
        view: candidate.view,
        source_image: candidate.source_image,
        source_observation_id: candidate.source_observation_id,
        confidence: candidate.confidence,
        promotion_status: candidate.promotion.status,
        blockers: candidate.promotion.blockers
      }))
  }, { observationSet });
  return {
    assetSet: readyAssetSet,
    candidateGraph: readyCandidateGraph,
    modelingBrief: readyModelingBrief,
    promotionReview: readyPromotionReview,
    selectedCandidates
  };
}

function withAcceptedDraftingFirstReview(promotionReview, { observationSet = null } = {}) {
  return withAcceptedFacadePlaneReview(withAcceptedDraftAndLocalReview(promotionReview, { observationSet }), { observationSet });
}

function withAcceptedDraftAndLocalReview(promotionReview, { observationSet = null } = {}) {
  let nextReview = cloneJson(promotionReview);
  const draftViewGraph = observationSet?.draft_view_graph_v1 || null;
  const objectSurfaceGraph = observationSet?.object_surface_graph_v1 || null;
  const facadePlaneGraph = observationSet?.facade_plane_graph_v1 || null;
  if (nextReview.draft_view_review) {
    const acceptedSlots = (draftViewGraph?.view_slots || []).filter((slot) => slot.status !== 'unknown');
    const acceptedSlotIds = acceptedSlots.map((slot) => slot.slot_id);
    nextReview = {
      ...nextReview,
      draft_view_review: {
        ...nextReview.draft_view_review,
        status: acceptedSlotIds.length ? 'accepted' : nextReview.draft_view_review.status,
        accepted_view_slot_ids: acceptedSlotIds,
        accepted_plane_hypothesis_ids: acceptedSlots.flatMap((slot) => slot.visible_regions || []).map((region) => region.id),
        promotion_allowed: acceptedSlotIds.length > 0,
        blockers: acceptedSlotIds.length ? [] : nextReview.draft_view_review.blockers || ['accepted_draft_view_review_required'],
        reviewer_note: acceptedSlotIds.length
          ? 'Synthetic release gate accepts DraftViewGraph slots before image candidate promotion.'
          : nextReview.draft_view_review.reviewer_note
      }
    };
  }
  if (nextReview.local_detail_review) {
    const surfaces = objectSurfaceGraph?.surfaces || [];
    const details = [
      ...(objectSurfaceGraph?.surface_local_feature_candidates || []),
      ...(facadePlaneGraph?.plane_local_detail_candidates || [])
    ];
    const acceptedSurfaceIds = surfaces.map((surface) => surface.id);
    const acceptedDetailIds = details.map((detail) => detail.id);
    const accepted = acceptedSurfaceIds.length > 0 || acceptedDetailIds.length > 0;
    nextReview = {
      ...nextReview,
      local_detail_review: {
        ...nextReview.local_detail_review,
        status: accepted ? 'accepted' : nextReview.local_detail_review.status,
        accepted_surface_ids: acceptedSurfaceIds,
        accepted_detail_ids: acceptedDetailIds,
        detail_bindings: acceptedDetailIds.map((detailId) => ({
          detail_id: detailId,
          target_surface_id: acceptedSurfaceIds[0] || null,
          target_plane_id: facadePlaneGraph?.planes?.[0]?.id || null,
          status: 'accepted'
        })),
        promotion_allowed: accepted,
        blockers: accepted ? [] : nextReview.local_detail_review.blockers || ['accepted_local_detail_review_required'],
        reviewer_note: accepted
          ? 'Synthetic release gate accepts surface-local and plane-local detail bindings before image candidate promotion.'
          : nextReview.local_detail_review.reviewer_note
      }
    };
  }
  return nextReview;
}

function withAcceptedFacadePlaneReview(promotionReview, { observationSet = null } = {}) {
  const planeIds = (observationSet?.facade_plane_graph_v1?.planes || []).map((plane) => plane.id);
  return {
    ...cloneJson(promotionReview),
    facade_plane_review: {
      source_facade_plane_graph: 'facade-plane-graph.json',
      status: planeIds.length ? 'accepted' : promotionReview.facade_plane_review?.status || 'not_accepted',
      accepted_plane_ids: planeIds,
      promotion_allowed: planeIds.length > 0,
      blockers: planeIds.length ? [] : promotionReview.facade_plane_review?.blockers || ['accepted_facade_plane_review_required'],
      reviewer_note: planeIds.length
        ? 'Synthetic release gate accepts FacadePlaneGraph before image candidate promotion.'
        : promotionReview.facade_plane_review?.reviewer_note || ''
    }
  };
}

function makeAcceptedDocumentReviewRoundtrip({
  assetSet,
  candidateGraph,
  modelingBrief,
  promotionReview,
  observationSet = null,
  documentParseReport,
  profile
}) {
  const selectedCandidate = candidateGraph.candidates.find((candidate) => (
    candidate.role === 'building_main_mass'
    && candidate.source_observation_id === 'cad_document_outline'
  )) || candidateGraph.candidates.find((candidate) => candidate.role === 'building_main_mass');
  if (!selectedCandidate) throw new Error('Document review roundtrip needs a CAD building_main_mass candidate');
  const selectedIds = new Set([selectedCandidate.id]);
  const readyAssetSet = cloneJson(assetSet);
  readyAssetSet.gates.can_compile_geometry = true;
  readyAssetSet.gates.reasons = [];
  const readyCandidateGraph = cloneJson(candidateGraph);
  for (const candidate of readyCandidateGraph.candidates) {
    if (!selectedIds.has(candidate.id)) continue;
    candidate.promotion.status = 'review_required';
    candidate.promotion.blockers = [];
  }
  const readyModelingBrief = cloneJson(modelingBrief);
  readyModelingBrief.status = 'ready_for_promotion_review';
  readyModelingBrief.missing_inputs = [];
  readyModelingBrief.blockers = [];
  const width = Number(documentParseReport?.extracted_geometry?.width_mm) || Number(profile.default_scale?.width) || 1;
  const depth = Number(documentParseReport?.extracted_geometry?.depth_mm) || Number(profile.default_scale?.depth) || 1;
  const height = Number(profile.default_scale?.height) || 1;
  const readyPromotionReview = withAcceptedDraftAndLocalReview({
    ...cloneJson(promotionReview),
    reviewer: 'release-gate document review fixture',
    verdict: 'accepted_subset',
    promotion_allowed: true,
    compile_allowed: false,
    missing_inputs: [],
    blockers: [],
    profile_confirmation: {
      selected_profile: profile.profile_id,
      status: 'confirmed',
      note: 'Document fixture confirms building_single profile for candidate promotion only.'
    },
    scale_confirmation: {
      status: 'confirmed',
      known_width: width,
      known_depth: depth,
      known_height: height,
      units: 'mm',
      note: 'Width/depth come from parsed CAD outline; height still comes from profile default and remains review-gated.'
    },
    accepted_candidates: [{
      candidate_id: selectedCandidate.id,
      role: selectedCandidate.role,
      view: selectedCandidate.view,
      source_image: selectedCandidate.source_image,
      source_observation_id: selectedCandidate.source_observation_id,
      confidence: selectedCandidate.confidence,
      promotion_status: 'review_required',
      blockers: [],
      reviewer_note: 'accepted CAD top outline as main mass candidate for release-gate roundtrip fixture'
    }],
    held_candidates: readyCandidateGraph.candidates
      .filter((candidate) => !selectedIds.has(candidate.id))
      .map((candidate) => ({
        candidate_id: candidate.id,
        role: candidate.role,
        view: candidate.view,
        source_image: candidate.source_image,
        source_observation_id: candidate.source_observation_id,
        confidence: candidate.confidence,
        promotion_status: candidate.promotion.status,
        blockers: candidate.promotion.blockers
      })),
    notes: 'Fixture proves review JSON can roundtrip into PartGraph promotion without bypassing compiler QA.'
  }, { observationSet });
  return {
    assetSet: readyAssetSet,
    candidateGraph: readyCandidateGraph,
    modelingBrief: readyModelingBrief,
    promotionReview: readyPromotionReview,
    selectedCandidates: [selectedCandidate]
  };
}

function makeBlockedImageSelectionReview({ candidateGraph, promotionReview }) {
  const selectedCandidates = candidateGraph.candidates
    .filter((candidate) => ['visible_plane_recessed_left', 'rectangular_utility_ducts'].includes(candidate.role))
    .slice(0, 2);
  if (selectedCandidates.length < 2) {
    throw new Error('Blocked image selection review needs recessed facade and rectangular duct candidates');
  }
  const selectedIds = new Set(selectedCandidates.map((candidate) => candidate.id));
  const nextReview = {
    ...cloneJson(promotionReview),
    reviewer: 'release-gate blocked matrix regression',
    verdict: 'blocked',
    promotion_allowed: false,
    compile_allowed: false,
    accepted_candidates: selectedCandidates.map((candidate) => ({
      candidate_id: candidate.id,
      role: candidate.role,
      view: candidate.view,
      source_image: candidate.source_image,
      source_observation_id: candidate.source_observation_id,
      confidence: candidate.confidence,
      promotion_status: candidate.promotion.status,
      blockers: candidate.promotion.blockers,
      reviewer_note: 'selected but blockers intentionally not cleared for blocked roundtrip regression'
    })),
    held_candidates: candidateGraph.candidates
      .filter((candidate) => !selectedIds.has(candidate.id))
      .map((candidate) => ({
        candidate_id: candidate.id,
        role: candidate.role,
        view: candidate.view,
        source_image: candidate.source_image,
        source_observation_id: candidate.source_observation_id,
        confidence: candidate.confidence,
        promotion_status: candidate.promotion.status,
        blockers: candidate.promotion.blockers
      })),
    notes: 'Blocked matrix case proves selected candidates cannot become PartGraph edits until blockers are cleared.'
  };
  return {
    promotionReview: nextReview,
    selectedCandidates
  };
}

async function collectCase(id, runner) {
  try {
    const result = await runner();
    return {
      id,
      ok: result.ok !== false,
      status: result.status,
      artifacts: result.artifacts || {},
      metrics: result.metrics || {},
      ...(result.error ? { error: result.error } : {}),
      ...(result.context ? { context: result.context } : {})
    };
  } catch (error) {
    return {
      id,
      ok: false,
      status: 'failed',
      artifacts: {},
      metrics: {},
      error: error.stack || error.message
    };
  }
}

function stripContext(item) {
  const { context, ...rest } = item;
  return rest;
}

async function chooseBuildingSingleInput() {
  if (await pathExists(resolveRepo(USER_BUILDING_SINGLE_INPUT))) return USER_BUILDING_SINGLE_INPUT;
  return CANONICAL_SINGLE_INPUT;
}

function artifactsFor(relativeDir) {
  return {
    dir: relativeDir,
    intake_summary: path.join(relativeDir, 'intake-summary.json'),
    asset_set: path.join(relativeDir, 'asset-set.json'),
    observations: path.join(relativeDir, 'observations.json'),
    candidate_graph: path.join(relativeDir, 'candidate-graph.json'),
    modeling_brief: path.join(relativeDir, 'modeling-brief.json'),
    mcp_modeling_brief: path.join(relativeDir, 'mcp-modeling-brief.json'),
    mcp_modeling_brief_markdown: path.join(relativeDir, 'mcp-modeling-brief.md'),
    promotion_review: path.join(relativeDir, 'candidate-promotion-review.draft.json'),
    promotion_patch: path.join(relativeDir, 'candidate-promotion-patch.blocked.json')
  };
}

async function validateReleaseGateArtifactIntegrity(cases) {
  const entries = [];
  for (const testCase of cases) {
    collectArtifactEntries({
      value: testCase.artifacts,
      caseId: testCase.id,
      keyPath: 'artifacts',
      entries
    });
  }
  const checked = [];
  for (const entry of entries) {
    const exists = await pathExists(resolveRepo(entry.path));
    checked.push({ ...entry, exists });
  }
  const missingRequired = checked.filter((entry) => entry.required && !entry.exists);
  const unexpectedPresent = checked.filter((entry) => entry.expected_missing && entry.exists);
  const contractChecks = await validateReleaseContractDriftChecks();
  const failedContractChecks = contractChecks.filter((check) => check.status === 'fail');
  return {
    version: 1,
    kind: 'release_gate_artifact_integrity_report',
    checked_artifacts: checked.length,
    required_artifacts: checked.filter((entry) => entry.required).length,
    expected_missing_artifacts: checked.filter((entry) => entry.expected_missing).length,
    missing_required_artifacts: missingRequired,
    unexpected_present_artifacts: unexpectedPresent,
    contract_checks: contractChecks,
    failed_contract_checks: failedContractChecks,
    artifacts: checked
  };
}

async function validateReleaseContractDriftChecks() {
  const pkg = await readJson(resolveRepo('package.json'));
  const results = [];
  for (const spec of RELEASE_CONTRACT_DRIFT_CHECKS) {
    if (spec.kind === 'path_exists') {
      const exists = await pathExists(resolveRepo(spec.path));
      results.push({
        id: spec.id,
        kind: spec.kind,
        status: exists ? 'pass' : 'fail',
        path: spec.path
      });
    } else if (spec.kind === 'file_contains') {
      const contains = await fileContains(resolveRepo(spec.path), spec.token);
      results.push({
        id: spec.id,
        kind: spec.kind,
        status: contains ? 'pass' : 'fail',
        path: spec.path,
        token: spec.token
      });
    } else if (spec.kind === 'package_script_contains') {
      const script = pkg.scripts?.[spec.script] || '';
      results.push({
        id: spec.id,
        kind: spec.kind,
        status: script.includes(spec.token) ? 'pass' : 'fail',
        script: spec.script,
        token: spec.token
      });
    } else if (spec.kind === 'json_schema_defs') {
      const result = await schemaDefsCheck(resolveRepo(spec.path), spec.defs || []);
      results.push({
        id: spec.id,
        kind: spec.kind,
        status: result.ok ? 'pass' : 'fail',
        path: spec.path,
        defs: spec.defs || [],
        missing_defs: result.missingDefs,
        unresolved_refs: result.unresolvedRefs
      });
    } else if (spec.kind === 'json_schema_refs_resolvable') {
      const result = await schemaRefsResolvableCheck(resolveRepo(spec.path));
      results.push({
        id: spec.id,
        kind: spec.kind,
        status: result.ok ? 'pass' : 'fail',
        path: spec.path,
        checked_schemas: result.checkedSchemas,
        unresolved_refs: result.unresolvedRefs
      });
    } else {
      results.push({
        id: spec.id,
        kind: spec.kind,
        status: 'fail',
        error: `Unknown contract drift check kind: ${spec.kind}`
      });
    }
  }
  return results;
}

async function schemaDefsCheck(filePath, requiredDefs = []) {
  try {
    const schema = await readJson(filePath);
    const defs = schema.$defs || {};
    const missingDefs = requiredDefs.filter((name) => !defs[name]);
    const refs = Array.from(JSON.stringify(schema).matchAll(/#\/\$defs\/([^"']+)/g))
      .map((match) => match[1].split(/[~/]/)[0]);
    const unresolvedRefs = Array.from(new Set(refs)).filter((name) => !defs[name]);
    return {
      ok: missingDefs.length === 0 && unresolvedRefs.length === 0,
      missingDefs,
      unresolvedRefs
    };
  } catch (error) {
    return {
      ok: false,
      missingDefs: requiredDefs,
      unresolvedRefs: [`schema_read_failed:${error.message}`]
    };
  }
}

async function schemaRefsResolvableCheck(schemaDir) {
  try {
    const entries = await fs.readdir(schemaDir);
    const schemaFiles = entries
      .filter((entry) => entry.endsWith('.json'))
      .sort();
    const unresolvedRefs = [];
    for (const fileName of schemaFiles) {
      const schema = await readJson(path.join(schemaDir, fileName));
      for (const ref of collectSchemaRefs(schema)) {
        if (!ref.startsWith('#/')) continue;
        if (resolveJsonPointer(schema, ref) === undefined) unresolvedRefs.push(`${fileName}:${ref}`);
      }
    }
    return {
      ok: unresolvedRefs.length === 0,
      checkedSchemas: schemaFiles.length,
      unresolvedRefs
    };
  } catch (error) {
    return {
      ok: false,
      checkedSchemas: 0,
      unresolvedRefs: [`schema_ref_scan_failed:${error.message}`]
    };
  }
}

function collectSchemaRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, refs);
    return refs;
  }
  if (!value || typeof value !== 'object') return refs;
  if (typeof value.$ref === 'string') refs.push(value.$ref);
  for (const item of Object.values(value)) collectSchemaRefs(item, refs);
  return refs;
}

function resolveJsonPointer(root, ref) {
  if (!ref.startsWith('#/')) return undefined;
  return ref.slice(2)
    .split('/')
    .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, key) => current?.[key], root);
}

async function fileContains(filePath, token) {
  try {
    return (await fs.readFile(filePath, 'utf8')).includes(token);
  } catch {
    return false;
  }
}

function collectArtifactEntries({ value, caseId, keyPath, entries }) {
  if (!value) return;
  if (typeof value === 'string') {
    entries.push({
      case_id: caseId,
      key: keyPath,
      path: value,
      required: true,
      expected_missing: false
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectArtifactEntries({
      value: item,
      caseId,
      keyPath: `${keyPath}[${index}]`,
      entries
    }));
    return;
  }
  if (typeof value !== 'object') return;
  if (typeof value.path === 'string') {
    const expectedMissing = value.expected_missing === true;
    entries.push({
      case_id: caseId,
      key: keyPath,
      path: value.path,
      required: value.required !== false && !expectedMissing,
      expected_missing: expectedMissing
    });
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    collectArtifactEntries({
      value: child,
      caseId,
      keyPath: `${keyPath}.${key}`,
      entries
    });
  }
}

function captureError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
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

function assertSemanticReviewItemHasEvidenceInstance(patch, role, message) {
  const item = (patch?.review_items || []).find((reviewItem) => reviewItem.id === `semantic_candidate:${role}`);
  assertTruthy(item, `${message}: missing review item`);
  const instances = item.current_value?.evidence_instances || [];
  assertTruthy(instances.length > 0, `${message}: missing evidence instances`);
  assertTruthy(
    instances.some((instance) => Array.isArray(instance.bbox_px) && instance.bbox_px.length === 4 && instance.bbox_px.every((value) => Number.isFinite(value))),
    `${message}: missing bbox_px`
  );
  assertTruthy(instances.some((instance) => instance.source_image && instance.source_id), `${message}: missing source provenance`);
  assertTruthy(instances.some((instance) => instance.view && instance.view !== 'unknown'), `${message}: missing view label`);
  assertTruthy(instances.every((instance) => instance.review_required === true), `${message}: semantic instances should remain review-required`);
}

function assertVisionEvidenceWorkspaceInstance(visionEvidence, role, message) {
  assertTruthy(hasVisionEvidenceWorkspaceInstance(visionEvidence, role), message);
}

function hasVisionEvidenceWorkspaceInstance(visionEvidence, role) {
  return (visionEvidence?.semantic_evidence_instances || []).some((instance) => {
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

function hasVisionEvidenceModelingHandoff(visionEvidence, role, blockedInterpretation) {
  return (visionEvidence?.modeling_handoff || []).some((item) => {
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

function assertMatch(value, pattern, message) {
  if (!pattern.test(String(value))) throw new Error(`${message}: ${JSON.stringify(value)} does not match ${pattern}`);
}

function countBy(items, key) {
  const result = {};
  for (const item of items || []) {
    const value = item[key] || 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function operationCounts(operations) {
  return countBy(operations || [], 'op');
}

function sourceImagesForPartGraph(partGraph) {
  const sources = new Set(partGraph.evidence_graph?.source_images || []);
  for (const part of partGraph.parts || []) {
    for (const source of part.evidence_sources || []) {
      if (source.source_image) sources.add(source.source_image);
    }
    for (const sourceImage of part.source_images || []) {
      if (sourceImage) sources.add(sourceImage);
    }
  }
  return Array.from(sources).filter(Boolean).sort();
}

function sourceImagesForObservationSet(observationSet) {
  const sources = new Set(observationSet.object?.source_images || []);
  for (const image of observationSet.images || []) {
    if (image.image?.path) sources.add(image.image.path);
    for (const observation of image.observations || []) {
      if (observation.source_image) sources.add(observation.source_image);
    }
  }
  return Array.from(sources).filter(Boolean).sort();
}

function viewsForObservationSet(observationSet) {
  const views = new Set(observationSet.views_detected || []);
  for (const image of observationSet.images || []) {
    if (image.detected_view?.kind) views.add(image.detected_view.kind);
  }
  return Array.from(views).filter(Boolean).sort();
}

function warningErrors(report) {
  return Number(report.snapshot_summary?.warning_summary?.by_severity?.error || 0);
}

async function runReviewUiBrowserRoundtrip({
  ...options
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runReviewUiBrowserRoundtripOnce({ ...options, attempt });
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

async function runReviewUiBrowserRoundtripOnce({
  reviewHtmlPath,
  outputDir,
  candidateIds,
  knownScale,
  reviewer,
  notes,
  confirmProfile = true,
  confirmScale = true,
  resolveMissingInputs = true,
  resolveCandidateBlockers = true,
  acceptDraftViewReview = true,
  acceptLocalDetailReview = true,
  acceptFacadePlaneReview = true,
  attempt = 1
}) {
  const chromePath = await findChromeExecutable();
  if (!chromePath) throw new Error('Chrome executable not found for browser UI roundtrip');
  const chromeProfileDir = path.join(outputDir, `chrome-profile-${attempt}`);
  await fs.rm(chromeProfileDir, { recursive: true, force: true });
  await fs.mkdir(chromeProfileDir, { recursive: true });
  const reviewUrl = pathToFileURL(reviewHtmlPath).href;
  let chromeStderr = '';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    `--user-data-dir=${chromeProfileDir}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    reviewUrl
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const chromeWatchdog = setTimeout(() => {
    if (chrome.exitCode === null && !chrome.signalCode) {
      try {
        chrome.kill('SIGKILL');
      } catch {
        // The process may already be gone.
      }
    }
  }, 90000);
  chromeWatchdog.unref?.();
  chrome.stderr?.setEncoding('utf8');
  chrome.stderr?.on('data', (chunk) => {
    chromeStderr = `${chromeStderr}${chunk}`.slice(-4000);
  });
  try {
    const devTools = await waitForDevToolsPort(chromeProfileDir, chrome, () => chromeStderr);
    const browserCdp = await connectCdp(devTools.browserWebSocketUrl);
    try {
      const target = await createChromePageTargetViaCdp(browserCdp, 'review/index.html');
      const attached = await browserCdp.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true
      });
      const cdp = browserCdp.withSession(attached.sessionId);
      await cdp.send('Runtime.enable');
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url: reviewUrl });
      await waitForReviewWorkbenchReady(cdp);
      const reviewText = await evaluateReviewWorkbenchExport(cdp, {
        candidateIds,
        knownScale,
        reviewer,
        notes,
        confirmProfile,
        confirmScale,
        resolveMissingInputs,
        resolveCandidateBlockers,
        acceptDraftViewReview,
        acceptLocalDetailReview,
        acceptFacadePlaneReview
      });
      const promotionReview = JSON.parse(reviewText);
      await writeJson(path.join(outputDir, 'candidate-promotion-review.browser-exported.json'), promotionReview);
      await browserCdp.send('Browser.close', {}, { timeoutMs: 1000 }).catch(() => {});
      return {
        browser: 'chrome-cdp-headless',
        promotionReview
      };
    } finally {
      await browserCdp.close();
    }
  } finally {
    clearTimeout(chromeWatchdog);
    const chromeExited = chrome.exitCode !== null || chrome.signalCode
      ? Promise.resolve()
      : new Promise((resolve) => chrome.once('exit', resolve));
    if (!chrome.killed) chrome.kill('SIGTERM');
    await Promise.race([chromeExited, sleep(1000)]);
    if (chrome.exitCode === null && !chrome.signalCode) {
      try {
        chrome.kill('SIGKILL');
      } catch {
        // The process may have exited between checks.
      }
      await Promise.race([chromeExited, sleep(1000)]);
    }
    await killChromeProcessesForProfile(chromeProfileDir);
    await fs.rm(chromeProfileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  }
}

async function runVisionEvidenceReviewUiBrowserRoundtrip({
  ...options
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runVisionEvidenceReviewUiBrowserRoundtripOnce({ ...options, attempt });
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

async function runVisionEvidenceReviewUiBrowserRoundtripOnce({
  reviewHtmlPath,
  outputDir,
  reviewer,
  acceptedAt,
  notes,
  acceptAll = true,
  attempt = 1
}) {
  const chromePath = await findChromeExecutable();
  if (!chromePath) throw new Error('Chrome executable not found for VisionEvidence browser UI roundtrip');
  const chromeProfileDir = path.join(outputDir, `chrome-profile-vision-${attempt}`);
  await fs.rm(chromeProfileDir, { recursive: true, force: true });
  await fs.mkdir(chromeProfileDir, { recursive: true });
  const reviewUrl = pathToFileURL(reviewHtmlPath).href;
  let chromeStderr = '';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    `--user-data-dir=${chromeProfileDir}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    reviewUrl
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const chromeWatchdog = setTimeout(() => {
    if (chrome.exitCode === null && !chrome.signalCode) {
      try {
        chrome.kill('SIGKILL');
      } catch {
        // The process may already be gone.
      }
    }
  }, 90000);
  chromeWatchdog.unref?.();
  chrome.stderr?.setEncoding('utf8');
  chrome.stderr?.on('data', (chunk) => {
    chromeStderr = `${chromeStderr}${chunk}`.slice(-4000);
  });
  try {
    const devTools = await waitForDevToolsPort(chromeProfileDir, chrome, () => chromeStderr);
    const browserCdp = await connectCdp(devTools.browserWebSocketUrl);
    try {
      const target = await createChromePageTargetViaCdp(browserCdp, 'vision-evidence-review/index.html');
      const attached = await browserCdp.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true
      });
      const cdp = browserCdp.withSession(attached.sessionId);
      await cdp.send('Runtime.enable');
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url: reviewUrl });
      await waitForVisionEvidenceReviewWorkbenchReady(cdp);
      const reviewText = await evaluateVisionEvidenceReviewWorkbenchExport(cdp, {
        reviewer,
        acceptedAt,
        notes,
        acceptAll
      });
      const reviewDecision = JSON.parse(reviewText);
      await writeJson(path.join(outputDir, 'vision-evidence-review.browser-exported.json'), reviewDecision);
      await browserCdp.send('Browser.close', {}, { timeoutMs: 1000 }).catch(() => {});
      return {
        browser: 'chrome-cdp-headless',
        reviewDecision
      };
    } finally {
      await browserCdp.close();
    }
  } finally {
    clearTimeout(chromeWatchdog);
    const chromeExited = chrome.exitCode !== null || chrome.signalCode
      ? Promise.resolve()
      : new Promise((resolve) => chrome.once('exit', resolve));
    if (!chrome.killed) chrome.kill('SIGTERM');
    await Promise.race([chromeExited, sleep(1000)]);
    if (chrome.exitCode === null && !chrome.signalCode) {
      try {
        chrome.kill('SIGKILL');
      } catch {
        // The process may have exited between checks.
      }
      await Promise.race([chromeExited, sleep(1000)]);
    }
    await killChromeProcessesForProfile(chromeProfileDir);
    await fs.rm(chromeProfileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  }
}

async function killChromeProcessesForProfile(chromeProfileDir) {
  const needle = `--user-data-dir=${chromeProfileDir}`;
  const ps = spawn('ps', ['-axo', 'pid=,command='], { stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  ps.stdout?.setEncoding('utf8');
  ps.stdout?.on('data', (chunk) => {
    output = `${output}${chunk}`;
  });
  await new Promise((resolve) => ps.once('close', resolve));
  const pids = output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match || !match[2].includes(needle)) return null;
      return Number(match[1]);
    })
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  if (!pids.length) return;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may already be gone.
    }
  }
  await sleep(500);
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process may already be gone.
    }
  }
}

async function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function waitForDevToolsPort(chromeProfileDir, chrome, stderrText) {
  const portFile = path.join(chromeProfileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null || chrome.signalCode) {
      throw new Error(`Chrome exited before DevTools port was ready: exitCode=${chrome.exitCode}, signal=${chrome.signalCode}, stderr=${stderrText() || 'none'}`);
    }
    try {
      const text = await fs.readFile(portFile, 'utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0 && lines[1]) {
        const browserPath = lines[1].startsWith('/') ? lines[1] : `/${lines[1]}`;
        return {
          port,
          browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}`
        };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await sleep(100);
  }
  throw new Error(`Chrome DevToolsActivePort not ready: stderr=${stderrText() || 'none'}`);
}

async function waitForChromePageTargetViaCdp(browserCdp, urlNeedle) {
  const deadline = Date.now() + 45000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await browserCdp.send('Target.getTargets');
      const target = (response.targetInfos || []).find((item) => {
        if (item.type !== 'page') return false;
        const decodedUrl = safeDecodeURIComponent(item.url || '');
        return item.url.includes(urlNeedle) || decodedUrl.includes(urlNeedle);
      });
      if (target?.targetId) return target;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Chrome page target not ready through CDP for ${urlNeedle}: ${lastError?.message || 'timeout'}`);
}

async function createChromePageTargetViaCdp(browserCdp, fallbackNeedle = 'review/index.html') {
  try {
    const response = await browserCdp.send('Target.createTarget', { url: 'about:blank' });
    if (response.targetId) return { targetId: response.targetId };
  } catch {
    // Fall back to the page Chrome opened from the command line.
  }
  return waitForChromePageTargetViaCdp(browserCdp, fallbackNeedle);
}

async function connectCdp(webSocketUrl, { openTimeoutMs = 45000 } = {}) {
  return await new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') {
      reject(new Error('Global WebSocket is not available for Chrome CDP browser UI roundtrip'));
      return;
    }
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 1;
    let opened = false;
    let settled = false;
    let closed = false;
    const closeWaiters = [];
    const rejectOpen = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(openTimer);
      reject(error);
    };
    const rejectPending = (error) => {
      for (const callbacks of pending.values()) callbacks.reject(error);
      pending.clear();
    };
    const notifyClosed = () => {
      while (closeWaiters.length) closeWaiters.shift()();
    };
    const openTimer = setTimeout(() => {
      if (opened) return;
      rejectOpen(new Error(`CDP WebSocket open timed out after ${openTimeoutMs}ms`));
      try {
        socket.close();
      } catch {
        // Ignore close failures while rejecting the open timeout.
      }
    }, openTimeoutMs);
    socket.addEventListener('open', () => {
      if (settled) return;
      opened = true;
      settled = true;
      clearTimeout(openTimer);
      resolve({
        send(method, params = {}, { timeoutMs = 10000, sessionId = null } = {}) {
          if (closed) return Promise.reject(new Error(`CDP socket is closed before command: ${method}`));
          const id = nextId++;
          return new Promise((innerResolve, innerReject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              innerReject(new Error(`CDP command timed out: ${method}`));
            }, timeoutMs);
            timer.unref?.();
            pending.set(id, {
              resolve: (value) => {
                clearTimeout(timer);
                innerResolve(value);
              },
              reject: (error) => {
                clearTimeout(timer);
                innerReject(error);
              }
            });
            try {
              socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
            } catch (error) {
              pending.delete(id);
              clearTimeout(timer);
              innerReject(error);
            }
          });
        },
        withSession(sessionId) {
          return {
            send: (method, params = {}, options = {}) => this.send(method, params, { ...options, sessionId }),
            close: () => {}
          };
        },
        async close() {
          if (closed) return;
          try {
            socket.close();
          } catch {
            // Ignore close failures during cleanup.
          }
          await new Promise((innerResolve) => {
            const timer = setTimeout(innerResolve, 1000);
            timer.unref?.();
            closeWaiters.push(() => {
              clearTimeout(timer);
              innerResolve();
            });
          });
        }
      });
    });
    socket.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string' ? event.data : String(event.data);
      const message = JSON.parse(payload);
      if (!message.id || !pending.has(message.id)) return;
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else callbacks.resolve(message.result || {});
    });
    socket.addEventListener('error', (event) => {
      const error = new Error(event.message || 'CDP WebSocket error');
      if (!opened) rejectOpen(error);
      rejectPending(error);
    });
    socket.addEventListener('close', () => {
      closed = true;
      const error = new Error('CDP WebSocket closed');
      if (!opened) rejectOpen(error);
      rejectPending(error);
      notifyClosed();
    });
  });
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function waitForReviewWorkbenchReady(cdp, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const ready = await cdp.send('Runtime.evaluate', {
        expression: '({ readyState: document.readyState, hasExportNode: Boolean(document.getElementById("accepted-candidates-json")), href: location.href })',
        returnByValue: true
      });
      lastState = ready.result?.value || null;
      if (lastState?.readyState !== 'loading' && lastState?.hasExportNode === true) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Review workbench did not become ready: lastState=${JSON.stringify(lastState)}, lastError=${lastError?.message || 'none'}`);
}

async function waitForVisionEvidenceReviewWorkbenchReady(cdp, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const ready = await cdp.send('Runtime.evaluate', {
        expression: '({ readyState: document.readyState, hasExportNode: Boolean(document.getElementById("vision-evidence-review-decision-json")), hasPatchData: Boolean(document.getElementById("vision-evidence-review-patch-data")), href: location.href })',
        returnByValue: true
      });
      lastState = ready.result?.value || null;
      if (lastState?.readyState !== 'loading' && lastState?.hasExportNode === true && lastState?.hasPatchData === true) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`VisionEvidence review workbench did not become ready: lastState=${JSON.stringify(lastState)}, lastError=${lastError?.message || 'none'}`);
}

async function evaluateReviewWorkbenchExport(cdp, {
  candidateIds,
  knownScale,
  reviewer,
  notes,
  confirmProfile,
  confirmScale,
  resolveMissingInputs,
  resolveCandidateBlockers,
  acceptDraftViewReview,
  acceptLocalDetailReview,
  acceptFacadePlaneReview
}) {
  const normalizedScale = knownScale || {};
  const expression = `(() => {
    const candidateIds = ${JSON.stringify(candidateIds)};
    const knownScale = ${JSON.stringify(normalizedScale)};
    const reviewer = ${JSON.stringify(reviewer)};
    const notes = ${JSON.stringify(notes)};
    const confirmProfile = ${JSON.stringify(confirmProfile)};
    const confirmScale = ${JSON.stringify(confirmScale)};
    const resolveMissingInputs = ${JSON.stringify(resolveMissingInputs)};
    const resolveCandidateBlockers = ${JSON.stringify(resolveCandidateBlockers)};
    const acceptDraftViewReview = ${JSON.stringify(acceptDraftViewReview)};
    const acceptLocalDetailReview = ${JSON.stringify(acceptLocalDetailReview)};
    const acceptFacadePlaneReview = ${JSON.stringify(acceptFacadePlaneReview)};
    const requireNode = (id) => {
      const node = document.getElementById(id);
      if (!node) throw new Error('Missing review UI node: ' + id);
      return node;
    };
    const setValue = (id, value) => {
      const node = requireNode(id);
      node.value = String(value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setChecked = (id, checked = true) => {
      const node = requireNode(id);
      node.checked = checked;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setCheckedIfPresent = (id, checked = true) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.checked = checked;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const input of document.querySelectorAll('.candidate-select')) input.checked = false;
    for (const candidateId of candidateIds) {
      const input = Array.from(document.querySelectorAll('.candidate-select'))
        .find((item) => item.dataset.candidateId === candidateId);
      if (!input) throw new Error('Candidate checkbox not found: ' + candidateId);
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setValue('reviewer-name', reviewer);
    setValue('known-width', knownScale.width ?? '');
    setValue('known-depth', knownScale.depth ?? '');
    setValue('known-height', knownScale.height ?? '');
    setValue('review-notes', notes);
    setChecked('confirm-profile', confirmProfile);
    setChecked('confirm-scale', confirmScale);
    setChecked('resolve-missing-inputs', resolveMissingInputs);
    setChecked('resolve-candidate-blockers', resolveCandidateBlockers);
    setCheckedIfPresent('accept-draft-view-review', acceptDraftViewReview);
    setCheckedIfPresent('accept-local-detail-review', acceptLocalDetailReview);
    setCheckedIfPresent('accept-facade-plane-review', acceptFacadePlaneReview);
    requireNode('refresh-promotion-review').click();
    return requireNode('accepted-candidates-json').value;
  })()`;
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Review UI evaluation failed');
  }
  return result.result?.value || '';
}

async function evaluateVisionEvidenceReviewWorkbenchExport(cdp, {
  reviewer,
  acceptedAt,
  notes,
  acceptAll
}) {
  const expression = `(() => {
    const reviewer = ${JSON.stringify(reviewer)};
    const acceptedAt = ${JSON.stringify(acceptedAt)};
    const notes = ${JSON.stringify(notes)};
    const acceptAll = ${JSON.stringify(acceptAll)};
    const requireNode = (id) => {
      const node = document.getElementById(id);
      if (!node) throw new Error('Missing VisionEvidence review UI node: ' + id);
      return node;
    };
    const setValue = (id, value) => {
      const node = requireNode(id);
      node.value = String(value);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue('vision-reviewer-name', reviewer);
    setValue('vision-accepted-at', acceptedAt);
    setValue('vision-review-notes', notes);
    for (const input of document.querySelectorAll('.vision-review-item-select')) {
      input.checked = acceptAll;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    requireNode('refresh-vision-evidence-review').click();
    return requireNode('vision-evidence-review-decision-json').value;
  })()`;
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'VisionEvidence review UI evaluation failed');
  }
  return result.result?.value || '';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveRepo(relativeOrAbsolute) {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.resolve(repoRoot, relativeOrAbsolute);
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

async function readOptionalText(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeDistinctImageVariant(sourcePath, outputPath, variantIndex) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(sourcePath)
    .modulate({
      brightness: 1 + (variantIndex * 0.01),
      saturation: 1 + (variantIndex * 0.005)
    })
    .png()
    .toFile(outputPath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    buildingSingleInput: null,
    writeOverlays: true,
    requireReleaseReady: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--building-single-input') options.buildingSingleInput = argv[++index];
    else if (arg === '--no-overlays') options.writeOverlays = false;
    else if (arg === '--require-release-ready') options.requireReleaseReady = true;
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
  node projects/image-structured-modeler/scripts/run-release-gate.mjs \\
    --output-dir output/image-structured-modeler/release-gate

Options:
  --building-single-input <path>  Override building single demo input.
  --no-overlays                  Skip review overlay images for faster CI checks.
  --require-release-ready         Exit non-zero while remaining_release_gaps is non-empty.
`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = parseArgs(process.argv.slice(2));
  runImageStructuredReleaseGate(options).then((report) => {
    process.stdout.write(`${JSON.stringify({
      ok: report.ok,
      release_ready: report.release_ready,
      verdict: report.verdict,
      output: path.resolve(repoRoot, options.outputDir, 'release-gate-report.json'),
      remaining_release_gaps: report.remaining_release_gaps
    }, null, 2)}\n`);
    if (!report.ok || (options.requireReleaseReady && !report.release_ready)) process.exit(1);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
