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
| Total diffs | 9 |
| Errors | 0 |
| Warnings | 9 |
| Info | 0 |

## Top Issues

| Severity | Type | Path | Name | Message |
|---|---|---|---|---|
| warn | `snapshot.total_mismatch` | `totals.faces` |  | Snapshot total faces differs |
| warn | `snapshot.total_mismatch` | `totals.edges` |  | Snapshot total edges differs |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.faces` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.faces differs by more than 0 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.edges` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.edges differs by more than 0 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.bounding_box.w` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.bounding_box.w differs by more than 1 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.bounding_box.d` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.bounding_box.d differs by more than 1 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.bounding_box.min.0` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.bounding_box.min.0 differs by more than 1 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.bounding_box.max.0` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.bounding_box.max.0 differs by more than 1 |
| warn | `snapshot.metric_mismatch` | `groups.Remote_Brand_Label_From_Image_Plan.bounding_box.max.1` | Remote_Brand_Label_From_Image_Plan | groups.Remote_Brand_Label_From_Image_Plan.bounding_box.max.1 differs by more than 1 |

## Recommendations

- Review bounding box drift against tolerance_mm; raise tolerance only for expected SketchUp numeric differences.

## Diff Type Breakdown

| Type | Count |
|---|---:|
| `snapshot.metric_mismatch` | 7 |
| `snapshot.total_mismatch` | 2 |

## Snapshot Pair Summary

| Metric | Expected | Actual |
|---|---:|---:|
| groups | 11 | 11 |
| instances | 0 | 0 |
| faces | 529 | 544 |
| edges | 1234 | 1279 |
| vertices | 452 | 766 |
| scenes | 2 | 2 |

Bounding boxes: expected `44 x 158 x 15.850000000000001 mm`, actual `44 x 158 x 15.85 mm`

## Warning Classification Delta

- Warning gate: **pass**
- Unexpected warnings: expected runtime `0`, actual runtime `0`

| Bucket | Expected Total | Actual Total | Delta | Expected Needs Review | Actual Needs Review |
|---|---:|---:|---:|---:|---:|
| `queue_material_limitation` | 0 | 3 | 3 | 0 | 0 |

## Image Structured Next Actions

- Review warning-level snapshot diffs and decide whether they need topology tolerance or real geometry fixes.
