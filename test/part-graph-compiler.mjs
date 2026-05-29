import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SketchUpBridge } from '../src/bridge.mjs';
import { compilePartGraphFiles } from '../src/product-modeling/part-graph-compiler.mjs';

const repoRoot = process.cwd();
const profilePath = 'examples/product-profiles/vehicle_ambulance.json';
const partGraphPath = 'examples/part-graphs/ambulance-reference.part-graph.json';
const outputPath = 'examples/acceptance-ambulance-reference.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const productProfileSchema = JSON.parse(await fs.readFile('schema/product-profile.schema.json', 'utf8'));
const partGraphSchema = JSON.parse(await fs.readFile('schema/part-graph.schema.json', 'utf8'));
const validateProfile = ajv.compile(productProfileSchema);
const validatePartGraph = ajv.compile(partGraphSchema);

const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
const partGraph = JSON.parse(await fs.readFile(partGraphPath, 'utf8'));
assertValid(validateProfile, profile, profilePath);
assertValid(validatePartGraph, partGraph, partGraphPath);

const document = await compilePartGraphFiles({ profilePath, partGraphPath, repoRoot });
assert.equal(document.version, 1);
assert.equal(document.units, 'mm');
assert.equal(document.metadata.source, 'part_graph_compiler');
assert.equal(document.metadata.profile_id, 'vehicle_ambulance');
assert.equal(document.operations.length, 104);
assert.equal(document.operations.filter((operation) => operation.op === 'cut_recess').length, 7);
assert.equal(document.operations.filter((operation) => operation.op === 'add_boss').length, 3);
assert.equal(document.operations.filter((operation) => operation.op === 'add_raised_rib').length, 3);
assert.ok(document.operations.some((operation) => operation.op === 'boolean_difference'), 'compiled DSL should keep the roof panel boolean');

const generated = JSON.parse(await fs.readFile(outputPath, 'utf8'));
assert.deepEqual(generated, document, 'acceptance ambulance JSON should be generated from the part graph compiler');

const mainBodyOp = operationById(document, 'amb-main-body');
assert.equal(mainBodyOp.qa.part_id, 'amb-main-body');
assert.equal(mainBodyOp.qa.role, 'body');
assert.equal(mainBodyOp.qa.fallback_state, 'real_feature_op');
assert.ok(mainBodyOp.qa.feature_intents.some((feature) => feature.operation === 'cut_recess'));

const stripeOp = operationById(document, 'amb-left-red-stripe');
assert.equal(stripeOp.qa.part_id, 'amb-left-red-stripe');
assert.equal(stripeOp.qa.fallback_state, 'visual_helper');

const referenceOp = operationById(document, 'ambulance-side-reference');
assert.equal(referenceOp.qa.role, 'reference_image');
assert.equal(path.isAbsolute(referenceOp.image), true, 'reference image paths should resolve to absolute paths for queue runtime');

const mockSessionPath = path.join(repoRoot, 'output', 'product-modeling', 'sessions', 'part-graph-compiler-mock.json');
await fs.mkdir(path.dirname(mockSessionPath), { recursive: true });
const bridge = new SketchUpBridge({ mock: { sessionPath: mockSessionPath } });
const build = await bridge.build_model({ runtime: 'mock', code: JSON.stringify(document) });
assert.equal(build.snapshot.totals.groups, 57, 'compiled ambulance should keep current group count');
assert.equal(build.snapshot.scenes.length, 2, 'compiled ambulance should keep review scenes');
assert.equal(build.snapshot.warning_summary.by_severity.error, 0);

const mainBodySnapshot = snapshotGroupById(build.snapshot, 'amb-main-body');
assert.equal(mainBodySnapshot.qa.part_id, 'amb-main-body');
assert.equal(mainBodySnapshot.qa.evidence_status, 'manual_confirmed');
assert.equal(mainBodySnapshot.features.length, 10, 'main body should carry feature intent metadata after feature ops');

const stripeSnapshot = snapshotGroupById(build.snapshot, 'amb-left-red-stripe');
assert.equal(stripeSnapshot.qa.part_id, 'amb-left-red-stripe', 'box primitive should preserve part graph QA metadata');

const tireSnapshot = snapshotGroupById(build.snapshot, 'wheel-left-front-tire');
assert.equal(tireSnapshot.qa.part_id, 'wheel-left-front-tire', 'prism primitive should preserve part graph QA metadata');

const spec = JSON.parse(await fs.readFile('examples/model-qa/ambulance-reference.json', 'utf8'));
const layoutReport = await bridge.validate_model({
  code: JSON.stringify(document),
  runtime: 'mock',
  spec,
  includePreview: false
});
assert.equal(layoutReport.ok, true);
assert.equal(layoutReport.verdict, 'pass');
assert.equal(layoutReport.summary.total, 0);

function assertValid(validate, value, label) {
  if (!validate(value)) {
    const errors = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('\n') || 'unknown schema error';
    throw new Error(`${label} failed schema validation:\n${errors}`);
  }
}

function operationById(document, id) {
  const operation = document.operations.find((item) => item.id === id);
  assert.ok(operation, `expected compiled operation with id ${id}`);
  return operation;
}

function snapshotGroupById(snapshot, id) {
  const group = snapshot.groups.find((item) => item.id === id);
  assert.ok(group, `expected snapshot group with id ${id}`);
  return group;
}
