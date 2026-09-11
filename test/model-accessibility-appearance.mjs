// Isolated, injected API-shaped fixtures only. No native application, real
// approval host, user presence, vendor images or live SKP evidence is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SketchUpBridge } from '../src/bridge.mjs';
import { readVerifiedModelAccessibilitySavedReceipt, isVerifiedModelAccessibilitySavedReceipt } from '../src/model-accessibility-delivery.mjs';
import { SessionContractAuthority } from '../src/session-contract.mjs';
import { getRuntimeCapabilities } from '../src/capabilities.mjs';
import { PRODUCT_VERSION } from '../src/version.mjs';
import { ToolInputValidator } from '../src/tool-input-validator.mjs';
import { TOOL_REGISTRY, AGENT_GATEWAY_TOOL_NAMES } from '../src/tool-registry.mjs';
import { APPEARANCE_MATERIAL_KINDS, loadNativeAppearanceCatalog } from '../src/detailed-modeling/appearance-presets.mjs';
import { normalizeNativeAppearanceInput, compileNativeAppearancePlan, verifyNativeAppearanceApplication } from '../src/model-accessibility-appearance.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'appearance-gateway-offline-'));
const clone = value => structuredClone(value), hash = value => crypto.createHash('sha256').update(value).digest('hex');
const revision = n => `sha256:${String(n).padStart(64, '0')}`;
const validator = new ToolInputValidator(TOOL_REGISTRY);
const pbr = { kind: 'native_pbr', target: 'P', preset: 'wood', texture_size_mm: [750, 750], rotation: 30 };
const hdr = { kind: 'native_hdr', environment: 'studio', rotation: 30, intensity: 1, scene_name: '验收外观' };
const nativeCapabilities = { evidence: 'native_api_probe', workflow_getter: true, normal_style_constants: { opengl: 42, directx: 21 },
  pbr_channels: Object.fromEntries(['metalness', 'roughness', 'normal', 'ao'].map(key => [key, { read: true, write: true }])),
  environments: { supported: true, settings: Object.fromEntries(['rotation', 'skydome_exposure', 'reflection_exposure', 'use_as_skydome', 'use_for_reflections', 'linked_sun'].map(key => [key, true])) },
  scene_environment: true, scene_style: true, style_load: true, style_capture_current_display: true };
let serial = 0;
const file = async (name, data = `Offline fixture: ${name}`) => {
  const location = path.join(root, name); await fs.writeFile(location, data); return { path: location, sha256: hash(data), size_bytes: Buffer.byteLength(data) };
};
const catalog = { version: 1, assets: [], presets: {}, environments: {}, license: 'Synthetic offline unit fixtures only' };
for (const kind of APPEARANCE_MATERIAL_KINDS) {
  const source = await file(`${kind}.skm`), texture = await file(`${kind}.png`), normal = await file(`${kind}-normal.png`), roughness = await file(`${kind}-roughness.png`);
  catalog.presets[kind] = { name: `Source_${kind}`, source_skm_path: source.path, source_sha256: source.sha256, source_color: '#aaaaaa', source_normal_style_value: 42,
    texture: { path: texture.path, width: 500, height: 500 }, pbr: { textures: { normal: normal.path, roughness: roughness.path }, normal_scale: 1, normal_enabled: true,
      metalness_enabled: false, roughness_enabled: true, ao_enabled: false, roughness_factor: 0.6, metallic_factor: 0 } };
}
for (const key of ['studio', 'daylight']) {
  const image = await file(`${key}.hdr`), archive = await file(`${key}.ske`);
  catalog.environments[key] = { path: image.path, file_sha256: image.sha256, source: archive.path, archive_sha256: archive.sha256, license: catalog.license };
}
const catalogPath = (await file('catalog.json', JSON.stringify(catalog))).path;
const style = await file('offline.style');
const catalogRecord = await loadNativeAppearanceCatalog({ catalogPath });

function adoption(state) {
  const transform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const group = (pid, name, parent = null) => ({ entity_type: 'group', persistent_id: String(pid), name, reference: name, entity_path: parent ? `${parent}.${pid}` : `pid:${pid}`,
    parent_entity_path: parent, transformation: transform, editable: true, edit_scope: 'instance_path', affected_instance_count: 1, entity_definition_occurrence_count: 1, shared_definition: false,
    bounding_box: { min: [0, 0, 0], max: [400, 500, 30], w: 400, d: 500, h: 30 }, attributes: { Sentinel: { key: name } } });
  const entries = [group(1, 'P'), group(10, 'P_leaf', 'pid:1'), { entity_type: 'face', entity_path: 'pid:1.10.11', parent_entity_path: 'pid:1.10', persistent_id: '11', editable: true,
    geometry_summary: { type: 'face', normal: [0, 0, 1], vertices: [[0, 0, 0], [400, 0, 0], [400, 500, 0], [0, 500, 0]], area: 200000, edge_count: 4 } }, group(2, 'Sentinel')];
  return { kind: 'adopt_open_model', version: 1, runtime: 'queue', model_revision: state.model_revision, model_revision_complete: true, model_revision_total_seen: entries.length, model_revision_indexed: entries.length, occurrence_contract: 'canonical-occurrence-path.v1', recursive: true, recursive_truncated: false,
    recursive_total_seen: entries.length, recursive_index: entries, entities: [entries[0], entries[3]], read_only: true, model_identity: clone(state.model_identity), document_id: state.document_id,
    snapshot: { materials: [{ name: 'Existing', color: '#ffffff' }],
      native_appearance: { evidence: 'native_api', materials: [{ name: 'Existing', color: '#ffffff' }], environments: [{ id: 'old', name: 'Old', rotation: 0 }], current_environment: 'old',
        scenes: [{ name: 'Original', style_native: { name: 'Original Style' } }], selected_style: { name: 'Original Style' }, active_style_changed: false, rendering_options: { NativeTest: true } } } };
}
function applyDocument(before, document) {
  const after = clone(before), native = after.snapshot.native_appearance;
  for (const { op, ...operation } of document.operations) {
    if (op === 'material') native.materials.push(operation);
    if (op === 'set_material') after.recursive_index.find(entry => entry.entity_path === operation.entity_path).material = operation.material;
    if (op === 'texture_transform') {
      const leaf = after.recursive_index.find(entry => entry.entity_path === operation.entity_path), angle = operation.rotation * Math.PI / 180;
      const points = [[0, 0, 0], [400, 0, 0], [400, 500, 0], [0, 500, 0]];
      leaf.texture_transform = { ...operation, application: 'native_mapping_requested', native_uv: ['front', 'back'].map(side => ({ persistent_id: '11', side, status: 'readback', material: operation.material,
        samples: points.map(point => { const s = point[0] / operation.texture_size_mm[0], t = point[1] / operation.texture_size_mm[1]; return { point_mm: point, uv: [s * Math.cos(angle) + t * Math.sin(angle), -s * Math.sin(angle) + t * Math.cos(angle)] }; }) })) };
      leaf.attributes.TextureTransform = { payload_json: JSON.stringify(operation) };
      for (const face of after.recursive_index.filter(entry => entry.parent_entity_path === leaf.entity_path && entry.entity_type === 'face')) face.material = face.back_material = operation.material;
    }
    if (op === 'style_load') native.selected_style = { name: operation.name };
    if (op === 'environment_define') native.environments.push(operation);
    if (op === 'environment_activate') native.current_environment = operation.environment_ref;
    if (op === 'scene') native.scenes.push({ ...operation, use_style: true, style_native: { name: operation.style_ref } });
  }
  after.snapshot.materials = clone(native.materials);
  after.model_revision = revision(2);
  return after;
}
class QueueFixture {
  constructor(directory) {
    const cap = getRuntimeCapabilities('queue');
    this.capabilities = { ...cap, native_appearance: nativeCapabilities, saved_model_lifecycle: { version: 'saved-model-lifecycle.v1', close_reopen_saved_model: true }, plugin: { name: 'Offline fixture', version: PRODUCT_VERSION, sketchup_version: '26.2.242', ruby_version: '3.2' } };
    this.state = { kind: 'queue_session_state', runtime: 'queue', session_id: 'fixture-session', document_id: 'fixture-document',
      model_identity: { model_guid: 'fixture-guid', runtime_object_id: '42', title: 'Fixture', source_path: path.join(directory, 'source.skp') },
      model_revision: revision(1), model_revision_complete: true, model_revision_total_seen: 4, model_revision_indexed: 4,
      model_revision_strategy: cap.model_revision.strategy, model_revision_unique_entity_limit: cap.model_revision.unique_entity_limit, model_modified: false,
      plugin_version: PRODUCT_VERSION, queue_state: 'idle', capability_version: cap.capability_version, manifest_version: cap.manifest_version, dsl_version: cap.dsl_version,
      occurrence_contract: cap.occurrence_contract, boolean_operations_sha256: cap.boolean_operations_sha256, model_revision_source_sha256: cap.model_revision_source_sha256 };
    this.current = adoption(this.state); this.builds = 0; this.saves = 0; this.captures = 0;
  }
  async getCapabilities() { return clone(this.capabilities); }
  async inspectModel() { return { kind: 'inspect_model', runtime: 'queue', entities: clone(this.current.entities) }; }
  async getSessionState() { return clone(this.state); }
  async createFreshHandshakeProbe() { return this.getSessionState(); }
  async diagnostics() { return { queue: { count: 0 }, processing: { count: 0 }, responses: { count: 0 }, lock: { exists: false } }; }
  async withExclusiveAccess(callback) { return callback(); }
  async assertIdleForMutation() { return { queue_state: 'idle' }; }
  async withMutationGuard(_guard, callback) { return callback(); }
  async adoptOpenModel() { const result = clone(this.current); result.model_revision = this.state.model_revision; result.model_identity = clone(this.state.model_identity); return result; }
  async buildModel(code) {
    this.builds++; this.current = applyDocument(this.current, JSON.parse(code)); this.state.model_revision = revision(2); this.state.model_modified = true;
    if (this.badUv) this.current.recursive_index.find(node => node.texture_transform).texture_transform.native_uv[0].samples[1].uv[0] += 0.1;
    if (this.loseBuild) throw new Error('Synthetic lost build response');
    return { ...clone(this.current.snapshot), mutation_receipt: { version: 'mutation-receipt.v1', kind: 'sketchup_mutation_receipt', operation: 'Alma Build Model', commit_state: 'committed', committed_at: new Date().toISOString() } };
  }
  async captureDetailViews({ output_dir, views }) {
    for (const view of views) if (view.instance_path !== undefined) {
      assert.ok(Array.isArray(view.instance_path) && view.instance_path.length > 0 && view.instance_path.length <= 64,
        'Native detail capture requires an array of 1..64 instance IDs.');
      assert.ok(view.instance_path.every(id => typeof id === 'string' && id.length > 0));
    }
    this.captures++; await fs.mkdir(output_dir, { recursive: true });
    const png = Buffer.alloc(24); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png); png.writeUInt32BE(1600, 16); png.writeUInt32BE(1000, 20);
    const location = path.join(output_dir, 'offline-not-native.png'); await fs.writeFile(location, png);
    return { restored: true, captures: [{ path: location, model_revision: this.state.model_revision, model_revision_complete: true, evidence: 'native_view_write_image', camera_stable_during_export: true }] };
  }
  async saveModel({ outputPath, keepSession }) {
    assert.equal(keepSession, true); this.saves++; await fs.writeFile(outputPath, 'Offline fixture bytes: NOT A SKP', { flag: 'wx' });
    this.state.model_identity.source_path = outputPath; this.state.model_modified = false;
    if (this.loseSave) throw new Error('Synthetic lost save response');
    return { file_path: outputPath };
  }
  async closeReopenSavedModel(binding) {
    this.closes = (this.closes || 0) + 1;
    const before = clone(this.state), bytes = await fs.readFile(binding.path);
    this.state.document_id = 'offline-reopened-document'; this.state.model_identity.runtime_object_id = '99';
    const file = { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    return { kind: 'close_reopen_saved_model', version: 'saved-model-lifecycle.v1', runtime: 'queue', delivery_task_id: binding.delivery_task_id,
      file_path: binding.path, opened: true, open_status: 'activated', close_confirmed: true, close_ignore_changes: false,
      close_evidence: 'original_native_model_valid_false_before_open', before_document_id: before.document_id, after_document_id: this.state.document_id,
      before, after: clone(this.state), file_before: file, file_after: file, new_document_identity_confirmed: true, reopen_verified: true,
      application_restarted: false, cold_application_restart: false, mutation_ready: false, requires_fresh_session: true, automatic_retry_allowed: false };
  }
}
async function call(bridge, tool, input) { validator.validate(tool, input); const result = await bridge[tool](input); const serialized = JSON.stringify(result); assert.ok(serialized.length <= 4096, `${tool} short response bound`); assert.equal(serialized.includes(root), false, 'Client without files cannot see native local paths'); assert.equal(serialized.includes('hmac_sha256:'), false, 'Signatures remain private'); return result; }
async function fixture(appearance = pbr) {
  const directory = path.join(root, `scenario-${++serial}`), runtime = new QueueFixture(directory);
  const options = { queueRuntime: runtime, appearanceCatalogPath: catalogPath, appearanceStylePath: style.path,
    sessionContractAuthority: new SessionContractAuthority({ stateDir: path.join(directory, 'session'), secret: 'offline-native-appearance-fixture-session-over-32-bytes', serverSessionId: `offline-${serial}` }),
    agentContract: { rootDir: path.join(directory, 'tasks') }, approval: { stateDir: path.join(directory, 'approval'), secret: 'offline-native-appearance-fixture-approval-over-32-bytes' },
    executionPolicy: { allowed_runtimes: ['queue'], allow_queue_mutation: true, allow_direct_expert_queue_mutation: false } };
  const bridge = new SketchUpBridge(options);
  const args = { intent: 'apply_native_appearance', instruction: 'Offline isolated contract fixture; no real user or native evidence.', idempotency_key: `prepare-${serial}`, inputs: { runtime: 'queue', appearance: clone(appearance) } };
  const started = await call(bridge, 'start_agent_task', args);
  assert.equal(started.task_state, 'awaiting_review', JSON.stringify(started)); assert.equal(runtime.builds, 0);
  const task = () => bridge.taskStore.getTask(started.task_id, { includePrivate: true });
  const connect = async () => { const result = await call(bridge, 'start_agent_task', { intent: 'discover', instruction: 'Offline read-only connection fixture.', inputs: { runtime: 'queue', topic: 'connect' } }); assert.equal(result.task_state, 'completed', JSON.stringify(result)); return result; };
  const approve = async () => {
    // This temporary Authority is explicitly the injected test issuer; it has
    // no relationship to a live approval host or actual user presence.
    const stored = await task();
    await bridge.approvalAuthority.recordTrustedDecision(stored.private.appearance_plan.challenge, { decision: 'approved', user_id: 'offline-test-issuer', channel: 'isolated-unit-fixture', confirmed: true });
  };
  const submit = async (extra = {}, key = `submit-${serial}`) => call(bridge, 'submit_agent_task_input', { task_id: started.task_id, idempotency_key: key, input: { connection_task_id: (await connect()).task_id, ...extra } });
  return { bridge, options, runtime, started, task, connect, approve, submit, args };
}
try {
  assert.equal(AGENT_GATEWAY_TOOL_NAMES.length, 4);
  for (const bad of [{ ...pbr, path: '/tmp/escape.skp' }, { ...pbr, approval_token: 'forged' }, { ...pbr, rotation: NaN }, { ...hdr, preset: 'wood' }]) assert.throws(() => normalizeNativeAppearanceInput(bad));
  const before = adoption(new QueueFixture(root).state);
  const compile = (input = pbr, model = before, caps = nativeCapabilities) => compileNativeAppearancePlan({ appearance: input, taskId: 'task_01234567-89ab-cdef-0123-456789abcdef', catalogRecord, nativeCapabilities: caps, adoption: model, styleEvidence: style });
  const plan = compile();
  const captured = JSON.parse(await fs.readFile(new URL('./fixtures/model-accessibility/native-appearance-adoption.json', import.meta.url), 'utf8'));
  assert.equal(captured.adoption.model_revision_complete, true);
  assert.equal(captured.adoption.model_revision_indexed, 40);
  assert.equal(Object.hasOwn(captured.adoption.snapshot, 'model_revision_complete'), false, 'The real native report does not duplicate completeness inside snapshot.');
  const capturedPlan = compile(pbr, captured.adoption);
  assert.equal(capturedPlan.model_revision, captured.adoption.model_revision, 'Real top-level native revision must bind the compiled plan.');
  for (const mutate of [value => { delete value.model_revision_complete; value.snapshot.model_revision_complete = true; }, value => { value.model_revision_complete = false; }, value => { value.model_revision_indexed--; }, value => { value.snapshot.model_revision = revision(99); }]) {
    const broken = clone(captured.adoption); mutate(broken);
    assert.throws(() => compile(pbr, broken), error => error.code === 'MODEL_REVISION_INCOMPLETE');
  }
  assert.equal(plan.uv_faces[0].path, 'pid:1.10', 'Nested unshared leaf is explicit; root must not repaint unrelated shared descendants');
  assert.equal(plan.document.operations.find(op => op.op === 'texture_transform').rotation, 30);
  const after = applyDocument(before, plan.document);
  assert.equal(verifyNativeAppearanceApplication(plan, after).ok, true);
  const hplan = compile(hdr); assert.equal(verifyNativeAppearanceApplication(hplan, applyDocument(before, hplan.document)).ok, true);
  assert.equal(hplan.document.operations.some(op => op.op === 'camera'), false, 'HDR appearance does not reposition the camera');
  for (const mutate of [model => model.recursive_index[1].shared_definition = true, model => model.recursive_index[0].locked = true,
    model => model.recursive_truncated = true, model => model.recursive_index.push(clone(model.recursive_index[0]))]) { const bad = clone(before); mutate(bad); assert.throws(() => compile(pbr, bad)); }
  assert.throws(() => compile(pbr, before, { ...nativeCapabilities, evidence: 'mock' }));
  assert.throws(() => compile({ ...hdr, scene_name: 'Original' }), /already exists/);
  for (const mutate of [model => model.recursive_index[3].name = 'Changed sentinel', model => model.recursive_index[2].geometry_summary.vertices[0][0] += 1,
    model => model.snapshot.native_appearance.materials[0].color = '#000000', model => model.snapshot.native_appearance.environments[0].rotation = 10,
    model => model.recursive_index[1].texture_transform.native_uv[0].samples[1].uv[0] += 0.05,
    model => model.recursive_index[1].texture_transform.native_uv.pop(), model => model.snapshot.native_appearance.evidence = 'mock']) {
    const bad = clone(after); mutate(bad); assert.equal(verifyNativeAppearanceApplication(plan, bad).ok, false);
  }
  const f = await fixture();
  assert.equal((await f.submit()).error.code, 'APPROVAL_REQUIRED'); assert.equal(f.runtime.builds, 0);
  assert.equal((await call(f.bridge, 'resume_agent_task', { task_id: f.started.task_id })).task_state, 'awaiting_review');
  await assert.rejects(() => call(f.bridge, 'start_agent_task', { ...f.args, idempotency_key: undefined }), /idempotency_key/);
  const forged = await f.submit({ appearance: { ...pbr, rotation: 90 } }, 'reject-new-fields'); assert.equal(forged.error.code, 'INVALID_ARGUMENT');
  await assert.rejects(() => f.bridge.verify_agent_task_authorization_ready({ task_id: f.started.task_id }), error => error.code === 'APPROVAL_REQUIRED');
  await f.approve();
  const readiness = await f.bridge.verify_agent_task_authorization_ready({ task_id: f.started.task_id }); assert.equal(readiness.ok, true); assert.equal(readiness.approval_token_exposed, false); assert.equal(f.runtime.builds, 0);
  const submitted = await f.submit({}, 'accepted-submit'); assert.equal(submitted.task_state, 'completed', JSON.stringify(submitted));
  const fullHandle = submitted.presentation?.full_result_artifact;
  assert.ok(fullHandle, 'Detailed native readback is available through the fourth tool');
  let full = '', offset = 0;
  for (let page = 0; page < 200; page++) {
    const read = await call(f.bridge, 'read_agent_artifact', { task_id: f.started.task_id, handle: fullHandle, offset, max_chars: 1500 });
    full += read.result.artifact.content;
    if (read.result.artifact.eof) break;
    offset = read.result.artifact.next_offset;
  }
  assert.equal(full.includes(root), false, 'Paginated no-files result must not expose material, source or output paths');
  assert.equal(JSON.parse(full).result.saved, true);
  const saved = await f.task(); assert.equal(saved.result.saved, true); assert.equal(saved.result.quality_accepted, false); assert.equal(saved.result.cold_reopen_verified, false);
  assert.deepEqual(saved.private.appearance_execution.saved_state, f.runtime.state, 'Signed completion retains the actual post-save state.');
  const savedProof = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: f.bridge.taskStore, deliveryTaskId: f.started.task_id });
  assert.equal(isVerifiedModelAccessibilitySavedReceipt(savedProof), true);
  assert.equal(isVerifiedModelAccessibilitySavedReceipt(clone(savedProof)), false, 'Client JSON cannot reproduce the lifecycle brand.');
  assert.equal(savedProof.parameter_continuation_available, false);
  const reopened = await call(f.bridge, 'start_agent_task', { intent: 'reopen_delivered_model', instruction: 'Offline saved appearance lifecycle fixture only.', idempotency_key: 'reopen-saved-appearance', inputs: { runtime: 'queue', saved_delivery_task_id: f.started.task_id, connection_task_id: (await f.connect()).task_id } });
  assert.equal(reopened.task_state, 'completed', JSON.stringify(reopened));
  const reopenTask = await f.bridge.taskStore.getTask(reopened.task_id, { includePrivate: true });
  assert.equal(reopenTask.result.saved_source_kind, 'native_appearance');
  assert.equal(reopenTask.result.quality_accepted, false); assert.equal(reopenTask.result.parameter_rebound, false);
  assert.equal(reopenTask.result.document_close_reopen_verified, true); assert.equal(f.runtime.closes, 1);
  await call(f.bridge, 'resume_agent_task', { task_id: reopened.task_id }); assert.equal(f.runtime.closes, 1, 'Completed appearance reopen recovery cannot close again.');
  assert.equal(f.runtime.builds, 1); assert.equal(f.runtime.captures, 1); assert.equal(f.runtime.saves, 1);
  await call(new SketchUpBridge(f.options), 'resume_agent_task', { task_id: f.started.task_id });
  await call(f.bridge, 'start_agent_task', f.args); assert.equal(f.runtime.builds, 1); assert.equal(f.runtime.saves, 1);
  const missing = await fixture();
  const missingStarted = await call(missing.bridge, 'start_agent_task', { ...missing.args, idempotency_key: 'missing-appearance', inputs: { runtime: 'queue' } });
  assert.equal(missingStarted.task_state, 'awaiting_input');
  const originalInputs = clone((await missing.bridge.taskStore.getTask(missingStarted.task_id, { includePrivate: true })).inputs);
  for (const input of [{ action: 'inspect_revision_blockers' }, { kind: 'native_pbr', preset: 'wood', target: 'P', texture_size_mm: [750, 750], rotation: 30 }, { appearance: { ...pbr, bad_field: 'invalid' } }]) {
    const rejected = await call(missing.bridge, 'submit_agent_task_input', { task_id: missingStarted.task_id, idempotency_key: 'invalid-'+Object.keys(input).join('-'), input });
    assert.equal(rejected.error.code, 'INVALID_ARGUMENT');
    assert.deepEqual((await missing.bridge.taskStore.getTask(missingStarted.task_id, { includePrivate: true })).inputs, originalInputs, 'Rejected input cannot poison recovery state.');
    if (rejected.next_action.tool) validator.validate(rejected.next_action.tool, rejected.next_action.arguments);
  }
  const supplied = await call(missing.bridge, 'submit_agent_task_input', { task_id: missingStarted.task_id, idempotency_key: 'fill-appearance', input: { appearance: pbr } });
  assert.equal(supplied.task_state, 'awaiting_review'); assert.equal(supplied.task_id, missingStarted.task_id); assert.equal(missing.runtime.builds, 0);
  const incomplete = await fixture(); incomplete.runtime.current.model_revision_complete = false;
  const incompleteStart = await call(incomplete.bridge, 'start_agent_task', { ...incomplete.args, idempotency_key: 'incomplete-new-appearance' });
  assert.equal(incompleteStart.error.code, 'MODEL_REVISION_INCOMPLETE');
  validator.validate(incompleteStart.next_action.tool, incompleteStart.next_action.arguments);
  assert.deepEqual(incompleteStart.next_action.arguments.inputs, { topic: 'connect', runtime: 'queue' });
  incomplete.runtime.current.model_revision_complete = true;
  const repairedPreflight = await call(incomplete.bridge, 'submit_agent_task_input', { task_id: incompleteStart.task_id, idempotency_key: 'same-task-preflight-recovery', input: { appearance: pbr } });
  assert.equal(repairedPreflight.task_state, 'awaiting_review'); assert.equal(incomplete.runtime.builds, 0);
  const hf = await fixture(hdr); await hf.approve(); assert.equal((await hf.submit()).task_state, 'completed');
  const changed = await fixture(); await changed.approve(); changed.runtime.state.model_revision = revision(9);
  assert.equal((await changed.submit()).error.code, 'MODEL_REVISION_MISMATCH'); assert.equal(changed.runtime.builds, 0);
  const badUv = await fixture(); await badUv.approve(); badUv.runtime.badUv = true;
  assert.equal((await badUv.submit()).error.code, 'OPERATION_NOT_ALLOWED'); assert.equal(badUv.runtime.saves, 0);
  await call(badUv.bridge, 'resume_agent_task', { task_id: badUv.started.task_id }); assert.equal(badUv.runtime.builds, 1);
  for (const loss of ['loseBuild', 'loseSave']) {
    const uncertain = await fixture(); await uncertain.approve(); uncertain.runtime[loss] = true;
    const failed = await uncertain.submit(); assert.ok(failed.error); const builds = uncertain.runtime.builds, saves = uncertain.runtime.saves;
    const lostMetadata = await uncertain.task(); delete lostMetadata.private.appearance_execution;
    await uncertain.bridge.taskStore.update(uncertain.started.task_id, { private: lostMetadata.private });
    await call(new SketchUpBridge(uncertain.options), 'resume_agent_task', { task_id: uncertain.started.task_id });
    await uncertain.submit({}, `never-replay-${loss}`); assert.equal(uncertain.runtime.builds, builds); assert.equal(uncertain.runtime.saves, saves);
  }
  const interrupted = await fixture(); await interrupted.approve();
  const originalTransition = interrupted.bridge.taskStore.transition.bind(interrupted.bridge.taskStore); let once = true;
  interrupted.bridge.taskStore.transition = async (id, state, options) => { if (once && state === 'completed' && options?.reason === 'native_appearance_applied_and_saved') { once = false; throw new Error('Synthetic completion loss'); } return originalTransition(id, state, options); };
  assert.ok((await interrupted.submit()).error); interrupted.runtime.state.document_id = 'different-after-save';
  const lostReceiptMetadata = await interrupted.task(); delete lostReceiptMetadata.private.appearance_execution;
  await interrupted.bridge.taskStore.update(interrupted.started.task_id, { private: lostReceiptMetadata.private });
  assert.equal((await call(new SketchUpBridge(interrupted.options), 'resume_agent_task', { task_id: interrupted.started.task_id })).task_state, 'completed');
  assert.equal(interrupted.runtime.builds, 1); assert.equal(interrupted.runtime.saves, 1);
  const policy = await fixture(); await policy.approve();
  policy.bridge.executionPolicy.resource_limits.max_operations = 1;
  await assert.rejects(() => policy.bridge.verify_agent_task_authorization_ready({ task_id: policy.started.task_id }), error => error.code === 'POLICY_DENIED');
  assert.equal((await policy.submit()).error.code, 'POLICY_DENIED'); assert.equal(policy.runtime.builds, 0);
  const countPolicy = await fixture(); await countPolicy.approve(); countPolicy.bridge.executionPolicy.resource_limits.max_affected_instances = 1;
  assert.equal((await countPolicy.submit()).error.code, 'POLICY_DENIED'); assert.equal(countPolicy.runtime.builds, 0);
  const preflightPolicy = await fixture(); const limitedOptions = { ...preflightPolicy.options, executionPolicy: { ...preflightPolicy.options.executionPolicy, resource_limits: { max_operations: 1 } } };
  const limited = await call(new SketchUpBridge(limitedOptions), 'start_agent_task', { ...preflightPolicy.args, idempotency_key: 'limited-preflight' });
  assert.equal(limited.error.code, 'POLICY_DENIED'); assert.equal(preflightPolicy.runtime.builds, 0);
  const corrupt = await fixture(); const corruptTask = await corrupt.task(); corruptTask.private.appearance_plan.plan.style_name = 'forged';
  await corrupt.bridge.taskStore.update(corrupt.started.task_id, { private: corruptTask.private });
  await assert.rejects(() => corrupt.bridge.verify_agent_task_authorization_ready({ task_id: corrupt.started.task_id }), error => error.code === 'MUTATION_RECEIPT_INVALID');
  const tampered = await fixture(); await tampered.approve(); await fs.appendFile(style.path, 'tampered source');
  const rejected = await tampered.submit(); assert.ok(rejected.error); assert.equal(tampered.runtime.builds, 0, 'Changed style SHA is rejected before any native dispatch');
  console.log('model-accessibility-appearance: strict PBR/HDR compile, native-shaped UV/preservation failures, real authority/connection contracts, frozen review, four-tool routing, durable completion and uncertain no-replay passed. All injected offline fixtures; no actual native/approval-host/SKP acceptance.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
