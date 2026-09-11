import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SketchUpBridge } from '../src/bridge.mjs';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { MODEL_ACCESSIBILITY_DELIVERY_VERSION, readVerifiedModelAccessibilitySavedReceipt, isVerifiedModelAccessibilitySavedReceipt } from '../src/model-accessibility-delivery.mjs';
import { rebindDefinitionParameterSource } from '../src/model-accessibility-parameter-edit.mjs';
import { resumeSavedDefinitionParameterSource } from '../src/model-accessibility-parameter-reopen.mjs';
import { discoverParameterSources, indexSavedParameterSource, parameterSourceDocumentBinding } from '../src/model-accessibility-parameter-discovery.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'accessibility-parameter-reopen-'));
let checks = 0;
const check = fn => { fn(); checks++; };
const hasCode = code => error => error.code === code;
const config = { mock: { sessionPath: path.join(root, 'initial-session.json') }, agentContract: { rootDir: path.join(root, 'state') },
  approval: { stateDir: path.join(root, 'approval'), secret: 'saved-parameter-test-only-secret-over-32-bytes' } };
try {
  const bridge = new SketchUpBridge(config), store = bridge.taskStore;
  const taskInput = { version: 1, kind: 'cabinet', id: 'saved-cabinet', units: 'mm',
    parameters: { width_mm: 600, height_mm: 900, depth_mm: 600 }, placement: { origin_mm: [0, 0, 0] } };
  const created = await bridge.start_agent_task({ intent: 'create_model', instruction: 'Offline cabinet for saved-binding regression.', idempotency_key: 'create', inputs: { runtime: 'mock', task: taskInput } });
  let source = await store.getTask(created.task_id, { includePrivate: true });
  const record = source.private.creation.parameter_source;
  check(() => assert.equal(source.result.quality_accepted, false));
  check(() => assert.ok(record));
  const initial = await bridge.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true, recursive_limit: 5000 });
  const graph = buildModelGraph(initial);
  const destination = (await store.createTask({ intent: 'deliver_model', instruction: 'Offline signed-journal fixture only.',
    executionPolicy: bridge.executionPolicy, inputs: { runtime: 'queue', source_task_id: source.task_id } })).task;
  const directory = path.join(await fs.realpath(store.rootDir), 'model-deliveries-v1', destination.task_id);
  await fs.mkdir(path.dirname(directory), { mode: 0o700 }); await fs.mkdir(directory, { mode: 0o700 });
  const target = path.join(directory, 'model.skp');
  // This is a MockRuntime JSON artifact, not a native SKP. Authoring a signed
  // journal here tests the private persistence contract; production writes the
  // same journal only after its authorized native save (separately tested).
  await bridge.selectRuntime('mock').saveModel({ outputPath: target, keepSession: true });
  const bytes = await fs.readFile(target);
  const parameter_binding = { creation_task_id: source.task_id, source_record_hash: record.source_record_hash,
    model_key: record.model_key, runtime: record.runtime, parameter_revision: record.parameter_revision };
  const immutable = { version: MODEL_ACCESSIBILITY_DELIVERY_VERSION, delivery_task_id: destination.task_id,
    source_task_id: source.task_id, filename: 'model.skp', source_binding: { model_revision: graph.model_revision,
      frozen_specification_hash: source.private.creation.frozen_spec.hash } };
  const intent = { ...immutable, kind: 'save_intent', parameter_binding, before_identity: initial.model_identity };
  const receipt = { ...immutable, kind: 'saved_receipt', parameter_binding, save_confirmed: true,
    file: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
    post_save_revision: graph.model_revision, after_identity: { source_path: target }, save_intent_hash: sha256Canonical(intent) };
  const signed = async (name, body) => fs.writeFile(path.join(directory, name), JSON.stringify({ ...body, integrity_hmac: await store.mutationReceiptLedger.sign(body) }), { flag: 'wx' });
  await signed('save-intent.json', intent); await signed('saved-receipt.json', receipt);
  const proof = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: store, deliveryTaskId: destination.task_id });
  check(() => assert.equal(isVerifiedModelAccessibilitySavedReceipt(proof), true));
  check(() => assert.equal(isVerifiedModelAccessibilitySavedReceipt(structuredClone(proof)), false));
  await assert.rejects(() => indexSavedParameterSource({ taskStore: store, receipt: structuredClone(proof), deliveryTaskId: destination.task_id }), hasCode('ARTIFACT_INTEGRITY_ERROR')); checks++;
  await indexSavedParameterSource({ taskStore: store, receipt: proof, deliveryTaskId: destination.task_id });
  check(() => assert.throws(() => rebindDefinitionParameterSource({ sourceRecord: record, currentModelGraph: graph, modelKey: record.model_key, savedReceipt: receipt }), hasCode('ARTIFACT_INTEGRITY_ERROR')));

  // A fresh runtime loads only the persisted file into another mock session.
  const reopened = new SketchUpBridge({ ...config, mock: { sessionPath: path.join(root, 'reopened-session.json'), sourcePath: target } });
  await reopened.selectRuntime('mock').openModel({ inputPath: target });
  const adoption = await reopened.adopt_open_model({ runtime: 'mock', recursive: true, read_only: true, recursive_limit: 5000 });
  const reopenedGraph = buildModelGraph(adoption), nextKey = modelKeyForIdentity(modelIdentityForAdoption(adoption));
  check(() => assert.notEqual(nextKey, record.model_key));
  check(() => assert.equal(reopenedGraph.model_revision, graph.model_revision));
  const discoveredSaved = await discoverParameterSources({ gateway: reopened.agentGateway, runtime: 'mock' });
  check(() => assert.equal(discoveredSaved.sources.length, 0));
  check(() => assert.equal(discoveredSaved.saved_source_continuations[0].creation_task_id, source.task_id));
  check(() => assert.equal(discoveredSaved.saved_source_continuations[0].saved_delivery_task_id, destination.task_id));
  check(() => assert.equal(JSON.stringify(discoveredSaved).includes(root), false));
  const badPath = structuredClone(adoption); badPath.model_identity.source_path = path.join(root, 'another-copy.skp');
  await assert.rejects(() => resumeSavedDefinitionParameterSource({ gateway: reopened.agentGateway, sourceTask: source, deliveryTaskId: destination.task_id, adoption: badPath, modelGraph: reopenedGraph }), hasCode('MODEL_IDENTITY_MISMATCH')); checks++;
  const changedRevision = structuredClone(reopenedGraph); changedRevision.model_revision = `sha256:${'a'.repeat(64)}`;
  check(() => assert.throws(() => rebindDefinitionParameterSource({ sourceRecord: record, currentModelGraph: changedRevision, modelKey: nextKey, savedReceipt: proof }), hasCode('MODEL_REVISION_MISMATCH')));

  const args = { intent: 'modify_design_parameters', instruction: 'Change the saved cabinet width to 800 mm; retain 18 mm boards.',
    idempotency_key: 'after-reopen', inputs: { runtime: 'mock', saved_delivery_task_id: destination.task_id,
      parameter_edit: { creation_task_id: source.task_id, scope: 'single', targets: [record.entries[0].target], changes: { width_mm: 800 } } } };
  const unbound = structuredClone(args); delete unbound.inputs.saved_delivery_task_id; unbound.idempotency_key = 'missing-save-proof';
  const rejected = await reopened.start_agent_task(unbound);
  check(() => assert.equal(rejected.error.code, 'MODEL_IDENTITY_MISMATCH'));
  const started = await reopened.start_agent_task(args);
  check(() => assert.equal(started.error, null, JSON.stringify(started.error)));
  check(() => assert.equal(started.task_state, 'awaiting_review'));
  const parent = await store.getTask(started.task_id, { includePrivate: true });
  const child = await store.getTask(parent.private.parameter_execution.reviewed_task_id, { includePrivate: true });
  await reopened.approvalAuthority.recordTrustedDecision(child.result.approval_challenge, { decision: 'approved', user_id: 'offline-reviewer', channel: 'local-user-presence-test', confirmed: true });
  const completed = await reopened.submit_agent_task_input({ task_id: started.task_id, idempotency_key: 'apply-after-reopen', input: {} });
  check(() => assert.equal(completed.error, null, JSON.stringify(completed.error)));
  check(() => assert.equal(completed.task_state, 'completed'));
  const model = await reopened.selectRuntime('mock').readModel();
  check(() => assert.equal(model.instances[0].bounding_box.w, 800));
  check(() => assert.equal(model.component_definitions[model.instances[0].definition].groups.find(group => group.name === 'saved-cabinet-side-left').bounding_box.w, 18));
  source = await store.getTask(source.task_id, { includePrivate: true });
  check(() => assert.equal(source.private.creation.parameter_source.model_key, nextKey));
  check(() => assert.equal(source.private.creation.parameter_source.parameter_revision, 1));
  check(() => assert.equal(source.private.creation.parameter_source.identity_rebindings.length, 1));
  check(() => assert.equal(source.private.creation.frozen_spec.hash, immutable.source_binding.frozen_specification_hash));
  check(() => assert.equal(source.private.creation.parameter_edit_support.cold_reopen_verified, false));
  const discoveredRebound = await discoverParameterSources({ gateway: reopened.agentGateway, runtime: 'mock' });
  check(() => assert.equal(discoveredRebound.sources[0].creation_task_id, source.task_id));
  check(() => assert.equal(discoveredRebound.sources[0].parameter_revision, 1));
  check(() => assert.throws(() => rebindDefinitionParameterSource({ sourceRecord: source.private.creation.parameter_source, currentModelGraph: reopenedGraph, modelKey: nextKey, savedReceipt: proof }), hasCode('MODEL_REVISION_MISMATCH')));
  const unchangedSavedBytes = await fs.readFile(target);
  check(() => assert.deepEqual(unchangedSavedBytes, bytes, 'Parameter editing must not overwrite the saved source copy'));
  await fs.appendFile(target, 'changed bytes');
  await assert.rejects(() => readVerifiedModelAccessibilitySavedReceipt({ taskStore: store, deliveryTaskId: destination.task_id }), hasCode('ARTIFACT_INTEGRITY_ERROR')); checks++;

  // A persistent file path intentionally keeps the same model key across two
  // actual isolated mock document sessions. It does not authorize continuing
  // the source without a signed saved receipt for the new document identity.
  const samePath = path.join(root, 'same-path-mock-source.json');
  const samePathInitial = new SketchUpBridge({ ...config, mock: { sessionPath: path.join(root, 'same-path-initial.json'), sourcePath: samePath } });
  const samePathCreated = await samePathInitial.start_agent_task({ intent: 'create_model', instruction: 'Offline same-file document identity guard.',
    idempotency_key: 'same-path-create', inputs: { runtime: 'mock', task: { ...taskInput, id: 'same-path-cabinet' } } });
  const samePathSource = await store.getTask(samePathCreated.task_id, { includePrivate: true });
  check(() => assert.equal(samePathSource.private.creation.parameter_edit_support.baseline_captured, true));
  await samePathInitial.selectRuntime('mock').saveModel({ outputPath: samePath, keepSession: true });
  const samePathReopened = new SketchUpBridge({ ...config, mock: { sessionPath: path.join(root, 'same-path-new-document.json'), sourcePath: samePath } });
  await samePathReopened.selectRuntime('mock').openModel({ inputPath: samePath });
  const samePathAdoption = await samePathReopened.adopt_open_model({ runtime: 'mock', read_only: true, recursive: false });
  check(() => assert.equal(modelKeyForIdentity(modelIdentityForAdoption(samePathAdoption)), samePathSource.private.creation.parameter_source.model_key));
  check(() => assert.notEqual(parameterSourceDocumentBinding(samePathAdoption), samePathSource.private.creation.parameter_source_document_binding));
  const samePathDenied = await samePathReopened.start_agent_task({ intent: 'modify_design_parameters', instruction: 'Missing signed continuation proof must fail before staging.',
    idempotency_key: 'same-path-denied', inputs: { runtime: 'mock', parameter_edit: { creation_task_id: samePathCreated.task_id,
      scope: 'single', targets: [samePathSource.private.creation.parameter_source.entries[0].target], changes: { width_mm: 800 } } } });
  check(() => assert.equal(samePathDenied.error.code, 'MODEL_IDENTITY_MISMATCH'));
  const samePathDeniedTask = await store.getTask(samePathDenied.task_id, { includePrivate: true });
  check(() => assert.equal(samePathDeniedTask.private.parameter_execution, undefined));
  console.log(JSON.stringify({ ok: true, checks, runtime: 'isolated_mock_disk_roundtrip_only', native_skp: false, live_acceptance: false,
    verified: ['signed_saved_version', 'file_hash', 'exact_saved_path', 'no_client_brand', 'fresh_runtime_from_file', 'parameter_identity_rebind', 'reviewed_parameter_apply_after_reopen', 'fixed_board_thickness', 'stale_version_rejected'] }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
