import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getOperationNames } from '../src/capabilities.mjs';

const repoRoot = path.resolve('.');
const manifestOperations = new Set(getOperationNames());

const mockRuntimeSource = await fs.readFile(path.join(repoRoot, 'src/mock-runtime.mjs'), 'utf8');
const geometrySource = await fs.readFile(path.join(repoRoot, 'src/geometry.mjs'), 'utf8');
const rubyPluginSource = await fs.readFile(path.join(repoRoot, 'sketchup_plugin/alma_sketchup_mcp.rb'), 'utf8');

const mockBuildOperations = extractCases(
  mockRuntimeSource,
  'async buildModel(code)',
  'await this.writeModel(model);'
);
assertSetIncludesAll(mockBuildOperations, manifestOperations, 'mock runtime buildModel dispatch');

const rubyBuildOperations = extractWhens(
  rubyPluginSource,
  'def apply_operation(model, operation)',
  'def delete_object(model, operation)'
);
assertSetIncludesAll(rubyBuildOperations, manifestOperations, 'Ruby queue apply_operation dispatch');

const jsComponentOperations = extractCases(
  geometrySource,
  'function applyComponentDefinitionOperation(model, operation, componentName)',
  'export function addComponentInstance(model, operation)'
);
const rubyComponentOperations = extractWhens(
  rubyPluginSource,
  'def apply_component_definition_operation(entities, operation, component_name)',
  'def add_component_instance(model, operation)'
);

assert.deepEqual(
  sorted(jsComponentOperations),
  sorted(rubyComponentOperations),
  'JS and Ruby component_definition operation dispatch should stay in parity'
);
for (const operation of jsComponentOperations) {
  assert.ok(manifestOperations.has(operation), `component_definition dispatch op should exist in manifest: ${operation}`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  manifest_operations: manifestOperations.size,
  mock_dispatch_operations: mockBuildOperations.size,
  ruby_dispatch_operations: rubyBuildOperations.size,
  component_dispatch_operations: jsComponentOperations.size
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

function assertSetIncludesAll(actual, expected, label) {
  const missing = [...expected].filter((operation) => !actual.has(operation));
  assert.deepEqual(missing, [], `${label} missing manifest operations`);
}

function sorted(set) {
  return [...set].sort();
}
