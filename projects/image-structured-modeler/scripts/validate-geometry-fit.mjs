#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../../src/bridge.mjs';
import { repoRoot } from './lib/image-analysis.mjs';
import {
  groundingAcceptanceIssues,
  summarizeDenseDetailGroundingFromOperations
} from './lib/grounding-v2.mjs';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const SYMMETRIC_RELATIONS = new Set(['same_row', 'aligned_with', 'touching', 'mirrored_pair', 'centered_on']);
const INVERSE_RELATIONS = new Map([
  ['left_of', 'right_of'],
  ['right_of', 'left_of'],
  ['above', 'below'],
  ['below', 'above']
]);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await validateGeometryFit({
    observations: await readJson(options.observations || 'projects/image-structured-modeler/examples/building-group/observations.json'),
    fixture: await readJson(options.fixture || 'projects/image-structured-modeler/examples/building-group/visual-relations.candidates.fixture.json'),
    code: await fs.readFile(resolveRepo(options.code || 'projects/image-structured-modeler/examples/building-group/output.part-candidates-applied.json'), 'utf8'),
    runtime: options.runtime || 'mock',
    timeoutMs: options.timeoutMs,
    mockSessionPath: options.mockSessionPath || 'output/image-structured-modeler/sessions/geometry-fit-qa-mock-session.json'
  });

  if (options.output) {
    const output = resolveRepo(options.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`${JSON.stringify({
    ok: report.ok,
    verdict: report.verdict,
    checked_footprints: report.summary.checked_footprints,
    grounding_issues: report.summary.grounding_issues,
    checked_relations: report.summary.checked_relations,
    checked_scale_anchors: report.summary.checked_scale_anchors,
    max_center_error: report.summary.max_center_error,
    max_extent_error: report.summary.max_extent_error,
    max_relation_error: report.summary.max_relation_error,
    max_scale_error: report.summary.max_scale_error,
    dense_detail_helper_ratio: report.summary.dense_detail_helper_ratio,
    photo_grade_eligible_ratio: report.summary.photo_grade_eligible_ratio,
    structural_grounding_issues: report.summary.structural_grounding_issues,
    floating_roof_features: report.summary.floating_roof_features,
    issues: report.summary.total_issues
  }, null, 2)}\n`);
  if (options.requirePass && !report.ok) process.exit(1);
}

export async function validateGeometryFit({ observations, fixture, code, runtime = 'mock', timeoutMs = null, mockSessionPath } = {}) {
  if (!observations?.images?.length) throw new Error('GeometryFit QA requires an ObservationSet with images.');
  if (!fixture?.footprint_rules?.length && !fixture?.required_relations?.length) {
    throw new Error('GeometryFit QA requires fixture.footprint_rules or fixture.required_relations.');
  }
  const bridge = new SketchUpBridge({ mock: { sessionPath: resolveRepo(mockSessionPath || 'output/image-structured-modeler/sessions/geometry-fit-qa-mock-session.json') } });
  const { snapshot } = await bridge.build_model({ runtime, code, timeoutMs });
  const codeDocument = parseCodeDocument(code);
  const context = makeModelContext(snapshot, fixture);
  const calibration = calibrateProjection({ observations, fixture, context });
  const issues = [];

  const footprintResults = [];
  for (const rule of fixture.footprint_rules || []) {
    const result = evaluateFootprintFit(observations, context, fixture, calibration, rule);
    footprintResults.push(result);
    if (!result.ok) {
      const issueType = result.grounding_quality && !result.grounding_quality.ok
        ? 'geometry_fit.grounding_ambiguity'
        : 'geometry_fit.footprint_residual';
      issues.push(issue(issueType, rule, result.message, result.evidence, result.severity || 'error'));
    }
  }

  const relationResults = [];
  for (const rule of (fixture.required_relations || []).filter((item) => item.image_only !== true && item.mode !== 'image_only')) {
    const result = evaluateRelationFit(observations, context, fixture, calibration, rule);
    relationResults.push(result);
    if (!result.ok) {
      issues.push(issue('geometry_fit.relation_residual', rule, result.message, result.evidence, result.severity || 'error'));
    }
  }

  const scaleResults = evaluateScaleResiduals(observations, calibration);
  for (const result of scaleResults.filter((item) => !item.ok)) {
    issues.push(issue('geometry_fit.scale_residual', { id: result.id, severity: result.severity }, result.message, result.evidence, result.severity || 'warn'));
  }

  const handednessResults = [];
  for (const negativeCase of fixture.negative_cases || []) {
    const result = evaluateHandednessCase(context, fixture, negativeCase);
    handednessResults.push(result);
    if (!result.ok) {
      issues.push(issue('geometry_fit.handedness_not_detected', negativeCase, `Handedness negative case ${negativeCase.id} was not detected by projection residuals.`, result));
    }
  }

  const denseDetailFit = summarizeDenseDetailGroundingFromOperations(codeDocument?.operations || [], { sampleLimit: 36 });
  for (const groundingIssue of groundingAcceptanceIssues(denseDetailFit, fixture.grounding_v2 || {})) {
    issues.push(groundingIssue);
  }
  const structuralFit = evaluateStructuralGroundingFromOperations(codeDocument?.operations || [], fixture.grounding_v2 || {});
  issues.push(...structuralFit.issues);

  const bySeverity = countBy(issues, 'severity');
  const summary = summarize({ footprintResults, relationResults, scaleResults, handednessResults, denseDetailFit, structuralFit, issues });
  calibration.residual_summary = {
    mean_center_error: summary.mean_center_error,
    max_center_error: summary.max_center_error,
    mean_extent_error: summary.mean_extent_error,
    max_extent_error: summary.max_extent_error,
    mean_relation_error: summary.mean_relation_error,
    max_relation_error: summary.max_relation_error,
    mean_scale_error: summary.mean_scale_error,
    max_scale_error: summary.max_scale_error,
    handedness_error: summary.handedness_error,
    dense_detail_helper_ratio: summary.dense_detail_helper_ratio,
    photo_grade_eligible_ratio: summary.photo_grade_eligible_ratio,
    structural_grounding_issues: summary.structural_grounding_issues,
    floating_roof_features: summary.floating_roof_features
  };
  calibration.site_projection.residual_summary = calibration.residual_summary;
  calibration.camera_calibrations = calibrateViews({ observations, fixture, primaryCalibration: calibration });
  calibration.multi_view_consistency = evaluateMultiViewConsistency(observations, fixture, calibration);

  return {
    kind: 'geometry_fit_qa',
    version: 2,
    ok: (bySeverity.error || 0) === 0,
    verdict: (bySeverity.error || 0) > 0 ? 'fail' : (bySeverity.warn || 0) > 0 ? 'review' : 'pass',
    fixture: fixture.id || fixture.name,
    runtime,
    camera_calibration: calibration,
    grounding_v2: denseDetailFit,
    structural_grounding: structuralFit,
    summary,
    issues,
    footprint_results: footprintResults,
    relation_results: relationResults,
    scale_results: scaleResults,
    handedness_results: handednessResults,
    correction_suggestions: correctionSuggestions(issues)
  };
}

function makeModelContext(snapshot, fixture) {
  const items = [...(snapshot.groups || []), ...(snapshot.instances || [])].filter((item) => item.bounding_box);
  const axes = normalizeAxes(fixture.model?.axes || ['x', 'y']);
  const frame = frameBox(items, fixture.model?.frame_items || fixture.model?.frameItems || []);
  return { items, axes, frame };
}

function calibrateProjection({ observations, fixture, context }) {
  const imageView = fixture.geometry_fit?.image_view || fixture.footprint_rules?.[0]?.image_view || 'top';
  const frameKey = fixture.geometry_fit?.image_frame || fixture.footprint_rules?.[0]?.image_frame || fixture.footprint_rules?.[0]?.imageFrame || 'site';
  const image = (observations.images || []).find((candidate) => candidate.detected_view?.kind === imageView) || observations.images[0];
  const imageFrame = findImageObservation(image, fixture, frameKey);
  if (!image || !imageFrame?.bbox) throw new Error(`GeometryFit QA could not calibrate image frame ${frameKey} in ${imageView} view.`);
  const modelFrame = frameBox(context.items, fixture.model?.frame_items || fixture.model?.frameItems || []);
  const axes = context.axes;
  const projectedFrame = projectedBounds(modelFrame, axes);
  const [x, y, width, height] = imageFrame.bbox;
  const siteProjection = {
    version: 2,
    projection_type: image.detected_view?.kind === 'top' ? 'top_view_affine_bbox_to_site_xy' : 'weak_view_affine_bbox_to_model_projection',
    source_image: image.image?.path,
    image_view: image.detected_view?.kind,
    image_frame: {
      key: frameKey,
      observation_id: imageFrame.id,
      bbox: imageFrame.bbox,
      grounding: imageFrame.grounding || null
    },
    model_frame: {
      axes,
      item_ids: fixture.model?.frame_items || fixture.model?.frameItems || [],
      bbox: modelFrame
    },
    image_to_site_transform: {
      coordinate_convention: 'image_x_right_y_down_to_model_xy_y_up',
      image_origin_px: [x, y],
      image_extent_px: [width, height],
      model_origin_mm: projectedFrame.min,
      model_extent_mm: [round(projectedFrame.w), round(projectedFrame.h)],
      mm_per_px_x: round(projectedFrame.w / Math.max(1, width)),
      mm_per_px_y: round(projectedFrame.h / Math.max(1, height)),
      normalized_x: 'u=(x-image_min_x)/image_width',
      normalized_y: 'v=1-(y-image_min_y)/image_height'
    },
    confidence: round((Number(image.detected_view?.confidence) || 0.5) * (Number(observations.scale_calibration?.confidence) || 0.5)),
    review_required: true,
    residual_summary: null
  };
  return {
    ...siteProjection,
    site_projection: siteProjection,
    camera_calibrations: [],
    multi_view_consistency: null
  };
}

function evaluateFootprintFit(observations, context, fixture, calibration, rule) {
  const item = findModelItem(context.items, fixture, rule.item);
  if (!item) {
    return {
      id: rule.id,
      ok: false,
      message: `Missing model item for GeometryFit footprint rule ${rule.id}.`,
      evidence: { item_found: false },
      severity: 'error'
    };
  }
  const imageMatch = findImageFootprint(observations, fixture, rule);
  if (!imageMatch?.observation || !imageMatch?.frame) {
    return {
      id: rule.id,
      ok: false,
      message: `Missing image footprint evidence for ${rule.item}.`,
      evidence: { image_view: rule.image_view || calibration.image_view },
      severity: 'error'
    };
  }
  const requiredGrounding = rule.require_grounding || rule.requireGrounding;
  const groundingMethod = imageMatch.observation.grounding?.method || imageMatch.observation.mask?.method || null;
  if (requiredGrounding && groundingMethod !== requiredGrounding) {
    return {
      id: rule.id,
      ok: false,
      message: `${rule.id} uses ${groundingMethod || 'ungrounded'} evidence instead of ${requiredGrounding}.`,
      evidence: {
        observation_id: imageMatch.observation.id,
        grounding_method: groundingMethod,
        required_grounding: requiredGrounding
      },
      severity: 'error'
    };
  }

  const axes = normalizeAxes(rule.model_axes || rule.modelAxes || fixture.model?.axes || context.axes);
  const modelFrame = frameBox(context.items, rule.model_frame_items || rule.modelFrameItems || fixture.model?.frame_items || fixture.model?.frameItems || []);
  const modelBox = normalizedProjectedBox(item.bounding_box, axes, modelFrame);
  const imageBox = normalizedImageBox(imageMatch.observation.bbox, imageMatch.frame.bbox);
  const contourBox = normalizedContourBox(imageMatch.observation, imageMatch.frame.bbox) || imageBox;
  const modelPolygon = normalizedBoxPolygon(modelBox);
  const contourPolygon = normalizedContourPolygon(imageMatch.observation, imageMatch.frame.bbox) || normalizedBoxPolygon(contourBox);
  const contourHull = convexHull(contourPolygon);
  const contourPolygonBox = polygonBounds(contourHull) || contourBox;
  const centerDelta = [
    round(modelBox.center[0] - contourBox.center[0]),
    round(modelBox.center[1] - contourBox.center[1])
  ];
  const extentDelta = [
    round(modelBox.extent[0] - contourBox.extent[0]),
    round(modelBox.extent[1] - contourBox.extent[1])
  ];
  const centerError = round(Math.hypot(centerDelta[0], centerDelta[1]));
  const extentError = round(Math.hypot(extentDelta[0], extentDelta[1]));
  const bboxAreaRatioError = round(Math.abs(area(modelBox) - area(contourBox)) / Math.max(0.0001, area(contourBox)));
  const polygonAreaRatioError = round(Math.abs(polygonArea(modelPolygon) - polygonArea(contourHull)) / Math.max(0.0001, polygonArea(contourHull)));
  const areaRatioError = Number.isFinite(polygonAreaRatioError)
    ? Math.min(bboxAreaRatioError, polygonAreaRatioError)
    : bboxAreaRatioError;
  const intersection = boxIou(modelBox, contourBox);
  const polygonIntersection = boxIou(modelBox, contourPolygonBox);
  const edgeDirectionErrorDeg = dominantAxis(modelBox) === dominantAxis(contourPolygonBox) ? 0 : 90;
  const centerTolerance = rule.center_tolerance ?? rule.centerTolerance ?? rule.tolerance ?? 0.035;
  const extentTolerance = rule.extent_tolerance ?? rule.extentTolerance ?? rule.tolerance ?? 0.045;
  const extentTol = Array.isArray(extentTolerance) ? extentTolerance : [extentTolerance, extentTolerance];
  const areaTolerance = rule.area_tolerance ?? rule.areaTolerance ?? 0.28;
  const residualOk = Math.abs(centerDelta[0]) <= centerTolerance
    && Math.abs(centerDelta[1]) <= centerTolerance
    && Math.abs(extentDelta[0]) <= extentTol[0]
    && Math.abs(extentDelta[1]) <= extentTol[1]
    && areaRatioError <= areaTolerance
    && edgeDirectionErrorDeg <= (rule.edge_direction_tolerance_deg ?? rule.edgeDirectionToleranceDeg ?? 45);
  const groundingQuality = evaluateGroundingQuality(imageMatch.observation, rule, contourBox, imageBox, imageMatch.frame.bbox);
  const ok = residualOk && groundingQuality.ok;
  const message = residualOk && !groundingQuality.ok
    ? `${rule.item} projection residual fits, but footprint grounding is ambiguous or mixed.`
    : ok
      ? `${rule.item} model projection fits mask/contour footprint evidence.`
      : `${rule.item} model projection diverges from mask/contour footprint evidence.`;
  return {
    id: rule.id,
    ok,
    severity: ok ? undefined : (residualOk ? groundingQuality.severity : 'error'),
    item: item.id || item.name,
    observation_id: imageMatch.observation.id,
    grounding_method: groundingMethod,
    image_view: imageMatch.image.detected_view?.kind,
    residuals: {
      center_delta: centerDelta,
      center_error: centerError,
      extent_delta: extentDelta,
      extent_error: extentError,
      area_ratio_error: areaRatioError,
      bbox_area_ratio_error: bboxAreaRatioError,
      polygon_area_ratio_error: polygonAreaRatioError,
      iou: intersection,
      polygon_iou: polygonIntersection,
      edge_direction_error_deg: edgeDirectionErrorDeg
    },
    message,
    grounding_quality: groundingQuality,
    evidence: {
      model_box: modelBox,
      image_box: contourBox,
      bbox_image_box: imageBox,
      model_polygon: modelPolygon,
      contour_polygon_sample: contourPolygon.slice(0, 32),
      contour_polygon_bounds: contourPolygonBox,
      center_tolerance: centerTolerance,
      extent_tolerance: extentTol,
      area_tolerance: areaTolerance,
      observation_id: imageMatch.observation.id,
      grounding: imageMatch.observation.grounding || null,
      mask: imageMatch.observation.mask || null,
      contour: compactContour(imageMatch.observation.contour),
      grounding_quality: groundingQuality
    }
  };
}

function evaluateGroundingQuality(observation, rule, contourBox, imageBox, frameBbox) {
  const method = observation.grounding?.method || observation.mask?.method || null;
  const declared = observation.grounding?.grounding_quality || observation.mask?.quality || null;
  const maxRatio = rule.max_grounding_bbox_ratio
    ?? rule.maxGroundingBboxRatio
    ?? (method === 'pixel_line_segmentation' || method === 'pixel_vegetation_segmentation' ? 2.0 : 2.6);
  const rawBox = observation.grounding?.pixel_bbox
    ? normalizedImageBox(observation.grounding.pixel_bbox, frameBbox)
    : null;
  const priorBox = observation.grounding?.prior_bbox
    ? normalizedImageBox(observation.grounding.prior_bbox, frameBbox)
    : null;
  const rawRatio = declared?.raw_to_evidence_bbox_ratio ?? (rawBox ? maxBoxDimensionRatio(rawBox, contourBox) : null);
  const priorRatio = declared?.prior_to_evidence_bbox_ratio ?? (priorBox ? maxBoxDimensionRatio(priorBox, contourBox) : null);
  const sampleCount = observation.contour?.sample_count ?? observation.contour?.polygon?.length ?? observation.mask?.sampled_contour?.length ?? 0;
  const declaredProxy = declared?.bbox_proxy ?? true;
  const sparseProxy = declaredProxy && sampleCount <= 5 && (
    method === 'pixel_line_segmentation'
    || method === 'pixel_vegetation_segmentation'
    || Boolean(observation.grounding?.derived_from?.length)
  );
  const reasons = new Set(declared?.reasons || []);
  if (rawRatio !== null && rawRatio > maxRatio) reasons.add('raw_pixel_bbox_not_isolated_from_candidate_bbox');
  if (priorRatio !== null && priorRatio > maxRatio) reasons.add('candidate_bbox_diverges_from_layout_prior');
  if (sparseProxy) reasons.add('bbox_proxy_not_instance_mask');
  if (observation.review_required || observation.grounding?.review_required || observation.mask?.review_required || observation.contour?.review_required || declared?.review_required) {
    reasons.add('observation_grounding_review_required');
  }
  const reasonList = [...reasons];
  return {
    ok: reasonList.length === 0,
    severity: rule.grounding_severity || rule.groundingSeverity || 'error',
    method,
    max_bbox_dimension_ratio: maxRatio,
    raw_to_evidence_bbox_ratio: rawRatio,
    prior_to_evidence_bbox_ratio: priorRatio,
    contour_sample_count: sampleCount,
    bbox_proxy: declaredProxy,
    review_required: reasonList.length > 0,
    reasons: reasonList,
    boxes: {
      raw_pixel_box: rawBox,
      prior_box: priorBox,
      evidence_box: contourBox,
      bbox_image_box: imageBox
    }
  };
}

function evaluateRelationFit(observations, context, fixture, calibration, rule, overrideItems = null) {
  const imageRelation = findImageRelation(observations.visual_relation_graph?.relations || [], fixture, rule);
  const imagePair = imagePairForRelation(observations, fixture, rule, calibration);
  const modelRelation = evaluateModelRelation(context, fixture, rule, overrideItems);
  if (!imageRelation || !imagePair) {
    return {
      id: rule.id,
      ok: false,
      message: `Missing image relation or footprint pair for ${rule.item} ${rule.type} ${rule.anchor}.`,
      evidence: { image_relation_found: Boolean(imageRelation), image_pair_found: Boolean(imagePair), model_relation: modelRelation }
    };
  }
  const relationError = round(Math.hypot(
    modelRelation.delta_norm[0] - imagePair.delta_norm[0],
    modelRelation.delta_norm[1] - imagePair.delta_norm[1]
  ));
  const imageSpacing = Math.hypot(imagePair.delta_norm[0], imagePair.delta_norm[1]);
  const modelSpacing = Math.hypot(modelRelation.delta_norm[0], modelRelation.delta_norm[1]);
  const spacingRatioError = round(relativeError(modelSpacing, imageSpacing));
  const tolerance = rule.geometry_relation_tolerance ?? rule.geometryRelationTolerance ?? rule.spacing_tolerance ?? rule.spacingTolerance ?? 0.09;
  const spacingRatioTolerance = rule.spacing_ratio_tolerance ?? rule.spacingRatioTolerance ?? null;
  const confidenceOk = imageRelation.confidence >= (rule.min_confidence ?? 0.4);
  const spacingOk = spacingRatioTolerance === null || spacingRatioError <= spacingRatioTolerance;
  const ok = modelRelation.ok && relationError <= tolerance && spacingOk && confidenceOk;
  return {
    id: rule.id,
    ok,
    type: rule.type,
    image_relation: {
      id: imageRelation.id,
      confidence: imageRelation.confidence,
      review_required: imageRelation.review_required
    },
    residuals: {
      image_delta_norm: imagePair.delta_norm,
      model_delta_norm: modelRelation.delta_norm,
      image_spacing_norm: round(imageSpacing),
      model_spacing_norm: round(modelSpacing),
      spacing_ratio_error: spacingRatioError,
      relation_error: relationError,
      tolerance,
      spacing_ratio_tolerance: spacingRatioTolerance
    },
    message: ok
      ? `${rule.id} model relation residual is within image-space projection tolerance.`
      : `${rule.id} model relation residual exceeds image-space projection tolerance.`,
    evidence: {
      image_pair: imagePair,
      model_relation: modelRelation,
      image_relation_basis: imageRelation.basis || null
    }
  };
}

function evaluateScaleResiduals(observations, calibration) {
  const measurements = (observations.scale_calibration?.measurements || observations.evidence_graph?.scale_calibration?.measurements || [])
    .filter((measurement) => measurement.anchor_type);
  const site = measurements.find((measurement) => measurement.anchor_type === 'site_boundary_from_known_anchors');
  if (!site && measurements.length === 0) return [];
  const ppmX = site?.pixels_per_mm_x || (calibration.image_frame?.bbox?.[2] / Math.max(1, calibration.image_to_site_transform?.model_extent_mm?.[0] || 1));
  const ppmY = site?.pixels_per_mm_y || (calibration.image_frame?.bbox?.[3] / Math.max(1, calibration.image_to_site_transform?.model_extent_mm?.[1] || 1));
  return measurements
    .filter((measurement) => measurement.anchor_type !== 'site_boundary_from_known_anchors')
    .map((measurement) => {
      const xError = measurement.pixels_per_mm_x ? relativeError(measurement.pixels_per_mm_x, ppmX) : null;
      const yError = measurement.pixels_per_mm_y ? relativeError(measurement.pixels_per_mm_y, ppmY) : null;
      const values = [xError, yError].filter(Number.isFinite);
      const scaleError = round(values.length ? Math.max(...values) : 0);
      const tolerance = measurement.scale_tolerance ?? 0.25;
      return {
        id: measurement.observation_id || measurement.anchor_type,
        anchor_type: measurement.anchor_type,
        ok: scaleError <= tolerance,
        severity: 'warn',
        residuals: {
          pixels_per_mm_x: measurement.pixels_per_mm_x ?? null,
          pixels_per_mm_y: measurement.pixels_per_mm_y ?? null,
          site_pixels_per_mm_x: ppmX,
          site_pixels_per_mm_y: ppmY,
          scale_error: scaleError,
          tolerance
        },
        message: `${measurement.anchor_type} scale residual is ${scaleError}.`,
        evidence: {
          source_image: measurement.source_image,
          observation_id: measurement.observation_id,
          review_required: measurement.review_required
        }
      };
    });
}

function evaluateHandednessCase(context, fixture, negativeCase) {
  const transformed = transformItems(context.items, context.frame, normalizeAxes(negativeCase.model_axes || fixture.model?.axes || context.axes), negativeCase.transform);
  const ruleIds = new Set(negativeCase.rule_ids || negativeCase.ruleIds || []);
  const rules = (fixture.required_relations || []).filter((rule) => ruleIds.size === 0 ? rule.mirror_negative : ruleIds.has(rule.id));
  const evaluations = rules.map((rule) => evaluateModelRelation(context, fixture, rule, transformed));
  const failedRules = evaluations
    .map((result, index) => (!result.ok ? rules[index]?.id : null))
    .filter(Boolean);
  return {
    id: negativeCase.id,
    transform: negativeCase.transform,
    checked_rules: rules.map((rule) => rule.id),
    failed_rules: failedRules,
    handedness_error: failedRules.length >= (negativeCase.min_failed_rules ?? 1) ? 0 : 1,
    ok: failedRules.length >= (negativeCase.min_failed_rules ?? 1),
    evaluations
  };
}

function evaluateStructuralGroundingFromOperations(operations = [], thresholds = {}) {
  const issues = [];
  const siteRegionFit = summarizeSiteRegionFit(operations, thresholds);
  const parkingLayoutFit = summarizeParkingLayoutFit(operations, thresholds);
  const roofSurfaceFit = summarizeRoofSurfaceFit(operations, thresholds);
  const tankEllipseFit = summarizeTankEllipseFit(operations, thresholds);

  if (siteRegionFit.max_overlap_ratio > siteRegionFit.max_allowed_overlap_ratio) {
    issues.push(structuralIssue('geometry_fit.site_region_overlap', 'site_region_graph', `Site regions overlap above threshold (${siteRegionFit.max_overlap_ratio}).`, siteRegionFit, 'warn'));
  }
  if (siteRegionFit.unclassified_ratio > siteRegionFit.max_allowed_unclassified_ratio) {
    issues.push(structuralIssue('geometry_fit.site_region_gap', 'site_region_graph', `Unclassified site area is too high (${siteRegionFit.unclassified_ratio}).`, siteRegionFit, 'warn'));
  }
  if (siteRegionFit.internal_road_area_ratio > siteRegionFit.max_allowed_internal_road_area_ratio) {
    issues.push(structuralIssue('geometry_fit.internal_road_proxy', 'internal_roads', `Internal roads still cover too much of the site (${siteRegionFit.internal_road_area_ratio}).`, siteRegionFit, 'warn'));
  }
  if (parkingLayoutFit.missing_line_evidence > 0) {
    issues.push(structuralIssue('geometry_fit.parking_line_missing_evidence', 'parking_layout_graph', `${parkingLayoutFit.missing_line_evidence} parking line operations are missing line evidence.`, parkingLayoutFit, 'warn'));
  }
  if (parkingLayoutFit.max_spacing_error_ratio > parkingLayoutFit.max_allowed_spacing_error_ratio) {
    issues.push(structuralIssue('geometry_fit.parking_layout_residual', 'parking_layout_graph', `Parking grid spacing residual is too high (${parkingLayoutFit.max_spacing_error_ratio}).`, parkingLayoutFit, 'warn'));
  }
  if (roofSurfaceFit.missing_host_count > 0) {
    issues.push(structuralIssue('geometry_fit.roof_feature_missing_host', 'roof_surface_fit', `${roofSurfaceFit.missing_host_count} roof features are missing host roof-surface metadata.`, roofSurfaceFit, 'error'));
  }
  if (roofSurfaceFit.floating_count > 0) {
    issues.push(structuralIssue('geometry_fit.floating_roof_feature', 'roof_surface_fit', `${roofSurfaceFit.floating_count} roof features are above the roof-surface distance threshold.`, roofSurfaceFit, 'error'));
  }
  if (roofSurfaceFit.direction_review_count > 0) {
    issues.push(structuralIssue('geometry_fit.roof_feature_direction_review', 'roof_surface_fit', `${roofSurfaceFit.direction_review_count} roof features require seam-direction review.`, roofSurfaceFit, 'warn'));
  }
  if (tankEllipseFit.instances < 2 && tankEllipseFit.detail_operations > 0) {
    issues.push(structuralIssue('geometry_fit.tank_ellipse_missing_instance', 'tank_ellipse_fit', 'Tank detail geometry exists without two accepted ellipse instances.', tankEllipseFit, 'warn'));
  }
  if (tankEllipseFit.max_radius_error_ratio > tankEllipseFit.max_allowed_radius_error_ratio) {
    issues.push(structuralIssue('geometry_fit.tank_ellipse_residual', 'tank_ellipse_fit', `Tank ellipse radius residual is too high (${tankEllipseFit.max_radius_error_ratio}).`, tankEllipseFit, 'warn'));
  }

  return {
    version: 1,
    site_region_fit: siteRegionFit,
    parking_layout_fit: parkingLayoutFit,
    roof_surface_fit: roofSurfaceFit,
    tank_ellipse_fit: tankEllipseFit,
    issues,
    summary: {
      total_issues: issues.length,
      by_severity: countBy(issues, 'severity')
    }
  };
}

function summarizeSiteRegionFit(operations, thresholds) {
  const regionOps = operations.filter((operation) => operation.qa?.site_region_graph);
  const graphRecords = regionOps.map((operation) => operation.qa.site_region_graph);
  const maxOverlap = max(graphRecords.map((item) => Number(item.overlap_ratio || 0)));
  const unclassified = max(graphRecords.map((item) => Number(item.unclassified_ratio || 0)));
  const internalRoad = graphRecords.find((item) => item.id === 'internal_roads' || item.region_kind === 'road_pavement');
  const maxInternalRoadRatio = thresholds.max_internal_road_area_ratio ?? thresholds.maxInternalRoadAreaRatio ?? 0.22;
  return {
    checked: regionOps.length,
    region_kinds: countBy(graphRecords, 'region_kind'),
    area_ratios: Object.fromEntries(graphRecords.map((item) => [item.region_kind, item.area_ratio || 0])),
    max_overlap_ratio: round(maxOverlap),
    max_allowed_overlap_ratio: thresholds.max_site_region_overlap_ratio ?? thresholds.maxSiteRegionOverlapRatio ?? 0.02,
    unclassified_ratio: round(unclassified),
    max_allowed_unclassified_ratio: thresholds.max_unclassified_ratio ?? thresholds.maxUnclassifiedRatio ?? 0.45,
    internal_road_area_ratio: round(internalRoad?.area_ratio || 0),
    max_allowed_internal_road_area_ratio: maxInternalRoadRatio,
    internal_roads_are_polygonal: operations.some((operation) => operation.id === 'internal_roads' && operation.op === 'mesh'),
    review_required: graphRecords.some((item) => item.review_required)
  };
}

function summarizeParkingLayoutFit(operations, thresholds) {
  const parkingOps = operations.filter((operation) => operation.qa?.parking_layout_graph);
  const residuals = parkingOps.map((operation) => operation.qa.parking_layout_graph.projection_residuals || {});
  const spacingErrors = residuals.map((item) => Number(item.spacing_error_ratio || 0));
  const aisleErrors = residuals.map((item) => Number(item.aisle_width_error_ratio || 0));
  return {
    checked: parkingOps.length,
    stall_line_operations: parkingOps.filter((operation) => operation.qa?.role === 'parking_stall_line').length,
    helper_only_operations: parkingOps.filter((operation) => operation.qa?.grounding_status === 'helper_only').length,
    missing_line_evidence: parkingOps.filter((operation) => operation.qa?.parking_layout_graph?.line_evidence !== true).length,
    max_spacing_error_ratio: round(max(spacingErrors)),
    max_aisle_width_error_ratio: round(max(aisleErrors)),
    max_allowed_spacing_error_ratio: thresholds.max_parking_spacing_error_ratio ?? thresholds.maxParkingSpacingErrorRatio ?? 0.12,
    max_allowed_aisle_width_error_ratio: thresholds.max_parking_aisle_width_error_ratio ?? thresholds.maxParkingAisleWidthErrorRatio ?? 0.16,
    row_count: max(parkingOps.map((operation) => Number(operation.qa?.parking_layout_graph?.row_count || 0))),
    column_count: max(parkingOps.map((operation) => Number(operation.qa?.parking_layout_graph?.column_count || 0)))
  };
}

function summarizeRoofSurfaceFit(operations, thresholds) {
  const roofRoles = new Set(['roof_panel_seam', 'roof_monitor', 'roof_vent', 'roof_hvac']);
  const roofOps = operations.filter((operation) => roofRoles.has(operation.qa?.role));
  const maxDistance = thresholds.max_roof_surface_distance_mm ?? thresholds.maxRoofSurfaceDistanceMm ?? 80;
  const maxDirection = thresholds.max_roof_direction_error_degrees ?? thresholds.maxRoofDirectionErrorDegrees ?? 5;
  const missingHost = roofOps.filter((operation) => !operation.qa?.roof_surface_fit?.host_part_id);
  const floating = roofOps.filter((operation) => Number(operation.qa?.roof_surface_fit?.surface_distance_mm ?? Infinity) > maxDistance);
  const directionReview = roofOps.filter((operation) => Number(operation.qa?.roof_surface_fit?.direction_error_degrees || 0) > maxDirection);
  return {
    checked: roofOps.length,
    by_role: countBy(roofOps.map((operation) => ({ role: operation.qa?.role })), 'role'),
    missing_host_count: missingHost.length,
    missing_host_ids: missingHost.map((operation) => operation.id || operation.name),
    floating_count: floating.length,
    floating_ids: floating.map((operation) => operation.id || operation.name),
    max_surface_distance_mm: round(max(roofOps.map((operation) => Number(operation.qa?.roof_surface_fit?.surface_distance_mm || 0)))),
    max_allowed_surface_distance_mm: maxDistance,
    direction_review_count: directionReview.length,
    max_direction_error_degrees: round(max(roofOps.map((operation) => Number(operation.qa?.roof_surface_fit?.direction_error_degrees || 0)))),
    max_allowed_direction_error_degrees: maxDirection
  };
}

function summarizeTankEllipseFit(operations, thresholds) {
  const tankOps = operations.filter((operation) => operation.qa?.tank_ellipse_fit);
  const instanceIds = new Set(tankOps.flatMap((operation) => [
    operation.qa.tank_ellipse_fit.tank_instance_id,
    ...(operation.qa.tank_ellipse_fit.tank_instance_ids || [])
  ].filter(Boolean)));
  const radiusErrors = tankOps.map((operation) => Number(operation.qa?.tank_ellipse_fit?.projection_residuals?.radius_error_ratio || 0));
  return {
    checked: tankOps.length,
    detail_operations: tankOps.length,
    instances: instanceIds.size,
    instance_ids: [...instanceIds],
    helper_only_operations: tankOps.filter((operation) => operation.qa?.grounding_status === 'helper_only').length,
    max_radius_error_ratio: round(max(radiusErrors)),
    max_allowed_radius_error_ratio: thresholds.max_tank_radius_error_ratio ?? thresholds.maxTankRadiusErrorRatio ?? 0.12,
    missing_parent_evidence: tankOps.filter((operation) => operation.qa?.tank_ellipse_fit?.accepted_instance === false).length
  };
}

function structuralIssue(type, ruleId, message, evidence, severity) {
  return {
    severity,
    type,
    rule_id: ruleId,
    message,
    evidence
  };
}

function summarize({ footprintResults, relationResults, scaleResults, handednessResults, denseDetailFit, structuralFit, issues }) {
  const centerErrors = footprintResults.map((result) => result.residuals?.center_error).filter(Number.isFinite);
  const extentErrors = footprintResults.map((result) => result.residuals?.extent_error).filter(Number.isFinite);
  const relationErrors = relationResults.map((result) => result.residuals?.relation_error).filter(Number.isFinite);
  const scaleErrors = scaleResults.map((result) => result.residuals?.scale_error).filter(Number.isFinite);
  const bySeverity = countBy(issues, 'severity');
  const groundingIssues = footprintResults.filter((result) => result.grounding_quality && !result.grounding_quality.ok).length;
  const primaryGroundingCoverage = denseDetailFit?.primary_structures?.grounded_ratio
    ?? denseDetailFit?.primary_structures?.image_grounded_ratio
    ?? 0;
  const denseHelperRatio = denseDetailFit?.dense_details?.helper_ratio ?? 0;
  const photoGradeEligibleRatio = ratio(
    (denseDetailFit?.primary_structures?.photo_grade_eligible || 0) + (denseDetailFit?.dense_details?.photo_grade_eligible || 0),
    (denseDetailFit?.primary_structures?.total || 0) + (denseDetailFit?.dense_details?.total || 0)
  );
  return {
    checked_footprints: footprintResults.length,
    matched_footprints: footprintResults.filter((result) => result.ok).length,
    grounding_issues: groundingIssues,
    checked_relations: relationResults.length,
    matched_relations: relationResults.filter((result) => result.ok).length,
    checked_scale_anchors: scaleResults.length,
    scale_anchors_in_tolerance: scaleResults.filter((result) => result.ok).length,
    checked_handedness_cases: handednessResults.length,
    handedness_cases_detected: handednessResults.filter((result) => result.ok).length,
    grounding_methods: countBy(footprintResults, 'grounding_method'),
    primary_structures_grounding_coverage: primaryGroundingCoverage,
    dense_detail_helper_ratio: denseHelperRatio,
    dense_detail_review_required: denseDetailFit?.dense_details?.review_required || 0,
    dense_detail_rejected: denseDetailFit?.dense_details?.rejected || 0,
    photo_grade_eligible_ratio: photoGradeEligibleRatio,
    dense_detail_items: denseDetailFit?.dense_details?.total || 0,
    structural_grounding_issues: structuralFit?.summary?.total_issues || 0,
    site_region_unclassified_ratio: structuralFit?.site_region_fit?.unclassified_ratio || 0,
    site_region_overlap_ratio: structuralFit?.site_region_fit?.max_overlap_ratio || 0,
    internal_road_area_ratio: structuralFit?.site_region_fit?.internal_road_area_ratio || 0,
    parking_grid_spacing_error_ratio: structuralFit?.parking_layout_fit?.max_spacing_error_ratio || 0,
    floating_roof_features: structuralFit?.roof_surface_fit?.floating_count || 0,
    roof_surface_features_checked: structuralFit?.roof_surface_fit?.checked || 0,
    tank_ellipse_instances: structuralFit?.tank_ellipse_fit?.instances || 0,
    tank_ellipse_max_radius_error_ratio: structuralFit?.tank_ellipse_fit?.max_radius_error_ratio || 0,
    mean_center_error: round(average(centerErrors)),
    max_center_error: round(max(centerErrors)),
    mean_extent_error: round(average(extentErrors)),
    max_extent_error: round(max(extentErrors)),
    mean_relation_error: round(average(relationErrors)),
    max_relation_error: round(max(relationErrors)),
    mean_scale_error: round(average(scaleErrors)),
    max_scale_error: round(max(scaleErrors)),
    handedness_error: round(average(handednessResults.map((result) => result.handedness_error).filter(Number.isFinite))),
    total_issues: issues.length,
    by_severity: {
      error: bySeverity.error || 0,
      warn: bySeverity.warn || 0,
      info: bySeverity.info || 0
    }
  };
}

function findImageFootprint(observations, fixture, rule) {
  const imageView = rule.image_view || 'top';
  const image = (observations.images || []).find((candidate) => candidate.detected_view?.kind === imageView);
  if (!image) return null;
  const observation = findImageObservation(image, fixture, rule.item);
  const frame = findImageObservation(image, fixture, rule.image_frame || rule.imageFrame || 'site');
  return { image, observation, frame };
}

function findImageObservation(image, fixture, key) {
  const aliases = aliasSet(fixture.aliases?.image, key);
  return (image.observations || [])
    .filter((observation) => observation.bbox && aliases.has(observation.component_hint))
    .sort((a, b) => imageObservationScore(b) - imageObservationScore(a))[0];
}

function imageObservationScore(observation) {
  let score = Number(observation.confidence) || 0;
  if (observation.mask?.polygon?.length) score += 12;
  if (observation.contour?.polygon?.length) score += 6;
  if (/^pixel_/i.test(observation.grounding?.method || observation.mask?.method || '')) score += 10;
  if (observation.grounding?.method === 'layout_prior' || /template|layout|prior/i.test(observation.note || '')) score -= 5;
  return score;
}

function imagePairForRelation(observations, fixture, rule, calibration) {
  const imageView = rule.image_view || calibration.image_view || 'top';
  const image = (observations.images || []).find((candidate) => candidate.detected_view?.kind === imageView);
  if (!image) return null;
  const item = findImageObservation(image, fixture, rule.item);
  const anchor = findImageObservation(image, fixture, rule.anchor);
  const frame = findImageObservation(image, fixture, rule.image_frame || rule.imageFrame || fixture.geometry_fit?.image_frame || fixture.geometry_fit?.imageFrame || 'site');
  if (!item?.bbox || !anchor?.bbox || !frame?.bbox) return null;
  const itemBox = normalizedImageBox(item.bbox, frame.bbox);
  const anchorBox = normalizedImageBox(anchor.bbox, frame.bbox);
  const delta = [
    round(itemBox.center[0] - anchorBox.center[0]),
    round(itemBox.center[1] - anchorBox.center[1])
  ];
  return {
    item_observation_id: item.id,
    anchor_observation_id: anchor.id,
    frame_observation_id: frame.id,
    item_center: itemBox.center,
    anchor_center: anchorBox.center,
    delta_norm: delta
  };
}

function findImageRelation(relations, fixture, rule) {
  const itemAliases = aliasSet(fixture.aliases?.image, rule.item);
  const anchorAliases = aliasSet(fixture.aliases?.image, rule.anchor);
  const inverseType = INVERSE_RELATIONS.get(rule.type);
  return relations.find((relation) => relation.type === rule.type
    && (!rule.image_view || relation.view === rule.image_view)
    && itemAliases.has(relation.item)
    && anchorAliases.has(relation.anchor))
    || (inverseType
      ? relations.find((relation) => relation.type === inverseType
        && (!rule.image_view || relation.view === rule.image_view)
        && itemAliases.has(relation.anchor)
        && anchorAliases.has(relation.item))
      : null)
    || relations.find((relation) => SYMMETRIC_RELATIONS.has(rule.type)
      && relation.type === rule.type
      && (!rule.image_view || relation.view === rule.image_view)
      && itemAliases.has(relation.anchor)
      && anchorAliases.has(relation.item));
}

function evaluateModelRelation(context, fixture, rule, overrideItems = null) {
  const items = overrideItems || context.items;
  const item = findModelItem(items, fixture, rule.item);
  const anchor = findModelItem(items, fixture, rule.anchor);
  if (!item || !anchor) {
    return {
      ok: false,
      message: `Missing model item(s) for ${rule.item} ${rule.type} ${rule.anchor}.`,
      evidence: { item_found: Boolean(item), anchor_found: Boolean(anchor) },
      delta_norm: [0, 0]
    };
  }
  const axes = normalizeAxes(rule.model_axes || rule.modelAxes || fixture.model?.axes || context.axes);
  const frame = context.frame;
  const itemBox = projectedBounds(item.bounding_box, axes);
  const anchorBox = projectedBounds(anchor.bounding_box, axes);
  const itemCenter = normalizedCenter(item.bounding_box, axes, frame);
  const anchorCenter = normalizedCenter(anchor.bounding_box, axes, frame);
  const delta = [round(itemCenter[0] - anchorCenter[0]), round(itemCenter[1] - anchorCenter[1])];
  const minDelta = rule.min_model_delta ?? rule.min_delta ?? 0.02;
  const tolerance = rule.model_tolerance ?? rule.tolerance ?? 0.055;
  const ok = relationSatisfied(rule.type, { itemBox, anchorBox, delta, minDelta, tolerance, frame });
  return {
    ok,
    type: rule.type,
    item: item.id || item.name,
    anchor: anchor.id || anchor.name,
    delta_norm: delta,
    min_delta: minDelta,
    tolerance,
    evidence: {
      item_center: itemCenter,
      anchor_center: anchorCenter,
      model_axes: axes
    }
  };
}

function relationSatisfied(type, { itemBox, anchorBox, delta, minDelta, tolerance, frame }) {
  if (type === 'right_of') return delta[0] > minDelta;
  if (type === 'left_of') return delta[0] < -minDelta;
  if (type === 'above') return delta[1] > minDelta;
  if (type === 'below') return delta[1] < -minDelta;
  if (type === 'same_row') return Math.abs(delta[1]) <= tolerance && Math.abs(delta[0]) >= minDelta;
  if (type === 'aligned_with') return Math.abs(delta[0]) <= tolerance || Math.abs(delta[1]) <= tolerance;
  if (type === 'centered_on') return Math.abs(delta[0]) <= tolerance && Math.abs(delta[1]) <= tolerance * 1.6;
  if (type === 'inside') return containsProjected(anchorBox, itemBox, tolerance * frameExtent(frame));
  if (type === 'touching') return projectedTouching(itemBox, anchorBox, frame, tolerance);
  if (type === 'mirrored_pair') return projectedMirroredPair(itemBox, anchorBox, frame, tolerance);
  return false;
}

function findModelItem(items, fixture, key) {
  const aliases = aliasSet(fixture.aliases?.model, key);
  return items.find((item) => aliases.has(item.id) || aliases.has(item.name) || aliases.has(item.qa?.part_id));
}

function aliasSet(aliasRoot = {}, key) {
  const aliases = new Set([key]);
  for (const value of aliasRoot[key] || []) aliases.add(value);
  return aliases;
}

function frameBox(items, frameRefs) {
  const refs = new Set(frameRefs);
  const selected = refs.size
    ? items.filter((item) => refs.has(item.id) || refs.has(item.name) || refs.has(item.qa?.part_id))
    : items;
  const boxes = (selected.length ? selected : items).map((item) => item.bounding_box).filter(Boolean);
  return mergeBoxes(boxes);
}

function projectedBounds(box, axes) {
  const first = AXIS_INDEX[axes[0]];
  const second = AXIS_INDEX[axes[1]];
  return {
    min: [box.min[first], box.min[second]],
    max: [box.max[first], box.max[second]],
    w: box.max[first] - box.min[first],
    h: box.max[second] - box.min[second]
  };
}

function normalizedCenter(box, axes, frame) {
  const projected = projectedBounds(box, axes);
  const frameBounds = projectedBounds(frame, axes);
  return [
    round(((projected.min[0] + projected.max[0]) / 2 - frameBounds.min[0]) / Math.max(1, frameBounds.w)),
    round(((projected.min[1] + projected.max[1]) / 2 - frameBounds.min[1]) / Math.max(1, frameBounds.h))
  ];
}

function normalizedProjectedBox(box, axes, frame) {
  const projected = projectedBounds(box, axes);
  const frameBounds = projectedBounds(frame, axes);
  const min = [
    round((projected.min[0] - frameBounds.min[0]) / Math.max(1, frameBounds.w)),
    round((projected.min[1] - frameBounds.min[1]) / Math.max(1, frameBounds.h))
  ];
  const max = [
    round((projected.max[0] - frameBounds.min[0]) / Math.max(1, frameBounds.w)),
    round((projected.max[1] - frameBounds.min[1]) / Math.max(1, frameBounds.h))
  ];
  return boxFromMinMax(min, max);
}

function normalizedImageBox(bbox, frameBbox) {
  const minU = (bbox[0] - frameBbox[0]) / Math.max(1, frameBbox[2]);
  const maxU = (bbox[0] + bbox[2] - frameBbox[0]) / Math.max(1, frameBbox[2]);
  const minV = 1 - ((bbox[1] + bbox[3] - frameBbox[1]) / Math.max(1, frameBbox[3]));
  const maxV = 1 - ((bbox[1] - frameBbox[1]) / Math.max(1, frameBbox[3]));
  return boxFromMinMax([round(minU), round(minV)], [round(maxU), round(maxV)]);
}

function normalizedContourBox(observation, frameBbox) {
  const polygon = observation.mask?.sampled_contour || observation.mask?.polygon || observation.contour?.polygon;
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  const xs = polygon.map((point) => point[0]).filter(Number.isFinite);
  const ys = polygon.map((point) => point[1]).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return normalizedImageBox([
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys)
  ], frameBbox);
}

function normalizedContourPolygon(observation, frameBbox) {
  const polygon = observation.mask?.sampled_contour || observation.mask?.polygon || observation.contour?.polygon;
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  const points = polygon
    .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [
      round((point[0] - frameBbox[0]) / Math.max(1, frameBbox[2])),
      round(1 - ((point[1] - frameBbox[1]) / Math.max(1, frameBbox[3])))
    ]);
  return points.length ? points : null;
}

function normalizedBoxPolygon(box) {
  return [
    [box.min[0], box.min[1]],
    [box.max[0], box.min[1]],
    [box.max[0], box.max[1]],
    [box.min[0], box.max[1]],
    [box.min[0], box.min[1]]
  ];
}

function boxFromMinMax(min, max) {
  return {
    min,
    max,
    center: [round((min[0] + max[0]) / 2), round((min[1] + max[1]) / 2)],
    extent: [round(max[0] - min[0]), round(max[1] - min[1])]
  };
}

function area(box) {
  return Math.max(0, box.extent?.[0] || 0) * Math.max(0, box.extent?.[1] || 0);
}

function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return round(Math.abs(sum) / 2);
}

function polygonBounds(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const xs = points.map((point) => point[0]).filter(Number.isFinite);
  const ys = points.map((point) => point[1]).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return boxFromMinMax([round(Math.min(...xs)), round(Math.min(...ys))], [round(Math.max(...xs)), round(Math.max(...ys))]);
}

function convexHull(points) {
  const uniquePoints = [...new Map((points || [])
    .filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]))
    .map((point) => [`${point[0]},${point[1]}`, point])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (uniquePoints.length <= 2) return uniquePoints;
  const lower = [];
  for (const point of uniquePoints) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = uniquePoints.length - 1; index >= 0; index -= 1) {
    const point = uniquePoints[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function cross(origin, a, b) {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}

function boxIou(a, b) {
  const minX = Math.max(a.min[0], b.min[0]);
  const minY = Math.max(a.min[1], b.min[1]);
  const maxX = Math.min(a.max[0], b.max[0]);
  const maxY = Math.min(a.max[1], b.max[1]);
  const intersection = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  const union = area(a) + area(b) - intersection;
  return round(union > 0 ? intersection / union : 0);
}

function maxBoxDimensionRatio(a, b) {
  return round(Math.max(dimensionRatio(a.extent?.[0], b.extent?.[0]), dimensionRatio(a.extent?.[1], b.extent?.[1])));
}

function dimensionRatio(a, b) {
  const first = Math.max(0.000001, Math.abs(Number(a) || 0));
  const second = Math.max(0.000001, Math.abs(Number(b) || 0));
  return Math.max(first / second, second / first);
}

function dominantAxis(box) {
  return (box.extent?.[0] || 0) >= (box.extent?.[1] || 0) ? 'x' : 'y';
}

function compactContour(contour) {
  if (!contour) return null;
  return {
    kind: contour.kind,
    sample_count: contour.sample_count ?? contour.polygon?.length ?? null,
    source: contour.source || null
  };
}

function containsProjected(outer, inner, tolerance) {
  return inner.min[0] >= outer.min[0] - tolerance
    && inner.max[0] <= outer.max[0] + tolerance
    && inner.min[1] >= outer.min[1] - tolerance
    && inner.max[1] <= outer.max[1] + tolerance;
}

function projectedTouching(a, b, frame, tolerance) {
  const gapX = Math.max(0, Math.max(b.min[0] - a.max[0], a.min[0] - b.max[0]));
  const gapY = Math.max(0, Math.max(b.min[1] - a.max[1], a.min[1] - b.max[1]));
  return gapX / Math.max(1, frame.w || 1) <= tolerance || gapY / Math.max(1, frame.d || frame.h || 1) <= tolerance;
}

function projectedMirroredPair(a, b, frame, tolerance) {
  const frameBounds = projectedBounds(frame, ['x', 'y']);
  const centerX = (frameBounds.min[0] + frameBounds.max[0]) / 2;
  const aCenter = (a.min[0] + a.max[0]) / 2;
  const bCenter = (b.min[0] + b.max[0]) / 2;
  const rowError = Math.abs((a.min[1] + a.max[1]) / 2 - (b.min[1] + b.max[1]) / 2) / Math.max(1, frameBounds.h);
  const mirrorError = Math.abs((aCenter + bCenter) / 2 - centerX) / Math.max(1, frameBounds.w);
  return mirrorError <= tolerance && rowError <= tolerance * 1.5;
}

function transformItems(items, frame, axes, transform) {
  if (transform !== 'mirror_x') return items;
  const axisIndex = AXIS_INDEX[axes[0]];
  const center = (frame.min[axisIndex] + frame.max[axisIndex]) / 2;
  return items.map((item) => ({
    ...item,
    bounding_box: mirrorBox(item.bounding_box, axisIndex, center)
  }));
}

function mirrorBox(box, axisIndex, center) {
  const min = [...box.min];
  const max = [...box.max];
  const nextMin = [...min];
  const nextMax = [...max];
  nextMin[axisIndex] = round(center - (max[axisIndex] - center));
  nextMax[axisIndex] = round(center - (min[axisIndex] - center));
  return {
    ...box,
    min: nextMin,
    max: nextMax,
    w: nextMax[0] - nextMin[0],
    d: nextMax[1] - nextMin[1],
    h: nextMax[2] - nextMin[2]
  };
}

function mergeBoxes(boxes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max, w: max[0] - min[0], d: max[1] - min[1], h: max[2] - min[2] };
}

function normalizeAxes(axes) {
  return axes.map((axis) => {
    if (!Object.hasOwn(AXIS_INDEX, axis)) throw new Error(`Unknown model projection axis: ${axis}`);
    return axis;
  });
}

function frameExtent(frame) {
  return Math.max(1, Math.abs(frame.w || 0), Math.abs(frame.d || 0), Math.abs(frame.h || 0));
}

function correctionSuggestions(issues) {
  return issues.map((item) => {
    if (item.type === 'geometry_fit.grounding_ambiguity') {
      return {
        action: 'refine_segmentation_or_hold_candidate',
        target: `image_observation[${item.evidence?.observation_id || item.rule_id}]`,
        reason: item.message,
        evidence: item.evidence?.grounding_quality?.reasons || []
      };
    }
    if (item.type === 'geometry_fit.footprint_residual') {
      return {
        action: 'update_part_graph',
        target: `parts[${item.rule_id}].shape.parameters`,
        reason: item.message,
        evidence: item.evidence?.observation_id || null
      };
    }
    if (item.type === 'geometry_fit.relation_residual') {
      return {
        action: 'review_projection_or_relation',
        target: `visual_relation_rules[${item.rule_id}]`,
        reason: item.message
      };
    }
    if (item.type === 'geometry_fit.ungrounded_image_claim') {
      return {
        action: 'downgrade_grounding_status',
        target: `qa[${item.rule_id}]`,
        reason: item.message
      };
    }
    if (item.type === 'geometry_fit.helper_heavy_dense_detail') {
      return {
        action: 'add_image_evidence_or_exclude_from_photo_grade',
        target: 'dense_detail_grounding',
        reason: item.message,
        evidence: item.evidence
      };
    }
    if (item.type === 'geometry_fit.site_region_overlap' || item.type === 'geometry_fit.site_region_gap' || item.type === 'geometry_fit.internal_road_proxy') {
      return {
        action: 'update_site_region_graph',
        target: item.rule_id,
        reason: item.message,
        evidence: item.evidence
      };
    }
    if (item.type === 'geometry_fit.parking_line_missing_evidence' || item.type === 'geometry_fit.parking_layout_residual') {
      return {
        action: 'refit_parking_layout_graph',
        target: item.rule_id,
        reason: item.message,
        evidence: item.evidence
      };
    }
    if (item.type === 'geometry_fit.roof_feature_missing_host' || item.type === 'geometry_fit.floating_roof_feature' || item.type === 'geometry_fit.roof_feature_direction_review') {
      return {
        action: 'bind_feature_to_roof_surface',
        target: item.rule_id,
        reason: item.message,
        evidence: item.evidence
      };
    }
    if (item.type === 'geometry_fit.tank_ellipse_missing_instance' || item.type === 'geometry_fit.tank_ellipse_residual') {
      return {
        action: 'refit_tank_ellipse_instances',
        target: item.rule_id,
        reason: item.message,
        evidence: item.evidence
      };
    }
    return {
      action: 'review_geometry_fit_input',
      target: item.rule_id || item.type,
      reason: item.message
    };
  });
}

function issue(type, rule, message, evidence = null, severity = 'error') {
  return {
    severity: rule.severity || severity,
    type,
    rule_id: rule.id,
    message,
    evidence
  };
}

function relativeError(value, expected) {
  return Math.abs(Number(value) - Number(expected)) / Math.max(0.000001, Math.abs(Number(expected)));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function max(values) {
  return values.length ? Math.max(...values) : 0;
}

function countBy(items, key) {
  const result = {};
  for (const item of items || []) {
    const value = item?.[key] || 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

function parseCodeDocument(code) {
  if (!code) return null;
  try {
    return typeof code === 'string' ? JSON.parse(code) : code;
  } catch {
    return null;
  }
}

function calibrateViews({ observations, fixture, primaryCalibration }) {
  return (observations.images || []).map((image) => {
    const view = image.detected_view?.kind || 'unknown';
    const frameKey = view === primaryCalibration.image_view
      ? primaryCalibration.image_frame?.key
      : fixture.geometry_fit?.oblique_frame || fixture.geometry_fit?.image_frame || 'site';
    const frame = findImageObservation(image, fixture, frameKey);
    const hints = image.camera_hints || {};
    return {
      version: 2,
      source_image: image.image?.path,
      view,
      projection_model: view === 'top' ? 'site_affine' : (hints.projection_model || 'weak_perspective_review_gate'),
      frame_observation_id: frame?.id || null,
      frame_bbox: frame?.bbox || null,
      scale_basis: view === primaryCalibration.image_view ? primaryCalibration.image_to_site_transform : null,
      vanishing_lines: hints.vanishing_lines || [],
      vanishing_points: hints.vanishing_points || [],
      horizon_line: hints.horizon_line || null,
      review_required: view !== 'top' || Boolean(hints.review_required),
      residual_summary: view === primaryCalibration.image_view ? primaryCalibration.residual_summary : null
    };
  });
}

function evaluateMultiViewConsistency(observations, fixture, calibration) {
  const top = (observations.images || []).find((image) => image.detected_view?.kind === 'top');
  const obliqueImages = (observations.images || []).filter((image) => image.detected_view?.kind === 'oblique');
  const aliases = fixture.aliases?.image || {};
  const keys = unique(Object.keys(aliases).filter((key) => key !== 'site'));
  const checks = [];
  if (!top || obliqueImages.length === 0) {
    return {
      version: 2,
      checked_items: 0,
      review_required: true,
      checks,
      note: 'Multi-view consistency is review-gated because top or oblique image evidence is missing.'
    };
  }
  for (const key of keys) {
    const topObservation = findImageObservation(top, fixture, key);
    const obliqueObservation = obliqueImages
      .map((image) => ({ image, observation: findImageObservation(image, fixture, key) }))
      .find((item) => item.observation?.bbox);
    if (!topObservation?.bbox || !obliqueObservation?.observation?.bbox) continue;
    checks.push({
      item: key,
      top_observation_id: topObservation.id,
      oblique_observation_id: obliqueObservation.observation.id,
      top_view_grounding: topObservation.grounding?.method || topObservation.mask?.method || topObservation.kind,
      oblique_view_grounding: obliqueObservation.observation.grounding?.method || obliqueObservation.observation.mask?.method || obliqueObservation.observation.kind,
      residual: null,
      review_required: true,
      note: 'Grounding v2 records cross-view evidence presence; true pose/depth residual remains a review gate.'
    });
  }
  return {
    version: 2,
    checked_items: checks.length,
    review_required: checks.length === 0,
    checks,
    note: checks.length
      ? 'Top/oblique evidence exists for these items; exact pose/depth calibration is not yet solved.'
      : 'No matching top/oblique item evidence found for multi-view consistency.'
  };
}

function ratio(value, total) {
  return total > 0 ? round(value / total) : 0;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value !== undefined && value !== null && value !== ''))];
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

function resolveRepo(relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.resolve(repoRoot, relativePath);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--fixture') options.fixture = argv[++index];
    else if (arg === '--code') options.code = argv[++index];
    else if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--mock-session-path') options.mockSessionPath = argv[++index];
    else if (arg === '--require-pass') options.requirePass = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/validate-geometry-fit.mjs \\
    --observations projects/image-structured-modeler/examples/building-group/observations.json \\
    --fixture projects/image-structured-modeler/examples/building-group/visual-relations.candidates.fixture.json \\
    --code projects/image-structured-modeler/examples/building-group/output.part-candidates-applied.json \\
    --output projects/image-structured-modeler/examples/building-group/proposal-qa-candidates/geometry-fit-report.json
`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
