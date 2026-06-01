# Product Modeling Architecture Refactor Plan

> Date: 2026-06-01
> Status: R5 product sample expansion complete; ambulance, Switch, and Fuji camera now run through ProductProfile -> PartGraph -> DSL -> Layout QA + Reference Visual QA in mock and live queue, with saved queue SKP artifacts; R6 physical consistency QA now covers all three product samples, proposal review output has a proposal-applied mock/queue QA chain; R7 building-group now has massing mock/live queue QA plus accepted-all roofline/facade/opening detail proposals with feature Reference Visual QA and saved final queue SKP; VisualRelationGraph writes image-space relation candidates into ObservationSet/EvidenceGraph, validates Switch and building-group relation fixtures with mirror negatives, feeds building-group relation evidence into massing PartGraph relationships and spatial physical_relations, surfaces fine building candidates as review-gated PartGraph proposals, and can promote eight warehouse/parking/tree candidates into real parts after accepted review; Grounding v2 now adds provenance schema, mask/contour evidence, camera/site calibration records, GeometryFit v2 residual QA, R8 helper-heavy dense-detail reporting, and a second building-group mock generalization gate
> Scope: upstream modeling architecture, not a full runtime rewrite

## Decision

Do not rewrite the whole project. Keep the current local MCP stack:

```text
JSON DSL -> Node bridge -> mock runtime / queue runtime -> SketchUp Ruby plugin
```

The weak boundary is above the DSL. Current examples can call newer feature and boolean operations, but they still often generate a box-based layout first and then decorate it. The first ambulance visual-quality refit shows the intended correction loop: reference-image anchors now fail the old seed snapshot, PartGraph parameters are adjusted, and the regenerated DSL passes layout QA plus Reference Visual QA in mock and queue. R5 extends that same standard beyond one vehicle sample: Switch and Fuji camera now have ProductProfiles, PartGraph compiler paths, Reference Visual QA specs, product-sample reports with fallback ratios, and live queue SKP artifacts. R6 adds a physical relation gate on the PartGraph itself, so support/contact/grounding failures can be corrected before treating a visually plausible layout as acceptable. The new VisualRelationGraph slice starts closing the remaining visual grounding gap by recording image-space relations with explicit basis/confidence/review state and comparing them with model projections.

The next architecture slice should introduce an explicit modeling pipeline:

```text
Images / user intent
  -> ObservationSet
  -> EvidenceGraph
  -> ProductProfile
  -> PartGraph / ModelPlan
  -> FeatureMappingPlan
  -> JSON DSL
  -> mock / queue runtime
  -> Layout QA + Reference Visual QA
  -> CorrectionPatch
```

## Layer Goals

### 1. Runtime Layer

Keep the runtime contract stable. Runtime work should be driven by repeated needs from the compiler and QA, not by one-off hand-authored examples.

Required refinements:

- Keep `operation_registry`, mock dispatch, Ruby dispatch, docs, and contract tests as the source of runtime truth.
- Add product primitives only when a `ProductProfile` or compiler repeatedly needs them.
- Keep feature and boolean operations as execution tools, not as substitutes for part recognition.
- Record semantic metadata on generated groups so QA and review can trace a DSL object back to a part id and evidence source.

Near-term candidates:

- `window_frame` / framed transparent panel helper.
- `lightbar_lens` / rounded translucent lens helper.
- wheel arch / fender helper.
- better shell/profile helpers for sloped cab fronts and toy-vehicle rounded bodies.
- robust multi-tool boolean strategy, likely by composing tools before a difference rather than chaining ambiguous split results.

### 2. Modeling Plan Layer

Stop treating acceptance examples as direct DSL scripts. New product examples should produce a model plan or part graph first, then compile to DSL.

The `PartGraph` should represent:

- product type and profile, for example `vehicle_ambulance`, `game_controller`, `childrens_room`;
- parts and relationships, for example body, cab, windshield, side window, wheel, lightbar, stripe, text label;
- parameters, for example size, thickness, slope, radius, curvature, attachment face, offset, repetition;
- provenance, for example `observed`, `profile_default`, `template_prior`, `manual_confirmed`;
- feature intent, for example `cut_recess`, `through_hole`, `raised_rib`, `printed_decal`, `transparent_panel`;
- fallback state, for example `real_feature_op`, `visual_helper`, `box_approximation`, `needs_review`.

Compiler rules:

- Compile `PartGraph -> DSL`, not `image observations -> DSL` directly.
- If a part lacks enough evidence, the compiler must lower confidence or emit a review item instead of silently filling it with profile defaults.
- Each compiled DSL object should carry `qa.part_id`, `qa.role`, and evidence/fallback metadata.

### 3. Image Structured Layer

The image-structured subproject needs to move from profile prior plus evidence reporting toward actual cross-view geometry evidence.

Required upgrades:

- Multi-view scale calibration and view alignment.
- Keypoint extraction for product-specific anchors.
- Contour/polyline extraction instead of coarse bbox-only evidence.
- Part candidates with source pixels, confidence, and view id.
- Cross-view part matching, including conflicts and missing evidence.
- VisualRelationGraph candidates for left/right/up/down order, containment, alignment, same-row, touching, mirrored pairs, and centered-on relationships, each with source image, bbox/keypoint/semantic-anchor basis, confidence, and review state.
- Explicit distinction between geometry evidence and semantic labels.
- Optional VLM use only for semantics and ambiguity checks, not as the source of exact geometry.

For current samples:

- Switch: reduce Switch layout prior weight and prevent single-view inputs from producing the same confidence as multi-view inputs; current first VisualRelationGraph fixture covers joystick/button/D-pad/screen/handle relationships and a mirror negative.
- Ambulance: add `vehicle_ambulance` profile and produce an evidence-backed part graph before any DSL generation.
- Building group: first relation fixture is in place; coarse blue-roof hall / warehouse row / parking / site / tank relationships are checked against the massing projection, while four warehouse units, parking rows/aisle, and tree-row relationships are surfaced as review-gated `part_candidates` proposals. The accepted promotion fixture now accepts all eight candidates, turns the two row boxes into reference containers, preserves the parking/site base context, and validates the resulting 22-part graph with relation and pixel-footprint checks. GeometryFit v2 adds top-view affine projection calibration plus center, extent, relation, scale, handedness, grounding-isolation, and dense-detail helper/review residuals. Current mock/live queue proof passes for the candidate chain after isolating the lower-right parking rows, negative-space drive aisle, and tree row as mask/gap/contour-grounded evidence; R8 remains a no-texture editable geometry boundary with helper-heavy dense details excluded from photo-grade coverage. A second generated building-group sample now runs the same ObservationSet/EvidenceGraph/PartGraph/GeometryFit v2 primary gate. It remains generated-image technical proof, not photo/survey-grade reconstruction.
- Children's room: keep as scene/layout acceptance, but do not use it as proof of product-detail reconstruction.

### 4. QA Layer

`validate_model` is useful but currently checks layout validity, not visual similarity. Add a reference visual QA layer.

Keep:

- `validate_model` for support, inside, separation, allowed collisions, and layout sanity.
- mock/queue snapshot diff for runtime parity.

Add:

- `validate_reference_model` or a reference mode inside `validate_model`.
- Orthographic preview-to-reference comparison for front/top/side views.
- Silhouette aspect-ratio checks.
- Keypoint position checks, for example wheel centers, window corners, windshield slope, lightbar center, text baseline.
- Part area and relative placement checks.
- Correction suggestions that target `PartGraph` fields, not raw DSL coordinates.

The goal is to catch "not floating" and "looks like the reference" as separate gates.

## Proposed Artifacts

Add or formalize these artifacts:

- `ProductProfile`: product taxonomy, default constraints, expected views, required parts, allowed primitives, QA rules.
- `PartGraph`: part tree, relations, parameters, evidence status, feature intent, fallback state.
- `FeatureMappingPlan`: selected runtime operations for each part or feature.
- `ReferenceVisualQAReport`: reference alignment scores, keypoint deltas, silhouette metrics, correction suggestions.
- `CorrectionPatch`: edits against `PartGraph` and evidence status, not only raw DSL output.

## Milestones

### R0: Record And Contracts

Deliverables:

- This plan linked from `README.md`, `PROJECT_STATUS.md`, and the image-structured plan.
- Initial schema names and artifact boundaries agreed.
- No runtime changes required.

Acceptance:

- `git diff --check` passes.
- New thread can start from this plan without re-reading the full conversation.

### R1: ProductProfile And PartGraph Schemas

Deliverables:

- `product-profile.schema.json`.
- `part-graph.schema.json`.
- Minimal `vehicle_ambulance` profile.
- A manually-authored ambulance `part-graph.json` based on current reference images.

Acceptance:

- Schema validation test.
- Review report shows part ids, evidence state, fallback state, and profile defaults.

Implementation status:

- Done in first slice: `schema/product-profile.schema.json`, `schema/part-graph.schema.json`, `examples/product-profiles/vehicle_ambulance.json`, and `examples/part-graphs/ambulance-reference.part-graph.json`.
- The ambulance part graph started from the current manually accepted reference geometry, but is now the edit target for reference-image corrections instead of generated DSL coordinates.

### R2: PartGraph Compiler

Deliverables:

- `compile-part-graph-to-sketchup-dsl.mjs` or an equivalent compiler path.
- Ambulance example compiles from `PartGraph` to DSL.
- DSL objects carry stable `id`, `target_id`, and `qa.part_id` metadata.

Acceptance:

- Mock build passes.
- `validate_model` passes.
- Queue build/save passes when SketchUp is available.
- Generated DSL no longer comes from a direct hand-authored object placement script.

Implementation status:

- Done in first slice: `src/product-modeling/part-graph-compiler.mjs`, `scripts/compile-part-graph-to-sketchup-dsl.mjs`, and `npm run part-graph:compile-ambulance`.
- `npm run acceptance:generate-ambulance` now compiles `vehicle_ambulance profile + ambulance PartGraph -> JSON DSL`; the generated DSL carries `metadata.source=part_graph_compiler` plus stable `qa.part_id` metadata on generated objects.

### R3: Reference Visual QA

Deliverables:

- Orthographic preview generation reused from model QA.
- Reference alignment spec for ambulance front/top/side.
- Keypoint and silhouette checks for at least body, cab, windshield, side windows, wheels, lightbar, and text/stripe placement.

Acceptance:

- A model with valid layout but bad proportions fails reference QA.
- QA suggestions point back to `PartGraph` fields.

Implementation status:

- First slice landed: `src/reference-visual-qa.mjs`, `schema/reference-visual-qa.schema.json`, `examples/reference-visual-qa/ambulance-reference.json`, `scripts/generate-reference-visual-qa-reports.mjs`, Bridge/CLI/MCP/HTTP `validate_reference_model`, and `npm run qa:reference-visual`.
- The first gate reuses the existing orthographic preview renderer and checks normalized silhouette aspect, keypoints, extent ratios, area ratios, and relative placement against the ambulance sample. It deliberately points correction suggestions to `parts[...].shape.parameters...` instead of generated DSL coordinates.
- Follow-up slice completed: the ambulance spec now uses reference-image anchors for body/cab silhouette, cab height, windshield rake, side/driver windows, roof lightbar, side stripe, and text size. The old seed snapshot fails the updated gate with 17 issues, while the refit PartGraph passes layout QA and Reference Visual QA in both mock and queue runtimes.

### R4: Image Evidence Upgrade

Deliverables:

- Contour/polyline evidence.
- Keypoint candidates.
- Cross-view part matching.
- Evidence confidence and missing-view handling.
- Reduced template-prior confidence for single-view Switch outputs.

Acceptance:

- Single-image Switch outputs are explicitly lower confidence.
- Ambulance part graph can be partially generated from image evidence, with missing fields marked for review.

Implementation status:

- First slice landed in `projects/image-structured-modeler`: `analyze-image-set` now emits coarse contour/polyline, bbox keypoints, profile-aware ambulance view hints, scale calibration, and observation-level part matches.
- Added `generate-part-graph-from-observations.mjs`, `npm run image-structured:build-ambulance-part-graph`, and `projects/image-structured-modeler/examples/ambulance/part-graph.generated.json`.
- The generated ambulance PartGraph uses the accepted ambulance PartGraph as a seed for shape parameters, then replaces evidence status/provenance with image-derived `observed` / `inferred` / `needs_review` state. Current output has 53 parts: 10 observed, 41 inferred, 2 needs_review, and 0 profile-default evidence-status parts.
- Added no-seed `part-graph.skeleton.json` generation for the 7 profile-required ambulance roles. It carries inferred image sources but keeps all inferred-only geometry review-gated.
- Post-R5 / R6 first slice: no-seed skeleton parts now include review-gated `parameter_proposals`. These proposals combine profile role ratios, image scale calibration, and bbox/keypoint evidence into explicit candidate PartGraph paths without automatically applying them as trusted geometry. Current ambulance no-seed skeleton has 20 proposals across 7 profile-required roles; the seed generated PartGraph records 45 proposals across 17 proposal-capable parts.
- Post-R5 / R6 second slice: accepted proposals can now be converted into a normal `part_graph_correction_patch` with `source: "parameter_proposal_review"`. The ambulance fixture accepts body and cab shape-parameter proposals, emits `correction-patch.parameter-proposals.json` with 2 set edits, and applies it to `part-graph.proposal-applied.json` while appending `parameter_proposal_review` evidence and `qa.parameter_proposal_applied`.
- Post-R5 / R6 third slice: `image-structured:proposal-review-ambulance` generates a proposal review HTML for the no-seed ambulance skeleton. It lists the 20 review-gated proposals, preselects the accepted fixture subset, shows patch targets, and exports accepted proposal JSON for the proposal-to-patch builder.
- Post-R5 / R6 fourth slice: `image-structured:proposal-review-chain-ambulance` and `image-structured:proposal-review-chain-ambulance:queue` close the review -> patch -> proposal-applied DSL -> QA loop. The current accepted subset only confirms body/cab shape parameters, so the chain intentionally reports `review_required: true`: layout and Reference Visual QA fail while physical consistency passes. The queue variant saves `output/image-structured-ambulance-proposal-applied.skp` as evidence that live runtime QA is connected without treating the partial no-seed skeleton as acceptance-ready.
- Added Reference Visual QA correction patch generation/application and an explicit PartGraph quality gate. The current ambulance generated model passes Reference Visual QA with 0 issues, emits an empty patch, and passes quality with `profile_default_ratio=0`, `needs_review_ratio=0.038`, and scale confidence `0.86`.
- `npm run test:image-structured` now validates this R4/R6 path, including contour/keypoint evidence, cross-view matching, scale calibration, seed and no-seed PartGraph schema validity, no-seed parameter proposal coverage, proposal-to-patch authoring, proposal-applied compile/QA review gating, compile-through to the normal PartGraph compiler, correction patch schema/application, and quality report.
- Limitation: the seed generated PartGraph intentionally preserves shape parameters from `examples/part-graphs/ambulance-reference.part-graph.json`. After the ambulance refit this seed is better aligned with the reference QA gate, but R4 still proves the evidence/correction path rather than no-seed photo reconstruction.

### R5: Product Sample Expansion

Deliverables:

- Switch, ambulance, and one new product sample all run through ProductProfile -> PartGraph -> DSL -> Layout QA + Reference Visual QA.
- Fallback ratio is reported per sample.

Acceptance:

- Reports distinguish `real_feature_op`, `structured_primitive`, `visual_helper`, `box_approximation`, and `needs_review`.
- Release status can be updated based on evidence-backed sample quality, not on runtime capability alone.

Implementation status:

- First slices landed: `examples/product-profiles/game_controller_switch.json`, `examples/part-graphs/switch-controller-reference.part-graph.json`, `examples/acceptance-switch-controller.json`, `examples/reference-visual-qa/switch-controller-reference.json`, plus `examples/product-profiles/camera_fuji_x_t10.json`, `examples/part-graphs/fuji-camera-reference.part-graph.json`, `examples/acceptance-fuji-camera.json`, `examples/model-qa/fuji-camera-reference.json`, and `examples/reference-visual-qa/fuji-camera-reference.json`.
- `npm run part-graph:compile-switch` and `npm run part-graph:compile-fuji-camera` rebuild product acceptance DSL files from ProductProfile + PartGraph, and `npm run qa:model-layout` uses those compiled artifacts instead of direct hand-authored product DSL.
- `npm run qa:reference-visual` now covers ambulance, Switch, and Fuji. The Switch gate checks normalized top/front silhouette, shell/stick/button/keypoint placement, extent ratios, area ratios, relative placement, and orientation/chirality; the Fuji gate checks front/top/rear silhouette, lens/screen/viewfinder/dial keypoints, extent ratios, area ratios, relative positions, and left/right controls orientation. The reference QA regressions verify both a right-thumbstick drift that still passes layout QA and a mirrored left/right thumbstick swap fail Reference Visual QA with `reference.orientation_order`.
- `npm run qa:product-samples` reports per-sample compile freshness, layout QA, Reference Visual QA, physical consistency QA, evidence ratios, and fallback ratios. Current mock report passes for ambulance, Switch, and Fuji; fallback ratios are ambulance `real_feature_op 0.094`, `box_approximation 0.094`, `visual_helper 0.792`, `profile_default 0.019`; Switch `box_approximation 0.157`, `visual_helper 0.843`; Fuji `real_feature_op 0.091`, `structured_primitive 0.667`, `box_approximation 0.03`, `visual_helper 0.212`. The Fuji refit now adds lens rings/cap tabs, FUJIFILM/X-T10 text, dial markers, and separate rear buttons; Reference Visual QA checks these details so the older 21-part model no longer satisfies the current spec.
- REST3D-inspired physical consistency now covers all three product samples: `physical_relations` record 26 ambulance support/contact/grounding relations, 25 Switch shell/control-stack relations, and 30 Fuji camera support/contact relations. The Fuji coverage now includes the visual refit details that previously bypassed the physical gate: lens rings, lens-cap pinch/logo pieces, dial markers, shutter button, strap lugs, rear eyepiece, rear screen, and individual rear buttons. `npm run qa:physical-consistency` emits standalone reports, and regressions intentionally separate an ambulance side window, a Switch thumbstick cap, the Fuji front lens barrel, and a Fuji rear detail button to verify failing `physical.face_contact_gap` reports plus `update_part_graph` origin correction targets.
- `npm run qa:product-samples:queue` runs the same three-sample gate against live SketchUp and saves SKP artifacts under `output/product-sample-qa/queue/artifacts/`. Current queue totals are ambulance 57 groups / 1155 faces / 3044 edges / 5,245,446 bytes, Switch 70 groups / 2986 faces / 5598 edges / 396,753 bytes, and Fuji 33 groups / 1315 faces / 3244 edges / 303,868 bytes.

## Immediate Next Slice

R5 is complete as a product-sample expansion gate. The current R6 hardening boundary is also complete for ambulance no-seed proposals, proposal-applied QA/queue review gating, and three-sample physical consistency. R7 has completed the current generated-image building-group technical baseline: evidence, known-element scale, review-gated massing, mock/live queue layout/reference QA, saved massing SKP, accepted-all roofline/facade/opening feature intents, feature Reference Visual QA, physical consistency, saved final queue SKP, first VisualRelationGraph fixture coverage for Switch plus building-group relation-derived part candidates, and eight-candidate promotion into real warehouse/parking/tree PartGraph parts with pixel footprint QA. Grounding v2 now runs as a coded gate: candidate chain GeometryFit passes, R8 no-texture geometry is forced into `review` because dense details are helper-heavy, and the second generated building-group sample passes the primary footprint/relation/scale/handedness mock gate without sample-specific site constants. Next slice is the real-photo/oblique building boundary at scene scale:

1. Keep using the ambulance refit as the reference standard: old-looking seed models must fail the image-anchored gate; fixes should land in PartGraph fields and feature intents, not generated DSL coordinates.
2. Move the second generated building gate to real-photo or stronger oblique input, and require facade/height photo-grade claims to pass oblique cues instead of helper/review status.
3. Reuse proposal review and correction patch semantics for scene/model decisions, and keep accepted subsets tied to mock/live QA evidence before broadening any new applied detail set.
4. Expand the same product-sample gate beyond ambulance, Switch, and Fuji, including scene/product boundary cases such as children's room.
5. Continue reducing template and visual-helper debt, especially in non-vehicle samples where the gate still passes by using structured primitives or helper geometry.

```text
reference anchors -> PartGraph correction -> JSON DSL -> Layout QA + Reference Visual QA
```
