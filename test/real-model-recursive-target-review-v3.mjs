import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  REAL_MODEL_RECURSIVE_TARGET_REVIEW_V3_VERSION,
  deriveRealModelRecursiveTargetReview,
  deriveRealModelRecursiveTargetReviewV3,
  runRealModelRecursiveTargetReviewV3,
  validateRealModelRecursiveTargetReviewV3
} from '../src/real-model-recursive-target-review.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(repoRoot, 'test/fixtures/real-model-recursive-target-review-v3.json');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const [v2Schema, v3Schema] = await Promise.all([
  fs.readFile(path.join(repoRoot, 'schema/real-model-recursive-target-review-v2.schema.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(repoRoot, 'schema/real-model-recursive-target-review-v3.schema.json'), 'utf8').then(JSON.parse)
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema(v2Schema);
const validateV3 = ajv.compile(v3Schema);
const validateV2 = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(v2Schema);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-recursive-review-v3-'));
const workspaceTempRoot = await fs.mkdtemp(path.join(repoRoot, 'test/.tmp-recursive-review-v3-'));
const fixedNow = () => new Date('2026-07-21T08:00:00.000Z');
let assertions = 0;

try {
  assert.equal(fixture.version, 'real-model-recursive-target-review-v3-fixture.v1'); assertions += 1;
  assert.equal(fixture.policy.portable, true); assertions += 1;
  assert.equal(fixture.policy.live_queue_called, false); assertions += 1;
  assert.equal(fixture.policy.release_acceptance, false); assertions += 1;
  const publicEvidenceBytes = await fs.readFile(path.join(
    repoRoot,
    fixture.negative_atomic_trial_lineage.source_evidence.path
  ));
  assert.equal(
    `sha256:${crypto.createHash('sha256').update(publicEvidenceBytes).digest('hex')}`,
    fixture.negative_atomic_trial_lineage.source_evidence.sha256
  ); assertions += 1;
  const publicEvidence = JSON.parse(publicEvidenceBytes.toString('utf8'));
  assert.equal(
    publicEvidence.runtime_contract.boolean_operations_sha256,
    fixture.context.v8_loaded_runtime_source_hashes.boolean_operations_sha256
  ); assertions += 1;
  assert.equal(
    publicEvidence.runtime_contract.model_revision_source_sha256,
    fixture.context.v8_loaded_runtime_source_hashes.model_revision_source_sha256
  ); assertions += 1;
  assert.equal(publicEvidence.runtime_contract.historical_exact_loaded_runtime, true); assertions += 1;

  const v2 = deriveRealModelRecursiveTargetReview(fixture.adoption, {
    sourceSha256: fixture.context.source_sha256,
    modelRevision: fixture.context.model_revision,
    now: fixedNow
  });
  assert.equal(validateV2(v2), true, JSON.stringify(validateV2.errors)); assertions += 1;
  assert.equal(v2.version, 'real-model-recursive-target-review.v2'); assertions += 1;
  assert.equal(v2.review.status, 'server_recommended'); assertions += 1;
  assert.equal(v2.review.recommended_proposal.target.occurrence_path, 'pid:11543'); assertions += 1;
  assert.equal(v2.review.recommended_proposal.tool.occurrence_path, 'pid:11635'); assertions += 1;

  const exactRuntime = reviewV3(fixture.context.v8_loaded_runtime_source_hashes);
  assert.equal(validateV3(exactRuntime), true, JSON.stringify(validateV3.errors)); assertions += 1;
  await validateRealModelRecursiveTargetReviewV3(exactRuntime); assertions += 1;
  assert.equal(exactRuntime.version, REAL_MODEL_RECURSIVE_TARGET_REVIEW_V3_VERSION); assertions += 1;
  assert.equal(exactRuntime.base_review.version, 'real-model-recursive-target-review.v2'); assertions += 1;
  assert.equal(exactRuntime.runtime, 'offline'); assertions += 1;
  assert.equal(exactRuntime.live_queue_called, false); assertions += 1;
  assert.equal(exactRuntime.safety.queue_accessed, false); assertions += 1;
  assert.equal(exactRuntime.safety.model_mutation_authorized, false); assertions += 1;
  assert.equal(exactRuntime.safety.release_acceptance, false); assertions += 1;
  assert.equal(exactRuntime.negative_atomic_trial_lineage.status, 'exact_runtime_match'); assertions += 1;
  assert.equal(exactRuntime.negative_atomic_trial_lineage.exact_runtime_match_count, 1); assertions += 1;
  assert.equal(exactRuntime.negative_atomic_trial_lineage.runtime_delta_count, 0); assertions += 1;
  assert.equal(exactRuntime.negative_atomic_trial_lineage.trials[0].failed_plan_replay_allowed, false); assertions += 1;
  assert.equal(
    exactRuntime.negative_atomic_trial_lineage.trials[0].source_evidence.verification,
    'not_verified_pure_derivation'
  ); assertions += 1;
  assert.equal(
    exactRuntime.negative_atomic_trial_lineage.source_evidence_verification.status,
    'not_verified_pure_derivation'
  ); assertions += 1;
  assert.equal(exactRuntime.safety.negative_source_evidence_bytes_verified, false); assertions += 1;
  assert.equal(
    exactRuntime.negative_atomic_trial_lineage.trials[0].runtime_source_hashes.boolean_operations_sha256,
    'sha256:2e3d686ba926f8b43f5a9847e05471587a217b536fd901811f10444948c2c444'
  ); assertions += 1;

  const targetGeometry = geometry(exactRuntime, 'pid:11543');
  const failedToolGeometry = geometry(exactRuntime, 'pid:11635');
  const alternativeToolGeometry = geometry(exactRuntime, 'pid:11636');
  assert.equal(targetGeometry.exact_solid_volume, 61350393.972267); assertions += 1;
  assert.equal(failedToolGeometry.exact_solid_volume, 723623.440001); assertions += 1;
  assert.equal(alternativeToolGeometry.exact_solid_volume, 723623.440001); assertions += 1;
  assert.equal(targetGeometry.exact_solid_volume_provenance, 'fresh_manifold_structural_attestation'); assertions += 1;
  assertClose(targetGeometry.bbox_fill_ratio, 0.044513901024853184); assertions += 1;
  assertClose(failedToolGeometry.bbox_fill_ratio, 0.04248260985961457); assertions += 1;
  assertClose(alternativeToolGeometry.bbox_fill_ratio, 0.015871273864181898); assertions += 1;
  assert.equal(targetGeometry.bbox_fill_ratio_semantics, 'sparsity_hint_only_not_exact_overlap'); assertions += 1;
  assert.equal(targetGeometry.exact_overlap_proof, false); assertions += 1;

  const failedPair = decision(exactRuntime, 'pid:11543', 'pid:11635');
  assert.equal(failedPair.base_rank, 1); assertions += 1;
  assert.equal(failedPair.negative_atomic_trial.status, 'negative_source_evidence_unverified'); assertions += 1;
  assert.equal(failedPair.negative_atomic_trial.runtime_exact_match, null); assertions += 1;
  assert.equal(failedPair.negative_atomic_trial.failed_plan_replay_allowed, false); assertions += 1;
  assert.equal(failedPair.atomic_boolean_trial_eligible, false); assertions += 1;
  assert.ok(failedPair.blockers.includes('negative_source_evidence_unverified')); assertions += 1;
  assert.equal(failedPair.exact_overlap_assessment.status, 'exact_overlap_unverified'); assertions += 1;
  assert.equal(failedPair.exact_overlap_assessment.evidence_requirement, 'verified_negative_source_evidence_required'); assertions += 1;

  const alternativePair = decision(exactRuntime, 'pid:11543', 'pid:11636');
  assert.equal(alternativePair.base_rank, 2); assertions += 1;
  assert.equal(alternativePair.bbox_relation, 'containment'); assertions += 1;
  assert.equal(alternativePair.fill_ratio_assessment.low_fill_ratio_observed, true); assertions += 1;
  assert.equal(alternativePair.fill_ratio_assessment.exact_overlap_proof, false); assertions += 1;
  assert.equal(alternativePair.exact_overlap_assessment.status, 'exact_overlap_unverified'); assertions += 1;
  assert.equal(alternativePair.exact_overlap_assessment.evidence_requirement, 'verified_negative_source_evidence_required'); assertions += 1;
  assert.equal(alternativePair.atomic_boolean_trial_eligible, false); assertions += 1;
  assert.ok(alternativePair.blockers.includes('stronger_exact_overlap_evidence_required')); assertions += 1;
  assert.equal(exactRuntime.review.status, 'blocked'); assertions += 1;
  assert.equal(exactRuntime.review.recommended_proposal, null); assertions += 1;
  assert.ok(exactRuntime.review.blockers.includes('negative_source_evidence_unverified')); assertions += 1;
  assert.ok(exactRuntime.review.blockers.includes('stronger_exact_overlap_evidence_required')); assertions += 1;
  assert.equal(exactRuntime.next_action.action, 'verify_negative_source_evidence_before_candidate_policy'); assertions += 1;

  const runtimeDrift = reviewV3(fixture.context.workspace_pending_runtime_source_hashes);
  assert.equal(validateV3(runtimeDrift), true, JSON.stringify(validateV3.errors)); assertions += 1;
  assert.equal(runtimeDrift.negative_atomic_trial_lineage.status, 'runtime_delta_requires_review'); assertions += 1;
  assert.equal(runtimeDrift.negative_atomic_trial_lineage.exact_runtime_match_count, 0); assertions += 1;
  assert.equal(runtimeDrift.negative_atomic_trial_lineage.runtime_delta_count, 1); assertions += 1;
  assert.equal(runtimeDrift.negative_atomic_trial_lineage.negative_trial_not_directly_reusable, true); assertions += 1;
  assert.deepEqual(
    runtimeDrift.negative_atomic_trial_lineage.trials[0].runtime_delta_fields,
    ['boolean_operations_sha256']
  ); assertions += 1;
  assert.equal(
    runtimeDrift.negative_atomic_trial_lineage.trials[0].runtime_source_hashes.boolean_operations_sha256,
    'sha256:2e3d686ba926f8b43f5a9847e05471587a217b536fd901811f10444948c2c444'
  ); assertions += 1;
  assert.equal(
    runtimeDrift.runtime_source_hashes.boolean_operations_sha256,
    'sha256:b98fd554894f629359651f40929cf30a7122ac90ba01217a662bea2f4c407610'
  ); assertions += 1;
  assert.equal(runtimeDrift.review.status, 'blocked'); assertions += 1;
  assert.equal(runtimeDrift.review.recommended_proposal, null); assertions += 1;
  assert.ok(runtimeDrift.review.blockers.includes('runtime_delta_requires_review')); assertions += 1;
  assert.equal(runtimeDrift.review.pair_decisions.every((entry) => entry.atomic_boolean_trial_eligible === false), true); assertions += 1;
  assert.equal(
    decision(runtimeDrift, 'pid:11543', 'pid:11635').negative_atomic_trial.status,
    'negative_source_evidence_unverified'
  ); assertions += 1;
  assert.equal(runtimeDrift.next_action.action, 'verify_negative_source_evidence_before_candidate_policy'); assertions += 1;
  assert.equal(runtimeDrift.next_action.runtime_delta_requires_review, true); assertions += 1;
  assert.equal(runtimeDrift.next_action.negative_trial_not_directly_reusable, true); assertions += 1;
  assert.equal(runtimeDrift.next_action.release_acceptance, false); assertions += 1;

  const dense = denseAdoption();
  const denseWithoutLineage = deriveRealModelRecursiveTargetReviewV3(dense, {
    ...v3Options(fixture.context.v8_loaded_runtime_source_hashes, fixture.negative_atomic_trial_lineage),
    negativeAtomicTrialLineages: []
  });
  assert.equal(denseWithoutLineage.review.status, 'server_recommended'); assertions += 1;
  assert.equal(denseWithoutLineage.review.recommended_proposal.base_pair_rank, 1); assertions += 1;
  assert.equal(denseWithoutLineage.review.recommended_proposal.tool_path, 'pid:11635'); assertions += 1;
  const forgedUnverifiedLineage = mutateLineage((value) => {
    value.source_evidence.sha256 = `sha256:${'0'.repeat(64)}`;
  });
  const denseWithForgedLineage = deriveRealModelRecursiveTargetReviewV3(dense, {
    ...v3Options(fixture.context.v8_loaded_runtime_source_hashes, forgedUnverifiedLineage)
  });
  assert.equal(denseWithForgedLineage.review.status, 'blocked'); assertions += 1;
  assert.equal(denseWithForgedLineage.review.recommended_proposal, null); assertions += 1;
  assert.ok(denseWithForgedLineage.review.blockers.includes('negative_source_evidence_unverified')); assertions += 1;
  assert.equal(decision(denseWithForgedLineage, 'pid:11543', 'pid:11636').atomic_boolean_trial_eligible, false); assertions += 1;
  assert.equal(denseWithForgedLineage.next_action.action,
    'verify_negative_source_evidence_before_candidate_policy'); assertions += 1;

  const strictNegativeCases = [
    mutateLineage((value) => { value.case_id = 'another_case'; }),
    mutateLineage((value) => { value.source_sha256 = `sha256:${'0'.repeat(64)}`; }),
    mutateLineage((value) => { value.model_revision = `sha256:${'0'.repeat(64)}`; }),
    mutateLineage((value) => { value.target_path = 'pid:99999'; }),
    mutateLineage((value) => { value.plan_hash = 'not-a-hash'; }),
    mutateLineage((value) => { value.runtime_source_hashes.boolean_operations_sha256 = 'not-a-hash'; }),
    mutateLineage((value) => { value.outcome.commit_state = 'committed'; }),
    mutateLineage((value) => { value.outcome.abort_succeeded = false; }),
    mutateLineage((value) => { value.outcome.outcome_unknown = true; }),
    mutateLineage((value) => { value.outcome.mutation_committed = true; }),
    mutateLineage((value) => { value.outcome.rollback_confirmed = false; }),
    mutateLineage((value) => { value.outcome.exact_solid_overlap_verified = true; }),
    mutateLineage((value) => { value.retry_policy.approval_reusable = true; }),
    mutateLineage((value) => { value.retry_policy.same_task_retry_allowed = true; }),
    mutateLineage((value) => { value.release_acceptance = true; })
  ];
  for (const invalidLineage of strictNegativeCases) {
    assert.throws(() => reviewV3(
      fixture.context.v8_loaded_runtime_source_hashes,
      invalidLineage
    )); assertions += 1;
  }

  const mismatchedReport = structuredClone(fixture.adoption);
  mismatchedReport.structural_groups.entries[0].manifold_attestation.report.model_revision = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => deriveRealModelRecursiveTargetReviewV3(mismatchedReport, v3Options(
    fixture.context.v8_loaded_runtime_source_hashes,
    fixture.negative_atomic_trial_lineage
  )), /manifold report revision mismatch/); assertions += 1;

  const forgedRuntimeRecommendation = structuredClone(runtimeDrift);
  forgedRuntimeRecommendation.review.status = 'server_recommended';
  forgedRuntimeRecommendation.review.recommended_proposal = exactRuntime.base_review.review.recommended_proposal;
  assert.equal(validateV3(forgedRuntimeRecommendation), false); assertions += 1;
  const forgedFillSemantics = structuredClone(exactRuntime);
  forgedFillSemantics.geometry_attestations[0].bbox_fill_ratio_semantics = 'exact_overlap';
  assert.equal(validateV3(forgedFillSemantics), false); assertions += 1;
  const forgedReplay = structuredClone(exactRuntime);
  forgedReplay.negative_atomic_trial_lineage.trials[0].failed_plan_replay_allowed = true;
  assert.equal(validateV3(forgedReplay), false); assertions += 1;

  const adoptionPath = path.join(tempRoot, 'adoption.json');
  const lineagePath = path.join(tempRoot, 'negative-lineage.json');
  const exactOutputPath = path.join(tempRoot, 'exact-review-v3.json');
  const driftOutputPath = path.join(tempRoot, 'drift-review-v3.json');
  const forbiddenStatePath = path.join(tempRoot, 'must-not-exist-state');
  await fs.writeFile(adoptionPath, `${JSON.stringify(fixture.adoption, null, 2)}\n`);
  await fs.writeFile(lineagePath, `${JSON.stringify(fixture.negative_atomic_trial_lineage, null, 2)}\n`);

  const exactCli = await runCli({
    runtimeSourceHashes: fixture.context.v8_loaded_runtime_source_hashes,
    adoptionPath,
    lineagePath,
    outputPath: exactOutputPath,
    statePath: forbiddenStatePath
  });
  assert.equal(exactCli.version, 'real-model-recursive-target-review.v3'); assertions += 1;
  assert.equal(exactCli.runtime, 'offline'); assertions += 1;
  assert.equal(exactCli.live_queue_called, false); assertions += 1;
  assert.equal(exactCli.status, 'blocked'); assertions += 1;
  assert.equal(exactCli.recommended_proposal, null); assertions += 1;
  assert.equal(exactCli.runtime_delta_requires_review, false); assertions += 1;
  assert.equal(exactCli.negative_source_evidence_bytes_verified, true); assertions += 1;
  assert.equal(await exists(forbiddenStatePath), false); assertions += 1;
  const exactCliArtifact = JSON.parse(await fs.readFile(exactOutputPath, 'utf8'));
  assert.equal(validateV3(exactCliArtifact), true, JSON.stringify(validateV3.errors)); assertions += 1;
  assert.equal(
    exactCliArtifact.negative_atomic_trial_lineage.source_evidence_verification.status,
    'verified_repo_regular_files_and_bound_content'
  ); assertions += 1;
  assert.equal(
    exactCliArtifact.negative_atomic_trial_lineage.trials[0].source_evidence.verification,
    'verified_repo_regular_file_and_bound_content'
  ); assertions += 1;
  assert.equal(
    decision(exactCliArtifact, 'pid:11543', 'pid:11635').negative_atomic_trial.status,
    'confirmed_precommit_abort_exact_runtime'
  ); assertions += 1;
  assert.equal(
    decision(exactCliArtifact, 'pid:11543', 'pid:11636').exact_overlap_assessment.evidence_requirement,
    'needs_stronger_evidence'
  ); assertions += 1;
  assert.equal(exactCliArtifact.next_action.action, 'collect_stronger_exact_overlap_evidence'); assertions += 1;

  const driftCli = await runCli({
    runtimeSourceHashes: fixture.context.workspace_pending_runtime_source_hashes,
    adoptionPath,
    lineagePath,
    outputPath: driftOutputPath,
    statePath: forbiddenStatePath
  });
  assert.equal(driftCli.runtime_delta_requires_review, true); assertions += 1;
  assert.ok(driftCli.blockers.includes('runtime_delta_requires_review')); assertions += 1;
  assert.equal(await exists(forbiddenStatePath), false); assertions += 1;

  const directOutputPath = path.join(tempRoot, 'direct-v3.json');
  const direct = await runRealModelRecursiveTargetReviewV3({
    adoptionFile: adoptionPath,
    sourceSha256: fixture.context.source_sha256,
    modelRevision: fixture.context.model_revision,
    caseId: fixture.context.case_id,
    runtimeSourceHashes: fixture.context.workspace_pending_runtime_source_hashes,
    negativeAtomicTrialFile: lineagePath,
    output: directOutputPath,
    now: fixedNow
  });
  assert.equal(direct.live_queue_called, false); assertions += 1;
  assert.equal(direct.review.next_action.runtime_delta_requires_review, true); assertions += 1;
  assert.equal(direct.review.safety.negative_source_evidence_bytes_verified, true); assertions += 1;
  assert.equal(direct.review.next_action.action, 'audit_runtime_source_delta_before_new_atomic_trial'); assertions += 1;
  assert.equal(validateV3(direct.review), true, JSON.stringify(validateV3.errors)); assertions += 1;

  const wrongEvidenceHash = mutateLineage((value) => {
    value.source_evidence.sha256 = `sha256:${'0'.repeat(64)}`;
  });
  await assertRunnerRejects(wrongEvidenceHash, /source_evidence hash mismatch/, {
    adoptionPath,
    outputPath: path.join(tempRoot, 'must-not-write-wrong-hash.json'),
    label: 'wrong-hash'
  }); assertions += 1;

  const escapedEvidencePath = mutateLineage((value) => {
    value.source_evidence.path = '../outside-evidence.json';
  });
  await assertRunnerRejects(escapedEvidencePath, /must not escape the repository/, {
    adoptionPath,
    outputPath: path.join(tempRoot, 'must-not-write-path-escape.json'),
    label: 'path-escape'
  }); assertions += 1;

  const evidenceSymlinkPath = path.join(workspaceTempRoot, 'v8-evidence-link.json');
  await fs.symlink(
    path.join(repoRoot, fixture.negative_atomic_trial_lineage.source_evidence.path),
    evidenceSymlinkPath
  );
  const symlinkEvidence = mutateLineage((value) => {
    value.source_evidence.path = path.relative(repoRoot, evidenceSymlinkPath).split(path.sep).join('/');
  });
  await assertRunnerRejects(symlinkEvidence, /regular non-symlink file/, {
    adoptionPath,
    outputPath: path.join(tempRoot, 'must-not-write-symlink.json'),
    label: 'symlink'
  }); assertions += 1;
  const forgedRunnerCases = [
    {
      label: 'forged-pair',
      pattern: /directed operation target\/tool binding mismatch/,
      lineage: mutateLineage((value) => { value.tool_path = 'pid:11636'; })
    },
    {
      label: 'forged-plan',
      pattern: /plan id\/hash binding mismatch/,
      lineage: mutateLineage((value) => { value.plan_hash = `sha256:${'0'.repeat(64)}`; })
    },
    {
      label: 'forged-runtime',
      pattern: /historical loaded runtime source binding mismatch/,
      lineage: mutateLineage((value) => {
        value.runtime_source_hashes.boolean_operations_sha256 = `sha256:${'0'.repeat(64)}`;
      })
    },
    {
      label: 'forged-outcome',
      pattern: /precommit failure outcome binding mismatch/,
      lineage: mutateLineage((value) => { value.outcome.abort_succeeded = false; })
    }
  ];
  for (const runnerCase of forgedRunnerCases) {
    const outputPath = path.join(tempRoot, `must-not-write-${runnerCase.label}.json`);
    await assertRunnerRejects(runnerCase.lineage, runnerCase.pattern, {
      adoptionPath,
      outputPath,
      label: runnerCase.label
    }); assertions += 1;
    assert.equal(await exists(outputPath), false); assertions += 1;
  }
  assert.equal(await exists(path.join(tempRoot, 'must-not-write-wrong-hash.json')), false); assertions += 1;
  assert.equal(await exists(path.join(tempRoot, 'must-not-write-path-escape.json')), false); assertions += 1;
  assert.equal(await exists(path.join(tempRoot, 'must-not-write-symlink.json')), false); assertions += 1;

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    exact_runtime_pair_excluded: true,
    rank_2_automatic_recommendation: false,
    runtime_delta_requires_review: true,
    exact_volume_preserved: true,
    bbox_fill_ratio_is_exact_overlap_proof: false,
    strict_negative_cases: strictNegativeCases.length,
    runner_content_binding_negative_cases: forgedRunnerCases.length,
    queue_requests_created: 0,
    release_acceptance: false
  }, null, 2)}\n`);
} finally {
  await Promise.all([
    fs.rm(tempRoot, { recursive: true, force: true }),
    fs.rm(workspaceTempRoot, { recursive: true, force: true })
  ]);
}

function reviewV3(runtimeSourceHashes, lineage = fixture.negative_atomic_trial_lineage) {
  return deriveRealModelRecursiveTargetReviewV3(
    fixture.adoption,
    v3Options(runtimeSourceHashes, lineage)
  );
}

function v3Options(runtimeSourceHashes, lineage) {
  return {
    sourceSha256: fixture.context.source_sha256,
    modelRevision: fixture.context.model_revision,
    caseId: fixture.context.case_id,
    runtimeSourceHashes,
    negativeAtomicTrialLineages: [lineage],
    now: fixedNow
  };
}

function denseAdoption() {
  const value = structuredClone(fixture.adoption);
  const geometryByPath = new Map([
    ['pid:11543', { bbox: fixtureBox([0, 0, 0], [10, 10, 10]), volume: 900 }],
    ['pid:11635', { bbox: fixtureBox([8, 2, 2], [12, 8, 8]), volume: 100 }],
    ['pid:11636', { bbox: fixtureBox([7, 1, 1], [13, 9, 9]), volume: 300 }]
  ]);
  for (const entry of value.structural_groups.entries) {
    const geometry = geometryByPath.get(entry.entity_path);
    entry.parent_bounding_box = structuredClone(geometry.bbox);
    entry.world_bounding_box = structuredClone(geometry.bbox);
    entry.manifold_attestation.report.volume = geometry.volume;
  }
  return value;
}

function fixtureBox(min, max) {
  return {
    min,
    max,
    w: max[0] - min[0],
    d: max[1] - min[1],
    h: max[2] - min[2]
  };
}

function geometry(review, occurrencePath) {
  const match = review.geometry_attestations.find((entry) => entry.occurrence_path === occurrencePath);
  assert.ok(match, `missing geometry attestation ${occurrencePath}`);
  return match;
}

function decision(review, targetPath, toolPath) {
  const match = review.review.pair_decisions.find((entry) => (
    entry.target_path === targetPath && entry.tool_path === toolPath
  ));
  assert.ok(match, `missing pair decision ${targetPath}/${toolPath}`);
  return match;
}

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`);
}

function mutateLineage(callback) {
  const copy = structuredClone(fixture.negative_atomic_trial_lineage);
  callback(copy);
  return copy;
}

async function runCli({ runtimeSourceHashes, adoptionPath, lineagePath, outputPath, statePath }) {
  const child = await execFileAsync(process.execPath, [
    path.join(repoRoot, 'scripts/review-real-model-recursive-targets.mjs'),
    '--contract-version', 'v3',
    '--adoption-file', adoptionPath,
    '--source-sha256', fixture.context.source_sha256,
    '--model-revision', fixture.context.model_revision,
    '--case-id', fixture.context.case_id,
    '--boolean-operations-sha256', runtimeSourceHashes.boolean_operations_sha256,
    '--model-revision-source-sha256', runtimeSourceHashes.model_revision_source_sha256,
    '--negative-trial-file', lineagePath,
    '--output', outputPath
  ], {
    cwd: repoRoot,
    env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: statePath }
  });
  return JSON.parse(child.stdout);
}

async function assertRunnerRejects(lineage, pattern, { adoptionPath, outputPath, label }) {
  const lineagePath = path.join(tempRoot, `${label}-lineage.json`);
  await fs.writeFile(lineagePath, `${JSON.stringify(lineage, null, 2)}\n`);
  await assert.rejects(runRealModelRecursiveTargetReviewV3({
    adoptionFile: adoptionPath,
    sourceSha256: fixture.context.source_sha256,
    modelRevision: fixture.context.model_revision,
    caseId: fixture.context.case_id,
    runtimeSourceHashes: fixture.context.v8_loaded_runtime_source_hashes,
    negativeAtomicTrialFile: lineagePath,
    output: outputPath,
    now: fixedNow
  }), pattern);
}

async function exists(targetPath) {
  return fs.access(targetPath).then(() => true, () => false);
}
