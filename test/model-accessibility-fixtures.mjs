import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareFixture, writePreparedFixture } from '../scripts/model-accessibility/fixtures.mjs';
import { MockRuntime } from '../src/mock-runtime.mjs';
import { objectHash, sha256 } from '../scripts/model-accessibility/benchmark.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-fixture-test-'));
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };
const operations = value => value.flatMap(operation => [operation, ...(operation.operations ? operations(operation.operations) : [])]);
try {
  const cases = ['window.acceptance_a', 'asset_query.acceptance_b', 'edit_single.acceptance_a', 'asset_replace.acceptance_a', 'mirror_layout.acceptance_b', 'native_pbr.acceptance_a', 'local_repair.acceptance_b', 'negative.quality_failure'];
  const fixtures = [];
  for (const caseId of cases) {
    const fixture = await prepareFixture({ caseId, appearanceCatalogPath: path.join(root, 'intentionally-missing-catalog.json') });
    fixtures.push(fixture);
    check(operations(fixture.dsl.operations).every(operation => !['reset', 'delete', 'erase_entities', 'open_model', 'save_model', 'set_material', 'environment_activate'].includes(operation.op)), `${caseId}: preparation is additive and has no source mutations or native/file actions`);
    check(fixture.manifest.native_ready === false && fixture.manifest.runtime_called === false && fixture.manifest.file_delivery_ready === false, `${caseId}: offline preparation cannot become native acceptance`);
    check(fixture.manifest.dsl_sha256 === objectHash(fixture.dsl) && fixture.manifest.oracle_sha256 === objectHash(fixture.oracle), `${caseId}: exact DSL and assessor mapping hashes`);
    check(fixture.oracle.visibility === 'collector_and_independent_assessor_only' && fixture.oracle.native_measurements === null, `${caseId}: no hidden model answers or fabricated native measurement`);
    const diskDir = path.join(root, `${caseId}.persisted`);
    await writePreparedFixture({ caseId, outputDir: diskDir, appearanceCatalogPath: path.join(root, 'intentionally-missing-catalog.json') });
    const disk = async name => JSON.parse(await fs.readFile(path.join(diskDir, name), 'utf8'));
    const manifest = await disk('fixture-manifest.json');
    const persistedGraph = await disk('fixture.part-graph.private.json'), persistedOracle = await disk('fixture-oracle.private.json');
    check(manifest.dsl_sha256 === objectHash(await disk('fixture.dsl.json'))
      && manifest.oracle_sha256 === objectHash(await disk('fixture-oracle.private.json'))
      && manifest.part_graph_sha256 === objectHash(await disk('fixture.part-graph.private.json'))
      && manifest.source_manifest_sha256 === objectHash(manifest.source_files)
      && manifest.resource_manifest_sha256 === objectHash(manifest.source_resources), `${caseId}: persisted DSL/oracle/part graph/source/resource hashes survive JSON roundtrip`);
    const definitionsMatch = Object.values(persistedOracle.identities).filter(identity => identity.original_definition_sha256).every(identity => {
      const lookup = new Map(persistedGraph.parts.map(part => [part.id, part])), visited = new Set();
      const visit = id => { if (visited.has(id)) return; visited.add(id); for (const child of lookup.get(id)?.assembly?.children || []) visit(child.part_id); };
      visit(identity.root_part_id);
      return objectHash([...visited].sort().map(id => lookup.get(id))) === identity.original_definition_sha256;
    });
    check(definitionsMatch, `${caseId}: private original-definition fingerprints describe the persisted part graph`);
    if (fixture.asset_catalog) {
      const materials = await disk('asset-materializations.private.json');
      check(manifest.asset_catalog_sha256 === objectHash(await disk('asset-catalog.snapshot.json'))
        && manifest.asset_materializations_sha256 === objectHash(materials)
        && materials.every(material => material.dsl_sha256 === objectHash(material.dsl)), `${caseId}: persisted asset-source DSL and manifest hashes survive undefined-field removal`);
    }
    const runtime = new MockRuntime({ sessionPath: path.join(root, `${caseId}.mock.json`) });
    await runtime.buildModel(JSON.stringify(fixture.dsl));
    const model = await runtime.readModel();
    check(model.instances.some(item => item.id === 'accessibility-template-sentinel'), `${caseId}: complete constructive DSL executes in offline mock and keeps sentinel`);
  }
  check(new Set(fixtures.map(fixture => fixture.manifest.fixture_family)).size === 8, 'all eight fixed fixture families have concrete preparation paths');
  const shared = fixtures[2];
  const sharedRuntime = new MockRuntime({ sessionPath: path.join(root, 'edit_single.acceptance_a.mock.json') });
  const sharedModel = await sharedRuntime.readModel();
  const instance = id => sharedModel.instances.find(item => item.id === id);
  check(instance('A').definition === instance('B').definition && instance('B').definition === instance('C').definition && instance('D').definition !== instance('B').definition, 'A/B/C actually reference one component definition while D is independent');
  const definition = sharedModel.component_definitions[instance('A').definition];
  check(definition.groups.some(item => item.name.endsWith('toe-kick')) && definition.instances.filter(item => item.name.includes('drawer-')).length >= 3, 'shared definition has real assembled drawers and toe geometry');
  check(instance('B').attributes.BenchmarkManualEdit.preserve === true && instance('B').tag.endsWith('preserve-manual'), 'B has real per-instance preservation attributes and tag');
  check(instance('A').attributes?.BenchmarkManualEdit === undefined && instance('C').attributes?.BenchmarkManualEdit === undefined, 'B instance attributes do not leak into linked siblings');
  check(shared.oracle.identities.A.original_parameters_mm.width === 600 && shared.oracle.identities.B.original_parameters_mm.height === 900, 'original fixture dimensions are kept in private oracle');
  check(shared.oracle.identities.B.original_definition_sha256 === shared.oracle.identities.A.original_definition_sha256 && shared.oracle.identities.B.original_definition_sha256 !== shared.oracle.identities.D.original_definition_sha256, 'shared and independent definition fingerprints match actual references');
  check(shared.dsl.operations.filter(operation => operation.op === 'material').every(operation => operation.name.startsWith('fixture-')), 'fixture material names cannot redefine familiar template Detail_* materials');

  for (const variant of ['development', 'acceptance_a', 'acceptance_b']) {
    const array = await prepareFixture({ caseId: `array_align.${variant}` });
    check(array.oracle.identities.A.original_origin_mm[1] === 0 && ['B','C','D'].every(id => array.oracle.identities[id].original_origin_mm[1] === 4000), `${variant}: new array row cannot collide with untouched peer cabinets`);
    check(array.oracle.identities.A.original_definition_sha256 === array.oracle.identities.B.original_definition_sha256 && array.oracle.identities.B.manual_edit.must_preserve === true, `${variant}: row separation retains shared definition and manual preservation marker`);
    const diskDir = path.join(root, `array-${variant}`); await writePreparedFixture({ caseId: `array_align.${variant}`, outputDir: diskDir });
    const manifest = JSON.parse(await fs.readFile(path.join(diskDir, 'fixture-manifest.json')));
    check(manifest.dsl_sha256 === objectHash(JSON.parse(await fs.readFile(path.join(diskDir, 'fixture.dsl.json')))) && manifest.oracle_sha256 === objectHash(JSON.parse(await fs.readFile(path.join(diskDir, 'fixture-oracle.private.json')))), `${variant}: prepared r3 hashes survive persisted JSON roundtrip`);
  }

  const defect = fixtures[6].oracle.identities.B.defect;
  check(defect.fixture_origin_mm[1] === -51 && defect.drawer_front_plane_y_mm === -21 && defect.measured_by_construction_intrusion_mm === 30, 'local defect shifts actual toe-kick leaf 30 mm beyond the original front plane');
  const quality = fixtures[7];
  const capId = quality.oracle.identities.SinkCounter.defect.leaf_id;
  check(quality.part_graph.parts.some(part => part.id === capId && part.shape.parameters.size[2] === 2), 'quality negative contains an actual cap across the through opening');
  const layout = fixtures[4];
  check(layout.oracle.identities.L.children.length === 4 && layout.part_graph.roots.some(item => item.instance_id === 'Obstacle'), 'layout contains door/window/two cupboards plus unrelated obstacle');

  const reused = await prepareFixture({ caseId: 'window.acceptance_a', templateSentinel: { id: 'source-marker', create: false, original_fingerprint_sha256: sha256('trusted-original-marker') } });
  check(reused.dsl.operations.every(operation => operation.target_id !== 'source-marker' && operation.id !== 'source-marker') && reused.manifest.preconditions.preserve_existing_template_sentinel, 'existing template sentinel is observed and never recreated or modified');
  await assert.rejects(() => prepareFixture({ caseId: 'window.acceptance_a', templateSentinel: { id: 'source-marker', create: false } }), /fingerprint/); checks += 1;
  const sentinelRuntime = new MockRuntime({ sessionPath: path.join(root, 'reused-sentinel.mock.json') });
  await sentinelRuntime.buildModel(JSON.stringify({ version: 1, units: 'mm', operations: [{ op: 'box', id: 'source-marker', name: 'source-marker', size: [111, 222, 333], origin: [9000, 9000, 0] }] }));
  const originalMarker = objectHash((await sentinelRuntime.readModel()).groups[0]);
  await sentinelRuntime.buildModel(JSON.stringify(reused.dsl));
  check(objectHash((await sentinelRuntime.readModel()).groups[0]) === originalMarker, 'additive setup preserves existing template sentinel bytes in offline runtime');

  check(fixtures[1].manifest.blockers.includes('requested_asset_not_present:stool'), 'missing stool is not silently substituted with a chair');
  check(fixtures[3].manifest.blockers.includes('native_asset_file_not_prepared:detail-reading_chair') && fixtures[3].asset_materializations.length === 1, 'recipe source path is not mistaken for a ready native SKP; an additive materialization DSL is delivered');
  check(fixtures[5].manifest.blockers.includes('appearance_catalog_unavailable'), 'missing appearance catalog is an explicit blocker');
  for (const name of ['frozen_requirement', 'manual_edit_guard', 'name_conflict', 'uncertain_response', 'unsupported_native_hdr']) {
    const fixture = await prepareFixture({ caseId: `negative.${name}` });
    check(fixture.manifest.runtime_setups.length > 0 && fixture.manifest.blockers.some(blocker => blocker.startsWith('runtime_fixture_setup_required:')), `${name}: server protection/fault injection is not claimed from static JSON`);
  }
  const binary = path.join(root, 'actual-existing-test.hdr');
  await fs.writeFile(binary, '#?RADIANCE\nTEST FILE ONLY');
  const catalog = path.join(root, 'appearance.json');
  await fs.writeFile(catalog, JSON.stringify({ assets: [{ id: 'native-wood', kind: 'material', path: binary, source_sha256: sha256('wrong'), source: 'test fixture', license: 'test only' }, { id: 'native-daylight', kind: 'environment', path: binary, file_sha256: sha256(await fs.readFile(binary)), source: 'test fixture', license: 'test only' }] }));
  const stale = await prepareFixture({ caseId: 'native_hdr.acceptance_a', appearanceCatalogPath: catalog });
  check(stale.manifest.blockers.some(blocker => blocker.startsWith('resource_hash_mismatch:')), 'stale source-file hash cannot be reported as ready');
  const outputDir = path.join(root, 'prepared');
  const written = await writePreparedFixture({ caseId: 'edit_linked.acceptance_b', outputDir });
  check(JSON.parse(await fs.readFile(path.join(outputDir, 'fixture-manifest.json'), 'utf8')).dsl_sha256 === written.dsl_sha256, 'writes delivered DSL, private oracle, source manifest and part graph');
  await assert.rejects(() => writePreparedFixture({ caseId: 'edit_linked.acceptance_b', outputDir }), /EEXIST/); checks += 1;
  check(objectHash((await prepareFixture({ caseId: 'edit_single.acceptance_a' })).dsl) === objectHash(shared.dsl), 'same case preparation is deterministic for same source inputs');
  process.stdout.write(`${checks} model-accessibility fixture offline assertions passed; all eight families covered; no SketchUp or model calls; native_ready=false\n`);
} finally { await fs.rm(root, { recursive: true, force: true }); }
