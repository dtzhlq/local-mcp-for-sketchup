#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

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
  const profile = normalizeModelPlanProfile(modelPlan);
  if (profile === 'compact_remote') return compileCompactRemotePlan(modelPlan);
  return compileSwitchControllerPlan(modelPlan);
}

function compileSwitchControllerPlan(modelPlan) {
  const width = positive(modelPlan.scale?.known_width, 280);
  const height = positive(modelPlan.scale?.known_height, 155);
  const depth = positive(modelPlan.scale?.known_depth, 42);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const shellWidth = (width - 96) / 2;
  const topZ = depth * 0.58;
  const faceDomeBaseZ = topZ + 0.05;
  const faceDomeThickness = 2;
  const faceDomeCrown = 1.5;
  const faceDomeTopZ = faceDomeBaseZ + faceDomeThickness + faceDomeCrown;
  const mountedBaseZ = faceDomeTopZ + 0.1;
  const stickHeight = Math.max(8, depth - 2 - mountedBaseZ);
  const rearGripY = halfHeight;
  const rearGripThickness = 2;
  const rearGripBowDepth = 10;
  const parts = new Map((modelPlan.parts || []).map((part) => [part.id, part]));
  const leftShellName = 'Left_Joycon_Shell_From_Image_Plan';
  const rightShellName = 'Right_Joycon_Shell_From_Image_Plan';
  const leftFaceDomeName = 'Left_Joycon_Face_Dome_From_Image_Plan';
  const rightFaceDomeName = 'Right_Joycon_Face_Dome_From_Image_Plan';
  const leftRearGripName = 'Left_Rear_Grip_From_Image_Plan';
  const rightRearGripName = 'Right_Rear_Grip_From_Image_Plan';

  const operations = [
    { op: 'reset' },
    { op: 'material', name: 'Warm_White_Plastic', color: '#e8ece8', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.02, roughness_factor: 0.38, ao_strength: 0.45 } },
    { op: 'material', name: 'Satin_Black_Plastic', color: '#111214', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.03, roughness_factor: 0.46, ao_strength: 0.65 } },
    { op: 'material', name: 'Gloss_Black_Button', color: '#050506', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.02, roughness_factor: 0.18, ao_strength: 0.55 } },
    { op: 'material', name: 'Rubber_Thumbstick', color: '#161719', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.01, roughness_factor: 0.75, ao_strength: 0.75 } },
    { op: 'material', name: 'Indicator_Green', color: '#43d17a' },
    { op: 'material', name: 'Dark_Seam', color: '#282a2d' },
    { op: 'component_definition', name: 'Switch_LED_Def', size: [6, 2, 1.6], material: 'Indicator_Green' },
  ];

  operations.push(
    { op: 'rounded_box', name: leftShellName, origin: [-halfWidth, -halfHeight, 0], size: [shellWidth, height, topZ], radius: 18, segments: 8, material: 'Warm_White_Plastic', smooth: 'all', qa: qaMetadata('shell', 'left_joycon_shell') },
    { op: 'rounded_box', name: rightShellName, origin: [48, -halfHeight, 0], size: [shellWidth, height, topZ], radius: 18, segments: 8, material: 'Warm_White_Plastic', smooth: 'all', qa: qaMetadata('shell', 'right_joycon_shell') },
    { op: 'rounded_box', name: 'Center_Grip_Body_From_Image_Plan', origin: [-48, -height * 0.47, 0], size: [96, height * 0.94, depth * 0.54], radius: 11, segments: 6, material: 'Satin_Black_Plastic', smooth: 'all' },
    { op: 'rounded_box', name: 'Center_Front_Recess_From_Image_Plan', origin: [-34, -height * 0.36, mountedBaseZ - 3], size: [68, height * 0.72, 2.5], radius: 6, segments: 5, material: 'Dark_Seam', smooth: 'all' },
    { op: 'domed_surface', name: leftFaceDomeName, origin: [-halfWidth + 8, -halfHeight + 19, faceDomeBaseZ], width: shellWidth - 14, depth: height - 38, thickness: faceDomeThickness, crown_height: faceDomeCrown, segments_x: 6, segments_y: 8, material: 'Warm_White_Plastic', smooth: 'all', qa: qaMetadata('face_dome', 'left_joycon_face_dome', [expectedContact(leftShellName, 'intentional_shallow_overlap', 'Face dome is a cosmetic skin layered onto the controller shell.')]) },
    { op: 'domed_surface', name: rightFaceDomeName, origin: [48 + 6, -halfHeight + 19, faceDomeBaseZ], width: shellWidth - 14, depth: height - 38, thickness: faceDomeThickness, crown_height: faceDomeCrown, segments_x: 6, segments_y: 8, material: 'Warm_White_Plastic', smooth: 'all', qa: qaMetadata('face_dome', 'right_joycon_face_dome', [expectedContact(rightShellName, 'intentional_shallow_overlap', 'Face dome is a cosmetic skin layered onto the controller shell.')]) },
    { op: 'bowed_panel', name: leftRearGripName, origin: [-halfWidth + 18, rearGripY, 2], width: 52, height: depth * 0.8, thickness: rearGripThickness, bow_depth: rearGripBowDepth, segments_x: 6, segments_z: 4, material: 'Satin_Black_Plastic', smooth: 'all', qa: qaMetadata('rear_grip', 'left_rear_grip', [expectedContact(leftShellName, 'expected_grip_attachment', 'Rear grip intentionally contacts the shell rear face without bbox penetration.')]) },
    { op: 'bowed_panel', name: rightRearGripName, origin: [halfWidth - 70, rearGripY, 2], width: 52, height: depth * 0.8, thickness: rearGripThickness, bow_depth: rearGripBowDepth, segments_x: 6, segments_z: 4, material: 'Satin_Black_Plastic', smooth: 'all', qa: qaMetadata('rear_grip', 'right_rear_grip', [expectedContact(rightShellName, 'expected_grip_attachment', 'Rear grip intentionally contacts the shell rear face without bbox penetration.')]) },
    { op: 'rounded_box', name: 'Top_Left_Shoulder_Rail_From_Image_Plan', origin: [-halfWidth + 16, -halfHeight - 7, topZ - 2], size: [76, 7, 6], radius: 3, segments: 4, material: 'Satin_Black_Plastic', smooth: 'all' },
    { op: 'rounded_box', name: 'Top_Right_Shoulder_Rail_From_Image_Plan', origin: [halfWidth - 92, -halfHeight - 7, topZ - 2], size: [76, 7, 6], radius: 3, segments: 4, material: 'Satin_Black_Plastic', smooth: 'all' }
  );

  const leftStick = parts.get('left_thumbstick')?.parameters || {};
  const rightStick = parts.get('right_thumbstick')?.parameters || {};
  operations.push(
    analogStick('Left_Thumbstick_From_Image_Plan', leftStick.center || [-92, -20, mountedBaseZ], { ...leftStick, height: stickHeight }, 'Rubber_Thumbstick', leftFaceDomeName, mountedBaseZ),
    analogStick('Right_Thumbstick_From_Image_Plan', rightStick.center || [72, 34, mountedBaseZ], { ...rightStick, height: stickHeight }, 'Rubber_Thumbstick', rightFaceDomeName, mountedBaseZ)
  );

  const abxyButtons = parts.get('abxy_cluster')?.parameters?.buttons || [];
  for (const button of abxyButtons) {
    const name = `ABXY_${safeName(button.label)}_Button_From_Image_Plan`;
    operations.push({
      op: 'button_on_panel',
      name,
      center: [button.center[0], button.center[1], mountedBaseZ],
      radius: 5.8,
      height: 3.8,
      segments: 16,
      material: 'Gloss_Black_Button',
      smooth: 'all',
      qa: mountedDetailQa(name, rightFaceDomeName, 'button')
    });
  }

  const leftButtons = parts.get('left_button_cluster')?.parameters?.buttons || [];
  for (const button of leftButtons) {
    const name = `Left_${safeName(button.label)}_Button_From_Image_Plan`;
    operations.push({
      op: 'button_on_panel',
      name,
      center: [button.center[0], button.center[1], mountedBaseZ],
      radius: 4.8,
      height: 3.4,
      segments: 14,
      material: 'Gloss_Black_Button',
      smooth: 'all',
      qa: mountedDetailQa(name, leftFaceDomeName, 'button')
    });
  }

  for (const [index, x] of [-18, -6, 6, 18].entries()) {
    operations.push({ op: 'component_instance', name: `Center_LED_${index + 1}_From_Image_Plan`, definition: 'Switch_LED_Def', origin: [x, halfHeight - 22, mountedBaseZ] });
  }
  for (const [name, x, y] of [
    ['Top_Left', -halfWidth + 22, -halfHeight + 18],
    ['Bottom_Left', -halfWidth + 24, halfHeight - 23],
    ['Top_Right', halfWidth - 24, -halfHeight + 18],
    ['Bottom_Right', halfWidth - 22, halfHeight - 23]
  ]) {
    const screwName = `Screw_${name}_From_Image_Plan`;
    const sideFaceDome = name.includes('Left') ? leftFaceDomeName : rightFaceDomeName;
    const sideRearGrip = name.includes('Left') ? leftRearGripName : rightRearGripName;
    const contacts = [expectedContact(sideFaceDome, 'expected_mounted_detail', 'Screws are mounted on the face panel and share bbox volume with it.')];
    if (name.includes('Bottom')) contacts.push(expectedContact(sideRearGrip, 'expected_grip_attachment', 'Bottom screw sits near the rear grip attachment volume.'));
    operations.push({
      op: 'screw_hole',
      name: screwName,
      center: [x, y, mountedBaseZ + 1.2],
      radius: 1.8,
      depth: 1.2,
      head_radius: 2.4,
      head_depth: 0.45,
      segments: 12,
      material: 'Dark_Seam',
      smooth: 'all',
      qa: qaMetadata('screw', screwName, contacts)
    });
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

function compileCompactRemotePlan(modelPlan) {
  const width = positive(modelPlan.scale?.known_width, 44);
  const height = positive(modelPlan.scale?.known_height, 158);
  const depth = positive(modelPlan.scale?.known_depth, 16);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const parts = new Map((modelPlan.parts || []).map((part) => [part.id, part]));
  const body = parts.get('remote_body')?.parameters || {};
  const face = parts.get('remote_face_panel')?.parameters || {};
  const nav = parts.get('navigation_pad')?.parameters || {};
  const primary = parts.get('primary_button_cluster')?.parameters || {};
  const rocker = parts.get('volume_rocker')?.parameters || {};
  const grille = parts.get('speaker_grille')?.parameters || {};
  const label = parts.get('brand_label')?.parameters || {};
  const bodyTopZ = depth * 0.72;
  const faceThickness = positive(face.thickness, 2);
  const faceTopZ = bodyTopZ + 0.05 + faceThickness;
  const mountedZ = faceTopZ + 0.08;

  const operations = [
    { op: 'reset' },
    { op: 'material', name: 'Remote_Graphite_Plastic', color: '#20252b', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.01, roughness_factor: 0.52, ao_strength: 0.55 } },
    { op: 'material', name: 'Remote_Satin_Face', color: '#2f3740', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.02, roughness_factor: 0.34, ao_strength: 0.45 } },
    { op: 'material', name: 'Remote_Button_Rubber', color: '#101317', workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.0, roughness_factor: 0.78, ao_strength: 0.7 } },
    { op: 'material', name: 'Remote_Dark_Detail', color: '#050607' },
    {
      op: 'rounded_box',
      name: 'Compact_Remote_Body_From_Image_Plan',
      origin: [-halfWidth, -halfHeight, 0],
      size: [width, height, bodyTopZ],
      radius: positive(body.corner_radius, Math.min(width * 0.24, 11)),
      segments: 8,
      material: 'Remote_Graphite_Plastic',
      smooth: 'all',
      qa: qaMetadata('body', 'remote_body')
    },
    {
      op: 'rounded_box',
      name: 'Compact_Remote_Face_Panel_From_Image_Plan',
      origin: [-(positive(face.width, width - 8)) / 2, -(positive(face.height, height - 18)) / 2, bodyTopZ + 0.05],
      size: [positive(face.width, width - 8), positive(face.height, height - 18), faceThickness],
      radius: positive(face.corner_radius, 6),
      segments: 6,
      material: 'Remote_Satin_Face',
      smooth: 'all',
      qa: qaMetadata('face_panel', 'remote_face_panel')
    }
  ];

  operations.push(buttonOnPanelFromSpec({
    name: 'Remote_Navigation_Pad_From_Image_Plan',
    spec: nav,
    defaultCenter: [0, -30],
    defaultSize: [24, 24],
    defaultCornerRadius: 12,
    defaultHeight: 2.2,
    z: mountedZ,
    material: 'Remote_Button_Rubber',
    qaRole: 'navigation_pad'
  }));

  for (const button of primary.buttons || []) {
    operations.push(buttonOnPanelFromSpec({
      name: `Remote_${safeName(button.label)}_Button_From_Image_Plan`,
      spec: button,
      defaultCenter: [0, 0],
      defaultRadius: 4,
      defaultHeight: 1.9,
      z: mountedZ,
      material: 'Remote_Button_Rubber',
      qaRole: 'button'
    }));
  }

  operations.push(buttonOnPanelFromSpec({
    name: 'Remote_Volume_Rocker_From_Image_Plan',
    spec: rocker,
    defaultCenter: [0, 24],
    defaultSize: [9, 28],
    defaultCornerRadius: 4.5,
    defaultHeight: 2,
    z: mountedZ,
    material: 'Remote_Button_Rubber',
    qaRole: 'volume_rocker'
  }));

  const grilleCount = Math.max(1, Math.min(12, Math.round(positive(grille.count, 5))));
  operations.push({
    op: 'slot_array',
    name: 'Remote_Speaker_Grille_From_Image_Plan',
    center: withZ(grille.center || [0, -66], mountedZ + 0.45),
    count: grilleCount,
    spacing: positive(grille.spacing, 4),
    length: positive(grille.length, 2.4),
    width: positive(grille.width, 1),
    depth: positive(grille.depth, 0.35),
    direction: 'x',
    segments: 5,
    material: 'Remote_Dark_Detail',
    smooth: 'all'
  });

  operations.push({
    op: 'text_3d',
    name: 'Remote_Brand_Label_From_Image_Plan',
    text: label.text || 'ALMA',
    center: withZ(label.center || [0, 52], mountedZ + 0.4),
    height: positive(label.height, 5),
    extrusion: positive(label.extrusion, 0.45),
    font: label.font || 'Arial',
    align: 'center',
    material: 'Remote_Dark_Detail',
    qa: qaMetadata('label', 'brand_label')
  });

  operations.push(
    { op: 'scene', name: 'Compact_Remote_Front_Review', camera: { eye: [0, -360, 150], target: [0, 0, depth / 2], up: [0, 0, 1], fov: 28 } },
    { op: 'scene', name: 'Compact_Remote_Top_QA', camera: { eye: [0, 0, 360], target: [0, 0, depth / 2], up: [0, 1, 0], fov: 30 } },
    { op: 'style', name: 'Compact_Remote_Product_Review', display_edges: true, profiles: true, profile_width: 2, face_style: 'shaded_with_textures', background_color: '#f5f6f8', sky_color: '#eef5ff', ground_color: '#d7dce3' },
    { op: 'shadow', display: true, time: '2026-05-25T09:30:00+08:00', light: 72, dark: 44, use_sun_for_shading: true },
    { op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: false }
  );

  return { version: 1, units: 'mm', operations };
}

function buttonOnPanelFromSpec({ name, spec = {}, defaultCenter, defaultRadius, defaultSize, defaultCornerRadius, defaultHeight, z, material, qaRole }) {
  const operation = {
    op: 'button_on_panel',
    name,
    center: withZ(spec.center || defaultCenter, z),
    height: positive(spec.height, defaultHeight),
    segments: spec.size || defaultSize ? 10 : 16,
    material,
    smooth: 'all',
    qa: qaMetadata(qaRole, name)
  };
  const size = spec.size || defaultSize;
  if (size) {
    operation.size = size;
    operation.corner_radius = positive(spec.corner_radius, defaultCornerRadius ?? Math.min(size[0], size[1]) / 2);
  } else {
    operation.radius = positive(spec.radius, defaultRadius);
  }
  return operation;
}

function withZ(point, z) {
  return [Number(point[0]) || 0, Number(point[1]) || 0, z];
}

function analogStick(name, center, parameters, material, faceDomeName, mountedBaseZ) {
  const [x, y] = center;
  const outer = positive(parameters.outer_radius, 10.5);
  const top = positive(parameters.top_radius, outer * 0.86);
  const height = positive(parameters.height, 13);
  return {
    op: 'analog_stick',
    name,
    origin: [x, y, mountedBaseZ],
    profile: [[0, outer * 0.72], [height * 0.42, outer], [height, top]],
    segments: 18,
    material,
    smooth: 'all',
    qa: mountedDetailQa(name, faceDomeName, 'thumbstick')
  };
}

function mountedDetailQa(partId, faceDomeName, role) {
  return qaMetadata(role, partId, [
    expectedContact(faceDomeName, 'expected_mounted_detail', 'Mounted controls intentionally sit on the face panel and share bbox volume with it.')
  ]);
}

function qaMetadata(role, partId, expectedContacts = []) {
  return {
    role,
    part_id: partId,
    expected_contacts: expectedContacts
  };
}

function expectedContact(withName, bucket, note) {
  return { with: withName, bucket, note };
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

function normalizeModelPlanProfile(modelPlan) {
  const explicit = modelPlan.object?.profile || modelPlan.object?.object_profile;
  if (explicit === 'compact_remote' || explicit === 'remote_control' || explicit === 'media_remote') return 'compact_remote';
  if (explicit === 'switch_controller' || explicit === 'game_controller') return 'switch_controller';
  if (modelPlan.object?.type === 'remote_control') return 'compact_remote';
  return 'switch_controller';
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
