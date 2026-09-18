import { expandProfileOperation } from './profile-geometry.mjs';
const DEFAULT_TEXTURE_ROOT = null;

const MATERIAL_PRESETS = {
  interior_kitchen: [
    { name: 'Interior_Wall_Warm_White', color: '#f4f1ea', pbr: { roughness_factor: 0.82, metallic_factor: 0 } },
    { name: 'Interior_Ceiling_Matte_White', color: '#faf9f5', pbr: { roughness_factor: 0.9, metallic_factor: 0 } },
    { name: 'Interior_Floor_Oak', color: '#b48b5c', pbr: { roughness_factor: 0.58, metallic_factor: 0 } },
    { name: 'Interior_Cabinet_Carcass_White', color: '#f8f8f3', pbr: { roughness_factor: 0.5, metallic_factor: 0 } },
    { name: 'Interior_Cabinet_Front_Matte_White', color: '#eeeeea', pbr: { roughness_factor: 0.68, metallic_factor: 0 } },
    { name: 'Interior_Cabinet_Front_Oak', color: '#c69a63', pbr: { roughness_factor: 0.55, metallic_factor: 0 } },
    { name: 'Interior_Countertop_Light_Stone', color: '#c9c5b8', pbr: { roughness_factor: 0.42, metallic_factor: 0 } },
    { name: 'Interior_Stainless_Steel', color: '#b8bec2', pbr: { roughness_factor: 0.28, metallic_factor: 0.85 } },
    { name: 'Interior_Appliance_Black_Glass', color: '#111418', alpha: 0.92, pbr: { roughness_factor: 0.18, metallic_factor: 0 } },
    { name: 'Interior_Tile_Gloss_White', color: '#f5f7f6', pbr: { roughness_factor: 0.22, metallic_factor: 0 } },
    { name: 'Interior_Tile_Grout_Warm_Grey', color: '#b6b1a8', pbr: { roughness_factor: 0.85, metallic_factor: 0 } },
    { name: 'Interior_Handle_Brushed_Metal', color: '#9aa0a3', pbr: { roughness_factor: 0.32, metallic_factor: 0.75 } },
    { name: 'Interior_Light_Warm_Glow', color: '#ffd98a', alpha: 0.55, pbr: { roughness_factor: 0.15, metallic_factor: 0 } },
    { name: 'Interior_Shadow_Dark_Recess', color: '#24201c', pbr: { roughness_factor: 0.75, metallic_factor: 0 } },
    { name: 'Interior_Outlet_White_Plastic', color: '#f1f1ec', pbr: { roughness_factor: 0.58, metallic_factor: 0 } }
  ]
};

MATERIAL_PRESETS.ikea_kitchen = MATERIAL_PRESETS.interior_kitchen;
MATERIAL_PRESETS.residential_kitchen = MATERIAL_PRESETS.interior_kitchen;
MATERIAL_PRESETS.showroom_kitchen = MATERIAL_PRESETS.interior_kitchen;

export function expandDslCode(code, options = {}) {
  const document = parseDslDocument(code);
  const result = expandDslDocument(document, options);
  return {
    ...result,
    expansion: result.report,
    code: `${JSON.stringify(result.document, null, 2)}\n`
  };
}

export function expandDslDocument(document, options = {}) {
  const operations = [];
  const context = {
    textureRoot: options.textureRoot ?? DEFAULT_TEXTURE_ROOT,
    emittedDefinitions: new Set(),
    macros: [],
    limitations: [],
    sourceOperationCount: document.operations.length,
    expandedOperationCount: 0
  };

  for (const operation of document.operations) {
    const expanded = expandOperation(operation, context);
    operations.push(...expanded);
  }

  const changed = operations.length !== document.operations.length || operations.some((operation, index) => operation !== document.operations[index]);
  context.expandedOperationCount = operations.length;
  const report = {
    kind: 'dsl_expansion',
    changed,
    source_operations: context.sourceOperationCount,
    expanded_operations: context.expandedOperationCount,
    macro_count: context.macros.length,
    macros: context.macros,
    limitations: context.limitations
  };

  return {
    document: {
      ...document,
      operations
    },
    report,
    changed
  };
}

export function parseDslDocument(code) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('DSL expansion requires a non-empty JSON DSL string');
  }
  let document;
  try {
    document = JSON.parse(code);
  } catch (error) {
    throw new Error(`DSL expansion accepts JSON DSL only: ${error.message}`);
  }
  if (document.version !== 1) throw new Error('DSL version must be 1');
  if (document.units && document.units !== 'mm') throw new Error('Only millimeter units are supported');
  if (!Array.isArray(document.operations)) throw new Error('DSL requires operations array');
  document.operations.forEach((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new Error(`operations[${index}] must be an object`);
    }
    if (typeof operation.op !== 'string') throw new Error(`operations[${index}].op must be a string`);
  });
  return document;
}

function expandOperation(operation, context) {
  if (operation.op === 'component_definition' && Array.isArray(operation.operations)) return [{...operation, operations: operation.operations.flatMap(child=>expandOperation(child, context))}];
  switch (operation.op) {
    case 'sweep_profile':
    case 'loft_profiles_v2':
      context.macros.push({op:operation.op,generated_operations:1});
      return [expandProfileOperation(operation)];
    case 'material_preset':
      return expandMaterialPreset(operation, context);
    case 'kitchen_component':
      return expandKitchenComponent(operation, context);
    case 'fixture_embed':
      return expandFixtureEmbed(operation, context);
    case 'presentation_camera':
      return expandPresentationCamera(operation, context);
    default:
      return [operation];
  }
}

function expandMaterialPreset(operation, context) {
  const presetName = keyword(operation.preset || operation.name || 'interior_kitchen');
  const preset = MATERIAL_PRESETS[presetName];
  if (!preset) throw new Error(`material_preset.preset is not supported: ${presetName}`);
  const prefix = operation.prefix || '';
  const textureRoot = operation.texture_root || operation.textureRoot || context.textureRoot;
  const operations = preset.map((material) => ({
    op: 'material',
    ...material,
    name: `${prefix}${material.name}`,
    ...(textureRoot ? textureSpecForMaterial(material, textureRoot) : {})
  }));
  context.macros.push({ op: operation.op, preset: presetName, generated_operations: operations.length });
  if (!textureRoot) {
    context.limitations.push({
      type: 'material.texture_paths_omitted',
      severity: 'info',
      source: operation.name || presetName,
      message: 'Material preset uses calibrated colors and PBR scalar hints; bitmap texture paths are omitted unless texture_root is provided.'
    });
  }
  return operations;
}

function expandKitchenComponent(operation, context) {
  const kind = keyword(operation.kind || operation.type);
  const expanders = {
    room_shell: expandRoomShell,
    base_cabinet_run: expandBaseCabinetRun,
    wall_cabinet_run: expandWallCabinetRun,
    tall_appliance_unit: expandTallApplianceUnit,
    countertop_run: expandCountertopRun,
    island: expandIsland,
    tile_backsplash: expandTileBacksplash,
    pendant_light: expandPendantLight,
    bar_stool: expandBarStool,
    open_shelf: expandOpenShelf
  };
  const expander = expanders[kind];
  if (!expander) throw new Error(`kitchen_component.kind is not supported: ${kind}`);
  const operations = expander(operation, context);
  context.macros.push({ op: operation.op, kind, name: operation.name || null, generated_operations: operations.length });
  return operations;
}

function expandRoomShell(operation) {
  const name = operation.name || 'Kitchen_Room';
  const origin = vector(operation.origin, [0, 0, 0], `${name}.origin`);
  const size = vector(operation.size, [4800, 3600, 2600], `${name}.size`);
  const wallThickness = positive(operation.wall_thickness ?? operation.wallThickness ?? 120, `${name}.wall_thickness`);
  const floorThickness = positive(operation.floor_thickness ?? operation.floorThickness ?? 90, `${name}.floor_thickness`);
  const [x, y, z] = origin;
  const [w, d, h] = size;
  const wallMaterial = operation.wall_material || operation.wallMaterial || 'Interior_Wall_Warm_White';
  const floorMaterial = operation.floor_material || operation.floorMaterial || 'Interior_Floor_Oak';
  const ceilingMaterial = operation.ceiling_material || operation.ceilingMaterial || 'Interior_Ceiling_Matte_White';
  const ops = [
    box(`${name}_Floor`, [x, y, z], [w, d, floorThickness], floorMaterial, `${idBase(name)}-floor`, { role: 'floor' }),
    box(`${name}_Back_Wall`, [x, y + d, z], [w, wallThickness, h], wallMaterial, `${idBase(name)}-back-wall`, { role: 'wall' }),
    box(`${name}_Left_Wall`, [x - wallThickness, y, z], [wallThickness, d + wallThickness, h], wallMaterial, `${idBase(name)}-left-wall`, { role: 'wall' }),
    box(`${name}_Right_Wall`, [x + w, y, z], [wallThickness, d + wallThickness, h], wallMaterial, `${idBase(name)}-right-wall`, { role: 'wall' })
  ];
  if (operation.ceiling !== false) {
    ops.push(box(`${name}_Ceiling_Plane`, [x, y, z + h], [w, d, 35], ceilingMaterial, `${idBase(name)}-ceiling`, { role: 'ceiling' }));
  }
  return ops;
}

function expandBaseCabinetRun(operation, context) {
  const name = operation.name || 'Kitchen_Base_Run';
  const origin = vector(operation.origin, [0, 0, 0], `${name}.origin`);
  const width = positive(operation.width ?? 2400, `${name}.width`);
  const depth = positive(operation.depth ?? 620, `${name}.depth`);
  const height = positive(operation.height ?? 720, `${name}.height`);
  const count = positiveInteger(operation.count ?? Math.max(1, Math.round(width / positive(operation.module_width ?? operation.moduleWidth ?? 600, `${name}.module_width`))), `${name}.count`);
  const frontThickness = positive(operation.front_thickness ?? operation.frontThickness ?? 20, `${name}.front_thickness`);
  const toeHeight = positive(operation.toe_height ?? operation.toeHeight ?? 95, `${name}.toe_height`);
  const moduleWidth = width / count;
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  for (let index = 0; index < count; index += 1) {
    const x = origin[0] + moduleWidth * index;
    const label = `${name}_${String(index + 1).padStart(2, '0')}`;
    ops.push(box(`${label}_Carcass`, [x, origin[1], origin[2] + toeHeight], [moduleWidth, depth, height - toeHeight], operation.carcass_material || 'Interior_Cabinet_Carcass_White', `${idBase(label)}-carcass`, qaRole('cabinet_carcass')));
    ops.push(box(`${label}_Toe_Kick`, [x + 35, origin[1] + 70, origin[2]], [moduleWidth - 70, depth - 110, toeHeight], operation.toe_material || 'Interior_Shadow_Dark_Recess', `${idBase(label)}-toe`, qaRole('toe_kick')));
    const fronts = positiveInteger(operation.drawer_count ?? operation.drawerCount ?? 2, `${name}.drawer_count`);
    for (let drawer = 0; drawer < fronts; drawer += 1) {
      const frontHeight = (height - toeHeight - 18) / fronts;
      const frontOrigin = [x + 5, origin[1] - frontThickness, origin[2] + toeHeight + drawer * frontHeight + 5];
      const frontName = `${label}_Drawer_Front_${drawer + 1}`;
      ops.push(box(frontName, frontOrigin, [moduleWidth - 10, frontThickness, frontHeight - 10], operation.front_material || 'Interior_Cabinet_Front_Matte_White', `${idBase(frontName)}`, qaRole('drawer_front')));
      ops.push(instance(`${frontName}_Handle`, operation.handle_definition || 'Interior_Bar_Handle_Def', [x + moduleWidth / 2 - 110, origin[1] - frontThickness - 18, frontOrigin[2] + frontHeight / 2 - 9], qaRole('handle')));
    }
  }
  return ops;
}

function expandWallCabinetRun(operation, context) {
  const name = operation.name || 'Kitchen_Wall_Cabinet_Run';
  const origin = vector(operation.origin, [0, 0, 1400], `${name}.origin`);
  const width = positive(operation.width ?? 2400, `${name}.width`);
  const depth = positive(operation.depth ?? 380, `${name}.depth`);
  const height = positive(operation.height ?? 720, `${name}.height`);
  const count = positiveInteger(operation.count ?? Math.max(1, Math.round(width / 600)), `${name}.count`);
  const moduleWidth = width / count;
  const frontThickness = positive(operation.front_thickness ?? operation.frontThickness ?? 18, `${name}.front_thickness`);
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  for (let index = 0; index < count; index += 1) {
    const x = origin[0] + moduleWidth * index;
    const label = `${name}_${String(index + 1).padStart(2, '0')}`;
    ops.push(box(`${label}_Carcass`, [x, origin[1], origin[2]], [moduleWidth, depth, height], operation.carcass_material || 'Interior_Cabinet_Carcass_White', `${idBase(label)}-wall-carcass`, qaRole('wall_cabinet')));
    ops.push(box(`${label}_Door`, [x + 5, origin[1] - frontThickness, origin[2] + 8], [moduleWidth - 10, frontThickness, height - 16], operation.front_material || 'Interior_Cabinet_Front_Matte_White', `${idBase(label)}-wall-door`, qaRole('cabinet_door')));
    ops.push(instance(`${label}_Door_Handle`, operation.handle_definition || 'Interior_Bar_Handle_Def', [x + moduleWidth - 160, origin[1] - frontThickness - 18, origin[2] + height / 2], qaRole('handle')));
  }
  return ops;
}

function expandTallApplianceUnit(operation, context) {
  const name = operation.name || 'Kitchen_Tall_Appliance_Unit';
  const origin = vector(operation.origin, [0, 0, 0], `${name}.origin`);
  const width = positive(operation.width ?? 650, `${name}.width`);
  const depth = positive(operation.depth ?? 650, `${name}.depth`);
  const height = positive(operation.height ?? 2200, `${name}.height`);
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  ops.push(box(`${name}_Cabinet_Tower`, origin, [width, depth, height], operation.carcass_material || 'Interior_Cabinet_Carcass_White', `${idBase(name)}-tower`, qaRole('tall_cabinet')));
  ops.push(box(`${name}_Oven_Glass`, [origin[0] + 55, origin[1] - 28, origin[2] + 620], [width - 110, 28, 520], operation.appliance_material || 'Interior_Appliance_Black_Glass', `${idBase(name)}-oven`, qaRole('appliance')));
  ops.push(box(`${name}_Upper_Door`, [origin[0] + 8, origin[1] - 20, origin[2] + 1180], [width - 16, 20, height - 1200], operation.front_material || 'Interior_Cabinet_Front_Oak', `${idBase(name)}-upper-door`, qaRole('cabinet_door')));
  ops.push(instance(`${name}_Upper_Handle`, operation.handle_definition || 'Interior_Bar_Handle_Def', [origin[0] + width - 170, origin[1] - 38, origin[2] + 1650], qaRole('handle')));
  return ops;
}

function expandCountertopRun(operation) {
  const name = operation.name || 'Kitchen_Countertop';
  const origin = vector(operation.origin, [0, 0, 900], `${name}.origin`);
  const size = vector(operation.size, [2400, 640, 40], `${name}.size`);
  return [
    box(name, origin, size, operation.material || 'Interior_Countertop_Light_Stone', operation.id || idBase(name), qaRole('countertop'))
  ];
}

function expandIsland(operation, context) {
  const name = operation.name || 'Kitchen_Island';
  const origin = vector(operation.origin, [0, 0, 0], `${name}.origin`);
  const size = vector(operation.size, [1800, 900, 920], `${name}.size`);
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  ops.push(box(`${name}_Base`, origin, [size[0], size[1], size[2] - 45], operation.carcass_material || 'Interior_Cabinet_Carcass_White', `${idBase(name)}-base`, qaRole('island_base')));
  ops.push(box(`${name}_Countertop`, [origin[0] - 40, origin[1] - 40, origin[2] + size[2] - 45], [size[0] + 80, size[1] + 80, 45], operation.countertop_material || 'Interior_Countertop_Light_Stone', `${idBase(name)}-countertop`, qaRole('countertop')));
  const stools = positiveInteger(operation.stools ?? 0, `${name}.stools`);
  for (let index = 0; index < stools; index += 1) {
    const stoolX = origin[0] + 280 + index * 520;
    ops.push(...expandBarStool({ name: `${name}_Stool_${index + 1}`, origin: [stoolX, origin[1] - 620, origin[2]], seat_material: operation.seat_material }, context));
  }
  return ops;
}

function expandTileBacksplash(operation, context) {
  const name = operation.name || 'Kitchen_Tile_Backsplash';
  const origin = vector(operation.origin, [0, 0, 950], `${name}.origin`);
  const width = positive(operation.width ?? 2400, `${name}.width`);
  const height = positive(operation.height ?? 520, `${name}.height`);
  const tile = vector(operation.tile_size ?? operation.tileSize, [220, 80], `${name}.tile_size`);
  const grout = positive(operation.grout ?? 5, `${name}.grout`);
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  ops.push(box(`${name}_Grout_Background`, [origin[0], origin[1] + 1, origin[2]], [width, 10, height], operation.grout_material || 'Interior_Tile_Grout_Warm_Grey', `${idBase(name)}-grout`, qaRole('backsplash_grout')));
  const cols = Math.max(1, Math.floor(width / (tile[0] + grout)));
  const rows = Math.max(1, Math.floor(height / (tile[1] + grout)));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const offset = row % 2 ? tile[0] / 2 : 0;
      const x = origin[0] + col * (tile[0] + grout) + offset;
      if (x + tile[0] > origin[0] + width) continue;
      ops.push(instance(`${name}_Tile_${row + 1}_${col + 1}`, operation.tile_definition || 'Interior_Subway_Tile_Def', [x, origin[1] - 11, origin[2] + row * (tile[1] + grout)], qaRole('backsplash_tile')));
    }
  }
  return ops;
}

function expandPendantLight(operation, context) {
  const name = operation.name || 'Kitchen_Pendant';
  const origin = vector(operation.origin, [0, 0, 2100], `${name}.origin`);
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  ops.push({ op: 'cylinder', name: `${name}_Cord`, origin: [origin[0], origin[1], origin[2] + 80], radius: 7, height: 370, material: operation.cord_material || 'Interior_Shadow_Dark_Recess', id: `${idBase(name)}-cord`, qa: qaRole('pendant_cord') });
  ops.push({ op: 'cylinder', name: `${name}_Shade`, origin: [origin[0], origin[1], origin[2] - 95], radius: positive(operation.radius ?? 170, `${name}.radius`), height: positive(operation.height ?? 190, `${name}.height`), material: operation.shade_material || 'Interior_Stainless_Steel', id: `${idBase(name)}-shade`, qa: qaRole('pendant_shade') });
  ops.push({ op: 'cylinder', name: `${name}_Glow_Disk`, origin: [origin[0], origin[1], origin[2] - 107], radius: positive(operation.radius ?? 170, `${name}.radius`) * 0.72, height: 12, material: operation.glow_material || 'Interior_Light_Warm_Glow', id: `${idBase(name)}-glow`, qa: qaRole('light') });
  return ops;
}

function expandBarStool(operation, context) {
  const name = operation.name || 'Kitchen_Bar_Stool';
  const origin = vector(operation.origin, [0, 0, 0], `${name}.origin`);
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  ops.push({ op: 'cylinder', name: `${name}_Seat`, origin: [origin[0] + 190, origin[1] + 190, origin[2] + 680], radius: 190, height: 55, material: operation.seat_material || 'Interior_Cabinet_Front_Oak', id: `${idBase(name)}-seat`, qa: qaRole('stool_seat') });
  for (const [index, offset] of [[0, 0], [280, 0], [0, 280], [280, 280]].entries()) {
    ops.push({ op: 'cylinder', name: `${name}_Leg_${index + 1}`, origin: [origin[0] + 50 + offset[0], origin[1] + 50 + offset[1], origin[2]], radius: 18, height: 670, material: operation.leg_material || 'Interior_Stainless_Steel', id: `${idBase(name)}-leg-${index + 1}`, qa: qaRole('stool_leg') });
  }
  return ops;
}

function expandOpenShelf(operation, context) {
  const name = operation.name || 'Kitchen_Open_Shelf';
  const origin = vector(operation.origin, [0, 0, 1500], `${name}.origin`);
  const width = positive(operation.width ?? 900, `${name}.width`);
  const depth = positive(operation.depth ?? 260, `${name}.depth`);
  const thickness = positive(operation.thickness ?? 36, `${name}.thickness`);
  const ops = [];
  ensureKitchenDefinitions(ops, context, operation);
  ops.push(box(`${name}_Shelf`, origin, [width, depth, thickness], operation.material || 'Interior_Cabinet_Front_Oak', `${idBase(name)}-shelf`, qaRole('open_shelf')));
  ops.push(instance(`${name}_Left_Bracket`, operation.bracket_definition || 'Interior_Shelf_Bracket_Def', [origin[0] + 90, origin[1] + depth - 40, origin[2] - 210], qaRole('shelf_bracket')));
  ops.push(instance(`${name}_Right_Bracket`, operation.bracket_definition || 'Interior_Shelf_Bracket_Def', [origin[0] + width - 170, origin[1] + depth - 40, origin[2] - 210], qaRole('shelf_bracket')));
  return ops;
}

function expandFixtureEmbed(operation, context) {
  const name = operation.name || 'Embedded_Fixture';
  const targetId = operation.target_id || operation.targetId || operation.target || operation.object_id || operation.objectId;
  if (!targetId) throw new Error(`${name}.target_id is required`);
  const face = operation.face || 'top';
  const center = vector(operation.center, [0, 0], `${name}.center`);
  const size = vector(operation.size, [400, 300], `${name}.size`);
  const depth = positive(operation.depth ?? 20, `${name}.depth`);
  const kind = keyword(operation.kind || 'rectangular_insert');
  const ops = [{
    op: kind === 'round_hole' ? 'cut_hole' : 'cut_recess',
    target_id: targetId,
    feature_id: operation.feature_id || operation.featureId || `${idBase(name)}-recess`,
    face,
    center,
    ...(kind === 'round_hole' ? { radius: positive(operation.radius ?? size[0] / 2, `${name}.radius`), through: operation.through ?? false, depth } : { size, depth, radius: operation.radius ?? 8 }),
    segments: operation.segments ?? 12
  }];

  const insert = operation.insert || defaultFixtureInsert(operation, kind);
  if (insert) {
    ops.push({
      op: insert.op || 'box',
      name: insert.name || `${name}_Insert`,
      id: insert.id || `${idBase(name)}-insert`,
      origin: insert.origin,
      size: insert.size,
      material: insert.material || materialForFixture(kind),
      qa: {
        role: kind,
        expected_contacts: [{ with: operation.target_name || targetId, bucket: 'fixture_embed', note: 'Intentional inset fixture/host overlap.' }]
      },
      ...(insert.radius !== undefined ? { radius: insert.radius } : {}),
      ...(insert.segments !== undefined ? { segments: insert.segments } : {})
    });
  } else {
    context.limitations.push({
      type: 'fixture.visual_insert_omitted',
      severity: 'info',
      source: name,
      message: 'fixture_embed recorded the host recess but no insert visual was generated because insert placement was not supplied.'
    });
  }
  context.macros.push({ op: operation.op, kind, name, generated_operations: ops.length });
  context.limitations.push({
    type: 'fixture.boolean_detail_level',
    severity: 'info',
    source: name,
    message: 'fixture_embed uses controlled face-feature metadata plus explicit insert geometry; it does not claim arbitrary solid boolean fidelity.'
  });
  return ops;
}

function expandPresentationCamera(operation) {
  const name = operation.name || operation.scene || 'Presentation_View';
  const room = operation.room || {};
  const origin = vector(room.origin || operation.origin, [0, 0, 0], `${name}.room.origin`);
  const size = vector(room.size || operation.size, [4800, 3600, 2600], `${name}.room.size`);
  const view = keyword(operation.view || 'open_front');
  const camera = cameraForPreset(view, origin, size, operation);
  return [{
    op: 'scene',
    name,
    camera,
    transition_time: operation.transition_time ?? operation.transitionTime ?? 1.2,
    ...(operation.rendering_options || operation.renderingOptions ? { rendering_options: operation.rendering_options || operation.renderingOptions } : {}),
    ...(operation.shadow ? { shadow: operation.shadow } : {}),
    ...(operation.style ? { style: operation.style } : {})
  }];
}

function ensureKitchenDefinitions(ops, context, operation = {}) {
  const handle = operation.handle_definition || 'Interior_Bar_Handle_Def';
  emitDefinition(ops, context, handle, [
    { op: 'box', name: `${handle}_Body`, origin: [0, 0, 0], size: [220, 18, 18], material: 'Interior_Handle_Brushed_Metal' },
    { op: 'box', name: `${handle}_Left_Post`, origin: [24, 0, -22], size: [16, 16, 22], material: 'Interior_Handle_Brushed_Metal' },
    { op: 'box', name: `${handle}_Right_Post`, origin: [180, 0, -22], size: [16, 16, 22], material: 'Interior_Handle_Brushed_Metal' }
  ]);
  emitDefinition(ops, context, operation.tile_definition || 'Interior_Subway_Tile_Def', [
    { op: 'rounded_box', name: 'Tile_Face', origin: [0, 0, 0], size: [220, 10, 80], radius: 4, material: 'Interior_Tile_Gloss_White' }
  ]);
  emitDefinition(ops, context, operation.bracket_definition || 'Interior_Shelf_Bracket_Def', [
    { op: 'box', name: 'Bracket_Vertical', origin: [0, 0, 0], size: [32, 32, 210], material: 'Interior_Stainless_Steel' },
    { op: 'box', name: 'Bracket_Horizontal', origin: [0, -135, 178], size: [32, 170, 32], material: 'Interior_Stainless_Steel' }
  ]);
}

function emitDefinition(ops, context, name, operations) {
  if (context.emittedDefinitions.has(name)) return;
  context.emittedDefinitions.add(name);
  ops.push({ op: 'component_definition', name, operations });
}

function defaultFixtureInsert(operation, kind) {
  if (operation.insert === false) return null;
  if (!operation.surface_z && !operation.surfaceZ && !operation.insert_origin && !operation.insertOrigin) return null;
  const size = vector(operation.size, [400, 300], `${operation.name || 'fixture'}.size`);
  const center = vector(operation.center, [0, 0], `${operation.name || 'fixture'}.center`);
  const surfaceZ = operation.surface_z ?? operation.surfaceZ;
  const origin = operation.insert_origin || operation.insertOrigin || [center[0] - size[0] / 2, center[1] - size[1] / 2, surfaceZ - Math.min(operation.depth ?? 20, 35)];
  const height = positive(operation.insert_height ?? operation.insertHeight ?? (kind === 'sink' ? 95 : 8), `${operation.name || 'fixture'}.insert_height`);
  return {
    op: kind === 'sink' ? 'rounded_box' : 'box',
    origin,
    size: [size[0], size[1], height],
    radius: kind === 'sink' ? 18 : undefined,
    material: materialForFixture(kind)
  };
}

function materialForFixture(kind) {
  if (kind === 'sink' || kind === 'faucet') return 'Interior_Stainless_Steel';
  if (kind === 'cooktop' || kind === 'appliance_glass') return 'Interior_Appliance_Black_Glass';
  if (kind === 'outlet') return 'Interior_Outlet_White_Plastic';
  return 'Interior_Shadow_Dark_Recess';
}

function cameraForPreset(view, origin, size, operation) {
  const [x, y, z] = origin;
  const [w, d, h] = size;
  const span = Math.max(w, d, h);
  const target = operation.target || [x + w / 2, y + d * 0.48, z + h * 0.42];
  if (view === 'top_plan') {
    return { eye: [x + w / 2, y + d / 2, z + span * 1.55], target: [x + w / 2, y + d / 2, z], up: [0, 1, 0], fov: operation.fov ?? 30 };
  }
  if (view === 'eye_level') {
    return { eye: [x + w * 0.18, y - d * 0.38, z + 1580], target, up: [0, 0, 1], fov: operation.fov ?? 36 };
  }
  if (view === 'iso') {
    return { eye: [x + w + span * 0.55, y - span * 0.85, z + span * 0.72], target, up: [0, 0, 1], fov: operation.fov ?? 34 };
  }
  if (view === 'worktop') {
    return { eye: [x + w * 0.58, y - d * 0.18, z + 1420], target: [x + w * 0.54, y + d * 0.52, z + 930], up: [0, 0, 1], fov: operation.fov ?? 32 };
  }
  if (view !== 'open_front') throw new Error(`presentation_camera.view is not supported: ${view}`);
  return { eye: [x + w / 2, y - span * 0.95, z + h * 0.56], target, up: [0, 0, 1], fov: operation.fov ?? 35 };
}

function textureSpecForMaterial(material, textureRoot) {
  const file = `${textureRoot.replace(/\/$/u, '')}/${material.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  return { texture: { path: file, width: 1000, height: 1000 } };
}

function box(name, origin, size, material, id, qa) {
  return { op: 'box', name, id, origin, size, material, ...(qa ? { qa } : {}) };
}

function instance(name, definition, origin, qa) {
  return { op: 'component_instance', name, id: idBase(name), definition, origin, ...(qa ? { qa } : {}) };
}

function qaRole(role) {
  return { role };
}

function vector(value, fallback, fieldName) {
  const source = value ?? fallback;
  if (!Array.isArray(source) || source.length !== fallback.length) throw new Error(`${fieldName} must be a ${fallback.length}-number array`);
  return source.map((item, index) => {
    const valueNumber = Number(item);
    if (!Number.isFinite(valueNumber)) throw new Error(`${fieldName}[${index}] must be a finite number`);
    return valueNumber;
  });
}

function positive(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${fieldName} must be a positive number`);
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${fieldName} must be a positive integer`);
  return number;
}

function keyword(value) {
  return String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

function idBase(value) {
  return String(value || 'object').trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'object';
}
