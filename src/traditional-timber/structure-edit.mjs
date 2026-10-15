import { sha256Canonical } from '../agent-contract.mjs';
import { assemblyError, normalizeTraditionalAssembly } from './assembly-plan.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const panels = new Set(['enclosure_opening', 'joinery_panel']);
const supported = new Set(['frame_grid', 'path_frame', 'roof_unit', 'eave_unit', 'rail_seat', ...panels]);
const fail = (message, details = {}) => assemblyError('UNSAFE_TOPOLOGY_MIGRATION', message, 'parameter_edit.structure_change', details);

/** A deterministic proposal only. This never grants execution authority and
 * must be applied through the creation-bound reviewed definition replacement.
 * Generated station/column ordinals are explicitly migrated, not silently
 * treated as persistent physical identities across a changed bay count. */
export function planTraditionalBayStructureChange(task, change) {
  if (task?.kind !== 'traditional_assembly') fail('Bay structure changes require a stored traditional_assembly source.');
  if (!object(change) || !['insert_bay', 'remove_bay'].includes(change.operation)) fail('Use an explicit insert_bay or remove_bay structure_change.');
  const insert = change.operation === 'insert_bay';
  const allowed = new Set(['operation', 'segment_id', 'bay_index', ...(insert ? ['length_mm'] : [])]);
  if (Object.keys(change).some(key => !allowed.has(key))) fail('The structure change contains unsupported fields; dimensions and arbitrary plan replacement cannot be mixed with it.');
  const normalized = normalizeTraditionalAssembly(task.assembly, task.parameters);
  if (normalized.plan.representation.scene_id) fail('This root belongs to a scene with external connections; bay topology changes require an explicit scene-connection migration first.');
  const { layout } = normalized.plan;
  if (!['path', 'grid'].includes(layout.kind) || layout.kind === 'path' && layout.segments.length !== 1) {
    fail('Bay insertion/removal currently supports one straight path or one rectangular grid; corner/multiple path segments need a separate migration.');
  }
  const segmentId = layout.kind === 'grid' ? 'grid' : layout.segments[0].id;
  if (change.segment_id !== segmentId) fail(`Use the exact stored segment_id ${segmentId}.`);
  const parameter = layout.kind === 'grid' ? layout.x_bays_parameter : layout.segments[0].bay_lengths_parameter;
  if (task.assembly.parameter_units?.[parameter] && task.assembly.parameter_units[parameter] !== 'mm') fail('Bay structure changes currently require millimetre bay arrays.');
  const before = task.parameters[parameter];
  if (!Array.isArray(before) || !before.length) fail('The stored layout has no explicit bay-length array.');
  const index = change.bay_index;
  if (!Number.isInteger(index) || index < 0 || index > before.length - (insert ? 0 : 1)) fail('bay_index must identify a zero-based insertion position or existing bay.');
  if (insert && (!Number.isFinite(change.length_mm) || change.length_mm < 1 || change.length_mm > 10000)) fail('insert_bay requires length_mm in [1,10000]; supported clear spans are checked during compilation.');
  if (insert && before.length >= 16 || !insert && before.length <= 1) fail('A structure change must leave 1..16 bays.');
  const nextTask = structuredClone(task), next = nextTask.parameters[parameter];
  const migratedBindings = [];
  for (const part of nextTask.assembly.assemblies) {
    const resolved = normalized.plan.assemblies.find(candidate => candidate.id === part.id);
    const bindings = nextTask.assembly.parameter_bindings?.[part.id] || {};
    if (!supported.has(part.family)) fail(`Assembly ${part.id} (${part.family}) has no safe bay migration; its explicit geometry/placement must be resolved separately.`, { assembly_id: part.id });
    if (Object.values(bindings).includes(parameter)) fail(`Bay array ${parameter} is also bound to ${part.id}; this dependency cannot be migrated automatically.`, { assembly_id: part.id });
    if (part.family === 'roof_unit' && !['gable', 'flat'].includes(resolved.parameters.type ?? 'gable')) fail(`Roof ${resolved.parameters.type} does not support bay insertion/removal; only gable and flat roofs are supported.`);
    if (!panels.has(part.family)) continue;
    if (Object.hasOwn(bindings, 'segment_id') || Object.hasOwn(bindings, 'bay_index')) fail(`Assembly ${part.id} uses parameter-bound bay addressing; use an explicit reviewed migration instead.`, { assembly_id: part.id });
    const bay = part.parameters?.bay_index;
    if (part.parameters?.segment_id !== segmentId || !Number.isInteger(bay) || bay < 0 || bay >= before.length || part.origin_mm || part.rotation_z_deg) {
      fail(`Assembly ${part.id} must have a literal segment_id/bay_index attachment without independent placement.`, { assembly_id: part.id });
    }
    if (!insert && bay === index) fail(`Cannot remove bay ${index}: attached assembly ${part.id} (${part.family}) must be explicitly relocated or removed first.`, { assembly_id: part.id, bay_index: index });
    const after = insert ? bay >= index ? bay + 1 : bay : bay > index ? bay - 1 : bay;
    part.parameters.bay_index = after;
    migratedBindings.push({ assembly_id: part.id, segment_id: segmentId, before_bay_index: bay, after_bay_index: after, semantic_id_preserved: true });
  }
  if (insert) next.splice(index, 0, change.length_mm);
  else next.splice(index, 1);
  // The complete new array is an explicit project choice. Preserve the old
  // provenance in the migration report without claiming a new historical source.
  const previousSource = structuredClone(task.assembly.parameter_sources?.[parameter] || null);
  nextTask.assembly.parameter_sources = { ...nextTask.assembly.parameter_sources,
    [parameter]: { basis: 'selected', note: `Explicit ${change.operation} at ${segmentId} bay ${index}; prior parameter provenance is retained in the structure migration record.` } };
  const stationMap = Object.fromEntries(Array.from({ length: before.length + 1 }, (_, station) => {
    const mapped = insert ? station <= index ? station : station + 1 : station === index + 1 ? null : station > index + 1 ? station - 1 : station;
    return [`${segmentId}-station-${station}`, mapped === null ? null : `${segmentId}-station-${mapped}`];
  }));
  const frame = task.assembly.assemblies.find(part => ['frame_grid', 'path_frame'].includes(part.family));
  if (!frame) fail('Bay structure changes require a frame bound to the stored layout.');
  const columnMap = Object.fromEntries(Object.entries(stationMap).flatMap(([from, to]) => ['left', 'right'].map(side => [
    `${task.id}-${frame.id}-column-${from}-${side}`, to === null ? null : `${task.id}-${frame.id}-column-${to}-${side}`
  ])));
  const migration = {
    version: 'traditional-bay-topology-migration.v1', operation: change.operation, segment_id: segmentId, bay_parameter: parameter,
    before_bay_count: before.length, after_bay_count: next.length,
    bay_index_map: before.map((_, bay) => ({ before: bay, after: insert ? bay >= index ? bay + 1 : bay : bay === index ? null : bay > index ? bay - 1 : bay })),
    station_id_map: stationMap, column_occurrence_id_map: columnMap,
    station_identity_rule: 'Keep the left boundary of the changed bay; insert/remove its right boundary and explicitly remap later ordinal IDs.',
    added_station_ids: insert ? [`${segmentId}-station-${index + 1}`] : [],
    migrated_bindings: migratedBindings, preserved_assembly_ids: task.assembly.assemblies.map(part => part.id),
    previous_parameter_source: previousSource,
    before_task_hash: sha256Canonical(task), after_task_hash: sha256Canonical(nextTask),
    quality_requirements: 'Recompile next_source.task and bind its new detail specification to the reviewed edit before quality verification.',
    external_subentity_references: 'Generated station ordinals are not persistent native subentity identities; consumers must use this migration.',
    geometry_quality_accepted: false
  };
  return { task: nextTask, changes: { [parameter]: [...next] }, migration };
}
