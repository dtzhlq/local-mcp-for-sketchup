import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getModelAccessibilityTaskCatalog, preflightModelAccessibilityTask, compileModelAccessibilityTask, MODEL_ACCESSIBILITY_TASK_KINDS } from '../src/model-accessibility-tasks.mjs';
import { queryLocalAssets } from '../src/asset-catalog.mjs';
import { prepareTaskOwnedCreationDsl } from '../src/agent-dsl-policy.mjs';
import { freezeDetailSpecification } from '../src/detail-quality.mjs';
import { MockRuntime } from '../src/mock-runtime.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchup-accessibility-tasks-'));
const catalog = getModelAccessibilityTaskCatalog({ detail: 'all' });
const examples = new Map(catalog.tasks.map(item => [item.kind, item.examples.minimal.arguments.inputs.task]));
const taskFor = kind => structuredClone(examples.get(kind));
const cases = [];
const limits = { max_operations: 100, max_affected_instances: 200 };
const reject = (task, expected, context) => {
  const result = preflightModelAccessibilityTask(task, context);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.execution_started, false);
  assert.equal(result.quality_accepted, false);
  assert.equal(result.normalized, null);
  assert.ok(result.issues.some(issue => (!expected.code || issue.code === expected.code) && (!expected.path || issue.path === expected.path)), JSON.stringify(result.issues));
  for (const issue of result.issues) { assert.ok(issue.fix_options.length); assert.ok(['self_correctable', 'design_input', 'runtime_blocked'].includes(issue.recovery_class)); }
  assert.throws(() => compileModelAccessibilityTask(task, context), error => error.code === 'INVALID_ARGUMENT' && Boolean(error.details?.recovery_class));
  return result;
};

assert.deepEqual(catalog.tasks.map(item => item.kind), MODEL_ACCESSIBILITY_TASK_KINDS);
assert.ok(JSON.stringify(getModelAccessibilityTaskCatalog()).length < 6000, 'First contact must not dump every asset and parameter contract.');
assert.equal(getModelAccessibilityTaskCatalog({ task: 'window', detail: 'parameters' }).tasks.length, 1);
assert.throws(() => getModelAccessibilityTaskCatalog({ task: 'typo' }), /Unknown/);
assert.throws(() => getModelAccessibilityTaskCatalog({ detail: 'typo' }), /detail/);
const localAssets = await queryLocalAssets();
assert.deepEqual(catalog.assets.map(asset => [asset.id, asset.name]), localAssets.assets.map(asset => [asset.id, asset.name]), 'Helper asset names must match the real existing local catalog.');
assert.deepEqual(getModelAccessibilityTaskCatalog({ task: 'asset_placement', query: 'side_table' }).assets.map(asset => asset.id), ['detail-side_table']);
for (const item of catalog.tasks) {
  const readExample = suffix => fs.readFile(new URL(`../examples/model-accessibility/${item.kind}-${suffix}.json`, import.meta.url), 'utf8').then(JSON.parse);
  assert.deepEqual(await readExample('minimal'), item.examples.minimal, 'Saved executable examples must match current discovery.');
  assert.deepEqual(await readExample('missing-parameter'), item.examples.common_error, 'Saved negative examples must match current field contracts.');
}
cases.push({ case: 'progressive-discovery-and-existing-catalog-parity', status: 'pass' });

for (const kind of MODEL_ACCESSIBILITY_TASK_KINDS) {
  const task = taskFor(kind), before = structuredClone(task), compiled = compileModelAccessibilityTask(task, { limits });
  assert.deepEqual(task, before, 'Compilation cannot mutate user input.');
  assert.equal(compiled.preflight.evidence_level, 'preflight_only');
  assert.equal(compiled.bundle.live_geometry_verified, false);
  assert.equal(compiled.inputs.detail_spec.required_parts.length, compiled.bundle.parts_mapping.length, 'Every leaf occurrence keeps the existing detailed quality requirement.');
  assert.equal(compiled.inputs.detail_spec.required_views.length, 2);
  assert.ok(compiled.inputs.detail_spec.required_views.some(view => view.kind === 'closeup'));
  assert.equal(compiled.inputs.detail_spec.max_iterations, 6);
  assert.equal(compiled.preflight.boundaries.max_automatic_refinements_per_part, 3);
  assert.ok(!compiled.bundle.dsl.operations.some(operation => ['reset', 'scene', 'camera', 'style'].includes(operation.op)));
  const prepared = prepareTaskOwnedCreationDsl(compiled.inputs.code, { taskId: 'task_00000000-0000-0000-0000-000000000001' });
  assert.ok(prepared.identity_map[`id-${task.id}`]);
  freezeDetailSpecification(compiled.inputs.detail_spec);
  const runtime = new MockRuntime({ sessionPath: path.join(temporary, `${kind}.json`) });
  await runtime.buildModel(JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', id: 'preserve-user-object', name: 'preserve-user-object', origin: [15000, 0, 0], size: [10, 20, 30] }] }));
  const initial = await runtime.readModel();
  const built = await runtime.buildModel(compiled.inputs.code);
  const model = await runtime.readModel();
  assert.ok(built.totals.faces > 50, `${kind} must create real constructive mock geometry.`);
  assert.ok(initial.groups.find(object => object.id === 'preserve-user-object'));
  assert.deepEqual(model.groups.find(object => object.id === 'preserve-user-object'), initial.groups.find(object => object.id === 'preserve-user-object'), 'Existing user geometry must remain unchanged.');
  assert.equal(model.instances.length, 1);
  const wrong = catalog.tasks.find(item => item.kind === kind).examples.common_error;
  reject(wrong.input, wrong.expected);
  cases.push({ case: `minimal-${kind}-compile-policy-and-isolated-mock`, status: 'pass', faces: built.totals.faces, leaf_occurrences: compiled.bundle.parts_mapping.length });
}

const misplaced = taskFor('window');
misplaced.instances = [{ id: 'left-window', origin_mm: [1000, 2000, 300], rotation_z_deg: 90 }, { id: 'right-window', origin_mm: [5000, 2000, 300] }];
delete misplaced.placement;
const shared = compileModelAccessibilityTask(misplaced, { limits });
assert.equal(shared.bundle.part_graph.roots.length, 2);
assert.equal(shared.bundle.part_graph.roots[0].part_id, shared.bundle.part_graph.roots[1].part_id);
assert.equal(shared.bundle.dsl.operations.filter(operation => operation.op === 'component_definition').length, compileModelAccessibilityTask(taskFor('window')).bundle.dsl.operations.filter(operation => operation.op === 'component_definition').length);
assert.equal(shared.inputs.detail_spec.required_parts.length, 50);
assert.equal(shared.inputs.detail_spec.required_views.length, 4);
assert.deepEqual(shared.bundle.part_graph.roots[0].origin, [1000, 2000, 300]);
assert.equal(shared.bundle.part_graph.roots[0].transform.rotateZ, 90);
const runtime = new MockRuntime({ sessionPath: path.join(temporary, 'shared-rotated.json') });
await runtime.buildModel(shared.inputs.code);
const sharedModel = await runtime.readModel();
assert.deepEqual(sharedModel.instances.map(instance => instance.id), ['left-window', 'right-window']);
assert.equal(sharedModel.instances[0].definition, sharedModel.instances[1].definition);
const leftBounds = sharedModel.instances[0].bounding_box;
assert.ok(leftBounds.min[0] < 1000 && leftBounds.max[1] > 3000, 'Local width rotates into world Y, then the explicit world translation is applied.');
cases.push({ case: 'shared-definition-explicit-placement-rotation-and-occurrence-coverage', status: 'pass' });

const sink = compileModelAccessibilityTask(taskFor('sink_counter'));
const slab = sink.bundle.part_graph.parts.find(part => part.role === 'worktop');
assert.equal(slab.shape.parameters.holes.length, 1);
assert.deepEqual(slab.shape.parameters.holes[0], [[248, 78], [952, 78], [952, 482], [248, 482]]);
assert.ok(sink.inputs.detail_spec.required_voids.some(rule => rule.id.endsWith('-counter-opening')));
for (const rule of sink.inputs.detail_spec.required_voids) assert.equal(rule.instance_path[0], 'id-example-sink_counter');
assert.ok(sink.inputs.detail_spec.required_parts.some(rule => rule.role === 'worktop' && rule.geometry_checks.some(check => check.type === 'opening')));
assert.equal(sink.inputs.views.find(view => view.kind === 'closeup').camera.target[2], 900, 'Sink closeup must aim at the countertop and basin opening.');
cases.push({ case: 'countertop-through-opening-and-bound-sink-void-requirements', status: 'pass' });

for (const asset of catalog.assets.filter(asset => asset.placement_supported)) {
  const entry = getModelAccessibilityTaskCatalog({ task: 'asset_placement', detail: 'all', query: asset.name }).assets.find(item => item.id === asset.id);
  const task = { version: 1, kind: 'asset_placement', id: `asset-test-${asset.name}`, asset_id: asset.id, units: 'mm', parameters: structuredClone(entry.nominal_parameters_mm), placement: { origin_mm: [200, 300, 400] } };
  const built = compileModelAccessibilityTask(task, { limits });
  prepareTaskOwnedCreationDsl(built.inputs.code, { taskId: 'task_00000000-0000-0000-0000-000000000001' });
  assert.equal(built.bundle.part_graph.roots.length, 1);
  assert.equal(built.bundle.part_graph.roots[0].part_id, task.id);
  assert.ok(built.inputs.detail_spec.required_parts.length > 3);
}
cases.push({ case: 'every-advertised-asset-placement-compiles-to-complete-root-with-quality-gates', status: 'pass' });

for (const value of [undefined, null, [], 'window', 1]) reject(value, { path: 'task' });
for (const [mutate, expected] of [
  [task => { task.units = 'cm'; }, { code: 'UNSUPPORTED_UNITS', path: 'task.units' }],
  [task => { task.version = 2; }, { code: 'UNSUPPORTED_VERSION' }],
  [task => { task.parameters.width_mm = '1600'; }, { code: 'OUT_OF_RANGE' }],
  [task => { task.parameters.width_mm = 100; }, { code: 'OUT_OF_RANGE' }],
  [task => { task.parameters.depth_mm = Infinity; }, { code: 'OUT_OF_RANGE' }],
  [task => { task.parameters.width_mm = null; }, { code: 'OUT_OF_RANGE' }],
  [task => { task.parameters.width = 1600; }, { code: 'UNKNOWN_FIELD', path: 'task.parameters.width' }],
  [task => { task.approved = true; }, { code: 'UNKNOWN_FIELD' }],
  [task => { task.detail_spec = { version: 1, required_parts: [] }; }, { code: 'UNKNOWN_FIELD' }],
  [task => { task.placement.origin_mm = [0, '0', 0]; }, { code: 'INVALID_VECTOR' }],
  [task => { delete task.placement.origin_mm; }, { code: 'MISSING_INPUT' }],
  [task => { task.placement.rotation_z_deg = 500; }, { code: 'OUT_OF_RANGE' }],
  [task => { task.placement.scale = [2, 1, 1]; }, { code: 'UNKNOWN_FIELD' }],
  [task => { delete task.placement; }, { code: 'PLACEMENT_CHOICE_REQUIRED' }],
  [task => { task.instances = [{ id: 'a', origin_mm: [0, 0, 0] }]; }, { code: 'PLACEMENT_CHOICE_REQUIRED' }],
  [task => { delete task.placement; task.instances = [{ id: 'same', origin_mm: [0, 0, 0] }, { id: 'same', origin_mm: [2000, 0, 0] }]; }, { code: 'DUPLICATE_IDENTIFIER' }],
  [task => { delete task.placement; task.instances = Array.from({ length: 13 }, (_, i) => ({ id: `window-${i}`, origin_mm: [2000 * i, 0, 0] })); }, { code: 'RESOURCE_BUDGET' }],
  [task => { task.asset_id = 'detail-window'; }, { code: 'UNEXPECTED_FIELD' }]
]) { const task = taskFor('window'); mutate(task); reject(task, expected); }
reject(taskFor('window'), { code: 'NAME_CONFLICT' }, { existingIds: ['id-example-window'] });
reject(taskFor('window'), { code: 'RESOURCE_BUDGET' }, { limits: { max_operations: 2 } });
reject(taskFor('window'), { code: 'RESOURCE_BUDGET' }, { limits: { max_affected_instances: 2 } });
reject(taskFor('window'), { code: 'RESOURCE_BUDGET' }, { resourceBudget: { max_faces: 5 } });
const operations = compileModelAccessibilityTask(taskFor('window')).preflight.normalized.required_operations;
assert.ok(operations.includes('profile_extrude'));
reject(taskFor('window'), { code: 'CAPABILITY_UNSUPPORTED' }, { availableOperations: operations.filter(name => name !== 'profile_extrude') });
assert.equal(preflightModelAccessibilityTask(taskFor('window'), { availableOperations: operations, limits }).ok, true);
const tooLong = taskFor('cabinet'); tooLong.parameters.handle_length_mm = 790; reject(tooLong, { code: 'PARAMETER_DEPENDENCY', path: 'task.parameters.handle_length_mm' });
const tooOpen = taskFor('cabinet'); tooOpen.parameters.drawer_extension_mm = 520; reject(tooOpen, { code: 'PARAMETER_DEPENDENCY', path: 'task.parameters.drawer_extension_mm' });
const wrongSink = taskFor('sink_counter'); wrongSink.parameters.sink_offset_y_mm = 200; reject(wrongSink, { code: 'PARAMETER_DEPENDENCY' });
const wrongAsset = taskFor('asset_placement'); wrongAsset.asset_id = 'outside-catalog.skp'; reject(wrongAsset, { code: 'UNSUPPORTED_ASSET' });
const rawParameters = taskFor('window'); rawParameters.parameters = []; reject(rawParameters, { code: 'INVALID_TYPE' });
cases.push({ case: 'preflight-rejects-invalid-design-units-unknown-fields-scope-capabilities-and-resource-limits', status: 'pass' });

// The helper may not rewrite the frozen specification into a weaker variant.
const fixed = compileModelAccessibilityTask(taskFor('cabinet')).inputs.detail_spec;
const frozen = freezeDetailSpecification(fixed);
const weakened = structuredClone(fixed); weakened.required_parts.pop();
assert.throws(() => freezeDetailSpecification(weakened, frozen), /frozen/);
const change = taskFor('cabinet'); change.parameters.width_mm = 900;
assert.throws(() => freezeDetailSpecification(compileModelAccessibilityTask(change).inputs.detail_spec, frozen), /frozen/);
cases.push({ case: 'generated-detail-spec-retains-existing-freeze-boundary', status: 'pass' });

const report = { version: 1, ok: true, execution_scope: 'offline_task_contract_and_isolated_mock', live_geometry_verified: false, cross_model_acceptance: false, temporary_session_root: temporary, cases };
const reportArg = process.argv.indexOf('--report');
if (reportArg >= 0) await fs.writeFile(process.argv[reportArg + 1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
