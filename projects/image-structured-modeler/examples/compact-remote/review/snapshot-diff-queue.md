# Switch Controller Mock/Queue Snapshot Diff Report

- Verdict: **review**
- Level: **warn**
- OK: **true**
- Tolerance: `1 mm`
- Expected runtime: `mock`
- Actual runtime: `queue`
- Reset first: `true`

## Summary

| Metric | Count |
|---|---:|
| Total diffs | 13 |
| Errors | 0 |
| Warnings | 13 |
| Info | 0 |

## Top Issues

| Severity | Type | Path | Name | Message |
|---|---|---|---|---|
| warn | `snapshot.total_mismatch` | `totals.faces` |  | Snapshot total faces differs |
| warn | `snapshot.total_mismatch` | `totals.edges` |  | Snapshot total edges differs |
| warn | `snapshot.field_mismatch` | `groups.Compact_Remote_Body_From_Image_Plan.features` | Compact_Remote_Body_From_Image_Plan | groups.Compact_Remote_Body_From_Image_Plan.features differs |
| warn | `snapshot.metric_mismatch` | `groups.Compact_Remote_Face_Panel_From_Image_Plan.faces` | Compact_Remote_Face_Panel_From_Image_Plan | groups.Compact_Remote_Face_Panel_From_Image_Plan.faces differs by more than 0 |
| warn | `snapshot.metric_mismatch` | `groups.Compact_Remote_Face_Panel_From_Image_Plan.edges` | Compact_Remote_Face_Panel_From_Image_Plan | groups.Compact_Remote_Face_Panel_From_Image_Plan.edges differs by more than 0 |
| warn | `snapshot.field_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.features` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.features differs |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.faces` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.faces differs by more than 0 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.edges` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.edges differs by more than 0 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.bounding_box.w` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.bounding_box.w differs by more than 1 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.bounding_box.d` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.bounding_box.d differs by more than 1 |

## Recommendations

- Review bounding box drift against tolerance_mm; raise tolerance only for expected SketchUp numeric differences.

## Diff Type Breakdown

| Type | Count |
|---|---:|
| `snapshot.metric_mismatch` | 9 |
| `snapshot.total_mismatch` | 2 |
| `snapshot.field_mismatch` | 2 |

## Snapshot Pair Summary

| Metric | Expected | Actual |
|---|---:|---:|
| groups | 3 | 3 |
| instances | 0 | 0 |
| faces | 364 | 369 |
| edges | 780 | 1035 |
| vertices | 128 | 690 |
| scenes | 2 | 2 |

Bounding boxes: expected `44 x 158 x 16.599999999999998 mm`, actual `44 x 158 x 16.6 mm`

## Warning Classification Delta

- Warning gate: **pass**
- Unexpected warnings: expected runtime `0`, actual runtime `0`

| Bucket | Expected Total | Actual Total | Delta | Expected Needs Review | Actual Needs Review |
|---|---:|---:|---:|---:|---:|
| `queue_material_limitation` | 0 | 3 | 3 | 0 | 0 |

## Image Structured Next Actions

- Review warning-level snapshot diffs and decide whether they need topology tolerance or real geometry fixes.
