# Auto GroundPlan R10 QA

Verdict: review

| Metric | Value |
|---|---:|
| Evidence candidates | 16 |
| Canonical regions | 9 |
| Subdivision cells | 225 |
| Road/building overlap | 0 |
| Raw contour leakage | 0 |
| Parent/child double occupancy | 0 |
| Canonical overlap | 0 |
| Gap ratio | 0.67 |
| Gap completion ratio | 0.313 |
| Remaining unknown gap ratio | 0.278 |
| Open paved helper ratio | 0.031 |
| Road candidate review count | 1 |
| Rejected priors | 2 |

## Issues

- warn: structured_plan.gap_above_candidate_threshold - gap_above_candidate_threshold
- warn: structured_plan.remaining_unknown_gap_above_candidate_threshold - remaining_unknown_gap_above_candidate_threshold
- warn: structured_plan.gap_road_candidates_require_review - gap_road_candidates_require_review
- warn: structured_plan.parking_grid_review_required - parking_grid_review_required
- warn: structured_plan.canonical_regions_include_review_candidates - canonical_regions_include_review_candidates

## Correction Targets

- structured_plan.gap_above_candidate_threshold: keep_gap_visible_or_add_pixel_region_evidence (gap_above_candidate_threshold)
- structured_plan.remaining_unknown_gap_above_candidate_threshold: keep_gap_visible_or_add_pixel_region_evidence (remaining_unknown_gap_above_candidate_threshold)
- structured_plan.gap_road_candidates_require_review: keep_gap_visible_or_add_pixel_region_evidence (gap_road_candidates_require_review)
- structured_plan.parking_grid_review_required: refit_parking_grid_or_downgrade_to_review (parking_grid_review_required)
- structured_plan.canonical_regions_include_review_candidates: review_auto_ground_plan_r10 (canonical_regions_include_review_candidates)
