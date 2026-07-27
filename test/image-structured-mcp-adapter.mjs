import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(repoRoot, 'output', 'test-image-structured-mcp-adapter');
const inputDir = path.join(outputDir, 'input');
const briefDir = path.join(outputDir, 'brief');
const allowedDir = path.join(outputDir, 'allowed');
const blockedDir = path.join(outputDir, 'blocked');
await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(inputDir, { recursive: true });

const assetSetId = 'image-adapter-fixture';
const profileId = 'game_controller_switch';
const acceptedReview = {
  version: 1,
  kind: 'candidate_promotion_review',
  asset_set_id: assetSetId,
  profile_id: profileId,
  source_candidate_graph: 'candidate-graph.json',
  reviewer: 'image adapter regression',
  verdict: 'accepted_subset',
  compile_allowed: true,
  promotion_allowed: true,
  missing_inputs: [],
  blockers: [],
  profile_confirmation: { selected_profile: profileId, status: 'confirmed' },
  scale_confirmation: { status: 'confirmed', known_width: 242, units: 'mm' },
  draft_view_review: null,
  local_detail_review: null,
  accepted_candidates: [],
  held_candidates: []
};
const blockedReview = {
  ...acceptedReview,
  reviewer: 'image adapter blocked regression',
  verdict: 'blocked',
  compile_allowed: false,
  promotion_allowed: false,
  blockers: ['human_review_required']
};

await Promise.all([
  writeJson(path.join(inputDir, 'asset-set.json'), {
    version: 1,
    kind: 'asset_set',
    id: assetSetId,
    source_input: 'fixture.png',
    assets: [{ id: 'fixture-front', path: 'fixture.png', media_type: 'image', detected_view: 'front', quality: 'high' }],
    profile_routing: { selected_profile: profileId, status: 'routed' },
    gates: { can_compile_geometry: true, reasons: [] }
  }),
  writeJson(path.join(inputDir, 'observations.json'), {
    version: 1,
    object: { type: 'switch_controller', name: 'Image adapter fixture', profile: 'switch_controller', source_images: ['fixture.png'] },
    images: [{
      version: 1,
      image: { path: 'fixture.png', width: 1000, height: 600 },
      detected_view: { kind: 'front', confidence: 1 },
      observations: []
    }],
    views_detected: ['front'],
    missing_views: [],
    scale_calibration: { strategy: 'known_dimension', units: 'mm', confidence: 1, default_scale: { width: 242 }, measurements: [], missing_views: [] },
    quality_report: { usable_for_modeling: true, risks: [] }
  }),
  writeJson(path.join(inputDir, 'candidate-graph.json'), {
    version: 1,
    kind: 'candidate_graph',
    asset_set_id: assetSetId,
    profile_id: profileId,
    candidates: [],
    summary: { candidate_count: 0, eligible_count: 0, blocked_count: 0 }
  }),
  writeJson(path.join(inputDir, 'modeling-brief.json'), {
    version: 1,
    kind: 'modeling_brief',
    asset_set_id: assetSetId,
    profile_id: profileId,
    status: 'ready_for_promotion_review',
    compile_allowed: true,
    missing_inputs: [],
    instructions: ['Compile only after promotion review and PartGraph gates pass.']
  }),
  writeJson(path.join(inputDir, 'candidate-promotion-review.draft.json'), acceptedReview),
  writeJson(path.join(inputDir, 'candidate-promotion-review.blocked.json'), blockedReview)
]);

const bridge = new SketchUpBridge();
const prepared = await bridge.prepare_image_modeling_brief({ input_dir: inputDir, output_dir: briefDir });
assert.equal(prepared.ok, true);
assert.equal(prepared.blocked, false);
assert.equal(prepared.compile_allowed, true);
assert.equal(prepared.brief.compile_permission.can_generate_sketchup_dsl, true);
assert.equal(prepared.schema_checks.mcp_brief.ok, true);

const compiled = await bridge.compile_reviewed_part_graph({
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: path.join(inputDir, 'candidate-promotion-review.draft.json'),
  part_graph_path: path.join(repoRoot, 'examples', 'part-graphs', 'switch-controller-reference.part-graph.json'),
  profile_path: path.join(repoRoot, 'examples', 'product-profiles', 'game_controller_switch.json'),
  output_dir: allowedDir
});
assert.equal(compiled.ok, true);
assert.equal(compiled.preview_only, true);
assert.equal(compiled.queue_called, false);
assert.equal(compiled.part_graph_review.accepted, true);
const dsl = JSON.parse(await fs.readFile(compiled.artifacts.safe_json_dsl_preview, 'utf8'));
assert.ok(dsl.operations.length > 0);

const blocked = await bridge.compile_reviewed_part_graph({
  mcp_brief_path: prepared.artifacts.mcp_brief,
  promotion_review_path: path.join(inputDir, 'candidate-promotion-review.blocked.json'),
  part_graph_path: path.join(repoRoot, 'examples', 'part-graphs', 'switch-controller-reference.part-graph.json'),
  profile_path: path.join(repoRoot, 'examples', 'product-profiles', 'game_controller_switch.json'),
  output_dir: blockedDir
});
assert.equal(blocked.ok, false);
assert.equal(blocked.blocked, true);
assert.ok(blocked.blockers.includes('promotion_review_compile_not_allowed'));
await assert.rejects(fs.access(path.join(blockedDir, 'sketchup-preview.dsl.json')));

const missingReview = await bridge.compile_reviewed_part_graph({
  mcp_brief_path: prepared.artifacts.mcp_brief,
  part_graph_path: path.join(repoRoot, 'examples', 'part-graphs', 'switch-controller-reference.part-graph.json'),
  profile_path: path.join(repoRoot, 'examples', 'product-profiles', 'game_controller_switch.json'),
  output_dir: path.join(outputDir, 'missing-review')
});
assert.equal(missingReview.blocked, true);
assert.ok(missingReview.blockers.includes('missing_promotion_review_artifact'));
await assert.rejects(fs.access(path.join(outputDir, 'missing-review', 'sketchup-preview.dsl.json')));

process.stdout.write(`${JSON.stringify({
  ok: true,
  brief_compile_allowed: prepared.compile_allowed,
  preview_operations: dsl.operations.length,
  blocked_without_review: missingReview.blocked,
  queue_called: compiled.queue_called
}, null, 2)}\n`);

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
