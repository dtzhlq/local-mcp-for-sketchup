const IN = 25.4;
const FT = 304.8;
const mm = (feet, inches = 0) => Number((feet * FT + inches * IN).toFixed(1));
const r = (n) => Number(n.toFixed(1));
const v = (a) => a.map(r);

const ops = [];
const add = (op) => ops.push(op);
const mat = (name, color, extra = {}) => add({ op: 'material', name, color, ...extra });

add({ op: 'reset' });
mat('Concrete', '#b8b5ad');
mat('Exterior_Beige_Vinyl_Siding', '#d8c8aa');
mat('Interior_Drywall', '#eee8dc');
mat('Cedar_Shakes', '#b88755');
mat('White_Trim', '#f5f2ea');
mat('Black_Asphalt_Shingle', '#242424');
mat('Glass_Blue', '#83bad3', { alpha: 0.48 });
mat('White_Door', '#eeeeee');
mat('Wood_Deck', '#8a6848');
mat('Room_Plan_Tint', '#d95050', { alpha: 0.18 });
mat('Kitchen_Cabinets', '#f2eee4');
mat('Plumbing_Fixtures', '#f7f7f4');

// Coordinate system fixed from the PDF plans:
// X = left/right across the floor plan, Y = bottom-to-top on the floor plan.
// The PDF labels the bottom elevation as EAST ELEVATION (FRONT), so model Y=0 is the east/front facade.
const W = mm(26, 4);
const D = mm(24, 4);
const porchD = mm(5, 0);
const wallT = mm(0, 8);
const intT = mm(0, 5);
const basementH = mm(8, 0);
const floorT = mm(0, 10);
const mainZ = basementH;
const mainWallZ = mainZ + floorT;
const mainH = mm(8, 2);
const upperFloorZ = mainWallZ + mainH;
const upperWallZ = upperFloorZ + floorT;
const upperH = mm(8, 0.5);
const eaveZ = upperWallZ + upperH;
const roofRise = mm(4, 0);
const overhang = mm(1, 0);
const trimDepth = mm(0, 2);

function box(name, origin, size, material) {
  if (size.some((n) => n <= 0)) return;
  add({ op: 'box', name, origin: v(origin), size: v(size), material });
}
function panel(name, origin, plane, size, thickness, openings, material) {
  add({ op: 'panel_with_openings', name, origin: v(origin), plane, size: v(size), thickness: r(thickness), openings: openings.map((o) => ({ ...o, x: r(o.x), y: r(o.y), width: r(o.width), height: r(o.height) })), material });
}
function prism(name, origin, plane, points, depth, material) {
  add({ op: 'prism', name, origin: v(origin), plane, points: points.map(v), depth: r(depth), material });
}
function cyl(name, origin, radius, height, material, segments = 16) {
  add({ op: 'cylinder', name, origin: v(origin), radius: r(radius), height: r(height), segments, material, smooth: 'all' });
}
function hWall(name, x1, x2, y, z, h, material = 'Interior_Drywall', t = intT) {
  box(name, [x1, y - t / 2, z], [x2 - x1, t, h], material);
}
function vWall(name, x, y1, y2, z, h, material = 'Interior_Drywall', t = intT) {
  box(name, [x - t / 2, y1, z], [t, y2 - y1, h], material);
}
function hWallWithGap(prefix, x1, x2, y, z, h, gaps, material = 'Interior_Drywall') {
  let cursor = x1;
  let part = 1;
  for (const [gapA, gapB] of gaps.sort((a, b) => a[0] - b[0])) {
    hWall(`${prefix}_Part_${part++}`, cursor, gapA, y, z, h, material);
    cursor = gapB;
  }
  hWall(`${prefix}_Part_${part++}`, cursor, x2, y, z, h, material);
}
function vWallWithGap(prefix, x, y1, y2, z, h, gaps, material = 'Interior_Drywall') {
  let cursor = y1;
  let part = 1;
  for (const [gapA, gapB] of gaps.sort((a, b) => a[0] - b[0])) {
    vWall(`${prefix}_Part_${part++}`, x, cursor, gapA, z, h, material);
    cursor = gapB;
  }
  vWall(`${prefix}_Part_${part++}`, x, cursor, y2, z, h, material);
}
function frontWindow(name, x, z, w, h) {
  box(`${name}_Glass`, [x, -trimDepth, z], [w, trimDepth, h], 'Glass_Blue');
  frontTrim(name, x, z, w, h, -trimDepth * 1.5);
}
function rearWindow(name, x, z, w, h) {
  box(`${name}_Glass`, [x, D, z], [w, trimDepth, h], 'Glass_Blue');
  frontTrim(name, x, z, w, h, D + trimDepth);
}
function sideWindow(name, side, y, z, w, h) {
  const x = side === 'left' ? -trimDepth : W;
  box(`${name}_Glass`, [x, y, z], [trimDepth, w, h], 'Glass_Blue');
  const t = mm(0, 3);
  const d = trimDepth;
  box(`${name}_Top_Trim`, [x, y - t, z + h], [d, w + 2 * t, t], 'White_Trim');
  box(`${name}_Bottom_Trim`, [x, y - t, z - t], [d, w + 2 * t, t], 'White_Trim');
  box(`${name}_Left_Trim`, [x, y - t, z - t], [d, t, h + 2 * t], 'White_Trim');
  box(`${name}_Right_Trim`, [x, y + w, z - t], [d, t, h + 2 * t], 'White_Trim');
}
function frontTrim(name, x, z, w, h, y) {
  const t = mm(0, 3);
  const d = trimDepth;
  box(`${name}_Top_Trim`, [x - t, y, z + h], [w + 2 * t, d, t], 'White_Trim');
  box(`${name}_Bottom_Trim`, [x - t, y, z - t], [w + 2 * t, d, t], 'White_Trim');
  box(`${name}_Left_Trim`, [x - t, y, z - t], [t, d, h + 2 * t], 'White_Trim');
  box(`${name}_Right_Trim`, [x + w, y, z - t], [t, d, h + 2 * t], 'White_Trim');
  box(`${name}_Mid_Rail`, [x, y, z + h / 2], [w, d, mm(0, 1.5)], 'White_Trim');
}
function frontDoor(name, x, z, w, h) {
  box(name, [x, -trimDepth, z], [w, trimDepth, h], 'White_Door');
  frontTrim(`${name}_Trim`, x, z, w, h, -trimDepth * 1.5);
  box(`${name}_Upper_Glass`, [x + w * 0.25, -trimDepth * 2, z + h * 0.48], [w * 0.5, trimDepth, h * 0.38], 'Glass_Blue');
  box(`${name}_Lower_Left_Panel`, [x + w * 0.13, -trimDepth * 2, z + h * 0.12], [w * 0.28, trimDepth, h * 0.22], 'White_Trim');
  box(`${name}_Lower_Right_Panel`, [x + w * 0.59, -trimDepth * 2, z + h * 0.12], [w * 0.28, trimDepth, h * 0.22], 'White_Trim');
}
function roomTint(name, x, y, w, d, z) {
  box(name, [x, y, z], [w, d, mm(0, 1)], 'Room_Plan_Tint');
}

add({ op: 'level', name: 'Basement', elevation: 0, height: basementH });
add({ op: 'level', name: 'Main Floor', elevation: mainZ, height: mainH });
add({ op: 'level', name: 'Upper Floor', elevation: upperFloorZ, height: upperH });

// Basement/foundation and floor decks.
box('Basement_Concrete_Slab_26ft4_by_24ft4', [0, 0, 0], [W, D, mm(0, 4)], 'Concrete');
panel('Foundation_East_Front_With_Three_Windows', [0, -wallT, 0], 'xz', [W, basementH], wallT, [
  { name: 'Front_Basement_Left', x: mm(3, 6), y: mm(1, 0), width: mm(4, 0), height: mm(1, 6) },
  { name: 'Front_Basement_Middle', x: mm(10, 1), y: mm(1, 0), width: mm(4, 0), height: mm(1, 6) },
  { name: 'Front_Basement_Right', x: mm(16, 1), y: mm(1, 0), width: mm(4, 0), height: mm(1, 6) }
], 'Concrete');
panel('Foundation_West_Rear_With_Walkout', [0, D, 0], 'xz', [W, basementH], wallT, [
  { name: 'Rear_Basement_Walkout_Door', x: mm(17, 8), y: 0, width: mm(5, 0), height: mm(6, 8) }
], 'Concrete');
panel('Foundation_North_Right', [W, 0, 0], 'yz', [D, basementH], wallT, [], 'Concrete');
panel('Foundation_South_Left', [-wallT, 0, 0], 'yz', [D, basementH], wallT, [], 'Concrete');
box('Main_Subfloor_From_Plan', [0, 0, mainZ], [W, D, floorT], 'Wood_Deck');
box('Upper_Subfloor_From_Plan', [mm(1, 0), 0, upperFloorZ], [mm(24, 0), D, floorT], 'Wood_Deck');

// Exterior walls. East/front is the porch elevation from PDF page 05.
panel('Main_East_Front_Wall_Porch_Elevation', [0, -wallT, mainWallZ], 'xz', [W, mainH], wallT, [
  { name: 'Front_Entry_Door', x: mm(3, 0), y: 0, width: mm(3, 0), height: mm(6, 8) },
  { name: 'Front_Living_Window', x: mm(11, 1), y: mm(2, 6), width: mm(8, 3), height: mm(3, 8) }
], 'Exterior_Beige_Vinyl_Siding');
panel('Main_West_Rear_Wall', [0, D, mainWallZ], 'xz', [W, mainH], wallT, [
  { name: 'Rear_Large_Window', x: mm(2, 4), y: mm(1, 8), width: mm(5, 0), height: mm(5, 4) },
  { name: 'Rear_Kitchen_Window', x: mm(13, 7), y: mm(3, 0), width: mm(4, 2), height: mm(3, 6) },
  { name: 'Rear_Door', x: mm(22, 1), y: 0, width: mm(3, 0), height: mm(6, 8) }
], 'Exterior_Beige_Vinyl_Siding');
panel('Main_North_Right_Wall', [W, 0, mainWallZ], 'yz', [D, mainH], wallT, [], 'Exterior_Beige_Vinyl_Siding');
panel('Main_South_Left_Wall_Narrow_Window', [-wallT, 0, mainWallZ], 'yz', [D, mainH], wallT, [
  { name: 'Left_Side_Narrow_Window', x: mm(11, 3), y: mm(2, 0), width: mm(2, 0), height: mm(4, 8) }
], 'Exterior_Beige_Vinyl_Siding');

panel('Upper_East_Front_Wall_Two_Bedroom_Windows', [0, -wallT, upperWallZ], 'xz', [W, upperH], wallT, [
  { name: 'Front_Upper_Left_Window', x: mm(7, 0), y: mm(2, 2), width: mm(3, 6), height: mm(3, 6) },
  { name: 'Front_Upper_Right_Window', x: mm(13, 1), y: mm(2, 2), width: mm(3, 6), height: mm(3, 6) }
], 'Exterior_Beige_Vinyl_Siding');
panel('Upper_West_Rear_Wall', [0, D, upperWallZ], 'xz', [W, upperH], wallT, [
  { name: 'Rear_Upper_Double_Window', x: mm(4, 0), y: mm(2, 0), width: mm(4, 2), height: mm(4, 0) },
  { name: 'Rear_Upper_Narrow_Window', x: mm(15, 1), y: mm(2, 0), width: mm(2, 6), height: mm(4, 4) }
], 'Exterior_Beige_Vinyl_Siding');
panel('Upper_North_Right_Wall_Two_Windows', [W, 0, upperWallZ], 'yz', [D, upperH], wallT, [
  { name: 'Right_Upper_Rear_Window', x: mm(3, 0), y: mm(3, 0), width: mm(3, 0), height: mm(3, 0) },
  { name: 'Right_Upper_Front_Window', x: mm(17, 8), y: mm(3, 0), width: mm(3, 0), height: mm(3, 0) }
], 'Exterior_Beige_Vinyl_Siding');
panel('Upper_South_Left_Wall', [-wallT, 0, upperWallZ], 'yz', [D, upperH], wallT, [], 'Exterior_Beige_Vinyl_Siding');

// Main floor interior traced from page 10.
const mz = mainZ + floorT;
const ih = mainH - mm(0, 6);
// Rear stair/kitchen block and center beam/wall line.
vWallWithGap('Main_Stair_Left_Wall', mm(2, 4), mm(4, 0), mm(13, 10), mz, ih, [[mm(11, 0), mm(12, 8)]]);
vWall('Main_Stair_Kitchen_Party_Wall', mm(6, 0), mm(4, 0), mm(13, 10), mz, ih);
hWallWithGap('Main_Kitchen_Living_Dividing_Wall', mm(2, 4), W, mm(13, 10), mz, ih, [[mm(6, 0), mm(8, 8)], [mm(11, 8), mm(13, 2)]]);
hWall('Main_Rear_Stair_Closure', mm(2, 4), mm(6, 0), mm(4, 0), mz, ih);
// Bath and entry partitions.
vWallWithGap('Main_Bath_Left_Wall', mm(2, 4), mm(14, 0), mm(20, 4), mz, ih, [[mm(17, 2), mm(18, 0)]]);
vWall('Main_Bath_Right_Wall', mm(6, 8), mm(14, 0), mm(20, 4), mz, ih);
hWallWithGap('Main_Bath_Top_Wall', mm(2, 4), mm(6, 8), mm(20, 4), mz, ih, [[mm(3, 5), mm(5, 7)]]);
hWall('Main_Bath_Bottom_Wall', mm(2, 4), mm(6, 8), mm(14, 0), mz, ih);
vWall('Main_Entry_Closet_Wall', mm(2, 4), mm(20, 4), mm(24, 4), mz, ih);
hWallWithGap('Main_Front_Entry_Internal_Wall', mm(0, 8), mm(6, 8), mm(20, 4), mz, ih, [[mm(3, 0), mm(5, 6)]]);
// Tall room reference slabs help visually verify layout without pretending to be walls.
roomTint('Main_Kitchen_10ft2_by_11ft6_Area', mm(6, 0), mm(4, 0), mm(10, 2), mm(11, 6), mz + mm(0, 1));
roomTint('Main_Nook_9ft1_by_11ft6_Area', mm(16, 6), mm(4, 0), mm(9, 1), mm(11, 6), mz + mm(0, 1));
roomTint('Main_Living_17ft_by_11ft6_Area', mm(8, 6), mm(13, 10), mm(17, 0), mm(10, 0), mz + mm(0, 1));

// Upper floor interior traced from page 11.
const uz = upperFloorZ + floorT;
const uh = upperH - mm(0, 6);
vWall('Upper_Stair_Right_Wall', mm(6, 0), mm(0, 0), mm(8, 9), uz, uh);
hWall('Upper_Stair_Front_Wall', mm(0, 8), mm(6, 0), mm(8, 9), uz, uh);
vWallWithGap('Upper_Bedroom_Left_Corridor_Wall', mm(12, 0), mm(0, 0), D, uz, uh, [[mm(6, 4), mm(8, 8)], [mm(12, 1), mm(14, 3)]]);
hWall('Upper_Bedrooms_Dividing_Wall', mm(12, 0), W, mm(10, 9), uz, uh);
hWallWithGap('Upper_Bath_Corridor_Wall', mm(0, 8), mm(12, 0), mm(13, 0), uz, uh, [[mm(6, 6), mm(8, 4)]]);
vWall('Upper_Bath_Stack_Wall', mm(6, 2), mm(8, 9), D, uz, uh);
hWallWithGap('Upper_Front_Bath_Top_Wall', mm(0, 8), mm(6, 2), mm(18, 0), uz, uh, [[mm(2, 8), mm(4, 8)]]);
roomTint('Upper_Master_Bedroom_11ft7_by_12ft3', mm(12, 0), mm(10, 9), mm(11, 7), mm(12, 3), uz + mm(0, 1));
roomTint('Upper_Bedroom2_11ft7_by_10ft9', mm(12, 0), 0, mm(11, 7), mm(10, 9), uz + mm(0, 1));

// Stairs, kitchen, baths — simple physical markers aligned with rooms.
for (let i = 0; i < 15; i += 1) {
  box(`Main_Stair_Tread_${String(i + 1).padStart(2, '0')}`, [mm(2, 7), mm(4, 2) + i * mm(0, 7.5), mz + i * ((upperFloorZ - mz) / 15)], [mm(3, 2), mm(0, 7), mm(0, 2)], 'Wood_Deck');
}
box('Kitchen_L_Shaped_Cabinet_Back_Run', [mm(6, 2), mm(4, 2), mz], [mm(1, 10), mm(7, 0), mm(3, 0)], 'Kitchen_Cabinets');
box('Kitchen_Island_From_Plan', [mm(13, 1), mm(6, 2), mz], [mm(3, 0), mm(5, 6), mm(3, 0)], 'Kitchen_Cabinets');
box('Main_Bath_Tub', [mm(2, 8), mm(17, 1), mz], [mm(2, 6), mm(1, 4), mm(1, 8)], 'Plumbing_Fixtures');
box('Upper_Bath_Tub_Rear', [mm(1, 0), mm(9, 6), uz], [mm(2, 8), mm(1, 5), mm(1, 8)], 'Plumbing_Fixtures');
box('Upper_Bath_Tub_Front', [mm(1, 0), mm(18, 7), uz], [mm(3, 0), mm(1, 5), mm(1, 8)], 'Plumbing_Fixtures');

// Openings represented with visible doors/windows/trim.
frontDoor('East_Front_Entry_Door_3x68', mm(3, 0), mainWallZ, mm(3, 0), mm(6, 8));
frontWindow('East_Front_Living_Triple_Window', mm(11, 1), mainWallZ + mm(2, 6), mm(8, 3), mm(3, 8));
frontWindow('East_Upper_Left_Window', mm(7, 0), upperWallZ + mm(2, 2), mm(3, 6), mm(3, 6));
frontWindow('East_Upper_Right_Window', mm(13, 1), upperWallZ + mm(2, 2), mm(3, 6), mm(3, 6));
rearWindow('West_Rear_Large_Window', mm(2, 4), mainWallZ + mm(1, 8), mm(5, 0), mm(5, 4));
rearWindow('West_Rear_Kitchen_Window', mm(13, 7), mainWallZ + mm(3, 0), mm(4, 2), mm(3, 6));
rearWindow('West_Upper_Double_Window', mm(4, 0), upperWallZ + mm(2, 0), mm(4, 2), mm(4, 0));
rearWindow('West_Upper_Narrow_Window', mm(15, 1), upperWallZ + mm(2, 0), mm(2, 6), mm(4, 4));
sideWindow('North_Right_Upper_Rear_Window', 'right', mm(3, 0), upperWallZ + mm(3, 0), mm(3, 0), mm(3, 0));
sideWindow('North_Right_Upper_Front_Window', 'right', mm(17, 8), upperWallZ + mm(3, 0), mm(3, 0), mm(3, 0));
sideWindow('South_Left_Main_Narrow_Window', 'left', mm(11, 3), mainWallZ + mm(2, 0), mm(2, 0), mm(4, 8));

// Porch, posts, rails, stairs — front/east side only.
box('East_Wood_Porch_And_Deck_5ft_Depth', [0, -porchD, mainZ - mm(0, 2)], [W, porchD, mm(0, 8)], 'Wood_Deck');
for (const [name, x] of [['Left', mm(0, 6)], ['Center', mm(11, 3)], ['Right', W - mm(0, 10)]]) {
  cyl(`East_Porch_Turned_Post_${name}`, [x, -porchD + mm(0, 5), mainZ], mm(0, 3), upperFloorZ - mainZ, 'White_Trim', 18);
  box(`East_Porch_Post_Base_${name}`, [x - mm(0, 3), -porchD + mm(0, 2), mainZ], [mm(0, 6), mm(0, 6), mm(1, 2)], 'White_Trim');
}
box('East_Porch_Front_Railing', [mm(6, 4), -porchD, mainZ + mm(2, 2)], [mm(17, 8), mm(0, 3), mm(3, 0)], 'Wood_Deck');
for (let i = 0; i < 6; i += 1) {
  box(`East_Front_Wood_Step_${i + 1}`, [mm(2, 8), -porchD - mm(0, 11) * (i + 1), mainZ - mm(0, 2) - mm(0, 6) * (i + 1)], [mm(8, 0), mm(0, 11), mm(0, 6)], 'Wood_Deck');
}

// Roof plan: main 4:12 gable runs front/rear; porch roof uses 6:12 front gable plus lower shed wing.
prism('Main_4_12_Gable_Roof_Ridge_Front_To_Rear', [-overhang, -overhang, eaveZ], 'xz', [[0, 0], [W / 2 + overhang, roofRise], [W + 2 * overhang, 0]], D + 2 * overhang, 'Black_Asphalt_Shingle');
prism('East_Front_Cedar_Shake_Gable', [0, -wallT - trimDepth, eaveZ], 'xz', [[0, 0], [W / 2, roofRise - mm(0, 8)], [W, 0]], trimDepth, 'Cedar_Shakes');
prism('West_Rear_Cedar_Shake_Gable', [0, D + wallT, eaveZ], 'xz', [[0, 0], [W / 2, roofRise - mm(0, 8)], [W, 0]], trimDepth, 'Cedar_Shakes');
box('Main_East_White_6in_Fascia', [-overhang, -overhang - trimDepth, eaveZ - mm(0, 6)], [W + 2 * overhang, trimDepth, mm(0, 8)], 'White_Trim');
box('Main_West_White_6in_Fascia', [-overhang, D + overhang, eaveZ - mm(0, 6)], [W + 2 * overhang, trimDepth, mm(0, 8)], 'White_Trim');
const porchRoofEave = upperFloorZ - mm(0, 3);
const porchRoofRise = mm(2, 2);
prism('Porch_6_12_Left_Gable_Roof_From_Roof_Plan', [-overhang, -porchD - overhang, porchRoofEave], 'xz', [[0, 0], [mm(5, 6), porchRoofRise], [mm(11, 0), 0]], porchD + 2 * overhang, 'Black_Asphalt_Shingle');
box('Porch_Right_Shed_Roof_Wing_From_Roof_Plan', [mm(10, 8), -porchD - overhang, porchRoofEave], [W - mm(10, 8) + overhang, porchD + 2 * overhang, mm(0, 6)], 'Black_Asphalt_Shingle');
prism('Porch_Cedar_Shake_Gable_Face', [0, -porchD - overhang - trimDepth, porchRoofEave], 'xz', [[0, 0], [mm(5, 6), porchRoofRise - mm(0, 4)], [mm(11, 0), 0]], trimDepth, 'Cedar_Shakes');

// Detached garage from sheet 26, placed behind/right of house but separate.
const gX = W + mm(8, 0);
const gY = mm(2, 0);
const gW = mm(16, 0);
const gD = mm(20, 0);
const gH = mm(9, 6);
box('Detached_Garage_Slab_16_by_20', [gX, gY, 0], [gW, gD, mm(0, 4)], 'Concrete');
panel('Detached_Garage_East_Front_10x8_Door', [gX, gY - wallT, mm(0, 4)], 'xz', [gW, gH], wallT, [{ name: 'Garage_10x8_Overhead_Door', x: mm(3, 0), y: 0, width: mm(10, 0), height: mm(8, 0) }], 'Exterior_Beige_Vinyl_Siding');
panel('Detached_Garage_West_Rear_Wall', [gX, gY + gD, mm(0, 4)], 'xz', [gW, gH], wallT, [], 'Exterior_Beige_Vinyl_Siding');
panel('Detached_Garage_North_Wall_Man_Door', [gX + gW, gY, mm(0, 4)], 'yz', [gD, gH], wallT, [{ name: 'Garage_3ft_Man_Door', x: mm(9, 6), y: 0, width: mm(3, 0), height: mm(7, 8) }], 'Exterior_Beige_Vinyl_Siding');
panel('Detached_Garage_South_Wall', [gX - wallT, gY, mm(0, 4)], 'yz', [gD, gH], wallT, [], 'Exterior_Beige_Vinyl_Siding');
box('Detached_Garage_Overhead_Door_Panel', [gX + mm(3, 0), gY - trimDepth, mm(0, 4)], [mm(10, 0), trimDepth, mm(8, 0)], 'White_Door');
prism('Detached_Garage_4_12_Roof', [gX - overhang, gY - overhang, mm(0, 4) + gH], 'xz', [[0, 0], [gW / 2 + overhang, mm(2, 8)], [gW + 2 * overhang, 0]], gD + 2 * overhang, 'Black_Asphalt_Shingle');

// Sparse siding cues only after plan correctness.
for (let z = mainWallZ + mm(1, 0), i = 1; z < eaveZ - mm(1, 0); z += mm(1, 0), i += 1) {
  box(`East_Front_Siding_Course_${String(i).padStart(2, '0')}`, [0, -wallT - trimDepth, z], [W, trimDepth, mm(0, 0.8)], 'White_Trim');
  if (i % 2 === 0) box(`West_Rear_Siding_Course_${String(i).padStart(2, '0')}`, [0, D + wallT, z], [W, trimDepth, mm(0, 0.8)], 'White_Trim');
}
for (let i = 0; i < 10; i += 1) {
  box(`East_Gable_Cedar_Batten_${String(i + 1).padStart(2, '0')}`, [(W / 10) * i, -wallT - 2 * trimDepth, eaveZ + mm(0, 5)], [mm(0, 2), trimDepth, roofRise - mm(1, 0)], 'White_Trim');
}

add({ op: 'style', name: 'PDF_Traced_Demo_Check', display_edges: true, profiles: true, profile_width: 1, face_style: 'shaded_with_textures', background_color: '#f7f4ed', sky_color: '#cfe8ff', ground_color: '#d8d0bf' });
add({ op: 'shadow', display: true, time: '2026-05-09T11:30:00+08:00', light: 78, dark: 35, use_sun_for_shading: true });
add({ op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: true });
add({ op: 'scene', name: 'PDF_Traced_East_Front_Elevation', camera: { eye: [W / 2, -mm(45, 0), mm(18, 0)], target: [W / 2, 0, mm(11, 0)], up: [0, 0, 1], fov: 28 } });
add({ op: 'scene', name: 'PDF_Traced_Main_Floor_Plan_Axon', camera: { eye: [W / 2, -mm(12, 0), mm(42, 0)], target: [W / 2, D / 2, mainZ], up: [0, 1, 0], fov: 32 } });
add({ op: 'scene', name: 'PDF_Traced_Three_Quarter_With_Garage', camera: { eye: [W + mm(32, 0), -mm(38, 0), mm(24, 0)], target: [W / 2, D / 2, mm(10, 0)], up: [0, 0, 1], fov: 35 } });
add({ op: 'camera', eye: [W + mm(32, 0), -mm(38, 0), mm(24, 0)], target: [W / 2, D / 2, mm(10, 0)], up: [0, 0, 1], fov: 35 });

console.log(JSON.stringify({ version: 1, units: 'mm', operations: ops }, null, 2));
