# Local native appearance presets and acceptance runner

`src/detailed-modeling/appearance-presets.mjs` consumes the locally prepared `appearance-assets/catalog-v2.json`. It verifies the source SKM archives, extracted map files, source SKE archives and extracted HDR files, preserving the catalog's vendor source and license statements. No files are downloaded or declared CC0. These file checks establish local asset provenance, not native rendering acceptance.

The module exports:

| Function | Result |
| --- | --- |
| `loadNativeAppearanceCatalog({catalogPath})` | Catalog plus SHA-256/size manifest for all local input files. |
| `mapNativeNormalStyle(sourceValue, nativeCapabilities)` | Resolves the source XML number against the actual `normal_style_constants` probe. Missing or ambiguous enums fail. |
| `buildAppearanceMaterialOperations(...)` | Material updates against explicit logical-name assignments and the server creation `materialMap`. |
| `buildAppearanceChannelSwatches(...)` | Seven material rows with baseline, scalar/channel endpoint and alpha comparisons; absent source maps are reported. |
| `buildNativeAppearancePlan(...)` | Material/geometry operations, real native style import, two independent HDR definitions, scene bindings, capture views, asset manifest and exact plan hash. |
| `assertAppearanceAssetsUnchanged(plan)` | Rejects modified plans, changed catalog or changed asset/style files before application. |
| `evaluateNativeAppearanceReadback({plan,snapshot})` | Per-field `applied`, `not_applied` or `missing_native_field` based on actual native snapshots; mock evidence cannot pass. |
| `compareNativeAppearancePersistence({before,after})` | Compares every actual native appearance field, including all rendering options and scene bindings, with a 1e-6 numeric tolerance. |

Material assignments are explicit, for example `{ "Detail_Oak": "wood", "Detail_Stone": "stone", "Detail_Glass": "glass" }`. The existing material map supplies the real namespaced names. Existing material updates use extracted source channels because native SKM import requires a fresh name. The v2 catalog's source base color and alpha are retained. An untextured source cannot silently clear a target's existing base texture; this unsupported change is rejected before application.

The 77 comparison cells span wood, stone, tile, paint, metal, glass and fabric. Each row requests baseline, metal 0/1, roughness 0/1, normal strength 0/1, AO strength 0/1 and alpha 0.35/1. The current installed catalog yields 65 real sample panels; 12 cells lack source normal/AO maps and are marked unsupported. Scalar metallic/roughness endpoint samples omit the corresponding texture so the map does not multiply the tested factor. Normal/AO strength samples retain the source map, with the native channel enabled, including at strength zero. No missing channel is substituted from another material.

The plan imports only the supplied real `.style` file. It does not infer that a filename means Photoreal or invent a Photoreal rendering option. Scenes explicitly reference the imported native style and either the studio or daylight HDR. Capture requests use `scene_ref`, so each scene's actual saved environment/style is inspected. One overview and one view per material row support comparison; frozen scene views are also preserved in the inspection set.

Use the serial runner after opening the exact independent test model:

```sh
node scripts/run-detail-appearance-live.mjs preview sample-window pbr-v1 --style-path /absolute/operator-exported.style --assignments-file /absolute/assignments.json
node scripts/run-detail-appearance-live.mjs apply sample-window pbr-v1
node scripts/run-detail-appearance-live.mjs capture sample-window pbr-v1
node scripts/run-detail-appearance-live.mjs reopen sample-window pbr-v1
```

`preview` reads the actual saved model, server creation map and native capability probe, then writes a concrete exact plan without changing SketchUp. `apply` verifies the same model revision, private material map, assets, capability probe and plan hash before using this run's existing expert-appearance execution policy with a fresh handshake. It saves a new `models/LABEL-RUN_ID-appearance.skp`, retaining explicit readback failures in the report. No trusted-user click is fabricated, and no global permission policy is changed. Existing entity replacement remains a separate reviewed operation.

Paths must remain inside `output/detail-modeling-implementation-2026-09-06/models`, use the exact label prefix and match the active saved model. Symlinks escaping that directory are rejected. Evidence is written under `evidence/LABEL/appearance/RUN_ID`; repeat capture/reopen checks create new audit subdirectories. Controlled capture uses at most 24 views per native request and records the restoration result and actual modified-state change.

Before scene inspection, a saved scene must already be selected and active native style changes must be saved. The capture module refuses a state it cannot restore, including a missing selected page; the runner reports that failure without bypassing the guard. Reopen acceptance compares the complete actual native appearance state, including rendering options that are absent from the public operation whitelist. A correct getter/readback result still leaves image review and Photoreal appearance acceptance pending.

Tests: `node test/appearance-presets.mjs`, `node test/detail-appearance-live-runner.mjs`, `ruby test/ruby/native_appearance_test.rb`, and `ruby test/ruby/detail_capture_test.rb`. They cover asset hashes, enum mapping, executable mock operation contracts, unsupported sample cells, zero-strength endpoints, missing native readback fields, persistence comparison, and CLI guards. These tests make no live SketchUp rendering claim.

Official semantics: [Material color](https://ruby.sketchup.com/Sketchup/Material.html#color-instance_method) may reflect a colorized texture's average, so native color readback is reported explicitly; [Material normal style](https://ruby.sketchup.com/Sketchup/Material.html#normal_style-instance_method) uses runtime constants rather than assumed numeric values; [Environment](https://ruby.sketchup.com/Sketchup/Environment.html) and [Page](https://ruby.sketchup.com/Sketchup/Page.html) supply native environment and scene state.
