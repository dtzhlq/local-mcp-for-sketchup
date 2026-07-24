import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  existingModelEditPlanHash,
  existingModelEditExecutionTargetValidationPolicy,
  observeExistingModelEditExecutionState,
  validateExistingModelEditOperations
} from '../src/existing-model-editing.mjs';
import {
  assertReadyForApprovedSubmission,
  buildTrimbleCorrectionOperations,
  trimbleS6ExpectedContactPairs,
  TRIMBLE_S6_REFERENCE_CORRECTION_VERSION
} from '../scripts/run-trimble-s6-reference-correction-live.mjs';

const operations = buildTrimbleCorrectionOperations();
const validation = validateExistingModelEditOperations(operations);
const materialUpdates = operations.filter((operation) => operation.op === 'material');
const lowerCoverUpdates = operations.filter((operation) => operation.op === 'set_material');
const additions = operations.filter((operation) => !['material', 'set_material'].includes(operation.op));

assert.equal(TRIMBLE_S6_REFERENCE_CORRECTION_VERSION, 'trimble-s6-reference-correction-live.v1');
assert.equal(operations.length, 26);
assert.equal(materialUpdates.length, 4);
assert.equal(lowerCoverUpdates.length, 1);
assert.equal(additions.length, 21);
const expectedContactPairs = trimbleS6ExpectedContactPairs();
assert.equal(expectedContactPairs.length, 30);
assert.equal(new Set(expectedContactPairs.map(({ item, with: withRef }) => [item, withRef].sort().join('::'))).size, 30);
assert.ok(expectedContactPairs.some(({ item, with: withRef }) => item === 'ALMA_Trimble_S6_Tripod_Head_Top' && withRef === 'pid:89456'));
assert.equal(additions.reduce((count, operation) => count + (operation.qa?.expected_contacts?.length || 0), 0), 30);
assert.ok(additions.flatMap((operation) => operation.qa?.expected_contacts || [])
  .every((contact) => contact.bucket === 'intentional_assembly_joint'));
assert.equal(validation.risk_level, 'S3');
assert.equal(validation.operation_contracts.filter((contract) => contract.resource_mutation).length, 4);
assert.ok(validation.operation_contracts.filter((contract) => contract.resource_mutation).every((contract) => contract.risk === 'S2'));
assert.equal(validation.operation_contracts.find((contract) => contract.op === 'set_material').risk, 'S1');
assert.ok(validation.operation_contracts.filter((contract) => !contract.resource_mutation && contract.op !== 'set_material').every((contract) => contract.risk === 'S3'));
assert.equal(new Set(additions.map((operation) => operation.id)).size, additions.length);
assert.equal(new Set(additions.map((operation) => operation.name)).size, additions.length);
assert.ok(additions.every((operation) => !Object.hasOwn(operation, 'target_id') && !Object.hasOwn(operation, 'entity_path')));
assert.ok(additions.every((operation) => operation.qa?.fallback_state === 'reviewed_geometric_approximation'));
assert.ok(additions.every((operation) => operation.qa?.evidence_status === 'inferred'));
assert.deepEqual(materialUpdates.map((operation) => operation.name), [
  '[Color_D06]',
  '[Color_005]',
  '[Color_003]',
  '[Color_D02]'
]);
assert.equal(materialUpdates[0].color, '#32373e');
assert.equal(materialUpdates[1].color, '#f4c400');

assert.doesNotThrow(() => assertReadyForApprovedSubmission({
  task_state: 'awaiting_review',
  next_action: { action: 'submit_task_input', required: ['session_contract'] }
}, 'task-projected-approved'));
assert.throws(() => assertReadyForApprovedSubmission({
  task_state: 'awaiting_review',
  next_action: { action: 'request_user_approval', required: ['session_contract'] }
}, 'task-not-approved'), /has not been approved/);

assert.deepEqual(lowerCoverUpdates[0], {
  op: 'set_material',
  entity_path: 'pid:89455',
  material: '[Color_005]',
  qa: {
    role: 'existing_lower_front_cover_material',
    evidence_status: 'inferred',
    fallback_state: 'reviewed_geometric_approximation',
    evidence_sources: []
  }
});
assert.equal(additions.some((operation) => /Lower_Panel/.test(operation.name)), false);

const yellowLegs = additions.filter((operation) => /-leg-\d-yellow$/.test(operation.id));
assert.equal(yellowLegs.length, 3);
assert.ok(yellowLegs.every((operation) => operation.op === 'pipe_between_points' && operation.material === '[Color_005]'));
assert.ok(yellowLegs.every((operation) => operation.points[1][2] < -160000));

const outputRoot = path.resolve('output/trimble-s6-reference-correction/test');
await fs.rm(outputRoot, { recursive: true, force: true });
const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(outputRoot, 'mock-session.json') },
  agentContract: { rootDir: path.join(outputRoot, 'agent-state') },
  approval: {
    stateDir: path.join(outputRoot, 'approvals'),
    secret: 'trimble-s6-reference-correction-test-secret-32-bytes'
  },
  executionPolicy: {
    allowed_runtimes: ['mock'],
    auto_approve_risks: [],
    resource_limits: { max_operations: 100, max_affected_instances: 100, max_recursive_entities: 1000 }
  }
});
await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: '[Color_D06]', color: '#cc9900' },
    { op: 'material', name: '[Color_005]', color: '#727272' },
    { op: 'material', name: '[Color_003]', color: '#aaaaaa' },
    { op: 'material', name: '[Color_D02]', color: '#ffcc32' },
    { op: 'material', name: '[Color_008]', color: '#1e1e1e' },
    { op: 'box', id: 'trimble-test-lower-cover', name: 'Trimble_Test_Lower_Cover', origin: [529000, 438000, -88000], size: [27000, 6000, 1500], material: '[Color_D06]' },
    { op: 'box', id: 'trimble-test-anchor', name: 'Trimble_Test_Anchor', origin: [530000, 450000, -90000], size: [25000, 30000, 60000], material: '[Color_D06]' }
  ]
}) });
await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 1000, read_only: true });
const mockOperations = operations.map((operation) => {
  if (operation.entity_path !== 'pid:89455') return operation;
  const { entity_path, ...rest } = operation;
  return { ...rest, target_id: 'trimble-test-lower-cover' };
});
const task = await bridge.start_agent_task({
  intent: 'reviewed_existing_model_edit',
  instruction: 'Mock prepare of the full reference-bound Trimble correction.',
  interface_level: 'guided',
  client_capabilities: { vision: false, local_files: false, structured_output: true, parallel: false, context: 'short' },
  idempotency_key: 'trimble-s6-reference-correction-mock-prepare-v1',
  inputs: {
    runtime: 'mock',
    recursive_limit: 1000,
    budgets: { max_operations: 100, max_affected_instances: 10, recursive_limit: 1000 },
    save_model: false,
    capture_view: false,
    targets: [{ target_id: 'trimble-test-anchor' }, { target_id: 'trimble-test-lower-cover' }],
    operations: mockOperations
  }
});
assert.equal(task.ok, true);
assert.equal(task.task_state, 'awaiting_review');
assert.equal(task.result.risk_level, 'S3');
const persistedTask = await bridge.taskStore.getTask(task.task_id, { includePrivate: true });
assert.equal(persistedTask.result.approval_challenge.review_context.operations.length, operations.length);
assert.equal(persistedTask.result.approval_challenge.review_context.operations[0].resource_scope, 'model_material_definition');
assert.equal(
  existingModelEditExecutionTargetValidationPolicy(persistedTask.private.existing_edit_plan).mode,
  'full_recursive'
);
const liveAnchoredPlan = structuredClone(persistedTask.private.existing_edit_plan);
liveAnchoredPlan.targets = [{
  entity_path: 'pid:89456',
  edit_scope: 'instance_path',
  instance_policy: 'definition_wide',
  entity: { entity_type: 'group' }
}, {
  entity_path: 'pid:89455',
  edit_scope: 'instance_path',
  instance_policy: 'definition_wide',
  entity: { entity_type: 'group' }
}];
liveAnchoredPlan.dsl_document.operations = structuredClone(operations);
liveAnchoredPlan.target_validation = {
  ...liveAnchoredPlan.target_validation,
  mode: 'full_recursive',
  complete: true,
  truncated: false,
  sufficient_for_review: true,
  requested_target_count: 2,
  exact_target_count: 2
};
assert.deepEqual(
  existingModelEditExecutionTargetValidationPolicy(liveAnchoredPlan),
  {
    version: 'existing-edit-execution-target-validation.v1',
    mode: 'structural_groups',
    source: 'hash_bound_top_level_group_plan',
    structural_group_limit: 5000,
    leaf_entities_materialized: false
  }
);
const liveCorrectionPlan = structuredClone(liveAnchoredPlan);
liveCorrectionPlan.targets = [
  { entity_path: 'pid:89455', instance_policy: 'definition_wide', entity: { entity_type: 'group' } },
  { entity_path: 'pid:89498', instance_policy: 'definition_wide', entity: { entity_type: 'group' } },
  { entity_path: 'pid:89718', instance_policy: 'definition_wide', entity: { entity_type: 'group' } }
];
liveCorrectionPlan.target_validation.requested_target_count = 3;
liveCorrectionPlan.target_validation.exact_target_count = 3;
liveCorrectionPlan.dsl_document.operations = [
  { op: 'delete', entity_path: 'pid:89498' },
  { op: 'delete', entity_path: 'pid:89718' },
  { op: 'set_material', entity_path: 'pid:89455', material: '[Color_005]' }
];
liveCorrectionPlan.plan_hash = existingModelEditPlanHash(liveCorrectionPlan);
assert.deepEqual(
  existingModelEditExecutionTargetValidationPolicy(liveCorrectionPlan),
  {
    version: 'existing-edit-execution-target-validation.v1',
    mode: 'structural_groups',
    source: 'hash_bound_top_level_group_plan',
    structural_group_limit: 5000,
    leaf_entities_materialized: false
  }
);
const structuralAfterDelete = await bridge.adopt_open_model({
  runtime: 'mock',
  recursive: false,
  read_only: true,
  structural_groups: true,
  structural_group_limit: 5000
});
structuralAfterDelete.structural_groups.entries = [{
  ...structuralAfterDelete.structural_groups.entries[0],
  entity_path: 'pid:89455',
  persistent_id_path: '89455',
  persistent_id: '89455',
  entity_type: 'group',
  locked: false,
  effective_locked: false
}];
structuralAfterDelete.structural_groups.returned = 1;
structuralAfterDelete.structural_groups.total_seen = 1;
const afterDeleteObservation = await observeExistingModelEditExecutionState({
  bridge: { adopt_open_model: async () => structuredClone(structuralAfterDelete) },
  plan: liveCorrectionPlan,
  runtime: 'mock',
  phase: 'iteration_after',
  expected_model_key: liveCorrectionPlan.model_key
});
assert.equal(afterDeleteObservation.summary.requested_target_count, 3);
assert.equal(afterDeleteObservation.summary.exact_target_count, 1);
assert.equal(afterDeleteObservation.summary.exact_targets_verified, true);
assert.equal(afterDeleteObservation.summary.expected_present_target_count, 1);
assert.equal(afterDeleteObservation.summary.expected_absent_target_count, 2);
assert.equal(afterDeleteObservation.summary.verified_absent_target_count, 2);
assert.equal(afterDeleteObservation.summary.target_postconditions_verified, true);
const executionPolicy = existingModelEditExecutionTargetValidationPolicy(liveAnchoredPlan);
const executionPhase = (phase) => ({
  phase,
  mode: executionPolicy.mode,
  model_key: `model_${'a'.repeat(32)}`,
  model_revision: `sha256:${'b'.repeat(64)}`,
  requested_target_count: 2,
  exact_target_count: 2,
  destructive_side_effect_target_count: 0,
  exact_targets_verified: true,
  locked_target_count: 0,
  leaf_entities_materialized: false,
  recursive_indexed: 0,
  recursive_truncated: false,
  structural_group_limit: 5000
});
const deletionExecutionPhase = {
  ...executionPhase('iteration_after'),
  requested_target_count: 3,
  exact_target_count: 1,
  expected_present_target_count: 1,
  expected_absent_target_count: 2,
  verified_absent_target_count: 2,
  target_postconditions_verified: true
};
const executionValidation = {
  version: executionPolicy.version,
  mode: executionPolicy.mode,
  source: executionPolicy.source,
  leaf_entities_materialized: executionPolicy.leaf_entities_materialized,
  phases: {
    apply_preflight: executionPhase('apply_preflight'),
    iteration_before: executionPhase('iteration_before'),
    iteration_after: deletionExecutionPhase
  }
};
const executionSchema = JSON.parse(await fs.readFile(
  path.resolve('schema/existing-edit-execution-target-validation-v1.schema.json'),
  'utf8'
));
const validateExecution = new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(executionSchema);
assert.equal(validateExecution(executionValidation), true, JSON.stringify(validateExecution.errors));

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: TRIMBLE_S6_REFERENCE_CORRECTION_VERSION,
  operation_count: operations.length,
  material_resource_updates: materialUpdates.length,
  existing_cover_updates: lowerCoverUpdates.length,
  additive_groups: additions.length,
  expected_assembly_contacts: expectedContactPairs.length,
  risk_level: validation.risk_level,
  unique_ids: true,
  targetless_additions: true,
  bounded_execution_probe: true,
  agent_gateway_prepare: true
}, null, 2)}\n`);
