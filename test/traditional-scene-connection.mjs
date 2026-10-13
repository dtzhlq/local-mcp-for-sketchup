import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256Canonical } from '../src/agent-contract.mjs';
import { buildModelGraph } from '../src/model-graph.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from '../src/model-identity.mjs';
import { compileModelAccessibilityTask } from '../src/model-accessibility-tasks.mjs';
import { captureDefinitionParameterSource } from '../src/model-accessibility-parameter-edit.mjs';
import { referenceTask } from '../src/traditional-timber/examples.mjs';
import { compileTraditionalScenePlan, verifyTraditionalScene } from '../src/traditional-timber/scene-plan.mjs';

// Isolated queue-shaped fault fixture. Geometry/view quality is never accepted
// here: test the actual scene source/connection persistence before live capture.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'traditional-scene-connection-'));
try {
  const plan = { version: 1, id: 'connection-fixture', units: 'mm', roots: [referenceTask('connection-reference')],
    view: { id: 'connection-overview', camera: { eye: [2000, -2000, 1500], target: [250, 250, 250], up: [0, 0, 1] } } };
  const scene = compileTraditionalScenePlan(plan), task = scene.jobs[0].task, bundle = compileModelAccessibilityTask(task).bundle;
  const root = bundle.dsl.operations.find(op => op.op === 'component_instance');
  const hash = 'sha256:' + 'a'.repeat(64);
  const row = { path: 'pid:1', entity_path: 'pid:1', parent_entity_path: null,
    path_segments: [{ entity_type: 'component_instance', persistent_id: '1', reference: root.id }],
    id: root.id, reference: root.id, persistent_id: '1', entity_type: 'component_instance', name: root.name,
    entity_definition_name: root.definition, entity_definition_persistent_id: '10', entity_definition_occurrence_count: 1,
    transformation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    bounding_box: { min: [0, 0, 0], max: [500, 500, 500], w: 500, d: 500, h: 500 },
    editable: true, edit_scope: 'instance_path', locked: false, visible: true,
    geometry_summary: { type: 'assembly_merkle', version: 1, subtree_digest: hash, expanded_count: 30, leaf_entities_materialized: false } };
  const adoption = { kind: 'adopt_open_model', runtime: 'queue', read_only: true, session_id: 'fixture-session', document_id: 'fixture-document',
    model_identity: { runtime_object_id: '500', model_guid: 'before-camera', source_path: null },
    model_revision: hash, model_revision_complete: true, model_revision_total_seen: 30, model_revision_indexed: 30,
    recursive: true, recursive_index: [row], recursive_root_paths: ['pid:1'], recursive_total_seen: 1, recursive_truncated: false,
    recursive_projection: 'assembly-merkle.v2', occurrence_contract: 'canonical-assembly-path.v2', assembly_summary_depth: 2, assembly_projection_complete: true,
    entities: [row], snapshot: { component_definitions: bundle.dsl.operations.filter(op => op.op === 'component_definition').map(op => op.name),
      groups: [], instances: [row], materials: [], tags: [], scenes: [] } };
  const modelKey = modelKeyForIdentity(modelIdentityForAdoption(adoption));
  const sourceId = 'task_11111111-1111-4111-8111-111111111111', verifyId = 'task_22222222-2222-4222-8222-222222222222';
  const identityMap = { [root.id]: root.id };
  const record = captureDefinitionParameterSource({ creationTaskId: sourceId, modelKey, modelGraph: buildModelGraph(adoption),
    sourceTask: task, identityMap, creationDocument: bundle.dsl });
  const sources = new Map([[sourceId, { task_id: sourceId, intent: 'create_model', inputs: { task }, private: { creation: {
    parameter_source: record, parameter_edit_support: { baseline_captured: true }, identity_map: identityMap } } }]]);
  const sign = async body => sha256Canonical({ fixture: 'not-a-native-authority', body });
  const state = { version: scene.version, scene_id: plan.id, scene_plan_hash: scene.scene_plan_hash, runtime: 'queue', plan,
    roots: [{ root_id: task.id, creation_task_id: sourceId }] };
  await fs.mkdir(path.join(directory, 'traditional-scenes-v1'));
  await fs.writeFile(path.join(directory, 'traditional-scenes-v1', plan.id + '.json'), JSON.stringify({ ...state, integrity_hmac: await sign(state) }));
  let connection = { runtime: 'queue', session_id: adoption.session_id, document_id: adoption.document_id, model_revision: hash,
    model_identity: { ...adoption.model_identity, model_guid: 'after-temporary-restoration' } };
  let captures = 0;
  const store = { rootDir: directory, mutationReceiptLedger: { sign }, getTask: async id => structuredClone(sources.get(id)),
    update: async (id, patch) => { const next = { ...sources.get(id), ...patch }; sources.set(id, next); return next; },
    transition: async (id, state) => store.update(id, { state }) };
  const gateway = { taskStore: store, bridge: { adopt_open_model: async () => structuredClone(adoption),
    create_queue_handshake: async () => ({ session_contract: structuredClone(connection) }) },
    finalizeCreationQuality: async t => { captures++; return store.update(t.task_id, { result: { quality_accepted: false, quality_status: 'unverified' } }); } };
  const freshTask = () => { const t = { task_id: verifyId, intent: 'verify_model', state: 'understanding', inputs: { runtime: 'queue', scene_id: plan.id, timeout_ms: 5000 }, private: {} }; sources.set(verifyId, t); return t; };
  const verified = await verifyTraditionalScene(gateway, freshTask());
  assert.deepEqual(verified.inputs.session_contract, connection);
  assert.equal(verified.private.traditional_scene_verification.model_key, modelKey);
  assert.equal(verified.private.traditional_scene_verification.model_revision, hash);
  assert.equal(verified.result.quality_accepted, false, 'synthetic source metadata is never native quality proof');
  await verifyTraditionalScene(gateway, verified); // Server-owned persisted fields survive resume.
  for (const change of [{ document_id: 'another-document' }, { session_id: 'another-session' }, { model_revision: 'sha256:' + 'b'.repeat(64) },
    { model_identity: { ...connection.model_identity, source_path: '/different/model.skp' } }]) {
    const original = connection; connection = { ...original, ...change };
    await assert.rejects(verifyTraditionalScene(gateway, freshTask()), error => error.code === 'MODEL_REVISION_MISMATCH');
    connection = original;
  }
  assert.equal(captures, 2, 'connection mismatch must block before any quality/capture finalization');
  const injected = freshTask(); injected.inputs.session_contract = connection;
  await assert.rejects(verifyTraditionalScene(gateway, injected), error => error.code === 'INVALID_ARGUMENT');
  console.log('Scene verification: trusted current connection persisted, GUID-only drift allowed, changed session/document/path/revision and caller connection rejected before capture.');
} finally { await fs.rm(directory, { recursive: true, force: true }); }
