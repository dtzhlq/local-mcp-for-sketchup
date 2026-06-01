# Building Group Queue Verification

Date: 2026-05-31

Command:

```bash
npm run image-structured:qa-building-group:queue
```

Live queue capability handshake:

- Plugin: `queue-plugin-0.1.0-phase7-boolean-manifold.3`
- SketchUp: `26.2.242`
- Compatibility: `ok`

Artifacts:

- SKP: `output/image-structured-building-group-massing.skp`
- SKP size: `208737` bytes
- Layout QA report: `layout-qa-queue/building-group-massing/report.json`
- Reference Visual QA report: `reference-visual-qa-queue/building-group-massing/report.json`

Queue snapshot summary:

| Metric | Value |
|---|---:|
| Groups | 14 |
| Instances | 0 |
| Faces | 256 |
| Edges | 452 |
| Vertices | 224 |
| Scenes | 2 |
| Layout QA issues | 0 |
| Reference Visual QA issues | 0 |

Scope note: this verifies the review-gated massing chain in live SketchUp. Detail proposal acceptance is recorded separately below.

## Candidate Promotion Queue Verification

Verified command:

```bash
npm run image-structured:proposal-review-chain-building-group-candidates:queue
```

Artifacts:

- SKP: `output/image-structured-building-group-candidate-warehouses.skp`
- Proposal QA report: `proposal-qa-candidates-queue/report.json`
- Applied PartGraph: `part-graph.part-candidates-applied.json`
- Compiled DSL: `output.part-candidates-applied.json`

Queue candidate snapshot summary:

| Metric | Value |
|---|---:|
| Groups | 20 |
| Instances | 0 |
| Faces | 292 |
| Edges | 524 |
| Vertices | 272 |
| Visual relation issues | 0 |
| GeometryFit issues | 0 |
| Physical consistency issues | 0 |

2026-06-01 note: Perception-to-Geometry Grounding v2 now isolates the lower-right parking rows, negative-space drive aisle, and tree row as mask/gap/contour-grounded candidates. The live queue refresh saves `output/image-structured-building-group-candidate-warehouses.skp` (226653 bytes), proposal QA is `ok=true`, and GeometryFit checks 9 footprints, 12 projected relations, 4 scale anchors, and 1 handedness negative with 0 issues. This remains a generated-image technical baseline, not photo/survey-grade reconstruction.

## R7 Final Detail Queue Verification

Command:

```bash
npm run image-structured:proposal-review-chain-building-group-all:queue
```

Artifacts:

- SKP: `output/image-structured-building-group-r7-final.skp`
- SKP size: `253371` bytes
- Proposal QA report: `proposal-qa-r7-final-queue/report.json`
- Accepted review fixture: `parameter-proposal-review.accepted-all.json`
- Applied PartGraph: `part-graph.r7-final.json`
- Compiled DSL: `output.r7-final.json`

Queue final snapshot summary:

| Metric | Value |
|---|---:|
| Groups | 14 |
| Instances | 0 |
| Faces | 609 |
| Edges | 1442 |
| Vertices | 884 |
| Layout QA issues | 0 |
| Reference Visual QA issues | 0 |
| Physical consistency issues | 0 |

Scope note: this verifies the accepted-all roofline/facade/opening detail proposal chain for the generated-image R7 sample. It is the R7 technical baseline for the current test set, while real north/up and surveyed dimensions remain explicit review inputs.

## R8 Editable Geometry Queue Verification

Command:

```bash
npm run image-structured:r8-building-group-geometry:queue
```

Artifacts:

- SKP: `output/image-structured-building-group-r8-geometry.skp`
- SKP size: `589284` bytes
- Proposal QA report: `proposal-qa-r8-geometry-queue/report.json`
- Layout QA report: `layout-qa-r8-geometry-queue/building-group-r8-geometry/report.json`
- Reference Visual QA report: `reference-visual-qa-r8-geometry-queue/building-group-r8-geometry/report.json`
- Applied PartGraph: `part-graph.r8-geometry.json`
- Compiled DSL: `output.r8-geometry.json`

Queue geometry-only snapshot summary:

| Metric | Value |
|---|---:|
| Groups | 268 |
| Instances | 0 |
| Faces | 5120 |
| Edges | 9493 |
| Vertices | 4930 |
| Layout QA issues | 0 |
| Reference Visual QA issues | 0 |
| Physical consistency issues | 0 |
| Image planes | 0 |

Scope note: this verifies the R8 structural-grounding repair in live SketchUp. The saved model remains no-texture editable geometry and still requires grounding review, but the old site-scale road bbox is replaced by polygonal road regions, parking lines carry line/grid-fit evidence, roof seams bind to roof surfaces, tank details inherit two reviewed ellipse instances, and vehicles are not generated without per-instance evidence.

GeometryFit v2 queue summary:

| Metric | Value |
|---|---:|
| Verdict | review |
| Issues | 4 warnings |
| Structural grounding issues | 0 |
| Dense helper ratio | 0.653 |
| Site unclassified ratio | 0.388 |
| Internal road area ratio | 0.06 |
| Parking spacing error ratio | 0.017 |
| Floating roof features | 0 |
| Tank ellipse instances | 2 |
