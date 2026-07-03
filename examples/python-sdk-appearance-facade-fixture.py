model.units = "inches"
model.reset()

layer = Layer("SDK_Appearance_Layer", color=SUColor("#336699"), visible=True)
model.add_layer(layer)

texture = Texture("textures/sdk-facade-albedo.jpg", width=128, height=64)
material = Material("SDK_Textured_Material", color="#ffffff", texture=texture)
model.add_material(material)

reference_image = Image(
    "SDK_Reference_Image",
    "/tmp/sdk-reference.png",
    width=320,
    height=180,
    role="reference",
)
texture_image = ImageRep(
    "SDK_Texture_ImageRep",
    "/tmp/sdk-texture.png",
    width=256,
    height=256,
    role="texture",
)
model.add_image_reference(reference_image)
model.add_image_reference(texture_image)

model.add_box(
    "SDK_Textured_Box",
    SUPoint3D(0, 0, 0),
    [2, 1, 1],
    id="sdk-textured-box",
    material=material,
)
model.assign_layer("sdk-textured-box", layer)

result = {
    "layer_name": layer.name,
    "texture_path": texture.path,
    "reference_image": reference_image.name,
    "image_rep_role": texture_image.role,
}
