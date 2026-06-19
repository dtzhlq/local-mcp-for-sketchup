#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { repoRoot } from './lib/image-analysis.mjs';
import { validateAutoGroundPlanR10 } from './lib/auto-ground-plan-r10.mjs';
import {
  annotateObservationSetWithBirdEyeLandCoverV1,
  landCoverReport,
  renderBirdEyeSegmentationArtifact
} from './lib/bird-eye-land-cover.mjs';
import { annotateObservationSetWithHighContrastEdgeV1 } from './lib/high-contrast-edge-v1.mjs';
import { annotateObservationSetWithOpenCvEdgeV1 } from './lib/opencv-edge-v1.mjs';
import {
  annotateObservationSetWithVisionEvidenceSetV1,
  buildVisionEvidenceReviewPatch,
  renderVisionEvidenceReviewPatchMarkdown,
  visionEvidenceSetReport
} from './lib/vision-evidence-set-v1.mjs';
import {
  annotateObservationSetWithBoundaryGraphV1,
  boundaryGraphReport
} from './lib/boundary-graph-v1.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const CLASS_STYLE = {
  building_footprint: { fill: '#7bb6e8', stroke: '#1f6ea9', label: 'building' },
  road: { fill: '#c7ccd2', stroke: '#59616a', label: 'road' },
  parking: { fill: '#f2d47c', stroke: '#9b6b00', label: 'parking' },
  green: { fill: '#8fcf92', stroke: '#2f7d35', label: 'green' },
  walkway: { fill: '#d8c3ee', stroke: '#7957a8', label: 'walkway' },
  service_yard: { fill: '#d6a983', stroke: '#8a4f23', label: 'service' },
  gap: { fill: '#eef1f4', stroke: '#c6ccd4', label: 'gap' },
  open_paved_area: { fill: '#dde2e8', stroke: '#8b96a3', label: 'open paved' },
  road_candidate: { fill: '#bfc6ce', stroke: '#45505b', label: 'road candidate' },
  walkway_candidate: { fill: '#eadcf5', stroke: '#7b5aa6', label: 'walkway candidate' },
  service_yard_candidate: { fill: '#e5c6ad', stroke: '#8b542c', label: 'service candidate' },
  vegetation_gap: { fill: '#c8e7c2', stroke: '#4e8c44', label: 'vegetation gap' },
  true_gap: { fill: '#f3f5f7', stroke: '#c9d0d8', label: 'true gap' },
  unknown_gap: { fill: '#f8fafc', stroke: '#b7c0ca', label: 'unknown gap' }
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputDir = resolveRepo(options.outputDir || 'projects/image-structured-modeler/examples/building-group/structured-plan');
  let observations = await annotateObservationSetWithBirdEyeLandCoverV1(await readJson(observationsPath));
  observations = await annotateObservationSetWithHighContrastEdgeV1(observations);
  observations = await annotateObservationSetWithOpenCvEdgeV1(observations, {
    output: path.join(outputDir, 'opencv-edge-v1-report.json'),
    outputDir
  });
  observations = annotateObservationSetWithVisionEvidenceSetV1(observations, { force: true });
  observations = await annotateObservationSetWithBoundaryGraphV1(observations);
  observations = annotateObservationSetWithVisionEvidenceSetV1(observations, { force: true });
  const report = validateAutoGroundPlanR10({ observations });
  const plan = report.auto_ground_plan;
  const birdEyeArtifact = await renderBirdEyeSegmentationArtifact({
    observations,
    landCover: observations.land_cover_v1,
    boundaryGraph: observations.boundary_graph_v1,
    autoGroundPlan: plan,
    outputDir,
    basename: 'bird-eye-segmentation'
  });
  const birdEyeReport = landCoverReport(observations.land_cover_v1);
  const boundaryReport = boundaryGraphReport(observations.boundary_graph_v1);
  const visionReport = visionEvidenceSetReport(observations.vision_evidence_set_v1);
  const visionReviewPatch = buildVisionEvidenceReviewPatch({
    visionEvidenceSet: observations.vision_evidence_set_v1,
    source: `${observationsPath}#vision_evidence_set_v1`
  });
  const structuredSvg = renderStructuredSvg(plan);
  const diagnosticSvg = renderDiagnosticSvg(plan);
  const html = renderHtml({
    report,
    structuredSvg,
    diagnosticSvg,
    birdEyeArtifact,
    birdEyeReport,
    boundaryReport,
    visionReport,
    visionReviewPatch,
    observationsPath,
    outputDir
  });

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'structured-plan-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'land-cover-v1-report.json'), `${JSON.stringify(birdEyeReport, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'boundary-graph-v1-report.json'), `${JSON.stringify(boundaryReport, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'vision-evidence-v1-report.json'), `${JSON.stringify(visionReport, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'vision-evidence-review-patch.json'), `${JSON.stringify(visionReviewPatch, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, 'vision-evidence-review-patch.md'), renderVisionEvidenceReviewPatchMarkdown(visionReviewPatch), 'utf8');
  await fs.writeFile(path.join(outputDir, 'structured-plan.svg'), structuredSvg, 'utf8');
  await fs.writeFile(path.join(outputDir, 'diagnostic-plan.svg'), diagnosticSvg, 'utf8');
  await fs.writeFile(path.join(outputDir, 'index.html'), html, 'utf8');
  await sharp(Buffer.from(structuredSvg)).png().toFile(path.join(outputDir, 'structured-plan.png'));

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    output_dir: path.relative(repoRoot, outputDir),
    html: path.relative(repoRoot, path.join(outputDir, 'index.html')),
    qa_report: path.relative(repoRoot, path.join(outputDir, 'structured-plan-qa-report.json')),
    road_building_overlap_ratio: report.summary.road_building_overlap_ratio,
    raw_contour_leakage: report.summary.raw_contour_leakage,
    parent_child_double_occupancy: report.summary.parent_child_double_occupancy,
    gap_ratio: report.summary.gap_ratio,
    gap_completion_ratio: report.summary.gap_completion_ratio,
    remaining_unknown_gap_ratio: report.summary.remaining_unknown_gap_ratio,
    vision_evidence_verdict: visionReport.verdict,
    vision_evidence_edges: visionReport.summary.edges,
    vision_evidence_review_items: visionReviewPatch.summary.total_items
  }, null, 2)}\n`);

  if (options.requireOk && !report.ok) process.exit(1);
}

function renderStructuredSvg(plan) {
  const site = plan.site_surface?.bbox_px || [0, 0, 1000, 700];
  const cells = plan.subdivision_cells || [];
  const regions = plan.canonical_regions || [];
  const width = 1280;
  const height = Math.round(width * site[3] / Math.max(1, site[2]));
  const regionLabels = regions
    .filter((region) => region.class !== 'gap')
    .map((region) => labelForRegion(region, site))
    .filter(Boolean)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${site.join(' ')}" role="img" aria-label="Auto GroundPlan R10 structured subdivision">
  <rect x="${site[0]}" y="${site[1]}" width="${site[2]}" height="${site[3]}" fill="#f7f9fb"/>
  ${cells.map((cell) => rectForCell(cell)).join('\n  ')}
  <rect x="${site[0]}" y="${site[1]}" width="${site[2]}" height="${site[3]}" fill="none" stroke="#111827" stroke-width="3"/>
  ${regionLabels}
</svg>
`;
}

function renderDiagnosticSvg(plan) {
  const site = plan.site_surface?.bbox_px || [0, 0, 1000, 700];
  const width = 1280;
  const height = Math.round(width * site[3] / Math.max(1, site[2]));
  const evidence = plan.evidence_candidates || [];
  const rejected = [...(plan.rejected_priors || []), ...(plan.rejected_evidence || [])];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${site.join(' ')}" role="img" aria-label="Auto GroundPlan R10 diagnostic evidence">
  <rect x="${site[0]}" y="${site[1]}" width="${site[2]}" height="${site[3]}" fill="#fbfcfd"/>
  ${evidence.map((candidate) => polygonForEvidence(candidate)).join('\n  ')}
  ${rejected.map((candidate) => rejectedRect(candidate)).join('\n  ')}
  <rect x="${site[0]}" y="${site[1]}" width="${site[2]}" height="${site[3]}" fill="none" stroke="#111827" stroke-width="3"/>
  ${evidence.map((candidate) => evidenceLabel(candidate)).join('\n  ')}
</svg>
`;
}

function renderHtml({ report, structuredSvg, diagnosticSvg, birdEyeArtifact, birdEyeReport, boundaryReport, visionReport, visionReviewPatch, observationsPath, outputDir }) {
  const plan = report.auto_ground_plan;
  const qa = plan.qa || {};
  const metrics = [
    ['Verdict', report.verdict],
    ['Road/building overlap', qa.road_building_overlap_ratio],
    ['Raw contour leakage', qa.raw_contour_leakage],
    ['Parent/child double occupancy', qa.parent_child_double_occupancy],
    ['Canonical overlap', qa.canonical_region_overlap_ratio],
    ['Gap ratio', qa.gap_ratio],
    ['Gap completion', qa.gap_completion_ratio],
    ['Remaining unknown gap', qa.remaining_unknown_gap_ratio],
    ['Open paved helper', qa.open_paved_area_ratio],
    ['Road candidates in review', qa.road_candidate_review_count],
    ['Rejected priors', qa.rejected_priors],
    ['Canonical regions', qa.checked_canonical_regions],
    ['Land-cover unknown', birdEyeReport.summary.unknown_land_cover_ratio],
    ['Land-cover paved', birdEyeReport.summary.paved_surface_ratio],
    ['Land-cover vegetation', birdEyeReport.summary.vegetation_ratio],
    ['Boundary closure', boundaryReport.summary.site_boundary_closure_ratio],
    ['Observed edge coverage', boundaryReport.summary.observed_edge_coverage_ratio],
    ['Boundary road corridors', boundaryReport.summary.road_corridor_count],
    ['Inferred geometry area', boundaryReport.summary.inferred_geometry_area_ratio],
    ['Vision evidence verdict', visionReport.verdict],
    ['Vision evidence masks', visionReport.summary.masks],
    ['Vision evidence edges', visionReport.summary.edges],
    ['Accepted evidence edges', visionReport.summary.accepted_edges],
    ['Planar ground-plane allowed', visionReport.summary.planar_groundplan_allowed],
    ['Ground-plane review images', visionReport.summary.ground_plane_review_images],
    ['Top-view usage policy', visionReport.summary.preferred_top_view_usage_policy],
    ['Vision review items', visionReviewPatch.summary.total_items],
    ['Heavy model required', visionReport.summary.default_heavy_model_required]
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Auto GroundPlan R10</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17202a;
      --muted: #607085;
      --line: #d7dee8;
      --panel: #ffffff;
      --soft: #f3f6f9;
      --accent: #0f766e;
      --bad: #b42318;
      --warn: #9a5a00;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: #edf1f5;
      line-height: 1.4;
    }
    header {
      padding: 18px 24px 14px;
      background: #fff;
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0 0 5px;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    main {
      max-width: 1480px;
      margin: 0 auto;
      padding: 18px 24px 32px;
    }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-bottom: 14px;
    }
    .metric, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
    }
    .metric {
      padding: 10px 12px;
      min-height: 76px;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
    .metric strong {
      display: block;
      margin-top: 6px;
      font-size: 20px;
      line-height: 1.1;
      overflow-wrap: anywhere;
    }
    .panel { padding: 14px; margin-bottom: 14px; }
    .tabs { display: flex; gap: 8px; margin-bottom: 12px; }
    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      padding: 8px 12px;
      font: inherit;
      cursor: pointer;
    }
    button[aria-selected="true"] {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .canvas {
      overflow: auto;
      background: #fff;
      border: 1px solid var(--line);
    }
    .canvas svg,
    .canvas img {
      display: block;
      width: 100%;
      height: auto;
      min-width: 900px;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .swatch {
      display: inline-block;
      width: 12px;
      height: 12px;
      margin-right: 5px;
      border: 1px solid #8a94a3;
      vertical-align: -1px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      background: #fff;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 650; }
    .bad { color: var(--bad); }
    .warn { color: var(--warn); }
    .hidden { display: none; }
    @media (max-width: 880px) {
      main, header { padding-left: 14px; padding-right: 14px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <h1>Auto GroundPlan R10</h1>
    <div class="muted"><code>${escapeHtml(path.relative(repoRoot, resolveRepo(observationsPath)))}</code></div>
    <div class="muted">R12 path: original image -> VisionEvidenceSet v1 -> BoundaryGraph/GroundPlan -> PartGraph/DSL/QA. Heavy vision backends are optional and not required.</div>
  </header>
  <main>
    <section class="grid" aria-label="QA metrics">
      ${metrics.map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatValue(value))}</strong></div>`).join('\n      ')}
    </section>
    <section class="panel">
      <div class="tabs" role="tablist" aria-label="Plan views">
        <button type="button" role="tab" aria-selected="true" data-view="bird-eye">Bird-eye QA</button>
        <button type="button" role="tab" aria-selected="false" data-view="structured">Structured</button>
        <button type="button" role="tab" aria-selected="false" data-view="diagnostic">Diagnostic</button>
      </div>
      <div id="bird-eye-view" class="canvas" role="tabpanel">
        <img src="${escapeHtml(path.basename(birdEyeArtifact.pngPath))}" alt="Bird-eye land-cover QA">
      </div>
      <div id="structured-view" class="canvas hidden" role="tabpanel">
        ${structuredSvg.replace(/<\?xml[^>]*>\n?/, '')}
      </div>
      <div id="diagnostic-view" class="canvas hidden" role="tabpanel">
        ${diagnosticSvg.replace(/<\?xml[^>]*>\n?/, '')}
      </div>
      <div class="legend">
        ${Object.entries(CLASS_STYLE).map(([key, style]) => `<span><span class="swatch" style="background:${style.fill};border-color:${style.stroke}"></span>${escapeHtml(key)}</span>`).join('')}
        <span><span class="swatch" style="background:#fff;border-color:#d22;border-style:dashed"></span>rejected prior/reference</span>
      </div>
    </section>
    <section class="panel">
      <table>
        <thead><tr><th>Severity</th><th>Rule</th><th>Message</th></tr></thead>
        <tbody>
          ${(report.issues || []).map((issue) => `<tr><td class="${issue.severity === 'error' ? 'bad' : 'warn'}">${escapeHtml(issue.severity)}</td><td><code>${escapeHtml(issue.rule_id)}</code></td><td>${escapeHtml(issue.message)}</td></tr>`).join('') || '<tr><td colspan="3">none</td></tr>'}
        </tbody>
      </table>
    </section>
    <section class="panel">
      <table>
        <thead><tr><th>Rejected</th><th>Class</th><th>Reason</th></tr></thead>
        <tbody>
          ${[...(plan.rejected_priors || []), ...(plan.rejected_evidence || [])].map((item) => `<tr><td><code>${escapeHtml(item.id)}</code></td><td>${escapeHtml(item.class)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join('') || '<tr><td colspan="3">none</td></tr>'}
        </tbody>
      </table>
    </section>
    <div class="muted">
      <code>${escapeHtml(path.relative(repoRoot, path.join(outputDir, 'vision-evidence-v1-report.json')))}</code>
      <code>${escapeHtml(path.relative(repoRoot, path.join(outputDir, 'structured-plan-qa-report.json')))}</code>
    </div>
  </main>
  <script>
    const buttons = Array.from(document.querySelectorAll('[role="tab"]'));
    const views = {
      'bird-eye': document.getElementById('bird-eye-view'),
      structured: document.getElementById('structured-view'),
      diagnostic: document.getElementById('diagnostic-view')
    };
    for (const button of buttons) {
      button.addEventListener('click', () => {
        for (const current of buttons) current.setAttribute('aria-selected', String(current === button));
        for (const [name, view] of Object.entries(views)) view.classList.toggle('hidden', name !== button.dataset.view);
      });
    }
  </script>
</body>
</html>
`;
}

function rectForCell(cell) {
  const displayClass = cell.class === 'gap' ? (cell.gap_class || 'unknown_gap') : cell.class;
  const style = CLASS_STYLE[displayClass] || CLASS_STYLE.gap;
  const strokeWidth = cell.class === 'gap' ? 0.75 : 1.2;
  const opacity = cell.class === 'gap' ? 0.82 : 0.9;
  const dash = ['road_candidate', 'walkway_candidate', 'service_yard_candidate'].includes(displayClass)
    ? ' stroke-dasharray="7 5"'
    : cell.inference_level === 'completed_occluded'
      ? ' stroke-dasharray="9 5"'
      : cell.inference_level === 'completed_gap'
        ? ' stroke-dasharray="7 5"'
        : cell.inference_level === 'extrapolated_off_frame'
          ? ' stroke-dasharray="2 5"'
          : cell.inference_level === 'weak_inferred'
            ? ' stroke-dasharray="5 6"'
    : '';
  return `<rect x="${cell.bbox_px[0]}" y="${cell.bbox_px[1]}" width="${cell.bbox_px[2]}" height="${cell.bbox_px[3]}" fill="${style.fill}" fill-opacity="${opacity}" stroke="${style.stroke}" stroke-width="${strokeWidth}"${dash}/>`;
}

function polygonForEvidence(candidate) {
  const style = CLASS_STYLE[candidate.class] || CLASS_STYLE.gap;
  const points = (candidate.polygon_px || candidate.canonical_polygon_px || []).map((point) => point.join(',')).join(' ');
  if (!points) return '';
  const dashed = candidate.source_kind === 'layout_prior' ? ' stroke-dasharray="8 5"' : '';
  return `<polygon points="${points}" fill="${style.fill}" fill-opacity="0.18" stroke="${style.stroke}" stroke-width="2"${dashed}/>`;
}

function rejectedRect(item) {
  const bbox = item.bbox_px;
  if (!bbox) return '';
  return `<rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" fill="none" stroke="#c82121" stroke-width="4" stroke-dasharray="10 7"/>`;
}

function labelForRegion(region, site) {
  const width = region.bbox_px[2];
  const height = region.bbox_px[3];
  if (width < Math.max(112, site[2] * 0.14) || height < Math.max(38, site[3] * 0.065)) return '';
  const x = region.bbox_px[0] + width / 2;
  const y = region.bbox_px[1] + height / 2;
  const text = region.id.replace(/^parking_/, '').replace(/_/g, ' ');
  return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Inter, Arial, sans-serif" font-size="13" fill="#17202a">${escapeHtml(text)}</text>`;
}

function evidenceLabel(candidate) {
  const x = candidate.bbox_px[0] + 4;
  const y = candidate.bbox_px[1] + 14;
  return `<text x="${x}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="12" fill="#17202a">${escapeHtml(candidate.id)}</text>`;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

function resolveRepo(relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.resolve(repoRoot || scriptRoot, relativePath);
}

function formatValue(value) {
  if (typeof value === 'number') return Number(value.toFixed(3)).toString();
  if (value === null || value === undefined) return 'n/a';
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--require-ok') options.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/make-structured-plan-r10.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output-dir projects/image-structured-modeler/examples/building-group/structured-plan
`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
