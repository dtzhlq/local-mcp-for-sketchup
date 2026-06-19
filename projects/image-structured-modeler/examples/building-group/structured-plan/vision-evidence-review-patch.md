# Vision Evidence Review Patch

- Status: `needs_review`
- Apply allowed: `false`
- Compile allowed: `false`
- Review items: `5`
- Ground-plane items: `3`
- Edge class items: `2`
- Semantic candidate items: `0`

## Review Items

### ground_plane:1:oblique

- Action: `confirm_ground_plane_usage_policy`
- Evidence type: `view_ground_plane`
- Target: `vision_evidence_set_v1.view_ground_plane.images[0].usage_policy`
- Required decision: `confirm_review_only_context_or_provide_better_view`
- Source image: `test/建筑群/ChatGPT Image 2026年5月31日 10_54_02.png`
- Risks: `oblique_view_not_planar_groundplan, camera_hint_review_required`
- Reason: Non-top imagery is useful context but must not be used as promoted planar GroundPlan evidence.

### ground_plane:2:top

- Action: `confirm_ground_plane_usage_policy`
- Evidence type: `view_ground_plane`
- Target: `vision_evidence_set_v1.view_ground_plane.images[1].usage_policy`
- Required decision: `confirm_top_view_planar_groundplan_candidate_or_downgrade`
- Source image: `test/建筑群/ChatGPT Image 2026年5月31日 10_54_37.png`
- Risks: `camera_hint_review_required`
- Reason: Top/near-orthographic view can seed planar GroundPlan, but camera and scale evidence still need review before promotion.

### ground_plane:3:oblique

- Action: `confirm_ground_plane_usage_policy`
- Evidence type: `view_ground_plane`
- Target: `vision_evidence_set_v1.view_ground_plane.images[2].usage_policy`
- Required decision: `confirm_review_only_context_or_provide_better_view`
- Source image: `test/建筑群/ChatGPT Image 2026年5月31日 10_54_52.png`
- Risks: `oblique_view_not_planar_groundplan, camera_hint_review_required`
- Reason: Non-top imagery is useful context but must not be used as promoted planar GroundPlan evidence.

### edge_class:roof_internal_seam

- Action: `confirm_edge_class_review_policy`
- Evidence type: `edge_class_policy`
- Target: `vision_evidence_set_v1.edges[class=roof_internal_seam]`
- Required decision: `confirm_roof_seams_are_not_site_or_road_boundaries`
- Source image: `test/建筑群/ChatGPT Image 2026年5月31日 10_54_37.png`
- Risks: `inside_building`
- Reason: Roof/internal seams create strong image edges but must not become site perimeter or road boundary geometry.

### edge_class:unknown

- Action: `confirm_edge_class_review_policy`
- Evidence type: `edge_class_policy`
- Target: `vision_evidence_set_v1.edges[class=unknown]`
- Required decision: `confirm_unknown_edges_remain_review_only_or_reclassify`
- Source image: `test/建筑群/ChatGPT Image 2026年5月31日 10_54_37.png`
- Risks: `unknown_source_context, weak_source_context`
- Reason: Unknown edge evidence needs human classification before any downstream geometry use.
