import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MockRuntime } from '../src/mock-runtime.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sketchup-root-import-'));
const source = new MockRuntime({ sessionPath: path.join(temporary, 'source-session.json') });
const destination = new MockRuntime({ sessionPath: path.join(temporary, 'destination-session.json') });
const defaults = operation => ({ ...(operation.op === 'box' ? { origin: [0, 0, 0] } : {}), ...operation, ...(operation.operations ? { operations: operation.operations.map(defaults) } : {}) });
const build = (runtime, operations) => runtime.buildModel(JSON.stringify({ version: 1, units: 'mm', operations: operations.map(defaults) }));
await build(source, [
  { op: 'material', name: 'Wood', color: '#bb4422' },
  { op: 'tag', name: 'Finish', visible: false },
  { op: 'component_definition', name: 'Panel', operations: [{ op: 'box', id: 'shared-part', name: 'Shared Panel', size: [100, 20, 200], material: 'Wood' }] },
  { op: 'component_definition', name: 'Assembly', operations: [
    { op: 'component_instance', id: 'nested-one', name: 'Nested One', definition: 'Panel' },
    { op: 'component_instance', id: 'nested-two', name: 'Nested Two', definition: 'Panel', origin: [180, 0, 0] }
  ] },
  { op: 'box', id: 'top-part', name: 'Top Part', origin: [0, 0, -20], size: [280, 20, 20], material: 'Wood' },
  { op: 'component_instance', id: 'assembly-instance', name: 'Assembly Instance', definition: 'Assembly', origin: [200, 500, 0] }
]);
const sourceModel = await source.readModel();
sourceModel.component_definitions.Panel.groups[0].tag = 'Finish';
sourceModel.component_definitions.Panel.groups[0].face_uvs = [{ material: 'Wood', image_reference: 'BoardImage', uv: [[0, 0], [1, 1]] }];
sourceModel.component_definitions.Panel.groups[0].attributes = { description: 'Wood' };
sourceModel.image_references.BoardImage = { name: 'BoardImage', path: '/source/board.png' };
const artifact = path.join(temporary, 'asset.json');
await fs.writeFile(artifact, JSON.stringify({ model: sourceModel }), { flag: 'wx' });
const artifactBefore = await fs.readFile(artifact, 'utf8');
await build(destination, [
  { op: 'material', name: 'Wood', color: '#2233aa' },
  { op: 'tag', name: 'Finish', visible: true },
  { op: 'component_definition', name: 'Panel', operations: [{ op: 'box', id: 'shared-part', name: 'Shared Panel', size: [9, 9, 9], material: 'Wood' }] },
  { op: 'component_definition', name: 'Assembly', size: [5, 5, 5] },
  { op: 'component_definition', name: 'asset_Root', size: [7, 7, 7] },
  { op: 'box', id: 'top-part', name: 'Top Part', size: [10, 10, 10], material: 'Wood' },
  { op: 'component_instance', id: 'requested-root', name: 'Existing Instance', definition: 'Panel' }
]);
const prior = await destination.readModel();
prior.image_references.BoardImage = { name: 'BoardImage', path: '/existing/board.png' };
await destination.writeModel(prior);
const imported = await destination.importModel({ path: artifact, options: { preserve_root: true, id: 'requested-root' } });
assert.equal(imported.import.root_preserved, true);
assert.equal(imported.import.native_geometry_verified, false);
const first = await destination.readModel();
assert.deepEqual(first.groups, prior.groups, 'An intact root import must not append exploded top-level groups');
assert.deepEqual(first.instances.slice(0, prior.instances.length), prior.instances);
for (const collection of ['materials', 'tags', 'image_references', 'component_definitions']) {
  for (const [name, original] of Object.entries(prior[collection])) assert.deepEqual(first[collection][name], original, `Existing ${collection}.${name} must remain intact`);
}
const maps = imported.import.identity_map;
assert.notEqual(maps.materials.Wood, 'Wood');
assert.notEqual(maps.definitions.Panel, 'Panel');
assert.notEqual(maps.definitions.Assembly, 'Assembly');
assert.notEqual(imported.import.instance_id, 'requested-root');
const root = first.component_definitions[imported.import.definition];
assert.equal(root.groups.length, 1);
assert.equal(root.instances.length, 1);
assert.equal(root.faces, 18);
assert.equal(root.instances[0].definition, maps.definitions.Assembly);
assert.deepEqual(root.bounding_box, { min: [0, 0, -20], max: [480, 520, 200], w: 480, d: 520, h: 220 });
const assembly = first.component_definitions[maps.definitions.Assembly];
assert.equal(assembly.instances.length, 2);
assert.ok(assembly.instances.every(instance => instance.definition === maps.definitions.Panel), 'Both nested instances must reuse the imported definition');
const panel = first.component_definitions[maps.definitions.Panel].groups[0];
assert.equal(panel.bounding_box.w, 100, 'A collision must never bind an imported instance to the existing 9 mm component');
assert.equal(panel.material, maps.materials.Wood);
assert.equal(panel.tag, maps.tags.Finish);
assert.equal(panel.face_uvs[0].material, maps.materials.Wood);
assert.equal(panel.face_uvs[0].image_reference, maps.image_references.BoardImage);
assert.equal(panel.attributes.description, 'Wood', 'Free-form attributes must not be rewritten as resource references');
assert.equal(first.materials[panel.material].color, '#bb4422');
assert.notEqual(panel.id, 'shared-part');

const secondResult = await destination.importModel({ path: artifact, options: { preserve_root: true } });
const second = await destination.readModel();
assert.notEqual(secondResult.import.definition, imported.import.definition);
assert.notEqual(secondResult.import.instance_id, imported.import.instance_id);
for (const [name, definition] of Object.entries(first.component_definitions)) assert.deepEqual(second.component_definitions[name], definition);
assert.deepEqual(second.instances.slice(0, first.instances.length), first.instances);
assert.equal(second.groups.length, prior.groups.length);
assert.equal(await fs.readFile(artifact, 'utf8'), artifactBefore);

const invalidPath = path.join(temporary, 'missing-definition.json');
const invalid = structuredClone(sourceModel);
invalid.component_definitions.Assembly.instances[0].definition = 'Missing';
await fs.writeFile(invalidPath, JSON.stringify(invalid), { flag: 'wx' });
const beforeFailure = await fs.readFile(destination.sessionPath, 'utf8');
await assert.rejects(() => destination.importModel({ path: invalidPath, options: { preserve_root: true } }), /definition not found in asset/);
assert.equal(await fs.readFile(destination.sessionPath, 'utf8'), beforeFailure, 'A failed remap must preserve the complete destination model');
invalid.component_definitions.Assembly.instances[0].definition = 'Assembly';
const cyclePath = path.join(temporary, 'cycle.json');
await fs.writeFile(cyclePath, JSON.stringify(invalid), { flag: 'wx' });
await assert.rejects(() => destination.importModel({ path: cyclePath, options: { preserve_root: true } }), /contain a cycle/);
assert.equal(await fs.readFile(destination.sessionPath, 'utf8'), beforeFailure);

const legacy = new MockRuntime({ sessionPath: path.join(temporary, 'legacy-session.json') });
await legacy.importModel({ path: artifact });
assert.equal((await legacy.readModel()).groups.length, 1, 'Legacy append still explodes the top-level model');
console.log('import-preserve-root: nested reuse, collision remapping, materials/tags/UV references, repeated import, rollback, source preservation and legacy append passed in isolated mock sessions; no live SKP geometry claim');
