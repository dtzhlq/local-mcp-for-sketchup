#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { runCalibrationBenchmark } from './run-calibration-benchmark.mjs';
import { buildPlaneLocalEvidencePackage } from './lib/plane-local-evidence.mjs';
import { buildModelCompletionStatus } from './lib/model-completion-status.mjs';
import {
  promoteReviewedPlaneLocalDetails,
  renderPlaneLocalDetailReprojectionOverlaySvg
} from './lib/plane-local-detail-promotion.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_OUTPUT_DIR = 'output/image-structured-modeler/yellow-reviewed-model';
const PROFILE_PATH = 'examples/product-profiles/building_single_urban_oblique.json';
const LOCAL_DETAIL_REVIEW_FIXTURE_PATH = 'projects/image-structured-modeler/examples/building-single-anime-yellow/plane-local-evidence-review.accepted-fixture.json';
const PLANE_MATERIALS = {
  visible_plane_left_side_la: 'Yellow_Study_LA_Side',
  visible_plane_recessed_front_ab: 'Yellow_Study_AB_Recessed',
  visible_plane_return_bc: 'Yellow_Study_BC_Return',
  visible_plane_main_front_cd: 'Yellow_Study_CD_Main'
};
const MATERIAL_COLORS = {
  Urban_Stucco_Yellow: '#c9c092',
  Yellow_Study_LA_Side: '#7c3aed',
  Yellow_Study_AB_Recessed: '#e11d48',
  Yellow_Study_BC_Return: '#0891b2',
  Yellow_Study_CD_Main: '#16a34a',
  Yellow_Study_HVAC: '#cbd5e1',
  Yellow_Study_Utility: '#64748b'
};

export async function buildYellowReviewedModel(options = {}) {
  const outputDirOption = options.outputDir || DEFAULT_OUTPUT_DIR;
  const outputDir = path.resolve(repoRoot, outputDirOption);
  const calibrationDir = path.join(outputDirOption, 'calibration');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const calibration = await runCalibrationBenchmark({
    outputDir: calibrationDir,
    truth: options.truth,
    topologySeed: options.topologySeed,
    detailSeed: options.detailSeed
  });
  const approval = options.approval || buildStudyApproval({
    calibration,
    acceptedUserReview: options.acceptedUserReview === true,
    studyScale: options.studyScale
  });
  await writeJson(path.join(outputDir, '01-reviewed-facade-model-study-approval.json'), approval);

  const approvalBlockers = validateStudyApproval({ approval, calibration });
  if (approvalBlockers.length) {
    const blockedReport = buildBlockedReport({ approval, calibration, approvalBlockers });
    await writeJson(path.join(outputDir, 'model-study-report.json'), blockedReport);
    await fs.writeFile(path.join(outputDir, 'model-study-report.md'), renderReportMarkdown(blockedReport), 'utf8');
    return { ok: true, outputDir, calibration, approval, report: blockedReport, partGraph: null, dsl: null, qa: null };
  }

  const officialProfile = JSON.parse(await fs.readFile(path.resolve(repoRoot, PROFILE_PATH), 'utf8'));
  const studyProfile = buildStudyProfile(officialProfile, approval.scale_assumption);
  const assembly = assembleReviewedFacadePartGraph({ calibration, approval, profile: studyProfile });
  const sourceImagePath = path.resolve(repoRoot, calibration.groundTruth.source_image);
  const planeLocalEvidence = await buildPlaneLocalEvidencePackage({
    outputDir: path.join(outputDir, 'plane-local-evidence'),
    sourceImagePath,
    sourceImage: calibration.groundTruth.source_image,
    facadePlaneGraph: calibration.facadePlaneGraph,
    planeFrames: assembly.planeFrames,
    sourceFacadePlaneGraph: 'calibration/facade-plane-graph.accepted-calibration.candidates.json'
  });
  const localDetailReview = await resolveLocalDetailReview({ options, planeLocalEvidence });
  const detailPromotion = promoteReviewedPlaneLocalDetails({
    graph: planeLocalEvidence.graph,
    reviewDecision: localDetailReview,
    sourcePlaneLocalEvidenceGraph: 'plane-local-evidence/plane-local-evidence-graph.json',
    sourceReviewDecision: '09-plane-local-evidence-review.json'
  });
  if (detailPromotion.partgraph_promotion_allowed) {
    promoteAcceptedFacadeDetails({ assembly, promotion: detailPromotion, sourceImage: calibration.groundTruth.source_image });
  }
  const dsl = compilePartGraphToSketchUpDsl(assembly.partGraph, studyProfile, { repoRoot });
  const mockSessionPath = path.join(outputDir, 'mock-session.json');
  const bridge = new SketchUpBridge({ mock: { sessionPath: mockSessionPath } });
  await bridge.reset_model({ runtime: 'mock' });
  const built = await bridge.build_model({ code: JSON.stringify(dsl), runtime: 'mock' });
  const qa = await bridge.validate_model({
    snapshot: built.snapshot,
    runtime: 'mock',
    spec: buildModelQaSpec(assembly.partGraph),
    includePreview: true,
    strictCollisions: true,
    strictUnanchored: false
  });
  const isometricSvg = renderIsometricStudySvg({
    partGraph: assembly.partGraph,
    detailCandidates: calibration.facadePlaneGraph.plane_local_detail_candidates,
    planeFrames: assembly.planeFrames,
    detailPromotion
  });
  const sourceImageBuffer = await fs.readFile(sourceImagePath);
  const sourceMetadata = await sharp(sourceImageBuffer).metadata();
  const reprojectionSvg = renderPlaneLocalDetailReprojectionOverlaySvg({
    promotion: detailPromotion,
    sourceImageBuffer,
    width: sourceMetadata.width,
    height: sourceMetadata.height
  });
  const report = buildCompletedReport({ approval, calibration, assembly, dsl, qa, built, planeLocalEvidence, localDetailReview, detailPromotion });
  const reviewedMcpBrief = buildReviewedModelMcpBrief({
    baseBrief: calibration.mcpModelingBrief,
    approval,
    planeLocalEvidence,
    localDetailReview,
    detailPromotion,
    completionStatus: report.completion_status
  });

  await Promise.all([
    writeJson(path.join(outputDir, '02-study-product-profile.json'), studyProfile),
    writeJson(path.join(outputDir, '03-topology-aware-part-graph.json'), assembly.partGraph),
    writeJson(path.join(outputDir, '04-sketchup-dsl.mock-study.json'), dsl),
    writeJson(path.join(outputDir, '05-mock-snapshot.json'), built.snapshot),
    writeJson(path.join(outputDir, '06-model-qa.json'), qa),
    writeJson(path.join(outputDir, '07-plane-local-detail-candidates.review-only.json'), {
      kind: 'plane_local_detail_candidate_review_package_v1',
      source_facade_plane_graph: 'calibration/facade-plane-graph.accepted-calibration.candidates.json',
      promotion_allowed: false,
      details: calibration.facadePlaneGraph.plane_local_detail_candidates
    }),
    fs.writeFile(path.join(outputDir, '08-isometric-study.svg'), isometricSvg, 'utf8'),
    sharp(Buffer.from(isometricSvg)).png().toFile(path.join(outputDir, '08-isometric-study.png')),
    writeJson(path.join(outputDir, '09-plane-local-evidence-review.json'), localDetailReview),
    writeJson(path.join(outputDir, '10-plane-local-detail-promotion.json'), detailPromotion),
    fs.writeFile(path.join(outputDir, '11-source-reprojection.svg'), reprojectionSvg, 'utf8'),
    sharp(Buffer.from(reprojectionSvg)).png().toFile(path.join(outputDir, '11-source-reprojection.png')),
    writeJson(path.join(outputDir, '12-mcp-modeling-brief.reviewed-model.json'), reviewedMcpBrief),
    fs.writeFile(path.join(outputDir, '12-mcp-modeling-brief.reviewed-model.md'), renderReviewedModelMcpBriefMarkdown(reviewedMcpBrief), 'utf8'),
    writePreviewFiles(path.join(outputDir, 'orthographic-preview'), qa.preview),
    writeJson(path.join(outputDir, 'model-study-report.json'), report),
    fs.writeFile(path.join(outputDir, 'model-study-report.md'), renderReportMarkdown(report), 'utf8'),
    fs.writeFile(path.join(outputDir, 'index.html'), renderReviewHtml(report), 'utf8')
  ]);

  return {
    ok: true,
    outputDir,
    calibration,
    approval,
    studyProfile,
    partGraph: assembly.partGraph,
    dsl,
    snapshot: built.snapshot,
    qa,
    planeLocalEvidence,
    localDetailReview,
    detailPromotion,
    mcpModelingBrief: reviewedMcpBrief,
    report
  };
}

async function resolveLocalDetailReview({ options, planeLocalEvidence }) {
  if (options.localDetailReview) return structuredClone(options.localDetailReview);
  if (options.acceptedLocalDetailReviewFixture === true) {
    return JSON.parse(await fs.readFile(path.resolve(repoRoot, LOCAL_DETAIL_REVIEW_FIXTURE_PATH), 'utf8'));
  }
  return planeLocalEvidence.pendingReview;
}

function buildReviewedModelMcpBrief({ baseBrief, approval, planeLocalEvidence, localDetailReview, detailPromotion, completionStatus }) {
  const next = structuredClone(baseBrief);
  const detailReady = detailPromotion.partgraph_promotion_allowed === true;
  const fixtureOnly = String(localDetailReview.reviewer || '').includes('fixture');
  const remainingBlockers = [
    'accepted_metric_scale_anchor_required',
    'accepted_hidden_geometry_review_required',
    ...(fixtureOnly ? ['accepted_user_local_detail_review_required_before_non_fixture_use'] : [])
  ];
  next.status = detailReady ? 'mock_study_authorized_release_blocked' : 'plane_local_detail_review_required';
  next.compile_permission = {
    can_generate_sketchup_dsl: detailReady,
    can_promote_candidates: detailReady,
    reasons: detailReady ? [] : detailPromotion.blockers
  };
  next.draft_view_graph = {
    ...next.draft_view_graph,
    status: 'accepted_for_mock_study_derived_display',
    accepted_draft_view_review_required: true,
    promotion_allowed: false,
    review_required: false,
    blockers: ['accepted_metric_scale_anchor_required', 'accepted_hidden_geometry_review_required']
  };
  next.facade_plane_graph = {
    ...next.facade_plane_graph,
    status: 'accepted_for_mock_study',
    accepted_plane_review_required: true,
    promotion_allowed: false,
    review_required: false,
    blockers: ['accepted_local_detail_review_required_before_detail_promotion']
  };
  next.plane_local_evidence = {
    available: true,
    status: planeLocalEvidence.graph.review_policy.status,
    plane_count: planeLocalEvidence.graph.summary.plane_count,
    edge_evidence_count: planeLocalEvidence.graph.summary.edge_evidence_count,
    corner_evidence_count: planeLocalEvidence.graph.summary.corner_evidence_count,
    repetition_hypothesis_count: planeLocalEvidence.graph.summary.repetition_hypothesis_count,
    region_candidate_count: planeLocalEvidence.graph.summary.region_candidate_count,
    detail_instance_proposal_count: planeLocalEvidence.graph.summary.detail_instance_proposal_count,
    coordinate_reference_checked: planeLocalEvidence.graph.planes.every((plane) => Boolean(plane.rectification.coordinate_transform)),
    review_required: true,
    promotion_allowed: false,
    source: 'plane-local-evidence/plane-local-evidence-graph.json'
  };
  next.local_detail_review = {
    status: localDetailReview.status,
    reviewer: localDetailReview.reviewer,
    geometry_authoring_mode: localDetailReview.geometry_authoring?.mode || 'proposal_geometry',
    accepted_detail_decision_count: (localDetailReview.region_decisions || []).filter((decision) => decision.status === 'accepted').length,
    promotion_allowed: false,
    compile_allowed: false,
    fixture_only: fixtureOnly,
    source: '09-plane-local-evidence-review.json'
  };
  next.detail_promotion = {
    status: detailPromotion.status,
    accepted_detail_count: detailPromotion.accepted_details.length,
    accepted_opening_count: detailPromotion.accepted_details.filter((detail) => detail.geometry_type === 'recess_opening').length,
    accepted_equipment_count: detailPromotion.accepted_details.filter((detail) => detail.geometry_type === 'equipment_box').length,
    accepted_linear_path_count: detailPromotion.accepted_details.filter((detail) => detail.geometry_type === 'linear_path_box').length,
    reprojection_qa_status: detailPromotion.reprojection_qa.status,
    false_promotion_count: detailPromotion.false_promotion_count,
    partgraph_promotion_allowed: detailPromotion.partgraph_promotion_allowed,
    direct_compile_allowed: false,
    source: '10-plane-local-detail-promotion.json'
  };
  next.model_completion_status = completionStatus;
  next.promotion_status = {
    status: detailReady ? 'ready_for_mock_study_partgraph' : 'blocked_pending_local_detail_review',
    calibration_review_status: 'accepted_for_rectification',
    topology_review_status: 'accepted_for_derived_drafting',
    draft_view_review_status: 'accepted_for_mock_study_derived_display',
    domain_review_status: 'accepted_for_mock_study',
    local_detail_review_status: localDetailReview.status,
    reprojection_qa_status: detailPromotion.reprojection_qa.status,
    partgraph_promotion_allowed: detailReady,
    sketchup_dsl_allowed: detailReady,
    runtime_scope: 'mock_study_only',
    release_allowed: false,
    blockers: remainingBlockers
  };
  next.artifact_sequence = [
    { order: 1, stage: 'structure_line_evidence', available: true, status: next.structure_line_evidence?.status || 'evidence_ready_for_calibration' },
    { order: 2, stage: 'perspective_calibration', available: true, status: 'accepted_for_rectification' },
    { order: 3, stage: 'calibrated_view_graph', available: true, status: 'accepted_for_derived_drafting' },
    { order: 4, stage: 'corner_chain_topology', available: true, status: 'accepted_for_derived_drafting' },
    { order: 5, stage: 'draft_view_graph', available: true, status: 'accepted_for_mock_study_derived_display' },
    { order: 6, stage: 'facade_plane_graph', available: true, status: 'accepted_for_mock_study' },
    { order: 7, stage: 'plane_local_evidence', available: true, status: next.plane_local_evidence.status },
    { order: 8, stage: 'local_detail_review', available: true, status: localDetailReview.status },
    { order: 9, stage: 'promotion_status', available: true, status: next.promotion_status.status },
    { order: 10, stage: 'part_graph', available: true, status: detailReady ? 'generated_from_accepted_ids' : 'topology_only' },
    { order: 11, stage: 'sketchup_dsl', available: detailReady, status: detailReady ? 'mock_study_generated' : 'blocked' }
  ];
  next.source = {
    ...next.source,
    plane_local_evidence_graph: 'plane-local-evidence/plane-local-evidence-graph.json',
    plane_local_evidence_review: '09-plane-local-evidence-review.json',
    plane_local_detail_promotion: '10-plane-local-detail-promotion.json',
    source_reprojection: '11-source-reprojection.png',
    part_graph: '03-topology-aware-part-graph.json',
    sketchup_dsl: '04-sketchup-dsl.mock-study.json'
  };
  next.agent_contract.status = detailReady ? 'mock_study_authorized_release_blocked' : 'review_blocked';
  next.agent_contract.authoritative_artifacts = [
    ...(next.agent_contract.authoritative_artifacts || []),
    { role: 'plane_local_evidence_graph', path: 'plane-local-evidence/plane-local-evidence-graph.json', required: true },
    { role: 'plane_local_evidence_review', path: '09-plane-local-evidence-review.json', required: true },
    { role: 'plane_local_detail_promotion', path: '10-plane-local-detail-promotion.json', required: true },
    { role: 'part_graph', path: '03-topology-aware-part-graph.json', required: detailReady }
  ];
  next.agent_contract.output_policy = {
    ...next.agent_contract.output_policy,
    sketchup_dsl_allowed: detailReady,
    candidate_promotion_allowed: detailReady,
    allowed_outputs: detailReady
      ? ['reviewed_part_graph', 'mock_study_sketchup_dsl', 'mock_qa', 'source_reprojection_report']
      : ['review_notes', 'plane_local_evidence_review'],
    blocked_outputs: ['release_complete_model', 'invented_hidden_facades_or_dimensions', 'metric_geometry_without_scale_anchor'],
    blockers: remainingBlockers
  };
  next.agent_contract.evidence_rules = [
    'Use the artifact_sequence in order; DraftViewGraph is a derived display and cannot override accepted visible-plane topology.',
    'Only accepted ids in 09-plane-local-evidence-review.json that pass 10-plane-local-detail-promotion.json may enter PartGraph.',
    'Generate SketchUp DSL only from 03-topology-aware-part-graph.json; do not compile PlaneLocalEvidence or review JSON directly.',
    'Treat nominal scale and hidden closure as mock-study assumptions, never release geometry.'
  ];
  next.agent_contract.required_confirmations = remainingBlockers;
  next.agent_contract.geometry_boundaries = [
    'Do not change accepted LA-AB-BC-CD adjacency or merge AB with CD.',
    'Do not create geometry from rejected, pending, or unlisted plane-local proposals.',
    'Do not infer metric depth, rear facades, or roof closure from this single image.',
    'Mock-study DSL is allowed only for reviewed visible geometry and remains release_allowed=false.'
  ];
  next.next_actions = remainingBlockers;
  next.prohibitions = Array.from(new Set([
    ...(next.prohibitions || []),
    'release_complete_without_metric_scale_and_hidden_geometry_review',
    'compile_plane_local_evidence_directly',
    'promote_unaccepted_detail_ids'
  ]));
  return next;
}

function renderReviewedModelMcpBriefMarkdown(brief) {
  const lines = ['# Reviewed Model MCP Brief', ''];
  lines.push(`- status: \`${brief.status}\``);
  lines.push(`- mock SketchUp DSL allowed: \`${brief.compile_permission.can_generate_sketchup_dsl}\``);
  lines.push(`- release allowed: \`${brief.promotion_status.release_allowed}\``);
  lines.push('');
  lines.push('## Artifact Sequence');
  lines.push('| order | stage | status |');
  lines.push('| --- | --- | --- |');
  for (const item of brief.artifact_sequence) lines.push(`| ${item.order} | ${item.stage} | ${item.status} |`);
  lines.push('');
  lines.push('## Plane Local Evidence');
  lines.push(`- planes: \`${brief.plane_local_evidence.plane_count}\``);
  lines.push(`- detail proposals: \`${brief.plane_local_evidence.detail_instance_proposal_count}\``);
  lines.push(`- coordinate reference checked: \`${brief.plane_local_evidence.coordinate_reference_checked}\``);
  lines.push('');
  lines.push('## Local Detail Review');
  lines.push(`- status: \`${brief.local_detail_review.status}\``);
  lines.push(`- geometry authoring: \`${brief.local_detail_review.geometry_authoring_mode}\``);
  lines.push(`- accepted decisions: \`${brief.local_detail_review.accepted_detail_decision_count}\``);
  lines.push('');
  lines.push('## Promotion Status');
  lines.push(`- status: \`${brief.promotion_status.status}\``);
  lines.push(`- reprojection QA: \`${brief.promotion_status.reprojection_qa_status}\``);
  lines.push(`- PartGraph promotion allowed: \`${brief.promotion_status.partgraph_promotion_allowed}\``);
  lines.push(`- release allowed: \`${brief.promotion_status.release_allowed}\``);
  lines.push(`- blockers: ${brief.promotion_status.blockers.map((item) => `\`${item}\``).join(', ') || 'none'}`);
  return `${lines.join('\n')}\n`;
}

export function buildStudyApproval({ calibration, acceptedUserReview = false, studyScale = {} } = {}) {
  const accepted = acceptedUserReview === true;
  const planeIds = calibration.facadePlaneGraph.planes.map((plane) => plane.id);
  const axisFamilyIds = calibration.acceptedReviewFixtureResult.accepted_axis_families
    .map((family) => family.direction_family_id);
  const topologyIds = calibration.acceptedTopologyReviewFixture.accepted_topology_ids;
  return {
    kind: 'reviewed_facade_model_study_approval_v1',
    version: 1,
    sample_id: 'building-single-anime-yellow',
    reviewer: accepted ? 'user_explicit_conversation_review_2026-07-13' : 'pending_user_review',
    status: accepted ? 'accepted_for_mock_study' : 'not_accepted',
    accepted_axis_family_ids: accepted ? axisFamilyIds : [],
    accepted_topology_ids: accepted ? topologyIds : [],
    accepted_view_slot_ids: accepted ? ['front', 'left_or_right_side', 'oblique_context'] : [],
    accepted_plane_ids: accepted ? planeIds : [],
    detail_review: {
      status: 'not_accepted',
      accepted_detail_ids: [],
      promotion_allowed: false
    },
    scale_assumption: {
      status: 'assumed_for_mock_study',
      width: Number(studyScale.width || 12000),
      depth: Number(studyScale.depth || 10000),
      height: Number(studyScale.height || 10500),
      units: 'mm',
      confidence: 0.35,
      release_allowed: false,
      note: 'Nominal relative scale for a topology study; no real-world dimension has been accepted.'
    },
    hidden_geometry_assumptions: [{
      id: 'hidden_rear_and_right_closure_E',
      status: 'inferred_for_closed_mock_mass',
      release_allowed: false,
      note: 'Adds E at the opposite plan corner only to close the mock mass behind the reviewed visible chain.'
    }],
    scope: {
      part_graph_study_allowed: accepted,
      sketchup_mock_allowed: accepted,
      live_sketchup_allowed: false,
      release_allowed: false
    },
    blockers: accepted
      ? ['accepted_metric_scale_anchor_required', 'accepted_local_detail_review_required', 'accepted_hidden_geometry_review_required']
      : ['accepted_user_perspective_calibration_review_required', 'accepted_user_corner_chain_topology_review_required', 'accepted_facade_plane_review_required'],
    notes: [
      'User acceptance covers the visible LA-AB-BC-CD topology and plane assignment only.',
      'Window, storefront, HVAC, and duct candidates remain review-only and are not emitted to SketchUp DSL.'
    ]
  };
}

export function assembleReviewedFacadePartGraph({ calibration, approval, profile } = {}) {
  const topology = calibration.topologySeed.plan_topology;
  const scale = approval.scale_assumption;
  const sourceImage = calibration.groundTruth.source_image;
  const planPoints = scaledPlanPoints(topology.corners, scale);
  const visibleChain = topology.corner_order.map((id) => ({ id, ...planPoints.get(id) }));
  const hiddenCorner = {
    id: 'E_hidden',
    x: Math.max(...visibleChain.map((point) => point.x)),
    y: Math.max(...visibleChain.map((point) => point.y))
  };
  const footprint = [...visibleChain, hiddenCorner];
  const mass = makeMassPart({ footprint, height: scale.height, sourceImage });
  const planeFrames = new Map();
  const planeParts = calibration.topologySeed.plane_spans.map((span) => {
    const edge = topology.edges.find((candidate) => candidate.role === span.plan_role);
    const from = planPoints.get(edge.from);
    const to = planPoints.get(edge.to);
    const graphPlane = calibration.facadePlaneGraph.planes.find((plane) => plane.id === span.id);
    const frame = {
      planeId: span.id,
      from,
      to,
      height: scale.height,
      axis: span.orientation_axis,
      homography: graphPlane.rectification.image_to_local_homography
    };
    planeFrames.set(span.id, frame);
    return makePlanePart({ span, edge, frame, graphPlane, sourceImage, thickness: 90 });
  });
  const partGraph = {
    version: 1,
    id: 'yellow-reviewed-topology-study-part-graph',
    profile_id: profile.profile_id,
    dsl_version: 1,
    units: 'mm',
    compile_policy: {
      enabled: true,
      runtime_scope: 'mock_study_only',
      release_allowed: false,
      max_needs_review_ratio: 0,
      max_profile_default_ratio: 0,
      min_inferred_parts: 1,
      min_scale_confidence: 0.3,
      require_promoted_geometry: true,
      block_reference_only_output: true
    },
    product: {
      type: 'building_single',
      name: 'Yellow Building Reviewed Topology Study',
      source: sourceImage
    },
    scale: {
      width: scale.width,
      depth: scale.depth,
      height: scale.height,
      confidence: scale.confidence,
      calibration: {
        status: scale.status,
        release_allowed: false,
        source: 'reviewed_facade_model_study_approval_v1'
      }
    },
    evidence_graph: {
      version: 1,
      source_images: [sourceImage],
      views_detected: ['oblique_context', 'front', 'left_or_right_side'],
      open_questions: [
        'Metric scale requires at least one accepted real dimension.',
        'Hidden rear/right closure requires another view or explicit review.',
        'Plane-local details require a local_detail_review_decision_v1 before geometry promotion.'
      ],
      calibration_lineage: {
        accepted_axis_family_ids: approval.accepted_axis_family_ids,
        accepted_topology_ids: approval.accepted_topology_ids,
        accepted_plane_ids: approval.accepted_plane_ids
      }
    },
    parts: [mass, ...planeParts],
    review: {
      open_questions: [
        'Confirm one real width, depth, or height.',
        'Review orange plane-local detail rectangles before promoting windows, storefront, HVAC, or ducts.',
        'Provide a second image if rear/right mass closure must be accurate.'
      ],
      correction_targets: [
        { part_id: mass.id, path: 'parts[building_mass_study].shape.parameters.vertices', reason: 'Replace hidden E closure after another view or plan review.', severity: 'warn' },
        { part_id: 'visible_plane_left_side_la', path: 'parts[visible_plane_left_side_la].shape.parameters', reason: 'Scale only after a metric anchor is accepted.', severity: 'warn' }
      ]
    },
    detail_review_candidates: calibration.facadePlaneGraph.plane_local_detail_candidates.map((detail) => ({
      id: detail.id,
      role: detail.role,
      candidate_plane_ids: detail.candidate_plane_ids,
      promotion_allowed: false,
      blockers: detail.blockers
    }))
  };
  return { partGraph, planeFrames, footprint };
}

export function promoteAcceptedFacadeDetails({ assembly, promotion, sourceImage } = {}) {
  if (promotion?.partgraph_promotion_allowed !== true) return assembly;
  const detailParts = [];
  for (const detail of promotion.accepted_details || []) {
    const frame = assembly.planeFrames.get(detail.target_plane_id);
    const targetPart = assembly.partGraph.parts.find((part) => part.id === detail.target_plane_id);
    if (!frame || !targetPart) throw new Error(`Accepted detail target plane not found: ${detail.target_plane_id}`);
    if (detail.geometry_type === 'recess_opening') {
      targetPart.feature_intents ||= [];
      targetPart.feature_intents.push(makeOpeningFeatureIntent({ detail, frame, sourceImage }));
    } else {
      detailParts.push(makeAttachedDetailPart({ detail, frame, sourceImage }));
    }
  }
  assembly.partGraph.parts.push(...detailParts);
  assembly.partGraph.evidence_graph.accepted_local_detail_ids = promotion.accepted_detail_ids;
  assembly.partGraph.evidence_graph.local_detail_promotion = {
    source: promotion.source_review_decision,
    status: promotion.status,
    reprojection_qa_status: promotion.reprojection_qa.status,
    accepted_detail_count: promotion.accepted_details.length,
    release_allowed: false
  };
  assembly.partGraph.detail_promotion = {
    kind: promotion.kind,
    accepted_detail_ids: promotion.accepted_detail_ids,
    source_review_decision: promotion.source_review_decision,
    reprojection_qa: promotion.reprojection_qa,
    release_allowed: false
  };
  return assembly;
}

function makeOpeningFeatureIntent({ detail, frame, sourceImage }) {
  const bounds = quadBoundsUv(detail.quad_uv);
  const spanLength = planeFrameLength(frame);
  const centerU = (bounds.u0 + bounds.u1) / 2;
  const centerV = (bounds.v0 + bounds.v1) / 2;
  const faceU = planeFrameForward(frame) ? centerU : 1 - centerU;
  return {
    id: safeFileName(detail.id),
    operation: 'cut_recess',
    face: frame.axis === 'x_red' ? 'front' : 'left',
    semantic: detail.role,
    parameters: {
      center: [round(faceU * spanLength), round((1 - centerV) * frame.height)],
      size: [round((bounds.u1 - bounds.u0) * spanLength), round((bounds.v1 - bounds.v0) * frame.height)],
      depth: 55,
      radius: 0,
      segments: 1
    },
    fallback_state: 'structured_primitive',
    evidence_sources: [{
      kind: 'accepted_plane_local_detail_reprojection',
      view: 'oblique_context',
      status: 'manual_confirmed',
      source_image: sourceImage,
      confidence: 0.78,
      note: `${detail.role} accepted on ${detail.target_plane_id}; nominal depth is a mock-study convention.`
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_plane_local_evidence_review_and_reprojection',
    source_observation_ids: [detail.source_proposal_id],
    projection_residuals: detail.reprojection,
    review_required: false,
    helper_allowed: false,
    photo_grade_eligible: false
  };
}

function makeAttachedDetailPart({ detail, frame, sourceImage }) {
  const bounds = quadBoundsUv(detail.quad_uv);
  const first = interpolatePlanePoint(frame, bounds.u0);
  const second = interpolatePlanePoint(frame, bounds.u1);
  const z = round(frame.height * (1 - bounds.v1));
  const height = round(frame.height * (bounds.v1 - bounds.v0));
  const outwardDepth = detail.geometry_type === 'equipment_box' ? 420 : 180;
  const planeThickness = 90;
  const shape = frame.axis === 'x_red'
    ? {
      origin: [round(Math.min(first.x, second.x)), round(frame.from.y - planeThickness - outwardDepth), z],
      size: [round(Math.abs(second.x - first.x)), outwardDepth, height]
    }
    : {
      origin: [round(frame.from.x - planeThickness - outwardDepth), round(Math.min(first.y, second.y)), z],
      size: [outwardDepth, round(Math.abs(second.y - first.y)), height]
    };
  const id = safeFileName(detail.id);
  return {
    id,
    name: `Yellow_${id}`,
    type: detail.geometry_type,
    role: detail.role,
    parent: detail.target_plane_id,
    material: detail.geometry_type === 'equipment_box' ? 'Yellow_Study_HVAC' : 'Yellow_Study_Utility',
    shape: { primitive: 'box', parameters: shape },
    relationships: [{
      type: 'attached_to',
      target: detail.target_plane_id,
      note: 'Accepted plane-local detail binding.',
      source: 'plane_local_detail_promotion_v1',
      confidence: 0.78,
      review_required: false
    }],
    evidence_status: 'manual_confirmed',
    evidence_sources: [{
      kind: 'accepted_plane_local_detail_reprojection',
      view: 'oblique_context',
      status: 'manual_confirmed',
      source_image: sourceImage,
      confidence: 0.78,
      note: `${detail.role} accepted on ${detail.target_plane_id}; outward depth is a nominal visual-study convention.`
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_plane_local_evidence_review_and_reprojection',
    grounding_decision: 'promoted_geometry',
    source_observation_ids: [detail.source_proposal_id],
    projection_residuals: detail.reprojection,
    review_required: false,
    helper_allowed: false,
    photo_grade_eligible: false,
    fallback_state: 'structured_primitive',
    compile: { emit: true, runtime_scope: 'mock_study_only' },
    promoted_geometry: true,
    qa: {
      promoted_geometry: true,
      accepted_detail_id: detail.id,
      accepted_plane_id: detail.target_plane_id,
      geometry_type: detail.geometry_type,
      reprojection_qa: detail.reprojection.status,
      metric_scale_accepted: false,
      release_allowed: false
    }
  };
}

function planeFrameLength(frame) {
  return Math.hypot(frame.to.x - frame.from.x, frame.to.y - frame.from.y);
}

function planeFrameForward(frame) {
  return frame.axis === 'x_red' ? frame.to.x >= frame.from.x : frame.to.y >= frame.from.y;
}

function interpolatePlanePoint(frame, u) {
  return {
    x: frame.from.x + (frame.to.x - frame.from.x) * u,
    y: frame.from.y + (frame.to.y - frame.from.y) * u
  };
}

function quadBoundsUv(quad) {
  const us = quad.map((point) => point[0]);
  const vs = quad.map((point) => point[1]);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

function validateStudyApproval({ approval, calibration }) {
  const blockers = [];
  if (approval?.status !== 'accepted_for_mock_study') blockers.push('accepted_user_reviewed_facade_model_study_required');
  if (approval?.scope?.part_graph_study_allowed !== true || approval?.scope?.sketchup_mock_allowed !== true) {
    blockers.push('mock_study_scope_not_allowed');
  }
  if (approval?.scope?.live_sketchup_allowed !== false || approval?.scope?.release_allowed !== false) {
    blockers.push('study_scope_must_block_live_and_release');
  }
  const expectedAxes = calibration.acceptedReviewFixtureResult.accepted_axis_families.map((family) => family.direction_family_id);
  const expectedTopology = calibration.acceptedTopologyReviewFixture.accepted_topology_ids;
  const expectedPlanes = calibration.facadePlaneGraph.planes.map((plane) => plane.id);
  if (!sameSet(approval?.accepted_axis_family_ids, expectedAxes)) blockers.push('accepted_axis_family_lineage_mismatch');
  if (!sameSet(approval?.accepted_topology_ids, expectedTopology)) blockers.push('accepted_topology_lineage_mismatch');
  if (!sameSet(approval?.accepted_plane_ids, expectedPlanes)) blockers.push('accepted_plane_lineage_mismatch');
  if (approval?.detail_review?.promotion_allowed !== false || (approval?.detail_review?.accepted_detail_ids || []).length) {
    blockers.push('unreviewed_local_detail_promotion_forbidden');
  }
  if (approval?.scale_assumption?.status !== 'assumed_for_mock_study' || approval?.scale_assumption?.release_allowed !== false) {
    blockers.push('bounded_study_scale_assumption_required');
  }
  return Array.from(new Set(blockers));
}

function buildStudyProfile(profile, scale) {
  const next = structuredClone(profile);
  next.default_scale = { width: scale.width, depth: scale.depth, height: scale.height };
  next.compiler = {
    ...(next.compiler || {}),
    version: 'yellow-reviewed-topology-study-v1',
    geometry_gate: { enabled: false }
  };
  next.materials = uniqueByName([
    ...(next.materials || []),
    { name: 'Yellow_Study_LA_Side', color: MATERIAL_COLORS.Yellow_Study_LA_Side, alpha: 0.5 },
    { name: 'Yellow_Study_AB_Recessed', color: MATERIAL_COLORS.Yellow_Study_AB_Recessed, alpha: 0.5 },
    { name: 'Yellow_Study_BC_Return', color: MATERIAL_COLORS.Yellow_Study_BC_Return, alpha: 0.5 },
    { name: 'Yellow_Study_CD_Main', color: MATERIAL_COLORS.Yellow_Study_CD_Main, alpha: 0.5 },
    { name: 'Yellow_Study_HVAC', color: MATERIAL_COLORS.Yellow_Study_HVAC, alpha: 1 },
    { name: 'Yellow_Study_Utility', color: MATERIAL_COLORS.Yellow_Study_Utility, alpha: 1 }
  ]);
  next.review = {
    ...(next.review || {}),
    scenes: [{
      name: 'Yellow_Reviewed_Topology_Study',
      camera: {
        eye: [-17000, -19000, 14500],
        target: [5400, 3900, 4800],
        up: [0, 0, 1],
        fov: 42
      }
    }]
  };
  return next;
}

function makeMassPart({ footprint, height, sourceImage }) {
  const vertices = [
    ...footprint.map((point) => [point.x, point.y, 0]),
    ...footprint.map((point) => [point.x, point.y, height])
  ];
  const count = footprint.length;
  const faces = [
    Array.from({ length: count }, (_, index) => count - index - 1),
    Array.from({ length: count }, (_, index) => count + index),
    ...Array.from({ length: count }, (_, index) => [
      index,
      (index + 1) % count,
      count + ((index + 1) % count),
      count + index
    ])
  ];
  return {
    id: 'building_mass_study',
    name: 'Yellow_Building_Topology_Aware_Mass_Study',
    type: 'building_main_mass',
    role: 'building_main_mass',
    material: 'Urban_Stucco_Yellow',
    shape: { primitive: 'mesh', parameters: { vertices, faces, smooth: 'none' } },
    relationships: [],
    evidence_status: 'inferred',
    evidence_sources: [{
      kind: 'accepted_visible_topology_plus_hidden_closure_assumption',
      view: 'top',
      status: 'inferred',
      source_image: sourceImage,
      confidence: 0.35,
      note: 'Visible L-A-B-C-D chain is reviewed; hidden E closure and all metric dimensions remain assumptions.'
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_corner_chain_with_bounded_hidden_closure',
    grounding_decision: 'promoted_geometry',
    source_observation_ids: ['left_front_recess_notch_candidate'],
    review_required: true,
    helper_allowed: false,
    photo_grade_eligible: false,
    fallback_state: 'box_approximation',
    compile: { emit: true, runtime_scope: 'mock_study_only' },
    promoted_geometry: true,
    qa: {
      promoted_geometry: true,
      accepted_visible_topology: true,
      hidden_geometry_assumption: true,
      metric_scale_accepted: false,
      release_allowed: false
    }
  };
}

function makePlanePart({ span, edge, frame, graphPlane, sourceImage, thickness }) {
  const dx = Math.abs(frame.to.x - frame.from.x);
  const dy = Math.abs(frame.to.y - frame.from.y);
  const isXAxis = dx >= dy;
  const origin = isXAxis
    ? [Math.min(frame.from.x, frame.to.x), frame.from.y - thickness, 0]
    : [frame.from.x - thickness, Math.min(frame.from.y, frame.to.y), 0];
  const size = isXAxis ? [dx, thickness, frame.height] : [thickness, dy, frame.height];
  return {
    id: span.id,
    name: `Yellow_${edge.id}_${span.plan_role}`,
    type: span.id,
    role: span.id,
    material: PLANE_MATERIALS[span.id],
    shape: { primitive: 'box', parameters: { origin, size } },
    relationships: (graphPlane.adjacency || []).map((adjacency) => ({
      type: 'touching',
      target: adjacency.plane_id,
      note: `Reviewed shared boundary ${adjacency.evidence}.`,
      source: 'facade_plane_graph_v1',
      confidence: 0.78,
      review_required: false
    })),
    evidence_status: 'manual_confirmed',
    evidence_sources: [{
      kind: 'reviewed_facade_plane_graph',
      view: graphPlane.orientation_hint.view,
      status: 'manual_confirmed',
      source_image: sourceImage,
      confidence: graphPlane.source.confidence,
      note: `Accepted visible plane ${span.id}; metric thickness is a study convention.`
    }],
    grounding_status: 'review_confirmed',
    grounding_method: 'accepted_calibrated_plane_and_corner_chain',
    grounding_decision: 'promoted_geometry',
    source_observation_ids: [graphPlane.source.semantic_evidence_id],
    review_required: true,
    helper_allowed: false,
    photo_grade_eligible: false,
    fallback_state: 'structured_primitive',
    compile: { emit: true, runtime_scope: 'mock_study_only' },
    promoted_geometry: true,
    qa: {
      promoted_geometry: true,
      accepted_plane_id: span.id,
      accepted_edge_id: edge.id,
      orientation_axis: span.orientation_axis,
      metric_scale_accepted: false,
      release_allowed: false
    }
  };
}

function scaledPlanPoints(corners, scale) {
  const xs = corners.map((corner) => Number(corner.diagram_xy[0]));
  const ys = corners.map((corner) => Number(corner.diagram_xy[1]));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xRange = Math.max(0.001, maxX - minX);
  const yRange = Math.max(0.001, maxY - minY);
  return new Map(corners.map((corner) => [corner.id, {
    x: round(((corner.diagram_xy[0] - minX) / xRange) * scale.width),
    y: round(((corner.diagram_xy[1] - minY) / yRange) * scale.depth)
  }]));
}

function buildModelQaSpec(partGraph) {
  const planeIds = partGraph.parts.filter((part) => part.id.startsWith('visible_plane_')).map((part) => part.id);
  const acceptedDetailParts = partGraph.parts.filter((part) => part.qa?.accepted_detail_id);
  const adjacency = [
    ['visible_plane_left_side_la', 'visible_plane_recessed_front_ab'],
    ['visible_plane_recessed_front_ab', 'visible_plane_return_bc'],
    ['visible_plane_return_bc', 'visible_plane_main_front_cd']
  ];
  return {
    title: 'Yellow Reviewed Topology Mock QA',
    rules: {
      allowed_collisions: [
        ...planeIds.map((planeId) => ({ item: 'building_mass_study', with: planeId })),
        ...adjacency.map(([item, withRef]) => ({ item, with: withRef })),
        ...acceptedDetailParts.flatMap((part) => [
          { item: 'building_mass_study', with: part.id },
          { item: part.parent, with: part.id }
        ])
      ],
      views: [
        { name: 'top', axes: ['x', 'y'], depthAxis: 'z', title: 'Topology Plan' },
        { name: 'front', axes: ['x', 'z'], depthAxis: 'y', title: 'Front Planes' },
        { name: 'left-side', axes: ['y', 'z'], depthAxis: 'x', title: 'Side Planes' }
      ]
    }
  };
}

function renderIsometricStudySvg({ partGraph, detailCandidates, planeFrames, detailPromotion }) {
  const faces = geometryFaces(partGraph);
  const detailPolylines = detailPromotion?.partgraph_promotion_allowed
    ? detailPromotion.accepted_details.flatMap((detail) => acceptedDetailPolyline(detail, planeFrames))
    : detailCandidates.flatMap((detail) => detailCandidatePolyline(detail, planeFrames));
  const projectedPoints = [
    ...faces.flatMap((face) => face.points.map(projectPoint)),
    ...detailPolylines.flatMap((line) => line.points.map(projectPoint))
  ];
  const bounds = pointBounds(projectedPoints);
  const width = 1200;
  const height = 760;
  const padding = 72;
  const fit = fitProjection(bounds, width, height, padding);
  const toScreen = (point) => {
    const projected = projectPoint(point);
    return [round((projected[0] - bounds.minX) * fit.scale + fit.offsetX), round((projected[1] - bounds.minY) * fit.scale + fit.offsetY)];
  };
  const faceShapes = faces
    .sort((left, right) => right.depth - left.depth)
    .map((face) => {
      const points = face.points.map(toScreen).map((point) => point.join(',')).join(' ');
      return `<polygon points="${points}" fill="${face.color}" fill-opacity="${face.opacity}" stroke="#20242a" stroke-width="1.4"/>`;
    }).join('\n');
  const detailShapes = detailPolylines.map((line) => {
    const points = line.points.map(toScreen).map((point) => point.join(',')).join(' ');
    const accepted = line.status === 'accepted';
    const color = line.color || '#f59e0b';
    const dash = accepted ? '' : ' stroke-dasharray="10 7"';
    return `<g data-detail-id="${line.id}" data-status="${accepted ? 'accepted' : 'review-only'}"><polygon points="${points}" fill="${color}" fill-opacity="${accepted ? 0.18 : 0.08}" stroke="#ffffff" stroke-width="5"${dash}/><polygon points="${points}" fill="none" stroke="${color}" stroke-width="3"${dash}/></g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#eef2f1"/>
  <g data-layer="topology-aware-part-graph">${faceShapes}</g>
  <g data-layer="plane-local-detail-review-candidates">${detailShapes}</g>
  <text x="32" y="42" font-family="ui-monospace, monospace" font-size="20" fill="#111827">Yellow reviewed topology model study</text>
  <text x="32" y="66" font-family="ui-monospace, monospace" font-size="13" fill="#991b1b">nominal scale / hidden closure inferred / release_allowed=false</text>
  <g transform="translate(32 94)">
    <rect width="316" height="150" fill="#ffffff" fill-opacity="0.9" stroke="#94a3b8"/>
    ${legendLine(18, 'LA accepted side plane', MATERIAL_COLORS.Yellow_Study_LA_Side)}
    ${legendLine(44, 'AB accepted recessed front', MATERIAL_COLORS.Yellow_Study_AB_Recessed)}
    ${legendLine(70, 'BC accepted return', MATERIAL_COLORS.Yellow_Study_BC_Return)}
    ${legendLine(96, 'CD accepted main front', MATERIAL_COLORS.Yellow_Study_CD_Main)}
    <line x1="18" y1="126" x2="50" y2="126" stroke="#f59e0b" stroke-width="3" stroke-dasharray="9 6"/>
    <text x="60" y="131" font-family="ui-monospace, monospace" font-size="12" fill="#111827">${detailPromotion?.partgraph_promotion_allowed ? 'accepted visible details / release blocked' : 'detail candidate, not DSL geometry'}</text>
  </g>
</svg>`;
}

function acceptedDetailPolyline(detail, planeFrames) {
  const frame = planeFrames.get(detail.target_plane_id);
  if (!frame) return [];
  return [{
    id: detail.id,
    status: 'accepted',
    color: detail.geometry_type === 'recess_opening'
      ? '#2563eb'
      : detail.geometry_type === 'equipment_box'
        ? '#db2777'
        : '#ea580c',
    points: detail.quad_uv.map(([u, v]) => pointOnPlane(frame, u, v, 165))
  }];
}

function geometryFaces(partGraph) {
  const faces = [];
  for (const part of partGraph.parts || []) {
    if (part.compile?.emit === false || !part.shape) continue;
    const color = MATERIAL_COLORS[part.material] || '#d1d5db';
    const opacity = part.id === 'building_mass_study' ? 0.82 : 0.56;
    if (part.shape.primitive === 'mesh') {
      const vertices = part.shape.parameters.vertices || [];
      for (const face of part.shape.parameters.faces || []) {
        const points = face.map((index) => vertices[index]);
        if (points.length >= 3) faces.push({ points, color, opacity, depth: average(points.map((point) => point[0] + point[1] + point[2] * 0.08)) });
      }
    } else if (part.shape.primitive === 'box') {
      const { origin, size } = part.shape.parameters;
      for (const points of boxFaces(origin, size)) {
        faces.push({ points, color, opacity, depth: average(points.map((point) => point[0] + point[1] + point[2] * 0.08)) });
      }
    }
  }
  return faces;
}

function detailCandidatePolyline(detail, planeFrames) {
  const planeId = detail.candidate_plane_ids?.[0];
  const frame = planeFrames.get(planeId);
  if (!frame) return [];
  const localPoints = detail.visible_quad_px.map((point) => applyHomography(frameForDetail(detail, planeFrames), point));
  const us = localPoints.map((point) => point[0]);
  const vs = localPoints.map((point) => point[1]);
  const u0 = clamp(Math.min(...us), -0.15, 1.15);
  const u1 = clamp(Math.max(...us), -0.15, 1.15);
  const v0 = clamp(Math.min(...vs), -0.15, 1.15);
  const v1 = clamp(Math.max(...vs), -0.15, 1.15);
  return [{
    id: detail.id,
    points: [
      pointOnPlane(frame, u0, v0, 150),
      pointOnPlane(frame, u1, v0, 150),
      pointOnPlane(frame, u1, v1, 150),
      pointOnPlane(frame, u0, v1, 150)
    ]
  }];
}

function frameForDetail(detail, planeFrames) {
  return planeFrames.get(detail.candidate_plane_ids?.[0])?.homography || detail.source?.image_to_local_homography || null;
}

function pointOnPlane(frame, u, v, offset) {
  const x = frame.from.x + (frame.to.x - frame.from.x) * u;
  const y = frame.from.y + (frame.to.y - frame.from.y) * u;
  const z = frame.height * (1 - v);
  if (frame.axis === 'x_red') return [x, y - offset, z];
  return [x - offset, y, z];
}

function applyHomography(matrix, point) {
  if (!Array.isArray(matrix) || matrix.length !== 3) return [0.5, 0.5];
  const [x, y] = point;
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (Math.abs(denominator) < 1e-9) return [0.5, 0.5];
  return [
    (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
  ];
}

function buildCompletedReport({ approval, calibration, assembly, dsl, qa, built, planeLocalEvidence, localDetailReview, detailPromotion }) {
  const localDetailsAccepted = detailPromotion.partgraph_promotion_allowed === true;
  const reprojectionPassed = detailPromotion.reprojection_qa.status === 'pass';
  const completionStatus = buildModelCompletionStatus({
    calibrationAccepted: true,
    topologyAccepted: true,
    visiblePlanesAccepted: true,
    planeLocalDetailsAccepted: localDetailsAccepted,
    reprojectionQaPassed: reprojectionPassed,
    metricScaleAccepted: false,
    hiddenGeometryAccepted: false
  });
  return {
    kind: 'yellow_reviewed_model_study_report_v1',
    version: 1,
    status: localDetailsAccepted
      ? 'visible_detail_model_generated_release_blocked'
      : 'topology_model_generated_detail_review_required',
    completed_stages: [
      'structure_line_evidence',
      'perspective_calibration',
      'accepted_corner_chain_topology',
      'accepted_facade_planes',
      'plane_local_evidence_graph',
      ...(localDetailsAccepted ? ['accepted_plane_local_detail_review', 'source_image_reprojection_qa', 'accepted_detail_partgraph_promotion'] : []),
      'topology_aware_part_graph_study',
      'sketchup_dsl_mock_study',
      'mock_qa'
    ],
    accepted: {
      axis_family_ids: approval.accepted_axis_family_ids,
      topology_ids: approval.accepted_topology_ids,
      plane_ids: approval.accepted_plane_ids
    },
    model: {
      part_count: assembly.partGraph.parts.length,
      dsl_operation_count: dsl.operations.length,
      mock_group_count: built.snapshot.totals?.groups || built.snapshot.groups?.length || 0,
      qa_verdict: qa.verdict,
      qa_error_count: qa.summary?.by_severity?.error || 0,
      rectified_plane_count: planeLocalEvidence.graph.planes.length,
      plane_local_edge_evidence_count: planeLocalEvidence.graph.summary.edge_evidence_count,
      plane_local_corner_evidence_count: planeLocalEvidence.graph.summary.corner_evidence_count,
      plane_local_repetition_hypothesis_count: planeLocalEvidence.graph.summary.repetition_hypothesis_count,
      plane_local_detail_proposal_count: planeLocalEvidence.graph.summary.detail_instance_proposal_count,
      accepted_local_detail_count: detailPromotion.accepted_details.length,
      accepted_opening_count: detailPromotion.accepted_details.filter((detail) => detail.geometry_type === 'recess_opening').length,
      accepted_equipment_count: detailPromotion.accepted_details.filter((detail) => detail.geometry_type === 'equipment_box').length,
      accepted_linear_path_count: detailPromotion.accepted_details.filter((detail) => detail.geometry_type === 'linear_path_box').length,
      source_reprojection_qa: detailPromotion.reprojection_qa.status,
      part_graph_generated: true,
      sketchup_dsl_generated: true,
      mock_executed: true,
      live_sketchup_executed: false,
      release_allowed: false
    },
    accepted_detail_ids: detailPromotion.accepted_detail_ids,
    pending_detail_ids: localDetailsAccepted ? [] : calibration.facadePlaneGraph.plane_local_detail_candidates.map((detail) => detail.id),
    completion_status: completionStatus,
    detail_review: {
      reviewer: localDetailReview.reviewer,
      status: localDetailReview.status,
      fixture_only: String(localDetailReview.reviewer || '').includes('fixture'),
      partgraph_promotion_allowed: detailPromotion.partgraph_promotion_allowed,
      false_promotion_count: detailPromotion.false_promotion_count
    },
    remaining_blockers: localDetailsAccepted
      ? [
        'accepted_metric_scale_anchor_required',
        'accepted_hidden_geometry_review_required',
        ...(String(localDetailReview.reviewer || '').includes('fixture') ? ['accepted_user_local_detail_review_required_before_non_fixture_use'] : [])
      ]
      : [
        'accepted_metric_scale_anchor_required',
        'accepted_plane_local_evidence_review_required',
        'accepted_local_detail_review_required',
        'accepted_hidden_geometry_review_required',
        'reference_projection_qa_required_before_release'
      ],
    judgment: {
      pipeline_executable: true,
      visible_topology_modeling: 'completed_for_mock_study',
      visual_image_model_complete: completionStatus.visual_status === 'complete',
      release_complete: completionStatus.release_status === 'complete',
      full_image_model_complete: completionStatus.visual_status === 'complete',
      reason: localDetailsAccepted
        ? 'Accepted visible details now produce openings, attached equipment, utility geometry, and a passing source-image reprojection artifact. Metric scale and hidden closure remain blocked.'
        : 'The accepted visible topology now produces coherent model geometry. Metric scale, hidden closure, and local details remain explicitly unaccepted.'
    },
    artifacts: {
      approval: '01-reviewed-facade-model-study-approval.json',
      part_graph: '03-topology-aware-part-graph.json',
      sketchup_dsl: '04-sketchup-dsl.mock-study.json',
      mock_snapshot: '05-mock-snapshot.json',
      model_qa: '06-model-qa.json',
      detail_review_candidates: '07-plane-local-detail-candidates.review-only.json',
      plane_local_evidence_graph: 'plane-local-evidence/plane-local-evidence-graph.json',
      plane_local_evidence_review: 'plane-local-evidence/index.html',
      local_detail_review_decision: '09-plane-local-evidence-review.json',
      local_detail_promotion: '10-plane-local-detail-promotion.json',
      source_reprojection: '11-source-reprojection.png',
      mcp_modeling_brief: '12-mcp-modeling-brief.reviewed-model.json',
      mcp_modeling_brief_markdown: '12-mcp-modeling-brief.reviewed-model.md',
      isometric_preview: '08-isometric-study.png',
      orthographic_preview: 'orthographic-preview/index.html'
    }
  };
}

function buildBlockedReport({ approval, calibration, approvalBlockers }) {
  return {
    kind: 'yellow_reviewed_model_study_report_v1',
    version: 1,
    status: 'blocked_no_accepted_user_plane_review',
    completed_stages: ['structure_line_evidence', 'perspective_calibration', 'corner_chain_topology_candidates', 'facade_plane_candidates'],
    accepted: {
      axis_family_ids: approval.accepted_axis_family_ids || [],
      topology_ids: approval.accepted_topology_ids || [],
      plane_ids: approval.accepted_plane_ids || []
    },
    model: {
      part_count: 0,
      dsl_operation_count: 0,
      part_graph_generated: false,
      sketchup_dsl_generated: false,
      mock_executed: false,
      live_sketchup_executed: false,
      release_allowed: false
    },
    pending_detail_ids: calibration.facadePlaneGraph.plane_local_detail_candidates.map((detail) => detail.id),
    remaining_blockers: approvalBlockers,
    judgment: {
      pipeline_executable: false,
      visible_topology_modeling: 'blocked',
      full_image_model_complete: false,
      reason: 'No geometry is generated without an accepted user calibration/topology/plane review.'
    },
    artifacts: { approval: '01-reviewed-facade-model-study-approval.json' }
  };
}

function renderReportMarkdown(report) {
  return `# Yellow Reviewed Model Study\n\n- status: \`${report.status}\`\n- pipeline executable: \`${report.judgment.pipeline_executable}\`\n- visible topology modeling: \`${report.judgment.visible_topology_modeling}\`\n- full image model complete: \`${report.judgment.full_image_model_complete}\`\n- PartGraph generated: \`${report.model.part_graph_generated}\`\n- SketchUp DSL generated: \`${report.model.sketchup_dsl_generated}\`\n- mock executed: \`${report.model.mock_executed}\`\n- release allowed: \`${report.model.release_allowed}\`\n\n## Judgment\n\n${report.judgment.reason}\n\n## Remaining Blockers\n\n${report.remaining_blockers.map((blocker) => `- \`${blocker}\``).join('\n')}\n`;
}

function renderReviewHtml(report) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yellow Reviewed Model Study</title><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#eef2f1;color:#172026}header{padding:22px 28px;background:#fff;border-bottom:1px solid #cbd5e1}h1{font-size:22px;margin:0 0 6px}p{margin:4px 0}.status{color:#991b1b;font-family:ui-monospace,monospace}main{max-width:1280px;margin:auto;padding:24px 28px 48px}.band{padding:18px 0;border-bottom:1px solid #cbd5e1}img{display:block;width:100%;height:auto;background:#fff;border:1px solid #94a3b8}.grid{display:grid;grid-template-columns:1.5fr 1fr;gap:18px}.links{display:flex;gap:14px;flex-wrap:wrap}a{color:#075985}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style></head><body><header><h1>Yellow reviewed topology model study</h1><p class="status">${report.status} / release_allowed=false</p></header><main><section class="band grid"><div><h2>Model study</h2><img src="08-isometric-study.png" alt="Reviewed topology model isometric preview"></div><div><h2>Source reprojection</h2><img src="11-source-reprojection.png" alt="Accepted detail source reprojection"></div></section><section class="band grid"><div><h2>Top plan</h2><img src="orthographic-preview/top.svg" alt="Topology plan"></div><div><h2>Front planes</h2><img src="orthographic-preview/front.svg" alt="Front facade planes"></div></section><section class="band"><h2>Remaining blockers</h2><ul>${report.remaining_blockers.map((blocker) => `<li><code>${blocker}</code></li>`).join('')}</ul><div class="links"><a href="03-topology-aware-part-graph.json">PartGraph</a><a href="04-sketchup-dsl.mock-study.json">SketchUp DSL</a><a href="06-model-qa.json">Mock QA</a><a href="07-plane-local-detail-candidates.review-only.json">Detail candidates</a><a href="09-plane-local-evidence-review.json">Accepted review</a><a href="10-plane-local-detail-promotion.json">Promotion gate</a><a href="12-mcp-modeling-brief.reviewed-model.json">MCP brief</a><a href="plane-local-evidence/index.html">Plane-local evidence</a></div></section></main></body></html>`;
}

async function writePreviewFiles(outputDir, preview) {
  if (!preview) return;
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    ...(preview.views || []).map((view) => fs.writeFile(path.join(outputDir, `${safeFileName(view.name)}.svg`), view.svg, 'utf8')),
    fs.writeFile(path.join(outputDir, 'index.html'), preview.html, 'utf8')
  ]);
}

function boxFaces(origin, size) {
  const [x, y, z] = origin;
  const [w, d, h] = size;
  const points = [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
    [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]
  ];
  return [
    [points[0], points[1], points[2], points[3]],
    [points[4], points[7], points[6], points[5]],
    [points[0], points[4], points[5], points[1]],
    [points[1], points[5], points[6], points[2]],
    [points[2], points[6], points[7], points[3]],
    [points[3], points[7], points[4], points[0]]
  ];
}

function projectPoint([x, y, z]) {
  return [x - y * 0.58, x * 0.18 + y * 0.22 - z * 0.82];
}

function pointBounds(points) {
  return {
    minX: Math.min(...points.map((point) => point[0])),
    maxX: Math.max(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxY: Math.max(...points.map((point) => point[1]))
  };
}

function fitProjection(bounds, width, height, padding) {
  const scale = Math.min((width - padding * 2) / Math.max(1, bounds.maxX - bounds.minX), (height - padding * 2) / Math.max(1, bounds.maxY - bounds.minY));
  return {
    scale,
    offsetX: padding + (width - padding * 2 - (bounds.maxX - bounds.minX) * scale) / 2,
    offsetY: padding + (height - padding * 2 - (bounds.maxY - bounds.minY) * scale) / 2
  };
}

function legendLine(y, label, color) {
  return `<rect x="18" y="${y - 12}" width="18" height="18" fill="${color}" fill-opacity="0.72"/><text x="48" y="${y + 2}" font-family="ui-monospace, monospace" font-size="12" fill="#111827">${label}</text>`;
}

function sameSet(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second)) return false;
  const left = Array.from(new Set(first)).sort();
  const right = Array.from(new Set(second)).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueByName(items) {
  const byName = new Map();
  for (const item of items) byName.set(item.name, item);
  return [...byName.values()];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeFileName(value) {
  return String(value || 'view').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'view';
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--output-dir') options.outputDir = args[++index];
    else if (args[index] === '--accepted-user-review') options.acceptedUserReview = true;
    else if (args[index] === '--accepted-local-detail-review-fixture') options.acceptedLocalDetailReviewFixture = true;
    else if (args[index] === '--truth') options.truth = args[++index];
    else if (args[index] === '--topology-seed') options.topologySeed = args[++index];
    else if (args[index] === '--detail-seed') options.detailSeed = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildYellowReviewedModel(parseArgs(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        ok: result.ok,
        output_dir: result.outputDir,
        status: result.report.status,
        part_graph_generated: result.report.model.part_graph_generated,
        sketchup_dsl_generated: result.report.model.sketchup_dsl_generated,
        mock_executed: result.report.model.mock_executed,
        qa_verdict: result.report.model.qa_verdict || null,
        release_allowed: result.report.model.release_allowed
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
