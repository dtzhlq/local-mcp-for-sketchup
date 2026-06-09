# Photo-Grade Readiness QA

Readiness: technical_baseline
Photo-grade candidate: no
Input asset status: available

| Gate | Verdict | Candidate-ready | Key metrics |
|---|---|---:|---|
| scale | review | no | checked_scale_anchors=5, distinct_non_site_families=3, winner_anchor_type=parking_bay_width_span, winner_residual=0.026 |
| subdivision | review | no | source=auto_ground_plan_r10, checked_ground_regions=17, checked_subdivision_cells=899, coverage_ratio=0.526 |
| line_grid | pass | yes | checked_parking_lines=2, checked_road_axes=1, row_spacing_residual=0.095, parking_grid_count_residual=0 |
| top_view_overlay | pass | yes | checked_regions=18, checked_lines=2, mean_mask_iou=0.964, min_mask_iou=0.835 |
| oblique_facade | review | no | oblique_images=2, visible_facade_items=15, primary_height_tier_residual=0.251, roof_ridge_evidence=false |
| promotion | review | no | promoted_geometry=12, review_candidate=5, helper_only=1, rejected=0 |

## Blockers

- warn: scale - scale_anchor_review_required
- warn: subdivision - r10_gap_above_candidate_threshold
- warn: subdivision - r10_layout_prior_conflicts_rejected
- warn: oblique_facade - primary_height_tier_residual_above_candidate_threshold
- warn: oblique_facade - missing_roof_ridge_or_vanishing_line_evidence
- warn: oblique_facade - facade_openings_lack_per_instance_edge_evidence
- warn: promotion - review_candidates_still_present
- warn: promotion - helper_only_candidates_still_present
- warn: promotion - dense_detail_lacks_per_instance_photo_grade_evidence

## Correction Targets

- scale: add_or_confirm_independent_scale_anchor (scale_anchor_review_required)
- subdivision: refine_ground_plan_region_masks (r10_gap_above_candidate_threshold)
- subdivision: refine_ground_plan_region_masks (r10_layout_prior_conflicts_rejected)
- oblique_facade: add_oblique_facade_edge_or_height_evidence (primary_height_tier_residual_above_candidate_threshold)
- oblique_facade: add_oblique_facade_edge_or_height_evidence (missing_roof_ridge_or_vanishing_line_evidence)
- oblique_facade: add_oblique_facade_edge_or_height_evidence (facade_openings_lack_per_instance_edge_evidence)
- promotion: downgrade_candidate_or_add_per_instance_evidence (review_candidates_still_present)
- promotion: downgrade_candidate_or_add_per_instance_evidence (helper_only_candidates_still_present)
- promotion: downgrade_candidate_or_add_per_instance_evidence (dense_detail_lacks_per_instance_photo_grade_evidence)
