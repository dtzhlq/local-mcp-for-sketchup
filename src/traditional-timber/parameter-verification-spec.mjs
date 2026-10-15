import { AgentContractError, sha256Canonical } from '../agent-contract.mjs';
import { compileModelAccessibilityTask } from '../model-accessibility-tasks.mjs';
import { freezeDetailSpecification } from '../detail-quality.mjs';

const fail = message => { throw new AgentContractError('ARTIFACT_INTEGRITY_ERROR', message); };

// Recompile each current creation-bound root independently. After splitting a
// shared definition, each entry may have a different topology and dimensions.
// The original creation requirements are never overwritten by this new proof.
export function compileCurrentTraditionalParameterVerification({ creation, record, graph }) {
  const specs = [], paths = {}, roots = [], rootBindings = [];
  for (const entry of record.entries) {
    if (entry.source?.kind !== 'common_task' || entry.source.task?.kind !== 'traditional_assembly' || entry.source.part_id_aliases) fail('Current topology verification requires unaliased traditional assembly sources for every recorded root.');
    const matches = graph.nodes.filter(node => node.node_type === 'occurrence' && !node.parent_id &&
      (entry.target.entity_path ? node.entity_path === entry.target.entity_path : node.reference === entry.target.target_id || node.persistent_id === entry.target.target_id));
    if (matches.length !== 1) fail('A current source root is missing or ambiguous during topology verification.');
    const node = matches[0], scopedTask = structuredClone(entry.source.task);
    if (scopedTask.instances) {
      scopedTask.instances = scopedTask.instances.filter(instance => instance.id === entry.logical_instance_id);
      if (scopedTask.instances.length !== 1) fail('The current source has no exact logical root placement.');
    }
    const bundle = compileModelAccessibilityTask(scopedTask).bundle;
    if (bundle.part_graph.roots.length !== 1 || bundle.part_graph.roots[0].instance_id !== entry.logical_instance_id) fail('The recompiled root identity differs from its stored source.');
    const spec = bundle.detail_spec;
    specs.push(spec); roots.push(node);
    const mapPath = logical => {
      if (!Array.isArray(logical) || logical[0] !== entry.logical_instance_id) fail('A recompiled requirement crosses its root binding.');
      const native = logical.map((id, index) => index === 0 ? String(node.reference || node.persistent_id)
        : entry.identity_map?.[id] || creation.identity_map?.[id] || id);
      for (let length = 1; length <= logical.length; length++) paths[JSON.stringify(logical.slice(0, length))] = native.slice(0, length);
    };
    for (const part of spec.required_parts) mapPath(part.instance_path);
    for (const region of spec.required_voids || []) mapPath(region.instance_path);
    for (const check of spec.native_joint_checks || []) { mapPath(check.first_instance_path); mapPath(check.second_instance_path); }
    rootBindings.push({ logical_instance_id: entry.logical_instance_id, target: structuredClone(entry.target),
      source_hash: sha256Canonical(entry.source), specification_hash: sha256Canonical(spec),
      topology_migration_count: entry.source.topology_migrations?.length || 0 });
  }
  if (!specs.length) fail('Topology verification requires at least one creation-bound root.');
  const corners = roots.map(node => node.bounding_box);
  if (corners.some(box => !box || !['min', 'max'].every(key => Array.isArray(box[key]) && box[key].length === 3 && box[key].every(Number.isFinite))
    || box.min.some((value, axis) => box.max[axis] <= value))) {
    throw new AgentContractError('MODEL_REVISION_INCOMPLETE', 'Current root bounds are required for the post-structure overview.');
  }
  const min = [0, 1, 2].map(axis => Math.min(...corners.map(box => box.min[axis])));
  const max = [0, 1, 2].map(axis => Math.max(...corners.map(box => box.max[axis])));
  const target = min.map((value, axis) => (value + max[axis]) / 2);
  const distance = Math.max(1000, Math.hypot(...min.map((value, axis) => max[axis] - value))) * 1.8;
  const view = { id: 'current-traditional-source-overview', kind: 'overview', width: 1600, height: 1000,
    camera: { eye: [target[0] + distance * .7, target[1] - distance, target[2] + distance * .6], target, up: [0, 0, 1], fov: 38, projection: 'perspective' } };
  const specification = { ...specs[0], deferred_scene_overview: false,
    required_parts: specs.flatMap(spec => spec.required_parts),
    required_voids: specs.flatMap(spec => spec.required_voids || []),
    native_joint_checks: specs.flatMap(spec => spec.native_joint_checks || []),
    required_views: [{ id: view.id, kind: view.kind, min_width: 1400, min_height: 900 }],
    connection_checks: specs.flatMap((spec, index) => (spec.connection_checks || []).map(check => ({ ...check, root_instance_id: rootBindings[index].logical_instance_id }))),
    compiler_expected_values: { kind: 'compiler_expected_values', by_root: specs.map((spec, index) => ({ root_instance_id: rootBindings[index].logical_instance_id, values: spec.compiler_expected_values })) },
    parameter_sources: Object.fromEntries(specs.map((spec, index) => [rootBindings[index].logical_instance_id, spec.parameter_sources])),
    verification_scope: 'all_current_creation_source_roots_each_at_its_own_parameter_version', root_bindings: rootBindings };
  return { frozen_spec: freezeDetailSpecification(specification), views: [view], occurrence_path_map: paths,
    verification_scope: specification.verification_scope, root_bindings: rootBindings };
}
