model.units = "inches"
model.reset()

component_material = Material("SDK_Component_Material", color="#c7f0d8")
model.add_material(component_material)

panel = GeometryInput("SDK_Component_Panel", material=component_material)
panel_face = panel.add_face(
    LoopInput([
        SUPoint3D(0, 0, 0),
        SUPoint3D(2, 0, 0),
        SUPoint3D(2, 1, 0),
        SUPoint3D(0, 1, 0),
    ]),
    id="component-panel-face",
)
panel_face.metadata = {"role": "component_definition_face"}

definition = ComponentDefinition("SDK_Component_Definition")
definition.add_geometry(panel)
model.add_component_definition(definition)

first_instance = ComponentInstance(
    "SDK_Component_Instance_A",
    definition,
    SUPoint3D(0, 0, 0),
)
second_instance = definition.create_instance(
    "SDK_Component_Instance_B",
    origin=SUPoint3D(4, 0, 0),
    transform=SUTransformation.rotation_z(90),
)

model.add_component_instance(first_instance)
model.add_component_instance(second_instance)

result = {
    "definition_name": definition.name,
    "definition_operations": definition.operation_count,
    "first_definition": first_instance.definition_name,
    "second_definition": second_instance.definition_name,
    "second_origin_source_units": second_instance.origin,
}
