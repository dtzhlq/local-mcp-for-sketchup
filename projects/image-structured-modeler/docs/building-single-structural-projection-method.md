# Calibration-First Building Projection Method

This method turns one or more perspective images into review-gated calibration, topology, plane, and local-detail evidence. It does not infer metric plans or authorize SketchUp geometry by itself.

## Authoritative Order

1. Extract high-recall structure-line evidence.
   - The default backend is deterministic OpenCV WASM on CPU.
   - Multiscale Canny and HoughP retain raw, eligible, and balanced-seed layers.
   - Short clean segments are valid evidence; line length is not used as a proxy for correctness.
   - Local line density is recorded but never used as a hard rejection rule.

2. Estimate perspective direction families.
   - Balanced seeds propose hypotheses; the full eligible pool recovers support.
   - Direction families remain axis-neutral until review.
   - Two finite horizontal vanishing points plus a vertical direction at infinity support level, shifted-lens, or vertically rectified imagery.
   - In-image vanishing points remain valid for one-point interiors.

3. Review calibration before naming planes.
   - A review assigns detected families to `x_red`, `y_green`, and `z_blue`.
   - Accepted calibration allows rectification and topology inference only.
   - Calibration review always has `promotion_allowed=false`.

4. Build and review corner-chain topology.
   - Corner chains are separate from structure-line extraction and vanishing-point estimation.
   - The yellow fixture contains a draft `L-A-B-C-D` hypothesis: `L-A` visible left side, `A-B` recessed front, `B-C` return, and `C-D` main front.
   - Its local plan coordinates are topology-diagram coordinates, not metric depth.
   - The fixture remains draft until user acceptance.

5. Derive visible planes, then plane-local evidence.
   - The current yellow candidate planes are `visible_plane_left_side_la`, `visible_plane_recessed_front_ab`, `visible_plane_return_bc`, and `visible_plane_main_front_cd`.
   - `A-B` and `C-D` must not merge because `B-C` is the separating return.
   - Every plane stores its visible image quad, adjacency, occlusion order, source provenance, and unit rectification.
   - `plane_local_evidence_graph_v1` runs the same rectified-plane evidence extractor for every accepted plane; yellow plane IDs are fixture inputs, not detector branches.
   - Its local edges, corners, repetition hypotheses, regions, and instance proposals remain review evidence. A semantic `role_hint` is not an accepted window, door, equipment item, or duct.
   - FacadePlaneGraph records the pixel `coordinate_reference`; PlaneLocalEvidenceGraph records the actual source raster and composes the scale transform into each homography. Working-resolution pixels must never be sampled directly from a differently sized source raster.
   - A plane without semantic seeds receives an `unclassified_plane_local_detail` geometry-search region. Rectangle and parallel-strip evidence may still be proposed, but semantic classification remains pending.

6. Bind local details conservatively.
   - Window bands, storefront, and HVAC are candidates on the `C-D` main plane.
   - The visible rectangular duct zone is a review-only candidate on `visible_plane_left_side_la`; its roofline extension and section remain unresolved.
   - Shadow boundaries never become recess cuts by themselves.

7. Promote only through complete review lineage.
   - CandidateGraph records the accepted calibration and topology source artifacts and IDs.
   - Candidate promotion requires matching calibration, topology, DraftView, plane/surface, and detail reviews.
   - Both patch construction and patch application independently verify lineage.
   - Multi-view evidence identity, plane homography, object-frame pose, metric scale, conflict resolution, and hidden closure are separate reviews.
   - A reviewed homography authorizes only `single_plane` fusion. Object-frame release prerequisites require reviewed non-collinear 3D correspondences or an equivalent object-frame pose contract.
   - Reported residuals are never trusted directly; the evaluator recomputes 2D reprojection or 3D alignment residuals from accepted point correspondences and the submitted transform.
   - Review geometry declares either `proposal_geometry` or `manual_rectified_annotation`. Proposal geometry must overlap its source proposal; manual rectified geometry requires an explicit correction note.
   - `plane_local_detail_promotion_v1` verifies accepted ids, target planes, UV bounds, source-raster bounds, and local/source round-trip residuals. Any invalid accepted decision blocks the entire detail-promotion batch.

8. Assemble accepted topology before local details.
   - `image-structured:yellow-reviewed-model` converts the accepted `L-A-B-C-D` chain into one coherent closed study mass plus four semantic visible-plane parts.
   - The hidden `E` closure and nominal millimeter dimensions are explicit mock-study assumptions, never image-derived truth.
   - Plane-local details remain orange review candidates and are excluded from PartGraph/DSL geometry until a `local_detail_review_decision_v1` accepts their ids and plane bindings.
   - The resulting PartGraph and DSL are mock-study artifacts with `release_allowed=false`; they prove pipeline executability, not metric reconstruction completeness.

9. Treat orthographic drafts as derived views and verify by reprojection.
   - Front, side, and top drafts are generated from accepted calibration, visible-plane topology, and accepted local details.
   - They are not an independent source of metric depth and cannot override the accepted corner chain.
   - Accepted local detail geometry must project back into its source plane and source image within the reviewed tolerance before visual completion.

10. Separate visual completion from release completion.
   - `visual_complete` may be reached from a single image when visible calibration, topology, local detail review, assembly, and reprojection QA are accepted.
   - Occluded visible regions may be excluded only by an accepted polygonal coverage decision with a reason and permanent non-promotable/non-compilable status.
   - `release_complete` additionally requires a real metric scale anchor and reviewed hidden closure or sufficient multi-view evidence.
   - Nominal study scale and hidden mass closure never satisfy the release gate.

## Retired Method

The previous yellow-building path is rejected because it mixed screenshot-space corner coordinates with the source crop, used a single `B-C` line as green-axis support, and encoded a hardcoded plan depth ratio as if it were image-derived. The `image-structured:yellow-axis-calibration` and `image-structured:yellow-visible-effect` commands now use the calibration benchmark pipeline instead.

## Current Artifacts

Run:

```bash
npm run benchmark:image-structured:calibration
```

The output package contains:

- `structure-line-evidence.json` and raw/eligible/seed overlay;
- `perspective-calibration-hypotheses.json` and VP-family overlay;
- pending and fixture-only calibration review results;
- `facade-plane-graph.accepted-calibration.candidates.json`;
- `corner-chain-topology.candidates.json` and review decisions;
- `draft-view-graph.accepted-topology-fixture.json`;
- `mcp-modeling-brief.json` / `.md` in authoritative artifact order;
- no PartGraph or SketchUp geometry without accepted user reviews.

After explicit user calibration/topology/plane acceptance, run:

```bash
npm run image-structured:yellow-reviewed-model
```

This produces `03-topology-aware-part-graph.json`, `04-sketchup-dsl.mock-study.json`, mock QA, orthographic previews, and `08-isometric-study.png`. It also writes `plane-local-evidence/plane-local-evidence-graph.json`, rectified evidence overlays, a pending fail-closed review decision, and `plane-local-evidence/index.html` for layer inspection and review export. Real scale, hidden closure, accepted local details, and reprojection QA remain separate acceptance gates.

The accepted-detail technical regression is separate:

```bash
npm run image-structured:yellow-reviewed-model-with-details
```

It writes `09-plane-local-evidence-review.json`, `10-plane-local-detail-promotion.json`, `11-source-reprojection.png`, and `12-mcp-modeling-brief.reviewed-model.json`. The reviewed MCP brief orders DraftViewGraph, FacadePlaneGraph, PlaneLocalEvidence/local detail review, and promotion before PartGraph/DSL. The fixture authorizes mock-study geometry only; metric scale, hidden closure, non-fixture user review, and release remain blocked.

## Generalization Gate: Second Unknown Facade

The London corner-building adapter is the first non-yellow generalization gate. Its source raster is external and git-ignored; the repository keeps only the adapter configuration, checksum, attribution, accepted-review fixtures, and expected report contracts.

```bash
npm run image-structured:prepare-london-corner-facade
npm run image-structured:london-corner-facade-study
npm run image-structured:london-corner-facade-study-with-details
npm run benchmark:image-structured:tier1
```

The same detector and calibration code must satisfy all of these conditions without yellow fixture ids or role branches:

- recover two independent reviewed horizontal direction families plus the vertical family;
- preserve two primary facades and the narrow corner chamfer as three distinct visible planes;
- keep the chamfer orientation axis `unknown` instead of forcing it onto `x_red` or `y_green`;
- rectify all three planes and retain calibration-working-image to source-raster transforms;
- generate no PartGraph or DSL without accepted study review;
- generate only reviewed plane parts after visible-plane acceptance;
- create true wall-mesh voids only for accepted plane-local openings;
- pass source-image reprojection for every promoted local detail;
- keep partial detail coverage at `visual_status=in_progress` and all nominal-scale single-view studies at `release_status=blocked`.

The current accepted local-detail fixture contains eight manually tightened window quads. Proposal ids provide evidence lineage, but this fixture is not counted as automatic window detection. Remaining windows, the ground floor, roof screen, and street-occluded regions are explicitly outside its review coverage.

A separate tree/cable-occluded building image is the negative gate. It contains enough raw segments to produce VP hypotheses, but weak family-level pixel support must return `blocked_low_family_evidence_quality`. Segment count alone is never sufficient for calibration review.

## Domain Routes After Facades

The contracts are shared; geometry strategy is domain-specific:

1. One-point interiors keep the structure-evidence and calibration contracts, then derive a room-envelope surface graph. A finite depth VP and near-infinite horizontal/vertical directions are valid, and facade plane names are forbidden.
2. Products and vehicles use `object_surface_graph_v1` with silhouette, profile, symmetry, keypoint, and local feature evidence. Architectural red/green axis review is optional and must not be a product gate.
3. Multi-image sets calibrate every image independently. Accepted correspondences may merge evidence identity; plane homography remains plane-scoped, while object-frame promotion additionally requires reviewed 3D relative pose, metric scale, conflict resolution, and hidden-geometry evidence.
4. Bird-eye sites stay on the ground-plane, LandCover, BoundaryGraph, and GroundPlan route. Facade VP families cannot become site-boundary truth.
5. Hidden closure remains study-only unless visible in another accepted view or explicitly reviewed. No completion rule may infer release authority from a watertight mock mass.

The technical-baseline rollout now includes the second street facade, one-point interior, object/product surface, multi-view pose/scale/conflict/hidden gates, and legacy three-view authority cleanup. Each branch has a positive fixture, a blocked or forged-review path, a reprojection or cross-view consistency check, and a zero-false-promotion report. This proves review-gated executability; it does not yet prove automatic photo-grade reconstruction on unreviewed external datasets.
