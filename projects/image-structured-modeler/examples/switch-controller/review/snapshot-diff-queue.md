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
| Total diffs | 28 |
| Errors | 0 |
| Warnings | 28 |
| Info | 0 |

## Top Issues

| Severity | Type | Path | Name | Message |
|---|---|---|---|---|
| warn | `snapshot.field_mismatch` | `groups.Left_Joycon_Shell_From_Image_Plan.features` | Left_Joycon_Shell_From_Image_Plan | groups.Left_Joycon_Shell_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Right_Joycon_Shell_From_Image_Plan.features` | Right_Joycon_Shell_From_Image_Plan | groups.Right_Joycon_Shell_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Center_Grip_Body_From_Image_Plan.features` | Center_Grip_Body_From_Image_Plan | groups.Center_Grip_Body_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Center_Front_Recess_From_Image_Plan.features` | Center_Front_Recess_From_Image_Plan | groups.Center_Front_Recess_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Left_Joycon_Face_Dome_From_Image_Plan.features` | Left_Joycon_Face_Dome_From_Image_Plan | groups.Left_Joycon_Face_Dome_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Right_Joycon_Face_Dome_From_Image_Plan.features` | Right_Joycon_Face_Dome_From_Image_Plan | groups.Right_Joycon_Face_Dome_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Left_Rear_Grip_From_Image_Plan.features` | Left_Rear_Grip_From_Image_Plan | groups.Left_Rear_Grip_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Right_Rear_Grip_From_Image_Plan.features` | Right_Rear_Grip_From_Image_Plan | groups.Right_Rear_Grip_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Top_Left_Shoulder_Rail_From_Image_Plan.features` | Top_Left_Shoulder_Rail_From_Image_Plan | groups.Top_Left_Shoulder_Rail_From_Image_Plan.features differs |
| warn | `snapshot.field_mismatch` | `groups.Top_Right_Shoulder_Rail_From_Image_Plan.features` | Top_Right_Shoulder_Rail_From_Image_Plan | groups.Top_Right_Shoulder_Rail_From_Image_Plan.features differs |

## Recommendations

- No follow-up needed from the current report.

## Diff Type Breakdown

| Type | Count |
|---|---:|
| `snapshot.field_mismatch` | 28 |

## Snapshot Pair Summary

| Metric | Expected | Actual |
|---|---:|---:|
| groups | 24 | 24 |
| instances | 4 | 4 |
| faces | 1776 | 1776 |
| edges | 2964 | 2964 |
| vertices | 1212 | 1244 |
| scenes | 2 | 2 |

Bounding boxes: expected `280 x 174 x 40 mm`, actual `280 x 174 x 40 mm`

## Warning Classification Delta

- Warning gate: **pass**
- Unexpected warnings: expected runtime `0`, actual runtime `0`

| Bucket | Expected Total | Actual Total | Delta | Expected Needs Review | Actual Needs Review |
|---|---:|---:|---:|---:|---:|
| `queue_material_limitation` | 0 | 4 | 4 | 0 | 0 |

## Image Structured Next Actions

- Review warning-level snapshot diffs and decide whether they need topology tolerance or real geometry fixes.
