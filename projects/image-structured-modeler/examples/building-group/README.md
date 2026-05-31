# Building Group R7 Input

R7 uses the generated industrial-campus images in `test/建筑群/` as the first building-group input set. The current target is still review-gated massing, not final architectural reconstruction:

- source views: one top/site-plan aerial and two oblique aerial views
- visible masses: west warehouse rows, primary blue-roof hall, admin/office block, utility building, cylindrical tank farm, parking lot, internal roads, and site boundary
- scale anchors: parking bay span, one parking bay, parking drive aisle, and marked crossing/walkway width
- generated artifacts: `observations.json`, per-image `review-overlays/*-overlay.png`, `part-graph.massing.json`, and `output.massing.json`

`part-graph.massing.json` keeps every image-derived shape proposal review-gated. The site scale is estimated from visible known elements at roughly `130m x 98m`, but it remains provisional until a real site dimension, bay count, or road width is confirmed.
