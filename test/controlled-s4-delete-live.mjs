import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  observeExistingModelEditExecutionState,
  inferExistingModelEditDestructiveSideEffects,
  validateExistingModelEditOperations
} from '../src/existing-model-editing.mjs';
import {
  assertControlledS4Preconditions,
  assertQueueIdle,
  assertReadyForApprovedSubmission,
  CONTROLLED_S4_DELETE_PROFILE,
  CONTROLLED_S4_DELETE_VERSION,
  controlledS4DeleteOperations,
  controlledS4DeleteTargets,
  verifyControlledS4Deletion
} from '../scripts/run-controlled-s4-delete-live.mjs';

const expectedModelPath = path.resolve('output/live-validation/next-models/controlled-s4-delete-2026-07-22-v1/Fire Escape.disposable.skp');
const operations = controlledS4DeleteOperations();
const validation = validateExistingModelEditOperations(operations);

assert.equal(CONTROLLED_S4_DELETE_VERSION, 'controlled-s4-delete-live.v1');
assert.deepEqual(operations, [{ op: 'delete', entity_path: 'pid:9287.9289' }]);
assert.deepEqual(controlledS4DeleteTargets(), [{
  entity_path: 'pid:9287.9289',
  edit_scope: 'instance_path',
  instance_policy: 'definition_wide'
}]);
assert.equal(validation.risk_level, 'S4');
assert.equal(validation.operation_contracts[0].destructive, true);
assert.equal(validation.expert_validation_document.operations[0].confirmed, true);

const beforeAdoption = structuralAdoption({
  modelRevision: CONTROLLED_S4_DELETE_PROFILE.expected_revision,
  entries: [parentEntry(), targetEntry()]
});
assert.equal(assertControlledS4Preconditions(beforeAdoption, { expectedModelPath }).entity_path, 'pid:9287.9289');

const afterAdoption = structuralAdoption({
  modelRevision: `sha256:${'a'.repeat(64)}`,
  entries: []
});
assert.equal(verifyControlledS4Deletion(afterAdoption, { expectedModelPath }).pass, true);
assert.equal(verifyControlledS4Deletion(beforeAdoption, { expectedModelPath }).pass, false);
const unexpectedParentSurvivor = structuralAdoption({ modelRevision: `sha256:${'b'.repeat(64)}`, entries: [parentEntry()] });
assert.equal(verifyControlledS4Deletion(unexpectedParentSurvivor, { expectedModelPath }).pass, false);

const inferredCascade = inferExistingModelEditDestructiveSideEffects({
  adoption: { recursive_index: [parentEntry(), targetEntry()] },
  operations
});
const destructiveSideEffectSchema = JSON.parse(await fs.readFile(
  new URL('../schema/existing-model-edit-destructive-side-effects-v1.schema.json', import.meta.url),
  'utf8'
));
const validateDestructiveSideEffects = new Ajv2020({ strict: false, allErrors: true }).compile(destructiveSideEffectSchema);
assert.equal(validateDestructiveSideEffects(inferredCascade), true, JSON.stringify(validateDestructiveSideEffects.errors, null, 2));
assert.deepEqual(inferredCascade.expected_absent_targets.map((entry) => ({
  entity_path: entry.entity_path,
  reason: entry.reason,
  caused_by_absent_children: entry.caused_by_absent_children
})), [{
  entity_path: 'pid:9287',
  reason: 'sketchup_empty_group_cleanup',
  caused_by_absent_children: ['pid:9287.9289']
}]);
const sibling = { ...targetEntry(), entity_path: 'pid:9287.9290', persistent_id: '9290' };
assert.equal(inferExistingModelEditDestructiveSideEffects({
  adoption: { recursive_index: [parentEntry(), targetEntry(), sibling] },
  operations
}).expected_absent_targets.length, 0, 'a surviving sibling must prevent empty-parent cascade inference');

assertQueueIdle({ queue_count: 0, processing_count: 0, response_count: 0, lock_exists: false });
assert.throws(() => assertQueueIdle({ queue_count: 1, processing_count: 0, response_count: 0, lock_exists: false }), /Queue is not idle/);
assertReadyForApprovedSubmission({
  task_state: 'awaiting_review',
  next_action: { action: 'submit_task_input', required: ['session_contract'] }
});
assert.throws(() => assertReadyForApprovedSubmission({
  task_state: 'awaiting_review',
  next_action: { action: 'request_user_approval' }
}), /has not been authorized/);

const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'controlled-s4-delete-test-'));
const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(outputRoot, 'mock-session.json') },
  agentContract: { rootDir: path.join(outputRoot, 'agent-state') },
  approval: {
    stateDir: path.join(outputRoot, 'approvals'),
    secret: 'controlled-s4-delete-test-secret-32-bytes'
  },
  executionPolicy: {
    allowed_runtimes: ['mock'],
    auto_approve_risks: [],
    resource_limits: { max_operations: 5, max_affected_instances: 10, max_recursive_entities: 1000 }
  }
});
await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'box', id: 'keep-parent', name: 'Keep Parent', origin: [0, 0, 0], size: [10, 10, 10] },
    { op: 'box', id: 'delete-me', name: 'Delete Me', origin: [20, 0, 0], size: [10, 10, 10] }
  ]
}) });
const prepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Delete only the reviewed disposable target.',
  targets: [{ target_id: 'delete-me' }],
  operations: [{ op: 'delete', target_id: 'delete-me' }],
  budgets: { max_operations: 5, max_affected_instances: 10, recursive_limit: 1000 },
  output_dir: path.join(outputRoot, 'prepare')
});
assert.equal(prepared.plan.risk_level, 'S4');
const approvalToken = await bridge.approvalAuthority.approveChallengeFromTrustedUser(
  prepared.approval_challenge,
  { user_id: 'controlled-s4-test-user', channel: 'test-only-trusted-user-fixture', confirmed: true }
);
const applied = await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: prepared.plan,
  approval_token: approvalToken,
  output_dir: path.join(outputRoot, 'apply'),
  save_model: false
});
assert.equal(applied.ok, true);
const observed = await observeExistingModelEditExecutionState({
  bridge,
  plan: prepared.plan,
  runtime: 'mock',
  phase: 'gateway_post_apply'
});
assert.equal(observed.summary.expected_absent_target_count, 1);
assert.equal(observed.summary.verified_absent_target_count, 1);
assert.equal(observed.summary.target_postconditions_verified, true);
assert.equal(observed.adoption.entities.some((entity) => entity.id === 'keep-parent'), true);
assert.equal(observed.adoption.entities.some((entity) => entity.id === 'delete-me'), false);

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: CONTROLLED_S4_DELETE_VERSION,
  risk_level: validation.risk_level,
  confirmed_delete: true,
  hash_bound_live_target: CONTROLLED_S4_DELETE_PROFILE.target_entity_path,
  empty_parent_cleanup_bound: true,
  post_delete_absence_check: true,
  trusted_approval_gate_check: true
}, null, 2)}\n`);

function structuralAdoption({ modelRevision, entries }) {
  return {
    kind: 'adopt_open_model',
    runtime: 'queue',
    read_only: true,
    model_identity: { source_path: expectedModelPath, title: 'Fire Escape.disposable' },
    model_info: { source_path: expectedModelPath },
    model_revision: modelRevision,
    model_revision_complete: true,
    model_revision_total_seen: 5859,
    model_revision_indexed: 5859,
    structural_groups: { truncated: false, entries }
  };
}

function parentEntry() {
  return {
    entity_path: 'pid:9287',
    path: 'pid:9287',
    parent_entity_path: null,
    entity_type: 'group',
    effective_locked: false,
    shared_definition: false,
    affected_instance_count: 1,
    faces: 0,
    edges: 0,
    vertices: 0
  };
}

function targetEntry() {
  return {
    entity_path: 'pid:9287.9289',
    path: 'pid:9287.9289',
    parent_entity_path: 'pid:9287',
    entity_type: 'group',
    name: 'untrusted fixture name',
    effective_locked: false,
    shared_definition: false,
    affected_instance_count: 1,
    faces: 2142,
    edges: 3715,
    vertices: 1657
  };
}
