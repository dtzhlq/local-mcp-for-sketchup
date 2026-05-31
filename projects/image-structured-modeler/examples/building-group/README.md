# Building Group R7 Input

R7 uses the generated industrial-campus images in `test/建筑群/` as the first building-group input set. The current target is still review-gated massing, not final architectural reconstruction:

- source views: one top/site-plan aerial and two oblique aerial views
- visible masses: west warehouse rows, primary blue-roof hall, admin/office block, utility building, cylindrical tank farm, parking lot, internal roads, and site boundary
- scale anchors: parking bay span, one parking bay, parking drive aisle, and marked crossing/walkway width
- generated artifacts: `observations.json`, per-image `review-overlays/*-overlay.png`, `part-graph.massing.json`, `output.massing.json`, `layout-qa/*`, `reference-visual-qa/*`, `layout-qa-queue/*`, `reference-visual-qa-queue/*`, `proposal-review/*`, and `proposal-qa/*`

`part-graph.massing.json` keeps every image-derived shape proposal review-gated. The site scale is estimated from visible known elements at roughly `130m x 98m`, but it remains provisional until a real site dimension, bay count, or road width is confirmed.

The current mock QA gate is `npm run image-structured:qa-building-group`: layout QA validates site containment, support, intentional road/scale-anchor overlaps, and massing separation; Reference Visual QA validates top-view placement/extent ratios, scale-anchor proportions, height tiers, and coarse orientation. Live queue verification is `npm run image-structured:qa-building-group:queue`; it writes queue QA reports beside the mock reports and saves `output/image-structured-building-group-massing.skp`.

Detail proposals are kept separate from massing acceptance. `npm run image-structured:proposal-review-chain-building-group` accepts only the current `primary_blue_roof_hall` roofline/facade/opening subset, writes `correction-patch.detail-proposals.json`, `part-graph.detail-proposal-applied.json`, `output.detail-proposal-applied.json`, `proposal-review/index.html`, and `proposal-qa/report.json`, then runs mock compile/layout/reference/physical QA. Queue detail verification is available as `npm run image-structured:proposal-review-chain-building-group:queue` when SketchUp Bridge is online.
