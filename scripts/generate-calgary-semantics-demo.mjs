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
mat('Beige_Vinyl_Siding', '#d9cab0');
mat('Interior_Drywall', '#eee8dc');
mat('Cedar_Shakes', '#b88755');
mat('White_Trim', '#f5f2ea');
mat('Black_Asphalt_Shingle', '#242424');
mat('Glass_Blue', '#83bad3', { alpha: 0.48 });
mat('White_Door', '#eeeeee');
mat('Pressure_Treated_Wood', '#8a6848');
mat('Kitchen_Cabinets', '#f2eee4');
mat('Plumbing_Fixtures', '#f7f7f4');
mat('Stair_Tread_Wood', '#9a714d');

const W = mm(26, 4);
const D = mm(24, 4);
const wallT = mm(0, 8);
const intT = mm(0, 5);
const porchD = mm(5, 0);
const deckD = mm(10, 0);
const deckW = mm(20, 0);
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
const trimD = mm(0, 2);

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
function cylinder(name, origin, radius, height, material, segments = 16) {
  add({ op: 'cylinder', name, origin: v(origin), radius: r(radius), height: r(height), segments, material, smooth: 'all' });
}
function hWall(name, x1, x2, y, z, h, material = 'Interior_Drywall') {
  box(name, [x1, y - intT / 2, z], [x2 - x1, intT, h], material);
}
function vWall(name, x, y1, y2, z, h, material = 'Interior_Drywall') {
  box(name, [x - intT / 2, y1, z], [intT, y2 - y1, h], material);
}
function frontTrim(name, x, z, w, h, y = -wallT - trimD) {
  const t = mm(0, 3);
  box(`${name}_Top_Trim`, [x - t, y, z + h], [w + 2 * t, trimD, t], 'White_Trim');
  box(`${name}_Bottom_Trim`, [x - t, y, z - t], [w + 2 * t, trimD, t], 'White_Trim');
  box(`${name}_Left_Trim`, [x - t, y, z - t], [t, trimD, h + 2 * t], 'White_Trim');
  box(`${name}_Right_Trim`, [x + w, y, z - t], [t, trimD, h + 2 * t], 'White_Trim');
}
function rearTrim(name, x, z, w, h, y = D + wallT) {
  frontTrim(name, x, z, w, h, y);
}
function frontWindow(name, x, z, w, h) {
  box(`${name}_Glass`, [x, -wallT - trimD, z], [w, trimD, h], 'Glass_Blue');
  frontTrim(name, x, z, w, h);
  box(`${name}_Midrail`, [x, -wallT - 2 * trimD, z + h * 0.52], [w, trimD, mm(0, 1.5)], 'White_Trim');
}
function rearWindow(name, x, z, w, h) {
  box(`${name}_Glass`, [x, D + wallT, z], [w, trimD, h], 'Glass_Blue');
  rearTrim(name, x, z, w, h);
}
function sideWindow(name, side, y, z, w, h) {
  const x = side === 'left' ? -wallT - trimD : W + wallT;
  box(`${name}_Glass`, [x, y, z], [trimD, w, h], 'Glass_Blue');
  const t = mm(0, 3);
  box(`${name}_Top_Trim`, [x, y - t, z + h], [trimD, w + 2 * t, t], 'White_Trim');
  box(`${name}_Bottom_Trim`, [x, y - t, z - t], [trimD, w + 2 * t, t], 'White_Trim');
  box(`${name}_Left_Trim`, [x, y - t, z - t], [trimD, t, h + 2 * t], 'White_Trim');
  box(`${name}_Right_Trim`, [x, y + w, z - t], [trimD, t, h + 2 * t], 'White_Trim');
}
function frontDoor(name, x, z, w, h) {
  box(`${name}_Slab`, [x, -wallT - trimD, z], [w, trimD, h], 'White_Door');
  frontTrim(name, x, z, w, h);
  box(`${name}_Upper_Glass`, [x + w * 0.25, -wallT - 2 * trimD, z + h * 0.48], [w * 0.5, trimD, h * 0.38], 'Glass_Blue');
  box(`${name}_Lower_Left_Panel`, [x + w * 0.13, -wallT - 2 * trimD, z + h * 0.12], [w * 0.28, trimD, h * 0.22], 'White_Trim');
  box(`${name}_Lower_Right_Panel`, [x + w * 0.59, -wallT - 2 * trimD, z + h * 0.12], [w * 0.28, trimD, h * 0.22], 'White_Trim');
}
function stairRun(name, x, y, z, width, run, rise, steps, direction = 'y') {
  for (let i = 0; i < steps; i += 1) {
    const tread = run / steps;
    const dz = rise / steps;
    const origin = direction === 'y' ? [x, y + i * tread, z + i * dz] : [x + i * tread, y, z + i * dz];
    const size = direction === 'y' ? [width, tread, mm(0, 2)] : [tread, width, mm(0, 2)];
    box(`${name}_Tread_${String(i + 1).padStart(2, '0')}`, origin, size, 'Stair_Tread_Wood');
  }
}
function railingRun(name, x, y, z, w, d, height, count, axis = 'x') {
  box(`${name}_Top_Rail`, [x, y, z + height], [w, d, mm(0, 3)], 'Pressure_Treated_Wood');
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const px = axis === 'x' ? x + t * w : x;
    const py = axis === 'x' ? y : y + t * d;
    cylinder(`${name}_Baluster_${String(i + 1).padStart(2, '0')}`, [px, py, z], mm(0, 1), height, 'Pressure_Treated_Wood', 8);
  }
}

add({ op: 'level', name: 'Basement', elevation: 0, height: basementH });
add({ op: 'level', name: 'Main Floor', elevation: mainZ, height: mainH });
add({ op: 'level', name: 'Upper Floor', elevation: upperFloorZ, height: upperH });

box('Basement_Concrete_Slab', [0, 0, 0], [W, D, mm(0, 4)], 'Concrete');
box('Main_Subfloor', [0, 0, mainZ], [W, D, floorT], 'Pressure_Treated_Wood');
box('Upper_Subfloor', [mm(1, 0), 0, upperFloorZ], [mm(24, 0), D, floorT], 'Pressure_Treated_Wood');

// Exterior shell: front is the East elevation with porch/entry.
panel('Foundation_Front_East_With_Three_Basement_Windows', [0, -wallT, 0], 'xz', [W, basementH], wallT, [
  { name: 'Basement_Window_Left_Under_Stairs', x: mm(6, 1), y: mm(0, 8), width: mm(3, 6), height: mm(1, 6) },
  { name: 'Basement_Window_Middle', x: mm(12, 0), y: mm(0, 8), width: mm(3, 6), height: mm(1, 6) },
  { name: 'Basement_Window_Right', x: mm(18, 0), y: mm(0, 8), width: mm(3, 6), height: mm(1, 6) }
], 'Concrete');
panel('Foundation_Rear_West_Walkout', [0, D, 0], 'xz', [W, basementH], wallT, [
  { name: 'Rear_Basement_Double_Door', x: mm(16, 4), y: 0, width: mm(5, 0), height: mm(6, 8) }
], 'Concrete');
panel('Foundation_Left_Plan_Side', [-wallT, 0, 0], 'yz', [D, basementH], wallT, [], 'Concrete');
panel('Foundation_Right_Plan_Side', [W, 0, 0], 'yz', [D, basementH], wallT, [], 'Concrete');

panel('Main_Front_East_Wall', [0, -wallT, mainWallZ], 'xz', [W, mainH], wallT, [
  { name: 'Front_Entry_Door', x: mm(3, 1), y: 0, width: mm(3, 0), height: mm(6, 8) },
  { name: 'Front_Living_Triple_Window', x: mm(12, 0), y: mm(2, 5), width: mm(7, 0), height: mm(3, 8) }
], 'Beige_Vinyl_Siding');
panel('Main_Rear_West_Wall_Deck_Side', [0, D, mainWallZ], 'xz', [W, mainH], wallT, [
  { name: 'Rear_Kitchen_Window', x: mm(10, 3), y: mm(3, 4), width: mm(5, 0), height: mm(2, 0) },
  { name: 'Rear_Deck_Door_Left', x: mm(2, 4), y: 0, width: mm(3, 0), height: mm(6, 8) },
  { name: 'Rear_Deck_Door_Right', x: mm(21, 2), y: 0, width: mm(3, 0), height: mm(6, 8) }
], 'Beige_Vinyl_Siding');
panel('Main_Left_Plan_Side_Wall', [-wallT, 0, mainWallZ], 'yz', [D, mainH], wallT, [
  { name: 'Side_Narrow_Window', x: mm(10, 8), y: mm(2, 0), width: mm(2, 0), height: mm(4, 8) }
], 'Beige_Vinyl_Siding');
panel('Main_Right_Plan_Side_Wall', [W, 0, mainWallZ], 'yz', [D, mainH], wallT, [], 'Beige_Vinyl_Siding');

panel('Upper_Front_East_Wall', [0, -wallT, upperWallZ], 'xz', [W, upperH], wallT, [
  { name: 'Upper_Front_Left_Window', x: mm(7, 2), y: mm(2, 3), width: mm(3, 6), height: mm(3, 6) },
  { name: 'Upper_Front_Right_Window', x: mm(13, 1), y: mm(2, 3), width: mm(3, 6), height: mm(3, 6) }
], 'Beige_Vinyl_Siding');
panel('Upper_Rear_West_Wall', [0, D, upperWallZ], 'xz', [W, upperH], wallT, [
  { name: 'Upper_Rear_Double_Window', x: mm(3, 9), y: mm(2, 3), width: mm(4, 2), height: mm(4, 0) },
  { name: 'Upper_Rear_Narrow_Window', x: mm(15, 0), y: mm(2, 3), width: mm(2, 6), height: mm(4, 4) }
], 'Beige_Vinyl_Siding');
panel('Upper_Right_Plan_Side_Wall', [W, 0, upperWallZ], 'yz', [D, upperH], wallT, [
  { name: 'Right_Upper_Window_Rear', x: mm(4, 0), y: mm(3, 0), width: mm(3, 0), height: mm(3, 0) },
  { name: 'Right_Upper_Window_Front', x: mm(17, 6), y: mm(3, 0), width: mm(3, 0), height: mm(3, 0) }
], 'Beige_Vinyl_Siding');
panel('Upper_Left_Plan_Side_Wall', [-wallT, 0, upperWallZ], 'yz', [D, upperH], wallT, [], 'Beige_Vinyl_Siding');

// Main floor internal walls: adjusted to floor plan semantics, not room-label guessing.
const mz = mainZ + floorT;
const ih = mainH - mm(0, 6);
vWall('Main_Stair_Left_Cut_Wall', mm(2, 4), mm(4, 0), mm(13, 10), mz, ih);
vWall('Main_Stair_Kitchen_Wall', mm(6, 0), mm(4, 0), mm(13, 10), mz, ih);
hWall('Main_Rear_Stair_Top_Wall', mm(2, 4), mm(6, 0), mm(4, 0), mz, ih);
hWall('Main_Center_Beam_Wall_Left', mm(2, 4), mm(6, 8), mm(13, 10), mz, ih);
hWall('Main_Center_Beam_Wall_Right', mm(12, 2), W, mm(13, 10), mz, ih);
vWall('Main_Bath_Left_Wall', mm(2, 4), mm(14, 0), mm(20, 4), mz, ih);
vWall('Main_Bath_Right_Wall', mm(6, 8), mm(14, 0), mm(20, 4), mz, ih);
hWall('Main_Bath_Bottom_Wall', mm(2, 4), mm(6, 8), mm(14, 0), mz, ih);
hWall('Main_Bath_Top_Wall_Left', mm(2, 4), mm(3, 4), mm(20, 4), mz, ih);
hWall('Main_Bath_Top_Wall_Right', mm(5, 6), mm(6, 8), mm(20, 4), mz, ih);
vWall('Main_Entry_Closet_Return', mm(2, 4), mm(20, 4), D, mz, ih);
hWall('Main_Entry_To_Living_Wall', mm(0, 8), mm(6, 8), mm(20, 4), mz, ih);

// Upper plan internal walls / bath stack constrained by Section A-A.
const uz = upperFloorZ + floorT;
const uh = upperH - mm(0, 6);
vWall('Upper_Stair_Right_Wall', mm(6, 0), 0, mm(8, 9), uz, uh);
hWall('Upper_Stair_Front_Wall', mm(0, 8), mm(6, 0), mm(8, 9), uz, uh);
vWall('Upper_Corridor_Bedroom_Wall', mm(12, 0), 0, D, uz, uh);
hWall('Upper_Bedroom_Dividing_Wall', mm(12, 0), W, mm(10, 9), uz, uh);
hWall('Upper_Bath_Corridor_Wall', mm(0, 8), mm(12, 0), mm(13, 0), uz, uh);
vWall('Upper_Bath_Stack_Wall', mm(6, 2), mm(8, 9), D, uz, uh);
hWall('Upper_Bath_Divider_Front', mm(0, 8), mm(6, 2), mm(18, 0), uz, uh);

// Stairs: use tread lines as real geometry. Two stacked runs visible in section.
stairRun('Lower_Basement_Stair_From_Section', mm(2, 7), mm(4, 2), mm(0, 4), mm(3, 2), mm(9, 0), mainZ - mm(0, 4), 15, 'y');
stairRun('Main_Stair_15R_From_Section', mm(2, 7), mm(4, 2), mz, mm(3, 2), mm(9, 10), upperFloorZ - mz, 15, 'y');

// Interior fixtures for semantic anchoring.
box('Kitchen_Back_Cabinet_Run', [mm(6, 2), mm(4, 2), mz], [mm(1, 10), mm(7, 2), mm(3, 0)], 'Kitchen_Cabinets');
box('Kitchen_Island', [mm(13, 0), mm(6, 3), mz], [mm(3, 0), mm(5, 8), mm(3, 0)], 'Kitchen_Cabinets');
box('Main_Bath_Fixture_Block', [mm(2, 8), mm(15, 2), mz], [mm(3, 2), mm(3, 8), mm(1, 8)], 'Plumbing_Fixtures');
box('Upper_Rear_Bath_Fixture_Block', [mm(1, 0), mm(10, 0), uz], [mm(4, 8), mm(2, 4), mm(1, 8)], 'Plumbing_Fixtures');
box('Upper_Front_Bath_Fixture_Block', [mm(1, 0), mm(18, 7), uz], [mm(4, 8), mm(2, 8), mm(1, 8)], 'Plumbing_Fixtures');

// Front elevation visible openings and trim.
frontDoor('Front_East_Entry_Door', mm(3, 1), mainWallZ, mm(3, 0), mm(6, 8));
frontWindow('Front_Living_Triple_Window', mm(12, 0), mainWallZ + mm(2, 5), mm(7, 0), mm(3, 8));
frontWindow('Front_Upper_Left_Window', mm(7, 2), upperWallZ + mm(2, 3), mm(3, 6), mm(3, 6));
frontWindow('Front_Upper_Right_Window', mm(13, 1), upperWallZ + mm(2, 3), mm(3, 6), mm(3, 6));
frontWindow('Front_Basement_Left_Window', mm(6, 1), mm(0, 8), mm(3, 6), mm(1, 6));
frontWindow('Front_Basement_Middle_Window', mm(12, 0), mm(0, 8), mm(3, 6), mm(1, 6));
frontWindow('Front_Basement_Right_Window', mm(18, 0), mm(0, 8), mm(3, 6), mm(1, 6));
rearWindow('Rear_Kitchen_Window', mm(10, 3), mainWallZ + mm(3, 4), mm(5, 0), mm(2, 0));
rearWindow('Upper_Rear_Double_Window', mm(3, 9), upperWallZ + mm(2, 3), mm(4, 2), mm(4, 0));
rearWindow('Upper_Rear_Narrow_Window', mm(15, 0), upperWallZ + mm(2, 3), mm(2, 6), mm(4, 4));
sideWindow('Side_Narrow_Main_Window', 'left', mm(10, 8), mainWallZ + mm(2, 0), mm(2, 0), mm(4, 8));
sideWindow('Right_Upper_Rear_Window', 'right', mm(4, 0), upperWallZ + mm(3, 0), mm(3, 0), mm(3, 0));
sideWindow('Right_Upper_Front_Window', 'right', mm(17, 6), upperWallZ + mm(3, 0), mm(3, 0), mm(3, 0));

// Front porch: railing only at living-room window zone, not across entire porch.
box('Front_East_Porch_Deck', [0, -porchD, mainZ - mm(0, 2)], [W, porchD, mm(0, 8)], 'Pressure_Treated_Wood');
box('Front_Porch_Stair_Landing_Left', [0, -porchD, mainZ - mm(0, 2)], [mm(10, 0), porchD, mm(0, 8)], 'Pressure_Treated_Wood');
for (const [name, x] of [['LeftDoorPost', mm(0, 8)], ['DoorGableRightPost', mm(7, 0)], ['LivingRailPost', mm(12, 0)], ['RightCornerPost', W - mm(0, 8)]]) {
  cylinder(`Front_Porch_Post_${name}`, [x, -porchD + mm(0, 5), mainZ], mm(0, 3), upperFloorZ - mainZ - mm(0, 4), 'White_Trim', 18);
  box(`Front_Porch_Post_Base_${name}`, [x - mm(0, 3), -porchD + mm(0, 2), mainZ], [mm(0, 6), mm(0, 6), mm(1, 2)], 'White_Trim');
}
railingRun('Front_Living_Window_Railing', mm(11, 6), -porchD + mm(0, 4), mainZ + mm(1, 6), mm(8, 2), mm(0, 2), mm(2, 8), 18, 'x');
for (let i = 0; i < 6; i += 1) {
  box(`Front_Left_Stair_Tread_${i + 1}`, [mm(1, 0), -porchD - mm(0, 11) * (i + 1), mainZ - mm(0, 2) - mm(0, 6) * (i + 1)], [mm(8, 0), mm(0, 11), mm(0, 6)], 'Pressure_Treated_Wood');
}

// Rear deck from page 13: 20' x 10', opposite front porch.
box('Rear_West_Deck_20x10', [mm(4, 5), D, mainZ - mm(0, 2)], [deckW, deckD, mm(0, 8)], 'Pressure_Treated_Wood');
railingRun('Rear_Deck_Back_Railing', mm(4, 5), D + deckD - mm(0, 2), mainZ + mm(1, 8), deckW, mm(0, 2), mm(3, 0), 22, 'x');
for (const [name, x] of [['Left', mm(4, 5)], ['Mid', mm(14, 5)], ['Right', mm(24, 5)]]) {
  cylinder(`Rear_Deck_Post_${name}`, [x, D + deckD - mm(0, 8), 0], mm(0, 3), mainZ, 'Pressure_Treated_Wood', 12);
}

// Roofs. Main roof ridge runs rear/front. Front entry has a real small sloped gable roof, not a flat canopy.
prism('Main_4_12_Gable_Roof', [-overhang, -overhang, eaveZ], 'xz', [[0, 0], [W / 2 + overhang, roofRise], [W + 2 * overhang, 0]], D + 2 * overhang, 'Black_Asphalt_Shingle');
prism('Front_Main_Cedar_Gable_Face', [0, -wallT - trimD, eaveZ], 'xz', [[0, 0], [W / 2, roofRise - mm(0, 8)], [W, 0]], trimD, 'Cedar_Shakes');
prism('Rear_Main_Cedar_Gable_Face', [0, D + wallT, eaveZ], 'xz', [[0, 0], [W / 2, roofRise - mm(0, 8)], [W, 0]], trimD, 'Cedar_Shakes');
box('Main_Front_White_Fascia', [-overhang, -overhang - trimD, eaveZ - mm(0, 6)], [W + 2 * overhang, trimD, mm(0, 8)], 'White_Trim');
box('Main_Rear_White_Fascia', [-overhang, D + overhang, eaveZ - mm(0, 6)], [W + 2 * overhang, trimD, mm(0, 8)], 'White_Trim');

const porchRoofEave = upperFloorZ - mm(0, 3);
const entryGableW = mm(9, 9);
const entryGableRise = mm(2, 2);
prism('Front_Entry_Sloped_Gable_Roof_Left_Bay', [-mm(0, 8), -porchD - overhang, porchRoofEave], 'xz', [[0, 0], [entryGableW / 2, entryGableRise], [entryGableW, 0]], porchD + 2 * overhang, 'Black_Asphalt_Shingle');
prism('Front_Entry_Cedar_Gable_Face', [-mm(0, 8), -porchD - overhang - trimD, porchRoofEave], 'xz', [[0, 0], [entryGableW / 2, entryGableRise - mm(0, 3)], [entryGableW, 0]], trimD, 'Cedar_Shakes');
// lower long porch roof wing behind/right of small entry gable.
box('Front_Long_Low_Porch_Roof_Wing', [entryGableW - mm(1, 0), -porchD - overhang, porchRoofEave], [W - entryGableW + mm(2, 0), porchD + 2 * overhang, mm(0, 6)], 'Black_Asphalt_Shingle');
box('Front_Porch_White_Fascia_Line', [-overhang, -porchD - overhang - trimD, porchRoofEave - mm(0, 5)], [W + 2 * overhang, trimD, mm(0, 7)], 'White_Trim');

// Siding and roof hatch cues: semantic, sparse.
for (let z = mainWallZ + mm(1, 0), i = 1; z < eaveZ - mm(1, 0); z += mm(1, 0), i += 1) {
  box(`Front_Siding_Course_${String(i).padStart(2, '0')}`, [0, -wallT - 2 * trimD, z], [W, trimD, mm(0, 0.8)], 'White_Trim');
}
for (let i = 0; i < 12; i += 1) {
  box(`Front_Main_Gable_Cedar_Batten_${String(i + 1).padStart(2, '0')}`, [(W / 12) * i, -wallT - 3 * trimD, eaveZ + mm(0, 5)], [mm(0, 2), trimD, roofRise - mm(1, 0)], 'White_Trim');
}

// Detached garage retained as separate reference mass.
const gX = W + mm(8, 0);
const gY = mm(2, 0);
const gW = mm(16, 0);
const gD = mm(20, 0);
const gH = mm(9, 6);
box('Detached_Garage_Slab_16x20', [gX, gY, 0], [gW, gD, mm(0, 4)], 'Concrete');
panel('Detached_Garage_Front_10x8_Door', [gX, gY - wallT, mm(0, 4)], 'xz', [gW, gH], wallT, [{ name: 'Garage_10x8_Overhead_Door', x: mm(3, 0), y: 0, width: mm(10, 0), height: mm(8, 0) }], 'Beige_Vinyl_Siding');
panel('Detached_Garage_Rear_Wall', [gX, gY + gD, mm(0, 4)], 'xz', [gW, gH], wallT, [], 'Beige_Vinyl_Siding');
panel('Detached_Garage_Right_Man_Door', [gX + gW, gY, mm(0, 4)], 'yz', [gD, gH], wallT, [{ name: 'Garage_3ft_Man_Door', x: mm(9, 6), y: 0, width: mm(3, 0), height: mm(7, 8) }], 'Beige_Vinyl_Siding');
panel('Detached_Garage_Left_Wall', [gX - wallT, gY, mm(0, 4)], 'yz', [gD, gH], wallT, [], 'Beige_Vinyl_Siding');
box('Detached_Garage_Overhead_Door_Panel', [gX + mm(3, 0), gY - trimD, mm(0, 4)], [mm(10, 0), trimD, mm(8, 0)], 'White_Door');
prism('Detached_Garage_4_12_Roof', [gX - overhang, gY - overhang, mm(0, 4) + gH], 'xz', [[0, 0], [gW / 2 + overhang, mm(2, 8)], [gW + 2 * overhang, 0]], gD + 2 * overhang, 'Black_Asphalt_Shingle');

add({ op: 'style', name: 'Semantics_Corrected_PDF_Demo', display_edges: true, profiles: true, profile_width: 1, face_style: 'shaded_with_textures', background_color: '#f7f4ed', sky_color: '#cfe8ff', ground_color: '#d8d0bf' });
add({ op: 'shadow', display: true, time: '2026-05-11T13:10:00+08:00', light: 78, dark: 35, use_sun_for_shading: true });
add({ op: 'rendering_options', edge_display_mode: 1, draw_hidden_geometry: false, display_color_by_layer: false, transparency: true });
add({ op: 'scene', name: 'Semantics_East_Front_Check', camera: { eye: [W / 2, -mm(46, 0), mm(18, 0)], target: [W / 2, 0, mm(10, 8)], up: [0, 0, 1], fov: 28 } });
add({ op: 'scene', name: 'Semantics_Rear_Deck_Check', camera: { eye: [W / 2, D + mm(40, 0), mm(18, 0)], target: [W / 2, D, mm(10, 8)], up: [0, 0, 1], fov: 30 } });
add({ op: 'scene', name: 'Semantics_Interior_Stair_Bath_Axon', camera: { eye: [W + mm(18, 0), -mm(18, 0), mm(34, 0)], target: [W / 2, D / 2, mainZ + mm(6, 0)], up: [0, 0, 1], fov: 36 } });
add({ op: 'camera', eye: [W + mm(32, 0), -mm(38, 0), mm(24, 0)], target: [W / 2, D / 2, mm(10, 0)], up: [0, 0, 1], fov: 35 });

console.log(JSON.stringify({ version: 1, units: 'mm', operations: ops }, null, 2));
