model.reset()
values = {"alpha": 1, "beta": 2}
values.update({"gamma": 3})
pairs = sorted(values.items())
result = {"keys": sorted(values.keys()), "sum": sum(values.values()), "first_pair": pairs[0]}
