# Detailed modeling and native appearance delivery — 2026-09-07

Accepted locally in macOS SketchUp 2026 (26.2.242). This is not a Windows or SketchUp 2025 release acceptance.

The implementation adds frozen detail requirements, resumable local repairs, atomic creation scopes, assembly recipes and instance replacement, native geometry checks, component-preserving assets, and native PBR/HDR workflows.

## Validation

- Offline regression: 58/58 passed; source hashes rechecked unchanged before this commit.
- Eight component categories and 25 expected-failure native cases.
- Two final scenes: actual application exit and disk reopen, native geometry and appearance persistence, and visual review passed. Rendered PNG bytes differ; byte-identical rendering is not claimed.
- Final approved entry paving: 166 parts and 36 scene-scope waterway checks passed. Historical failed tasks and frozen specifications remain preserved.
- Native appearance matrix: 1,176 getter checks, seven material families and two HDR environments. Twelve unavailable source-texture cases explicitly unsupported.

## Local deliverables

Large SKP files, source assets and raw captures remain in the ignored local `output/detail-modeling-implementation-2026-09-06/` directory; they are not bundled into Git.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `kitchen-living-v1-delivery-final-v1.skp` | 37081552 | `cf2f46c19673a342d8fa68f72086c1f3a8d5888e65c270ce04342c66e7b8a36e` |
| `entry-court-v1-delivery-final-v2.skp` | 36655089 | `40656eb2272333496927fea72e094fe29b376c8bab75a244a38ccdab21a5edfd` |

See [implementation checklist](detail-modeling-implementation-checklist.md), [workflow](detailed-modeling-workflow.md), [composition API](detail-modeling-composition-api.md), and [appearance presets](native-appearance-presets.md). Local detailed evidence index: `output/detail-modeling-implementation-2026-09-06/交付索引.md`.

## Worktree scope

This commit excludes ongoing image-structured-modeler changes, unrelated package scripts, promotional drafts and local dependency caches. Those files are preserved in the working tree.
