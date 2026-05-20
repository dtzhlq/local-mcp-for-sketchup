# Switch Controller Mock/Queue Snapshot Diff Report

- Verdict: **pass**
- Level: **ok**
- OK: **true**
- Tolerance: `1 mm`
- Expected runtime: `mock`
- Actual runtime: `queue`
- Reset first: `true`

## Summary

| Metric | Count |
|---|---:|
| Total diffs | 0 |
| Errors | 0 |
| Warnings | 0 |
| Info | 0 |

## Top Issues

No issues. Nice and clean.

## Recommendations

- No follow-up needed from the current report.

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

- Promote this diff report into the regular image-structured test loop as the queue parity baseline.
- Reload the SketchUp plugin after QA metadata changes, then verify queue-side warning classifications use runtime metadata.

