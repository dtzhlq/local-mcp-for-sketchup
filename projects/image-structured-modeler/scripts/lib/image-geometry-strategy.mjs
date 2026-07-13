const SITE_PROFILES = new Set(['building_group', 'site', 'campus', 'bird_eye_site']);
const ARCHITECTURE_PROFILES = new Set(['building_single', 'facade']);
const INTERIOR_PROFILES = new Set(['interior_room', 'interior_manhattan']);
const PRODUCT_PROFILES = new Set([
  'product',
  'vehicle_ambulance',
  'switch_controller',
  'compact_remote',
  'camera',
  'equipment'
]);

export function selectImageGeometryStrategy({
  profile = 'unknown',
  imageCount = 1,
  sourceMode = 'unknown',
  hasBirdEyeHint = false,
  hasOrthographicDocumentHint = false
} = {}) {
  const normalizedProfile = String(profile || 'unknown');
  const count = Math.max(1, Number(imageCount || 1));
  let strategy = 'unclassified_evidence_only';
  let calibrationRequired = false;
  let expectedArtifacts = ['structure_evidence_graph_v1'];
  let blockers = ['accepted_evidence_strategy_review_required'];
  const notes = [];

  if (hasOrthographicDocumentHint || sourceMode === 'orthographic_document') {
    strategy = 'document_orthographic_views';
    expectedArtifacts = ['document_asset_parse_report', 'draft_view_graph_v1'];
    blockers = ['accepted_document_view_mapping_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('Existing orthographic views are parsed directly; perspective vanishing-point calibration is not applied.');
  } else if (hasBirdEyeHint || sourceMode === 'bird_eye_photo' || SITE_PROFILES.has(normalizedProfile)) {
    strategy = 'ground_plane_site';
    expectedArtifacts = ['ground_plane_hypothesis', 'boundary_graph_v1', 'auto_ground_plan_r10'];
    blockers = ['accepted_ground_plane_review_required', 'accepted_boundary_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('Bird-eye/site reasoning uses a ground-plane and footprint route, not facade red/green axis promotion.');
  } else if (INTERIOR_PROFILES.has(normalizedProfile) && count > 1) {
    strategy = 'multi_view_calibration_pose_graph';
    calibrationRequired = true;
    expectedArtifacts = ['structure_line_evidence_v2', 'perspective_calibration_hypotheses_v1', 'multi_view_calibration_graph_v1', 'room_surface_graph_v1'];
    blockers = ['accepted_per_view_calibration_reviews_required', 'accepted_cross_view_correspondence_review_required', 'accepted_room_surface_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('Interior views are calibrated independently, then fused through reviewed room-surface correspondences.');
  } else if (INTERIOR_PROFILES.has(normalizedProfile)) {
    strategy = 'calibrated_room_surfaces';
    calibrationRequired = true;
    expectedArtifacts = ['structure_line_evidence_v2', 'perspective_calibration_hypotheses_v1', 'room_surface_graph_v1', 'draft_view_graph_v1'];
    blockers = ['accepted_perspective_calibration_review_required', 'accepted_room_surface_review_required', 'accepted_visible_coverage_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('A single interior view derives room-local wall, floor, ceiling, and terminal-surface hypotheses after accepted calibration.');
  } else if (ARCHITECTURE_PROFILES.has(normalizedProfile) && count > 1) {
    strategy = 'multi_view_calibration_pose_graph';
    calibrationRequired = true;
    expectedArtifacts = ['structure_line_evidence_v2', 'perspective_calibration_hypotheses_v1', 'multi_view_calibration_graph_v1'];
    blockers = ['accepted_per_view_calibration_reviews_required', 'accepted_cross_view_correspondence_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('Each image is calibrated independently before reviewed axes and planes can be fused.');
  } else if (ARCHITECTURE_PROFILES.has(normalizedProfile)) {
    strategy = 'calibrated_manhattan_planes';
    calibrationRequired = true;
    expectedArtifacts = ['structure_line_evidence_v2', 'perspective_calibration_hypotheses_v1', 'facade_plane_graph_v1', 'draft_view_graph_v1'];
    blockers = ['accepted_perspective_calibration_review_required', 'accepted_plane_topology_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('Draft views are derived only after accepted calibration and plane topology.');
  } else if (PRODUCT_PROFILES.has(normalizedProfile) && count > 1) {
    strategy = 'multi_view_object_surface';
    expectedArtifacts = ['structure_evidence_graph_v1', 'object_surface_graph_v1', 'multi_view_surface_correspondence_graph'];
    blockers = ['accepted_surface_reviews_required', 'accepted_cross_view_correspondence_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('Product multi-view fusion uses surfaces, silhouette, and feature correspondences; facade axis calibration is optional evidence only.');
  } else if (PRODUCT_PROFILES.has(normalizedProfile)) {
    strategy = 'object_surface_profile';
    expectedArtifacts = ['structure_evidence_graph_v1', 'object_surface_graph_v1'];
    blockers = ['accepted_surface_review_required', 'accepted_local_detail_review_required', 'accepted_partgraph_promotion_review_required'];
    notes.push('Non-Manhattan products are not forced through red/green architectural axes.');
  }

  return {
    kind: 'image_geometry_strategy_v1',
    version: 1,
    profile: normalizedProfile,
    image_count: count,
    source_mode: normalizeSourceMode({ sourceMode, hasBirdEyeHint, hasOrthographicDocumentHint }),
    strategy,
    calibration_required: calibrationRequired,
    expected_artifacts: expectedArtifacts,
    forbidden_artifacts: [
      'promoted_partgraph_without_accepted_reviews',
      'sketchup_dsl_without_accepted_partgraph_promotion',
      ...(strategy === 'ground_plane_site' ? ['facade_axis_as_site_ground_truth'] : []),
      ...(strategy.includes('object_surface') ? ['mandatory_red_green_facade_axes'] : [])
    ],
    review_policy: {
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers
    },
    notes
  };
}

function normalizeSourceMode({ sourceMode, hasBirdEyeHint, hasOrthographicDocumentHint }) {
  if (hasOrthographicDocumentHint) return 'orthographic_document';
  if (hasBirdEyeHint) return 'bird_eye_photo';
  if (['perspective_photo', 'bird_eye_photo', 'orthographic_document', 'mixed', 'unknown'].includes(sourceMode)) {
    return sourceMode;
  }
  return 'unknown';
}
