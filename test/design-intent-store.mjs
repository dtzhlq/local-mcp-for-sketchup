import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { AgentContractError, sha256Canonical } from '../src/agent-contract.mjs';
import {
  DesignIntentStore,
  DESIGN_INTENT_STORE_VERSION
} from '../src/design-intent-store.mjs';
import {
  buildDesignIntentGraph,
  reconcileDesignIntentGraph
} from '../src/design-intent-graph.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alma-design-intent-store-'));
const modelA = `model_${'a'.repeat(32)}`;
const modelB = `model_${'b'.repeat(32)}`;
const modelConcurrent = `model_${'c'.repeat(32)}`;
const modelOrphan = `model_${'d'.repeat(32)}`;
const modelTamperedGraph = `model_${'e'.repeat(32)}`;
const modelTamperedManifest = `model_${'f'.repeat(32)}`;
const modelStaleLock = `model_${'1'.repeat(32)}`;
const modelActiveLock = `model_${'2'.repeat(32)}`;
const modelSensitive = `model_${'3'.repeat(32)}`;
const modelNaN = `model_${'4'.repeat(32)}`;
const modelInfinity = `model_${'5'.repeat(32)}`;

try {
  const store = new DesignIntentStore({ rootDir: root, lockTimeoutMs: 250, staleLockMs: 10 });
  const modelGraphV1 = modelGraphFixture({ revisionLabel: 'saved-model-v1', width: 900 });
  const graphV1 = designGraphFixture(modelGraphV1, { doorWidth: 900 });

  const first = await store.persist({ modelKey: modelA, graph: graphV1 });
  assert.equal(first.version_sequence, 1);
  assert.equal(first.version_count, 1);
  assert.equal(first.reused, false);
  assert.equal(first.current, true);
  assert.equal(first.manifest.version, DESIGN_INTENT_STORE_VERSION);
  assert.equal(first.manifest.versions[0].model_key, modelA);
  assert.equal(first.manifest.versions[0].source_model_graph_id, modelGraphV1.graph_id);
  assert.equal(first.manifest.versions[0].model_revision, modelGraphV1.model_revision);
  assert.deepEqual(first.manifest.privacy, {
    raw_external_paths_persisted: false,
    sensitive_identity_persisted: false
  });

  const replay = await store.persist({ modelKey: modelA, graph: graphV1 });
  assert.equal(replay.reused, true);
  assert.equal(replay.version_count, 1, 'replaying identical graph content must be idempotent');
  assert.equal(replay.reconciliation, null);

  const loadedV1 = await store.load(modelA, graphV1.design_graph_id);
  assert.deepEqual(loadedV1.graph, graphV1);
  assert.deepEqual((await store.loadCurrent(modelA)).graph, graphV1);
  const firstHistory = await store.history(modelA, { includeDocuments: true });
  assert.equal(firstHistory.version_count, 1);
  assert.deepEqual(firstHistory.versions[0].graph, graphV1);

  const graphB = designGraphFixture(modelGraphV1, { doorWidth: 900, modelKey: modelB });
  const isolated = await store.persist({ modelKey: modelB, graph: graphB });
  assert.equal(isolated.version_count, 1);
  assert.equal(isolated.manifest.model_key, modelB);
  assert.notEqual(store.manifestPath(modelA), store.manifestPath(modelB));
  assert.equal((await store.getManifest(modelA)).model_key, modelA);

  const modelGraphV2 = modelGraphFixture({ revisionLabel: 'saved-model-v2', width: 1200 });
  const reconciliation = reconcileDesignIntentGraph({ designGraph: graphV1, currentModelGraph: modelGraphV2 });
  assert.equal(reconciliation.review_required, true);
  const correctionEvent = {
    event_id: 'correction-reviewed-door-width-v2',
    at: '2026-07-16T00:00:00.000Z',
    decision: 'adopt_manual_edit',
    reconciliation_id: reconciliation.reconciliation_id,
    change_plan_id: null,
    previous_model_revision: modelGraphV1.model_revision,
    current_model_revision: modelGraphV2.model_revision
  };
  const graphV2 = designGraphFixture(modelGraphV2, {
    doorWidth: 1200,
    correctionHistory: [correctionEvent]
  });
  const second = await store.persist({
    modelKey: modelA,
    graph: graphV2,
    reconciliation
  });
  assert.equal(second.version_sequence, 2);
  assert.equal(second.version_count, 2);
  assert.equal(second.reconciliation.reused, false);
  assert.equal(second.manifest.reconciliation_count, 1);
  assert.equal(second.version.transition.kind, 'reconciliation_correction');
  assert.equal(second.version.transition.reconciliation_id, reconciliation.reconciliation_id);
  assert.deepEqual(second.version.history_delta.added_correction_event_ids, [correctionEvent.event_id]);
  assert.equal(second.version.history_delta.model_revision_changed, true);
  assert.ok(second.version.history_delta.changed_parameter_ids.includes('door_width_mm'));

  const reopenedGraph = designGraphFixture(structuredClone(modelGraphV2), {
    doorWidth: 1200,
    correctionHistory: [structuredClone(correctionEvent)]
  });
  assert.equal(reopenedGraph.design_graph_id, graphV2.design_graph_id, 'save/reopen must preserve deterministic DesignIntent lineage');
  const alignedReconciliation = reconcileDesignIntentGraph({ designGraph: reopenedGraph, currentModelGraph: structuredClone(modelGraphV2) });
  assert.equal(alignedReconciliation.aligned, true);
  const reopenReplay = await store.persist({
    modelKey: modelA,
    graph: reopenedGraph,
    reconciliation: alignedReconciliation
  });
  assert.equal(reopenReplay.reused, true);
  assert.equal(reopenReplay.version_count, 2);
  assert.equal(reopenReplay.reconciliation.reused, false);
  assert.equal(reopenReplay.manifest.reconciliation_count, 2, 'reconciliation observations have an independent append-only journal');

  const reopenedStore = new DesignIntentStore({ rootDir: root });
  const reopenedCurrent = await reopenedStore.loadCurrent(modelA);
  assert.equal(reopenedCurrent.graph.design_graph_id, graphV2.design_graph_id);
  assert.deepEqual(reopenedCurrent.graph.correction_history, [correctionEvent]);
  assert.equal(reopenedCurrent.graph.bindings[0].persistent_ref.target_id, 'main-door');
  const completeHistory = await reopenedStore.history(modelA, { includeDocuments: true });
  assert.equal(completeHistory.version_count, 2);
  assert.equal(completeHistory.reconciliation_count, 2);
  assert.equal(completeHistory.reconciliation_history[0].reconciliation.reconciliation_id, reconciliation.reconciliation_id);
  assert.equal((await reopenedStore.loadReconciliation(modelA, alignedReconciliation.reconciliation_id)).reconciliation.aligned, true);

  const rewrittenEvent = { ...correctionEvent, decision: 'restore_design_intent' };
  const invalidHistoryGraph = designGraphFixture(modelGraphFixture({ revisionLabel: 'saved-model-v3', width: 1250 }), {
    doorWidth: 1250,
    correctionHistory: [rewrittenEvent]
  });
  await assert.rejects(
    store.persist({ modelKey: modelA, graph: invalidHistoryGraph }),
    (error) => error instanceof AgentContractError
      && error.code === 'INVALID_ARGUMENT'
      && /append-only|rewrite/.test(error.message),
    'an existing correction event cannot be rewritten'
  );

  const concurrentStoreA = new DesignIntentStore({ rootDir: root, lockTimeoutMs: 1000 });
  const concurrentStoreB = new DesignIntentStore({ rootDir: root, lockTimeoutMs: 1000 });
  const concurrentGraph = designGraphFixture(modelGraphV1, { doorWidth: 900, modelKey: modelConcurrent });
  const concurrentResults = await Promise.all([
    concurrentStoreA.persist({ modelKey: modelConcurrent, graph: concurrentGraph }),
    concurrentStoreB.persist({ modelKey: modelConcurrent, graph: concurrentGraph })
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.version_count), [1, 1]);
  assert.equal(concurrentResults.filter((result) => result.reused).length, 1);
  assert.equal((await concurrentStoreA.history(modelConcurrent)).version_count, 1);

  const orphanGraph = designGraphFixture(modelGraphV1, { doorWidth: 900, modelKey: modelOrphan });
  await fs.mkdir(store.graphsDir(modelOrphan), { recursive: true });
  await fs.writeFile(store.graphPath(modelOrphan, orphanGraph.design_graph_id), '{partial-json', 'utf8');
  const recoveredOrphan = await store.persist({ modelKey: modelOrphan, graph: orphanGraph });
  assert.equal(recoveredOrphan.version_count, 1, 'an unreferenced partial artifact must be recoverable after restart');
  assert.deepEqual((await store.loadCurrent(modelOrphan)).graph, orphanGraph);
  await fs.rm(store.graphPath(modelOrphan, orphanGraph.design_graph_id));
  await assert.rejects(
    store.getManifest(modelOrphan),
    (error) => error instanceof AgentContractError && error.code === 'MODEL_GRAPH_INTEGRITY_ERROR',
    'a manifest-referenced missing artifact must fail closed as an integrity error'
  );

  const staleStore = new DesignIntentStore({ rootDir: root, lockTimeoutMs: 250, staleLockMs: 5 });
  await fs.mkdir(staleStore.modelDir(modelStaleLock), { recursive: true });
  await fs.writeFile(path.join(staleStore.modelDir(modelStaleLock), '.store.lock'), `${JSON.stringify({
    owner: 'dead-process-owner',
    pid: 99999999,
    created_at: '2000-01-01T00:00:00.000Z'
  })}\n`, 'utf8');
  const staleLockGraph = designGraphFixture(modelGraphV1, { doorWidth: 900, modelKey: modelStaleLock });
  const staleRecovered = await staleStore.persist({ modelKey: modelStaleLock, graph: staleLockGraph });
  assert.equal(staleRecovered.version_count, 1);
  await assert.rejects(fs.stat(path.join(staleStore.modelDir(modelStaleLock), '.store.lock')), { code: 'ENOENT' });

  const activeStore = new DesignIntentStore({ rootDir: root, lockTimeoutMs: 40, staleLockMs: 5 });
  await fs.mkdir(activeStore.modelDir(modelActiveLock), { recursive: true });
  const activeLockPath = path.join(activeStore.modelDir(modelActiveLock), '.store.lock');
  await fs.writeFile(activeLockPath, `${JSON.stringify({
    owner: 'live-process-owner',
    pid: process.pid,
    created_at: '2000-01-01T00:00:00.000Z'
  })}\n`, 'utf8');
  await assert.rejects(
    activeStore.persist({
      modelKey: modelActiveLock,
      graph: designGraphFixture(modelGraphV1, { doorWidth: 900, modelKey: modelActiveLock })
    }),
    (error) => error instanceof AgentContractError && error.code === 'TASK_STATE_CONFLICT'
  );
  assert.equal(JSON.parse(await fs.readFile(activeLockPath, 'utf8')).owner, 'live-process-owner');
  await fs.rm(activeLockPath);

  const graphForTamperedGraph = designGraphFixture(modelGraphV1, { doorWidth: 900, modelKey: modelTamperedGraph });
  await store.persist({ modelKey: modelTamperedGraph, graph: graphForTamperedGraph });
  const tamperedGraphPath = store.graphPath(modelTamperedGraph, graphForTamperedGraph.design_graph_id);
  const tamperedGraph = JSON.parse(await fs.readFile(tamperedGraphPath, 'utf8'));
  tamperedGraph.parameters.door_width_mm.value = 9999;
  await fs.writeFile(tamperedGraphPath, `${JSON.stringify(tamperedGraph, null, 2)}\n`, 'utf8');
  await assert.rejects(
    store.loadCurrent(modelTamperedGraph),
    (error) => error instanceof AgentContractError && error.code === 'MODEL_GRAPH_INTEGRITY_ERROR'
  );

  const graphForTamperedManifest = designGraphFixture(modelGraphV1, { doorWidth: 900, modelKey: modelTamperedManifest });
  await store.persist({ modelKey: modelTamperedManifest, graph: graphForTamperedManifest });
  const tamperedManifestPath = store.manifestPath(modelTamperedManifest);
  const tamperedManifest = JSON.parse(await fs.readFile(tamperedManifestPath, 'utf8'));
  tamperedManifest.versions[0].history_delta.changed_parameter_ids = [];
  await fs.writeFile(tamperedManifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, 'utf8');
  await assert.rejects(
    store.getManifest(modelTamperedManifest),
    (error) => error instanceof AgentContractError && error.code === 'MODEL_GRAPH_INTEGRITY_ERROR'
  );

  const sensitiveGraph = designGraphFixture(modelGraphV1, {
    doorWidth: 900,
    modelKey: modelSensitive,
    lineage: { source_path: '/Users/example/private/design-source.json', model_guid: 'raw-guid-must-not-persist' }
  });
  await assert.rejects(
    store.persist({ modelKey: modelSensitive, graph: sensitiveGraph }),
    (error) => error instanceof AgentContractError
      && error.code === 'INVALID_ARGUMENT'
      && /raw paths|sensitive identity/.test(error.message)
  );
  await assert.rejects(fs.stat(store.manifestPath(modelSensitive)), { code: 'ENOENT' });

  for (const [modelKey, value] of [[modelNaN, Number.NaN], [modelInfinity, Number.POSITIVE_INFINITY]]) {
    const nonFiniteGraph = designGraphFixture(modelGraphV1, { doorWidth: value, modelKey });
    await assert.rejects(
      store.persist({ modelKey, graph: nonFiniteGraph }),
      (error) => error instanceof AgentContractError
        && error.code === 'INVALID_ARGUMENT'
        && /finite numbers/.test(error.message),
      'non-finite numeric values must fail before JSON serialization can coerce them to null'
    );
    await assert.rejects(fs.stat(store.manifestPath(modelKey)), { code: 'ENOENT' });
  }

  await assert.rejects(
    store.getManifest(`model_${'9'.repeat(32)}`),
    (error) => error instanceof AgentContractError && error.code === 'ARTIFACT_NOT_FOUND'
  );

  const persistedText = [
    await fs.readFile(store.manifestPath(modelA), 'utf8'),
    await fs.readFile(store.graphPath(modelA, graphV2.design_graph_id), 'utf8')
  ].join('\n');
  assert.equal(persistedText.includes('/Users/'), false);
  assert.equal(persistedText.includes('raw-guid'), false);

  const schema = JSON.parse(await fs.readFile(path.resolve('schema/design-intent-store-v1.schema.json'), 'utf8'));
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
  assert.equal(ajv.validate(schema, (await store.getManifest(modelA))), true, JSON.stringify(ajv.errors));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    version: DESIGN_INTENT_STORE_VERSION,
    runtime: 'mock-only-no-queue',
    version_count: 2,
    reconciliation_count: 2,
    atomic_immutable_artifacts: true,
    manifest_chain_verified: true,
    correction_history_append_only: true,
    save_reopen_lineage_stable: true,
    concurrent_idempotency: true,
    stale_lock_recovery: true,
    partial_artifact_recovery: true,
    tamper_fail_closed: true,
    model_isolation: true,
    raw_external_paths_persisted: false,
    sensitive_identity_persisted: false,
    non_finite_numbers_rejected: true
  }, null, 2)}\n`);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function modelGraphFixture({ revisionLabel, width }) {
  const modelRevision = sha256Canonical({ revisionLabel, width });
  const core = {
    version: 'model-graph.v1',
    kind: 'model_graph',
    runtime: 'mock',
    model_revision: modelRevision,
    nodes: [{
      node_id: `node_${sha256Canonical({ revisionLabel, target: 'main-door' }).slice(7, 31)}`,
      node_type: 'occurrence',
      parent_id: null,
      entity_type: 'Group',
      reference: 'main-door',
      persistent_id: '1001',
      entity_path: 'pid:1001',
      edit_scope: 'top_level',
      definition_name: null,
      material: null,
      tag: 'Untagged',
      classification: {},
      attributes: {},
      visible: true,
      bounding_box: { x: 0, y: 0, z: 0, w: width, d: 160, h: 2100 },
      topology_summary: { faces: 6, edges: 12 },
      features: []
    }]
  };
  return {
    ...core,
    graph_id: `model-graph-${sha256Canonical(core).slice(7, 31)}`
  };
}

function designGraphFixture(modelGraph, { doorWidth, correctionHistory = [], lineage = {}, modelKey = modelA }) {
  return buildDesignIntentGraph({
    modelKey,
    modelGraph,
    parametricRecipe: {
      version: 1,
      id: 'architecture-door-recipe',
      parameters: [{
        id: 'door_width_mm',
        value: doorWidth,
        type: 'number',
        unit: 'mm',
        minimum: 700,
        maximum: 1800
      }]
    },
    featureMappingPlan: { version: 1, id: 'architecture-door-mapping' },
    partGraph: { version: 1, id: 'architecture-door-parts', parts: [{ id: 'main-door' }] },
    entityBindings: [{
      binding_id: 'main-door-width-binding',
      part_id: 'main-door',
      feature_id: 'door-width',
      entity: { target_id: 'main-door' },
      parameter_bindings: ['door_width_mm'],
      existing_targets: [{ target_id: 'main-door' }],
      rebuild_template: [{
        op: 'box',
        id: 'main-door',
        origin: [0, 0, 0],
        size: [{ $parameter: 'door_width_mm' }, 160, 2100]
      }],
      lineage
    }],
    correctionHistory
  });
}
