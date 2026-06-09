#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { repoRoot } from './lib/image-analysis.mjs';
import { validateAutoGroundPlanR10 } from './lib/auto-ground-plan-r10.mjs';
import { annotateObservationSetWithBirdEyeLandCoverV1 } from './lib/bird-eye-land-cover.mjs';
import { annotateObservationSetWithBoundaryGraphV1, boundaryGraphReport, buildBoundaryGraphV1 } from './lib/boundary-graph-v1.mjs';
import { annotateObservationSetWithHighContrastEdgeV1 } from './lib/high-contrast-edge-v1.mjs';
import { annotateObservationSetWithOpenCvEdgeV1 } from './lib/opencv-edge-v1.mjs';
import { buildSegmentationBackendCompare, segmentationBackendCompareReport } from './lib/segmentation-backend-compare.mjs';

const scriptRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json';
  const outputPath = options.output || 'projects/image-structured-modeler/examples/building-group/structured-plan/boundary-groundplan-ablation-report.json';
  const outputDir = resolveRepo(options.outputDir || path.dirname(outputPath));
  const baseObservations = await readJson(observationsPath);
  let observations = await annotateObservationSetWithBirdEyeLandCoverV1(baseObservations, { force: options.force });
  observations = await annotateObservationSetWithHighContrastEdgeV1(observations, { force: options.force });
  observations = await annotateObservationSetWithOpenCvEdgeV1(observations, {
    force: options.force,
    output: path.join(outputDir, 'opencv-edge-v1-report.json'),
    outputDir
  });
  const compare = await buildSegmentationBackendCompare({ observations });

  const baseline = await runVariant({
    id: 'source_edge_without_high_contrast',
    observations: {
      ...observations,
      high_contrast_edge_v1: undefined,
      boundary_graph_v1: undefined
    },
    useLandCover: true,
    useHighContrast: false,
    useOpenCv: false,
    useSourceImageBoundary: true
  });
  const highContrastOnly = await runVariant({
    id: 'high_contrast_edge_only',
    observations: {
      ...observations,
      land_cover_v1: undefined,
      boundary_graph_v1: undefined
    },
    useLandCover: false,
    useHighContrast: true,
    useOpenCv: false,
    useSourceImageBoundary: false
  });
  const openCvOnly = await runVariant({
    id: 'opencv_edge_only',
    observations: {
      ...observations,
      land_cover_v1: undefined,
      high_contrast_edge_v1: undefined,
      boundary_graph_v1: undefined
    },
    useLandCover: false,
    useHighContrast: false,
    useOpenCv: true,
    useSourceImageBoundary: false
  });
  const fused = await runVariant({
    id: 'fused_land_cover_opencv_high_contrast',
    observations: {
      ...observations,
      segmentation_backend_compare_v1: compare,
      observed_mask_candidates: compare.observed_mask_candidates,
      boundary_graph_v1: undefined
    },
    useLandCover: true,
    useHighContrast: true,
    useOpenCv: true,
    useSourceImageBoundary: true
  });
  const variants = [baseline, highContrastOnly, openCvOnly, fused];
  const report = {
    kind: 'boundary_groundplan_ablation_report',
    version: 1,
    ok: variants.every((variant) => variant.auto_ground_plan.ok),
    verdict: variants.every((variant) => variant.auto_ground_plan.ok) ? 'pass' : 'review',
    source_image: observations.land_cover_v1?.source_image || findTopImage(observations)?.image?.path || null,
    segmentation_backend_compare: segmentationBackendCompareReport(compare).summary,
    variants,
    summary: {
      site_boundary_delta: siteBoundaryDelta(baseline.site_surface_bbox_px, fused.site_surface_bbox_px),
      road_building_overlap: fused.auto_ground_plan.summary.road_building_overlap_ratio,
      remaining_unknown_gap: fused.auto_ground_plan.summary.remaining_unknown_gap_ratio,
      accepted_edge_source_breakdown: fused.accepted_edge_source_breakdown,
      fused_opencv_boundary_edges: fused.boundary_graph.summary.opencv_boundary_edge_count || 0,
      fused_high_contrast_boundary_edges: fused.boundary_graph.summary.high_contrast_boundary_edge_count || 0,
      fused_insid3_status: compare.insid3?.status || 'unknown'
    },
    issues: variants.flatMap((variant) => variant.auto_ground_plan.issues.map((issue) => ({
      ...issue,
      variant: variant.id
    })))
  };

  if (options.updateObservations) {
    const nextObservations = {
      ...observations,
      segmentation_backend_compare_v1: compare,
      observed_mask_candidates: compare.observed_mask_candidates,
      boundary_graph_v1: fused.boundary_graph.boundary_graph_v1,
      grounding_r11_2: {
        high_contrast_edge_v1: observations.high_contrast_edge_v1,
        opencv_edge_v1: observations.opencv_edge_v1,
        segmentation_backend_compare_v1: compare,
        boundary_groundplan_ablation: report
      }
    };
    await writeJson(resolveRepo(observationsPath), nextObservations);
  }
  if (outputPath) await writeJson(resolveRepo(outputPath), report);
  const artifact = await renderAblationArtifact({ report, observations, outputDir });

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    site_boundary_delta: report.summary.site_boundary_delta,
    remaining_unknown_gap: report.summary.remaining_unknown_gap,
    fused_high_contrast_boundary_edges: report.summary.fused_high_contrast_boundary_edges,
    output: outputPath,
    png: path.relative(repoRoot, artifact.pngPath)
  }, null, 2)}\n`);

  if (options.requireOk && !report.ok) process.exit(1);
}

async function runVariant({ id, observations, useLandCover, useHighContrast, useOpenCv, useSourceImageBoundary }) {
  const prepared = {
    ...observations,
    land_cover_v1: useLandCover ? observations.land_cover_v1 : undefined,
    high_contrast_edge_v1: useHighContrast ? observations.high_contrast_edge_v1 : undefined,
    opencv_edge_v1: useOpenCv ? observations.opencv_edge_v1 : undefined,
    boundary_graph_v1: undefined
  };
  const variantObservations = useSourceImageBoundary
    ? await annotateObservationSetWithBoundaryGraphV1(prepared, { force: true })
    : {
      ...prepared,
      boundary_graph_v1: buildBoundaryGraphV1({
        observations: prepared,
        landCover: useLandCover ? prepared.land_cover_v1 : null,
        options: {
          sourceImageBoundary: null,
          highContrastEdge: useHighContrast ? prepared.high_contrast_edge_v1 : null,
          openCvEdge: useOpenCv ? prepared.opencv_edge_v1 : null
        }
      })
    };
  const boundaryGraph = variantObservations.boundary_graph_v1;
  const autoGroundPlan = validateAutoGroundPlanR10({ observations: variantObservations });
  const boundaryReport = boundaryGraphReport(boundaryGraph);
  return {
    id,
    use_land_cover: useLandCover,
    use_high_contrast_edge: useHighContrast,
    use_opencv_edge: useOpenCv,
    use_source_image_boundary: useSourceImageBoundary,
    boundary_graph: boundaryReport,
    auto_ground_plan: autoGroundPlan,
    site_surface_bbox_px: autoGroundPlan.auto_ground_plan.site_surface?.bbox_px || null,
    accepted_edge_source_breakdown: countBy((boundaryGraph.observed_edges || []).filter((edge) => edge.state === 'observed'), 'method'),
    metrics: {
      site_boundary_delta_from_baseline: null,
      road_building_overlap: autoGroundPlan.summary.road_building_overlap_ratio,
      remaining_unknown_gap: autoGroundPlan.summary.remaining_unknown_gap_ratio,
      road_candidate_review_count: autoGroundPlan.summary.road_candidate_review_count,
      canonical_regions: autoGroundPlan.summary.canonical_regions,
      opencv_boundary_edge_count: boundaryReport.summary.opencv_boundary_edge_count || 0,
      high_contrast_boundary_edge_count: boundaryReport.summary.high_contrast_boundary_edge_count || 0
    }
  };
}

async function renderAblationArtifact({ report, observations, outputDir }) {
  const topImage = findTopImage(observations);
  const raster = await loadTopRaster(topImage).catch(() => null);
  const imageHref = raster ? await rasterDataUrl(raster) : null;
  const svg = renderAblationSvg({ report, imageHref });
  await fs.mkdir(outputDir, { recursive: true });
  const svgPath = path.join(outputDir, 'boundary-groundplan-ablation.svg');
  const pngPath = path.join(outputDir, 'boundary-groundplan-ablation.png');
  await fs.writeFile(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg), { density: 144 }).png().toFile(pngPath);
  return { svgPath, pngPath };
}

function renderAblationSvg({ report, imageHref }) {
  const site = report.variants.find((variant) => variant.site_surface_bbox_px)?.site_surface_bbox_px || [0, 0, 900, 675];
  const panelW = Math.max(1, Math.round(site[2]));
  const panelH = Math.max(1, Math.round(site[3]));
  const gap = 18;
  const titleH = 32;
  const width = panelW * report.variants.length + gap * Math.max(0, report.variants.length - 1);
  const height = panelH + titleH + 116;
  const panels = report.variants.map((variant, index) => ({
    variant,
    x: index * (panelW + gap),
    y: 0,
    contentY: titleH
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f3f4f6"/>
  ${panels.map((panel) => panelSvg(panel, panelW, panelH, imageHref)).join('\n')}
  <rect x="0" y="${height - 92}" width="${width}" height="92" fill="#fff" stroke="#d1d5db"/>
  <text x="18" y="${height - 58}" font-size="15" font-weight="700" fill="#111827" font-family="Inter, Arial, sans-serif">site delta ${report.summary.site_boundary_delta} | fused unknown gap ${report.summary.remaining_unknown_gap} | OpenCV edges ${report.summary.fused_opencv_boundary_edges} | JS fallback edges ${report.summary.fused_high_contrast_boundary_edges}</text>
  <text x="18" y="${height - 31}" font-size="14" fill="#475569" font-family="Inter, Arial, sans-serif">Ablation checks whether GroundPlan changes come from source edges, high-contrast edges, or fused observed masks.</text>
</svg>`;
}

function panelSvg(panel, width, height, imageHref) {
  const variant = panel.variant;
  const cells = variant.auto_ground_plan.auto_ground_plan.subdivision_cells || [];
  const edges = variant.boundary_graph.boundary_graph_v1.observed_edges || [];
  return `${panelTitle(panel, width, variant.id)}
  ${imageHref ? `<image href="${imageHref}" x="${panel.x}" y="${panel.contentY}" width="${width}" height="${height}" preserveAspectRatio="none" opacity="0.52"/>` : `<rect x="${panel.x}" y="${panel.contentY}" width="${width}" height="${height}" fill="#e2e8f0"/>`}
  ${cells.slice(0, 240).map((cell) => cellSvg(cell, panel)).join('\n')}
  ${edges.filter((edge) => ['site_boundary_edge', 'road_boundary_edge', 'paved_green_edge', 'building_exclusion_edge'].includes(edge.type)).slice(0, 90).map((edge) => edgeSvg(edge, panel)).join('\n')}
  <rect x="${panel.x}" y="${panel.contentY}" width="${width}" height="${height}" fill="none" stroke="#111827" stroke-width="2"/>
  <text x="${panel.x + 12}" y="${panel.contentY + height - 12}" font-size="13" font-weight="700" fill="#111827" font-family="Inter, Arial, sans-serif">unknown ${variant.metrics.remaining_unknown_gap} | road/building ${variant.metrics.road_building_overlap} | OpenCV ${variant.metrics.opencv_boundary_edge_count} | JS ${variant.metrics.high_contrast_boundary_edge_count}</text>`;
}

function panelTitle(panel, width, text) {
  return `<rect x="${panel.x}" y="${panel.y}" width="${width}" height="32" fill="#111827"/><text x="${panel.x + 12}" y="${panel.y + 22}" fill="#fff" font-size="14" font-weight="700" font-family="Inter, Arial, sans-serif">${escapeXml(text)}</text>`;
}

function cellSvg(cell, panel) {
  const color = {
    building_footprint: '#2f80d0',
    road: '#8b949e',
    parking: '#f0bf2b',
    green: '#4ade80',
    walkway: '#d1d5db',
    service_yard: '#b98755',
    gap: '#f8fafc'
  }[cell.class] || '#f8fafc';
  const [x, y, w, h] = cell.bbox_px || [0, 0, 0, 0];
  return `<rect x="${panel.x + x}" y="${panel.contentY + y}" width="${w}" height="${h}" fill="${color}" opacity="${cell.class === 'gap' ? 0.18 : 0.34}" stroke="${color}" stroke-width="0.5"/>`;
}

function edgeSvg(edge, panel) {
  const color = {
    site_boundary_edge: '#ef4444',
    road_boundary_edge: '#f59e0b',
    paved_green_edge: '#16a34a',
    building_exclusion_edge: '#1677ff'
  }[edge.type] || '#64748b';
  const dash = edge.method === 'opencv_edge_v1_segment' || edge.method === 'high_contrast_edge_v1_segment' ? '' : ' stroke-dasharray="7 5"';
  return `<line x1="${panel.x + edge.a[0]}" y1="${panel.contentY + edge.a[1]}" x2="${panel.x + edge.b[0]}" y2="${panel.contentY + edge.b[1]}" stroke="${color}" stroke-width="3" opacity="0.88" stroke-linecap="round"${dash}/>`;
}

function siteBoundaryDelta(a, b) {
  if (!a || !b) return null;
  return round(Math.hypot(a[0] - b[0], a[1] - b[1]) + Math.hypot((a[0] + a[2]) - (b[0] + b[2]), (a[1] + a[3]) - (b[1] + b[3])));
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot || scriptRoot, value);
}

async function loadTopRaster(topImage) {
  if (!topImage?.image?.path || /^synthetic:\/\//.test(topImage.image.path)) return null;
  const imagePath = path.resolve(repoRoot, topImage.image.path);
  const width = topImage.image.analysis_width || topImage.image.width || 900;
  const height = topImage.image.analysis_height || Math.round(width * (topImage.image.height || 1) / Math.max(1, topImage.image.width || 1));
  const { data, info } = await sharp(imagePath)
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, channels: info.channels };
}

async function rasterDataUrl(raster) {
  const buffer = await sharp(raster.buffer, {
    raw: { width: raster.width, height: raster.height, channels: raster.channels }
  }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function findTopImage(observations) {
  return observations.images?.find((image) => image.detected_view?.kind === 'top')
    || observations.images?.find((image) => image.view === 'top')
    || observations.images?.[0]
    || null;
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') parsed.observations = argv[++index];
    else if (arg === '--output') parsed.output = argv[++index];
    else if (arg === '--output-dir') parsed.outputDir = argv[++index];
    else if (arg === '--update-observations') parsed.updateObservations = true;
    else if (arg === '--force') parsed.force = true;
    else if (arg === '--require-ok') parsed.requireOk = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-boundary-groundplan-ablation.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --output projects/image-structured-modeler/examples/building-group/structured-plan/boundary-groundplan-ablation-report.json \\
    --output-dir projects/image-structured-modeler/examples/building-group/structured-plan \\
    --update-observations
`);
  process.exit(0);
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

await main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
