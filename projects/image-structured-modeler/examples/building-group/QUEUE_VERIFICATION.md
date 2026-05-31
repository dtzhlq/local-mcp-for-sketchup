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
