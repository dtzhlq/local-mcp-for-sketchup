# Real-model Reliability Corpus v1

The corpus prioritizes task reliability over operation count. Its manifest is `test/reliability-corpus/manifest.json` and currently contains seven adversarial domains: architecture, interior, boolean/manifold product, deep shared components, imported dirty CAD topology, appearance/scenes, and scaled/mirrored/locked entities.

The deterministic mock gate verifies save/reopen snapshot stability, persistent identity across a 1,600-entry recursive index, boolean/manifold checks, open-mesh detection and repair, UV/material/Scene preservation, locked-entity rejection, batch rollback, wrong-target isolation, and nonuniform mirrored transforms.

Reported metrics are task success rate, wrong-object modification count, silent geometry corruption count, and recovery rate. Passing mock evidence does not promote beta or experimental capabilities to stable and does not claim SketchUp-version parity. Real SKP, viewport, and version-matrix proof remains a separate user-coordinated live gate.
