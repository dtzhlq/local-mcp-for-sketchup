import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/trimble-s6-background-normalized-visual-evidence-2026-07-23.json';
const [evidence, evidenceSchema, comparisonSchema] = await Promise.all([
  readJson(evidencePath),
  readJson('schema/trimble-s6-background-normalized-visual-evidence-v1.schema.json'),
  readJson('schema/background-normalized-visual-comparison-v1.schema.json')
]);
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validateEvidence = ajv.compile(evidenceSchema);
const validateComparison = ajv.compile(comparisonSchema);
assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors, null, 2));

for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after evidence generation`);
}
for (const [relativePath, expected] of Object.entries(evidence.artifact_sha256)) {
  assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after evidence generation`);
}
assert.equal(await sha256File(evidence.source_diagnostic.path), evidence.source_diagnostic.sha256);

const comparison = await readJson(evidence.comparison.path);
assert.equal(validateComparison(comparison), true, JSON.stringify(validateComparison.errors, null, 2));
assert.equal(await sha256File(evidence.comparison.path), evidence.comparison.sha256);
const { comparison_id: comparisonId, comparison_hash: comparisonHash, ...comparisonCore } = comparison;
assert.equal(sha256Canonical(comparisonCore), comparisonHash);
assert.equal(comparisonId, `background-visual-${comparisonHash.slice(7, 31)}`);
assert.equal(comparison.inputs.reference.sha256, evidence.source_diagnostic.reference_sha256);
assert.equal(comparison.inputs.capture.sha256, evidence.source_diagnostic.capture_sha256);

const sourceDiagnostic = await readJson(evidence.source_diagnostic.path);
assert.equal(sourceDiagnostic.diagnostic_task_id, evidence.source_diagnostic.task_id);
assert.equal(sourceDiagnostic.source_mutation_task_id, evidence.source_diagnostic.source_mutation_task_id);
assert.equal(sourceDiagnostic.capture.provenance.model_revision, evidence.source_diagnostic.model_revision);
assert.equal(sourceDiagnostic.reference.sha256, evidence.source_diagnostic.reference_sha256);
assert.equal(sourceDiagnostic.capture.sha256, evidence.source_diagnostic.capture_sha256);
assert.equal(sourceDiagnostic.promoted_or_executed, false);
assert.equal(sourceDiagnostic.correction_patch.execution_allowed, false);
assert.equal(sourceDiagnostic.release_acceptance, false);
assert.equal(evidence.source_diagnostic.prior_capture_foreground_bounds_full_width, true);

assert.equal(comparison.segmentation.reliable, true);
assert.equal(comparison.segmentation.reference.reliable, true);
assert.equal(comparison.segmentation.capture.reliable, true);
assert.deepEqual(comparison.segmentation.reference.bounds_norm, [0, 0.007813, 0.903704, 0.984375]);
assert.deepEqual(comparison.segmentation.capture.bounds_norm, [0.386719, 0.027778, 0.613281, 1]);
assert.equal(comparison.segmentation.capture.bounds_norm[0] > 0, true);
assert.equal(comparison.segmentation.capture.bounds_norm[2] < 1, true);
assert.equal(evidence.comparison.capture_bounds_full_width, false);
assert.deepEqual(evidence.comparison.capture_bounds_norm, comparison.segmentation.capture.bounds_norm);

assert.equal(comparison.structure.verdict, 'coarse_structure_pass');
assert.equal(comparison.structure.intersection_over_union, 0.569986);
assert.equal(comparison.structure.dice_coefficient, 0.726104);
assert.equal(comparison.structure.aspect_ratio_log_delta, 0.163759);
assert.ok(comparison.structure.intersection_over_union >= comparison.structure.thresholds.iou_pass_min);
assert.ok(comparison.structure.dice_coefficient >= comparison.structure.thresholds.dice_pass_min);
assert.equal(evidence.release_blockers.includes('coarse_structure_below_fixed_pass_threshold'), false);

assert.equal(comparison.appearance.verdict, 'diagnostic_only');
assert.equal(comparison.appearance.mean_absolute_error, 0.296766);
assert.equal(comparison.appearance.root_mean_square_error, 0.380301);
assert.equal(comparison.appearance.palette.yellow_fraction_delta, 0.008338);
assert.equal(evidence.comparison.appearance.verdict, 'diagnostic_only');
assert.equal(evidence.comparison.appearance.mean_absolute_error, comparison.appearance.mean_absolute_error);

const outputDir = path.posix.dirname(evidence.comparison.path);
const artifactDimensions = {
  'reference-mask.png': [135, 256],
  'capture-mask.png': [256, 144],
  'registered-reference.png': [256, 256],
  'registered-capture.png': [256, 256],
  'silhouette-overlay.png': [256, 256]
};
for (const [basename, [width, height]] of Object.entries(artifactDimensions)) {
  const relativePath = path.posix.join(outputDir, basename);
  assert.ok(evidence.artifact_sha256[relativePath]);
  const metadata = await sharp(path.join(root, relativePath)).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, width);
  assert.equal(metadata.height, height);
}

assert.deepEqual(evidence.policy_invariants, {
  execution_mode: 'offline_immutable_image_bytes_only',
  queue_runtime_invoked: false,
  sketchup_capture_invoked: false,
  live_model_mutation_performed: false,
  correction_patch_persisted: false,
  approval_challenge_created: false,
  approval_token_exposed_to_agent: false,
  image_content_policy_effect: 'none',
  agent_visual_capability_required: false,
  agent_local_file_capability_required: false,
  visual_similarity_accepted: false
});
assert.equal(comparison.content_trust, 'untrusted_data');
assert.equal(comparison.policy_effect, 'none');
assert.equal(comparison.agent_compatibility.visual_agent_required, false);
assert.equal(comparison.agent_compatibility.local_files_required, false);
assert.equal(comparison.execution_allowed, false);
assert.equal(comparison.review_required, true);
assert.equal(comparison.visual_similarity_accepted, false);
assert.equal(evidence.release_acceptance, false);

const runnerSource = await fs.readFile(
  path.join(root, 'scripts/reanalyze-trimble-s6-background-normalized.mjs'),
  'utf8'
);
assert.equal(runnerSource.includes('SketchUpBridge'), false);
assert.equal(runnerSource.includes('QueueRuntime'), false);
assert.equal(runnerSource.includes("runtime: 'queue'"), false);
assert.equal(runnerSource.includes('create_queue_handshake'), false);

for (const mutate of [
  (value) => { value.source_diagnostic.promoted_or_executed = true; },
  (value) => { value.comparison.capture_bounds_full_width = true; },
  (value) => { value.comparison.segmentation_reliable = false; },
  (value) => { value.policy_invariants.queue_runtime_invoked = true; },
  (value) => { value.policy_invariants.live_model_mutation_performed = true; },
  (value) => { value.policy_invariants.correction_patch_persisted = true; },
  (value) => { value.policy_invariants.approval_challenge_created = true; },
  (value) => { value.policy_invariants.approval_token_exposed_to_agent = true; },
  (value) => { value.policy_invariants.image_content_policy_effect = 'execute'; },
  (value) => { value.policy_invariants.agent_visual_capability_required = true; },
  (value) => { value.policy_invariants.visual_similarity_accepted = true; },
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
  evidence_schema_negative_cases: 12,
  prior_full_width_foreground: true,
  normalized_capture_bounds: comparison.segmentation.capture.bounds_norm,
  segmentation_reliable: true,
  structure_verdict: comparison.structure.verdict,
  intersection_over_union: comparison.structure.intersection_over_union,
  appearance_verdict: comparison.appearance.verdict,
  no_queue_runtime_import: true,
  visual_similarity_accepted: false,
  release_acceptance: false
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(root, relativePath))).digest('hex');
}

function sha256Canonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
