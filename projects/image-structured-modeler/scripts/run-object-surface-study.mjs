#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { compilePartGraphToSketchUpDsl } from '../../../src/product-modeling/part-graph-compiler.mjs';
import {
  annotateObservationSetWithDraftingFirstGraphs,
  buildDefaultDraftViewReviewDecision,
  buildDefaultLocalDetailReviewDecision
} from './lib/drafting-first-graphs.mjs';
import {
  buildPendingObjectSurfaceReview,
  buildReviewedObjectFeatureSubsetPartGraph,
  evaluateObjectSurfaceReview,
  promoteReviewedObjectSurfaceFeatures
} from './lib/object-surface-review.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_SAMPLE = 'projects/image-structured-modeler/examples/ambulance/object-surface-study/sample.json';
const DEFAULT_OUTPUT = 'output/image-structured-modeler/ambulance-object-surface-study';

export async function runObjectSurfaceStudy(options = {}) {
  const sample = await readRepoJson(options.sample || DEFAULT_SAMPLE);
  const observations = await readRepoJson(sample.observations);
  const seedPartGraph = await readRepoJson(sample.seed_part_graph);
  const baseProfile = await readRepoJson(sample.profile);
  const outputDir = path.resolve(repoRoot, options.outputDir || DEFAULT_OUTPUT);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const drafting = annotateObservationSetWithDraftingFirstGraphs({ observationSet: observations });
  const pendingDraftViewReview = buildDefaultDraftViewReviewDecision({ draftViewGraph: drafting.draftViewGraph, reviewer: 'object-surface-study-template', accepted: false });
  const pendingSurfaceReview = buildPendingObjectSurfaceReview();
  const pendingSurfaceResult = evaluateObjectSurfaceReview({
    objectSurfaceGraph: drafting.objectSurfaceGraph,
    draftViewGraph: drafting.draftViewGraph,
    draftViewReviewDecision: pendingDraftViewReview,
    reviewDecision: pendingSurfaceReview
  });
  const pendingLocalDetailReview = buildDefaultLocalDetailReviewDecision({ objectSurfaceGraph: drafting.objectSurfaceGraph, reviewer: 'object-local-detail-template', accepted: false });
  const pendingFeaturePromotion = promoteReviewedObjectSurfaceFeatures({
    objectSurfaceGraph: drafting.objectSurfaceGraph,
    surfaceReviewResult: pendingSurfaceResult,
    localDetailReviewDecision: pendingLocalDetailReview,
    seedPartGraph
  });
  const acceptedFixtures = options.acceptedReviewFixtures === true;
  const draftViewReview = acceptedFixtures
    ? await readRepoJson(sample.draft_view_review)
    : pendingDraftViewReview;
  const surfaceReviewDecision = acceptedFixtures
    ? await readRepoJson(sample.surface_review)
    : pendingSurfaceReview;
  const surfaceReviewResult = evaluateObjectSurfaceReview({
    objectSurfaceGraph: drafting.objectSurfaceGraph,
    draftViewGraph: drafting.draftViewGraph,
    draftViewReviewDecision: draftViewReview,
    reviewDecision: surfaceReviewDecision
  });
  const localDetailReview = acceptedFixtures
    ? await readRepoJson(sample.local_detail_review)
    : pendingLocalDetailReview;
  const featurePromotion = promoteReviewedObjectSurfaceFeatures({
    objectSurfaceGraph: drafting.objectSurfaceGraph,
    surfaceReviewResult,
    localDetailReviewDecision: localDetailReview,
    seedPartGraph
  });
  const noReviewProof = {
    kind: 'object_surface_no_review_promotion_proof_v1', version: 1,
    draft_view_review_status: pendingDraftViewReview.status,
    object_surface_review_status: pendingSurfaceResult.status,
    local_detail_review_status: pendingLocalDetailReview.status,
    feature_promotion_status: pendingFeaturePromotion.status,
    part_graph_generated: false, sketchup_dsl_generated: false, promoted_geometry_action_count: 0,
    false_promotion_count: 0, promotion_allowed: false,
    blockers: ['accepted_draft_view_review_required', 'accepted_object_surface_review_required', 'accepted_local_detail_review_required']
  };
  await Promise.all([
    writeJson(path.join(outputDir, '01-structure-evidence-graph.json'), drafting.structureEvidenceGraph),
    writeJson(path.join(outputDir, '02-draft-view-graph.json'), drafting.draftViewGraph),
    writeJson(path.join(outputDir, '03-object-surface-graph.json'), drafting.objectSurfaceGraph),
    writeJson(path.join(outputDir, '04-draft-view-review.json'), draftViewReview),
    writeJson(path.join(outputDir, '05-object-surface-review.json'), surfaceReviewDecision),
    writeJson(path.join(outputDir, '06-object-surface-review-result.json'), surfaceReviewResult),
    writeJson(path.join(outputDir, '07-local-detail-review.json'), localDetailReview),
    writeJson(path.join(outputDir, '08-object-surface-feature-promotion.json'), featurePromotion),
    writeJson(path.join(outputDir, '09-no-review-promotion-blocked.json'), noReviewProof)
  ]);

  if (featurePromotion.status !== 'accepted_for_mock_partgraph') {
    const report = buildReport({ sample, drafting, surfaceReviewResult, featurePromotion, noReviewProof, status: 'blocked_review_incomplete' });
    const brief = buildMcpBrief({ sample, drafting, surfaceReviewResult, featurePromotion, report });
    await writeFinalDocuments({ outputDir, report, brief, overlayManifest: [] });
    return { ok: true, outputDir, sample, drafting, draftViewReview, surfaceReviewDecision, surfaceReviewResult, localDetailReview, featurePromotion, report, mcpModelingBrief: brief, partGraph: null, dsl: null, qa: null };
  }

  const partGraph = buildReviewedObjectFeatureSubsetPartGraph({ seedPartGraph, featurePromotion, sampleId: sample.sample_id });
  const profile = buildMockStudyProfile(baseProfile, seedPartGraph.scale);
  const dsl = compilePartGraphToSketchUpDsl(partGraph, profile, { repoRoot });
  const bridge = new SketchUpBridge({ mock: { sessionPath: path.join(outputDir, 'mock-session.json') } });
  await bridge.reset_model({ runtime: 'mock' });
  const built = await bridge.build_model({ code: JSON.stringify(dsl), runtime: 'mock' });
  const qa = await bridge.validate_model({
    snapshot: built.snapshot,
    runtime: 'mock',
    spec: objectStudyQaSpec(),
    includePreview: true,
    strictCollisions: false,
    strictUnanchored: false
  });
  const overlayManifest = await renderAcceptedFeatureOverlays({ outputDir: path.join(outputDir, 'accepted-feature-overlays'), objectSurfaceGraph: drafting.objectSurfaceGraph, featurePromotion });
  const report = buildReport({ sample, drafting, surfaceReviewResult, featurePromotion, noReviewProof, status: 'reviewed_feature_subset_generated_release_blocked', partGraph, dsl, built, qa });
  const brief = buildMcpBrief({ sample, drafting, surfaceReviewResult, featurePromotion, report });
  await Promise.all([
    writeJson(path.join(outputDir, '10-study-product-profile.json'), profile),
    writeJson(path.join(outputDir, '11-reviewed-feature-subset-part-graph.json'), partGraph),
    writeJson(path.join(outputDir, '12-sketchup-dsl.mock-study.json'), dsl),
    writeJson(path.join(outputDir, '13-mock-snapshot.json'), built.snapshot),
    writeJson(path.join(outputDir, '14-mock-qa.json'), qa),
    writePreviewFiles(path.join(outputDir, 'orthographic-preview'), qa.preview)
  ]);
  await writeFinalDocuments({ outputDir, report, brief, overlayManifest });
  return { ok: true, outputDir, sample, drafting, draftViewReview, surfaceReviewDecision, surfaceReviewResult, localDetailReview, featurePromotion, partGraph, dsl, snapshot: built.snapshot, qa, report, mcpModelingBrief: brief, overlayManifest };
}

function buildMockStudyProfile(baseProfile, scale) {
  const profile = structuredClone(baseProfile);
  profile.required_parts = [];
  profile.default_scale = { width: scale.width, depth: scale.depth, height: scale.height };
  profile.compiler = { ...(profile.compiler || {}), version: 'reviewed-object-surface-subset-v1', geometry_gate: { enabled: false } };
  return profile;
}

function objectStudyQaSpec() {
  return {
    title: 'Reviewed Object Surface Feature Subset Mock QA',
    rules: {
      allowed_collisions: [{
        item: '/^(Ambulance_|Roof_).*/',
        with: '/^(Ambulance_High_Roof_Main_Body|Ambulance_Cab_Lower_Nose|Ambulance_Cab_Raked_Upper_Shell|Ambulance_Large_Raked_Windshield|Ambulance_Left_Red_Side_Stripe|Ambulance_Left_Side_Dark_Window|Roof_Red_Emergency_Lightbar).*/'
      }],
      inside: [
        { match: '^Ambulance_Left_Side_Dark_Window$', parent: 'Ambulance_High_Roof_Main_Body', axes: ['x', 'z'], tolerance_mm: 20 },
        { match: '^Roof_Red_Emergency_Lightbar$', parent: 'Ambulance_High_Roof_Main_Body', axes: ['x', 'y'], tolerance_mm: 35 }
      ],
      support: [
        { match: '^Roof_Red_Emergency_Lightbar$', parent: 'Ambulance_High_Roof_Main_Body', max_gap_mm: 70, allow_penetration_mm: 80 }
      ],
      views: [
        { name: 'top', axes: ['x', 'y'], depthAxis: 'z', title: 'Reviewed Object Top' },
        { name: 'front', axes: ['x', 'z'], depthAxis: 'y', title: 'Reviewed Object Front' },
        { name: 'side', axes: ['y', 'z'], depthAxis: 'x', title: 'Reviewed Object Side' }
      ]
    }
  };
}

function buildReport({ sample, drafting, surfaceReviewResult, featurePromotion, noReviewProof, status, partGraph = null, dsl = null, built = null, qa = null }) {
  return {
    kind: 'object_surface_study_report_v1', version: 1, sample_id: sample.sample_id, status,
    draft_view_status: drafting.draftViewGraph.review_policy.status,
    object_surface_status: surfaceReviewResult.status,
    local_feature_status: featurePromotion.status,
    no_review_false_promotion_count: noReviewProof.false_promotion_count,
    model: {
      part_graph_generated: Boolean(partGraph), sketchup_dsl_generated: Boolean(dsl), mock_executed: Boolean(built),
      accepted_surface_count: featurePromotion.accepted_surface_ids.length,
      accepted_feature_count: featurePromotion.accepted_feature_ids.length,
      accepted_target_part_count: featurePromotion.accepted_target_part_ids.length,
      part_count: partGraph?.parts?.length || 0,
      dsl_operation_count: dsl?.operations?.length || 0,
      qa_verdict: qa?.verdict || null,
      complete_feature_coverage: false,
      metric_scale_accepted: false,
      hidden_surfaces_accepted: false,
      release_allowed: false
    },
    blockers: status === 'blocked_review_incomplete'
      ? featurePromotion.blockers
      : ['accepted_metric_scale_anchor_required', 'accepted_complete_feature_coverage_review_required', 'accepted_hidden_surface_review_required'],
    artifacts: {
      draft_view_graph: '02-draft-view-graph.json', object_surface_graph: '03-object-surface-graph.json',
      surface_review_result: '06-object-surface-review-result.json', feature_promotion: '08-object-surface-feature-promotion.json',
      no_review_proof: '09-no-review-promotion-blocked.json',
      ...(partGraph ? { part_graph: '11-reviewed-feature-subset-part-graph.json', sketchup_dsl: '12-sketchup-dsl.mock-study.json', mock_qa: '14-mock-qa.json' } : {})
    }
  };
}

function buildMcpBrief({ sample, drafting, surfaceReviewResult, featurePromotion, report }) {
  return {
    kind: 'object_surface_mcp_brief_v1', version: 1, sample_id: sample.sample_id,
    sections: [
      { order: 1, id: 'draft_view_graph', artifact: '02-draft-view-graph.json', slots: drafting.draftViewGraph.view_slots.map((slot) => ({ id: slot.slot_id, status: slot.status })) },
      { order: 2, id: 'object_surface_graph', artifact: '03-object-surface-graph.json', status: surfaceReviewResult.status, accepted_surface_ids: surfaceReviewResult.accepted_surface_ids, context_only_surface_ids: surfaceReviewResult.context_only_surface_ids },
      { order: 3, id: 'surface_local_feature_candidates', artifact: '08-object-surface-feature-promotion.json', status: featurePromotion.status, candidate_count: drafting.objectSurfaceGraph.surface_local_feature_candidates.length, accepted_feature_ids: featurePromotion.accepted_feature_ids },
      { order: 4, id: 'promotion_status', partgraph_allowed: report.model.part_graph_generated, sketchup_dsl_allowed: report.model.sketchup_dsl_generated, release_allowed: false, blockers: report.blockers }
    ],
    agent_contract: { accepted_ids_only: true, zero_area_candidates_require_extent_review: true, context_only_surfaces_cannot_become_parts: true, release_allowed: false }
  };
}

async function renderAcceptedFeatureOverlays({ outputDir, objectSurfaceGraph, featurePromotion }) {
  await fs.mkdir(outputDir, { recursive: true });
  const byImage = new Map();
  for (const mapping of featurePromotion.accepted_feature_mappings) {
    if (!byImage.has(mapping.source_image)) byImage.set(mapping.source_image, []);
    byImage.get(mapping.source_image).push(mapping);
  }
  const references = new Map(objectSurfaceGraph.coordinate_references.map((reference) => [reference.source_image, reference]));
  const manifest = [];
  let index = 0;
  for (const [sourceImage, mappings] of byImage) {
    index += 1;
    const reference = references.get(sourceImage);
    const sourcePath = path.resolve(repoRoot, sourceImage);
    const imageBuffer = await sharp(sourcePath).resize(reference.width, reference.height, { fit: 'fill' }).png().toBuffer();
    const href = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    const shapes = mappings.map((mapping) => `<polygon data-layer="accepted-object-feature" data-id="${escapeXml(mapping.feature_id)}" points="${mapping.visible_quad_px.map((point) => point.join(',')).join(' ')}" fill="#facc15" fill-opacity="0.2" stroke="#b45309" stroke-width="3"><title>${escapeXml(`${mapping.feature_id} -> ${mapping.target_part_id}`)}</title></polygon>`).join('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${reference.width}" height="${reference.height}" viewBox="0 0 ${reference.width} ${reference.height}"><image href="${href}" width="${reference.width}" height="${reference.height}"/><g data-layer="accepted-object-features">${shapes}</g></svg>`;
    const base = `accepted-features-${index}`;
    await Promise.all([
      fs.writeFile(path.join(outputDir, `${base}.svg`), svg, 'utf8'),
      sharp(Buffer.from(svg)).png().toFile(path.join(outputDir, `${base}.png`))
    ]);
    manifest.push({ source_image: sourceImage, accepted_feature_ids: mappings.map((mapping) => mapping.feature_id), overlay: `accepted-feature-overlays/${base}.png` });
  }
  await writeJson(path.join(outputDir, 'manifest.json'), { kind: 'accepted_object_feature_overlay_manifest_v1', promotion_allowed: false, images: manifest });
  return manifest;
}

async function writeFinalDocuments({ outputDir, report, brief, overlayManifest }) {
  await Promise.all([
    writeJson(path.join(outputDir, 'object-surface-study-report.json'), report),
    writeJson(path.join(outputDir, 'mcp-modeling-brief.json'), brief),
    fs.writeFile(path.join(outputDir, 'mcp-modeling-brief.md'), renderBriefMarkdown(brief), 'utf8'),
    fs.writeFile(path.join(outputDir, 'index.html'), renderHtml({ report, overlayManifest }), 'utf8')
  ]);
}

function renderBriefMarkdown(brief) {
  const section = (id) => brief.sections.find((item) => item.id === id) || {};
  return `# Object Surface MCP Brief\n\n## DraftViewGraph\n\n- artifact: \`${section('draft_view_graph').artifact}\`\n\n## ObjectSurfaceGraph\n\n- status: \`${section('object_surface_graph').status}\`\n- accepted surfaces: ${(section('object_surface_graph').accepted_surface_ids || []).map((id) => `\`${id}\``).join(', ') || 'none'}\n\n## Surface-Local Feature Candidates\n\n- status: \`${section('surface_local_feature_candidates').status}\`\n- accepted features: \`${(section('surface_local_feature_candidates').accepted_feature_ids || []).length}\`\n\n## Promotion Status\n\n- PartGraph allowed: \`${String(section('promotion_status').partgraph_allowed === true)}\`\n- SketchUp DSL allowed: \`${String(section('promotion_status').sketchup_dsl_allowed === true)}\`\n- release allowed: \`false\`\n- blockers: ${(section('promotion_status').blockers || []).map((id) => `\`${id}\``).join(', ') || 'none'}\n`;
}

function renderHtml({ report, overlayManifest }) {
  const overlays = overlayManifest.map((item) => `<section><h2>${escapeXml(item.source_image)}</h2><img src="${escapeXml(item.overlay)}" alt="accepted feature overlay"></section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Object surface study</title><style>body{margin:0;font:14px system-ui;background:#eef2f1;color:#17202a}header{padding:18px 24px;background:#fff;border-bottom:1px solid #cbd5e1}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;padding:18px}section{background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:12px}img{width:100%;height:auto;display:block}.status{font-family:ui-monospace,monospace;color:#991b1b}</style></head><body><header><strong>${escapeXml(report.sample_id)}</strong><div class="status">${escapeXml(report.status)} / release=false</div></header><main>${overlays || '<section><h2>Promotion blocked</h2><p>No PartGraph or DSL generated.</p></section>'}${report.model.part_graph_generated ? '<section><h2>Mock orthographic preview</h2><img src="orthographic-preview/front.svg" alt="object mock front preview"></section>' : ''}</main></body></html>`;
}

async function writePreviewFiles(outputDir, preview) { await fs.mkdir(outputDir, { recursive: true }); for (const view of preview?.views || []) await fs.writeFile(path.join(outputDir, `${view.name}.svg`), view.svg, 'utf8'); }
async function readRepoJson(relativePath) { return JSON.parse(await fs.readFile(path.resolve(repoRoot, relativePath), 'utf8')); }
async function writeJson(filePath, value) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function escapeXml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--accepted-review-fixtures') options.acceptedReviewFixtures = true;
    else if (argv[index] === '--sample') options.sample = argv[++index];
    else if (argv[index] === '--output-dir') options.outputDir = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runObjectSurfaceStudy(parseCliArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ ok: result.ok, outputDir: result.outputDir, status: result.report.status, acceptedFeatures: result.featurePromotion.accepted_feature_ids.length, partGraphGenerated: Boolean(result.partGraph), qa: result.qa?.verdict || null }, null, 2));
}
