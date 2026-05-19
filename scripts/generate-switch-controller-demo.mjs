const ops = [];
const r = (n) => Number(n.toFixed(2));
const v = (a) => a.map(r);
const add = (op) => ops.push(op);
const mat = (name, color, extra = {}) => add({ op: 'material', name, color, ...extra });

add({ op: 'reset' });
mat('Warm_White_Plastic', '#e8ece8', { workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.02, roughness_factor: 0.38, ao_strength: 0.45 } });
mat('Satin_Black_Plastic', '#111214', { workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.03, roughness_factor: 0.46, ao_strength: 0.65 } });
mat('Gloss_Black_Button', '#050506', { workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.02, roughness_factor: 0.18, ao_strength: 0.55 } });
mat('Rubber_Thumbstick', '#161719', { workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.01, roughness_factor: 0.75, ao_strength: 0.75 } });
mat('Dark_Engraving', '#2a2a2a');
mat('Logo_Emboss_Shadow', '#1e1f20');
mat('Tiny_Letter_White', '#d7d7d7');
mat('Table_Wood', '#d8c29f');

function box(name, origin, size, material) {
  if (size.some((n) => n <= 0)) return;
  add({ op: 'box', name, origin: v(origin), size: v(size), material });
}
function cylinder(name, origin, radius, height, material, segments = 32) {
  add({ op: 'cylinder', name, origin: v(origin), radius: r(radius), height: r(height), segments, material, smooth: 'all' });
}
function mesh(name, vertices, faces, material, smooth = 'all') {
  add({ op: 'mesh', name, vertices: vertices.map(v), faces, material, smooth });
}
function superEllipsoid(name, center, rx, ry, rz, material, rings = 12, segments = 32, power = 0.55) {
  const vertices = [];
  const faces = [];
  const sgn = (x) => (x < 0 ? -1 : 1);
  const spow = (x, p) => sgn(x) * Math.pow(Math.abs(x), p);
  for (let i = 1; i < rings; i += 1) {
    const phi = -Math.PI / 2 + (Math.PI * i) / rings;
    for (let j = 0; j < segments; j += 1) {
      const theta = (Math.PI * 2 * j) / segments;
      const x = rx * spow(Math.cos(phi), power) * spow(Math.cos(theta), power);
      const y = ry * spow(Math.cos(phi), power) * spow(Math.sin(theta), power);
      const z = rz * spow(Math.sin(phi), power);
      vertices.push([center[0] + x, center[1] + y, center[2] + z]);
    }
  }
  const bottom = vertices.length;
  vertices.push([center[0], center[1], center[2] - rz]);
  const top = vertices.length;
  vertices.push([center[0], center[1], center[2] + rz]);
  for (let j = 0; j < segments; j += 1) faces.push([bottom, (j + 1) % segments, j]);
  for (let i = 0; i < rings - 2; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * segments + j;
      const b = (i + 1) * segments + j;
      const c = i * segments + ((j + 1) % segments);
      const d = (i + 1) * segments + ((j + 1) % segments);
      faces.push([a, b, d], [a, d, c]);
    }
  }
  const last = (rings - 2) * segments;
  for (let j = 0; j < segments; j += 1) faces.push([top, last + j, last + ((j + 1) % segments)]);
  mesh(name, vertices, faces, material);
}
function roundedPanel(name, center, rx, ry, rz, material) {
  superEllipsoid(name, center, rx, ry, rz, material, 10, 32, 0.32);
}
function button(name, x, y, radius, label) {
  cylinder(`${name}_Button_Disk`, [x, y, 22], radius, 6, 'Gloss_Black_Button', 36);
  if (label) {
    box(`${name}_Letter_${label}_Stroke`, [x - 2.4, y - 1.2, 28.2], [4.8, 2.4, 0.8], 'Tiny_Letter_White');
  }
}
function thumbstick(name, x, y) {
  cylinder(`${name}_Recess_Ring`, [x, y, 20.5], 19, 3.5, 'Gloss_Black_Button', 48);
  cylinder(`${name}_Stem`, [x, y, 24], 12, 9, 'Rubber_Thumbstick', 40);
  superEllipsoid(`${name}_Concave_Top_Pad`, [x, y, 36], 18, 18, 6, 'Rubber_Thumbstick', 8, 40, 0.55);
  cylinder(`${name}_Top_Groove_Ring`, [x, y, 41], 14, 1.2, 'Dark_Engraving', 40);
  box(`${name}_Highlight_Notch`, [x - 2, y + 12, 42], [4, 6, 1], 'Dark_Engraving');
}
function seamLine(name, x, y, w, h) {
  box(name, [x, y, 26.6], [w, h, 1], 'Dark_Engraving');
}

// Table / scale reference.
box('Light_Wood_Table_Base', [-190, -115, -18], [380, 230, 14], 'Table_Wood');

// Back black grip controller, visible behind Joy-Cons in side/back photos.
superEllipsoid('Left_Back_Grip_Bulbous_Handle', [-134, -5, 1], 34, 78, 38, 'Satin_Black_Plastic', 14, 36, 0.5);
superEllipsoid('Right_Back_Grip_Bulbous_Handle', [134, -5, 1], 34, 78, 38, 'Satin_Black_Plastic', 14, 36, 0.5);
box('Back_Controller_Bridge_Bar', [-118, -78, 4], [236, 38, 34], 'Satin_Black_Plastic');
box('Back_Lower_Arch_Bridge', [-88, -88, -8], [176, 28, 25], 'Satin_Black_Plastic');
seamLine('Left_Grip_Vertical_Mold_Seam', -136, -82, 2, 128);
seamLine('Right_Grip_Vertical_Mold_Seam', 134, -82, 2, 128);

// Central Switch grip / charging bridge.
roundedPanel('Center_Black_Rectangular_Switch_Grip', [0, 0, 15], 50, 80, 18, 'Satin_Black_Plastic');
box('Center_Flat_Face_Overlay', [-48, -72, 22], [96, 144, 5], 'Satin_Black_Plastic');
box('Top_Central_Rounded_Rail_Block', [-48, 75, 23], [96, 16, 15], 'Satin_Black_Plastic');
box('Bottom_Central_Rail_Lip', [-45, -88, 21], [90, 14, 8], 'Satin_Black_Plastic');
box('Center_USB_C_Slot', [-18, -91, 26], [36, 4, 4], 'Dark_Engraving');

// Left/right white Joy-Con bodies, intentionally rounded and slightly taller than center.
roundedPanel('Left_Warm_White_JoyCon_Shell', [-94, 0, 17], 43, 86, 20, 'Warm_White_Plastic');
roundedPanel('Right_Warm_White_JoyCon_Shell', [94, 0, 17], 43, 86, 20, 'Warm_White_Plastic');
box('Left_Inner_Black_Rail_Seam', [-52, -72, 24], [5, 144, 6], 'Satin_Black_Plastic');
box('Right_Inner_Black_Rail_Seam', [47, -72, 24], [5, 144, 6], 'Satin_Black_Plastic');
box('Left_Top_White_Shoulder_Housing', [-134, 72, 22], [80, 18, 18], 'Warm_White_Plastic');
box('Right_Top_White_Shoulder_Housing', [54, 72, 22], [80, 18, 18], 'Warm_White_Plastic');

// Black curved shoulder buttons and triggers.
superEllipsoid('Left_Black_L_Shoulder_Button', [-116, 83, 35], 33, 13, 7, 'Gloss_Black_Button', 8, 28, 0.45);
superEllipsoid('Right_Black_R_Shoulder_Button', [116, 83, 35], 33, 13, 7, 'Gloss_Black_Button', 8, 28, 0.45);
box('Left_Rear_Trigger_Paddle', [-142, 44, 16], [24, 50, 22], 'Gloss_Black_Button');
box('Right_Rear_Trigger_Paddle', [118, 44, 16], [24, 50, 22], 'Gloss_Black_Button');
box('Left_Top_Black_Rail_Insert', [-122, 70, 38], [45, 10, 5], 'Gloss_Black_Button');
box('Right_Top_Black_Rail_Insert', [77, 70, 38], [45, 10, 5], 'Gloss_Black_Button');

// Thumbsticks, buttons, D-pad layout from the photos.
thumbstick('Left_Analog_Stick', -112, 24);
thumbstick('Right_Analog_Stick', 112, -24);
button('Button_X', 104, 35, 12, 'X');
button('Button_Y', 84, 14, 11, 'Y');
button('Button_A', 128, 8, 11, 'A');
button('Button_B', 106, -17, 11, 'B');
button('Dpad_Up', -108, -16, 11, 'U');
button('Dpad_Left', -131, -37, 11, 'L');
button('Dpad_Right', -87, -36, 11, 'R');
button('Dpad_Down', -110, -60, 11, 'D');

// Plus/minus, capture/home, side screws.
box('Minus_Button_Left', [-129, 47, 27], [20, 6, 3], 'Gloss_Black_Button');
box('Plus_Button_Horizontal', [80, 47, 27], [22, 6, 3], 'Gloss_Black_Button');
box('Plus_Button_Vertical', [88, 39, 27.2], [6, 22, 3], 'Gloss_Black_Button');
box('Left_Capture_Square_Button', [-103, -86, 27], [19, 19, 4], 'Gloss_Black_Button');
cylinder('Right_Home_Round_Button', [92, -82, 26.5], 11, 4, 'Gloss_Black_Button', 28);
for (const [name, x, y] of [['Left_Top_Screw', -58, 60], ['Left_Bottom_Screw', -58, -66], ['Right_Top_Screw', 58, 60], ['Right_Bottom_Screw', 58, -66]]) {
  cylinder(name, [x, y, 27], 3.5, 2, 'Dark_Engraving', 20);
}

// Center Nintendo Switch logo approximation: two rounded capsules, dots, text bars.
box('Switch_Logo_Left_Capsule', [-20, -10, 28], [17, 34, 3], 'Logo_Emboss_Shadow');
box('Switch_Logo_Right_Capsule', [5, -10, 28], [17, 34, 3], 'Logo_Emboss_Shadow');
cylinder('Switch_Logo_Left_Dot', [-11, 8, 31], 4, 2, 'Satin_Black_Plastic', 20);
cylinder('Switch_Logo_Right_Dot', [14, -2, 31], 4, 2, 'Satin_Black_Plastic', 20);
for (let i = 0; i < 8; i += 1) box(`Nintendo_Text_Bar_${i}`, [-30 + i * 8, -38, 28], [5, 2, 2], 'Logo_Emboss_Shadow');
for (let i = 0; i < 6; i += 1) box(`Switch_Text_Bar_${i}`, [-31 + i * 10, -48, 28], [7, 3, 2], 'Logo_Emboss_Shadow');

// Joy-Con indicator dots and small black side ports.
for (let i = 0; i < 4; i += 1) {
  box(`Left_Status_LED_${i + 1}`, [-57, -18 - i * 9, 28], [3, 4, 2], 'Dark_Engraving');
  box(`Right_Status_LED_${i + 1}`, [54, -18 - i * 9, 28], [3, 4, 2], 'Dark_Engraving');
}
box('Left_Side_Small_Black_Slot', [-150, 38, 20], [5, 18, 8], 'Gloss_Black_Button');
box('Right_Side_Small_Black_Slot', [145, 38, 20], [5, 18, 8], 'Gloss_Black_Button');
box('Back_Center_Two_Pin_Hole_Left', [-22, 70, 31], [9, 5, 3], 'Dark_Engraving');
box('Back_Center_Two_Pin_Hole_Right', [22, 70, 31], [9, 5, 3], 'Dark_Engraving');

// Subtle panel seams and plastic scuffs, testing fine-detail volume.
for (let i = 0; i < 9; i += 1) {
  box(`Fine_Scratch_Center_${i + 1}`, [-28 + i * 7, -4 + (i % 3) * 9, 28.4], [18, 0.8, 0.7], 'Dark_Engraving');
}
box('Left_JoyCon_Outer_Black_Edge', [-144, -61, 20], [6, 122, 13], 'Satin_Black_Plastic');
box('Right_JoyCon_Outer_Black_Edge', [138, -61, 20], [6, 122, 13], 'Satin_Black_Plastic');
box('Grip_Back_Emboss_Nintendo', [-35, -105, 5], [70, 4, 8], 'Logo_Emboss_Shadow');

add({ op: 'scene', name: 'Controller_Front_Reference_View', camera: { eye: [0, -430, 190], target: [0, 0, 18], up: [0, 0, 1], fov: 32 } });
add({ op: 'scene', name: 'Controller_Top_Detail_View', camera: { eye: [0, -35, 430], target: [0, 0, 20], up: [0, 1, 0], fov: 30 } });
add({ op: 'scene', name: 'Controller_Back_Grip_View', camera: { eye: [0, 360, 145], target: [0, -10, 8], up: [0, 0, 1], fov: 35 } });
add({ op: 'scene', name: 'Controller_Right_Side_Profile', camera: { eye: [420, 0, 120], target: [70, 0, 12], up: [0, 0, 1], fov: 30 } });
add({ op: 'scene', name: 'Controller_Three_Quarter_Hero', camera: { eye: [320, -390, 210], target: [0, 0, 20], up: [0, 0, 1], fov: 35 } });
add({ op: 'style', name: 'Controller_Product_Model_Check', display_edges: true, profiles: true, profile_width: 1, face_style: 'shaded_with_textures', background_color: '#f7f4ed', sky_color: '#cfe8ff', ground_color: '#d8d0bf' });
add({ op: 'shadow', display: true, time: '2026-05-11T14:35:00+08:00', light: 76, dark: 34, use_sun_for_shading: true });
add({ op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: true });
add({ op: 'camera', eye: [320, -390, 210], target: [0, 0, 20], up: [0, 0, 1], fov: 35 });

console.log(JSON.stringify({ version: 1, units: 'mm', operations: ops }, null, 2));
