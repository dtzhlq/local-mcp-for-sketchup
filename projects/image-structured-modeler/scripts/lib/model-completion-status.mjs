export function buildModelCompletionStatus({
  calibrationAccepted = false,
  topologyAccepted = false,
  visiblePlanesAccepted = false,
  planeLocalDetailsAccepted = false,
  reprojectionQaPassed = false,
  metricScaleAccepted = false,
  hiddenGeometryAccepted = false,
  visibleCoverageReviewResult = null
} = {}) {
  const checks = {
    calibration_accepted: calibrationAccepted === true,
    topology_accepted: topologyAccepted === true,
    visible_planes_accepted: visiblePlanesAccepted === true,
    plane_local_details_accepted: planeLocalDetailsAccepted === true,
    reprojection_qa_passed: reprojectionQaPassed === true,
    metric_scale_accepted: metricScaleAccepted === true,
    hidden_geometry_accepted: hiddenGeometryAccepted === true
  };
  const visibleCoverageSupplied = visibleCoverageReviewResult !== null;
  if (visibleCoverageSupplied) {
    checks.visible_coverage_accepted = visibleCoverageReviewResult?.visual_completion_eligible === true;
  }
  const visualBlockers = [];
  if (!checks.calibration_accepted) visualBlockers.push('accepted_perspective_calibration_review_required');
  if (!checks.topology_accepted) visualBlockers.push('accepted_surface_topology_review_required');
  if (!checks.visible_planes_accepted) visualBlockers.push('accepted_visible_plane_review_required');
  if (!checks.plane_local_details_accepted) visualBlockers.push('accepted_plane_local_detail_review_required');
  if (!checks.reprojection_qa_passed) visualBlockers.push('accepted_reprojection_qa_required');
  if (visibleCoverageSupplied && !checks.visible_coverage_accepted) {
    visualBlockers.push('accepted_visible_coverage_review_required');
  }
  const releaseBlockers = [...visualBlockers];
  if (!checks.metric_scale_accepted) releaseBlockers.push('accepted_metric_scale_anchor_required');
  if (!checks.hidden_geometry_accepted) releaseBlockers.push('accepted_hidden_geometry_review_required');
  const result = {
    kind: 'model_completion_status_v1',
    version: 1,
    visual_status: visualBlockers.length ? (
      checks.calibration_accepted && checks.topology_accepted && checks.visible_planes_accepted ? 'in_progress' : 'blocked'
    ) : 'complete',
    release_status: releaseBlockers.length ? (
      visualBlockers.length === 0 ? 'in_progress' : 'blocked'
    ) : 'complete',
    checks,
    visual_blockers: Array.from(new Set(visualBlockers)),
    release_blockers: Array.from(new Set(releaseBlockers))
  };
  if (visibleCoverageSupplied) {
    result.visible_coverage = {
      status: visibleCoverageReviewResult?.status || 'blocked_no_accepted_review',
      coverage_status: visibleCoverageReviewResult?.coverage_status || 'partial',
      accepted_visible_surface_ids: visibleCoverageReviewResult?.accepted_visible_surface_ids || [],
      excluded_region_ids: (visibleCoverageReviewResult?.excluded_regions || []).map((region) => region.id),
      exclusion_policy: 'permanent_non_promotable_non_compilable'
    };
  }
  return result;
}
