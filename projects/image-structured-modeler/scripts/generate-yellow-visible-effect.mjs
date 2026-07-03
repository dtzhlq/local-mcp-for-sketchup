#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { applyCandidatePromotionPatch } from './apply-candidate-promotion-patch.mjs';
import { buildCandidatePromotionPatch } from './build-candidate-promotion-patch.mjs';
import { buildStructuredAssetIntake } from './intake-assets.mjs';
import {
  buildDraftViewGraphV1,
  renderDraftViewGraphMarkdown,
  renderDraftViewGraphSvg,
  renderStructureEvidenceGraphMarkdown
} from './lib/drafting-first-graphs.mjs';
import {
  buildAcceptedYellowCalibratedViewReviewDecision,
  buildAcceptedYellowCornerChainTopologyReviewDecision,
  buildYellowCalibratedViewGraph,
  buildYellowCornerChainTopologyGraph,
  planProjectionFromCornerChainTopology,
  prepareCalibrationImageDataUrl,
  renderCalibratedViewGraphMarkdown,
  renderCalibratedViewOverlaySvg,
  renderCornerChainTopologyMarkdown,
  renderCornerChainTopologyOverlaySvg
} from './lib/calibration-first-graphs.mjs';
import {
  buildFacadePlaneReviewOverlay,
  renderFacadePlaneGraphMarkdown
} from './lib/facade-plane-graph.mjs';
import {
  buildMcpModelingBrief,
  renderMcpModelingBriefMarkdown
} from './lib/mcp-modeling-brief.mjs';
import {
  augmentStructureEvidenceGraphWithYellowProjection,
  buildYellowBuildingStructuralProjection,
  facadePlaneGraphFromYellowProjection,
  prepareYellowProjectionImageDataUrl,
  renderYellowFacadeProjectionSvg,
  renderYellowPlanProjectionSvg,
  renderYellowStructuralMethodologyMarkdown,
  renderYellowStructuralProjectionOverlaySvg
} from './lib/yellow-building-structural-projection.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/yellow-visible-effect';
const YELLOW_SOURCE = 'projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png';
const YELLOW_VIEW_HINTS = 'projects/image-structured-modeler/examples/building-single-anime-yellow/view-hints.json';
const YELLOW_ANNOTATIONS = 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-annotations.md';
const YELLOW_VLM_CANDIDATES = 'projects/image-structured-modeler/examples/building-single-anime-yellow/building-single-vlm-candidates.json';
const BUILDING_PROFILE = 'examples/product-profiles/building_single_urban_oblique.json';

const ACCEPTED_ROLES = new Set([
  'building_main_mass',
  'visible_plane_primary',
  'visible_plane_recessed_left',
  'upper_window_bands',
  'ground_floor_storefront',
  'exterior_hvac_units',
  'rectangular_utility_ducts',
  'roof_parapet_and_rail'
]);

const ACCEPTED_DETAIL_ROLES = new Set([
  'upper_window_bands',
  'ground_floor_storefront',
  'exterior_hvac_units',
  'rectangular_utility_ducts',
  'roof_parapet_and_rail'
]);

export async function generateYellowVisibleEffect(options = {}) {
  const outputDir = path.resolve(repoRoot, options.outputDir || DEFAULT_OUTPUT_DIR);
  const outputRel = path.relative(repoRoot, outputDir);
  const intakeDir = path.join(outputDir, 'intake');
  const sourceAbs = path.resolve(repoRoot, YELLOW_SOURCE);
  const originalPath = path.join(outputDir, '01-original.png');
  await fs.mkdir(outputDir, { recursive: true });
  await removeStaleYellowDecisionArtifacts(outputDir);
  await fs.copyFile(sourceAbs, originalPath);

  const intake = await buildStructuredAssetIntake({
    input: YELLOW_SOURCE,
    objectType: 'building_single',
    objectName: 'Anime Yellow Building Visible Effect Judgment',
    viewHintsFile: YELLOW_VIEW_HINTS,
    buildingSingleAnnotations: YELLOW_ANNOTATIONS,
    buildingSingleVlmCandidates: YELLOW_VLM_CANDIDATES,
    outputDir: path.relative(repoRoot, intakeDir),
    writeOverlays: false
  });

  const yellowStructuralProjection = await buildYellowStructuralProjectionPackage({
    intake,
    intakeDir,
    outputDir,
    sourceAbs,
    sourceImage: YELLOW_SOURCE
  });

  const structureOverlaySvg = await renderStructureEvidenceOverlaySvg({
    title: 'Structure Evidence Overlay',
    sourceImagePath: sourceAbs,
    graph: intake.structureEvidenceGraph
  });
  const structureOverlaySvgPath = path.join(outputDir, '02-structure-overlay.svg');
  const structureOverlayPngPath = path.join(outputDir, '02-structure-overlay.png');
  await writeSvgAndPng(structureOverlaySvgPath, structureOverlayPngPath, structureOverlaySvg);

  const draftOverlaySvg = await renderDraftViewOverlaySvg({
    title: 'DraftViewGraph Overlay',
    sourceImagePath: sourceAbs,
    graph: intake.draftViewGraph
  });
  const draftOverlaySvgPath = path.join(outputDir, '03-draft-view-graph.svg');
  const draftOverlayPngPath = path.join(outputDir, '03-draft-view-graph.png');
  await writeSvgAndPng(draftOverlaySvgPath, draftOverlayPngPath, draftOverlaySvg);

  const planeOverlaySvg = await renderPlaneReviewOverlaySvg({
    title: 'Facade Plane Review Overlay',
    sourceImagePath: sourceAbs,
    facadePlaneGraph: intake.facadePlaneGraph
  });
  const planeOverlaySvgPath = path.join(outputDir, '04-plane-review-overlay.svg');
  const planeOverlayPngPath = path.join(outputDir, '04-plane-review-overlay.png');
  await writeSvgAndPng(planeOverlaySvgPath, planeOverlayPngPath, planeOverlaySvg);

  const noReviewPatch = intake.promotionPatch;
  const noReviewReport = await buildNoReviewReport({
    outputDir,
    noReviewPatch,
    intake
  });

  const perspectiveCritique = buildPerspectiveCritique({
    intake,
    structuralProjection: yellowStructuralProjection
  });
  await writeJson(path.join(outputDir, 'perspective-critique-report.json'), perspectiveCritique);
  await fs.writeFile(path.join(outputDir, 'perspective-critique-report.md'), renderPerspectiveCritiqueMarkdown(perspectiveCritique), 'utf8');

  const acceptedReview = perspectiveCritique.promotion_allowed
    ? buildYellowAcceptedReview({
        promotionReview: intake.promotionReview,
        candidateGraph: intake.candidateGraph,
        draftViewGraph: intake.draftViewGraph,
        objectSurfaceGraph: intake.objectSurfaceGraph,
        facadePlaneGraph: intake.facadePlaneGraph,
        modelingBrief: intake.modelingBrief,
        assetSet: intake.assetSet
      })
    : buildPerspectiveBlockedReview({
        promotionReview: intake.promotionReview,
        candidateGraph: intake.candidateGraph,
        perspectiveCritique
      });
  const blockedReviewName = yellowStructuralProjection
    ? 'candidate-promotion-review.calibration-topology-promotion-blocked.yellow.json'
    : 'candidate-promotion-review.perspective-blocked.yellow.json';
  const reviewArtifactName = perspectiveCritique.promotion_allowed
    ? 'candidate-promotion-review.accepted.yellow.json'
    : blockedReviewName;
  const acceptedReviewPath = path.join(outputDir, reviewArtifactName);
  await writeJson(acceptedReviewPath, acceptedReview);

  const acceptedPatch = buildCandidatePromotionPatch({
    assetSet: intake.assetSet,
    candidateGraph: intake.candidateGraph,
    modelingBrief: intake.modelingBrief,
    promotionReview: acceptedReview,
    sourceReview: path.relative(outputDir, acceptedReviewPath)
  });
  const blockedPatchName = yellowStructuralProjection
    ? 'candidate-promotion-patch.calibration-topology-promotion-blocked.yellow.json'
    : 'candidate-promotion-patch.perspective-blocked.yellow.json';
  const patchArtifactName = perspectiveCritique.promotion_allowed
    ? 'candidate-promotion-patch.accepted.yellow.json'
    : blockedPatchName;
  const acceptedPatchPath = path.join(outputDir, patchArtifactName);
  await writeJson(acceptedPatchPath, acceptedPatch);

  const profile = await readJson(path.resolve(repoRoot, BUILDING_PROFILE));
  const applied = [];
  let partGraph;
  let dsl;
  let releaseCompile;
  let mockSummary;
  const partGraphPath = path.join(outputDir, '05-partgraph-preview.json');
  const dslPath = path.join(outputDir, '06-sketchup-dsl.preview.json');
  if (perspectiveCritique.promotion_allowed && acceptedPatch.apply_allowed) {
    const appliedPatch = applyCandidatePromotionPatch({
      patch: acceptedPatch,
      candidateGraph: intake.candidateGraph,
      observationSet: intake.observationSet,
      profile,
      id: 'yellow-visible-effect-reviewed-facade-study',
      productName: 'Yellow Building Reviewed Facade Study'
    });
    applied.push(...appliedPatch.applied);
    partGraph = enhanceYellowPreviewPartGraph(appliedPatch.partGraph);
    const previewProfile = buildPreviewProfile(profile, path.relative(repoRoot, originalPath));
    dsl = compilePartGraphToSketchUpDsl(partGraph, previewProfile, {
      repoRoot,
      profilePath: BUILDING_PROFILE,
      partGraphPath: path.relative(repoRoot, partGraphPath)
    });
    releaseCompile = await releaseProfileCompileStatus({ partGraph, profile });
    mockSummary = await buildMockSummary({
      outputDir,
      dsl,
      dslPath
    });
  } else {
    partGraph = blockedPartGraphPreview({ perspectiveCritique });
    dsl = blockedDslPreview({ perspectiveCritique });
    releaseCompile = {
      status: 'not_run',
      expected_blocked: true,
      reason: perspectiveCritique.status
    };
    mockSummary = {
      ok: false,
      status: `blocked_${perspectiveCritique.status}`,
      runtime: 'mock',
      source_dsl: path.relative(repoRoot, dslPath),
      operation_counts: operationCounts(dsl.operations || []),
      snapshot_summary: {
        totals: { faces: 0, edges: 0, vertices: 0, groups: 0, instances: 0 },
        bounding_box: null,
        scenes: [],
        material_names: []
      },
      blockers: perspectiveCritique.blockers
    };
  }
  await writeJson(partGraphPath, partGraph);
  await writeJson(dslPath, dsl);

  const mockPreviewSvg = perspectiveCritique.promotion_allowed
    ? renderSketchUpDslMockPreviewSvg(dsl)
    : renderBlockedSketchUpPreviewSvg(perspectiveCritique);
  const mockPreviewSvgPath = path.join(outputDir, '07-sketchup-mock-preview.svg');
  const mockPreviewPngPath = path.join(outputDir, '07-sketchup-mock-preview.png');
  await writeSvgAndPng(mockPreviewSvgPath, mockPreviewPngPath, mockPreviewSvg);

  const mockSummaryPath = path.join(outputDir, '07-sketchup-mock-summary.json');
  await writeJson(mockSummaryPath, mockSummary);

  const forgedReadyPatchReport = await buildForgedReadyPatchReport({
    outputDir,
    acceptedPatch,
    intake,
    profile
  });

  const liveSummary = options.live
    ? await maybeRunLiveSketchUpPreview({ outputDir, dsl, timeoutMs: options.timeoutMs })
    : {
        requested: false,
        status: 'skipped',
        reason: 'Live SketchUp capture is optional and not run by default.'
      };
  await writeJson(path.join(outputDir, '08-sketchup-live-summary.json'), liveSummary);

  const report = buildJudgmentReport({
    outputDir,
    outputRel,
    intakeDir,
    originalPath,
    structureOverlayPngPath,
    draftOverlayPngPath,
    planeOverlayPngPath,
    mockPreviewPngPath,
    noReviewReport,
    acceptedReview,
    acceptedPatch,
    partGraph,
    dsl,
    mockSummary,
    liveSummary,
    forgedReadyPatchReport,
    releaseCompile,
    perspectiveCritique,
    structuralProjection: yellowStructuralProjection,
    appliedCount: applied.length,
    acceptedReviewPath,
    acceptedPatchPath
  });
  await writeJson(path.join(outputDir, 'judgment-report.json'), report);
  await fs.writeFile(path.join(outputDir, 'judgment-report.md'), renderJudgmentMarkdown(report), 'utf8');
  await writeComparisonHtml({
    outputDir,
    report,
    noReviewReport
  });

  return {
    outputDir,
    intake,
    acceptedReview,
    acceptedPatch,
    partGraph,
    dsl,
    mockSummary,
    report
  };
}

async function removeStaleYellowDecisionArtifacts(outputDir) {
  await Promise.all([
    'candidate-promotion-review.accepted.yellow.json',
    'candidate-promotion-patch.accepted.yellow.json',
    'candidate-promotion-review.perspective-blocked.yellow.json',
    'candidate-promotion-patch.perspective-blocked.yellow.json',
    'candidate-promotion-review.structural-review-blocked.yellow.json',
    'candidate-promotion-patch.structural-review-blocked.yellow.json',
    'candidate-promotion-review.calibration-topology-promotion-blocked.yellow.json',
    'candidate-promotion-patch.calibration-topology-promotion-blocked.yellow.json'
  ].map((name) => fs.rm(path.join(outputDir, name), { force: true })));
}

async function buildYellowStructuralProjectionPackage({
  intake,
  intakeDir,
  outputDir,
  sourceAbs,
  sourceImage
}) {
  const imageInfo = intake.observationSet?.images?.[0]?.image || {};
  const projection = await buildYellowBuildingStructuralProjection({
    sourceImagePath: sourceAbs,
    sourceImage,
    semanticEvidence: intake.buildingSingleSemanticEvidence,
    targetWidth: imageInfo.analysis_width || 900,
    targetHeight: imageInfo.analysis_height || 589
  });
  const calibratedViewGraph = buildYellowCalibratedViewGraph({
    structuralProjection: projection,
    sourceImage,
    profileId: 'building_single'
  });
  const calibratedViewReview = buildAcceptedYellowCalibratedViewReviewDecision({
    calibratedViewGraph
  });
  const cornerChainTopology = buildYellowCornerChainTopologyGraph({
    calibratedViewGraph,
    structuralProjection: projection,
    sourceImage,
    profileId: 'building_single'
  });
  const topologyReview = buildAcceptedYellowCornerChainTopologyReviewDecision({
    topologyGraph: cornerChainTopology
  });
  projection.plan_projection = planProjectionFromCornerChainTopology({
    topologyGraph: cornerChainTopology,
    structuralProjection: projection
  });
  projection.calibration_first = {
    calibrated_view_graph: 'yellow-calibrated-view-graph.json',
    corner_chain_topology: 'yellow-corner-chain-topology.json',
    calibrated_view_review: 'yellow-calibrated-view-review.accepted.json',
    corner_chain_topology_review: 'yellow-corner-chain-topology-review.accepted.json',
    status: 'accepted_for_derived_drafting_only',
    promotion_allowed: false
  };

  intake.structureEvidenceGraph = augmentStructureEvidenceGraphWithYellowProjection(
    intake.structureEvidenceGraph,
    projection
  );
  intake.draftViewGraph = buildDraftViewGraphV1({
    observationSet: intake.observationSet,
    structureEvidenceGraph: intake.structureEvidenceGraph
  });
  intake.facadePlaneGraph = facadePlaneGraphFromYellowProjection(intake.facadePlaneGraph, projection);
  intake.facadePlaneReviewOverlay = buildFacadePlaneReviewOverlay({
    facadePlaneGraph: intake.facadePlaneGraph
  });
  intake.calibratedViewGraph = calibratedViewGraph;
  intake.calibratedViewReview = calibratedViewReview;
  intake.cornerChainTopology = cornerChainTopology;
  intake.cornerChainTopologyReview = topologyReview;
  intake.observationSet = {
    ...intake.observationSet,
    structure_evidence_graph_v1: intake.structureEvidenceGraph,
    calibrated_view_graph_v1: intake.calibratedViewGraph,
    calibrated_view_review_decision_v1: intake.calibratedViewReview,
    corner_chain_topology_v1: intake.cornerChainTopology,
    corner_chain_topology_review_decision_v1: intake.cornerChainTopologyReview,
    draft_view_graph_v1: intake.draftViewGraph,
    facade_plane_graph_v1: intake.facadePlaneGraph,
    facade_plane_review_overlay_v1: intake.facadePlaneReviewOverlay
  };
  intake.mcpModelingBrief = buildMcpModelingBrief({
    assetSet: intake.assetSet,
    observationSet: intake.observationSet,
    candidateGraph: intake.candidateGraph,
    modelingBrief: intake.modelingBrief,
    promotionReview: intake.promotionReview,
    source: {
      structure_evidence_graph: 'intake/structure-evidence-graph.json',
      calibrated_view_graph: 'intake/calibrated-view-graph.json',
      corner_chain_topology: 'intake/corner-chain-topology.json',
      draft_view_graph: 'intake/draft-view-graph.json',
      facade_plane_graph: 'intake/facade-plane-graph.json'
    }
  });

  await writeYellowStructuralProjectionArtifacts({
    projection,
    calibratedViewGraph,
    calibratedViewReview,
    cornerChainTopology,
    topologyReview,
    outputDir,
    sourceAbs
  });
  await rewriteYellowIntakeDraftingArtifacts({
    intake,
    intakeDir
  });
  return projection;
}

async function writeYellowStructuralProjectionArtifacts({
  projection,
  calibratedViewGraph,
  calibratedViewReview,
  cornerChainTopology,
  topologyReview,
  outputDir,
  sourceAbs
}) {
  await writeJson(path.join(outputDir, 'yellow-structural-projection.json'), projection);
  await writeJson(path.join(outputDir, 'yellow-calibrated-view-graph.json'), calibratedViewGraph);
  await fs.writeFile(
    path.join(outputDir, 'yellow-calibrated-view-graph.md'),
    renderCalibratedViewGraphMarkdown(calibratedViewGraph),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'yellow-calibrated-view-review.accepted.json'), calibratedViewReview);
  await writeJson(path.join(outputDir, 'yellow-corner-chain-topology.json'), cornerChainTopology);
  await fs.writeFile(
    path.join(outputDir, 'yellow-corner-chain-topology.md'),
    renderCornerChainTopologyMarkdown(cornerChainTopology),
    'utf8'
  );
  await writeJson(path.join(outputDir, 'yellow-corner-chain-topology-review.accepted.json'), topologyReview);
  await fs.writeFile(
    path.join(outputDir, 'yellow-structural-methodology.md'),
    renderYellowStructuralMethodologyMarkdown(projection),
    'utf8'
  );
  await prepareYellowProjectionImageDataUrl(sourceAbs);
  await prepareCalibrationImageDataUrl(sourceAbs);
  const structuralProjectionSvg = renderYellowStructuralProjectionOverlaySvg(projection, sourceAbs);
  await writeSvgAndPng(
    path.join(outputDir, '02b-structural-projection-overlay.svg'),
    path.join(outputDir, '02b-structural-projection-overlay.png'),
    structuralProjectionSvg
  );
  const calibratedViewSvg = renderCalibratedViewOverlaySvg(calibratedViewGraph, sourceAbs);
  await writeSvgAndPng(
    path.join(outputDir, '02c-calibrated-view-overlay.svg'),
    path.join(outputDir, '02c-calibrated-view-overlay.png'),
    calibratedViewSvg
  );
  const topologyOverlaySvg = renderCornerChainTopologyOverlaySvg(cornerChainTopology, sourceAbs);
  await writeSvgAndPng(
    path.join(outputDir, '02d-corner-chain-topology-overlay.svg'),
    path.join(outputDir, '02d-corner-chain-topology-overlay.png'),
    topologyOverlaySvg
  );
  const facadeProjectionSvg = renderYellowFacadeProjectionSvg(projection);
  await writeSvgAndPng(
    path.join(outputDir, '03b-facade-projection.svg'),
    path.join(outputDir, '03b-facade-projection.png'),
    facadeProjectionSvg
  );
  const planProjectionSvg = renderYellowPlanProjectionSvg(projection);
  await writeSvgAndPng(
    path.join(outputDir, '03c-plan-projection.svg'),
    path.join(outputDir, '03c-plan-projection.png'),
    planProjectionSvg
  );
}

async function rewriteYellowIntakeDraftingArtifacts({ intake, intakeDir }) {
  await writeJson(path.join(intakeDir, 'structure-evidence-graph.json'), intake.structureEvidenceGraph);
  await fs.writeFile(
    path.join(intakeDir, 'structure-evidence-graph.md'),
    renderStructureEvidenceGraphMarkdown(intake.structureEvidenceGraph),
    'utf8'
  );
  if (intake.calibratedViewGraph) {
    await writeJson(path.join(intakeDir, 'calibrated-view-graph.json'), intake.calibratedViewGraph);
    await fs.writeFile(
      path.join(intakeDir, 'calibrated-view-graph.md'),
      renderCalibratedViewGraphMarkdown(intake.calibratedViewGraph),
      'utf8'
    );
  }
  if (intake.calibratedViewReview) {
    await writeJson(path.join(intakeDir, 'calibrated-view-review.accepted.json'), intake.calibratedViewReview);
  }
  if (intake.cornerChainTopology) {
    await writeJson(path.join(intakeDir, 'corner-chain-topology.json'), intake.cornerChainTopology);
    await fs.writeFile(
      path.join(intakeDir, 'corner-chain-topology.md'),
      renderCornerChainTopologyMarkdown(intake.cornerChainTopology),
      'utf8'
    );
  }
  if (intake.cornerChainTopologyReview) {
    await writeJson(path.join(intakeDir, 'corner-chain-topology-review.accepted.json'), intake.cornerChainTopologyReview);
  }
  await writeJson(path.join(intakeDir, 'draft-view-graph.json'), intake.draftViewGraph);
  await fs.writeFile(
    path.join(intakeDir, 'draft-view-graph.md'),
    renderDraftViewGraphMarkdown(intake.draftViewGraph),
    'utf8'
  );
  await fs.writeFile(
    path.join(intakeDir, 'draft-view-graph.svg'),
    renderDraftViewGraphSvg(intake.draftViewGraph),
    'utf8'
  );
  await writeJson(path.join(intakeDir, 'draft-view-review-overlay.json'), intake.draftViewGraph.review_overlay);
  if (intake.facadePlaneGraph) {
    await writeJson(path.join(intakeDir, 'facade-plane-graph.json'), intake.facadePlaneGraph);
    await fs.writeFile(
      path.join(intakeDir, 'facade-plane-graph.md'),
      renderFacadePlaneGraphMarkdown(intake.facadePlaneGraph),
      'utf8'
    );
  }
  if (intake.facadePlaneReviewOverlay) {
    await writeJson(path.join(intakeDir, 'facade-plane-review-overlay.json'), intake.facadePlaneReviewOverlay);
  }
  if (intake.mcpModelingBrief) {
    await writeJson(path.join(intakeDir, 'mcp-modeling-brief.json'), intake.mcpModelingBrief);
    await fs.writeFile(
      path.join(intakeDir, 'mcp-modeling-brief.md'),
      renderMcpModelingBriefMarkdown(intake.mcpModelingBrief),
      'utf8'
    );
  }
  await writeJson(path.join(intakeDir, 'observations.json'), intake.observationSet);
}

function buildYellowAcceptedReview({
  promotionReview,
  candidateGraph,
  draftViewGraph,
  objectSurfaceGraph,
  facadePlaneGraph,
  modelingBrief,
  assetSet
}) {
  const selectedCandidates = selectAcceptedCandidates(candidateGraph.candidates || []);
  const acceptedPlaneIds = (facadePlaneGraph?.planes || [])
    .map((plane) => plane.id)
    .filter((id) => ['visible_plane_primary', 'visible_plane_recessed_left'].includes(id));
  const acceptedSurfaceIds = (objectSurfaceGraph?.surfaces || [])
    .filter((surface) => surface.status !== 'unknown')
    .map((surface) => surface.id);
  const acceptedDetailIds = (facadePlaneGraph?.plane_local_detail_candidates || [])
    .filter((detail) => ACCEPTED_DETAIL_ROLES.has(detail.role))
    .map((detail) => detail.id);
  const acceptedSlotIds = (draftViewGraph?.view_slots || [])
    .filter((slot) => slot.status !== 'unknown')
    .map((slot) => slot.slot_id);
  const resolvedBlockers = unique([
    ...(assetSet.gates?.reasons || []),
    ...(modelingBrief.missing_inputs || []),
    ...(promotionReview.blockers || []),
    ...selectedCandidates.flatMap((candidate) => candidate.promotion?.blockers || candidate.blockers || []),
    'accepted_draft_view_review_required',
    'accepted_local_detail_review_required',
    'accepted_facade_plane_review_required',
    'accepted_facade_plane_ids_required',
    'accepted_surface_or_detail_ids_required',
    'profile_confirmation_required',
    'scale_confirmation_required'
  ]);
  const acceptedCandidates = selectedCandidates.map((candidate) => acceptedReviewItemFor({
    candidate,
    surfaceIds: acceptedSurfaceIds,
    detailIds: acceptedDetailIds,
    facadePlaneGraph
  }));
  const acceptedIds = new Set(acceptedCandidates.map((item) => item.candidate_id));
  return {
    ...cloneJson(promotionReview),
    reviewer: 'yellow-visible-effect-judgment-fixture',
    verdict: 'accepted_subset',
    promotion_allowed: true,
    compile_allowed: false,
    blockers: [],
    resolved_blockers: resolvedBlockers,
    missing_inputs: [],
    profile_confirmation: {
      selected_profile: promotionReview.profile_confirmation?.selected_profile || 'building_single',
      status: 'confirmed',
      note: 'Judgment fixture confirms profile only for accepted-review preview.'
    },
    scale_confirmation: {
      status: 'confirmed',
      units: 'mm',
      known_width: 9000,
      known_depth: 12000,
      known_height: 10500,
      note: 'Uses the building_single_urban_oblique profile default scale for preview only.'
    },
    draft_view_review: {
      source_draft_view_graph: 'draft-view-graph.json',
      status: 'accepted',
      accepted_view_slot_ids: acceptedSlotIds,
      accepted_plane_hypothesis_ids: (draftViewGraph?.view_slots || [])
        .flatMap((slot) => slot.visible_regions || [])
        .filter((region) => /^plane_visible_plane_/u.test(region.id || ''))
        .map((region) => region.id),
      promotion_allowed: true,
      blockers: [],
      reviewer_note: 'Accepted observed/inferred yellow building slots for a reviewed facade study; top remains unaccepted.'
    },
    local_detail_review: {
      source_object_surface_graph: 'object-surface-graph.json',
      source_facade_plane_graph: 'facade-plane-graph.json',
      status: 'accepted',
      accepted_surface_ids: acceptedSurfaceIds,
      accepted_detail_ids: acceptedDetailIds,
      promotion_allowed: true,
      blockers: [],
      reviewer_note: 'Accepted only plane-local details that can be rendered as review preview markers.'
    },
    facade_plane_review: {
      source_facade_plane_graph: 'facade-plane-graph.json',
      status: 'accepted',
      accepted_plane_ids: acceptedPlaneIds,
      promotion_allowed: true,
      blockers: [],
      reviewer_note: 'Accepted primary and recessed visible planes as separate planes; must_not_merge_with remains in the graph.'
    },
    accepted_candidates: acceptedCandidates,
    held_candidates: (candidateGraph.candidates || [])
      .filter((candidate) => !acceptedIds.has(candidate.id))
      .map(candidateReviewItemFor),
    notes: 'Yellow visible effect judgment fixture. Shadow/recess boundary remains held and must not drive cut geometry.'
  };
}

function buildPerspectiveCritique({ intake, structuralProjection = null }) {
  if (structuralProjection?.kind === 'yellow_building_structural_projection_v1') {
    return {
      version: 1,
      kind: 'yellow_perspective_critique_v1',
      status: 'calibration_topology_review_accepted_promotion_blocked',
      promotion_allowed: false,
      compile_allowed: false,
      blockers: ['accepted_partgraph_promotion_review_required', 'accepted_local_detail_review_required'],
      axis_issues: [],
      calibration_first: structuralProjection.calibration_first || null,
      plan_topology: {
        topology: structuralProjection.plan_projection?.footprint_topology || 'unknown',
        front_edge_policy: structuralProjection.plan_projection?.front_edge_policy || 'unknown',
        depth_order: structuralProjection.plan_projection?.depth_order || [],
        accepted_topology_id: structuralProjection.plan_projection?.accepted_topology_id || null
      },
      line_fit: {
        backend: structuralProjection.deterministic_backend,
        status: structuralProjection.vanishing.status,
        primary_facade_vanishing_point_px: structuralProjection.vanishing.primary_facade_vanishing_point_px,
        side_depth_vanishing_point_px: structuralProjection.vanishing.side_depth_vanishing_point_px,
        horizon_line_px: structuralProjection.vanishing.horizon_line_px,
        support_score: structuralProjection.vanishing.support_score,
        rejected_legacy_placeholder: structuralProjection.vanishing.rejected_legacy_placeholder
      },
      plane_issues: (structuralProjection.planes || []).map((plane) => ({
        id: plane.id,
        role: plane.role,
        source: 'yellow_structural_projection_line_fit',
        visible_quad_px: plane.visible_quad_px,
        perspective_status: 'line_fit_projection_review_ready',
        issue: 'accepted_partgraph_promotion_review_required_before_geometry'
      })),
      shadow_lighting_issues: structuralProjection.shadow_lighting_decisions || [],
      required_evidence: [
        'accepted PartGraph promotion review after calibrated-view and corner-chain topology review',
        'accepted local detail review before binding windows, HVAC, ducts, or storefront geometry',
        'metric scale evidence before any release-grade SketchUp dimensions'
      ],
      conclusion: 'Calibrated red/green/blue axis evidence and accepted A-B-C-D topology can derive drafting artifacts; PartGraph and SketchUp promotion remain blocked until accepted promotion/detail review.'
    };
  }
  const axisIssues = (intake.structureEvidenceGraph?.view_axis_hypotheses || [])
    .filter((axis) => axis.rejection_reason || axis.axis_fit_source === 'heuristic_projection_placeholder')
    .map((axis) => ({
      id: axis.id,
      source_image: axis.source_image,
      detected_view: axis.detected_view,
      axis_fit_source: axis.axis_fit_source || 'unknown',
      horizon_line_px: axis.horizon_line_px || null,
      vanishing_point_px: axis.vanishing_point_px || null,
      rejection_reason: axis.rejection_reason || 'axis_not_confirmed_by_roof_street_or_window_line_fit',
      review_status: axis.review_status
    }));
  const planeIssues = (intake.facadePlaneGraph?.planes || [])
    .map((plane) => {
      const cameraHints = plane.orientation_hint?.camera_hints || {};
      const weakProjection = cameraHints.projection_model === 'weak_oblique_affine_review_only'
        || plane.orientation_hint?.projection_model === 'weak_oblique_affine_review_only';
      return {
        id: plane.id,
        role: plane.role,
        source: plane.source?.kind || 'unknown',
        visible_quad_px: plane.visible_quad_px,
        perspective_status: weakProjection ? 'unverified_heuristic_projection' : 'needs_review',
        issue: weakProjection
          ? 'visible_quad_derived_without_real_roofline_streetline_or_window_band_vanishing_fit'
          : 'visible_quad_needs_plane_review'
      };
    });
  const shadowIssues = (intake.facadePlaneGraph?.plane_local_detail_candidates || [])
    .filter((detail) => detail.role === 'shadow_or_recess_boundary')
    .map((detail) => ({
      id: detail.id,
      role: detail.role,
      visible_quad_px: detail.visible_quad_px,
      issue: 'lighting_boundary_must_not_be_treated_as_depth_or_cut_geometry'
    }));
  const blockers = unique([
    ...(axisIssues.length ? ['perspective_line_fit_required'] : []),
    ...(planeIssues.some((issue) => issue.perspective_status === 'unverified_heuristic_projection') ? ['facade_plane_perspective_unverified'] : []),
    ...(shadowIssues.length ? ['shadow_lighting_geometry_disambiguation_required'] : [])
  ]);
  return {
    version: 1,
    kind: 'yellow_perspective_critique_v1',
    status: blockers.length ? 'blocked_perspective_unverified' : 'review',
    promotion_allowed: blockers.length === 0,
    compile_allowed: false,
    blockers,
    axis_issues: axisIssues,
    plane_issues: planeIssues,
    shadow_lighting_issues: shadowIssues,
    required_evidence: [
      'roof/building edge line segments grouped by vanishing family',
      'street curb / facade floor-band line segments grouped by vanishing family',
      'window-band or parapet line segments used to verify horizon and vanishing point',
      'explicit shadow-versus-geometry decision before any recess/cut interpretation'
    ],
    conclusion: blockers.length
      ? 'Perspective basis is not reliable enough for accepted PartGraph or SketchUp promotion.'
      : 'Perspective evidence is reviewable, but still requires accepted review before promotion.'
  };
}

function renderPerspectiveCritiqueMarkdown(report) {
  return `# Yellow Perspective Critique

- Status: \`${report.status}\`
- Promotion allowed: \`${report.promotion_allowed}\`
- Blockers: ${report.blockers.map((blocker) => `\`${blocker}\``).join(', ') || '`none`'}

${report.conclusion}

## Required Evidence

${report.required_evidence.map((item) => `- ${item}`).join('\n')}
`;
}

function buildPerspectiveBlockedReview({ promotionReview, candidateGraph, perspectiveCritique }) {
  return {
    ...cloneJson(promotionReview),
    reviewer: 'yellow-visible-effect-perspective-critique',
    verdict: 'blocked',
    promotion_allowed: false,
    compile_allowed: false,
    blockers: unique([
      ...(promotionReview.blockers || []),
      ...perspectiveCritique.blockers
    ]),
    resolved_blockers: [],
    profile_confirmation: {
      selected_profile: promotionReview.profile_confirmation?.selected_profile || 'building_single',
      status: promotionReview.profile_confirmation?.status || 'routed_unconfirmed',
      note: 'Profile is not enough to promote geometry while perspective is unverified.'
    },
    scale_confirmation: {
      status: 'needs_scale_confirmation',
      units: 'mm',
      note: 'Scale remains blocked until structural projection and metric evidence are accepted.'
    },
    draft_view_review: {
      ...(promotionReview.draft_view_review || {}),
      status: 'not_accepted',
      accepted_view_slot_ids: [],
      accepted_plane_hypothesis_ids: [],
      promotion_allowed: false,
      blockers: unique([
        ...(promotionReview.draft_view_review?.blockers || []),
        ...perspectiveCritique.blockers
      ]),
      reviewer_note: perspectiveCritique.conclusion
    },
    local_detail_review: {
      ...(promotionReview.local_detail_review || {}),
      status: 'not_accepted',
      accepted_surface_ids: [],
      accepted_detail_ids: [],
      promotion_allowed: false,
      blockers: unique([
        ...(promotionReview.local_detail_review?.blockers || []),
        ...perspectiveCritique.blockers,
        'accepted_local_detail_review_required'
      ]),
      reviewer_note: 'Local details cannot bind to facade planes until structural projection review accepts the target plane ids.'
    },
    facade_plane_review: {
      ...(promotionReview.facade_plane_review || {}),
      status: 'not_accepted',
      accepted_plane_ids: [],
      promotion_allowed: false,
      blockers: unique([
        ...(promotionReview.facade_plane_review?.blockers || []),
        ...perspectiveCritique.blockers
      ]),
      reviewer_note: 'Line-fit visible plane quads are review-ready but not accepted for promotion.'
    },
    accepted_candidates: [],
    held_candidates: (candidateGraph.candidates || []).map(candidateReviewItemFor),
    notes: perspectiveCritique.conclusion
  };
}

function blockedPartGraphPreview({ perspectiveCritique }) {
  return {
    version: 1,
    id: `yellow-visible-effect-blocked-${perspectiveCritique.status}`,
    profile_id: 'building_single_urban_oblique',
    compile_policy: {
      source: 'yellow_visible_effect_perspective_critique',
      blocked: true,
      require_promoted_geometry: true,
      blockers: perspectiveCritique.blockers
    },
    dsl_version: 1,
    units: 'mm',
    product: {
      type: 'building_single',
      name: 'Yellow Building Structural Review Blocked Preview',
      source: 'structural projection critique'
    },
    scale: {
      width: 0,
      depth: 0,
      height: 0,
      confidence: 0
    },
    parts: [],
    review: {
      status: perspectiveCritique.status,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: perspectiveCritique.blockers,
      perspective_critique: perspectiveCritique
    }
  };
}

function blockedDslPreview({ perspectiveCritique }) {
  return {
    version: 1,
    units: 'mm',
    metadata: {
      kind: 'blocked_sketchup_dsl_preview',
      profile_id: 'building_single',
      source: 'yellow_visible_effect_perspective_critique',
      promotion_allowed: false,
      blockers: perspectiveCritique.blockers
    },
    operations: []
  };
}

function selectAcceptedCandidates(candidates) {
  const byRole = new Map();
  for (const candidate of candidates) {
    if (!ACCEPTED_ROLES.has(candidate.role)) continue;
    if (candidate.role === 'shadow_or_recess_boundary') continue;
    const current = byRole.get(candidate.role);
    if (!current || candidateScore(candidate) > candidateScore(current)) byRole.set(candidate.role, candidate);
  }
  return Array.from(byRole.values()).sort((left, right) => {
    const roleOrder = Array.from(ACCEPTED_ROLES);
    return roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role);
  });
}

function candidateScore(candidate) {
  const semanticBonus = candidate.id?.includes('bse_v1') ? 0.2 : 0;
  const bboxBonus = Array.isArray(candidate.bbox) ? 0.05 : 0;
  return Number(candidate.confidence || 0) + semanticBonus + bboxBonus;
}

function acceptedReviewItemFor({ candidate, surfaceIds, detailIds, facadePlaneGraph }) {
  const detail = (facadePlaneGraph?.plane_local_detail_candidates || []).find((item) => item.role === candidate.role);
  return {
    ...candidateReviewItemFor(candidate),
    accepted_draft_view_slot_id: candidate.view === 'oblique' ? 'oblique_context' : candidate.view,
    accepted_surface_id: surfaceForRole(candidate.role, surfaceIds),
    accepted_detail_id: detail?.id && detailIds.includes(detail.id) ? detail.id : '',
    reviewer_note: reviewNoteForRole(candidate.role)
  };
}

function candidateReviewItemFor(candidate) {
  return {
    candidate_id: candidate.id,
    role: candidate.role,
    view: candidate.view || 'unknown',
    source_image: candidate.source_image || '',
    source_observation_id: candidate.source_observation_id || '',
    confidence: Number(candidate.confidence || 0),
    promotion_status: candidate.promotion?.status || candidate.promotion_status || 'blocked',
    blockers: candidate.promotion?.blockers || candidate.blockers || []
  };
}

function surfaceForRole(role, surfaceIds) {
  if (role === 'visible_plane_recessed_left' || role === 'rectangular_utility_ducts') {
    return surfaceIds.find((id) => id.includes('left_or_right_side')) || surfaceIds[0] || '';
  }
  if (role === 'building_main_mass') {
    return surfaceIds.find((id) => id.includes('oblique_context')) || surfaceIds[0] || '';
  }
  return surfaceIds.find((id) => id.includes('front')) || surfaceIds[0] || '';
}

function reviewNoteForRole(role) {
  if (role === 'visible_plane_primary') return 'Accepted as the primary visible facade plane; not renamed to front_facade_plane.';
  if (role === 'visible_plane_recessed_left') return 'Accepted as a separate recessed/return visible plane; must not merge with primary plane.';
  if (role === 'rectangular_utility_ducts') return 'Accepted as an external duct marker on the recessed plane.';
  return 'Accepted as a plane-local review preview marker.';
}

function enhanceYellowPreviewPartGraph(partGraph) {
  const next = cloneJson(partGraph);
  next.compile_policy = {
    source: 'yellow_visible_effect_accepted_review',
    preview_only: true,
    release_grade: false,
    require_promoted_geometry: true,
    block_reference_only_output: true
  };
  next.scale = {
    width: 9000,
    depth: 12000,
    height: 10500,
    confidence: 0.72,
    calibration: {
      strategy: 'accepted_review_profile_default_for_preview',
      release_grade: false
    }
  };
  next.review = {
    ...(next.review || {}),
    visible_effect_judgment: {
      status: 'accepted_review_preview',
      release_grade: false,
      note: 'Reviewed facade study for visual judgment; not a photo-grade reconstruction.'
    }
  };
  next.parts = (next.parts || []).map((part) => {
    const shape = previewShapeForRole(part.role);
    return {
      ...part,
      material: previewMaterialForRole(part.role, part.material),
      shape: shape || part.shape,
      evidence_status: part.evidence_status || 'manual_confirmed',
      grounding_status: 'review_confirmed',
      grounding_decision: 'promoted_geometry',
      review_required: true,
      promoted_geometry: true,
      qa: {
        ...(part.qa || {}),
        visible_effect_preview: true,
        release_grade: false,
        no_shadow_cut_geometry: part.role !== 'shadow_or_recess_boundary'
      }
    };
  });
  return next;
}

function previewShapeForRole(role) {
  const shapes = {
    building_main_mass: box([-4500, -6000, 0], [9000, 12000, 10500]),
    visible_plane_primary: box([250, -6250, 700], [5000, 180, 9000]),
    visible_plane_recessed_left: box([-4200, -6420, 650], [3600, 180, 9100]),
    upper_window_bands: box([650, -6550, 4200], [4200, 320, 3600]),
    ground_floor_storefront: box([850, -6650, 850], [3900, 420, 2100]),
    exterior_hvac_units: box([1100, -7050, 4950], [3600, 700, 1700]),
    rectangular_utility_ducts: box([-3700, -7150, 2300], [900, 900, 6400]),
    roof_parapet_and_rail: box([-3600, -6650, 10450], [7400, 380, 520])
  };
  return shapes[role] || null;
}

function box(origin, size) {
  return {
    primitive: 'box',
    parameters: { origin, size }
  };
}

function previewMaterialForRole(role, fallback) {
  if (role === 'building_main_mass') return 'Urban_Stucco_Yellow';
  if (role === 'visible_plane_primary') return 'Urban_Review_Marker';
  if (role === 'visible_plane_recessed_left') return 'Urban_Stucco_Shadow';
  if (role === 'upper_window_bands') return 'Urban_Glass_Blue';
  if (role === 'ground_floor_storefront') return 'Urban_Awning_Red';
  if (role === 'exterior_hvac_units' || role === 'rectangular_utility_ducts') return 'Urban_Utility_Metal';
  return fallback || 'Urban_Review_Marker';
}

function buildPreviewProfile(profile, originalRelPath) {
  const next = cloneJson(profile);
  next.description = `${profile.description || profile.name} Preview profile for yellow visible effect judgment; release geometry gate is disabled only for this generated artifact.`;
  next.compile_gate = { enabled: false };
  next.compiler = {
    ...(next.compiler || {}),
    geometry_gate: { enabled: false }
  };
  next.reference_images = [
    ...(next.reference_images || []),
    {
      id: 'yellow_source_reference',
      name: 'Yellow source image reference',
      source: originalRelPath,
      origin: [-4500, -6900, 0],
      plane: 'xz',
      size: [9000, 5890],
      alpha: 0.24,
      material: 'Urban_Review_Marker',
      texture_transform: {
        projection: 'planar',
        scale: [1, 1],
        rotation: 0
      }
    }
  ];
  next.review = {
    ...(next.review || {}),
    scenes: [
      ...(next.review?.scenes || []),
      {
        name: 'Yellow_Visible_Effect_Iso',
        camera: {
          eye: [11500, -17000, 9000],
          target: [0, -6100, 4800],
          up: [0, 0, 1],
          fov: 38
        }
      },
      {
        name: 'Yellow_Visible_Effect_Front',
        camera: {
          eye: [0, -21000, 5200],
          target: [0, -6200, 5200],
          up: [0, 0, 1],
          fov: 32
        }
      }
    ]
  };
  return next;
}

async function buildNoReviewReport({ outputDir, noReviewPatch, intake }) {
  const report = {
    status: 'blocked',
    patch_status: noReviewPatch.status,
    apply_allowed: noReviewPatch.apply_allowed === true,
    actions: (noReviewPatch.actions || []).length,
    blockers: noReviewPatch.blockers || [],
    false_promotion_count: noReviewPatch.apply_allowed === true || (noReviewPatch.actions || []).length > 0 ? 1 : 0,
    expected: {
      no_part_graph: true,
      no_sketchup_dsl: true,
      fail_closed_without_accepted_review: true
    },
    artifact_inputs: {
      structure_evidence_graph: 'intake/structure-evidence-graph.json',
      calibrated_view_graph: 'intake/calibrated-view-graph.json',
      corner_chain_topology: 'intake/corner-chain-topology.json',
      draft_view_graph: 'intake/draft-view-graph.json',
      facade_plane_graph: intake.facadePlaneGraph ? 'intake/facade-plane-graph.json' : null
    }
  };
  await writeJson(path.join(outputDir, 'no-review-promotion-blocked.json'), report);
  await writeJson(path.join(outputDir, 'candidate-promotion-patch.no-review.blocked.json'), noReviewPatch);
  return report;
}

async function buildMockSummary({ outputDir, dsl, dslPath }) {
  const bridge = new SketchUpBridge({
    mock: {
      sessionPath: path.join(outputDir, 'mock-session.json')
    }
  });
  const built = await bridge.build_model({
    runtime: 'mock',
    code: JSON.stringify(dsl)
  });
  return {
    ok: true,
    runtime: 'mock',
    source_dsl: path.relative(repoRoot, dslPath),
    operation_counts: operationCounts(dsl.operations || []),
    snapshot_summary: snapshotSummary(built.snapshot),
    warning_summary: built.snapshot?.warning_summary || null
  };
}

async function buildForgedReadyPatchReport({ outputDir, acceptedPatch, intake, profile }) {
  const forgedPatch = cloneJson(acceptedPatch);
  forgedPatch.source_review = 'forged-ready-without-accepted-review';
  forgedPatch.draft_view_review = {
    ...(forgedPatch.draft_view_review || {}),
    status: 'not_accepted',
    promotion_allowed: false,
    accepted_view_slot_ids: [],
    blockers: ['accepted_draft_view_review_required']
  };
  forgedPatch.local_detail_review = {
    ...(forgedPatch.local_detail_review || {}),
    status: 'not_accepted',
    promotion_allowed: false,
    accepted_surface_ids: [],
    accepted_detail_ids: [],
    blockers: ['accepted_local_detail_review_required']
  };
  const report = {
    status: 'not_run',
    expected_failure: true,
    error: null
  };
  try {
    applyCandidatePromotionPatch({
      patch: forgedPatch,
      candidateGraph: intake.candidateGraph,
      observationSet: intake.observationSet,
      profile
    });
    report.status = 'unexpected_success';
  } catch (error) {
    report.status = 'failed_closed';
    report.error = error.message;
  }
  await writeJson(path.join(outputDir, 'forged-ready-patch.fail-closed.json'), report);
  return report;
}

async function releaseProfileCompileStatus({ partGraph, profile }) {
  try {
    compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
    return {
      status: 'unexpected_success',
      expected_blocked: true,
      reason: null
    };
  } catch (error) {
    return {
      status: 'blocked',
      expected_blocked: true,
      reason: error.message
    };
  }
}

async function maybeRunLiveSketchUpPreview({ outputDir, dsl, timeoutMs = 180000 }) {
  const bridge = new SketchUpBridge();
  try {
    await bridge.build_model({
      runtime: 'queue',
      code: JSON.stringify(dsl),
      timeoutMs
    });
    const skpPath = path.join(outputDir, '08-sketchup-live-preview.skp');
    const saved = await bridge.save_model({
      runtime: 'queue',
      path: skpPath,
      timeoutMs
    });
    const isoPath = path.join(outputDir, '08-sketchup-live-iso.png');
    const topPath = path.join(outputDir, '08-sketchup-live-top.png');
    const iso = await bridge.capture_view({
      runtime: 'queue',
      path: isoPath,
      view: 'iso',
      width: 1400,
      height: 900,
      zoom_extents: true,
      timeoutMs
    });
    const top = await bridge.capture_view({
      runtime: 'queue',
      path: topPath,
      view: 'top',
      width: 1400,
      height: 900,
      zoom_extents: true,
      timeoutMs
    });
    return {
      requested: true,
      status: 'ok',
      skp: path.relative(repoRoot, saved.file_path || skpPath),
      captures: {
        iso: path.relative(repoRoot, iso.path || isoPath),
        top: path.relative(repoRoot, top.path || topPath)
      }
    };
  } catch (error) {
    return {
      requested: true,
      status: 'unavailable',
      error: error.message
    };
  }
}

function buildJudgmentReport({
  outputRel,
  intakeDir,
  originalPath,
  structureOverlayPngPath,
  draftOverlayPngPath,
  planeOverlayPngPath,
  mockPreviewPngPath,
  noReviewReport,
  acceptedReview,
  acceptedPatch,
  partGraph,
  dsl,
  mockSummary,
  liveSummary,
  forgedReadyPatchReport,
  releaseCompile,
  perspectiveCritique,
  structuralProjection,
  appliedCount,
  acceptedReviewPath,
  acceptedPatchPath
}) {
  const noReviewOk = noReviewReport.patch_status === 'blocked'
    && noReviewReport.actions === 0
    && noReviewReport.false_promotion_count === 0;
  const acceptedPreviewOk = acceptedPatch.status === 'ready_for_part_graph_patch'
    && acceptedPatch.apply_allowed === true
    && appliedCount > 0
    && (dsl.operations || []).some((operation) => operation.op === 'box')
    && mockSummary.ok === true;
  const overlaysOk = Boolean(structureOverlayPngPath && draftOverlayPngPath && planeOverlayPngPath);
  const topologyPlanOk = structuralProjection?.plan_projection?.footprint_topology === 'left_front_recess_notch'
    && (structuralProjection.plan_projection.footprint_local || []).length > 4;
  const overallVisibleDelta = acceptedPreviewOk && overlaysOk
    ? 'obvious'
    : topologyPlanOk && overlaysOk
      ? 'partial'
      : 'not_obvious';
  return {
    version: 1,
    kind: 'yellow_visible_effect_judgment',
    generated_at: new Date().toISOString(),
    sample: {
      id: 'building-single-anime-yellow',
      source_image: YELLOW_SOURCE,
      profile: 'building_single',
      output_dir: outputRel
    },
    artifact_links: {
      original: path.relative(repoRoot, originalPath),
      old_blocked_intake_review: maybeRelative('output/image-structured-modeler/building-single-intake-test/review/index.html'),
      current_intake_review: path.relative(repoRoot, path.join(intakeDir, 'review', 'index.html')),
      structure_overlay_png: path.relative(repoRoot, structureOverlayPngPath),
      draft_view_overlay_png: path.relative(repoRoot, draftOverlayPngPath),
      plane_review_overlay_png: path.relative(repoRoot, planeOverlayPngPath),
      structural_projection: `${outputRel}/yellow-structural-projection.json`,
      structural_projection_overlay_png: `${outputRel}/02b-structural-projection-overlay.png`,
      calibrated_view_graph: `${outputRel}/yellow-calibrated-view-graph.json`,
      calibrated_view_overlay_png: `${outputRel}/02c-calibrated-view-overlay.png`,
      calibrated_view_review: `${outputRel}/yellow-calibrated-view-review.accepted.json`,
      corner_chain_topology: `${outputRel}/yellow-corner-chain-topology.json`,
      corner_chain_topology_overlay_png: `${outputRel}/02d-corner-chain-topology-overlay.png`,
      corner_chain_topology_review: `${outputRel}/yellow-corner-chain-topology-review.accepted.json`,
      facade_projection_png: `${outputRel}/03b-facade-projection.png`,
      plan_projection_png: `${outputRel}/03c-plan-projection.png`,
      structural_methodology: `${outputRel}/yellow-structural-methodology.md`,
      sketchup_mock_preview_png: path.relative(repoRoot, mockPreviewPngPath),
      review_decision: path.relative(repoRoot, acceptedReviewPath),
      promotion_patch: path.relative(repoRoot, acceptedPatchPath),
      part_graph_preview: `${outputRel}/05-partgraph-preview.json`,
      sketchup_dsl_preview: `${outputRel}/06-sketchup-dsl.preview.json`,
      sketchup_mock_summary: `${outputRel}/07-sketchup-mock-summary.json`,
      comparison: `${outputRel}/comparison/index.html`
    },
    no_review_lane: {
      ok: noReviewOk,
      visible_delta: 'not_obvious',
      patch_status: noReviewReport.patch_status,
      apply_allowed: noReviewReport.apply_allowed,
      actions: noReviewReport.actions,
      blockers: noReviewReport.blockers,
      false_promotion_count: noReviewReport.false_promotion_count
    },
    accepted_review_lane: {
      ok: acceptedPreviewOk,
      visible_delta: acceptedPreviewOk ? 'obvious' : 'not_obvious',
      accepted_candidate_ids: (acceptedReview.accepted_candidates || []).map((item) => item.candidate_id),
      accepted_plane_ids: acceptedReview.facade_plane_review?.accepted_plane_ids || [],
      accepted_detail_ids: acceptedReview.local_detail_review?.accepted_detail_ids || [],
      patch_status: acceptedPatch.status,
      patch_actions: (acceptedPatch.actions || []).length,
      part_count: (partGraph.parts || []).length,
      dsl_operation_counts: operationCounts(dsl.operations || []),
      mock: mockSummary.snapshot_summary,
      release_profile_compile_status: releaseCompile,
      perspective_status: perspectiveCritique.status
    },
    perspective_critique: perspectiveCritique,
    structural_projection: structuralProjection ? {
      kind: structuralProjection.kind,
      status: structuralProjection.qa?.status || 'unknown',
      support_score: structuralProjection.qa?.support_score || 0,
      primary_plane_quad_px: structuralProjection.planes?.find((plane) => plane.id === 'visible_plane_primary')?.visible_quad_px || [],
      side_plane_quad_px: structuralProjection.planes?.find((plane) => plane.id === 'visible_plane_recessed_left')?.visible_quad_px || [],
      plan_projection: structuralProjection.plan_projection || null,
      horizon_line_px: structuralProjection.vanishing?.horizon_line_px || null,
      calibrated_view: structuralProjection.calibration_first || null,
      promotion_allowed: false
    } : null,
    fail_closed_checks: {
      no_review_patch_blocked: noReviewOk,
      forged_ready_without_accepted_review: forgedReadyPatchReport.status === 'failed_closed',
      forged_ready_error: forgedReadyPatchReport.error
    },
    live_sketchup: liveSummary,
    judgment: {
      visible_delta: overallVisibleDelta,
      conclusion: perspectiveCritique.promotion_allowed === false
        ? structuralProjection
          ? 'Calibration-first structure recognition now has red/green/blue axis families, accepted A-B-C-D corner-chain topology, and a derived left-front-recess plan; PartGraph and SketchUp promotion remain blocked until accepted promotion review.'
          : 'Drafting-first visible effect is not valid yet: horizon, vanishing point, facade plane quads, and shadow/geometry separation are perspective-unverified, so PartGraph and SketchUp promotion are blocked.'
        : acceptedPreviewOk
        ? 'Drafting-first is now visibly different only after accepted review: evidence overlays and a reviewed facade-study SketchUp preview are generated, while the no-review lane still intentionally produces no geometry.'
        : 'Current refactor remains mostly architectural/gate-level; visible SketchUp effect is still not obvious.',
      remaining_gaps: [
        structuralProjection
          ? 'Projection is relative and review-gated; exact recess depth, metric scale, and hidden rear geometry remain unresolved.'
          : 'Real line detection is still mixed with bbox and annotation-derived evidence.',
        structuralProjection
          ? 'Local details still need plane-local accepted review before PartGraph promotion.'
          : 'Top view and true scale remain review-confirmed rather than observed.',
        'Preview geometry is a reviewed facade study, not photo-grade reconstruction.',
        'Shadow ambiguity is still held and cannot drive cut geometry.'
      ]
    }
  };
}

function renderJudgmentMarkdown(report) {
  return `# Yellow Visible Effect Judgment

- Visible delta: \`${report.judgment.visible_delta}\`
- No-review lane: \`${report.no_review_lane.patch_status}\`, actions=${report.no_review_lane.actions}, false promotions=${report.no_review_lane.false_promotion_count}
- Accepted-review lane: \`${report.accepted_review_lane.patch_status}\`, actions=${report.accepted_review_lane.patch_actions}, parts=${report.accepted_review_lane.part_count}
- Calibration-first topology: \`${report.structural_projection?.plan_projection?.footprint_topology || 'not_run'}\`, depth_order=${(report.structural_projection?.plan_projection?.depth_order || []).map((order) => `${order.behind}->${order.in_front}`).join(',') || 'n/a'}
- Structural projection: \`${report.structural_projection?.status || 'not_run'}\`, support=${report.structural_projection?.support_score ?? 0}, depth_ratio=${report.structural_projection?.plan_projection?.depth_to_width_ratio ?? 'n/a'}
- Mock groups: \`${report.accepted_review_lane.mock?.totals?.groups ?? 0}\`
- Comparison: \`${report.artifact_links.comparison}\`

${report.judgment.conclusion}

## Remaining Gaps

${report.judgment.remaining_gaps.map((gap) => `- ${gap}`).join('\n')}
`;
}

async function writeComparisonHtml({ outputDir, report, noReviewReport }) {
  const comparisonDir = path.join(outputDir, 'comparison');
  await fs.mkdir(comparisonDir, { recursive: true });
  const previewBlocked = report.accepted_review_lane.ok !== true;
  const previewStatusClass = previewBlocked ? 'warn' : 'good';
  const previewStatusLabel = previewBlocked
    ? 'SketchUp preview blocked'
    : 'SketchUp preview generated';
  const blockerList = previewBlocked
    ? `<div class="blocked-state">
        <strong>${escapeHtml(previewStatusLabel)}</strong>
        <ul>${(report.perspective_critique?.blockers || []).map((blocker) => `<li>${escapeHtml(blocker)}</li>`).join('')}</ul>
      </div>`
    : '';
  const reviewDecisionHref = `../${path.basename(report.artifact_links.review_decision)}`;
  const promotionPatchHref = `../${path.basename(report.artifact_links.promotion_patch)}`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Yellow Visible Effect Judgment</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f4; color: #171a1d; }
    header { padding: 24px 28px 16px; border-bottom: 1px solid #d8ddd4; background: #fff; }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 720; letter-spacing: 0; }
    h2 { margin: 0 0 10px; font-size: 16px; }
    main { padding: 20px 28px 32px; }
    .summary { display: flex; gap: 10px; flex-wrap: wrap; }
    .tag { border: 1px solid #c7cec3; background: #fff; border-radius: 4px; padding: 5px 8px; font-size: 12px; }
    .tag.warn { border-color: #d7a737; background: #fff7d7; }
    .tag.good { border-color: #4f8d67; background: #e8f4ec; }
    .blocked-state { margin: 0 0 10px; padding: 10px 12px; border: 1px solid #d7a737; background: #fff7d7; border-radius: 4px; font-size: 13px; }
    .blocked-state ul { margin: 8px 0 0 18px; padding: 0; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 18px; align-items: start; }
    section { background: #fff; border: 1px solid #d8ddd4; border-radius: 6px; padding: 14px; min-width: 0; }
    img { display: block; width: 100%; height: auto; border: 1px solid #d6d9d2; background: #eef0eb; }
    img + img { margin-top: 10px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; background: #f1f3ef; padding: 10px; border-radius: 4px; }
    a { color: #1d4f7a; }
    @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Yellow Visible Effect Judgment</h1>
    <div class="summary">
      <span class="tag warn">overall=${escapeHtml(report.judgment.visible_delta)}</span>
      <span class="tag good">structure=${escapeHtml(report.structural_projection?.status || 'not_run')}</span>
      <span class="tag good">topology=${escapeHtml(report.structural_projection?.plan_projection?.footprint_topology || 'unknown')}</span>
      <span class="tag">no-review actions=${noReviewReport.actions}</span>
      <span class="tag ${previewStatusClass}">accepted actions=${report.accepted_review_lane.patch_actions}</span>
      <span class="tag">mock groups=${report.accepted_review_lane.mock?.totals?.groups ?? 0}</span>
    </div>
  </header>
  <main>
    <div class="grid">
      <section>
        <h2>Original + Structure Evidence</h2>
        <img src="../02-structure-overlay.png" alt="Structure evidence overlay">
        <p><a href="../02-structure-overlay.svg">SVG</a> · <a href="../intake/structure-evidence-graph.json">StructureEvidenceGraph</a></p>
      </section>
      <section>
        <h2>Line-fit Projection</h2>
        <img src="../02b-structural-projection-overlay.png" alt="Line-fit structural projection overlay">
        <p><a href="../yellow-structural-projection.json">Projection JSON</a> · <a href="../yellow-structural-methodology.md">Methodology</a></p>
      </section>
      <section>
        <h2>Calibration + Corner Chain</h2>
        <img src="../02c-calibrated-view-overlay.png" alt="Calibrated red green blue axis overlay">
        <img src="../02d-corner-chain-topology-overlay.png" alt="A B C D corner-chain topology overlay">
        <p><a href="../yellow-calibrated-view-graph.json">CalibratedViewGraph</a> · <a href="../yellow-corner-chain-topology.json">CornerChainTopology</a></p>
      </section>
      <section>
        <h2>Facade + Plan Projection</h2>
        <img src="../03b-facade-projection.png" alt="Rectified facade projection">
        <img src="../03c-plan-projection.png" alt="Relative plan projection">
        <p><a href="../03b-facade-projection.svg">Facade SVG</a> · <a href="../03c-plan-projection.svg">Plan SVG</a></p>
      </section>
      <section>
        <h2>Drafting-first Review Layer</h2>
        <img src="../04-plane-review-overlay.png" alt="Plane review overlay">
        <p><a href="../03-draft-view-graph.png">DraftViewGraph overlay</a> · <a href="../intake/facade-plane-graph.json">FacadePlaneGraph</a></p>
      </section>
      <section>
        <h2>Accepted Review SketchUp Preview</h2>
        ${blockerList}
        <img src="../07-sketchup-mock-preview.png" alt="SketchUp mock preview from accepted review DSL">
        <pre>${escapeHtml(JSON.stringify({
          dsl_operation_counts: report.accepted_review_lane.dsl_operation_counts,
          mock: report.accepted_review_lane.mock,
          release_profile_compile_status: report.accepted_review_lane.release_profile_compile_status.status
        }, null, 2))}</pre>
        <p><a href="../06-sketchup-dsl.preview.json">SketchUp DSL preview</a> · <a href="../07-sketchup-mock-summary.json">Mock summary</a></p>
      </section>
    </div>
    <section style="margin-top: 16px;">
      <h2>Judgment</h2>
      <p>${escapeHtml(report.judgment.conclusion)}</p>
      <p><a href="../judgment-report.json">judgment-report.json</a> · <a href="${reviewDecisionHref}">review decision</a> · <a href="${promotionPatchHref}">promotion patch</a> · <a href="../candidate-promotion-patch.no-review.blocked.json">no-review blocked patch</a></p>
    </section>
  </main>
</body>
</html>
`;
  await fs.writeFile(path.join(comparisonDir, 'index.html'), html, 'utf8');
}

async function renderStructureEvidenceOverlaySvg({ title, sourceImagePath, graph }) {
  const { width, height, dataUrl } = await imageDataUrlForOverlay(sourceImagePath, graph.source_provenance?.[0]);
  const planes = (graph.plane_hypotheses || []).slice(0, 40).map((plane, index) => polygonElement({
    points: plane.visible_quad_px,
    stroke: index % 2 ? '#7c3aed' : '#dc2626',
    fill: index % 2 ? '#7c3aed' : '#dc2626',
    opacity: 0.12,
    layer: 'plane-hypothesis',
    label: plane.role || plane.id
  })).join('\n');
  const edges = (graph.edge_evidence || []).slice(0, 180).map((edge) => lineElement({
    a: edge.line_px?.a,
    b: edge.line_px?.b,
    stroke: edgeColor(edge),
    opacity: edge.source_stage === 'image_observation_bbox' ? 0.55 : 0.35,
    layer: 'edge-evidence',
    label: `${edge.class || 'edge'}:${edge.source_stage || 'source'}`
  })).join('\n');
  const corners = (graph.corner_evidence || []).slice(0, 140).map((corner) => circleElement({
    point: corner.point_px,
    radius: 2.8,
    fill: '#facc15',
    layer: 'corner-evidence',
    label: corner.review_status || 'corner'
  })).join('\n');
  return svgShell({ width, height, title, dataUrl, body: `${planes}\n${edges}\n${corners}\n${legend([
    ['edge-evidence', '#0ea5e9'],
    ['corner-evidence', '#facc15'],
    ['plane-hypothesis', '#dc2626']
  ])}` });
}

async function renderDraftViewOverlaySvg({ title, sourceImagePath, graph }) {
  const source = firstSourceFromDraftGraph(graph);
  const { width, height, dataUrl } = await imageDataUrlForOverlay(sourceImagePath, {
    width: source?.width,
    height: source?.height
  });
  const colors = {
    front: '#2563eb',
    left_or_right_side: '#f97316',
    top: '#0f766e',
    oblique_context: '#7c3aed'
  };
  const body = (graph.view_slots || []).flatMap((slot) => {
    const color = colors[slot.slot_id] || '#64748b';
    const regions = (slot.visible_regions || []).slice(0, 14).map((region) => polygonElement({
      points: region.visible_quad_px,
      stroke: color,
      fill: color,
      opacity: slot.status === 'observed' ? 0.16 : 0.09,
      layer: `draft-view-${slot.slot_id}`,
      label: `${slot.slot_id}:${slot.status}:${region.role || region.id}`
    }));
    regions.push(textElement({
      x: 18,
      y: 28 + graph.view_slots.indexOf(slot) * 24,
      text: `${slot.slot_id}: ${slot.status} conf=${slot.confidence}`,
      fill: color,
      layer: 'draft-view-slot-label'
    }));
    return regions;
  }).join('\n');
  return svgShell({ width, height, title, dataUrl, body });
}

async function renderPlaneReviewOverlaySvg({ title, sourceImagePath, facadePlaneGraph }) {
  const firstPlane = facadePlaneGraph?.planes?.[0];
  const { width, height, dataUrl } = await imageDataUrlForOverlay(sourceImagePath, dimensionsFromQuad(firstPlane?.visible_quad_px));
  const planes = (facadePlaneGraph?.planes || []).map((plane, index) => polygonElement({
    points: plane.visible_quad_px,
    stroke: index ? '#2563eb' : '#f97316',
    fill: index ? '#2563eb' : '#f97316',
    opacity: 0.18,
    layer: 'facade-plane',
    label: `${plane.id}: review_required=${plane.review_required}`
  })).join('\n');
  const details = (facadePlaneGraph?.plane_local_detail_candidates || []).map((detail) => polygonElement({
    points: detail.visible_quad_px,
    stroke: detail.role === 'shadow_or_recess_boundary' ? '#6b7280' : '#16a34a',
    fill: detail.role === 'shadow_or_recess_boundary' ? '#6b7280' : '#16a34a',
    opacity: detail.role === 'shadow_or_recess_boundary' ? 0.08 : 0.14,
    layer: 'plane-local-detail',
    label: `${detail.role}: promotion_allowed=${detail.promotion_allowed}`
  })).join('\n');
  return svgShell({ width, height, title, dataUrl, body: `${planes}\n${details}\n${legend([
    ['facade-plane', '#f97316'],
    ['plane-local-detail', '#16a34a'],
    ['held shadow/recess reference', '#6b7280']
  ])}` });
}

function renderSketchUpDslMockPreviewSvg(dsl) {
  const materialColors = new Map((dsl.operations || [])
    .filter((operation) => operation.op === 'material')
    .map((operation) => [operation.name, operation.color || '#cccccc']));
  const boxes = (dsl.operations || [])
    .filter((operation) => operation.op === 'box')
    .map((operation) => boxFacesForOperation(operation, materialColors.get(operation.material) || '#d6d3c0'));
  const allPoints = boxes.flatMap((box) => box.faces.flatMap((face) => face.points));
  const projected = allPoints.map(projectIso);
  const bounds = boundsForPoints(projected);
  const canvas = { width: 1100, height: 740, pad: 58 };
  const scale = Math.min(
    (canvas.width - canvas.pad * 2) / Math.max(1, bounds.maxX - bounds.minX),
    (canvas.height - canvas.pad * 2) / Math.max(1, bounds.maxY - bounds.minY)
  );
  const transform = (point) => {
    const projectedPoint = projectIso(point);
    return [
      round((projectedPoint[0] - bounds.minX) * scale + canvas.pad),
      round((projectedPoint[1] - bounds.minY) * scale + canvas.pad)
    ];
  };
  const faces = boxes
    .flatMap((box) => box.faces.map((face) => ({ ...face, box })))
    .sort((left, right) => left.depth - right.depth)
    .map((face) => `<polygon data-layer="sketchup-mock-preview" points="${face.points.map(transform).map((point) => point.join(',')).join(' ')}" fill="${face.fill}" stroke="#27313a" stroke-width="1.5" fill-opacity="${face.opacity}">
      <title>${escapeXml(face.box.name)} ${escapeXml(face.kind)}</title>
    </polygon>`)
    .join('\n');
  const labels = boxes.map((box) => {
    const center = transform(box.center);
    return `<text data-layer="sketchup-mock-preview-label" x="${center[0]}" y="${center[1]}" font-size="13" text-anchor="middle" fill="#111827" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(box.role)}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" role="img" aria-label="SketchUp mock preview from accepted review DSL">
  <title>SketchUp mock preview from accepted review DSL</title>
  <rect width="${canvas.width}" height="${canvas.height}" fill="#eef2f1"/>
  <g transform="translate(0 0)">
    ${faces}
    ${labels}
  </g>
  <text x="26" y="36" font-size="18" font-weight="700" fill="#17202a">Accepted-review facade study preview</text>
  <text x="26" y="62" font-size="13" fill="#44515c">Mock rendering from SketchUp DSL; live SketchUp capture is optional.</text>
</svg>
`;
}

function renderBlockedSketchUpPreviewSvg(perspectiveCritique) {
  const blockers = perspectiveCritique.blockers.map((blocker) => `<text x="56" y="${230 + perspectiveCritique.blockers.indexOf(blocker) * 30}" font-size="18" fill="#7a271a">- ${escapeXml(blocker)}</text>`).join('\n');
  const hasProjection = perspectiveCritique.status === 'projection_review_ready'
    || perspectiveCritique.status === 'projection_review_ready_with_warnings'
    || perspectiveCritique.status === 'calibration_topology_review_accepted_promotion_blocked';
  const message = hasProjection
    ? 'Calibrated view axes and the A-B-C-D corner topology can drive drafting, but no accepted promotion review exists yet.'
    : 'The facade plane graph is perspective-unverified. No PartGraph or SketchUp geometry should be promoted from this image yet.';
  const footer = hasProjection
    ? 'This is the correct fail-closed result: drafting evidence is available, promotion still requires accepted PartGraph/detail review.'
    : 'This is the correct fail-closed result after reviewing roof/building edges, shadows, and the invalid vanishing point.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="740" viewBox="0 0 1100 740" role="img" aria-label="SketchUp preview blocked by perspective critique">
  <title>SketchUp preview blocked by perspective critique</title>
  <rect width="1100" height="740" fill="#f6f1ea"/>
  <rect x="38" y="44" width="1024" height="652" rx="6" fill="#fffaf4" stroke="#c6a68d" stroke-width="2"/>
  <text x="56" y="96" font-size="30" font-weight="700" fill="#361f17">SketchUp preview blocked</text>
  <text x="56" y="136" font-size="18" fill="#4d342a">${escapeXml(message)}</text>
  <text x="56" y="188" font-size="22" font-weight="700" fill="#5f2b1f">Blockers</text>
  ${blockers}
  <text x="56" y="390" font-size="22" font-weight="700" fill="#28323a">Required evidence before promotion</text>
  ${perspectiveCritique.required_evidence.map((item, index) => `<text x="56" y="${430 + index * 28}" font-size="17" fill="#334155">- ${escapeXml(item)}</text>`).join('\n')}
  <text x="56" y="610" font-size="16" fill="#64748b">${escapeXml(footer)}</text>
</svg>
`;
}

function boxFacesForOperation(operation, fallbackColor) {
  const origin = operation.origin || [0, 0, 0];
  const size = operation.size || [1, 1, 1];
  const [x, y, z] = origin.map(Number);
  const [w, d, h] = size.map(Number);
  const points = [
    [x, y, z],
    [x + w, y, z],
    [x + w, y + d, z],
    [x, y + d, z],
    [x, y, z + h],
    [x + w, y, z + h],
    [x + w, y + d, z + h],
    [x, y + d, z + h]
  ];
  const base = normalizeColor(fallbackColor);
  const center = [x + w / 2, y + d / 2, z + h / 2];
  const role = operation.qa?.role || operation.id || 'box';
  const opacity = opacityForPreviewRole(role);
  return {
    id: operation.id,
    name: operation.name || operation.id || 'box',
    role,
    center,
    faces: [
      face('top', [points[4], points[5], points[6], points[7]], shadeColor(base, 1.15), Math.min(0.9, opacity + 0.05)),
      face('front', [points[0], points[1], points[5], points[4]], shadeColor(base, 1), opacity),
      face('side', [points[1], points[2], points[6], points[5]], shadeColor(base, 0.78), opacity)
    ]
  };
}

function opacityForPreviewRole(role) {
  if (role === 'building_main_mass') return 0.34;
  if (/visible_plane/u.test(role)) return 0.58;
  return 0.9;
}

function face(kind, points, fill, opacity) {
  return {
    kind,
    points,
    fill,
    opacity,
    depth: points.reduce((sum, point) => sum + point[0] + point[1] + point[2], 0) / Math.max(1, points.length)
  };
}

function projectIso(point) {
  const [x, y, z] = point;
  return [
    (x - y) * 0.86,
    (x + y) * 0.42 - z * 0.92
  ];
}

function boundsForPoints(points) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxX: Math.max(...points.map((point) => point[0])),
    maxY: Math.max(...points.map((point) => point[1]))
  };
}

function normalizeColor(color) {
  const value = String(color || '#cccccc');
  return /^#[0-9a-fA-F]{6}$/u.test(value) ? value : '#cccccc';
}

function shadeColor(color, factor) {
  const hex = normalizeColor(color).slice(1);
  const parts = [0, 2, 4].map((index) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(index, index + 2), 16) * factor))));
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function svgShell({ width, height, title, dataUrl, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <title>${escapeXml(title)}</title>
  <image href="${dataUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" opacity="0.86"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#111827" stroke-width="1"/>
  ${body}
</svg>
`;
}

function polygonElement({ points, stroke, fill, opacity, layer, label }) {
  const normalized = (points || []).filter((point) => Array.isArray(point) && point.length >= 2);
  if (normalized.length < 2) return '';
  return `<polygon data-layer="${escapeXml(layer)}" points="${normalized.map((point) => `${round(point[0])},${round(point[1])}`).join(' ')}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2.4">
    <title>${escapeXml(label)}</title>
  </polygon>`;
}

function lineElement({ a, b, stroke, opacity, layer, label }) {
  if (!Array.isArray(a) || !Array.isArray(b)) return '';
  return `<line data-layer="${escapeXml(layer)}" x1="${round(a[0])}" y1="${round(a[1])}" x2="${round(b[0])}" y2="${round(b[1])}" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="1.8">
    <title>${escapeXml(label)}</title>
  </line>`;
}

function circleElement({ point, radius, fill, layer, label }) {
  if (!Array.isArray(point)) return '';
  return `<circle data-layer="${escapeXml(layer)}" cx="${round(point[0])}" cy="${round(point[1])}" r="${radius}" fill="${fill}" fill-opacity="0.85">
    <title>${escapeXml(label)}</title>
  </circle>`;
}

function textElement({ x, y, text, fill, layer }) {
  return `<text data-layer="${escapeXml(layer)}" x="${x}" y="${y}" fill="${fill}" font-size="16" font-weight="700" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(text)}</text>`;
}

function legend(items) {
  return `<g data-layer="overlay-legend" font-family="Inter, Arial, sans-serif" font-size="14">
    ${items.map(([label, color], index) => `<g transform="translate(18 ${24 + index * 22})"><rect width="13" height="13" fill="${color}" opacity="0.8"/><text x="20" y="12" fill="#111827" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escapeXml(label)}</text></g>`).join('\n')}
  </g>`;
}

function edgeColor(edge) {
  if (edge.source_stage === 'image_observation_bbox') return '#0ea5e9';
  if (/semantic|annotation/u.test(edge.source_stage || '')) return '#dc2626';
  if (edge.rejection_reason) return '#6b7280';
  return '#22c55e';
}

async function imageDataUrlForOverlay(sourceImagePath, dimensions = {}) {
  const bytes = await fs.readFile(sourceImagePath);
  const metadata = await sharp(bytes).metadata();
  const width = Math.round(Number(dimensions?.width || metadata.width || 900));
  const height = Math.round(Number(dimensions?.height || metadata.height || 589));
  const ext = path.extname(sourceImagePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return {
    width,
    height,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`
  };
}

function firstSourceFromDraftGraph(graph) {
  const region = (graph.view_slots || []).flatMap((slot) => slot.visible_regions || [])[0];
  return dimensionsFromQuad(region?.visible_quad_px);
}

function dimensionsFromQuad(quad) {
  const points = (quad || []).filter((point) => Array.isArray(point));
  if (!points.length) return {};
  return {
    width: Math.max(900, Math.ceil(Math.max(...points.map((point) => Number(point[0]) || 0)))),
    height: Math.max(589, Math.ceil(Math.max(...points.map((point) => Number(point[1]) || 0))))
  };
}

async function writeSvgAndPng(svgPath, pngPath, svg) {
  await fs.mkdir(path.dirname(svgPath), { recursive: true });
  await fs.writeFile(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
}

function operationCounts(operations) {
  return operations.reduce((acc, operation) => {
    acc[operation.op] = (acc[operation.op] || 0) + 1;
    return acc;
  }, {});
}

function snapshotSummary(snapshot = {}) {
  return {
    totals: snapshot.totals || null,
    bounding_box: snapshot.bounding_box || null,
    scenes: (snapshot.scenes || []).map((scene) => scene.name),
    material_names: snapshot.material_names || []
  };
}

function maybeRelative(relativePath) {
  return relativePath;
}

function unique(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeHtml(value) {
  return escapeXml(value).replaceAll("'", '&#39;');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--live') options.live = true;
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/generate-yellow-visible-effect.mjs [--output-dir output/image-structured-modeler/yellow-visible-effect] [--live]
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateYellowVisibleEffect(parseArgs(process.argv.slice(2))).then((result) => {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      output_dir: result.outputDir,
      visible_delta: result.report.judgment.visible_delta,
      no_review_actions: result.report.no_review_lane.actions,
      accepted_actions: result.report.accepted_review_lane.patch_actions,
      mock_groups: result.report.accepted_review_lane.mock?.totals?.groups ?? 0,
      comparison: result.report.artifact_links.comparison
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
