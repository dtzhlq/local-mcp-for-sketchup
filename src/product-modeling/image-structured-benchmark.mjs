import {
  hasValidArtifactContentSignature,
  interpretationEligibilityForPartGraph
} from '../image-structured-provenance.mjs';
import { expandArchitecturalPrimitives } from './architectural-primitives.mjs';

const LIVE_SEQUENCE = [
  'get_capabilities_queue',
  'build',
  'save',
  'reopen',
  'capture_view',
  'capture_view',
  'semantic_revalidation'
];

export function evaluateImageStructuredBenchmarkMethod({
  id,
  partGraph,
  semanticReport,
  groundTruth = null,
  provenanceReport = null,
  dsl = null,
  runtimeEvidence = null,
  interpretationAssessment = null
} = {}) {
  if (!id) throw new Error('benchmark method id is required');
  if (!partGraph) throw new Error(`benchmark method ${id} requires a PartGraph`);
  const eligibility = interpretationEligibilityForPartGraph(partGraph);
  const provenanceVerified = provenanceReport?.ok === true;
  const interpretationEligible = eligibility.eligible && provenanceVerified;
  const derivedInterpretation = interpretationEligible
    ? evaluatePartGraphInterpretationAgainstGroundTruth({ partGraph, groundTruth, provenanceReport, semanticReport })
    : {
        status: 'excluded',
        eligible: false,
        score: null,
        reason: eligibility.eligible ? 'image_structured_provenance_not_verified' : eligibility.reason,
        provenance_verified: provenanceVerified,
        face_count_used: false
      };
  if (interpretationAssessment && (interpretationAssessment.status !== 'excluded' || interpretationAssessment.eligible !== false)) {
    throw new Error(`benchmark method ${id} may only override interpretation to an explicit exclusion`);
  }
  const interpretation = interpretationAssessment || derivedInterpretation;

  const parts = partGraph.parts || [];
  const structureChecks = {
    unique_part_ids: new Set(parts.map((part) => part.id)).size === parts.length && parts.every((part) => part.id),
    named_roles: parts.every((part) => part.name && part.role),
    editable_shapes: parts.every((part) => part.shape?.primitive && part.shape.primitive !== 'imported_geometry'),
    semantic_contract: Boolean(partGraph.semantic_contract?.assertions?.length),
    evidence_lineage: partGraph.source_mode !== 'image_structured'
      || parts.filter((part) => part.shape).every((part) => (part.source_candidate_ids || []).length && (part.source_observation_ids || []).length),
    safe_dsl: Boolean(dsl?.operations?.length) && (dsl.operations || []).every((operation) => operation.op && operation.op !== 'eval_ruby')
  };
  const structurePassed = Object.values(structureChecks).filter(Boolean).length;
  const structure = {
    status: structurePassed === Object.keys(structureChecks).length ? 'pass' : 'fail',
    passed: structurePassed,
    total: Object.keys(structureChecks).length,
    score: round(structurePassed / Object.keys(structureChecks).length),
    checks: structureChecks
  };

  const runtime = evaluateRuntimeEvidence(runtimeEvidence, dsl);
  return {
    id,
    source_mode: eligibility.source_mode,
    interpretation,
    structure,
    runtime
  };
}

export function evaluatePartGraphInterpretationAgainstGroundTruth({
  partGraph,
  groundTruth,
  provenanceReport,
  semanticReport
} = {}) {
  if (!partGraph || !groundTruth) throw new Error('PartGraph interpretation scoring requires the fixed ground truth');
  if (partGraph.source_mode !== 'image_structured' || provenanceReport?.ok !== true) {
    throw new Error('PartGraph interpretation scoring requires verified image_structured provenance');
  }
  const semanticPartGraph = expandArchitecturalPrimitives(partGraph);
  const parts = (semanticPartGraph.parts || []).filter((part) => part.compile?.emit !== false && part.shape);
  const roles = new Set(parts.map((part) => part.role).filter(Boolean));
  const negativeRoles = new Set((partGraph.semantic_contract?.negative_evidence || []).map((item) => item.absent_role).filter(Boolean));
  const assertions = partGraph.semantic_contract?.assertions || [];
  const semanticIssueIds = new Set((semanticReport?.issues || [])
    .filter((issue) => issue.severity !== 'warn')
    .map((issue) => issue.id));
  const hasPassingAssertion = (predicate) => assertions.some((assertion) => predicate(assertion) && !semanticIssueIds.has(assertion.id));
  const hasRole = (...candidates) => candidates.some((role) => roles.has(role));
  const noRole = (...candidates) => candidates.every((role) => !roles.has(role));
  const outcomes = (groundTruth.assertions || []).map((truth) => {
    let passed = false;
    let evidence = [];
    if (truth.id === 'hall-column-grids-outer-and-enclosure') {
      evidence = ['outer_eave_column', 'enclosure_column', 'distinct_role_layers'];
      passed = hasRole('outer_eave_column', 'outer_eave_column_grid')
        && hasRole('enclosure_column', 'enclosure_wall_column_grid')
        && hasPassingAssertion((assertion) => assertion.type === 'distinct_role_layers'
          && ['outer_eave_column', 'outer_eave_column_grid'].includes(assertion.subject_role)
          && ['enclosure_column', 'enclosure_wall_column_grid'].includes(assertion.target_role));
    } else if (truth.id === 'podium-no-perimeter-balustrade') {
      evidence = ['balustrade_absent', 'role_absent'];
      passed = noRole('balustrade', 'podium_balustrade')
        && negativeRoles.has('balustrade')
        && hasPassingAssertion((assertion) => assertion.type === 'role_absent'
          && (assertion.roles || []).some((role) => ['balustrade', 'podium_balustrade'].includes(role)));
    } else if (truth.id === 'masonry-below-enclosure') {
      evidence = ['masonry_sill_wall', 'below', 'same_plane', 'attached_to'];
      const masonryRelations = new Set(assertions
        .filter((assertion) => assertion.subject_role === 'masonry_sill_wall' && !semanticIssueIds.has(assertion.id))
        .map((assertion) => assertion.relation));
      passed = roles.has('masonry_sill_wall')
        && masonryRelations.has('below')
        && masonryRelations.has('same_plane')
        && masonryRelations.has('attached_to');
    } else if (truth.id === 'front-stair-only') {
      evidence = ['front_stair', 'side_stair_absent', 'rear_stair_absent', 'forbidden_regions'];
      passed = roles.has('front_stair')
        && noRole('side_stair', 'rear_stair')
        && negativeRoles.has('side_stair')
        && negativeRoles.has('rear_stair')
        && hasPassingAssertion((assertion) => assertion.type === 'role_in_region' && assertion.role === 'front_stair')
        && hasPassingAssertion((assertion) => assertion.type === 'role_forbidden_in_regions'
          && (assertion.roles || []).some((role) => ['front_stair', 'side_stair', 'rear_stair'].includes(role)));
    }
    return { assertion_id: truth.id, passed, required_evidence: evidence };
  });
  const passed = outcomes.filter((outcome) => outcome.passed).length;
  return {
    status: 'scored',
    eligible: true,
    passed,
    total: outcomes.length,
    score: outcomes.length ? round(passed / outcomes.length) : 0,
    semantic_contract_id: groundTruth.id,
    part_graph_semantic_contract_id: partGraph.semantic_contract?.id || null,
    provenance_verified: true,
    source_evidence_level: 'accepted_hash_bound_part_graph_semantics',
    assertion_results: outcomes,
    face_count_used: false
  };
}

export function evaluateRouterInterpretationAgainstGroundTruth({ id, routerObservation, groundTruth } = {}) {
  if (!id || !routerObservation || !groundTruth) throw new Error('router interpretation benchmark requires id, router observation, and ground truth');
  assertObservedRouterFixture(routerObservation);
  const roles = new Set(Object.entries(routerObservation.role_counts || {}).filter(([, count]) => Number(count) > 0).map(([role]) => role));
  const negativeEvidence = new Set(routerObservation.negative_evidence_roles || []);
  const outcomes = (groundTruth.assertions || []).map((assertion) => {
    let passed = false;
    let evidence = [];
    if (assertion.id === 'hall-column-grids-outer-and-enclosure') {
      evidence = ['outer_eave_column_grid', 'enclosure_wall_column_grid'];
      passed = evidence.every((role) => roles.has(role) || roles.has(role.replace(/_grid$/, '')));
    } else if (assertion.id === 'podium-no-perimeter-balustrade') {
      evidence = ['balustrade_absent'];
      passed = negativeEvidence.has('balustrade_absent');
    } else if (assertion.id === 'masonry-below-enclosure') {
      evidence = ['masonry_sill_wall'];
      passed = roles.has('masonry_sill_wall');
    } else if (assertion.id === 'front-stair-only') {
      evidence = ['front_stair', 'front_stair_only'];
      passed = roles.has('front_stair') && negativeEvidence.has('front_stair_only');
    }
    return { assertion_id: assertion.id, passed, required_evidence: evidence };
  });
  const passed = outcomes.filter((outcome) => outcome.passed).length;
  const urbanFalsePositiveRoles = ['ground_floor_storefront', 'roof_parapet_and_rail', 'rectangular_utility_ducts', 'exterior_hvac_units'];
  const urbanFalsePositiveCount = urbanFalsePositiveRoles.reduce((sum, role) => sum + Number(routerObservation.role_counts?.[role] || 0), 0);
  const interpretation = {
    status: 'scored',
    eligible: true,
    passed,
    total: outcomes.length,
    score: outcomes.length ? round(passed / outcomes.length) : 0,
    semantic_contract_id: groundTruth.id,
    provenance_verified: true,
    source_evidence_level: 'hash_bound_historical_observed_router_output',
    assertion_results: outcomes,
    urban_false_positive_roles: urbanFalsePositiveRoles.filter((role) => roles.has(role)),
    urban_false_positive_count: urbanFalsePositiveCount,
    face_count_used: false
  };
  return {
    id,
    source_mode: 'image_candidate_graph',
    interpretation,
    structure: {
      status: 'fail',
      passed: 0,
      total: 6,
      score: 0,
      reason: 'no_accepted_candidates_and_no_editable_part_graph',
      checks: {
        accepted_candidates: routerObservation.intake?.accepted_count > 0,
        editable_part_graph: false,
        semantic_contract: false,
        evidence_lineage: false,
        safe_dsl: false,
        promotion_actions: routerObservation.intake?.promotion_actions > 0
      }
    },
    runtime: runtimeEvidenceLevels({ dsl: null, runtimeEvidence: null })
  };
}

function assertObservedRouterFixture(observation) {
  const hashPattern = /^sha256:[a-f0-9]{64}$/;
  const sourceHashes = Object.values(observation.source_artifacts || {}).map((artifact) => artifact?.sha256);
  const intake = observation.intake || {};
  const countConsistency = Number(intake.candidate_count) === Number(intake.eligible_count) + Number(intake.held_count)
    && Number(intake.accepted_count) === 0
    && Number(intake.promotion_actions) === 0;
  if (observation.kind !== 'image_structured_router_observation_fixture'
    || observation.status !== 'historical_observed_router_output'
    || observation.release_ready !== false
    || !hasValidArtifactContentSignature(observation)
    || sourceHashes.length < 3
    || !sourceHashes.every((hash) => hashPattern.test(String(hash)))
    || !countConsistency
    || intake.compile_allowed !== false
    || intake.promotion_allowed !== false
    || intake.apply_allowed !== false) {
    throw new Error('observed router benchmark fixture is not a valid hash-bound fail-closed observation');
  }
}

export function buildImageStructuredBenchmarkReport({ methods, generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(methods) || methods.length < 2) throw new Error('benchmark report requires at least two methods');
  const interpretationScored = methods.filter((method) => method.interpretation.status === 'scored');
  const liveVerified = methods.filter((method) => method.runtime.live.status === 'verified');
  return {
    version: 1,
    kind: 'image_structured_main_benchmark_report',
    generated_at: generatedAt,
    scoring_policy: {
      dimensions_are_independent: true,
      aggregate_score: null,
      interpretation_cannot_be_replaced_by_face_count_or_model_size: true,
      imported_geometry_and_dsl_reverse_wrapping_are_excluded_from_interpretation: true
    },
    methods,
    summary: {
      method_count: methods.length,
      interpretation_scored_methods: interpretationScored.length,
      structure_passed_methods: methods.filter((method) => method.structure.status === 'pass').length,
      live_verified_methods: liveVerified.length
    },
    evidence_level: liveVerified.length > 0 ? 'queue_live_scoped' : 'offline_mock_and_static',
    live_status: liveVerified.length > 0 ? 'scoped_live_verified' : 'live_unverified',
    verdict: 'technical_baseline',
    release_ready: false
  };
}

export function evaluateRuntimeEvidence(runtimeEvidence, dsl) {
  const offline = {
    status: dsl?.operations?.length && runtimeEvidence?.mock_build_ok !== false ? 'pass' : 'fail',
    evidence_level: runtimeEvidence?.mock_build_ok === true ? 'offline_mock' : 'offline_compile',
    operation_count: dsl?.operations?.length || 0,
    mock_build_ok: runtimeEvidence?.mock_build_ok ?? null
  };
  if (!runtimeEvidence) return runtimeEvidenceLevels({ dsl, runtimeEvidence, offline });
  const steps = (runtimeEvidence.steps || []).map((step) => step.kind);
  const sequenceOk = containsOrderedSequence(steps, LIVE_SEQUENCE);
  const claimScope = runtimeEvidence.claim_scope;
  const recognizedClaimScope = claimScope === 'image_structured_full' || claimScope === 'semantic_runtime_only';
  const reportShape = runtimeEvidence.kind === 'image_structured_semantic_live_gate_report'
    && recognizedClaimScope
    && runtimeEvidence.ok === true
    && runtimeEvidence.live_status === 'scoped_live_verified'
    && runtimeEvidence.evidence_level === 'queue_live_scoped'
    && runtimeEvidence.release_ready === false
    && runtimeEvidence.source_model?.modified === false;
  const scopeCompatible = claimScope === 'image_structured_full'
    ? dsl?.metadata?.source_mode === 'image_structured'
      && runtimeEvidence.inputs?.source_mode === 'image_structured'
      && dsl?.metadata?.interpretation_eligible === true
    : claimScope === 'semantic_runtime_only'
      && dsl?.metadata?.source_mode !== 'image_structured'
      && runtimeEvidence.inputs?.source_mode === dsl?.metadata?.source_mode
      && dsl?.metadata?.interpretation_eligible === false
      && runtimeEvidence.inputs?.interpretation_eligible === false;
  const freshHandshake = runtimeEvidence.runtime === 'queue'
    && runtimeEvidence.fresh_capability_handshake === true
    && runtimeEvidence.capability_runtime === 'queue';
  const captures = (runtimeEvidence.steps || []).filter((step) => step.kind === 'capture_view' && step.ok === true);
  const semanticStep = [...(runtimeEvidence.steps || [])].reverse().find((step) => step.kind === 'semantic_revalidation');
  const captureViews = new Set(captures.map((capture) => capture.view));
  const captureEvidence = captures.every((capture) => /^sha256:[a-f0-9]{64}$/.test(String(capture.sha256 || '')))
    && captures.every((capture) => capture.server_visual_capture === true && capture.read_only_attestation_verified === true)
    && captureViews.has('front') && captureViews.has('oblique');
  const requiredHandshakeTargets = new Set(['build', 'save', 'reopen', 'capture_front', 'capture_oblique']);
  const handshakeTargets = new Set((runtimeEvidence.steps || []).filter((step) => step.kind === 'fresh_queue_handshake' && step.ok === true).map((step) => step.for_step));
  const perStepFreshHandshakes = [...requiredHandshakeTargets].every((target) => handshakeTargets.has(target));
  const runtimeBindingMatches = (runtimeEvidence.inputs?.provenance_binding_hash ?? null) === (dsl?.metadata?.provenance_binding_hash ?? null);
  const sourceAssetBindingMatches = dsl?.metadata?.source_mode !== 'image_structured'
    || (/^sha256:[a-f0-9]{64}$/.test(String(dsl?.metadata?.source_asset_binding_hash || ''))
      && runtimeEvidence.inputs?.source_asset_binding_hash === dsl.metadata.source_asset_binding_hash);
  const nativeMeshRequired = (dsl?.operations || []).some((operation) => operation.qa?.mesh_semantic);
  const nativeMeshVerified = !nativeMeshRequired || runtimeEvidence.evidence_limits?.native_face_normal_remeasurement === true;
  const verified = reportShape && scopeCompatible && freshHandshake && sequenceOk && captures.length >= 2 && captureEvidence
    && perStepFreshHandshakes && runtimeBindingMatches && sourceAssetBindingMatches && nativeMeshVerified && semanticStep?.ok === true
    && runtimeEvidence.save_reopen_semantic_digest_matches === true;
  return runtimeEvidenceLevels({
    dsl,
    runtimeEvidence,
    offline,
    live: verified
      ? { status: 'verified', evidence_level: 'queue_live_scoped', captures: captures.length, sequence: LIVE_SEQUENCE }
      : {
          status: 'live_unverified',
          evidence_level: 'none',
          reason: 'fresh_queue_build_save_reopen_multiview_semantic_evidence_incomplete',
          checks: {
            report_shape: reportShape,
            claim_scope_compatible: scopeCompatible,
            fresh_handshake: freshHandshake,
            per_step_fresh_handshakes: perStepFreshHandshakes,
            sequence: sequenceOk,
            captures: captures.length,
            capture_evidence: captureEvidence,
            runtime_binding_matches: runtimeBindingMatches,
            source_asset_binding_matches: sourceAssetBindingMatches,
            native_mesh_remeasurement: nativeMeshVerified,
            semantic_revalidation: semanticStep?.ok === true
          }
        }
  });
}

function runtimeEvidenceLevels({ dsl, runtimeEvidence, offline = null, live = null }) {
  const resolvedOffline = offline || {
    status: dsl?.operations?.length ? 'pass' : 'not_available',
    evidence_level: dsl?.operations?.length ? 'offline_compile' : 'none',
    operation_count: dsl?.operations?.length || 0,
    mock_build_ok: null
  };
  const resolvedLive = live || { status: 'live_unverified', evidence_level: 'none', reason: 'fresh_queue_end_to_end_evidence_missing' };
  return {
    preview: {
      status: dsl?.operations?.length ? 'verified' : 'not_available',
      evidence_level: dsl?.operations?.length ? 'safe_json_dsl_preview' : 'none',
      queue_called: false
    },
    offline: resolvedOffline,
    mock: {
      status: runtimeEvidence?.mock_build_ok === true ? 'verified' : 'not_verified',
      evidence_level: runtimeEvidence?.mock_build_ok === true ? 'offline_mock' : 'none'
    },
    live: resolvedLive,
    release: {
      status: 'not_accepted',
      evidence_level: 'none',
      release_ready: false
    }
  };
}

function containsOrderedSequence(actual, required) {
  let cursor = 0;
  for (const step of actual) {
    if (step === required[cursor]) cursor += 1;
    if (cursor === required.length) return true;
  }
  return false;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
