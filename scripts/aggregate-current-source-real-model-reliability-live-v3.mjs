#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = 'docs/evidence/current-source-real-model-reliability-live-evidence-v3-2026-07-23.json';
const PRIOR_EVIDENCE_PATH = 'docs/evidence/current-source-real-model-reliability-live-evidence-v2-2026-07-23.json';
const APPEARANCE_EVIDENCE_PATH = 'docs/evidence/appearance-scenes-hidden-live-evidence-2026-07-23.json';
const APPEARANCE_REPORT_PATH = 'output/live-validation/real-model-reliability/appearance-scenes-hidden-current-source-v1/real-model-reliability-live-case-report.v1.json';

const SOURCE_PATHS = Object.freeze([
  'test/reliability-corpus/manifest.json',
  'scripts/aggregate-current-source-real-model-reliability-live-v3.mjs',
  'scripts/build-appearance-scenes-hidden-live-evidence.mjs',
  'scripts/run-real-model-reliability-harness.mjs',
  'scripts/run-real-model-reliability-live-case.mjs',
  'schema/current-source-real-model-reliability-live-evidence-v3.schema.json',
  'schema/appearance-scenes-hidden-live-evidence-v1.schema.json',
  'schema/real-model-reliability-live-case-report-v1.schema.json',
  'schema/real-model-reliability-live-case-v1.schema.json',
  'sketchup_plugin/alma_sketchup_mcp/appearance_operations.rb',
  'sketchup_plugin/alma_sketchup_mcp/model_revision.rb',
  'sketchup_plugin/alma_sketchup_mcp/runtime_source_manifest.rb',
  'sketchup_plugin/alma_sketchup_mcp/snapshot.rb'
]);

export async function aggregateCurrentSourceRealModelReliabilityLiveV3({
  outputPath = DEFAULT_OUTPUT,
  capturedAt = new Date().toISOString()
} = {}) {
  const [
    priorSchema,
    appearanceSchema,
    reportSchema,
    priorEvidence,
    appearanceEvidence,
    appearanceReport
  ] = await Promise.all([
    readJson('schema/current-source-real-model-reliability-live-evidence-v2.schema.json'),
    readJson('schema/appearance-scenes-hidden-live-evidence-v1.schema.json'),
    readJson('schema/real-model-reliability-live-case-report-v1.schema.json'),
    readJson(PRIOR_EVIDENCE_PATH),
    readJson(APPEARANCE_EVIDENCE_PATH),
    readJson(APPEARANCE_REPORT_PATH)
  ]);
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const validatePrior = ajv.compile(priorSchema);
  const validateAppearance = ajv.compile(appearanceSchema);
  const validateReport = ajv.compile(reportSchema);
  assert.equal(validatePrior(priorEvidence), true, JSON.stringify(validatePrior.errors, null, 2));
  assert.equal(validateAppearance(appearanceEvidence), true, JSON.stringify(validateAppearance.errors, null, 2));
  assert.equal(validateReport(appearanceReport), true, JSON.stringify(validateReport.errors, null, 2));
  await validateFrozenPriorEvidence(priorEvidence);
  await validateCurrentAppearanceEvidence(appearanceEvidence);
  validateAppearanceReport(appearanceReport);

  assert.equal(appearanceEvidence.case_id, 'appearance-scenes-hidden');
  assert.equal(appearanceEvidence.artifacts.success_report.path, APPEARANCE_REPORT_PATH);
  assert.equal(appearanceEvidence.artifacts.success_report.sha256, await sha256File(APPEARANCE_REPORT_PATH));
  assert.deepEqual(appearanceReport.runtime_attestation, priorEvidence.runtime);
  assert.equal(priorEvidence.corpus.formal_cases_passed, 3);
  assert.deepEqual(
    priorEvidence.corpus.passed_case_ids,
    ['deep-shared-components', 'interior-expression', 'scaled-mirrored-locked']
  );
  assert.equal(priorEvidence.acceptance.release_acceptance, false);

  const priorCases = priorEvidence.cases.map((entry) => ({
    ...structuredClone(entry),
    coverage: {
      ...structuredClone(entry.coverage),
      uv_preservation: false,
      hidden_visibility_preservation: false
    },
    appearance: null
  }));
  const appearanceCase = await summarizeAppearanceCase(appearanceReport, APPEARANCE_REPORT_PATH);
  const cases = [...priorCases, appearanceCase]
    .sort((left, right) => left.case_id.localeCompare(right.case_id));
  const passedCaseIds = cases.map((entry) => entry.case_id);
  assert.deepEqual(passedCaseIds, [
    'appearance-scenes-hidden',
    'deep-shared-components',
    'interior-expression',
    'scaled-mirrored-locked'
  ]);

  const manifest = await readJson(priorEvidence.corpus.manifest_path);
  assert.equal(`sha256:${await sha256File(priorEvidence.corpus.manifest_path)}`, priorEvidence.corpus.manifest_sha256);
  const remainingCaseIds = manifest.cases
    .map((entry) => entry.id)
    .filter((caseId) => !passedCaseIds.includes(caseId));
  assert.deepEqual(remainingCaseIds, [
    'architecture-golden',
    'product-boolean-manifold',
    'imported-dirty-topology'
  ]);

  const tasksTotal = cases.reduce((sum, entry) => sum + entry.tasks_total, 0);
  const tasksPassed = cases.reduce((sum, entry) => sum + entry.tasks_passed, 0);
  const aggregateDurationMs = cases.reduce((sum, entry) => sum + entry.duration_ms, 0);
  assert.equal(tasksTotal, 14);
  assert.equal(tasksPassed, 14);
  const sourceSha256 = Object.fromEntries(await Promise.all(
    SOURCE_PATHS.map(async (relativePath) => [relativePath, await sha256File(relativePath)])
  ));

  const evidence = {
    version: 'current-source-real-model-reliability-live-evidence.v3',
    kind: 'current_source_real_model_reliability_live_evidence',
    captured_at: capturedAt,
    branch: 'codex/agent-contract-v1',
    result: 'partial_pass',
    evidence_scope: 'four_hash_bound_real_model_cases_with_one_guarded_geometry_mutation_and_one_controlled_appearance_overlay',
    runtime: priorEvidence.runtime,
    execution_authorization: priorEvidence.execution_authorization,
    lineage: {
      prior_three_case_evidence: await artifactDescriptor(PRIOR_EVIDENCE_PATH),
      appearance_case_evidence: await artifactDescriptor(APPEARANCE_EVIDENCE_PATH)
    },
    corpus: {
      manifest_path: priorEvidence.corpus.manifest_path,
      manifest_sha256: priorEvidence.corpus.manifest_sha256,
      formal_cases_total: 7,
      formal_cases_passed: 4,
      formal_corpus_complete: false,
      passed_case_ids: passedCaseIds,
      remaining_case_ids: remainingCaseIds
    },
    cases,
    aggregate_metrics: {
      tasks_total: 14,
      tasks_passed: 14,
      task_success_rate: 1,
      geometry_mutation_cases_passed: 1,
      controlled_fixture_overlay_cases_passed: 2,
      wrong_object_modification_count: 0,
      silent_geometry_corruption_count: 0,
      recovery_attempts: 1,
      recoveries: 1,
      recovery_rate: 1,
      aggregate_duration_ms: aggregateDurationMs,
      queue_clean_after_each_case: true
    },
    performance_boundary: priorEvidence.performance_boundary,
    locked_target_guard: priorEvidence.locked_target_guard,
    appearance_preservation: {
      case_id: 'appearance-scenes-hidden',
      fixture_overlay_mutated_disposable_copy: true,
      formal_case_geometry_mutation_executed: false,
      face_uv_evidence_kind: 'face_uvs',
      face_uv_operation_applied_without_warning: true,
      face_uv_payload_persisted: true,
      textured_material_persisted: true,
      uv_material_signature_preserved: true,
      scene_visibility_signature_preserved: true,
      scenes: 1,
      hidden_entities: 1,
      recursive_entries: 5897,
      independent_uvhelper_coordinate_attestation: false,
      arbitrary_uv_editing_proven: false
    },
    source_sha256: sourceSha256,
    acceptance: {
      four_case_live_reliability: true,
      full_recursive_save_reopen: true,
      bounded_large_model_save_reopen: true,
      shared_definition_scope: true,
      material_and_scene_preservation: true,
      appearance_uv_hidden_preservation: true,
      mutation_cases_passed: 1,
      locked_transform_rollback: true,
      native_lock_guard_enforced: true,
      boolean_manifold: false,
      dirty_topology_recovery: false,
      architecture_case: false,
      formal_corpus_cases_passed: 4,
      formal_corpus_cases_total: 7,
      formal_corpus_complete: false,
      agent_gateway_default_profile_qualified: false,
      cross_version: 'deferred_by_user',
      release_acceptance: false
    },
    boundaries: [
      'This v3 wrapper preserves the immutable three-case evidence and adds one separately hash-bound appearance/scenes/hidden current-source live run.',
      'The four formal cases total 14 of 14 named tasks with zero wrong-object modifications and zero silent geometry corruption.',
      'The appearance fixture preparation mutated only a disposable real-model copy; the formal appearance case itself performed preservation and save/reopen verification without a geometry edit.',
      'FaceUV, textured material, one Scene, and one hidden top-level target persisted with stable signatures across save and reopen.',
      'The FaceUV evidence is structured payload and material-signature evidence, not independent UVHelper coordinate attestation or proof of arbitrary UV editing.',
      'The interior stress run remains outside the 120-second ordinary-Agent interactive budget, so this corpus is not a default projection contract.',
      'Architecture, Boolean/manifold, imported dirty-topology recovery, independent Agent runs, and cross-version evidence remain open.',
      'This is 4 of 7 partial engineering evidence only. It is not release acceptance and cannot grant execution authority to an Agent.'
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

async function validateFrozenPriorEvidence(evidence) {
  for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
    assert.match(expected, /^[0-9a-f]{64}$/, `${relativePath} has an invalid historical source hash`);
    assert.equal((await fs.stat(path.join(repoRoot, assertRepoRelativePath(relativePath)))).isFile(), true);
  }
  for (const descriptor of Object.values(evidence.lineage)) {
    await assertDescriptor(descriptor);
  }
  for (const corpusCase of evidence.cases) {
    for (const descriptor of Object.values(corpusCase.artifacts)) {
      await assertDescriptor(descriptor);
    }
  }
}

async function validateCurrentAppearanceEvidence(evidence) {
  for (const [relativePath, expected] of Object.entries(evidence.source_sha256)) {
    assert.equal(await sha256File(relativePath), expected, `${relativePath} drifted after appearance evidence capture`);
  }
  for (const descriptor of Object.values(evidence.artifacts)) {
    await assertDescriptor(descriptor);
  }
}

function validateAppearanceReport(report) {
  assert.equal(report.ok, true);
  assert.equal(report.runtime, 'queue');
  assert.equal(report.selected_case.case_id, 'appearance-scenes-hidden');
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
  for (const task of report.result.tasks) assert.equal(task.status, 'passed');
}

async function summarizeAppearanceCase(report, reportPath) {
  const taskMap = new Map(report.result.tasks.map((task) => [task.task_id, task]));
  const uv = taskMap.get('uv_material_preservation')?.evidence;
  const presentation = taskMap.get('scene_visibility_preservation')?.evidence;
  const identity = taskMap.get('save_reopen_identity')?.evidence;
  assert(uv && presentation && identity);
  assert.equal(uv.initial_signature, uv.pre_save_signature);
  assert.equal(uv.pre_save_signature, uv.post_reopen_signature);
  assert.equal(uv.preserved_across_save_reopen, true);
  assert.equal(presentation.scenes, 1);
  assert.equal(presentation.hidden_entities, 1);
  assert.equal(presentation.hash, presentation.pre_save_hash);
  assert.equal(presentation.pre_save_hash, presentation.post_reopen_hash);
  assert.equal(presentation.preserved_across_save_reopen, true);
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
  assert.equal(diagnostic.exact_identity, true);
  assert.equal(diagnostic.model_revision_exact_match, true);
  assert.equal(diagnostic.source_path_after_reopen_verified, true);
  assert.equal(diagnostic.runtime_compatibility_ok, true);
  assert.equal(diagnostic.snapshot_diff.summary.by_severity.error, 0);
  assert.equal(diagnostic.snapshot_diff.verdict, 'pass');
  assert.equal(diagnostic.identity_signature_before, identity.signature);
  assert.equal(diagnostic.identity_signature_after, identity.signature);

  return {
    case_id: 'appearance-scenes-hidden',
    domain: report.selected_case.domain,
    result: 'pass',
    duration_ms: report.result.duration_ms,
    tasks_total: 3,
    tasks_passed: 3,
    task_ids: report.result.tasks.map((task) => task.task_id),
    coverage: {
      full_recursive_identity: true,
      bounded_recursive_identity: false,
      shared_definition_scope: false,
      material_preservation: true,
      scene_visibility_preservation: true,
      save_reopen_identity: true,
      uv_preservation: true,
      hidden_visibility_preservation: true
    },
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
    },
    appearance: {
      face_uv_evidence_kind: 'face_uvs',
      uv_material_signature: uv.initial_signature,
      uv_material_signature_preserved: true,
      scene_visibility_signature: presentation.hash,
      scene_visibility_signature_preserved: true,
      scenes: 1,
      hidden_entities: 1
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

async function assertDescriptor(descriptor) {
  assert.equal(await sha256File(descriptor.path), descriptor.sha256, `${descriptor.path} hash mismatch`);
  assert.equal((await fs.stat(path.join(repoRoot, descriptor.path))).size, descriptor.bytes);
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
    process.stdout.write('Usage: node scripts/aggregate-current-source-real-model-reliability-live-v3.mjs [--output <path>]\n');
  } else {
    aggregateCurrentSourceRealModelReliabilityLiveV3(options)
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
