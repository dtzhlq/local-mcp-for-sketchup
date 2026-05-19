const IN = 25.4;
const FT = 304.8;
const mm = (feet, inches = 0) => Number((feet * FT + inches * IN).toFixed(1));
const r = (n) => Number(n.toFixed(1));

const ops = [];
const add = (op) => ops.push(op);
const mat = (name, color, extra = {}) => add({ op: 'material', name, color, ...extra });

add({ op: 'reset' });
mat('Concrete_Foundation', '#b9b5ad');
mat('Beige_Vinyl_Siding', '#d8c9ad');
mat('Natural_Cedar_Shakes', '#b98b5c');
mat('White_Trim_Fascia', '#f4f1e8');
mat('Black_Asphalt_Shingle', '#242424');
mat('Blue_Window_Glass', '#86bcd3', { alpha: 0.5 });
mat('White_Entry_Door', '#eeeeee');
mat('Pressure_Treated_Wood', '#8a6848');
mat('Interior_Wood_Floor', '#c6a47c');
mat('Dark_Roof_Shadow', '#171717');
mat('Plan_Reference_Red', '#d94b4b');

const W = mm(26, 4);
const D = mm(24, 4);
const porchDepth = mm(5, 0);
const wallT = mm(0, 8);
const basementH = mm(8, 0);
const mainZ = basementH;
const floorT = mm(0, 10);
const mainWallZ = mainZ + floorT;
const mainH = mm(8, 2);
const upperZ = mainWallZ + mainH;
const upperFloorT = mm(0, 10);
const upperWallZ = upperZ + upperFloorT;
const upperH = mm(8, 0.5);
const eaveZ = upperWallZ + upperH;
const roofRise = mm(4, 0);
const roofPeakZ = eaveZ + roofRise;
const overhang = mm(1, 0);
const porchRoofRise = mm(2, 2);
const porchRoofEaveZ = upperZ - mm(0, 3);
const porchRoofPeakZ = porchRoofEaveZ + porchRoofRise;

function box(name, origin, size, material) {
  add({ op: 'box', name, origin: origin.map(r), size: size.map(r), material });
}
function panel(name, origin, plane, size, thickness, openings, material) {
  add({ op: 'panel_with_openings', name, origin: origin.map(r), plane, size: size.map(r), thickness: r(thickness), openings, material });
}
function prism(name, origin, plane, points, depth, material) {
  add({ op: 'prism', name, origin: origin.map(r), plane, points: points.map((p) => p.map(r)), depth: r(depth), material });
}
function cyl(name, origin, radius, height, material, segments = 16) {
  add({ op: 'cylinder', name, origin: origin.map(r), radius: r(radius), height: r(height), segments, material, smooth: 'all' });
}
function windowFront(name, x, z, w, h) {
  box(`${name}_Glass`, [x, -mm(0, 1), z], [w, mm(0, 1.5), h], 'Blue_Window_Glass');
  trimFrame(name, [x, -mm(0, 2), z], w, h, 'front');
}
function windowBack(name, x, z, w, h) {
  box(`${name}_Glass`, [x, D + mm(0, 0.5), z], [w, mm(0, 1.5), h], 'Blue_Window_Glass');
  trimFrame(name, [x, D + mm(0, 1), z], w, h, 'back');
}
function windowLeft(name, y, z, w, h) {
  box(`${name}_Glass`, [-mm(0, 1.5), y, z], [mm(0, 1.5), w, h], 'Blue_Window_Glass');
  sideTrimFrame(name, [-mm(0, 2), y, z], w, h, 'left');
}
function windowRight(name, y, z, w, h) {
  box(`${name}_Glass`, [W + mm(0, 0.5), y, z], [mm(0, 1.5), w, h], 'Blue_Window_Glass');
  sideTrimFrame(name, [W + mm(0, 1), y, z], w, h, 'right');
}
function trimFrame(name, origin, w, h, side) {
  const t = mm(0, 3);
  const d = mm(0, 2);
  const y = origin[1];
  box(`${name}_Top_Trim`, [origin[0] - t, y, origin[2] + h], [w + 2 * t, d, t], 'White_Trim_Fascia');
  box(`${name}_Bottom_Trim`, [origin[0] - t, y, origin[2] - t], [w + 2 * t, d, t], 'White_Trim_Fascia');
  box(`${name}_Left_Trim`, [origin[0] - t, y, origin[2] - t], [t, d, h + 2 * t], 'White_Trim_Fascia');
  box(`${name}_Right_Trim`, [origin[0] + w, y, origin[2] - t], [t, d, h + 2 * t], 'White_Trim_Fascia');
  box(`${name}_Center_Muntin`, [origin[0] + w / 2 - mm(0, 1), y - 1, origin[2]], [mm(0, 2), d + 2, h], 'White_Trim_Fascia');
  box(`${name}_Mid_Rail`, [origin[0], y - 1, origin[2] + h / 2 - mm(0, 1)], [w, d + 2, mm(0, 2)], 'White_Trim_Fascia');
}
function sideTrimFrame(name, origin, w, h) {
  const t = mm(0, 3);
  const d = mm(0, 2);
  const x = origin[0];
  box(`${name}_Top_Trim`, [x, origin[1] - t, origin[2] + h], [d, w + 2 * t, t], 'White_Trim_Fascia');
  box(`${name}_Bottom_Trim`, [x, origin[1] - t, origin[2] - t], [d, w + 2 * t, t], 'White_Trim_Fascia');
  box(`${name}_Left_Trim`, [x, origin[1] - t, origin[2] - t], [d, t, h + 2 * t], 'White_Trim_Fascia');
  box(`${name}_Right_Trim`, [x, origin[1] + w, origin[2] - t], [d, t, h + 2 * t], 'White_Trim_Fascia');
  box(`${name}_Center_Muntin`, [x - 1, origin[1] + w / 2 - mm(0, 1), origin[2]], [d + 2, mm(0, 2), h], 'White_Trim_Fascia');
}
function doorFront(name, x, z, w, h) {
  box(name, [x, -mm(0, 1), z], [w, mm(0, 2), h], 'White_Entry_Door');
  trimFrame(`${name}_Frame`, [x, -mm(0, 2), z], w, h, 'front');
  box(`${name}_Inset_Panel_Upper`, [x + w * 0.25, -mm(0, 3), z + h * 0.48], [w * 0.5, mm(0, 1), h * 0.38], 'Blue_Window_Glass');
  box(`${name}_Inset_Panel_Lower_L`, [x + w * 0.14, -mm(0, 3), z + h * 0.12], [w * 0.27, mm(0, 1), h * 0.23], 'White_Trim_Fascia');
  box(`${name}_Inset_Panel_Lower_R`, [x + w * 0.59, -mm(0, 3), z + h * 0.12], [w * 0.27, mm(0, 1), h * 0.23], 'White_Trim_Fascia');
}

// Levels and structural slabs.
add({ op: 'level', name: 'Basement', elevation: 0, height: basementH });
add({ op: 'level', name: 'Main Floor', elevation: mainZ, height: mainH });
add({ op: 'level', name: 'Upper Floor', elevation: upperZ, height: upperH });
box('Basement_4in_Concrete_Slab', [0, 0, 0], [W, D, mm(0, 4)], 'Concrete_Foundation');
box('Main_Subfloor_26ft4_by_24ft4', [0, 0, mainZ], [W, D, floorT], 'Interior_Wood_Floor');
box('Upper_Subfloor_24ft_by_24ft4', [wallT, 0, upperZ], [W - 2 * wallT, D, upperFloorT], 'Interior_Wood_Floor');

// Foundation and exterior walls with real cutouts.
panel('Foundation_Front_With_Basement_Windows', [0, 0, 0], 'xz', [W, basementH], wallT, [
  { name: 'Front_Basement_Window_Left', x: mm(3, 6), y: mm(1, 0), width: mm(4, 0), height: mm(1, 6) },
  { name: 'Front_Basement_Window_Mid', x: mm(10, 0), y: mm(1, 0), width: mm(4, 0), height: mm(1, 6) },
  { name: 'Front_Basement_Window_Right', x: mm(16, 0), y: mm(1, 0), width: mm(4, 0), height: mm(1, 6) }
], 'Concrete_Foundation');
panel('Foundation_Rear', [0, D - wallT, 0], 'xz', [W, basementH], wallT, [
  { name: 'Rear_Basement_Door', x: mm(17, 0), y: 0, width: mm(5, 0), height: mm(6, 8) }
], 'Concrete_Foundation');
panel('Foundation_Left', [0, 0, 0], 'yz', [D, basementH], wallT, [], 'Concrete_Foundation');
panel('Foundation_Right_With_Window', [W - wallT, 0, 0], 'yz', [D, basementH], wallT, [
  { name: 'Side_Basement_Window', x: mm(17, 6), y: mm(1, 0), width: mm(3, 6), height: mm(1, 8) }
], 'Concrete_Foundation');

panel('East_Front_Main_Wall_With_Door_And_Picture_Window', [0, 0, mainWallZ], 'xz', [W, mainH], wallT, [
  { name: 'Front_Entry_Door', x: mm(2, 4), y: 0, width: mm(3, 0), height: mm(6, 8) },
  { name: 'Front_Living_Triple_Window', x: mm(11, 1), y: mm(2, 4), width: mm(8, 3), height: mm(3, 6) }
], 'Beige_Vinyl_Siding');
panel('West_Rear_Main_Wall_With_Door_And_Windows', [0, D - wallT, mainWallZ], 'xz', [W, mainH], wallT, [
  { name: 'Rear_Tall_Window', x: mm(2, 3), y: mm(1, 6), width: mm(5, 0), height: mm(5, 6) },
  { name: 'Rear_Kitchen_Window', x: mm(13, 6), y: mm(3, 0), width: mm(4, 2), height: mm(3, 6) },
  { name: 'Rear_Door', x: mm(22, 0), y: 0, width: mm(3, 0), height: mm(6, 8) }
], 'Beige_Vinyl_Siding');
panel('North_Right_Main_Wall', [0, 0, mainWallZ], 'yz', [D, mainH], wallT, [
  { name: 'North_Basement_Walkout_Door_Visual', x: mm(17, 0), y: 0, width: mm(5, 0), height: mm(6, 8) }
], 'Beige_Vinyl_Siding');
panel('South_Left_Main_Wall_With_Narrow_Window', [W - wallT, 0, mainWallZ], 'yz', [D, mainH], wallT, [
  { name: 'South_Narrow_Window', x: mm(11, 4), y: mm(2, 0), width: mm(2, 0), height: mm(4, 8) }
], 'Beige_Vinyl_Siding');

panel('East_Front_Upper_Wall_Two_Windows', [0, 0, upperWallZ], 'xz', [W, upperH], wallT, [
  { name: 'Upper_Front_Left_Window', x: mm(7, 0), y: mm(2, 2), width: mm(3, 6), height: mm(3, 6) },
  { name: 'Upper_Front_Right_Window', x: mm(13, 0), y: mm(2, 2), width: mm(3, 6), height: mm(3, 6) }
], 'Beige_Vinyl_Siding');
panel('West_Rear_Upper_Wall_Windows', [0, D - wallT, upperWallZ], 'xz', [W, upperH], wallT, [
  { name: 'Upper_Rear_Double_Window', x: mm(4, 0), y: mm(2, 0), width: mm(4, 2), height: mm(4, 0) },
  { name: 'Upper_Rear_Narrow_Window', x: mm(15, 0), y: mm(2, 0), width: mm(2, 6), height: mm(4, 4) }
], 'Beige_Vinyl_Siding');
panel('North_Right_Upper_Wall_Two_Square_Windows', [0, 0, upperWallZ], 'yz', [D, upperH], wallT, [
  { name: 'North_Upper_Window_Left', x: mm(2, 6), y: mm(3, 0), width: mm(3, 0), height: mm(3, 0) },
  { name: 'North_Upper_Window_Right', x: mm(17, 8), y: mm(3, 0), width: mm(3, 0), height: mm(3, 0) }
], 'Beige_Vinyl_Siding');
panel('South_Left_Upper_Wall', [W - wallT, 0, upperWallZ], 'yz', [D, upperH], wallT, [], 'Beige_Vinyl_Siding');

// Visible windows/doors and trim, matching the elevation sheets.
doorFront('Front_3ft_Entry_Door', mm(2, 4), mainWallZ, mm(3, 0), mm(6, 8));
windowFront('Front_Living_Triple_Window', mm(11, 1), mainWallZ + mm(2, 4), mm(8, 3), mm(3, 6));
windowFront('Upper_Front_Left_Window', mm(7, 0), upperWallZ + mm(2, 2), mm(3, 6), mm(3, 6));
windowFront('Upper_Front_Right_Window', mm(13, 0), upperWallZ + mm(2, 2), mm(3, 6), mm(3, 6));
windowBack('Rear_Tall_Window', mm(2, 3), mainWallZ + mm(1, 6), mm(5, 0), mm(5, 6));
windowBack('Rear_Kitchen_Window', mm(13, 6), mainWallZ + mm(3, 0), mm(4, 2), mm(3, 6));
box('Rear_White_Door', [mm(22, 0), D + mm(0, 0.5), mainWallZ], [mm(3, 0), mm(0, 2), mm(6, 8)], 'White_Entry_Door');
windowBack('Upper_Rear_Double_Window', mm(4, 0), upperWallZ + mm(2, 0), mm(4, 2), mm(4, 0));
windowBack('Upper_Rear_Narrow_Window', mm(15, 0), upperWallZ + mm(2, 0), mm(2, 6), mm(4, 4));
windowLeft('North_Upper_Window_Left', mm(2, 6), upperWallZ + mm(3, 0), mm(3, 0), mm(3, 0));
windowLeft('North_Upper_Window_Right', mm(17, 8), upperWallZ + mm(3, 0), mm(3, 0), mm(3, 0));
windowRight('South_Narrow_Window', mm(11, 4), mainWallZ + mm(2, 0), mm(2, 0), mm(4, 8));

// Porch, railing, posts, steps and front bay massing.
box('Wood_Porch_5ft_Depth', [0, -porchDepth, mainZ - mm(0, 2)], [W, porchDepth, mm(0, 8)], 'Pressure_Treated_Wood');
box('Porch_Front_Railing', [mm(6, 2), -porchDepth, mainZ + mm(2, 2)], [mm(17, 10), mm(0, 3), mm(3, 0)], 'Pressure_Treated_Wood');
box('Porch_Left_Side_Railing', [0, -porchDepth, mainZ + mm(2, 2)], [mm(0, 3), porchDepth, mm(3, 0)], 'Pressure_Treated_Wood');
for (const [name, x] of [['Left', 0], ['Mid', mm(11, 3)], ['Right', W - mm(0, 8)]]) {
  cyl(`Turned_Porch_Post_${name}`, [x + mm(0, 4), -porchDepth + mm(0, 4), mainZ], mm(0, 3.2), upperZ - mainZ, 'White_Trim_Fascia', 16);
  box(`Porch_Post_Base_${name}`, [x + mm(0, 1), -porchDepth + mm(0, 1), mainZ], [mm(0, 6), mm(0, 6), mm(1, 2)], 'White_Trim_Fascia');
  box(`Porch_Post_Capital_${name}`, [x + mm(0, 1), -porchDepth + mm(0, 1), upperZ - mm(0, 10)], [mm(0, 6), mm(0, 6), mm(0, 10)], 'White_Trim_Fascia');
}
for (let i = 0; i < 6; i += 1) {
  box(`Front_Wood_Step_${i + 1}`, [mm(2, 8), -porchDepth - mm(0, 11) * (i + 1), mainZ - mm(0, 2) - mm(0, 6) * (i + 1)], [mm(8, 0), mm(0, 11), mm(0, 6)], 'Pressure_Treated_Wood');
}

// Main 4:12 gable roof, cedar gables, porch 6:12 hip/gable roof.
prism('Main_4_12_Gable_Roof_From_Roof_Plan', [-overhang, -overhang, eaveZ], 'xz', [
  [0, 0], [W / 2 + overhang, roofRise], [W + 2 * overhang, 0]
], D + 2 * overhang, 'Black_Asphalt_Shingle');
box('Front_White_6in_Fascia', [-overhang, -overhang - mm(0, 1), eaveZ - mm(0, 6)], [W + 2 * overhang, mm(0, 3), mm(0, 8)], 'White_Trim_Fascia');
box('Rear_White_6in_Fascia', [-overhang, D + overhang - mm(0, 2), eaveZ - mm(0, 6)], [W + 2 * overhang, mm(0, 3), mm(0, 8)], 'White_Trim_Fascia');
prism('Front_Cedar_Shake_Gable_Triangle', [0, -mm(0, 2), eaveZ], 'xz', [[0, 0], [W / 2, roofRise - mm(0, 8)], [W, 0]], mm(0, 2), 'Natural_Cedar_Shakes');
prism('Rear_Cedar_Shake_Gable_Triangle', [0, D, eaveZ], 'xz', [[0, 0], [W / 2, roofRise - mm(0, 8)], [W, 0]], mm(0, 2), 'Natural_Cedar_Shakes');
prism('Porch_6_12_Front_Gable_Roof', [-overhang, -porchDepth - overhang, porchRoofEaveZ], 'xz', [
  [0, 0], [mm(5, 6), porchRoofRise], [mm(11, 0), 0]
], porchDepth + overhang * 2, 'Black_Asphalt_Shingle');
box('Porch_Roof_Right_Shed_Wing', [mm(10, 8), -porchDepth - overhang, porchRoofEaveZ], [W - mm(10, 8) + overhang, porchDepth + overhang * 2, mm(0, 6)], 'Black_Asphalt_Shingle');
prism('Porch_Cedar_Shake_Gable_Face', [0, -porchDepth - overhang - mm(0, 2), porchRoofEaveZ], 'xz', [[0, 0], [mm(5, 6), porchRoofRise - mm(0, 3)], [mm(11, 0), 0]], mm(0, 2), 'Natural_Cedar_Shakes');
box('Porch_White_Fascia', [-overhang, -porchDepth - overhang - mm(0, 1), porchRoofEaveZ - mm(0, 4)], [W + overhang * 2, mm(0, 3), mm(0, 8)], 'White_Trim_Fascia');

// Siding and cedar shake cues: sparse enough for the queue plugin limit, but still readable.
for (let z = mainWallZ + mm(1, 0), i = 1; z < eaveZ - mm(1, 0); z += mm(1, 0), i += 1) {
  box(`Front_Sparse_Vinyl_Siding_Course_${String(i).padStart(2, '0')}`, [0, -mm(0, 1.5), z], [W, mm(0, 1), mm(0, 0.8)], 'White_Trim_Fascia');
}
for (let i = 0; i < 10; i += 1) {
  const x = (W / 10) * i;
  box(`Front_Gable_Cedar_Shake_Batten_${String(i + 1).padStart(2, '0')}`, [x, -mm(0, 3), eaveZ + mm(0, 4) + (i % 3) * mm(0, 3)], [mm(0, 2), mm(0, 1), roofRise - mm(1, 0)], 'White_Trim_Fascia');
}

// Interior layout from main/upper plans: stairs, kitchen block, baths, bedrooms.
box('Main_Stair_Run_15R_From_Plan', [mm(3, 5), mm(4, 0), mainZ + floorT], [mm(3, 5), mm(9, 10), mm(0, 5)], 'Pressure_Treated_Wood');
for (let i = 0; i < 15; i += 1) {
  box(`Main_Stair_Tread_${String(i + 1).padStart(2, '0')}`, [mm(3, 5), mm(4, 0) + i * mm(0, 7.8), mainZ + floorT + i * ((upperZ - mainZ - floorT) / 15)], [mm(3, 5), mm(0, 8), mm(0, 2)], 'Pressure_Treated_Wood');
}
box('Kitchen_Cabinet_L_Run', [mm(8, 0), mm(4, 2), mainZ + floorT], [mm(1, 10), mm(7, 0), mm(3, 0)], 'White_Trim_Fascia');
box('Kitchen_Island_From_Plan', [mm(13, 2), mm(6, 4), mainZ + floorT], [mm(3, 0), mm(6, 0), mm(3, 0)], 'White_Trim_Fascia');
box('Main_Bath_Volume', [mm(2, 4), mm(13, 8), mainZ + floorT], [mm(4, 4), mm(4, 0), mm(7, 0)], 'White_Trim_Fascia');
box('Upper_Master_Bedroom_Label_Block', [mm(12, 4), mm(12, 0), upperZ + upperFloorT], [mm(11, 7), mm(12, 3), mm(0, 2)], 'Plan_Reference_Red');
box('Upper_Bedroom2_Label_Block', [mm(12, 4), mm(1, 0), upperZ + upperFloorT], [mm(11, 7), mm(10, 9), mm(0, 2)], 'Plan_Reference_Red');

// Detached garage sheet 26: 16' x 20', placed to the rear-right as a separate mass.
const gX = W + mm(8, 0);
const gY = mm(2, 0);
const gW = mm(16, 0);
const gD = mm(20, 0);
const gH = mm(9, 6);
box('Detached_Garage_4in_Slab', [gX, gY, 0], [gW, gD, mm(0, 4)], 'Concrete_Foundation');
panel('Detached_Garage_Front_With_10x8_Door', [gX, gY, mm(0, 4)], 'xz', [gW, gH], wallT, [
  { name: 'Garage_10x8_Overhead_Door', x: mm(3, 0), y: 0, width: mm(10, 0), height: mm(8, 0) }
], 'Beige_Vinyl_Siding');
panel('Detached_Garage_Rear_Wall', [gX, gY + gD - wallT, mm(0, 4)], 'xz', [gW, gH], wallT, [], 'Beige_Vinyl_Siding');
panel('Detached_Garage_Left_Wall', [gX, gY, mm(0, 4)], 'yz', [gD, gH], wallT, [], 'Beige_Vinyl_Siding');
panel('Detached_Garage_Right_Wall_With_Door', [gX + gW - wallT, gY, mm(0, 4)], 'yz', [gD, gH], wallT, [
  { name: 'Garage_3ft_Man_Door', x: mm(9, 6), y: 0, width: mm(3, 0), height: mm(7, 8) }
], 'Beige_Vinyl_Siding');
box('Garage_10x8_Overhead_Door_Panel', [gX + mm(3, 0), gY - mm(0, 1), mm(0, 4)], [mm(10, 0), mm(0, 2), mm(8, 0)], 'White_Entry_Door');
prism('Detached_Garage_4_12_Roof', [gX - overhang, gY - overhang, mm(0, 4) + gH], 'xz', [[0, 0], [gW / 2 + overhang, mm(2, 8)], [gW + 2 * overhang, 0]], gD + 2 * overhang, 'Black_Asphalt_Shingle');

add({ op: 'style', name: 'Architectural_Drawing_Check', display_edges: true, profiles: true, profile_width: 1, face_style: 'shaded_with_textures', background_color: '#f7f4ed', sky_color: '#cfe8ff', ground_color: '#d8d0bf' });
add({ op: 'shadow', display: true, time: '2026-05-09T10:45:00+08:00', light: 78, dark: 35, use_sun_for_shading: true });
add({ op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: true });
add({ op: 'scene', name: 'Calgary_Front_Elevation_Check', camera: { eye: [W / 2, -mm(45, 0), mm(18, 0)], target: [W / 2, 0, mm(12, 0)], up: [0, 0, 1], fov: 28 } });
add({ op: 'scene', name: 'Calgary_Three_Quarter_With_Garage', camera: { eye: [W + mm(28, 0), -mm(36, 0), mm(22, 0)], target: [W / 2, D / 2, mm(9, 0)], up: [0, 0, 1], fov: 35 } });
add({ op: 'camera', eye: [W + mm(28, 0), -mm(36, 0), mm(22, 0)], target: [W / 2, D / 2, mm(9, 0)], up: [0, 0, 1], fov: 35 });

console.log(JSON.stringify({ version: 1, units: 'mm', operations: ops }, null, 2));
