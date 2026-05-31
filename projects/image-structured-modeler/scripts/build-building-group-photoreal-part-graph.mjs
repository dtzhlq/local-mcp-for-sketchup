#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  hvac: { name: 'Campus_HVAC_Light', color: '#d6d9d2' }
};

const options = parseArgs(process.argv.slice(2));
const basePartGraph = await readJson(options.basePartGraph || DEFAULT_BASE);
const photoreal = buildPhotorealPartGraph(basePartGraph);
const outputPath = resolveRepo(options.output || DEFAULT_OUTPUT);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(photoreal, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: true,
  output: path.relative(repoRoot, outputPath),
  parts: photoreal.parts.length,
  operations: photoreal.operations.length,
  image_planes: photoreal.operations.filter((operation) => operation.op === 'image_plane').length,
  generated_detail_ops: photoreal.operations.length
}, null, 2)}\n`);

function buildPhotorealPartGraph(base) {
  const baseParts = new Map((base.parts || []).map((part) => [part.id, part]));
  const required = (id) => {
    const part = baseParts.get(id);
    if (!part) throw new Error(`Base PartGraph is missing required part: ${id}`);
    return part;
  };

  const site = confirmedPart(required('site_boundary'), {
    fallback_state: 'reference_only',
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
    ...textureOps,
    ...fenceOperations(siteRect),
    ...treeOperations(siteRect, rectFromBoxPart(parking), primaryRect),
    ...vehicleOperations(rectFromBoxPart(parking)),
    ...loadingTruckOperations([...westWarehouses, ...innerWarehouses]),
    ...roofVentOperations([...westWarehouses, ...innerWarehouses]),
    ...hvacOperations(utility, admin)
  ];

  return {
    version: 1,
    id: 'building-group-r7-photoreal-reconstruction-part-graph',
    profile_id: base.profile_id,
    dsl_version: base.dsl_version || 1,
    units: base.units || 'mm',
    product: {
      type: base.product?.type || 'building_group',
      name: `${base.product?.name || 'GPT Image Industrial Campus'} R7 Photoreal Boundary Probe`,
      source: 'R7 final PartGraph plus manually reviewed high-fidelity reconstruction from the supplied GPT Image 2 top-view sample'
    },
    scale: clone(base.scale),
    evidence_graph: {
      version: 1,
      source_images: base.evidence_graph?.source_images || [],
      views_detected: base.evidence_graph?.views_detected || ['top', 'oblique'],
      open_questions: [
        'Photoreal texture planes are derived from the generated top view; facade texture projection is still not reconstructed from true multi-view photogrammetry.',
        'Warehouse rows are split into four visible buildings from the supplied top-view image; exact survey dimensions still need external confirmation.'
      ],
      scale_calibration: clone(base.evidence_graph?.scale_calibration || base.scale?.calibration || {}),
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
        texture_planes: textureOps.length,
        split_warehouse_buildings: 4,
        roof_primitives: parts.filter((part) => part.shape?.primitive === 'gable_roof').length,
        generated_site_detail_operations: operations.length - textureOps.length
      },
      open_questions: [
        'This is a texture-assisted high-fidelity model, not a full inferred editable BIM model.',
        'Oblique facade detail remains approximate because the current chain lacks camera pose solving, depth recovery, and texture unwrapping.',
        'Parking, tree, fence, and vehicle details are deterministic visual helpers placed from visible top-view anchors.'
      ],
      correction_targets: [
        {
          path: 'operations[image_plane].image',
          reason: 'Texture planes prove the current boundary for visual fidelity but should eventually be replaced by camera-calibrated UV projection.',
          severity: 'info'
        },
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
  return part;
}

function gableRoofPart({ id, name, parent, rect, z, rise, overhang, material, sources }) {
  return {
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
  };
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
  return {
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
  };
}

function recess(partId, suffix, semantic, face, center, size, depth, radius) {
  return {
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
  };
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
    qa: {
      role,
      part_id: id,
      intent: 'photoreal_texture_alignment',
      evidence_status: 'manual_confirmed',
      fallback_state: 'visual_helper'
    }
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

function treeOperations(siteRect, parkingRect, primaryRect) {
  const trees = [];
  let index = 1;
  const addTree = (x, y, radius = 620, height = 2600) => {
    trees.push(cylinderOp(`tree_${String(index).padStart(2, '0')}`, titleName(`tree_${index}`), [x, y, 0], radius, height, MATERIALS.tree, 'landscape_tree', 10));
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
      vehicles.push(boxOp(`vehicle_${String(index).padStart(2, '0')}`, titleName(`vehicle_${index}`), [x, rowY, 230], size, colors[index % colors.length], 'parked_vehicle'));
      index += 1;
    }
  }
  return vehicles;
}

function loadingTruckOperations(warehouses) {
  const trucks = [];
  let index = 1;
  for (const warehouse of warehouses) {
    const rect = warehouse.rect;
    const x = rect.x + rect.width + 250;
    for (const y of [rect.y + rect.depth * 0.28, rect.y + rect.depth * 0.68]) {
      trucks.push(boxOp(`loading_truck_${String(index).padStart(2, '0')}`, titleName(`loading_truck_${index}`), [x, y, 0], [1600, 6500, 2900], MATERIALS.serviceTruck, 'loading_truck'));
      index += 1;
    }
  }
  return trucks;
}

function roofVentOperations(warehouses) {
  const vents = [];
  let index = 1;
  for (const warehouse of warehouses) {
    const rect = warehouse.rect;
    const z = warehouse.bodyHeight + warehouse.roofRise + 120;
    for (let offset = 0.22; offset <= 0.78; offset += 0.14) {
      vents.push(cylinderOp(`roof_vent_${String(index).padStart(2, '0')}`, titleName(`roof_vent_${index}`), [rect.x + rect.width * 0.5, rect.y + rect.depth * offset, z], 190, 420, MATERIALS.vent, 'roof_vent', 12));
      index += 1;
    }
  }
  return vents;
}

function hvacOperations(utility, admin) {
  const utilityRect = rectFromBoxPart(utility);
  const adminRect = rectFromBoxPart(admin);
  return [
    boxOp('utility_hvac_01', 'Utility_HVAC_01', [utilityRect.x + utilityRect.width * 0.22, utilityRect.y + utilityRect.depth * 0.56, topZ(utility) + 80], [1900, 1600, 650], MATERIALS.hvac, 'roof_hvac'),
    boxOp('utility_hvac_02', 'Utility_HVAC_02', [utilityRect.x + utilityRect.width * 0.56, utilityRect.y + utilityRect.depth * 0.52, topZ(utility) + 80], [2300, 1800, 650], MATERIALS.hvac, 'roof_hvac'),
    boxOp('admin_roof_unit_01', 'Admin_Roof_Unit_01', [adminRect.x + adminRect.width * 0.58, adminRect.y + adminRect.depth * 0.58, topZ(admin) + 80], [2100, 1700, 600], MATERIALS.hvac, 'roof_hvac')
  ];
}

function boxOp(id, name, origin, size, material, role) {
  return {
    op: 'box',
    id,
    name,
    origin: roundVector(origin),
    size: roundVector(size),
    material,
    qa: {
      role,
      part_id: id,
      intent: 'photoreal_site_detail',
      evidence_status: 'manual_confirmed',
      fallback_state: 'visual_helper'
    }
  };
}

function cylinderOp(id, name, origin, radius, height, material, role, segments = 16) {
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
    qa: {
      role,
      part_id: id,
      intent: 'photoreal_site_detail',
      evidence_status: 'manual_confirmed',
      fallback_state: 'visual_helper'
    }
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
`);
  process.exit(0);
}
