import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST,
  loadRealModelReliabilitySidecars
} from '../src/real-model-reliability-sidecars.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-real-model-sidecars-'));
let assertionCount = 0;
let loaderNegativeCount = 0;
let schemaNegativeCount = 0;
let ignoredOutputLineageVerified = false;
let mockEvidenceBindingsVerified = 0;

try {
  const [sidecarSchema, manifestSchema, manifest] = await Promise.all([
    readRepoJson('schema/real-model-reliability-sidecar-v1.schema.json'),
    readRepoJson('schema/real-model-reliability-sidecar-manifest-v1.schema.json'),
    readRepoJson(DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST)
  ]);
  const mockEvidence = await readRepoJson('docs/evidence/real-model-reliability-sidecars-v1-mock-evidence.json');
  const validateSidecar = (value) => validateSchemaSubset(sidecarSchema, value);
  const validateManifest = (value) => validateSchemaSubset(manifestSchema, value);
  trace('schemas-loaded');

  let validation = validateManifest(manifest);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assertionCount += 1;
  assert.equal(manifest.cases.length, 7);
  assert.equal(new Set(manifest.cases.map((entry) => entry.case_id)).size, 7);
  assertionCount += 2;
  assert.equal(mockEvidence.version, 'real-model-reliability-sidecars-v1-mock-evidence.1');
  assert.equal(mockEvidence.kind, 'real_model_reliability_sidecars_mock_evidence');
  assert.equal(mockEvidence.result.case_count, 7);
  assert.equal(mockEvidence.result.blocked_cases, 7);
  assert.equal(mockEvidence.result.execution_eligible_cases, 0);
  assert.equal(mockEvidence.result.native_mutation_successes, 0);
  assert.equal(mockEvidence.result.live_queue_called, false);
  assert.equal(mockEvidence.result.model_files_read, 0);
  assertionCount += 8;
  for (const binding of Object.values(mockEvidence.bindings)) {
    const bytes = await fs.readFile(path.join(repoRoot, binding.path));
    assert.equal(`sha256:${sha256(bytes)}`, binding.sha256);
    assertionCount += 1;
    mockEvidenceBindingsVerified += 1;
  }
  assert.deepEqual(
    mockEvidence.source_hashes,
    Object.fromEntries(Object.values(mockEvidence.bindings).map((binding) => [binding.path, binding.sha256]))
  );
  assertionCount += 1;

  const sidecars = [];
  for (const binding of manifest.cases) {
    trace(`static-read-start:${binding.case_id}`);
    const bytes = await fs.readFile(path.join(repoRoot, binding.path));
    trace(`static-read-complete:${binding.case_id}`);
    const sidecar = JSON.parse(bytes.toString('utf8'));
    sidecars.push(sidecar);
    validation = validateSidecar(sidecar);
    trace(`static-schema-complete:${binding.case_id}`);
    assert.equal(validation.valid, true,
      `${binding.case_id}: ${JSON.stringify(validation.errors)}`);
    assert.equal(`sha256:${sha256(bytes)}`, binding.sha256);
    assert.equal(JSON.stringify(sidecar).toLowerCase().includes('.skp'), false,
      `${binding.case_id} sidecar must not contain a model path`);
    assertionCount += 3;
  }
  trace('static-sidecars-validated');

  const result = await loadRealModelReliabilitySidecars({ rootDir: repoRoot });
  trace('production-loader-positive');
  assert.equal(result.ok, true);
  assert.equal(result.runtime, 'offline');
  assert.equal(result.live_queue_called, false);
  assert.equal(result.model_files_read, 0);
  assert.equal(result.mutation_authorized, false);
  assert.equal(result.release_acceptance, false);
  assert.deepEqual(result.summary, {
    case_count: 7,
    blocked_cases: 7,
    execution_eligible_cases: 0,
    native_mutation_successes: 0
  });
  assertionCount += 7;
  assert.equal(result.io_audit.model_files_read, 0);
  assert.equal(result.io_audit.queue_calls, 0);
  assert.equal(result.io_audit.artifact_copies, 0);
  assert.equal(result.io_audit.model_mutations, 0);
  assert.equal(result.io_audit.json_files_read.every((entry) => entry.endsWith('.json')), true);
  assert.equal(result.io_audit.json_files_read.some((entry) => /\.(?:skp|skb)$/i.test(entry)), false);
  assertionCount += 6;

  const sourceSnapshot = await readRepoJson('docs/evidence/real-model-reliability-sidecar-source-v1.json');
  assert.equal(sourceSnapshot.source_lineage.review_aggregate.runtime_dependency, false);
  assertionCount += 1;
  try {
    const aggregatePath = path.join(repoRoot, sourceSnapshot.source_lineage.review_aggregate.path);
    const aggregateBytes = await fs.readFile(aggregatePath);
    assert.equal(`sha256:${sha256(aggregateBytes)}`, sourceSnapshot.source_lineage.review_aggregate.sha256);
    const aggregate = JSON.parse(aggregateBytes.toString('utf8'));
    assert.deepEqual(sourceSnapshot.case_reviews, normalizeAggregateCases(aggregate));
    assertionCount += 2;
    ignoredOutputLineageVerified = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const byCase = new Map(result.cases.map((entry) => [entry.case_id, entry]));
  assert.equal(byCase.size, 7);
  assert.equal(byCase.get('product-boolean-manifold').tasks[0].status, 'blocked');
  assert.equal(byCase.get('deep-shared-components').tasks[0].status, 'read_only_observed');
  assert.equal(byCase.get('scaled-mirrored-locked').tasks[2].status, 'read_only_observed');
  assert.equal(result.cases.flatMap((entry) => entry.tasks).some((task) => task.native_success), false);
  assertionCount += 5;
  const deepSharedSidecar = sidecars.find((entry) => entry.case_id === 'deep-shared-components');
  const portalFailureBinding = deepSharedSidecar.evidence_bindings.find((entry) => entry.id === 'portal_v8_failure');
  assert(portalFailureBinding);
  assert.equal(portalFailureBinding.path,
    'docs/evidence/portal-boolean-v8-failure-evidence-2026-07-21.json');
  assert.equal(portalFailureBinding.evidence_class, 'failed_precommit_live_attempt');
  assert.equal(deepSharedSidecar.task_assessments.some((entry) =>
    entry.evidence_ids.includes('portal_v8_failure')), false);
  assert.equal(result.io_audit.json_files_read.includes(portalFailureBinding.path), true);
  assertionCount += 5;

  const invalidSidecars = [
    mutate(sidecars[0], (value) => { value.unexpected = true; }),
    mutate(sidecars[0], (value) => { value.readiness.release_acceptance = true; }),
    mutate(sidecars[0], (value) => { value.evidence_bindings[0].path = 'test/模型/model.skp'; }),
    mutate(sidecars[0], (value) => { value.task_assessments[0].native_success = true; }),
    mutate(sidecars[0], (value) => { value.validation_policy.queue_access = true; })
  ];
  for (const invalid of invalidSidecars) {
    assert.equal(validateSidecar(invalid).valid, false, 'sidecar schema accepted an unsafe mutation');
    assertionCount += 1;
    schemaNegativeCount += 1;
  }
  const invalidManifests = [
    mutate(manifest, (value) => { value.policy.queue_access = true; }),
    mutate(manifest, (value) => { value.cases.pop(); }),
    mutate(manifest, (value) => { value.summary.native_mutation_successes = 1; })
  ];
  for (const invalid of invalidManifests) {
    assert.equal(validateManifest(invalid).valid, false, 'manifest schema accepted an unsafe mutation');
    assertionCount += 1;
    schemaNegativeCount += 1;
  }
  trace('schema-negatives-complete');

  const baseFixture = path.join(temporaryRoot, 'base');
  await stageJsonOnlyFixture({ targetRoot: baseFixture, paths: result.io_audit.json_files_read });
  trace('base-fixture-staged');

  await expectSidecarReject('unknown sidecar field', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'architecture-golden', (value) => { value.unexpected = true; });
  });
  await expectSidecarReject('forged candidate digest', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'architecture-golden', (value) => {
      value.candidates[0].source_sha256 = `sha256:${'f'.repeat(64)}`;
    });
  });
  await expectSidecarReject('invented structural count', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'appearance-scenes-hidden', (value) => {
      value.structural_observation.uv_occurrences = 1;
    });
  });
  await expectSidecarReject('native success claim', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'product-boolean-manifold', (value) => {
      value.task_assessments[0].status = 'verified_native';
      value.task_assessments[0].native_success = true;
    });
  });
  await expectSidecarReject('removed live-contract blocker', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'interior-expression', (value) => {
      value.readiness.blockers = value.readiness.blockers.filter((entry) => entry !== 'live_execution_contract_missing');
    });
  });
  await expectSidecarReject('raw SKP evidence path', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'architecture-golden', (value) => {
      value.evidence_bindings[0].path = 'test/模型/Fire Escape.skp';
    });
  });
  await expectSidecarReject('evidence traversal', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'architecture-golden', (value) => {
      value.evidence_bindings[0].path = '../outside.json';
    });
  });
  await expectSidecarReject('evidence hash drift', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'architecture-golden', (value) => {
      value.evidence_bindings[0].sha256 = `sha256:${'0'.repeat(64)}`;
    });
  });
  await expectSidecarReject('formal task drift', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'architecture-golden', (value) => {
      value.formal_case.tasks[0] = 'boolean_manifold';
      value.task_assessments[0].task = 'boolean_manifold';
    });
  });
  await expectSidecarReject('source blocker drift', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'imported-dirty-topology', (value) => {
      value.source_blockers = ['formal_sidecar_missing'];
    });
  });
  await expectSidecarReject('removed Portal v8 failure binding', async (fixtureRoot) => {
    await mutateFixtureSidecar(fixtureRoot, 'deep-shared-components', (value) => {
      value.evidence_bindings = value.evidence_bindings.filter((entry) => entry.id !== 'portal_v8_failure');
    });
  });
  await expectSidecarReject('Portal v8 approval not consumed_failed', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.approval.status_after_failure = 'approved';
    });
  });
  await expectSidecarReject('Portal v8 approval reusable', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.approval.approval_reusable = true;
    });
  });
  await expectSidecarReject('Portal v8 same-task retry allowed', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.approval.same_task_retry_allowed = true;
    });
  });
  await expectSidecarReject('Portal v8 approval replay allowed', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.approval.previous_plan_or_approval_replay_allowed = true;
    });
  });
  await expectSidecarReject('Portal v8 mutation represented as committed', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.failure.mutation_committed = true;
    });
  });
  await expectSidecarReject('Portal v8 rollback not confirmed', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.failure.rollback_confirmed = false;
    });
  });
  await expectSidecarReject('Portal v8 abort not successful', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.failure.abort_succeeded = false;
    });
  });
  await expectSidecarReject('Portal v8 automatic replay performed', async (fixtureRoot) => {
    await mutateFixtureEvidence(fixtureRoot, 'deep-shared-components', 'portal_v8_failure', (value) => {
      value.failure.automatic_replay_performed = true;
    });
  });
  await expectSidecarReject('symlink evidence', async (fixtureRoot) => {
    const linkPath = path.join(fixtureRoot, 'test/fixtures/aggregate-link.json');
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.symlink(
      path.join(fixtureRoot, 'docs/evidence/real-model-reliability-sidecar-source-v1.json'),
      linkPath
    );
    await mutateFixtureSidecar(fixtureRoot, 'architecture-golden', (value) => {
      value.evidence_bindings[0].path = 'test/fixtures/aggregate-link.json';
    });
  });
  await expectSidecarReject('manifest queue elevation', async (fixtureRoot) => {
    const manifestPath = path.join(fixtureRoot, DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST);
    const fixtureManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    fixtureManifest.policy.queue_access = true;
    await writeJson(manifestPath, fixtureManifest);
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions: assertionCount,
    schema_negative_cases: schemaNegativeCount,
    loader_negative_cases: loaderNegativeCount,
    case_count: result.summary.case_count,
    blocked_cases: result.summary.blocked_cases,
    execution_eligible_cases: result.summary.execution_eligible_cases,
    native_mutation_successes: result.summary.native_mutation_successes,
    live_queue_called: result.live_queue_called,
    model_files_read: result.model_files_read,
    artifact_copies: result.io_audit.artifact_copies,
    model_mutations: result.io_audit.model_mutations,
    cross_version_status: manifest.policy.cross_version_status,
    ignored_output_lineage_verified: ignoredOutputLineageVerified,
    mock_evidence_bindings_verified: mockEvidenceBindingsVerified
  }, null, 2)}\n`);

  async function expectSidecarReject(label, prepare) {
    trace(`negative-start:${label}`);
    const fixtureRoot = path.join(temporaryRoot, `negative-${loaderNegativeCount}`);
    await fs.cp(baseFixture, fixtureRoot, { recursive: true, errorOnExist: true, force: false });
    await prepare(fixtureRoot);
    await assert.rejects(
      () => loadRealModelReliabilitySidecars({ rootDir: fixtureRoot }),
      /Real-model reliability sidecar rejected:/,
      label
    );
    assertionCount += 1;
    loaderNegativeCount += 1;
    trace(`negative-complete:${label}`);
  }
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

async function readRepoJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function stageJsonOnlyFixture({ targetRoot, paths }) {
  for (const relativePath of paths) {
    assert.equal(relativePath.endsWith('.json'), true);
    assert.equal(/\.(?:skp|skb)$/i.test(relativePath), false);
    assertionCount += 2;
    const source = path.join(repoRoot, relativePath);
    const target = path.join(targetRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}

async function mutateFixtureSidecar(root, caseId, callback) {
  const manifestPath = path.join(root, DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const binding = manifest.cases.find((entry) => entry.case_id === caseId);
  assert(binding, `missing fixture binding ${caseId}`);
  const sidecarPath = path.join(root, binding.path);
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
  callback(sidecar);
  const bytes = await writeJson(sidecarPath, sidecar);
  binding.sha256 = `sha256:${sha256(bytes)}`;
  await writeJson(manifestPath, manifest);
}

async function mutateFixtureEvidence(root, caseId, evidenceId, callback) {
  const manifestPath = path.join(root, DEFAULT_REAL_MODEL_RELIABILITY_SIDECAR_MANIFEST);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const manifestBinding = manifest.cases.find((entry) => entry.case_id === caseId);
  assert(manifestBinding, `missing fixture binding ${caseId}`);
  const sidecarPath = path.join(root, manifestBinding.path);
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
  const evidenceBinding = sidecar.evidence_bindings.find((entry) => entry.id === evidenceId);
  assert(evidenceBinding, `missing fixture evidence binding ${caseId}/${evidenceId}`);
  const evidencePath = path.join(root, evidenceBinding.path);
  const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  callback(evidence);
  const evidenceBytes = await writeJson(evidencePath, evidence);
  evidenceBinding.sha256 = `sha256:${sha256(evidenceBytes)}`;
  const sidecarBytes = await writeJson(sidecarPath, sidecar);
  manifestBinding.sha256 = `sha256:${sha256(sidecarBytes)}`;
  await writeJson(manifestPath, manifest);
}

async function writeJson(targetPath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.writeFile(targetPath, bytes);
  return bytes;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function mutate(value, callback) {
  const copy = structuredClone(value);
  callback(copy);
  return copy;
}

function validateSchemaSubset(schema, value) {
  const errors = [];
  visit(schema, value, '$', schema, errors);
  return { valid: errors.length === 0, errors };
}

function visit(rule, value, location, rootSchema, errors) {
  if (rule.$ref) {
    const segments = rule.$ref.replace(/^#\//, '').split('/').map((segment) =>
      segment.replaceAll('~1', '/').replaceAll('~0', '~')
    );
    let resolved = rootSchema;
    for (const segment of segments) resolved = resolved?.[segment];
    if (!resolved) {
      errors.push(`${location}: unresolved ref ${rule.$ref}`);
      return;
    }
    visit(resolved, value, location, rootSchema, errors);
    return;
  }
  if (Object.hasOwn(rule, 'const') && !schemaEqual(value, rule.const)) {
    errors.push(`${location}: const mismatch`);
    return;
  }
  if (Array.isArray(rule.enum) && !rule.enum.some((entry) => schemaEqual(entry, value))) {
    errors.push(`${location}: enum mismatch`);
    return;
  }
  if (rule.type && !matchesType(value, rule.type)) {
    errors.push(`${location}: expected ${rule.type}`);
    return;
  }
  if (typeof value === 'string') {
    if (Number.isInteger(rule.minLength) && value.length < rule.minLength) errors.push(`${location}: minLength`);
    if (Number.isInteger(rule.maxLength) && value.length > rule.maxLength) errors.push(`${location}: maxLength`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${location}: pattern`);
  }
  if (typeof value === 'number' && Number.isFinite(rule.minimum) && value < rule.minimum) {
    errors.push(`${location}: minimum`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(rule.minItems) && value.length < rule.minItems) errors.push(`${location}: minItems`);
    if (Number.isInteger(rule.maxItems) && value.length > rule.maxItems) errors.push(`${location}: maxItems`);
    if (rule.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
      errors.push(`${location}: uniqueItems`);
    }
    if (rule.items) value.forEach((entry, index) => visit(rule.items, entry, `${location}[${index}]`, rootSchema, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const required = new Set(rule.required || []);
    for (const key of required) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}.${key}: required`);
    }
    const properties = rule.properties || {};
    if (rule.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${location}.${key}: additional property`);
      }
    }
    for (const [key, propertyRule] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) visit(propertyRule, value[key], `${location}.${key}`, rootSchema, errors);
    }
  }
}

function matchesType(value, type) {
  if (Array.isArray(type)) return type.some((entry) => matchesType(value, entry));
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function schemaEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeAggregateCases(aggregate) {
  return aggregate.case_reviews.map((review) => ({
    case_id: review.case_id,
    domain: review.domain,
    mapped_candidates: review.mapped_candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      candidate_handle: candidate.candidate_handle,
      source_sha256: candidate.source_sha256,
      role: candidate.role
    })),
    structural_evidence: structuredClone(review.structural_evidence),
    blockers: [...review.blockers]
  }));
}

function trace(message) {
  if (process.env.ALMA_SIDECAR_TEST_TRACE === '1') process.stderr.write(`[sidecar-test] ${message}\n`);
}
