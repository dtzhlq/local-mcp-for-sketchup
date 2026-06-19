# Real-World Building Positive Sample

Place a real user-provided building/campus sample here as `manifest.json`.

The release gate reads only `manifest.json`. The included `manifest.example.json` is a template and does not close the release gap.

For the earlier upload/intake step, use `upload-manifest.example.json` as the optional upload metadata template. That file declares ordinary uploaded filenames, view labels, known dimensions, and scale anchors for `image-structured:real-world-building-upload-session`; it is not the release manifest consumed by the final release gate.

Use `npm run image-structured:prepare-real-world-building -- --intake-dir <intake-output-dir>` to generate a draft manifest from an intake output directory. The command reads `asset-set.json`, infers source asset paths, profile hints, and default release artifact paths, then writes `output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json`, `manifest-contract-summary.json`, `release-checklist.json`, and `release-checklist.md` by default. You can still pass explicit `--source-image`, `--part-graph`, `--compiled-output`, and `--photo-grade-readiness-report` when a sample has already been manually reviewed. Pass `--manifest-output projects/image-structured-modeler/examples/real-world-building-positive/manifest.json` only after the real sample has been reviewed and the checklist reports `can_promote_to_release_manifest=true`; if that formal path is passed too early, prepare keeps the candidate in a staging draft, returns `formal_release_manifest_write_blocked`, and does not create or overwrite the formal manifest.

You can validate a draft with `npm run image-structured:validate-real-world-building -- --manifest output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json --output-dir output/image-structured-modeler/real-world-building-positive-manifest/draft-validation --require-present`. Invalid drafts return `ok=false` but still write the summary and checklist artifacts for review.

Required contract:

- Source assets must be real user-provided building photos/scans, not generated images, screenshots, or scaffold placeholders.
- The manifest must point at a compiled PartGraph and DSL output. The release gate recompiles the PartGraph and requires byte-for-byte output freshness.
- `photo_grade_readiness_report` must be `technical_baseline` or `candidate`, with `input_asset_status=available`.
- The final manifest must include `review.reviewer`, `review.accepted_at`, and `review.notes`.
- Optional QA reports, when present, must not contain error-level failures.

Until this manifest exists and passes, `image-structured:release-gate` keeps `real_world_building_positive_release_sample_missing`.
