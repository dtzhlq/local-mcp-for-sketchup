# Building Single Structural Projection Method

This method turns a single oblique building image into review-gated calibration, corner topology, facade, and plan projection evidence. It is not a SketchUp promotion path by itself.

## Order Of Operations

1. Fit structural line families before naming planes.
   - Use bounded seed/search windows for roof edges, street/floor base edges, vertical corner edges, and side-depth edges.
   - Score candidate lines with deterministic local Sobel support.
   - Prefer line-family/topology consistency over stronger local texture, pipe, shadow, or signage edges.

2. Estimate calibrated view axes from structural lines.
   - Primary facade width lines and side-depth lines produce separate vanishing points.
   - The horizon comes from those vanishing points, not from a bbox placeholder.
   - Vertical lines may be modeled as an infinite blue-axis family for shifted-lens, match-photo, or post-rectified imagery.
   - A view axis sourced from `weak_oblique_affine_review_only` remains rejected unless replaced by line-fit evidence.

3. Build corner-chain topology before deriving plans.
   - A/B/C/D corner chains are classified by axis family before assigning front/side semantics.
   - For the yellow building fixture, `A-B` and `C-D` are the red/front-axis family, `B-C` is the green/depth-return family, and `A-B` is behind `C-D`.
   - The accepted topology is `left_front_recess_notch`; it is accepted for derived drafting only and still has `promotion_allowed=false`.

4. Build visible plane quads from intersections.
   - `visible_plane_primary` is the main visible facade plane.
   - `visible_plane_recessed_left` is a separate side/return plane and must not be merged into the primary facade.
   - Each plane stores local unit projection so details can be bound plane-locally.

5. Build relative plan projection.
   - Front width is normalized to `1.0`.
   - Visible side-return depth becomes a relative depth ratio.
   - A reviewed corner chain with `A-B` behind `C-D` is encoded as `left_front_recess_notch`; the plan must not reverse the notch or collapse it to one straight front edge.
   - Hidden rear edges are marked inferred; metric scale remains unresolved without external evidence.

6. Bind local details only after plane projection.
   - Windows, storefronts, HVAC boxes, ducts, and parapets are projected into plane-local coordinates.
   - Shadow or lighting boundaries are separator evidence only, not cut/recess geometry.

7. Keep promotion fail-closed.
   - Structure projection may be `projection_review_ready`, but `promotion_allowed=false`.
   - Calibrated view and corner topology reviews may unlock derived drafting artifacts, but they do not unlock PartGraph or SketchUp promotion.
   - PartGraph and SketchUp output require accepted promotion review plus accepted local detail review.

## Current Yellow Building Fixture

The yellow building uses `buildBuildingSingleStructuralProjection(config)` through a yellow fixture config. It produces:

- line-fit structural overlay;
- calibrated red/green/blue axis evidence;
- accepted A/B/C/D corner-chain topology for derived drafting;
- corrected primary/side visible plane quads;
- rectified facade projections;
- normalized relative plan projection with `left_front_recess_notch`, where A-B is behind the C-D main front edge;
- fail-closed promotion patch until accepted review exists.
