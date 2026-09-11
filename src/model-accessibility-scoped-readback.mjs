import { AgentContractError, canonicalJson, sha256Canonical } from './agent-contract.mjs';
import { modelRevisionForAdoption } from './existing-model-editing.mjs';
import { buildModelGraph } from './model-graph.mjs';
import { mockPersistentEntityPath } from './object-identity.mjs';

export const PARAMETER_ROOT_READBACK_VERSION = 'bounded-parameter-root-readback.v1';
const MAX_ROOTS = 12;
const MAX_PER_REQUEST = 10000;
const same = (a, b) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const fail = (code, message, details = {}) => { throw new AgentContractError(code, message, { details: { ...details, mutation_performed: false } }); };
const rootPattern = runtime => runtime === 'queue' ? /^pid:[1-9]\d*$/ : /^mock:(?:group|component_instance):[A-Za-z0-9_-]+$/;
const pathPattern = runtime => runtime === 'queue' ? /^pid:[1-9]\d*(?:\.[1-9]\d*)*$/ : /^mock:(?:group|component_instance):[A-Za-z0-9_-]+(?:\/(?:group|component_instance|face|edge):[A-Za-z0-9_-]+)*$/;
const pathParts = (value, runtime) => runtime === 'queue' ? value.slice(4).split('.') : value.split('/');
const parentPath = (value, runtime) => {
  const parts = pathParts(value, runtime);
  return parts.length < 2 ? null : runtime === 'queue' ? `pid:${parts.slice(0, -1).join('.')}` : parts.slice(0, -1).join('/');
};
const rootPath = (value, runtime) => runtime === 'queue' ? `pid:${pathParts(value, runtime)[0]}` : pathParts(value, runtime)[0];

function assertOptions({ runtime, recursiveLimit, rootPaths, rootIds }) {
  if (!['mock', 'queue'].includes(runtime) || !Number.isInteger(recursiveLimit) || recursiveLimit < 1 || recursiveLimit > MAX_PER_REQUEST)
    fail('INVALID_ARGUMENT', 'Bounded readback requires mock/queue and a per-request recursive limit from 1 to 10000.');
  if ((rootPaths !== undefined) === (rootIds !== undefined)) fail('INVALID_ARGUMENT', 'Supply exactly one of rootPaths and rootIds.');
  const values = rootPaths ?? rootIds;
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_ROOTS || new Set(values).size !== values.length ||
    values.some(value => typeof value !== 'string' || !value.length || (rootPaths && !rootPattern(runtime).test(value))))
    fail('INVALID_ARGUMENT', 'Bounded readback requires 1 to 12 distinct explicit root references.');
}

function assertHeader(report, runtime) {
  if (report?.kind !== 'adopt_open_model' || report.runtime !== runtime || report.read_only !== true ||
    !Array.isArray(report.entities) || !report.snapshot || typeof report.snapshot !== 'object')
    fail('MODEL_REVISION_INCOMPLETE', 'Readback did not return a read-only adoption and full snapshot.');
  if (typeof report.document_id !== 'string' || !report.document_id || !report.model_identity ||
    (runtime === 'queue' && (typeof report.model_identity.runtime_object_id !== 'string' || !report.model_identity.runtime_object_id)))
    fail('MODEL_IDENTITY_MISMATCH', 'Readback has no exact document/runtime object identity.');
  if (runtime === 'queue') {
    modelRevisionForAdoption(report); // Complete global native coverage, independent of the scoped index.
    if (!/^sha256:[0-9a-f]{64}$/.test(report.model_revision) ||
      (report.model_revision_blockers !== undefined && !same(report.model_revision_blockers, [])) ||
      (report.snapshot.model_revision !== undefined && report.snapshot.model_revision !== report.model_revision) ||
      (report.snapshot.model_revision_complete !== undefined && report.snapshot.model_revision_complete !== true))
      fail('MODEL_REVISION_INCOMPLETE', 'Readback native revision is missing, inconsistent or blocked.');
  }
}

function compareHeader(reference, report, runtime) {
  assertHeader(report, runtime);
  if (!same(reference.model_identity, report.model_identity) || reference.document_id !== report.document_id || reference.session_id !== report.session_id)
    fail('MODEL_IDENTITY_MISMATCH', 'Active document or runtime identity changed during bounded root readback.');
  if (runtime === 'queue' && ['model_revision', 'model_revision_complete', 'model_revision_total_seen', 'model_revision_indexed',
    'model_revision_strategy', 'model_revision_unique_entities', 'model_revision_reachable_definitions', 'model_revision_blockers']
    .some(key => !same(reference[key], report[key])))
    fail('MODEL_REVISION_MISMATCH', 'Complete native revision changed during bounded root readback.');
  if (['snapshot', 'entities', 'model_info', 'classification_schemas', 'component_definition_summaries', 'model_modified']
    .some(key => !same(reference[key], report[key])))
    fail('MODEL_REVISION_MISMATCH', 'Snapshot or global root metadata changed during bounded root readback.');
}

// Each native scope includes all global top-level rows and descendants of just
// its one requested root. Duplicate global rows may be merged only byte-for-byte.
export function mergeParameterRootAdoptions({ reports, rootPaths, recursiveLimit, runtime, header = null }) {
  assertOptions({ runtime, recursiveLimit, rootPaths });
  if (!Array.isArray(reports) || reports.length !== rootPaths.length) fail('MODEL_REVISION_INCOMPLETE', 'Every requested root requires exactly one recorded readback.');
  const reference = header || reports[0]; assertHeader(reference, runtime);
  const merged = new Map(), requestRecords = [];
  let globalRows = null;
  for (let index = 0; index < reports.length; index++) {
    const report = reports[index], requestedRoot = rootPaths[index];
    compareHeader(reference, report, runtime);
    if (report.recursive !== true || report.recursive_truncated !== false || report.occurrence_contract !== 'canonical-occurrence-path.v1' ||
      !same(report.recursive_root_paths, [requestedRoot]) || !Array.isArray(report.recursive_index) ||
      report.recursive_index.length > recursiveLimit || report.recursive_index.length === 0 ||
      report.recursive_total_seen !== report.recursive_index.length)
      fail('MODEL_REVISION_INCOMPLETE', 'A bounded root readback is truncated, missing or has inconsistent coverage.', { requested_root: requestedRoot });
    const local = new Map();
    for (const entry of report.recursive_index) {
      if (!entry || typeof entry.entity_path !== 'string' || !pathPattern(runtime).test(entry.entity_path) || local.has(entry.entity_path) ||
        (entry.path !== undefined && entry.path !== entry.entity_path) || parentPath(entry.entity_path, runtime) !== entry.parent_entity_path)
        fail('MODEL_REVISION_INCOMPLETE', 'Scoped readback contains a malformed, repeated or misparented occurrence path.');
      if (entry.parent_entity_path !== null && rootPath(entry.entity_path, runtime) !== requestedRoot)
        fail('MODEL_REVISION_INCOMPLETE', 'Scoped readback includes descendants outside its declared root.');
      local.set(entry.entity_path, entry);
    }
    const selected = local.get(requestedRoot);
    if (!selected || selected.parent_entity_path !== null || !['group', 'component_instance'].includes(selected.entity_type))
      fail('MODEL_REVISION_INCOMPLETE', 'The requested top-level container is absent from its scoped readback.', { requested_root: requestedRoot });
    for (const entry of local.values()) if (entry.parent_entity_path !== null && !local.has(entry.parent_entity_path))
      fail('MODEL_REVISION_INCOMPLETE', 'Scoped readback has an unobserved parent path.');
    const topRows = [...local.values()].filter(entry => entry.parent_entity_path === null)
      .map(entry => [entry.entity_path, JSON.stringify(entry)]).sort(([a], [b]) => a.localeCompare(b));
    if (globalRows && !same(globalRows, topRows)) fail('MODEL_REVISION_MISMATCH', 'Global top-level rows disagree across scoped readbacks.');
    globalRows ||= topRows;
    for (const [entityPath, entry] of local) {
      if (merged.has(entityPath) && JSON.stringify(merged.get(entityPath)) !== JSON.stringify(entry))
        fail('MODEL_REVISION_MISMATCH', 'A repeated occurrence path has conflicting native data.', { entity_path: entityPath });
      if (!merged.has(entityPath)) merged.set(entityPath, structuredClone(entry));
    }
    requestRecords.push({ root_path: requestedRoot, recursive_limit: recursiveLimit, returned: local.size,
      recursive_total_seen: report.recursive_total_seen, recursive_truncated: false,
      report_sha256: sha256Canonical(report), global_model_revision: runtime === 'queue' ? report.model_revision : null,
      document_id: report.document_id, model_identity_sha256: sha256Canonical(report.model_identity) });
  }
  const result = { ...structuredClone(reports[0]), recursive_root_paths: [...rootPaths], recursive_index: [...merged.values()],
    recursive_total_seen: merged.size, recursive_truncated: false,
    read_only_nested_count: [...merged.values()].filter(entry => entry.editable === false).length,
    editable_nested_count: [...merged.values()].filter(entry => entry.editable === true).length };
  // Mock has no native global Merkle proof; calculate the normal content revision
  // for the merged adoption. Never label this as complete native coverage.
  if (runtime === 'mock') {
    delete result.model_revision;
    result.model_revision = modelRevisionForAdoption(result);
  }
  result.bounded_readback = { version: PARAMETER_ROOT_READBACK_VERSION, root_count: rootPaths.length, merged_unique_count: merged.size,
    read_only: true, requests: requestRecords, header_read_performed: header !== null,
    snapshot_sha256: sha256Canonical(reference.snapshot), document_id: reference.document_id,
    model_identity_sha256: sha256Canonical(reference.model_identity),
    evidence_level: runtime === 'queue' ? 'complete_native_revision_with_bounded_root_indexes' : 'mock_snapshot_equality_and_merged_content_revision',
    scope_complete: true, complete: false, global_counts_preserved: true,
    global_model_revision_total_seen: runtime === 'queue' ? reference.model_revision_total_seen : null,
    global_definition_occurrence_counts_preserved: true };
  const graph = buildModelGraph(result);
  if (graph.completeness.scope_complete !== true || graph.completeness.complete !== false)
    fail('MODEL_REVISION_INCOMPLETE', 'Merged roots did not form a complete scoped model graph.');
  return result;
}

export async function adoptParameterRoots({ bridge, runtime = 'mock', recursiveLimit = 5000, timeoutMs, rootPaths, rootIds } = {}) {
  assertOptions({ runtime, recursiveLimit, rootPaths, rootIds });
  if (typeof bridge?.adopt_open_model !== 'function') fail('INVALID_ARGUMENT', 'A bridge with read-only adoption support is required.');
  let header = null;
  if (rootIds) {
    header = await bridge.adopt_open_model({ runtime, read_only: true, recursive: false, recursive_limit: recursiveLimit, timeoutMs });
    assertHeader(header, runtime);
    rootPaths = rootIds.map(id => {
      const matches = header.entities.filter(entity => ['group', 'component_instance'].includes(entity.entity_type) && [entity.id, entity.reference].includes(id));
      if (matches.length !== 1) fail('MODEL_REVISION_INCOMPLETE', 'Creation root ID did not resolve to one current top-level container.', { root_id: id });
      const entity = matches[0];
      return runtime === 'queue' ? `pid:${entity.persistent_id}` : mockPersistentEntityPath([{ entity_type: entity.entity_type, reference: entity.id || entity.reference }]);
    });
    assertOptions({ runtime, recursiveLimit, rootPaths });
  }
  const reports = [], observedRows = new Map();
  for (const root of rootPaths) {
    const report = await bridge.adopt_open_model({ runtime, read_only: true, recursive: true, recursive_limit: recursiveLimit, recursive_roots: [root], timeoutMs });
    // Reject drift immediately, without spending another request on later roots.
    if (header || reports.length) compareHeader(header || reports[0], report, runtime);
    // Validate each subtree once instead of repeatedly rebuilding every prior
    // prefix graph. Keep cross-read duplicate conflict rejection immediate.
    mergeParameterRootAdoptions({ reports: [report], rootPaths: [root], recursiveLimit, runtime, header: header || reports[0] || null });
    for (const entry of report.recursive_index) {
      const bytes = JSON.stringify(entry);
      if (observedRows.has(entry.entity_path) && observedRows.get(entry.entity_path) !== bytes)
        fail('MODEL_REVISION_MISMATCH', 'A repeated occurrence path changed during bounded root readback.', { entity_path: entry.entity_path });
      observedRows.set(entry.entity_path, bytes);
    }
    reports.push(report);
  }
  return mergeParameterRootAdoptions({ reports, rootPaths, recursiveLimit, runtime, header });
}
