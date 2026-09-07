import { narrowDetailLayoutQa } from '../../src/detail-collision-review.mjs';
import { freezeDetailSpecification, evaluateDetailQuality } from '../../src/detail-quality.mjs';

// Independent inspection of an existing creation. Never imports a late response,
// replays DSL, or changes the original task's execution outcome.
export async function inspectCreatedDetail({ bridge, taskId, outputDir, assertActive, observedOccurrencePathMap, timeoutMs = 120000 }) {
  const task = await bridge.taskStore.getTask(taskId, { includePrivate: true });
  const creation = task.private?.creation;
  if (task.intent !== 'create_model' || creation?.runtime !== 'queue' || !creation.frozen_spec) {
    throw new Error('A persisted native creation with frozen detail requirements is required.');
  }
  const frozen = freezeDetailSpecification(creation.frozen_spec.specification);
  if (frozen.hash !== creation.frozen_spec.hash) throw new Error('Frozen specification integrity mismatch.');
  const occurrencePathMap = { ...creation.occurrence_path_map };
  const mapPath = ids => occurrencePathMap[JSON.stringify(ids)] || ids.map(id => creation.identity_map?.[id] || id);
  await assertActive();
  const { snapshot } = await bridge.inspect_model({ runtime: 'queue', timeoutMs, includeSnapshot: true });
  if (!snapshot?.model_revision || snapshot.model_revision_complete !== true) throw new Error('A fresh complete native model revision is required.');
  // A separate inspection can propose new descendant paths after a manual or
  // interrupted edit. This is not an edit receipt or a persisted task rebind.
  // Retain the original root occurrence and all frozen measurements. Reject
  // absent paths, unknown logical requirements, and duplicate part assignments.
  const observedBindings = [];
  if (observedOccurrencePathMap) {
    const allowed = new Set();
    for (const requirement of [...frozen.specification.required_parts, ...(frozen.specification.required_voids || []), ...(frozen.specification.required_views || [])]) {
      for (let length = 1; length <= (requirement.instance_path?.length || 0); length++) allowed.add(JSON.stringify(requirement.instance_path.slice(0, length)));
    }
    const seen = new Set();
    for (const [key, proposed] of Object.entries(observedOccurrencePathMap)) {
      if (!allowed.has(key) || !Array.isArray(proposed) || !proposed.length || proposed.some(id => typeof id !== 'string' || !id)) throw new Error('Unknown or invalid observed occurrence binding');
      const logical = JSON.parse(key), original = mapPath(logical);
      if (original.length !== proposed.length || original[0] !== proposed[0]) throw new Error('Observed rebinding cannot change the frozen root occurrence');
      const rootBefore = (creation.round?.snapshot?.geometry_occurrences || []).find(item => JSON.stringify(item.instance_path) === JSON.stringify([original[0]]));
      const rootNow = (snapshot.geometry_occurrences || []).find(item => JSON.stringify(item.instance_path) === JSON.stringify([original[0]]));
      if (!rootBefore?.persistent_path?.length || JSON.stringify(rootBefore.persistent_path) !== JSON.stringify(rootNow?.persistent_path)) throw new Error('Original root persistent identity is not verified');
      const matches = (snapshot.geometry_occurrences || []).filter(item => JSON.stringify(item.instance_path) === JSON.stringify(proposed));
      if (matches.length !== 1 || seen.has(JSON.stringify(proposed))) throw new Error('Observed binding is missing, ambiguous or reused');
      seen.add(JSON.stringify(proposed));
      occurrencePathMap[key] = [...proposed];
      observedBindings.push({ logical_path: logical, native_path: [...proposed], persistent_path: matches[0].persistent_path });
    }
  }

  let qa = await bridge.validate_model({ snapshot, runtime: 'queue', spec: creation.layout_spec || {}, includePreview: false });
  const collisionReview = await narrowDetailLayoutQa({ bridge, snapshot, qa, runtime: 'queue', timeoutMs });
  qa = collisionReview.qa;
  let captured = null, regionInspection = null;
  const errors = [];
  const views = (frozen.specification.required_views || []).map(requirement => {
    const view = { ...(task.inputs.views || []).find(item => item.id === requirement.id), ...requirement };
    return { ...view,
      ...(view.target_id ? { target_id: creation.identity_map?.[view.target_id] || view.target_id } : {}),
      ...(view.instance_path ? { instance_path: mapPath(view.instance_path) } : {}) };
  });
  if (views.length) {
    try {
      await assertActive();
      const handshake = await bridge.create_queue_handshake({ timeoutMs });
      captured = await bridge.capture_detail_views({ views, output_dir: outputDir, runtime: 'queue', timeoutMs, session_contract: handshake.session_contract });
      if (captured.restored !== true) errors.push({ stage: 'capture', message: 'View restoration was not verified.' });
    } catch (error) { errors.push({ stage: 'capture', message: String(error.message) }); }
  }
  const queries = (frozen.specification.required_voids || []).map(requirement => ({
    id: requirement.id, instance_path: mapPath(requirement.instance_path),
    bounds_mm: structuredClone(requirement.bounds_mm), search_scope: requirement.search_scope || 'scene',
    boundary_checks: structuredClone(requirement.boundary_checks || [])
  }));
  if (queries.length) {
    try {
      await assertActive();
      regionInspection = await bridge.inspect_detail_regions({ queries, runtime: 'queue', timeoutMs });
    } catch (error) { errors.push({ stage: 'regions', message: String(error.message) }); }
  }
  await assertActive();
  const after = await bridge.inspect_model({ runtime: 'queue', timeoutMs, includeSnapshot: true });
  const stable = after.snapshot?.model_revision_complete === true && after.snapshot.model_revision === snapshot.model_revision;
  if (!stable) errors.push({ stage: 'revision', message: 'Model changed during independent inspection.' });
  const quality = evaluateDetailQuality({ snapshot, layoutQa: qa, frozenSpecification: frozen,
    runtime: 'queue', trustedSnapshot: stable, identityMap: creation.identity_map,
    materialMap: creation.material_map, occurrencePathMap,
    captures: captured?.restored === true ? captured.captures || [] : [],
    regionInspection, trustedRegionInspection: Boolean(regionInspection) && stable });
  return { kind: 'independent_created_detail_inspection', source_task_id: taskId,
    source_execution_state: task.state, source_task_unchanged: true, original_execution_recovered: false,
    observed_bindings: observedBindings, binding_scope: observedBindings.length ? 'independent_inspection_only' : 'persisted_creation',
    specification_hash: frozen.hash, model_revision: snapshot.model_revision, revision_stable: stable,
    quality_accepted: stable && errors.length === 0 && quality.quality_accepted,
    quality, errors, snapshot, qa, collision_review: collisionReview.evidence, captured, region_inspection: regionInspection };
}
