const ops = [];
const add = (op) => ops.push(op);
const r = (n) => Number(n.toFixed(2));
const v = (items) => items.map(r);

const SURFACE_Z = 22;
const BUTTON_Z = SURFACE_Z + 1.2;
const DETAIL_Z = SURFACE_Z + 0.8;

const leftPanel = { name: 'left Joy-Con', x0: -136, x1: -74, y0: -72, y1: 72 };
const rightPanel = { name: 'right Joy-Con', x0: 74, x1: 136, y0: -72, y1: 72 };
const controlFootprints = [];

function mat(name, color, extra = {}) {
  add({ op: 'material', name, color, ...extra });
}

function box(name, origin, size, material, extra = {}) {
  add({ op: 'box', name, origin: v(origin), size: v(size), material, ...extra });
}

function roundedBox(name, origin, size, radius, material, extra = {}) {
  add({
    op: 'rounded_box',
    name,
    origin: v(origin),
    size: v(size),
    radius: r(radius),
    segments: extra.segments ?? 8,
    material,
    smooth: extra.smooth ?? 'all',
    ...without(extra, ['segments', 'smooth'])
  });
}

function cylinder(name, origin, radius, height, material, segments = 32, extra = {}) {
  add({
    op: 'cylinder',
    name,
    origin: v(origin),
    radius: r(radius),
    height: r(height),
    segments,
    material,
    smooth: extra.smooth ?? 'all',
    ...without(extra, ['smooth'])
  });
}

function textLabel(name, text, center, height = 8) {
  add({
    op: 'text_3d',
    name,
    text,
    center: v(center),
    height,
    extrusion: 0.7,
    font: 'Arial',
    align: 'center',
    bold: true,
    filled: true,
    material: 'Label_White'
  });
}

function roundButton(name, panel, center, radius, label) {
  assertInsidePanel(`${name} button`, panel, center, radius + 2);
  registerFootprint(name, center, radius);
  cylinder(`${name}_Button`, [center[0], center[1], BUTTON_Z], radius, 4.2, 'Gloss_Black_Button', 36);
  if (label) textLabel(`${name}_Label_${label}`, label, [center[0], center[1] - 3, BUTTON_Z + 4.5], 7);
}

function analogStick(name, panel, center) {
  assertInsidePanel(`${name} analog stick`, panel, center, 18);
  registerFootprint(name, center, 18);
  cylinder(`${name}_Recess_Ring`, [center[0], center[1], SURFACE_Z], 17, 2.8, 'Gloss_Black_Button', 48);
  cylinder(`${name}_Stem`, [center[0], center[1], SURFACE_Z + 3.2], 10.5, 6.6, 'Rubber_Thumbstick', 40);
  cylinder(`${name}_Top_Pad`, [center[0], center[1], SURFACE_Z + 9.8], 14.5, 4.8, 'Rubber_Thumbstick', 48);
  cylinder(`${name}_Groove_Ring`, [center[0], center[1], SURFACE_Z + 14.9], 12, 0.9, 'Dark_Detail', 48);
}

function smallPill(name, origin, size, material = 'Gloss_Black_Button') {
  roundedBox(name, origin, size, Math.min(size[0], size[1]) / 2, material, { segments: 5 });
}

function registerFootprint(name, center, radius) {
  controlFootprints.push({ name, center, radius });
}

function assertInsidePanel(label, panel, [x, y], margin) {
  if (x - margin < panel.x0 || x + margin > panel.x1 || y - margin < panel.y0 || y + margin > panel.y1) {
    throw new Error(`${label} is outside ${panel.name}: center=${x},${y}, margin=${margin}`);
  }
}

function assertSeparated(clusterName, names, minGap = 2) {
  const selected = controlFootprints.filter((item) => names.includes(item.name));
  for (let i = 0; i < selected.length; i += 1) {
    for (let j = i + 1; j < selected.length; j += 1) {
      const a = selected[i];
      const b = selected[j];
      const distance = Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]);
      const required = a.radius + b.radius + minGap;
      if (distance < required) {
        throw new Error(`${clusterName} controls overlap: ${a.name} and ${b.name} distance=${distance.toFixed(2)} required=${required}`);
      }
    }
  }
}

function without(object, keys) {
  const copy = { ...object };
  for (const key of keys) delete copy[key];
  return copy;
}

add({ op: 'reset' });
mat('Warm_White_Plastic', '#e8ece8');
mat('Satin_Black_Plastic', '#111214');
mat('Gloss_Black_Button', '#050506');
mat('Rubber_Thumbstick', '#171819');
mat('Dark_Detail', '#27292c');
mat('Label_White', '#f1f1f1');

// Back grip layer: deliberately below the Joy-Con shells, so it reads as rear hardware
// instead of covering the front controls.
roundedBox('Left_Back_Grip_Lobe', [-164, -82, -14], [54, 164, 16], 27, 'Satin_Black_Plastic');
roundedBox('Right_Back_Grip_Lobe', [110, -82, -14], [54, 164, 16], 27, 'Satin_Black_Plastic');
roundedBox('Back_Lower_Bridge', [-86, -88, -12], [172, 24, 14], 8, 'Satin_Black_Plastic', { segments: 5 });

// Primary controller mass.
roundedBox('Center_Black_Switch_Grip', [-74, -76, 0], [148, 152, 18], 12, 'Satin_Black_Plastic');
roundedBox('Left_Warm_White_JoyCon_Shell', [leftPanel.x0, leftPanel.y0, 0], [62, 144, 20], 25, 'Warm_White_Plastic');
roundedBox('Right_Warm_White_JoyCon_Shell', [rightPanel.x0, rightPanel.y0, 0], [62, 144, 20], 25, 'Warm_White_Plastic');
roundedBox('Center_Front_Flat_Panel', [-58, -62, 20], [116, 124, 3], 7, 'Satin_Black_Plastic', { segments: 5 });
box('Left_Inner_Rail_Seam', [-78, -67, 20], [5, 134, 4], 'Satin_Black_Plastic');
box('Right_Inner_Rail_Seam', [73, -67, 20], [5, 134, 4], 'Satin_Black_Plastic');
box('Left_Outer_Black_Rail', [-142, -55, 16], [5, 110, 7], 'Satin_Black_Plastic');
box('Right_Outer_Black_Rail', [137, -55, 16], [5, 110, 7], 'Satin_Black_Plastic');

// Top shoulder controls are attached to the shell top edge and kept compact.
smallPill('Left_Shoulder_Button', [-128, 65, 21], [48, 13, 7]);
smallPill('Right_Shoulder_Button', [80, 65, 21], [48, 13, 7]);
smallPill('Left_Rear_Trigger_Tab', [-128, 78, 13], [48, 12, 8]);
smallPill('Right_Rear_Trigger_Tab', [80, 78, 13], [48, 12, 8]);

// Front controls, all checked against their owning panel footprint.
analogStick('Left_Analog_Stick', leftPanel, [-111, 25]);
analogStick('Right_Analog_Stick', rightPanel, [111, -38]);

roundButton('Button_X', rightPanel, [111, 38], 7.5, 'X');
roundButton('Button_Y', rightPanel, [94, 21], 7.5, 'Y');
roundButton('Button_A', rightPanel, [125, 21], 7.5, 'A');
roundButton('Button_B', rightPanel, [111, 4], 7.5, 'B');
assertSeparated('ABXY cluster', ['Button_X', 'Button_Y', 'Button_A', 'Button_B'], 4);

roundButton('Dpad_Up', leftPanel, [-111, -14], 7.5, null);
roundButton('Dpad_Left', leftPanel, [-124, -34], 7.5, null);
roundButton('Dpad_Right', leftPanel, [-98, -34], 7.5, null);
roundButton('Dpad_Down', leftPanel, [-111, -54], 7.5, null);
assertSeparated('D-pad cluster', ['Dpad_Up', 'Dpad_Left', 'Dpad_Right', 'Dpad_Down'], 4);

box('Minus_Button', [-128, 53, DETAIL_Z], [17, 4, 2.8], 'Gloss_Black_Button');
box('Plus_Button_Horizontal', [86, 53, DETAIL_Z], [17, 4, 2.8], 'Gloss_Black_Button');
box('Plus_Button_Vertical', [92.5, 46.5, DETAIL_Z + 0.1], [4, 17, 2.8], 'Gloss_Black_Button');
roundedBox('Capture_Button', [-101, -68, DETAIL_Z], [9, 9, 3], 3, 'Gloss_Black_Button', { segments: 3 });
cylinder('Home_Button', [111, -64.5, DETAIL_Z], 6.5, 3, 'Gloss_Black_Button', 28);

for (const [name, panel, center] of [
  ['Left_Top_Screw', leftPanel, [-83, 53]],
  ['Left_Bottom_Screw', leftPanel, [-83, -63]],
  ['Right_Top_Screw', rightPanel, [83, 53]],
  ['Right_Bottom_Screw', rightPanel, [83, -63]]
]) {
  assertInsidePanel(name, panel, center, 4);
  cylinder(name, [center[0], center[1], DETAIL_Z], 3, 1.8, 'Dark_Detail', 20);
}

// Center logo and rail details.
roundedBox('Switch_Logo_Left_Capsule', [-20, -8, 24], [16, 32, 1.8], 8, 'Dark_Detail', { segments: 5 });
roundedBox('Switch_Logo_Right_Capsule', [4, -8, 24], [16, 32, 1.8], 8, 'Dark_Detail', { segments: 5 });
cylinder('Switch_Logo_Left_Dot', [-12, 9, 26], 3.6, 0.8, 'Satin_Black_Plastic', 20);
cylinder('Switch_Logo_Right_Dot', [12, -1, 26], 3.6, 0.8, 'Satin_Black_Plastic', 20);
for (let index = 0; index < 8; index += 1) {
  box(`Nintendo_Text_Block_${index + 1}`, [-34 + index * 9, -38, 24.3], [5, 2, 1], 'Dark_Detail');
}
for (let index = 0; index < 6; index += 1) {
  box(`Switch_Text_Block_${index + 1}`, [-32 + index * 11, -49, 24.3], [7, 3, 1], 'Dark_Detail');
}

for (let index = 0; index < 4; index += 1) {
  box(`Left_Status_LED_${index + 1}`, [-67, -18 - index * 8, 23.8], [3, 3, 1], 'Dark_Detail');
  box(`Right_Status_LED_${index + 1}`, [64, -18 - index * 8, 23.8], [3, 3, 1], 'Dark_Detail');
}

// Review scenes.
add({ op: 'scene', name: 'Controller_Front_Reference_View', camera: { eye: [0, -420, 170], target: [0, 0, 14], up: [0, 0, 1], fov: 32 } });
add({ op: 'scene', name: 'Controller_Top_Detail_View', camera: { eye: [0, 0, 470], target: [0, 0, 8], up: [0, 1, 0], fov: 32 } });
add({ op: 'scene', name: 'Controller_Back_Grip_View', camera: { eye: [0, 330, 140], target: [0, 0, 0], up: [0, 0, 1], fov: 35 } });
add({ op: 'scene', name: 'Controller_Right_Side_Profile', camera: { eye: [430, 0, 90], target: [70, 0, 8], up: [0, 0, 1], fov: 30 } });
add({ op: 'scene', name: 'Controller_Three_Quarter_Hero', camera: { eye: [320, -360, 190], target: [0, 0, 12], up: [0, 0, 1], fov: 35 } });
add({ op: 'style', name: 'Controller_Product_Model_Check', display_edges: true, profiles: true, profile_width: 1, face_style: 'shaded_with_textures', background_color: '#f7f4ed', sky_color: '#cfe8ff', ground_color: '#d8d0bf' });
add({ op: 'shadow', display: true, time: '2026-05-11T14:35:00+08:00', light: 76, dark: 34, use_sun_for_shading: true });
add({ op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: false });
add({ op: 'camera', eye: [320, -360, 190], target: [0, 0, 12], up: [0, 0, 1], fov: 35 });

console.log(JSON.stringify({ version: 1, units: 'mm', operations: ops }, null, 2));
