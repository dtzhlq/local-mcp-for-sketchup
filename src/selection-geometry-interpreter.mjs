const ROAD_NAME_PATTERNS = [
  /road/i,
  /street/i,
  /lane/i,
  /drive/i,
  /pavement/i,
  /asphalt/i,
  /道路/,
  /路面/,
  /车道/,
  /公路/,
  /马路/
];

export function analyzeSelectionGeometry({
  selection = [],
  snapshot,
  model_info,
  runtime = 'mock',
  assume = null,
  includeDetails = true
} = {}) {
  const enriched = enrichSelection(selection, snapshot);
  const entities = enriched.map((entity, index) => analyzeEntityGeometry(entity, {
    index,
    assume,
    includeDetails
  }));
  const uncertainties = entities.flatMap((entity) => entity.uncertainties.map((item) => ({
    ...item,
    entity_index: entity.index,
    entity_id: entity.reference.id || null,
    entity_type: entity.entity_type
  })));
  if (!entities.length) {
    uncertainties.push({
      type: 'selection.empty',
      severity: 'error',
      message: 'No selected geometry was available to interpret.'
    });
  }

  return {
    kind: 'selection_geometry_analysis',
    runtime,
    ok: entities.length > 0,
    source: {
      selection_count: selection.length,
      analyzed_count: entities.length,
      model_totals: model_info?.totals || null,
      model_bounding_box: model_info?.bounding_box || null
    },
    entities,
    aggregate: aggregateAnalysis(entities),
    uncertainties
  };
}

function enrichSelection(selection, snapshot) {
  const snapshotItems = [
    ...(snapshot?.groups || []).map((item) => ({ ...item, entity_type: 'group' })),
    ...(snapshot?.instances || []).map((item) => ({ ...item, entity_type: 'component_instance' }))
  ];
  return (selection || []).map((item) => {
    const match = snapshotItems.find((candidate) => referencesMatch(candidate, item));
    return match ? { ...match, ...item, geometry_input: item.geometry_input || match.geometry_input } : item;
  });
}

function referencesMatch(candidate, item) {
  const candidateIds = [candidate.id, candidate.persistent_id, candidate.name].filter(Boolean).map(String);
  const itemIds = [item.id, item.persistent_id, item.name].filter(Boolean).map(String);
  return candidateIds.some((id) => itemIds.includes(id));
}

function analyzeEntityGeometry(entity, { index, assume, includeDetails }) {
  const geometry = geometryFromEntity(entity);
  const polygon = geometry.type === 'polygon' ? analyzePolygon(geometry.points, entity, geometry.source, geometry.holes || []) : null;
  const polyline = geometry.type === 'polyline' ? analyzePolyline(geometry.points, entity, geometry.source) : null;
  const bbox = geometry.type === 'bbox' ? analyzePolygon(bboxPolygon(entity.bounding_box), entity, geometry.source) : null;
  const analysis = polygon || polyline || bbox;
  const hypotheses = analysis ? inferHypotheses(entity, analysis, { assume, source: geometry.source }) : [];
  const uncertainties = uncertaintyFor(entity, geometry, analysis, hypotheses);

  return {
    index,
    reference: {
      id: entity.id || entity.persistent_id || entity.name || null,
      persistent_id: entity.persistent_id || null,
      name: entity.name || null
    },
    entity_type: entity.entity_type || entity.kind || 'unknown',
    kind: entity.kind || entity.entity_type || 'unknown',
    material: entity.material || null,
    tag: entity.tag || null,
    geometry: {
      type: geometry.type,
      source: geometry.source,
      confidence: geometry.confidence,
      ...(analysis || {}),
      ...(includeDetails && geometry.points ? { points: geometry.points.map((point) => point.map((value) => round(value))) } : {}),
      ...(includeDetails && geometry.holes?.length ? { holes: geometry.holes.map((loop) => loop.map((point) => point.map((value) => round(value)))) } : {})
    },
    hypotheses,
    uncertainties
  };
}

function geometryFromEntity(entity) {
  const orderedLoop = normalizePoints(entity.outer_loop || entity.outerLoop);
  const hasOrderedLoop = orderedLoop.length >= 3;
  const faceVertices = hasOrderedLoop ? orderedLoop : normalizePoints(entity.vertices);
  const holes = normalizeLoops(entity.holes || entity.inner_loops || entity.innerLoops);
  if (String(entity.entity_type || '').toLowerCase() === 'face' && faceVertices.length >= 3) {
    return {
      type: 'polygon',
      source: hasOrderedLoop ? 'selected_face_outer_loop' : 'selected_face_vertices',
      confidence: hasOrderedLoop ? 0.98 : 0.95,
      points: closeOpenLoop(faceVertices),
      holes
    };
  }
  if (String(entity.entity_type || '').toLowerCase() === 'edge' && faceVertices.length >= 2) {
    return { type: 'polyline', source: 'selected_edge_vertices', confidence: 0.95, points: faceVertices };
  }

  const geometryInput = entity.geometry_input;
  const geometryVertices = normalizePoints(geometryInput?.vertices);
  const face = geometryInput?.faces?.[0];
  const outer = face?.outer || face?.loop || face?.vertices;
  if (geometryVertices.length >= 3 && Array.isArray(outer) && outer.length >= 3) {
    const points = outer.map((index) => geometryVertices[Number(index)]).filter(Boolean);
    if (points.length >= 3) {
      const inputHoles = normalizeGeometryInputHoles(face?.holes, geometryVertices);
      return { type: 'polygon', source: 'geometry_input_outer_loop', confidence: 0.9, points: closeOpenLoop(points), holes: inputHoles };
    }
  }

  if (entity.bounding_box) {
    return { type: 'bbox', source: 'bounding_box_approximation', confidence: 0.35, points: bboxPolygon(entity.bounding_box) };
  }

  return { type: 'unknown', source: 'unavailable', confidence: 0, points: [] };
}

function normalizeLoops(loops) {
  if (!Array.isArray(loops)) return [];
  return loops
    .map((loop) => closeOpenLoop(normalizePoints(loop)))
    .filter((loop) => loop.length >= 3);
}

function normalizeGeometryInputHoles(holes, vertices) {
  if (!Array.isArray(holes)) return [];
  return holes
    .map((hole) => {
      const loop = Array.isArray(hole) ? hole : hole?.outer || hole?.loop || hole?.vertices;
      if (!Array.isArray(loop)) return [];
      return closeOpenLoop(loop.map((index) => vertices[Number(index)]).filter(Boolean));
    })
    .filter((loop) => loop.length >= 3);
}

function normalizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [
      finite(point[0]),
      finite(point[1]),
      finite(point[2] ?? 0)
    ])
    .filter((point) => point.every((value) => value !== null));
}

function closeOpenLoop(points) {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (distance2(first, last) < 1e-6) return points.slice(0, -1);
  return points;
}

function bboxPolygon(box) {
  if (!box?.min || !box?.max) return [];
  const z = (Number(box.min[2] || 0) + Number(box.max[2] || 0)) / 2;
  return [
    [Number(box.min[0]), Number(box.min[1]), z],
    [Number(box.max[0]), Number(box.min[1]), z],
    [Number(box.max[0]), Number(box.max[1]), z],
    [Number(box.min[0]), Number(box.max[1]), z]
  ];
}

function analyzePolygon(points3d, entity, source, holes3d = []) {
  const plane = projectionPlane(entity);
  const points = points3d.map((point) => projectPoint(point, plane));
  const holes = holes3d.map((loop) => loop.map((point) => projectPoint(point, plane))).filter((loop) => loop.length >= 3);
  const signedArea = polygonSignedArea(points);
  const outerArea = Math.abs(signedArea);
  const holeArea = holes.reduce((sum, loop) => sum + Math.abs(polygonSignedArea(loop)), 0);
  const measuredArea = Math.max(0, outerArea - holeArea);
  const area = Math.abs(entity.area_mm2 ?? measuredArea);
  const perimeter = polygonPerimeter(points);
  const bbox = bbox2d(points);
  const orientedBox = minimumOrientedBox(points);
  const hull = convexHull(points);
  const hullArea = Math.abs(polygonSignedArea(hull));
  const boundary = analyzeBoundarySegments(points);
  const corridorWidths = estimateCorridorWidths(points, orientedBox);
  const corridorWidth = corridorWidths[0] ?? orientedBox.width;
  const roadGraph = inferRoadGraph(points, corridorWidths, orientedBox);
  const horizontal = isHorizontalSurface(entity, points3d);
  const rectangularity = orientedBox.area > 0 ? clamp(area / orientedBox.area, 0, 1) : 0;
  const concavity = area > 0 ? round(hullArea / area, 4) : null;
  const aspect = orientedBox.width > 0 ? orientedBox.length / orientedBox.width : 0;

  return {
    primitive: 'surface_polygon',
    plane,
    source,
    horizontal,
    vertex_count: points.length,
    hole_count: holes.length,
    area_mm2: round(area),
    outer_area_mm2: round(outerArea),
    hole_area_mm2: round(holeArea),
    perimeter_mm: round(perimeter),
    bbox_2d: roundBox(bbox),
    oriented_extent: {
      length_mm: round(orientedBox.length),
      width_mm: round(orientedBox.width),
      angle_degrees: round(orientedBox.longAxisAngle * 180 / Math.PI, 3),
      area_mm2: round(orientedBox.area)
    },
    corridor_width_estimate_mm: corridorWidth ? round(corridorWidth) : null,
    corridor_width_candidates_mm: corridorWidths.map((width) => round(width)),
    boundary_summary: boundary,
    road_graph: roadGraph,
    shape_metrics: {
      aspect_ratio: round(aspect, 4),
      rectangularity: round(rectangularity, 4),
      convex_hull_area_mm2: round(hullArea),
      concavity_ratio: concavity,
      concave_vertex_count: boundary.concave_vertex_count,
      convex_vertex_count: boundary.convex_vertex_count,
      source_quality: source === 'bounding_box_approximation' ? 'approximate' : 'measured'
    }
  };
}

function analyzePolyline(points3d, entity, source) {
  const plane = projectionPlane(entity);
  const points = points3d.map((point) => projectPoint(point, plane));
  const length = polylineLength(points);
  const segments = polylineSegments(points);
  const longest = [...segments].sort((a, b) => b.length_mm - a.length_mm)[0] || null;
  const closed = points.length >= 3 && distance2(points[0], points[points.length - 1]) <= Math.max(10, length * 0.001);
  return {
    primitive: 'edge_polyline',
    plane,
    source,
    horizontal: isHorizontalSurface(entity, points3d),
    point_count: points.length,
    length_mm: round(entity.length ?? length),
    bbox_2d: roundBox(bbox2d(points)),
    closed,
    segment_count: segments.length,
    dominant_heading_degrees: longest ? longest.heading_degrees : null,
    segments
  };
}

function projectionPlane(entity) {
  const normal = Array.isArray(entity.normal) ? entity.normal.map(Number) : null;
  if (!normal) return 'xy';
  const abs = normal.map((value) => Math.abs(value));
  const max = Math.max(...abs);
  if (max === abs[2]) return 'xy';
  if (max === abs[1]) return 'xz';
  return 'yz';
}

function projectPoint(point, plane) {
  if (plane === 'xz') return [point[0], point[2]];
  if (plane === 'yz') return [point[1], point[2]];
  return [point[0], point[1]];
}

function isHorizontalSurface(entity, points) {
  if (Array.isArray(entity.normal)) return Math.abs(Number(entity.normal[2] || 0)) >= 0.85;
  const zValues = points.map((point) => Number(point[2] || 0));
  const zRange = Math.max(...zValues) - Math.min(...zValues);
  const box = entity.bounding_box;
  const planarScale = Math.max(Number(box?.w || 0), Number(box?.d || 0), 1);
  return zRange <= Math.max(10, planarScale * 0.01);
}

function inferHypotheses(entity, analysis, { assume, source }) {
  const hypotheses = [];
  if (analysis.primitive === 'surface_polygon') {
    const road = inferRoadCandidate(entity, analysis, { assume, source });
    hypotheses.push(road);
    hypotheses.push(inferJunctionCandidate(analysis, road));
    hypotheses.push(inferSurfaceCandidate(entity, analysis, road));
  } else if (analysis.primitive === 'edge_polyline') {
    const roadHint = assume === 'road' || assume === 'road_centerline' || assume === 'road_boundary';
    const longEnough = analysis.length_mm >= 2500;
    hypotheses.push({
      type: roadHint ? 'road_centerline_or_boundary_candidate' : 'boundary_or_centerline_candidate',
      confidence: round(clamp(0.28 + (longEnough ? 0.18 : 0) + (roadHint ? 0.2 : 0), 0, 0.68), 3),
      basis: [
        'selected edge/polyline',
        `length:${analysis.length_mm}mm`,
        analysis.dominant_heading_degrees !== null ? `heading:${analysis.dominant_heading_degrees}deg` : null,
        roadHint ? `user assumption ${assume}` : null
      ].filter(Boolean),
      measurements: {
        length_mm: analysis.length_mm,
        segment_count: analysis.segment_count,
        dominant_heading_degrees: analysis.dominant_heading_degrees
      },
      requires_confirmation: true,
      missing_semantics: ['surface width', 'side of road', 'traffic direction', 'lane count'],
      interpretation: 'The selected edge may be a road centerline, boundary, or construction edge; a single edge cannot define a full road surface width by itself.'
    });
  }
  return hypotheses.sort((a, b) => b.confidence - a.confidence);
}

function inferRoadCandidate(entity, analysis, { assume, source }) {
  const width = analysis.corridor_width_estimate_mm || analysis.oriented_extent.width_mm;
  const length = analysis.oriented_extent.length_mm;
  const aspect = analysis.shape_metrics.aspect_ratio;
  const concavity = analysis.shape_metrics.concavity_ratio || 1;
  const rectangularity = analysis.shape_metrics.rectangularity;
  const semanticRoad = semanticRoadSignal(entity);
  const corridorWidthOk = width >= 2500 && width <= 30000;
  const longSegment = aspect >= 2.5;
  const junctionLike = concavity >= 1.15 && analysis.vertex_count >= 8;

  let confidence = 0.08;
  const basis = [];
  if (analysis.horizontal) {
    confidence += 0.22;
    basis.push('horizontal surface');
  }
  if (corridorWidthOk) {
    confidence += 0.2;
    basis.push(`corridor width ${round(width)}mm`);
  }
  if (longSegment) {
    confidence += 0.2;
    basis.push(`elongated aspect ${round(aspect, 2)}`);
  }
  if (junctionLike) {
    confidence += 0.18;
    basis.push(`concave multi-arm surface ${round(concavity, 2)}`);
  }
  if (rectangularity >= 0.65 || junctionLike) {
    confidence += 0.08;
    basis.push(`rectangularity ${round(rectangularity, 2)}`);
  }
  if (semanticRoad) {
    confidence += 0.18;
    basis.push(`semantic label ${semanticRoad}`);
  }
  if (assume === 'road' || assume === 'road_surface') {
    confidence += 0.15;
    basis.push(`user assumption ${assume}`);
  }
  if (source === 'bounding_box_approximation') confidence *= 0.65;

  const type = longSegment && !junctionLike ? 'road_segment_candidate' : 'road_surface_candidate';
  return {
    type,
    confidence: round(clamp(confidence, 0, 0.95), 3),
    basis,
    measurements: {
      estimated_width_mm: round(width),
      estimated_length_mm: round(length),
      centerline: longSegment ? centerlineFromOrientedExtent(analysis) : null
    },
    requires_confirmation: confidence < 0.78 || junctionLike,
    missing_semantics: roadMissingSemantics(junctionLike)
  };
}

function inferJunctionCandidate(analysis, roadHypothesis) {
  const concavity = analysis.shape_metrics.concavity_ratio || 1;
  const graphIntersection = analysis.road_graph?.intersections?.[0]?.point || null;
  const junction = analysis.primitive === 'surface_polygon' && ((concavity >= 1.15 && analysis.vertex_count >= 8) || Boolean(graphIntersection));
  return {
    type: junction ? 'junction_or_branch_candidate' : 'junction_not_detected',
    confidence: junction ? round(Math.min(0.88, 0.35 + (concavity - 1) * 0.8 + (graphIntersection ? 0.08 : 0)), 3) : 0.25,
    basis: junction
      ? [`concavity ratio ${round(concavity, 2)}`, `${analysis.vertex_count} boundary vertices`, graphIntersection ? 'road graph intersection' : null].filter(Boolean)
      : ['surface is not strongly concave'],
    estimated_location: junction ? graphIntersection || bboxCenter(analysis.bbox_2d) : null,
    requires_confirmation: junction || roadHypothesis.confidence >= 0.5
  };
}

function inferSurfaceCandidate(entity, analysis, roadHypothesis) {
  const roadConfidence = roadHypothesis?.confidence || 0;
  const plazaConfidence = analysis.horizontal && analysis.shape_metrics.aspect_ratio < 1.8
    ? Math.max(0.2, 0.62 - roadConfidence * 0.35)
    : 0.18;
  return {
    type: 'generic_horizontal_surface',
    confidence: round(analysis.horizontal ? Math.max(0.25, plazaConfidence) : 0.12, 3),
    basis: [
      analysis.horizontal ? 'horizontal surface' : 'not horizontal',
      `area ${analysis.area_mm2}mm2`,
      entity.material ? `material ${entity.material}` : null
    ].filter(Boolean),
    interpretation: 'Could be pavement, plaza, floor slab, platform, parking apron, or another flat surface without domain context.'
  };
}

function roadMissingSemantics(junctionLike) {
  const missing = ['surface role confirmation', 'traffic direction', 'lane count'];
  if (junctionLike) missing.push('approach graph', 'stop-control or signal-control intent', 'crosswalk placement intent');
  return missing;
}

function semanticRoadSignal(entity) {
  const text = [entity.id, entity.name, entity.kind, entity.material, entity.tag].filter(Boolean).join(' ');
  const pattern = ROAD_NAME_PATTERNS.find((item) => item.test(text));
  return pattern ? pattern.toString() : null;
}

function uncertaintyFor(entity, geometry, analysis, hypotheses) {
  const uncertainties = [];
  if (geometry.type === 'unknown') {
    uncertainties.push({
      type: 'geometry.unavailable',
      severity: 'error',
      message: 'The selected entity did not expose vertices or a bounding box.'
    });
    return uncertainties;
  }
  if (geometry.source === 'bounding_box_approximation') {
    uncertainties.push({
      type: 'geometry.bbox_only',
      severity: 'warn',
      message: 'Only the bounding box is available; polygon shape, concavity, and junction layout are approximate.'
    });
  }
  if (analysis?.primitive === 'surface_polygon' && !analysis.horizontal) {
    uncertainties.push({
      type: 'surface.not_horizontal',
      severity: 'warn',
      message: 'The selected surface is not confidently horizontal, so road-surface semantics are weak.'
    });
  }
  const road = hypotheses.find((item) => item.type.includes('road'));
  if (road?.requires_confirmation) {
    uncertainties.push({
      type: 'semantics.needs_confirmation',
      severity: 'info',
      message: `Road interpretation confidence is ${road.confidence}; downstream generators should ask for missing semantics before applying regulated edits.`
    });
  }
  if (analysis?.primitive === 'edge_polyline') {
    uncertainties.push({
      type: 'geometry.edge_only',
      severity: 'warn',
      message: 'A selected edge can identify a boundary or centerline candidate, but cannot define a full road surface width by itself.'
    });
  }
  return uncertainties;
}

function aggregateAnalysis(entities) {
  const boxes = entities.map((entity) => entity.geometry?.bbox_2d).filter(Boolean);
  const hypotheses = entities.flatMap((entity) => entity.hypotheses.map((hypothesis) => ({
    entity_index: entity.index,
    entity_id: entity.reference.id,
    ...hypothesis
  }))).sort((a, b) => b.confidence - a.confidence);
  return {
    entity_count: entities.length,
    geometry_types: countBy(entities.map((entity) => entity.geometry.type)),
    bbox_2d: boxes.length ? roundBox(mergeBoxes(boxes)) : null,
    top_hypotheses: hypotheses.slice(0, 5)
  };
}

function centerlineFromOrientedExtent(analysis) {
  const extent = analysis.oriented_extent;
  const center = bboxCenter(analysis.bbox_2d);
  const radians = extent.angle_degrees * Math.PI / 180;
  const half = extent.length_mm / 2;
  const dx = Math.cos(radians) * half;
  const dy = Math.sin(radians) * half;
  return {
    type: 'single_segment_estimate',
    start: [round(center[0] - dx), round(center[1] - dy)],
    end: [round(center[0] + dx), round(center[1] + dy)]
  };
}

function analyzeBoundarySegments(points) {
  const signedArea = polygonSignedArea(points);
  const orientation = signedArea >= 0 ? 'counterclockwise' : 'clockwise';
  const segments = polylineSegments(points, { closed: true });
  let concave = 0;
  let convex = 0;
  let collinear = 0;
  const orientationSign = signedArea >= 0 ? 1 : -1;
  const scale = Math.max(1, polygonPerimeter(points));
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const turn = cross(previous, current, next);
    if (Math.abs(turn) <= scale * 1e-6) {
      collinear += 1;
    } else if (Math.sign(turn) === orientationSign) {
      convex += 1;
    } else {
      concave += 1;
    }
  }

  return {
    orientation,
    segment_count: segments.length,
    dominant_axes_degrees: dominantAxes(segments),
    longest_segments: segments.slice().sort((a, b) => b.length_mm - a.length_mm).slice(0, 8),
    concave_vertex_count: concave,
    convex_vertex_count: convex,
    collinear_vertex_count: collinear
  };
}

function polylineSegments(points, { closed = false } = {}) {
  const segments = [];
  const count = closed ? points.length : Math.max(0, points.length - 1);
  for (let index = 0; index < count; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const vector = [end[0] - start[0], end[1] - start[1]];
    const length = Math.hypot(vector[0], vector[1]);
    if (length <= 1e-6) continue;
    const heading = headingDegrees(vector);
    segments.push({
      index,
      start: start.map((value) => round(value)),
      end: end.map((value) => round(value)),
      length_mm: round(length),
      heading_degrees: round(heading, 3),
      axis_degrees: round(normalizeAxisDegrees(heading), 3)
    });
  }
  return segments;
}

function dominantAxes(segments) {
  const clusters = [];
  for (const segment of segments) {
    const axis = segment.axis_degrees;
    const existing = clusters.find((cluster) => angleDelta180(cluster.axis, axis) <= 7.5);
    if (existing) {
      existing.weight += segment.length_mm;
      existing.axis = ((existing.axis * (existing.weight - segment.length_mm)) + axis * segment.length_mm) / existing.weight;
    } else {
      clusters.push({ axis, weight: segment.length_mm });
    }
  }
  return clusters
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((cluster) => ({
      axis_degrees: round(normalizeAxisDegrees(cluster.axis), 3),
      total_length_mm: round(cluster.weight)
    }));
}

function estimateCorridorWidths(points, orientedBox) {
  const frame = roadGraphFrame(points, orientedBox);
  const localPoints = points.map((point) => toRoadLocal(point, frame));
  const localBox = minimumOrientedBox(localPoints);
  const axisCandidates = filterCorridorPairOutliers(axisAlignedCorridorPairs(localPoints, localBox)).map((pair) => pair.width);
  if (axisCandidates.length) return uniqueSortedWidths(axisCandidates);
  const edgeLengths = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const length = distance2(a, b);
    if (length > 1e-6) edgeLengths.push(length);
  }
  if (!edgeLengths.length) return orientedBox.width ? [orientedBox.width] : [];
  const sorted = edgeLengths.sort((a, b) => a - b);
  const minimumUseful = Math.max(1000, (orientedBox.width || 0) * 0.03);
  const useful = sorted.filter((length) => length >= minimumUseful);
  const lowerQuartile = useful.length
    ? useful[Math.max(0, Math.floor((useful.length - 1) * 0.25))]
    : sorted[Math.max(0, Math.floor((sorted.length - 1) * 0.25))];
  const candidates = useful.filter((length) => length >= lowerQuartile * 0.7 && length <= lowerQuartile * 1.3);
  const candidate = candidates.length ? median(candidates) : lowerQuartile;
  if (!Number.isFinite(candidate) || candidate <= 0) return orientedBox.width ? [orientedBox.width] : [];
  return uniqueSortedWidths([Math.min(orientedBox.width || candidate, candidate)]);
}

function axisAlignedCorridorPairs(points, orientedBox) {
  const segments = [];
  const minLongEdge = Math.max(1500, Math.min(orientedBox.length || 0, orientedBox.width || 0) * 0.08);
  const axisTolerance = 0.015;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < minLongEdge) continue;
    if (Math.abs(dy) <= Math.max(1, length * axisTolerance)) {
      segments.push({
        axis: 'horizontal',
        coord: (a[1] + b[1]) / 2,
        min: Math.min(a[0], b[0]),
        max: Math.max(a[0], b[0]),
        length
      });
    } else if (Math.abs(dx) <= Math.max(1, length * axisTolerance)) {
      segments.push({
        axis: 'vertical',
        coord: (a[0] + b[0]) / 2,
        min: Math.min(a[1], b[1]),
        max: Math.max(a[1], b[1]),
        length
      });
    }
  }

  const candidates = [];
  for (const axis of ['horizontal', 'vertical']) {
    const axisSegments = segments.filter((segment) => segment.axis === axis);
    for (let i = 0; i < axisSegments.length; i += 1) {
      for (let j = i + 1; j < axisSegments.length; j += 1) {
        const a = axisSegments[i];
        const b = axisSegments[j];
        const width = Math.abs(a.coord - b.coord);
        if (!Number.isFinite(width) || width < 1500 || width > 45000) continue;
        const overlap = intervalOverlap(a.min, a.max, b.min, b.max);
        const overlapRatio = overlap / Math.max(1, Math.min(a.length, b.length));
        if (overlapRatio < 0.18) continue;
        candidates.push({
          axis,
          width,
          center: (a.coord + b.coord) / 2,
          start: Math.max(a.min, b.min),
          end: Math.min(a.max, b.max),
          overlap,
          boundaries: [a, b]
        });
      }
    }
  }
  return uniqueCorridorPairs(candidates);
}

function filterCorridorPairOutliers(pairs) {
  if (pairs.length < 2) return pairs;
  const widths = uniqueSortedWidths(pairs.map((pair) => pair.width));
  const minWidth = widths[0];
  if (!minWidth) return pairs;

  return pairs.filter((pair) => {
    if (pair.width <= minWidth * 2.2) return true;
    return widthSupport(pair.width, pairs) >= 2;
  });
}

function widthSupport(width, pairs) {
  return pairs.filter((pair) => Math.abs(pair.width - width) <= Math.max(50, width * 0.02)).length;
}

function roadGraphFrame(points, orientedBox) {
  const box = bbox2d(points);
  return {
    origin: bboxCenter(box),
    angle_degrees: round(orientedBox.longAxisAngle * 180 / Math.PI, 3),
    angle_radians: orientedBox.longAxisAngle || 0
  };
}

function toRoadLocal(point, frame) {
  const c = Math.cos(frame.angle_radians);
  const s = Math.sin(frame.angle_radians);
  const x = point[0] - frame.origin[0];
  const y = point[1] - frame.origin[1];
  return [
    x * c + y * s,
    -x * s + y * c
  ];
}

function fromRoadLocal(point, frame) {
  const c = Math.cos(frame.angle_radians);
  const s = Math.sin(frame.angle_radians);
  return [
    frame.origin[0] + point[0] * c - point[1] * s,
    frame.origin[1] + point[0] * s + point[1] * c
  ];
}

function vectorFromRoadLocal(vector, frame) {
  const c = Math.cos(frame.angle_radians);
  const s = Math.sin(frame.angle_radians);
  return [
    vector[0] * c - vector[1] * s,
    vector[0] * s + vector[1] * c
  ];
}

function inferRoadGraph(points, corridorWidths, orientedBox) {
  const frame = roadGraphFrame(points, orientedBox);
  const localPoints = points.map((point) => toRoadLocal(point, frame));
  const localBox = minimumOrientedBox(localPoints);
  const pairs = filterCorridorPairOutliers(axisAlignedCorridorPairs(localPoints, localBox));
  if (!pairs.length) {
    return {
      kind: 'road_graph_estimate',
      confidence: 0,
      coordinate_system: 'oriented selection-local XY',
      frame: {
        origin: frame.origin.map((value) => round(value)),
        angle_degrees: frame.angle_degrees
      },
      segments: [],
      intersections: [],
      approaches: [],
      limitations: ['no paired corridor boundaries detected in the oriented road frame']
    };
  }
  const merged = mergeCorridorPairs(pairs);
  const connected = connectRoadSegments(merged);
  const intersections = connected.intersections.map((intersection, index) => roadIntersectionSnapshot(intersection, index, frame));
  const segments = connected.segments.map((segment, index) => roadSegmentSnapshot(segment, index, frame));
  const approaches = inferApproaches(segments, intersections);
  const confidence = graphConfidence(segments, intersections, corridorWidths);
  return {
    kind: 'road_graph_estimate',
    confidence,
    coordinate_system: 'model XY with oriented road-frame inference',
    frame: {
      origin: frame.origin.map((value) => round(value)),
      angle_degrees: frame.angle_degrees
    },
    segments,
    intersections,
    approaches,
    limitations: [
      'orthogonal corridor heuristic in an oriented local frame',
      'centerlines are inferred from paired boundary segments',
      'traffic direction, lane count, and regulated traffic-control placement are not inferred'
    ]
  };
}

function uniqueCorridorPairs(pairs) {
  const sorted = pairs
    .filter((pair) => Number.isFinite(pair.width) && pair.width > 0 && pair.end > pair.start)
    .sort((a, b) => a.width - b.width || b.overlap - a.overlap);
  const result = [];
  for (const pair of sorted) {
    const duplicate = result.some((existing) => (
      existing.axis === pair.axis &&
      Math.abs(existing.width - pair.width) <= Math.max(50, existing.width * 0.02) &&
      Math.abs(existing.center - pair.center) <= Math.max(50, existing.width * 0.05) &&
      intervalOverlap(existing.start, existing.end, pair.start, pair.end) >= Math.min(existing.end - existing.start, pair.end - pair.start) * 0.8
    ));
    if (!duplicate) result.push(pair);
  }
  return result;
}

function mergeCorridorPairs(pairs) {
  const sorted = [...pairs].sort((a, b) => a.axis.localeCompare(b.axis) || a.width - b.width || a.center - b.center || a.start - b.start);
  const merged = [];
  for (const pair of sorted) {
    const existing = merged.find((segment) => (
      segment.axis === pair.axis &&
      Math.abs(segment.width - pair.width) <= Math.max(100, segment.width * 0.05) &&
      Math.abs(segment.center - pair.center) <= Math.max(250, segment.width * 0.08) &&
      pair.start - segment.end <= Math.max(10000, segment.width * 1.5)
    ));
    if (existing) {
      existing.start = Math.min(existing.start, pair.start);
      existing.end = Math.max(existing.end, pair.end);
      existing.source_pair_count += 1;
      existing.observed_ranges.push([pair.start, pair.end]);
    } else {
      merged.push({
        axis: pair.axis,
        width: pair.width,
        center: pair.center,
        start: pair.start,
        end: pair.end,
        source_pair_count: 1,
        observed_ranges: [[pair.start, pair.end]]
      });
    }
  }
  return merged
    .filter((segment) => segment.end > segment.start)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start));
}

function connectRoadSegments(segments) {
  const result = segments.map((segment) => ({ ...segment, extended_start: false, extended_end: false }));
  const intersections = [];
  for (const horizontal of result.filter((segment) => segment.axis === 'horizontal')) {
    for (const vertical of result.filter((segment) => segment.axis === 'vertical')) {
      const point = [vertical.center, horizontal.center];
      const xInside = point[0] >= horizontal.start && point[0] <= horizontal.end;
      const yInside = point[1] >= vertical.start && point[1] <= vertical.end;
      let confidence = 0;
      let connection = null;
      if (xInside && yInside) {
        confidence = 0.85;
        connection = 'centerline_crossing';
      } else if (xInside) {
        const gapToStart = Math.abs(point[1] - vertical.start);
        const gapToEnd = Math.abs(point[1] - vertical.end);
        const maxGap = Math.max(horizontal.width, vertical.width, 12000);
        if (point[1] < vertical.start && gapToStart <= maxGap) {
          vertical.start = point[1];
          vertical.extended_start = true;
          confidence = 0.65;
          connection = 'inferred_gap_bridge_to_segment_start';
        } else if (point[1] > vertical.end && gapToEnd <= maxGap) {
          vertical.end = point[1];
          vertical.extended_end = true;
          confidence = 0.65;
          connection = 'inferred_gap_bridge_to_segment_end';
        }
      } else if (yInside) {
        const gapToStart = Math.abs(point[0] - horizontal.start);
        const gapToEnd = Math.abs(point[0] - horizontal.end);
        const maxGap = Math.max(horizontal.width, vertical.width, 12000);
        if (point[0] < horizontal.start && gapToStart <= maxGap) {
          horizontal.start = point[0];
          horizontal.extended_start = true;
          confidence = 0.65;
          connection = 'inferred_gap_bridge_to_segment_start';
        } else if (point[0] > horizontal.end && gapToEnd <= maxGap) {
          horizontal.end = point[0];
          horizontal.extended_end = true;
          confidence = 0.65;
          connection = 'inferred_gap_bridge_to_segment_end';
        }
      }
      if (confidence > 0) {
        intersections.push({
          id: `intersection_${intersections.length + 1}`,
          type: 'orthogonal_branch_candidate',
          point: point.map((value) => round(value)),
          connected_axes: ['horizontal', 'vertical'],
          connection,
          confidence: round(confidence, 3)
        });
      }
    }
  }
  return { segments: result, intersections: dedupeIntersections(intersections) };
}

function dedupeIntersections(intersections) {
  const result = [];
  for (const intersection of intersections) {
    const duplicate = result.find((existing) => distance2(existing.point, intersection.point) <= 100);
    if (!duplicate) {
      result.push(intersection);
    } else if (intersection.confidence > duplicate.confidence) {
      duplicate.connection = intersection.connection;
      duplicate.confidence = intersection.confidence;
    }
  }
  return result.map((intersection, index) => ({
    ...intersection,
    id: `intersection_${index + 1}`
  }));
}

function roadIntersectionSnapshot(intersection, index, frame) {
  const point = fromRoadLocal(intersection.point, frame);
  return {
    ...intersection,
    id: `intersection_${index + 1}`,
    point: point.map((value) => round(value)),
    local_point: intersection.point.map((value) => round(value))
  };
}

function roadSegmentSnapshot(segment, index, frame) {
  const horizontal = segment.axis === 'horizontal';
  const localStart = horizontal ? [segment.start, segment.center] : [segment.center, segment.start];
  const localEnd = horizontal ? [segment.end, segment.center] : [segment.center, segment.end];
  const start = fromRoadLocal(localStart, frame);
  const end = fromRoadLocal(localEnd, frame);
  const direction = unitVector([end[0] - start[0], end[1] - start[1]]);
  const normal = [-direction[1], direction[0]];
  const localHeading = horizontal ? 0 : 90;
  return {
    id: `road_segment_${index + 1}`,
    axis: segment.axis,
    local_axis: segment.axis,
    width_mm: round(segment.width),
    length_mm: round(segment.end - segment.start),
    heading_degrees: round(headingDegrees(direction), 3),
    local_heading_degrees: localHeading,
    direction_vector: roundVector(direction),
    normal_vector: roundVector(normal),
    centerline: {
      type: Math.abs(frame.angle_degrees % 180) <= 0.001 ? 'axis_aligned_segment' : 'oriented_segment',
      start: start.map((value) => round(value)),
      end: end.map((value) => round(value)),
      local_start: localStart.map((value) => round(value)),
      local_end: localEnd.map((value) => round(value))
    },
    observed_ranges: segment.observed_ranges.map((range) => range.map((value) => round(value))),
    source_pair_count: segment.source_pair_count,
    extended_to_intersection: Boolean(segment.extended_start || segment.extended_end)
  };
}

function inferApproaches(segments, intersections) {
  const approaches = [];
  const nodes = intersections.map((intersection) => intersection.point);
  for (const segment of segments) {
    for (const endpointName of ['start', 'end']) {
      const point = segment.centerline[endpointName];
      const touchesIntersection = nodes.some((node) => distance2(point, node) <= Math.max(100, segment.width_mm * 0.05));
      if (touchesIntersection) continue;
      const linked = nearestIntersectionOnSegment(segment, point, intersections);
      const outwardVector = linked
        ? unitVector([point[0] - linked.point[0], point[1] - linked.point[1]])
        : endpointOutwardVector(segment, endpointName);
      const travelVector = [-outwardVector[0], -outwardVector[1]];
      approaches.push({
        id: `approach_${approaches.length + 1}`,
        segment_id: segment.id,
        endpoint: endpointName,
        point,
        connected_intersection_id: linked?.id || null,
        distance_to_intersection_mm: linked ? round(distance2(point, linked.point)) : null,
        direction: directionLabel(outwardVector),
        heading_degrees: round(headingDegrees(outwardVector), 3),
        direction_vector: roundVector(outwardVector),
        travel_heading_degrees: round(headingDegrees(travelVector), 3),
        travel_vector: roundVector(travelVector),
        width_mm: segment.width_mm,
        confidence: segment.extended_to_intersection ? 0.68 : 0.78
      });
    }
  }
  return approaches;
}

function nearestIntersectionOnSegment(segment, endpoint, intersections) {
  const tolerance = Math.max(200, segment.width_mm * 0.12);
  const candidates = intersections
    .filter((intersection) => pointOnSegment(intersection.point, segment.centerline.start, segment.centerline.end, tolerance))
    .map((intersection) => ({ ...intersection, distance: distance2(endpoint, intersection.point) }))
    .filter((intersection) => intersection.distance > tolerance)
    .sort((a, b) => a.distance - b.distance);
  return candidates[0] || null;
}

function endpointOutwardVector(segment, endpointName) {
  const vector = segment.direction_vector || unitVector([
    segment.centerline.end[0] - segment.centerline.start[0],
    segment.centerline.end[1] - segment.centerline.start[1]
  ]);
  return endpointName === 'start' ? [-vector[0], -vector[1]] : vector;
}

function graphConfidence(segments, intersections, corridorWidths) {
  if (!segments.length) return 0;
  let confidence = 0.35;
  if (segments.length >= 1) confidence += 0.15;
  if (corridorWidths.length) confidence += 0.15;
  if (intersections.length) confidence += 0.2;
  if (segments.some((segment) => segment.extended_to_intersection)) confidence -= 0.08;
  return round(clamp(confidence, 0, 0.9), 3);
}

function intervalOverlap(aMin, aMax, bMin, bMax) {
  return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
}

function uniqueSortedWidths(widths) {
  const sorted = widths
    .filter((width) => Number.isFinite(width) && width > 0)
    .sort((a, b) => a - b);
  const result = [];
  for (const width of sorted) {
    if (!result.some((existing) => Math.abs(existing - width) <= Math.max(50, existing * 0.02))) {
      result.push(width);
    }
  }
  return result.slice(0, 5);
}

function minimumOrientedBox(points) {
  if (!points.length) return { length: 0, width: 0, area: 0, longAxisAngle: 0 };
  const angles = new Set(['0']);
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.hypot(dx, dy) < 1e-6) continue;
    const normalized = normalizeAngle(Math.atan2(dy, dx));
    angles.add(normalized.toFixed(8));
  }
  let best = null;
  for (const raw of angles) {
    const angle = Number(raw);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const projections = points.map((point) => ({
      u: point[0] * c + point[1] * s,
      v: -point[0] * s + point[1] * c
    }));
    const minU = Math.min(...projections.map((point) => point.u));
    const maxU = Math.max(...projections.map((point) => point.u));
    const minV = Math.min(...projections.map((point) => point.v));
    const maxV = Math.max(...projections.map((point) => point.v));
    const u = maxU - minU;
    const v = maxV - minV;
    const area = u * v;
    if (!best || area < best.area) {
      best = {
        u,
        v,
        area,
        angle
      };
    }
  }
  const uLong = best.u >= best.v;
  return {
    length: Math.max(best.u, best.v),
    width: Math.min(best.u, best.v),
    area: best.area,
    longAxisAngle: normalizeAngle(uLong ? best.angle : best.angle + Math.PI / 2)
  };
}

function normalizeAngle(angle) {
  let value = angle % Math.PI;
  if (value < 0) value += Math.PI;
  return value;
}

function polygonSignedArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function polygonPerimeter(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    sum += distance2(points[index], points[(index + 1) % points.length]);
  }
  return sum;
}

function polylineLength(points) {
  let sum = 0;
  for (let index = 1; index < points.length; index += 1) {
    sum += distance2(points[index - 1], points[index]);
  }
  return sum;
}

function bbox2d(points) {
  return {
    min: [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
    max: [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))]
  };
}

function mergeBoxes(boxes) {
  return {
    min: [
      Math.min(...boxes.map((box) => box.min[0])),
      Math.min(...boxes.map((box) => box.min[1]))
    ],
    max: [
      Math.max(...boxes.map((box) => box.max[0])),
      Math.max(...boxes.map((box) => box.max[1]))
    ]
  };
}

function roundBox(box) {
  return {
    min: box.min.map((value) => round(value)),
    max: box.max.map((value) => round(value)),
    w: round(box.max[0] - box.min[0]),
    d: round(box.max[1] - box.min[1])
  };
}

function bboxCenter(box) {
  return [
    round((box.min[0] + box.max[0]) / 2),
    round((box.min[1] + box.max[1]) / 2)
  ];
}

function convexHull(points) {
  const sorted = [...points]
    .map((point) => [point[0], point[1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 1) return sorted;
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function distance2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function pointOnSegment(point, start, end, tolerance = 100) {
  const segment = [end[0] - start[0], end[1] - start[1]];
  const lengthSquared = segment[0] ** 2 + segment[1] ** 2;
  if (lengthSquared <= 1e-9) return distance2(point, start) <= tolerance;
  const t = ((point[0] - start[0]) * segment[0] + (point[1] - start[1]) * segment[1]) / lengthSquared;
  if (t < -0.01 || t > 1.01) return false;
  const projected = [start[0] + segment[0] * t, start[1] + segment[1] * t];
  return distance2(point, projected) <= tolerance;
}

function unitVector(vector) {
  if (!Array.isArray(vector) || vector.length < 2) return null;
  const length = Math.hypot(Number(vector[0]), Number(vector[1]));
  if (!Number.isFinite(length) || length <= 1e-9) return null;
  return [Number(vector[0]) / length, Number(vector[1]) / length];
}

function roundVector(vector) {
  return vector ? vector.map((value) => round(value, 6)) : null;
}

function headingDegrees(vector) {
  if (!vector) return null;
  return normalizeDegrees(Math.atan2(vector[1], vector[0]) * 180 / Math.PI);
}

function normalizeDegrees(value) {
  let result = Number(value) % 360;
  if (result < 0) result += 360;
  return result;
}

function normalizeAxisDegrees(value) {
  let result = normalizeDegrees(value) % 180;
  if (result < 0) result += 180;
  return result;
}

function angleDelta180(a, b) {
  const diff = Math.abs(normalizeAxisDegrees(a) - normalizeAxisDegrees(b));
  return Math.min(diff, 180 - diff);
}

function directionLabel(vector) {
  const heading = headingDegrees(vector);
  if (heading === null) return 'unknown';
  const labels = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
  const index = Math.round(heading / 45) % labels.length;
  return labels[index];
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}
