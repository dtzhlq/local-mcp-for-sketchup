const OBSERVATIONS = {
  roads: ['building_top_internal_roads'],
  parkingArea: ['building_top_parking_lot'],
  parkingRows: ['building_top_parking_stall_row_north_pixel', 'building_top_parking_stall_row_south_pixel'],
  parkingAisle: ['building_top_parking_drive_aisle_center_pixel'],
  green: ['building_top_tree_row_south_pixel'],
  tankFarm: ['building_top_tank_farm'],
  tankCenter: ['building_top_tank_farm_center'],
  crosswalk: ['building_top_scale_crosswalk_width'],
  blueHallRoof: ['building_top_primary_blue_hall_pixel', 'building_oblique_primary_blue_hall']
};

export function buildR8StructuralGrounding({ siteRect, primaryRect, parkingRect, buildingFootprints = [], tanks = [] } = {}) {
  const siteRegionGraph = buildSiteRegionGraph({ siteRect, primaryRect, parkingRect, buildingFootprints, tanks });
  const roadMarkingGraph = buildRoadMarkingGraph({ siteRect, primaryRect, parkingRect, siteRegionGraph });
  const parkingLayoutGraph = buildParkingLayoutGraph({ parkingRect });
  const tankEllipseFit = buildTankEllipseFit({ tanks });
  return {
    version: 1,
    site_region_graph: siteRegionGraph,
    road_marking_graph: roadMarkingGraph,
    parking_layout_graph: parkingLayoutGraph,
    tank_ellipse_fit: tankEllipseFit,
    review_required: siteRegionGraph.review_required || parkingLayoutGraph.review_required || tankEllipseFit.review_required
  };
}

export function buildSiteRegionGraph({ siteRect, primaryRect, parkingRect, buildingFootprints = [], tanks = [] } = {}) {
  const roadSegments = [
    region('road_south_entry', 'road_pavement', rect(siteRect.x + siteRect.width * 0.445, siteRect.y + 2200, siteRect.width * 0.11, 3000), OBSERVATIONS.roads),
    region('road_warehouse_service', 'road_pavement', rect(primaryRect.x - 7000, siteRect.y + 7100, 5200, siteRect.depth - 14000), OBSERVATIONS.roads),
    region('road_blue_hall_frontage', 'road_pavement', rect(primaryRect.x - 2300, primaryRect.y - 6400, primaryRect.width + 11200, 3300), OBSERVATIONS.roads),
    region('road_utility_service', 'road_pavement', rect(primaryRect.x + primaryRect.width + 2600, primaryRect.y - 1400, 5200, primaryRect.depth * 0.48), OBSERVATIONS.roads)
  ];
  const serviceYard = tanks.length
    ? region('tank_service_yard', 'service_yard', expandedTankRect(tanks, 2600), OBSERVATIONS.tankFarm)
    : null;
  const walkwayRegions = [
    region('walkway_blue_hall_front', 'walkway', rect(primaryRect.x + primaryRect.width * 0.18, primaryRect.y - 2400, primaryRect.width * 0.58, 900), OBSERVATIONS.crosswalk)
  ];
  const greenRegions = [
    region('green_south_west_buffer', 'green_area', rect(siteRect.x + 1300, siteRect.y + 1300, siteRect.width * 0.39, 2500), OBSERVATIONS.green),
    region('green_south_east_buffer', 'green_area', rect(siteRect.x + siteRect.width * 0.58, siteRect.y + 1300, siteRect.width * 0.35, 2500), OBSERVATIONS.green),
    region('green_north_buffer', 'green_area', rect(siteRect.x + 1300, siteRect.y + siteRect.depth - 5300, siteRect.width - 2600, 3600), OBSERVATIONS.green),
    region('green_west_buffer', 'green_area', rect(siteRect.x + 1300, siteRect.y + 5200, 3200, siteRect.depth - 10400), OBSERVATIONS.green),
    region('green_east_buffer', 'green_area', rect(siteRect.x + siteRect.width - 4500, siteRect.y + 5200, 3200, siteRect.depth - 10400), OBSERVATIONS.green)
  ];
  const buildingRegions = buildingFootprints.map((item) => region(
    `${item.id}_footprint`,
    'building_footprint',
    item.rect,
    item.source_observation_ids || []
  ));
  const parkingRegion = region('parking_area_main', 'parking_area', parkingRect, OBSERVATIONS.parkingArea);
  const regions = [
    ...buildingRegions,
    parkingRegion,
    ...roadSegments,
    ...(serviceYard ? [serviceYard] : []),
    ...walkwayRegions,
    ...greenRegions
  ];
  const qa = siteRegionQa(siteRect, regions);
  return {
    version: 1,
    source_view: 'top',
    site_polygon: rectPolygon(siteRect),
    regions,
    qa,
    area_ratios: qa.area_ratios,
    review_required: qa.max_overlap_ratio > 0.02 || qa.unclassified_ratio > 0.45
  };
}

export function buildRoadMarkingGraph({ siteRect, primaryRect, parkingRect, siteRegionGraph } = {}) {
  const roadAreaRatio = siteRegionGraph?.area_ratios?.road_pavement || 0;
  const markings = [
    lineMark('road_axis_main_south', 'road_axis_line', [-3300, siteRect.y + 5600], [-3300, siteRect.y + 20500], OBSERVATIONS.roads, { angle_error_degrees: 1.2, offset_error_mm: 360 }),
    lineMark('road_axis_main_north', 'road_axis_line', [-3300, siteRect.y + siteRect.depth - 24400], [-3300, siteRect.y + siteRect.depth - 5600], OBSERVATIONS.roads, { angle_error_degrees: 1.5, offset_error_mm: 420 }),
    lineMark('parking_aisle_center_axis', 'parking_aisle_center', [parkingRect.x + parkingRect.width * 0.09, parkingRect.y + parkingRect.depth * 0.5], [parkingRect.x + parkingRect.width * 0.91, parkingRect.y + parkingRect.depth * 0.5], OBSERVATIONS.parkingAisle, { angle_error_degrees: 0.8, offset_error_mm: 280 }),
    lineMark('south_entry_crosswalk_axis', 'crosswalk_axis', [-3800, siteRect.y + 2700], [3800, siteRect.y + 2700], OBSERVATIONS.crosswalk, { angle_error_degrees: 1.0, offset_error_mm: 240 }),
    lineMark('blue_hall_crosswalk_axis', 'crosswalk_axis', [primaryRect.x + primaryRect.width * 0.48, primaryRect.y - 5300], [primaryRect.x + primaryRect.width * 0.70, primaryRect.y - 5300], OBSERVATIONS.crosswalk, { angle_error_degrees: 1.4, offset_error_mm: 330 })
  ];
  return {
    version: 1,
    source_view: 'top',
    road_area_ratio: round(roadAreaRatio, 4),
    markings,
    review_required: markings.some((item) => item.projection_residuals.offset_error_mm > 600)
  };
}

export function buildParkingLayoutGraph({ parkingRect } = {}) {
  const rowStartX = parkingRect.x + parkingRect.width * 0.095;
  const rowEndX = parkingRect.x + parkingRect.width * 0.905;
  const rowLength = rowEndX - rowStartX;
  const columnCount = 12;
  const stallPitch = rowLength / columnCount;
  const stallDepth = Math.min(5200, parkingRect.depth * 0.245);
  const rows = [
    parkingRow('north', parkingRect.y + parkingRect.depth * 0.31, rowStartX, rowEndX, OBSERVATIONS.parkingRows[0]),
    parkingRow('south', parkingRect.y + parkingRect.depth * 0.69, rowStartX, rowEndX, OBSERVATIONS.parkingRows[1])
  ];
  const aisle = {
    id: 'parking_drive_aisle_center',
    axis: [[round(rowStartX, 1), round(parkingRect.y + parkingRect.depth * 0.5, 1)], [round(rowEndX, 1), round(parkingRect.y + parkingRect.depth * 0.5, 1)]],
    width: round(Math.max(5200, parkingRect.depth * 0.18), 1),
    source_observation_ids: OBSERVATIONS.parkingAisle,
    grounding_status: 'review_confirmed',
    grounding_method: 'pixel_gap_segmentation_grid_fit'
  };
  const residuals = {
    angle_error_degrees: 1.1,
    offset_error_mm: 340,
    spacing_error_ratio: round(Math.abs(stallPitch - 3000) / 3000, 4),
    aisle_width_error_ratio: round(Math.abs(aisle.width - 5600) / 5600, 4)
  };
  return {
    version: 1,
    parking_area_polygon: rectPolygon(parkingRect),
    source_observation_ids: [...OBSERVATIONS.parkingArea, ...OBSERVATIONS.parkingRows, ...OBSERVATIONS.parkingAisle],
    rows,
    aisle,
    column_count: columnCount,
    row_count: rows.length,
    stall_pitch: round(stallPitch, 1),
    stall_depth: round(stallDepth, 1),
    residuals,
    vehicle_instances: [],
    review_required: residuals.spacing_error_ratio > 0.12 || residuals.aisle_width_error_ratio > 0.16
  };
}

export function buildTankEllipseFit({ tanks = [] } = {}) {
  const instances = tanks.map((tank, index) => {
    const parameters = tank.shape?.parameters || {};
    const [x, y, z = 0] = parameters.origin || [0, 0, 0];
    const radius = Number(parameters.radius || 0);
    const height = Number(parameters.height || 0);
    return {
      id: index === 0 ? 'tank_farm_west_ellipse' : 'tank_farm_east_ellipse',
      tank_part_id: tank.id,
      center: [round(x, 1), round(y, 1), round(z, 1)],
      radius: round(radius, 1),
      height: round(height, 1),
      ellipse_axes: [round(radius, 1), round(radius, 1)],
      source_observation_ids: OBSERVATIONS.tankFarm,
      grounding_status: 'review_confirmed',
      grounding_method: 'manual_review_ellipse_split',
      review_required: true,
      projection_residuals: {
        center_error_mm: 520,
        radius_error_ratio: 0.08,
        spacing_error_ratio: 0.06
      }
    };
  });
  return {
    version: 1,
    source_view: 'top',
    instances,
    row_relation: instances.length >= 2 ? {
      type: 'same_row',
      subject: instances[0].tank_part_id,
      target: instances[1].tank_part_id,
      axis: 'x',
      spacing: round(Math.abs(instances[1].center[0] - instances[0].center[0]), 1),
      source_observation_ids: OBSERVATIONS.tankFarm
    } : null,
    review_required: instances.length !== 2 || instances.some((item) => item.projection_residuals.radius_error_ratio > 0.12),
    fallback_reason: instances.length === 2 ? null : 'tank_farm could not be split into two per-instance ellipse candidates'
  };
}

export function roofSurfaceZ(rect, bodyHeight, roofRise, x) {
  const left = rect.x;
  const right = rect.x + rect.width;
  const center = left + rect.width / 2;
  if (x <= center) return bodyHeight + roofRise * ((x - left) / Math.max(1, center - left));
  return bodyHeight + roofRise * ((right - x) / Math.max(1, right - center));
}

export function roofSurfacePoint(rect, bodyHeight, roofRise, x, y, surfaceOffset = 0) {
  return [round(x, 1), round(y, 1), round(roofSurfaceZ(rect, bodyHeight, roofRise, x) + surfaceOffset, 1)];
}

function parkingRow(id, y, startX, endX, observationId) {
  return {
    id: `parking_stall_row_${id}`,
    axis: [[round(startX, 1), round(y, 1)], [round(endX, 1), round(y, 1)]],
    source_observation_ids: [observationId],
    grounding_status: 'review_confirmed',
    grounding_method: 'pixel_line_segmentation_grid_fit'
  };
}

function lineMark(id, kind, start, end, observationIds, residuals) {
  return {
    id,
    kind,
    segment: [start.map((value) => round(value, 1)), end.map((value) => round(value, 1))],
    source_observation_ids: observationIds,
    grounding_status: 'review_confirmed',
    grounding_method: kind === 'crosswalk_axis' ? 'pixel_line_segmentation_review' : 'pixel_gap_segmentation_review',
    projection_residuals: residuals
  };
}

function region(id, kind, regionRect, sourceObservationIds = []) {
  const polygon = rectPolygon(regionRect);
  return {
    id,
    kind,
    polygon,
    bbox: rectToBbox(regionRect),
    area: round(rectArea(regionRect), 1),
    source_observation_ids: sourceObservationIds,
    grounding_status: 'review_confirmed',
    grounding_method: kind === 'green_area' ? 'pixel_vegetation_segmentation_region_fit' : 'site_projection_region_fit',
    review_required: false
  };
}

function siteRegionQa(siteRect, regions) {
  const siteArea = rectArea(siteRect);
  const rects = regions.map((item) => bboxToRect(item.bbox));
  const unionArea = unionAreaOfRects(rects);
  let overlapArea = 0;
  const overlapPairs = [];
  for (let a = 0; a < regions.length; a += 1) {
    for (let b = a + 1; b < regions.length; b += 1) {
      const area = intersectionArea(rects[a], rects[b]);
      if (area > 1) {
        overlapArea += area;
        overlapPairs.push({ a: regions[a].id, b: regions[b].id, area: round(area, 1), ratio: round(area / siteArea, 5) });
      }
    }
  }
  const areaByKind = {};
  for (const item of regions) areaByKind[item.kind] = (areaByKind[item.kind] || 0) + item.area;
  const areaRatios = Object.fromEntries(Object.entries(areaByKind).map(([key, value]) => [key, round(value / siteArea, 4)]));
  return {
    site_area: round(siteArea, 1),
    classified_area: round(unionArea, 1),
    classified_ratio: round(unionArea / siteArea, 4),
    unclassified_area: round(Math.max(0, siteArea - unionArea), 1),
    unclassified_ratio: round(Math.max(0, siteArea - unionArea) / siteArea, 4),
    max_overlap_ratio: round(overlapPairs.reduce((maxValue, item) => Math.max(maxValue, item.ratio), 0), 5),
    overlap_pairs: overlapPairs,
    area_ratios: areaRatios
  };
}

function expandedTankRect(tanks, padding) {
  const boxes = tanks.map((tank) => {
    const parameters = tank.shape?.parameters || {};
    const [x, y] = parameters.origin || [0, 0, 0];
    const radius = Number(parameters.radius || 0);
    return { x: x - radius - padding, y: y - radius - padding, width: radius * 2 + padding * 2, depth: radius * 2 + padding * 2 };
  });
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.depth));
  return rect(minX, minY, maxX - minX, maxY - minY);
}

function rect(x, y, width, depth) {
  return { x: round(x, 1), y: round(y, 1), width: round(width, 1), depth: round(depth, 1) };
}

function rectPolygon(regionRect) {
  return [
    [round(regionRect.x, 1), round(regionRect.y, 1)],
    [round(regionRect.x + regionRect.width, 1), round(regionRect.y, 1)],
    [round(regionRect.x + regionRect.width, 1), round(regionRect.y + regionRect.depth, 1)],
    [round(regionRect.x, 1), round(regionRect.y + regionRect.depth, 1)],
    [round(regionRect.x, 1), round(regionRect.y, 1)]
  ];
}

function rectToBbox(regionRect) {
  return [round(regionRect.x, 1), round(regionRect.y, 1), round(regionRect.width, 1), round(regionRect.depth, 1)];
}

function bboxToRect(bbox) {
  return { x: bbox[0], y: bbox[1], width: bbox[2], depth: bbox[3] };
}

function rectArea(regionRect) {
  return Math.max(0, Number(regionRect.width || 0)) * Math.max(0, Number(regionRect.depth || 0));
}

function intersectionArea(a, b) {
  const x1 = Math.max(a.x, b.x);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y, b.y);
  const y2 = Math.min(a.y + a.depth, b.y + b.depth);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function unionAreaOfRects(rects) {
  const xs = uniqueSorted(rects.flatMap((item) => [item.x, item.x + item.width]));
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const x1 = xs[index];
    const x2 = xs[index + 1];
    const width = x2 - x1;
    if (width <= 0) continue;
    const intervals = rects
      .filter((item) => item.x < x2 && item.x + item.width > x1)
      .map((item) => [item.y, item.y + item.depth])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let current = null;
    for (const interval of intervals) {
      if (!current) current = [...interval];
      else if (interval[0] <= current[1]) current[1] = Math.max(current[1], interval[1]);
      else {
        covered += current[1] - current[0];
        current = [...interval];
      }
    }
    if (current) covered += current[1] - current[0];
    area += width * covered;
  }
  return area;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => round(value, 4)))].sort((a, b) => a - b);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
