model.reset()
mesh = PolygonMesh()
p1 = mesh.add_point([0, 0, 0])
p2 = mesh.add_point([40, 0, 0])
p3 = mesh.add_point([40, 40, 10])
p4 = mesh.add_point([0, 40, 10])
mesh.add_polygon([p1, p2, p3, p4])
face_count = model.entities.add_faces_from_mesh(mesh, name="Corpus_Mesh", id="corpus-mesh")
result = {"face_count": face_count, "points": len(mesh.points), "polygons": len(mesh.polygons)}
