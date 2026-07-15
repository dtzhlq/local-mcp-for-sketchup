# DesignIntentGraph v1

DesignIntentGraph v1 preserves reviewed design intent across generated artifacts and persistent SketchUp entities. It is not a general semantic agent and it does not authorize model mutation.

## Contract

- Inputs: ModelGraph v1, reviewed ParametricRecipe, FeatureMappingPlan or PartGraph, and explicit persistent entity bindings.
- Mapping: parameters, parts, and feature intents map bidirectionally to stable entity references.
- Planning: `modify_design_parameters` computes a dependency closure and emits an erase-and-rebuild safe JSON DSL proposal.
- Execution: the proposal has `execution_allowed=false` and must enter a separate trusted `reviewed_existing_model_edit` task.
- Reconciliation: saved fingerprints distinguish expected reviewed rebuilds from unexpected manual or external edits.
- Safety: unexpected divergence blocks parameter planning; adopting or restoring it requires user review and no silent overwrite is permitted.

## Persistence and verification

Accepted reconciliation advances parameter values, model revision, entity fingerprints, and correction history. A save/reopen cycle must preserve the persistent binding. The mock benchmark covers a building door and associated wall/opening intent, a product hole diameter, and an interior shelf array count.

Schemas:

- `schema/design-intent-graph-v1.schema.json`
- `schema/design-parameter-change-plan-v1.schema.json`
- `schema/design-intent-reconciliation-v1.schema.json`

Live queue validation is not part of the default gate and requires explicit user coordination plus a fresh queue handshake.
