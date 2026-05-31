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

Scope note: this verifies the current review-gated massing chain in live SketchUp. It is not final architectural acceptance; facade planes, rooflines, openings, and north/up confirmation remain R7 follow-up work.
