# Auto GroundPlan R10 Contract

R10/R10.5 is the default building-group grounding input for `PartGraph`. It is a conservative geometry-evidence layer, not a photo-grade claim.

## Output

`ObservationSet.grounding_r10.auto_ground_plan` and generated QA reports use:

- `evidence_candidates[]`: normalized pixel/prior evidence.
- `resolved_evidence[]`: evidence allowed to participate in canonical subdivision.
- `rejected_priors[]` / `rejected_evidence[]`: diagnostic-only conflicts.
- `canonical_regions[]`: mutually exclusive promoted/helper/review regions for `building_footprint`, `road`, `parking`, `green`, `walkway`, `service_yard`, `gap`.
- `subdivision_cells[]`: site cells with exactly one canonical class.
- `gap_completion`: R10.5 gap classification for explainable residual cells.
- `qa`: hard gates and review gates consumed by PhotoGradeReadiness.

The JSON schema lives at `projects/image-structured-modeler/schema/auto-ground-plan-r10.schema.json`.

## Gap Completion

`GapCompletionSolver` is geometry/evidence-only. It does not use VLM semantic guessing or manual polygon labels.

Gap classes:

- `open_paved_area`: helper-only surface; never promoted road.
- `road_candidate`: review candidate unless explicit connectivity and residual gates promote it later.
- `walkway_candidate`: review candidate.
- `service_yard_candidate`: review candidate.
- `vegetation_gap`: helper/review context.
- `true_gap`: visible residual with no reliable evidence.
- `unknown_gap`: unexplained residual.

Each gap-derived region must record source cells, source evidence, connectivity reasons, residuals, review state, and downgrade reason.

## Default PartGraph Policy

For building-group, default `image-structured:part-graph-building-group` consumes R10 canonical regions. Legacy R7/R8 massing is preserved only through `image-structured:part-graph-building-group-legacy-massing`.

Default output must not emit:

- `internal_roads`
- raw `parking_lot`
- `warehouse_row_west`
- `warehouse_row_inner`

Only `open_paved_area` gap completion regions may become helper surfaces. Gap-derived road, walkway, and service-yard candidates stay review-only unless future residual gates explicitly promote them.

## PhotoGradeReadiness

`photo_grade_readiness=candidate` requires all readiness gates to pass. R10.5 only strengthens the subdivision/gap gate. A queue `.skp` save remains geometry-output proof, not photo-grade proof.
