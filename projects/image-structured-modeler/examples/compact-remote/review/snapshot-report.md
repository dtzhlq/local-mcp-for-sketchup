# Switch Controller Snapshot Report

- Generated: `2026-05-25T07:50:49.790Z`
- Runtime: `mock`
- Output DSL: `projects/image-structured-modeler/examples/compact-remote/output.json`

## Snapshot Summary

| Metric | Value |
|---|---:|
| Groups | 11 |
| Component instances | 0 |
| Faces | 529 |
| Edges | 1234 |
| Vertices | 452 |
| Scenes | 2 |

Bounding box: `44 x 158 x 15.850000000000001 mm`

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
| none | 0 | 0 | 0 |

## Warning Details

No warnings.

## Next Actions

- Move this report generation into the regular image-structured build/check loop.
- Use expected warning buckets as the first warning budget allowlist.
- Reduce expected overlap buckets with more accurate contact/recess primitives.
