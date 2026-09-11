import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { buildModelGraph } from './model-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { validateExpertDocument } from './expert-compiler.mjs';
import { trustedBridgeReceipt } from './task-mutation-receipt-ledger.mjs';
import { loadNativeAppearanceCatalog, buildAppearanceMaterialOperations, assertAppearanceAssetsUnchanged,
  evaluateNativeAppearanceReadback } from './detailed-modeling/appearance-presets.mjs';

export const MODEL_ACCESSIBILITY_APPEARANCE_VERSION = 'model-accessibility-appearance.v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const fail = (code, message) => { throw new AgentContractError(code, message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const fields = (value, allowed, label) => {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_ARGUMENT', `${label} contains unsupported fields.`);
};
const number = (value, low, high, label) => {
  if (!Number.isFinite(value) || value < low || value > high) fail('INVALID_ARGUMENT', `${label} must be a finite number between ${low} and ${high}.`);
  return value;
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\0\r\n]/.test(value)) fail('INVALID_ARGUMENT', `${label} must be a short nonempty string.`);
  return value.trim();
};

function assertAppearancePolicy(gateway, plan) {
  const policy = gateway.bridge.executionPolicy;
  if (!policy.allowed_runtimes.includes('queue')) fail('POLICY_DENIED', 'Queue runtime is not allowed by server policy.');
  if (plan.document.operations.length > policy.resource_limits.max_operations
    || plan.affected_instance_count > policy.resource_limits.max_affected_instances) fail('POLICY_DENIED', 'The appearance plan exceeds the host operation or affected-instance limit.');
}

export function normalizeNativeAppearanceInput(value) {
  fields(value, ['kind', 'target', 'preset', 'texture_size_mm', 'rotation', 'environment', 'intensity', 'scene_name', 'capture_current_display'], 'appearance');
  if (!['native_pbr', 'native_hdr'].includes(value.kind)) fail('INVALID_ARGUMENT', 'appearance.kind must be native_pbr or native_hdr.');
  const result = { kind: value.kind, rotation: number(value.rotation, 0, 360, 'appearance.rotation'), capture_current_display: value.capture_current_display ?? false };
  if (typeof result.capture_current_display !== 'boolean') fail('INVALID_ARGUMENT', 'capture_current_display must be boolean.');
  if (value.kind === 'native_pbr') {
    if (['environment', 'intensity', 'scene_name'].some(key => key in value)) fail('INVALID_ARGUMENT', 'PBR and HDR requests cannot be combined.');
    if (!Array.isArray(value.texture_size_mm) || value.texture_size_mm.length !== 2) fail('INVALID_ARGUMENT', 'texture_size_mm requires width and height in millimeters.');
    Object.assign(result, { target: text(value.target, 'appearance.target'), preset: text(value.preset, 'appearance.preset'),
      texture_size_mm: value.texture_size_mm.map(size => number(size, 0.1, 100000, 'texture_size_mm')) });
  } else {
    if (['target', 'preset', 'texture_size_mm'].some(key => key in value)) fail('INVALID_ARGUMENT', 'HDR and PBR requests cannot be combined.');
    Object.assign(result, { environment: text(value.environment, 'appearance.environment'), intensity: number(value.intensity, 0, 10, 'appearance.intensity'), scene_name: text(value.scene_name, 'appearance.scene_name') });
  }
  return result;
}

function completeGraph(adoption) {
  const graph = buildModelGraph(adoption);
  // adopt_open_model places its canonical revision attestation on the report,
  // not inside snapshot (which carries appearance and entity summaries).
  if (adoption.runtime !== 'queue' || adoption.model_revision_complete !== true
    || !/^sha256:[0-9a-f]{64}$/.test(adoption.model_revision || '') || graph.model_revision !== adoption.model_revision
    || !Number.isSafeInteger(adoption.model_revision_total_seen) || adoption.model_revision_total_seen < 0
    || adoption.model_revision_indexed !== adoption.model_revision_total_seen || !graph.completeness.complete
    || adoption.snapshot?.model_revision !== undefined && adoption.snapshot.model_revision !== adoption.model_revision
    || adoption.snapshot?.model_revision_complete !== undefined && adoption.snapshot.model_revision_complete !== true) fail('MODEL_REVISION_INCOMPLETE', 'Appearance requires a complete fresh queue model and occurrence index.');
  return graph;
}

export function validateNativeAppearanceSubmission(task, input) {
  const prepared = Boolean(task.private?.appearance_plan);
  const allowed = prepared ? ['runtime', 'session_contract', 'connection_task_id', 'note'] : ['runtime', 'appearance', 'session_contract', 'connection_task_id', 'timeout_ms'];
  const invalid = message => { throw new AgentContractError('INVALID_ARGUMENT', message, {
    nextAction: { action: 'discover_appearance_inputs', tool: 'start_agent_task', arguments: { intent: 'discover', instruction: 'Read native appearance inputs.', inputs: {
      topic: 'workflows', task_name: task.inputs?.appearance?.kind === 'native_hdr' ? 'native_hdr' : 'native_pbr' } } }
  }); };
  if (!plain(input) || Object.keys(input).some(key => !allowed.includes(key))) invalid(prepared ? 'The reviewed appearance plan is frozen. Submit only its fresh connection and optional note.' : 'Appearance input accepts runtime, appearance, connection_task_id and timeout_ms; fields such as kind/preset belong inside appearance. Action names are not input fields.');
  if (input.runtime !== undefined && input.runtime !== 'queue') invalid('Native appearance requires runtime=queue.');
  if (!prepared && input.appearance !== undefined) {
    try { normalizeNativeAppearanceInput(input.appearance); }
    catch (error) { if (error.code === 'INVALID_ARGUMENT') invalid(error.message); throw error; }
  }
  if (!prepared && input.timeout_ms !== undefined && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 1000 || input.timeout_ms > 600000)) invalid('timeout_ms must be an integer from 1000 to 600000.');
}

function targetScope(graph, reference) {
  const nodes = graph.nodes.filter(node => node.node_type === 'occurrence');
  const matches = nodes.filter(node => !node.parent_id && [node.entity_path, node.reference, node.persistent_id, node.name].includes(reference));
  if (matches.length !== 1) fail('INVALID_ARGUMENT', 'PBR target must identify exactly one current root instance or group.');
  const root = matches[0], selected = new Set([root.node_id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes) if (selected.has(node.parent_id) && !selected.has(node.node_id)) { selected.add(node.node_id); changed = true; }
  }
  const scoped = nodes.filter(node => selected.has(node.node_id));
  if (scoped.some(node => node.synthetic || node.effective_locked || !node.entity_path || !node.persistent_id)) fail('OPERATION_NOT_ALLOWED', 'Every selected PBR occurrence must be complete, persistent and unlocked.');
  const containers = scoped.filter(node => ['group', 'component_instance'].includes(node.entity_type));
  if (!containers.length || containers.length > 32 || containers.some(node => node.shared_definition || node.affected_instance_count !== 1 || (node.entity_definition_occurrence_count !== undefined && node.entity_definition_occurrence_count !== 1))) fail('OPERATION_NOT_ALLOWED', 'PBR requires unshared definitions throughout the selected root; shared instances need a separately reviewed make-unique operation.');
  const leaves = containers.map(node => ({ node, faces: scoped.filter(face => face.parent_id === node.node_id && face.entity_type === 'face') })).filter(entry => entry.faces.length);
  if (!leaves.length || leaves.reduce((sum, entry) => sum + entry.faces.length, 0) > 10000) fail('OPERATION_NOT_ALLOWED', 'The PBR root needs bounded, explicitly indexed direct faces.');
  return { root, leaves, allowed_paths: scoped.filter(node => ['group', 'component_instance', 'face'].includes(node.entity_type)).map(node => node.entity_path) };
}

export function appearancePreservationSignature(graph, allowedPaths = []) {
  const allowed = new Set(allowedPaths);
  const nodes = graph.nodes.filter(node => node.node_type !== 'model').map(source => {
    const node = copy(source);
    if (allowed.has(node.entity_path)) {
      delete node.material; delete node.back_material; delete node.texture_transform;
      if (node.attributes) { delete node.attributes.TextureTransform; if (!Object.keys(node.attributes).length) node.attributes = null; }
    }
    return node;
  });
  return sha256Canonical(nodes);
}

export function compileNativeAppearancePlan({ appearance, taskId, catalogRecord, nativeCapabilities, adoption, styleEvidence }) {
  const input = normalizeNativeAppearanceInput(appearance), graph = completeGraph(adoption);
  if (!/^task_[0-9a-f-]+$/i.test(taskId)) fail('INVALID_ARGUMENT', 'A server task identity is required.');
  if (nativeCapabilities?.evidence !== 'native_api_probe' || !nativeCapabilities.style_load) fail('CAPABILITY_UNSUPPORTED', 'Fresh native style loading support is required.');
  if (input.capture_current_display && !nativeCapabilities.style_capture_current_display) fail('CAPABILITY_UNSUPPORTED', 'Capturing current native display into a style is unsupported.');
  if (!styleEvidence || !path.isAbsolute(styleEvidence.path) || path.extname(styleEvidence.path).toLowerCase() !== '.style' || !/^[a-f0-9]{64}$/.test(styleEvidence.sha256 || '')) fail('INVALID_ARGUMENT', 'A real server-configured native .style and its file SHA are required.');
  const namespace = `alma_appearance_${sha256Canonical(taskId).slice(7, 27)}`;
  const native = adoption.snapshot.native_appearance;
  if (native?.evidence !== 'native_api') fail('CAPABILITY_UNSUPPORTED', 'Native appearance getters are required.');
  const expected = { materials: [], environments: [], scenes: [], current_environment: native.current_environment ?? null };
  const operations = [], styleName = `${namespace}_style`;
  let scope = null, unsupported_fields = [];
  if (input.kind === 'native_pbr') {
    scope = targetScope(graph, input.target);
    const materialName = `${namespace}_material`;
    if ((native.materials || []).some(material => material.name === materialName)) fail('MODEL_REVISION_MISMATCH', 'The task material already exists; do not replay an appearance application.');
    const prepared = buildAppearanceMaterialOperations({ catalog: catalogRecord.catalog, materialMap: { selected: materialName }, assignments: { selected: input.preset }, nativeCapabilities });
    const material = prepared.operations[0];
    if (!material.texture) fail('INVALID_ARGUMENT', 'The selected PBR preset has no base texture for physical UV mapping.');
    material.workflow = 'pbr_metallic_roughness';
    [material.texture.width, material.texture.height] = input.texture_size_mm;
    operations.push(material); expected.materials.push(material); unsupported_fields = prepared.unsupported_fields;
    for (const { node } of scope.leaves) {
      const target = { entity_path: node.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
      operations.push({ op: 'set_material', ...target, material: materialName },
        { op: 'texture_transform', ...target, material: materialName, projection: 'planar', texture_size_mm: input.texture_size_mm, rotation: input.rotation, scale: [1, 1], offset: [0, 0], side: 'both' });
    }
  } else {
    const asset = catalogRecord.catalog.environments[input.environment];
    if (!asset) fail('INVALID_ARGUMENT', 'Select a configured HDR environment preset.');
    if (!nativeCapabilities.environments?.supported || !nativeCapabilities.scene_environment || !nativeCapabilities.scene_style) fail('CAPABILITY_UNSUPPORTED', 'Native HDR and scene style/environment bindings are unsupported.');
    const settings = { rotation: input.rotation, skydome_exposure: input.intensity, reflection_exposure: input.intensity, use_as_skydome: true, use_for_reflections: true, linked_sun: false };
    for (const key of Object.keys(settings)) if (nativeCapabilities.environments.settings?.[key] !== true) fail('CAPABILITY_UNSUPPORTED', `Native environment setting ${key} is unsupported.`);
    if ((native.scenes || []).some(scene => scene.name === input.scene_name)) fail('OPERATION_NOT_ALLOWED', 'The requested scene already exists; this route creates a new scene without overwriting it.');
    const environment = { op: 'environment_define', id: `${namespace}_environment`, name: `${namespace}_environment`, path: asset.path, ...settings };
    expected.environments.push(environment); expected.current_environment = environment.id;
    operations.push(environment, { op: 'environment_activate', environment_ref: environment.id });
    expected.scenes.push({ op: 'scene', name: input.scene_name, style_ref: styleName, environment_ref: environment.id, use_environment: true, use_camera: true, transition_time: 0 });
  }
  if ((native.styles?.items || []).some(style => style.name === styleName)) fail('MODEL_REVISION_MISMATCH', 'The task style already exists.');
  operations.push({ op: 'style_load', name: styleName, path: styleEvidence.path, activate: true, ...(input.capture_current_display ? { capture_current_display: true } : {}) }, ...expected.scenes);
  const document = { version: 1, units: 'mm', operations };
  validateExpertDocument(document);
  const core = { version: MODEL_ACCESSIBILITY_APPEARANCE_VERSION, task_id: taskId, input, namespace, document, expected, style_name: styleName,
    model_key: modelKeyForIdentity(modelIdentityForAdoption(adoption)), model_revision: graph.model_revision,
    preservation_signature: appearancePreservationSignature(graph, scope?.allowed_paths), allowed_paths: scope?.allowed_paths || [],
    target_path: scope?.root.entity_path || null, affected_instance_count: scope ? scope.allowed_paths.length : graph.nodes.filter(node => node.node_type === 'occurrence').length,
    uv_faces: scope?.leaves.map(({ node, faces }) => ({ path: node.entity_path, faces: faces.map(face => ({ persistent_id: String(face.persistent_id), normal: face.geometry_summary?.normal })) })) || [],
    baseline_materials: copy(native.materials || []), baseline_environments: copy(native.environments || []), baseline_scenes: copy(native.scenes || []),
    catalog_path: catalogRecord.catalog_path, catalog_sha256: catalogRecord.catalog_sha256, license: catalogRecord.license,
    asset_manifest: [...catalogRecord.asset_manifest, styleEvidence], native_capabilities: copy(nativeCapabilities), unsupported_fields, matrix: [],
    photoreal_status: 'real_style_loaded_requires_native_display_and_visual_acceptance' };
  return { ...core, appearance_plan_hash: sha256Canonical(core) };
}

async function observe(gateway, timeoutMs) {
  return gateway.bridge.adopt_open_model({ runtime: 'queue', recursive: true, recursive_limit: Math.min(10000, gateway.bridge.executionPolicy.resource_limits.max_recursive_entities), read_only: true, timeoutMs });
}
async function fileRecord(file, role) {
  const real = await fs.realpath(file), stat = await fs.stat(real);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 100_000_000) fail('ARTIFACT_INTEGRITY_ERROR', `${role} must be a nonempty bounded regular file.`);
  const data = await fs.readFile(real);
  return { path: real, sha256: hash(data), size_bytes: data.length, role };
}
function executionFile(gateway, taskId, name) {
  return path.join(gateway.taskStore.rootDir, 'task-artifacts', taskId, 'native-appearance', name);
}
async function readExecutionFile(gateway, taskId, name, phase) {
  let value;
  try { value = JSON.parse(await fs.readFile(executionFile(gateway, taskId, name), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('MUTATION_RECEIPT_INVALID', 'The appearance execution journal cannot be verified.');
  }
  const { integrity_hmac, ...body } = value;
  if (body.task_id !== taskId || body.phase !== phase || integrity_hmac !== await gateway.taskStore.mutationReceiptLedger.sign(body)) fail('MUTATION_RECEIPT_INVALID', 'The appearance execution journal failed integrity verification.');
  return body;
}
async function writeExecutionFile(gateway, taskId, name, record) {
  const location = executionFile(gateway, taskId, name);
  await fs.mkdir(path.dirname(location), { recursive: true });
  let handle;
  try {
    // Never replace an earlier claim/receipt. File and directory sync make the
    // claim independent of later task metadata writes and process restarts.
    handle = await fs.open(location, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    if (error.code === 'EEXIST') fail('MUTATION_EXECUTION_FAILED', 'The appearance execution was already claimed; no native operation may be replayed.');
    throw error;
  } finally { await handle?.close(); }
  const boundary = path.dirname(gateway.taskStore.rootDir);
  for (let directoryPath = path.dirname(location); ; directoryPath = path.dirname(directoryPath)) {
    const directory = await fs.open(directoryPath, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    if (directoryPath === boundary || path.dirname(directoryPath) === directoryPath) break;
  }
}
async function writePrivate(gateway, taskId, key, body) {
  const current = await gateway.taskStore.getTask(taskId, { includePrivate: true });
  const signed = { ...body, integrity_hmac: await gateway.taskStore.mutationReceiptLedger.sign(body) };
  if (key === 'appearance_execution' && body.phase === 'started') await writeExecutionFile(gateway, taskId, 'execution-claim.json', signed);
  if (key === 'appearance_execution' && body.phase === 'complete') await writeExecutionFile(gateway, taskId, 'complete-receipt.json', signed);
  return gateway.taskStore.update(taskId, { private: { ...current.private, [key]: signed } });
}
async function verifiedPrivate(gateway, task, key) {
  if (key === 'appearance_execution') {
    const complete = await readExecutionFile(gateway, task.task_id, 'complete-receipt.json', 'complete');
    if (complete) return complete;
    const claim = await readExecutionFile(gateway, task.task_id, 'execution-claim.json', 'started');
    if (claim) return claim;
    if (task.private?.appearance_execution) fail('MUTATION_RECEIPT_INVALID', 'The appearance task has no durable execution claim.');
    return null;
  }
  const record = task.private?.[key];
  if (!record) return null;
  const { integrity_hmac, ...body } = record;
  if (body.task_id !== task.task_id || integrity_hmac !== await gateway.taskStore.mutationReceiptLedger.sign(body)) fail('MUTATION_RECEIPT_INVALID', 'The appearance server record failed integrity verification.');
  return body;
}

export async function verifyNativeAppearanceAuthorizationReady(gateway, task) {
  if (task.intent !== 'apply_native_appearance' || task.state !== 'awaiting_review') fail('TASK_STATE_CONFLICT', 'Only a prepared appearance review can be checked for approval.');
  const record = await verifiedPrivate(gateway, task, 'appearance_plan');
  if (!record) fail('TASK_STATE_CONFLICT', 'Prepare a native appearance review first.');
  const { plan, binding, challenge } = record, { appearance_plan_hash, ...core } = plan;
  if (appearance_plan_hash !== sha256Canonical(core) || binding.plan_hash !== appearance_plan_hash
    || sha256Canonical(plan.input) !== sha256Canonical(normalizeNativeAppearanceInput(task.inputs.appearance))) fail('PLAN_HASH_MISMATCH', 'The appearance plan and original request must remain frozen.');
  if (await verifiedPrivate(gateway, task, 'appearance_execution')) fail('MUTATION_EXECUTION_FAILED', 'This appearance execution has already been claimed.');
  assertAppearancePolicy(gateway, plan);
  const ready = await gateway.bridge.approvalAuthority.verifyStoredApprovalAuthorizationReady(challenge, binding);
  return { kind: 'agent_task_authorization_readiness', ok: true, task_id: task.task_id, plan_id: binding.plan_id, plan_hash: binding.plan_hash,
    model_revision: binding.model_revision, risk_level: binding.risk_level, challenge_id: challenge.challenge_id, approval_status: ready.decision.status,
    approval_token_exposed: false, review_context_hash: binding.review_context_hash, allowed_operations: binding.allowed_operations,
    decision_id: ready.decision.decision_id, user_action_required: false };
}

export async function prepareNativeAppearanceTask(gateway, task) {
  if (task.private?.appearance_plan) return continueNativeAppearanceTask(gateway, task);
  if (await verifiedPrivate(gateway, task, 'appearance_execution')) fail('MUTATION_RECEIPT_INVALID', 'A prior appearance execution exists without its frozen review. It cannot be prepared again.');
  fields(task.inputs, ['runtime', 'appearance', 'session_contract', 'connection_task_id', 'timeout_ms'], 'appearance inputs');
  if (task.inputs.runtime !== 'queue') fail('INVALID_ARGUMENT', 'Native appearance requires explicit runtime=queue; mock cannot establish native appearance.');
  if (!task.inputs.appearance) return gateway.taskStore.transition(task.task_id, 'awaiting_input', { reason: 'appearance_inputs_required', patch: { next_action: { action: 'submit_task_input', required: ['appearance'] } } });
  normalizeNativeAppearanceInput(task.inputs.appearance);
  const catalogPath = gateway.bridge.options.appearanceCatalogPath || process.env.ALMA_SKETCHUP_APPEARANCE_CATALOG_PATH;
  const stylePath = gateway.bridge.options.appearanceStylePath || process.env.ALMA_SKETCHUP_APPEARANCE_STYLE_PATH;
  if (!catalogPath || !stylePath) fail('CAPABILITY_UNSUPPORTED', 'The host must configure an appearance catalog and real native .style file before this workflow can prepare.');
  if (!gateway.bridge.executionPolicy.allowed_runtimes.includes('queue')) fail('POLICY_DENIED', 'Queue runtime is not allowed by server policy.');
  const timeoutMs = number(task.inputs.timeout_ms ?? 120000, 1000, 600000, 'timeout_ms');
  const catalogRecord = await loadNativeAppearanceCatalog({ catalogPath });
  const styleEvidence = await fileRecord(stylePath, 'server_configured_native_style');
  const capabilities = (await gateway.bridge.get_capabilities({ runtime: 'queue', timeoutMs })).runtime;
  const adoption = await observe(gateway, timeoutMs);
  const plan = compileNativeAppearancePlan({ appearance: task.inputs.appearance, taskId: task.task_id, catalogRecord, nativeCapabilities: capabilities.native_appearance, adoption, styleEvidence });
  assertAppearancePolicy(gateway, plan);
  const directory = path.join(gateway.taskStore.rootDir, 'task-artifacts', task.task_id, 'native-appearance');
  await fs.mkdir(directory, { recursive: true });
  const review = { kind: 'native_appearance_review_context', summary: plan.input.kind === 'native_pbr' ? '限定对象原生材质与纹理' : '新 HDR 环境与场景',
    instruction: task.instruction, content_trust: 'untrusted_data', policy_effect: 'none', affected_instance_count: plan.affected_instance_count,
    targets: plan.target_path ? [{ entity_path: plan.target_path }] : [], operations: plan.document.operations.map((operation, index) => ({ index, op: operation.op, destructive: false, topology: false })),
    appearance: plan.input, asset_license: plan.license, file_effect: 'Capture a native closeup and save the current document as a unique new SKP; source files are not overwritten.',
    style_effect: plan.input.capture_current_display ? 'Commit the current native display into a newly imported style.' : 'Activate the configured native style; Photoreal display requires actual visual confirmation.' };
  const binding = { task_id: task.task_id, plan_id: `appearance-${plan.appearance_plan_hash.slice(7, 31)}`, plan_hash: plan.appearance_plan_hash,
    model_revision: plan.model_revision, risk_level: 'S2', allowed_operations: [...plan.document.operations.map(operation => operation.op), 'capture_detail_views', 'save_model'], review_context_hash: sha256Canonical(review) };
  const challenge = await gateway.bridge.approvalAuthority.createChallenge({ taskId: task.task_id, planId: binding.plan_id, planHash: binding.plan_hash,
    modelRevision: binding.model_revision, riskLevel: binding.risk_level, allowedOperations: binding.allowed_operations, reviewContext: review,
    idempotencyKey: `appearance:${task.task_id}:${binding.plan_hash}` });
  task = await writePrivate(gateway, task.task_id, 'appearance_plan', { task_id: task.task_id, plan, binding, challenge, directory, timeout_ms: timeoutMs });
  return gateway.taskStore.transition(task.task_id, 'awaiting_review', { reason: 'native_appearance_review_required', patch: {
    result: { kind: 'model_accessibility_appearance', stage: 'review_required', appearance_kind: plan.input.kind, plan_id: binding.plan_id, plan_hash: binding.plan_hash,
      appearance: plan.input, target_path: plan.target_path, operation_count: plan.document.operations.length, risk_level: 'S2', approval_challenge: challenge,
      quality_accepted: false, evidence_level: 'preflight_only', style_display_acceptance: 'pending' },
    next_action: gateway.approvalNextAction(challenge, { required: ['fresh connection_task_id', 'stable submit idempotency_key'] }) } });
}

export function verifyAppearanceUvReadback(plan, graph) {
  if (plan.input.kind !== 'native_pbr') return { ok: true, applicable: false, face_sides_checked: 0 };
  const issues = [], angle = plan.input.rotation * Math.PI / 180, [width, height] = plan.input.texture_size_mm;
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const unit = value => { const length = Math.hypot(...value); return value.map(item => item / length); };
  let checked = 0;
  for (const leaf of plan.uv_faces) {
    const node = graph.nodes.find(item => item.entity_path === leaf.path);
    const entries = node?.texture_transform?.native_uv;
    if (!Array.isArray(entries) || entries.length !== leaf.faces.length * 2) { issues.push('missing_complete_native_face_uv'); continue; }
    for (const face of leaf.faces) for (const side of ['front', 'back']) {
      const matching = entries.filter(item => String(item.persistent_id) === face.persistent_id && item.side === side);
      const native = matching[0], normal = face.normal;
      if (matching.length !== 1 || native.status !== 'readback' || native.material !== plan.expected.materials[0].name || !Array.isArray(normal) || normal.length !== 3 || !normal.every(Number.isFinite)
        || !Array.isArray(native.samples) || native.samples.length < 3) { issues.push('native_face_uv_or_material_missing'); continue; }
      const n = unit(normal), ref = Math.abs(n[0]) < 0.999999 ? [1, 0, 0] : [0, 1, 0];
      const u = unit(ref.map((value, index) => value - dot(ref, n) * n[index]));
      const v = unit([n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]);
      for (const sample of native.samples) {
        if (!Array.isArray(sample.point_mm) || sample.point_mm.length !== 3 || !sample.point_mm.every(Number.isFinite) || !Array.isArray(sample.uv) || sample.uv.length !== 2 || !sample.uv.every(Number.isFinite)) { issues.push('invalid_native_uv_sample'); continue; }
        const s = dot(sample.point_mm, u) / width, t = dot(sample.point_mm, v) / height;
        const expected = [s * Math.cos(angle) + t * Math.sin(angle), -s * Math.sin(angle) + t * Math.cos(angle)];
        if (expected.some((value, index) => !Number.isFinite(value) || Math.abs(value - sample.uv[index]) > 1e-5)) issues.push('native_uv_scale_or_rotation_mismatch');
      }
      checked++;
    }
  }
  return { ok: !issues.length && checked > 0, face_sides_checked: checked, tolerance_uv: 1e-5, issues: [...new Set(issues)] };
}

export function verifyNativeAppearanceApplication(plan, adoption) {
  const graph = completeGraph(adoption), snapshot = adoption.snapshot, native = snapshot.native_appearance;
  const nativeReadback = evaluateNativeAppearanceReadback({ plan, snapshot });
  const sameOld = (before, after, key) => before.every(item => {
    const matches = (after || []).filter(other => other[key] === item[key]);
    return matches.length === 1 && sha256Canonical(matches[0]) === sha256Canonical(item);
  });
  const geometryPreserved = appearancePreservationSignature(graph, plan.allowed_paths) === plan.preservation_signature;
  const unrelatedUnchanged = sameOld(plan.baseline_materials, native.materials, 'name')
    && sameOld(plan.baseline_environments, native.environments, 'id') && sameOld(plan.baseline_scenes, native.scenes, 'name');
  const uv = verifyAppearanceUvReadback(plan, graph);
  const workflow = plan.expected.materials.every(expected => native.materials?.find(item => item.name === expected.name)?.workflow === 'pbr_metallic_roughness');
  const style = native.selected_style?.name === plan.style_name && native.active_style_changed === false && plain(native.rendering_options);
  return { ok: nativeReadback.ok && geometryPreserved && unrelatedUnchanged && uv.ok && workflow && style,
    native_readback: nativeReadback, geometry_preserved: geometryPreserved, unrelated_unchanged: unrelatedUnchanged,
    uv_readback: uv, native_workflow_readback: workflow, native_style_readback: style, model_revision: graph.model_revision };
}

async function finalizeAppearanceReceipt(gateway, task, record, execution) {
  if (execution.plan_hash !== record.plan.appearance_plan_hash || execution.phase !== 'complete' || !execution.result) fail('MUTATION_RECEIPT_INVALID', 'The appearance result is not bound to its prepared plan.');
  const file = await fileRecord(path.join(record.directory, 'model.skp'), 'saved_model');
  if (sha256Canonical(file) !== sha256Canonical(execution.file)) fail('ARTIFACT_INTEGRITY_ERROR', 'The saved appearance model changed after its receipt.');
  const modelArtifact = await gateway.taskStore.registerArtifact(task.task_id, { filePath: file.path, label: 'appearance-model.skp', kind: 'file', mediaType: 'application/octet-stream' });
  const capture = execution.capture;
  const imageFile = await fileRecord(capture.path || capture.file_path, 'native_closeup');
  if (imageFile.sha256 !== capture.sha256) fail('ARTIFACT_INTEGRITY_ERROR', 'The native closeup changed after capture.');
  const imageArtifact = await gateway.taskStore.registerArtifact(task.task_id, { filePath: imageFile.path, label: 'appearance-closeup.png', kind: 'image', mediaType: 'image/png' });
  if (task.state === 'executing') task = await gateway.taskStore.transition(task.task_id, 'verifying', { reason: 'appearance_receipt_verified' });
  if (task.state === 'completed') return task;
  return gateway.taskStore.transition(task.task_id, 'completed', { reason: 'native_appearance_applied_and_saved', patch: {
    last_error: null, next_action: null, result: { ...execution.result, artifact: modelArtifact, closeup_artifact: imageArtifact } } });
}

export async function captureAndSaveNativeAppearance(authorized, plan, verification, directory, session, timeoutMs, beforeSave = () => undefined) {
  if (!verification?.ok) fail('OPERATION_NOT_ALLOWED', 'Native appearance readback or preservation did not pass. The committed model is retained; no save or replay is allowed.');
  const savedPath = path.join(await fs.realpath(directory), 'model.skp');
  if (await fs.lstat(savedPath).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; }))
    fail('ARTIFACT_INTEGRITY_ERROR', 'The unique appearance output already exists; it will not be overwritten.');
  const captureResult = await authorized.capture_detail_views({ runtime: 'queue', timeoutMs, output_dir: path.join(directory, 'closeup'),
    views: [{ id: 'appearance', width: 1600, height: 1000, ...(plan.target_path ? { instance_path: [plan.target_path] } : {}) }] });
  const capture = captureResult.captures?.[0];
  if (captureResult.restored !== true || !capture?.server_verified || capture.model_revision !== verification.model_revision) fail('OPERATION_NOT_ALLOWED', 'The native closeup did not prove complete restoration to the verified appearance model.');
  if (typeof beforeSave === 'function') await beforeSave(capture);
  const saved = await authorized.save_model({ runtime: 'queue', path: savedPath, keep_session: true, timeoutMs });
  if (path.resolve(saved.file_path || '') !== savedPath) fail('ARTIFACT_INTEGRITY_ERROR', 'The native save response does not match the unique appearance output.');
  const saved_state = await authorized.selectRuntime('queue', { timeoutMs }).getSessionState();
  if (saved_state.model_revision_complete !== true || saved_state.model_revision !== verification.model_revision || path.resolve(saved_state.model_identity?.source_path || '') !== savedPath
    || saved_state.session_id !== session.session_id || saved_state.document_id !== session.document_id) fail('MODEL_REVISION_MISMATCH', 'The saved appearance state did not match the verified same document.');
  const file = await fileRecord(savedPath, 'saved_model');
  return { capture, file, saved_state };
}

export async function continueNativeAppearanceTask(gateway, task, { input = {}, submit = false } = {}) {
  const record = await verifiedPrivate(gateway, task, 'appearance_plan');
  if (!record) fail('TASK_STATE_CONFLICT', 'Prepare the native appearance plan first.');
  const { plan, binding, challenge, timeout_ms: timeoutMs } = record;
  const { appearance_plan_hash, ...core } = plan;
  if (appearance_plan_hash !== sha256Canonical(core) || binding.plan_hash !== appearance_plan_hash
    || sha256Canonical(plan.input) !== sha256Canonical(normalizeNativeAppearanceInput(task.inputs.appearance))) fail('PLAN_HASH_MISMATCH', 'The original appearance request and server plan are frozen.');
  const previous = await verifiedPrivate(gateway, task, 'appearance_execution');
  if (previous) {
    if (previous.phase === 'complete') return finalizeAppearanceReceipt(gateway, task, record, previous);
    fail('MUTATION_EXECUTION_FAILED', 'Appearance execution was already claimed. No committed save receipt exists; inspect the recorded model outcome. Resume never replays build, capture or save.');
  }
  if (!submit) return gateway.refreshLocalApprovalState(task);
  assertAppearancePolicy(gateway, plan);
  fields(input, ['runtime', 'session_contract', 'connection_task_id', 'note'], 'appearance submission');
  if (input.runtime !== undefined && input.runtime !== 'queue') fail('INVALID_ARGUMENT', 'The prepared appearance runtime is frozen.');
  if (!gateway.bridge.executionPolicy.allowed_runtimes.includes('queue') || !gateway.bridge.executionPolicy.allow_queue_mutation) fail('POLICY_DENIED', 'Gateway native appearance mutation is not allowed by server policy.');
  const session = input.session_contract || task.inputs.session_contract;
  if (!session) fail('HANDSHAKE_REQUIRED', 'Supply a fresh connection_task_id after reviewing this appearance plan.');
  if (session.model_revision !== plan.model_revision) fail('MODEL_REVISION_MISMATCH', 'The fresh connection must match the exact model revision reviewed for appearance.');
  const authorization = await gateway.resolveTrustedApproval(challenge, binding);
  await assertAppearanceAssetsUnchanged(plan);
    const now = await observe(gateway, timeoutMs), graph = completeGraph(now);
    if (modelKeyForIdentity(modelIdentityForAdoption(now)) !== plan.model_key) fail('MODEL_IDENTITY_MISMATCH', 'The active document changed after appearance review.');
    if (graph.model_revision !== plan.model_revision) fail('MODEL_REVISION_MISMATCH', 'The active model changed after appearance review; no edit has been applied.');
    const receiptBase = { version: MODEL_ACCESSIBILITY_APPEARANCE_VERSION, task_id: task.task_id, plan_hash: appearance_plan_hash };
    await gateway.bridge.withAgentGatewayExecution({ taskId: task.task_id, intent: task.intent }, scoped => scoped.withLiveMutationAuthorization({
      runtime: 'queue', session_contract: session, timeoutMs, operation: 'build_model'
  }, async authorized => {
    await assertAppearanceAssetsUnchanged(plan);
    // Claim before consuming the one-time approval or dispatching any native
    // mutation. Interrupted claims are deliberately never replayable.
    task = await writePrivate(gateway, task.task_id, 'appearance_execution', { ...receiptBase, phase: 'started' });
    await gateway.bridge.approvalAuthority.consumeToken(authorization.approval_token, binding);
    task = await gateway.taskStore.transition(task.task_id, 'approved', { reason: 'trusted_appearance_approval_present' });
    task = await gateway.taskStore.transition(task.task_id, 'executing', { reason: 'native_appearance_started' });
    const built = await authorized.build_model({ runtime: 'queue', code: JSON.stringify(plan.document), timeoutMs });
    const nativeReceipt = trustedBridgeReceipt({ runtime: 'queue', nativeReceipt: built.mutation_receipt });
    task = await writePrivate(gateway, task.task_id, 'appearance_execution', { ...receiptBase, phase: 'built', native_receipt: nativeReceipt, build_snapshot: built.snapshot });
    await assertAppearanceAssetsUnchanged(plan);
    const after = await authorized.adopt_open_model({ runtime: 'queue', recursive: true, recursive_limit: Math.min(10000, gateway.bridge.executionPolicy.resource_limits.max_recursive_entities), read_only: true, timeoutMs });
    const verification = verifyNativeAppearanceApplication(plan, after);
    if (!verification.ok) {
      await writePrivate(gateway, task.task_id, 'appearance_execution', { ...receiptBase, phase: 'verification_failed', native_receipt: nativeReceipt, verification, snapshot: after.snapshot });
      fail('OPERATION_NOT_ALLOWED', 'Native appearance readback or preservation did not pass. The committed model is retained; no save or replay is allowed.');
    }
    const { capture, file, saved_state } = await captureAndSaveNativeAppearance(authorized, plan, verification, record.directory, session, timeoutMs, async capture => {
      task = await writePrivate(gateway, task.task_id, 'appearance_execution', { ...receiptBase, phase: 'save_started', native_receipt: nativeReceipt, verification, capture });
    });
    const result = { kind: 'model_accessibility_appearance', stage: 'applied', appearance_kind: plan.input.kind, plan_id: binding.plan_id, appearance: plan.input,
      saved: true, file: { filename: 'model.skp', sha256: file.sha256, bytes: file.size_bytes }, native_readback: verification.native_readback,
      uv_readback: verification.uv_readback, geometry_preserved: verification.geometry_preserved, unrelated_unchanged: verification.unrelated_unchanged,
      native_style_readback: verification.native_style_readback, native_workflow_readback: verification.native_workflow_readback,
      model_revision: verification.model_revision, evidence_level: 'live_saved_file', quality_accepted: false, quality_status: 'needs_review',
      cold_reopen_verified: false, release_acceptance: false,
      remaining: ['Inspect the native closeup and confirm actual PBR display/visual appearance.'],
      optional_validation: 'Close/reopen comparison is only for an explicit user request. After visual review, deliver the saved artifacts; do not repeat application, capture or save.' };
    task = await writePrivate(gateway, task.task_id, 'appearance_execution', { ...receiptBase, phase: 'complete', native_receipt: nativeReceipt, file, capture, result, saved_state: copy(saved_state) });
    return result;
  }));
  // The signed complete receipt above is sufficient for read-only finalization
  // if artifact registration or the task-state transition is interrupted.
  task = await gateway.taskStore.getTask(task.task_id, { includePrivate: true });
  return finalizeAppearanceReceipt(gateway, task, record, await verifiedPrivate(gateway, task, 'appearance_execution'));
}
