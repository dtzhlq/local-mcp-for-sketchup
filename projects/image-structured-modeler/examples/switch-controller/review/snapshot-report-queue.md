# Switch Controller Snapshot Report

- Generated: `2026-05-20T14:16:45.120Z`
- Runtime: `queue`
- Output DSL: `projects/image-structured-modeler/examples/switch-controller/output.json`
- Saved SKP: `output/image-structured-switch-controller.skp`
- File size: `253177 bytes`

## Snapshot Summary

| Metric | Value |
|---|---:|
| Groups | 24 |
| Component instances | 4 |
| Faces | 1776 |
| Edges | 2964 |
| Vertices | 1244 |
| Scenes | 2 |

Bounding box: `280 x 174 x 40 mm`

## Operation Counts

| Operation | Count |
|---|---:|
| `reset` | 1 |
| `material` | 6 |
| `component_definition` | 1 |
| `rounded_box` | 6 |
| `domed_surface` | 2 |
| `bowed_panel` | 2 |
| `analog_stick` | 2 |
| `button_on_panel` | 8 |
| `component_instance` | 4 |
| `screw_hole` | 4 |
| `scene` | 2 |
| `style` | 1 |
| `shadow` | 1 |
| `rendering_options` | 1 |

## Warning Classification

| Bucket | Total | Expected | Needs Review |
|---|---:|---:|---:|
| `queue_material_limitation` | 4 | 4 | 0 |

## Warning Details

| Bucket | Type | Expected | Classification Source | Object Source | Note |
|---|---|---|---|---|---|
| `queue_material_limitation` | `material.pbr_unsupported` | yes | `runtime_material_capability` | `Warm_White_Plastic` | SketchUp runtime does not apply the PBR fields used by the DSL material metadata. |
| `queue_material_limitation` | `material.pbr_unsupported` | yes | `runtime_material_capability` | `Satin_Black_Plastic` | SketchUp runtime does not apply the PBR fields used by the DSL material metadata. |
| `queue_material_limitation` | `material.pbr_unsupported` | yes | `runtime_material_capability` | `Gloss_Black_Button` | SketchUp runtime does not apply the PBR fields used by the DSL material metadata. |
| `queue_material_limitation` | `material.pbr_unsupported` | yes | `runtime_material_capability` | `Rubber_Thumbstick` | SketchUp runtime does not apply the PBR fields used by the DSL material metadata. |

## Next Actions

- Move this report generation into the regular image-structured build/check loop.
- Use expected warning buckets as the first warning budget allowlist.
- Reduce expected overlap buckets with more accurate contact/recess primitives.

