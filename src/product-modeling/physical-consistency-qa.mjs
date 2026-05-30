const FACE_AXIS = {
  left: 'x',
  right: 'x',
  front: 'y',
  back: 'y',
  bottom: 'z',
  top: 'z'
};
const FACE_SIDE = {
  left: 'min',
  front: 'min',
  bottom: 'min',
  right: 'max',
  back: 'max',
  top: 'max'
};
const AXES = ['x', 'y', 'z'];
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const CONTACT_RELATION_TYPES = new Set(['contact', 'contacts', 'attached_to', 'mounted_on', 'supported_by', 'rests_on']);

export function validatePartGraphPhysicalConsistency(partGraph = {}, options = {}) {
  const parts = partGraph.parts || [];
  const boxes = buildPartBoxIndex(parts);
  const relations = collectPhysicalRelations(partGraph);
  const issues = [];

  for (const relation of relations) {
    if (CONTACT_RELATION_TYPES.has(relation.type)) {
      validateContactRelation(issues, relation, boxes, options);
    } else if (relation.type === 'must_not_intersect') {
      validateNonIntersectionRelation(issues, relation, boxes, options);
    } else if (relation.type === 'grounded') {
      validateGroundedRelation(issues, relation, boxes, options);
    } else {
      addIssue(issues, {
        type: 'physical.unsupported_relation_type',
        severity: 'warn',
        relation,
        item: relation.subject,
        message: `Unsupported physical relation type: ${relation.type}.`
      });
    }
  }

  const summary = summarizeIssues(issues, boxes, relations);
  return {
    kind: 'physical_consistency_qa',
    ok: summary.by_severity.error === 0,
    level: reportLevel(summary.by_severity),
    verdict: summary.by_severity.error > 0 ? 'fail' : summary.by_severity.warn > 0 ? 'review' : 'pass',
    summary,
    issues,
    correction_suggestions: correctionSuggestionsForIssues(issues)
  };
}

export function formatPhysicalConsistencyQaReportMarkdown(report = {}, options = {}) {
  const lines = [];
  lines.push(`# ${options.title || 'Physical Consistency QA Report'}`);
  lines.push('');
  lines.push(`- Verdict: **${report.verdict || 'unknown'}**`);
  lines.push(`- Level: **${report.level || 'unknown'}**`);
  lines.push(`- OK: **${report.ok === true ? 'true' : 'false'}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---:|');
  lines.push(`| Checked parts | ${report.summary?.checked_parts || 0} |`);
  lines.push(`| Checked relations | ${report.summary?.checked_relations || 0} |`);
  lines.push(`| Total issues | ${report.summary?.total || 0} |`);
  lines.push(`| Errors | ${report.summary?.by_severity?.error || 0} |`);
  lines.push(`| Warnings | ${report.summary?.by_severity?.warn || 0} |`);
  lines.push(`| Info | ${report.summary?.by_severity?.info || 0} |`);
  lines.push('');
  lines.push('## Issues');
  lines.push('');
  if (!report.issues?.length) {
    lines.push('No physical consistency issues.');
    lines.push('');
  } else {
    lines.push('| Severity | Type | Relation | Item | Message | Target |');
    lines.push('|---|---|---|---|---|---|');
    for (const issue of report.issues.slice(0, options.issueLimit || 50)) {
      lines.push(`| ${escapeMarkdown(issue.severity)} | \`${escapeMarkdown(issue.type)}\` | ${escapeMarkdown(issue.relation?.id || '')} | ${escapeMarkdown(issue.item || '')} | ${escapeMarkdown(issue.message || '')} | \`${escapeMarkdown(issue.correction?.target || '')}\` |`);
    }
    lines.push('');
  }
  lines.push('## Correction Suggestions');
  lines.push('');
  if (!report.correction_suggestions?.length) {
    lines.push('- No correction suggestions.');
  } else {
    for (const suggestion of report.correction_suggestions.slice(0, options.suggestionLimit || 25)) {
      lines.push(`- \`${escapeMarkdown(suggestion.action)}\` ${escapeMarkdown(suggestion.target || '')}: ${escapeMarkdown(suggestion.reason || '')}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function partBoundingBox(part) {
  const parameters = part?.shape?.parameters || {};
  const primitive = part?.shape?.primitive;
  if ((primitive === 'box' || primitive === 'rounded_box') && isVector3(parameters.origin) && isVector3(parameters.size)) {
    return boxFromMinSize(parameters.origin, parameters.size);
  }
  if (primitive === 'mesh' && Array.isArray(parameters.vertices)) {
    return boxFromPoints(parameters.vertices);
  }
  if (primitive === 'prism' && isVector3(parameters.origin) && Array.isArray(parameters.points)) {
    return prismBox(parameters.origin, parameters.plane || 'xy', parameters.points, Number(parameters.depth || 0));
  }
  if (primitive === 'cylinder' && isVector3(parameters.origin) && Number.isFinite(Number(parameters.radius)) && Number.isFinite(Number(parameters.height))) {
    const [x, y, z] = parameters.origin.map(Number);
    const radius = Number(parameters.radius);
    const height = Number(parameters.height);
    return normalizeBox({
      min: [x - radius, y - radius, z],
      max: [x + radius, y + radius, z + height]
    });
  }
  return null;
}

function validateContactRelation(issues, relation, boxes, options) {
  const resolved = resolveRelationBoxes(issues, relation, boxes);
  if (!resolved) return;
  const { subject, target } = resolved;
  const tolerance = numberOption(relation.tolerance_mm ?? relation.toleranceMm, options.toleranceMm ?? 1);
  const subjectFace = relation.subject_face || relation.subjectFace;
  const targetFace = relation.target_face || relation.targetFace;
  if (subjectFace && targetFace) {
    const subjectAxis = FACE_AXIS[subjectFace];
    const targetAxis = FACE_AXIS[targetFace];
    if (!subjectAxis || !targetAxis || subjectAxis !== targetAxis) {
      addIssue(issues, {
        type: 'physical.invalid_face_pair',
        severity: relation.severity || 'error',
        relation,
        item: relation.subject,
        message: `Relation ${relation.id || relation.type} has incompatible faces ${subjectFace}/${targetFace}.`
      });
      return;
    }
    const distance = Math.abs(faceValue(subject.box, subjectFace) - faceValue(target.box, targetFace));
    if (distance > tolerance) {
      addIssue(issues, {
        type: 'physical.face_contact_gap',
        severity: relation.severity || 'error',
        relation,
        item: relation.subject,
        message: `${subject.id} ${subjectFace} should contact ${target.id} ${targetFace}, but the face gap is ${round(distance)} mm.`,
        evidence: {
          subject: subject.id,
          target: target.id,
          subject_face: subjectFace,
          target_face: targetFace,
          distance_mm: round(distance),
          tolerance_mm: tolerance
        },
        correction: correctionForFaceGap(relation, subject.part, subject.box, target.box, subjectFace, targetFace)
      });
    }
    validateProjectionOverlap(issues, relation, subject, target, relation.overlap_axes || relation.overlapAxes || AXES.filter((axis) => axis !== subjectAxis));
    return;
  }

  const distance = boxDistance(subject.box, target.box);
  if (distance > tolerance) {
    addIssue(issues, {
      type: 'physical.contact_gap',
      severity: relation.severity || 'error',
      relation,
      item: relation.subject,
      message: `${subject.id} should contact ${target.id}, but the bbox gap is ${round(distance)} mm.`,
      evidence: {
        subject: subject.id,
        target: target.id,
        distance_mm: round(distance),
        tolerance_mm: tolerance
      },
      correction: correctionForBoxGap(relation, subject.part, subject.box, target.box)
    });
  }
}

function validateProjectionOverlap(issues, relation, subject, target, axes) {
  const minOverlapRatio = numberOption(relation.min_overlap_ratio ?? relation.minOverlapRatio, 0.02);
  for (const axis of normalizeAxes(axes)) {
    const overlap = axisOverlap(subject.box, target.box, axis);
    const subjectExtent = axisExtent(subject.box, axis);
    const ratio = subjectExtent > 0 ? overlap / subjectExtent : 0;
    if (overlap <= 0 || ratio < minOverlapRatio) {
      addIssue(issues, {
        type: 'physical.contact_projection_miss',
        severity: relation.severity || 'error',
        relation,
        item: relation.subject,
        message: `${subject.id} and ${target.id} do not overlap enough on ${axis.toUpperCase()} for relation ${relation.id || relation.type}.`,
        evidence: {
          subject: subject.id,
          target: target.id,
          axis,
          overlap_mm: round(Math.max(0, overlap)),
          subject_extent_mm: round(subjectExtent),
          overlap_ratio: round(Math.max(0, ratio)),
          min_overlap_ratio: minOverlapRatio
        },
        correction: correctionForBoxGap(relation, subject.part, subject.box, target.box)
      });
    }
  }
}

function validateNonIntersectionRelation(issues, relation, boxes, options) {
  const resolved = resolveRelationBoxes(issues, relation, boxes);
  if (!resolved) return;
  const { subject, target } = resolved;
  const allowed = numberOption(relation.allowed_penetration_mm ?? relation.allowedPenetrationMm, options.allowedPenetrationMm ?? 0);
  const overlap = boxOverlap(subject.box, target.box);
  if (overlap.every((value) => value > allowed)) {
    addIssue(issues, {
      type: 'physical.unexpected_intersection',
      severity: relation.severity || 'error',
      relation,
      item: relation.subject,
      message: `${subject.id} intersects ${target.id} by ${overlap.map((value) => round(value)).join(' x ')} mm.`,
      evidence: {
        subject: subject.id,
        target: target.id,
        overlap_mm: overlap.map((value) => round(value)),
        allowed_penetration_mm: allowed
      },
      correction: correctionForBoxGap(relation, subject.part, subject.box, target.box)
    });
  }
}

function validateGroundedRelation(issues, relation, boxes, options) {
  const subject = boxes.get(relation.subject);
  if (!subject) {
    addMissingRefIssue(issues, relation, relation.subject, 'subject');
    return;
  }
  const groundZ = numberOption(relation.ground_z ?? relation.groundZ, options.groundZ ?? 0);
  const tolerance = numberOption(relation.tolerance_mm ?? relation.toleranceMm, options.toleranceMm ?? 1);
  const distance = Math.abs(subject.box.min[2] - groundZ);
  if (distance > tolerance) {
    addIssue(issues, {
      type: 'physical.grounded_gap',
      severity: relation.severity || 'error',
      relation,
      item: relation.subject,
      message: `${subject.id} bottom should sit at Z=${round(groundZ)}, but bottom is Z=${round(subject.box.min[2])}.`,
      evidence: {
        subject: subject.id,
        bottom_z: round(subject.box.min[2]),
        ground_z: round(groundZ),
        distance_mm: round(distance),
        tolerance_mm: tolerance
      },
      correction: correctionForAxisShift(relation, subject.part, 2, groundZ - subject.box.min[2])
    });
  }
}

function buildPartBoxIndex(parts) {
  const boxes = new Map();
  for (const part of parts) {
    const box = partBoundingBox(part);
    if (box) boxes.set(part.id, { id: part.id, part, box });
  }
  return boxes;
}

function collectPhysicalRelations(partGraph) {
  const relations = [...(partGraph.physical_relations || [])];
  for (const part of partGraph.parts || []) {
    for (const relation of part.physical_relations || []) {
      relations.push({
        ...relation,
        subject: relation.subject || part.id
      });
    }
  }
  return relations.filter((relation) => relation?.type && relation?.subject);
}

function resolveRelationBoxes(issues, relation, boxes) {
  const subject = boxes.get(relation.subject);
  const target = boxes.get(relation.target);
  if (!subject) addMissingRefIssue(issues, relation, relation.subject, 'subject');
  if (!target) addMissingRefIssue(issues, relation, relation.target, 'target');
  if (!subject || !target) return null;
  return { subject, target };
}

function addMissingRefIssue(issues, relation, ref, role) {
  addIssue(issues, {
    type: 'physical.missing_part_ref',
    severity: relation.severity || 'error',
    relation,
    item: ref,
    message: `Physical relation ${relation.id || relation.type} references missing ${role} part: ${ref}.`
  });
}

function correctionForFaceGap(relation, part, subjectBox, targetBox, subjectFace, targetFace) {
  const axis = FACE_AXIS[subjectFace];
  const axisIndex = AXIS_INDEX[axis];
  return correctionForAxisShift(
    relation,
    part,
    axisIndex,
    faceValue(targetBox, targetFace) - faceValue(subjectBox, subjectFace)
  );
}

function correctionForBoxGap(relation, part, subjectBox, targetBox) {
  const deltas = AXES.map((axis) => axisGapDelta(subjectBox, targetBox, axis));
  const best = deltas
    .map((delta, index) => ({ delta, index, distance: Math.abs(delta) }))
    .filter((item) => item.distance > 0)
    .sort((left, right) => left.distance - right.distance)[0];
  if (!best) return null;
  return correctionForAxisShift(relation, part, best.index, best.delta);
}

function correctionForAxisShift(relation, part, axisIndex, delta) {
  const origin = part?.shape?.parameters?.origin;
  if (!isVector3(origin) || !Number.isFinite(delta)) return null;
  const next = origin.map(Number);
  next[axisIndex] = round(next[axisIndex] + delta);
  return {
    action: 'update_part_graph',
    target: `parts[${part.id}].shape.parameters.origin`,
    part_id: part.id,
    reason: `Physical relation ${relation.id || relation.type} needs ${part.id} origin adjustment.`,
    evidence: {
      relation_id: relation.id || null,
      relation_type: relation.type,
      axis: AXES[axisIndex],
      delta_mm: round(delta),
      proposed_value: next
    }
  };
}

function faceValue(box, face) {
  const axis = FACE_AXIS[face];
  const side = FACE_SIDE[face];
  return box[side][AXIS_INDEX[axis]];
}

function axisGapDelta(subjectBox, targetBox, axis) {
  const index = AXIS_INDEX[axis];
  if (subjectBox.max[index] < targetBox.min[index]) return targetBox.min[index] - subjectBox.max[index];
  if (subjectBox.min[index] > targetBox.max[index]) return targetBox.max[index] - subjectBox.min[index];
  return 0;
}

function boxDistance(left, right) {
  const squared = AXES.reduce((sum, axis) => {
    const delta = axisGapDelta(left, right, axis);
    return sum + delta * delta;
  }, 0);
  return Math.sqrt(squared);
}

function boxOverlap(left, right) {
  return AXES.map((axis) => Math.max(0, axisOverlap(left, right, axis)));
}

function axisOverlap(left, right, axis) {
  const index = AXIS_INDEX[axis];
  return Math.min(left.max[index], right.max[index]) - Math.max(left.min[index], right.min[index]);
}

function axisExtent(box, axis) {
  const index = AXIS_INDEX[axis];
  return box.max[index] - box.min[index];
}

function boxFromMinSize(origin, size) {
  const min = origin.map(Number);
  const max = min.map((value, index) => value + Number(size[index]));
  return normalizeBox({ min, max });
}

function prismBox(origin, plane, points, depth) {
  const vertices = prismVertices(origin.map(Number), plane, points.map((point) => point.map(Number)), Number(depth));
  return boxFromPoints(vertices);
}

function prismVertices(origin, plane, points, depth) {
  const [x, y, z] = origin;
  const base = points.map(([u, v]) => {
    if (plane === 'xy') return [x + u, y + v, z];
    if (plane === 'xz') return [x + u, y, z + v];
    return [x, y + u, z + v];
  });
  const offset = plane === 'xy' ? [0, 0, depth] : plane === 'xz' ? [0, depth, 0] : [depth, 0, 0];
  return [...base, ...base.map((point) => point.map((value, index) => value + offset[index]))];
}

function boxFromPoints(points) {
  const valid = points.filter(isVector3).map((point) => point.map(Number));
  if (!valid.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of valid) {
    for (let index = 0; index < 3; index += 1) {
      min[index] = Math.min(min[index], point[index]);
      max[index] = Math.max(max[index], point[index]);
    }
  }
  return normalizeBox({ min, max });
}

function normalizeBox(box) {
  const min = box.min.map((value, index) => Math.min(Number(value), Number(box.max[index])));
  const max = box.max.map((value, index) => Math.max(Number(value), Number(box.min[index])));
  return {
    min,
    max,
    w: round(max[0] - min[0]),
    d: round(max[1] - min[1]),
    h: round(max[2] - min[2])
  };
}

function normalizeAxes(axes) {
  return axes.filter((axis) => AXES.includes(axis));
}

function summarizeIssues(issues, boxes, relations) {
  return {
    checked_parts: boxes.size,
    checked_relations: relations.length,
    total: issues.length,
    by_severity: {
      error: issues.filter((issue) => issue.severity === 'error').length,
      warn: issues.filter((issue) => issue.severity === 'warn').length,
      info: issues.filter((issue) => issue.severity === 'info').length
    },
    by_type: issues.reduce((counts, issue) => {
      counts[issue.type] = (counts[issue.type] || 0) + 1;
      return counts;
    }, {})
  };
}

function correctionSuggestionsForIssues(issues) {
  return issues
    .map((issue) => issue.correction)
    .filter(Boolean)
    .map((correction) => ({ ...correction }));
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.severity || 'error',
    ...issue
  });
}

function reportLevel(bySeverity = {}) {
  if ((bySeverity.error || 0) > 0) return 'error';
  if ((bySeverity.warn || 0) > 0) return 'warn';
  return 'ok';
}

function isVector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)));
}

function numberOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function escapeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}
