import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runLayoutNativeQA } from '../scripts/qa-workflow-improvements-layout.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'layout-qa-resume-'));
try {
  // Missing authorization must fail before bridge construction, output
  // creation or queue access. Queue paths are additionally isolated so even
  // a future guard regression cannot reach an installed SketchUp transport.
  const runner = fileURLToPath(new URL('../scripts/qa-workflow-improvements-native.mjs', import.meta.url));
  for (const mode of ['bootstrap', 'layout', 'structure', 'capture', 'save']) {
    const output = path.join(directory, `unauthorized-${mode}`), isolatedState = path.join(directory, `forbidden-state-${mode}`);
    const env = { ...process.env, ALMA_SKETCHUP_STATE_DIR: isolatedState,
      ALMA_SKETCHUP_QUEUE_DIR: path.join(isolatedState, 'queue'), ALMA_SKETCHUP_RESPONSE_DIR: path.join(isolatedState, 'responses') };
    delete env.SKETCHUP_QA_AUTHORIZATION_REF;
    const result = spawnSync(process.execPath, [runner, mode, output], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SKETCHUP_QA_AUTHORIZATION_REF must explicitly identify/);
    await assert.rejects(fs.access(output), error => error.code === 'ENOENT', 'Unauthorized launch must not create output');
    await assert.rejects(fs.access(isolatedState), error => error.code === 'ENOENT', 'Unauthorized launch must not initialize queue state');
  }
  // Actual public mock API proves that a policy-rejected, unprepared task can
  // accept corrected budgets without replacing its identity or writing geometry.
  const options = { mock: { sessionPath: path.join(directory, 'mock.json') }, agentContract: { rootDir: path.join(directory, 'tasks') },
    approval: { stateDir: path.join(directory, 'approval') }, executionPolicy: { allowed_runtimes: ['mock'], resource_limits: { max_affected_instances: 40 } } };
  const initialBridge = new SketchUpBridge(options);
  await initialBridge.build_model({ runtime: 'mock', code: JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', id: 'root', name: 'Root', origin: [0, 0, 0], size: [10, 20, 30] }] }) });
  const adoption = await initialBridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true });
  const bridge = new SketchUpBridge({ ...options, executionPolicy: { ...options.executionPolicy, development_model_auto_approval: {
    enabled: true, authorization_ref: 'offline-test-only', allowed_model_keys: [modelKeyForIdentity(modelIdentityForAdoption(adoption))], allowed_risks: ['S1', 'S2'], max_affected_instances: 40 } } });
  const rejected = await bridge.start_agent_task({ intent: 'reviewed_existing_model_edit', instruction: 'Test a read-only layout preparation budget correction.', idempotency_key: 'prepare',
    inputs: { runtime: 'mock', save_model: false, layout_edit: { version: 1, mode: 'array', axis: 'x', targets: [{ target_id: 'root' }], count: 3, spacing_mm: 20 } } });
  assert.equal(rejected.error.code, 'POLICY_DENIED');
  assert.equal(rejected.task_state, 'awaiting_input');
  const resumed = await bridge.submit_agent_task_input({ task_id: rejected.task_id, idempotency_key: 'budget-resume', input: { budgets: { max_operations: 100, max_affected_instances: 40, recursive_limit: 5000 }, recursive_limit: 5000 } });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.task_id, rejected.task_id);
  assert.equal(resumed.task_state, 'approved');
  assert.deepEqual((await bridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true })).entities, adoption.entities);

  // Native-shaped read-only stubs: zero queue/UI calls. The module must reuse
  // stored fixture identities and only submit the rejected task's budget fix.
  for (const stage of ['before-layout', 'after-align']) for (const changed of [false, true]) {
    const out = path.join(directory, `${stage}-${changed ? 'changed' : 'same'}`), evidence = path.join(out, 'layout-native');
    await fs.mkdir(evidence, { recursive: true });
    const run = 'wf-layout-11111111-1111-4111-8111-111111111111', fixturePath = path.join(out, 'fixture.skp');
    const ids = Object.fromEntries(['definition', 'source', 'peer', 'group', 'fixed'].map(key => [key, `${run}-${key}`]));
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 500 / 25.4, 400 / 25.4, 20 / 25.4, 1];
    const rows = ['source', 'peer', 'group', 'fixed'].map((key, i) => ({ entity_path: `pid:${i + 1}`, parent_entity_path: null, persistent_id: String(i + 1),
      reference: ids[key], name: ids[key], entity_type: i < 2 ? 'component_instance' : 'group', entity_definition_name: ids.definition,
      world_transform: [...matrix], bounding_box: { min: [500, 400, 20], max: [600, 450, 50] } }));
    const fixture = { kind: 'adopt_open_model', runtime: 'queue', document_id: 'fixture-document', model_revision: `sha256:${'a'.repeat(64)}`, model_revision_complete: true,
      model_revision_total_seen: 4, model_revision_indexed: 4, recursive_truncated: false, recursive_index: rows };
    const rejectedTask = 'task_11111111-1111-4111-8111-111111111111';
    const files = { 'run-started': { run_id: run }, result: { ok: false, run_id: run, tasks: [], completed_checks: [] },
      'model-info-before': { source_path: fixturePath }, '00-before-fixture': { ...fixture, recursive_index: [], model_revision_total_seen: 0, model_revision_indexed: 0 }, '01-fixture': fixture,
      'fixture-native-identities': { ids, source: 'pid:1', peer: 'pid:2', group: 'pid:3', fixed: 'pid:4' },
      '02-component-array-prepare-response': { ok: false, task_id: rejectedTask, task_state: 'awaiting_input', error: { code: 'POLICY_DENIED', details: { field: 'max_affected_instances' } } } };
    for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value));
    let checkpoint = fixture;
    if (stage === 'after-align') {
      const array = structuredClone(fixture);
      for (const index of [1, 2]) {
        const copy = structuredClone(rows[0]);
        Object.assign(copy, { entity_path: `pid:${4 + index}`, persistent_id: String(4 + index), reference: `copy-${index}`, name: `copy-${index}` });
        copy.world_transform[12] += index * 250 / 25.4;
        for (const edge of ['min', 'max']) copy.bounding_box[edge][0] += index * 250;
        array.recursive_index.push(copy);
      }
      Object.assign(array, { model_revision: `sha256:${'d'.repeat(64)}`, model_revision_total_seen: 6, model_revision_indexed: 6 });
      const align = structuredClone(array);
      align.model_revision = `sha256:${'e'.repeat(64)}`;
      align.recursive_index[0].world_transform[13] -= 25 / 25.4;
      for (const edge of ['min', 'max']) align.recursive_index[0].bounding_box[edge][1] -= 25;
      checkpoint = align;
      const tasks = [{ name: '02-component-array', task_id: rejectedTask }, { name: '03-component-align', task_id: 'task_22222222-2222-4222-8222-222222222222' }];
      const completed_checks = tasks.map((task, i) => ({ ...task, replay_no_mutation: true, native_revision: i ? align.model_revision : array.model_revision }));
      const prior = path.join(evidence, 'resume-before-layout');
      await fs.mkdir(prior);
      const priorFiles = { result: { ok: false, run_id: run, tasks, completed_checks }, '02-component-array-before': fixture,
        '02-component-array-after-replay': array, '03-component-align-before': array, '03-component-align-after-replay': align,
        '04-align-then-mirror-prepare-response': { ok: false, task_id: rejectedTask, task_state: 'awaiting_input', error: { code: 'OPERATION_NOT_ALLOWED' } } };
      for (const [name, value] of Object.entries(priorFiles)) await fs.writeFile(path.join(prior, `${name}.json`), JSON.stringify(value));
    }
    let submissions = 0;
    const fake = { executionPolicy: { allow_queue_mutation: true, allow_direct_expert_queue_mutation: true,
      development_model_auto_approval: { enabled: true, allowed_roots: [out], max_affected_instances: 40 }, resource_limits: { max_operations: 100, max_affected_instances: 40, max_recursive_entities: 20000 } },
      get_capabilities: async () => ({}), get_model_info: async () => ({ source_path: fixturePath }),
      adopt_open_model: async () => ({ ...checkpoint, ...(changed ? { model_revision: `sha256:${'c'.repeat(64)}` } : {}) }),
      withFreshQueueMutationAuthorization: async () => { throw new Error('Fixture recreation is forbidden'); },
      start_agent_task: async () => { throw new Error('A replacement task is forbidden before budget repair'); },
      submit_agent_task_input: async args => { submissions++; assert.equal(args.task_id, rejectedTask); assert.deepEqual(args.input.budgets, { max_operations: 100, max_affected_instances: 40, recursive_limit: 5000 });
        return { ok: false, error: { code: 'OFFLINE_STOP', message: 'Stop after observing the correct recovery request; no native call occurred.' } }; } };
    const result = await runLayoutNativeQA({ bridge: fake, outputDir: out, resumeRunId: run, resumeStage: stage });
    assert.equal(result.ok, false);
    assert.equal(submissions, changed ? 0 : 1, JSON.stringify(result));
    assert.match(result.error.message, changed ? /Fixture revision changed/ : /OFFLINE_STOP/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(evidence, '01-fixture.json'), 'utf8')), fixture, 'Original fixture evidence is immutable');
  }
  console.log('Offline layout QA passed: missing authorization rejects every mutation mode before output/queue access; same-task recovery and revision guards pass without native writes.');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
