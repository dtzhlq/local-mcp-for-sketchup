model.units = "inches"
model.reset()

base_mat = Material("SDK_Helper_Base", color=SUColor("#dbeafe"))
accent_mat = Material("SDK_Helper_Accent", color="#f97316")
model.add_material(base_mat)
model.add_material(accent_mat)


def make_panel(name, origin_x, material=base_mat, width=2.0, height=1.5):
    geometry = GeometryInput(name, material=material, id=name + "-id")
    outer = LoopInput([
        SUPoint3D(origin_x, 0, 0),
        SUPoint3D(origin_x + width, 0, 0),
        SUPoint3D(origin_x + width, height, 0),
        SUPoint3D(origin_x, height, 0)
    ])
    face = geometry.add_face(
        outer,
        id=name + "-face",
        metadata={"source": "helper_function", "index": origin_x}
    )
    model.add_geometry(geometry)
    return face


faces = []
for i in range(3):
    panel_mat = base_mat if i < 2 else accent_mat
    faces.append(make_panel("SDK_Helper_Panel_" + str(i), i * 3, material=panel_mat))

result = {
    "panel_count": len(faces),
    "operation_count": len(model.operations),
    "first_edge_length": faces[0].edges[0].length,
    "first_outer_loop": faces[0].outer_loop.is_outer(),
    "last_face_area": faces[2].area
}
