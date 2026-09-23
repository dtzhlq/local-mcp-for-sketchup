import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CAPABILITY_MANIFEST_VERSION,RUNTIME_CAPABILITY_VERSION} from '../src/capabilities.mjs';

const [mainSource, snapshotSource, revisionSource] = await Promise.all([
  fs.readFile('sketchup_plugin/alma_sketchup_mcp.rb', 'utf8'),
  fs.readFile('sketchup_plugin/alma_sketchup_mcp/snapshot.rb', 'utf8'),
  fs.readFile('sketchup_plugin/alma_sketchup_mcp/model_revision.rb', 'utf8')
]);

const adoption = methodBody(mainSource, 'adoption_result', 'def get_selection');
const occurrence = methodBody(mainSource, 'occurrence_entity_snapshot', 'def occurrence_path_segments');
const segments = methodBody(mainSource, 'occurrence_path_segments', 'def occurrence_geometry_counts');
const geometry = methodBody(mainSource, 'occurrence_geometry_summary', 'def occurrence_allowed_operations');
const filtered = methodBody(mainSource, 'filtered_entity_snapshots', 'def adoptable_entities');
const capabilities = methodBody(mainSource, 'get_capabilities', 'def get_session_state');
const sessionState = methodBody(mainSource, 'get_session_state', 'def reset_model');
const transportGuard = methodBody(mainSource, 'assert_transport_guard!', 'def assert_pending_open_target!');

assert.match(mainSource, /OCCURRENCE_CONTRACT_VERSION\s*=\s*'canonical-occurrence-path\.v1'/);
assert.ok(mainSource.includes(`CAPABILITY_MANIFEST_VERSION = '${CAPABILITY_MANIFEST_VERSION}'`));
assert.ok(mainSource.includes(`RUNTIME_CAPABILITY_VERSION = '${RUNTIME_CAPABILITY_VERSION}'`));
assert.match(revisionSource, /MODEL_REVISION_STRATEGY\s*=\s*'definition-merkle\.v2'/);
assert.match(revisionSource, /MODEL_REVISION_UNIQUE_ENTITY_LIMIT\s*=\s*1_000_000/);
assert.match(revisionSource, /entries_digest/);
assert.doesNotMatch(revisionSource, /digests\s*=\s*\[\]/);
assert.match(revisionSource, /child_definition_digest/);
assert.match(revisionSource, /safe_revision_count_add/);
assert.doesNotMatch(revisionSource, /recursive_entity_index\(/);
assert.match(adoption, /'occurrence_contract'\s*=>\s*assembly_projection \? 'canonical-assembly-path\.v1' : OCCURRENCE_CONTRACT_VERSION/);
assert.match(capabilities, /'occurrence_contract'\s*=>\s*OCCURRENCE_CONTRACT_VERSION/);
assert.match(sessionState, /'occurrence_contract'\s*=>\s*OCCURRENCE_CONTRACT_VERSION/);
for (const source of [capabilities, sessionState, transportGuard]) {
  assert.match(source, /'boolean_operations_sha256'\s*(?:=>|,)\s*BOOLEAN_OPERATIONS_SHA256/,
    'live capability/session/guard must bind the loaded Boolean source');
  assert.match(source, /'model_revision_source_sha256'\s*(?:=>|,)\s*MODEL_REVISION_SOURCE_SHA256/,
    'live capability/session/guard must bind the loaded Model Revision source');
}
assert.match(adoption, /'model_modified'\s*=>/);
assert.match(sessionState, /'model_modified'\s*=>/);
assert.match(transportGuard, /guard\.key\?\('model_modified'\)/);
assert.match(transportGuard, /'model_modified'.*HANDSHAKE_MODEL_REVISION_MISMATCH/);
for (const field of [
  'session_id',
  'document_id',
  'model_identity',
  'model_revision_complete',
  'model_revision_total_seen',
  'model_revision_indexed',
  'model_revision_strategy',
  'model_revision_unique_entity_limit',
  'model_modified'
]) {
  assert.match(adoption, new RegExp(`'${field}'\\s*=>`), `adoption must bind ${field}`);
  assert.match(sessionState, new RegExp(`'${field}'\\s*=>`), `session state must bind ${field}`);
}
for (const field of [
  'parent_entity_path',
  'path_segments',
  'definition_persistent_id',
  'entity_definition_name',
  'entity_definition_persistent_id',
  'world_transform',
  'tag',
  'classification',
  'attributes',
  'texture_transform',
  'face_uvs',
  'locked',
  'geometry_summary'
]) {
  assert.match(occurrence, new RegExp(`'${field}'\\s*=>`), `recursive occurrence must expose ${field}`);
}
assert.match(occurrence, /Sketchup::InstancePath\.new\(path_entities\[0\.\.\.-1\]\)/);
assert.match(segments, /'entity_type'\s*=>\s*entity_type/);
assert.match(segments, /'persistent_id'\s*=>\s*entity_persistent_id/);
assert.match(segments, /'reference'\s*=>\s*entity_id/);
for (const field of ['normal', 'area_mm2', 'outer_loop', 'holes', 'length_mm', 'endpoints', 'adjacent_face_count', 'soft', 'smooth']) {
  assert.match(geometry, new RegExp(`'${field}'\\s*=>`), `recursive geometry summary must expose ${field}`);
}

for (const field of ['locked', 'attributes', 'classification', 'transform', 'features']) {
  assert.match(filtered, new RegExp(`'${field}'\\s*=>`), `top-level adoption projection must preserve ${field}`);
}
assert.match(adoption, /'allowed_operations'\s*=>\s*occurrence_allowed_operations/);
assert.equal((snapshotSource.match(/'locked'\s*=>/g) || []).length, 2, 'group and component snapshots must preserve lock state');

process.stdout.write(`${JSON.stringify({
  ok: true,
  occurrence_contract: 'canonical-occurrence-path.v1',
  recursive_fields_checked: 14,
  geometry_summary_fields_checked: 9,
  top_level_fields_checked: 6,
  session_binding_fields_checked: 9,
  loaded_source_attestations_checked: 6,
  runtime_capability_version: '0.1.0-rc.2-capabilities.7',
  runtime_manifest_version: '2026-07-agent-contract-v1.4',
  model_revision_strategy: 'definition-merkle.v2',
  model_modified_bound: true,
  snapshot_lock_fields: 2,
  live_queue_called: false
}, null, 2)}\n`);

function methodBody(source, startName, endMarker) {
  const start = source.indexOf(`def ${startName}`);
  assert.ok(start >= 0, `missing Ruby method ${startName}`);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(end > start, `missing Ruby method terminator ${endMarker}`);
  return source.slice(start, end);
}
