model.reset()
first = model.add_box("Corpus_Erase_First", [0, 0, 0], [10, 10, 10], id="corpus-erase-first")
second = model.add_box("Corpus_Erase_Second", [20, 0, 0], [10, 10, 10], id="corpus-erase-second")
erase_result = model.entities.erase_entities([first, second])
result = {"erase_result": erase_result}
