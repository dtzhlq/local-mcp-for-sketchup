import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertNoSensitivePublicEvidence } from '../scripts/run-current-source-agent-readonly-live.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [evidence, schema] = await Promise.all([
  readJson('docs/evidence/current-source-agent-bounded-group-live-evidence-2026-07-21.json'),
  readJson('schema/current-source-agent-bounded-group-live-evidence-v1.schema.json')
]);
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validate = ajv.compile(schema);
let assertions = 0;

assert.equal(validate(evidence), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
assert.doesNotThrow(() => assertNoSensitivePublicEvidence(evidence)); assertions += 1;
assert.equal(new Set(evidence.source_bindings.map((entry) => entry.path)).size, evidence.source_bindings.length); assertions += 1;
assert.equal(evidence.source_binding_status, 'historical_exact_source_snapshot'); assertions += 1;
assert.equal(evidence.superseded_by, 'docs/evidence/current-source-reviewed-plan-live-evidence-2026-07-21.json'); assertions += 1;
await fs.access(path.join(repoRoot, evidence.superseded_by)); assertions += 1;
assert.equal(evidence.acceptance.capture_time_current_source, true); assertions += 1;
assert.equal(evidence.acceptance.current_acceptance, false); assertions += 1;

assert.equal(evidence.model.revision_indexed, evidence.model.revision_total_seen); assertions += 1;
assert.equal(evidence.model.group_occurrences, evidence.target_discovery.projection.indexed); assertions += 1;
assert.equal(evidence.target_discovery.full_model_graph_complete, false); assertions += 1;
assert.deepEqual(evidence.target_discovery.full_model_graph_blockers, ['recursive_index_not_requested']); assertions += 1;
assert.equal(evidence.target_discovery.projection.complete, true); assertions += 1;
assert.equal(evidence.target_discovery.projection.leaf_entities_materialized, false); assertions += 1;
assert.equal(evidence.target_discovery.projection.proposal_only, true); assertions += 1;
assert.equal(evidence.target_discovery.projection.execution_allowed, false); assertions += 1;
assert.equal(evidence.target_discovery.model_graph.occurrences, 41); assertions += 1;
assert.equal(evidence.target_discovery.model_graph.faces, 0); assertions += 1;
assert.equal(evidence.target_discovery.model_graph.edges, 0); assertions += 1;
assert.equal(evidence.proposal.task_state, 'awaiting_review'); assertions += 1;
assert.equal(evidence.proposal.selected_target_count, 1); assertions += 1;
assert.equal(evidence.proposal.execution_allowed, false); assertions += 1;
assert.equal(evidence.proposal.risk_level, 'S2'); assertions += 1;
assert.equal(evidence.proposal.approval_requested, false); assertions += 1;
assert.equal(evidence.proposal.mutation_performed, false); assertions += 1;
assert.equal(evidence.timing.performance_guarantee, false); assertions += 1;
assert.equal(evidence.safety.final_queue + evidence.safety.final_processing + evidence.safety.final_responses, 0); assertions += 1;
assert.equal(evidence.safety.final_lock_exists, false); assertions += 1;
assert.equal(evidence.acceptance.partial_graph_not_overclaimed_as_complete, true); assertions += 1;
assert.equal(evidence.acceptance.full_recursive_large_model_proposal, false); assertions += 1;
assert.equal(evidence.acceptance.live_mutation, false); assertions += 1;
assert.equal(evidence.acceptance.release_acceptance, false); assertions += 1;

const runRoot = 'output/live-validation/agent-gateway-readonly/trimble-s6-bounded-largest-group-2026-07-21';
const localArtifacts = [
  [`${runRoot}/report.json`, evidence.capture_artifact_hashes.public_report],
  [`${runRoot}/private/proposal-projection.json`, evidence.capture_artifact_hashes.private_proposal_projection],
  [`${runRoot}/private/agent-contract/model-graphs/models/model_33d1721434854243cbe78a2af86faead/graphs/model-graph-1d7521f51e797509a4334900.json`, evidence.capture_artifact_hashes.private_model_graph],
  [`${runRoot}/private/handshake-before.json`, evidence.capture_artifact_hashes.private_handshake_before],
  [`${runRoot}/private/handshake-after.json`, evidence.capture_artifact_hashes.private_handshake_after]
];
let localCaptureArtifactsVerified = 0;
for (const [relativePath, expected] of localArtifacts) {
  try {
    assert.equal(await sha256File(relativePath), expected.slice('sha256:'.length)); assertions += 1;
    localCaptureArtifactsVerified += 1;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
assert.ok([0, localArtifacts.length].includes(localCaptureArtifactsVerified), 'local capture verification must be all-or-none'); assertions += 1;

if (localCaptureArtifactsVerified === localArtifacts.length) {
  const [report, projection, graph] = await Promise.all([
    readJson(localArtifacts[0][0]),
    readJson(localArtifacts[1][0]),
    readJson(localArtifacts[2][0])
  ]);
  assert.equal(report.result, 'pass'); assertions += 1;
  assert.equal(report.safety.mutation_performed, false); assertions += 1;
  assert.equal(projection.result.target_discovery.mode, 'structural_groups'); assertions += 1;
  assert.equal(projection.result.target_discovery.leaf_entities_materialized, false); assertions += 1;
  assert.equal(projection.result.proposal.target_resolution.coverage.mode, 'complete_structural_group_projection'); assertions += 1;
  assert.equal(projection.result.proposal.selected_targets[0].entity_path, evidence.proposal.selected_target.entity_path); assertions += 1;
  assert.equal(graph.completeness.complete, false); assertions += 1;
  assert.equal(graph.projections.structural_groups.complete, true); assertions += 1;
  const selectedNode = graph.nodes.find((node) => node.entity_path === evidence.proposal.selected_target.entity_path);
  assert.equal(selectedNode.editable, false); assertions += 1;
  assert.equal(selectedNode.proposal_eligible, true); assertions += 1;
  assert.equal(selectedNode.projection_source, 'structural-groups.v1'); assertions += 1;
}

const negativeCases = [
  mutate(evidence, (value) => { value.target_discovery.full_model_graph_complete = true; }),
  mutate(evidence, (value) => { value.target_discovery.full_model_graph_blockers = []; }),
  mutate(evidence, (value) => { value.target_discovery.projection.complete = false; }),
  mutate(evidence, (value) => { value.target_discovery.projection.leaf_entities_materialized = true; }),
  mutate(evidence, (value) => { value.target_discovery.projection.proposal_only = false; }),
  mutate(evidence, (value) => { value.target_discovery.model_graph.faces = 1; }),
  mutate(evidence, (value) => { value.proposal.execution_allowed = true; }),
  mutate(evidence, (value) => { value.proposal.selected_target_count = 0; }),
  mutate(evidence, (value) => { value.safety.mutation_performed = true; }),
  mutate(evidence, (value) => { value.safety.final_responses = 1; }),
  mutate(evidence, (value) => { value.acceptance.full_recursive_large_model_proposal = true; }),
  mutate(evidence, (value) => { value.acceptance.current_acceptance = true; }),
  mutate(evidence, (value) => { value.acceptance.release_acceptance = true; })
];
for (const invalid of negativeCases) {
  assert.equal(validate(invalid), false, 'unsafe or overclaimed bounded Group evidence must fail schema validation'); assertions += 1;
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidence_scope: evidence.evidence_scope,
  revision_occurrences: evidence.model.revision_total_seen,
  projected_groups: evidence.target_discovery.projection.indexed,
  leaf_entities_materialized: false,
  full_model_graph_complete: false,
  selected_for_review_only: true,
  mutation_performed: false,
  local_capture_artifacts_verified: localCaptureArtifactsVerified,
  negative_cases: negativeCases.length,
  assertions
}, null, 2)}\n`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

async function sha256File(relativePath) {
  return crypto.createHash('sha256').update(await fs.readFile(path.join(repoRoot, relativePath))).digest('hex');
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
