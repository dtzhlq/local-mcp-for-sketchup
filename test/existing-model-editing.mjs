import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';

const outputDir = path.resolve('output/existing-model-editing/test');
await fs.rm(outputDir, { recursive: true, force: true });
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
const booleanPrepared = await bridge.prepare_existing_model_edit({
  runtime: 'mock',
  instruction: 'Subtract a reviewed nested tool solid within the same component definition.',
  targets: [target(booleanTarget), target(booleanTool)],
  operations: [{
    op: 'boolean_difference',
    ...target(booleanTarget),
    tools: [{ ...target(booleanTool), name: booleanTool.name }],
    result_id: 'existing-boolean-result',
    result_name: 'Existing_Boolean_Result'
  }],
  output_dir: path.join(outputDir, 'boolean-prepare')
});
assert.equal(booleanPrepared.plan.risk_level, 'S3');
await bridge.apply_reviewed_model_edit({
  runtime: 'mock',
  plan: booleanPrepared.plan,
  approval_token: await approvalToken(booleanPrepared),
  output_dir: path.join(outputDir, 'boolean-apply'),
  save_model: false
});
adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 500 });
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Boolean_Result').length, 1);
assert.equal(adopted.recursive_index.filter((entry) => entry.name === 'Existing_Boolean_Tool').length, 0);

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
