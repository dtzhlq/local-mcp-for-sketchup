# Switch Controller Queue Verification

Updated: 2026-05-20

## Result

Queue runtime successfully built and saved a real SketchUp file from:

- `projects/image-structured-modeler/examples/switch-controller/output.json`

Saved file:

- `output/image-structured-switch-controller.skp`
- Size: 253,177 bytes
- Last generated: 2026-05-20 22:16 CST
- Queue snapshot report:
  - `projects/image-structured-modeler/examples/switch-controller/review/snapshot-report-queue.json`
  - `projects/image-structured-modeler/examples/switch-controller/review/snapshot-report-queue.md`
- Mock/queue diff report:
  - `projects/image-structured-modeler/examples/switch-controller/review/snapshot-diff-queue.json`
  - `projects/image-structured-modeler/examples/switch-controller/review/snapshot-diff-queue.md`

## Snapshot Summary

- Runtime: `queue`
- Groups: 24
- Component instances: 4
- Faces: 1776
- Edges: 2964
- Vertices: 1244
- Scenes:
  - `Image_Structured_Front_Review`
  - `Image_Structured_Top_QA`
- Bounding box:
  - min: `[-140, -84.5, 0]`
  - max: `[140, 89.5, 40]`
  - size: `280 x 174 x 40 mm`
- Rendering options:
  - `transparency`: `false`
  - `draw_hidden_geometry`: `false`
  - `display_color_by_layer`: `false`

## Geometry Quality Notes

The current output uses higher-level product primitives for device volumes and mounted details:

- `rounded_box`: 6 operations
- `domed_surface`: 2 operations
- `bowed_panel`: 2 operations
- `analog_stick`: 2 operations
- `button_on_panel`: 8 operations
- `screw_hole`: 4 operations
- `component_instance`: 4 operations for LEDs

This replaces the earlier button/screw/thumbstick component overlap approximation. It is still a baseline product model, not final high-fidelity CAD.

## Materials

Expected materials only:

- `Dark_Seam`
- `Gloss_Black_Button`
- `Indicator_Green`
- `Rubber_Thumbstick`
- `Satin_Black_Plastic`
- `Warm_White_Plastic`

The previous stale `Sree_*` material leakage was fixed by making plugin reset purge unused component definitions before purging materials.

## Runtime Metadata

The SketchUp 2026 installed plugin was updated from the repository copy and reloaded by restarting SketchUp, then starting the Bridge timer from the Extensions menu. Queue snapshots preserve DSL `qa` metadata on groups and component instances.

## Warnings

Total warnings: 4.

- `material.pbr_unsupported`: 4
- `geometry.bbox_overlap`: 0

There are no error-severity warnings. The warning classifier in `snapshot-report-queue.json` currently places all warnings into expected buckets:

- `queue_material_limitation`: 4

The remaining warnings are SketchUp runtime material capability warnings for PBR material fields. Geometry warnings have been reduced to 0. Queue warning classification comes from DSL/runtime metadata instead of name heuristics:

- `runtime_material_capability`: 4

## Mock/Queue Diff

The generated mock/queue diff report passes:

- Verdict: `pass`
- Level: `ok`
- Total diffs: 0
- Error diffs: 0
- Warning diffs: 0
- Warning gate: `pass`
- Expected runtime: `mock`
- Actual runtime: `queue`

Topology and bbox parity:

- Groups: `24 -> 24`
- Component instances: `4 -> 4`
- Faces: `1776 -> 1776`
- Edges: `2964 -> 2964`
- Vertices: `1212 -> 1244` (tracked in report but ignored by structural diff)
- Bounding box: `280 x 174 x 40 mm -> 280 x 174 x 40 mm`

Warning source parity:

- Expected/mock warnings: none
- Actual/queue warnings: `runtime_material_capability=4`

## Next Verification Work

- Keep the geometry warning budget at 0 while adding correction-driven parameter edits.
- Expand regression coverage for `manual-corrections.json` so review changes flow into the model plan and DSL.
