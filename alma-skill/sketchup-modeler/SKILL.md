# sketchup-modeler

Use this skill when the user asks Alma to create, inspect, iterate, or save a SketchUp-style 3D model.

## Tool Surface

Run commands from the project root:

```bash
node src/cli.mjs get_docs
node src/cli.mjs build_model --runtime mock --code-file examples/demo-room.json
node src/cli.mjs save_model --runtime mock --path output/mock-model.json
node src/cli.mjs build_model --runtime mock --code-file examples/golden-architecture.json
node src/cli.mjs build_model --runtime mock --code-file examples/golden-product.json
```

Use `--runtime queue` only after the SketchUp Ruby plugin is installed and SketchUp is open. Use the two golden examples as regression references before creating larger building or product models.

## Modeling Rules

- Generate JSON DSL, not Ruby, shell, or arbitrary JavaScript.
- Start from `examples/golden-architecture.json` for building semantics, or `examples/golden-product.json` for product/industrial design semantics, when you need a reliable baseline.
- Units are millimeters.
- Coordinates: X = width, Y = depth, Z = height.
- Every group must be named.
- Define materials up front. Use `color`/`alpha` for simple materials, `texture` for image maps, and SketchUp 2025+ `workflow: "pbr_metallic_roughness"` with `pbr` factors/textures for PBR materials.
- Prefer `room` for the first draft, then refine with named `box`, `panel_with_openings`, roof, and component operations.
- Use `lofted_solid` for turned posts/vases/balusters, and `swept_path` for rails/pipes/handrails.
- Use `domed_surface` for cushions, padded slabs, terrain patches, and soft-top forms.
- Use `bowed_panel` for curved walls, bowed doors, barrel panels, and backrests.
- Use `level` to record floor metadata, `floor_slab` for slabs, `wall` for axis-aligned wall runs with openings, `door`/`window` for simple infill geometry, `stairs` for quick stepped access, and `railing` for rails with posts.
- Use `transform: { "translate": [x,y,z], "rotateZ": degrees }` for mesh-like geometry and component instances when origin alone is not enough.
- Add a `scene` with camera before saving important models.
- Add `style`, `shadow`, and `rendering_options` for demo/presentation output; inspect `style_state`, `shadow_state`, and `rendering_options` in snapshots.
- Always inspect the returned snapshot before iterating.
- If snapshot totals are zero, reset and rebuild from a smaller DSL.
- One `build_model` request accepts 2000 operations by default. For trusted large models, set `ALMA_SKETCHUP_MAX_OPERATIONS=<positive integer>` before starting Node/SketchUp, or split work into multiple append batches and omit `reset` after the first batch.

## Build Model DSL

```json
{
  "version": 1,
  "units": "mm",
  "operations": [
    { "op": "reset" },
    { "op": "material", "name": "Wall_Paint", "color": "#efe7dc" },
    { "op": "material", "name": "Brushed_Metal_PBR", "color": "#8a8178", "workflow": "pbr_metallic_roughness", "alpha": 1, "texture": { "path": "textures/brushed-metal-albedo.jpg", "width": 1200, "height": 1200 }, "pbr": { "metallic_factor": 0.85, "roughness_factor": 0.32, "normal_style": "opengl", "normal_scale": 1, "textures": { "metallic": "textures/brushed-metal-metallic.jpg", "roughness": "textures/brushed-metal-roughness.jpg", "normal": "textures/brushed-metal-normal.jpg", "ao": "textures/brushed-metal-ao.jpg", "opacity": "textures/brushed-metal-opacity.jpg" } } },
    { "op": "box", "name": "Sample_Box", "origin": [0, 0, 0], "size": [1000, 1000, 1000], "material": "Wall_Paint" },
    { "op": "lofted_solid", "name": "Turned_Post", "origin": [1500, 0, 0], "profile": [[0, 80], [500, 120], [1000, 70]], "segments": 10, "material": "Wall_Paint", "smooth": "all" },
    { "op": "swept_path", "name": "Rail", "path": [[0, 1200, 900], [1200, 1200, 900]], "radius": 45, "segments": 8, "material": "Wall_Paint", "smooth": "all" },
    { "op": "domed_surface", "name": "Padded_Cushion", "origin": [0, 0, 0], "width": 1200, "depth": 800, "thickness": 120, "crown_height": 180, "segments_x": 4, "segments_y": 4, "material": "Wall_Paint", "smooth": "all" },
    { "op": "bowed_panel", "name": "Curved_Back", "origin": [0, 1200, 0], "width": 1200, "height": 900, "thickness": 80, "bow_depth": 160, "segments_x": 4, "segments_z": 4, "material": "Wall_Paint", "smooth": "all" },
    { "op": "level", "name": "Level_1", "elevation": 0, "height": 3000 },
    { "op": "floor_slab", "name": "Level_1_Slab", "origin": [0, 0, 0], "width": 3600, "depth": 2400, "thickness": 160, "material": "Wall_Paint" },
    { "op": "wall", "name": "Front_Wall", "start": [0, 0, 160], "end": [3600, 0, 160], "height": 2600, "thickness": 120, "openings": [{ "name": "Door_Opening", "x": 400, "y": 0, "width": 900, "height": 2100 }], "material": "Wall_Paint" },
    { "op": "style", "name": "Presentation", "display_edges": true, "profiles": true, "profile_width": 2, "face_style": "shaded_with_textures", "background_color": "#f7f4ed", "sky_color": "#cfe8ff", "ground_color": "#d8d0bf" },
    { "op": "shadow", "display": true, "time": "2026-05-08T14:30:00+08:00", "light": 80, "dark": 35, "use_sun_for_shading": true },
    { "op": "rendering_options", "edge_display_mode": 1, "draw_hidden_geometry": false, "display_color_by_layer": false, "transparency": true },
    { "op": "scene", "name": "Hero_View", "camera": { "eye": [3000, -5000, 2600], "target": [500, 500, 900], "up": [0, 0, 1], "fov": 35 } }
  ]
}
```

## MCP Entry

For clients that support local stdio MCP servers, use:

```bash
node src/mcp-server.mjs
```
