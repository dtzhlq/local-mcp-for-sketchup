model.reset()
texture = Texture("assets/corpus-texture.png", 64, 32)
material = model.materials.add("Corpus_Texture_Material", color="#ffffff", texture=texture)
result = {"material": material.name, "texture": texture.path, "width": texture.width}
