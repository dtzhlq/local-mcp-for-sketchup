import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Canonical } from './agent-contract.mjs';
import { modelRevisionForAdoption } from './existing-model-editing.mjs';

export const MODEL_GRAPH_VERSION = 'model-graph.v1';

export function buildModelGraph(adoption, { lineage = {}, sourceArtifacts = [] } = {}) {
  if (adoption?.kind !== 'adopt_open_model') throw new Error('buildModelGraph requires an adopt_open_model report');
  const modelRevision = modelRevisionForAdoption(adoption);
  const nodes = new Map();
  const hierarchy = [];
  const definitionMembership = [];
  const topology = [];

  for (const entity of adoption.entities || []) {
    const node = occurrenceNode({
      key: `top:${entity.id || entity.persistent_id || entity.name}`,
      entity,
      entityPath: null,
      parentId: null,
      synthetic: false,
      scope: 'top_level'
    });
    nodes.set(node.node_id, node);
  }

  for (const entry of adoption.recursive_index || []) {
    const prefixes = occurrencePathPrefixes(entry.entity_path);
    let parentId = null;
    for (let index = 0; index < prefixes.length; index += 1) {
      const entityPath = prefixes[index];
      const isLeaf = index === prefixes.length - 1;
      const parsed = parseOccurrencePath(entityPath);
      const nodeId = nodeIdFor(`occurrence:${entityPath}`);
      const entity = isLeaf ? entry : {
        entity_type: parsed.entity_type,
        reference: parsed.reference,
        name: topEntityName(adoption.entities, parsed.reference),
        editable: parsed.entity_type !== 'model',
        edit_scope: 'instance_path',
        visible: true
      };
      const node = occurrenceNode({
        key: `occurrence:${entityPath}`,
        entity,
        entityPath,
        parentId,
        synthetic: !isLeaf,
        scope: 'instance_path'
      });
      const existing = nodes.get(nodeId);
      nodes.set(nodeId, existing ? mergeOccurrenceNode(existing, node) : node);
      if (parentId) addUniqueRelationship(hierarchy, { type: 'parent_child', from: parentId, to: nodeId });
      if (['face', 'edge'].includes(node.entity_type) && parentId) addUniqueRelationship(topology, { type: 'belongs_to_geometry', from: nodeId, to: parentId });
      parentId = nodeId;
    }
  }

  const definitionNames = new Set([
    ...(adoption.snapshot?.component_definitions || []),
    ...(adoption.recursive_index || []).map((entry) => entry.definition_name).filter(Boolean)
  ]);
  for (const name of [...definitionNames].sort()) {
    const node = {
      node_id: nodeIdFor(`definition:${name}`),
      node_type: 'definition',
      name,
      trust: 'untrusted_data',
      source: 'sketchup_model',
      occurrence_count: (adoption.recursive_index || []).filter((entry) => entry.definition_name === name && ['group', 'component_instance'].includes(entry.entity_type)).length
    };
    nodes.set(node.node_id, node);
  }
  for (const node of nodes.values()) {
    if (node.node_type !== 'occurrence' || !node.definition_name) continue;
    const definitionId = nodeIdFor(`definition:${node.definition_name}`);
    if (nodes.has(definitionId)) definitionMembership.push({ type: 'instance_of', from: node.node_id, to: definitionId });
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
  for (const [entityPath, refs] of Object.entries(lineage.entity_paths || {})) {
    const occurrenceId = nodeIdFor(`occurrence:${entityPath}`);
    if (!nodes.has(occurrenceId)) continue;
    for (const ref of Array.isArray(refs) ? refs : [refs]) {
      lineageRelationships.push({ type: 'derived_from', from: occurrenceId, to: String(ref) });
    }
  }

  const graphCore = {
    version: MODEL_GRAPH_VERSION,
    kind: 'model_graph',
    model_revision: modelRevision,
    runtime: adoption.runtime,
    source_adoption_version: adoption.version,
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
      classifications: uniqueValues(occurrenceNodes.map((node) => node.classification).filter(Boolean))
    },
    lineage: {
      part_graph: lineage.part_graph || null,
      parametric_recipe: lineage.parametric_recipe || null,
      feature_mapping_plan: lineage.feature_mapping_plan || null,
      evidence: lineage.evidence || [],
      source_artifacts: sourceArtifacts
    },
    untrusted_data_fields: ['name', 'material', 'tag', 'classification', 'attributes', 'ocr', 'feature.summary']
  };
  const stats = graphStats(graphCore);
  const graphId = sha256Canonical({ model_revision: modelRevision, nodes: graphCore.nodes, relationships: graphCore.relationships, lineage: graphCore.lineage }).slice(7, 31);
  return { ...graphCore, graph_id: `model-graph-${graphId}`, stats };
}

export async function writeModelGraph(filePath, graph) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
  return filePath;
}

function occurrenceNode({ key, entity, entityPath, parentId, synthetic, scope }) {
  const bbox = normalizeBoundingBox(entity.bounding_box);
  return {
    node_id: nodeIdFor(key),
    node_type: 'occurrence',
    entity_path: entityPath,
    parent_id: parentId,
    reference: entity.reference || entity.id || entity.persistent_id || null,
    persistent_id: entity.persistent_id || null,
    entity_type: entity.entity_type || 'unknown',
    name: entity.name || null,
    kind: entity.kind || entity.entity_type || null,
    definition_name: entity.definition_name || entity.definition || null,
    material: entity.material || null,
    back_material: entity.back_material || null,
    tag: entity.tag || null,
    classification: entity.classification || null,
    attributes: structuredClone(entity.attributes || null),
    visible: entity.visible !== false,
    locked: entity.locked === true,
    editable: entity.editable === true,
    edit_scope: entity.edit_scope || scope,
    allowed_operations: [...new Set(entity.allowed_operations || [])].sort(),
    bounding_box: bbox,
    spatial_summary: bbox ? { center: bboxCenter(bbox), size: [bbox.w, bbox.d, bbox.h], volume: bboxVolume(bbox) } : null,
    topology_summary: { faces: Number(entity.faces || 0), edges: Number(entity.edges || 0), vertices: Number(entity.vertices || 0) },
    features: structuredClone(entity.features || []),
    shared_definition: entity.shared_definition === true,
    affected_instance_count: Number(entity.affected_instance_count || 1),
    instance_policy_required: entity.instance_policy_required === true,
    warning: entity.warning || null,
    synthetic,
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
  const segments = String(entityPath || '').split('/').filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

function parseOccurrencePath(entityPath) {
  const last = String(entityPath).split('/').at(-1) || '';
  const match = /(?:^|:)(component_instance|group|face|edge):([^:]+)$/i.exec(last);
  if (!match) return { entity_type: 'unknown', reference: last };
  return { entity_type: match[1], reference: decodeReference(match[2]) };
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

function addUniqueRelationship(list, relationship) {
  if (!list.some((item) => item.type === relationship.type && item.from === relationship.from && item.to === relationship.to)) list.push(relationship);
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
