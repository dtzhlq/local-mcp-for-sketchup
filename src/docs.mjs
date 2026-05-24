import { formatCapabilityMatrixMarkdown, getRuntimeCapabilities } from './capabilities.mjs';

export const TOOL_DOCS = `
# SketchUp Modeler Local MVP

This project exposes a small SketchUp-like tool surface for Alma:

- get_docs() -> returns these DSL and runtime notes.
- build_model({ code, runtime }) -> builds from a safe JSON DSL and returns a snapshot.
- reset_model({ runtime }) -> clears the current model session.
- save_model({ path, keep_session, runtime }) -> saves the current session.

## Safe DSL

build_model accepts a JSON string, not executable Ruby or shell code. The supported shape is:

{
  "version": 1,
  "units": "mm",
  "operations": [
    {"op": "reset"},
    {"op": "material", "name": "Wall_Paint", "color": "#efe7dc"},
    {"op": "material", "name": "Brushed_Metal_PBR", "color": "#8a8178", "workflow": "pbr_metallic_roughness", "alpha": 1, "texture": {"path": "textures/brushed-metal-albedo.jpg", "width": 1200, "height": 1200}, "pbr": {"metallic_factor": 0.85, "roughness_factor": 0.32, "normal_style": "opengl", "normal_scale": 1, "textures": {"metallic": "textures/brushed-metal-metallic.jpg", "roughness": "textures/brushed-metal-roughness.jpg", "normal": "textures/brushed-metal-normal.jpg", "ao": "textures/brushed-metal-ao.jpg", "opacity": "textures/brushed-metal-opacity.jpg"}}},
    {"op": "box", "name": "Box_1", "origin": [0, 0, 0], "size": [1000, 1000, 1000], "material": "Wall_Paint"},
    {"op": "rounded_box", "name": "Soft_Product_Shell", "origin": [0, 0, 0], "size": [180, 90, 18], "radius": 14, "segments": 6, "material": "Wall_Paint", "smooth": "all"},
    {"op": "beveled_panel", "name": "Chamfered_Faceplate", "origin": [0, 0, 20], "size": [180, 90, 5], "bevel": 8, "material": "Wall_Paint"},
    {"op": "recess", "name": "Inset_Control_Well", "center": [90, 45, 32], "size": [92, 36], "depth": 7, "radius": 10, "segments": 5, "material": "Wall_Paint", "smooth": "all"},
    {"op": "fillet", "name": "Soft_Edge_Insert", "origin": [18, 14, 42], "size": [42, 22, 5], "radius": 5, "segments": 4, "material": "Wall_Paint", "smooth": "all"},
    {"op": "chamfer", "name": "Chamfer_Edge_Insert", "origin": [116, 14, 42], "size": [42, 22, 5], "amount": 4, "material": "Wall_Paint"},
    {"op": "engraved_line", "name": "Controller_Split_Line", "points": [[28, 78, 34], [90, 82, 34], [152, 78, 34]], "width": 3, "depth": 1, "material": "Wall_Paint"},
    {"op": "slot", "name": "Speaker_Slot", "center": [90, 72, 34], "length": 68, "width": 8, "depth": 2, "segments": 5, "material": "Wall_Paint"},
    {"op": "boolean_cutout", "name": "USB_Cutout_Panel", "origin": [60, 82, 36], "size": [60, 20, 4], "cutouts": [{"center": [30, 10], "size": [24, 8]}], "material": "Wall_Paint"},
    {"op": "text_engrave", "name": "Logo_Mark", "center": [90, 58, 34], "text": "ALMA", "height": 8, "depth": 1, "spacing": 1, "align": "center", "material": "Wall_Paint"},
    {"op": "text_3d", "name": "Raised_Font_Label", "center": [90, 30, 40], "text": "ALMA 3D", "height": 14, "extrusion": 2, "font": "Arial", "align": "center", "bold": true, "filled": true, "material": "Wall_Paint"},
    {"op": "pipe_between_points", "name": "Shoulder_Pipe", "points": [[24, 94, 38], [90, 112, 48], [156, 94, 38]], "radius": 4, "segments": 8, "material": "Wall_Paint", "smooth": "all"},
    {"op": "loft_between_profiles", "name": "Grip_Loft", "profiles": [{"origin": [20, 20, 36], "plane": "xy", "points": [[0,0],[44,0],[50,32],[0,28]]}, {"origin": [18, 18, 56], "plane": "xy", "points": [[0,0],[52,0],[60,40],[0,34]]}], "material": "Wall_Paint", "smooth": "all"},
    {"op": "shell_from_front_side_profiles", "name": "Profile_Shell", "origin": [92, 20, 38], "front_profile": [[-22,0],[22,0],[28,20],[0,34],[-28,20]], "side_profile": [[0,5],[18,12],[34,7]], "material": "Wall_Paint", "smooth": "all"},
    {"op": "face_on_cylinder", "name": "Handle_Flat_Pad", "cylinder_center": [164, 45, 0], "cylinder_radius": 16, "center": [180, 45, 48], "width": 18, "height": 16, "depth": 2, "material": "Wall_Paint"},
    {"op": "button_on_panel", "name": "Round_Button", "center": [60, 45, 28], "radius": 14, "height": 6, "segments": 16, "material": "Wall_Paint", "smooth": "all"},
    {"op": "button_on_panel", "name": "Pill_Button", "center": [120, 45, 28], "size": [44, 18], "corner_radius": 9, "height": 5, "segments": 8, "material": "Wall_Paint", "smooth": "all"},
    {"op": "prism", "name": "Gable_Roof", "origin": [0, 0, 3000], "plane": "xz", "points": [[0, 0], [2500, 900], [5000, 0]], "depth": 6000, "material": "Roof"},
    {"op": "panel_with_openings", "name": "Front_Wall", "origin": [0,0,0], "plane": "xz", "size": [5000,3000], "thickness": 120, "openings": [{"name":"Door", "x": 600, "y": 0, "width": 900, "height": 2100}], "material": "Wall_Paint"},
    {"op": "mesh", "name": "Triangle_Panel", "vertices": [[0,0,0], [1000,0,0], [500,0,800]], "faces": [[0,1,2]], "material": "Wall_Paint", "smooth": "coplanar"},
    {"op": "gable_roof", "name": "Main_Roof", "origin": [0,0,3000], "width": 5000, "depth": 7000, "rise": 1200, "overhang": 300, "material": "Roof"},
    {"op": "shed_roof", "name": "Porch_Roof", "origin": [0,-1800,2600], "width": 5000, "depth": 1800, "rise": 450, "overhang": 150, "material": "Roof"},
    {"op": "cylinder", "name": "Round_Post", "origin": [0,0,0], "radius": 120, "height": 2800, "segments": 16, "material": "Post", "smooth": "all"},
    {"op": "lofted_solid", "name": "Turned_Post", "origin": [0,0,0], "profile": [[0,80], [500,120], [1000,70]], "segments": 10, "material": "Post", "smooth": "all"},
    {"op": "analog_stick", "name": "Controller_Stick", "origin": [260,90,28], "height": 38, "base_radius": 24, "shaft_radius": 13, "cap_radius": 30, "top_radius": 22, "segments": 18, "material": "Post", "smooth": "all"},
    {"op": "screw_hole", "name": "Countersunk_Screw", "center": [320,90,32], "radius": 6, "depth": 5, "head_radius": 11, "head_depth": 2, "segments": 12, "material": "Post", "smooth": "all"},
    {"op": "swept_path", "name": "Curved_Rail", "path": [[0,0,900], [1200,0,900], [1800,0,1200]], "radius": 45, "segments": 8, "material": "Post", "smooth": "all"},
    {"op": "domed_surface", "name": "Padded_Cushion", "origin": [0,0,0], "width": 1800, "depth": 900, "thickness": 140, "crown_height": 220, "segments_x": 8, "segments_y": 8, "material": "Fabric", "smooth": "all"},
    {"op": "bowed_panel", "name": "Curved_Back_Wall", "origin": [0,1200,0], "width": 1800, "height": 1200, "thickness": 100, "bow_depth": 260, "segments_x": 8, "segments_z": 8, "material": "Wall_Paint", "smooth": "all"},
    {"op": "level", "name": "Level_1", "elevation": 0, "height": 3000},
    {"op": "floor_slab", "name": "Level_1_Slab", "origin": [0,0,0], "width": 3600, "depth": 2400, "thickness": 160, "material": "Concrete"},
    {"op": "wall", "name": "Front_Wall", "start": [0,0,160], "end": [3600,0,160], "height": 2600, "thickness": 120, "openings": [{"name": "Door_Opening", "x": 400, "y": 0, "width": 900, "height": 2100}], "material": "Wall_Paint"},
    {"op": "door", "name": "Entry_Door", "origin": [425,-45,160], "plane": "xz", "width": 850, "height": 2050, "thickness": 40, "material": "Post"},
    {"op": "window", "name": "Front_Window", "origin": [1925,-35,1080], "plane": "xz", "width": 850, "height": 720, "thickness": 24, "material": "Glass"},
    {"op": "stairs", "name": "Entry_Stairs", "origin": [0,-900,0], "steps": 4, "width": 1400, "tread_depth": 300, "riser_height": 160, "direction": "y", "material": "Concrete"},
    {"op": "railing", "name": "Front_Railing", "path": [[0,-940,640], [1800,-940,640]], "height": 900, "rail_radius": 35, "post_radius": 30, "post_spacing": 600, "material": "Post"},
    {"op": "component_definition", "name": "Baluster", "size": [80,80,900], "material": "Post"},
    {"op": "component_definition", "name": "WindowUnit", "operations": [
      {"op": "material", "name": "Glass", "color": "#88ccee"},
      {"op": "box", "name": "Window_Glass", "origin": [0,0,0], "size": [900,20,700], "material": "Glass"},
      {"op": "box", "name": "Window_Frame", "origin": [-40,-20,-40], "size": [980,60,40], "material": "Post"}
    ]},
    {"op": "component_instance", "name": "Baluster_1", "definition": "Baluster", "origin": [0,0,0], "transform": {"rotateZ": 15, "translate": [200,0,0]}},
    {"op": "camera", "eye": [7000,-9000,5200], "target": [2500,2500,1800], "up": [0,0,1], "fov": 35},
    {"op": "scene", "name": "Hero_View", "camera": {"eye": [7000,-9000,5200], "target": [2500,2500,1800], "up": [0,0,1], "fov": 35}},
    {"op": "style", "name": "Presentation", "display_edges": true, "profiles": true, "profile_width": 2, "display_watermarks": false, "face_style": "shaded_with_textures", "background_color": "#f7f4ed", "sky_color": "#cfe8ff", "ground_color": "#d8d0bf"},
    {"op": "shadow", "display": true, "time": "2026-05-08T14:30:00+08:00", "light": 80, "dark": 35, "use_sun_for_shading": true},
    {"op": "rendering_options", "edge_display_mode": 1, "draw_hidden_geometry": false, "display_color_by_layer": false, "transparency": true},
    {"op": "room", "name": "Demo_Room", "width": 4500, "depth": 3000, "height": 2400}
  ]
}

## Coordinates

- Units are millimeters.
- X = width, Y = depth, Z = height.
- All groups must be named.
- Materials are created by name and reused. \`material\` supports \`color\`, \`alpha\`, base \`texture\` as a path string or \`{path,width,height}\`, and SketchUp 2025+ PBR via \`workflow: "pbr_metallic_roughness"\` plus \`pbr.metallic_factor\`, \`pbr.roughness_factor\`, \`pbr.ao_strength\`, \`pbr.normal_style\`, \`pbr.normal_scale\`, and \`pbr.textures.{metallic,roughness,normal,ao,opacity}\`.
- \`tag\` creates SketchUp Tags/Layers, \`assign_tag\` assigns tags to top-level groups or component instances, \`attribute\` writes JSON-compatible metadata to SketchUp attribute dictionaries, and \`classification\` attaches BIM/classification metadata returned as a first-class snapshot field.
- \`texture_transform\` records deterministic texture projection/offset/scale/rotation metadata for top-level objects, \`uv_project_planar\` and \`uv_project_box\` are semantic projection aliases, and \`image_plane\` creates flat reference or image planes with material/texture metadata.
- \`transform_object\` edits existing top-level groups or component instances by stable \`target_id\` or legacy \`name\`; it supports translate, rotateX/Y/Z, model-space \`axis + angle\`, local-axis \`local_axis + local_angle\`, SketchUp-compatible 16-number \`matrix\`, scale, mirror, and origin/center/explicit pivots.
- Texture paths are passed to SketchUp as file paths; prefer absolute paths for queue runtime. Missing files are skipped with warnings in SketchUp.
- \`box\` creates an axis-aligned cuboid from \`origin\` and \`size\`.
- \`rounded_box\` creates a Z-extruded rounded-rectangle footprint from \`origin/size/radius\`; use \`segments\` to control corner resolution.
- \`beveled_panel\` creates a thin Z-extruded chamfered rectangle from \`origin/size/bevel\`; use it for product faceplates, recessed panels, and straight-corner chamfers.
- \`fillet\` / \`chamfer\` create stable box-like edge-treatment solids from \`origin/size\`; this slice rounds or bevels the XY footprint / vertical edges, while arbitrary selected-edge CAD fillets remain out of scope.
- \`recess\` creates a visible sunken tray from \`center/size/depth\`; add \`radius/segments\` for rounded control wells, LED pockets, and inset panels. It is not a true boolean cut yet.
- \`engraved_line\` creates dark recessed groove segments from \`points/width/depth\`; use it for seam lines, panel splits, and decorative product grooves.
- \`text_3d\` creates real font-outline text in queue runtime through SketchUp \`Entities#add_3d_text\`; mock runtime records deterministic estimated bounds plus \`Text3D\` metadata for offline QA. Use \`font\`, \`align\`, \`bold\`, \`italic\`, \`filled\`, \`height\`, and \`extrusion\` or \`depth\`.
- \`slot\` creates a visual rounded long slot from \`center/length/width/depth\`; use it for speaker slots, USB openings, and elongated product cutout markers. It is not a true boolean cut yet.
- \`boolean_cutout\` creates a rectangular XY slab with deterministic rectangular through-holes from local \`cutouts[].center/size\`. It is a safe true-hole slice, not arbitrary solid boolean.
- \`face_with_holes\` and \`profile_extrude\` accept simple non-self-intersecting 2D \`outer\` loops plus optional polygon \`holes[].points\`; holes must stay strictly inside the outer loop and cannot overlap.
- \`pipe_between_points\` creates a round pipe through arbitrary 3D \`points\` or \`start/end\`; use it for rods, cables, shoulder rails, and diagonal/Y-oriented tubes that legacy \`swept_path\` cannot frame reliably.
- \`loft_between_profiles\` creates a mesh body through matching profile sections; use it for grip bulges and organic product shells where each profile has the same point count.
- \`shell_from_front_side_profiles\` creates a symmetric shell from a closed front \`[x,z]\` silhouette and a side \`[z, half_depth]\` curve. This is deterministic, but visual QA is recommended for point order, silhouette quality, and proportions.
- \`face_on_cylinder\` creates a flat raised visual pad tangent to a cylindrical housing from \`cylinder_center/cylinder_radius/center/width/height\`; it is not a conformal wrap or boolean projection.
- \`button_on_panel\` creates raised controls along +Z from \`center/height\`; use \`radius\` for round buttons or \`size\` plus optional \`corner_radius\` for pill/rounded-rectangle buttons.
- \`prism\` creates a 2D polygon face and extrudes it. Use \`plane: "xy"\` to extrude along +Z, \`"xz"\` along +Y, or \`"yz"\` along +X. \`points\` are 2D \`[u, v]\` pairs in millimeters and \`depth\` is extrusion distance.
- \`mesh\` creates arbitrary indexed geometry from \`vertices\` and \`faces\`. Prefer triangle faces for reliability; quads are only safe when coplanar. Set \`smooth\` to \`"all"\` for curved/organic geometry or \`"coplanar"\` to hide triangle diagonals on flat panels.
- \`panel_with_openings\` creates a rectangular panel/wall with real door/window cutouts. Use \`plane: "xz"\` for normal vertical walls extruded along +Y; openings use local 2D \`x/y/width/height\` coordinates.
- \`gable_roof\` and \`shed_roof\` are high-level roof helpers built from prism/mesh geometry.
- \`cylinder\` creates segmented circular solids; use \`segments\` to control resolution and \`smooth: "all"\` for round-looking edges.
- \`lofted_solid\` creates a closed Z-axis solid of revolution from \`profile: [[height, radius], ...]\`; use it for turned posts, bottles, vases, knobs, and balusters.
- \`analog_stick\` creates a controller stick using a default radial shaft/cap profile; override with \`profile\` or tune \`height/shaft_height/base_radius/shaft_radius/cap_radius/top_radius\`.
- \`screw_hole\` creates a visual screw hole/countersink marker from \`center/radius/depth\`; add \`head_radius/head_depth\` for countersunk screw recesses. It is not a true boolean cut yet.
- \`swept_path\` creates a capped tube by sweeping a circular section along \`path\`; the MVP assumes path rings in the Y-Z plane, best for rails/pipes primarily running along X.
- \`domed_surface\` creates a crowned rectangular slab from \`width/depth/thickness/crown_height\`; use it for cushions, padded surfaces, terrain patches, and soft-top forms.
- \`bowed_panel\` creates a thick rectangular panel bowed along +Y from \`width/height/thickness/bow_depth\`; use it for curved walls, barrel-vault-like panels, bowed doors, and backrests.
- \`level\` stores named floor metadata such as \`elevation\` and optional \`height\`; snapshots record it under \`levels\`.
- \`floor_slab\` creates a simple rectangular slab from \`origin/width/depth/thickness\`.
- \`wall\` creates an axis-aligned wall segment from \`start/end/height/thickness\`; use \`openings\` for door/window cutouts just like \`panel_with_openings\`.
- \`door\` and \`window\` create simple vertical infill markers in \`xz\` or \`yz\` planes.
- \`stairs\` creates stepped box geometry from \`steps/width/tread_depth/riser_height\` along the \`x\` or \`y\` direction.
- \`railing\` creates a swept top rail plus evenly spaced cylindrical posts along a polyline \`path\`.
- \`transform\` can be added to mesh-like operations and component instances: \`{ "translate": [x,y,z], "rotateZ": degrees }\`. Existing \`origin\` remains the preferred placement field.
- \`component_definition\` + \`component_instance\` provide reusable repeated objects. Definitions can use legacy \`size\` or nested \`operations\`; nested component operations support geometry/material ops but intentionally reject global ops such as \`reset\` and \`camera\`.
- \`camera\` sets saved model view state in the SketchUp runtime and records \`view_state\` in mock snapshots. \`scene\` stores named camera views and records them in \`scenes\`.
- Snapshots include \`materials\` as full material objects plus \`material_names\` for quick name checks, and structured warnings for zero-face groups and overlapping bounding boxes.


## Golden Examples

Use these deterministic regression examples when checking broad DSL behavior:

- \`examples/golden-architecture.json\` — architectural semantic model covering levels, slabs, walls with openings, door/window markers, stairs, railings, gable/shed roofs, scenes, style, shadows, and rendering options.
- \`examples/golden-product.json\` — product/industrial design baseline covering reusable component definitions/instances, an editable shell mesh, domed/bowed surfaces, lofted analog sticks, swept accent seams, cylinders, transforms, scenes, materials, structured warning QA, and resolution hints.
- \`examples/structured-product-helpers.json\` — focused capability slice for structural product helpers such as \`slot_array\`, \`rib\`, and \`standoff_boss\`, kept separate from the presentation-oriented product baseline.
- \`examples/editing-transform-profile.json\` — phase 2 editing capability slice covering \`delete\`, \`rename\`, \`set_material\`, \`set_visibility\`, \`transform_object\` including model-space axis, local-axis, and matrix transforms, \`face_with_holes\`, and \`profile_extrude\`.
- \`examples/component-transform-composition.json\` — component instance transform composition slice covering nested component geometry plus \`transform_object\` local-axis, model-axis, and matrix edits on component instances.
- \`examples/transform-chain-regression.json\` — focused transform chain regression covering repeated \`transform_object\` edits on a group and component instance with center pivots, local axes, model axes, translation, and matrix transforms.
- \`examples/metadata-organization-slice.json\` — phase 4 organization slice covering \`tag\`, \`assign_tag\`, \`attribute\`, and \`classification\` metadata returned in snapshots.
- \`examples/profile-edge-cases.json\` — generic profile regression slice covering concave outer loops, multiple holes, vertical \`xz\` face profiles, and nested component-definition profiles.
- \`examples/appearance-texture-slice.json\` — appearance regression slice covering \`texture_transform\`, \`uv_project_planar\`, \`uv_project_box\`, top-level \`image_plane\`, and component-definition scoped \`image_plane\`.
- \`examples/text-3d-slice.json\` — true font-outline text slice covering top-level and component-definition scoped \`text_3d\`.

The golden examples and capability slices are exercised by \`npm test\` through the mock runtime only; they do not require SketchUp to be open.

## Snapshot Schema

Snapshots returned by \`build_model\`, \`reset_model\`, and \`save_model\` include:

- **\`runtime\`** — bridge-attached runtime descriptor with runtime name, version, manifest version, DSL version, and operation support status.
- **\`totals\`** — \`{faces, edges, vertices, groups, instances}\` aggregated across all visible geometry.
- **\`groups\`** — array of \`{name, kind, faces, edges, vertices?, bounding_box, material, transform, resolution_hint?}\`.
  - \`vertices\` (optional count) is populated for mesh-type groups that have explicit vertex arrays.
  - \`resolution_hint\` (optional) reports \`segments\`, \`segments_x\`, \`segments_y\`, or \`segments_z\` for curved-surface operations (rounded_box, recess, button_on_panel, cylinder, lofted_solid, analog_stick, screw_hole, swept_path, domed_surface, bowed_panel).
- **\`instances\`** — array of component instance snapshots with the same shape as groups plus \`definition\`.
- **\`warnings\`** — array of structured warning objects: \`{type, severity, category, message, source}\`.
  - **types**: \`geometry.degenerate\` | \`geometry.bbox_overlap\` | \`material.missing_texture\` | \`material.pbr_unsupported\` | \`rendering.unsupported_option\` | \`rendering.apply_failed\` | \`info.limitation\` | \`info.operation_skipped\`
  - **severity**: \`error\` | \`warn\` | \`info\`
  - **category** is derived from the type prefix (geometry, material, rendering, info).
- **\`warning_messages\`** — flat \`string[]\` for quick scanning (backward compat).
- **\`warning_summary\`** — \`{total, by_severity: {error, warn, info}, by_category: {...}}\`.
- **\`artifact_size_bytes\`** — (save_model only) size of the saved artifact file in bytes.
- **\`bounding_box\`** — \`{min: [x,y,z], max: [x,y,z], w, d, h}\` in mm.
- **\`materials\`**, **\`material_names\`**, **\`component_definitions\`**, **\`scenes\`**, **\`levels\`**, **\`style_state\`**, **\`shadow_state\`**, **\`rendering_options\`**, **\`view_state\`** — preserved as before.

\`save_model\` also returns \`file_path\` and \`file_size_bytes\` at the top level.

\`compare_snapshots({ expected, actual, toleranceMm?, topologyTolerance?, budgets?, topIssueLimit? })\` compares two snapshot objects and returns \`{ ok, level, verdict, tolerance_mm, topology_tolerance, budgets, summary, top_issues, recommendations, diffs }\`. It is intended for mock/queue parity checks and golden regression reports. Optional topology tolerance supports faces, edges, groups, and instances; optional budgets support max_faces, max_edges, max_vertices, max_groups, max_instances, and max_artifact_size_bytes.

\`compare_model({ code, expected_runtime?, actual_runtime?, reset_first?, toleranceMm?, topologyTolerance?, budgets?, topIssueLimit?, include_snapshots? })\` builds the same DSL through two runtimes and returns \`{ expected_runtime, actual_runtime, reset_first, report }\`, optionally including both snapshots. It defaults to \`mock -> queue\`; use \`actual_runtime: "mock"\` for offline smoke tests. The CLI can render compare reports as Markdown with \`--format markdown --output-file output/report.md\`. For batch golden QA, run \`npm run qa:mock\` or \`npm run qa:queue\`.

## Runtimes

- mock: local deterministic geometry snapshot, useful for Alma/test loops without opening SketchUp.
- queue: writes requests into ~/.sketchup-mcp-replica/queue for the SketchUp Ruby plugin to execute; call get_capabilities to verify the installed plugin version, live operation support, and runtime.compatibility before long builds.
- Safety limit: one build_model request accepts up to 2000 operations by default. Set ALMA_SKETCHUP_MAX_OPERATIONS to a positive integer before starting Node/SketchUp to raise this for trusted large models. Large models can also be appended in multiple build_model calls by omitting reset after the first batch.
`;

export function getDocs() {
  return [
    TOOL_DOCS.trim(),
    '## Capability Baseline',
    '',
    'The capability matrix is generated from the single operation registry in `src/capabilities.mjs`. Manifest rows, runtime `operation_support`, schemas, component-definition scope, docs, and contract tests all derive from that registry. The queue runtime also performs a live `get_capabilities` handshake with the installed SketchUp Ruby plugin before attaching runtime descriptors to snapshots, then adds `runtime.compatibility` to flag manifest/version drift.',
    '',
    formatCapabilityMatrixMarkdown(),
    '',
    '## Runtime Capability Descriptors',
    '',
    '```json',
    JSON.stringify({ mock: getRuntimeCapabilities('mock'), queue: getRuntimeCapabilities('queue') }, null, 2),
    '```'
  ].join('\n');
}
