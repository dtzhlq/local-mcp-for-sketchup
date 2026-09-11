#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../../src/bridge.mjs';
import { sha256Canonical } from '../../src/agent-contract.mjs';
import { compileModelAccessibilityTask } from '../../src/model-accessibility-tasks.mjs';
import { prepareHostCommonCreation } from '../../src/model-accessibility-host-provisioning.mjs';
import { parameterSourceDocumentBinding } from '../../src/model-accessibility-parameter-discovery.mjs';
import { adoptParameterRoots } from '../../src/model-accessibility-scoped-readback.mjs';
import { objectHash, sha256, ROOT } from './benchmark.mjs';
import { prepareFixture } from './fixtures.mjs';
import { gatewayHostOptions } from './gateway-adapter.mjs';
import { assertEmptyNativeTemplate } from './native-asset-development.mjs';
import { writeParameterFixtureState } from './parameter-fixture-state.mjs';

const json = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => objectHash(json(a)) === objectHash(json(b));
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const unique = (items, predicate, message) => { const matches = items.filter(predicate); requireThat(matches.length === 1, message); return matches[0]; };

// Pure host plan: the frozen fixture's original construction is compared with
// the common recipe, never with the model's requested edited dimensions.
export async function planParameterFixture({ manifest, dsl, oracle, part_graph }) {
  requireThat(manifest?.fixture_family === 'shared_cabinets' && manifest.native_ready === false && manifest.blockers?.length === 0,
    'Expected an unchanged shared_cabinets preparation without blockers.');
  requireThat(objectHash(dsl) === manifest.dsl_sha256 && objectHash(oracle) === manifest.oracle_sha256 && objectHash(part_graph) === manifest.part_graph_sha256,
    'Prepared parameter fixture artifact hash mismatch.');
  const sentinel = Object.entries(oracle.identities || {}).filter(([, value]) => value.source === 'new_authored_template_sentinel');
  requireThat(sentinel.length === 1 && sentinel[0][1].baseline.create === true && Object.keys(oracle.identities).length === 5,
    'This host path requires exactly A/B/C/D and one newly authored sentinel.');
  const [sentinelId, sentinelIdentity] = sentinel[0];
  const expected = await prepareFixture({ caseId: manifest.case_id, templateSentinel: sentinelIdentity.baseline });
  requireThat(same(expected.dsl, dsl) && same(expected.oracle, oracle) && same(expected.part_graph, part_graph),
    'Prepared construction differs from the fixed fixture definition. Rehashed injected operations are not accepted.');
  const source = ids => {
    const base = oracle.identities[ids[0]];
    requireThat(base?.kind === 'cabinet' && ids.every(id => oracle.identities[id]?.root_part_id === base.root_part_id
      && same(oracle.identities[id].original_parameters_mm, base.original_parameters_mm)), 'Cabinet source identities differ.');
    const task = { version: 1, kind: 'cabinet', id: base.root_part_id, units: 'mm',
      parameters: Object.fromEntries(Object.entries(base.original_parameters_mm).map(([name, value]) => [`${name}_mm`, value])),
      instances: ids.map(id => ({ id, origin_mm: oracle.identities[id].original_origin_mm,
        rotation_z_deg: oracle.identities[id].original_rotation_z_deg })) };
    const compiled = compileModelAccessibilityTask(task), parts = compiled.bundle.part_graph.parts;
    const lookup = new Map(part_graph.parts.map(part => [part.id, part])), visited = new Set();
    const walk = id => { if (visited.has(id)) return; visited.add(id); const part = lookup.get(id); requireThat(part, 'Missing prepared recipe part.'); for (const child of part.assembly?.children || []) walk(child.part_id); };
    walk(base.root_part_id);
    const prefix = `${part_graph.id}-`;
    const preparedParts = [...visited].map(id => { const part = json(lookup.get(id)); if (typeof part.material === 'string') { requireThat(part.material.startsWith(prefix), 'Fixture material ownership mismatch.'); part.material = part.material.slice(prefix.length); } return part; });
    requireThat(same(preparedParts.sort((a,b) => a.id.localeCompare(b.id)), json(parts).sort((a,b) => a.id.localeCompare(b.id))),
      'Every original fixture part must match the complete common cabinet recipe.');
    return { key: ids.join(''), root_ids: ids, task, source_hash: sha256Canonical(task),
      source_dsl_sha256: sha256Canonical(json(JSON.parse(compiled.inputs.code))), matched_recipe_parts: parts.length };
  };
  const sources = [source(['D']), source(['A', 'B', 'C'])];
  requireThat(sources[0].task.id !== sources[1].task.id, 'D must have an independent definition source.');
  const instance = unique(dsl.operations, op => op.op === 'component_instance' && op.id === sentinelId, 'Sentinel instance is not unique.');
  const definition = unique(dsl.operations, op => op.op === 'component_definition' && op.name === instance.definition, 'Sentinel definition is not unique.');
  requireThat(definition.operations.length === 1 && definition.operations[0].op === 'box', 'Sentinel must remain the sole frozen box.');
  const material = unique(dsl.operations, op => op.op === 'material' && op.name === definition.operations[0].material, 'Sentinel material is not unique.');
  const attribute = unique(dsl.operations, op => op.op === 'attribute' && op.target_id === sentinelId && op.dictionary === 'BenchmarkFixture', 'Sentinel preservation attributes missing.');
  const marker = unique(dsl.operations, op => op.op === 'attribute' && op.target_id === 'B' && op.dictionary === 'BenchmarkManualEdit', 'B preservation marker missing.');
  const assigned = unique(dsl.operations, op => op.op === 'assign_tag' && op.target_id === 'B', 'B preservation tag missing.');
  unique(dsl.operations, op => op.op === 'tag' && op.name === assigned.tag && op.visible === true, 'B tag declaration missing.');
  return json({ version: 'host-parameter-fixture-plan.v1', case_id: manifest.case_id, prepared_dsl_sha256: manifest.dsl_sha256,
    prepared_oracle_sha256: manifest.oracle_sha256, prepared_graph_sha256: manifest.part_graph_sha256,
    sentinel: { id: sentinelId, baseline: sentinelIdentity.baseline, attribute: attribute.attributes,
      dsl: { version: 1, units: 'mm', operations: [material, definition, instance, attribute] } },
    sources, metadata: [{ root_id: 'B', dictionary: marker.dictionary, attributes: marker.attributes, tag: 'preserve-manual' }],
    readonly_oracle: oracle.identities, expected_root_count: 5, never_inject_into_model_context: true,
    sequence: ['empty_document_check', 'sentinel_one_atomic_build', 'independent_D_common_creation', 'shared_ABC_common_creation_with_initial_metadata', 'bounded_five_root_readback', 'private_signed_state'],
    automatic_retry_allowed: false, formal_acceptance: false });
}

export async function readParameterFixturePlan(preparedDir) {
  const read = async name => JSON.parse(await fs.readFile(path.join(preparedDir, name), 'utf8'));
  const [manifest, dsl, oracle, part_graph] = await Promise.all(['fixture-manifest.json', 'fixture.dsl.json', 'fixture-oracle.private.json', 'fixture.part-graph.private.json'].map(read));
  for (const source of manifest.source_files || []) {
    requireThat(typeof source.path === 'string' && !path.isAbsolute(source.path) && !source.path.split(/[\\/]/).includes('..'), 'Invalid fixture source path.');
    requireThat(sha256(await fs.readFile(path.join(ROOT, source.path))) === source.sha256, 'Prepared implementation source changed; rebuild into a new preparation directory.');
  }
  return planParameterFixture({ manifest, dsl, oracle, part_graph });
}

const subtree = (adoption, rootPath) => adoption.recursive_index.filter(row => row.entity_path === rootPath || row.entity_path.startsWith(`${rootPath}.`));
function nativeRoot(adoption, id) { return unique(adoption.recursive_index, row => row.parent_entity_path === null && [row.id, row.reference].includes(id), `Native root ${id} is not unique.`); }
function assertPlacement(row, origin, angle) {
  const radians = angle * Math.PI / 180, expected = [Math.cos(radians), Math.sin(radians), 0, 0, -Math.sin(radians), Math.cos(radians), 0, 0, 0, 0, 1, 0, ...origin.map(value => value / 25.4), 1];
  requireThat(row.world_transform?.length === 16 && row.world_transform.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) < 1e-7), 'Native root origin/rotation differs from the prepared fixture.');
}
function assertSize(row, expected, message) {
  const actual = [row.bounding_box?.w, row.bounding_box?.d, row.bounding_box?.h];
  requireThat(actual.every((value, index) => Number.isFinite(value) && Math.abs(value - expected[index]) <= 0.1), message);
}

// Explicit host-only execution. Default and CLI without --execute-host are
// dry runs. No model provider, approval issuer, reset, source save or retry.
export async function materializeParameterFixture({ preparedDir, outputDir, executeHost = false, recursiveLimit = 10000, approvalStateDir, approvalHostUrl } = {}, { createBridge = options => new SketchUpBridge(options) } = {}) {
  requireThat(path.isAbsolute(preparedDir || '') && path.isAbsolute(outputDir || '') && Number.isInteger(recursiveLimit) && recursiveLimit >= 1 && recursiveLimit <= 10000, 'Absolute preparation/output paths and an unchanged per-read limit are required.');
  const plan = await readParameterFixturePlan(preparedDir);
  await fs.mkdir(outputDir, { recursive: false, mode: 0o700 });
  const write = async (name, value) => fs.writeFile(path.join(outputDir, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await write('host-plan.private.json', plan);
  if (!executeHost) { const result = { dry_run: true, case_id: plan.case_id, runtime_called: false, fixture_ready: false, formal_acceptance: false }; await write('dry-run.json', result); return result; }
  const stateRoot = path.join(outputDir, 'initialized-state'); await fs.mkdir(stateRoot, { mode: 0o700 });
  const config = gatewayHostOptions({ stateRoot, runtime: 'queue', approvalStateDir, approvalHostUrl }, {});
  const bridge = createBridge({ ...config.bridgeOptions, executionPolicy: { ...config.bridgeOptions.executionPolicy, allow_direct_expert_queue_mutation: true } });
  const inspect = () => bridge.adopt_open_model({ runtime: 'queue', read_only: true, recursive: false, timeoutMs: 120000 });
  const caps = await bridge.get_capabilities({ runtime: 'queue', timeoutMs: 120000 }); await write('capabilities.json', caps);
  requireThat(caps.runtime?.creation_scope?.host_new_root_metadata === 'new-root-metadata.v1', 'Install/restart the bounded host metadata native plugin before provisioning.');
  const before = await inspect(); await write('native-before.json', before);
  assertEmptyNativeTemplate({ ...before.snapshot, model_revision: before.model_revision, model_revision_complete: before.model_revision_complete });
  const namedResources = JSON.stringify([before.snapshot.materials, before.component_definition_summaries]);
  requireThat(![plan.sentinel.dsl.operations[0].name, plan.sentinel.dsl.operations[1].name].some(name => namedResources.includes(JSON.stringify(name))), 'Sentinel resource already exists in the source template.');
  await write('sentinel-build-started.json', { case_id: plan.case_id, dsl_sha256: objectHash(plan.sentinel.dsl), before_revision: before.model_revision, automatic_retry_allowed: false });
  const sentinelBuilt = await bridge.withFreshQueueMutationAuthorization({ operation: 'build_model', timeoutMs: 120000 }, authorized => authorized.build_model({ runtime: 'queue', code: JSON.stringify(plan.sentinel.dsl), timeoutMs: 120000 }));
  await write('sentinel-build.json', sentinelBuilt);
  const initialSentinel = await adoptParameterRoots({ bridge, runtime: 'queue', recursiveLimit, rootIds: [plan.sentinel.id], timeoutMs: 120000 });
  await write('sentinel-initial-readback.json', initialSentinel);
  const sentinelRoot = nativeRoot(initialSentinel, plan.sentinel.id);
  requireThat(same(sentinelRoot.attributes?.BenchmarkFixture, plan.sentinel.attribute), 'Initial sentinel preservation marker was not committed.');
  assertPlacement(sentinelRoot, plan.sentinel.baseline.origin_mm, 0);
  assertSize(sentinelRoot, plan.sentinel.baseline.size_mm, 'Native sentinel dimensions differ from the frozen fixture.');
  const sources = [];
  for (const source of plan.sources) {
    const connection = await bridge.start_agent_task({ intent: 'discover', instruction: 'Host fixture preparation connection.', inputs: { topic: 'connect', runtime: 'queue' } });
    requireThat(connection.task_state === 'completed' && !connection.error, 'Fresh host creation connection failed.');
    const args = { instruction: `Host authors the exact original ${source.key} cabinet fixture before the blind model run.`,
      idempotency_key: `host-fixture:${sha256(outputDir).slice(0, 16)}:${source.key}`,
      inputs: { runtime: 'queue', connection_task_id: connection.task_id, recursive_limit: recursiveLimit, timeout_ms: 120000, task: source.task } };
    await write(`${source.key}-creation-started.json`, { source_hash: source.source_hash, source_dsl_sha256: source.source_dsl_sha256, automatic_retry_allowed: false });
    const response = source.key === 'ABC' ? await bridge.agentGateway.start(prepareHostCommonCreation({ ...args, metadata: plan.metadata }))
      : await bridge.start_agent_task({ intent: 'create_model', ...args });
    await write(`${source.key}-creation-response.json`, response);
    const task = response.task_id && await bridge.taskStore.getTask(response.task_id, { includePrivate: true }), creation = task?.private?.creation;
    requireThat(creation?.parameter_edit_support?.baseline_captured === true && creation.parameter_source?.parameter_revision === 0
      && creation.parameter_source.entries.length === source.root_ids.length && sha256Canonical(task.inputs.task) === source.source_hash,
    `The ${source.key} initial trusted source was not captured; already created geometry is preserved and no retry/late capture is allowed.`);
    requireThat(source.key !== 'ABC' || creation.host_provisioning?.source_hash === source.source_hash, 'ABC initial metadata/source packet missing.');
    sources.push({ task_id: task.task_id, source_hash: source.source_hash, source_record_hash: creation.parameter_source.source_record_hash,
      root_ids: source.root_ids, identity_map: creation.identity_map, document_binding: creation.parameter_source_document_binding,
      ...(creation.host_provisioning ? { host_provisioning: creation.host_provisioning } : {}), initial_readback: creation.parameter_source_readback || null });
  }
  const rootMap = { [plan.sentinel.id]: plan.sentinel.id };
  for (const source of sources) for (const id of source.root_ids) rootMap[id] = source.identity_map[id];
  const final = await adoptParameterRoots({ bridge, runtime: 'queue', recursiveLimit, rootIds: Object.values(rootMap), timeoutMs: 120000 });
  await write('native-baseline.json', final);
  const documentBinding = parameterSourceDocumentBinding(final);
  requireThat(final.entities.filter(row => ['group','component_instance'].includes(row.entity_type)).length === plan.expected_root_count
    && sources.every(source => source.document_binding === documentBinding), 'Fixture has extra roots or source document identity drift.');
  requireThat(same(subtree(initialSentinel, sentinelRoot.entity_path), subtree(final, sentinelRoot.entity_path)), 'Sentinel changed during additive cabinet creation.');
  const rows = Object.fromEntries(Object.entries(rootMap).map(([name, id]) => [name, nativeRoot(final, id)]));
  const measuredPanels = [];
  for (const id of ['A','B','C','D']) {
    const identity = plan.readonly_oracle[id]; assertPlacement(rows[id], identity.original_origin_mm, identity.original_rotation_z_deg);
    requireThat(Math.abs(rows[id].bounding_box.w - identity.original_parameters_mm.width) <= 0.1 && Math.abs(rows[id].bounding_box.h - identity.original_parameters_mm.height) <= 0.1,
      'Native cabinet width/height differs from the original fixture.');
    const source = sources.find(item => item.root_ids.includes(id));
    for (const side of ['left','right']) {
      const mappedId = source.identity_map[`${identity.root_part_id}-side-${side}`];
      const panel = unique(subtree(final, rows[id].entity_path), row => [row.id, row.reference].includes(mappedId), 'Native cabinet side panel has no unique source mapping.');
      assertSize(panel, [18, identity.original_parameters_mm.depth, identity.original_parameters_mm.height - 100], 'Native carcass depth or 18 mm side panel dimensions differ from the fixed recipe.');
      measuredPanels.push({ root: id, side, entity_path: panel.entity_path, bounding_box: panel.bounding_box });
    }
  }
  const definition = row => row.entity_definition_persistent_id || row.entity_definition_name;
  requireThat(definition(rows.A) && ['B','C'].every(id => definition(rows[id]) === definition(rows.A)) && definition(rows.D) !== definition(rows.A)
    && ['A','B','C'].every(id => rows[id].entity_definition_occurrence_count === 3) && rows.D.entity_definition_occurrence_count === 1,
    'Native ABC physical sharing or D independence differs from the fixture.');
  requireThat(same(rows.B.attributes?.BenchmarkManualEdit, plan.metadata[0].attributes)
    && rows.B.tag === sources[1].host_provisioning.tag_map['preserve-manual'], 'B initial marker/tag not preserved.');
  const result = { version: 'host-parameter-fixture-materialization.v1', case_id: plan.case_id, runtime: 'queue', fixture_ready: true,
    state_root: stateRoot, creation_sources: sources.map(({ task_id, source_hash, source_record_hash }) => ({ task_id, source_hash, source_record_hash })),
    document_binding: documentBinding, model_revision: final.model_revision, prepared_dsl_sha256: plan.prepared_dsl_sha256,
    prepared_oracle_sha256: plan.prepared_oracle_sha256, root_mapping: rootMap, measured_roots: rows, measured_side_panels: measuredPanels, bounded_readback: final.bounded_readback,
    geometry_source: 'exact_common_recipe_and_immediate_native_creation_readback', model_provider_called: false,
    saved: false, cold_reopen_verified: false, formal_acceptance: false };
  await write('materialization.private.json', result);
  await writeParameterFixtureState({ bridge, stateRoot, record: { case_id: result.case_id, runtime: result.runtime, fixture_ready: true,
    document_binding: documentBinding, creation_sources: result.creation_sources, model_revision: result.model_revision,
    prepared_dsl_sha256: plan.prepared_dsl_sha256, formal_acceptance: false } });
  return { fixture_ready: true, case_id: result.case_id, state_root: stateRoot, model_revision: result.model_revision, saved: false, formal_acceptance: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--execute-host') options.executeHost = true;
    else if (args[i] === '--dry-run') options.executeHost = false;
    else if (['--prepared-dir','--output-dir','--recursive-limit'].includes(args[i])) { const key = { '--prepared-dir': 'preparedDir', '--output-dir': 'outputDir', '--recursive-limit': 'recursiveLimit' }[args[i]]; options[key] = key === 'recursiveLimit' ? Number(args[++i]) : path.resolve(args[++i]); }
    else throw new Error(`Unknown host fixture option: ${args[i]}`);
  }
  console.log(JSON.stringify(await materializeParameterFixture(options)));
}
