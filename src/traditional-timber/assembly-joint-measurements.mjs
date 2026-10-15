import { AgentContractError, sha256Canonical } from '../agent-contract.mjs';
import { geometryDistance } from '../model-geometry-service.mjs';

export const ASSEMBLY_JOINT_MEASUREMENTS_VERSION = 'traditional-assembly-joints.v1';
const METHOD = 'minimum_native_triangle_surface_distance';
const MAX_CHECKS = 36;
const MAX_PAIRS = 2_000_000;
const PATH = /^pid:[1-9]\d*(?:\.[1-9]\d*)*$/;
const same = (a, b) => sha256Canonical(a ?? null) === sha256Canonical(b ?? null);
const clone = value => structuredClone(value);

// These are frozen sampling requirements, not measurements. Select member
// wrappers visible in the compact native assembly index, avoiding roof tiles.
export function traditionalAssemblyJointChecks(graph) {
  const parts = new Map(graph.parts.map(part => [part.id, part]));
  return graph.roots.flatMap(root => {
    const members = [];
    for (const major of parts.get(root.part_id)?.assembly?.children || []) {
      for (const member of parts.get(major.part_id)?.assembly?.children || []) {
        const part = parts.get(member.part_id);
        if (!part?.assembly?.children?.some(child => parts.get(child.part_id)?.shape)) continue;
        members.push({ role: part.role, instance_path: [root.instance_id, major.instance_id || major.part_id, member.instance_id || member.part_id] });
      }
    }
    const first = role => members.find(member => member.role === role);
    return [
      ['column_beam', 'column', 'beam_frame'],
      ['frame_purlin', 'beam_frame', 'purlin_and_strut'],
      ['purlin_rafter', 'purlin_and_strut', 'rafter']
    ].flatMap(([kind, left, right]) => {
      const a = first(left), b = first(right);
      return a && b ? [{ id: `${root.instance_id}:${kind}`, kind,
        first_instance_path: a.instance_path, second_instance_path: b.instance_path,
        expected_distance_mm: 0, tolerance_mm: 1, tolerance_source: 'project_engineering_default',
        compiler_contact_basis: 'traditional_frame_lap_and_shared_roof_bearing.v1',
        evidence_level: 'compiler_expected_coordinates', scope: 'selected_member_pair_surface_gap_only' }] : [];
    });
  });
}

function checksFor(creation) {
  const frozen = creation?.frozen_spec;
  if (!frozen || sha256Canonical(frozen.specification) !== frozen.hash) {
    throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', 'Joint measurement requirements must match the frozen specification.');
  }
  const checks = frozen.specification.native_joint_checks || [];
  const ids = new Set();
  if (!Array.isArray(checks) || checks.length > MAX_CHECKS) throw new AgentContractError('INVALID_ARGUMENT', 'Joint sampling supports at most 36 frozen checks.');
  for (const check of checks) {
    if (!check?.id || ids.has(check.id) || !['column_beam', 'frame_purlin', 'purlin_rafter'].includes(check.kind)
      || ![check.first_instance_path, check.second_instance_path].every(p => Array.isArray(p) && p.length === 3 && p.every(id => typeof id === 'string' && id))
      || check.expected_distance_mm !== 0 || !Number.isFinite(check.tolerance_mm) || check.tolerance_mm < 0 || check.tolerance_mm > 10) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Invalid or duplicate frozen joint sampling requirement.');
    }
    ids.add(check.id);
  }
  return checks;
}

function sourceBinding(summary) {
  return { model_revision: summary?.model_revision, session_id: summary?.session_id,
    document_id: summary?.document_id, model_identity: clone(summary?.model_identity || null) };
}

function validSummary(summary, creation) {
  return creation.runtime === 'queue' && summary?.runtime === 'queue' && summary.read_only === true
    && summary.model_revision_complete === true && /^sha256:[a-f0-9]{64}$/.test(summary.model_revision || '')
    && summary.model_revision === creation.round?.snapshot?.model_revision
    && summary.assembly_projection_complete === true && summary.recursive_truncated === false
    && Boolean(summary.session_id && summary.document_id && summary.model_identity?.runtime_object_id)
    && Array.isArray(summary.recursive_index);
}

function resolveMember(summary, creation, logicalPath) {
  const wanted = creation.occurrence_path_map?.[JSON.stringify(logicalPath)]
    || logicalPath.map(id => creation.identity_map?.[id] || id);
  const matches = (summary.recursive_index || []).filter(row => same(
    (row.path_segments || []).map(segment => String(segment.reference || segment.persistent_id)), wanted));
  if (matches.length !== 1 || !PATH.test(matches[0].entity_path)) return null;
  return matches[0].entity_path;
}

function unresolved(check, reason, status = 'unverified') {
  return { ...clone(check), status, evidence_level: 'compiler_expected_coordinates',
    measured_distance_mm: null, reason, penetration_checked: false, bearing_capacity_checked: false };
}

function envelope(creation, summary, results, snapshotHandles = []) {
  return { version: ASSEMBLY_JOINT_MEASUREMENTS_VERSION, runtime: creation.runtime, read_only: true,
    specification_hash: creation.frozen_spec.hash, ...sourceBinding(summary), snapshot_handles: snapshotHandles,
    scope: 'selected_member_pairs_only', penetration_checked: false, full_collision_sweep: false, results };
}

function surface(snapshot, target) {
  const contexts = snapshot.contexts.filter(context => context.entity_path === target || context.entity_path.startsWith(`${target}.`));
  // A selected wrapper currently has one geometry leaf. Changed or ambiguous
  // subtree topology is unsupported, rather than silently broadening the pair.
  const measured = contexts.filter(context => context.faces?.length);
  if (measured.length !== 1) throw new Error('Selected member must have exactly one native face-bearing context.');
  const triangles = measured[0].faces.flatMap(face => face.triangles || []);
  if (!triangles.length || triangles.some(triangle => !Array.isArray(triangle) || triangle.length !== 3
    || triangle.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)))) {
    throw new Error('Native face triangulation is unavailable or invalid.');
  }
  return { context: measured[0].entity_path, triangles };
}

export async function readTraditionalAssemblyJointMeasurements({ bridge, creation, summary, timeoutMs } = {}) {
  const checks = checksFor(creation);
  if (!checks.length) return envelope(creation, summary, []);
  if (!validSummary(summary, creation)) return envelope(creation, summary, checks.map(check => unresolved(check, 'native_summary_or_committed_revision_unverified')));
  const pairs = checks.map(check => ({ check, first: resolveMember(summary, creation, check.first_instance_path), second: resolveMember(summary, creation, check.second_instance_path) }));
  const targets = [...new Set(pairs.flatMap(pair => [pair.first, pair.second]).filter(Boolean))];
  if (!targets.length) return envelope(creation, summary, checks.map(check => unresolved(check, 'native_member_identity_missing_or_ambiguous')));
  // Twelve root placements are supported elsewhere. Keep each native request
  // below its 32-target limit and require the same document/revision throughout.
  const captures = new Map(), snapshotHandles = [];
  for (let offset = 0; offset < targets.length; offset += 32) {
    const batch = targets.slice(offset, offset + 32);
    let query, reason;
    try {
      query = await bridge.query_model_geometry({ runtime: 'queue', targets: batch, recursive: true, detail: 'full',
        max_vertices: 40000, max_contexts: 128, timeoutMs });
    } catch (error) { reason = `native_geometry_read_unavailable:${error.code || 'runtime_error'}`; }
    const snapshot = query?.snapshot;
    const valid = query?.runtime === 'queue' && query.complete === true && snapshot?.version === 'model-geometry.v1'
      && snapshot.runtime === 'queue' && snapshot.complete === true && snapshot.units === 'mm'
      && same(sourceBinding(snapshot), sourceBinding(summary)) && Array.isArray(snapshot.contexts)
      && query.model_revision === summary.model_revision
      && query.snapshot_handle === `geometry:${sha256Canonical(snapshot).slice(7)}`;
    if (!valid) reason ||= 'native_geometry_source_or_completeness_mismatch';
    else snapshotHandles.push(query.snapshot_handle);
    for (const target of batch) captures.set(target, { snapshot, handle: query?.snapshot_handle, reason });
  }
  const results = pairs.map(({ check, first, second }) => {
    if (!first || !second) return unresolved(check, 'native_member_identity_missing_or_ambiguous');
    const sourceA = captures.get(first), sourceB = captures.get(second);
    if (sourceA.reason || sourceB.reason) return unresolved(check, sourceA.reason || sourceB.reason);
    try {
      const a = surface(sourceA.snapshot, first), b = surface(sourceB.snapshot, second);
      if (a.context === b.context) return unresolved(check, 'distinct_native_member_contexts_required');
      const value = geometryDistance({ points: [], segments: [], triangles: a.triangles }, { points: [], segments: [], triangles: b.triangles }, MAX_PAIRS);
      return { ...clone(check), status: value <= check.tolerance_mm ? 'pass' : 'fail',
        evidence_level: 'native_surface_distance', measured_distance_mm: value, units: 'mm', method: METHOD,
        snapshot_handles: [...new Set([sourceA.handle, sourceB.handle])],
        first_entity_path: first, second_entity_path: second, first_geometry_context: a.context, second_geometry_context: b.context,
        native_triangle_counts: [a.triangles.length, b.triangles.length],
        penetration_checked: false, bearing_capacity_checked: false,
        interpretation: value <= check.tolerance_mm ? 'surfaces_within_gap_tolerance; intersection_not_excluded' : 'surface_gap_exceeds_tolerance' };
    } catch (error) {
      return { ...unresolved(check, String(error.message), 'unsupported'), first_entity_path: first, second_entity_path: second };
    }
  });
  return envelope(creation, summary, results, [...new Set(snapshotHandles)]);
}

// Only the gateway's direct read may set trusted=true. A client-supplied report,
// matching bounding boxes or compiler coordinates cannot provide native proof.
export function evaluateTraditionalAssemblyJoints({ creation, summary, measurements, trusted = false }) {
  const checks = checksFor(creation);
  const legacy = !Object.hasOwn(creation.frozen_spec.specification, 'native_joint_checks');
  if (!checks.length) return { evidence_level: legacy ? 'compiler_expected_coordinates' : 'not_applicable', results: [], issues: [] };
  const headerValid = trusted && validSummary(summary, creation) && measurements?.version === ASSEMBLY_JOINT_MEASUREMENTS_VERSION
    && measurements.runtime === 'queue' && measurements.read_only === true
    && measurements.specification_hash === creation.frozen_spec.hash && same(sourceBinding(measurements), sourceBinding(summary))
    && measurements.penetration_checked === false && measurements.full_collision_sweep === false;
  const results = checks.map(check => {
    const matches = (Array.isArray(measurements?.results) ? measurements.results : []).filter(row => row?.id === check.id), row = matches.length === 1 ? matches[0] : null;
    if (!headerValid || !row || !Object.keys(check).filter(key => key !== 'evidence_level').every(key => same(row[key], check[key]))) return unresolved(check, 'native_joint_report_unverified');
    if (['unsupported', 'unverified'].includes(row.status)) return clone(row);
    const first = resolveMember(summary, creation, check.first_instance_path), second = resolveMember(summary, creation, check.second_instance_path);
    if (!first || !second || row.first_entity_path !== first || row.second_entity_path !== second
      || row.first_geometry_context === row.second_geometry_context
      || ![row.first_geometry_context, row.second_geometry_context].every((p, i) => PATH.test(p || '') && (p === [first, second][i] || p.startsWith(`${[first, second][i]}.`)))
      || !Array.isArray(row.snapshot_handles) || !row.snapshot_handles.length
      || row.snapshot_handles.some(handle => !/^geometry:[a-f0-9]{64}$/.test(handle) || !measurements.snapshot_handles?.includes(handle))
      || row.method !== METHOD || row.units !== 'mm'
      || row.evidence_level !== 'native_surface_distance' || row.penetration_checked !== false || row.bearing_capacity_checked !== false
      || !Number.isFinite(row.measured_distance_mm) || row.measured_distance_mm < 0) return unresolved(check, 'native_joint_measurement_binding_invalid');
    return { ...clone(row), status: row.measured_distance_mm <= check.tolerance_mm ? 'pass' : 'fail' };
  });
  const issues = results.filter(row => row.status !== 'pass').map(row => ({ type: row.status === 'fail' ? 'assembly.joint_gap_exceeded' : 'assembly.joint_unverified',
    joint_id: row.id, status: row.status === 'fail' ? 'fail' : 'unverified', measurement_status: row.status,
    reason: row.reason || row.interpretation, actual_mm: row.measured_distance_mm, tolerance_mm: row.tolerance_mm }));
  return { evidence_level: results.every(row => row.evidence_level === 'native_surface_distance') ? 'native_surface_distance' : 'mixed_or_unverified', results, issues };
}
