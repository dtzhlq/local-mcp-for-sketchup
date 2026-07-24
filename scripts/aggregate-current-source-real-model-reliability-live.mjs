#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/current-source-real-model-reliability-live-evidence-2026-07-23.json';
const DEFAULT_REPORTS = [
  'output/live-validation/real-model-reliability/deep-shared-components-current-source-v6/real-model-reliability-live-case-report.v1.json',
  'output/live-validation/real-model-reliability/interior-expression-current-source-v1/real-model-reliability-live-case-report.v1.json'
];
const SOURCE_PATHS = [
  'test/reliability-corpus/manifest.json',
  'scripts/aggregate-current-source-real-model-reliability-live.mjs',
  'scripts/run-real-model-reliability-harness.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'src/bridge.mjs',
  'src/model-adoption.mjs',
  'src/queue-runtime.mjs',
  'src/real-model-candidate-intake.mjs',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb'
];

export async function aggregateCurrentSourceRealModelReliabilityLive({
  reportPaths = DEFAULT_REPORTS,
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  assert.deepEqual(reportPaths.length, 2, 'exactly two current-source live reports are required');
  const reportSchema = await readJson('schema/real-model-reliability-live-case-report-v1.schema.json');
  const validateReport = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(reportSchema);
  const reports = [];
  for (const reportPath of reportPaths) {
    const normalized = assertRepoRelativePath(reportPath);
    const report = await readJson(normalized);
    assert.equal(validateReport(report), true, `${normalized}: ${JSON.stringify(validateReport.errors, null, 2)}`);
    validateLiveReport(report, normalized);
    reports.push({ report, reportPath: normalized });
  }
  reports.sort((left, right) => left.report.selected_case.case_id.localeCompare(right.report.selected_case.case_id));
  assert.deepEqual(
    reports.map(({ report }) => report.selected_case.case_id),
    ['deep-shared-components', 'interior-expression'],
    'the aggregate is bound to the reviewed deep-shared and interior cases'
  );

  const first = reports[0].report;
  for (const { report } of reports.slice(1)) {
    assert.deepEqual(report.runtime_attestation, first.runtime_attestation, 'live reports must share one runtime attestation');
    assert.deepEqual(report.full_manifest, first.full_manifest, 'live reports must share one corpus manifest');
  }
  assert.equal(first.full_manifest.case_count, 7);
  const manifest = await readJson(first.full_manifest.path);
  assert.equal(manifest.version, first.full_manifest.version);
  assert.equal(`sha256:${await sha256File(first.full_manifest.path)}`, first.full_manifest.sha256);

  const cases = [];
  for (const item of reports) cases.push(await summarizeCase(item));
  const passedCaseIds = cases.map((entry) => entry.case_id);
  const remainingCaseIds = manifest.cases
    .map((entry) => entry.id)
    .filter((caseId) => !passedCaseIds.includes(caseId));
  assert.equal(remainingCaseIds.length, 5);
  const aggregateDurationMs = cases.reduce((sum, entry) => sum + entry.duration_ms, 0);
  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));

  const evidence = {
    version: 'current-source-real-model-reliability-live-evidence.v1',
    kind: 'current_source_real_model_reliability_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'partial_pass',
    evidence_scope: 'two_hash_bound_real_model_save_reopen_cases',
    runtime: first.runtime_attestation,
    execution_authorization: {
      mode: 'local_operator_ephemeral_process_policy',
      user_authorized_disposable_copies: true,
      queue_required: true,
      allowed_runtimes_explicit: true,
      queue_mutation_explicit: true,
      direct_expert_mutation_explicit: true,
      policy_persisted: false,
      default_policy_unchanged: true,
      agent_self_authorization_allowed: false
    },
    corpus: {
      manifest_path: first.full_manifest.path,
      manifest_sha256: first.full_manifest.sha256,
      formal_cases_total: first.full_manifest.case_count,
      formal_cases_passed: cases.length,
      formal_corpus_complete: false,
      passed_case_ids: passedCaseIds,
      remaining_case_ids: remainingCaseIds
    },
    cases,
    aggregate_metrics: {
      tasks_total: cases.reduce((sum, entry) => sum + entry.tasks_total, 0),
      tasks_passed: cases.reduce((sum, entry) => sum + entry.tasks_passed, 0),
      task_success_rate: 1,
      wrong_object_modification_count: 0,
      silent_geometry_corruption_count: 0,
      aggregate_duration_ms: aggregateDurationMs,
      queue_clean_after_each_case: true
    },
    performance_boundary: {
      stress_case_id: 'interior-expression',
      stress_case_duration_ms: cases.find((entry) => entry.case_id === 'interior-expression').duration_ms,
      interactive_budget_ms: 120000,
      stress_case_within_interactive_budget: false,
      use_as_default_agent_payload: false,
      complete_revision_retained: true,
      bounded_occurrence_payload_retained: true,
      next_action: 'separate_revision_attestation_from_payload_and_add_runtime_budget'
    },
    source_sha256: sourceSha256,
    acceptance: {
      two_case_live_reliability: true,
      full_recursive_save_reopen: true,
      bounded_large_model_save_reopen: true,
      shared_definition_scope: true,
      material_and_scene_preservation: true,
      mutation_cases_passed: 0,
      boolean_manifold: false,
      dirty_topology_recovery: false,
      locked_transform_rollback: false,
      formal_corpus_cases_passed: 2,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      agent_gateway_default_profile_qualified: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This evidence binds two current-source SketchUp 2026 live runs to hash-bound disposable copies; the operator-supplied source artifacts remained byte-identical and were never overwritten.',
      'The deep-shared case proves full recursive occurrence identity for 11,474 entries and 2,986 shared-definition occurrences across save/reopen.',
      'The interior stress case proves a complete definition-merkle.v2 revision across 220,006 occurrences plus a deterministic bounded sample of 100,000 entries, material preservation, and one scene visibility signature.',
      'The interior run exceeded the interactive budget, so this stress profile is not a default payload contract for ordinary Agents; performance projection remains open.',
      'No geometry mutation case is promoted by this wrapper. Boolean/manifold, dirty-topology recovery, locked-transform rollback, five remaining corpus cases, independent Agent runs, and cross-version evidence remain open.',
      'This is partial engineering evidence only. It is not release acceptance and cannot grant execution authority to an Agent.'
    ]
  };

  const normalizedOutput = assertRepoRelativePath(outputPath);
  await fs.mkdir(path.dirname(path.join(repoRoot, normalizedOutput)), { recursive: true });
  await fs.writeFile(path.join(repoRoot, normalizedOutput), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { evidence, output_path: normalizedOutput };
}

async function summarizeCase({ report, reportPath }) {
  const identityTask = report.result.tasks.find((task) => task.task_id === 'save_reopen_identity');
  assert(identityTask, `${report.selected_case.case_id} is missing save_reopen_identity`);
  const identity = identityTask.evidence;
  const diagnosticPath = path.posix.join(
    path.posix.dirname(report.artifacts.verified_model),
    `${report.selected_case.case_id}.save-reopen-diagnostic.json`
  );
  const diagnostic = await readJson(assertRepoRelativePath(diagnosticPath));
  assert.equal(diagnostic.case_id, report.selected_case.case_id);
  assert.equal(diagnostic.exact_identity, true);
  assert.equal(diagnostic.model_revision_exact_match, true);
  assert.equal(diagnostic.source_path_after_reopen_verified, true);
  assert.equal(diagnostic.runtime_compatibility_ok, true);
  assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0);
  assert.equal(diagnostic.snapshot_diff.verdict, 'pass');
  assert.equal(diagnostic.identity_signature_before, diagnostic.identity_signature_after);
  assert.equal(diagnostic.identity_signature_after, identity.signature);

  const taskIds = report.result.tasks.map((task) => task.task_id);
  const coverage = {
    full_recursive_identity: identity.identity_mode === 'full_recursive',
    bounded_recursive_identity: identity.identity_mode === 'complete_revision_bounded_occurrence_sample',
    shared_definition_scope: taskIds.includes('shared_definition_identity'),
    material_preservation: taskIds.includes('material_preservation'),
    scene_visibility_preservation: taskIds.includes('scene_visibility_preservation'),
    save_reopen_identity: true
  };
  if (report.selected_case.case_id === 'deep-shared-components') {
    const recursive = report.result.tasks.find((task) => task.task_id === 'large_recursive_index')?.evidence;
    const shared = report.result.tasks.find((task) => task.task_id === 'shared_definition_identity')?.evidence;
    assert.equal(recursive.materialized_entries, 11474);
    assert.equal(recursive.total_entries, 11474);
    assert.equal(recursive.truncated, false);
    assert.equal(shared.shared_occurrences, 2986);
  } else {
    const material = report.result.tasks.find((task) => task.task_id === 'material_preservation')?.evidence;
    const scene = report.result.tasks.find((task) => task.task_id === 'scene_visibility_preservation')?.evidence;
    assert.equal(material.preserved_across_save_reopen, true);
    assert.equal(material.pre_save_signature, material.post_reopen_signature);
    assert.equal(scene.preserved_across_save_reopen, true);
    assert.equal(scene.scenes, 1);
    assert.equal(identity.total_before, 220006);
    assert.equal(identity.entries_before, 100000);
  }

  return {
    case_id: report.selected_case.case_id,
    domain: report.selected_case.domain,
    result: 'pass',
    duration_ms: report.result.duration_ms,
    tasks_total: report.metrics.tasks_total,
    tasks_passed: report.metrics.tasks_passed,
    task_ids: taskIds,
    coverage,
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

function validateLiveReport(report, reportPath) {
  assert.equal(report.ok, true, `${reportPath} did not pass`);
  assert.equal(report.runtime, 'queue');
  assert.equal(report.result.ok, true);
  assert.equal(report.acceptance.selected_case_passed, true);
  assert.equal(report.acceptance.formal_corpus_cases_passed, 1);
  assert.equal(report.acceptance.formal_corpus_cases_total, 7);
  assert.equal(report.acceptance.formal_corpus_complete, false);
  assert.equal(report.acceptance.release_acceptance, false);
  assert.equal(report.safety.explicit_queue_opt_in, true);
  assert.equal(report.safety.ephemeral_operator_policy, true);
  assert.equal(report.safety.default_policy_unchanged, true);
  assert.equal(report.safety.preflight_before_queue, true);
  assert.equal(report.safety.disposable_copy_only, true);
  assert.equal(report.safety.original_bytes_unchanged, true);
  assert.equal(report.metrics.tasks_total, report.metrics.tasks_passed);
  assert.equal(report.metrics.task_success_rate, 1);
  assert.equal(report.metrics.wrong_object_modification_count, 0);
  assert.equal(report.metrics.silent_geometry_corruption_count, 0);
  assert.deepEqual(report.queue_clean, { queue: 0, processing: 0, responses: 0, lock: false });
  assert.equal(report.artifacts.source_sha256, report.artifacts.working_copy_sha256);
  assert.equal(report.result.details.artifact_sha256, report.artifacts.source_sha256);
  for (const task of report.result.tasks) assert.equal(task.status, 'passed');
}

async function artifactDescriptor(relativePath, expectedPrefixedSha256 = null) {
  const normalized = assertRepoRelativePath(relativePath);
  const stats = await fs.stat(path.join(repoRoot, normalized));
  assert.equal(stats.isFile(), true, `${normalized} is not a file`);
  const sha256 = await sha256File(normalized);
  if (expectedPrefixedSha256) assert.equal(`sha256:${sha256}`, expectedPrefixedSha256, `${normalized} hash mismatch`);
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
  return crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, assertRepoRelativePath(relativePath)))).digest('hex');
}

function parseArgs(argv) {
  const options = { reportPaths: [], outputPath: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') options.reportPaths.push(argv[++index]);
    else if (arg === '--output') options.outputPath = argv[++index];
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.reportPaths.length === 0) options.reportPaths = DEFAULT_REPORTS;
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/aggregate-current-source-real-model-reliability-live.mjs [--report <path> --report <path>] [--output <path>]\n');
  } else {
    aggregateCurrentSourceRealModelReliabilityLive(options)
      .then(({ evidence, output_path }) => process.stdout.write(`${JSON.stringify({
        ok: true,
        output: output_path,
        cases_passed: evidence.acceptance.formal_corpus_cases_passed,
        cases_total: evidence.acceptance.formal_corpus_cases_total,
        tasks_passed: evidence.aggregate_metrics.tasks_passed,
        release_acceptance: evidence.acceptance.release_acceptance
      }, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
      });
  }
}
