import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError } from './agent-contract.mjs';

export const AGENT_RESPONSE_POLICY_VERSION = 'agent-response-policy.v1';
export const AGENT_RESPONSE_PROJECTION_VERSION = 'agent-response-projection.v1';

const DEFAULT_CONTEXT_LIMITS = Object.freeze({
  guided: 4096,
  standard: 16384,
  expert: 65536
});
const CLIENT_CONTEXT_LIMITS = Object.freeze({ short: 4096, standard: 16384, long: 65536 });
const INTERFACE_LEVELS = Object.freeze(['guided', 'standard', 'expert']);
const CONTEXT_LEVELS = Object.freeze(['short', 'standard', 'long']);
const PATH_KEY = /(^|_)(path|paths|dir|directory|file|root)$/i;
const CAMEL_CASE_PATH_KEY = /(Path|Paths|Dir|Directory|File|Root)$/;
const MODEL_ENTITY_PATH_KEYS = new Set([
  'entity_path',
  'entityPath',
  'entity_paths',
  'entityPaths',
  'parent_entity_path',
  'parentEntityPath',
  'scope_path',
  'scopePath',
  'occurrence_path',
  'occurrencePath',
  'locked_ancestor_path',
  'lockedAncestorPath',
  'duplicate_entity_path'
]);
const MODEL_ENTITY_PATH = /^(?:pid:[1-9][0-9]*(?:\.[1-9][0-9]*)*|mock:(?:group|component_instance|face|edge):[A-Za-z0-9_-]+(?:\/(?:group|component_instance|face|edge):[A-Za-z0-9_-]+)*)$/;
const VISUAL_CONTENT_KEYS = new Set([
  'imagebytes',
  'imagebase64',
  'imagedata',
  'pixeldata',
  'pixels',
  'thumbnailbase64',
  'thumbnailbytes',
  'thumbnaildata',
  'previewbase64',
  'previewbytes',
  'previewdata',
  'imageurl'
]);
const PROJECTION_LABEL_PREFIX = 'agent-response-projection-';
const SAFE_ARTIFACT_LABEL_PREFIX = 'agent-capability-safe-';

export function trustedAgentResponsePolicyFromEnvironment(env = process.env) {
  const interfaceLevel = INTERFACE_LEVELS.includes(env.ALMA_SKETCHUP_AGENT_TRUSTED_PROFILE)
    ? env.ALMA_SKETCHUP_AGENT_TRUSTED_PROFILE
    : 'guided';
  const defaultContext = { guided: 'short', standard: 'standard', expert: 'long' }[interfaceLevel];
  const context = CONTEXT_LEVELS.includes(env.ALMA_SKETCHUP_AGENT_TRUSTED_CONTEXT)
    ? env.ALMA_SKETCHUP_AGENT_TRUSTED_CONTEXT
    : defaultContext;
  const localFiles = env.ALMA_SKETCHUP_AGENT_TRUST_LOCAL_FILES === '1';
  const rawVision = env.ALMA_SKETCHUP_AGENT_TRUST_RAW_VISION === '1';
  return {
    allow_local_files: localFiles,
    allow_raw_vision: rawVision,
    max_context_chars: {
      guided: env.ALMA_SKETCHUP_AGENT_GUIDED_MAX_CHARS,
      standard: env.ALMA_SKETCHUP_AGENT_STANDARD_MAX_CHARS,
      expert: env.ALMA_SKETCHUP_AGENT_EXPERT_MAX_CHARS
    },
    trusted_caller_profile: {
      interface_level: interfaceLevel,
      client_capabilities: {
        vision: rawVision,
        local_files: localFiles,
        structured_output: true,
        parallel: false,
        context
      }
    }
  };
}

export function normalizeTrustedAgentResponsePolicy(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const limits = source.max_context_chars && typeof source.max_context_chars === 'object'
    ? source.max_context_chars
    : {};
  const callerProfileSource = source.trusted_caller_profile && typeof source.trusted_caller_profile === 'object'
    ? source.trusted_caller_profile
    : {};
  const callerCapabilitiesSource = callerProfileSource.client_capabilities && typeof callerProfileSource.client_capabilities === 'object'
    ? callerProfileSource.client_capabilities
    : {};
  const callerInterfaceLevel = INTERFACE_LEVELS.includes(callerProfileSource.interface_level)
    ? callerProfileSource.interface_level
    : 'guided';
  const callerContext = CONTEXT_LEVELS.includes(callerCapabilitiesSource.context)
    ? callerCapabilitiesSource.context
    : 'short';
  return Object.freeze({
    policy_version: AGENT_RESPONSE_POLICY_VERSION,
    allow_local_files: source.allow_local_files === true || source.allowLocalFiles === true,
    allow_raw_vision: source.allow_raw_vision === true || source.allowRawVision === true,
    max_context_chars: Object.freeze({
      guided: boundedInteger(limits.guided, DEFAULT_CONTEXT_LIMITS.guided, 2048, 250000),
      standard: boundedInteger(limits.standard, DEFAULT_CONTEXT_LIMITS.standard, 2048, 250000),
      expert: boundedInteger(limits.expert, DEFAULT_CONTEXT_LIMITS.expert, 2048, 250000)
    }),
    trusted_caller_profile: Object.freeze({
      interface_level: callerInterfaceLevel,
      client_capabilities: Object.freeze({
        vision: callerCapabilitiesSource.vision === true,
        local_files: callerCapabilitiesSource.local_files === true,
        structured_output: callerCapabilitiesSource.structured_output !== false,
        parallel: callerCapabilitiesSource.parallel === true,
        context: callerContext
      })
    }),
    max_in_flight_per_task: 1
  });
}

export function createAgentResponsePolicy({ interfaceLevel = 'guided', clientCapabilities = {}, trustedPolicy = {} } = {}) {
  const trusted = trustedPolicy?.policy_version === AGENT_RESPONSE_POLICY_VERSION
    ? trustedPolicy
    : normalizeTrustedAgentResponsePolicy(trustedPolicy);
  const requestedLevel = INTERFACE_LEVELS.includes(interfaceLevel) ? interfaceLevel : 'guided';
  const trustedLevel = trusted.trusted_caller_profile.interface_level;
  const level = lowerInterfaceLevel(requestedLevel, trustedLevel);
  const requestedContext = CONTEXT_LEVELS.includes(clientCapabilities.context)
    ? clientCapabilities.context
    : 'short';
  const trustedContext = trusted.trusted_caller_profile.client_capabilities.context;
  const maxContextChars = Math.min(
    trusted.max_context_chars[level],
    CLIENT_CONTEXT_LIMITS[requestedContext],
    CLIENT_CONTEXT_LIMITS[trustedContext]
  );
  const expertPresentation = level === 'expert';
  return {
    policy_version: AGENT_RESPONSE_POLICY_VERSION,
    source: 'server_trusted_profile_intersection',
    requested_interface_level: requestedLevel,
    interface_level: level,
    requested_capabilities: {
      vision: clientCapabilities.vision === true,
      local_files: clientCapabilities.local_files === true,
      structured_output: clientCapabilities.structured_output === true,
      parallel: clientCapabilities.parallel === true,
      context: requestedContext
    },
    effective_capabilities: {
      vision: expertPresentation
        && trusted.allow_raw_vision
        && trusted.trusted_caller_profile.client_capabilities.vision
        && clientCapabilities.vision === true,
      local_files: expertPresentation
        && trusted.allow_local_files
        && trusted.trusted_caller_profile.client_capabilities.local_files
        && clientCapabilities.local_files === true,
      structured_output: true,
      parallel: false,
      context: contextNameForLimit(maxContextChars)
    },
    max_context_chars: maxContextChars,
    max_in_flight_per_task: trusted.max_in_flight_per_task,
    parallel_scope: 'same_task_serial',
    server_serialization: 'json_envelope',
    execution_policy_effect: 'none'
  };
}

export function responsePolicyForTask(task) {
  return task?.response_policy || createAgentResponsePolicy({
    interfaceLevel: task?.interface_level,
    clientCapabilities: task?.client_capabilities
  });
}

export async function presentAgentResultEnvelope({ envelope, task, taskStore } = {}) {
  if (!envelope || envelope.kind !== 'agent_result_envelope' || !task?.task_id || !taskStore) return envelope;
  const policy = responsePolicyForTask(task);
  const omissions = { local_paths: 0, visual_payloads: 0 };
  const safeResult = projectCapabilityValue(envelope.result, policy, omissions);
  const safeWarnings = projectCapabilityValue(envelope.warnings || [], policy, omissions);
  const safeError = projectCapabilityValue(envelope.error, policy, omissions);
  const safeNextAction = projectCapabilityValue(envelope.next_action, policy, omissions);
  const sourceArtifacts = projectCapabilityValue(
    (envelope.artifacts || []).filter((artifact) => !String(artifact?.label || '').startsWith(PROJECTION_LABEL_PREFIX)),
    policy,
    omissions
  );
  const presentation = presentationSummary(policy, omissions, { projected: false, fullResultArtifact: null });
  let safeEnvelope = {
    ...envelope,
    result: safeResult,
    data: safeResult,
    warnings: safeWarnings,
    error: safeError,
    next_action: safeNextAction,
    artifacts: sourceArtifacts,
    presentation
  };
  safeEnvelope = fitArtifactPageEnvelope(safeEnvelope, policy.max_context_chars);
  if (serializedChars(safeEnvelope) <= policy.max_context_chars) return safeEnvelope;

  const projectionDocument = {
    version: AGENT_RESPONSE_PROJECTION_VERSION,
    kind: 'agent_response_projection',
    task_id: task.task_id,
    task_state: envelope.task_state,
    result: safeResult,
    warnings: safeWarnings,
    error: safeError,
    next_action: safeNextAction,
    artifacts: sourceArtifacts
  };
  const projectionArtifact = await persistProjection(taskStore, task.task_id, projectionDocument);
  const refreshedTask = await taskStore.getTask(task.task_id);
  const compactResult = compactAgentPayload(safeResult, projectionArtifact.handle);
  safeEnvelope = {
    ...safeEnvelope,
    task_version: refreshedTask.task_version,
    result: compactResult,
    data: compactResult,
    warnings: compactWarnings(safeWarnings),
    error: compactError(safeError),
    next_action: compactNextAction(safeNextAction),
    artifacts: [projectionArtifact],
    presentation: presentationSummary(policy, omissions, {
      projected: true,
      fullResultArtifact: projectionArtifact.handle
    })
  };
  if (serializedChars(safeEnvelope) <= policy.max_context_chars) return safeEnvelope;

  const minimalResult = minimalAgentPayload(safeResult, projectionArtifact.handle);
  safeEnvelope = {
    ...safeEnvelope,
    result: minimalResult,
    data: minimalResult,
    warnings: [],
    error: compactError(safeError, { minimal: true }),
    next_action: compactNextAction(safeNextAction, { minimal: true })
  };
  if (serializedChars(safeEnvelope) <= policy.max_context_chars) return safeEnvelope;
  throw new AgentContractError('INTERNAL_ERROR', 'The server could not create a bounded Agent response projection.');
}

export function projectCapabilityValue(value, policy, omissions = { local_paths: 0, visual_payloads: 0 }, key = '') {
  // Raw visual payloads are not necessarily strings. Pixel arrays and parsed
  // byte objects must follow the same no-vision policy as base64 strings.
  if (!policy.effective_capabilities.vision
    && isVisualContentKey(key)
    && value !== undefined
    && value !== null) {
    omissions.visual_payloads += 1;
    return undefined;
  }
  if (typeof value === 'string') {
    if (!policy.effective_capabilities.local_files && isPathKey(key, value) && looksLikeFileReference(value)) {
      omissions.local_paths += 1;
      return undefined;
    }
    if (!policy.effective_capabilities.vision && looksLikeInlineImage(value)) {
      omissions.visual_payloads += 1;
      return undefined;
    }
    return policy.effective_capabilities.local_files ? value : redactEmbeddedLocalPaths(value, omissions);
  }
  if (Array.isArray(value)) {
    // Detailed-model occurrence chains contain model IDs, not local files.
    // Preserve only a complete chain of conservative IDs; never partially
    // shorten a malformed chain into a different editable target.
    if (!policy.effective_capabilities.local_files && ['instance_path', 'persistent_path'].includes(key)) {
      if (value.every(item => typeof item === 'string'
        && (/^[A-Za-z0-9_-]+$/.test(item) || isModelEntityPath(item)))) return [...value];
      omissions.local_paths += 1;
      return [];
    }
    return value
      .map((item) => projectCapabilityValue(item, policy, omissions, key))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;

  const visualObject = !policy.effective_capabilities.vision
    && (String(value.type || '').toLowerCase() === 'image'
      || String(value.media_type || value.mediaType || '').toLowerCase().startsWith('image/'));
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (visualObject && ['content', 'data', 'base64', 'bytes', 'imageurl'].includes(normalizedKey(childKey)) && childValue) {
      omissions.visual_payloads += 1;
      continue;
    }
    const projected = projectCapabilityValue(childValue, policy, omissions, childKey);
    if (projected !== undefined) result[childKey] = projected;
  }
  if (visualObject && Object.keys(result).length === 0) {
    return { type: 'image_summary', omitted_for_capability: true };
  }
  return result;
}

async function persistProjection(taskStore, taskId, document) {
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  return persistDeterministicArtifact(taskStore, taskId, {
    bytes,
    directoryName: 'agent-response-projections',
    labelPrefix: PROJECTION_LABEL_PREFIX,
    extension: '.json',
    kind: 'json',
    mediaType: 'application/json'
  });
}

export async function capabilitySafeArtifact({ taskStore, task, handle } = {}) {
  const policy = responsePolicyForTask(task);
  const inspected = await taskStore.inspectArtifact(handle);
  const record = inspected.record;
  if (String(record.label || '').startsWith(PROJECTION_LABEL_PREFIX)
    || String(record.label || '').startsWith(SAFE_ARTIFACT_LABEL_PREFIX)) {
    return { artifact: record, omissions: { local_paths: 0, visual_payloads: 0 }, content_omitted: false };
  }
  if (record.media_type.startsWith('image/') && !policy.effective_capabilities.vision) {
    return {
      artifact: record,
      omissions: { local_paths: 0, visual_payloads: 1 },
      content_omitted: true
    };
  }
  const needsPathProjection = !policy.effective_capabilities.local_files;
  const needsVisionProjection = !policy.effective_capabilities.vision;
  const isText = record.media_type === 'application/json'
    || record.media_type.startsWith('text/')
    || record.kind === 'json'
    || record.kind === 'markdown';
  if (!isText || (!needsPathProjection && !needsVisionProjection)) {
    return { artifact: record, omissions: { local_paths: 0, visual_payloads: 0 }, content_omitted: false };
  }

  const omissions = { local_paths: 0, visual_payloads: 0 };
  const sourceValue = inspected.json === null
    ? await readCompleteTextArtifact(taskStore, handle)
    : inspected.json;
  const projected = projectCapabilityValue(sourceValue, policy, omissions);
  const json = inspected.json !== null;
  const bytes = json ? `${JSON.stringify(projected, null, 2)}\n` : String(projected ?? '');
  const digestSeed = crypto.createHash('sha256').update(handle).digest('hex').slice(0, 16);
  const artifact = await persistDeterministicArtifact(taskStore, task.task_id, {
    bytes,
    directoryName: 'agent-capability-safe-artifacts',
    labelPrefix: `${SAFE_ARTIFACT_LABEL_PREFIX}${digestSeed}-`,
    extension: json ? '.json' : '.txt',
    kind: json ? 'json' : 'text',
    mediaType: json ? 'application/json' : 'text/plain'
  });
  return { artifact, omissions, content_omitted: false };
}

async function persistDeterministicArtifact(taskStore, taskId, {
  bytes,
  directoryName,
  labelPrefix,
  extension,
  kind,
  mediaType
}) {
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const directory = path.join(taskStore.rootDir, 'task-artifacts', taskId, directoryName);
  const filePath = path.join(directory, `${digest}${extension}`);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      await fs.link(temporary, filePath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await fs.readFile(filePath, 'utf8');
      if (existing !== bytes) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The deterministic Agent response projection changed unexpectedly.');
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return taskStore.registerArtifact(taskId, {
    filePath,
    kind,
    mediaType,
    label: `${labelPrefix}${digest.slice(0, 16)}${extension}`
  });
}

async function readCompleteTextArtifact(taskStore, handle) {
  let content = '';
  let offset = 0;
  do {
    const page = await taskStore.readArtifact(handle, { maxChars: 100000, offset });
    content += page.content;
    if (page.eof) return content;
    offset = page.next_offset;
  } while (offset !== null);
  return content;
}

function presentationSummary(policy, omissions, { projected, fullResultArtifact }) {
  return {
    policy_version: policy.policy_version,
    interface_level: policy.interface_level,
    context: policy.effective_capabilities.context,
    max_chars: policy.max_context_chars,
    local_files: policy.effective_capabilities.local_files,
    vision: policy.effective_capabilities.vision,
    structured_output: true,
    serialization: 'json_envelope',
    client_structured_output_required: false,
    parallel: false,
    max_in_flight_per_task: policy.max_in_flight_per_task,
    projected: projected === true,
    full_result_artifact: fullResultArtifact || null,
    omitted_local_paths: omissions.local_paths,
    omitted_visual_payloads: omissions.visual_payloads
  };
}

function compactAgentPayload(payload, fullResultHandle) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (source.kind === 'parameter_source_discovery') return compactParameterSources(source, fullResultHandle);
  if (source.topic === 'workflows') return compactWorkflow(source);
  if (source.kind === 'model_accessibility_appearance') return compactAccessibilityExecution(source, fullResultHandle);
  if (source.parameter_rules) return compactParameterContract(source, fullResultHandle);
  const taskExample = compactTaskExample(source, fullResultHandle);
  if (taskExample) return taskExample;
  if (source.topic === 'assets' && source.catalog?.assets) {
    const profiles = [];
    const assets = source.catalog.assets.slice(0, 3).map(asset => {
      const profile = { axes: asset.axes, source: asset.source, license: asset.license, measurement: asset.dimensions_evidence?.source };
      let index = profiles.findIndex(value => JSON.stringify(value) === JSON.stringify(profile));
      if (index < 0) { index = profiles.length; profiles.push(profile); }
      return { id: asset.id, file: asset.file_name || null, available: asset.available, dimensions_mm: asset.default_dimensions_mm, profile: index };
    });
    return {
    kind: source.kind, topic: 'assets', evidence_level: 'preflight_only',
    status: { execution_status: source.status?.execution_status, quality_status: source.status?.quality_status, quality_accepted: false },
    assets, profiles,
    units: 'mm', native_geometry_verified: false, inline_count: Math.min(3, source.catalog.assets.length),
    returned_count: source.catalog.assets.length,
    note: 'asset.profile indexes profiles (axes/source/license). Recorded bounds; import requires .skp and fresh measurement. JSON already saved.',
    catalog_handle: source.catalog_artifacts?.[0]?.handle,
    full_result_artifact: fullResultHandle
  }; }
  if (['model_accessibility_discovery', 'model_accessibility_preflight', 'model_accessibility_delivery'].includes(source.kind)) {
    return { kind: source.kind, topic: source.topic, evidence_level: source.evidence_level, quality_status: source.quality_status,
      quality_accepted: source.quality_accepted, status: source.status,
      ...(source.kind === 'model_accessibility_preflight' ? { preflight_ok: source.preflight?.ok === true, execution_started: false, next_step: 'Preflight is complete. Connect to queue, then create_model using the same inputs.task and a stable idempotency_key. Actual geometry and views are checked after execution.' } : {}),
      ...(source.connection_task_id ? { connection_task_id: source.connection_task_id, connection_expires_at: source.connection_expires_at, gateway_creation_allowed: source.gateway_creation_allowed } : {}),
      ...(source.kind === 'model_accessibility_delivery' ? { source_task_id: source.source_task_id, saved: source.saved, file: source.file, cold_reopen_verified: false, artifact: source.artifact, remaining: source.remaining, optional_validation: source.optional_validation } : {}),
      ...(source.topic === 'start' ? { units: 'mm', current_model: 'not_checked', entry: 'Discover topic=tasks; select kind and detail=examples. Preflight before create_model; explicit runtime and stable idempotency_key are required.' } : {}),
      ...(Array.isArray(source.catalog?.tasks) ? { task_kinds: source.catalog.tasks.map(task => task.kind) } : {}),
      ...(source.topic === 'assets' ? { assets: (source.catalog?.assets || []).slice(0, 3).map(asset => ({
        id: asset.id, name: asset.name, kind: asset.kind, available: asset.available,
        default_dimensions_mm: asset.default_dimensions_mm, source: asset.source, license: asset.license,
        axes: asset.axes,
        native_geometry_verified: false, dimensions_source: asset.dimensions_evidence?.source
      })), returned_count: source.catalog?.assets?.length || 0, catalog_artifacts: source.catalog_artifacts } : {}),
      summary: source.topic === 'connect' ? 'Connection is ready. Use connection_task_id directly for the next live task; it expires at connection_expires_at.'
        : source.topic === 'tasks' ? 'Choose one task_kinds value and discover topic=tasks, kind=<selected>, detail=examples.'
          : source.kind === 'model_accessibility_preflight' ? 'The input passed preflight; no further artifact reading is required to attempt creation.'
            : 'Additional detail is available through the task-bound artifact.',
      read_contract: { tool: 'read_agent_artifact', arguments: { task_id: source.status?.resume?.arguments?.task_id, handle: fullResultHandle, offset: 0, max_chars: 1500 } },
      full_result_artifact: fullResultHandle };
  }
  const kind = String(source.kind || 'agent_projected_result');
  const common = { kind, full_result_artifact: fullResultHandle };
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
  if (kind === 'propose_existing_model_edit_result') {
    const proposal = source.proposal || {};
    return {
      ...common,
      model_graph: compactModelGraph(source.model_graph),
      proposal: {
        model_revision: proposal.model_revision,
        proposal_id: proposal.proposal_id,
        proposal_hash: proposal.proposal_hash,
        candidate_count: Array.isArray(proposal.candidates) ? proposal.candidates.length : proposal.candidate_count,
        candidates: (proposal.candidates || []).slice(0, 3).map(compactCandidate),
        selected_targets: (proposal.selected_targets || []).slice(0, 3).map(compactTarget),
        operation_proposal: (proposal.operation_proposal || []).slice(0, 3).map(compactOperation),
        risk_level: proposal.risk_level,
        confidence: proposal.confidence,
        requires_clarification: proposal.requires_clarification,
        ambiguity_reasons: (proposal.ambiguity_reasons || []).slice(0, 3),
        execution_allowed: false,
        next_action: compactNextAction(proposal.next_action)
      }
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
      destructive_side_effects: compactDestructiveSideEffects(source.destructive_side_effects),
      blockers: source.blockers || [],
      approval_challenge: compactApprovalChallenge(source.approval_challenge),
      execution_mode: source.execution_mode,
      user_action_required: source.user_action_required,
      copy_fast_session: compactCopyFastSession(source.copy_fast_session),
      source_proposal: source.source_proposal || null,
      source_design_change: source.source_design_change || null
    };
  }
  if (kind === 'reviewed_existing_model_edit_result') {
    return {
      ...common,
      ok: source.ok,
      plan_id: source.plan_id,
      plan_hash: source.plan_hash,
      risk_level: source.risk_level,
      authorization: compactAuthorization(source.authorization),
      model_revision_before: source.model_revision_before,
      model_revision_after: source.model_revision_after,
      mutation_receipt: source.mutation_receipt ? {
        receipt_id: source.mutation_receipt.receipt_id,
        status: source.mutation_receipt.status
      } : null,
      qa: compactQa(source.qa),
      lineage_status: source.lineage_status,
      decision: source.decision,
      design_intent_store: compactDesignIntentStore(source.design_intent_store),
      reconciliation: compactDesignReconciliation(source.reconciliation),
      source_visual_correction: source.source_visual_correction,
      visual_apply_receipt: compactVisualApplyReceipt(source.visual_apply_receipt),
      approval_challenge: compactApprovalChallenge(source.approval_challenge)
    };
  }
  if (kind === 'modify_design_parameters_result') {
    if (source.stage) return compactAccessibilityExecution(source, fullResultHandle);
    return {
      ...common,
      design_intent_store: compactDesignIntentStore(source.design_intent_store),
      change_plan: compactDesignChangePlan(source.change_plan)
    };
  }
  if (kind === 'reconcile_design_intent_result') {
    return {
      ...common,
      lineage_status: source.lineage_status,
      decision: source.decision,
      design_intent_store: compactDesignIntentStore(source.design_intent_store),
      reconciliation: compactDesignReconciliation(source.reconciliation),
      approval_challenge: compactApprovalChallenge(source.approval_challenge)
    };
  }
  if (kind === 'create_model_result' || kind === 'verify_model_result') {
    return {
      ...common,
      snapshot: compactSnapshot(source.snapshot),
      qa: compactQa(source.qa),
      report: compactQa(source.report),
      quality_status: source.quality_status,
      status: source.status,
      quality_accepted: source.quality_accepted,
      evidence_level: source.evidence_level,
      quality: source.quality ? { quality_status: source.quality.quality_status, specification_hash: source.quality.specification_hash, remaining_count: source.quality.remaining?.length || 0, remaining: source.quality.remaining?.slice(0, 5), ...(source.quality.resource_costs ? { resource_costs: source.quality.resource_costs } : {}) } : undefined,
      compile_allowed: source.compile_allowed,
      verification: source.verification
    };
  }
  if (kind === 'reference_image_correction_result') {
    return {
      ...common,
      evidence: compactVisualEvidence(source.evidence),
      correction_patch: compactCorrectionPatch(source.correction_patch),
      image_artifacts: compactImageArtifactHandles(source.image_artifacts),
      visual_agent_required: source.visual_agent_required === true,
      local_files_required: source.local_files_required === true,
      capture_mode: source.capture_mode
    };
  }
  if (kind === 'visual_correction_qa_result') {
    return {
      ...common,
      version: source.version,
      report: compactVisualQaReport(source.report),
      background_normalized_comparison: compactBackgroundNormalizedComparison(
        source.background_normalized_comparison
      ),
      visual_agent_required: source.visual_agent_required === true,
      local_files_required: source.local_files_required === true,
      structured_summary_available: source.structured_summary_available === true,
      capture_mode: source.capture_mode,
      diagnostic_boundary: source.diagnostic_boundary
    };
  }
  const primitives = Object.fromEntries(Object.entries(source).filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item)));
  return { ...common, ...primitives };
}

function minimalAgentPayload(payload, fullResultHandle) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (source.kind === 'parameter_source_discovery') return compactParameterSources(source, fullResultHandle);
  if (source.topic === 'workflows') return compactWorkflow(source);
  if (source.parameter_rules) return compactParameterContract(source, fullResultHandle);
  if ((source.kind === 'modify_design_parameters_result' && source.stage) || source.kind === 'model_accessibility_appearance') return compactAccessibilityExecution(source, fullResultHandle, true);
  const taskExample = compactTaskExample(source, fullResultHandle);
  if (taskExample) return taskExample;
  if (['create_model_result', 'verify_model_result'].includes(source.kind)) {
    return {
      kind: source.kind,
      status: source.status,
      quality_status: source.quality_status,
      quality_accepted: source.quality_accepted,
      evidence_level: source.evidence_level,
      remaining_count: source.quality?.remaining?.length || 0,
      remaining: (source.quality?.remaining || []).slice(0, 3).map(issue => Object.fromEntries(Object.entries(issue).filter(([key]) => ['type', 'part_id', 'part_key', 'view_id', 'status', 'reason'].includes(key)))),
      full_result_artifact: fullResultHandle
    };
  }
  if (source.kind === 'reference_image_correction_result') {
    const overlay = source.image_artifacts?.overlay;
    return {
      kind: source.kind,
      evidence: Object.fromEntries(Object.entries({
        alignment: source.evidence?.alignment ? {
          foreground_center_delta_norm: source.evidence.alignment.foreground_center_delta_norm
        } : undefined,
        difference: source.evidence?.difference ? {
          mean_absolute_error: source.evidence.difference.mean_absolute_error,
          root_mean_square_error: source.evidence.difference.root_mean_square_error
        } : undefined,
        confidence: source.evidence?.confidence,
        blockers: Array.isArray(source.evidence?.blockers) ? source.evidence.blockers.slice(0, 3) : []
      }).filter(([, value]) => value !== undefined)),
      correction_patch: {
        risk_level: source.correction_patch?.risk_level,
        blockers: Array.isArray(source.correction_patch?.blockers)
          ? source.correction_patch.blockers.slice(0, 3)
          : [],
        execution_allowed: false,
        review_required: true
      },
      image_artifacts: overlay ? {
        overlay: Object.fromEntries(Object.entries({
          role: overlay.role,
          handle: overlay.handle,
          media_type: overlay.media_type
        }).filter(([, value]) => value !== undefined))
      } : {},
      visual_agent_required: false,
      local_files_required: false,
      capture_mode: source.capture_mode,
      full_result_artifact: fullResultHandle
    };
  }
  return {
    kind: String(source.kind || 'agent_projected_result'),
    ...(source.status ? { status: source.status } : {}),
    summary: 'The complete capability-safe result is available through the opaque artifact handle.',
    full_result_artifact: fullResultHandle
  };
}

function compactParameterSources(source, fullResultHandle) {
  return { kind: source.kind, topic: 'parameter_sources', current_model: source.current_model, evidence_level: source.evidence_level,
    sources: (source.sources || []).slice(0, 3).map(item => ({ creation_task_id: item.creation_task_id, kind: item.kind, roots: item.roots,
      supported_parameters: item.supported_parameters, baseline_captured: item.baseline_captured, parameter_revision: item.parameter_revision, current_geometry_rechecked: false })),
    saved_source_continuations: (source.saved_source_continuations || []).slice(0, 3),
    returned_source_count: (source.sources || []).length, note: source.note, full_result_artifact: fullResultHandle };
}

function compactWorkflow(source) {
  // Keep selected core inputs in both fallbacks: this is an action contract,
  // not a long result whose opaque artifact must be paged before continuing.
  return Object.fromEntries(['kind', 'topic', 'task_name', 'task_names', 'support', 'evidence_level', 'quality_accepted', 'template_only', 'next_call', 'call_template', 'fixed_design', 'next_step', 'limits']
    .filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}

function compactParameterContract(source, fullResultHandle) {
  return { kind: source.kind, task_kind: source.task_kind, units: source.units,
    parameter_rules: Object.fromEntries(Object.entries(source.parameter_rules).map(([name, rule]) => [name,
      `${rule.type}; ${rule.enum ? 'one of ' + JSON.stringify(rule.enum) : '[' + rule.minimum + ',' + rule.maximum + ']'}; ${Object.hasOwn(rule, 'default') ? 'default=' + JSON.stringify(rule.default) : 'required'}`])),
    dependencies: source.dependencies, fixed_design: source.fixed_design,
    next_step: 'Use the inline example with these rules; try preflight next. It returns exact remaining input errors. The artifact is optional.',
    full_result_artifact: fullResultHandle };
}

function compactAccessibilityExecution(source, fullResultHandle, minimal = false) {
  const keys = ['kind', 'stage', 'reviewed_task_id', 'scope', 'plan_id', 'plan_hash', 'appearance_kind',
    'definitions_staged', 'geometry_applied', 'outcome_unknown', 'execution_allowed', 'saved',
    'quality_accepted', 'quality_status', 'evidence_level', 'model_revision', 'replaced_instance_count',
    'geometry_preserved', 'unrelated_unchanged', 'cold_reopen_verified'];
  return {
    ...Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]])),
    ...(source.status ? { status: { execution_status: source.status.execution_status, recovery_class: source.status.recovery_class, resume: source.status.resume } } : {}),
    blockers: (source.blockers || []).slice(0, minimal ? 2 : 4),
    ...(source.native_readback ? { native_readback: { ok: source.native_readback.ok } } : {}),
    ...(source.approval_challenge && !minimal ? { approval_challenge: compactApprovalChallenge(source.approval_challenge) } : {}),
    ...(source.remaining ? { remaining: source.remaining.slice(0, minimal ? 2 : 4) } : {}),
    ...(source.optional_validation ? { optional_validation: source.optional_validation } : {}),
    full_result_artifact: fullResultHandle
  };
}

function compactTaskExample(source, handle) {
  const tasks = source.catalog?.tasks;
  if (source.kind !== 'model_accessibility_discovery' || tasks?.length !== 1) return null;
  const selected = tasks[0];
  const input = selected.examples?.minimal?.arguments?.inputs?.task;
  if (!input) return null;
  return {
    kind: source.kind, topic: 'tasks', evidence_level: source.evidence_level,
    task_input: input, fixed_design: selected.fixed_design,
    use: 'All required fields are in task_input. Replace its example values with the user dimensions, then preflight_model with inputs.task; preflight checks ranges/dependencies. No artifact reading is needed to attempt this task. For live creation discover/connect runtime=queue, then create_model with inputs.task, runtime=queue, connection_task_id and a stable idempotency_key.',
    status: source.status,
    full_result_artifact: handle
  };
}

function compactCandidate(candidate = {}) {
  return {
    node_id: candidate.node_id,
    persistent_ref: candidate.persistent_ref,
    confidence: candidate.confidence,
    allowed_for_operation: candidate.allowed_for_operation,
    shared_definition: candidate.shared_definition,
    affected_instance_count: candidate.affected_instance_count,
    name: candidate.summary?.value?.name,
    kind: candidate.summary?.value?.kind || candidate.entity_type
  };
}

function compactTarget(target = {}) {
  return Object.fromEntries(Object.entries({
    node_id: target.node_id,
    persistent_ref: target.persistent_ref,
    entity_path: target.entity_path,
    edit_scope: target.edit_scope,
    instance_policy: target.instance_policy
  }).filter(([, value]) => value !== undefined));
}

function compactOperation(operation = {}) {
  return Object.fromEntries(Object.entries({
    op: operation.op,
    entity_path: operation.entity_path,
    target_id: operation.target_id,
    distance: operation.distance,
    material: operation.material,
    new_name: operation.new_name
  }).filter(([, value]) => value !== undefined));
}

function compactModelGraph(value = {}) {
  return {
    graph_id: value.graph_id,
    model_revision: value.model_revision,
    stats: value.stats
  };
}

function compactAuthorization(value) {
  if (!value || typeof value !== 'object') return value || null;
  return Object.fromEntries(Object.entries({
    mode: value.mode,
    approved_by: value.approved_by,
    challenge_id: value.challenge_id,
    decision_id: value.decision_id,
    copy_fast_session_id: value.copy_fast_session_id,
    user_action_required: value.user_action_required
  }).filter(([, item]) => item !== undefined));
}

function compactCopyFastSession(value) {
  if (!value || typeof value !== 'object') return value || null;
  return Object.fromEntries(Object.entries({
    version: value.version,
    status: value.status,
    session_id: value.session_id,
    model_key: value.model_key,
    runtime: value.runtime,
    issued_at: value.issued_at,
    expires_at: value.expires_at,
    reused: value.reused,
    user_action_required: value.user_action_required,
    agent_can_enable: value.agent_can_enable,
    local_paths_exposed: value.local_paths_exposed
  }).filter(([, item]) => item !== undefined));
}

function compactDestructiveSideEffects(value = {}) {
  const targets = Array.isArray(value?.expected_absent_targets)
    ? value.expected_absent_targets
    : [];
  const projectedTargets = targets.slice(0, 50).map((target) => Object.fromEntries(Object.entries({
    entity_path: target?.entity_path,
    parent_entity_path: target?.parent_entity_path,
    reason: target?.reason,
    postcondition: target?.postcondition,
    caused_by_absent_children: Array.isArray(target?.caused_by_absent_children)
      ? target.caused_by_absent_children.slice(0, 50)
      : undefined,
    affected_instance_count: target?.entity?.affected_instance_count
  }).filter(([, item]) => item !== undefined)));
  return {
    expected_absent_target_count: targets.length,
    expected_absent_targets: projectedTargets,
    ...(targets.length > projectedTargets.length ? { truncated: true } : {})
  };
}

function compactVisualEvidence(value = {}) {
  return Object.fromEntries(Object.entries({
    version: value.version,
    kind: value.kind,
    content_trust: value.content_trust,
    policy_effect: value.policy_effect,
    evidence_id: value.evidence_id,
    evidence_hash: value.evidence_hash,
    alignment: value.alignment,
    difference: value.difference,
    confidence: value.confidence,
    blockers: value.blockers || []
  }).filter(([, item]) => item !== undefined));
}

function compactVisualQaReport(value = {}) {
  return Object.fromEntries(Object.entries({
    version: value.version,
    verdict: value.verdict,
    improved: value.improved,
    review_required: value.review_required,
    mean_absolute_error: value.difference?.mean_absolute_error,
    foreground_center_delta_norm: value.alignment?.foreground_center_delta_norm
  }).filter(([, item]) => item !== undefined));
}

function compactBackgroundNormalizedComparison(value = {}) {
  const palette = value.appearance?.palette || {};
  return Object.fromEntries(Object.entries({
    version: value.version,
    segmentation_reliable: value.segmentation?.reliable,
    structure_verdict: value.structure?.verdict,
    intersection_over_union: value.structure?.intersection_over_union,
    dice_coefficient: value.structure?.dice_coefficient,
    aspect_ratio_log_delta: value.structure?.aspect_ratio_log_delta,
    appearance_mean_absolute_error: value.appearance?.mean_absolute_error,
    yellow_fraction_delta: palette.yellow_fraction_delta,
    dark_fraction_delta: palette.dark_fraction_delta,
    light_neutral_fraction_delta: palette.light_neutral_fraction_delta,
    blockers: value.blockers || [],
    visual_similarity_accepted: value.visual_similarity_accepted
  }).filter(([, item]) => item !== undefined));
}

function compactCorrectionPatch(value = {}) {
  return Object.fromEntries(Object.entries({
    version: value.version,
    kind: value.kind,
    correction_patch_id: value.correction_patch_id,
    patch_hash: value.patch_hash,
    risk_level: value.risk_level,
    blockers: value.blockers || [],
    execution_allowed: value.execution_allowed,
    review_required: value.review_required,
    next_action: compactNextAction(value.next_action)
  }).filter(([, item]) => item !== undefined));
}

function compactImageArtifacts(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, artifact]) => [
    key,
    Object.fromEntries(Object.entries({
      role: artifact?.role,
      handle: artifact?.handle,
      sha256: artifact?.sha256,
      media_type: artifact?.media_type,
      format: artifact?.format,
      size_bytes: artifact?.size_bytes,
      width: artifact?.width,
      height: artifact?.height,
      channels: artifact?.channels,
      content_trust: artifact?.content_trust,
      policy_effect: artifact?.policy_effect
    }).filter(([, item]) => item !== undefined))
  ]));
}

function compactImageArtifactHandles(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, artifact]) => [
    key,
    Object.fromEntries(Object.entries({
      role: artifact?.role,
      handle: artifact?.handle,
      media_type: artifact?.media_type
    }).filter(([, item]) => item !== undefined))
  ]));
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
    severity: warning?.severity,
    ...(warning?.source !== undefined ? { source: warning.source } : {})
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

function compactNextAction(value, { minimal = false } = {}) {
  if (!value || typeof value !== 'object') return value || null;
  const next = {
    action: value.action,
    then_tool: value.then_tool,
    tool: value.tool,
    task_id: value.task_id,
    handle: value.handle,
    offset: value.offset,
    max_chars: value.max_chars,
    required: Array.isArray(value.required) ? value.required.slice(0, 10) : value.required,
    reason: value.reason,
    approval_status: value.approval_status,
    authorization_mode: value.authorization_mode,
    user_action_required: value.user_action_required,
    copy_fast_session_id: value.copy_fast_session_id,
    challenge_id: value.challenge?.challenge_id || value.challenge_id,
    source_visual_correction: value.source_visual_correction,
    source_task_id: value.source_task_id
  };
  if (!minimal || ['discover_tasks', 'connect_for_delivery', 'resume_agent_task'].includes(value?.action)) next.arguments = compactNextActionArguments(value);
  if (!minimal && value.approval_host) {
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

function compactNextActionArguments(value) {
  const args = value?.arguments;
  if (value?.tool === 'start_agent_task' && args?.intent === 'discover' && JSON.stringify(args).length <= 1200) return args;
  if (value?.tool === 'resume_agent_task' && /^task_[0-9a-f-]+$/i.test(args?.task_id || '')) return { task_id: args.task_id };
  if (value?.tool === 'read_agent_artifact' && typeof args?.handle === 'string' && JSON.stringify(args).length <= 1200) return args;
  if (value?.action !== 'start_reviewed_existing_model_edit'
    || value?.tool !== 'start_agent_task'
    || !args
    || args.intent !== 'reviewed_existing_model_edit'
    || !args.inputs
    || typeof args.inputs !== 'object'
    || Array.isArray(args.inputs)) return undefined;
  const sourceProposal = compactSourceProposalBinding(args.inputs.source_proposal);
  const sourceDesignChange = compactSourceDesignChangeBinding(args.inputs.source_design_change);
  const sourceVisualCorrection = /^source_visual_correction:task_[0-9a-f-]+$/i.test(String(args.inputs.source_visual_correction || ''))
    ? args.inputs.source_visual_correction
    : undefined;
  if ([sourceProposal, sourceDesignChange, sourceVisualCorrection].filter(Boolean).length !== 1) return undefined;
  const inputs = {
    ...(['mock', 'queue'].includes(args.inputs.runtime) ? { runtime: args.inputs.runtime } : {}),
    ...(sourceProposal ? { source_proposal: sourceProposal } : {}),
    ...(sourceDesignChange ? { source_design_change: sourceDesignChange } : {}),
    ...(sourceVisualCorrection ? { source_visual_correction: sourceVisualCorrection } : {}),
    ...(Number.isInteger(args.inputs.recursive_limit) && args.inputs.recursive_limit > 0
      ? { recursive_limit: args.inputs.recursive_limit }
      : {}),
    ...(typeof args.inputs.save_model === 'boolean' ? { save_model: args.inputs.save_model } : {}),
    ...(args.inputs.capture_view === true ? { capture_view: true } : {})
  };
  return {
    intent: 'reviewed_existing_model_edit',
    instruction: String(args.instruction || 'Apply the server-bound reviewed edit.').slice(0, 512),
    interface_level: 'guided',
    inputs
  };
}

function compactSourceProposalBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !/^task_[0-9a-f-]+$/i.test(String(value.task_id || ''))
    || !/^edit-proposal-[0-9a-f]{24}$/i.test(String(value.proposal_id || ''))
    || !/^sha256:[0-9a-f]{64}$/i.test(String(value.proposal_hash || ''))
    || !/^model-graph-[0-9a-f]{24}$/i.test(String(value.graph_id || ''))
    || !/^model_[0-9a-f]{32}$/i.test(String(value.model_key || ''))
    || !/^sha256:[0-9a-f]{64}$/i.test(String(value.model_revision || ''))) return null;
  return {
    task_id: value.task_id,
    proposal_id: value.proposal_id,
    proposal_hash: value.proposal_hash,
    graph_id: value.graph_id,
    model_key: value.model_key,
    model_revision: value.model_revision
  };
}

function compactSourceDesignChangeBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || canonicalObjectKeys(value) !== 'task_id'
    || !/^task_[0-9a-f-]+$/i.test(String(value.task_id || ''))) return null;
  return { task_id: value.task_id };
}

function compactDesignGraph(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries({
    design_graph_id: value.design_graph_id,
    model_key: value.model_key,
    model_revision: value.model_revision,
    stats: value.stats
  }).filter(([, item]) => item !== undefined));
}

function compactDesignIntentStore(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries({
    model_key: value.model_key,
    design_graph_id: value.design_graph_id,
    model_revision: value.model_revision,
    version_count: value.version_count,
    reconciliation_count: value.reconciliation_count,
    reused: value.reused
  }).filter(([, item]) => item !== undefined));
}

function compactDesignChangePlan(value) {
  if (!value || typeof value !== 'object') return null;
  const operations = Array.isArray(value.operations) ? value.operations : [];
  return Object.fromEntries(Object.entries({
    change_plan_id: value.change_plan_id,
    model_key: value.model_key,
    changes: compactPrimitiveMap(value.changes),
    affected_binding_count: Array.isArray(value.affected_subgraph) ? value.affected_subgraph.length : undefined,
    target_count: Array.isArray(value.targets) ? value.targets.length : undefined,
    operation_count: operations.length,
    operation_types: [...new Set(operations.map((item) => String(item?.op || '')).filter(Boolean))].slice(0, 20),
    risk_level: value.risk_level,
    blockers: Array.isArray(value.blockers) ? value.blockers.slice(0, 20) : [],
    divergence_count: Array.isArray(value.divergence) ? value.divergence.length : undefined,
    execution_allowed: false,
    execution_route: value.execution_route
  }).filter(([, item]) => item !== undefined));
}

function compactDesignReconciliation(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries({
    version: value.version,
    kind: value.kind,
    reconciliation_id: value.reconciliation_id,
    model_key: value.model_key,
    design_graph_id: value.design_graph_id,
    previous_model_revision: value.previous_model_revision,
    current_model_revision: value.current_model_revision,
    aligned: value.aligned,
    expected_change_count: Array.isArray(value.expected_changes) ? value.expected_changes.length : undefined,
    unexpected_divergence_count: Array.isArray(value.unexpected_divergence) ? value.unexpected_divergence.length : undefined,
    review_required: value.review_required,
    silent_overwrite_allowed: value.silent_overwrite_allowed,
    proposed_decisions: Array.isArray(value.proposed_decisions)
      ? value.proposed_decisions.slice(0, 10).map((item) => ({
        decision: item?.decision,
        binding_count: Array.isArray(item?.binding_ids) ? item.binding_ids.length : undefined
      }))
      : []
  }).filter(([, item]) => item !== undefined));
}

function compactVisualApplyReceipt(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries({
    receipt_id: value.receipt_id,
    receipt_hash: value.receipt_hash,
    model_revision_after: value.model_revision_after
  }).filter(([, item]) => item !== undefined));
}

function compactPrimitiveMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
    .slice(0, 20));
}

function canonicalObjectKeys(value) {
  return Object.keys(value).sort().join(',');
}

function compactError(value, { minimal = false } = {}) {
  if (!value || typeof value !== 'object') return value || null;
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable === true,
    next_action: compactNextAction(value.next_action, { minimal }),
    ...(value.details?.issues ? { details: {
      recovery_class: value.details.recovery_class,
      issues: value.details.issues.slice(0, minimal ? 1 : 3).map(issue => ({ path: String(issue.path || '').slice(0, 160), message: String(issue.message || issue.reason || '').slice(0, 220) })),
      issue_count: value.details.issues.length
    } } : {})
  };
}

function isPathKey(key, value) {
  // SketchUp occurrence paths are stable model identifiers, not filesystem
  // capabilities. Agents need them to disambiguate targets and resume edits.
  if (MODEL_ENTITY_PATH_KEYS.has(key) && isModelEntityPath(value)) return false;
  return PATH_KEY.test(key) || CAMEL_CASE_PATH_KEY.test(key) || ['input_dir', 'output_dir', 'asset_set_path'].includes(key);
}

function looksLikeFileReference(value) {
  if (!value) return false;
  if (/^(artifact|image-artifact|pid|sha256|candidate|model-graph|design-intent):/i.test(value)) return false;
  if (/^file:/i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  return true;
}

function redactEmbeddedLocalPaths(value, omissions) {
  if (/^file:/i.test(value)) {
    omissions.local_paths += 1;
    return '[local-path-omitted]';
  }
  let redacted = value.replace(/\bfile:(?:\/\/)?[^\s"'<>]*/gi, () => {
    omissions.local_paths += 1;
    return '[local-path-omitted]';
  });
  redacted = redacted.replace(/\/(?:Users|private|Volumes|home|tmp|opt|var\/folders)\/[^\s"'<>]*/g, () => {
    omissions.local_paths += 1;
    return '[local-path-omitted]';
  });
  redacted = redacted.replace(/[A-Za-z]:\\[^\s"'<>]*/g, () => {
    omissions.local_paths += 1;
    return '[local-path-omitted]';
  });
  // Query values are routinely percent encoded by URL clients. Decode only
  // for detection and replace the whole value when it contains a local file
  // reference, keeping the surrounding remote URL intact and fail closed.
  redacted = redacted.replace(/([?&][^=&#\s"'<>]+)=([^&#\s"'<>]*)/g, (match, prefix, rawValue) => {
    let decoded = rawValue;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    if (!containsLocalFileReference(decoded)) return match;
    omissions.local_paths += 1;
    return `${prefix}=[local-path-omitted]`;
  });
  return redacted;
}

function containsLocalFileReference(value) {
  return /file:\/\//i.test(value)
    || /\/(?:Users|private|Volumes|home|tmp|opt|var\/folders)\//.test(value)
    || /[A-Za-z]:\\/.test(value);
}

function fitArtifactPageEnvelope(envelope, maxChars) {
  const artifact = envelope?.result?.kind === 'agent_artifact_page'
    ? envelope.result.artifact
    : null;
  if (!artifact || typeof artifact.content !== 'string' || serializedChars(envelope) <= maxChars) return envelope;
  const sourceContent = artifact.content;
  const start = Number.isInteger(artifact.offset) ? artifact.offset : 0;
  const total = Number.isInteger(artifact.total_chars) ? artifact.total_chars : start + sourceContent.length;
  let low = 1;
  let high = sourceContent.length;
  let fitted = null;
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const candidateArtifact = resizedArtifactPage(artifact, sourceContent.slice(0, length), start, total);
    const candidate = {
      ...envelope,
      result: { ...envelope.result, artifact: candidateArtifact },
      data: { ...envelope.result, artifact: candidateArtifact },
      next_action: candidateArtifact.next_action
    };
    if (serializedChars(candidate) <= maxChars) {
      fitted = candidate;
      low = length + 1;
    } else {
      high = length - 1;
    }
  }
  return fitted || envelope;
}

function resizedArtifactPage(artifact, content, start, total) {
  const end = start + content.length;
  const eof = end >= total;
  const maxChars = Number.isInteger(artifact.next_action?.max_chars)
    ? artifact.next_action.max_chars
    : Math.max(256, content.length);
  const nextAction = eof ? null : {
    action: 'read_artifact',
    handle: artifact.handle,
    offset: end,
    max_chars: maxChars
  };
  return {
    ...artifact,
    content,
    next_offset: eof ? null : end,
    eof,
    truncated: !eof,
    next_action: nextAction
  };
}

function isModelEntityPath(value) {
  if (Array.isArray(value)) return value.every((item) => isModelEntityPath(item));
  return value === 'model' || MODEL_ENTITY_PATH.test(String(value || ''));
}

function isVisualContentKey(key) {
  return VISUAL_CONTENT_KEYS.has(normalizedKey(key));
}

function normalizedKey(key) {
  return String(key || '').replace(/[_-]/g, '').toLowerCase();
}

function looksLikeInlineImage(value) {
  return /^\s*data:image\//i.test(value);
}

function contextNameForLimit(value) {
  if (value <= CLIENT_CONTEXT_LIMITS.short) return 'short';
  if (value <= CLIENT_CONTEXT_LIMITS.standard) return 'standard';
  return 'long';
}

function lowerInterfaceLevel(requested, trusted) {
  return INTERFACE_LEVELS[Math.min(INTERFACE_LEVELS.indexOf(requested), INTERFACE_LEVELS.indexOf(trusted))];
}

function serializedChars(value) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : serialized.length;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}
