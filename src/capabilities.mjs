import { PRODUCT_VERSION } from './version.mjs';
import {
  DEFAULT_STRUCTURAL_GROUP_LIMIT,
  MAX_FRESH_MANIFOLD_PATHS,
  MAX_STRUCTURAL_GROUP_LIMIT,
  STRUCTURAL_GROUPS_VERSION
} from './model-adoption.mjs';
import { BOOLEAN_OPERATIONS_SHA256, MODEL_REVISION_SOURCE_SHA256 } from './runtime-source-attestation.mjs';

export const DSL_VERSION = 1;
export const CAPABILITY_MANIFEST_VERSION = '2026-09-modeling-uplift-alpha.1';
export const RUNTIME_CAPABILITY_VERSION = '0.3.0-modeling-alpha.1';
export const OCCURRENCE_CONTRACT_VERSION = 'canonical-occurrence-path.v1';
export const QUEUE_MODEL_REVISION_STRATEGY = 'definition-merkle.v2';
export const QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT = 1_000_000;

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
const nestedObjectTarget = ['entity_path', 'entityPath', 'target_path', 'targetPath', 'edit_scope', 'editScope', 'instance_policy', 'instancePolicy', 'instance_id', 'instanceId'];
const commonPlacement = [...objectIdentity, 'material', 'transform.translate', 'transform.rotateZ', 'texture_transform'];

const OPERATION_REGISTRY_ENTRIES = [
  ...[['sweep_profile',['name','profile','path']],['loft_profiles_v2',['name','profiles']]].map(([op,required])=>({op,description:'Bounded general profile geometry, expanded once into the shared mesh representation.',schema:{required:['op',...required],optional:['id','material','transform','caps','max_vertices','sample_budget','seam_indices','initial_up','scale_stations','twist_stations']},runtime_support:{mock:SUPPORT_STATUS.supported,queue:SUPPORT_STATUS.supported},stability:STABILITY.experimental,component_definition:true,notes:'Single simple ring; no holes or branching. Self-intersection and compute budgets fail closed.'})),
  {op:'edit_geometry',description:'Reviewed revision-bound local topology batch in one instance context.',schema:{required:['op','entity_path','snapshot_revision','edits'],optional:['instance_policy','edit_scope','context_path']},runtime_support:{mock:SUPPORT_STATUS.partial,queue:SUPPORT_STATUS.supported},stability:STABILITY.experimental},
  ...['place_component_asset', 'replace_component_asset'].map(op => ({
    op,
    description: 'Load a SHA-bound native SKP root and place it or replace exactly one existing root instance in the reviewed atomic transaction.',
    schema: { required: ['op', 'source_path', 'source_sha256', 'source', 'license', 'origin', 'rotateZ', 'confirmed', ...(op === 'place_component_asset' ? ['id', 'name'] : [])], optional: op === 'replace_component_asset' ? ['entity_path', 'target_id', 'edit_scope', 'instance_policy'] : [] },
    runtime_support: { mock: SUPPORT_STATUS.unsupported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Reviewed-only; not allowed through additive create_model. Native source SHA is checked before/after load and placement. No explode, delete, scale or source writes; replacement preserves root identity and exact transform. Mock cannot attest SKP geometry.'
  })),
  ...[
    ['section_plane', ['name', 'origin', 'normal'], ['id', 'activate']],
    ['section_plane_activate', ['section_ref'], []],
    ['environment_define', ['name', 'path'], ['id', 'description', 'rotation', 'skydome_exposure', 'reflection_exposure', 'use_as_skydome', 'use_for_reflections', 'linked_sun', 'linked_sun_position']],
    ['environment_update', ['environment_ref'], ['description', 'rotation', 'skydome_exposure', 'reflection_exposure', 'use_as_skydome', 'use_for_reflections', 'linked_sun', 'linked_sun_position']],
    ['environment_activate', ['environment_ref'], []],
    ['style_load', ['name', 'path'], ['activate', 'capture_current_display']],
    ['style_activate', ['style_ref'], []]
  ].map(([op, required, optional]) => ({
    op, description: `Apply native SketchUp appearance operation ${op}.`,
    schema: { required: ['op', ...required], optional },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.experimental,
    notes: 'Native environment requires SketchUp 2025+; complete restoration requires 2025.0.2+. Only measured runtime results establish support.'
  })),
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
    schema: { required: ['op', 'name'], optional: ['color', 'alpha', 'texture', 'workflow', 'pbr', 'skm_path'] },
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
    description: 'Assign an existing or implicit tag to a top-level or nested group/component instance.',
    schema: { required: ['op', 'tag'], optional: ['name', 'tag_name', 'tagName', ...objectTarget, ...nestedObjectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Targets the same stable id/name reference path used by editing operations.'
  },
  {
    op: 'attribute',
    description: 'Write structured metadata onto a stable Group, ComponentInstance, Face, or Edge target.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'dictionary', 'namespace', 'key', 'attr_key', 'attrKey', 'value', 'attributes'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Stores JSON-compatible values under a SketchUp attribute dictionary and returns them in snapshots.'
  },
  {
    op: 'remove_attribute',
    description: 'Remove one attribute key or a non-protected attribute dictionary from a stable entity target.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'dictionary', 'namespace', 'key', 'attr_key', 'attrKey'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Special SketchUp dictionaries remain protected by the host API; failures are fail-closed.'
  },
  {
    op: 'classification',
    description: 'Attach BIM/classification metadata to a stable Group or ComponentInstance target.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'system', 'schema', 'type', 'classification', 'class', 'ifc_class', 'ifcClass', 'identifier', 'attributes'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Stores a normalized classification snapshot and mirrors fields to a SketchUp Classification attribute dictionary.'
  },
  {
    op: 'texture_transform',
    description: 'Apply and read back native face texture placement on explicitly selected direct faces.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'material', 'projection', 'offset', 'offset_u', 'offsetU', 'offset_v', 'offsetV', 'scale', 'scale_u', 'scaleU', 'scale_v', 'scaleV', 'rotation', 'rotation_degrees', 'rotationDegrees', 'texture_size_mm', 'side', 'face_selector'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Queue positions real direct-face UVs and verifies native getters. Positive scale controls repeats; texture_size_mm controls physical tile dimensions; planar uses a stable face basis and box requires axis-aligned faces. Does not descend into shared child components. Mock retains requested mapping only.'
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
    op: 'face_uv',
    description: 'Attach and, when enough face data exists, apply per-face UV coordinate mapping to a top-level group or component instance.',
    schema: { required: ['op', 'uv'], optional: ['name', ...objectTarget, 'uv_id', 'uvId', 'face', 'face_id', 'face_selector', 'faceSelector', 'projection', 'material', 'image_reference', 'imageReference', 'image', 'mapping'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'API-parity texture slice: snapshots expose normalized per-face UV intent. Queue persists metadata and attempts Face#position_material for selected faces; unsupported mappings warn instead of failing.'
  },
  {
    op: 'image_reference',
    description: 'Register an image asset for reference, texture, or reporting workflows without creating geometry.',
    schema: { required: ['op', 'name', 'path'], optional: ['file', 'filename', 'image', 'width', 'height', 'scale', 'role', 'source', 'metadata'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Complements image_plane and material textures by tracking reusable image assets in snapshots/build reports.'
  },
  {
    op: 'delete',
    description: 'Delete an existing named group or component instance from the current model session.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'confirmed'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Phase 2 editing operation. Names must be unique enough to identify a top-level group or instance.'
  },
  {
    op: 'rename',
    description: 'Rename an existing named group or component instance.',
    schema: { required: ['op', 'new_name'], optional: ['name', ...objectTarget, ...nestedObjectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Fails if the target does not exist or the new name is already present in mock.'
  },
  {
    op: 'set_material',
    description: 'Assign a material to an existing named group or component instance.',
    schema: { required: ['op', 'material'], optional: ['name', ...objectTarget, ...nestedObjectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Creates the material if needed and applies it to the target object faces in queue.'
  },
  {
    op: 'set_visibility',
    description: 'Show or hide an existing named group or component instance.',
    schema: { required: ['op', 'visible'], optional: ['name', 'hidden', ...objectTarget, ...nestedObjectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Hidden objects remain listed in snapshots with visible=false but are excluded from visible totals and bbox QA.'
  },
  {
    op: 'transform_object',
    description: 'Apply a safe transform to an existing named group or component instance.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'translate', 'rotateX', 'rotateY', 'rotateZ', 'axis', 'angle', 'rotate_axis', 'rotateAxis', 'local_axis', 'localAxis', 'local_angle', 'localAngle', 'rotate_local', 'rotateLocal', 'matrix', 'matrix4x4', 'local_matrix', 'localMatrix', 'matrix_local', 'matrixLocal', 'scale', 'mirror', 'pivot'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: "Phase 2 object-editing slice. Prefer target_id for stable references; name remains supported as a compatibility fallback. Supports model-space rotateX/Y/Z, arbitrary model-space axis+angle, local-axis rotations, model-space 4x4 matrices, and local_matrix 4x4 transforms interpreted in the object's current local axes. Matrix snapshots include decomposition metadata for translation, basis axes, scale, shear, determinant, mirrored state, affine/non-affine reasons, homogeneous perspective terms, and Euler XYZ degrees when rotation-compatible."
  },
  {
    op: 'set_face_material',
    description: 'Assign front, back, or both materials to a Face addressed by persistent instance path.',
    schema: { required: ['op', 'material'], optional: [...nestedObjectTarget, 'side'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Only accepts Face targets; side defaults to front.'
  },
  {
    op: 'set_edge_properties',
    description: 'Set soft, smooth, and visibility properties on an Edge addressed by persistent instance path.',
    schema: { required: ['op'], optional: [...nestedObjectTarget, 'soft', 'smooth', 'visible', 'hidden'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Does not move or erase the Edge.'
  },
  {
    op: 'reverse_face',
    description: 'Reverse a Face orientation after explicit review.',
    schema: { required: ['op', 'confirmed'], optional: [...nestedObjectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Requires confirmed=true because face orientation affects solids and rendering.'
  },
  {
    op: 'pushpull_face',
    description: 'Push/pull a Face by a signed millimeter distance after topology review.',
    schema: { required: ['op', 'distance', 'confirmed'], optional: [...nestedObjectTarget, 'copy'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Requires a stable Face occurrence path and confirmed=true.'
  },
  {
    op: 'duplicate_entity',
    description: 'Duplicate a Group or ComponentInstance within its current entity collection.',
    schema: { required: ['op', 'new_id', 'new_name'], optional: [...objectTarget, ...nestedObjectTarget, 'translate'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'The duplicate remains in the same parent context and must use unique id/name values.'
  },
  {
    op: 'replace_component_definition',
    description: 'Replace the definition used by a ComponentInstance after explicit review.',
    schema: { required: ['op', 'definition', 'confirmed'], optional: [...objectTarget, ...nestedObjectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Rejects non-instance targets and missing definitions.'
  },
  {
    op: 'explode_entity',
    description: 'Explode a Group or ComponentInstance in place after explicit destructive confirmation.',
    schema: { required: ['op', 'confirmed'], optional: [...objectTarget, ...nestedObjectTarget] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Destructive operation; always requires review and a transaction checkpoint.'
  },
  {
    op: 'erase_entities',
    description: 'Erase a reviewed collection of persistent entity targets atomically.',
    schema: { required: ['op', 'targets', 'confirmed'], optional: ['edit_scope', 'instance_policy', 'instance_id', 'max_affected'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Rejects empty targets and operations exceeding max_affected.'
  },
  {
    op: 'transform_entities',
    description: 'Apply one translation to a reviewed collection of Group/Instance/Face/Edge targets atomically.',
    schema: { required: ['op', 'targets', 'translate', 'confirmed'], optional: ['edit_scope', 'instance_policy', 'instance_id', 'max_affected'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Collection transforms require explicit topology review for Face/Edge targets.'
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
    op: 'cut_hole',
    description: 'Cut a controlled circular feature into an existing target face.',
    schema: { required: ['op', 'center', 'radius'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'face', 'plane', 'feature_id', 'featureId', 'depth', 'through', 'segments'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Phase 7 face-feature slice. Targets existing box/rounded_box/panel/floor_slab/wall groups by target_id or name, records feature metadata, and queue runtime uses SketchUp face pushpull on the selected planar face.'
  },
  {
    op: 'cut_slot',
    description: 'Cut a controlled rounded slot feature into an existing target face.',
    schema: { required: ['op', 'center', 'length', 'width'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'face', 'plane', 'feature_id', 'featureId', 'depth', 'through', 'segments'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Phase 7 face-feature slice for elongated holes/vents. The first implementation covers planar target faces and uses target-local face coordinates.'
  },
  {
    op: 'cut_recess',
    description: 'Cut a controlled blind recess into an existing target face.',
    schema: { required: ['op', 'center', 'size', 'depth'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'face', 'plane', 'feature_id', 'featureId', 'radius', 'segments'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Phase 7 blind face feature. Use for shallow trays, depressed button pockets, panel wells, and other non-through concave details.'
  },
  {
    op: 'add_boss',
    description: 'Raise a controlled cylindrical boss from an existing target face.',
    schema: { required: ['op', 'center', 'radius', 'height'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'face', 'plane', 'feature_id', 'featureId', 'outer_radius', 'outerRadius', 'segments'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Phase 7 additive face feature. It creates a boss in the target group rather than a separate marker object; complex hollow bosses remain a later CAD slice.'
  },
  {
    op: 'add_raised_rib',
    description: 'Raise a controlled rectangular rib from an existing target face.',
    schema: { required: ['op', 'center', 'length', 'height'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'face', 'plane', 'feature_id', 'featureId', 'width', 'thickness', 'direction'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Phase 7 additive face feature for ribs, roof lines, seams, and stiffeners. direction=u/v selects the target face local axis.'
  },
  {
    op: 'boolean_union',
    description: 'Union an existing target solid with one or more tool solids.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'tools', 'tool_id', 'toolId', 'tool_ids', 'toolIds', 'result_name', 'resultName', 'result_id', 'resultId', 'keep_tools', 'keepTools', 'keep_originals', 'keepOriginals', 'allow_disjoint', 'allowDisjoint', 'material'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Phase 7 CAD boolean slice. Queue runtime uses SketchUp solid operations when available; mock runtime records deterministic boolean/manifold metadata for offline regression.'
  },
  {
    op: 'boolean_difference',
    description: 'Subtract one or more tool solids from an existing target solid.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'tools', 'tool_id', 'toolId', 'tool_ids', 'toolIds', 'result_name', 'resultName', 'result_id', 'resultId', 'keep_tools', 'keepTools', 'keep_originals', 'keepOriginals', 'allow_non_intersecting', 'allowNonIntersecting', 'material'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Use for through cuts, pockets, and subtractive product tooling once cutter solids are modeled explicitly. Inputs must be manifold solids.'
  },
  {
    op: 'boolean_intersect',
    description: 'Keep the positive-volume intersection of an existing target solid and one or more tool solids.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'tools', 'tool_id', 'toolId', 'tool_ids', 'toolIds', 'result_name', 'resultName', 'result_id', 'resultId', 'keep_tools', 'keepTools', 'keep_originals', 'keepOriginals', 'material'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Use for clipping, trimming, and validating overlapping product volumes. Fails when the target/tools do not have a positive-volume intersection.'
  },
  {
    op: 'manifold_check',
    description: 'Check one or more solids for manifold/solid validity and record the report in the snapshot.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'targets', 'target_ids', 'targetIds', 'check_id', 'checkId', 'fail_on_non_manifold', 'failOnNonManifold'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Queue runtime uses SketchUp manifold/volume APIs plus edge fallback; mock runtime uses deterministic topology heuristics. Reports are returned under snapshot.manifold_checks and per-object manifold.'
  },
  {
    op: 'manifold_repair',
    description: 'Attempt to repair a target solid and record before/after manifold reports.',
    schema: { required: ['op'], optional: ['name', ...objectTarget, ...nestedObjectTarget, 'strategy', 'repair_id', 'repairId', 'fail_on_non_manifold', 'failOnNonManifold'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.experimental,
    notes: 'Best-effort cleanup for SketchUp solids: queue runtime runs face-finding/edge cleanup, while mock supports cleanup metadata and seal_bbox fallback for deterministic tests.'
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
    schema: { required: ['op', 'name', 'vertices', 'faces'], optional: ['back_material', 'f_material', 'b_material', 'smooth', 'construction', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Prefer triangles or coplanar quads; also backs Entities.add_faces_from_mesh/fill_from_mesh facade output. Complex topology is intentionally not a full CAD kernel.'
  },
  {
    op: 'geometry_input',
    description: 'Create generic indexed geometry from vertices, explicit edges, and faces with outer loops plus optional holes.',
    schema: { required: ['op', 'name', 'vertices'], optional: ['faces', 'edges', 'material', 'smooth', 'faces[].pushpull', 'faces[].followme', 'faces[].position_material', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'SketchUp API parity slice for GeometryInput/LoopInput-style data. Faces can carry real pushpull, controlled followme, and positioned-material intent.'
  },
  {
    op: 'curve',
    description: 'Create a named SketchUp-style curve/polyline from ordered 3D points.',
    schema: { required: ['op', 'name', 'points'], optional: ['vertices', 'closed', 'material', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Legitimate zero-face edge geometry. Snapshots keep it as kind=curve without raising degenerate-geometry warnings.'
  },
  {
    op: 'arc_curve',
    description: 'Create an arc curve from center, radius, plane, start/end angles, and segment count.',
    schema: { required: ['op', 'name', 'center', 'radius'], optional: ['start_angle', 'startAngle', 'end_angle', 'endAngle', 'plane', 'segments', 'chord_tolerance_mm', 'max_segments', 'material', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'SketchUp ArcCurve-style slice represented as a named curve with arc metadata in mock snapshots.'
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
    schema: { required: ['op', 'name', 'origin', 'radius', 'height'], optional: ['segments', 'chord_tolerance_mm', 'max_segments', 'smooth', ...commonPlacement] },
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
    schema: { required: ['op', 'name', 'radius'], optional: ['points', 'path', 'start', 'end', 'segments', 'chord_tolerance_mm', 'max_segments', 'smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Product/industrial helper for rods, tubes, shoulder rails, cables, and diagonal/Y-oriented pipes; supersedes swept_path for arbitrary 3D directions.'
  },
  {
    op: 'swept_path',
    description: 'Sweep a circular tube along a polyline path.',
    schema: { required: ['op', 'name', 'path', 'radius'], optional: ['segments', 'chord_tolerance_mm', 'max_segments', 'smooth', ...commonPlacement] },
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
    op: 'footprint_slab',
    description: 'Create a horizontal slab from a simple XY polygon footprint with optional courtyard/light-well holes.',
    schema: { required: ['op', 'name', 'points', 'thickness'], optional: ['origin', 'holes', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'R2 building geometry slice. Points are relative to origin and implicitly closed. Holes are simple polygons inside the outer footprint; nested, crossing, duplicate-point, zero-area, and self-intersecting loops are rejected.'
  },
  {
    op: 'wall',
    description: 'Create a wall segment from a centerline, including axis-aligned openings and segment-local openings on non-axis-aligned walls.',
    schema: { required: ['op', 'name', 'start', 'end', 'height'], optional: ['thickness', 'openings', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    component_definition: true,
    notes: 'Axis-aligned walls keep rectangular panel openings. Non-axis-aligned openings use offset/width/height/sill_height along the centerline; complex sloped/arched opening families remain out of scope.'
  },
  {
    op: 'wall_path',
    description: 'Create a single polyline wall mesh from multiple centerline points.',
    schema: { required: ['op', 'name', 'path', 'height'], optional: ['thickness', 'openings', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Each path segment is expanded into a simple butt-joined wall body. Openings specify segment_index, offset, width, height, and sill_height. Mitering and boolean merge remain out of scope.'
  },
  {
    op: 'curved_wall',
    description: 'Create an arc wall by tessellating a circular centerline into wall segments.',
    schema: { required: ['op', 'name', 'center', 'radius', 'start_angle', 'end_angle', 'height'], optional: ['thickness', 'segments', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Approximation helper for curved building walls. Uses straight butt-joined wall segments and intentionally rejects openings in this R2 slice.'
  },
  {
    op: 'roof_footprint',
    description: 'Create a flat or shed-style roof from an arbitrary simple footprint.',
    schema: { required: ['op', 'name', 'points'], optional: ['origin', 'holes', 'elevation', 'thickness', 'rise', 'slope_direction', 'overhang', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Building roof helper for non-rectangular plans. Mock records footprint/hole topology and slope metadata; queue uses a minimal footprint extrusion path.'
  },
  {
    op: 'hip_roof',
    description: 'Create a simple rectangular hip roof.',
    schema: { required: ['op', 'name', 'origin', 'width', 'depth', 'rise'], optional: ['thickness', 'overhang', 'ridge_ratio', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Complements gable_roof and shed_roof for fast building massing. Rectangular footprint only in R2.'
  },
  {
    op: 'parapet_path',
    description: 'Create a low parapet wall along a path or footprint outline.',
    schema: { required: ['op', 'name'], optional: ['path', 'points', 'origin', 'closed', 'height', 'thickness', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Uses the same centerline expansion as wall_path, with explicit closed path support for roof edges and site perimeters.'
  },
  {
    op: 'curtain_wall',
    description: 'Create a lightweight curtain-wall strip along a line or polyline.',
    schema: { required: ['op', 'name', 'height'], optional: ['path', 'start', 'end', 'module_width', 'mullion_width', 'row_count', 'thickness', 'panel_thickness', 'frame_material', 'panel_material', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'R3 quality slice generates module-based vertical mullions, horizontal rails, and panel cells as one top-level curtain wall group. Complex mullion profiles and true glass/frame material separation remain out of scope.'
  },
  {
    op: 'column_grid',
    description: 'Create a group of rectangular or round columns from explicit points or a grid definition.',
    schema: { required: ['op', 'name', 'height'], optional: ['origin', 'points', 'x_count', 'y_count', 'spacing', 'shape', 'column_size', 'radius', 'segments', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Fast structural/grid massing helper. Explicit points override origin/x_count/y_count/spacing grid generation.'
  },
  {
    op: 'path_surface',
    description: 'Create a horizontal ribbon surface for roads, sidewalks, and paved paths.',
    schema: { required: ['op', 'name', 'path', 'width'], optional: ['thickness', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Each path segment is expanded into a simple butt-joined horizontal ribbon. It does not drape onto terrain in R2.'
  },
  {
    op: 'terrain_mesh',
    description: 'Create a semantic terrain mesh wrapper from vertices and faces.',
    schema: { required: ['op', 'name', 'vertices', 'faces'], optional: ['smooth', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Reuses mesh geometry but returns kind=terrain_mesh for scene/QA semantics. Queue support is partial because terrain smoothing/material behavior is minimal.'
  },
  {
    op: 'parking_stall_array',
    description: 'Create repeated parking stall line markings for site scale anchors.',
    schema: { required: ['op', 'name', 'origin', 'count', 'stall_width', 'stall_depth'], optional: ['line_width', 'line_height', 'direction', ...commonPlacement] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.partial },
    stability: STABILITY.beta,
    component_definition: true,
    notes: 'Purpose-built scale/context helper for building-photo and site examples. Queue uses simple thin solids for markings in this slice.'
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
    schema: { required: ['op', 'name', 'path'], optional: ['height', 'rail_radius', 'post_radius', 'post_spacing', 'segments', 'chord_tolerance_mm', 'max_segments', 'smooth', 'material'] },
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
    component_definition: true,
    notes: 'Root and nested instances support transform.mirror as x/y/z or an array of distinct axes. Placement applies local reflection (negative scale), then rotateZ, then origin plus translate/translation. Mirror is supported by component placement only, not by every primitive commonPlacement transform.'
  },
  {
    op: 'selection',
    description: 'Set, add to, remove from, or clear the active runtime selection by stable object references.',
    schema: { required: ['op', 'mode'], optional: ['targets'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.beta,
    notes: 'Official-style Selection facade bridge for build batches; targets use the same id/name reference shape as editing operations.'
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
    description: 'Store a named camera view and selected Page properties as a scene.',
    schema: { required: ['op', 'name'], optional: ['camera', 'transition_time', 'transitionTime', 'use_camera', 'useCamera', 'layer_visibility', 'layerVisibility', 'drawingelement_visibility', 'drawingElementVisibility', 'rendering_options', 'renderingOptions', 'shadow', 'shadow_info', 'shadowInfo', 'style', 'update_flags', 'updateFlags', 'environment_ref', 'use_environment', 'style_ref'] },
    runtime_support: { mock: SUPPORT_STATUS.supported, queue: SUPPORT_STATUS.supported },
    stability: STABILITY.stable,
    notes: 'Scene camera shape follows camera fields. R3 adds Page transition time, saved layer/object visibility, and per-page rendering/shadow/style intent where SketchUp exposes setters.'
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
    version: runtime === 'mock' ? `mock-runtime-${PRODUCT_VERSION}` : `queue-runtime-${PRODUCT_VERSION}`,
    capability_version: RUNTIME_CAPABILITY_VERSION,
    manifest_version: CAPABILITY_MANIFEST_VERSION,
    dsl_version: DSL_VERSION,
    occurrence_contract: OCCURRENCE_CONTRACT_VERSION,
    creation_scope: { version: 'creation-scope.v1', atomic_absence_validation: true },
    saved_model_lifecycle: { version: 'saved-model-lifecycle.v1', close_reopen_saved_model: runtime === 'queue', platform: 'macOS',
      requires_verified_saved_receipt: true, close_ignore_changes: false, application_restart: false, installed_runtime_verification_required: runtime === 'queue' },
    detail_geometry: { version: 'native-geometry-evidence.v2', nested_occurrences: true, measured: runtime === 'queue', context_void_queries: runtime === 'queue', resource_totals: runtime === 'queue', resource_scope: 'all_native_stored_geometry' },
    ...(runtime === 'queue' ? {
      boolean_operations_sha256: BOOLEAN_OPERATIONS_SHA256,
      model_revision_source_sha256: MODEL_REVISION_SOURCE_SHA256,
      model_revision: {
        strategy: QUEUE_MODEL_REVISION_STRATEGY,
        unique_entity_limit: QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
        logical_occurrence_count: 'complete_definition_graph_expansion'
      }
    } : {}),
    scoped_recursive_adoption: { version: 'scoped-recursive-roots.v1', max_roots: 32, requires_read_only: true, whole_model_revision: true },
    detail_pair_separation: { version: 'native_leaf_separation.v1', read_only: true, numerical_tolerance_mm: 0.000001, max_leaf_pairs: 100000 },
    read_only_probes: {
      structural_groups: {
        version: STRUCTURAL_GROUPS_VERSION,
        operation: 'adopt_open_model',
        requires_read_only: true,
        default_limit: DEFAULT_STRUCTURAL_GROUP_LIMIT,
        max_limit: MAX_STRUCTURAL_GROUP_LIMIT,
        max_fresh_manifold_paths: MAX_FRESH_MANIFOLD_PATHS,
        projected_entity_types: ['group'],
        traversed_container_types: ['group', 'component_instance'],
        fresh_manifold_method: runtime === 'queue' ? 'manifold_report' : 'fixture_only',
        leaf_entities_materialized: false,
        mutates_model: false
      }
    },
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
