import { generatedSourcePathMarkers } from './real-world-building-release-sample.mjs';

export const REQUIRED_BUILDING_SINGLE_SOURCE_ROLES = [
  'visible_plane_primary',
  'visible_plane_recessed_left',
  'rectangular_utility_ducts',
  'shadow_or_recess_boundary',
  'upper_window_bands',
  'exterior_hvac_units',
  'ground_floor_storefront'
];

export function assessRealWorldBuildingSourcePackage({
  assetSet,
  observationSet,
  candidateGraph,
  checklist = null,
  generatedAt = new Date().toISOString()
} = {}) {
  const profile = observationSet?.object?.profile || assetSet?.profile_routing?.selected_profile || 'unknown_object';
  const assets = assetSet?.assets || [];
  const mediaTypes = Array.from(new Set(assets.map((asset) => asset.media_type || 'unknown'))).sort();
  const presentViews = Array.from(new Set(observationSet?.views_detected || []))
    .filter((view) => view && view !== 'unknown')
    .sort();
  const requiredViews = requiredViewsForProfile(profile);
  const missingViews = requiredViews.filter((view) => !presentViews.includes(view));
  const viewEvidence = viewSourceEvidence({ assets, requiredViews, presentViews });
  const semanticRequiredRoles = requiredSemanticRolesForProfile(profile);
  const roleCounts = countBy(candidateGraph?.candidates || [], 'role');
  const roleEvidence = semanticRoleEvidence({
    candidates: candidateGraph?.candidates || [],
    requiredRoles: semanticRequiredRoles
  });
  const semanticEvidenceQuality = semanticEvidenceQualitySummary(roleEvidence);
  const semanticCoveredRoles = semanticRequiredRoles.filter((role) => (roleCounts[role] || 0) > 0);
  const semanticMissingRoles = semanticRequiredRoles.filter((role) => !semanticCoveredRoles.includes(role));
  const generatedOrScaffoldAssets = assets
    .map((asset) => ({
      path: asset.path,
      markers: generatedSourcePathMarkers(asset.path)
    }))
    .filter((item) => item.markers.length > 0);
  const unsupportedAssets = assets.filter((asset) => !['image', 'pdf', 'cad'].includes(asset.media_type));
  const duplicateContentAssets = duplicateSourceContentGroups(assets.filter((asset) => ['image', 'pdf', 'cad'].includes(asset.media_type)));
  const scaleConfidence = Number(observationSet?.scale_calibration?.confidence || 0);
  const scaleCalibration = observationSet?.scale_calibration || {};

  const sourceBlockers = [];
  if (assets.length === 0) sourceBlockers.push('missing_source_assets');
  if (generatedOrScaffoldAssets.length > 0) sourceBlockers.push('source_assets_generated_or_scaffold');
  if (unsupportedAssets.length > 0) sourceBlockers.push('unsupported_source_asset_type');
  if (duplicateContentAssets.length > 0) sourceBlockers.push('duplicate_source_assets');

  const viewBlockers = missingViews.map((view) => `missing_${view}_view`);
  const scaleBlockers = scaleConfidence >= 0.7 ? [] : ['scale_confidence_below_publish_gate'];
  const semanticBlockers = semanticMissingRoles.map((role) => `missing_semantic_role_${role}`);
  const checklistBlockers = checklist?.blockers || [];
  const releaseChecklistSummary = summarizeReleaseChecklist(checklist);
  const blockers = Array.from(new Set([
    ...sourceBlockers,
    ...viewBlockers,
    ...scaleBlockers,
    ...semanticBlockers,
    ...checklistBlockers.map((blocker) => `release_${blocker}`)
  ]));
  const sourceStatus = sourceBlockers.length === 0 ? 'pass' : 'fail';
  const viewStatus = requiredViews.length > 0 && missingViews.length === 0 ? 'pass' : 'fail';
  const scaleStatus = scaleBlockers.length === 0 ? 'pass' : 'fail';
  const semanticStatus = semanticRequiredRoles.length === 0
    ? 'review'
    : semanticMissingRoles.length === 0 ? 'pass' : 'fail';
  const inputReadyForReleaseWork = sourceStatus === 'pass'
    && viewStatus === 'pass'
    && scaleStatus === 'pass'
    && semanticStatus === 'pass';
  const sourceRequest = buildSourceRequest({
    profile,
    sourceStatus,
    viewStatus,
    scaleStatus,
    semanticStatus,
    sourceBlockers,
    missingViews,
    scaleBlockers,
    semanticMissingRoles,
    semanticEvidenceQuality,
    scaleConfidence,
    checklist
  });

  return {
    version: 1,
    kind: 'real_world_building_source_package_assessment',
    generated_at: generatedAt,
    asset_set_id: assetSet?.id || 'unknown',
    profile_id: profile,
    status: sourcePackageStatus({
      profile,
      sourceStatus,
      viewStatus,
      scaleStatus,
      semanticStatus
    }),
    input_ready_for_release_work: inputReadyForReleaseWork,
    release_ready: inputReadyForReleaseWork && checklist?.release_ready === true,
    source_authenticity: {
      status: sourceStatus,
      asset_count: assets.length,
      media_types: mediaTypes,
      generated_or_scaffold_assets: generatedOrScaffoldAssets,
      unsupported_assets: unsupportedAssets.map((asset) => ({
        path: asset.path,
        media_type: asset.media_type || 'unknown'
      })),
      duplicate_content_assets: duplicateContentAssets
    },
    view_package: {
      status: viewStatus,
      required_views: requiredViews,
      present_views: presentViews,
      missing_views: missingViews,
      view_evidence: viewEvidence,
      has_top_or_plan: presentViews.includes('top') || mediaTypes.some((type) => type === 'cad' || type === 'pdf'),
      has_oblique: presentViews.includes('oblique'),
      has_front_or_facade: presentViews.includes('front') || presentViews.includes('rear'),
      has_side_view: presentViews.includes('left') || presentViews.includes('right')
    },
    scale_package: {
      status: scaleStatus,
      confidence: round(scaleConfidence),
      strategy: scaleCalibration.strategy || 'unknown',
      default_scale: scaleCalibration.default_scale || {},
      measurement_count: Array.isArray(scaleCalibration.measurements) ? scaleCalibration.measurements.length : 0,
      source_metadata_hints: scaleCalibration.source_metadata_hints || [],
      blockers: scaleBlockers
    },
    semantic_package: {
      status: semanticStatus,
      required_roles: semanticRequiredRoles,
      covered_roles: semanticCoveredRoles,
      missing_roles: semanticMissingRoles,
      candidate_count: candidateGraph?.candidates?.length || 0,
      role_counts: roleCounts,
      role_evidence: roleEvidence,
      evidence_quality: semanticEvidenceQuality
    },
    release_package: {
      checklist_ready: checklist?.release_ready === true,
      can_promote_to_release_manifest: checklist?.can_promote_to_release_manifest === true,
      blockers: checklistBlockers,
      required_check_ids: releaseChecklistSummary.required_check_ids,
      failed_required_check_ids: releaseChecklistSummary.failed_required_check_ids,
      review_required_check_ids: releaseChecklistSummary.review_required_check_ids
    },
    source_request: sourceRequest,
    blockers,
    next_actions: nextActionsForSourcePackage({
      sourceBlockers,
      missingViews,
      scaleBlockers,
      semanticMissingRoles,
      checklist
    })
  };
}

function summarizeReleaseChecklist(checklist) {
  const checks = Array.isArray(checklist?.checks) ? checklist.checks : [];
  const requiredChecks = checks.filter((check) => check?.required === true);
  return {
    required_check_ids: uniqueSortedStrings(requiredChecks.map((check) => check.id)),
    failed_required_check_ids: uniqueSortedStrings(requiredChecks.filter((check) => check.status === 'fail').map((check) => check.id)),
    review_required_check_ids: uniqueSortedStrings(requiredChecks.filter((check) => check.status === 'review').map((check) => check.id))
  };
}

function uniqueSortedStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.length > 0))).sort();
}

export function renderRealWorldBuildingSourcePackageMarkdown(report) {
  const lines = [
    '# Real-World Building Source Package',
    '',
    `- Status: \`${report.status}\``,
    `- Input ready for release work: \`${String(report.input_ready_for_release_work)}\``,
    `- Release ready: \`${String(report.release_ready)}\``,
    `- Profile: \`${report.profile_id}\``,
    `- Source status: \`${report.source_authenticity.status}\``,
    `- View status: \`${report.view_package.status}\``,
    `- Scale status: \`${report.scale_package.status}\``,
    `- Scale strategy: \`${report.scale_package.strategy || 'unknown'}\``,
    `- Semantic status: \`${report.semantic_package.status}\``,
    `- Semantic evidence quality: \`${report.semantic_package.evidence_quality?.status || 'unknown'}\``,
    '',
    '## Views',
    '',
    `- Present: \`${report.view_package.present_views.join('`, `') || 'none'}\``,
    `- Missing: \`${report.view_package.missing_views.join('`, `') || 'none'}\``,
    `- View evidence: \`${viewEvidenceSummaryText(report.view_package.view_evidence || [])}\``,
    '',
    '## Blockers',
    ''
  ];
  if (report.blockers.length) {
    for (const blocker of report.blockers) lines.push(`- \`${blocker}\``);
  } else {
    lines.push('- `none`');
  }
  lines.push('', '## Next Actions', '');
  if (report.next_actions.length) {
    for (const action of report.next_actions) lines.push(`- ${action}`);
  } else {
    lines.push('- No source-package actions recorded.');
  }
  if (report.release_package) {
    lines.push('', '## Release Checklist Summary', '');
    lines.push(`- Required checks: \`${report.release_package.required_check_ids?.join('`, `') || 'none'}\``);
    lines.push(`- Failed required checks: \`${report.release_package.failed_required_check_ids?.join('`, `') || 'none'}\``);
    lines.push(`- Review required checks: \`${report.release_package.review_required_check_ids?.join('`, `') || 'none'}\``);
  }
  if (report.source_request) {
    lines.push('', '## Source Request', '');
    lines.push(`- Status: \`${report.source_request.status}\``);
    lines.push(`- Purpose: ${report.source_request.purpose}`);
    lines.push(`- Accepted asset types: \`${report.source_request.accepted_asset_types.join('`, `')}\``);
    lines.push(`- Blocked outputs until satisfied: \`${report.source_request.blocked_until_satisfied.join('`, `') || 'none'}\``);
    lines.push('');
    lines.push('### View Requirements');
    for (const item of report.source_request.view_requirements) {
      lines.push(`- ${item.status}: \`${item.view}\` - ${item.request}`);
    }
    lines.push('');
    lines.push('### Scale Requirement');
    lines.push(`- Status: \`${report.source_request.scale_requirement.status}\``);
    lines.push(`- Current confidence: \`${report.source_request.scale_requirement.current_confidence}\``);
    lines.push(`- Minimum confidence: \`${report.source_request.scale_requirement.minimum_confidence}\``);
    for (const item of report.source_request.scale_requirement.acceptable_evidence) lines.push(`- ${item}`);
    if (report.source_request.semantic_requirements.requests.length) {
      lines.push('', '### Semantic Requirements');
      for (const item of report.source_request.semantic_requirements.requests) lines.push(`- ${item}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderRealWorldBuildingSourceRequestMarkdown(sourceRequest) {
  if (!sourceRequest) return '# Real-World Building Source Request\n\n- `none`\n';
  const lines = [
    '# Real-World Building Source Request',
    '',
    `- Status: \`${sourceRequest.status}\``,
    `- Purpose: ${sourceRequest.purpose}`,
    `- Accepted asset types: \`${sourceRequest.accepted_asset_types.join('`, `')}\``,
    `- Blocked outputs until satisfied: \`${sourceRequest.blocked_until_satisfied.join('`, `') || 'none'}\``,
    `- Semantic evidence quality: \`${sourceRequest.semantic_evidence_quality?.status || 'not_applicable'}\``,
    `- Semantic geometry promotion allowed: \`${String(sourceRequest.semantic_evidence_quality?.geometry_promotion_allowed === true)}\``,
    '',
    '## Source Assets',
    '',
    `- Status: \`${sourceRequest.source_asset_requirements.status}\``,
    `- Needs replacement assets: \`${String(sourceRequest.source_asset_requirements.needs_replacement_assets === true)}\``,
    `- Needs supported assets: \`${String(sourceRequest.source_asset_requirements.needs_supported_assets === true)}\``,
    `- Needs distinct assets: \`${String(sourceRequest.source_asset_requirements.needs_distinct_assets === true)}\``
  ];
  for (const item of sourceRequest.source_asset_requirements.requests || []) lines.push(`- ${item}`);
  lines.push('', '## View Requirements', '');
  for (const item of sourceRequest.view_requirements || []) {
    lines.push(`- ${item.status}: \`${item.view}\` - ${item.request}`);
  }
  if (sourceRequest.view_source_requirements) {
    lines.push('', '## View Source Requirements', '');
    lines.push(`- Distinct source images required: \`${String(sourceRequest.view_source_requirements.distinct_source_images_required === true)}\``);
    lines.push(`- Required views: \`${sourceRequest.view_source_requirements.required_views.join('`, `') || 'none'}\``);
    lines.push(`- Blocker when violated: \`${sourceRequest.view_source_requirements.blocker}\``);
    for (const rule of sourceRequest.view_source_requirements.rules || []) lines.push(`- ${rule}`);
  }
  if (sourceRequest.upload_package_requirements) {
    const upload = sourceRequest.upload_package_requirements;
    lines.push('', '## Upload Package Requirements', '');
    lines.push(`- Manifest required: \`${String(upload.manifest_required === true)}\``);
    lines.push(`- Manifest file names: \`${(upload.manifest_file_names || []).join('`, `') || 'none'}\``);
    lines.push(`- Missing required views: \`${(upload.missing_required_views || []).join('`, `') || 'none'}\``);
    lines.push(`- Next upload response checks: \`${(upload.next_upload_response_check_ids || []).join('`, `') || 'none'}\``);
    for (const slot of upload.required_view_slots || []) {
      lines.push(`- ${slot.view}: \`${slot.status}\`, source image required \`${String(slot.source_image_required === true)}\`, distinct source required \`${String(slot.distinct_source_image_required === true)}\``);
    }
    if (upload.scale_evidence) {
      lines.push(`- Scale evidence required: \`${String(upload.scale_evidence.required === true)}\` (${upload.scale_evidence.current_confidence} / ${upload.scale_evidence.minimum_confidence})`);
      lines.push(`- Scale manifest fields: \`${(upload.scale_evidence.manifest_fields || []).join('`, `') || 'none'}\``);
    }
    if (upload.semantic_evidence?.evidence_quality) {
      lines.push(`- Semantic evidence quality: \`${upload.semantic_evidence.evidence_quality.status}\``);
      lines.push(`- Semantic geometry promotion allowed: \`${String(upload.semantic_evidence.evidence_quality.geometry_promotion_allowed === true)}\``);
    }
    for (const shortcut of upload.forbidden_shortcuts || []) lines.push(`- ${shortcut}`);
  }
  lines.push('', '## Scale Requirement', '');
  lines.push(`- Status: \`${sourceRequest.scale_requirement.status}\``);
  lines.push(`- Current confidence: \`${sourceRequest.scale_requirement.current_confidence}\``);
  lines.push(`- Minimum confidence: \`${sourceRequest.scale_requirement.minimum_confidence}\``);
  for (const item of sourceRequest.scale_requirement.acceptable_evidence || []) lines.push(`- ${item}`);
  lines.push('', '## Semantic Requirements', '');
  lines.push(`- Status: \`${sourceRequest.semantic_requirements.status}\``);
  lines.push(`- Evidence quality: \`${sourceRequest.semantic_requirements.evidence_quality?.status || 'not_applicable'}\``);
  lines.push(`- Geometry promotion allowed: \`${String(sourceRequest.semantic_requirements.evidence_quality?.geometry_promotion_allowed === true)}\``);
  if (sourceRequest.semantic_requirements.requests?.length) {
    for (const item of sourceRequest.semantic_requirements.requests) lines.push(`- ${item}`);
  } else {
    lines.push('- No semantic confirmation requests recorded.');
  }
  lines.push('', '## Upload Manifest', '');
  lines.push(`- Include manifest: \`${String(sourceRequest.upload_manifest_recommendation.include_manifest === true)}\``);
  lines.push(`- Template kind: \`${sourceRequest.upload_manifest_recommendation.template_kind}\``);
  lines.push(`- Recommended fields: \`${sourceRequest.upload_manifest_recommendation.recommended_fields.join('`, `')}\``);
  lines.push(`- ${sourceRequest.upload_manifest_recommendation.note}`);
  return `${lines.join('\n')}\n`;
}

export function buildRealWorldBuildingUploadManifestTemplate({
  sourceRequest,
  profileId = 'building_single',
  generatedAt = new Date().toISOString()
} = {}) {
  const objectType = ['building_single', 'building_group'].includes(profileId) ? profileId : undefined;
  const viewRequirements = sourceRequest?.view_requirements?.length
    ? sourceRequest.view_requirements
    : requiredViewsForProfile(profileId).map((view) => ({
      view,
      required: true,
      status: 'missing',
      request: viewRequestText(view),
      acceptable_sources: acceptableSourcesForView(view)
    }));
  const requiredViews = viewRequirements.filter((item) => item.required !== false);
  return {
    version: 1,
    kind: 'real_world_building_upload_manifest',
    template_only: true,
    generated_at: generatedAt,
    ...(objectType ? { object_type: objectType } : {}),
    source_request_status: sourceRequest?.status || 'needs_source_replacement',
    view_source_requirements: sourceRequest?.view_source_requirements || viewSourceRequirementsForProfile(profileId),
    views: requiredViews.map((item) => ({
      source_image: sourceRequestTemplateFileName(item.view),
      kind: item.view,
      confidence: item.status === 'present' ? 0.82 : 0.74,
      note: `${item.request} Replace this file name with the real uploaded asset path.`
    })),
    required_scale_confidence: sourceRequest?.scale_requirement?.minimum_confidence ?? 0.7,
    scale_evidence_options: sourceRequest?.scale_requirement?.acceptable_evidence || [
      'known building width/depth/height in upload manifest',
      'CAD/PDF outline with units',
      'measured facade/module/door/parking-stall scale anchor',
      'clear dimension annotation tied to a source view'
    ],
    notes: [
      'This template is not source evidence.',
      'Rename or copy it to manifest.json only after replacing template file names with real uploaded files.',
      'Each required view must reference a distinct uploaded source file; do not point front, side, oblique, and top labels at the same file.',
      'Add dimensions, known_dimensions, scale_hints, or scale_anchors when scale evidence is available.'
    ].join(' ')
  };
}

export function buildRealWorldBuildingSourceRequestResponse({
  previousSourceRequest,
  currentAssessment,
  currentPreflightReport = null,
  sourceRequestPath = null,
  generatedAt = new Date().toISOString()
} = {}) {
  const currentRequest = currentAssessment?.source_request || null;
  const checks = sourceRequestResponseChecks({
    previousSourceRequest,
    currentAssessment,
    currentPreflightReport
  });
  const requestedChecks = checks.filter((check) => check.requested);
  const satisfiedChecks = requestedChecks.filter((check) => check.satisfied);
  const unsatisfiedChecks = requestedChecks.filter((check) => !check.satisfied);
  const requestedCheckIds = requestedChecks.map((check) => check.id);
  const satisfiedCheckIds = satisfiedChecks.map((check) => check.id);
  const unsatisfiedCheckIds = unsatisfiedChecks.map((check) => check.id);
  const expectedCheckIds = expectedResponseCheckIdsForSourceRequest(previousSourceRequest, requestedCheckIds);
  const missingExpectedCheckIds = expectedCheckIds.filter((id) => !requestedCheckIds.includes(id));
  const unexpectedRequestedCheckIds = expectedCheckIds.length
    ? requestedCheckIds.filter((id) => !expectedCheckIds.includes(id))
    : [];
  const semanticEvidence = sourceRequestResponseSemanticEvidence({
    previousSourceRequest,
    currentAssessment,
    checks
  });
  const viewEvidence = sourceRequestResponseViewEvidence({
    previousSourceRequest,
    currentAssessment,
    currentPreflightReport,
    checks
  });
  const status = sourceRequestResponseStatus({
    currentAssessment,
    requestedChecks,
    satisfiedChecks,
    missingExpectedCheckIds
  });
  return {
    version: 1,
    kind: 'real_world_building_source_request_response',
    generated_at: generatedAt,
    ok: status === 'satisfied_for_release_work' || status === 'release_ready',
    status,
    source_request: {
      path: sourceRequestPath,
      status: previousSourceRequest?.status || 'unknown'
    },
    current_source_package: {
      status: currentAssessment?.status || 'not_assessed',
      input_ready_for_release_work: currentAssessment?.input_ready_for_release_work === true,
      release_ready: currentAssessment?.release_ready === true,
      source_request_status: currentRequest?.status || null
    },
    summary: {
      requested_checks: requestedChecks.length,
      satisfied_checks: satisfiedChecks.length,
      unsatisfied_checks: unsatisfiedChecks.length,
      expected_check_ids: expectedCheckIds,
      requested_check_ids: requestedCheckIds,
      satisfied_check_ids: satisfiedCheckIds,
      unsatisfied_check_ids: unsatisfiedCheckIds,
      missing_expected_check_ids: missingExpectedCheckIds,
      unexpected_requested_check_ids: unexpectedRequestedCheckIds,
      view_evidence: viewEvidence,
      semantic_evidence: semanticEvidence,
      unsatisfied_check_details: unsatisfiedChecks.map((check) => ({
        id: check.id,
        current_status: check.current_status,
        detail: check.detail
      }))
    },
    checks,
    blocked_outputs_remaining: currentRequest?.blocked_until_satisfied || [],
    next_actions: currentAssessment?.next_actions || []
  };
}

export function renderRealWorldBuildingSourceRequestResponseMarkdown(response) {
  if (!response) return '# Real-World Building Source Request Response\n\n- `none`\n';
  const lines = [
    '# Real-World Building Source Request Response',
    '',
    `- Status: \`${response.status}\``,
    `- OK: \`${String(response.ok)}\``,
    `- Previous request: \`${response.source_request.path || 'inline'}\``,
    `- Previous request status: \`${response.source_request.status}\``,
    `- Current source package: \`${response.current_source_package.status}\``,
    `- Input ready for release work: \`${String(response.current_source_package.input_ready_for_release_work)}\``,
    `- Release ready: \`${String(response.current_source_package.release_ready)}\``,
    `- Expected check ids: \`${response.summary.expected_check_ids?.join('`, `') || 'none'}\``,
    `- Missing expected check ids: \`${response.summary.missing_expected_check_ids?.join('`, `') || 'none'}\``,
    `- Unexpected requested check ids: \`${response.summary.unexpected_requested_check_ids?.join('`, `') || 'none'}\``,
    `- Unsatisfied check ids: \`${response.summary.unsatisfied_check_ids?.join('`, `') || 'none'}\``,
    `- Requested view evidence: \`${viewEvidenceSummaryText(response.summary.view_evidence?.requested_view_evidence || [])}\``,
    `- Semantic roles requested: \`${response.summary.semantic_evidence?.requested_roles?.join('`, `') || 'none'}\``,
    `- Semantic roles unsatisfied: \`${response.summary.semantic_evidence?.unsatisfied_roles?.join('`, `') || 'none'}\``,
    `- Semantic requested role evidence: \`${semanticRoleEvidenceSummaryText(response.summary.semantic_evidence?.requested_role_evidence || [])}\``,
    `- Semantic evidence quality: \`${response.summary.semantic_evidence?.evidence_quality?.status || 'unknown'}\``,
    `- Blocked outputs remaining: \`${response.blocked_outputs_remaining.join('`, `') || 'none'}\``,
    '',
    '## Checks',
    '',
    '| Check | Requested | Satisfied | Current | Detail |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const check of response.checks || []) {
    lines.push(`| ${escapeMarkdownTable(check.id)} | ${check.requested ? 'yes' : 'no'} | ${check.satisfied ? 'yes' : 'no'} | ${escapeMarkdownTable(check.current_status || 'unknown')} | ${escapeMarkdownTable(check.detail || '')} |`);
  }
  lines.push('', '## Next Actions', '');
  if (response.next_actions?.length) {
    for (const action of response.next_actions) lines.push(`- ${action}`);
  } else {
    lines.push('- No source-request response actions recorded.');
  }
  return `${lines.join('\n')}\n`;
}

export function realWorldBuildingSourcePackageFailedRequirements({
  report,
  requireInputReady = false,
  requireReleaseReady = false
} = {}) {
  const failed = [];
  if (requireInputReady && report?.input_ready_for_release_work !== true) {
    failed.push('input_ready_for_release_work');
  }
  if (requireReleaseReady && report?.release_ready !== true) {
    failed.push('release_ready');
  }
  return failed;
}

export function buildRealWorldBuildingSourcePackageGateResult({
  report,
  requireInputReady = false,
  requireReleaseReady = false,
  sourcePackagePath = null,
  sourcePackageMarkdownPath = null
} = {}) {
  const failedRequirements = realWorldBuildingSourcePackageFailedRequirements({
    report,
    requireInputReady,
    requireReleaseReady
  });
  return {
    version: 1,
    kind: 'real_world_building_source_package_gate_result',
    generated_at: report?.generated_at || new Date().toISOString(),
    ok: failedRequirements.length === 0,
    required_gates: {
      input_ready_for_release_work: requireInputReady === true,
      release_ready: requireReleaseReady === true
    },
    failed_requirements: failedRequirements,
    status: report?.status || 'not_assessed',
    input_ready_for_release_work: report?.input_ready_for_release_work === true,
    release_ready: report?.release_ready === true,
    blockers: report?.blockers || [],
    source_package: sourcePackagePath,
    source_package_markdown: sourcePackageMarkdownPath
  };
}

function sourcePackageStatus({
  profile,
  sourceStatus,
  viewStatus,
  scaleStatus,
  semanticStatus
}) {
  if (!['building_single', 'building_group'].includes(profile)) return 'blocked_profile';
  if (sourceStatus !== 'pass') return 'blocked_source_assets';
  if (viewStatus !== 'pass' || scaleStatus !== 'pass') return 'needs_views_or_scale';
  if (semanticStatus !== 'pass') return 'needs_semantic_review';
  return 'input_ready_for_release_work';
}

function requiredViewsForProfile(profile) {
  if (profile === 'building_single') return ['front', 'left', 'oblique', 'top'];
  if (profile === 'building_group') return ['oblique', 'top'];
  return [];
}

function requiredSemanticRolesForProfile(profile) {
  if (profile === 'building_single') return REQUIRED_BUILDING_SINGLE_SOURCE_ROLES;
  return [];
}

function nextActionsForSourcePackage({
  sourceBlockers,
  missingViews,
  scaleBlockers,
  semanticMissingRoles,
  checklist
}) {
  const actions = [];
  if (sourceBlockers.includes('missing_source_assets')) actions.push('Upload at least one real user-provided building photo, scan, PDF, or CAD source.');
  if (sourceBlockers.includes('source_assets_generated_or_scaffold')) actions.push('Replace generated, screenshot, scaffold, social-web, or cropped demo assets with original user-provided building sources.');
  if (sourceBlockers.includes('unsupported_source_asset_type')) actions.push('Use supported image, PDF, or CAD source asset types.');
  if (sourceBlockers.includes('duplicate_source_assets')) actions.push('Replace duplicated source files with distinct real views or drawings; one file copied under multiple view labels cannot satisfy release-source work.');
  for (const view of missingViews) {
    if (view === 'front') actions.push('Add a front or elevation view with readable facade structure.');
    if (view === 'left') actions.push('Add a side view to separate recessed side facade evidence from front facade evidence.');
    if (view === 'oblique') actions.push('Add an oblique view before release promotion.');
    if (view === 'top') actions.push('Add a top/plan view or CAD/PDF outline before release promotion.');
  }
  if (scaleBlockers.includes('scale_confidence_below_publish_gate')) actions.push('Provide known dimensions, CAD/PDF scale evidence, or reliable scale anchors.');
  for (const role of semanticMissingRoles) actions.push(`Capture or confirm semantic evidence for ${role}.`);
  for (const action of checklist?.next_actions || []) actions.push(action);
  return Array.from(new Set(actions));
}

function buildSourceRequest({
  profile,
  sourceStatus,
  viewStatus,
  scaleStatus,
  semanticStatus,
  sourceBlockers,
  missingViews,
  scaleBlockers,
  semanticMissingRoles,
  semanticEvidenceQuality,
  scaleConfidence,
  checklist
}) {
  const requestStatus = sourceRequestStatus({
    sourceStatus,
    viewStatus,
    scaleStatus,
    semanticStatus,
    checklist
  });
  const requiredViews = requiredViewsForProfile(profile);
  const acceptedAssetTypes = ['image', 'pdf', 'cad'];
  const sourceAssetRequirements = {
    status: sourceStatus,
    needs_replacement_assets: sourceBlockers.includes('source_assets_generated_or_scaffold'),
    needs_supported_assets: sourceBlockers.includes('missing_source_assets') || sourceBlockers.includes('unsupported_source_asset_type'),
    needs_distinct_assets: sourceBlockers.includes('duplicate_source_assets'),
    requests: sourceAssetRequests(sourceBlockers)
  };
  const viewRequirements = requiredViews.map((view) => ({
    view,
    required: true,
    status: missingViews.includes(view) ? 'missing' : 'present',
    request: viewRequestText(view),
    acceptable_sources: acceptableSourcesForView(view)
  }));
  const viewSourceRequirements = viewSourceRequirementsForProfile(profile);
  const scaleAcceptableEvidence = [
    'known building width/depth/height in upload manifest',
    'CAD/PDF outline with units',
    'measured facade/module/door/parking-stall scale anchor',
    'clear dimension annotation tied to a source view'
  ];
  const scaleRequirement = {
    status: scaleStatus,
    current_confidence: round(scaleConfidence),
    minimum_confidence: 0.7,
    blockers: scaleBlockers,
    acceptable_evidence: scaleAcceptableEvidence
  };
  const semanticRequirements = {
    status: semanticStatus,
    missing_roles: semanticMissingRoles,
    requests: semanticMissingRoles.map((role) => `Capture or confirm visible evidence for ${role}.`),
    evidence_quality: semanticEvidenceQuality || semanticEvidenceQualitySummary([])
  };
  return {
    version: 1,
    kind: 'real_world_building_source_request',
    status: requestStatus,
    purpose: 'Collect user-provided real building sources before release modeling or SketchUp DSL generation.',
    accepted_asset_types: acceptedAssetTypes,
    blocked_until_satisfied: sourceRequestBlockedOutputs(requestStatus),
    semantic_evidence_quality: semanticRequirements.evidence_quality,
    source_asset_requirements: sourceAssetRequirements,
    view_requirements: viewRequirements,
    view_source_requirements: viewSourceRequirements,
    scale_requirement: scaleRequirement,
    semantic_requirements: semanticRequirements,
    upload_package_requirements: uploadPackageRequirementsForSourceRequest({
      acceptedAssetTypes,
      sourceAssetRequirements,
      viewRequirements,
      viewSourceRequirements,
      scaleRequirement,
      semanticRequirements
    }),
    upload_manifest_recommendation: {
      include_manifest: true,
      template_kind: 'real_world_building_upload_manifest',
      recommended_fields: ['views', 'view_source_requirements', 'dimensions', 'scale_anchors'],
      note: 'Use manifest.json or upload-manifest.json to label ordinary photo filenames and provide dimensions or scale anchors. Each required view must point at a distinct uploaded source_image path.'
    }
  };
}

function uploadPackageRequirementsForSourceRequest({
  acceptedAssetTypes,
  sourceAssetRequirements,
  viewRequirements,
  viewSourceRequirements,
  scaleRequirement,
  semanticRequirements
}) {
  const requiredViewSlots = (viewRequirements || [])
    .filter((item) => item.required !== false)
    .map((item) => ({
      view: item.view,
      status: item.status,
      required: true,
      source_image_required: true,
      distinct_source_image_required: viewSourceRequirements?.distinct_source_images_required === true,
      source_image_field: 'views[].source_image',
      request: item.request,
      acceptable_sources: item.acceptable_sources || []
    }));
  const missingRequiredViews = requiredViewSlots
    .filter((item) => item.status !== 'present')
    .map((item) => item.view);
  const sourceAssetsRequested = sourceAssetRequirements.needs_replacement_assets === true
    || sourceAssetRequirements.needs_supported_assets === true
    || sourceAssetRequirements.needs_distinct_assets === true
    || sourceAssetRequirements.status !== 'pass';
  const semanticRequested = semanticRequirements.status !== 'pass'
    || (semanticRequirements.missing_roles || []).length > 0;
  return {
    manifest_required: true,
    manifest_file_names: ['manifest.json', 'upload-manifest.json'],
    accepted_asset_types: acceptedAssetTypes,
    source_asset_policy: {
      replacement_required: sourceAssetRequirements.needs_replacement_assets === true,
      supported_assets_required: sourceAssetRequirements.needs_supported_assets === true,
      distinct_assets_required: sourceAssetRequirements.needs_distinct_assets === true,
      content_hash_distinct_required: sourceAssetRequirements.needs_distinct_assets === true,
      forbidden_source_kinds: [
        'generated_image',
        'screenshot',
        'cropped_demo',
        'scaffold_asset',
        'social_or_web_capture'
      ]
    },
    required_view_slots: requiredViewSlots,
    missing_required_views: missingRequiredViews,
    view_source_policy: viewSourceRequirements,
    scale_evidence: {
      required: scaleRequirement.status !== 'pass',
      status: scaleRequirement.status,
      current_confidence: scaleRequirement.current_confidence,
      minimum_confidence: scaleRequirement.minimum_confidence,
      manifest_fields: ['dimensions', 'known_dimensions', 'scale_hints', 'scale_anchors'],
      acceptable_evidence: scaleRequirement.acceptable_evidence || []
    },
    semantic_evidence: {
      required: semanticRequested,
      status: semanticRequirements.status,
      evidence_quality: semanticRequirements.evidence_quality,
      missing_roles: semanticRequirements.missing_roles || [],
      requests: semanticRequirements.requests || []
    },
    next_upload_response_check_ids: uniqueStrings([
      ...(sourceAssetsRequested ? ['source_assets'] : []),
      ...missingRequiredViews.map((view) => `view_${view}`),
      ...(viewSourceRequirements?.distinct_source_images_required === true ? ['view_source_diversity'] : []),
      ...(scaleRequirement.status !== 'pass' ? ['scale_evidence'] : []),
      ...(semanticRequirements.missing_roles || []).map((role) => `semantic_${role}`)
    ]),
    forbidden_shortcuts: [
      'Do not relabel one image as multiple required views.',
      'Do not use generated, screenshot, scaffold, cropped demo, social, or web-captured source assets for release-source work.',
      'Do not proceed to SketchUp DSL or promoted PartGraph geometry until the next upload satisfies these checks.'
    ]
  };
}

function viewSourceRequirementsForProfile(profile) {
  const requiredViews = requiredViewsForProfile(profile);
  return {
    distinct_source_images_required: requiredViews.length > 1,
    required_views: requiredViews,
    source_image_field: 'views[].source_image',
    blocker: 'view_sources_not_distinct',
    rules: [
      'Each required view must reference a different uploaded source_image path.',
      'Do not satisfy front, side, oblique, and top requirements by relabeling the same image file.',
      'If one drawing sheet contains multiple elevations, crop or reference separate source assets only when each required view is visually distinct and reviewable.'
    ]
  };
}

function sourceRequestStatus({
  sourceStatus,
  viewStatus,
  scaleStatus,
  semanticStatus,
  checklist
}) {
  if (sourceStatus !== 'pass') return 'needs_source_replacement';
  if (viewStatus !== 'pass' || scaleStatus !== 'pass') return 'needs_views_or_scale';
  if (semanticStatus !== 'pass') return 'needs_semantic_confirmation';
  if (checklist?.release_ready === true) return 'release_ready';
  return 'input_ready_for_release_work';
}

function sourceRequestBlockedOutputs(status) {
  if (status === 'release_ready') return [];
  if (status === 'input_ready_for_release_work') return ['formal_release_manifest'];
  return ['direct_sketchup_dsl', 'promoted_part_graph_geometry', 'formal_release_manifest'];
}

function sourceAssetRequests(sourceBlockers) {
  const requests = [];
  if (sourceBlockers.includes('missing_source_assets')) {
    requests.push('Upload original user-provided building photos, PDF sheets, scans, or CAD files.');
  }
  if (sourceBlockers.includes('source_assets_generated_or_scaffold')) {
    requests.push('Replace screenshots, generated images, cropped demos, scaffold assets, and social/web captures with original user-provided sources.');
  }
  if (sourceBlockers.includes('unsupported_source_asset_type')) {
    requests.push('Use image, PDF, or CAD files only.');
  }
  if (sourceBlockers.includes('duplicate_source_assets')) {
    requests.push('Replace duplicated files with distinct front, side, oblique, top, PDF, or CAD sources.');
  }
  if (requests.length === 0) requests.push('Keep current real user-provided source assets.');
  return requests;
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
      detected_views: Array.from(new Set(items.map((item) => item.detected_view || 'unknown'))).sort()
    }))
    .sort((a, b) => a.content_sha256.localeCompare(b.content_sha256));
}

function viewSourceEvidence({ assets = [], requiredViews = [], presentViews = [] } = {}) {
  const views = uniqueStrings([
    ...(requiredViews || []),
    ...(presentViews || []),
    ...(assets || []).map((asset) => sourceAssetView(asset)).filter((view) => view && view !== 'unknown')
  ]);
  const requiredViewSet = new Set(requiredViews || []);
  const presentViewSet = new Set(presentViews || []);
  return views.map((view) => {
    const viewAssets = (assets || []).filter((asset) => sourceAssetView(asset) === view);
    return {
      view,
      required: requiredViewSet.has(view),
      status: presentViewSet.has(view) || viewAssets.length > 0 ? 'present' : 'missing',
      asset_count: viewAssets.length,
      asset_ids: uniqueStrings(viewAssets.map((asset) => asset.id)),
      source_images: uniqueStrings(viewAssets.map((asset) => asset.path)),
      media_types: uniqueStrings(viewAssets.map((asset) => asset.media_type || 'unknown')),
      content_sha256: uniqueStrings(viewAssets.map((asset) => asset.content_sha256).filter(Boolean))
    };
  });
}

function sourceAssetView(asset = {}) {
  return asset.detected_view || asset.view || asset.kind || 'unknown';
}

function semanticRoleEvidence({ candidates = [], requiredRoles = [] } = {}) {
  const roles = uniqueStrings([
    ...(requiredRoles || []),
    ...(candidates || []).map((candidate) => candidate.role || 'unknown')
  ]);
  const requiredRoleSet = new Set(requiredRoles || []);
  return roles.map((role) => {
    const roleCandidates = (candidates || []).filter((candidate) => (candidate.role || 'unknown') === role);
    const confidences = roleCandidates
      .map((candidate) => Number(candidate.confidence))
      .filter((value) => Number.isFinite(value));
    const views = uniqueStrings(roleCandidates.map((candidate) => candidate.view || candidate.source_view || candidate.detected_view || candidate.view_kind));
    const sourceImages = uniqueStrings(roleCandidates.map((candidate) => candidate.source_image || candidate.image_path || candidate.image?.path || candidate.source?.image));
    const confidenceMax = confidences.length ? round(Math.max(...confidences)) : 0;
    const qualityFlags = semanticRoleQualityFlags({
      role,
      candidateCount: roleCandidates.length,
      viewCount: views.length,
      sourceImageCount: sourceImages.length,
      confidenceMax
    });
    return {
      role,
      required: requiredRoleSet.has(role),
      status: roleCandidates.length ? 'covered' : 'missing',
      candidate_count: roleCandidates.length,
      candidate_ids: uniqueStrings(roleCandidates.map((candidate) => candidate.id)),
      views,
      source_images: sourceImages,
      confidence_min: confidences.length ? round(Math.min(...confidences)) : 0,
      confidence_max: confidenceMax,
      view_count: views.length,
      source_image_count: sourceImages.length,
      evidence_quality_status: semanticRoleQualityStatus({
        candidateCount: roleCandidates.length,
        viewCount: views.length,
        confidenceMax
      }),
      requires_human_review: roleCandidates.length > 0 || requiredRoleSet.has(role),
      geometry_promotion_allowed: false,
      quality_flags: qualityFlags
    };
  });
}

function semanticRoleQualityStatus({
  candidateCount,
  viewCount,
  confidenceMax
}) {
  if (candidateCount <= 0) return 'missing';
  if (confidenceMax < 0.45) return 'weak_candidate';
  if (viewCount > 1 && confidenceMax >= 0.65) return 'multi_view_review_candidate';
  return 'review_candidate';
}

function semanticRoleQualityFlags({
  role,
  candidateCount,
  viewCount,
  sourceImageCount,
  confidenceMax
}) {
  const flags = [];
  if (candidateCount <= 0) flags.push('missing_candidate');
  if (candidateCount > 0 && confidenceMax < 0.45) flags.push('low_confidence');
  if (candidateCount > 0 && viewCount <= 1) flags.push('single_view_semantic_candidate');
  if (candidateCount > 0 && sourceImageCount === 0) flags.push('missing_source_image_provenance');
  if (candidateCount > 0) flags.push('geometry_promotion_requires_review');
  if (role === 'visible_plane_recessed_left') {
    flags.push('requires_side_or_oblique_depth_confirmation');
    flags.push('do_not_merge_into_visible_plane_primary');
    flags.push('accepted_facade_plane_review_required');
  }
  if (role === 'visible_plane_primary') {
    flags.push('accepted_facade_plane_review_required');
    flags.push('do_not_name_as_front_facade_plane_without_review');
  }
  if (role === 'rectangular_utility_ducts') {
    flags.push('requires_rectangular_duct_semantics_review');
    flags.push('do_not_convert_to_round_pipe_or_trim');
  }
  if (role === 'shadow_or_recess_boundary') {
    flags.push('shadow_geometry_ambiguity');
    flags.push('do_not_cut_recess_from_shadow_only');
  }
  return uniqueStrings(flags);
}

function semanticEvidenceQualitySummary(roleEvidence = []) {
  const requiredEvidence = (roleEvidence || []).filter((item) => item.required === true);
  const missingRoles = requiredEvidence
    .filter((item) => item.status === 'missing' || item.evidence_quality_status === 'missing')
    .map((item) => item.role);
  const weakRoles = requiredEvidence
    .filter((item) => item.evidence_quality_status === 'weak_candidate')
    .map((item) => item.role);
  const reviewRequiredRoles = requiredEvidence
    .filter((item) => item.requires_human_review === true)
    .map((item) => item.role);
  const flags = uniqueStrings(requiredEvidence.flatMap((item) => item.quality_flags || []));
  let status = 'not_applicable';
  if (requiredEvidence.length > 0) {
    if (missingRoles.length > 0) status = 'missing';
    else if (weakRoles.length > 0) status = 'weak_review_required';
    else status = 'review_required';
  }
  return {
    status,
    required_role_count: requiredEvidence.length,
    covered_role_count: requiredEvidence.filter((item) => item.status === 'covered').length,
    missing_role_count: missingRoles.length,
    weak_role_count: weakRoles.length,
    review_required_role_count: reviewRequiredRoles.length,
    geometry_promotion_allowed: false,
    weak_roles: uniqueStrings(weakRoles),
    review_required_roles: uniqueStrings(reviewRequiredRoles),
    flags
  };
}

function viewRequestText(view) {
  if (view === 'front') return 'Provide a front/elevation source with readable facade organization.';
  if (view === 'left') return 'Provide a side source that separates depth and recessed side facade evidence from the front facade.';
  if (view === 'oblique') return 'Provide an oblique source showing facade depth, roofline, and side relationships.';
  if (view === 'top') return 'Provide a top/plan source or CAD/PDF outline.';
  return `Provide ${view} view evidence.`;
}

function acceptableSourcesForView(view) {
  if (view === 'top') return ['top photo', 'plan drawing', 'PDF sheet', 'CAD outline'];
  if (view === 'oblique') return ['oblique photo', 'perspective scan'];
  if (view === 'front') return ['front photo', 'elevation drawing', 'PDF sheet'];
  if (view === 'left' || view === 'right') return ['side photo', 'side elevation drawing', 'PDF sheet'];
  return ['photo', 'PDF sheet', 'CAD outline'];
}

function sourceRequestTemplateFileName(view) {
  if (view === 'top') return 'replace-with-top-or-plan-source.jpg';
  if (view === 'oblique') return 'replace-with-oblique-source.jpg';
  if (view === 'front') return 'replace-with-front-source.jpg';
  if (view === 'left' || view === 'right') return `replace-with-${view}-side-source.jpg`;
  return `replace-with-${view}-source.jpg`;
}

function sourceRequestResponseChecks({
  previousSourceRequest,
  currentAssessment,
  currentPreflightReport = null
}) {
  const previous = previousSourceRequest || {};
  const current = currentAssessment || {};
  const currentRequest = current.source_request || {};
  const checks = [];
  const previousContractValid = previous.kind === 'real_world_building_source_request' && previous.version === 1;
  checks.push({
    id: 'previous_source_request_contract',
    requested: !previousContractValid,
    satisfied: previousContractValid,
    current_status: previousContractValid ? 'valid' : 'invalid',
    detail: previousContractValid
      ? 'Previous source request uses the expected contract.'
      : 'Previous source request must be a real_world_building_source_request v1 artifact.'
  });

  const sourceRequested = previous.source_asset_requirements
    ? previous.source_asset_requirements.status !== 'pass'
      || previous.source_asset_requirements.needs_replacement_assets === true
      || previous.source_asset_requirements.needs_supported_assets === true
      || previous.source_asset_requirements.needs_distinct_assets === true
    : true;
  checks.push({
    id: 'source_assets',
    requested: sourceRequested,
    satisfied: current.source_authenticity?.status === 'pass',
    current_status: current.source_authenticity?.status || 'unknown',
    detail: current.source_authenticity?.status === 'pass'
      ? 'Current upload uses supported source assets without generated/scaffold path markers.'
      : 'Current upload still fails source authenticity or supported asset checks.'
  });

  const currentPresentViews = new Set(current.view_package?.present_views || []);
  for (const viewRequest of previous.view_requirements || []) {
    const requested = viewRequest.required === true && viewRequest.status !== 'present';
    checks.push({
      id: `view_${viewRequest.view}`,
      requested,
      satisfied: requested ? currentPresentViews.has(viewRequest.view) : true,
      current_status: currentPresentViews.has(viewRequest.view) ? 'present' : 'missing',
      detail: viewRequest.request || `Provide ${viewRequest.view} view evidence.`
    });
  }

  const viewSourceDiversityRequested = previous.view_source_requirements?.distinct_source_images_required === true;
  const viewSourceDiversityStatus = currentPreflightReport?.view_package?.view_source_diversity?.status || 'unknown';
  checks.push({
    id: 'view_source_diversity',
    requested: viewSourceDiversityRequested,
    satisfied: viewSourceDiversityRequested ? viewSourceDiversityStatus === 'pass' : true,
    current_status: viewSourceDiversityStatus,
    detail: viewSourceDiversityStatus === 'pass'
      ? 'Current upload uses distinct source_image paths for required views.'
      : 'Current upload must prove required views use distinct source_image paths through source-package preflight.'
  });

  const scaleRequested = previous.scale_requirement
    ? previous.scale_requirement.status !== 'pass'
    : true;
  const minimumScaleConfidence = previous.scale_requirement?.minimum_confidence ?? 0.7;
  const currentScaleConfidence = Number(current.scale_package?.confidence || 0);
  checks.push({
    id: 'scale_evidence',
    requested: scaleRequested,
    satisfied: scaleRequested
      ? current.scale_package?.status === 'pass' && currentScaleConfidence >= minimumScaleConfidence
      : true,
    current_status: current.scale_package?.status || 'unknown',
    detail: `Current confidence ${round(currentScaleConfidence)} / required ${minimumScaleConfidence}.`
  });

  for (const role of previous.semantic_requirements?.missing_roles || []) {
    const coveredRoles = new Set(current.semantic_package?.covered_roles || []);
    checks.push({
      id: `semantic_${role}`,
      requested: true,
      satisfied: coveredRoles.has(role),
      current_status: coveredRoles.has(role) ? 'covered' : 'missing',
      detail: `Semantic evidence for ${role}.`
    });
  }

  if (!checks.some((check) => check.requested) && currentRequest.status) {
    checks.push({
      id: 'source_request_status',
      requested: true,
      satisfied: current.input_ready_for_release_work === true || current.release_ready === true,
      current_status: currentRequest.status,
      detail: 'Current source request status should be input-ready or release-ready.'
    });
  }
  return checks;
}

function expectedResponseCheckIdsForSourceRequest(sourceRequest, fallbackCheckIds = []) {
  const expected = sourceRequest?.upload_package_requirements?.next_upload_response_check_ids || [];
  if (expected.length) return uniqueStrings(expected);
  return uniqueStrings(fallbackCheckIds);
}

function sourceRequestResponseSemanticEvidence({
  previousSourceRequest,
  currentAssessment,
  checks = []
} = {}) {
  const semanticChecks = (checks || []).filter((check) => check.id?.startsWith('semantic_'));
  const requestedSemanticChecks = semanticChecks.filter((check) => check.requested === true);
  const requestedRoles = uniqueStrings(requestedSemanticChecks.map((check) => check.id.slice('semantic_'.length)));
  const requestedRoleSet = new Set(requestedRoles);
  const roleEvidence = currentAssessment?.semantic_package?.role_evidence || [];
  const evidenceQuality = currentAssessment?.semantic_package?.evidence_quality || semanticEvidenceQualitySummary(roleEvidence);
  const currentCoveredRoles = uniqueStrings(currentAssessment?.semantic_package?.covered_roles || []);
  const currentMissingRoles = uniqueStrings(currentAssessment?.semantic_package?.missing_roles || []);
  return {
    previous_missing_roles: uniqueStrings(previousSourceRequest?.semantic_requirements?.missing_roles || []),
    current_required_roles: uniqueStrings(currentAssessment?.semantic_package?.required_roles || []),
    current_covered_roles: currentCoveredRoles,
    current_missing_roles: currentMissingRoles,
    requested_roles: requestedRoles,
    satisfied_roles: uniqueStrings(requestedSemanticChecks.filter((check) => check.satisfied === true).map((check) => check.id.slice('semantic_'.length))),
    unsatisfied_roles: uniqueStrings(requestedSemanticChecks.filter((check) => check.satisfied !== true).map((check) => check.id.slice('semantic_'.length))),
    evidence_quality: evidenceQuality,
    role_evidence: roleEvidence,
    requested_role_evidence: roleEvidence.filter((item) => requestedRoleSet.has(item.role))
  };
}

function sourceRequestResponseViewEvidence({
  previousSourceRequest,
  currentAssessment,
  currentPreflightReport,
  checks = []
} = {}) {
  const viewChecks = (checks || []).filter((check) => check.id?.startsWith('view_') && check.id !== 'view_source_diversity');
  const requestedViewChecks = viewChecks.filter((check) => check.requested === true);
  const requestedViews = uniqueStrings(requestedViewChecks.map((check) => check.id.slice('view_'.length)));
  const requestedViewSet = new Set(requestedViews);
  const viewEvidence = currentAssessment?.view_package?.view_evidence || [];
  return {
    previous_missing_views: uniqueStrings((previousSourceRequest?.view_requirements || [])
      .filter((item) => item.required === true && item.status !== 'present')
      .map((item) => item.view)),
    current_required_views: uniqueStrings(currentAssessment?.view_package?.required_views || []),
    current_present_views: uniqueStrings(currentAssessment?.view_package?.present_views || []),
    current_missing_views: uniqueStrings(currentAssessment?.view_package?.missing_views || []),
    requested_views: requestedViews,
    satisfied_views: uniqueStrings(requestedViewChecks.filter((check) => check.satisfied === true).map((check) => check.id.slice('view_'.length))),
    unsatisfied_views: uniqueStrings(requestedViewChecks.filter((check) => check.satisfied !== true).map((check) => check.id.slice('view_'.length))),
    view_source_diversity_status: currentPreflightReport?.view_package?.view_source_diversity?.status || 'unknown',
    view_evidence: viewEvidence,
    requested_view_evidence: viewEvidence.filter((item) => requestedViewSet.has(item.view))
  };
}

function sourceRequestResponseStatus({
  currentAssessment,
  requestedChecks,
  satisfiedChecks,
  missingExpectedCheckIds = []
}) {
  const unsatisfiedChecks = requestedChecks.length - satisfiedChecks.length;
  if (missingExpectedCheckIds.length > 0) return 'not_satisfied';
  if (requestedChecks.length > 0 && unsatisfiedChecks === 0) {
    if (currentAssessment?.release_ready === true) return 'release_ready';
    if (currentAssessment?.input_ready_for_release_work === true) return 'satisfied_for_release_work';
  }
  if (requestedChecks.length > 0 && satisfiedChecks.length > 0) return 'partially_satisfied';
  return 'not_satisfied';
}

function escapeMarkdownTable(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function semanticRoleEvidenceSummaryText(roleEvidence = []) {
  if (!roleEvidence.length) return 'none';
  return roleEvidence
    .map((item) => `${item.role}:${item.status}:${item.candidate_count}`)
    .join(', ');
}

function viewEvidenceSummaryText(viewEvidence = []) {
  if (!viewEvidence.length) return 'none';
  return viewEvidence
    .map((item) => `${item.view}:${item.status}:${item.asset_count}`)
    .join(', ');
}

function countBy(items, key) {
  const counts = {};
  for (const item of items || []) {
    const value = item[key] || 'unknown';
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.length)));
}
