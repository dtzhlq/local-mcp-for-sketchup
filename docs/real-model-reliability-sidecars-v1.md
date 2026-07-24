# Real-model Reliability Readiness Sidecars v1

This layer turns the reviewed local-candidate evidence into seven strict, hash-bound readiness records. It is a Priority 4 planning and regression artifact, not a live SketchUp execution contract.

## Verified current boundary

The manifest at `test/reliability-corpus/sidecar-manifest.v1.json` currently reports:

- 7 formal cases represented;
- 7 cases blocked;
- 0 execution-eligible cases;
- 0 native mutation successes;
- `release_acceptance=false`;
- cross-version validation `deferred_by_user` and not represented as a pass.

Validation reads JSON only. It does not open, copy, hash, import, save, or mutate any `.skp`/`.skb` file and does not import queue transport. The source model names, material names, Tag names, Scene names, attributes, and other model content remain untrusted data and cannot change execution policy or grant approval.

These sidecars deliberately use `*.sidecar.v1.json`, not `*.reliability.json`. The live harness accepts only the separately defined `real-model-reliability-live-case.v1` contract beside an operator-supplied, hash-bound external `.skp`. A readiness sidecar therefore cannot be renamed or promoted into a live contract.

## Seven-case status

| Formal case | Current evidence | Still blocked or unknown |
| --- | --- | --- |
| `architecture-golden` | Two user-confirmed architecture candidates; materials, hidden entities, shared occurrences, nonuniform and mirrored occurrences observed read-only | material target, Scene strategy, native preservation, save/reopen identity |
| `interior-expression` | One user-confirmed interior candidate; 38 materials and one Scene observed read-only | material target, Scene preservation, save/reopen identity |
| `product-boolean-manifold` | User-confirmed Trimble S6 candidate and read-only top-level target review | boolean target/tool roles remain unconfirmed; fresh manifold pair, exact overlap, material target, mutation, and save/reopen are not established |
| `deep-shared-components` | Portal is primary; two supporting candidates; shared-occurrence signals observed. Portal capability `.7` later completed a read-only `definition-merkle.v2` recursive observation without truncation | shared-definition identity across save/reopen and native task success remain unknown |
| `imported-dirty-topology` | User-confirmed imported-model candidate and large read-only structure | no reviewed topology probe, repair target, native repair, or recovery result |
| `appearance-scenes-hidden` | One primary and one supporting candidate; material, Scene, and hidden-occurrence signals observed read-only | no reviewed UV/hidden targets; native preservation and save/reopen remain unknown |
| `scaled-mirrored-locked` | Nonuniform and mirrored occurrences observed read-only | no locked target; rollback, wrong-object isolation, and save/reopen remain unknown |

The failed Portal v8 S3 Boolean trial is not counted as a native success. The deep-shared sidecar hash-binds its public failed-precommit evidence and the loader requires `consumed_failed`, no commit, confirmed abort and rollback, unchanged source/revision/baseline, a clean recovery queue, and no retry or replay. The failure evidence is context-only and cannot support any formal task assessment. Portal is also not substituted for the user-confirmed Trimble S6 product mapping.

## Artifacts

- `schema/real-model-reliability-sidecar-v1.schema.json` defines one readiness sidecar.
- `schema/real-model-reliability-sidecar-manifest-v1.schema.json` defines the seven-case manifest.
- `docs/evidence/real-model-reliability-sidecar-source-v1.json` is the normalized repository evidence snapshot. It records the ignored `output/` aggregate only as lineage; `output/` is not a validation-time dependency.
- `docs/evidence/portal-boolean-v8-failure-evidence-2026-07-21.json` is hash-bound by the deep-shared sidecar as a failed-precommit exclusion record; the default validator does not follow its machine-local `output/` capture bindings.
- `test/reliability-corpus/sidecars/*.sidecar.v1.json` contains one record per formal case.
- `src/real-model-reliability-sidecars.mjs` is the fail-closed loader.
- `scripts/validate-real-model-reliability-sidecars.mjs` is the offline CLI.
- `test/real-model-reliability-sidecars.mjs` validates schemas, hashes, evidence claims, path containment, symlink rejection, and authority boundaries.
- `docs/evidence/real-model-reliability-sidecars-v1-mock-evidence.json` binds the exact offline manifest, schemas, loader, test, source snapshot, and documentation used for the current result.

The loader rechecks the formal corpus case id, domain, and ordered task list; every sidecar byte hash; every JSON evidence byte hash; the normalized candidate id/handle/source digest/role set; exact read-only structural counts; legacy source blockers; evidence references; the Portal failed-precommit/non-replay facts; and the current zero-success boundary. Paths must be normalized, workspace-relative JSON paths. Absolute paths, traversal, symlinks, non-JSON paths, `.skp`/`.skb` paths, read-time replacement, unsupported fields, forged candidate hashes, invented structural counts, failed-attempt promotion, and self-asserted native success fail closed.

## Offline commands

```bash
node scripts/validate-real-model-reliability-sidecars.mjs
node test/real-model-reliability-sidecars.mjs
```

Expected summary:

```json
{
  "case_count": 7,
  "blocked_cases": 7,
  "execution_eligible_cases": 0,
  "native_mutation_successes": 0
}
```

Both commands are offline by construction. They must never require SketchUp to be open.

## Promotion path

Closing a readiness blocker requires new source-bound evidence, not an edit that changes `unknown` to `verified` by assertion. A native mutating result still requires:

1. an independently supplied artifact and strict `*.reliability.json` live contract;
2. preflight and a disposable working copy;
3. a fresh read-only queue handshake;
4. reviewed persistent target roles and exact model revision;
5. real-user approval for S2-S4 work;
6. postconditions, wrong-object checks, rollback/recovery evidence, and save/reopen identity where the case requires them.

Any future native success changes the evidence version and manifest. It must not mutate the v1 zero-success history in place.
