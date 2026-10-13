import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { freezeDetailSpecification } from '../src/detail-quality.mjs';
import { compileModelAccessibilityTask } from '../src/model-accessibility-tasks.mjs';
import { captureDefinitionParameterSource, rebindDefinitionParameterSource } from '../src/model-accessibility-parameter-edit.mjs';
import { discoverParameterSources, indexSavedParameterSource, indexCapturedParameterSource, parameterSourceDocumentBinding } from '../src/model-accessibility-parameter-discovery.mjs';
import { deliverModelAccessibilityTask, readVerifiedModelAccessibilitySavedReceipt, savedParameterBindingForSource } from '../src/model-accessibility-delivery.mjs';
import { referenceTask } from '../src/traditional-timber/examples.mjs';
import { compileTraditionalScenePlan } from '../src/traditional-timber/scene-plan.mjs';
import { resumeSavedDefinitionParameterSource } from '../src/model-accessibility-parameter-reopen.mjs';

// An isolated queue-shaped fixture exercises signed provenance, indexing and
// identity protection. Its bytes and quality metadata are never native proof.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-saved-sources-'));
try {
  const ids = [1, 2, 3, 4].map(n => `task_${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`);
  const [firstId, secondId, verifyId, deliveryId] = ids;
  const plan = { version: 1, id: 'saved-source-fixture', units: 'mm', roots: [referenceTask('saved-first'), referenceTask('saved-second')],
    view: { id: 'saved-overview', camera: { eye: [2000, -2000, 1500], target: [250, 250, 250], up: [0, 0, 1] } } };
  const scene = compileTraditionalScenePlan(plan), revision = 'sha256:' + 'a'.repeat(64);
  const bundles = scene.jobs.map(job => compileModelAccessibilityTask(job.task).bundle);
  const rows = bundles.map((bundle, i) => {
    const root = bundle.dsl.operations.find(op => op.op === 'component_instance');
    return { path: `pid:${i + 1}`, entity_path: `pid:${i + 1}`, parent_entity_path: null,
      path_segments: [{ entity_type: 'component_instance', persistent_id: String(i + 1), reference: root.id }],
      id: root.id, reference: root.id, persistent_id: String(i + 1), entity_type: 'component_instance', name: root.name,
      entity_definition_name: root.definition, entity_definition_persistent_id: String(i + 10), entity_definition_occurrence_count: 1,
      transformation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      bounding_box: { min: [0, 0, 0], max: [500, 500, 500], w: 500, d: 500, h: 500 },
      editable: true, edit_scope: 'instance_path', locked: false, visible: true,
      geometry_summary: { type: 'assembly_merkle', version: 1, subtree_digest: revision, expanded_count: 30, leaf_entities_materialized: false } };
  });
  const adoption = { kind: 'adopt_open_model', runtime: 'queue', read_only: true, session_id: 'fixture-session', document_id: 'fixture-document',
    model_identity: { runtime_object_id: '500', model_guid: 'fixture-guid', source_path: null },
    model_revision: revision, model_revision_complete: true, model_revision_total_seen: 60, model_revision_indexed: 60,
    recursive: true, recursive_index: rows, recursive_root_paths: ['pid:1', 'pid:2'], recursive_total_seen: 2, recursive_truncated: false,
    recursive_projection: 'assembly-merkle.v2', occurrence_contract: 'canonical-assembly-path.v2', assembly_summary_depth: 2, assembly_projection_complete: true,
    entities: rows, snapshot: { component_definitions: bundles.flatMap(bundle => bundle.dsl.operations.filter(op => op.op === 'component_definition').map(op => op.name)),
      groups: [], instances: rows, materials: [], tags: [], scenes: [] } };
  const modelKey = modelKeyForIdentity(modelIdentityForAdoption(adoption)), graph = buildModelGraph(adoption), tasks = new Map();
  for (let i = 0; i < 2; i++) {
    const bundle = bundles[i], task = scene.jobs[i].task, root = bundle.dsl.operations.find(op => op.op === 'component_instance');
    const record = captureDefinitionParameterSource({ creationTaskId: ids[i], modelKey, modelGraph: graph, sourceTask: task,
      identityMap: { [root.id]: root.id }, creationDocument: bundle.dsl });
    tasks.set(ids[i], { task_id: ids[i], intent: 'create_model', inputs: { task }, private: { creation: {
      parameter_source: record, frozen_spec: freezeDetailSpecification(bundle.detail_spec),
      parameter_source_document_binding: parameterSourceDocumentBinding(adoption), parameter_edit_support: { baseline_captured: true } } } });
  }
  const sign = async body => sha256Canonical({ fixture: 'not-a-native-authority', body });
  const state = { version: scene.version, scene_id: plan.id, scene_plan_hash: scene.scene_plan_hash, runtime: 'queue', plan,
    roots: ids.slice(0, 2).map((id, i) => ({ root_id: scene.jobs[i].root_id, creation_task_id: id })) };
  await fs.mkdir(path.join(directory, 'traditional-scenes-v1'));
  await fs.writeFile(path.join(directory, 'traditional-scenes-v1', plan.id + '.json'), JSON.stringify({ ...state, integrity_hmac: await sign(state) }));
  const frozen = freezeDetailSpecification({ version: 1, required_parts: [{ id: 'fixture-scene' }], required_views: [] });
  const quality = { quality_status: 'pass', quality_accepted: true, evidence_level: 'live_runtime', remaining: [], specification_hash: frozen.hash };
  const connection = { runtime: 'queue', session_id: adoption.session_id, document_id: adoption.document_id,
    model_identity: structuredClone(adoption.model_identity), model_revision: revision };
  const proof = { version: 'traditional-scene-verification.v1', scene_id: plan.id, scene_plan_hash: scene.scene_plan_hash,
    specification_hash: frozen.hash, model_revision: revision, model_key: modelKey,
    members: ids.slice(0, 2).map(id => ({ creation_task_id: id, source_record_hash: tasks.get(id).private.creation.parameter_source.source_record_hash })) };
  tasks.set(verifyId, { task_id: verifyId, intent: 'verify_model', state: 'completed', inputs: { session_contract: connection },
    private: { traditional_scene_verification: { ...proof, integrity_hmac: await sign(proof) }, creation: {
      runtime: 'queue', frozen_spec: frozen, round: { snapshot: { model_revision: revision, model_revision_complete: true } } } },
    result: { kind: 'verify_scene_result', ...quality, quality, snapshot: { model_revision: revision } } });
  tasks.set(deliveryId, { task_id: deliveryId, intent: 'deliver_model', inputs: { source_task_id: verifyId, runtime: 'queue', session_contract: connection } });
  let failSecondUpdate = false;
  const store = { rootDir: directory, mutationReceiptLedger: { sign }, getTask: async id => structuredClone(tasks.get(id)),
    update: async (id, patch) => {
      if (failSecondUpdate && id === secondId) { failSecondUpdate = false; throw new Error('fixture metadata write interruption'); }
      tasks.set(id, { ...tasks.get(id), ...structuredClone(patch) }); return structuredClone(tasks.get(id));
    },
    registerArtifact: async () => ({ id: 'fixture-artifact' }) };
  let current = { ...connection, model_revision_complete: true }, saves = 0;
  const bridge = { sessionContractAuthority: { verify: async () => {} }, create_queue_handshake: async () => ({ session_contract: connection }),
    withAgentGatewayExecution: async (_, callback) => callback({ withLiveMutationAuthorization: async (_, callback) => callback({
      selectRuntime: () => ({ getSessionState: async () => current }), save_model: async ({ path: target }) => {
        saves++; await fs.writeFile(target, 'fixture bytes: not a native SKP');
        current = { ...current, model_identity: { ...current.model_identity, source_path: target } }; return { file_path: target };
      }
    }) }) };
  const saved = await deliverModelAccessibilityTask({ bridge, taskStore: store, taskId: deliveryId, sourceTaskId: verifyId, sessionContract: connection });
  assert.equal(saved.parameter_source_discovery.available, true);
  const receipt = await readVerifiedModelAccessibilitySavedReceipt({ taskStore: store, deliveryTaskId: deliveryId });
  const originalChildren = ids.slice(0, 2).map(id => structuredClone(tasks.get(id)));
  assert.equal(receipt.scene_parameter_bindings.length, 2);
  assert.equal(receipt.parameter_binding, undefined);
  assert.equal(savedParameterBindingForSource(receipt, firstId).source_record_hash, proof.members[0].source_record_hash);
  assert.equal(savedParameterBindingForSource(receipt, verifyId), null, 'aggregate verification is not a child parameter baseline');
  assert.throws(() => savedParameterBindingForSource(structuredClone(receipt), firstId), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  const reopened = { ...adoption, model_identity: current.model_identity };
  const gateway = { taskStore: store, bridge: { adopt_open_model: async () => reopened } };
  let discovery = await discoverParameterSources({ gateway, runtime: 'queue' });
  assert.deepEqual(discovery.saved_source_continuations.map(item => item.creation_task_id).sort(), [firstId, secondId].sort());
  assert.equal((await discoverParameterSources({ gateway, runtime: 'queue', query: 'second' })).saved_source_continuations.length, 1);
  const first = tasks.get(firstId), newModelKey = modelKeyForIdentity(modelIdentityForAdoption(reopened)), currentGraph = buildModelGraph(reopened);
  const rebound = rebindDefinitionParameterSource({ sourceRecord: first.private.creation.parameter_source, currentModelGraph: currentGraph, modelKey: newModelKey, savedReceipt: receipt });
  first.private.creation.parameter_source = rebound;
  first.private.creation.parameter_source_document_binding = parameterSourceDocumentBinding(reopened);
  await indexCapturedParameterSource({ taskStore: store, task: first });
  discovery = await discoverParameterSources({ gateway, runtime: 'queue' });
  assert.equal(discovery.sources.length, 1);
  assert.deepEqual(discovery.saved_source_continuations.map(item => item.creation_task_id), [secondId], 'rebinding one child must not hide the other saved source');
  const second = tasks.get(secondId).private.creation.parameter_source;
  assert.throws(() => rebindDefinitionParameterSource({ sourceRecord: second, currentModelGraph: { ...currentGraph, model_revision: 'sha256:' + 'b'.repeat(64) }, modelKey: newModelKey, savedReceipt: receipt }), error => error.code === 'MODEL_REVISION_MISMATCH');
  const changed = structuredClone(reopened); changed.recursive_index[1].geometry_summary.subtree_digest = 'sha256:' + 'c'.repeat(64);
  assert.throws(() => rebindDefinitionParameterSource({ sourceRecord: second, currentModelGraph: buildModelGraph(changed), modelKey: newModelKey, savedReceipt: receipt }), error => error.code === 'MODEL_REVISION_MISMATCH');

  // Before a saved scene's first scoped edit, migrate all unchanged child
  // identities together. The caller initially covers only its selected root.
  for (const child of originalChildren) tasks.set(child.task_id, structuredClone(child));
  const selected = { ...reopened, entities: [reopened.entities[0]], recursive_index: [reopened.recursive_index[0]], recursive_root_paths: ['pid:1'], recursive_total_seen: 1 };
  const selectedGraph = buildModelGraph(selected);
  let fullReads = 0;
  gateway.bridge.adopt_open_model = async request => {
    if (request.recursive) { fullReads++; assert.equal(request.read_only, true); assert.deepEqual(request.recursive_roots, ['pid:1', 'pid:2']); }
    return reopened;
  };
  const continueScene = () => resumeSavedDefinitionParameterSource({ gateway, sourceTask: structuredClone(tasks.get(firstId)),
    deliveryTaskId: deliveryId, adoption: selected, modelGraph: selectedGraph });
  await assert.rejects(resumeSavedDefinitionParameterSource({ gateway, sourceTask: tasks.get(firstId), deliveryTaskId: deliveryId,
    adoption: selected, modelGraph: { ...selectedGraph, model_revision: 'sha256:' + 'e'.repeat(64) } }), error => error.code === 'MODEL_REVISION_MISMATCH');
  assert.equal(fullReads, 0, 'Changed full revision is rejected before rebinding any source.');
  gateway.bridge.adopt_open_model = async () => changed;
  await assert.rejects(continueScene(), error => error.code === 'MODEL_REVISION_MISMATCH');
  assert.equal(tasks.get(firstId).private.creation.parameter_source.source_record_hash, originalChildren[0].private.creation.parameter_source.source_record_hash,
    'Validate every member before updating any source.');
  gateway.bridge.adopt_open_model = async request => { if (request.recursive) { fullReads++; assert.equal(request.read_only, true); assert.deepEqual(request.recursive_roots, ['pid:1', 'pid:2']); } return reopened; };
  failSecondUpdate = true;
  await assert.rejects(continueScene(), /fixture metadata write interruption/);
  assert.equal(tasks.get(firstId).private.creation.saved_scene_identity_rebinding.pending, true);
  assert.equal(tasks.get(secondId).private.creation.parameter_source.model_key, modelKey);
  assert.equal(tasks.get(verifyId).private.saved_scene_identity_rebindings, undefined);
  const resumed = await continueScene();
  assert.equal(resumed.model_key, newModelKey);
  for (const id of [firstId, secondId]) {
    assert.equal(tasks.get(id).private.creation.parameter_source.model_key, newModelKey);
    assert.equal(tasks.get(id).private.creation.saved_scene_identity_rebinding.pending, false);
    assert.equal(tasks.get(id).private.creation.parameter_edit_support.cold_reopen_verified, false);
  }
  discovery = await discoverParameterSources({ gateway, runtime: 'queue' });
  assert.equal(discovery.sources.length, 2); assert.equal(discovery.saved_source_continuations.length, 0);
  assert.equal(fullReads, 2, 'Partial metadata retry obtains a fresh unchanged all-root summary.');
  assert.equal(saves, 1, 'Identity migration and its retry never write model geometry or save again.');
  // Clearing a pending checkpoint after durable group completion can resume
  // even after an unrelated root edit changes the global revision. The selected
  // subtree still has to match; the completed group proof cannot excuse drift.
  const pending = tasks.get(firstId).private.creation.saved_scene_identity_rebinding;
  const { integrity_hmac: checkpointSignature, ...pendingBody } = pending;
  tasks.get(firstId).private.creation.saved_scene_identity_rebinding = { ...pendingBody, pending: true,
    integrity_hmac: await sign({ ...pendingBody, pending: true }) };
  const laterGraph = { ...selectedGraph, model_revision: 'sha256:' + 'f'.repeat(64) };
  await resumeSavedDefinitionParameterSource({ gateway, sourceTask: tasks.get(firstId), deliveryTaskId: deliveryId, adoption: selected, modelGraph: laterGraph });
  assert.equal(tasks.get(firstId).private.creation.saved_scene_identity_rebinding.pending, false);
  assert.equal(fullReads, 2, 'A signed durable group checkpoint avoids replaying a completed identity migration.');
  const changedSelected = structuredClone(selected); changedSelected.recursive_index[0].geometry_summary.subtree_digest = 'sha256:' + 'c'.repeat(64);
  await assert.rejects(resumeSavedDefinitionParameterSource({ gateway, sourceTask: tasks.get(firstId), deliveryTaskId: deliveryId,
    adoption: changedSelected, modelGraph: buildModelGraph(changedSelected) }), error => error.code === 'MODEL_REVISION_MISMATCH');
  const receiptPath = path.join(directory, 'model-deliveries-v1', deliveryId, 'saved-receipt.json');
  const rawReceipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  const { integrity_hmac, ...tampered } = rawReceipt; tampered.scene_parameter_bindings[1].source_record_hash = 'sha256:' + 'd'.repeat(64);
  await fs.writeFile(receiptPath, JSON.stringify({ ...tampered, integrity_hmac: await sign(tampered) }));
  await assert.rejects(readVerifiedModelAccessibilitySavedReceipt({ taskStore: store, deliveryTaskId: deliveryId }), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  await assert.rejects(deliverModelAccessibilityTask({ bridge, taskStore: store, taskId: deliveryId, sourceTaskId: verifyId, sessionContract: connection }), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  assert.equal(saves, 1, 'discovery and provenance checks never repeat a save');
  await assert.rejects(indexSavedParameterSource({ taskStore: store, receipt: structuredClone(receipt), deliveryTaskId: deliveryId }), error => error.code === 'ARTIFACT_INTEGRITY_ERROR');
  console.log('Saved scene sources: signed child bindings, selective discovery, complete scene identity migration, interrupted metadata recovery and revision/subtree/receipt protection passed (isolated fixture).');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
