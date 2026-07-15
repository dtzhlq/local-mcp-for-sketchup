import crypto from 'node:crypto';

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
  understanding: ['awaiting_input', 'awaiting_review', 'executing', 'verifying', 'completed', 'failed', 'cancelled'],
  awaiting_input: ['understanding', 'awaiting_review', 'executing', 'cancelled', 'expired', 'failed'],
  awaiting_review: ['approved', 'cancelled', 'expired', 'failed'],
  approved: ['executing', 'cancelled', 'expired', 'failed'],
  executing: ['verifying', 'completed', 'failed'],
  verifying: ['awaiting_review', 'completed', 'failed'],
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
  APPROVAL_INVALID: errorDefinition(false, { action: 'request_user_approval' }),
  APPROVAL_EXPIRED: errorDefinition(false, { action: 'request_new_approval' }),
  APPROVAL_REPLAYED: errorDefinition(false, { action: 'resume_task' }),
  PLAN_HASH_MISMATCH: errorDefinition(false, { action: 'prepare_new_plan' }),
  MODEL_REVISION_MISMATCH: errorDefinition(true, { action: 'prepare_new_plan' }),
  OPERATION_NOT_ALLOWED: errorDefinition(false, { action: 'prepare_new_plan' }),
  POLICY_DENIED: errorDefinition(false, { action: 'request_policy_change' }),
  ARTIFACT_NOT_FOUND: errorDefinition(false, { action: 'resume_task' }),
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
  error = null,
  nextAction,
  artifacts,
  idempotentReplay = false
} = {}) {
  const normalizedError = error ? normalizeAgentError(error) : null;
  return {
    contract_version: AGENT_CONTRACT_VERSION,
    kind: 'agent_result_envelope',
    ok: ok && !normalizedError,
    task_id: task?.task_id || null,
    task_state: task?.state || null,
    task_version: task?.task_version ?? null,
    retryable: normalizedError?.retryable ?? false,
    idempotent_replay: idempotentReplay === true,
    data,
    error: normalizedError,
    next_action: nextAction ?? task?.next_action ?? normalizedError?.next_action ?? null,
    artifacts: artifacts ?? task?.artifacts ?? []
  };
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
  return {
    policy_version: 'execution-policy.v1',
    auto_approve_risks: [...new Set(autoApprove)],
    allowed_runtimes: [...new Set(allowedRuntimes.length ? allowedRuntimes : ['mock'])],
    approval_required_risks: ['S2', 'S3', 'S4'],
    allow_queue_mutation: source.allow_queue_mutation === true && allowedRuntimes.includes('queue')
  };
}

export function publicExecutionPolicy(policy) {
  const normalized = normalizeExecutionPolicy(policy);
  return {
    policy_version: normalized.policy_version,
    auto_approve_risks: normalized.auto_approve_risks,
    allowed_runtimes: normalized.allowed_runtimes,
    approval_required_risks: normalized.approval_required_risks,
    allow_queue_mutation: normalized.allow_queue_mutation
  };
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
