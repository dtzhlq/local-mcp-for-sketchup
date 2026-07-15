import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { proposeExistingModelEdit } from '../src/existing-model-edit-proposer.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-model-graph-'));
const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(root, 'session.json') },
  agentContract: { rootDir: path.join(root, 'agent-state') },
  approval: { stateDir: path.join(root, 'approvals'), secret: 'model-graph-test-secret-that-is-at-least-32-bytes' },
  executionPolicy: { allowed_runtimes: ['mock'] }
});
const results = {};

try {
  const architecture = await graphFor(domainFixture('architecture'));
  const architectureBefore = architecture.model_revision;
  const architectureProposal = proposeExistingModelEdit({
    graph: architecture,
    instruction: 'Set the largest wall to the reviewed concrete material.',
    target_query: 'largest wall',
    action: 'set_material',
    parameters: { material: 'Reviewed_Concrete' }
  });
  assert.equal(architectureProposal.requires_clarification, false);
  assert.equal(architectureProposal.execution_allowed, false);
  assert.ok(architectureProposal.operation_proposal[0].target_id || /group:/.test(architectureProposal.operation_proposal[0].entity_path));
  results.architecture = { ready: true, confidence: architectureProposal.confidence };

  const gateway = await bridge.start_agent_task({
    intent: 'propose_existing_model_edit',
    instruction: 'Set the largest wall to the reviewed concrete material.',
    client_capabilities: { vision: false, local_files: false, structured_output: true, context: 'short', parallel: false },
    idempotency_key: 'model-graph-architecture-proposal',
    inputs: { runtime: 'mock', target_query: 'largest wall', action: 'set_material', parameters: { material: 'Reviewed_Concrete' }, save_model: false }
  });
  assert.equal(gateway.task_state, 'awaiting_review');
  assert.equal(gateway.data.proposal.execution_allowed, false);
  assert.equal(gateway.next_action.tool, 'start_agent_task');
  assert.ok(gateway.artifacts.some((artifact) => artifact.label === 'model_graph'));
  const graphArtifact = gateway.artifacts.find((artifact) => artifact.label === 'model_graph');
  const readGraph = await bridge.read_agent_artifact({ handle: graphArtifact.handle, max_chars: 512 });
  assert.equal(readGraph.ok, true);
  assert.match(readGraph.data.artifact.content, /model-graph\.v1/);

  const interior = await graphFor(domainFixture('interior'));
  const interiorProposal = proposeExistingModelEdit({
    graph: interior,
    instruction: 'Rename the cabinet to Reviewed_Cabinet.',
    target_query: 'cabinet',
    action: 'rename',
    parameters: { new_name: 'Reviewed_Cabinet' }
  });
  assert.equal(interiorProposal.requires_clarification, true);
  assert.ok(interiorProposal.ambiguity_reasons.includes('multiple_similar_targets'));
  assert.equal(interiorProposal.selected_targets.length, 0);
  results.interior = { ambiguous: true, candidates: interiorProposal.candidates.length };

  const ambiguousTask = await bridge.start_agent_task({
    intent: 'propose_existing_model_edit',
    instruction: 'Rename the cabinet to Reviewed_Cabinet.',
    idempotency_key: 'model-graph-interior-proposal',
    inputs: { runtime: 'mock', target_query: 'cabinet', action: 'rename', parameters: { new_name: 'Reviewed_Cabinet' }, save_model: false }
  });
  assert.equal(ambiguousTask.task_state, 'awaiting_input');
  const clarifiedTask = await bridge.submit_agent_task_input({
    task_id: ambiguousTask.task_id,
    idempotency_key: 'model-graph-interior-clarification',
    input: { target_ref: ambiguousTask.data.proposal.candidates[0].persistent_ref }
  });
  assert.equal(clarifiedTask.task_state, 'awaiting_review');
  assert.equal(clarifiedTask.data.proposal.execution_allowed, false);

  const product = await graphFor(domainFixture('product'));
  const productProposal = proposeExistingModelEdit({
    graph: product,
    instruction: 'Attach metadata to the largest product body.',
    target_query: 'largest body',
    action: 'attribute',
    parameters: { dictionary: 'DesignIntent', key: 'reviewed', value: true }
  });
  assert.equal(productProposal.requires_clarification, false);
  assert.equal(productProposal.candidates[0].summary.value.name, 'Controller_Body');
  results.product = { ready: true, top_target: productProposal.candidates[0].summary.value.name };

  const shared = await graphFor(domainFixture('shared'));
  assert.ok(shared.stats.shared_occurrences > 0);
  assert.ok(shared.relationships.hierarchy.length > 0);
  assert.ok(shared.relationships.topology.length > 0);
  assert.ok(shared.relationships.lineage.length > 0);
  assert.equal(shared.lineage.part_graph, 'part-graph:shared-fixture');
  const sharedProposal = proposeExistingModelEdit({
    graph: shared,
    instruction: 'Rename one shared leaf.',
    target_query: 'Shared_Leaf',
    action: 'rename',
    parameters: { new_name: 'Shared_Leaf_Reviewed' }
  });
  assert.equal(sharedProposal.requires_clarification, true);
  assert.ok(sharedProposal.ambiguity_reasons.includes('shared_definition_policy_required'));
  const sharedTarget = sharedProposal.candidates.find((candidate) => candidate.summary.value.name === 'Shared_Leaf');
  const clarifiedShared = proposeExistingModelEdit({
    graph: shared,
    instruction: 'Rename only this shared leaf occurrence.',
    target_ref: sharedTarget.entity_path,
    action: 'rename',
    parameters: { new_name: 'Shared_Leaf_Reviewed' },
    shared_policy: 'make_unique'
  });
  assert.equal(clarifiedShared.requires_clarification, false);
  assert.equal(clarifiedShared.operation_proposal[0].instance_policy, 'make_unique');
  assert.ok(clarifiedShared.operation_proposal[0].instance_id);
  results.shared = { ambiguous_without_policy: true, ready_with_make_unique: true };

  await validateSchemas(shared, clarifiedShared);
  const currentRevision = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 }));
  assert.equal(currentRevision, shared.model_revision, 'proposal generation must not modify the model');
  assert.notEqual(architectureBefore, shared.model_revision, 'domain fixtures must build distinct model revisions');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    domains: results,
    wrong_target_executions: 0,
    proposal_executions: 0,
    ambiguity_asked: true,
    model_graph_stats: shared.stats
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function graphFor(document) {
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify(document) });
  const adoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 });
  const sharedPath = adoption.recursive_index?.find((entry) => entry.name === 'Shared_Leaf')?.entity_path;
  return buildModelGraph(adoption, {
    lineage: document.domain === 'shared' ? {
      part_graph: 'part-graph:shared-fixture',
      parametric_recipe: 'recipe:shared-fixture',
      feature_mapping_plan: 'feature-map:shared-fixture',
      evidence: ['evidence:shared-fixture'],
      entity_paths: { [sharedPath]: ['part:shared-leaf', 'evidence:shared-fixture'] }
    } : {}
  });
}

function domainFixture(domain) {
  const definitions = {
    architecture: {
      name: 'Architecture_Domain',
      operations: [
        { op: 'box', id: 'north-wall', name: 'North_Wall', origin: [0, 0, 0], size: [5000, 200, 3000] },
        { op: 'box', id: 'south-wall', name: 'South_Wall', origin: [0, 4000, 0], size: [3000, 200, 3000] }
      ]
    },
    interior: {
      name: 'Interior_Domain',
      operations: [
        { op: 'box', id: 'left-cabinet', name: 'Left_Cabinet', origin: [0, 0, 0], size: [900, 600, 2200] },
        { op: 'box', id: 'right-cabinet', name: 'Right_Cabinet', origin: [1200, 0, 0], size: [900, 600, 2200] }
      ]
    },
    product: {
      name: 'Product_Domain',
      operations: [
        { op: 'rounded_box', id: 'controller-body', name: 'Controller_Body', origin: [0, 0, 0], size: [180, 90, 24], radius: 12 },
        { op: 'cylinder', id: 'controller-button-a', name: 'Controller_Button_A', origin: [130, 45, 24], radius: 8, height: 5 },
        { op: 'cylinder', id: 'controller-button-b', name: 'Controller_Button_B', origin: [150, 45, 24], radius: 8, height: 5 }
      ]
    }
  };
  if (domain === 'shared') {
    return {
      domain,
      version: 1,
      units: 'mm',
      operations: [
        { op: 'reset' },
        { op: 'component_definition', name: 'Shared_Leaf_Definition', operations: [
          { op: 'box', id: 'shared-leaf', name: 'Shared_Leaf', origin: [0, 0, 0], size: [100, 60, 30] }
        ] },
        { op: 'component_definition', name: 'Shared_Parent_Definition', operations: [
          { op: 'component_instance', id: 'shared-leaf-instance', name: 'Shared_Leaf_Instance', definition: 'Shared_Leaf_Definition', origin: [0, 0, 0] }
        ] },
        { op: 'component_instance', id: 'shared-parent-a', name: 'Shared_Parent_A', definition: 'Shared_Parent_Definition', origin: [0, 0, 0] },
        { op: 'component_instance', id: 'shared-parent-b', name: 'Shared_Parent_B', definition: 'Shared_Parent_Definition', origin: [250, 0, 0] }
      ]
    };
  }
  const definition = definitions[domain];
  return {
    domain,
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Reviewed_Concrete', color: '#999999' },
      { op: 'component_definition', name: definition.name, operations: definition.operations },
      { op: 'component_instance', id: `${domain}-domain-instance`, name: `${domain}_domain_instance`, definition: definition.name, origin: [0, 0, 0] }
    ]
  };
}

async function validateSchemas(graph, proposal) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  const graphSchema = JSON.parse(await fs.readFile(path.resolve('schema/model-graph-v1.schema.json'), 'utf8'));
  const proposalSchema = JSON.parse(await fs.readFile(path.resolve('schema/existing-model-edit-proposal-v1.schema.json'), 'utf8'));
  assert.equal(ajv.validate(graphSchema, graph), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(proposalSchema, proposal), true, JSON.stringify(ajv.errors));
}
