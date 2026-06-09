# Auto GroundPlan R10 QA

Verdict: review

| Metric | Value |
|---|---:|
| Evidence candidates | 27 |
| Canonical regions | 17 |
| Subdivision cells | 899 |
| Road/building overlap | 0 |
| Raw contour leakage | 0 |
| Parent/child double occupancy | 0 |
| Canonical overlap | 0 |
| Gap ratio | 0.474 |
| Gap completion ratio | 0.557 |
| Remaining unknown gap ratio | 0.198 |
| Open paved helper ratio | 0.115 |
| Road candidate review count | 0 |
| Rejected priors | 13 |

## Issues

- warn: structured_plan.gap_above_candidate_threshold - gap_above_candidate_threshold
- warn: structured_plan.layout_prior_conflicts_rejected - layout_prior_conflicts_rejected
- warn: structured_plan.canonical_regions_include_review_candidates - canonical_regions_include_review_candidates
- warn: structured_plan.boundary_corridor_width_residual_above_review_threshold - boundary_corridor_width_residual_above_review_threshold

## Correction Targets

- structured_plan.gap_above_candidate_threshold: keep_gap_visible_or_add_pixel_region_evidence (gap_above_candidate_threshold)
- structured_plan.layout_prior_conflicts_rejected: keep_conflicting_layout_prior_diagnostic_only (layout_prior_conflicts_rejected)
- structured_plan.canonical_regions_include_review_candidates: review_auto_ground_plan_r10 (canonical_regions_include_review_candidates)
- structured_plan.boundary_corridor_width_residual_above_review_threshold: review_auto_ground_plan_r10 (boundary_corridor_width_residual_above_review_threshold)
