#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const VERSION = 'recorded-native-asset-hierarchy.v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(sort(value));
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const equal = (a, b) => isDeepStrictEqual(a, b);
const digest = value => `sha256:${hash(canonical(value))}`;
const shaPattern = /^sha256:[0-9a-f]{64}$/;
const list = value => Array.isArray(value) ? value : [];
const roots = snapshot => [...list(snapshot?.groups), ...list(snapshot?.instances)];
const omit = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !keys.includes(key)));

// Pure comparison of previously captured JSON. No bridge, provider, approval
// authority or native runtime imports. A pass concerns these recorded values;
// it is not a substitute for a native mesh export or a release acceptance run.
export function verifyRecordedNativeAssetHierarchy({ source, sourceAfterSave, sourceSave, imported, adoption, prepared, applied, cold, files }) {
  const checks = [];
  const check = (code, passed, details = {}) => { checks.push({ code, passed: passed === true, ...details }); return passed === true; };
  const s = source?.snapshot || {}, t = imported?.snapshot || {};
  const sourceOccurrences = list(s.geometry_occurrences), importedOccurrences = list(t.geometry_occurrences);
  const sourceRoots = roots(s), targetRoots = roots(t);
  const op = list(prepared?.plan?.operations)[0];
  const wrapper = importedOccurrences.find(item => item.instance_path?.length === 1);
  check('single_frozen_place_operation', prepared?.plan?.operations?.length === 1 && op?.op === 'place_component_asset' &&
    equal(op.origin, [1000, 1200, 0]) && op.rotateZ === 30 && op.source_path === prepared?.source?.source_path && op.source_sha256 === prepared?.source?.source_sha256);
  check('single_additional_wrapper', sourceRoots.length === 1 && targetRoots.length === 1 &&
    importedOccurrences.filter(item => item.instance_path?.length === 1).length === 1 && wrapper?.id === op?.id &&
    targetRoots[0]?.id === op?.id && importedOccurrences.length === sourceOccurrences.length + 1);
  const index = (items, label) => {
    const result = new Map(), persistent = new Set();
    let valid = items.length > 0;
    for (const item of items) {
      const p = item.instance_path, ids = item.persistent_path;
      if (!Array.isArray(p) || !p.length || !p.every(x => typeof x === 'string' && x.length > 0) ||
        !Array.isArray(ids) || ids.length !== p.length || !ids.every(x => /^[1-9][0-9]*$/.test(x)) ||
        item.entity_path !== p.join('/') || item.id !== p.at(-1)) { valid = false; continue; }
      const key = canonical(p), pid = canonical(ids);
      if (result.has(key) || persistent.has(pid)) valid = false;
      result.set(key, item); persistent.add(pid);
    }
    for (const item of result.values()) {
      const p = item.instance_path;
      if (p.length > 1 && (!result.has(canonical(p.slice(0, -1))) ||
        !equal(result.get(canonical(p.slice(0, -1))).persistent_path, item.persistent_path.slice(0, -1)))) valid = false;
    }
    check(`${label}_unique_closed_container_paths`, valid);
    return result;
  };
  const sourceIndex = index(sourceOccurrences, 'source'), targetIndex = index(importedOccurrences, 'import');
  const occurrenceMappings = sourceOccurrences.map(item => {
    const target = targetIndex.get(canonical([wrapper?.id, ...list(item.instance_path)]));
    const matched = !!target && equal(omit(item, ['instance_path', 'persistent_path', 'entity_path']),
      omit(target, ['instance_path', 'persistent_path', 'entity_path']));
    return { source_path: item.instance_path, imported_path: target?.instance_path ?? null,
      source_persistent_path: item.persistent_path, imported_persistent_path: target?.persistent_path ?? null,
      definition_name: item.definition_name, geometry_evidence_hash: digest(item.geometry_evidence ?? null), matched };
  });
  check('all_source_occurrences_preserved', sourceIndex.size === sourceOccurrences.length && sourceOccurrences.length > 0 &&
    occurrenceMappings.every(item => item.matched) && targetIndex.size === sourceIndex.size + 1,
  { source_count: sourceOccurrences.length, imported_count: importedOccurrences.length, matched_count: occurrenceMappings.filter(item => item.matched).length });
  check('all_native_geometry_measurements_complete', [...sourceOccurrences, ...importedOccurrences].length > 0 &&
    [...sourceOccurrences, ...importedOccurrences].every(item => item.geometry_evidence?.complete === true &&
      item.geometry_evidence?.measured === true && item.geometry_evidence?.source === 'sketchup_runtime'));
  check('wrapper_geometry_matches_source_root', sourceOccurrences.filter(item => item.instance_path?.length === 1).length === 1 &&
    equal(wrapper?.geometry_evidence, sourceOccurrences.find(item => item.instance_path?.length === 1)?.geometry_evidence));

  const sd = list(s.component_definition_summaries), td = list(t.component_definition_summaries);
  const names = array => array.map(item => item.name);
  const definitionsUnique = sd.length > 0 && new Set(names(sd)).size === sd.length && new Set(names(td)).size === td.length;
  const definitions = sd.map(item => {
    const target = td.find(other => other.name === item.name), a = item.native_classification, b = target?.native_classification;
    return { name: item.name, source_persistent_id: item.persistent_id, imported_persistent_id: target?.persistent_id ?? null,
      fingerprint: a?.definition_attribute_fingerprint ?? null,
      attribute_dictionary_count: a?.attribute_dictionary_count ?? null, attribute_key_count: a?.attribute_key_count ?? null,
      matched: !!a && !!b && shaPattern.test(a.definition_attribute_fingerprint) && a.fingerprint_coverage === 'all_definition_attribute_dictionaries' && equal(a, b) };
  });
  const extraDefinitions = td.filter(item => !names(sd).includes(item.name));
  check('definition_attribute_fingerprints_preserved', definitionsUnique && definitions.every(item => item.matched) &&
    extraDefinitions.length === 1 && extraDefinitions[0]?.name === wrapper?.definition_name &&
    sourceOccurrences.every(item => names(sd).includes(item.definition_name)) && importedOccurrences.every(item => names(td).includes(item.definition_name)),
  { source_count: sd.length, imported_count: td.length, matched_count: definitions.filter(item => item.matched).length, additional_wrapper_definition: extraDefinitions[0]?.name ?? null });
  check('all_stored_geometry_preserved', s.resource_totals?.complete === true && t.resource_totals?.complete === true &&
    s.resource_totals?.scope === 'all_native_stored_geometry' && s.resource_totals?.includes_hidden === true && s.resource_totals?.includes_unused_definitions === true &&
    equal(omit(s.resource_totals, ['definition_count']), omit(t.resource_totals, ['definition_count'])) &&
    s.resource_totals.definition_count === sd.length && t.resource_totals.definition_count === td.length,
  { source: s.resource_totals, imported: t.resource_totals });
  const expanded = t.resource_totals?.expanded_totals;
  const expectedLogical = expanded?.faces + expanded?.edges + importedOccurrences.length;
  check('complete_native_revision_covers_all_expanded_entities', source.runtime === 'queue' && imported.runtime === 'queue' && adoption.runtime === 'queue' &&
    s.model_revision_complete === true && shaPattern.test(s.model_revision) && t.model_revision_complete === true &&
    imported.model_revision_complete === true && adoption.model_revision_complete === true && shaPattern.test(imported.model_revision) &&
    imported.model_revision === t.model_revision && imported.model_revision === adoption.model_revision &&
    imported.model_revision_strategy === 'definition-merkle.v2' && adoption.model_revision_strategy === 'definition-merkle.v2' &&
    equal(imported.model_revision_blockers, []) && equal(adoption.model_revision_blockers, []) &&
    imported.model_revision_indexed === expectedLogical && imported.model_revision_total_seen === expectedLogical &&
    adoption.model_revision_indexed === expectedLogical && adoption.model_revision_total_seen === expectedLogical,
  { native_revision: imported.model_revision, expanded_faces: expanded?.faces, expanded_edges: expanded?.edges,
    container_occurrences: importedOccurrences.length, expected_logical_entities: expectedLogical, indexed: imported.model_revision_indexed });

  const rootPid = wrapper?.persistent_path?.[0];
  const rootRows = list(adoption.recursive_index).filter(item => item.parent_entity_path === null && item.entity_path === `pid:${rootPid}`);
  const matrix = rootRows[0]?.world_transform;
  const radians = (op?.rotateZ ?? NaN) * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const expectedMatrix = [cos, sin, 0, 0, -sin, cos, 0, 0, 0, 0, 1, 0, ...list(op?.origin).map(mm => mm / 25.4), 1];
  const matrixMatches = actual => Array.isArray(actual) && actual.length === 16 && expectedMatrix.length === 16 &&
    actual.every((number, i) => Number.isFinite(number) && Math.abs(number - expectedMatrix[i]) <= 1e-8);
  check('native_root_placement_matches_review', rootRows.length === 1 && targetRoots[0]?.persistent_id === rootPid &&
    rootRows[0]?.reference === op?.id && rootRows[0]?.entity_definition_name === wrapper?.definition_name &&
    matrixMatches(matrix) && matrixMatches(rootRows[0]?.transformation),
  { root_reference: `pid:${rootPid}`, origin_mm: op?.origin, rotation_z_deg: op?.rotateZ, native_matrix: matrix,
    native_translation_units: 'inches', comparison_tolerance: 1e-8, measured_world_bounds_mm: rootRows[0]?.bounding_box });

  check('source_saved_inspection_binding', sourceAfterSave?.model_info?.source_path === prepared?.source?.source_path &&
    sourceAfterSave?.model_info?.model_modified === false && sourceAfterSave?.snapshot?.model_revision_complete === true &&
    sourceAfterSave?.snapshot?.model_revision === s.model_revision && sourceSave?.file_path === prepared?.source?.source_path &&
    sourceSave?.file_size_bytes === files?.source_skp?.bytes && equal(sourceAfterSave?.snapshot?.geometry_occurrences, sourceOccurrences));
  check('source_and_saved_copy_file_hashes_match_records', files?.source_skp?.sha256 === prepared?.source?.source_sha256 &&
    files?.source_skp?.bytes === prepared?.source?.size_bytes && files?.catalog?.sha256 === prepared?.source?.catalog_sha256 &&
    files?.saved_skp?.sha256 === applied?.file_receipt?.sha256 && files?.saved_skp?.bytes === applied?.file_receipt?.bytes &&
    applied?.file_receipt?.available === true && applied?.file_receipt?.path === prepared?.plan?.execution_contract?.final_save_path,
  { source_file: files?.source_skp, saved_file: files?.saved_skp, catalog_file: files?.catalog });
  check('same_recorded_completed_task', applied?.task_id === prepared?.task_id && applied?.completed === true &&
    applied?.task_state === 'completed' && applied?.native_mutation_receipt?.status === 'finalized' && applied?.source_file_unchanged === true);

  return { version: VERSION, kind: 'recorded_native_asset_hierarchy_supplement', import_hierarchy_pass: checks.every(item => item.passed),
    checks, occurrence_mappings: occurrenceMappings, definition_fingerprints: definitions,
    prior_diagnostic: { diagnostic_pass: applied?.diagnostic_pass, boundary_passed: applied?.boundary?.passed,
      recursive_index_complete: adoption.recursive_truncated === false, recursive_index_truncated: adoption.recursive_truncated,
      recursive_index_rows: list(adoption.recursive_index).length, recursive_total_seen: adoption.recursive_total_seen,
      historical_result_rewritten: false },
    disk_reopen: cold ? compareRecordedDiskReopen({ imported, cold: cold.snapshot, receipt: applied.file_receipt, savedFile: files.saved_skp, originalChecks: cold.checks }) : null,
    evidence_scope: 'host_development_recorded_native_container_hierarchy_and_measurements', formal_acceptance: false,
    native_calls_performed: 0, model_calls_performed: 0, import_replayed: false, authorization_reverified: false,
    limits: [
      'The original recursive face/edge index remains truncated. Complete container paths are a separate native geometry_occurrences traversal.',
      'Matching per-container native measurements and stored geometry counts do not establish byte-identical face meshes or every per-face property.',
      'Definition attribute fingerprints cover all definition dictionaries; native classification assignment enumeration remains unsupported.',
      'Recorded native revision completeness is checked without recomputing a native Merkle digest from incomplete exported leaf data.',
      'File hashes are reread from disk. Approval signatures and SKP contents are not independently reinterpreted by this offline verifier.'
    ] };
}

export function compareRecordedDiskReopen({ imported, cold, receipt, savedFile, originalChecks }) {
  const a = imported?.snapshot || {}, b = cold?.snapshot || {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => !['model_revision', 'model_revision_complete'].includes(key));
  const fields = Object.fromEntries(keys.map(key => [key, equal(a[key], b[key])]));
  const metadataKeys = ['model_revision_strategy', 'model_revision_total_seen', 'model_revision_indexed', 'model_revision_unique_entities', 'model_revision_reachable_definitions', 'model_revision_blockers'];
  const graphMetadataEqual = metadataKeys.every(key => equal(imported?.[key], cold?.[key]));
  const revisionSame = shaPattern.test(cold?.model_revision) && cold.model_revision === imported?.model_revision;
  const exactFile = typeof receipt?.path === 'string' && cold?.model_identity?.source_path === receipt.path && cold?.model_info?.source_path === receipt.path;
  const diskHash = !!savedFile && savedFile.sha256 === receipt?.sha256 && savedFile.bytes === receipt?.bytes;
  const exportedEqual = keys.length > 0 && Object.values(fields).every(Boolean);
  return { kind: 'corrected_recorded_disk_reopen_comparison', exact_saved_file: exactFile, same_saved_file_sha256: diskHash,
    clean_document: cold?.model_modified === false && cold?.model_info?.model_modified === false,
    changed_document_identity: !!cold?.document_id && cold.document_id !== imported?.document_id &&
      cold?.model_identity?.runtime_object_id !== imported?.model_identity?.runtime_object_id,
    source_path: cold?.model_identity?.source_path, before_document_id: imported?.document_id, reopened_document_id: cold?.document_id,
    before_revision: imported?.model_revision, reopened_revision: cold?.model_revision,
    both_native_revisions_complete: imported?.model_revision_complete === true && cold?.model_revision_complete === true,
    same_complete_native_revision: revisionSame, same_exported_snapshot_fields: exportedEqual, field_comparisons: fields,
    same_graph_count_and_completeness_metadata: graphMetadataEqual,
    precise_reopened_root_matrix_available: false,
    precise_reopened_root_matrix_verified: false,
    root_matrix_limitation: 'This non-recursive cold capture exports transform:null and no native world matrix. Equal root bounds do not prove the exact matrix.',
    revision_drift: { observed: !revisionSame, exact_native_leaf_field_identified: false,
      narrowed_to: exportedEqual && graphMetadataEqual && !revisionSame ? 'unexported_native_entity_merkle_root_digest_or_payload' : 'see_exported_field_comparisons',
      source_basis: 'model_revision.rb session_model_revision_report hashes root_digest, graph metadata and snapshot fields; model GUID, document ID and source path are not hashed.',
      limitation: 'The recorded snapshots contain no per-entity Merkle payload/digest tree, so the differing leaf field cannot be identified from this evidence.' },
    full_roundtrip_verification_pass: false, application_restart_verified: false, formal_acceptance: false,
    original_checks_preserved: originalChecks,
    correction: 'exact_saved_file reads model_identity.source_path and model_info.source_path. The old collector used a nonexistent file_path identity member.' };
}

export async function verifyNativeAssetHierarchyFiles({ sourceDir, runDir, outputPath = path.join(runDir, 'hierarchy-supplement.json') }) {
  for (const value of [sourceDir, runDir, outputPath]) if (!path.isAbsolute(value)) throw new Error('Use explicit absolute source, run and output paths.');
  const provenance = [];
  const read = async filename => {
    const bytes = await fs.readFile(filename);
    const record = { path: filename, bytes: bytes.length, sha256: hash(bytes) }; provenance.push(record);
    return { bytes, record };
  };
  const json = async filename => JSON.parse((await read(filename)).bytes.toString('utf8'));
  const source = await json(path.join(sourceDir, 'native-inspection.json'));
  const sourceAfterSave = await json(path.join(sourceDir, 'after-save.json'));
  const sourceSave = await json(path.join(sourceDir, 'save.json'));
  const imported = await json(path.join(runDir, 'native-after.json'));
  const adoption = await json(path.join(runDir, 'native-after-adoption.json'));
  const prepared = await json(path.join(runDir, 'prepared.json'));
  const applied = await json(path.join(runDir, 'apply-result.json'));
  let cold;
  try { cold = await json(path.join(runDir, 'host-disk-reopen.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = {};
  for (const [key, filename] of Object.entries({ source_skp: prepared.source.source_path, saved_skp: applied.file_receipt.path, catalog: prepared.source.catalog_path })) {
    if (!path.isAbsolute(filename) || (key !== 'catalog' && path.extname(filename).toLowerCase() !== '.skp')) throw new Error('Recorded evidence file path is invalid.');
    files[key] = (await read(filename)).record;
  }
  const verifier = (await read(fileURLToPath(import.meta.url))).record;
  const report = { generated_at: new Date().toISOString(), ...verifyRecordedNativeAssetHierarchy({ source, sourceAfterSave, sourceSave, imported, adoption, prepared, applied, cold, files }), provenance, verifier };
  // Every input is rehashed before emitting; never replace an old diagnostic or
  // an earlier supplement. Exclusive creation also blocks accidental replay.
  for (const record of provenance) if (hash(await fs.readFile(record.path)) !== record.sha256) throw new Error(`Evidence changed while verifying: ${record.path}`);
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { output_path: outputPath, import_hierarchy_pass: report.import_hierarchy_pass, checks: report.checks.length,
    failed_checks: report.checks.filter(item => !item.passed).map(item => item.code),
    disk_reopen_complete_revision_matches: report.disk_reopen?.same_complete_native_revision ?? null, formal_acceptance: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), config = {};
  const names = { '--source-dir': 'sourceDir', '--run-dir': 'runDir', '--output': 'outputPath' };
  for (let index = 0; index < args.length; index += 2) {
    if (!names[args[index]] || !args[index + 1] || config[names[args[index]]]) throw new Error('Usage: --source-dir ABS --run-dir ABS [--output NEW_ABS_JSON]');
    config[names[args[index]]] = args[index + 1];
  }
  const result = await verifyNativeAssetHierarchyFiles(config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.import_hierarchy_pass) process.exitCode = 1;
}
