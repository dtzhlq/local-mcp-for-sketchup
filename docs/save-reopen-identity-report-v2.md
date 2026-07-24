# Save/Reopen Identity Report v2

`save-reopen-identity-report.v2` separates a deterministic mock contract check from live SketchUp save/reopen evidence. The existing `schema/save-reopen-identity-report-v1.schema.json` remains unchanged for historical reports; new runs emit version 2 and validate against `schema/save-reopen-identity-report-v2.schema.json`.

## Revision attestation

Every v2 report records before and after values for:

- `model_revision`
- `model_revision_strategy`
- `model_revision_source_sha256`
- `model_modified`

For `runtime=queue`, the validator fails before destructive model work unless the locally loaded source manifest matches the current `sketchup_plugin/alma_sketchup_mcp/model_revision.rb`, and the live plugin reports the same source SHA with `definition-merkle.v2`. After the target model is reopened, the report additionally requires `model_modified=false`, an exact model revision, exact persistent occurrence identity, an empty zero-tolerance snapshot diff, verified active source paths, and an empty queue.

The initial queue run remains explicitly destructive and requires both `--runtime queue` and `--queue-required`. It prints a warning before reset/build/save/open. `--resume-after-open` performs the read-only completion of an already opted-in v2 checkpoint; the checkpoint records that the destructive phase had explicit opt-in.

## Mock boundary

Mock reports use `evidence_scope=mock_contract_only` and `live_proof=false`. Their strategy, source hash, and modified-state fields are `null`, because the mock runtime cannot attest the loaded SketchUp Ruby source or SketchUp's unsaved-change state. A mock report therefore tests the report contract and deterministic identity behavior only; it cannot satisfy live save/reopen acceptance.

Offline verification:

```sh
npm run qa:save-reopen:mock
node test/save-reopen-identity.mjs
```

Neither command invokes the queue. Live validation must only be run with a disposable model and an explicitly coordinated SketchUp session.

## Current-source live evidence

The 2026-07-22 run used an ephemeral local operator policy in one process; repository defaults remained fail-closed. It completed a real target -> distinct intermediary -> target save/open cycle on SketchUp 26.2.242 with capability `.7`, manifest `v1.4`, and `definition-merkle.v2`. All 42 persistent occurrence entries, two shared leaf occurrences, 36 Face/Edge entries, and the model revision matched exactly; the zero-tolerance snapshot diff was empty and the queue was clean.

The public wrapper is `docs/evidence/current-source-save-reopen-identity-live-evidence-2026-07-22.json`, validated by `schema/current-source-save-reopen-identity-live-evidence-v1.schema.json` and `test/current-source-save-reopen-identity-live-evidence.mjs`. The raw checkpoint and SKP files remain local artifacts because the checkpoint contains absolute paths and runtime identity fields. This evidence proves the underlying current-source identity/save-reopen mechanism, not DesignIntentGraph/FeatureHistory lineage, manual-divergence reconciliation, a multi-model mutation corpus, cross-version behavior, or release acceptance.
