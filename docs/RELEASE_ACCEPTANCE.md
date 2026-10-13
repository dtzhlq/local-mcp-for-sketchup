# 0.4.1 release acceptance

The stable target is Apple Silicon macOS with SketchUp 2026. Product `0.4.1`, runtime capability `0.4.1-assembly.1`, 48 tools and bundled Node `24.18.0` are bound by the [release manifest](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/download/v0.4.1/agent-install.v1.json). Validation policy: `assembly-v041-minimal.v1`.

## Package and verification summary — 2026-10-13

| Artifact | SHA-256 |
| --- | --- |
| macOS service (71,219,859 bytes) | `3ac4bfb3b11b0f1da9577ef593cbd2be3bff24e10d286f339f1f04af345a9555` |
| Signed RBZ (152,481 bytes) | `72701e979df1a65231254660ff4cd5dc972885f51db064feebd4e0e6eeb93978` |

The official signing portal retained all 33 source files unchanged and added only its signature. Extension Manager recognized version 0.4.1 as signed and enabled after a full restart. The extracted service verified 334 runtime files, MCP discovery and an actual tool call using its bundled Node. Its runtime source fingerprint is `60c91f58c4f8fd496d39899cb17e2152fc8f949ac25e2620d9b322f3c5b4ea63`.

The 40-step offline/mock core gate, 22 Ruby capture tests (251 assertions), installed-bundle checks and zero-vulnerability dependency audit passed. sharp is pinned to `0.35.5`. Windows directory-sync handling preserves fatal errors for actual file writes.

Native SketchUp `26.2.242` verification covers creation of two shared corridors, a selected 1500-to-1800 mm bay edit, unchanged shared 1500 mm geometry, isolation of all other root objects, and a post-edit view with camera/display/revision restoration. The loaded signed plugin also rejected an unsettled camera-facing fixture before any capture or model write.

Earlier bounded native checks cover straight corridors, a square pavilion and an eight-root courtyard: selected-root edits, actual opening and junction measurements, accepted views and SKP saves. Unsupported composition checks are offline. Development histories, temporary models, raw logs, task records and test screenshots remain local; they are not release attachments.

## Scope and limits

- [Windows x64](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.4.1-windows-preview.1) is an installation preview. Its exact archive is checked on Windows with bundled Node, source fingerprints, the tool registry and image/CAD/timber/assembly fixtures. Native Windows SketchUp loading, queue modeling and save/close/reopen remain unverified; `release_acceptance=false` there.
- The existing macOS loading policy was **Unrestricted** and was preserved. Signature recognition and restart loading passed; strict identified-extension-only startup was not tested. This is an explicit exception to the preferred signing checklist.
- This minimal policy adds no cold-reopen or network-denied acceptance. Saved-scene continuation has fixture coverage and native source discovery; native cold-reopen parameter editing remains unverified.
- [Supported families and limits](traditional-timber/ASSEMBLY.md) exclude arbitrary multi-storey roofs, complex corridor networks, historically certified construction, concealed joinery certification, full collision checking and structural capacity.

[Release assets](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.4.1) contain installation artifacts, source, checksums, dependency notices and concise verification summaries. Build-time candidate flags remain inside the archives; the release manifest promotes only the verified bytes. Historical [0.3.0 acceptance](RELEASE_ACCEPTANCE_0.3.0.md) applies only to its original artifacts.
