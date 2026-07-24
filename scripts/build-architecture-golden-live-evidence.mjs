#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/architecture-golden-live-evidence-2026-07-23.json';
const PATHS = Object.freeze({
  originalInput: 'test/模型/Fire Escape.skp',
  finalizationReport: 'output/live-validation/real-model-reliability-preparation/architecture-golden-derived-v1/run-20260723-architecture-v1/finalization-report.v1.json',
  sourceModel: 'output/live-validation/real-model-reliability-inputs/architecture-golden-derived-v1/architecture-building.skp',
  sourceContract: 'output/live-validation/real-model-reliability-inputs/architecture-golden-derived-v1/architecture-building.reliability.json',
  successReport: 'output/live-validation/real-model-reliability/architecture-golden-current-source-v1/real-model-reliability-live-case-report.v1.json'
});

const SOURCE_PATHS = Object.freeze([
  'scripts/build-architecture-golden-live-evidence.mjs',
  'scripts/prepare-architecture-golden-live-fixture.mjs',
  'scripts/run-real-model-reliability-harness.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/architecture-golden-live-evidence-v1.schema.json',
  'schema/controlled-architecture-live-fixture-v1.schema.json',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'sketchup_plugin/alma_sketchup_mcp/materials.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/snapshot.rb',
  'sketchup_plugin/alma_sketchup_mcp/view_operations.rb'
]);

export async function buildArchitectureGoldenLiveEvidence({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const [fixtureSchema, reportSchema, finalization, contract, report] = await Promise.all([
    readJson('schema/controlled-architecture-live-fixture-v1.schema.json'),
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
  assert.equal(finalization.overlay.operation_count, 2);
  assert.deepEqual(finalization.overlay.operations, ['material', 'scene']);
  assert.equal(finalization.overlay.geometry_mutation_performed, false);
  assert.equal(finalization.overlay.material_persisted, true);
  assert.equal(finalization.overlay.scene_persisted, true);
  assert.equal(finalization.identity.model_revision_complete, true);
  assert.equal(finalization.identity.top_level_entities_before, 1);
  assert.equal(finalization.identity.top_level_entities_after, 1);
  assert.equal(finalization.identity.recursive_total_before, 5859);
  assert.equal(finalization.identity.recursive_total_after, 5859);
  assert.equal(finalization.identity.recursive_truncated, false);
  assert.deepEqual(finalization.queue_clean, emptyQueue());

  const originalInputSha256 = await sha256File(PATHS.originalInput);
  assert.equal(originalInputSha256, finalization.source.sha256);
  assert.equal(`sha256:${await sha256File(PATHS.sourceModel)}`, finalization.artifact.sha256);
  assert.equal(`sha256:${await sha256File(PATHS.sourceContract)}`, finalization.contract.sha256);
  assert.equal(contract.case_id, 'architecture-golden');
  assert.equal(contract.artifact_sha256, finalization.artifact.sha256);
  assert.deepEqual(contract.targets, {});
  assert.deepEqual(contract.expectations.required_materials, ['ALMA_Reliability_Architecture_Material']);
  assert.equal(contract.expectations.minimum_scenes, 1);
  assert.deepEqual(contract.expectations.uv_target_roles, []);
  assert.deepEqual(contract.expectations.hidden_target_roles, []);

  validateSuccessReport(report);
  assert.equal(report.runtime_attestation.revision_source_sha256, finalization.runtime_attestation.revision_source_sha256);
  const tasks = new Map(report.result.tasks.map((task) => [task.task_id, task]));
  const material = tasks.get('material_preservation')?.evidence;
  assert(material);
  assert.match(material.initial_signature, /^sha256:[0-9a-f]{64}$/);
  assert.equal(material.initial_signature, material.pre_save_signature);
  assert.equal(material.pre_save_signature, material.post_reopen_signature);
  assert.deepEqual(material.required_materials, ['ALMA_Reliability_Architecture_Material']);
  assert.equal(material.preserved_across_save_reopen, true);

  const presentation = tasks.get('scene_visibility_preservation')?.evidence;
  assert(presentation);
  assert.equal(presentation.scenes, 1);
  assert.equal(presentation.hidden_entities, 0);
  assert.equal(presentation.hash, presentation.pre_save_hash);
  assert.equal(presentation.pre_save_hash, presentation.post_reopen_hash);
  assert.equal(presentation.preserved_across_save_reopen, true);

  const identity = tasks.get('save_reopen_identity')?.evidence;
  assert(identity);
  assert.equal(identity.exact_match, true);
  assert.equal(identity.identity_mode, 'full_recursive');
  assert.equal(identity.entries_before, 5859);
  assert.equal(identity.entries_after, 5859);
  assert.equal(identity.total_before, 5859);
  assert.equal(identity.total_after, 5859);
  assert.equal(identity.model_revision_exact_match, true);
  assert.equal(identity.snapshot_error_diffs, 0);
  assert.equal(identity.active_verified_copy_after_reopen, true);

  const diagnosticPath = path.posix.join(
    path.posix.dirname(report.artifacts.verified_model),
    'architecture-golden.save-reopen-diagnostic.json'
  );
  const diagnostic = await readJson(diagnosticPath);
  assert.equal(diagnostic.case_id, 'architecture-golden');
  assert.equal(diagnostic.exact_identity, true);
  assert.equal(diagnostic.identity_entries_before, 5859);
  assert.equal(diagnostic.identity_entries_after, 5859);
  assert.equal(diagnostic.model_revision_exact_match, true);
  assert.equal(diagnostic.source_path_after_reopen_verified, true);
  assert.equal(diagnostic.runtime_compatibility_ok, true);
  assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0);
  assert.equal(diagnostic.snapshot_diff.verdict, 'pass');

  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));
  const evidence = {
    version: 'architecture-golden-live-evidence.v1',
    kind: 'architecture_golden_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'live_verified',
    evidence_scope: 'single_hash_bound_architecture_metadata_overlay_and_save_reopen_case',
    case_id: 'architecture-golden',
    runtime: report.runtime_attestation,
    source_fixture: {
      derivation_class: finalization.derivation_class,
      original_input_sha256: originalInputSha256,
      original_bytes_unchanged: true,
      source_artifact_sha256: report.artifacts.source_sha256,
      metadata_operations: ['material', 'scene'],
      geometry_mutation_performed: false,
      top_level_entities_before: 1,
      top_level_entities_after: 1,
      recursive_total_before: 5859,
      recursive_total_after: 5859,
      recursive_truncated: false
    },
    preservation_contract: {
      material_name_untrusted: finalization.overlay.material_name_untrusted,
      material_persisted: true,
      scene_name_untrusted: finalization.overlay.scene_name_untrusted,
      scene_persisted: true,
      existing_material_assignments_in_signature: true,
      top_level_visibility_in_signature: true,
      nested_hidden_occurrence_attestation: false
    },
    live_verification: {
      tasks_total: 3,
      tasks_passed: 3,
      material_signature: material.initial_signature,
      material_signature_preserved: true,
      scene_visibility_signature: presentation.hash,
      scene_visibility_signature_preserved: true,
      scenes: 1,
      hidden_top_level_entities: 0,
      save_reopen_exact_identity: true,
      recursive_entries_before: 5859,
      recursive_entries_after: 5859,
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
      architecture_material_scene_preservation: true,
      formal_corpus_cases_passed: 1,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This evidence is bound to one user-mapped architecture source and a controlled metadata-only overlay on a disposable copy; the original SKP remained byte-identical.',
      'The preparation added one material catalog entry and one Scene without adding, deleting, or transforming geometry, and entity counts remained unchanged.',
      'The formal case proves material and top-level Scene/visibility signatures plus full-recursive identity across save and reopen.',
      'The presentation signature reports zero hidden top-level entities; it does not independently attest every nested hidden occurrence in the source architecture.',
      'This advances one of seven formal reliability cases. It does not prove Boolean/manifold, dirty-topology recovery, cross-version behavior, or release acceptance.'
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
  assert.equal(report.selected_case.case_id, 'architecture-golden');
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
  assert.deepEqual(
    report.result.tasks.map((task) => task.task_id),
    ['material_preservation', 'scene_visibility_preservation', 'save_reopen_identity']
  );
  for (const task of report.result.tasks) assert.equal(task.status, 'passed');
}

async function artifactDescriptor(relativePath, expectedPrefixedSha256 = null) {
  const normalized = assertRepoRelativePath(relativePath);
  const stats = await fs.stat(path.join(repoRoot, normalized));
  assert.equal(stats.isFile(), true, `${normalized} is not a file`);
  const sha256 = await sha256File(normalized);
  if (expectedPrefixedSha256) assert.equal(`sha256:${sha256}`, expectedPrefixedSha256);
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
    process.stdout.write('Usage: node scripts/build-architecture-golden-live-evidence.mjs [--output <path>]\n');
  } else {
    buildArchitectureGoldenLiveEvidence(options)
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
