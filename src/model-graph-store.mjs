import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { validateModelGraphSemantics } from './model-graph.mjs';
import { defaultStateDir } from './paths.mjs';

export { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';

export const MODEL_GRAPH_STORE_VERSION = 'model-graph-store.v1';

const MODEL_KEY_PATTERN = /^model_[0-9a-f]{32}$/;
const GRAPH_ID_PATTERN = /^model-graph-[0-9a-f]{24}$/;

export class ModelGraphStore {
  constructor({ rootDir = path.join(defaultStateDir, 'model-graph-v1'), lockTimeoutMs = 5000 } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.modelsDir = path.join(this.rootDir, 'models');
    this.lockTimeoutMs = positiveInteger(lockTimeoutMs, 5000);
  }

  async persist({ graph, adoption, identityHint, sourceTaskId = null } = {}) {
    assertGraph(graph);
    const identity = modelIdentityForAdoption(adoption, { identityHint });
    const modelKey = modelKeyForIdentity(identity);
    const modelDir = this.modelDir(modelKey);
    const graphsDir = path.join(modelDir, 'graphs');
    await fs.mkdir(graphsDir, { recursive: true, mode: 0o700 });

    return this.withModelLock(modelKey, async () => {
      const manifestPath = this.manifestPath(modelKey);
      const existingManifest = await readManifestIfPresent(manifestPath, modelKey);
      const graphPath = this.graphPath(modelKey, graph.graph_id);
      const contentSha256 = sha256Canonical(graph);
      const graphIsReferenced = existingManifest?.versions.some((entry) => entry.graph_id === graph.graph_id) === true;
      await writeGraphIfAbsent(graphPath, graph, contentSha256, { referenced: graphIsReferenced });

      const existingVersion = existingManifest?.versions.find((entry) => entry.graph_id === graph.graph_id);
      if (existingVersion) {
        if (existingVersion.content_sha256 !== contentSha256 || existingVersion.model_revision !== graph.model_revision) {
          throw integrityError('The persisted ModelGraph version metadata does not match its content.', {
            model_key: modelKey,
            graph_id: graph.graph_id
          });
        }
        const observedManifest = existingManifest.current_graph_id === graph.graph_id
          ? existingManifest
          : {
            ...existingManifest,
            current_graph_id: graph.graph_id,
            current_model_revision: graph.model_revision,
            updated_at: new Date().toISOString()
          };
        if (observedManifest !== existingManifest) await atomicWriteJson(manifestPath, observedManifest);
        return persistenceResult({
          modelKey,
          graph,
          graphPath,
          manifestPath,
          manifest: observedManifest,
          version: existingVersion,
          reused: true
        });
      }

      const now = new Date().toISOString();
      const previousVersion = existingManifest?.versions.at(-1) || null;
      const previousGraph = previousVersion
        ? await this.loadGraph(modelKey, previousVersion.graph_id, { expectedSha256: previousVersion.content_sha256 })
        : null;
      const version = {
        sequence: (previousVersion?.sequence || 0) + 1,
        graph_id: graph.graph_id,
        model_revision: graph.model_revision,
        content_sha256: contentSha256,
        artifact_path: `graphs/${graph.graph_id}.json`,
        source_task_id: normalizeTaskId(sourceTaskId),
        created_at: now,
        delta_from_previous: graphDelta(previousGraph, graph)
      };
      const versions = [...(existingManifest?.versions || []), version];
      const manifest = {
        version: MODEL_GRAPH_STORE_VERSION,
        kind: 'model_graph_manifest',
        model_key: modelKey,
        identity,
        current_graph_id: graph.graph_id,
        current_model_revision: graph.model_revision,
        version_count: versions.length,
        versions,
        created_at: existingManifest?.created_at || now,
        updated_at: now
      };
      await atomicWriteJson(manifestPath, manifest);
      return persistenceResult({
        modelKey,
        graph,
        graphPath,
        manifestPath,
        manifest,
        version,
        reused: false
      });
    });
  }

  async getManifest(modelKey) {
    const manifest = await readManifestIfPresent(this.manifestPath(modelKey), modelKey);
    if (!manifest) {
      throw new AgentContractError('MODEL_GRAPH_NOT_FOUND', 'No persisted ModelGraph exists for this model.');
    }
    return manifest;
  }

  async loadCurrent(modelKey) {
    const manifest = await this.getManifest(modelKey);
    const current = manifest.versions.find((entry) => entry.graph_id === manifest.current_graph_id);
    if (!current) {
      throw integrityError('The ModelGraph manifest has no current version entry.', { model_key: modelKey });
    }
    return {
      graph: await this.loadGraph(modelKey, current.graph_id, { expectedSha256: current.content_sha256 }),
      manifest,
      version: current
    };
  }

  async loadGraph(modelKey, graphId, { expectedSha256 } = {}) {
    const filePath = this.graphPath(modelKey, graphId);
    let graph;
    try {
      graph = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new AgentContractError('MODEL_GRAPH_NOT_FOUND', 'The requested persisted ModelGraph version does not exist.');
      }
      throw integrityError('The persisted ModelGraph content is not valid JSON.', {
        model_key: modelKey,
        graph_id: graphId
      });
    }
    assertGraphIntegrity(graph, graphId, expectedSha256);
    return graph;
  }

  modelDir(modelKey) {
    assertModelKey(modelKey);
    return path.join(this.modelsDir, modelKey);
  }

  manifestPath(modelKey) {
    return path.join(this.modelDir(modelKey), 'manifest.json');
  }

  graphPath(modelKey, graphId) {
    assertModelKey(modelKey);
    if (!GRAPH_ID_PATTERN.test(String(graphId || ''))) {
      throw new AgentContractError('INVALID_ARGUMENT', 'graph_id has an invalid format.');
    }
    return path.join(this.modelDir(modelKey), 'graphs', `${graphId}.json`);
  }

  async withModelLock(modelKey, callback) {
    const lockPath = path.join(this.modelDir(modelKey), '.store.lock');
    const startedAt = Date.now();
    const owner = crypto.randomUUID();
    await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    while (true) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify({ owner, pid: process.pid, created_at: new Date().toISOString() })}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        if (await reclaimStaleLock(lockPath, Math.max(this.lockTimeoutMs * 2, 30_000))) continue;
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new AgentContractError('TASK_STATE_CONFLICT', 'The ModelGraph store is busy; retry this task.', {
            details: { resource: 'model_graph_store', model_key: modelKey }
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

function persistenceResult({ modelKey, graph, graphPath, manifestPath, manifest, version, reused }) {
  return {
    model_key: modelKey,
    graph_id: graph.graph_id,
    model_revision: graph.model_revision,
    version_sequence: version.sequence,
    version_count: manifest.version_count,
    current: manifest.current_graph_id === graph.graph_id,
    reused,
    graph_path: graphPath,
    manifest_path: manifestPath,
    manifest,
    version
  };
}

function graphDelta(previous, current) {
  if (!previous) {
    return {
      previous_graph_id: null,
      added_nodes: current.nodes.length,
      removed_nodes: 0,
      changed_nodes: 0,
      added_relationships: relationshipSet(current).size,
      removed_relationships: 0
    };
  }
  const previousNodes = new Map(previous.nodes.map((node) => [node.node_id, canonicalJson(node)]));
  const currentNodes = new Map(current.nodes.map((node) => [node.node_id, canonicalJson(node)]));
  const previousRelationships = relationshipSet(previous);
  const currentRelationships = relationshipSet(current);
  return {
    previous_graph_id: previous.graph_id,
    added_nodes: [...currentNodes.keys()].filter((key) => !previousNodes.has(key)).length,
    removed_nodes: [...previousNodes.keys()].filter((key) => !currentNodes.has(key)).length,
    changed_nodes: [...currentNodes.entries()].filter(([key, value]) => previousNodes.has(key) && previousNodes.get(key) !== value).length,
    added_relationships: [...currentRelationships].filter((value) => !previousRelationships.has(value)).length,
    removed_relationships: [...previousRelationships].filter((value) => !currentRelationships.has(value)).length
  };
}

function relationshipSet(graph) {
  const set = new Set();
  for (const [family, entries] of Object.entries(graph.relationships || {})) {
    for (const entry of entries || []) set.add(`${family}:${canonicalJson(entry)}`);
  }
  return set;
}

async function readManifestIfPresent(filePath, expectedModelKey) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw integrityError('The ModelGraph manifest is not valid JSON.', { model_key: expectedModelKey });
  }
  assertManifest(manifest, expectedModelKey);
  return manifest;
}

async function writeGraphIfAbsent(filePath, graph, expectedSha256, { referenced = false } = {}) {
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assertGraphIntegrity(existing, graph.graph_id, expectedSha256);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      if (referenced) {
        if (error?.code === 'MODEL_GRAPH_INTEGRITY_ERROR') throw error;
        throw integrityError('An existing persisted ModelGraph is unreadable.', { graph_id: graph.graph_id });
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

  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(graph, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.link(temporary, filePath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const concurrentlyPublished = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assertGraphIntegrity(concurrentlyPublished, graph.graph_id, expectedSha256);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function assertGraph(graph) {
  if (!graph || graph.version !== 'model-graph.v1' || graph.kind !== 'model_graph' || !GRAPH_ID_PATTERN.test(String(graph.graph_id || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'A valid model-graph.v1 document is required.');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(String(graph.model_revision || '')) || !Array.isArray(graph.nodes) || !graph.relationships) {
    throw new AgentContractError('INVALID_ARGUMENT', 'The ModelGraph document is incomplete.');
  }
  validateModelGraphSemantics(graph);
}

function assertGraphIntegrity(graph, expectedGraphId, expectedSha256) {
  try {
    assertGraph(graph);
  } catch {
    throw integrityError('The persisted ModelGraph document is structurally invalid.', { graph_id: expectedGraphId });
  }
  const actualSha256 = sha256Canonical(graph);
  if (graph.graph_id !== expectedGraphId || (expectedSha256 && actualSha256 !== expectedSha256)) {
    throw integrityError('The persisted ModelGraph failed its content-integrity check.', {
      graph_id: expectedGraphId,
      actual_graph_id: graph.graph_id
    });
  }
}

function assertManifest(manifest, expectedModelKey) {
  const valid = manifest?.version === MODEL_GRAPH_STORE_VERSION
    && manifest.kind === 'model_graph_manifest'
    && manifest.model_key === expectedModelKey
    && MODEL_KEY_PATTERN.test(String(manifest.model_key || ''))
    && GRAPH_ID_PATTERN.test(String(manifest.current_graph_id || ''))
    && Array.isArray(manifest.versions)
    && manifest.version_count === manifest.versions.length
    && manifest.versions.length > 0;
  if (!valid) throw integrityError('The persisted ModelGraph manifest is structurally invalid.', { model_key: expectedModelKey });
  try {
    if (modelKeyForIdentity(manifest.identity) !== expectedModelKey || manifest.identity.sensitive_values_persisted !== false) {
      throw new Error('identity mismatch');
    }
  } catch {
    throw integrityError('The persisted ModelGraph manifest identity does not match its model key.', { model_key: expectedModelKey });
  }
  const graphIds = new Set();
  for (const [index, version] of manifest.versions.entries()) {
    const expectedSequence = index + 1;
    const previousGraphId = index === 0 ? null : manifest.versions[index - 1].graph_id;
    const versionValid = version?.sequence === expectedSequence
      && GRAPH_ID_PATTERN.test(String(version.graph_id || ''))
      && !graphIds.has(version.graph_id)
      && /^sha256:[0-9a-f]{64}$/.test(String(version.model_revision || ''))
      && /^sha256:[0-9a-f]{64}$/.test(String(version.content_sha256 || ''))
      && version.artifact_path === `graphs/${version.graph_id}.json`
      && version.delta_from_previous?.previous_graph_id === previousGraphId
      && Number.isFinite(Date.parse(version.created_at));
    if (!versionValid) {
      throw integrityError('The persisted ModelGraph manifest version chain is invalid.', {
        model_key: expectedModelKey,
        sequence: version?.sequence ?? null
      });
    }
    graphIds.add(version.graph_id);
  }
  const current = manifest.versions.find((entry) => entry.graph_id === manifest.current_graph_id);
  if (!current || current.model_revision !== manifest.current_model_revision
    || !Number.isFinite(Date.parse(manifest.created_at))
    || !Number.isFinite(Date.parse(manifest.updated_at))) {
    throw integrityError('The persisted ModelGraph manifest current pointer is inconsistent.', { model_key: expectedModelKey });
  }
}

function assertModelKey(modelKey) {
  if (!MODEL_KEY_PATTERN.test(String(modelKey || ''))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'model_key has an invalid format.');
  }
}

function integrityError(message, details) {
  return new AgentContractError('MODEL_GRAPH_INTEGRITY_ERROR', message, { details });
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
  await fs.rename(temporary, filePath);
}

function normalizeTaskId(value) {
  if (value === null || value === undefined) return null;
  if (!/^task_[0-9a-f-]+$/i.test(String(value))) {
    throw new AgentContractError('INVALID_ARGUMENT', 'source_task_id has an invalid format.');
  }
  return String(value);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function releaseOwnedLock(lockPath, owner) {
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    if (lock.owner === owner) await fs.rm(lockPath, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
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
