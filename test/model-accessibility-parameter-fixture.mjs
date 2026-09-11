import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareFixture, writePreparedFixture } from '../scripts/model-accessibility/fixtures.mjs';
import { planParameterFixture, materializeParameterFixture } from '../scripts/model-accessibility/materialize-parameter-fixture.mjs';
import { objectHash } from '../scripts/model-accessibility/benchmark.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'parameter-fixture-script-'));
let checks = 0;
const check = fn => { fn(); checks++; };
try {
  const prepared = await prepareFixture({ caseId: 'edit_linked.development' });
  const plan = await planParameterFixture(prepared);
  check(() => assert.deepEqual(plan.sources.map(source => source.root_ids), [['D'], ['A','B','C']]));
  check(() => assert.deepEqual(plan.sources.map(source => source.matched_recipe_parts), [30,30]));
  check(() => assert.notEqual(plan.sources[0].task.id, plan.sources[1].task.id));
  check(() => assert.equal(plan.sources[1].task.parameters.width_mm, 600, 'The source retains original width, not the requested edited width.'));
  check(() => assert.deepEqual(plan.sentinel.dsl.operations.map(op => op.op), ['material','component_definition','component_instance','attribute']));
  check(() => assert.equal(plan.metadata[0].attributes.authored_before_test, true));
  const altered = structuredClone(prepared); altered.dsl.operations.push({ op: 'delete', target_id: 'A' });
  altered.manifest.dsl_sha256 = objectHash(altered.dsl);
  await assert.rejects(() => planParameterFixture(altered), /fixed fixture definition/); checks++;
  const preparedDir = path.join(root, 'prepared'); await writePreparedFixture({ caseId: 'edit_linked.development', outputDir: preparedDir });
  let bridgeCalls = 0;
  const dry = await materializeParameterFixture({ preparedDir, outputDir: path.join(root, 'dry') }, { createBridge: () => { bridgeCalls++; throw new Error('Dry run must never instantiate a runtime.'); } });
  check(() => assert.equal(dry.dry_run, true));
  check(() => assert.equal(dry.fixture_ready, false));
  check(() => assert.equal(bridgeCalls, 0));
  await assert.rejects(() => materializeParameterFixture({ preparedDir, outputDir: path.join(root, 'dry') }), /EEXIST/); checks++;
  const started = [];
  await assert.rejects(() => materializeParameterFixture({ preparedDir, outputDir: path.join(root, 'old-native'), executeHost: true }, {
    createBridge: () => ({ get_capabilities: async () => { started.push('capabilities'); return { runtime: { creation_scope: {} } }; },
      adopt_open_model: () => { started.push('adopt'); throw new Error('An old plugin must stop before geometry reads/mutations.'); } })
  }), /Install\/restart/); checks++;
  check(() => assert.deepEqual(started, ['capabilities']));
  console.log(JSON.stringify({ checks, fixed_recipe_parts_verified: 60, dry_run_runtime_calls: 0,
    old_plugin_stopped_before_mutation: true, native_runtime_called: false, formal_acceptance: false }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
