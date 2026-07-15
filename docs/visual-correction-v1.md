# Reference-image Existing-model Correction v1

This workflow is narrowly scoped to correcting an existing model from a supplied reference image. It is not an automatic general-purpose image modeler.

`reference_image_correction` reads reference and captured images only from workspace, private state, or explicitly configured visual roots. It returns stable image summaries, normalized foreground alignment, RGB difference metrics, optional structured model-reference QA, confidence, and opaque artifact handles for evidence, patch, and overlay.

The CorrectionPatch contains mapped persistent targets and safe JSON DSL operations, but always declares `execution_allowed=false`, `review_required=true`, and `execution_route=trusted_reviewed_existing_model_edit_only`. Image content, OCR, and model names cannot alter execution policy. Missing mapped operations, unreadable foreground, or path-policy violations fail closed.

After a real user reviews the patch, execution starts a separate `reviewed_existing_model_edit` task. S2-S4 still require the one-time trusted approval token. `visual_correction_qa` compares the recaptured image with the same reference and returns `pass`, `review`, or `fail` plus residuals. A client without vision or local files can complete the workflow from structured envelopes and artifact handles.

The Gateway never calls live `capture_view` implicitly. Live capture and model mutation require explicit user coordination and a fresh queue handshake.
