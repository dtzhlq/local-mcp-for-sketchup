#!/usr/bin/env node
import fs from 'node:fs/promises';
import {recompileDetailedBundle} from '../src/detailed-modeling/recompile-bundle.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SketchUpBridge } from '../src/bridge.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { buildDesignIntentGraph, planDesignParameterChange, reconcileDesignIntentGraph } from '../src/design-intent-graph.mjs';
import { prepareAssemblyParameterEdit, applyAssemblyParameterEdit } from '../src/detailed-modeling/assembly-edit.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
export const DETAIL_LIVE_ROOT = path.join(repo, 'output/detail-modeling-implementation-2026-09-06');
const TIMEOUT = 120000;
const usage = `Usage:
  node scripts/run-detail-assembly-edit-live.mjs run LABEL RUN_ID --parameters '{"width":1800}' --scope single|all [--pair-offset 2200,0,0] [--model-name LABEL.skp] [--part PART_ID] [--associate PART_ID,...] [--iteration INTEGER] [--expect-instances 2] [--instances NATIVE_ID,...] [--source-run RUN_ID] [--recursive-limit 20000]
  node scripts/run-detail-assembly-edit-live.mjs reopen LABEL RUN_ID

Only saved independent models under this run's models directory are accepted.
run uses the existing server trusted-copy policy (S2/S3/S4, at most 10 affected
instances); no approval token or simulated user click is minted by this script.
The optional peer is added by a reviewed component_instance operation first.
Outputs: evidence/LABEL/assembly/RUN_ID and models/LABEL-RUN_ID.skp.
No live call is made for --help or when this module is imported.`;

export function parseDetailAssemblyArguments(argv) {
  if (!argv.length || argv.includes('--help')) return { help: true };
  const [action, label, runId, ...rest] = argv;
  if (!['run', 'reopen'].includes(action)) throw new Error('Expected run or reopen');
  for (const [field, value] of [['label', label], ['runId', runId]]) if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value || '')) throw new Error(`Invalid ${field}`);
  const options = {};
  const allowed = new Set(['parameters', 'scope', 'pair-offset', 'model-name', 'part', 'associate', 'iteration', 'expect-instances', 'instances', 'source-run', 'recursive-limit']);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]?.replace(/^--/, '');
    if (!rest[index]?.startsWith('--') || !allowed.has(key) || options[key] !== undefined || rest[index + 1] === undefined) throw new Error(`Invalid or duplicate option: ${rest[index]}`);
    options[key] = rest[index + 1];
  }
  const modelName = options['model-name'] || `${label}.skp`;
  if (!/^[a-z0-9][a-z0-9-]*\.skp$/.test(modelName) || !modelName.startsWith(`${label}.`) && !modelName.startsWith(`${label}-`)) throw new Error('model-name must be a .skp test copy with the label prefix');
  if (options['source-run'] && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(options['source-run'])) throw new Error('Invalid source-run');
  const parameters = action === 'run' ? JSON.parse(options.parameters || '{}') : {};
  if (action === 'run' && (!parameters || Array.isArray(parameters) || typeof parameters !== 'object' || !Object.keys(parameters).length)) throw new Error('--parameters requires a non-empty JSON object');
  for (const value of Object.values(parameters)) if (!(typeof value === 'number' && Number.isFinite(value)) && typeof value !== 'string' && typeof value !== 'boolean') throw new Error('Parameters must contain finite numbers, strings or booleans');
  const scope = options.scope;
  if (action === 'run' && !['single', 'all'].includes(scope)) throw new Error('--scope must explicitly be single or all');
  const iteration = Number(options.iteration || Date.now());
  const recursiveLimit = Number(options['recursive-limit'] || 20000);
  if (!Number.isSafeInteger(iteration) || iteration < 1) throw new Error('iteration must be a positive safe integer');
  if (!Number.isInteger(recursiveLimit) || recursiveLimit < 100 || recursiveLimit > 100000) throw new Error('recursive-limit must be between 100 and 100000');
  const pairOffset = options['pair-offset']?.split(',').map(Number);
  if (pairOffset && (pairOffset.length !== 3 || !pairOffset.every(Number.isFinite) || pairOffset.every(value => value === 0))) throw new Error('pair-offset must contain three finite numbers and a nonzero translation');
  const expectedInstances = options['expect-instances'] === undefined ? null : Number(options['expect-instances']);
  if (expectedInstances !== null && (!Number.isInteger(expectedInstances) || expectedInstances < 1 || expectedInstances > 10)) throw new Error('expect-instances must be from 1 to 10');
  return { action, label, runId, modelName, parameters, scope, iteration, recursiveLimit, pairOffset, expectedInstances,
    part: options.part, associates: (options.associate || '').split(',').filter(Boolean),
    instances: (options.instances || '').split(',').filter(Boolean), sourceRun: options['source-run'] };
}

export function detailLiveModelPath(modelName) {
  if (path.basename(modelName) !== modelName || !modelName.endsWith('.skp')) throw new Error('A test model basename is required');
  return path.join(DETAIL_LIVE_ROOT, 'models', modelName);
}

export function assemblyInspectionViews(bundle, selected) {
  const overview = bundle.views.find(view => view.kind === 'overview') || bundle.views[0];
  if (!overview || !selected.length) throw new Error('Assembly inspection requires an overview and explicit native targets');
  return [structuredClone(overview), ...selected.map((node, index) => {
    const bounds = node.bounding_box;
    if (!node.reference || !bounds || ![bounds.min, bounds.max].every(values => Array.isArray(values) && values.length === 3 && values.every(Number.isFinite)) || bounds.min.some((value, axis) => value > bounds.max[axis])) throw new Error('Assembly inspection requires measured native bounds');
    const target = bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2);
    const radius = Math.max(1, Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis])) / 2);
    // Fit the enclosing sphere against the narrower image axis. SketchUp may
    // express the FOV against either axis; a wide export must fit in both cases.
    const halfAngle = Math.atan(Math.tan(21 * Math.PI / 180) / 1.6);
    const direction = [1.3, -2.4, 1.3];
    const distance = radius / Math.sin(halfAngle) * 1.2;
    const scale = distance / Math.hypot(...direction);
    return { id: `edited-instance-${index + 1}`, kind: 'closeup', instance_path: [node.reference], width: 1600, height: 1000,
      camera: { eye: target.map((value, axis) => value + direction[axis] * scale), target, up: [0, 0, 1], fov: 42 } };
  })];
}

export async function runDetailAssemblyLive(args) {
  if (args.help) { console.log(usage); return; }
  const evidence = path.join(DETAIL_LIVE_ROOT, 'evidence', args.label);
  const runDir = path.join(evidence, 'assembly', args.runId);
  const dir = args.action === 'reopen' ? path.join(runDir, `reopen-audit-${Date.now()}`) : runDir;
  const write = async (name, value) => fs.writeFile(path.join(dir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await fs.mkdir(dir, { recursive: false });
  const bridge = new SketchUpBridge({ queue: { timeoutMs: TIMEOUT },
    executionPolicy: { allowed_runtimes: ['mock', 'queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: true,
      trusted_model_copy_auto_approval: { enabled: true, allowed_roots: [path.join(DETAIL_LIVE_ROOT, 'models')],
        allowed_risks: ['S2', 'S3', 'S4'], max_affected_instances: 10, allow_save_model: false },
      resource_limits: { max_operations: 1000, max_affected_instances: 10, max_recursive_entities: args.recursiveLimit } },
    agentContract: { rootDir: path.join(DETAIL_LIVE_ROOT, 'agent-state') },
    sessionContract: { serverSessionId: 'detail-modeling-live-implementation' },
    mock: { sessionPath: path.join(DETAIL_LIVE_ROOT, 'offline-unused.json') } });
  let expectedPath = detailLiveModelPath(args.modelName);
  const guard = async () => {
    const info = await bridge.get_model_info({ runtime: 'queue', timeoutMs: TIMEOUT });
    if (!info.source_path || path.resolve(info.source_path) !== expectedPath) throw new Error(`Active model must be the exact independent test copy: ${expectedPath}`);
    if (await fs.realpath(path.dirname(expectedPath)) !== await fs.realpath(path.join(DETAIL_LIVE_ROOT, 'models'))) throw new Error('Test model escaped the permitted models directory');
    if (path.dirname(await fs.realpath(expectedPath)) !== await fs.realpath(path.join(DETAIL_LIVE_ROOT, 'models'))) throw new Error('Test model symlink escaped the permitted models directory');
    return info;
  };
  const fresh = async () => { await guard(); return (await bridge.create_queue_handshake({ timeoutMs: TIMEOUT })).session_contract; };
  let recursiveRoots, inspectionViews;
  const adopt = async () => {
    await guard();
    const adoption = await bridge.adopt_open_model({ runtime: 'queue', timeoutMs: TIMEOUT, recursive: true, recursive_limit: args.recursiveLimit, recursive_roots: recursiveRoots, read_only: true });
    const graph = buildModelGraph(adoption);
    if (!graph.completeness.complete && !(recursiveRoots && graph.completeness.scope_complete)) throw new Error(`Incomplete occurrence graph: ${graph.completeness.blockers.join(', ')}`);
    return { adoption, graph };
  };
  const capture = async (name, bundle, extra = []) => {
    const result = await bridge.capture_detail_views({ runtime: 'queue', timeoutMs: TIMEOUT, session_contract: await fresh(),
      views: [...(inspectionViews || bundle.views), ...extra], output_dir: path.join(dir, name) });
    await write(`${name}.json`, result);
    if (!result.restored || result.captures.some(view => !view.server_verified)) throw new Error(`${name}: native capture or restoration is unverified`);
    return result;
  };
  const reopen = async (context, designGraph) => {
    const contract = await fresh();
    const opened = await bridge.open_model({ runtime: 'queue', timeoutMs: TIMEOUT, path: context.saved_model_path, session_contract: contract });
    expectedPath = context.saved_model_path;
    await write('reopen.json', opened);
    const { adoption, graph } = await adopt();
    const reconciliation = reconcileDesignIntentGraph({ designGraph, currentModelGraph: graph });
    await write('reopen-model-graph.json', graph); await write('reopen-reconciliation.json', reconciliation);
    if (!reconciliation.aligned) throw new Error('Saved/reopened DesignIntent does not match the native model');
    await capture('reopen-captures', await json(path.join(runDir, 'next-bundle.json')));
    await write('reopen-summary.json', { evidence: 'live_runtime', aligned: true, disk_reload_verified: false,
      verification_scope: 'Active model readback after open request; closing and loading from disk requires separate evidence.', model_revision: graph.model_revision,
      model_path: adoption.model_path || context.saved_model_path, file_size_bytes: (await fs.stat(context.saved_model_path)).size,
      native_appearance: adoption.snapshot?.native_appearance || null });
  };
  if (args.action === 'reopen') {
    const context = await json(path.join(runDir, 'run-context.json'));
    expectedPath = context.saved_model_path;
    recursiveRoots = context.recursive_roots;
    inspectionViews = context.capture_views;
    await reopen(context, await json(path.join(runDir, 'design-intent-after.json')));
    console.log(JSON.stringify({ ok: true, evidence_dir: dir, model_path: expectedPath, active_model_aligned: true, disk_reload_verified: false })); return;
  }

  await guard();
  const result = await json(path.join(evidence, 'create-result.json'));
  const task = await bridge.taskStore.getTask(result.task_id, { includePrivate: true });
  const creation = task.private?.creation;
  if (!creation?.identity_map || !creation.material_map) throw new Error('The server creation identity/material map is missing');
  const sourceDir = args.sourceRun ? path.join(evidence, 'assembly', args.sourceRun) : evidence;
  const previous = await json(path.join(sourceDir, args.sourceRun ? 'next-bundle.json' : 'frozen-bundle.json'));
  const part = args.part || (previous.part_graph.roots.length === 1 ? previous.part_graph.roots[0].part_id : null);
  if (!part) throw new Error('--part is required for a multi-assembly scene');
  const next = recompileDetailedBundle(previous,{partId:part,parameters:args.parameters,associatedPartIds:args.associates});
  const rootPlacement = previous.part_graph.roots.find(root => root.part_id === part);
  if (!rootPlacement) throw new Error('Requested part is not a root assembly in the frozen bundle');
  const primaryReference = creation.identity_map[rootPlacement.instance_id || rootPlacement.part_id];
  if (!args.pairOffset) {
    const registry = await bridge.adopt_open_model({ runtime: 'queue', timeoutMs: TIMEOUT, recursive: false, read_only: true });
    const references = [primaryReference, ...args.associates.map(id => {
      const root = previous.part_graph.roots.find(root => root.part_id === id);
      if (!root) throw new Error(`Associated assembly missing: ${id}`);
      return creation.identity_map[root.instance_id || root.part_id];
    })];
    const entries = references.map(reference => {
      const matches = registry.entities.filter(entity => entity.id === reference || entity.reference === reference);
      if (matches.length !== 1) throw new Error(`Root registry cannot resolve ${reference}`);
      return matches[0];
    });
    const definition = entry => entry.entity_definition_name || entry.definition_name || entry.definition;
    const definitions = new Set(entries.map(definition));
    if (definitions.has(undefined)) throw new Error('Root definition name is required for scoped peer inspection');
    recursiveRoots = registry.entities.filter(entry => definitions.has(definition(entry))).map(entry => `pid:${entry.persistent_id}`);
    if (!recursiveRoots.length || recursiveRoots.length > 32) throw new Error('Scoped peer registry exceeds root budget');
    await write('scoped-root-registry.json', { recursive_roots: recursiveRoots, root_count: registry.entities.length, model_revision: registry.model_revision });
  }
  let state = await adopt();
  const resolveRoot = reference => {
    const found = state.graph.nodes.filter(node => node.node_type === 'occurrence' && !node.parent_id && node.entity_type === 'component_instance' && [node.reference, node.persistent_id, node.entity_path].includes(reference));
    if (found.length !== 1) throw new Error(`Root reference must resolve uniquely: ${reference}`);
    return found[0];
  };
  let primary = resolveRoot(primaryReference);
  const ref = node => ({ entity_path: node.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' });
  let peerReference = null;
  if (args.pairOffset) {
    peerReference = `${args.label}-${args.runId}-peer`;
    if (state.graph.nodes.some(node => node.reference === peerReference || node.name === peerReference)) throw new Error('Peer instance already exists');
    const originalPlacement = previous.dsl.operations.find(operation => operation.op === 'component_instance' && operation.id === (rootPlacement.instance_id || rootPlacement.part_id));
    if (!originalPlacement) throw new Error('Frozen root placement was not found');
    const peerOperation = { ...originalPlacement, id: peerReference, name: peerReference,
      definition: primary.entity_definition_name || primary.definition_name,
      origin: (originalPlacement.origin || [0, 0, 0]).map((value, axis) => value + args.pairOffset[axis]) };
    const peerPlan = await bridge.prepare_existing_model_edit({ runtime: 'queue', timeoutMs: TIMEOUT, task_id: task.task_id,
      instruction: 'Add the explicitly requested second test instance using the existing definition and frozen placement plus offset.',
      targets: [ref(primary)], operations: [peerOperation], recursive_limit: args.recursiveLimit,
      budgets: {max_operations:10,max_affected_instances:10,recursive_limit:args.recursiveLimit},
      expected_model_revision: state.graph.model_revision, output_dir: path.join(dir, 'peer-review') });
    await write('peer-prepared.json', peerPlan);
    const added = await bridge.apply_reviewed_model_edit({ runtime: 'queue', timeoutMs: TIMEOUT, plan: peerPlan.plan,
      save_model: false, output_dir: path.join(dir, 'peer-apply'), session_contract: await fresh() });
    await write('peer-applied.json', added);
    state = await adopt(); primary = resolveRoot(primaryReference);
  }
  const definition = primary.entity_definition_name || primary.definition_name;
  const sameDefinition = state.graph.nodes.filter(node => node.node_type === 'occurrence' && !node.parent_id && node.entity_type === 'component_instance' && (node.entity_definition_name || node.definition_name) === definition);
  if (args.expectedInstances !== null && sameDefinition.length !== args.expectedInstances) throw new Error(`Expected ${args.expectedInstances} instances, found ${sameDefinition.length}`);
  const selected = args.instances.length ? args.instances.map(resolveRoot) : args.scope === 'all' ? sameDefinition : [primary];
  inspectionViews = assemblyInspectionViews(previous, [...selected, ...args.associates.map(id => {
    const root = previous.part_graph.roots.find(root => root.part_id === id);
    if (!root) throw new Error(`Associated root part is missing: ${id}`);
    return resolveRoot(creation.identity_map[root.instance_id || id]);
  })]);
  const bindings = [{ binding_id: part, part_id: part, entity: ref(selected[0]), existing_targets: selected.slice(1).map(ref),
    parameter_bindings: Object.keys(args.parameters), associated_binding_ids: args.associates,
    lineage: { assembly_definition: `PG2_${part}` }, rebuild_template: [] }];
  for (const associated of args.associates) {
    const placement = previous.part_graph.roots.find(root => root.part_id === associated);
    if (!placement) throw new Error(`Associated root part is missing: ${associated}`);
    bindings.push({ binding_id: associated, part_id: associated,
      entity: ref(resolveRoot(creation.identity_map[placement.instance_id || associated])), parameter_bindings: Object.keys(args.parameters),
      lineage: { assembly_definition: `PG2_${associated}` }, rebuild_template: [] });
  }
  const parameters = Object.entries(args.parameters).map(([id, value]) => ({ id, type: typeof value,
    value: previous.brief?.parameters?.[id] ?? previous.parameter_changes?.[id] ?? previous.recipes?.[0]?.parameters?.[id] ?? null }));
  const persisted = args.sourceRun ? await json(path.join(sourceDir, 'design-intent-after.json')) : null;
  const designGraph = persisted || buildDesignIntentGraph({ modelKey: modelKeyForIdentity(modelIdentityForAdoption(state.adoption)), modelGraph: state.graph,
    parametricRecipe: { id: `${args.label}-live-edit-recipe`, version: 1, parameters }, partGraph: previous.part_graph, entityBindings: bindings });
  const savedPath = detailLiveModelPath(`${args.label}-${args.runId}.skp`);
  if (await fs.stat(savedPath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('The edited output model already exists');
  const context = { version: 'detail-assembly-live-run.v1', source_model_path: expectedPath, saved_model_path: savedPath,
    recursive_roots: recursiveRoots, creation_task_id: task.task_id, parameters: args.parameters, scope: args.scope, iteration: args.iteration,
    selected_instances: selected.map(node => ({ reference: node.reference, entity_path: node.entity_path })),
    capture_views: inspectionViews,
    peer_reference: peerReference, previous_bundle_sha256: sha256Canonical(previous), next_bundle_sha256: sha256Canonical(next) };
  await write('run-context.json', context); await write('next-bundle.json', next);
  await write('design-intent-before.json', designGraph); await write('model-graph-before.json', state.graph);
  const unselected = sameDefinition.filter(node => !selected.some(target => target.node_id === node.node_id));
  const extraViews = peerReference ? [{ id: 'peer-overview', instance_path: [peerReference], projection: 'orthographic' }] : [];
  await capture('before-captures', previous, extraViews);
  const changePlan = planDesignParameterChange({ designGraph, currentModelGraph: state.graph, changes: args.parameters,
    instruction: `Apply the explicitly requested ${args.scope} parameter change within the saved ${args.label} test model.`,
    assemblyRebuild: { previousDsl: previous.dsl, nextDsl: next.dsl, scope: args.scope, taskId: task.task_id,
      iteration: args.iteration, materialMap: creation.material_map } });
  await write('change-plan.json', changePlan);
  const prepared = await prepareAssemblyParameterEdit({ bridge, designGraph, changePlan, runtime: 'queue', timeoutMs: TIMEOUT,
    recursiveLimit: args.recursiveLimit, budgets:{max_operations:10,max_affected_instances:10,recursive_limit:args.recursiveLimit}, outputDir: dir, session_contract: await fresh() });
  await write('prepared.json', prepared);
  const applied = await applyAssemblyParameterEdit({ bridge, designGraph, changePlan, prepared, runtime: 'queue', timeoutMs: TIMEOUT,
    recursiveLimit: args.recursiveLimit, outputDir: dir, designGraphPath: path.join(dir, 'design-intent-after.json'), session_contract: await fresh() });
  await write('applied.json', applied);
  if (typeof bridge.agentGateway.recordTrustedAssemblyEditMapping !== 'function') throw new Error('Gateway trusted assembly receipt integration is not installed');
  try {
    await write('quality-path-rebinding.json', await bridge.agentGateway.recordTrustedAssemblyEditMapping({ creation_task_id: task.task_id, receipt: applied.assembly_edit_receipt }));
  } catch (error) {
    // The native edit is already committed. Preserve it as the planned new
    // derivative before reporting the failed quality handoff; never replay it
    // or turn a missing requirement into a successful quality result.
    await write('quality-path-rebinding-error.json', { code: error.code, message: error.message, native_edit_committed: true, quality_mapping_complete: false });
    const saved = await bridge.save_model({ runtime: 'queue', timeoutMs: TIMEOUT, path: savedPath, keep_session: true, session_contract: await fresh() });
    expectedPath = savedPath;
    await write('saved-after-mapping-failure.json', saved);
    throw error;
  }
  const untouched = unselected.map(before => {
    const after = applied.model_graph.nodes.find(node => node.entity_path === before.entity_path);
    const project = node => node && { definition: node.entity_definition_name, bounding_box: node.bounding_box,
      transform: node.world_transform, material: node.material, tag: node.tag, attributes: node.attributes };
    return { reference: before.reference, unchanged: sha256Canonical(project(before)) === sha256Canonical(project(after)) };
  });
  await write('unselected-instances.json', untouched);
  if (untouched.some(item => !item.unchanged)) throw new Error('An unselected sibling changed');
  await capture('after-captures', next, extraViews);
  const saved = await bridge.save_model({ runtime: 'queue', timeoutMs: TIMEOUT, path: savedPath, keep_session: true, session_contract: await fresh() });
  expectedPath = savedPath; await write('saved.json', saved);
  await reopen(context, applied.design_graph);
  console.log(JSON.stringify({ ok: true, evidence: 'live_runtime', evidence_dir: dir, model_path: savedPath,
    replaced_instances: applied.replaced_instance_count, unselected_unchanged: untouched.every(item => item.unchanged), active_model_aligned: true, disk_reload_verified: false }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseDetailAssemblyArguments(process.argv.slice(2));
  if (!args.help && args.action === 'run') await fs.mkdir(path.join(DETAIL_LIVE_ROOT, 'evidence', args.label, 'assembly'), { recursive: true });
  await runDetailAssemblyLive(args);
}
