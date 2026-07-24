#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/current-source-real-model-reliability-live-evidence-v4-2026-07-23.json';
const PRIOR_EVIDENCE_PATH = 'docs/evidence/current-source-real-model-reliability-live-evidence-v3-2026-07-23.json';
const ARCHITECTURE_EVIDENCE_PATH = 'docs/evidence/architecture-golden-live-evidence-2026-07-23.json';
const ARCHITECTURE_REPORT_PATH = 'output/live-validation/real-model-reliability/architecture-golden-current-source-v1/real-model-reliability-live-case-report.v1.json';

const SOURCE_PATHS = Object.freeze([
  'test/reliability-corpus/manifest.json',
  'scripts/aggregate-current-source-real-model-reliability-live-v4.mjs',
  'scripts/build-architecture-golden-live-evidence.mjs',
  'scripts/run-real-model-reliability-harness.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/current-source-real-model-reliability-live-evidence-v4.schema.json',
  'schema/architecture-golden-live-evidence-v1.schema.json',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'sketchup_plugin/alma_sketchup_mcp/materials.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/runtime_source_manifest.rb',
  'sketchup_plugin/alma_sketchup_mcp/view_operations.rb'
]);

export async function aggregateCurrentSourceRealModelReliabilityLiveV4({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const [priorSchema, architectureSchema, reportSchema, prior, architecture, report] = await Promise.all([
    readJson('schema/current-source-real-model-reliability-live-evidence-v3.schema.json'),
    readJson('schema/architecture-golden-live-evidence-v1.schema.json'),
    readJson('schema/real-model-reliability-live-case-report-v1.schema.json'),
    readJson(PRIOR_EVIDENCE_PATH),
    readJson(ARCHITECTURE_EVIDENCE_PATH),
    readJson(ARCHITECTURE_REPORT_PATH)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validatePrior = ajv.compile(priorSchema);
  const validateArchitecture = ajv.compile(architectureSchema);
  const validateReport = ajv.compile(reportSchema);
  assert.equal(validatePrior(prior), true, JSON.stringify(validatePrior.errors, null, 2));
  assert.equal(validateArchitecture(architecture), true, JSON.stringify(validateArchitecture.errors, null, 2));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors, null, 2));
  await validateFrozenPrior(prior);
  await validateCurrentArchitecture(architecture);
  validateArchitectureReport(report);

  assert.equal(architecture.case_id, 'architecture-golden');
  assert.equal(architecture.artifacts.success_report.path, ARCHITECTURE_REPORT_PATH);
  assert.equal(architecture.artifacts.success_report.sha256, await sha256File(ARCHITECTURE_REPORT_PATH));
  assert.deepEqual(report.runtime_attestation, prior.runtime);
  assert.equal(prior.corpus.formal_cases_passed, 4);
  assert.equal(prior.aggregate_metrics.tasks_passed, 14);
  assert.equal(prior.acceptance.release_acceptance, false);

  const priorSummaries = prior.cases.map((entry) => ({
    case_id: entry.case_id,
    tasks_total: entry.tasks_total,
    tasks_passed: entry.tasks_passed,
    duration_ms: entry.duration_ms,
    geometry_mutation_executed: entry.mutation.geometry_mutation_executed,
    save_reopen_exact: entry.identity.exact_match,
    wrong_object_modification_count: entry.quality.wrong_object_modification_count,
    silent_geometry_corruption_count: entry.quality.silent_geometry_corruption_count,
    queue_clean: queueIsClean(entry.quality.queue_clean)
  }));
  const architectureSummary = {
    case_id: 'architecture-golden',
    tasks_total: 3,
    tasks_passed: 3,
    duration_ms: report.result.duration_ms,
    geometry_mutation_executed: false,
    save_reopen_exact: true,
    wrong_object_modification_count: 0,
    silent_geometry_corruption_count: 0,
    queue_clean: true
  };
  const caseSummaries = [...priorSummaries, architectureSummary]
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
  const passedCaseIds = caseSummaries.map((entry) => entry.case_id);
  assert.deepEqual(passedCaseIds, [
    'appearance-scenes-hidden',
    'architecture-golden',
    'deep-shared-components',
    'interior-expression',
    'scaled-mirrored-locked'
  ]);

  const manifest = await readJson(prior.corpus.manifest_path);
  assert.equal(`sha256:${await sha256File(prior.corpus.manifest_path)}`, prior.corpus.manifest_sha256);
  const remainingCaseIds = manifest.cases
    .map((entry) => entry.id)
    .filter((caseId) => !passedCaseIds.includes(caseId));
  assert.deepEqual(remainingCaseIds, ['product-boolean-manifold', 'imported-dirty-topology']);
  const tasksTotal = caseSummaries.reduce((sum, entry) => sum + entry.tasks_total, 0);
  const tasksPassed = caseSummaries.reduce((sum, entry) => sum + entry.tasks_passed, 0);
  assert.equal(tasksTotal, 17);
  assert.equal(tasksPassed, 17);

  const materialTask = report.result.tasks.find((task) => task.task_id === 'material_preservation')?.evidence;
  const presentationTask = report.result.tasks.find((task) => task.task_id === 'scene_visibility_preservation')?.evidence;
  const identityTask = report.result.tasks.find((task) => task.task_id === 'save_reopen_identity')?.evidence;
  assert(materialTask && presentationTask && identityTask);
  assert.equal(materialTask.initial_signature, materialTask.post_reopen_signature);
  assert.equal(presentationTask.hash, presentationTask.post_reopen_hash);
  assert.equal(identityTask.entries_before, 5859);
  assert.equal(identityTask.entries_after, 5859);

  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));
  const evidence = {
    version: 'current-source-real-model-reliability-live-evidence.v4',
    kind: 'current_source_real_model_reliability_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'partial_pass',
    evidence_scope: 'five_hash_bound_real_model_cases_with_one_guarded_geometry_mutation_and_controlled_metadata_or_geometry_overlays',
    runtime: prior.runtime,
    execution_authorization: prior.execution_authorization,
    lineage: {
      prior_four_case_evidence: await artifactDescriptor(PRIOR_EVIDENCE_PATH),
      architecture_case_evidence: await artifactDescriptor(ARCHITECTURE_EVIDENCE_PATH)
    },
    corpus: {
      manifest_path: prior.corpus.manifest_path,
      manifest_sha256: prior.corpus.manifest_sha256,
      formal_cases_total: 7,
      formal_cases_passed: 5,
      formal_corpus_complete: false,
      passed_case_ids: passedCaseIds,
      remaining_case_ids: remainingCaseIds
    },
    case_summaries: caseSummaries,
    aggregate_metrics: {
      tasks_total: 17,
      tasks_passed: 17,
      task_success_rate: 1,
      geometry_mutation_cases_passed: 1,
      controlled_fixture_overlay_cases_passed: 3,
      wrong_object_modification_count: 0,
      silent_geometry_corruption_count: 0,
      recovery_attempts: 1,
      recoveries: 1,
      recovery_rate: 1,
      aggregate_duration_ms: caseSummaries.reduce((sum, entry) => sum + entry.duration_ms, 0),
      queue_clean_after_each_case: true
    },
    performance_boundary: prior.performance_boundary,
    locked_target_guard: prior.locked_target_guard,
    appearance_preservation: prior.appearance_preservation,
    architecture_preservation: {
      case_id: 'architecture-golden',
      fixture_overlay_mutated_disposable_copy_metadata: true,
      fixture_overlay_geometry_mutation_performed: false,
      formal_case_geometry_mutation_executed: false,
      material_signature: materialTask.initial_signature,
      material_signature_preserved: true,
      scene_visibility_signature: presentationTask.hash,
      scene_visibility_signature_preserved: true,
      scenes: 1,
      hidden_top_level_entities: 0,
      recursive_entries: 5859,
      model_revision_exact_match: true,
      nested_hidden_occurrence_attestation: false
    },
    source_sha256: sourceSha256,
    acceptance: {
      five_case_live_reliability: true,
      full_recursive_save_reopen: true,
      bounded_large_model_save_reopen: true,
      shared_definition_scope: true,
      material_and_scene_preservation: true,
      appearance_uv_hidden_preservation: true,
      architecture_case: true,
      mutation_cases_passed: 1,
      locked_transform_rollback: true,
      native_lock_guard_enforced: true,
      boolean_manifold: false,
      dirty_topology_recovery: false,
      formal_corpus_cases_passed: 5,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      agent_gateway_default_profile_qualified: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This v4 wrapper preserves the immutable four-case evidence and adds one separately hash-bound architecture current-source live run.',
      'The five formal cases total 17 of 17 named tasks with zero wrong-object modifications and zero silent geometry corruption.',
      'The architecture fixture added only a material catalog entry and one Scene to a disposable copy; it did not add, delete, or transform geometry.',
      'The architecture run retained stable material and top-level Scene/visibility signatures plus exact 5,859-entry identity across save and reopen.',
      'Nested hidden occurrences were not independently attested by the architecture presentation signature, and no geometry mutation was executed in its formal case.',
      'The interior stress run remains outside the 120-second ordinary-Agent interactive budget, so this corpus is not a default projection contract.',
      'Product Boolean/manifold, imported dirty-topology recovery, independent Agent runs, and cross-version evidence remain open.',
      'This is 5 of 7 partial engineering evidence only. It is not release acceptance and cannot grant execution authority to an Agent.'
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
  for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
    assert.match(expected, /^[0-9a-f]{64}$/, `${relativePath} has an invalid historical source hash`);
    assert.equal((await fs.stat(path.join(repoRoot, assertRepoRelativePath(relativePath)))).isFile(), true);
  }
  for (const descriptor of Object.values(evidence.lineage)) await assertDescriptor(descriptor);
  for (const corpusCase of evidence.cases) {
    for (const descriptor of Object.values(corpusCase.artifacts)) await assertDescriptor(descriptor);
  }
}

async function validateCurrentArchitecture(evidence) {
  for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
    assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after architecture evidence capture`);
  }
  for (const descriptor of Object.values(evidence.artifacts)) await assertDescriptor(descriptor);
}

function validateArchitectureReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'queue');
  assert.equal(report.selected_case.case_id, 'architecture-golden');
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
  for (const task of report.result.tasks) assert.equal(task.status, 'passed');
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
    process.stdout.write('Usage: node scripts/aggregate-current-source-real-model-reliability-live-v4.mjs [--output <path>]\n');
  } else {
    aggregateCurrentSourceRealModelReliabilityLiveV4(options)
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
