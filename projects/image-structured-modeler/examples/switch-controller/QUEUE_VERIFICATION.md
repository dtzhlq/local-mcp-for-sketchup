# Switch Controller Queue Verification

Updated: 2026-05-13

## Result

Queue runtime successfully built and saved a real SketchUp file from:

- `projects/image-structured-modeler/examples/switch-controller/output.json`

Saved file:

- `output/image-structured-switch-controller.skp`
- Size: 211,680 bytes

## Snapshot Summary

- Runtime: `queue`
- Groups: 12
- Component instances: 16
- Faces: 1500
- Edges: 2376
- Scenes:
  - `Image_Structured_Front_Review`
  - `Image_Structured_Top_QA`
- Bounding box:
  - min: `[-140, -84.5, 0]`
  - max: `[140, 89.5, 40]`
  - size: `280 x 174 x 40 mm`

## Materials

Expected materials only:

- `Dark_Seam`
- `Gloss_Black_Button`
- `Indicator_Green`
- `Rubber_Thumbstick`
- `Satin_Black_Plastic`
- `Warm_White_Plastic`

The previous stale `Sree_*` material leakage was fixed by making plugin reset purge unused component definitions before purging materials.

## Warnings

Total warnings: 26.

- `material.pbr_unsupported`: 4
- `geometry.bbox_overlap`: 22

There are no error-severity warnings. The overlap warnings are expected for the current approximation because face domes, rear grips, buttons, screws, and LEDs intentionally sit on or slightly intersect shell geometry. Later work should classify expected contact separately from real collisions.
