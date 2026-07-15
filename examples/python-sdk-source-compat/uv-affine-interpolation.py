model.reset()
material = model.materials.add("Corpus_UV_Material", color="#cccccc")
face = model.entities.add_face([[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]], name="Corpus_UV", material=material)
face.position_material(material, [[[0, 0, 0], [0, 0]], [[100, 0, 0], [1, 0]], [[100, 100, 0], [1, 1]], [[0, 100, 0], [0, 1]]], True)
helper = face.get_UVHelper(True, False)
result = {"center_uvq": helper.get_front_UVQ([25, 75, 0])}
