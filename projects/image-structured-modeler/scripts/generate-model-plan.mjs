#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot, toRepoRelative } from './lib/image-analysis.mjs';

const LEGACY_STATUS_TO_EVIDENCE_STATUS = {
  visually_detected: 'observed',
  inferred: 'inferred',
  manually_confirmed: 'manual_confirmed'
};

const EVIDENCE_STATUS_TO_LEGACY_STATUS = {
  observed: 'visually_detected',
  inferred: 'inferred',
  template_prior: 'inferred',
  manual_confirmed: 'manually_confirmed'
};

const FEATURE_SEMANTICS_BY_TYPE = {
  analog_stick: ['convex', 'blind_recess'],
  beveled_panel: ['flush'],
  button_on_panel: ['convex'],
  grip_handle: ['convex'],
  lofted_shell: ['flush'],
  logo_emboss: ['convex'],
  mesh_reference: ['flush'],
  rounded_box: ['flush'],
  screw_hole: ['through_hole'],
  slot: ['blind_recess'],
  text_engrave: ['decal_printed'],
  trigger: ['convex']
};

const PART_VIEW_REQUIREMENTS = {
  switch_controller: {
    center_grip_body: ['front', 'rear'],
    left_joycon_shell: ['front'],
    right_joycon_shell: ['front'],
    rear_grip_pair: ['rear', 'right'],
    left_thumbstick: ['front'],
    right_thumbstick: ['front'],
    abxy_cluster: ['front'],
    left_button_cluster: ['front'],
    shoulder_rail_pair: ['right']
  },
  compact_remote: {
    remote_body: ['front', 'right'],
    remote_face_panel: ['front'],
    navigation_pad: ['front'],
    primary_button_cluster: ['front'],
    volume_rocker: ['front'],
    speaker_grille: ['front'],
    brand_label: ['front']
  }
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = path.resolve(repoRoot, options.input || 'projects/image-structured-modeler/examples/switch-controller/observations.json');
  const output = path.resolve(repoRoot, options.output || 'projects/image-structured-modeler/examples/switch-controller/model-plan.json');
  const observationSet = JSON.parse(await fs.readFile(input, 'utf8'));
  const manualCorrections = options.manualCorrections
    ? JSON.parse(await fs.readFile(path.resolve(repoRoot, options.manualCorrections), 'utf8'))
    : null;
  const modelPlan = generateModelPlan(observationSet, {
    knownWidth: numberOption(options.knownWidth),
    knownHeight: numberOption(options.knownHeight),
    knownDepth: numberOption(options.knownDepth),
    manualCorrections
  });

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(modelPlan, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, output, parts: modelPlan.parts.length }, null, 2)}\n`);
}

export function generateModelPlan(observationSet, options = {}) {
  const manualCorrections = options.manualCorrections || null;
  const objectProfile = inferObjectProfile(observationSet, manualCorrections, options.objectProfile);
  const defaults = profileDefaults(objectProfile);
  const knownWidth = options.knownWidth ?? manualCorrections?.scale?.known_width ?? defaults.knownWidth;
  const knownHeight = options.knownHeight ?? manualCorrections?.scale?.known_height ?? defaults.knownHeight;
  const knownDepth = options.knownDepth ?? manualCorrections?.scale?.known_depth ?? defaults.knownDepth;
  const viewIds = makeViewIds(observationSet.images || []);
  const views = (observationSet.images || []).map((image) => ({
    id: viewIds.get(image.image.path),
    kind: image.detected_view.kind,
    source_image: image.image.path,
    confidence: image.detected_view.confidence
  }));

  const evidence = (componentHints, preferredKinds = ['front', 'rear', 'right']) => {
    const hints = Array.isArray(componentHints) ? componentHints : [componentHints];
    const matches = [];
    for (const image of observationSet.images || []) {
      if (!preferredKinds.includes(image.detected_view.kind)) continue;
      for (const observation of image.observations || []) {
        if (!hints.includes(observation.component_hint)) continue;
        matches.push(evidenceFromObservation(observation, image, viewIds.get(image.image.path)));
      }
    }
    if (matches.length > 0) return matches.slice(0, 4);
    return [{
      view: views[0]?.id || 'unknown_view',
      kind: 'manual_note',
      confidence: 0.35,
      note: `No direct component candidate yet for ${hints.join('/')}; generated from controller layout prior.`
    }];
  };

  const object = {
    type: observationSet.object?.type || 'game_controller',
    name: observationSet.object?.name || 'Switch Joy-Con Grip Controller',
    profile: objectProfile,
    source_images: observationSet.object?.source_images || []
  };

  const modelPlan = {
    version: 1,
    object,
    scale: {
      units: 'mm',
      known_width: knownWidth,
      known_height: knownHeight,
      known_depth: knownDepth,
      confidence: observationSet.missing_views?.includes('top') ? 0.58 : 0.72
    },
    views,
    parts: objectProfile === 'compact_remote' ? compactRemoteParts(evidence) : [
      {
        id: 'center_grip_body',
        type: 'beveled_panel',
        material: 'Satin_Black_Plastic',
        parameters: { width: 96, height: 150, thickness: 26, corner_radius: 8 },
        evidence: evidence('center_grip_body', ['front', 'rear'])
      },
      {
        id: 'left_joycon_shell',
        type: 'lofted_shell',
        material: 'Warm_White_Plastic',
        parameters: { width: 92, height: 155, thickness: 24, side: 'left', mirror_pair: 'right_joycon_shell' },
        evidence: evidence('left_joycon_shell', ['front'])
      },
      {
        id: 'right_joycon_shell',
        type: 'lofted_shell',
        material: 'Warm_White_Plastic',
        parameters: { width: 92, height: 155, thickness: 24, side: 'right', mirror_pair: 'left_joycon_shell' },
        evidence: evidence('right_joycon_shell', ['front'])
      },
      {
        id: 'rear_grip_pair',
        type: 'grip_handle',
        material: 'Satin_Black_Plastic',
        parameters: { symmetric: true, width_each: 54, height: 132, thickness: 36, needs_side_profile: true },
        evidence: evidence(['rear_grip_left', 'rear_grip_right', 'side_thickness_profile'], ['rear', 'right'])
      },
      {
        id: 'left_thumbstick',
        type: 'analog_stick',
        parent: 'left_joycon_shell',
        material: 'Rubber_Thumbstick',
        parameters: { center: [-92, -20, 26], outer_radius: 11, top_radius: 9.5, height: 14, recess_depth: 2.5 },
        evidence: evidence('left_thumbstick', ['front'])
      },
      {
        id: 'right_thumbstick',
        type: 'analog_stick',
        parent: 'right_joycon_shell',
        material: 'Rubber_Thumbstick',
        parameters: { center: [72, 34, 26], outer_radius: 10.5, top_radius: 9, height: 13, recess_depth: 2.5 },
        evidence: evidence('right_thumbstick', ['front']),
        uncertainty: ['Inferred from Switch controller layout; current photos need semantic confirmation.']
      },
      {
        id: 'abxy_cluster',
        type: 'button_on_panel',
        parent: 'right_joycon_shell',
        material: 'Gloss_Black_Button',
        parameters: {
          buttons: [
            { label: 'X', center: [104, -36], radius: 5.8 },
            { label: 'Y', center: [88, -20], radius: 5.6 },
            { label: 'A', center: [120, -20], radius: 5.6 },
            { label: 'B', center: [104, -4], radius: 5.6 }
          ]
        },
        evidence: evidence('abxy_cluster', ['front'])
      },
      {
        id: 'left_button_cluster',
        type: 'button_on_panel',
        parent: 'left_joycon_shell',
        material: 'Gloss_Black_Button',
        parameters: {
          buttons: [
            { label: 'L1', center: [-122, 20], radius: 4.8 },
            { label: 'L2', center: [-108, 8], radius: 4.8 },
            { label: 'L3', center: [-94, 20], radius: 4.8 },
            { label: 'L4', center: [-108, 32], radius: 4.8 }
          ]
        },
        evidence: evidence('left_button_cluster', ['front']),
        uncertainty: ['Button labels and exact positions need manual review.']
      },
      {
        id: 'shoulder_rail_pair',
        type: 'trigger',
        material: 'Satin_Black_Plastic',
        parameters: { width_each: 76, height: 11, thickness: 6 },
        evidence: evidence('side_thickness_profile', ['right'])
      }
    ],
    review: {
      overlay_path: observationSet.review?.overlay_dir || null,
      open_questions: observationSet.review?.open_questions || []
    }
  };

  return finalizeEvidenceAnnotations(applyManualCorrections(modelPlan, manualCorrections), observationSet);
}

export function applyManualCorrections(modelPlan, corrections) {
  if (!corrections) return modelPlan;
  if (corrections.version !== 1) throw new Error('manual corrections version must be 1');
  const next = structuredClone(modelPlan);
  const applied = [];

  if (corrections.scale) {
    for (const [correctionKey, modelKey] of [
      ['known_width', 'known_width'],
      ['known_height', 'known_height'],
      ['known_depth', 'known_depth'],
      ['confidence', 'confidence']
    ]) {
      if (corrections.scale[correctionKey] !== undefined) {
        next.scale[modelKey] = corrections.scale[correctionKey];
        applied.push(`scale.${modelKey}`);
      }
    }
  }

  for (const correction of corrections.parts || []) {
    const index = next.parts.findIndex((part) => part.id === correction.id);
    if (correction.action === 'remove') {
      if (index >= 0) {
        next.parts.splice(index, 1);
        applied.push(`remove:${correction.id}`);
      }
      continue;
    }

    if (correction.action === 'add') {
      if (index >= 0) throw new Error(`manual correction add target already exists: ${correction.id}`);
      next.parts.push({
        id: correction.id,
        type: correction.type,
        parent: correction.parent,
        material: correction.material,
        parameters: correction.parameters || {},
        evidence: [manualEvidence(correction)],
        ...(correction.uncertainty ? { uncertainty: correction.uncertainty } : {})
      });
      applyCorrectionMetadata(next.parts.at(-1), correction);
      applied.push(`add:${correction.id}`);
      continue;
    }

    if (correction.action === 'update') {
      if (index < 0) throw new Error(`manual correction update target not found: ${correction.id}`);
      const target = next.parts[index];
      if (correction.type) target.type = correction.type;
      if (correction.parent) target.parent = correction.parent;
      if (correction.material) target.material = correction.material;
      if (correction.parameters) target.parameters = deepMerge(target.parameters || {}, correction.parameters);
      if (correction.uncertainty) target.uncertainty = correction.uncertainty;
      target.evidence = [...(target.evidence || []), manualEvidence(correction)];
      applyCorrectionMetadata(target, correction);
      applied.push(`update:${correction.id}`);
      continue;
    }

    throw new Error(`Unsupported manual correction action: ${correction.action}`);
  }

  if (corrections.review?.open_questions) {
    next.review.open_questions = corrections.review.open_questions;
    applied.push('review.open_questions');
  }
  if (corrections.object_profile) {
    next.object.profile = normalizeObjectProfile(corrections.object_profile);
    applied.push('object.profile');
  }
  next.review.corrections_applied = applied;
  if (corrections.notes?.length) next.review.correction_notes = corrections.notes;
  return next;
}

function applyCorrectionMetadata(target, correction) {
  if (correction.evidence_status) target.evidence_status = correction.evidence_status;
  else if (correction.evidence_note || correction.manual_confirmed === true) target.evidence_status = 'manual_confirmed';
  if (correction.evidence_sources) {
    target.evidence_sources = [...(target.evidence_sources || []), ...correction.evidence_sources];
  }
  if (correction.template_prior !== undefined) target.template_prior = correction.template_prior;
  if (correction.manual_confirmed !== undefined) target.manual_confirmed = correction.manual_confirmed;
  else if (correction.evidence_note || target.evidence_status === 'manual_confirmed') target.manual_confirmed = true;
  if (correction.feature_semantics) target.feature_semantics = correction.feature_semantics;
  if (correction.feature_mapping) target.feature_mapping = correction.feature_mapping;
}

function finalizeEvidenceAnnotations(modelPlan, observationSet) {
  const next = structuredClone(modelPlan);
  const viewKindById = new Map((next.views || []).map((view) => [view.id, view.kind]));
  const imageByViewId = new Map((next.views || []).map((view) => [view.id, view.source_image]));
  const requirementsByPart = PART_VIEW_REQUIREMENTS[next.object?.profile] || {};
  const statusCounts = { observed: 0, inferred: 0, template_prior: 0, manual_confirmed: 0 };
  const templatePriorParts = [];
  const manualConfirmedParts = [];

  for (const part of next.parts || []) {
    const generatedSources = (part.evidence || []).map((item) => evidenceSourceFromEvidence(item, viewKindById, imageByViewId));
    part.evidence_sources = dedupeEvidenceSources([...(part.evidence_sources || []), ...generatedSources]);

    const requiredViews = requirementsByPart[part.id] || [];
    const observedViews = new Set(part.evidence_sources
      .filter((source) => source.status === 'observed' || source.status === 'manual_confirmed')
      .map((source) => viewKindById.get(source.view) || source.view));
    const missingRequiredViews = requiredViews.filter((kind) => !observedViews.has(kind));
    const hasManualEvidence = part.manual_confirmed === true
      || part.status === 'manually_confirmed'
      || part.evidence_sources.some((source) => source.status === 'manual_confirmed');

    if (!part.evidence_status) {
      part.evidence_status = deriveEvidenceStatus({
        part,
        hasManualEvidence,
        missingRequiredViews,
        requiredViews
      });
    }
    part.status = part.status || EVIDENCE_STATUS_TO_LEGACY_STATUS[part.evidence_status];
    part.manual_confirmed = hasManualEvidence || part.evidence_status === 'manual_confirmed';
    part.template_prior = part.template_prior ?? usesTemplatePrior(part, next.object?.profile, missingRequiredViews);
    part.feature_semantics = part.feature_semantics || FEATURE_SEMANTICS_BY_TYPE[part.type] || [];
    if (!part.feature_mapping) {
      part.feature_mapping = defaultFeatureMapping(part, next.object?.profile);
    }
    if (missingRequiredViews.length > 0) {
      part.uncertainty = addUnique(
        part.uncertainty || [],
        `Missing required view evidence for ${missingRequiredViews.join(', ')}; current geometry uses profile assumptions.`
      );
    }

    statusCounts[part.evidence_status] += 1;
    if (part.template_prior) templatePriorParts.push(part.id);
    if (part.manual_confirmed) manualConfirmedParts.push(part.id);
  }

  next.review = next.review || {};
  next.review.evidence_summary = {
    image_count: observationSet.images?.length || 0,
    views_detected: observationSet.views_detected || [],
    missing_views: observationSet.missing_views || [],
    status_counts: statusCounts,
    template_prior_parts: templatePriorParts,
    manual_confirmed_parts: manualConfirmedParts
  };
  next.review.evidence_graph = createEvidenceGraph(next, observationSet, requirementsByPart);
  next.review.semantic_fusion = createSemanticFusion(next, observationSet);
  next.review.correction_suggestions = createCorrectionSuggestions(next);
  for (const question of next.review.evidence_graph.open_questions) {
    next.review.open_questions = addUnique(next.review.open_questions || [], question);
  }
  for (const question of next.review.semantic_fusion.open_questions) {
    next.review.open_questions = addUnique(next.review.open_questions || [], question);
  }
  if ((observationSet.images?.length || 0) < 2) {
    next.review.open_questions = addUnique(
      next.review.open_questions || [],
      'Single-image run: profile prior fills unobserved geometry; do not treat this as multi-view confirmed.'
    );
  }
  if (templatePriorParts.length > 0) {
    next.review.open_questions = addUnique(
      next.review.open_questions || [],
      `Review template-prior parts before treating them as image-confirmed: ${templatePriorParts.join(', ')}.`
    );
  }
  return next;
}

function createEvidenceGraph(modelPlan, observationSet, requirementsByPart) {
  const viewKindById = new Map((modelPlan.views || []).map((view) => [view.id, view.kind]));
  const observationGraph = observationSet.evidence_graph?.image_count === (observationSet.images?.length || 0)
    ? observationSet.evidence_graph
    : null;
  const observationGraphParts = new Map((observationGraph?.parts || []).map((part) => [part.part_id, part]));
  const openQuestions = [];
  const parts = (modelPlan.parts || []).map((part) => {
    const observationGraphPart = observationGraphParts.get(part.id);
    const requiredViews = requirementsByPart[part.id] || observationGraphPart?.required_views || [];
    const sources = dedupeGraphSources([
      ...(observationGraphPart?.sources || []).map((source) => normalizeGraphSource(source, viewKindById)),
      ...(part.evidence_sources || []).map((source) => normalizeGraphSource(source, viewKindById))
    ]);
    const confirmedViews = uniqueArray(sources
      .filter((source) => source.status === 'observed' || source.status === 'manual_confirmed')
      .map((source) => source.view_kind || source.view));
    const missingViews = requiredViews.filter((view) => !confirmedViews.includes(view));
    const conflicts = [...(observationGraphPart?.conflicts || [])];
    const partQuestions = [...(observationGraphPart?.open_questions || [])];

    if (missingViews.length > 0) {
      conflicts.push({
        type: 'missing_required_view',
        severity: 'warn',
        views: missingViews,
        note: `Missing required view evidence for ${missingViews.join(', ')}.`
      });
      partQuestions.push(`${part.id}: confirm ${missingViews.join(', ')} evidence before treating geometry as fully observed.`);
    }

    const lowConfidenceSources = sources.filter((source) => source.status === 'observed' && source.confidence !== undefined && source.confidence < 0.5);
    if (lowConfidenceSources.length > 0) {
      conflicts.push({
        type: 'low_confidence_evidence',
        severity: 'info',
        views: uniqueArray(lowConfidenceSources.map((source) => source.view_kind || source.view)),
        note: `${lowConfidenceSources.length} observed evidence source(s) are below 0.5 confidence.`
      });
    }

    if (part.template_prior) {
      conflicts.push({
        type: 'template_prior_used',
        severity: part.evidence_status === 'template_prior' ? 'warn' : 'info',
        views: requiredViews,
        note: 'Profile prior contributes to this part; review before considering it image-confirmed.'
      });
      partQuestions.push(`${part.id}: review profile-prior dimensions and feature semantics.`);
    }
    if (part.feature_mapping?.fallback && part.feature_mapping.fallback !== 'none') {
      conflicts.push({
        type: 'feature_mapping_fallback',
        severity: 'warn',
        note: `Feature maps to ${part.feature_mapping.operation || 'unknown'} with ${part.feature_mapping.fallback} fallback: ${part.feature_mapping.note || 'no detail'}`
      });
      partQuestions.push(`${part.id}: confirm whether ${part.feature_semantics?.join('/') || 'feature'} should stay as ${part.feature_mapping.fallback} or wait for real feature editing.`);
    }

    for (const question of partQuestions) openQuestions.push(question);
    return {
      part_id: part.id,
      status: part.evidence_status,
      template_prior: Boolean(part.template_prior),
      manual_confirmed: Boolean(part.manual_confirmed),
      required_views: requiredViews,
      confirmed_views: confirmedViews,
      missing_views: missingViews,
      feature_semantics: part.feature_semantics || [],
      sources,
      conflicts: dedupeGraphConflicts(conflicts),
      open_questions: uniqueArray(partQuestions)
    };
  });

  return {
    version: 1,
    image_count: observationSet.images?.length || 0,
    views_detected: observationSet.views_detected || [],
    missing_views: observationSet.missing_views || [],
    parts,
    open_questions: uniqueArray(openQuestions)
  };
}

function createSemanticFusion(modelPlan, observationSet) {
  const graphParts = new Map((modelPlan.review?.evidence_graph?.parts || []).map((part) => [part.part_id, part]));
  const imageCount = observationSet.images?.length || 0;
  const parts = (modelPlan.parts || []).map((part) => {
    const graphPart = graphParts.get(part.id) || {};
    const requiredViews = graphPart.required_views || [];
    const confirmedViews = graphPart.confirmed_views || [];
    const missingViews = graphPart.missing_views || [];
    const sources = graphPart.sources || part.evidence_sources || [];
    const observedSources = sources.filter((source) => source.status === 'observed' || source.status === 'manual_confirmed');
    const sourceViews = uniqueArray(sources.map((source) => source.view_kind || source.view));
    const conflictTypes = uniqueArray((graphPart.conflicts || []).map((conflict) => conflict.type));
    const fallback = part.feature_mapping?.fallback && part.feature_mapping.fallback !== 'none';
    const evidenceConfidence = averageConfidence(observedSources.length ? observedSources : sources, part.evidence_status);
    const requiredViewCoverage = requiredViews.length
      ? (requiredViews.length - missingViews.length) / requiredViews.length
      : (confirmedViews.length > 0 ? 1 : 0);
    const featureMappingConfidence = featureMappingConfidenceForPart(part);
    const confidence = fusionConfidence({
      evidenceConfidence,
      requiredViewCoverage,
      featureMappingConfidence,
      manualConfirmed: part.manual_confirmed,
      templatePrior: part.template_prior,
      fallback,
      imageCount
    });
    const decision = fusionDecision({
      part,
      requiredViews,
      missingViews,
      fallback,
      imageCount
    });
    const status = fusionStatus({ decision, confidence, missingViews, fallback, templatePrior: part.template_prior });
    const reviewFlags = fusionReviewFlags({ part, graphPart, missingViews, fallback, imageCount, confidence });
    const semanticEvidence = (part.feature_semantics || []).map((semantic) => ({
      semantic,
      confidence: semanticConfidenceForPart({ part, semantic, decision, fallback, evidenceConfidence }),
      sources: observedSourcesForSemantic(sources, semantic)
    }));

    return {
      part_id: part.id,
      status,
      decision,
      confidence,
      required_views: requiredViews,
      confirmed_views: confirmedViews,
      missing_views: missingViews,
      source_views: sourceViews,
      semantic_labels: part.feature_semantics || [],
      semantic_evidence: semanticEvidence,
      feature_mapping: part.feature_mapping || null,
      signals: {
        image_count: imageCount,
        source_count: sources.length,
        observed_source_count: observedSources.length,
        required_view_coverage: round3(requiredViewCoverage),
        evidence_confidence: evidenceConfidence,
        feature_mapping_confidence: featureMappingConfidence,
        conflict_types: conflictTypes
      },
      review_flags: reviewFlags
    };
  });

  const openQuestions = [];
  for (const part of parts) {
    if (part.status === 'needs_review') {
      openQuestions.push(`${part.part_id}: semantic fusion needs review (${part.review_flags.join(', ') || part.decision}).`);
    } else if (part.status === 'partial') {
      openQuestions.push(`${part.part_id}: semantic fusion is partial; confirm before treating as fully image-derived.`);
    }
  }

  return {
    version: 1,
    strategy: 'graph_cross_view_semantic_fusion',
    image_count: imageCount,
    views_detected: observationSet.views_detected || [],
    summary: semanticFusionSummary(parts),
    parts,
    open_questions: uniqueArray(openQuestions)
  };
}

function semanticFusionSummary(parts) {
  const summary = {
    total_parts: parts.length,
    confirmed: 0,
    partial: 0,
    needs_review: 0,
    cross_view_confirmed_parts: [],
    fallback_parts: [],
    template_prior_parts: []
  };
  for (const part of parts) {
    summary[part.status] += 1;
    if (part.decision === 'cross_view_confirmed') summary.cross_view_confirmed_parts.push(part.part_id);
    if (part.review_flags.includes('feature_mapping_fallback')) summary.fallback_parts.push(part.part_id);
    if (part.review_flags.includes('template_prior')) summary.template_prior_parts.push(part.part_id);
  }
  return summary;
}

function fusionDecision({ part, requiredViews, missingViews, fallback, imageCount }) {
  if (fallback) return 'feature_fallback';
  if (part.manual_confirmed) return 'manual_confirmed';
  if (missingViews.length > 0 && part.template_prior) return 'template_prior_assisted';
  if (missingViews.length > 0) return 'missing_required_view';
  if (requiredViews.length > 1 && imageCount > 1) return 'cross_view_confirmed';
  if (requiredViews.length === 1 && imageCount > 0) return 'single_view_confirmed';
  if (part.template_prior) return 'template_prior_assisted';
  return 'observed';
}

function fusionStatus({ decision, confidence, missingViews, fallback, templatePrior }) {
  if (fallback || missingViews.length > 0 || confidence < 0.55) return 'needs_review';
  if (decision === 'manual_confirmed' || decision === 'cross_view_confirmed') return 'confirmed';
  if (templatePrior || confidence < 0.78) return 'partial';
  return 'confirmed';
}

function fusionReviewFlags({ part, graphPart, missingViews, fallback, imageCount, confidence }) {
  const flags = [];
  if (imageCount < 2) flags.push('single_image');
  if (missingViews.length > 0) flags.push('missing_required_view');
  if (part.template_prior) flags.push('template_prior');
  if (fallback) flags.push('feature_mapping_fallback');
  if ((graphPart.conflicts || []).some((conflict) => conflict.type === 'low_confidence_evidence')) flags.push('low_confidence_evidence');
  if (confidence < 0.55) flags.push('low_fusion_confidence');
  return uniqueArray(flags);
}

function fusionConfidence({ evidenceConfidence, requiredViewCoverage, featureMappingConfidence, manualConfirmed, templatePrior, fallback, imageCount }) {
  let score = 0.42 * requiredViewCoverage + 0.34 * evidenceConfidence + 0.24 * featureMappingConfidence;
  if (manualConfirmed) score += 0.12;
  if (imageCount > 1 && requiredViewCoverage === 1) score += 0.06;
  if (templatePrior) score -= 0.12;
  if (fallback) score -= 0.16;
  return clamp01(round3(score));
}

function averageConfidence(sources, fallbackStatus) {
  const values = (sources || [])
    .map((source) => source.confidence)
    .filter((value) => Number.isFinite(value));
  if (values.length > 0) return round3(values.reduce((sum, value) => sum + value, 0) / values.length);
  if (fallbackStatus === 'manual_confirmed') return 0.95;
  if (fallbackStatus === 'observed') return 0.72;
  if (fallbackStatus === 'inferred') return 0.55;
  return 0.38;
}

function featureMappingConfidenceForPart(part) {
  if (!part.feature_mapping) return 0.5;
  if (part.feature_mapping.fallback && part.feature_mapping.fallback !== 'none') return 0.42;
  return 0.86;
}

function semanticConfidenceForPart({ part, decision, fallback, evidenceConfidence }) {
  let score = evidenceConfidence;
  if (part.manual_confirmed) score = Math.max(score, 0.9);
  if (decision === 'cross_view_confirmed') score = Math.max(score, 0.82);
  if (part.template_prior) score -= 0.12;
  if (fallback) score -= 0.16;
  return clamp01(round3(score));
}

function observedSourcesForSemantic(sources, semantic) {
  const semanticKind = semanticSourceKind(semantic);
  return (sources || [])
    .filter((source) => source.status === 'observed' || source.status === 'manual_confirmed')
    .filter((source) => !semanticKind || source.kind === semanticKind || source.kind === 'silhouette' || source.kind === 'manual_note')
    .map((source) => ({
      view: source.view,
      view_kind: source.view_kind || source.view,
      status: source.status,
      kind: source.kind,
      ...(source.confidence !== undefined ? { confidence: source.confidence } : {})
    }))
    .slice(0, 4);
}

function semanticSourceKind(semantic) {
  if (semantic === 'decal_printed') return 'text_label';
  if (semantic === 'through_hole' || semantic === 'blind_recess') return 'edge';
  if (semantic === 'convex' || semantic === 'concave') return 'center_point';
  return null;
}

function createCorrectionSuggestions(modelPlan) {
  const suggestions = [];
  const fusionParts = new Map((modelPlan.review?.semantic_fusion?.parts || []).map((part) => [part.part_id, part]));
  for (const graphPart of modelPlan.review?.evidence_graph?.parts || []) {
    const part = modelPlan.parts.find((item) => item.id === graphPart.part_id);
    if (!part) continue;
    const fusionPart = fusionParts.get(part.id);
    const needsEvidencePatch = graphPart.missing_views.length > 0 || graphPart.template_prior;
    const fallbackConflict = graphPart.conflicts.find((conflict) => conflict.type === 'feature_mapping_fallback');
    if (!needsEvidencePatch && !fallbackConflict) continue;
    suggestions.push({
      part_id: part.id,
      reason: fallbackConflict?.note || graphPart.open_questions[0] || `Semantic fusion status: ${fusionPart?.status || 'review'}.`,
      fusion_status: fusionPart?.status || 'needs_review',
      fusion_decision: fusionPart?.decision || 'unknown',
      patch: {
        id: part.id,
        action: 'update',
        evidence_status: 'manual_confirmed',
        manual_confirmed: true,
        template_prior: false,
        ...(part.feature_semantics?.length ? { feature_semantics: part.feature_semantics } : {}),
        ...(part.feature_mapping ? { feature_mapping: part.feature_mapping } : {}),
        evidence_note: `Reviewer confirmed ${part.id}; replace this note with the view/feature evidence used.`
      }
    });
  }
  return suggestions;
}

function normalizeGraphSource(source, viewKindById) {
  return {
    view: source.view,
    view_kind: source.view_kind || viewKindById.get(source.view) || source.view,
    kind: source.kind,
    status: source.status,
    ...(source.source_image ? { source_image: source.source_image } : {}),
    ...(source.observation_id ? { observation_id: source.observation_id } : {}),
    ...(source.confidence !== undefined ? { confidence: source.confidence } : {}),
    ...(source.note ? { note: source.note } : {})
  };
}

function deriveEvidenceStatus({ part, hasManualEvidence, missingRequiredViews, requiredViews }) {
  if (hasManualEvidence) return 'manual_confirmed';
  if (part.status && LEGACY_STATUS_TO_EVIDENCE_STATUS[part.status]) {
    const status = LEGACY_STATUS_TO_EVIDENCE_STATUS[part.status];
    if (status !== 'observed' || missingRequiredViews.length === 0) return status;
  }
  if (requiredViews.length > 0 && missingRequiredViews.length === requiredViews.length) return 'template_prior';
  if (missingRequiredViews.length > 0 || part.uncertainty?.length) return 'inferred';
  if ((part.evidence_sources || []).some((source) => source.status === 'observed')) return 'observed';
  return 'template_prior';
}

function usesTemplatePrior(part, profile, missingRequiredViews) {
  if (part.evidence_status === 'template_prior' || missingRequiredViews.length > 0) return true;
  if (profile === 'switch_controller') return true;
  return part.status === 'inferred';
}

function defaultFeatureMapping(part, profile) {
  const semantics = new Set(part.feature_semantics || []);
  const faceFeatureCapable = ['slot', 'screw_hole', 'text_engrave', 'logo_emboss'].includes(part.type);
  if (semantics.has('through_hole') && faceFeatureCapable) {
    return {
      operation: 'cut_hole',
      fallback: 'none',
      note: 'Mapped to controlled face cut_hole using target-local face coordinates.'
    };
  }
  if (semantics.has('blind_recess') && faceFeatureCapable) {
    return {
      operation: 'cut_recess',
      fallback: 'none',
      note: 'Mapped to controlled face cut_recess using target-local face coordinates.'
    };
  }
  if (profile === 'compact_remote' && semantics.has('convex') && part.type === 'button_on_panel') {
    const operation = part.id === 'volume_rocker' ? 'add_raised_rib' : 'add_boss';
    return {
      operation,
      fallback: 'none',
      note: `Mapped to controlled face ${operation} on the remote face panel.`
    };
  }
  if (part.type === 'text_engrave' || part.type === 'logo_emboss') {
    return {
      operation: part.type,
      fallback: 'visual_marker',
      note: 'Text/logo semantics are preserved for review; solid boolean text is deferred.'
    };
  }
  return undefined;
}

function evidenceSourceFromEvidence(item, viewKindById, imageByViewId) {
  const source = {
    view: item.view,
    kind: item.kind,
    status: evidenceStatusForSource(item),
    ...(item.source_image || imageByViewId.get(item.view) ? { source_image: item.source_image || imageByViewId.get(item.view) } : {}),
    ...(item.observation_id ? { observation_id: item.observation_id } : {}),
    ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
    ...(item.note ? { note: item.note } : {})
  };
  if (viewKindById.has(item.view)) source.view_kind = viewKindById.get(item.view);
  return source;
}

function evidenceStatusForSource(item) {
  if (item.view === 'manual_correction') return 'manual_confirmed';
  if (item.kind === 'manual_note') return 'template_prior';
  return 'observed';
}

function dedupeEvidenceSources(sources) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    const key = [source.view, source.kind, source.observation_id || '', source.note || ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function dedupeGraphSources(sources) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    const key = [source.view, source.kind, source.observation_id || '', source.note || ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function dedupeGraphConflicts(conflicts) {
  const seen = new Set();
  const result = [];
  for (const conflict of conflicts) {
    const key = [conflict.type, conflict.severity, conflict.note].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(conflict);
  }
  return result;
}

function addUnique(items, item) {
  return items.includes(item) ? items : [...items, item];
}

function uniqueArray(items) {
  return [...new Set(items.filter((item) => item !== undefined && item !== null && item !== ''))];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function compactRemoteParts(evidence) {
  return [
    {
      id: 'remote_body',
      type: 'rounded_box',
      material: 'Remote_Graphite_Plastic',
      parameters: { width: 44, height: 158, thickness: 16, corner_radius: 10 },
      evidence: evidence(['remote_body', 'main_object'], ['front', 'right']),
      status: 'visually_detected'
    },
    {
      id: 'remote_face_panel',
      type: 'beveled_panel',
      material: 'Remote_Satin_Face',
      parameters: { width: 36, height: 136, thickness: 2, corner_radius: 6 },
      evidence: evidence('remote_face_panel', ['front']),
      status: 'inferred'
    },
    {
      id: 'navigation_pad',
      type: 'button_on_panel',
      parent: 'remote_face_panel',
      material: 'Remote_Button_Rubber',
      parameters: { center: [0, -30], size: [24, 24], corner_radius: 12, height: 2.2 },
      evidence: evidence('navigation_pad', ['front']),
      status: 'visually_detected'
    },
    {
      id: 'primary_button_cluster',
      type: 'button_on_panel',
      parent: 'remote_face_panel',
      material: 'Remote_Button_Rubber',
      parameters: {
        buttons: [
          { label: 'Power', center: [-10, -54], radius: 4.2 },
          { label: 'Home', center: [10, -54], radius: 4.2 },
          { label: 'Back', center: [-10, -10], radius: 3.8 },
          { label: 'Menu', center: [10, -10], radius: 3.8 }
        ]
      },
      evidence: evidence('primary_button_cluster', ['front']),
      status: 'visually_detected'
    },
    {
      id: 'volume_rocker',
      type: 'button_on_panel',
      parent: 'remote_face_panel',
      material: 'Remote_Button_Rubber',
      parameters: { center: [0, 24], size: [9, 28], corner_radius: 4.5, height: 2 },
      evidence: evidence('volume_rocker', ['front']),
      status: 'visually_detected'
    },
    {
      id: 'speaker_grille',
      type: 'slot',
      parent: 'remote_face_panel',
      material: 'Remote_Dark_Detail',
      parameters: { center: [0, -66], count: 5, spacing: 4, length: 2.4, width: 1, depth: 0.35 },
      evidence: evidence('speaker_grille', ['front']),
      status: 'inferred'
    },
    {
      id: 'brand_label',
      type: 'text_engrave',
      parent: 'remote_face_panel',
      material: 'Remote_Dark_Detail',
      parameters: { text: 'ALMA', center: [0, 52], height: 5, extrusion: 0.45 },
      evidence: evidence('brand_label', ['front']),
      status: 'manually_confirmed'
    }
  ];
}

function inferObjectProfile(observationSet, manualCorrections, optionProfile) {
  const explicit = optionProfile || manualCorrections?.object_profile || observationSet.object?.profile;
  if (explicit) return normalizeObjectProfile(explicit);
  const type = observationSet.object?.type || '';
  if (['remote_control', 'media_remote', 'compact_remote'].includes(type)) return 'compact_remote';
  return 'switch_controller';
}

function normalizeObjectProfile(value) {
  if (value === 'compact_remote' || value === 'remote_control' || value === 'media_remote') return 'compact_remote';
  if (value === 'switch_controller' || value === 'game_controller') return 'switch_controller';
  throw new Error(`Unsupported object_profile: ${value}`);
}

function profileDefaults(profile) {
  if (profile === 'compact_remote') {
    return { knownWidth: 44, knownHeight: 158, knownDepth: 16 };
  }
  return { knownWidth: 280, knownHeight: 155, knownDepth: 42 };
}

function manualEvidence(correction) {
  return {
    view: 'manual_correction',
    kind: 'manual_note',
    status: 'manual_confirmed',
    confidence: 0.95,
    note: correction.evidence_note || `Manual correction applied to ${correction.id}.`
  };
}

function deepMerge(base, override) {
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function makeViewIds(images) {
  const counts = new Map();
  const viewIds = new Map();
  for (const image of images) {
    const kind = image.detected_view.kind;
    const base = kind === 'right' || kind === 'left' ? 'side_photo' : `${kind}_photo`;
    const count = (counts.get(base) || 0) + 1;
    counts.set(base, count);
    viewIds.set(image.image.path, count === 1 ? base : `${base}_${count}`);
  }
  return viewIds;
}

function evidenceFromObservation(observation, image, view) {
  return {
    view,
    kind: evidenceKind(observation.kind),
    source_image: image.image.path,
    observation_id: observation.id,
    points: observation.points || bboxToPolygon(observation.bbox),
    confidence: observation.confidence,
    note: observation.note || `Evidence from ${observation.id}.`
  };
}

function evidenceKind(kind) {
  if (kind === 'center_point') return 'center_point';
  if (kind === 'edge' || kind === 'curve') return 'edge';
  if (kind === 'color_region') return 'color_region';
  if (kind === 'text_or_logo') return 'text_label';
  if (kind === 'component_bbox') return 'silhouette';
  return 'manual_note';
}

function bboxToPolygon(bbox) {
  if (!bbox) return undefined;
  const [x, y, width, height] = bbox;
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]];
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') options.input = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--known-width') options.knownWidth = argv[++index];
    else if (arg === '--known-height') options.knownHeight = argv[++index];
    else if (arg === '--known-depth') options.knownDepth = argv[++index];
    else if (arg === '--manual-corrections') options.manualCorrections = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function numberOption(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Expected positive number, got ${value}`);
  return number;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/generate-model-plan.mjs \\
    --input projects/image-structured-modeler/examples/switch-controller/observations.json \\
    --output projects/image-structured-modeler/examples/switch-controller/model-plan.json \\
    --manual-corrections projects/image-structured-modeler/examples/switch-controller/manual-corrections.json
`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
