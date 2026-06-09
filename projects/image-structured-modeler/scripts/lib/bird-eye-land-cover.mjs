import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { repoRoot } from './image-analysis.mjs';

export const BIRD_EYE_LAND_COVER_CLASSES = [
  'building_footprint',
  'paved_surface',
  'road_surface_candidate',
  'parking_surface_candidate',
  'parking_marking',
  'road_marking',
  'vegetation_tree',
  'vegetation_low',
  'bare_soil',
  'shadow_or_dark_unknown',
  'unknown'
];

export const BIRD_EYE_LAND_COVER_COLORS = {
  building_footprint: '#2f80d0',
  paved_surface: '#c9d0d8',
  road_surface_candidate: '#8b949e',
  parking_surface_candidate: '#f0bf2b',
  parking_marking: '#fff7b0',
  road_marking: '#ffffff',
  vegetation_tree: '#278a3c',
  vegetation_low: '#8dcf75',
  bare_soil: '#b98755',
  shadow_or_dark_unknown: '#48515c',
  unknown: '#eef1f4'
};

const BUILDING_HINTS = new Set([
  'primary_blue_roof_hall',
  'warehouse_west_north',
  'warehouse_west_south',
  'warehouse_inner_north',
  'warehouse_inner_south',
  'utility_building',
  'admin_office'
]);

const SERVICE_EXCLUSION_HINTS = new Set(['tank_farm']);
const PARKING_HINTS = new Set(['parking_lot', 'parking_stall_row_north', 'parking_stall_row_south']);
const ROAD_HINTS = new Set(['parking_drive_aisle_center', 'internal_roads']);
const TILE_SIZE = 12;

export async function annotateObservationSetWithBirdEyeLandCoverV1(observations = {}, options = {}) {
  if (observations.object?.profile !== 'building_group' && observations.object?.type !== 'building_group') return observations;
  if (observations.land_cover_v1 && !options.force) return observations;
  const landCover = await buildBirdEyeLandCoverV1({ observations, options });
  return {
    ...observations,
    land_cover_v1: landCover
  };
}

export async function buildBirdEyeLandCoverV1({ observations = {}, options = {} } = {}) {
  const topImage = findTopImage(observations);
  const siteObservation = findObservation(topImage, 'site_boundary') || findObservation(topImage, 'building_top_site_boundary');
  const siteBbox = normalizeBbox(siteObservation?.bbox || topImage?.metrics?.object_bbox || [0, 0, topImage?.image?.analysis_width || 1, topImage?.image?.analysis_height || 1]);
  if (!topImage) return missingLandCover();

  const raster = await loadTopRaster(topImage).catch(() => null);
  const buildingExclusions = buildingExclusionBoxes(topImage);
  const semanticGuides = semanticGuideBoxes(topImage);
  const tiles = raster
    ? classifyRasterTiles({ raster, siteBbox, buildingExclusions, semanticGuides })
    : classifySyntheticTiles({ topImage, siteBbox, buildingExclusions, semanticGuides });
  const masks = masksFromTiles({ tiles, siteBbox });
  const boundaryEvidence = boundaryEvidenceFromTiles(tiles);
  const lineEvidence = lineEvidenceFromObservations(topImage, boundaryEvidence);
  const qa = landCoverQa({ tiles, masks, siteBbox, boundaryEvidence, lineEvidence });

  return {
    kind: 'bird_eye_land_cover_v1',
    version: 1,
    backend: raster ? 'classical_cv_v1' : 'observation_fixture_v1',
    coordinate_convention: 'image_x_right_y_down',
    source_image: topImage.image?.path || null,
    analysis_size: {
      width: topImage.image?.analysis_width || raster?.width || topImage.image?.width || 0,
      height: topImage.image?.analysis_height || raster?.height || topImage.image?.height || 0
    },
    site_bbox_px: siteBbox,
    classes: BIRD_EYE_LAND_COVER_CLASSES,
    masks,
    tiles,
    boundary_evidence: boundaryEvidence,
    line_evidence: lineEvidence,
    qa,
    correction_targets: correctionTargetsFromQa(qa),
    notes: [
      'BirdEyeLandCover v1 classifies ground-surface evidence before AutoGroundPlan subdivision.',
      'Building roof pixels are exclusion evidence; paved/vegetation classes are used to classify residual ground gaps conservatively.'
    ]
  };
}

export function makeBirdEyeLandCoverV1FromObservationFixture(observations = {}) {
  const topImage = findTopImage(observations);
  if (!topImage) return missingLandCover();
  const siteObservation = findObservation(topImage, 'site_boundary') || findObservation(topImage, 'building_top_site_boundary');
  const siteBbox = normalizeBbox(siteObservation?.bbox || topImage?.metrics?.object_bbox || [0, 0, topImage?.image?.analysis_width || 1, topImage?.image?.analysis_height || 1]);
  const buildingExclusions = buildingExclusionBoxes(topImage);
  const semanticGuides = semanticGuideBoxes(topImage);
  const tiles = classifySyntheticTiles({ topImage, siteBbox, buildingExclusions, semanticGuides });
  const masks = masksFromTiles({ tiles, siteBbox });
  const boundaryEvidence = boundaryEvidenceFromTiles(tiles);
  const lineEvidence = lineEvidenceFromObservations(topImage, boundaryEvidence);
  const qa = landCoverQa({ tiles, masks, siteBbox, boundaryEvidence, lineEvidence });
  return {
    kind: 'bird_eye_land_cover_v1',
    version: 1,
    backend: 'observation_fixture_v1',
    coordinate_convention: 'image_x_right_y_down',
    source_image: topImage.image?.path || null,
    analysis_size: {
      width: topImage.image?.analysis_width || topImage.image?.width || 0,
      height: topImage.image?.analysis_height || topImage.image?.height || 0
    },
    site_bbox_px: siteBbox,
    classes: BIRD_EYE_LAND_COVER_CLASSES,
    masks,
    tiles,
    boundary_evidence: boundaryEvidence,
    line_evidence: lineEvidence,
    qa,
    correction_targets: correctionTargetsFromQa(qa),
    notes: [
      'Observation fixture land-cover is generated from existing image-space evidence and is not real pixel segmentation proof.'
    ]
  };
}

export function landCoverReport(landCover = {}) {
  return {
    kind: 'bird_eye_land_cover_v1_report',
    version: 1,
    ok: landCover.qa?.ok === true,
    verdict: landCover.qa?.verdict || 'fail',
    land_cover_v1: landCover,
    summary: {
      backend: landCover.backend || null,
      source_image: landCover.source_image || null,
      masks: landCover.masks?.length || 0,
      tiles: landCover.tiles?.length || 0,
      site_coverage_ratio: landCover.qa?.site_coverage_ratio ?? 0,
      building_exclusion_ratio: landCover.qa?.building_exclusion_ratio ?? 0,
      paved_surface_ratio: landCover.qa?.paved_surface_ratio ?? 0,
      vegetation_ratio: landCover.qa?.vegetation_ratio ?? 0,
      unknown_land_cover_ratio: landCover.qa?.unknown_land_cover_ratio ?? 1,
      boundary_confidence: landCover.qa?.boundary_confidence ?? 0,
      road_marking_line_count: landCover.qa?.road_marking_line_count ?? 0,
      parking_marking_line_count: landCover.qa?.parking_marking_line_count ?? 0
    },
    issues: landCover.qa?.issues || [],
    correction_targets: landCover.correction_targets || []
  };
}

export async function renderBirdEyeSegmentationArtifact({
  observations = {},
  landCover = null,
  boundaryGraph = null,
  autoGroundPlan = null,
  outputDir,
  basename = 'bird-eye-segmentation'
} = {}) {
  const resolvedLandCover = landCover || observations.land_cover_v1 || await buildBirdEyeLandCoverV1({ observations });
  const resolvedBoundaryGraph = boundaryGraph || observations.boundary_graph_v1 || null;
  const topImage = findTopImage(observations);
  const raster = await loadTopRaster(topImage).catch(() => null);
  const imageHref = raster
    ? `data:image/png;base64,${(await sharp(raster.buffer, {
      raw: { width: raster.width, height: raster.height, channels: 4 }
    }).png().toBuffer()).toString('base64')}`
    : null;
  const svg = renderBirdEyeSegmentationSvg({
    landCover: resolvedLandCover,
    boundaryGraph: resolvedBoundaryGraph,
    autoGroundPlan,
    imageHref
  });
  await fs.mkdir(outputDir, { recursive: true });
  const svgPath = path.join(outputDir, `${basename}.svg`);
  const pngPath = path.join(outputDir, `${basename}.png`);
  await fs.writeFile(svgPath, svg, 'utf8');
  await sharp(Buffer.from(svg), { density: 144 }).png().toFile(pngPath);
  return { svgPath, pngPath, svg };
}

export function renderBirdEyeSegmentationSvg({ landCover = {}, boundaryGraph = null, autoGroundPlan = null, imageHref = null } = {}) {
  const site = landCover.site_bbox_px || autoGroundPlan?.site_surface?.bbox_px || [0, 0, 900, 675];
  const panelWidth = Math.max(1, Math.round(site[2]));
  const panelHeight = Math.max(1, Math.round(site[3]));
  const gap = 22;
  const titleHeight = 34;
  const legendHeight = 122;
  const width = panelWidth * 2 + gap;
  const height = panelHeight * 2 + gap + titleHeight * 2 + legendHeight;
  const panel = (col, row) => {
    const x = col * (panelWidth + gap);
    const y = row * (panelHeight + titleHeight + gap);
    return { x, y, contentY: y + titleHeight };
  };
  const panels = [
    panel(0, 0),
    panel(1, 0),
    panel(0, 1),
    panel(1, 1)
  ];
  const finalCells = autoGroundPlan?.subdivision_cells || [];
  const title = (p, text) => `<rect x="${p.x}" y="${p.y}" width="${panelWidth}" height="${titleHeight}" fill="#101820"/><text x="${p.x + 12}" y="${p.y + 23}" fill="#fff" font-size="16" font-weight="700" font-family="Inter, Arial, sans-serif">${escapeXml(text)}</text>`;
  const siteRect = (p, stroke = '#111827') => `<rect x="${p.x}" y="${p.contentY}" width="${panelWidth}" height="${panelHeight}" fill="none" stroke="${stroke}" stroke-width="2" stroke-dasharray="7 5"/>`;
  const legendY = panelHeight * 2 + titleHeight * 2 + gap + 18;
  const summary = landCover.qa || {};
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f4f6f8"/>
  ${title(panels[0], 'Original top view')}
  ${imageHref ? `<image href="${imageHref}" x="${panels[0].x}" y="${panels[0].contentY}" width="${panelWidth}" height="${panelHeight}" preserveAspectRatio="none"/>` : `<rect x="${panels[0].x}" y="${panels[0].contentY}" width="${panelWidth}" height="${panelHeight}" fill="#d8dee6"/>`}
  ${siteRect(panels[0], '#ffffff')}
  ${title(panels[1], 'Raw land-cover mask')}
  <rect x="${panels[1].x}" y="${panels[1].contentY}" width="${panelWidth}" height="${panelHeight}" fill="#fff"/>
  ${tilesSvg(landCover.tiles || [], panels[1])}
  ${siteRect(panels[1])}
  ${title(panels[2], boundaryGraph?.backend === 'source_image_edge_detector_v1' ? 'Source edge overlay' : 'Boundary graph evidence')}
  ${imageHref && boundaryGraph?.backend === 'source_image_edge_detector_v1'
    ? `<image href="${imageHref}" x="${panels[2].x}" y="${panels[2].contentY}" width="${panelWidth}" height="${panelHeight}" preserveAspectRatio="none" opacity="0.82"/>`
    : `<rect x="${panels[2].x}" y="${panels[2].contentY}" width="${panelWidth}" height="${panelHeight}" fill="#fff"/>`}
  ${boundaryGraph?.backend === 'source_image_edge_detector_v1' ? '' : tilesSvg((landCover.tiles || []).filter((tile) => ['paved_surface', 'road_surface_candidate', 'parking_surface_candidate', 'vegetation_tree', 'vegetation_low'].includes(tile.class)), panels[2], 0.35)}
  ${boundaryGraph ? boundaryGraphSvg(boundaryGraph, panels[2]) : lineEvidenceSvg(landCover, panels[2])}
  ${siteRect(panels[2])}
  ${title(panels[3], 'Final planar subdivision')}
  <rect x="${panels[3].x}" y="${panels[3].contentY}" width="${panelWidth}" height="${panelHeight}" fill="#fff"/>
  ${finalCells.length ? finalSubdivisionSvg(finalCells, panels[3]) : tilesSvg(landCover.tiles || [], panels[3])}
  ${siteRect(panels[3])}
  <rect x="0" y="${height - legendHeight}" width="${width}" height="${legendHeight}" fill="#fff" stroke="#d5dce4"/>
  ${legendSvg(legendY)}
  <text x="22" y="${height - 20}" font-size="15" font-weight="700" fill="#101820" font-family="Inter, Arial, sans-serif">land-cover unknown ${pct(summary.unknown_land_cover_ratio)} | paved ${pct(summary.paved_surface_ratio)} | vegetation ${pct(summary.vegetation_ratio)} | boundary confidence ${Number(summary.boundary_confidence ?? 0).toFixed(2)}</text>
  ${boundaryGraph ? `<text x="${Math.max(22, width - 760)}" y="${height - 20}" font-size="15" font-weight="700" fill="#101820" font-family="Inter, Arial, sans-serif">source align ${pct(boundaryGraph.qa?.source_edge_alignment_ratio)} | bbox fallback ${pct(boundaryGraph.qa?.bbox_fallback_edge_ratio)} | closure ${pct(boundaryGraph.qa?.site_boundary_closure_ratio)} | corridors ${boundaryGraph.qa?.road_corridor_count || 0}</text>` : ''}
</svg>
`;
}

export function makeSyntheticBirdEyeLandCoverFixture(kind = 'industrial_campus') {
  const site = [80, 70, 760, 560];
  const layouts = {
    industrial_campus: [
      mask('synthetic_building_a', 'building_footprint', [150, 140, 140, 310]),
      mask('synthetic_building_b', 'building_footprint', [330, 140, 120, 310]),
      mask('synthetic_building_c', 'building_footprint', [510, 160, 220, 210]),
      mask('synthetic_parking', 'parking_surface_candidate', [505, 440, 270, 100]),
      mask('synthetic_loop_road', 'road_surface_candidate', [105, 100, 690, 470]),
      mask('synthetic_green_south', 'vegetation_tree', [120, 555, 650, 45])
    ],
    commercial_parking: [
      mask('synthetic_store', 'building_footprint', [120, 105, 240, 150]),
      mask('synthetic_parking_big', 'parking_surface_candidate', [395, 120, 380, 340]),
      mask('synthetic_drive', 'road_surface_candidate', [115, 300, 680, 95]),
      mask('synthetic_green_edges', 'vegetation_low', [80, 520, 760, 70])
    ],
    courtyard_campus: [
      mask('synthetic_north_building', 'building_footprint', [210, 105, 420, 90]),
      mask('synthetic_west_building', 'building_footprint', [165, 210, 90, 265]),
      mask('synthetic_east_building', 'building_footprint', [595, 210, 90, 265]),
      mask('synthetic_courtyard_green', 'vegetation_low', [300, 245, 250, 185]),
      mask('synthetic_walk_loop', 'paved_surface', [260, 205, 335, 270])
    ]
  };
  const masks = layouts[kind] || layouts.industrial_campus;
  const tiles = tilesFromMasks({ masks, siteBbox: site });
  const boundaryEvidence = boundaryEvidenceFromTiles(tiles);
  const lineEvidence = {
    road_marking_segments: kind === 'courtyard_campus' ? [] : [segment('synthetic_road_line_1', [120, 342], [780, 342])],
    parking_marking_segments: kind === 'industrial_campus' || kind === 'commercial_parking'
      ? [segment('synthetic_parking_marking_1', [520, 475], [760, 475]), segment('synthetic_parking_marking_2', [520, 505], [760, 505])]
      : []
  };
  const qa = landCoverQa({ tiles, masks, siteBbox: site, boundaryEvidence, lineEvidence });
  const landCover = {
    kind: 'bird_eye_land_cover_v1',
    version: 1,
    backend: 'programmatic_fixture_v1',
    coordinate_convention: 'image_x_right_y_down',
    source_image: `synthetic://${kind}`,
    analysis_size: { width: 920, height: 700 },
    site_bbox_px: site,
    classes: BIRD_EYE_LAND_COVER_CLASSES,
    masks,
    tiles,
    boundary_evidence: boundaryEvidence,
    line_evidence: lineEvidence,
    qa,
    correction_targets: correctionTargetsFromQa(qa)
  };
  return {
    kind,
    ground_truth: { site_bbox_px: site, masks },
    land_cover_v1: landCover
  };
}

async function loadTopRaster(topImage) {
  if (!topImage?.image?.path) throw new Error('missing top image path');
  const imagePath = path.resolve(repoRoot, topImage.image.path);
  const width = topImage.image.analysis_width || 900;
  const height = topImage.image.analysis_height || Math.round(width * (topImage.image.height || 1) / Math.max(1, topImage.image.width || 1));
  const { data, info } = await sharp(imagePath)
    .rotate()
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, channels: info.channels };
}

function classifyRasterTiles({ raster, siteBbox, buildingExclusions, semanticGuides }) {
  const tiles = [];
  let index = 0;
  for (let y = siteBbox[1]; y < siteBbox[1] + siteBbox[3]; y += TILE_SIZE) {
    for (let x = siteBbox[0]; x < siteBbox[0] + siteBbox[2]; x += TILE_SIZE) {
      const bbox = normalizeBbox([
        x,
        y,
        Math.min(TILE_SIZE, siteBbox[0] + siteBbox[2] - x),
        Math.min(TILE_SIZE, siteBbox[1] + siteBbox[3] - y)
      ]);
      const stats = tilePixelStats({ raster, bbox, buildingExclusions, semanticGuides });
      const cls = dominantClass(stats);
      tiles.push(tile(`land_cover_tile_${index++}`, cls, bbox, stats));
    }
  }
  return tiles;
}

function classifySyntheticTiles({ topImage, siteBbox, buildingExclusions, semanticGuides }) {
  const masks = [
    ...buildingExclusions.map((bbox, index) => mask(`synthetic_building_exclusion_${index + 1}`, 'building_footprint', bbox)),
    ...semanticGuides.parking.map((bbox, index) => mask(`synthetic_parking_surface_${index + 1}`, 'parking_surface_candidate', bbox)),
    ...semanticGuides.road.map((bbox, index) => mask(`synthetic_road_surface_${index + 1}`, 'road_surface_candidate', bbox)),
    ...semanticGuides.vegetation.map((bbox, index) => mask(`synthetic_vegetation_${index + 1}`, 'vegetation_tree', bbox))
  ];
  return tilesFromMasks({ masks, siteBbox });
}

function tilePixelStats({ raster, bbox, buildingExclusions, semanticGuides }) {
  const counts = Object.fromEntries(BIRD_EYE_LAND_COVER_CLASSES.map((cls) => [cls, 0]));
  const x0 = Math.max(0, Math.floor(bbox[0]));
  const y0 = Math.max(0, Math.floor(bbox[1]));
  const x1 = Math.min(raster.width, Math.ceil(bbox[0] + bbox[2]));
  const y1 = Math.min(raster.height, Math.ceil(bbox[1] + bbox[3]));
  let total = 0;
  let edgeVotes = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      total += 1;
      const cls = pixelClass(raster, x, y, buildingExclusions, semanticGuides);
      counts[cls] = (counts[cls] || 0) + 1;
      if (isEdgeLike(raster, x, y)) edgeVotes += 1;
    }
  }
  return {
    total,
    counts,
    edge_density: round(edgeVotes / Math.max(1, total))
  };
}

function pixelClass(raster, x, y, buildingExclusions, semanticGuides) {
  const point = [x, y];
  if (buildingExclusions.some((bbox) => pointInBbox(point, bbox))) return 'building_footprint';
  const index = (y * raster.width + x) * raster.channels;
  const r = raster.buffer[index];
  const g = raster.buffer[index + 1];
  const b = raster.buffer[index + 2];
  const { h, s, v } = rgbToHsv(r, g, b);
  const exg = 2 * g - r - b;
  if ((h >= 58 && h <= 172 && s >= 0.18 && exg > 12 && g > 48) || (g > r * 1.12 && g > b * 1.05 && exg > 18)) {
    return v > 0.42 && s > 0.28 ? 'vegetation_tree' : 'vegetation_low';
  }
  if (isBrightThinMarking(r, g, b, s, v) && semanticGuides.parking.some((bbox) => pointInBbox(point, expandBbox(bbox, 18)))) return 'parking_marking';
  if (isBrightThinMarking(r, g, b, s, v) && semanticGuides.road.some((bbox) => pointInBbox(point, expandBbox(bbox, 18)))) return 'road_marking';
  if (semanticGuides.parking.some((bbox) => pointInBbox(point, bbox)) && isHardscape(r, g, b, s, v)) return 'parking_surface_candidate';
  if (semanticGuides.road.some((bbox) => pointInBbox(point, bbox)) && isHardscape(r, g, b, s, v)) return 'road_surface_candidate';
  if (isHardscape(r, g, b, s, v)) return 'paved_surface';
  if (isBareSoil(r, g, b, s, v)) return 'bare_soil';
  if (v < 0.22) return 'shadow_or_dark_unknown';
  return 'unknown';
}

function isHardscape(r, g, b, s, v) {
  const channelSpread = Math.max(r, g, b) - Math.min(r, g, b);
  return v >= 0.23 && v <= 0.86 && s <= 0.36 && channelSpread <= 78;
}

function isBrightThinMarking(r, g, b, s, v) {
  return v >= 0.68 && s <= 0.24 && Math.min(r, g, b) >= 145;
}

function isBareSoil(r, g, b, s, v) {
  return r > g * 1.04 && g > b * 1.08 && s > 0.18 && v > 0.28 && v < 0.82;
}

function isEdgeLike(raster, x, y) {
  if (x <= 0 || y <= 0 || x >= raster.width - 1 || y >= raster.height - 1) return false;
  const c = grayAt(raster, x, y);
  const dx = Math.abs(grayAt(raster, x + 1, y) - grayAt(raster, x - 1, y));
  const dy = Math.abs(grayAt(raster, x, y + 1) - grayAt(raster, x, y - 1));
  return Math.max(dx, dy, Math.abs(c - grayAt(raster, x + 1, y + 1))) > 30;
}

function grayAt(raster, x, y) {
  const index = (y * raster.width + x) * raster.channels;
  return 0.299 * raster.buffer[index] + 0.587 * raster.buffer[index + 1] + 0.114 * raster.buffer[index + 2];
}

function dominantClass(stats) {
  const counts = stats.counts || {};
  const total = Math.max(1, stats.total || 0);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [cls, count] = entries[0] || ['unknown', 0];
  const coverage = count / total;
  if (coverage < 0.34) return 'unknown';
  if (cls === 'parking_marking') return counts.parking_surface_candidate > total * 0.18 ? 'parking_surface_candidate' : 'parking_marking';
  if (cls === 'road_marking') return counts.road_surface_candidate > total * 0.18 ? 'road_surface_candidate' : 'road_marking';
  return cls;
}

function tile(id, cls, bbox, stats = {}) {
  const total = Math.max(1, stats.total || bboxArea(bbox));
  const dominant = stats.counts?.[cls] || total;
  return {
    id,
    class: cls,
    bbox_px: normalizeBbox(bbox),
    polygon_px: bboxPolygon(bbox),
    area_px: round(bboxArea(bbox)),
    source_pixels: Math.round(dominant),
    coverage: round(dominant / total),
    edge_density: round(stats.edge_density || 0),
    method: 'classical_cv_tile_vote',
    confidence: confidenceForClass(cls, dominant / total, stats.edge_density || 0),
    review_required: ['shadow_or_dark_unknown', 'unknown'].includes(cls)
  };
}

function masksFromTiles({ tiles, siteBbox }) {
  const byClass = new Map();
  for (const current of tiles) {
    if (current.class === 'unknown') continue;
    const list = byClass.get(current.class) || [];
    list.push(current);
    byClass.set(current.class, list);
  }
  const masks = [];
  for (const cls of BIRD_EYE_LAND_COVER_CLASSES) {
    const classTiles = byClass.get(cls) || [];
    if (!classTiles.length) continue;
    const components = connectedTileComponents(classTiles);
    components
      .filter((component) => component.reduce((sum, item) => sum + item.area_px, 0) >= 36)
      .forEach((component, index) => {
        const bbox = bboxUnion(component.map((item) => item.bbox_px));
        const area = component.reduce((sum, item) => sum + item.area_px, 0);
        masks.push({
          id: `land_cover_${cls}_${index + 1}`,
          class: cls,
          bbox_px: normalizeBbox(bbox),
          polygon_px: bboxPolygon(bbox),
          area_px: round(area),
          area_ratio: round(area / Math.max(1, bboxArea(siteBbox))),
          method: 'classical_cv_connected_tiles',
          confidence: round(average(component.map((item) => item.confidence))),
          source_pixels: Math.round(component.reduce((sum, item) => sum + (item.source_pixels || 0), 0)),
          tile_ids: component.map((item) => item.id),
          review_required: component.some((item) => item.review_required)
        });
      });
  }
  return masks.sort((a, b) => classOrder(a.class) - classOrder(b.class) || b.area_px - a.area_px);
}

function tilesFromMasks({ masks, siteBbox }) {
  const tiles = [];
  let index = 0;
  for (let y = siteBbox[1]; y < siteBbox[1] + siteBbox[3]; y += TILE_SIZE) {
    for (let x = siteBbox[0]; x < siteBbox[0] + siteBbox[2]; x += TILE_SIZE) {
      const bbox = normalizeBbox([
        x,
        y,
        Math.min(TILE_SIZE, siteBbox[0] + siteBbox[2] - x),
        Math.min(TILE_SIZE, siteBbox[1] + siteBbox[3] - y)
      ]);
      const winner = masks
        .map((item) => ({ item, overlap: intersectionArea(bbox, item.bbox_px) }))
        .filter((item) => item.overlap > 0)
        .sort((a, b) => classOrder(a.item.class) - classOrder(b.item.class) || b.overlap - a.overlap)[0]?.item;
      tiles.push(tile(`land_cover_tile_${index++}`, winner?.class || 'unknown', bbox, {
        total: bboxArea(bbox),
        counts: { [winner?.class || 'unknown']: bboxArea(bbox) },
        edge_density: 0.04
      }));
    }
  }
  return tiles;
}

function connectedTileComponents(tiles) {
  const remaining = new Set(tiles.map((item) => item.id));
  const byId = new Map(tiles.map((item) => [item.id, item]));
  const components = [];
  while (remaining.size) {
    const start = remaining.values().next().value;
    const stack = [start];
    const component = [];
    remaining.delete(start);
    while (stack.length) {
      const current = byId.get(stack.pop());
      if (!current) continue;
      component.push(current);
      for (const other of tiles) {
        if (!remaining.has(other.id)) continue;
        if (!bboxTouches(current.bbox_px, other.bbox_px, 0.5)) continue;
        remaining.delete(other.id);
        stack.push(other.id);
      }
    }
    components.push(component);
  }
  return components;
}

function boundaryEvidenceFromTiles(tiles = []) {
  const lineSegments = [];
  const edgeTiles = tiles.filter((tile) => tile.edge_density >= 0.16);
  let index = 0;
  for (const tile of edgeTiles.slice(0, 160)) {
    const [x, y, w, h] = tile.bbox_px;
    lineSegments.push({
      id: `land_cover_boundary_${index++}`,
      a: [round(x), round(y + h / 2)],
      b: [round(x + w), round(y + h / 2)],
      source_tile_id: tile.id,
      confidence: round(Math.min(0.82, 0.38 + tile.edge_density * 1.7)),
      class_boundary_hint: tile.class
    });
  }
  return {
    method: 'tile_gradient_boundary_vote',
    line_segments: lineSegments,
    boundary_confidence: round(average(lineSegments.map((line) => line.confidence), 0)),
    source_tile_count: edgeTiles.length
  };
}

function lineEvidenceFromObservations(topImage, boundaryEvidence) {
  const parking = (topImage?.observations || [])
    .filter((item) => /^parking_stall_row/.test(item.component_hint || '') && item.bbox)
    .map((item, index) => segment(`parking_marking_${index + 1}`, [item.bbox[0], item.bbox[1] + item.bbox[3] / 2], [item.bbox[0] + item.bbox[2], item.bbox[1] + item.bbox[3] / 2], item.id));
  const road = (topImage?.observations || [])
    .filter((item) => item.component_hint === 'parking_drive_aisle_center' && item.bbox)
    .map((item, index) => segment(`road_marking_${index + 1}`, [item.bbox[0], item.bbox[1] + item.bbox[3] / 2], [item.bbox[0] + item.bbox[2], item.bbox[1] + item.bbox[3] / 2], item.id));
  return {
    method: 'observation_lines_plus_boundary_tiles',
    parking_marking_segments: parking,
    road_marking_segments: road,
    boundary_segment_count: boundaryEvidence.line_segments?.length || 0
  };
}

function landCoverQa({ tiles, masks, siteBbox, boundaryEvidence, lineEvidence }) {
  const siteArea = bboxArea(siteBbox);
  const areaByClass = Object.fromEntries(BIRD_EYE_LAND_COVER_CLASSES.map((cls) => [cls, 0]));
  for (const tile of tiles) areaByClass[tile.class] = round((areaByClass[tile.class] || 0) + tile.area_px);
  const ratio = (cls) => round((areaByClass[cls] || 0) / Math.max(1, siteArea));
  const vegetationRatio = round(ratio('vegetation_tree') + ratio('vegetation_low'));
  const pavedRatio = round(ratio('paved_surface') + ratio('road_surface_candidate') + ratio('parking_surface_candidate'));
  const unknownRatio = round(ratio('unknown') + ratio('shadow_or_dark_unknown'));
  const warnings = [
    ...(unknownRatio > 0.3 ? ['unknown_land_cover_above_threshold'] : []),
    ...(vegetationRatio <= 0.02 ? ['vegetation_signal_too_low'] : []),
    ...(pavedRatio <= 0.08 ? ['paved_surface_signal_too_low'] : []),
    ...((lineEvidence.parking_marking_segments?.length || 0) < 2 ? ['parking_marking_lines_below_expected'] : [])
  ];
  return {
    ok: true,
    verdict: warnings.length ? 'review' : 'pass',
    site_coverage_ratio: round(tiles.reduce((sum, tile) => sum + tile.area_px, 0) / Math.max(1, siteArea)),
    building_exclusion_ratio: ratio('building_footprint'),
    paved_surface_ratio: pavedRatio,
    vegetation_ratio: vegetationRatio,
    unknown_land_cover_ratio: unknownRatio,
    boundary_confidence: round(boundaryEvidence.boundary_confidence || 0),
    road_marking_line_count: lineEvidence.road_marking_segments?.length || 0,
    parking_marking_line_count: lineEvidence.parking_marking_segments?.length || 0,
    class_area_ratio: Object.fromEntries(BIRD_EYE_LAND_COVER_CLASSES.map((cls) => [cls, ratio(cls)])),
    class_confusion_warnings: warnings,
    issues: warnings.map((warning) => ({
      severity: 'warn',
      type: `land_cover.${warning}`,
      rule_id: `land_cover.${warning}`,
      message: warning,
      evidence: {}
    }))
  };
}

function correctionTargetsFromQa(qa = {}) {
  return (qa.class_confusion_warnings || []).map((warning) => ({
    target: `land_cover.${warning}`,
    action: warning.includes('unknown')
      ? 'improve_paved_vegetation_boundary_features'
      : 'inspect_land_cover_class_thresholds',
    reason: warning
  }));
}

function buildingExclusionBoxes(topImage) {
  return (topImage?.observations || [])
    .filter((item) => item.bbox && (BUILDING_HINTS.has(item.component_hint) || SERVICE_EXCLUSION_HINTS.has(item.component_hint)))
    .filter((item) => !/^building_top_warehouse_row/.test(item.id || ''))
    .map((item) => normalizeBbox(item.bbox));
}

function semanticGuideBoxes(topImage) {
  const observations = topImage?.observations || [];
  return {
    parking: observations.filter((item) => PARKING_HINTS.has(item.component_hint) && item.bbox).map((item) => normalizeBbox(item.bbox)),
    road: observations.filter((item) => ROAD_HINTS.has(item.component_hint) && item.bbox).map((item) => normalizeBbox(item.bbox)),
    vegetation: observations.filter((item) => /tree|green|vegetation/i.test(item.component_hint || '') && item.bbox).map((item) => normalizeBbox(item.bbox))
  };
}

function findTopImage(observations) {
  return (observations.images || []).find((image) => image.detected_view?.kind === 'top')
    || (observations.images || []).find((image) => image.image?.path && /top/i.test(image.image.path));
}

function findObservation(image, hint) {
  return (image?.observations || []).find((item) => item.component_hint === hint || item.id === hint);
}

function missingLandCover() {
  return {
    kind: 'bird_eye_land_cover_v1',
    version: 1,
    backend: 'missing_top_view',
    coordinate_convention: 'image_x_right_y_down',
    source_image: null,
    analysis_size: { width: 0, height: 0 },
    site_bbox_px: [0, 0, 0, 0],
    classes: BIRD_EYE_LAND_COVER_CLASSES,
    masks: [],
    tiles: [],
    boundary_evidence: { method: 'none', line_segments: [], boundary_confidence: 0, source_tile_count: 0 },
    line_evidence: { method: 'none', parking_marking_segments: [], road_marking_segments: [], boundary_segment_count: 0 },
    qa: {
      ok: false,
      verdict: 'fail',
      site_coverage_ratio: 0,
      building_exclusion_ratio: 0,
      paved_surface_ratio: 0,
      vegetation_ratio: 0,
      unknown_land_cover_ratio: 1,
      boundary_confidence: 0,
      road_marking_line_count: 0,
      parking_marking_line_count: 0,
      class_confusion_warnings: ['missing_top_view'],
      issues: [{ severity: 'error', type: 'land_cover.missing_top_view', rule_id: 'land_cover.missing_top_view', message: 'missing_top_view', evidence: {} }]
    },
    correction_targets: [{ target: 'land_cover.missing_top_view', action: 'provide_top_or_near_orthographic_view', reason: 'missing_top_view' }]
  };
}

function tilesSvg(tiles = [], panel, opacity = 0.94) {
  return tiles.map((tile) => {
    const color = BIRD_EYE_LAND_COVER_COLORS[tile.class] || BIRD_EYE_LAND_COVER_COLORS.unknown;
    const [x, y, w, h] = tile.bbox_px;
    return `<rect x="${round(panel.x + x)}" y="${round(panel.contentY + y)}" width="${round(w)}" height="${round(h)}" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-width="0.4"/>`;
  }).join('\n  ');
}

function lineEvidenceSvg(landCover, panel) {
  const boundary = (landCover.boundary_evidence?.line_segments || []).slice(0, 220).map((line) => (
    `<line x1="${round(panel.x + line.a[0])}" y1="${round(panel.contentY + line.a[1])}" x2="${round(panel.x + line.b[0])}" y2="${round(panel.contentY + line.b[1])}" stroke="#111827" stroke-opacity="0.45" stroke-width="1"/>`
  ));
  const parking = (landCover.line_evidence?.parking_marking_segments || []).map((line) => (
    `<line x1="${round(panel.x + line.a[0])}" y1="${round(panel.contentY + line.a[1])}" x2="${round(panel.x + line.b[0])}" y2="${round(panel.contentY + line.b[1])}" stroke="#f59e0b" stroke-width="3"/>`
  ));
  const road = (landCover.line_evidence?.road_marking_segments || []).map((line) => (
    `<line x1="${round(panel.x + line.a[0])}" y1="${round(panel.contentY + line.a[1])}" x2="${round(panel.x + line.b[0])}" y2="${round(panel.contentY + line.b[1])}" stroke="#334155" stroke-width="3"/>`
  ));
  return [...boundary, ...parking, ...road].join('\n  ');
}

function boundaryGraphSvg(boundaryGraph, panel) {
  const allEdges = [
    ...(boundaryGraph.observed_edges || []),
    ...(boundaryGraph.completed_edges || [])
  ];
  const edges = boundaryGraph.backend === 'source_image_edge_detector_v1'
    ? allEdges.filter((edge) => (
      (edge.type === 'site_boundary_edge' && /^source_site_boundary_/.test(edge.id || ''))
      || ['road_boundary_edge', 'paved_green_edge', 'parking_envelope_edge'].includes(edge.type)
    ))
    : allEdges;
  const edgeLines = edges.slice(0, 340).map((edge) => {
    const style = boundaryEdgeStyle(edge);
    return `<line x1="${round(panel.x + edge.a[0])}" y1="${round(panel.contentY + edge.a[1])}" x2="${round(panel.x + edge.b[0])}" y2="${round(panel.contentY + edge.b[1])}" stroke="${style.stroke}" stroke-opacity="${style.opacity}" stroke-width="${style.width}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>`;
  });
  const corridors = (boundaryGraph.corridor_hypotheses || []).slice(0, 30).map((hypothesis) => {
    const [x, y, w, h] = hypothesis.bbox_px || [0, 0, 0, 0];
    const style = boundaryHypothesisStyle(hypothesis);
    return `<rect x="${round(panel.x + x)}" y="${round(panel.contentY + y)}" width="${round(w)}" height="${round(h)}" fill="${style.fill}" fill-opacity="0.22" stroke="${style.stroke}" stroke-width="2"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>`;
  });
  return [...corridors, ...edgeLines].join('\n  ');
}

function boundaryEdgeStyle(edge) {
  const byType = {
    site_boundary_edge: '#111827',
    road_boundary_edge: '#334155',
    paved_green_edge: '#15803d',
    parking_envelope_edge: '#d97706',
    building_exclusion_edge: '#2563eb',
    unknown_boundary_edge: '#7f1d1d'
  };
  const stroke = byType[edge.type] || '#334155';
  if (edge.state === 'observed') return { stroke, width: 2.3, opacity: 0.85, dash: '' };
  if (edge.state === 'completed_occluded') return { stroke, width: 2.2, opacity: 0.78, dash: '9 5' };
  if (edge.state === 'completed_gap') return { stroke, width: 2, opacity: 0.72, dash: '7 5' };
  if (edge.state === 'extrapolated_off_frame') return { stroke: '#7c3aed', width: 2, opacity: 0.72, dash: '2 5' };
  return { stroke: '#a16207', width: 2, opacity: 0.66, dash: '5 6' };
}

function boundaryHypothesisStyle(hypothesis) {
  if (hypothesis.inference_level === 'completed_occluded') return { fill: '#64748b', stroke: '#334155', dash: '9 5' };
  if (hypothesis.inference_level === 'completed_gap') return { fill: '#94a3b8', stroke: '#475569', dash: '7 5' };
  if (hypothesis.inference_level === 'extrapolated_off_frame') return { fill: '#c4b5fd', stroke: '#7c3aed', dash: '2 5' };
  return { fill: '#facc15', stroke: '#a16207', dash: '5 6' };
}

function finalSubdivisionSvg(cells = [], panel) {
  const colors = {
    building_footprint: '#2f80d0',
    road: '#8b949e',
    parking: '#f0bf2b',
    green: '#42a75b',
    walkway: '#b58add',
    service_yard: '#b97745',
    gap: '#f8fafc',
    open_paved_area: '#c9d0d8',
    road_candidate: '#5f6b76',
    walkway_candidate: '#b58add',
    service_yard_candidate: '#d19b70',
    vegetation_gap: '#9bd08f',
    true_gap: '#eef1f4',
    unknown_gap: '#ffffff'
  };
  return cells.map((cell) => {
    const cls = cell.class === 'gap' ? (cell.gap_class || 'unknown_gap') : cell.class;
    const color = colors[cls] || '#f8fafc';
    const [x, y, w, h] = cell.bbox_px;
    return `<rect x="${round(panel.x + x)}" y="${round(panel.contentY + y)}" width="${round(w)}" height="${round(h)}" fill="${color}" fill-opacity="0.92" stroke="#475569" stroke-opacity="0.18" stroke-width="0.7"/>`;
  }).join('\n  ');
}

function legendSvg(y) {
  const keys = ['building_footprint', 'paved_surface', 'road_surface_candidate', 'parking_surface_candidate', 'vegetation_tree', 'vegetation_low', 'bare_soil', 'shadow_or_dark_unknown', 'unknown'];
  return keys.map((key, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 22 + col * 300;
    const itemY = y + row * 24;
    return `<rect x="${x}" y="${itemY - 14}" width="18" height="14" fill="${BIRD_EYE_LAND_COVER_COLORS[key]}" stroke="#475569"/><text x="${x + 26}" y="${itemY - 3}" font-size="13" fill="#1c2530" font-family="Inter, Arial, sans-serif">${escapeXml(key)}</text>`;
  }).join('\n  ');
}

function mask(id, cls, bbox) {
  const normalized = normalizeBbox(bbox);
  return {
    id,
    class: cls,
    bbox_px: normalized,
    polygon_px: bboxPolygon(normalized),
    area_px: round(bboxArea(normalized)),
    area_ratio: 0,
    method: 'programmatic_ground_truth',
    confidence: 0.9,
    source_pixels: Math.round(bboxArea(normalized)),
    review_required: false
  };
}

function segment(id, a, b, sourceObservationId = null) {
  return {
    id,
    a: a.map((value) => round(value)),
    b: b.map((value) => round(value)),
    source_observation_id: sourceObservationId,
    confidence: 0.72
  };
}

function confidenceForClass(cls, coverage, edgeDensity) {
  const base = cls === 'unknown' ? 0.28 : cls.includes('unknown') ? 0.36 : 0.52;
  return round(Math.min(0.9, base + coverage * 0.3 + Math.min(0.08, edgeDensity * 0.4)));
}

function classOrder(cls) {
  const order = {
    building_footprint: 0,
    vegetation_tree: 1,
    vegetation_low: 2,
    parking_surface_candidate: 3,
    road_surface_candidate: 4,
    paved_surface: 5,
    parking_marking: 6,
    road_marking: 7,
    bare_soil: 8,
    shadow_or_dark_unknown: 9,
    unknown: 10
  };
  return order[cls] ?? 99;
}

function pointInBbox([x, y], bbox) {
  return x >= bbox[0] && x < bbox[0] + bbox[2] && y >= bbox[1] && y < bbox[1] + bbox[3];
}

function bboxTouches(a, b, tolerance = 0) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  return !(ax2 < b[0] - tolerance || bx2 < a[0] - tolerance || ay2 < b[1] - tolerance || by2 < a[1] - tolerance);
}

function expandBbox(bbox, pad) {
  return [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad * 2, bbox[3] + pad * 2];
}

function intersectionArea(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function bboxUnion(bboxes = []) {
  const xs = bboxes.flatMap((bbox) => [bbox[0], bbox[0] + bbox[2]]);
  const ys = bboxes.flatMap((bbox) => [bbox[1], bbox[1] + bbox[3]]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return [minX, minY, maxX - minX, maxY - minY];
}

function bboxArea(bbox) {
  if (!bbox) return 0;
  return Math.max(0, Number(bbox[2]) || 0) * Math.max(0, Number(bbox[3]) || 0);
}

function bboxPolygon([x, y, width, height]) {
  return [
    [round(x), round(y)],
    [round(x + width), round(y)],
    [round(x + width), round(y + height)],
    [round(x), round(y + height)],
    [round(x), round(y)]
  ];
}

function normalizeBbox(bbox = [0, 0, 0, 0]) {
  return bbox.map((value) => round(value));
}

function rgbToHsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const maxValue = Math.max(rr, gg, bb);
  const minValue = Math.min(rr, gg, bb);
  const delta = maxValue - minValue;
  let h = 0;
  if (delta !== 0) {
    if (maxValue === rr) h = 60 * (((gg - bb) / delta) % 6);
    else if (maxValue === gg) h = 60 * ((bb - rr) / delta + 2);
    else h = 60 * ((rr - gg) / delta + 4);
  }
  if (h < 0) h += 360;
  return {
    h,
    s: maxValue === 0 ? 0 : delta / maxValue,
    v: maxValue
  };
}

function average(values = [], fallback = 0) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return fallback;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  }[char]));
}
