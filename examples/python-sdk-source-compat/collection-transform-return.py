model.reset()
box = model.add_box("Corpus_Transform", [0, 0, 0], [10, 10, 10], id="corpus-transform")
transform_result = model.entities.transform_entities(SUTransformation.translation([25, 0, 0]), box)
result = {"transform_result": transform_result}
