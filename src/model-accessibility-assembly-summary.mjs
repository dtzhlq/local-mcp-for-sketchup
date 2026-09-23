import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { buildModelGraph, validateModelGraphSemantics } from './model-graph.mjs';
import { modelRevisionForAdoption } from './existing-model-editing.mjs';

const cache = new WeakMap();
const clone = value => structuredClone(value);
const fail = message => { throw new AgentContractError('MODEL_REVISION_INCOMPLETE', message); };
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

function header(report) {
  if (report?.runtime !== 'queue' || report.read_only !== true || report.recursive_projection !== 'assembly-merkle.v2'
    || report.assembly_summary_depth !== 2 || report.model_revision_complete !== true || !digest(report.model_revision) || !report.document_id || !report.session_id
    || !report.model_identity?.runtime_object_id || !Array.isArray(report.entities)) fail('Native assembly summary lacks a complete document-bound revision.');
  modelRevisionForAdoption(report);
  // Compact snapshots omit revision metadata; bind it only from the validated
  // native header so downstream delivery retains the same completeness proof.
  if (report.snapshot) report.snapshot = { ...report.snapshot, ...Object.fromEntries(
    Object.entries(report).filter(([key]) => key.startsWith('model_revision'))) };
  return sha256Canonical({ revision: report.model_revision, document: report.document_id, session: report.session_id, identity: report.model_identity });
}

// The cache belongs to a Bridge object. Each reuse still obtains a NEW native
// global revision. A caller cannot supply a graph or revision to skip this read.
// Only one revision/root set is retained, and returned values never alias it.
export async function adoptAssemblySummary({ bridge, rootPaths, rootIds, timeoutMs, recursiveLimit = 10000 } = {}) {
  if (!bridge || (rootPaths === undefined) === (rootIds === undefined)) throw new AgentContractError('INVALID_ARGUMENT', 'Supply exactly one explicit assembly root path/id list.');
  const values = rootPaths || rootIds;
  if (!Array.isArray(values) || !values.length || values.length > 12 || new Set(values).size !== values.length
    || values.some(v => typeof v !== 'string' || !v) || !Number.isInteger(recursiveLimit) || recursiveLimit < 1 || recursiveLimit > 50000)
    throw new AgentContractError('INVALID_ARGUMENT', 'Assembly summary needs 1..12 distinct roots and a limit of 1..50000 containers.');
  const fresh = await bridge.adopt_open_model({ runtime: 'queue', read_only: true, assembly_projection: true, recursive: false, timeoutMs });
  const identity = header(fresh);
  if (rootIds) rootPaths = rootIds.map(id => {
    const rows = fresh.entities.filter(e => ['group','component_instance'].includes(e.entity_type) && [e.id,e.reference].includes(id));
    if (rows.length !== 1 || !/^[1-9]\d*$/.test(String(rows[0].persistent_id))) fail(`Assembly root ID does not identify one native container: ${id}`);
    return `pid:${rows[0].persistent_id}`;
  });
  if (rootPaths.some(p => !/^pid:[1-9]\d*$/.test(p))) throw new AgentContractError('INVALID_ARGUMENT', 'Assembly summary roots must be top-level pid paths.');
  const key = sha256Canonical({ identity, rootPaths, recursiveLimit });
  const previous = cache.get(bridge);
  if (previous?.key === key) return { ...clone(previous.report), snapshot:clone(fresh.snapshot), entities:clone(fresh.entities),
    model_info:clone(fresh.model_info), model_modified:fresh.model_modified };
  const report = await bridge.adopt_open_model({ runtime: 'queue', read_only: true, assembly_projection: true,
    recursive: true, recursive_roots: rootPaths, recursive_limit: recursiveLimit, timeoutMs });
  if (header(report) !== identity) throw new AgentContractError('MODEL_REVISION_MISMATCH', 'Model changed while reading the assembly summary.');
  if (report.assembly_projection_complete !== true || report.recursive_truncated !== false
    || report.occurrence_contract !== 'canonical-assembly-path.v2'
    || JSON.stringify(report.recursive_root_paths) !== JSON.stringify(rootPaths)
    || !Array.isArray(report.recursive_index) || report.recursive_total_seen !== report.recursive_index.length
    || report.recursive_index.length > recursiveLimit) fail('Native assembly summary is truncated or its roots/coverage differ from the request.');
  const graph = buildModelGraph(report);
  validateModelGraphSemantics(graph);
  if (graph.completeness.assembly_scope_complete !== true || graph.completeness.complete || graph.completeness.scope_complete)
    fail('Assembly projection cannot establish complete container coverage.');
  cache.set(bridge, { key, report: clone(report) });
  return report;
}
