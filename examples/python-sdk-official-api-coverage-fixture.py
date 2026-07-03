model.units = "inches"
model.reset()

material = model.materials.add("SDK_API_Material", color=SUColor("#88ccaa"))
layer = model.layers.add("SDK_API_Layer", color="#225588", visible=True)

definition = model.definitions.add("SDK_API_Component_Definition")
definition_face = definition.entities.add_face(
    [
        SUPoint3D(0, 0, 0),
        SUPoint3D(1.5, 0, 0),
        SUPoint3D(1.5, 1, 0),
        SUPoint3D(0, 1, 0),
    ],
    name="SDK_API_Definition_Profile",
    material=material,
)
definition_face.pushpull(0.25)

component_instance = model.entities.add_instance(
    definition,
    SUPoint3D(3, 0, 0),
    name="SDK_API_Component_Instance",
    id="sdk-api-component-instance",
)
component_instance.layer = layer
component_instance.material = material
component_instance.set_attribute("SDK_API", "role", "component")
component_instance.transform_by(SUTransformation.rotation_z(30))

entities_group = model.entities.add_group("SDK_API_Entities_Group", id="sdk-api-entities-group")
group_face = entities_group.entities.add_face(
    [
        SUPoint3D(0, 2, 0),
        SUPoint3D(2, 2, 0),
        SUPoint3D(2, 3, 0),
        SUPoint3D(0, 3, 0),
    ],
    material=material,
)
group_face.pushpull(0.5)
entities_group.layer = layer
entities_group.set_attribute("SDK_API", "role", "entities_group")

box = model.add_box(
    "SDK_API_Box",
    SUPoint3D(0, 4, 0),
    [1, 1, 1],
    id="sdk-api-box",
    material=material,
)
box.layer = layer
box.set_attribute("SDK_API", "role", "box")
box.transform_by(SUTransformation.translation(SUPoint3D(0, 0, 0.5)))

camera = Camera(SUPoint3D(6, -8, 5), SUPoint3D(1, 2, 1), fov=40)
scene = model.pages.add("SDK_API_Page", camera=camera)
scene.update()

model.rendering_options["edge_display_mode"] = 1
model.rendering_options["transparency"] = True
model.set_rendering_options(model.rendering_options)

model.shadow_info["display"] = True
model.shadow_info["light"] = 75
model.set_shadow(model.shadow_info)

model.active_view.write_image("/tmp/sdk-api-view.png", name="SDK_API_View_Image")

result = {
    "material_count": model.materials.count(),
    "layer_name": layer.name,
    "definition_name": definition.name,
    "definition_operations": definition.operation_count,
    "component_definition": component_instance.definition_name,
    "group_face_area": group_face.area,
    "page_name": scene.name,
    "selection_size": model.selection.count(),
    "rendering_keys": RenderingOptions.keys()[:3],
    "shadow_keys": ShadowInfo.keys()[:2],
}
