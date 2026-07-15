import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';

export const EXISTING_MODEL_EDIT_PLAN_VERSION = '2026-07-existing-model-edit-plan.1';

const RISK_BY_OPERATION = Object.freeze({
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
const CONFIRMED_OPERATIONS = new Set(['reverse_face', 'pushpull_face', 'replace_component_definition', 'explode_entity', 'erase_entities', 'transform_entities']);

export function existingModelEditRiskForOperation(operation) {
  return RISK_BY_OPERATION[operation] || 'S4';
}

export async function prepareExistingModelEdit({ bridge, runtime = 'mock', timeoutMs, instruction, operations, targets, output_dir, recursive_limit = 2000, budgets = {}, task_id = null, approval_expires_ms } = {}) {
  if (!bridge) throw new Error('prepare_existing_model_edit requires a bridge');
  const normalizedInstruction = nonEmptyString(instruction, 'prepare_existing_model_edit.instruction');
  const normalizedOperations = normalizeOperations(operations);
  const normalizedBudgets = normalizeBudgets(budgets);
  if (normalizedOperations.length > normalizedBudgets.max_operations) throw new Error('existing model edit exceeds budgets.max_operations');

  const adoption = await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, recursive_limit });
  const indexed = indexedAdoptionTargets(adoption);
  const requestedTargets = normalizeTargets(targets, normalizedOperations);
  const blockers = [];
  if (adoption.recursive_truncated) blockers.push({ code: 'recursive_index_truncated', message: 'Recursive entity index was truncated; increase recursive_limit before review.' });
  for (const target of requestedTargets) {
    if (!indexed.has(targetIdentity(target))) blockers.push({ code: 'target_not_indexed', target: publicTargetReference(target), message: 'Target is not present in the current adoption index.' });
  }
  const affectedInstances = requestedTargets.reduce((sum, target) => sum + Number(indexed.get(targetIdentity(target))?.affected_instance_count || 1), 0);
  if (affectedInstances > normalizedBudgets.max_affected_instances) blockers.push({ code: 'affected_instance_budget_exceeded', actual: affectedInstances, limit: normalizedBudgets.max_affected_instances });

  const operationContracts = normalizedOperations.map((operation, index) => ({
    index,
    op: operation.op,
    risk: RISK_BY_OPERATION[operation.op] || 'S4',
    destructive: ['delete', 'erase_entities', 'explode_entity'].includes(operation.op),
    topology: ['reverse_face', 'pushpull_face', 'transform_entities', 'erase_entities', 'cut_hole', 'cut_slot', 'cut_recess', 'add_boss', 'add_raised_rib', 'boolean_union', 'boolean_difference', 'boolean_intersect', 'manifold_repair'].includes(operation.op)
  }));
  const riskLevel = operationContracts.reduce((highest, contract) => RISK_ORDER[contract.risk] > RISK_ORDER[highest] ? contract.risk : highest, 'S1');
  const modelRevision = modelRevisionForAdoption(adoption);
  const planCore = {
    version: EXISTING_MODEL_EDIT_PLAN_VERSION,
    instruction: normalizedInstruction,
    runtime,
    model_revision: modelRevision,
    risk_level: riskLevel,
    review_required: true,
    targets: requestedTargets.map((target) => ({
      ...target,
      entity: summarizeIndexedTarget(indexed.get(targetIdentity(target)))
    })),
    operation_contracts: operationContracts,
    dsl_document: { version: 1, units: 'mm', operations: normalizedOperations },
    budgets: normalizedBudgets,
    affected_instance_count: affectedInstances,
    blockers
  };
  const planId = hashJson(planCore).slice(0, 24);
  const planWithoutHash = {
    kind: 'existing_model_edit_plan',
    plan_id: `existing-edit-${planId}`,
    task_id,
    created_at: new Date().toISOString(),
    compile_permission: blockers.length ? 'blocked' : 'ready_for_review',
    ...planCore
  };
  const plan = { ...planWithoutHash, plan_hash: existingModelEditPlanHash(planWithoutHash) };
  const outputDir = path.resolve(output_dir || path.join('output', 'existing-model-edits', plan.plan_id, 'prepare'));
  await fs.mkdir(outputDir, { recursive: true });
  const artifacts = {
    plan: path.join(outputDir, 'existing-model-edit-plan.json'),
    adoption_index: path.join(outputDir, 'adoption-index.json'),
    manifest: path.join(outputDir, 'prepare-manifest.json'),
    ...(plan.compile_permission === 'ready_for_review' ? { approval_challenge: path.join(outputDir, 'approval-challenge.json') } : {})
  };
  const approvalChallenge = plan.compile_permission === 'ready_for_review'
    ? await bridge.approvalAuthority.createChallenge({
      taskId: task_id,
      planId: plan.plan_id,
      planHash: plan.plan_hash,
      modelRevision: plan.model_revision,
      riskLevel: plan.risk_level,
      allowedOperations: plan.dsl_document.operations.map((operation) => operation.op),
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
      mode: plan.risk_level === 'S1' ? 'trusted_token_or_server_auto_policy' : 'trusted_token_required',
      challenge_id: approvalChallenge.challenge_id,
      expires_at: approvalChallenge.expires_at
    } : null,
    blockers,
    artifacts
  });
  return { kind: 'prepare_existing_model_edit', plan, approval_challenge: approvalChallenge, artifacts };
}

export async function applyReviewedExistingModelEdit({ bridge, runtime = 'mock', timeoutMs, plan, plan_file, review, review_file, approval_token, output_dir, save_model = true, save_path, capture_view = false } = {}) {
  if (!bridge) throw new Error('apply_reviewed_model_edit requires a bridge');
  const loadedPlan = plan || await readJsonRequired(plan_file, 'apply_reviewed_model_edit.plan_file');
  const suppliedReview = review || (review_file ? await readJsonRequired(review_file, 'apply_reviewed_model_edit.review_file') : null);
  validatePlan(loadedPlan);
  validateReviewMetadata(suppliedReview, loadedPlan);
  if (loadedPlan.blockers?.length) throw new Error(`existing model edit plan is blocked: ${loadedPlan.blockers.map((item) => item.code).join(', ')}`);

  const autoApproved = loadedPlan.risk_level === 'S1' && bridge.executionPolicy.auto_approve_risks.includes('S1');
  if (!autoApproved && !approval_token) {
    throw new AgentContractError('APPROVAL_REQUIRED', 'A trusted approval token is required; Agent-supplied review fields are not execution authorization.', {
      details: { plan_id: loadedPlan.plan_id, risk_level: loadedPlan.risk_level }
    });
  }

  const adoption = await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, recursive_limit: loadedPlan.budgets?.recursive_limit || 2000 });
  const currentRevision = modelRevisionForAdoption(adoption);
  if (currentRevision !== loadedPlan.model_revision) {
    throw new AgentContractError('MODEL_REVISION_MISMATCH', 'The model changed after the plan was prepared.', {
      details: { expected: loadedPlan.model_revision, actual: currentRevision }
    });
  }

  const authorization = autoApproved
    ? {
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
        allowed_operations: loadedPlan.dsl_document.operations.map((operation) => operation.op)
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

  const operations = loadedPlan.dsl_document.operations.map((operation) => CONFIRMED_OPERATIONS.has(operation.op) ? { ...operation, confirmed: true } : operation);
  const targets = loadedPlan.targets.map(({ entity, ...target }) => target);
  const outputDir = path.resolve(output_dir || path.join('output', 'existing-model-edits', loadedPlan.plan_id, 'apply'));
  await fs.mkdir(outputDir, { recursive: true });
  const reviewArtifact = path.join(outputDir, 'review-decision.json');
  await writeJson(reviewArtifact, { ...trustedReview, authorization });
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
    budgets: loadedPlan.budgets
  });
  const result = {
    kind: 'apply_reviewed_model_edit',
    ok: true,
    plan_id: loadedPlan.plan_id,
    reviewed_by: trustedReview.reviewer,
    risk_level: loadedPlan.risk_level,
    model_revision_before: currentRevision,
    review: trustedReview,
    authorization: {
      mode: authorization.mode,
      approved_by: authorization.approved_by,
      approved_at: authorization.approved_at,
      ...(authorization.challenge_id ? { challenge_id: authorization.challenge_id } : {})
    },
    iteration,
    artifacts: { ...iteration.artifacts, review: reviewArtifact }
  };
  await writeJson(path.join(outputDir, 'apply-result.json'), result);
  return result;
}

export function modelRevisionForAdoption(adoption) {
  const stable = {
    entities: (adoption.entities || []).map(stableEntity).sort(sortByPath),
    recursive: (adoption.recursive_index || []).map(stableEntity).sort(sortByPath),
    totals: adoption.snapshot?.totals || null,
    materials: [...(adoption.snapshot?.materials || [])].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    tags: [...(adoption.snapshot?.tags || [])].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    scenes: [...(adoption.snapshot?.scenes || [])].sort((left, right) => String(left.name).localeCompare(String(right.name))),
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
    model_revision: plan.model_revision,
    risk_level: plan.risk_level,
    review_required: plan.review_required,
    targets: plan.targets,
    operation_contracts: plan.operation_contracts,
    dsl_document: plan.dsl_document,
    budgets: plan.budgets,
    affected_instance_count: plan.affected_instance_count,
    blockers: plan.blockers,
    compile_permission: plan.compile_permission
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
    bbox: entity.bounding_box || null,
    faces: entity.faces ?? null,
    edges: entity.edges ?? null,
    soft: entity.soft ?? null,
    smooth: entity.smooth ?? null,
    locked: entity.locked === true,
    classification: entity.classification || null,
    attributes: entity.attributes || null,
    texture_transform: entity.texture_transform || null,
    face_uvs: entity.face_uvs || null,
    features: entity.features || null,
    transform: entity.transform || null
  };
}

function normalizeOperations(operations) {
  if (!Array.isArray(operations) || !operations.length) throw new Error('prepare_existing_model_edit.operations must be a non-empty array');
  return operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error(`prepare_existing_model_edit.operations[${index}] must be an object`);
    const op = nonEmptyString(operation.op, `prepare_existing_model_edit.operations[${index}].op`);
    if (op === 'reset') throw new Error('prepare_existing_model_edit does not allow reset');
    return structuredClone({ ...operation, op });
  });
}

function normalizeTargets(targets, operations) {
  const raw = targets?.length ? targets : extractTargets(operations);
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

function normalizeBudgets(value = {}) {
  return {
    max_operations: positiveInteger(value.max_operations ?? value.maxOperations ?? 100, 'budgets.max_operations'),
    max_affected_instances: positiveInteger(value.max_affected_instances ?? value.maxAffectedInstances ?? 200, 'budgets.max_affected_instances'),
    recursive_limit: positiveInteger(value.recursive_limit ?? value.recursiveLimit ?? 2000, 'budgets.recursive_limit'),
    ...(value.max_faces !== undefined ? { max_faces: positiveInteger(value.max_faces, 'budgets.max_faces') } : {}),
    ...(value.max_edges !== undefined ? { max_edges: positiveInteger(value.max_edges, 'budgets.max_edges') } : {})
  };
}

function validatePlan(plan) {
  if (plan?.kind !== 'existing_model_edit_plan' || plan.version !== EXISTING_MODEL_EDIT_PLAN_VERSION) throw new Error('apply_reviewed_model_edit requires a compatible existing model edit plan');
  if (plan.compile_permission !== 'ready_for_review') throw new Error('existing model edit plan is not ready for review');
  if (!plan.plan_hash || plan.plan_hash !== existingModelEditPlanHash(plan)) {
    throw new AgentContractError('PLAN_HASH_MISMATCH', 'The existing model edit plan no longer matches its review hash.');
  }
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
    if (entry.entity_path) indexed.set(`entity_path:${entry.entity_path}`, entry);
  }
  for (const entry of adoption.entities || []) {
    const reference = entry.id || entry.persistent_id || entry.reference || entry.name;
    if (reference) indexed.set(`target_id:${reference}`, { ...entry, affected_instance_count: 1, shared_definition: false, allowed_operations: entry.allowed_operations || [] });
  }
  return indexed;
}

function targetIdentity(target) {
  return target.entity_path ? `entity_path:${target.entity_path}` : `target_id:${target.target_id}`;
}

function publicTargetReference(target) {
  return target.entity_path ? { entity_path: target.entity_path } : { target_id: target.target_id };
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
