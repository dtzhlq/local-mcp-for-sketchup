#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/current-source-real-model-reliability-live-evidence-v5-2026-07-23.json';
const PRIOR_EVIDENCE_PATH = 'docs/evidence/current-source-real-model-reliability-live-evidence-v4-2026-07-23.json';
const DIRTY_REPORT_PATH = 'output/live-validation/real-model-reliability/imported-dirty-topology-current-source-v6/real-model-reliability-live-case-report.v1.json';

const SOURCE_PATHS = Object.freeze([
  'test/reliability-corpus/manifest.json',
  'scripts/aggregate-current-source-real-model-reliability-live-v5.mjs',
  'scripts/prepare-imported-dirty-topology-live-fixture.mjs',
  'scripts/run-real-model-reliability-harness.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/current-source-real-model-reliability-live-evidence-v5.schema.json',
  'schema/controlled-dirty-topology-live-fixture-v1.schema.json',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'src/bridge.mjs',
  'src/queue-runtime.mjs',
  'sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/runtime_source_manifest.rb'
]);

export async function aggregateCurrentSourceRealModelReliabilityLiveV5({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const [priorSchema, reportSchema, prior, report] = await Promise.all([
    readJson('schema/current-source-real-model-reliability-live-evidence-v4.schema.json'),
    readJson('schema/real-model-reliability-live-case-report-v1.schema.json'),
    readJson(PRIOR_EVIDENCE_PATH),
    readJson(DIRTY_REPORT_PATH)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validatePrior = ajv.compile(priorSchema);
  const validateReport = ajv.compile(reportSchema);
  assert.equal(validatePrior(prior), true, JSON.stringify(validatePrior.errors, null, 2));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2));
  await validateFrozenPrior(prior);
  await validateDirtyReport(report);

  assert.equal(prior.corpus.formal_cases_passed, 5);
  assert.equal(prior.aggregate_metrics.tasks_passed, 17);
  assert.equal(prior.acceptance.release_acceptance, false);
  assert.deepEqual(report.runtime_attestation, prior.runtime);

  const priorSummaries = prior.case_summaries.map((entry) => structuredClone(entry));
  const dirtySummary = {
    case_id: 'imported-dirty-topology',
    tasks_total: 3,
    tasks_passed: 3,
    duration_ms: report.result.duration_ms,
    geometry_mutation_executed: true,
    save_reopen_exact: true,
    wrong_object_modification_count: 0,
    silent_geometry_corruption_count: 0,
    queue_clean: true
  };
  const caseSummaries = [...priorSummaries, dirtySummary]
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
  const passedCaseIds = caseSummaries.map((entry) => entry.case_id);
  assert.deepEqual(passedCaseIds, [
    'appearance-scenes-hidden',
    'architecture-golden',
    'deep-shared-components',
    'imported-dirty-topology',
    'interior-expression',
    'scaled-mirrored-locked'
  ]);

  const manifest = await readJson(prior.corpus.manifest_path);
  assert.equal(`sha256:${await sha256File(prior.corpus.manifest_path)}`, prior.corpus.manifest_sha256);
  const remainingCaseIds = manifest.cases
    .map((entry) => entry.id)
    .filter((caseId) => !passedCaseIds.includes(caseId));
  assert.deepEqual(remainingCaseIds, ['product-boolean-manifold']);

  const tasksTotal = caseSummaries.reduce((sum, entry) => sum + entry.tasks_total, 0);
  const tasksPassed = caseSummaries.reduce((sum, entry) => sum + entry.tasks_passed, 0);
  assert.equal(tasksTotal, 20);
  assert.equal(tasksPassed, 20);

  const detectionTask = taskEvidence(report, 'abnormal_topology_detection');
  const repairTask = taskEvidence(report, 'manifold_repair');
  const recoveryTask = taskEvidence(report, 'recovery');
  const identity = report.result.details.case_save_reopen_identity;
  assert.equal(detectionTask.detected, true);
  assert.equal(detectionTask.initial_manifold, false);
  assert(detectionTask.expected_issue_codes.includes('boundary_edges'));
  assert.equal(repairTask.before.is_manifold, false);
  assert.equal(repairTask.after.is_manifold, true);
  assert.equal(repairTask.final_manifold, true);
  assert.equal(recoveryTask.exact_target_changed, true);
  assert.equal(recoveryTask.non_target_top_level_entities_unchanged, true);
  assert.equal(identity.exact_match, true);
  assert.equal(identity.model_revision_exact_match, true);

  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));
  const evidence = {
    version: 'current-source-real-model-reliability-live-evidence.v5',
    kind: 'current_source_real_model_reliability_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'partial_pass',
    evidence_scope: 'six_hash_bound_real_model_cases_with_two_guarded_geometry_mutations_and_controlled_overlay_boundaries',
    runtime: prior.runtime,
    execution_authorization: prior.execution_authorization,
    lineage: {
      prior_five_case_evidence: await artifactDescriptor(PRIOR_EVIDENCE_PATH),
      dirty_topology_case_report: await artifactDescriptor(DIRTY_REPORT_PATH)
    },
    corpus: {
      manifest_path: prior.corpus.manifest_path,
      manifest_sha256: prior.corpus.manifest_sha256,
      formal_cases_total: 7,
      formal_cases_passed: 6,
      formal_corpus_complete: false,
      passed_case_ids: passedCaseIds,
      remaining_case_ids: remainingCaseIds
    },
    case_summaries: caseSummaries,
    aggregate_metrics: {
      tasks_total: 20,
      tasks_passed: 20,
      task_success_rate: 1,
      geometry_mutation_cases_passed: 2,
      controlled_fixture_overlay_cases_passed: 4,
      wrong_object_modification_count: 0,
      silent_geometry_corruption_count: 0,
      recovery_attempts: prior.aggregate_metrics.recovery_attempts + report.metrics.recovery_attempts,
      recoveries: prior.aggregate_metrics.recoveries + report.metrics.recoveries,
      recovery_rate: 1,
      aggregate_duration_ms: caseSummaries.reduce((sum, entry) => sum + entry.duration_ms, 0),
      queue_clean_after_each_case: true
    },
    performance_boundary: prior.performance_boundary,
    locked_target_guard: prior.locked_target_guard,
    appearance_preservation: prior.appearance_preservation,
    architecture_preservation: prior.architecture_preservation,
    dirty_topology_recovery: {
      case_id: 'imported-dirty-topology',
      derivation_class: 'controlled_loose_edge_overlay_on_user_authorized_imported_model_copy',
      controlled_overlay_target_only: true,
      imported_context_retained: true,
      arbitrary_imported_cad_repair_proven: false,
      formal_case_geometry_mutation_executed: true,
      abnormal_topology_detected: true,
      expected_issue_codes: detectionTask.expected_issue_codes,
      repair_strategy: repairTask.strategy,
      before: repairTask.before,
      after: repairTask.after,
      exact_target_changed: recoveryTask.exact_target_changed,
      non_target_top_level_entities_unchanged: recoveryTask.non_target_top_level_entities_unchanged,
      source_artifact_bytes_unchanged: report.safety.original_bytes_unchanged,
      save_reopen_identity_exact: identity.exact_match,
      model_revision_exact_match: identity.model_revision_exact_match,
      recursive_entries_before: identity.entries_before,
      recursive_entries_after: identity.entries_after,
      recursive_total_before: identity.total_before,
      recursive_total_after: identity.total_after,
      recursive_payload_bounded: identity.recursive_truncated_before && identity.recursive_truncated_after,
      queue_clean: queueIsClean(report.queue_clean),
      source_sha256: report.artifacts.source_sha256,
      verified_model_sha256: report.artifacts.verified_model_sha256,
      verified_model_bytes: report.artifacts.verified_model_bytes
    },
    source_sha256: sourceSha256,
    acceptance: {
      six_case_live_reliability: true,
      full_recursive_save_reopen: true,
      bounded_large_model_save_reopen: true,
      shared_definition_scope: true,
      material_and_scene_preservation: true,
      appearance_uv_hidden_preservation: true,
      architecture_case: true,
      mutation_cases_passed: 2,
      locked_transform_rollback: true,
      native_lock_guard_enforced: true,
      boolean_manifold: false,
      dirty_topology_recovery: true,
      arbitrary_imported_cad_repair: false,
      formal_corpus_cases_passed: 6,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      agent_gateway_default_profile_qualified: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This v5 wrapper preserves the immutable five-case v4 evidence and adds one separately hash-bound current-source dirty-topology live report.',
      'The six formal cases total 20 of 20 named tasks with zero wrong-object modifications and zero silent geometry corruption.',
      'The dirty-topology case used an isolated controlled loose-edge overlay on a user-authorized imported-model copy; it does not prove arbitrary imported CAD repair.',
      'The formal repair changed only the exact persistent target, removed its boundary-edge defect, and left all non-target top-level entities unchanged.',
      'The repaired target stayed manifold after save and reopen, with an exact definition-merkle revision match and a stable bounded 100,000-entry occurrence sample.',
      'The source artifact remained byte-exact; only the verified disposable result has a different content hash.',
      'The interior and dirty-topology stress runs exceed the 120-second ordinary-Agent interactive budget, so this corpus is not a default projection contract.',
      'Product Boolean/manifold, independent real Agent runs, and cross-version evidence remain open.',
      'This is 6 of 7 partial engineering evidence only. It is not release acceptance and cannot grant execution authority to an Agent.'
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

async function validateFrozenPrior(evidence) {
  assert.equal(evidence.version, 'current-source-real-model-reliability-live-evidence.v4');
  assert.equal(evidence.acceptance.release_acceptance, false);
  for (const descriptor of Object.values(evidence.lineage)) await assertDescriptor(descriptor);
}

async function validateDirtyReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'queue');
  assert.equal(report.selected_case.case_id, 'imported-dirty-topology');
  assert.equal(report.metrics.tasks_total, 3);
  assert.equal(report.metrics.tasks_passed, 3);
  assert.equal(report.metrics.task_success_rate, 1);
  assert.equal(report.metrics.wrong_object_modification_count, 0);
  assert.equal(report.metrics.silent_geometry_corruption_count, 0);
  assert.equal(report.metrics.recovery_attempts, 1);
  assert.equal(report.metrics.recoveries, 1);
  assert.equal(report.metrics.recovery_rate, 1);
  assert.equal(report.safety.original_bytes_unchanged, true);
  assert.equal(report.safety.disposable_copy_only, true);
  assert.equal(queueIsClean(report.queue_clean), true);
  assert.equal(report.acceptance.selected_case_passed, true);
  assert.equal(report.acceptance.release_acceptance, false);
  assert.equal(report.result.details.source_kind, 'external_skp_hash_bound_sidecar');
  for (const task of report.result.tasks) assert.equal(task.status, 'passed');

  const sourceHash = `sha256:${await sha256File(report.artifacts.source_artifact)}`;
  const workingHash = `sha256:${await sha256File(report.artifacts.working_copy)}`;
  const verifiedHash = `sha256:${await sha256File(report.artifacts.verified_model)}`;
  const contractHash = `sha256:${await sha256File(report.artifacts.contract)}`;
  assert.equal(sourceHash, report.artifacts.source_sha256);
  assert.equal(workingHash, report.artifacts.working_copy_sha256);
  assert.equal(sourceHash, workingHash);
  assert.equal(verifiedHash, report.artifacts.verified_model_sha256);
  assert.equal(contractHash, report.artifacts.contract_sha256);
  assert.equal((await fs.stat(path.join(repoRoot, report.artifacts.verified_model))).size, report.artifacts.verified_model_bytes);
}

function taskEvidence(report, taskId) {
  const task = report.result.tasks.find((entry) => entry.task_id === taskId);
  assert(task, `missing ${taskId} task`);
  assert.equal(task.status, 'passed');
  return task.evidence;
}

function queueIsClean(queue) {
  return queue?.queue === 0
    && queue?.processing === 0
    && queue?.responses === 0
    && queue?.lock === false;
}

async function assertDescriptor(descriptor) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} hash mismatch`);
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes);
}

async function artifactDescriptor(relativePath) {
  const normalized = assertRepoRelativePath(relativePath);
  const stats = await fs.stat(path.join(repoRoot, normalized));
  assert.equal(stats.isFile(), true);
  return { path: normalized, sha256: await sha256File(normalized), bytes: stats.size };
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
    process.stdout.write('Usage: node scripts/aggregate-current-source-real-model-reliability-live-v5.mjs [--output <path>]\n');
  } else {
    aggregateCurrentSourceRealModelReliabilityLiveV5(options)
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
