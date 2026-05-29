# Switch Controller Snapshot Report

- Generated: `2026-05-25T08:42:06.363Z`
- Runtime: `mock`
- Output DSL: `projects/image-structured-modeler/examples/switch-controller/per-image/IMG_0157/output.json`

## Snapshot Summary

| Metric | Value |
|---|---:|
| Groups | 24 |
| Component instances | 4 |
| Faces | 1776 |
| Edges | 2964 |
| Vertices | 1212 |
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
| none | 0 | 0 | 0 |

## Warning Details

No warnings.

## Next Actions

- Move this report generation into the regular image-structured build/check loop.
- Use expected warning buckets as the first warning budget allowlist.
- Reduce expected overlap buckets with more accurate contact/recess primitives.
