# Versioned assembly parameter edits

The parameter-edit route now supports reusable assemblies without erasing their existing instances. This route has two stages: create unused definitions in a fresh transaction namespace, then replace explicitly selected instances through the existing reviewed-edit authority. Creating the definitions does not authorize replacement.

The callable entry points are `planDesignParameterChange` in `src/design-intent-graph.mjs` and `prepareAssemblyParameterEdit` / `applyAssemblyParameterEdit` in `src/detailed-modeling/assembly-edit.mjs`. The Gateway's existing permissions are unchanged.

```js
const changePlan = planDesignParameterChange({
  designGraph,
  currentModelGraph,
  changes: { window_width: 1800 },
  assemblyRebuild: {
    previousDsl: previousScene.dsl,
    nextDsl: recompileDetailedScene(previousScene, {
      parameters: { window_width: 1800 }
    }).dsl,
    scope: 'single',
    taskId,             // The existing server task ID.
    iteration: 1,       // A fresh namespace for this definition version.
    materialMap: originalCreation.material_map
  }
});

const prepared = await prepareAssemblyParameterEdit({
  bridge, designGraph, changePlan, runtime: 'queue',
  outputDir, session_contract
});

// Use the existing authority to review prepared.prepared_edit and obtain its
// approval token. This helper never mints a token or changes approval policy.
const result = await applyAssemblyParameterEdit({
  bridge, designGraph, changePlan, prepared, approval_token,
  runtime: 'queue', outputDir, designGraphPath,
  save_model: true, save_path
});
```

Use a current, complete `ModelGraph` when initially constructing `DesignIntentGraph`. Each affected binding must resolve to top-level `ComponentInstance` objects. If the initial creation namespaced definitions, record the original compiler name in the binding:

```js
{
  binding_id: 'entry-window',
  part_id: 'entry-window',
  entity: { entity_path: 'pid:12345', instance_policy: 'definition_wide' },
  parameter_bindings: ['window_width'],
  associated_binding_ids: ['entry-wall'],
  lineage: { assembly_definition: 'PG2_entry-window' },
  rebuild_template: []
}
```

`single` replaces one bound instance per affected binding. Associated bindings, such as a window and its host wall, can therefore each have one selected instance. `all` requires every current instance of each affected definition to be explicitly included in that binding's stored baseline. It fails if an unbound or nested occurrence would be affected. Nested shared parents must first be represented as the assembly being replaced; this implementation does not silently interpret a nested occurrence edit as a single-instance edit.

Only the affected assembly definitions and their dependency closure are copied. Referenced materials must already exist; supply the original material map when the initial creation namespaced them. New material imports are a separate operation. No existing definition, material, camera, or scene is overwritten by the creation stage.

Component bindings store fingerprints of their entire observed occurrence subtree in `lineage`, so manual edits to a child part block planning before new definitions are created. The apply helper verifies the unchanged instance identity and the actual replacement definition, refreshes the DesignIntent bindings, and optionally writes the updated graph with the existing atomic artifact writer. Save/reopen retains the logical recipe definition mapping for the next parameter edit. Derived sharing-count changes on otherwise identical siblings are reconciled separately from semantic edits.

Native replacement now uses the documented `Sketchup::ComponentInstance#definition=` setter, preserving the instance's persistent ID, transform and attached properties. The existing confirmation and target-resolution checks remain in force.

Validation: `node test/assembly-parameter-edit.mjs` exercises real mock-runtime creation, trusted reviewed replacement, single/all scope, preservation of unrelated instances and old definitions, missing-token rejection, nested manual divergence, plan tampering, schema validation, save/reopen and a second parameter edit. `ruby test/ruby/component_definition_replacement_test.rb` checks native API-shaped identity preservation. These are offline checks; live SketchUp acceptance remains separate.

Official API: [ComponentInstance definition setter](https://ruby.sketchup.com/Sketchup/ComponentInstance.html#definition=-instance_method).

## Independent test-model live runner

`scripts/run-detail-assembly-edit-live.mjs --help` lists the complete CLI. It only accepts the exact saved active test model under `output/detail-modeling-implementation-2026-09-06/models`, with the selected label prefix and a fresh queue handshake before mutations. It reads the frozen bundle and the server creation identity/material map. The local bridge uses the existing trusted-copy auto-approval policy restricted to this directory, S2/S3/S4 and at most 10 affected instances. It never fabricates a trusted-user approval or changes the global policy. Native calls are not made on import or `--help`.

An operator can first open `sample-window.skp`, then run:

```sh
node scripts/run-detail-assembly-edit-live.mjs run sample-window width-1800 --parameters '{"width":1800}' --scope single --pair-offset 2200,0,0 --expect-instances 2
```

For a separate `all` comparison, reopen the original saved `sample-window.skp` and use a distinct run ID with `--scope all`. `--pair-offset` creates the second test instance through the existing reviewed add-instance operation. `--instances` can explicitly select native references. A coupled scene edit uses `--part` plus `--associate`, for example a window and its host wall.

Evidence goes to `evidence/LABEL/assembly/RUN_ID`: prepared exact plan, reviewed application, DesignIntent graph, actual model graph, unselected-sibling comparison, before/after/reopened captures, and saved/reopened reconciliation. The model is saved as `models/LABEL-RUN_ID.skp`. Repeated `reopen LABEL RUN_ID` checks write a new audit subdirectory. To continue parameters from a saved edit, use both `--source-run RUN_ID` and `--model-name LABEL-RUN_ID.skp`; the persisted DesignIntent retains the original logical assembly mapping.

After actual replacement and readback, `applyAssemblyParameterEdit` emits a process-branded, content-hashed receipt. The internal gateway method `recordTrustedAssemblyEditMapping` records new occurrence paths for the original task's frozen requirements without changing its specification hash. Copies or modified receipts are rejected, and unrelated/new peer roots are not imported into that task's quality coverage.


## Scoped native indexing

Read-only `adopt_open_model` accepts `recursive_roots`, up to 32 distinct top-level persistent paths. It indexes every scene root plus full descendants of the specified roots. The native whole-model Merkle revision remains unchanged in scope. `recursive_root_paths` identifies the coverage; model graph `complete` remains false, while `scope_complete` reports whether the requested roots were indexed without truncation.

Versioned assembly plans persist these root paths and reuse them at staging, review, execution preflight and readback. This mode permits only `replace_component_definition` on the selected indexed roots. It does not authorize geometry edits outside those roots or weaken the ordinary reviewed-edit policy. For all-instance changes, native global definition occurrence counts must match the observed instance set, preventing an unexpanded nested occurrence from being silently omitted.

The live assembly runner derives root paths from a fresh native root registry and includes associated roots and shared peers. Geometry outside the scope remains unexpanded. Existing unscoped inputs retain their prior behavior. Offline checks: `test/scoped-assembly-edit.mjs`, `test/ruby/scoped_recursive_index_test.rb`; native acceptance is recorded separately.
