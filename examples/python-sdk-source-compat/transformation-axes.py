model.reset()
box = model.add_box("Corpus_Axes_Box", [0, 0, 0], [10, 10, 10], id="corpus-axes-box")
transform = SUTransformation.axes([25, 10, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1])
box.transform_by(transform)
result = {"matrix": transform.to_a(), "name": box.name}
