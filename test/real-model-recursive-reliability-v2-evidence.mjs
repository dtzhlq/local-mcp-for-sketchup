import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { REAL_MODEL_TARGET_REVIEW_VERSION } from '../src/real-model-target-review.mjs';
import { REAL_MODEL_RECURSIVE_TARGET_REVIEW_VERSION } from '../src/real-model-recursive-target-review.mjs';
import { REAL_MODEL_RELIABILITY_EXECUTION_PLAN_VERSION } from '../src/real-model-reliability-plan.mjs';
import {
  PORTAL_BOOLEAN_BINDING,
  PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE,
  PORTAL_BOOLEAN_LIVE_VERSION
} from '../scripts/run-real-model-boolean-live.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = 'docs/evidence/real-model-recursive-reliability-v2-mock-evidence.json';
const EXPECTED_HASH_PATHS = Object.freeze([
  'schema/approval-challenge-v1.schema.json',
  'schema/real-model-recursive-target-review-v2.schema.json',
  'schema/real-model-reliability-execution-plan-v3.schema.json',
  'schema/real-model-target-review-v2.schema.json',
  'scripts/run-real-model-boolean-live.mjs',
  'src/approval-tokens.mjs',
  'src/existing-model-editing.mjs',
  'src/real-model-recursive-target-review.mjs',
  'src/real-model-reliability-plan.mjs',
  'src/real-model-target-review.mjs',
  'test/fixtures/portal-boolean-live-witness.v3.json',
  'test/real-model-boolean-live.mjs',
  'test/real-model-recursive-reliability-v2-evidence.mjs',
  'test/real-model-recursive-target-review.mjs',
  'test/real-model-reliability-plan.mjs',
  'test/real-model-target-review.mjs'
]);
const TEST_SPECS = Object.freeze([
  {
    key: 'target_review',
    path: 'test/real-model-target-review.mjs',
    assertions: 40
  },
  {
    key: 'recursive_review',
    path: 'test/real-model-recursive-target-review.mjs',
    assertions: 146
  },
  {
    key: 'reliability_plan',
    path: 'test/real-model-reliability-plan.mjs',
    assertions: 129
  },
  {
    key: 'portal_boolean_disclosure',
    path: 'test/real-model-boolean-live.mjs',
    assertions: 193
  }
]);

const evidence = JSON.parse(await fs.readFile(path.join(repoRoot, evidencePath), 'utf8'));
assert.equal(evidence.version, 'real-model-recursive-reliability-evidence.v2');
assert.equal(evidence.kind, 'real_model_recursive_reliability_v2_mock_evidence');
assert.equal(evidence.runtime, 'offline');
assert.equal(evidence.result, 'pass');

assert.equal(evidence.contracts.target_review.version, REAL_MODEL_TARGET_REVIEW_VERSION);
assert.equal(evidence.contracts.recursive_review.version, REAL_MODEL_RECURSIVE_TARGET_REVIEW_VERSION);
assert.equal(evidence.contracts.reliability_plan.version, REAL_MODEL_RELIABILITY_EXECUTION_PLAN_VERSION);
assert.equal(evidence.contracts.portal_boolean_approval.workflow_version, PORTAL_BOOLEAN_LIVE_VERSION);
assert.deepEqual(
  evidence.contracts.portal_boolean_approval.geometry_disclosure,
  PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE
);
assert.deepEqual(evidence.contracts.portal_boolean_approval.pinned_pair, {
  target_path: PORTAL_BOOLEAN_BINDING.target_path,
  tool_path: PORTAL_BOOLEAN_BINDING.tool_path
});
assert.equal(
  evidence.contracts.portal_boolean_approval.primary_readonly_review_sha256,
  `sha256:${PORTAL_BOOLEAN_BINDING.artifacts.review.sha256}`
);
assert.equal(evidence.contracts.portal_boolean_approval.review_lineage.recommendation, 'server_recommended');
assert.equal(evidence.contracts.portal_boolean_approval.review_lineage.bbox_relation, 'containment');
assert.equal(evidence.contracts.portal_boolean_approval.review_lineage.positive_bbox_overlap, true);
assert.deepEqual(
  evidence.contracts.portal_boolean_approval.review_lineage.exact_solid_overlap,
  PORTAL_BOOLEAN_GEOMETRY_DISCLOSURE.exact_solid_overlap
);
assert.equal(evidence.contracts.portal_boolean_approval.review_lineage.atomic_boolean_trial_eligible, true);
assert.equal(evidence.contracts.portal_boolean_approval.review_lineage.role_provenance,
  'server_geometric_ranking_untrusted_unapproved');
assert.deepEqual(evidence.contracts.portal_boolean_approval.superseded_workflow_versions,
  ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7']);
assert.deepEqual(evidence.contracts.portal_boolean_approval.historical_witnesses, [
  { version: 'portal-structure-s3-boolean-witness.v1', lineage_only: true, approval_reusable: false, task_reusable: false },
  { version: 'portal-structure-s3-boolean-witness.v2', lineage_only: true, approval_reusable: false, task_reusable: false }
]);

assert.deepEqual(evidence.geometry_boundary.exact_solid_overlap_preapply, {
  status: 'unverified_before_atomic_trial',
  verified: false,
  verification_stage: 'review_gated_atomic_apply'
});
assert.equal(evidence.contracts.reliability_plan.execution_disposition,
  'awaiting_local_approval_for_atomic_trial');
assert.equal(evidence.contracts.reliability_plan.executable_now, false);
assert.equal(evidence.atomic_trial_boundary.success_preconditions.atomic_split_success_required, true);
assert.equal(evidence.atomic_trial_boundary.success_preconditions.target_exact_volume_reduction_required, true);
assert.equal(evidence.atomic_trial_boundary.success_preconditions.result_manifold_required, true);
assert.equal(evidence.atomic_trial_boundary.failure_disposition, 'abort_before_commit');
assert.equal(evidence.atomic_trial_boundary.commit_before_all_success_preconditions, false);
assert.equal(evidence.queue_boundary.live_queue_called, false);
assert.equal(evidence.queue_boundary.queue_requests_created, 0);
assert.equal(evidence.authorization_boundary.agent_self_approval_accepted, false);
assert.equal(evidence.authorization_boundary.mutation_authorized, false);
assert.equal(evidence.release_boundary.release_acceptance, false);

const hashPaths = Object.keys(evidence.hashes).sort();
assert.deepEqual(hashPaths, [...EXPECTED_HASH_PATHS].sort());
let schemaHashBindings = 0;
let sourceHashBindings = 0;
for (const relativePath of hashPaths) {
  const expected = evidence.hashes[relativePath];
  assert.match(expected, /^sha256:[0-9a-f]{64}$/, `invalid SHA-256 binding for ${relativePath}`);
  const absolutePath = safeRepoFile(relativePath);
  const actual = `sha256:${crypto.createHash('sha256').update(await fs.readFile(absolutePath)).digest('hex')}`;
  assert.equal(actual, expected, `current file hash drifted for ${relativePath}`);
  if (relativePath.startsWith('schema/')) {
    const schema = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
    new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
    schemaHashBindings += 1;
  }
  if (relativePath.startsWith('src/') || relativePath.startsWith('scripts/')) sourceHashBindings += 1;
}
assert.equal(schemaHashBindings, evidence.hash_summary.schema_hash_bindings);
assert.equal(sourceHashBindings, evidence.hash_summary.source_hash_bindings);
assert.equal(hashPaths.length, evidence.hash_summary.total_hash_bindings);

for (const spec of TEST_SPECS) {
  assert.equal(evidence.tests[spec.key].command, `node ${spec.path}`);
  assert.equal(evidence.tests[spec.key].assertions, spec.assertions);
}

const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-recursive-reliability-v2-evidence-'));
try {
  const results = await Promise.all(TEST_SPECS.map(async (spec, index) => {
    const queueStatePath = path.join(stateRoot, `queue-must-not-exist-${index}`);
    const result = await runJsonTest(spec.path, queueStatePath);
    assert.equal(await exists(queueStatePath), false,
      `${spec.path} created queue state during offline evidence verification`);
    return { spec, result };
  }));
  for (const { spec, result } of results) {
    assert.equal(result.ok, true, `${spec.path} failed`);
    assert.equal(result.assertions, spec.assertions, `${spec.path} assertion count drifted`);
  }
  const target = results.find((entry) => entry.spec.key === 'target_review').result;
  assert.equal(target.default_live_queue_called, false);
  assert.equal(target.fake_forbidden_live_calls, 0);
  const recursive = results.find((entry) => entry.spec.key === 'recursive_review').result;
  assert.equal(recursive.queue_requests_created, 0);
  assert.equal(recursive.deterministic, true);
  const plan = results.find((entry) => entry.spec.key === 'reliability_plan').result;
  assert.equal(plan.cli_live_queue_called, false);
  assert.equal(plan.mutation_authorized, false);
  assert.equal(plan.release_acceptance, false);
  const portal = results.find((entry) => entry.spec.key === 'portal_boolean_disclosure').result;
  assert.equal(portal.live_queue_called, false);
  assert.equal(portal.live_mutation_performed, false);
  assert.equal(portal.unapproved_end_to_end_queue_calls, 0);
  assert.equal(portal.forged_approval_end_to_end_queue_calls, 0);
  assert.equal(portal.duplicate_apply_mutation_count, 0);
  assert.equal(portal.sensitive_fields_exposed, false);
  assert.equal(portal.pinned_post_restart_review, PORTAL_BOOLEAN_BINDING.artifacts.review.sha256);
  assert.deepEqual(portal.pinned_pair, [PORTAL_BOOLEAN_BINDING.target_path, PORTAL_BOOLEAN_BINDING.tool_path]);
  assert.equal(portal.superseded_v7_task_end_to_end_queue_calls, 0);
  assert.equal(portal.negative_witness_cases, evidence.tests.portal_boolean_disclosure.negative_witness_cases);
} finally {
  await fs.rm(stateRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  target_review_assertions: evidence.tests.target_review.assertions,
  recursive_review_assertions: evidence.tests.recursive_review.assertions,
  reliability_plan_assertions: evidence.tests.reliability_plan.assertions,
  portal_boolean_assertions: evidence.tests.portal_boolean_disclosure.assertions,
  hash_bindings_checked: hashPaths.length,
  schema_hash_bindings: schemaHashBindings,
  source_hash_bindings: sourceHashBindings,
  queue_requests_created: 0,
  mutation_authorized: false,
  exact_solid_overlap_preapply_verified: false,
  atomic_trial_failure_disposition: 'abort_before_commit',
  release_acceptance: false
}, null, 2)}\n`);

function safeRepoFile(relativePath) {
  assert.equal(typeof relativePath, 'string');
  assert.equal(path.isAbsolute(relativePath), false, `absolute hash path rejected: ${relativePath}`);
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  assert.equal(relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative), true,
    `hash path escapes repository: ${relativePath}`);
  return absolutePath;
}

async function runJsonTest(relativePath, statePath) {
  const { stdout } = await execFileAsync(process.execPath, [path.join(repoRoot, relativePath)], {
    cwd: repoRoot,
    env: { ...process.env, ALMA_SKETCHUP_STATE_DIR: statePath }
  });
  return JSON.parse(stdout);
}

function exists(targetPath) {
  return fs.access(targetPath).then(() => true, () => false);
}
