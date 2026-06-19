#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './lib/image-analysis.mjs';

export function buildCandidatePromotionPatch({
  assetSet,
  candidateGraph,
  modelingBrief,
  promotionReview,
  sourceReview = 'candidate-promotion-review.draft.json'
} = {}) {
  if (!assetSet) throw new Error('assetSet is required');
  if (!candidateGraph) throw new Error('candidateGraph is required');
  if (!modelingBrief) throw new Error('modelingBrief is required');
  if (!promotionReview) throw new Error('promotionReview is required');

  const accepted = promotionReview.accepted_candidates || [];
  const candidateById = new Map((candidateGraph.candidates || []).map((candidate) => [candidate.id, candidate]));
  const acceptedBlockers = accepted.flatMap((candidate) => candidate.blockers || []);
  const resolvedBlockers = reviewResolvedBlockers(promotionReview);
  const draftViewReviewBlockers = draftViewReviewBlockersFor(promotionReview);
  const localDetailReviewBlockers = localDetailReviewBlockersFor({ promotionReview, accepted });
  const planeReviewBlockers = facadePlaneReviewBlockers({ candidateGraph, promotionReview });
  const unresolvedModelingInputs = (modelingBrief.missing_inputs || []).filter((blocker) => !resolvedBlockers.has(blocker));
  const reviewBlockers = unique([
    ...(assetSet.gates?.reasons || []),
    ...(modelingBrief.missing_inputs || []),
    ...(promotionReview.blockers || []),
    ...acceptedBlockers,
    ...reviewConfirmationBlockers(promotionReview)
  ]).filter((blocker) => !resolvedBlockers.has(blocker));
  const blockers = unique([
    ...reviewBlockers,
    ...draftViewReviewBlockers,
    ...localDetailReviewBlockers,
    ...planeReviewBlockers
  ]);
  const status = blockers.length
    ? 'blocked'
    : accepted.length
      ? 'ready_for_part_graph_patch'
      : 'needs_review';
  const applyAllowed = status === 'ready_for_part_graph_patch';
  const acceptedDraftViewSlotIds = promotionReview.draft_view_review?.accepted_view_slot_ids || [];
  const acceptedSurfaceIds = promotionReview.local_detail_review?.accepted_surface_ids || [];
  const acceptedDetailIds = promotionReview.local_detail_review?.accepted_detail_ids || [];
  return {
    version: 1,
    kind: 'candidate_promotion_patch',
    asset_set_id: assetSet.id,
    profile_id: candidateGraph.profile_id,
    source_review: sourceReview,
    status,
    apply_allowed: applyAllowed,
    compile_allowed: false,
    blockers,
    resolved_blockers: Array.from(resolvedBlockers),
    draft_view_review: draftViewReviewSummary(promotionReview),
    local_detail_review: localDetailReviewSummary({ promotionReview, accepted }),
    plane_review: planeReviewSummary({ candidateGraph, promotionReview }),
    actions: applyAllowed ? accepted.map((item) => candidatePromotionAction(item, candidateById.get(item.candidate_id), {
      acceptedDraftViewSlotIds,
      acceptedSurfaceIds,
      acceptedDetailIds
    })) : [],
    review_summary: {
      accepted_candidates: accepted.length,
      held_candidates: (promotionReview.held_candidates || []).length,
      missing_inputs: unresolvedModelingInputs.length
    },
    notes: applyAllowed
      ? 'Ready to convert accepted candidates into a PartGraph promotion patch; downstream QA gates still apply.'
      : 'Candidate promotion is blocked or incomplete; do not modify PartGraph geometry from this patch.'
  };
}

function draftViewReviewBlockersFor(promotionReview) {
  const review = promotionReview?.draft_view_review;
  if (!review) return [];
  if (review.status !== 'accepted' || review.promotion_allowed !== true) {
    return ['accepted_draft_view_review_required'];
  }
  if (!Array.isArray(review.accepted_view_slot_ids) || review.accepted_view_slot_ids.length === 0) {
    return ['accepted_draft_view_slots_required'];
  }
  return [];
}

function localDetailReviewBlockersFor({ promotionReview, accepted }) {
  if (!accepted.length) return [];
  const review = promotionReview?.local_detail_review;
  if (!review) return [];
  if (review.status !== 'accepted' || review.promotion_allowed !== true) {
    return ['accepted_local_detail_review_required'];
  }
  const acceptedSurfaces = Array.isArray(review.accepted_surface_ids) ? review.accepted_surface_ids : [];
  const acceptedDetails = Array.isArray(review.accepted_detail_ids) ? review.accepted_detail_ids : [];
  if (!acceptedSurfaces.length && !acceptedDetails.length) {
    return ['accepted_surface_or_detail_ids_required'];
  }
  return [];
}

function draftViewReviewSummary(promotionReview) {
  const review = promotionReview?.draft_view_review;
  if (!review) return null;
  return {
    source_draft_view_graph: review.source_draft_view_graph || 'draft-view-graph.json',
    status: review.status || 'not_accepted',
    accepted_view_slot_ids: Array.isArray(review.accepted_view_slot_ids) ? review.accepted_view_slot_ids : [],
    accepted_plane_hypothesis_ids: Array.isArray(review.accepted_plane_hypothesis_ids) ? review.accepted_plane_hypothesis_ids : [],
    promotion_allowed: review.promotion_allowed === true,
    blockers: draftViewReviewBlockersFor(promotionReview)
  };
}

function localDetailReviewSummary({ promotionReview, accepted }) {
  const review = promotionReview?.local_detail_review;
  if (!review) return null;
  return {
    source_object_surface_graph: review.source_object_surface_graph || null,
    source_facade_plane_graph: review.source_facade_plane_graph || null,
    status: review.status || 'not_accepted',
    accepted_surface_ids: Array.isArray(review.accepted_surface_ids) ? review.accepted_surface_ids : [],
    accepted_detail_ids: Array.isArray(review.accepted_detail_ids) ? review.accepted_detail_ids : [],
    promotion_allowed: review.promotion_allowed === true,
    blockers: localDetailReviewBlockersFor({ promotionReview, accepted })
  };
}

function facadePlaneReviewBlockers({ candidateGraph, promotionReview }) {
  if (!candidateGraphRequiresFacadePlaneReview(candidateGraph)) return [];
  const review = promotionReview?.facade_plane_review;
  if (!review || review.status !== 'accepted' || review.promotion_allowed !== true) {
    return ['accepted_facade_plane_review_required'];
  }
  if (!Array.isArray(review.accepted_plane_ids) || review.accepted_plane_ids.length === 0) {
    return ['accepted_facade_plane_ids_required'];
  }
  return [];
}

function planeReviewSummary({ candidateGraph, promotionReview }) {
  if (!candidateGraphRequiresFacadePlaneReview(candidateGraph)) return null;
  const review = promotionReview?.facade_plane_review || {};
  return {
    source_facade_plane_graph: review.source_facade_plane_graph || 'facade-plane-graph.json',
    status: review.status || 'not_accepted',
    accepted_plane_ids: Array.isArray(review.accepted_plane_ids) ? review.accepted_plane_ids : [],
    promotion_allowed: review.promotion_allowed === true,
    blockers: facadePlaneReviewBlockers({ candidateGraph, promotionReview })
  };
}

function candidateGraphRequiresFacadePlaneReview(candidateGraph = {}) {
  if (candidateGraph?.profile_id !== 'building_single') return false;
  return (candidateGraph.candidates || []).some((candidate) => {
    const role = candidate.role || '';
    return role.startsWith('visible_plane_')
      || candidate.promotion?.blockers?.includes('accepted_facade_plane_review_required')
      || candidate.blockers?.includes?.('accepted_facade_plane_review_required');
  });
}

function reviewResolvedBlockers(promotionReview) {
  const raw = new Set(Array.isArray(promotionReview.resolved_blockers) ? promotionReview.resolved_blockers : []);
  const profileConfirmed = promotionReview.profile_confirmation?.status === 'confirmed';
  const scaleConfirmed = promotionReview.scale_confirmation?.status === 'confirmed';
  return new Set(Array.from(raw).filter((blocker) => {
    if (blocker === 'unknown_profile') return profileConfirmed;
    if (blocker === 'scale_confidence_below_publish_gate') return scaleConfirmed;
    return true;
  }));
}

function reviewConfirmationBlockers(promotionReview) {
  const blockers = [];
  if (promotionReview.profile_confirmation?.status !== 'confirmed') blockers.push('profile_confirmation_required');
  if (promotionReview.scale_confirmation?.status !== 'confirmed') blockers.push('scale_confirmation_required');
  return blockers;
}

function candidatePromotionAction(reviewItem, candidate, {
  acceptedDraftViewSlotIds = [],
  acceptedSurfaceIds = [],
  acceptedDetailIds = []
} = {}) {
  const draftSlotId = reviewItem.accepted_draft_view_slot_id
    || (acceptedDraftViewSlotIds.includes(reviewItem.view) ? reviewItem.view : '')
    || acceptedDraftViewSlotIds[0]
    || reviewItem.view
    || candidate?.view
    || 'unknown';
  return {
    action: 'promote_candidate',
    candidate_id: reviewItem.candidate_id,
    role: reviewItem.role || candidate?.role || 'unknown_role',
    view: reviewItem.view || candidate?.view || 'unknown',
    source_image: reviewItem.source_image || candidate?.source_image || '',
    source_observation_id: reviewItem.source_observation_id || candidate?.source_observation_id || '',
    accepted_draft_view_slot_id: draftSlotId,
    accepted_surface_id: reviewItem.accepted_surface_id || acceptedSurfaceIds[0] || '',
    accepted_detail_id: reviewItem.accepted_detail_id || acceptedDetailIds[0] || '',
    confidence: Number(reviewItem.confidence ?? candidate?.confidence ?? 0),
    requires_part_graph_review: true,
    reviewer_note: reviewItem.reviewer_note || ''
  };
}

function unique(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputDir = options.inputDir ? path.resolve(repoRoot, options.inputDir) : null;
  const assetSetPath = path.resolve(repoRoot, options.assetSet || path.join(inputDir || '', 'asset-set.json'));
  const candidateGraphPath = path.resolve(repoRoot, options.candidateGraph || path.join(inputDir || '', 'candidate-graph.json'));
  const modelingBriefPath = path.resolve(repoRoot, options.modelingBrief || path.join(inputDir || '', 'modeling-brief.json'));
  const reviewPath = path.resolve(repoRoot, options.review || path.join(inputDir || '', 'candidate-promotion-review.draft.json'));
  const outputPath = path.resolve(repoRoot, options.output || path.join(inputDir || '.', 'candidate-promotion-patch.json'));

  const [assetSet, candidateGraph, modelingBrief, promotionReview] = await Promise.all([
    readJson(assetSetPath),
    readJson(candidateGraphPath),
    readJson(modelingBriefPath),
    readJson(reviewPath)
  ]);
  const patch = buildCandidatePromotionPatch({
    assetSet,
    candidateGraph,
    modelingBrief,
    promotionReview,
    sourceReview: path.relative(path.dirname(outputPath), reviewPath)
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(patch, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: outputPath,
    status: patch.status,
    apply_allowed: patch.apply_allowed,
    compile_allowed: patch.compile_allowed,
    actions: patch.actions.length,
    blockers: patch.blockers
  }, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input-dir') options.inputDir = argv[++index];
    else if (arg === '--asset-set') options.assetSet = argv[++index];
    else if (arg === '--candidate-graph') options.candidateGraph = argv[++index];
    else if (arg === '--modeling-brief') options.modelingBrief = argv[++index];
    else if (arg === '--review') options.review = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.inputDir && !(options.assetSet && options.candidateGraph && options.modelingBrief && options.review)) {
    throw new Error('--input-dir or all explicit input paths are required');
  }
  return options;
}

function usage() {
  process.stdout.write(`Usage:
  node projects/image-structured-modeler/scripts/build-candidate-promotion-patch.mjs \\
    --input-dir output/image-structured-modeler/building-single-intake-test

Options:
  --asset-set <path>         Explicit asset-set.json path.
  --candidate-graph <path>   Explicit candidate-graph.json path.
  --modeling-brief <path>    Explicit modeling-brief.json path.
  --review <path>            Explicit candidate-promotion-review JSON path.
  --output <path>            Output candidate-promotion-patch.json path.
`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
