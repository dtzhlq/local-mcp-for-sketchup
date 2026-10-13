# 0.4.1 release acceptance

The stable target is Apple Silicon macOS with SketchUp 2026. Product version `0.4.1`, runtime capability `0.4.1-assembly.1`, 48 public tools and bundled Node `24.18.0` are bound by the [release manifest](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/download/v0.4.1/agent-install.v1.json). The validation policy is `assembly-v041-minimal.v1`: reuse the documented A/B/C development geometry checks, then verify the exact final signed plugin and service with a bounded native creation, selected-instance edit and view.

## Final package evidence — 2026-10-13

- macOS service archive SHA-256: `cc5ba9ff01e1fef8ff60ed1ea786c50bf9d2544ad8558782a49914f1dc1e02d2` (71,219,832 bytes).
- Officially signed, unencrypted RBZ SHA-256: `72701e979df1a65231254660ff4cd5dc972885f51db064feebd4e0e6eeb93978` (152,481 bytes). The signing portal retained all 33 source files byte for byte and added only the signature file. Extension Manager displayed version 0.4.1, signed and enabled after a full SketchUp restart.
- The extracted macOS bundle verified 334 runtime source files, MCP initialization, discovery of all 48 tools and a documentation call using its own Node. Runtime source fingerprint: `2aea288e13a1bf4a79f91fb7b89904ec26184242a8a66f87e6b29f0426da2c0e`.
- The final bundle pins sharp `0.35.5` / libvips `1.3.4`. Dependency audit reported zero vulnerabilities; image integration checks passed after the upgrade.
- The 39-step core gate and Ruby detail-capture tests (22 runs, 251 assertions) passed. These are offline/mock evidence; the release assets carry the final CI and native reports separately.

The installed signed plugin reported SketchUp `26.2.242`, product `0.4.1` and capability `0.4.1-assembly.1` through a fresh queue handshake. The exact final bundle created two shared one-bay corridors, changed only the selected corridor from 1500 to 1800 mm, and verified the result:

| Step | Native task |
| --- | --- |
| Create | `task_5cc46c8c-2bfa-4386-9a10-3fa7c6b52aa2` |
| Selected-instance parameter edit | `task_8f6819d1-ed82-4719-a979-620571df0619` |
| Post-edit verification and view | `task_81c54e96-e1ff-4f0a-a8c7-a82383cb3bd7` |

Four native column centers establish the selected 1800 mm span and the untouched shared 1500 mm span. All four other root objects retained their geometry digests, transforms and definitions; the selected placement and original shared definition were preserved. The final verification accepted model revision `sha256:06e85998d2d8964c111ac68122aee6eae880bdbd49d1ee864246963154196a4b`. The reviewed native image shows the selected roof, columns and bench; camera, display state and complete model revision were restored after capture.

The new pre-capture guard was also exercised inside the loaded signed plugin with a disposable camera-facing component. It rejected an unsettled stored transformation before camera assignment, redraw, export or geometry writes. The complete revision and camera remained unchanged, no image was written, and aborting the fixture restored its original revision.

## Reused development evidence and example

[Development acceptance](traditional-assembly-v041-status.md) records A (straight corridor), B (single-eave square pavilion), and C (eight-root courtyard composition), selected-root edits, native opening/junction measurements, accepted views and saved SKP files. D covers an unpreset supported composition and explicit unsupported-topology gaps offline.

The lightweight release example is C: two gable units, an L corridor, a square pavilion, a roofed rectangular entrance, a true circular wall opening, site pieces and a reference cube. The gate opening changed from 1600 to 1900 mm while the other seven roots and template person stayed unchanged. The saved model is 2,324,469 bytes, SHA-256 `65d02825aa1e877463bb9f8f46dc882fe8876237a28faa802a886ad02d216ddc`; its wider overview shows every root. Saved-source discovery returned all eight continuations through public artifact paging. This evidence predates the final packaging step and is reused explicitly.

## Scope and remaining limits

- Windows x64 is a matching [installation preview](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.4.1-windows-preview.1). Its exact archive is checked on Windows with bundled Node, runtime fingerprints, the tool registry and offline image/CAD/timber/assembly fixtures. Windows native SketchUp load, queue modeling and save/close/reopen remain unverified; `release_acceptance=false` there.
- The existing host loading policy was observed as **Unrestricted** and was preserved. Official signature recognition and startup were observed, but startup under the stricter identified-extension-only policy was not verified in this release. This is an explicit exception to the preferred signing checklist.
- This minimal macOS policy does not claim a new save/close/reopen or network-denied run. Saved-scene continuation and partial-metadata recovery have fixture coverage; native cold-reopen parameter editing remains unverified.
- Supported assembly families are documented in [ASSEMBLY.md](traditional-timber/ASSEMBLY.md). Arbitrary multi-storey roofs, complex corridor networks, historically accurate construction, concealed joinery, full collision checking and structural capacity are not certified.
- Unchanged CAD/modeling behavior reuses prior evidence. Historical [0.3.0 acceptance](RELEASE_ACCEPTANCE_0.3.0.md) applies only to its original artifacts.

The final release manifest, SHA-256 list, source commit/tree manifest, dependency inventory, native acceptance and CI receipts accompany the [release assets](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.4.1). Build-time candidate flags remain inside the archives; the release manifest promotes only those exact verified bytes.
