export function buildTraditionalHallSemanticFixture() {
  const material = 'Hall_Red_Wood';
  const parts = [
    boxPart('podium', 'Podium', 'podium', [-5000, -3500, 0], [10000, 7000, 500], 'Hall_Stone'),
    ...columnRow('outer-front', 'outer_eave_column', [-4200, -1400, 1400, 4200], -3200, 500, 4200, material),
    ...columnRow('outer-rear', 'outer_eave_column', [-4200, -1400, 1400, 4200], 3200, 500, 4200, material),
    ...columnRow('enclosure-front', 'enclosure_column', [-3600, -1200, 1200, 3600], -2500, 500, 3600, material),
    ...columnRow('enclosure-rear', 'enclosure_column', [-3600, -1200, 1200, 3600], 2500, 500, 3600, material),
    boxPart('enclosure-wall-front', 'Enclosure_Wall_Front', 'enclosure_wall', [-4000, -2550, 2800], [8000, 100, 500], 'Hall_Plaster'),
    {
      ...boxPart('front-masonry-sill', 'Front_Masonry_Sill_Wall', 'masonry_sill_wall', [-4000, -2550, 500], [8000, 100, 800], 'Hall_Stone'),
      relationships: [{ type: 'attached_to', target: 'enclosure-wall-front', source: 'semantic_ground_truth' }]
    },
    boxPart('front-window-band', 'Front_Window_Band', 'enclosure_window', [-3800, -2550, 1300], [7600, 100, 1500], 'Hall_Window'),
    boxPart('front-stair', 'Front_Center_Stair', 'front_stair', [-1200, -4500, 0], [2400, 1000, 500], 'Hall_Stone'),
    meshPart('roof-shell', 'Roof_Shell', 'roof_shell')
  ];
  return {
    version: 1,
    id: 'traditional-hall-semantic-fixture',
    profile_id: 'traditional_chinese_hall',
    source_mode: 'manual_authored',
    dsl_version: 1,
    units: 'mm',
    product: { type: 'traditional_chinese_hall', name: 'Traditional Hall Semantic Fixture' },
    scale: { width: 10000, depth: 9000, height: 5000, confidence: 1 },
    parts,
    semantic_contract: {
      version: 1,
      id: 'xieshan-hall-four-truths-v1',
      named_identity: { require_tag: true },
      regions: [
        region('front_center', [-1500, -4600, 0], [1500, -3400, 1200]),
        region('left_side', [-5500, -3500, 0], [-1500, 3500, 1200]),
        region('right_side', [1500, -3500, 0], [5500, 3500, 1200]),
        region('rear', [-5000, 2500, 0], [5000, 4600, 1200]),
        region('podium_perimeter', [-5200, -3700, 450], [5200, 3700, 1800])
      ],
      assertions: [
        { id: 'outer_eave_column_grid_required', type: 'required_role_count', role: 'outer_eave_column', min_count: 8 },
        { id: 'enclosure_column_grid_required', type: 'required_role_count', role: 'enclosure_column', min_count: 8 },
        { id: 'outer_and_enclosure_grids_are_distinct', type: 'distinct_role_layers', subject_role: 'outer_eave_column', target_role: 'enclosure_column', axis: 'y', min_separation_mm: 500 },
        { id: 'podium_balustrade_absent', type: 'role_absent', roles: ['balustrade', 'podium_balustrade'], region_id: 'podium_perimeter' },
        { id: 'masonry_sill_required', type: 'required_role_count', role: 'masonry_sill_wall', min_count: 1 },
        { id: 'masonry_sill_below_window', type: 'aabb_relation', subject_role: 'masonry_sill_wall', target_role: 'enclosure_window', relation: 'below', tolerance_mm: 0 },
        { id: 'masonry_sill_on_enclosure_plane', type: 'aabb_relation', subject_role: 'masonry_sill_wall', target_role: 'enclosure_wall', relation: 'same_plane', axis: 'y', tolerance_mm: 60 },
        { id: 'masonry_sill_attached_to_enclosure', type: 'required_relation', subject_role: 'masonry_sill_wall', target_role: 'enclosure_wall', relation: 'attached_to' },
        { id: 'front_stair_only', type: 'role_in_region', role: 'front_stair', region_id: 'front_center' },
        { id: 'no_side_or_rear_stair', type: 'role_forbidden_in_regions', roles: ['front_stair', 'side_stair', 'rear_stair'], region_ids: ['left_side', 'right_side', 'rear'] },
        { id: 'roof_mesh_winding_and_materials', type: 'mesh_integrity', role: 'roof_shell', require_consistent_outward_winding: true, require_back_material: true, back_material_must_match_front: true }
      ],
      negative_evidence: [
        { id: 'balustrade_absent', absent_role: 'balustrade', region_id: 'podium_perimeter', source_observation_ids: ['truth-no-podium-balustrade'] },
        { id: 'side_stair_absent', absent_role: 'side_stair', source_observation_ids: ['truth-front-stair-only'] },
        { id: 'rear_stair_absent', absent_role: 'rear_stair', region_id: 'rear', source_observation_ids: ['truth-front-stair-only'] }
      ],
      view_assertions: [
        {
          id: 'front_and_oblique_column_layering',
          views: ['front', 'oblique'],
          required_visible_roles: ['outer_eave_column', 'enclosure_column', 'masonry_sill_wall', 'front_stair'],
          layer_order: [{ near_role: 'outer_eave_column', far_role: 'enclosure_column' }]
        }
      ]
    },
    review: { status: 'accepted', parameter_proposals: [] }
  };
}

export function traditionalHallProfile() {
  return {
    version: 1,
    profile_id: 'traditional_chinese_hall',
    product_type: 'traditional_chinese_hall',
    name: 'Traditional Chinese Hall',
    dsl_version: 1,
    units: 'mm',
    materials: [
      { name: 'Hall_Red_Wood', color: '#7b241c' },
      { name: 'Hall_Stone', color: '#a99f8d' },
      { name: 'Hall_Plaster', color: '#d8c7aa' },
      { name: 'Hall_Window', color: '#3f5d5b', alpha: 0.7 },
      { name: 'Hall_Roof', color: '#4d5358' }
    ],
    tags: [],
    review: {}
  };
}

export function semanticViewEvidence() {
  return {
    views: ['front', 'oblique'].map((view) => ({
      view,
      visible_roles: ['outer_eave_column', 'enclosure_column', 'masonry_sill_wall', 'front_stair'],
      layer_order: [{ near_role: 'outer_eave_column', far_role: 'enclosure_column' }]
    }))
  };
}

function columnRow(prefix, role, xs, y, z, height, material) {
  return xs.map((x, index) => boxPart(`${prefix}-${index + 1}`, `${prefix}_${index + 1}`, role, [x - 120, y - 120, z], [240, 240, height], material));
}

function boxPart(id, name, role, origin, size, material) {
  return {
    id,
    name,
    type: role,
    role,
    tag: tagForRole(role),
    material,
    shape: { primitive: 'box', parameters: { origin, size, material } },
    evidence_status: 'manual_confirmed',
    fallback_state: 'structured_primitive',
    review_required: false,
    qa: {}
  };
}

function meshPart(id, name, role) {
  return {
    id,
    name,
    type: role,
    role,
    tag: tagForRole(role),
    material: 'Hall_Roof',
    shape: {
      primitive: 'mesh',
      parameters: {
        vertices: [
          [-5200, -3600, 4000], [5200, -3600, 4000], [5200, 3600, 4000], [-5200, 3600, 4000],
          [-5200, -3600, 5000], [5200, -3600, 5000], [5200, 3600, 5000], [-5200, 3600, 5000]
        ],
        faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
        material: 'Hall_Roof',
        back_material: 'Hall_Roof'
      }
    },
    evidence_status: 'manual_confirmed',
    fallback_state: 'structured_primitive',
    review_required: false,
    qa: {}
  };
}

function region(id, min, max) {
  return { id, kind: 'aabb', aabb: { min, max } };
}

function tagForRole(role) {
  if (/enclosure|sill/.test(role)) return 'Hall_Enclosure';
  return 'Hall_Structure';
}
