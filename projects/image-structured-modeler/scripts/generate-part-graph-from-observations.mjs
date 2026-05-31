#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './lib/image-analysis.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const observationsPath = path.resolve(repoRoot, options.observations || 'projects/image-structured-modeler/examples/ambulance/observations.json');
  const profilePath = path.resolve(repoRoot, options.profile || 'examples/product-profiles/vehicle_ambulance.json');
  const seedPath = options.seedPartGraph
    ? path.resolve(repoRoot, options.seedPartGraph)
    : null;
  const output = path.resolve(repoRoot, options.output || 'projects/image-structured-modeler/examples/ambulance/part-graph.generated.json');

  const [observations, profile, seedPartGraph] = await Promise.all([
    readJson(observationsPath),
    readJson(profilePath),
    seedPath ? readJson(seedPath) : null
  ]);
  const partGraph = generatePartGraphFromObservations(observations, profile, {
    seedPartGraph,
    id: options.id,
    productName: options.productName
  });

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(partGraph, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output,
    parts: partGraph.parts.length,
    observed_parts: partGraph.parts.filter((part) => part.evidence_status === 'observed').length,
    inferred_parts: partGraph.parts.filter((part) => part.evidence_status === 'inferred').length,
    needs_review: partGraph.review?.correction_targets?.length || 0
  }, null, 2)}\n`);
}

export function generatePartGraphFromObservations(observationSet, profile, options = {}) {
  if (isBuildingGroupProfile(observationSet, profile)) {
    return generateBuildingGroupPartGraphFromObservations(observationSet, profile, options);
  }
  const seed = options.seedPartGraph ? cloneJson(options.seedPartGraph) : skeletonPartGraph(observationSet, profile, options);
  seed.version = seed.version || 1;
  seed.id = options.id || seed.id || `${profile.profile_id || observationSet.object?.profile || 'image'}-image-evidence-part-graph`;
  seed.profile_id = seed.profile_id || profile.profile_id || observationSet.object?.profile;
  seed.dsl_version = seed.dsl_version || profile.dsl_version || 1;
  seed.units = seed.units || profile.units || 'mm';
  seed.product = {
    type: observationSet.object?.type || profile.product_type || seed.product?.type || 'product',
    name: options.productName || observationSet.object?.name || seed.product?.name || profile.name,
    source: `${observationSet.object?.source_images?.length || 0} image evidence record(s)`
  };

  const scaleCalibration = observationSet.scale_calibration || observationSet.evidence_graph?.scale_calibration || null;
  seed.scale = calibratedScale(seed.scale, profile, scaleCalibration);

  const observationGraphParts = new Map((observationSet.evidence_graph?.parts || []).map((part) => [part.part_id, part]));
  const profileRequirements = requirementsByRole(profile);
  const graphParts = [];
  const partMatches = [];
  const correctionTargets = [];
  const allParameterProposals = [];
  const observationIndex = buildObservationIndex(observationSet);

  seed.parts = (seed.parts || []).map((part) => {
    const observed = observationGraphParts.get(part.id);
    const requiredViews = observed?.required_views || profileRequirements.get(part.role)?.evidence_required || [];
    const sources = sourcesForPart(part, observed, observationSet, observationGraphParts);
    const confirmedViews = unique(sources
      .filter((source) => source.status === 'observed' || source.status === 'manual_confirmed')
      .map((source) => source.view)
      .filter(Boolean));
    const missingViews = requiredViews.filter((view) => !confirmedViews.includes(view));
    const confidence = partEvidenceConfidence({ sources, requiredViews, missingViews, scaleCalibration });
    const evidenceStatus = evidenceStatusForPart({ sources, requiredViews, missingViews, confidence });
    const next = {
      ...part,
      evidence_status: evidenceStatus,
      evidence_sources: sources.length ? sources : [profileDefaultEvidenceSource(part)],
      fallback_state: fallbackStateForPart(part, evidenceStatus, confidence),
      qa: {
        ...(part.qa || {}),
        generated_from_image_evidence: true,
        evidence_confidence: confidence,
        missing_views: missingViews
      }
    };

    if (next.feature_intents?.length) {
      next.feature_intents = next.feature_intents.map((feature) => ({
        ...feature,
        evidence_sources: sources.length ? sources.slice(0, 3) : feature.evidence_sources,
        fallback_state: feature.fallback_state === 'real_feature_op' && confidence >= 0.58
          ? feature.fallback_state
        : 'needs_review'
      }));
    }

    const parameterProposals = parameterProposalsForPart({
      part: next,
      requirement: profileRequirements.get(part.role),
      scale: seed.scale,
      sources: next.evidence_sources,
      requiredViews,
      confirmedViews,
      missingViews,
      confidence,
      observationSet,
      observationIndex
    });
    if (parameterProposals.length) {
      next.parameter_proposals = parameterProposals;
      allParameterProposals.push(...parameterProposals);
    }

    const graphPart = {
      part_id: part.id,
      status: evidenceStatus,
      required_views: requiredViews,
      confirmed_views: confirmedViews,
      missing_views: missingViews,
      confidence,
      sources: next.evidence_sources,
      parameter_proposals: parameterProposals.map((proposal) => ({
        parameter: proposal.parameter,
        path: proposal.path,
        confidence: proposal.confidence,
        status: proposal.status,
        review_required: proposal.review_required
      })),
      conflicts: conflictsForPart({ part, missingViews, confidence, sources }),
      open_questions: openQuestionsForPart({ part, missingViews, confidence, sources })
    };
    graphParts.push(graphPart);
    partMatches.push({
      part_id: part.id,
      strategy: 'component_hint_view_requirement',
      matched_views: confirmedViews,
      missing_views: missingViews,
      source_count: sources.length,
      confidence
    });
    if (graphPart.open_questions.length > 0) {
      correctionTargets.push({
        part_id: part.id,
        path: `parts[${part.id}].shape.parameters`,
        reason: graphPart.open_questions[0],
        severity: graphPart.status === 'needs_review' || graphPart.status === 'profile_default' ? 'warn' : 'info'
      });
    }
    if (parameterProposals.length > 0) {
      correctionTargets.push({
        part_id: part.id,
        path: `parts[${part.id}].parameter_proposals`,
        reason: `${part.id}: review ${parameterProposals.length} image-scale parameter proposal(s) before applying no-seed geometry.`,
        severity: parameterProposals.some((proposal) => proposal.review_required) ? 'warn' : 'info'
      });
    }
    return next;
  });

  const reviewParameterProposals = uniqueParameterProposals([
    ...(seed.review?.parameter_proposals || []),
    ...allParameterProposals
  ]);
  seed.evidence_graph = {
    version: 1,
    source_images: observationSet.object?.source_images || [],
    views_detected: observationSet.views_detected || [],
    open_questions: unique([
      ...(observationSet.evidence_graph?.open_questions || []),
      ...graphParts.flatMap((part) => part.open_questions)
    ]),
    ...(scaleCalibration ? { scale_calibration: scaleCalibration } : {}),
    part_matches: partMatches,
    parts: graphParts
  };
  seed.review = {
    ...(seed.review || {}),
    fallback_summary: fallbackSummary(seed.parts),
    parameter_proposal_summary: parameterProposalSummary(reviewParameterProposals),
    parameter_proposals: reviewParameterProposals,
    open_questions: unique([...(seed.review?.open_questions || []), ...seed.evidence_graph.open_questions]),
    correction_targets: uniqueCorrectionTargets([...(seed.review?.correction_targets || []), ...correctionTargets])
  };
  return seed;
}

function calibratedScale(seedScale = {}, profile = {}, scaleCalibration = null) {
  const defaults = scaleCalibration?.default_scale || profile.default_scale || {};
  const confidence = scaleCalibration?.confidence ?? seedScale.confidence ?? 0.42;
  const evidenceSources = (scaleCalibration?.measurements || []).map((measurement) => ({
    kind: 'scale_calibration',
    view: measurement.view,
    source_image: measurement.source_image,
    status: 'observed',
    confidence: measurement.confidence,
    note: scaleMeasurementNote(measurement)
  }));
  return {
    width: seedScale.width || defaults.width,
    depth: seedScale.depth || defaults.depth,
    height: seedScale.height || defaults.height,
    confidence,
    ...(scaleCalibration ? { calibration: scaleCalibration } : {}),
    ...(evidenceSources.length ? { evidence_sources: evidenceSources } : {})
  };
}

function scaleMeasurementNote(measurement) {
  const dimensions = [];
  if (measurement.physical_width_mm) dimensions.push(`width ${measurement.physical_width_mm}mm`);
  if (measurement.physical_height_mm) dimensions.push(`height ${measurement.physical_height_mm}mm`);
  const basis = dimensions.length ? dimensions.join(', ') : 'known-element scale';
  return `bbox ${measurement.object_bbox?.join(',')} -> ${basis} calibration`;
}

function isBuildingGroupProfile(observationSet = {}, profile = {}) {
  return profile.profile_id === 'building_group_industrial_campus'
    || observationSet.object?.profile === 'building_group'
    || observationSet.object?.type === 'building_group';
}

function generateBuildingGroupPartGraphFromObservations(observationSet, profile, options = {}) {
  const scaleCalibration = observationSet.scale_calibration || observationSet.evidence_graph?.scale_calibration || null;
  const scale = calibratedScale({}, profile, scaleCalibration);
  const topImage = (observationSet.images || []).find((image) => image.detected_view.kind === 'top');
  if (!topImage) throw new Error('building_group PartGraph generation requires a top-view observation');
  const siteObservation = findObservation(topImage, 'building_top_site_boundary')
    || findObservationByHint(topImage, 'site_boundary')
    || { id: 'site_boundary_from_bbox', bbox: topImage.metrics?.object_bbox };
  if (!siteObservation?.bbox) throw new Error('building_group PartGraph generation requires a site boundary bbox');
  const siteMeasurement = (scaleCalibration?.measurements || []).find((item) => item.anchor_type === 'site_boundary_from_known_anchors');
  const pixelsPerMmX = siteMeasurement?.pixels_per_mm_x || siteObservation.bbox[2] / scale.width;
  const pixelsPerMmY = siteMeasurement?.pixels_per_mm_y || siteObservation.bbox[3] / scale.depth;
  const context = { observationSet, profile, scale, scaleCalibration, topImage, siteObservation, pixelsPerMmX, pixelsPerMmY };

  const massingParts = [
    sitePart(context),
    boxPartFromObservation(context, 'primary_blue_roof_hall', {
      name: 'Primary_Blue_Roof_Hall_Massing',
      type: 'building',
      role: 'production_hall',
      material: 'Campus_Blue_Roof',
      height: 16500,
      fallback_state: 'box_approximation'
    }),
    boxPartFromObservation(context, 'warehouse_row_west', {
      name: 'West_Warehouse_Row_Massing',
      type: 'building',
      role: 'warehouse_row',
      material: 'Campus_Warehouse_Light',
      height: 9500,
      fallback_state: 'box_approximation'
    }),
    boxPartFromObservation(context, 'warehouse_row_inner', {
      name: 'Inner_Warehouse_Row_Massing',
      type: 'building',
      role: 'warehouse_row',
      material: 'Campus_Warehouse_Light',
      height: 9500,
      fallback_state: 'box_approximation'
    }),
    boxPartFromObservation(context, 'utility_building', {
      name: 'Utility_Building_Massing',
      type: 'building',
      role: 'utility_building',
      material: 'Campus_Utility_Gray',
      height: 7600,
      fallback_state: 'box_approximation'
    }),
    boxPartFromObservation(context, 'admin_office', {
      name: 'Admin_Office_Massing',
      type: 'building',
      role: 'admin_office',
      material: 'Campus_Office_Light',
      height: 6800,
      fallback_state: 'box_approximation'
    }),
    boxPartFromObservation(context, 'parking_lot', {
      name: 'Parking_Lot_Flat_Massing',
      type: 'site_surface',
      role: 'parking_lot',
      material: 'Campus_Parking_Asphalt',
      height: 80,
      fallback_state: 'visual_helper'
    }),
    boxPartFromObservation(context, 'internal_roads', {
      name: 'Internal_Roads_Flat_Massing',
      type: 'site_surface',
      role: 'internal_roads',
      material: 'Campus_Road_Asphalt',
      height: 70,
      fallback_state: 'visual_helper'
    }),
    ...tankFarmParts(context),
    ...scaleAnchorParts(context)
  ].filter(Boolean).map((part) => withBuildingDetailProposals(part));

  const parameterProposals = massingParts.flatMap((part) => part.parameter_proposals || []);
  const correctionTargets = [
    {
      path: 'scale.calibration.measurements',
      reason: 'Confirm at least one parking, road, crosswalk, or surveyed site dimension before accepting building-group scale.',
      severity: 'warn'
    },
    {
      path: 'review.orientation.north_up',
      reason: 'Confirm campus north/up convention before mapping image axes to model axes.',
      severity: 'warn'
    },
    ...massingParts.map((part) => ({
      part_id: part.id,
      path: `parts[${part.id}].shape.parameters`,
      reason: `${part.id}: review image-derived massing dimensions before applying to a final building PartGraph.`,
      severity: part.role === 'scale_anchor' ? 'info' : 'warn'
    })),
    ...buildingDetailCorrectionTargets(massingParts)
  ];
  const graphParts = massingParts.map((part) => evidenceGraphPartForBuildingPart(part));
  return {
    version: 1,
    id: options.id || 'building-group-image-evidence-massing-part-graph',
    profile_id: profile.profile_id,
    dsl_version: profile.dsl_version || 1,
    units: profile.units || 'mm',
    product: {
      type: observationSet.object?.type || profile.product_type,
      name: options.productName || observationSet.object?.name || profile.name,
      source: `${observationSet.object?.source_images?.length || 0} building-group image evidence record(s)`
    },
    scale,
    evidence_graph: {
      version: 1,
      source_images: observationSet.object?.source_images || [],
      views_detected: observationSet.views_detected || [],
      open_questions: unique([
        ...(observationSet.evidence_graph?.open_questions || []),
        'Confirm known-element scale anchors against at least one real site dimension.',
        'Confirm north/up and image-to-model axis convention before finalizing the massing PartGraph.'
      ]),
      ...(scaleCalibration ? { scale_calibration: scaleCalibration } : {}),
      part_matches: graphParts.map((part) => ({
        part_id: part.part_id,
        strategy: 'building_group_top_bbox_to_massing',
        matched_views: part.confirmed_views,
        missing_views: part.missing_views,
        source_count: part.sources.length,
        confidence: part.confidence
      })),
      parts: graphParts
    },
    parts: massingParts,
    physical_relations: massingParts
      .filter((part) => !['site_boundary', 'scale_anchor'].includes(part.role))
      .map((part) => ({
        id: `${part.id}-grounded`,
        type: 'grounded',
        subject: part.id,
        ground_z: 0,
        severity: 'info',
        note: 'R7 massing parts are grounded to the provisional site plane for review.'
      })),
    review: {
      fallback_summary: fallbackSummary(massingParts),
      parameter_proposal_summary: parameterProposalSummary(parameterProposals),
      parameter_proposals: parameterProposals,
      open_questions: [
        'Confirm parking bay count, parking bay dimensions, and drive aisle width used for scale.',
        'Confirm campus north/up before interpreting east/west or front/back labels.',
        'Replace bbox-derived boxes with reviewed roofline, facade, and opening geometry before queue acceptance.'
      ],
      correction_targets: uniqueCorrectionTargets(correctionTargets)
    }
  };
}

function sitePart(context) {
  const { scale, siteObservation } = context;
  const parameters = {
    origin: [round(-scale.width / 2, 1), round(-scale.depth / 2, 1), -80],
    size: [round(scale.width, 1), round(scale.depth, 1), 80]
  };
  return buildingPart({
    id: 'site_boundary',
    name: 'Site_Boundary_Scale_Slab',
    type: 'site_surface',
    role: 'site_boundary',
    material: 'Campus_Site_Slab',
    shape: { primitive: 'box', parameters },
    sources: buildingEvidenceSources(context, 'site_boundary', siteObservation),
    fallback_state: 'reference_only',
    confidence: 0.62
  });
}

function boxPartFromObservation(context, partId, spec) {
  const observation = findObservationByHint(context.topImage, partId);
  if (!observation?.bbox) return null;
  const rect = bboxToModelRect(context, observation.bbox);
  return buildingPart({
    id: partId,
    name: spec.name,
    type: spec.type,
    role: spec.role,
    material: spec.material,
    shape: {
      primitive: 'box',
      parameters: {
        origin: [rect.x, rect.y, 0],
        size: [rect.width, rect.depth, spec.height]
      }
    },
    sources: buildingEvidenceSources(context, partId, observation),
    fallback_state: spec.fallback_state,
    confidence: spec.confidence || 0.58
  });
}

function tankFarmParts(context) {
  const observation = findObservationByHint(context.topImage, 'tank_farm');
  if (!observation?.bbox) return [];
  const rect = bboxToModelRect(context, observation.bbox);
  const radius = round(Math.min(rect.width * 0.16, rect.depth * 0.38), 1);
  const centerY = round(rect.y + rect.depth * 0.5, 1);
  const centers = [
    { id: 'tank_farm', name: 'Tank_Farm_West_Silo', x: round(rect.x + rect.width * 0.32, 1) },
    { id: 'tank_farm_silo_east', name: 'Tank_Farm_East_Silo', x: round(rect.x + rect.width * 0.68, 1) }
  ];
  return centers.map((center) => buildingPart({
    id: center.id,
    name: center.name,
    type: 'tank',
    role: center.id === 'tank_farm' ? 'tank_farm' : 'tank',
    material: 'Campus_Tank_Metal',
    shape: {
      primitive: 'cylinder',
      parameters: {
        origin: [center.x, centerY, 0],
        radius,
        height: 14000,
        segments: 32,
        smooth: 'all'
      }
    },
    sources: buildingEvidenceSources(context, 'tank_farm', observation),
    fallback_state: 'structured_primitive',
    confidence: 0.56
  }));
}

function scaleAnchorParts(context) {
  const measurements = (context.scaleCalibration?.measurements || [])
    .filter((measurement) => measurement.anchor_type?.startsWith('parking_') || measurement.anchor_type === 'crosswalk_width');
  return measurements
    .filter((measurement) => measurement.object_bbox)
    .map((measurement) => {
      const rect = bboxToModelRect(context, measurement.object_bbox);
      return buildingPart({
        id: `scale_anchor_${measurement.anchor_type}`,
        name: `Scale_Anchor_${measurement.anchor_type}`,
        type: 'scale_anchor',
        role: 'scale_anchor',
        material: 'Campus_Scale_Anchor',
        shape: {
          primitive: 'box',
          parameters: {
            origin: [rect.x, rect.y, 120],
            size: [Math.max(rect.width, 180), Math.max(rect.depth, 180), 120]
          }
        },
        sources: [{
          kind: 'known_element_scale_anchor',
          view: measurement.view,
          source_image: measurement.source_image,
          status: 'observed',
          confidence: measurement.confidence,
          note: `${measurement.anchor_type} scale anchor requires user review before final scale acceptance.`
        }],
        fallback_state: 'visual_helper',
        confidence: measurement.confidence || 0.48
      });
    });
}

function withBuildingDetailProposals(part) {
  const featureIntents = buildingDetailFeatureIntents(part);
  if (!featureIntents.length) return part;
  const proposal = featureIntentProposalForPart(part, featureIntents);
  return {
    ...part,
    parameter_proposals: [...(part.parameter_proposals || []), proposal],
    qa: {
      ...(part.qa || {}),
      detail_review_required: true,
      roofline_review_required: featureIntents.some((feature) => feature.semantic?.includes('roofline')),
      facade_review_required: featureIntents.some((feature) => feature.semantic?.includes('facade')),
      opening_review_required: featureIntents.some((feature) => feature.semantic?.includes('opening'))
    }
  };
}

function buildingDetailCorrectionTargets(parts) {
  return parts
    .filter((part) => (part.parameter_proposals || []).some((proposal) => proposal.proposal_kind === 'feature_intents'))
    .map((part) => ({
      part_id: part.id,
      path: `parts[${part.id}].feature_intents`,
      reason: `${part.id}: review roofline, facade rhythm, and opening feature-intent proposals before applying architectural detail.`,
      severity: 'warn'
    }));
}

function featureIntentProposalForPart(part, featureIntents) {
  const confidence = round(clamp((part.qa?.evidence_confidence || 0.5) - 0.08, 0.24, 0.74), 3);
  const sourceViews = unique((part.evidence_sources || []).map((source) => source.view).filter(Boolean));
  return {
    part_id: part.id,
    proposal_kind: 'feature_intents',
    parameter: 'feature_intents',
    path: `parts[${part.id}].feature_intents`,
    unit: 'target_face_local_mm',
    current_value: part.feature_intents || [],
    proposed_value: featureIntents,
    confidence,
    status: 'needs_review',
    review_required: true,
    basis: [
      'building_group_oblique_roofline_hint',
      'building_group_facade_rhythm_prior',
      'building_group_known_element_scale'
    ],
    source_count: part.evidence_sources?.length || 0,
    source_views: sourceViews,
    required_views: ['top', 'oblique'],
    confirmed_views: sourceViews,
    missing_views: ['facade_orthographic', 'opening_closeup'],
    evidence_sources: featureEvidenceSources(part),
    reason: 'R7 building-group detail proposals are image-derived feature intents and require explicit review before patch application.'
  };
}

function buildingDetailFeatureIntents(part) {
  if (!['production_hall', 'warehouse_row', 'utility_building', 'admin_office'].includes(part.role)) return [];
  const size = part.shape?.parameters?.size || [];
  const [width, depth, height] = size.map(Number);
  if (![width, depth, height].every((value) => Number.isFinite(value) && value > 0)) return [];
  if (part.id === 'primary_blue_roof_hall') return primaryHallFeatureIntents(part, width, depth, height);
  if (part.role === 'warehouse_row') return warehouseRowFeatureIntents(part, width, depth, height);
  if (part.role === 'utility_building') return utilityBuildingFeatureIntents(part, width, depth, height);
  if (part.role === 'admin_office') return adminOfficeFeatureIntents(part, width, depth, height);
  return [];
}

function primaryHallFeatureIntents(part, width, depth, height) {
  return [
    raisedRib(part, 'roof_center_ridge', 'roofline.center_ridge', 'top', [width * 0.5, depth * 0.5], depth * 0.88, Math.max(width * 0.018, 420), 260, 'v'),
    raisedRib(part, 'roof_west_eave_line', 'roofline.eave_line', 'top', [width * 0.18, depth * 0.5], depth * 0.82, 220, 140, 'v'),
    raisedRib(part, 'roof_east_eave_line', 'roofline.eave_line', 'top', [width * 0.82, depth * 0.5], depth * 0.82, 220, 140, 'v'),
    recess(part, 'facade_loading_door', 'facade.opening.loading_door', 'front', [width * 0.5, height * 0.2], [width * 0.13, height * 0.34], 160, 60),
    recess(part, 'facade_window_band_left', 'facade.opening.window_band', 'front', [width * 0.3, height * 0.58], [width * 0.16, height * 0.11], 90, 40),
    recess(part, 'facade_window_band_right', 'facade.opening.window_band', 'front', [width * 0.7, height * 0.58], [width * 0.16, height * 0.11], 90, 40)
  ];
}

function warehouseRowFeatureIntents(part, width, depth, height) {
  return [
    raisedRib(part, 'roof_longitudinal_seam_left', 'roofline.longitudinal_seam', 'top', [width * 0.33, depth * 0.5], depth * 0.9, 160, 110, 'v'),
    raisedRib(part, 'roof_longitudinal_seam_right', 'roofline.longitudinal_seam', 'top', [width * 0.67, depth * 0.5], depth * 0.9, 160, 110, 'v'),
    recess(part, 'facade_loading_bay_left', 'facade.opening.loading_bay', 'front', [width * 0.28, height * 0.27], [width * 0.16, height * 0.36], 120, 40),
    recess(part, 'facade_loading_bay_center', 'facade.opening.loading_bay', 'front', [width * 0.5, height * 0.27], [width * 0.16, height * 0.36], 120, 40),
    recess(part, 'facade_loading_bay_right', 'facade.opening.loading_bay', 'front', [width * 0.72, height * 0.27], [width * 0.16, height * 0.36], 120, 40)
  ];
}

function utilityBuildingFeatureIntents(part, width, depth, height) {
  return [
    raisedRib(part, 'roof_service_ridge', 'roofline.service_ridge', 'top', [width * 0.5, depth * 0.5], depth * 0.72, 180, 120, 'v'),
    slot(part, 'facade_louver_band', 'facade.opening.louver_band', 'front', [width * 0.52, height * 0.62], width * 0.46, height * 0.08, 80),
    recess(part, 'facade_service_door', 'facade.opening.service_door', 'front', [width * 0.22, height * 0.24], [width * 0.11, height * 0.32], 120, 30)
  ];
}

function adminOfficeFeatureIntents(part, width, depth, height) {
  return [
    raisedRib(part, 'roof_parapet_front', 'roofline.parapet_edge', 'top', [width * 0.5, depth * 0.08], width * 0.86, 160, 120, 'u'),
    recess(part, 'facade_entry_door', 'facade.opening.entry_door', 'front', [width * 0.5, height * 0.25], [width * 0.12, height * 0.36], 120, 30),
    recess(part, 'facade_window_left', 'facade.opening.window', 'front', [width * 0.28, height * 0.62], [width * 0.14, height * 0.18], 80, 30),
    recess(part, 'facade_window_right', 'facade.opening.window', 'front', [width * 0.72, height * 0.62], [width * 0.14, height * 0.18], 80, 30)
  ];
}

function raisedRib(part, suffix, semantic, face, center, length, width, height, direction) {
  return featureIntent(part, suffix, 'add_raised_rib', semantic, face, {
    center: roundVector(center),
    length: round(Math.max(length, 1), 1),
    width: round(Math.max(width, 1), 1),
    height: round(Math.max(height, 1), 1),
    direction
  });
}

function recess(part, suffix, semantic, face, center, size, depth, radius) {
  return featureIntent(part, suffix, 'cut_recess', semantic, face, {
    center: roundVector(center),
    size: roundVector(size),
    depth: round(Math.max(depth, 1), 1),
    radius: round(Math.max(radius, 0), 1),
    segments: 4
  });
}

function slot(part, suffix, semantic, face, center, length, width, depth) {
  return featureIntent(part, suffix, 'cut_slot', semantic, face, {
    center: roundVector(center),
    length: round(Math.max(length, width), 1),
    width: round(Math.max(width, 1), 1),
    depth: round(Math.max(depth, 1), 1),
    through: false,
    segments: 8
  });
}

function featureIntent(part, suffix, operation, semantic, face, parameters) {
  return {
    id: `${part.id}_${suffix}`,
    operation,
    face,
    parameters,
    semantic,
    fallback_state: 'needs_review',
    evidence_sources: featureEvidenceSources(part)
  };
}

function featureEvidenceSources(part) {
  return (part.evidence_sources || []).filter((source) => ['top', 'oblique'].includes(source.view)).slice(0, 4);
}

function roundVector(values) {
  return values.map((value) => round(Math.max(value, 0), 1));
}

function buildingPart({ id, name, type, role, material, shape, sources, fallback_state, confidence }) {
  const parameters = cloneJson(shape.parameters);
  const proposal = {
    part_id: id,
    proposal_kind: 'shape_parameters',
    parameter: 'shape.parameters',
    path: `parts[${id}].shape.parameters`,
    unit: 'mm',
    current_value: parameters,
    proposed_value: parameters,
    confidence: round(clamp(confidence, 0.24, 0.82), 3),
    status: 'needs_review',
    review_required: true,
    basis: ['building_group_evidence_bbox', 'known_element_scale_calibration'],
    source_count: sources.length,
    source_views: unique(sources.map((source) => source.view).filter(Boolean)),
    evidence_sources: sources.slice(0, 4),
    reason: 'R7 building-group massing is bbox-derived and must be reviewed before queue acceptance.'
  };
  return {
    id,
    name,
    type,
    role,
    material,
    shape,
    evidence_status: role === 'scale_anchor' ? 'observed' : 'inferred',
    evidence_sources: sources,
    fallback_state,
    parameter_proposals: [proposal],
    qa: {
      generated_from_building_group_evidence: true,
      evidence_confidence: proposal.confidence,
      review_required: true,
      scale_review_required: true,
      orientation_review_required: true
    }
  };
}

function evidenceGraphPartForBuildingPart(part) {
  return {
    part_id: part.id,
    status: part.evidence_status,
    required_views: part.role === 'scale_anchor' ? ['top'] : unique(part.evidence_sources.map((source) => source.view).filter(Boolean)),
    confirmed_views: unique(part.evidence_sources.map((source) => source.view).filter(Boolean)),
    missing_views: [],
    confidence: round(part.qa?.evidence_confidence || 0.5, 3),
    sources: part.evidence_sources,
    parameter_proposals: (part.parameter_proposals || []).map((proposal) => ({
      parameter: proposal.parameter,
      path: proposal.path,
      confidence: proposal.confidence,
      status: proposal.status,
      review_required: proposal.review_required
    })),
    conflicts: [
      {
        type: 'review_gated_massing',
        severity: part.role === 'scale_anchor' ? 'info' : 'warn',
        note: 'Part geometry is derived from top-view bboxes and known-element scale anchors.'
      }
    ],
    open_questions: [
      `${part.id}: confirm massing footprint, height, and orientation before accepting this PartGraph.`
    ]
  };
}

function buildingEvidenceSources(context, evidencePartId, observation) {
  const graphPart = context.observationSet.evidence_graph?.parts?.find((part) => part.part_id === evidencePartId);
  const graphSources = (graphPart?.sources || []).map((source) => ({
    kind: source.kind || 'building_group_image_evidence',
    view: source.view_kind || source.view,
    source_image: source.source_image,
    status: source.status || 'observed',
    confidence: source.confidence,
    note: source.note,
    observation_id: source.observation_id
  }));
  if (graphSources.length) return dedupeSources(graphSources);
  return [{
    kind: observation?.kind || 'component_bbox',
    view: context.topImage.detected_view.kind,
    source_image: context.topImage.image.path,
    status: 'observed',
    confidence: observation?.confidence || 0.5,
    note: observation?.note || `Top-view bbox evidence for ${evidencePartId}.`,
    observation_id: observation?.id
  }];
}

function bboxToModelRect(context, bbox) {
  const [siteX, siteY] = context.siteObservation.bbox;
  const [x, y, width, height] = bbox;
  const modelWidth = round(width / context.pixelsPerMmX, 1);
  const modelDepth = round(height / context.pixelsPerMmY, 1);
  const modelX = round((x - siteX) / context.pixelsPerMmX - context.scale.width / 2, 1);
  const topOffset = (y - siteY) / context.pixelsPerMmY;
  const modelY = round(context.scale.depth / 2 - topOffset - modelDepth, 1);
  return { x: modelX, y: modelY, width: modelWidth, depth: modelDepth };
}

function findObservation(image, id) {
  return (image.observations || []).find((observation) => observation.id === id);
}

function findObservationByHint(image, componentHint) {
  return (image.observations || []).find((observation) => observation.component_hint === componentHint && observation.bbox);
}

function skeletonPartGraph(observationSet, profile, options) {
  const scale = profile.default_scale || { width: 100, depth: 40, height: 50 };
  return {
    version: 1,
    id: options.id || `${profile.profile_id || 'product'}-image-evidence-part-graph`,
    profile_id: profile.profile_id,
    dsl_version: profile.dsl_version || 1,
    units: profile.units || 'mm',
    product: {
      type: observationSet.object?.type || profile.product_type,
      name: options.productName || observationSet.object?.name || profile.name,
      source: 'generated from image observations'
    },
    scale,
    parts: (profile.required_parts || []).map((required, index) => ({
      id: required.id,
      name: `${profile.profile_id || 'Product'}_${required.id}`,
      type: required.role,
      role: required.role,
      shape: {
        primitive: 'rounded_box',
        parameters: {
          origin: [index * 20, 0, scale.height / 2],
          size: [scale.width * 0.2, scale.depth * 0.2, scale.height * 0.2],
          radius: 4
        }
      },
      evidence_status: 'needs_review',
      fallback_state: 'needs_review'
    }))
  };
}

function parameterProposalsForPart({
  part,
  requirement = {},
  scale = {},
  sources = [],
  requiredViews = [],
  confirmedViews = [],
  missingViews = [],
  confidence = 0,
  observationSet = {},
  observationIndex = new Map()
}) {
  const candidate = candidateParameterSet(part, requirement, scale);
  if (!candidate) return [];
  const imageMeasurements = imageMeasurementsForSources({ sources, observationSet, observationIndex });
  const proposalConfidence = parameterProposalConfidence({
    partConfidence: confidence,
    scaleConfidence: scale.confidence,
    measurements: imageMeasurements,
    requiredViews,
    confirmedViews,
    missingViews
  });
  const sourceStatuses = unique(sources.map((source) => source.status).filter(Boolean));
  const sourceViews = unique(sources.map((source) => source.view).filter(Boolean));
  const reviewRequired = (
    missingViews.length > 0
    || proposalConfidence < 0.72
    || !sourceStatuses.some((status) => status === 'observed' || status === 'manual_confirmed')
  );
  const common = {
    part_id: part.id,
    unit: 'mm',
    confidence: proposalConfidence,
    status: reviewRequired ? 'needs_review' : 'ready_for_correction_patch',
    review_required: reviewRequired,
    basis: unique([
      'profile_role_ratio',
      scale.calibration ? 'image_scale_calibration' : 'profile_default_scale',
      imageMeasurements.length ? 'image_bbox_measurement' : null
    ]),
    source_count: sources.length,
    source_views: sourceViews,
    required_views: requiredViews,
    confirmed_views: confirmedViews,
    missing_views: missingViews,
    evidence_sources: sources.slice(0, 4),
    image_measurements: imageMeasurements.slice(0, 6),
    reason: reviewRequired
      ? 'No-seed image-derived dimensions must be reviewed before they replace shape parameters.'
      : 'Image evidence and scale calibration are strong enough to prepare a correction patch.'
  };
  const proposals = [
    {
      ...common,
      proposal_kind: 'shape_primitive',
      parameter: 'shape.primitive',
      path: `parts[${part.id}].shape.primitive`,
      current_value: part.shape?.primitive,
      proposed_value: candidate.primitive
    },
    {
      ...common,
      proposal_kind: 'shape_parameters',
      parameter: 'shape.parameters',
      path: `parts[${part.id}].shape.parameters`,
      current_value: cloneJson(part.shape?.parameters || {}),
      proposed_value: candidate.parameters
    }
  ];
  if (candidate.role_parameters) {
    proposals.push({
      ...common,
      proposal_kind: 'role_parameters',
      parameter: 'role.parameters',
      path: `parts[${part.id}].role_parameters`,
      proposed_value: candidate.role_parameters
    });
  }
  if (Number.isFinite(requirement.expected_count) && requirement.expected_count > 1) {
    proposals.push({
      ...common,
      proposal_kind: 'expected_count',
      parameter: 'expected_count',
      path: `parts[${part.id}].expected_count`,
      proposed_value: requirement.expected_count
    });
  }
  return proposals;
}

function candidateParameterSet(part, requirement = {}, scale = {}) {
  const width = Number(scale.width) || 100;
  const depth = Number(scale.depth) || 40;
  const height = Number(scale.height) || 50;
  const role = requirement.role || part.role || part.type;
  const roundDims = (values) => values.map((value) => round(value, 1));
  if (role === 'body') {
    return {
      primitive: 'rounded_box',
      parameters: {
        origin: roundDims([width * 0.204, 0, height * 0.267]),
        size: roundDims([width * 0.77, depth * 0.91, height * 0.63]),
        radius: round(height * 0.067, 1),
        segments: 8,
        smooth: 'all'
      }
    };
  }
  if (role === 'cab') {
    return {
      primitive: 'rounded_box',
      parameters: {
        origin: roundDims([width * 0.026, depth * 0.067, height * 0.324]),
        size: roundDims([width * 0.243, depth * 0.778, height * 0.362]),
        radius: round(height * 0.074, 1),
        segments: 8,
        smooth: 'all'
      }
    };
  }
  if (role === 'windshield') {
    return {
      primitive: 'box',
      parameters: {
        origin: roundDims([width * 0.113, depth * 0.049, height * 0.619]),
        size: roundDims([width * 0.183, depth * 0.016, height * 0.30])
      },
      role_parameters: {
        face: 'front',
        rake_hint: 'upper_edge_rearward',
        expected_material: 'glass'
      }
    };
  }
  if (role === 'side_window' || role === 'window') {
    return {
      primitive: 'box',
      parameters: {
        origin: roundDims([width * 0.417, -depth * 0.031, height * 0.619]),
        size: roundDims([width * 0.217, depth * 0.031, height * 0.19])
      },
      role_parameters: {
        expected_count: requirement.expected_count || 4,
        mirror: 'left_right',
        expected_material: 'glass'
      }
    };
  }
  if (role === 'wheel') {
    return {
      primitive: 'prism',
      parameters: {
        origin: roundDims([width * 0.243, -depth * 0.058, height * 0.21]),
        plane: 'xz',
        radius: round(height * 0.138, 1),
        depth: round(depth * 0.082, 1),
        segments: 12
      },
      role_parameters: {
        expected_count: requirement.expected_count || 4,
        diameter: round(height * 0.276, 1),
        thickness: round(depth * 0.082, 1),
        rear_center_x: round(width * 0.756, 1),
        center_z: round(height * 0.21, 1),
        mirror: 'left_right'
      }
    };
  }
  if (role === 'lightbar') {
    return {
      primitive: 'rounded_box',
      parameters: {
        origin: roundDims([width * 0.27, depth * 0.283, height * 0.962]),
        size: roundDims([width * 0.148, depth * 0.311, height * 0.067]),
        radius: round(height * 0.032, 1),
        segments: 6,
        smooth: 'all'
      }
    };
  }
  if (role === 'decal' || role === 'stripe' || role === 'label') {
    return {
      primitive: 'box',
      parameters: {
        origin: roundDims([width * 0.13, -depth * 0.038, height * 0.495]),
        size: roundDims([width * 0.774, depth * 0.027, height * 0.027])
      },
      role_parameters: {
        stripe_height: round(height * 0.027, 1),
        text: 'AMBULANCE',
        text_center: roundDims([width * 0.683, -depth * 0.069, height * 0.762]),
        text_height: round(height * 0.067, 1)
      }
    };
  }
  return null;
}

function parameterProposalConfidence({
  partConfidence = 0,
  scaleConfidence = 0,
  measurements = [],
  requiredViews = [],
  confirmedViews = [],
  missingViews = []
}) {
  const measurementConfidence = averageConfidence(measurements);
  const viewCoverage = requiredViews.length
    ? confirmedViews.length / requiredViews.length
    : (confirmedViews.length ? 1 : 0);
  const missingPenalty = Math.min(0.18, missingViews.length * 0.04);
  const score = 0.38 * partConfidence
    + 0.32 * (scaleConfidence || 0)
    + 0.2 * (measurementConfidence || 0)
    + 0.1 * viewCoverage
    - missingPenalty;
  return round(clamp(score, 0.12, 0.9), 3);
}

function buildObservationIndex(observationSet = {}) {
  const index = new Map();
  for (const image of observationSet.images || []) {
    for (const observation of image.observations || []) {
      const sourceImage = image.image?.path || '';
      index.set(`${sourceImage}|${observation.id}`, { image, observation });
    }
  }
  return index;
}

function imageMeasurementsForSources({ sources = [], observationSet = {}, observationIndex = new Map() }) {
  const scaleMeasurements = observationSet.scale_calibration?.measurements || observationSet.evidence_graph?.scale_calibration?.measurements || [];
  const measurements = [];
  for (const source of sources) {
    if (!source.source_image || !source.observation_id) continue;
    const indexed = observationIndex.get(`${source.source_image}|${source.observation_id}`);
    if (!indexed) continue;
    const calibration = scaleMeasurements.find((item) => item.source_image === source.source_image)
      || scaleMeasurements.find((item) => item.view === source.view);
    if (!calibration) continue;
    const base = {
      view: source.view || indexed.image.detected_view?.kind,
      source_image: source.source_image,
      observation_id: source.observation_id,
      kind: indexed.observation.kind,
      confidence: indexed.observation.confidence ?? source.confidence
    };
    if (indexed.observation.bbox && calibration.pixels_per_mm_x && calibration.pixels_per_mm_y) {
      const [, , bboxWidth, bboxHeight] = indexed.observation.bbox;
      measurements.push({
        ...base,
        bbox_px: indexed.observation.bbox,
        width_mm: round(bboxWidth / calibration.pixels_per_mm_x, 1),
        height_mm: round(bboxHeight / calibration.pixels_per_mm_y, 1),
        calibration_view: calibration.view
      });
    } else if (indexed.observation.points?.length && calibration.pixels_per_mm_x && calibration.pixels_per_mm_y) {
      measurements.push({
        ...base,
        point_count: indexed.observation.points.length,
        calibration_view: calibration.view,
        note: 'Point/contour evidence supports placement but is not converted to a final dimension.'
      });
    }
  }
  return uniqueMeasurements(measurements);
}

function requirementsByRole(profile = {}) {
  const result = new Map();
  for (const requirement of profile.required_parts || []) {
    result.set(requirement.role, requirement);
  }
  return result;
}

function sourcesForPart(part, observedGraphPart, observationSet, observationGraphParts = new Map()) {
  const graphSources = (observedGraphPart?.sources || []).map((source) => ({
    kind: source.kind || 'image_evidence',
    view: source.view_kind || source.view,
    source_image: source.source_image,
    status: source.status || 'observed',
    confidence: source.confidence,
    note: source.note,
    observation_id: source.observation_id
  }));
  if (graphSources.length) return dedupeSources(graphSources);

  const relatedSources = relatedSourcesForPart(part, observationGraphParts);
  if (relatedSources.length) return dedupeSources(relatedSources);

  const sources = [];
  for (const image of observationSet.images || []) {
    for (const observation of image.observations || []) {
      if (observation.component_hint !== part.id) continue;
      sources.push({
        kind: observation.kind,
        view: image.detected_view.kind,
        source_image: image.image.path,
        status: 'observed',
        confidence: observation.confidence,
        note: observation.note,
        observation_id: observation.id
      });
    }
  }
  return dedupeSources(sources);
}

function relatedSourcesForPart(part, observationGraphParts) {
  const relatedPartIds = relatedPartIdsForPart(part);
  const sources = [];
  for (const relatedPartId of relatedPartIds) {
    const related = observationGraphParts.get(relatedPartId);
    for (const source of related?.sources || []) {
      sources.push({
        kind: source.kind || 'related_image_evidence',
        view: source.view_kind || source.view,
        source_image: source.source_image,
        status: 'inferred',
        confidence: round(clamp((source.confidence || 0.45) * 0.72, 0.24, 0.68), 3),
        note: `Inferred from related image evidence for ${relatedPartId}: ${source.note || source.observation_id || 'observation'}`,
        observation_id: source.observation_id
      });
    }
  }
  return sources;
}

function relatedPartIdsForPart(part) {
  const ids = new Set();
  const id = part.id || '';
  const role = part.role || '';
  if (id.includes('right')) ids.add(id.replaceAll('right', 'left'));
  if (id.includes('rear') && role === 'window') ids.add('amb-left-side-window');
  if (id.includes('front') && role === 'stripe') ids.add('amb-left-red-stripe');
  if (id.includes('rear') && role === 'stripe') ids.add('amb-left-red-stripe');
  if (id.includes('right') && role === 'stripe') ids.add('amb-left-red-stripe');
  if (['window', 'side_window'].includes(role)) ids.add('amb-left-side-window');
  if (role === 'cab') ids.add('amb-cab-lower');
  if (role === 'windshield') ids.add('amb-windshield');
  if (['tire', 'wheel_hub', 'wheel'].includes(role)) {
    ids.add(id.includes('rear') ? 'wheel-left-rear-tire' : 'wheel-left-front-tire');
  }
  if (['stripe', 'label', 'decal'].includes(role)) {
    ids.add(role === 'label' ? 'amb-left-ambulance-text' : 'amb-left-red-stripe');
  }
  if (['lightbar', 'roof_rib', 'rounded_box'].includes(role) && id.startsWith('roof')) ids.add('roof-red-lightbar');
  if (['body', 'box', 'bumper', 'grille', 'lamp', 'boolean_tool', 'slot_array'].includes(role)) ids.add('amb-main-body');
  if (['grille', 'lamp', 'bumper', 'rounded_box'].includes(role) && !id.startsWith('roof')) ids.add('amb-cab-lower');
  return Array.from(ids).filter((item) => item && item !== id);
}

function partEvidenceConfidence({ sources, requiredViews, missingViews, scaleCalibration }) {
  const sourceConfidence = averageConfidence(sources);
  const viewCoverage = requiredViews.length
    ? (requiredViews.length - missingViews.length) / requiredViews.length
    : (sources.length ? 1 : 0);
  const scaleConfidence = scaleCalibration?.confidence ?? 0.42;
  const score = 0.5 * sourceConfidence + 0.32 * viewCoverage + 0.18 * scaleConfidence;
  return round(clamp(score, sources.length ? 0.22 : 0.12, 0.92), 3);
}

function evidenceStatusForPart({ sources, requiredViews, missingViews, confidence }) {
  if (!sources.length) return 'profile_default';
  if (sources.every((source) => source.status === 'inferred')) return confidence < 0.42 ? 'needs_review' : 'inferred';
  if (confidence < 0.42) return 'needs_review';
  if (missingViews.length > 0) return 'inferred';
  if (requiredViews.length === 0 && confidence < 0.64) return 'inferred';
  return 'observed';
}

function fallbackStateForPart(part, evidenceStatus, confidence) {
  if (evidenceStatus === 'profile_default') return 'profile_default';
  if (evidenceStatus === 'needs_review' || confidence < 0.48) return 'needs_review';
  if (part.fallback_state === 'real_feature_op' && confidence >= 0.58) return 'real_feature_op';
  if (part.fallback_state) return part.fallback_state;
  return evidenceStatus === 'observed' ? 'real_feature_op' : 'needs_review';
}

function profileDefaultEvidenceSource(part) {
  return {
    kind: 'profile_default',
    status: 'profile_default',
    confidence: 0.28,
    note: `${part.id} has no direct image evidence in the current observation set.`
  };
}

function conflictsForPart({ missingViews, confidence, sources }) {
  const conflicts = [];
  if (missingViews.length > 0) {
    conflicts.push({
      type: 'missing_required_view',
      severity: 'warn',
      views: missingViews,
      note: `Missing required view evidence for ${missingViews.join(', ')}.`
    });
  }
  if (!sources.length) {
    conflicts.push({
      type: 'profile_default_only',
      severity: 'warn',
      note: 'No direct image evidence matched this part; shape remains profile/seed driven.'
    });
  } else if (confidence < 0.55) {
    conflicts.push({
      type: 'low_part_confidence',
      severity: 'info',
      note: `Part evidence confidence is ${confidence}.`
    });
  }
  return conflicts;
}

function openQuestionsForPart({ part, missingViews, confidence, sources }) {
  const questions = [];
  if (!sources.length) {
    questions.push(`${part.id}: add image evidence or manually confirm this profile-default part.`);
  }
  if (missingViews.length > 0) {
    questions.push(`${part.id}: confirm ${missingViews.join(', ')} evidence before treating shape parameters as image-derived.`);
  }
  if (confidence < 0.55) {
    questions.push(`${part.id}: confidence ${confidence} is below the R4 review threshold.`);
  }
  return unique(questions);
}

function fallbackSummary(parts = []) {
  const summary = {};
  for (const part of parts) summary[part.fallback_state] = (summary[part.fallback_state] || 0) + 1;
  return summary;
}

function uniqueCorrectionTargets(targets) {
  const seen = new Set();
  const result = [];
  for (const target of targets) {
    const key = `${target.path}|${target.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

function uniqueParameterProposals(proposals) {
  const seen = new Set();
  const result = [];
  for (const proposal of proposals) {
    const key = `${proposal.part_id}|${proposal.path}|${proposal.parameter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(proposal);
  }
  return result;
}

function parameterProposalSummary(proposals = []) {
  const byStatus = {};
  const parts = new Set();
  let reviewRequired = 0;
  let confidenceSum = 0;
  for (const proposal of proposals) {
    byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1;
    if (proposal.part_id) parts.add(proposal.part_id);
    if (proposal.review_required) reviewRequired += 1;
    confidenceSum += Number(proposal.confidence) || 0;
  }
  return {
    total: proposals.length,
    parts_with_proposals: parts.size,
    review_required: reviewRequired,
    by_status: byStatus,
    average_confidence: proposals.length ? round(confidenceSum / proposals.length, 3) : 0
  };
}

function uniqueMeasurements(measurements) {
  const seen = new Set();
  const result = [];
  for (const measurement of measurements) {
    const key = `${measurement.source_image}|${measurement.observation_id}|${measurement.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(measurement);
  }
  return result;
}

function dedupeSources(sources) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    const key = [source.kind, source.view, source.source_image, source.observation_id || ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function averageConfidence(items) {
  const values = (items || [])
    .map((item) => item.confidence)
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unique(values) {
  return Array.from(new Set((values || []).filter((value) => value !== undefined && value !== null)));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--observations') options.observations = argv[++index];
    else if (arg === '--profile') options.profile = argv[++index];
    else if (arg === '--seed-part-graph') options.seedPartGraph = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--id') options.id = argv[++index];
    else if (arg === '--product-name') options.productName = argv[++index];
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
  node projects/image-structured-modeler/scripts/generate-part-graph-from-observations.mjs \\
    --observations projects/image-structured-modeler/examples/ambulance/observations.json \\
    --profile examples/product-profiles/vehicle_ambulance.json \\
    --seed-part-graph examples/part-graphs/ambulance-reference.part-graph.json \\
    --output projects/image-structured-modeler/examples/ambulance/part-graph.generated.json
`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
