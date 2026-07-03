model.units = "inches"
model.reset()

material = model.materials.add("SDK_R3_Material", color=SUColor("#d7b56d"))
accent = model.materials.add("SDK_R3_Accent", color=SUColor("#5d8bb0"))
layer = model.layers.add("SDK_R3_Layer", color="#334455", visible=True)

follow_group = model.entities.add_group("SDK_R3_FollowMe_Group", id="sdk-r3-followme")
follow_face = follow_group.entities.add_face(
    [
        SUPoint3D(0, 0, 0),
        SUPoint3D(0.5, 0, 0),
        SUPoint3D(0.5, 0.25, 0),
        SUPoint3D(0, 0.25, 0),
    ],
    material=material,
    id="sdk-r3-follow-profile",
)
follow_edge = follow_group.entities.add_line(SUPoint3D(0, 0, 0), SUPoint3D(0, 0, 1.5))
follow_ok = follow_face.followme(follow_edge)

uv_face = model.entities.add_face(
    [
        SUPoint3D(1.25, 0, 0),
        SUPoint3D(2.25, 0, 0),
        SUPoint3D(2.25, 1, 0),
        SUPoint3D(1.25, 1, 0),
    ],
    name="SDK_R3_UV_Face",
    material=accent,
    id="sdk-r3-uv-face",
)
uv_face.position_material(
    accent,
    [
        [SUPoint3D(1.25, 0, 0), SUPoint2D(0, 0)],
        [SUPoint3D(2.25, 0, 0), SUPoint2D(1, 0)],
        [SUPoint3D(2.25, 1, 0), SUPoint2D(1, 1)],
        [SUPoint3D(1.25, 1, 0), SUPoint2D(0, 1)],
    ],
    True,
)
face_mesh = uv_face.mesh()

mesh = PolygonMesh()
p1 = mesh.add_point(SUPoint3D(0, 1.5, 0))
p2 = mesh.add_point(SUPoint3D(1, 1.5, 0))
p3 = mesh.add_point(SUPoint3D(1, 2.5, 0.5))
p4 = mesh.add_point(SUPoint3D(0, 2.5, 0.5))
mesh.add_polygon([p1, p2, p3, p4])

mesh_count = model.entities.add_faces_from_mesh(mesh, name="SDK_R3_Mesh", id="sdk-r3-mesh", material=material)
fill_ok = model.entities.fill_from_mesh(
    face_mesh,
    name="SDK_R3_Fill_From_Face_Mesh",
    id="sdk-r3-fill",
    material=accent,
    transform=SUTransformation.translation(SUPoint3D(1.25, 1.75, 0.25)),
)

selected_box = model.add_box(
    "SDK_R3_Selected_Box",
    SUPoint3D(2.75, 0, 0),
    [0.75, 0.75, 0.75],
    id="sdk-r3-selected-box",
    material=material,
)
selected_box.layer = layer

scene = model.pages.add(
    "SDK_R3_Page",
    camera=Camera(SUPoint3D(5, -6, 4), SUPoint3D(1.5, 1, 0.5), fov=38),
    transition_time=1.5,
    use_camera=True,
)
scene.set_visibility(layer, False)
scene.set_drawingelement_visibility(selected_box, False)
scene.rendering_options["draw_hidden_geometry"] = True
scene.rendering_options["edge_display_mode"] = 1
scene.shadow_info["display"] = True
scene.shadow_info["light"] = 60
scene.update()

model.selection.add(selected_box)
selection_size = model.selection.count()

result = {
    "follow_ok": follow_ok,
    "texture_positioned": uv_face.texture_positioned(),
    "mesh_count": mesh_count,
    "fill_ok": fill_ok,
    "selection_size": selection_size,
    "page_name": scene.name,
}
