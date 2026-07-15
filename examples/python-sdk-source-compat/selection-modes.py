model.reset()
first = model.add_box("Corpus_Select_First", [0, 0, 0], [10, 10, 10], id="corpus-select-first")
second = model.add_box("Corpus_Select_Second", [20, 0, 0], [10, 10, 10], id="corpus-select-second")
model.selection.add(first, second)
model.selection.remove(first)
model.selection.replace(second)
model.selection.clear()
result = {"selection_size": model.selection.count()}
