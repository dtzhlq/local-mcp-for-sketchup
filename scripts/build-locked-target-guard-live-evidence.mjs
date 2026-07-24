#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_OUTPUT = 'docs/evidence/locked-target-guard-live-evidence-2026-07-23.json';
const PATHS = Object.freeze({
  originalInput: 'test/模型/场地模型.skp',
  finalizationReport: 'output/live-validation/real-model-reliability-preparation/scaled-mirrored-locked-derived-v1/run-20260723-v4/finalization-report.v1.json',
  sourceModel: 'output/live-validation/real-model-reliability-inputs/scaled-mirrored-locked-derived-v1/scaled-mirrored-locked.skp',
  sourceContract: 'output/live-validation/real-model-reliability-inputs/scaled-mirrored-locked-derived-v1/scaled-mirrored-locked.reliability.json',
  failureReport: 'output/live-validation/real-model-reliability/scaled-mirrored-locked-current-source-v1/real-model-reliability-live-case-failure.v1.json',
  failureState: 'output/live-validation/real-model-reliability/scaled-mirrored-locked-current-source-v1/locked-native-bypass-failure-state.skp',
  successReport: 'output/live-validation/real-model-reliability/scaled-mirrored-locked-current-source-v2/real-model-reliability-live-case-report.v1.json',
  successDiagnostic: 'output/live-validation/real-model-reliability/scaled-mirrored-locked-current-source-v2/live-work/preflight-8e9747dd-e2f1-4954-9a8c-284cfe5a7919/01-scaled-mirrored-locked/scaled-mirrored-locked.save-reopen-diagnostic.json'
});

const SOURCE_PATHS = Object.freeze([
  'scripts/build-locked-target-guard-live-evidence.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'sketchup_plugin/alma_sketchup_mcp.rb',
  'sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/runtime_source_manifest.rb',
  'test/ruby/locked_target_guard_test.rb'
]);

export async function buildLockedTargetGuardLiveEvidence({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
  const fixtureSchema = await readJson('schema/controlled-transform-live-fixture-v1.schema.json');
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validateReport = ajv.compile(reportSchema);
  const validateFixture = ajv.compile(fixtureSchema);

  const finalization = await readJson(PATHS.finalizationReport);
  assert.equal(validateFixture(finalization), true, JSON.stringify(validateFixture.errors, null, 2));
  assert.equal(finalization.status, 'ready_for_formal_live_case');
  assert.equal(finalization.source.original_bytes_unchanged, true);
  assert.equal(finalization.native_lock.observed_before_save, true);
  assert.equal(finalization.native_lock.observed_after_reopen, true);
  assert.equal(finalization.identity.model_revision_complete, true);
  assert.equal(finalization.identity.recursive_total, 12944);
  assert.equal(finalization.identity.recursive_materialized, 12944);
  assert.equal(finalization.identity.recursive_truncated, false);
  assert.deepEqual(finalization.queue_clean, emptyQueue());

  const originalInputSha256 = await sha256File(PATHS.originalInput);
  assert.equal(originalInputSha256, finalization.source.sha256);
  assert.equal(`sha256:${await sha256File(PATHS.sourceModel)}`, finalization.artifact.sha256);
  assert.equal(`sha256:${await sha256File(PATHS.sourceContract)}`, finalization.contract.sha256);

  const failure = await readJson(PATHS.failureReport);
  assert.equal(failure.version, 'real-model-reliability-live-case-failure.v1');
  assert.equal(failure.kind, 'real_model_reliability_live_case_failure');
  assert.equal(failure.ok, false);
  assert.equal(failure.runtime, 'queue');
  assert.equal(failure.selected_case.case_id, 'scaled-mirrored-locked');
  assert.equal(failure.result.ok, false);
  assert.equal(failure.result.tasks[0].task_id, 'locked_fail_closed');
  assert.equal(failure.result.tasks[0].status, 'failed');
  assert.match(failure.result.error, /Expected operation to reject with .*locked/);
  assert.deepEqual(failure.queue_clean, emptyQueue());
  assert.equal(failure.acceptance.release_acceptance, false);

  const success = await readJson(PATHS.successReport);
  assert.equal(validateReport(success), true, JSON.stringify(validateReport.errors, null, 2));
  assert.equal(success.ok, true);
  assert.equal(success.runtime, 'queue');
  assert.equal(success.selected_case.case_id, 'scaled-mirrored-locked');
  assert.equal(success.metrics.tasks_total, 5);
  assert.equal(success.metrics.tasks_passed, 5);
  assert.equal(success.metrics.wrong_object_modification_count, 0);
  assert.equal(success.metrics.silent_geometry_corruption_count, 0);
  assert.equal(success.metrics.recovery_attempts, 1);
  assert.equal(success.metrics.recoveries, 1);
  assert.equal(success.metrics.recovery_rate, 1);
  assert.deepEqual(success.queue_clean, emptyQueue());
  assert.equal(success.safety.original_bytes_unchanged, true);
  assert.equal(success.acceptance.release_acceptance, false);

  const tasks = new Map(success.result.tasks.map((task) => [task.task_id, task]));
  assert.deepEqual(tasks.get('locked_fail_closed')?.evidence, { rejected: true });
  assert.deepEqual(tasks.get('rollback')?.evidence, {
    revision_preserved: true,
    guard_unchanged: true,
    locked_target_unchanged: true
  });
  assert.deepEqual(tasks.get('nonuniform_mirror')?.evidence, {
    mirror: 'x',
    scale: [1.5, 0.75, 2],
    exact_target_changed: true
  });
  assert.deepEqual(tasks.get('wrong_object_isolation')?.evidence, {
    guard_unchanged: true,
    locked_target_unchanged: true
  });

  const identity = tasks.get('save_reopen_identity')?.evidence;
  assert(identity);
  assert.equal(identity.exact_match, true);
  assert.equal(identity.identity_mode, 'full_recursive');
  assert.equal(identity.entries_before, 12944);
  assert.equal(identity.entries_after, 12944);
  assert.equal(identity.total_before, 12944);
  assert.equal(identity.total_after, 12944);
  assert.equal(identity.model_revision_exact_match, true);
  assert.equal(identity.snapshot_error_diffs, 0);
  assert.equal(identity.active_verified_copy_after_reopen, true);

  const diagnostic = await readJson(PATHS.successDiagnostic);
  assert.equal(diagnostic.case_id, 'scaled-mirrored-locked');
  assert.equal(diagnostic.exact_identity, true);
  assert.equal(diagnostic.model_revision_exact_match, true);
  assert.equal(diagnostic.source_path_after_reopen_verified, true);
  assert.equal(diagnostic.runtime_compatibility_ok, true);
  assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0);
  assert.equal(diagnostic.snapshot_diff.verdict, 'pass');

  const { stdout: rubyGuardStdout } = await execFile('ruby', ['test/ruby/locked_target_guard_test.rb'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  const rubyGuard = JSON.parse(rubyGuardStdout);
  assert.deepEqual(rubyGuard, {
    ok: true,
    mutating_operations_guarded: 25,
    top_level_locked_rejected: true,
    locked_ancestor_rejected: true,
    invalid_target_rejected: true,
    selection_read_only_allowed: true,
    manifold_check_read_only_allowed: true,
    manifold_repair_locked_rejected: true
  });

  const booleanSourceSha256 = await sha256File('sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb');
  const modelRevisionSourceSha256 = await sha256File('sketchup_plugin/alma_sketchup_mcp/model_revision.rb');
  assert.equal(booleanSourceSha256, '7bf36679d5052ecf7963ce945a8bc91796fa91024a471804be024b502ff8900e');
  assert.equal(modelRevisionSourceSha256, success.runtime_attestation.revision_source_sha256);

  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));

  const evidence = {
    version: 'locked-target-guard-live-evidence.v1',
    kind: 'locked_target_guard_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'fixed_and_live_verified',
    evidence_scope: 'single_hash_bound_native_lock_discovery_fix_and_rerun',
    case_id: 'scaled-mirrored-locked',
    runtime: {
      ...success.runtime_attestation,
      loaded_boolean_source_sha256: booleanSourceSha256,
      loaded_boolean_source_match: true,
      full_restart_observed: true
    },
    source_fixture: {
      derivation_class: finalization.derivation_class,
      original_input_sha256: originalInputSha256,
      original_bytes_unchanged: true,
      native_lock_observed_before_save: true,
      native_lock_observed_after_reopen: true,
      locked_target_persistent_id: finalization.native_lock.target_persistent_id,
      recursive_total: finalization.identity.recursive_total,
      recursive_materialized: finalization.identity.recursive_materialized,
      recursive_truncated: finalization.identity.recursive_truncated
    },
    discovery: {
      expected_locked_batch_rejection: true,
      observed_locked_batch_rejection: false,
      native_lock_alone_prevented_ruby_mutation: false,
      batch_unexpectedly_committed: true,
      failure_state_saved: true,
      queue_clean_after_failed_expectation: true,
      failure_error: failure.result.error,
      root_cause: 'SketchUp native locked state does not itself prevent Ruby transform calls; the central entity resolver lacked an application-level locked-target guard.'
    },
    fix: {
      central_mutation_guard_added: true,
      top_level_locked_target_rejected: true,
      locked_occurrence_ancestor_rejected: true,
      invalid_target_rejected_even_for_read_only_lookup: true,
      nested_make_unique_precheck: true,
      boolean_tool_guard_propagated: true,
      mutating_operations_guarded: rubyGuard.mutating_operations_guarded,
      read_only_locked_access: ['set_selection', 'manifold_check'],
      manifold_repair_locked_rejected: true,
      runtime_restart_required: true,
      runtime_attestation_bound: true
    },
    live_verification: {
      tasks_total: success.metrics.tasks_total,
      tasks_passed: success.metrics.tasks_passed,
      locked_batch_rejected_before_commit: true,
      rollback_revision_preserved: true,
      guard_unchanged: true,
      locked_target_unchanged: true,
      exact_transform_target_changed: true,
      nonuniform_scale: [1.5, 0.75, 2],
      mirror_axis: 'x',
      save_reopen_exact_identity: true,
      recursive_entries_before: identity.entries_before,
      recursive_entries_after: identity.entries_after,
      model_revision_exact_match: true,
      snapshot_error_diffs: 0,
      wrong_object_modification_count: 0,
      silent_geometry_corruption_count: 0,
      recovery_attempts: 1,
      recoveries: 1,
      recovery_rate: 1,
      queue_clean: true
    },
    artifacts: {
      original_input: await artifactDescriptor(PATHS.originalInput),
      finalization_report: await artifactDescriptor(PATHS.finalizationReport),
      source_model: await artifactDescriptor(PATHS.sourceModel, finalization.artifact.sha256),
      source_contract: await artifactDescriptor(PATHS.sourceContract, finalization.contract.sha256),
      failure_report: await artifactDescriptor(PATHS.failureReport),
      failure_state: await artifactDescriptor(PATHS.failureState),
      success_report: await artifactDescriptor(PATHS.successReport),
      success_diagnostic: await artifactDescriptor(PATHS.successDiagnostic),
      verified_model: await artifactDescriptor(success.artifacts.verified_model, success.artifacts.verified_model_sha256)
    },
    source_sha256: sourceSha256,
    acceptance: {
      native_lock_gap_discovered: true,
      application_lock_guard_verified: true,
      selected_case_passed: true,
      formal_corpus_cases_passed: 1,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This evidence is bound to one controlled fixture over a user-authorized disposable real-model copy; the original input remained byte-identical.',
      'The first run is retained as a negative discovery: SketchUp native locked state alone did not reject the Ruby mutation batch.',
      'The fix is an application-level central resolver guard, including persistent-path ancestors and Boolean tool resolution; read-only selection and manifold inspection remain available.',
      'The fresh-process rerun proves fail-closed rejection, rollback isolation, one exact nonuniform mirrored transform, and exact 12,944-entry save/reopen identity.',
      'The result advances one of seven formal reliability cases. It does not prove Boolean/manifold, dirty-topology recovery, appearance/UV/hidden preservation, architecture, independent Agents, cross-version behavior, or release acceptance.'
    ]
  };

  const normalizedOutput = assertRepoRelativePath(outputPath);
  await fs.mkdir(path.dirname(path.join(repoRoot, normalizedOutput)), { recursive: true });
  await fs.writeFile(path.join(repoRoot, normalizedOutput), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { evidence, output_path: normalizedOutput };
}

function emptyQueue() {
  return { queue: 0, processing: 0, responses: 0, lock: false };
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
    process.stdout.write('Usage: node scripts/build-locked-target-guard-live-evidence.mjs [--output <path>]\n');
  } else {
    buildLockedTargetGuardLiveEvidence(options)
      .then(({ evidence, output_path }) => process.stdout.write(`${JSON.stringify({
        ok: true,
        output: output_path,
        case_id: evidence.case_id,
        tasks_passed: evidence.live_verification.tasks_passed,
        release_acceptance: evidence.acceptance.release_acceptance
      }, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
