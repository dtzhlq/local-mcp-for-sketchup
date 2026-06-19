# Vision Evidence Policy Correction Patch

- Status: `ready_for_vision_evidence_policy_update`
- Apply scope: `vision_evidence_set_policy_only`
- Apply allowed: `true`
- Compile allowed: `false`
- Geometry promotion allowed: `false`
- Actions: `5`
- Semantic candidate actions: `0`

## Actions

### ground_plane:1:oblique

- Action: `annotate_ground_plane_policy_review`
- Evidence type: `view_ground_plane`
- Target: `vision_evidence_set_v1.view_ground_plane.images[0].usage_policy`
- Decision: `confirmed_review_only_context`
- Risk disposition: `kept_as_context_not_planar_groundplan`
- Geometry promotion allowed: `false`
- Note: Oblique image remains visual context and must not seed planar GroundPlan geometry.

### ground_plane:2:top

- Action: `annotate_ground_plane_policy_review`
- Evidence type: `view_ground_plane`
- Target: `vision_evidence_set_v1.view_ground_plane.images[1].usage_policy`
- Decision: `confirmed_planar_groundplan_candidate`
- Risk disposition: `accepted_as_reviewed_planar_candidate`
- Geometry promotion allowed: `false`
- Note: Top view may remain a reviewed planar GroundPlan candidate; downstream GroundPlan/QA gates still decide promotion.

### ground_plane:3:oblique

- Action: `annotate_ground_plane_policy_review`
- Evidence type: `view_ground_plane`
- Target: `vision_evidence_set_v1.view_ground_plane.images[2].usage_policy`
- Decision: `confirmed_review_only_context`
- Risk disposition: `kept_as_context_not_planar_groundplan`
- Geometry promotion allowed: `false`
- Note: Oblique image remains visual context and must not seed planar GroundPlan geometry.

### edge_class:roof_internal_seam

- Action: `annotate_edge_class_policy_review`
- Evidence type: `edge_class_policy`
- Target: `vision_evidence_set_v1.edges[class=roof_internal_seam]`
- Decision: `confirmed_keep_roof_seam_rejected`
- Risk disposition: `kept_rejected_not_boundary`
- Geometry promotion allowed: `false`
- Note: Roof/internal seam edges stay rejected for site and road boundary promotion.

### edge_class:unknown

- Action: `annotate_edge_class_policy_review`
- Evidence type: `edge_class_policy`
- Target: `vision_evidence_set_v1.edges[class=unknown]`
- Decision: `confirmed_keep_unknown_review_only`
- Risk disposition: `kept_review_only_until_reclassified`
- Geometry promotion allowed: `false`
- Note: Unknown edges remain review-only until explicitly reclassified.
