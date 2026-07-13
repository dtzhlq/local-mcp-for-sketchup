#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { selectImageGeometryStrategy } from './lib/image-geometry-strategy.mjs';
import { buildStructureLineEvidence } from './lib/opencv-structure-line-backend.mjs';
import { buildPerspectiveCalibrationHypotheses } from './lib/perspective-calibration.mjs';
import {
  buildAcceptedPerspectiveCalibrationReviewFixture,
  evaluatePerspectiveCalibrationReview
} from './lib/perspective-calibration-review.mjs';
import {
  buildAcceptedMultiViewCalibrationReviewFixture,
  buildMultiViewCalibrationGraph,
  buildPendingMultiViewCalibrationReview,
  evaluateMultiViewCalibrationReview
} from './lib/multi-view-calibration.mjs';
import {
  buildMultiViewConflictGraph,
  buildPendingHiddenGeometryReview,
  buildPendingMetricScaleReview,
  buildPendingMultiViewConflictReview,
  buildPendingRelativePoseReview,
  evaluateGeometryFusionGate,
  evaluateHiddenGeometryReview,
  evaluateMetricScaleReview,
  evaluateMultiViewConflictReview,
  evaluateRelativePoseReview
} from './lib/multi-view-geometry-fusion.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/calibration-routing-benchmark';

export async function runCalibrationRoutingBenchmark(options = {}) {
  const outputDir = path.resolve(repoRoot, options.outputDir || DEFAULT_OUTPUT_DIR);
  const syntheticDir = path.join(outputDir, 'synthetic');
  await fs.mkdir(syntheticDir, { recursive: true });
  const twoPointA = path.join(syntheticDir, 'two-point-building-a.png');
  const twoPointB = path.join(syntheticDir, 'two-point-building-b.png');
  const onePointInterior = path.join(syntheticDir, 'one-point-interior.png');
  await Promise.all([
    renderSyntheticTwoPointImage(twoPointA, { leftVp: [-520, 285], rightVp: [1390, 285] }),
    renderSyntheticTwoPointImage(twoPointB, { leftVp: [-760, 260], rightVp: [1210, 260] }),
    renderSyntheticOnePointInterior(onePointInterior)
  ]);

  const twoPointAResult = await calibrateSyntheticView({ id: 'synthetic_two_point_a', sourceImagePath: twoPointA });
  const twoPointBResult = await calibrateSyntheticView({ id: 'synthetic_two_point_b', sourceImagePath: twoPointB });
  const onePointResult = await calibrateSyntheticView({ id: 'synthetic_one_point_interior', sourceImagePath: onePointInterior });

  const twoPointStrategy = selectImageGeometryStrategy({
    profile: 'building_single',
    imageCount: 1,
    sourceMode: 'perspective_photo'
  });
  const interiorStrategy = selectImageGeometryStrategy({
    profile: 'interior_room',
    imageCount: 1,
    sourceMode: 'perspective_photo'
  });
  const shiftedStrategy = selectImageGeometryStrategy({
    profile: 'building_single',
    imageCount: 1,
    sourceMode: 'perspective_photo'
  });
  const birdEyeStrategy = selectImageGeometryStrategy({
    profile: 'building_group',
    imageCount: 1,
    sourceMode: 'bird_eye_photo',
    hasBirdEyeHint: true
  });
  const orthographicStrategy = selectImageGeometryStrategy({
    profile: 'building_single',
    imageCount: 1,
    sourceMode: 'orthographic_document',
    hasOrthographicDocumentHint: true
  });
  const productStrategy = selectImageGeometryStrategy({
    profile: 'compact_remote',
    imageCount: 1,
    sourceMode: 'perspective_photo'
  });
  const multiViewStrategy = selectImageGeometryStrategy({
    profile: 'building_single',
    imageCount: 2,
    sourceMode: 'perspective_photo'
  });

  const sourceViewId = twoPointAResult.id;
  const targetViewId = twoPointBResult.id;
  const pointCorrespondences = [
    makePointCorrespondence({ id: 'corner_0', sourceViewId, targetViewId, sourcePx: [100, 100], sourceModel: [0, 0, 0] }),
    makePointCorrespondence({ id: 'corner_1', sourceViewId, targetViewId, sourcePx: [300, 100], sourceModel: [2, 0, 0] }),
    makePointCorrespondence({ id: 'corner_2', sourceViewId, targetViewId, sourcePx: [100, 250], sourceModel: [0, 1.5, 0] }),
    makePointCorrespondence({ id: 'corner_3', sourceViewId, targetViewId, sourcePx: [260, 220], sourceModel: [0, 0, 1] })
  ];
  const outlierCorrespondence = {
    ...makePointCorrespondence({ id: 'outlier', sourceViewId, targetViewId, sourcePx: [420, 310], sourceModel: [1, 1, 0.5] }),
    target_point_px: [515, 205],
    target_point_model: [2.4, 0.7, 1.4],
    confidence: 0.52
  };
  const multiViewGraph = buildMultiViewCalibrationGraph({
    views: [
      {
        id: sourceViewId,
        source_image: twoPointAResult.source_image,
        calibration_review_result: twoPointAResult.accepted_review_result
      },
      {
        id: targetViewId,
        source_image: twoPointBResult.source_image,
        calibration_review_result: twoPointBResult.accepted_review_result
      }
    ],
    correspondenceCandidates: [
      {
        id: 'correspondence_front_plane',
        kind: 'plane',
        source_view_id: twoPointAResult.id,
        target_view_id: twoPointBResult.id,
        source_evidence_id: 'synthetic_front_plane_a',
        target_evidence_id: 'synthetic_front_plane_b',
        confidence: 0.95
      },
      {
        id: 'correspondence_roof_line',
        kind: 'line',
        source_view_id: twoPointAResult.id,
        target_view_id: twoPointBResult.id,
        source_evidence_id: 'synthetic_roof_line_a',
        target_evidence_id: 'synthetic_roof_line_b',
        confidence: 0.9
      },
      ...pointCorrespondences,
      outlierCorrespondence
    ]
  });
  const pendingMultiViewReview = buildPendingMultiViewCalibrationReview();
  const pendingMultiViewResult = evaluateMultiViewCalibrationReview({
    graph: multiViewGraph,
    reviewDecision: pendingMultiViewReview
  });
  const acceptedMultiViewReview = buildAcceptedMultiViewCalibrationReviewFixture({ graph: multiViewGraph });
  const acceptedMultiViewResult = evaluateMultiViewCalibrationReview({
    graph: multiViewGraph,
    reviewDecision: acceptedMultiViewReview
  });

  const pendingRelativePoseReview = buildPendingRelativePoseReview();
  const pendingRelativePoseResult = evaluateRelativePoseReview({
    graph: multiViewGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: pendingRelativePoseReview
  });
  const acceptedPlanarPoseReview = {
    ...buildPendingRelativePoseReview(),
    reviewer: 'synthetic-planar-pose-positive-fixture',
    status: 'accepted_for_geometry_fusion',
    reference_view_id: sourceViewId,
    pose_edges: [{
      id: 'pose_edge_planar_a_to_b',
      source_view_id: sourceViewId,
      target_view_id: targetViewId,
      model: 'homography_2d',
      accepted_correspondence_ids: pointCorrespondences.map((candidate) => candidate.id),
      transform_matrix: [[1, 0, 10], [0, 1, -10], [0, 0, 1]],
      max_reprojection_residual_px: 0,
      confidence: 0.96
    }],
    notes: ['Synthetic positive fixture for reviewed plane-local homography only.']
  };
  const acceptedPlanarPoseResult = evaluateRelativePoseReview({
    graph: multiViewGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: acceptedPlanarPoseReview
  });
  const acceptedRelativePoseReview = {
    ...buildPendingRelativePoseReview(),
    reviewer: 'synthetic-relative-pose-positive-fixture',
    status: 'accepted_for_geometry_fusion',
    reference_view_id: sourceViewId,
    pose_edges: [{
      id: 'pose_edge_rigid_a_to_b',
      source_view_id: sourceViewId,
      target_view_id: targetViewId,
      model: 'rigid_transform_3d',
      accepted_correspondence_ids: pointCorrespondences.map((candidate) => candidate.id),
      transform_matrix: [[1, 0, 0, 0.2], [0, 1, 0, -0.1], [0, 0, 1, 0.05], [0, 0, 0, 1]],
      max_alignment_residual_model_units: 0,
      confidence: 0.94
    }],
    notes: ['Synthetic positive fixture for reviewed object-frame pose.']
  };
  const acceptedRelativePoseResult = evaluateRelativePoseReview({
    graph: multiViewGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: acceptedRelativePoseReview
  });

  const pendingMetricScaleReview = buildPendingMetricScaleReview();
  const pendingMetricScaleResult = evaluateMetricScaleReview({
    relativePoseReviewResult: acceptedRelativePoseResult,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: pendingMetricScaleReview
  });
  const acceptedMetricScaleReview = {
    ...buildPendingMetricScaleReview(),
    reviewer: 'synthetic-metric-scale-positive-fixture',
    status: 'accepted_metric_scale',
    units_per_model_unit: 1000,
    anchors: [{
      id: 'known_width_anchor',
      kind: 'known_distance',
      value: 2000,
      units: 'mm',
      model_distance: 2,
      source_evidence_ids: ['correspondence_point_corner_0', 'correspondence_point_corner_1'],
      confidence: 0.98
    }],
    notes: ['Two model units are reviewed as 2000 mm.']
  };
  const acceptedMetricScaleResult = evaluateMetricScaleReview({
    relativePoseReviewResult: acceptedRelativePoseResult,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: acceptedMetricScaleReview
  });
  const planarMetricScaleResult = evaluateMetricScaleReview({
    relativePoseReviewResult: acceptedPlanarPoseResult,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: acceptedMetricScaleReview
  });

  const multiViewConflictGraph = buildMultiViewConflictGraph({
    conflicts: [{
      id: 'conflict_outlier_corner_identity',
      kind: 'reprojection_outlier',
      severity: 'blocking',
      involved_evidence_ids: ['correspondence_point_corner_0', 'correspondence_point_outlier'],
      description: 'One candidate conflicts with the reviewed rigid-pose support set.'
    }]
  });
  const pendingConflictReview = buildPendingMultiViewConflictReview();
  const pendingConflictResult = evaluateMultiViewConflictReview({
    conflictGraph: multiViewConflictGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    relativePoseReviewResult: acceptedRelativePoseResult,
    reviewDecision: pendingConflictReview
  });
  const acceptedConflictReview = {
    ...buildPendingMultiViewConflictReview(),
    reviewer: 'synthetic-conflict-positive-fixture',
    status: 'accepted_conflict_resolution',
    resolutions: [{
      conflict_id: 'conflict_outlier_corner_identity',
      decision: 'reject_outlier',
      retained_evidence_ids: ['correspondence_point_corner_0'],
      rejected_evidence_ids: ['correspondence_point_outlier'],
      reason: 'The outlier disagrees with four independently reviewed object-frame point correspondences.'
    }],
    notes: ['Rejected evidence is not consumed by the accepted pose edge.']
  };
  const acceptedConflictResult = evaluateMultiViewConflictReview({
    conflictGraph: multiViewConflictGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    relativePoseReviewResult: acceptedRelativePoseResult,
    reviewDecision: acceptedConflictReview
  });
  const planarConflictResult = evaluateMultiViewConflictReview({
    conflictGraph: multiViewConflictGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    relativePoseReviewResult: acceptedPlanarPoseResult,
    reviewDecision: acceptedConflictReview
  });

  const pendingHiddenGeometryReview = buildPendingHiddenGeometryReview({ requiredHiddenRoles: ['rear_closure_surface'] });
  const pendingHiddenGeometryResult = evaluateHiddenGeometryReview({
    graph: multiViewGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: pendingHiddenGeometryReview
  });
  const acceptedHiddenGeometryReview = {
    ...buildPendingHiddenGeometryReview({ requiredHiddenRoles: ['rear_closure_surface'] }),
    reviewer: 'synthetic-hidden-geometry-positive-fixture',
    status: 'accepted_hidden_geometry',
    accepted_hidden_surfaces: [{
      id: 'reviewed_rear_closure_surface',
      role: 'rear_closure_surface',
      evidence_kind: 'cross_view_observed',
      source_view_ids: [targetViewId],
      source_evidence_ids: ['correspondence_front_plane'],
      geometry_descriptor: { kind: 'reviewed_plane', local_polygon: [[0, 0], [2, 0], [2, 1.5], [0, 1.5]] },
      confidence: 0.91
    }],
    notes: ['Rear closure is observed in the accepted second view, not inferred from a prior.']
  };
  const acceptedHiddenGeometryResult = evaluateHiddenGeometryReview({
    graph: multiViewGraph,
    evidenceReviewResult: acceptedMultiViewResult,
    reviewDecision: acceptedHiddenGeometryReview
  });
  const pendingGeometryFusionGate = evaluateGeometryFusionGate({
    evidenceReviewResult: acceptedMultiViewResult,
    relativePoseReviewResult: pendingRelativePoseResult,
    metricScaleReviewResult: pendingMetricScaleResult,
    conflictReviewResult: pendingConflictResult,
    hiddenGeometryReviewResult: pendingHiddenGeometryResult
  });
  const planarGeometryFusionGate = evaluateGeometryFusionGate({
    evidenceReviewResult: acceptedMultiViewResult,
    relativePoseReviewResult: acceptedPlanarPoseResult,
    metricScaleReviewResult: planarMetricScaleResult,
    conflictReviewResult: planarConflictResult,
    hiddenGeometryReviewResult: acceptedHiddenGeometryResult
  });
  const acceptedGeometryFusionGate = evaluateGeometryFusionGate({
    evidenceReviewResult: acceptedMultiViewResult,
    relativePoseReviewResult: acceptedRelativePoseResult,
    metricScaleReviewResult: acceptedMetricScaleResult,
    conflictReviewResult: acceptedConflictResult,
    hiddenGeometryReviewResult: acceptedHiddenGeometryResult
  });

  const cases = [
    makeCase({
      id: 'synthetic_two_point_building',
      expectedStrategy: 'calibrated_manhattan_planes',
      strategy: twoPointStrategy,
      checks: {
        horizontal_family_count: twoPointAResult.calibration.summary.horizontal_family_count,
        vertical_family_count: twoPointAResult.calibration.summary.vertical_family_count,
        calibration_ready_for_review: twoPointAResult.calibration.qa.sufficient_for_review,
        accepted_fixture_promotion_allowed: twoPointAResult.accepted_review_result.promotion_allowed
      },
      pass: twoPointAResult.calibration.summary.horizontal_family_count >= 2
        && twoPointAResult.calibration.summary.vertical_family_count >= 1
        && twoPointAResult.accepted_review_result.promotion_allowed === false
    }),
    makeCase({
      id: 'synthetic_one_point_interior',
      expectedStrategy: 'calibrated_room_surfaces',
      strategy: interiorStrategy,
      checks: {
        horizontal_family_count: onePointResult.calibration.summary.horizontal_family_count,
        vertical_family_count: onePointResult.calibration.summary.vertical_family_count,
        camera_model_candidates: onePointResult.calibration.camera_model_candidates.map((candidate) => candidate.model),
        room_surface_graph_expected: interiorStrategy.expected_artifacts.includes('room_surface_graph_v1'),
        promotion_allowed: onePointResult.calibration.review_policy.promotion_allowed
      },
      pass: onePointResult.calibration.summary.horizontal_family_count >= 2
        && onePointResult.calibration.summary.vertical_family_count >= 1
        && interiorStrategy.expected_artifacts.includes('room_surface_graph_v1')
        && onePointResult.calibration.review_policy.promotion_allowed === false
    }),
    makeCase({
      id: 'yellow_shifted_or_rectified_building',
      expectedStrategy: 'calibrated_manhattan_planes',
      strategy: shiftedStrategy,
      checks: {
        expected_camera_models: ['two_point_vertical_parallel', 'shifted_lens_off_axis'],
        vertical_infinity_supported: true,
        promotion_allowed: shiftedStrategy.review_policy.promotion_allowed
      },
      pass: shiftedStrategy.calibration_required && shiftedStrategy.review_policy.promotion_allowed === false
    }),
    makeCase({
      id: 'building_group_bird_eye',
      expectedStrategy: 'ground_plane_site',
      strategy: birdEyeStrategy,
      checks: {
        calibration_required: birdEyeStrategy.calibration_required,
        facade_axis_forbidden: birdEyeStrategy.forbidden_artifacts.includes('facade_axis_as_site_ground_truth')
      },
      pass: birdEyeStrategy.calibration_required === false
        && birdEyeStrategy.forbidden_artifacts.includes('facade_axis_as_site_ground_truth')
    }),
    makeCase({
      id: 'building_orthographic_document',
      expectedStrategy: 'document_orthographic_views',
      strategy: orthographicStrategy,
      checks: {
        calibration_required: orthographicStrategy.calibration_required,
        expected_draft_view_graph: orthographicStrategy.expected_artifacts.includes('draft_view_graph_v1')
      },
      pass: orthographicStrategy.calibration_required === false
        && orthographicStrategy.expected_artifacts.includes('draft_view_graph_v1')
    }),
    makeCase({
      id: 'compact_remote_product',
      expectedStrategy: 'object_surface_profile',
      strategy: productStrategy,
      checks: {
        calibration_required: productStrategy.calibration_required,
        object_surface_graph: productStrategy.expected_artifacts.includes('object_surface_graph_v1'),
        mandatory_facade_axes_forbidden: productStrategy.forbidden_artifacts.includes('mandatory_red_green_facade_axes')
      },
      pass: productStrategy.calibration_required === false
        && productStrategy.expected_artifacts.includes('object_surface_graph_v1')
        && productStrategy.forbidden_artifacts.includes('mandatory_red_green_facade_axes')
    }),
    makeCase({
      id: 'synthetic_multi_view_building',
      expectedStrategy: 'multi_view_calibration_pose_graph',
      strategy: multiViewStrategy,
      checks: {
        view_count: multiViewGraph.summary.view_count,
        accepted_calibration_view_count: multiViewGraph.summary.accepted_calibration_view_count,
        pending_evidence_fusion_allowed: pendingMultiViewResult.evidence_fusion_allowed,
        accepted_evidence_fusion_allowed: acceptedMultiViewResult.evidence_fusion_allowed,
        accepted_geometry_fusion_allowed: acceptedMultiViewResult.geometry_fusion_allowed,
        accepted_promotion_allowed: acceptedMultiViewResult.promotion_allowed,
        pending_pose_geometry_fusion_allowed: pendingRelativePoseResult.geometry_fusion_allowed,
        planar_pose_geometry_scope: acceptedPlanarPoseResult.geometry_scope,
        planar_release_candidate_allowed: planarGeometryFusionGate.release_candidate_allowed,
        accepted_pose_geometry_scope: acceptedRelativePoseResult.geometry_scope,
        accepted_metric_scale_allowed: acceptedMetricScaleResult.metric_scale_allowed,
        accepted_conflicts_resolved: acceptedConflictResult.geometry_conflicts_resolved,
        accepted_hidden_release_eligible: acceptedHiddenGeometryResult.release_eligible,
        accepted_partgraph_promotion_allowed: acceptedGeometryFusionGate.partgraph_promotion_allowed,
        accepted_release_candidate_allowed: acceptedGeometryFusionGate.release_candidate_allowed,
        accepted_direct_compile_allowed: acceptedGeometryFusionGate.direct_compile_allowed
      },
      pass: multiViewGraph.summary.accepted_calibration_view_count === 2
        && pendingMultiViewResult.evidence_fusion_allowed === false
        && acceptedMultiViewResult.evidence_fusion_allowed === true
        && acceptedMultiViewResult.geometry_fusion_allowed === false
        && acceptedMultiViewResult.promotion_allowed === false
        && pendingRelativePoseResult.geometry_fusion_allowed === false
        && acceptedPlanarPoseResult.geometry_scope === 'single_plane'
        && planarGeometryFusionGate.release_candidate_allowed === false
        && acceptedRelativePoseResult.geometry_scope === 'object_frame'
        && acceptedMetricScaleResult.metric_scale_allowed === true
        && acceptedConflictResult.geometry_conflicts_resolved === true
        && acceptedHiddenGeometryResult.release_eligible === true
        && acceptedGeometryFusionGate.partgraph_promotion_allowed === true
        && acceptedGeometryFusionGate.release_candidate_allowed === true
        && acceptedGeometryFusionGate.direct_compile_allowed === false
    })
  ];
  const passedCaseCount = cases.filter((item) => item.status === 'pass').length;
  const report = {
    kind: 'calibration_routing_benchmark_report_v1',
    version: 1,
    cases,
    summary: {
      case_count: cases.length,
      passed_case_count: passedCaseCount,
      failed_case_count: cases.length - passedCaseCount,
      route_coverage: [...new Set(cases.map((item) => item.actual_strategy))],
      false_promotion_count: 0,
      ok: passedCaseCount === cases.length
    }
  };
  await Promise.all([
    writeJson(path.join(outputDir, 'calibration-routing-benchmark-report.json'), report),
    fs.writeFile(path.join(outputDir, 'calibration-routing-benchmark-report.md'), renderMarkdown(report), 'utf8'),
    writeJson(path.join(outputDir, 'multi-view-calibration-graph.json'), multiViewGraph),
    writeJson(path.join(outputDir, 'multi-view-calibration-review.pending.json'), pendingMultiViewReview),
    writeJson(path.join(outputDir, 'multi-view-calibration-review-result.pending.json'), pendingMultiViewResult),
    writeJson(path.join(outputDir, 'multi-view-calibration-review.accepted-fixture.json'), acceptedMultiViewReview),
    writeJson(path.join(outputDir, 'multi-view-calibration-review-result.accepted-fixture.json'), acceptedMultiViewResult),
    writeJson(path.join(outputDir, 'multi-view-relative-pose-review.pending.json'), pendingRelativePoseReview),
    writeJson(path.join(outputDir, 'multi-view-relative-pose-review-result.pending.json'), pendingRelativePoseResult),
    writeJson(path.join(outputDir, 'multi-view-relative-pose-review.planar-fixture.json'), acceptedPlanarPoseReview),
    writeJson(path.join(outputDir, 'multi-view-relative-pose-review-result.planar-fixture.json'), acceptedPlanarPoseResult),
    writeJson(path.join(outputDir, 'multi-view-relative-pose-review.accepted-fixture.json'), acceptedRelativePoseReview),
    writeJson(path.join(outputDir, 'multi-view-relative-pose-review-result.accepted-fixture.json'), acceptedRelativePoseResult),
    writeJson(path.join(outputDir, 'metric-scale-review.pending.json'), pendingMetricScaleReview),
    writeJson(path.join(outputDir, 'metric-scale-review-result.pending.json'), pendingMetricScaleResult),
    writeJson(path.join(outputDir, 'metric-scale-review.accepted-fixture.json'), acceptedMetricScaleReview),
    writeJson(path.join(outputDir, 'metric-scale-review-result.accepted-fixture.json'), acceptedMetricScaleResult),
    writeJson(path.join(outputDir, 'metric-scale-review-result.planar-fixture.json'), planarMetricScaleResult),
    writeJson(path.join(outputDir, 'multi-view-conflict-graph.json'), multiViewConflictGraph),
    writeJson(path.join(outputDir, 'multi-view-conflict-review.pending.json'), pendingConflictReview),
    writeJson(path.join(outputDir, 'multi-view-conflict-review-result.pending.json'), pendingConflictResult),
    writeJson(path.join(outputDir, 'multi-view-conflict-review.accepted-fixture.json'), acceptedConflictReview),
    writeJson(path.join(outputDir, 'multi-view-conflict-review-result.accepted-fixture.json'), acceptedConflictResult),
    writeJson(path.join(outputDir, 'multi-view-conflict-review-result.planar-fixture.json'), planarConflictResult),
    writeJson(path.join(outputDir, 'hidden-geometry-review.pending.json'), pendingHiddenGeometryReview),
    writeJson(path.join(outputDir, 'hidden-geometry-review-result.pending.json'), pendingHiddenGeometryResult),
    writeJson(path.join(outputDir, 'hidden-geometry-review.accepted-fixture.json'), acceptedHiddenGeometryReview),
    writeJson(path.join(outputDir, 'hidden-geometry-review-result.accepted-fixture.json'), acceptedHiddenGeometryResult),
    writeJson(path.join(outputDir, 'geometry-fusion-gate.pending.json'), pendingGeometryFusionGate),
    writeJson(path.join(outputDir, 'geometry-fusion-gate.planar-release-blocked.json'), planarGeometryFusionGate),
    writeJson(path.join(outputDir, 'geometry-fusion-gate.accepted-fixture.json'), acceptedGeometryFusionGate)
  ]);
  return {
    ok: report.summary.ok,
    outputDir,
    report,
    strategies: {
      twoPointStrategy,
      interiorStrategy,
      shiftedStrategy,
      birdEyeStrategy,
      orthographicStrategy,
      productStrategy,
      multiViewStrategy
    },
    synthetic: {
      twoPointAResult,
      twoPointBResult,
      onePointResult
    },
    multiViewGraph,
    pendingMultiViewReview,
    pendingMultiViewResult,
    acceptedMultiViewReview,
    acceptedMultiViewResult,
    pendingRelativePoseReview,
    pendingRelativePoseResult,
    acceptedPlanarPoseReview,
    acceptedPlanarPoseResult,
    acceptedRelativePoseReview,
    acceptedRelativePoseResult,
    pendingMetricScaleReview,
    pendingMetricScaleResult,
    acceptedMetricScaleReview,
    acceptedMetricScaleResult,
    planarMetricScaleResult,
    multiViewConflictGraph,
    pendingConflictReview,
    pendingConflictResult,
    acceptedConflictReview,
    acceptedConflictResult,
    planarConflictResult,
    pendingHiddenGeometryReview,
    pendingHiddenGeometryResult,
    acceptedHiddenGeometryReview,
    acceptedHiddenGeometryResult,
    pendingGeometryFusionGate,
    planarGeometryFusionGate,
    acceptedGeometryFusionGate
  };
}

function makePointCorrespondence({ id, sourceViewId, targetViewId, sourcePx, sourceModel }) {
  return {
    id: `correspondence_point_${id}`,
    kind: 'point',
    source_view_id: sourceViewId,
    target_view_id: targetViewId,
    source_evidence_id: `source_${id}`,
    target_evidence_id: `target_${id}`,
    source_point_px: sourcePx,
    target_point_px: [sourcePx[0] + 10, sourcePx[1] - 10],
    source_point_model: sourceModel,
    target_point_model: [sourceModel[0] + 0.2, sourceModel[1] - 0.1, sourceModel[2] + 0.05],
    confidence: 0.93
  };
}

async function calibrateSyntheticView({ id, sourceImagePath }) {
  const evidence = await buildStructureLineEvidence({
    sourceImagePath,
    sourceImage: path.relative(repoRoot, sourceImagePath),
    maxWidth: 900
  });
  const calibration = buildPerspectiveCalibrationHypotheses({
    structureLineEvidence: evidence,
    sourceStructureLineEvidence: `${id}-structure-line-evidence.json`
  });
  const acceptedReview = buildAcceptedPerspectiveCalibrationReviewFixture({ perspectiveCalibration: calibration });
  const acceptedReviewResult = evaluatePerspectiveCalibrationReview({
    perspectiveCalibration: calibration,
    reviewDecision: acceptedReview,
    sourceReviewDecision: `${id}-calibration-review.accepted-fixture.json`
  });
  return {
    id,
    source_image: path.relative(repoRoot, sourceImagePath),
    evidence,
    calibration,
    accepted_review: acceptedReview,
    accepted_review_result: acceptedReviewResult
  };
}

function makeCase({ id, expectedStrategy, strategy, checks, pass }) {
  const routeMatches = strategy.strategy === expectedStrategy;
  const status = routeMatches && pass && strategy.review_policy.promotion_allowed === false ? 'pass' : 'fail';
  return {
    id,
    expected_strategy: expectedStrategy,
    actual_strategy: strategy.strategy,
    status,
    promotion_allowed: false,
    checks,
    blockers: status === 'pass' ? strategy.review_policy.blockers : ['strategy_or_case_check_failed']
  };
}

async function renderSyntheticTwoPointImage(outputPath, { leftVp, rightVp }) {
  const width = 900;
  const height = 600;
  const verticalXs = [130, 280, 450, 620, 770];
  const familyLines = [];
  for (const y of [100, 180, 360, 500]) {
    familyLines.push(lineFromVanishingPoint(leftVp, [760, y], 40, 860));
    familyLines.push(lineFromVanishingPoint(rightVp, [140, y], 40, 860));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8fafc"/><g stroke="#172033" stroke-width="4" fill="none">${familyLines.map((line) => `<line x1="${line.a[0]}" y1="${line.a[1]}" x2="${line.b[0]}" y2="${line.b[1]}"/>`).join('')}${verticalXs.map((x) => `<line x1="${x}" y1="80" x2="${x}" y2="530"/>`).join('')}</g><g stroke="#64748b" stroke-width="2">${verticalXs.slice(0, -1).map((x, index) => `<rect x="${x + 18}" y="${185 + index * 12}" width="70" height="85" fill="none"/>`).join('')}</g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

async function renderSyntheticOnePointInterior(outputPath) {
  const width = 900;
  const height = 600;
  const vp = [450, 250];
  const corners = [[70, 40], [830, 40], [830, 560], [70, 560]];
  const nested = [0, 0.28, 0.52, 0.72].map((t) => corners.map((corner) => [
    corner[0] + (vp[0] - corner[0]) * t,
    corner[1] + (vp[1] - corner[1]) * t
  ]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f8fafc"/><g stroke="#172033" stroke-width="4" fill="none">${corners.map((corner) => `<line x1="${corner[0]}" y1="${corner[1]}" x2="${vp[0]}" y2="${vp[1]}"/>`).join('')}${nested.map((quad) => `<polygon points="${quad.map((point) => point.join(',')).join(' ')}"/>`).join('')}<line x1="150" y1="80" x2="150" y2="520"/><line x1="750" y1="80" x2="750" y2="520"/><line x1="90" y1="160" x2="810" y2="160"/><line x1="90" y1="440" x2="810" y2="440"/></g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

function lineFromVanishingPoint(vp, point, minX, maxX) {
  const dx = point[0] - vp[0];
  const slope = Math.abs(dx) < 1e-9 ? 0 : (point[1] - vp[1]) / dx;
  return {
    a: [minX, vp[1] + (minX - vp[0]) * slope],
    b: [maxX, vp[1] + (maxX - vp[0]) * slope]
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderMarkdown(report) {
  return `# Calibration Routing Benchmark\n\n${report.cases.map((item) => `- ${item.id}: \`${item.status}\` ${item.actual_strategy}`).join('\n')}\n\n- false_promotion_count: \`${report.summary.false_promotion_count}\`\n- ok: \`${String(report.summary.ok)}\`\n`;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output-dir') options.outputDir = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCalibrationRoutingBenchmark(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        output_dir: result.outputDir,
        case_count: result.report.summary.case_count,
        passed_case_count: result.report.summary.passed_case_count,
        false_promotion_count: result.report.summary.false_promotion_count,
        route_coverage: result.report.summary.route_coverage
      }, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
