import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';
import { defaultStateDir } from './paths.mjs';

export const DESIGN_INTENT_STORE_VERSION = 'design-intent-store.v1';

const MODEL_KEY_PATTERN = /^model_[0-9a-f]{32}$/;
const DESIGN_GRAPH_ID_PATTERN = /^design-graph-[0-9a-f]{24}$/;
const MODEL_GRAPH_ID_PATTERN = /^model-graph-[0-9a-f]{24}$/;
const RECONCILIATION_ID_PATTERN = /^reconciliation-[0-9a-f]{24}$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const EVENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const DESIGN_GRAPH_KEYS = new Set([
  'version',
  'kind',
  'model_key',
  'source_model_graph_id',
  'model_revision',
  'artifacts',
  'parameters',
  'bindings',
  'relationships',
  'bidirectional',
  'correction_history',
  'divergence_policy',
  'untrusted_data_fields',
  'design_graph_id',
  'stats'
]);
const REQUIRED_UNTRUSTED_FIELDS = new Set(['model_entity_name', 'material', 'tag', 'classification', 'attributes', 'ocr']);

/**
 * Durable, model-scoped storage for DesignIntentGraph and FeatureHistory data.
 *
 * The store deliberately accepts a server-derived model_key rather than raw model
 * identity. Neither model paths nor identity values are written to this store.
 */
export class DesignIntentStore {
  constructor({
    rootDir = path.join(defaultStateDir, 'design-intent-v1'),
    lockTimeoutMs = 5000,
    staleLockMs = 30_000
  } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.modelsDir = path.join(this.rootDir, 'models');
    this.lockTimeoutMs = positiveInteger(lockTimeoutMs, 5000);
    this.staleLockMs = positiveInteger(staleLockMs, 30_000);
  }

  async persist({ modelKey, graph, sourceTaskId = null, reconciliation = null } = {}) {
    assertModelKey(modelKey);
    assertDesignGraph(graph, modelKey);
    assertPersistablePayload(graph);
    const normalizedTaskId = normalizeTaskId(sourceTaskId);
    if (reconciliation !== null) {
      assertReconciliation(reconciliation, modelKey);
      assertPersistablePayload(reconciliation);
    }

    const modelDir = this.modelDir(modelKey);
    await Promise.all([
      fs.mkdir(this.graphsDir(modelKey), { recursive: true, mode: 0o700 }),
      fs.mkdir(this.reconciliationsDir(modelKey), { recursive: true, mode: 0o700 })
    ]);

    return this.withModelLock(modelKey, async () => {
      const manifestPath = this.manifestPath(modelKey);
      const existingManifest = await readManifestIfPresent(manifestPath, modelKey);
      if (existingManifest) await this.verifyManifestArtifacts(modelKey, existingManifest);
      const existingVersion = existingManifest?.versions.find((entry) => entry.design_graph_id === graph.design_graph_id) || null;
      const graphPath = this.graphPath(modelKey, graph.design_graph_id);
      const graphSha256 = sha256Canonical(graph);
      await writeImmutableJson(graphPath, graph, {
        referenced: Boolean(existingVersion),
        validate: (value) => assertGraphIntegrity(value, graph.design_graph_id, graphSha256, modelKey),
        resource: 'design_intent_graph'
      });

      if (existingVersion) {
        assertVersionMatchesGraph(existingVersion, modelKey, graph, graphSha256);
      }

      const previousVersion = existingManifest?.versions.at(-1) || null;
      const previousGraph = !existingVersion && previousVersion
        ? await this.loadGraphFile(modelKey, previousVersion.design_graph_id, previousVersion.content_sha256)
        : null;
      if (!existingVersion) assertAppendOnlyCorrectionHistory(previousGraph, graph);

      const reconciliationRecord = reconciliation
        ? await this.prepareReconciliationRecord({
          modelKey,
          reconciliation,
          manifest: existingManifest,
          incomingGraph: graph,
          previousGraph,
          sourceTaskId: normalizedTaskId
        })
        : null;

      const now = new Date().toISOString();
      let version = existingVersion;
      let versions = existingManifest?.versions || [];
      if (!version) {
        const delta = designHistoryDelta(previousGraph, graph);
        version = {
          sequence: (previousVersion?.sequence || 0) + 1,
          model_key: modelKey,
          design_graph_id: graph.design_graph_id,
          source_model_graph_id: graph.source_model_graph_id,
          model_revision: graph.model_revision,
          content_sha256: graphSha256,
          artifact_path: `graphs/${graph.design_graph_id}.json`,
          source_task_id: normalizedTaskId,
          created_at: now,
          transition: {
            kind: transitionKind(previousGraph, delta.added_correction_event_ids, reconciliationRecord?.entry || null),
            reconciliation_id: transitionReconciliationId(previousGraph, graph, reconciliationRecord?.entry || null),
            added_correction_event_ids: delta.added_correction_event_ids
          },
          history_delta: delta
        };
        versions = [...versions, version];
      }

      const reconciliationHistory = reconciliationRecord?.added
        ? [...(existingManifest?.reconciliation_history || []), reconciliationRecord.entry]
        : (existingManifest?.reconciliation_history || []);
      const changed = !existingVersion || reconciliationRecord?.added === true;
      const manifest = changed
        ? {
          version: DESIGN_INTENT_STORE_VERSION,
          kind: 'design_intent_manifest',
          model_key: modelKey,
          current_design_graph_id: versions.at(-1).design_graph_id,
          current_source_model_graph_id: versions.at(-1).source_model_graph_id,
          current_model_revision: versions.at(-1).model_revision,
          version_count: versions.length,
          versions,
          reconciliation_count: reconciliationHistory.length,
          reconciliation_history: reconciliationHistory,
          privacy: {
            raw_external_paths_persisted: false,
            sensitive_identity_persisted: false
          },
          created_at: existingManifest?.created_at || now,
          updated_at: now
        }
        : existingManifest;

      if (changed) {
        assertManifest(manifest, modelKey);
        await atomicWriteJson(manifestPath, manifest);
      }

      return persistenceResult({
        modelKey,
        graph,
        manifest,
        version,
        reused: Boolean(existingVersion),
        reconciliationRecord
      });
    });
  }

  async getManifest(modelKey) {
    assertModelKey(modelKey);
    const manifest = await readManifestIfPresent(this.manifestPath(modelKey), modelKey);
    if (!manifest) throw notFoundError('No persisted DesignIntentGraph exists for this model.');
    await this.verifyManifestArtifacts(modelKey, manifest);
    return manifest;
  }

  async loadCurrent(modelKey) {
    const manifest = await this.getManifest(modelKey);
    const version = manifest.versions.at(-1);
    if (!version || version.design_graph_id !== manifest.current_design_graph_id) {
      throw integrityError('The DesignIntent manifest current pointer is inconsistent.', { model_key: modelKey });
    }
    return {
      graph: await this.loadGraphFile(modelKey, version.design_graph_id, version.content_sha256),
      manifest,
      version
    };
  }

  async load(modelKey, designGraphId) {
    const manifest = await this.getManifest(modelKey);
    const version = manifest.versions.find((entry) => entry.design_graph_id === designGraphId);
    if (!version) throw notFoundError('The requested DesignIntentGraph version does not exist.');
    return {
      graph: await this.loadGraphFile(modelKey, designGraphId, version.content_sha256),
      manifest,
      version
    };
  }

  async loadReconciliation(modelKey, reconciliationId) {
    const manifest = await this.getManifest(modelKey);
    const entry = manifest.reconciliation_history.find((item) => item.reconciliation_id === reconciliationId);
    if (!entry) throw notFoundError('The requested DesignIntent reconciliation does not exist.');
    return {
      reconciliation: await this.loadReconciliationFile(modelKey, reconciliationId, entry.content_sha256),
      manifest,
      entry
    };
  }

  async history(modelKey, { includeDocuments = false, verify = true } = {}) {
    const manifest = await this.getManifest(modelKey);
    const versions = [];
    for (const entry of manifest.versions) {
      const graph = verify || includeDocuments
        ? await this.loadGraphFile(modelKey, entry.design_graph_id, entry.content_sha256)
        : null;
      versions.push(includeDocuments ? { ...entry, graph } : structuredClone(entry));
    }
    const reconciliations = [];
    for (const entry of manifest.reconciliation_history) {
      const reconciliation = verify || includeDocuments
        ? await this.loadReconciliationFile(modelKey, entry.reconciliation_id, entry.content_sha256)
        : null;
      reconciliations.push(includeDocuments ? { ...entry, reconciliation } : structuredClone(entry));
    }
    return {
      model_key: modelKey,
      current_design_graph_id: manifest.current_design_graph_id,
      current_source_model_graph_id: manifest.current_source_model_graph_id,
      current_model_revision: manifest.current_model_revision,
      version_count: versions.length,
      versions,
      reconciliation_count: reconciliations.length,
      reconciliation_history: reconciliations
    };
  }

  modelDir(modelKey) {
    assertModelKey(modelKey);
    return path.join(this.modelsDir, modelKey);
  }

  graphsDir(modelKey) {
    return path.join(this.modelDir(modelKey), 'graphs');
  }

  reconciliationsDir(modelKey) {
    return path.join(this.modelDir(modelKey), 'reconciliations');
  }

  manifestPath(modelKey) {
    return path.join(this.modelDir(modelKey), 'manifest.json');
  }

  graphPath(modelKey, designGraphId) {
    assertDesignGraphId(designGraphId);
    return path.join(this.graphsDir(modelKey), `${designGraphId}.json`);
  }

  reconciliationPath(modelKey, reconciliationId) {
    assertReconciliationId(reconciliationId);
    return path.join(this.reconciliationsDir(modelKey), `${reconciliationId}.json`);
  }

  async loadGraphFile(modelKey, designGraphId, expectedSha256) {
    const filePath = this.graphPath(modelKey, designGraphId);
    const graph = await readJsonArtifact(filePath, 'DesignIntentGraph', { model_key: modelKey, design_graph_id: designGraphId });
    assertGraphIntegrity(graph, designGraphId, expectedSha256, modelKey);
    return graph;
  }

  async loadReconciliationFile(modelKey, reconciliationId, expectedSha256) {
    const filePath = this.reconciliationPath(modelKey, reconciliationId);
    const reconciliation = await readJsonArtifact(filePath, 'DesignIntent reconciliation', { model_key: modelKey, reconciliation_id: reconciliationId });
    assertReconciliationIntegrity(reconciliation, reconciliationId, expectedSha256, modelKey);
    return reconciliation;
  }

  async prepareReconciliationRecord({ modelKey, reconciliation, manifest, incomingGraph, previousGraph, sourceTaskId }) {
    const knownVersion = manifest?.versions.find((entry) => entry.design_graph_id === reconciliation.design_graph_id) || null;
    const referencedGraph = knownVersion
      ? await this.loadGraphFile(modelKey, knownVersion.design_graph_id, knownVersion.content_sha256)
      : (incomingGraph.design_graph_id === reconciliation.design_graph_id ? incomingGraph : null);
    if (!referencedGraph) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Reconciliation must reference a DesignIntentGraph version in the same model store.');
    }
    if (reconciliation.previous_model_revision !== referencedGraph.model_revision) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Reconciliation previous_model_revision does not match its DesignIntentGraph.');
    }
    if (previousGraph && incomingGraph.design_graph_id !== previousGraph.design_graph_id) {
      if (reconciliation.design_graph_id !== previousGraph.design_graph_id
        || reconciliation.current_model_revision !== incomingGraph.model_revision) {
        throw new AgentContractError('INVALID_ARGUMENT', 'A reconciliation-backed DesignIntentGraph version must bind the previous graph and current model revision.');
      }
    }

    const contentSha256 = sha256Canonical(reconciliation);
    const existing = manifest?.reconciliation_history.find((entry) => entry.reconciliation_id === reconciliation.reconciliation_id) || null;
    await writeImmutableJson(this.reconciliationPath(modelKey, reconciliation.reconciliation_id), reconciliation, {
      referenced: Boolean(existing),
      validate: (value) => assertReconciliationIntegrity(value, reconciliation.reconciliation_id, contentSha256, modelKey),
      resource: 'design_intent_reconciliation'
    });
    if (existing) {
      if (existing.content_sha256 !== contentSha256
        || existing.design_graph_id !== reconciliation.design_graph_id
        || existing.previous_model_revision !== reconciliation.previous_model_revision
        || existing.current_model_revision !== reconciliation.current_model_revision) {
        throw integrityError('The persisted reconciliation metadata does not match its content.', {
          model_key: modelKey,
          reconciliation_id: reconciliation.reconciliation_id
        });
      }
      return { entry: existing, added: false, reused: true };
    }
    const entry = {
      sequence: (manifest?.reconciliation_history.at(-1)?.sequence || 0) + 1,
      model_key: modelKey,
      reconciliation_id: reconciliation.reconciliation_id,
      design_graph_id: reconciliation.design_graph_id,
      previous_model_revision: reconciliation.previous_model_revision,
      current_model_revision: reconciliation.current_model_revision,
      content_sha256: contentSha256,
      artifact_path: `reconciliations/${reconciliation.reconciliation_id}.json`,
      source_task_id: sourceTaskId,
      created_at: new Date().toISOString()
    };
    return { entry, added: true, reused: false };
  }

  async verifyManifestArtifacts(modelKey, manifest) {
    let previousGraph = null;
    for (const version of manifest.versions) {
      const graph = await this.loadGraphFile(modelKey, version.design_graph_id, version.content_sha256);
      if (graph.source_model_graph_id !== version.source_model_graph_id
        || graph.model_revision !== version.model_revision) {
        throw integrityError('A DesignIntent version is not bound to its declared ModelGraph revision.', {
          model_key: modelKey,
          sequence: version.sequence
        });
      }
      try {
        assertAppendOnlyCorrectionHistory(previousGraph, graph);
      } catch {
        throw integrityError('The persisted DesignIntent correction history is not append-only.', {
          model_key: modelKey,
          sequence: version.sequence
        });
      }
      const expectedDelta = designHistoryDelta(previousGraph, graph);
      if (canonicalJson(expectedDelta) !== canonicalJson(version.history_delta)) {
        throw integrityError('A DesignIntent version history delta does not match its immutable graph content.', {
          model_key: modelKey,
          sequence: version.sequence
        });
      }
      const reconciliationEntry = version.transition.reconciliation_id
        ? manifest.reconciliation_history.find((entry) => entry.reconciliation_id === version.transition.reconciliation_id)
        : null;
      const expectedKind = transitionKind(previousGraph, expectedDelta.added_correction_event_ids, reconciliationEntry);
      const expectedReconciliationId = transitionReconciliationId(previousGraph, graph, reconciliationEntry);
      if (version.transition.kind !== expectedKind
        || version.transition.reconciliation_id !== expectedReconciliationId) {
        throw integrityError('A DesignIntent version transition does not match its history evidence.', {
          model_key: modelKey,
          sequence: version.sequence
        });
      }
      previousGraph = graph;
    }
    const versionsById = new Map(manifest.versions.map((entry) => [entry.design_graph_id, entry]));
    for (const entry of manifest.reconciliation_history) {
      const reconciliation = await this.loadReconciliationFile(modelKey, entry.reconciliation_id, entry.content_sha256);
      const referencedVersion = versionsById.get(entry.design_graph_id);
      if (!referencedVersion
        || reconciliation.design_graph_id !== entry.design_graph_id
        || reconciliation.previous_model_revision !== entry.previous_model_revision
        || reconciliation.current_model_revision !== entry.current_model_revision
        || referencedVersion.model_revision !== entry.previous_model_revision) {
        throw integrityError('A reconciliation history entry is not bound to its immutable DesignIntent version.', {
          model_key: modelKey,
          sequence: entry.sequence
        });
      }
    }
  }

  async withModelLock(modelKey, callback) {
    const lockPath = path.join(this.modelDir(modelKey), '.store.lock');
    const startedAt = Date.now();
    const owner = crypto.randomUUID();
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    while (true) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ owner, pid: process.pid, created_at: new Date().toISOString() })}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await syncDirectory(path.dirname(lockPath));
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (await reclaimStaleLock(lockPath, this.staleLockMs)) continue;
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new AgentContractError('TASK_STATE_CONFLICT', 'The DesignIntent store is busy; retry this task.', {
            details: { resource: 'design_intent_store', model_key: modelKey }
          });
        }
        await delay(20);
      }
    }
    try {
      return await callback();
    } finally {
      await releaseOwnedLock(lockPath, owner);
    }
  }
}

function persistenceResult({ modelKey, graph, manifest, version, reused, reconciliationRecord }) {
  return {
    model_key: modelKey,
    design_graph_id: graph.design_graph_id,
    source_model_graph_id: graph.source_model_graph_id,
    model_revision: graph.model_revision,
    version_sequence: version.sequence,
    version_count: manifest.version_count,
    current: manifest.current_design_graph_id === graph.design_graph_id,
    reused,
    artifact_path: version.artifact_path,
    version,
    reconciliation: reconciliationRecord ? {
      reconciliation_id: reconciliationRecord.entry.reconciliation_id,
      sequence: reconciliationRecord.entry.sequence,
      reused: reconciliationRecord.reused,
      artifact_path: reconciliationRecord.entry.artifact_path
    } : null,
    manifest
  };
}

function designHistoryDelta(previous, current) {
  const previousParameters = previous?.parameters || {};
  const currentParameters = current.parameters || {};
  const previousBindings = new Map((previous?.bindings || []).map((item) => [item.binding_id, canonicalJson(item)]));
  const currentBindings = new Map((current.bindings || []).map((item) => [item.binding_id, canonicalJson(item)]));
  const previousCorrectionCount = previous?.correction_history?.length || 0;
  return {
    previous_design_graph_id: previous?.design_graph_id || null,
    source_model_graph_changed: Boolean(previous && previous.source_model_graph_id !== current.source_model_graph_id),
    model_revision_changed: Boolean(previous && previous.model_revision !== current.model_revision),
    changed_parameter_ids: sortedUnionKeys(previousParameters, currentParameters)
      .filter((key) => canonicalJson(previousParameters[key]) !== canonicalJson(currentParameters[key])),
    added_binding_ids: [...currentBindings.keys()].filter((key) => !previousBindings.has(key)).sort(),
    removed_binding_ids: [...previousBindings.keys()].filter((key) => !currentBindings.has(key)).sort(),
    changed_binding_ids: [...currentBindings.entries()]
      .filter(([key, value]) => previousBindings.has(key) && previousBindings.get(key) !== value)
      .map(([key]) => key)
      .sort(),
    added_correction_event_ids: current.correction_history.slice(previousCorrectionCount).map((event) => event.event_id)
  };
}

function sortedUnionKeys(left, right) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
}

function isUniqueStringArray(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

function transitionKind(previous, correctionEventIds, reconciliationEntry) {
  if (!previous) return 'initial';
  if (reconciliationEntry && correctionEventIds.length) return 'reconciliation_correction';
  if (reconciliationEntry) return 'reconciliation';
  if (correctionEventIds.length) return 'correction';
  return 'snapshot';
}

function transitionReconciliationId(previous, graph, reconciliationEntry) {
  if (!previous || !reconciliationEntry) return null;
  return reconciliationEntry.design_graph_id === previous.design_graph_id
    && reconciliationEntry.current_model_revision === graph.model_revision
    ? reconciliationEntry.reconciliation_id
    : null;
}

function assertAppendOnlyCorrectionHistory(previous, current) {
  if (!previous) return;
  if (current.correction_history.length < previous.correction_history.length) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent correction history is append-only.');
  }
  for (let index = 0; index < previous.correction_history.length; index += 1) {
    if (canonicalJson(previous.correction_history[index]) !== canonicalJson(current.correction_history[index])) {
      throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent correction history cannot rewrite an existing event.');
    }
  }
}

async function readManifestIfPresent(filePath, expectedModelKey) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw integrityError('The DesignIntent manifest is not valid JSON.', { model_key: expectedModelKey });
  }
  assertManifest(manifest, expectedModelKey);
  return manifest;
}

function assertManifest(manifest, expectedModelKey) {
  const valid = manifest?.version === DESIGN_INTENT_STORE_VERSION
    && manifest.kind === 'design_intent_manifest'
    && manifest.model_key === expectedModelKey
    && MODEL_KEY_PATTERN.test(String(manifest.model_key || ''))
    && DESIGN_GRAPH_ID_PATTERN.test(String(manifest.current_design_graph_id || ''))
    && MODEL_GRAPH_ID_PATTERN.test(String(manifest.current_source_model_graph_id || ''))
    && SHA256_PATTERN.test(String(manifest.current_model_revision || ''))
    && Array.isArray(manifest.versions)
    && manifest.versions.length > 0
    && manifest.version_count === manifest.versions.length
    && Array.isArray(manifest.reconciliation_history)
    && manifest.reconciliation_count === manifest.reconciliation_history.length
    && manifest.privacy?.raw_external_paths_persisted === false
    && manifest.privacy?.sensitive_identity_persisted === false
    && Number.isFinite(Date.parse(manifest.created_at))
    && Number.isFinite(Date.parse(manifest.updated_at));
  if (!valid) throw integrityError('The DesignIntent manifest is structurally invalid.', { model_key: expectedModelKey });

  const graphIds = new Set();
  for (const [index, version] of manifest.versions.entries()) {
    const previousDesignGraphId = index === 0 ? null : manifest.versions[index - 1].design_graph_id;
    const previousVersion = index === 0 ? null : manifest.versions[index - 1];
    const correctionIds = version?.history_delta?.added_correction_event_ids;
    const deltaArrays = [
      version?.history_delta?.changed_parameter_ids,
      version?.history_delta?.added_binding_ids,
      version?.history_delta?.removed_binding_ids,
      version?.history_delta?.changed_binding_ids,
      correctionIds
    ];
    const versionValid = version?.sequence === index + 1
      && version.model_key === expectedModelKey
      && DESIGN_GRAPH_ID_PATTERN.test(String(version.design_graph_id || ''))
      && !graphIds.has(version.design_graph_id)
      && MODEL_GRAPH_ID_PATTERN.test(String(version.source_model_graph_id || ''))
      && SHA256_PATTERN.test(String(version.model_revision || ''))
      && SHA256_PATTERN.test(String(version.content_sha256 || ''))
      && version.artifact_path === `graphs/${version.design_graph_id}.json`
      && Number.isFinite(Date.parse(version.created_at))
      && version.history_delta?.previous_design_graph_id === previousDesignGraphId
      && typeof version.history_delta?.source_model_graph_changed === 'boolean'
      && typeof version.history_delta?.model_revision_changed === 'boolean'
      && deltaArrays.every((items) => isUniqueStringArray(items))
      && version.history_delta.source_model_graph_changed === Boolean(previousVersion && previousVersion.source_model_graph_id !== version.source_model_graph_id)
      && version.history_delta.model_revision_changed === Boolean(previousVersion && previousVersion.model_revision !== version.model_revision)
      && Array.isArray(version.transition?.added_correction_event_ids)
      && canonicalJson(version.transition.added_correction_event_ids) === canonicalJson(correctionIds)
      && ['initial', 'snapshot', 'reconciliation', 'correction', 'reconciliation_correction'].includes(version.transition.kind)
      && (version.transition.reconciliation_id === null || RECONCILIATION_ID_PATTERN.test(String(version.transition.reconciliation_id || '')))
      && (index === 0 ? version.transition.kind === 'initial' : version.transition.kind !== 'initial')
      && (version.source_task_id === null || /^task_[0-9a-f-]+$/i.test(String(version.source_task_id || '')));
    if (!versionValid) {
      throw integrityError('The DesignIntent manifest version chain is invalid.', {
        model_key: expectedModelKey,
        sequence: version?.sequence ?? null
      });
    }
    graphIds.add(version.design_graph_id);
  }
  const latest = manifest.versions.at(-1);
  if (manifest.current_design_graph_id !== latest.design_graph_id
    || manifest.current_source_model_graph_id !== latest.source_model_graph_id
    || manifest.current_model_revision !== latest.model_revision) {
    throw integrityError('The DesignIntent manifest current pointer is inconsistent.', { model_key: expectedModelKey });
  }

  const reconciliationIds = new Set();
  for (const [index, entry] of manifest.reconciliation_history.entries()) {
    const entryValid = entry?.sequence === index + 1
      && entry.model_key === expectedModelKey
      && RECONCILIATION_ID_PATTERN.test(String(entry.reconciliation_id || ''))
      && !reconciliationIds.has(entry.reconciliation_id)
      && graphIds.has(entry.design_graph_id)
      && SHA256_PATTERN.test(String(entry.previous_model_revision || ''))
      && SHA256_PATTERN.test(String(entry.current_model_revision || ''))
      && SHA256_PATTERN.test(String(entry.content_sha256 || ''))
      && entry.artifact_path === `reconciliations/${entry.reconciliation_id}.json`
      && Number.isFinite(Date.parse(entry.created_at))
      && (entry.source_task_id === null || /^task_[0-9a-f-]+$/i.test(String(entry.source_task_id || '')));
    if (!entryValid) {
      throw integrityError('The DesignIntent reconciliation history chain is invalid.', {
        model_key: expectedModelKey,
        sequence: entry?.sequence ?? null
      });
    }
    reconciliationIds.add(entry.reconciliation_id);
  }
  for (const version of manifest.versions) {
    const reconciliationId = version.transition.reconciliation_id;
    if (reconciliationId !== null && !reconciliationIds.has(reconciliationId)) {
      throw integrityError('A DesignIntent version references a missing reconciliation.', {
        model_key: expectedModelKey,
        sequence: version.sequence
      });
    }
  }
}

function assertVersionMatchesGraph(version, modelKey, graph, graphSha256) {
  if (version.model_key !== modelKey
    || version.source_model_graph_id !== graph.source_model_graph_id
    || version.model_revision !== graph.model_revision
    || version.content_sha256 !== graphSha256) {
    throw integrityError('The persisted DesignIntent version metadata does not match its content.', {
      model_key: modelKey,
      design_graph_id: graph.design_graph_id
    });
  }
}

function assertDesignGraph(graph, expectedModelKey = null) {
  const valid = graph?.version === 'design-intent-graph.v1'
    && graph.kind === 'design_intent_graph'
    && MODEL_KEY_PATTERN.test(String(graph.model_key || ''))
    && (expectedModelKey === null || graph.model_key === expectedModelKey)
    && DESIGN_GRAPH_ID_PATTERN.test(String(graph.design_graph_id || ''))
    && MODEL_GRAPH_ID_PATTERN.test(String(graph.source_model_graph_id || ''))
    && SHA256_PATTERN.test(String(graph.model_revision || ''))
    && graph.artifacts && typeof graph.artifacts === 'object' && !Array.isArray(graph.artifacts)
    && graph.parameters && typeof graph.parameters === 'object' && !Array.isArray(graph.parameters)
    && Array.isArray(graph.bindings) && graph.bindings.length > 0
    && Array.isArray(graph.relationships)
    && graph.bidirectional && typeof graph.bidirectional === 'object'
    && Array.isArray(graph.correction_history)
    && graph.divergence_policy === 'review_required_no_silent_overwrite'
    && Array.isArray(graph.untrusted_data_fields)
    && graph.stats && typeof graph.stats === 'object'
    && Object.keys(graph).every((key) => DESIGN_GRAPH_KEYS.has(key))
    && Object.keys(graph).length === DESIGN_GRAPH_KEYS.size;
  if (!valid) throw new AgentContractError('INVALID_ARGUMENT', 'A valid design-intent-graph.v1 document is required.');

  const artifactKeys = Object.keys(graph.artifacts).sort();
  if (canonicalJson(artifactKeys) !== canonicalJson(['feature_mapping_plan', 'parametric_recipe', 'part_graph'])) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph artifact references do not match the v1 contract.');
  }
  for (const reference of Object.values(graph.artifacts)) {
    if (reference !== null && (!reference || typeof reference !== 'object' || !SHA256_PATTERN.test(String(reference.sha256 || '')))) {
      throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph contains an invalid artifact reference.');
    }
  }
  if (![...REQUIRED_UNTRUSTED_FIELDS].every((field) => graph.untrusted_data_fields.includes(field))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph must retain its untrusted-data field contract.');
  }

  const graphWithoutId = { ...graph };
  delete graphWithoutId.design_graph_id;
  const evolvedCandidate = `design-graph-${sha256Canonical(graphWithoutId).slice(7, 31)}`;
  const initialCore = { ...graphWithoutId };
  delete initialCore.stats;
  const initialCandidate = `design-graph-${sha256Canonical(initialCore).slice(7, 31)}`;
  if (graph.design_graph_id !== initialCandidate && graph.design_graph_id !== evolvedCandidate) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph id does not match its semantic content.');
  }

  const bindingIds = new Set();
  for (const binding of graph.bindings) {
    if (!binding || typeof binding.binding_id !== 'string' || !binding.binding_id || bindingIds.has(binding.binding_id)
      || !SHA256_PATTERN.test(String(binding.baseline_fingerprint || ''))
      || !/^node_[0-9a-f]{24}$/.test(String(binding.entity_node_id || ''))
      || !Array.isArray(binding.parameter_bindings) || binding.parameter_bindings.length === 0
      || !binding.parameter_bindings.every((item) => item && typeof item.parameter_id === 'string' && Object.hasOwn(graph.parameters, item.parameter_id))
      || !Array.isArray(binding.existing_targets) || binding.existing_targets.length === 0
      || !binding.existing_targets.every(isPersistentRef)
      || !isPersistentRef(binding.persistent_ref)
      || !Array.isArray(binding.resolved_entities) || binding.resolved_entities.length === 0
      || !binding.resolved_entities.every((entry) => entry
        && /^node_[0-9a-f]{24}$/.test(String(entry.entity_node_id || ''))
        && isPersistentRef(entry.persistent_ref)
        && SHA256_PATTERN.test(String(entry.baseline_fingerprint || '')))
      || binding.entity_node_id !== binding.resolved_entities[0].entity_node_id
      || canonicalJson(binding.persistent_ref) !== canonicalJson(binding.resolved_entities[0].persistent_ref)
      || canonicalJson(binding.existing_targets) !== canonicalJson(binding.resolved_entities.map((entry) => entry.persistent_ref))
      || binding.baseline_fingerprint !== resolvedBindingFingerprint(binding.resolved_entities)
      || !isUniqueStringArray(binding.associated_binding_ids)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph contains an invalid or duplicate binding.');
    }
    bindingIds.add(binding.binding_id);
  }
  if (graph.bindings.some((binding) => binding.associated_binding_ids.some((id) => !bindingIds.has(id)))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph contains a dangling associated binding.');
  }
  const expectedRelationships = relationshipsForBindings(graph.bindings);
  if (canonicalJson(expectedRelationships) !== canonicalJson(graph.relationships)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph relationships do not match its bindings.');
  }
  const expectedBidirectional = bidirectionalForBindings(graph.bindings);
  if (canonicalJson(expectedBidirectional) !== canonicalJson(graph.bidirectional)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph bidirectional indexes do not match its bindings.');
  }
  const correctionIds = new Set();
  for (const event of graph.correction_history) {
    if (!event || !EVENT_ID_PATTERN.test(String(event.event_id || '')) || correctionIds.has(event.event_id)
      || !Number.isFinite(Date.parse(event.at || ''))
      || (event.previous_model_revision !== undefined && !SHA256_PATTERN.test(String(event.previous_model_revision || '')))
      || (event.current_model_revision !== undefined && !SHA256_PATTERN.test(String(event.current_model_revision || '')))) {
      throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph correction history contains an invalid or duplicate event.');
    }
    correctionIds.add(event.event_id);
  }
  const mappedEntities = new Set(graph.bindings.flatMap((binding) => binding.resolved_entities.map((entry) => entry.entity_node_id))).size;
  if (graph.stats.parameters !== Object.keys(graph.parameters).length
    || graph.stats.bindings !== graph.bindings.length
    || graph.stats.mapped_entities !== mappedEntities
    || graph.stats.correction_events !== graph.correction_history.length
    || !Object.values(graph.stats).every((value) => Number.isInteger(value) && value >= 0)) {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntentGraph statistics do not match its content.');
  }
}

function isPersistentRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.target_id === 'string' && value.target_id.length > 0) return value.edit_scope === 'top_level';
  return typeof value.entity_path === 'string' && value.entity_path.length > 0
    && typeof value.edit_scope === 'string' && value.edit_scope.length > 0
    && ['definition_wide', 'make_unique'].includes(value.instance_policy)
    && (value.instance_policy !== 'make_unique' || (typeof value.instance_id === 'string' && value.instance_id.length > 0));
}

function resolvedBindingFingerprint(entries) {
  return sha256Canonical(entries
    .map((entry) => ({ persistent_ref: entry.persistent_ref, entity_fingerprint: entry.baseline_fingerprint }))
    .sort((left, right) => persistentRefKey(left.persistent_ref).localeCompare(persistentRefKey(right.persistent_ref))));
}

function persistentRefKey(ref) {
  return ref.entity_path ? `entity_path:${ref.entity_path}` : `target_id:${ref.target_id}`;
}

function relationshipsForBindings(bindings) {
  const relationships = [];
  for (const binding of bindings) {
    for (const parameter of binding.parameter_bindings) {
      relationships.push({ type: 'parameter_controls_entity', from: `parameter:${parameter.parameter_id}`, to: `binding:${binding.binding_id}` });
    }
    if (binding.part_id) relationships.push({ type: 'part_maps_to_entity', from: `part:${binding.part_id}`, to: `binding:${binding.binding_id}` });
    if (binding.feature_id) relationships.push({ type: 'feature_maps_to_entity', from: `feature:${binding.feature_id}`, to: `binding:${binding.binding_id}` });
    for (const associated of binding.associated_binding_ids) {
      relationships.push({ type: 'associated_rebuild', from: `binding:${binding.binding_id}`, to: `binding:${associated}` });
    }
  }
  return relationships;
}

function bidirectionalForBindings(bindings) {
  const designToEntities = {};
  const entityToDesign = {};
  for (const binding of bindings) {
    const designRefs = [
      ...(binding.part_id ? [`part:${binding.part_id}`] : []),
      ...(binding.feature_id ? [`feature:${binding.feature_id}`] : []),
      ...binding.parameter_bindings.map((item) => `parameter:${item.parameter_id}`)
    ];
    for (const persistentRef of binding.existing_targets) {
      const entityKey = persistentRefKey(persistentRef);
      entityToDesign[entityKey] = [...new Set([...(entityToDesign[entityKey] || []), ...designRefs])];
      for (const designRef of designRefs) {
        designToEntities[designRef] = [...new Set([...(designToEntities[designRef] || []), entityKey])];
      }
    }
  }
  return { design_to_entities: designToEntities, entity_to_design: entityToDesign };
}

function assertGraphIntegrity(graph, expectedDesignGraphId, expectedSha256, expectedModelKey = null) {
  try {
    assertDesignGraph(graph, expectedModelKey);
    assertPersistablePayload(graph);
  } catch {
    throw integrityError('The persisted DesignIntentGraph document is structurally invalid.', {
      design_graph_id: expectedDesignGraphId
    });
  }
  if (graph.design_graph_id !== expectedDesignGraphId || (expectedSha256 && sha256Canonical(graph) !== expectedSha256)) {
    throw integrityError('The persisted DesignIntentGraph failed its content-integrity check.', {
      design_graph_id: expectedDesignGraphId
    });
  }
}

function assertReconciliation(reconciliation, expectedModelKey = null) {
  const valid = reconciliation?.version === 'design-intent-reconciliation.v1'
    && reconciliation.kind === 'design_intent_reconciliation'
    && MODEL_KEY_PATTERN.test(String(reconciliation.model_key || ''))
    && (expectedModelKey === null || reconciliation.model_key === expectedModelKey)
    && RECONCILIATION_ID_PATTERN.test(String(reconciliation.reconciliation_id || ''))
    && DESIGN_GRAPH_ID_PATTERN.test(String(reconciliation.design_graph_id || ''))
    && SHA256_PATTERN.test(String(reconciliation.previous_model_revision || ''))
    && SHA256_PATTERN.test(String(reconciliation.current_model_revision || ''))
    && Array.isArray(reconciliation.expected_changes)
    && Array.isArray(reconciliation.unexpected_divergence)
    && reconciliation.silent_overwrite_allowed === false;
  if (!valid) throw new AgentContractError('INVALID_ARGUMENT', 'A valid design-intent-reconciliation.v1 document is required.');
  const core = { ...reconciliation };
  delete core.reconciliation_id;
  delete core.next_action;
  const expectedId = `reconciliation-${sha256Canonical(core).slice(7, 31)}`;
  if (reconciliation.reconciliation_id !== expectedId) {
    throw new AgentContractError('INVALID_ARGUMENT', 'Reconciliation id does not match its semantic content.');
  }
}

function assertReconciliationIntegrity(reconciliation, expectedId, expectedSha256, expectedModelKey = null) {
  try {
    assertReconciliation(reconciliation, expectedModelKey);
    assertPersistablePayload(reconciliation);
  } catch {
    throw integrityError('The persisted DesignIntent reconciliation is structurally invalid.', {
      reconciliation_id: expectedId
    });
  }
  if (reconciliation.reconciliation_id !== expectedId
    || (expectedSha256 && sha256Canonical(reconciliation) !== expectedSha256)) {
    throw integrityError('The persisted DesignIntent reconciliation failed its content-integrity check.', {
      reconciliation_id: expectedId
    });
  }
}

function assertPersistablePayload(value, keyPath = [], seen = new Set()) {
  if (value === null || value === undefined || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent persistence accepts finite numbers only.');
    }
    return;
  }
  if (typeof value === 'string') {
    const field = String(keyPath.at(-1) || '').toLowerCase();
    if (looksLikeRawExternalLocation(value, { entityPath: field === 'entity_path' })) {
      throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent persistence rejects raw external paths and locations.');
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent persistence accepts JSON-compatible data only.');
  }
  if (seen.has(value)) throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent persistence rejects cyclic data.');
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertPersistablePayload(item, keyPath, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        throw new AgentContractError('INVALID_ARGUMENT', 'DesignIntent persistence rejects raw paths, secrets, and sensitive identity fields.');
      }
      assertPersistablePayload(item, [...keyPath, key], seen);
    }
  }
  seen.delete(value);
}

function isSensitiveKey(key) {
  const normalized = String(key).toLowerCase();
  if (normalized === 'entity_path') return false;
  if (['identity', 'model_identity', 'identity_value', 'guid', 'model_guid', 'document_id', 'runtime_object_id', 'session_id', 'user_id'].includes(normalized)) return true;
  if (normalized.endsWith('_guid') || normalized.endsWith('_identity')) return true;
  if (/(?:^|_)(?:secret|password|access_token|refresh_token|api_key|session_token)$/.test(normalized)) return true;
  return /(?:^|_)(?:source|external|file|workspace|absolute|local|input|output)?_?path$/.test(normalized)
    || normalized === 'url'
    || normalized === 'uri'
    || normalized.endsWith('_url');
}

function looksLikeRawExternalLocation(value, { entityPath = false } = {}) {
  const text = String(value).trim();
  const absolute = text.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(text)
    || text.startsWith('\\\\')
    || /^(?:file|https?):\/\//i.test(text)
    || text.startsWith('~/');
  if (absolute) return true;
  if (entityPath) return false;
  return text.startsWith('./')
    || text.startsWith('../')
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(text)
    || /[\\/][^\\/]+\.(?:skp|json|ya?ml|png|jpe?g|webp|gif|svg|pdf|csv|tsv|txt|rb|mjs|js)$/i.test(text);
}

async function readJsonArtifact(filePath, label, details) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw integrityError(`The persisted ${label} artifact referenced by the manifest is missing.`, details);
    }
    throw integrityError(`The persisted ${label} artifact is not valid JSON.`, details);
  }
}

async function writeImmutableJson(filePath, value, { referenced, validate, resource }) {
  try {
    const existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
    validate(existing);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      if (referenced) {
        if (error instanceof AgentContractError && error.code === 'MODEL_GRAPH_INTEGRITY_ERROR') throw error;
        throw integrityError('A referenced DesignIntent artifact is unreadable.', { resource });
      }
      const orphanPath = `${filePath}.orphan.${process.pid}.${crypto.randomUUID()}`;
      try {
        await fs.rename(filePath, orphanPath);
        await fs.rm(orphanPath, { force: true });
      } catch (renameError) {
        if (renameError?.code !== 'ENOENT') throw renameError;
      }
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.link(temporary, filePath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const concurrentlyPublished = JSON.parse(await fs.readFile(filePath, 'utf8'));
    validate(concurrentlyPublished);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  await syncDirectory(path.dirname(filePath));
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, filePath);
    await syncDirectory(path.dirname(filePath));
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function reclaimStaleLock(lockPath, staleAfterMs) {
  let lock;
  let stat;
  try {
    [lock, stat] = await Promise.all([
      fs.readFile(lockPath, 'utf8').then((value) => JSON.parse(value)),
      fs.stat(lockPath)
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    try {
      stat ||= await fs.stat(lockPath);
    } catch (statError) {
      return statError?.code === 'ENOENT';
    }
  }
  const createdAt = Date.parse(lock?.created_at || '') || stat.mtimeMs;
  if (Date.now() - createdAt < staleAfterMs || processIsAlive(lock?.pid)) return false;
  const stalePath = `${lockPath}.stale.${process.pid}.${crypto.randomUUID()}`;
  try {
    await fs.rename(lockPath, stalePath);
    await fs.rm(stalePath, { force: true });
    await syncDirectory(path.dirname(lockPath));
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function releaseOwnedLock(lockPath, owner) {
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    if (lock.owner === owner) {
      await fs.rm(lockPath, { force: true });
      await syncDirectory(path.dirname(lockPath));
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function normalizeTaskId(value) {
  if (value === null || value === undefined) return null;
  if (!/^task_[0-9a-f-]+$/i.test(String(value))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'source_task_id has an invalid format.');
  }
  return String(value);
}

function assertModelKey(modelKey) {
  if (!MODEL_KEY_PATTERN.test(String(modelKey || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'model_key has an invalid format.');
  }
}

function assertDesignGraphId(designGraphId) {
  if (!DESIGN_GRAPH_ID_PATTERN.test(String(designGraphId || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'design_graph_id has an invalid format.');
  }
}

function assertReconciliationId(reconciliationId) {
  if (!RECONCILIATION_ID_PATTERN.test(String(reconciliationId || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'reconciliation_id has an invalid format.');
  }
}

function notFoundError(message) {
  return new AgentContractError('ARTIFACT_NOT_FOUND', message, {
    details: { resource: 'design_intent_store' }
  });
}

function integrityError(message, details = {}) {
  return new AgentContractError('MODEL_GRAPH_INTEGRITY_ERROR', message, {
    details: { resource: 'design_intent_store', ...details }
  });
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
