import { createSnapshot } from './snapshot.mjs';
import { entityListFromSnapshot, modelInfoFromSnapshot } from './model-inspection.mjs';
import { definitionEntityPath, ensureMockSubentityStates, mockPersistentEntityPath } from './object-identity.mjs';
import { AgentContractError } from './agent-contract.mjs';
import { canonicalMockPidPath, mockStructuralPersistentId } from './mock-structural-identity.mjs';

export const ADOPTION_VERSION = '2026-07-existing-model-editing.1';
export const STRUCTURAL_GROUPS_VERSION = 'structural-groups.v1';
export const DEFAULT_STRUCTURAL_GROUP_LIMIT = 500;
export const MAX_STRUCTURAL_GROUP_LIMIT = 5000;
export const MAX_FRESH_MANIFOLD_PATHS = 20;
const CANONICAL_PID_PATH_PATTERN = /^pid:[1-9]\d*(?:\.[1-9]\d*)*$/;

export function normalizeStructuralProbeOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidStructuralProbe('adopt_open_model options must be an object.', 'options');
  }
  const readOnly = options.read_only === true || options.readOnly === true;
  const structuralGroupsProvided = hasOwn(options, 'structural_groups') || hasOwn(options, 'structuralGroups');
  const structuralLimitProvided = hasOwn(options, 'structural_group_limit') || hasOwn(options, 'structuralGroupLimit');
  const freshPathsProvided = hasOwn(options, 'fresh_manifold_paths') || hasOwn(options, 'freshManifoldPaths');
  const structuralGroups = hasOwn(options, 'structural_groups')
    ? options.structural_groups
    : hasOwn(options, 'structuralGroups') ? options.structuralGroups : false;
  if (typeof structuralGroups !== 'boolean') {
    throw invalidStructuralProbe('adopt_open_model.structural_groups must be a boolean.', 'structural_groups');
  }
  if (structuralLimitProvided && !structuralGroups) {
    throw invalidStructuralProbe(
      'adopt_open_model.structural_group_limit requires structural_groups=true.',
      'structural_groups'
    );
  }
  const requested = structuralGroups === true || structuralLimitProvided || freshPathsProvided;
  if (requested && !readOnly) {
    throw invalidStructuralProbe(
      'structural_groups, structural_group_limit, and fresh_manifold_paths are available only when read_only=true.',
      'read_only'
    );
  }

  const rawLimit = hasOwn(options, 'structural_group_limit')
    ? options.structural_group_limit
    : hasOwn(options, 'structuralGroupLimit') ? options.structuralGroupLimit : DEFAULT_STRUCTURAL_GROUP_LIMIT;
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_STRUCTURAL_GROUP_LIMIT) {
    throw invalidStructuralProbe(
      `adopt_open_model.structural_group_limit must be an integer from 1 to ${MAX_STRUCTURAL_GROUP_LIMIT}.`,
      'structural_group_limit'
    );
  }

  const rawFreshPaths = hasOwn(options, 'fresh_manifold_paths')
    ? options.fresh_manifold_paths
    : hasOwn(options, 'freshManifoldPaths') ? options.freshManifoldPaths : [];
  if (!Array.isArray(rawFreshPaths)) {
    throw invalidStructuralProbe('adopt_open_model.fresh_manifold_paths must be an array.', 'fresh_manifold_paths');
  }
  if (rawFreshPaths.length > MAX_FRESH_MANIFOLD_PATHS) {
    throw invalidStructuralProbe(
      `adopt_open_model.fresh_manifold_paths accepts at most ${MAX_FRESH_MANIFOLD_PATHS} paths.`,
      'fresh_manifold_paths'
    );
  }
  const freshManifoldPaths = rawFreshPaths.map((value, index) => {
    if (typeof value !== 'string' || !CANONICAL_PID_PATH_PATTERN.test(value)) {
      throw invalidStructuralProbe(
        `adopt_open_model.fresh_manifold_paths[${index}] must be a canonical pid path such as pid:123 or pid:123.456.`,
        `fresh_manifold_paths[${index}]`
      );
    }
    return value;
  });
  if (new Set(freshManifoldPaths).size !== freshManifoldPaths.length) {
    throw invalidStructuralProbe('adopt_open_model.fresh_manifold_paths must not contain duplicates.', 'fresh_manifold_paths');
  }
  if (freshManifoldPaths.length > 0 && !structuralGroups) {
    throw invalidStructuralProbe(
      'adopt_open_model.fresh_manifold_paths requires structural_groups=true.',
      'structural_groups'
    );
  }

  return {
    requested,
    read_only: readOnly,
    structural_groups: structuralGroups,
    structural_group_limit: rawLimit,
    fresh_manifold_paths: freshManifoldPaths
  };
}

export function assertStructuralProbeResult(result, normalizedOptions, { runtime } = {}) {
  const options = normalizedOptions?.requested === undefined
    ? normalizeStructuralProbeOptions(normalizedOptions || {})
    : normalizedOptions;
  if (!options.requested) return result;
  const selectedRuntime = runtime || result?.runtime;
  const projection = result?.structural_groups;
  const entries = projection?.entries;
  const validCounters = Number.isSafeInteger(projection?.total_seen)
    && projection.total_seen >= 0
    && Number.isSafeInteger(projection?.returned)
    && projection.returned >= 0
    && Number.isSafeInteger(projection?.fresh_manifold_requested)
    && projection.fresh_manifold_requested >= 0
    && Number.isSafeInteger(projection?.fresh_manifold_matched)
    && projection.fresh_manifold_matched >= 0
    && Number.isSafeInteger(projection?.fresh_manifold_unmatched)
    && projection.fresh_manifold_unmatched >= 0;
  const queueRevisionValid = selectedRuntime !== 'queue'
    || (/^sha256:[0-9a-f]{64}$/.test(String(result?.model_revision || ''))
      && result?.model_revision_complete === true);
  const basicShapeValid = result?.read_only === true
    && queueRevisionValid
    && projection?.version === STRUCTURAL_GROUPS_VERSION
    && projection?.limit === options.structural_group_limit
    && Array.isArray(entries)
    && validCounters
    && projection.returned === entries.length
    && projection.returned <= projection.limit
    && projection.total_seen >= projection.returned
    && typeof projection.truncated === 'boolean'
    && typeof projection.total_seen_exact === 'boolean'
    && projection.fresh_manifold_requested === options.fresh_manifold_paths.length
    && projection.fresh_manifold_requested === projection.fresh_manifold_matched + projection.fresh_manifold_unmatched;
  const boundShapeValid = basicShapeValid
    && (projection.truncated
      ? projection.returned === projection.limit
        && projection.total_seen === projection.limit + 1
        && projection.total_seen_exact === false
      : projection.total_seen === projection.returned && projection.total_seen_exact === true);
  const entryPaths = boundShapeValid ? entries.map((entry) => entry?.entity_path) : [];
  const entriesValid = boundShapeValid
    && new Set(entryPaths).size === entryPaths.length
    && entries.every((entry) => structuralEntryIdentityValid(entry));
  const exactFreshPaths = entriesValid
    ? entries.filter((entry) => structuralAttestationMatches(entry, result?.model_revision)).map((entry) => entry.entity_path)
    : [];
  const unmatchedPaths = Array.isArray(projection?.fresh_manifold_unmatched_paths)
    ? projection.fresh_manifold_unmatched_paths
    : null;
  const exactFreshPathSet = new Set(exactFreshPaths);
  const expectedUnmatchedPaths = options.fresh_manifold_paths.filter((value) => !exactFreshPathSet.has(value));
  const countersValid = entriesValid
    && exactFreshPaths.every((value) => options.fresh_manifold_paths.includes(value))
    && exactFreshPaths.length === projection.fresh_manifold_matched
    && projection.fresh_manifold_unmatched === expectedUnmatchedPaths.length
    && Array.isArray(unmatchedPaths)
    && new Set(unmatchedPaths).size === unmatchedPaths.length
    && JSON.stringify(unmatchedPaths) === JSON.stringify(expectedUnmatchedPaths);
  if (countersValid) return result;

  throw new AgentContractError(
    'HANDSHAKE_CAPABILITIES_MISMATCH',
    'The selected runtime did not return the requested structural-groups.v1 read-only projection.',
    {
      details: {
        operation: 'adopt_open_model',
        expected_probe_version: STRUCTURAL_GROUPS_VERSION,
        actual_probe_version: projection?.version || null,
        expected_limit: options.structural_group_limit,
        actual_limit: projection?.limit ?? null,
        queue_request_created: selectedRuntime === 'queue',
        queue_request_read_only: selectedRuntime === 'queue',
        model_state_preserved: true,
        mutation_authorized: false
      }
    }
  );
}

function structuralEntryIdentityValid(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (!CANONICAL_PID_PATH_PATTERN.test(entry.entity_path) || !Array.isArray(entry.path_segments) || entry.path_segments.length === 0) return false;
  const entityTypes = entry.path_segments.map((segment) => String(segment?.entity_type || ''));
  if (entityTypes.some((type) => !['group', 'component_instance'].includes(type)) || entityTypes.at(-1) !== 'group') return false;
  const pids = entry.path_segments.map((segment) => String(segment?.persistent_id || ''));
  if (pids.some((pid) => !/^[1-9]\d*$/.test(pid))) return false;
  const expectedPath = `pid:${pids.join('.')}`;
  const expectedParent = pids.length > 1 ? `pid:${pids.slice(0, -1).join('.')}` : null;
  return entry.entity_type === 'group'
    && entry.entity_path === expectedPath
    && String(entry.persistent_id || '') === pids.at(-1)
    && (entry.parent_entity_path ?? null) === expectedParent
    && entry.scope_path === (expectedParent || 'model');
}

function structuralAttestationMatches(entry, modelRevision) {
  const attestation = entry?.manifold_attestation;
  if (!attestation?.fresh || !attestation?.matched || attestation.status !== 'fresh_matched') return false;
  if (attestation.entity_path !== entry.entity_path || typeof attestation.is_manifold !== 'boolean') return false;
  return typeof modelRevision !== 'string' || attestation.model_revision === modelRevision;
}

export function adoptMockModel(model, options = {}) {
  const structuralProbe = normalizeStructuralProbeOptions(options);
  const prefix = safePrefix(options.prefix || 'adopted');
  const force = options.force === true;
  const entities = [
    ...(model.groups || []).map((item, index) => ({ item, index, entity_type: 'group' })),
    ...(model.instances || []).map((item, index) => ({ item, index, entity_type: 'component_instance' }))
  ];
  let adopted = 0;
  let existing = 0;
  for (const entry of entities) {
    const current = entry.item.id || entry.item.adopted_id;
    if (current && !force) {
      existing += 1;
      entry.item.adopted_id ||= current;
      continue;
    }
    const nextId = adoptionId(prefix, entry);
    entry.item.id = nextId;
    entry.item.adopted_id = nextId;
    entry.item.attributes ||= {};
    entry.item.attributes.AlmaSketchupMCP ||= {};
    entry.item.attributes.AlmaSketchupMCP.adopted_id = nextId;
    entry.item.attributes.AlmaSketchupMCP.adoption_version = ADOPTION_VERSION;
    adopted += 1;
  }
  const snapshot = createSnapshot(model);
  const recursiveIndex = options.recursive === true ? mockRecursiveIndex(model, options) : [];
  attachMockNativeClassification(recursiveIndex, snapshot);
  const report = adoptionReport({
    runtime: 'mock',
    snapshot,
    adopted,
    existing,
    recursive: options.recursive === true,
    recursiveIndex
  });
  if (options.recursive_roots) report.recursive_root_paths = [...options.recursive_roots];
  if (structuralProbe.structural_groups) {
    report.structural_groups = mockStructuralGroupProbe(model, structuralProbe);
  }
  return report;
}

export function adoptionReport({ runtime, snapshot, adopted, existing, recursive = false, recursiveIndex = [] }) {
  const entities = entityListFromSnapshot(snapshot, { includeHidden: true }).map((entity) => ({
    ...entity,
    editable: true,
    edit_scope: 'top_level',
    reference: entity.id || entity.persistent_id || entity.name,
    allowed_operations: allowedMockOperations(entity.entity_type)
  }));
  const readOnlyNested = recursiveIndex.filter((entry) => entry.editable === false).length;
  const editableNested = recursiveIndex.filter((entry) => entry.editable === true).length;
  return {
    kind: 'adopt_open_model',
    version: ADOPTION_VERSION,
    runtime,
    adopted_count: adopted,
    existing_count: existing,
    entity_count: entities.length,
    recursive,
    occurrence_contract: 'canonical-occurrence-path.v1',
    recursive_truncated: Boolean(recursiveIndex.truncated),
    recursive_total_seen: recursiveIndex.total_seen ?? recursiveIndex.length,
    read_only_nested_count: readOnlyNested,
    editable_nested_count: editableNested,
    model_info: modelInfoFromSnapshot(snapshot, { runtime }),
    classification_schemas: structuredClone(snapshot.classification_schemas || []),
    component_definition_summaries: structuredClone(snapshot.component_definition_summaries || []),
    entities,
    recursive_index: recursive ? [...recursiveIndex] : undefined,
    snapshot
  };
}

function attachMockNativeClassification(entries, snapshot) {
  const byDefinition = new Map((snapshot.component_definition_summaries || []).map((summary) => [summary.name, summary.native_classification]));
  const topLevel = [...(snapshot.groups || []), ...(snapshot.instances || [])];
  for (const entry of entries) {
    const definitionName = entry.entity_definition_name || entry.definition_name || null;
    const rootReference = entry.path_segments?.[0]?.reference;
    const root = topLevel.find((entity) => [entity.id, entity.persistent_id, entity.name].filter(Boolean).map(String).includes(String(rootReference)));
    entry.native_classification = structuredClone(byDefinition.get(definitionName) || root?.native_classification || null);
  }
}

function mockStructuralGroupProbe(model, options) {
  const groups = [];
  const requestedPaths = new Set(options.fresh_manifold_paths);
  const availablePaths = new Set();
  const observedRequestedPaths = new Set();
  const definitionCounts = countMockDefinitionOccurrences(model);
  let totalSeen = 0;
  let truncated = false;

  const walkCollections = ({
    groupItems = [],
    instanceItems = [],
    ancestors = [],
    parentDefinitionName = null,
    definitionStack = [],
    parentWorldTransform = identityMatrix4(),
    effectiveVisible = true,
    effectiveLocked = false
  }) => {
    for (const group of groupItems || []) {
      const segment = mockStructuralPathSegment(group, 'group', ancestors);
      const pathSegments = [...ancestors, segment];
      const entityPath = canonicalMockPidPath(pathSegments);
      const ownVisible = mockOwnVisible(group);
      const ownLocked = group.locked === true;
      const groupEffectiveVisible = effectiveVisible && ownVisible;
      const groupEffectiveLocked = effectiveLocked || ownLocked;
      const localTransform = mockTransformMatrix(group);
      const worldTransform = multiplyMatrix4(parentWorldTransform, localTransform);
      totalSeen += 1;
      if (totalSeen > options.structural_group_limit) {
        truncated = true;
        return false;
      }
      const freshManifold = mockFreshManifoldProjection({
        group,
        entityPath,
        requestedPaths,
        observedRequestedPaths,
        availablePaths
      });
      const affectedInstanceCount = parentDefinitionName
        ? Math.max(1, definitionCounts.get(parentDefinitionName) || 0)
        : 1;
      const parentEntityPath = pathSegments.length > 1 ? canonicalMockPidPath(pathSegments.slice(0, -1)) : null;
      const directCounts = mockDirectCounts(group);
      groups.push({
        entity_path: entityPath,
        parent_entity_path: parentEntityPath,
        scope_path: parentEntityPath || 'model',
        persistent_id_path: pathSegments.map((item) => item.persistent_id).join('.'),
        path_segments: pathSegments.map(({ entity_type, persistent_id, reference }) => ({ entity_type, persistent_id, reference })),
        persistent_id: segment.persistent_id,
        entity_type: 'group',
        kind: 'group',
        name: safeUntrustedDisplay(group.name),
        material: safeUntrustedDisplay(group.material),
        tag: safeUntrustedDisplay(group.tag),
        untrusted_display: {
          trust: 'untrusted_data',
          name: safeUntrustedDisplay(group.name),
          material: safeUntrustedDisplay(group.material),
          tag: safeUntrustedDisplay(group.tag)
        },
        visible: ownVisible,
        locked: ownLocked,
        effective_visible: groupEffectiveVisible,
        effective_locked: groupEffectiveLocked,
        hidden_by_ancestor: effectiveVisible === false,
        locked_by_ancestor: effectiveLocked === true,
        faces: directCounts.faces,
        edges: directCounts.edges,
        vertices: directCounts.vertices,
        direct_counts: directCounts,
        parent_bounding_box: transformBoundingBox(group.bounding_box, localTransform),
        world_bounding_box: transformBoundingBox(group.bounding_box, worldTransform),
        world_transform: worldTransform,
        affected_instance_count: affectedInstanceCount,
        shared_definition: affectedInstanceCount > 1,
        instance_policy_required: parentDefinitionName !== null,
        instance_policy: {
          required: parentDefinitionName !== null,
          allowed: parentDefinitionName !== null ? ['definition_wide', 'make_unique'] : [],
          recommended: affectedInstanceCount > 1 ? 'make_unique' : null
        },
        editable: false,
        edit_scope: 'read_only_structural_probe',
        manifold_attestation: freshManifold
      });

      const nestedGroups = group.groups || [];
      const nestedInstances = group.instances || [];
      if ((nestedGroups.length || nestedInstances.length) && walkCollections({
        groupItems: nestedGroups,
        instanceItems: nestedInstances,
        ancestors: pathSegments,
        parentDefinitionName: group.definition || parentDefinitionName,
        definitionStack,
        parentWorldTransform: worldTransform,
        effectiveVisible: groupEffectiveVisible,
        effectiveLocked: groupEffectiveLocked
      }) === false) return false;
    }

    for (const instance of instanceItems || []) {
      const segment = mockStructuralPathSegment(instance, 'component_instance', ancestors);
      const pathSegments = [...ancestors, segment];
      const ownVisible = mockOwnVisible(instance);
      const ownLocked = instance.locked === true;
      const instanceEffectiveVisible = effectiveVisible && ownVisible;
      const instanceEffectiveLocked = effectiveLocked || ownLocked;
      const worldTransform = multiplyMatrix4(parentWorldTransform, mockTransformMatrix(instance));
      const definitionName = instance.definition;
      if (!definitionName || definitionStack.includes(definitionName)) continue;
      const definition = model.component_definitions?.[definitionName];
      if (!definition) continue;
      if (walkCollections({
        groupItems: definition.groups || [],
        instanceItems: definition.instances || [],
        ancestors: pathSegments,
        parentDefinitionName: definitionName,
        definitionStack: [...definitionStack, definitionName],
        parentWorldTransform: worldTransform,
        effectiveVisible: instanceEffectiveVisible,
        effectiveLocked: instanceEffectiveLocked
      }) === false) return false;
    }
    return true;
  };

  walkCollections({ groupItems: model.groups || [], instanceItems: model.instances || [] });
  const unmatchedPaths = options.fresh_manifold_paths.filter((item) => !availablePaths.has(item));
  return {
    version: STRUCTURAL_GROUPS_VERSION,
    total_seen: totalSeen,
    total_seen_exact: !truncated,
    returned: groups.length,
    truncated,
    limit: options.structural_group_limit,
    fresh_manifold_requested: options.fresh_manifold_paths.length,
    fresh_manifold_matched: availablePaths.size,
    fresh_manifold_unmatched: unmatchedPaths.length,
    fresh_manifold_unmatched_paths: unmatchedPaths,
    entries: groups,
    kind: 'structural_group_projection',
    read_only: true,
    traversal_scope: 'group_and_component_containers_only',
    leaf_entities_materialized: false,
    fresh_manifold_details: {
      source: 'mock_fixture_only',
      observed_requested_paths: options.fresh_manifold_paths.filter((item) => observedRequestedPaths.has(item)),
      available_paths: options.fresh_manifold_paths.filter((item) => availablePaths.has(item)),
      request_fully_resolved: unmatchedPaths.length === 0
    }
  };
}

function mockFreshManifoldProjection({
  group,
  entityPath,
  requestedPaths,
  observedRequestedPaths,
  availablePaths
}) {
  if (!requestedPaths.has(entityPath)) {
    return {
      status: 'not_requested',
      fresh: false,
      matched: false,
      entity_path: entityPath,
      model_revision: null,
      is_manifold: null
    };
  }
  observedRequestedPaths.add(entityPath);
  const result = group.fresh_manifold_report && typeof group.fresh_manifold_report === 'object'
    ? {
        status: 'fresh_matched',
        fresh: group.fresh_manifold_report.fresh === true,
        matched: group.fresh_manifold_report.fresh === true,
        entity_path: entityPath,
        model_revision: group.fresh_manifold_report.model_revision || null,
        is_manifold: typeof group.fresh_manifold_report.is_manifold === 'boolean'
          ? group.fresh_manifold_report.is_manifold
          : null,
        source: 'fresh_manifold_report_fixture',
        report: normalizeMockManifoldFixture(group.fresh_manifold_report)
      }
    : {
        status: 'unavailable_mock',
        fresh: false,
        matched: false,
        entity_path: entityPath,
        model_revision: null,
        is_manifold: null,
        source: 'mock_runtime_does_not_compute_fresh_manifold',
        report: null
      };
  if (result.status === 'fresh_matched' && result.fresh && result.matched && typeof result.is_manifold === 'boolean') {
    availablePaths.add(entityPath);
  }
  return structuredClone(result);
}

function mockStructuralPathSegment(item, entityType, ancestors) {
  const persistentId = mockStructuralPersistentId(item, entityType, ancestors.map((entry) => entry.persistent_id));
  return {
    entity_type: entityType,
    persistent_id: persistentId,
    reference: safeUntrustedDisplay(item.id || item.adopted_id || item.persistent_id || item.name || persistentId)
  };
}

function normalizeMockManifoldFixture(report) {
  return {
    checked: report.checked === true,
    is_manifold: typeof report.is_manifold === 'boolean' ? report.is_manifold : null,
    method: safeUntrustedDisplay(report.method),
    faces: nonNegativeMockCount(report.faces),
    edges: nonNegativeMockCount(report.edges),
    vertices: nonNegativeMockCount(report.vertices),
    volume: Number.isFinite(report.volume) ? report.volume : null,
    issues: Array.isArray(report.issues) ? report.issues.slice(0, 20).map(safeUntrustedDisplay) : []
  };
}

function safeUntrustedDisplay(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ');
  return [...normalized].slice(0, 200).join('');
}

function mockOwnVisible(item) {
  return item.visible !== false && item.hidden !== true && item.tag_visible !== false;
}

function mockDirectCounts(group) {
  return {
    faces: nonNegativeMockCount(group.faces),
    edges: nonNegativeMockCount(group.edges),
    vertices: nonNegativeMockCount(group.vertices),
    groups: Array.isArray(group.groups) ? group.groups.length : 0,
    component_instances: Array.isArray(group.instances) ? group.instances.length : 0
  };
}

function nonNegativeMockCount(value) {
  const count = Number(value || 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function identityMatrix4() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function mockTransformMatrix(item) {
  const candidate = item.transformation;
  if (Array.isArray(candidate) && candidate.length === 16 && candidate.every(Number.isFinite)) return [...candidate];
  const transform = item.transform || {};
  const translate = Array.isArray(transform.translate) && transform.translate.length === 3
    ? transform.translate.map((value) => Number(value) || 0)
    : [0, 0, 0];
  const radians = (Number(transform.rotateZ || 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, 0, 0, -sin, cos, 0, 0, 0, 0, 1, 0, translate[0], translate[1], translate[2], 1];
}

function multiplyMatrix4(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
      }
    }
  }
  return result.map((value) => Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(12)));
}

function transformBoundingBox(box, transform) {
  if (!box?.min || !box?.max) return null;
  const points = [];
  for (const x of [Number(box.min[0]), Number(box.max[0])]) {
    for (const y of [Number(box.min[1]), Number(box.max[1])]) {
      for (const z of [Number(box.min[2]), Number(box.max[2])]) {
        points.push(transformMockPoint([x, y, z], transform));
      }
    }
  }
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  return { min, max, w: max[0] - min[0], d: max[1] - min[1], h: max[2] - min[2] };
}

function transformMockPoint([x, y, z], matrix) {
  return [
    x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12],
    x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13],
    x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]
  ].map((value) => Number(value.toFixed(6)));
}

function invalidStructuralProbe(message, field) {
  return new AgentContractError('INVALID_ARGUMENT', message, {
    details: {
      operation: 'adopt_open_model',
      field,
      model_state_preserved: true,
      queue_request_created: false
    }
  });
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function mockRecursiveIndex(model, options = {}) {
  const limit = positiveInteger(options.recursive_limit ?? options.recursiveLimit ?? 500, 500);
  const prefix = safePrefix(options.prefix || 'adopted');
  const entries = [];
  let totalSeen = 0;
  const definitionCounts = countMockDefinitionOccurrences(model);
  const observedRoots = new Set();
  const includeRoot = (item, segments) => {
    const entityPath = mockPersistentEntityPath(segments);
    observedRoots.add(entityPath);
    if (options.recursive_roots) push({ ...mockOccurrenceEntry(item, entityPath, null, 1), ...(item.definition ? { entity_definition_occurrence_count: definitionCounts.get(item.definition) || 0 } : {}) });
    return !options.recursive_roots || options.recursive_roots.includes(entityPath);
  };
  const push = (entry) => {
    totalSeen += 1;
    if (entries.length < limit) entries.push(entry);
  };
  const walkGroupGeometry = (group, segments, definitionName, affectedInstanceCount) => {
    const faceStates = ensureMockSubentityStates(group, 'face', Number(group.faces || 0));
    const edgeStates = ensureMockSubentityStates(group, 'edge', Number(group.edges || 0));
    for (const state of [...faceStates, ...edgeStates]) {
      const entityPath = mockPersistentEntityPath([...segments, { entity_type: state.entity_type, reference: state.persistent_id }]);
      push(mockOccurrenceEntry(state, entityPath, definitionName, affectedInstanceCount));
    }
  };
  const walkDefinition = (definitionName, segments, definitionStack = []) => {
    if (definitionStack.includes(definitionName)) return;
    const definition = model.component_definitions?.[definitionName];
    if (!definition) return;
    const affectedInstanceCount = definitionCounts.get(definitionName) || 0;
    for (const [index, item] of (definition.groups || []).entries()) {
      const stableReference = ensureMockStableReference(item, prefix, definitionName, 'group', index);
      const nextSegments = [...segments, { entity_type: 'group', reference: stableReference }];
      const entityPath = mockPersistentEntityPath(nextSegments);
      push(mockOccurrenceEntry(item, entityPath, definitionName, affectedInstanceCount, definitionEntityPath(definitionName, 'group', stableReference)));
      walkGroupGeometry(item, nextSegments, definitionName, affectedInstanceCount);
    }
    for (const [index, item] of (definition.instances || []).entries()) {
      const stableReference = ensureMockStableReference(item, prefix, definitionName, 'component_instance', index);
      const nextSegments = [...segments, { entity_type: 'component_instance', reference: stableReference }];
      const entityPath = mockPersistentEntityPath(nextSegments);
      push(mockOccurrenceEntry(item, entityPath, definitionName, affectedInstanceCount, definitionEntityPath(definitionName, 'component_instance', stableReference)));
      walkDefinition(item.definition, nextSegments, [...definitionStack, definitionName]);
    }
  };
  for (const [index, group] of (model.groups || []).entries()) {
    const stableReference = ensureMockStableReference(group, prefix, 'model', 'group', index);
    const segments = [{ entity_type: 'group', reference: stableReference }];
    if (includeRoot(group, segments)) walkGroupGeometry(group, segments, null, 1);
  }
  for (const [index, instance] of (model.instances || []).entries()) {
    const stableReference = ensureMockStableReference(instance, prefix, 'model', 'component_instance', index);
    const segments = [{ entity_type: 'component_instance', reference: stableReference }];
    if (includeRoot(instance, segments)) walkDefinition(instance.definition, segments);
  }
  if (options.recursive_roots?.some(root => !observedRoots.has(root))) throw new Error('recursive_roots contains a missing top-level container');
  Object.defineProperties(entries, {
    truncated: { value: totalSeen > limit, enumerable: false },
    total_seen: { value: totalSeen, enumerable: false }
  });
  return entries;
}

function mockOccurrenceEntry(item, entityPath, definitionName, affectedInstanceCount, legacyEntityPath = null) {
  const entityType = item.entity_type || 'group';
  const editable = ['group', 'component_instance', 'face', 'edge'].includes(entityType);
  return {
    path: entityPath,
    entity_path: entityPath,
    persistent_id_path: entityPath,
    parent_entity_path: parentEntityPath(entityPath),
    path_segments: mockPathSegments(entityPath),
    legacy_entity_path: legacyEntityPath,
    parent_definition: definitionName,
    definition_name: definitionName,
    definition_persistent_id: null,
    entity_definition_name: item.definition || definitionName || null,
    entity_definition_persistent_id: null,
    reference: item.id || item.persistent_id,
    name: item.name || null,
    entity_type: entityType,
    kind: item.kind || entityType,
    material: item.material || null,
    back_material: item.back_material || null,
    classification: item.classification || null,
    tag: item.tag || null,
    attributes: structuredClone(item.attributes || null),
    texture_transform: structuredClone(item.texture_transform || null),
    face_uvs: structuredClone(item.face_uvs || null),
    transform: structuredClone(item.transform || null),
    transformation: structuredClone(item.transformation || item.transform || null),
    world_transform: structuredClone(item.world_transform || item.transformation || item.transform || null),
    visible: item.visible !== false && item.hidden !== true,
    locked: item.locked === true,
    soft: item.soft === true,
    smooth: item.smooth === true,
    reversed: item.reversed === true,
    geometry_summary: structuredClone(item.geometry_summary || null),
    bounding_box: item.bounding_box || null,
    faces: item.faces || 0,
    edges: item.edges || 0,
    vertices: item.vertices || 0,
    features: Array.isArray(item.features) ? item.features : [],
    editable,
    edit_scope: 'instance_path',
    allowed_operations: allowedMockOperations(entityType),
    affected_instance_count: affectedInstanceCount,
    shared_definition: affectedInstanceCount > 1,
    instance_policy_required: Boolean(definitionName),
    warning: definitionName ? 'Definition-wide edits affect every occurrence; use instance_policy=make_unique for one occurrence.' : null
  };
}

function parentEntityPath(entityPath) {
  const segments = String(entityPath || '').split('/').filter(Boolean);
  return segments.length > 1 ? segments.slice(0, -1).join('/') : null;
}

function mockPathSegments(entityPath) {
  return String(entityPath || '').split('/').filter(Boolean).map((segment) => {
    const match = /(?:^|:)(component_instance|group|face|edge):([^:]+)$/i.exec(segment);
    const reference = match ? decodeMockReference(match[2]) : segment;
    return {
      entity_type: match?.[1] || 'unknown',
      persistent_id: reference,
      reference
    };
  });
}

function decodeMockReference(value) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8') || value;
  } catch {
    return value;
  }
}

function allowedMockOperations(entityType) {
  if (entityType === 'face') return ['set_material', 'set_face_material', 'set_visibility', 'attribute', 'remove_attribute', 'reverse_face', 'pushpull_face', 'erase_entities', 'transform_entities'];
  if (entityType === 'edge') return ['set_visibility', 'attribute', 'remove_attribute', 'set_edge_properties', 'erase_entities', 'transform_entities'];
  return ['edit_geometry', 'delete', 'rename', 'set_material', 'set_visibility', 'transform_object', 'assign_tag', 'attribute', 'remove_attribute', 'classification', 'texture_transform', 'duplicate_entity', 'replace_component_definition', 'explode_entity', 'erase_entities', 'transform_entities', 'cut_hole', 'cut_slot', 'cut_recess', 'add_boss', 'add_raised_rib', 'boolean_union', 'boolean_difference', 'boolean_intersect', 'manifold_check', 'manifold_repair'];
}

function ensureMockStableReference(item, prefix, definitionName, entityType, index) {
  const stableReference = item.id || item.adopted_id || item.persistent_id || nestedAdoptionId(prefix, definitionName, entityType, item, index);
  item.id ||= stableReference;
  item.adopted_id ||= stableReference;
  item.entity_type ||= entityType;
  return String(stableReference);
}

function countMockDefinitionOccurrences(model) {
  const counts = new Map();
  const walk = (definitionName, stack = []) => {
    counts.set(definitionName, (counts.get(definitionName) || 0) + 1);
    if (stack.includes(definitionName)) return;
    const definition = model.component_definitions?.[definitionName];
    for (const instance of definition?.instances || []) walk(instance.definition, [...stack, definitionName]);
  };
  for (const instance of model.instances || []) walk(instance.definition);
  return counts;
}

function nestedAdoptionId(prefix, definitionName, entityType, item, index) {
  const seed = item.id || item.persistent_id || item.name || `${entityType}-${index + 1}`;
  return `${prefix}-nested-${safeToken(definitionName)}-${safeToken(seed)}`;
}

function adoptionId(prefix, { item, index, entity_type }) {
  const persistent = item.persistent_id || item.persistentId;
  if (persistent) return `${prefix}-${entity_type}-${safeToken(persistent)}`;
  const name = item.name ? safeToken(item.name) : null;
  return `${prefix}-${entity_type}-${name || index + 1}`;
}

function safePrefix(value) {
  return safeToken(value || 'adopted') || 'adopted';
}

function safeToken(value) {
  return String(value || '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
