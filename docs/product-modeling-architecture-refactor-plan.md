# Product Modeling Architecture Refactor Plan

> Date: 2026-05-29
> Status: R1/R2 first implementation landed
> Scope: upstream modeling architecture, not a full runtime rewrite

## Decision

Do not rewrite the whole project. Keep the current local MCP stack:

```text
JSON DSL -> Node bridge -> mock runtime / queue runtime -> SketchUp Ruby plugin
```

The weak boundary is above the DSL. Current examples can call newer feature and boolean operations, but they still often generate a box-based layout first and then decorate it. That is why the ambulance rerun used `cut_recess`, `add_boss`, `add_raised_rib`, and `boolean_difference`, but the windows, windshield, text placement, lightbar shape, thicknesses, and proportions still did not materially improve.

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
- Explicit distinction between geometry evidence and semantic labels.
- Optional VLM use only for semantics and ambiguity checks, not as the source of exact geometry.

For current samples:

- Switch: reduce Switch layout prior weight and prevent single-view inputs from producing the same confidence as multi-view inputs.
- Ambulance: add `vehicle_ambulance` profile and produce an evidence-backed part graph before any DSL generation.
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
- The ambulance part graph is still seeded from the current manually accepted reference geometry; it is now the edit target for future corrections instead of the generated DSL.

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

### R5: Product Sample Expansion

Deliverables:

- Switch, ambulance, and one new product sample all run through ProductProfile -> PartGraph -> DSL -> QA.
- Fallback ratio is reported per sample.

Acceptance:

- Reports distinguish `real_feature_op`, `visual_helper`, `box_approximation`, and `needs_review`.
- Release status can be updated based on evidence-backed sample quality, not on runtime capability alone.

## Immediate Next Slice

Start with R1 and R2:

1. Add schemas for `ProductProfile` and `PartGraph`.
2. Add `vehicle_ambulance` profile.
3. Move the ambulance acceptance path from direct DSL generation to:

```text
vehicle_ambulance profile + ambulance part graph -> compiler -> JSON DSL
```

4. Keep current runtime and `validate_model` unchanged unless the compiler proves a repeated missing primitive.

This is the smallest slice that changes model quality mechanics without destabilizing the working runtime.
