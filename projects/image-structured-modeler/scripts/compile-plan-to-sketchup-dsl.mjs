#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(repoRoot, options.input || 'projects/image-structured-modeler/examples/switch-controller/model-plan.json');
  const output = path.resolve(repoRoot, options.output || 'projects/image-structured-modeler/examples/switch-controller/output.json');
  const modelPlan = JSON.parse(await fs.readFile(input, 'utf8'));
  const dsl = compilePlanToSketchUpDsl(modelPlan);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(dsl, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, output, operations: dsl.operations.length }, null, 2)}\n`);
}

export function compilePlanToSketchUpDsl(modelPlan) {
  const width = positive(modelPlan.scale?.known_width, 280);
  const height = positive(modelPlan.scale?.known_height, 155);
  const depth = positive(modelPlan.scale?.known_depth, 42);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const shellWidth = (width - 96) / 2;
  const topZ = depth * 0.58;
  const buttonZ = topZ + 2;
  const parts = new Map((modelPlan.parts || []).map((part) => [part.id, part]));

  const operations = [
    { op: 'reset' },
    { op: 'material', name: 'Warm_White_Plastic', color: '#e8ece8', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.02, roughness_factor: 0.38, ao_strength: 0.45 } },
    { op: 'material', name: 'Satin_Black_Plastic', color: '#111214', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.03, roughness_factor: 0.46, ao_strength: 0.65 } },
    { op: 'material', name: 'Gloss_Black_Button', color: '#050506', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.02, roughness_factor: 0.18, ao_strength: 0.55 } },
    { op: 'material', name: 'Rubber_Thumbstick', color: '#161719', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.01, roughness_factor: 0.75, ao_strength: 0.75 } },
    { op: 'material', name: 'Indicator_Green', color: '#43d17a' },
    { op: 'material', name: 'Dark_Seam', color: '#282a2d' },
    { op: 'component_definition', name: 'Switch_Round_Button_Def', operations: [
      { op: 'cylinder', name: 'Button_Cap', origin: [0, 0, 0], radius: 5.8, height: 3.8, segments: 16, material: 'Gloss_Black_Button', smooth: 'all' }
    ] },
    { op: 'component_definition', name: 'Switch_Dpad_Button_Def', operations: [
      { op: 'cylinder', name: 'Dpad_Button_Cap', origin: [0, 0, 0], radius: 4.8, height: 3.4, segments: 14, material: 'Gloss_Black_Button', smooth: 'all' }
    ] },
    { op: 'component_definition', name: 'Switch_LED_Def', size: [6, 2, 1.6], material: 'Indicator_Green' },
    { op: 'component_definition', name: 'Switch_Screw_Def', operations: [
      { op: 'cylinder', name: 'Screw_Head', origin: [0, 0, 0], radius: 2.4, height: 1.2, segments: 12, material: 'Dark_Seam', smooth: 'all' }
    ] }
  ];

  operations.push(
    { op: 'rounded_box', name: 'Left_Joycon_Shell_From_Image_Plan', origin: [-halfWidth, -halfHeight, 0], size: [shellWidth, height, topZ], radius: 18, segments: 8, material: 'Warm_White_Plastic', smooth: 'all' },
    { op: 'rounded_box', name: 'Right_Joycon_Shell_From_Image_Plan', origin: [48, -halfHeight, 0], size: [shellWidth, height, topZ], radius: 18, segments: 8, material: 'Warm_White_Plastic', smooth: 'all' },
    { op: 'rounded_box', name: 'Center_Grip_Body_From_Image_Plan', origin: [-48, -height * 0.47, 0], size: [96, height * 0.94, depth * 0.54], radius: 11, segments: 6, material: 'Satin_Black_Plastic', smooth: 'all' },
    { op: 'rounded_box', name: 'Center_Front_Recess_From_Image_Plan', origin: [-34, -height * 0.36, buttonZ - 2], size: [68, height * 0.72, 3], radius: 6, segments: 5, material: 'Dark_Seam', smooth: 'all' },
    { op: 'domed_surface', name: 'Left_Joycon_Face_Dome_From_Image_Plan', origin: [-halfWidth + 8, -halfHeight + 9, topZ - 1], width: shellWidth - 14, depth: height - 18, thickness: 2.5, crown_height: 4.5, segments_x: 6, segments_y: 8, material: 'Warm_White_Plastic', smooth: 'all' },
    { op: 'domed_surface', name: 'Right_Joycon_Face_Dome_From_Image_Plan', origin: [48 + 6, -halfHeight + 9, topZ - 1], width: shellWidth - 14, depth: height - 18, thickness: 2.5, crown_height: 4.5, segments_x: 6, segments_y: 8, material: 'Warm_White_Plastic', smooth: 'all' },
    { op: 'bowed_panel', name: 'Left_Rear_Grip_From_Image_Plan', origin: [-halfWidth + 18, halfHeight - 18, 2], width: 52, height: depth * 0.8, thickness: 10, bow_depth: 20, segments_x: 6, segments_z: 4, material: 'Satin_Black_Plastic', smooth: 'all' },
    { op: 'bowed_panel', name: 'Right_Rear_Grip_From_Image_Plan', origin: [halfWidth - 70, halfHeight - 18, 2], width: 52, height: depth * 0.8, thickness: 10, bow_depth: 20, segments_x: 6, segments_z: 4, material: 'Satin_Black_Plastic', smooth: 'all' },
    { op: 'rounded_box', name: 'Top_Left_Shoulder_Rail_From_Image_Plan', origin: [-halfWidth + 16, -halfHeight - 7, topZ - 2], size: [76, 7, 6], radius: 3, segments: 4, material: 'Satin_Black_Plastic', smooth: 'all' },
    { op: 'rounded_box', name: 'Top_Right_Shoulder_Rail_From_Image_Plan', origin: [halfWidth - 92, -halfHeight - 7, topZ - 2], size: [76, 7, 6], radius: 3, segments: 4, material: 'Satin_Black_Plastic', smooth: 'all' }
  );

  const leftStick = parts.get('left_thumbstick')?.parameters || {};
  const rightStick = parts.get('right_thumbstick')?.parameters || {};
  operations.push(
    analogStick('Left_Thumbstick_From_Image_Plan', leftStick.center || [-92, -20, buttonZ], leftStick, 'Rubber_Thumbstick'),
    analogStick('Right_Thumbstick_From_Image_Plan', rightStick.center || [72, 34, buttonZ], rightStick, 'Rubber_Thumbstick')
  );

  const abxyButtons = parts.get('abxy_cluster')?.parameters?.buttons || [];
  for (const button of abxyButtons) {
    operations.push({
      op: 'component_instance',
      name: `ABXY_${safeName(button.label)}_Button_From_Image_Plan`,
      definition: 'Switch_Round_Button_Def',
      origin: [button.center[0], button.center[1], buttonZ + 2]
    });
  }

  const leftButtons = parts.get('left_button_cluster')?.parameters?.buttons || [];
  for (const button of leftButtons) {
    operations.push({
      op: 'component_instance',
      name: `Left_${safeName(button.label)}_Button_From_Image_Plan`,
      definition: 'Switch_Dpad_Button_Def',
      origin: [button.center[0], button.center[1], buttonZ + 2]
    });
  }

  for (const [index, x] of [-18, -6, 6, 18].entries()) {
    operations.push({ op: 'component_instance', name: `Center_LED_${index + 1}_From_Image_Plan`, definition: 'Switch_LED_Def', origin: [x, halfHeight - 22, buttonZ + 2] });
  }
  for (const [name, x, y] of [
    ['Top_Left', -halfWidth + 22, -halfHeight + 18],
    ['Bottom_Left', -halfWidth + 24, halfHeight - 20],
    ['Top_Right', halfWidth - 24, -halfHeight + 18],
    ['Bottom_Right', halfWidth - 22, halfHeight - 20]
  ]) {
    operations.push({ op: 'component_instance', name: `Screw_${name}_From_Image_Plan`, definition: 'Switch_Screw_Def', origin: [x, y, buttonZ + 1] });
  }

  operations.push(
    { op: 'scene', name: 'Image_Structured_Front_Review', camera: { eye: [0, -520, 220], target: [0, 0, 20], up: [0, 0, 1], fov: 34 } },
    { op: 'scene', name: 'Image_Structured_Top_QA', camera: { eye: [0, 0, 620], target: [0, 0, 18], up: [0, 1, 0], fov: 32 } },
    { op: 'style', name: 'Image_Structured_Product_Review', display_edges: true, profiles: true, profile_width: 2, face_style: 'shaded_with_textures', background_color: '#f4f5f7', sky_color: '#eef6ff', ground_color: '#d9dde2' },
    { op: 'shadow', display: true, time: '2026-05-13T10:30:00+08:00', light: 78, dark: 42, use_sun_for_shading: true },
    { op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: false }
  );

  return { version: 1, units: 'mm', operations };
}

function analogStick(name, center, parameters, material) {
  const [x, y, z] = center;
  const outer = positive(parameters.outer_radius, 10.5);
  const top = positive(parameters.top_radius, outer * 0.86);
  const height = positive(parameters.height, 13);
  return {
    op: 'lofted_solid',
    name,
    origin: [x, y, z],
    profile: [[0, outer * 0.72], [height * 0.42, outer], [height, top]],
    segments: 18,
    material,
    smooth: 'all'
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_]+/g, '_');
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/compile-plan-to-sketchup-dsl.mjs \\
    --input projects/image-structured-modeler/examples/switch-controller/model-plan.json \\
    --output projects/image-structured-modeler/examples/switch-controller/output.json
`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
