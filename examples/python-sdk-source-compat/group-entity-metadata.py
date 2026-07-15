model.reset()
material = model.materials.add("Corpus_Group_Material", color="#5a88aa")
layer = model.layers.add("Corpus_Group_Tag", visible=True)
group = model.entities.add_group("Corpus_Metadata_Group", id="corpus-metadata-group")
face = group.entities.add_face([[0, 0, 0], [50, 0, 0], [50, 30, 0], [0, 30, 0]], material=material)
face.pushpull(10)
group.layer = layer
group.set_attribute("Corpus", "role", "editable")
result = {"name": group.name, "tag": layer.name, "area": face.area}
