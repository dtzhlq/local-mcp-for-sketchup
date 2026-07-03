model.units = "inches"
model.reset()

palette = {
    "base": "#dbeafe",
    "accent": "#fb7185",
    "shadow": "#94a3b8"
}

materials = {
    role: Material("SDK_P2_" + role, color=color)
    for role, color in palette.items()
}

for material in materials.values():
    model.add_material(material)

panel_specs = [
    {"name": "Left", "x": 0, "w": 1.5, "h": 1.0, "role": "base"},
    {"name": "Center", "x": 2.0, "w": 2.0, "h": 1.25, "role": "accent"},
    {"name": "Right", "x": 4.75, "w": 1.25, "h": 0.75, "role": "shadow"}
]


def make_panel(index, spec, material):
    corners = [
        SUPoint3D(spec["x"] + dx, 0, dz)
        for dx, dz in [(0, 0), (spec["w"], 0), (spec["w"], spec["h"]), (0, spec["h"])]
    ]
    geometry = GeometryInput("SDK_P2_" + spec["name"], material=material, id="sdk-p2-" + str(index))
    face = geometry.add_face(
        LoopInput(corners),
        id="sdk-p2-face-" + str(index),
        metadata={
            "index": index,
            "spec_keys": sorted(list(spec.keys())),
            "role": spec.get("role", "base")
        }
    )
    model.add_geometry(geometry)
    return face


faces = [
    make_panel(index, spec, materials[spec.get("role", "base")])
    for index, spec in enumerate(panel_specs)
]

area_outer_pairs = list(zip(
    [face.area for face in faces],
    [face.outer_loop.is_outer() for face in faces]
))

result = {
    "material_roles": sorted(list(materials.keys())),
    "panel_names": [spec["name"] for spec in panel_specs],
    "areas": [pair[0] for pair in area_outer_pairs],
    "all_outer": all([pair[1] for pair in area_outer_pairs]),
    "wide_count": len([spec for spec in panel_specs if spec["w"] >= 1.5]),
    "total_area": sum([face.area for face in faces]),
    "last_panel": panel_specs[-1]["name"],
    "middle_names": [spec["name"] for spec in panel_specs[1:]]
}
