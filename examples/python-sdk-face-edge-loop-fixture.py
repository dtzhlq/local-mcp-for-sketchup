model.units = "inches"
model.reset()

front = Material("SDK_Face_Front", color="#d8e9ff")
back = Material("SDK_Face_Back", color="#ffe1c4")
model.add_material(front)
model.add_material(back)

geometry = GeometryInput("SDK_Face_Loop_Edge_Panel", id="sdk-face-panel", material=front)
face = geometry.add_face(
    LoopInput([
        SUPoint3D(0, 0, 0),
        SUPoint3D(6, 0, 0),
        SUPoint3D(6, 4, 0),
        SUPoint3D(0, 4, 0),
    ]),
    holes=[
        LoopInput([
            SUPoint3D(2, 1, 0),
            SUPoint3D(4, 1, 0),
            SUPoint3D(4, 3, 0),
            SUPoint3D(2, 3, 0),
        ])
    ],
    id="front-face",
)
face.back_material = back
face.metadata = {"role": "panel_face", "source": "sdk_facade"}

edge_lengths = []
for edge in face.edges:
    edge_lengths.append(edge.length)

outer_loop = face.outer_loop
face.reverse()
face.pushpull(0.25, copy=True)

model.add_geometry(geometry)

result = {
    "face_area_source_units": face.area,
    "edge_count": len(face.edges),
    "loop_count": len(face.loops),
    "outer_loop_is_outer": outer_loop.is_outer(),
    "outer_loop_vertices": len(outer_loop.vertices),
    "first_edge_length": edge_lengths[0],
    "normal_after_reverse": face.normal,
    "plane_after_reverse": face.plane,
}
