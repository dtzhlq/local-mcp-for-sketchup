# Local Approval Host v1

`Local Approval Host v1` is the production user-presence adapter for Agent Contract reviewed operations that are not already authorized by a server-configured disposable-copy execution policy. It is a separate loopback-only browser service; it is not an MCP tool and is not part of the authenticated general HTTP tool bridge.

## Trust model

- S2-S4 plans remain bound to `task_id`, `plan_id`, `plan_hash`, complete `model_revision`, risk, allowed operations, the canonical review-context hash, nonce, and expiry. The plan hash also covers the private `execution_contract`, including the approved save target and reopen-validation contract. By default they require this host; an explicit trusted-copy policy may instead authorize only exact models under configured copy roots, risks, affected-instance budgets, and save behavior.
- The browser page displays those immutable bindings plus a human-readable review context. Model names, materials, attributes, OCR, instructions, and other displayed text are marked untrusted and are HTML-escaped; they cannot change policy or execution scope.
- The real user initializes a local approval passphrase. It is stored only as a salted scrypt hash in the approval state directory with mode `0600`.
- First-time identity setup additionally requires a high-entropy one-time bootstrap secret generated and shown once in the host terminal, or explicitly configured by a trusted administrator. Merely reaching loopback is not sufficient to initialize the host.
- A browser login is not sufficient to approve. Every approve or reject decision requires the user to re-enter the passphrase and check an explicit acknowledgement.
- The host stores the signed one-time approval token privately. Its durable local decision record is independently HMAC-authenticated over the immutable binding, user decision, review selection, reason, decision time, status, and an opaque token hash. The Agent sees only a decision id/status and never receives the token. `submit_agent_task_input` can therefore continue with a fresh Session Contract but without an `approval_token` field.
- Approve/reject is one decision per challenge. Expiry, replay, conflicting decisions, tampered binding, stale model revision, and operation expansion fail closed.
- Legacy unsigned or corrupted decisions are non-executable. The approval list and detail page remain available, label the record as requiring reauthorization, and let the user create a fresh challenge instead of returning an internal error.

This boundary prevents an ordinary MCP/HTTP Agent from minting or replaying authorization. It does not claim to defeat malicious software with arbitrary process, browser-control, or filesystem access under the same operating-system account. Higher-assurance deployments should isolate the approval host in a separate OS trust domain or add WebAuthn/platform user verification.

## Start and initialize

```bash
npm run approval:serve
```

Default address:

```text
http://127.0.0.1:3978
```

On first startup, the terminal prints a random one-time setup bootstrap secret. Open the page yourself, enter that secret, and create a passphrase of at least 12 characters. The bootstrap secret is held only as an in-memory digest, consumed immediately after successful credential creation, and is not written to task, evidence, log, credential, or approval state. An already initialized host starts without a bootstrap secret for compatibility.

For managed startup, a trusted administrator may set `ALMA_SKETCHUP_APPROVAL_BOOTSTRAP_SECRET` to a 32–256 byte secret before launching the host. The value is never printed; remove it from the process environment after initialization. Do not place either secret in an Agent prompt, CLI argument, repository file, task artifact, or persistent service log.

Configuration:

| Variable | Default | Meaning |
|---|---:|---|
| `ALMA_SKETCHUP_APPROVAL_HOST_BIND` | `127.0.0.1` | Must remain a loopback address; non-loopback binding is rejected. |
| `ALMA_SKETCHUP_APPROVAL_HOST_PORT` | `3978` | Browser service port. |
| `ALMA_SKETCHUP_APPROVAL_HOST_URL` | `http://127.0.0.1:3978` | URL placed in Agent `next_action`. It must use loopback HTTP. |
| `ALMA_SKETCHUP_STATE_DIR` | `~/.sketchup-mcp-replica` | Must match the Agent Gateway process so both use the same private approval/task state. |
| `ALMA_SKETCHUP_APPROVAL_BOOTSTRAP_SECRET` | generated once at uninitialized terminal startup | Optional trusted-admin override for first-time setup only; 32–256 bytes, never returned or persisted by the host. |

## Browser security boundary

The service enforces:

- loopback bind and loopback peer checks;
- one-time bootstrap authorization for first-time identity setup, independent of loopback reachability;
- exact `Host` validation to resist DNS rebinding;
- exact same-origin POST validation and Fetch Metadata enforcement; controlled or privacy-isolated browsers that serialize a same-origin POST as `Origin: null` are accepted only when `Sec-Fetch-Site` is exactly `same-origin`, while missing origins and every cross-site request still fail closed;
- per-session CSRF tokens;
- `HttpOnly; SameSite=Strict` short-lived cookies;
- per-decision passphrase reauthentication and failed-auth throttling;
- request-body limits and no secret request logging;
- CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, no JavaScript, no third-party assets, no referrer, and denied device permissions;
- HTML escaping for all untrusted model/task content;
- no token, signing secret, filesystem path, stack trace, or internal error details in browser responses.

## Reviewed live edit workflow

This workflow applies when `next_action.action=request_user_approval`. If a trusted server/user policy has already authorized the exact disposable-copy plan, the task instead returns `approval_status=server_policy_scoped_auto_approved`; the Agent still needs a fresh Session Contract and idempotency key, but no approval-page decision or token is created. Agent-provided capabilities, model text, `review.status`, or a reviewer string cannot select that mode.

1. Start an Agent Gateway `reviewed_existing_model_edit` task. Preparing the task is read-only.
2. The result enters `awaiting_review` and returns `next_action.approval_host.url`.
3. The real user opens that page, checks the target/risk/operations, re-enters the approval passphrase, and approves or rejects.
4. `resume_agent_task` reports `approval_status=approved_pending_execution` without exposing a token.
5. Before any queue handshake or preflight, the trusted workflow calls the server-side task-authorization readiness check. It reloads the private reviewed plan, requires the current plan version, recomputes the plan and review-context hashes, compares the public task/challenge bindings, and verifies the signed local decision plus expiry. The result is a redacted readiness envelope; it never contains an approval token.
6. Only after that check succeeds does the Agent create a fresh queue Session Contract and call `submit_agent_task_input` with an idempotency key and `session_contract`. The server privately reloads and consumes the stored approval.
7. Revision, identity, Session Contract, operation scope, private execution contract, and approval are rechecked before mutation. The one-time decision is marked consumed after the server privately consumes its authorization.

For the controlled S2 live proof:

```bash
npm run approval:live:prepare
npm run approval:live:status
npm run approval:live:apply
```

`prepare` performs only current-source queue handshake/adoption and creates a reviewed `rename` challenge for one unlocked, single-instance top-level test component. It does not mutate. `apply` refuses to run until the local decision is approved, creates a fresh Session Contract, executes through the reviewed Existing Model Editing Engine, saves the test artifact, and requires the queue to be clean before and after. Versioned keep-session persistence uses [`Sketchup::Model#save_copy`](https://ruby.sketchup.com/Sketchup/Model.html#save_copy-instance_method), so the evidence artifact does not rebind the active SketchUp document as Save As would.

Never automate the real approval click or copy the approval passphrase into the Agent channel. Browser automation is used only against isolated test state to verify rendering and controls.

The isolated browser contract is recorded in [`evidence/local-approval-host-v1-mock-evidence.json`](evidence/local-approval-host-v1-mock-evidence.json). It proves the local UI/security adapter only: it explicitly does not claim real-user approval, a live queue call, a SketchUp mutation, reference-image coverage, or release acceptance.

The separately coordinated current-source live record is [`evidence/local-approval-live-evidence-2026-07-16.json`](evidence/local-approval-live-evidence-2026-07-16.json). It retains both the first fail-closed Save As identity-drift discovery and the repaired S2 success: real-user approval, private token consumption, same persistent target, zero geometry/bbox delta, `save_mode=copy`, finalized durable receipt, capture artifact, and clean queues. It is deliberately constrained to one model and one S2 rename; `release_acceptance=false`.

The independent disposable-copy policy contract and its one-model S4 live proof are recorded in [`evidence/trusted-model-copy-auto-approval-v1-mock-evidence.json`](evidence/trusted-model-copy-auto-approval-v1-mock-evidence.json) and [`evidence/controlled-s4-delete-live-evidence-2026-07-22.json`](evidence/controlled-s4-delete-live-evidence-2026-07-22.json). They do not weaken this host's default boundary for models outside configured roots.
