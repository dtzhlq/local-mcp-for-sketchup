import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { queryLocalAssets } from './asset-catalog.mjs';
import path from 'node:path';
import { getRuntimeCapabilities } from './capabilities.mjs';
import { getDocs } from './docs.mjs';
import { compileExpertScript } from './expert-compiler.mjs';
import { compilePythonSdkScript } from './python-sdk-compiler.mjs';
import { modelInfoFromSnapshot } from './model-inspection.mjs';
import { MockRuntime } from './mock-runtime.mjs';
import { QueueRuntime, assertQueueImportModeAllowed } from './queue-runtime.mjs';
import { validateModelSnapshot } from './model-qa.mjs';
import { validateReferenceVisualSnapshot } from './reference-visual-qa.mjs';
import { compareSnapshots } from './snapshot-diff.mjs';
import { getWorkflowBundle } from './workflows.mjs';
import { runModelIteration } from './iteration.mjs';
import { expandDslCode } from './dsl-expansion.mjs';
import { buildLimitationsReport, formatLimitationsReportMarkdown } from './limitations-report.mjs';
import { resolveTargets } from './target-resolution.mjs';
import { analyzeSelectionGeometry } from './selection-geometry-interpreter.mjs';
import { planModificationIntent } from './modification-intent.mjs';
import { compileReviewedPartGraph, prepareImageModelingBrief } from './image-structured-mcp-adapter.mjs';
import { applyReviewedExistingModelEdit, prepareExistingModelEdit } from './existing-model-editing.mjs';
import { ApprovalAuthority } from './approval-tokens.mjs';
import { normalizeExecutionPolicy } from './agent-contract.mjs';
import { AgentTaskStore } from './agent-task-store.mjs';
import { AgentGateway } from './agent-gateway.mjs';
import { AgentContractError, canonicalJson } from './agent-contract.mjs';
import { isVerifiedModelAccessibilitySavedReceipt } from './model-accessibility-delivery.mjs';
import { CopyFastSessionAuthority } from './copy-fast-session.mjs';
import { SessionContractAuthority } from './session-contract.mjs';
import { assertStructuralProbeResult, normalizeStructuralProbeOptions } from './model-adoption.mjs';

const INTERNAL_EXECUTION_CONTEXT = Symbol('sketchup-mcp-internal-execution-context');

export class SketchUpBridge {
  constructor(options = {}) {
    this.options = options;
    this.mockRuntime = new MockRuntime(options.mock || {});
    this.executionPolicy = normalizeExecutionPolicy(options.executionPolicy || policyFromEnvironment());
    this.approvalAuthority = options.approvalAuthority || new ApprovalAuthority(options.approval || {});
    this.taskStore = options.taskStore || new AgentTaskStore(options.agentContract || {});
    this.copyFastSessionAuthority = options.copyFastSessionAuthority || new CopyFastSessionAuthority(options.copyFastSession || {});
    this.agentGateway = options.agentGateway || new AgentGateway({
      bridge: this,
      taskStore: this.taskStore,
      responsePolicy: options.agentResponsePolicy
    });
    this.sessionContractAuthority = options.sessionContractAuthority || new SessionContractAuthority(options.sessionContract || {});
    this.liveMutationAuthorization = options.liveMutationAuthorization || null;
    this.executionContext = options[INTERNAL_EXECUTION_CONTEXT] || null;
    this.runtimeCapabilitiesCache = new Map();
  }

  addDslDispatchGuard(guard) {
    if (typeof guard !== 'function') throw new TypeError('DSL dispatch guard must be a function.');
    const previous = this.options.dslDispatchGuard;
    this.options = {
      ...this.options,
      dslDispatchGuard: typeof previous === 'function'
        ? async (document, context) => {
            await previous(document, context);
            await guard(document, context);
          }
        : guard
    };
    return this;
  }

  async get_docs(options = {}) {
    const document = getDocs(options);
    return { ...document, docs: document.content };
  }

  async query_assets(options = {}) {
    return queryLocalAssets(options);
  }

  async inspect_detail_regions({ queries, runtime = 'queue', timeoutMs } = {}) {
    if (runtime !== 'queue') throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Detail region acceptance requires actual native geometry.');
    if (!Array.isArray(queries) || queries.length < 1 || queries.length > 128) throw new AgentContractError('INVALID_ARGUMENT', 'inspect_detail_regions requires 1..128 frozen region queries.');
    return this.selectRuntime(runtime, { timeoutMs }).inspectDetailRegions({ queries });
  }

  async get_workflow_bundle() {
    return getWorkflowBundle();
  }

  async prepare_image_modeling_brief(options = {}) {
    return prepareImageModelingBrief(options);
  }

  async compile_reviewed_part_graph(options = {}) {
    return compileReviewedPartGraph(options);
  }

  async prepare_existing_model_edit(options = {}) {
    return prepareExistingModelEdit({ ...options, bridge: this });
  }

  async apply_reviewed_model_edit(options = {}) {
    const runtime = options.runtime || 'mock';
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ ...options, runtime, operation: 'apply_reviewed_model_edit' }, (lockedBridge) => lockedBridge.apply_reviewed_model_edit(options));
    }
    return applyReviewedExistingModelEdit({ ...options, bridge: this });
  }

  async start_agent_task(options = {}) {
    return this.agentGateway.start(options);
  }

  async resume_agent_task(options = {}) {
    return this.agentGateway.resume(options);
  }

  async submit_agent_task_input(options = {}) {
    return this.agentGateway.submit(options);
  }

  async verify_agent_task_authorization_ready(options = {}) {
    return this.agentGateway.verifyTaskAuthorizationReady(options);
  }

  async read_agent_artifact(options = {}) {
    return this.agentGateway.readArtifact(options);
  }

  withAgentGatewayExecution({ taskId, intent } = {}, callback) {
    const scopedBridge = new SketchUpBridge({
      ...this.options,
      executionPolicy: this.executionPolicy,
      approvalAuthority: this.approvalAuthority,
      taskStore: this.taskStore,
      copyFastSessionAuthority: this.copyFastSessionAuthority,
      sessionContractAuthority: this.sessionContractAuthority,
      [INTERNAL_EXECUTION_CONTEXT]: Object.freeze({
        source: 'agent_gateway',
        task_id: taskId || null,
        intent: intent || null
      })
    });
    scopedBridge.mockRuntime = this.mockRuntime;
    return callback(scopedBridge);
  }

  async get_capabilities({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    return { runtime: await this.resolveRuntimeCapabilities(selectedRuntime, runtime, { force: true }) };
  }

  async create_queue_handshake({ expires_in_ms, expiresInMs, timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime('queue', { timeoutMs });
    if (typeof selectedRuntime.createFreshHandshakeProbe !== 'function') {
      throw new AgentContractError('HANDSHAKE_INVALID', 'Selected queue runtime does not support fresh handshake probes.');
    }
    const runtimeState = await selectedRuntime.createFreshHandshakeProbe();
    assertQueueSessionCompatibility(runtimeState, { operation: 'create_queue_handshake' });
    return {
      kind: 'create_queue_handshake',
      runtime: 'queue',
      mutates_model: false,
      session_contract: await this.sessionContractAuthority.issue(runtimeState, { expiresInMs: expires_in_ms ?? expiresInMs })
    };
  }

  async withFreshQueueMutationAuthorization({
    timeoutMs,
    expires_in_ms,
    expiresInMs,
    operation
  } = {}, callback) {
    if (typeof callback !== 'function') {
      throw new AgentContractError('INVALID_ARGUMENT', 'Fresh queue mutation authorization requires a callback.');
    }
    this.assertLiveMutationPolicy(operation);
    const selectedRuntime = this.selectRuntime('queue', { timeoutMs });
    if (typeof selectedRuntime.withFreshHandshakeProbe !== 'function') {
      throw new AgentContractError(
        'HANDSHAKE_INVALID',
        'Selected queue runtime cannot keep fresh handshake issuance and mutation authorization in one exclusive scope.'
      );
    }
    return selectedRuntime.withFreshHandshakeProbe(async (runtimeState) => {
      assertQueueSessionCompatibility(runtimeState, { operation });
      const contract = await this.sessionContractAuthority.issue(runtimeState, {
        expiresInMs: expires_in_ms ?? expiresInMs
      });
      const verified = await this.sessionContractAuthority.verify(contract, { runtimeState, operation });
      return this.invokeLiveAuthorizedQueueOperation({
        selectedRuntime,
        verified,
        operation,
        callback
      });
    }, { method: `authorize-fresh:${operation || 'live-mutation'}` });
  }

  async get_active_model_identity({ timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime('queue', { timeoutMs });
    if (typeof selectedRuntime.getActiveModelIdentity !== 'function') {
      throw new AgentContractError(
        'OPERATION_NOT_ALLOWED',
        'Selected queue runtime does not support the lightweight active-model identity probe.'
      );
    }
    return selectedRuntime.getActiveModelIdentity();
  }

  async queue_diagnostics({ includeFiles = false, timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime('queue', { timeoutMs });
    if (typeof selectedRuntime.diagnostics !== 'function') {
      throw new Error('Selected queue runtime does not support diagnostics');
    }
    return selectedRuntime.diagnostics({ includeFiles });
  }

  async recover_queue_response({ request_id, requestId, expected_result_kind, expectedResultKind, expected_client_pid, expectedClientPid, timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime('queue', { timeoutMs });
    if (typeof selectedRuntime.recoverOrphanResponse !== 'function') {
      throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Selected queue runtime does not support orphan response recovery.');
    }
    return selectedRuntime.recoverOrphanResponse({
      requestId: request_id ?? requestId,
      expectedResultKind: expected_result_kind ?? expectedResultKind,
      expectedClientPid: expected_client_pid ?? expectedClientPid
    });
  }

  async build_model({ code, runtime = 'mock', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'build_model' }, (lockedBridge) => lockedBridge.build_model({ code, runtime, timeoutMs }));
    }
    const prepared = this.prepareDslCode(code);
    if (typeof this.options.dslDispatchGuard === 'function') {
      await this.options.dslDispatchGuard(prepared.document, {
        operation: 'build_model',
        runtime,
        expansion: prepared.expansion
      });
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (prepared.document.creation_scope && (runtimeCapabilities.creation_scope?.version !== 'creation-scope.v1' || runtimeCapabilities.creation_scope?.atomic_absence_validation !== true)) {
      throw new AgentContractError('OPERATION_NOT_ALLOWED', 'The installed runtime does not support atomic scoped creation; update and restart the bridge.');
    }
    const snapshot = await selectedRuntime.buildModel(prepared.code);
    return {
      snapshot: this.attachRuntimeCapabilities(snapshot, runtimeCapabilities),
      ...(snapshot?.mutation_receipt ? { mutation_receipt: structuredClone(snapshot.mutation_receipt) } : {}),
      ...(prepared.expansion.changed ? { expansion: prepared.expansion } : {})
    };
  }

  async compile_expert({ code, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs } = {}) {
    return compileExpertScript(code, { seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, timeoutMs: expertTimeoutMs });
  }

  async compile_python_sdk({ code, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, pythonTimeoutMs, pythonCommand } = {}) {
    return compilePythonSdkScript(code, { maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, timeoutMs: pythonTimeoutMs, pythonCommand });
  }

  async build_expert_model({ code, runtime = 'mock', timeoutMs, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs, session_contract, sessionContract } = {}) {
    const compiled = await this.compile_expert({ code, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs });
    const result = await this.build_model({ code: compiled.code, runtime, timeoutMs, session_contract, sessionContract });
    return {
      compiled: {
        document: compiled.document,
        expert: compiled.expert
      },
      snapshot: result.snapshot
    };
  }

  async reset_model({ runtime = 'mock', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'reset_model' }, (lockedBridge) => lockedBridge.reset_model({ runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    const snapshot = await selectedRuntime.resetModel();
    return { snapshot: this.attachRuntimeCapabilities(snapshot, runtimeCapabilities) };
  }

  async save_model({ path, keep_session = true, runtime = 'mock', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'save_model' }, (lockedBridge) => lockedBridge.save_model({ path, keep_session, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    const result = await selectedRuntime.saveModel({ outputPath: path, keepSession: keep_session });
    if (result.snapshot) {
      result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    }
    if (result.snapshot && result.file_size_bytes) {
      result.snapshot.artifact_size_bytes = result.file_size_bytes;
    }
    return result;
  }

  async save_model_version({ path, base_path, label, keep_session = true, runtime = 'mock', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'save_model_version' }, (lockedBridge) => lockedBridge.save_model_version({ path, base_path, label, keep_session, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.saveModelVersion !== 'function') {
      throw new Error(`Runtime ${runtime} does not support save_model_version`);
    }
    const result = await selectedRuntime.saveModelVersion({ outputPath: path, basePath: base_path, label, keepSession: keep_session });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    if (result.snapshot && result.file_size_bytes) result.snapshot.artifact_size_bytes = result.file_size_bytes;
    return result;
  }

  async open_model({ path, runtime = 'queue', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'open_model' }, (lockedBridge) => lockedBridge.open_model({ path, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.openModel !== 'function') throw new Error(`Runtime ${runtime} does not support open_model`);
    const result = await selectedRuntime.openModel({ path });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    return result;
  }

  async close_reopen_saved_model({ saved_receipt, runtime = 'queue', timeoutMs, session_contract, sessionContract } = {}) {
    if (!isVerifiedModelAccessibilitySavedReceipt(saved_receipt)) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Closing requires the original server-verified saved delivery receipt; client JSON and cloned receipts are not accepted.');
    if (runtime !== 'queue' || this.executionContext?.source !== 'agent_gateway' || this.executionContext?.intent !== 'reopen_delivered_model') {
      throw new AgentContractError('POLICY_DENIED', 'Saved close/reopen is an internal queue lifecycle for a persisted Gateway delivery task.');
    }
    if (!this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'close_reopen_saved_model' },
        bridge => bridge.close_reopen_saved_model({ saved_receipt, runtime, timeoutMs }));
    }
    if (this.liveMutationAuthorization.operation !== 'close_reopen_saved_model') throw new AgentContractError('HANDSHAKE_INVALID', 'Saved close/reopen requires its own fresh mutation authorization scope.');
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.closeReopenSavedModel !== 'function' || typeof selectedRuntime.getSessionState !== 'function' || typeof selectedRuntime.getCapabilities !== 'function') {
      throw new AgentContractError('OPERATION_NOT_ALLOWED', 'The queue runtime does not support verified saved-document close/reopen.');
    }
    const capabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime, { force: true });
    if (capabilities.saved_model_lifecycle?.version !== 'saved-model-lifecycle.v1' || capabilities.saved_model_lifecycle.close_reopen_saved_model !== true) {
      throw new AgentContractError('OPERATION_NOT_ALLOWED', 'The installed native plugin does not attest saved-document close/reopen support. Install and restart the compatible plugin first.');
    }
    const before = await selectedRuntime.getSessionState();
    if (before.runtime !== 'queue' || before.session_id !== saved_receipt.source_binding?.session_id || before.document_id !== saved_receipt.source_binding?.document_id ||
      canonicalJson(before.model_identity) !== canonicalJson(saved_receipt.after_identity) || before.model_identity?.source_path !== saved_receipt.file_path) {
      throw new AgentContractError('MODEL_IDENTITY_MISMATCH', 'The active document is not the exact saved delivery document.');
    }
    if (before.model_revision_complete !== true || before.model_revision !== saved_receipt.post_save_revision || before.model_modified !== false) {
      throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Closing requires the unchanged complete saved revision and modified? false.');
    }
    await assertSavedLifecycleFile(saved_receipt);
    const binding = { path: saved_receipt.file_path, source_sha256: saved_receipt.file.sha256, source_bytes: saved_receipt.file.bytes,
      session_id: before.session_id, document_id: before.document_id, model_identity: structuredClone(saved_receipt.after_identity),
      model_revision: saved_receipt.post_save_revision, delivery_task_id: saved_receipt.delivery_task_id };
    // The Gateway claims a durable signed started journal before this call.
    // Never retry, including when the native response is lost or pending MDI.
    const result = await selectedRuntime.closeReopenSavedModel(binding);
    if (result?.kind !== 'close_reopen_saved_model' || result.version !== 'saved-model-lifecycle.v1' || result.delivery_task_id !== binding.delivery_task_id ||
      result.close_confirmed !== true || result.before_document_id !== binding.document_id || result.close_ignore_changes !== false ||
      canonicalJson(result.file_after) !== canonicalJson(saved_receipt.file) || result.application_restarted !== false ||
      !['activated', 'pending_mdi_activation'].includes(result.open_status)) {
      throw new AgentContractError('MUTATION_RECOVERY_REQUIRED', 'The lifecycle response does not establish the bound close/open result. Inspect the existing request; do not repeat it.',
        { details: { automatic_retry_allowed: false, delivery_task_id: binding.delivery_task_id } });
    }
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, capabilities);
    return result;
  }

  async import_model({ path, mode, prefix, options, runtime = 'queue', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue') assertQueueImportModeAllowed(mode);
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'import_model' }, (lockedBridge) => lockedBridge.import_model({ path, mode, prefix, options, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.importModel !== 'function') throw new Error(`Runtime ${runtime} does not support import_model`);
    const result = await selectedRuntime.importModel({ path, mode, prefix, options });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    return result;
  }

  async export_model({ path, format, options, runtime = 'queue', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'export_model' }, (lockedBridge) => lockedBridge.export_model({ path, format, options, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.exportModel !== 'function') throw new Error(`Runtime ${runtime} does not support export_model`);
    const result = await selectedRuntime.exportModel({ path, format, options });
    if (result.snapshot) {
      result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
      if (result.file_size_bytes) result.snapshot.artifact_size_bytes = result.file_size_bytes;
    }
    return result;
  }

  async inspect_model({ runtime = 'mock', timeoutMs, includeEntities = true, includeSnapshot = false, includeHidden = true, kind, material, tag, name } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.inspectModel !== 'function') throw new Error(`Runtime ${runtime} does not support inspect_model`);
    const result = await selectedRuntime.inspectModel({ includeEntities, includeSnapshot, includeHidden, kind, material, tag, name });
    if (result.snapshot) {
      const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
      result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    }
    return result;
  }

  async list_entities({ runtime = 'mock', timeoutMs, includeHidden = true, kind, material, tag, name } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.listEntities !== 'function') throw new Error(`Runtime ${runtime} does not support list_entities`);
    return selectedRuntime.listEntities({ includeHidden, kind, material, tag, name });
  }

  async get_model_info({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.getModelInfo !== 'function') throw new Error(`Runtime ${runtime} does not support get_model_info`);
    return selectedRuntime.getModelInfo();
  }

  async adopt_open_model(options = {}) {
    const {
      runtime = 'mock',
      timeoutMs,
      recursive = false,
      recursive_limit,
      recursiveLimit,
      force = false,
      prefix,
      read_only = false,
      readOnly,
      session_contract,
      sessionContract
    } = options;
    const readOnlyValue = read_only === true || readOnly === true;
    const roots = options.recursive_roots;
    if (roots !== undefined && (!readOnlyValue || recursive !== true || !Array.isArray(roots) || !roots.length || roots.length > 32 || new Set(roots).size !== roots.length || roots.some(root => typeof root !== 'string' || !(runtime === 'mock' ? /^mock:(group|component_instance):[A-Za-z0-9_-]+$/ : /^pid:[1-9]\d*$/).test(root)))) throw new Error('recursive_roots requires distinct top-level pid paths, read_only and recursive=true');
    const structuralProbe = normalizeStructuralProbeOptions(options);
    if (runtime === 'queue' && !readOnlyValue && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'adopt_open_model' }, (lockedBridge) => lockedBridge.adopt_open_model({ runtime, timeoutMs, recursive, recursive_limit, recursiveLimit, force, prefix, read_only: false }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.adoptOpenModel !== 'function') throw new Error(`Runtime ${runtime} does not support adopt_open_model`);
    const runtimeOptions = {
      recursive,
      recursive_limit: recursive_limit ?? recursiveLimit,
      ...(roots ? { recursive_roots: roots } : {}),
      force,
      prefix,
      read_only: readOnlyValue
    };
    if (structuralProbe.requested) {
      runtimeOptions.structural_groups = structuralProbe.structural_groups;
      runtimeOptions.structural_group_limit = structuralProbe.structural_group_limit;
      runtimeOptions.fresh_manifold_paths = structuralProbe.fresh_manifold_paths;
    }
    const result = await selectedRuntime.adoptOpenModel(runtimeOptions);
    if (roots && JSON.stringify(result.recursive_root_paths) !== JSON.stringify(roots)) throw new AgentContractError('CAPABILITY_MISMATCH', 'Runtime did not attest the exact requested recursive roots');
    return assertStructuralProbeResult(result, structuralProbe, { runtime });
  }

  async resolve_model_targets({
    query,
    runtime = 'mock',
    timeoutMs,
    includeHidden = true,
    kind,
    material,
    tag,
    name,
    definition,
    side,
    nth,
    index,
    target,
    targets,
    largest,
    smallest,
    selection,
    allowMultiple = false,
    limit = 10
  } = {}) {
    const inspected = await this.inspect_model({
      runtime,
      timeoutMs,
      includeEntities: true,
      includeSnapshot: false,
      includeHidden,
      kind,
      material,
      tag,
      name
    });
    const resolution = resolveTargets({
      query,
      entities: inspected.entities || [],
      selection: inspected.selection || [],
      limit,
      allowMultiple,
      filters: {
        includeHidden,
        kind,
        material,
        tag,
        name,
        definition,
        side,
        nth,
        index,
        target,
        targets,
        largest,
        smallest,
        selection
      }
    });
    return {
      ...resolution,
      runtime,
      model_info: inspected.model_info
    };
  }

  async get_selection({ runtime = 'mock', timeoutMs } = {}) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.getSelection !== 'function') throw new Error(`Runtime ${runtime} does not support get_selection`);
    return selectedRuntime.getSelection();
  }

  async analyze_selection_geometry({ runtime = 'mock', timeoutMs, assume, includeDetails = true } = {}) {
    const inspected = await this.inspect_model({
      runtime,
      timeoutMs,
      includeEntities: true,
      includeSnapshot: true,
      includeHidden: true
    });
    return analyzeSelectionGeometry({
      selection: inspected.selection || [],
      snapshot: inspected.snapshot,
      model_info: inspected.model_info,
      runtime,
      assume,
      includeDetails
    });
  }

  async plan_modification_intent({
    runtime = 'mock',
    timeoutMs,
    runtimeLockHeld = false,
    ...options
  } = {}) {
    if (!runtimeLockHeld && runtime === 'queue') {
      return this.withRuntimeLock('queue', { timeoutMs }, (lockedBridge) => lockedBridge.plan_modification_intent({
        ...options,
        runtime,
        timeoutMs,
        runtimeLockHeld: true
      }));
    }
    return planModificationIntent({ ...options, runtime, timeoutMs, bridge: this });
  }

  async set_selection({ targets = [], mode = 'replace', runtime = 'mock', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'set_selection' }, (lockedBridge) => lockedBridge.set_selection({ targets, mode, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const runtimeCapabilities = await this.resolveRuntimeCapabilities(selectedRuntime, runtime);
    if (typeof selectedRuntime.setSelection !== 'function') throw new Error(`Runtime ${runtime} does not support set_selection`);
    const result = await selectedRuntime.setSelection({ targets, mode });
    if (result.snapshot) result.snapshot = this.attachRuntimeCapabilities(result.snapshot, runtimeCapabilities);
    return result;
  }

  async evaluate_py({
    code,
    input_format,
    inputFormat,
    runtime = 'mock',
    timeoutMs,
    seed,
    maxOperations,
    maxLoopIterations,
    maxStatements,
    maxOutputBytes,
    expertTimeoutMs,
    pythonTimeoutMs,
    pythonCommand,
    audit_path,
    auditPath,
    session_contract,
    sessionContract
  } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'evaluate_py' }, (lockedBridge) => lockedBridge.evaluate_py({
        code,
        input_format,
        inputFormat,
        runtime,
        timeoutMs,
        seed,
        maxOperations,
        maxLoopIterations,
        maxStatements,
        maxOutputBytes,
        expertTimeoutMs,
        pythonTimeoutMs,
        pythonCommand,
        audit_path,
        auditPath
      }));
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error('evaluate_py requires non-empty code');
    }
    const format = String(input_format ?? inputFormat ?? 'auto').toLowerCase();
    const audit = {
      kind: 'evaluate_py',
      runtime,
      input_format: format,
      started_at: new Date().toISOString(),
      code_sha256: await sha256Hex(code)
    };

    if (format === 'auto' || format === 'json_dsl') {
      const parsed = parseJsonDslIfPossible(code);
      if (parsed) {
        const built = await this.build_model({ code: JSON.stringify(parsed), runtime, timeoutMs, session_contract, sessionContract });
        return {
          ...audit,
          compatibility_mode: 'safe_json_dsl',
          executed: true,
          blocked: false,
          finished_at: new Date().toISOString(),
          snapshot: built.snapshot,
          ...(built.mutation_receipt ? { mutation_receipt: built.mutation_receipt } : {})
        };
      }
      if (format === 'json_dsl') throw new Error('evaluate_py input_format=json_dsl requires a JSON DSL document');
    }

    if (format === 'auto' || format === 'python_sdk') {
      try {
        const compiled = await this.compile_python_sdk({ code, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, pythonTimeoutMs, pythonCommand });
        const built = await this.build_model({ code: compiled.code, runtime, timeoutMs, session_contract, sessionContract });
        return {
          ...audit,
          compatibility_mode: 'python_sdk_facade_compiler',
          executed: true,
          blocked: false,
          finished_at: new Date().toISOString(),
          compiled: {
            document: compiled.document,
            python_sdk: compiled.python_sdk,
            ...(Object.hasOwn(compiled, 'result') ? { result: compiled.result } : {})
          },
          snapshot: built.snapshot,
          ...(built.mutation_receipt ? { mutation_receipt: built.mutation_receipt } : {})
        };
      } catch (error) {
        if (format === 'python_sdk') throw error;
      }
    }

    if (format === 'expert' || format === 'restricted_expert') {
      const built = await this.build_expert_model({ code, runtime, timeoutMs, seed, maxOperations, maxLoopIterations, maxStatements, maxOutputBytes, expertTimeoutMs, session_contract, sessionContract });
      return {
        ...audit,
        compatibility_mode: 'restricted_expert_compiler',
        executed: true,
        blocked: false,
        finished_at: new Date().toISOString(),
        compiled: built.compiled,
        snapshot: built.snapshot
      };
    }

    if (format === 'ruby_expert') {
      if (runtime !== 'queue') throw new Error('evaluate_py input_format=ruby_expert requires queue runtime');
      const result = await this.run_ruby_expert({ code, audit_path: audit_path ?? auditPath, runtime, timeoutMs, session_contract, sessionContract });
      return {
        ...audit,
        compatibility_mode: 'ruby_expert_debug',
        executed: result.enabled === true && result.blocked !== true,
        blocked: result.blocked === true,
        finished_at: new Date().toISOString(),
        ruby_expert: result
      };
    }

    return {
      ...audit,
      compatibility_mode: 'blocked_python_runtime',
      executed: false,
      blocked: true,
      finished_at: new Date().toISOString(),
      reason: 'This controlled evaluate_py compatibility layer accepts JSON DSL, restricted python_sdk facade code, restricted_expert, or gated ruby_expert input only; arbitrary Python execution is not enabled.'
    };
  }

  async build_report({
    code,
    snapshot,
    runtime = 'mock',
    timeoutMs,
    output_dir,
    save_model = true,
    save_path,
    capture_view = false,
    capture,
    validate_model = true,
    validate_reference_model = false,
    model_spec,
    reference_spec,
    includePreview = true,
    strictCollisions,
    strictUnanchored,
    floatingDetails,
    session_contract,
    sessionContract
  } = {}) {
    const mayMutateLive = runtime === 'queue' && (Boolean(code) || save_model !== false || Boolean(capture_view || capture));
    if (mayMutateLive && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'build_report' }, (lockedBridge) => lockedBridge.build_report({
        code,
        snapshot,
        runtime,
        timeoutMs,
        output_dir,
        save_model,
        save_path,
        capture_view,
        capture,
        validate_model,
        validate_reference_model,
        model_spec,
        reference_spec,
        includePreview,
        strictCollisions,
        strictUnanchored,
        floatingDetails
      }));
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDir = path.resolve(output_dir || path.join('output', 'build-reports', `build-report-${stamp}`));
    await fs.mkdir(reportDir, { recursive: true });

    let activeSnapshot = snapshot;
    const artifacts = {};
    let dslExpansion = null;
    if (code) {
      await fs.writeFile(path.join(reportDir, 'input.dsl.json'), `${code.trim()}\n`, 'utf8');
      artifacts.input_dsl = path.join(reportDir, 'input.dsl.json');
      const prepared = this.prepareDslCode(code);
      dslExpansion = prepared.expansion;
      if (prepared.expansion.changed) {
        await fs.writeFile(path.join(reportDir, 'expanded.dsl.json'), prepared.code, 'utf8');
        artifacts.expanded_dsl = path.join(reportDir, 'expanded.dsl.json');
        await writeJsonArtifact(artifacts, 'dsl_expansion', path.join(reportDir, 'dsl-expansion.json'), prepared.expansion);
      }
      activeSnapshot = (await this.build_model({ code, runtime, timeoutMs, session_contract, sessionContract })).snapshot;
    }
    if (!activeSnapshot) {
      activeSnapshot = (await this.inspect_model({ runtime, timeoutMs, includeSnapshot: true, includeEntities: false })).snapshot;
    }
    await writeJsonArtifact(artifacts, 'snapshot', path.join(reportDir, 'snapshot.json'), activeSnapshot);
    await writeJsonArtifact(artifacts, 'model_info', path.join(reportDir, 'model-info.json'), modelInfoFromSnapshot(activeSnapshot, { runtime }));

    let savedModel = null;
    if (save_model !== false) {
      savedModel = await this.save_model_version({
        path: save_path || path.join(reportDir, runtime === 'queue' ? 'model.skp' : 'model.json'),
        label: stamp,
        runtime,
        timeoutMs,
        session_contract,
        sessionContract
      });
      artifacts.model = savedModel.file_path;
    }

    let modelQa = null;
    if (validate_model !== false) {
      modelQa = await this.validate_model({
        snapshot: activeSnapshot,
        runtime,
        timeoutMs,
        spec: model_spec,
        includePreview,
        strictCollisions,
        strictUnanchored,
        floatingDetails
      });
      await writeJsonArtifact(artifacts, 'model_qa', path.join(reportDir, 'model-qa.json'), modelQa);
    }

    let referenceQa = null;
    if (validate_reference_model || reference_spec) {
      referenceQa = await this.validate_reference_model({
        snapshot: activeSnapshot,
        runtime,
        timeoutMs,
        spec: reference_spec,
        includePreview
      });
      await writeJsonArtifact(artifacts, 'reference_qa', path.join(reportDir, 'reference-qa.json'), referenceQa);
    }

    const limitationsReport = buildLimitationsReport({
      snapshot: activeSnapshot,
      modelQa,
      expansion: dslExpansion,
      runtime
    });
    await writeJsonArtifact(artifacts, 'limitations_report', path.join(reportDir, 'limitations-report.json'), limitationsReport);
    await writeTextArtifact(artifacts, 'limitations_markdown', path.join(reportDir, 'limitations.md'), formatLimitationsReportMarkdown(limitationsReport));

    let captureResult = null;
    if ((capture_view || capture) && runtime === 'queue') {
      captureResult = await this.capture_view({
        ...(capture && typeof capture === 'object' ? capture : {}),
        path: path.join(reportDir, 'capture.png'),
        runtime,
        timeoutMs,
        session_contract,
        sessionContract
      });
      artifacts.capture = captureResult.file_path;
      await writeJsonArtifact(artifacts, 'capture_metadata', path.join(reportDir, 'capture.json'), captureResult);
    }

    const manifest = {
      kind: 'build_report',
      runtime,
      output_dir: reportDir,
      created_at: new Date().toISOString(),
      artifacts,
      saved_model: savedModel,
      capture: captureResult,
      summary: {
        totals: activeSnapshot.totals,
        bounding_box: activeSnapshot.bounding_box,
        warning_summary: activeSnapshot.warning_summary,
        dsl_expansion: dslExpansion ? {
          changed: dslExpansion.changed,
          macro_count: dslExpansion.macro_count,
          source_operations: dslExpansion.source_operations,
          expanded_operations: dslExpansion.expanded_operations
        } : null,
        model_qa: modelQa ? { ok: modelQa.ok, verdict: modelQa.verdict, level: modelQa.level, issue_count: modelQa.issues?.length || 0, accepted_warning_count: modelQa.accepted_warnings?.length || 0 } : null,
        reference_qa: referenceQa ? { ok: referenceQa.ok, verdict: referenceQa.verdict, level: referenceQa.level, issue_count: referenceQa.issues?.length || 0 } : null,
        limitations: limitationsReport.summary
      }
    };
    await writeJsonArtifact(artifacts, 'manifest', path.join(reportDir, 'manifest.json'), manifest);
    return manifest;
  }

  async iterate_model({
    runtime = 'mock',
    timeoutMs,
    ...options
  } = {}) {
    if (runtime === 'queue' && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({
        runtime,
        timeoutMs,
        session_contract: options.session_contract,
        sessionContract: options.sessionContract,
        operation: 'iterate_model'
      }, (lockedBridge) => lockedBridge.iterate_model({
        ...options,
        runtime,
        timeoutMs
      }));
    }
    return runModelIteration(this, { ...options, runtime, timeoutMs });
  }

  async capture_view({
    path,
    view,
    scene,
    width,
    height,
    antialias,
    compression,
    zoom_extents,
    zoomExtents,
    server_visual_capture,
    runtime = 'queue',
    timeoutMs,
    session_contract,
    sessionContract
  } = {}) {
    if (runtime !== 'queue') {
      throw new Error('capture_view is currently supported only for queue runtime');
    }
    if (!this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'capture_view' }, (lockedBridge) => lockedBridge.capture_view({
        path,
        view,
        scene,
        width,
        height,
        antialias,
        compression,
        zoom_extents,
        zoomExtents,
        server_visual_capture,
        runtime,
        timeoutMs
      }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.captureView !== 'function') {
      throw new Error('Selected queue runtime does not support capture_view');
    }
    return selectedRuntime.captureView({
      path,
      view,
      scene,
      width,
      height,
      antialias,
      compression,
      zoom_extents: zoom_extents ?? zoomExtents,
      server_visual_capture
    });
  }

  async capture_detail_views({ views, output_dir, runtime = 'queue', timeoutMs, session_contract, sessionContract } = {}) {
    if (runtime !== 'queue') throw new AgentContractError('OPERATION_NOT_ALLOWED', 'Detail image evidence requires a live SketchUp runtime.');
    if (!Array.isArray(views) || !views.length || views.length > 24 || !output_dir) throw new AgentContractError('INVALID_ARGUMENT', 'capture_detail_views requires 1..24 views and output_dir.');
    if (!this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'capture_detail_views' }, lockedBridge => lockedBridge.capture_detail_views({ views, output_dir, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    const result = await selectedRuntime.captureDetailViews({ views, output_dir });
    const captures = [];
    for (const capture of result.captures || []) {
      const imagePath = path.resolve(capture.path || capture.file_path);
      if (!imagePath.startsWith(`${path.resolve(output_dir)}${path.sep}`)) throw new Error('Detail capture escaped its output directory.');
      const bytes = await fs.readFile(imagePath);
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const width = png && bytes.length >= 24 ? bytes.readUInt32BE(16) : null;
      const height = png && bytes.length >= 24 ? bytes.readUInt32BE(20) : null;
      captures.push({ ...capture, path: imagePath, width, height,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        server_verified: Boolean(width && height && capture.model_revision && capture.model_revision_complete === true && capture.evidence === 'native_view_write_image' && capture.camera_stable_during_export === true && result.restored === true),
        evidence_level: 'live_runtime' });
    }
    return { ...result, captures };
  }

  async run_ruby_expert({ code, audit_path, auditPath, runtime = 'queue', timeoutMs, session_contract, sessionContract } = {}) {
    if (process.env.ALMA_SKETCHUP_ENABLE_RUBY_EXPERT !== '1') {
      return {
        kind: 'run_ruby_expert',
        runtime,
        enabled: false,
        blocked: true,
        reason: 'Set ALMA_SKETCHUP_ENABLE_RUBY_EXPERT=1 in both Node and SketchUp plugin environments to enable this destructive debug-only tool.'
      };
    }
    if (runtime !== 'queue') {
      throw new Error('run_ruby_expert is supported only for queue runtime');
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new Error('run_ruby_expert requires non-empty Ruby code');
    }
    if (!this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime, timeoutMs, session_contract, sessionContract, operation: 'run_ruby_expert' }, (lockedBridge) => lockedBridge.run_ruby_expert({ code, audit_path, auditPath, runtime, timeoutMs }));
    }
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.runRubyExpert !== 'function') {
      throw new Error('Selected queue runtime does not support run_ruby_expert');
    }
    return selectedRuntime.runRubyExpert({ code, audit_path: audit_path ?? auditPath });
  }

  async compare_model({
    code,
    expected_runtime = 'mock',
    actual_runtime = 'queue',
    timeoutMs,
    reset_first = true,
    toleranceMm,
    topologyTolerance,
    budgets,
    topIssueLimit,
    include_snapshots = false,
    session_contract,
    sessionContract
  } = {}) {
    if ([expected_runtime, actual_runtime].includes('queue') && !this.liveMutationAuthorization) {
      return this.withLiveMutationAuthorization({ runtime: 'queue', timeoutMs, session_contract, sessionContract, operation: 'compare_model' }, (lockedBridge) => lockedBridge.compare_model({
        code,
        expected_runtime,
        actual_runtime,
        timeoutMs,
        reset_first,
        toleranceMm,
        topologyTolerance,
        budgets,
        topIssueLimit,
        include_snapshots
      }));
    }
    if (reset_first) {
      await this.reset_model({ runtime: expected_runtime, timeoutMs });
    }
    const expected = await this.build_model({ code, runtime: expected_runtime, timeoutMs });
    if (reset_first) {
      await this.reset_model({ runtime: actual_runtime, timeoutMs });
    }
    const actual = await this.build_model({ code, runtime: actual_runtime, timeoutMs });
    const report = compareSnapshots(expected.snapshot, actual.snapshot, { toleranceMm, topologyTolerance, budgets, topIssueLimit });
    return {
      expected_runtime,
      actual_runtime,
      reset_first,
      report,
      ...(include_snapshots ? { expected: expected.snapshot, actual: actual.snapshot } : {})
    };
  }

  async validate_model({
    code,
    snapshot,
    runtime = 'mock',
    timeoutMs,
    spec,
    includePreview = true,
    strictCollisions,
    strictUnanchored,
    floatingDetails,
    session_contract,
    sessionContract
  } = {}) {
    const builtSnapshot = snapshot || (await this.build_model({ code, runtime, timeoutMs, session_contract, sessionContract })).snapshot;
    return validateModelSnapshot(builtSnapshot, {
      spec,
      includePreview,
      strictCollisions,
      strictUnanchored,
      floatingDetails
    });
  }

  async validate_reference_model({
    code,
    snapshot,
    runtime = 'mock',
    timeoutMs,
    spec,
    includePreview = true,
    session_contract,
    sessionContract
  } = {}) {
    const builtSnapshot = snapshot || (await this.build_model({ code, runtime, timeoutMs, session_contract, sessionContract })).snapshot;
    return validateReferenceVisualSnapshot(builtSnapshot, {
      spec,
      includePreview
    });
  }

  async resolveRuntimeCapabilities(selectedRuntime, runtime, { force = false } = {}) {
    if (!force && this.runtimeCapabilitiesCache.has(runtime)) {
      return this.runtimeCapabilitiesCache.get(runtime);
    }
    const descriptor = typeof selectedRuntime.getCapabilities === 'function'
      ? await selectedRuntime.getCapabilities()
      : getRuntimeCapabilities(runtime);
    const runtimeCapabilities = attachCompatibilityReport(descriptor, runtime);
    this.runtimeCapabilitiesCache.set(runtime, runtimeCapabilities);
    return runtimeCapabilities;
  }

  attachRuntimeCapabilities(snapshot, runtimeCapabilities) {
    return {
      ...snapshot,
      runtime: runtimeCapabilities
    };
  }

  prepareDslCode(code) {
    return expandDslCode(code);
  }

  async withLiveMutationAuthorization({ runtime = 'mock', timeoutMs, session_contract, sessionContract, operation }, callback) {
    if (runtime !== 'queue' || this.liveMutationAuthorization) return callback(this);
    this.assertLiveMutationPolicy(operation);
    const contract = session_contract ?? sessionContract;
    if (!contract) {
      throw new AgentContractError('HANDSHAKE_REQUIRED', `A fresh queue handshake is required before ${operation || 'live mutation'}.`);
    }
    const selectedRuntime = this.selectRuntime('queue', { timeoutMs });
    if (typeof selectedRuntime.withExclusiveAccess !== 'function' || typeof selectedRuntime.getSessionState !== 'function') {
      throw new AgentContractError('HANDSHAKE_INVALID', 'Selected queue runtime cannot validate a Session Contract.');
    }
    return selectedRuntime.withExclusiveAccess(async () => {
      await this.sessionContractAuthority.verify(contract, { operation });
      if (typeof selectedRuntime.assertIdleForMutation === 'function') await selectedRuntime.assertIdleForMutation();
      const runtimeState = await selectedRuntime.getSessionState();
      assertQueueSessionCompatibility(runtimeState, { operation });
      const verified = await this.sessionContractAuthority.verify(contract, { runtimeState, operation });
      return this.invokeLiveAuthorizedQueueOperation({
        selectedRuntime,
        verified,
        operation,
        callback
      });
    }, { method: `authorize:${operation || 'live-mutation'}`, failIfLocked: true });
  }

  invokeLiveAuthorizedQueueOperation({ selectedRuntime, verified, operation, callback }) {
    const invoke = () => {
      const lockedBridge = new SketchUpBridge({
        ...this.options,
        queueRuntime: selectedRuntime,
        approvalAuthority: this.approvalAuthority,
        taskStore: this.taskStore,
        copyFastSessionAuthority: this.copyFastSessionAuthority,
        sessionContractAuthority: this.sessionContractAuthority,
        [INTERNAL_EXECUTION_CONTEXT]: this.executionContext,
        liveMutationAuthorization: {
          handshake_id: verified.handshake_id,
          operation: operation || 'live_mutation',
          validated_at: new Date().toISOString()
        }
      });
      return callback(lockedBridge);
    };
    if (typeof selectedRuntime.withMutationGuard !== 'function') return invoke();
    return selectedRuntime.withMutationGuard({
      handshake_id: verified.handshake_id,
      session_id: verified.session_id,
      document_id: verified.document_id,
      model_revision: verified.model_revision,
      model_revision_strategy: verified.model_revision_strategy,
      model_revision_unique_entity_limit: verified.model_revision_unique_entity_limit,
      plugin_version: verified.plugin_version,
      capability_version: verified.capability_version,
      manifest_version: verified.manifest_version,
      boolean_operations_sha256: verified.boolean_operations_sha256,
      model_revision_source_sha256: verified.model_revision_source_sha256,
      model_modified: verified.model_modified,
      dsl_version: verified.dsl_version
    }, invoke);
  }

  assertLiveMutationPolicy(operation) {
    const source = this.executionContext?.source === 'agent_gateway' ? 'agent_gateway' : 'direct_expert';
    const allowed = source === 'agent_gateway'
      ? this.executionPolicy.allow_queue_mutation === true
      : this.executionPolicy.allow_direct_expert_queue_mutation === true;
    if (!this.executionPolicy.allowed_runtimes.includes('queue') || !allowed) {
      throw new AgentContractError('POLICY_DENIED', source === 'agent_gateway'
        ? 'The server execution policy does not allow Agent Gateway queue mutation.'
        : 'Direct expert queue mutation is disabled by server policy.', {
        details: {
          source,
          operation: operation || 'live_mutation',
          required_policy: source === 'agent_gateway' ? 'allow_queue_mutation' : 'allow_direct_expert_queue_mutation'
        }
      });
    }
  }

  selectRuntime(runtime, { timeoutMs } = {}) {
    if (runtime === 'mock') return this.mockRuntime;
    if (runtime === 'queue') return this.options.queueRuntime || new QueueRuntime({ ...(this.options.queue || {}), timeoutMs });
    throw new Error(`Unknown runtime: ${runtime}`);
  }

  async withRuntimeLock(runtime, { timeoutMs } = {}, callback) {
    const selectedRuntime = this.selectRuntime(runtime, { timeoutMs });
    if (typeof selectedRuntime.withExclusiveAccess !== 'function') {
      return callback(this);
    }
    return selectedRuntime.withExclusiveAccess(async () => {
      const lockedBridge = new SketchUpBridge({
        ...this.options,
        copyFastSessionAuthority: this.copyFastSessionAuthority,
        ...(runtime === 'queue' ? { queueRuntime: selectedRuntime } : {})
      });
      if (runtime === 'mock') lockedBridge.mockRuntime = selectedRuntime;
      return callback(lockedBridge);
    }, { method: `${runtime}-runtime-session` });
  }
}

async function assertSavedLifecycleFile(receipt) {
  const target = receipt.file_path;
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.extname(target).toLowerCase() !== '.skp' ||
    !Number.isSafeInteger(receipt.file?.bytes) || receipt.file.bytes < 1 || !/^[0-9a-f]{64}$/.test(receipt.file?.sha256 || '') ||
    await fs.realpath(target) !== target || (await fs.lstat(target)).isSymbolicLink()) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The saved lifecycle file is not the original real server file.');
  }
  const handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== receipt.file.bytes) throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The saved lifecycle file size changed.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let read;
    do { read = await handle.read(buffer, 0, buffer.length, null); hash.update(buffer.subarray(0, read.bytesRead)); } while (read.bytesRead > 0);
    const after = await handle.stat(), current = await fs.lstat(target);
    if (hash.digest('hex') !== receipt.file.sha256 || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      before.ino !== current.ino || before.dev !== current.dev || current.isSymbolicLink()) {
      throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'The saved lifecycle bytes changed after delivery.');
    }
  } finally { await handle.close(); }
}

function policyFromEnvironment() {
  const allowedRuntimes = process.env.ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES
    ? process.env.ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES.split(',').map((item) => item.trim()).filter(Boolean)
    : ['mock'];
  const trustedCopyRootValue = process.env.ALMA_SKETCHUP_COPY_ROOTS
    || process.env.ALMA_SKETCHUP_TRUSTED_COPY_ROOTS;
  const trustedCopyRoots = trustedCopyRootValue
    ? trustedCopyRootValue.split(path.delimiter).map((item) => item.trim()).filter(Boolean)
    : [];
  const trustedCopyRiskValue = process.env.ALMA_SKETCHUP_COPY_FAST_ALLOWED_RISKS
    || process.env.ALMA_SKETCHUP_TRUSTED_COPY_AUTO_APPROVE_RISKS;
  const trustedCopyRisks = trustedCopyRiskValue
    ? trustedCopyRiskValue.split(',').map((item) => item.trim()).filter(Boolean)
    : ['S1', 'S2', 'S3', 'S4'];
  return {
    auto_approve_risks: process.env.ALMA_SKETCHUP_AUTO_APPROVE_S1 === '1' ? ['S1'] : [],
    allowed_runtimes: allowedRuntimes,
    allow_queue_mutation: process.env.ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION === '1',
    allow_direct_expert_queue_mutation: process.env.ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION === '1',
    trusted_model_copy_auto_approval: {
      enabled: process.env.ALMA_SKETCHUP_COPY_FAST_MODE === '1'
        || process.env.ALMA_SKETCHUP_TRUSTED_COPY_AUTO_APPROVAL === '1',
      allowed_roots: trustedCopyRoots,
      allowed_risks: trustedCopyRisks,
      max_affected_instances: process.env.ALMA_SKETCHUP_COPY_FAST_MAX_AFFECTED_INSTANCES
        || process.env.ALMA_SKETCHUP_TRUSTED_COPY_MAX_AFFECTED_INSTANCES,
      allow_save_model: process.env.ALMA_SKETCHUP_COPY_FAST_ALLOW_SAVE === '1'
        || process.env.ALMA_SKETCHUP_TRUSTED_COPY_ALLOW_SAVE === '1',
      session_ttl_ms: process.env.ALMA_SKETCHUP_COPY_FAST_SESSION_TTL_MS
    },
    resource_limits: {
      max_operations: process.env.ALMA_SKETCHUP_AGENT_MAX_OPERATIONS,
      max_affected_instances: process.env.ALMA_SKETCHUP_AGENT_MAX_AFFECTED_INSTANCES,
      max_recursive_entities: process.env.ALMA_SKETCHUP_AGENT_MAX_RECURSIVE_ENTITIES,
      auto_approve_s1_max_affected_instances: process.env.ALMA_SKETCHUP_AUTO_APPROVE_S1_MAX_AFFECTED_INSTANCES
    }
  };
}

async function sha256Hex(value) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value).digest('hex');
}

function parseJsonDslIfPossible(code) {
  try {
    const parsed = JSON.parse(code);
    if (parsed?.version === 1 && Array.isArray(parsed.operations)) return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

async function writeJsonArtifact(artifacts, key, filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  artifacts[key] = filePath;
}

async function writeTextArtifact(artifacts, key, filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
  artifacts[key] = filePath;
}

function attachCompatibilityReport(descriptor, runtime) {
  const expected = getRuntimeCapabilities(runtime);
  const actual = descriptor || {};
  const issues = [];

  addScalarIssue(issues, 'runtime.name', expected.name, actual.name, 'error');
  addScalarIssue(issues, 'runtime.dsl_version', expected.dsl_version, actual.dsl_version, 'error');
  addScalarIssue(issues, 'runtime.occurrence_contract', expected.occurrence_contract, actual.occurrence_contract, 'error');
  addScalarIssue(issues, 'runtime.manifest_version', expected.manifest_version, actual.manifest_version, 'warn');
  addScalarIssue(issues, 'runtime.capability_version', expected.capability_version, actual.capability_version, 'warn');
  if (runtime === 'queue') {
    addScalarIssue(issues, 'runtime.boolean_operations_sha256', expected.boolean_operations_sha256, actual.boolean_operations_sha256, 'error');
    addScalarIssue(issues, 'runtime.model_revision_source_sha256', expected.model_revision_source_sha256, actual.model_revision_source_sha256, 'error');
    addScalarIssue(issues, 'runtime.model_revision.strategy', expected.model_revision?.strategy, actual.model_revision?.strategy, 'error');
    addScalarIssue(issues, 'runtime.model_revision.unique_entity_limit', expected.model_revision?.unique_entity_limit, actual.model_revision?.unique_entity_limit, 'error');
    addScalarIssue(issues, 'runtime.model_revision.logical_occurrence_count', expected.model_revision?.logical_occurrence_count, actual.model_revision?.logical_occurrence_count, 'error');
  }
  addReadOnlyProbeCompatibilityIssues(issues, expected.read_only_probes?.structural_groups, actual.read_only_probes?.structural_groups);

  const expectedOperations = new Set(expected.supported_operations || []);
  const actualOperations = new Set(actual.supported_operations || []);
  for (const operation of expectedOperations) {
    if (!actualOperations.has(operation)) {
      issues.push({
        type: 'runtime.operation_missing',
        severity: 'error',
        message: `Runtime ${runtime} is missing manifest operation: ${operation}`,
        operation
      });
    }
  }
  for (const operation of actualOperations) {
    if (!expectedOperations.has(operation)) {
      issues.push({
        type: 'runtime.operation_extra',
        severity: 'info',
        message: `Runtime ${runtime} reports extra operation outside current manifest: ${operation}`,
        operation
      });
    }
  }

  for (const [operation, expectedSupport] of Object.entries(expected.operation_support || {})) {
    const actualSupport = actual.operation_support?.[operation];
    if (!actualSupport) continue;
    if (actualSupport.status !== expectedSupport.status) {
      issues.push({
        type: 'runtime.operation_status_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} reports ${actualSupport.status}, manifest expects ${expectedSupport.status}`,
        operation,
        expected: expectedSupport.status,
        actual: actualSupport.status
      });
    }
    if (actualSupport.stability !== undefined && actualSupport.stability !== expectedSupport.stability) {
      issues.push({
        type: 'runtime.operation_stability_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} reports ${actualSupport.stability} stability, manifest expects ${expectedSupport.stability}`,
        operation,
        expected: expectedSupport.stability,
        actual: actualSupport.stability
      });
    }
    if (actualSupport.schema !== undefined && !sameJson(actualSupport.schema, expectedSupport.schema)) {
      issues.push({
        type: 'runtime.operation_schema_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} schema differs from manifest`,
        operation,
        expected: expectedSupport.schema,
        actual: actualSupport.schema
      });
    }
    if (actualSupport.component_scope !== undefined && !sameJson(actualSupport.component_scope, expectedSupport.component_scope)) {
      issues.push({
        type: 'runtime.operation_component_scope_mismatch',
        severity: 'warn',
        message: `Runtime ${runtime} operation ${operation} component scope differs from manifest`,
        operation,
        expected: expectedSupport.component_scope,
        actual: actualSupport.component_scope
      });
    }
  }

  return {
    ...actual,
    operation_support: normalizeOperationSupport(actual.operation_support, expected.operation_support),
    compatibility: {
      ok: !issues.some((issue) => issue.severity === 'error'),
      level: compatibilityLevel(issues),
      checked_against: {
        manifest_version: expected.manifest_version,
        capability_version: expected.capability_version,
        boolean_operations_sha256: expected.boolean_operations_sha256,
        model_revision_source_sha256: expected.model_revision_source_sha256,
        dsl_version: expected.dsl_version
      },
      issues
    }
  };
}

function addReadOnlyProbeCompatibilityIssues(issues, expectedProbe, actualProbe) {
  if (!actualProbe || typeof actualProbe !== 'object') {
    issues.push({
      type: 'runtime.read_only_probe_missing',
      severity: 'error',
      field: 'runtime.read_only_probes.structural_groups',
      message: 'Runtime is missing the structural-groups.v1 read-only probe descriptor.',
      expected: expectedProbe || null,
      actual: actualProbe || null
    });
    return;
  }
  for (const field of [
    'version',
    'operation',
    'requires_read_only',
    'default_limit',
    'max_limit',
    'max_fresh_manifold_paths',
    'projected_entity_types',
    'traversed_container_types',
    'fresh_manifold_method',
    'leaf_entities_materialized',
    'mutates_model'
  ]) {
    if (sameJson(expectedProbe?.[field], actualProbe[field])) continue;
    issues.push({
      type: 'runtime.read_only_probe_mismatch',
      severity: 'error',
      field: `runtime.read_only_probes.structural_groups.${field}`,
      message: `Runtime structural group probe descriptor mismatch: ${field}.`,
      expected: expectedProbe?.[field] ?? null,
      actual: actualProbe[field] ?? null
    });
  }
}

function assertQueueSessionCompatibility(runtimeState, { operation } = {}) {
  const expected = getRuntimeCapabilities('queue');
  const bindings = [
    ['capability_version', expected.capability_version],
    ['manifest_version', expected.manifest_version],
    ['dsl_version', expected.dsl_version],
    ['occurrence_contract', expected.occurrence_contract],
    ['boolean_operations_sha256', expected.boolean_operations_sha256],
    ['model_revision_source_sha256', expected.model_revision_source_sha256],
    ['model_revision_strategy', expected.model_revision?.strategy],
    ['model_revision_unique_entity_limit', expected.model_revision?.unique_entity_limit]
  ];
  for (const [field, expectedValue] of bindings) {
    const actualValue = runtimeState?.[field];
    if (actualValue === expectedValue) continue;
    throw new AgentContractError(
      'HANDSHAKE_CAPABILITIES_MISMATCH',
      'The live SketchUp plugin capability contract does not match this server.',
      {
        details: {
          field,
          expected: expectedValue ?? null,
          actual: actualValue ?? null,
          operation: operation || null,
          queue_request_created: false
        }
      }
    );
  }
}

function normalizeOperationSupport(actualSupport = {}, expectedSupport = {}) {
  const normalized = {};
  for (const [operation, expected] of Object.entries(expectedSupport || {})) {
    const actual = actualSupport?.[operation] || {};
    normalized[operation] = {
      ...expected,
      ...actual,
      schema: actual.schema ?? expected.schema,
      component_scope: actual.component_scope ?? expected.component_scope
    };
  }
  for (const [operation, actual] of Object.entries(actualSupport || {})) {
    if (!normalized[operation]) normalized[operation] = actual;
  }
  return normalized;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addScalarIssue(issues, field, expected, actual, severity) {
  if (expected === actual) return;
  issues.push({
    type: 'runtime.descriptor_mismatch',
    severity,
    field,
    message: `${field} mismatch: expected ${expected}, got ${actual}`,
    expected,
    actual
  });
}

function compatibilityLevel(issues) {
  if (issues.some((issue) => issue.severity === 'error')) return 'error';
  if (issues.some((issue) => issue.severity === 'warn')) return 'warn';
  if (issues.some((issue) => issue.severity === 'info')) return 'info';
  return 'ok';
}

export async function callTool(name, args = {}, bridge = new SketchUpBridge()) {
  if (typeof bridge[name] !== 'function') {
    throw new Error(`Unknown tool: ${name}`);
  }
  return bridge[name](args);
}
