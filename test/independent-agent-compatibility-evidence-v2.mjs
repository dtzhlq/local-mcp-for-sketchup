import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateAuditChain } from '../scripts/run-independent-agent-compatibility-probe.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  projectRoot,
  'docs',
  'evidence',
  'independent-agent-compatibility-evidence-v2-2026-07-23.json'
);
const outputDir = path.join(
  projectRoot,
  'output',
  'agent-compatibility',
  'independent-codex-probe-2026-07-23-v2'
);
const evidenceSchema = JSON.parse(await fs.readFile(
  path.join(projectRoot, 'schema', 'independent-agent-compatibility-evidence-v2.schema.json'),
  'utf8'
));
const responseSchema = JSON.parse(await fs.readFile(
  path.join(projectRoot, 'schema', 'independent-agent-probe-response-v1.schema.json'),
  'utf8'
));
const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { 'date-time': true } });
const validateEvidence = ajv.compile(evidenceSchema);
const validateResponse = ajv.compile(responseSchema);
const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
assert.equal(evidence.fixture.revision_before, evidence.fixture.revision_after);
assert.equal(evidence.agent.fixture_diversification_proven, true);
assert.equal(evidence.agent.vendor_diversification_proven, false);
assert.equal(evidence.agent.model_diversification_proven, false);
assert.equal(evidence.observed_workflow.ambiguous_edit_execution_allowed, false);
assert.equal(evidence.aggregate.fixture_count, 2);
assert.equal(evidence.aggregate.independent_process_runs, 2);
assert.equal(evidence.aggregate.gateway_event_count, 8);
assert.deepEqual(evidence.hard_gates, {
  wrong_object_automatic_execution: 0,
  unauthorized_s2_s4_execution: 0,
  duplicate_request_duplicate_modification: 0
});
assert.equal(evidence.release_acceptance, false);

const priorEvidencePath = path.join(projectRoot, evidence.prior_fixture_evidence.path);
const priorEvidenceBytes = await fs.readFile(priorEvidencePath);
assert.equal(hashBytes(priorEvidenceBytes), evidence.prior_fixture_evidence.sha256);

for (const artifact of evidence.artifacts) {
  const bytes = await fs.readFile(path.join(outputDir, artifact.name));
  assert.equal(bytes.length, artifact.bytes, `${artifact.name} byte count drifted`);
  assert.equal(hashBytes(bytes), artifact.sha256, `${artifact.name} hash drifted`);
}

const auditText = await fs.readFile(path.join(outputDir, 'gateway-audit.jsonl'), 'utf8');
const auditEvents = parseJsonLines(auditText);
assert.equal(validateAuditChain(auditEvents), true);
assert.deepEqual(auditEvents.map((event) => event.tool), evidence.audit.expected_sequence);
assert.equal(auditEvents.every((event) => event.trusted_profile === 'L0'), true);
assert.equal(auditEvents.some((event) => event.runtime === 'queue'), false);
assert.equal(auditEvents[0].task_id, auditEvents[1].task_id);
assert.equal(auditEvents[0].task_id, auditEvents[2].task_id);
assert.equal(auditEvents[1].idempotent_replay, true);
assert.equal(auditEvents[3].task_state, 'awaiting_input');
assert.equal(auditEvents[0].requested_args_hash, auditEvents[1].requested_args_hash);
assert.equal(auditEvents[0].dispatched_args_hash, auditEvents[1].dispatched_args_hash);

const response = JSON.parse(await fs.readFile(path.join(outputDir, 'agent-final.json'), 'utf8'));
assert.equal(validateResponse(response), true, JSON.stringify(validateResponse.errors));
assert.equal(response.understand_task_id, auditEvents[0].task_id);
assert.equal(response.replay_task_id, auditEvents[1].task_id);
assert.equal(response.resumed_task_id, auditEvents[2].task_id);
assert.equal(response.ambiguous_task_id, auditEvents[3].task_id);
assert.equal(response.ambiguous_task_state, 'awaiting_input');
assert.equal(response.stopped_before_execution, true);

const transcriptText = await fs.readFile(path.join(outputDir, 'agent-events.jsonl'), 'utf8');
const transcriptEvents = parseJsonLines(transcriptText);
const completedCommands = transcriptEvents.filter((event) => (
  event?.type === 'item.completed' && event?.item?.type === 'command_execution'
));
assert.equal(completedCommands.length, 4);
assert.equal(
  completedCommands.every((event) => event.item.command.includes('independent-agent-probe-tool.mjs')),
  true
);
assert.equal(/approval_token|hmac_sha256:|session_secret/i.test(
  `${auditText}\n${transcriptText}\n${JSON.stringify(response)}`
), false);

for (const [label, mutate] of [
  ['release acceptance elevation', (value) => { value.release_acceptance = true; }],
  ['queue call', (value) => { value.isolation.queue_called = true; }],
  ['live SketchUp claim', (value) => { value.scope.live_sketchup = true; }],
  ['multi-vendor claim', (value) => { value.scope.multi_vendor = true; }],
  ['vendor diversification claim', (value) => { value.agent.vendor_diversification_proven = true; }],
  ['model diversification claim', (value) => { value.agent.model_diversification_proven = true; }],
  ['fixture diversification removal', (value) => { value.agent.fixture_diversification_proven = false; }],
  ['model revision drift', (value) => { value.fixture.revision_unchanged = false; }],
  ['ambiguous execution allowed', (value) => { value.observed_workflow.ambiguous_edit_execution_allowed = true; }],
  ['unauthorized execution', (value) => { value.hard_gates.unauthorized_s2_s4_execution = 1; }],
  ['aggregate wrong object execution', (value) => { value.aggregate.wrong_object_automatic_execution = 1; }],
  ['wrong fixture count', (value) => { value.aggregate.fixture_count = 1; }],
  ['invalid prior hash format', (value) => { value.prior_fixture_evidence.sha256 = 'sha256:not-a-digest'; }],
  ['wrong event count', (value) => { value.audit.event_count = 3; }],
  ['unexpected field', (value) => { value.untrusted_extension = true; }]
]) {
  const candidate = structuredClone(evidence);
  mutate(candidate);
  assert.equal(validateEvidence(candidate), false, `${label} must fail schema validation`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  independent_process_runs: evidence.aggregate.independent_process_runs,
  fixture_families: evidence.aggregate.fixture_count,
  gateway_events: evidence.aggregate.gateway_event_count,
  exact_replay: auditEvents[1].idempotent_replay,
  resume_same_task: auditEvents[2].task_id === auditEvents[0].task_id,
  shared_component_ambiguity_awaiting_input: auditEvents[3].task_state === 'awaiting_input',
  model_revision_unchanged: evidence.fixture.revision_unchanged,
  hash_chain_valid: true,
  artifact_hashes_valid: evidence.artifacts.length,
  sensitive_material_exposed: false,
  hard_gates: evidence.hard_gates,
  rejected_invalid_evidence: 15,
  live_queue_called: false,
  release_acceptance: false
}, null, 2)}\n`);

function parseJsonLines(value) {
  return String(value).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function hashBytes(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}
