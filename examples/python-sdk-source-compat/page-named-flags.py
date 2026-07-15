model.reset()
page = model.pages.add("Corpus_Page_Flags", camera=Camera([100, -100, 80], [0, 0, 0]))
updated = page.update(PAGE_USE_CAMERA | PAGE_USE_SHADOWINFO | PAGE_USE_LAYER_VISIBILITY)
result = {"updated": updated, "flags": page.update_flags}
