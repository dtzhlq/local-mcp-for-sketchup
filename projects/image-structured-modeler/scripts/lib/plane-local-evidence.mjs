import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { buildStructureLineEvidence } from './opencv-structure-line-backend.mjs';

export const PLANE_LOCAL_EVIDENCE_KIND = 'plane_local_evidence_graph_v1';

export async function buildPlaneLocalEvidencePackage({
  sourceImagePath,
  sourceImage,
  facadePlaneGraph,
  outputDir,
  planeFrames = new Map(),
  sourceFacadePlaneGraph = 'facade-plane-graph.json'
} = {}) {
  if (!sourceImagePath) throw new Error('sourceImagePath is required');
  if (!facadePlaneGraph) throw new Error('facadePlaneGraph is required');
  if (!outputDir) throw new Error('outputDir is required');
  await fs.mkdir(outputDir, { recursive: true });

  const source = await sharp(sourceImagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const coordinateReference = resolveCoordinateReference({
    facadePlaneGraph,
    sourceImage: sourceImage || sourceImagePath,
    sourceWidth: source.info.width,
    sourceHeight: source.info.height
  });
  const sourceToReferenceTransform = [
    [coordinateReference.width / source.info.width, 0, 0],
    [0, coordinateReference.height / source.info.height, 0],
    [0, 0, 1]
  ];
  const planeEntries = [];
  const manifestPlanes = [];
  const workbenchPlanes = [];
  for (const plane of facadePlaneGraph.planes || []) {
    const frame = planeFrames.get(plane.id) || null;
    const dimensions = rectifiedDimensions({ plane, frame });
    const upstreamImageToLocalHomography = plane.rectification.image_to_local_homography;
    const imageToLocalHomography = multiply3x3(upstreamImageToLocalHomography, sourceToReferenceTransform);
    const localToImageHomography = invert3x3(imageToLocalHomography);
    const rectifiedBuffer = rectifyPlaneRaster({
      sourceData: source.data,
      sourceWidth: source.info.width,
      sourceHeight: source.info.height,
      channels: source.info.channels,
      localToImageHomography,
      width: dimensions.width,
      height: dimensions.height
    });
    const baseName = safeFileName(plane.id);
    const rectifiedImageName = `${baseName}.png`;
    const rectifiedImagePath = path.join(outputDir, rectifiedImageName);
    await sharp(rectifiedBuffer, {
      raw: { width: dimensions.width, height: dimensions.height, channels: 4 }
    }).png().toFile(rectifiedImagePath);

    const lineEvidence = await buildStructureLineEvidence({
      sourceImagePath: rectifiedImagePath,
      sourceImage: rectifiedImageName,
      maxWidth: dimensions.width,
      seedLimit: 72
    });
    const edgeEvidence = buildLocalEdgeEvidence({ plane, lineEvidence, dimensions });
    const cornerEvidence = buildLocalCornerEvidence({ plane, edgeEvidence, dimensions });
    const repetitionHypotheses = buildRepetitionHypotheses({ plane, edgeEvidence });
    const regionCandidates = buildRegionCandidates({
      plane,
      detailCandidates: facadePlaneGraph.plane_local_detail_candidates || [],
      edgeEvidence
    });
    const detailInstanceProposals = buildDetailInstanceProposals({
      plane,
      edgeEvidence,
      regionCandidates
    });
    const planeEntry = {
      id: `plane_local_${safeFileName(plane.id)}`,
      source_plane_id: plane.id,
      rectification: {
        source_plane_id: plane.id,
        image_to_local_homography: imageToLocalHomography,
        local_to_image_homography: localToImageHomography,
        upstream_image_to_local_homography: upstreamImageToLocalHomography,
        source_coordinate_reference: coordinateReference,
        source_raster_size: { width: source.info.width, height: source.info.height },
        coordinate_transform: {
          source_to_reference_homography: sourceToReferenceTransform,
          source_to_reference_scale: [
            round(coordinateReference.width / source.info.width, 8),
            round(coordinateReference.height / source.info.height, 8)
          ],
          reference_to_source_scale: [
            round(source.info.width / coordinateReference.width, 8),
            round(source.info.height / coordinateReference.height, 8)
          ]
        },
        rectified_image: rectifiedImageName,
        width: dimensions.width,
        height: dimensions.height,
        metric_scale_status: plane.rectification.metric_scale_status || 'unknown_single_view'
      },
      edge_evidence: edgeEvidence,
      corner_evidence: cornerEvidence,
      repetition_hypotheses: repetitionHypotheses,
      region_candidates: regionCandidates,
      detail_instance_proposals: detailInstanceProposals,
      unknown_regions: [
        { id: `${plane.id}:occluded_or_outside_visible_quad`, reason: 'single_view_visible_plane_extent_only' },
        { id: `${plane.id}:metric_scale`, reason: 'accepted_metric_scale_anchor_required' }
      ],
      qa: {
        status: edgeEvidence.filter((edge) => edge.review_status === 'candidate').length >= 8
          ? 'ready_for_plane_local_review'
          : 'insufficient_local_structure_evidence',
        raw_segment_count: lineEvidence.summary.raw_segment_count,
        eligible_segment_count: lineEvidence.summary.eligible_segment_count,
        seed_segment_count: lineEvidence.summary.seed_segment_count,
        edge_evidence_count: edgeEvidence.length,
        corner_evidence_count: cornerEvidence.length,
        repetition_hypothesis_count: repetitionHypotheses.length,
        region_candidate_count: regionCandidates.length,
        detail_instance_proposal_count: detailInstanceProposals.length,
        backend: lineEvidence.backend.id
      },
      review_required: true,
      promotion_allowed: false
    };
    const pngBuffer = await fs.readFile(rectifiedImagePath);
    const overlaySvg = renderPlaneLocalEvidenceOverlaySvg({ planeEntry, pngBuffer });
    const overlaySvgName = `${baseName}.evidence.svg`;
    const overlayPngName = `${baseName}.evidence.png`;
    await Promise.all([
      fs.writeFile(path.join(outputDir, overlaySvgName), overlaySvg, 'utf8'),
      sharp(Buffer.from(overlaySvg)).png().toFile(path.join(outputDir, overlayPngName)),
      writeJson(path.join(outputDir, `${baseName}.line-evidence.json`), lineEvidence)
    ]);
    planeEntries.push(planeEntry);
    manifestPlanes.push({
      plane_id: plane.id,
      rectified_image: rectifiedImageName,
      evidence_overlay: overlayPngName,
      line_evidence: `${baseName}.line-evidence.json`,
      edge_evidence_count: edgeEvidence.length,
      corner_evidence_count: cornerEvidence.length,
      repetition_hypothesis_count: repetitionHypotheses.length,
      region_candidate_ids: regionCandidates.map((candidate) => candidate.id),
      detail_instance_proposal_ids: detailInstanceProposals.map((proposal) => proposal.id),
      promotion_allowed: false
    });
    workbenchPlanes.push({ planeEntry, overlaySvg });
  }

  const graph = {
    kind: PLANE_LOCAL_EVIDENCE_KIND,
    version: 1,
    coordinate_convention: 'plane_local_u_right_v_down',
    source_image: sourceImage || sourceImagePath,
    source_facade_plane_graph: sourceFacadePlaneGraph,
    planes: planeEntries,
    review_policy: {
      status: 'needs_plane_local_review',
      accepted_plane_local_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers: [
        'accepted_plane_local_evidence_review_required',
        'accepted_local_detail_review_required',
        'accepted_reprojection_qa_required'
      ]
    },
    summary: summarizeGraph(planeEntries)
  };
  const pendingReview = buildPendingPlaneLocalEvidenceReview({ graph });
  const manifest = {
    kind: 'plane_local_evidence_artifact_manifest_v1',
    version: 1,
    source_graph: 'plane-local-evidence-graph.json',
    review_decision: 'plane-local-evidence-review.pending.json',
    promotion_allowed: false,
    planes: manifestPlanes
  };
  await Promise.all([
    writeJson(path.join(outputDir, 'plane-local-evidence-graph.json'), graph),
    writeJson(path.join(outputDir, 'plane-local-evidence-review.pending.json'), pendingReview),
    writeJson(path.join(outputDir, 'manifest.json'), manifest),
    fs.writeFile(path.join(outputDir, 'index.html'), renderPlaneLocalEvidenceWorkbenchHtml({ graph, planes: workbenchPlanes }), 'utf8')
  ]);
  return { graph, pendingReview, manifest };
}

export function buildPendingPlaneLocalEvidenceReview({ graph } = {}) {
  return {
    kind: 'plane_local_evidence_review_decision_v1',
    version: 1,
    source_plane_local_evidence_graph: 'plane-local-evidence-graph.json',
    reviewer: 'plane-local-evidence-review-template',
    status: 'not_accepted',
    plane_decisions: (graph?.planes || []).map((plane) => ({ id: plane.source_plane_id, status: 'rejected', note: 'Pending explicit review; template rejection is fail-closed.' })),
    edge_decisions: [],
    corner_decisions: [],
    repetition_decisions: [],
    region_decisions: [],
    promotion_allowed: false,
    compile_allowed: false,
    blockers: ['accepted_plane_local_evidence_review_required'],
    notes: ['No plane-local edge, corner, repetition, or region candidate is accepted by default.']
  };
}

export function renderPlaneLocalEvidenceOverlaySvg({ planeEntry, pngBuffer } = {}) {
  const width = planeEntry.rectification.width;
  const height = planeEntry.rectification.height;
  const headerHeight = 58;
  const candidateEdges = planeEntry.edge_evidence
    .filter((edge) => edge.review_status === 'candidate')
    .sort((left, right) => right.support_score - left.support_score)
    .slice(0, 180);
  const edgeShapes = candidateEdges.map((edge) => {
    const color = edge.orientation_class === 'local_u'
      ? '#e11d48'
      : edge.orientation_class === 'local_v'
        ? '#0891b2'
        : '#64748b';
    return `<line data-layer="plane-local-edge" data-edge-id="${edge.id}" x1="${edge.line_px[0][0]}" y1="${edge.line_px[0][1]}" x2="${edge.line_px[1][0]}" y2="${edge.line_px[1][1]}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.78"/>`;
  }).join('\n');
  const cornerShapes = planeEntry.corner_evidence.slice(0, 120).map((corner) => (
    `<circle data-layer="plane-local-corner" data-corner-id="${corner.id}" cx="${corner.point_px[0]}" cy="${corner.point_px[1]}" r="3" fill="#7c3aed" stroke="#fff" stroke-width="1"/>`
  )).join('\n');
  const regionShapes = planeEntry.region_candidates.map((candidate) => {
    const points = candidate.quad_uv.map(([u, v]) => `${round(u * width)},${round(v * height)}`).join(' ');
    return `<polygon data-layer="plane-local-region-candidate" data-region-id="${candidate.id}" points="${points}" fill="#f59e0b" fill-opacity="0.08" stroke="#f59e0b" stroke-width="3" stroke-dasharray="10 7"/>`;
  }).join('\n');
  const repetitionShapes = planeEntry.repetition_hypotheses.flatMap((hypothesis) => (
    hypothesis.line_positions_uv.map((position) => hypothesis.axis === 'u'
      ? `<line data-layer="plane-local-repetition" data-repetition-id="${hypothesis.id}" x1="${round(position * width)}" y1="0" x2="${round(position * width)}" y2="${height}" stroke="#16a34a" stroke-width="1" stroke-dasharray="5 6"/>`
      : `<line data-layer="plane-local-repetition" data-repetition-id="${hypothesis.id}" x1="0" y1="${round(position * height)}" x2="${width}" y2="${round(position * height)}" stroke="#16a34a" stroke-width="1" stroke-dasharray="5 6"/>`
    )
  )).join('\n');
  const proposalShapes = planeEntry.detail_instance_proposals.map((proposal) => {
    const points = proposal.quad_uv.map(([u, v]) => `${round(u * width)},${round(v * height)}`).join(' ');
    const color = proposal.proposal_type === 'opening_rect'
      ? '#2563eb'
      : proposal.proposal_type === 'equipment_rect'
        ? '#c026d3'
        : '#ea580c';
    return `<polygon data-layer="plane-local-detail-proposal" data-proposal-id="${proposal.id}" points="${points}" fill="${color}" fill-opacity="0.1" stroke="${color}" stroke-width="2"/>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + headerHeight}" viewBox="0 0 ${width} ${height + headerHeight}">
  <rect width="${width}" height="${height + headerHeight}" fill="#111827"/>
  <text x="14" y="22" font-family="ui-monospace, monospace" font-size="14" fill="#fff">${planeEntry.source_plane_id}</text>
  <text x="14" y="43" font-family="ui-monospace, monospace" font-size="12" fill="#fbbf24">plane-local evidence / review_required=true / promotion_allowed=false</text>
  <g transform="translate(0 ${headerHeight})">
    <image href="data:image/png;base64,${pngBuffer.toString('base64')}" width="${width}" height="${height}"/>
    <g data-layer="plane-local-edge-evidence">${edgeShapes}</g>
    <g data-layer="plane-local-repetition-hypotheses">${repetitionShapes}</g>
    <g data-layer="plane-local-corner-evidence">${cornerShapes}</g>
    <g data-layer="plane-local-region-candidates">${regionShapes}</g>
    <g data-layer="plane-local-detail-proposals">${proposalShapes}</g>
  </g>
</svg>`;
}

function buildLocalEdgeEvidence({ plane, lineEvidence, dimensions }) {
  return (lineEvidence.raw_segments || []).map((segment) => {
    const orientationClass = localOrientation(segment.angle_deg);
    const eligible = segment.eligible === true;
    const linePx = normalizeSegmentLine(segment.line_px);
    return {
      id: `${safeFileName(plane.id)}:${segment.id}`,
      source_plane_id: plane.id,
      line_px: linePx,
      line_uv: linePx.map(([x, y]) => [round(x / dimensions.width, 6), round(y / dimensions.height, 6)]),
      orientation_class: orientationClass,
      support_score: clamp(Number(segment.feature_scores?.seed_quality || 0), 0, 1),
      source: {
        kind: 'rectified_plane_raster_line',
        backend: lineEvidence.backend.id,
        backend_segment_id: segment.id,
        backend_pass_ids: segment.backend_pass_ids
      },
      review_status: eligible ? 'candidate' : 'rejected_by_eligibility',
      rejection_reasons: eligible ? [] : (segment.eligibility_reasons || []),
      review_required: true,
      promotion_allowed: false
    };
  });
}

function buildLocalCornerEvidence({ plane, edgeEvidence, dimensions }) {
  const horizontal = edgeEvidence
    .filter((edge) => edge.review_status === 'candidate' && edge.orientation_class === 'local_u')
    .sort((left, right) => right.support_score - left.support_score)
    .slice(0, 90);
  const vertical = edgeEvidence
    .filter((edge) => edge.review_status === 'candidate' && edge.orientation_class === 'local_v')
    .sort((left, right) => right.support_score - left.support_score)
    .slice(0, 90);
  const candidates = [];
  const tolerance = Math.max(7, Math.min(dimensions.width, dimensions.height) * 0.025);
  for (const uEdge of horizontal) {
    for (const vEdge of vertical) {
      const point = lineIntersection(uEdge.line_px, vEdge.line_px);
      if (!point) continue;
      if (point[0] < 0 || point[1] < 0 || point[0] > dimensions.width || point[1] > dimensions.height) continue;
      if (!pointNearSegment(point, uEdge.line_px, tolerance) || !pointNearSegment(point, vEdge.line_px, tolerance)) continue;
      candidates.push({
        point,
        sourceEdges: [uEdge, vEdge],
        support: Math.sqrt(uEdge.support_score * vEdge.support_score)
      });
    }
  }
  const deduplicated = deduplicateCorners(candidates, Math.max(6, Math.min(dimensions.width, dimensions.height) * 0.012));
  return deduplicated
    .sort((left, right) => right.support - left.support)
    .slice(0, 240)
    .map((candidate, index) => ({
      id: `${safeFileName(plane.id)}:corner_${String(index + 1).padStart(4, '0')}`,
      source_plane_id: plane.id,
      point_px: candidate.point.map((value) => round(value, 3)),
      point_uv: [round(candidate.point[0] / dimensions.width, 6), round(candidate.point[1] / dimensions.height, 6)],
      source_edge_ids: candidate.sourceEdges.map((edge) => edge.id),
      support_score: round(clamp(candidate.support, 0, 1), 4),
      review_status: 'candidate',
      review_required: true,
      promotion_allowed: false
    }));
}

function buildRepetitionHypotheses({ plane, edgeEvidence }) {
  const hypotheses = [];
  const axisConfigs = [
    { axis: 'u', orientation: 'local_v', position: (edge) => average(edge.line_uv.map((point) => point[0])) },
    { axis: 'v', orientation: 'local_u', position: (edge) => average(edge.line_uv.map((point) => point[1])) }
  ];
  for (const config of axisConfigs) {
    const edges = edgeEvidence
      .filter((edge) => edge.review_status === 'candidate' && edge.orientation_class === config.orientation && edge.support_score >= 0.2)
      .sort((left, right) => right.support_score - left.support_score)
      .slice(0, 160);
    const clusters = clusterLinePositions(edges.map((edge) => ({ edge, position: config.position(edge) })), 0.018)
      .filter((cluster) => cluster.items.length >= 2)
      .sort((left, right) => left.position - right.position);
    const sequence = bestRegularSequence(clusters);
    if (!sequence) continue;
    hypotheses.push({
      id: `${safeFileName(plane.id)}:repetition_${config.axis}_1`,
      source_plane_id: plane.id,
      axis: config.axis,
      line_positions_uv: sequence.clusters.map((cluster) => round(cluster.position, 5)),
      spacing_uv: round(sequence.spacing, 5),
      spacing_variation: round(sequence.variation, 4),
      source_edge_ids: sequence.clusters.flatMap((cluster) => cluster.items.map((item) => item.edge.id)),
      support_score: round(sequence.support, 4),
      review_status: 'candidate',
      review_required: true,
      promotion_allowed: false
    });
  }
  return hypotheses;
}

function buildRegionCandidates({ plane, detailCandidates, edgeEvidence }) {
  const semanticRegions = detailCandidates
    .filter((detail) => detail.candidate_plane_ids?.includes(plane.id))
    .map((detail) => {
      const localPoints = detail.visible_quad_px.map((point) => applyHomography(plane.rectification.image_to_local_homography, point));
      const us = localPoints.map((point) => point[0]);
      const vs = localPoints.map((point) => point[1]);
      const u0 = clamp(Math.min(...us), -0.15, 1.15);
      const u1 = clamp(Math.max(...us), -0.15, 1.15);
      const v0 = clamp(Math.min(...vs), -0.15, 1.15);
      const v1 = clamp(Math.max(...vs), -0.15, 1.15);
      const supportingEdges = edgeEvidence.filter((edge) => edge.review_status === 'candidate' && edgeTouchesRegion(edge, { u0, u1, v0, v1 }));
      const support = supportingEdges.length
        ? average(supportingEdges.map((edge) => edge.support_score))
        : 0;
      return {
        id: `plane_local_region:${detail.id}`,
        source_plane_id: plane.id,
        role_hint: detail.role,
        quad_uv: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map((point) => point.map((value) => round(value, 6))),
        source_detail_candidate_id: detail.id,
        support_score: round(clamp(support, 0, 1), 4),
        source_edge_ids: supportingEdges.slice(0, 80).map((edge) => edge.id),
        source: {
          kind: 'facade_plane_graph_detail_seed_projected_to_plane_local',
          source_semantic_evidence_id: detail.source?.semantic_evidence_id || detail.id
        },
        review_status: 'candidate',
        review_required: true,
        promotion_allowed: false,
        blockers: Array.from(new Set([
          ...(detail.blockers || []),
          'accepted_plane_local_evidence_review_required',
          'accepted_local_detail_review_required',
          'accepted_reprojection_qa_required'
        ]))
      };
    });
  if (semanticRegions.length) return semanticRegions;
  const supportingEdges = edgeEvidence.filter((edge) => edge.review_status === 'candidate');
  return [{
    id: `plane_local_region:${plane.id}:geometric_search`,
    source_plane_id: plane.id,
    role_hint: 'unclassified_plane_local_detail',
    quad_uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
    source_detail_candidate_id: `geometric_search_${plane.id}`,
    support_score: round(clamp(average(supportingEdges.map((edge) => edge.support_score)), 0, 1), 4),
    source_edge_ids: supportingEdges.slice(0, 80).map((edge) => edge.id),
    source: {
      kind: 'deterministic_full_plane_geometry_search',
      source_semantic_evidence_id: 'none_axis_aligned_geometry_only'
    },
    review_status: 'candidate',
    review_required: true,
    promotion_allowed: false,
    blockers: [
      'semantic_classification_review_required',
      'accepted_plane_local_evidence_review_required',
      'accepted_local_detail_review_required',
      'accepted_reprojection_qa_required'
    ]
  }];
}

function buildDetailInstanceProposals({ plane, edgeEvidence, regionCandidates }) {
  const horizontalBands = buildAxisBands(edgeEvidence, 'local_u');
  const verticalBands = buildAxisBands(edgeEvidence, 'local_v');
  const proposals = [];
  for (const region of regionCandidates) {
    const bounds = quadBounds(region.quad_uv);
    const proposalTypes = region.role_hint === 'unclassified_plane_local_detail'
      ? ['opening_rect', 'linear_path_strip']
      : [proposalTypeForRole(region.role_hint)];
    for (const proposalType of proposalTypes) {
      const candidates = proposalType === 'linear_path_strip'
        ? buildLinearStripProposals({ plane, region, bounds, horizontalBands, verticalBands })
        : buildRectangularDetailProposals({
          plane,
          region,
          bounds,
          horizontalBands,
          verticalBands,
          proposalType
        });
      proposals.push(...candidates);
    }
  }
  return proposals;
}

function buildAxisBands(edgeEvidence, orientationClass) {
  const axisIndex = orientationClass === 'local_v' ? 0 : 1;
  const spanIndex = orientationClass === 'local_v' ? 1 : 0;
  const items = edgeEvidence
    .filter((edge) => edge.review_status === 'candidate' && edge.orientation_class === orientationClass && edge.support_score >= 0.16)
    .map((edge) => {
      const position = average(edge.line_uv.map((point) => point[axisIndex]));
      const span = edge.line_uv.map((point) => point[spanIndex]);
      return {
        edge,
        position,
        interval: [Math.min(...span), Math.max(...span)]
      };
    })
    .filter((item) => item.interval[1] - item.interval[0] >= 0.035)
    .sort((left, right) => left.position - right.position);
  const clusters = [];
  for (const item of items) {
    const cluster = clusters.find((candidate) => Math.abs(candidate.position - item.position) <= 0.012);
    if (cluster) {
      cluster.items.push(item);
      cluster.position = weightedAverage(cluster.items.map((entry) => [entry.position, entry.edge.support_score]));
      cluster.interval = [
        Math.min(cluster.interval[0], item.interval[0]),
        Math.max(cluster.interval[1], item.interval[1])
      ];
      cluster.support = average(cluster.items.map((entry) => entry.edge.support_score));
    } else {
      clusters.push({
        position: item.position,
        interval: [...item.interval],
        support: item.edge.support_score,
        items: [item]
      });
    }
  }
  return clusters;
}

function buildRectangularDetailProposals({ plane, region, bounds, horizontalBands, verticalBands, proposalType }) {
  const horizontal = horizontalBands.filter((band) => band.position >= bounds.v0 - 0.03 && band.position <= bounds.v1 + 0.03);
  const vertical = verticalBands.filter((band) => band.position >= bounds.u0 - 0.03 && band.position <= bounds.u1 + 0.03);
  const candidates = [];
  for (let topIndex = 0; topIndex < horizontal.length - 1; topIndex += 1) {
    for (let bottomIndex = topIndex + 1; bottomIndex < Math.min(horizontal.length, topIndex + 6); bottomIndex += 1) {
      const top = horizontal[topIndex];
      const bottom = horizontal[bottomIndex];
      const height = bottom.position - top.position;
      if (height < 0.045 || height > Math.max(0.42, (bounds.v1 - bounds.v0) * 0.75)) continue;
      for (let leftIndex = 0; leftIndex < vertical.length - 1; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < Math.min(vertical.length, leftIndex + 7); rightIndex += 1) {
          const left = vertical[leftIndex];
          const right = vertical[rightIndex];
          const width = right.position - left.position;
          if (width < 0.045 || width > Math.max(0.5, (bounds.u1 - bounds.u0) * 0.8)) continue;
          const horizontalCoverage = Math.min(
            intervalCoverage(top.interval, [left.position, right.position]),
            intervalCoverage(bottom.interval, [left.position, right.position])
          );
          const verticalCoverage = Math.min(
            intervalCoverage(left.interval, [top.position, bottom.position]),
            intervalCoverage(right.interval, [top.position, bottom.position])
          );
          const sideCoverage = Math.min(horizontalCoverage, verticalCoverage);
          if (sideCoverage < 0.34) continue;
          const aspect = width / Math.max(0.001, height);
          if (proposalType === 'equipment_rect' && (aspect < 0.45 || aspect > 3.2)) continue;
          if (proposalType === 'opening_rect' && (aspect < 0.28 || aspect > 5.5)) continue;
          const support = clamp(average([top.support, bottom.support, left.support, right.support]) * (0.45 + sideCoverage * 0.55), 0, 1);
          if (support < 0.2) continue;
          candidates.push({
            quad: [
              [left.position, top.position],
              [right.position, top.position],
              [right.position, bottom.position],
              [left.position, bottom.position]
            ],
            support,
            sideCoverage: {
              top: horizontalCoverage,
              bottom: horizontalCoverage,
              left: verticalCoverage,
              right: verticalCoverage
            },
            sourceEdges: [top, bottom, left, right].flatMap((band) => band.items.map((item) => item.edge.id))
          });
        }
      }
    }
  }
  const selected = nonMaximumSuppress(
    candidates.filter((candidate) => proposalFitsRole(candidate, region.role_hint, bounds)),
    proposalLimitForRole(region.role_hint),
    0.34
  );
  return selected.map((candidate, index) => detailProposal({
    plane,
    region,
    proposalType,
    candidate,
    index
  }));
}

function buildLinearStripProposals({ plane, region, bounds, horizontalBands, verticalBands }) {
  const candidates = [];
  const configurations = [
    { bands: verticalBands, min: bounds.u0, max: bounds.u1, spanMin: bounds.v0, spanMax: bounds.v1, vertical: true },
    { bands: horizontalBands, min: bounds.v0, max: bounds.v1, spanMin: bounds.u0, spanMax: bounds.u1, vertical: false }
  ];
  for (const config of configurations) {
    const bands = config.bands.filter((band) => band.position >= config.min - 0.03 && band.position <= config.max + 0.03);
    for (let firstIndex = 0; firstIndex < bands.length - 1; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < Math.min(bands.length, firstIndex + 5); secondIndex += 1) {
        const first = bands[firstIndex];
        const second = bands[secondIndex];
        const separation = second.position - first.position;
        if (separation < 0.018 || separation > 0.18) continue;
        const span0 = Math.max(first.interval[0], second.interval[0], config.spanMin);
        const span1 = Math.min(first.interval[1], second.interval[1], config.spanMax);
        const spanLength = span1 - span0;
        if (spanLength < 0.16) continue;
        const quad = config.vertical
          ? [[first.position, span0], [second.position, span0], [second.position, span1], [first.position, span1]]
          : [[span0, first.position], [span1, first.position], [span1, second.position], [span0, second.position]];
        candidates.push({
          quad,
          support: clamp(average([first.support, second.support]) * Math.min(1, spanLength / 0.35), 0, 1),
          sideCoverage: { parallel_overlap: round(spanLength, 4), separation: round(separation, 4) },
          sourceEdges: [first, second].flatMap((band) => band.items.map((item) => item.edge.id))
        });
      }
    }
  }
  return nonMaximumSuppress(candidates, proposalLimitForRole(region.role_hint), 0.34).map((candidate, index) => detailProposal({
    plane,
    region,
    proposalType: 'linear_path_strip',
    candidate,
    index
  }));
}

function detailProposal({ plane, region, proposalType, candidate, index }) {
  return {
    id: `plane_local_proposal:${safeFileName(plane.id)}:${safeFileName(region.source_detail_candidate_id)}:${proposalType}_${String(index + 1).padStart(3, '0')}`,
    source_plane_id: plane.id,
    source_region_candidate_id: region.id,
    proposal_type: proposalType,
    role_hint: region.role_hint,
    quad_uv: candidate.quad.map((point) => point.map((value) => round(value, 6))),
    support_score: round(candidate.support, 4),
    side_coverage: mapNumbers(candidate.sideCoverage),
    source_edge_ids: Array.from(new Set(candidate.sourceEdges)),
    review_status: 'candidate',
    review_required: true,
    promotion_allowed: false,
    blockers: [
      'accepted_plane_local_evidence_review_required',
      'accepted_local_detail_review_required',
      'accepted_reprojection_qa_required'
    ]
  };
}

function proposalTypeForRole(role) {
  const normalized = String(role || '').toLowerCase();
  if (/(duct|pipe|conduit|cable|linear_path)/.test(normalized)) return 'linear_path_strip';
  if (/(hvac|equipment|unit|device|button|lamp|fixture)/.test(normalized)) return 'equipment_rect';
  return 'opening_rect';
}

function nonMaximumSuppress(candidates, limit, iouThreshold = 0.45) {
  const selected = [];
  for (const candidate of [...candidates].sort((left, right) => right.support - left.support)) {
    if (selected.some((entry) => quadIou(entry.quad, candidate.quad) >= iouThreshold)) continue;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function proposalFitsRole(candidate, role, regionBounds) {
  const bounds = quadBounds(candidate.quad);
  const width = bounds.u1 - bounds.u0;
  const height = bounds.v1 - bounds.v0;
  const area = width * height;
  const centerV = (bounds.v0 + bounds.v1) / 2;
  const roleName = String(role || '').toLowerCase();
  const overlapU = Math.max(0, Math.min(bounds.u1, regionBounds.u1) - Math.max(bounds.u0, regionBounds.u0));
  const overlapV = Math.max(0, Math.min(bounds.v1, regionBounds.v1) - Math.max(bounds.v0, regionBounds.v0));
  const regionCoverage = (overlapU * overlapV) / Math.max(1e-9, area);
  if (regionCoverage < 0.7) return false;
  if (/hvac|equipment|unit|device/.test(roleName)) return area >= 0.008 && area <= 0.09 && width / Math.max(0.001, height) >= 0.45;
  if (/storefront|door|entrance/.test(roleName)) return area >= 0.018 && height >= 0.1 && centerV >= regionBounds.v0;
  if (/window|opening/.test(roleName)) return area >= 0.006 && area <= 0.12 && height >= 0.05;
  return true;
}

function proposalLimitForRole(role) {
  const normalized = String(role || '').toLowerCase();
  if (/hvac|equipment|unit|device/.test(normalized)) return 6;
  if (/storefront|door|entrance/.test(normalized)) return 4;
  if (/duct|pipe|conduit|cable|linear_path/.test(normalized)) return 8;
  return 10;
}

function quadIou(first, second) {
  const a = quadBounds(first);
  const b = quadBounds(second);
  const intersectionWidth = Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0));
  const intersectionHeight = Math.max(0, Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0));
  const intersection = intersectionWidth * intersectionHeight;
  const areaA = Math.max(0, a.u1 - a.u0) * Math.max(0, a.v1 - a.v0);
  const areaB = Math.max(0, b.u1 - b.u0) * Math.max(0, b.v1 - b.v0);
  return intersection / Math.max(1e-9, areaA + areaB - intersection);
}

function quadBounds(quad) {
  const us = quad.map((point) => point[0]);
  const vs = quad.map((point) => point[1]);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

function intervalCoverage(interval, target) {
  const overlap = Math.max(0, Math.min(interval[1], target[1]) - Math.max(interval[0], target[0]));
  return overlap / Math.max(1e-9, target[1] - target[0]);
}

function weightedAverage(values) {
  const weight = values.reduce((sum, entry) => sum + entry[1], 0);
  if (weight <= 1e-9) return average(values.map((entry) => entry[0]));
  return values.reduce((sum, entry) => sum + entry[0] * entry[1], 0) / weight;
}

function mapNumbers(value) {
  return Object.fromEntries(Object.entries(value || {}).map(([key, number]) => [key, round(number, 4)]));
}

function summarizeGraph(planes) {
  return {
    plane_count: planes.length,
    edge_evidence_count: planes.reduce((sum, plane) => sum + plane.edge_evidence.length, 0),
    corner_evidence_count: planes.reduce((sum, plane) => sum + plane.corner_evidence.length, 0),
    repetition_hypothesis_count: planes.reduce((sum, plane) => sum + plane.repetition_hypotheses.length, 0),
    region_candidate_count: planes.reduce((sum, plane) => sum + plane.region_candidates.length, 0),
    detail_instance_proposal_count: planes.reduce((sum, plane) => sum + plane.detail_instance_proposals.length, 0),
    review_required: true,
    promotion_allowed: false
  };
}

function rectifiedDimensions({ plane, frame }) {
  let aspect;
  if (frame) {
    aspect = Math.hypot(frame.to.x - frame.from.x, frame.to.y - frame.from.y) / Math.max(1, frame.height);
  } else {
    const quad = plane.visible_quad_px;
    const width = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2;
    const height = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
    aspect = width / Math.max(1, height);
  }
  aspect = clamp(aspect, 0.16, 2.4);
  return aspect >= 1
    ? { width: 720, height: Math.max(300, Math.round(720 / aspect)) }
    : { width: Math.max(180, Math.round(720 * aspect)), height: 720 };
}

function resolveCoordinateReference({ facadePlaneGraph, sourceImage, sourceWidth, sourceHeight }) {
  const reference = facadePlaneGraph.coordinate_reference;
  if (!reference) {
    return {
      space: 'source_image_px',
      source_image: sourceImage,
      width: sourceWidth,
      height: sourceHeight,
      normalized_from_source_image: false
    };
  }
  const width = Number(reference.width || 0);
  const height = Number(reference.height || 0);
  if (!(width > 0) || !(height > 0)) throw new Error('FacadePlaneGraph coordinate_reference requires positive width and height');
  return {
    space: reference.space || 'source_image_px',
    source_image: reference.source_image || sourceImage,
    width,
    height,
    normalized_from_source_image: reference.normalized_from_source_image === true
  };
}

function rectifyPlaneRaster({ sourceData, sourceWidth, sourceHeight, channels, localToImageHomography, width, height }) {
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const v = height <= 1 ? 0 : y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = width <= 1 ? 0 : x / (width - 1);
      const [sourceX, sourceY] = applyHomography(localToImageHomography, [u, v]);
      const targetIndex = (y * width + x) * 4;
      if (sourceX < 0 || sourceY < 0 || sourceX > sourceWidth - 1 || sourceY > sourceHeight - 1) {
        output[targetIndex + 3] = 0;
        continue;
      }
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      const tx = sourceX - x0;
      const ty = sourceY - y0;
      for (let channel = 0; channel < 4; channel += 1) {
        output[targetIndex + channel] = Math.round(bilinearChannel(sourceData, sourceWidth, channels, x0, y0, x1, y1, tx, ty, channel));
      }
    }
  }
  return output;
}

function bilinearChannel(data, width, channels, x0, y0, x1, y1, tx, ty, channel) {
  if (channel >= channels) return channel === 3 ? 255 : 0;
  const a = data[(y0 * width + x0) * channels + channel];
  const b = data[(y0 * width + x1) * channels + channel];
  const c = data[(y1 * width + x0) * channels + channel];
  const d = data[(y1 * width + x1) * channels + channel];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function localOrientation(angleDeg) {
  const angle = ((Number(angleDeg) % 180) + 180) % 180;
  const horizontalDistance = Math.min(angle, 180 - angle);
  const verticalDistance = Math.abs(angle - 90);
  if (horizontalDistance <= 12) return 'local_u';
  if (verticalDistance <= 12) return 'local_v';
  return 'diagonal_or_detail';
}

function lineIntersection(first, second) {
  const [[x1, y1], [x2, y2]] = first;
  const [[x3, y3], [x4, y4]] = second;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-9) return null;
  const determinant1 = x1 * y2 - y1 * x2;
  const determinant2 = x3 * y4 - y3 * x4;
  return [
    (determinant1 * (x3 - x4) - (x1 - x2) * determinant2) / denominator,
    (determinant1 * (y3 - y4) - (y1 - y2) * determinant2) / denominator
  ];
}

function pointNearSegment(point, line, tolerance) {
  const minX = Math.min(line[0][0], line[1][0]) - tolerance;
  const maxX = Math.max(line[0][0], line[1][0]) + tolerance;
  const minY = Math.min(line[0][1], line[1][1]) - tolerance;
  const maxY = Math.max(line[0][1], line[1][1]) + tolerance;
  return point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY;
}

function deduplicateCorners(candidates, tolerance) {
  const kept = [];
  for (const candidate of candidates.sort((left, right) => right.support - left.support)) {
    if (kept.some((entry) => distance(entry.point, candidate.point) <= tolerance)) continue;
    kept.push(candidate);
  }
  return kept;
}

function clusterLinePositions(items, tolerance) {
  const clusters = [];
  for (const item of items.sort((left, right) => left.position - right.position)) {
    const cluster = clusters.find((candidate) => Math.abs(candidate.position - item.position) <= tolerance);
    if (cluster) {
      cluster.items.push(item);
      cluster.position = average(cluster.items.map((entry) => entry.position));
    } else {
      clusters.push({ position: item.position, items: [item] });
    }
  }
  return clusters;
}

function bestRegularSequence(clusters) {
  if (clusters.length < 3) return null;
  let best = null;
  for (let start = 0; start < clusters.length - 2; start += 1) {
    for (let second = start + 1; second < clusters.length - 1; second += 1) {
      const targetSpacing = clusters[second].position - clusters[start].position;
      if (targetSpacing < 0.045 || targetSpacing > 0.35) continue;
      const selected = [clusters[start], clusters[second]];
      let expected = clusters[second].position + targetSpacing;
      let cursor = second + 1;
      const tolerance = Math.max(0.014, targetSpacing * 0.24);
      while (cursor < clusters.length && expected <= 1.08) {
        let nearestIndex = -1;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (let index = cursor; index < clusters.length; index += 1) {
          const candidateDistance = Math.abs(clusters[index].position - expected);
          if (candidateDistance < nearestDistance) {
            nearestDistance = candidateDistance;
            nearestIndex = index;
          }
          if (clusters[index].position > expected + tolerance) break;
        }
        if (nearestIndex < 0 || nearestDistance > tolerance) break;
        selected.push(clusters[nearestIndex]);
        cursor = nearestIndex + 1;
        expected = clusters[nearestIndex].position + targetSpacing;
      }
      if (selected.length < 3) continue;
      const gaps = selected.slice(1).map((cluster, index) => cluster.position - selected[index].position);
      const spacing = average(gaps);
      const variation = coefficientVariation(gaps);
      if (!Number.isFinite(variation) || variation > 0.28) continue;
      const edgeSupport = average(selected.flatMap((cluster) => cluster.items.map((item) => item.edge.support_score)));
      const support = clamp(0.25 + selected.length * 0.08 + (1 - variation) * 0.35 + edgeSupport * 0.15, 0, 0.95);
      const score = selected.length * support * spacing;
      if (!best || score > best.score) best = { clusters: selected, spacing, variation, support, score };
    }
  }
  return best;
}

function edgeTouchesRegion(edge, region) {
  const points = edge.line_uv;
  const midpoint = [average(points.map((point) => point[0])), average(points.map((point) => point[1]))];
  const margin = 0.035;
  return midpoint[0] >= region.u0 - margin
    && midpoint[0] <= region.u1 + margin
    && midpoint[1] >= region.v0 - margin
    && midpoint[1] <= region.v1 + margin;
}

function coefficientVariation(values) {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const mean = average(values);
  if (mean <= 1e-9) return Number.POSITIVE_INFINITY;
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance) / mean;
}

function invert3x3(matrix) {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const determinant = a * A + b * D + c * G;
  if (Math.abs(determinant) < 1e-12) throw new Error('Plane rectification homography is singular');
  return [
    [A / determinant, B / determinant, C / determinant],
    [D / determinant, E / determinant, F / determinant],
    [G / determinant, H / determinant, I / determinant]
  ];
}

function multiply3x3(left, right) {
  return Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => (
    left[row][0] * right[0][column]
    + left[row][1] * right[1][column]
    + left[row][2] * right[2][column]
  )));
}

function applyHomography(matrix, point) {
  const [x, y] = point;
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (Math.abs(denominator) < 1e-9) return [0.5, 0.5];
  return [
    (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
  ];
}

function renderPlaneLocalEvidenceWorkbenchHtml({ graph, planes }) {
  const reviewData = {
    source: 'plane-local-evidence-graph.json',
    plane_ids: graph.planes.map((plane) => plane.source_plane_id),
    proposals: graph.planes.flatMap((plane) => plane.detail_instance_proposals)
  };
  const planeSections = planes.map(({ planeEntry, overlaySvg }) => {
    const proposalRows = planeEntry.detail_instance_proposals.length
      ? planeEntry.detail_instance_proposals.map((proposal) => `<tr data-proposal-row data-proposal-id="${escapeHtml(proposal.id)}" data-source-region-id="${escapeHtml(proposal.source_region_candidate_id)}" data-quad-uv="${escapeHtml(JSON.stringify(proposal.quad_uv))}">
        <td><code>${escapeHtml(proposal.proposal_type)}</code></td>
        <td>${escapeHtml(String(proposal.support_score))}</td>
        <td><select data-field="status"><option value="pending">pending</option><option value="accepted">accepted</option><option value="rejected">rejected</option><option value="reclassified">reclassified</option><option value="reassigned">reassigned</option></select></td>
        <td><input data-field="role" value="${escapeHtml(proposal.role_hint)}" aria-label="Role for ${escapeHtml(proposal.id)}"></td>
        <td><select data-field="geometry_type">${['recess_opening', 'equipment_box', 'linear_path_box'].map((geometryType) => `<option value="${geometryType}"${geometryType === promotionGeometryForProposal(proposal.proposal_type) ? ' selected' : ''}>${geometryType}</option>`).join('')}</select></td>
        <td><select data-field="target_plane_id">${graph.planes.map((target) => `<option value="${escapeHtml(target.source_plane_id)}"${target.source_plane_id === proposal.source_plane_id ? ' selected' : ''}>${escapeHtml(target.source_plane_id)}</option>`).join('')}</select></td>
      </tr>`).join('')
      : '<tr><td colspan="6">No supported instance proposal.</td></tr>';
    return `<section class="plane" data-plane-id="${escapeHtml(planeEntry.source_plane_id)}">
      <div class="plane-head"><div><h2>${escapeHtml(planeEntry.source_plane_id)}</h2><p class="metrics">edges=${planeEntry.edge_evidence.length} corners=${planeEntry.corner_evidence.length} repetitions=${planeEntry.repetition_hypotheses.length} proposals=${planeEntry.detail_instance_proposals.length}</p></div><label>Plane review <select data-plane-status><option value="pending">pending</option><option value="accepted">accepted</option><option value="rejected">rejected</option></select></label></div>
      <div class="viewer">${overlaySvg}</div>
      <div class="table-wrap"><table><thead><tr><th>Proposal</th><th>Support</th><th>Status</th><th>Role</th><th>Geometry</th><th>Plane</th></tr></thead><tbody>${proposalRows}</tbody></table></div>
    </section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plane Local Evidence Review</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;color:#111827;font-family:Inter,system-ui,sans-serif}header{position:sticky;top:0;z-index:5;padding:16px 22px;background:#fff;border-bottom:1px solid #9ca3af}h1{font-size:20px;margin:0 0 6px}h2{font:15px ui-monospace,monospace;margin:0}.status,.metrics{font:12px ui-monospace,monospace}.status{color:#991b1b}.toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px}.toolbar label{display:flex;align-items:center;gap:5px;font-size:13px}.toolbar button{height:32px;padding:0 12px;border:1px solid #475569;background:#fff;color:#111827;cursor:pointer}.toolbar button.primary{background:#075985;color:#fff;border-color:#075985}main{max-width:1280px;margin:auto;padding:0 22px 48px}.plane{padding:22px 0;border-bottom:1px solid #9ca3af}.plane-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:10px}.viewer{overflow:auto;background:#111827;border:1px solid #374151}.viewer svg{display:block;width:100%;height:auto;max-height:760px}.table-wrap{overflow:auto;margin-top:12px}table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #d1d5db}input,select{max-width:100%;height:30px;border:1px solid #94a3b8;background:#fff;padding:0 6px}pre{max-height:260px;overflow:auto;background:#111827;color:#e2e8f0;padding:14px;font:12px ui-monospace,monospace;white-space:pre-wrap}@media(max-width:720px){header{position:static}.plane-head{align-items:flex-start;flex-direction:column}.viewer svg{width:900px;max-width:none}}</style></head><body><header><h1>Plane-local evidence review</h1><p class="status">review_required=true / promotion_allowed=false</p><div class="toolbar"><label><input type="checkbox" data-layer-toggle="plane-local-edge-evidence" checked>Edges</label><label><input type="checkbox" data-layer-toggle="plane-local-corner-evidence" checked>Corners</label><label><input type="checkbox" data-layer-toggle="plane-local-repetition-hypotheses" checked>Repetitions</label><label><input type="checkbox" data-layer-toggle="plane-local-region-candidates" checked>Regions</label><label><input type="checkbox" data-layer-toggle="plane-local-detail-proposals" checked>Proposals</label><button type="button" id="refresh-review" class="primary">Refresh Review JSON</button><button type="button" id="copy-review">Copy JSON</button><button type="button" id="download-review">Export JSON</button></div></header><main>${planeSections}<section><h2>Review decision</h2><pre id="review-json"></pre></section></main><script id="plane-local-review-data" type="application/json">${scriptJson(reviewData)}</script><script>
const reviewData=JSON.parse(document.getElementById('plane-local-review-data').textContent);
function buildDecision(){
  const plane_decisions=[...document.querySelectorAll('[data-plane-id]')].flatMap(section=>{const status=section.querySelector('[data-plane-status]').value;return status==='pending'?[]:[{id:section.dataset.planeId,status}]});
  const region_decisions=[...document.querySelectorAll('[data-proposal-row]')].flatMap(row=>{const status=row.querySelector('[data-field="status"]').value;if(status==='pending')return[];return[{id:row.dataset.proposalId,status,target_plane_id:row.querySelector('[data-field="target_plane_id"]').value,role:row.querySelector('[data-field="role"]').value,geometry_type:row.querySelector('[data-field="geometry_type"]').value,quad_uv:JSON.parse(row.dataset.quadUv),source_region_ids:[row.dataset.sourceRegionId]}]});
  return {kind:'plane_local_evidence_review_decision_v1',version:1,source_plane_local_evidence_graph:reviewData.source,reviewer:'plane-local-evidence-workbench',status:plane_decisions.length||region_decisions.length?'partial':'not_accepted',plane_decisions,edge_decisions:[],corner_decisions:[],repetition_decisions:[],geometry_authoring:{mode:'proposal_geometry',correction_note:''},region_decisions,promotion_allowed:false,compile_allowed:false,blockers:['accepted_local_detail_review_required','accepted_reprojection_qa_required'],notes:['Workbench decisions review evidence only and cannot directly promote PartGraph geometry.']};
}
function refresh(){const decision=buildDecision();document.getElementById('review-json').textContent=JSON.stringify(decision,null,2);return decision}
window.buildPlaneLocalEvidenceReviewDecision=buildDecision;
document.querySelectorAll('[data-layer-toggle]').forEach(toggle=>toggle.addEventListener('change',()=>document.querySelectorAll('[data-layer="'+toggle.dataset.layerToggle+'"]').forEach(layer=>{layer.style.display=toggle.checked?'':'none'})));
document.querySelectorAll('select,input').forEach(control=>control.addEventListener('change',refresh));
document.getElementById('refresh-review').addEventListener('click',refresh);
document.getElementById('copy-review').addEventListener('click',async()=>navigator.clipboard.writeText(JSON.stringify(refresh(),null,2)));
document.getElementById('download-review').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(refresh(),null,2)+'\\n'],{type:'application/json'});const anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download='plane-local-evidence-review.json';anchor.click();URL.revokeObjectURL(anchor.href)});
refresh();
</script></body></html>`;
}

function promotionGeometryForProposal(proposalType) {
  if (proposalType === 'equipment_rect') return 'equipment_box';
  if (proposalType === 'linear_path_strip') return 'linear_path_box';
  return 'recess_opening';
}

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function normalizeSegmentLine(line) {
  if (Array.isArray(line) && line.length === 2) return line;
  if (Array.isArray(line?.a) && Array.isArray(line?.b)) return [line.a, line.b];
  throw new Error('Plane-local line evidence requires a two-endpoint line');
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
  return String(value || 'plane').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'plane';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function scriptJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
