# ModelGraph v1 and proposal-only existing-model edits

ModelGraph v1 is a versioned, model-revision-bound representation built from `adopt_open_model(recursive=true)` and the structured snapshot. It supports target reasoning and evidence without allowing the reasoning layer to execute a modification.

## Graph content

The graph persists:

- occurrence nodes with persistent entity paths and parent-child hierarchy;
- component definition nodes and occurrence-to-definition membership;
- Face, Edge, object, and feature summaries;
- material, Tag, Scene, classification, attributes, visibility, and bounding boxes when the runtime reports them;
- sibling spatial relations and geometry ownership/topology relations;
- shared-definition impact and allowed-operation contracts;
- model revision;
- optional PartGraph, ParametricRecipe, FeatureMappingPlan, evidence, and entity-path lineage references.

Names, materials, Tags, classification, attributes, feature text, and future OCR fields are explicitly untrusted data. They can support candidate evidence but cannot modify workflow or execution policy.

## Proposal task

Use the existing `start_agent_task` Gateway with:

```json
{
  "intent": "propose_existing_model_edit",
  "instruction": "Set the largest wall to the reviewed concrete material.",
  "interface_level": "guided",
  "inputs": {
    "runtime": "mock",
    "target_query": "largest wall",
    "action": "set_material",
    "parameters": { "material": "Reviewed_Concrete" }
  }
}
```

The task writes opaque handles for `model-graph.v1.json` and `existing-model-edit-proposal.v1.json`. The proposal contains candidates, structured evidence, confidence, exclusions, selected target only when unambiguous, shared-definition policy, operation proposal, risk, and model revision.

`execution_allowed` is always `false`. A ready proposal returns a `next_action` for a separate `reviewed_existing_model_edit` task. That second task creates a plan hash and trusted approval challenge; S2-S4 execution still requires a real user-presence token.

## Ambiguity behavior

The proposal remains in `awaiting_input` when any of these are unresolved:

- operation is not understood;
- target description is missing or low-confidence;
- multiple candidates have similar evidence;
- required operation parameters are missing;
- a shared definition needs `make_unique` versus `definition_wide` choice.

`submit_agent_task_input` can add a `target_ref`, more specific `target_query`, missing `parameters`, or `shared_policy`. Re-evaluation remains proposal-only. No target is sent to Existing Model Editing Engine until a separate reviewed task is created.

## Verified mock coverage

The P1 mock benchmark covers architecture, interior, product, and deep shared-component fixtures. It asserts that ambiguous cabinets ask for target selection, a shared leaf asks for occurrence policy, deterministic largest-object queries select the intended top candidate, proposal generation leaves model revision unchanged, and wrong-target/proposal execution counts stay zero.
