import { makeImageRelationCandidates, makeVisualRelationGraph } from './visual-relations.mjs';
import { annotateObservationSetWithGroundingV3 } from './grounding-v3.mjs';

const TOP_SOURCE = 'test/建筑群-v2-generated/site-top.png';
const OBLIQUE_SOURCE = 'test/建筑群-v2-generated/site-oblique.png';
const SITE_BBOX = [120, 80, 760, 560];

export function makeGroundingV2SecondBuildingGroupSample() {
  const top = imageObservation('top', TOP_SOURCE, [
    obs('building_top_site_boundary', 'site_boundary', SITE_BBOX, 'mask_polygon', 'pixel_color_segmentation', 0.92),
    obs('building_top_primary_blue_hall', 'primary_blue_roof_hall', [555, 165, 240, 170], 'mask_polygon', 'pixel_color_segmentation', 0.9),
    obs('building_top_warehouse_row_west', 'warehouse_row_west', [205, 165, 150, 285], 'mask_polygon', 'pixel_color_segmentation', 0.86),
    obs('building_top_warehouse_row_inner', 'warehouse_row_inner', [385, 160, 130, 290], 'mask_polygon', 'pixel_color_segmentation', 0.86),
    obs('building_top_utility_building', 'utility_building', [610, 378, 90, 72], 'mask_polygon', 'pixel_color_segmentation', 0.78),
    obs('building_top_admin_office', 'admin_office', [435, 470, 140, 70], 'mask_polygon', 'pixel_color_segmentation', 0.76),
    obs('building_top_parking_lot', 'parking_lot', [485, 500, 275, 115], 'gap_region', 'pixel_gap_segmentation', 0.84),
    obs('building_top_internal_roads', 'internal_roads', [380, 430, 360, 60], 'gap_region', 'pixel_gap_segmentation', 0.78),
    obs('building_top_tank_farm', 'tank_farm', [760, 360, 70, 120], 'mask_polygon', 'pixel_color_segmentation', 0.8),
    obs('warehouse_west_north_top_mask', 'warehouse_west_north', [205, 165, 150, 126], 'mask_polygon', 'pixel_color_segmentation', 0.84),
    obs('warehouse_west_south_top_mask', 'warehouse_west_south', [205, 324, 150, 126], 'mask_polygon', 'pixel_color_segmentation', 0.84),
    obs('warehouse_inner_north_top_mask', 'warehouse_inner_north', [385, 160, 130, 128], 'mask_polygon', 'pixel_color_segmentation', 0.83),
    obs('warehouse_inner_south_top_mask', 'warehouse_inner_south', [385, 322, 130, 128], 'mask_polygon', 'pixel_color_segmentation', 0.83),
    obs('parking_stall_row_north_top_line', 'parking_stall_row_north', [510, 515, 210, 18], 'line_segment', 'pixel_line_segmentation', 0.82),
    obs('parking_stall_row_south_top_line', 'parking_stall_row_south', [510, 570, 210, 18], 'line_segment', 'pixel_line_segmentation', 0.82),
    obs('parking_drive_aisle_center_top_gap', 'parking_drive_aisle_center', [500, 535, 235, 38], 'gap_region', 'pixel_gap_segmentation', 0.8),
    obs('tree_row_south_top_vegetation', 'tree_row_south', [465, 625, 260, 25], 'vegetation_region', 'pixel_vegetation_segmentation', 0.78),
    obs('scale_anchor_parking_bay_span_top', 'scale_anchor_parking_bay_span', [525, 517, 116, 12], 'scale_anchor', 'pixel_line_segmentation', 0.88),
    obs('scale_anchor_parking_bay_depth_top', 'scale_anchor_parking_bay_depth', [525, 569, 24, 16], 'scale_anchor', 'pixel_line_segmentation', 0.86)
  ]);

  const oblique = imageObservation('oblique', OBLIQUE_SOURCE, [
    obs('building_oblique_site_boundary', 'site_boundary', [95, 95, 810, 500], 'sampled_contour', 'edge_contour_segmentation', 0.74),
    obs('building_oblique_primary_blue_hall', 'primary_blue_roof_hall', [560, 145, 260, 180], 'sampled_contour', 'edge_contour_segmentation', 0.78),
    obs('building_oblique_warehouse_row_west', 'warehouse_row_west', [185, 165, 165, 260], 'sampled_contour', 'edge_contour_segmentation', 0.72),
    obs('building_oblique_warehouse_row_inner', 'warehouse_row_inner', [375, 150, 155, 270], 'sampled_contour', 'edge_contour_segmentation', 0.72),
    obs('building_oblique_parking_lot', 'parking_lot', [470, 470, 300, 105], 'sampled_contour', 'edge_contour_segmentation', 0.68),
    obs('building_oblique_tank_farm', 'tank_farm', [765, 325, 86, 132], 'sampled_contour', 'edge_contour_segmentation', 0.7)
  ], {
    projection_model: 'weak_perspective_review_gate',
    perspective_strength: 'medium',
    vanishing_lines: [{ a: [140, 550], b: [860, 360] }],
    horizon_line: { a: [110, 130], b: [880, 112] },
    review_required: true
  });

  top.relation_candidates = makeImageRelationCandidates(top);
  oblique.relation_candidates = makeImageRelationCandidates(oblique);
  const visualRelationGraph = makeVisualRelationGraph({ objectProfile: 'building_group', images: [top, oblique] });
  const observations = annotateObservationSetWithGroundingV3({
    version: 1,
    object: {
      type: 'building_group',
      profile: 'building_group',
      name: 'Grounding v2 Generated Industrial Campus B',
      source_images: [TOP_SOURCE, OBLIQUE_SOURCE]
    },
    image_set_quality: 'high',
    views_detected: ['top', 'oblique'],
    missing_views: ['front', 'rear', 'left', 'right'],
    images: [top, oblique],
    scale_calibration: scaleCalibration(),
    visual_relation_graph: visualRelationGraph,
    evidence_graph: {
      version: 1,
      image_count: 2,
      views_detected: ['top', 'oblique'],
      missing_views: ['front', 'rear', 'left', 'right'],
      parts: evidenceParts(top.observations),
      part_matches: evidenceParts(top.observations).map((part) => ({
        part_id: part.part_id,
        strategy: 'grounding_v2_second_sample_mask_contour',
        matched_views: part.confirmed_views,
        missing_views: part.missing_views,
        source_count: part.sources.length,
        confidence: part.confidence
      })),
      visual_relations: visualRelationGraph.relations,
      scale_calibration: scaleCalibration(),
      open_questions: [
        'Grounding v2 second sample is generated and synthetic; use it to prove reusable evidence gates, not surveyed dimensions.'
      ]
    },
    quality_report: {
      usable_for_modeling: true,
      risks: ['synthetic_generated_sample', 'oblique_pose_review_required'],
      notes: ['Second building-group sample uses different image bboxes and the same pipeline fixture IDs.']
    }
  });
  return { observations, fixture: makeGroundingV2SecondSampleFixture() };
}

export function makeGroundingV2SecondSampleFixture() {
  return {
    version: 1,
    id: 'building-group-grounding-v2-second-sample',
    description: 'Generated second building-group sample for Grounding v2 generalization gates.',
    model: {
      axes: ['x', 'y'],
      frame_items: ['site_boundary']
    },
    aliases: {
      image: {
        site: ['site_boundary'],
        blue_hall: ['primary_blue_roof_hall'],
        warehouse_west: ['warehouse_row_west'],
        warehouse_inner: ['warehouse_row_inner'],
        parking_lot: ['parking_lot'],
        tank_farm: ['tank_farm']
      },
      model: {
        site: ['site_boundary'],
        blue_hall: ['primary_blue_roof_hall'],
        warehouse_west: ['warehouse_row_west'],
        warehouse_inner: ['warehouse_row_inner'],
        parking_lot: ['parking_lot'],
        tank_farm: ['tank_farm']
      }
    },
    geometry_fit: {
      image_view: 'top',
      image_frame: 'site',
      oblique_frame: 'site'
    },
    grounding_v2: {
      max_dense_helper_ratio: 0.35,
      require_photo_grade: false
    },
    footprint_rules: [
      footprintRule('blue-hall-second-sample-footprint', 'blue_hall', 'pixel_color_segmentation'),
      footprintRule('warehouse-west-second-sample-footprint', 'warehouse_west', 'pixel_color_segmentation'),
      footprintRule('warehouse-inner-second-sample-footprint', 'warehouse_inner', 'pixel_color_segmentation'),
      footprintRule('parking-second-sample-footprint', 'parking_lot', 'pixel_gap_segmentation', [0.05, 0.05])
    ],
    required_relations: [
      {
        id: 'second-blue-hall-right-of-inner-warehouse',
        type: 'right_of',
        item: 'blue_hall',
        anchor: 'warehouse_inner',
        image_view: 'top',
        min_confidence: 0.55,
        min_model_delta: 0.08,
        spacing_tolerance: 0.1,
        mirror_negative: true
      },
      {
        id: 'second-inner-warehouse-right-of-west-warehouse',
        type: 'right_of',
        item: 'warehouse_inner',
        anchor: 'warehouse_west',
        image_view: 'top',
        min_confidence: 0.52,
        min_model_delta: 0.06,
        spacing_tolerance: 0.1,
        mirror_negative: true
      },
      {
        id: 'second-parking-below-blue-hall',
        type: 'below',
        item: 'parking_lot',
        anchor: 'blue_hall',
        image_view: 'top',
        min_confidence: 0.52,
        min_model_delta: 0.08,
        spacing_tolerance: 0.12
      }
    ],
    negative_cases: [{
      id: 'second-sample-mirror-x-negative',
      transform: 'mirror_x',
      rule_ids: [
        'second-blue-hall-right-of-inner-warehouse',
        'second-inner-warehouse-right-of-west-warehouse'
      ],
      min_failed_rules: 1
    }]
  };
}

function footprintRule(id, item, requireGrounding, extentTolerance = [0.035, 0.04]) {
  return {
    id,
    item,
    image_view: 'top',
    image_frame: 'site',
    require_grounding: requireGrounding,
    center_tolerance: 0.035,
    extent_tolerance: extentTolerance,
    area_tolerance: 0.32
  };
}

function imageObservation(kind, source, observations, cameraHints = {}) {
  return {
    version: 1,
    image: {
      path: source,
      width: 1024,
      height: 768,
      analysis_width: 1024,
      analysis_height: 768
    },
    detected_view: {
      kind,
      confidence: kind === 'top' ? 0.94 : 0.76,
      notes: [`Grounding v2 generated ${kind} view fixture.`]
    },
    camera_hints: {
      perspective_strength: kind === 'top' ? 'low' : 'medium',
      projection_model: kind === 'top' ? 'site_affine' : 'weak_perspective_review_gate',
      review_required: kind !== 'top',
      ...cameraHints
    },
    orientation_hints: {
      coordinate_convention: 'image_x_right_y_down',
      model_convention: 'model_x_right_y_up_z_height',
      mirror_risk: { status: 'medium', confidence: 0.64, reasons: ['generated_fixture_no_surveyed_north'] },
      semantic_anchors: [],
      review_required: true
    },
    observations,
    quality_report: {
      usable_for_modeling: true,
      risks: kind === 'top' ? [] : ['oblique_pose_review_required'],
      missing_views: []
    }
  };
}

function obs(id, componentHint, bbox, kind, method, confidence) {
  const polygon = bboxPolygon(bbox);
  return {
    id,
    kind,
    source_view: componentHint === 'site_boundary' ? 'derived_site' : undefined,
    component_hint: componentHint,
    bbox,
    contour: {
      kind: 'sampled_polygon',
      polygon,
      sample_count: polygon.length,
      source: method,
      review_required: false
    },
    mask: {
      id: `${id}_mask`,
      method,
      bbox,
      polygon,
      sampled_contour: polygon,
      pixel_count: Math.round(bbox[2] * bbox[3] * 0.78),
      fill: 0.78,
      quality: groundingQuality(),
      review_required: false
    },
    grounding: {
      method,
      pixel_bbox: bbox,
      pixel_count: Math.round(bbox[2] * bbox[3] * 0.78),
      fill: 0.78,
      contour_basis: 'sampled_contour',
      grounding_quality: groundingQuality(),
      review_required: false
    },
    grounding_status: 'image_grounded',
    isolation: groundingQuality(),
    confidence,
    note: `Grounding v2 second sample ${method} evidence for ${componentHint}.`
  };
}

function groundingQuality() {
  return {
    version: 2,
    status: 'pass',
    raw_to_evidence_bbox_ratio: 1,
    prior_to_evidence_bbox_ratio: 1,
    bbox_proxy: false,
    review_required: false,
    reasons: []
  };
}

function bboxPolygon([x, y, width, height]) {
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
    [x, y]
  ];
}

function scaleCalibration() {
  const pxPerMmX = SITE_BBOX[2] / 148000;
  const pxPerMmY = SITE_BBOX[3] / 92000;
  return {
    units: 'mm',
    strategy: 'grounding_v2_known_site_anchors',
    default_scale: { width: 148000, depth: 92000, height: 18000 },
    measurements: [
      {
        view: 'top',
        source_image: TOP_SOURCE,
        observation_id: 'building_top_site_boundary',
        anchor_type: 'site_boundary_from_known_anchors',
        object_bbox: SITE_BBOX,
        physical_width_mm: 148000,
        physical_height_mm: 92000,
        pixels_per_mm_x: pxPerMmX,
        pixels_per_mm_y: pxPerMmY,
        confidence: 0.82,
        basis: ['parking_bay_width_span', 'drive_aisle_width', 'campus_generated_scale'],
        review_required: true,
        note: 'Generated second sample site extent calibrated from visible parking/road anchors.'
      },
      {
        view: 'top',
        source_image: TOP_SOURCE,
        observation_id: 'scale_anchor_parking_bay_span_top',
        anchor_type: 'parking_bay_width_span',
        object_bbox: [525, 517, 116, 12],
        pixels_per_mm_x: pxPerMmX,
        pixels_per_mm_y: pxPerMmY,
        confidence: 0.78,
        review_required: true,
        note: 'Second sample parking-span anchor follows the site projection scale.'
      },
      {
        view: 'top',
        source_image: TOP_SOURCE,
        observation_id: 'scale_anchor_parking_bay_depth_top',
        anchor_type: 'parking_bay_single',
        object_bbox: [525, 569, 24, 16],
        pixels_per_mm_x: pxPerMmX,
        pixels_per_mm_y: pxPerMmY,
        confidence: 0.74,
        review_required: true,
        note: 'Second sample single parking-bay anchor follows the site projection scale.'
      },
      {
        view: 'top',
        source_image: TOP_SOURCE,
        observation_id: 'parking_drive_aisle_center_top_gap',
        anchor_type: 'parking_drive_aisle_width',
        object_bbox: [500, 535, 235, 38],
        pixels_per_mm_y: pxPerMmY,
        confidence: 0.7,
        basis: ['visible parking drive aisle', 'typical aisle width 6.5m'],
        review_required: true,
        note: 'Second sample road/aisle anchor is an independent non-parking-family scale candidate for Grounding v3.'
      }
    ],
    confidence: 0.78,
    missing_views: ['surveyed_site_dimensions'],
    notes: ['Synthetic second sample calibration should not be treated as surveyed dimensions.']
  };
}

function evidenceParts(observations) {
  return observations
    .filter((observation) => observation.component_hint && !observation.component_hint.startsWith('scale_anchor_'))
    .map((observation) => ({
      part_id: observation.component_hint,
      status: 'observed',
      template_prior: false,
      manual_confirmed: false,
      required_views: ['top'],
      confirmed_views: ['top'],
      missing_views: [],
      confidence: observation.confidence,
      sources: [{
        view: 'top',
        kind: observation.kind,
        status: 'observed',
        source_image: TOP_SOURCE,
        observation_id: observation.id,
        confidence: observation.confidence,
        grounding: observation.grounding,
        note: observation.note
      }],
      conflicts: [],
      open_questions: []
    }));
}
