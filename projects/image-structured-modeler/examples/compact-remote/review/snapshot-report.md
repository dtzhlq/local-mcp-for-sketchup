# Switch Controller Snapshot Report

- Generated: `2026-05-27T08:21:17.644Z`
- Runtime: `mock`
- Output DSL: `projects/image-structured-modeler/examples/compact-remote/output.json`

## Snapshot Summary

| Metric | Value |
|---|---:|
| Groups | 3 |
| Component instances | 0 |
| Faces | 364 |
| Edges | 780 |
| Vertices | 128 |
| Scenes | 2 |

Bounding box: `44 x 158 x 16.599999999999998 mm`

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
| none | 0 | 0 | 0 |

## Warning Details

No warnings.

## Next Actions

- Move this report generation into the regular image-structured build/check loop.
- Use expected warning buckets as the first warning budget allowlist.
- Reduce expected overlap buckets with more accurate contact/recess primitives.
