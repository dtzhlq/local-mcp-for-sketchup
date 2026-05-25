import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileExpertScript } from '../src/expert-compiler.mjs';
import { SketchUpBridge } from '../src/bridge.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleSource = await fs.readFile(path.join(repoRoot, 'examples/expert-parametric-fixture.js'), 'utf8');

const compiled = compileExpertScript(exampleSource, { seed: 7 });
assert.equal(compiled.document.version, 1);
assert.equal(compiled.document.units, 'mm');
assert.equal(compiled.expert.compiler_version, 'expert-compiler-0.1.0');
assert.equal(compiled.expert.operations, 19);
assert.equal(compiled.document.operations.filter((operation) => operation.op === 'component_instance').length, 12);
assert.ok(compiled.code.includes('"Expert_Parametric_Label"'));

const firstInstance = compiled.document.operations.find((operation) => operation.name === 'Expert_Peg_0_0');
assert.ok(firstInstance);
assert.deepEqual(firstInstance.origin, [30, 35, 0]);
assert.ok(Math.abs(firstInstance.transform.translate[0] - -0.5224383203312755) < 1e-12);
assert.ok(Math.abs(firstInstance.transform.translate[1] - 0.8269865293987095) < 1e-12);

const helperSource = `
const indexes = range(6).filter((index) => index % 2 === 0).flatMap((index) => [index, index + 1]);
const total = indexes.reduce((sum, value) => sum + value, 0);
const axis = vec.norm(vec.cross([1, 0, 0], [0, 1, 0]));
const span = vec.distance([0, 0, 0], [3, 4, 12]);
const angle = deg(Math.atan2(1, 1));
[
  {
    op: "box",
    name: \`Expert_Helper_\${indexes.length}_\${total}\`,
    origin: vec.add([0, 0, 0], vec.scale(axis, 5)),
    size: [lerp(10, 20, 0.5), clamp(span * 2, 1, 20), rad(angle * 4) / Math.PI]
  }
];
`;
const helperCompiled = compileExpertScript(helperSource, { seed: 7 });
assert.equal(helperCompiled.document.operations.length, 1);
assert.equal(helperCompiled.document.operations[0].name, 'Expert_Helper_6_15');
assert.deepEqual(helperCompiled.document.operations[0].origin, [0, 0, 5]);
assert.deepEqual(helperCompiled.document.operations[0].size, [15, 20, 1]);

const bridge = new SketchUpBridge();
const built = await bridge.build_expert_model({ code: exampleSource, runtime: 'mock', seed: 7 });
assert.equal(built.compiled.expert.operations, 19);
assert.equal(built.snapshot.totals.instances, 12);
assert.equal(built.snapshot.totals.groups, 2);
assert.equal(built.snapshot.warnings.length, 0);
assert.ok(built.snapshot.groups.some((group) => group.kind === 'text_3d' && group.name === 'Expert_Parametric_Label'));

assertRejectsExpert('require("fs"); []', /Unknown identifier: require/);
assertRejectsExpert('const ops = []; for (let i = 0; i < 4; i += 1) { ops.push({ op: "reset" }); } ops;', /loop limit exceeded/, { maxLoopIterations: 2 });
assertRejectsExpert('const ops = []; for (let i = 0; i < 4; i += 1) { ops.push({ op: "reset" }); } ops;', /operation limit exceeded/, { maxOperations: 2 });
assertRejectsExpert('const ops = [{ op: "box" }]; ops;', /missing required field: name/);
assertRejectsExpert('const ops = [{ op: "scene", name: "Bad", camera: {} }]; dsl([{ op: "component_definition", name: "Bad_Def", operations: ops }]);', /not supported inside component_definition: scene/);
assertRejectsExpert('while (true) {}', /Unsupported statement syntax: WhileStatement/);
assertRejectsExpert('vec.norm([0, 0, 0]); []', /non-zero vector/);

console.log(JSON.stringify({
  ok: true,
  operations: compiled.expert.operations,
  instances: built.snapshot.totals.instances,
  groups: built.snapshot.totals.groups
}, null, 2));

function assertRejectsExpert(source, pattern, options = {}) {
  assert.throws(() => compileExpertScript(source, options), pattern);
}
