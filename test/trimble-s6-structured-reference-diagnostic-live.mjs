import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
const diagnosticSchema = await readJson('schema/trimble-s6-structured-reference-diagnostic-v1.schema.json');
const evidenceSchema = await readJson('schema/trimble-s6-structured-reference-diagnostic-live-evidence-v1.schema.json');
const evidence = await readJson('docs/evidence/trimble-s6-structured-reference-diagnostic-live-evidence-2026-07-22.json');
const originalEvidence = await readJson('docs/evidence/trimble-s6-reference-correction-live-evidence-2026-07-22.json');
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validateDiagnostic = ajv.compile(diagnosticSchema);
const validateEvidence = ajv.compile(evidenceSchema);

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2));
for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after the live diagnostic`);
}
for (const [relativePath, expected] of Object.entries(evidence.artifact_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} does not match the live diagnostic evidence`);
}

const diagnostic = await readJson(evidence.diagnostic.path);
assert.equal(validateDiagnostic(diagnostic), true, JSON.stringify(validateDiagnostic.errors, null, 2));
assert.equal(await sha256File(evidence.diagnostic.path), evidence.diagnostic.sha256);
assert.equal(diagnostic.diagnostic_task_id, evidence.diagnostic.task_id);
assert.equal(diagnostic.task_state, evidence.diagnostic.task_state);
assert.equal(diagnostic.source_mutation_task_id, evidence.source_mutation.task_id);
assert.equal(diagnostic.correction_patch.correction_patch_id, evidence.diagnostic.correction_patch_id);
assert.equal(diagnostic.correction_patch.patch_hash, evidence.diagnostic.correction_patch_hash);
assert.equal(diagnostic.promoted_or_executed, false);
assert.equal(diagnostic.promotion_available, false);
assert.equal(diagnostic.correction_patch.execution_allowed, false);
assert.equal(diagnostic.correction_patch.review_required, true);
assert.equal(diagnostic.correction_patch.intentionally_not_persisted, true);

assert.equal(originalEvidence.plan.task_id, evidence.source_mutation.task_id);
assert.equal(originalEvidence.plan.plan_id, evidence.source_mutation.plan_id);
assert.equal(originalEvidence.plan.plan_hash, evidence.source_mutation.plan_hash);
assert.equal(originalEvidence.model.model_revision_after, evidence.source_mutation.model_revision_after);
assert.equal(diagnostic.capture.provenance.model_revision, evidence.source_mutation.model_revision_after);

const diagnosticDir = path.posix.dirname(evidence.diagnostic.path);
const checkpointPath = path.posix.join(diagnosticDir, 'capture-checkpoint.json');
const checkpoint = await readJson(checkpointPath);
assert.equal(checkpoint.version, 'trimble-s6-structured-reference-capture-checkpoint.v1');
assert.equal(checkpoint.diagnostic_task_id, diagnostic.diagnostic_task_id);
assert.equal(checkpoint.model_key, diagnostic.capture.provenance.model_key);
assert.equal(checkpoint.graph_id, diagnostic.capture.provenance.graph_id);
assert.equal(checkpoint.model_revision, diagnostic.capture.provenance.model_revision);
assert.deepEqual(checkpoint.provenance, diagnostic.capture.provenance);
assert.equal(checkpoint.record.handle, diagnostic.capture.handle);
assert.equal(checkpoint.record.sha256, diagnostic.capture.sha256);
assert.equal(checkpoint.record.width, diagnostic.capture.width);
assert.equal(checkpoint.record.height, diagnostic.capture.height);
assert.equal(checkpoint.record.content_trust, 'untrusted_data');
assert.equal(checkpoint.record.policy_effect, 'none');
assert.equal(checkpoint.capture_mode, 'server_live_current_view');

assert.equal(diagnostic.reference.handle, diagnostic.reference.sha256.replace(/^sha256:/, 'image-artifact:sha256:'));
assert.equal(diagnostic.capture.handle, diagnostic.capture.sha256.replace(/^sha256:/, 'image-artifact:sha256:'));
assert.equal(diagnostic.capture.provenance.image_handle, diagnostic.capture.handle);
assert.equal(diagnostic.capture.provenance.image_sha256, diagnostic.capture.sha256);
assert.equal(diagnostic.capture.provenance.source_task_id, diagnostic.diagnostic_task_id);
assert.equal(diagnostic.capture.provenance.state_unchanged, true);
assert.equal(diagnostic.capture.provenance.view_unchanged, true);

for (const [basename, binding] of Object.entries(diagnostic.materialized_artifacts)) {
  const relativePath = path.posix.join(diagnosticDir, basename);
  assert.equal(evidence.artifact_sha256[relativePath], binding.sha256.slice('sha256:'.length));
  assert.equal(await sha256File(relativePath), binding.sha256.slice('sha256:'.length));
  assert.equal((await fs.stat(path.join(root, relativePath))).size, binding.size_bytes);
  assert.equal(binding.handle, binding.sha256.replace(/^sha256:/, 'image-artifact:sha256:'));
}

const expectedDimensions = {
  'capture-checkpoint.png': [1280, 720],
  'capture.png': [1280, 720],
  'capture-thumbnail.png': [256, 144],
  'difference-overlay.png': [128, 128],
  'reference.png': [770, 1460],
  'reference-thumbnail.png': [135, 256]
};
for (const [basename, [width, height]] of Object.entries(expectedDimensions)) {
  const metadata = await sharp(path.join(root, diagnosticDir, basename)).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, width, `${basename} width drifted`);
  assert.equal(metadata.height, height, `${basename} height drifted`);
}
assert.equal(
  evidence.artifact_sha256[path.posix.join(diagnosticDir, 'capture-checkpoint.png')],
  evidence.artifact_sha256[path.posix.join(diagnosticDir, 'capture.png')],
  'the durable capture checkpoint and materialized capture must preserve identical CAS bytes'
);

assert.equal(diagnostic.structured_metrics.alignment.method, 'normalized_canvas_and_foreground_centroid.v1');
assert.deepEqual(diagnostic.structured_metrics.alignment.translation_norm, [0, 0.007812]);
assert.equal(diagnostic.structured_metrics.alignment.foreground_center_delta_norm, 0.007812);
assert.equal(diagnostic.structured_metrics.difference.method, 'normalized_rgb.v1');
assert.equal(diagnostic.structured_metrics.difference.mean_absolute_error, 0.209854);
assert.equal(diagnostic.structured_metrics.difference.root_mean_square_error, 0.304953);
assert.equal(diagnostic.structured_metrics.difference.compared_pixels, 16384);
assert.deepEqual(diagnostic.structured_metrics.foreground.reference.bounds_norm, [0.234375, 0, 0.765625, 0.984375]);
assert.deepEqual(diagnostic.structured_metrics.foreground.capture.bounds_norm, [0, 0.21875, 1, 0.78125]);
assert.equal(diagnostic.structured_metrics.foreground.capture.bounds_norm[0], 0);
assert.equal(diagnostic.structured_metrics.foreground.capture.bounds_norm[2], 1);
assert.equal(diagnostic.structured_metrics.computed, true);
assert.equal(diagnostic.structured_metrics.acceptance, false);
assert.equal(diagnostic.structured_metrics.verdict, 'review');
assert.match(diagnostic.structured_metrics.reason, /render\/background conditions/);
assert.equal(evidence.structured_metrics.capture_foreground_bounds_full_width, true);
assert.equal(evidence.operator_visual_review.full_tripod_visible, true);
assert.equal(evidence.operator_visual_review.automated, false);
assert.equal(evidence.operator_visual_review.visual_similarity_accepted, false);

assert.equal(diagnostic.model.disk_sha256_before, diagnostic.model.disk_sha256_after);
assert.equal(diagnostic.model.disk_bytes_unchanged, true);
assert.equal(diagnostic.model.modified_state_before, diagnostic.model.modified_state_after);
assert.equal(diagnostic.model.save_model, false);
assert.deepEqual(diagnostic.queue_before, { queue: 0, processing: 0, responses: 0, lock_exists: false });
assert.deepEqual(diagnostic.queue_after, { queue: 0, processing: 0, responses: 0, lock_exists: false });
assert.equal(diagnostic.live_model_mutation_performed, false);
assert.equal(diagnostic.approval_challenge_created, false);
assert.equal(diagnostic.approval_token_exposed_to_agent, false);
assert.equal(diagnostic.release_acceptance, false);
assert.equal(evidence.release_acceptance, false);

for (const mutate of [
  (value) => { value.promotion_available = true; },
  (value) => { value.correction_patch.execution_allowed = true; },
  (value) => { value.correction_patch.intentionally_not_persisted = false; },
  (value) => { value.model.save_model = true; },
  (value) => { value.capture.provenance.state_unchanged = false; },
  (value) => { value.structured_metrics.acceptance = true; },
  (value) => { value.structured_metrics.verdict = 'pass'; },
  (value) => { value.queue_after.processing = 1; },
  (value) => { value.live_model_mutation_performed = true; },
  (value) => { value.approval_challenge_created = true; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(diagnostic);
  mutate(invalid);
  assert.equal(validateDiagnostic(invalid), false);
}

for (const mutate of [
  (value) => { value.diagnostic.promotion_available = true; },
  (value) => { value.structured_metrics.acceptance = true; },
  (value) => { value.operator_visual_review.automated = true; },
  (value) => { value.operator_visual_review.visual_similarity_accepted = true; },
  (value) => { value.policy_invariants.correction_patch_persisted = true; },
  (value) => { value.policy_invariants.approval_token_exposed_to_agent = true; },
  (value) => { value.policy_invariants.queue_after.responses = 1; },
  (value) => { value.model.save_model = true; },
  (value) => { value.release_acceptance = true; }
]) {
  const invalid = structuredClone(evidence);
  mutate(invalid);
  assert.equal(validateEvidence(invalid), false);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  source_hashes_verified: Object.keys(evidence.source_sha256).length,
  artifact_hashes_verified: Object.keys(evidence.artifact_sha256).length,
  diagnostic_schema_negative_cases: 11,
  evidence_schema_negative_cases: 9,
  capture_dimensions: [diagnostic.capture.width, diagnostic.capture.height],
  full_tripod_visible_operator_review: true,
  structured_alignment_computed: true,
  pixel_difference_computed: true,
  foreground_center_delta_norm: diagnostic.structured_metrics.alignment.foreground_center_delta_norm,
  mean_absolute_error: diagnostic.structured_metrics.difference.mean_absolute_error,
  root_mean_square_error: diagnostic.structured_metrics.difference.root_mean_square_error,
  foreground_segmentation_full_width: true,
  correction_patch_promotable: false,
  live_model_mutation_performed: false,
  queue_clean: true,
  visual_similarity_acceptance: false,
  release_acceptance: false
}, null, 2)}\n`);

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(root, relativePath))).digest('hex');
}
