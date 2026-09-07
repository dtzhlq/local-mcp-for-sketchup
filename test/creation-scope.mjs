import assert from 'node:assert/strict';
import { prepareAgentGatewayCreationDsl, prepareTaskOwnedCreationDsl, validateCreationScopeAgainstModel, validateTaskOwnedCreationDocument } from '../src/agent-dsl-policy.mjs';
const taskId = 'task_00000000-0000-0000-0000-000000000001';
const code = operations => JSON.stringify({ version: 1, units: 'mm', operations });
const body = { op: 'box', id: 'panel', name: 'Panel', origin: [0, 0, 0], size: [100, 100, 10] };
const operations = [
  { op: 'material', name: 'NewMetal', color: '#888888' },
  { op: 'component_definition', name: 'Handle', operations: [{ ...body, material: 'NewMetal' }] },
  { op: 'component_instance', id: 'handle', name: 'Handle_1', definition: 'Handle', origin: [0, 0, 0] },
  { ...body, name: 'TopPanel' },
  { op: 'cut_recess', target_id: 'panel', face: 'top', center: [50, 50], size: [20, 20], depth: 2 }
];
assert.throws(() => prepareAgentGatewayCreationDsl(code(operations)), /additive/);
const prepared = prepareTaskOwnedCreationDsl(code(operations), { taskId });
validateCreationScopeAgainstModel(prepared.document, { materials: {}, component_definitions: {}, groups: [] });
assert.ok(prepared.identity_map.panel.startsWith(prepared.creation_scope.namespace));
assert.equal(prepared.document.operations.at(-1).target_id, prepared.identity_map.panel);
assert.throws(() => validateCreationScopeAgainstModel(prepared.document, { component_definitions: { [prepared.creation_scope.definitions[0]]: {} } }), /already exists/);
assert.throws(() => validateCreationScopeAgainstModel(prepared.document, { materials: { [prepared.creation_scope.materials[0]]: {} } }), /already exists/);
assert.throws(() => prepareTaskOwnedCreationDsl(code([...operations, { op: 'cut_recess', target_id: 'pid:987', face: 'top', center: [0, 0], size: [1, 1], depth: 1 }]), { taskId }), /cut target/);
assert.throws(() => prepareTaskOwnedCreationDsl(code([{ op: 'component_definition', name: 'Bad', operations: [{ ...body }, { op: 'cut_hole', target_id: 'panel', radius: 2 }] }]), { taskId }), /cut target/);
assert.throws(() => prepareTaskOwnedCreationDsl(code([{ op: 'component_definition', name: 'Cycle', operations: [{ op: 'component_instance', name: 'Self', definition: 'Cycle', origin: [0, 0, 0] }] }]), { taskId }), /earlier new definition/);
assert.throws(() => prepareTaskOwnedCreationDsl(code([{ ...body, material: { name: 'Existing', color: '#ff0000' } }]), { taskId }), /mutable material/);
assert.throws(() => prepareTaskOwnedCreationDsl(code([{ op: 'component_definition', name: 'Mutable', size: [10, 10, 10], material: { name: 'Existing', color: '#ff0000' } }]), { taskId }), /mutable material/);
const forged = structuredClone(prepared.document);
forged.operations.push({ op: 'delete', target_id: 'pid:555' });
assert.throws(() => validateTaskOwnedCreationDocument(forged), /unsupported operation/);
assert.notEqual(prepareTaskOwnedCreationDsl(code(operations), { taskId, iteration: 1 }).creation_scope.namespace, prepared.creation_scope.namespace);
for (const field of ['material', 'back_material', 'f_material', 'b_material']) {
  const reference = prepareTaskOwnedCreationDsl(code([{ ...body, [field]: 'ExistingSurface' }]), { taskId });
  assert.throws(() => validateCreationScopeAgainstModel(reference.document, { materials: {} }), /neither declared nor already present/);
  validateCreationScopeAgainstModel(reference.document, { materials: { ExistingSurface: {} } });
}
console.log('creation-scope: closure, resource collisions, nested cuts, cycles, forged mutation and iteration boundaries passed');
