#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import { runCalibrationBenchmark } from './run-calibration-benchmark.mjs';
import { buildModelCompletionStatus } from './lib/model-completion-status.mjs';
import { buildPlaneLocalEvidencePackage } from './lib/plane-local-evidence.mjs';
import {
  promoteReviewedPlaneLocalDetails,
  renderPlaneLocalDetailReprojectionOverlaySvg
} from './lib/plane-local-detail-promotion.mjs';
import {
  assembleReviewedFacadeStudyPartGraph,
  buildFacadeStudyProfile,
  buildFacadeStudyQaSpec,
  renderFacadeStudyIsometricSvg,
  validateFacadeStudyApproval
} from './lib/reviewed-facade-study.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_SAMPLE = 'projects/image-structured-modeler/examples/building-single-london-corner/sample.json';
const DEFAULT_OUTPUT = 'output/image-structured-modeler/london-corner-facade-study';

export async function runFacadeDraftingStudy(options = {}) {
  const samplePath = path.resolve(repoRoot, options.sample || DEFAULT_SAMPLE);
  const outputDir = path.resolve(repoRoot, options.outputDir || DEFAULT_OUTPUT);
  const sample = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  const sourceImagePath = path.resolve(repoRoot, sample.source.local_path);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const sourceCheck = await verifySource(sample, sourceImagePath);
  await writeJson(path.join(outputDir, '00-source-check.json'), sourceCheck);
  if (!sourceCheck.ok) {
    const report = blockedReport({ sample, status: 'blocked_source_unavailable', blockers: sourceCheck.blockers });
    await writeBlockedPackage({ outputDir, sample, report, brief: null });
    return { ok: true, outputDir, sample, report, partGraph: null, dsl: null, qa: null };
  }
  await fs.copyFile(sourceImagePath, path.join(outputDir, 'source-image.jpg'));

  const calibration = await runCalibrationBenchmark({
    truth: sample.calibration.ground_truth,
    topologySeed: sample.topology.seed,
    detailSeed: sample.topology.detail_seed,
    calibrationReview: sample.calibration.review_decision,
    topologyReview: sample.topology.review_decision,
    outputDir: path.join(outputDir, 'calibration')
  });
  const noReviewProof = buildNoReviewProof(calibration);
  await writeJson(path.join(outputDir, '01-no-review-promotion-blocked.json'), noReviewProof);

  const approval = await resolveStudyReview({ options, sample, calibration });
  await writeJson(path.join(outputDir, '02-facade-study-review.json'), approval);
  const approvalBlockers = [
    ...validateFacadeStudyApproval({
      approval,
      calibrationReviewResult: calibration.acceptedReviewFixtureResult,
      topologyReviewResult: calibration.acceptedTopologyReviewFixtureResult,
      draftViewGraph: calibration.acceptedTopologyDraftViewGraph,
      facadePlaneGraph: calibration.facadePlaneGraph
    }),
    ...(calibration.report.gates.two_horizontal_families ? [] : ['two_horizontal_direction_families_required']),
    ...(calibration.report.gates.line_recall ? [] : ['structure_line_coverage_gate_failed'])
  ];
  if (approvalBlockers.length) {
    const report = blockedReport({
      sample,
      status: 'blocked_no_accepted_facade_study_review',
      blockers: [...new Set(approvalBlockers)],
      calibration,
      noReviewProof
    });
    const brief = buildFacadeMcpBrief({ sample, calibration, report });
    await writeBlockedPackage({ outputDir, sample, report, brief });
    return { ok: true, outputDir, sample, calibration, approval, report, mcpModelingBrief: brief, partGraph: null, dsl: null, qa: null };
  }

  const officialProfile = JSON.parse(await fs.readFile(path.resolve(repoRoot, sample.profile), 'utf8'));
  const studyProfile = buildFacadeStudyProfile(officialProfile, {
    sampleId: sample.sample_id,
    scale: approval.scale_assumption
  });
  const baseAssembly = assembleReviewedFacadeStudyPartGraph({
    sample,
    topologySeed: calibration.topologySeed,
    facadePlaneGraph: calibration.facadePlaneGraph,
    approval,
    profile: studyProfile
  });
  const planeLocalEvidence = await buildPlaneLocalEvidencePackage({
    sourceImagePath,
    sourceImage: sample.source.local_path,
    facadePlaneGraph: calibration.facadePlaneGraph,
    outputDir: path.join(outputDir, 'plane-local-evidence'),
    planeFrames: baseAssembly.planeFrames,
    sourceFacadePlaneGraph: 'calibration/facade-plane-graph.accepted-calibration.candidates.json'
  });
  const localDetailReview = await resolveLocalDetailReview({ options, sample, planeLocalEvidence });
  const detailPromotion = promoteReviewedPlaneLocalDetails({
    graph: planeLocalEvidence.graph,
    reviewDecision: localDetailReview,
    sourcePlaneLocalEvidenceGraph: 'plane-local-evidence/plane-local-evidence-graph.json',
    sourceReviewDecision: '08-plane-local-evidence-review.json'
  });
  const assembly = assembleReviewedFacadeStudyPartGraph({
    sample,
    topologySeed: calibration.topologySeed,
    facadePlaneGraph: calibration.facadePlaneGraph,
    approval,
    profile: studyProfile,
    detailPromotion
  });
  const dsl = compilePartGraphToSketchUpDsl(assembly.partGraph, studyProfile, { repoRoot });
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(outputDir, 'mock-session.json') } });
  await bridge.reset_model({ runtime: 'mock' });
  const built = await bridge.build_model({ code: JSON.stringify(dsl), runtime: 'mock' });
  const qa = await bridge.validate_model({
    snapshot: built.snapshot,
    runtime: 'mock',
    spec: buildFacadeStudyQaSpec(assembly.partGraph),
    includePreview: true,
    strictCollisions: true,
    strictUnanchored: false
  });
  const sourceImageBuffer = await fs.readFile(sourceImagePath);
  const metadata = await sharp(sourceImageBuffer).metadata();
  const reprojectionImageBuffer = await sharp(sourceImageBuffer).png().toBuffer();
  const reprojectionSvg = renderPlaneLocalDetailReprojectionOverlaySvg({
    promotion: detailPromotion,
    sourceImageBuffer: reprojectionImageBuffer,
    width: metadata.width,
    height: metadata.height
  });
  const isometricSvg = renderFacadeStudyIsometricSvg({
    partGraph: assembly.partGraph,
    title: `${sample.sample_id} reviewed visible facade study`
  });
  const report = completedReport({
    sample,
    calibration,
    approval,
    noReviewProof,
    planeLocalEvidence,
    localDetailReview,
    detailPromotion,
    partGraph: assembly.partGraph,
    dsl,
    built,
    qa
  });
  const brief = buildFacadeMcpBrief({
    sample,
    calibration,
    report,
    planeLocalEvidence,
    localDetailReview,
    detailPromotion
  });

  await Promise.all([
    writeJson(path.join(outputDir, '03-study-product-profile.json'), studyProfile),
    writeJson(path.join(outputDir, '04-reviewed-visible-facade-part-graph.json'), assembly.partGraph),
    writeJson(path.join(outputDir, '05-sketchup-dsl.mock-study.json'), dsl),
    writeJson(path.join(outputDir, '06-mock-snapshot.json'), built.snapshot),
    writeJson(path.join(outputDir, '07-mock-qa.json'), qa),
    writeJson(path.join(outputDir, '08-plane-local-evidence-review.json'), localDetailReview),
    writeJson(path.join(outputDir, '09-plane-local-detail-promotion.json'), detailPromotion),
    fs.writeFile(path.join(outputDir, '10-isometric-study.svg'), isometricSvg, 'utf8'),
    sharp(Buffer.from(isometricSvg)).png().toFile(path.join(outputDir, '10-isometric-study.png')),
    fs.writeFile(path.join(outputDir, '11-source-reprojection.svg'), reprojectionSvg, 'utf8'),
    sharp(Buffer.from(reprojectionSvg)).png().toFile(path.join(outputDir, '11-source-reprojection.png')),
    writeJson(path.join(outputDir, '12-mcp-modeling-brief.json'), brief),
    fs.writeFile(path.join(outputDir, '12-mcp-modeling-brief.md'), renderMcpBriefMarkdown(brief), 'utf8'),
    writeJson(path.join(outputDir, 'facade-study-report.json'), report),
    fs.writeFile(path.join(outputDir, 'facade-study-report.md'), renderReportMarkdown(report), 'utf8'),
    fs.writeFile(path.join(outputDir, 'index.html'), renderStudyHtml({ sample, report }), 'utf8'),
    writePreviewFiles(path.join(outputDir, 'orthographic-preview'), qa.preview)
  ]);
  return {
    ok: true,
    outputDir,
    sample,
    calibration,
    approval,
    planeLocalEvidence,
    localDetailReview,
    detailPromotion,
    partGraph: assembly.partGraph,
    dsl,
    snapshot: built.snapshot,
    qa,
    mcpModelingBrief: brief,
    report
  };
}

async function verifySource(sample, sourceImagePath) {
  const blockers = [];
  let buffer = null;
  try {
    buffer = await fs.readFile(sourceImagePath);
  } catch {
    blockers.push('external_source_image_not_prepared');
  }
  const actualSha256 = buffer ? crypto.createHash('sha256').update(buffer).digest('hex') : null;
  if (actualSha256 && actualSha256 !== sample.source.sha256) blockers.push('external_source_sha256_mismatch');
  return {
    kind: 'facade_drafting_study_source_check_v1',
    sample_id: sample.sample_id,
    ok: blockers.length === 0,
    local_path: sample.source.local_path,
    expected_sha256: sample.source.sha256,
    actual_sha256: actualSha256,
    dataset_committed: false,
    blockers
  };
}

async function resolveStudyReview({ options, sample, calibration }) {
  if (options.studyReview && typeof options.studyReview === 'object') return structuredClone(options.studyReview);
  if (typeof options.studyReview === 'string') return readRepoJson(options.studyReview);
  if (options.acceptedStudyReviewFixture === true) return readRepoJson(sample.study_review);
  return {
    kind: 'reviewed_facade_model_study_approval_v1',
    version: 1,
    sample_id: sample.sample_id,
    reviewer: 'pending-facade-study-review',
    status: 'not_accepted',
    accepted_axis_family_ids: [],
    accepted_topology_ids: [],
    accepted_view_slot_ids: [],
    accepted_plane_ids: [],
    detail_review: { status: 'not_accepted', accepted_detail_ids: [], promotion_allowed: false },
    scale_assumption: { status: 'not_accepted', width: 0, depth: 0, height: 0, units: 'mm', confidence: 0, release_allowed: false },
    hidden_geometry_assumptions: [],
    scope: { part_graph_study_allowed: false, sketchup_mock_allowed: false, live_sketchup_allowed: false, release_allowed: false },
    blockers: [
      'accepted_facade_study_review_required',
      'accepted_metric_scale_anchor_required',
      'accepted_hidden_geometry_review_required'
    ],
    notes: [`Detected planes remain candidates: ${calibration.facadePlaneGraph.planes.map((plane) => plane.id).join(', ')}`]
  };
}

async function resolveLocalDetailReview({ options, sample, planeLocalEvidence }) {
  if (options.localDetailReview && typeof options.localDetailReview === 'object') return structuredClone(options.localDetailReview);
  if (typeof options.localDetailReview === 'string') return readRepoJson(options.localDetailReview);
  if (options.acceptedLocalDetailReviewFixture === true && sample.local_detail_review) {
    return readRepoJson(sample.local_detail_review);
  }
  return planeLocalEvidence.pendingReview;
}

function buildNoReviewProof(calibration) {
  return {
    kind: 'facade_drafting_no_review_promotion_proof_v1',
    version: 1,
    calibration_review_status: calibration.pendingReviewResult.status,
    topology_review_status: calibration.pendingTopologyReviewResult.status,
    draft_view_status: calibration.blockedDraftViewGraph.review_policy.status,
    part_graph_generated: false,
    sketchup_dsl_generated: false,
    promoted_geometry_action_count: 0,
    false_promotion_count: 0,
    promotion_allowed: false,
    blockers: [
      'accepted_perspective_calibration_review_required',
      'accepted_corner_chain_topology_review_required',
      'accepted_facade_plane_review_required'
    ]
  };
}

function blockedReport({ sample, status, blockers, calibration = null, noReviewProof = null }) {
  return {
    kind: 'facade_drafting_study_report_v1',
    version: 1,
    sample_id: sample.sample_id,
    status,
    source_available: status !== 'blocked_source_unavailable',
    calibration_status: calibration?.acceptedReviewFixtureResult?.status || 'not_run',
    topology_status: calibration?.acceptedTopologyReviewFixtureResult?.status || 'not_run',
    no_review_false_promotion_count: noReviewProof?.false_promotion_count ?? 0,
    model: {
      part_graph_generated: false,
      sketchup_dsl_generated: false,
      mock_executed: false,
      release_allowed: false
    },
    blockers,
    artifacts: {
      source_check: '00-source-check.json',
      no_review_proof: noReviewProof ? '01-no-review-promotion-blocked.json' : null
    }
  };
}

function completedReport({ sample, calibration, approval, noReviewProof, planeLocalEvidence, localDetailReview, detailPromotion, partGraph, dsl, built, qa }) {
  const detailAccepted = detailPromotion.partgraph_promotion_allowed === true;
  const detailCoverageComplete = localDetailReview.review_scope?.coverage_status === 'accepted_visible_detail_coverage';
  const completionStatus = buildModelCompletionStatus({
    calibrationAccepted: true,
    topologyAccepted: true,
    visiblePlanesAccepted: true,
    planeLocalDetailsAccepted: detailAccepted && detailCoverageComplete,
    reprojectionQaPassed: detailPromotion.reprojection_qa.status === 'pass',
    metricScaleAccepted: false,
    hiddenGeometryAccepted: false
  });
  if (detailAccepted && !detailCoverageComplete) {
    completionStatus.visual_blockers = ['accepted_visible_detail_coverage_review_required'];
    completionStatus.release_blockers = [
      'accepted_visible_detail_coverage_review_required',
      'accepted_metric_scale_anchor_required',
      'accepted_hidden_geometry_review_required'
    ];
  }
  return {
    kind: 'facade_drafting_study_report_v1',
    version: 1,
    sample_id: sample.sample_id,
    status: detailAccepted ? 'visible_detail_subset_generated_coverage_review_required' : 'visible_plane_study_generated_detail_review_required',
    source_available: true,
    calibration_status: calibration.acceptedReviewFixtureResult.status,
    topology_status: calibration.acceptedTopologyReviewFixtureResult.status,
    accepted_axis_family_ids: approval.accepted_axis_family_ids,
    accepted_topology_ids: approval.accepted_topology_ids,
    accepted_plane_ids: approval.accepted_plane_ids,
    no_review_false_promotion_count: noReviewProof.false_promotion_count,
    coordinate_mapping: {
      source_raster: planeLocalEvidence.graph.planes[0]?.rectification.source_raster_size || null,
      calibration_reference: calibration.structureLineEvidence.source_image,
      checked: planeLocalEvidence.graph.planes.every((plane) => Boolean(plane.rectification.coordinate_transform))
    },
    model: {
      part_count: partGraph.parts.length,
      plane_part_count: partGraph.parts.filter((part) => part.type === 'reviewed_visible_plane').length,
      accepted_detail_count: detailPromotion.accepted_details.length,
      part_graph_generated: true,
      sketchup_dsl_generated: true,
      dsl_operation_count: dsl.operations.length,
      mock_executed: true,
      mock_group_count: built.snapshot.totals?.groups || built.snapshot.groups?.length || 0,
      qa_verdict: qa.verdict,
      qa_error_count: qa.summary?.by_severity?.error || 0,
      release_allowed: false
    },
    plane_local_evidence: planeLocalEvidence.graph.summary,
    local_detail_review: {
      status: localDetailReview.status,
      reviewer: localDetailReview.reviewer,
      coverage_status: localDetailReview.review_scope?.coverage_status || 'not_accepted',
      promotion_status: detailPromotion.status,
      reprojection_qa_status: detailPromotion.reprojection_qa.status,
      false_promotion_count: detailPromotion.false_promotion_count
    },
    completion_status: completionStatus,
    blockers: [
      'accepted_metric_scale_anchor_required',
      'accepted_hidden_geometry_review_required',
      ...(detailAccepted
        ? detailCoverageComplete ? [] : ['accepted_visible_detail_coverage_review_required']
        : ['accepted_plane_local_detail_review_required'])
    ],
    artifacts: {
      source_check: '00-source-check.json',
      no_review_proof: '01-no-review-promotion-blocked.json',
      study_review: '02-facade-study-review.json',
      part_graph: '04-reviewed-visible-facade-part-graph.json',
      sketchup_dsl: '05-sketchup-dsl.mock-study.json',
      mock_qa: '07-mock-qa.json',
      plane_local_evidence: 'plane-local-evidence/index.html',
      detail_review: '08-plane-local-evidence-review.json',
      detail_promotion: '09-plane-local-detail-promotion.json',
      isometric_preview: '10-isometric-study.png',
      source_reprojection: '11-source-reprojection.png',
      mcp_brief: '12-mcp-modeling-brief.json'
    }
  };
}

function buildFacadeMcpBrief({ sample, calibration, report, planeLocalEvidence = null, localDetailReview = null, detailPromotion = null }) {
  const next = structuredClone(calibration?.mcpModelingBrief || {
    kind: 'mcp_modeling_brief',
    version: 1,
    profile_id: sample.domain,
    agent_contract: { status: 'review_blocked', authoritative_artifacts: [], output_policy: {} }
  });
  const modelReady = report.model.part_graph_generated === true;
  next.asset_set_id = `${sample.sample_id}-facade-drafting-study`;
  next.status = modelReady ? 'mock_study_authorized_release_blocked' : 'review_blocked';
  next.compile_permission = {
    can_generate_sketchup_dsl: modelReady,
    can_promote_candidates: modelReady,
    reasons: modelReady ? [] : report.blockers
  };
  next.plane_local_evidence = planeLocalEvidence ? {
    status: planeLocalEvidence.graph.review_policy.status,
    plane_count: planeLocalEvidence.graph.summary.plane_count,
    detail_instance_proposal_count: planeLocalEvidence.graph.summary.detail_instance_proposal_count,
    source: 'plane-local-evidence/plane-local-evidence-graph.json',
    promotion_allowed: false
  } : { status: 'blocked_before_accepted_plane_review', promotion_allowed: false };
  next.local_detail_review = localDetailReview ? {
    status: localDetailReview.status,
    reviewer: localDetailReview.reviewer,
    promotion_allowed: false,
    source: '08-plane-local-evidence-review.json'
  } : null;
  next.detail_promotion = detailPromotion ? {
    status: detailPromotion.status,
    accepted_detail_count: detailPromotion.accepted_details.length,
    reprojection_qa_status: detailPromotion.reprojection_qa.status,
    partgraph_promotion_allowed: detailPromotion.partgraph_promotion_allowed,
    direct_compile_allowed: false,
    false_promotion_count: detailPromotion.false_promotion_count,
    source: '09-plane-local-detail-promotion.json'
  } : null;
  next.promotion_status = {
    status: modelReady ? 'ready_for_mock_study_partgraph' : 'blocked_pending_review',
    calibration_review_status: report.calibration_status,
    topology_review_status: report.topology_status,
    draft_view_review_status: modelReady ? 'accepted_for_mock_study_derived_display' : 'needs_draft_view_review',
    domain_review_status: modelReady ? 'accepted_for_mock_study' : 'needs_plane_review',
    local_detail_review_status: localDetailReview?.status || 'not_run',
    partgraph_promotion_allowed: modelReady,
    sketchup_dsl_allowed: modelReady,
    runtime_scope: 'mock_study_only',
    release_allowed: false,
    blockers: report.blockers
  };
  next.artifact_sequence = [
    { order: 1, stage: 'structure_line_evidence', available: Boolean(calibration), status: calibration ? 'evidence_ready_for_calibration' : 'not_run' },
    { order: 2, stage: 'perspective_calibration', available: Boolean(calibration), status: report.calibration_status },
    { order: 3, stage: 'calibrated_view_graph', available: Boolean(calibration), status: report.topology_status },
    { order: 4, stage: 'corner_chain_topology', available: Boolean(calibration), status: report.topology_status },
    { order: 5, stage: 'draft_view_graph', available: Boolean(calibration), status: modelReady ? 'accepted_for_mock_study_derived_display' : 'review_required' },
    { order: 6, stage: 'facade_plane_graph', available: Boolean(calibration), status: modelReady ? 'accepted_for_mock_study' : 'review_required' },
    { order: 7, stage: 'plane_local_detail_candidates', available: Boolean(planeLocalEvidence), status: planeLocalEvidence ? planeLocalEvidence.graph.review_policy.status : 'blocked' },
    { order: 8, stage: 'promotion_status', available: true, status: next.promotion_status.status },
    { order: 9, stage: 'part_graph', available: modelReady, status: modelReady ? 'generated_from_accepted_ids' : 'blocked' },
    { order: 10, stage: 'sketchup_dsl', available: modelReady, status: modelReady ? 'mock_study_generated' : 'blocked' }
  ];
  next.source = {
    ...(next.source || {}),
    source_description: sample.source.description_url,
    facade_study_review: '02-facade-study-review.json',
    plane_local_evidence_graph: planeLocalEvidence ? 'plane-local-evidence/plane-local-evidence-graph.json' : null,
    part_graph: modelReady ? '04-reviewed-visible-facade-part-graph.json' : null,
    sketchup_dsl: modelReady ? '05-sketchup-dsl.mock-study.json' : null
  };
  next.agent_contract = {
    ...(next.agent_contract || {}),
    status: next.status,
    output_policy: {
      ...(next.agent_contract?.output_policy || {}),
      sketchup_dsl_allowed: modelReady,
      candidate_promotion_allowed: modelReady,
      release_allowed: false,
      blockers: report.blockers
    }
  };
  return next;
}

async function writeBlockedPackage({ outputDir, sample, report, brief }) {
  const tasks = [
    writeJson(path.join(outputDir, 'facade-study-report.json'), report),
    fs.writeFile(path.join(outputDir, 'facade-study-report.md'), renderReportMarkdown(report), 'utf8'),
    fs.writeFile(path.join(outputDir, 'index.html'), renderStudyHtml({ sample, report }), 'utf8')
  ];
  if (brief) tasks.push(
    writeJson(path.join(outputDir, '12-mcp-modeling-brief.json'), brief),
    fs.writeFile(path.join(outputDir, '12-mcp-modeling-brief.md'), renderMcpBriefMarkdown(brief), 'utf8')
  );
  await Promise.all(tasks);
}

function renderMcpBriefMarkdown(brief) {
  const slotSummary = (brief.draft_view_graph?.view_slots || brief.draft_view_graph?.slots || [])
    .map((slot) => `${slot.slot_id || slot.id}:${slot.status}`)
    .join(', ');
  const planeSummary = (brief.facade_plane_graph?.planes || [])
    .map((plane) => plane.id)
    .join(', ');
  return `# Facade Drafting MCP Brief\n\n## DraftViewGraph\n\n- status: \`${brief.promotion_status.draft_view_review_status}\`\n- slots: ${slotSummary || 'see source DraftViewGraph artifact'}\n\n## FacadePlaneGraph\n\n- status: \`${brief.promotion_status.domain_review_status}\`\n- planes: ${planeSummary || 'see source FacadePlaneGraph artifact'}\n\n## Plane-Local Detail Candidates\n\n- status: \`${brief.plane_local_evidence.status}\`\n- proposal count: \`${brief.plane_local_evidence.detail_instance_proposal_count || 0}\`\n- accepted details: \`${brief.detail_promotion?.accepted_detail_count || 0}\`\n\n## Promotion Status\n\n- PartGraph allowed: \`${brief.promotion_status.partgraph_promotion_allowed}\`\n- SketchUp DSL allowed: \`${brief.promotion_status.sketchup_dsl_allowed}\`\n- release allowed: \`false\`\n- blockers: ${brief.promotion_status.blockers.map((blocker) => `\`${blocker}\``).join(', ') || 'none'}\n`;
}

function renderReportMarkdown(report) {
  return `# Facade Drafting Study\n\n- sample: \`${report.sample_id}\`\n- status: \`${report.status}\`\n- PartGraph generated: \`${report.model.part_graph_generated}\`\n- SketchUp DSL generated: \`${report.model.sketchup_dsl_generated}\`\n- mock executed: \`${report.model.mock_executed}\`\n- release allowed: \`false\`\n- no-review false promotions: \`${report.no_review_false_promotion_count}\`\n\n## Blockers\n\n${report.blockers.map((blocker) => `- \`${blocker}\``).join('\n')}\n`;
}

function renderStudyHtml({ sample, report }) {
  const modeled = report.model.part_graph_generated === true;
  const modelSection = modeled
    ? `<section><h2>Reviewed visible-plane model</h2><div class="grid"><img src="10-isometric-study.png" alt="Reviewed visible facade model"><img src="orthographic-preview/top.svg" alt="Accepted visible topology plan"></div></section><section><h2>Plane-local evidence</h2><p><a href="plane-local-evidence/index.html">Open rectified plane review workbench</a></p><div class="grid"><img src="plane-local-evidence/visible_plane_primary_left.evidence.png" alt="Left rectified plane evidence"><img src="plane-local-evidence/visible_plane_primary_right.evidence.png" alt="Right rectified plane evidence"></div></section>`
    : '<section><h2>Promotion blocked</h2><p>No PartGraph, SketchUp DSL, or mock geometry was generated.</p></section>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(sample.sample_id)} facade study</title><style>body{margin:0;background:#eef2f1;color:#172026;font-family:Inter,system-ui,sans-serif}header,main{max-width:1280px;margin:auto;padding:22px 28px}header{background:#fff;border-bottom:1px solid #cbd5e1}h1{font-size:22px;margin:0 0 6px}section{padding:20px 0;border-bottom:1px solid #cbd5e1}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{width:100%;height:auto;background:#fff;border:1px solid #94a3b8}code,.status{font-family:ui-monospace,monospace}.status{color:#991b1b}a{color:#075985}@media(max-width:800px){.grid{grid-template-columns:1fr}}</style></head><body><header><h1>${escapeHtml(sample.sample_id)} Drafting-First study</h1><p class="status">${escapeHtml(report.status)} / release=false</p><p>${escapeHtml(sample.source.attribution)} / ${escapeHtml(sample.source.license)}</p></header><main><section><h2>Source and calibrated evidence</h2><div class="grid"><img src="source-image.jpg" alt="Source facade"><img src="calibration/02-perspective-direction-families.png" alt="Perspective direction families"></div></section><section><h2>Accepted visible topology</h2><img src="calibration/04-calibrated-plane-topology.png" alt="Accepted facade plane topology"></section>${modelSection}<section><h2>Gate status</h2><ul>${report.blockers.map((blocker) => `<li><code>${escapeHtml(blocker)}</code></li>`).join('')}</ul><p><a href="01-no-review-promotion-blocked.json">No-review proof</a> | <a href="facade-study-report.json">Report</a>${modeled ? ' | <a href="04-reviewed-visible-facade-part-graph.json">PartGraph</a> | <a href="05-sketchup-dsl.mock-study.json">SketchUp DSL</a> | <a href="07-mock-qa.json">Mock QA</a>' : ''}</p></section></main></body></html>`;
}

async function writePreviewFiles(outputDir, preview) {
  if (!preview) return;
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    ...(preview.views || []).map((view) => fs.writeFile(path.join(outputDir, `${safeFileName(view.name)}.svg`), view.svg, 'utf8')),
    fs.writeFile(path.join(outputDir, 'index.html'), preview.html, 'utf8')
  ]);
}

async function readRepoJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(repoRoot, filePath), 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeFileName(value) {
  return String(value || 'view').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'view';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--sample') options.sample = args[++index];
    else if (args[index] === '--output-dir') options.outputDir = args[++index];
    else if (args[index] === '--accepted-study-review-fixture') options.acceptedStudyReviewFixture = true;
    else if (args[index] === '--study-review') options.studyReview = args[++index];
    else if (args[index] === '--accepted-local-detail-review-fixture') options.acceptedLocalDetailReviewFixture = true;
    else if (args[index] === '--local-detail-review') options.localDetailReview = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFacadeDraftingStudy(parseArgs(process.argv.slice(2)))
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
