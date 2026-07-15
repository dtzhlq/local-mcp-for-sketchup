model.reset()

def make_box(index, width=10):
    return model.add_box("Corpus_Helper_" + str(index), [index * 15, 0, 0], [width, 10, 10], id="corpus-helper-" + str(index))

boxes = [make_box(index) for index in range(3)]
result = {"count": len(boxes), "names": [box.name for box in boxes]}
