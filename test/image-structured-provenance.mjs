import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';
import {
  artifactContentSignature,
  bindPromotionReviewArtifacts,
  interpretationEligibilityForPartGraph,
  verifyImageStructuredSourceAssets,
  verifyImageStructuredCompileBundle,
  withArtifactContentSignature
} from '../src/image-structured-provenance.mjs';
import {
  ImageStructuredCompileReceiptAuthority,
  verifyImageStructuredCompileReceipt
} from '../src/image-structured-compile-receipts.mjs';
import { buildImageStructuredProvenanceFixture, resign } from './fixtures/image-structured-provenance-fixture.mjs';

await fs.mkdir(path.join(process.cwd(), 'output'), { recursive: true });
const sourceAssetRoot = await fs.mkdtemp(path.join(process.cwd(), 'output', '.image-provenance-source-'));
const sourceAssetPath = path.join(sourceAssetRoot, 'fixture.png');
const sourceAssetBytes = Buffer.from('deterministic image-structured provenance source bytes');
await fs.writeFile(sourceAssetPath, sourceAssetBytes);
const sourceAssetHash = crypto.createHash('sha256').update(sourceAssetBytes).digest('hex');
const fixture = buildImageStructuredProvenanceFixture({
  sourceImage: path.relative(process.cwd(), sourceAssetPath),
  contentSha256: sourceAssetHash
});
const profile = JSON.parse(await fs.readFile('examples/product-profiles/game_controller_switch.json', 'utf8'));
const sourceAssetVerification = await verifyImageStructuredSourceAssets({
  assetSet: fixture.assetSet,
  repoRoot: process.cwd()
});
assert.equal(sourceAssetVerification.ok, true, sourceAssetVerification.blockers.join('\n'));
const validBundle = bundleFor(fixture);
const valid = verifyImageStructuredCompileBundle({ ...validBundle, requireSourceAssetVerification: true });
assert.equal(valid.ok, true, valid.blockers.join('\n'));
assert.equal(valid.interpretation_eligible, true);
assert.match(valid.binding.binding_hash, /^sha256:[a-f0-9]{64}$/);
const receiptStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-compile-receipt-'));
const receiptAuthority = new ImageStructuredCompileReceiptAuthority({ stateDir: receiptStateDir });
const authorization = {
  version: 'approval-token.v1',
  kind: 'approval_token',
  challenge_id: 'approval_image_provenance_fixture',
  plan_id: fixture.partGraph.id,
  plan_hash: valid.binding.binding_hash,
  model_revision: valid.signatures.part_graph,
  risk_level: 'S2',
  allowed_operations: ['compile_reviewed_part_graph'],
  approved_by: 'test-user',
  approval_channel: 'test-trusted-user-presence',
  expires_at: new Date(Date.now() + 60_000).toISOString()
};
const compileReceipt = await receiptAuthority.issue({ binding: valid.binding, authorization });
const trustedCompilePublicKey = await receiptAuthority.publicKeyPem();
assert.equal(compileReceipt.phase, 'precompile_authorization');
assert.equal(compileReceipt.dsl_sha256, null);
assert.equal(verifyImageStructuredCompileReceipt(compileReceipt, {
  binding: valid.binding,
  publicKeyPem: trustedCompilePublicKey
}), true);
assert.throws(
  () => verifyImageStructuredCompileReceipt({ ...compileReceipt, expires_at: new Date(Date.now() - 1).toISOString() }, {
    binding: valid.binding,
    publicKeyPem: trustedCompilePublicKey
  }),
  /expired/
);
assert.throws(
  () => verifyImageStructuredCompileReceipt({ ...compileReceipt, approved_by: 'forged-user' }, {
    binding: valid.binding,
    publicKeyPem: trustedCompilePublicKey
  }),
  /signature is invalid/
);

const unsignedReview = structuredClone(fixture.promotionReview);
const unsignedAssetSet = structuredClone(fixture.assetSet);
const unsignedObservations = structuredClone(fixture.observations);
const unsignedCandidateGraph = structuredClone(fixture.candidateGraph);
for (const artifact of [unsignedReview, unsignedAssetSet, unsignedObservations, unsignedCandidateGraph]) delete artifact.content_signature;
delete unsignedReview.artifact_bindings;
unsignedReview.compile_allowed = false;
unsignedReview.promotion_allowed = false;
const rebound = bindPromotionReviewArtifacts({
  assetSet: unsignedAssetSet,
  observations: unsignedObservations,
  candidateGraph: unsignedCandidateGraph,
  promotionReview: unsignedReview
});
assert.equal(rebound.derivedReviewGate.ok, true, rebound.derivedReviewGate.blockers.join('\n'));
assert.equal(rebound.promotionReview.compile_allowed, true);
assert.equal(rebound.promotionReview.promotion_allowed, true);

const dsl = compilePartGraphToSketchUpDsl(fixture.partGraph, profile, {
  repoRoot: process.cwd(),
  provenanceBundle: validBundle,
  compileReceipt,
  trustedCompilePublicKey
});
assert.equal(dsl.metadata.source_mode, 'image_structured');
assert.equal(dsl.metadata.interpretation_eligible, true);
assert.equal(dsl.metadata.provenance_binding_hash, valid.binding.binding_hash);
assert.equal(dsl.metadata.source_asset_binding_hash, sourceAssetVerification.binding_hash);
assert.deepEqual(dsl.operations.find((operation) => operation.id === 'controller-body').qa.source_candidate_ids, [fixture.ids.candidateId]);
const dslSha256 = `sha256:${crypto.createHash('sha256').update(`${JSON.stringify(dsl, null, 2)}\n`).digest('hex')}`;
const compiledDslReceipt = await receiptAuthority.issue({ binding: valid.binding, authorization, dslSha256 });
assert.equal(compiledDslReceipt.phase, 'compiled_dsl');
assert.equal(verifyImageStructuredCompileReceipt(compiledDslReceipt, {
  binding: valid.binding,
  publicKeyPem: trustedCompilePublicKey,
  dslSha256
}), true);
assert.throws(
  () => verifyImageStructuredCompileReceipt(compiledDslReceipt, {
    binding: valid.binding,
    publicKeyPem: trustedCompilePublicKey,
    dslSha256: `sha256:${'0'.repeat(64)}`
  }),
  /DSL hash mismatch/
);
assert.throws(
  () => compilePartGraphToSketchUpDsl(fixture.partGraph, profile, {
    repoRoot: process.cwd(),
    provenanceBundle: validBundle,
    compileReceipt: compiledDslReceipt,
    trustedCompilePublicKey
  }),
  /phase mismatch/
);

assert.throws(
  () => compilePartGraphToSketchUpDsl(fixture.partGraph, profile, { repoRoot: process.cwd() }),
  /complete provenance bundle/
);
assert.throws(
  () => compilePartGraphToSketchUpDsl(fixture.partGraph, profile, { repoRoot: process.cwd(), provenanceBundle: validBundle }),
  /compile receipt is required/
);
const forgedReceipt = { ...compileReceipt, accepted_candidate_ids: ['forged-candidate'] };
assert.throws(
  () => compilePartGraphToSketchUpDsl(fixture.partGraph, profile, {
    repoRoot: process.cwd(),
    provenanceBundle: validBundle,
    compileReceipt: forgedReceipt,
    trustedCompilePublicKey
  }),
  /accepted candidates mismatch/
);

const changedPartGraph = structuredClone(fixture);
changedPartGraph.partGraph.parts[0].shape.parameters.size[0] += 1;
changedPartGraph.partGraph = resign(changedPartGraph.partGraph);
const changedPartGraphVerification = verifyImageStructuredCompileBundle(bundleFor(changedPartGraph));
assert.equal(changedPartGraphVerification.ok, true, changedPartGraphVerification.blockers.join('\n'));
assert.throws(
  () => compilePartGraphToSketchUpDsl(changedPartGraph.partGraph, profile, {
    repoRoot: process.cwd(),
    provenanceBundle: bundleFor(changedPartGraph),
    compileReceipt,
    trustedCompilePublicKey
  }),
  /binding hash mismatch/
);

const emptyAccepted = mutateReviewFixture(fixture, (review) => {
  review.accepted_candidates = [];
  review.held_candidates = [{
    candidate_id: fixture.ids.candidateId,
    role: 'controller_body',
    view: 'front',
    promotion_status: 'held',
    blockers: ['human_review_required']
  }];
});
assertBlocked(emptyAccepted, 'accepted_candidates_empty');

const forgedTopLevel = mutateReviewFixture(fixture, (review) => {
  review.accepted_candidates = [];
  review.held_candidates = [{
    candidate_id: fixture.ids.candidateId,
    role: 'controller_body',
    view: 'front',
    promotion_status: 'held',
    blockers: ['human_review_required']
  }];
  review.verdict = 'accepted_subset';
  review.compile_allowed = true;
  review.promotion_allowed = true;
});
assertBlocked(forgedTopLevel, 'accepted_candidates_empty');
assert.ok(verifyImageStructuredCompileBundle(bundleFor(forgedTopLevel)).blockers.includes('promotion_review_compile_state_not_derived'));

const forgedAcceptedStatus = mutateReviewFixture(fixture, (review) => {
  review.accepted_candidates[0].promotion_status = 'held';
});
assertBlocked(forgedAcceptedStatus, `accepted_candidate_review_status_invalid:${fixture.ids.candidateId}`);

const missingDraftReview = structuredClone(fixture);
missingDraftReview.observations.draft_view_graph_v1 = {
  version: 1,
  kind: 'draft_view_graph_v1',
  summary: { observed_slots: 1, inferred_slots: 0, partial_slots: 0 }
};
rebindAll(missingDraftReview);
assertBlocked(missingDraftReview, 'draft_view_review_required');

const missingLocalDetailReview = structuredClone(fixture);
missingLocalDetailReview.observations.object_surface_graph_v1 = { version: 1, kind: 'object_surface_graph_v1' };
rebindAll(missingLocalDetailReview);
assertBlocked(missingLocalDetailReview, 'local_detail_review_required');

const sourceAssetWithoutHash = structuredClone(fixture);
delete sourceAssetWithoutHash.assetSet.assets[0].content_sha256;
rebindAll(sourceAssetWithoutHash);
assertBlocked(sourceAssetWithoutHash, 'asset_content_hash_missing:fixture-front');

const mismatchedAssetSet = resign({
  ...structuredClone(fixture.assetSet),
  assets: fixture.assetSet.assets.map((asset) => ({ ...asset, content_sha256: 'f'.repeat(64) }))
});
const mismatchedAssetVerification = await verifyImageStructuredSourceAssets({ assetSet: mismatchedAssetSet, repoRoot: process.cwd() });
assert.equal(mismatchedAssetVerification.ok, false);
assert.ok(mismatchedAssetVerification.blockers.includes('source_asset_hash_mismatch:fixture-front'));

const missingAssetSet = resign({
  ...structuredClone(fixture.assetSet),
  assets: fixture.assetSet.assets.map((asset) => ({ ...asset, path: path.relative(process.cwd(), path.join(sourceAssetRoot, 'missing.png')) }))
});
const missingAssetVerification = await verifyImageStructuredSourceAssets({ assetSet: missingAssetSet, repoRoot: process.cwd() });
assert.equal(missingAssetVerification.ok, false);
assert.ok(missingAssetVerification.blockers.includes('source_asset_missing:fixture-front'));

const symlinkAssetPath = path.join(sourceAssetRoot, 'fixture-link.png');
await fs.symlink(sourceAssetPath, symlinkAssetPath);
const symlinkAssetSet = resign({
  ...structuredClone(fixture.assetSet),
  assets: fixture.assetSet.assets.map((asset) => ({ ...asset, path: path.relative(process.cwd(), symlinkAssetPath) }))
});
const symlinkAssetVerification = await verifyImageStructuredSourceAssets({ assetSet: symlinkAssetSet, repoRoot: process.cwd() });
assert.equal(symlinkAssetVerification.ok, false);
assert.ok(symlinkAssetVerification.blockers.includes('source_asset_symlink_path:fixture-front'));

const staleReview = structuredClone(fixture);
staleReview.candidateGraph.candidates[0].role = 'forged-role';
staleReview.candidateGraph = resign(staleReview.candidateGraph);
assertBlocked(staleReview, 'promotion_review_candidate_graph_signature_mismatch');

const missingObservation = structuredClone(fixture);
missingObservation.observations.images[0].observations = [];
missingObservation.observations = resign(missingObservation.observations);
missingObservation.promotionReview.artifact_bindings.observations = artifactContentSignature(missingObservation.observations);
missingObservation.promotionReview = resign(missingObservation.promotionReview);
missingObservation.promotionPatch.artifact_bindings.observations = artifactContentSignature(missingObservation.observations);
missingObservation.partGraph.provenance.artifact_signatures.observations = artifactContentSignature(missingObservation.observations);
rebindAfterReview(missingObservation);
assertBlocked(missingObservation, `accepted_candidate_observation_not_found:${fixture.ids.candidateId}`);

const patchMismatch = structuredClone(fixture);
patchMismatch.promotionPatch.actions[0].role = 'forged-role';
patchMismatch.promotionPatch = resign(patchMismatch.promotionPatch);
patchMismatch.partGraph.provenance.artifact_signatures.promotion_patch = artifactContentSignature(patchMismatch.promotionPatch);
patchMismatch.partGraph = resign(patchMismatch.partGraph);
assertBlocked(patchMismatch, `promotion_patch_action_role_mismatch:${fixture.ids.candidateId}`);

const patchSignatureMismatch = structuredClone(fixture);
patchSignatureMismatch.promotionPatch.actions[0].reviewer_note = 'forged without downstream rebind';
patchSignatureMismatch.promotionPatch = resign(patchSignatureMismatch.promotionPatch);
assertBlocked(patchSignatureMismatch, 'part_graph_promotion_patch_signature_mismatch');

const staleCandidateSummary = structuredClone(fixture);
staleCandidateSummary.candidateGraph.summary.eligible_count = 0;
rebindAll(staleCandidateSummary);
assertBlocked(staleCandidateSummary, 'candidate_summary_eligible_count_mismatch');

const missingPartLineage = structuredClone(fixture);
delete missingPartLineage.partGraph.parts[0].source_candidate_ids;
missingPartLineage.partGraph = resign(missingPartLineage.partGraph);
assertBlocked(missingPartLineage, 'part_source_candidate_lineage_missing:controller-body');

const forgedExtraObservationLineage = structuredClone(fixture);
forgedExtraObservationLineage.partGraph.parts[0].source_observation_ids.push('forged-extra-observation');
forgedExtraObservationLineage.partGraph = resign(forgedExtraObservationLineage.partGraph);
assertBlocked(forgedExtraObservationLineage, 'part_source_observation_not_found:controller-body:forged-extra-observation');

const unresolvedPartGraphReview = structuredClone(fixture);
unresolvedPartGraphReview.partGraph.review.status = 'needs_review';
unresolvedPartGraphReview.partGraph = resign(unresolvedPartGraphReview.partGraph);
assertBlocked(unresolvedPartGraphReview, 'part_graph_review_status_not_accepted');

const missingNegativeEvidenceLineage = structuredClone(fixture);
missingNegativeEvidenceLineage.partGraph.semantic_contract = {
  version: 1,
  id: 'negative-evidence-lineage-regression',
  assertions: [],
  regions: [],
  negative_evidence: [{
    id: 'forged-negative-evidence',
    absent_role: 'balustrade',
    source_observation_ids: ['missing-negative-observation']
  }]
};
missingNegativeEvidenceLineage.partGraph = resign(missingNegativeEvidenceLineage.partGraph);
assertBlocked(missingNegativeEvidenceLineage, 'semantic_negative_evidence_observation_not_found:forged-negative-evidence:missing-negative-observation');

const imported = { ...fixture.partGraph, source_mode: 'imported_geometry' };
assert.deepEqual(interpretationEligibilityForPartGraph(imported), {
  eligible: false,
  source_mode: 'imported_geometry',
  reason: 'imported_geometry_excluded_from_image_interpretation_accuracy'
});
const importedDsl = compilePartGraphToSketchUpDsl(imported, profile, { repoRoot: process.cwd() });
assert.equal(importedDsl.metadata.interpretation_eligible, false);

const reverseWrapped = { ...fixture.partGraph, source_mode: 'dsl_reverse_wrapped' };
const reverseDsl = compilePartGraphToSketchUpDsl(reverseWrapped, profile, { repoRoot: process.cwd() });
assert.equal(reverseDsl.metadata.interpretation_eligible, false);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const partGraphSchema = JSON.parse(await fs.readFile('schema/part-graph.schema.json', 'utf8'));
const validatePartGraph = ajv.compile(partGraphSchema);
assert.equal(validatePartGraph(fixture.partGraph), true, JSON.stringify(validatePartGraph.errors));
const receiptSchema = JSON.parse(await fs.readFile('schema/image-structured-compile-receipt-v1.schema.json', 'utf8'));
const validateReceipt = ajv.compile(receiptSchema);
assert.equal(validateReceipt(compileReceipt), true, JSON.stringify(validateReceipt.errors));
assert.equal(validateReceipt(compiledDslReceipt), true, JSON.stringify(validateReceipt.errors));

process.stdout.write(`${JSON.stringify({
  ok: true,
  valid_binding_hash: valid.binding.binding_hash,
  operation_count: dsl.operations.length,
  forgery_regressions: 21,
  source_asset_bytes_verified: true,
  excluded_source_modes: ['imported_geometry', 'dsl_reverse_wrapped']
}, null, 2)}\n`);
await fs.rm(receiptStateDir, { recursive: true, force: true });
await fs.rm(sourceAssetRoot, { recursive: true, force: true });

function bundleFor(value) {
  return {
    assetSet: value.assetSet,
    observations: value.observations,
    candidateGraph: value.candidateGraph,
    promotionReview: value.promotionReview,
    promotionPatch: value.promotionPatch,
    partGraph: value.partGraph,
    sourceAssetVerification
  };
}

function mutateReviewFixture(source, mutate) {
  const next = structuredClone(source);
  mutate(next.promotionReview);
  next.promotionReview = resign(next.promotionReview);
  rebindAfterReview(next);
  return next;
}

function rebindAfterReview(value) {
  value.promotionPatch.artifact_bindings.promotion_review = artifactContentSignature(value.promotionReview);
  value.promotionPatch.accepted_candidate_ids = (value.promotionReview.accepted_candidates || []).map((item) => item.candidate_id);
  value.promotionPatch.actions = value.promotionPatch.actions.filter((action) => value.promotionPatch.accepted_candidate_ids.includes(action.candidate_id));
  value.promotionPatch = withArtifactContentSignature(value.promotionPatch);
  value.partGraph.provenance.artifact_signatures.promotion_review = artifactContentSignature(value.promotionReview);
  value.partGraph.provenance.artifact_signatures.promotion_patch = artifactContentSignature(value.promotionPatch);
  value.partGraph.provenance.accepted_candidate_ids = [...value.promotionPatch.accepted_candidate_ids];
  value.partGraph = withArtifactContentSignature(value.partGraph);
}

function rebindAll(value) {
  value.assetSet = resign(value.assetSet);
  value.observations = resign(value.observations);
  value.candidateGraph = resign(value.candidateGraph);
  value.promotionReview.artifact_bindings = {
    asset_set: artifactContentSignature(value.assetSet),
    observations: artifactContentSignature(value.observations),
    candidate_graph: artifactContentSignature(value.candidateGraph)
  };
  value.promotionReview = resign(value.promotionReview);
  value.promotionPatch.artifact_bindings = {
    asset_set: artifactContentSignature(value.assetSet),
    observations: artifactContentSignature(value.observations),
    candidate_graph: artifactContentSignature(value.candidateGraph),
    promotion_review: artifactContentSignature(value.promotionReview)
  };
  value.promotionPatch = resign(value.promotionPatch);
  value.partGraph.provenance.artifact_signatures = {
    asset_set: artifactContentSignature(value.assetSet),
    observations: artifactContentSignature(value.observations),
    candidate_graph: artifactContentSignature(value.candidateGraph),
    promotion_review: artifactContentSignature(value.promotionReview),
    promotion_patch: artifactContentSignature(value.promotionPatch)
  };
  value.partGraph = resign(value.partGraph);
}

function assertBlocked(value, blocker) {
  const result = verifyImageStructuredCompileBundle(bundleFor(value));
  assert.equal(result.ok, false, 'mutated bundle must fail closed');
  assert.ok(result.blockers.includes(blocker), `${blocker} not found in ${result.blockers.join(', ')}`);
  assert.throws(
    () => compilePartGraphToSketchUpDsl(value.partGraph, profile, { repoRoot: process.cwd(), provenanceBundle: bundleFor(value) }),
    /provenance blocked/
  );
}
