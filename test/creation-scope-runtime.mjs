import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareTaskOwnedCreationDsl } from '../src/agent-dsl-policy.mjs';
const code = JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'material', name: 'Metal', color: '#888888' }, { op: 'box', id: 'panel', name: 'Panel', origin: [0,0,0], size: [100,100,10] }, { op: 'cut_recess', target_id: 'panel', face: 'top', center: [50,50], size: [20,20], depth: 2 }] });
const document = prepareTaskOwnedCreationDsl(code, { taskId: 'task_00000000-0000-0000-0000-000000000001' }).document;
const rubySource = `require ${JSON.stringify(fileURLToPath(new URL('../sketchup_plugin/alma_sketchup_mcp/creation_scope.rb', import.meta.url)))}
doc = JSON.parse(STDIN.read)
model = Struct.new(:materials, :definitions, :entities).new({}, {}, [])
AlmaSketchupMCP.validate_creation_scope!(model, doc)
failures = []
model.materials[doc['creation_scope']['materials'].first] = Object.new
begin; AlmaSketchupMCP.validate_creation_scope!(model,doc); rescue => e; failures << e.message; end
model.materials.clear
doc['operations'][1]['f_material'] = 'ImplicitlyCreated'
begin; AlmaSketchupMCP.validate_creation_scope!(model,doc); rescue => e; failures << e.message; end
model.materials['ImplicitlyCreated'] = Object.new
AlmaSketchupMCP.validate_creation_scope!(model,doc)
doc['operations'].last['target_id'] = 'pid:123'
begin; AlmaSketchupMCP.validate_creation_scope!(model,doc); rescue => e; failures << e.message; end
puts JSON.generate(failures)
`;
const result = spawnSync('ruby', ['-rjson', '-e', rubySource], { input: JSON.stringify(document), encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
const failures = JSON.parse(result.stdout);
assert.equal(failures.length, 3);
assert.match(failures[0], /fresh top-level resource/);
assert.match(failures[1], /neither declared nor already present/);
assert.match(failures[2], /earlier untransformed local Group/);
console.log('creation-scope-runtime: native guard rejects actual resource collision and forged existing target');
