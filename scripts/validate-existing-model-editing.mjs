#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelRevisionForAdoption } from '../src/existing-model-editing.mjs';

export async function validateExistingModelEditing({ runtime = 'mock', timeoutMs = runtime === 'queue' ? 240000 : 30000, outputDir = `output/existing-model-editing/${runtime}`, saveSkp = `output/existing-model-editing/${runtime}/existing-model-editing.skp`, trustedApprovalProvider } = {}) {
  if (runtime === 'queue' && typeof trustedApprovalProvider !== 'function') {
    throw new Error('Live existing-model editing requires a trusted user-presence approval provider; the CLI will not mint S2-S4 approval tokens or modify SketchUp without it.');
  }
  const absoluteOutputDir = path.resolve(outputDir);
  const absoluteSavePath = path.resolve(saveSkp);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  const bridge = new SketchUpBridge(runtime === 'mock'
    ? {
      mock: { sessionPath: path.join(absoluteOutputDir, '.mock-session.json') },
      approval: { stateDir: path.join(absoluteOutputDir, '.approval-state'), secret: 'existing-model-validator-fixture-secret-at-least-32-bytes' }
    }
    : {});
  bridge.validationApprovalProvider = trustedApprovalProvider || ((prepared) => bridge.approvalAuthority.approveChallengeFromTrustedUser(
    prepared.approval_challenge,
    { user_id: 'mock-validator-human-fixture', channel: 'test-only-trusted-user-fixture', confirmed: true }
  ));

  await bridge.build_model({ runtime, timeoutMs, code: JSON.stringify(seedDocument()) });
  let adoption = await adopt(bridge, runtime, timeoutMs);
  assert(adoption.recursive_truncated === false, 'recursive index must not truncate');
  assert(adoption.recursive_index.filter((entry) => entry.name === 'Existing_Edit_Leaf_Box').length === 2, 'shared deep leaf must have two occurrences');

  const leaf = requireEntry(adoption, (entry) => entry.name === 'Existing_Edit_Leaf_Box', 'deep leaf group');
  const face = requireEntry(adoption, (entry) => entry.entity_type === 'face' && entry.entity_path.startsWith(leaf.entity_path), 'deep leaf face');
  const edge = requireEntry(adoption, (entry) => entry.entity_type === 'edge' && entry.entity_path.startsWith(leaf.entity_path), 'deep leaf edge');
  const propertyPlan = await prepareAndApply(bridge, {
    runtime,
    timeoutMs,
    outputDir: path.join(absoluteOutputDir, 'property'),
    instruction: 'Apply reviewed face material and edge properties to an existing deep component definition.',
    targets: [target(face), target(edge)],
    operations: [
      { op: 'set_face_material', ...target(face), material: 'Existing_Edit_Accent', side: 'both' },
      { op: 'set_edge_properties', ...target(edge), soft: true, smooth: true }
    ]
  });
  assert(propertyPlan.plan.risk_level === 'S1', 'property plan must be S1');

  adoption = await adopt(bridge, runtime, timeoutMs);
  assert(adoption.recursive_index.some((entry) => entry.entity_type === 'face' && entry.material === 'Existing_Edit_Accent'), 'reviewed face material must be indexed');
  assert(adoption.recursive_index.some((entry) => entry.entity_type === 'edge' && entry.soft === true && entry.smooth === true), 'reviewed edge properties must be indexed');

  const uniqueSource = requireEntry(adoption, (entry) => entry.name === 'Existing_Edit_Leaf_Box', 'make-unique leaf');
  const uniquePlan = await prepareAndApply(bridge, {
    runtime,
    timeoutMs,
    outputDir: path.join(absoluteOutputDir, 'make-unique'),
    instruction: 'Isolate one deep occurrence and rename only its nested leaf group.',
    targets: [{ ...target(uniqueSource), instance_policy: 'make_unique', instance_id: 'existing-edit-middle-a' }],
    operations: [{ op: 'rename', ...target(uniqueSource), instance_policy: 'make_unique', instance_id: 'existing-edit-middle-a', new_name: 'Existing_Edit_Leaf_Box_Unique' }]
  });
  adoption = await adopt(bridge, runtime, timeoutMs);
  assert(adoption.recursive_index.filter((entry) => entry.name === 'Existing_Edit_Leaf_Box_Unique').length === 1, 'make_unique must isolate one occurrence');
  assert(adoption.recursive_index.filter((entry) => entry.name === 'Existing_Edit_Leaf_Box').length === 1, 'original shared leaf must remain once');

  const featureSource = requireEntry(adoption, (entry) => entry.name === 'Existing_Edit_Leaf_Box', 'feature leaf');
  const featureFacesBefore = featureSource.faces;
  const featurePlan = await prepareAndApply(bridge, {
    runtime,
    timeoutMs,
    outputDir: path.join(absoluteOutputDir, 'feature'),
    instruction: 'Cut a reviewed hole into a nested existing solid.',
    targets: [target(featureSource)],
    operations: [{ op: 'cut_hole', ...target(featureSource), center: [60, 35], radius: 8, feature_id: 'existing-edit-reviewed-hole' }]
  });
  assert(featurePlan.plan.risk_level === 'S3', 'feature plan must be S3');
  adoption = await adopt(bridge, runtime, timeoutMs);
  const featureResult = requireEntry(adoption, (entry) => entry.entity_path === featureSource.entity_path, 'feature result');
  assert(featureResult.faces > featureFacesBefore, 'nested feature must change topology');
  assert(featureResult.features?.some((feature) => feature.id === 'existing-edit-reviewed-hole'), 'nested feature must return its reviewed feature id');

  const booleanTarget = requireEntry(adoption, (entry) => entry.name === 'Existing_Edit_Boolean_Target', 'boolean target');
  const booleanTool = requireEntry(adoption, (entry) => entry.name === 'Existing_Edit_Boolean_Tool', 'boolean tool');
  const booleanPlan = await prepareAndApply(bridge, {
    runtime,
    timeoutMs,
    outputDir: path.join(absoluteOutputDir, 'boolean'),
    instruction: 'Subtract a reviewed nested tool solid in the same component definition.',
    targets: [target(booleanTarget), target(booleanTool)],
    operations: [{
      op: 'boolean_difference',
      ...target(booleanTarget),
      tools: [{ ...target(booleanTool), name: booleanTool.name }],
      result_id: 'existing-edit-boolean-result',
      result_name: 'Existing_Edit_Boolean_Result'
    }]
  });
  adoption = await adopt(bridge, runtime, timeoutMs);
  assert(adoption.recursive_index.filter((entry) => entry.name === 'Existing_Edit_Boolean_Result').length === 1, 'nested boolean result must be indexed once');
  assert(adoption.recursive_index.every((entry) => entry.name !== 'Existing_Edit_Boolean_Tool'), 'consumed nested boolean tool must be absent');

  const manifoldSource = requireEntry(adoption, (entry) => entry.name === 'Existing_Edit_Boolean_Result', 'manifold target');
  const manifoldPlan = await prepareAndApply(bridge, {
    runtime,
    timeoutMs,
    outputDir: path.join(absoluteOutputDir, 'manifold'),
    instruction: 'Record a reviewed manifold check for the nested boolean result.',
    targets: [target(manifoldSource)],
    operations: [{ op: 'manifold_check', ...target(manifoldSource), check_id: 'existing-edit-manifold', fail_on_non_manifold: true }]
  });

  const beforeSave = await adopt(bridge, runtime, timeoutMs);
  const beforeReopenRevision = modelRevisionForAdoption(beforeSave);
  const beforeReopenPath = requireEntry(beforeSave, (entry) => entry.name === 'Existing_Edit_Boolean_Result', 'pre-reopen boolean result').entity_path;
  const saved = await bridge.save_model({ runtime, timeoutMs, path: absoluteSavePath, keep_session: true });
  await bridge.open_model({ runtime, timeoutMs, path: absoluteSavePath });
  const reopened = await adopt(bridge, runtime, timeoutMs);
  const reopenedResult = requireEntry(reopened, (entry) => entry.name === 'Existing_Edit_Boolean_Result', 'reopened boolean result');
  assert(reopenedResult.entity_path === beforeReopenPath, 'persistent entity_path must survive save/reopen');
  assert(modelRevisionForAdoption(reopened) === beforeReopenRevision, 'model revision must survive save/reopen');
  assert(reopened.recursive_index.some((entry) => entry.name === 'Existing_Edit_Leaf_Box_Unique'), 'make_unique result must survive save/reopen');

  const report = {
    version: 1,
    kind: 'existing_model_editing_validation',
    ok: true,
    runtime,
    model_revision: beforeReopenRevision,
    persistent_path_before_reopen: beforeReopenPath,
    persistent_path_after_reopen: reopenedResult.entity_path,
    saved_model: saved.path || saved.file_path || absoluteSavePath,
    plans: {
      property: planEvidence(propertyPlan),
      make_unique: planEvidence(uniquePlan),
      feature: planEvidence(featurePlan),
      boolean: planEvidence(booleanPlan),
      manifold: planEvidence(manifoldPlan)
    },
    evidence: {
      recursive_entities: reopened.recursive_index.length,
      face_edge_editable: reopened.recursive_index.filter((entry) => ['face', 'edge'].includes(entry.entity_type)).every((entry) => entry.editable === true),
      unique_occurrence_count: reopened.recursive_index.filter((entry) => entry.name === 'Existing_Edit_Leaf_Box_Unique').length,
      boolean_result_count: reopened.recursive_index.filter((entry) => entry.name === 'Existing_Edit_Boolean_Result').length,
      reopen_verified: true
    }
  };
  const reportPath = path.join(absoluteOutputDir, 'existing-model-editing-report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { ...report, report: reportPath };
}

function seedDocument() {
  return {
    version: 1,
    units: 'mm',
    operations: [
      { op: 'reset' },
      { op: 'material', name: 'Existing_Edit_Base', color: '#a0a8b0' },
      { op: 'material', name: 'Existing_Edit_Accent', color: '#2868c7' },
      { op: 'component_definition', name: 'Existing_Edit_Leaf', operations: [
        { op: 'box', id: 'existing-edit-leaf-box', name: 'Existing_Edit_Leaf_Box', origin: [0, 0, 0], size: [120, 70, 30], material: 'Existing_Edit_Base' }
      ] },
      { op: 'component_definition', name: 'Existing_Edit_Middle', operations: [
        { op: 'component_instance', id: 'existing-edit-leaf-instance', name: 'Existing_Edit_Leaf_Instance', definition: 'Existing_Edit_Leaf', origin: [0, 0, 0] }
      ] },
      { op: 'component_definition', name: 'Existing_Edit_Boolean', operations: [
        { op: 'box', id: 'existing-edit-boolean-target', name: 'Existing_Edit_Boolean_Target', origin: [0, 0, 0], size: [100, 80, 40], material: 'Existing_Edit_Base' },
        { op: 'box', id: 'existing-edit-boolean-tool', name: 'Existing_Edit_Boolean_Tool', origin: [50, 20, 0], size: [80, 40, 40], material: 'Existing_Edit_Base' }
      ] },
      { op: 'component_instance', id: 'existing-edit-middle-a', name: 'Existing_Edit_Middle_A', definition: 'Existing_Edit_Middle', origin: [0, 0, 0] },
      { op: 'component_instance', id: 'existing-edit-middle-b', name: 'Existing_Edit_Middle_B', definition: 'Existing_Edit_Middle', origin: [250, 0, 0] },
      { op: 'component_instance', id: 'existing-edit-boolean-instance', name: 'Existing_Edit_Boolean_Instance', definition: 'Existing_Edit_Boolean', origin: [0, 150, 0] }
    ]
  };
}

async function adopt(bridge, runtime, timeoutMs) {
  return bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, recursive_limit: 1000, prefix: 'existing-edit' });
}

async function prepareAndApply(bridge, { runtime, timeoutMs, outputDir, instruction, targets, operations }) {
  const prepared = await bridge.prepare_existing_model_edit({ runtime, timeoutMs, instruction, targets, operations, output_dir: `${outputDir}-prepare`, recursive_limit: 1000 });
  assert(prepared.plan.compile_permission === 'ready_for_review', `${prepared.plan.plan_id} must be ready for review`);
  const applied = await bridge.apply_reviewed_model_edit({
    runtime,
    timeoutMs,
    plan: prepared.plan,
    approval_token: await bridge.validationApprovalProvider(prepared, bridge),
    output_dir: `${outputDir}-apply`,
    save_model: false
  });
  assert(applied.ok === true, `${prepared.plan.plan_id} must apply successfully`);
  return { plan: prepared.plan, applied };
}

function requireEntry(adoption, predicate, label) {
  const entry = adoption.recursive_index?.find(predicate);
  assert(entry, `missing ${label}`);
  return entry;
}

function target(entry) {
  return { entity_path: entry.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
}

function planEvidence(value) {
  return {
    plan_id: value.plan.plan_id,
    risk_level: value.plan.risk_level,
    affected_instance_count: value.plan.affected_instance_count,
    artifacts: value.applied.artifacts
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--runtime') options.runtime = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg === '--output-dir') options.outputDir = argv[++index];
    else if (arg === '--save-skp') options.saveSkp = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  validateExistingModelEditing(parseArgs(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exit(1);
    });
}
