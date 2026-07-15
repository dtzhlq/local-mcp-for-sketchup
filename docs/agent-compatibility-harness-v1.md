# Agent Compatibility Harness v1

The harness is capability-based rather than brand-based:

- L0: short context, no files, no vision, no structured output, one tool at a time.
- L1: structured output and retained task id, without files, vision, or parallel calls.
- L2: long context with files, vision, structured output, and parallel capability.

Each level runs create/idempotent replay, understand/resume after state loss, ambiguous edit and ignored warning, shared-definition make_unique proposal, server-side image summary, stale-plan recovery, forged approval rejection, trusted human approval, and duplicate submit replay.

The hard release gates are zero wrong-object automatic executions, zero unauthorized S2-S4 executions, and zero duplicate mutations. `scripts/run-agent-compatibility-harness.mjs` emits a schema-validated report. Its default runtime is mock and it never calls live queue.
