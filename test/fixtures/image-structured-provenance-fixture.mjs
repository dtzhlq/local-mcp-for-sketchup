import {
  artifactContentSignature,
  withArtifactContentSignature
} from '../../src/image-structured-provenance.mjs';

export function buildImageStructuredProvenanceFixture({
  sourceImage = 'fixture.png',
  contentSha256 = 'a'.repeat(64)
} = {}) {
  const assetSetId = 'image-provenance-fixture';
  const profileId = 'game_controller_switch';
  const observationId = 'obs-body';
  const candidateId = 'candidate-body';

  const assetSet = withArtifactContentSignature({
    version: 1,
    kind: 'asset_set',
    id: assetSetId,
    source_input: sourceImage,
    assets: [{ id: 'fixture-front', path: sourceImage, media_type: 'image', detected_view: 'front', quality: 'high', content_sha256: contentSha256 }],
    profile_routing: { selected_profile: profileId, status: 'routed' },
    gates: { can_compile_geometry: true, reasons: [] }
  });
  const observations = withArtifactContentSignature({
    version: 1,
    object: { type: 'switch_controller', name: 'Image provenance fixture', profile: 'switch_controller', source_images: [sourceImage] },
    images: [{
      version: 1,
      image: { path: sourceImage, width: 1000, height: 600 },
      detected_view: { kind: 'front', confidence: 1 },
      observations: [{ id: observationId, kind: 'component_bbox', source_view: 'front', bbox: [100, 100, 800, 400], confidence: 1 }]
    }],
    views_detected: ['front'],
    missing_views: [],
    scale_calibration: { strategy: 'known_dimension', units: 'mm', confidence: 1, default_scale: { width: 242 }, measurements: [], missing_views: [] },
    quality_report: { usable_for_modeling: true, risks: [] }
  });
  const candidateGraph = withArtifactContentSignature({
    version: 1,
    kind: 'candidate_graph',
    asset_set_id: assetSetId,
    profile_id: profileId,
    candidates: [{
      id: candidateId,
      role: 'controller_body',
      source_image: sourceImage,
      source_observation_id: observationId,
      view: 'front',
      bbox: [100, 100, 800, 400],
      confidence: 1,
      promotion: { status: 'eligible', blockers: [] }
    }],
    summary: { candidate_count: 1, eligible_count: 1, blocked_count: 0 }
  });
  const modelingBrief = {
    version: 1,
    kind: 'modeling_brief',
    asset_set_id: assetSetId,
    profile_id: profileId,
    status: 'ready_for_promotion_review',
    compile_allowed: true,
    missing_inputs: [],
    instructions: ['Compile only after derived provenance and PartGraph gates pass.']
  };
  const promotionReview = withArtifactContentSignature({
    version: 1,
    kind: 'candidate_promotion_review',
    asset_set_id: assetSetId,
    profile_id: profileId,
    source_candidate_graph: 'candidate-graph.json',
    artifact_bindings: {
      asset_set: artifactContentSignature(assetSet),
      observations: artifactContentSignature(observations),
      candidate_graph: artifactContentSignature(candidateGraph)
    },
    reviewer: 'image provenance regression',
    verdict: 'accepted_subset',
    compile_allowed: true,
    promotion_allowed: true,
    missing_inputs: [],
    blockers: [],
    profile_confirmation: { selected_profile: profileId, status: 'confirmed' },
    scale_confirmation: { status: 'confirmed', known_width: 242, units: 'mm' },
    draft_view_review: null,
    local_detail_review: null,
    accepted_candidates: [{
      candidate_id: candidateId,
      role: 'controller_body',
      view: 'front',
      source_image: sourceImage,
      source_observation_id: observationId,
      confidence: 1,
      promotion_status: 'accepted_for_part_graph',
      blockers: []
    }],
    held_candidates: []
  });
  const promotionPatch = withArtifactContentSignature({
    version: 1,
    kind: 'candidate_promotion_patch',
    asset_set_id: assetSetId,
    profile_id: profileId,
    artifact_bindings: {
      asset_set: artifactContentSignature(assetSet),
      observations: artifactContentSignature(observations),
      candidate_graph: artifactContentSignature(candidateGraph),
      promotion_review: artifactContentSignature(promotionReview)
    },
    accepted_candidate_ids: [candidateId],
    geometry_strategy: null,
    source_review: 'candidate-promotion-review.json',
    status: 'ready_for_part_graph_patch',
    apply_allowed: true,
    compile_allowed: false,
    blockers: [],
    resolved_blockers: [],
    calibration_lineage: null,
    calibration_review: null,
    topology_review: null,
    draft_view_review: null,
    local_detail_review: null,
    plane_review: null,
    actions: [{
      action: 'promote_candidate',
      candidate_id: candidateId,
      role: 'controller_body',
      view: 'front',
      source_image: sourceImage,
      source_observation_id: observationId,
      supporting_observations: [],
      accepted_draft_view_slot_id: 'front',
      accepted_plane_id: '',
      accepted_surface_id: '',
      accepted_detail_id: '',
      confidence: 1,
      requires_part_graph_review: true,
      reviewer_note: ''
    }],
    review_summary: { accepted_candidates: 1, held_candidates: 0, missing_inputs: 0 },
    notes: 'Deterministic main-project provenance fixture.'
  });
  const partGraph = withArtifactContentSignature({
    version: 1,
    id: 'image-provenance-part-graph',
    profile_id: profileId,
    source_mode: 'image_structured',
    dsl_version: 1,
    units: 'mm',
    product: { type: 'game_controller', name: 'Image provenance fixture' },
    provenance: {
      version: 1,
      asset_set_id: assetSetId,
      profile_id: profileId,
      artifact_signatures: {
        asset_set: artifactContentSignature(assetSet),
        observations: artifactContentSignature(observations),
        candidate_graph: artifactContentSignature(candidateGraph),
        promotion_review: artifactContentSignature(promotionReview),
        promotion_patch: artifactContentSignature(promotionPatch)
      },
      accepted_candidate_ids: [candidateId],
      source_observation_ids: [observationId]
    },
    scale: { width: 242, depth: 100, height: 60, confidence: 1 },
    parts: [{
      id: 'controller-body',
      name: 'Controller_Body',
      type: 'controller_shell',
      role: 'controller_body',
      shape: { primitive: 'box', parameters: { origin: [-121, -50, 0], size: [242, 100, 60] } },
      evidence_status: 'observed',
      fallback_state: 'structured_primitive',
      source_candidate_ids: [candidateId],
      source_observation_ids: [observationId],
      review_required: false,
      qa: { part_graph_review_required: false }
    }],
    review: { status: 'accepted', parameter_proposals: [] }
  });
  return {
    assetSet,
    observations,
    candidateGraph,
    modelingBrief,
    promotionReview,
    promotionPatch,
    partGraph,
    ids: { assetSetId, profileId, sourceImage, observationId, candidateId }
  };
}

export function resign(value) {
  return withArtifactContentSignature(value);
}
