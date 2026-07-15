model.reset()
definition = model.definitions.add("Corpus_Nested_Definition")
face = definition.entities.add_face([[0, 0, 0], [30, 0, 0], [30, 20, 0], [0, 20, 0]], name="Corpus_Definition_Face")
face.pushpull(8)
instance = model.entities.add_instance(definition, [50, 0, 0], name="Corpus_Definition_Instance", id="corpus-definition-instance")
result = {"definition": instance.definition_name, "operations": definition.operation_count}
