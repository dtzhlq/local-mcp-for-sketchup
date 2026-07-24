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
  'independent-agent-compatibility-evidence-v3-2026-07-23.json'
);
const outputDir = path.join(
  projectRoot,
  'output',
  'agent-compatibility',
  'independent-codex-probe-2026-07-23-v3'
);
const evidenceSchema = JSON.parse(await fs.readFile(
  path.join(projectRoot, 'schema', 'independent-agent-compatibility-evidence-v3.schema.json'),
  'utf8'
));
const responseSchema = JSON.parse(await fs.readFile(
  path.join(projectRoot, 'schema', 'independent-agent-image-summary-probe-response-v1.schema.json'),
  'utf8'
));
const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { 'date-time': true } });
const validateEvidence = ajv.compile(evidenceSchema);
const validateResponse = ajv.compile(responseSchema);
const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'));

assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
assert.equal(evidence.fixture.revision_before, evidence.fixture.revision_after);
assert.equal(evidence.agent.fixture_diversification_proven, true);
assert.equal(evidence.agent.workflow_diversification_proven, true);
assert.equal(evidence.agent.vendor_diversification_proven, false);
assert.equal(evidence.agent.model_diversification_proven, false);
assert.equal(evidence.scope.agent_visual_input, false);
assert.equal(evidence.scope.server_image_artifacts, true);
assert.equal(evidence.scope.local_model_files, false);
assert.equal(evidence.observed_workflow.visual_correction_awaiting_review, true);
assert.equal(evidence.observed_workflow.structured_summary_inline, true);
assert.equal(evidence.observed_workflow.image_artifact_metadata_only, true);
assert.equal(evidence.observed_workflow.correction_execution_allowed, false);
assert.equal(evidence.aggregate.fixture_count, 3);
assert.equal(evidence.aggregate.workflow_count, 2);
assert.equal(evidence.aggregate.independent_process_runs, 3);
assert.equal(evidence.aggregate.gateway_event_count, 10);
assert.equal(evidence.aggregate.image_summary_process_runs, 1);
assert.deepEqual(evidence.hard_gates, {
  wrong_object_automatic_execution: 0,
  unauthorized_s2_s4_execution: 0,
  duplicate_request_duplicate_modification: 0
});
assert.equal(evidence.release_acceptance, false);

const priorEvidencePath = path.join(projectRoot, evidence.prior_aggregate_evidence.path);
const priorEvidenceBytes = await fs.readFile(priorEvidencePath);
assert.equal(hashBytes(priorEvidenceBytes), evidence.prior_aggregate_evidence.sha256);

const expectedArtifactNames = [
  'agent-events.jsonl',
  'agent-final.json',
  'gateway-audit.jsonl'
];
assert.deepEqual(
  [...new Set(evidence.artifacts.map((artifact) => artifact.name))].sort(),
  [...expectedArtifactNames].sort()
);
for (const artifact of evidence.artifacts) {
  const bytes = await fs.readFile(path.join(outputDir, artifact.name));
  assert.equal(bytes.length, artifact.bytes, `${artifact.name} byte count drifted`);
  assert.equal(hashBytes(bytes), artifact.sha256, `${artifact.name} hash drifted`);
}

const auditText = await fs.readFile(path.join(outputDir, 'gateway-audit.jsonl'), 'utf8');
const auditEvents = parseJsonLines(auditText);
assert.equal(validateAuditChain(auditEvents), true);
assert.deepEqual(auditEvents.map((event) => event.tool), [
  'start_agent_task',
  'read_agent_artifact'
]);
assert.deepEqual(auditEvents.map((event) => event.tool), evidence.audit.expected_sequence);
assert.equal(auditEvents.every((event) => event.trusted_profile === 'L0'), true);
assert.equal(auditEvents.some((event) => event.runtime === 'queue'), false);
assert.equal(auditEvents[0].runtime, 'mock');
assert.equal(auditEvents[0].task_state, 'awaiting_review');
assert.equal(auditEvents[0].result_kind, 'reference_image_correction_result');
assert.match(auditEvents[0].full_result_artifact, /^artifact:task_[0-9a-f-]+:[0-9a-f-]+$/);
assert.equal(auditEvents[0].artifact_content_present, false);
assert.equal(auditEvents[0].artifact_content_omitted_for_capability, false);
assert.equal(auditEvents[1].task_id, auditEvents[0].task_id);
assert.equal(auditEvents[1].task_state, 'awaiting_review');
assert.equal(auditEvents[1].result_kind, 'agent_artifact_page');
assert.equal(auditEvents[1].artifact_kind, 'immutable_image_artifact');
assert.equal(auditEvents[1].artifact_encoding, 'omitted');
assert.equal(auditEvents[1].artifact_offset, 0);
assert.equal(auditEvents[1].artifact_next_offset, null);
assert.equal(auditEvents[1].artifact_total_chars, 0);
assert.equal(auditEvents[1].artifact_eof, true);
assert.equal(auditEvents[1].artifact_content_present, false);
assert.equal(auditEvents[1].artifact_content_chars, null);
assert.equal(auditEvents[1].artifact_content_omitted_for_capability, true);

const response = JSON.parse(await fs.readFile(path.join(outputDir, 'agent-final.json'), 'utf8'));
assert.equal(validateResponse(response), true, JSON.stringify(validateResponse.errors));
assert.equal(response.visual_task_id, auditEvents[0].task_id);
assert.equal(response.visual_task_state, auditEvents[0].task_state);
assert.equal(response.structured_summary_inline, true);
assert.equal(response.visual_agent_required, false);
assert.equal(response.local_files_required, false);
assert.equal(response.correction_execution_allowed, false);
assert.equal(response.image_artifact_handle, auditEvents[1].artifact_handle);
assert.equal(response.image_artifact_encoding, auditEvents[1].artifact_encoding);
assert.equal(
  response.image_content_omitted_for_capability,
  auditEvents[1].artifact_content_omitted_for_capability
);
assert.equal(response.stopped_before_execution, true);

const transcriptText = await fs.readFile(path.join(outputDir, 'agent-events.jsonl'), 'utf8');
const transcriptEvents = parseJsonLines(transcriptText);
const completedCommands = transcriptEvents.filter((event) => (
  event?.type === 'item.completed' && event?.item?.type === 'command_execution'
));
assert.equal(completedCommands.length, 2);
assert.equal(
  completedCommands.every((event) => event.item.command.includes('independent-agent-probe-tool.mjs')),
  true
);
assert.match(completedCommands[0].item.command, /\bstart_agent_task\b/);
assert.match(completedCommands[1].item.command, /\bread_agent_artifact\b/);
assert.doesNotMatch(completedCommands[0].item.command, /\.png\b|reference_image_path|capture_image_path/);
assert.doesNotMatch(completedCommands[1].item.command, /\.png\b|reference_image_path|capture_image_path/);

const startEnvelope = JSON.parse(completedCommands[0].item.aggregated_output);
const imageEnvelope = JSON.parse(completedCommands[1].item.aggregated_output);
assert.equal(startEnvelope.task_id, auditEvents[0].task_id);
assert.equal(startEnvelope.task_state, 'awaiting_review');
assert.equal(startEnvelope.result.kind, 'reference_image_correction_result');
assert.equal(startEnvelope.result.visual_agent_required, false);
assert.equal(startEnvelope.result.local_files_required, false);
assert.equal(startEnvelope.result.capture_mode, 'provided_server_artifact_only');
assert.equal(startEnvelope.result.correction_patch.risk_level, 'S2');
assert.equal(startEnvelope.result.correction_patch.execution_allowed, false);
assert.equal(startEnvelope.result.correction_patch.review_required, true);
assert.equal(Number.isFinite(startEnvelope.result.evidence.confidence), true);
assert.equal(Number.isFinite(startEnvelope.result.evidence.alignment.foreground_center_delta_norm), true);
assert.equal(Number.isFinite(startEnvelope.result.evidence.difference.mean_absolute_error), true);
assert.equal(
  startEnvelope.result.image_artifacts.overlay.handle,
  auditEvents[1].artifact_handle
);
assert.equal(imageEnvelope.task_id, auditEvents[1].task_id);
assert.equal(imageEnvelope.result.kind, 'agent_artifact_page');
assert.equal(imageEnvelope.result.artifact.kind, 'immutable_image_artifact');
assert.equal(imageEnvelope.result.artifact.encoding, 'omitted');
assert.equal(imageEnvelope.result.artifact.content_omitted_for_capability, true);
assert.equal(Object.hasOwn(imageEnvelope.result.artifact, 'content'), false);
assert.equal(imageEnvelope.result.artifact.eof, true);
assert.equal(imageEnvelope.result.artifact.total_chars, 0);

const capturedMaterial = `${auditText}\n${transcriptText}\n${JSON.stringify(response)}`;
assert.equal(/approval_token|hmac_sha256:|session_secret/i.test(capturedMaterial), false);
assert.equal(
  /\bapply_reviewed_model_edit\b|\bsubmit_agent_task_input\b|\bresume_agent_task\b|--runtime[ =]+queue/i
    .test(capturedMaterial),
  false
);

const evidenceNegativeCases = [
  ['release acceptance elevation', (value) => { value.release_acceptance = true; }],
  ['queue call', (value) => { value.isolation.queue_called = true; }],
  ['live SketchUp claim', (value) => { value.scope.live_sketchup = true; }],
  ['multi-vendor claim', (value) => { value.scope.multi_vendor = true; }],
  ['Agent visual input claim', (value) => { value.scope.agent_visual_input = true; }],
  ['server image removal', (value) => { value.scope.server_image_artifacts = false; }],
  ['local file claim', (value) => { value.scope.local_model_files = true; }],
  ['vendor diversification claim', (value) => { value.agent.vendor_diversification_proven = true; }],
  ['model diversification claim', (value) => { value.agent.model_diversification_proven = true; }],
  ['fixture diversification removal', (value) => { value.agent.fixture_diversification_proven = false; }],
  ['workflow diversification removal', (value) => { value.agent.workflow_diversification_proven = false; }],
  ['model revision drift', (value) => { value.fixture.revision_unchanged = false; }],
  ['visual review removal', (value) => { value.observed_workflow.visual_correction_awaiting_review = false; }],
  ['inline summary removal', (value) => { value.observed_workflow.structured_summary_inline = false; }],
  ['metadata-only removal', (value) => { value.observed_workflow.image_artifact_metadata_only = false; }],
  ['correction execution allowed', (value) => { value.observed_workflow.correction_execution_allowed = true; }],
  ['unexpected tool call', (value) => { value.observed_workflow.unexpected_tool_calls = 1; }],
  ['unauthorized execution', (value) => { value.hard_gates.unauthorized_s2_s4_execution = 1; }],
  ['aggregate wrong object execution', (value) => { value.aggregate.wrong_object_automatic_execution = 1; }],
  ['wrong fixture count', (value) => { value.aggregate.fixture_count = 2; }],
  ['wrong workflow count', (value) => { value.aggregate.workflow_count = 1; }],
  ['wrong process count', (value) => { value.aggregate.independent_process_runs = 2; }],
  ['wrong aggregate event count', (value) => { value.aggregate.gateway_event_count = 9; }],
  ['wrong image run count', (value) => { value.aggregate.image_summary_process_runs = 0; }],
  ['invalid prior hash format', (value) => { value.prior_aggregate_evidence.sha256 = 'sha256:not-a-digest'; }],
  ['wrong audit event count', (value) => { value.audit.event_count = 3; }],
  ['wrong metadata read count', (value) => { value.audit.image_metadata_read_count = 2; }],
  ['runtime elevation', (value) => { value.runtime = 'queue'; }],
  ['unexpected field', (value) => { value.untrusted_extension = true; }]
];
for (const [label, mutate] of evidenceNegativeCases) {
  const candidate = structuredClone(evidence);
  mutate(candidate);
  assert.equal(validateEvidence(candidate), false, `${label} must fail evidence schema validation`);
}

const responseNegativeCases = [
  ['wrong status', (value) => { value.status = 'executed'; }],
  ['wrong task state', (value) => { value.visual_task_state = 'completed'; }],
  ['inline summary removal', (value) => { value.structured_summary_inline = false; }],
  ['vision requirement', (value) => { value.visual_agent_required = true; }],
  ['local file requirement', (value) => { value.local_files_required = true; }],
  ['correction execution', (value) => { value.correction_execution_allowed = true; }],
  ['invalid artifact handle', (value) => { value.image_artifact_handle = 'file:///tmp/overlay.png'; }],
  ['raw image encoding', (value) => { value.image_artifact_encoding = 'base64'; }],
  ['image content exposure', (value) => { value.image_content_omitted_for_capability = false; }],
  ['execution stop removal', (value) => { value.stopped_before_execution = false; }],
  ['missing notes', (value) => { delete value.notes; }],
  ['unexpected response field', (value) => { value.approval_token = 'forbidden'; }]
];
for (const [label, mutate] of responseNegativeCases) {
  const candidate = structuredClone(response);
  mutate(candidate);
  assert.equal(validateResponse(candidate), false, `${label} must fail response schema validation`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  independent_process_runs: evidence.aggregate.independent_process_runs,
  fixture_families: evidence.aggregate.fixture_count,
  workflow_families: evidence.aggregate.workflow_count,
  gateway_events: evidence.aggregate.gateway_event_count,
  image_summary_gateway_events: auditEvents.length,
  structured_summary_inline: response.structured_summary_inline,
  image_artifact_metadata_only: evidence.observed_workflow.image_artifact_metadata_only,
  image_content_exposed: false,
  model_revision_unchanged: evidence.fixture.revision_unchanged,
  hash_chain_valid: true,
  artifact_hashes_valid: evidence.artifacts.length,
  sensitive_material_exposed: false,
  hard_gates: evidence.hard_gates,
  rejected_invalid_evidence: evidenceNegativeCases.length,
  rejected_invalid_responses: responseNegativeCases.length,
  live_queue_called: false,
  release_acceptance: false
}, null, 2)}\n`);

function parseJsonLines(value) {
  return String(value).split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function hashBytes(value) {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}
