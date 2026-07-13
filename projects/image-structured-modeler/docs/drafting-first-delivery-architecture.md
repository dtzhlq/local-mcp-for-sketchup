# Drafting-First Delivery Architecture

This document defines the current authority and promotion rules for image-structured modeling. The implementation is a review-gated technical baseline, not an automatic photo-grade reconstruction claim.

## Pipeline

```text
source image(s) / drawings
  -> image geometry strategy
  -> structure evidence
  -> perspective calibration hypotheses
  -> accepted calibration review
  -> visible topology and domain surface graph
  -> DraftViewGraph derived display
  -> visible-coverage review
  -> plane/surface-local evidence and review
  -> reviewed PartGraph promotion
  -> SketchUp DSL
  -> mock QA
  -> optional live smoke
```

`DraftViewGraph` keeps the stable `front`, `left_or_right_side`, `top`, and `oblique_context` slots for review UI and MCP briefs. These slots may be observed, partial, inferred, or unknown. They are never a substitute for source evidence, calibration, visible topology, scale, or hidden geometry.

## Authority Rules

1. Raw lines are axis-neutral. A review assigns direction families to model axes only after pixel support and residual gates pass.
2. Short, isolated, clean segments are valid structure evidence. Length and local line density are ranking signals, not correctness proofs.
3. Shifted-lens or vertically rectified images may keep the vertical direction at infinity. The pipeline must not force a false finite blue-axis vanishing point.
4. Visible topology precedes semantic plane names. A facade recess, room wall, vehicle side, or product face is promoted only from an accepted domain graph id.
5. Local details bind to an accepted plane or surface. Free text, VLM labels, zero-area points, shadows, and unreviewed candidates cannot produce geometry.
6. Every accepted local detail must pass source-image reprojection or an equivalent cross-view consistency check.
7. No review decision compiles directly. Promotion and compilation remain separate gates.

## Domain Routes

| Input/domain | Authoritative graph | Key gate |
| --- | --- | --- |
| Single perspective facade | `facade_plane_graph_v1` | calibration + visible corner-chain topology |
| One-point interior | `room_surface_graph_v1` | finite depth family + reviewed room envelope |
| Product or vehicle | `object_surface_graph_v1` | reviewed physical surfaces + target-part-bound local features |
| Bird-eye site | GroundPlan / LandCover / BoundaryGraph | ground-plane evidence; facade axes forbidden as site truth |
| Orthographic drawing | `draft_view_graph_v1` from document parse | document provenance and scale review |
| Multiple perspective images | multi-view calibration and geometry reviews | correspondence, pose, scale, conflict, and hidden closure |

## Multi-View Gates

Multi-view processing is intentionally staged:

1. `multi_view_calibration_review_result_v1` accepts view and correspondence identities only. Geometry remains disabled.
2. `multi_view_relative_pose_review_result_v1` recomputes transform residuals. A homography has `single_plane` scope; a reviewed rigid transform supported by non-collinear 3D points has `object_frame` scope.
3. `metric_scale_review_result_v1` requires a known-distance anchor whose metric value agrees with its model-space distance.
4. `multi_view_conflict_review_result_v1` requires every blocking conflict to be resolved. Evidence rejected as an outlier cannot also support the accepted pose.
5. `hidden_geometry_review_result_v1` requires explicit hidden roles and source evidence. A reviewed user assumption can support a mock study but cannot satisfy release eligibility.
6. `geometry_fusion_gate_result_v1` checks that scale and conflict results came from the same pose edge set. A successful result permits reviewed PartGraph promotion only; `direct_compile_allowed` is always false.

## Completion

`visual_complete` and `release_complete` are different claims.

- Visual completion requires accepted visible calibration/topology/surfaces/details and reprojection QA.
- Occluded regions may be omitted only through an accepted polygonal exclusion with a reason and permanent non-promotable/non-compilable status.
- Release completion additionally requires real metric scale and reviewed hidden closure or sufficient accepted multi-view evidence.
- Nominal mock dimensions, a watertight study mass, inferred DraftView slots, or explicit user assumptions do not satisfy release completion.

## Verified Commands

```bash
npm run benchmark:image-structured:calibration
npm run benchmark:image-structured:calibration-routing
npm run image-structured:london-corner-facade-study-with-details
npm run image-structured:interior-hallway-study
npm run image-structured:ambulance-object-surface-study
npm run benchmark:image-structured:tier0
npm run benchmark:image-structured:tier1
npm run test:image-structured
```

Tier 0 uses committed fixtures. Tier 1 uses external source adapters and never downloads full datasets. Missing external subsets remain explicitly blocked. Live SketchUp is not part of the default gate.

ObjectNet3D, Pix3D, and CMP Facade subsets use `external_benchmark_sample_package_v1`. Run `image-structured:prepare-tier1-subset` after staging the selected source image, annotation, and CAD/label files. The adapter verifies required roles, package-relative paths, raster readability, and SHA-256 before reporting `ready_for_evidence_review`; this readiness never grants geometry promotion.

## Remaining Delivery Gaps

- Real multi-view pose fusion is contract-tested with deterministic synthetic geometry; a reviewed real-image multi-view positive sample is still required.
- ObjectNet3D, Pix3D, and CMP Facade subsets remain external; the package adapters are implemented, but fixed local subsets still need to be prepared before dataset metrics can run.
- Automatic semantic detail classification and complete visible-detail coverage are not yet reliable enough to bypass review.
- Single-image studies without measured scale and hidden closure remain release-incomplete even when their visible mock QA passes.
