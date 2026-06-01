export const VISUAL_RELATION_TYPES = [
  'left_of',
  'right_of',
  'above',
  'below',
  'inside',
  'aligned_with',
  'touching',
  'same_row',
  'mirrored_pair',
  'centered_on'
];

const DIRECTION_TYPES = new Set(['left_of', 'right_of', 'above', 'below']);
const SYMMETRIC_TYPES = new Set(['aligned_with', 'touching', 'same_row', 'mirrored_pair', 'centered_on']);
const PHYSICAL_RELATION_TYPES = new Set([
  'left_of',
  'right_of',
  'above',
  'below',
  'inside',
  'aligned_with',
  'touching',
  'same_row',
  'mirrored_pair',
  'centered_on'
]);

export function makeImageRelationCandidates(imageObservation = {}) {
  const image = imageObservation.image || {};
  const width = Number(image.analysis_width || image.width || 1);
  const height = Number(image.analysis_height || image.height || 1);
  const entities = relationEntitiesForImage(imageObservation, { width, height });
  const relations = [];

  for (let leftIndex = 0; leftIndex < entities.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entities.length; rightIndex += 1) {
      const a = entities[leftIndex];
      const b = entities[rightIndex];
      if (a.item === b.item) continue;
      relations.push(...pairRelations(a, b, imageObservation, { width, height }));
    }
  }

  relations.push(...semanticAnchorRelations(imageObservation));
  return dedupeRelations(relations)
    .sort((a, b) => (a.source_image || '').localeCompare(b.source_image || '') || a.id.localeCompare(b.id));
}

export function makeVisualRelationGraph({ objectProfile, images = [] } = {}) {
  const relations = dedupeRelations(images.flatMap((image) => image.relation_candidates || []));
  const openQuestions = [];
  const lowConfidence = relations.filter((relation) => relation.review_required);
  if (lowConfidence.length > 0) {
    openQuestions.push(`Review ${lowConfidence.length} image-space relation candidate(s) before treating placement as visually grounded.`);
  }
  if (objectProfile === 'building_group') {
    openQuestions.push('Confirm campus north/up before mapping image-space left/right/above/below to site coordinates.');
  }
  if (objectProfile === 'switch_controller') {
    openQuestions.push('Confirm Switch handedness with thumbstick, ABXY, and D-pad anchors before accepting mirrored geometry.');
  }

  return {
    version: 1,
    coordinate_convention: 'image_x_right_y_down',
    relation_types: VISUAL_RELATION_TYPES,
    source_images: unique(images.map((image) => image.image?.path).filter(Boolean)),
    relations,
    summary: {
      total: relations.length,
      by_type: countBy(relations, 'type'),
      review_required: lowConfidence.length,
      image_count: images.length
    },
    open_questions: unique(openQuestions)
  };
}

export function visualRelationsForPartGraph(observationSet = {}, parts = []) {
  const partIds = new Set((parts || []).map((part) => part.id).filter(Boolean));
  const relations = observationSet.visual_relation_graph?.relations || observationSet.evidence_graph?.visual_relations || [];
  return dedupeRelations(relations)
    .filter((relation) => partIds.has(relation.item) && partIds.has(relation.anchor))
    .map((relation) => ({
      id: relation.id,
      type: relation.type,
      subject: relation.item,
      target: relation.anchor,
      source: 'visual_relation_graph',
      confidence: relation.confidence,
      review_required: relation.review_required,
      evidence: {
        source_image: relation.source_image,
        view: relation.view,
        basis: relation.basis
      },
      note: relation.note || `${relation.item} ${relation.type} ${relation.anchor} in image-space evidence.`
    }));
}

export function addVisualRelationshipsToParts(parts = [], visualRelations = []) {
  const bySubject = new Map();
  for (const relation of visualRelations) {
    if (!relation.subject || !relation.target) continue;
    if (!shouldMapPartRelationship(relation)) continue;
    const relationships = bySubject.get(relation.subject) || [];
    relationships.push({
      type: relation.type,
      target: relation.target,
      source: relation.source || 'visual_relation_graph',
      confidence: relation.confidence,
      review_required: relation.review_required,
      note: relation.note
    });
    bySubject.set(relation.subject, relationships);
  }
  if (bySubject.size === 0) return parts;
  return parts.map((part) => {
    const relationships = bySubject.get(part.id) || [];
    if (!relationships.length) return part;
    return {
      ...part,
      relationships: dedupePartRelationships([...(part.relationships || []), ...relationships])
    };
  });
}

export function visualPhysicalRelationsForPartGraph(visualRelations = [], options = {}) {
  const severity = options.severity || 'info';
  const minConfidence = options.minConfidence ?? 0.44;
  return bestVisualRelationByTriple(visualRelations)
    .filter((relation) => shouldMapPhysicalRelation(relation, minConfidence))
    .map((relation) => ({
      id: `visual-${relation.subject}-${relation.type}-${relation.target}`,
      type: relation.type,
      subject: relation.subject,
      target: relation.target,
      source: relation.source || 'visual_relation_graph',
      coordinate_space: 'image_plane_projected_to_model_xy',
      confidence: relation.confidence,
      review_required: relation.review_required,
      severity,
      tolerance_mm: physicalRelationToleranceMm(relation),
      min_delta_mm: physicalRelationMinDeltaMm(relation),
      visual_axis: relation.evidence?.basis?.axis || null,
      evidence: relation.evidence || null,
      note: relation.note || `${relation.subject} ${relation.type} ${relation.target} from VisualRelationGraph evidence.`
    }));
}

export function addVisualPhysicalRelationsToParts(parts = [], visualRelations = [], options = {}) {
  const bySubject = new Map();
  for (const relation of visualPhysicalRelationsForPartGraph(visualRelations, options)) {
    if (!relation.subject || !relation.target) continue;
    const list = bySubject.get(relation.subject) || [];
    list.push(relation);
    bySubject.set(relation.subject, list);
  }
  if (bySubject.size === 0) return parts;
  return parts.map((part) => {
    const relations = bySubject.get(part.id) || [];
    if (!relations.length) return part;
    return {
      ...part,
      physical_relations: dedupePhysicalRelations([...(part.physical_relations || []), ...relations])
    };
  });
}

function shouldMapPartRelationship(relation) {
  if ((relation.confidence ?? 0) < 0.5) return false;
  if (relation.type === 'touching') return false;
  if (/^scale_anchor_/.test(relation.subject) || /^scale_anchor_/.test(relation.target)) return false;
  if (['left_of', 'right_of', 'above', 'below'].includes(relation.type) && relation.target === 'site_boundary') return false;
  return true;
}

function shouldMapPhysicalRelation(relation, minConfidence) {
  if (!PHYSICAL_RELATION_TYPES.has(relation.type)) return false;
  if (![...DIRECTION_TYPES, 'inside'].includes(relation.type)) return false;
  if ((relation.confidence ?? 0) < minConfidence) return false;
  if (!relation.subject || !relation.target) return false;
  if (/^scale_anchor_/.test(relation.subject) || /^scale_anchor_/.test(relation.target)) return false;
  if (['left_of', 'right_of', 'above', 'below'].includes(relation.type) && relation.target === 'site_boundary') return false;
  return true;
}

function bestVisualRelationByTriple(relations = []) {
  const byTriple = new Map();
  for (const relation of relations) {
    const key = `${relation.subject}|${relation.type}|${relation.target}`;
    const existing = byTriple.get(key);
    if (!existing || relationPhysicalScore(relation) > relationPhysicalScore(existing)) byTriple.set(key, relation);
  }
  return [...byTriple.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function relationPhysicalScore(relation) {
  const basis = relation.evidence?.basis || relation.basis || {};
  const grounding = [basis.item_grounding?.method, basis.anchor_grounding?.method].filter(Boolean).join(' ');
  const pixelBoost = /pixel_/i.test(grounding) ? 8 : 0;
  const topBoost = relation.evidence?.view === 'top' || relation.view === 'top' ? 4 : 0;
  const reviewPenalty = relation.review_required ? -0.5 : 0;
  return pixelBoost + topBoost + reviewPenalty + (Number(relation.confidence) || 0);
}

function physicalRelationToleranceMm(relation) {
  if (relation.type === 'inside') return 1200;
  if (relation.type === 'touching') return 1800;
  if (['aligned_with', 'same_row', 'centered_on', 'mirrored_pair'].includes(relation.type)) return 2200;
  return 500;
}

function physicalRelationMinDeltaMm(relation) {
  const spacing = Number(relation.evidence?.basis?.spacing_ratio ?? relation.basis?.spacing_ratio);
  if (Number.isFinite(spacing)) return Math.max(500, Math.round(spacing * 1200));
  if (DIRECTION_TYPES.has(relation.type)) return 500;
  return 0;
}

function relationEntitiesForImage(imageObservation, { width, height }) {
  const entities = [];
  for (const observation of imageObservation.observations || []) {
    const item = observation.component_hint;
    if (!item || item === 'main_outline' || item === 'symmetry_axis' || item === 'uncertain_main_object') continue;
    const bbox = observation.bbox || bboxFromPoints(observation.points);
    const point = centerForObservation(observation);
    if (!bbox && !point) continue;
    entities.push({
      item,
      observation_id: observation.id,
      observation_kind: observation.kind,
      bbox,
      point: point || centerForBbox(bbox),
      confidence: observation.confidence ?? 0.4,
      note: observation.note,
      grounding: observation.grounding || null,
      normalized_area: bbox ? (bbox[2] * bbox[3]) / Math.max(1, width * height) : 0
    });
  }
  return bestEntityPerComponent(entities);
}

function pairRelations(a, b, imageObservation, frame) {
  const relations = [];
  const delta = normalizedDelta(a, b, frame);
  const axisDominance = Math.abs(delta.x) - Math.abs(delta.y);
  if (Math.abs(delta.x) >= 0.045 && axisDominance >= -0.03) {
    relations.push(relationCandidate(delta.x < 0 ? 'left_of' : 'right_of', a, b, imageObservation, frame, { axis: 'x' }));
    relations.push(relationCandidate(delta.x < 0 ? 'right_of' : 'left_of', b, a, imageObservation, frame, { axis: 'x' }));
  }
  if (Math.abs(delta.y) >= 0.045 && -axisDominance >= -0.03) {
    relations.push(relationCandidate(delta.y < 0 ? 'above' : 'below', a, b, imageObservation, frame, { axis: 'y' }));
    relations.push(relationCandidate(delta.y < 0 ? 'below' : 'above', b, a, imageObservation, frame, { axis: 'y' }));
  }
  if (verticallyStacked(a, b, frame)) {
    relations.push(relationCandidate(delta.y < 0 ? 'above' : 'below', a, b, imageObservation, frame, { axis: 'y', stacked_small_parts: true }));
    relations.push(relationCandidate(delta.y < 0 ? 'below' : 'above', b, a, imageObservation, frame, { axis: 'y', stacked_small_parts: true }));
  }
  if (sameRow(a, b, frame)) {
    relations.push(relationCandidate('same_row', a, b, imageObservation, frame, { axis: 'y' }));
  }
  const alignedAxis = alignedAxisFor(a, b, frame);
  if (alignedAxis) {
    relations.push(relationCandidate('aligned_with', a, b, imageObservation, frame, { axis: alignedAxis }));
  }
  const inside = insideRelation(a, b);
  if (inside) {
    relations.push(relationCandidate('inside', inside.item, inside.anchor, imageObservation, frame, { containment_ratio: inside.ratio }));
  }
  const centered = centeredRelation(a, b, frame);
  if (centered) {
    relations.push(relationCandidate('centered_on', centered.item, centered.anchor, imageObservation, frame, { axis: centered.axis }));
  }
  if (touching(a, b, frame)) {
    relations.push(relationCandidate('touching', a, b, imageObservation, frame, { axis: touchingAxis(a, b) }));
  }
  if (mirroredPair(a, b, imageObservation, frame)) {
    relations.push(relationCandidate('mirrored_pair', a, b, imageObservation, frame, {
      symmetry_axis_x: imageObservation.camera_hints?.symmetry_axis?.a?.[0]
    }));
  }
  return relations;
}

function relationCandidate(type, itemEntity, anchorEntity, imageObservation, frame, extraBasis = {}) {
  const delta = normalizedDelta(itemEntity, anchorEntity, frame);
  const confidence = relationConfidence(type, itemEntity, anchorEntity, extraBasis);
  const sourceImage = imageObservation.image?.path;
  const id = [
    sourceImage,
    imageObservation.detected_view?.kind,
    itemEntity.item,
    type,
    anchorEntity.item,
    itemEntity.observation_id,
    anchorEntity.observation_id
  ].filter(Boolean).join('|');
  return {
    id,
    type,
    item: itemEntity.item,
    anchor: anchorEntity.item,
    source_image: sourceImage,
    view: imageObservation.detected_view?.kind,
    basis: {
      kind: basisKind(itemEntity, anchorEntity),
      item_observation_id: itemEntity.observation_id,
      anchor_observation_id: anchorEntity.observation_id,
      item_bbox: itemEntity.bbox || null,
      anchor_bbox: anchorEntity.bbox || null,
      item_keypoint: itemEntity.point || null,
      anchor_keypoint: anchorEntity.point || null,
      item_grounding: itemEntity.grounding || null,
      anchor_grounding: anchorEntity.grounding || null,
      item_note: itemEntity.note || null,
      anchor_note: anchorEntity.note || null,
      delta_norm: [round(delta.x), round(delta.y)],
      spacing_ratio: round(Math.hypot(delta.x, delta.y)),
      ...extraBasis
    },
    confidence,
    review_required: confidence < 0.72 || templateLike(itemEntity) || templateLike(anchorEntity),
    note: `${itemEntity.item} is ${type} ${anchorEntity.item} in ${imageObservation.detected_view?.kind || 'unknown'} image space.`
  };
}

function semanticAnchorRelations(imageObservation = {}) {
  return (imageObservation.orientation_hints?.semantic_anchors || [])
    .filter((anchor) => VISUAL_RELATION_TYPES.includes(anchor.direction))
    .map((anchor) => ({
      id: [
        imageObservation.image?.path,
        imageObservation.detected_view?.kind,
        anchor.item,
        anchor.direction,
        anchor.anchor,
        anchor.id
      ].filter(Boolean).join('|'),
      type: anchor.direction,
      item: anchor.item,
      anchor: anchor.anchor,
      source_image: imageObservation.image?.path,
      view: imageObservation.detected_view?.kind,
      basis: {
        kind: 'semantic_anchor',
        semantic_anchor_id: anchor.id,
        coordinate_convention: imageObservation.orientation_hints?.coordinate_convention || 'image_x_right_y_down'
      },
      confidence: round(anchor.confidence ?? 0.5),
      review_required: imageObservation.orientation_hints?.review_required !== false || (anchor.confidence ?? 0) < 0.72,
      note: anchor.note || `${anchor.item} ${anchor.direction} ${anchor.anchor}.`
    }));
}

function bestEntityPerComponent(entities) {
  const byKey = new Map();
  for (const entity of entities) {
    const key = entity.item;
    const existing = byKey.get(key);
    if (!existing || entityScore(entity) > entityScore(existing)) byKey.set(key, entity);
  }
  return [...byKey.values()];
}

function entityScore(entity) {
  const groundingBoost = /^pixel_/i.test(entity.grounding?.method || '') ? 6 : 0;
  const priorPenalty = /template|layout|prior/i.test(entity.note || '') || entity.grounding?.method === 'layout_prior' ? -3 : 0;
  return groundingBoost + priorPenalty + (entity.bbox ? 2 : 0) + (entity.point ? 1 : 0) + (entity.confidence || 0);
}

function normalizedDelta(a, b, frame) {
  return {
    x: (a.point[0] - b.point[0]) / Math.max(1, frame.width),
    y: (a.point[1] - b.point[1]) / Math.max(1, frame.height)
  };
}

function sameRow(a, b, frame) {
  const delta = normalizedDelta(a, b, frame);
  return Math.abs(delta.y) <= 0.055 && Math.abs(delta.x) >= 0.06;
}

function alignedAxisFor(a, b, frame) {
  const delta = normalizedDelta(a, b, frame);
  if (Math.abs(delta.x) <= 0.035 && Math.abs(delta.y) >= 0.05) return 'x';
  if (Math.abs(delta.y) <= 0.035 && Math.abs(delta.x) >= 0.05) return 'y';
  return null;
}

function insideRelation(a, b) {
  if (!a.bbox || !b.bbox) return null;
  const aInB = containmentRatio(a.bbox, b.bbox);
  const bInA = containmentRatio(b.bbox, a.bbox);
  if (aInB >= 0.86 && area(a.bbox) < area(b.bbox) * 0.82) return { item: a, anchor: b, ratio: round(aInB) };
  if (bInA >= 0.86 && area(b.bbox) < area(a.bbox) * 0.82) return { item: b, anchor: a, ratio: round(bInA) };
  return null;
}

function centeredRelation(a, b, frame) {
  if (!a.bbox || !b.bbox) return null;
  const byArea = area(a.bbox) < area(b.bbox) ? { item: a, anchor: b } : { item: b, anchor: a };
  const delta = normalizedDelta(byArea.item, byArea.anchor, frame);
  if (Math.abs(delta.x) <= 0.045 && Math.abs(delta.y) <= 0.09) return { ...byArea, axis: 'xy' };
  if (Math.abs(delta.x) <= 0.035) return { ...byArea, axis: 'x' };
  return null;
}

function touching(a, b, frame) {
  if (!a.bbox || !b.bbox) return false;
  const gap = bboxGap(a.bbox, b.bbox);
  const closeX = gap.x / Math.max(1, frame.width) <= 0.015 && overlapRatio1d(a.bbox[1], a.bbox[1] + a.bbox[3], b.bbox[1], b.bbox[1] + b.bbox[3]) >= 0.18;
  const closeY = gap.y / Math.max(1, frame.height) <= 0.015 && overlapRatio1d(a.bbox[0], a.bbox[0] + a.bbox[2], b.bbox[0], b.bbox[0] + b.bbox[2]) >= 0.18;
  return closeX || closeY;
}

function verticallyStacked(a, b, frame) {
  if (!a.bbox || !b.bbox) return false;
  const delta = normalizedDelta(a, b, frame);
  const aBottom = a.bbox[1] + a.bbox[3];
  const bBottom = b.bbox[1] + b.bbox[3];
  const separated = aBottom <= b.bbox[1] || bBottom <= a.bbox[1];
  const overlapX = overlapRatio1d(a.bbox[0], a.bbox[0] + a.bbox[2], b.bbox[0], b.bbox[0] + b.bbox[2]);
  return separated
    && overlapX >= 0.35
    && Math.abs(delta.y) >= 0.018
    && Math.abs(delta.x) <= 0.08;
}

function touchingAxis(a, b) {
  const gap = bboxGap(a.bbox, b.bbox);
  return gap.x <= gap.y ? 'x' : 'y';
}

function mirroredPair(a, b, imageObservation, frame) {
  if (!a.bbox || !b.bbox) return false;
  const axisX = imageObservation.camera_hints?.symmetry_axis?.a?.[0] ?? frame.width / 2;
  const mirroredCenterError = Math.abs((a.point[0] + b.point[0]) / 2 - axisX) / Math.max(1, frame.width);
  const rowError = Math.abs(a.point[1] - b.point[1]) / Math.max(1, frame.height);
  const widthRatio = Math.min(a.bbox[2], b.bbox[2]) / Math.max(1, Math.max(a.bbox[2], b.bbox[2]));
  const heightRatio = Math.min(a.bbox[3], b.bbox[3]) / Math.max(1, Math.max(a.bbox[3], b.bbox[3]));
  const namePair = leftRightPair(a.item, b.item);
  return namePair && mirroredCenterError <= 0.09 && rowError <= 0.09 && widthRatio >= 0.72 && heightRatio >= 0.72;
}

function leftRightPair(a, b) {
  const normalizedA = a.replace(/left|right/gi, '').replace(/west|east/gi, '');
  const normalizedB = b.replace(/left|right/gi, '').replace(/west|east/gi, '');
  const hasLeftRight = (/left/i.test(a) && /right/i.test(b)) || (/right/i.test(a) && /left/i.test(b));
  const hasWestEast = (/west/i.test(a) && /east/i.test(b)) || (/east/i.test(a) && /west/i.test(b));
  return (hasLeftRight || hasWestEast) && normalizedA === normalizedB;
}

function relationConfidence(type, a, b, basis) {
  let confidence = ((a.confidence || 0.4) + (b.confidence || 0.4)) / 2;
  if (DIRECTION_TYPES.has(type)) confidence += 0.05;
  if (SYMMETRIC_TYPES.has(type)) confidence += 0.02;
  if (type === 'inside' && basis.containment_ratio) confidence += 0.08 * basis.containment_ratio;
  if (type === 'mirrored_pair') confidence += 0.07;
  return round(clamp(confidence, 0.2, 0.9));
}

function basisKind(a, b) {
  if (a.bbox && b.bbox) return 'bbox';
  if (!a.bbox && !b.bbox) return 'keypoint';
  return 'mixed_bbox_keypoint';
}

function templateLike(entity) {
  return /template|layout|prior/i.test(entity.note || '');
}

function centerForObservation(observation) {
  if (observation.points?.length) return observation.points[0];
  return centerForBbox(observation.bbox);
}

function centerForBbox(bbox) {
  if (!bbox) return null;
  return [round(bbox[0] + bbox[2] / 2), round(bbox[1] + bbox[3] / 2)];
}

function bboxFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const xs = points.map((point) => point[0]).filter(Number.isFinite);
  const ys = points.map((point) => point[1]).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return [round(minX), round(minY), round(Math.max(1, maxX - minX)), round(Math.max(1, maxY - minY))];
}

function containmentRatio(inner, outer) {
  const ix1 = Math.max(inner[0], outer[0]);
  const iy1 = Math.max(inner[1], outer[1]);
  const ix2 = Math.min(inner[0] + inner[2], outer[0] + outer[2]);
  const iy2 = Math.min(inner[1] + inner[3], outer[1] + outer[3]);
  const overlap = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  return overlap / Math.max(1, area(inner));
}

function bboxGap(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  return {
    x: Math.max(0, Math.max(b[0] - ax2, a[0] - bx2)),
    y: Math.max(0, Math.max(b[1] - ay2, a[1] - by2))
  };
}

function overlapRatio1d(a1, a2, b1, b2) {
  const overlap = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  return overlap / Math.max(1, Math.min(a2 - a1, b2 - b1));
}

function area(bbox) {
  return Math.max(0, bbox?.[2] || 0) * Math.max(0, bbox?.[3] || 0);
}

function dedupeRelations(relations) {
  const byKey = new Map();
  for (const relation of relations) {
    if (!relation?.type || !relation.item || !relation.anchor) continue;
    const symmetric = SYMMETRIC_TYPES.has(relation.type);
    const pair = symmetric
      ? [relation.item, relation.anchor].sort().join('|')
      : `${relation.item}|${relation.anchor}`;
    const key = `${relation.source_image || ''}|${relation.view || ''}|${relation.type}|${pair}|${relation.basis?.kind || ''}`;
    const existing = byKey.get(key);
    if (!existing || (relation.confidence || 0) > (existing.confidence || 0)) byKey.set(key, relation);
  }
  return [...byKey.values()];
}

function dedupePartRelationships(relationships) {
  const seen = new Set();
  const result = [];
  for (const relationship of relationships) {
    const key = `${relationship.type}|${relationship.target}|${relationship.source || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(relationship);
  }
  return result;
}

function dedupePhysicalRelations(relations) {
  const byKey = new Map();
  for (const relation of relations) {
    const key = relation.id || `${relation.subject}|${relation.type}|${relation.target || ''}`;
    byKey.set(key, relation);
  }
  return [...byKey.values()];
}

function countBy(items, key) {
  const result = {};
  for (const item of items || []) {
    const value = item[key] || 'unknown';
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function unique(items) {
  return [...new Set(items)];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}
