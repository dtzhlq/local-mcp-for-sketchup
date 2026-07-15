# Agent Contract v1

Agent Contract v1 is the server-side compatibility layer for Agents that may have short context, no vision, no local files, no parallel tool calls, or unreliable state retention. It does not replace the 36 expert tools and does not grant additional execution permission.

## Public task tools

- `start_agent_task`: creates a durable task for create, understand, proposal-only existing-model edits, reviewed edits, design-parameter changes/reconciliation, image artifacts, or verification.
- `resume_agent_task`: returns the current state, stable result envelope, artifact handles, and one `next_action` from only a `task_id`.
- `submit_agent_task_input`: supplies missing input or carries a token produced by a trusted user-presence channel. An idempotency key prevents duplicate execution.
- `read_agent_artifact`: reads an opaque artifact handle progressively. The server retains the filesystem path.

The shared registry currently contains 40 tools: the retained 36-tool expert surface plus these four Gateway tools. The safe JSON DSL operation registry is a separate count.

## State and result contract

Tasks follow the versioned state machine:

```text
created -> understanding -> awaiting_input / awaiting_review
awaiting_review -> approved -> executing -> verifying -> completed
any active state -> failed / cancelled / expired where allowed
```

Every Gateway response is an `agent-contract.v1` result envelope with `task_id`, `task_state`, `task_version`, `retryable`, `idempotent_replay`, `error`, `next_action`, and artifact handles. Stable error definitions live in `src/agent-contract.mjs`. JSON Schemas live in the root `schema/` directory.

Task files, idempotency claims, artifact mappings, approval challenges, and spent-token records use atomic writes under `ALMA_SKETCHUP_STATE_DIR`. Set this state directory to persistent private storage in a packaged service.

## Capabilities are not permission

`client_capabilities` contains only interaction constraints:

- `vision`
- `local_files`
- `structured_output`
- `context`
- `parallel`

These values affect response shape and workflow guidance. They cannot change `execution_policy`. The server obtains execution policy from its trusted configuration. Default Agent Gateway policy allows only mock runtime and does not auto-approve S1.

Trusted host configuration may use:

- `ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue`
- `ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1`
- `ALMA_SKETCHUP_AUTO_APPROVE_S1=1`

Queue permission does not remove the fresh-handshake or user-coordination requirement.

## Trusted approval

`review.status=approved`, `reviewer`, model entity text, materials, attributes, classifications, and OCR are untrusted data. They cannot change task state or execution policy.

`prepare_existing_model_edit` now creates a challenge bound to:

- task id when present;
- plan id and canonical plan hash;
- model revision;
- S1-S4 risk;
- exact allowed operation names;
- nonce and expiry.

`apply_reviewed_model_edit` accepts execution only when either:

1. the risk is S1 and trusted server policy explicitly enables S1 auto-approval; or
2. a signed one-time token is issued by `ApprovalAuthority.approveChallengeFromTrustedUser` through an embedding host's real user-presence channel.

No MCP or HTTP tool exposes token issuance. A model-facing Agent therefore cannot mint its own authorization. The embedding desktop app or future local approval UI must call the trusted authority in-process after it has independently established user presence. Until such a host adapter is connected, S2-S4 tasks remain safely in `awaiting_review`.

Token signature, expiry, challenge state, task, plan hash, model revision, risk, and operation scope are verified before execution. Successful verification consumes the challenge atomically. Replay, stale model, tampered plan, expired token, and operation expansion fail closed with stable errors.

## Artifact handles and idempotency

Artifact handles contain no filesystem path. `read_agent_artifact` resolves only handles registered by the server and enforces a bounded character window.

Create and submit operations may include `idempotency_key`. Reusing a key with the same operation fingerprint returns the existing task/result. Reusing it for a different request returns `IDEMPOTENCY_CONFLICT`. A successful reviewed edit cannot run twice through the same key.

## Verification

The mock regression gates cover schema validation, disk restart recovery, client-policy separation, forged approval, signature tampering, expiry, replay, plan/revision/operation binding, opaque artifact reading, task resume, and duplicate-mutation prevention. Live queue validation is intentionally not part of the default test command.

## Design parameter changes

`modify_design_parameters` builds a versioned DesignIntentGraph from reviewed recipe, feature mapping, PartGraph, and persistent entity bindings. It computes an affected dependency subgraph and emits a safe-DSL rebuild proposal, but never executes it. The proposal must start a separate `reviewed_existing_model_edit` task and pass trusted approval.

`reconcile_design_intent` compares saved entity fingerprints with a current ModelGraph. Reviewed parameter rebuilds and unexpected manual edits are classified separately. Either class requires review before the stored baseline changes; unexpected divergence blocks later parameter changes and is never silently overwritten.
