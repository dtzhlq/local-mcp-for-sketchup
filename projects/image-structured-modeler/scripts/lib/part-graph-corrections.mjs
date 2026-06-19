import { withGroundingMetadata } from './grounding-v2.mjs';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

export function buildCorrectionPatchFromReferenceReport(partGraph, report, options = {}) {
  const edits = [];
  for (const suggestion of report?.correction_suggestions || []) {
    if (suggestion.action !== 'update_part_graph' || !suggestion.target) continue;
    const current = getPathValue(partGraph, suggestion.target);
    const value = deriveCorrectedValue(partGraph, suggestion.target, current, suggestion.evidence, options);
    const partId = suggestion.part_id || partIdFromPath(suggestion.target);
    const edit = {
      action: value.changed ? 'set' : 'review',
      path: suggestion.target,
      part_id: partId,
      reason: suggestion.reason || `Reference visual QA suggested ${suggestion.target}`,
      issue_type: suggestion.issue_type,
      rule_id: suggestion.rule_id,
      severity: suggestion.severity || 'warn',
      confidence: confidenceForSuggestion(suggestion),
      evidence: suggestion.evidence || null
    };
    if (value.changed) {
      edit.previous_value = current;
      edit.value = value.value;
      edit.note = value.note;
    }
    edits.push(edit);
  }
  return {
    version: 1,
    kind: 'part_graph_correction_patch',
    source: 'reference_visual_qa',
    target_part_graph_id: partGraph.id,
    report_verdict: report?.verdict || 'unknown',
    edits
  };
}

export function buildCorrectionPatchFromParameterProposals(partGraph, review = {}, options = {}) {
  const proposals = collectParameterProposals(partGraph);
  const accepted = acceptedProposalKeys(review);
  const edits = [];
  for (const proposal of proposals) {
    const key = proposalKey(proposal);
    const acceptedReview = accepted.get(key) || accepted.get(proposal.path);
    const autoAccepted = !accepted.size && proposal.status === 'ready_for_correction_patch' && proposal.review_required !== true;
    if (!acceptedReview && !autoAccepted) continue;
    const isPartCandidatePromotion = proposal.proposal_kind === 'part_candidates';
    const siblingShapePrimitive = proposal.parameter === 'shape.parameters'
      ? proposals.find((item) => item.part_id === proposal.part_id && item.parameter === 'shape.primitive')
      : null;
    const current = isPartCandidatePromotion
      ? []
      : getPathValue(partGraph, proposal.path);
    const reason = acceptedReview?.reason
      || acceptedReview?.note
      || `Accepted image-derived parameter proposal for ${proposal.path}`;
    edits.push({
      action: isPartCandidatePromotion ? 'promote_part_candidates' : 'set',
      path: proposal.path,
      part_id: proposal.part_id,
      reason,
      issue_type: 'parameter_proposal',
      rule_id: isPartCandidatePromotion ? 'accepted_part_candidate_proposal' : 'accepted_parameter_proposal',
      severity: proposal.review_required ? 'warn' : 'info',
      confidence: proposal.confidence,
      previous_value: current === undefined ? proposal.current_value : current,
      value: proposal.proposed_value,
      note: proposal.review_required
        ? 'Applied after explicit proposal review; source proposal was review-gated.'
        : 'Applied from a ready parameter proposal.',
      evidence: {
        proposal_kind: proposal.proposal_kind,
        parameter: proposal.parameter,
        basis: proposal.basis || [],
        review_required: Boolean(proposal.review_required),
        source_views: proposal.source_views || [],
        required_views: proposal.required_views || [],
        confirmed_views: proposal.confirmed_views || [],
        missing_views: proposal.missing_views || [],
        image_measurements: proposal.image_measurements || [],
        evidence_sources: proposal.evidence_sources || [],
        ...(siblingShapePrimitive ? { shape_primitive: siblingShapePrimitive.proposed_value } : {})
      },
      mark_evidence_status: options.markEvidenceStatus || 'manual_confirmed'
    });
  }
  return {
    version: 1,
    kind: 'part_graph_correction_patch',
    source: 'parameter_proposal_review',
    target_part_graph_id: partGraph.id,
    report_verdict: review.verdict || (edits.length ? 'accepted' : 'no_applicable_proposals'),
    edits
  };
}

export function applyCorrectionPatch(partGraph, patch) {
  const next = cloneJson(partGraph);
  const applied = [];
  for (const edit of patch?.edits || []) {
    if (edit.action === 'promote_part_candidates') {
      promotePartCandidates(next, edit, patch);
      applied.push(edit);
      continue;
    }
    if (edit.action !== 'set') continue;
    setPathValue(next, edit.path, edit.value);
    const part = partById(next, edit.part_id || partIdFromPath(edit.path));
    if (part) {
      part.evidence_status = edit.mark_evidence_status || part.evidence_status || 'inferred';
      appendCorrectionEvidence(part, edit, patch);
      if (patch.source === 'parameter_proposal_review' && edit.path?.includes('.shape.')) {
        if (edit.path.endsWith('.shape.parameters') && !part.shape?.primitive) {
          part.shape = {
            primitive: edit.evidence?.shape_primitive || part.candidate_shape?.primitive || 'rounded_box',
            parameters: part.shape?.parameters || edit.value
          };
        }
        part.compile = {
          ...(part.compile || {}),
          emit: true,
          promoted_by: 'parameter_proposal_review'
        };
        part.promoted_geometry = true;
        delete part.candidate_shape;
      }
      part.qa = {
        ...(part.qa || {}),
        ...(patch.source === 'parameter_proposal_review'
          ? { parameter_proposal_applied: true }
          : { reference_visual_corrected: true }),
        ...(patch.source === 'parameter_proposal_review' && edit.path?.includes('.shape.')
          ? { candidate_only: false, not_compiled: false, promoted_geometry: true }
          : {}),
        last_correction_rule: edit.rule_id || null
      };
    }
    applied.push(edit);
  }
  next.review = {
    ...(next.review || {}),
    correction_patches_applied: [
      ...(next.review?.correction_patches_applied || []),
      {
        source: patch.source || 'correction_patch',
        edits: applied.length,
        target_part_graph_id: patch.target_part_graph_id || next.id
      }
    ]
  };
  return { partGraph: next, applied };
}

export function summarizeCorrectionPatch(patch) {
  const edits = patch?.edits || [];
  return {
    total_edits: edits.length,
    set_edits: edits.filter((edit) => edit.action === 'set').length,
    promote_part_candidate_edits: edits.filter((edit) => edit.action === 'promote_part_candidates').length,
    review_edits: edits.filter((edit) => edit.action === 'review').length,
    targets: Array.from(new Set(edits.map((edit) => edit.part_id).filter(Boolean)))
  };
}

function promotePartCandidates(partGraph, edit, patch) {
  const parent = partById(partGraph, edit.part_id || partIdFromPath(edit.path));
  const candidateParts = Array.isArray(edit.value) ? edit.value : [];
  const promotedIds = candidateParts.map((part) => part.id).filter(Boolean);
  if (parent) {
    if (candidateParentBecomesReferenceOnly(parent, candidateParts)) {
      parent.compile = { ...(parent.compile || {}), emit: false };
      parent.fallback_state = parent.fallback_state === 'profile_default' ? parent.fallback_state : 'reference_only';
    }
    parent.qa = {
      ...(parent.qa || {}),
      parameter_proposal_applied: true,
      part_candidate_parent: true,
      promoted_candidate_part_ids: promotedIds,
      review_required: false,
      last_correction_rule: edit.rule_id || null
    };
    appendCorrectionEvidence(parent, edit, patch);
  }

  for (const candidate of candidateParts) {
    if (!candidate?.id) continue;
    const promoted = promotedCandidatePart(candidate, edit, patch);
    const existingIndex = (partGraph.parts || []).findIndex((part) => part.id === promoted.id);
    if (existingIndex >= 0) partGraph.parts[existingIndex] = promoted;
    else {
      partGraph.parts = [...(partGraph.parts || []), promoted];
    }
    updateEvidenceGraphForPromotedCandidate(partGraph, promoted, edit);
  }
}

function candidateParentBecomesReferenceOnly(parent, candidateParts) {
  if (parent.role === 'warehouse_row') return true;
  return candidateParts.some((part) => part.role === parent.role && part.type === parent.type);
}

function promotedCandidatePart(candidate, edit, patch) {
  const promoted = cloneJson(candidate);
  promoted.evidence_status = edit.mark_evidence_status || 'manual_confirmed';
  promoted.fallback_state = promotedFallbackState(promoted);
  promoted.compile = { ...(promoted.compile || {}), emit: true };
  delete promoted.review;
  promoted.qa = {
    ...(promoted.qa || {}),
    candidate_only: false,
    not_compiled: false,
    part_candidate_applied: true,
    review_required: false,
    parent_candidate_source: edit.part_id || promoted.parent || null,
    last_correction_rule: edit.rule_id || null
  };
  appendCorrectionEvidence(promoted, edit, patch);
  return withGroundingMetadata(promoted, {
    reviewRequired: false,
    helperAllowed: promoted.fallback_state === 'visual_helper'
  });
}

function promotedFallbackState(part) {
  if (part.role === 'warehouse_unit') return 'box_approximation';
  if (['parking_stall_row', 'parking_drive_aisle', 'tree_row'].includes(part.role)) return 'visual_helper';
  return part.fallback_state === 'needs_review' ? 'box_approximation' : part.fallback_state || 'box_approximation';
}

function appendCorrectionEvidence(part, edit, patch) {
  const evidenceKind = patch.source === 'parameter_proposal_review'
    ? 'parameter_proposal_review'
    : 'reference_visual_correction';
  part.evidence_sources = [
    ...(part.evidence_sources || []),
    {
      kind: evidenceKind,
      status: edit.mark_evidence_status || 'manual_confirmed',
      confidence: edit.confidence,
      note: `${edit.rule_id || edit.issue_type || 'reference_visual_qa'}: ${edit.reason}`
    }
  ];
}

function updateEvidenceGraphForPromotedCandidate(partGraph, promoted, edit) {
  const graphParts = partGraph.evidence_graph?.parts;
  if (!Array.isArray(graphParts)) return;
  const graphPart = graphParts.find((part) => part.part_id === promoted.id);
  if (!graphPart) return;
  graphPart.status = promoted.evidence_status;
  graphPart.confidence = Math.max(Number(graphPart.confidence) || 0, Number(edit.confidence) || 0);
  graphPart.grounding_status = promoted.grounding_status;
  graphPart.grounding_method = promoted.grounding_method;
  graphPart.source_observation_ids = promoted.source_observation_ids || [];
  graphPart.review_required = promoted.review_required ?? false;
  graphPart.photo_grade_eligible = promoted.photo_grade_eligible ?? false;
  graphPart.conflicts = (graphPart.conflicts || []).filter((conflict) => conflict.type !== 'review_gated_part_candidate');
  graphPart.open_questions = [`${promoted.id}: promoted from relation-derived candidate after explicit proposal review.`];
}

function collectParameterProposals(partGraph) {
  const proposals = [];
  for (const proposal of partGraph.review?.parameter_proposals || []) {
    if (proposal?.part_id && proposal?.path) proposals.push(proposal);
  }
  for (const part of partGraph.parts || []) {
    for (const proposal of part.parameter_proposals || []) {
      if (proposal?.part_id && proposal?.path) proposals.push(proposal);
    }
  }
  const seen = new Set();
  return proposals.filter((proposal) => {
    const key = proposalKey(proposal);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function acceptedProposalKeys(review = {}) {
  const accepted = new Map();
  for (const item of review.accepted_proposals || []) {
    if (typeof item === 'string') {
      accepted.set(item, { path: item });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    if (item.part_id && item.path) accepted.set(proposalKey(item), item);
    if (item.path) accepted.set(item.path, item);
  }
  return accepted;
}

function proposalKey(proposal) {
  return `${proposal.part_id}|${proposal.path}`;
}

function deriveCorrectedValue(partGraph, targetPath, current, evidence = {}, options = {}) {
  if (Array.isArray(current) && current.length === 3 && targetPath.endsWith('.origin')) {
    const delta = evidenceDelta(evidence);
    const axes = axesForView(evidence.view);
    if (delta && axes) {
      const next = [...current];
      const gain = Number.isFinite(options.gain) ? options.gain : 1;
      axes.forEach((axis, index) => {
        next[AXIS_INDEX[axis]] = round(next[AXIS_INDEX[axis]] - delta[index] * axisScale(partGraph, axis) * gain, 3);
      });
      return {
        changed: true,
        value: next,
        note: `Adjusted origin along ${axes.join('/')} using normalized ${evidence.metric || 'reference'} delta ${delta.map((item) => round(item, 4)).join(', ')}.`
      };
    }
  }

  if (Array.isArray(current) && current.length >= 2 && targetPath.endsWith('.size')) {
    const actual = Number(evidence.actual ?? evidence.actual_ratio ?? evidence.actual_aspect_ratio);
    const expected = Number(evidence.expected ?? evidence.expected_ratio ?? evidence.expected_aspect_ratio);
    if (Number.isFinite(actual) && Number.isFinite(expected) && actual > 0 && expected > 0) {
      const next = [...current];
      const ratio = Math.sqrt(expected / actual);
      next[0] = round(next[0] * ratio, 3);
      next[1] = round(next[1] / ratio, 3);
      return {
        changed: true,
        value: next,
        note: `Adjusted size from reference ${evidence.metric || 'ratio'} ${round(actual, 4)} -> ${round(expected, 4)}.`
      };
    }
  }

  return { changed: false, value: current, note: 'No deterministic correction available for this target path.' };
}

function evidenceDelta(evidence = {}) {
  if (Array.isArray(evidence.delta_norm) && evidence.delta_norm.length === 2) return evidence.delta_norm.map(Number);
  if (Array.isArray(evidence.actual) && Array.isArray(evidence.expected)) {
    return [
      Number(evidence.actual[0]) - Number(evidence.expected[0]),
      Number(evidence.actual[1]) - Number(evidence.expected[1])
    ];
  }
  if (Array.isArray(evidence.actual_delta) && Array.isArray(evidence.expected_delta)) {
    return [
      Number(evidence.actual_delta[0]) - Number(evidence.expected_delta[0]),
      Number(evidence.actual_delta[1]) - Number(evidence.expected_delta[1])
    ];
  }
  return null;
}

function axesForView(view) {
  if (view === 'top') return ['x', 'y'];
  if (view === 'front' || view === 'rear' || view === 'right') return ['y', 'z'];
  if (view === 'left') return ['x', 'z'];
  return null;
}

function axisScale(partGraph, axis) {
  if (axis === 'x') return partGraph.scale?.width || 1;
  if (axis === 'y') return partGraph.scale?.depth || 1;
  return partGraph.scale?.height || 1;
}

function confidenceForSuggestion(suggestion) {
  if (suggestion.severity === 'error') return 0.86;
  if (suggestion.severity === 'warn') return 0.72;
  return 0.58;
}

function getPathValue(document, targetPath) {
  return pathTokens(targetPath).reduce((current, token) => {
    if (current === undefined || current === null) return undefined;
    if (token.collection === 'parts') return partById(current, token.id);
    return current[token];
  }, document);
}

function setPathValue(document, targetPath, value) {
  const tokens = pathTokens(targetPath);
  const last = tokens.pop();
  const parent = tokens.reduce((current, token) => {
    if (token.collection === 'parts') return partById(current, token.id);
    if (!current[token] || typeof current[token] !== 'object') current[token] = {};
    return current[token];
  }, document);
  if (!parent || typeof last !== 'string') throw new Error(`Unable to set PartGraph path: ${targetPath}`);
  parent[last] = value;
}

function pathTokens(targetPath) {
  return String(targetPath).split('.').map((token) => {
    const partMatch = token.match(/^parts\[([^\]]+)\]$/);
    if (partMatch) return { collection: 'parts', id: partMatch[1] };
    return token;
  });
}

function partById(root, id) {
  const parts = Array.isArray(root) ? root : root?.parts;
  return parts?.find((part) => part.id === id) || null;
}

function partIdFromPath(targetPath) {
  return String(targetPath).match(/parts\[([^\]]+)\]/)?.[1] || null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
