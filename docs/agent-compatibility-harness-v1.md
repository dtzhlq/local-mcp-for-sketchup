# Agent Compatibility Harness v1

The harness is capability-based rather than brand-based. It exercises the same Agent Gateway through three trusted server-side profiles; an Agent-supplied `client_capabilities` value is overwritten and cannot elevate execution policy.

| Level | Context budget | Local files | Vision | Parallel calls | In-flight limit | Result transport |
| --- | ---: | --- | --- | --- | ---: | --- |
| L0 | 4,096 characters | no | no | no | 1 | lossless canonical JSON text |
| L1 | 16,384 characters | no | no | no | 1 | structured value |
| L2 | 65,536 characters | yes | yes | yes | 4 | structured value |

All three profiles are restricted to `start_agent_task`, `resume_agent_task`, `submit_agent_task_input`, and `read_agent_artifact`. The simulator enforces that tool surface, response context budget, local-path/raw-image restrictions, in-flight limit, and declared result transport. Oversized responses are projected to server artifact handles. L0/L1 cannot use local paths or raw image payloads, and the image scenario resolves immutable server image handles without requiring Agent vision. L2 exercises parallel read-only resume calls. Every successful L0 Agent result, including every artifact page, now crosses a canonical JSON-text serialization and parse boundary before the scenario can consume it. Undefined object fields are removed explicitly by the server projection; sparse arrays, undefined array values, non-finite numbers, BigInt/functions/symbols, non-plain objects, cycles, over-budget text, or a non-lossless hash round trip fail closed with a `structured_output` capability violation.

The production Gateway enforces the corresponding lowest-common-denominator response policy independently of this simulator. Its default trusted caller ceiling is guided/short/no-files/no-vision and same-task serial; public `interface_level` or `client_capabilities` claims cannot upgrade it. Production responses remain stable JSON even when the caller declares `structured_output=false`, spill complete sanitized results to deterministic opaque artifacts, and reapply path/vision policy during artifact reads. The simulator now verifies that those projected values survive the weakest L0 text transport without relying on JavaScript object identity or silent `JSON.stringify` coercion. The simulator's L2 `max_in_flight=4` models a capable client scheduling independent work; production deliberately keeps each individual `task_id` at one in-flight resume/submit request.

The scenarios consume that production projection contract instead of assuming every field remains inline. When a response exposes `presentation.full_result_artifact` or `data.full_result_artifact`, the simulated Agent calls `read_agent_artifact` with the owning `task_id`, follows the returned `next_action` one page at a time, and parses the full projection only after EOF. Every page is an ordinary Agent tool call and must fit the level's context budget; the runner never reads the task store, artifact filesystem path, or another private server interface. It also checks that pages do not recursively spill, EOF state is consistent, the opaque handle is task-bound, and recovered content contains neither server-local paths nor inline image bytes. Because the harness uses the default trusted production ceiling, an L2 capability claim still cannot widen the server response policy.

The runner executes seven named scenarios for every level:

1. `invalid_arguments`: wrong enums and unknown fields fail schema validation; self-reported capabilities and execution policy cannot elevate the trusted profile.
2. `create_idempotent_retry`: a response is lost after dispatch, then the same idempotency key replays the durable result without creating a second object.
3. `understand_resume`: volatile Agent state is lost, the mock server is reconstructed from disk, and the task resumes by `task_id` within the context budget.
4. `ambiguous_edit`: two equal targets require clarification; acknowledging a warning does not select or mutate a target.
5. `make_unique`: a deep shared occurrence is proposed, approved by a test-only trusted-host callback, and changed without modifying its sibling.
6. `image_summary`: private server registration produces immutable image handles; a no-vision/no-file Agent receives structured evidence and a review-gated, non-executable visual patch.
7. `stale_recovery_and_approval`: forged approval fails, stale revision recovery stays on the same task, and a lost approved response replays without duplicate modification.

The command below is deterministic, mock-only, schema-validates its own report, and never calls the live queue:

```sh
node scripts/run-agent-compatibility-harness.mjs
```

The current checked evidence records 21/21 completed level-scenarios, 536 Agent Gateway calls, 57 fixture calls, 9 test-only trusted-host approval calls, 9/9 expected schema rejections, 6/6 blocked invalid retries, 3/3 target top-k hits, and 12/12 successful recoveries. The total includes 468 `read_agent_artifact` page calls (156 at each capability level) needed to recover complete production projections under the default 4,096-character trusted ceiling; the harness derives this count directly from public tool dispatch rather than maintaining a parallel handwritten total. L0 completed 173 canonical JSON-text round trips across all seven scenarios with zero loss/failure. Context, path, raw-image, concurrency, and text-transport violations are all zero. The Gateway audit contains 536 actual dispatch events, while the mutation ledger remains limited to the 24 mutation-relevant events/model diffs. Six unique reviewed-edit receipts are loaded through the HMAC-verifying task receipt ledger. Each ledger row carries its source event hash and model-diff hash; `trusted_approval`, `actual_modified_targets`, and `mutation_applied` are derived rather than supplied by scenario code. Full semantic fingerprints also prove that the unselected shared-component sibling and approval guard remain unchanged. These sources derive the three hard gates: zero wrong-object automatic executions, zero unauthorized S2-S4 executions, and zero duplicate-request duplicate modifications.

The 21-scenario harness remains a deterministic in-process compatibility harness. It does not exercise the separate production Local Approval Host, measure natural-language behavior across model vendors, prove live SketchUp recovery, or prove visual quality. The trusted-host decision fixture writes an approved decision into the same server-private store used by production while the simulated Agent submits no credential; that fixture and direct setup calls are counted separately from Agent Gateway calls. The one-model S2 production-host live evidence is recorded independently.

## Independent-process probes

The independent probe launches a real, ephemeral Codex CLI process in a temporary working directory outside the repository. Each child is placed in a workspace-write sandbox and can reach the service only through `scripts/independent-agent-probe-tool.mjs`. That adapter allowlists the four Agent Gateway tools, overwrites every task start with the trusted L0 profile, permits only `runtime=mock`, disables queue/direct-expert mutation, and records a server-side hash-chained audit. The Agent receives no model-file path, approval token, session secret, or trusted decision callback.

Three create-new runs now cover three fixture families and two workflow families:

1. Two equal cabinet groups test ordinary object ambiguity.
2. Two named instances of one shared `Survey_Pod_Definition`, with nested housing/lens geometry, test shared-component ambiguity.
3. An opaque reference/capture image pair tests whether a no-vision, no-local-files Agent can consume a server-computed visual correction summary without receiving image bytes.

The first two independent processes made exactly four sequential Gateway calls:

1. Started `understand_model` and completed it.
2. Repeated the byte-identical request and received the same `task_id` with `idempotent_replay=true`.
3. Resumed that completed task by `task_id`.
4. Proposed the fixture-specific ambiguous rename and stopped at `awaiting_input` with `execution_allowed=false`.

The third process made exactly two calls. `start_agent_task(reference_image_correction)` returned a compact structured summary inline with alignment, difference, confidence, blockers, a non-executable S2 correction patch, and an opaque overlay handle. One `read_agent_artifact` call returned only immutable image metadata with `encoding=omitted`, `content_omitted_for_capability=true`, and no `content` field. The task remained `awaiting_review`; it did not submit approval or execute a correction.

The deterministic 21-scenario harness continues to test generic full-result EOF paging. The real v3 process instead exercises the specialized compact L0 visual projection, so a weak Agent can complete the summary path in two calls while the full sanitized result remains available behind an opaque artifact handle.

All three fixture revisions were identical before and after. Each server audit, CLI event stream, and schema-constrained final response agree; unexpected commands, exposed approval material, image-content exposure, and all three mutation hard-gate counts are zero. The aggregate is three fixture families, two workflow families, three independent processes, and ten Gateway events. Strict immutable evidence is stored in `docs/evidence/independent-agent-compatibility-evidence-2026-07-23.json`, `docs/evidence/independent-agent-compatibility-evidence-v2-2026-07-23.json`, and `docs/evidence/independent-agent-compatibility-evidence-v3-2026-07-23.json`; raw transcripts remain local hash-bound artifacts under `output/agent-compatibility/`.

Run the deterministic adapter contract test with:

```sh
npm run test:independent-agent-compatibility-probe
```

Run a new real CLI process in a create-new output/evidence location with:

```sh
node scripts/run-independent-agent-compatibility-probe.mjs \
  --output-dir output/agent-compatibility/<new-run> \
  --evidence-out docs/evidence/<new-evidence>.json
```

Run the shared-component fixture with the same create-new rule:

```sh
node scripts/run-independent-agent-compatibility-probe.mjs \
  --fixture shared_sensor_instances \
  --output-dir output/agent-compatibility/<new-shared-run> \
  --evidence-out docs/evidence/<new-shared-evidence>.json
```

Run the no-vision image-summary fixture with the same create-new rule:

```sh
node scripts/run-independent-agent-compatibility-probe.mjs \
  --fixture image_summary_no_vision \
  --output-dir output/agent-compatibility/<new-image-summary-run> \
  --evidence-out docs/evidence/<new-image-summary-evidence>.json
```

This proves independent-process execution across three fixture families and two workflows, including server-side image-summary transport for a no-vision Agent. It is not an ecosystem or visual-quality benchmark. Only one Agent implementation was available locally, the selected model was not independently pinned/attested, and all runs were mock-only, non-mutating, and did not exercise production human approval. Accordingly `fixture_diversification_proven=true` and `workflow_diversification_proven=true`, while `vendor_diversification_proven=false`, `model_diversification_proven=false`, and `release_acceptance=false`.
