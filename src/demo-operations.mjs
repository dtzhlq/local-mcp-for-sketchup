import { boxVertices } from './object-identity.mjs';
import { ensureMaterial } from './material-operations.mjs';
import { applyTransform, normalizeTransform, normalizeVector, positiveNumber } from './operation-utils.mjs';
import { addWarning, boundingBoxForVertices } from './snapshot.mjs';

export function addDemoRoom(model, operation = {}) {
  const width = positiveNumber(operation.width, 4500, 'room.width');
  const depth = positiveNumber(operation.depth, 3000, 'room.depth');
  const height = positiveNumber(operation.height, 2400, 'room.height');
  const wallThickness = positiveNumber(operation.wall_thickness ?? operation.wallThickness, 120, 'room.wall_thickness');
  const floorThickness = positiveNumber(operation.floor_thickness ?? operation.floorThickness, 100, 'room.floor_thickness');
  const name = operation.name || 'Demo_Room';

  ensureMaterial(model, 'Floor_Oak', '#a87945');
  ensureMaterial(model, 'Wall_Paint', '#efe7dc');
  ensureMaterial(model, 'Door_Wood', '#7a4a2b');
  ensureMaterial(model, 'Window_Glass', '#8ecae6');
  ensureMaterial(model, 'Table_Wood', '#9b6b43');
  ensureMaterial(model, 'Chair_Fabric', '#315c8a');

  addDemoBox(model, {
    name: `${name}_Floor`,
    origin: [0, 0, 0],
    size: [width, depth, floorThickness],
    material: 'Floor_Oak'
  });

  const doorWidth = 900;
  const doorHeight = 2100;
  const doorX = (width - doorWidth) / 2;
  const wallZ = floorThickness;

  addDemoBox(model, {
    name: `${name}_Wall_South_Left`,
    origin: [0, -wallThickness, wallZ],
    size: [doorX, wallThickness, height],
    material: 'Wall_Paint'
  });
  addDemoBox(model, {
    name: `${name}_Wall_South_Right`,
    origin: [doorX + doorWidth, -wallThickness, wallZ],
    size: [width - doorX - doorWidth, wallThickness, height],
    material: 'Wall_Paint'
  });
  addDemoBox(model, {
    name: `${name}_Wall_South_Header`,
    origin: [doorX, -wallThickness, wallZ + doorHeight],
    size: [doorWidth, wallThickness, height - doorHeight],
    material: 'Wall_Paint'
  });
  addDemoBox(model, {
    name: `${name}_Door_Panel`,
    origin: [doorX + 25, -wallThickness - 25, wallZ],
    size: [doorWidth - 50, 25, doorHeight],
    material: 'Door_Wood'
  });

  addDemoBox(model, {
    name: `${name}_Wall_North`,
    origin: [0, depth, wallZ],
    size: [width, wallThickness, height],
    material: 'Wall_Paint'
  });
  addDemoBox(model, {
    name: `${name}_Wall_West`,
    origin: [-wallThickness, 0, wallZ],
    size: [wallThickness, depth, height],
    material: 'Wall_Paint'
  });
  addDemoBox(model, {
    name: `${name}_Wall_East`,
    origin: [width, 0, wallZ],
    size: [wallThickness, depth, height],
    material: 'Wall_Paint'
  });

  addDemoBox(model, {
    name: `${name}_Window_North_Glass`,
    origin: [width * 0.58, depth + wallThickness + 6, wallZ + 1050],
    size: [1050, 12, 750],
    material: 'Window_Glass'
  });

  const tableX = width / 2 - 600;
  const tableY = depth / 2 - 400;
  addDemoBox(model, { name: `${name}_Table_Top`, origin: [tableX, tableY, 750], size: [1200, 800, 75], material: 'Table_Wood' });
  for (const [index, leg] of [[0, 0], [1100, 0], [0, 700], [1100, 700]].entries()) {
    addDemoBox(model, { name: `${name}_Table_Leg_${index + 1}`, origin: [tableX + leg[0], tableY + leg[1], 100], size: [100, 100, 650], material: 'Table_Wood' });
  }

  addDemoBox(model, { name: `${name}_Chair_Seat`, origin: [tableX + 300, tableY - 550, 450], size: [600, 500, 75], material: 'Chair_Fabric' });
  addDemoBox(model, { name: `${name}_Chair_Back`, origin: [tableX + 300, tableY - 600, 525], size: [600, 75, 700], material: 'Chair_Fabric' });
  addDemoBox(model, { name: `${name}_Chair_Leg_1`, origin: [tableX + 350, tableY - 500, 100], size: [75, 75, 350], material: 'Chair_Fabric' });
  addDemoBox(model, { name: `${name}_Chair_Leg_2`, origin: [tableX + 775, tableY - 500, 100], size: [75, 75, 350], material: 'Chair_Fabric' });
  addDemoBox(model, { name: `${name}_Chair_Leg_3`, origin: [tableX + 350, tableY - 150, 100], size: [75, 75, 350], material: 'Chair_Fabric' });
  addDemoBox(model, { name: `${name}_Chair_Leg_4`, origin: [tableX + 775, tableY - 150, 100], size: [75, 75, 350], material: 'Chair_Fabric' });

  addWarning(model, 'info.limitation', 'info', 'Door opening is represented by segmented wall boxes in the MVP DSL.', 'demo_room');
  addWarning(model, 'info.limitation', 'info', 'Window is represented as glass marker geometry; true boolean wall cuts are left for the SketchUp plugin refinement.', 'demo_room');
}

function addDemoBox(model, operation) {
  const { name, origin, size, material } = operation;
  const normalizedOrigin = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const normalizedSize = normalizeVector(size, [1, 1, 1], `${name}.size`);
  if (normalizedSize.some((value) => value <= 0)) throw new Error(`${name}.size values must be positive`);
  const vertices = demoBoxVertices(normalizedOrigin, normalizedSize);
  const transformedVertices = applyTransform(vertices, operation, name);
  model.groups.push({
    id: name,
    name,
    kind: 'box',
    faces: 6,
    edges: 12,
    material: ensureMaterial(model, material),
    transform: normalizeTransform(operation, name),
    bounding_box: boundingBoxForVertices(transformedVertices),
    _vertices: transformedVertices
  });
}

function demoBoxVertices(origin, size) {
  return boxVertices(origin, size);
}
