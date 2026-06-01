#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  featureIntentWithGroundingMetadata,
  qaWithGroundingMetadata,
  summarizePartGraphGrounding,
  withGroundingMetadata
} from './lib/grounding-v2.mjs';
import {
  buildR8StructuralGrounding,
  roofSurfacePoint,
  roofSurfaceZ
} from './lib/r8-structural-grounding.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_BASE = 'projects/image-structured-modeler/examples/building-group/part-graph.r7-final.json';
const DEFAULT_OUTPUT = 'projects/image-structured-modeler/examples/building-group/part-graph.r7-photoreal.json';
const TEXTURE_DIR = 'projects/image-structured-modeler/examples/building-group/textures';

const MATERIALS = {
  fence: { name: 'Campus_Fence_Blue', color: '#6aa6c8', alpha: 0.9 },
  tree: { name: 'Campus_Tree_Canopy', color: '#2f6b3f' },
  treeTrunk: { name: 'Campus_Tree_Trunk', color: '#6f5738' },
  vehicleWhite: { name: 'Campus_Vehicle_White', color: '#f1f4f2' },
  vehicleDark: { name: 'Campus_Vehicle_Dark', color: '#2f3740' },
  vehicleBlue: { name: 'Campus_Vehicle_Blue', color: '#3e6f9f' },
  vehicleRed: { name: 'Campus_Vehicle_Red', color: '#8d3333' },
  serviceTruck: { name: 'Campus_Service_Truck', color: '#ece9df' },
  vent: { name: 'Campus_Roof_Vent_Dark', color: '#384047' },
  hvac: { name: 'Campus_HVAC_Light', color: '#d6d9d2' },
  marking: { name: 'Campus_Road_Marking_White', color: '#f4f2e7' },
  curb: { name: 'Campus_Curb_Concrete', color: '#c5c8bf' },
  gate: { name: 'Campus_Gate_Metal', color: '#8fb3c2' },
  glass: { name: 'Campus_Window_Glass', color: '#5d7684', alpha: 0.82 },
  tankDetail: { name: 'Campus_Tank_Detail', color: '#aeb3ad', metallic: 0.1, roughness: 0.55 },
  pipe: { name: 'Campus_Service_Pipe', color: '#d2d6ce' },
  siteRegionRoad: { name: 'Campus_Region_Road_Pavement', color: '#4f5558', alpha: 0.72 },
  siteRegionParking: { name: 'Campus_Region_Parking_Area', color: '#6f7473', alpha: 0.62 },
  siteRegionGreen: { name: 'Campus_Region_Green_Area', color: '#376c43', alpha: 0.62 },
  siteRegionWalkway: { name: 'Campus_Region_Walkway', color: '#c8c1a8', alpha: 0.72 },
  siteRegionService: { name: 'Campus_Region_Service_Yard', color: '#9a9487', alpha: 0.62 },
  roofSeam: { name: 'Campus_Roof_Seam_Gold', color: '#d0b45d' }
};

const options = parseArgs(process.argv.slice(2));
const basePartGraph = await readJson(options.basePartGraph || DEFAULT_BASE);
const photoreal = buildPhotorealPartGraph(basePartGraph, { geometryOnly: options.geometryOnly === true });
const outputPath = resolveRepo(options.output || DEFAULT_OUTPUT);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(photoreal, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: true,
  output: path.relative(repoRoot, outputPath),
  parts: photoreal.parts.length,
  operations: photoreal.operations.length,
  image_planes: photoreal.operations.filter((operation) => operation.op === 'image_plane').length,
  geometry_only: options.geometryOnly === true,
  generated_detail_ops: photoreal.operations.length
}, null, 2)}\n`);

function buildPhotorealPartGraph(base, { geometryOnly = false } = {}) {
  const baseParts = new Map((base.parts || []).map((part) => [part.id, part]));
  const required = (id) => {
    const part = baseParts.get(id);
    if (!part) throw new Error(`Base PartGraph is missing required part: ${id}`);
    return part;
  };

  const site = confirmedPart(required('site_boundary'), {
    fallback_state: geometryOnly ? 'visual_helper' : 'reference_only',
    evidence_status: 'observed',
    qa: {
      review_required: false,
      photoreal_reconstruction: true,
      reconstruction_role: 'site_scale_boundary'
    }
  });
  const siteRect = rectFromBoxPart(site);
  const primaryBase = required('primary_blue_roof_hall');
  const primaryRect = rectFromBoxPart(primaryBase);
  const primaryBodyHeight = 13800;
  const primaryRoofRise = 2800;
  const primaryBody = confirmedBoxPart(primaryBase, {
    id: 'primary_blue_roof_hall_body',
    name: 'Primary_Blue_Roof_Hall_Body',
    shape: boxShape(primaryRect, primaryBodyHeight),
    feature_intents: retargetFeatures(primaryBase.feature_intents || [], primaryBase.id, 'primary_blue_roof_hall_body')
  });
  const primaryRoof = gableRoofPart({
    id: 'primary_blue_hall_gable_roof',
    name: 'Primary_Blue_Hall_Gable_Roof',
    parent: primaryBody.id,
    rect: primaryRect,
    z: primaryBodyHeight,
    rise: primaryRoofRise,
    overhang: 700,
    material: 'Campus_Blue_Roof',
    sources: primaryBody.evidence_sources
  });

  const westWarehouses = splitWarehouseRow(required('warehouse_row_west'), 'warehouse_west');
  const innerWarehouses = splitWarehouseRow(required('warehouse_row_inner'), 'warehouse_inner');
  const warehouseParts = [...westWarehouses, ...innerWarehouses].flatMap((warehouse) => [
    warehouse.body,
    warehouse.roof
  ]);

  const utility = confirmedPart(required('utility_building'), {
    evidence_status: 'manual_confirmed',
    fallback_state: 'structured_primitive',
    qa: { review_required: false, photoreal_reconstruction: true }
  });
  const admin = confirmedPart(required('admin_office'), {
    evidence_status: 'manual_confirmed',
    fallback_state: 'structured_primitive',
    qa: { review_required: false, photoreal_reconstruction: true }
  });
  const parking = confirmedPart(required('parking_lot'), {
    evidence_status: 'manual_confirmed',
    fallback_state: 'visual_helper',
    qa: { review_required: false, photoreal_reconstruction: true }
  });
  const roads = confirmedPart(required('internal_roads'), {
    evidence_status: 'manual_confirmed',
    fallback_state: 'visual_helper',
    compile: { emit: false },
    qa: { review_required: false, photoreal_reconstruction: true }
  });
  const tanks = [confirmedPart(required('tank_farm')), confirmedPart(required('tank_farm_silo_east'))];
  const scaleAnchors = [...baseParts.values()]
    .filter((part) => part.role === 'scale_anchor')
    .map((part) => confirmedPart(part, {
      evidence_status: 'observed',
      fallback_state: 'visual_helper',
      compile: { emit: false },
      qa: { review_required: false, photoreal_reconstruction: true }
    }));

  const buildingBodies = [
    primaryBody,
    ...westWarehouses.map((warehouse) => warehouse.body),
    ...innerWarehouses.map((warehouse) => warehouse.body),
    utility,
    admin
  ];
  const parkingRect = rectFromBoxPart(parking);
  const structuralGrounding = buildR8StructuralGrounding({
    siteRect,
    primaryRect,
    parkingRect,
    buildingFootprints: buildingBodies.map((part) => ({
      id: part.id,
      rect: rectFromBoxPart(part),
      source_observation_ids: part.source_observation_ids || part.qa?.source_observation_ids || []
    })),
    tanks
  });
  const parts = [
    site,
    primaryBody,
    primaryRoof,
    ...warehouseParts,
    utility,
    admin,
    parking,
    roads,
    ...tanks,
    ...scaleAnchors
  ];

  const textureOps = [
    imagePlane('site_orthophoto_texture', 'Site_Orthophoto_Texture_Top_View', siteRect, 160, 'site_top_orthophoto.png', 0.96, 'orthophoto_texture'),
    imagePlane('roof_texture_primary_blue_hall', 'Roof_Texture_Primary_Blue_Hall', primaryRect, primaryBodyHeight + primaryRoofRise + 90, 'roof_primary_blue_hall.png', 0.98, 'roof_texture'),
    ...westWarehouses.map((warehouse) => roofTextureForWarehouse(warehouse)),
    ...innerWarehouses.map((warehouse) => roofTextureForWarehouse(warehouse)),
    imagePlane('roof_texture_utility_building', 'Roof_Texture_Utility_Building', rectFromBoxPart(utility), topZ(utility) + 90, 'roof_utility_building.png', 0.96, 'roof_texture'),
    imagePlane('roof_texture_admin_office', 'Roof_Texture_Admin_Office', rectFromBoxPart(admin), topZ(admin) + 90, 'roof_admin_office.png', 0.96, 'roof_texture'),
    imagePlane('parking_lot_texture', 'Parking_Lot_Texture_From_Top_View', rectFromBoxPart(parking), topZ(parking) + 120, 'parking_lot_detail.png', 0.97, 'ground_texture'),
    imagePlane('tank_farm_texture', 'Tank_Farm_Texture_From_Top_View', mergedTankRect(tanks), topZ(tanks[0]) + 120, 'tank_farm_detail.png', 0.94, 'roof_texture')
  ];

  const operations = [
    ...(geometryOnly ? [] : textureOps),
    ...siteRegionOperations(structuralGrounding.site_region_graph),
    ...fenceOperations(siteRect),
    ...gateOperations(siteRect),
    ...roadMarkingOperations(structuralGrounding.road_marking_graph, siteRect, primaryRect, parkingRect),
    ...parkingStallLineOperations(structuralGrounding.parking_layout_graph),
    ...treeOperations(siteRect, parkingRect, primaryRect),
    ...(geometryOnly && structuralGrounding.parking_layout_graph.vehicle_instances.length === 0 ? [] : vehicleOperations(parkingRect)),
    ...loadingTruckOperations([...westWarehouses, ...innerWarehouses]),
    ...primaryRoofDetailOperations(primaryRect, primaryBodyHeight, primaryRoofRise),
    ...roofVentOperations([...westWarehouses, ...innerWarehouses]),
    ...tankDetailOperations(tanks, structuralGrounding.tank_ellipse_fit),
    ...hvacOperations(utility, admin)
  ];

  return {
    version: 1,
    id: geometryOnly
      ? 'building-group-r8-editable-geometry-boundary-part-graph'
      : 'building-group-r7-photoreal-reconstruction-part-graph',
    profile_id: base.profile_id,
    dsl_version: base.dsl_version || 1,
    units: base.units || 'mm',
    product: {
      type: base.product?.type || 'building_group',
      name: geometryOnly
        ? `${base.product?.name || 'GPT Image Industrial Campus'} R8 Editable Geometry Boundary Probe`
        : `${base.product?.name || 'GPT Image Industrial Campus'} R7 Photoreal Boundary Probe`,
      source: geometryOnly
        ? 'R7 final PartGraph plus manually reviewed editable geometry details from the supplied building-group test images; no image textures or reference planes are emitted.'
        : 'R7 final PartGraph plus manually reviewed high-fidelity reconstruction from the supplied GPT Image 2 top-view sample'
    },
    scale: clone(base.scale),
    evidence_graph: {
      version: 1,
      source_images: base.evidence_graph?.source_images || [],
      views_detected: base.evidence_graph?.views_detected || ['top', 'oblique'],
      open_questions: geometryOnly
        ? [
            'Geometry-only boundary model replaces texture planes with editable primitives; structural regions, parking grids, roof seams, and tank details now carry reviewable grounding metadata instead of photo-grade claims.',
            'Warehouse rows are split into four visible buildings from the supplied top-view image; exact survey dimensions still need external confirmation.',
            'Facade detail remains approximate because the current chain lacks camera pose solving, depth recovery, and true multi-view triangulation.'
          ]
        : [
            'Photoreal texture planes are derived from the generated top view; facade texture projection is still not reconstructed from true multi-view photogrammetry.',
            'Warehouse rows are split into four visible buildings from the supplied top-view image; exact survey dimensions still need external confirmation.'
          ],
      scale_calibration: clone(base.evidence_graph?.scale_calibration || base.scale?.calibration || {}),
      structural_grounding: structuralGrounding,
      part_matches: parts.map((part) => ({
        part_id: part.id,
        strategy: part.role === 'roof' ? 'reviewed_roofline_from_top_view' : 'r7_final_to_photoreal_reconstruction',
        matched_views: ['top', 'oblique'],
        missing_views: [],
        source_count: part.evidence_sources?.length || 1,
        confidence: part.qa?.evidence_confidence || 0.72
      })),
      parts: parts.map((part) => evidenceGraphPart(part))
    },
    parts,
    operations,
    physical_relations: groundedRelations(parts),
    review: {
      fallback_summary: {
        reference_only: 1,
        structured_primitive: parts.filter((part) => part.fallback_state === 'structured_primitive').length,
        visual_helper: parts.filter((part) => part.fallback_state === 'visual_helper').length
      },
      photoreal_reconstruction: {
        texture_planes: geometryOnly ? 0 : textureOps.length,
        geometry_only: geometryOnly,
        split_warehouse_buildings: 4,
        roof_primitives: parts.filter((part) => part.shape?.primitive === 'gable_roof').length,
        generated_site_detail_operations: operations.length - (geometryOnly ? 0 : textureOps.length),
        structural_grounding: structuralGrounding,
        grounding_v2: summarizePartGraphGrounding({ parts })
      },
      grounding_summary: summarizePartGraphGrounding({ parts }),
      structural_grounding: structuralGrounding,
      open_questions: geometryOnly
        ? [
            'This is the current no-texture editable geometry ceiling for the supplied building-group images, not a survey-grade BIM model.',
            'Oblique facade detail remains approximate because the current chain lacks camera pose solving and depth recovery.',
            'Parking, road, green, roof-surface, and tank-ellipse structure now carries QA metadata; unresolved items keep review_required=true instead of photo-grade eligibility.'
          ]
        : [
            'This is a texture-assisted high-fidelity model, not a full inferred editable BIM model.',
            'Oblique facade detail remains approximate because the current chain lacks camera pose solving, depth recovery, and texture unwrapping.',
            'Parking, tree, fence, and vehicle details are deterministic visual helpers placed from visible top-view anchors.'
          ],
      correction_targets: [
        ...(geometryOnly ? [] : [{
          path: 'operations[image_plane].image',
          reason: 'Texture planes prove the current boundary for visual fidelity but should eventually be replaced by camera-calibrated UV projection.',
          severity: 'info'
        }]),
        {
          path: 'parts[warehouse_*].shape.parameters',
          reason: 'Four warehouse bodies are split from row-level bboxes and require real survey dimensions before production use.',
          severity: 'warn'
        }
      ]
    }
  };
}

function splitWarehouseRow(basePart, prefix) {
  const rect = rectFromBoxPart(basePart);
  const gap = round(rect.depth * 0.11, 1);
  const buildingDepth = round((rect.depth - gap) / 2, 1);
  const southRect = { ...rect, depth: buildingDepth };
  const northRect = { ...rect, y: round(rect.y + buildingDepth + gap, 1), depth: buildingDepth };
  return [
    warehouseFromRect(basePart, `${prefix}_north`, 'north', northRect),
    warehouseFromRect(basePart, `${prefix}_south`, 'south', southRect)
  ];
}

function warehouseFromRect(basePart, idPrefix, position, rect) {
  const bodyHeight = 8200;
  const roofRise = 900;
  const body = confirmedBoxPart(basePart, {
    id: `${idPrefix}_body`,
    name: titleName(`${idPrefix}_body`),
    shape: boxShape(rect, bodyHeight),
    evidence_status: 'manual_confirmed',
    fallback_state: 'structured_primitive',
    feature_intents: warehouseFeatureIntents(`${idPrefix}_body`, rect, bodyHeight)
  });
  const roof = gableRoofPart({
    id: `${idPrefix}_gable_roof`,
    name: titleName(`${idPrefix}_gable_roof`),
    parent: body.id,
    rect,
    z: bodyHeight,
    rise: roofRise,
    overhang: 420,
    material: 'Campus_Warehouse_Light',
    sources: body.evidence_sources
  });
  return { idPrefix, position, rect, body, roof, bodyHeight, roofRise };
}

function confirmedBoxPart(basePart, overrides = {}) {
  return confirmedPart(basePart, {
    ...overrides,
    type: overrides.type || basePart.type,
    role: overrides.role || basePart.role,
    material: overrides.material || basePart.material,
    fallback_state: overrides.fallback_state || 'structured_primitive',
    evidence_status: overrides.evidence_status || 'manual_confirmed'
  });
}

function confirmedPart(basePart, overrides = {}) {
  const part = {
    ...clone(basePart),
    ...clone(overrides),
    id: overrides.id || basePart.id,
    name: overrides.name || basePart.name,
    type: overrides.type || basePart.type,
    role: overrides.role || basePart.role,
    material: overrides.material || basePart.material,
    shape: clone(overrides.shape || basePart.shape),
    evidence_status: overrides.evidence_status || 'manual_confirmed',
    fallback_state: overrides.fallback_state || 'structured_primitive',
    evidence_sources: clone(overrides.evidence_sources || basePart.evidence_sources || [])
  };
  if (overrides.feature_intents !== undefined) part.feature_intents = clone(overrides.feature_intents);
  delete part.parameter_proposals;
  part.qa = {
    ...(clone(basePart.qa || {})),
    review_required: false,
    scale_review_required: false,
    orientation_review_required: false,
    detail_review_required: false,
    photoreal_reconstruction: true,
    evidence_confidence: 0.76,
    ...(clone(overrides.qa || {}))
  };
  const next = withGroundingMetadata(part, {
    reviewRequired: part.qa.review_required,
    helperAllowed: part.fallback_state === 'visual_helper' || part.fallback_state === 'reference_only'
  });
  if (next.feature_intents?.length) {
    next.feature_intents = next.feature_intents.map((feature) => featureIntentWithGroundingMetadata(feature, next, {
      groundingStatus: feature.semantic?.startsWith('facade.') ? 'review_confirmed' : undefined,
      reviewRequired: feature.semantic?.startsWith('facade.') || feature.fallback_state === 'needs_review'
    }));
  }
  return next;
}

function gableRoofPart({ id, name, parent, rect, z, rise, overhang, material, sources }) {
  return withGroundingMetadata({
    id,
    name,
    type: 'roof',
    role: 'roof',
    parent,
    material,
    shape: {
      primitive: 'gable_roof',
      parameters: {
        origin: [rect.x, rect.y, z],
        width: rect.width,
        depth: rect.depth,
        rise,
        overhang
      }
    },
    evidence_status: 'manual_confirmed',
    evidence_sources: clone(sources || []),
    fallback_state: 'structured_primitive',
    qa: {
      role: 'roof',
      parent_part_id: parent,
      review_required: false,
      photoreal_reconstruction: true,
      evidence_confidence: 0.72
    }
  }, { reviewRequired: false });
}

function warehouseFeatureIntents(partId, rect, height) {
  const width = rect.width;
  const depth = rect.depth;
  return [
    raisedRib(partId, 'roof_center_seam', 'roofline.center_seam', [width * 0.5, depth * 0.5], depth * 0.84, 150, 110, 'v'),
    raisedRib(partId, 'roof_left_longitudinal_seam', 'roofline.longitudinal_seam', [width * 0.34, depth * 0.5], depth * 0.82, 120, 90, 'v'),
    raisedRib(partId, 'roof_right_longitudinal_seam', 'roofline.longitudinal_seam', [width * 0.66, depth * 0.5], depth * 0.82, 120, 90, 'v'),
    recess(partId, 'facade_loading_bay_north', 'facade.opening.loading_bay', 'front', [width * 0.32, height * 0.26], [width * 0.16, height * 0.34], 110, 30),
    recess(partId, 'facade_loading_bay_center', 'facade.opening.loading_bay', 'front', [width * 0.52, height * 0.26], [width * 0.16, height * 0.34], 110, 30),
    recess(partId, 'facade_loading_bay_south', 'facade.opening.loading_bay', 'front', [width * 0.72, height * 0.26], [width * 0.16, height * 0.34], 110, 30)
  ];
}

function raisedRib(partId, suffix, semantic, center, length, width, height, direction) {
  return featureIntentWithGroundingMetadata({
    id: `${partId}_${suffix}`,
    operation: 'add_raised_rib',
    face: 'top',
    semantic,
    parameters: {
      center: roundVector(center),
      length: round(length, 1),
      width: round(width, 1),
      height: round(height, 1),
      direction
    },
    fallback_state: 'structured_primitive'
  }, {}, {
    groundingStatus: 'review_confirmed',
    groundingMethod: 'manual_review',
    reviewRequired: false,
    photoGradeEligible: false
  });
}

function recess(partId, suffix, semantic, face, center, size, depth, radius) {
  return featureIntentWithGroundingMetadata({
    id: `${partId}_${suffix}`,
    operation: 'cut_recess',
    face,
    semantic,
    parameters: {
      center: roundVector(center),
      size: roundVector(size),
      depth,
      radius,
      segments: 4
    },
    fallback_state: 'structured_primitive'
  }, {}, {
    groundingStatus: 'review_confirmed',
    groundingMethod: 'manual_review',
    reviewRequired: true,
    photoGradeEligible: false
  });
}

function retargetFeatures(features, oldPartId, newPartId) {
  return features.map((feature) => ({
    ...clone(feature),
    id: String(feature.id || '').replace(oldPartId, newPartId) || `${newPartId}_${feature.semantic || feature.operation}`,
    target_id: undefined,
    fallback_state: 'structured_primitive'
  }));
}

function imagePlane(id, name, rect, z, fileName, alpha, role) {
  return {
    op: 'image_plane',
    id,
    name,
    origin: [round(rect.x, 1), round(rect.y, 1), round(z, 1)],
    plane: 'xy',
    size: [round(rect.width, 1), round(rect.depth, 1)],
    image: path.join(TEXTURE_DIR, fileName),
    alpha,
    texture_transform: { projection: 'planar', scale: [1, 1], rotation: 0 },
    qa: qaWithGroundingMetadata({
      role,
      part_id: id,
      intent: 'photoreal_texture_alignment',
      evidence_status: 'manual_confirmed',
      fallback_state: 'visual_helper'
    }, { grounding_status: 'helper_only', grounding_method: 'helper_generated', source_observation_ids: [], review_required: true, helper_allowed: true, photo_grade_eligible: false })
  };
}

function roofTextureForWarehouse(warehouse) {
  const fileName = `roof_${warehouse.idPrefix}.png`;
  return imagePlane(
    `roof_texture_${warehouse.idPrefix}`,
    titleName(`roof_texture_${warehouse.idPrefix}`),
    warehouse.rect,
    warehouse.bodyHeight + warehouse.roofRise + 70,
    fileName,
    0.97,
    'roof_texture'
  );
}

function fenceOperations(siteRect) {
  const z = 0;
  const h = 900;
  const t = 220;
  return [
    boxOp('fence_north', 'Fence_North', [siteRect.x, siteRect.y + siteRect.depth - t, z], [siteRect.width, t, h], MATERIALS.fence, 'perimeter_fence'),
    boxOp('fence_south', 'Fence_South', [siteRect.x, siteRect.y, z], [siteRect.width, t, h], MATERIALS.fence, 'perimeter_fence'),
    boxOp('fence_west', 'Fence_West', [siteRect.x, siteRect.y, z], [t, siteRect.depth, h], MATERIALS.fence, 'perimeter_fence'),
    boxOp('fence_east', 'Fence_East', [siteRect.x + siteRect.width - t, siteRect.y, z], [t, siteRect.depth, h], MATERIALS.fence, 'perimeter_fence')
  ];
}

function gateOperations(siteRect) {
  const y = siteRect.y + 420;
  const centerX = 0;
  return [
    boxOp('south_entry_guardhouse', 'South_Entry_Guardhouse', [centerX - 5200, y + 450, 0], [3600, 2600, 2800], MATERIALS.curb, 'entry_guardhouse'),
    boxOp('south_entry_canopy', 'South_Entry_Canopy', [centerX - 6200, y + 300, 2800], [5600, 3100, 320], MATERIALS.gate, 'entry_canopy'),
    boxOp('south_entry_gate_left_post', 'South_Entry_Gate_Left_Post', [centerX - 7200, y, 0], [520, 520, 2600], MATERIALS.gate, 'entry_gate'),
    boxOp('south_entry_gate_right_post', 'South_Entry_Gate_Right_Post', [centerX + 6900, y, 0], [520, 520, 2600], MATERIALS.gate, 'entry_gate'),
    boxOp('south_entry_gate_arm_left', 'South_Entry_Gate_Arm_Left', [centerX - 6700, y + 1650, 1250], [6500, 180, 160], MATERIALS.gate, 'entry_gate'),
    boxOp('south_entry_gate_arm_right', 'South_Entry_Gate_Arm_Right', [centerX + 220, y + 1650, 1250], [6500, 180, 160], MATERIALS.gate, 'entry_gate')
  ];
}

function siteRegionOperations(siteRegionGraph) {
  const regions = siteRegionGraph?.regions || [];
  const byKind = (kind) => regions.filter((region) => region.kind === kind).map((region) => region.polygon);
  return [
    meshOp('internal_roads', 'Internal_Road_Pavement_Regions', byKind('road_pavement'), 2, MATERIALS.siteRegionRoad, 'road_pavement', {
      grounding_status: 'review_confirmed',
      grounding_method: 'site_projection_region_fit',
      source_observation_ids: sourceObservationIdsForKind(regions, 'road_pavement'),
      review_required: siteRegionGraph.review_required,
      helper_allowed: false,
      photo_grade_eligible: false,
      qa: {
        site_region_graph: regionGraphQa(siteRegionGraph, 'road_pavement', 'internal_roads')
      }
    }),
    meshOp('site_region_parking_area', 'Site_Region_Parking_Area', byKind('parking_area'), 18, MATERIALS.siteRegionParking, 'site_region', {
      grounding_status: 'review_confirmed',
      grounding_method: 'site_projection_region_fit',
      source_observation_ids: sourceObservationIdsForKind(regions, 'parking_area'),
      review_required: siteRegionGraph.review_required,
      qa: { site_region_graph: regionGraphQa(siteRegionGraph, 'parking_area', 'site_region_parking_area') }
    }),
    meshOp('site_region_green_area', 'Site_Region_Green_Area', byKind('green_area'), 16, MATERIALS.siteRegionGreen, 'site_region', {
      grounding_status: 'review_confirmed',
      grounding_method: 'pixel_vegetation_segmentation_region_fit',
      source_observation_ids: sourceObservationIdsForKind(regions, 'green_area'),
      review_required: siteRegionGraph.review_required,
      qa: { site_region_graph: regionGraphQa(siteRegionGraph, 'green_area', 'site_region_green_area') }
    }),
    meshOp('site_region_walkway', 'Site_Region_Walkway', byKind('walkway'), 32, MATERIALS.siteRegionWalkway, 'pedestrian_walkway', {
      grounding_status: 'review_confirmed',
      grounding_method: 'site_projection_region_fit',
      source_observation_ids: sourceObservationIdsForKind(regions, 'walkway'),
      review_required: siteRegionGraph.review_required,
      qa: { site_region_graph: regionGraphQa(siteRegionGraph, 'walkway', 'site_region_walkway') }
    }),
    meshOp('site_region_service_yard', 'Site_Region_Service_Yard', byKind('service_yard'), 20, MATERIALS.siteRegionService, 'site_region', {
      grounding_status: 'review_confirmed',
      grounding_method: 'manual_review_region_fit',
      source_observation_ids: sourceObservationIdsForKind(regions, 'service_yard'),
      review_required: true,
      qa: { site_region_graph: regionGraphQa(siteRegionGraph, 'service_yard', 'site_region_service_yard') }
    })
  ].filter((operation) => operation.vertices.length > 0);
}

function roadMarkingOperations(roadMarkingGraph, siteRect, primaryRect, parkingRect) {
  const ops = [];
  const markById = new Map((roadMarkingGraph?.markings || []).map((marking) => [marking.id, marking]));
  const centerSouth = markById.get('road_axis_main_south');
  const centerNorth = markById.get('road_axis_main_north');
  const parkingAisle = markById.get('parking_aisle_center_axis');
  if (centerSouth) ops.push(lineBoxOp('main_drive_center_line_south', 'Main_Drive_Center_Line_South', centerSouth.segment, 140, 28, MATERIALS.marking, 'road_marking', lineQaOptions(centerSouth, 'road_marking_graph')));
  if (centerNorth) ops.push(lineBoxOp('main_drive_center_line_north', 'Main_Drive_Center_Line_North', centerNorth.segment, 140, 28, MATERIALS.marking, 'road_marking', lineQaOptions(centerNorth, 'road_marking_graph')));
  if (parkingAisle) ops.push(lineBoxOp('parking_drive_center_line', 'Parking_Drive_Center_Line', parkingAisle.segment, 150, 28, MATERIALS.marking, 'road_marking', lineQaOptions(parkingAisle, 'road_marking_graph')));
  ops.push(...crosswalk('south_entry_crosswalk', -3800, siteRect.y + 2700, 7600, 'y', lineQaOptions(markById.get('south_entry_crosswalk_axis'), 'road_marking_graph')));
  ops.push(...crosswalk('blue_hall_crosswalk', primaryRect.x + primaryRect.width * 0.58, primaryRect.y - 5300, 6200, 'y', lineQaOptions(markById.get('blue_hall_crosswalk_axis'), 'road_marking_graph')));
  ops.push(...crosswalk('east_loop_crosswalk', siteRect.x + siteRect.width - 10200, siteRect.y + 12500, 4600, 'y', lineQaOptions(markById.get('south_entry_crosswalk_axis'), 'road_marking_graph')));
  ops.push(boxOp('front_walkway_blue_hall', 'Front_Walkway_Blue_Hall', [primaryRect.x + primaryRect.width * 0.24, primaryRect.y - 1900, 95], [primaryRect.width * 0.52, 900, 45], MATERIALS.curb, 'pedestrian_walkway', {
    grounding_status: 'review_confirmed',
    grounding_method: 'site_projection_region_fit',
    source_observation_ids: ['building_top_scale_crosswalk_width'],
    review_required: true,
    qa: { road_marking_graph: { kind: 'walkway', projection_residuals: { offset_error_mm: 450 } } }
  }));
  ops.push(boxOp('admin_entry_walkway', 'Admin_Entry_Walkway', [-4100, siteRect.y + 16200, 95], [8200, 1050, 45], MATERIALS.curb, 'pedestrian_walkway', {
    grounding_status: 'helper_only',
    grounding_method: 'helper_generated',
    source_observation_ids: [],
    review_required: true,
    helper_allowed: true,
    qa: { road_marking_graph: { kind: 'walkway', review_reason: 'no dedicated line evidence in current R8 fixture' } }
  }));
  return ops;
}

function crosswalk(prefix, x, y, span, direction, qaOptions = {}) {
  const stripes = [];
  for (let index = 0; index < 7; index += 1) {
    const offset = index * 620;
    const origin = direction === 'x'
      ? [x + offset, y, 110]
      : [x, y + offset, 110];
    const size = direction === 'x'
      ? [320, span, 35]
      : [span, 320, 35];
    stripes.push(boxOp(`${prefix}_${String(index + 1).padStart(2, '0')}`, titleName(`${prefix}_${index + 1}`), origin, size, MATERIALS.marking, 'crosswalk_stripe', qaOptions));
  }
  return stripes;
}

function parkingStallLineOperations(parkingLayoutGraph) {
  const ops = [];
  let index = 1;
  const pitch = parkingLayoutGraph.stall_pitch;
  const stallDepth = parkingLayoutGraph.stall_depth;
  const addLine = (origin, size, role = 'parking_stall_line', sourceObservationIds = parkingLayoutGraph.source_observation_ids) => {
    ops.push(boxOp(`parking_line_${String(index).padStart(2, '0')}`, titleName(`parking_line_${index}`), origin, size, MATERIALS.marking, role, {
      grounding_status: 'review_confirmed',
      grounding_method: 'pixel_line_segmentation_grid_fit',
      source_observation_ids: sourceObservationIds,
      projection_residuals: parkingLayoutGraph.residuals,
      review_required: parkingLayoutGraph.review_required,
      helper_allowed: false,
      photo_grade_eligible: false,
      qa: {
        parking_layout_graph: {
          graph_id: 'parking_layout_graph',
          role,
          stall_pitch: parkingLayoutGraph.stall_pitch,
          stall_depth: parkingLayoutGraph.stall_depth,
          row_count: parkingLayoutGraph.row_count,
          column_count: parkingLayoutGraph.column_count,
          line_evidence: true,
          projection_residuals: parkingLayoutGraph.residuals
        }
      }
    }));
    index += 1;
  };
  for (const row of parkingLayoutGraph.rows || []) {
    const [[startX, rowY], [endX]] = row.axis;
    const y0 = rowY - stallDepth / 2;
    for (let column = 0; column <= parkingLayoutGraph.column_count; column += 1) {
      addLine([startX + column * pitch, y0, 120], [82, stallDepth, 34], 'parking_stall_line', row.source_observation_ids);
    }
    addLine([startX, y0, 120], [endX - startX, 88, 34], 'parking_stall_line', row.source_observation_ids);
    addLine([startX, y0 + stallDepth, 120], [endX - startX, 88, 34], 'parking_stall_line', row.source_observation_ids);
  }
  for (let island = 0; island < 4; island += 1) {
    const [[startX], [, rowY]] = parkingLayoutGraph.rows[0].axis;
    addLine([startX + 5200 + island * pitch * 2.4, rowY + parkingLayoutGraph.stall_depth * 0.58, 130], [900, 3300, 80], 'parking_tree_island_curb', parkingLayoutGraph.source_observation_ids);
  }
  return ops;
}

function sourceObservationIdsForKind(regions, kind) {
  return [...new Set(regions
    .filter((region) => region.kind === kind)
    .flatMap((region) => region.source_observation_ids || []))];
}

function regionGraphQa(siteRegionGraph, kind, id) {
  const regions = (siteRegionGraph?.regions || []).filter((region) => region.kind === kind);
  return {
    graph_id: 'site_region_graph',
    id,
    region_kind: kind,
    region_ids: regions.map((region) => region.id),
    polygons: regions.map((region) => region.polygon),
    area_ratio: siteRegionGraph?.area_ratios?.[kind] || 0,
    overlap_ratio: siteRegionGraph?.qa?.max_overlap_ratio || 0,
    unclassified_ratio: siteRegionGraph?.qa?.unclassified_ratio || 0,
    review_required: Boolean(siteRegionGraph?.review_required)
  };
}

function lineQaOptions(marking, graphId) {
  if (!marking) {
    return {
      grounding_status: 'helper_only',
      grounding_method: 'helper_generated',
      source_observation_ids: [],
      review_required: true,
      helper_allowed: true,
      qa: { [graphId]: { line_evidence: false } }
    };
  }
  return {
    grounding_status: marking.grounding_status || 'review_confirmed',
    grounding_method: marking.grounding_method || 'manual_review',
    source_observation_ids: marking.source_observation_ids || [],
    projection_residuals: marking.projection_residuals || null,
    review_required: false,
    helper_allowed: false,
    photo_grade_eligible: false,
    qa: {
      [graphId]: {
        graph_id: graphId,
        marking_id: marking.id,
        kind: marking.kind,
        line_evidence: (marking.source_observation_ids || []).length > 0,
        segment: marking.segment,
        projection_residuals: marking.projection_residuals || null
      }
    }
  };
}

function lineBoxOp(id, name, segment, width, height, material, role, qaOptions = {}) {
  const [[x1, y1], [x2, y2]] = segment;
  if (Math.abs(x1 - x2) >= Math.abs(y1 - y2)) {
    return boxOp(id, name, [Math.min(x1, x2), Math.min(y1, y2) - width / 2, 90], [Math.abs(x2 - x1), width, height], material, role, qaOptions);
  }
  return boxOp(id, name, [Math.min(x1, x2) - width / 2, Math.min(y1, y2), 90], [width, Math.abs(y2 - y1), height], material, role, qaOptions);
}

function meshOp(id, name, polygons, z, material, role, options = {}) {
  const vertices = [];
  const faces = [];
  for (const polygon of polygons || []) {
    const clean = polygonClosed(polygon) ? polygon.slice(0, -1) : polygon;
    if (clean.length < 3) continue;
    const start = vertices.length;
    for (const [x, y] of clean) vertices.push([round(x, 1), round(y, 1), round(z, 1)]);
    faces.push(clean.map((_, index) => start + index));
  }
  return {
    op: 'mesh',
    id,
    name,
    vertices,
    faces,
    material,
    smooth: 'coplanar',
    qa: qaWithGroundingMetadata({
      role,
      part_id: id,
      intent: 'r8_structural_site_region',
      evidence_status: 'manual_confirmed',
      fallback_state: 'structured_primitive',
      ...(clone(options.qa || {}))
    }, {
      grounding_status: options.grounding_status || 'review_confirmed',
      grounding_method: options.grounding_method || 'manual_review',
      source_observation_ids: options.source_observation_ids || [],
      projection_residuals: options.projection_residuals || null,
      review_required: options.review_required ?? true,
      helper_allowed: options.helper_allowed ?? false,
      photo_grade_eligible: options.photo_grade_eligible ?? false
    })
  };
}

function polygonClosed(polygon) {
  if (!polygon?.length) return false;
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function treeOperations(siteRect, parkingRect, primaryRect) {
  const trees = [];
  let index = 1;
  const addTree = (x, y, radius = 620, height = 2600) => {
    const id = String(index).padStart(2, '0');
    const trunkHeight = Math.max(900, Math.round(height * 0.42));
    trees.push(cylinderOp(`tree_${id}_trunk`, titleName(`tree_${index}_trunk`), [x, y, 0], Math.max(110, Math.round(radius * 0.2)), trunkHeight, MATERIALS.treeTrunk, 'landscape_tree_trunk', 8));
    trees.push(cylinderOp(`tree_${id}_canopy`, titleName(`tree_${index}_canopy`), [x, y, trunkHeight], radius, Math.max(900, height - trunkHeight), MATERIALS.tree, 'landscape_tree_canopy', 12));
    index += 1;
  };
  for (let x = siteRect.x + 9000; x < siteRect.x + siteRect.width - 9000; x += 11500) {
    addTree(x, siteRect.y + 3800, 560, 2300);
    addTree(x, siteRect.y + siteRect.depth - 4200, 560, 2300);
  }
  for (let y = siteRect.y + 11000; y < siteRect.y + siteRect.depth - 10000; y += 10500) {
    addTree(siteRect.x + 3900, y, 620, 2600);
    addTree(siteRect.x + siteRect.width - 4100, y, 620, 2600);
  }
  for (let y = primaryRect.y + 7500; y < primaryRect.y + primaryRect.depth - 6000; y += 7600) {
    addTree(primaryRect.x - 1100, y, 320, 1900);
    addTree(primaryRect.x + primaryRect.width + 1100, y, 320, 1900);
  }
  for (let x = parkingRect.x + 6500; x < parkingRect.x + parkingRect.width - 5000; x += 9000) {
    addTree(x, parkingRect.y + parkingRect.depth * 0.52, 460, 1900);
  }
  return trees;
}

function vehicleOperations(parkingRect) {
  const colors = [MATERIALS.vehicleWhite, MATERIALS.vehicleDark, MATERIALS.vehicleBlue, MATERIALS.vehicleRed];
  const vehicles = [];
  const rows = [parkingRect.y + parkingRect.depth * 0.30, parkingRect.y + parkingRect.depth * 0.62];
  let index = 1;
  for (const rowY of rows) {
    for (let column = 0; column < 7; column += 1) {
      const x = parkingRect.x + 5200 + column * 5600;
      const size = column % 2 === 0 ? [1850, 4200, 1250] : [4200, 1850, 1250];
      const id = String(index).padStart(2, '0');
      vehicles.push(boxOp(`vehicle_${id}_body`, titleName(`vehicle_${index}_body`), [x, rowY, 95], size, colors[index % colors.length], 'parked_vehicle_body'));
      vehicles.push(...vehicleWheelMarks(`vehicle_${id}`, x, rowY, size));
      index += 1;
    }
  }
  return vehicles;
}

function vehicleWheelMarks(prefix, x, y, size) {
  const [width, depth] = size;
  const longAxisX = width > depth;
  if (longAxisX) {
    return [
      boxOp(`${prefix}_wheel_shadow_left`, titleName(`${prefix}_wheel_shadow_left`), [x + width * 0.18, y - 120, 150], [width * 0.22, 180, 130], MATERIALS.vehicleDark, 'parked_vehicle_wheel'),
      boxOp(`${prefix}_wheel_shadow_right`, titleName(`${prefix}_wheel_shadow_right`), [x + width * 0.60, y + depth - 60, 150], [width * 0.22, 180, 130], MATERIALS.vehicleDark, 'parked_vehicle_wheel')
    ];
  }
  return [
    boxOp(`${prefix}_wheel_shadow_left`, titleName(`${prefix}_wheel_shadow_left`), [x - 120, y + depth * 0.18, 150], [180, depth * 0.22, 130], MATERIALS.vehicleDark, 'parked_vehicle_wheel'),
    boxOp(`${prefix}_wheel_shadow_right`, titleName(`${prefix}_wheel_shadow_right`), [x + width - 60, y + depth * 0.60, 150], [180, depth * 0.22, 130], MATERIALS.vehicleDark, 'parked_vehicle_wheel')
  ];
}

function loadingTruckOperations(warehouses) {
  const trucks = [];
  let index = 1;
  for (const warehouse of warehouses) {
    const rect = warehouse.rect;
    const x = rect.x + rect.width + 250;
    for (const y of [rect.y + rect.depth * 0.28, rect.y + rect.depth * 0.68]) {
      const id = String(index).padStart(2, '0');
      trucks.push(boxOp(`loading_truck_${id}_trailer`, titleName(`loading_truck_${index}_trailer`), [x, y, 0], [1600, 6500, 2900], MATERIALS.serviceTruck, 'loading_truck_trailer'));
      trucks.push(boxOp(`loading_truck_${id}_cab`, titleName(`loading_truck_${index}_cab`), [x + 150, y + 6500, 0], [1300, 1850, 2400], MATERIALS.serviceTruck, 'loading_truck_cab'));
      trucks.push(boxOp(`loading_dock_${id}`, titleName(`loading_dock_${index}`), [rect.x + rect.width - 160, y + 450, 120], [360, 2600, 520], MATERIALS.curb, 'loading_dock_apron'));
      index += 1;
    }
  }
  return trucks;
}

function primaryRoofDetailOperations(primaryRect, bodyHeight, roofRise) {
  const ops = [];
  const ridgeX = primaryRect.x + primaryRect.width * 0.5;
  const monitorWidth = primaryRect.width * 0.1;
  const monitorY = primaryRect.y + primaryRect.depth * 0.08;
  const monitorZ = roofSurfaceZ(primaryRect, bodyHeight, roofRise, ridgeX) + 28;
  ops.push(boxOp('blue_hall_roof_monitor', 'Blue_Hall_Roof_Monitor', [ridgeX - monitorWidth / 2, monitorY, monitorZ], [monitorWidth, primaryRect.depth * 0.78, 520], MATERIALS.gate, 'roof_monitor', {
    grounding_status: 'review_confirmed',
    grounding_method: 'manual_review_roof_surface_fit',
    source_observation_ids: ['building_top_primary_blue_hall_pixel', 'building_oblique_primary_blue_hall'],
    projection_residuals: { surface_distance_mm: 28, angle_error_degrees: 0 },
    review_required: true,
    qa: {
      roof_surface_fit: {
        graph_id: 'roof_surface_fit',
        host_part_id: 'primary_blue_hall_gable_roof',
        host_surface: 'ridge',
        roof_local_uv: [0.5, 0.47],
        surface_offset: 28,
        surface_distance_mm: 28,
        direction_error_degrees: 0
      }
    }
  }));
  for (let row = 0; row < 8; row += 1) {
    const y = primaryRect.y + primaryRect.depth * (0.14 + row * 0.095);
    const suffix = String(row + 1).padStart(2, '0');
    ops.push(roofStripMeshOp(`blue_hall_roof_panel_seam_${suffix}_left`, titleName(`blue_hall_roof_panel_seam_${row + 1}_left`), primaryRect, bodyHeight, roofRise, primaryRect.x + 1200, ridgeX - 320, y - 65, y + 65, 'left_roof_plane', [0.32, 0.14 + row * 0.095]));
    ops.push(roofStripMeshOp(`blue_hall_roof_panel_seam_${suffix}_right`, titleName(`blue_hall_roof_panel_seam_${row + 1}_right`), primaryRect, bodyHeight, roofRise, ridgeX + 320, primaryRect.x + primaryRect.width - 1200, y - 65, y + 65, 'right_roof_plane', [0.68, 0.14 + row * 0.095]));
  }
  return ops;
}

function roofVentOperations(warehouses) {
  const vents = [];
  let index = 1;
  for (const warehouse of warehouses) {
    const rect = warehouse.rect;
    const ridgeX = rect.x + rect.width * 0.5;
    const z = roofSurfaceZ(rect, warehouse.bodyHeight, warehouse.roofRise, ridgeX) + 24;
    for (let offset = 0.22; offset <= 0.78; offset += 0.14) {
      vents.push(cylinderOp(`roof_vent_${String(index).padStart(2, '0')}`, titleName(`roof_vent_${index}`), [ridgeX, rect.y + rect.depth * offset, z], 190, 420, MATERIALS.vent, 'roof_vent', 12, {
        grounding_status: 'helper_only',
        grounding_method: 'helper_generated',
        source_observation_ids: [],
        projection_residuals: { surface_distance_mm: 24, angle_error_degrees: 0 },
        review_required: true,
        helper_allowed: true,
        qa: {
          roof_surface_fit: {
            graph_id: 'roof_surface_fit',
            host_part_id: `${warehouse.idPrefix}_gable_roof`,
            host_surface: 'ridge',
            roof_local_uv: [0.5, round(offset, 3)],
            surface_offset: 24,
            surface_distance_mm: 24,
            direction_error_degrees: 0
          }
        }
      }));
      index += 1;
    }
  }
  return vents;
}

function tankDetailOperations(tanks, tankEllipseFit) {
  const ops = [];
  let index = 1;
  for (const tank of tanks) {
    const instance = (tankEllipseFit?.instances || []).find((candidate) => candidate.tank_part_id === tank.id);
    const parameters = tank.shape?.parameters || {};
    const [x, y, z = 0] = parameters.origin || [0, 0, 0];
    const radius = parameters.radius || 2500;
    const height = parameters.height || 12000;
    const top = z + height;
    const id = String(index).padStart(2, '0');
    const options = tankDetailQaOptions(instance);
    ops.push(cylinderOp(`tank_${id}_top_cap`, titleName(`tank_${index}_top_cap`), [x, y, top + 80], radius * 0.92, 240, MATERIALS.tankDetail, 'tank_roof_cap', 24, options));
    ops.push(cylinderOp(`tank_${id}_center_hatch`, titleName(`tank_${index}_center_hatch`), [x, y, top + 330], Math.max(420, radius * 0.13), 420, MATERIALS.vent, 'tank_roof_hatch', 16, options));
    ops.push(cylinderOp(`tank_${id}_base_plinth`, titleName(`tank_${index}_base_plinth`), [x, y, 0], radius * 1.08, 280, MATERIALS.curb, 'tank_base_plinth', 24, options));
    ops.push(boxOp(`tank_${id}_service_platform`, titleName(`tank_${index}_service_platform`), [x - radius * 0.38, y - radius * 1.16, 360], [radius * 0.76, radius * 0.28, 260], MATERIALS.pipe, 'tank_service_platform', options));
    index += 1;
  }
  if (tanks.length >= 2) {
    const first = tanks[0].shape.parameters.origin;
    const second = tanks[1].shape.parameters.origin;
    const bridgeX = Math.min(first[0], second[0]);
    const bridgeWidth = Math.abs(first[0] - second[0]);
    const bridgeY = Math.min(first[1], second[1]) - 420;
    ops.push(boxOp('tank_farm_pipe_bridge', 'Tank_Farm_Pipe_Bridge', [bridgeX, bridgeY, 1160], [bridgeWidth, 260, 260], MATERIALS.pipe, 'tank_pipe_bridge', {
      grounding_status: tankEllipseFit?.instances?.length === 2 ? 'review_confirmed' : 'helper_only',
      grounding_method: tankEllipseFit?.instances?.length === 2 ? 'manual_review_ellipse_split' : 'helper_generated',
      source_observation_ids: tankEllipseFit?.instances?.flatMap((instance) => instance.source_observation_ids || []) || [],
      projection_residuals: tankEllipseFit?.instances?.[0]?.projection_residuals || null,
      review_required: true,
      helper_allowed: tankEllipseFit?.instances?.length !== 2,
      qa: {
        tank_ellipse_fit: {
          graph_id: 'tank_ellipse_fit',
          tank_instance_ids: tankEllipseFit?.instances?.map((instance) => instance.id) || [],
          parent_evidence_required: true,
          projection_residuals: tankEllipseFit?.instances?.[0]?.projection_residuals || null
        }
      }
    }));
  }
  return ops;
}

function hvacOperations(utility, admin) {
  const utilityRect = rectFromBoxPart(utility);
  const adminRect = rectFromBoxPart(admin);
  return [
    boxOp('utility_hvac_01', 'Utility_HVAC_01', [utilityRect.x + utilityRect.width * 0.22, utilityRect.y + utilityRect.depth * 0.56, topZ(utility) + 80], [1900, 1600, 650], MATERIALS.hvac, 'roof_hvac', flatRoofQaOptions(utility.id, 80)),
    boxOp('utility_hvac_02', 'Utility_HVAC_02', [utilityRect.x + utilityRect.width * 0.56, utilityRect.y + utilityRect.depth * 0.52, topZ(utility) + 80], [2300, 1800, 650], MATERIALS.hvac, 'roof_hvac', flatRoofQaOptions(utility.id, 80)),
    boxOp('admin_roof_unit_01', 'Admin_Roof_Unit_01', [adminRect.x + adminRect.width * 0.58, adminRect.y + adminRect.depth * 0.58, topZ(admin) + 80], [2100, 1700, 600], MATERIALS.hvac, 'roof_hvac', flatRoofQaOptions(admin.id, 80))
  ];
}

function roofStripMeshOp(id, name, rect, bodyHeight, roofRise, x1, x2, y1, y2, hostSurface, roofLocalUv) {
  const offset = 32;
  const vertices = [
    roofSurfacePoint(rect, bodyHeight, roofRise, x1, y1, offset),
    roofSurfacePoint(rect, bodyHeight, roofRise, x2, y1, offset),
    roofSurfacePoint(rect, bodyHeight, roofRise, x2, y2, offset),
    roofSurfacePoint(rect, bodyHeight, roofRise, x1, y2, offset)
  ];
  return {
    op: 'mesh',
    id,
    name,
    vertices,
    faces: [[0, 1, 2, 3]],
    material: MATERIALS.roofSeam,
    smooth: 'coplanar',
    qa: qaWithGroundingMetadata({
      role: 'roof_panel_seam',
      part_id: id,
      intent: 'r8_roof_surface_bound_panel_seam',
      evidence_status: 'manual_confirmed',
      fallback_state: 'structured_primitive',
      roof_surface_fit: {
        graph_id: 'roof_surface_fit',
        host_part_id: 'primary_blue_hall_gable_roof',
        host_surface: hostSurface,
        roof_local_uv: roofLocalUv,
        surface_offset: offset,
        surface_distance_mm: offset,
        direction_error_degrees: 0.8
      }
    }, {
      grounding_status: 'review_confirmed',
      grounding_method: 'manual_review_roof_surface_fit',
      source_observation_ids: ['building_top_primary_blue_hall_pixel', 'building_oblique_primary_blue_hall'],
      projection_residuals: { surface_distance_mm: offset, angle_error_degrees: 0.8 },
      review_required: true,
      helper_allowed: false,
      photo_grade_eligible: false
    })
  };
}

function tankDetailQaOptions(instance) {
  if (!instance) {
    return {
      grounding_status: 'helper_only',
      grounding_method: 'helper_generated',
      source_observation_ids: [],
      projection_residuals: null,
      review_required: true,
      helper_allowed: true,
      qa: {
        tank_ellipse_fit: {
          graph_id: 'tank_ellipse_fit',
          parent_evidence_required: true,
          accepted_instance: false
        }
      }
    };
  }
  return {
    grounding_status: instance.grounding_status,
    grounding_method: instance.grounding_method,
    source_observation_ids: instance.source_observation_ids || [],
    projection_residuals: instance.projection_residuals,
    review_required: true,
    helper_allowed: false,
    photo_grade_eligible: false,
    qa: {
      tank_ellipse_fit: {
        graph_id: 'tank_ellipse_fit',
        tank_instance_id: instance.id,
        tank_part_id: instance.tank_part_id,
        center: instance.center,
        radius: instance.radius,
        accepted_instance: true,
        projection_residuals: instance.projection_residuals
      }
    }
  };
}

function flatRoofQaOptions(hostPartId, surfaceDistance) {
  return {
    grounding_status: 'helper_only',
    grounding_method: 'helper_generated',
    source_observation_ids: [],
    projection_residuals: { surface_distance_mm: surfaceDistance, angle_error_degrees: 0 },
    review_required: true,
    helper_allowed: true,
    qa: {
      roof_surface_fit: {
        graph_id: 'roof_surface_fit',
        host_part_id: hostPartId,
        host_surface: 'flat_roof_top',
        roof_local_uv: null,
        surface_offset: surfaceDistance,
        surface_distance_mm: surfaceDistance,
        direction_error_degrees: 0
      }
    }
  };
}

function boxOp(id, name, origin, size, material, role, options = {}) {
  return {
    op: 'box',
    id,
    name,
    origin: roundVector(origin),
    size: roundVector(size),
    material,
    qa: qaWithGroundingMetadata({
      role,
      part_id: id,
      intent: 'photoreal_site_detail',
      evidence_status: 'manual_confirmed',
      fallback_state: options.fallback_state || 'visual_helper',
      ...(clone(options.qa || {}))
    }, {
      grounding_status: options.grounding_status || 'helper_only',
      grounding_method: options.grounding_method || 'helper_generated',
      source_observation_ids: options.source_observation_ids || [],
      projection_residuals: options.projection_residuals || null,
      review_required: options.review_required ?? true,
      helper_allowed: options.helper_allowed ?? true,
      photo_grade_eligible: options.photo_grade_eligible ?? false
    })
  };
}

function cylinderOp(id, name, origin, radius, height, material, role, segments = 16, options = {}) {
  return {
    op: 'cylinder',
    id,
    name,
    origin: roundVector(origin),
    radius,
    height,
    segments,
    smooth: 'all',
    material,
    qa: qaWithGroundingMetadata({
      role,
      part_id: id,
      intent: 'photoreal_site_detail',
      evidence_status: 'manual_confirmed',
      fallback_state: options.fallback_state || 'visual_helper',
      ...(clone(options.qa || {}))
    }, {
      grounding_status: options.grounding_status || 'helper_only',
      grounding_method: options.grounding_method || 'helper_generated',
      source_observation_ids: options.source_observation_ids || [],
      projection_residuals: options.projection_residuals || null,
      review_required: options.review_required ?? true,
      helper_allowed: options.helper_allowed ?? true,
      photo_grade_eligible: options.photo_grade_eligible ?? false
    })
  };
}

function rectFromBoxPart(part) {
  const parameters = part.shape?.parameters || {};
  const [x, y] = parameters.origin || [0, 0, 0];
  const [width, depth] = parameters.size || [0, 0, 0];
  return { x: round(x, 1), y: round(y, 1), width: round(width, 1), depth: round(depth, 1) };
}

function boxShape(rect, height) {
  return {
    primitive: 'box',
    parameters: {
      origin: [round(rect.x, 1), round(rect.y, 1), 0],
      size: [round(rect.width, 1), round(rect.depth, 1), round(height, 1)]
    }
  };
}

function topZ(part) {
  const parameters = part.shape?.parameters || {};
  if (part.shape?.primitive === 'box') return Number(parameters.origin?.[2] || 0) + Number(parameters.size?.[2] || 0);
  if (part.shape?.primitive === 'cylinder') return Number(parameters.origin?.[2] || 0) + Number(parameters.height || 0);
  return 0;
}

function mergedTankRect(tanks) {
  const boxes = tanks.map((part) => {
    const origin = part.shape.parameters.origin;
    const radius = part.shape.parameters.radius;
    return {
      minX: origin[0] - radius,
      minY: origin[1] - radius,
      maxX: origin[0] + radius,
      maxY: origin[1] + radius
    };
  });
  const minX = Math.min(...boxes.map((box) => box.minX));
  const minY = Math.min(...boxes.map((box) => box.minY));
  const maxX = Math.max(...boxes.map((box) => box.maxX));
  const maxY = Math.max(...boxes.map((box) => box.maxY));
  return { x: round(minX, 1), y: round(minY, 1), width: round(maxX - minX, 1), depth: round(maxY - minY, 1) };
}

function evidenceGraphPart(part) {
  return {
    part_id: part.id,
    status: part.evidence_status,
    required_views: ['top', 'oblique'],
    confirmed_views: ['top', 'oblique'],
    missing_views: [],
    confidence: part.qa?.evidence_confidence || 0.72,
    sources: part.evidence_sources || [],
    grounding_status: part.grounding_status || 'profile_prior',
    grounding_method: part.grounding_method || null,
    source_observation_ids: part.source_observation_ids || [],
    review_required: part.review_required ?? part.qa?.review_required ?? false,
    photo_grade_eligible: part.photo_grade_eligible ?? false,
    conflicts: part.role === 'roof'
      ? [{ type: 'texture_assisted_roofline', severity: 'info', note: 'Roofline is reconstructed from top-view texture and gable primitive.' }]
      : [],
    open_questions: [`${part.id}: confirm survey dimensions before treating this as production geometry.`]
  };
}

function groundedRelations(parts) {
  return parts
    .filter((part) => ['building', 'site_surface', 'tank'].includes(part.type))
    .filter((part) => part.id !== 'site_boundary')
    .filter((part) => part.shape?.primitive === 'box' || part.shape?.primitive === 'cylinder')
    .map((part) => ({
      id: `${part.id}-grounded`,
      type: 'grounded',
      subject: part.id,
      ground_z: 0,
      severity: 'info',
      note: 'R7 photoreal reconstruction part is grounded to the reviewed site plane.'
    }));
}

function titleName(value) {
  return String(value).split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('_');
}

function roundVector(values) {
  return values.map((value) => round(value, 1));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(resolveRepo(relativePath), 'utf8'));
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-part-graph') parsed.basePartGraph = argv[++index];
    else if (arg === '--output') parsed.output = argv[++index];
    else if (arg === '--geometry-only') parsed.geometryOnly = true;
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-building-group-photoreal-part-graph.mjs \\
    --base-part-graph projects/image-structured-modeler/examples/building-group/part-graph.r7-final.json \\
    --output projects/image-structured-modeler/examples/building-group/part-graph.r7-photoreal.json

  node projects/image-structured-modeler/scripts/build-building-group-photoreal-part-graph.mjs \\
    --geometry-only \\
    --output projects/image-structured-modeler/examples/building-group/part-graph.r8-geometry.json
`);
  process.exit(0);
}
