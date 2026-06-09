import { makeGroundingV2SecondBuildingGroupSample } from './grounding-v2-second-sample.mjs';

const SYNTHETIC_TOP_SOURCE = 'test/建筑群-v2-generated/site-top.png';
const SYNTHETIC_OBLIQUE_SOURCE = 'test/建筑群-v2-generated/site-oblique.png';
const SMOKE_TOP_SOURCE = 'test/building-real-photo-smoke/manual-top-reference.png';
const SMOKE_OBLIQUE_SOURCE = 'test/building-real-photo-smoke/manual-oblique-reference.png';

export function makePhotoGradeRealSmokeSample() {
  const sample = structuredClone(makeGroundingV2SecondBuildingGroupSample());
  replaceSourcePaths(sample);
  const { observations, fixture } = sample;

  observations.object.name = 'Real Building Photo Smoke Scaffold';
  observations.object.source_images = [SMOKE_TOP_SOURCE, SMOKE_OBLIQUE_SOURCE];
  observations.image_set_quality = 'medium';
  observations.quality_report = {
    usable_for_modeling: true,
    risks: [
      'real_building_photo_asset_not_available',
      'manual_anchor_smoke_fixture',
      'photo_grade_readiness_must_review'
    ],
    notes: [
      'Smoke fixture reserves the real-photo contract until a real top/oblique building photo set is supplied.',
      'Geometry, scale anchors, and masks are scaffold evidence and must not be treated as photo-grade proof.'
    ]
  };
  observations.evidence_graph.open_questions = [
    ...(observations.evidence_graph.open_questions || []),
    'Replace scaffold source images with a real building/campus photo set and re-run the same readiness gate.'
  ];
  observations.evidence_graph.scale_calibration.notes = [
    ...(observations.evidence_graph.scale_calibration.notes || []),
    'Real-photo smoke scaffold keeps scale review required until manual source assets are attached.'
  ];
  for (const measurement of observations.scale_calibration.measurements || []) {
    measurement.review_required = true;
    measurement.note = `Real-photo smoke scaffold: ${measurement.note || 'scale anchor requires review.'}`;
  }
  for (const image of observations.images || []) {
    image.detected_view.notes = [
      `Real-photo smoke scaffold ${image.detected_view.kind} contract placeholder.`
    ];
    image.camera_hints.review_required = true;
    image.orientation_hints.review_required = true;
    image.quality_report.risks = unique([
      ...(image.quality_report.risks || []),
      'real_photo_asset_missing'
    ]);
  }

  fixture.id = 'building-real-photo-smoke';
  fixture.description = 'Real/historical building-photo smoke scaffold for PhotoGradeReadiness contract coverage.';
  fixture.grounding_v2.require_photo_grade = false;
  fixture.photo_grade_readiness = {
    input_asset_status: 'scaffold_no_real_building_photo_asset',
    expected_readiness: 'review_required',
    expected_photo_grade_candidate: false
  };

  return {
    observations,
    fixture,
    sampleKind: 'real_photo_smoke_scaffold',
    inputAssetStatus: 'scaffold_no_real_building_photo_asset'
  };
}

function replaceSourcePaths(value) {
  if (Array.isArray(value)) {
    for (const item of value) replaceSourcePaths(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, current] of Object.entries(value)) {
    if (current === SYNTHETIC_TOP_SOURCE) value[key] = SMOKE_TOP_SOURCE;
    else if (current === SYNTHETIC_OBLIQUE_SOURCE) value[key] = SMOKE_OBLIQUE_SOURCE;
    else replaceSourcePaths(current);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
