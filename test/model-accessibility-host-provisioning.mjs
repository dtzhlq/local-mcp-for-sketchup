import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { prepareHostCommonCreation, attachHostCreationPacket, prepareHostCreationDsl } from '../src/model-accessibility-host-provisioning.mjs';
import { validateCreationScopeAgainstModel, prepareTaskOwnedCreationDsl } from '../src/agent-dsl-policy.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'host-common-provisioning-test-'));
const config = { mock: { sessionPath: path.join(root, 'model.json') }, agentContract: { rootDir: path.join(root, 'tasks') } };
let checks = 0;
const check = fn => { fn(); checks++; };
const source = (id, ids) => ({ version: 1, kind: 'cabinet', id, units: 'mm', parameters: { width_mm: 600, depth_mm: 600, height_mm: 900 },
  instances: ids.map((id, i) => ({ id, origin_mm: [i * 1600, 0, 0] })) });
const args = (key, task, metadata = []) => prepareHostCommonCreation({ instruction: 'Prepare an isolated authored fixture, before any model test.', idempotency_key: key,
  inputs: { runtime: 'mock', recursive_limit: 10000, task }, metadata });
const marker = [{ root_id: 'B', dictionary: 'BenchmarkManualEdit', attributes: { preserve: true, note: 'keep-me', material: 'literal, not a material reference', no_value: null }, tag: 'preserve-manual' }];
try {
  const bridge = new SketchUpBridge(config), gateway = bridge.agentGateway;
  for (const metadata of [ [{ ...marker[0], root_id: 'existing' }], [{ ...marker[0], dictionary: 'dynamic_attributes' }], [{ ...marker[0], attributes: { eval: { expression: '1+1' } } }], [{ ...marker[0], target_id: 'pid:1' }], [{ ...marker[0], attributes: { constructor: true } }] ]) {
    check(() => assert.throws(() => args('bad', source('two', ['A','B']), metadata)));
  }
  const options = args('source-two', source('two', ['A', 'B']), marker);
  const result = await gateway.start(options), task = await bridge.taskStore.getTask(result.task_id, { includePrivate: true });
  check(() => assert.equal(result.error, null, JSON.stringify(result.error)));
  check(() => assert.equal(task.private.creation.parameter_edit_support.baseline_captured, true));
  check(() => assert.equal(task.private.creation.parameter_source.entries.length, 2));
  check(() => assert.equal(task.inputs.host_creation_packet, undefined));
  const runtime = bridge.selectRuntime('mock'), original = await runtime.readModel();
  const actualB = original.instances.find(item => item.id === task.private.creation.identity_map.B);
  check(() => assert.equal(actualB.attributes.BenchmarkManualEdit.note, 'keep-me'));
  check(() => assert.match(actualB.tag, /^alma_[a-f0-9]{20}_tag_[a-f0-9]{16}$/));
  check(() => assert.equal(original.instances[0].definition, actualB.definition));
  const discovery = await gateway.start({ intent: 'discover', instruction: 'Find current parameter source for B.', inputs: { topic: 'parameter_sources', runtime: 'mock', query: 'B' } });
  check(() => assert.equal(discovery.error, null));
  check(() => assert.equal(discovery.result.sources[0].creation_task_id, task.task_id));
  check(() => assert.deepEqual(discovery.result.sources[0].roots, [{ name: 'B', target: { target_id: preparedId(task, 'B') } }]));
  check(() => assert.equal(discovery.result.sources[0].baseline_captured, true));
  check(() => assert.equal(JSON.stringify(discovery.result).includes(root), false));
  const adopt = bridge.adopt_open_model.bind(bridge);
  bridge.adopt_open_model = async options => { const observed = await adopt(options); return { ...observed, document_id: 'different-document-with-same-source-path' }; };
  const otherDocument = await gateway.start({ intent: 'discover', instruction: 'Only inspect this document.', inputs: { topic: 'parameter_sources', runtime: 'mock' } });
  check(() => assert.deepEqual(otherDocument.result.sources, []));
  bridge.adopt_open_model = adopt;
  const replay = await new SketchUpBridge(config).agentGateway.start(args('source-two', source('two', ['A', 'B']), marker));
  check(() => assert.equal(replay.idempotent_replay, true));
  const after = await runtime.readModel(); check(() => assert.deepEqual(after, original));
  await assert.rejects(() => gateway.start(args('source-two', source('two', ['A','B']), [{ ...marker[0], attributes: { preserve: false } }])), /replace frozen host metadata/); checks++;
  // An inert JSON copy has no authority to request host metadata.
  const copied = JSON.parse(JSON.stringify(args('unbranded', source('unbranded', ['X']), [{ ...marker[0], root_id: 'X' }])));
  const ordinary = await gateway.start(copied), ordinaryTask = await bridge.taskStore.getTask(ordinary.task_id, { includePrivate: true });
  check(() => assert.equal(ordinaryTask.private.host_creation_packet, undefined));
  check(() => assert.equal(ordinaryTask.private.creation.host_provisioning, undefined));
  await assert.rejects(() => attachHostCreationPacket({ options: args('late', source('unbranded', ['X']), []), task: ordinaryTask, taskStore: bridge.taskStore }), /before first execution/); checks++;
  const prepared = await prepareHostCreationDsl({ task, taskStore: bridge.taskStore, sourceCode: task.inputs.code, iteration: 0 });
  check(() => assert.throws(() => prepareTaskOwnedCreationDsl(JSON.stringify({ version: 1, operations: [{ op: 'attribute', target_id: 'A', dictionary: 'BenchmarkFixture', attributes: { preserve: true } }] }), { taskId: task.task_id }), /unsupported operation/));
  for (const change of [doc => doc.operations.push({ op: 'attribute', target_id: 'pid:old', dictionary: 'BenchmarkFixture', attributes: { preserve: true } }), doc => doc.operations.at(-1).target_id = 'pid:old', doc => doc.operations.at(-2).name = 'existing', doc => doc.operations.at(-3).attributes.bad = [], doc => doc.operations.at(-3).dictionary = 'dynamic_attributes', doc => doc.operations.find(op => op.op === 'component_definition').operations.push({ op: 'attribute', target_id: 'B', dictionary: 'BenchmarkFixture', attributes: { preserve: true } }) ]) {
    const forged = structuredClone(prepared.document); change(forged);
    check(() => assert.throws(() => validateCreationScopeAgainstModel(forged, {})));
  }
  check(() => assert.throws(() => validateCreationScopeAgainstModel(prepared.document, { tags: { [actualB.tag]: {} } }), /tag already exists/));
  check(() => assert.throws(() => validateCreationScopeAgainstModel(prepared.document, { instances: [{ adopted_id: prepared.identity_map.B }] }), /target already exists/));
  const tampered = structuredClone(task); tampered.private.host_creation_packet.metadata[0].attributes.preserve = false;
  await assert.rejects(() => prepareHostCreationDsl({ task: tampered, taskStore: bridge.taskStore, sourceCode: task.inputs.code, iteration: 0 }), /integrity/); checks++;
  await assert.rejects(() => prepareHostCreationDsl({ task, taskStore: bridge.taskStore, sourceCode: task.inputs.code, iteration: 1 }), /initially frozen/); checks++;
  // Complete physical definition inventory may be small while occurrence paths
  // are larger. Do not deduplicate distinct occurrences into a false complete index.
  const counts = { root_instances: original.instances.length, physical_definitions: Object.keys(original.component_definitions).length,
    physical_groups: Object.values(original.component_definitions).reduce((n,d) => n + d.groups.length, 0) };
  const adopted = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, recursive_limit: 10000 });
  const graph = buildModelGraph(adopted);
  check(() => assert.equal(graph.completeness.recursive_truncated, true));
  check(() => assert.equal(graph.completeness.complete, false));
  for (const mode of ['missing-marker', 'lost-build-response']) {
    const isolated = new SketchUpBridge({ mock: { sessionPath: path.join(root, mode, 'model.json') }, agentContract: { rootDir: path.join(root, mode, 'tasks') } });
    const rt = isolated.selectRuntime('mock'), build = rt.buildModel.bind(rt); let builds = 0;
    rt.buildModel = async code => {
      builds++;
      const doc = JSON.parse(code);
      if (mode === 'missing-marker') doc.operations = doc.operations.filter(op => op.op !== 'attribute');
      const built = await build(JSON.stringify(doc));
      if (mode === 'lost-build-response') throw new Error('Offline simulated loss after commit, before receipt');
      return built;
    };
    const failed = await isolated.agentGateway.start(args(mode, source(mode, ['B']), marker));
    const initialFailure = await isolated.taskStore.getTask(failed.task_id, { includePrivate: true });
    check(() => assert.equal(initialFailure.private.creation.parameter_source, undefined));
    if (mode === 'missing-marker') check(() => assert.equal(initialFailure.private.creation.parameter_edit_support.baseline_captured, false));
    await isolated.resume_agent_task({ task_id: failed.task_id });
    const afterRecovery = await isolated.taskStore.getTask(failed.task_id, { includePrivate: true });
    check(() => assert.equal(builds, 1));
    check(() => assert.equal(afterRecovery.private.creation.parameter_source, undefined));
    const unavailable = await isolated.agentGateway.start({ intent: 'discover', instruction: 'Read indexed sources.', inputs: { topic: 'parameter_sources', runtime: 'mock' } });
    check(() => assert.deepEqual(unavailable.result.sources, []));
  }
  process.stdout.write(`${checks} host provisioning assertions passed; two-root baseline captured before third distinct source; later expanded index correctly truncated. ${JSON.stringify(counts)}\n`);
} finally { await fs.rm(root, { recursive: true, force: true }); }
function preparedId(task, logical) { return task.private.creation.identity_map[logical]; }
