model.reset()
face = model.entities.add_face(
    [SUPoint3D(0, 0, 0), SUPoint3D(40, 0, 0), SUPoint3D(40, 20, 0), SUPoint3D(0, 20, 0)],
    name="Corpus_PushPull",
    id="corpus-pushpull",
)
face.pushpull(12)
result = {"area": face.area, "distance": 12}
