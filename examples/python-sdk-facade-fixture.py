model.units = "inches"
model.reset()

wall = Material("SDK_Wall", color=SUColor(230, 226, 216))
glass = Material("SDK_Glass", color="#88ccee", alpha=0.45)
model.materials.add(wall)
model.add_material(glass)

panel = GeometryInput("SDK_GeometryInput_Panel", id="sdk-panel", material=wall)
outer = LoopInput([
    SUPoint3D(0, 0, 0),
    SUPoint3D(4, 0, 0),
    SUPoint3D(4, 3, 0),
    SUPoint3D(0, 3, 0),
])
hole = LoopInput([
    SUPoint3D(1.25, 0.75, 0),
    SUPoint3D(2.75, 0.75, 0),
    SUPoint3D(2.75, 2.25, 0),
    SUPoint3D(1.25, 2.25, 0),
])
panel.add_face(outer, holes=[hole], material=wall)
model.add_geometry(panel)

guide_points = []
for index in range(3):
    guide_points.append(SUPoint3D(index * 2, index % 2, 0.5))

model.add_curve("SDK_Guide_Curve", guide_points, id="sdk-guide")
model.add_arc_curve(
    "SDK_Arc_Curve",
    center=SUPoint3D(0, 0, 1),
    radius=1.5,
    start_angle=0,
    end_angle=180,
    segments=6,
    id="sdk-arc",
)
model.add_box(
    "SDK_Box_From_Facade",
    SUPoint3D(5, 0, 0),
    [1, 2, 0.5],
    material=glass,
    transform=SUTransformation.translation(SUPoint3D(0, 0, 0.5)),
)

result = {
    "panel": "sdk-panel",
    "source_units": model.units,
    "operation_count": len(model.operations),
}
