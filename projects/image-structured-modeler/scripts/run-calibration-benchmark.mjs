#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildStructureLineEvidence } from './lib/opencv-structure-line-backend.mjs';
import { buildPerspectiveCalibrationHypotheses } from './lib/perspective-calibration.mjs';
import {
  buildAcceptedPerspectiveCalibrationReviewFixture,
  buildPendingPerspectiveCalibrationReview,
  evaluatePerspectiveCalibrationReview
} from './lib/perspective-calibration-review.mjs';
import {
  applyCornerChainTopologyReview,
  buildAcceptedCornerChainTopologyReviewFixture,
  buildCalibratedViewGraphFromPerspectiveReview,
  buildCornerChainTopologyCandidates,
  buildDraftViewGraphFromTopologyReview,
  buildFacadePlaneGraphFromCalibratedSeed,
  buildPendingCornerChainTopologyReview,
  renderCalibratedPlaneTopologyOverlaySvg
} from './lib/calibrated-plane-topology.mjs';
import {
  buildCalibrationBenchmarkReport,
  renderCalibrationBenchmarkArtifacts,
  renderCalibrationBenchmarkMarkdown
} from './lib/calibration-benchmark.mjs';
import {
  buildMcpModelingBrief,
  renderMcpModelingBriefMarkdown
} from './lib/mcp-modeling-brief.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_TRUTH = 'projects/image-structured-modeler/examples/building-single-anime-yellow/calibration-ground-truth.draft.json';
const DEFAULT_TOPOLOGY_SEED = 'projects/image-structured-modeler/examples/building-single-anime-yellow/plane-topology-review-seed.draft.json';
const DEFAULT_DETAIL_SEED = 'projects/image-structured-modeler/examples/building-single-anime-yellow/plane-local-detail-seed.draft.json';
const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/calibration-benchmark/yellow-building';

export async function runCalibrationBenchmark(options = {}) {
  const truthPath = path.resolve(repoRoot, options.truth || DEFAULT_TRUTH);
  const topologySeedPath = path.resolve(repoRoot, options.topologySeed || DEFAULT_TOPOLOGY_SEED);
  const detailSeedPath = path.resolve(repoRoot, options.detailSeed || DEFAULT_DETAIL_SEED);
  const outputDir = path.resolve(repoRoot, options.outputDir || DEFAULT_OUTPUT_DIR);
  const groundTruth = JSON.parse(await fs.readFile(truthPath, 'utf8'));
  const topologySeed = JSON.parse(await fs.readFile(topologySeedPath, 'utf8'));
  const localDetailSeed = JSON.parse(await fs.readFile(detailSeedPath, 'utf8'));
  const sourceImagePath = path.resolve(repoRoot, groundTruth.source_image);
  const structureLineEvidence = await buildStructureLineEvidence({
    sourceImagePath,
    sourceImage: groundTruth.source_image,
    maxWidth: groundTruth.image_size.width
  });
  const perspectiveCalibration = buildPerspectiveCalibrationHypotheses({
    structureLineEvidence,
    sourceStructureLineEvidence: 'structure-line-evidence.json'
  });
  const report = buildCalibrationBenchmarkReport({
    groundTruth,
    structureLineEvidence,
    perspectiveCalibration
  });
  const pendingReview = buildPendingPerspectiveCalibrationReview({ perspectiveCalibration });
  const pendingReviewResult = evaluatePerspectiveCalibrationReview({
    perspectiveCalibration,
    reviewDecision: pendingReview,
    sourceReviewDecision: 'perspective-calibration-review.pending.json'
  });
  const acceptedReviewFixture = await resolveReviewDecision({
    option: options.calibrationReview,
    fallback: () => buildAcceptedPerspectiveCalibrationReviewFixture({ perspectiveCalibration })
  });
  const acceptedReviewFixtureResult = evaluatePerspectiveCalibrationReview({
    perspectiveCalibration,
    reviewDecision: acceptedReviewFixture,
    sourceReviewDecision: 'perspective-calibration-review.accepted-fixture.json'
  });
  const blockedFacadePlaneGraph = buildFacadePlaneGraphFromCalibratedSeed({
    calibrationReviewResult: pendingReviewResult,
    calibratedViewGraph: null,
    topologySeed,
    localDetailSeed
  });
  const calibratedViewGraph = buildCalibratedViewGraphFromPerspectiveReview({
    perspectiveCalibration,
    calibrationReviewResult: acceptedReviewFixtureResult,
    structureLineEvidence,
    topologySeed
  });
  const facadePlaneGraph = buildFacadePlaneGraphFromCalibratedSeed({
    calibrationReviewResult: acceptedReviewFixtureResult,
    calibratedViewGraph,
    topologySeed,
    localDetailSeed
  });
  const cornerChainTopology = buildCornerChainTopologyCandidates({
    calibrationReviewResult: acceptedReviewFixtureResult,
    calibratedViewGraph,
    topologySeed
  });
  const pendingTopologyReview = buildPendingCornerChainTopologyReview({ topologyGraph: cornerChainTopology });
  const pendingTopologyReviewResult = applyCornerChainTopologyReview({
    topologyGraph: cornerChainTopology,
    reviewDecision: pendingTopologyReview
  });
  const acceptedTopologyReviewFixture = await resolveReviewDecision({
    option: options.topologyReview,
    fallback: () => buildAcceptedCornerChainTopologyReviewFixture({ topologyGraph: cornerChainTopology })
  });
  const acceptedTopologyReviewFixtureResult = applyCornerChainTopologyReview({
    topologyGraph: cornerChainTopology,
    reviewDecision: acceptedTopologyReviewFixture
  });
  const blockedDraftViewGraph = buildDraftViewGraphFromTopologyReview({
    topologyReviewResult: pendingTopologyReviewResult,
    facadePlaneGraph: blockedFacadePlaneGraph,
    sourceImage: groundTruth.source_image
  });
  const acceptedTopologyDraftViewGraph = buildDraftViewGraphFromTopologyReview({
    topologyReviewResult: acceptedTopologyReviewFixtureResult,
    facadePlaneGraph,
    sourceImage: groundTruth.source_image
  });
  const mcpModelingBrief = buildCalibrationMcpModelingBrief({
    groundTruth,
    structureLineEvidence,
    perspectiveCalibration,
    acceptedReviewFixture,
    acceptedReviewFixtureResult,
    calibratedViewGraph,
    facadePlaneGraph,
    cornerChainTopology: acceptedTopologyReviewFixtureResult.topology_graph,
    acceptedTopologyReviewFixture,
    acceptedTopologyDraftViewGraph
  });
  const sourceBuffer = await sharp(sourceImagePath).png().toBuffer();
  const topologyOverlaySvg = renderCalibratedPlaneTopologyOverlaySvg({
    facadePlaneGraph,
    topologyGraph: cornerChainTopology,
    imageDataUrl: `data:image/png;base64,${sourceBuffer.toString('base64')}`,
    imageSize: structureLineEvidence.source_image
  });
  const artifacts = await renderCalibrationBenchmarkArtifacts({
    groundTruth,
    structureLineEvidence,
    perspectiveCalibration,
    report,
    sourceImagePath,
    topologySvg: topologyOverlaySvg
  });
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeJson(path.join(outputDir, 'calibration-ground-truth.json'), groundTruth),
    writeJson(path.join(outputDir, 'plane-topology-review-seed.json'), topologySeed),
    writeJson(path.join(outputDir, 'plane-local-detail-seed.json'), localDetailSeed),
    writeJson(path.join(outputDir, 'structure-line-evidence.json'), structureLineEvidence),
    writeJson(path.join(outputDir, 'perspective-calibration-hypotheses.json'), perspectiveCalibration),
    writeJson(path.join(outputDir, 'calibration-benchmark-report.json'), report),
    writeJson(path.join(outputDir, 'perspective-calibration-review.template.json'), pendingReview),
    writeJson(path.join(outputDir, 'perspective-calibration-review.pending.json'), pendingReview),
    writeJson(path.join(outputDir, 'perspective-calibration-review-result.pending.json'), pendingReviewResult),
    writeJson(path.join(outputDir, 'perspective-calibration-review.accepted-fixture.json'), acceptedReviewFixture),
    writeJson(path.join(outputDir, 'perspective-calibration-review-result.accepted-fixture.json'), acceptedReviewFixtureResult),
    writeJson(path.join(outputDir, 'facade-plane-graph.pending-calibration.blocked.json'), blockedFacadePlaneGraph),
    writeJson(path.join(outputDir, 'calibrated-view-graph.accepted-calibration-fixture.json'), calibratedViewGraph),
    writeJson(path.join(outputDir, 'facade-plane-graph.accepted-calibration.candidates.json'), facadePlaneGraph),
    writeJson(path.join(outputDir, 'corner-chain-topology.candidates.json'), cornerChainTopology),
    writeJson(path.join(outputDir, 'corner-chain-topology-review.pending.json'), pendingTopologyReview),
    writeJson(path.join(outputDir, 'corner-chain-topology-review.accepted-fixture.json'), acceptedTopologyReviewFixture),
    writeJson(path.join(outputDir, 'corner-chain-topology.accepted-fixture.json'), acceptedTopologyReviewFixtureResult.topology_graph),
    writeJson(path.join(outputDir, 'draft-view-graph.pending-topology.blocked.json'), blockedDraftViewGraph),
    writeJson(path.join(outputDir, 'draft-view-graph.accepted-topology-fixture.json'), acceptedTopologyDraftViewGraph),
    writeJson(path.join(outputDir, 'mcp-modeling-brief.json'), mcpModelingBrief),
    fs.writeFile(path.join(outputDir, 'mcp-modeling-brief.md'), renderMcpModelingBriefMarkdown(mcpModelingBrief), 'utf8'),
    fs.writeFile(path.join(outputDir, 'calibration-benchmark-report.md'), renderCalibrationBenchmarkMarkdown(report), 'utf8'),
    writeSvgAndPng(path.join(outputDir, '01-structure-line-evidence.svg'), path.join(outputDir, '01-structure-line-evidence.png'), artifacts.evidenceSvg),
    writeSvgAndPng(path.join(outputDir, '02-perspective-direction-families.svg'), path.join(outputDir, '02-perspective-direction-families.png'), artifacts.familySvg),
    writeSvgAndPng(path.join(outputDir, '03-ground-truth-review.svg'), path.join(outputDir, '03-ground-truth-review.png'), artifacts.truthSvg),
    writeSvgAndPng(path.join(outputDir, '04-calibrated-plane-topology.svg'), path.join(outputDir, '04-calibrated-plane-topology.png'), topologyOverlaySvg),
    fs.writeFile(path.join(outputDir, 'index.html'), artifacts.html, 'utf8')
  ]);
  return {
    ok: true,
    outputDir,
    groundTruth,
    topologySeed,
    localDetailSeed,
    structureLineEvidence,
    perspectiveCalibration,
    report,
    pendingReview,
    pendingReviewResult,
    acceptedReviewFixture,
    acceptedReviewFixtureResult,
    blockedFacadePlaneGraph,
    calibratedViewGraph,
    facadePlaneGraph,
    cornerChainTopology,
    pendingTopologyReview,
    pendingTopologyReviewResult,
    acceptedTopologyReviewFixture,
    acceptedTopologyReviewFixtureResult,
    blockedDraftViewGraph,
    acceptedTopologyDraftViewGraph,
    mcpModelingBrief
  };
}

async function resolveReviewDecision({ option, fallback }) {
  if (!option) return fallback();
  if (typeof option === 'object') return structuredClone(option);
  return JSON.parse(await fs.readFile(path.resolve(repoRoot, option), 'utf8'));
}

function buildCalibrationMcpModelingBrief({
  groundTruth,
  structureLineEvidence,
  perspectiveCalibration,
  acceptedReviewFixture,
  acceptedReviewFixtureResult,
  calibratedViewGraph,
  facadePlaneGraph,
  cornerChainTopology,
  acceptedTopologyReviewFixture,
  acceptedTopologyDraftViewGraph
}) {
  const assetSet = {
    id: `${groundTruth.sample_id || 'facade'}-calibration-benchmark`,
    assets: [{
      id: groundTruth.image_id || 'source_image_1',
      path: groundTruth.source_image,
      media_type: 'image',
      detected_view: 'oblique',
      quality: 'review'
    }],
    gates: {
      reasons: ['accepted_user_calibration_and_topology_review_required']
    }
  };
  const candidateGraph = {
    profile_id: 'building_single',
    geometry_strategy: 'calibrated_manhattan_planes',
    candidates: [
      ...facadePlaneGraph.planes.map((plane) => ({
        id: plane.id,
        role: plane.role,
        source_image: plane.source_image,
        source_observation_id: plane.source.semantic_evidence_id,
        view: plane.orientation_hint.view,
        confidence: plane.source.confidence,
        promotion: {
          status: 'review_required',
          blockers: ['accepted_facade_plane_review_required']
        }
      })),
      ...facadePlaneGraph.plane_local_detail_candidates.map((detail) => ({
        id: detail.id,
        role: detail.role,
        source_image: detail.source_image,
        source_observation_id: detail.source.semantic_evidence_id,
        ...(detail.candidate_plane_ids.length === 1 ? { source_plane_id: detail.candidate_plane_ids[0] } : {}),
        view: detail.view,
        confidence: detail.source.confidence,
        promotion: {
          status: 'review_required',
          blockers: detail.blockers
        }
      }))
    ]
  };
  const modelingBrief = {
    profile_id: 'building_single',
    status: 'needs_review',
    compile_allowed: false,
    missing_inputs: [
      'accepted_user_perspective_calibration_review_required',
      'accepted_user_corner_chain_topology_review_required',
      'accepted_draft_view_review_required',
      'accepted_facade_plane_review_required',
      'accepted_local_detail_review_required'
    ]
  };
  const promotionReview = {
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_partgraph_promotion_review_required'],
    calibration_review: {
      source_perspective_calibration_review_result: 'perspective-calibration-review-result.accepted-fixture.json',
      status: acceptedReviewFixtureResult.status,
      accepted_axis_family_ids: acceptedReviewFixtureResult.accepted_axis_families.map((family) => family.direction_family_id),
      rectification_allowed: acceptedReviewFixtureResult.rectification_allowed,
      topology_inference_allowed: acceptedReviewFixtureResult.topology_inference_allowed,
      promotion_allowed: false,
      blockers: acceptedReviewFixtureResult.blockers
    },
    topology_review: {
      source_corner_chain_topology_review: 'corner-chain-topology-review.accepted-fixture.json',
      status: 'accepted_for_derived_drafting',
      accepted_topology_ids: acceptedTopologyReviewFixture.accepted_topology_ids,
      derived_drafting_allowed: true,
      promotion_allowed: false,
      blockers: ['accepted_draft_view_review_required', 'accepted_partgraph_promotion_review_required']
    },
    draft_view_review: null,
    facade_plane_review: null,
    local_detail_review: null
  };
  const observationSet = {
    views_detected: ['oblique'],
    missing_views: ['front', 'left_or_right_side', 'top'],
    scale_calibration: {
      confidence: 0,
      strategy: 'unknown_single_view_metric_scale'
    },
    quality_report: {
      risks: ['single_view_metric_depth_unknown', 'fixture_reviews_are_not_user_acceptance']
    },
    structure_line_evidence_v2: structureLineEvidence,
    perspective_calibration_hypotheses_v1: perspectiveCalibration,
    perspective_calibration_review_decision_v1: acceptedReviewFixture,
    perspective_calibration_review_result_v1: acceptedReviewFixtureResult,
    calibrated_view_graph_v1: calibratedViewGraph,
    corner_chain_topology_v1: cornerChainTopology,
    draft_view_graph_v1: acceptedTopologyDraftViewGraph,
    facade_plane_graph_v1: facadePlaneGraph
  };
  return buildMcpModelingBrief({
    assetSet,
    observationSet,
    candidateGraph,
    modelingBrief,
    promotionReview,
    source: {
      structure_line_evidence: 'structure-line-evidence.json',
      perspective_calibration_hypotheses: 'perspective-calibration-hypotheses.json',
      perspective_calibration_review_result: 'perspective-calibration-review-result.accepted-fixture.json',
      calibrated_view_graph: 'calibrated-view-graph.accepted-calibration-fixture.json',
      corner_chain_topology: 'corner-chain-topology.accepted-fixture.json',
      draft_view_graph: 'draft-view-graph.accepted-topology-fixture.json',
      facade_plane_graph: 'facade-plane-graph.accepted-calibration.candidates.json',
      promotion_review: 'fixture-only; user review still required'
    }
  });
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeSvgAndPng(svgPath, pngPath, svg) {
  await fs.writeFile(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--truth') options.truth = args[++index];
    else if (args[index] === '--topology-seed') options.topologySeed = args[++index];
    else if (args[index] === '--detail-seed') options.detailSeed = args[++index];
    else if (args[index] === '--calibration-review') options.calibrationReview = args[++index];
    else if (args[index] === '--topology-review') options.topologyReview = args[++index];
    else if (args[index] === '--output-dir') options.outputDir = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCalibrationBenchmark(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        output_dir: result.outputDir,
        ground_truth_status: result.report.ground_truth_status,
        line_recall: result.report.metrics.structural_length_coverage_recall,
        two_horizontal_families: result.report.gates.two_horizontal_families,
        conclusion: result.report.conclusion,
        pending_review_status: result.pendingReviewResult.status,
        accepted_fixture_status: result.acceptedReviewFixtureResult.status,
        pending_topology_status: result.pendingTopologyReviewResult.status,
        accepted_topology_fixture_status: result.acceptedTopologyReviewFixtureResult.status,
        accepted_topology_draft_view_status: result.acceptedTopologyDraftViewGraph.review_policy.status,
        false_promotion_count: result.report.false_promotion_count
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
