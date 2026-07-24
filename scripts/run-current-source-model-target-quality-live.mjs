#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  CAPABILITY_MANIFEST_VERSION,
  QUEUE_MODEL_REVISION_STRATEGY,
  QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { projectRoot } from '../src/paths.mjs';
import { QueueRuntime } from '../src/queue-runtime.mjs';
import { BOOLEAN_OPERATIONS_SHA256, MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import {
  assertNoSensitivePublicEvidence,
  assertQueueIdle,
  assertReadOnlyBindingUnchanged,
  assertSafeRunId,
  summarizeQueue
} from './run-current-source-agent-readonly-live.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_OUTPUT_ROOT = path.join(projectRoot, 'output', 'live-validation', 'model-target-quality');
const DEFAULT_ALLOWED_MODEL_ROOT = path.join(projectRoot, 'output');
const REPORT_SCHEMA_PATH = path.join(projectRoot, 'schema', 'current-source-model-target-quality-live-report-v1.schema.json');
const HASH_PATTERN = /^(?:sha256:)?([0-9a-f]{64})$/;
const TARGET_QUERY = 'largest group';
const GOAL_CONTRACT = 'largest_structural_group_by_world_bbox_volume';
const DOMAINS = new Set(['architecture', 'interior', 'product', 'deep_shared', 'dirty_import', 'supporting']);
const SOURCE_BINDING_PATHS = [
  'src/existing-model-edit-proposer.mjs',
  'src/agent-gateway.mjs',
  'scripts/run-current-source-model-target-quality-live.mjs',
  'schema/current-source-model-target-quality-live-report-v1.schema.json'
];

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${safeMessage(error)}\n`);
    process.exitCode = 1;
  });
}

export async function main(argv, dependencies = {}) {
  const options = parseArgs(argv);
  assertExplicitTargetQualityOptIn(options);
  const outputRoot = await resolveOutputRoot(options.outputDir || DEFAULT_OUTPUT_ROOT);
  const runId = options.runId || `${timestampId()}-${crypto.randomUUID().slice(0, 8)}`;
  assertSafeRunId(runId);
  const runDir = path.join(outputRoot, runId);
  const privateDir = path.join(runDir, 'private');
  await fs.mkdir(privateDir, { recursive: true, mode: 0o700 });
  await fs.chmod(privateDir, 0o700);

  (dependencies.stderr || process.stderr).write(
    'READ-ONLY TARGET-QUALITY VALIDATION: this command evaluates the largest projected Group on the active prepared copy. '
    + 'It creates one proposal task but does not approve, execute, mutate, save, capture, select, reset, open, import, or export the model.\n'
  );

  const bridge = dependencies.bridge || createBridge({ privateDir, timeoutMs: options.timeoutMs });
  const report = await runModelTargetQualityReadOnlyFlow(options, { bridge, privateDir });
  assertNoSensitivePublicEvidence(report);
  await validateReport(report, dependencies.reportSchema);
  const reportPath = path.join(runDir, 'report.json');
  await writeJson(reportPath, report);
  (dependencies.stdout || process.stdout).write(`${JSON.stringify({
    ...report,
    report_path: path.relative(projectRoot, reportPath)
  }, null, 2)}\n`);
  return report;
}

export async function runModelTargetQualityReadOnlyFlow(options, { bridge, privateDir } = {}) {
  if (!bridge) throw new Error('runModelTargetQualityReadOnlyFlow requires a bridge.');
  if (!privateDir) throw new Error('runModelTargetQualityReadOnlyFlow requires a privateDir.');
  const timeoutMs = options.timeoutMs;
  const expectedModelSha256 = normalizeSha256(options.expectedModelSha256);
  const allowedModelRoot = await fs.realpath(path.resolve(options.allowedModelRoot || DEFAULT_ALLOWED_MODEL_ROOT));
  const startedAt = Date.now();

  const queueBefore = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs });
  assertQueueIdle(queueBefore);
  const runtime = (await bridge.get_capabilities({ runtime: 'queue', timeoutMs })).runtime;
  assertCurrentRuntime(runtime);

  const handshakeBeforeResult = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs });
  const handshakeBefore = handshakeBeforeResult.session_contract;
  assert.equal(handshakeBeforeResult.mutates_model, false);
  await bridge.sessionContractAuthority.verify(handshakeBefore);
  assert.equal(handshakeBefore.model_modified, false, 'the active prepared model must start without unsaved changes');
  assert.equal(handshakeBefore.model_revision_complete, true, 'the active model revision must be complete');
  assert.equal(handshakeBefore.model_revision_indexed, handshakeBefore.model_revision_total_seen);

  const activeModelPath = await assertAllowedPreparedModel({
    sourcePath: handshakeBefore.model_identity?.source_path,
    allowedModelRoot,
    expectedModelSha256,
    allowIntakeCandidate: options.preparedCopyConfirmed === true
  });
  const bytesBefore = await sha256File(activeModelPath);
  const sizeBytes = (await fs.stat(activeModelPath)).size;
  const weakClient = Object.freeze({
    vision: false,
    local_files: false,
    structured_output: false,
    context: 'short',
    parallel: false
  });

  const proposalStartedAt = Date.now();
  const proposalEnvelope = await bridge.start_agent_task({
    intent: 'propose_existing_model_edit',
    instruction: 'Propose renaming the largest Group by server-computed world bounding-box volume. Do not execute, approve, mutate, or save.',
    interface_level: 'guided',
    client_capabilities: weakClient,
    idempotency_key: `live-target-quality:${expectedModelSha256}:${handshakeBefore.model_revision}:${options.domain}`,
    inputs: {
      runtime: 'queue',
      discovery_mode: 'structural_groups',
      structural_group_limit: options.structuralGroupLimit,
      recursive_limit: options.recursiveLimit,
      target_query: TARGET_QUERY,
      action: 'rename',
      parameters: { new_name: 'Reviewed_Target_Quality_Probe' },
      shared_policy: 'make_unique',
      candidate_limit: 5,
      save_model: false,
      capture_view: false
    }
  });
  assert.equal(proposalEnvelope.ok, true, JSON.stringify(proposalEnvelope.error));
  assert.ok(['awaiting_input', 'awaiting_review'].includes(proposalEnvelope.task_state));
  const expanded = await expandedEnvelopeDocument(bridge, proposalEnvelope, options.artifactPageChars);
  const proposalProjection = expanded.document;
  const proposal = proposalProjection.result?.proposal;
  assert.ok(proposal, 'proposal task did not return an edit proposal');
  assert.equal(proposal.execution_allowed, false);
  assert.equal(proposal.model_revision, handshakeBefore.model_revision);
  assert.equal(proposalProjection.result?.target_discovery?.mode, 'structural_groups');
  assert.equal(proposalProjection.result?.target_discovery?.leaf_entities_materialized, false);

  const privateTask = await bridge.taskStore.getTask(proposalEnvelope.task_id, { includePrivate: true });
  const modelGraph = privateTask.private?.model_graph;
  assert.equal(modelGraph?.version, 'model-graph.v1');
  assert.equal(modelGraph.model_revision, handshakeBefore.model_revision);
  const oracle = evaluateLargestStructuralGroupOracle(modelGraph, { operation: 'rename' });
  const observed = assertProposalMatchesLargestGroupOracle({
    oracle,
    envelope: proposalEnvelope,
    proposal
  });
  const proposalCompletedAt = Date.now();

  const handshakeAfterResult = await bridge.create_queue_handshake({ expires_in_ms: 5 * 60 * 1000, timeoutMs });
  const handshakeAfter = handshakeAfterResult.session_contract;
  assert.equal(handshakeAfterResult.mutates_model, false);
  await bridge.sessionContractAuthority.verify(handshakeAfter);
  assertReadOnlyBindingUnchanged(handshakeBefore, handshakeAfter);
  const bytesAfter = await sha256File(activeModelPath);
  assert.equal(bytesAfter, bytesBefore, 'active prepared model bytes changed during read-only target-quality validation');
  const queueAfter = await bridge.queue_diagnostics({ includeFiles: true, timeoutMs });
  assertQueueIdle(queueAfter);

  const privateArtifacts = {
    handshake_before: await writePrivateJson(privateDir, 'handshake-before.json', handshakeBeforeResult),
    proposal_envelope: await writePrivateJson(privateDir, 'proposal-envelope.json', proposalEnvelope),
    proposal_projection: await writePrivateJson(privateDir, 'proposal-projection.json', proposalProjection),
    oracle: await writePrivateJson(privateDir, 'oracle.json', oracle.private),
    handshake_after: await writePrivateJson(privateDir, 'handshake-after.json', handshakeAfterResult)
  };
  const sourceBindings = await Promise.all(SOURCE_BINDING_PATHS.map(async (relativePath) => ({
    path: relativePath,
    sha256: `sha256:${await sha256File(path.join(projectRoot, relativePath))}`
  })));

  return {
    version: 'current-source-model-target-quality-live-report.v1',
    kind: 'current_source_model_target_quality_live_report',
    captured_at: new Date().toISOString(),
    result: 'pass',
    domain: options.domain,
    goal_contract: GOAL_CONTRACT,
    source_bindings: sourceBindings,
    runtime: {
      plugin_version: runtime.version,
      sketchup_version: runtime.plugin?.sketchup_version,
      ruby_version: runtime.plugin?.ruby_version,
      capability_version: runtime.capability_version,
      manifest_version: runtime.manifest_version,
      model_revision_strategy: runtime.model_revision.strategy,
      boolean_operations_sha256: `sha256:${runtime.boolean_operations_sha256}`,
      model_revision_source_sha256: `sha256:${runtime.model_revision_source_sha256}`,
      compatibility_ok: runtime.compatibility?.ok === true
    },
    model: {
      fixture_handle: `fixture:sha256:${expectedModelSha256}`,
      label_trust: 'untrusted_data',
      size_bytes: sizeBytes,
      model_revision: handshakeBefore.model_revision,
      revision_indexed: handshakeBefore.model_revision_indexed,
      revision_total_seen: handshakeBefore.model_revision_total_seen,
      model_revision_complete: true,
      structural_group_count: oracle.group_count,
      projection_complete: oracle.projection_complete,
      leaf_entities_materialized: false,
      bytes_unchanged: true,
      revision_unchanged: true,
      document_unchanged: true,
      model_modified: false,
      source_path_disclosed: false
    },
    oracle: oracle.public,
    agent_gateway: {
      interface_level: 'guided',
      client_profile: 'l0_short_context_no_files_no_vision_no_structured_output_single_tool',
      task_state: proposalEnvelope.task_state,
      observed_behavior: observed.behavior,
      requires_clarification: proposal.requires_clarification === true,
      candidate_count: proposal.candidates.length,
      selected_target_count: proposal.selected_targets.length,
      operation_count: proposal.operation_proposal.length,
      selected_target_fingerprint: observed.selected_target_fingerprint,
      selected_matches_oracle: observed.selected_matches_oracle,
      oracle_target_in_top_5: observed.oracle_target_in_top_5,
      ambiguity_reasons: [...proposal.ambiguity_reasons].sort(),
      artifact_page_chars: options.artifactPageChars,
      artifact_page_calls: expanded.pages,
      execution_allowed: false,
      approval_requested: false
    },
    timing: {
      total_ms: Date.now() - startedAt,
      proposal_ms: proposalCompletedAt - proposalStartedAt,
      performance_guarantee: false
    },
    safety: {
      queue_before: summarizeQueue(queueBefore),
      queue_after: summarizeQueue(queueAfter),
      signed_handshakes_verified_at_capture: 2,
      raw_model_labels_exposed: false,
      sensitive_values_embedded_in_public_report: false,
      mutation_requested: false,
      mutation_performed: false,
      save_requested: false,
      save_performed: false,
      approval_requested: false,
      approval_issued: false
    },
    artifact_hashes: Object.fromEntries(
      Object.entries(privateArtifacts).map(([name, value]) => [name, `sha256:${value.sha256}`])
    ),
    acceptance: {
      structural_target_or_abstention_matches_oracle: true,
      wrong_object_automatic_execution: 0,
      unauthorized_s2_s4_execution: 0,
      duplicate_request_duplicate_modification: 0,
      live_mutation: false,
      multi_model_target_quality: false,
      release_acceptance: false
    },
    boundary: 'This proves one current-source, byte-bound, read-only structural largest-Group target or abstention against an independent server-private geometry oracle. It does not establish semantic intent quality, mutation correctness, save/reopen reliability, multi-model acceptance, or release acceptance.'
  };
}

export function evaluateLargestStructuralGroupOracle(graph, { operation = 'rename' } = {}) {
  if (graph?.version !== 'model-graph.v1') throw new Error('The target-quality oracle requires ModelGraph v1.');
  const coverage = graph.projections?.structural_groups;
  const groups = (graph.nodes || []).filter((node) => node.node_type === 'occurrence'
    && node.entity_type === 'group'
    && node.projection_source === 'structural-groups.v1');
  if (!coverage) throw new Error('ModelGraph has no structural Group projection.');
  assert.equal(coverage.indexed, groups.length, 'structural Group coverage count does not match projected nodes');
  const ranked = groups.map((node) => ({ node, volume: structuralVolume(node) }))
    .sort((left, right) => right.volume - left.volume || stableNodeIdentity(left.node).localeCompare(stableNodeIdentity(right.node)));
  const topVolume = ranked[0]?.volume ?? null;
  const tied = topVolume === null ? [] : ranked.filter((entry) => entry.volume === topVolume);
  const top = tied.length === 1 ? tied[0].node : null;
  const topEligible = Boolean(top
    && top.effective_locked !== true
    && Array.isArray(top.allowed_operations)
    && top.allowed_operations.includes(operation));
  let status;
  if (coverage.complete !== true) status = 'projection_incomplete';
  else if (ranked.length === 0) status = 'no_projected_groups';
  else if (tied.length > 1) status = 'ambiguous_volume_tie';
  else if (!topEligible) status = 'largest_group_locked_or_ineligible';
  else status = 'unique_eligible_maximum';
  const unique = status === 'unique_eligible_maximum';
  const runnerUpVolume = ranked[1]?.volume ?? null;
  const absoluteMargin = unique && runnerUpVolume !== null ? topVolume - runnerUpVolume : null;
  const relativeMargin = absoluteMargin === null
    ? null
    : (topVolume === 0 ? (absoluteMargin === 0 ? 0 : 1) : absoluteMargin / Math.abs(topVolume));
  const targetFingerprint = unique ? fingerprintNode(top) : null;
  return {
    group_count: groups.length,
    projection_complete: coverage.complete === true,
    target_node: unique ? top : null,
    public: {
      basis: 'server_private_model_graph_world_bbox_volume',
      status,
      expected_behavior: unique ? 'select_one_for_review_only' : 'ask_for_clarification',
      evaluated_group_count: groups.length,
      unique_eligible_maximum: unique,
      tied_maximum_count: tied.length,
      largest_volume: topVolume,
      runner_up_volume: runnerUpVolume,
      absolute_margin: absoluteMargin,
      relative_margin: relativeMargin,
      target_fingerprint: targetFingerprint
    },
    private: {
      version: 'current-source-model-target-quality-oracle.v1',
      status,
      coverage: structuredClone(coverage),
      operation,
      ranked_groups: ranked.map(({ node, volume }) => ({
        node_id: node.node_id,
        entity_path: node.entity_path,
        fingerprint: fingerprintNode(node),
        volume,
        effective_locked: node.effective_locked === true,
        operation_allowed: Array.isArray(node.allowed_operations) && node.allowed_operations.includes(operation)
      }))
    }
  };
}

export function assertProposalMatchesLargestGroupOracle({ oracle, envelope, proposal }) {
  const selected = proposal.selected_targets || [];
  const operations = proposal.operation_proposal || [];
  const candidates = proposal.candidates || [];
  if (oracle.public.expected_behavior === 'select_one_for_review_only') {
    assert.equal(envelope.task_state, 'awaiting_review', 'a unique eligible maximum must proceed to review only');
    assert.equal(proposal.requires_clarification, false);
    assert.equal(selected.length, 1);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].op, 'rename');
    const selectedFingerprint = fingerprintTarget(selected[0]);
    assert.equal(selectedFingerprint, oracle.public.target_fingerprint, 'the selected target does not match the geometry oracle');
    const oracleInTopFive = candidates.slice(0, 5).some((candidate) => fingerprintTarget(candidate) === oracle.public.target_fingerprint);
    assert.equal(oracleInTopFive, true, 'the oracle target is absent from the top five candidates');
    return {
      behavior: 'select_one_for_review_only',
      selected_target_fingerprint: selectedFingerprint,
      selected_matches_oracle: true,
      oracle_target_in_top_5: true
    };
  }
  assert.equal(envelope.task_state, 'awaiting_input', 'an ambiguous, incomplete, locked, or ineligible maximum must ask for input');
  assert.equal(proposal.requires_clarification, true);
  assert.equal(selected.length, 0, 'an unresolved target must not be selected');
  assert.equal(operations.length, 0, 'an unresolved target must not produce an operation');
  return {
    behavior: 'ask_for_clarification',
    selected_target_fingerprint: null,
    selected_matches_oracle: null,
    oracle_target_in_top_5: null
  };
}

export function assertExplicitTargetQualityOptIn(options) {
  if (options.runtime !== 'queue'
    || options.queueRequired !== true
    || (options.disposableCopyConfirmed !== true && options.preparedCopyConfirmed !== true)) {
    throw new Error('Explicit live opt-in required: --runtime queue --queue-required and a prepared-copy confirmation flag.');
  }
  normalizeSha256(options.expectedModelSha256);
  if (!DOMAINS.has(options.domain)) throw new Error(`--domain must be one of: ${[...DOMAINS].join(', ')}.`);
  if (!Number.isInteger(options.structuralGroupLimit) || options.structuralGroupLimit < 1 || options.structuralGroupLimit > 5000) {
    throw new Error('--structural-group-limit must be an integer from 1 to 5000.');
  }
  if (!Number.isInteger(options.recursiveLimit) || options.recursiveLimit < 1 || options.recursiveLimit > 1_000_000) {
    throw new Error('--recursive-limit must be an integer from 1 to 1000000.');
  }
  if (!Number.isInteger(options.artifactPageChars) || options.artifactPageChars < 512 || options.artifactPageChars > 8192) {
    throw new Error('--artifact-page-chars must be an integer from 512 to 8192.');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10_000 || options.timeoutMs > 600_000) {
    throw new Error('--timeout-ms must be an integer from 10000 to 600000.');
  }
}

async function assertAllowedPreparedModel({ sourcePath, allowedModelRoot, expectedModelSha256, allowIntakeCandidate }) {
  if (typeof sourcePath !== 'string' || !sourcePath) throw new Error('The active SketchUp model has no saved source path.');
  const activePath = await fs.realpath(path.resolve(sourcePath));
  const relative = path.relative(allowedModelRoot, activePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('The active model is outside --allowed-model-root.');
  }
  const disposableName = /\.disposable\.skp$/i.test(path.basename(activePath));
  const intakeCandidate = allowIntakeCandidate && isPreparedIntakeCandidate(activePath);
  if (!disposableName && !intakeCandidate) {
    throw new Error('The active model must be a .disposable.skp file or an explicitly confirmed prepared intake candidate copy.');
  }
  assert.equal(await sha256File(activePath), expectedModelSha256, 'The active prepared model SHA-256 does not match.');
  return activePath;
}

export function isPreparedIntakeCandidate(filePath) {
  const segments = path.resolve(filePath).split(path.sep);
  const fileName = segments.at(-1);
  const candidateDir = segments.at(-2);
  const preflightDir = segments.at(-3);
  const liveWorkDir = segments.at(-4);
  return fileName === 'candidate.skp'
    && /^candidate_[0-9a-f]{24}$/.test(String(candidateDir || ''))
    && /^preflight-[0-9a-f-]{36}$/.test(String(preflightDir || ''))
    && liveWorkDir === 'live-work';
}

function createBridge({ privateDir, timeoutMs }) {
  return new SketchUpBridge({
    queueRuntime: new QueueRuntime({ repoRoot: projectRoot, timeoutMs }),
    queue: { timeoutMs },
    executionPolicy: {
      allowed_runtimes: ['mock', 'queue'],
      allow_queue_mutation: false,
      allow_direct_expert_queue_mutation: false,
      auto_approve_risks: [],
      resource_limits: { max_recursive_entities: 1_000_000 }
    },
    approval: { stateDir: path.join(privateDir, 'approvals') },
    agentContract: { rootDir: path.join(privateDir, 'agent-contract') },
    sessionContract: {
      stateDir: path.join(privateDir, 'session-contracts'),
      serverSessionId: `current-source-model-target-quality-${crypto.randomUUID()}`
    }
  });
}

async function expandedEnvelopeDocument(bridge, envelope, maxChars) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) return {
    document: { result: envelope.data, next_action: envelope.next_action, artifacts: envelope.artifacts || [] },
    pages: 0
  };
  let offset = 0;
  let content = '';
  let pages = 0;
  while (pages < 10_000) {
    const page = await bridge.read_agent_artifact({ handle, task_id: envelope.task_id, offset, max_chars: maxChars });
    assert.equal(page.ok, true, JSON.stringify(page.error));
    content += page.data.artifact.content;
    pages += 1;
    if (page.data.artifact.eof) return { document: JSON.parse(content), pages };
    const next = page.data.artifact.next_offset;
    assert.ok(Number.isInteger(next) && next > offset, 'artifact pagination did not make progress');
    offset = next;
  }
  throw new Error('Artifact pagination exceeded the safety limit.');
}

function assertCurrentRuntime(runtime) {
  assert.equal(runtime?.compatibility?.ok, true, JSON.stringify(runtime?.compatibility?.issues));
  assert.equal(runtime.version, PRODUCT_VERSION);
  assert.equal(runtime.capability_version, RUNTIME_CAPABILITY_VERSION);
  assert.equal(runtime.manifest_version, CAPABILITY_MANIFEST_VERSION);
  assert.equal(runtime.model_revision?.strategy, QUEUE_MODEL_REVISION_STRATEGY);
  assert.equal(runtime.model_revision?.unique_entity_limit, QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT);
  assert.equal(runtime.boolean_operations_sha256, BOOLEAN_OPERATIONS_SHA256);
  assert.equal(runtime.model_revision_source_sha256, MODEL_REVISION_SOURCE_SHA256);
}

function structuralVolume(node) {
  const value = Number(node?.spatial_summary?.volume);
  if (!Number.isFinite(value) || value < 0) throw new Error('Projected Group has an invalid world bounding-box volume.');
  return value;
}

function stableNodeIdentity(node) {
  return String(node.entity_path || node.reference || node.node_id || '');
}

function fingerprintNode(node) {
  return `sha256:${sha256Text(`structural-group:${stableNodeIdentity(node)}`)}`;
}

function fingerprintTarget(target) {
  const identity = target?.entity_path
    || target?.persistent_ref?.entity_path
    || target?.target_id
    || target?.persistent_ref?.target_id
    || target?.node_id;
  return identity ? `sha256:${sha256Text(`structural-group:${identity}`)}` : null;
}

async function validateReport(report, suppliedSchema) {
  const schema = suppliedSchema || JSON.parse(await fs.readFile(REPORT_SCHEMA_PATH, 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (!validate(report)) throw new Error(`Target-quality report schema validation failed: ${JSON.stringify(validate.errors)}`);
}

async function resolveOutputRoot(value) {
  const target = path.resolve(value);
  const outputRoot = path.resolve(projectRoot, 'output');
  const relative = path.relative(outputRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--output-dir must stay inside repository output.');
  await fs.mkdir(target, { recursive: true });
  return fs.realpath(target);
}

async function writePrivateJson(privateDir, name, value) {
  const filePath = path.join(privateDir, name);
  await writeJson(filePath, value);
  return { sha256: await sha256File(filePath) };
}

async function writeJson(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o600);
}

function parseArgs(argv) {
  const options = {
    timeoutMs: 240_000,
    recursiveLimit: 100_000,
    structuralGroupLimit: 5000,
    artifactPageChars: 2048
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = requiredValue(argv, ++index, arg);
    else if (arg === '--queue-required') options.queueRequired = true;
    else if (arg === '--disposable-copy-confirmed') options.disposableCopyConfirmed = true;
    else if (arg === '--prepared-copy-confirmed') options.preparedCopyConfirmed = true;
    else if (arg === '--expected-model-sha256') options.expectedModelSha256 = requiredValue(argv, ++index, arg);
    else if (arg === '--allowed-model-root') options.allowedModelRoot = requiredValue(argv, ++index, arg);
    else if (arg === '--domain') options.domain = requiredValue(argv, ++index, arg);
    else if (arg === '--output-dir') options.outputDir = requiredValue(argv, ++index, arg);
    else if (arg === '--run-id') options.runId = requiredValue(argv, ++index, arg);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--recursive-limit') options.recursiveLimit = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--structural-group-limit') options.structuralGroupLimit = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--artifact-page-chars') options.artifactPageChars = Number(requiredValue(argv, ++index, arg));
    else if (arg === '--help' || arg === '-h') throw new Error(usage());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}

function normalizeSha256(value) {
  const match = HASH_PATTERN.exec(String(value || '').toLowerCase());
  if (!match) throw new Error('--expected-model-sha256 must be a 64-character SHA-256 digest.');
  return match[1];
}

async function sha256File(filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timestampId() {
  return new Date().toISOString().replaceAll(/[:.]/g, '-');
}

function safeMessage(error) {
  return String(error?.message || error || 'Unknown error')
    .replaceAll(/hmac_sha256:[A-Za-z0-9_-]+/g, 'hmac_sha256:[redacted]')
    .replaceAll(/(token|secret)=\S+/gi, '$1=[redacted]');
}

function usage() {
  return 'Usage: node scripts/run-current-source-model-target-quality-live.mjs --runtime queue --queue-required --disposable-copy-confirmed|--prepared-copy-confirmed --expected-model-sha256 <sha256> --allowed-model-root <path> --domain <domain> [--run-id <id>]';
}
