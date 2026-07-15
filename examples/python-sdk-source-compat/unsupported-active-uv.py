model.reset()
face = model.entities.add_face([[0, 0, 0], [10, 0, 0], [10, 10, 0]])
helper = face.get_UVHelper(True, False)
result = helper.get_front_UVQ([5, 5, 0])
