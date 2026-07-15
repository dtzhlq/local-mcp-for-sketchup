model.reset()
layer = model.layers.add("Corpus_Scene_Tag", visible=True)
box = model.add_box("Corpus_Scene_Box", [0, 0, 0], [10, 10, 10], id="corpus-scene-box")
page = model.pages.add("Corpus_Scene")
page.set_visibility(layer, False)
page.set_drawingelement_visibility(box, False)
result = {"page": page.name, "hidden": True}
