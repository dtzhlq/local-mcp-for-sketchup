import path from 'node:path';
import { AgentContractError, sha256Canonical } from '../agent-contract.mjs';
import { prepareTaskOwnedCreationDsl, validateTaskOwnedCreationDocument } from '../agent-dsl-policy.mjs';
import { buildModelGraph } from '../model-graph.mjs';
import { adoptParameterRoots } from '../model-accessibility-scoped-readback.mjs';

export const ASSEMBLY_REBUILD_VERSION = 'versioned-assembly-rebuild.v1';
const MATERIAL_FIELDS = new Set(['material', 'back_material', 'backMaterial', 'front_material', 'frontMaterial', 'f_material', 'b_material', 'hole_material', 'holeMaterial', 'frame_material', 'frameMaterial', 'panel_material', 'panelMaterial']);
const trustedReceipts = new WeakMap();
export function isTrustedAssemblyEditReceipt(value) {
  if (!value || !trustedReceipts.has(value)) return false;
  try { return trustedReceipts.get(value) === sha256Canonical(value); } catch { return false; }
}

// Only selected assembly definitions and their dependency closure are copied.
// Every reference in the creation stage points to another new definition; the
// existing instances are touched only by the later reviewed replacement stage.
export function compileVersionedAssemblyRebuild({ previousDsl, nextDsl, selections, scope, taskId, iteration = 0, materialMap = {} } = {}) {
  if (!['single', 'all'].includes(scope)) throw new Error('assemblyRebuild.scope must explicitly be single or all');
  if (!Array.isArray(selections) || !selections.length) throw new Error('Assembly rebuild requires selected instances');
  const previous = definitionIndex(previousDsl), next = definitionIndex(nextDsl);
  const emitted = new Set(), visiting = new Set(), operations = [];
  const emit = (name) => {
    if (emitted.has(name)) return;
    if (visiting.has(name)) throw new Error(`Assembly definition cycle: ${name}`);
    const definition = next.get(name);
    if (!definition) throw new Error(`Recompiled assembly definition missing: ${name}`);
    visiting.add(name);
    for (const operation of definition.operations || []) if (operation.op === 'component_instance') emit(operation.definition);
    operations.push(structuredClone(definition));
    visiting.delete(name); emitted.add(name);
  };
  for (const selection of selections) {
    if (!previous.has(selection.logical_definition)) throw new Error(`Previous assembly definition missing: ${selection.logical_definition}`);
    emit(selection.logical_definition);
  }
  if (selections.every(selection => definitionClosureHash(previous, selection.logical_definition) === definitionClosureHash(next, selection.logical_definition))) {
    throw new Error('Assembly parameters did not change any selected definition');
  }
  if (!materialMap || typeof materialMap !== 'object' || Array.isArray(materialMap) || Object.values(materialMap).some(value => typeof value !== 'string' || !value)) throw new Error('assemblyRebuild.materialMap must map logical names to existing material names');
  const remap = (operation) => {
    const result = structuredClone(operation);
    for (const field of MATERIAL_FIELDS) {
      if (result[field] === undefined || result[field] === null) continue;
      if (typeof result[field] !== 'string') throw new Error('Assembly rebuild may only reference existing material names');
      result[field] = materialMap[result[field]] || result[field];
    }
    if (result.operations) result.operations = result.operations.map(remap);
    return result;
  };
  const creation = prepareTaskOwnedCreationDsl(JSON.stringify({ version: 1, units: 'mm', operations: operations.map(remap) }), { taskId, iteration });
  const definitionMap = Object.fromEntries(operations.map((operation, index) => [operation.name, creation.document.operations[index].name]));
  const replacements = selections.map(selection => ({
    ...structuredClone(selection), replacement_definition: definitionMap[selection.logical_definition]
  }));
  return {
    version: ASSEMBLY_REBUILD_VERSION, scope, task_id: taskId, iteration,
    creation_document: creation.document, creation_sha256: sha256Canonical(creation.document),
    definition_map: definitionMap, identity_map: creation.identity_map, material_map: structuredClone(materialMap), replacements,
    operations: replacements.map(entry => ({ op: 'replace_component_definition', ...entry.target, definition: entry.replacement_definition })),
    changed_definitions: [...emitted].filter(name => !previous.has(name) || sha256Canonical(previous.get(name)) !== sha256Canonical(next.get(name))),
    copied_definition_count: emitted.size,
    permission: 'fresh_resources_only_then_trusted_reviewed_existing_model_edit',
    source_dsl_hash: sha256Canonical(previousDsl), next_dsl_hash: sha256Canonical(nextDsl)
  };
}

export function validateAssemblyMaterialReferences(document, modelGraph) {
  const existing = new Set((modelGraph.catalogs?.materials || []).map(material => typeof material === 'string' ? material : material.name));
  const visit = (operations) => {
    for (const operation of operations) {
      for (const field of MATERIAL_FIELDS) {
        if (operation[field] === undefined || operation[field] === null) continue;
        if (typeof operation[field] !== 'string' || !existing.has(operation[field])) throw new AgentContractError('OPERATION_NOT_ALLOWED', `Assembly material reference must already exist; supply the creation materialMap: ${String(operation[field])}`);
      }
      if (operation.operations) visit(operation.operations);
    }
  };
  visit(document.operations);
}

function definitionIndex(dsl) {
  if (!dsl || !Array.isArray(dsl.operations)) throw new Error('Assembly rebuild requires previousDsl and nextDsl documents');
  const result = new Map();
  for (const operation of dsl.operations) {
    if (operation.op !== 'component_definition') continue;
    if (!operation.name || result.has(operation.name)) throw new Error('Assembly definition names must be unique');
    result.set(operation.name, operation);
  }
  return result;
}

function definitionClosureHash(index, root, stack = []) {
  if (stack.includes(root)) throw new Error(`Assembly definition cycle: ${root}`);
  const definition = index.get(root);
  if (!definition) throw new Error(`Assembly definition missing: ${root}`);
  return sha256Canonical({ definition, dependencies: (definition.operations || []).filter(operation => operation.op === 'component_instance')
    .map(operation => definitionClosureHash(index, operation.definition, [...stack, root])) });
}

function verifyChangePlan(designGraph, changePlan) {
  const stage = changePlan?.assembly_rebuild;
  if (stage?.version !== ASSEMBLY_REBUILD_VERSION || changePlan.blockers?.length || changePlan.divergence?.length) throw new Error('A ready versioned assembly change plan is required');
  if (designGraph?.design_graph_id !== changePlan.design_graph_id || designGraph.model_key !== changePlan.model_key) throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'Assembly change is not bound to this design graph');
  const { change_plan_id, next_action, ...core } = changePlan;
  if (change_plan_id !== `design-change-${sha256Canonical(core).slice(7, 31)}`) throw new AgentContractError('PLAN_HASH_MISMATCH', 'Assembly change plan was modified');
  if (sha256Canonical(stage.creation_document) !== stage.creation_sha256) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Assembly creation document was modified');
  validateTaskOwnedCreationDocument(stage.creation_document);
  if (sha256Canonical(changePlan.operations) !== sha256Canonical(stage.operations)) throw new AgentContractError('PLAN_HASH_MISMATCH', 'Assembly replacement operations differ from compiled stage');
  return stage;
}

async function currentGraph(bridge, runtime, timeoutMs, recursiveLimit, recursiveRoots) {
  const graph = buildModelGraph(recursiveRoots?.length > 1
    ? await adoptParameterRoots({ bridge, runtime, timeoutMs, recursiveLimit, rootPaths: recursiveRoots })
    : await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, recursive_limit: recursiveLimit, recursive_roots: recursiveRoots, read_only: true }));
  if (!graph.completeness?.complete && !(recursiveRoots && graph.completeness?.scope_complete)) throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Assembly edit verification requires a complete occurrence graph; increase recursiveLimit');
  return graph;
}

// Stage 1 creates unused fresh definitions. It cannot authorize stage 2, which
// returns the existing server-bound review challenge. No token is minted here.
export async function prepareAssemblyParameterEdit({ bridge, designGraph, changePlan, runtime = 'mock', timeoutMs, outputDir,
  recursiveLimit = 5000, budgets, session_contract, sessionContract } = {}) {
  const stage = verifyChangePlan(designGraph, changePlan);
  const before = await currentGraph(bridge, runtime, timeoutMs, recursiveLimit, changePlan.recursive_roots);
  if (before.model_revision !== changePlan.model_revision) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed before assembly staging');
  validateAssemblyMaterialReferences(stage.creation_document, before);
  const { compareDesignBindingFingerprints } = await import('../design-intent-graph.mjs');
  if (compareDesignBindingFingerprints(designGraph, before).length) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Manual assembly changes require reconciliation');
  const creation = await bridge.build_model({ runtime, timeoutMs, code: JSON.stringify(stage.creation_document), session_contract, sessionContract });
  const staged = await currentGraph(bridge, runtime, timeoutMs, recursiveLimit, changePlan.recursive_roots);
  if (compareDesignBindingFingerprints(designGraph, staged).length) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'An existing assembly changed during fresh definition staging');
  const preparedEdit = await bridge.prepare_existing_model_edit({ runtime, timeoutMs,
    instruction: changePlan.instruction.value, targets: changePlan.targets, operations: changePlan.operations,
    recursive_limit: recursiveLimit, recursive_roots: changePlan.recursive_roots, budgets, expected_model_revision: staged.model_revision, task_id: stage.task_id,
    output_dir: outputDir ? path.join(outputDir, 'review') : undefined });
  return {
    kind: 'prepare_assembly_parameter_edit', change_plan_id: changePlan.change_plan_id,
    model_revision_before: before.model_revision, model_revision_staged: staged.model_revision,
    creation_sha256: stage.creation_sha256, staged_definitions: [...stage.creation_document.creation_scope.definitions],
    creation_receipt: creation.mutation_receipt || null, prepared_edit: preparedEdit,
    next_action: 'apply_reviewed_assembly_parameter_edit_with_existing_approval_authority'
  };
}

// Approval and stale-model enforcement remain entirely in apply_reviewed_model_edit.
// The subsequent readback refreshes persisted DesignIntent bindings, including
// their assembly-subtree fingerprints, before another parameter edit is possible.
export async function applyAssemblyParameterEdit({ bridge, designGraph, changePlan, prepared, approval_token,
  runtime = 'mock', timeoutMs, outputDir, recursiveLimit = 5000, save_model = false, save_path,
  designGraphPath, session_contract, sessionContract } = {}) {
  const stage = verifyChangePlan(designGraph, changePlan);
  const reviewedPlan = prepared?.prepared_edit?.plan;
  if (prepared?.change_plan_id !== changePlan.change_plan_id || prepared.creation_sha256 !== stage.creation_sha256 || !reviewedPlan) throw new AgentContractError('PLAN_HASH_MISMATCH', 'Assembly review is not bound to this change');
  if (sha256Canonical(reviewedPlan.dsl_document.operations) !== sha256Canonical(changePlan.operations)) throw new AgentContractError('PLAN_HASH_MISMATCH', 'Reviewed operations differ from the assembly replacements');
  const applied = await bridge.apply_reviewed_model_edit({ runtime, timeoutMs, plan: reviewedPlan, approval_token,
    save_model, save_path, session_contract, sessionContract, output_dir: outputDir ? path.join(outputDir, 'apply') : undefined });
  const modelGraph = await currentGraph(bridge, runtime, timeoutMs, recursiveLimit, changePlan.recursive_roots);
  return finalizeAssemblyReadback({ designGraph, changePlan, applied, modelGraph, runtime, designGraphPath, recursiveLimit });
}

// This entry has no caller-supplied receipt: it reads and verifies the existing
// server ledger and its bound reviewed plan before issuing an in-process brand.
// It performs no geometry mutation and is safe to retry after finalization loss.
export async function finalizeAssemblyParameterEditFromLedger({ bridge, reviewedTaskId, designGraph, changePlan, runtime = 'mock', timeoutMs, recursiveLimit = 5000, designGraphPath } = {}) {
  verifyChangePlan(designGraph, changePlan);
  const ledger = await bridge.taskStore.loadTaskMutationReceipt(reviewedTaskId);
  const reviewed = await bridge.taskStore.getTask(reviewedTaskId, { includePrivate: true });
  const plan = reviewed.private?.existing_edit_plan;
  if (reviewed.intent !== 'reviewed_existing_model_edit' || !plan || ledger.plan_id !== plan.plan_id || ledger.plan_hash !== plan.plan_hash
    || ledger.model_key !== designGraph.model_key || ledger.runtime !== runtime || ledger.model_revision_before !== plan.model_revision
    || sha256Canonical(plan.dsl_document.operations) !== sha256Canonical(changePlan.operations)) {
    throw new AgentContractError('MUTATION_RECEIPT_INVALID', 'Reviewed ledger does not authorize these exact assembly replacements.');
  }
  const modelGraph = await currentGraph(bridge, runtime, timeoutMs, recursiveLimit, changePlan.recursive_roots);
  if (modelGraph.model_revision !== ledger.model_revision_after) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed after the durably recorded assembly edit.');
  return finalizeAssemblyReadback({ designGraph, changePlan, applied: ledger.finalizer.applied_result, modelGraph, runtime, designGraphPath, recursiveLimit });
}

async function finalizeAssemblyReadback({ designGraph, changePlan, applied, modelGraph, runtime, designGraphPath, recursiveLimit }) {
  const stage = verifyChangePlan(designGraph, changePlan);
  const selectedRoots = [];
  for (const replacement of stage.replacements) {
    const matches = modelGraph.nodes.filter(node => node.node_type === 'occurrence' && (replacement.target.entity_path
      ? node.entity_path === replacement.target.entity_path : node.reference === replacement.target.target_id));
    if (matches.length !== 1 || (matches[0].entity_definition_name || matches[0].definition_name) !== replacement.replacement_definition) throw new Error('Assembly replacement readback did not preserve the selected instance identity and new definition');
    const root = matches[0], byId = new Map(modelGraph.nodes.map(node => [node.node_id, node]));
    const occurrences = modelGraph.nodes.filter(node => node.node_type === 'occurrence' && ['group', 'component_instance'].includes(node.entity_type)).flatMap(node => {
      const chain = [], visited = new Set();
      let cursor = node;
      while (cursor && !visited.has(cursor.node_id)) {
        visited.add(cursor.node_id); chain.unshift(cursor.reference || cursor.persistent_id);
        if (cursor.node_id === root.node_id) return [{ instance_path: chain, entity_path: node.entity_path }];
        cursor = byId.get(cursor.parent_id);
      }
      return [];
    });
    selectedRoots.push({ reference: root.reference, entity_path: root.entity_path, logical_definition: replacement.logical_definition,
      replacement_definition: replacement.replacement_definition, occurrences });
  }
  const { reconcileDesignIntentGraph, acceptReconciliation, writeDesignArtifact } = await import('../design-intent-graph.mjs');
  const reconciliation = reconcileDesignIntentGraph({ designGraph, currentModelGraph: modelGraph, acceptedChangePlan: changePlan });
  if (reconciliation.unexpected_divergence.length) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Unselected bound objects changed during assembly replacement');
  const updatedDesignGraph = acceptReconciliation({ designGraph, currentModelGraph: modelGraph, reconciliation,
    decision: 'accept_reviewed_parameter_change', acceptedChangePlan: changePlan });
  if (designGraphPath) await writeDesignArtifact(designGraphPath, updatedDesignGraph);
  const receipt = { version: 'assembly-edit-receipt.v1', runtime, change_plan_id: changePlan.change_plan_id,
    model_revision_before: changePlan.model_revision, model_revision_after: modelGraph.model_revision,
    recursive_limit: recursiveLimit,
    ...(changePlan.recursive_roots ? { recursive_roots: structuredClone(changePlan.recursive_roots) } : {}),
    identity_map: structuredClone(stage.identity_map), material_map: structuredClone(stage.material_map), selected_roots: selectedRoots };
  trustedReceipts.set(receipt, sha256Canonical(receipt));
  return { kind: 'apply_assembly_parameter_edit', applied, reconciliation, design_graph: updatedDesignGraph,
    model_graph: modelGraph, scope: stage.scope, replaced_instance_count: stage.replacements.length,
    design_graph_path: designGraphPath || null, assembly_edit_receipt: receipt };
}
