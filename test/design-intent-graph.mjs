import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  acceptReconciliation,
  buildDesignIntentGraph,
  planDesignParameterChange,
  reconcileDesignIntentGraph,
  writeDesignArtifact
} from '../src/design-intent-graph.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-design-intent-'));
const TEST_MODEL_KEY = `model_${'d'.repeat(32)}`;
const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(root, 'session.json') },
  agentContract: { rootDir: path.join(root, 'agent-state') },
  approval: { stateDir: path.join(root, 'approvals'), secret: 'design-intent-test-secret-that-is-at-least-32-bytes' },
  executionPolicy: { allowed_runtimes: ['mock'] }
});

try {
  const architecture = architectureFixture();
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify(architecture.document) });
  let modelGraph = await currentModelGraph();
  const designGraph = buildDesignIntentGraph({ modelKey: TEST_MODEL_KEY, modelGraph, ...architecture.artifacts });
  assert.equal(designGraph.stats.parameters, 2);
  assert.ok(designGraph.bidirectional.design_to_entities['parameter:door_width_mm'].includes('target_id:main-door'));
  assert.ok(designGraph.bidirectional.entity_to_design['target_id:main-wall'].includes('part:wall-main'));

  const doorPlan = planDesignParameterChange({
    designGraph,
    currentModelGraph: modelGraph,
    changes: { door_width_mm: 1200 },
    instruction: 'Increase the main door width to 1200 mm.'
  });
  assert.equal(doorPlan.blockers.length, 0);
  assert.equal(doorPlan.execution_allowed, false);
  assert.equal(doorPlan.affected_subgraph.length, 1);
  assert.equal(doorPlan.operations[0].op, 'erase_entities');
  assert.equal(doorPlan.operations.find((operation) => operation.id === 'main-door').size[0], 1200);

  const reviewed = await bridge.prepare_existing_model_edit({
    runtime: 'mock',
    instruction: 'Apply the reviewed DesignIntentGraph door width rebuild.',
    targets: doorPlan.targets,
    operations: doorPlan.operations,
    output_dir: path.join(root, 'door-change-prepare')
  });
  assert.equal(reviewed.plan.risk_level, 'S4');
  const token = await bridge.approvalAuthority.approveChallengeFromTrustedUser(
    reviewed.approval_challenge,
    { user_id: 'design-reviewer', channel: 'local-user-presence-test', confirmed: true }
  );
  await bridge.apply_reviewed_model_edit({
    runtime: 'mock',
    plan: reviewed.plan,
    approval_token: token,
    output_dir: path.join(root, 'door-change-apply'),
    save_model: false
  });
  let inspected = await bridge.inspect_model({ runtime: 'mock' });
  assert.equal(inspected.entities.find((entity) => entity.id === 'main-door').bounding_box.w, 1200);

  modelGraph = await currentModelGraph();
  const expectedReconciliation = reconcileDesignIntentGraph({ designGraph, currentModelGraph: modelGraph, acceptedChangePlan: doorPlan });
  assert.equal(expectedReconciliation.expected_changes.length, 1, JSON.stringify(expectedReconciliation, null, 2));
  assert.equal(expectedReconciliation.unexpected_divergence.length, 0);
  assert.equal(expectedReconciliation.review_required, true);
  const updatedDesignGraph = acceptReconciliation({
    designGraph,
    currentModelGraph: modelGraph,
    reconciliation: expectedReconciliation,
    decision: 'accept_reviewed_parameter_change',
    acceptedChangePlan: doorPlan
  });
  assert.equal(updatedDesignGraph.parameters.door_width_mm.value, 1200);
  assert.equal(updatedDesignGraph.correction_history.length, 1);

  const savedPath = path.join(root, 'architecture-reopen.json');
  await bridge.save_model({ runtime: 'mock', path: savedPath, keep_session: true });
  await bridge.open_model({ runtime: 'mock', path: savedPath });
  modelGraph = await currentModelGraph();
  const reopenedReconciliation = reconcileDesignIntentGraph({ designGraph: updatedDesignGraph, currentModelGraph: modelGraph });
  assert.equal(reopenedReconciliation.aligned, true, 'save/reopen must preserve persistent design lineage');

  await bridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [
    { op: 'material', name: 'Manual_Red', color: '#cc0000' },
    { op: 'set_material', target_id: 'main-door', material: 'Manual_Red' }
  ] }) });
  modelGraph = await currentModelGraph();
  const manualReconciliation = reconcileDesignIntentGraph({ designGraph: updatedDesignGraph, currentModelGraph: modelGraph });
  assert.equal(manualReconciliation.unexpected_divergence.length, 1);
  assert.equal(manualReconciliation.review_required, true);
  assert.equal(manualReconciliation.silent_overwrite_allowed, false);

  const wallPlanBlocked = planDesignParameterChange({
    designGraph: updatedDesignGraph,
    currentModelGraph: modelGraph,
    changes: { wall_thickness_mm: 240 },
    instruction: 'Increase wall thickness and preserve associated door and window.'
  });
  assert.deepEqual(wallPlanBlocked.blockers, ['manual_or_external_divergence_requires_reconciliation']);
  assert.equal(wallPlanBlocked.operations.length, 0);

  const product = productFixture();
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify(product.document) });
  const productModelGraph = await currentModelGraph();
  const productDesignGraph = buildDesignIntentGraph({ modelKey: TEST_MODEL_KEY, modelGraph: productModelGraph, ...product.artifacts });
  const holePlan = planDesignParameterChange({
    designGraph: productDesignGraph,
    currentModelGraph: productModelGraph,
    changes: { hole_diameter_mm: 20 },
    instruction: 'Increase the reviewed mounting hole diameter to 20 mm.'
  });
  assert.equal(holePlan.blockers.length, 0);
  assert.equal(holePlan.operations.find((operation) => operation.op === 'cut_hole').radius, 10);

  for (const [field, value] of [
    ['world_transform', [1, 0, 0, 10, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]],
    ['geometry_summary', { type: 'face', area_mm2: 1234 }],
    ['back_material', 'Fingerprint_Back'],
    ['texture_transform', { u_scale: 2, v_scale: 1 }],
    ['face_uvs', [[0, 0], [1, 0], [1, 1]]],
    ['reversed', true],
    ['soft', true],
    ['smooth', true],
    ['effective_locked', true],
    ['shared_definition', true],
    ['affected_instance_count', 3]
  ]) {
    const drifted = structuredClone(productModelGraph);
    drifted.nodes.find((node) => node.reference === 'mounting-panel')[field] = value;
    const blockedByFingerprint = planDesignParameterChange({
      designGraph: productDesignGraph,
      currentModelGraph: drifted,
      changes: { hole_diameter_mm: 20 }
    });
    assert.deepEqual(blockedByFingerprint.blockers, ['manual_or_external_divergence_requires_reconciliation'], `${field} must participate in the binding fingerprint`);
    assert.equal(blockedByFingerprint.divergence[0].status, 'changed');
  }

  const invalidDslArtifacts = structuredClone(product.artifacts);
  invalidDslArtifacts.entityBindings[0].rebuild_template.push({ op: 'not_a_registered_safe_operation' });
  const invalidDslGraph = buildDesignIntentGraph({ modelKey: TEST_MODEL_KEY, modelGraph: productModelGraph, ...invalidDslArtifacts });
  assert.throws(
    () => planDesignParameterChange({
      designGraph: invalidDslGraph,
      currentModelGraph: productModelGraph,
      changes: { hole_diameter_mm: 20 }
    }),
    (error) => error?.code === 'INVALID_ARGUMENT' && /safe-DSL contract/.test(error.message),
    'DesignIntent rebuild operations must pass the shared operation registry contract'
  );

  const ambiguousModelGraph = structuredClone(productModelGraph);
  const ambiguousOriginal = ambiguousModelGraph.nodes.find((node) => node.reference === 'mounting-panel');
  ambiguousModelGraph.nodes.push({
    ...structuredClone(ambiguousOriginal),
    node_id: `node_${'9'.repeat(24)}`,
    reference: 'mounting-panel-copy',
    persistent_id: 'mounting-panel-copy',
    entity_path: 'mock:mounting-panel-copy'
  });
  const ambiguousArtifacts = structuredClone(product.artifacts);
  ambiguousArtifacts.entityBindings[0].entity = { target_id: ambiguousOriginal.name };
  assert.throws(
    () => buildDesignIntentGraph({ modelKey: TEST_MODEL_KEY, modelGraph: ambiguousModelGraph, ...ambiguousArtifacts }),
    (error) => error?.code === 'INVALID_ARGUMENT'
      && error?.details?.mapping_status === 'ambiguous'
      && error?.details?.candidate_count === 2,
    'tied name matches must never be persisted as an entity binding'
  );

  const queueAdoption = JSON.parse(await fs.readFile(path.resolve('test/fixtures/model-graph/queue-pid-adoption.json'), 'utf8'));
  const queueModelGraph = buildModelGraph(queueAdoption);
  const queueArtifacts = {
    parametricRecipe: { version: 1, id: 'queue-wall-recipe', parameters: [{ id: 'wall_depth_mm', default: 200, type: 'number', unit: 'mm' }] },
    featureMappingPlan: { version: 1, id: 'queue-wall-map' },
    partGraph: { version: 1, id: 'queue-wall-parts', parts: [{ id: 'north-wall' }] },
    entityBindings: [{
      binding_id: 'queue-north-wall-binding',
      part_id: 'north-wall',
      feature_id: 'wall-depth',
      entity: { entity_path: 'pid:101.201', edit_scope: 'instance_path', instance_policy: 'definition_wide' },
      parameter_bindings: ['wall_depth_mm'],
      rebuild_template: [{ op: 'box', id: 'north-wall', name: 'North_Wall', origin: [0, 0, 0], size: [5000, { $parameter: 'wall_depth_mm' }, 3000] }]
    }]
  };
  const queueDesignGraph = buildDesignIntentGraph({ modelKey: TEST_MODEL_KEY, modelGraph: queueModelGraph, ...queueArtifacts });
  assert.deepEqual(queueDesignGraph.bindings[0].persistent_ref, {
    entity_path: 'pid:101.201',
    edit_scope: 'instance_path',
    instance_policy: 'definition_wide'
  });
  const fuzzyQueueArtifacts = structuredClone(queueArtifacts);
  fuzzyQueueArtifacts.entityBindings[0].entity = { target_id: 'North_Wall' };
  assert.throws(
    () => buildDesignIntentGraph({ modelKey: TEST_MODEL_KEY, modelGraph: queueModelGraph, ...fuzzyQueueArtifacts }),
    (error) => error?.code === 'INVALID_ARGUMENT' && /untrusted name/.test(error.message),
    'queue-shaped graphs must never persist fuzzy name-only mappings'
  );

  const interior = interiorFixture();
  await bridge.build_model({ runtime: 'mock', code: JSON.stringify(interior.document) });
  const interiorModelGraph = await currentModelGraph();
  const interiorDesignGraph = buildDesignIntentGraph({ modelKey: TEST_MODEL_KEY, modelGraph: interiorModelGraph, ...interior.artifacts });
  const arrayPlan = planDesignParameterChange({
    designGraph: interiorDesignGraph,
    currentModelGraph: interiorModelGraph,
    changes: { shelf_count: 4 },
    instruction: 'Change the interior shelf array count to four.'
  });
  assert.equal(arrayPlan.blockers.length, 0);
  assert.equal(arrayPlan.operations.filter((operation) => operation.op === 'box').length, 4);
  assert.deepEqual(arrayPlan.operations.filter((operation) => operation.op === 'box').map((operation) => operation.id), ['shelf-0', 'shelf-1', 'shelf-2', 'shelf-3']);

  const gatewayTask = await bridge.start_agent_task({
    intent: 'modify_design_parameters',
    instruction: 'Change the interior shelf array count to four.',
    idempotency_key: 'design-intent-interior-array',
    inputs: {
      runtime: 'mock',
      save_model: false,
      parametric_recipe: interior.artifacts.parametricRecipe,
      feature_mapping_plan: interior.artifacts.featureMappingPlan,
      part_graph: interior.artifacts.partGraph,
      entity_bindings: interior.artifacts.entityBindings,
      changes: { shelf_count: 4 }
    }
  });
  assert.equal(gatewayTask.task_state, 'awaiting_review');
  assert.equal(gatewayTask.data.change_plan.execution_allowed, false);
  assert.equal(gatewayTask.data.change_plan.operation_count, 5);
  const gatewayProjection = await expandedEnvelopeDocument(bridge, gatewayTask);
  assert.equal(gatewayProjection.result.change_plan.operations.filter((operation) => operation.op === 'box').length, 4);
  assert.ok(gatewayProjection.artifacts.some((artifact) => artifact.label === 'design_intent_graph'));

  const privateArtifactPath = path.join(root, 'permission-check', 'design-artifact.json');
  await writeDesignArtifact(privateArtifactPath, { version: 'permission-check.v1' });
  assert.equal((await fs.stat(privateArtifactPath)).mode & 0o777, 0o600, 'DesignIntent task artifacts must be owner-only');

  await validateSchemas(updatedDesignGraph, doorPlan, manualReconciliation);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    domains: ['architecture', 'product', 'interior'],
    parameter_changes: ['door_width_mm', 'wall_thickness_mm', 'hole_diameter_mm', 'shelf_count'],
    reviewed_rebuild_executed: true,
    save_reopen_lineage_stable: true,
    manual_divergence_detected: true,
    silent_overwrite: false,
    gateway_preview_only: true,
    canonical_occurrence_mapping: true,
    ambiguous_mapping_fail_closed: true,
    expanded_fingerprint_coverage: true,
    shared_dsl_contract_validated: true,
    private_artifact_mode: '0600',
    runtime: 'mock-only-no-queue'
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function currentModelGraph() {
  return buildModelGraph(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 5000 }));
}

function architectureFixture() {
  const parametricRecipe = {
    version: 1,
    id: 'architecture-door-wall-recipe',
    parameters: [
      { id: 'door_width_mm', default: 900, type: 'number', unit: 'mm', minimum: 700, maximum: 1800 },
      { id: 'wall_thickness_mm', default: 160, type: 'number', unit: 'mm', minimum: 80, maximum: 500 }
    ]
  };
  const featureMappingPlan = { version: 1, id: 'architecture-door-wall-map' };
  const partGraph = { version: 1, id: 'architecture-door-wall-parts', parts: [{ id: 'wall-main' }, { id: 'door-main' }, { id: 'window-main' }] };
  const entityBindings = [
    {
      binding_id: 'wall-binding', part_id: 'wall-main', feature_id: 'wall-thickness', entity: { target_id: 'main-wall' },
      parameter_bindings: ['wall_thickness_mm'], associated_binding_ids: ['door-binding', 'window-binding'],
      rebuild_template: [{ op: 'box', id: 'main-wall', name: 'Main_Wall', origin: [0, 0, 0], size: [5000, { $parameter: 'wall_thickness_mm' }, 2800] }]
    },
    {
      binding_id: 'door-binding', part_id: 'door-main', feature_id: 'door-width', entity: { target_id: 'main-door' },
      parameter_bindings: ['door_width_mm', 'wall_thickness_mm'],
      rebuild_template: [{ op: 'box', id: 'main-door', name: 'Main_Door', origin: [500, 0, 0], size: [{ $parameter: 'door_width_mm' }, { $parameter: 'wall_thickness_mm' }, 2100] }]
    },
    {
      binding_id: 'window-binding', part_id: 'window-main', feature_id: 'associated-window', entity: { target_id: 'main-window' },
      parameter_bindings: ['wall_thickness_mm'],
      rebuild_template: [{ op: 'box', id: 'main-window', name: 'Main_Window', origin: [2500, 0, 900], size: [1200, { $parameter: 'wall_thickness_mm' }, 1000] }]
    }
  ];
  return {
    document: { version: 1, units: 'mm', operations: [
      { op: 'reset' },
      { op: 'box', id: 'main-wall', name: 'Main_Wall', origin: [0, 0, 0], size: [5000, 160, 2800] },
      { op: 'box', id: 'main-door', name: 'Main_Door', origin: [500, 0, 0], size: [900, 160, 2100] },
      { op: 'box', id: 'main-window', name: 'Main_Window', origin: [2500, 0, 900], size: [1200, 160, 1000] }
    ] },
    artifacts: { parametricRecipe, featureMappingPlan, partGraph, entityBindings }
  };
}

function productFixture() {
  const parametricRecipe = { version: 1, id: 'product-hole-recipe', parameters: [{ id: 'hole_diameter_mm', default: 12, type: 'number', unit: 'mm', minimum: 4, maximum: 40 }] };
  const featureMappingPlan = { version: 1, id: 'product-hole-map' };
  const partGraph = { version: 1, id: 'product-hole-parts', parts: [{ id: 'mounting-panel' }] };
  const entityBindings = [{
    binding_id: 'mounting-panel-binding', part_id: 'mounting-panel', feature_id: 'mounting-hole', entity: { target_id: 'mounting-panel' },
    parameter_bindings: ['hole_diameter_mm'],
    rebuild_template: [
      { op: 'box', id: 'mounting-panel', name: 'Mounting_Panel', origin: [0, 0, 0], size: [160, 100, 12] },
      { op: 'cut_hole', target_id: 'mounting-panel', center: [80, 50], radius: { $expression: { parameter: 'hole_diameter_mm', op: 'divide', value: 2 } }, feature_id: 'mounting-hole' }
    ]
  }];
  return {
    document: { version: 1, units: 'mm', operations: [
      { op: 'reset' },
      { op: 'box', id: 'mounting-panel', name: 'Mounting_Panel', origin: [0, 0, 0], size: [160, 100, 12] },
      { op: 'cut_hole', target_id: 'mounting-panel', center: [80, 50], radius: 6, feature_id: 'mounting-hole' }
    ] },
    artifacts: { parametricRecipe, featureMappingPlan, partGraph, entityBindings }
  };
}

function interiorFixture() {
  const parametricRecipe = { version: 1, id: 'interior-shelf-recipe', parameters: [{ id: 'shelf_count', default: 2, type: 'integer', minimum: 1, maximum: 8 }] };
  const featureMappingPlan = { version: 1, id: 'interior-shelf-map' };
  const partGraph = { version: 1, id: 'interior-shelf-parts', parts: [{ id: 'shelf-array' }] };
  const entityBindings = [{
    binding_id: 'shelf-array-binding', part_id: 'shelf-array', feature_id: 'vertical-array', entity: { target_id: 'shelf-0' },
    existing_targets: [{ target_id: 'shelf-0' }, { target_id: 'shelf-1' }],
    parameter_bindings: ['shelf_count'],
    repeat: { count_parameter: 'shelf_count', index_base: 0 },
    rebuild_template: [{
      op: 'box', id: 'shelf-$index', name: 'Shelf_$index',
      origin: [0, 0, { $expression: { source: 'index', op: 'multiply', value: 320 } }],
      size: [1200, 400, 24]
    }]
  }];
  return {
    document: { version: 1, units: 'mm', operations: [
      { op: 'reset' },
      { op: 'box', id: 'shelf-0', name: 'Shelf_0', origin: [0, 0, 0], size: [1200, 400, 24] },
      { op: 'box', id: 'shelf-1', name: 'Shelf_1', origin: [0, 0, 320], size: [1200, 400, 24] }
    ] },
    artifacts: { parametricRecipe, featureMappingPlan, partGraph, entityBindings }
  };
}

async function expandedEnvelopeDocument(targetBridge, envelope) {
  const handle = envelope.presentation?.full_result_artifact;
  if (!handle) {
    return {
      result: envelope.data,
      next_action: envelope.next_action,
      artifacts: envelope.artifacts || []
    };
  }
  return JSON.parse(await readArtifactText(targetBridge, handle, envelope.task_id));
}

async function readArtifactText(targetBridge, handle, taskId) {
  const handleMatch = /^artifact:(task_[0-9a-f-]+):[0-9a-f-]+$/i.exec(String(handle));
  assert.ok(handleMatch, 'The full projection must use an opaque task artifact handle.');
  assert.equal(handleMatch[1], taskId, 'The full projection artifact must be bound to its owning task.');

  let offset = 0;
  let content = '';
  while (true) {
    const page = await targetBridge.read_agent_artifact({
      handle,
      task_id: taskId,
      offset,
      max_chars: 1024
    });
    assert.equal(page.ok, true, JSON.stringify(page.error));
    assert.equal(page.task_id, taskId);
    assert.equal(page.data?.artifact?.handle, handle);
    assert.equal(page.data?.artifact?.offset, offset);
    assert.equal(typeof page.data?.artifact?.content, 'string');
    content += page.data.artifact.content;
    if (page.data.artifact.eof) {
      assert.equal(page.data.artifact.next_offset, null);
      return content;
    }
    assert.ok(Number.isInteger(page.data.artifact.next_offset) && page.data.artifact.next_offset > offset);
    offset = page.data.artifact.next_offset;
  }
}

async function validateSchemas(graph, plan, reconciliation) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  for (const [file, value] of [
    ['design-intent-graph-v1.schema.json', graph],
    ['design-parameter-change-plan-v1.schema.json', plan],
    ['design-intent-reconciliation-v1.schema.json', reconciliation]
  ]) {
    const schema = JSON.parse(await fs.readFile(path.resolve('schema', file), 'utf8'));
    assert.equal(ajv.validate(schema, value), true, `${file}: ${JSON.stringify(ajv.errors)}`);
  }
}
