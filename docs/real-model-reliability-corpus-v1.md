# Real-model Reliability Corpus v1

`scripts/run-real-model-reliability-harness.mjs` is the runnable Priority 4 reliability gate. It measures task outcomes across a small adversarial corpus instead of treating operation count as reliability.

The additive, JSON-only seven-case readiness layer is documented in `docs/real-model-reliability-sidecars-v1.md`. Those sidecars preserve the current semantic mappings and blocked/unknown evidence but are not live `*.reliability.json` contracts and currently claim zero native mutation successes.

## Current evidence boundary

- The repository contains **zero tracked `.skp` or `.skb` corpus files**.
- `test/reliability-corpus/manifest.json` therefore labels every native SketchUp case `external_live_required`.
- The checked-in gate has deterministic mock evidence for seven domains. That evidence tests orchestration, contracts, identity accounting, rollback accounting, and preservation checks against the mock runtime. It is not proof of native SketchUp geometry behavior.
- No external live corpus or SketchUp version matrix was run for the checked-in mock evidence.
- Generated files under `output/` are not independently sourced corpus inputs and must not be promoted to live evidence.

### Current Model Revision migration

The 2026-07-20 candidate and target-review live documents are immutable observations from `definition-merkle.v1`. A later Portal restart check showed that v1 included process-local SketchUp `entityID` state, so those documents are retained only as historical lineage and cannot satisfy the current verifier, authorize an edit, or be refreshed with current source hashes. The user reported a style adjustment that is sufficient to explain the separately observed `model_modified=true`; that dirty-state signal is independent from the confirmed v1 identity bug and is now explicitly bound into planning and authorization.

The current contract is capability `0.1.0-rc.3-capabilities.1`, manifest `2026-07-agent-contract-rc3.1`, and `definition-merkle.v2`. It uses persistent IDs or Alma custom references as stable identities, fails closed on missing or duplicate identities, canonicalizes representation-only ordering, and still detects semantic geometry, transform, material, and attribute changes. Session Contract, queue transport, reliability execution plan v2, Portal workflow v3, and save/reopen report v2 also bind the exact loaded Model Revision source hash and `model_modified`. Historical v1 evidence and execution-plan bytes are protected by external archival manifests. On 2026-07-21 the then-current rc.2 22-file workspace plugin was installed, SketchUp 2026 was fully restarted, and one byte-exact disposable model completed a signed handshake -> complete `5859 / 5859` recursive read-only adoption -> signed handshake sequence with an unchanged v2 revision, `model_modified=false`, and a clean queue. This is immutable rc.2 live lineage and does not establish rc.3 live acceptance. See `docs/evidence/current-source-live-readonly-evidence-2026-07-21.json`.

A second current-source proof addresses proposal and reviewed-plan scalability on the Trimble S6 product candidate. Its v2 revision was complete at `71,360 / 71,360`, but the original full-recursive guided proposal was manually cancelled after remaining in `understanding`; cleanup succeeded and no mutation/save occurred, so that attempt is not classified as a native crash. The replacement guided path uses two complete bounded `41 / 41` Group projections with zero Face/Edge leaves: the first selects one `largest group` target, and the second binds that exact `pid:` path into an S2 reviewed plan through `existing-edit-target-validation.v1`. Plan `.3` hash-binds that record and discloses the matching `existing-edit-execution-target-validation.v1` policy in the approval review context; its narrow structural execution path is schema/mock proven and conservatively falls back for `make_unique` or topology/destructive work. The live challenge remains pending with no decision/token. Model bytes/revision/document and the queue remained unchanged. See `docs/evidence/current-source-reviewed-plan-v3-live-evidence-2026-07-21.json`; the earlier plan `.2` evidence remains a historical exact-source snapshot. This is one read-only product-model observation, not a formal corpus native-mutation case or performance guarantee.

### 2026-07-23 current-source seven-case live reliability checkpoint

All seven hash-bound external cases completed the then-current single-case live runner against SketchUp 26.2.242, capability `.7`, manifest `v1.4`, and `definition-merkle.v2`; these captures remain historical rc.2 lineage:

- `deep-shared-components`: `11,474 / 11,474` full recursive occurrence identities, `2,986` shared-definition occurrences, exact revision and zero-error snapshot comparison across save/reopen;
- `interior-expression`: complete revision over `220,006` logical occurrences, deterministic `100,000 / 100,000` bounded occurrence samples, material preservation, one Scene/visibility signature, exact revision and zero-error snapshot comparison across save/reopen;
- `scaled-mirrored-locked`: a controlled fixture over a byte-preserved authorized model copy first exposed that native SketchUp `locked=true` does not itself stop direct Ruby transforms. The failed expectation and mutated diagnostic copy were retained, a central application-level locked-target/ancestor guard was added, the installed plugin was fully restarted, and the fresh-source rerun then rejected the locked batch before commit. The guard and locked target remained unchanged, only the exact transform target received scale `[1.5, 0.75, 2]` plus X mirror, recovery was `1 / 1`, and `12,944 / 12,944` occurrence identities remained exact across save/reopen.
- `appearance-scenes-hidden`: a controlled six-operation overlay on a byte-preserved `Fire Escape` copy added one real textured material, one FaceUV payload, one Scene, and one hidden top-level target. The source SKP and texture input remained byte-identical. UV/material and Scene/visibility signatures were identical before save and after reopen, and both model revision and `5,897 / 5,897` full-recursive occurrence identity matched exactly.
- `architecture-golden`: a controlled metadata-only overlay on a separate byte-preserved `Fire Escape` copy added one material-catalog entry and one Scene without changing geometry. Material and top-level Scene/visibility signatures were identical before save and after reopen, and both model revision and `5,859 / 5,859` full-recursive occurrence identity matched exactly.
- `imported-dirty-topology`: an isolated controlled loose-edge overlay on a byte-preserved authorized `Revit import Complete` copy produced one exact persistent repair target in the retained imported-model context. The formal run detected `boundary_edges`, then `manifold_repair(strategy=cleanup)` changed the target from 6 faces / 13 edges / 10 vertices and non-manifold to 6 / 12 / 8 and manifold. The exact target changed, every other top-level entity remained unchanged, and the repaired result retained an exact `definition-merkle.v2` revision plus a stable bounded `100,000 / 100,000` occurrence sample over `1,903,696` logical occurrences after save/reopen.
- `product-boolean-manifold`: an isolated controlled manifold box/through-cylinder pair was added to a byte-preserved authorized `Trimble S6` copy. Both inputs remained manifold after fixture save/reopen. The formal `boolean_difference` replaced only the exact target, preserved the tool and every non-input top-level fingerprint, produced a manifold result, retained the target material, and preserved exact `71,868 / 71,868` full-recursive identity plus the complete model revision across save/reopen.

All 23 named tasks passed. Wrong-object modifications and silent geometry corruption were both zero, recovery was `2 / 2`, input artifacts remained byte-identical, only disposable copies were saved, and queue/processing/responses/lock were clean after each run. Aggregate JSON v1-v5 remain immutable historical lineage. The current seven-case aggregate is `docs/evidence/current-source-real-model-reliability-live-evidence-v6-2026-07-23.json`; it binds the v5 descriptor, product-fixture report, formal product case report, current implementation source hashes, strict schema, 11 negative documents, and deterministic regeneration.

This is `7 / 7` corpus-category current-source evidence with `3` formal geometry-mutation cases, not a general reliability claim. The dirty-topology and product targets were controlled isolated overlays, so the results do **not** prove arbitrary imported CAD repair or arbitrary product Boolean behavior. The dirty run at `1,423,821 ms` and the interior run at `1,291,250 ms` exceed the `120,000 ms` interactive budget and are not qualified as ordinary-Agent default payloads. Architecture and FaceUV conclusions keep their earlier narrow boundaries. Cross-version remains `deferred_by_user`; P2 still lacks broader live reconciliation, P3 still lacks external-reference independent-pose/cross-model quality despite its two-domain fresh-process consistency gate, and P5 still lacks multi-vendor/production-approval proof. `release_acceptance=false`.

The mock gate currently covers:

| Domain | Mock source | Reliability tasks |
| --- | --- | --- |
| Building | `examples/golden-architecture.json` | material, Scene/visibility, save/reopen identity |
| Interior | `examples/interior-expression-suite.json` | material, Scene/visibility, save/reopen identity |
| Product | `examples/boolean-manifold-slice.json` | boolean/manifold, material, save/reopen identity |
| Deep shared components | generated deterministic fixture | large recursive index, shared-definition identity, save/reopen identity |
| Imported/dirty topology | generated mock import fixture | abnormal topology detection, manifold repair, recovery |
| Materials/Scenes/hidden objects | `examples/appearance-texture-slice.json` plus a hide operation | UV/material, Scene/visibility, save/reopen identity |
| Scale/mirror/locked entity | generated deterministic fixture | locked fail-closed, rollback, nonuniform mirror, wrong-object isolation, save/reopen identity |

## Candidate intake before the formal seven-case gate

`scripts/intake-real-model-corpus.mjs` is the executable intake/profile layer for user-supplied `.skp` files that do not yet have reviewed reliability sidecars. It does **not** weaken the formal seven-case manifest and does not infer architecture/interior/product meaning from a filename.

The default command is offline-only:

```bash
npm run qa:real-model-candidates:intake
```

It recursively scans `test/模型`, rejects symbolic links and non-regular entries, accepts only `.skp` extensions with a recognized SketchUp model header, enforces a 512 MiB per-file default limit, hashes bytes through an `O_NOFOLLOW` descriptor when supported, and checks inode/size/timestamps before and after reading. The generated `output/real-model-reliability/intake/real-model-candidate-inventory.v1.json` contains repository-relative or redacted-root locators only. It labels filenames and later model names/materials/Tags/Scenes/attributes as untrusted data; none may change execution policy or grant approval.

Offline intake never creates a Bridge, queue directory, request, response, processing marker, or lock. The regression test verifies that property in an isolated process:

```bash
node test/real-model-candidate-intake.mjs
```

Live structural profiling is a separate, explicit operation:

```bash
export ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue
export ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1
export ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION=1
npm run qa:real-model-candidates:queue
```

Both `--runtime queue` and `--queue-required` are mandatory. Before its first queue call, the profiler re-verifies and copies **all** candidates into uniquely named `output/.../live-work/` directories. SketchUp receives only `candidate.skp` disposable-copy paths, never an original path. The run loudly warns that it will switch the active document; it does not request build/reset/import/Ruby execution, content edits, or save. Candidates run smallest-first so a large imported model is last. For every copy the profiler requires read-only adoption (`adopted_count=0`), complete and unchanged model revisions before/after inspection, bounded untrusted display values, and source identity matching the disposable copy. The occurrence target sample defaults to 10,000 entries and rejects requests above 100,000; this output bound is independent from the complete model-revision binding. It then re-hashes both originals and working copies; any byte change fails the run. A failure stops subsequent document switches. Normal exceptions and `SIGINT`/`SIGTERM` clean this process's unclaimed request and lock while preserving claimed outcome-unknown evidence.

The resulting `real-model-candidate-profile.v1.json` reports only structural signals for appearance, shared-component, and transform edge-case review. Imported/dirty topology needs a separately reviewed topology probe, while architecture/interior/product remain semantic human decisions. No formal `*.reliability.json` sidecar is generated automatically, and candidate profiling accepts zero formal corpus cases.

The first coordinated 2026-07-20 run against the four local candidates safely profiled the three smaller disposable copies (`5,859`, `12,887`, and `11,474` logical occurrences) with unchanged complete revisions. The fourth copy exposed `1,903,677` logical occurrences and correctly failed the legacy 100,000-entry revision implementation with `MODEL_REVISION_INCOMPLETE`; originals and all copies remained byte-identical, SketchUp survived, and queue/processing/responses/lock were empty afterward. This is a bug-discovery result, not a four-model pass.

After a complete restart, capability `.4` proved `definition-merkle.v1` on that same large model: it counted all `1,903,677` logical occurrences from `639,351` unique entities without materializing shared occurrences. It then failed closed at the explicit 500,000 unique-entity budget; SketchUp remained alive and the queue was clean. Capability `.5` replaces the retained per-container digest array with an incremental digest, raises the unique-entity safety budget to 1,000,000, and binds that limit into capability, signed Session Contract, and plugin transport guard. This `.4` result was an intermediate capacity finding rather than a pass.

That `.5` rerun is now complete against the five candidates present at execution time. All five disposable copies profiled successfully, all five Merkle revisions were complete and unchanged, originals and copies remained byte-identical, SketchUp remained alive, and queue/processing/responses/lock were empty afterward. The largest candidate passed with `1,903,677` logical occurrences, `639,351` unique entities, and `5,531` reachable definitions while materializing only the caller-bounded 10,000-entry target sample. The strict evidence is `docs/evidence/real-model-candidate-live-evidence-2026-07-20.json`; this closes candidate intake/read-only profiling for the current SketchUp version, not the formal mutation corpus.

The user subsequently confirmed the proposed semantic routing. That decision is recorded in `docs/evidence/real-model-candidate-semantic-mapping-2026-07-20.json`, bound to the exact inventory, profile, live-evidence, and seven-case manifest hashes. It is deliberately scoped to semantic mapping: it cannot authorize mutation, issue an approval token, change execution policy, or promote a candidate into the formal corpus. The derived offline report is generated with:

```bash
npm run qa:real-model-candidates:review
```

The result is `6 / 7` formal case categories semantically mapped and `0 / 7` formal sidecars ready. `product-boolean-manifold` remains unmapped; the architecture candidates have no Scene; sampled candidates expose no UV target and no locked occurrence; imported dirty topology still needs a reviewed repair target/probe; and every mutating case still lacks reviewed top-level persistent-id roles. The report therefore writes no sidecar and calls no queue. Generated JSON and Markdown live under `output/real-model-reliability/review/`.

Capability `.5` uses `definition-merkle.v1` for the opaque model revision: reachable definition content is fingerprinted once, each instance still binds its own transform/metadata and referenced definition digest, and the complete logical occurrence count is computed from the definition graph. A 201,000-occurrence / 1,200-unique-entity mock proves deterministic revision, transform sensitivity, bounded memory behavior, and fail-closed unique-limit/cycle handling. The separate occurrence index remains bounded for target evidence. A complete plugin restart and the five-candidate live run now prove the same strategy through the `1,903,677`-logical / `639,351`-unique case under the 1,000,000 unique-entity limit. That proof is read-only candidate profiling; it does not substitute for the seven-case native mutation corpus.

The paragraph above is a historical v1 result, not current v2 acceptance. Its source-bound evidence remains unchanged for audit lineage; a fresh v2 run must create a separate evidence artifact.

Cross-version validation is orthogonal to candidate intake. It may be recorded as `deferred_by_user` for the current milestone without being represented as a pass; any successful live profile still reports a one-version observation with `complete: false`.

## Default mock gate

Both commands below are mock-only and do not call the SketchUp queue:

```bash
node scripts/run-real-model-reliability-harness.mjs
npm run qa:real-model-reliability:mock
```

The report is written to `output/real-model-reliability/mock/real-model-reliability-report.v1.json` when the npm command is used. It validates against `schema/real-model-reliability-report-v1.schema.json` before being written.

The hard metrics are:

- task success rate;
- wrong-object modification count;
- silent geometry corruption count;
- recovery attempts, recoveries, and recovery rate.

A mock pass does not promote the 73 beta or 11 experimental operations to stable. It only establishes deterministic regression evidence for the tasks named in the report.

## External live corpus contract

Live execution is intentionally unavailable from repository fixtures. An operator must provide all seven `.skp` files named in the manifest and one adjacent `*.reliability.json` sidecar for each file. Every sidecar must validate against `schema/real-model-reliability-live-case-v1.schema.json` and bind:

- the exact case id and artifact filename;
- the artifact’s exact `sha256:<64 lowercase hex>` digest;
- required top-level target roles by SketchUp `persistent_id`;
- minimum entity, recursive-index, Scene, material, hidden-object, shared-occurrence, UV, and boolean expectations.

The harness preflights **all** artifacts and sidecars before its first queue call. Missing files, invalid sidecars, path escape attempts, missing roles, or a SHA256 mismatch fail closed. Corpus paths are checked with `lstat`, real-path containment, regular-file checks, `O_NOFOLLOW` where the host provides it, and before/after descriptor inode and size validation. Symlinked artifacts or sidecars and files replaced while they are being read are rejected. Verified bytes are copied into a unique disposable working directory during preflight; the external originals are not opened for mutation and are not re-read after queue transport begins.

## Explicit live command

Do not run this command against valuable unsaved work. It opens, modifies, saves, and reopens disposable corpus copies in the active SketchUp session, so the active document changes.

```bash
export ALMA_SKETCHUP_RELIABILITY_CORPUS_ROOT=/absolute/path/to/hash-bound-corpus
export ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue
export ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1
export ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION=1
npm run qa:real-model-reliability:queue
```

Those execution-policy variables are operator configuration, not Agent input. Omitting them fails closed; `--runtime queue` cannot elevate server/user policy.

Direct invocation must include both live flags:

```bash
node scripts/run-real-model-reliability-harness.mjs \
  --runtime queue \
  --queue-required \
  --live-artifact-root /absolute/path/to/hash-bound-corpus \
  --timeout-ms 240000 \
  --output-dir output/real-model-reliability/queue
```

For a large single case on macOS, prefer the two-phase single-window path. Preparation is filesystem-only and writes a schema-validated descriptor without creating a queue request:

```bash
node scripts/run-real-model-reliability-live-case.mjs \
  --prepare-only \
  --case imported-dirty-topology \
  --live-artifact-root /absolute/path/to/hash-bound-corpus \
  --output-dir output/live-validation/real-model-reliability/imported-dirty-topology
```

Open the returned `launch_path` as SketchUp’s only document, start the Bridge, then run the same case with the exact prepared path:

```bash
node scripts/run-real-model-reliability-live-case.mjs \
  --runtime queue \
  --queue-required \
  --case imported-dirty-topology \
  --live-artifact-root /absolute/path/to/hash-bound-corpus \
  --output-dir output/live-validation/real-model-reliability/imported-dirty-topology \
  --active-working-copy /absolute/path/from/launch_path \
  --timeout-ms 3600000
```

`--active-working-copy` is accepted only inside that output directory’s `live-work/` root, must be a real non-symlink file with the exact source SHA-256, must differ from the source artifact, and must not share a directory with an existing verified output. In this mode the runner verifies the already-active path and does not send the initial `open_model`, preventing a second startup window. This does not weaken later write authorization: every build/save/document transition still obtains its own fresh Session Contract and Ruby-side transport guard. For each transition, the runner now issues and verifies that contract inside one exclusive queue scope, so a large model pays one server-side global revision scan plus the plugin’s independent final guard instead of two server scans plus the final guard.

The live path has these stop rules:

1. Both `--runtime queue` and `--queue-required` are mandatory.
2. Every external artifact and hash-bound sidecar must pass preflight before transport starts.
3. A loud warning is printed before the active SketchUp document can change.
4. Capability and active-document activation checks are revision-free reads. `get_active_model_identity` only binds the focused document and clears a matching pending-open state; it never computes a global revision or snapshots model contents. Every build, open, and save/reopen transition still obtains a fresh one-shot session contract; its server-side probe and authorization stay under one lock, while the plugin independently revalidates the bound revision before dispatch.
5. The harness stops scheduling further mutations after the first live case failure.
6. `SIGINT`, `SIGTERM`, and normal exceptions remove this process’s unclaimed request and owned lock. Seven explicitly classified pure-read methods, including the lightweight active-model identity probe, may also remove their own claimed marker; a private cancellation marker lets the next QueueRuntime call remove a late response for that exact request id. Mutating, file-writing, adoption/capture, Ruby, and unknown claimed requests or responses remain outcome-unknown evidence and are never erased by this path.

A successful live run is still version-specific. The report records the observed SketchUp version and leaves the version matrix `complete: false` until separately coordinated runs cover the supported matrix.

## Contract and safety regression tests

```bash
node test/reliability-report-schema.mjs
node test/real-model-candidate-intake.mjs
node test/real-model-candidate-review.mjs
node test/reliability-corpus.mjs
node test/current-source-real-model-reliability-live-evidence.mjs
ruby test/ruby/model_revision_merkle_test.rb
node test/model-revision-merkle-evidence.mjs
```

The tests prove that:

- the default command remains mock and reports `live_queue_called: false`;
- candidate intake defaults to offline, rejects renamed/non-SKP content, symlinks, path escapes, oversized files, and read-time replacement, and never calls queue transport;
- candidate live-profile contracts open disposable copies only, call no mutation/save method, preserve original bytes, bound the occurrence sample, return a stable MDI-focus error, stop after a profile failure, and clean on exceptions or signals;
- user-confirmed semantic mappings are hash-bound to inventory/profile/live evidence, cannot grant approval or execution policy, reject forged candidate/case/hash bindings, and derive a fail-closed 7-case readiness report without generating formal sidecars;
- definition-aware revisions cover large shared occurrence graphs without materializing every occurrence, detect instance-transform drift, and fail closed on unique-entity exhaustion or recursive definition cycles;
- default mock execution creates no queue request directory or lock;
- missing live opt-in, missing external files, SHA256 mismatch, artifact/sidecar symlinks, and read-time file replacement fail before queue transport;
- report, manifest, and external sidecar schemas reject extra or unsafe fields;
- interrupt cleanup removes an isolated process-owned unclaimed request and lock, removes an exact claimed pure-read request/response, and still preserves mutating or unknown outcome evidence;
- the interrupt fixture itself never invokes queue transport.

These tests do not call live SketchUp. The v4 wrapper revalidates already captured local live artifacts without sending a queue request. Two remaining external cases and fresh live runs are still required for native Boolean/manifold, dirty-topology recovery, and complete-corpus proof.
