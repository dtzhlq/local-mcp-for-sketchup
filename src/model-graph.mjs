import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentContractError, sha256Canonical } from './agent-contract.mjs';
import { modelRevisionForAdoption } from './existing-model-editing.mjs';
import { normalizeClassificationSchemas, normalizeNativeClassificationSummary } from './native-classification.mjs';

export const MODEL_GRAPH_VERSION = 'model-graph.v1';

const STRUCTURAL_GROUP_PROPOSAL_OPERATIONS = Object.freeze([
  'attribute',
  'cut_hole',
  'delete',
  'manifold_check',
  'rename',
  'set_material',
  'set_visibility',
  'transform_object'
]);

export function buildModelGraph(adoption, { lineage = {}, sourceArtifacts = [] } = {}) {
  if (adoption?.kind !== 'adopt_open_model') throw new Error('buildModelGraph requires an adopt_open_model report');
  const modelRevision = modelRevisionForAdoption(adoption);
  const nodes = new Map();
  const classificationSchemas = normalizeClassificationSchemas(adoption.classification_schemas || adoption.snapshot?.classification_schemas || []);
  const modelNodeId = nodeIdFor(`model:${modelRevision}`);
  nodes.set(modelNodeId, {
    node_id: modelNodeId,
    node_type: 'model',
    model_revision: modelRevision,
    trust: 'server_derived',
    source: 'model_revision'
  });
  const hierarchy = [];
  const definitionMembership = [];
  const topology = [];
  const recursiveEntries = adoption.recursive_index || [];
  const recursivePaths = recursiveEntries.map((entry) => String(entry.entity_path || entry.path || '')).filter(Boolean);
  const recursiveByPath = new Map(recursiveEntries.map((entry) => [String(entry.entity_path || entry.path || ''), entry]).filter(([entryPath]) => entryPath));
  const recursiveRootPaths = [...new Set(recursiveEntries.map((entry) => occurrencePathPrefixes(entry.entity_path)[0]).filter(Boolean))];
  const structuralProjection = normalizeStructuralGroupProjection(adoption.structural_groups);
  const structuralEntries = structuralProjection?.entries || [];
  const structuralPaths = new Set(structuralEntries.map((entry) => entry.entity_path));
  const structuralRootPaths = [...new Set(structuralEntries.map((entry) => occurrencePathPrefixes(entry.entity_path)[0]).filter(Boolean))];

  for (const entity of adoption.entities || []) {
    if (recursiveRootPaths.some((entityPath) => occurrencePathMatchesEntity(entityPath, recursiveByPath.get(entityPath), entity))) continue;
    if (structuralRootPaths.some((entityPath) => occurrencePathMatchesEntity(entityPath, structuralEntries.find((entry) => entry.entity_path === entityPath), entity))) continue;
    const node = occurrenceNode({
      key: `top:${entity.id || entity.persistent_id || entity.name}`,
      entity,
      entityPath: null,
      parentId: null,
      synthetic: false,
      scope: 'top_level',
      classificationSchemas
    });
    nodes.set(node.node_id, node);
  }

  for (const entry of recursiveEntries) {
    const prefixes = occurrencePathPrefixes(entry.entity_path);
    let parentId = null;
    for (let index = 0; index < prefixes.length; index += 1) {
      const entityPath = prefixes[index];
      const isLeaf = index === prefixes.length - 1;
      const indexedEntity = recursiveByPath.get(entityPath);
      const parsed = parseOccurrencePath(entityPath, indexedEntity);
      const nodeId = nodeIdFor(`occurrence:${entityPath}`);
      const topLevelEntity = index === 0 ? findTopEntity(adoption.entities, parsed) : null;
      const entity = indexedEntity || topLevelEntity || (isLeaf ? entry : {
        entity_type: parsed.entity_type,
        reference: parsed.reference,
        persistent_id: parsed.persistent_id,
        name: topEntityName(adoption.entities, parsed.reference),
        editable: parsed.entity_type !== 'model',
        edit_scope: 'instance_path',
        visible: true
      });
      const node = occurrenceNode({
        key: `occurrence:${entityPath}`,
        entity,
        entityPath,
        parentId,
        synthetic: !indexedEntity && !topLevelEntity && !isLeaf,
        scope: 'instance_path',
        classificationSchemas
      });
      const existing = nodes.get(nodeId);
      nodes.set(nodeId, existing ? mergeOccurrenceNode(existing, node) : node);
      if (parentId) addUniqueRelationship(hierarchy, { type: 'parent_child', from: parentId, to: nodeId });
      if (['face', 'edge'].includes(node.entity_type) && parentId) addUniqueRelationship(topology, { type: 'belongs_to_geometry', from: nodeId, to: parentId });
      parentId = nodeId;
    }
  }

  for (const entry of structuralEntries) {
    const nodeId = nodeIdFor(`occurrence:${entry.entity_path}`);
    if (nodes.has(nodeId)) continue;
    const parentId = entry.parent_entity_path && structuralPaths.has(entry.parent_entity_path)
      ? nodeIdFor(`occurrence:${entry.parent_entity_path}`)
      : null;
    const node = occurrenceNode({
      key: `occurrence:${entry.entity_path}`,
      entity: structuralGroupOccurrence(entry),
      entityPath: entry.entity_path,
      parentId,
      synthetic: false,
      scope: 'instance_path',
      classificationSchemas
    });
    nodes.set(nodeId, node);
    if (parentId) addUniqueRelationship(hierarchy, { type: 'parent_child', from: parentId, to: nodeId });
  }
  applyEffectiveLocks(nodes);

  const definitions = definitionDescriptors(adoption, recursiveEntries, classificationSchemas);
  for (const descriptor of [...definitions.values()].sort((left, right) => left.key.localeCompare(right.key))) {
    const node = {
      node_id: nodeIdFor(`definition:${descriptor.key}`),
      node_type: 'definition',
      name: descriptor.name,
      persistent_id: descriptor.persistent_id,
      native_classification: descriptor.native_classification,
      trust: 'untrusted_data',
      source: 'sketchup_model',
      occurrence_count: [...nodes.values()].filter((node) => node.node_type === 'occurrence' && definitionKeyForNode(node) === descriptor.key).length
    };
    nodes.set(node.node_id, node);
  }
  for (const node of nodes.values()) {
    if (node.node_type !== 'occurrence') continue;
    const definitionKey = definitionKeyForNode(node);
    if (!definitionKey) continue;
    const definitionId = nodeIdFor(`definition:${definitionKey}`);
    if (nodes.has(definitionId)) {
      definitionMembership.push({
        type: ['group', 'component_instance'].includes(node.entity_type) ? 'instance_of' : 'member_of_definition',
        from: node.node_id,
        to: definitionId
      });
    }
  }

  const featureRelationships = [];
  for (const node of [...nodes.values()]) {
    for (const feature of node.features || []) {
      const featureId = nodeIdFor(`feature:${node.node_id}:${feature.id || feature.name || featureRelationships.length}`);
      nodes.set(featureId, {
        node_id: featureId,
        node_type: 'feature',
        feature_type: feature.type || feature.op || 'unknown',
        feature_id: feature.id || null,
        summary: structuredClone(feature),
        trust: 'untrusted_data',
        source: 'sketchup_model'
      });
      featureRelationships.push({ type: 'has_feature', from: node.node_id, to: featureId });
    }
  }

  const occurrenceNodes = [...nodes.values()].filter((node) => node.node_type === 'occurrence');
  const spatial = spatialRelationships(occurrenceNodes);
  const lineageRelationships = [];
  const trustedArtifacts = sourceArtifacts.filter((artifact) => artifact?.provenance_verified === true && typeof artifact.handle === 'string');
  for (const artifact of trustedArtifacts) {
    const artifactId = nodeIdFor(`artifact:${artifact.content_sha256}:${artifact.handle}`);
    nodes.set(artifactId, {
      node_id: artifactId,
      node_type: 'artifact',
      artifact_kind: artifact.artifact_kind || 'generic_json',
      artifact_handle: artifact.handle,
      content_sha256: artifact.content_sha256,
      source_task_id: artifact.source_task_id,
      label: artifact.label,
      media_type: artifact.media_type,
      provenance_trust: 'server_artifact_handle',
      policy_effect: 'none',
      trust: 'untrusted_data',
      source: 'agent_task_artifact'
    });
    lineageRelationships.push({ type: 'derived_from_artifact', from: modelNodeId, to: artifactId });
  }
  const trustedByKind = (kind) => trustedArtifacts.filter((artifact) => artifact.artifact_kind === kind).map((artifact) => artifact.handle);
  const untrustedClaims = {
    part_graph: lineage.part_graph || null,
    parametric_recipe: lineage.parametric_recipe || null,
    feature_mapping_plan: lineage.feature_mapping_plan || null,
    evidence: structuredClone(lineage.evidence || []),
    entity_paths: structuredClone(lineage.entity_paths || {}),
    source_artifacts: structuredClone(sourceArtifacts.filter((artifact) => artifact?.provenance_verified !== true))
  };

  const recursiveTotalSeen = Number(adoption.recursive_total_seen ?? recursiveEntries.length);
  const occurrenceContractMatches = adoption.occurrence_contract === 'canonical-occurrence-path.v1';
  const recursiveCountMatches = recursiveTotalSeen === recursiveEntries.length;
  const entityPathsPresent = recursivePaths.length === recursiveEntries.length;
  const entityPathsUnique = new Set(recursivePaths).size === recursivePaths.length;
  const pathClosureComplete = [...nodes.values()].every((node) => node.node_type !== 'occurrence' || node.synthetic !== true);
  const scopedRoots = adoption.recursive_root_paths || null;
  const completeness = {
    recursive_root_paths: scopedRoots,
    recursive_requested: adoption.recursive === true,
    recursive_truncated: adoption.recursive_truncated === true,
    recursive_total_seen: recursiveTotalSeen,
    recursive_indexed: recursiveEntries.length,
    occurrence_contract: occurrenceContractMatches ? adoption.occurrence_contract : 'unsupported',
    complete: adoption.recursive === true
      && adoption.recursive_truncated !== true
      && occurrenceContractMatches
      && recursiveCountMatches
      && entityPathsPresent
      && entityPathsUnique
      && pathClosureComplete,
    blockers: [
      ...(adoption.recursive === true ? [] : ['recursive_index_not_requested']),
      ...(adoption.recursive_truncated === true ? ['recursive_index_truncated'] : []),
      ...(occurrenceContractMatches ? [] : ['occurrence_contract_mismatch']),
      ...(recursiveCountMatches ? [] : ['recursive_count_mismatch']),
      ...(entityPathsPresent ? [] : ['missing_entity_path']),
      ...(entityPathsUnique ? [] : ['duplicate_entity_path']),
      ...(pathClosureComplete ? [] : ['occurrence_path_not_closed'])
    ]
  };
  if (scopedRoots) {
    completeness.scope_complete = completeness.complete;
    completeness.complete = false;
    completeness.blockers.push('partial_geometry_scope');
  }
  const sourceAdoptionHash = sha256Canonical({
    version: adoption.version,
    runtime: adoption.runtime,
    model_revision: modelRevision,
    recursive: adoption.recursive === true,
    recursive_truncated: adoption.recursive_truncated === true,
    recursive_total_seen: completeness.recursive_total_seen,
    classification_schemas: classificationSchemas,
    component_definition_summaries: adoption.component_definition_summaries || adoption.snapshot?.component_definition_summaries || [],
    entities: adoption.entities || [],
    recursive_index: recursiveEntries,
    ...(structuralProjection ? { structural_groups: structuralProjection.source } : {})
  });
  const graphCore = {
    version: MODEL_GRAPH_VERSION,
    kind: 'model_graph',
    model_revision: modelRevision,
    runtime: adoption.runtime,
    source_adoption_version: adoption.version,
    source_adoption_hash: sourceAdoptionHash,
    completeness,
    ...(structuralProjection ? { projections: { structural_groups: structuralProjection.coverage } } : {}),
    nodes: [...nodes.values()].sort((left, right) => left.node_id.localeCompare(right.node_id)),
    relationships: {
      hierarchy,
      definition_membership: definitionMembership,
      topology: [...topology, ...featureRelationships],
      spatial,
      lineage: lineageRelationships
    },
    catalogs: {
      materials: structuredClone(adoption.snapshot?.materials || []),
      tags: structuredClone(adoption.snapshot?.tags || []),
      scenes: structuredClone(adoption.snapshot?.scenes || []),
      classifications: uniqueValues(occurrenceNodes.map((node) => node.classification).filter(Boolean)),
      classification_schemas: classificationSchemas,
      native_classification_summaries: uniqueValues([...nodes.values()].map((node) => node.native_classification).filter(Boolean))
    },
    lineage: {
      part_graph: trustedByKind('part_graph')[0] || null,
      parametric_recipe: trustedByKind('parametric_recipe')[0] || null,
      feature_mapping_plan: trustedByKind('feature_mapping_plan')[0] || null,
      evidence: trustedByKind('evidence'),
      trusted_artifacts: trustedArtifacts.map((artifact) => ({
        handle: artifact.handle,
        artifact_kind: artifact.artifact_kind,
        content_sha256: artifact.content_sha256,
        source_task_id: artifact.source_task_id,
        label: artifact.label,
        media_type: artifact.media_type,
        provenance_trust: 'server_artifact_handle',
        content_trust: 'untrusted_data',
        policy_effect: 'none'
      })),
      untrusted_claims: {
        trust: 'untrusted_data',
        source: 'agent_lineage_claims',
        value: untrustedClaims,
        policy_effect: 'none'
      }
    },
    untrusted_data_fields: ['name', 'material', 'tag', 'classification', 'native_classification', 'attributes', 'ocr', 'feature.summary', 'artifact content', 'lineage.untrusted_claims']
  };
  const stats = graphStats(graphCore);
  const graphId = modelGraphId(graphCore);
  const graph = { ...graphCore, graph_id: graphId, stats };
  validateModelGraphSemantics(graph);
  return graph;
}

export function validateModelGraphSemantics(graph) {
  const violations = [];
  if (!graph || graph.version !== MODEL_GRAPH_VERSION || graph.kind !== 'model_graph') violations.push('invalid_graph_header');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(graph?.model_revision || ''))) violations.push('invalid_model_revision');
  if (!/^sha256:[0-9a-f]{64}$/.test(String(graph?.source_adoption_hash || ''))) violations.push('invalid_source_adoption_hash');
  if (!Array.isArray(graph?.nodes)) violations.push('nodes_not_array');
  if (!graph?.relationships || typeof graph.relationships !== 'object') violations.push('relationships_missing');
  if (violations.length) throw invalidModelGraph(violations);

  const nodeById = new Map();
  const entityPaths = new Set();
  for (const node of graph.nodes) {
    if (!/^node_[0-9a-f]{24}$/.test(String(node?.node_id || ''))) violations.push('invalid_node_id');
    if (nodeById.has(node.node_id)) violations.push(`duplicate_node_id:${node.node_id}`);
    nodeById.set(node.node_id, node);
    validateNodeShape(node, violations);
    if (node.node_type === 'occurrence' && node.entity_path) {
      if (entityPaths.has(node.entity_path)) violations.push(`duplicate_entity_path:${node.entity_path}`);
      entityPaths.add(node.entity_path);
      if (node.node_id !== nodeIdFor(`occurrence:${node.entity_path}`)) violations.push(`occurrence_node_id_mismatch:${node.entity_path}`);
    }
  }
  const modelNodes = graph.nodes.filter((node) => node.node_type === 'model');
  if (modelNodes.length !== 1 || modelNodes[0]?.model_revision !== graph.model_revision) violations.push('model_node_revision_mismatch');
  if (modelNodes[0]?.node_id !== nodeIdFor(`model:${graph.model_revision}`)) violations.push('model_node_id_mismatch');

  const relationshipRules = {
    hierarchy: new Set(['parent_child']),
    definition_membership: new Set(['instance_of', 'member_of_definition']),
    topology: new Set(['belongs_to_geometry', 'has_feature']),
    spatial: new Set(['left_of', 'right_of', 'in_front_of', 'behind', 'below', 'above', 'bbox_overlaps']),
    lineage: new Set(['derived_from_artifact'])
  };
  for (const [family, allowedTypes] of Object.entries(relationshipRules)) {
    const relationships = graph.relationships[family];
    if (!Array.isArray(relationships)) {
      violations.push(`relationship_family_missing:${family}`);
      continue;
    }
    const seen = new Set();
    for (const relationship of relationships) {
      const key = `${relationship?.type}:${relationship?.from}:${relationship?.to}`;
      if (seen.has(key)) violations.push(`duplicate_relationship:${family}:${key}`);
      seen.add(key);
      if (!allowedTypes.has(relationship?.type)) violations.push(`invalid_relationship_type:${family}:${relationship?.type}`);
      const from = nodeById.get(relationship?.from);
      const to = nodeById.get(relationship?.to);
      if (!from || !to) {
        violations.push(`dangling_relationship:${family}:${key}`);
        continue;
      }
      validateRelationshipEndpoints(family, relationship.type, from, to, violations);
    }
  }

  const hierarchyPairs = new Set(graph.relationships.hierarchy.map(entry => `${entry.type}:${entry.from}:${entry.to}`));
  for (const node of graph.nodes.filter((candidate) => candidate.node_type === 'occurrence')) {
    if (node.parent_id && !hierarchyPairs.has(`parent_child:${node.parent_id}:${node.node_id}`)) {
      violations.push(`missing_parent_relationship:${node.node_id}`);
    }
    if (node.entity_path && node.parent_entity_path !== parentEntityPath(node.entity_path)) {
      violations.push(`parent_path_mismatch:${node.entity_path}`);
    }
    if (node.parent_id) {
      const parent = nodeById.get(node.parent_id);
      if (parent?.entity_path !== node.parent_entity_path) violations.push(`parent_node_path_mismatch:${node.node_id}`);
    }
  }

  const expectedScopeComplete = graph.completeness?.recursive_requested === true
    && graph.completeness?.recursive_truncated === false
    && graph.completeness?.occurrence_contract === 'canonical-occurrence-path.v1'
    && graph.completeness?.recursive_total_seen === graph.completeness?.recursive_indexed
    && !graph.nodes.some((node) => node.node_type === 'occurrence' && (node.synthetic === true || !node.entity_path));
  const roots = graph.completeness?.recursive_root_paths;
  if (roots && (!Array.isArray(roots) || !roots.length || new Set(roots).size !== roots.length || roots.some(root => !graph.nodes.some(node => node.node_type === 'occurrence' && !node.parent_id && node.entity_path === root && ['group','component_instance'].includes(node.entity_type))) || graph.completeness.scope_complete !== expectedScopeComplete)) violations.push('scoped_completeness_inconsistent');
  const expectedComplete = !roots && expectedScopeComplete;
  if (graph.completeness?.complete !== expectedComplete) violations.push('completeness_inconsistent');
  if ((graph.completeness?.complete === true) !== (graph.completeness?.blockers?.length === 0)) violations.push('completeness_blockers_inconsistent');
  validateGraphProjections(graph, violations);

  const expectedStats = graphStats(graph);
  for (const [key, value] of Object.entries(expectedStats)) {
    if (graph.stats?.[key] !== value) violations.push(`stats_mismatch:${key}`);
  }
  if (graph.graph_id !== modelGraphId(graph)) violations.push('graph_id_mismatch');

  if (violations.length) throw invalidModelGraph(violations);
  return true;
}

export async function writeModelGraph(filePath, graph) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
  return filePath;
}

function normalizeStructuralGroupProjection(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 'structural-groups.v1') {
    throw invalidModelGraph(['invalid_structural_group_projection']);
  }
  if (!Array.isArray(value.entries)) throw invalidModelGraph(['structural_group_entries_not_array']);
  const returned = Number(value.returned);
  const totalSeen = Number(value.total_seen);
  const limit = Number(value.limit);
  if (!Number.isInteger(returned) || returned !== value.entries.length) {
    throw invalidModelGraph(['structural_group_returned_mismatch']);
  }
  if (!Number.isInteger(totalSeen) || totalSeen < returned) {
    throw invalidModelGraph(['structural_group_total_seen_invalid']);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || returned > limit) {
    throw invalidModelGraph(['structural_group_limit_invalid']);
  }
  const paths = new Set();
  for (const entry of value.entries) {
    const entityPath = String(entry?.entity_path || '');
    const segments = entityPath.startsWith('pid:') ? entityPath.slice(4).split('.') : [];
    const expectedParent = segments.length > 1 ? `pid:${segments.slice(0, -1).join('.')}` : null;
    if (entry?.entity_type !== 'group'
      || !/^pid:[1-9]\d*(?:\.[1-9]\d*)*$/.test(entityPath)
      || String(entry.persistent_id || '') !== segments.at(-1)
      || (entry.parent_entity_path || null) !== expectedParent
      || !Array.isArray(entry.path_segments)
      || entry.path_segments.length !== segments.length) {
      throw invalidModelGraph([`invalid_structural_group_entry:${entityPath || 'missing'}`]);
    }
    if (paths.has(entityPath)) throw invalidModelGraph([`duplicate_structural_group_path:${entityPath}`]);
    paths.add(entityPath);
  }
  const totalSeenExact = value.total_seen_exact === true;
  const truncated = value.truncated === true;
  const complete = totalSeenExact && !truncated && totalSeen === returned;
  return {
    entries: value.entries,
    source: structuredClone(value),
    coverage: {
      version: 'structural-groups.v1',
      complete,
      total_seen: totalSeen,
      total_seen_exact: totalSeenExact,
      indexed: returned,
      truncated,
      limit,
      eligible_entity_types: ['group'],
      leaf_entities_materialized: false,
      coordinate_space: 'model_world',
      proposal_only: true,
      execution_allowed: false
    }
  };
}

function structuralGroupOccurrence(entry) {
  const lockedByAncestor = entry.locked_by_ancestor === true;
  return {
    entity_path: entry.entity_path,
    parent_entity_path: entry.parent_entity_path || null,
    path_segments: structuredClone(entry.path_segments || []),
    reference: entry.persistent_id,
    persistent_id: entry.persistent_id,
    entity_type: 'group',
    kind: 'group',
    name: entry.name || null,
    definition_name: null,
    definition_persistent_id: null,
    entity_definition_name: null,
    entity_definition_persistent_id: null,
    material: entry.material || null,
    back_material: null,
    tag: entry.tag || null,
    classification: null,
    attributes: null,
    texture_transform: null,
    face_uvs: null,
    transform: null,
    transformation: null,
    world_transform: structuredClone(entry.world_transform || null),
    geometry_summary: null,
    visible: entry.visible !== false,
    locked: entry.locked === true,
    effective_locked: entry.effective_locked === true,
    locked_ancestor_path: lockedByAncestor ? entry.parent_entity_path || null : null,
    faces: Number(entry.direct_counts?.faces ?? entry.faces ?? 0),
    edges: Number(entry.direct_counts?.edges ?? entry.edges ?? 0),
    vertices: Number(entry.direct_counts?.vertices ?? entry.vertices ?? 0),
    editable: false,
    proposal_eligible: true,
    edit_scope: 'instance_path',
    allowed_operations: STRUCTURAL_GROUP_PROPOSAL_OPERATIONS,
    bounding_box: structuredClone(entry.world_bounding_box || null),
    spatial_coordinate_space: 'model_world',
    features: [],
    shared_definition: entry.shared_definition === true,
    affected_instance_count: Number(entry.affected_instance_count || 1),
    instance_policy_required: entry.instance_policy_required === true,
    warning: entry.instance_policy_required === true
      ? 'Definition-wide edits may affect multiple occurrences; a reviewed instance policy is required.'
      : null,
    projection_source: 'structural-groups.v1'
  };
}

function occurrenceNode({ key, entity, entityPath, parentId, synthetic, scope, classificationSchemas }) {
  const bbox = normalizeBoundingBox(entity.bounding_box);
  const geometrySummary = structuredClone(entity.geometry_summary || null);
  return {
    node_id: nodeIdFor(key),
    node_type: 'occurrence',
    entity_path: entityPath,
    parent_entity_path: entity.parent_entity_path ?? parentEntityPath(entityPath),
    path_segments: structuredClone(entity.path_segments || []),
    parent_id: parentId,
    reference: entity.reference || entity.id || entity.persistent_id || null,
    persistent_id: entity.persistent_id || null,
    entity_type: entity.entity_type || 'unknown',
    name: entity.name || null,
    kind: entity.kind || entity.entity_type || null,
    definition_name: entity.definition_name || entity.definition || null,
    definition_persistent_id: entity.definition_persistent_id || null,
    entity_definition_name: entity.entity_definition_name || entity.definition || entity.definition_name || null,
    entity_definition_persistent_id: entity.entity_definition_persistent_id || null,
    material: entity.material || null,
    back_material: entity.back_material || null,
    tag: entity.tag || null,
    classification: entity.classification || null,
    native_classification: entity.native_classification || entity.entity_definition_name || entity.definition_name || entity.definition
      ? normalizeNativeClassificationSummary(entity.native_classification, { classificationSchemas })
      : null,
    attributes: structuredClone(entity.attributes || null),
    texture_transform: structuredClone(entity.texture_transform || null),
    face_uvs: structuredClone(entity.face_uvs || null),
    transform: structuredClone(entity.transform || null),
    transformation: structuredClone(entity.transformation || null),
    world_transform: structuredClone(entity.world_transform || entity.transformation || null),
    geometry_summary: geometrySummary,
    visible: entity.visible !== false,
    locked: entity.locked === true,
    effective_locked: entity.effective_locked === true || entity.locked === true,
    locked_ancestor_path: entity.locked_ancestor_path || null,
    soft: entity.soft === true,
    smooth: entity.smooth === true,
    reversed: entity.reversed === true,
    editable: entity.editable === true,
    edit_scope: entity.edit_scope || scope,
    allowed_operations: [...new Set(entity.allowed_operations || [])].sort(),
    bounding_box: bbox,
    spatial_summary: bbox ? {
      center: bboxCenter(bbox),
      size: [bbox.w, bbox.d, bbox.h],
      volume: bboxVolume(bbox),
      coordinate_space: entity.spatial_coordinate_space || 'parent_scope'
    } : null,
    topology_summary: topologySummary(entity, geometrySummary),
    features: structuredClone(entity.features || []),
    shared_definition: entity.shared_definition === true,
    ...(entity.entity_definition_occurrence_count !== undefined && entity.entity_definition_occurrence_count !== null ? { entity_definition_occurrence_count: entity.entity_definition_occurrence_count } : {}),
    affected_instance_count: Number(entity.affected_instance_count || 1),
    instance_policy_required: entity.instance_policy_required === true,
    warning: entity.warning || null,
    synthetic,
    ...(entity.proposal_eligible === true ? { proposal_eligible: true } : {}),
    ...(entity.projection_source ? { projection_source: entity.projection_source } : {}),
    trust: 'untrusted_data',
    source: 'sketchup_model'
  };
}

function mergeOccurrenceNode(existing, next) {
  if (existing.synthetic === false && next.synthetic === true) {
    return { ...existing, parent_id: existing.parent_id || next.parent_id };
  }
  if (existing.synthetic === true && next.synthetic === false) {
    return { ...next, parent_id: next.parent_id || existing.parent_id };
  }
  return {
    ...existing,
    ...next,
    synthetic: existing.synthetic && next.synthetic,
    parent_id: next.parent_id || existing.parent_id,
    allowed_operations: next.allowed_operations.length ? next.allowed_operations : existing.allowed_operations
  };
}

function occurrencePathPrefixes(entityPath) {
  const value = String(entityPath || '');
  if (value.startsWith('pid:')) {
    const segments = value.slice(4).split('.').filter(Boolean);
    return segments.map((_, index) => `pid:${segments.slice(0, index + 1).join('.')}`);
  }
  const segments = value.split('/').filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

function parseOccurrencePath(entityPath, indexedEntity = null) {
  if (String(entityPath).startsWith('pid:')) {
    const persistentId = String(entityPath).slice(4).split('.').at(-1) || null;
    return {
      entity_type: indexedEntity?.entity_type || 'unknown',
      reference: indexedEntity?.reference || indexedEntity?.persistent_id || persistentId,
      persistent_id: indexedEntity?.persistent_id || persistentId
    };
  }
  const last = String(entityPath).split('/').at(-1) || '';
  const match = /(?:^|:)(component_instance|group|face|edge):([^:]+)$/i.exec(last);
  if (!match) return { entity_type: indexedEntity?.entity_type || 'unknown', reference: indexedEntity?.reference || last, persistent_id: indexedEntity?.persistent_id || null };
  return { entity_type: match[1], reference: decodeReference(match[2]), persistent_id: indexedEntity?.persistent_id || null };
}

function decodeReference(value) {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return decoded || value;
  } catch {
    return value;
  }
}

function topEntityName(entities = [], reference) {
  return entities.find((entity) => [entity.id, entity.persistent_id, entity.reference].includes(reference))?.name || null;
}

function parentEntityPath(entityPath) {
  if (!entityPath) return null;
  const prefixes = occurrencePathPrefixes(entityPath);
  return prefixes.length > 1 ? prefixes.at(-2) : null;
}

function definitionDescriptors(adoption, recursiveEntries, classificationSchemas) {
  const result = new Map();
  const add = (name, persistentId, nativeClassification = null) => {
    const normalizedName = typeof name === 'string' && name ? name : null;
    const normalizedPersistentId = persistentId === undefined || persistentId === null || persistentId === '' ? null : String(persistentId);
    const sameName = normalizedName ? [...result.values()].find((entry) => entry.name === normalizedName) : null;
    if (!normalizedPersistentId && sameName?.persistent_id) return;
    if (normalizedPersistentId && sameName && sameName.key !== normalizedPersistentId) result.delete(sameName.key);
    const key = normalizedPersistentId || normalizedName;
    if (!key) return;
    const existing = result.get(key);
    result.set(key, {
      key,
      name: normalizedName || existing?.name || null,
      persistent_id: normalizedPersistentId || existing?.persistent_id || null,
      native_classification: normalizeNativeClassificationSummary(
        nativeClassification || existing?.native_classification,
        { classificationSchemas }
      )
    });
  };
  for (const name of adoption.snapshot?.component_definitions || []) add(name, null);
  for (const summary of adoption.component_definition_summaries || adoption.snapshot?.component_definition_summaries || []) {
    add(summary.name, summary.persistent_id, summary.native_classification);
  }
  for (const entry of recursiveEntries) {
    add(entry.definition_name, entry.definition_persistent_id);
    add(entry.entity_definition_name, entry.entity_definition_persistent_id, entry.native_classification);
  }
  return result;
}

function definitionKeyForNode(node) {
  if (['group', 'component_instance'].includes(node.entity_type)) {
    return node.entity_definition_persistent_id || node.entity_definition_name || node.definition_persistent_id || node.definition_name || null;
  }
  return node.definition_persistent_id || node.definition_name || node.entity_definition_persistent_id || node.entity_definition_name || null;
}

function occurrencePathMatchesEntity(entityPath, entry, entity) {
  const parsed = parseOccurrencePath(entityPath, entry);
  const entryReferences = [entry?.reference, entry?.persistent_id, parsed.reference, parsed.persistent_id]
    .filter((value) => value !== undefined && value !== null)
    .map(String);
  const entityReferences = [entity.id, entity.persistent_id, entity.reference]
    .filter((value) => value !== undefined && value !== null)
    .map(String);
  return entryReferences.some((value) => entityReferences.includes(value));
}

function findTopEntity(entities = [], parsed) {
  return entities.find((entity) => {
    const references = [entity.id, entity.persistent_id, entity.reference]
      .filter((value) => value !== undefined && value !== null)
      .map(String);
    return [parsed.reference, parsed.persistent_id]
      .filter((value) => value !== undefined && value !== null)
      .map(String)
      .some((value) => references.includes(value));
  }) || null;
}

function spatialRelationships(nodes) {
  const result = [];
  const byParent = new Map();
  for (const node of nodes.filter((item) => item.bounding_box && ['group', 'component_instance'].includes(item.entity_type))) {
    const key = node.parent_id || 'model';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(node);
  }
  for (const siblings of byParent.values()) {
    for (let leftIndex = 0; leftIndex < siblings.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < siblings.length; rightIndex += 1) {
        if (result.length >= 5000) return result;
        const left = siblings[leftIndex];
        const right = siblings[rightIndex];
        const leftCenter = left.spatial_summary.center;
        const rightCenter = right.spatial_summary.center;
        if (Math.abs(leftCenter[0] - rightCenter[0]) > 1e-6) result.push({ type: leftCenter[0] < rightCenter[0] ? 'left_of' : 'right_of', from: left.node_id, to: right.node_id });
        if (Math.abs(leftCenter[1] - rightCenter[1]) > 1e-6) result.push({ type: leftCenter[1] < rightCenter[1] ? 'in_front_of' : 'behind', from: left.node_id, to: right.node_id });
        if (Math.abs(leftCenter[2] - rightCenter[2]) > 1e-6) result.push({ type: leftCenter[2] < rightCenter[2] ? 'below' : 'above', from: left.node_id, to: right.node_id });
        if (bboxOverlap(left.bounding_box, right.bounding_box)) result.push({ type: 'bbox_overlaps', from: left.node_id, to: right.node_id });
      }
    }
  }
  return result;
}

function normalizeBoundingBox(value) {
  if (!value?.min || !value?.max) return null;
  const min = value.min.map(Number);
  const max = value.max.map(Number);
  return {
    min,
    max,
    w: Number(value.w ?? max[0] - min[0]),
    d: Number(value.d ?? max[1] - min[1]),
    h: Number(value.h ?? max[2] - min[2])
  };
}

function bboxCenter(box) {
  return [0, 1, 2].map((axis) => round((box.min[axis] + box.max[axis]) / 2));
}

function bboxVolume(box) {
  return round(Math.max(0, box.w) * Math.max(0, box.d) * Math.max(0, box.h));
}

function bboxOverlap(left, right) {
  return [0, 1, 2].every((axis) => left.min[axis] <= right.max[axis] && right.min[axis] <= left.max[axis]);
}

function nodeIdFor(value) {
  return `node_${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

const relationshipKeys = new WeakMap();
function addUniqueRelationship(list, relationship) {
  let keys = relationshipKeys.get(list);
  if (!keys) { keys = new Set(list.map(item => `${item.type}:${item.from}:${item.to}`)); relationshipKeys.set(list, keys); }
  const key = `${relationship.type}:${relationship.from}:${relationship.to}`;
  if (!keys.has(key)) { keys.add(key); list.push(relationship); }
}

function topologySummary(entity, geometrySummary) {
  if (geometrySummary?.type === 'face') {
    return {
      faces: 1,
      edges: Number(geometrySummary.edge_count || 0),
      vertices: Number(geometrySummary.vertex_count || 0)
    };
  }
  if (geometrySummary?.type === 'edge') {
    return {
      faces: Number(geometrySummary.adjacent_face_count || 0),
      edges: 1,
      vertices: Array.isArray(geometrySummary.endpoints) ? geometrySummary.endpoints.length : 0
    };
  }
  return { faces: Number(entity.faces || 0), edges: Number(entity.edges || 0), vertices: Number(entity.vertices || 0) };
}

function modelGraphId(graph) {
  const digest = sha256Canonical({
    version: graph.version,
    kind: graph.kind,
    model_revision: graph.model_revision,
    runtime: graph.runtime,
    source_adoption_version: graph.source_adoption_version,
    source_adoption_hash: graph.source_adoption_hash,
    completeness: graph.completeness,
    ...(graph.projections ? { projections: graph.projections } : {}),
    nodes: graph.nodes,
    relationships: graph.relationships,
    catalogs: graph.catalogs,
    lineage: graph.lineage,
    untrusted_data_fields: graph.untrusted_data_fields
  }).slice(7, 31);
  return `model-graph-${digest}`;
}

function validateRelationshipEndpoints(family, type, from, to, violations) {
  const valid = family === 'hierarchy'
    ? from.node_type === 'occurrence' && to.node_type === 'occurrence' && to.parent_id === from.node_id
    : family === 'definition_membership'
      ? from.node_type === 'occurrence' && to.node_type === 'definition'
      : family === 'topology' && type === 'belongs_to_geometry'
        ? from.node_type === 'occurrence' && ['face', 'edge'].includes(from.entity_type) && to.node_type === 'occurrence'
        : family === 'topology' && type === 'has_feature'
          ? from.node_type === 'occurrence' && to.node_type === 'feature'
          : family === 'spatial'
            ? from.node_type === 'occurrence' && to.node_type === 'occurrence' && from.parent_id === to.parent_id
            : family === 'lineage'
              ? from.node_type === 'model' && to.node_type === 'artifact'
              : false;
  if (!valid) violations.push(`invalid_relationship_endpoints:${family}:${type}:${from.node_id}:${to.node_id}`);
}

function validateGraphProjections(graph, violations) {
  if (graph.projections === undefined) return;
  const projectionNames = Object.keys(graph.projections || {});
  if (projectionNames.length !== 1 || projectionNames[0] !== 'structural_groups') {
    violations.push('invalid_projection_registry');
    return;
  }
  const coverage = graph.projections.structural_groups;
  const projectedNodes = graph.nodes.filter((node) => node.projection_source === 'structural-groups.v1');
  if (coverage?.version !== 'structural-groups.v1'
    || !Number.isInteger(coverage.total_seen)
    || !Number.isInteger(coverage.indexed)
    || !Number.isInteger(coverage.limit)
    || coverage.indexed !== projectedNodes.length
    || coverage.total_seen < coverage.indexed
    || coverage.leaf_entities_materialized !== false
    || coverage.coordinate_space !== 'model_world'
    || coverage.proposal_only !== true
    || coverage.execution_allowed !== false
    || JSON.stringify(coverage.eligible_entity_types) !== JSON.stringify(['group'])) {
    violations.push('invalid_structural_group_projection_coverage');
  }
  const expectedComplete = coverage?.total_seen_exact === true
    && coverage?.truncated === false
    && coverage?.total_seen === coverage?.indexed;
  if (coverage?.complete !== expectedComplete) violations.push('structural_group_projection_completeness_inconsistent');
  for (const node of projectedNodes) {
    if (node.node_type !== 'occurrence'
      || node.entity_type !== 'group'
      || node.proposal_eligible !== true
      || node.editable !== false
      || node.spatial_summary?.coordinate_space !== 'model_world'
      || !node.entity_path?.startsWith('pid:')) {
      violations.push(`invalid_structural_group_projection_node:${node.node_id}`);
    }
  }
}

function validateNodeShape(node, violations) {
  const requiredByType = {
    model: ['model_revision'],
    occurrence: [
      'entity_path', 'parent_entity_path', 'path_segments', 'parent_id', 'reference', 'persistent_id', 'entity_type',
      'name', 'kind', 'definition_name', 'definition_persistent_id', 'entity_definition_name',
      'entity_definition_persistent_id', 'material', 'back_material', 'tag', 'classification', 'native_classification', 'attributes',
      'texture_transform', 'face_uvs', 'transform', 'transformation', 'world_transform', 'geometry_summary',
      'visible', 'locked', 'soft', 'smooth', 'reversed', 'editable', 'edit_scope', 'allowed_operations',
      'effective_locked', 'locked_ancestor_path',
      'bounding_box', 'spatial_summary', 'topology_summary', 'features', 'shared_definition',
      'affected_instance_count', 'instance_policy_required', 'warning', 'synthetic'
    ],
    definition: ['name', 'persistent_id', 'native_classification', 'occurrence_count'],
    feature: ['feature_type', 'feature_id', 'summary'],
    artifact: ['artifact_kind', 'artifact_handle', 'content_sha256', 'source_task_id', 'label', 'media_type', 'provenance_trust', 'policy_effect']
  };
  const required = requiredByType[node.node_type];
  if (!required) {
    violations.push(`invalid_node_type:${node.node_type}`);
    return;
  }
  for (const field of required) {
    if (!Object.hasOwn(node, field)) violations.push(`missing_node_field:${node.node_type}:${node.node_id}:${field}`);
  }
  if (node.native_classification !== undefined && node.native_classification !== null) {
    const summary = node.native_classification;
    if (summary.version !== 'sketchup-native-classification-summary.v1'
      || summary.trust !== 'untrusted_data'
      || summary.policy_effect !== 'none'
      || summary.assignment_enumeration !== 'unsupported_by_sketchup_ruby_api'
      || summary.assignment_presence !== 'unknown'
      || summary.complete !== false
      || summary.values_exposed !== false
      || !Array.isArray(summary.blockers)
      || !summary.blockers.includes('assigned_schema_types_not_enumerable')) {
      violations.push(`invalid_native_classification_summary:${node.node_id}`);
    }
  }
  if (node.node_type === 'occurrence') {
    if (!['group', 'component_instance', 'face', 'edge', 'unknown'].includes(node.entity_type)) violations.push(`invalid_occurrence_type:${node.node_id}`);
    if (!Array.isArray(node.path_segments) || !Array.isArray(node.allowed_operations) || !Array.isArray(node.features)) violations.push(`invalid_occurrence_arrays:${node.node_id}`);
    if (!node.entity_path && (node.reference === null || node.reference === undefined)) violations.push(`unaddressable_occurrence:${node.node_id}`);
    if (node.synthetic !== true && node.entity_type === 'unknown') violations.push(`unknown_authoritative_occurrence:${node.node_id}`);
  }
  if (node.node_type === 'definition' && node.name === null && node.persistent_id === null) violations.push(`unidentified_definition:${node.node_id}`);
  if (node.node_type === 'artifact' && node.trust !== 'untrusted_data') violations.push(`artifact_content_trust_invalid:${node.node_id}`);
}

function applyEffectiveLocks(nodes) {
  for (const node of nodes.values()) {
    if (node.node_type !== 'occurrence') continue;
    const precomputedEffectiveLock = node.effective_locked === true;
    const precomputedLockedAncestorPath = node.locked_ancestor_path || null;
    let current = node;
    let lockedAncestorPath = null;
    const visited = new Set();
    while (current?.parent_id && !visited.has(current.parent_id)) {
      visited.add(current.parent_id);
      const parent = nodes.get(current.parent_id);
      if (!parent || parent.node_type !== 'occurrence') break;
      if (parent.locked === true) {
        lockedAncestorPath = parent.entity_path || null;
        break;
      }
      current = parent;
    }
    node.effective_locked = precomputedEffectiveLock || node.locked === true || lockedAncestorPath !== null;
    node.locked_ancestor_path = precomputedLockedAncestorPath || lockedAncestorPath;
  }
}

function invalidModelGraph(violations) {
  return new AgentContractError('INVALID_ARGUMENT', 'ModelGraph failed fail-closed semantic validation.', {
    details: { violations: violations.slice(0, 50) }
  });
}

function uniqueValues(values) {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

function graphStats(graph) {
  const occurrences = graph.nodes.filter((node) => node.node_type === 'occurrence');
  return {
    nodes: graph.nodes.length,
    occurrences: occurrences.length,
    definitions: graph.nodes.filter((node) => node.node_type === 'definition').length,
    faces: occurrences.filter((node) => node.entity_type === 'face').length,
    edges: occurrences.filter((node) => node.entity_type === 'edge').length,
    shared_occurrences: occurrences.filter((node) => node.shared_definition).length,
    hierarchy_relationships: graph.relationships.hierarchy.length,
    spatial_relationships: graph.relationships.spatial.length,
    topology_relationships: graph.relationships.topology.length,
    lineage_relationships: graph.relationships.lineage.length
  };
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}
