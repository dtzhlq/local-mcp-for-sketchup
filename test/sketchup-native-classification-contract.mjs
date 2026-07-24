import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [mainSource, snapshotSource, geometrySource, revisionSource] = await Promise.all([
  fs.readFile('sketchup_plugin/alma_sketchup_mcp.rb', 'utf8'),
  fs.readFile('sketchup_plugin/alma_sketchup_mcp/snapshot.rb', 'utf8'),
  fs.readFile('sketchup_plugin/alma_sketchup_mcp/geometry_operations.rb', 'utf8'),
  fs.readFile('sketchup_plugin/alma_sketchup_mcp/model_revision.rb', 'utf8')
]);

const catalog = methodBody(geometrySource, 'classification_schema_catalog', 'def native_definition_classification_summary');
const summary = methodBody(geometrySource, 'native_definition_classification_summary', 'def definition_attribute_fingerprint_payload');
const fingerprint = methodBody(geometrySource, 'definition_attribute_fingerprint_payload', 'def canonical_attribute_fingerprint_value');
const adoption = methodBody(mainSource, 'adoption_result', 'def get_selection');
const occurrence = methodBody(mainSource, 'occurrence_entity_snapshot', 'def occurrence_path_segments');
const revision = methodBody(revisionSource, 'session_model_revision_report', 'def model_revision_merkle_graph');
const filtered = methodBody(mainSource, 'filtered_entity_snapshots', 'def adoptable_entities');
const snapshot = methodBody(snapshotSource, 'snapshot', 'def selection_snapshot');

assert.match(catalog, /model\.classifications\.each/);
assert.match(catalog, /schema\.name/);
assert.match(catalog, /schema\.namespace/);
assert.doesNotMatch(catalog, /load_schema|unload_schema/);
assert.match(summary, /'assignment_enumeration'\s*=>\s*'unsupported_by_sketchup_ruby_api'/);
assert.match(summary, /'assignment_presence'\s*=>\s*'unknown'/);
assert.match(summary, /'assigned_type_count'\s*=>\s*nil/);
assert.match(summary, /'values_exposed'\s*=>\s*false/);
assert.match(summary, /'complete'\s*=>\s*false/);
assert.doesNotMatch(summary, /add_classification|set_classification_value|remove_classification/);
assert.match(fingerprint, /attribute_dictionaries/);
assert.match(fingerprint, /each_pair/);

for (const source of [snapshot, adoption, occurrence, revisionSource, filtered]) {
  assert.match(source, /native_classification|component_definition_summaries|classification_schemas/);
}
assert.match(snapshot, /native_definition_classification_summary/);
assert.match(revision, /'component_definition_summaries'\s*=>/);
assert.match(revision, /'classification_schemas'\s*=>/);
assert.match(revisionSource, /native_definition_classification_summary/);
assert.match(revisionSource, /MODEL_REVISION_STRATEGY\s*=\s*'definition-merkle\.v2'/);

process.stdout.write(`${JSON.stringify({
  ok: true,
  official_schema_enumeration: 'Classifications#each -> ClassificationSchema#name/#namespace',
  assigned_type_enumeration_supported: false,
  undocumented_classification_structure_interpreted: false,
  mutating_classification_api_called: false,
  definition_attribute_values_exposed: false,
  live_queue_called: false
}, null, 2)}\n`);

function methodBody(source, startName, endMarker) {
  const start = source.indexOf(`def ${startName}`);
  assert.ok(start >= 0, `missing Ruby method ${startName}`);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(end > start, `missing Ruby method terminator ${endMarker}`);
  return source.slice(start, end);
}
