const ops = [];
const r = (n) => Number(n.toFixed(1));
const v = (a) => a.map(r);
const add = (op) => ops.push(op);
const mat = (name, color, extra = {}) => add({ op: 'material', name, color, ...extra });

add({ op: 'reset' });
mat('White_PVC_Tent_Fabric', '#f4f1e8', { alpha: 0.94 });
mat('Dark_Shade_Net_Fly', '#22252a', { alpha: 0.72 });
mat('Grey_Inner_Liner', '#d7d7d2', { alpha: 0.86 });
mat('Steel_Frame_Galvanized', '#aeb5ba', { workflow: 'pbr_metallic_roughness', pbr: { metallic_factor: 0.85, roughness_factor: 0.28, ao_strength: 0.5 } });
mat('Mesh_Window_Screen', '#8da3aa', { alpha: 0.45 });
mat('Door_Dark_Opening', '#141414', { alpha: 0.78 });
mat('Black_Straps_Seams', '#171717');
mat('Groundsheet_Dark_Grey', '#4a4a45');
mat('Guy_Rope_Reflective', '#e8e2bf');
mat('Stake_Dark_Metal', '#333333');
mat('Green_Site_Ground', '#8e9d71');
mat('UNICEF_Blue_Logo_Panel', '#39a9dc');

const W = 6000;
const D = 6000;
const wallH = 2050;
const ridgeH = 3000;
const ridgeX = W / 2;
const roofOverhang = 280;
const shadeOverhang = 760;
const bay = D / 4;
const tube = 38;

function box(name, origin, size, material) {
  if (size.some((n) => n <= 0)) return;
  add({ op: 'box', name, origin: v(origin), size: v(size), material });
}
function mesh(name, vertices, faces, material, smooth = 'coplanar') {
  add({ op: 'mesh', name, vertices: vertices.map(v), faces, material, smooth });
}
function cylinder(name, origin, radius, height, material, segments = 16) {
  add({ op: 'cylinder', name, origin: v(origin), radius: r(radius), height: r(height), segments, material, smooth: 'all' });
}
function normalize(vec) {
  const len = Math.hypot(vec[0], vec[1], vec[2]);
  if (!len) return [0, 0, 1];
  return [vec[0] / len, vec[1] / len, vec[2] / len];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function tubeBetween(name, start, end, radius, material, segments = 10) {
  const axis = normalize([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
  const helper = Math.abs(axis[2]) < 0.88 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(axis, helper));
  const w = normalize(cross(axis, u));
  const vertices = [];
  const faces = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (Math.PI * 2 * i) / segments;
    const offset = [u[0] * Math.cos(a) * radius + w[0] * Math.sin(a) * radius, u[1] * Math.cos(a) * radius + w[1] * Math.sin(a) * radius, u[2] * Math.cos(a) * radius + w[2] * Math.sin(a) * radius];
    vertices.push([start[0] + offset[0], start[1] + offset[1], start[2] + offset[2]], [end[0] + offset[0], end[1] + offset[1], end[2] + offset[2]]);
  }
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    faces.push([i * 2, j * 2, j * 2 + 1], [i * 2, j * 2 + 1, i * 2 + 1]);
  }
  const startCenter = vertices.length;
  const endCenter = vertices.length + 1;
  vertices.push(start, end);
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    faces.push([startCenter, j * 2, i * 2], [endCenter, i * 2 + 1, j * 2 + 1]);
  }
  mesh(name, vertices, faces, material, 'all');
}
function swept(name, path, radius, material, segments = 10) {
  for (let i = 0; i < path.length - 1; i += 1) tubeBetween(path.length === 2 ? name : `${name}_Segment_${i + 1}`, path[i], path[i + 1], radius, material, segments);
}
function prism(name, origin, plane, points, depth, material) {
  add({ op: 'prism', name, origin: v(origin), plane, points: points.map(v), depth: r(depth), material });
}

// Ground and floor.
box('Site_Ground_Plane', [-1600, -1600, -35], [9200, 9200, 30], 'Green_Site_Ground');
box('Integrated_Groundsheet_6m_x_6m', [0, 0, 0], [W, D, 35], 'Groundsheet_Dark_Grey');

// Main tent fabric: vertical walls and gable ends from the graphic reference.
box('Left_Long_Vertical_Wall_2_05m', [0, 0, 35], [60, D, wallH], 'White_PVC_Tent_Fabric');
box('Right_Long_Vertical_Wall_2_05m', [W - 60, 0, 35], [60, D, wallH], 'White_PVC_Tent_Fabric');
box('Rear_Flat_Wall_Lower_Panel', [60, D - 60, 35], [W - 120, 60, wallH], 'White_PVC_Tent_Fabric');
mesh('Front_Gable_Wall_With_Door_Face', [[0, 0, 35], [W, 0, 35], [W, 0, wallH], [ridgeX, 0, ridgeH], [0, 0, wallH]], [[0, 1, 2], [0, 2, 4], [4, 2, 3]], 'White_PVC_Tent_Fabric');
mesh('Rear_Gable_Wall_Triangular_Face', [[0, D, 35], [W, D, 35], [W, D, wallH], [ridgeX, D, ridgeH], [0, D, wallH]], [[0, 1, 2], [0, 2, 4], [4, 2, 3]], 'White_PVC_Tent_Fabric');

// Roof planes: 6m long gabled outer tent with 3m center height.
mesh('Left_White_Roof_Plane', [[-roofOverhang, -roofOverhang, wallH], [ridgeX, -roofOverhang, ridgeH], [ridgeX, D + roofOverhang, ridgeH], [-roofOverhang, D + roofOverhang, wallH]], [[0, 1, 2], [0, 2, 3]], 'White_PVC_Tent_Fabric');
mesh('Right_White_Roof_Plane', [[ridgeX, -roofOverhang, ridgeH], [W + roofOverhang, -roofOverhang, wallH], [W + roofOverhang, D + roofOverhang, wallH], [ridgeX, D + roofOverhang, ridgeH]], [[0, 1, 2], [0, 2, 3]], 'White_PVC_Tent_Fabric');

// Dark shade net fly draped over both roof slopes and extended over the window side.
mesh('Dark_Shade_Net_Left_Roof_Fly', [[-shadeOverhang, -360, wallH + 90], [ridgeX, -360, ridgeH + 120], [ridgeX, D + 360, ridgeH + 120], [-shadeOverhang, D + 360, wallH + 90]], [[0, 1, 2], [0, 2, 3]], 'Dark_Shade_Net_Fly');
mesh('Dark_Shade_Net_Right_Roof_Fly_Extended_Awning', [[ridgeX, -360, ridgeH + 120], [W + shadeOverhang, -360, wallH + 40], [W + shadeOverhang, D + 360, wallH + 40], [ridgeX, D + 360, ridgeH + 120]], [[0, 1, 2], [0, 2, 3]], 'Dark_Shade_Net_Fly');
box('Right_Shade_Net_Drop_Valance', [W + 230, -250, wallH - 250], [70, D + 500, 360], 'Dark_Shade_Net_Fly');

// Structural steel frame: ridge, eaves, vertical posts, and repeated portal ribs.
swept('Central_Ridge_Steel_Tube', [[ridgeX, -250, ridgeH], [ridgeX, D + 250, ridgeH]], tube, 'Steel_Frame_Galvanized');
swept('Left_Eave_Steel_Tube', [[0, -250, wallH], [0, D + 250, wallH]], tube, 'Steel_Frame_Galvanized');
swept('Right_Eave_Steel_Tube', [[W, -250, wallH], [W, D + 250, wallH]], tube, 'Steel_Frame_Galvanized');
for (let i = 0; i <= 4; i += 1) {
  const y = i * bay;
  swept(`Portal_Rib_${i}_Left_Rafter`, [[0, y, wallH], [ridgeX, y, ridgeH]], 26, 'Steel_Frame_Galvanized');
  swept(`Portal_Rib_${i}_Right_Rafter`, [[ridgeX, y, ridgeH], [W, y, wallH]], 26, 'Steel_Frame_Galvanized');
  cylinder(`Portal_Rib_${i}_Left_Post`, [0, y, 35], 30, wallH, 'Steel_Frame_Galvanized');
  cylinder(`Portal_Rib_${i}_Right_Post`, [W, y, 35], 30, wallH, 'Steel_Frame_Galvanized');
}

// Front entrance: open center door with two zipped flaps.
box('Front_Dark_Door_Opening', [2425, -45, 35], [1150, 55, 1840], 'Door_Dark_Opening');
box('Front_Left_Rolled_Door_Flap', [2100, -80, 140], [310, 75, 1690], 'White_PVC_Tent_Fabric');
box('Front_Right_Rolled_Door_Flap', [3590, -80, 140], [310, 75, 1690], 'White_PVC_Tent_Fabric');
box('Front_Door_Top_Valance', [2100, -90, 1840], [1800, 90, 140], 'White_PVC_Tent_Fabric');
box('Front_Door_Zipper_Left', [2410, -110, 120], [28, 40, 1780], 'Black_Straps_Seams');
box('Front_Door_Zipper_Right', [3570, -110, 120], [28, 40, 1780], 'Black_Straps_Seams');
box('Front_Door_Center_Hanging_Strip', [2985, -120, 160], [30, 45, 1660], 'Black_Straps_Seams');

// Side windows and ventilation grates from side-view reference: 135x135 cm windows, 135x20 cm vents.
for (let i = 0; i < 3; i += 1) {
  const y = 850 + i * 1600;
  box(`Right_Window_${i + 1}_Mesh_135x135`, [W + 6, y, 460], [42, 1350, 1350], 'Mesh_Window_Screen');
  box(`Right_Window_${i + 1}_White_Frame_Top`, [W + 45, y - 20, 1810], [55, 1390, 55], 'White_PVC_Tent_Fabric');
  box(`Right_Window_${i + 1}_White_Frame_Bottom`, [W + 45, y - 20, 425], [55, 1390, 55], 'White_PVC_Tent_Fabric');
  box(`Right_Window_${i + 1}_White_Frame_Left`, [W + 45, y - 20, 425], [55, 55, 1440], 'White_PVC_Tent_Fabric');
  box(`Right_Window_${i + 1}_White_Frame_Right`, [W + 45, y + 1335, 425], [55, 55, 1440], 'White_PVC_Tent_Fabric');
  box(`Right_Vent_${i + 1}_135x20`, [W + 70, y, 1660], [55, 1350, 200], 'Mesh_Window_Screen');
  box(`Right_Raised_Awning_Flap_${i + 1}`, [W + 160, y - 40, 1870], [920, 1430, 70], 'White_PVC_Tent_Fabric');
}

// Left wall seam panels and guy attachment patches.
for (let i = 0; i <= 4; i += 1) {
  const y = i * bay;
  box(`Left_Wall_Vertical_Seam_${i}`, [-16, y - 18, 140], [36, 36, wallH - 240], 'Black_Straps_Seams');
  box(`Right_Wall_Vertical_Seam_${i}`, [W - 20, y - 18, 140], [36, 36, wallH - 240], 'Black_Straps_Seams');
}

// Top-view segmentation: four 1.5m bays visible across the roof/floor reference.
for (let i = 1; i < 4; i += 1) {
  box(`Top_View_Bay_Line_Floor_${i}`, [80, i * bay - 18, 38], [W - 160, 36, 24], 'Black_Straps_Seams');
  swept(`Roof_Bay_Seam_${i}_Left`, [[0, i * bay, wallH + 20], [ridgeX, i * bay, ridgeH + 20]], 10, 'Black_Straps_Seams', 8);
  swept(`Roof_Bay_Seam_${i}_Right`, [[ridgeX, i * bay, ridgeH + 20], [W, i * bay, wallH + 20]], 10, 'Black_Straps_Seams', 8);
}

// Guy ropes, stakes, and tension points.
const guyPoints = [
  [0, 0, wallH], [W, 0, wallH], [0, D, wallH], [W, D, wallH], [ridgeX, -120, ridgeH], [ridgeX, D + 120, ridgeH]
];
const stakePoints = [
  [-900, -950, 40], [W + 900, -950, 40], [-900, D + 950, 40], [W + 900, D + 950, 40], [ridgeX, -1250, 40], [ridgeX, D + 1250, 40]
];
for (let i = 0; i < guyPoints.length; i += 1) {
  swept(`Reflective_Guy_Rope_${i + 1}`, [guyPoints[i], stakePoints[i]], 10, 'Guy_Rope_Reflective', 8);
  cylinder(`Ground_Stake_${i + 1}`, stakePoints[i], 24, 180, 'Stake_Dark_Metal', 10);
}

// Logo/reference panel to make scale and front recognizable.
box('Front_UNICEF_Blue_Reference_Banner', [2450, -125, 2250], [1100, 35, 210], 'UNICEF_Blue_Logo_Panel');
box('Right_Blue_Reference_Label', [W + 82, 2500, 1280], [55, 920, 160], 'UNICEF_Blue_Logo_Panel');

// Lightweight dimension markers.
box('Dimension_6m_Width_Marker', [0, -1050, 20], [W, 22, 22], 'Black_Straps_Seams');
box('Dimension_6m_Depth_Marker', [-1050, 0, 20], [22, D, 22], 'Black_Straps_Seams');
box('Dimension_3m_Height_Marker', [W + 1180, -250, 0], [24, 24, ridgeH], 'Black_Straps_Seams');
box('Dimension_2_05m_Wall_Height_Marker', [W + 1380, -250, 0], [24, 24, wallH], 'Black_Straps_Seams');

add({ op: 'scene', name: 'Huggy_Pro_Front_View', camera: { eye: [3000, -9500, 1850], target: [3000, 0, 1450], up: [0, 0, 1], fov: 28 } });
add({ op: 'scene', name: 'Huggy_Pro_Right_Side_Windows', camera: { eye: [11200, 3000, 2100], target: [6000, 3000, 1450], up: [0, 0, 1], fov: 30 } });
add({ op: 'scene', name: 'Huggy_Pro_Top_View', camera: { eye: [3000, 3000, 12000], target: [3000, 3000, 0], up: [0, 1, 0], fov: 30 } });
add({ op: 'scene', name: 'Huggy_Pro_Three_Quarter', camera: { eye: [9800, -8800, 5200], target: [3000, 3000, 1500], up: [0, 0, 1], fov: 35 } });
add({ op: 'style', name: 'Tent_Product_Model_Check', display_edges: true, profiles: true, profile_width: 1, face_style: 'shaded_with_textures', background_color: '#f7f4ed', sky_color: '#cfe8ff', ground_color: '#d8d0bf' });
add({ op: 'shadow', display: true, time: '2026-05-11T13:15:00+08:00', light: 76, dark: 34, use_sun_for_shading: true });
add({ op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: true });
add({ op: 'camera', eye: [9800, -8800, 5200], target: [3000, 3000, 1500], up: [0, 0, 1], fov: 35 });

console.log(JSON.stringify({ version: 1, units: 'mm', operations: ops }, null, 2));
