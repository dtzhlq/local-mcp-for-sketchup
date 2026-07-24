import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';
import { modelRevisionForAdoption } from './existing-model-editing.mjs';
import { AGENT_GATEWAY_TOOL_NAMES } from './tool-registry.mjs';

const PROFILE_DEFINITIONS = Object.freeze({
  L0: Object.freeze({
    capabilities: Object.freeze({ vision: false, local_files: false, structured_output: false, context: 'short', parallel: false }),
    maxContextChars: 4096,
    maxInFlight: 1
  }),
  L1: Object.freeze({
    capabilities: Object.freeze({ vision: false, local_files: false, structured_output: true, context: 'standard', parallel: false }),
    maxContextChars: 16384,
    maxInFlight: 1
  }),
  L2: Object.freeze({
    capabilities: Object.freeze({ vision: true, local_files: true, structured_output: true, context: 'long', parallel: true }),
    maxContextChars: 65536,
    maxInFlight: 4
  })
});

const ACTORS = new Set(['agent', 'fixture', 'trusted_host']);
const RISK_LEVELS_REQUIRING_APPROVAL = new Set(['S2', 'S3', 'S4']);
const PATH_KEY = /(^|_)(path|dir|directory|file)$/i;
const CAMEL_CASE_PATH_KEY = /(Path|Dir|Directory|File)$/;
const IMAGE_CONTENT_KEY = /(^|_)(image_bytes|image_base64|pixel_data|pixels)$/i;

export class CapabilityProfile {
  constructor(level) {
    const normalized = String(level || '');
    const definition = PROFILE_DEFINITIONS[normalized];
    if (!definition) throw new TypeError(`Unknown Agent capability level: ${normalized || '<empty>'}`);
    this.version = 'agent-capability-profile.v1';
    this.level = normalized;
    this.capabilities = definition.capabilities;
    this.maxContextChars = definition.maxContextChars;
    this.maxInFlight = definition.maxInFlight;
    this.allowedTools = Object.freeze([...AGENT_GATEWAY_TOOL_NAMES]);
    Object.freeze(this);
  }

  static forLevel(level) {
    return new CapabilityProfile(level);
  }

  clientCapabilities() {
    return structuredClone(this.capabilities);
  }

  reportConstraints({ enforced = true } = {}) {
    return {
      context: { declared: this.capabilities.context, max_chars: this.maxContextChars, enforced },
      local_files: { declared: this.capabilities.local_files, enforced },
      vision: { declared: this.capabilities.vision, enforced },
      structured_output: { declared: this.capabilities.structured_output, enforced },
      parallel: { declared: this.capabilities.parallel, enforced },
      max_in_flight: { limit: this.maxInFlight, enforced },
      tool_surface: { declared: 'agent_gateway', allowed_tools: [...this.allowedTools], enforced }
    };
  }
}

export const AGENT_CAPABILITY_PROFILES = Object.freeze(Object.fromEntries(
  Object.keys(PROFILE_DEFINITIONS).map((level) => [level, new CapabilityProfile(level)])
));

export class CapabilityConstrainedToolClient {
  constructor({ dispatcher, profile = 'L0', allowedTools, state, faultInjector } = {}) {
    if (!dispatcher || typeof dispatcher.dispatch !== 'function') throw new TypeError('CapabilityConstrainedToolClient requires a dispatcher.');
    this.dispatcher = dispatcher;
    this.profile = profile instanceof CapabilityProfile ? profile : CapabilityProfile.forLevel(profile);
    this.allowedTools = new Set(allowedTools || this.profile.allowedTools);
    this.state = state || new VolatileAgentState();
    this.faultInjector = faultInjector || new FaultInjector({ state: this.state });
    this.inFlight = 0;
    this.counts = { agent: 0, agent_artifact_pages: 0, fixture: 0, trusted_host: 0 };
    this.serialization = { text_only_round_trips: 0, text_only_round_trip_failures: 0 };
    this.violations = [];
  }

  async call(tool, args = {}) {
    const result = await this.callAs('agent', tool, args);
    if (this.profile.capabilities.structured_output) return result;
    return this.textOnlyRoundTrip(tool, result);
  }

  async fixtureCall(tool, args = {}) {
    return this.callAs('fixture', tool, args);
  }

  async trustedHostCall(tool, args = {}) {
    return this.callAs('trusted_host', tool, args);
  }

  recordExternalCall(actor, label = 'external') {
    requireActor(actor);
    this.counts[actor] += 1;
    return { actor, label, counted: true };
  }

  async callAs(actor, tool, args = {}) {
    requireActor(actor);
    this.counts[actor] += 1;
    if (actor === 'agent' && tool === 'read_agent_artifact') this.counts.agent_artifact_pages += 1;
    if (actor !== 'agent') return this.dispatcher.dispatch(tool, structuredClone(args), { actor, profile: null });

    if (!this.allowedTools.has(tool)) {
      throw this.constraintError('tool_surface', tool, 'input', {
        message: `Tool ${String(tool)} is outside the ${this.profile.level} Agent surface.`,
        observed: String(tool),
        allowed: [...this.allowedTools]
      });
    }
    if (this.inFlight >= this.profile.maxInFlight) {
      throw this.constraintError('max_in_flight', tool, 'input', {
        message: `${this.profile.level} permits at most ${this.profile.maxInFlight} in-flight Agent tool call(s).`,
        limit: this.profile.maxInFlight,
        observed: this.inFlight + 1
      });
    }

    const preparedArgs = structuredClone(args);
    if (tool === 'start_agent_task') preparedArgs.client_capabilities = this.profile.clientCapabilities();
    if (!this.profile.capabilities.local_files) {
      const pathLeak = findPathContent(preparedArgs);
      if (pathLeak) {
        throw this.constraintError('local_files', tool, 'input', {
          message: `${this.profile.level} cannot supply a local filesystem path.`,
          path: pathLeak.path
        });
      }
    }
    if (!this.profile.capabilities.vision) {
      const imageContent = findImageContent(preparedArgs);
      if (imageContent) {
        throw this.constraintError('vision', tool, 'input', {
          message: `${this.profile.level} cannot supply raw image content.`,
          path: imageContent.path
        });
      }
    }

    this.inFlight += 1;
    try {
      const result = await this.dispatcher.dispatch(tool, preparedArgs, { actor: 'agent', profile: this.profile.level });
      await this.faultInjector.interceptResponse(tool, result);
      if (!this.profile.capabilities.local_files) {
        const pathLeak = findPathContent(result);
        if (pathLeak) {
          throw this.constraintError('local_files', tool, 'output', {
            message: `${this.profile.level} received a local filesystem path instead of an opaque artifact handle.`,
            path: pathLeak.path,
            next_action: { action: 'return_opaque_artifact_handle' }
          });
        }
      }
      if (!this.profile.capabilities.vision) {
        const imageContent = findImageContent(result);
        if (imageContent) {
          throw this.constraintError('vision', tool, 'output', {
            message: `${this.profile.level} received raw image content instead of a structured summary.`,
            path: imageContent.path,
            next_action: { action: 'return_structured_image_summary' }
          });
        }
      }
      const observedChars = serializedChars(result);
      if (observedChars > this.profile.maxContextChars) {
        throw this.constraintError('context_budget', tool, 'output', {
          message: `${this.profile.level} result exceeds its declared context budget.`,
          limit: this.profile.maxContextChars,
          observed: observedChars,
          next_action: { action: 'spill_result_to_artifact', max_chars: this.profile.maxContextChars }
        });
      }
      return result;
    } finally {
      this.inFlight -= 1;
    }
  }

  accounting() {
    return {
      agent_tool_calls: this.counts.agent,
      artifact_page_tool_calls: this.counts.agent_artifact_pages,
      fixture_calls: this.counts.fixture,
      trusted_host_calls: this.counts.trusted_host,
      text_only_round_trips: this.serialization.text_only_round_trips,
      text_only_round_trip_failures: this.serialization.text_only_round_trip_failures,
      capability_violations: this.violations.length
    };
  }

  textOnlyRoundTrip(tool, result) {
    try {
      assertStrictJsonTextValue(result);
      const wireText = canonicalJson(result);
      if (typeof wireText !== 'string' || wireText.length > this.profile.maxContextChars) {
        throw new Error('The canonical JSON text response is missing or exceeds the context budget.');
      }
      const decoded = JSON.parse(wireText);
      if (sha256Canonical(decoded) !== sha256Canonical(result)) {
        throw new Error('The canonical JSON text response was not lossless.');
      }
      this.serialization.text_only_round_trips += 1;
      return decoded;
    } catch (error) {
      this.serialization.text_only_round_trip_failures += 1;
      throw this.constraintError('structured_output', tool, 'output', {
        message: `${this.profile.level} could not consume the tool result through the required lossless JSON-text boundary.`,
        observed: error?.message || String(error),
        next_action: { action: 'return_json_text_compatible_result' }
      });
    }
  }

  constraintError(constraint, tool, direction, details) {
    const violation = {
      version: 'agent-capability-violation.v1',
      kind: 'capability_constraint_violation',
      level: this.profile.level,
      constraint,
      direction,
      tool: String(tool || ''),
      message: details.message,
      ...(details.limit !== undefined ? { limit: details.limit } : {}),
      ...(details.observed !== undefined ? { observed: details.observed } : {}),
      ...(details.allowed !== undefined ? { allowed: details.allowed } : {}),
      ...(details.path !== undefined ? { path: details.path } : {}),
      ...(details.next_action !== undefined ? { next_action: details.next_action } : {})
    };
    this.violations.push(violation);
    return new CapabilityConstraintError(violation);
  }
}

/**
 * Server-side adapter used by the compatibility harness. It makes the mock-only
 * boundary explicit, preserves immutable image handles without exposing local
 * paths to the Agent, and spills oversized Agent results into server artifacts
 * before the capability client applies its context budget.
 */
export class MockOnlyCapabilityDispatcher {
  constructor({ dispatcher, taskStore, imageArtifactStore, artifactRoot } = {}) {
    if (!dispatcher || typeof dispatcher.dispatch !== 'function') throw new TypeError('MockOnlyCapabilityDispatcher requires a dispatcher.');
    if (!taskStore || typeof taskStore.getTask !== 'function' || typeof taskStore.registerArtifact !== 'function') {
      throw new TypeError('MockOnlyCapabilityDispatcher requires an AgentTaskStore-compatible taskStore.');
    }
    this.dispatcher = dispatcher;
    this.taskStore = taskStore;
    this.imageArtifactStore = imageArtifactStore || null;
    this.artifactRoot = path.resolve(artifactRoot || path.join(taskStore.rootDir, 'compatibility-projections'));
  }

  async dispatch(tool, args = {}, context = {}) {
    assertMockOnly(tool, args);
    const materialized = context.actor === 'agent'
      ? await this.materializeOpaqueInputs(args)
      : structuredClone(args);
    const result = await this.dispatcher.dispatch(tool, materialized, context);
    if (context.actor !== 'agent') return result;
    const profile = CapabilityProfile.forLevel(context.profile);
    return this.presentAgentResult(result, profile);
  }

  async registerServerArtifact(taskId, { filePath, kind = 'binary', mediaType = 'application/octet-stream', label } = {}) {
    return this.taskStore.registerArtifact(taskId, { filePath, kind, mediaType, label });
  }

  async registerServerImageArtifact({ filePath, buffer, mediaType } = {}) {
    if (!this.imageArtifactStore || typeof this.imageArtifactStore.ingest !== 'function') {
      throw new TypeError('MockOnlyCapabilityDispatcher requires imageArtifactStore for immutable image registration.');
    }
    return this.imageArtifactStore.ingest({
      ...(filePath !== undefined ? { filePath } : {}),
      ...(buffer !== undefined ? { buffer } : {}),
      ...(mediaType !== undefined ? { mediaType } : {})
    });
  }

  async materializeOpaqueInputs(args = {}) {
    const prepared = structuredClone(args);
    if (!prepared.inputs || typeof prepared.inputs !== 'object' || Array.isArray(prepared.inputs)) return prepared;
    for (const [handleKey, pathKey] of [
      ['reference_image_handle', 'reference_image_path'],
      ['capture_image_handle', 'capture_image_path']
    ]) {
      if (prepared.inputs[pathKey] !== undefined) {
        throw new AgentContractError('INVALID_ARGUMENT', `Agent image input must use ${handleKey}; local paths are not accepted.`);
      }
      if (prepared.inputs[handleKey] !== undefined
        && !/^image-artifact:sha256:[0-9a-f]{64}$/i.test(String(prepared.inputs[handleKey]))) {
        throw new AgentContractError('ARTIFACT_NOT_FOUND', `${handleKey} must be an immutable server image handle.`);
      }
    }
    return prepared;
  }

  async presentAgentResult(result, profile) {
    let safeResult = normalizeProjectionForJson(stripPrivateCapabilityContent(result, profile));
    if (serializedChars(safeResult) <= profile.maxContextChars) return safeResult;
    const taskId = safeResult?.task_id;
    if (!/^task_[0-9a-f-]+$/i.test(String(taskId || ''))) {
      throw new AgentContractError('INTERNAL_ERROR', 'An oversized compatibility result could not be bound to a task artifact.');
    }

    const directory = path.join(this.artifactRoot, taskId);
    const filePath = path.join(directory, `${crypto.randomUUID()}.json`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(safeResult, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const artifact = await this.taskStore.registerArtifact(taskId, {
      filePath,
      kind: 'json',
      mediaType: 'application/json',
      label: 'capability-compatible-full-result'
    });
    const publicTask = await this.taskStore.getTask(taskId);
    const compactPayload = compactAgentPayload(safeResult.result, artifact.handle);
    safeResult = normalizeProjectionForJson({
      contract_version: safeResult.contract_version,
      kind: safeResult.kind,
      ok: safeResult.ok,
      task_id: safeResult.task_id,
      task_state: safeResult.task_state,
      task_version: publicTask.task_version,
      retryable: safeResult.retryable,
      idempotent_replay: safeResult.idempotent_replay,
      result: compactPayload,
      data: compactPayload,
      warnings: compactWarnings(safeResult.warnings),
      error: safeResult.error,
      next_action: compactNextAction(safeResult.next_action),
      artifacts: publicTask.artifacts
    });
    if (serializedChars(safeResult) <= profile.maxContextChars) return safeResult;

    const minimalPayload = minimalAgentPayload(safeResult.result, artifact.handle);
    return normalizeProjectionForJson({
      ...safeResult,
      result: minimalPayload,
      data: minimalPayload,
      warnings: [],
      next_action: compactNextAction(safeResult.next_action),
      artifacts: [artifact]
    });
  }
}

export class CapabilityConstraintError extends Error {
  constructor(violation) {
    super(violation?.message || 'Agent capability constraint violated.');
    this.name = 'CapabilityConstraintError';
    this.code = 'CAPABILITY_CONSTRAINT_VIOLATION';
    this.retryable = false;
    this.violation = structuredClone(violation);
    this.next_action = violation?.next_action || { action: 'use_capability_compatible_input_or_surface' };
  }
}

export class VolatileAgentState {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(structuredClone(initial || {})));
    this.generation = 0;
  }

  set(key, value) {
    this.values.set(String(key), structuredClone(value));
    return value;
  }

  get(key) {
    const value = this.values.get(String(key));
    return value === undefined ? undefined : structuredClone(value);
  }

  has(key) {
    return this.values.has(String(key));
  }

  delete(key) {
    return this.values.delete(String(key));
  }

  loseAll({ retain = [] } = {}) {
    const retained = new Map();
    for (const key of retain.map(String)) {
      if (this.values.has(key)) retained.set(key, this.values.get(key));
    }
    this.values = retained;
    this.generation += 1;
    return { generation: this.generation, retained: [...retained.keys()] };
  }

  snapshot() {
    return { generation: this.generation, values: Object.fromEntries(structuredClone([...this.values.entries()])) };
  }
}

export class FaultInjector {
  constructor({ state } = {}) {
    this.state = state || null;
    this.responseDrops = [];
    this.events = [];
  }

  dropNextResponse({ tool = '*', count = 1 } = {}) {
    if (!Number.isInteger(count) || count <= 0) throw new TypeError('Response drop count must be a positive integer.');
    this.responseDrops.push({ tool: String(tool), remaining: count });
  }

  async interceptResponse(tool) {
    const fault = this.responseDrops.find((candidate) => candidate.remaining > 0 && (candidate.tool === '*' || candidate.tool === tool));
    if (!fault) return;
    fault.remaining -= 1;
    const event = { kind: 'simulated_response_loss', tool: String(tool), at: new Date().toISOString() };
    this.events.push(event);
    throw new SimulatedFaultError('SIMULATED_RESPONSE_LOST', 'The simulated Agent did not observe the completed tool response.', event);
  }

  loseAgentState({ retain = [] } = {}) {
    if (!this.state) throw new TypeError('FaultInjector has no VolatileAgentState.');
    const result = this.state.loseAll({ retain });
    this.events.push({ kind: 'simulated_agent_state_loss', ...result, at: new Date().toISOString() });
    return result;
  }

  async outOfBand(callback, label = 'out_of_band_change') {
    if (typeof callback !== 'function') throw new TypeError('outOfBand requires a callback.');
    const result = await callback();
    this.events.push({ kind: 'simulated_out_of_band_action', label, at: new Date().toISOString() });
    return result;
  }
}

/**
 * Captures the actual Agent Gateway dispatch boundary together with read-only
 * before/after model state and any HMAC-verified durable task mutation receipt.
 * Scenarios consume this audit trail; they do not declare whether a mutation
 * happened, which targets changed, or whether approval was trusted.
 */
export class GatewayMutationAuditTrail {
  constructor({ level, getBridge } = {}) {
    this.profile = CapabilityProfile.forLevel(level);
    if (typeof getBridge !== 'function') throw new TypeError('GatewayMutationAuditTrail requires getBridge().');
    this.getBridge = getBridge;
    this.currentScenario = null;
    this.events = [];
    this.sequence = 0;
  }

  wrap(dispatcher) {
    if (!dispatcher || typeof dispatcher.dispatch !== 'function') throw new TypeError('GatewayMutationAuditTrail.wrap requires a dispatcher.');
    return {
      dispatch: (tool, args, context) => this.dispatch(dispatcher, tool, args, context)
    };
  }

  async withScenario(name, callback) {
    const previous = this.currentScenario;
    this.currentScenario = String(name || 'unspecified');
    try {
      return await callback();
    } finally {
      this.currentScenario = previous;
    }
  }

  async dispatch(dispatcher, tool, args = {}, context = {}) {
    if (context.actor !== 'agent') return dispatcher.dispatch(tool, args, context);
    const bridge = this.getBridge();
    const requestTask = args?.task_id
      ? await bridge.taskStore.getTask(args.task_id, { includePrivate: true }).catch(() => null)
      : null;
    const before = await captureCompatibilityModelState(bridge);
    const sequence = ++this.sequence;
    let result;
    let thrown;
    try {
      result = await dispatcher.dispatch(tool, args, context);
      return result;
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const after = await captureCompatibilityModelState(this.getBridge());
      const taskId = result?.task_id || args?.task_id || null;
      const task = taskId
        ? await this.getBridge().taskStore.getTask(taskId, { includePrivate: true }).catch(() => null)
        : null;
      const receipt = taskId && task
        ? await this.getBridge().taskStore.loadTaskMutationReceipt(taskId, { allowMissing: true })
        : null;
      const requestedTargets = requestedTargetsFromTask(task, args);
      const modelDiff = compatibilityModelDiff(before, after, { requestedTargets, receipt });
      const riskLevel = receipt?.risk_level
        || task?.private?.existing_edit_plan?.risk_level
        || task?.result?.proposal?.risk_level
        || (task?.intent === 'create_model' ? 'S1' : null);
      const authorizationMode = receipt?.finalizer?.applied_result?.authorization?.mode || null;
      const eventCore = {
        version: 'agent-gateway-mutation-audit-event.v1',
        kind: 'agent_gateway_mutation_audit_event',
        event_id: `gateway-audit-${this.profile.level.toLowerCase()}-${String(sequence).padStart(4, '0')}`,
        level: this.profile.level,
        scenario: this.currentScenario || 'unspecified',
        sequence,
        tool: String(tool || ''),
        request_id: `${this.profile.level.toLowerCase()}-${String(sequence).padStart(4, '0')}`,
        request_hash: sha256Canonical(args),
        idempotency_key: args?.idempotency_key === undefined ? null : String(args.idempotency_key),
        task_id: taskId,
        intent: task?.intent || args?.intent || null,
        request_task_state: requestTask?.state || null,
        response: {
          ok: thrown ? false : result?.ok !== false,
          task_state: result?.task_state || task?.state || null,
          idempotent_replay: result?.idempotent_replay === true,
          error_code: thrown?.code || result?.error?.code || null
        },
        submitted_approval_token: Boolean(args?.input?.approval_token),
        submitted_agent_review_approval: args?.input?.review?.status === 'approved',
        submitted_warning_acknowledgement: args?.input?.warning_acknowledged === true,
        risk_level: riskLevel,
        authorization_mode: authorizationMode,
        requested_targets: requestedTargets,
        model_diff: modelDiff,
        mutation_receipt: receipt ? {
          receipt_id: receipt.receipt_id,
          request_fingerprint: receipt.request_fingerprint,
          model_revision_before: receipt.model_revision_before,
          model_revision_after: receipt.model_revision_after,
          risk_level: receipt.risk_level,
          authorization_mode: authorizationMode,
          integrity_verified: true
        } : null
      };
      this.events.push(Object.freeze({ ...eventCore, event_hash: sha256Canonical(eventCore) }));
    }
  }

  mutationEvents() {
    return this.events.filter((event) => {
      if (event.tool === 'start_agent_task' && event.intent === 'create_model') return true;
      if (event.tool !== 'submit_agent_task_input') return false;
      if (event.intent === 'reviewed_existing_model_edit') {
        return event.submitted_approval_token
          || event.submitted_agent_review_approval
          || event.request_task_state === 'awaiting_review'
          || event.response.idempotent_replay === true;
      }
      return event.intent === 'propose_existing_model_edit'
        && event.scenario === 'ambiguous_edit'
        && event.submitted_warning_acknowledgement === true;
    });
  }

  eventsForIdempotencyKey(value) {
    return this.events.filter((event) => event.idempotency_key === String(value));
  }

  verifiedReceiptIds() {
    return new Set(this.events
      .filter((event) => event.mutation_receipt?.integrity_verified === true)
      .map((event) => event.mutation_receipt.receipt_id));
  }

  summary() {
    const mutationEvents = this.mutationEvents();
    return {
      version: 'agent-gateway-mutation-audit-summary.v1',
      source: 'actual_gateway_dispatch_and_model_diff',
      events: this.events.length,
      mutation_events: mutationEvents.length,
      model_diffs: mutationEvents.length,
      durable_receipts: this.verifiedReceiptIds().size,
      event_hash: sha256Canonical(this.events.map((event) => event.event_hash))
    };
  }
}

export class SimulatedFaultError extends Error {
  constructor(code, message, event) {
    super(message);
    this.name = 'SimulatedFaultError';
    this.code = code;
    this.retryable = true;
    this.event = structuredClone(event);
  }
}

export class MutationLedger {
  constructor() {
    this.entries = [];
  }

  record(input = {}) {
    const entry = normalizeMutationEntry(input);
    this.entries.push(entry);
    return structuredClone(entry);
  }

  recordGatewayEvent(event = {}) {
    if (event?.version !== 'agent-gateway-mutation-audit-event.v1'
      || event?.kind !== 'agent_gateway_mutation_audit_event'
      || !event?.event_id
      || event?.event_hash !== sha256Canonical(Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'event_hash')))) {
      throw new TypeError('Mutation ledger requires an integrity-matching Gateway audit event.');
    }
    if (event.mutation_receipt && event.mutation_receipt.integrity_verified !== true) {
      throw new TypeError('Mutation ledger rejected an unverified durable mutation receipt.');
    }
    const riskLevel = event.mutation_receipt?.risk_level || event.risk_level || null;
    const authorizationMode = event.mutation_receipt?.authorization_mode || event.authorization_mode || null;
    return this.record({
      level: event.level,
      scenario: event.scenario,
      requestId: event.request_id,
      idempotencyKey: event.idempotency_key,
      riskLevel,
      automaticExecution: event.intent === 'create_model' || authorizationMode === 'server_policy_auto_approval',
      trustedApproval: authorizationMode === 'trusted_one_time_token',
      reviewedTargets: event.requested_targets,
      actualModifiedTargets: event.model_diff?.modified_targets || [],
      mutationApplied: event.model_diff?.changed === true,
      mutationReceipt: event.mutation_receipt?.receipt_id || null,
      sourceEventId: event.event_id,
      sourceEventHash: event.event_hash,
      modelDiffHash: event.model_diff?.diff_hash,
      receiptVerified: event.mutation_receipt?.integrity_verified === true
    });
  }

  hardGates() {
    let wrongObjectAutomaticExecution = 0;
    let unauthorizedS2S4Execution = 0;
    const appliedByRequest = new Map();
    for (const entry of this.entries) {
      if (entry.mutation_applied) {
        const reviewed = new Set(entry.reviewed_targets);
        if (entry.actual_modified_targets.some((target) => !reviewed.has(target))) wrongObjectAutomaticExecution += 1;
      }
      if (entry.mutation_applied && RISK_LEVELS_REQUIRING_APPROVAL.has(entry.risk_level) && !entry.trusted_approval) {
        unauthorizedS2S4Execution += 1;
      }
      if (entry.mutation_applied) {
        const key = entry.idempotency_key || entry.request_id;
        appliedByRequest.set(key, Number(appliedByRequest.get(key) || 0) + 1);
      }
    }
    let duplicateRequestDuplicateModification = 0;
    for (const appliedCount of appliedByRequest.values()) duplicateRequestDuplicateModification += Math.max(0, appliedCount - 1);
    return {
      wrong_object_automatic_execution: wrongObjectAutomaticExecution,
      unauthorized_s2_s4_execution: unauthorizedS2S4Execution,
      duplicate_request_duplicate_modification: duplicateRequestDuplicateModification
    };
  }

  toJSON() {
    return structuredClone(this.entries);
  }
}

function requireActor(actor) {
  if (!ACTORS.has(actor)) throw new TypeError(`Unknown compatibility actor: ${String(actor)}`);
}

function serializedChars(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : serialized.length;
}

function assertStrictJsonTextValue(value, location = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${location} contains a non-finite number.`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${location} contains ${typeof value}, which JSON text cannot preserve.`);
  if (ancestors.has(value)) throw new TypeError(`${location} contains a circular reference.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new TypeError(`${location} contains a non-plain object.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${location}[${index}] is a sparse array slot.`);
        assertStrictJsonTextValue(value[index], `${location}[${index}]`, ancestors);
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      assertStrictJsonTextValue(child, `${location}.${key}`, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function normalizeProjectionForJson(value, location = '$', ancestors = new Set()) {
  if (value === undefined) throw new TypeError(`${location} cannot be undefined.`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${location} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${location} contains ${typeof value}, which cannot be projected as JSON.`);
  if (ancestors.has(value)) throw new TypeError(`${location} contains a circular reference.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) {
    throw new TypeError(`${location} contains a non-plain object.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child, index) => {
        if (!Object.hasOwn(value, index) || child === undefined) {
          throw new TypeError(`${location}[${index}] is not a JSON-preserving array value.`);
        }
        return normalizeProjectionForJson(child, `${location}[${index}]`, ancestors);
      });
    }
    const normalized = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      normalized[key] = normalizeProjectionForJson(child, `${location}.${key}`, ancestors);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function assertMockOnly(tool, args) {
  if (['create_queue_handshake'].includes(String(tool || ''))) {
    throw new AgentContractError('POLICY_DENIED', 'The Agent compatibility harness is mock-only and cannot invoke queue tools.');
  }
  const queueRuntime = findQueueRuntime(args);
  if (queueRuntime) {
    throw new AgentContractError('POLICY_DENIED', 'The Agent compatibility harness is mock-only and rejects runtime queue.', {
      details: { location: queueRuntime }
    });
  }
}

function findQueueRuntime(value, location = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findQueueRuntime(value[index], `${location}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (/(^|_)(runtime)$/i.test(key) && String(child || '').toLowerCase() === 'queue') return `${location}.${key}`;
    const found = findQueueRuntime(child, `${location}.${key}`);
    if (found) return found;
  }
  return null;
}

function stripPrivateCapabilityContent(value, profile, key = '') {
  if (typeof value === 'string') {
    if (!profile.capabilities.local_files
      && (PATH_KEY.test(key) || CAMEL_CASE_PATH_KEY.test(key) || key === 'input_dir' || key === 'output_dir' || key === 'asset_set_path')
      && looksLikeLocalPath(value)) return undefined;
    if (!profile.capabilities.vision && (value.startsWith('data:image/') || (IMAGE_CONTENT_KEY.test(key) && value.length > 0))) return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripPrivateCapabilityContent(item, profile, key)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  if (!profile.capabilities.vision && value.type === 'image' && (value.data || value.image_url || value.content)) {
    return { type: 'image_summary', omitted_for_capability: true };
  }
  if (!profile.capabilities.vision && String(value.media_type || '').startsWith('image/') && (value.content || value.data || value.base64)) {
    const { content: _content, data: _data, base64: _base64, ...metadata } = value;
    return stripPrivateCapabilityContent(metadata, profile, key);
  }
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const stripped = stripPrivateCapabilityContent(childValue, profile, childKey);
    if (stripped !== undefined) result[childKey] = stripped;
  }
  return result;
}

function compactAgentPayload(payload, fullResultHandle) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const kind = String(source.kind || 'compatibility_projected_result');
  const common = { kind, full_result_artifact: fullResultHandle };
  if (kind === 'propose_existing_model_edit_result') {
    const proposal = source.proposal || {};
    return {
      ...common,
      model_graph: compactModelGraphSummary(source.model_graph),
      proposal: {
        version: proposal.version,
        kind: proposal.kind,
        model_key: proposal.model_key,
        graph_id: proposal.graph_id,
        model_revision: proposal.model_revision,
        proposal_id: proposal.proposal_id,
        proposal_hash: proposal.proposal_hash,
        target_resolution: proposal.target_resolution,
        requested_action: proposal.requested_action,
        candidates: (proposal.candidates || []).slice(0, 3).map(compactProposalCandidate),
        selected_targets: proposal.selected_targets || [],
        operation_proposal: proposal.operation_proposal || [],
        shared_definition_policy: proposal.shared_definition_policy,
        risk_level: proposal.risk_level,
        confidence: proposal.confidence,
        requires_clarification: proposal.requires_clarification,
        ambiguity_reasons: proposal.ambiguity_reasons || [],
        execution_allowed: proposal.execution_allowed,
        execution_route: proposal.execution_route,
        clarification: proposal.clarification,
        next_action: compactNextAction(proposal.next_action)
      }
    };
  }
  if (kind === 'understand_model_result') {
    const modelData = source.model_data || {};
    const value = modelData.value || {};
    return {
      ...common,
      model_data: {
        trust: modelData.trust,
        source: modelData.source,
        policy_effect: modelData.policy_effect,
        summary: {
          entity_count: Array.isArray(value.entities) ? value.entities.length : value.entity_count,
          model_name: value.model_name || value.name || null,
          units: value.units || null,
          bounds: value.bounds || value.bounding_box || null
        }
      }
    };
  }
  if (kind === 'reference_image_correction_result') {
    return {
      ...common,
      evidence: compactVisualEvidence(source.evidence),
      correction_patch: compactCorrectionPatch(source.correction_patch),
      visual_agent_required: source.visual_agent_required === true
    };
  }
  if (kind === 'reviewed_existing_model_edit_proposal') {
    return {
      ...common,
      plan_id: source.plan_id,
      plan_hash: source.plan_hash,
      model_revision: source.model_revision,
      risk_level: source.risk_level,
      operation_count: source.operation_count,
      blockers: source.blockers || [],
      approval_challenge: compactApprovalChallenge(source.approval_challenge),
      source_proposal: source.source_proposal || null,
      source_design_change: source.source_design_change || null
    };
  }
  if (kind === 'reviewed_existing_model_edit_result') {
    return {
      ...common,
      ok: source.ok,
      plan_id: source.plan_id,
      risk_level: source.risk_level,
      authorization: source.authorization,
      qa: compactQa(source.qa)
    };
  }
  if (kind === 'create_model_result') {
    return {
      ...common,
      snapshot: compactSnapshot(source.snapshot),
      qa: compactQa(source.qa),
      compile_allowed: source.compile_allowed,
      verification: source.verification
    };
  }
  const primitiveSummary = Object.fromEntries(Object.entries(source).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
  return { ...common, ...primitiveSummary };
}

function minimalAgentPayload(payload, fullResultHandle) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const kind = String(source.kind || 'compatibility_projected_result');
  const common = { kind };
  if (kind === 'propose_existing_model_edit_result') {
    const proposal = source.proposal || {};
    const proposalSummary = proposal.requires_clarification
      ? {
          candidates: (proposal.candidates || []).slice(0, 3).map((candidate) => ({
            persistent_ref: candidate.persistent_ref,
            confidence: candidate.confidence,
            summary: { value: { name: candidate.summary?.value?.name, kind: candidate.summary?.value?.kind } }
          })),
          requires_clarification: true,
          ambiguity_reasons: proposal.ambiguity_reasons || [],
          execution_allowed: false
        }
      : {
          operation_proposal: proposal.operation_proposal || [],
          risk_level: proposal.risk_level,
          requires_clarification: false,
          execution_allowed: false
        };
    return { ...common, proposal: proposalSummary };
  }
  if (kind === 'reviewed_existing_model_edit_proposal') {
    return {
      ...common,
      plan_id: source.plan_id,
      plan_hash: source.plan_hash,
      model_revision: source.model_revision,
      risk_level: source.risk_level,
      blockers: source.blockers || [],
      approval_challenge: compactApprovalChallenge(source.approval_challenge)
    };
  }
  if (kind === 'reference_image_correction_result') {
    return {
      ...common,
      evidence: {
        version: source.evidence?.version,
        kind: source.evidence?.kind,
        content_trust: source.evidence?.content_trust,
        policy_effect: source.evidence?.policy_effect,
        evidence_id: source.evidence?.evidence_id,
        alignment: source.evidence?.alignment,
        difference: source.evidence?.difference,
        confidence: source.evidence?.confidence,
        blockers: source.evidence?.blockers || []
      },
      correction_patch: {
        version: source.correction_patch?.version,
        kind: source.correction_patch?.kind,
        correction_patch_id: source.correction_patch?.correction_patch_id,
        risk_level: source.correction_patch?.risk_level,
        blockers: source.correction_patch?.blockers || [],
        execution_allowed: source.correction_patch?.execution_allowed,
        review_required: source.correction_patch?.review_required,
        next_action: compactNextAction(source.correction_patch?.next_action)
      },
      visual_agent_required: source.visual_agent_required === true
    };
  }
  if (kind === 'understand_model_result') return { ...common, model_data: source.model_data };
  if (kind === 'create_model_result') return { ...common, snapshot: source.snapshot, qa: source.qa };
  if (kind === 'reviewed_existing_model_edit_result') {
    return { ...common, ok: source.ok, plan_id: source.plan_id, risk_level: source.risk_level, authorization: source.authorization };
  }
  return {
    ...common,
    summary: 'The full structured result is available through the envelope artifact handle.',
    artifact_hint: fullResultHandle
  };
}

function compactProposalCandidate(candidate = {}) {
  return {
    node_id: candidate.node_id,
    persistent_ref: candidate.persistent_ref,
    entity_type: candidate.entity_type,
    confidence: candidate.confidence,
    allowed_for_operation: candidate.allowed_for_operation,
    shared_definition: candidate.shared_definition,
    affected_instance_count: candidate.affected_instance_count,
    summary: candidate.summary ? {
      trust: candidate.summary.trust,
      source: candidate.summary.source,
      policy_effect: candidate.summary.policy_effect,
      value: {
        name: candidate.summary.value?.name,
        kind: candidate.summary.value?.kind,
        definition_name: candidate.summary.value?.definition_name,
        tag: candidate.summary.value?.tag
      }
    } : null
  };
}

function compactModelGraphSummary(value = {}) {
  return {
    graph_id: value.graph_id,
    model_revision: value.model_revision,
    stats: value.stats,
    store: value.store ? {
      version: value.store.version,
      model_key: value.store.model_key,
      graph_id: value.store.graph_id,
      model_revision: value.store.model_revision
    } : null
  };
}

function compactVisualEvidence(value = {}) {
  return {
    version: value.version,
    kind: value.kind,
    content_trust: value.content_trust,
    policy_effect: value.policy_effect,
    source_task_id: value.source_task_id,
    model_key: value.model_key,
    graph_id: value.graph_id,
    model_revision: value.model_revision,
    evidence_id: value.evidence_id,
    evidence_hash: value.evidence_hash,
    reference_image: value.reference_image,
    captured_image: value.captured_image,
    alignment: value.alignment,
    difference: value.difference,
    foreground: value.foreground,
    confidence: value.confidence,
    mapping_declaration: value.mapping_declaration,
    blockers: value.blockers || []
  };
}

function compactCorrectionPatch(value = {}) {
  return {
    version: value.version,
    kind: value.kind,
    content_trust: value.content_trust,
    policy_effect: value.policy_effect,
    source_task_id: value.source_task_id,
    model_key: value.model_key,
    graph_id: value.graph_id,
    model_revision: value.model_revision,
    evidence_id: value.evidence_id,
    evidence_hash: value.evidence_hash,
    correction_patch_id: value.correction_patch_id,
    patch_hash: value.patch_hash,
    private_payload_hash: value.private_payload_hash,
    risk_level: value.risk_level,
    blockers: value.blockers || [],
    execution_allowed: value.execution_allowed,
    review_required: value.review_required,
    execution_route: value.execution_route,
    next_action: compactNextAction(value.next_action)
  };
}

function compactSnapshot(value = {}) {
  return {
    entity_count: Array.isArray(value.entities) ? value.entities.length : value.entity_count,
    bounds: value.bounds || value.bounding_box || null,
    warnings: compactWarnings(value.warnings)
  };
}

function compactQa(value) {
  if (!value || typeof value !== 'object') return value || null;
  return {
    ok: value.ok,
    passed: value.passed,
    verdict: value.verdict,
    issue_count: Array.isArray(value.issues) ? value.issues.length : value.issue_count,
    warning_count: Array.isArray(value.warnings) ? value.warnings.length : value.warning_count
  };
}

function compactWarnings(value) {
  return Array.isArray(value) ? value.slice(0, 5).map((warning) => ({
    code: warning?.code,
    message: warning?.message,
    severity: warning?.severity
  })) : [];
}

function compactApprovalChallenge(value) {
  if (!value || typeof value !== 'object') return value || null;
  return Object.fromEntries(Object.entries({
    challenge_id: value.challenge_id,
    task_id: value.task_id,
    plan_id: value.plan_id,
    plan_hash: value.plan_hash,
    model_revision: value.model_revision,
    risk_level: value.risk_level,
    allowed_operations: Array.isArray(value.allowed_operations) ? value.allowed_operations.slice(0, 50) : value.allowed_operations,
    review_context_hash: value.review_context_hash,
    expires_at: value.expires_at,
    status: value.status
  }).filter(([, item]) => item !== undefined));
}

function compactNextAction(value) {
  if (!value || typeof value !== 'object') return value || null;
  const next = {
    action: value.action,
    then_tool: value.then_tool,
    tool: value.tool,
    task_id: value.task_id,
    required: Array.isArray(value.required) ? value.required.slice(0, 10) : value.required,
    reason: value.reason
  };
  if (value.arguments?.intent && value.arguments?.inputs) {
    next.arguments = {
      intent: value.arguments.intent,
      instruction: value.arguments.instruction,
      interface_level: value.arguments.interface_level,
      inputs: value.arguments.inputs
    };
  }
  if (value.challenge) next.challenge = compactApprovalChallenge(value.challenge);
  if (value.approval_host) {
    next.approval_host = Object.fromEntries(Object.entries({
      version: value.approval_host.version,
      url: value.approval_host.url,
      challenge_id: value.approval_host.challenge_id,
      user_presence_required: value.approval_host.user_presence_required,
      approval_token_exposed_to_agent: value.approval_host.approval_token_exposed_to_agent
    }).filter(([, item]) => item !== undefined));
  }
  return Object.fromEntries(Object.entries(next).filter(([, item]) => item !== undefined));
}

function findPathContent(value, key = '', location = '$') {
  if (typeof value === 'string') {
    if ((PATH_KEY.test(key) || CAMEL_CASE_PATH_KEY.test(key) || key === 'input_dir' || key === 'output_dir' || key === 'asset_set_path') && looksLikeLocalPath(value)) {
      return { path: location };
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findPathContent(value[index], key, `${location}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [childKey, childValue] of Object.entries(value)) {
    const found = findPathContent(childValue, childKey, `${location}.${childKey}`);
    if (found) return found;
  }
  return null;
}

function findImageContent(value, key = '', location = '$') {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || (IMAGE_CONTENT_KEY.test(key) && value.length > 0)) return { path: location };
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findImageContent(value[index], key, `${location}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'image' && (value.data || value.image_url || value.content)) return { path: location };
  if (String(value.media_type || '').startsWith('image/') && (value.content || value.data || value.base64)) return { path: location };
  for (const [childKey, childValue] of Object.entries(value)) {
    const found = findImageContent(childValue, childKey, `${location}.${childKey}`);
    if (found) return found;
  }
  return null;
}

function looksLikeLocalPath(value) {
  if (!value || value.startsWith('artifact:') || value.startsWith('data:')) return false;
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeMutationEntry(input) {
  const entry = {
    level: String(input.level || ''),
    scenario: String(input.scenario || ''),
    request_id: String(input.request_id ?? input.requestId ?? ''),
    idempotency_key: nullableString(input.idempotency_key ?? input.idempotencyKey),
    risk_level: input.risk_level ?? input.riskLevel ?? null,
    automatic_execution: input.automatic_execution === true || input.automaticExecution === true,
    trusted_approval: input.trusted_approval === true || input.trustedApproval === true,
    reviewed_targets: uniqueStrings(input.reviewed_targets ?? input.reviewedTargets),
    actual_modified_targets: uniqueStrings(input.actual_modified_targets ?? input.actualModifiedTargets),
    mutation_applied: input.mutation_applied === true || input.mutationApplied === true,
    mutation_receipt: nullableString(input.mutation_receipt ?? input.mutationReceipt),
    source_event_id: nullableString(input.source_event_id ?? input.sourceEventId),
    source_event_hash: nullableString(input.source_event_hash ?? input.sourceEventHash),
    model_diff_hash: nullableString(input.model_diff_hash ?? input.modelDiffHash),
    receipt_verified: input.receipt_verified === true || input.receiptVerified === true
  };
  if (!['L0', 'L1', 'L2'].includes(entry.level)) throw new TypeError('Mutation ledger level must be L0, L1, or L2.');
  if (!entry.scenario || !entry.request_id) throw new TypeError('Mutation ledger entries require scenario and request_id.');
  if (entry.risk_level !== null && !['S1', 'S2', 'S3', 'S4'].includes(entry.risk_level)) throw new TypeError('Mutation ledger risk level is invalid.');
  return Object.freeze(entry);
}

export function compatibilityEntityFingerprint(entity) {
  return sha256Canonical(compatibilityEntityValue(entity));
}

async function captureCompatibilityModelState(bridge) {
  const adoption = await bridge.adopt_open_model({
    runtime: 'mock',
    recursive: true,
    recursive_limit: 100000,
    read_only: true,
    prefix: 'agent-compatibility-audit'
  });
  const topLevel = new Map();
  for (const entity of adoption.entities || []) {
    const key = `target:${String(entity.persistent_id || entity.id || entity.reference || entity.name)}`;
    topLevel.set(key, { key, fingerprint: compatibilityEntityFingerprint(entity), entity: compatibilityEntityValue(entity) });
  }
  const recursive = new Map();
  for (const entity of adoption.recursive_index || []) {
    if (!entity.entity_path) continue;
    recursive.set(entity.entity_path, {
      key: `path:${entity.entity_path}`,
      fingerprint: compatibilityEntityFingerprint(entity),
      entity: compatibilityEntityValue(entity)
    });
  }
  const revision = modelRevisionForAdoption(adoption);
  return {
    revision,
    fingerprint: sha256Canonical({
      revision,
      top_level: [...topLevel.values()].map(({ key, fingerprint }) => ({ key, fingerprint })).sort(sortAuditKeys),
      recursive: [...recursive.values()].map(({ key, fingerprint }) => ({ key, fingerprint })).sort(sortAuditKeys)
    }),
    topLevel,
    recursive
  };
}

function compatibilityModelDiff(before, after, { requestedTargets = [], receipt } = {}) {
  const changedTopLevel = changedAuditKeys(before.topLevel, after.topLevel);
  const reviewedPaths = requestedTargets.filter((target) => target.startsWith('path:')).map((target) => target.slice(5));
  let modifiedTargets;
  if (reviewedPaths.length) {
    modifiedTargets = [];
    const nestedTargets = receipt?.finalizer?.applied_result?.iteration?.nested_edit?.targets || [];
    for (const target of nestedTargets) {
      const key = targetKeyFromReference(target);
      if (compatibilityEntityFingerprint(target.before) !== compatibilityEntityFingerprint(target.after)) modifiedTargets.push(key);
    }
    const selectedAncestorIds = new Set();
    for (const target of nestedTargets) {
      const first = target?.before?.path_segments?.[0]?.persistent_id || target?.before?.path_segments?.[0]?.reference;
      if (first) selectedAncestorIds.add(`target:${first}`);
    }
    for (const pathValue of reviewedPaths) {
      const beforeEntry = before.recursive.get(pathValue)?.entity;
      const first = beforeEntry?.path_segments?.[0]?.persistent_id || beforeEntry?.path_segments?.[0]?.reference;
      if (first) selectedAncestorIds.add(`target:${first}`);
    }
    for (const key of changedTopLevel) {
      if (!selectedAncestorIds.has(key)) modifiedTargets.push(key);
      else if (!modifiedTargets.length) modifiedTargets.push(...requestedTargets.filter((target) => target.startsWith('path:')));
    }
  } else {
    modifiedTargets = changedTopLevel;
  }
  modifiedTargets = [...new Set(modifiedTargets)].sort();
  const changed = before.revision !== after.revision || before.fingerprint !== after.fingerprint;
  if (changed && modifiedTargets.length === 0) modifiedTargets.push('model:unattributed-change');
  const core = {
    changed,
    model_revision_before: before.revision,
    model_revision_after: after.revision,
    model_fingerprint_before: before.fingerprint,
    model_fingerprint_after: after.fingerprint,
    modified_targets: modifiedTargets
  };
  return { ...core, diff_hash: sha256Canonical(core) };
}

function changedAuditKeys(before, after) {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((key) => before.get(key)?.fingerprint !== after.get(key)?.fingerprint).sort();
}

function requestedTargetsFromTask(task, args) {
  if (task?.intent === 'reviewed_existing_model_edit') {
    return uniqueStrings((task.private?.existing_edit_plan?.targets || []).map(targetKeyFromReference));
  }
  if (task?.intent === 'propose_existing_model_edit') {
    const proposal = task.result?.proposal;
    const targets = proposal?.selected_targets?.length ? proposal.selected_targets : proposal?.candidates?.map((entry) => entry.persistent_ref);
    return uniqueStrings((targets || []).map(targetKeyFromReference));
  }
  if (task?.intent === 'create_model') {
    try {
      const document = typeof task.inputs?.code === 'string' ? JSON.parse(task.inputs.code) : task.inputs?.code;
      return uniqueStrings((document?.operations || []).flatMap(operationTargetKeys));
    } catch {
      return [];
    }
  }
  return uniqueStrings((args?.inputs?.targets || []).map(targetKeyFromReference));
}

function operationTargetKeys(operation) {
  if (!operation || typeof operation !== 'object') return [];
  const values = [operation.target_id, operation.id, operation.result_id].filter((value) => value !== undefined && value !== null);
  return values.map((value) => `target:${String(value)}`);
}

function targetKeyFromReference(reference) {
  const value = reference?.entity_path ? reference : reference?.persistent_ref || reference;
  if (value && typeof value === 'object') {
    if (value.entity_path) return `path:${value.entity_path}`;
    if (value.target_id !== undefined) return `target:${String(value.target_id)}`;
    if (value.id !== undefined) return `target:${String(value.id)}`;
  }
  return `target:${String(value)}`;
}

function compatibilityEntityValue(entity = {}) {
  return {
    path: entity.entity_path || entity.path || null,
    parent_entity_path: entity.parent_entity_path || null,
    persistent_id_path: entity.persistent_id_path || null,
    id: entity.id || null,
    persistent_id: entity.persistent_id || null,
    reference: entity.reference || null,
    name: entity.name || null,
    entity_type: entity.entity_type || null,
    kind: entity.kind || null,
    definition_name: entity.definition_name || null,
    entity_definition_name: entity.entity_definition_name || null,
    material: entity.material || null,
    back_material: entity.back_material || null,
    classification: entity.classification || null,
    attributes: entity.attributes || null,
    texture_transform: entity.texture_transform || null,
    face_uvs: entity.face_uvs || null,
    transform: entity.transform || entity.transformation || null,
    world_transform: entity.world_transform || null,
    visible: entity.visible !== false,
    locked: entity.locked === true,
    soft: entity.soft === true,
    smooth: entity.smooth === true,
    reversed: entity.reversed === true,
    geometry_summary: entity.geometry_summary || null,
    bounding_box: entity.bounding_box || null,
    faces: entity.faces ?? null,
    edges: entity.edges ?? null,
    vertices: entity.vertices ?? null,
    features: entity.features || []
  };
}

function sortAuditKeys(left, right) {
  return left.key.localeCompare(right.key);
}

function nullableString(value) {
  return value === undefined || value === null ? null : String(value);
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String))];
}
