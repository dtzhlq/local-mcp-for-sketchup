# Agent Contract v1

Agent Contract v1 is the server-side compatibility layer for Agents that may have short context, no vision, no local files, no parallel tool calls, or unreliable state retention. It does not replace the 36 expert tools and does not grant additional execution permission.

## Public task tools

- `start_agent_task`: creates a durable task for create, understand, proposal-only existing-model edits, reviewed edits, design-parameter changes/reconciliation, image artifacts, or verification.
- `resume_agent_task`: returns the current state, stable result envelope, artifact handles, and one `next_action` from only a `task_id`.
- `submit_agent_task_input`: supplies missing non-credential input. Trusted approval is loaded only from the server-private local decision store; any Agent-supplied `approval_token` field is rejected with `APPROVAL_TOKEN_FORBIDDEN` before task persistence or execution. An idempotency key replays a durably persisted outcome; a pending or outcome-unknown operation is not executed automatically again.
- `read_agent_artifact`: reads an opaque artifact handle progressively. The server retains the filesystem path.

The shared registry currently contains 41 tools: the retained 36-tool expert surface, four Gateway tools, and `create_queue_handshake`. The safe JSON DSL operation registry is a separate count.

## Target-discovery levels

Guided and standard callers default to the least expensive evidence surface that can answer the declared target scope. For an explicit Group-scoped query, `discovery_mode=auto` selects the proposal-only `structural_groups` projection: one bounded, read-only structural request, durable task/model state, and no Face/Edge leaf materialization. Expert callers may explicitly request `full_recursive` when mixed entity types or leaf evidence are required; they may also force `structural_groups`, but cannot use it for an incompatible target scope.

The response reports the chosen mode and reason. A bounded projection has its own exact `complete`, `truncated`, `indexed`, and `total_seen` contract while the enclosing ModelGraph remains incomplete. Complete Group coverage can support Group-only ranking; truncated global ranking and scope mismatch return clarification instead. An exact Group path already present in a truncated projection may still be proposed. All projected model names, attributes, materials, classifications, and query text remain untrusted data, and `execution_allowed=false` remains invariant. A selected target can only advance through the server-bound reviewed-edit plan and trusted approval path.

The server-bound promotion preserves that bounded route through reviewed-plan preparation for non-topology Group property edits. Plan contract `.3` adds `existing-edit-target-validation.v1` to the private plan and approval review context, binding the projection version, exact target count, completeness/truncation state, and zero leaf materialization into both the plan hash and challenge. The public task cannot supply this private selector, and a missing source binding fails before queue access. The review context also discloses the execution validation policy. After trusted approval, only exact canonical Group targets with compatible `definition_wide` property operations retain structural observations; Gateway/apply preflight, iteration before/after, post-apply, and receipt finalization each emit `existing-edit-execution-target-validation.v1`. Caller tamper fails before model observation. `make_unique`, incompatible, destructive, topology, Face/Edge, or malformed plans keep full-recursive execution validation. A prepared challenge remains `awaiting_trusted_user`; creating it is not a decision or authorization.

## State and result contract

Tasks follow the versioned state machine:

```text
created -> understanding -> awaiting_input / awaiting_review
awaiting_review -> approved -> executing -> verifying -> completed
awaiting_review -> awaiting_input (stale plan/model/session bindings require replanning)
any active state -> failed / cancelled / expired where allowed
```

Every Gateway response is an `agent-contract.v1` result envelope with `task_id`, `task_state`, `task_version`, canonical `result`, top-level normalized `warnings`, `retryable`, `idempotent_replay`, `error`, `next_action`, and artifact handles. `data` is the same payload as `result` for compatibility; new clients should read `result`. Warning sources are merged and de-duplicated, so an empty snapshot warning list cannot hide later QA warnings. Stable error definitions live in `src/agent-contract.mjs`. JSON Schemas live in the root `schema/` directory.

The registry currently contains 40 stable top-level error codes. P1 added `MODEL_IDENTITY_MISMATCH`, `MODEL_REVISION_INCOMPLETE`, `MODEL_IDENTITY_UNAVAILABLE`, `MODEL_GRAPH_NOT_FOUND`, and `MODEL_GRAPH_INTEGRITY_ERROR` to the earlier 31-code P0 registry so document-switch races, incomplete live revision coverage, persistent graph identity, lookup, and integrity failures remain machine-actionable and fail closed. P3 adds `ARTIFACT_INTEGRITY_ERROR` with `reingest_artifact_and_report_corruption`, keeping immutable image artifact corruption distinct from ModelGraph corruption. P0 durability closure adds `MUTATION_RECOVERY_REQUIRED` for a valid committed receipt whose server-only finalizer must resume, and `MUTATION_RECEIPT_INVALID` for receipt/claim/plan/model integrity failures. The public-credential boundary adds non-retryable `APPROVAL_TOKEN_FORBIDDEN`, whose next action is to remove the credential and resume only after the trusted local decision has been recorded. The current workspace Boolean adapter also emits one of 17 allowlisted `operation_failure_code` detail values under top-level `MUTATION_EXECUTION_FAILED`; those details do not increase the 40-code registry and are not live evidence until the updated plugin is installed, fully restarted, and freshly attested.

Policy, Session Contract, and queue-idle failures that occur before the authorized execution callback do not destroy the task. Create/verify tasks move to `awaiting_input`; human-reviewed edit tasks remain `awaiting_review` unless document/model/revision/version drift requires a new plan. A Copy Fast task may already be `approved`, but that state is still pre-execution; a failed session/policy/handshake recheck moves it to `awaiting_input`. The error is persisted as `last_error`, so `resume_agent_task` and an idempotent replay remain `ok=false` with the same stable error and executable `next_action`.

A reviewed mutation now requires a submit idempotency key. After the trusted application call returns, the Gateway performs a read-only adoption inside the same authorized/exclusive execution scope and computes the exact canonical after revision. Before the task can enter `verifying` or any terminal state, it writes a private `task-mutation-receipt.v1` record bound to task id, surviving submit claim and request fingerprint, plan id/hash, model key, before/after revisions, risk, runtime, trusted bridge/application receipt, and a server-only finalizer payload. The record and its local signing secret use 0600 files under 0700 directories, reject symlink substitution, and carry both a canonical payload hash and local HMAC. Public envelopes expose only the opaque receipt id and status; they never expose the native receipt, finalizer payload, approval credential, idempotency key, or artifact paths.

If a process stops after this durable receipt exists, the same submit request or `resume_agent_task` may claim only the stale/dead surviving idempotency record under its cross-process recovery lock. It revalidates the receipt HMAC and exact claim/plan/model/revision binding, runs only the step-idempotent post-commit finalizer, and never calls `apply_reviewed_model_edit` again. Artifact registration reuses an existing path/label handle; visual lineage uses the receipt timestamp; DesignIntent persistence is content-addressed; post-apply reconciliation challenges use an idempotent binding. A transient finalizer failure keeps the task in `executing`/`verifying` with `MUTATION_RECOVERY_REQUIRED` and `next_action=resume_task_finalization`.

Model mutation is classified as started only after the task enters `executing`; `approved` is a recoverable pre-execution state. Once execution begins, a missing durable task receipt is not by itself enough to classify the outcome. A trusted, internally consistent precommit-abort record may prove `outcome_unknown=false`, `mutation_committed=false`, and `rollback_confirmed=true`; the failed task and authorization are still terminal and cannot be replayed. If neither a valid durable receipt nor a trusted confirmed-abort record exists, the result remains outcome-unknown and is returned as `MUTATION_EXECUTION_FAILED`, with `retryable=false` and `next_action=inspect_failure_then_start_new_task`. This includes the narrow boundary where SketchUp may have committed and returned its native receipt but Node stops before the in-scope post-apply adoption and durable task receipt write. The implementation therefore does not claim universal native-process exactly-once recovery. Raw exceptions are not echoed, and an Agent must inspect the active model and failure evidence instead of assuming an identical retry is safe. Snapshot-only verification remains outside this mutation-uncertainty classification.

`retryable` and task resumability are different contracts. `QUEUE_LOCK_PRESENT` can be retryable after the queue owner releases the lock. A missing or expired handshake is not an identical-request retry: follow `next_action`, create a new contract, and submit it with a new idempotency key to resume the same task.

## Creation-only DSL boundary

`create_model` and the code form of `verify_model` are not alternate existing-model editing routes. Before either task can call `build_model`, the Gateway expands supported high-level DSL macros and checks the resulting operations against a fixed additive-creation allowlist. The exact canonical expanded document that passed the check is the document sent to the runtime. `reset`, target/entity-path edits, destructive/topology operations, named-resource upserts (`material`, `tag`, `image_reference`), named `level` sidecar changes, embedded object-valued material specifications, image planes that implicitly upsert a generated material, `component_definition` replacement, selection, and global camera/scene/style/shadow/rendering changes fail with `OPERATION_NOT_ALLOWED` before task execution begins. A newly registered DSL operation is blocked by default until it is explicitly classified as additive.

The boundary is intentionally conservative. It currently allows 56 standalone/additive geometry operations, including new component instances and the room helper; the other 45 registered operations are blocked. The room helper's implicit materials are retained because they are add-if-missing and do not update an existing material. A macro is allowed only when every expanded operation is allowed, so macros that expand to material declarations, component-definition replacement, level sidecar changes, or presentation state remain expert-only. Existing-model changes must enter a separate `reviewed_existing_model_edit` task and use its model revision, plan hash, risk, allowed-operation, expiry, and trusted-approval bindings.

`verify_model` accepts exactly one of `code` or `snapshot`. Snapshot verification performs QA without executing DSL or mutating the model. Code verification uses the same creation-only gate; queue code still requires server mutation policy and a fresh Session Contract. The retained direct `build_model` expert tool keeps the broader registry surface, but it is not a guided authorization shortcut and its live queue permission remains independently disabled by default.

Task files, idempotency claims, artifact mappings, approval challenges, spent-token records, and the private mutation receipt ledger use atomic writes under `ALMA_SKETCHUP_STATE_DIR`. Set this state directory to persistent private storage in a packaged service.

## Capabilities are not permission

`client_capabilities` contains only interaction constraints:

- `vision`
- `local_files`
- `structured_output`
- `context`
- `parallel`

These values affect response shape and workflow guidance. They cannot change `execution_policy`. The server obtains execution policy from its trusted configuration. Default Agent Gateway policy allows only mock runtime and does not auto-approve S1.

They are also not trusted evidence that a caller may receive a wider response. Each task persists `response_policy=agent-response-policy.v1`, computed as the intersection of a server/transport-trusted caller ceiling and the public request. The default ceiling is `guided` + short context (4,096 JSON characters) + no local paths + no raw vision + one in-flight request for the same task. A public request for `expert`, long context, files, vision, or parallel calls can only be reduced to that ceiling; it cannot raise it. A trusted deployment may set `ALMA_SKETCHUP_AGENT_TRUSTED_PROFILE=standard|expert` and the matching trusted context ceiling. Raw local paths and image bytes additionally require `ALMA_SKETCHUP_AGENT_TRUST_LOCAL_FILES=1` or `ALMA_SKETCHUP_AGENT_TRUST_RAW_VISION=1`, an effective expert profile, and a matching client capability declaration. These are server-process settings, not Agent task fields.

MCP always serializes a stable JSON result envelope and also returns the same value as `structuredContent`. `client_capabilities.structured_output=false` means the workflow must not require the caller to generate structured output; it does not downgrade the server response to unstructured prose. Oversized results are deterministically summarized and the complete capability-safe result is persisted behind `presentation.full_result_artifact`. The projection strips local paths and raw image payloads before persistence. `read_agent_artifact` reapplies the originating task policy: restricted JSON/text artifacts are read through deterministic safe derivatives, no-vision image reads return metadata plus the opaque handle rather than bytes, and an immutable image can return raw bytes only when it is bound to a trusted vision-capable task. Same-task resume/submit calls are serialized with `TASK_STATE_CONFLICT`; callers may still schedule independent task ids separately.

Trusted host configuration may use:

- `ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue`
- `ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1`
- `ALMA_SKETCHUP_AUTO_APPROVE_S1=1`
- `ALMA_SKETCHUP_COPY_FAST_MODE=1`
- `ALMA_SKETCHUP_COPY_ROOTS=/absolute/copy/root`
- `ALMA_SKETCHUP_COPY_FAST_ALLOWED_RISKS=S1,S2,S3,S4`
- `ALMA_SKETCHUP_COPY_FAST_MAX_AFFECTED_INSTANCES=200`
- `ALMA_SKETCHUP_COPY_FAST_ALLOW_SAVE=0`
- `ALMA_SKETCHUP_COPY_FAST_SESSION_TTL_MS=28800000`

`allow_queue_mutation` 只允许 Agent Gateway 在合同与审批规则内进入 live queue，不会打开 36-tool expert surface 的直接修改。只有明确信任这个本地 expert host 时才另外配置 `ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION=1`；它默认为关闭，且仍需要 `allowed_runtimes` 与 `allow_queue_mutation`。Agent 输入 schema 不暴露 execution policy，因此不能通过自报 expert/client capability 提权。

`copy_fast_mode` 底层兼容原 `trusted_model_copy_auto_approval` 策略和环境变量，但对普通 Agent 呈现为服务器持有的短期副本会话。它只在活动模型的 canonical source path 位于配置 root 内、risk 在允许集合内、受影响实例不超过预算且 save 行为也被策略允许时生效。root 本身不进入公开 task；Agent 只看到 root 数量、opaque session id 和 `user_action_required=false`。同一服务进程和模型副本可跨 task/revision 复用会话；重启、过期、撤销、model/runtime 变化会失效。每个计划仍绑定 source-path/root fingerprint、risk、affected count、operation、revision 和 save contract，执行前按 live adoption 重新计算。若显式 save path 越出命中的副本 root，也会 fail closed。

Queue permission does not remove the fresh-handshake requirement. 命中 Copy Fast 的任务直接进入 `approved`，返回 `next_action=execute_copy_edit`，不创建逐任务 challenge，也不需要用户阅读技术审批内容；fresh Session Contract 仍由 Agent/服务器完成。目录外 S2-S4 默认继续可信用户逐任务批准。完整用户说明见 [`副本快速模式 v1`](copy-fast-mode-v1.md)。

## Fresh queue handshake / Session Contract v1

`get_capabilities --runtime queue` proves that the installed plugin can answer, but it is not mutation authorization. `create_queue_handshake` is the only MCP path that issues `session-contract.v1`. It is explicit queue-only and read-only: it does not create, open, reset, adopt, select, save, capture, or modify a SketchUp model.

The signed, short-lived contract binds:

- `handshake_id`, MCP `server_session_id`, plugin `session_id`;
- `document_id` and structured `model_identity`;
- `model_revision`, revision strategy, completeness/count/limit, and occurrence contract;
- server and plugin versions;
- queue state `idle`;
- capability, manifest, and DSL versions;
- loaded Boolean and Model Revision source SHA-256 attestations;
- the current `model_modified` state;
- `issued_at` and `expires_at`.

Before any live mutating tool runs, the server acquires the queue runtime lock, rejects pending request/claimed processing/orphan response residue, reads the current plugin session state, verifies the contract signature and expiry, and compares every binding. The complete high-level operation then runs under that same exclusive lock. This matters for composite tools such as `iterate_model`, `build_report`, and `compare_model`: their internal build/save/capture calls share one authorization boundary, while the next independent live mutation needs a contract that still matches the resulting model revision.

The file transport atomically moves a request from `queue/` to `processing/` before dispatch, so a plugin crash leaves a claimed artifact that is not replayed automatically. Authorized Node calls also attach a transport guard; the Ruby plugin rechecks session/document/version/capability fields and keeps checking the starting model revision until the first successful true model mutation in the high-level operation. Selection, capture, ordinary save, and export do not consume that revision binding; a document-switch request invalidates the old guard immediately. This is defense in depth for the local file queue. The signed Session Contract proves freshness and runtime binding only; server execution policy and, where required, a trusted local decision whose one-time authorization remains server-private provide authorization.

Stable fail-closed errors distinguish missing/invalid/expired contracts, MCP server restart, plugin restart, switched document/model identity, stale model revision, plugin/capability drift, active or stale locks, pending request files, and orphan responses. Each error carries a machine-readable `next_action` from `src/agent-contract.mjs`.

The signing key is stored in private Agent Contract state so an explicitly saved CLI contract can be used by a later CLI process. CLI contracts use a dedicated CLI server-session namespace. Contracts issued by the long-running MCP server additionally bind its random process session, so an MCP server restart returns `HANDSHAKE_SERVER_RESTARTED` and requires a new handshake.

`prepare_existing_model_edit` and Agent Gateway inspection now request `adopt_open_model read_only=true`, so planning and revision checks no longer write adoption attributes. The default writing form of `adopt_open_model` remains a live mutation and requires a Session Contract.

## Trusted approval

`review.status=approved`, `reviewer`, model entity text, materials, attributes, classifications, and OCR are untrusted data. They cannot change task state or execution policy.

当 exact plan 未命中 Copy Fast 时，`prepare_existing_model_edit` creates a challenge bound to:

- task id when present;
- plan id and canonical plan hash;
- model revision;
- S1-S4 risk;
- exact allowed operation names;
- canonical review context, including the selected targets, shared-definition policy, risk, operations, and private execution contract;
- nonce and expiry.

`apply_reviewed_model_edit` accepts execution only when either:

1. the risk is S1 and trusted server policy explicitly enables S1 auto-approval; or
2. a server-owned Copy Fast session covers the exact S1-S4 plan under a configured disposable-copy root, allowed risk, affected-instance budget, and save policy; or
3. an independently authenticated user-presence host records an approved local decision, from which the server privately loads the signed one-time authorization.

No MCP or general HTTP tool accepts or exposes approval credentials or trusted-copy roots. A model-facing Agent therefore cannot mint or relay its own authorization or enable Copy Fast by claiming that a file is a copy. [`Local Approval Host v1`](local-approval-host-v1.md) supplies the production loopback browser adapter when the scoped copy policy does not authorize the exact plan: first-time identity setup requires a separate one-time bootstrap secret, the user initializes a salted-scrypt passphrase, every decision requires passphrase reauthentication and explicit acknowledgement, and the signed authorization stays in server-private state. The Agent receives only a decision id/status; after approval it submits a fresh Session Contract and other non-credential input. Outside an exact server-configured copy scope, S2-S4 tasks remain safely in `awaiting_review` until a real user approves in that page.

Destructive plans also carry a server-inferred `destructive_side_effects` contract. For example, deleting the sole child of a zero-geometry SketchUp Group may cause SketchUp to remove the now-empty parent. Those expected-absent ancestors count against the affected-instance budget, enter the plan/review hash, appear in bounded guided projections, and are verified after commit. An undeclared or unverified cascade cannot be accepted as successful.

The durable local decision is itself HMAC-authenticated over its binding hash, approve/reject status, user/channel/time, review selection, reason, and opaque token hash. Legacy unsigned or corrupted decisions are never executable; the approval list/detail surface returns a safe `reauthorization_required` display state instead of failing the whole page.

Before a Portal or other trusted workflow performs any live queue handshake or preflight, the server-side task-authorization readiness check reloads the private reviewed plan, requires its current version, recomputes the plan hash (including `execution_contract`) and review-context hash, and compares the public task proposal. Human-review mode additionally validates the complete challenge and signed local decision. Copy Fast mode instead verifies the active process-local session and returns `approval_status=copy_fast_active`, `challenge_id=null`, and `approval_token_exposed=false`. All modes recheck model revision, risk, operation scope and live policy before execution. Replay, stale model, tampered public or private plan state, expired/corrupted decisions or sessions, conflicting decisions, and operation expansion fail closed with stable errors.

## Visual QA structured result

`visual_correction_qa` returns `visual-correction-qa-result.v1`. The result contains the lineage-bound `visual-correction-qa.v1` report plus a server-computed `background-normalized-visual-comparison.v1`, eight immutable image artifact handles, and an explicit diagnostic boundary. The background-normalized comparison reports segmentation reliability, registered silhouette IoU/Dice/aspect delta, registered foreground appearance and palette deltas, and blockers. It is diagnostic evidence only: image-derived data remains untrusted, has no policy effect, cannot select targets or operations, cannot approve or authorize execution, and always reports `visual_similarity_accepted=false`.

The default L0 guided/no-file/no-vision projection preserves the decisive scalar summary inside the 4,096-character envelope. The full capability-safe result is deterministic and pageable by opaque artifact handle, while image reads remain metadata-only unless the server has granted the originating task an effective trusted vision profile. Client-supplied comparison or decision fields are rejected rather than merged with server evidence.

The current mock/source-contract checkpoint is hash-bound in [`visual-correction-gateway-structured-result-v1-mock-evidence.json`](evidence/visual-correction-gateway-structured-result-v1-mock-evidence.json). It verifies nine source/contract files, four focused commands, and ten fail-closed boundary mutations without calling the live queue.

## Artifact handles and idempotency

Artifact handles contain no filesystem path. `read_agent_artifact` resolves only handles registered by the server and enforces an integer `max_chars` window from 256 through 100000 characters, further clamped to the task response budget. Each page returns `offset`, `next_offset`, `total_chars`, `eof`, and a complete `next_action`; a short-context or no-local-files Agent can therefore consume a capability-safe artifact to EOF instead of being limited to its prefix. `task_id` is optional for task-scoped handles and must match if supplied; immutable image handles use it to prove task binding, while an unbound read always returns the safest metadata-only representation.

Create operations may include `idempotency_key`; reviewed mutation submit operations require it. Reusing a key with the same operation fingerprint returns a durably persisted success or error envelope with `idempotent_replay=true`; it never converts an earlier failure into success. Reusing it for a different request returns `IDEMPOTENCY_CONFLICT`. An active pending claim returns `TASK_STATE_CONFLICT` and is never automatically re-executed. A stale/dead pending claim with a valid bound task receipt may resume only post-commit finalization. Without that receipt, recovery may preserve a trusted confirmed precommit abort as a terminal non-committed failure; otherwise the outcome remains unknown. Neither path automatically re-executes the mutation. After following a pre-execution recoverable error's `next_action`, supply a new key because the corrective input has a different fingerprint.

## Verification

The mock regression gates cover schema validation, disk restart recovery, client-policy separation, forged approval, signature tampering, expiry, success/error replay, plan/revision/operation binding, complete opaque-artifact pagination, task resume, preflight recovery, duplicate-mutation prevention, handshake tampering/expiry/restart/model-switch/stale-revision/capability drift, and residual queue artifact rejection. Workflow examples are checked against the shared tool schemas, and independent live mutations in the verify workflow must each consume a fresh Session Contract. Live queue validation is intentionally not part of the default test command.

Stale or dead create/submit idempotency claims are recovered under a cross-process recovery lock. Recovery publishes claims atomically, allows only one new owner, and returns `TASK_STATE_CONFLICT` while an active owner remains. A task found in `executing` or `verifying` after process loss is finalized without re-execution only when its HMAC-protected receipt still matches the original response-free submit claim. A trusted confirmed precommit abort remains `MUTATION_EXECUTION_FAILED` with `not_committed`/`rollback_confirmed` and no replay; a missing receipt without that proof remains outcome-unknown. Mismatched, forged, corrupted, symlinked, or claim-detached receipts fail as `MUTATION_RECEIPT_INVALID`.

P1 proposal promotion uses a server-private source binding. The reviewed task resolves the source proposal from its originating task, recomputes the proposal hash, verifies the source task/proposal/graph/revision tuple, and copies the stored targets and operations into the existing-edit plan. Supplying target/operation overrides, tampering with the proposal binding, or promoting after revision drift fails before approval challenge issuance.

Current tests cover this binding and the 40-code registry in mock/fake/source-shape mode. Receipt tests cover strict schema validation, private modes, restart load, HMAC tampering, plan/model/claim mismatch, symlink substitution, crash immediately after the durable receipt write, crash inside artifact/visual/DesignIntent finalizer steps, crash after the terminal task transition but before response-claim persistence, deterministic visual lineage and approval challenges, resume by task id, same-request replay, zero repeated model mutation, public-artifact receipt redaction, after-revision drift blocking, confirmed precommit aborts, and outcome-unknown handling when neither receipt nor confirmed-abort proof exists. These recovery tests do not call the live queue. The controlled S1 abort fixture performs one valid attribute write followed by `manifold_check(fail_on_non_manifold=true)` against a known open mesh, proving transaction rollback without relying on an invalid operation payload.

A separate current-source S2 live proof now covers the production user-presence path. The first real-user-approved rename committed natively but exposed that versioned persistence used Save As and changed the active document identity; strict identity verification failed with `MODEL_IDENTITY_MISMATCH`, and no durable task receipt was accepted. After replacing that path with identity-preserving `Sketchup::Model#save_copy`, installing the exact matching plugin, and fully restarting SketchUp, a new S2 challenge bound to one `rename` operation completed with a consumed private decision and a finalized HMAC-protected task receipt. The same persistent entity survived, geometry and bounding-box deltas stayed zero, the active document identity remained associated with the pre-save model, and the queue was clean before and after. See [`local-approval-live-evidence-2026-07-16.json`](evidence/local-approval-live-evidence-2026-07-16.json). This remains a one-model S2 proof and does not eliminate the native-commit-to-task-receipt crash gap or prove S3/S4, external-reference correction, multi-model reliability, version coverage, or release acceptance.

A later current-source controlled S4 proof covers the distinct standing-authorization path requested for disposable copies. The server policy allowed S2-S4 only under two configured roots, capped affected instances at 10, and prohibited saving. A complete `5859 / 5859` Fire Escape adoption bound deletion of `pid:9287.9289` plus SketchUp's expected cleanup of its empty parent `pid:9287` into the same plan hash. The guided projection exposed that cascade, no per-task approval click or Agent token was used, one submit completed with authorization mode `server_policy_trusted_model_copy_auto_approval`, the durable receipt finalized, both targets were absent, the revision changed, queue state returned to `0/0/0` with no lock, and the on-disk model bytes remained unchanged because `save_model=false`. See [`controlled-s4-delete-live-evidence-2026-07-22.json`](evidence/controlled-s4-delete-live-evidence-2026-07-22.json) and the matching [mock policy evidence](evidence/trusted-model-copy-auto-approval-v1-mock-evidence.json). This is one unsaved disposable-model S4 case, not broad destructive-edit reliability, fresh-process proof, save/reopen proof, cross-version coverage, or release acceptance.

A later Portal v8 S3 task exercised the same real-user approval boundary as a negative trial: the exact challenge was approved and submitted once, the SketchUp transaction failed before commit, abort succeeded, the model revision and source bytes stayed unchanged, no durable receipt or saved copy was created, and the approval became `consumed_failed`. This is trusted non-commit evidence, not a successful S3 case and not permission to retry. Recursive Target Review v3 excludes that exact failed pair under the historical loaded runtime, blocks runtime-drift reinterpretation, and treats low bounding-box fill ratio as a sparsity hint rather than exact overlap proof. See [`portal-boolean-v8-failure-evidence-2026-07-21.json`](evidence/portal-boolean-v8-failure-evidence-2026-07-21.json) and [`real-model-recursive-target-review-v3-workflow.md`](real-model-recursive-target-review-v3-workflow.md). Both remain `release_acceptance=false`.

The July 21 large-model plan `.3` capture covered the same weak-client contract through reviewed-plan preparation without entering approval execution. On a Trimble S6 disposable model with a complete 71,360-occurrence revision, the guided task used two complete 41-Group structural probes, selected one `largest group` candidate, and prepared an exact S2 rename plan. The full graph remained explicitly incomplete with zero Face/Edge leaves; the plan hash bound `target_validation`, and the review context disclosed the matching bounded execution-validation policy. The challenge stayed pending with no decision/token and the model and queue remained unchanged. The proposer changed after capture, so [`current-source-reviewed-plan-v3-live-evidence-2026-07-21.json`](evidence/current-source-reviewed-plan-v3-live-evidence-2026-07-21.json) is now a historical exact-source snapshot, not current-source reviewed-plan acceptance. There is no current reviewed-plan replacement. The bounded execution implementation remains schema/mock proven across six phases; live post-approval mutation is not claimed.

The formal cross-domain mock target-quality benchmark runs the same Gateway contract under an L0 profile across four independent mock revisions. Five tasks cover architecture/product unique selection, interior/shared ambiguity abstention, and exact shared-occurrence `make_unique` clarification. It records top-5 `3/3`, ambiguity `2/2`, clarification `1/1`, 191 public artifact pages, no raw model-label disclosure, and all four execution hard gates at zero. See [`model-graph-target-quality-v1-mock-evidence.json`](evidence/model-graph-target-quality-v1-mock-evidence.json).

The current-source real-SKP benchmark separately covers four byte-exact architecture, deep-shared, interior, and product fixtures using the lowest-capability L0 profile and a single structural goal, `largest group`. Three unique selections matched a server-private world-bounds oracle and landed in top-5; one exact-volume tie correctly abstained. The aggregate records 4 Gateway calls, 138 artifact-page calls, zero schema errors, unchanged model bytes/revisions/modified state, clean queues, no approval/mutation/save, and all four execution hard gates at zero. See [`current-source-multi-model-target-quality-live-evidence-2026-07-22.json`](evidence/current-source-multi-model-target-quality-live-evidence-2026-07-22.json). This is a narrow structural target-quality result, not broad semantic-intent, current reviewed-plan, live mutation, cross-version, or release acceptance.

## Design parameter changes

`modify_design_parameters` builds a versioned DesignIntentGraph from reviewed recipe, feature mapping, PartGraph, and persistent entity bindings. It computes an affected dependency subgraph and emits a safe-DSL rebuild proposal, but never executes it. The proposal must start a separate `reviewed_existing_model_edit` task and pass trusted approval.

`reconcile_design_intent` compares saved entity fingerprints with a current ModelGraph. Reviewed parameter rebuilds and unexpected manual edits are classified separately. Either class requires review before the stored baseline changes; unexpected divergence blocks later parameter changes and is never silently overwritten.
