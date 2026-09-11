import assert from 'node:assert/strict';
import { verifyRecordedNativeAssetHierarchy as verify } from '../scripts/model-accessibility/verify-native-asset-hierarchy.mjs';

const sha = 'a'.repeat(64), revision = `sha256:${sha}`;
const measure = { source: 'sketchup_runtime', measured: true, complete: true, face_count: 6, edge_count: 12 };
const occurrence = (ids, pids, definition) => ({ id: ids.at(-1), part_id: ids.at(-1), name: ids.at(-1),
  instance_path: ids, persistent_path: pids, entity_path: ids.join('/'), definition_name: definition, visible: true, geometry_evidence: measure });
const definition = (name, id) => ({ name, persistent_id: id, native_classification: {
  definition_attribute_fingerprint: revision, fingerprint_coverage: 'all_definition_attribute_dictionaries', attribute_dictionary_count: 1, attribute_key_count: 1, complete: false } });
function fixture() {
  const root = { id: 'wrapper', persistent_id: '20' };
  const resources = { complete: true, scope: 'all_native_stored_geometry', includes_hidden: true, includes_unused_definitions: true,
    faces: 6, edges: 12, vertices: 8, definition_count: 1, expanded_totals: { faces: 6, edges: 12, vertices: 8 } };
  const source = { runtime: 'queue', snapshot: { instances: [{ id: 'chair', persistent_id: '1' }], geometry_occurrences: [occurrence(['chair'], ['1'], 'Chair')],
    component_definition_summaries: [definition('Chair', '2')], resource_totals: resources, model_revision: revision, model_revision_complete: true } };
  const imported = { runtime: 'queue', document_id: 'doc1', model_identity: { runtime_object_id: '100' },
    model_revision: revision, model_revision_complete: true, model_revision_indexed: 20, model_revision_total_seen: 20,
    model_revision_strategy: 'definition-merkle.v2', model_revision_blockers: [],
    snapshot: { ...source.snapshot, instances: [root], resource_totals: { ...resources, definition_count: 2 },
      geometry_occurrences: [occurrence(['wrapper'], ['20'], 'Container'), occurrence(['wrapper', 'chair'], ['20', '21'], 'Chair')],
      component_definition_summaries: [definition('Chair', '22'), definition('Container', '23')] } };
  const angle = Math.PI / 6, matrix = [Math.cos(angle), Math.sin(angle), 0, 0, -Math.sin(angle), Math.cos(angle), 0, 0, 0, 0, 1, 0, 1000 / 25.4, 1200 / 25.4, 0, 1];
  const sourceRecord = { source_path: '/fixture/source.skp', source_sha256: sha, size_bytes: 10, catalog_sha256: sha };
  const data = { source, imported,
    sourceAfterSave: { model_info: { source_path: sourceRecord.source_path, model_modified: false }, snapshot: source.snapshot },
    sourceSave: { file_path: sourceRecord.source_path, file_size_bytes: 10 },
    adoption: { ...imported, recursive_truncated: true, recursive_total_seen: 20, recursive_index: [{ parent_entity_path: null, entity_path: 'pid:20',
      reference: 'wrapper', entity_definition_name: 'Container', world_transform: matrix, transformation: matrix }] },
    prepared: { source: sourceRecord, task_id: 'task-1', plan: { operations: [{ op: 'place_component_asset', id: 'wrapper', source_path: sourceRecord.source_path,
      source_sha256: sha, origin: [1000, 1200, 0], rotateZ: 30 }], execution_contract: { final_save_path: '/fixture/saved.skp' } } },
    applied: { task_id: 'task-1', task_state: 'completed', completed: true, native_mutation_receipt: { status: 'finalized' },
      source_file_unchanged: true, diagnostic_pass: false, boundary: { passed: false }, file_receipt: { path: '/fixture/saved.skp', sha256: sha, bytes: 20, available: true } },
    files: { source_skp: { sha256: sha, bytes: 10 }, saved_skp: { sha256: sha, bytes: 20 }, catalog: { sha256: sha } } };
  return JSON.parse(JSON.stringify(data));
}
const original = fixture(), before = JSON.stringify(original), report = verify(original);
assert.equal(report.import_hierarchy_pass, true);
assert.equal(report.prior_diagnostic.diagnostic_pass, false);
assert.equal(report.prior_diagnostic.recursive_index_complete, false);
assert.equal(report.native_calls_performed, 0);
assert.equal(report.formal_acceptance, false);
assert.equal(JSON.stringify(original), before);
let rejected = 0;
for (const mutate of [
  x => x.imported.snapshot.geometry_occurrences.pop(),
  x => x.imported.snapshot.geometry_occurrences.push(x.imported.snapshot.geometry_occurrences[1]),
  x => { x.imported.snapshot.geometry_occurrences[1].instance_path = ['wrapper', 'missing', 'chair']; },
  x => { x.imported.snapshot.geometry_occurrences[1].geometry_evidence.face_count = 7; },
  x => { x.imported.snapshot.component_definition_summaries[0].native_classification.definition_attribute_fingerprint = `sha256:${'b'.repeat(64)}`; },
  x => { x.imported.snapshot.resource_totals.faces = 7; },
  x => { x.adoption.model_revision_complete = false; },
  x => { x.imported.model_revision_indexed = 19; },
  x => { x.adoption.recursive_index[0].world_transform[12] = 1000; },
  x => { x.files.saved_skp.sha256 = 'b'.repeat(64); },
  x => { x.sourceAfterSave.model_info.source_path = '/other.skp'; }
]) { const candidate = fixture(); mutate(candidate); assert.equal(verify(candidate).import_hierarchy_pass, false); rejected++; }
const disk = fixture();
disk.cold = { checks: { exact_file: false }, snapshot: { ...structuredClone(disk.imported), model_identity: { source_path: '/fixture/saved.skp', runtime_object_id: '101' },
  model_info: { source_path: '/fixture/saved.skp', model_modified: false }, model_modified: false, document_id: 'doc2', model_revision: `sha256:${'b'.repeat(64)}` } };
const compared = verify(disk).disk_reopen;
assert.equal(compared.exact_saved_file, true);
assert.equal(compared.same_exported_snapshot_fields, true);
assert.equal(compared.same_complete_native_revision, false);
assert.equal(compared.precise_reopened_root_matrix_verified, false);
assert.equal(compared.revision_drift.exact_native_leaf_field_identified, false);
assert.equal(compared.full_roundtrip_verification_pass, false);
assert.equal(compared.original_checks_preserved.exact_file, false);
console.log(`native asset hierarchy: valid bounded evidence, ${rejected} rejected mutations, preserved historical/cold-reopen limits passed; no native calls`);
