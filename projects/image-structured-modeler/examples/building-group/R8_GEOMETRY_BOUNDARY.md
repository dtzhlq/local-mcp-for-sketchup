# Building Group R8 Editable Geometry Boundary

This is the no-texture boundary probe for the generated industrial-campus images in `test/建筑群/`. It is separate from:

- `r7-final`: conservative technical baseline, small feature proposal set, no texture planes.
- `r7-photoreal`: high-density visual probe that uses texture-assisted image planes.

## What This Reconstructs

- Full site slab, perimeter fence, south gate/guardhouse, SiteRegionGraph overlays for road/parking/green/walkway/service-yard areas, crosswalks, walkways, and parking stall line geometry.
- Four separated white warehouse bodies instead of two collapsed row bars.
- Gable roof primitives for the blue production hall and all four warehouses.
- Editable roof/facade feature ops: raised roof seams/ridges, loading-bay recesses, window-band recesses, louver slot, and office/utility openings.
- Deterministic visible site details as geometry: trees with trunks/canopies, loading trucks/docks, roof vents, HVAC units, tank caps/hatches/base plinths/service platforms, and pipe bridge. Parked vehicles are disabled in R8 geometry mode unless per-instance evidence exists.
- Roof panel seams are sloped roof-plane meshes with `roof_surface_fit` host metadata. Tank details inherit `tank_ellipse_fit` metadata from two reviewed ellipse instances.
- No `image_plane` operations and no texture assets in the compiled DSL.

## Verified Artifacts

- PartGraph: `part-graph.r8-geometry.json`
- DSL: `output.r8-geometry.json`
- Mock layout QA: `layout-qa-r8-geometry/building-group-r8-geometry/report.json`
- Mock reference visual QA: `reference-visual-qa-r8-geometry/building-group-r8-geometry/report.json`
- Mock proposal/live-gate QA: `proposal-qa-r8-geometry/report.json`
- Mock GeometryFit v2 grounding QA: `proposal-qa-r8-geometry/geometry-fit-report.json`
- Queue layout QA: `layout-qa-r8-geometry-queue/building-group-r8-geometry/report.json`
- Queue reference visual QA: `reference-visual-qa-r8-geometry-queue/building-group-r8-geometry/report.json`
- Queue proposal/live-gate QA: `proposal-qa-r8-geometry-queue/report.json`
- Queue SKP: `output/image-structured-building-group-r8-geometry.skp`

Latest queue artifact totals:

- `268` groups
- `5120` faces
- `9493` edges
- `4930` vertices
- `.skp` size: `589284` bytes

Compiled operation totals:

- `323` operations
- `110` boxes
- `132` cylinders
- `21` meshes
- `17` `add_raised_rib`
- `19` `cut_recess`
- `5` `gable_roof`
- `1` `cut_slot`
- `0` `image_plane`
- `0` parked-vehicle operations

## Current Boundary

This is the current editable-geometry ceiling for the supplied generated campus images. It is materially better than the R7 final technical baseline because many visible details are now direct SketchUp geometry instead of a sparse massing model.

It is still not a true photo-grade or survey-grade reconstruction:

- Camera pose is not solved across top and oblique views.
- Roof/facade features are reviewed layout reconstructions, not per-instance detections from image segmentation.
- Parking stall lines now come from a reviewed ParkingLayoutGraph using line/gap evidence and grid residuals. Cars are not generated without per-instance mask/keypoint evidence.
- Site regions now distinguish road pavement, parking area, green area, walkway, service yard, and unclassified gaps. The current unclassified ratio is `0.388`, internal road area ratio is `0.06`, and site-region overlap ratio is `0.001`.
- Roof-surface QA checks `40` roof features with `0` floating features. TankEllipseFit checks `2` tank ellipse instances with max radius residual `0.08`.
- The site scale remains the reviewed estimate from parking bays, drive aisles, and crossing widths, roughly `130m x 98m`.
- GeometryFit v2 now checks footprint, relation, scale, handedness, dense-detail grounding, site regions, parking grid residuals, roof-surface fit, and tank ellipse fit. Current R8 GeometryFit is intentionally `review`: primary structures have `0.93` grounded/review-confirmed coverage, dense detail helper ratio is `0.653`, `189` dense detail items require review, structural grounding issues are `0`, and photo-grade eligibility is `0`.

## Practical Read

For this image set, the system can now build a live SketchUp-accepted, no-texture, editable industrial-campus model with a few hundred structured groups. Grounding v2 prevents this visually full model from being mistaken for photo-grade reconstruction: helper-heavy detail stays excluded from image-grounded coverage. The next step is to replace helper-heavy dense classes with reusable mask/edge/oblique evidence, then prove the same gate on real-photo building inputs.
