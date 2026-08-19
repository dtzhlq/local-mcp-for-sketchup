import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { ApprovalAuthority } from '../src/approval-tokens.mjs';
import { ImageStructuredCompileReceiptAuthority } from '../src/image-structured-compile-receipts.mjs';
import { withArtifactContentSignature } from '../src/image-structured-provenance.mjs';
import { buildImageStructuredProvenanceFixture } from './fixtures/image-structured-provenance-fixture.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'output', 'test-image-structured-mcp-adapter');
const inputDir = path.join(outputDir, 'input');
const briefDir = path.join(outputDir, 'brief');
const allowedDir = path.join(outputDir, 'allowed');
const blockedDir = path.join(outputDir, 'blocked');
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(inputDir, { recursive: true });

const sourceAssetPath = path.join(inputDir, 'fixture.png');
const sourceAssetBytes = Buffer.from('adapter source asset bytes verified before review and compile');
await fs.writeFile(sourceAssetPath, sourceAssetBytes);
const fixture = buildImageStructuredProvenanceFixture({
  sourceImage: path.relative(repoRoot, sourceAssetPath),
  contentSha256: crypto.createHash('sha256').update(sourceAssetBytes).digest('hex')
});
const paths = {
  asset_set: path.join(inputDir, 'asset-set.json'),
  observations: path.join(inputDir, 'observations.json'),
  candidate_graph: path.join(inputDir, 'candidate-graph.json'),
  modeling_brief: path.join(inputDir, 'modeling-brief.json'),
  promotion_review: path.join(inputDir, 'candidate-promotion-review.json'),
  promotion_patch: path.join(inputDir, 'candidate-promotion-patch.json'),
  part_graph: path.join(inputDir, 'part-graph.json'),
  profile: path.join(repoRoot, 'examples', 'product-profiles', 'game_controller_switch.json')
};
await Promise.all([
  writeJson(paths.asset_set, fixture.assetSet),
  writeJson(paths.observations, fixture.observations),
  writeJson(paths.candidate_graph, fixture.candidateGraph),
  writeJson(paths.modeling_brief, fixture.modelingBrief),
  writeJson(paths.promotion_review, fixture.promotionReview),
  writeJson(paths.promotion_patch, fixture.promotionPatch),
  writeJson(paths.part_graph, fixture.partGraph)
]);

const approvalAuthority = new ApprovalAuthority({
  stateDir: path.join(outputDir, 'approval-state'),
  secret: 'image-adapter-test-approval-secret-at-least-32-bytes'
});
const imageStructuredReceiptAuthority = new ImageStructuredCompileReceiptAuthority({
  stateDir: path.join(outputDir, 'receipt-state')
});
const bridge = new SketchUpBridge({ approvalAuthority, imageStructuredReceiptAuthority });
const prepared = await bridge.prepare_image_modeling_brief({
  input_dir: inputDir,
  promotion_review_path: paths.promotion_review,
  output_dir: briefDir
});
assert.equal(prepared.ok, true);
assert.equal(prepared.blocked, false, prepared.blockers.join('\n'));
assert.equal(prepared.compile_allowed, true);
assert.equal(prepared.brief.compile_permission.can_generate_sketchup_dsl, true);
assert.deepEqual(prepared.brief.provenance_gate.accepted_candidate_ids, [fixture.ids.candidateId]);

const outputSymlinkTarget = path.join(outputDir, 'output-symlink-target');
const outputSymlinkPath = path.join(outputDir, 'output-symlink');
const outputSymlinkSentinel = path.join(outputSymlinkTarget, 'sentinel.txt');
await fs.mkdir(outputSymlinkTarget, { recursive: true });
await fs.writeFile(outputSymlinkSentinel, 'preserve');
await fs.symlink(outputSymlinkTarget, outputSymlinkPath, 'dir');
await assert.rejects(
  bridge.prepare_image_modeling_brief({
    input_dir: inputDir,
    promotion_review_path: paths.promotion_review,
    output_dir: outputSymlinkPath
  }),
  /must not traverse symbolic links/
);
assert.equal(await fs.readFile(outputSymlinkSentinel, 'utf8'), 'preserve');

await assert.rejects(
  bridge.prepare_image_compile_review({
    asset_set_path: path.resolve(repoRoot, '..', 'outside-repository-asset-set.json'),
    observations_path: paths.observations,
    candidate_graph_path: paths.candidate_graph,
    mcp_brief_path: prepared.artifacts.mcp_brief,
    promotion_review_path: paths.promotion_review,
    promotion_patch_path: paths.promotion_patch,
    part_graph_path: paths.part_graph,
    profile_path: paths.profile
  }),
  /must stay inside the repository/
);

const symlinkAssetSetPath = path.join(inputDir, 'asset-set.symlink.json');
await fs.symlink(paths.asset_set, symlinkAssetSetPath);
const symlinkBriefBlocked = await bridge.prepare_image_modeling_brief({
  input_dir: inputDir,
  asset_set_path: symlinkAssetSetPath,
  promotion_review_path: paths.promotion_review,
  output_dir: path.join(outputDir, 'symlink-brief-blocked')
});
assert.equal(symlinkBriefBlocked.blocked, true);
assert.ok(symlinkBriefBlocked.blockers.includes('asset_set_artifact_unsafe:artifact_symlink_path'));
assert.equal(symlinkBriefBlocked.brief, undefined);
const symlinkArtifactBlocked = await bridge.prepare_image_compile_review({
  asset_set_path: symlinkAssetSetPath,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: paths.promotion_review,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile
});
assert.equal(symlinkArtifactBlocked.ok, false);
assert.ok(symlinkArtifactBlocked.blockers.includes('asset_set_artifact_unsafe:artifact_symlink_path'));
assert.equal(symlinkArtifactBlocked.approval, null);

const reviewPreparation = await bridge.prepare_image_compile_review({
  asset_set_path: paths.asset_set,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: paths.promotion_review,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile
});
assert.equal(reviewPreparation.ok, true, reviewPreparation.blockers.join('\n'));
assert.equal(reviewPreparation.review_ready, true);
assert.equal(reviewPreparation.compile_allowed, false);
assert.equal(reviewPreparation.approval_required, true);
assert.equal(reviewPreparation.queue_called, false);
assert.equal(reviewPreparation.source_asset_verification.ok, true);
await approvalAuthority.recordTrustedDecision(reviewPreparation.approval.challenge_id, {
  decision: 'approved',
  user_id: 'image-adapter-test-user',
  channel: 'test-trusted-user-presence',
  confirmed: true
});

await fs.writeFile(sourceAssetPath, Buffer.from('tampered after approval'));
const assetTamperBlocked = await bridge.compile_reviewed_part_graph({
  asset_set_path: paths.asset_set,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: paths.promotion_review,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile,
  approval_challenge_id: reviewPreparation.approval.challenge_id,
  output_dir: path.join(outputDir, 'asset-byte-tamper')
});
assert.equal(assetTamperBlocked.ok, false);
assert.ok(assetTamperBlocked.blockers.includes('source_asset_hash_mismatch:fixture-front'));
assert.equal(assetTamperBlocked.compile_receipt, null);
await fs.writeFile(sourceAssetPath, sourceAssetBytes);

const compiled = await bridge.compile_reviewed_part_graph({
  asset_set_path: paths.asset_set,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: paths.promotion_review,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile,
  approval_challenge_id: reviewPreparation.approval.challenge_id,
  output_dir: allowedDir
});
assert.equal(compiled.ok, true, compiled.blockers.join('\n'));
assert.equal(compiled.preview_only, true);
assert.equal(compiled.queue_called, false);
assert.equal(compiled.provenance_gate.ok, true);
assert.equal(compiled.provenance_gate.interpretation_eligible, true);
assert.equal(compiled.source_asset_verification.ok, true);
assert.equal(compiled.compile_receipt.kind, 'image_structured_compile_receipt');
assert.equal(compiled.compile_receipt.phase, 'compiled_dsl');
assert.equal(compiled.compile_receipt.source_asset_binding_hash, compiled.source_asset_verification.binding_hash);
const dsl = JSON.parse(await fs.readFile(compiled.artifacts.safe_json_dsl_preview, 'utf8'));
const compileManifest = JSON.parse(await fs.readFile(compiled.artifacts.manifest, 'utf8'));
assert.ok(dsl.operations.length > 0);
assert.equal(dsl.metadata.source_mode, 'image_structured');
assert.equal(dsl.metadata.interpretation_eligible, true);
assert.equal(dsl.metadata.source_asset_binding_hash, compiled.source_asset_verification.binding_hash);
assert.equal(compileManifest.summary.source_asset_binding_hash, compiled.source_asset_verification.binding_hash);
assert.equal(compileManifest.artifacts.safe_json_dsl_sha256, compiled.output_dsl_sha256);
assert.equal(compiled.compile_receipt.dsl_sha256, compiled.output_dsl_sha256);
assert.equal(compileManifest.compile_receipt.dsl_sha256, compiled.output_dsl_sha256);

const outputReplayBlocked = await bridge.compile_reviewed_part_graph({
  asset_set_path: paths.asset_set,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: paths.promotion_review,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile,
  approval_challenge_id: reviewPreparation.approval.challenge_id,
  output_dir: allowedDir
});
assert.equal(outputReplayBlocked.ok, false);
assert.ok(outputReplayBlocked.blockers.some((blocker) => blocker.startsWith('output_dsl_already_exists:')));
assert.notEqual(outputReplayBlocked.artifacts.gate_report, compiled.artifacts.gate_report);
const preservedSuccessGateReport = JSON.parse(await fs.readFile(compiled.artifacts.gate_report, 'utf8'));
assert.equal(preservedSuccessGateReport.ok, true);
assert.equal(preservedSuccessGateReport.compile_receipt.dsl_sha256, compiled.output_dsl_sha256);

const tokenReplayBlocked = await bridge.compile_reviewed_part_graph({
  asset_set_path: paths.asset_set,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: paths.promotion_review,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile,
  approval_challenge_id: reviewPreparation.approval.challenge_id,
  output_dir: path.join(outputDir, 'replay')
});
assert.equal(tokenReplayBlocked.ok, false);
assert.ok(tokenReplayBlocked.blockers.some((blocker) => blocker.startsWith('image_structured_compile_approval_invalid:')));

const forgedReview = withArtifactContentSignature({
  ...structuredClone(fixture.promotionReview),
  accepted_candidates: [],
  held_candidates: [{
    candidate_id: fixture.ids.candidateId,
    role: 'controller_body',
    view: 'front',
    promotion_status: 'held',
    blockers: ['human_review_required']
  }],
  verdict: 'accepted_subset',
  compile_allowed: true,
  promotion_allowed: true
});
const forgedReviewPath = path.join(inputDir, 'candidate-promotion-review.forged.json');
await writeJson(forgedReviewPath, forgedReview);
const blocked = await bridge.compile_reviewed_part_graph({
  asset_set_path: paths.asset_set,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: forgedReviewPath,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile,
  output_dir: blockedDir
});
assert.equal(blocked.ok, false);
assert.equal(blocked.blocked, true);
assert.ok(blocked.blockers.includes('accepted_candidates_empty'));
assert.ok(blocked.blockers.includes('promotion_review_compile_state_not_derived'));
await assert.rejects(fs.access(path.join(blockedDir, 'sketchup-preview.dsl.json')));

const missingReview = await bridge.compile_reviewed_part_graph({
  asset_set_path: paths.asset_set,
  observations_path: paths.observations,
  candidate_graph_path: paths.candidate_graph,
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_patch_path: paths.promotion_patch,
  part_graph_path: paths.part_graph,
  profile_path: paths.profile,
  output_dir: path.join(outputDir, 'missing-review')
});
assert.equal(missingReview.blocked, true);
assert.ok(missingReview.blockers.includes('missing_promotion_review_artifact'));
await assert.rejects(fs.access(path.join(outputDir, 'missing-review', 'sketchup-preview.dsl.json')));

process.stdout.write(`${JSON.stringify({
  ok: true,
  brief_compile_allowed: prepared.compile_allowed,
  preview_operations: dsl.operations.length,
  trusted_compile_receipt: compiled.compile_receipt.receipt_id,
  source_asset_byte_tamper_blocked: assetTamperBlocked.blocked,
  artifact_path_escape_blocked: true,
  artifact_symlink_blocked: symlinkArtifactBlocked.blocked,
  brief_artifact_symlink_blocked: symlinkBriefBlocked.blocked,
  output_symlink_blocked: true,
  stale_output_overwrite_blocked: outputReplayBlocked.blocked,
  approval_replay_blocked: tokenReplayBlocked.blocked,
  forged_empty_subset_blocked: blocked.blocked,
  blocked_without_review: missingReview.blocked,
  queue_called: compiled.queue_called
}, null, 2)}\n`);

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
