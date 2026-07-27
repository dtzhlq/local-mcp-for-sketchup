import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

export const REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST_VERSION =
  'real-model-reliability-sidecar-manifest.v1';
export const REAL_MODEL_RELIABILITY_SIDECAR_VERSION =
  'real-model-reliability-sidecar.v1';
export const DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST =
  'test/reliability-corpus/sidecar-manifest.v1.json';

const EXPECTED_CASE_COUNT = 7;
const AGGREGATE_EVIDENCE_ID = 'aggregate_review';
const FORMAL_MANIFEST_VERSION = 'real-model-reliability-corpus.v1';
const AGGREGATE_VERSION = 'real-model-reliability-sidecar-source.v1';
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CODE_PATTERN = /^[a-z][a-z0-9_]{2,95}$/;
const MANIFEST_KEYS = new Set([
  'version', 'kind', 'description', 'formal_manifest', 'sidecar_schema', 'policy', 'summary', 'cases'
]);
const SIDECAR_KEYS = new Set([
  'version', 'kind', 'case_id', 'domain', 'evidence_scope', 'formal_case', 'authority',
  'candidates', 'structural_observation', 'source_blockers', 'task_assessments',
  'evidence_bindings', 'readiness', 'validation_policy'
]);
const STRUCTURAL_KEYS = new Set([
  'source_evidence_id', 'status', 'materials', 'scenes', 'hidden_occurrences',
  'locked_occurrences', 'uv_occurrences', 'shared_occurrences', 'nonuniform_instances',
  'mirrored_instances', 'logical_occurrences', 'profile_sample_truncated'
]);

/**
 * Load the seven readiness sidecars without touching any SketchUp artifact.
 *
 * The sidecars intentionally are not `*.reliability.json` live contracts. The
 * loader accepts JSON evidence only, verifies every byte binding, and checks
 * the candidate/structure/blocker claims against the bound review aggregate.
 */
export async function loadRealModelReliabilitySidecars({
  rootDir = process.cwd(),
  manifestPath = DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST
} = {}) {
  const lexicalRoot = path.resolve(rootDir);
  const root = await fs.realpath(lexicalRoot);
  const audit = {
    json_files_read: [],
    model_files_read: 0,
    queue_calls: 0,
    artifact_copies: 0,
    model_mutations: 0
  };
  const cache = new Map();

  const readJson = async ({ relativePath, expectedSha256 = null, label }) => {
    const normalized = normalizeJsonPath(relativePath, label);
    const prior = cache.get(normalized);
    if (prior) {
      if (expectedSha256) assertHash(expectedSha256, `${label}.sha256`);
      if (expectedSha256 && prior.sha256 !== expectedSha256) {
        sidecarAssert(false, `${label} conflicts with the previously verified hash for ${normalized}`);
      }
      return prior;
    }
    const entry = await readStableJsonFile({ root, relativePath: normalized, label });
    if (expectedSha256) {
      assertHash(expectedSha256, `${label}.sha256`);
      sidecarAssert(entry.sha256 === expectedSha256, `${label} sha256 mismatch`);
    }
    cache.set(normalized, entry);
    audit.json_files_read.push(normalized);
    return entry;
  };

  const manifestEntry = await readJson({ relativePath: manifestPath, label: 'sidecar manifest' });
  const manifest = manifestEntry.document;
  assertManifestHeader(manifest);

  const formalManifestEntry = await readJson({
    relativePath: manifest.formal_manifest.path,
    expectedSha256: manifest.formal_manifest.sha256,
    label: 'formal manifest'
  });
  const formalManifest = formalManifestEntry.document;
  sidecarAssert(formalManifest?.version === FORMAL_MANIFEST_VERSION, 'formal manifest version is unsupported');
  sidecarAssert(Array.isArray(formalManifest.cases) && formalManifest.cases.length === EXPECTED_CASE_COUNT,
    'formal manifest must contain exactly seven cases');

  await readJson({
    relativePath: manifest.sidecar_schema.path,
    expectedSha256: manifest.sidecar_schema.sha256,
    label: 'sidecar schema'
  });

  const formalCases = uniqueMap(formalManifest.cases, 'id', 'formal case');
  const manifestCases = uniqueMap(manifest.cases, 'case_id', 'sidecar manifest case');
  sidecarAssert(manifestCases.size === EXPECTED_CASE_COUNT, 'sidecar manifest must contain seven unique cases');
  sidecarAssert(sameSets(formalCases.keys(), manifestCases.keys()), 'sidecar and formal case ids differ');

  const loadedCases = [];
  for (const formalCase of formalManifest.cases) {
    const sidecarBinding = manifestCases.get(formalCase.id);
    const sidecarEntry = await readJson({
      relativePath: sidecarBinding.path,
      expectedSha256: sidecarBinding.sha256,
      label: `sidecar ${formalCase.id}`
    });
    const sidecar = sidecarEntry.document;
    assertSidecarHeader({ sidecar, formalCase, formalManifestSha256: formalManifestEntry.sha256 });

    const evidenceBindings = uniqueMap(sidecar.evidence_bindings, 'id', `${formalCase.id} evidence binding`);
    const evidence = new Map();
    for (const binding of sidecar.evidence_bindings) {
      assertExactKeys(binding, new Set(['id', 'path', 'sha256', 'evidence_class']),
        `${formalCase.id} evidence ${binding.id}`);
      sidecarAssert(/^[a-z][a-z0-9_]{2,63}$/.test(binding.id),
        `${formalCase.id} evidence id is invalid`);
      sidecarAssert([
        'derived_user_confirmed_review_aggregate',
        'read_only_live_observation',
        'failed_precommit_live_attempt'
      ].includes(binding.evidence_class), `${formalCase.id} evidence class is invalid`);
      const entry = await readJson({
        relativePath: binding.path,
        expectedSha256: binding.sha256,
        label: `${formalCase.id} evidence ${binding.id}`
      });
      evidence.set(binding.id, entry.document);
    }
    sidecarAssert(evidenceBindings.has(AGGREGATE_EVIDENCE_ID), `${formalCase.id} is missing aggregate_review evidence`);
    await verifyAggregateLineage({
      aggregate: evidence.get(AGGREGATE_EVIDENCE_ID),
      readJson,
      formalManifestEntry
    });
    validateAgainstAggregate({
      sidecar,
      aggregate: evidence.get(AGGREGATE_EVIDENCE_ID),
      formalCase,
      evidenceBindings
    });
    validateSpecialEvidence({ sidecar, evidence, evidenceBindings });

    loadedCases.push({
      case_id: sidecar.case_id,
      domain: sidecar.domain,
      readiness: sidecar.readiness.status,
      execution_eligible: sidecar.readiness.execution_eligible,
      native_mutation_successes: sidecar.readiness.native_mutation_successes,
      candidates: sidecar.candidates.length,
      tasks: sidecar.task_assessments.map((entry) => ({
        task: entry.task,
        status: entry.status,
        native_success: entry.native_success
      }))
    });
  }

  const nativeMutationSuccesses = loadedCases.reduce(
    (sum, entry) => sum + entry.native_mutation_successes,
    0
  );
  const blockedCases = loadedCases.filter((entry) => entry.readiness === 'blocked').length;
  const executionEligibleCases = loadedCases.filter((entry) => entry.execution_eligible).length;
  sidecarAssert(manifest.summary.case_count === loadedCases.length, 'manifest summary case_count mismatch');
  sidecarAssert(manifest.summary.blocked_cases === blockedCases, 'manifest summary blocked_cases mismatch');
  sidecarAssert(manifest.summary.execution_eligible_cases === executionEligibleCases,
    'manifest summary execution_eligible_cases mismatch');
  sidecarAssert(manifest.summary.native_mutation_successes === nativeMutationSuccesses,
    'manifest summary native_mutation_successes mismatch');
  sidecarAssert(manifest.summary.release_acceptance === false, 'sidecar manifest cannot grant release acceptance');
  sidecarAssert(nativeMutationSuccesses === 0, 'v1 evidence boundary must conservatively report zero native mutation successes');

  return {
    ok: true,
    runtime: 'offline',
    live_queue_called: false,
    model_files_read: 0,
    mutation_authorized: false,
    release_acceptance: false,
    manifest_sha256: manifestEntry.sha256,
    summary: {
      case_count: loadedCases.length,
      blocked_cases: blockedCases,
      execution_eligible_cases: executionEligibleCases,
      native_mutation_successes: nativeMutationSuccesses
    },
    cases: loadedCases,
    io_audit: {
      ...audit,
      json_files_read: [...audit.json_files_read]
    }
  };
}

async function verifyAggregateLineage({ aggregate, readJson, formalManifestEntry }) {
  validateAggregateSnapshot(aggregate);
  const lineage = aggregate.source_lineage;
  sidecarAssert(lineage.formal_manifest.path === formalManifestEntry.relativePath,
    'aggregate snapshot formal manifest path mismatch');
  sidecarAssert(lineage.formal_manifest.sha256 === formalManifestEntry.sha256,
    'aggregate snapshot formal manifest hash mismatch');
  const baseMappingEntry = await readJson({
    relativePath: lineage.base_semantic_mapping.path,
    expectedSha256: lineage.base_semantic_mapping.sha256,
    label: 'aggregate snapshot base semantic mapping'
  });
  const baseMapping = baseMappingEntry.document;
  sidecarAssert(baseMapping?.version === 'real-model-candidate-semantic-mapping.v1',
    'aggregate snapshot base semantic mapping version is unsupported');
  sidecarAssert(baseMapping?.kind === 'real_model_candidate_semantic_mapping',
    'aggregate snapshot base semantic mapping kind is unsupported');
  sidecarAssert(baseMapping?.authority?.user_confirmed === true,
    'aggregate snapshot base semantic mappings are not user confirmed');
  sidecarAssert(baseMapping?.authority?.mutation_authorized === false,
    'base semantic mapping cannot authorize mutation');
  sidecarAssert(baseMapping?.authority?.approval_token_issued === false,
    'base semantic mapping cannot issue approval tokens');
  sidecarAssert(baseMapping?.authority?.execution_policy_changed === false,
    'base semantic mapping cannot change execution policy');

  const productReviewEntry = await readJson({
    relativePath: lineage.product_target_review.path,
    expectedSha256: lineage.product_target_review.sha256,
    label: 'aggregate snapshot product target review'
  });
  const productReview = productReviewEntry.document;
  sidecarAssert(productReview?.version === 'real-model-target-review.v1',
    'aggregate snapshot product target review version is unsupported');
  sidecarAssert(productReview?.target_review?.target_roles_confirmed === false,
    'aggregate snapshot product target roles must remain unconfirmed');
  sidecarAssert(productReview?.target_review?.formal_sidecar_ready === false,
    'aggregate snapshot product target review cannot claim formal readiness');
  sidecarAssert(productReview?.safety?.model_content_mutation_requested === false,
    'aggregate snapshot product target review must remain read-only');

  const productMappingEntry = await readJson({
    relativePath: lineage.product_semantic_mapping_amendment.path,
    expectedSha256: lineage.product_semantic_mapping_amendment.sha256,
    label: 'aggregate snapshot product semantic mapping amendment'
  });
  const productMapping = productMappingEntry.document;
  sidecarAssert(productMapping?.version === 'real-model-candidate-semantic-mapping-amendment.v1',
    'aggregate snapshot product semantic mapping amendment version is unsupported');
  sidecarAssert(productMapping?.kind === 'real_model_candidate_semantic_mapping_amendment',
    'aggregate snapshot product semantic mapping amendment kind is unsupported');
  sidecarAssert(productMapping?.authority?.user_confirmed === true,
    'aggregate snapshot product semantic mapping is not user confirmed');
  for (const key of ['mutation_authorized', 'approval_token_issued', 'execution_policy_changed', 'target_roles_confirmed']) {
    sidecarAssert(productMapping?.authority?.[key] === false,
      `product semantic mapping amendment cannot set authority.${key}`);
  }
  sidecarAssert(productMapping?.target_review_disposition?.target_roles_confirmed === false,
    'product semantic mapping amendment cannot confirm target roles');
  sidecarAssert(productMapping?.cross_version?.status === 'deferred_by_user' &&
    productMapping?.cross_version?.represented_as_pass === false,
  'product semantic mapping amendment cannot represent cross-version validation as passed');
  const productSourceReview = aggregate.case_reviews.find((entry) => entry.case_id === 'product-boolean-manifold');
  const productPrimary = productSourceReview?.mapped_candidates?.find((entry) => entry.role === 'primary');
  sidecarAssert(productMapping?.addition?.candidate_id === productPrimary?.candidate_id,
    'product semantic mapping candidate id differs from the source snapshot');
  sidecarAssert(productMapping?.addition?.candidate_handle === productPrimary?.candidate_handle,
    'product semantic mapping candidate handle differs from the source snapshot');
  sidecarAssert(productMapping?.addition?.source_sha256 === productPrimary?.source_sha256,
    'product semantic mapping source hash differs from the source snapshot');
  sidecarAssert(equalJson(productMapping?.addition?.assignments, [{
    case_id: 'product-boolean-manifold',
    role: 'primary',
    review_status: 'user_confirmed'
  }]), 'product semantic mapping assignment differs from the source snapshot');
}

function assertManifestHeader(manifest) {
  assertExactKeys(manifest, MANIFEST_KEYS, 'sidecar manifest');
  sidecarAssert(manifest?.version === REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST_VERSION,
    'unsupported sidecar manifest version');
  sidecarAssert(manifest?.kind === 'real_model_reliability_readiness_sidecar_manifest',
    'unsupported sidecar manifest kind');
  sidecarAssert(Array.isArray(manifest?.cases) && manifest.cases.length === EXPECTED_CASE_COUNT,
    'sidecar manifest must contain exactly seven cases');
  for (const bindingName of ['formal_manifest', 'sidecar_schema']) {
    const binding = manifest?.[bindingName];
    assertExactKeys(binding, new Set(['path', 'sha256']), `manifest.${bindingName}`);
    sidecarAssert(binding && typeof binding === 'object', `manifest ${bindingName} binding is missing`);
    normalizeJsonPath(binding.path, `manifest.${bindingName}.path`);
    assertHash(binding.sha256, `manifest.${bindingName}.sha256`);
  }
  const policy = manifest?.policy;
  assertExactKeys(policy, new Set([
    'evidence_only', 'live_execution_contracts', 'default_runtime', 'json_only_validation',
    'original_model_file_access', 'queue_access', 'model_mutation', 'artifact_copy',
    'cross_version_status'
  ]), 'manifest.policy');
  sidecarAssert(policy?.evidence_only === true, 'manifest must remain evidence-only');
  sidecarAssert(policy?.live_execution_contracts === false, 'readiness sidecars cannot be live contracts');
  sidecarAssert(policy?.default_runtime === 'offline', 'sidecar validation must default to offline');
  sidecarAssert(policy?.json_only_validation === true, 'sidecar validation must be JSON-only');
  sidecarAssert(policy?.original_model_file_access === false, 'sidecar validation cannot access original models');
  sidecarAssert(policy?.queue_access === false, 'sidecar validation cannot access queue transport');
  sidecarAssert(policy?.model_mutation === false, 'sidecar validation cannot mutate models');
  sidecarAssert(policy?.artifact_copy === false, 'sidecar validation cannot copy artifacts');
  sidecarAssert(policy?.cross_version_status === 'deferred_by_user', 'cross-version status must remain deferred_by_user');
  assertExactKeys(manifest.summary, new Set([
    'case_count', 'blocked_cases', 'execution_eligible_cases', 'native_mutation_successes',
    'release_acceptance'
  ]), 'manifest.summary');
  for (const entry of manifest.cases) {
    assertExactKeys(entry, new Set(['case_id', 'path', 'sha256']), 'manifest case');
    sidecarAssert(entry.path === `test/reliability-corpus/sidecars/${entry.case_id}.sidecar.v1.json`,
      `manifest case ${entry.case_id} path is not canonical`);
    normalizeJsonPath(entry.path, `manifest case ${entry.case_id}.path`);
    assertHash(entry.sha256, `manifest case ${entry.case_id}.sha256`);
  }
}

function assertSidecarHeader({ sidecar, formalCase, formalManifestSha256 }) {
  assertExactKeys(sidecar, SIDECAR_KEYS, `${formalCase.id} sidecar`);
  sidecarAssert(sidecar?.version === REAL_MODEL_RELIABILITY_SIDECAR_VERSION,
    `${formalCase.id} sidecar version is unsupported`);
  sidecarAssert(sidecar?.kind === 'real_model_reliability_readiness_sidecar',
    `${formalCase.id} sidecar kind is unsupported`);
  sidecarAssert(sidecar.case_id === formalCase.id, `${formalCase.id} sidecar case id mismatch`);
  sidecarAssert(sidecar.domain === formalCase.domain, `${formalCase.id} sidecar domain mismatch`);
  sidecarAssert(sidecar.evidence_scope === 'hash_bound_readiness_evidence_only',
    `${formalCase.id} evidence scope is invalid`);
  sidecarAssert(sidecar.formal_case?.manifest_sha256 === formalManifestSha256,
    `${formalCase.id} formal manifest binding mismatch`);
  sidecarAssert(equalJson(sidecar.formal_case?.tasks, formalCase.tasks),
    `${formalCase.id} formal task list mismatch`);
  assertExactKeys(sidecar.formal_case, new Set(['manifest_sha256', 'tasks']), `${formalCase.id} formal_case`);
  assertExactKeys(sidecar.authority, new Set([
    'semantic_mapping', 'model_content_trust', 'mutation_authorized', 'approval_token_issued',
    'execution_policy_changed'
  ]), `${formalCase.id} authority`);
  sidecarAssert(sidecar.authority?.semantic_mapping === 'user_confirmed_in_bound_review_aggregate',
    `${formalCase.id} semantic authority is invalid`);
  sidecarAssert(sidecar.authority?.model_content_trust === 'untrusted_data',
    `${formalCase.id} model content must remain untrusted`);
  for (const field of ['mutation_authorized', 'approval_token_issued', 'execution_policy_changed']) {
    sidecarAssert(sidecar.authority?.[field] === false, `${formalCase.id} cannot set authority.${field}`);
  }
  sidecarAssert(Array.isArray(sidecar.candidates) && sidecar.candidates.length > 0,
    `${formalCase.id} requires at least one candidate`);
  const candidateIds = new Set();
  for (const candidate of sidecar.candidates) {
    assertExactKeys(candidate, new Set([
      'candidate_id', 'candidate_handle', 'source_sha256', 'role', 'source_evidence_id'
    ]), `${formalCase.id} candidate`);
    sidecarAssert(/^candidate_[0-9a-f]{24}$/.test(String(candidate.candidate_id || '')),
      `${formalCase.id} candidate id is invalid`);
    sidecarAssert(candidate.candidate_handle === `candidate:sha256:${candidate.candidate_id.slice('candidate_'.length)}`,
      `${formalCase.id} candidate handle does not match candidate id`);
    assertHash(candidate.source_sha256, `${formalCase.id} candidate source_sha256`);
    sidecarAssert(['primary', 'supporting'].includes(candidate.role), `${formalCase.id} candidate role is invalid`);
    sidecarAssert(candidate.source_evidence_id === AGGREGATE_EVIDENCE_ID,
      `${formalCase.id} candidate must bind aggregate_review`);
    sidecarAssert(!candidateIds.has(candidate.candidate_id), `${formalCase.id} repeats a candidate id`);
    candidateIds.add(candidate.candidate_id);
  }
  assertExactKeys(sidecar.structural_observation, STRUCTURAL_KEYS, `${formalCase.id} structural_observation`);
  sidecarAssert(sidecar.structural_observation.source_evidence_id === AGGREGATE_EVIDENCE_ID,
    `${formalCase.id} structural observation must bind aggregate_review`);
  sidecarAssert(sidecar.structural_observation.status === 'observed_read_only',
    `${formalCase.id} structural observation status is invalid`);
  for (const key of STRUCTURAL_KEYS) {
    if (['source_evidence_id', 'status', 'profile_sample_truncated'].includes(key)) continue;
    const value = sidecar.structural_observation[key];
    sidecarAssert(Number.isInteger(value) && value >= 0, `${formalCase.id} structural ${key} is invalid`);
  }
  sidecarAssert(typeof sidecar.structural_observation.profile_sample_truncated === 'boolean',
    `${formalCase.id} profile_sample_truncated must be boolean`);
  sidecarAssert(Array.isArray(sidecar.task_assessments), `${formalCase.id} task assessments are missing`);
  sidecarAssert(Array.isArray(sidecar.evidence_bindings), `${formalCase.id} evidence bindings are missing`);
  sidecarAssert(Array.isArray(sidecar.source_blockers) && sidecar.source_blockers.length > 0,
    `${formalCase.id} source blockers are missing`);
  assertUniqueCodes(sidecar.source_blockers, `${formalCase.id} source blockers`);
  assertReadinessBoundary(sidecar);
  assertValidationPolicy(sidecar);
}

function validateAgainstAggregate({ sidecar, aggregate, formalCase, evidenceBindings }) {
  validateAggregateSnapshot(aggregate);
  sidecarAssert(aggregate?.version === AGGREGATE_VERSION,
    `${formalCase.id} aggregate review version is unsupported`);
  sidecarAssert(aggregate?.kind === 'real_model_reliability_sidecar_source',
    `${formalCase.id} aggregate review kind is unsupported`);
  sidecarAssert(aggregate?.summary?.formal_cases === EXPECTED_CASE_COUNT,
    `${formalCase.id} aggregate does not cover seven formal cases`);
  sidecarAssert(aggregate?.summary?.semantically_mapped_cases === EXPECTED_CASE_COUNT,
    `${formalCase.id} aggregate does not map all seven cases`);
  sidecarAssert(aggregate?.safety?.model_mutation === false,
    `${formalCase.id} aggregate cannot authorize mutation`);
  sidecarAssert(aggregate?.safety?.release_acceptance === false,
    `${formalCase.id} aggregate cannot grant release acceptance`);

  const sourceReview = aggregate.case_reviews?.find((entry) => entry.case_id === formalCase.id);
  sidecarAssert(sourceReview, `${formalCase.id} is missing from aggregate review`);
  sidecarAssert(sourceReview.domain === sidecar.domain, `${formalCase.id} aggregate domain mismatch`);
  const expectedCandidates = sourceReview.mapped_candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    candidate_handle: candidate.candidate_handle,
    source_sha256: candidate.source_sha256,
    role: candidate.role,
    source_evidence_id: AGGREGATE_EVIDENCE_ID
  }));
  sidecarAssert(equalJson(sidecar.candidates, expectedCandidates),
    `${formalCase.id} candidate bindings do not match the aggregate`);
  const expectedStructure = {
    source_evidence_id: AGGREGATE_EVIDENCE_ID,
    status: 'observed_read_only',
    ...sourceReview.structural_evidence
  };
  sidecarAssert(equalJson(sidecar.structural_observation, expectedStructure),
    `${formalCase.id} structural observation does not match the aggregate`);
  sidecarAssert(equalJson(sidecar.source_blockers, sourceReview.blockers),
    `${formalCase.id} source blockers do not match the aggregate`);

  const taskAssessments = uniqueMap(sidecar.task_assessments, 'task', `${formalCase.id} task assessment`);
  sidecarAssert(sameSets(taskAssessments.keys(), formalCase.tasks),
    `${formalCase.id} task assessment set differs from the formal manifest`);
  sidecarAssert(sidecar.task_assessments.map((entry) => entry.task).join('|') === formalCase.tasks.join('|'),
    `${formalCase.id} task assessment order differs from the formal manifest`);
  for (const assessment of sidecar.task_assessments) {
    assertExactKeys(assessment, new Set([
      'task', 'status', 'native_success', 'evidence_ids', 'reason_codes'
    ]), `${formalCase.id}/${assessment.task} assessment`);
    sidecarAssert(['read_only_observed', 'blocked', 'unknown', 'failed_precommit', 'verified_native'].includes(assessment.status),
      `${formalCase.id}/${assessment.task} has an invalid status`);
    sidecarAssert(assessment.native_success === false,
      `${formalCase.id}/${assessment.task} cannot claim native success in the v1 evidence boundary`);
    sidecarAssert(assessment.status !== 'verified_native',
      `${formalCase.id}/${assessment.task} cannot claim verified_native`);
    sidecarAssert(Array.isArray(assessment.evidence_ids) && assessment.evidence_ids.length > 0,
      `${formalCase.id}/${assessment.task} requires evidence ids`);
    sidecarAssert(new Set(assessment.evidence_ids).size === assessment.evidence_ids.length,
      `${formalCase.id}/${assessment.task} repeats evidence ids`);
    for (const evidenceId of assessment.evidence_ids) {
      sidecarAssert(evidenceBindings.has(evidenceId),
        `${formalCase.id}/${assessment.task} references unknown evidence ${evidenceId}`);
    }
    assertUniqueCodes(assessment.reason_codes, `${formalCase.id}/${assessment.task} reason codes`);
  }
}

function validateAggregateSnapshot(aggregate) {
  assertExactKeys(aggregate, new Set([
    'version', 'kind', 'captured_on', 'evidence_scope', 'source_lineage', 'authority',
    'summary', 'case_reviews', 'safety'
  ]), 'aggregate snapshot');
  sidecarAssert(aggregate.version === AGGREGATE_VERSION, 'aggregate snapshot version is unsupported');
  sidecarAssert(aggregate.kind === 'real_model_reliability_sidecar_source',
    'aggregate snapshot kind is unsupported');
  sidecarAssert(aggregate.evidence_scope === 'normalized_snapshot_of_hash_bound_candidate_review_aggregate',
    'aggregate snapshot evidence scope is invalid');
  assertExactKeys(aggregate.source_lineage, new Set([
    'review_aggregate', 'formal_manifest', 'base_semantic_mapping',
    'product_semantic_mapping_amendment', 'product_target_review'
  ]), 'aggregate snapshot source_lineage');
  for (const [name, binding] of Object.entries(aggregate.source_lineage)) {
    const expectedKeys = name === 'review_aggregate'
      ? new Set(['path', 'sha256', 'runtime_dependency'])
      : new Set(['path', 'sha256']);
    assertExactKeys(binding, expectedKeys, `aggregate snapshot source_lineage.${name}`);
    normalizeJsonPath(binding.path, `aggregate snapshot source_lineage.${name}.path`);
    assertHash(binding.sha256, `aggregate snapshot source_lineage.${name}.sha256`);
  }
  sidecarAssert(aggregate.source_lineage.review_aggregate.runtime_dependency === false,
    'ignored output aggregate cannot be a runtime dependency');
  assertExactKeys(aggregate.authority, new Set([
    'semantic_mapping', 'model_content_trust', 'mutation_authorized', 'approval_token_issued',
    'execution_policy_changed'
  ]), 'aggregate snapshot authority');
  sidecarAssert(aggregate.authority.semantic_mapping === 'derived_from_user_confirmed_review_aggregate',
    'aggregate snapshot semantic authority is invalid');
  sidecarAssert(aggregate.authority.model_content_trust === 'untrusted_data',
    'aggregate snapshot model content must remain untrusted');
  for (const key of ['mutation_authorized', 'approval_token_issued', 'execution_policy_changed']) {
    sidecarAssert(aggregate.authority[key] === false, `aggregate snapshot cannot set authority.${key}`);
  }
  assertExactKeys(aggregate.summary, new Set([
    'formal_cases', 'semantically_mapped_cases', 'formal_live_sidecars_ready',
    'native_mutation_successes'
  ]), 'aggregate snapshot summary');
  sidecarAssert(aggregate.summary.formal_cases === EXPECTED_CASE_COUNT,
    'aggregate snapshot must cover seven formal cases');
  sidecarAssert(aggregate.summary.semantically_mapped_cases === EXPECTED_CASE_COUNT,
    'aggregate snapshot must map seven formal cases');
  sidecarAssert(aggregate.summary.formal_live_sidecars_ready === 0,
    'aggregate snapshot cannot claim live sidecar readiness');
  sidecarAssert(aggregate.summary.native_mutation_successes === 0,
    'aggregate snapshot cannot claim native mutation success');
  sidecarAssert(Array.isArray(aggregate.case_reviews) && aggregate.case_reviews.length === EXPECTED_CASE_COUNT,
    'aggregate snapshot must contain seven case reviews');
  uniqueMap(aggregate.case_reviews, 'case_id', 'aggregate snapshot case review');
  for (const review of aggregate.case_reviews) {
    assertExactKeys(review, new Set([
      'case_id', 'domain', 'mapped_candidates', 'structural_evidence', 'blockers'
    ]), `aggregate snapshot case ${review.case_id}`);
    sidecarAssert(Array.isArray(review.mapped_candidates) && review.mapped_candidates.length > 0,
      `aggregate snapshot case ${review.case_id} requires candidates`);
    for (const candidate of review.mapped_candidates) {
      assertExactKeys(candidate, new Set(['candidate_id', 'candidate_handle', 'source_sha256', 'role']),
        `aggregate snapshot case ${review.case_id} candidate`);
      assertHash(candidate.source_sha256, `aggregate snapshot case ${review.case_id} candidate source_sha256`);
    }
    assertExactKeys(review.structural_evidence, new Set([
      'materials', 'scenes', 'hidden_occurrences', 'locked_occurrences', 'uv_occurrences',
      'shared_occurrences', 'nonuniform_instances', 'mirrored_instances', 'logical_occurrences',
      'profile_sample_truncated'
    ]), `aggregate snapshot case ${review.case_id} structural_evidence`);
    assertUniqueCodes(review.blockers, `aggregate snapshot case ${review.case_id} blockers`);
  }
  assertExactKeys(aggregate.safety, new Set([
    'snapshot_created_offline', 'original_model_file_access', 'queue_access', 'model_mutation',
    'artifact_copy', 'release_acceptance'
  ]), 'aggregate snapshot safety');
  sidecarAssert(aggregate.safety.snapshot_created_offline === true,
    'aggregate snapshot must be created offline');
  for (const key of [
    'original_model_file_access', 'queue_access', 'model_mutation', 'artifact_copy', 'release_acceptance'
  ]) {
    sidecarAssert(aggregate.safety[key] === false, `aggregate snapshot safety.${key} must be false`);
  }
}

function validateSpecialEvidence({ sidecar, evidence, evidenceBindings }) {
  if (evidence.has('trimble_target_review')) {
    const targetReview = evidence.get('trimble_target_review');
    const primary = sidecar.candidates.find((entry) => entry.role === 'primary');
    sidecarAssert(evidenceBindings.get('trimble_target_review')?.evidence_class === 'read_only_live_observation',
      'trimble_target_review must be classified as a read-only live observation');
    sidecarAssert(sidecar.case_id === 'product-boolean-manifold',
      'trimble_target_review may only support the product case');
    sidecarAssert(targetReview?.version === 'real-model-target-review.v1',
      'trimble target review version is unsupported');
    sidecarAssert(targetReview?.source?.candidate_id === primary?.candidate_id,
      'trimble target review candidate mismatch');
    sidecarAssert(targetReview?.target_review?.target_roles_confirmed === false,
      'trimble target review cannot confirm target roles');
    sidecarAssert(targetReview?.target_review?.formal_sidecar_ready === false,
      'trimble target review cannot claim formal readiness');
    sidecarAssert(targetReview?.safety?.model_content_mutation_requested === false,
      'trimble target review must remain read-only');
  }
  if (evidence.has('portal_v8_readonly')) {
    const discovery = evidence.get('portal_v8_readonly');
    const primary = sidecar.candidates.find((entry) => entry.role === 'primary');
    sidecarAssert(evidenceBindings.get('portal_v8_readonly')?.evidence_class === 'read_only_live_observation',
      'portal_v8_readonly must be classified as a read-only live observation');
    sidecarAssert(sidecar.case_id === 'deep-shared-components',
      'portal_v8_readonly may only support the deep-shared case');
    sidecarAssert(discovery?.version === 'portal-boolean-v8-readonly-discovery-evidence.v1',
      'Portal v8 read-only evidence version is unsupported');
    sidecarAssert(discovery?.source?.candidate_id === primary?.candidate_id,
      'Portal v8 read-only candidate mismatch');
    sidecarAssert(discovery?.model?.revision_complete === true,
      'Portal v8 model revision must be complete');
    sidecarAssert(discovery?.model?.revision_strategy === 'definition-merkle.v2',
      'Portal v8 model revision must use definition-merkle.v2');
    sidecarAssert(discovery?.structural_probe?.recursive_truncated === false,
      'Portal v8 recursive evidence must be complete');
    sidecarAssert(discovery?.safety?.read_only_live_calls_only === true,
      'Portal v8 supporting evidence must be read-only');
    sidecarAssert(discovery?.safety?.model_content_mutation_performed === false,
      'Portal v8 supporting evidence cannot include a mutation');
    const assessment = sidecar.task_assessments.find((entry) => entry.task === 'large_recursive_index');
    sidecarAssert(assessment?.status === 'read_only_observed',
      'complete Portal recursive evidence must be represented as read_only_observed');
    sidecarAssert(assessment.evidence_ids.includes('portal_v8_readonly'),
      'large_recursive_index must bind Portal v8 read-only evidence');
  }

  if (sidecar.case_id === 'deep-shared-components') {
    sidecarAssert(evidence.has('portal_v8_readonly'),
      'deep-shared-components must bind Portal v8 read-only evidence');
    sidecarAssert(evidence.has('portal_v8_failure'),
      'deep-shared-components must bind the Portal v8 failed-precommit evidence');
  }

  if (evidence.has('portal_v8_failure')) {
    const failure = evidence.get('portal_v8_failure');
    const failureBinding = evidenceBindings.get('portal_v8_failure');
    const discoveryBinding = evidenceBindings.get('portal_v8_readonly');
    const discovery = evidence.get('portal_v8_readonly');
    const primary = sidecar.candidates.find((entry) => entry.role === 'primary');
    sidecarAssert(sidecar.case_id === 'deep-shared-components',
      'portal_v8_failure may only be bound to the deep-shared case');
    sidecarAssert(failureBinding?.evidence_class === 'failed_precommit_live_attempt',
      'portal_v8_failure must be classified as a failed precommit live attempt');
    sidecarAssert(failure?.version === 'portal-boolean-v8-failure-evidence.v1',
      'Portal v8 failure evidence version is unsupported');
    sidecarAssert(failure?.kind === 'portal_boolean_v8_precommit_abort_evidence',
      'Portal v8 failure evidence kind is unsupported');
    sidecarAssert(failure?.result === 'confirmed_precommit_abort',
      'Portal v8 failure must remain a confirmed precommit abort');
    sidecarAssert(failure?.workflow?.version === 'portal-structure-s3-boolean-live.v8' &&
      failure?.workflow?.task_state === 'failed' && failure?.workflow?.risk_level === 'S3',
    'Portal v8 failure workflow boundary is invalid');

    const approval = failure?.approval;
    sidecarAssert(approval?.status_after_failure === 'consumed_failed',
      'Portal v8 approval must remain consumed_failed');
    for (const field of [
      'approval_reusable', 'same_task_retry_allowed', 'previous_plan_or_approval_replay_allowed',
      'agent_self_approval_accepted', 'private_approval_material_exposed'
    ]) {
      sidecarAssert(approval?.[field] === false, `Portal v8 approval.${field} must remain false`);
    }

    const failedOperation = failure?.failure;
    sidecarAssert(failedOperation?.error_code === 'MUTATION_EXECUTION_FAILED' &&
      failedOperation?.phase === 'precommit_execution',
    'Portal v8 failure phase is invalid');
    sidecarAssert(failedOperation?.outcome_unknown === false,
      'Portal v8 failure outcome must remain known');
    sidecarAssert(failedOperation?.mutation_committed === false &&
      failedOperation?.commit_state === 'not_committed',
    'Portal v8 failure cannot be represented as committed');
    sidecarAssert(failedOperation?.rollback_confirmed === true && failedOperation?.abort_succeeded === true,
      'Portal v8 failure requires confirmed rollback and abort');
    for (const field of [
      'durable_receipt_confirmed', 'durable_receipt_present', 'automatic_retry_performed',
      'automatic_replay_performed', 'duplicate_mutation_observed'
    ]) {
      sidecarAssert(failedOperation?.[field] === false, `Portal v8 failure.${field} must remain false`);
    }
    sidecarAssert(failedOperation?.exact_solid_overlap?.verified === false,
      'Portal v8 failure cannot establish exact solid overlap');

    sidecarAssert(failure?.source?.sha256_before === primary?.source_sha256 &&
      failure?.source?.sha256_after === primary?.source_sha256 && failure?.source?.bytes_unchanged === true,
    'Portal v8 failed attempt must remain bound to unchanged primary-candidate bytes');
    sidecarAssert(failure?.source?.original_model_in_scope === false &&
      failure?.source?.source_overwritten === false,
    'Portal v8 failure cannot include or overwrite the original model');
    sidecarAssert(failure?.post_abort_model?.revision === discovery?.model?.revision &&
      failure?.post_abort_model?.revision_complete === true &&
      failure?.post_abort_model?.model_modified === false &&
      failure?.post_abort_model?.pair_baseline_unchanged === true,
    'Portal v8 post-abort model evidence is inconsistent with read-only discovery');
    sidecarAssert(failure?.source_contract_bindings?.readonly_discovery_evidence?.path === discoveryBinding?.path &&
      failure?.source_contract_bindings?.readonly_discovery_evidence?.sha256 === discoveryBinding?.sha256,
    'Portal v8 failure does not bind the same read-only discovery evidence');

    const recoveryQueue = failure?.recovery?.queue_after_recovery;
    sidecarAssert(failure?.recovery?.post_abort_readonly_check_completed === true &&
      recoveryQueue?.queue === 0 && recoveryQueue?.processing === 0 && recoveryQueue?.responses === 0 &&
      recoveryQueue?.lock_exists === false && failure?.recovery?.saved_result_copy_created === false &&
      failure?.recovery?.new_review_required_before_any_retry === true,
    'Portal v8 recovery boundary is invalid');
    sidecarAssert(failure?.release_acceptance === false,
      'Portal v8 failed attempt cannot grant release acceptance');
    sidecarAssert(sidecar.task_assessments.every((entry) => !entry.evidence_ids.includes('portal_v8_failure')),
      'Portal v8 failed Boolean evidence cannot support a formal deep-shared task assessment');
  }
}

function assertReadinessBoundary(sidecar) {
  const readiness = sidecar.readiness;
  assertExactKeys(readiness, new Set([
    'status', 'execution_eligible', 'live_execution_contract_present',
    'native_mutation_successes', 'release_acceptance', 'blockers', 'unknowns'
  ]), `${sidecar.case_id} readiness`);
  sidecarAssert(readiness?.status === 'blocked', `${sidecar.case_id} readiness must remain blocked`);
  sidecarAssert(readiness?.execution_eligible === false, `${sidecar.case_id} cannot be execution eligible`);
  sidecarAssert(readiness?.live_execution_contract_present === false,
    `${sidecar.case_id} readiness sidecar cannot claim a live execution contract`);
  sidecarAssert(readiness?.native_mutation_successes === 0,
    `${sidecar.case_id} must report zero native mutation successes`);
  sidecarAssert(readiness?.release_acceptance === false, `${sidecar.case_id} cannot grant release acceptance`);
  assertUniqueCodes(readiness.blockers, `${sidecar.case_id} readiness blockers`);
  assertUniqueCodes(readiness.unknowns, `${sidecar.case_id} readiness unknowns`);
  sidecarAssert(readiness.blockers.includes('live_execution_contract_missing'),
    `${sidecar.case_id} must retain live_execution_contract_missing`);
  sidecarAssert(readiness.blockers.includes('native_mutation_success_not_established'),
    `${sidecar.case_id} must retain native_mutation_success_not_established`);
}

function assertValidationPolicy(sidecar) {
  const policy = sidecar.validation_policy;
  assertExactKeys(policy, new Set([
    'json_only', 'original_model_file_access', 'queue_access', 'model_mutation',
    'artifact_copy', 'cross_version_status'
  ]), `${sidecar.case_id} validation_policy`);
  sidecarAssert(policy?.json_only === true, `${sidecar.case_id} validation must be JSON-only`);
  for (const field of ['original_model_file_access', 'queue_access', 'model_mutation', 'artifact_copy']) {
    sidecarAssert(policy?.[field] === false, `${sidecar.case_id} validation_policy.${field} must be false`);
  }
  sidecarAssert(policy?.cross_version_status === 'deferred_by_user',
    `${sidecar.case_id} cross-version status must remain deferred_by_user`);
}

async function readStableJsonFile({ root, relativePath, label }) {
  const lexicalPath = path.resolve(root, relativePath);
  sidecarAssert(isPathInside(root, lexicalPath), `${label} escapes the workspace`);
  const lexicalStat = await fs.lstat(lexicalPath).catch(() => null);
  sidecarAssert(lexicalStat?.isFile() === true && lexicalStat.isSymbolicLink() === false,
    `${label} must be a regular non-symbolic-link JSON file`);
  const realPath = await fs.realpath(lexicalPath);
  sidecarAssert(isPathInside(root, realPath), `${label} resolves outside the workspace`);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
  const handle = await fs.open(realPath, flags);
  try {
    const before = await handle.stat();
    sidecarAssert(before.isFile(), `${label} descriptor is not a regular file`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    sidecarAssert(stableStat(before, after), `${label} changed while being read`);
    let document;
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch {
      sidecarAssert(false, `${label} is not valid JSON`);
    }
    return {
      relativePath,
      document,
      sha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
      sizeBytes: bytes.length
    };
  } finally {
    await handle.close();
  }
}

function normalizeJsonPath(value, label) {
  sidecarAssert(typeof value === 'string' && value.length > 0 && value.length <= 500,
    `${label} is invalid`);
  sidecarAssert(!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value),
    `${label} must be workspace-relative`);
  sidecarAssert(!value.includes('\\') && !value.includes('\u0000'), `${label} contains unsafe characters`);
  const segments = value.split('/');
  sidecarAssert(segments.every((segment) => segment && segment !== '.' && segment !== '..'),
    `${label} contains traversal or empty segments`);
  sidecarAssert(path.posix.normalize(value) === value, `${label} must be normalized`);
  sidecarAssert(value.toLowerCase().endsWith('.json'), `${label} must reference JSON evidence`);
  sidecarAssert(!/\.(?:skp|skb)$/i.test(value), `${label} cannot reference a SketchUp model`);
  return value;
}

function assertHash(value, label) {
  sidecarAssert(HASH_PATTERN.test(String(value || '')), `${label} is not a canonical sha256 binding`);
}

function assertUniqueCodes(values, label) {
  sidecarAssert(Array.isArray(values) && values.length > 0, `${label} must be a non-empty array`);
  sidecarAssert(new Set(values).size === values.length, `${label} contains duplicates`);
  for (const value of values) sidecarAssert(CODE_PATTERN.test(String(value || '')), `${label} contains an invalid code`);
}

function uniqueMap(values, key, label) {
  sidecarAssert(Array.isArray(values), `${label} list is missing`);
  const result = new Map();
  for (const value of values) {
    const id = value?.[key];
    sidecarAssert(typeof id === 'string' && id.length > 0, `${label} ${key} is missing`);
    sidecarAssert(!result.has(id), `${label} ${id} is duplicated`);
    result.set(id, value);
  }
  return result;
}

function assertExactKeys(value, expected, label) {
  sidecarAssert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value);
  for (const key of actual) sidecarAssert(expected.has(key), `${label} contains unsupported field ${key}`);
  for (const key of expected) sidecarAssert(Object.hasOwn(value, key), `${label}.${key} is required`);
}

function sameSets(leftIterable, rightIterable) {
  const left = new Set(leftIterable);
  const right = new Set(rightIterable);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableStat(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
    before.mtimeMs === after.mtimeMs;
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sidecarAssert(condition, message) {
  if (!condition) throw new Error(`Real-model reliability sidecar rejected: ${message}.`);
}
