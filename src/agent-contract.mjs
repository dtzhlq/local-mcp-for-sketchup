import crypto from 'node:crypto';
import path from 'node:path';

export const AGENT_CONTRACT_VERSION = 'agent-contract.v1';

export const AGENT_TASK_STATES = Object.freeze([
  'created',
  'understanding',
  'awaiting_input',
  'awaiting_review',
  'approved',
  'executing',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'expired'
]);

export const TERMINAL_TASK_STATES = Object.freeze(new Set(['completed', 'failed', 'cancelled', 'expired']));

export const TASK_TRANSITIONS = Object.freeze({
  created: ['understanding', 'awaiting_input', 'cancelled', 'failed'],
  understanding: ['awaiting_input', 'awaiting_review', 'approved', 'executing', 'verifying', 'completed', 'failed', 'cancelled'],
  awaiting_input: ['understanding', 'awaiting_review', 'executing', 'cancelled', 'expired', 'failed'],
  awaiting_review: ['awaiting_input', 'approved', 'cancelled', 'expired', 'failed'],
  approved: ['awaiting_input', 'executing', 'cancelled', 'expired', 'failed'],
  executing: ['verifying', 'completed', 'failed'],
  verifying: ['awaiting_input', 'awaiting_review', 'completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
  expired: []
});

export const ERROR_CODE_REGISTRY = Object.freeze({
  INVALID_ARGUMENT: errorDefinition(false, { action: 'correct_input' }),
  TASK_NOT_FOUND: errorDefinition(false, { action: 'start_new_task' }),
  TASK_STATE_CONFLICT: errorDefinition(true, { action: 'resume_task' }),
  IDEMPOTENCY_CONFLICT: errorDefinition(false, { action: 'use_new_idempotency_key' }),
  APPROVAL_REQUIRED: errorDefinition(false, { action: 'request_user_approval' }),
  APPROVAL_TOKEN_FORBIDDEN: errorDefinition(false, { action: 'remove_approval_token_and_resume_task' }),
  APPROVAL_INVALID: errorDefinition(false, { action: 'request_user_approval' }),
  APPROVAL_EXPIRED: errorDefinition(false, { action: 'request_new_approval' }),
  APPROVAL_REPLAYED: errorDefinition(false, { action: 'resume_task' }),
  PLAN_HASH_MISMATCH: errorDefinition(false, { action: 'prepare_new_plan' }),
  MODEL_IDENTITY_MISMATCH: errorDefinition(true, { action: 'inspect_model_identity_then_prepare_new_plan' }),
  MODEL_REVISION_MISMATCH: errorDefinition(true, { action: 'prepare_new_plan' }),
  MODEL_REVISION_INCOMPLETE: errorDefinition(false, { action: 'inspect_revision_blockers' }),
  HANDSHAKE_REQUIRED: errorDefinition(false, { action: 'create_queue_handshake' }),
  HANDSHAKE_INVALID: errorDefinition(false, { action: 'create_queue_handshake' }),
  HANDSHAKE_EXPIRED: errorDefinition(false, { action: 'create_queue_handshake' }),
  HANDSHAKE_SESSION_MISMATCH: errorDefinition(false, { action: 'restart_bridge_then_create_queue_handshake' }),
  HANDSHAKE_DOCUMENT_MISMATCH: errorDefinition(false, { action: 'inspect_active_model_then_create_queue_handshake' }),
  HANDSHAKE_MODEL_IDENTITY_MISMATCH: errorDefinition(false, { action: 'inspect_active_model_then_create_queue_handshake' }),
  HANDSHAKE_MODEL_REVISION_MISMATCH: errorDefinition(false, { action: 'prepare_new_plan_then_create_queue_handshake' }),
  HANDSHAKE_SERVER_VERSION_MISMATCH: errorDefinition(false, { action: 'create_queue_handshake' }),
  HANDSHAKE_SERVER_RESTARTED: errorDefinition(false, { action: 'create_queue_handshake' }),
  HANDSHAKE_PLUGIN_VERSION_MISMATCH: errorDefinition(false, { action: 'restart_bridge_then_create_queue_handshake' }),
  HANDSHAKE_CAPABILITIES_MISMATCH: errorDefinition(false, { action: 'restart_bridge_then_create_queue_handshake' }),
  QUEUE_NOT_IDLE: errorDefinition(true, { action: 'wait_for_queue_idle_then_create_queue_handshake' }),
  QUEUE_LOCK_PRESENT: errorDefinition(true, { action: 'wait_for_queue_owner' }),
  QUEUE_STALE_LOCK: errorDefinition(false, { action: 'inspect_and_clear_stale_queue_lock' }),
  QUEUE_REQUESTS_PENDING: errorDefinition(false, { action: 'inspect_pending_queue_requests' }),
  QUEUE_RESPONSES_PENDING: errorDefinition(false, { action: 'inspect_orphan_queue_responses' }),
  OPERATION_NOT_ALLOWED: errorDefinition(false, { action: 'prepare_new_plan' }),
  POLICY_DENIED: errorDefinition(false, { action: 'request_policy_change' }),
  ARTIFACT_NOT_FOUND: errorDefinition(false, { action: 'resume_task' }),
  ARTIFACT_INTEGRITY_ERROR: errorDefinition(false, { action: 'reingest_artifact_and_report_corruption' }),
  MODEL_IDENTITY_UNAVAILABLE: errorDefinition(false, { action: 'inspect_model_identity_then_retry' }),
  MODEL_GRAPH_NOT_FOUND: errorDefinition(false, { action: 'rebuild_model_graph' }),
  MODEL_GRAPH_INTEGRITY_ERROR: errorDefinition(false, { action: 'rebuild_model_graph_and_report_corruption' }),
  MUTATION_RECOVERY_REQUIRED: errorDefinition(true, { action: 'resume_task_finalization' }),
  MUTATION_RECEIPT_INVALID: errorDefinition(false, { action: 'inspect_model_and_report_receipt_corruption' }),
  MUTATION_EXECUTION_FAILED: errorDefinition(false, { action: 'inspect_failure_then_start_new_task' }),
  INTERNAL_ERROR: errorDefinition(true, { action: 'retry_or_report' })
});

export class AgentContractError extends Error {
  constructor(code, message, { details, nextAction, cause } = {}) {
    const definition = ERROR_CODE_REGISTRY[code] || ERROR_CODE_REGISTRY.INTERNAL_ERROR;
    super(message, cause ? { cause } : undefined);
    this.name = 'AgentContractError';
    this.code = ERROR_CODE_REGISTRY[code] ? code : 'INTERNAL_ERROR';
    this.retryable = definition.retryable;
    this.next_action = nextAction || definition.next_action;
    if (details !== undefined) this.details = details;
  }
}

export function createResultEnvelope({
  task,
  ok = true,
  data = null,
  result,
  warnings,
  error = null,
  nextAction,
  artifacts,
  idempotentReplay = false
} = {}) {
  const normalizedError = error ? normalizeAgentError(error) : null;
  const normalizedResult = result === undefined ? data : result;
  return {
    contract_version: AGENT_CONTRACT_VERSION,
    kind: 'agent_result_envelope',
    ok: ok && !normalizedError,
    task_id: task?.task_id || null,
    task_state: task?.state || null,
    task_version: task?.task_version ?? null,
    retryable: normalizedError?.retryable ?? false,
    idempotent_replay: idempotentReplay === true,
    result: normalizedResult,
    data: normalizedResult,
    warnings: normalizeEnvelopeWarnings(warnings === undefined ? warningsFromResult(normalizedResult) : warnings),
    error: normalizedError,
    // An explicit null means the caller intentionally completed the current
    // action (for example, the final artifact page). Only an omitted value
    // inherits the task/error continuation.
    next_action: nextAction !== undefined
      ? nextAction
      : (task?.next_action ?? normalizedError?.next_action ?? null),
    artifacts: artifacts ?? task?.artifacts ?? []
  };
}

function warningsFromResult(result) {
  if (!result || typeof result !== 'object') return [];
  const warnings = [];
  for (const candidate of [result.warnings, result.snapshot?.warnings]) {
    if (Array.isArray(candidate)) warnings.push(...candidate.filter((item) => !['error', 'info'].includes(item?.severity)));
  }
  for (const candidate of [result.qa?.issues, result.report?.issues]) {
    if (Array.isArray(candidate)) warnings.push(...candidate.filter((item) => ['warn', 'warning'].includes(item?.severity)));
  }
  return warnings;
}

function normalizeEnvelopeWarnings(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map((warning) => {
    if (typeof warning === 'string') return { code: 'WARNING', message: warning, severity: 'warn' };
    return {
      code: String(warning?.code || warning?.type || warning?.category || 'WARNING'),
      message: String(warning?.message || warning?.code || warning?.type || 'Warning'),
      severity: 'warn',
      ...(warning?.source !== undefined ? { source: String(warning.source) } : {})
    };
  }).filter((warning) => {
    const fingerprint = `${warning.code}\u0000${warning.message}\u0000${warning.source || ''}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

export function normalizeAgentError(error) {
  const code = ERROR_CODE_REGISTRY[error?.code] ? error.code : 'INTERNAL_ERROR';
  const definition = ERROR_CODE_REGISTRY[code];
  return {
    code,
    message: code === 'INTERNAL_ERROR' ? 'The server could not complete the request.' : String(error?.message || code),
    retryable: error?.retryable ?? definition.retryable,
    next_action: error?.next_action || definition.next_action,
    ...(error?.details !== undefined ? { details: error.details } : {})
  };
}

export function assertTaskTransition(from, to) {
  if (!AGENT_TASK_STATES.includes(from) || !AGENT_TASK_STATES.includes(to) || !TASK_TRANSITIONS[from]?.includes(to)) {
    throw new AgentContractError('TASK_STATE_CONFLICT', `Task cannot transition from ${from} to ${to}.`, {
      details: { from, to, allowed: TASK_TRANSITIONS[from] || [] }
    });
  }
}

export function normalizeClientCapabilities(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    vision: source.vision === true,
    local_files: source.local_files === true,
    structured_output: source.structured_output === true,
    parallel: source.parallel === true,
    context: ['short', 'standard', 'long'].includes(source.context) ? source.context : 'short'
  };
}

export function normalizeExecutionPolicy(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const autoApprove = Array.isArray(source.auto_approve_risks)
    ? source.auto_approve_risks.filter((risk) => risk === 'S1')
    : [];
  const allowedRuntimes = Array.isArray(source.allowed_runtimes)
    ? source.allowed_runtimes.filter((runtime) => ['mock', 'queue'].includes(runtime))
    : ['mock'];
  const allowQueueMutation = source.allow_queue_mutation === true && allowedRuntimes.includes('queue');
  const resourceLimits = {
    max_operations: boundedPolicyInteger(source.resource_limits?.max_operations ?? source.max_operations, 100, 10_000),
    max_affected_instances: boundedPolicyInteger(source.resource_limits?.max_affected_instances ?? source.max_affected_instances, 200, 100_000),
    max_recursive_entities: boundedPolicyInteger(source.resource_limits?.max_recursive_entities ?? source.max_recursive_entities, 10_000, 100_000),
    auto_approve_s1_max_affected_instances: boundedPolicyInteger(source.resource_limits?.auto_approve_s1_max_affected_instances ?? source.auto_approve_s1_max_affected_instances, 1, 100_000)
  };
  resourceLimits.auto_approve_s1_max_affected_instances = Math.min(resourceLimits.auto_approve_s1_max_affected_instances, resourceLimits.max_affected_instances);
  const trustedModelCopyAutoApproval = normalizeTrustedModelCopyAutoApproval(
    source.trusted_model_copy_auto_approval,
    resourceLimits
  );
  return {
    policy_version: 'execution-policy.v1',
    auto_approve_risks: [...new Set(autoApprove)],
    allowed_runtimes: [...new Set(allowedRuntimes.length ? allowedRuntimes : ['mock'])],
    approval_required_risks: ['S2', 'S3', 'S4'],
    resource_limits: resourceLimits,
    allow_queue_mutation: allowQueueMutation,
    allow_direct_expert_queue_mutation: allowQueueMutation && source.allow_direct_expert_queue_mutation === true,
    trusted_model_copy_auto_approval: trustedModelCopyAutoApproval
  };
}

export function publicExecutionPolicy(policy) {
  const normalized = normalizeExecutionPolicy(policy);
  return {
    policy_version: normalized.policy_version,
    auto_approve_risks: normalized.auto_approve_risks,
    allowed_runtimes: normalized.allowed_runtimes,
    approval_required_risks: normalized.approval_required_risks,
    resource_limits: normalized.resource_limits,
    allow_queue_mutation: normalized.allow_queue_mutation,
    allow_direct_expert_queue_mutation: normalized.allow_direct_expert_queue_mutation,
    trusted_model_copy_auto_approval: publicTrustedModelCopyAutoApproval(normalized.trusted_model_copy_auto_approval),
    copy_fast_mode: publicCopyFastMode(normalized.trusted_model_copy_auto_approval)
  };
}

export function trustedModelCopyAutoApprovalBinding({
  executionPolicy,
  riskLevel,
  affectedInstanceCount,
  modelSourcePath,
  saveModel = false,
  savePath = null
} = {}) {
  const policy = executionPolicy?.trusted_model_copy_auto_approval;
  if (policy?.enabled !== true
    || !policy.allowed_risks?.includes(riskLevel)
    || !Number.isInteger(affectedInstanceCount)
    || affectedInstanceCount < 1
    || affectedInstanceCount > policy.max_affected_instances
    || (saveModel === true && policy.allow_save_model !== true)
    || typeof modelSourcePath !== 'string'
    || !modelSourcePath.trim()) return null;
  const sourcePath = path.resolve(modelSourcePath);
  const matchedRoot = policy.allowed_roots.find((root) => pathIsWithinRoot(sourcePath, root));
  if (!matchedRoot) return null;
  const resolvedSavePath = saveModel === true && typeof savePath === 'string' && savePath.trim()
    ? path.resolve(savePath)
    : null;
  if (resolvedSavePath && !pathIsWithinRoot(resolvedSavePath, matchedRoot)) return null;
  const core = {
    version: 'trusted-model-copy-auto-approval.v1',
    mode: 'server_user_execution_policy',
    policy_scope_fingerprint: policy.scope_fingerprint,
    source_path_fingerprint: sha256Canonical({ kind: 'model_source_path', value: sourcePath }),
    matched_root_fingerprint: sha256Canonical({ kind: 'trusted_model_copy_root', value: matchedRoot }),
    risk_level: riskLevel,
    affected_instance_count: affectedInstanceCount,
    save_model: saveModel === true,
    save_path_fingerprint: resolvedSavePath
      ? sha256Canonical({ kind: 'copy_fast_save_path', value: resolvedSavePath })
      : null
  };
  return { ...core, binding_hash: sha256Canonical(core) };
}

export function copyFastTrustedScopeBindingHash(binding) {
  return sha256Canonical({
    kind: 'copy_fast_trusted_scope',
    version: binding?.version,
    mode: binding?.mode,
    policy_scope_fingerprint: binding?.policy_scope_fingerprint,
    source_path_fingerprint: binding?.source_path_fingerprint,
    matched_root_fingerprint: binding?.matched_root_fingerprint
  });
}

export function serverPolicyAutoApprovalMode(plan, executionPolicy) {
  if (plan?.auto_approval_eligible !== true) return null;
  const binding = plan.trusted_model_copy_auto_approval;
  const policy = executionPolicy?.trusted_model_copy_auto_approval;
  let trustedCopyBindingValid = false;
  if (binding?.version === 'trusted-model-copy-auto-approval.v1'
    && binding.mode === 'server_user_execution_policy') {
    const { binding_hash: ignored, ...bindingCore } = binding;
    trustedCopyBindingValid = binding.policy_scope_fingerprint === policy?.scope_fingerprint
      && policy?.allowed_risks?.includes(plan.risk_level)
      && binding.risk_level === plan.risk_level
      && binding.affected_instance_count === plan.affected_instance_count
      && binding.save_model === (plan.execution_contract?.save_model === true)
      && binding.save_path_fingerprint === copyFastSavePathFingerprint(plan.execution_contract?.save_path)
      && binding.affected_instance_count <= policy.max_affected_instances
      && (!binding.save_model || policy.allow_save_model === true)
      && binding.binding_hash === sha256Canonical(bindingCore);
  }
  if (trustedCopyBindingValid) {
    return plan.execution_mode === 'copy_fast'
      && plan.review_required === false
      && plan.user_action_required === false
      && validCopyFastSessionBinding(plan.copy_fast_session, binding, plan)
      ? 'copy_fast_session'
      : null;
  }
  if (plan.risk_level === 'S1' && executionPolicy?.auto_approve_risks?.includes('S1')) {
    return 'server_policy_s1';
  }
  return null;
}

function copyFastSavePathFingerprint(value) {
  return typeof value === 'string' && value.trim()
    ? sha256Canonical({ kind: 'copy_fast_save_path', value: path.resolve(value) })
    : null;
}

function normalizeTrustedModelCopyAutoApproval(value, resourceLimits) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowedRoots = Array.isArray(source.allowed_roots)
    ? [...new Set(source.allowed_roots
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => path.resolve(entry)))]
    : [];
  const allowedRisks = Array.isArray(source.allowed_risks)
    ? [...new Set(source.allowed_risks.filter((risk) => ['S1', 'S2', 'S3', 'S4'].includes(risk)))]
    : [];
  const maxAffectedInstances = Math.min(
    boundedPolicyInteger(source.max_affected_instances, 1, 100_000),
    resourceLimits.max_affected_instances
  );
  const allowSaveModel = source.allow_save_model === true;
  const sessionTtlMs = boundedCopyFastSessionTtl(source.session_ttl_ms);
  const enabled = source.enabled === true && allowedRoots.length > 0 && allowedRisks.length > 0;
  const scopeCore = {
    version: 'trusted-model-copy-auto-approval-policy.v1',
    enabled,
    allowed_roots: allowedRoots,
    allowed_risks: allowedRisks,
    max_affected_instances: maxAffectedInstances,
    allow_save_model: allowSaveModel,
    session_ttl_ms: sessionTtlMs
  };
  return { ...scopeCore, scope_fingerprint: sha256Canonical(scopeCore) };
}

function publicTrustedModelCopyAutoApproval(policy) {
  return {
    version: policy.version,
    enabled: policy.enabled,
    allowed_risks: policy.allowed_risks,
    allowed_root_count: policy.allowed_roots.length,
    max_affected_instances: policy.max_affected_instances,
    allow_save_model: policy.allow_save_model,
    session_ttl_ms: policy.session_ttl_ms,
    scope_fingerprint: policy.scope_fingerprint
  };
}

function publicCopyFastMode(policy) {
  return {
    version: 'copy-fast-mode.v1',
    enabled: policy.enabled,
    activation: 'server_verified_copy_root',
    session_scope: 'current_server_process_and_model_copy',
    allowed_risks: policy.allowed_risks,
    allowed_root_count: policy.allowed_roots.length,
    max_affected_instances: policy.max_affected_instances,
    allow_save_model: policy.allow_save_model,
    session_ttl_ms: policy.session_ttl_ms,
    user_action_required_per_edit: false,
    agent_can_enable: false
  };
}

function validCopyFastSessionBinding(session, trustedBinding, plan) {
  if (!session
    || session.version !== 'copy-fast-session.v1'
    || session.kind !== 'copy_fast_session'
    || !/^copy_session_[0-9a-f-]+$/.test(String(session.session_id || ''))
    || typeof session.authority_session_id !== 'string'
    || !session.authority_session_id
    || session.policy_scope_fingerprint !== trustedBinding.policy_scope_fingerprint
    || session.trusted_scope_binding_hash !== copyFastTrustedScopeBindingHash(trustedBinding)
    || session.source_path_fingerprint !== trustedBinding.source_path_fingerprint
    || session.matched_root_fingerprint !== trustedBinding.matched_root_fingerprint
    || !/^model_[0-9a-f]{32}$/.test(String(session.model_key || ''))
    || session.model_key !== plan.model_key
    || !['mock', 'queue'].includes(session.runtime)
    || session.runtime !== plan.runtime
    || !/^sha256:[0-9a-f]{64}$/.test(String(session.initial_model_revision || ''))
    || !Number.isFinite(Date.parse(session.issued_at))
    || !Number.isFinite(Date.parse(session.expires_at))
    || Date.parse(session.expires_at) <= Date.parse(session.issued_at)
    || !/^sha256:[0-9a-f]{64}$/.test(String(session.binding_hash || ''))) return false;
  const { binding_hash: ignored, ...core } = session;
  return session.binding_hash === sha256Canonical(core);
}

function boundedCopyFastSessionTtl(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 8 * 60 * 60 * 1000;
  return Math.max(5 * 60 * 1000, Math.min(parsed, 24 * 60 * 60 * 1000));
}

function pathIsWithinRoot(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function markUntrustedData(value, source = 'agent_or_model_content') {
  return {
    trust: 'untrusted_data',
    source,
    value,
    policy_effect: 'none'
  };
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function fingerprintRequest(value) {
  return sha256Canonical(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function errorDefinition(retryable, nextAction) {
  return Object.freeze({ retryable, next_action: Object.freeze(nextAction) });
}

function boundedPolicyInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}
