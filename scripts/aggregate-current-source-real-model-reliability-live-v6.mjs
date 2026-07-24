#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/current-source-real-model-reliability-live-evidence-v6-2026-07-23.json';
const PRIOR_EVIDENCE_PATH = 'docs/evidence/current-source-real-model-reliability-live-evidence-v5-2026-07-23.json';
const FIXTURE_REPORT_PATH = 'output/live-validation/real-model-reliability-preparation/product-boolean-manifold-derived-v1/run-20260723-product-boolean-v1/finalization-report.v1.json';
const PRODUCT_REPORT_PATH = 'output/live-validation/real-model-reliability/product-boolean-manifold-current-source-v1/real-model-reliability-live-case-report.v1.json';

const SOURCE_PATHS = Object.freeze([
  'test/reliability-corpus/manifest.json',
  'scripts/aggregate-current-source-real-model-reliability-live-v6.mjs',
  'scripts/prepare-product-boolean-manifold-live-fixture.mjs',
  'scripts/run-real-model-reliability-harness.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/current-source-real-model-reliability-live-evidence-v6.schema.json',
  'schema/controlled-product-boolean-live-fixture-v1.schema.json',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'src/bridge.mjs',
  'src/queue-runtime.mjs',
  'sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/runtime_source_manifest.rb'
]);

export async function aggregateCurrentSourceRealModelReliabilityLiveV6({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const [priorSchema, fixtureSchema, reportSchema, prior, fixture, report] = await Promise.all([
    readJson('schema/current-source-real-model-reliability-live-evidence-v5.schema.json'),
    readJson('schema/controlled-product-boolean-live-fixture-v1.schema.json'),
    readJson('schema/real-model-reliability-live-case-report-v1.schema.json'),
    readJson(PRIOR_EVIDENCE_PATH),
    readJson(FIXTURE_REPORT_PATH),
    readJson(PRODUCT_REPORT_PATH)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validatePrior = ajv.compile(priorSchema);
  const validateFixture = ajv.compile(fixtureSchema);
  const validateReport = ajv.compile(reportSchema);
  assert.equal(validatePrior(prior), true, JSON.stringify(validatePrior.errors, null, 2));
  assert.equal(validateFixture(fixture), true, JSON.stringify(validateFixture.errors, null, 2));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2));
  await validateFrozenPrior(prior);
  await validateProductFixture(fixture);
  await validateProductReport(report);

  assert.equal(prior.corpus.formal_cases_passed, 6);
  assert.equal(prior.aggregate_metrics.tasks_passed, 20);
  assert.equal(prior.acceptance.release_acceptance, false);
  assert.deepEqual(report.runtime_attestation, prior.runtime);
  assertRuntimeCompatible(fixture.runtime_attestation, prior.runtime);

  const priorSummaries = prior.case_summaries.map((entry) => structuredClone(entry));
  const productSummary = {
    case_id: 'product-boolean-manifold',
    tasks_total: 3,
    tasks_passed: 3,
    duration_ms: report.result.duration_ms,
    geometry_mutation_executed: true,
    save_reopen_exact: true,
    wrong_object_modification_count: 0,
    silent_geometry_corruption_count: 0,
    queue_clean: true
  };
  const caseSummaries = [...priorSummaries, productSummary]
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
  const passedCaseIds = caseSummaries.map((entry) => entry.case_id);
  assert.deepEqual(passedCaseIds, [
    'appearance-scenes-hidden',
    'architecture-golden',
    'deep-shared-components',
    'imported-dirty-topology',
    'interior-expression',
    'product-boolean-manifold',
    'scaled-mirrored-locked'
  ]);

  const manifest = await readJson(prior.corpus.manifest_path);
  assert.equal(`sha256:${await sha256File(prior.corpus.manifest_path)}`, prior.corpus.manifest_sha256);
  const remainingCaseIds = manifest.cases
    .map((entry) => entry.id)
    .filter((caseId) => !passedCaseIds.includes(caseId));
  assert.deepEqual(remainingCaseIds, []);

  const tasksTotal = caseSummaries.reduce((sum, entry) => sum + entry.tasks_total, 0);
  const tasksPassed = caseSummaries.reduce((sum, entry) => sum + entry.tasks_passed, 0);
  assert.equal(tasksTotal, 23);
  assert.equal(tasksPassed, 23);

  const booleanTask = taskEvidence(report, 'boolean_manifold');
  const materialTask = taskEvidence(report, 'material_preservation');
  const identityTask = taskEvidence(report, 'save_reopen_identity');
  assert.equal(booleanTask.operation, 'boolean_difference');
  assert.equal(booleanTask.manifold, true);
  assert.equal(booleanTask.material_preserved, true);
  assert.equal(booleanTask.exact_target_replaced, true);
  assert.equal(booleanTask.tool_preserved_unchanged, true);
  assert.equal(booleanTask.non_input_top_level_entities_unchanged, true);
  assert.equal(materialTask.preserved_across_save_reopen, true);
  assert.equal(identityTask.exact_match, true);
  assert.equal(identityTask.model_revision_exact_match, true);
  assert.equal(identityTask.recursive_truncated_before, false);
  assert.equal(identityTask.recursive_truncated_after, false);

  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));
  const evidence = {
    version: 'current-source-real-model-reliability-live-evidence.v6',
    kind: 'current_source_real_model_reliability_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'pass',
    evidence_scope: 'seven_hash_bound_real_model_cases_with_three_guarded_geometry_mutations_and_controlled_overlay_boundaries',
    runtime: prior.runtime,
    execution_authorization: prior.execution_authorization,
    lineage: {
      prior_six_case_evidence: await artifactDescriptor(PRIOR_EVIDENCE_PATH),
      product_boolean_fixture_report: await artifactDescriptor(FIXTURE_REPORT_PATH),
      product_boolean_case_report: await artifactDescriptor(PRODUCT_REPORT_PATH)
    },
    corpus: {
      manifest_path: prior.corpus.manifest_path,
      manifest_sha256: prior.corpus.manifest_sha256,
      formal_cases_total: 7,
      formal_cases_passed: 7,
      formal_corpus_complete: true,
      passed_case_ids: passedCaseIds,
      remaining_case_ids: remainingCaseIds
    },
    case_summaries: caseSummaries,
    aggregate_metrics: {
      tasks_total: 23,
      tasks_passed: 23,
      task_success_rate: 1,
      geometry_mutation_cases_passed: 3,
      controlled_fixture_overlay_cases_passed: 5,
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
    dirty_topology_recovery: prior.dirty_topology_recovery,
    product_boolean_reliability: {
      case_id: 'product-boolean-manifold',
      derivation_class: fixture.derivation_class,
      controlled_overlay_inputs_only: true,
      product_context_retained: fixture.overlay.product_context_retained,
      original_top_level_entities_preserved_during_fixture_creation: fixture.overlay.original_top_level_entities_preserved,
      isolated_from_source: fixture.overlay.isolated_from_source,
      positive_3d_overlap: fixture.overlay.positive_3d_overlap,
      through_cut: fixture.overlay.through_cut,
      target_initial_manifold: fixture.target.initial_manifold_report.is_manifold,
      tool_initial_manifold: fixture.tool.initial_manifold_report.is_manifold,
      input_pair_manifold_after_fixture_reopen: fixture.target.reopened_manifold_report.is_manifold
        && fixture.tool.reopened_manifold_report.is_manifold,
      formal_case_geometry_mutation_executed: true,
      operation: booleanTask.operation,
      result_persistent_id: booleanTask.result_persistent_id,
      result_manifold: booleanTask.manifold,
      exact_target_replaced: booleanTask.exact_target_replaced,
      tool_preserved_unchanged: booleanTask.tool_preserved_unchanged,
      non_input_top_level_entities_unchanged: booleanTask.non_input_top_level_entities_unchanged,
      target_material_preserved: booleanTask.material_preserved,
      material_preserved_across_save_reopen: materialTask.preserved_across_save_reopen,
      source_artifact_bytes_unchanged: report.safety.original_bytes_unchanged,
      save_reopen_identity_exact: identityTask.exact_match,
      model_revision_exact_match: identityTask.model_revision_exact_match,
      recursive_entries_before: identityTask.entries_before,
      recursive_entries_after: identityTask.entries_after,
      recursive_total_before: identityTask.total_before,
      recursive_total_after: identityTask.total_after,
      full_recursive_payload: !identityTask.recursive_truncated_before && !identityTask.recursive_truncated_after,
      queue_clean: queueIsClean(report.queue_clean),
      source_sha256: report.artifacts.source_sha256,
      verified_model_sha256: report.artifacts.verified_model_sha256,
      verified_model_bytes: report.artifacts.verified_model_bytes
    },
    source_sha256: sourceSha256,
    acceptance: {
      seven_case_live_reliability: true,
      full_recursive_save_reopen: true,
      bounded_large_model_save_reopen: true,
      shared_definition_scope: true,
      material_and_scene_preservation: true,
      appearance_uv_hidden_preservation: true,
      architecture_case: true,
      mutation_cases_passed: 3,
      locked_transform_rollback: true,
      native_lock_guard_enforced: true,
      boolean_manifold: true,
      boolean_target_isolation: true,
      dirty_topology_recovery: true,
      arbitrary_imported_cad_repair: false,
      formal_corpus_cases_passed: 7,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: true,
      agent_gateway_default_profile_qualified: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This v6 wrapper preserves the immutable six-case v5 evidence and adds separately hash-bound product-fixture and formal Boolean reports.',
      'All seven formal cases total 23 of 23 named tasks with zero wrong-object modifications and zero silent geometry corruption.',
      'The product case uses an isolated controlled box-and-cylinder overlay on a byte-preserved Trimble S6 copy; it does not claim arbitrary product Boolean reliability.',
      'Both Boolean inputs were manifold before execution and remained manifold after fixture save and reopen.',
      'The formal difference replaced only the exact persistent target, preserved the tool and every non-input top-level entity, and produced a manifold result.',
      'The target material survived the Boolean operation and the complete save/reopen identity check.',
      'The source artifact remained byte-exact; only the verified disposable result has a different content hash.',
      'The interior and dirty-topology stress runs exceed the 120-second ordinary-Agent interactive budget, so this corpus is not a default projection contract.',
      'Arbitrary imported CAD repair, independent real Agent runs, and cross-version evidence remain open.',
      'This is complete P4 corpus-category engineering evidence only. It is not release acceptance and cannot grant execution authority to an Agent.'
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
  assert.equal(evidence.version, 'current-source-real-model-reliability-live-evidence.v5');
  assert.equal(evidence.corpus.formal_cases_passed, 6);
  assert.equal(evidence.acceptance.release_acceptance, false);
  for (const descriptor of Object.values(evidence.lineage)) await assertDescriptor(descriptor);
}

async function validateProductFixture(fixture) {
  assert.equal(fixture.status, 'ready_for_formal_live_case');
  assert.equal(fixture.source.original_bytes_unchanged, true);
  assert.equal(fixture.overlay.geometry_mutation_performed, true);
  assert.equal(fixture.overlay.product_context_retained, true);
  assert.equal(fixture.overlay.original_top_level_entities_preserved, true);
  assert.equal(fixture.overlay.isolated_from_source, true);
  assert.equal(fixture.overlay.positive_3d_overlap, true);
  assert.equal(fixture.overlay.through_cut, true);
  assert.equal(fixture.target.initial_manifold_report.is_manifold, true);
  assert.equal(fixture.target.reopened_manifold_report.is_manifold, true);
  assert.equal(fixture.tool.initial_manifold_report.is_manifold, true);
  assert.equal(fixture.tool.reopened_manifold_report.is_manifold, true);
  assert.equal(fixture.identity.model_revision_complete, true);
  assert.equal(fixture.identity.recursive_truncated, false);
  assert.equal(queueIsClean(fixture.queue_clean), true);
  assert.equal(fixture.release_acceptance, false);
}

async function validateProductReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'queue');
  assert.equal(report.selected_case.case_id, 'product-boolean-manifold');
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

function assertRuntimeCompatible(fixtureRuntime, fullRuntime) {
  for (const key of [
    'name',
    'server_version',
    'plugin_version',
    'sketchup_version',
    'capability_version',
    'manifest_version',
    'revision_strategy',
    'revision_source_sha256',
    'compatibility_ok'
  ]) {
    assert.deepEqual(fixtureRuntime[key], fullRuntime[key], `fixture runtime mismatch: ${key}`);
  }
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
    process.stdout.write('Usage: node scripts/aggregate-current-source-real-model-reliability-live-v6.mjs [--output <path>]\n');
  } else {
    aggregateCurrentSourceRealModelReliabilityLiveV6(options)
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
