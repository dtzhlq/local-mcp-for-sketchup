import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AgentContractError,
  serverPolicyAutoApprovalMode,
  sha256Canonical,
  trustedModelCopyAutoApprovalBinding
} from './agent-contract.mjs';
import { AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS, prepareAgentGatewayCreationDsl } from './agent-dsl-policy.mjs';
import { validateExpertDocument } from './expert-compiler.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { normalizeTextureTransform } from './object-operation-utils.mjs';
import { validateNativeAssetOperation } from './model-accessibility-asset-edit.mjs';
import { adoptParameterRoots } from './model-accessibility-scoped-readback.mjs';

export const EXISTING_MODEL_EDIT_PLAN_VERSION = '2026-07-existing-model-edit-plan.3';
export const EXISTING_MODEL_EDIT_EXECUTION_TARGET_VALIDATION_VERSION = 'existing-edit-execution-target-validation.v1';

const RISK_BY_OPERATION = Object.freeze({
  ...Object.fromEntries(AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS.map((operation) => [operation, 'S3'])),
  material: 'S2',
  attribute: 'S1',
  remove_attribute: 'S1',
  assign_tag: 'S1',
  classification: 'S1',
  texture_transform: 'S1',
  set_material: 'S1',
  set_face_material: 'S1',
  set_visibility: 'S1',
  set_edge_properties: 'S1',
  rename: 'S2',
  transform_object: 'S2',
  duplicate_entity: 'S2',
  replace_component_definition: 'S2',
  place_component_asset: 'S3',
  replace_component_asset: 'S3',
  reverse_face: 'S3',
  pushpull_face: 'S3',
  transform_entities: 'S3',
  erase_entities: 'S4',
  delete: 'S4',
  explode_entity: 'S4',
  cut_hole: 'S3',
  cut_slot: 'S3',
  cut_recess: 'S3',
  add_boss: 'S3',
  add_raised_rib: 'S3',
  boolean_union: 'S3',
  boolean_difference: 'S3',
  boolean_intersect: 'S3',
  manifold_repair: 'S3',
  manifold_check: 'S1'
});

const RISK_ORDER = Object.freeze({ S1: 1, S2: 2, S3: 3, S4: 4 });
const CONFIRMED_OPERATIONS = new Set(['delete', 'reverse_face', 'pushpull_face', 'replace_component_definition', 'place_component_asset', 'replace_component_asset', 'explode_entity', 'erase_entities', 'transform_entities']);
const ADDITIVE_CREATION_OPERATIONS = new Set(AGENT_GATEWAY_ADDITIVE_CREATION_OPERATIONS);
const RESOURCE_MUTATION_OPERATIONS = new Set(['material']);
const MULTI_TARGET_OPERATIONS = new Set(['erase_entities']);
const STRUCTURAL_GROUP_PREPARATION_OPERATIONS = new Set([
  'attribute',
  'remove_attribute',
  'assign_tag',
  'classification',
  'texture_transform',
  'set_material',
  'set_visibility',
  'rename',
  'transform_object'
]);
const TOP_LEVEL_GROUP_EXECUTION_OPERATIONS = new Set([
  ...STRUCTURAL_GROUP_PREPARATION_OPERATIONS,
  'delete'
]);
const POST_MUTATION_TARGET_VALIDATION_PHASES = new Set([
  'iteration_after',
  'gateway_post_apply',
  'finalization'
]);
const CANONICAL_PID_PATH_PATTERN = /^pid:[1-9]\d*(?:\.[1-9]\d*)*$/;

export function existingModelEditRiskForOperation(operation) {
  return RISK_BY_OPERATION[operation] || 'S4';
}

export function canPrepareExistingModelEditFromStructuralGroups({ operations, targets } = {}) {
  if (!Array.isArray(operations) || operations.length === 0 || !Array.isArray(targets) || targets.length === 0) return false;
  if (!operations.every((operation) => operation && STRUCTURAL_GROUP_PREPARATION_OPERATIONS.has(operation.op))) return false;
  return targets.every((target) => target
    && typeof target === 'object'
    && typeof target.entity_path === 'string'
    && CANONICAL_PID_PATH_PATTERN.test(target.entity_path));
}

export function existingModelEditExecutionTargetValidationPolicy(plan) {
  const validation = plan?.target_validation;
  const operations = plan?.dsl_document?.operations;
  const targets = Array.isArray(plan?.targets)
    ? plan.targets.map(({ entity, ...target }) => target)
    : [];
  const structuralEligible = validation?.version === 'existing-edit-target-validation.v1'
    && validation.mode === 'structural_groups'
    && validation.source === 'server_bound_source_proposal'
    && validation.projection_version === 'structural-groups.v1'
    && validation.exact_targets_verified === true
    && validation.sufficient_for_review === true
    && validation.requested_target_count === targets.length
    && validation.exact_target_count === targets.length
    && Number.isInteger(validation.structural_group_limit)
    && validation.structural_group_limit >= 1
    && validation.structural_group_limit <= 5000
    && Boolean(plan?.source_proposal)
    && canPrepareExistingModelEditFromStructuralGroups({ operations, targets })
    && plan.targets.every((target) => target.entity?.entity_type === 'group')
    && targets.every((target) => target.instance_policy !== 'make_unique');
  const declaredTargetIdentities = new Set(targets.map(targetIdentity));
  const topLevelGroupPlanEligible = validation?.version === 'existing-edit-target-validation.v1'
    && validation.mode === 'full_recursive'
    && validation.complete === true
    && validation.truncated === false
    && validation.sufficient_for_review === true
    && validation.requested_target_count === targets.length
    && validation.exact_target_count === targets.length
    && targets.length > 0
    && plan.targets.every((target) => target.entity?.entity_type === 'group')
    && targets.every((target) => typeof target.entity_path === 'string'
      && /^pid:[1-9]\d*$/.test(target.entity_path)
      && target.instance_policy !== 'make_unique')
    && Array.isArray(operations)
    && operations.length > 0
    && operations.every((operation) => {
      const primaryTarget = operationTargetReference(operation);
      const noAuxiliaryTargets = operationAuxiliaryTargetReferences(operation).length === 0;
      if ((ADDITIVE_CREATION_OPERATIONS.has(operation?.op)
        || RESOURCE_MUTATION_OPERATIONS.has(operation?.op)) && primaryTarget === null) {
        return noAuxiliaryTargets;
      }
      return TOP_LEVEL_GROUP_EXECUTION_OPERATIONS.has(operation?.op)
        && primaryTarget !== null
        && declaredTargetIdentities.has(targetIdentity(primaryTarget))
        && noAuxiliaryTargets;
    });
  return structuralEligible || topLevelGroupPlanEligible
    ? {
      version: EXISTING_MODEL_EDIT_EXECUTION_TARGET_VALIDATION_VERSION,
      mode: 'structural_groups',
      source: structuralEligible
        ? 'hash_bound_server_proposal'
        : 'hash_bound_top_level_group_plan',
      structural_group_limit: structuralEligible ? validation.structural_group_limit : 5000,
      leaf_entities_materialized: false
    }
    : {
      version: EXISTING_MODEL_EDIT_EXECUTION_TARGET_VALIDATION_VERSION,
      mode: 'full_recursive',
      source: validation?.mode === 'structural_groups'
        ? 'conservative_full_recursive_fallback'
        : 'hash_bound_reviewed_plan',
      leaf_entities_materialized: true
    };
}

export async function observeExistingModelEditExecutionState({
  bridge,
  plan,
  runtime = plan?.runtime || 'mock',
  timeoutMs,
  phase = 'apply_preflight',
  expected_model_key,
  expected_model_revision
} = {}) {
  if (!bridge) throw new Error('existing model edit execution observation requires a bridge');
  validatePlan(plan);
  const policy = existingModelEditExecutionTargetValidationPolicy(plan);
  const adoption = policy.mode === 'structural_groups'
    ? await bridge.adopt_open_model({
      runtime,
      timeoutMs,
      recursive: false,
      read_only: true,
      structural_groups: true,
      structural_group_limit: policy.structural_group_limit
    })
    : plan.target_validation?.recursive_root_paths?.length > 1
      ? await adoptParameterRoots({ bridge, runtime, timeoutMs, recursiveLimit: plan.budgets?.recursive_limit || 2000, rootPaths: plan.target_validation.recursive_root_paths })
      : await bridge.adopt_open_model({
      runtime,
      timeoutMs,
      recursive: true,
      recursive_limit: plan.budgets?.recursive_limit || 2000,
      recursive_roots: plan.target_validation?.recursive_root_paths,
      read_only: true
    });
  const modelRevision = modelRevisionForAdoption(adoption);
  const modelKey = modelKeyForIdentity(modelIdentityForAdoption(adoption));
  if (expected_model_key && modelKey !== expected_model_key) {
    throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The active model identity differs from the reviewed plan.', {
      details: { expected_model_key, actual_model_key: modelKey, phase }
    });
  }
  if (expected_model_revision && modelRevision !== expected_model_revision) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The active model revision differs from the reviewed plan.', {
      details: { expected: expected_model_revision, actual: modelRevision, phase }
    });
  }

  const requestedTargets = plan.targets.map(({ entity, ...target }) => target);
  const indexed = indexedAdoptionTargets(adoption);
  const sideEffectTargets = destructiveSideEffectTargets(plan);
  const validationTargets = uniqueTargets([...requestedTargets, ...sideEffectTargets]);
  const exactTargets = validationTargets.filter((target) => indexed.has(targetIdentity(target)));
  const postMutationValidation = POST_MUTATION_TARGET_VALIDATION_PHASES.has(phase);
  const expectedAbsentTargetIds = postMutationValidation
    ? directDeleteTargetIdentities(plan)
    : new Set();
  const expectedPresentTargets = postMutationValidation
    ? requestedTargets.filter((target) => !expectedAbsentTargetIds.has(targetIdentity(target)))
    : validationTargets;
  const expectedAbsentTargets = postMutationValidation
    ? uniqueTargets([
      ...requestedTargets.filter((target) => expectedAbsentTargetIds.has(targetIdentity(target))),
      ...sideEffectTargets
    ])
    : [];
  const missingExpectedPresentTargets = expectedPresentTargets.filter((target) => !indexed.has(targetIdentity(target)));
  const remainingExpectedAbsentTargets = expectedAbsentTargets.filter((target) => indexed.has(targetIdentity(target)));
  const targetPostconditionsVerified = missingExpectedPresentTargets.length === 0
    && remainingExpectedAbsentTargets.length === 0;
  const lockedTargets = expectedPresentTargets.filter((target) => indexed.get(targetIdentity(target))?.effective_locked === true);
  if (!targetPostconditionsVerified && (policy.mode === 'structural_groups' || adoption.recursive_truncated !== true)) {
    throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'The bounded execution probe did not satisfy every hash-bound Group target postcondition.', {
      details: {
        phase,
        requested_target_count: requestedTargets.length,
        exact_target_count: exactTargets.length,
        expected_present_target_count: expectedPresentTargets.length,
        missing_expected_present_target_count: missingExpectedPresentTargets.length,
        expected_absent_target_count: expectedAbsentTargets.length,
        remaining_expected_absent_target_count: remainingExpectedAbsentTargets.length
      }
    });
  }
  if (policy.mode === 'structural_groups' && lockedTargets.length > 0) {
    throw new AgentContractError('POLICY_DENIED', 'A hash-bound Group target is locked at execution time.', {
      details: { phase, locked_target_count: lockedTargets.length }
    });
  }
  const summary = {
    phase,
    mode: policy.mode,
    model_key: modelKey,
    model_revision: modelRevision,
    requested_target_count: requestedTargets.length,
    destructive_side_effect_target_count: sideEffectTargets.length,
    exact_target_count: exactTargets.length,
    exact_targets_verified: targetPostconditionsVerified,
    locked_target_count: lockedTargets.length,
    leaf_entities_materialized: policy.leaf_entities_materialized,
    recursive_indexed: Array.isArray(adoption.recursive_index) ? adoption.recursive_index.length : 0,
    recursive_truncated: adoption.recursive_truncated === true,
    ...(expectedAbsentTargets.length ? {
      expected_present_target_count: expectedPresentTargets.length,
      expected_absent_target_count: expectedAbsentTargets.length,
      verified_absent_target_count: expectedAbsentTargets.length - remainingExpectedAbsentTargets.length,
      target_postconditions_verified: targetPostconditionsVerified
    } : {}),
    ...(policy.mode === 'structural_groups' ? { structural_group_limit: policy.structural_group_limit } : {})
  };
  return { adoption, policy, summary };
}

function directDeleteTargetIdentities(plan) {
  const declaredTargetIds = new Set((plan?.targets || []).map(targetIdentity));
  return new Set((plan?.dsl_document?.operations || [])
    .filter((operation) => operation?.op === 'delete')
    .map(operationTargetReference)
    .filter((target) => target && declaredTargetIds.has(targetIdentity(target)))
    .map(targetIdentity));
}

function destructiveSideEffectTargets(plan) {
  return (plan?.destructive_side_effects?.expected_absent_targets || []).map((target) => ({
    entity_path: target.entity_path,
    edit_scope: target.edit_scope || 'instance_path',
    instance_policy: target.instance_policy || 'definition_wide'
  }));
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const identity = targetIdentity(target);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function validateExistingModelEditOperations(operations) {
  const normalizedOperations = normalizeOperations(operations);
  const operationContracts = normalizedOperations.map((operation, index) => ({
    index,
    op: operation.op,
    risk: existingModelEditRiskForOperation(operation.op),
    destructive: ['delete', 'erase_entities', 'explode_entity'].includes(operation.op),
    topology: ['reverse_face', 'pushpull_face', 'transform_entities', 'erase_entities', 'cut_hole', 'cut_slot', 'cut_recess', 'add_boss', 'add_raised_rib', 'boolean_union', 'boolean_difference', 'boolean_intersect', 'manifold_repair'].includes(operation.op),
    resource_mutation: RESOURCE_MUTATION_OPERATIONS.has(operation.op),
    resource_scope: operation.op === 'material' ? 'model_material_definition' : null
  }));
  const riskLevel = operationContracts.reduce(
    (highest, contract) => RISK_ORDER[contract.risk] > RISK_ORDER[highest] ? contract.risk : highest,
    'S1'
  );
  return {
    operations: normalizedOperations,
    operation_contracts: operationContracts,
    risk_level: riskLevel,
    expert_validation_document: {
      version: 1,
      units: 'mm',
      operations: normalizedOperations.map((operation) => CONFIRMED_OPERATIONS.has(operation.op)
        ? { ...structuredClone(operation), confirmed: true }
        : structuredClone(operation))
    }
  };
}

export function inferExistingModelEditDestructiveSideEffects({ adoption, operations } = {}) {
  const entries = [
    ...(adoption?.recursive_index || []),
    ...(adoption?.structural_groups?.entries || [])
  ];
  const byPath = new Map();
  for (const entry of entries) {
    const entityPath = entry?.entity_path || entry?.path;
    if (typeof entityPath === 'string' && entityPath) byPath.set(entityPath, entry);
  }
  const childrenByParent = new Map();
  for (const [entityPath, entry] of byPath) {
    const parentPath = entry.parent_entity_path || parentOccurrencePath(entityPath);
    if (!parentPath) continue;
    if (!childrenByParent.has(parentPath)) childrenByParent.set(parentPath, []);
    childrenByParent.get(parentPath).push(entityPath);
  }
  const directDeletes = new Set((operations || [])
    .filter((operation) => operation?.op === 'delete')
    .map((operation) => operation.entity_path || operation.entityPath || operation.target_path || operation.targetPath)
    .filter((entityPath) => typeof entityPath === 'string' && entityPath));
  const removed = new Set(directDeletes);
  const cascades = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const removedPath of [...removed]) {
      const removedEntry = byPath.get(removedPath);
      const parentPath = removedEntry?.parent_entity_path || parentOccurrencePath(removedPath);
      const parent = byPath.get(parentPath);
      if (!parentPath || !parent || removed.has(parentPath) || parent.entity_type !== 'group') continue;
      const directChildren = childrenByParent.get(parentPath) || [];
      const directGeometryIsEmpty = [parent.faces, parent.edges, parent.vertices]
        .every((value) => Number.isInteger(value) && value === 0);
      if (!directGeometryIsEmpty || directChildren.length === 0 || !directChildren.every((child) => removed.has(child))) continue;
      removed.add(parentPath);
      cascades.set(parentPath, {
        entity_path: parentPath,
        parent_entity_path: parent.parent_entity_path || parentOccurrencePath(parentPath),
        edit_scope: 'instance_path',
        instance_policy: 'definition_wide',
        reason: 'sketchup_empty_group_cleanup',
        postcondition: 'absent_after_commit',
        caused_by_absent_children: [...directChildren].sort(),
        entity: summarizeIndexedTarget(parent)
      });
      changed = true;
    }
  }
  return {
    version: 'existing-model-edit-destructive-side-effects.v1',
    inference: 'server_adoption_index',
    content_trust: 'trusted_server_projection',
    expected_absent_targets: [...cascades.values()].sort((left, right) => left.entity_path.localeCompare(right.entity_path))
  };
}

export async function prepareExistingModelEdit({ bridge, runtime = 'mock', timeoutMs, instruction, operations, targets, output_dir, recursive_limit = 2000, recursive_roots, budgets = {}, task_id = null, approval_expires_ms, source_proposal_binding, expected_model_revision, expected_model_key, execution_contract, target_validation } = {}) {
  if (!bridge) throw new Error('prepare_existing_model_edit requires a bridge');
  const normalizedInstruction = nonEmptyString(instruction, 'prepare_existing_model_edit.instruction');
  const operationValidation = validateExistingModelEditOperations(operations);
  const normalizedOperations = operationValidation.operations;
  if (runtime !== 'queue' && normalizedOperations.some(operation => ['place_component_asset', 'replace_component_asset'].includes(operation.op))) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Native SKP assets are unsupported by mock runtime.');
  const normalizedBudgets = normalizeBudgets({
    ...budgets,
    recursive_limit: budgets.recursive_limit ?? budgets.recursiveLimit ?? recursive_limit
  }, bridge.executionPolicy.resource_limits);
  if (normalizedOperations.length > normalizedBudgets.max_operations) throw new Error('existing model edit exceeds budgets.max_operations');

  const requestedTargets = normalizeTargets(targets, normalizedOperations);
  const normalizedTargetValidation = normalizePreparationTargetValidation(target_validation, {
    sourceProposalBinding: source_proposal_binding,
    operations: normalizedOperations,
    targets: requestedTargets
  });
  const adoption = normalizedTargetValidation.mode === 'structural_groups'
    ? await bridge.adopt_open_model({
      runtime,
      timeoutMs,
      recursive: false,
      read_only: true,
      structural_groups: true,
      structural_group_limit: normalizedTargetValidation.structural_group_limit
    })
    : recursive_roots?.length > 1
      ? await adoptParameterRoots({ bridge, runtime, timeoutMs, recursiveLimit: normalizedBudgets.recursive_limit, rootPaths: recursive_roots })
      : await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, recursive_limit: normalizedBudgets.recursive_limit, recursive_roots, read_only: true });
  const indexed = indexedAdoptionTargets(adoption);
  const blockers = [];
  if (recursive_roots && (normalizedOperations.some(operation => operation.op !== 'replace_component_definition') || requestedTargets.some(target => { const matches = (adoption.recursive_index || []).filter(entry => recursive_roots.includes(entry.entity_path) && (target.entity_path ? entry.entity_path === target.entity_path : [entry.id, entry.reference, entry.persistent_id].includes(target.target_id))); return matches.length !== 1; }))) throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Scoped assembly review permits only replacements of the explicitly indexed root instances');
  if (normalizedTargetValidation.mode === 'full_recursive' && adoption.recursive_truncated) {
    blockers.push({ code: 'recursive_index_truncated', message: 'Recursive entity index was truncated; increase recursive_limit before review.' });
  }
  for (const target of requestedTargets) {
    const indexedTarget = indexed.get(targetIdentity(target));
    if (!indexedTarget) blockers.push({ code: 'target_not_indexed', target: publicTargetReference(target), message: 'Target is not present in the current adoption index.' });
    else if (indexedTarget.effective_locked === true) blockers.push({ code: 'target_locked', target: publicTargetReference(target), locked_ancestor_path: indexedTarget.locked_ancestor_path || null, message: 'The target or one of its occurrence ancestors is locked.' });
  }
  const declaredTargetIds = new Set(requestedTargets.map(targetIdentity));
  for (const [index, operation] of normalizedOperations.entries()) {
    if (ADDITIVE_CREATION_OPERATIONS.has(operation.op) || RESOURCE_MUTATION_OPERATIONS.has(operation.op) || operation.op === 'place_component_asset') continue;
    const primaryTarget = operationTargetReference(operation);
    const auxiliaryTargets = operationAuxiliaryTargetReferences(operation);
    if (!primaryTarget && !MULTI_TARGET_OPERATIONS.has(operation.op)) {
      blockers.push({ code: 'operation_target_missing', operation_index: index, op: operation.op, message: 'Every reviewed existing-model operation must declare its target.' });
      continue;
    }
    if (primaryTarget) {
      const primaryId = targetIdentity(primaryTarget);
      if (!declaredTargetIds.has(primaryId)) {
        blockers.push({ code: 'operation_target_not_declared', operation_index: index, op: operation.op, target: publicTargetReference(primaryTarget), message: 'The operation target is not present in the reviewed target set.' });
      }
      const indexedTarget = indexed.get(primaryId);
      if (indexedTarget && Array.isArray(indexedTarget.allowed_operations) && !(operation.op === 'replace_component_asset' ? indexedTarget.allowed_operations.includes('replace_component_definition') : indexedTarget.allowed_operations.includes(operation.op))) {
        blockers.push({ code: 'operation_not_allowed_for_target', operation_index: index, op: operation.op, target: publicTargetReference(primaryTarget), message: 'The operation is not allowed for this indexed entity type.' });
      }
    }
    if (MULTI_TARGET_OPERATIONS.has(operation.op) && auxiliaryTargets.length === 0) {
      blockers.push({ code: 'operation_target_missing', operation_index: index, op: operation.op, message: 'The multi-target operation must declare at least one reviewed target.' });
    }
    for (const auxiliaryTarget of auxiliaryTargets) {
      if (!declaredTargetIds.has(targetIdentity(auxiliaryTarget))) {
        blockers.push({ code: 'operation_auxiliary_target_not_declared', operation_index: index, op: operation.op, target: publicTargetReference(auxiliaryTarget), message: 'An operation tool or auxiliary target is not present in the reviewed target set.' });
      }
    }
  }
  const destructiveSideEffects = inferExistingModelEditDestructiveSideEffects({
    adoption,
    operations: normalizedOperations
  });
  const affectedTargets = uniqueTargets([
    ...requestedTargets,
    ...destructiveSideEffects.expected_absent_targets
  ]);
  const affectedInstances = affectedTargets.reduce((sum, target) => sum + Number(indexed.get(targetIdentity(target))?.affected_instance_count || target.entity?.affected_instance_count || 1), 0)
    + normalizedOperations.filter(operation => operation.op === 'place_component_asset').length;
  if (affectedInstances > normalizedBudgets.max_affected_instances) blockers.push({ code: 'affected_instance_budget_exceeded', actual: affectedInstances, limit: normalizedBudgets.max_affected_instances });

  const operationContracts = operationValidation.operation_contracts;
  const riskLevel = operationValidation.risk_level;
  const trustedScopeApprovalRequired = requestedTargets.some((target) => {
    const entry = indexed.get(targetIdentity(target));
    return entry?.shared_definition === true || target.instance_policy === 'make_unique';
  });
  const requestedExecutionContract = execution_contract
    ? normalizeExecutionContract(execution_contract)
    : null;
  const trustedModelCopyAutoApproval = trustedModelCopyAutoApprovalBinding({
    executionPolicy: bridge.executionPolicy,
    riskLevel,
    affectedInstanceCount: affectedInstances,
    modelSourcePath: modelSourcePathForAdoption(adoption),
    saveModel: requestedExecutionContract?.save_model === true,
    savePath: requestedExecutionContract?.save_path || null
  });
  const modelRevision = modelRevisionForAdoption(adoption);
  const modelKey = modelKeyForIdentity(modelIdentityForAdoption(adoption));
  const copyFastSessionResolution = trustedModelCopyAutoApproval
    ? bridge.copyFastSessionAuthority.resolveOrCreate({
      scopeBinding: trustedModelCopyAutoApproval,
      modelKey,
      modelRevision,
      runtime,
      sessionTtlMs: bridge.executionPolicy.trusted_model_copy_auto_approval.session_ttl_ms
    })
    : null;
  const copyFastSession = copyFastSessionResolution?.binding || null;
  const s1AutoApprovalEligible = riskLevel === 'S1'
    && !trustedScopeApprovalRequired
    && affectedInstances <= bridge.executionPolicy.resource_limits.auto_approve_s1_max_affected_instances;
  const autoApprovalEligible = s1AutoApprovalEligible || Boolean(copyFastSession);
  const targetValidationRecord = preparationTargetValidationRecord(normalizedTargetValidation, adoption, requestedTargets, indexed);
  if (expected_model_revision && modelRevision !== expected_model_revision) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed after the source proposal was created.', {
      details: { expected: expected_model_revision, actual: modelRevision }
    });
  }
  if (expected_model_key && modelKey !== expected_model_key) {
    throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The active model identity differs from the source proposal.', {
      details: { expected_model_key, actual_model_key: modelKey }
    });
  }
  const planCore = {
    version: EXISTING_MODEL_EDIT_PLAN_VERSION,
    instruction: normalizedInstruction,
    runtime,
    model_key: modelKey,
    model_revision: modelRevision,
    risk_level: riskLevel,
    trusted_scope_approval_required: trustedScopeApprovalRequired,
    auto_approval_eligible: autoApprovalEligible,
    review_required: !copyFastSession,
    user_action_required: !autoApprovalEligible,
    execution_mode: copyFastSession ? 'copy_fast' : 'reviewed',
    targets: requestedTargets.map((target) => ({
      ...target,
      entity: summarizeIndexedTarget(indexed.get(targetIdentity(target)))
    })),
    operation_contracts: operationContracts,
    dsl_document: { version: 1, units: 'mm', operations: normalizedOperations },
    budgets: normalizedBudgets,
    target_validation: targetValidationRecord,
    affected_instance_count: affectedInstances,
    destructive_side_effects: destructiveSideEffects,
    blockers,
    ...(trustedModelCopyAutoApproval ? { trusted_model_copy_auto_approval: trustedModelCopyAutoApproval } : {}),
    ...(copyFastSession ? { copy_fast_session: copyFastSession } : {}),
    ...(requestedExecutionContract ? { execution_contract: requestedExecutionContract } : {}),
    ...(source_proposal_binding ? { source_proposal: normalizeSourceProposalBinding(source_proposal_binding) } : {})
  };
  const planId = hashJson(planCore).slice(0, 24);
  const stablePlanId = `existing-edit-${planId}`;
  const boundExecutionContract = requestedExecutionContract
    ? bindExecutionContractToPlan(requestedExecutionContract, stablePlanId)
    : null;
  const planWithoutHash = {
    kind: 'existing_model_edit_plan',
    plan_id: stablePlanId,
    task_id,
    created_at: new Date().toISOString(),
    compile_permission: blockers.length ? 'blocked' : 'ready_for_review',
    ...planCore,
    ...(boundExecutionContract ? { execution_contract: boundExecutionContract } : {})
  };
  const plan = { ...planWithoutHash, plan_hash: existingModelEditPlanHash(planWithoutHash) };
  const outputDir = path.resolve(output_dir || path.join('output', 'existing-model-edits', plan.plan_id, 'prepare'));
  await fs.mkdir(outputDir, { recursive: true });
  const approvalChallengeRequired = plan.compile_permission === 'ready_for_review'
    && !plan.copy_fast_session;
  const artifacts = {
    plan: path.join(outputDir, 'existing-model-edit-plan.json'),
    adoption_index: path.join(outputDir, 'adoption-index.json'),
    manifest: path.join(outputDir, 'prepare-manifest.json'),
    ...(approvalChallengeRequired ? { approval_challenge: path.join(outputDir, 'approval-challenge.json') } : {})
  };
  const approvalChallenge = approvalChallengeRequired
    ? await bridge.approvalAuthority.createChallenge({
      taskId: task_id,
      planId: plan.plan_id,
      planHash: plan.plan_hash,
      modelRevision: plan.model_revision,
      riskLevel: plan.risk_level,
      allowedOperations: plan.dsl_document.operations.map((operation) => operation.op),
      reviewContext: existingModelEditApprovalReviewContext(plan),
      ...(approval_expires_ms !== undefined ? { expiresInMs: approval_expires_ms } : {})
    })
    : null;
  await writeJson(artifacts.plan, plan);
  await writeJson(artifacts.adoption_index, adoption);
  if (approvalChallenge) await writeJson(artifacts.approval_challenge, approvalChallenge);
  await writeJson(artifacts.manifest, {
    kind: 'prepare_existing_model_edit',
    plan_id: plan.plan_id,
    model_revision: modelRevision,
    risk_level: riskLevel,
    compile_permission: plan.compile_permission,
    approval: approvalChallenge ? {
      mode: plan.trusted_model_copy_auto_approval
        ? 'server_trusted_model_copy_policy_or_trusted_token'
        : plan.auto_approval_eligible
          ? 'trusted_token_or_server_auto_policy'
          : 'trusted_token_required',
      challenge_id: approvalChallenge.challenge_id,
      expires_at: approvalChallenge.expires_at
    } : null,
    authorization: plan.copy_fast_session ? {
      mode: 'copy_fast_session',
      session_id: plan.copy_fast_session.session_id,
      user_action_required: false,
      expires_at: plan.copy_fast_session.expires_at
    } : null,
    blockers,
    artifacts
  });
  return {
    kind: 'prepare_existing_model_edit',
    plan,
    approval_challenge: approvalChallenge,
    copy_fast_session: copyFastSessionResolution?.summary || null,
    artifacts
  };
}

export async function applyReviewedExistingModelEdit({ bridge, runtime = 'mock', timeoutMs, plan, plan_file, review, review_file, approval_token, output_dir, save_model = true, save_path, capture_view = false } = {}) {
  if (!bridge) throw new Error('apply_reviewed_model_edit requires a bridge');
  const loadedPlan = plan || await readJsonRequired(plan_file, 'apply_reviewed_model_edit.plan_file');
  const suppliedReview = review || (review_file ? await readJsonRequired(review_file, 'apply_reviewed_model_edit.review_file') : null);
  validatePlan(loadedPlan);
  validateReviewMetadata(suppliedReview, loadedPlan);
  if (loadedPlan.execution_contract) {
    const requestedExecution = normalizeExecutionContract({ save_model, save_path, capture_view });
    const approvedExecution = executionRequestContract(loadedPlan.execution_contract);
    if (JSON.stringify(requestedExecution) !== JSON.stringify(approvedExecution)) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'The requested save/capture execution options differ from the approved plan.');
    }
    assertExecutionFinalPathBinding(loadedPlan.execution_contract, loadedPlan.plan_id);
  }
  if (loadedPlan.blockers?.length) throw new Error(`existing model edit plan is blocked: ${loadedPlan.blockers.map((item) => item.code).join(', ')}`);

  const autoApprovalMode = serverPolicyAutoApprovalMode(loadedPlan, bridge.executionPolicy);
  if (!autoApprovalMode && !approval_token) {
    throw new AgentContractError('APPROVAL_REQUIRED', 'A trusted approval token is required; Agent-supplied review fields are not execution authorization.', {
      details: { plan_id: loadedPlan.plan_id, risk_level: loadedPlan.risk_level }
    });
  }

  const preflight = await observeExistingModelEditExecutionState({
    bridge,
    plan: loadedPlan,
    runtime,
    timeoutMs,
    phase: 'apply_preflight',
    expected_model_key: loadedPlan.model_key,
    expected_model_revision: loadedPlan.model_revision
  });
  const currentRevision = preflight.summary.model_revision;
  if (autoApprovalMode === 'copy_fast_session') {
    const liveBinding = trustedModelCopyAutoApprovalBinding({
      executionPolicy: bridge.executionPolicy,
      riskLevel: loadedPlan.risk_level,
      affectedInstanceCount: loadedPlan.affected_instance_count,
      modelSourcePath: modelSourcePathForAdoption(preflight.adoption),
      saveModel: loadedPlan.execution_contract?.save_model === true,
      savePath: loadedPlan.execution_contract?.save_path || null
    });
    if (!liveBinding || liveBinding.binding_hash !== loadedPlan.trusted_model_copy_auto_approval?.binding_hash) {
      throw new AgentContractError('POLICY_DENIED', 'The active model is outside the server-configured trusted copy auto-approval scope.', {
        details: { plan_id: loadedPlan.plan_id, risk_level: loadedPlan.risk_level }
      });
    }
    bridge.copyFastSessionAuthority.verify(loadedPlan.copy_fast_session, {
      scopeBinding: liveBinding,
      modelKey: loadedPlan.model_key,
      runtime
    });
  }

  const authorization = autoApprovalMode
    ? autoApprovalMode === 'copy_fast_session' ? {
      mode: 'server_policy_copy_fast_session',
      approved_by: 'execution-policy:copy-fast-session',
      approved_at: new Date().toISOString(),
      policy_version: bridge.executionPolicy.policy_version,
      policy_scope_fingerprint: loadedPlan.trusted_model_copy_auto_approval.policy_scope_fingerprint,
      copy_fast_session_id: loadedPlan.copy_fast_session.session_id,
      user_action_required: false
    } : {
      mode: 'server_policy_auto_approval',
      approved_by: 'execution-policy:S1',
      approved_at: new Date().toISOString(),
      policy_version: bridge.executionPolicy.policy_version
    }
    : {
      mode: 'trusted_one_time_token',
      ...await bridge.approvalAuthority.consumeToken(approval_token, {
        task_id: loadedPlan.task_id || null,
        plan_id: loadedPlan.plan_id,
        plan_hash: loadedPlan.plan_hash,
        model_revision: loadedPlan.model_revision,
        risk_level: loadedPlan.risk_level,
        allowed_operations: loadedPlan.dsl_document.operations.map((operation) => operation.op),
        review_context_hash: sha256Canonical(existingModelEditApprovalReviewContext(loadedPlan))
      })
    };
  const trustedReview = {
    status: 'approved',
    plan_id: loadedPlan.plan_id,
    reviewer: authorization.approved_by,
    authorization_mode: authorization.mode,
    approved_at: authorization.approved_at,
    ...(authorization.challenge_id ? { challenge_id: authorization.challenge_id } : {}),
    ...(suppliedReview?.note ? { note: String(suppliedReview.note) } : {})
  };

  const operations = loadedPlan.dsl_document.operations.map((operation) => reviewedExecutionOperation(operation, loadedPlan.targets));
  const targets = loadedPlan.targets.map(({ entity, ...target }) => target);
  const outputDir = path.resolve(output_dir || path.join('output', 'existing-model-edits', loadedPlan.plan_id, 'apply'));
  await fs.mkdir(outputDir, { recursive: true });
  const reviewArtifact = path.join(outputDir, 'review-decision.json');
  await writeJson(reviewArtifact, { ...trustedReview, authorization });
  const trustedNestedTargetValidator = preflight.policy.mode === 'structural_groups' || loadedPlan.target_validation?.recursive_root_paths
    ? async ({ phase, references }) => {
      assertIterationReferencesMatchPlan(references, loadedPlan);
      return observeExistingModelEditExecutionState({
        bridge,
        plan: loadedPlan,
        runtime,
        timeoutMs,
        phase,
        expected_model_key: loadedPlan.model_key,
        ...(phase === 'iteration_before' ? { expected_model_revision: loadedPlan.model_revision } : {})
      });
    }
    : null;
  const iteration = await bridge.iterate_model({
    runtime,
    timeoutMs,
    targets,
    code: JSON.stringify({ version: 1, units: 'mm', operations }),
    input_format: 'json_dsl',
    output_dir: outputDir,
    label: loadedPlan.plan_id,
    save_model,
    save_path,
    capture_view,
    validate_model: true,
    budgets: loadedPlan.budgets,
    ...(trustedNestedTargetValidator ? { trusted_nested_target_validator: trustedNestedTargetValidator } : {})
  });
  const executionTargetValidation = {
    version: EXISTING_MODEL_EDIT_EXECUTION_TARGET_VALIDATION_VERSION,
    mode: preflight.policy.mode,
    source: preflight.policy.source,
    leaf_entities_materialized: preflight.policy.leaf_entities_materialized,
    phases: {
      apply_preflight: preflight.summary,
      ...(iteration.target_validation?.before ? { iteration_before: iteration.target_validation.before } : {}),
      ...(iteration.target_validation?.after ? { iteration_after: iteration.target_validation.after } : {})
    }
  };
  const applyResultArtifact = path.join(outputDir, 'apply-result.json');
  const result = {
    kind: 'apply_reviewed_model_edit',
    ok: true,
    plan_id: loadedPlan.plan_id,
    reviewed_by: trustedReview.reviewer,
    risk_level: loadedPlan.risk_level,
    model_key: loadedPlan.model_key,
    model_revision_before: currentRevision,
    review: trustedReview,
    authorization: {
      mode: authorization.mode,
      approved_by: authorization.approved_by,
      approved_at: authorization.approved_at,
      ...(authorization.challenge_id ? { challenge_id: authorization.challenge_id } : {}),
      ...(authorization.copy_fast_session_id ? {
        copy_fast_session_id: authorization.copy_fast_session_id,
        user_action_required: false
      } : {})
    },
    execution_target_validation: executionTargetValidation,
    ...(runtime === 'queue' && bridge.liveMutationAuthorization ? {
      session_contract: {
        handshake_id: bridge.liveMutationAuthorization.handshake_id,
        validated_at: bridge.liveMutationAuthorization.validated_at
      }
    } : {}),
    iteration,
    ...(iteration.mutation_receipt ? { mutation_receipt: structuredClone(iteration.mutation_receipt) } : {}),
    artifacts: { ...iteration.artifacts, review: reviewArtifact, apply_result: applyResultArtifact }
  };
  await writeJson(applyResultArtifact, result);
  return result;
}

function reviewedExecutionOperation(operation, planTargets = []) {
  const result = structuredClone(operation);
  const primaryTarget = operationTargetReference(operation);
  if (primaryTarget?.entity_path) {
    const matchingTargets = planTargets.filter((target) => target?.entity_path === primaryTarget.entity_path);
    if (matchingTargets.length !== 1) {
      throw new AgentContractError('PLAN_HASH_MISMATCH', 'The reviewed operation does not resolve to exactly one hash-bound entity-path target.');
    }
    const reviewedTarget = matchingTargets[0];
    result.edit_scope = reviewedTarget.edit_scope;
    result.instance_policy = reviewedTarget.instance_policy;
    if (reviewedTarget.instance_id) result.instance_id = reviewedTarget.instance_id;
    else delete result.instance_id;
    delete result.editScope;
    delete result.instancePolicy;
    delete result.instanceId;
  }
  if (CONFIRMED_OPERATIONS.has(result.op)) result.confirmed = true;
  return result;
}

export function modelRevisionForAdoption(adoption) {
  if (adoption?.runtime === 'queue' && (adoption.model_revision_complete !== true
    || !Number.isInteger(adoption.model_revision_total_seen)
    || !Number.isInteger(adoption.model_revision_indexed)
    || adoption.model_revision_total_seen !== adoption.model_revision_indexed)) {
    throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'The live model does not have a complete revision binding for safe editing.');
  }
  if (typeof adoption?.model_revision === 'string' && /^sha256:[0-9a-f]{64}$/.test(adoption.model_revision)) {
    return adoption.model_revision;
  }
  const stable = {
    entities: (adoption.entities || []).map(stableEntity).sort(sortByPath),
    recursive: (adoption.recursive_index || []).map(stableEntity).sort(sortByPath),
    totals: adoption.snapshot?.totals || null,
    materials: [...(adoption.snapshot?.materials || [])].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    tags: [...(adoption.snapshot?.tags || [])].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    scenes: [...(adoption.snapshot?.scenes || [])].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    classification_schemas: [...(adoption.classification_schemas || adoption.snapshot?.classification_schemas || [])]
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
    component_definition_summaries: [...(adoption.component_definition_summaries || adoption.snapshot?.component_definition_summaries || [])]
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
    image_references: [...(adoption.snapshot?.image_references || [])].sort((left, right) => String(left.name).localeCompare(String(right.name)))
  };
  return `sha256:${hashJson(stable)}`;
}

export function existingModelEditPlanBinding(plan) {
  return {
    kind: plan.kind,
    version: plan.version,
    plan_id: plan.plan_id,
    task_id: plan.task_id || null,
    instruction: plan.instruction,
    runtime: plan.runtime,
    model_key: plan.model_key,
    model_revision: plan.model_revision,
    risk_level: plan.risk_level,
    trusted_scope_approval_required: plan.trusted_scope_approval_required,
    auto_approval_eligible: plan.auto_approval_eligible,
    review_required: plan.review_required,
    user_action_required: plan.user_action_required,
    execution_mode: plan.execution_mode,
    targets: plan.targets,
    operation_contracts: plan.operation_contracts,
    dsl_document: plan.dsl_document,
    budgets: plan.budgets,
    target_validation: plan.target_validation,
    affected_instance_count: plan.affected_instance_count,
    destructive_side_effects: plan.destructive_side_effects,
    blockers: plan.blockers,
    compile_permission: plan.compile_permission,
    ...(plan.execution_contract ? { execution_contract: plan.execution_contract } : {}),
    ...(plan.trusted_model_copy_auto_approval ? { trusted_model_copy_auto_approval: plan.trusted_model_copy_auto_approval } : {}),
    ...(plan.copy_fast_session ? { copy_fast_session: plan.copy_fast_session } : {}),
    ...(plan.source_proposal ? { source_proposal: plan.source_proposal } : {})
  };
}

export function existingModelEditPlanHash(plan) {
  return sha256Canonical(existingModelEditPlanBinding(plan));
}

function stableEntity(entity = {}) {
  return {
    path: entity.entity_path || entity.id || entity.persistent_id || entity.name,
    persistent_id: entity.persistent_id || null,
    type: entity.entity_type || null,
    name: entity.name || null,
    definition: entity.definition_name || entity.definition || null,
    visible: entity.visible !== false,
    material: entity.material || null,
    back_material: entity.back_material || null,
    tag: entity.tag || null,
    bbox: entity.bounding_box || null,
    faces: entity.faces ?? null,
    edges: entity.edges ?? null,
    vertices: entity.vertices ?? null,
    soft: entity.soft ?? null,
    smooth: entity.smooth ?? null,
    reversed: entity.reversed === true,
    locked: entity.locked === true,
    classification: entity.classification || null,
    native_classification: entity.native_classification || null,
    attributes: entity.attributes || null,
    texture_transform: entity.texture_transform || null,
    face_uvs: entity.face_uvs || null,
    geometry_summary: entity.geometry_summary || null,
    features: entity.features || null,
    transform: entity.transform || null,
    transformation: entity.transformation || null,
    world_transform: entity.world_transform || null
  };
}

function normalizeOperations(operations) {
  if (!Array.isArray(operations) || !operations.length) throw new Error('prepare_existing_model_edit.operations must be a non-empty array');
  return operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error(`prepare_existing_model_edit.operations[${index}] must be an object`);
    const op = nonEmptyString(operation.op, `prepare_existing_model_edit.operations[${index}].op`);
    if (op === 'reset') throw new Error('prepare_existing_model_edit does not allow reset');
    const normalized = structuredClone({ ...operation, op });
    validateExistingOperationContract(normalized, index);
    return normalized;
  });
}

function validateExistingOperationContract(operation, index) {
  const field = (name) => `prepare_existing_model_edit.operations[${index}].${name}`;
  if (!Object.hasOwn(RISK_BY_OPERATION, operation.op)) {
    throw new AgentContractError('INVALID_ARGUMENT', `${field('op')} is not supported by the reviewed existing-model engine.`);
  }
  if (ADDITIVE_CREATION_OPERATIONS.has(operation.op)) {
    validateAdditiveCreationContract(operation, index);
    return;
  }
  const requireStringField = (names, label = names[0]) => {
    const value = firstDefined(operation, names);
    if (typeof value !== 'string' || !value.trim()) invalidOperationField(field(label), 'a non-empty string');
    return value;
  };
  const optionalBoolean = (names, label = names[0]) => {
    const value = firstDefined(operation, names);
    if (value !== undefined && typeof value !== 'boolean') invalidOperationField(field(label), 'a boolean');
  };
  const optionalFinite = (names, { label = names[0], positive = false, nonzero = false } = {}) => {
    const value = firstDefined(operation, names);
    if (value === undefined) return;
    if (!Number.isFinite(value) || (positive && value <= 0) || (nonzero && value === 0)) {
      invalidOperationField(field(label), positive ? 'a positive finite number' : nonzero ? 'a finite non-zero number' : 'a finite number');
    }
  };

  switch (operation.op) {
  case 'place_component_asset':
  case 'replace_component_asset':
    validateNativeAssetOperation(operation);
    break;
  case 'material': {
    requireStringField(['name']);
    if (operation.color !== undefined && (typeof operation.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(operation.color))) {
      invalidOperationField(field('color'), 'a #rrggbb color');
    }
    if (operation.alpha !== undefined && (!Number.isFinite(operation.alpha) || operation.alpha < 0 || operation.alpha > 1)) {
      invalidOperationField(field('alpha'), 'a finite number from 0 to 1');
    }
    if (operation.color === undefined && operation.alpha === undefined) {
      invalidOperationField(field('color'), 'present together with color or alpha');
    }
    for (const forbidden of ['texture', 'texture_path', 'texturePath', 'path', 'file']) {
      if (operation[forbidden] !== undefined) {
        throw new AgentContractError('INVALID_ARGUMENT', `${field(forbidden)} is not allowed for reviewed material resource updates.`);
      }
    }
    break;
  }
  case 'rename':
    requireStringField(['new_name', 'newName'], 'new_name');
    break;
  case 'set_material':
    requireStringField(['material']);
    break;
  case 'set_face_material': {
    requireStringField(['material']);
    const side = operation.side;
    if (side !== undefined && !['front', 'back', 'both'].includes(side)) invalidOperationField(field('side'), 'front, back, or both');
    break;
  }
  case 'set_visibility':
    if (typeof operation.visible !== 'boolean') invalidOperationField(field('visible'), 'a boolean');
    break;
  case 'set_edge_properties':
    optionalBoolean(['soft']);
    optionalBoolean(['smooth']);
    if (operation.soft === undefined && operation.smooth === undefined) invalidOperationField(field('soft'), 'present together with soft or smooth');
    break;
  case 'assign_tag':
    requireStringField(['tag', 'tag_name', 'tagName'], 'tag');
    break;
  case 'attribute': {
    requireStringField(['dictionary', 'namespace'], 'dictionary');
    const attributes = operation.attributes;
    if (attributes !== undefined) {
      if (!isPlainJsonObject(attributes) || !isJsonCompatible(attributes)) invalidOperationField(field('attributes'), 'a JSON object');
    } else {
      requireStringField(['key', 'attr_key', 'attrKey'], 'key');
      if (!Object.hasOwn(operation, 'value') || !isJsonCompatible(operation.value)) invalidOperationField(field('value'), 'a JSON value');
    }
    break;
  }
  case 'remove_attribute':
    requireStringField(['dictionary', 'namespace'], 'dictionary');
    if (firstDefined(operation, ['key', 'attr_key', 'attrKey']) !== undefined) requireStringField(['key', 'attr_key', 'attrKey'], 'key');
    break;
  case 'classification':
    if (firstDefined(operation, ['system', 'schema']) !== undefined) requireStringField(['system', 'schema'], 'system');
    requireStringField(['type', 'classification', 'ifc_class', 'ifcClass', 'class'], 'type');
    if (operation.attributes !== undefined && (!isPlainJsonObject(operation.attributes) || !isJsonCompatible(operation.attributes))) invalidOperationField(field('attributes'), 'a JSON object');
    break;
  case 'texture_transform':
    normalizeTextureTransform(operation, field('texture_transform'));
    break;
  case 'transform_object':
  case 'transform_entities':
    validateTransformContract(operation, field);
    break;
  case 'duplicate_entity':
    if (operation.count !== undefined && (!Number.isInteger(operation.count) || operation.count < 1)) invalidOperationField(field('count'), 'a positive integer');
    if (operation.offset !== undefined) validateFiniteVector(operation.offset, field('offset'));
    break;
  case 'replace_component_definition':
    requireStringField(['definition', 'definition_name', 'definitionName', 'replacement', 'replacement_definition'], 'definition');
    break;
  case 'pushpull_face':
    optionalFinite(['distance'], { nonzero: true });
    if (operation.distance === undefined) invalidOperationField(field('distance'), 'a finite non-zero number');
    break;
  case 'cut_hole':
    validateOptionalCenter(operation.center, field('center'));
    optionalFinite(['radius'], { positive: true });
    if (operation.radius === undefined) invalidOperationField(field('radius'), 'a positive finite number');
    validateFeatureCommon(operation, field);
    break;
  case 'cut_slot':
    validateOptionalCenter(operation.center, field('center'));
    optionalFinite(['width'], { positive: true });
    optionalFinite(['length'], { positive: true });
    validateFeatureCommon(operation, field);
    break;
  case 'cut_recess':
    validateOptionalCenter(operation.center, field('center'));
    optionalFinite(['depth'], { positive: true });
    validateFeatureCommon(operation, field);
    break;
  case 'add_boss':
    validateOptionalCenter(operation.center, field('center'));
    optionalFinite(['radius'], { positive: true });
    optionalFinite(['height'], { positive: true });
    validateFeatureCommon(operation, field);
    break;
  case 'add_raised_rib':
    optionalFinite(['width'], { positive: true });
    optionalFinite(['height'], { positive: true });
    validateFeatureCommon(operation, field);
    break;
  case 'boolean_union':
  case 'boolean_difference':
  case 'boolean_intersect': {
    const tools = firstDefined(operation, ['tools', 'tool_ids', 'toolIds', 'tool_id', 'toolId']);
    if (tools === undefined || (Array.isArray(tools) && tools.length === 0)) invalidOperationField(field('tools'), 'one or more declared tool targets');
    optionalBoolean(['keep_tools', 'keepTools'], 'keep_tools');
    optionalBoolean(['keep_originals', 'keepOriginals'], 'keep_originals');
    break;
  }
  case 'manifold_check':
  case 'manifold_repair':
    optionalBoolean(['fail_on_non_manifold', 'failOnNonManifold'], 'fail_on_non_manifold');
    break;
  case 'delete':
  case 'reverse_face':
  case 'erase_entities':
  case 'explode_entity':
    break;
  default:
    throw new AgentContractError('INVALID_ARGUMENT', `${field('op')} is not validated by the reviewed existing-model engine.`);
  }
}

function validateAdditiveCreationContract(operation, index) {
  const document = { version: 1, units: 'mm', operations: [operation] };
  try {
    validateExpertDocument(document, { maxOperations: 1 });
    prepareAgentGatewayCreationDsl(JSON.stringify(document), { intent: 'reviewed_design_subgraph_rebuild' });
  } catch (error) {
    if (error instanceof AgentContractError) throw error;
    throw new AgentContractError('INVALID_ARGUMENT', `prepare_existing_model_edit.operations[${index}] is not a valid additive rebuild operation.`, {
      details: { reason: String(error?.message || error) }
    });
  }
}

function validateTransformContract(operation, field) {
  const transform = firstDefined(operation, ['transform', 'matrix', 'local_matrix', 'localMatrix', 'translate', 'translation', 'rotate', 'scale']);
  if (transform === undefined) invalidOperationField(field('transform'), 'a transform object, matrix, or vector');
  if (!isJsonCompatible(transform)) invalidOperationField(field('transform'), 'JSON-compatible finite transform data');
}

function validateFeatureCommon(operation, field) {
  if (operation.feature_id !== undefined && (typeof operation.feature_id !== 'string' || !operation.feature_id.trim())) invalidOperationField(field('feature_id'), 'a non-empty string');
  if (operation.segments !== undefined && (!Number.isInteger(operation.segments) || operation.segments < 3)) invalidOperationField(field('segments'), 'an integer of at least 3');
}

function validateOptionalCenter(value, field) {
  if (value !== undefined && (!Array.isArray(value) || ![2, 3].includes(value.length) || !value.every(Number.isFinite))) invalidOperationField(field, 'a finite 2D or 3D coordinate array');
}

function validateFiniteVector(value, field) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) invalidOperationField(field, 'a finite 3D vector');
}

function invalidOperationField(field, expected) {
  throw new AgentContractError('INVALID_ARGUMENT', `${field} must be ${expected}.`);
}

function firstDefined(object, names) {
  for (const name of names) if (object[name] !== undefined) return object[name];
  return undefined;
}

function isPlainJsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isJsonCompatible(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonCompatible);
  return isPlainJsonObject(value) && Object.values(value).every(isJsonCompatible);
}

function normalizeSourceProposalBinding(value) {
  const binding = {
    task_id: nonEmptyString(value?.task_id, 'source_proposal.task_id'),
    proposal_id: nonEmptyString(value?.proposal_id, 'source_proposal.proposal_id'),
    proposal_hash: nonEmptyString(value?.proposal_hash, 'source_proposal.proposal_hash'),
    graph_id: nonEmptyString(value?.graph_id, 'source_proposal.graph_id'),
    model_key: nonEmptyString(value?.model_key, 'source_proposal.model_key'),
    model_revision: nonEmptyString(value?.model_revision, 'source_proposal.model_revision')
  };
  if (!/^task_[0-9a-f-]+$/i.test(binding.task_id)
    || !/^edit-proposal-[0-9a-f]{24}$/.test(binding.proposal_id)
    || !/^sha256:[0-9a-f]{64}$/.test(binding.proposal_hash)
    || !/^model-graph-[0-9a-f]{24}$/.test(binding.graph_id)
    || !/^model_[0-9a-f]{32}$/.test(binding.model_key)
    || !/^sha256:[0-9a-f]{64}$/.test(binding.model_revision)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'source_proposal binding has an invalid format.');
  }
  return binding;
}

function normalizeTargets(targets, operations) {
  const raw = targets?.length ? targets : extractTargets(operations);
  // A single reviewed new-root asset placement has no existing entity target.
  // It still binds the complete active-model revision, resource budget and approval.
  if (Array.isArray(raw) && raw.length === 0 && operations.length === 1 && operations[0].op === 'place_component_asset') return [];
  if (!Array.isArray(raw) || !raw.length) throw new Error('prepare_existing_model_edit requires at least one persistent entity target');
  const seen = new Set();
  const normalized = [];
  for (const item of raw) {
    const target = typeof item === 'string' ? { entity_path: item } : structuredClone(item);
    target.entity_path ||= target.entityPath;
    target.target_id ||= target.targetId || target.id || target.reference;
    if (target.entity_path) {
      target.edit_scope ||= target.editScope || 'instance_path';
      target.instance_policy ||= target.instancePolicy || 'definition_wide';
      target.instance_id ||= target.instanceId;
    } else if (target.target_id) {
      target.edit_scope = 'top_level';
      delete target.instance_policy;
      delete target.instance_id;
    } else {
      throw new Error('existing model edit target requires entity_path or target_id');
    }
    delete target.entityPath;
    delete target.targetId;
    delete target.id;
    delete target.reference;
    const key = `${targetIdentity(target)}|${target.instance_policy || ''}|${target.instance_id || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(target);
    }
  }
  return normalized;
}

function extractTargets(operations) {
  const result = [];
  for (const operation of operations) {
    const pathValue = operation.entity_path || operation.entityPath || operation.target_path || operation.targetPath;
    if (pathValue) result.push({ entity_path: pathValue, edit_scope: operation.edit_scope || operation.editScope, instance_policy: operation.instance_policy || operation.instancePolicy, instance_id: operation.instance_id || operation.instanceId });
    const topLevelId = operation.target_id || operation.targetId || operation.object_id || operation.objectId;
    if (!pathValue && topLevelId) result.push({ target_id: topLevelId });
    for (const target of operation.targets || []) result.push(typeof target === 'string' ? { entity_path: target } : target);
  }
  return result;
}

function operationTargetReference(operation) {
  const pathValue = operation.entity_path || operation.entityPath || operation.target_path || operation.targetPath;
  if (pathValue) return { entity_path: pathValue };
  const targetId = operation.target_id || operation.targetId || operation.object_id || operation.objectId || operation.target || operation.object;
  return targetId === undefined || targetId === null || targetId === '' ? null : { target_id: targetId };
}

function operationAuxiliaryTargetReferences(operation) {
  const values = [
    ...(Array.isArray(operation.targets) ? operation.targets : operation.targets === undefined ? [] : [operation.targets]),
    ...(Array.isArray(operation.tools) ? operation.tools : operation.tools === undefined ? [] : [operation.tools]),
    ...(Array.isArray(operation.tool_ids) ? operation.tool_ids : operation.tool_ids === undefined ? [] : [operation.tool_ids]),
    ...(Array.isArray(operation.toolIds) ? operation.toolIds : operation.toolIds === undefined ? [] : [operation.toolIds]),
    ...(operation.tool_id === undefined ? [] : [operation.tool_id]),
    ...(operation.toolId === undefined ? [] : [operation.toolId])
  ];
  return values.map((value) => {
    if (typeof value === 'string' || typeof value === 'number') return { target_id: value };
    const pathValue = value?.entity_path || value?.entityPath || value?.target_path || value?.targetPath;
    if (pathValue) return { entity_path: pathValue };
    const targetId = value?.target_id || value?.targetId || value?.id || value?.reference || value?.name;
    return targetId === undefined || targetId === null || targetId === '' ? null : { target_id: targetId };
  }).filter(Boolean);
}

function normalizeBudgets(value = {}, policyLimits = {}) {
  const normalized = {
    max_operations: positiveInteger(value.max_operations ?? value.maxOperations ?? 100, 'budgets.max_operations'),
    max_affected_instances: positiveInteger(value.max_affected_instances ?? value.maxAffectedInstances ?? 200, 'budgets.max_affected_instances'),
    recursive_limit: positiveInteger(value.recursive_limit ?? value.recursiveLimit ?? 2000, 'budgets.recursive_limit'),
    ...(value.max_faces !== undefined ? { max_faces: positiveInteger(value.max_faces, 'budgets.max_faces') } : {}),
    ...(value.max_edges !== undefined ? { max_edges: positiveInteger(value.max_edges, 'budgets.max_edges') } : {})
  };
  const limits = {
    max_operations: Number(policyLimits.max_operations || 100),
    max_affected_instances: Number(policyLimits.max_affected_instances || 200),
    recursive_limit: Number(policyLimits.max_recursive_entities || 10_000)
  };
  for (const [field, maximum] of Object.entries(limits)) {
    if (normalized[field] > maximum) {
      throw new AgentContractError('POLICY_DENIED', `${field} exceeds the trusted server execution-policy limit.`, {
        details: { field, requested: normalized[field], maximum }
      });
    }
  }
  return normalized;
}

function normalizePreparationTargetValidation(value, { sourceProposalBinding, operations, targets }) {
  if (value === undefined || value === null) {
    return { mode: 'full_recursive', source: 'default_full_recursive' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'target_validation must be a server-issued object.');
  }
  if (value.mode !== 'structural_groups' || value.source !== 'server_bound_source_proposal') {
    throw new AgentContractError('INVALID_ARGUMENT', 'Only a server-bound source proposal may request structural Group target validation.');
  }
  if (!sourceProposalBinding) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Structural Group target validation requires a source proposal binding.');
  }
  if (!canPrepareExistingModelEditFromStructuralGroups({ operations, targets })) {
    throw new AgentContractError('INVALID_ARGUMENT', 'The source proposal is not compatible with structural Group target validation.');
  }
  const structuralGroupLimit = value.structural_group_limit;
  if (!Number.isInteger(structuralGroupLimit) || structuralGroupLimit < 1 || structuralGroupLimit > 5000) {
    throw new AgentContractError('INVALID_ARGUMENT', 'target_validation.structural_group_limit must be an integer from 1 to 5000.');
  }
  return {
    mode: 'structural_groups',
    source: 'server_bound_source_proposal',
    structural_group_limit: structuralGroupLimit
  };
}

function preparationTargetValidationRecord(validation, adoption, requestedTargets, indexed) {
  if (validation.mode === 'full_recursive') {
    return {
      version: 'existing-edit-target-validation.v1',
      mode: 'full_recursive',
      source: validation.source,
      ...(adoption.recursive_root_paths ? { recursive_root_paths: adoption.recursive_root_paths } : {}),
      complete: adoption.recursive_truncated !== true,
      truncated: adoption.recursive_truncated === true,
      indexed: Array.isArray(adoption.recursive_index) ? adoption.recursive_index.length : 0,
      total_seen: Number(adoption.recursive_total_seen || 0),
      exact_target_count: requestedTargets.filter((target) => indexed.has(targetIdentity(target))).length,
      requested_target_count: requestedTargets.length,
      leaf_entities_materialized: true,
      sufficient_for_review: adoption.recursive_truncated !== true
        && requestedTargets.every((target) => indexed.has(targetIdentity(target)))
    };
  }
  const projection = adoption.structural_groups || {};
  const exactTargetCount = requestedTargets.filter((target) => indexed.has(targetIdentity(target))).length;
  return {
    version: 'existing-edit-target-validation.v1',
    mode: 'structural_groups',
    source: validation.source,
    projection_version: projection.version || null,
    complete: projection.truncated === false && projection.total_seen_exact === true,
    truncated: projection.truncated === true,
    indexed: Number(projection.returned || 0),
    total_seen: Number(projection.total_seen || 0),
    total_seen_exact: projection.total_seen_exact === true,
    structural_group_limit: validation.structural_group_limit,
    exact_target_count: exactTargetCount,
    requested_target_count: requestedTargets.length,
    exact_targets_verified: exactTargetCount === requestedTargets.length,
    leaf_entities_materialized: false,
    sufficient_for_review: exactTargetCount === requestedTargets.length
  };
}

function validatePlan(plan) {
  if (plan?.kind !== 'existing_model_edit_plan' || plan.version !== EXISTING_MODEL_EDIT_PLAN_VERSION) throw new Error('apply_reviewed_model_edit requires a compatible existing model edit plan');
  if (plan.compile_permission !== 'ready_for_review') throw new Error('existing model edit plan is not ready for review');
  if (!plan.plan_hash || plan.plan_hash !== existingModelEditPlanHash(plan)) {
    throw new AgentContractError('PLAN_HASH_MISMATCH', 'The existing model edit plan no longer matches its review hash.');
  }
}

function normalizeExecutionContract(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'execution_contract must be an object.');
  }
  const saveModel = value.save_model !== false;
  const captureView = value.capture_view === true;
  const rawSavePath = value.save_path;
  if (rawSavePath !== undefined && rawSavePath !== null && (typeof rawSavePath !== 'string' || !rawSavePath.trim())) {
    throw new AgentContractError('INVALID_ARGUMENT', 'execution_contract.save_path must be a non-empty path when supplied.');
  }
  if (!saveModel && rawSavePath) {
    throw new AgentContractError('INVALID_ARGUMENT', 'execution_contract.save_path is not allowed when save_model=false.');
  }
  return {
    save_model: saveModel,
    save_path: saveModel && rawSavePath ? path.resolve(rawSavePath) : null,
    capture_view: captureView
  };
}

function bindExecutionContractToPlan(value, planId) {
  const requested = normalizeExecutionContract(value);
  return {
    ...requested,
    final_save_path: requested.save_model && requested.save_path
      ? versionedModelSavePath(requested.save_path, planId)
      : null,
    overwrite_existing: false
  };
}

function executionRequestContract(value = {}) {
  return normalizeExecutionContract({
    save_model: value.save_model,
    save_path: value.save_path,
    capture_view: value.capture_view
  });
}

function assertExecutionFinalPathBinding(value, planId) {
  const requested = executionRequestContract(value);
  const expectedFinalPath = requested.save_model && requested.save_path
    ? versionedModelSavePath(requested.save_path, planId)
    : null;
  if ((value.final_save_path ?? null) !== expectedFinalPath || value.overwrite_existing !== false) {
    throw new AgentContractError('PLAN_HASH_MISMATCH', 'The approved final save target no longer matches the versioned plan target.');
  }
}

export function versionedModelSavePath(requestedPath, label) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw new AgentContractError('INVALID_ARGUMENT', 'A non-empty requested save path is required.');
  }
  const expanded = path.resolve(requestedPath);
  const extension = path.extname(expanded) || '.skp';
  const stem = expanded.endsWith(extension) ? expanded.slice(0, -extension.length) : expanded;
  const safeLabel = String(label || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!safeLabel) throw new AgentContractError('INVALID_ARGUMENT', 'A non-empty version label is required.');
  return `${stem}-${safeLabel}${extension}`;
}

function validateReviewMetadata(review, plan) {
  if (!review) return;
  if (review.plan_id !== undefined && review.plan_id !== plan.plan_id) {
    throw new AgentContractError('APPROVAL_INVALID', 'Review metadata plan_id must match the existing model edit plan.');
  }
}

function summarizeIndexedTarget(entry) {
  if (!entry) return null;
  return {
    entity_path: entry.entity_path,
    persistent_id: entry.persistent_id || entry.id || null,
    entity_type: entry.entity_type,
    name: entry.name || null,
    definition_name: entry.definition_name || entry.definition || null,
    affected_instance_count: entry.affected_instance_count || 1,
    shared_definition: entry.shared_definition === true,
    allowed_operations: entry.allowed_operations || []
  };
}

function indexedAdoptionTargets(adoption) {
  const indexed = new Map();
  for (const entry of adoption.recursive_index || []) {
    if (entry.entity_path) indexed.set(`entity_path:${entry.entity_path}`, { ...entry });
  }
  for (const entry of adoption.structural_groups?.entries || []) {
    if (entry.entity_path) indexed.set(`entity_path:${entry.entity_path}`, {
      ...entry,
      validation_source: 'structural-groups.v1',
      allowed_operations: [...STRUCTURAL_GROUP_PREPARATION_OPERATIONS]
    });
  }
  for (const entry of adoption.entities || []) {
    const reference = entry.id || entry.persistent_id || entry.reference || entry.name;
    if (reference) indexed.set(`target_id:${reference}`, { ...entry, affected_instance_count: 1, shared_definition: false, allowed_operations: entry.allowed_operations || [] });
  }
  for (const entry of indexed.values()) {
    if (!entry.entity_path) {
      entry.effective_locked = entry.locked === true;
      entry.locked_ancestor_path = null;
      continue;
    }
    let parentPath = parentOccurrencePath(entry.entity_path);
    let lockedAncestorPath = null;
    while (parentPath) {
      const parent = indexed.get(`entity_path:${parentPath}`);
      if (!parent) break;
      if (parent.locked === true) {
        lockedAncestorPath = parentPath;
        break;
      }
      parentPath = parentOccurrencePath(parentPath);
    }
    entry.effective_locked = entry.effective_locked === true || entry.locked === true || lockedAncestorPath !== null;
    entry.locked_ancestor_path = lockedAncestorPath;
  }
  return indexed;
}

function parentOccurrencePath(entityPath) {
  const value = String(entityPath || '');
  if (value.startsWith('pid:')) {
    const segments = value.slice(4).split('.').filter(Boolean);
    return segments.length > 1 ? `pid:${segments.slice(0, -1).join('.')}` : null;
  }
  const segments = value.split('/').filter(Boolean);
  return segments.length > 1 ? segments.slice(0, -1).join('/') : null;
}

function targetIdentity(target) {
  return target.entity_path ? `entity_path:${target.entity_path}` : `target_id:${target.target_id}`;
}

function assertIterationReferencesMatchPlan(references, plan) {
  const expected = plan.targets.map(({ entity, ...target }) => executionTargetReference(target));
  const actual = (references || []).map(executionTargetReference);
  if (sha256Canonical(actual) !== sha256Canonical(expected)) {
    throw new AgentContractError('PLAN_HASH_MISMATCH', 'The iteration target references differ from the hash-bound reviewed plan.');
  }
}

function executionTargetReference(target = {}) {
  return {
    entity_path: target.entity_path,
    edit_scope: target.edit_scope,
    instance_policy: target.instance_policy,
    ...(target.instance_id ? { instance_id: target.instance_id } : {})
  };
}

function publicTargetReference(target) {
  return target.entity_path ? { entity_path: target.entity_path } : { target_id: target.target_id };
}

export function existingModelEditApprovalReviewContext(plan) {
  const geometryValidation = booleanGeometryValidationDisclosure(plan);
  const executionTargetValidation = existingModelEditExecutionTargetValidationPolicy(plan);
  return {
    kind: 'existing_model_edit_review_context',
    summary: '既有 SketchUp 模型修改',
    instruction: plan.instruction,
    content_trust: 'untrusted_data',
    policy_effect: 'none',
    affected_instance_count: plan.affected_instance_count,
    trusted_scope_approval_required: plan.trusted_scope_approval_required === true,
    ...(plan.target_validation ? { target_validation: plan.target_validation } : {}),
    execution_target_validation: {
      version: executionTargetValidation.version,
      mode: executionTargetValidation.mode,
      source: executionTargetValidation.source,
      leaf_entities_materialized: executionTargetValidation.leaf_entities_materialized,
      ...(executionTargetValidation.structural_group_limit
        ? { structural_group_limit: executionTargetValidation.structural_group_limit }
        : {})
    },
    targets: plan.targets.map((target) => ({
      ...publicTargetReference(target),
      entity_path: target.entity_path || target.entity?.entity_path || null,
      target_id: target.target_id || target.entity?.persistent_id || null,
      kind: target.entity?.entity_type || null,
      name: target.entity?.name || target.entity?.definition_name || null,
      edit_scope: target.edit_scope || null,
      instance_policy: target.instance_policy || null,
      affected_instance_count: target.entity?.affected_instance_count || 1,
      shared_definition: target.entity?.shared_definition === true
    })),
    destructive_side_effects: {
      version: plan.destructive_side_effects?.version || 'existing-model-edit-destructive-side-effects.v1',
      inference: plan.destructive_side_effects?.inference || 'server_adoption_index',
      expected_absent_targets: (plan.destructive_side_effects?.expected_absent_targets || []).map((target) => ({
        entity_path: target.entity_path,
        parent_entity_path: target.parent_entity_path || null,
        kind: target.entity?.entity_type || null,
        name: target.entity?.name || null,
        reason: target.reason,
        postcondition: target.postcondition,
        caused_by_absent_children: target.caused_by_absent_children || [],
        affected_instance_count: target.entity?.affected_instance_count || 1,
        content_trust: 'untrusted_data',
        policy_effect: 'none'
      }))
    },
    operations: plan.operation_contracts.map((contract) => approvalOperationSummary(
      contract,
      plan.dsl_document.operations[contract.index]
    )),
    ...(geometryValidation ? { geometry_validation: geometryValidation } : {}),
    execution: plan.execution_contract || null,
    ...(plan.trusted_model_copy_auto_approval ? {
      trusted_model_copy_auto_approval: {
        version: plan.trusted_model_copy_auto_approval.version,
        mode: plan.trusted_model_copy_auto_approval.mode,
        policy_scope_fingerprint: plan.trusted_model_copy_auto_approval.policy_scope_fingerprint,
        source_path_fingerprint: plan.trusted_model_copy_auto_approval.source_path_fingerprint,
        risk_level: plan.trusted_model_copy_auto_approval.risk_level,
        affected_instance_count: plan.trusted_model_copy_auto_approval.affected_instance_count,
        save_model: plan.trusted_model_copy_auto_approval.save_model,
        save_path_fingerprint: plan.trusted_model_copy_auto_approval.save_path_fingerprint
      }
    } : {})
  };
}

function modelSourcePathForAdoption(adoption) {
  return adoption?.model_identity?.source_path || adoption?.model_info?.source_path || '';
}

function booleanGeometryValidationDisclosure(plan) {
  if (!(plan.operation_contracts || []).some((contract) => contract.op === 'boolean_difference')) return null;
  return {
    evidence_kind: 'bbox_candidate_only',
    bbox_relation: 'positive_bbox_overlap_unverified',
    exact_solid_overlap: {
      status: 'unverified_before_atomic_trial',
      verified: false,
      verification_stage: 'review_gated_atomic_apply'
    },
    approved_action: 'review_gated_atomic_boolean_trial',
    success_preconditions: [
      'target_exact_volume_strictly_reduced',
      'result_manifold'
    ],
    failure_disposition: 'abort_before_commit'
  };
}

function approvalOperationSummary(contract, operation = {}) {
  const rawTools = operation.tools ?? operation.tool_ids ?? operation.toolIds ?? operation.tool_id ?? operation.toolId;
  const tools = (Array.isArray(rawTools) ? rawTools : (rawTools === undefined ? [] : [rawTools]))
    .map((tool) => typeof tool === 'object' && tool !== null
      ? (tool.entity_path || tool.entityPath || tool.target_id || tool.targetId || tool.id || null)
      : String(tool))
    .filter(Boolean);
  return {
    index: contract.index,
    op: contract.op,
    destructive: contract.destructive === true,
    topology: contract.topology === true,
    resource_mutation: contract.resource_mutation === true,
    resource_scope: contract.resource_scope || null,
    resource_name: contract.op === 'material' ? operation.name || null : null,
    color: contract.op === 'material' ? operation.color || null : null,
    alpha: contract.op === 'material' ? operation.alpha ?? null : null,
    target: operation.entity_path || operation.entityPath || operation.target_id || operation.targetId || null,
    tools,
    result_id: operation.result_id || operation.resultId || null,
    result_name: operation.result_name || operation.resultName || null,
    keep_originals: operation.keep_originals ?? operation.keepOriginals ?? null,
    keep_tools: operation.keep_tools ?? operation.keepTools ?? null
  };
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sortByPath(a, b) {
  return String(a.path).localeCompare(String(b.path));
}

function nonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${fieldName} must be a non-empty string`);
  return value.trim();
}

function positiveInteger(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${fieldName} must be a positive integer`);
  return parsed;
}

async function readJsonRequired(filePath, fieldName) {
  if (!filePath) throw new Error(`${fieldName} is required`);
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
