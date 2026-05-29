# Switch Controller Snapshot Report

- Generated: `2026-05-27T07:12:14.849Z`
- Runtime: `queue`
- Output DSL: `projects/image-structured-modeler/examples/compact-remote/output.json`
- Saved SKP: `output/image-structured-compact-remote.skp`
- File size: `182920 bytes`

## Snapshot Summary

| Metric | Value |
|---|---:|
| Groups | 3 |
| Component instances | 0 |
| Faces | 369 |
| Edges | 1035 |
| Vertices | 690 |
| Scenes | 2 |

Bounding box: `44 x 158 x 16.6 mm`

## Operation Counts

| Operation | Count |
|---|---:|
| `reset` | 1 |
| `material` | 4 |
| `rounded_box` | 2 |
| `add_boss` | 6 |
| `add_raised_rib` | 1 |
| `cut_recess` | 5 |
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
