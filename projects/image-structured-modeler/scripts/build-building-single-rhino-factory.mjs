#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const defaultOutputDir = 'projects/image-structured-modeler/examples/building-single-rhino-factory';

const sourceImages = [
  {
    id: 'elevation_sheet',
    path: 'test/建筑群/建筑单体/AI解放生产力之Rhino 建模_4_九思摸鱼第一名_来自小红书网页版.jpg',
    width_px: 1571,
    height_px: 1080,
    view_kind: 'dimensioned_front_and_side_elevations'
  },
  {
    id: 'plan_sheet',
    path: 'test/建筑群/建筑单体/AI解放生产力之Rhino 建模_5_九思摸鱼第一名_来自小红书网页版.jpg',
    width_px: 2123,
    height_px: 1080,
    view_kind: 'dimensioned_roof_plan'
  }
];

const dimensions = {
  unit: 'mm',
  length: 136200,
  depth: 40200,
  main_height: 13000,
  max_height: 15100,
  below_grade_marker: -150,
  plan_segments: [17100, 6000, 42000, 6000, 42000, 6000, 17100],
  story_count: 1,
  story_height_label: 13000
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = resolveRepo(options.outputDir || defaultOutputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const observations = buildObservations();
  const partGraph = buildPartGraph();
  const outputDsl = buildDsl();
  const qaSpec = buildModelQaSpec();
  const summary = buildSummary(outputDsl, partGraph);

  await writeJson(path.join(outputDir, 'observations.json'), observations);
  await writeJson(path.join(outputDir, 'part-graph.dimensioned.json'), partGraph);
  await writeJson(path.join(outputDir, 'output.dimensioned.json'), outputDsl);
  await writeJson(path.join(outputDir, 'model-qa-spec.json'), qaSpec);
  await fs.writeFile(path.join(outputDir, 'model-summary.md'), summary, 'utf8');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    output_dir: path.relative(repoRoot, outputDir),
    operations: outputDsl.operations.length,
    parts: partGraph.parts.length,
    hard_dimensions_mm: dimensions,
    source_images: sourceImages.map((image) => image.path)
  }, null, 2)}\n`);
}

function buildObservations() {
  return {
    version: 1,
    object: {
      type: 'building_single',
      name: 'Dimensioned production workshop from RhinoMCP reference sheets',
      scope: 'single_industrial_workshop',
      reconstruction_status: 'dimensioned_drawing_grounded',
      review_required: true
    },
    images: sourceImages.map((image) => ({
      id: image.id,
      image: {
        path: image.path,
        width_px: image.width_px,
        height_px: image.height_px
      },
      assigned_view: image.view_kind,
      quality: {
        status: 'usable',
        note: image.id === 'plan_sheet'
          ? 'Plan sheet contains hard footprint dimensions and rooftop photovoltaic label.'
          : 'Elevation sheet contains front/side facade proportions, material labels, and height datum marks.'
      }
    })),
    dimensions: {
      source: 'drawing_annotation',
      status: 'hard_scale',
      values: dimensions
    },
    evidence: [
      {
        id: 'overall_plan_length',
        kind: 'dimension_chain',
        source_image: sourceImages[1].path,
        value_mm: dimensions.length,
        basis: 'top dimension reads 136200'
      },
      {
        id: 'overall_plan_depth',
        kind: 'dimension_chain',
        source_image: sourceImages[1].path,
        value_mm: dimensions.depth,
        basis: 'left dimension reads 40200'
      },
      {
        id: 'height_main_wall',
        kind: 'height_datum',
        source_image: sourceImages[0].path,
        value_mm: dimensions.main_height,
        basis: 'elevation datum shows +13.000 and plan text marks H=13M'
      },
      {
        id: 'height_roof_monitor_or_parapet',
        kind: 'height_datum',
        source_image: sourceImages[0].path,
        value_mm: dimensions.max_height,
        basis: 'elevation marker reaches about +15.100'
      },
      {
        id: 'facade_materials',
        kind: 'material_label',
        source_image: sourceImages[0].path,
        values: ['orange color steel plate', 'light grey color steel plate']
      },
      {
        id: 'roof_photovoltaic',
        kind: 'program_label',
        source_image: sourceImages[1].path,
        value: 'roof solar photovoltaic'
      }
    ]
  };
}

function buildPartGraph() {
  const [xMin, xMax, yMin, yMax] = bounds();
  const bayEdges = bayEdgeCoordinates();
  return {
    version: 1,
    id: 'building-single-rhino-factory-dimensioned-part-graph',
    product_type: 'building_single',
    product_name: 'Dimensioned Production Workshop',
    source: 'manual_dimensioned_drawing_grounding',
    units: 'mm',
    review: {
      status: 'technical_baseline',
      review_required: true,
      reasons: [
        'Source sheets are drawings/screenshots, not calibrated survey data.',
        'Facade details are dimensioned from elevation proportions where explicit dimensions are absent.'
      ]
    },
    evidence_sources: sourceImages,
    scale: {
      method: 'drawing_dimension_chain',
      length_mm: dimensions.length,
      depth_mm: dimensions.depth,
      main_height_mm: dimensions.main_height,
      max_height_mm: dimensions.max_height,
      plan_segment_edges_mm: bayEdges
    },
    parts: [
      part('site_slab', 'site_reference', [-70000, -22000, -180], [140000, 44000, 180], 'hard_dimension_context'),
      part('main_shell', 'industrial_workshop_shell', [xMin, yMin, 0], [dimensions.length, dimensions.depth, dimensions.main_height], 'hard_dimension'),
      part('front_facade', 'front_elevation', [xMin, yMin, 0], [dimensions.length, 350, dimensions.main_height], 'elevation_observed'),
      part('rear_facade', 'rear_elevation_inferred', [xMin, yMax - 350, 0], [dimensions.length, 350, dimensions.main_height], 'inferred_no_reference_elevation'),
      part('side_facades', 'side_elevation_observed', [xMin, yMin, 0], [dimensions.length, dimensions.depth, dimensions.main_height], 'elevation_observed'),
      part('orange_cladding_system', 'facade_color_steel_plate', [xMin, yMin - 80, 0], [dimensions.length, 160, dimensions.main_height], 'elevation_observed'),
      part('glass_window_system', 'curtain_and_ribbon_windows', [xMin, yMin - 90, 1000], [dimensions.length, 180, 8200], 'elevation_observed'),
      part('roof_slab', 'flat_roof', [xMin, yMin, dimensions.main_height], [dimensions.length, dimensions.depth, 500], 'height_datum'),
      part('roof_monitor', 'raised_roof_monitor_or_parapet', [-47500, -2400, 13500], [95000, 4800, 1600], 'height_datum'),
      part('solar_pv_array', 'rooftop_photovoltaic', [-52000, -16000, 13500], [104000, 12000, 120], 'plan_label'),
      part('structural_bay_grid', 'dimension_chain_grid', [xMin, yMin, 0], [dimensions.length, dimensions.depth, dimensions.max_height], 'hard_dimension')
    ]
  };
}

function buildDsl() {
  const ops = [];
  const [xMin, xMax, yMin, yMax] = bounds();
  const wallT = 350;
  const facadeLayer = 90;
  const glassT = 60;
  const frameT = 30;

  ops.push({ op: 'reset' });
  addMaterialOps(ops);
  ops.push({ op: 'level', name: 'Level_0_000', elevation: 0, height: dimensions.main_height });
  ops.push({ op: 'level', name: 'Roof_Datum_13_000', elevation: dimensions.main_height });
  ops.push({ op: 'level', name: 'Max_Datum_15_100', elevation: dimensions.max_height });

  box(ops, 'Site_Slab_140m_x_44m', [-70000, -22000, -180], [140000, 44000, 180], 'Factory_Ground', { role: 'site_reference' });
  box(ops, 'Below_Grade_Datum_Minus_150', [xMin, yMin, -150], [dimensions.length, dimensions.depth, 40], 'Factory_Datum_Dark', { role: 'datum_marker' });

  ops.push({
    op: 'wall',
    id: 'front_facade_wall',
    name: 'Front_Facade_Wall_With_Observed_Openings',
    start: [xMin, yMin, 0],
    end: [xMax, yMin, 0],
    height: dimensions.main_height,
    thickness: wallT,
    openings: frontOpenings().map(openingToWallLocal),
    material: 'Factory_Light_Grey_Panel',
    qa: { role: 'front_facade_wall', source_image: sourceImages[0].path }
  });
  ops.push({
    op: 'wall',
    id: 'rear_facade_wall',
    name: 'Rear_Facade_Wall_Inferred_No_Drawing',
    start: [xMin, yMax - wallT, 0],
    end: [xMax, yMax - wallT, 0],
    height: dimensions.main_height,
    thickness: wallT,
    openings: [],
    material: 'Factory_Light_Grey_Panel',
    qa: { role: 'rear_facade_inferred', source_image: null, review_required: true }
  });
  ops.push({
    op: 'wall',
    id: 'west_end_wall',
    name: 'West_End_Wall',
    start: [xMin, yMin, 0],
    end: [xMin, yMax, 0],
    height: dimensions.main_height,
    thickness: wallT,
    openings: endWallOpenings().map(openingToSideWallLocal),
    material: 'Factory_Light_Grey_Panel',
    qa: { role: 'end_wall' }
  });
  ops.push({
    op: 'wall',
    id: 'east_end_wall',
    name: 'East_End_Wall',
    start: [xMax - wallT, yMin, 0],
    end: [xMax - wallT, yMax, 0],
    height: dimensions.main_height,
    thickness: wallT,
    openings: endWallOpenings().map(openingToSideWallLocal),
    material: 'Factory_Light_Grey_Panel',
    qa: { role: 'end_wall' }
  });

  box(ops, 'Front_White_Platform_Base', [xMin, yMin - 160, 0], [dimensions.length, 160, 1000], 'Factory_Concrete_Light', facadeQa('front_plinth'));
  box(ops, 'Rear_White_Platform_Base', [xMin, yMax, 0], [dimensions.length, 160, 1000], 'Factory_Concrete_Light', facadeQa('rear_plinth'));

  box(ops, 'Main_Roof_Slab_13m_Datum', [xMin, yMin, dimensions.main_height], [dimensions.length, dimensions.depth, 500], 'Factory_Roof_Light', { role: 'flat_roof' });
  box(ops, 'Roof_Monitor_To_15_1m', [-47500, -2400, 13500], [95000, 4800, 1600], 'Factory_Roof_Light', { role: 'raised_roof_monitor' });
  box(ops, 'Roof_Monitor_Front_Glass_Ribbon', [-43000, -2460, 13900], [86000, 60, 760], 'Factory_Glass_Blue', { role: 'roof_monitor_window' });
  box(ops, 'Roof_Monitor_Rear_Glass_Ribbon', [-43000, 2400, 13900], [86000, 60, 760], 'Factory_Glass_Blue', { role: 'roof_monitor_window' });
  box(ops, 'Front_Thin_White_Roof_Cap', [xMin - 250, yMin - 260, 13180], [dimensions.length + 500, 260, 220], 'Factory_Roof_Cap_White', facadeQa('front_roof_cap'));
  box(ops, 'Rear_Thin_White_Roof_Cap', [xMin - 250, yMax, 13180], [dimensions.length + 500, 260, 220], 'Factory_Roof_Cap_White', facadeQa('rear_roof_cap'));

  addOrangeFacade(ops, 'Front', yMin, 'front');
  addSideElevationFacades(ops, xMin, xMax, yMin, yMax);

  addFrontWindowsAndDoors(ops, yMin, glassT, frameT);
  addEndWindows(ops, xMin, xMax, yMin, yMax, glassT, frameT);
  addCanopies(ops, yMin, yMax);
  addCladdingAndBayLines(ops, yMin, yMax);
  addRoofPhotovoltaicAndSeams(ops);
  addScenes(ops);

  return {
    version: 1,
    units: 'mm',
    metadata: {
      kind: 'product_modeling_dsl',
      profile_id: 'building_single_dimensioned_factory',
      product_type: 'building_single',
      product_name: 'Dimensioned Production Workshop',
      source: 'manual_dimensioned_drawing_grounding',
      reconstruction_status: 'technical_baseline',
      source_images: sourceImages,
      dimensions
    },
    operations: ops
  };

  function addOrangeFacade(target, prefix, y, side) {
    const front = side === 'front';
    const panelT = 70;
    const midBandWidth = 19500;
    const y0 = front ? y - panelT : y;
    const layerSize = [dimensions.length, panelT, 3500];
    box(target, `${prefix}_Orange_Top_Color_Steel_Band`, [xMin, y0, 9300], layerSize, 'Factory_Orange_Steel', facadeQa(`${side}_orange_top_band`));
    box(target, `${prefix}_Orange_Left_Mid_Band`, [xMin, y0, 4800], [midBandWidth, panelT, 1700], 'Factory_Orange_Steel', facadeQa(`${side}_orange_mid_band`));
    box(target, `${prefix}_Orange_Right_Mid_Band`, [xMax - midBandWidth, y0, 4800], [midBandWidth, panelT, 1700], 'Factory_Orange_Steel', facadeQa(`${side}_orange_mid_band`));
    addFrontOrangeRibsRect(target, `${prefix}_Orange_Top_Color_Steel_Band`, side, xMin, 9300, dimensions.length, 3500);
    addFrontOrangeRibsRect(target, `${prefix}_Orange_Left_Mid_Band`, side, xMin, 4800, midBandWidth, 1700);
    addFrontOrangeRibsRect(target, `${prefix}_Orange_Right_Mid_Band`, side, xMax - midBandWidth, 4800, midBandWidth, 1700);
    const leftDiagonal = [
      [-50200, 9300],
      [-45900, 9300],
      [-49200, 1000],
      [-53500, 1000]
    ];
    const rightDiagonal = [
      [45900, 9300],
      [50200, 9300],
      [53500, 1000],
      [49200, 1000]
    ];
    verticalFacadeQuad(target, `${prefix}_Orange_Left_Diagonal_Brace`, side, leftDiagonal, 'Factory_Orange_Steel', facadeQa(`${side}_orange_diagonal`));
    verticalFacadeQuad(target, `${prefix}_Orange_Right_Diagonal_Brace`, side, rightDiagonal, 'Factory_Orange_Steel', facadeQa(`${side}_orange_diagonal`));
    addFrontOrangeRibsQuad(target, `${prefix}_Orange_Left_Diagonal_Brace`, side, leftDiagonal);
    addFrontOrangeRibsQuad(target, `${prefix}_Orange_Right_Diagonal_Brace`, side, rightDiagonal);
  }

  function verticalFacadeQuad(target, name, side, xzPoints, material, qa) {
    const ySurface = side === 'front' ? yMin - 82 : yMax + 82;
    target.push({
      op: 'mesh',
      id: idFor(name),
      name,
      vertices: xzPoints.map(([x, z]) => [x, ySurface, z]),
      faces: [[0, 1, 2, 3]],
      material,
      smooth: 'coplanar',
      qa
    });
  }

  function addSideElevationFacades(target, westX, eastX, southY, northY) {
    addSideElevationFacade(target, 'West_Side', 'west', westX, southY, northY);
    addSideElevationFacade(target, 'East_Side', 'east', eastX, southY, northY);
  }

  function addSideElevationFacade(target, prefix, side, xSurface, southY, northY) {
    const west = side === 'west';
    const panelT = 70;
    const endBandWidth = 8200;
    const x0 = west ? xSurface - panelT : xSurface;
    const xPlane = west ? xSurface - 82 : xSurface + 82;
    const qaPrefix = west ? 'west_side' : 'east_side';
    box(target, `${prefix}_Orange_Top_Color_Steel_Band`, [x0, southY, 9300], [panelT, dimensions.depth, 3500], 'Factory_Orange_Steel', facadeQa(`${qaPrefix}_orange_top_band`));
    box(target, `${prefix}_Orange_Left_Mid_Band`, [x0, southY, 4800], [panelT, endBandWidth, 1700], 'Factory_Orange_Steel', facadeQa(`${qaPrefix}_orange_mid_band`));
    box(target, `${prefix}_Orange_Right_Mid_Band`, [x0, northY - endBandWidth, 4800], [panelT, endBandWidth, 1700], 'Factory_Orange_Steel', facadeQa(`${qaPrefix}_orange_mid_band`));
    addSideOrangeRibsRect(target, `${prefix}_Orange_Top_Color_Steel_Band`, side, xSurface, southY, 9300, dimensions.depth, 3500);
    addSideOrangeRibsRect(target, `${prefix}_Orange_Left_Mid_Band`, side, xSurface, southY, 4800, endBandWidth, 1700);
    addSideOrangeRibsRect(target, `${prefix}_Orange_Right_Mid_Band`, side, xSurface, northY - endBandWidth, 4800, endBandWidth, 1700);
    box(target, `${prefix}_Light_Base_Platform`, [x0, southY, 0], [panelT, dimensions.depth, 1000], 'Factory_Concrete_Light', facadeQa(`${qaPrefix}_plinth`));
    box(target, `${prefix}_Thin_White_Roof_Cap`, [x0, southY - 250, 13180], [panelT, dimensions.depth + 500, 220], 'Factory_Roof_Cap_White', facadeQa(`${qaPrefix}_roof_cap`));
    const leftDiagonal = [
      [southY + 9000, 9300],
      [southY + 14600, 9300],
      [southY + 9000, 1000],
      [southY + 3400, 1000]
    ];
    const rightDiagonal = [
      [northY - 14600, 9300],
      [northY - 9000, 9300],
      [northY - 3400, 1000],
      [northY - 9000, 1000]
    ];
    verticalSideQuad(target, `${prefix}_Orange_Left_Diagonal_Brace`, xPlane, leftDiagonal, 'Factory_Orange_Steel', facadeQa(`${qaPrefix}_orange_diagonal`));
    verticalSideQuad(target, `${prefix}_Orange_Right_Diagonal_Brace`, xPlane, rightDiagonal, 'Factory_Orange_Steel', facadeQa(`${qaPrefix}_orange_diagonal`));
    addSideOrangeRibsQuad(target, `${prefix}_Orange_Left_Diagonal_Brace`, side, xSurface, leftDiagonal);
    addSideOrangeRibsQuad(target, `${prefix}_Orange_Right_Diagonal_Brace`, side, xSurface, rightDiagonal);
    for (const y of range(southY + 2500, northY - 2500, 2800)) {
      box(target, `${prefix}_Light_Grey_Vertical_Cladding_Rib_${safeCoord(y)}`, [west ? xSurface - 52 : xSurface, y, 1100], [52, 44, 7800], 'Factory_Subtle_Rib', facadeQa(`${qaPrefix}_cladding_rib`));
    }
  }

  function addFrontOrangeRibsRect(target, baseName, side, x, z, width, height) {
    const ySurface = side === 'front' ? yMin - 96 : yMax + 76;
    for (let zz = z + 360; zz < z + height - 180; zz += 420) {
      box(target, `${baseName}_Horizontal_Panel_Rib_${safeCoord(zz)}`, [x, ySurface, zz], [width, 20, 28], 'Factory_Orange_Rib', facadeQa(`${side}_orange_horizontal_panel_rib`));
    }
  }

  function addFrontOrangeRibsQuad(target, baseName, side, points) {
    const ySurface = side === 'front' ? yMin - 100 : yMax + 80;
    const minZ = Math.min(...points.map((point) => point[1]));
    const maxZ = Math.max(...points.map((point) => point[1]));
    for (let zz = minZ + 360; zz < maxZ - 180; zz += 420) {
      const segment = horizontalSegmentForQuad(points, zz);
      if (!segment || segment[1] - segment[0] < 600) continue;
      box(target, `${baseName}_Horizontal_Panel_Rib_${safeCoord(zz)}`, [segment[0], ySurface, zz], [segment[1] - segment[0], 20, 28], 'Factory_Orange_Rib', facadeQa(`${side}_orange_horizontal_panel_rib`));
    }
  }

  function addSideOrangeRibsRect(target, baseName, side, xSurface, y, z, width, height) {
    const west = side === 'west';
    const xRib = west ? xSurface - 96 : xSurface + 76;
    for (let zz = z + 360; zz < z + height - 180; zz += 420) {
      box(target, `${baseName}_Horizontal_Panel_Rib_${safeCoord(zz)}`, [xRib, y, zz], [20, width, 28], 'Factory_Orange_Rib', facadeQa(`${side}_orange_horizontal_panel_rib`));
    }
  }

  function addSideOrangeRibsQuad(target, baseName, side, xSurface, points) {
    const west = side === 'west';
    const xRib = west ? xSurface - 100 : xSurface + 80;
    const minZ = Math.min(...points.map((point) => point[1]));
    const maxZ = Math.max(...points.map((point) => point[1]));
    for (let zz = minZ + 360; zz < maxZ - 180; zz += 420) {
      const segment = horizontalSegmentForQuad(points, zz);
      if (!segment || segment[1] - segment[0] < 600) continue;
      box(target, `${baseName}_Horizontal_Panel_Rib_${safeCoord(zz)}`, [xRib, segment[0], zz], [20, segment[1] - segment[0], 28], 'Factory_Orange_Rib', facadeQa(`${side}_orange_horizontal_panel_rib`));
    }
  }

  function horizontalSegmentForQuad(points, z) {
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const [u1, z1] = points[index];
      const [u2, z2] = points[(index + 1) % points.length];
      if (Math.abs(z2 - z1) < 1e-6) continue;
      const minZ = Math.min(z1, z2);
      const maxZ = Math.max(z1, z2);
      if (z < minZ || z > maxZ) continue;
      const t = (z - z1) / (z2 - z1);
      intersections.push(u1 + (u2 - u1) * t);
    }
    if (intersections.length < 2) return null;
    intersections.sort((a, b) => a - b);
    return [intersections[0], intersections[intersections.length - 1]];
  }

  function verticalSideQuad(target, name, xSurface, yzPoints, material, qa) {
    target.push({
      op: 'mesh',
      id: idFor(name),
      name,
      vertices: yzPoints.map(([y, z]) => [xSurface, y, z]),
      faces: [[0, 1, 2, 3]],
      material,
      smooth: 'coplanar',
      qa
    });
  }

  function addCanopies(target, southY, northY) {
    const canopies = [
      { name: 'Front_Left_Loading_Canopy', x: -39500, z: 4750, width: 15000, depth: 3600, thickness: 220, shadowZ: 4440 },
      { name: 'Front_Right_Loading_Canopy', x: 15500, z: 4750, width: 15000, depth: 3600, thickness: 220, shadowZ: 4440 },
      { name: 'Front_Left_Small_Entry_Canopy', x: -46200, z: 3200, width: 5200, depth: 1600, thickness: 180, shadowZ: 2920 },
      { name: 'Front_Right_Small_Entry_Canopy', x: 32300, z: 3200, width: 5200, depth: 1600, thickness: 180, shadowZ: 2920 }
    ];
    for (const canopy of canopies) {
      const y = southY - canopy.depth;
      box(target, canopy.name, [canopy.x, y, canopy.z], [canopy.width, canopy.depth, canopy.thickness], 'Factory_Canopy_Light', facadeQa('front_canopy'));
      box(target, `${canopy.name}_Shadow_Line`, [canopy.x, southY - 170, canopy.shadowZ], [canopy.width, 110, 260], 'Factory_Shadow_Grey', facadeQa('front_canopy_shadow'));
    }
  }

  function addCladdingAndBayLines(target, southY, northY) {
    const ribXs = range(-65000, 65000, 4200);
    for (const x of ribXs) {
      if (Math.abs(x) < 2000) continue;
      box(target, `Front_Light_Grey_Vertical_Cladding_Rib_${safeCoord(x)}`, [x, southY - 52, 1100], [48, 52, 7800], 'Factory_Subtle_Rib', facadeQa('front_cladding_rib'));
    }
    for (const x of bayEdgeCoordinates().slice(1, -1)) {
      box(target, `Front_Dimension_Bay_Joint_${safeCoord(x)}`, [x - 80, southY - 75, 0], [160, 75, dimensions.main_height], 'Factory_Bay_Joint', facadeQa('front_bay_joint'));
      box(target, `Roof_Dimension_Bay_Joint_${safeCoord(x)}`, [x - 70, yMin, dimensions.main_height + 500], [140, dimensions.depth, 45], 'Factory_Bay_Joint', { role: 'roof_bay_joint' });
    }
  }

  function addRoofPhotovoltaicAndSeams(target) {
    box(target, 'Roof_Photovoltaic_Array_From_Plan_Label', [-52000, -16000, 13500], [104000, 12000, 120], 'Factory_PV_Dark_Blue', { role: 'rooftop_photovoltaic', source_image: sourceImages[1].path });
    for (const x of range(-52000, 52000, 5200).slice(1, -1)) {
      box(target, `PV_Module_Vertical_Joint_${safeCoord(x)}`, [x - 35, -16000, 13625], [70, 12000, 50], 'Factory_PV_Joint', { role: 'pv_module_joint' });
    }
    for (const y of [-13000, -10000, -7000]) {
      box(target, `PV_Module_Horizontal_Joint_${safeCoord(y)}`, [-52000, y - 30, 13625], [104000, 60, 50], 'Factory_PV_Joint', { role: 'pv_module_joint' });
    }
    for (const x of range(-65000, 65000, 3900)) {
      box(target, `Roof_Color_Steel_Seam_${safeCoord(x)}`, [x, -20100, 13500], [36, 40200, 35], 'Factory_Roof_Seam', { role: 'roof_color_steel_seam' });
    }
  }

  function addScenes(target) {
    target.push(
      {
        op: 'scene',
        name: 'Front_Elevation_Check',
        camera: { eye: [0, -165000, 28000], target: [0, 0, 6500], up: [0, 0, 1], fov: 28 }
      },
      {
        op: 'scene',
        name: 'Roof_Plan_Check',
        camera: { eye: [0, 0, 175000], target: [0, 0, 7000], up: [0, 1, 0], fov: 30 }
      },
      {
        op: 'scene',
        name: 'Side_Elevation_Check',
        camera: { eye: [165000, 0, 28000], target: [0, 0, 6500], up: [0, 0, 1], fov: 28 }
      },
      {
        op: 'scene',
        name: 'Oblique_Model_Check',
        camera: { eye: [108000, -105000, 52000], target: [0, 0, 6200], up: [0, 0, 1], fov: 38 }
      }
    );
  }
}

function addFrontWindowsAndDoors(ops, yMin, glassT, frameT) {
  const bands = [
    ['Front_Left_Upper_Window_Band', -68100, 6500, 16500, 2500, 7],
    ['Front_Right_Upper_Window_Band', 51600, 6500, 16500, 2500, 7],
    ['Front_Left_Lower_Window_Band', -68100, 1500, 12800, 2900, 5],
    ['Front_Right_Lower_Window_Band', 55300, 1500, 12800, 2900, 5],
    ['Front_Center_Left_Rect_Window', -30000, 6600, 7600, 2400, 4],
    ['Front_Center_Right_Rect_Window', 22400, 6600, 7600, 2400, 4]
  ];
  for (const [name, x, z, w, h, modules] of bands) addFrontGlassBand(ops, name, x, z, w, h, modules, yMin, glassT, frameT);
  for (const [index, x] of [-14200, -10100, -5600, 5600, 10100, 14200].entries()) {
    addFrontGlassBand(ops, `Front_Tall_Narrow_Vertical_Window_${index + 1}`, x, 1800, 1250, 7200, 1, yMin, glassT, frameT);
  }
  addRollingDoor(ops, 'Front_Left_Rolling_Loading_Door', -35200, 0, 6800, 4200, yMin);
  addRollingDoor(ops, 'Front_Right_Rolling_Loading_Door', 19400, 0, 6800, 4200, yMin);
  addPersonnelDoor(ops, 'Front_Left_Personnel_Door', -44900, 0, 2100, 2600, yMin);
  addPersonnelDoor(ops, 'Front_Right_Personnel_Door', 33300, 0, 2100, 2600, yMin);
}

function addRearWindowsAndDoors(ops, yMax, glassT, frameT) {
  addRearGlassBand(ops, 'Rear_Continuous_Upper_Ribbon_Window', -42000, 6600, 84000, 2500, 18, yMax, glassT, frameT);
  addRearGlassBand(ops, 'Rear_Left_Upper_End_Window', -68100, 6500, 16000, 2500, 6, yMax, glassT, frameT);
  addRearGlassBand(ops, 'Rear_Right_Upper_End_Window', 52100, 6500, 16000, 2500, 6, yMax, glassT, frameT);
  for (const [index, x] of [-31000, -16500, 6500, 21500].entries()) {
    addRearGlassBand(ops, `Rear_Lower_Rect_Window_${index + 1}`, x, 1500, 7000, 2300, 3, yMax, glassT, frameT);
  }
}

function addEndWindows(ops, xMin, xMax, yMin, yMax, glassT, frameT) {
  addSideGlassBand(ops, 'West_Side_Continuous_Upper_Ribbon_Window', 'west', xMin, -10000, 6800, 20500, 1900, 10, glassT, frameT);
  addSideGlassBand(ops, 'East_Side_Continuous_Upper_Ribbon_Window', 'east', xMax, -10000, 6800, 20500, 1900, 10, glassT, frameT);
  for (const [index, y] of [-9800, -3900, 2500, 9000].entries()) {
    addSideGlassBand(ops, `West_Side_Lower_Rect_Window_${index + 1}`, 'west', xMin, y, 1500, 3400, 1900, 2, glassT, frameT);
    addSideGlassBand(ops, `East_Side_Lower_Rect_Window_${index + 1}`, 'east', xMax, y, 1500, 3400, 1900, 2, glassT, frameT);
  }
}

function addFrontGlassBand(ops, name, x, z, w, h, modules, yMin, glassT, frameT) {
  box(ops, `${name}_Glass`, [x, yMin - glassT, z], [w, glassT, h], 'Factory_Glass_Blue', facadeQa('front_glass'));
  addFrontFrame(ops, name, x, z, w, h, modules, yMin, glassT, frameT);
}

function addRearGlassBand(ops, name, x, z, w, h, modules, yMax, glassT, frameT) {
  box(ops, `${name}_Glass`, [x, yMax, z], [w, glassT, h], 'Factory_Glass_Blue', facadeQa('rear_glass'));
  addRearFrame(ops, name, x, z, w, h, modules, yMax, glassT, frameT);
}

function addSideGlassBand(ops, name, side, xSurface, y, z, w, h, modules, glassT, frameT) {
  const west = side === 'west';
  const glassX = west ? xSurface - glassT : xSurface;
  const frameX = west ? xSurface - glassT - frameT : xSurface + glassT;
  box(ops, `${name}_Glass`, [glassX, y, z], [glassT, w, h], 'Factory_Glass_Blue', facadeQa(`${side}_glass`));
  box(ops, `${name}_Frame_Left`, [frameX, y, z], [frameT, 120, h], 'Factory_Frame_Dark', facadeQa(`${side}_window_frame`));
  box(ops, `${name}_Frame_Right`, [frameX, y + w - 120, z], [frameT, 120, h], 'Factory_Frame_Dark', facadeQa(`${side}_window_frame`));
  box(ops, `${name}_Frame_Top`, [frameX, y, z + h - 120], [frameT, w, 120], 'Factory_Frame_Dark', facadeQa(`${side}_window_frame`));
  box(ops, `${name}_Frame_Bottom`, [frameX, y, z], [frameT, w, 120], 'Factory_Frame_Dark', facadeQa(`${side}_window_frame`));
  const moduleW = w / modules;
  for (let i = 1; i < modules; i += 1) {
    const yy = y + moduleW * i - 45;
    box(ops, `${name}_Mullion_${i}`, [frameX, yy, z], [frameT, 90, h], 'Factory_Frame_Dark', facadeQa(`${side}_window_mullion`));
  }
  box(ops, `${name}_Mid_Rail`, [frameX, y, z + h / 2 - 45], [frameT, w, 90], 'Factory_Frame_Dark', facadeQa(`${side}_window_frame`));
}

function addFrontFrame(ops, name, x, z, w, h, modules, yMin, glassT, frameT) {
  const y = yMin - glassT - frameT;
  box(ops, `${name}_Frame_Left`, [x, y, z], [120, frameT, h], 'Factory_Frame_Dark', facadeQa('front_window_frame'));
  box(ops, `${name}_Frame_Right`, [x + w - 120, y, z], [120, frameT, h], 'Factory_Frame_Dark', facadeQa('front_window_frame'));
  box(ops, `${name}_Frame_Top`, [x, y, z + h - 120], [w, frameT, 120], 'Factory_Frame_Dark', facadeQa('front_window_frame'));
  box(ops, `${name}_Frame_Bottom`, [x, y, z], [w, frameT, 120], 'Factory_Frame_Dark', facadeQa('front_window_frame'));
  const moduleW = w / modules;
  for (let i = 1; i < modules; i += 1) {
    const xx = x + moduleW * i - 45;
    box(ops, `${name}_Mullion_${i}`, [xx, y, z], [90, frameT, h], 'Factory_Frame_Dark', facadeQa('front_window_mullion'));
  }
  if (h > 1800) {
    box(ops, `${name}_Mid_Rail`, [x, y, z + h / 2 - 45], [w, frameT, 90], 'Factory_Frame_Dark', facadeQa('front_window_frame'));
  }
}

function addRearFrame(ops, name, x, z, w, h, modules, yMax, glassT, frameT) {
  const y = yMax + glassT;
  box(ops, `${name}_Frame_Left`, [x, y, z], [120, frameT, h], 'Factory_Frame_Dark', facadeQa('rear_window_frame'));
  box(ops, `${name}_Frame_Right`, [x + w - 120, y, z], [120, frameT, h], 'Factory_Frame_Dark', facadeQa('rear_window_frame'));
  box(ops, `${name}_Frame_Top`, [x, y, z + h - 120], [w, frameT, 120], 'Factory_Frame_Dark', facadeQa('rear_window_frame'));
  box(ops, `${name}_Frame_Bottom`, [x, y, z], [w, frameT, 120], 'Factory_Frame_Dark', facadeQa('rear_window_frame'));
  const moduleW = w / modules;
  for (let i = 1; i < modules; i += 1) {
    const xx = x + moduleW * i - 45;
    box(ops, `${name}_Mullion_${i}`, [xx, y, z], [90, frameT, h], 'Factory_Frame_Dark', facadeQa('rear_window_mullion'));
  }
  box(ops, `${name}_Mid_Rail`, [x, y, z + h / 2 - 45], [w, frameT, 90], 'Factory_Frame_Dark', facadeQa('rear_window_frame'));
}

function addRollingDoor(ops, name, x, z, w, h, yMin) {
  box(ops, name, [x, yMin - 70, z], [w, 70, h], 'Factory_Rolling_Door_Grey', facadeQa('front_door'));
  for (let yy = z + 500; yy < z + h - 300; yy += 520) {
    box(ops, `${name}_Horizontal_Slat_${safeCoord(yy)}`, [x, yMin - 100, yy], [w, 30, 45], 'Factory_Door_Slat', facadeQa('front_door_slat'));
  }
}

function addPersonnelDoor(ops, name, x, z, w, h, yMin) {
  const y = yMin - 75;
  box(ops, name, [x, y, z], [w, 75, h], 'Factory_Personnel_Door_Blue_Grey', facadeQa('front_personnel_door'));
  box(ops, `${name}_Frame_Left`, [x, yMin - 105, z], [120, 30, h], 'Factory_Frame_Dark', facadeQa('front_personnel_door_frame'));
  box(ops, `${name}_Frame_Right`, [x + w - 120, yMin - 105, z], [120, 30, h], 'Factory_Frame_Dark', facadeQa('front_personnel_door_frame'));
  box(ops, `${name}_Frame_Top`, [x, yMin - 105, z + h - 120], [w, 30, 120], 'Factory_Frame_Dark', facadeQa('front_personnel_door_frame'));
  box(ops, `${name}_Narrow_Glass_Lite`, [x + 520, yMin - 112, z + 540], [w - 1040, 24, h - 1080], 'Factory_Glass_Blue', facadeQa('front_personnel_door_glass'));
  box(ops, `${name}_Handle`, [x + w - 440, yMin - 125, z + 1250], [120, 32, 140], 'Factory_Door_Handle_Dark', facadeQa('front_personnel_door_handle'));
}

function frontOpenings() {
  return [
    opening('front_left_upper_window', -68100, 6500, 16500, 2500),
    opening('front_right_upper_window', 51600, 6500, 16500, 2500),
    opening('front_left_lower_window', -68100, 1500, 12800, 2900),
    opening('front_right_lower_window', 55300, 1500, 12800, 2900),
    opening('front_center_left_rect_window', -30000, 6600, 7600, 2400),
    opening('front_center_right_rect_window', 22400, 6600, 7600, 2400),
    opening('front_tall_window_1', -14200, 1800, 1250, 7200),
    opening('front_tall_window_2', -10100, 1800, 1250, 7200),
    opening('front_tall_window_3', -5600, 1800, 1250, 7200),
    opening('front_tall_window_4', 5600, 1800, 1250, 7200),
    opening('front_tall_window_5', 10100, 1800, 1250, 7200),
    opening('front_tall_window_6', 14200, 1800, 1250, 7200),
    opening('front_left_loading_door', -35200, 0, 6800, 4200),
    opening('front_right_loading_door', 19400, 0, 6800, 4200),
    opening('front_left_personnel_door', -44900, 0, 2100, 2600),
    opening('front_right_personnel_door', 33300, 0, 2100, 2600)
  ];
}

function rearOpenings() {
  return [
    opening('rear_continuous_upper_ribbon', -42000, 6600, 84000, 2500),
    opening('rear_left_upper_end_window', -68100, 6500, 16000, 2500),
    opening('rear_right_upper_end_window', 52100, 6500, 16000, 2500),
    opening('rear_lower_window_1', -31000, 1500, 7000, 2300),
    opening('rear_lower_window_2', -16500, 1500, 7000, 2300),
    opening('rear_lower_window_3', 6500, 1500, 7000, 2300),
    opening('rear_lower_window_4', 21500, 1500, 7000, 2300)
  ];
}

function endWallOpenings() {
  return [
    { name: 'side_continuous_upper_ribbon_window', y: -10000, z: 6800, width: 20500, height: 1900 },
    { name: 'side_lower_window_1', y: -9800, z: 1500, width: 3400, height: 1900 },
    { name: 'side_lower_window_2', y: -3900, z: 1500, width: 3400, height: 1900 },
    { name: 'side_lower_window_3', y: 2500, z: 1500, width: 3400, height: 1900 },
    { name: 'side_lower_window_4', y: 9000, z: 1500, width: 3400, height: 1900 }
  ];
}

function opening(name, x, z, width, height) {
  return { name, x, z, width, height };
}

function openingToWallLocal(item) {
  const [xMin] = bounds();
  return {
    name: item.name,
    x: item.x - xMin,
    y: item.z,
    width: item.width,
    height: item.height
  };
}

function openingToSideWallLocal(item) {
  const [, , yMin] = bounds();
  return {
    name: item.name,
    x: item.y - yMin,
    y: item.z,
    width: item.width,
    height: item.height
  };
}

function addMaterialOps(ops) {
  ops.push(
    { op: 'material', name: 'Factory_Ground', color: '#5f6762', alpha: 0.35 },
    { op: 'material', name: 'Factory_Datum_Dark', color: '#2d3330' },
    { op: 'material', name: 'Factory_Light_Grey_Panel', color: '#cfdcdd' },
    { op: 'material', name: 'Factory_Subtle_Rib', color: '#b9c6c7' },
    { op: 'material', name: 'Factory_Orange_Steel', color: '#e96b22' },
    { op: 'material', name: 'Factory_Orange_Rib', color: '#c85519' },
    { op: 'material', name: 'Factory_Glass_Blue', color: '#8fb8cf', alpha: 0.58 },
    { op: 'material', name: 'Factory_Frame_Dark', color: '#52606b' },
    { op: 'material', name: 'Factory_Concrete_Light', color: '#dfe6e8' },
    { op: 'material', name: 'Factory_Roof_Light', color: '#d7ddde' },
    { op: 'material', name: 'Factory_Roof_Cap_White', color: '#f0f4f5' },
    { op: 'material', name: 'Factory_Roof_Seam', color: '#aeb9bb' },
    { op: 'material', name: 'Factory_Canopy_Light', color: '#d6e0e2' },
    { op: 'material', name: 'Factory_Shadow_Grey', color: '#8a969b' },
    { op: 'material', name: 'Factory_Rolling_Door_Grey', color: '#b6c2c5' },
    { op: 'material', name: 'Factory_Personnel_Door_Blue_Grey', color: '#94aeb8' },
    { op: 'material', name: 'Factory_Door_Slat', color: '#87959a' },
    { op: 'material', name: 'Factory_Door_Handle_Dark', color: '#425057' },
    { op: 'material', name: 'Factory_Bay_Joint', color: '#f6f8f8' },
    { op: 'material', name: 'Factory_PV_Dark_Blue', color: '#1e3d52', alpha: 0.92 },
    { op: 'material', name: 'Factory_PV_Joint', color: '#718592' }
  );
}

function buildModelQaSpec() {
  return {
    title: 'Dimensioned production workshop layout QA',
    views: [
      { name: 'top', title: 'Roof plan', axes: ['x', 'y'], depthAxis: 'z' },
      { name: 'front', title: 'Front elevation', axes: ['x', 'z'], depthAxis: 'y' },
      { name: 'rear', title: 'Rear elevation', axes: ['x', 'z'], depthAxis: 'y' },
      { name: 'east', title: 'End elevation', axes: ['y', 'z'], depthAxis: 'x' }
    ],
    allowed_collisions: [
      {
        item: '/(Site|Datum|Facade|Wall|Platform|Roof|Glass|Frame|Mullion|Orange|Door|Canopy|PV|Cladding|Joint|Plinth|Rib|Rail|Slat|Cap|Monitor|Seam|Band|Brace)/',
        with: '/(Site|Datum|Facade|Wall|Platform|Roof|Glass|Frame|Mullion|Orange|Door|Canopy|PV|Cladding|Joint|Plinth|Rib|Rail|Slat|Cap|Monitor|Seam|Band|Brace|Ground)/'
      }
    ],
    inside: [
      {
        item: '/(Roof_Photovoltaic|PV_Module)/',
        parent: 'Main_Roof_Slab_13m_Datum',
        axes: ['x', 'y'],
        margin_mm: 0,
        tolerance_mm: 1,
        severity: 'error'
      }
    ],
    support: [
      {
        item: 'Main_Roof_Slab_13m_Datum',
        parent: '/(Front_Facade_Wall|Rear_Facade_Wall|West_End_Wall|East_End_Wall)/',
        max_gap_mm: 2,
        allow_penetration_mm: 400,
        severity: 'warn'
      }
    ]
  };
}

function buildSummary(outputDsl, partGraph) {
  const bayEdges = bayEdgeCoordinates();
  return `# Building Single Rhino Factory Model

- Status: technical baseline, dimensioned drawing grounded
- Source images:
  - \`${sourceImages[0].path}\`
  - \`${sourceImages[1].path}\`
- Hard dimensions: ${dimensions.length} mm length x ${dimensions.depth} mm depth, main wall ${dimensions.main_height} mm, max datum ${dimensions.max_height} mm
- Plan segment chain: ${dimensions.plan_segments.join(' + ')} = ${dimensions.length} mm
- Segment edge coordinates from model origin: ${bayEdges.join(', ')} mm
- DSL operations: ${outputDsl.operations.length}
- Semantic parts: ${partGraph.parts.length}

## Modeled From Hard Evidence

- Rectangular workshop footprint from the plan sheet: 136.2 m x 40.2 m.
- Single-story 13 m main building height from the plan/elevation labels.
- Max 15.1 m roof monitor/parapet datum from the elevation marker.
- Orange and light-grey color steel facade material split from the elevation labels.
- Rooftop photovoltaic array from the plan text.
- Orange color steel panels use horizontal panel ribs; the diagonal orange panels slope outward downward at both ends, with thinner cladding projection and shortened end mid-bands to avoid overhang on the main facade.
- Front loading doors, personnel doors, and canopies are positioned and scaled separately: personnel doors are lower plain framed doors, while loading doors remain taller roll-up doors.
- Side-elevation windows are constrained to the central grey field: one shorter upper ribbon and four smaller lower rectangular windows.
- The lower reference elevation is modeled on the east/west short-side facades, not on the rear long facade.

## Proportional / Review-Gated Details

- Window bay counts, mullions, loading doors, personnel doors, canopies, side-elevation orange diagonal braces, wall ribs, roof seams, and the raised roof monitor are matched to the visual proportions of the sheets.
- These details are not survey-grade because the screenshots do not provide every opening width, sill height, mullion spacing, or canopy projection.
- The output is intentionally kept editable as separate DSL groups instead of merged booleans.
`;
}

function part(id, role, origin, size, evidenceStatus) {
  return {
    id,
    role,
    shape: {
      kind: 'box_extent',
      origin,
      size
    },
    evidence_status: evidenceStatus,
    source_images: sourceImages.map((image) => image.path),
    review_required: evidenceStatus !== 'hard_dimension'
  };
}

function box(ops, name, origin, size, material, qa = {}) {
  ops.push({
    op: 'box',
    id: idFor(name),
    name,
    origin,
    size,
    material,
    qa
  });
}

function facadeQa(role) {
  return {
    role,
    source_image: sourceImages[0].path,
    reconstruction_status: 'dimensioned_drawing_grounded',
    review_required: true
  };
}

function bayEdgeCoordinates() {
  const [xMin] = bounds();
  const edges = [xMin];
  let cursor = xMin;
  for (const segment of dimensions.plan_segments) {
    cursor += segment;
    edges.push(cursor);
  }
  return edges.map((value) => Math.round(value));
}

function bounds() {
  return [
    -dimensions.length / 2,
    dimensions.length / 2,
    -dimensions.depth / 2,
    dimensions.depth / 2
  ];
}

function range(start, end, step) {
  const values = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function safeCoord(value) {
  return String(Math.round(value)).replace('-', 'm');
}

function idFor(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--help' || arg === '-h') usage();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-building-single-rhino-factory.mjs \\
    --output-dir projects/image-structured-modeler/examples/building-single-rhino-factory
`);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
