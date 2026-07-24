import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import {
  modelRevisionForAdoption,
  validateExistingModelEditOperations,
  versionedModelSavePath
} from '../src/existing-model-editing.mjs';

const outputDir = path.resolve('output/existing-model-editing/test');
await fs.rm(outputDir, { recursive: true, force: true });
const sharedOperationValidation = validateExistingModelEditOperations([
  { op: 'transform_object', target_id: 'shared-validation-target', translate: [1, 0, 0] },
  { op: 'pushpull_face', target_id: 'shared-validation-face', distance: 5 }
]);
assert.equal(sharedOperationValidation.risk_level, 'S3');
assert.equal(sharedOperationValidation.operation_contracts[0].risk, 'S2');
assert.equal(sharedOperationValidation.expert_validation_document.operations[1].confirmed, true);
assert.throws(
  () => validateExistingModelEditOperations([{ op: 'transform_object', target_id: 'missing-transform' }]),
  (error) => error.code === 'INVALID_ARGUMENT'
);
const materialResourceValidation = validateExistingModelEditOperations([
  { op: 'material', name: 'Existing_Base', color: '#445566', alpha: 0.9 }
]);
assert.equal(materialResourceValidation.risk_level, 'S2');
assert.equal(materialResourceValidation.operation_contracts[0].resource_mutation, true);
assert.equal(materialResourceValidation.operation_contracts[0].resource_scope, 'model_material_definition');
assert.throws(
  () => validateExistingModelEditOperations([{ op: 'material', name: 'Existing_Base', color: 'not-a-color' }]),
  (error) => error.code === 'INVALID_ARGUMENT'
);
assert.throws(
  () => validateExistingModelEditOperations([{ op: 'material', name: 'Existing_Base', texture: '/tmp/untrusted.png' }]),
  (error) => error.code === 'INVALID_ARGUMENT'
);
const bridge = new SketchUpBridge({
  mock: { sessionPath: path.join(outputDir, 'session.json') },
  approval: { stateDir: path.join(outputDir, 'approvals'), secret: 'existing-model-editing-test-secret-at-least-32-bytes' }
});

await bridge.build_model({ runtime: 'mock', code: JSON.stringify({
  version: 1,
  units: 'mm',
  operations: [
    { op: 'reset' },
    { op: 'material', name: 'Existing_Base', color: '#999999' },
    { op: 'material', name: 'Existing_Reviewed', color: '#3366cc' },
    { op: 'component_definition', name: 'Existing_Leaf', operations: [
      { op: 'box', id: 'existing-leaf-box', name: 'Existing_Leaf_Box', origin: [0, 0, 0], size: [100, 60, 30], material: 'Existing_Base' }
    ] },
    { op: 'component_definition', name: 'Existing_Middle', operations: [
      { op: 'component_instance', id: 'existing-leaf-instance', name: 'Existing_Leaf_Instance', definition: 'Existing_Leaf', origin: [0, 0, 0] }
    ] },
    { op: 'component_definition', name: 'Existing_Boolean', operations: [
      { op: 'box', id: 'existing-boolean-target', name: 'Existing_Boolean_Target', origin: [0, 0, 0], size: [100, 80, 40], material: 'Existing_Base' },
      { op: 'box', id: 'existing-boolean-tool', name: 'Existing_Boolean_Tool', origin: [50, 20, 0], size: [80, 40, 40], material: 'Existing_Base' }
    ] },
    { op: 'component_instance', id: 'existing-middle-a', name: 'Existing_Middle_A', definition: 'Existing_Middle', origin: [0, 0, 0] },
    { op: 'component_instance', id: 'existing-middle-b', name: 'Existing_Middle_B', definition: 'Existing_Middle', origin: [250, 0, 0] },
    { op: 'component_instance', id: 'existing-boolean-instance', name: 'Existing_Boolean_Instance', definition: 'Existing_Boolean', origin: [0, 150, 0] }
  ]
}) });

let adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
assert.equal(adopted.recursive_truncated, false);
assert.ok(adopted.recursive_index.some((entry) => entry.entity_type === 'face'));
assert.ok(adopted.recursive_index.some((entry) => entry.entity_type === 'edge'));
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Leaf_Box').length, 2);

const firstGroup = adopted.recursive_index.find((entry) => entry.name === 'Existing_Leaf_Box');
const firstFace = adopted.recursive_index.find((entry) => entry.entity_type === 'face' && entry.entity_path.startsWith(firstGroup.entity_path));
const firstEdge = adopted.recursive_index.find((entry) => entry.entity_type === 'edge' && entry.entity_path.startsWith(firstGroup.entity_path));
const materialPrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Update one existing named material through a review-gated global resource mutation.',
  targets: [target(firstGroup)],
  operations: [{ op: 'material', name: 'Existing_Base', color: '#445566', alpha: 0.9 }],
  output_dir: path.join(outputDir, 'material-resource-prepare')
});
assert.equal(materialPrepared.plan.risk_level, 'S2');
assert.equal(materialPrepared.plan.blockers.length, 0);
assert.equal(materialPrepared.approval_challenge.review_context.operations[0].resource_mutation, true);
assert.equal(materialPrepared.approval_challenge.review_context.operations[0].resource_name, 'Existing_Base');
await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: materialPrepared.plan,
  approval_token: await approvalToken(materialPrepared),
  output_dir: path.join(outputDir, 'material-resource-apply'),
  save_model: false
});
adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
const updatedBaseMaterial = adopted.snapshot.materials.find((entry) => entry.name === 'Existing_Base');
assert.equal(updatedBaseMaterial.color, '#445566');
assert.equal(updatedBaseMaterial.alpha, 0.9);
await assert.rejects(
  bridge.prepare_existing_model_edit({
    runtime: 'mock',
    instruction: 'Reject an invalid expert operation field before planning.',
    targets: [target(firstEdge)],
    operations: [{ op: 'set_visibility', ...target(firstEdge), visible: 'not-a-boolean' }],
    output_dir: path.join(outputDir, 'invalid-operation-prepare')
  }),
  (error) => error.code === 'INVALID_ARGUMENT'
);
await assert.rejects(
  bridge.prepare_existing_model_edit({
    runtime: 'mock',
    instruction: 'Reject an Agent budget above the trusted server cap.',
    targets: [target(firstEdge)],
    operations: [{ op: 'attribute', ...target(firstEdge), dictionary: 'ExistingModelEdit', key: 'over_budget', value: true }],
    budgets: { max_operations: 101 },
    output_dir: path.join(outputDir, 'over-budget-prepare')
  }),
  (error) => error.code === 'POLICY_DENIED'
);
const prepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Apply reviewed metadata and appearance changes to an existing nested component.',
  targets: [target(firstGroup), target(firstFace), target(firstEdge)],
  operations: [
    { op: 'attribute', ...target(firstGroup), dictionary: 'ExistingModelEdit', key: 'reviewed', value: true },
    { op: 'set_face_material', ...target(firstFace), material: 'Existing_Reviewed', side: 'both' },
    { op: 'set_edge_properties', ...target(firstEdge), soft: true, smooth: true }
  ],
  output_dir: path.join(outputDir, 'property-prepare')
});
assert.equal(prepared.plan.compile_permission, 'ready_for_review');
assert.equal(prepared.plan.risk_level, 'S1');
assert.match(prepared.plan.plan_hash, /^sha256:[0-9a-f]{64}$/);
assert.equal(prepared.plan.trusted_scope_approval_required, true, 'shared-definition scope must be part of the trusted approval decision');
assert.equal(prepared.plan.auto_approval_eligible, false, 'shared-definition S1 work must never inherit automatic approval');
assert.equal(Object.hasOwn(prepared.approval_challenge.review_context, 'geometry_validation'), false, 'non-Boolean review contexts must remain compatible');
const sharedAutoBridge = new SketchUpBridge({
  mock: { sessionPath: path.join(outputDir, 'session.json') },
  approval: { stateDir: path.join(outputDir, 'shared-auto-approvals'), secret: 'existing-model-editing-shared-auto-secret-at-least-32-bytes' },
  executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: ['S1'] }
});
await assert.rejects(
  sharedAutoBridge.apply_reviewed_model_edit({
    runtime: 'mock',
    plan: prepared.plan,
    output_dir: path.join(outputDir, 'shared-auto-apply'),
    save_model: false
  }),
  (error) => error.code === 'APPROVAL_REQUIRED'
);
await assert.rejects(
  bridge.apply_reviewed_model_edit({
    runtime: 'mock',
    plan: prepared.plan,
    review: { status: 'approved', plan_id: prepared.plan.plan_id, reviewer: 'ordinary-agent' },
    output_dir: path.join(outputDir, 'forged-review-apply'),
    save_model: false
  }),
  (error) => error.code === 'APPROVAL_REQUIRED'
);
await assert.rejects(
  bridge.apply_reviewed_model_edit({
    runtime: 'mock',
    plan: { ...structuredClone(prepared.plan), instruction: 'Tampered after review.' },
    output_dir: path.join(outputDir, 'tampered-plan-apply'),
    save_model: false
  }),
  (error) => error.code === 'PLAN_HASH_MISMATCH'
);

const applied = await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: prepared.plan,
  approval_token: await approvalToken(prepared),
  output_dir: path.join(outputDir, 'property-apply'),
  save_model: false
});
assert.equal(applied.ok, true);
await fs.access(applied.artifacts.review);

adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
assert.ok(adopted.recursive_index.some((entry) => entry.entity_type === 'face' && entry.material === 'Existing_Reviewed' && entry.back_material === 'Existing_Reviewed'));
assert.ok(adopted.recursive_index.some((entry) => entry.entity_type === 'edge' && entry.soft === true && entry.smooth === true));

const uniqueSource = adopted.recursive_index.find((entry) => entry.name === 'Existing_Leaf_Box' && entry.entity_path.includes('ZXhpc3RpbmctbWlkZGxlLWE'));
const uniquePrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Make one deep occurrence unique and rename only that nested group.',
  targets: [{ ...target(uniqueSource), instance_policy: 'make_unique', instance_id: 'existing-middle-a' }],
  operations: [{ op: 'rename', ...target(uniqueSource), instance_policy: 'make_unique', instance_id: 'existing-middle-a', new_name: 'Existing_Leaf_Box_Unique' }],
  output_dir: path.join(outputDir, 'unique-prepare')
});
await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: uniquePrepared.plan,
  approval_token: await approvalToken(uniquePrepared),
  output_dir: path.join(outputDir, 'unique-apply'),
  save_model: false
});
adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Leaf_Box_Unique').length, 1);
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Leaf_Box').length, 1);

const topologyFace = adopted.recursive_index.find((entry) => entry.entity_type === 'face' && entry.entity_path.includes('ZXhpc3RpbmctbWlkZGxlLWE'));
const topologyPrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Pushpull one reviewed face in the isolated occurrence.',
  targets: [target(topologyFace)],
  operations: [{ op: 'pushpull_face', ...target(topologyFace), distance: 12 }],
  output_dir: path.join(outputDir, 'topology-prepare')
});
assert.equal(topologyPrepared.plan.risk_level, 'S3');
await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: topologyPrepared.plan,
  approval_token: await approvalToken(topologyPrepared),
  output_dir: path.join(outputDir, 'topology-apply'),
  save_model: false
});

adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
const featureGroup = adopted.recursive_index.find((entry) => entry.name === 'Existing_Leaf_Box');
const featureFacesBefore = featureGroup.faces;
const featurePrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Cut a reviewed hole into a nested existing solid.',
  targets: [target(featureGroup)],
  operations: [{ op: 'cut_hole', ...target(featureGroup), center: [50, 30], radius: 8, feature_id: 'existing-nested-hole' }],
  output_dir: path.join(outputDir, 'feature-prepare')
});
assert.equal(featurePrepared.plan.risk_level, 'S3');
await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: featurePrepared.plan,
  approval_token: await approvalToken(featurePrepared),
  output_dir: path.join(outputDir, 'feature-apply'),
  save_model: false
});
adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
assert.ok(adopted.recursive_index.find((entry) => entry.entity_path === featureGroup.entity_path).faces > featureFacesBefore);

const booleanTarget = adopted.recursive_index.find((entry) => entry.name === 'Existing_Boolean_Target');
const booleanTool = adopted.recursive_index.find((entry) => entry.name === 'Existing_Boolean_Tool');
const booleanTargetBefore = booleanIdentity(booleanTarget);
const booleanToolBefore = booleanIdentity(booleanTool);
const booleanPrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Subtract a reviewed nested tool solid within the same component definition.',
  targets: [target(booleanTarget), target(booleanTool)],
  operations: [{
    op: 'boolean_difference',
    ...target(booleanTarget),
    tools: [{ ...target(booleanTool), name: booleanTool.name }],
    result_id: 'existing-boolean-result',
    result_name: 'Existing_Boolean_Result',
    keep_originals: true,
    keep_tools: true
  }],
  execution_contract: { save_model: false, capture_view: false },
  output_dir: path.join(outputDir, 'boolean-prepare')
});
assert.equal(booleanPrepared.plan.risk_level, 'S3');
assert.deepEqual(booleanPrepared.plan.execution_contract, {
  save_model: false,
  save_path: null,
  capture_view: false,
  final_save_path: null,
  overwrite_existing: false
});
assert.equal(booleanPrepared.approval_challenge.review_context.operations[0].target, booleanTarget.entity_path);
assert.deepEqual(booleanPrepared.approval_challenge.review_context.operations[0].tools, [booleanTool.entity_path]);
assert.equal(booleanPrepared.approval_challenge.review_context.operations[0].keep_originals, true);
assert.equal(booleanPrepared.approval_challenge.review_context.operations[0].keep_tools, true);
assert.deepEqual(booleanPrepared.approval_challenge.review_context.geometry_validation, {
  evidence_kind: 'bbox_candidate_only',
  bbox_relation: 'positive_bbox_overlap_unverified',
  exact_solid_overlap: {
    status: 'unverified_before_atomic_trial',
    verified: false,
    verification_stage: 'review_gated_atomic_apply'
  },
  approved_action: 'review_gated_atomic_boolean_trial',
  success_preconditions: [
    'target_exact_volume_strictly_reduced',
    'result_manifold'
  ],
  failure_disposition: 'abort_before_commit'
});
assert.equal(
  booleanPrepared.approval_challenge.review_context_hash,
  sha256Canonical(booleanPrepared.approval_challenge.review_context),
  'Boolean geometry disclosure must be included in the trusted review-context hash'
);
const tamperedBooleanReviewContext = structuredClone(booleanPrepared.approval_challenge.review_context);
tamperedBooleanReviewContext.geometry_validation.exact_solid_overlap.status = 'verified';
assert.notEqual(
  sha256Canonical(tamperedBooleanReviewContext),
  booleanPrepared.approval_challenge.review_context_hash,
  'changing a Boolean geometry disclosure must invalidate its trusted review-context hash'
);
assert.deepEqual(booleanPrepared.approval_challenge.review_context.execution, booleanPrepared.plan.execution_contract);
const executionTamperedPlan = structuredClone(booleanPrepared.plan);
const unapprovedBasePath = path.join(outputDir, 'unapproved-save-location', 'model.skp');
executionTamperedPlan.execution_contract = {
  save_model: true,
  save_path: unapprovedBasePath,
  capture_view: false,
  final_save_path: versionedModelSavePath(unapprovedBasePath, executionTamperedPlan.plan_id),
  overwrite_existing: false
};
await assert.rejects(
  bridge.apply_reviewed_model_edit({
    runtime: 'mock',
    plan: executionTamperedPlan,
    approval_token: 'must-not-be-consumed-for-a-tampered-execution-contract',
    output_dir: path.join(outputDir, 'boolean-tampered-execution-plan-apply'),
    save_model: true,
    save_path: unapprovedBasePath
  }),
  (error) => error.code === 'PLAN_HASH_MISMATCH'
);
await assert.rejects(
  bridge.apply_reviewed_model_edit({
    runtime: 'mock',
    plan: booleanPrepared.plan,
    approval_token: 'not-consumed-because-execution-contract-mismatches',
    output_dir: path.join(outputDir, 'boolean-mismatched-execution-apply'),
    save_model: true
  }),
  (error) => error.code === 'PLAN_HASH_MISMATCH'
);
const booleanApprovalToken = await approvalToken(booleanPrepared);
assert.equal(
  (await bridge.approvalAuthority.verifyToken(booleanApprovalToken)).review_context_hash,
  booleanPrepared.approval_challenge.review_context_hash,
  'the one-time approval token must carry the Boolean geometry disclosure hash'
);
const booleanApplied = await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: booleanPrepared.plan,
  approval_token: booleanApprovalToken,
  output_dir: path.join(outputDir, 'boolean-apply'),
  save_model: false
});
await fs.access(booleanApplied.artifacts.apply_result);
adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Boolean_Result').length, 1);
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Boolean_Target').length, 1);
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Boolean_Tool').length, 1);
assert.deepEqual(booleanIdentity(adopted.recursive_index.find((entry) => entry.entity_path === booleanTarget.entity_path)), booleanTargetBefore);
assert.deepEqual(booleanIdentity(adopted.recursive_index.find((entry) => entry.entity_path === booleanTool.entity_path)), booleanToolBefore);

const manifoldTarget = adopted.recursive_index.find((entry) => entry.name === 'Existing_Boolean_Result');
const manifoldPrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Record a reviewed manifold check for the nested boolean result.',
  targets: [target(manifoldTarget)],
  operations: [{ op: 'manifold_check', ...target(manifoldTarget), check_id: 'existing-nested-manifold', fail_on_non_manifold: true }],
  output_dir: path.join(outputDir, 'manifold-prepare')
});
const manifoldApplied = await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: manifoldPrepared.plan,
  approval_token: await approvalToken(manifoldPrepared),
  output_dir: path.join(outputDir, 'manifold-apply'),
  save_model: false
});
const manifoldSnapshot = JSON.parse(await fs.readFile(manifoldApplied.iteration.artifacts.after_snapshot, 'utf8'));
assert.ok(manifoldSnapshot.manifold_checks.some((check) => check.id === 'existing-nested-manifold' && check.ok));

adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
const staleEdge = adopted.recursive_index.find((entry) => entry.entity_type === 'edge');
const stalePrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Prepare an edit that must become stale.',
  targets: [target(staleEdge)],
  operations: [{ op: 'attribute', ...target(staleEdge), dictionary: 'ExistingModelEdit', key: 'stale', value: true }],
  output_dir: path.join(outputDir, 'stale-prepare')
});
await bridge.evaluate_py({
  runtime: 'mock',
  input_format: 'json_dsl',
  code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'set_visibility', ...target(staleEdge), visible: false }] })
});
await assert.rejects(
  bridge.apply_reviewed_model_edit({
    runtime: 'mock',
    plan: stalePrepared.plan,
    approval_token: await approvalToken(stalePrepared),
    output_dir: path.join(outputDir, 'stale-apply'),
    save_model: false
  }),
  (error) => error.code === 'MODEL_REVISION_MISMATCH'
);

adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
const autoTarget = adopted.recursive_index.find((entry) => entry.entity_type === 'edge');
const autoBridge = new SketchUpBridge({
  mock: { sessionPath: path.join(outputDir, 'session.json') },
  approval: { stateDir: path.join(outputDir, 'auto-approvals'), secret: 'existing-model-editing-auto-test-secret-at-least-32-bytes' },
  executionPolicy: { allowed_runtimes: ['mock'], auto_approve_risks: ['S1'] }
});
const autoPrepared = await autoBridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Apply an S1 attribute under explicitly configured server policy.',
  targets: [target(autoTarget)],
  operations: [{ op: 'attribute', ...target(autoTarget), dictionary: 'ExistingModelEdit', key: 'auto_s1', value: true }],
  output_dir: path.join(outputDir, 'auto-s1-prepare')
});
const autoApplied = await autoBridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: autoPrepared.plan,
  output_dir: path.join(outputDir, 'auto-s1-apply'),
  save_model: false
});
assert.equal(autoApplied.authorization.mode, 'server_policy_auto_approval');

adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
const identityTarget = adopted.recursive_index.find((entry) => entry.entity_type === 'edge');
const identityPrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Bind a reviewed plan to one model identity.',
  targets: [target(identityTarget)],
  operations: [{ op: 'attribute', ...target(identityTarget), dictionary: 'ExistingModelEdit', key: 'identity_bound', value: true }],
  output_dir: path.join(outputDir, 'identity-prepare')
});
const originalSessionPath = bridge.mockRuntime.sessionPath;
const originalLockPath = bridge.mockRuntime.lockPath;
const alternateSessionPath = path.join(outputDir, 'identity-alternate-session.json');
await fs.copyFile(originalSessionPath, alternateSessionPath);
bridge.mockRuntime.sessionPath = alternateSessionPath;
bridge.mockRuntime.lockPath = `${alternateSessionPath}.lock`;
try {
  await assert.rejects(
    bridge.apply_reviewed_model_edit({
      runtime: 'mock',
      plan: identityPrepared.plan,
      approval_token: await approvalToken(identityPrepared),
      output_dir: path.join(outputDir, 'identity-mismatch-apply'),
      save_model: false
    }),
    (error) => error.code === 'MODEL_IDENTITY_MISMATCH'
  );
} finally {
  bridge.mockRuntime.sessionPath = originalSessionPath;
  bridge.mockRuntime.lockPath = originalLockPath;
}

adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
const rollbackFace = adopted.recursive_index.find((entry) => entry.entity_type === 'face');
const beforeRollback = modelRevisionForAdoption(adopted);
await assert.rejects(
  bridge.evaluate_py({
    runtime: 'mock',
    input_format: 'json_dsl',
    code: JSON.stringify({ version: 1, units: 'mm', operations: [
      { op: 'attribute', ...target(rollbackFace), dictionary: 'ExistingModelEdit', key: 'must_rollback', value: true },
      { op: 'pushpull_face', ...target(rollbackFace), distance: 5 }
    ] })
  }),
  /confirmed=true/
);
const afterRollback = modelRevisionForAdoption(await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 }));
assert.equal(afterRollback, beforeRollback, 'failed batches must not persist partial edits');

process.stdout.write(`${JSON.stringify({
  ok: true,
  recursive_entities: adopted.recursive_index.length,
  property_plan: prepared.plan.plan_id,
  unique_plan: uniquePrepared.plan.plan_id,
  topology_plan: topologyPrepared.plan.plan_id,
  feature_plan: featurePrepared.plan.plan_id,
  boolean_plan: booleanPrepared.plan.plan_id,
  manifold_plan: manifoldPrepared.plan.plan_id,
  forged_approval_rejected: true,
  tampered_plan_rejected: true,
  configured_s1_auto_approval: true,
  shared_s1_auto_approval_blocked: true,
  server_budget_cap_enforced: true,
  shared_operation_risk_validation: true,
  invalid_operation_contract_rejected: true,
  model_identity_mismatch_rejected: true,
  boolean_geometry_disclosure_hash_bound: true,
  stale_revision_rejected: true,
  rollback_verified: true
}, null, 2)}\n`);

function target(entry) {
  return { entity_path: entry.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
}

async function approvalToken(preparedEdit) {
  return bridge.approvalAuthority.approveChallengeFromTrustedUser(
    preparedEdit.approval_challenge,
    { user_id: 'existing-model-editing-human-fixture', channel: 'test-only-trusted-user-fixture', confirmed: true }
  );
}

function booleanIdentity(entry) {
  return {
    entity_path: entry?.entity_path,
    persistent_id: entry?.persistent_id,
    faces: entry?.faces,
    edges: entry?.edges,
    material: entry?.material,
    bounding_box: entry?.bounding_box
  };
}
