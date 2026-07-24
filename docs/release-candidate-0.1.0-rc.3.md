# Release Candidate 0.1.0-rc.3

Status: `rc_candidate_verified`

Signed at: 2026-07-24

This is a scoped technical-preview release candidate. It is not a claim of complete SketchUp API compatibility, arbitrary Python execution, general photo-to-model automation, cross-version validation, or general availability.

## Contract

- Product: `0.1.0-rc.3`
- Runtime capability: `0.1.0-rc.3-capabilities.1`
- Capability manifest: `2026-07-agent-contract-rc3.1`
- MCP tools: 41 total, including 36 expert tools
- Safe JSON DSL: 101 registered operations
- Component-definition scope: 57 operations
- Packaged source commit: `bd8048fc789dea5d3d55b091a6d1e8712908c970`
- Branch: `codex/agent-contract-v1`

Tool and operation counts are separate contracts and do not represent the complete SketchUp API.

## Live gate

The exact disposable model `Fire Escape.disposable.skp` was opened after a complete SketchUp restart with the 22-file rc.3 plugin installation. `copy-fast-session-live.v2` then completed one S4 edit in memory:

- zero per-task approval challenges;
- one mutation submit with a finalized durable receipt;
- idempotent replay with no duplicate mutation;
- exact target and empty-parent postconditions;
- model revision transition;
- original SKP bytes unchanged because `save_model=false`;
- queue, processing, responses, and lock all clean before and after.

Public evidence:

- File: `docs/evidence/copy-fast-session-v2-live-evidence-2026-07-24.json`
- SHA-256: `1357a42face31640096cdadcc462d736f8c4825a626e8cae41115e4de51b56e2`
- SketchUp: `26.2.242`
- Source/contract bindings verified: 13

This live evidence is intentionally scoped to one exact disposable copy. It does not prove broad destructive-edit reliability, save/reopen behavior, visual quality, multi-Agent compatibility, or another SketchUp version.

## Offline gate

The final rc.3 offline runner passed 18 / 18 checks with queue mutation forcibly disabled. It includes:

- current-source core 39 / 39;
- the strict Copy Fast v2 evidence validator;
- 41-tool and plugin registry checks;
- mock QA and performance budgets;
- restricted Python corpus: 29 compiled canonical cases and 6 classified unsupported cases;
- MCP capability suite in explicit mock mode;
- image-structured regression;
- 96 plugin installation-safety assertions;
- create-new release manifest safety;
- historical rc.2 drift protection;
- `git diff --check`.

Report:

- Public file: `docs/evidence/release-offline-gates-0.1.0-rc.3-2026-07-24.json`
- Raw create-new file: `output/release-readiness/2026-07-24-rc3-final-offline-gates-v2.json`
- SHA-256: `2f087378f7505fb797da7585e1d5c9a6adad0db7a7431fbae8d6e737e8f9dba4`
- `offline_acceptance=true`
- `queue_allowed=false`

The first rc.3 run produced a create-new 17 / 18 failure report because one install-safety test still used a hard-coded rc.2 package version. The production error code was correct; the test fixture was changed to consume the authoritative product version, passed 96 assertions, and the full 18-check gate was rerun under a new output path. The failed report remains unchanged.

## Artifacts

- `out/releases/alma-sketchup-mcp-0.1.0-rc.3.rbz`
  - Size: 91,519 bytes
  - SHA-256: `b5b4dcc40a8073a1e79d95e3e110aa151361ddf315d454072b612b4f8547b8f2`
- `out/releases/alma-sketchup-mcp-0.1.0-rc.3.sha256`
  - SHA-256: `5b9b064523ca720d6a270492390dc728c6d6b6be0a729fecf57827697d448289`
- `out/releases/release-manifest-0.1.0-rc.3.json`
  - SHA-256: `2bd770733cbd034caac23455d8542bf211daea8cd65f580ef653603551282759`
  - `release_status=rc_candidate_verified`
  - `rc_signed=true`
  - `overwrite_performed=false`

The checksum sidecar validates successfully with:

```bash
cd out/releases
shasum -a 256 -c alma-sketchup-mcp-0.1.0-rc.3.sha256
```

The rc.2 RBZ/checksum/manifest remain immutable historical artifacts. No existing release artifact was overwritten or deleted.

## Signoff boundary

The rc.3 technical-preview candidate gate is complete. Remaining items are distribution/installation operations or later product work, including broader P2 observation/reconciliation coverage, independently comparable external-reference cameras, multiple real Agent vendors/models, production approval benchmarks, and the user-deferred cross-version matrix.
