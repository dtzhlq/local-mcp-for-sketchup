# Recursive Target Review v3 workflow

`real-model-recursive-target-review.v3` is an offline, fail-closed decision overlay on the stable v2 recursive review. It does not call the SketchUp queue, open a model, request approval, or authorize mutation. The complete v2 document remains embedded as `base_review`, so v1/v2 consumers are not silently reinterpreted.

## What v3 adds

For every structural candidate, v3 preserves `report.volume` only when the manifold report is a fresh, exact match for the occurrence path and model revision and its persistent id and topology counts match the structural entry. The output records:

- `exact_solid_volume`
- `exact_solid_volume_provenance=fresh_manifold_structural_attestation`
- `world_bbox_volume`
- `bbox_fill_ratio=exact_solid_volume/world_bbox_volume`
- `bbox_fill_ratio_semantics=sparsity_hint_only_not_exact_overlap`

The ratio is only a broad sparsity signal. It is never evidence that two solids overlap.

The default low-fill threshold is `0.1`. A containment pair with either endpoint below that threshold is marked:

- `exact_overlap_assessment.status=exact_overlap_unverified`
- `exact_overlap_assessment.evidence_requirement=needs_stronger_evidence`
- `atomic_boolean_trial_eligible=false`

This prevents a sparse assembly bbox from being mistaken for solid containment.

## Negative atomic trial lineage

Input lineage uses `negative-atomic-trial-lineage.v1` and is bound to all of the following:

- case id and disposable source SHA-256
- complete model revision
- directed target and tool occurrence paths
- operation and failed plan hash
- loaded Boolean and Model Revision source hashes
- `commit_state=not_committed`
- `abort_succeeded=true`
- `outcome_unknown=false`
- `mutation_committed=false`
- `rollback_confirmed=true`
- consumed, non-reusable approval and no retry/replay

Malformed, forged, cross-case, cross-revision, or non-aborted lineage is rejected. A lineage record cannot grant approval or mutation authority.

The pure derivation function remains filesystem-free and marks its evidence provenance `not_verified_pure_derivation`. When any unverified lineage is supplied, the whole review is blocked with `negative_source_evidence_unverified`; it cannot exclude rank 1 and then recommend rank 2. This verified state is not a public function option and cannot be self-reported by a caller.

The async runner and CLI fail closed unless every referenced evidence path is repository-contained, resolves without symlink traversal to a regular non-symlink file, and its raw bytes match the embedded SHA-256. The parsed public evidence must also use an allowlisted version/kind and exactly bind the disposable case/scope, source SHA, post-abort revision, directed operation target/tool, plan id/hash, historical runtime source hashes, failure outcome, consumed retry policy, and `release_acceptance=false`. A successful runner artifact records `verified_repo_regular_files_and_bound_content` and `negative_source_evidence_bytes_verified=true`; wrong hashes, `..` escapes, missing files, directories, symlinks, or content-field drift are rejected before any review artifact is written.

### Exact runtime match

When both runtime source hashes match, the exact directed pair is marked `confirmed_precommit_abort_exact_runtime`, excluded, and never recommended for replay. The failed task and approval remain consumed.

### Runtime source drift

The Portal v8 failure belongs to the historical loaded Boolean source hash `sha256:2e3d…c444`. The current workspace source hash is `sha256:b98f…7610`; v3 does not rewrite the historical evidence to the new hash.

When a supplied negative trial differs from the current runtime source binding, v3 records:

- `runtime_binding_status=runtime_delta_requires_review`
- `negative_trial_not_directly_reusable=true`
- the exact `runtime_delta_fields`

The whole review remains blocked and no S3 pair is automatically recommended until a trusted implementation-difference audit establishes a new evidence boundary. Runtime drift is neither silently discarded nor treated as proof that the failed geometry is now safe.

## Offline CLI

The existing CLI remains v2 by default. V3 is explicit:

```sh
node scripts/review-real-model-recursive-targets.mjs \
  --contract-version v3 \
  --adoption-file adoption.json \
  --source-sha256 sha256:<model-bytes-hash> \
  --model-revision sha256:<complete-model-revision> \
  --case-id portal_structure_disposable_copy \
  --boolean-operations-sha256 sha256:<currently-reviewed-runtime-source> \
  --model-revision-source-sha256 sha256:<currently-reviewed-revision-source> \
  --negative-trial-file negative-trial.json \
  --output recursive-review-v3.json
```

Omitting `--contract-version v3` preserves the v2 command and output contract. `--runtime queue` is not accepted by this script.

## Portal v8 portable result

The portable fixture contains only the three relevant structural groups and the public v8 negative lineage. Under the historical exact runtime, the failed rank-1 pair is excluded and the alternative rank-2 containment pair is blocked because its fill ratios are low and exact overlap remains unverified. Under the current workspace Boolean source, runtime drift additionally blocks every S3 recommendation pending trusted review.

Both outcomes are analysis-only and carry `release_acceptance=false`. Stronger overlap evidence or a corrected implementation still requires a new review, a fresh Session Contract, and a new trusted local approval before any live mutation.
