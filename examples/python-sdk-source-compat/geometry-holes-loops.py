model.reset()
geometry = GeometryInput("Corpus_Holed_Face", id="corpus-holed-face")
outer = [geometry.add_vertex(point) for point in [[0, 0, 0], [100, 0, 0], [100, 80, 0], [0, 80, 0]]]
hole = [geometry.add_vertex(point) for point in [[30, 20, 0], [70, 20, 0], [70, 60, 0], [30, 60, 0]]]
face = geometry.add_face(outer, holes=[hole])
model.add_geometry(geometry)
result = {"loops": len(face.loops), "outer": face.outer_loop.is_outer(), "area": face.area}
