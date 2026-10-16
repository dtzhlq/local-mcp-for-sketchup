# 0.4.2 release acceptance

The stable target is Apple Silicon macOS with SketchUp 2026. Product `0.4.2`, runtime capability `0.4.2-workflows.1`, 48 tools and bundled Node `24.18.0` must be bound to the final [release manifest](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/download/v0.4.2/agent-install.v1.json). Validation policy: `workflow-v042-minimal.v1`.

## Verified development evidence — 2026-10-15

The [native development record](modeling-uplift/native-validation-2026-10-15.md) covers an installed candidate on Apple Silicon Mac / SketchUp `26.2.242`. It predates the final 0.4.2 packages and does not itself promote their release status.

- Six native layout cases passed: component array/alignment, alignment followed by a mirror copy, array-copy mirroring, group array and group alignment. Repeated submissions did not mutate again; pre-existing roots and the shared peer were preserved.
- Three scoped edits passed: insert a 1600 mm bay, change it to 1700 mm, then remove it and restore the original two-bay structure. World placement and the unchanged shared instance were preserved. Ten unrelated roots stayed unchanged.
- Creation and each edit were independently verified against each root's current source. Four rounds measured six selected column/beam, beam/purlin and purlin/rafter surface gaps each, within the specified 1 mm tolerance. The original creation specification was preserved.
- The installed development service verified 339 runtime files, 48 tools and five discovery entrypoints using bundled Node `24.18.0`; 32 plugin files matched their installation input. Final offline regression passed 56/56 groups.
- Native save succeeded and the installed service read back the same path with `model_modified=false`; the saved revision matched the accepted final captures. No cold-reopen test was performed.

The native session exposed and fixed false mirror rejection of SketchUp's empty `SU_InstanceSet` attributes and missing parameter-review budget inheritance. Actual replacement-root overflow or incomplete recursive readback is rejected before geometry staging. Timing is diagnostic evidence only; no performance improvement benchmark is claimed.

## Final package evidence — 2026-10-16

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| macOS service | 71,241,857 | `1d8af4bbc52a06861e3b09deb36800f4b1c266f72789742517ec963d2a789daa` |
| Officially signed RBZ | 152,641 | `ec92f09d276982ad6ece67f461081ca320b6e7934b6cafc23581782791bda810` |

The official signing portal preserved all 33 source files and added its signature. The final RBZ is unencrypted; all 34 installed archive files match. Extension Manager recognizes version 0.4.2 as signed and enabled, and the bridge loaded after a full SketchUp `26.2.242` restart. The observed extension-loading policy is recorded as `not_recorded`; strict identified-extension-only startup is not established.

The extracted macOS service passed its independent installed-bundle check using Node `24.18.0`. Its 339 runtime files match the frozen release working tree, with fingerprint `2d1565cf3958a8b367fe8440dba19870e5984f825dfa6601baf9d845ee30fb24`. Checks cover 48-tool MCP discovery, real read-only/mock calls, five discovery topics, four workflow templates, sharp image processing and a CAD smoke test. Publication rechecks these runtime bytes against the final clean source commit and binds that commit in the manifest.

With this final service/plugin pair, all six native layout cases passed. Bay insertion, dimension change and removal completed; their replay, shared-peer, world-placement and ten-background-root protections passed. Creation and the three edit stages each produced six passing native surface-gap samples: **24/24 within 1 mm tolerance**. The original creation evidence was preserved.

The first post-removal verification correctly returned unverified because the assembly summary and geometry snapshot carried different model GUIDs. Read-only re-verification of the same task then passed all six samples with quality accepted. No geometry edit was replayed; the full model revision, recursive index, top-level entities, original captures, frozen specification and original structure report stayed unchanged. Both the first rejection and successful recovery remain in local evidence.

The final overview and post-removal detail were visually reviewed: both corridor assemblies and the layout fixtures are present. Final captures are server-verified, with camera, display, native state and the complete model revision restored. The dedicated model saved successfully (1,324,661 bytes); readback returned `model_modified=false`, with the full revision, recursive index and all roots unchanged. No close/reopen operation was performed.

## Publication gates and immutable evidence

The final saved-model readback and accepted views above bind to this exact service/plugin pair. Stable publication additionally requires the following independently bound evidence:

- `SOURCE_COMMIT.txt` and `SOURCE_SHA256SUMS.txt` identify the clean source commit and allowlisted public tree; every archived source file must match that commit.
- `core-gate.json` identifies a completed successful Core CI run for that exact commit, including the offline/mock behavioral regression. A result from an earlier commit is insufficient.
- `acceptance-darwin-arm64.json` binds the signed RBZ, macOS archive, runtime fingerprint and minimal native acceptance. `agent-install.v1.json` is promoted to release only after those checks and the exact-commit CI pass.
- The separate Windows preview binds its own archive and `windows-installed-check.json` through `windows-install.v1.json`; Windows CI is not native SketchUp acceptance.
- `SHA256SUMS.txt` covers every uploaded attachment except itself. Mirrors must reproduce those bytes, and their download verification is recorded separately after publication.

Official signature recognition is established for the hashes above. Published manifests promote only the exact verified bytes, while build-time candidate flags inside an archive remain unchanged.

## Scope and limits

- The matching [Windows x64 installation preview](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.4.2-windows-preview.1) requires its own exact-bundle Windows CI report. Native Windows SketchUp loading, queue modeling and save/close/reopen remain unverified; `release_acceptance=false` there.
- Cold-reopen and network-denied acceptance are excluded by this minimal release policy. The user's deferred cold-reopen work is not part of this release. A restart needed to load the new plugin does not establish model reopen acceptance.
- Extension Manager signature recognition and restart loading passed. The loading-policy value was not recorded, so strict identified-extension-only startup remains unverified.
- Sampled native joint surface distances do not establish absence of penetration, complete collision checking, hidden joinery certification or structural capacity. [Assembly restrictions](traditional-timber/ASSEMBLY.md) still apply.
- Root array/alignment and mirror-copy support retain the [documented target and override restrictions](modeling-uplift/usage.md); bounding-box alignment does not prove solid contact. Interrupted parameter tasks prepared by older builds may safely return an idempotency conflict; do not replay them with a new key.

Historical [0.4.1 acceptance](RELEASE_ACCEPTANCE_0.4.1.md) and [0.3.0 acceptance](RELEASE_ACCEPTANCE_0.3.0.md) apply only to their original artifacts. Development models, raw task state, private machine configuration and test screenshots remain local; they are not release attachments.
