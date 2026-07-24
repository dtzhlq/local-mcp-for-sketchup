import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { validateAuditChain } from '../scripts/run-independent-agent-compatibility-probe.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(projectRoot, 'docs', 'evidence', 'independent-agent-compatibility-evidence-2026-07-23.json');
const outputDir = path.join(projectRoot, 'output', 'agent-compatibility', 'independent-codex-probe-2026-07-23-v1');
const evidenceSchema = JSON.parse(await fs.readFile(
  path.join(projectRoot, 'schema', 'independent-agent-compatibility-evidence-v1.schema.json'),
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
assert.equal(evidence.observed_workflow.ambiguous_edit_execution_allowed, false);
assert.equal(evidence.hard_gates.wrong_object_automatic_execution, 0);
assert.equal(evidence.hard_gates.unauthorized_s2_s4_execution, 0);
assert.equal(evidence.hard_gates.duplicate_request_duplicate_modification, 0);
assert.equal(evidence.release_acceptance, false);

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
assert.equal(response.ambiguous_task_state, auditEvents[3].task_state);

const transcriptText = await fs.readFile(path.join(outputDir, 'agent-events.jsonl'), 'utf8');
const transcriptEvents = parseJsonLines(transcriptText);
const completedCommands = transcriptEvents.filter((event) => (
  event?.type === 'item.completed' && event?.item?.type === 'command_execution'
));
assert.equal(completedCommands.length, 4);
assert.equal(completedCommands.every((event) => event.item.command.includes('independent-agent-probe-tool.mjs')), true);
assert.equal(/approval_token|hmac_sha256:|session_secret/i.test(
  `${auditText}\n${transcriptText}\n${JSON.stringify(response)}`
), false);

rejectEvidence('release acceptance elevation', (value) => { value.release_acceptance = true; });
rejectEvidence('queue call', (value) => { value.isolation.queue_called = true; });
rejectEvidence('live SketchUp claim', (value) => { value.scope.live_sketchup = true; });
rejectEvidence('multi-vendor claim', (value) => { value.scope.multi_vendor = true; });
rejectEvidence('vendor diversification claim', (value) => { value.agent.vendor_diversification_proven = true; });
rejectEvidence('model diversification claim', (value) => { value.agent.model_diversification_proven = true; });
rejectEvidence('model revision drift', (value) => { value.fixture.revision_unchanged = false; });
rejectEvidence('ambiguous execution allowed', (value) => { value.observed_workflow.ambiguous_edit_execution_allowed = true; });
rejectEvidence('unauthorized execution', (value) => { value.hard_gates.unauthorized_s2_s4_execution = 1; });
rejectEvidence('wrong event count', (value) => { value.audit.event_count = 3; });
rejectEvidence('malformed transcript hash', (value) => { value.audit.transcript_sha256 = 'not-a-hash'; });
rejectEvidence('unexpected field', (value) => { value.untrusted_extension = true; });

process.stdout.write(`${JSON.stringify({
  ok: true,
  independent_process: evidence.agent.independent_process,
  gateway_events: auditEvents.length,
  exact_replay: auditEvents[1].idempotent_replay,
  resume_same_task: auditEvents[2].task_id === auditEvents[0].task_id,
  ambiguous_edit_awaiting_input: auditEvents[3].task_state === 'awaiting_input',
  model_revision_unchanged: evidence.fixture.revision_unchanged,
  hash_chain_valid: true,
  artifact_hashes_valid: evidence.artifacts.length,
  sensitive_material_exposed: false,
  rejected_invalid_evidence: 12,
  release_acceptance: false
}, null, 2)}\n`);

function rejectEvidence(label, mutate) {
  const candidate = structuredClone(evidence);
  mutate(candidate);
  assert.equal(validateEvidence(candidate), false, `${label} must fail schema validation`);
}

function parseJsonLines(value) {
  return String(value).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function hashBytes(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}
