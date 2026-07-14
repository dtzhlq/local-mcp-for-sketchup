model.units = "inches"
model.reset()

material = model.materials.add("SDK_High_Value_Material", color="#7aa6c2")
moving_box = model.add_box(
    "SDK_High_Value_Moving_Box",
    SUPoint3D(0, 0, 0),
    [1, 1, 1],
    id="sdk-high-value-moving-box",
    material=material,
)
deleted_box = model.add_box(
    "SDK_High_Value_Deleted_Box",
    SUPoint3D(3, 0, 0),
    [1, 1, 1],
    id="sdk-high-value-deleted-box",
    material=material,
)

transformed_count = model.entities.transform_entities(
    SUTransformation.translation(SUPoint3D(2, 0, 0)),
    [moving_box],
)
deleted_count = model.entities.erase_entities(deleted_box)

uv_face = model.entities.add_face(
    [
        SUPoint3D(0, 2, 0),
        SUPoint3D(1, 2, 0),
        SUPoint3D(1, 3, 0),
        SUPoint3D(0, 3, 0),
    ],
    name="SDK_High_Value_UV_Face",
    id="sdk-high-value-uv-face",
    material=material,
)
uv_face.position_material(
    material,
    [
        [SUPoint3D(0, 2, 0), SUPoint2D(0, 0)],
        [SUPoint3D(1, 2, 0), SUPoint2D(1, 0)],
        [SUPoint3D(1, 3, 0), SUPoint2D(1, 1)],
        [SUPoint3D(0, 3, 0), SUPoint2D(0, 1)],
    ],
    True,
)
uv_helper = uv_face.get_UVHelper(True, False)
front_uvq = uv_helper.get_front_UVQ(SUPoint3D(1, 3, 0))

page = model.pages.add(
    "SDK_High_Value_Page",
    camera=Camera(SUPoint3D(6, -8, 5), SUPoint3D(1, 1, 0), fov=40),
)
page.update(17)

result = {
    "transformed_count": transformed_count,
    "deleted_count": deleted_count,
    "front_uvq": front_uvq,
    "page_update_flags": page.update_flags,
}
