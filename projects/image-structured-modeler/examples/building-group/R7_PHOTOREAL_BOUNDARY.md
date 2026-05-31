# Building Group R7 Photoreal Boundary

This is the high-fidelity boundary probe for the current generated industrial-campus sample. It is intentionally separate from the rollback-safe `r7-final` proposal baseline.

## What This Reconstructs

- Four visible white warehouse buildings instead of two collapsed row bars.
- Gable roof primitives for the blue hall and the four warehouses.
- Texture-assisted top surfaces from the supplied GPT Image 2 top-view sample:
  - full site orthophoto
  - blue hall roof
  - four warehouse roofs
  - admin and utility roofs
  - tank-farm and parking-lot detail planes
- Deterministic visual details: perimeter fence, trees, parked vehicles, loading trucks, roof vents, and HVAC units.
- Scale remains the reviewed R7 estimate from known site elements: about `130m x 98m`.

## Verified Artifacts

- PartGraph: `part-graph.r7-photoreal.json`
- DSL: `output.r7-photoreal.json`
- Mock layout QA: `layout-qa-r7-photoreal/building-group-r7-photoreal/report.json`
- Mock reference visual QA: `reference-visual-qa-r7-photoreal/building-group-r7-photoreal/report.json`
- Mock proposal/live-gate QA: `proposal-qa-r7-photoreal/report.json`
- Queue layout QA: `layout-qa-r7-photoreal-queue/building-group-r7-photoreal/report.json`
- Queue reference visual QA: `reference-visual-qa-r7-photoreal-queue/building-group-r7-photoreal/report.json`
- Queue proposal/live-gate QA: `proposal-qa-r7-photoreal-queue/report.json`
- Queue SKP: `output/image-structured-building-group-r7-photoreal.skp`

Latest queue artifact totals:

- `128` groups
- `2964` faces
- `5675` edges
- `2994` vertices
- `.skp` size: `3754501` bytes

For comparison, the previous `r7-final` live artifact was still a technical proposal baseline: `14` groups and `609` faces.

## Current Boundary

This is not yet a true photo-level editable reconstruction. It is a texture-assisted SketchUp reconstruction that can visually approach the top-view reference while keeping the model testable.

Still missing for real photo-grade reconstruction:

- Camera pose solving across top and oblique views.
- Depth recovery or multi-view stereo for facade and roof height details.
- Instance segmentation for every roof panel, tree, vehicle, curb, stripe, and facade feature.
- UV unwrapping/projection onto sloped roof and facade surfaces instead of horizontal texture helper planes.
- Rendered-image similarity QA against the source photos; current QA verifies proxy structure, placement, features, and queue buildability.
- Survey-grade scale confirmation from a real dimension.

## Practical Read

The system can now build a much denser, live SketchUp-accepted, texture-assisted site model from the current sample. The next real capability boundary is not more proposal plumbing; it is vision geometry: camera calibration, semantic segmentation, depth, UV projection, and render-to-reference scoring.
