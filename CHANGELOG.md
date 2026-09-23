# Changelog

## 0.4.0 — release candidate

- Adds a source-bound Yingzao Fashi five-bay, ten-rafter hipped hall with surrounding gallery through the existing task Gateway; explicit chi scale, frozen rules and single-root parameter updates. See [rules](docs/traditional-timber/RULES.md) and [usage](docs/traditional-timber/USAGE.md).
- Adds compact native assembly summaries, dependency-based definition reuse, atomic queue publication and committed-operation recovery without mutation replay.
- Retains 48 public tools and the original research preset identity. Apple Silicon macOS / SketchUp 2026 is the release target. Native whole-hall edit acceptance and public publication remain pending; no save/reopen acceptance is required.

## 0.3.0 — 2026-09-19

Based on `v0.2.0` (`1d27e9c8`), developed on `codex/modeling-api-uplift` and continued on `codex/cad-surface-kernel`. The signed release and native acceptance are bounded to the documented Apple Silicon / SketchUp 2026 scenarios. Windows 0.3.0 native acceptance is not claimed.

### Added

- Four public tools: `query_model_geometry`, `measure_model_geometry`, `edit_model_geometry`, `run_model_program` (44 → 48).
- Revision-bound real topology, frozen snapshot paging, native measurement, atomic local/root edits, shared-instance isolation and up to three program stages with fresh native readback.
- General single-ring `sweep_profile` and `loft_profiles_v2`, including 3D paths, scale/twist, unequal profile sampling and concave caps.
- Data-only OpenCascade WASM recipes through `cad_shape`: rational NURBS patches, surface sewing, closed solids, booleans and selected constant-radius curved-edge fillets.
- `replace_cad` parameter regeneration, persistent source association, native CAD face provenance and stale-source protection. Python SDK exposes `model.cad_shape`.
- Shared tool registry, aligned public input/output contracts and protocol routing; usage examples and machine-readable acceptance reports.

### Fixed

- CI dependency audit: upgrade `fast-uri` override to 3.1.8 and `sharp` to 0.35.4 (libvips platform packages 1.3.3), synchronized across source and service-bundle locks.
- Correct the existing-model preparation output schema to validate its plan/approval wrapper; retain nested plan validation and approval gates. Restore platform plugin path resolution and align draft manifest/legacy checks with the current 0.3.0 contracts and 48-tool registry.

- Python facade rotation centers, axes, inversion and transform representation; full matrices and correct point/vector/normal handling.
- Nested group-ending instance path resolution and actual-result entity mapping.
- Unrelated unchanged pre-existing warnings blocking new creation and later program stages. New issues and incomplete evidence still block; approval rules are unchanged.
- Missing bounded read-only `String.indexOf` in the program interpreter, exposed during GLM testing.
- False CAD source invalidation after saving/reopening due to face-normal floating-point drift. Versioned fingerprints normalize normals; actual geometry changes still invalidate the source.

### Validation

Focused offline checks and combined native scenes cover generation, editing, readback, isolation, rollback, stale references and persistence. CAD full-application restart/reopen passed on 2026-09-19. Candidate archives were compared against 142 service modules and 32 Ruby files; the bundled Node loaded the CAD WASM kernel. Previously passing unrelated checks were reused.

GLM's staged example required one model correction and an interpreter fix, then resumed with its remaining stages; creation was not replayed. The proxy's exact served model version was not independently verified. This is not an autonomous benchmark or a general success-rate claim.

### Known limits

NURBS support is rectangular, clamped and nonperiodic. SketchUp geometry is tessellated; recipes remain available for parameter edits. No arbitrary old-mesh reconstruction, STEP import/export, variable-radius fillets or guarantee for all corner/radius combinations. A four-edge NURBS roof fillet fails validity and is rejected. Windows and cross-model CAD tests were not run. Public release/signing and redistribution qualification remain separate.

Evidence: [modeling](docs/modeling-uplift/implementation-status.md), [GLM diagnosis](docs/modeling-uplift/qa-resolution-report.json), [CAD](docs/cad-surface-kernel/acceptance-report.json).

## 0.2.0 — historical release

Reviewed single-image reconstruction for Apple Silicon Mac and SketchUp 2026, with 44 tools and signed-plugin acceptance. See the [historical release record](docs/RELEASE_ACCEPTANCE.md).
