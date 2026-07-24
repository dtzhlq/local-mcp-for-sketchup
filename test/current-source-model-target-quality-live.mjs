import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  assertExplicitTargetQualityOptIn,
  assertProposalMatchesLargestGroupOracle,
  evaluateLargestStructuralGroupOracle,
  isPreparedIntakeCandidate,
  runModelTargetQualityReadOnlyFlow
} from '../scripts/run-current-source-model-target-quality-live.mjs';
import {
  CAPABILITY_MANIFEST_VERSION,
  QUEUE_MODEL_REVISION_STRATEGY,
  QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
  RUNTIME_CAPABILITY_VERSION
} from '../src/capabilities.mjs';
import { projectRoot } from '../src/paths.mjs';
import { BOOLEAN_OPERATIONS_SHA256, MODEL_REVISION_SOURCE_SHA256 } from '../src/runtime-source-attestation.mjs';

let assertions = 0;
const validOptions = {
  runtime: 'queue',
  queueRequired: true,
  disposableCopyConfirmed: true,
  preparedCopyConfirmed: false,
  expectedModelSha256: 'a'.repeat(64),
  allowedModelRoot: '/tmp/prepared',
  domain: 'product',
  structuralGroupLimit: 5000,
  recursiveLimit: 100_000,
  artifactPageChars: 2048,
  timeoutMs: 240_000
};
assert.doesNotThrow(() => assertExplicitTargetQualityOptIn(validOptions)); assertions += 1;
assert.doesNotThrow(() => assertExplicitTargetQualityOptIn({
  ...validOptions,
  disposableCopyConfirmed: false,
  preparedCopyConfirmed: true
})); assertions += 1;

for (const invalid of [
  { ...validOptions, runtime: 'mock' },
  { ...validOptions, queueRequired: false },
  { ...validOptions, disposableCopyConfirmed: false, preparedCopyConfirmed: false },
  { ...validOptions, expectedModelSha256: 'short' },
  { ...validOptions, domain: 'unknown' },
  { ...validOptions, structuralGroupLimit: 0 },
  { ...validOptions, structuralGroupLimit: 5001 },
  { ...validOptions, recursiveLimit: 0 },
  { ...validOptions, recursiveLimit: 1_000_001 },
  { ...validOptions, artifactPageChars: 511 },
  { ...validOptions, artifactPageChars: 8193 },
  { ...validOptions, timeoutMs: 9999 },
  { ...validOptions, timeoutMs: 600_001 }
]) {
  assert.throws(() => assertExplicitTargetQualityOptIn(invalid)); assertions += 1;
}

assert.equal(isPreparedIntakeCandidate('/repo/output/real-model-reliability/intake/live-work/preflight-176129c4-e1ef-4b53-b991-8f7b936df118/candidate_849aa1987401733c3cd3fbb3/candidate.skp'), true); assertions += 1;
for (const unsafePath of [
  '/repo/output/live-work/preflight-176129c4-e1ef-4b53-b991-8f7b936df118/candidate_849aa1987401733c3cd3fbb3/original.skp',
  '/repo/output/live-work/preflight-escape/candidate_849aa1987401733c3cd3fbb3/candidate.skp',
  '/repo/output/live-work/preflight-176129c4-e1ef-4b53-b991-8f7b936df118/not-a-candidate/candidate.skp',
  '/repo/output/candidate.skp'
]) {
  assert.equal(isPreparedIntakeCandidate(unsafePath), false); assertions += 1;
}

const uniqueGraph = graphFixture([
  groupNode('pid:1', 10),
  groupNode('pid:2', 20)
]);
const uniqueOracle = evaluateLargestStructuralGroupOracle(uniqueGraph);
assert.equal(uniqueOracle.public.status, 'unique_eligible_maximum'); assertions += 1;
assert.equal(uniqueOracle.public.expected_behavior, 'select_one_for_review_only'); assertions += 1;
assert.equal(uniqueOracle.public.largest_volume, 20); assertions += 1;
assert.equal(uniqueOracle.public.runner_up_volume, 10); assertions += 1;
assert.equal(uniqueOracle.public.absolute_margin, 10); assertions += 1;
assert.match(uniqueOracle.public.target_fingerprint, /^sha256:[0-9a-f]{64}$/); assertions += 1;
assert.equal(Object.hasOwn(uniqueOracle.public, 'entity_path'), false); assertions += 1;

const uniqueProposal = proposalFixture({ selectedPath: 'pid:2' });
const uniqueObserved = assertProposalMatchesLargestGroupOracle({
  oracle: uniqueOracle,
  envelope: { task_state: 'awaiting_review' },
  proposal: uniqueProposal
});
assert.equal(uniqueObserved.selected_matches_oracle, true); assertions += 1;
assert.equal(uniqueObserved.oracle_target_in_top_5, true); assertions += 1;

for (const invalidProposal of [
  proposalFixture({ selectedPath: 'pid:1' }),
  { ...proposalFixture({ selectedPath: 'pid:2' }), selected_targets: [] },
  { ...proposalFixture({ selectedPath: 'pid:2' }), operation_proposal: [] }
]) {
  assert.throws(() => assertProposalMatchesLargestGroupOracle({
    oracle: uniqueOracle,
    envelope: { task_state: 'awaiting_review' },
    proposal: invalidProposal
  })); assertions += 1;
}

const tieOracle = evaluateLargestStructuralGroupOracle(graphFixture([
  groupNode('pid:1', 20),
  groupNode('pid:2', 20)
]));
assert.equal(tieOracle.public.status, 'ambiguous_volume_tie'); assertions += 1;
assert.equal(tieOracle.public.tied_maximum_count, 2); assertions += 1;
assert.equal(tieOracle.public.target_fingerprint, null); assertions += 1;
assert.doesNotThrow(() => assertProposalMatchesLargestGroupOracle({
  oracle: tieOracle,
  envelope: { task_state: 'awaiting_input' },
  proposal: abstentionProposalFixture(['multiple_similar_targets'])
})); assertions += 1;
assert.throws(() => assertProposalMatchesLargestGroupOracle({
  oracle: tieOracle,
  envelope: { task_state: 'awaiting_review' },
  proposal: proposalFixture({ selectedPath: 'pid:1' })
})); assertions += 1;

const lockedOracle = evaluateLargestStructuralGroupOracle(graphFixture([
  groupNode('pid:1', 20, { effective_locked: true }),
  groupNode('pid:2', 10)
]));
assert.equal(lockedOracle.public.status, 'largest_group_locked_or_ineligible'); assertions += 1;
assert.equal(lockedOracle.public.expected_behavior, 'ask_for_clarification'); assertions += 1;

const ineligibleOracle = evaluateLargestStructuralGroupOracle(graphFixture([
  groupNode('pid:1', 20, { allowed_operations: ['set_material'] }),
  groupNode('pid:2', 10)
]));
assert.equal(ineligibleOracle.public.status, 'largest_group_locked_or_ineligible'); assertions += 1;

const incompleteOracle = evaluateLargestStructuralGroupOracle(graphFixture([
  groupNode('pid:1', 20),
  groupNode('pid:2', 10)
], { complete: false }));
assert.equal(incompleteOracle.public.status, 'projection_incomplete'); assertions += 1;

const emptyOracle = evaluateLargestStructuralGroupOracle(graphFixture([]));
assert.equal(emptyOracle.public.status, 'no_projected_groups'); assertions += 1;
assert.equal(emptyOracle.public.largest_volume, null); assertions += 1;

assert.throws(() => evaluateLargestStructuralGroupOracle(graphFixture([
  groupNode('pid:1', -1)
]))); assertions += 1;
assert.throws(() => evaluateLargestStructuralGroupOracle({ version: 'not-model-graph' })); assertions += 1;

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-live-target-quality-'));
try {
  const modelPath = path.join(tempRoot, 'product.disposable.skp');
  await fs.writeFile(modelPath, 'prepared-model-fixture');
  const digest = crypto.createHash('sha256').update(await fs.readFile(modelPath)).digest('hex');
  const privateDir = path.join(tempRoot, 'private');
  await fs.mkdir(privateDir, { recursive: true });
  const modelRevision = `sha256:${'b'.repeat(64)}`;
  const handshake = handshakeFixture({ modelPath, modelRevision });
  const bridge = fakeBridge({ graph: uniqueGraphWithRevision(uniqueGraph, modelRevision), handshake });
  const report = await runModelTargetQualityReadOnlyFlow({
    ...validOptions,
    expectedModelSha256: digest,
    allowedModelRoot: tempRoot,
    timeoutMs: 30_000
  }, { bridge, privateDir });

  assert.equal(report.result, 'pass'); assertions += 1;
  assert.equal(report.domain, 'product'); assertions += 1;
  assert.equal(report.oracle.status, 'unique_eligible_maximum'); assertions += 1;
  assert.equal(report.agent_gateway.selected_matches_oracle, true); assertions += 1;
  assert.equal(report.agent_gateway.artifact_page_calls, 0); assertions += 1;
  assert.equal(report.model.bytes_unchanged, true); assertions += 1;
  assert.equal(report.model.revision_unchanged, true); assertions += 1;
  assert.equal(report.safety.mutation_requested, false); assertions += 1;
  assert.equal(report.acceptance.wrong_object_automatic_execution, 0); assertions += 1;
  assert.equal(report.acceptance.multi_model_target_quality, false); assertions += 1;
  assert.deepEqual(bridge.calls.map((entry) => entry.method), [
    'queue_diagnostics', 'get_capabilities', 'create_queue_handshake',
    'start_agent_task', 'getTask', 'create_queue_handshake', 'queue_diagnostics'
  ]); assertions += 1;
  const startCall = bridge.calls.find((entry) => entry.method === 'start_agent_task').input;
  assert.equal(startCall.client_capabilities.vision, false); assertions += 1;
  assert.equal(startCall.client_capabilities.local_files, false); assertions += 1;
  assert.equal(startCall.client_capabilities.structured_output, false); assertions += 1;
  assert.equal(startCall.client_capabilities.context, 'short'); assertions += 1;
  assert.equal(startCall.client_capabilities.parallel, false); assertions += 1;
  assert.equal(startCall.inputs.discovery_mode, 'structural_groups'); assertions += 1;
  assert.equal(startCall.inputs.save_model, false); assertions += 1;
  assert.equal(startCall.inputs.capture_view, false); assertions += 1;

  const schema = JSON.parse(await fs.readFile(path.join(projectRoot, 'schema/current-source-model-target-quality-live-report-v1.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors, null, 2)); assertions += 1;
  const negativeReports = [
    mutate(report, (value) => { value.safety.mutation_performed = true; }),
    mutate(report, (value) => { value.safety.queue_after.responses = 1; }),
    mutate(report, (value) => { value.acceptance.wrong_object_automatic_execution = 1; }),
    mutate(report, (value) => { value.acceptance.multi_model_target_quality = true; }),
    mutate(report, (value) => { value.acceptance.release_acceptance = true; }),
    mutate(report, (value) => { value.source_bindings[0].path = '/private/source.mjs'; }),
    mutate(report, (value) => { value.oracle.basis = 'agent_claim'; })
  ];
  for (const invalid of negativeReports) {
    assert.equal(validate(invalid), false); assertions += 1;
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  default_live_queue_calls: 0,
  unique_target_oracle: true,
  tie_abstention: true,
  locked_largest_abstention_contract: true,
  incomplete_projection_abstention: true,
  wrong_target_failed_closed: true,
  weak_client_profile: 'l0_short_context_no_files_no_vision_no_structured_output_single_tool',
  mutation_requested: false,
  negative_schema_cases: 7,
  assertions
}, null, 2)}\n`);

function graphFixture(nodes, { complete = true } = {}) {
  return {
    version: 'model-graph.v1',
    model_revision: `sha256:${'b'.repeat(64)}`,
    projections: {
      structural_groups: {
        version: 'structural-groups.v1',
        complete,
        indexed: nodes.length,
        total_seen: nodes.length,
        truncated: !complete,
        leaf_entities_materialized: false
      }
    },
    nodes
  };
}

function groupNode(entityPath, volume, overrides = {}) {
  return {
    node_id: `node_${crypto.createHash('sha256').update(entityPath).digest('hex').slice(0, 24)}`,
    node_type: 'occurrence',
    entity_type: 'group',
    projection_source: 'structural-groups.v1',
    entity_path: entityPath,
    spatial_summary: { volume },
    effective_locked: false,
    allowed_operations: ['rename'],
    ...overrides
  };
}

function proposalFixture({ selectedPath }) {
  return {
    execution_allowed: false,
    requires_clarification: false,
    candidates: [
      { entity_path: selectedPath },
      { entity_path: selectedPath === 'pid:1' ? 'pid:2' : 'pid:1' }
    ],
    selected_targets: [{ entity_path: selectedPath }],
    operation_proposal: [{ op: 'rename', entity_path: selectedPath }],
    ambiguity_reasons: []
  };
}

function abstentionProposalFixture(reasons) {
  return {
    execution_allowed: false,
    requires_clarification: true,
    candidates: [{ entity_path: 'pid:1' }, { entity_path: 'pid:2' }],
    selected_targets: [],
    operation_proposal: [],
    ambiguity_reasons: reasons
  };
}

function uniqueGraphWithRevision(graph, modelRevision) {
  return { ...structuredClone(graph), model_revision: modelRevision };
}

function handshakeFixture({ modelPath, modelRevision }) {
  return {
    session_id: 'mock-session',
    document_id: 'mock-document',
    model_identity: {
      model_guid: 'mock-guid',
      runtime_object_id: 'mock-object',
      title: 'untrusted-title',
      source_path: modelPath
    },
    model_revision: modelRevision,
    model_revision_strategy: QUEUE_MODEL_REVISION_STRATEGY,
    model_revision_unique_entity_limit: QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT,
    model_revision_complete: true,
    model_revision_total_seen: 2,
    model_revision_indexed: 2,
    model_modified: false,
    plugin_version: '0.1.0-rc.2',
    capability_version: RUNTIME_CAPABILITY_VERSION,
    manifest_version: CAPABILITY_MANIFEST_VERSION,
    dsl_version: 1,
    occurrence_contract: 'canonical-occurrence-path.v1',
    boolean_operations_sha256: BOOLEAN_OPERATIONS_SHA256,
    model_revision_source_sha256: MODEL_REVISION_SOURCE_SHA256
  };
}

function fakeBridge({ graph, handshake }) {
  const calls = [];
  const cleanQueue = {
    queue: { count: 0 },
    processing: { count: 0 },
    responses: { count: 0 },
    lock: { exists: false }
  };
  const proposal = {
    ...proposalFixture({ selectedPath: 'pid:2' }),
    model_revision: handshake.model_revision
  };
  return {
    calls,
    sessionContractAuthority: {
      async verify() {}
    },
    taskStore: {
      async getTask(taskId, options) {
        calls.push({ method: 'getTask', taskId, options });
        return { private: { model_graph: graph } };
      }
    },
    async queue_diagnostics(input) {
      calls.push({ method: 'queue_diagnostics', input });
      return structuredClone(cleanQueue);
    },
    async get_capabilities(input) {
      calls.push({ method: 'get_capabilities', input });
      return {
        runtime: {
          version: '0.1.0-rc.2',
          plugin: { sketchup_version: '26.2.242', ruby_version: '3.2.2' },
          capability_version: RUNTIME_CAPABILITY_VERSION,
          manifest_version: CAPABILITY_MANIFEST_VERSION,
          model_revision: {
            strategy: QUEUE_MODEL_REVISION_STRATEGY,
            unique_entity_limit: QUEUE_MODEL_REVISION_UNIQUE_ENTITY_LIMIT
          },
          boolean_operations_sha256: BOOLEAN_OPERATIONS_SHA256,
          model_revision_source_sha256: MODEL_REVISION_SOURCE_SHA256,
          compatibility: { ok: true, issues: [] }
        }
      };
    },
    async create_queue_handshake(input) {
      calls.push({ method: 'create_queue_handshake', input });
      return { mutates_model: false, session_contract: structuredClone(handshake) };
    },
    async start_agent_task(input) {
      calls.push({ method: 'start_agent_task', input });
      return {
        ok: true,
        task_id: 'task_00000000-0000-4000-8000-000000000001',
        task_state: 'awaiting_review',
        data: {
          kind: 'propose_existing_model_edit_result',
          target_discovery: { mode: 'structural_groups', leaf_entities_materialized: false },
          proposal
        },
        artifacts: [],
        next_action: { action: 'start_reviewed_existing_model_edit' }
      };
    }
  };
}

function mutate(value, callback) {
  const result = structuredClone(value);
  callback(result);
  return result;
}
