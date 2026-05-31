# Building Group R7 Input

R7.0 uses the generated industrial-campus images in `test/建筑群/` as the first building-group input set. The current target is evidence intake only:

- source views: one top/site-plan aerial and two oblique aerial views
- visible masses: west warehouse rows, primary blue-roof hall, admin/office block, utility building, cylindrical tank farm, parking lot, internal roads, and site boundary
- generated artifacts: `observations.json` and per-image `review-overlays/*-overlay.png`

This slice intentionally stops before PartGraph generation. The next R7 step should turn the reviewed `building_group` EvidenceGraph into a massing-oriented PartGraph with scale, orientation, and block adjacency gates.
