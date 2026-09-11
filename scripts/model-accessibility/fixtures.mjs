#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUITE } from '../../benchmarks/model-accessibility/suite.mjs';
import { buildDetailedRecipe, DETAIL_MATERIALS } from '../../src/detailed-modeling/recipes.mjs';
import { buildFurnishingAsset, FURNISHING_MATERIALS } from '../../src/detailed-modeling/furnishing-assets.mjs';
import { compilePartGraphToSketchUpDsl } from '../../src/product-modeling/part-graph-compiler.mjs';
import { compileModelAccessibilityTask } from '../../src/model-accessibility-tasks.mjs';
import { describeAssemblyOccurrences } from '../../src/detailed-modeling/scenes.mjs';
import { queryLocalAssets } from '../../src/asset-catalog.mjs';
import { ROOT, objectHash, sha256 } from './benchmark.mjs';

const clone = value => structuredClone(value);
// Artifact hashes describe the JSON bytes' decoded value. Compiler objects may
// contain optional undefined properties that JSON files cannot retain. Keep
// this normalization local; historical benchmark canonical hashes stay intact.
const jsonArtifact = value => JSON.parse(JSON.stringify(value));
const STANDARD_CABINET = Object.freeze({ width: 600, depth: 600, height: 900 });
const DEFAULT_APPEARANCE = path.join(ROOT, 'output/detail-modeling-implementation-2026-09-06/appearance-assets/catalog-v2.json');
const SOURCE_FILES = ['scripts/model-accessibility/fixtures.mjs', 'benchmarks/model-accessibility/suite.mjs', 'src/detailed-modeling/recipes.mjs', 'src/detailed-modeling/furnishing-assets.mjs', 'src/product-modeling/part-graph-compiler.mjs', 'src/model-accessibility-tasks.mjs', 'src/detailed-modeling/scenes.mjs'];
const leaf = (id, origin, size, role = 'fixture_geometry') => ({ id, name: id, type: 'detail_geometry', role, shape: { primitive: 'box', parameters: { origin, size } }, material: 'Detail_Painted_Joinery', detail_level: 'detailed', evidence_status: 'manual_confirmed', fallback_state: 'structured_primitive' });
const assembly = (id, children) => ({ id, name: id, type: 'assembly', role: 'fixture_assembly', assembly: { children }, detail_level: 'detailed', evidence_status: 'manual_confirmed', fallback_state: 'structured_primitive' });

async function inspectFile(filePath, expectedSha256) {
  try {
    const absolute = await fs.realpath(filePath);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size === 0) throw new Error('Expected a nonempty regular file');
    const bytes = await fs.readFile(absolute);
    const actual = sha256(bytes);
    return { path: absolute, bytes: bytes.length, sha256: actual, expected_sha256: expectedSha256 ?? null, hash_matches_record: expectedSha256 ? actual === expectedSha256 : null, status: expectedSha256 && actual !== expectedSha256 ? 'hash_mismatch' : 'file_verified', native_geometry_verified: false };
  } catch (error) { return { path: path.resolve(filePath), status: 'unavailable', error: error.code ?? error.message, native_geometry_verified: false }; }
}

function definitionFingerprint(graph, rootId) {
  const lookup = new Map(graph.parts.map(part => [part.id, part]));
  const visited = new Set();
  const walk = id => { if (visited.has(id)) return; visited.add(id); for (const child of lookup.get(id)?.assembly?.children ?? []) walk(child.part_id); };
  walk(rootId);
  return objectHash(jsonArtifact([...visited].sort().map(id => lookup.get(id))));
}

export async function prepareFixture({ caseId, catalogPath = null, appearanceCatalogPath = DEFAULT_APPEARANCE, templateSentinel = null } = {}) {
  const task = SUITE.cases.find(item => item.id === caseId);
  if (!task) throw new Error(`Unknown fixed case: ${caseId}`);
  const namespace = `fixture-${sha256(caseId).slice(0, 10)}`;
  const graph = { version: 2, id: namespace, profile_id: namespace, coordinate_system: 'part_local', units: 'mm', product: { type: 'benchmark_fixture', name: task.fixture_id }, parts: [], roots: [] };
  const post = [];
  const identities = {};
  const blockers = [];
  const resources = [];
  const runtimeSetups = [];
  const sourceFiles = [];
  for (const file of SOURCE_FILES) sourceFiles.push({ path: file, sha256: sha256(await fs.readFile(path.join(ROOT, file))) });
  const sentinel = templateSentinel ?? { id: 'accessibility-template-sentinel', create: true, origin_mm: [-8000, -8000, 0], size_mm: [120, 160, 200] };
  if (typeof sentinel.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sentinel.id) || ['A', 'B', 'C', 'D', 'L', 'P'].includes(sentinel.id)) throw new Error('Use an unambiguous, non-task sentinel id');
  if (sentinel.create === true) {
    const id = `${namespace}-sentinel`;
    graph.parts.push(leaf(id, [0, 0, 0], sentinel.size_mm ?? [120, 160, 200], 'template_sentinel'));
    graph.roots.push({ part_id: id, instance_id: sentinel.id, origin: sentinel.origin_mm ?? [-8000, -8000, 0] });
    post.push({ op: 'attribute', target_id: sentinel.id, dictionary: 'BenchmarkFixture', attributes: { preserve: true, role: 'template_sentinel', fixture_id: namespace } });
  } else if (!sentinel.original_fingerprint_sha256 || !/^[a-f0-9]{64}$/.test(sentinel.original_fingerprint_sha256)) throw new Error('A reused template sentinel requires its original fingerprint SHA-256');
  identities[sentinel.id] = { source: sentinel.create ? 'new_authored_template_sentinel' : 'existing_template_sentinel', preserve: true, baseline: clone(sentinel) };

  function addRecipe(kind, suffix, parameters, placements) {
    const id = `${namespace}-${suffix}`;
    const recipe = ['reading_chair', 'side_table', 'pendant_light', 'potted_plant'].includes(kind) ? buildFurnishingAsset(kind, { id, parameters }) : buildDetailedRecipe(kind, { id, parameters });
    graph.parts.push(...recipe.parts);
    for (const placement of placements) {
      graph.roots.push({ part_id: recipe.root_id, instance_id: placement.id, origin: placement.origin ?? [0, 0, 0], ...(placement.angle !== undefined ? { transform: { rotateZ: placement.angle } } : {}) });
      identities[placement.id] = { definition_name: `PG2_${recipe.root_id}`, root_part_id: recipe.root_id, kind, original_parameters_mm: clone(parameters), original_origin_mm: placement.origin ?? [0, 0, 0], original_rotation_z_deg: placement.angle ?? 0, source_type: 'project_authored_fixture', native_identity: 'awaiting_native_pid_capture' };
    }
    return recipe;
  }
  function markPreserved(target = 'B') {
    post.push({ op: 'attribute', target_id: target, dictionary: 'BenchmarkManualEdit', attributes: { preserve: true, fixture_authored_manual_edit_marker: true, note: `preserve-${namespace}-${target}`, authored_before_test: true } });
    post.push({ op: 'tag', name: `${namespace}-preserve-manual`, visible: true }, { op: 'assign_tag', target_id: target, tag: `${namespace}-preserve-manual` });
    identities[target].manual_edit = { scope: 'instance_attributes_and_tag', dictionary: 'BenchmarkManualEdit', key: 'note', value: `preserve-${namespace}-${target}`, must_preserve: true, represents: 'authored manual-edit fixture, not a claim that a person modified a project model' };
  }
  function sharedCabinets() {
    // Preparation r3: leave the requested +X array row physically free. The
    // untouched shared peers and independent cabinet remain real fixtures.
    const peerY = task.category_id === 'array_align' || task.id.startsWith('array_align.') ? 4000 : 0;
    const shared = addRecipe('cabinet', 'shared-cabinet', STANDARD_CABINET, [{ id: 'A', origin: [0, 0, 0] }, { id: 'B', origin: [1600, peerY, 0] }, { id: 'C', origin: [3200, peerY, 0] }]);
    addRecipe('cabinet', 'independent-cabinet', STANDARD_CABINET, [{ id: 'D', origin: [4800, peerY, 0] }]);
    for (const id of ['A', 'B', 'C']) identities[id].shared_with = ['A', 'B', 'C'].filter(other => other !== id);
    identities.D.shared_with = [];
    markPreserved('B');
    return shared;
  }
  function defectiveCabinet() {
    addRecipe('cabinet', 'unchanged-cabinet', STANDARD_CABINET, [{ id: 'A', origin: [0, 0, 0] }]);
    const recipe = addRecipe('cabinet', 'defective-cabinet', STANDARD_CABINET, [{ id: 'B', origin: [1600, 0, 0] }]);
    const toe = graph.parts.find(part => part.id === `${recipe.root_id}-toe-kick`);
    if (!toe?.shape?.parameters?.origin) throw new Error('Current cabinet toe-kick structure changed; fixture needs review');
    const authoredY = toe.shape.parameters.origin[1];
    const intrusion = task.parameters.depth;
    toe.shape.parameters.origin[1] = -21 - intrusion;
    identities.B.defect = { kind: 'toe_kick_front_intrusion', leaf_id: toe.id, origin_before_defect_mm: [toe.shape.parameters.origin[0], authoredY, toe.shape.parameters.origin[2]], fixture_origin_mm: clone(toe.shape.parameters.origin), drawer_front_plane_y_mm: -21, measured_by_construction_intrusion_mm: intrusion, native_measurement_pending: true };
    markPreserved('B');
  }
  function assetLayout() {
    const p = task.parameters;
    const angle = p.angle * Math.PI / 180;
    const rotate = ([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
    const rel = rotate([380, -1200]);
    const tableOrigin = [p.width + rel[0], p.depth + rel[1], 0];
    addRecipe('reading_chair', 'chairs', { width: 760, depth: 790, seat_height: 440, back_height: 960 }, [{ id: 'B', origin: [p.width, p.depth, 0], angle: p.angle }, { id: 'A', origin: [tableOrigin[0] - 2400, tableOrigin[1], 0] }, { id: 'C', origin: [tableOrigin[0] + 1800, tableOrigin[1], 0] }]);
    addRecipe('side_table', 'table', { radius: 600, height: 535 }, [{ id: 'Table', origin: tableOrigin }]);
    identities.B.placement_relation = { other: 'Table', relation: 'table_center_on_chair_local_centerline', original_local_table_center_mm: [380, -1200, 0], original_table_world_origin_mm: tableOrigin };
    markPreserved('B');
  }
  function smallLayout() {
    const children = [];
    for (const [kind, suffix, parameters, origin] of [
      ['door', 'layout-door', { width: 900, depth: 150, height: 2200, open_angle: -30 }, [0, 0, 0]],
      ['window', 'layout-window', { width: 1200, depth: 140, height: 1300 }, [1200, 0, 900]],
      ['cabinet', 'layout-cabinets', STANDARD_CABINET, [0, -1800, 0]]
    ]) {
      const recipe = addRecipe(kind, suffix, parameters, []);
      children.push({ part_id: recipe.root_id, instance_id: suffix, origin });
      if (kind === 'cabinet') children.push({ part_id: recipe.root_id, instance_id: 'layout-cabinet-2', origin: [1100, -1800, 0] });
    }
    const layoutId = `${namespace}-layout-root`;
    graph.parts.push(assembly(layoutId, children));
    graph.roots.push({ part_id: layoutId, instance_id: 'L', origin: [-4000, 0, 0] });
    identities.L = { definition_name: `PG2_${layoutId}`, root_part_id: layoutId, original_origin_mm: [-4000, 0, 0], children: clone(children), native_identity: 'awaiting_native_pid_capture' };
    const obstruction = `${namespace}-obstacle`;
    graph.parts.push(leaf(obstruction, [0, 0, 0], [500, 500, 700], 'unrelated_obstacle'));
    graph.roots.push({ part_id: obstruction, instance_id: 'Obstacle', origin: [0, 5000, 0] });
    identities.Obstacle = { root_part_id: obstruction, original_origin_mm: [0, 5000, 0], preserve: true };
  }
  function appearancePanel() {
    const id = `${namespace}-panel`;
    graph.parts.push(leaf(id, [0, 0, 0], [1800, 900, 30], 'material_test_panel'));
    graph.roots.push({ part_id: id, instance_id: 'P', origin: [0, 0, 900] });
    identities.P = { definition_name: `PG2_${id}`, root_part_id: id, original_origin_mm: [0, 0, 900], original_size_mm: [1800, 900, 30], original_material: 'Detail_Painted_Joinery', native_identity: 'awaiting_native_pid_capture' };
  }
  function qualityFailure() {
    const bundle = compileModelAccessibilityTask({ version: 1, kind: 'sink_counter', id: `${namespace}-sink-counter`, units: 'mm', parameters: { width_mm: 1200, depth_mm: 650, height_mm: 900, thickness_mm: 30, sink_width_mm: 500, sink_depth_mm: 400, sink_height_mm: 180, sink_offset_x_mm: 350, sink_offset_y_mm: 125 }, placement: { origin_mm: [0, 0, 0] } }).bundle;
    graph.parts.push(...bundle.part_graph.parts);
    const cap = `${namespace}-intentional-hole-cap`;
    graph.parts.push(leaf(cap, [368, 143, 870], [464, 364, 2], 'intentional_quality_defect'));
    const root = graph.parts.find(part => part.id === `${namespace}-sink-counter`);
    root.assembly.children.push({ part_id: cap });
    graph.roots.push({ part_id: root.id, instance_id: 'SinkCounter', origin: [0, 0, 0] });
    identities.SinkCounter = { root_part_id: root.id, defect: { kind: 'through_opening_capped', leaf_id: cap, authored_cap_bounds_mm: { min: [368, 143, 870], max: [832, 507, 872] }, native_measurement_pending: true } };
  }

  if (task.fixture_id === 'shared_cabinets') sharedCabinets();
  else if (task.fixture_id === 'defective_cabinet') defectiveCabinet();
  else if (task.fixture_id === 'asset_layout') assetLayout();
  else if (task.fixture_id === 'small_layout') smallLayout();
  else if (task.fixture_id === 'appearance_assets') appearancePanel();
  else if (task.fixture_id === 'negative_cases') {
    if (['frozen_requirement', 'manual_edit_guard', 'ambiguous_scope', 'name_conflict'].includes(task.category)) sharedCabinets();
    if (task.category === 'quality_failure') qualityFailure();
    if (task.category === 'frozen_requirement') runtimeSetups.push({ kind: 'register_frozen_width', target: 'B', original_width_mm: 600, status: 'not_performed', reason: 'An attribute is not a server-side frozen-requirement authority.' });
    if (task.category === 'manual_edit_guard') runtimeSetups.push({ kind: 'register_manual_edit_preservation_guard', target: 'B', status: 'not_performed' });
    if (task.category === 'name_conflict') runtimeSetups.push({ kind: 'register_existing_B_protection', target: 'B', status: 'not_performed' });
    if (task.category === 'uncertain_response') runtimeSetups.push({ kind: 'drop_response_after_actual_dispatch', original_request_id: null, execution_receipt: null, status: 'not_performed', reason: 'A real dispatched request and its unknown-response boundary cannot be fabricated offline.' });
    if (task.category === 'unsupported_native_hdr') runtimeSetups.push({ kind: 'verified_native_hdr_unavailable_environment', status: 'not_performed', reason: 'Requires an actual environment/capability restriction, not a made-up unsupported flag.' });
  }

  let assetCatalog = null;
  const assetMaterializations = [];
  if (['asset_catalog', 'asset_layout'].includes(task.fixture_id)) {
    assetCatalog = jsonArtifact(await queryLocalAssets(catalogPath ? { catalog_path: path.resolve(catalogPath) } : {}));
    if (catalogPath) resources.push(await inspectFile(catalogPath));
    const needle = task.parameters.asset_kind;
    const candidates = assetCatalog.assets.filter(asset => [asset.id, asset.name, asset.recipe, ...(asset.tags ?? [])].some(value => typeof value === 'string' && value.toLowerCase().includes(needle)));
    // No renaming of a reading chair into a stool to satisfy the fixed holdout.
    if (candidates.length === 0) blockers.push(`requested_asset_not_present:${needle}`);
    for (const asset of candidates) {
      if (asset.path) resources.push(await inspectFile(asset.path, asset.current_file_sha256));
      if (!asset.path?.toLowerCase().endsWith('.skp')) {
        blockers.push(`native_asset_file_not_prepared:${asset.id}`);
        if (['reading_chair', 'side_table', 'pendant_light', 'potted_plant'].includes(asset.recipe)) {
          const source = buildFurnishingAsset(asset.recipe, { id: `${namespace}-catalog-${asset.recipe}` });
          const materialGraph = { version: 2, id: `${namespace}-asset-source`, profile_id: `${namespace}-asset-source`, units: 'mm', coordinate_system: 'part_local', parts: source.parts, roots: [{ part_id: source.root_id, instance_id: `Asset-${asset.recipe}`, origin: [0, 0, 0] }] };
          const materialDsl = jsonArtifact(compilePartGraphToSketchUpDsl(materialGraph, { version: 1, profile_id: materialGraph.profile_id, materials: source.materials }, { includeReset: false }));
          assetMaterializations.push({ asset_id: asset.id, recipe: asset.recipe, dsl: materialDsl, dsl_sha256: objectHash(materialDsl), root_id: `Asset-${asset.recipe}`, status: 'constructive_source_only', native_skp_path: null, native_dimensions: null, required: 'Materialize in a separate empty model, inspect complete root and bounds, save native SKP, then register its hash/path/axes/provenance before freezing the fixture.' });
        }
      }
      if (asset.license === 'unknown' || asset.source === 'unknown') blockers.push(`asset_provenance_missing:${asset.id}`);
    }
    assetCatalog.fixture_selection = { requested_kind: needle, candidate_ids: candidates.map(asset => asset.id), substitution_allowed: false };
  }
  if (task.fixture_id === 'appearance_assets') {
    const catalogFile = await inspectFile(appearanceCatalogPath);
    resources.push(catalogFile);
    if (catalogFile.status === 'file_verified') {
      const catalog = JSON.parse(await fs.readFile(appearanceCatalogPath, 'utf8'));
      const selected = catalog.assets?.filter(asset => ['native-wood', 'native-daylight', 'native-studio'].includes(asset.id)) ?? [];
      for (const asset of selected) {
        const record = await inspectFile(asset.path, asset.file_sha256 ?? asset.source_sha256);
        resources.push({ ...record, asset_id: asset.id, source: asset.source, license: asset.license });
        if (asset.texture_size_mm?.path) {
          const textureDir = path.dirname(asset.texture_size_mm.path);
          for (const filename of (await fs.readdir(textureDir)).filter(name => /\.(png|jpe?g)$/i.test(name)).sort()) resources.push({ ...await inspectFile(path.join(textureDir, filename)), asset_id: asset.id, role: 'existing_texture_map' });
        }
      }
      if (!selected.some(asset => asset.id === 'native-wood')) blockers.push('native_wood_asset_missing');
      if (!selected.some(asset => asset.kind === 'environment')) blockers.push('native_hdr_asset_missing');
    } else blockers.push('appearance_catalog_unavailable');
  }
  for (const resource of resources) if (resource.status !== 'file_verified') blockers.push(`resource_${resource.status}:${resource.path}`);
  for (const setup of runtimeSetups) blockers.push(`runtime_fixture_setup_required:${setup.kind}`);

  const materials = [...new Map([...DETAIL_MATERIALS, ...FURNISHING_MATERIALS].map(material => [material.name, material])).values()].map(material => ({ ...clone(material), name: `${namespace}-${material.name}` }));
  // Additive setup must not redefine an existing template material with the same
  // familiar Detail_* name. The fixture owns a separate material namespace.
  for (const part of graph.parts) if (typeof part.material === 'string') part.material = `${namespace}-${part.material}`;
  for (const identity of Object.values(identities)) if (identity.original_material) identity.original_material = `${namespace}-${identity.original_material}`;
  const profile = { version: 1, profile_id: namespace, materials };
  const dsl = graph.roots.length ? jsonArtifact(compilePartGraphToSketchUpDsl(graph, profile, { includeReset: false })) : { version: 1, units: 'mm', metadata: {}, operations: [] };
  dsl.operations.push(...post);
  dsl.metadata = { ...(dsl.metadata ?? {}), source_type: 'authored_benchmark_fixture', fixture_family: task.fixture_id, case_id: caseId, additive_only: true, native_ready: false };
  for (const [id, identity] of Object.entries(identities)) if (identity.root_part_id) identity.original_definition_sha256 = definitionFingerprint(graph, identity.root_part_id);
  const occurrenceMapping = graph.roots.length ? describeAssemblyOccurrences(graph) : [];
  const oracle = jsonArtifact({ schema_version: 'model-accessibility-fixture-oracle.v1', case_id: caseId, visibility: 'collector_and_independent_assessor_only', identities, occurrence_mapping: occurrenceMapping, source_type: 'authored_constructive_reference', native_measurements: null, baseline_dimensions_only: true, note: 'Do not inject this mapping, original dimensions, defect construction or evaluator instructions into model messages. Capture native persistent IDs and measured baseline after preparing the separate document.' });
  const manifest = {
    schema_version: 'model-accessibility-fixture.v1', fixture_family: task.fixture_id, case_id: caseId, suite_sha256: objectHash(SUITE),
    artifact_hash_encoding: 'canonical_json_of_json_roundtripped_value.v1', part_graph_sha256: objectHash(jsonArtifact(graph)),
    asset_catalog_sha256: assetCatalog ? objectHash(assetCatalog) : null,
    status: blockers.length ? 'prepared_dsl_with_blockers' : 'prepared_dsl_awaiting_native_baseline',
    dsl_sha256: objectHash(dsl), oracle_sha256: objectHash(oracle), source_manifest_sha256: objectHash(sourceFiles), source_files: sourceFiles,
    source_resources: resources, resource_manifest_sha256: objectHash(resources), asset_materializations_sha256: objectHash(assetMaterializations), runtime_setups: runtimeSetups, blockers,
    preconditions: { target: 'fresh disposable empty model copy', preserve_existing_template_sentinel: sentinel.create !== true, existing_sentinel: sentinel.create === true ? null : sentinel, reject_other_existing_roots: true, reject_name_or_definition_collisions: true, reset_allowed: false, original_source_model_may_not_be_modified: true },
    native_ready: false, runtime_called: false, file_delivery_ready: false,
    required_next_evidence: ['create separate model without resetting the source', 'capture template/source sentinel before and after additive build', 'capture actual native persistent IDs, dimensions, shared-definition identity and protected attributes', 'verify material and asset files before use', 'save, close and reopen the fixture SKP', 'hash complete prepared package identically for baseline and optimized']
  };
  return jsonArtifact({ dsl, oracle, manifest, part_graph: graph, asset_catalog: assetCatalog, asset_materializations: assetMaterializations });
}

export async function writePreparedFixture({ outputDir, ...options }) {
  const fixture = await prepareFixture(options);
  await fs.mkdir(outputDir, { recursive: false });
  for (const [name, value] of Object.entries({ 'fixture.dsl.json': fixture.dsl, 'fixture-oracle.private.json': fixture.oracle, 'fixture-manifest.json': fixture.manifest, 'fixture.part-graph.private.json': fixture.part_graph, ...(fixture.asset_catalog ? { 'asset-catalog.snapshot.json': fixture.asset_catalog, 'asset-materializations.private.json': fixture.asset_materializations } : {}) })) await fs.writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  return fixture.manifest;
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i].slice(2)] = process.argv[i + 1];
  if (!options.case || !options['output-dir']) throw new Error('Expected --case <fixed case id> --output-dir <new directory>');
  const sentinel = options['template-sentinel'] ? JSON.parse(await fs.readFile(options['template-sentinel'], 'utf8')) : null;
  const result = await writePreparedFixture({ caseId: options.case, outputDir: path.resolve(options['output-dir']), catalogPath: options.catalog, appearanceCatalogPath: options['appearance-catalog'], templateSentinel: sentinel });
  process.stdout.write(`${JSON.stringify({ case_id: result.case_id, status: result.status, output: path.resolve(options['output-dir']), blockers: result.blockers, native_ready: false, runtime_called: false }, null, 2)}\n`);
  if (result.blockers.length) process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
