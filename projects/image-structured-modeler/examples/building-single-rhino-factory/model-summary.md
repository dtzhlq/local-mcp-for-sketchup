# Building Single Rhino Factory Model

- Status: technical baseline, dimensioned drawing grounded
- Source images:
  - `test/建筑群/建筑单体/AI解放生产力之Rhino 建模_4_九思摸鱼第一名_来自小红书网页版.jpg`
  - `test/建筑群/建筑单体/AI解放生产力之Rhino 建模_5_九思摸鱼第一名_来自小红书网页版.jpg`
- Hard dimensions: 136200 mm length x 40200 mm depth, main wall 13000 mm, max datum 15100 mm
- Plan segment chain: 17100 + 6000 + 42000 + 6000 + 42000 + 6000 + 17100 = 136200 mm
- Segment edge coordinates from model origin: -68100, -51000, -45000, -3000, 3000, 45000, 51000, 68100 mm
- DSL operations: 564
- Semantic parts: 11

## Modeled From Hard Evidence

- Rectangular workshop footprint from the plan sheet: 136.2 m x 40.2 m.
- Single-story 13 m main building height from the plan/elevation labels.
- Max 15.1 m roof monitor/parapet datum from the elevation marker.
- Orange and light-grey color steel facade material split from the elevation labels.
- Rooftop photovoltaic array from the plan text.
- Orange color steel panels use horizontal panel ribs; the diagonal orange panels slope outward downward at both ends, with thinner cladding projection and shortened end mid-bands to avoid overhang on the main facade.
- Front loading doors, personnel doors, and canopies are positioned and scaled separately: personnel doors are lower plain framed doors, while loading doors remain taller roll-up doors.
- Side-elevation windows are constrained to the central grey field: one shorter upper ribbon and four smaller lower rectangular windows.
- The lower reference elevation is modeled on the east/west short-side facades, not on the rear long facade.

## Proportional / Review-Gated Details

- Window bay counts, mullions, loading doors, personnel doors, canopies, side-elevation orange diagonal braces, wall ribs, roof seams, and the raised roof monitor are matched to the visual proportions of the sheets.
- These details are not survey-grade because the screenshots do not provide every opening width, sill height, mullion spacing, or canopy projection.
- The output is intentionally kept editable as separate DSL groups instead of merged booleans.
