export const DSL_VERSION = 1;
export const CAPABILITY_MANIFEST_VERSION = '2026-05-phase5-closeout-slice';
export const RUNTIME_CAPABILITY_VERSION = '0.1.0-capabilities.3';

export const SUPPORT_STATUS = Object.freeze({
  supported: 'supported',
  partial: 'partial',
  metadataOnly: 'metadata-only',
  unsupported: 'unsupported'
});

export const STABILITY = Object.freeze({
  stable: 'stable',
  beta: 'beta',
  experimental: 'experimental'
});

const objectIdentity = ['id', 'object_id', 'objectId', 'guid'];
const objectTarget = ['target_id', 'targetId', 'target', 'object'];
const commonPlacement = [...objectIdentity, 'material', 'transform.translate', 'transform.rotateZ'];

const OPERATION_REGISTRY_ENTRIES = [
  {
    op: 'reset',
    description: 'Clear the current model session before appending new geometry.',
    schema: { required: ['op'], optional: [] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    notes: 'Usually used as the first operation in a build batch.'
  },
  {
    op: 'material',
    description: 'Create or update a named material with color, alpha, texture, and optional PBR fields.',
    schema: { required: ['op', 'name'], optional: ['color', 'alpha', 'texture', 'workflow', 'pbr'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Mock records material fields; queue applies supported SketchUp material/PBR fields and warns on missing texture files.'
  },
  {
    op: 'tag',
    description: 'Create or update a SketchUp tag/layer used to organize model entities.',
    schema: { required: ['op', 'name'], optional: ['color', 'visible'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'SketchUp 2020+ calls these Tags; Ruby exposes them through the legacy Layers API.'
  },
  {
    op: 'assign_tag',
    description: 'Assign an existing or implicit tag to a top-level group or component instance.',
    schema: { required: ['op', 'tag'], optional: ['name', 'tag_name', 'tagName', ...objectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Targets the same stable id/name reference path used by editing operations.'
  },
  {
    op: 'attribute',
    description: 'Write structured metadata onto a top-level group or component instance.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, 'dictionary', 'namespace', 'key', 'attr_key', 'attrKey', 'value', 'attributes'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Stores JSON-compatible values under a SketchUp attribute dictionary and returns them in snapshots.'
  },
  {
    op: 'classification',
    description: 'Attach BIM/classification metadata to a top-level group or component instance.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, 'system', 'schema', 'type', 'classification', 'class', 'ifc_class', 'ifcClass', 'identifier', 'attributes'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Stores a normalized classification snapshot and mirrors fields to a SketchUp Classification attribute dictionary.'
  },
  {
    op: 'texture_transform',
    description: 'Attach texture mapping metadata to a top-level group or component instance.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, 'material', 'projection', 'offset', 'offset_u', 'offsetU', 'offset_v', 'offsetV', 'scale', 'scale_u', 'scaleU', 'scale_v', 'scaleV', 'rotation', 'rotation_degrees', 'rotationDegrees'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'First texture-mapping slice: records deterministic UV/projection metadata in snapshots and mirrors it to SketchUp attributes.'
  },
  {
    op: 'uv_project_planar',
    description: 'Attach planar UV projection metadata to a top-level group or component instance.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, 'material', 'offset', 'offset_u', 'offsetU', 'offset_v', 'offsetV', 'scale', 'scale_u', 'scaleU', 'scale_v', 'scaleV', 'rotation', 'rotation_degrees', 'rotationDegrees'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Semantic alias for texture_transform with projection=planar.'
  },
  {
    op: 'uv_project_box',
    description: 'Attach box UV projection metadata to a top-level group or component instance.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, 'material', 'offset', 'offset_u', 'offsetU', 'offset_v', 'offsetV', 'scale', 'scale_u', 'scaleU', 'scale_v', 'scaleV', 'rotation', 'rotation_degrees', 'rotationDegrees'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Semantic alias for texture_transform with projection=box.'
  },
  {
    op: 'delete',
    description: 'Delete an existing named group or component instance from the current model session.',
    schema: { required: ['op'], optional: ['name', ...objectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Phase 2 editing operation. Names must be unique enough to identify a top-level group or instance.'
  },
  {
    op: 'rename',
    description: 'Rename an existing named group or component instance.',
    schema: { required: ['op', 'new_name'], optional: ['name', ...objectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Fails if the target does not exist or the new name is already present in mock.'
  },
  {
    op: 'set_material',
    description: 'Assign a material to an existing named group or component instance.',
    schema: { required: ['op', 'material'], optional: ['name', ...objectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Creates the material if needed and applies it to the target object faces in queue.'
  },
  {
    op: 'set_visibility',
    description: 'Show or hide an existing named group or component instance.',
    schema: { required: ['op', 'visible'], optional: ['name', 'hidden', ...objectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Hidden objects remain listed in snapshots with visible=false but are excluded from visible totals and bbox QA.'
  },
  {
    op: 'transform_object',
    description: 'Apply a safe transform to an existing named group or component instance.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, 'translate', 'rotateX', 'rotateY', 'rotateZ', 'axis', 'angle', 'rotate_axis', 'rotateAxis', 'local_axis', 'localAxis', 'local_angle', 'localAngle', 'rotate_local', 'rotateLocal', 'matrix', 'matrix4x4', 'local_matrix', 'localMatrix', 'matrix_local', 'matrixLocal', 'scale', 'mirror', 'pivot'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: "Phase 2 object-editing slice. Prefer target_id for stable references; name remains supported as a compatibility fallback. Supports model-space rotateX/Y/Z, arbitrary model-space axis+angle, local-axis rotations, model-space 4x4 matrices, and local_matrix 4x4 transforms interpreted in the object's current local axes. Matrix snapshots include decomposition metadata for translation, basis axes, scale, shear, determinant, mirrored state, affine/non-affine reasons, homogeneous perspective terms, and Euler XYZ degrees when rotation-compatible."
  },
  {
    op: 'box',
    description: 'Create an axis-aligned cuboid from origin and size.',
    schema: { required: ['op', 'name', 'origin', 'size'], optional: commonPlacement },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Basic primitive used by many higher-level helpers.'
  },
  {
    op: 'rounded_box',
    description: 'Create a rounded-rectangle footprint solid extruded along Z.',
    schema: { required: ['op', 'name', 'origin', 'size', 'radius'], optional: ['segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Product-design helper for softened shells, caps, panels, and compact devices.'
  },
  {
    op: 'beveled_panel',
    description: 'Create a thin rectangular panel with straight chamfered/beveled corners.',
    schema: { required: ['op', 'name', 'origin', 'size', 'bevel'], optional: ['smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Product-design helper for device face plates, recessed panels, and chamfered caps.'
  },
  {
    op: 'fillet',
    description: 'Create a box-like solid with rounded vertical edge fillets from a rounded footprint.',
    schema: { required: ['op', 'name', 'origin', 'size', 'radius'], optional: ['segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Second-phase product edge-treatment helper. This stable slice fillets the XY footprint/vertical edges; arbitrary selected-edge CAD fillets remain out of scope.'
  },
  {
    op: 'chamfer',
    description: 'Create a box-like solid with straight chamfered vertical edges from a beveled footprint.',
    schema: { required: ['op', 'name', 'origin', 'size', 'amount'], optional: ['bevel', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Second-phase product edge-treatment helper. This stable slice chamfers the XY footprint/vertical edges; arbitrary selected-edge CAD chamfers remain out of scope.'
  },
  {
    op: 'recess',
    description: 'Create a visible sunken tray/recess marker with side walls and a bottom face.',
    schema: { required: ['op', 'name', 'center', 'size', 'depth'], optional: ['radius', 'segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Visual recessed detail for product panels; true boolean removal remains a later boolean_cutout capability.'
  },
  {
    op: 'engraved_line',
    description: 'Create a visual engraved groove along one or more straight XY segments.',
    schema: { required: ['op', 'name', 'points', 'width'], optional: ['depth', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Useful for product seams, split lines, decorative grooves, and controller panel outlines.'
  },
  {
    op: 'text_emboss',
    description: 'Create raised text/logo markers on a product surface, with block or font-outline mode.',
    schema: { required: ['op', 'name', 'text', 'height'], optional: ['origin', 'center', 'width', 'depth', 'spacing', 'align', 'mode', 'text_mode', 'outline', 'font', 'bold', 'italic', 'filled', 'extrusion', 'tolerance', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Default mode uses deterministic glyph blocks. mode=font_outline/outline=true calls SketchUp add_3d_text in queue runtime for true font outlines; still not a solid boolean union.'
  },
  {
    op: 'text_engrave',
    description: 'Create recessed text/logo markers on a product surface, with block or font-outline mode.',
    schema: { required: ['op', 'name', 'text', 'height'], optional: ['origin', 'center', 'width', 'depth', 'spacing', 'align', 'mode', 'text_mode', 'outline', 'font', 'bold', 'italic', 'filled', 'extrusion', 'tolerance', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Default mode uses deterministic sunken glyph blocks. mode=font_outline/outline=true calls SketchUp add_3d_text in queue runtime and offsets the outline below the surface; true boolean subtraction remains out of scope.'
  },
  {
    op: 'text_3d',
    description: 'Create real font-outline 3D text using the SketchUp text engine in queue runtime.',
    schema: { required: ['op', 'name', 'text', 'height'], optional: ['origin', 'center', 'font', 'align', 'bold', 'italic', 'filled', 'extrusion', 'depth', 'tolerance', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Queue runtime calls SketchUp Entities#add_3d_text to generate true font outlines. Mock runtime records deterministic text metadata and estimated bounds for offline checks.'
  },
  {
    op: 'slot',
    description: 'Create a visual rounded slot/recess marker.',
    schema: { required: ['op', 'name', 'center', 'length', 'width', 'depth'], optional: ['segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Visual long-hole or speaker/USB slot helper; true boolean cutting remains a later boolean_cutout capability.'
  },
  {
    op: 'slot_array',
    description: 'Create a repeated row of visual rounded slots for speaker grilles, vents, and product perforation markers.',
    schema: { required: ['op', 'name', 'count', 'spacing', 'length', 'width', 'depth'], optional: ['center', 'origin', 'direction', 'segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Safe repetition helper: records one semantic slot-array group in mock and creates deterministic rounded recess geometry in queue; not true perforating boolean cuts.'
  },
  {
    op: 'rib',
    description: 'Create a thin rectangular reinforcing rib for internal product structure.',
    schema: { required: ['op', 'name', 'origin', 'length', 'height', 'thickness'], optional: ['direction', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Structure helper backed by box-like geometry; direction controls whether length runs along X or Y.'
  },
  {
    op: 'standoff_boss',
    description: 'Create a visual screw boss / mounting standoff with an outer post and inner dark hole marker.',
    schema: { required: ['op', 'name', 'center', 'outer_radius', 'inner_radius', 'height'], optional: ['segments', 'hole_material', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Visual mounting-post helper for structured product interiors. The inner hole is represented as a dark cylinder marker, not a true boolean subtraction.'
  },
  {
    op: 'button_on_panel',
    description: 'Create a raised circular or rounded-rectangle button protruding from a panel along +Z.',
    schema: { required: ['op', 'name', 'center', 'height'], optional: ['radius', 'size', 'corner_radius', 'segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Use radius for round buttons; use size plus optional corner_radius for pill or rounded-rectangle buttons.'
  },
  {
    op: 'image_plane',
    description: 'Create a flat reference/image plane with optional material or texture-backed image material.',
    schema: { required: ['op', 'name', 'origin', 'size'], optional: ['plane', 'image', 'texture', 'material', 'alpha', 'texture_transform', ...objectIdentity, 'transform.translate', 'transform.rotateZ'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'First image/reference plane slice. If image/texture is provided, queue attempts to apply it as a material texture; missing files become structured warnings.'
  },
  {
    op: 'prism',
    description: 'Extrude a 2D polygon on xy/xz/yz into a prism.',
    schema: { required: ['op', 'name', 'plane', 'points', 'depth'], optional: commonPlacement },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Best for simple coplanar polygon profiles.'
  },
  {
    op: 'panel_with_openings',
    description: 'Create a rectangular panel with rectangular door/window cutouts.',
    schema: { required: ['op', 'name', 'origin', 'plane', 'size', 'thickness'], optional: ['openings', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Openings use local x/y/width/height coordinates in the panel plane.'
  },
  {
    op: 'boolean_cutout',
    description: 'Create a rectangular slab with one or more rectangular through-cutouts.',
    schema: { required: ['op', 'name', 'origin', 'size', 'cutouts'], optional: ['smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Safe boolean slice for product panels: deterministic rectangular through-holes in an XY slab. Arbitrary solid boolean operations remain out of scope.'
  },
  {
    op: 'face_with_holes',
    description: 'Create a coplanar polygon face with optional polygon hole loops.',
    schema: { required: ['op', 'name', 'origin', 'plane', 'outer'], optional: ['holes', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'First generic profile slice: outer and holes are simple non-self-intersecting 2D loops; holes must be strictly inside and non-overlapping.'
  },
  {
    op: 'profile_extrude',
    description: 'Extrude a polygon 2D profile with optional polygon holes along the profile normal.',
    schema: { required: ['op', 'name', 'origin', 'plane', 'outer', 'depth'], optional: ['holes', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'First generic profile solid slice. It supports simple closed loops with through-holes; self-intersection, touching holes, and arbitrary boolean cleanup remain out of scope.'
  },
  {
    op: 'mesh',
    description: 'Create indexed geometry from vertices and faces.',
    schema: { required: ['op', 'name', 'vertices', 'faces'], optional: ['smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Prefer triangles or coplanar quads; complex topology is intentionally not a full CAD kernel.'
  },
  {
    op: 'gable_roof',
    description: 'Create a symmetric gable roof helper from width, depth, rise, and overhang.',
    schema: { required: ['op', 'name', 'origin', 'width', 'depth', 'rise'], optional: ['overhang', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'High-level architectural helper built from deterministic prism-like geometry.'
  },
  {
    op: 'shed_roof',
    description: 'Create a single-slope shed roof helper.',
    schema: { required: ['op', 'name', 'origin', 'width', 'depth', 'rise'], optional: ['overhang', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Useful for porches, lean-tos, and simple sloped roof masses.'
  },
  {
    op: 'cylinder',
    description: 'Create a segmented circular solid.',
    schema: { required: ['op', 'name', 'origin', 'radius', 'height'], optional: ['segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Use segments and smooth=all to tune round-looking geometry.'
  },
  {
    op: 'loft_between_profiles',
    description: 'Create a mesh loft through multiple matching 2D/3D profile sections.',
    schema: { required: ['op', 'name', 'profiles'], optional: ['smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Product/body helper for grips and organic shells. Each profile must have the same point count; use object sections with origin/plane/points or direct 3D point arrays.'
  },
  {
    op: 'shell_from_front_side_profiles',
    description: 'Create a symmetric product shell from a front silhouette and side depth profile.',
    schema: { required: ['op', 'name', 'origin', 'front_profile', 'side_profile'], optional: ['smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Hard-shape product helper for handles and controller bodies. Front profile is a closed [x,z] silhouette; side profile maps z to half-depth. Visual QA is recommended for silhouette point order and proportions.'
  },
  {
    op: 'lofted_solid',
    description: 'Create a Z-axis solid of revolution from height/radius profile points.',
    schema: { required: ['op', 'name', 'origin', 'profile'], optional: ['segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Good for posts, knobs, bottles, and baluster-like rotational forms.'
  },
  {
    op: 'face_on_cylinder',
    description: 'Create a flat raised visual face/button pad tangent to a cylinder surface.',
    schema: { required: ['op', 'name', 'center', 'cylinder_radius', 'width', 'height'], optional: ['cylinder_center', 'angle', 'depth', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Visual product helper for flat button/contact patches on round handles or cylindrical housings; not a boolean projection or conformal wrap.'
  },
  {
    op: 'analog_stick',
    description: 'Create a controller analog stick from a default or custom radial profile.',
    schema: { required: ['op', 'name', 'origin'], optional: ['height', 'shaft_height', 'base_radius', 'shaft_radius', 'cap_radius', 'top_radius', 'profile', 'segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Product-design helper for gamepad/controller sticks; accepts profile to override the default shaft/cap silhouette.'
  },
  {
    op: 'screw_hole',
    description: 'Create a visual circular screw hole or countersunk recess marker along Z.',
    schema: { required: ['op', 'name', 'center', 'radius'], optional: ['depth', 'head_radius', 'head_depth', 'segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Visual/product-detail helper; true solid boolean cutting remains a later boolean_cutout/recess capability.'
  },
  {
    op: 'pipe_between_points',
    description: 'Create a circular pipe along arbitrary 3D points with a local perpendicular frame.',
    schema: { required: ['op', 'name', 'points', 'radius'], optional: ['path', 'start', 'end', 'segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Product/industrial helper for rods, tubes, shoulder rails, cables, and diagonal/Y-oriented pipes; supersedes swept_path for arbitrary 3D directions.'
  },
  {
    op: 'swept_path',
    description: 'Sweep a circular tube along a polyline path.',
    schema: { required: ['op', 'name', 'path', 'radius'], optional: ['segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Legacy MVP frame is most reliable for rail/pipe paths primarily running along X; prefer pipe_between_points for arbitrary directions.'
  },
  {
    op: 'domed_surface',
    description: 'Create a crowned rectangular slab with configurable surface resolution.',
    schema: { required: ['op', 'name', 'origin', 'width', 'depth', 'thickness', 'crown_height'], optional: ['segments_x', 'segments_y', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Records resolution hints in snapshots for QA and LOD review.'
  },
  {
    op: 'bowed_panel',
    description: 'Create a thick panel bowed along +Y.',
    schema: { required: ['op', 'name', 'origin', 'width', 'height', 'thickness', 'bow_depth'], optional: ['segments_x', 'segments_z', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Useful for curved walls, backrests, bowed doors, and barrel-vault-like panels.'
  },
  {
    op: 'level',
    description: 'Record named floor metadata such as elevation and optional height.',
    schema: { required: ['op', 'name', 'elevation'], optional: ['height'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    notes: 'Metadata only; snapshots expose levels separately from geometry groups.'
  },
  {
    op: 'floor_slab',
    description: 'Create a rectangular slab from origin, width, depth, and thickness.',
    schema: { required: ['op', 'name', 'origin', 'width', 'depth'], optional: ['thickness', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Architectural helper equivalent to a named slab box.'
  },
  {
    op: 'wall',
    description: 'Create an axis-aligned wall segment with optional rectangular openings.',
    schema: { required: ['op', 'name', 'start', 'end', 'height'], optional: ['thickness', 'openings', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Current MVP supports axis-aligned walls only.'
  },
  {
    op: 'door',
    description: 'Create a simple vertical door infill marker.',
    schema: { required: ['op', 'name', 'origin', 'width', 'height'], optional: ['plane', 'thickness', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Door objects are marker geometry, not a full parametric door family.'
  },
  {
    op: 'window',
    description: 'Create a simple vertical window infill marker.',
    schema: { required: ['op', 'name', 'origin', 'width', 'height'], optional: ['plane', 'thickness', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Window objects are marker geometry, not a full parametric window family.'
  },
  {
    op: 'stairs',
    description: 'Create stepped box geometry from step count, tread depth, and riser height.',
    schema: { required: ['op', 'name', 'origin', 'steps', 'width', 'tread_depth', 'riser_height'], optional: ['direction', 'material'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Straight stair runs only; complex stair families are out of scope for this phase.'
  },
  {
    op: 'railing',
    description: 'Create a swept top rail plus evenly spaced cylindrical posts along a path.',
    schema: { required: ['op', 'name', 'path'], optional: ['height', 'rail_radius', 'post_radius', 'post_spacing', 'smooth', 'material'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Top rail now uses pipe_between_points for stable arbitrary-direction frame parity; post spacing remains intentionally simple in this baseline.'
  },
  {
    op: 'component_definition',
    description: 'Define a reusable component from a simple size box or nested operations.',
    schema: { required: ['op', 'name'], optional: ['size', 'operations', 'material'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Nested operations intentionally reject global/session operations such as reset and camera.'
  },
  {
    op: 'component_instance',
    description: 'Place an instance of a previously defined component.',
    schema: { required: ['op', 'name', 'definition', 'origin'], optional: ['transform', ...objectIdentity] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Supports translate/rotateZ transforms in the current DSL baseline.'
  },
  {
    op: 'camera',
    description: 'Set the current saved model view state.',
    schema: { required: ['op', 'eye', 'target', 'up'], optional: ['fov'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    notes: 'Snapshots expose the resulting view_state.'
  },
  {
    op: 'scene',
    description: 'Store a named camera view as a scene.',
    schema: { required: ['op', 'name', 'camera'], optional: [] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    notes: 'Scene camera shape follows the camera operation fields.'
  },
  {
    op: 'style',
    description: 'Apply common visual style fields such as edges, profiles, face style, and background colors.',
    schema: { required: ['op'], optional: ['name', 'display_edges', 'profiles', 'profile_width', 'display_watermarks', 'face_style', 'background_color', 'sky_color', 'ground_color'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.beta,
    notes: 'Queue support depends on SketchUp version-specific style/rendering keys.'
  },
  {
    op: 'shadow',
    description: 'Apply shadow display, time, light/dark, and sun shading settings.',
    schema: { required: ['op'], optional: ['display', 'time', 'light', 'dark', 'use_sun_for_shading'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.beta,
    notes: 'Time is normalized in mock snapshots; queue applies available ShadowInfo keys.'
  },
  {
    op: 'rendering_options',
    description: 'Apply selected SketchUp rendering options by safe DSL keys.',
    schema: { required: ['op'], optional: ['edge_display_mode', 'draw_hidden_geometry', 'display_color_by_layer', 'transparency', 'draw_back_edges', 'draw_ground'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.beta,
    notes: 'Unsupported queue keys should warn instead of failing the build.'
  },
  {
    op: 'room',
    description: 'Create the deterministic demo room helper used by smoke tests and examples.',
    schema: { required: ['op', 'name', 'width', 'depth', 'height'], optional: [] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    notes: 'Convenience helper, not intended as a generic room/floor-plan generator.'
  }
];

export const OPERATION_REGISTRY = Object.freeze(Object.fromEntries(
  OPERATION_REGISTRY_ENTRIES.map((capability) => {
    const normalized = normalizeOperationCapability(capability);
    return [normalized.op, Object.freeze(normalized)];
  })
));

export const OPERATION_CAPABILITIES = Object.freeze(Object.values(OPERATION_REGISTRY));

export const CORE_DSL_OPERATIONS = Object.freeze(OPERATION_CAPABILITIES.map((capability) => capability.op));

export function getOperationManifest() {
  return clone(OPERATION_CAPABILITIES);
}

export function getOperationNames() {
  return CORE_DSL_OPERATIONS.slice();
}

export function getComponentDefinitionOperationNames() {
  return OPERATION_CAPABILITIES
    .filter((capability) => capability.component_scope.status === SUPPORT_STATUS.supported)
    .map((capability) => capability.op);
}

export function getRuntimeCapabilities(runtime = 'mock') {
  if (!['mock', 'queue'].includes(runtime)) {
    throw new Error(`Unknown runtime: ${runtime}`);
  }

  return {
    name: runtime,
    version: runtime === 'mock' ? 'mock-runtime-0.1.0' : 'queue-runtime-0.1.0',
    capability_version: RUNTIME_CAPABILITY_VERSION,
    manifest_version: CAPABILITY_MANIFEST_VERSION,
    dsl_version: DSL_VERSION,
    supported_operations: OPERATION_CAPABILITIES
      .filter((capability) => isRuntimeSupported(capability.runtime_support[runtime]))
      .map((capability) => capability.op),
    operation_support: Object.fromEntries(
      OPERATION_CAPABILITIES
        .filter((capability) => isRuntimeSupported(capability.runtime_support[runtime]))
        .map((capability) => [
          capability.op,
          {
            status: capability.runtime_support[runtime],
            stability: capability.stability,
            schema: clone(capability.schema),
            component_scope: clone(capability.component_scope)
          }
        ])
    ),
    notes: runtime === 'mock'
      ? 'Deterministic offline runtime for tests, snapshots, and Alma iteration.'
      : 'Bridge-declared queue capabilities; actual execution depends on the installed SketchUp Ruby plugin version.'
  };
}

export function formatCapabilityMatrixMarkdown() {
  const rows = OPERATION_CAPABILITIES.map((capability) => {
    const required = capability.schema.required.length > 0 ? capability.schema.required.join(', ') : '-';
    const optional = capability.schema.optional.length > 0 ? capability.schema.optional.join(', ') : '-';
    const componentScope = capability.component_scope.status;
    return `| \`${capability.op}\` | ${capability.description} | ${required} | ${optional} | ${capability.runtime_support.mock} | ${capability.runtime_support.queue} | ${componentScope} | ${capability.stability} | ${capability.notes} |`;
  });

  return [
    '## Capability Manifest Matrix',
    '',
    `Manifest version: \`${CAPABILITY_MANIFEST_VERSION}\`; DSL version: \`${DSL_VERSION}\`; runtime capability version: \`${RUNTIME_CAPABILITY_VERSION}\`.`,
    '',
    '| Operation | Description | Required fields | Optional fields | Mock | Queue | Component definition | Stability | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows
  ].join('\n');
}

function normalizeOperationCapability({ component_definition = false, ...capability }) {
  return {
    ...capability,
    schema: normalizeSchema(capability),
    component_scope: {
      status: component_definition ? SUPPORT_STATUS.supported : SUPPORT_STATUS.unsupported
    }
  };
}

function normalizeSchema(capability) {
  return {
    required: [...(capability.schema?.required || [])],
    optional: [...(capability.schema?.optional || [])]
  };
}

function isRuntimeSupported(status) {
  return status !== undefined && status !== SUPPORT_STATUS.unsupported;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
