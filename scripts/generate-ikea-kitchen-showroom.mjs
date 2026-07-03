#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve(process.argv[2] || 'examples/ikea-kitchen-showroom.json');
const artifactDir = path.resolve('output/ikea-kitchen-showroom');
const modelSpecPath = path.resolve('examples/model-qa/ikea-kitchen-showroom.json');
const ops = [];
let sequence = 0;

function op(operation) {
  ops.push(operation);
}

function material(name, color, extra = {}) {
  op({ op: 'material', name, color, ...extra });
}

function box(name, origin, size, materialName, extra = {}) {
  sequence += 1;
  op({
    op: 'box',
    id: extra.id || safeId(name),
    name,
    origin: roundArray(origin),
    size: roundArray(size),
    ...(materialName ? { material: materialName } : {}),
    ...without(extra, ['id'])
  });
}

function cylinder(name, origin, radius, height, materialName, extra = {}) {
  op({
    op: 'cylinder',
    id: extra.id || safeId(name),
    name,
    origin: roundArray(origin),
    radius,
    height,
    segments: extra.segments || 24,
    smooth: extra.smooth || 'all',
    ...(materialName ? { material: materialName } : {}),
    ...without(extra, ['id', 'segments', 'smooth'])
  });
}

function pipe(name, points, radius, materialName, extra = {}) {
  op({
    op: 'pipe_between_points',
    id: extra.id || safeId(name),
    name,
    points: points.map(roundArray),
    radius,
    segments: extra.segments || 12,
    smooth: extra.smooth || 'all',
    ...(materialName ? { material: materialName } : {}),
    ...without(extra, ['id', 'segments', 'smooth'])
  });
}

function text3d(name, center, text, height, materialName, extra = {}) {
  op({
    op: 'text_3d',
    id: extra.id || safeId(name),
    name,
    center: roundArray(center),
    text,
    height,
    extrusion: extra.extrusion ?? 2,
    font: extra.font || 'Arial',
    align: extra.align || 'center',
    filled: true,
    ...(extra.bold !== undefined ? { bold: extra.bold } : {}),
    ...(materialName ? { material: materialName } : {}),
    ...without(extra, ['id', 'extrusion', 'font', 'align', 'bold'])
  });
}

function baseCabinet({ id, name, x, y, width, depth = 600, drawers = 2, frontMaterial = 'Cabinet_Front_Matte_White', bodyMaterial = 'Cabinet_Carcass_White', handleMaterial = 'Handle_Blackened_Steel' }) {
  const z0 = 80;
  const toe = 100;
  const bodyHeight = 720;
  box(`${name}_Toe_Kick`, [x + 45, y + 70, z0], [width - 90, depth - 120, toe], 'Toe_Kick_Shadow', { id: `${id}-toe` });
  box(`${name}_Carcass`, [x, y, z0 + toe], [width, depth, bodyHeight], bodyMaterial, { id: `${id}-body` });
  const gap = 4;
  const frontY = y + depth + 4;
  if (drawers <= 1) {
    box(`${name}_Tall_Door_Front`, [x + gap, frontY, z0 + toe + gap], [width - gap * 2, 18, bodyHeight - gap * 2], frontMaterial, { id: `${id}-front` });
    box(`${name}_Door_Handle`, [x + width - 44, frontY + 20, z0 + toe + 180], [18, 20, 360], handleMaterial, { id: `${id}-handle` });
  } else {
    const drawerHeight = (bodyHeight - gap * (drawers + 1)) / drawers;
    for (let index = 0; index < drawers; index += 1) {
      const dz = z0 + toe + gap + index * (drawerHeight + gap);
      box(`${name}_Drawer_${index + 1}_Front`, [x + gap, frontY, dz], [width - gap * 2, 18, drawerHeight], frontMaterial, { id: `${id}-drawer-${index + 1}` });
      box(`${name}_Drawer_${index + 1}_Pull`, [x + 90, frontY + 20, dz + drawerHeight - 70], [width - 180, 18, 18], handleMaterial, { id: `${id}-pull-${index + 1}` });
    }
  }
}

function wallCabinet({ id, name, x, y = 150, width, depth = 360, z = 1520, height = 720, frontMaterial = 'Cabinet_Front_Matte_White' }) {
  box(`${name}_Carcass`, [x, y, z], [width, depth, height], 'Cabinet_Carcass_White', { id: `${id}-body` });
  box(`${name}_Door_Left`, [x + 4, y + depth + 4, z + 4], [width / 2 - 7, 18, height - 8], frontMaterial, { id: `${id}-door-left` });
  box(`${name}_Door_Right`, [x + width / 2 + 3, y + depth + 4, z + 4], [width / 2 - 7, 18, height - 8], frontMaterial, { id: `${id}-door-right` });
  box(`${name}_Handle_Left`, [x + width / 2 - 42, y + depth + 24, z + height / 2 - 160], [16, 18, 320], 'Handle_Blackened_Steel', { id: `${id}-handle-left` });
  box(`${name}_Handle_Right`, [x + width / 2 + 26, y + depth + 24, z + height / 2 - 160], [16, 18, 320], 'Handle_Blackened_Steel', { id: `${id}-handle-right` });
}

function tallCabinet({ id, name, x, y = 140, width = 600, depth = 650, height = 2200, frontMaterial = 'Cabinet_Front_Matte_White' }) {
  box(`${name}_Carcass`, [x, y, 80], [width, depth, height], 'Cabinet_Carcass_White', { id: `${id}-body` });
  box(`${name}_Lower_Front`, [x + 4, y + depth + 4, 100], [width - 8, 18, 1000], frontMaterial, { id: `${id}-lower-front` });
  box(`${name}_Upper_Front`, [x + 4, y + depth + 4, 1110], [width - 8, 18, height - 1040], frontMaterial, { id: `${id}-upper-front` });
  box(`${name}_Long_Handle`, [x + width - 48, y + depth + 24, 560], [18, 18, 720], 'Handle_Blackened_Steel', { id: `${id}-long-handle` });
}

function ovenTowerCabinet({ id, name, x, y = 140, width = 600, depth = 650, height = 2200 }) {
  const frontY = y + depth + 4;
  box(`${name}_Carcass`, [x, y, 80], [width, depth, height], 'Cabinet_Carcass_White', { id: `${id}-body` });
  box(`${name}_Bottom_Drawer_Front`, [x + 4, frontY, 100], [width - 8, 18, 540], 'Cabinet_Front_Matte_White', { id: `${id}-bottom-drawer-front` });
  box(`${name}_Mid_Filler_Panel`, [x + 4, frontY, 1144], [width - 8, 18, 54], 'Cabinet_Front_Matte_White', { id: `${id}-mid-filler-front` });
  box(`${name}_Upper_Door_Front`, [x + 4, frontY, 1570], [width - 8, 18, 700], 'Cabinet_Front_Matte_White', { id: `${id}-upper-door-front` });
  box(`${name}_Bottom_Drawer_Handle`, [x + 90, frontY + 20, 470], [width - 180, 18, 18], 'Handle_Blackened_Steel', { id: `${id}-bottom-handle` });
  box(`${name}_Upper_Door_Handle`, [x + width - 48, frontY + 20, 1780], [18, 18, 380], 'Handle_Blackened_Steel', { id: `${id}-upper-handle` });
}

function islandDrawerBank({ id, name, x, y, width, side = 'front' }) {
  const frontY = side === 'front' ? y + 900 + 4 : y - 22;
  const h = 720;
  const z = 180;
  const drawerH = 226;
  for (let index = 0; index < 3; index += 1) {
    const dz = z + 6 + index * (drawerH + 6);
    box(`${name}_${side}_Drawer_${index + 1}`, [x + 6, frontY, dz], [width - 12, 18, drawerH], 'Cabinet_Front_Oak_Veneer', { id: `${id}-${side}-drawer-${index + 1}` });
    box(`${name}_${side}_Pull_${index + 1}`, [x + 80, frontY + (side === 'front' ? 20 : -20), dz + drawerH - 68], [width - 160, 16, 18], 'Handle_Blackened_Steel', { id: `${id}-${side}-pull-${index + 1}` });
  }
}

function addTileBacksplash() {
  const startX = 1540;
  const startZ = 980;
  const tileW = 244;
  const tileH = 106;
  const gap = 4;
  let count = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 14; column += 1) {
      count += 1;
      const x = startX + column * (tileW + gap) + (row % 2 ? tileW / 2 : 0);
      if (x + tileW > 5040) continue;
      box(`White_Subway_Tile_${count}`, [x, 122, startZ + row * (tileH + gap)], [tileW, 10, tileH], 'Backsplash_Gloss_White_Tile', { id: `backsplash-tile-${count}` });
    }
  }
}

function addPendant(name, x, y) {
  cylinder(`${name}_Ceiling_Canopy`, [x, y, 2488], 36, 24, 'Pendant_Black_Metal', { id: `${safeId(name)}-canopy`, segments: 20 });
  cylinder(`${name}_Cable`, [x, y, 1845], 5, 640, 'Pendant_Black_Metal', { id: `${safeId(name)}-cable`, segments: 8 });
  cylinder(`${name}_Shade`, [x, y, 1700], 155, 145, 'Pendant_Black_Metal', { id: `${safeId(name)}-shade`, segments: 32 });
  cylinder(`${name}_Warm_Bulb`, [x, y, 1658], 42, 50, 'Warm_Light', { id: `${safeId(name)}-bulb`, segments: 20 });
}

function addStool(name, x, y) {
  cylinder(`${name}_Seat`, [x, y, 642], 185, 52, 'Stool_Oak', { id: `${safeId(name)}-seat`, segments: 32 });
  cylinder(`${name}_Pedestal`, [x, y, 98], 28, 544, 'Stool_Black_Steel', { id: `${safeId(name)}-pedestal`, segments: 18 });
  cylinder(`${name}_Foot`, [x, y, 80], 175, 18, 'Stool_Black_Steel', { id: `${safeId(name)}-foot`, segments: 32 });
  pipe(`${name}_Foot_Rest`, [[x - 140, y, 310], [x + 140, y, 310]], 12, 'Stool_Black_Steel', { id: `${safeId(name)}-foot-rest`, segments: 10 });
}

function addPlateStack(name, x, y, z) {
  for (let index = 0; index < 4; index += 1) {
    cylinder(`${name}_Plate_${index + 1}`, [x, y, z + index * 12], 120, 8, 'Ceramic_Off_White', { id: `${safeId(name)}-plate-${index + 1}`, segments: 32 });
  }
  cylinder(`${name}_Bowl`, [x, y, z + 58], 95, 52, 'Ceramic_Off_White', { id: `${safeId(name)}-bowl`, segments: 32 });
}

function addPlant(name, x, y, z) {
  cylinder(`${name}_Pot`, [x, y, z], 72, 92, 'Planter_Terracotta', { id: `${safeId(name)}-pot`, segments: 24 });
  cylinder(`${name}_Soil`, [x, y, z + 92], 62, 8, 'Planter_Soil', { id: `${safeId(name)}-soil`, segments: 24 });
  for (let index = 0; index < 7; index += 1) {
    const angle = (Math.PI * 2 * index) / 7;
    const x1 = x + Math.cos(angle) * 18;
    const y1 = y + Math.sin(angle) * 12;
    const x2 = x + Math.cos(angle) * 105;
    const y2 = y + Math.sin(angle) * 70;
    pipe(`${name}_Leaf_Stem_${index + 1}`, [[x1, y1, z + 104], [x2, y2, z + 230 + (index % 3) * 28]], 8, 'Plant_Green', { id: `${safeId(name)}-leaf-${index + 1}`, segments: 8 });
  }
}

op({ op: 'reset' });
material('Wall_Warm_White', '#eee9df');
material('Ceiling_Matte_White', '#f5f3ee');
material('Floor_Light_Oak_Plank', '#b99062');
material('Cabinet_Carcass_White', '#f4f2ec');
material('Cabinet_Front_Matte_White', '#e8e5dc');
material('Cabinet_Front_Oak_Veneer', '#b88452');
material('Cabinet_Front_Anthracite', '#2d3032');
material('Countertop_Light_Stone', '#d4d0c8');
material('Countertop_Oak_Butcher_Block', '#bc8856');
material('Toe_Kick_Shadow', '#1f2021');
material('Backsplash_Gloss_White_Tile', '#f8f8f5', { alpha: 0.96 });
material('Grout_Warm_Grey', '#bdb7ae');
material('Handle_Blackened_Steel', '#101214');
material('Stainless_Steel', '#9fa4a8');
material('Appliance_Black_Glass', '#111417', { alpha: 0.82 });
material('Cooktop_Glass_Black', '#050607', { alpha: 0.88 });
material('Sink_Dark_Interior', '#1a1d1f');
material('Warm_Light', '#ffd37a');
material('Pendant_Black_Metal', '#111111');
material('Stool_Oak', '#b27b45');
material('Stool_Black_Steel', '#151719');
material('Ceramic_Off_White', '#f7f2e9');
material('Planter_Terracotta', '#b76844');
material('Planter_Soil', '#3f2e23');
material('Plant_Green', '#5b8d4a');
material('Sample_Tag_White', '#fbfbf7');
material('Sample_Tag_Black_Text', '#111111');

op({ op: 'level', name: 'Showroom_Level_1', elevation: 0, height: 2550 });

box('Room_Floor_Slab_5400x4200', [0, 0, 0], [5400, 4200, 80], 'Floor_Light_Oak_Plank', { id: 'room-floor' });
box('Back_Wall_Warm_White', [120, 0, 80], [5160, 120, 2450], 'Wall_Warm_White', { id: 'back-wall' });
box('Left_Wall_Warm_White', [0, 0, 80], [120, 4200, 2450], 'Wall_Warm_White', { id: 'left-wall' });
box('Right_Return_Wall_Warm_White', [5280, 0, 80], [120, 3200, 2450], 'Wall_Warm_White', { id: 'right-wall' });
box('Ceiling_Plane_Matte_White', [0, 0, 2530], [5400, 4200, 20], 'Ceiling_Matte_White', { id: 'ceiling' });

tallCabinet({ id: 'integrated-fridge', name: 'Integrated_Fridge_Freezer_Tall_Unit', x: 240, frontMaterial: 'Cabinet_Front_Matte_White' });
ovenTowerCabinet({ id: 'oven-tower', name: 'Oven_Microwave_Tall_Unit', x: 860 });
box('Oven_Tower_Microwave_Black_Glass', [910, 816, 1220], [500, 16, 330], 'Appliance_Black_Glass', { id: 'microwave-glass' });
box('Oven_Tower_Main_Oven_Black_Glass', [910, 816, 720], [500, 16, 420], 'Appliance_Black_Glass', { id: 'oven-glass' });
box('Oven_Tower_Stainless_Trim_Upper', [905, 814, 1170], [510, 14, 36], 'Stainless_Steel', { id: 'oven-trim-upper' });
box('Oven_Tower_Stainless_Trim_Lower', [905, 814, 680], [510, 14, 36], 'Stainless_Steel', { id: 'oven-trim-lower' });

baseCabinet({ id: 'base-prep-drawers', name: 'Prep_Drawer_Base_600', x: 1540, y: 140, width: 600, drawers: 3 });
baseCabinet({ id: 'sink-base', name: 'Sink_Base_800', x: 2140, y: 140, width: 800, drawers: 1 });
baseCabinet({ id: 'dishwasher', name: 'Integrated_Dishwasher_600', x: 2940, y: 140, width: 600, drawers: 1, frontMaterial: 'Cabinet_Front_Matte_White' });
baseCabinet({ id: 'cooktop-drawers', name: 'Induction_Cooktop_Drawer_Base_800', x: 3540, y: 140, width: 800, drawers: 2 });
baseCabinet({ id: 'pullout-base', name: 'Recycling_Pullout_Base_600', x: 4340, y: 140, width: 600, drawers: 2 });

box('Continuous_Back_Run_Light_Stone_Countertop', [1540, 120, 900], [3400, 650, 38], 'Countertop_Light_Stone', { id: 'back-countertop' });
box('Countertop_Waterfall_Right_Return', [4940, 120, 80], [38, 650, 820], 'Countertop_Light_Stone', { id: 'counter-waterfall-right' });
box('Sink_Stainless_Rim', [2340, 360, 938], [420, 260, 16], 'Stainless_Steel', { id: 'sink-rim' });
box('Sink_Dark_Basin', [2370, 390, 954], [360, 200, 80], 'Sink_Dark_Interior', { id: 'sink-basin' });
cylinder('Faucet_Round_Base', [2520, 286, 938], 42, 46, 'Stainless_Steel', { id: 'faucet-base', segments: 24 });
pipe('Faucet_High_Arc_Spout', [[2540, 300, 980], [2540, 300, 1230], [2670, 370, 1230], [2670, 430, 1080]], 18, 'Stainless_Steel', { id: 'faucet-spout', segments: 14 });
box('Faucet_Single_Lever', [2478, 284, 1048], [18, 90, 22], 'Stainless_Steel', { id: 'faucet-lever' });

box('Induction_Cooktop_Black_Glass', [3700, 360, 942], [500, 360, 12], 'Cooktop_Glass_Black', { id: 'induction-cooktop' });
for (const [index, cx, cy, r] of [[1, 3810, 455, 72], [2, 4070, 455, 86], [3, 3825, 620, 62], [4, 4070, 625, 72]]) {
  cylinder(`Induction_Cooking_Zone_${index}`, [cx, cy, 956], r, 4, 'Appliance_Black_Glass', { id: `induction-zone-${index}`, segments: 32 });
}
box('Slim_Range_Hood_Canopy', [3650, 250, 1420], [620, 360, 95], 'Stainless_Steel', { id: 'range-hood-canopy' });
box('Range_Hood_Vertical_Chimney', [3870, 280, 1515], [180, 240, 540], 'Stainless_Steel', { id: 'range-hood-chimney' });

wallCabinet({ id: 'upper-left', name: 'Upper_Cabinet_Left_900', x: 1540, width: 900 });
wallCabinet({ id: 'upper-center', name: 'Upper_Cabinet_Sink_900', x: 2440, width: 900 });
wallCabinet({ id: 'upper-right', name: 'Upper_Cabinet_Right_760', x: 4280, width: 660 });
box('Open_Oak_Shelf_Left', [3340, 160, 1540], [260, 330, 36], 'Cabinet_Front_Oak_Veneer', { id: 'open-shelf-left-1' });
box('Open_Oak_Shelf_Left_Upper', [3340, 160, 1790], [260, 330, 36], 'Cabinet_Front_Oak_Veneer', { id: 'open-shelf-left-2' });
box('Open_Oak_Shelf_Right', [4280, 160, 1410], [660, 330, 36], 'Cabinet_Front_Oak_Veneer', { id: 'open-shelf-right-1' });
box('Under_Cabinet_LED_Strip_Left', [1540, 510, 1468], [1800, 24, 18], 'Warm_Light', { id: 'under-cabinet-light-left' });
box('Under_Cabinet_LED_Strip_Right', [4280, 510, 1468], [660, 24, 18], 'Warm_Light', { id: 'under-cabinet-light-right' });

addTileBacksplash();
box('Backsplash_Grout_Horizontal_1', [1540, 133, 1086], [3400, 4, 4], 'Grout_Warm_Grey', { id: 'grout-h1' });
box('Backsplash_Grout_Horizontal_2', [1540, 133, 1196], [3400, 4, 4], 'Grout_Warm_Grey', { id: 'grout-h2' });
box('Backsplash_Grout_Horizontal_3', [1540, 133, 1306], [3400, 4, 4], 'Grout_Warm_Grey', { id: 'grout-h3' });

box('Island_Recessed_Toe_Kick_Platform', [1930, 1960, 80], [1740, 740, 100], 'Toe_Kick_Shadow', { id: 'island-toe-kick-platform' });
box('Island_Base_Carcass', [1850, 1880, 180], [1900, 900, 720], 'Cabinet_Carcass_White', { id: 'island-base-carcass' });
box('Island_Oak_Waterfall_Left', [1810, 1880, 80], [40, 900, 820], 'Countertop_Oak_Butcher_Block', { id: 'island-waterfall-left' });
box('Island_Oak_Waterfall_Right', [3750, 1880, 80], [40, 900, 820], 'Countertop_Oak_Butcher_Block', { id: 'island-waterfall-right' });
box('Island_Oak_Butcher_Block_Countertop', [1810, 1840, 900], [1980, 980, 46], 'Countertop_Oak_Butcher_Block', { id: 'island-countertop' });
islandDrawerBank({ id: 'island-bank-a', name: 'Island_Work_Side_900', x: 1880, y: 1880, width: 900, side: 'front' });
islandDrawerBank({ id: 'island-bank-b', name: 'Island_Work_Side_900_Right', x: 2780, y: 1880, width: 900, side: 'front' });
box('Island_Back_Display_Panel_Left', [1880, 1858, 220], [900, 18, 620], 'Cabinet_Front_Anthracite', { id: 'island-back-left' });
box('Island_Back_Display_Panel_Right', [2780, 1858, 220], [900, 18, 620], 'Cabinet_Front_Anthracite', { id: 'island-back-right' });
box('Island_Power_Outlet_Double', [3560, 1834, 520], [110, 18, 72], 'Sample_Tag_White', { id: 'island-outlet' });
box('Island_Power_Outlet_Socket_A', [3580, 1814, 540], [28, 18, 28], 'Toe_Kick_Shadow', { id: 'island-outlet-a' });
box('Island_Power_Outlet_Socket_B', [3628, 1814, 540], [28, 18, 28], 'Toe_Kick_Shadow', { id: 'island-outlet-b' });

addStool('Oak_Bar_Stool_Left', 2250, 3240);
addStool('Oak_Bar_Stool_Right', 3180, 3240);
addPendant('Pendant_Over_Island_Left', 2350, 2300);
addPendant('Pendant_Over_Island_Right', 3230, 2300);

box('Wall_Rail_Blackened_Steel', [1650, 532, 1220], [700, 18, 22], 'Handle_Blackened_Steel', { id: 'wall-rail' });
for (let index = 0; index < 4; index += 1) {
  const x = 1740 + index * 150;
  pipe(`Rail_Hook_${index + 1}`, [[x, 552, 1220], [x, 572, 1168], [x + 24, 572, 1168]], 8, 'Handle_Blackened_Steel', { id: `rail-hook-${index + 1}`, segments: 8 });
  box(`Hanging_Utensil_${index + 1}`, [x + 10, 580, 1050], [18, 12, 118], 'Stainless_Steel', { id: `hanging-utensil-${index + 1}` });
}

addPlateStack('Open_Shelf_Plate_Stack', 3470, 316, 1578);
addPlateStack('Island_Display_Plates', 2230, 2140, 948);
addPlant('Countertop_Basil_Plant', 4620, 360, 938);

box('Showroom_Price_Tag_Card', [3920, 2090, 946], [360, 210, 8], 'Sample_Tag_White', { id: 'showroom-price-card' });
text3d('Showroom_Price_Tag_Text', [4100, 2195, 956], 'METOD kitchen', 42, 'Sample_Tag_Black_Text', { id: 'showroom-price-text', extrusion: 1, bold: true });
box('Worktop_Sample_Swatch_Oak', [4400, 2080, 946], [180, 160, 14], 'Countertop_Oak_Butcher_Block', { id: 'worktop-swatch-oak' });
box('Worktop_Sample_Swatch_Stone', [4610, 2080, 946], [180, 160, 14], 'Countertop_Light_Stone', { id: 'worktop-swatch-stone' });
box('Cabinet_Front_Sample_White', [4420, 2360, 946], [120, 18, 180], 'Cabinet_Front_Matte_White', { id: 'sample-front-white' });
box('Cabinet_Front_Sample_Anthracite', [4580, 2360, 946], [120, 18, 180], 'Cabinet_Front_Anthracite', { id: 'sample-front-anthracite' });
box('Cabinet_Front_Sample_Oak', [4740, 2360, 946], [120, 18, 180], 'Cabinet_Front_Oak_Veneer', { id: 'sample-front-oak' });

const heroCamera = { eye: [6200, 5200, 2200], target: [2820, 1420, 1120], up: [0, 0, 1], fov: 42 };
const worktopCamera = { eye: [2860, -2100, 1680], target: [2860, 520, 1220], up: [0, 0, 1], fov: 44 };
const topCamera = { eye: [2700, 2100, 7600], target: [2700, 2100, 700], up: [0, 1, 0], fov: 32 };
op({ op: 'camera', ...heroCamera });
op({ op: 'scene', name: 'Kitchen_Showroom_Open_Front_Hero', camera: heroCamera, transition_time: 1.5 });
op({ op: 'scene', name: 'Kitchen_Worktop_Eye_Level', camera: worktopCamera, transition_time: 1.2 });
op({ op: 'scene', name: 'Kitchen_Top_Plan_Check', camera: topCamera, transition_time: 1.0 });
op({ op: 'style', name: 'IKEA_Showroom_Presentation', display_edges: true, profiles: true, profile_width: 1.5, display_watermarks: false, face_style: 'shaded_with_textures', background_color: '#f5f3ef', sky_color: '#edf5ff', ground_color: '#d8d2c8' });
op({ op: 'shadow', display: true, time: '2026-07-02T15:00:00+08:00', light: 78, dark: 38, use_sun_for_shading: true });
op({ op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: false, draw_ground: true });
op({ op: 'camera', ...heroCamera });

const document = {
  version: 1,
  units: 'mm',
  metadata: {
    name: 'IKEA-inspired realistic kitchen showroom',
    room_size_mm: { width: 5400, depth: 4200, height: 2550 },
    design_notes: [
      'Full-scale showroom room with 600 mm cabinet modules and realistic 900-946 mm worktop heights.',
      'Includes tall appliance run, sink run, induction cooking zone, wall cabinets, tiled backsplash, island, lighting, stools, accessories, samples, and saved camera scenes.',
      'Uses safe JSON DSL geometry only; no external texture files are required.'
    ]
  },
  operations: ops
};

const modelSpec = {
  version: 1,
  title: 'IKEA Kitchen Showroom Layout QA',
  description: 'Layout gate for a full-scale IKEA-inspired kitchen showroom. Expected collisions describe real mounted, welded, inset, or layered kitchen construction rather than arbitrary overlap.',
  rules: {
    allowed_collisions: [
      {
        item: '/^(Integrated_Fridge_Freezer_Tall_Unit|Oven_Microwave_Tall_Unit|Prep_Drawer_Base_600|Sink_Base_800|Integrated_Dishwasher_600|Induction_Cooktop_Drawer_Base_800|Recycling_Pullout_Base_600|Upper_Cabinet_Left_900|Upper_Cabinet_Sink_900|Upper_Cabinet_Right_760|Island_Work_Side_900|Island_Work_Side_900_Right)_.*(Front|Door|Drawer|Pull|Handle|Panel)$/',
        with: '/^(Integrated_Fridge_Freezer_Tall_Unit|Oven_Microwave_Tall_Unit|Prep_Drawer_Base_600|Sink_Base_800|Integrated_Dishwasher_600|Induction_Cooktop_Drawer_Base_800|Recycling_Pullout_Base_600|Upper_Cabinet_Left_900|Upper_Cabinet_Sink_900|Upper_Cabinet_Right_760|Island_Base_Carcass|Island_Work_Side_900|Island_Work_Side_900_Right)_.*(Carcass|Front|Door|Drawer|Panel)$/'
      },
      { item: '/^Oven_Tower_/', with: '/^Oven_Microwave_Tall_Unit_/' },
      { item: '/^(Sink_|Faucet_)/', with: '/^(Continuous_Back_Run_Light_Stone_Countertop|Sink_|Faucet_)/' },
      { item: '/^Induction_/', with: '/^(Continuous_Back_Run_Light_Stone_Countertop|Induction_)/' },
      { item: '/^(Slim_Range_Hood|Range_Hood_)/', with: '/^(Back_Wall_Warm_White|Ceiling_Plane_Matte_White|Slim_Range_Hood|Range_Hood_)/' },
      { item: '/^(Open_Oak_Shelf|Under_Cabinet_LED)/', with: '/^(Back_Wall_Warm_White|Upper_Cabinet_.*|Open_Oak_Shelf)/' },
      { item: '/^Open_Shelf_Plate_Stack_/', with: '/^(Open_Oak_Shelf_Left|Open_Oak_Shelf_Left_Upper|Open_Shelf_Plate_Stack_)/' },
      { item: '/^Island_Display_Plates_/', with: '/^(Island_Oak_Butcher_Block_Countertop|Island_Display_Plates_)/' },
      { item: '/^(Island_Back_Display_Panel|Island_Power_Outlet|Worktop_Sample|Cabinet_Front_Sample|Showroom_Price_Tag)/', with: '/^(Island_Base_Carcass|Island_Oak_Butcher_Block_Countertop|Island_Back_Display_Panel|Island_Power_Outlet|Showroom_Price_Tag)/' },
      { item: '/^Oak_Bar_Stool_/', with: '/^Oak_Bar_Stool_/' },
      { item: '/^Pendant_Over_Island_/', with: '/^(Ceiling_Plane_Matte_White|Pendant_Over_Island_)/' },
      { item: '/^(Wall_Rail|Rail_Hook|Hanging_Utensil)/', with: '/^(Back_Wall_Warm_White|Wall_Rail|Rail_Hook|Hanging_Utensil)/' },
      { item: '/^Countertop_Basil_Plant_/', with: '/^(Continuous_Back_Run_Light_Stone_Countertop|Countertop_Basil_Plant_)/' },
      { item: '/^White_Subway_Tile_/', with: '/^(Back_Wall_Warm_White|Backsplash_Grout_)/' },
      { item: '/^Backsplash_Grout_/', with: '/^(Back_Wall_Warm_White|White_Subway_Tile_)/' }
    ],
    inside: [
      {
        match: '^(Integrated_Fridge_Freezer_Tall_Unit|Oven_Microwave_Tall_Unit|Prep_Drawer_Base_600|Sink_Base_800|Integrated_Dishwasher_600|Induction_Cooktop_Drawer_Base_800|Recycling_Pullout_Base_600|Island_|Oak_Bar_Stool_|Pendant_Over_Island_|Worktop_Sample_|Cabinet_Front_Sample_|Showroom_Price_Tag_|Countertop_Basil_Plant_).*',
        parent: 'Room_Floor_Slab_5400x4200',
        axes: ['x', 'y'],
        tolerance_mm: 0
      }
    ],
    support: [
      {
        match: '^(Integrated_Fridge_Freezer_Tall_Unit_Carcass|Oven_Microwave_Tall_Unit_Carcass|.*_Toe_Kick|Island_Recessed_Toe_Kick_Platform|Island_Oak_Waterfall_.*|Oak_Bar_Stool_.*_Foot)$',
        parent: 'Room_Floor_Slab_5400x4200',
        max_gap_mm: 5,
        allow_penetration_mm: 1
      },
      {
        match: '^Island_Base_Carcass$',
        parent: 'Island_Recessed_Toe_Kick_Platform',
        max_gap_mm: 2,
        allow_penetration_mm: 1
      },
      {
        match: '^Countertop_Basil_Plant_Pot$',
        parent: 'Continuous_Back_Run_Light_Stone_Countertop',
        max_gap_mm: 2,
        allow_penetration_mm: 1
      }
    ],
    separation: [
      {
        name: 'clear working aisle between back run and island',
        items: ['Continuous_Back_Run_Light_Stone_Countertop', 'Island_Oak_Butcher_Block_Countertop'],
        axes: ['y', 'z'],
        min_gap_mm: 900
      }
    ],
    views: ['top', 'front', 'right']
  }
};

const limitations = `# IKEA Kitchen Showroom MCP Limitations

This model targets a realistic full-scale showroom, but the current MCP/DSL still has limits that should be kept visible:

- Materials are represented by colors, alpha, and semantic material names. No real IKEA texture library, PBR texture maps, grain images, or .skm materials are embedded.
- Cabinet hardware, sink basin, induction zones, outlets, utensils, and lighting are modeled as structured solids/curves, not manufacturer CAD parts.
- Sink basin, cooktop, outlet sockets, and appliance glass are visual/detail geometry. Arbitrary subtractive cutouts and exact appliance recesses are not fully modeled as CAD booleans.
- The companion layout QA spec records expected construction contacts such as inset appliances, mounted handles, welded stool parts, pendant bulb/shade nesting, and plant stems. Unexpected collision warnings outside that spec should still be treated as model defects.
- Current mock/queue validation still reports raw bbox warnings for expected nested or attached detail classes: faucet over sink, faucet base/spout, stool footrest welds, pendant bulb inside shade, rail hooks, and plant stems emerging from soil. The model QA spec classifies those as expected; they remain recorded because the snapshot warning layer is intentionally geometry-only.
- Rounded cabinet panels, exact soft-close drawer gaps, screw details, and faucet curvature are approximated with supported primitives and pipe helpers.
- Text labels use the available \`text_3d\` tool; orientation support is limited, so the price card text is placed as a horizontal showroom artifact rather than a fully vertical wall label.
- This is a generated showroom model, not a certified IKEA product drawing or construction document.
`;

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(artifactDir, { recursive: true });
await fs.mkdir(path.dirname(modelSpecPath), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await fs.writeFile(modelSpecPath, `${JSON.stringify(modelSpec, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(artifactDir, 'limitations.md'), limitations, 'utf8');
await fs.writeFile(path.join(artifactDir, 'design-brief.json'), `${JSON.stringify(document.metadata, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  output,
  operations: ops.length,
  model_spec: modelSpecPath,
  limitations: path.join(artifactDir, 'limitations.md'),
  design_brief: path.join(artifactDir, 'design-brief.json')
}, null, 2)}\n`);

function safeId(value) {
  return String(value || `entity-${sequence}`)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function roundArray(values) {
  return values.map((value) => Math.round(Number(value) * 1000) / 1000);
}

function without(object, keys) {
  const result = {};
  for (const [key, value] of Object.entries(object || {})) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}
