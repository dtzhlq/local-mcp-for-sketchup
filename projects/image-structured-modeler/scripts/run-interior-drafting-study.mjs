#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import {
  buildStructureLineEvidence,
  prepareStructureLineEvidenceImageDataUrl,
  renderStructureLineEvidenceOverlaySvg
} from './lib/opencv-structure-line-backend.mjs';
import { buildPerspectiveCalibrationHypotheses } from './lib/perspective-calibration.mjs';
import {
  buildPendingPerspectiveCalibrationReview,
  evaluatePerspectiveCalibrationReview
} from './lib/perspective-calibration-review.mjs';
import {
  buildPendingRoomLocalDetailReview,
  buildPendingRoomSurfaceReview,
  buildRoomDraftViewGraph,
  buildRoomObjectSurfaceProjection,
  buildRoomSurfaceGraph,
  evaluateRoomSurfaceReview,
  promoteReviewedRoomLocalDetails,
  renderRoomReviewOverlaySvg
} from './lib/room-surface-graph.mjs';
import {
  buildPendingVisibleCoverageReview,
  evaluateVisibleCoverageReview
} from './lib/visible-coverage-review.mjs';
import {
  assembleReviewedRoomStudyPartGraph,
  buildRoomStudyProfile,
  buildRoomStudyQaSpec,
  renderRoomStudyIsometricSvg,
  validateRoomStudyPromotion
} from './lib/reviewed-room-study.mjs';
import { buildModelCompletionStatus } from './lib/model-completion-status.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_SAMPLE = 'projects/image-structured-modeler/examples/interior-hallway-one-point/sample.json';
const DEFAULT_OUTPUT = 'output/image-structured-modeler/interior-hallway-one-point-study';

export async function runInteriorDraftingStudy(options = {}) {
  const samplePath = path.resolve(repoRoot, options.sample || DEFAULT_SAMPLE);
  const outputDir = path.resolve(repoRoot, options.outputDir || DEFAULT_OUTPUT);
  const sample = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  const sourceImagePath = path.resolve(repoRoot, sample.source.local_path);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const sourceCheck = await verifySource(sample, sourceImagePath);
  await writeJson(path.join(outputDir, '00-source-check.json'), sourceCheck);
  if (!sourceCheck.ok) return writeBlockedSourcePackage({ sample, outputDir, sourceCheck });
  const sourceBuffer = await fs.readFile(sourceImagePath);
  await fs.copyFile(sourceImagePath, path.join(outputDir, 'source-image.jpg'));

  const structureLineEvidence = await buildStructureLineEvidence({
    sourceImagePath,
    sourceImage: sample.source.local_path,
    maxWidth: 900,
    seedLimit: 96
  });
  const perspectiveCalibration = buildPerspectiveCalibrationHypotheses({ structureLineEvidence });
  const imageDataUrl = await prepareStructureLineEvidenceImageDataUrl(sourceImagePath);
  const structureOverlay = renderStructureLineEvidenceOverlaySvg({ evidence: structureLineEvidence, calibration: perspectiveCalibration, imageDataUrl });
  await Promise.all([
    writeJson(path.join(outputDir, '01-structure-line-evidence.json'), structureLineEvidence),
    writeJson(path.join(outputDir, '02-perspective-calibration-hypotheses.json'), perspectiveCalibration),
    fs.writeFile(path.join(outputDir, '03-structure-calibration-overlay.svg'), structureOverlay, 'utf8'),
    sharp(Buffer.from(structureOverlay)).png().toFile(path.join(outputDir, '03-structure-calibration-overlay.png'))
  ]);

  const noReview = buildNoReviewProof({ perspectiveCalibration, sample });
  await writeJson(path.join(outputDir, '04-no-review-promotion-blocked.json'), noReview.proof);

  const acceptedFixtures = options.acceptedReviewFixtures === true;
  const calibrationReviewDecision = acceptedFixtures
    ? await readRepoJson(sample.calibration_review)
    : buildPendingPerspectiveCalibrationReview({ perspectiveCalibration });
  const calibrationReviewResult = evaluatePerspectiveCalibrationReview({
    perspectiveCalibration,
    reviewDecision: calibrationReviewDecision,
    sourceReviewDecision: '05-perspective-calibration-review.json'
  });
  await Promise.all([
    writeJson(path.join(outputDir, '05-perspective-calibration-review.json'), calibrationReviewDecision),
    writeJson(path.join(outputDir, '06-perspective-calibration-review-result.json'), calibrationReviewResult)
  ]);
  const topologySeed = await readRepoJson(sample.surface_topology_seed);
  const roomSurfaceGraph = buildRoomSurfaceGraph({ calibrationReviewResult, topologySeed, sourceCalibrationReviewResult: '06-perspective-calibration-review-result.json' });
  const pendingSurfaceReview = buildPendingRoomSurfaceReview();
  const surfaceReviewDecision = acceptedFixtures ? await readRepoJson(sample.surface_review) : pendingSurfaceReview;
  const surfaceReviewResult = evaluateRoomSurfaceReview({ roomSurfaceGraph, reviewDecision: surfaceReviewDecision, sourceReviewDecision: '08-room-surface-review.json' });
  const draftViewGraph = buildRoomDraftViewGraph({ roomSurfaceGraph, roomSurfaceReviewResult: surfaceReviewResult });
  const objectSurfaceGraph = buildRoomObjectSurfaceProjection({ roomSurfaceGraph, draftViewGraph });
  const draftViewReview = acceptedFixtures ? await readRepoJson(sample.draft_view_review) : pendingDraftViewReview();
  const coverageDecision = acceptedFixtures
    ? await readRepoJson(sample.visible_coverage_review)
    : buildPendingVisibleCoverageReview();
  const coverageResult = evaluateVisibleCoverageReview({
    surfaceGraph: roomSurfaceGraph,
    surfaceReviewResult,
    reviewDecision: coverageDecision,
    sourceReviewDecision: '12-visible-coverage-review.json'
  });
  const localDetailDecision = acceptedFixtures
    ? await readRepoJson(sample.local_detail_review)
    : buildPendingRoomLocalDetailReview({ roomSurfaceGraph });
  const detailPromotion = promoteReviewedRoomLocalDetails({ roomSurfaceGraph, roomSurfaceReviewResult: surfaceReviewResult, reviewDecision: localDetailDecision });
  const roomOverlay = renderRoomReviewOverlaySvg({ roomSurfaceGraph, excludedRegions: coverageDecision.excluded_regions || [], sourceImageBuffer: sourceBuffer });
  await Promise.all([
    writeJson(path.join(outputDir, '07-room-surface-graph.json'), roomSurfaceGraph),
    writeJson(path.join(outputDir, '08-room-surface-review.json'), surfaceReviewDecision),
    writeJson(path.join(outputDir, '09-room-surface-review-result.json'), surfaceReviewResult),
    writeJson(path.join(outputDir, '10-draft-view-graph.json'), draftViewGraph),
    writeJson(path.join(outputDir, '11-object-surface-graph.json'), objectSurfaceGraph),
    writeJson(path.join(outputDir, '12-draft-view-review.json'), draftViewReview),
    writeJson(path.join(outputDir, '13-visible-coverage-review.json'), coverageDecision),
    writeJson(path.join(outputDir, '14-visible-coverage-review-result.json'), coverageResult),
    writeJson(path.join(outputDir, '15-local-detail-review.json'), localDetailDecision),
    writeJson(path.join(outputDir, '16-surface-local-detail-promotion.json'), detailPromotion),
    fs.writeFile(path.join(outputDir, '17-room-surface-review-overlay.svg'), roomOverlay, 'utf8'),
    sharp(Buffer.from(roomOverlay)).png().toFile(path.join(outputDir, '17-room-surface-review-overlay.png'))
  ]);

  const blockers = validateRoomStudyPromotion({
    calibrationReviewResult,
    roomSurfaceGraph,
    roomSurfaceReviewResult: surfaceReviewResult,
    draftViewGraph,
    draftViewReviewDecision: draftViewReview,
    visibleCoverageReviewResult: coverageResult,
    detailPromotion,
    mockScale: sample.mock_scale
  });
  if (blockers.length) {
    const report = blockedReport({ sample, perspectiveCalibration, calibrationReviewResult, surfaceReviewResult, coverageResult, detailPromotion, noReview: noReview.proof, blockers });
    const brief = buildMcpBrief({ sample, draftViewGraph, roomSurfaceGraph, detailPromotion, report });
    await writeFinalDocuments({ outputDir, sample, report, brief });
    return { ok: true, outputDir, sample, perspectiveCalibration, calibrationReviewResult, roomSurfaceGraph, surfaceReviewResult, draftViewGraph, objectSurfaceGraph, coverageResult, detailPromotion, report, mcpModelingBrief: brief, partGraph: null, dsl: null, qa: null };
  }

  const profile = buildRoomStudyProfile({ sampleId: sample.sample_id, scale: sample.mock_scale });
  const partGraph = assembleReviewedRoomStudyPartGraph({ sample, roomSurfaceGraph, roomSurfaceReviewResult: surfaceReviewResult, visibleCoverageReviewResult: coverageResult, detailPromotion, profile });
  const dsl = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(outputDir, 'mock-session.json') } });
  await bridge.reset_model({ runtime: 'mock' });
  const built = await bridge.build_model({ code: JSON.stringify(dsl), runtime: 'mock' });
  const qa = await bridge.validate_model({
    snapshot: built.snapshot,
    runtime: 'mock',
    spec: buildRoomStudyQaSpec(partGraph),
    includePreview: true,
    strictCollisions: true,
    strictUnanchored: false
  });
  const completionStatus = buildModelCompletionStatus({
    calibrationAccepted: true,
    topologyAccepted: true,
    visiblePlanesAccepted: true,
    planeLocalDetailsAccepted: true,
    reprojectionQaPassed: detailPromotion.reprojection_qa.status === 'pass',
    metricScaleAccepted: false,
    hiddenGeometryAccepted: false,
    visibleCoverageReviewResult: coverageResult
  });
  const isometric = renderRoomStudyIsometricSvg({ partGraph, title: `${sample.sample_id} reviewed visible room study` });
  const report = completedReport({ sample, perspectiveCalibration, calibrationReviewResult, surfaceReviewResult, coverageResult, detailPromotion, noReview: noReview.proof, partGraph, dsl, built, qa, completionStatus });
  const brief = buildMcpBrief({ sample, draftViewGraph, roomSurfaceGraph, detailPromotion, report });
  await Promise.all([
    writeJson(path.join(outputDir, '18-study-product-profile.json'), profile),
    writeJson(path.join(outputDir, '19-reviewed-visible-room-part-graph.json'), partGraph),
    writeJson(path.join(outputDir, '20-sketchup-dsl.mock-study.json'), dsl),
    writeJson(path.join(outputDir, '21-mock-snapshot.json'), built.snapshot),
    writeJson(path.join(outputDir, '22-mock-qa.json'), qa),
    fs.writeFile(path.join(outputDir, '23-isometric-study.svg'), isometric, 'utf8'),
    sharp(Buffer.from(isometric)).png().toFile(path.join(outputDir, '23-isometric-study.png')),
    writePreviewFiles(path.join(outputDir, 'orthographic-preview'), qa.preview)
  ]);
  await writeFinalDocuments({ outputDir, sample, report, brief });
  return { ok: true, outputDir, sample, structureLineEvidence, perspectiveCalibration, calibrationReviewResult, roomSurfaceGraph, surfaceReviewResult, draftViewGraph, objectSurfaceGraph, coverageResult, detailPromotion, partGraph, dsl, snapshot: built.snapshot, qa, report, mcpModelingBrief: brief };
}

function buildNoReviewProof({ perspectiveCalibration, sample }) {
  const decision = buildPendingPerspectiveCalibrationReview({ perspectiveCalibration });
  const calibrationResult = evaluatePerspectiveCalibrationReview({ perspectiveCalibration, reviewDecision: decision });
  const blockedGraph = buildRoomSurfaceGraph({ calibrationReviewResult: calibrationResult, topologySeed: { source_image: { source_image: sample.source.local_path, width: 960, height: 1280 } } });
  return {
    proof: {
      kind: 'interior_drafting_no_review_promotion_proof_v1', version: 1,
      calibration_review_status: calibrationResult.status,
      room_surface_graph_status: blockedGraph.review_policy.status,
      part_graph_generated: false, sketchup_dsl_generated: false, promoted_geometry_action_count: 0,
      false_promotion_count: 0, promotion_allowed: false,
      blockers: ['accepted_perspective_calibration_review_required', 'accepted_room_surface_review_required', 'accepted_visible_coverage_review_required', 'accepted_local_detail_review_required']
    }
  };
}

function pendingDraftViewReview() {
  return {
    kind: 'draft_view_review_decision_v1', version: 1, source_draft_view_graph: 'draft-view-graph.json',
    reviewer: 'interior-draft-view-review-template', status: 'not_accepted', promotion_allowed: false, compile_allowed: false,
    accepted_view_slot_ids: [], rejected_view_slot_ids: [], corrected_axes: [], accepted_plane_hypothesis_ids: [],
    blockers: ['accepted_draft_view_review_required'], notes: ['No derived draft view is accepted by default.']
  };
}

async function verifySource(sample, sourceImagePath) {
  const blockers = [];
  let buffer = null;
  try { buffer = await fs.readFile(sourceImagePath); } catch { blockers.push('external_source_image_not_prepared'); }
  const actualSha256 = buffer ? crypto.createHash('sha256').update(buffer).digest('hex') : null;
  if (actualSha256 && actualSha256 !== sample.source.sha256) blockers.push('external_source_sha256_mismatch');
  return { kind: 'interior_drafting_source_check_v1', sample_id: sample.sample_id, ok: blockers.length === 0, local_path: sample.source.local_path, expected_sha256: sample.source.sha256, actual_sha256: actualSha256, dataset_committed: false, blockers };
}

function blockedReport({ sample, perspectiveCalibration, calibrationReviewResult, surfaceReviewResult, coverageResult, detailPromotion, noReview, blockers }) {
  return {
    kind: 'interior_drafting_study_report_v1', version: 1, sample_id: sample.sample_id,
    status: 'blocked_review_incomplete', source_available: true,
    calibration_hypothesis_status: perspectiveCalibration.qa.status,
    calibration_review_status: calibrationReviewResult.status,
    surface_review_status: surfaceReviewResult.status,
    visible_coverage_status: coverageResult.status,
    local_detail_status: detailPromotion.status,
    no_review_false_promotion_count: noReview.false_promotion_count,
    model: { part_graph_generated: false, sketchup_dsl_generated: false, mock_executed: false, release_allowed: false },
    blockers, artifacts: artifactLinks(false)
  };
}

function completedReport({ sample, perspectiveCalibration, calibrationReviewResult, surfaceReviewResult, coverageResult, detailPromotion, noReview, partGraph, dsl, built, qa, completionStatus }) {
  return {
    kind: 'interior_drafting_study_report_v1', version: 1, sample_id: sample.sample_id,
    status: completionStatus.visual_status === 'complete' ? 'visual_complete_release_blocked' : 'visible_room_mock_study_generated',
    source_available: true,
    calibration_hypothesis_status: perspectiveCalibration.qa.status,
    calibration_review_status: calibrationReviewResult.status,
    surface_review_status: surfaceReviewResult.status,
    visible_coverage_status: coverageResult.status,
    local_detail_status: detailPromotion.status,
    no_review_false_promotion_count: noReview.false_promotion_count,
    model: {
      part_count: partGraph.parts.length,
      surface_part_count: partGraph.parts.filter((part) => part.type === 'reviewed_visible_surface').length,
      accepted_detail_count: detailPromotion.accepted_details.length,
      excluded_region_count: coverageResult.excluded_regions.length,
      exclusion_geometry_compiled: false,
      part_graph_generated: true, sketchup_dsl_generated: true, dsl_operation_count: dsl.operations.length,
      mock_executed: true, mock_group_count: built.snapshot.totals?.groups || built.snapshot.groups?.length || 0,
      qa_verdict: qa.verdict, qa_error_count: qa.summary?.by_severity?.error || 0, release_allowed: false
    },
    completion_status: completionStatus,
    blockers: completionStatus.release_blockers,
    artifacts: artifactLinks(true)
  };
}

function buildMcpBrief({ sample, draftViewGraph, roomSurfaceGraph, detailPromotion, report }) {
  return {
    kind: 'interior_drafting_mcp_brief_v1', version: 1, sample_id: sample.sample_id,
    sections: [
      { order: 1, id: 'draft_view_graph', artifact: '10-draft-view-graph.json', status: draftViewGraph.review_policy.status, slots: draftViewGraph.view_slots.map((slot) => ({ id: slot.slot_id, status: slot.status, source_evidence_ids: slot.source_evidence_ids })) },
      { order: 2, id: 'room_surface_graph', artifact: '07-room-surface-graph.json', status: roomSurfaceGraph.review_policy.status, surface_ids: roomSurfaceGraph.surfaces.map((surface) => surface.id) },
      { order: 3, id: 'surface_local_detail_candidates', artifact: '16-surface-local-detail-promotion.json', status: detailPromotion.status, candidate_ids: roomSurfaceGraph.surface_local_detail_candidates.map((detail) => detail.id), accepted_ids: detailPromotion.accepted_detail_ids },
      { order: 4, id: 'promotion_status', status: report.model.part_graph_generated ? 'mock_study_authorized_release_blocked' : 'review_blocked', partgraph_allowed: report.model.part_graph_generated, sketchup_dsl_allowed: report.model.sketchup_dsl_generated, release_allowed: false, blockers: report.blockers }
    ],
    agent_contract: {
      accepted_ids_only: true,
      excluded_regions_permanently_non_promotable: true,
      free_text_and_unreviewed_candidates_cannot_promote: true,
      release_allowed: false
    }
  };
}

async function writeFinalDocuments({ outputDir, sample, report, brief }) {
  await Promise.all([
    writeJson(path.join(outputDir, 'interior-study-report.json'), report),
    fs.writeFile(path.join(outputDir, 'interior-study-report.md'), renderReportMarkdown(report), 'utf8'),
    writeJson(path.join(outputDir, 'mcp-modeling-brief.json'), brief),
    fs.writeFile(path.join(outputDir, 'mcp-modeling-brief.md'), renderBriefMarkdown(brief), 'utf8'),
    fs.writeFile(path.join(outputDir, 'index.html'), renderHtml({ sample, report }), 'utf8')
  ]);
}

async function writeBlockedSourcePackage({ sample, outputDir, sourceCheck }) {
  const report = {
    kind: 'interior_drafting_study_report_v1', version: 1, sample_id: sample.sample_id,
    status: 'blocked_source_unavailable', source_available: false,
    calibration_hypothesis_status: 'not_run', calibration_review_status: 'not_run', surface_review_status: 'not_run', visible_coverage_status: 'not_run', local_detail_status: 'not_run',
    no_review_false_promotion_count: 0,
    model: { part_graph_generated: false, sketchup_dsl_generated: false, mock_executed: false, release_allowed: false },
    blockers: sourceCheck.blockers, artifacts: { source_check: '00-source-check.json' }
  };
  const brief = { kind: 'interior_drafting_mcp_brief_v1', version: 1, sample_id: sample.sample_id, sections: [], agent_contract: { accepted_ids_only: true, excluded_regions_permanently_non_promotable: true, free_text_and_unreviewed_candidates_cannot_promote: true, release_allowed: false } };
  await writeFinalDocuments({ outputDir, sample, report, brief });
  return { ok: true, outputDir, sample, report, mcpModelingBrief: brief, partGraph: null, dsl: null, qa: null };
}

function artifactLinks(completed) {
  return {
    source_check: '00-source-check.json', structure_line_evidence: '01-structure-line-evidence.json',
    perspective_calibration: '02-perspective-calibration-hypotheses.json', structure_overlay: '03-structure-calibration-overlay.png',
    no_review_proof: '04-no-review-promotion-blocked.json', room_surface_graph: '07-room-surface-graph.json',
    draft_view_graph: '10-draft-view-graph.json', object_surface_graph: '11-object-surface-graph.json',
    visible_coverage_review: '14-visible-coverage-review-result.json', local_detail_promotion: '16-surface-local-detail-promotion.json',
    room_review_overlay: '17-room-surface-review-overlay.png',
    ...(completed ? { part_graph: '19-reviewed-visible-room-part-graph.json', sketchup_dsl: '20-sketchup-dsl.mock-study.json', mock_qa: '22-mock-qa.json', isometric_preview: '23-isometric-study.png' } : {})
  };
}

function renderBriefMarkdown(brief) {
  const section = (id) => brief.sections.find((item) => item.id === id) || {};
  return `# Interior Drafting MCP Brief\n\n## DraftViewGraph\n\n- status: \`${section('draft_view_graph').status || 'not_available'}\`\n- artifact: \`${section('draft_view_graph').artifact || 'none'}\`\n\n## RoomSurfaceGraph\n\n- status: \`${section('room_surface_graph').status || 'not_available'}\`\n- surfaces: ${(section('room_surface_graph').surface_ids || []).map((id) => `\`${id}\``).join(', ') || 'none'}\n\n## Surface-Local Detail Candidates\n\n- status: \`${section('surface_local_detail_candidates').status || 'not_available'}\`\n- accepted: ${(section('surface_local_detail_candidates').accepted_ids || []).map((id) => `\`${id}\``).join(', ') || 'none'}\n\n## Promotion Status\n\n- PartGraph allowed: \`${String(section('promotion_status').partgraph_allowed === true)}\`\n- SketchUp DSL allowed: \`${String(section('promotion_status').sketchup_dsl_allowed === true)}\`\n- release allowed: \`false\`\n- blockers: ${(section('promotion_status').blockers || []).map((id) => `\`${id}\``).join(', ') || 'none'}\n`;
}

function renderReportMarkdown(report) {
  return `# Interior Drafting Study Report\n\n- sample: \`${report.sample_id}\`\n- status: \`${report.status}\`\n- calibration: \`${report.calibration_review_status}\`\n- surface review: \`${report.surface_review_status}\`\n- visible coverage: \`${report.visible_coverage_status}\`\n- PartGraph generated: \`${String(report.model.part_graph_generated)}\`\n- SketchUp DSL generated: \`${String(report.model.sketchup_dsl_generated)}\`\n- release allowed: \`false\`\n- false promotion count without review: \`${report.no_review_false_promotion_count}\`\n- blockers: ${(report.blockers || []).map((id) => `\`${id}\``).join(', ') || 'none'}\n`;
}

function renderHtml({ sample, report }) {
  const model = report.model.part_graph_generated === true;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(sample.sample_id)} interior drafting study</title><style>body{margin:0;font:14px system-ui;background:#eef2f1;color:#17202a}header{padding:18px 24px;background:#fff;border-bottom:1px solid #cbd5e1}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;padding:18px}.panel{background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:12px}.panel img{width:100%;height:auto;display:block}.status{font-family:ui-monospace,monospace;color:#991b1b}</style></head><body><header><strong>${escapeHtml(sample.sample_id)}</strong><div class="status">${escapeHtml(report.status)} / release=false</div></header><main><section class="panel"><h2>Structure / calibration</h2><img src="03-structure-calibration-overlay.png" alt="structure and calibration overlay"></section><section class="panel"><h2>Room surfaces / details / exclusion</h2><img src="17-room-surface-review-overlay.png" alt="room surface review overlay"></section>${model ? '<section class="panel"><h2>Accepted mock PartGraph</h2><img src="23-isometric-study.png" alt="reviewed room mock study"></section><section class="panel"><h2>Orthographic plan</h2><img src="orthographic-preview/top.svg" alt="room plan preview"></section>' : '<section class="panel"><h2>Promotion blocked</h2><p>No PartGraph or SketchUp DSL was generated.</p></section>'}</main></body></html>`;
}

async function writePreviewFiles(outputDir, preview) {
  await fs.mkdir(outputDir, { recursive: true });
  for (const view of preview?.views || []) await fs.writeFile(path.join(outputDir, `${view.name}.svg`), view.svg, 'utf8');
}

async function readRepoJson(relativePath) { return JSON.parse(await fs.readFile(path.resolve(repoRoot, relativePath), 'utf8')); }
async function writeJson(filePath, value) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--accepted-review-fixtures') options.acceptedReviewFixtures = true;
    if (argv[index] === '--sample') options.sample = argv[++index];
    if (argv[index] === '--output-dir') options.outputDir = argv[++index];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runInteriorDraftingStudy(parseCliArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ ok: result.ok, outputDir: result.outputDir, status: result.report.status, partGraphGenerated: Boolean(result.partGraph), qa: result.qa?.verdict || null }, null, 2));
}
