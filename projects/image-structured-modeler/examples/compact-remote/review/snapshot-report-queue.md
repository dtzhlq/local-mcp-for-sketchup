# Switch Controller Snapshot Report

- Generated: `2026-05-25T07:55:27.375Z`
- Runtime: `queue`
- Output DSL: `projects/image-structured-modeler/examples/compact-remote/output.json`
- Saved SKP: `output/image-structured-compact-remote.skp`
- File size: `188104 bytes`

## Snapshot Summary

| Metric | Value |
|---|---:|
| Groups | 11 |
| Component instances | 0 |
| Faces | 544 |
| Edges | 1279 |
| Vertices | 766 |
| Scenes | 2 |

Bounding box: `44 x 158 x 15.85 mm`

## Operation Counts

| Operation | Count |
|---|---:|
| `reset` | 1 |
| `material` | 4 |
| `rounded_box` | 2 |
| `button_on_panel` | 7 |
| `slot_array` | 1 |
| `text_3d` | 1 |
| `scene` | 2 |
| `style` | 1 |
| `shadow` | 1 |
| `rendering_options` | 1 |

## Warning Classification

| Bucket | Total | Expected | Needs Review |
|---|---:|---:|---:|
| `queue_material_limitation` | 3 | 3 | 0 |

## Warning Details

| Bucket | Type | Expected | Classification Source | Object Source | Note |
|---|---|---|---|---|---|
| `queue_material_limitation` | `material.pbr_unsupported` | yes | `runtime_material_capability` | `Remote_Graphite_Plastic` | SketchUp runtime does not apply the PBR fields used by the DSL material metadata. |
| `queue_material_limitation` | `material.pbr_unsupported` | yes | `runtime_material_capability` | `Remote_Satin_Face` | SketchUp runtime does not apply the PBR fields used by the DSL material metadata. |
| `queue_material_limitation` | `material.pbr_unsupported` | yes | `runtime_material_capability` | `Remote_Button_Rubber` | SketchUp runtime does not apply the PBR fields used by the DSL material metadata. |

## Next Actions

- Move this report generation into the regular image-structured build/check loop.
- Use expected warning buckets as the first warning budget allowlist.
- Reduce expected overlap buckets with more accurate contact/recess primitives.
