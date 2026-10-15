import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { modelRevisionForAdoption } from './existing-model-editing.mjs';
import { modelIdentityForAdoption, modelKeyForIdentity } from './model-identity.mjs';
import { affineMatrix, identityMatrix, inverseMatrix, matrixFromTransform, multiplyMatrices } from './geometry-matrix.mjs';
import { mockPersistentEntityPath } from './object-identity.mjs';

export const LAYOUT_EDIT_VERSION = 'model-accessibility-layout-edit.v1';
const AXES = ['x', 'y', 'z'];
const ANCHORS = ['min', 'center', 'max'];
const MAX_OPERATIONS = 100;
const MAX_COORDINATE_MM = 1_000_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && !/[\0\r\n]/.test(value);

function invalid(field, message, code = 'INVALID_ARGUMENT') {
  throw new AgentContractError(code, message, { details: { recovery_class: 'design_input', issues: [{ path: field, message }] } });
}
function fields(value, allowed, required, field) {
  if (!object(value)) invalid(field, `${field} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${field}.${key}`, 'Unknown layout edit field.');
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(`${field}.${key}`, 'Required layout edit input is missing.');
}
function coordinate(value, field) {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE_MM) invalid(field, `Expected finite millimetres within +/-${MAX_COORDINATE_MM}.`);
  return value;
}
function reference(value, field) {
  fields(value, ['entity_path', 'target_id'], [], field);
  if (Object.keys(value).length !== 1 || !text(value.entity_path || value.target_id)) invalid(field, 'Use exactly one explicit entity_path or target_id; names are not target identities.');
}

export function validateLayoutEdit(layoutEdit) {
  const common = ['version', 'mode', 'targets', 'axis'];
  const modes = { array: ['count', 'spacing_mm'], align: ['anchor', 'reference'], mirror_copy: ['plane_offset_mm'] };
  if (!object(layoutEdit) || !Object.hasOwn(modes, layoutEdit.mode)) invalid('layout_edit.mode', 'Choose array, align or mirror_copy.');
  fields(layoutEdit, [...common, ...modes[layoutEdit.mode]], [...common, ...modes[layoutEdit.mode]], 'layout_edit');
  if (layoutEdit.version !== 1) invalid('layout_edit.version', 'Only layout edit version 1 is supported.');
  if (!AXES.includes(layoutEdit.axis)) invalid('layout_edit.axis', 'Choose the world x, y or z axis.');
  if (!Array.isArray(layoutEdit.targets) || layoutEdit.targets.length < 1 || layoutEdit.targets.length > 32) invalid('layout_edit.targets', 'Supply 1–32 explicit root targets.');
  layoutEdit.targets.forEach((target, i) => reference(target, `layout_edit.targets[${i}]`));
  if (layoutEdit.mode === 'array') {
    if (!Number.isInteger(layoutEdit.count) || layoutEdit.count < 2 || layoutEdit.count > 101) invalid('layout_edit.count', 'count includes the original and must be an integer from 2 to 101.');
    coordinate(layoutEdit.spacing_mm, 'layout_edit.spacing_mm');
    if (layoutEdit.spacing_mm === 0) invalid('layout_edit.spacing_mm', 'A nonzero signed world-axis interval is required; this is not a clear-gap measurement.');
    if ((layoutEdit.count - 1) * layoutEdit.targets.length > MAX_OPERATIONS) invalid('layout_edit.count', 'The requested array exceeds 100 new-instance operations.');
  } else if (layoutEdit.mode === 'align') {
    if (!ANCHORS.includes(layoutEdit.anchor)) invalid('layout_edit.anchor', 'Choose min, center or max.');
    fields(layoutEdit.reference, ['target', 'anchor'], ['target', 'anchor'], 'layout_edit.reference');
    reference(layoutEdit.reference.target, 'layout_edit.reference.target');
    if (!ANCHORS.includes(layoutEdit.reference.anchor)) invalid('layout_edit.reference.anchor', 'Choose min, center or max.');
  } else coordinate(layoutEdit.plane_offset_mm, 'layout_edit.plane_offset_mm');
  return structuredClone(layoutEdit);
}

function layoutEntries(adoption) {
  if (adoption.runtime !== 'mock') return adoption.recursive_index;
  // The mock full-recursive projection puts roots in entities and descendants
  // in recursive_index. Normalize only these server-owned root records; use
  // their existing top-level target_id execution route rather than inventing
  // a path that the reviewed target index did not capture.
  const roots = (adoption.entities || []).filter(entry => ['group', 'component_instance'].includes(entry.entity_type)).map(entry => {
    const id = entry.id || entry.reference;
    return { ...entry, entity_path: mockPersistentEntityPath([{ entity_type: entry.entity_type, reference: id }]), parent_entity_path: null,
      entity_definition_name: entry.definition || entry.entity_definition_name || null, world_transform: entry.transform || entry.world_transform,
      _layout_target_id: id };
  });
  const paths = new Set(roots.map(entry => entry.entity_path));
  return [...roots, ...adoption.recursive_index.filter(entry => !paths.has(entry.entity_path))];
}
function rootEntry(target, adoption, field) {
  const matches = layoutEntries(adoption).filter(entry => target.entity_path
    ? entry.entity_path === target.entity_path
    : [entry.id, entry.reference, entry.persistent_id].filter(value => value !== undefined && value !== null).map(String).includes(target.target_id));
  if (matches.length !== 1) invalid(field, 'The exact target must occur once in the current complete native index.', 'OPERATION_NOT_ALLOWED');
  const entry = matches[0];
  const rootPath = adoption.runtime === 'queue' ? /^pid:[1-9]\d*$/ : /^mock:(group|component_instance):[^/]+$/;
  if (entry.parent_entity_path !== null || !rootPath.test(entry.entity_path) || !['group', 'component_instance'].includes(entry.entity_type)) invalid(field, 'Layout helpers support explicit root Groups or ComponentInstances only; nested targets require an existing reviewed instance-isolation plan.', 'OPERATION_NOT_ALLOWED');
  if (entry.locked === true || entry.effective_locked === true || entry.locked_ancestor_path) invalid(field, 'The target or its ancestor is locked.', 'OPERATION_NOT_ALLOWED');
  if (entry.editable !== true) invalid(field, 'The target is not reported editable by the current runtime.', 'OPERATION_NOT_ALLOWED');
  if (!entry.bounding_box || !['min', 'max'].every(key => Array.isArray(entry.bounding_box[key]) && entry.bounding_box[key].length === 3 && entry.bounding_box[key].every(Number.isFinite))
    || [0, 1, 2].some(axis => entry.bounding_box.min[axis] > entry.bounding_box.max[axis])) invalid(field, 'A complete finite runtime bounding box is required.', 'OPERATION_NOT_ALLOWED');
  // For a root occurrence SketchUp's entity.bounds is in model/world space.
  // Nested boxes are in a parent space, and are intentionally never accepted.
  return entry;
}
const reviewedTarget = entry => entry._layout_target_id ? { target_id: entry._layout_target_id }
  : { entity_path: entry.entity_path, edit_scope: 'instance_path', instance_policy: 'definition_wide' };
const anchorAt = (entry, anchor, axis) => anchor === 'center'
  ? (entry.bounding_box.min[axis] + entry.bounding_box.max[axis]) / 2
  : entry.bounding_box[anchor][axis];

function worldMatrixMm(entry, runtime) {
  try {
    const raw = entry.world_transform || entry.transformation;
    let matrix;
    if (runtime === 'queue') {
      matrix = affineMatrix(raw);
      // occurrence_entity_snapshot reports Transformation#to_a: translation is
      // in SketchUp inches. The component_instance matrix contract uses mm.
      for (const index of [12, 13, 14]) matrix[index] *= 25.4;
    } else if (Array.isArray(raw)) matrix = affineMatrix(raw);
    else {
      if (!object(raw)) throw new Error('Missing mock transform');
      const { mirror, ...transform } = raw;
      matrix = matrixFromTransform(transform);
      if (mirror !== undefined) {
        const axes = Array.isArray(mirror) ? mirror : [mirror];
        if (new Set(axes).size !== axes.length || axes.some(axis => !AXES.includes(axis))) throw new Error('Invalid mirror axes');
        const reflection = identityMatrix();
        for (const axis of axes) reflection[AXES.indexOf(axis) * 5] = -1;
        matrix = multiplyMatrices(matrix, reflection);
      }
    }
    inverseMatrix(matrix);
    return matrix;
  } catch {
    invalid('layout_edit.targets', 'Mirror copies require a complete nonsingular world transform; it cannot be inferred from a bounding box.', 'OPERATION_NOT_ALLOWED');
  }
}

function mirrorOperation(entry, edit, runtime, id) {
  if (runtime === 'mock' && (entry.placement_complete === false || entry.transform?.object_transform && entry.placement_complete !== true)) invalid('layout_edit.targets', 'The mock runtime cannot establish the complete current placement after that edit; a mirror plan cannot reuse stale transform metadata.', 'OPERATION_NOT_ALLOWED');
  if (entry.entity_type !== 'component_instance' || !text(entry.entity_definition_name)) invalid('layout_edit.targets', 'Mirror copies currently support root ComponentInstances with a named definition; Groups and nested targets are unsupported.', 'OPERATION_NOT_ALLOWED');
  // Creating a new instance preserves definition geometry, but cannot silently
  // promise to clone instance overrides or source parameter lineage.
  const customAttributes = Object.keys(entry.attributes || {}).filter(key => {
    if (key === 'AlmaSketchupMCP') return false;
    // SketchUp creates this exact empty system dictionary on a plain instance.
    // It carries no user override; any populated/unknown field remains blocked.
    const value = entry.attributes[key];
    return !(runtime === 'queue' && key === 'SU_InstanceSet' && object(value)
      && Object.keys(value).length === 2 && value.Owner === '' && value.Status === '');
  });
  if (entry.visible === false || entry.material || entry.tag && !['Layer0', 'Untagged'].includes(entry.tag) || entry.texture_transform || entry.classification || customAttributes.length) invalid('layout_edit.targets', 'Mirror copy cannot preserve these root visibility/material/tag/custom-attribute overrides; use an explicit reviewed expert plan.', 'OPERATION_NOT_ALLOWED');
  const reflection = identityMatrix(), axis = AXES.indexOf(edit.axis);
  reflection[axis * 5] = -1;
  reflection[12 + axis] = 2 * edit.plane_offset_mm;
  const matrix = multiplyMatrices(reflection, worldMatrixMm(entry, runtime));
  for (const index of [12, 13, 14]) coordinate(matrix[index], 'layout_edit.plane_offset_mm');
  return { op: 'component_instance', id, name: id, definition: entry.entity_definition_name, origin: [0, 0, 0], transform: { matrix } };
}

/** Server-side read-only planning; never accepts a caller snapshot or approval. */
export async function prepareLayoutEdit({ bridge, layoutEdit, taskId, runtime = 'mock', timeoutMs, recursiveLimit = 5000, budgets = {} } = {}) {
  const edit = validateLayoutEdit(layoutEdit);
  if (!['mock', 'queue'].includes(runtime)) invalid('runtime', 'Choose mock or queue.');
  if (!bridge?.adopt_open_model) throw new Error('Layout planning requires a server bridge.');
  const adoption = await bridge.adopt_open_model({ runtime, timeoutMs, recursive: true, recursive_limit: recursiveLimit, read_only: true });
  if (adoption.runtime !== runtime) invalid('runtime', 'The runtime adoption does not match the requested runtime.', 'OPERATION_NOT_ALLOWED');
  const plan = planLayoutEdit({ layoutEdit: edit, taskId, adoption });
  // Existing reviewed edits count the reviewed source scope. Layout copying
  // must also account for the newly created instances before requesting review.
  for (const [field, alias, actual, fallback] of [
    ['max_operations', 'maxOperations', plan.operations.length, MAX_OPERATIONS],
    ['max_affected_instances', 'maxAffectedInstances', plan.summary.affected_instance_count, 200]
  ]) {
    const requested = budgets?.[field] ?? budgets?.[alias] ?? fallback;
    if (!Number.isInteger(requested) || requested <= 0) invalid(`budgets.${field}`, 'Expected a positive integer budget.');
    const maximum = Math.min(fallback, bridge.executionPolicy?.resource_limits?.[field] ?? fallback, requested);
    if (actual > maximum) invalid(`budgets.${field}`, `Layout plan requires ${actual}; the current limit is ${maximum}.`, 'POLICY_DENIED');
  }
  return plan;
}

/** Pure planner for trusted server adoption data and deterministic fixture tests. */
export function planLayoutEdit({ layoutEdit, taskId, adoption } = {}) {
  const edit = validateLayoutEdit(layoutEdit);
  if (!/^task_[0-9a-f-]+$/i.test(String(taskId))) invalid('task_id', 'A server task identity is required.');
  if (!adoption || !['queue', 'mock'].includes(adoption.runtime) || !Array.isArray(adoption.recursive_index) || adoption.recursive_truncated !== false) invalid('adoption', 'A complete server-owned recursive index is required.', 'MODEL_REVISION_INCOMPLETE');
  const binding = { model_key: modelKeyForIdentity(modelIdentityForAdoption(adoption)), model_revision: modelRevisionForAdoption(adoption) };
  const selected = edit.targets.map((target, i) => rootEntry(target, adoption, `layout_edit.targets[${i}]`));
  if (new Set(selected.map(entry => entry.entity_path)).size !== selected.length) invalid('layout_edit.targets', 'Target aliases must not select the same occurrence twice.');
  const targets = selected.map(reviewedTarget), operations = [], effects = [];
  const names = new Set(layoutEntries(adoption).flatMap(entry => [entry.id, entry.reference, entry.name, entry.persistent_id]).filter(value => value !== null && value !== undefined).map(String));
  const newId = (entry, copy) => {
    const id = `layout-${sha256Canonical({ taskId, edit, source: entry.entity_path, copy }).slice(7, 27)}`;
    if (names.has(id)) invalid('layout_edit.targets', 'A generated copy identity already exists; resume the original task instead of replaying it.', 'OPERATION_NOT_ALLOWED');
    names.add(id);
    return id;
  };
  const axis = AXES.indexOf(edit.axis);
  if (edit.mode === 'align') {
    const ref = rootEntry(edit.reference.target, adoption, 'layout_edit.reference.target');
    if (selected.some(entry => entry.entity_path === ref.entity_path)) invalid('layout_edit.reference.target', 'The fixed reference must not be one of the moving targets.');
    targets.push(reviewedTarget(ref));
    const destination = anchorAt(ref, edit.reference.anchor, axis);
    for (const entry of selected) {
      const from = anchorAt(entry, edit.anchor, axis), delta = coordinate(destination - from, 'layout_edit.anchor');
      const translate = [0, 0, 0]; translate[axis] = delta;
      operations.push({ op: 'transform_object', ...reviewedTarget(entry), translate });
      effects.push({ source: entry.entity_path, from_anchor_mm: from, to_anchor_mm: destination, translate_mm: translate });
    }
  } else for (const entry of selected) {
    if (edit.mode === 'array') for (let copy = 1; copy < edit.count; copy++) {
      const translate = [0, 0, 0]; translate[axis] = coordinate(copy * edit.spacing_mm, 'layout_edit.spacing_mm');
      for (const edge of ['min', 'max']) coordinate(entry.bounding_box[edge][axis] + translate[axis], 'layout_edit.spacing_mm');
      const id = newId(entry, copy);
      operations.push({ op: 'duplicate_entity', ...reviewedTarget(entry), new_id: id, new_name: id, translate });
      effects.push({ source: entry.entity_path, new_id: id, translate_mm: translate });
    } else {
      const id = newId(entry, 1);
      operations.push(mirrorOperation(entry, edit, adoption.runtime, id));
      effects.push({ source: entry.entity_path, new_id: id, plane: { normal_axis: edit.axis, offset_mm: edit.plane_offset_mm } });
    }
  }
  const summary = { mode: edit.mode, coordinate_space: 'world', units: 'mm', axis: edit.axis,
    source_count: selected.length, operation_count: operations.length,
    affected_instance_count: targets.length + (edit.mode === 'align' ? 0 : operations.length),
    original_preserved: edit.mode !== 'align', effects,
    ...(edit.mode === 'mirror_copy' ? { copy_scope: 'definition_geometry_and_world_transform', parameter_lineage_copied: false } : {}),
    evidence_level: adoption.runtime === 'queue' ? 'live_readonly_plan' : 'mock_plan', execution_started: false, quality_accepted: false,
    limits: ['Root targets only; nested targets require an explicit reviewed instance-isolation plan.', 'No collision, clear-gap, structural or appearance acceptance is implied.', 'Review policy, fresh connection, frozen model revision and execution receipts remain required.'] };
  return { version: LAYOUT_EDIT_VERSION, layout_edit: edit, operations, targets, binding, summary,
    plan_hash: sha256Canonical({ version: LAYOUT_EDIT_VERSION, layout_edit: edit, operations, targets, binding }) };
}
