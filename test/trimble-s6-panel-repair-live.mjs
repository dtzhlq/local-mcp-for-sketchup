import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { validateExistingModelEditOperations } from '../src/existing-model-editing.mjs';
import {
  buildPanelRepairOperations,
  panelRepairTargets,
  TRIMBLE_S6_PANEL_REPAIR_VERSION,
  verifyPanelRepair
} from '../scripts/run-trimble-s6-panel-repair-live.mjs';

const liveOperations = buildPanelRepairOperations();
const validation = validateExistingModelEditOperations(liveOperations);
assert.equal(TRIMBLE_S6_PANEL_REPAIR_VERSION, 'trimble-s6-panel-repair-live.v1');
assert.equal(validation.risk_level, 'S4');
assert.equal(validation.expert_validation_document.operations[0].confirmed, true);
assert.equal(validation.expert_validation_document.operations[1].confirmed, true);
assert.deepEqual(liveOperations, [
  { op: 'delete', entity_path: 'pid:89498' },
  { op: 'delete', entity_path: 'pid:89718' },
  { op: 'set_material', entity_path: 'pid:89455', material: '[Color_005]' }
]);
assert.deepEqual(panelRepairTargets(), [
  { entity_path: 'pid:89455' },
  { entity_path: 'pid:89498' },
  { entity_path: 'pid:89718' }
]);

const tripodGroups = Array.from({ length: 21 }, (_, index) => ({
  id: `tripod-${index + 1}`,
  name: index < 4
    ? `ALMA_Trimble_S6_Tripod_${index + 1}`
    : index < 19
      ? `ALMA_Trimble_S6_Leg_${index + 1}`
      : `ALMA_Trimble_S6_Center_${index + 1}`
}));
const repairedSnapshot = {
  snapshot: {
    groups: [
      { persistent_id: '89455', name: '', material: '[Color_005]' },
      ...tripodGroups
    ]
  }
};
assert.equal(verifyPanelRepair(repairedSnapshot).pass, true);
const wrongOverlaySnapshot = structuredClone(repairedSnapshot);
wrongOverlaySnapshot.snapshot.groups.push({ persistent_id: '89498', name: 'ALMA_Trimble_S6_Lower_Panel_Backing' });
assert.equal(verifyPanelRepair(wrongOverlaySnapshot).pass, false);

const outputRoot = path.resolve('output/trimble-s6-panel-repair/test');
await fs.rm(outputRoot, { recursive: true, force: true });
const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(outputRoot, 'mock-session.json') },
  agentContract: { rootDir: path.join(outputRoot, 'agent-state') },
  approval: {
    stateDir: path.join(outputRoot, 'approvals'),
    secret: 'trimble-s6-panel-repair-test-secret-32-bytes'
  },
  executionPolicy: {
    allowed_runtimes: ['mock'],
    auto_approve_risks: [],
    resource_limits: { max_operations: 20, max_affected_instances: 20, max_recursive_entities: 1000 }
  }
});
await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: '[Color_D06]', color: '#32373e' },
    { op: 'material', name: '[Color_005]', color: '#f4c400' },
    { op: 'box', id: 'original-lower-cover', name: 'Original_Lower_Cover', origin: [0, 0, 0], size: [20, 5, 2], material: '[Color_D06]' },
    { op: 'box', id: 'wrong-panel-backing', name: 'ALMA_Trimble_S6_Lower_Panel_Backing', origin: [2, 2, 2], size: [16, 3, 7], material: '[Color_D06]' },
    { op: 'box', id: 'wrong-panel-face', name: 'ALMA_Trimble_S6_Lower_Panel_Face', origin: [3, 1, 3], size: [14, 2, 6], material: '[Color_005]' }
  ]
}) });
const mockAdoption = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 1000, read_only: true });
const mockOriginalFace = mockAdoption.recursive_index.find((entry) => entry.entity_type === 'face'
  && entry.path_segments?.[0]?.persistent_id === 'original-lower-cover');
assert.ok(mockOriginalFace?.entity_path);
const task = await bridge.start_agent_task({
  intent: 'reviewed_existing_model_edit',
  instruction: 'Remove only the two mistaken overlay groups and recolor the original lower-front cover.',
  interface_level: 'guided',
  client_capabilities: { vision: false, local_files: false, structured_output: true, parallel: false, context: 'short' },
  idempotency_key: 'trimble-s6-panel-repair-mock-prepare-v1',
  inputs: {
    runtime: 'mock',
    timeout_ms: 30_000,
    recursive_limit: 1000,
    budgets: { max_operations: 20, max_affected_instances: 20, recursive_limit: 1000 },
    save_model: false,
    capture_view: false,
    targets: panelRepairTargets({ livePaths: false }),
    operations: buildPanelRepairOperations({ livePaths: false })
  }
});
assert.equal(task.ok, true);
assert.equal(task.task_state, 'awaiting_review');
assert.equal(task.result.risk_level, 'S4');
assert.equal(task.result.operation_count, 3);
const persisted = await bridge.taskStore.getTask(task.task_id, { includePrivate: true });
assert.equal(persisted.result.approval_challenge.review_context.operations.length, 3);
assert.deepEqual(persisted.result.approval_challenge.allowed_operations, ['delete', 'set_material']);

const reviewedPathEdit = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Exercise reviewed entity-path execution without caller-supplied transport fields.',
  targets: [{ entity_path: mockOriginalFace.entity_path }],
  operations: [{ op: 'set_material', entity_path: mockOriginalFace.entity_path, material: '[Color_005]' }],
  budgets: { max_operations: 20, max_affected_instances: 20, recursive_limit: 1000 },
  output_dir: path.join(outputRoot, 'path-delete-prepare')
});
const approvalToken = await bridge.approvalAuthority.approveChallengeFromTrustedUser(
  reviewedPathEdit.approval_challenge,
  { user_id: 'trimble-s6-panel-repair-test-user', channel: 'test-only-trusted-user-fixture', confirmed: true }
);
const appliedPathEdit = await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: reviewedPathEdit.plan,
  approval_token: approvalToken,
  output_dir: path.join(outputRoot, 'path-delete-apply'),
  save_model: false
});
assert.equal(appliedPathEdit.ok, true);
const executedDsl = JSON.parse(await fs.readFile(path.join(outputRoot, 'path-delete-apply', 'input.dsl.json'), 'utf8'));
assert.deepEqual(executedDsl.operations, [
  {
    op: 'set_material',
    entity_path: mockOriginalFace.entity_path,
    material: '[Color_005]',
    edit_scope: 'instance_path',
    instance_policy: 'definition_wide'
  }
]);

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: TRIMBLE_S6_PANEL_REPAIR_VERSION,
  risk_level: validation.risk_level,
  operation_count: liveOperations.length,
  exact_wrong_groups: 2,
  original_cover_reused: true,
  tripod_preservation_check: true,
  agent_gateway_prepare: true,
  reviewed_entity_path_transport_fields: true
}, null, 2)}\n`);
