# Portal Structure S3 Boolean Live Workflow

`scripts/run-real-model-boolean-live.mjs` is a case-bound, fail-closed live workflow for one reviewed geometry QA operation on the disposable `Portal Structure` candidate copy. It is not a generic Boolean runner. A server recommendation, bounding-box relation, Agent assertion, or prior approval does not authorize mutation.

The current contract is `portal-structure-s3-boolean-live.v8`. Portal v1-v7 tasks, plans, challenges, approvals, and run records are superseded lineage only. They must not be translated, resumed as v8 authorization, or replayed.

The current evidence chain contains the [Portal v8 read-only discovery](evidence/portal-boolean-v8-readonly-discovery-2026-07-21.json), the [hash-bound live prepare](evidence/portal-boolean-v8-prepare-2026-07-21.json), and the [confirmed precommit-abort result](evidence/portal-boolean-v8-failure-evidence-2026-07-21.json). The real user approved the exact v8 S3 challenge and the service submitted it once. SketchUp failed the atomic trial before commit and confirmed a successful abort. No mutation receipt or saved copy exists; source bytes and the in-memory model returned to the exact baseline revision and structure. This case remains `release_acceptance=false`.

## Fixed v8 contract

- source file: the exact `candidate_e2ef3c5f82332f9174066759/candidate.skp` disposable copy;
- source SHA-256: `4a75190929bfa47b1506a8ed037a08e0f08e1632169d9bb550c4a9219b43e90c`;
- current model revision: complete `definition-merkle.v2` / `sha256:c03d317c25883606f0f8d7819610823118d916694d5a5d323deabe2ac7bcdf36`;
- current model identity: `sha256:d51e2f277f8d2349051afa5d82250b106116bf433fa2877fcdaec99c1b641719`;
- target/tool: `pid:11543` / `pid:11635`;
- operation/risk: `boolean_difference` / `S3`;
- preservation: `keep_originals=true`, `keep_tools=true`;
- output identity: `portal-structure-s3-boolean-result-v8` / `Portal_S3_Boolean_Result_v8`;
- v8 loaded Boolean source: `boolean_operations.rb` SHA-256 `2e3d686ba926f8b43f5a9847e05471587a217b536fd901811f10444948c2c444`;
- current loaded revision source: `model_revision.rb` SHA-256 `b5c4c64c346c5abe1258be32c8027d542a4ccc28e2afc70c48debf3fcb886134`;
- runtime contract: capability `0.1.0-rc.2-capabilities.7`, manifest `2026-07-agent-contract-v1.4`, and `definition-merkle.v2`; read-only structural probe contract: `structural-groups.v1`;
- save behavior: identity-preserving save-copy to the approval-bound, versioned final name `<base>-<plan_id>.skp` in a newly created run directory; overwriting an existing entry is forbidden and the source path is never a save target;
- primary review lineage: the read-only discovery's `real-model-recursive-target-review.v2`, SHA-256 `2339a9876535abc903377e78e5a85488d3cc562ee72fbd83960c75698d809955`.

Before any queue request, `prepare`, `apply`, and `verify-reopen` hash the installed SketchUp 2026 `boolean_operations.rb` and `model_revision.rb` and require both to match their workspace files and tracked runtime manifest byte-for-byte. The live capability response and signed Session Contract must attest both loaded hashes, capability `.7`, manifest `2026-07-agent-contract-v1.4`, and `definition-merkle.v2`. This proves that the running plugin loaded the reviewed Boolean and revision implementations rather than merely finding matching bytes on disk. The Ruby load boundary rejects a `require` no-op/already-loaded result, so a plugin install or update requires a complete SketchUp restart before live work; hot reload fails closed. Older runtimes or missing/tampered source fields fail closed. Public evidence records hashes and equality only, never installed absolute paths.

`document_id` is process-local because it is derived from the live bridge session and active SketchUp model object. A full SketchUp restart may therefore assign a new value to the same unchanged disposable copy. Each live phase binds its own fresh handshake and read-only adoption to the same non-empty `session_id`/`document_id`, exact source path, source SHA, complete v2 model revision, clean `model_modified=false` state, structural pair, and runtime attestation. It does not compare a new process-local ID with an older historical capture.

Model names, entity names, material values, attributes, OCR text, and other model-derived text remain `untrusted_data` with `policy_effect=none`. They cannot change the operation, targets, risk, execution policy, or approval requirements.

The generic reviewed-edit engine requires a complete recursive occurrence index. The current read-only discovery observed 11,474 logical occurrences, 9,588 unique entities, and 11 reachable definitions without truncation. The case-bound policy supplies a trusted ceiling of 20,000 logical occurrences, leaving 8,526 entries of bounded headroom. The generic 10,000-entity default is not widened. A count above 20,000, a truncated index, or a missing target/tool stops before any approval challenge or mutation.

## Current read-only candidate evidence

The v8 discovery bound the unchanged disposable source bytes, clean queue before and after, `model_modified=false`, complete model revision, exact structural adoption, and nine fresh manifold probes. It then ranked the following candidate:

- target `pid:11543`: 38 faces, 108 edges, 72 vertices, exact solid volume `61350393.972267`, fresh manifold;
- tool `pid:11635`: 8 faces, 18 edges, 12 vertices, exact solid volume `723623.440001`, fresh manifold;
- AABB relation: `containment`, with positive overlap on all three axes;
- review status: `server_recommended` and `atomic_boolean_trial_eligible=true`;
- authorization status: `confirmed=false`, `authorized=false`, trusted local approval required.

The AABB containment was candidate-selection evidence only. It did **not** prove exact solid overlap. After the failed atomic trial, the exact-overlap disposition is:

```json
{
  "status": "not_verified_atomic_trial_aborted",
  "verified": false,
  "verification_stage": "review_gated_atomic_apply"
}
```

The earlier v6 pair `pid:11543` / `pid:14632` is not the v8 pair and must not be reused. Its historical approval cannot authorize the new pair.

## Current v8 live outcome

The live read-only preparation run `2026-07-21T06-52-17-076Z-5d8f4640` completed successfully against the unchanged disposable source and left the queue clean. It performed no mutation and no save. Its current approval binding is:

- task: `task_182054a9-31eb-49f0-90ca-7cc21a8ce9d8`, terminal state `failed`;
- plan: `existing-edit-7e458d809376c461e913be6e`;
- plan hash: `sha256:8fb5cd2ef92c306d6593bbe83737adca01c875343e586de9d3ff57f93f695bea`;
- challenge: `approval_007843ef-a552-4e5e-b03a-0896bb07f59f`;
- review-context hash: `sha256:f5692b75e28987535c286e7fbaeda92288c076fb6054454ef970073f5f30864e`;
- expiry: `2026-07-21T07:07:26.356Z`.

The user's earlier pre-issuance “已批准” message was correctly ignored. The user later approved this exact challenge after issuance, the private decision remained server-side, and the task submitted exactly once. The approval is now `consumed_failed` and cannot be replayed.

The durable outcome is `MUTATION_EXECUTION_FAILED` with `phase=precommit_execution`, `commit_state=not_committed`, `abort_succeeded=true`, `outcome_unknown=false`, `mutation_committed=false`, `rollback_confirmed=true`, and no durable receipt. A fresh post-abort read-only adoption reproduced revision `sha256:c03d317c25883606f0f8d7819610823118d916694d5a5d323deabe2ac7bcdf36`, 11,474 logical occurrences, 9,588 unique entities, 11 reachable definitions, 18 exact structural groups, and the original manifold geometry for both paths. The source SKP hash remained unchanged, no save artifact was created, and final queue diagnostics were 0/0/0 with no lock.

[`Recursive Target Review v3`](real-model-recursive-target-review-v3-workflow.md) consumes this failure only after verifying the referenced public evidence bytes and their case/source/revision/pair/plan/runtime/outcome/retry bindings. Under the exact historical loaded runtime it excludes the failed directed pair; under current workspace runtime drift it blocks all automatic S3 recommendation; an unverified in-memory lineage cannot redirect the recommendation to another pair.

## Historical result and supersession

The historical attempts establish two different failure classes:

| Workflow | What happened | Governing disposition |
| --- | --- | --- |
| v1-v4 | Earlier contract iterations. | Superseded lineage only. No task, plan, challenge, or approval may be reused. |
| v5 | The mutation committed and a durable receipt was finalized, but the generated result was an invalid clone of the target: target volume was not reduced. A saved copy exists, but it is rejected and must not be promoted. | `apply-post-submit-failure.json` preserves the rejected clone result as historical lineage only. |
| v6 | The adapter used the corrected SketchUp `Group#split` target-difference entry and enforced exact target-volume reduction plus manifold result guards inside the transaction. For `pid:11543` / `pid:14632`, the atomic trial failed those preconditions and the transaction aborted before commit. | `apply-precommit-abort-confirmation.json` records `commit_state=not_committed`, `abort_succeeded=true`, `mutation_committed=false`, and `outcome_unknown=false`. The consumed v6 approval is not replayable. |
| v7 | Added approval-visible, plan-hash-bound geometry disclosure for the old pair. | Superseded lineage only. A v7 task or approval cannot be translated to v8. |
| v8 | Rebound the workflow to the fresh Review v2 candidate `pid:11543` / `pid:11635`; read-only discovery, live prepare, and exact real-user S3 approval passed. The only atomic submission then failed before commit and was successfully aborted. | Terminal failure lineage. The approval is consumed, automatic retry is forbidden, no model change or saved copy exists, and the pair must not be blindly retried. |

The v5 evidence exposed the split-order bug. SketchUp documents `Group#split` as `[Difference2 (other - self), Difference1 (self - other), Intersection]`; the old adapter selected the first entry instead of the target difference. The current Boolean source selects the second entry and checks the target's exact volume reduction and result manifoldness before commit.

The v6 attempt then established a separate fact: fixing split selection did not prove that the old two solids had a usable exact intersection. Its legacy `positive_volume_overlap=true` plus `relation=containment` came only from axis-aligned bounding-box comparison. Despite the historical field name, it was not an exact solid-overlap test. The same safety distinction governs v8.

The initial v6 outer failure record was conservatively written as `apply-outcome-unknown.json` because its outer error omitted the durable task details. Later inspection of the durable task proved a successful abort before commit. `apply-precommit-abort-confirmation.json` preserves the initial record unchanged but supersedes its classification for that attempt. This is a confirmed historical abort, not an unknown outcome and not a successful Boolean result.

## v8 geometry and approval contract

The v8 local approval page must display, and the plan/review-context hash must bind, this `geometry_validation` contract:

```json
{
  "evidence_kind": "bbox_candidate_only",
  "bbox_relation": "positive_bbox_overlap_unverified",
  "exact_solid_overlap": {
    "status": "unverified_before_atomic_trial",
    "verified": false,
    "verification_stage": "review_gated_atomic_apply"
  },
  "approved_action": "review_gated_atomic_boolean_trial",
  "success_preconditions": [
    "target_exact_volume_strictly_reduced",
    "result_manifold"
  ],
  "failure_disposition": "abort_before_commit"
}
```

The real-user v8 approval authorized exactly one hash-bound atomic trial. It did not assert that exact solid overlap already existed, and it did not authorize committing a no-op, unreduced target, or non-manifold result. The success preconditions did not complete, so the transaction aborted before commit as designed. Any future change to the disclosure, operation, target/tool, revision, risk, allowed operations, expiry, keep policy, or save contract requires a different task, plan hash, challenge, and trusted approval.

Agent-supplied `approved` fields, reviewer text, v1-v7 approvals, copied public values, or an approval for a different pair are not authorization. The v8 private one-time decision remained server-side and was bound to the task, plan hash, revision, risk, allowed operation, review-context hash, and expiry. It is consumed and cannot authorize another attempt.

## Commands and stop points

Preparation is explicitly live but read-only:

```sh
npm run qa:real-model-boolean:prepare
```

It checks the pinned v8 discovery hashes, source hash, installed and loaded plugin source attestations, idle queue, fresh Session Contract, exact clean document/current v2 revision, structural pair, exact bounding boxes/topology, fresh manifold attestations, and complete recursive index. Only after all read-only checks pass may it create a new `awaiting_review` S3 challenge. It includes the v8 `geometry_validation` disclosure in the prepare evidence and hash-bound approval context.

The command prints and stores only a sanitized approval URL/challenge ID. It never writes a Session Contract signature, approval token, or nonce to public workflow evidence. Re-running preparation may return the same current v8 task without another queue request; it never reuses a v1-v7 task.

For the current run, those checks passed and preparation created task `task_182054a9-31eb-49f0-90ca-7cc21a8ce9d8` with challenge `approval_007843ef-a552-4e5e-b03a-0896bb07f59f`. Preparation left the source unchanged and the queue clean. The task later reached terminal `failed` after its one approved atomic submission aborted before commit.

Status is local-only and never calls the queue:

```sh
npm run qa:real-model-boolean:status
```

`status-latest.json` remains an operator convenience file and may change on a later status read. The first terminal observation is also written once to `status-terminal.json`; later reads may differ only in `checked_at`, and any substantive terminal-state conflict fails closed. The public v8 failure wrapper hash-binds that immutable terminal snapshot rather than the mutable latest-status file.

Only a real user may approve the exact v8 challenge in the local approval page. After the page reports `approved_pending_execution`, apply first binds the resumed task, plan ID/hash, challenge/review-context hashes, geometry disclosure, operation, target/tool/result/keep policy, revision, risk, allowed operations, expiry, and save contract to the persisted prepare record. A server-side, non-token-returning authorization preflight reloads the private plan and persisted decision and returns only a sanitized readiness summary. A public `approved_pending_execution` string is insufficient.

Apply then performs a new idle check, fresh handshake, complete read-only adoption, exact source/revision/pair/manifold revalidation, and at most one idempotently keyed submission:

```sh
npm run qa:real-model-boolean:apply
```

Success requires all of the following: task `completed`; durable mutation receipt; source file SHA unchanged; queue clean; model revision changed; exactly one additional structural Group; original target and tool paths still present with unchanged baseline geometry; and a distinct fresh-manifold result whose exact volume is positive and strictly below the target's baseline volume. Only after those conditions may the workflow save the approval-bound copy and proceed to reopen verification.

The saved SKP must be the exact approval-bound final path and a direct child of the new mode-`0700` run directory. Node preflight walks the complete ancestor chain, rejects symlinks and non-directories, verifies realpaths remain under the approved root/run directory, and rejects any pre-existing final entry. The Ruby `save_copy` handler repeats the ancestor/realpath and existing/symlink checks immediately before saving and refuses overwrite.

Residual filesystem race: SketchUp's `model.save_copy` accepts a pathname and does not expose an `O_EXCL` file descriptor. The private random run directory and independent Node/Ruby checks narrow the window, but the workflow does not claim protection from a malicious same-account process that creates or swaps the final pathname between the last check and the SketchUp save call.

At the current evidence boundary, v8 `prepare` and real-user approval completed, and `apply` ran exactly once. The transaction was confirmed aborted before commit; there is no v8 mutation receipt, saved copy, or reopen proof. Re-running the consumed task is forbidden.

## Apply outcome classification and recovery

Never treat every failed apply as `outcome_unknown`. Durable evidence determines one of these states:

1. **Confirmed precommit abort.** Durable task evidence reports `failed` / `MUTATION_EXECUTION_FAILED`, `phase=precommit_execution`, `commit_state=not_committed`, `abort_succeeded=true`, no durable receipt, and no conflicting commit evidence. Record `outcome_unknown=false`, `mutation_committed=false`, and `rollback_confirmed=true`. Do not replay the consumed task or approval. Inspect the failure, correct the candidate or implementation, and create a new reviewed task.
2. **Unknown outcome.** Submission may have started, but there is neither a durable receipt nor confirmed abort evidence. Record `outcome_unknown=true`. Do not rerun apply. Use status/resume, inspect the active disposable model, and verify the queue is idle before deciding whether a new reviewed task is safe.
3. **Receipt-bound post-submit failure.** A durable receipt confirms a committed or recoverable mutation, but workflow QA/finalization is incomplete or failed. Do not replay mutation. Resume/finalize the existing task, inspect the disposable model, and complete QA against that receipt.
4. **Not submitted.** A task that remained in `created`, `understanding`, `awaiting_review`, or `approved` with no submission has `commit_state=not_submitted`; this is not a committed mutation and not an unknown outcome.

Conflicting durable evidence, such as both a confirmed-abort signature and a mutation receipt, fails closed as `evidence_conflict` and is treated as unknown until resolved. In all recovery classes, automatic mutation replay remains forbidden and duplicate mutation count must remain zero.

The post-v8 workspace plugin now emits one of 17 allowlisted `operation_failure_code` detail values under top-level `MUTATION_EXECUTION_FAILED` for future Boolean precommit failures without echoing model-derived names or raw exception text. This does not add 17 top-level Agent Contract error codes. The taxonomy is still pending safe installation, complete SketchUp restart, and fresh loaded-source attestation. The v8 attempt ran the historical loaded Boolean source `2e3d686b…c444`, before that taxonomy existed, so its generic failure cannot be retroactively assigned a more specific cause. Its public failure evidence preserves the exact historical runtime hashes; a later source hash is runtime drift, not permission to reinterpret or automatically retry the old pair.

## Save/reopen proof

Only after a successful, receipt-bound apply and save should the saved copy be opened manually in SketchUp with the plugin running. The read-only verifier is:

```sh
npm run qa:real-model-boolean:verify-reopen
```

The verifier never calls `open_model`. Before any read-only queue call, it binds completed apply evidence back to the v8 prepare task/plan/challenge/risk/source/revision/geometry disclosure/result and exact approved save path. It then requires a fresh handshake whose session/document/source-path/v2 revision, `model_modified=false`, and loaded-source attestations exactly match the reopened adoption, with the active source path equal to the saved copy. It compares model revision, persistent target/tool/result paths, fresh manifold attestations, structural identity hash, saved-copy hash, original disposable-source hash, and clean queue state.

There is currently no v8 saved-copy/reopen evidence. The rejected v5 copy cannot satisfy this gate, and the v6 abort produced no approved saved copy.

## Offline contract tests

```sh
npm run qa:real-model-boolean:contract
npm run test:portal-boolean-v8-readonly-discovery-evidence
npm run test:portal-boolean-v8-prepare-evidence
npm run test:portal-boolean-v8-failure-evidence
npm run test:portal-boolean-v8-failure-evidence-local-capture
npm run test:real-model-recursive-target-review-v3
npm run test:real-model-recursive-target-review-v3-evidence
```

The focused contract test reads the tracked, redacted `test/fixtures/portal-boolean-live-witness.v3.json` plus mock fixtures. Witness v3 binds the v8 pair and discovery hashes, explicitly records that the overlap evidence is AABB-only, keeps exact solid overlap unverified, requires trusted-user approval for an atomic trial, marks v1-v7 superseded, and forbids replay after either unknown or confirmed-abort outcomes. It keeps `authorization_boundary.confirmed=false`, `authorized=false`, and `release_acceptance=false`; the witness and discovery evidence are contracts, not live authorization.

The portable witness recursively rejects signatures, session IDs, tokens, secrets, credential-like values, and absolute local paths. Fake-bridge tests prove that unapproved or superseded tasks, geometry-disclosure drift, tampered public tasks, execution-contract drift, forged approval state/decision, stale plans, tampered apply/reopen evidence, and default or missing live opt-in make zero mutation queue calls. Boundary tests cover the exact 11,474/20,000 recursive-index policy and 20,001 fail-closed case, v8 idempotency separation, absent-public-token contract, challenge/expiry binding, complete-ancestor symlink and save-path/no-overwrite protection, current-session/document binding, witness/path/revision/manifold drift, unsaved-state and revision-strategy drift, installed/loaded-source mismatch, `require` no-op rejection, idempotent completed evidence, confirmed precommit abort, receipt-bound failure, true unknown outcome, conflicting evidence, and no automatic replay. Ruby tests bind the documented split order and abort a no-op or non-manifold difference before commit.

Private capture bindings can be revalidated only by an explicit machine-local command:

```sh
npm run test:real-model-boolean-live-capture-local
```

The underlying verifier requires `--local-capture` and exits before reading a private file when the flag is absent. With the flag, it verifies the ignored discovery, prepare, failure, post-abort adoption, and disposable source bindings without calling the queue. These captures establish the terminal v8 rollback lineage; they do not authorize a retry or establish a successful Boolean result.

This case remains `release_acceptance=false`. It is one exact, approval-gated real-model reliability case. It does not establish general Boolean correctness, semantic target understanding, or exact solid overlap for the Portal pair.
