# Model Revision v1 historical evidence boundary

`definition-merkle.v1` evidence is retained for audit lineage only. It records what the mock and live read-only runs observed at capture time, but it is not current Model Revision acceptance evidence and cannot authorize an edit.

The machine-readable boundary is `docs/evidence/model-revision-v1-archival-lineage-manifest-v1.json`. It freezes the exact bytes of the four evidence documents that explicitly identify `definition-merkle.v1`. Every manifest entry has these fail-closed values:

- `lineage_only: true`
- `current_acceptance: false`
- `release_acceptance: false`

The manifest also records the JSON Pointer for the strategy and release-acceptance value inside each immutable document. The archival test verifies those values, the evidence-file SHA256, and validation against the original historical schema.

Hashes embedded inside an archived document describe the source tree or installed plugin at capture time. They are historical observations; after `definition-merkle.v2` supersedes v1, they must not be refreshed and must not be compared with the current source tree. `test/mock-evidence-hash-integrity.mjs` excludes only documents enumerated by explicit archival manifests, verifies their bytes through those manifests, rejects duplicate classification, and continues checking source hashes for every other current mock-evidence document. The separate execution-plan v1 archive is declared by `docs/evidence/real-model-reliability-plan-v1-archival-lineage-manifest-v1.json`.

Historical schemas remain readable so audit tooling can parse and validate the frozen documents. Passing an old schema does not make an archived record current acceptance, release acceptance, approval, session authority, or execution authority.

Offline verification:

```sh
node test/model-revision-v1-archival-lineage.mjs
node test/mock-evidence-hash-integrity.mjs
```

Neither command calls the live queue or changes the active SketchUp model.
