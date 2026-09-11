import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { compileModelAccessibilityTask } from './model-accessibility-tasks.mjs';
import { prepareTaskOwnedCreationDsl, validateTaskOwnedCreationDocument } from './agent-dsl-policy.mjs';
import { HOST_CREATION_METADATA_VERSION, validateHostAttributeValues } from './host-creation-metadata.mjs';

const hostOptions = new WeakMap();
const json = value => JSON.parse(JSON.stringify(value));
const hash = value => sha256Canonical(json(value));
const fail = message => { throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', `Host provisioning: ${message}`); };
const VERSION = 'host-common-creation-packet.v1';
const inputsAllowed = new Set(['task', 'runtime', 'recursive_limit', 'timeout_ms', 'session_contract', 'connection_task_id']);

/** Host code only. No tool schema or serialized MCP field can carry this
 * WeakMap brand. Metadata belongs to new roots in this exact common source. */
export function prepareHostCommonCreation({ instruction, idempotency_key, inputs, metadata = [] } = {}) {
  if (typeof instruction !== 'string' || !instruction || typeof idempotency_key !== 'string' || !idempotency_key
    || !inputs || Object.keys(inputs).some(key => !inputsAllowed.has(key)) || !['queue', 'mock'].includes(inputs.runtime)) fail('explicit common task, runtime and stable key are required');
  const source = json(inputs.task), compiled = compileModelAccessibilityTask(source);
  if (!['cabinet', 'window', 'door', 'sink_counter'].includes(source.kind)) fail('unsupported parameter source');
  const rootIds = compiled.bundle.part_graph.roots.map(root => root.instance_id || root.part_id);
  if (!Array.isArray(metadata) || metadata.length > 24) fail('metadata requires at most 24 explicit root records');
  for (const item of metadata) {
    if (!item || Object.keys(item).some(key => !['root_id', 'dictionary', 'attributes', 'tag'].includes(key)) || !rootIds.includes(item.root_id)) fail('metadata must name a new source root');
    validateHostAttributeValues(item.dictionary, item.attributes);
    if (item.tag !== undefined && (typeof item.tag !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.tag))) fail('tag needs a bounded literal logical name');
  }
  const options = { intent: 'create_model', instruction, idempotency_key, inputs: json(inputs) };
  hostOptions.set(options, { runtime: inputs.runtime, source_task: source, source_hash: hash(source), source_dsl_hash: hash(JSON.parse(compiled.inputs.code)), root_ids: rootIds, metadata: json(metadata) });
  return options;
}

export function hasHostCommonCreation(options) { return hostOptions.has(options); }

export async function attachHostCreationPacket({ options, task, taskStore } = {}) {
  const requested = hostOptions.get(options);
  if (!requested) return task;
  if (hash(task.inputs.task) !== requested.source_hash || task.inputs.runtime !== requested.runtime || task.intent !== 'create_model') fail('created task differs from the branded source');
  const existing = task.private?.host_creation_packet;
  if (existing) {
    const verified = await readHostCreationPacket(task, taskStore);
    if (verified.request_hash !== hash(requested)) fail('an existing key cannot replace frozen host metadata');
    return task;
  }
  if (task.state !== 'created' || task.private?.creation || task.private?.common_task) fail('host packet must be frozen before first execution; later baseline provisioning is forbidden');
  const core = { version: VERSION, task_id: task.task_id, request_hash: hash(requested), ...json(requested) };
  const packet = { ...core, integrity_hmac: await taskStore.mutationReceiptLedger.sign(core) };
  return taskStore.update(task.task_id, { private: { ...task.private, host_creation_packet: packet } });
}

export async function readHostCreationPacket(task, taskStore) {
  const packet = task.private?.host_creation_packet;
  if (!packet) return null;
  const { integrity_hmac, ...core } = packet;
  if (core.version !== VERSION || core.task_id !== task.task_id || integrity_hmac !== await taskStore.mutationReceiptLedger.sign(core)
    || core.runtime !== task.inputs.runtime || core.source_hash !== hash(task.inputs.task) || core.source_hash !== hash(core.source_task)) fail('source packet integrity or task binding mismatch');
  return core;
}

export async function prepareHostCreationDsl({ task, taskStore, sourceCode, iteration } = {}) {
  const packet = await readHostCreationPacket(task, taskStore);
  if (!packet) return null;
  if (iteration !== 0 || hash(JSON.parse(sourceCode)) !== packet.source_dsl_hash) fail('only exact initially frozen common DSL may receive host metadata');
  const prepared = prepareTaskOwnedCreationDsl(sourceCode, { taskId: task.task_id, iteration });
  const tags = new Map();
  const operations = [];
  for (const item of packet.metadata) {
    const target_id = prepared.identity_map[item.root_id];
    if (!target_id) fail('prepared root mapping is unavailable');
    operations.push({ op: 'attribute', target_id, dictionary: item.dictionary, attributes: json(item.attributes) });
    if (item.tag) {
      if (!tags.has(item.tag)) {
        const name = `${prepared.creation_scope.namespace}tag_${hash(item.tag).slice(7, 23)}`;
        tags.set(item.tag, name); operations.push({ op: 'tag', name, visible: true });
      }
      operations.push({ op: 'assign_tag', target_id, tag: tags.get(item.tag) });
    }
  }
  prepared.document.operations.push(...operations);
  prepared.document.creation_scope.host_metadata = { version: HOST_CREATION_METADATA_VERSION,
    root_ids: packet.root_ids.map(id => prepared.identity_map[id]), tags: [...tags.values()] };
  validateTaskOwnedCreationDocument(prepared.document);
  prepared.code = JSON.stringify(prepared.document);
  prepared.host_provisioning = { packet_hash: hash(packet), prepared_document_hash: hash(prepared.document),
    source_hash: packet.source_hash, root_map: Object.fromEntries(packet.root_ids.map(id => [id, prepared.identity_map[id]])),
    metadata_hash: hash(operations), tag_map: Object.fromEntries(tags) };
  return prepared;
}

export async function verifyHostCreationCapture({ task, taskStore, prepared, modelGraph } = {}) {
  const packet = await readHostCreationPacket(task, taskStore);
  if (!packet) return;
  const binding = task.private.creation.host_provisioning;
  if (!binding || binding.packet_hash !== hash(packet) || binding.prepared_document_hash !== hash(prepared.document)
    || hash(binding.root_map) !== hash(Object.fromEntries(packet.root_ids.map(id => [id, prepared.identity_map[id]])))) fail('prepared creation identity or DSL binding mismatch');
  for (const item of packet.metadata) {
    const target = binding.root_map[item.root_id];
    const nodes = modelGraph.nodes.filter(node => node.node_type === 'occurrence' && !node.parent_id && node.reference === target);
    if (nodes.length !== 1) fail('committed metadata target has no unique native root readback');
    const node = nodes[0];
    for (const [key, value] of Object.entries(item.attributes)) if (!Object.hasOwn(node.attributes?.[item.dictionary] || {}, key) || hash(node.attributes[item.dictionary][key]) !== hash(value)) fail('committed literal metadata readback mismatch');
    if (item.tag && node.tag !== binding.tag_map[item.tag]) fail('committed root tag readback mismatch');
  }
}
