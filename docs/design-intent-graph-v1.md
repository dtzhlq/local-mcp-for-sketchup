# DesignIntentGraph v1

DesignIntentGraph v1 maps reviewed design intent across generated artifacts and persistent SketchUp entities. The P2 implementation now includes a durable, versioned, model-scoped `DesignIntentStore` and FeatureHistory/reconciliation history. It is not a general semantic agent, it does not infer user authorization, and persistence by itself never authorizes model mutation.

## Contract

- Inputs: ModelGraph v1, reviewed ParametricRecipe, FeatureMappingPlan or PartGraph, and explicit persistent entity bindings.
- Mapping: parameters, parts, and feature intents map bidirectionally to stable entity references.
- Planning: `modify_design_parameters` computes a dependency closure and emits an erase-and-rebuild safe JSON DSL proposal.
- Execution: the proposal has `execution_allowed=false` and must enter a separate trusted `reviewed_existing_model_edit` task.
- Reconciliation: saved fingerprints distinguish expected reviewed rebuilds from unexpected manual or external edits.
- Safety: unexpected divergence blocks parameter planning; adopting or restoring it requires user review and no silent overwrite is permitted.

## Durable model-scoped store

`DesignIntentStore` is keyed by the server-derived opaque `model_key`, not by a task id or a raw model path. Per-model manifests retain immutable graph versions, the current ModelGraph/revision binding, append-only correction history, reconciliation receipts, content hashes, and deltas. Writes use a model-scoped lock, private file modes, atomic replace, and integrity verification; model paths and raw identity values are rejected rather than persisted. A restarted server can reload the current graph or historical versions and fails closed on graph, manifest, or reconciliation tampering.

Accepted reconciliation advances parameter values, model revision, complete entity fingerprints, persistent entity bindings, and correction history. Unexpected fingerprint divergence blocks parameter planning; the reconciliation workflow reports it for review instead of silently overwriting the model. Parameter changes still produce a proposal that must enter the separate reviewed existing-model edit workflow, where source task, graph, model revision, operation scope, risk, and trusted approval are checked again.

## Verified boundary

The deterministic P2 benchmark runs complete reviewed loops for three **mock** domains: a building entrance width (`900 -> 1200 mm`), a product mounting-hole diameter (`12 -> 20 mm`), and an interior shelf array (`2 -> 4`). It exercises proposal, source-bound S4 reviewed apply with a test-only trusted approval provider, save/open, a newly constructed bridge, durable-store reload, persistent entity-reference comparison, and aligned reconciliation.

The current-source live proof adds one small SketchUp component fixture. A guided short-context/no-file/no-vision Agent task bound `pid:92187` into a model-scoped DesignIntentStore, saved the disposable copy, then resumed the same `task_id` after a full SketchUp/plugin restart. The model revision, graph id, entity path, binding fingerprint, and single immutable FeatureHistory version remained exact; an aligned reconciliation completed without review.

The live run then applied one deliberately **unsaved** material divergence to that bound entity. A subsequent parameter task emitted zero operations with `manual_or_external_divergence_requires_reconciliation`; the reconciliation task found exactly one unexpected divergence, set `silent_overwrite_allowed=false`, and remained `awaiting_review`. An Agent-supplied `adopt_manual_edit` decision failed with `APPROVAL_REQUIRED`, no approval decision/token was recorded, and FeatureHistory did not advance. The source fixture and saved working-copy bytes remained unchanged, and queue/processing/responses/lock were clean.

This proves task-time live save/restart lineage recovery and fail-closed manual/external-style divergence detection for one fixture. It does not prove continuous observer monitoring, trusted acceptance of the live reconciliation, arbitrary feature reconstruction, multiple live domains, or cross-version behavior. `release_acceptance` remains false.

Schemas:

- `schema/design-intent-graph-v1.schema.json`
- `schema/design-parameter-change-plan-v1.schema.json`
- `schema/design-intent-reconciliation-v1.schema.json`
- `schema/design-intent-store-v1.schema.json`
- `schema/design-intent-live-lineage-evidence-v1.schema.json`

Mock verification commands include `node test/design-intent-graph.mjs`, `node test/design-intent-store.mjs`, `node test/design-intent-gateway-store.mjs`, and `node test/design-intent-cross-domain.mjs`. The strict current-source live evidence is `docs/evidence/design-intent-live-lineage-evidence-2026-07-23.json`, validated by `node test/design-intent-live-lineage-evidence.mjs`. The live runner is staged and explicitly opt-in: `stage` never calls queue; `capture` requires `--runtime queue --queue-required --disposable-copy-confirmed`; `resume` additionally requires `--allow-unsaved-divergence`, emits a mutation warning, and owns SIGINT/SIGTERM queue cleanup.
