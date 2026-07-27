import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getComponentDefinitionOperationNames,
  getOperationManifest,
  getOperationNames,
  getRuntimeCapabilities,
  OPERATION_REGISTRY,
  SUPPORT_STATUS
} from '../src/capabilities.mjs';

const repoRoot = path.resolve('.');
const manifest = getOperationManifest();
const manifestOperations = new Set(getOperationNames());
const componentDefinitionOperations = new Set(getComponentDefinitionOperationNames());
const capabilityByOperation = new Map(manifest.map((capability) => [capability.op, capability]));
const targetOperations = new Set([
  'delete', 'rename', 'set_material', 'set_visibility', 'transform_object', 'assign_tag', 'attribute', 'classification', 'texture_transform', 'uv_project_planar', 'uv_project_box',
  'face_uv',
  'cut_hole', 'cut_slot', 'cut_recess', 'add_boss', 'add_raised_rib',
  'boolean_union', 'boolean_difference', 'boolean_intersect', 'manifold_check', 'manifold_repair'
]);
const identityOperations = new Set([
  'box', 'rounded_box', 'beveled_panel', 'fillet', 'chamfer', 'recess', 'engraved_line',
  'text_emboss', 'text_engrave', 'text_3d', 'slot', 'slot_array', 'rib', 'standoff_boss',
  'button_on_panel', 'image_plane', 'prism', 'panel_with_openings', 'boolean_cutout', 'face_with_holes',
  'profile_extrude', 'mesh', 'geometry_input', 'curve', 'arc_curve', 'gable_roof', 'shed_roof',
  'cylinder', 'loft_between_profiles', 'shell_from_front_side_profiles', 'lofted_solid',
  'face_on_cylinder', 'analog_stick', 'screw_hole', 'pipe_between_points', 'swept_path',
  'domed_surface', 'bowed_panel', 'floor_slab', 'footprint_slab', 'wall', 'wall_path',
  'curved_wall', 'roof_footprint', 'hip_roof', 'parapet_path', 'curtain_wall', 'column_grid',
  'path_surface', 'terrain_mesh', 'parking_stall_array', 'door', 'window', 'component_instance'
]);

const mockRuntimeSource = await fs.readFile(path.join(repoRoot, 'src/mock-runtime.mjs'), 'utf8');
const componentOperationsSource = await fs.readFile(path.join(repoRoot, 'src/component-operations.mjs'), 'utf8');
const rubyPluginSource = await fs.readFile(path.join(repoRoot, 'sketchup_plugin/local_mcp_for_sketchup/bridge.rb'), 'utf8');
const rubyComponentSource = await fs.readFile(path.join(repoRoot, 'sketchup_plugin/local_mcp_for_sketchup/component_operations.rb'), 'utf8');
const packagePluginSource = await fs.readFile(path.join(repoRoot, 'scripts/package-sketchup-plugin.mjs'), 'utf8');

assert.deepEqual(
  sorted(new Set(Object.keys(OPERATION_REGISTRY))),
  sorted(manifestOperations),
  'operation registry keys should match exported operation names'
);
assert.deepEqual(
  sorted(new Set(manifest.map((capability) => capability.op))),
  sorted(manifestOperations),
  'manifest operation names should be unique and match getOperationNames'
);
for (const capability of manifest) {
  assert.ok(capability.schema, `${capability.op} should declare schema`);
  assert.ok(Array.isArray(capability.schema.required), `${capability.op} schema.required should be an array`);
  assert.ok(Array.isArray(capability.schema.optional), `${capability.op} schema.optional should be an array`);
  assert.equal(capability.component_definition, undefined, `${capability.op} should expose component_scope, not raw registry markers`);
  assert.ok(
    [SUPPORT_STATUS.supported, SUPPORT_STATUS.unsupported].includes(capability.component_scope?.status),
    `${capability.op} should declare component_scope status`
  );
  assert.equal(typeof capability.description, 'string', `${capability.op} should declare description`);
  assert.equal(typeof capability.notes, 'string', `${capability.op} should declare notes`);
}

const mockBuildOperations = extractCases(
  mockRuntimeSource,
  'async buildModel(code)',
  'await this.writeModel(model);'
);
assertSetEquals(mockBuildOperations, manifestOperations, 'mock runtime buildModel dispatch');

const rubyBuildOperations = extractWhens(
  rubyPluginSource,
  'def apply_operation(model, operation)',
  'def object_reference(operation, op_name)'
);
assertSetEquals(rubyBuildOperations, manifestOperations, 'Ruby queue apply_operation dispatch');

const jsComponentOperations = extractCases(
  componentOperationsSource,
  'function applyComponentDefinitionOperation(model, operation, componentName)',
  'export function addComponentInstance(model, operation)'
);
const rubyComponentOperations = extractWhens(
  rubyComponentSource,
  'def apply_component_definition_operation(entities, operation, component_name)',
  'def add_component_instance(model, operation)'
);

assert.deepEqual(
  sorted(jsComponentOperations),
  sorted(rubyComponentOperations),
  'JS and Ruby component_definition operation dispatch should stay in parity'
);
assert.deepEqual(
  sorted(jsComponentOperations),
  sorted(componentDefinitionOperations),
  'component_definition dispatch should be defined by the operation registry'
);
for (const operation of jsComponentOperations) {
  assert.ok(manifestOperations.has(operation), `component_definition dispatch op should exist in manifest: ${operation}`);
}

for (const operation of targetOperations) {
  assertOptionalFields(operation, ['target_id', 'targetId', 'target', 'object']);
}
for (const operation of identityOperations) {
  assertOptionalFields(operation, ['id', 'object_id', 'objectId', 'guid']);
}

for (const requirePath of extractRequireRelativePaths(rubyPluginSource)) {
  const sourcePath = `sketchup_plugin/${requirePath}.rb`;
  assert.ok(
    packagePluginSource.includes(sourcePath),
    `package script should include required Ruby module: ${sourcePath}`
  );
}

for (const runtime of ['mock', 'queue']) {
  const runtimeCapabilities = getRuntimeCapabilities(runtime);
  const expectedRuntimeOperations = new Set(
    manifest
      .filter((capability) => capability.runtime_support[runtime] !== undefined && capability.runtime_support[runtime] !== SUPPORT_STATUS.unsupported)
      .map((capability) => capability.op)
  );
  assert.deepEqual(
    sorted(new Set(runtimeCapabilities.supported_operations)),
    sorted(expectedRuntimeOperations),
    `${runtime} supported_operations should be derived from registry runtime_support`
  );
  for (const operation of expectedRuntimeOperations) {
    const support = runtimeCapabilities.operation_support[operation];
    const capability = capabilityByOperation.get(operation);
    assert.ok(support, `${runtime} runtime descriptor should include operation_support.${operation}`);
    assert.equal(support.status, capability.runtime_support[runtime], `${runtime} operation_support.${operation}.status should mirror registry`);
    assert.equal(support.stability, capability.stability, `${runtime} operation_support.${operation}.stability should mirror registry`);
    assert.deepEqual(support.schema, capability.schema, `${runtime} operation_support.${operation}.schema should mirror registry`);
    assert.deepEqual(support.component_scope, capability.component_scope, `${runtime} operation_support.${operation}.component_scope should mirror registry`);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  manifest_operations: manifestOperations.size,
  mock_dispatch_operations: mockBuildOperations.size,
  ruby_dispatch_operations: rubyBuildOperations.size,
  component_dispatch_operations: jsComponentOperations.size,
  registry_component_operations: componentDefinitionOperations.size
}, null, 2)}\n`);

function extractCases(source, startMarker, endMarker) {
  return extractOperationNames(source, startMarker, endMarker, /case '([^']+)'/g);
}

function extractWhens(source, startMarker, endMarker) {
  return extractOperationNames(source, startMarker, endMarker, /when '([^']+)'/g);
}

function extractOperationNames(source, startMarker, endMarker, pattern) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `end marker not found after ${startMarker}: ${endMarker}`);
  const slice = source.slice(start, end);
  const names = new Set();
  for (const match of slice.matchAll(pattern)) names.add(match[1]);
  return names;
}

function extractRequireRelativePaths(source) {
  return [...source.matchAll(/require_relative '([^']+)'/g)].map((match) => match[1]);
}

function assertSetEquals(actual, expected, label) {
  assert.deepEqual(sorted(actual), sorted(expected), `${label} should match manifest operations`);
}

function assertOptionalFields(operation, fields) {
  const capability = capabilityByOperation.get(operation);
  assert.ok(capability, `manifest operation should exist: ${operation}`);
  const optional = new Set(capability.schema.optional || []);
  const missing = fields.filter((field) => !optional.has(field));
  assert.deepEqual(missing, [], `${operation} manifest optional fields should include ${fields.join(', ')}`);
}

function sorted(set) {
  return [...set].sort();
}
