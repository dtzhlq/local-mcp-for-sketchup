#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { defaultStateDir, projectRoot } from '../src/paths.mjs';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import { analyzeReferenceImageCorrection } from '../src/visual-correction.mjs';

export const TRIMBLE_S6_STRUCTURED_REFERENCE_DIAGNOSTIC_VERSION = 'trimble-s6-structured-reference-diagnostic.v1';

const options = parseArgs(process.argv.slice(2));
const timeoutMs = options.timeoutMs || 900_000;
const recursiveLimit = options.recursiveLimit || 100_000;
const outputRoot = path.join(
  projectRoot,
  'output',
  'live-validation',
  'visual-correction',
  'trimble-s6-reference-correction-2026-07-22'
);
const runDir = path.resolve(options.runDir || await latestRunDir(outputRoot));
const diagnosticId = options.diagnosticId || 'front-full-v1';
const diagnosticDir = path.join(runDir, 'structured-reference-diagnostic', diagnosticId);
const prepare = await readJson(path.join(runDir, 'prepare.json'));
const referenceOrdinal = options.referenceOrdinal || 3;
const reference = prepare.references?.find((entry) => entry.ordinal === referenceOrdinal);
if (!reference?.handle || !reference?.sha256) throw new Error(`Reference ${referenceOrdinal} is missing from prepare.json.`);

const expectedModelPath = path.resolve(options.modelPath || prepare.model?.source_path || '');
if (!expectedModelPath || path.basename(expectedModelPath) !== 'Trimble S6.disposable.skp') {
  throw new Error('The diagnostic requires the exact Trimble S6 disposable-copy path from the source run.');
}
const canonicalExpectedModelPath = await fs.realpath(expectedModelPath);
const diskSha256Before = await sha256File(canonicalExpectedModelPath);

const bridge = new SketchUpBridge({
  queueRuntime: new QueueRuntime({ timeoutMs }),
  executionPolicy: {
    allowed_runtimes: ['mock', 'queue'],
    allow_queue_mutation: true,
    allow_direct_expert_queue_mutation: false,
    auto_approve_risks: [],
    resource_limits: {
      max_operations: 100,
      max_affected_instances: 100_000,
      max_recursive_entities: 100_000
    }
  },
  approval: {
    stateDir: path.join(defaultStateDir, 'agent-contract-v1', 'approvals')
  },
  agentContract: { rootDir: path.join(defaultStateDir, 'agent-contract-v1') },
  sessionContract: { serverSessionId: TRIMBLE_S6_STRUCTURED_REFERENCE_DIAGNOSTIC_VERSION }
});

const queueBefore = summarizeQueue(await bridge.queue_diagnostics({ includeFiles: false, timeoutMs }));
assertQueueIdle(queueBefore);
const modelBefore = await bridge.get_model_info({ runtime: 'queue', timeoutMs });
assertExpectedModel(modelBefore, canonicalExpectedModelPath);
let adoption = null;
let modelGraph;
let binding;
if (options.modelKey) {
  const stored = await bridge.agentGateway.modelGraphStore.loadCurrent(options.modelKey);
  modelGraph = stored.graph;
  binding = {
    model_key: stored.manifest.model_key,
    graph_id: modelGraph.graph_id,
    model_revision: modelGraph.model_revision
  };
} else {
  adoption = await bridge.adopt_open_model({
    runtime: 'queue',
    recursive: true,
    recursive_limit: recursiveLimit,
    read_only: true,
    timeoutMs
  });
  assertExpectedAdoption(adoption, canonicalExpectedModelPath);
  modelGraph = buildModelGraph(adoption);
  binding = {
    model_key: modelKeyForIdentity(modelIdentityForAdoption(adoption)),
    graph_id: modelGraph.graph_id,
    model_revision: modelGraph.model_revision
  };
}
const handshake = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs });
const handshakeModelKey = modelKeyForIdentity(modelIdentityForAdoption({
  kind: 'adopt_open_model',
  runtime: 'queue',
  model_identity: handshake.session_contract.model_identity,
  document_id: handshake.session_contract.document_id
}));
if (handshake.session_contract.model_revision !== binding.model_revision || handshakeModelKey !== binding.model_key) {
  throw new Error('The fresh handshake does not match the selected persisted ModelGraph.');
}
const diagnosticTaskId = `task_${crypto.randomUUID()}`;
const liveCapture = await bridge.withAgentGatewayExecution({
  taskId: diagnosticTaskId,
  intent: 'reference_image_correction'
}, (gatewayBridge) => bridge.agentGateway.liveVisualCaptureService.capture({
  bridge: gatewayBridge,
  taskId: diagnosticTaskId,
  phase: 'before',
  sessionContract: handshake.session_contract,
  expectedBinding: binding,
  recursiveLimit
}));
await fs.mkdir(diagnosticDir, { recursive: true, mode: 0o700 });
const captureCheckpoint = {
  version: 'trimble-s6-structured-reference-capture-checkpoint.v1',
  diagnostic_task_id: diagnosticTaskId,
  model_key: binding.model_key,
  graph_id: binding.graph_id,
  model_revision: binding.model_revision,
  record: liveCapture.record,
  provenance: liveCapture.provenance,
  capture_mode: liveCapture.capture_mode,
  cas_reused: liveCapture.cas_reused === true
};
await writeJson(path.join(diagnosticDir, 'capture-checkpoint.json'), captureCheckpoint);
await fs.writeFile(
  path.join(diagnosticDir, 'capture-checkpoint.png'),
  await bridge.agentGateway.imageArtifactStore.readBuffer(liveCapture.record.handle),
  { mode: 0o600 }
);
const analysis = await analyzeReferenceImageCorrection({
  imageArtifactStore: bridge.agentGateway.imageArtifactStore,
  referenceHandle: reference.handle,
  captureHandle: liveCapture.record.handle,
  captureProvenance: liveCapture.provenance,
  modelGraph,
  modelBinding: binding,
  sourceTaskId: diagnosticTaskId,
  ...(adoption?.snapshot ? { modelSnapshot: adoption.snapshot } : {}),
  correctionTargets: [{
    entity_path: prepare.model.anchor_entity_path,
    edit_scope: 'instance_path',
    instance_policy: 'definition_wide'
  }],
  correctionOperations: [{
    op: 'attribute',
    entity_path: prepare.model.anchor_entity_path,
    dictionary: 'alma_visual_diagnostic',
    key: 'proposal_only',
    value: 'not_executed'
  }]
});
const evidence = analysis.evidence;
const imageArtifacts = analysis.artifacts;
if (!evidence?.alignment || !evidence?.difference || !evidence?.captured_image?.capture_provenance) {
  throw new Error('The source task did not persist complete structured visual evidence.');
}
if (evidence.reference_image.handle !== reference.handle || evidence.reference_image.sha256 !== reference.sha256) {
  throw new Error('The structured evidence is not bound to the requested immutable reference.');
}
if (evidence.content_trust !== 'untrusted_data' || evidence.policy_effect !== 'none') {
  throw new Error('The reference evidence trust boundary changed unexpectedly.');
}
if (evidence.captured_image.capture_provenance.state_unchanged !== true
  || evidence.captured_image.capture_provenance.view_unchanged !== true) {
  throw new Error('The server-owned capture did not preserve the live model/view state.');
}

await fs.mkdir(diagnosticDir, { recursive: true, mode: 0o700 });
const materializedArtifacts = await materializeImageArtifacts({
  bridge,
  diagnosticDir,
  evidence,
  imageArtifacts
});
const modelAfter = await bridge.get_model_info({ runtime: 'queue', timeoutMs });
assertExpectedModel(modelAfter, canonicalExpectedModelPath);
const queueAfter = summarizeQueue(await bridge.queue_diagnostics({ includeFiles: false, timeoutMs }));
assertQueueIdle(queueAfter);
const diskSha256After = await sha256File(canonicalExpectedModelPath);
if (diskSha256After !== diskSha256Before) throw new Error('The on-disk disposable model changed during read-only diagnostic capture.');
if (modelBefore.model_modified !== modelAfter.model_modified) throw new Error('The live model modified-state changed during diagnostic capture.');

const diagnostic = {
  version: TRIMBLE_S6_STRUCTURED_REFERENCE_DIAGNOSTIC_VERSION,
  kind: 'external_reference_structured_alignment_diagnostic',
  captured_at: new Date().toISOString(),
  source_run_id: prepare.run_id,
  source_mutation_task_id: prepare.task_id,
  diagnostic_task_id: diagnosticTaskId,
  task_state: 'diagnostic_completed',
  promoted_or_executed: false,
  promotion_available: false,
  correction_patch: {
    correction_patch_id: analysis.correction_patch.correction_patch_id,
    patch_hash: analysis.correction_patch.patch_hash,
    execution_allowed: analysis.correction_patch.execution_allowed,
    review_required: analysis.correction_patch.review_required,
    intentionally_not_persisted: true
  },
  model: {
    basename: path.basename(canonicalExpectedModelPath),
    source_path_matches: true,
    modified_state_before: modelBefore.model_modified,
    modified_state_after: modelAfter.model_modified,
    disk_sha256_before: diskSha256Before,
    disk_sha256_after: diskSha256After,
    disk_bytes_unchanged: diskSha256Before === diskSha256After,
    save_model: false
  },
  reference: {
    ordinal: reference.ordinal,
    handle: reference.handle,
    sha256: reference.sha256,
    width: reference.width,
    height: reference.height,
    content_trust: 'untrusted_data',
    policy_effect: 'none'
  },
  capture: {
    handle: evidence.captured_image.handle,
    sha256: evidence.captured_image.sha256,
    width: evidence.captured_image.width,
    height: evidence.captured_image.height,
    provenance: evidence.captured_image.capture_provenance,
    full_tripod_view_requested_via_ui: true
  },
  structured_metrics: {
    alignment: evidence.alignment,
    difference: evidence.difference,
    foreground: evidence.foreground,
    confidence: evidence.confidence,
    blockers: evidence.blockers,
    computed: true,
    acceptance: false,
    verdict: 'review',
    reason: 'The reference and capture use different render/background conditions; numeric residuals are diagnostic and must not be promoted as visual similarity acceptance.'
  },
  materialized_artifacts: materializedArtifacts,
  queue_before: queueBefore,
  queue_after: queueAfter,
  live_model_mutation_performed: false,
  approval_challenge_created: false,
  approval_token_exposed_to_agent: false,
  release_acceptance: false,
  boundaries: [
    'This is a server-owned current-view recapture and structured diagnostic for the already modified disposable model; it does not execute another edit.',
    'The proposal-only CorrectionPatch is intentionally not persisted as an Agent task, cannot be promoted, and must never be counted as an approved correction.',
    'The normalized RGB and foreground-centroid metrics are computed but not accepted because camera/render/background comparability is not independently established.',
    'The model was not saved or reopened; multi-model, fresh-process, cross-version, and release acceptance remain unproven.'
  ]
};

await writeJson(path.join(diagnosticDir, 'diagnostic.json'), diagnostic);
process.stdout.write(`${JSON.stringify({
  ok: true,
  diagnostic_task_id: diagnostic.diagnostic_task_id,
  task_state: diagnostic.task_state,
  structured_metrics_computed: diagnostic.structured_metrics.computed,
  structured_metrics_verdict: diagnostic.structured_metrics.verdict,
  capture: diagnostic.capture,
  queue_after: diagnostic.queue_after,
  disk_bytes_unchanged: diagnostic.model.disk_bytes_unchanged,
  promoted_or_executed: diagnostic.promoted_or_executed,
  release_acceptance: diagnostic.release_acceptance,
  diagnostic_path: path.join(diagnosticDir, 'diagnostic.json')
}, null, 2)}\n`);

async function materializeImageArtifacts({ bridge: activeBridge, diagnosticDir: targetDir, evidence: visualEvidence, imageArtifacts: artifacts }) {
  const bindings = {
    'reference.png': visualEvidence.reference_image,
    'capture.png': visualEvidence.captured_image,
    'difference-overlay.png': artifacts?.overlay,
    'reference-thumbnail.png': artifacts?.reference_thumbnail,
    'capture-thumbnail.png': artifacts?.capture_thumbnail
  };
  const result = {};
  for (const [basename, binding] of Object.entries(bindings)) {
    if (!binding?.handle || !binding?.sha256) throw new Error(`Missing immutable image binding for ${basename}.`);
    const bytes = await activeBridge.agentGateway.imageArtifactStore.readBuffer(binding.handle);
    const actualSha = `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
    if (actualSha !== binding.sha256) throw new Error(`Immutable image bytes drifted for ${basename}.`);
    const outputPath = path.join(targetDir, basename);
    await fs.writeFile(outputPath, bytes, { mode: 0o600 });
    result[basename] = {
      sha256: actualSha,
      size_bytes: bytes.length,
      handle: binding.handle
    };
  }
  return result;
}

function assertExpectedModel(modelInfo, expectedPath) {
  const actualPath = path.resolve(modelInfo?.source_path || '');
  if (modelInfo?.kind !== 'model_info' || modelInfo.runtime !== 'queue' || actualPath !== expectedPath) {
    throw new Error(`The active SketchUp model is not the exact expected disposable copy: ${actualPath || 'unknown'}`);
  }
}

function assertExpectedAdoption(adoption, expectedPath) {
  const actualPath = path.resolve(adoption?.model_identity?.source_path || adoption?.model_info?.source_path || '');
  if (adoption?.kind !== 'adopt_open_model'
    || adoption.runtime !== 'queue'
    || adoption.read_only !== true
    || adoption.model_revision_complete !== true
    || adoption.model_revision_total_seen !== adoption.model_revision_indexed
    || adoption.recursive_truncated === true
    || actualPath !== expectedPath) {
    throw new Error('The diagnostic adoption was incomplete or bound to a different model.');
  }
}

function assertQueueIdle(summary) {
  if (summary.queue !== 0 || summary.processing !== 0 || summary.responses !== 0 || summary.lock_exists !== false) {
    throw new Error(`Queue is not idle: ${JSON.stringify(summary)}`);
  }
}

function summarizeQueue(value) {
  const diagnostics = value?.diagnostics || value;
  return {
    queue: diagnosticCount(diagnostics?.queue_count, diagnostics?.queue),
    processing: diagnosticCount(diagnostics?.processing_count, diagnostics?.processing),
    responses: diagnosticCount(diagnostics?.response_count, diagnostics?.responses),
    lock_exists: typeof diagnostics?.lock_exists === 'boolean'
      ? diagnostics.lock_exists
      : diagnostics?.lock?.exists
  };
}

function diagnosticCount(flatValue, nestedValue) {
  for (const candidate of [flatValue, nestedValue?.count, nestedValue]) {
    if (candidate === null || candidate === undefined || typeof candidate === 'object') continue;
    const count = Number(candidate);
    if (Number.isInteger(count) && count >= 0) return count;
  }
  return null;
}

async function latestRunDir(root) {
  const latest = await readJson(path.join(root, 'latest.json'));
  if (!latest.run_dir) throw new Error('latest.json does not contain run_dir.');
  return latest.run_dir;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function sha256File(filePath) {
  return `sha256:${crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')}`;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--run-dir') result.runDir = argv[++index];
    else if (value === '--diagnostic-id') result.diagnosticId = argv[++index];
    else if (value === '--model-path') result.modelPath = argv[++index];
    else if (value === '--model-key') result.modelKey = argv[++index];
    else if (value === '--reference-ordinal') result.referenceOrdinal = Number(argv[++index]);
    else if (value === '--recursive-limit') result.recursiveLimit = Number(argv[++index]);
    else if (value === '--timeout-ms') result.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}
