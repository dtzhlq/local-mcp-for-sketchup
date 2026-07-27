const rows = 3;
const columns = 4;
const spacing = [120, 95, 0];
const baseSize = [columns * spacing[0] + 60, rows * spacing[1] + 70, 12];
const ops = [];

function material(name, color, alpha = 1) {
  return { op: "material", name, color, alpha };
}

function instanceName(row, column) {
  return "Expert_Peg_" + row + "_" + column;
}

ops.push({ op: "reset" });
ops.push(material("Expert_Base", [0.18, 0.2, 0.22]));
ops.push(material("Expert_Peg", [0.82, 0.62, 0.32]));
ops.push(material("Expert_Label", [0.04, 0.04, 0.04]));
ops.push({
  op: "box",
  name: "Expert_Parametric_Base",
  origin: [0, 0, 0],
  size: baseSize,
  material: "Expert_Base"
});
ops.push({
  op: "component_definition",
  name: "Expert_Peg_Def",
  operations: [
    {
      op: "rounded_box",
      name: "Expert_Peg_Body",
      origin: [0, 0, 12],
      size: [68, 46, 20],
      radius: 5,
      segments: 8,
      material: "Expert_Peg"
    }
  ]
});

const columnOffsets = range(columns).map((column) => 30 + column * spacing[0]);
for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const origin = [columnOffsets[column], 35 + row * spacing[1], 0];
    ops.push({
      op: "component_instance",
      name: instanceName(row, column),
      definition: "Expert_Peg_Def",
      origin,
      transform: { translate: [rand(-1, 1), rand(-1, 1), 0] }
    });
  }
}

ops.push({
  op: "text_3d",
  name: "Expert_Parametric_Label",
  text: "EXPERT GRID",
  height: 18,
  extrusion: 2,
  align: "center",
  origin: vec.add([baseSize[0] / 2 - 84, baseSize[1] - 28, 14], [0, 0, 0]),
  material: "Expert_Label"
});

dsl(ops);
