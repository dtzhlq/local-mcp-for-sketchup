# Current-source and Capture-bound Test Layers

The architecture branch separates implementation regressions from immutable live-evidence freshness.

## Current-source core

Run:

```bash
npm run test:current-source-core
```

This layer executes the current Agent Contract, approval, task-store, Existing Model Editing, ModelGraph, DesignIntent, visual correction, response projection, compatibility, MCP/HTTP, queue-safety, and registry contracts in mock/offline mode. The runner forces queue mutation and direct expert queue mutation off. It does not open SketchUp, issue a live queue request, or claim live/release acceptance.

The rc.3 integration baseline contains 39 checks. A failure means the current implementation or its offline contract regressed.

## Capture-bound evidence

Run:

```bash
npm run test:capture-bound-evidence
```

This layer runs strict validators for frozen mock checkpoints, immutable live captures, and independent-process evidence. It keeps source hashes, artifact hashes, model/revision bindings, schemas, and negative cases intact. If current files no longer match a captured source hash, the layer fails and reports the evidence as stale. That failure must be resolved by collecting a new explicitly scoped successor; old evidence must not be rewritten to look current.

A failure in this layer does not by itself mean the current offline implementation is broken. It means at least one captured proof is stale, incomplete, corrupted, or no longer source-bound.

Both layers run sequentially and set `queue_allowed=false`. `npm run test:layers:list` prints the exact commands without executing them. Live queue validation remains a separate, explicit, operator-coordinated action with `--runtime queue --queue-required`.

The legacy aggregate `npm test` remains unchanged as a broad historical gate. It may stop at the first immutable evidence source-hash mismatch; use the two explicit layers above to distinguish current-code behavior from capture freshness without weakening either boundary.

## Formal offline release gate

Run:

```bash
npm run release:offline-gates -- --output output/release-readiness/<new-report>.json
```

This sequential gate runs 18 release-relevant checks, including the full current-source core, the immutable current-version Copy Fast live-evidence validator, plugin/tool registry checks, mock capability and performance QA, restricted Python corpus, high-value expression and nested-edit checks, the full image-structured regression, plugin-install safety, create-new manifest safety, the historical RC drift guard, and `git diff --check`.

The runner forcibly disables queue mutation, direct expert queue mutation, S1 auto-approval, legacy trusted-copy approval, and Copy Fast mode. Its create-new report is validated against `schema/release-offline-gate-report-v1.schema.json` before writing. The pre-version rc.2-source checkpoint passed 18 / 18. After installing the rc.3 v2 live capture as the current validator, the full gate was rerun and passed 18 / 18; the public report is `docs/evidence/release-offline-gates-0.1.0-rc.3-2026-07-24.json`, with the exact raw create-new bytes retained at `output/release-readiness/2026-07-24-rc3-final-offline-gates-v2.json`, SHA-256 `2f087378f7505fb797da7585e1d5c9a6adad0db7a7431fbae8d6e737e8f9dba4`. The report records `offline_acceptance=true`, while `live_queue_acceptance` and `release_acceptance` remain false because this layer never substitutes for live proof. The separate Copy Fast v2 live evidence and this report are both bound in the rc.3 release manifest.
