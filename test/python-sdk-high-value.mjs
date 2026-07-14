import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { compilePythonSdkScript, PythonSdkCompileError } from '../src/python-sdk-compiler.mjs';

const repoRoot = process.cwd();
const source = await fs.readFile('examples/python-sdk-high-value-api-fixture.py', 'utf8');
const compiled = compilePythonSdkScript(source);

assert.equal(compiled.document.operations.length, 8);
assert.deepEqual(compiled.result.front_uvq, [1, 1, 1]);
assert.equal(compiled.result.transformed_count, 1);
assert.equal(compiled.result.deleted_count, 1);
assert.equal(compiled.result.page_update_flags, 17);
assert.ok(compiled.python_sdk.facade_objects.includes('UVHelper'));
assert.ok(compiled.document.operations.some((operation) => operation.op === 'transform_object' && operation.target_id === 'sdk-high-value-moving-box'));
assert.ok(compiled.document.operations.some((operation) => operation.op === 'delete' && operation.target_id === 'sdk-high-value-deleted-box'));
assert.equal(compiled.document.operations.find((operation) => operation.op === 'scene').update_flags, 17);

const sessionPath = path.join(repoRoot, 'output', 'python-sdk-high-value', 'mock-session.json');
const bridge = new SketchUpBridge({ mock: { sessionPath } });
const evaluated = await bridge.evaluate_py({ code: source, input_format: 'python_sdk', runtime: 'mock' });
const moving = evaluated.snapshot.groups.find((group) => group.id === 'sdk-high-value-moving-box');
assert.ok(moving, 'transformed box must remain in the snapshot');
assert.equal(moving.bounding_box.min[0], 50.8, 'collection transform must convert authored inches to millimeters');
assert.equal(evaluated.snapshot.groups.some((group) => group.id === 'sdk-high-value-deleted-box'), false, 'collection erase must remove the target');
assert.equal(evaluated.snapshot.scenes[0].update_flags, 17);

assert.throws(
  () => compilePythonSdkScript('model.reset()\nface = model.entities.add_face([[0,0,0],[1,0,0],[1,1,0]])\nhelper = face.get_UVHelper(True, False)\nresult = helper.get_front_UVQ([0,0,0])\n'),
  (error) => error instanceof PythonSdkCompileError && /positioned material side authored on the same Face/.test(error.message),
  'UVHelper must reject active/dynamic or unmapped UV queries'
);

process.stdout.write(`${JSON.stringify({ ok: true, operations: compiled.document.operations.length, groups: evaluated.snapshot.totals.groups, warnings: evaluated.snapshot.warning_summary.total }, null, 2)}\n`);
