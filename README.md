# Local MCP for SketchUp

**0.3.0 development candidate — 48 MCP tools.** Native verification covers Apple Silicon Mac and SketchUp 2026. This branch adds general modeling and CAD surface capabilities on the fixed `v0.2.0` baseline; it is not a new signed release.

An independent local MCP server for generating and editing SketchUp models through reviewed operations. Deterministic geometry, native measurement and execution recovery live in the MCP service and are available to any compatible model/client.

[Changes](CHANGELOG.md) · [48 tools](docs/tool-registry.md) · [Modeling guide](docs/modeling-uplift/usage.md) · [NURBS and curved-edge fillets](docs/cad-surface-kernel/README.md) · [Candidate setup](docs/DEVELOPMENT_CANDIDATE.md)

## What's new

| Capability | What it enables |
|---|---|
| `query_model_geometry` | Real vertices, edges, face loops, transforms and nested instance paths; revision-bound snapshots with bounded paging. |
| `measure_model_geometry` | Native lengths, areas, eligible solid volumes and supported geometric relations, with explicit unavailable results. |
| `edit_model_geometry` | Atomic local edits, root geometry editing, shared-instance isolation and native readback. |
| `run_model_program` | Up to three read–compute–review–execute–readback stages using real intermediate geometry. |
| `sweep_profile` / `loft_profiles_v2` | Non-circular profiles along 3D paths, scale/twist, unequal-point-count lofts and concave caps. |
| `cad_shape` / `replace_cad` | Rational NURBS patches, sewn solids, CAD booleans and selected curved-edge fillets; retained parameters for later regeneration. |

Sweep, loft and CAD operations use the existing creation, editing and program entry points; they do not add more top-level tools. Full transforms, public tool contracts and protocol adapters share the same business handlers. Session contracts, review policy, revision checks, atomic transactions and idempotent receipts remain in force. Unknown execution outcomes are resolved through the original request, not blind mutation replay.

## Verified behavior and limits

The modeling candidate was checked in a combined native SKP: sweep/loft creation, rotated nested-instance edits, staged face splitting and push/pull, rollback, stale references, root edits and save/close/reopen. See the [modeling evidence](docs/modeling-uplift/implementation-status.md).

CAD verification covered rational curves with an analytic radius, parameter changes, intersecting-cylinder curved-edge fillets and a six-patch NURBS solid. A full SketchUp restart and disk reopen passed on 2026-09-19, preserving parameter association and geometry counts. Deliberately modified geometry remained correctly marked stale. See the [CAD acceptance report](docs/cad-surface-kernel/acceptance-report.json).

SketchUp receives editable tessellated faces with retained CAD recipes, not native NURBS entities. Support is bounded to rectangular clamped nonperiodic patches and supported constant-radius fillets. Arbitrary historical mesh reconstruction, trimmed/periodic patches, variable-radius fillets and every complex corner are not supported. An invalid four-edge corner example is retained as a rejected case.

A GLM investigation identified an MCP creation-QA scope issue and missing read-only `String.indexOf` support; both were fixed. Its remaining stages then executed successfully after one model correction, without replaying creation. This is a bounded compatibility result, not a universal model-quality benchmark. Windows and cross-model CAD verification are not claimed.

## Install and documentation

- Development source and local candidate setup: [candidate instructions](docs/DEVELOPMENT_CANDIDATE.md).
- NURBS/fillet recipes and limits: [CAD guide](docs/cad-surface-kernel/README.md), [examples](examples/cad-kernel).
- Four modeling tools and reusable programs: [usage](docs/modeling-uplift/usage.md), [tool validation](docs/modeling-uplift/tool-validation.md).
- Single-image reconstruction: [image structure](docs/IMAGE_STRUCTURE.md). These are approximate reconstructions with explicit scale/hidden-geometry assumptions, not single-photo measured replicas.
- Third-party components and local distribution boundaries: [notices](THIRD_PARTY_NOTICES.md).

The historical [signed 0.2.0 release](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0) has 44 tools and separate [installation](docs/INSTALL.md) and [acceptance](docs/RELEASE_ACCEPTANCE.md) records. Its signature and acceptance do not apply to this candidate. Extension Warehouse publication was declined; no listing or official endorsement is claimed. Existing ALMA environment variables and Ruby namespaces remain intentional.
