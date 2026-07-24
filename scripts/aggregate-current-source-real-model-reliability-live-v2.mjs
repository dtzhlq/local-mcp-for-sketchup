#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/current-source-real-model-reliability-live-evidence-v2-2026-07-23.json';
const BASE_EVIDENCE_PATH = 'docs/evidence/current-source-real-model-reliability-live-evidence-2026-07-23.json';
const LOCK_GUARD_EVIDENCE_PATH = 'docs/evidence/locked-target-guard-live-evidence-2026-07-23.json';
const SCALED_REPORT_PATH = 'output/live-validation/real-model-reliability/scaled-mirrored-locked-current-source-v2/real-model-reliability-live-case-report.v1.json';

const SOURCE_PATHS = Object.freeze([
  'test/reliability-corpus/manifest.json',
  'scripts/aggregate-current-source-real-model-reliability-live-v2.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/current-source-real-model-reliability-live-evidence-v2.schema.json',
  'schema/locked-target-guard-live-evidence-v1.schema.json',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'sketchup_plugin/alma_sketchup_mcp.rb',
  'sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/runtime_source_manifest.rb'
]);

export async function aggregateCurrentSourceRealModelReliabilityLiveV2({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const [
    baseSchema,
    lockGuardSchema,
    reportSchema,
    baseEvidence,
    lockGuardEvidence,
    scaledReport
  ] = await Promise.all([
    readJson('schema/current-source-real-model-reliability-live-evidence-v1.schema.json'),
    readJson('schema/locked-target-guard-live-evidence-v1.schema.json'),
    readJson('schema/real-model-reliability-live-case-report-v1.schema.json'),
    readJson(BASE_EVIDENCE_PATH),
    readJson(LOCK_GUARD_EVIDENCE_PATH),
    readJson(SCALED_REPORT_PATH)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validateBase = ajv.compile(baseSchema);
  const validateLockGuard = ajv.compile(lockGuardSchema);
  const validateReport = ajv.compile(reportSchema);
  assert.equal(validateBase(baseEvidence), true, JSON.stringify(validateBase.errors, null, 2));
  assert.equal(validateLockGuard(lockGuardEvidence), true, JSON.stringify(validateLockGuard.errors, null, 2));
  assert.equal(validateReport(scaledReport), true, JSON.stringify(validateReport.errors, null, 2));
  await validateFrozenBaseEvidence(baseEvidence);
  validateScaledReport(scaledReport);

  assert.equal(lockGuardEvidence.case_id, 'scaled-mirrored-locked');
  assert.equal(lockGuardEvidence.result, 'fixed_and_live_verified');
  assert.equal(lockGuardEvidence.acceptance.selected_case_passed, true);
  assert.equal(lockGuardEvidence.acceptance.release_acceptance, false);
  assert.equal(lockGuardEvidence.artifacts.success_report.path, SCALED_REPORT_PATH);
  assert.equal(
    lockGuardEvidence.artifacts.success_report.sha256,
    await sha256File(SCALED_REPORT_PATH)
  );
  assert.deepEqual(scaledReport.runtime_attestation, baseEvidence.runtime);
  assert.equal(baseEvidence.corpus.formal_cases_passed, 2);
  assert.deepEqual(baseEvidence.corpus.passed_case_ids, ['deep-shared-components', 'interior-expression']);
  assert.equal(baseEvidence.acceptance.release_acceptance, false);

  const baseCases = baseEvidence.cases.map((entry) => ({
    ...structuredClone(entry),
    mutation: {
      geometry_mutation_executed: false,
      locked_target_fail_closed: false,
      rollback_verified: false,
      guard_unchanged: false,
      locked_target_unchanged: false,
      exact_target_changed: false,
      nonuniform_scale: null,
      mirror_axis: null,
      recovery_attempts: 0,
      recoveries: 0
    }
  }));
  const scaledCase = await summarizeScaledCase(scaledReport, SCALED_REPORT_PATH);
  const cases = [...baseCases, scaledCase]
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
  assert.deepEqual(
    cases.map((entry) => entry.case_id),
    ['deep-shared-components', 'interior-expression', 'scaled-mirrored-locked']
  );

  const manifest = await readJson(baseEvidence.corpus.manifest_path);
  assert.equal(`sha256:${await sha256File(baseEvidence.corpus.manifest_path)}`, baseEvidence.corpus.manifest_sha256);
  const passedCaseIds = cases.map((entry) => entry.case_id);
  const remainingCaseIds = manifest.cases
    .map((entry) => entry.id)
    .filter((caseId) => !passedCaseIds.includes(caseId));
  assert.equal(remainingCaseIds.length, 4);

  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));
  const aggregateDurationMs = cases.reduce((sum, entry) => sum + entry.duration_ms, 0);
  const tasksTotal = cases.reduce((sum, entry) => sum + entry.tasks_total, 0);
  const tasksPassed = cases.reduce((sum, entry) => sum + entry.tasks_passed, 0);
  assert.equal(tasksTotal, 11);
  assert.equal(tasksPassed, 11);

  const evidence = {
    version: 'current-source-real-model-reliability-live-evidence.v2',
    kind: 'current_source_real_model_reliability_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'partial_pass',
    evidence_scope: 'three_hash_bound_real_model_cases_with_one_guarded_geometry_mutation',
    runtime: baseEvidence.runtime,
    execution_authorization: baseEvidence.execution_authorization,
    lineage: {
      base_two_case_evidence: await artifactDescriptor(BASE_EVIDENCE_PATH),
      locked_target_guard_evidence: await artifactDescriptor(LOCK_GUARD_EVIDENCE_PATH)
    },
    corpus: {
      manifest_path: baseEvidence.corpus.manifest_path,
      manifest_sha256: baseEvidence.corpus.manifest_sha256,
      formal_cases_total: 7,
      formal_cases_passed: 3,
      formal_corpus_complete: false,
      passed_case_ids: passedCaseIds,
      remaining_case_ids: remainingCaseIds
    },
    cases,
    aggregate_metrics: {
      tasks_total: tasksTotal,
      tasks_passed: tasksPassed,
      task_success_rate: 1,
      geometry_mutation_cases_passed: 1,
      wrong_object_modification_count: 0,
      silent_geometry_corruption_count: 0,
      recovery_attempts: 1,
      recoveries: 1,
      recovery_rate: 1,
      aggregate_duration_ms: aggregateDurationMs,
      queue_clean_after_each_case: true
    },
    performance_boundary: baseEvidence.performance_boundary,
    locked_target_guard: {
      native_lock_gap_discovered: true,
      native_lock_alone_sufficient: false,
      application_guard_required: true,
      loaded_boolean_source_sha256: lockGuardEvidence.runtime.loaded_boolean_source_sha256,
      mutating_operations_guarded: lockGuardEvidence.fix.mutating_operations_guarded,
      read_only_locked_access: lockGuardEvidence.fix.read_only_locked_access,
      locked_batch_rejected_before_commit: true,
      locked_target_unchanged: true,
      guard_unchanged: true
    },
    source_sha256: sourceSha256,
    acceptance: {
      three_case_live_reliability: true,
      full_recursive_save_reopen: true,
      bounded_large_model_save_reopen: true,
      shared_definition_scope: true,
      material_and_scene_preservation: true,
      mutation_cases_passed: 1,
      locked_transform_rollback: true,
      native_lock_guard_enforced: true,
      boolean_manifold: false,
      dirty_topology_recovery: false,
      appearance_uv_hidden_preservation: false,
      architecture_case: false,
      formal_corpus_cases_passed: 3,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      agent_gateway_default_profile_qualified: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This v2 wrapper preserves the immutable two-case evidence and adds one separately hash-bound scaled/mirrored/locked current-source live run.',
      'The three formal cases total 11 of 11 named tasks with zero wrong-object modifications and zero silent geometry corruption.',
      'The scaled/mirrored/locked run is the first promoted geometry-mutation case: the locked batch was rejected before commit, rollback isolation held, and only the exact transform target changed.',
      'Native SketchUp locked state was proven insufficient against direct Ruby transforms; current acceptance therefore requires the attested application-level resolver guard.',
      'The transformed model retained exact 12,944-entry recursive identity, an unchanged model revision after save/reopen, and zero snapshot errors.',
      'The interior stress run remains outside the 120-second ordinary-Agent interactive budget, so this corpus is not a default projection contract.',
      'Architecture, Boolean/manifold, imported dirty-topology recovery, appearance/UV/hidden preservation, independent Agent runs, and cross-version evidence remain open.',
      'This is 3 of 7 partial engineering evidence only. It is not release acceptance and cannot grant execution authority to an Agent.'
    ]
  };

  const normalizedOutput = assertRepoRelativePath(outputPath);
  await fs.mkdir(path.dirname(path.join(repoRoot, normalizedOutput)), { recursive: true });
  await fs.writeFile(path.join(repoRoot, normalizedOutput), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { evidence, output_path: normalizedOutput };
}

async function validateFrozenBaseEvidence(evidence) {
  for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
    assert.match(expected, /^[0-9a-f]{64}$/, `${relativePath} has an invalid historical source hash`);
    const stats = await fs.stat(path.join(repoRoot, assertRepoRelativePath(relativePath)));
    assert.equal(stats.isFile(), true, `${relativePath} is missing from the current workspace`);
  }
  for (const corpusCase of evidence.cases) {
    for (const descriptor of Object.values(corpusCase.artifacts)) {
      assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} drifted`);
      assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes);
    }
  }
}

function validateScaledReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'queue');
  assert.equal(report.selected_case.case_id, 'scaled-mirrored-locked');
  assert.equal(report.result.ok, true);
  assert.equal(report.metrics.tasks_total, 5);
  assert.equal(report.metrics.tasks_passed, 5);
  assert.equal(report.metrics.task_success_rate, 1);
  assert.equal(report.metrics.wrong_object_modification_count, 0);
  assert.equal(report.metrics.silent_geometry_corruption_count, 0);
  assert.equal(report.metrics.recovery_attempts, 1);
  assert.equal(report.metrics.recoveries, 1);
  assert.equal(report.metrics.recovery_rate, 1);
  assert.equal(report.safety.original_bytes_unchanged, true);
  assert.equal(report.safety.disposable_copy_only, true);
  assert.deepEqual(report.queue_clean, emptyQueue());
  assert.equal(report.acceptance.selected_case_passed, true);
  assert.equal(report.acceptance.release_acceptance, false);
  assert.equal(report.artifacts.source_sha256, report.artifacts.working_copy_sha256);
  assert.equal(report.result.details.artifact_sha256, report.artifacts.source_sha256);
  for (const task of report.result.tasks) assert.equal(task.status, 'passed');
}

async function summarizeScaledCase(report, reportPath) {
  const taskMap = new Map(report.result.tasks.map((task) => [task.task_id, task]));
  assert.deepEqual(taskMap.get('locked_fail_closed')?.evidence, { rejected: true });
  assert.deepEqual(taskMap.get('rollback')?.evidence, {
    revision_preserved: true,
    guard_unchanged: true,
    locked_target_unchanged: true
  });
  assert.deepEqual(taskMap.get('nonuniform_mirror')?.evidence, {
    mirror: 'x',
    scale: [1.5, 0.75, 2],
    exact_target_changed: true
  });
  assert.deepEqual(taskMap.get('wrong_object_isolation')?.evidence, {
    guard_unchanged: true,
    locked_target_unchanged: true
  });
  const identity = taskMap.get('save_reopen_identity')?.evidence;
  assert(identity);
  assert.equal(identity.identity_mode, 'full_recursive');
  assert.equal(identity.entries_before, 12944);
  assert.equal(identity.entries_after, 12944);
  assert.equal(identity.total_before, 12944);
  assert.equal(identity.total_after, 12944);
  assert.equal(identity.exact_match, true);
  assert.equal(identity.model_revision_exact_match, true);
  assert.equal(identity.snapshot_error_diffs, 0);
  assert.equal(identity.active_verified_copy_after_reopen, true);

  const diagnosticPath = path.posix.join(
    path.posix.dirname(report.artifacts.verified_model),
    'scaled-mirrored-locked.save-reopen-diagnostic.json'
  );
  const diagnostic = await readJson(diagnosticPath);
  assert.equal(diagnostic.case_id, 'scaled-mirrored-locked');
  assert.equal(diagnostic.exact_identity, true);
  assert.equal(diagnostic.model_revision_exact_match, true);
  assert.equal(diagnostic.source_path_after_reopen_verified, true);
  assert.equal(diagnostic.runtime_compatibility_ok, true);
  assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0);
  assert.equal(diagnostic.snapshot_diff.verdict, 'pass');
  assert.equal(diagnostic.identity_signature_before, diagnostic.identity_signature_after);
  assert.equal(diagnostic.identity_signature_after, identity.signature);

  return {
    case_id: report.selected_case.case_id,
    domain: report.selected_case.domain,
    result: 'pass',
    duration_ms: report.result.duration_ms,
    tasks_total: report.metrics.tasks_total,
    tasks_passed: report.metrics.tasks_passed,
    task_ids: report.result.tasks.map((task) => task.task_id),
    coverage: {
      full_recursive_identity: true,
      bounded_recursive_identity: false,
      shared_definition_scope: false,
      material_preservation: false,
      scene_visibility_preservation: false,
      save_reopen_identity: true
    },
    mutation: {
      geometry_mutation_executed: true,
      locked_target_fail_closed: true,
      rollback_verified: true,
      guard_unchanged: true,
      locked_target_unchanged: true,
      exact_target_changed: true,
      nonuniform_scale: [1.5, 0.75, 2],
      mirror_axis: 'x',
      recovery_attempts: 1,
      recoveries: 1
    },
    identity: {
      mode: identity.identity_mode,
      entries_before: identity.entries_before,
      entries_after: identity.entries_after,
      total_before: identity.total_before,
      total_after: identity.total_after,
      recursive_limit: identity.recursive_limit,
      truncated_before: identity.recursive_truncated_before,
      truncated_after: identity.recursive_truncated_after,
      exact_match: identity.exact_match,
      identity_digest: identity.signature,
      snapshot_error_diffs: identity.snapshot_error_diffs,
      model_revision_before: identity.model_revision_before,
      model_revision_after: identity.model_revision_after,
      model_revision_exact_match: identity.model_revision_exact_match,
      model_revision_strategy: identity.model_revision_strategy,
      model_revision_source_sha256: identity.model_revision_source_sha256,
      active_verified_copy_after_reopen: identity.active_verified_copy_after_reopen
    },
    quality: {
      wrong_object_modification_count: report.metrics.wrong_object_modification_count,
      silent_geometry_corruption_count: report.metrics.silent_geometry_corruption_count,
      original_bytes_unchanged: report.safety.original_bytes_unchanged,
      disposable_copy_only: report.safety.disposable_copy_only,
      queue_clean: report.queue_clean
    },
    artifacts: {
      report: await artifactDescriptor(reportPath),
      diagnostic: await artifactDescriptor(diagnosticPath),
      source_model: await artifactDescriptor(report.artifacts.source_artifact, report.artifacts.source_sha256),
      contract: await artifactDescriptor(report.artifacts.contract, report.artifacts.contract_sha256),
      verified_model: await artifactDescriptor(report.artifacts.verified_model, report.artifacts.verified_model_sha256)
    }
  };
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
    process.stdout.write('Usage: node scripts/aggregate-current-source-real-model-reliability-live-v2.mjs [--output <path>]\n');
  } else {
    aggregateCurrentSourceRealModelReliabilityLiveV2(options)
      .then(({ evidence, output_path }) => process.stdout.write(`${JSON.stringify({
        ok: true,
        output: output_path,
        cases_passed: evidence.acceptance.formal_corpus_cases_passed,
        cases_total: evidence.acceptance.formal_corpus_cases_total,
        tasks_passed: evidence.aggregate_metrics.tasks_passed,
        mutation_cases_passed: evidence.acceptance.mutation_cases_passed,
        release_acceptance: evidence.acceptance.release_acceptance
      }, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
