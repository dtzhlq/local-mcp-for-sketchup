#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/appearance-scenes-hidden-live-evidence-2026-07-23.json';
const PATHS = Object.freeze({
  originalInput: 'test/模型/Fire Escape.skp',
  textureInput: 'test/ScreenShot_2026-04-30_165028_429.png',
  finalizationReport: 'output/live-validation/real-model-reliability-preparation/appearance-scenes-hidden-derived-v1/run-20260723-appearance-v1/finalization-report.v1.json',
  sourceModel: 'output/live-validation/real-model-reliability-inputs/appearance-scenes-hidden-derived-v1/appearance-scenes-hidden.skp',
  sourceContract: 'output/live-validation/real-model-reliability-inputs/appearance-scenes-hidden-derived-v1/appearance-scenes-hidden.reliability.json',
  successReport: 'output/live-validation/real-model-reliability/appearance-scenes-hidden-current-source-v1/real-model-reliability-live-case-report.v1.json'
});

const SOURCE_PATHS = Object.freeze([
  'scripts/build-appearance-scenes-hidden-live-evidence.mjs',
  'scripts/prepare-appearance-scenes-hidden-live-fixture.mjs',
  'scripts/run-real-model-reliability-harness.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/appearance-scenes-hidden-live-evidence-v1.schema.json',
  'schema/controlled-appearance-live-fixture-v1.schema.json',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'sketchup_plugin/alma_sketchup_mcp/appearance_operations.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/snapshot.rb'
]);

export async function buildAppearanceScenesHiddenLiveEvidence({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const [fixtureSchema, reportSchema, finalization, contract, report] = await Promise.all([
    readJson('schema/controlled-appearance-live-fixture-v1.schema.json'),
    readJson('schema/real-model-reliability-live-case-report-v1.schema.json'),
    readJson(PATHS.finalizationReport),
    readJson(PATHS.sourceContract),
    readJson(PATHS.successReport)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validateFixture = ajv.compile(fixtureSchema);
  const validateReport = ajv.compile(reportSchema);
  assert.equal(validateFixture(finalization), true, JSON.stringify(validateFixture.errors, null, 2));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2));

  assert.equal(finalization.status, 'ready_for_formal_live_case');
  assert.equal(finalization.source.original_bytes_unchanged, true);
  assert.equal(finalization.texture.input_bytes_unchanged, true);
  assert.equal(finalization.texture.embedded_material_texture_observed, true);
  assert.equal(finalization.appearance.face_uv_operation_applied_without_warning, true);
  assert.equal(finalization.appearance.face_uv_payload_persisted, true);
  assert.equal(finalization.appearance.textured_material_persisted, true);
  assert.equal(finalization.appearance.hidden_target_persisted, true);
  assert.equal(finalization.identity.model_revision_complete, true);
  assert.equal(finalization.identity.recursive_total, 5897);
  assert.equal(finalization.identity.recursive_materialized, 5897);
  assert.equal(finalization.identity.recursive_truncated, false);
  assert.deepEqual(finalization.queue_clean, emptyQueue());

  const originalInputSha256 = await sha256File(PATHS.originalInput);
  const textureInputSha256 = await sha256File(PATHS.textureInput);
  assert.equal(originalInputSha256, finalization.source.sha256);
  assert.equal(textureInputSha256, finalization.texture.sha256);
  assert.equal(`sha256:${await sha256File(PATHS.sourceModel)}`, finalization.artifact.sha256);
  assert.equal(`sha256:${await sha256File(PATHS.sourceContract)}`, finalization.contract.sha256);
  assert.equal(contract.case_id, 'appearance-scenes-hidden');
  assert.equal(contract.artifact_sha256, finalization.artifact.sha256);
  assert.equal(contract.targets.uv_target.persistent_id, finalization.targets.uv_target.persistent_id);
  assert.equal(contract.targets.hidden_target.persistent_id, finalization.targets.hidden_target.persistent_id);
  assert.deepEqual(contract.expectations.uv_target_roles, ['uv_target']);
  assert.deepEqual(contract.expectations.hidden_target_roles, ['hidden_target']);
  assert.deepEqual(contract.expectations.required_materials, ['ALMA_Reliability_Appearance_Texture']);
  assert.equal(contract.expectations.minimum_scenes, 1);

  validateSuccessReport(report);
  assert.deepEqual(report.runtime_attestation, {
    name: 'queue',
    server_version: '0.1.0-rc.2',
    plugin_version: '0.1.0-rc.2',
    sketchup_version: '26.2.242',
    ruby_version: '3.2.2',
    capability_version: '0.1.0-rc.2-capabilities.7',
    manifest_version: '2026-07-agent-contract-v1.4',
    dsl_version: 1,
    occurrence_contract: 'canonical-occurrence-path.v1',
    revision_strategy: 'definition-merkle.v2',
    revision_source_sha256: finalization.runtime_attestation.revision_source_sha256,
    compatibility_ok: true
  });

  const tasks = new Map(report.result.tasks.map((task) => [task.task_id, task]));
  const uv = tasks.get('uv_material_preservation')?.evidence;
  assert(uv);
  assert.match(uv.initial_signature, /^sha256:[0-9a-f]{64}$/);
  assert.equal(uv.initial_signature, uv.pre_save_signature);
  assert.equal(uv.pre_save_signature, uv.post_reopen_signature);
  assert.deepEqual(uv.target_roles, ['uv_target']);
  assert.equal(uv.preserved_across_save_reopen, true);

  const presentation = tasks.get('scene_visibility_preservation')?.evidence;
  assert(presentation);
  assert.equal(presentation.scenes, 1);
  assert.equal(presentation.hidden_entities, 1);
  assert.equal(presentation.hash, presentation.pre_save_hash);
  assert.equal(presentation.pre_save_hash, presentation.post_reopen_hash);
  assert.equal(presentation.preserved_across_save_reopen, true);

  const identity = tasks.get('save_reopen_identity')?.evidence;
  assert(identity);
  assert.equal(identity.exact_match, true);
  assert.equal(identity.identity_mode, 'full_recursive');
  assert.equal(identity.entries_before, 5897);
  assert.equal(identity.entries_after, 5897);
  assert.equal(identity.total_before, 5897);
  assert.equal(identity.total_after, 5897);
  assert.equal(identity.model_revision_exact_match, true);
  assert.equal(identity.snapshot_error_diffs, 0);
  assert.equal(identity.active_verified_copy_after_reopen, true);

  const diagnosticPath = path.posix.join(
    path.posix.dirname(report.artifacts.verified_model),
    'appearance-scenes-hidden.save-reopen-diagnostic.json'
  );
  const diagnostic = await readJson(diagnosticPath);
  assert.equal(diagnostic.case_id, 'appearance-scenes-hidden');
  assert.equal(diagnostic.exact_identity, true);
  assert.equal(diagnostic.identity_entries_before, 5897);
  assert.equal(diagnostic.identity_entries_after, 5897);
  assert.equal(diagnostic.model_revision_exact_match, true);
  assert.equal(diagnostic.source_path_after_reopen_verified, true);
  assert.equal(diagnostic.runtime_compatibility_ok, true);
  assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0);
  assert.equal(diagnostic.snapshot_diff.verdict, 'pass');

  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));

  const evidence = {
    version: 'appearance-scenes-hidden-live-evidence.v1',
    kind: 'appearance_scenes_hidden_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'live_verified',
    evidence_scope: 'single_hash_bound_controlled_appearance_overlay_and_save_reopen_case',
    case_id: 'appearance-scenes-hidden',
    runtime: report.runtime_attestation,
    source_fixture: {
      derivation_class: finalization.derivation_class,
      original_input_sha256: originalInputSha256,
      original_bytes_unchanged: true,
      texture_input_sha256: textureInputSha256,
      texture_input_bytes_unchanged: true,
      source_artifact_sha256: report.artifacts.source_sha256,
      uv_target_persistent_id: finalization.targets.uv_target.persistent_id,
      hidden_target_persistent_id: finalization.targets.hidden_target.persistent_id,
      recursive_total: 5897,
      recursive_materialized: 5897,
      recursive_truncated: false
    },
    appearance_contract: {
      material_name_untrusted: finalization.appearance.material_name_untrusted,
      scene_name_untrusted: finalization.appearance.scene_name_untrusted,
      uv_id: finalization.appearance.uv_id,
      uv_evidence_kind: 'face_uvs',
      face_uv_operation_applied_without_warning: true,
      face_uv_payload_persisted: true,
      textured_material_persisted: true,
      hidden_target_persisted: true,
      independent_uvhelper_coordinate_attestation: false,
      arbitrary_uv_editing_proven: false
    },
    live_verification: {
      tasks_total: 3,
      tasks_passed: 3,
      uv_material_signature: uv.initial_signature,
      uv_material_signature_preserved: true,
      scene_visibility_signature: presentation.hash,
      scene_visibility_signature_preserved: true,
      scenes: 1,
      hidden_entities: 1,
      save_reopen_exact_identity: true,
      recursive_entries_before: 5897,
      recursive_entries_after: 5897,
      model_revision_exact_match: true,
      snapshot_error_diffs: 0,
      wrong_object_modification_count: 0,
      silent_geometry_corruption_count: 0,
      recovery_attempts: 0,
      recoveries: 0,
      recovery_rate: 1,
      queue_clean: true
    },
    artifacts: {
      original_input: await artifactDescriptor(PATHS.originalInput),
      texture_input: await artifactDescriptor(PATHS.textureInput),
      finalization_report: await artifactDescriptor(PATHS.finalizationReport),
      source_model: await artifactDescriptor(PATHS.sourceModel, report.artifacts.source_sha256),
      source_contract: await artifactDescriptor(PATHS.sourceContract, report.artifacts.contract_sha256),
      success_report: await artifactDescriptor(PATHS.successReport),
      success_diagnostic: await artifactDescriptor(diagnosticPath),
      verified_model: await artifactDescriptor(report.artifacts.verified_model, report.artifacts.verified_model_sha256)
    },
    source_sha256: sourceSha256,
    acceptance: {
      selected_case_passed: true,
      appearance_uv_hidden_preservation: true,
      formal_corpus_cases_passed: 1,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This evidence is bound to one controlled overlay on a user-authorized disposable Fire Escape model copy; the original SKP and texture input remained byte-identical.',
      'The FaceUV operation completed without the plugin texture-position warning, its face_uvs payload persisted, and the textured material remained observable after save and reopen.',
      'The UV result is a stable structured FaceUV and material-signature proof; it is not an independent UVHelper coordinate readback or a claim of arbitrary UV editing.',
      'One Scene and one hidden top-level target preserved an identical presentation signature across save and reopen.',
      'This advances one of seven formal reliability cases. It does not prove architecture, Boolean/manifold, dirty-topology recovery, cross-version behavior, or release acceptance.'
    ]
  };

  const normalizedOutput = assertRepoRelativePath(outputPath);
  await fs.mkdir(path.dirname(path.join(repoRoot, normalizedOutput)), { recursive: true });
  await fs.writeFile(path.join(repoRoot, normalizedOutput), `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
  return { evidence, output_path: normalizedOutput };
}

function validateSuccessReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'queue');
  assert.equal(report.selected_case.case_id, 'appearance-scenes-hidden');
  assert.equal(report.result.ok, true);
  assert.equal(report.metrics.tasks_total, 3);
  assert.equal(report.metrics.tasks_passed, 3);
  assert.equal(report.metrics.task_success_rate, 1);
  assert.equal(report.metrics.wrong_object_modification_count, 0);
  assert.equal(report.metrics.silent_geometry_corruption_count, 0);
  assert.equal(report.metrics.recovery_attempts, 0);
  assert.equal(report.metrics.recoveries, 0);
  assert.equal(report.metrics.recovery_rate, 1);
  assert.equal(report.safety.original_bytes_unchanged, true);
  assert.equal(report.safety.disposable_copy_only, true);
  assert.deepEqual(report.queue_clean, emptyQueue());
  assert.equal(report.acceptance.selected_case_passed, true);
  assert.equal(report.acceptance.release_acceptance, false);
  assert.equal(report.artifacts.source_sha256, report.artifacts.working_copy_sha256);
  assert.equal(report.result.details.artifact_sha256, report.artifacts.source_sha256);
  assert.deepEqual(
    report.result.tasks.map((task) => task.task_id),
    ['uv_material_preservation', 'scene_visibility_preservation', 'save_reopen_identity']
  );
  for (const task of report.result.tasks) assert.equal(task.status, 'passed');
}

async function artifactDescriptor(relativePath, expectedPrefixedSha256 = null) {
  const normalized = assertRepoRelativePath(relativePath);
  const stats = await fs.stat(path.join(repoRoot, normalized));
  assert.equal(stats.isFile(), true, `${normalized} is not a file`);
  const sha256 = await sha256File(normalized);
  if (expectedPrefixedSha256) {
    assert.equal(`sha256:${sha256}`, expectedPrefixedSha256, `${normalized} hash mismatch`);
  }
  return { path: normalized, sha256, bytes: stats.size };
}

function emptyQueue() {
  return { queue: 0, processing: 0, responses: 0, lock: false };
}

function assertRepoRelativePath(value) {
  assert.equal(typeof value, 'string');
  assert(value.length > 0 && !path.isAbsolute(value), 'artifact paths must be repository-relative');
  const normalized = value.replaceAll('\\', '/');
  const absolute = path.resolve(repoRoot, normalized);
  assert(absolute.startsWith(`${repoRoot}${path.sep}`), 'artifact path escapes the repository');
  return normalized;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, assertRepoRelativePath(relativePath)), 'utf8'));
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256')
    .update(await fs.readFile(path.join(repoRoot, assertRepoRelativePath(relativePath))))
    .digest('hex');
}

function parseArgs(argv) {
  const options = { outputPath: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') options.outputPath = argv[++index];
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/build-appearance-scenes-hidden-live-evidence.mjs [--output <path>]\n');
  } else {
    buildAppearanceScenesHiddenLiveEvidence(options)
      .then(({ evidence, output_path }) => process.stdout.write(`${JSON.stringify({
        ok: true,
        output: output_path,
        case_id: evidence.case_id,
        tasks_passed: evidence.live_verification.tasks_passed,
        recursive_entries: evidence.live_verification.recursive_entries_after,
        release_acceptance: evidence.acceptance.release_acceptance
      }, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
