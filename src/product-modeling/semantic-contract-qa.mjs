import { artifactContentSignature } from '../image-structured-provenance.mjs';
import { partBoundingBox } from './physical-consistency-qa.mjs';

const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const PROJECTED_VISIBILITY_GRID_STEPS = 8;

export function validatePartGraphSemanticContract(partGraph = {}, options = {}) {
  const contract = partGraph.semantic_contract;
  if (!contract) return emptyReport(options.phase || 'precompile');
  const phase = options.phase || (options.snapshot ? 'postreopen' : options.dsl ? 'postcompile' : 'precompile');
  const entities = options.snapshot
    ? entitiesFromSnapshot(options.snapshot)
    : options.dsl
      ? entitiesFromDsl(options.dsl)
      : entitiesFromPartGraph(partGraph);
  const regions = regionIndex(contract.regions || []);
  const issues = [];

  validateNamedIdentity(issues, entities, contract);
  for (const assertion of contract.assertions || []) {
    validateAssertion(issues, assertion, entities, regions, partGraph);
  }
  validateNegativeEvidence(issues, contract.negative_evidence || [], entities, regions);
  validateMeshContracts(issues, contract, entities);
  if (options.viewEvidence) validateViewEvidence(issues, contract.view_assertions || [], options.viewEvidence);

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warn');
  return {
    version: 1,
    kind: 'part_graph_semantic_contract_qa',
    phase,
    ok: errors.length === 0,
    verdict: errors.length ? 'fail' : warnings.length ? 'review' : 'pass',
    semantic_contract_id: contract.id || null,
    semantic_digest: semanticDigestForEntities(entities, contract),
    summary: {
      assertions: (contract.assertions || []).length,
      negative_evidence: (contract.negative_evidence || []).length,
      entities: entities.length,
      runtime_mesh_remeasured: entities.filter((entity) => entity.parameters?.runtime_mesh_semantic?.geometry_remeasured === true).length,
      native_mesh_remeasured: entities.filter((entity) => entity.parameters?.runtime_mesh_semantic?.native_geometry_remeasured === true).length,
      errors: errors.length,
      warnings: warnings.length
    },
    issues
  };
}

export function assertPartGraphSemanticContract(partGraph, options = {}) {
  const report = validatePartGraphSemanticContract(partGraph, options);
  if (!report.ok) {
    throw new Error(`PartGraph semantic contract blocked during ${report.phase}: ${report.issues.map((issue) => `${issue.id}:${issue.message}`).join('; ')}`);
  }
  return report;
}

export function compareSemanticSnapshots({ partGraph, beforeSnapshot, afterSnapshot, beforeViewEvidence, afterViewEvidence } = {}) {
  const before = validatePartGraphSemanticContract(partGraph, {
    snapshot: beforeSnapshot,
    viewEvidence: beforeViewEvidence,
    phase: 'presave'
  });
  const after = validatePartGraphSemanticContract(partGraph, {
    snapshot: afterSnapshot,
    viewEvidence: afterViewEvidence,
    phase: 'postreopen'
  });
  const digestMatches = before.semantic_digest === after.semantic_digest;
  const issues = [
    ...before.issues.map((issue) => ({ ...issue, checkpoint: 'presave' })),
    ...after.issues.map((issue) => ({ ...issue, checkpoint: 'postreopen' }))
  ];
  if (!digestMatches) {
    issues.push({
      id: 'save_reopen_semantic_digest_mismatch',
      type: 'save_reopen_semantic_digest',
      severity: 'error',
      message: 'Named part identity, role, tag, material, or AABB changed after save and reopen.',
      evidence: { before: before.semantic_digest, after: after.semantic_digest }
    });
  }
  return {
    version: 1,
    kind: 'save_reopen_semantic_contract_qa',
    ok: before.ok && after.ok && digestMatches,
    verdict: before.ok && after.ok && digestMatches ? 'pass' : 'fail',
    digest_matches: digestMatches,
    before,
    after,
    issues
  };
}

export function deriveSemanticViewEvidenceFromSnapshot({ partGraph, snapshot, captures = [] } = {}) {
  const entities = entitiesFromSnapshot(snapshot || {});
  const capturedViews = new Map(captures.filter((capture) => capture?.ok !== false && capture?.view).map((capture) => [capture.view, capture]));
  const requiredViews = new Set((partGraph?.semantic_contract?.view_assertions || []).flatMap((assertion) => assertion.views || []));
  const views = [];
  for (const view of requiredViews) {
    const capture = capturedViews.get(view);
    if (!capture) continue;
    const eye = vector3(capture.eye) ? capture.eye.map(Number) : defaultEyeForView(view);
    const target = vector3(capture.target) ? capture.target.map(Number) : [0, 0, 2500];
    const up = vector3(capture.up) ? capture.up.map(Number) : [0, 0, 1];
    const projected = entities.filter((entity) => entity.box).map((entity) => ({
      entity,
      ...projectBox(entity.box, { eye, target, up })
    }));
    const visibleEntities = projected.filter((entry) => projectedEntryVisible(entry, projected));
    const roleDistance = new Map();
    for (const entry of projected) {
      if (!entry.entity.role) continue;
      roleDistance.set(entry.entity.role, Math.min(roleDistance.get(entry.entity.role) ?? Infinity, entry.depth));
    }
    const layerOrder = [];
    for (const assertion of partGraph.semantic_contract.view_assertions || []) {
      if (!(assertion.views || []).includes(view)) continue;
      for (const expected of assertion.layer_order || []) {
        const near = roleDistance.get(expected.near_role);
        const far = roleDistance.get(expected.far_role);
        if (Number.isFinite(near) && Number.isFinite(far) && near < far) layerOrder.push(structuredClone(expected));
      }
    }
    views.push({
      view,
      capture_path: capture.path || capture.file_path || null,
      evidence_kind: 'server_capture_bound_aabb_occlusion_projection',
      visible_roles: [...new Set(visibleEntities.map((entry) => entry.entity.role).filter(Boolean))].sort(),
      layer_order: layerOrder
    });
  }
  return { views };
}

function validateAssertion(issues, assertion, entities, regions, partGraph) {
  const severity = assertion.severity || 'error';
  if (assertion.type === 'required_role_count') {
    const count = byRoles(entities, rolesFor(assertion)).length;
    const minimum = number(assertion.min_count, 1);
    const maximum = assertion.max_count === undefined ? Infinity : number(assertion.max_count, Infinity);
    if (count < minimum || count > maximum) addIssue(issues, assertion, severity, `Role count ${count} is outside ${minimum}..${maximum}.`, { count, minimum, maximum });
    return;
  }
  if (assertion.type === 'role_absent') {
    const matches = filterByRegion(byRoles(entities, rolesFor(assertion)), regions.get(assertion.region_id));
    if (matches.length) addIssue(issues, assertion, severity, `Forbidden role is present: ${matches.map((entity) => entity.id).join(', ')}.`, { entity_ids: matches.map((entity) => entity.id), region_id: assertion.region_id || null });
    return;
  }
  if (assertion.type === 'distinct_role_layers') {
    const left = byRoles(entities, [assertion.subject_role]);
    const right = byRoles(entities, [assertion.target_role]);
    const axis = assertion.axis || 'y';
    const minSeparation = number(assertion.min_separation_mm, 1);
    const separation = minimumAxisSeparation(left, right, axis);
    if (!Number.isFinite(separation) || separation < minSeparation) {
      addIssue(issues, assertion, severity, `${assertion.subject_role} and ${assertion.target_role} are not distinct ${axis.toUpperCase()} layers.`, { axis, separation_mm: separation, min_separation_mm: minSeparation });
    }
    return;
  }
  if (assertion.type === 'role_in_region') {
    const matches = byRoles(entities, rolesFor(assertion));
    const allowed = regions.get(assertion.region_id);
    if (!allowed) {
      addIssue(issues, assertion, severity, `Semantic region ${assertion.region_id} does not exist.`, {});
      return;
    }
    const outside = matches.filter((entity) => !boxInside(entity.box, allowed.box, number(assertion.tolerance_mm, 0)));
    if (matches.length === 0 || outside.length) addIssue(issues, assertion, severity, `Role must exist only inside ${assertion.region_id}.`, { matched: matches.map((entity) => entity.id), outside: outside.map((entity) => entity.id) });
    return;
  }
  if (assertion.type === 'role_forbidden_in_regions') {
    const matches = byRoles(entities, rolesFor(assertion));
    const violations = [];
    for (const regionId of assertion.region_ids || []) {
      const region = regions.get(regionId);
      if (!region) {
        violations.push({ region_id: regionId, entity_id: null, reason: 'region_missing' });
        continue;
      }
      for (const entity of filterByRegion(matches, region)) violations.push({ region_id: regionId, entity_id: entity.id });
    }
    if (violations.length) addIssue(issues, assertion, severity, 'Forbidden role intersects one or more semantic regions.', { violations });
    return;
  }
  if (assertion.type === 'aabb_relation') {
    validateAabbRelation(issues, assertion, severity, entities);
    return;
  }
  if (assertion.type === 'required_relation') {
    const relations = collectRelations(partGraph);
    const found = relations.some((relation) => relation.type === assertion.relation
      && entityHasRole(entities, relation.subject, assertion.subject_role)
      && entityHasRole(entities, relation.target, assertion.target_role));
    if (!found) addIssue(issues, assertion, severity, `Required relation ${assertion.relation} is missing between ${assertion.subject_role} and ${assertion.target_role}.`, {});
  }
}

function validateAabbRelation(issues, assertion, severity, entities) {
  const subjects = byRoles(entities, [assertion.subject_role]);
  const targets = byRoles(entities, [assertion.target_role]);
  if (!subjects.length || !targets.length) {
    addIssue(issues, assertion, severity, 'AABB relation references a missing semantic role.', { subjects: subjects.length, targets: targets.length });
    return;
  }
  const tolerance = number(assertion.tolerance_mm, 1);
  for (const subject of subjects) {
    const satisfied = targets.some((target) => relationSatisfied(assertion.relation, subject.box, target.box, assertion.axis, tolerance));
    if (!satisfied) addIssue(issues, assertion, severity, `${subject.id} does not satisfy ${assertion.relation} ${assertion.target_role}.`, { subject: subject.id, targets: targets.map((target) => target.id), tolerance_mm: tolerance });
  }
}

function relationSatisfied(relation, subject, target, axis, tolerance) {
  if (!subject || !target) return false;
  if (relation === 'below') return subject.max[2] <= target.min[2] + tolerance;
  if (relation === 'above') return subject.min[2] >= target.max[2] - tolerance;
  if (relation === 'inside') return boxInside(subject, target, tolerance);
  if (relation === 'touching') return boxDistance(subject, target) <= tolerance;
  if (relation === 'same_plane') {
    const index = AXIS_INDEX[axis || 'y'];
    return Math.abs(boxCenter(subject)[index] - boxCenter(target)[index]) <= tolerance;
  }
  if (relation === 'front_of') return boxCenter(subject)[1] < boxCenter(target)[1] - tolerance;
  if (relation === 'behind') return boxCenter(subject)[1] > boxCenter(target)[1] + tolerance;
  return false;
}

function validateNegativeEvidence(issues, negativeEvidence, entities, regions) {
  for (const evidence of negativeEvidence) {
    const region = evidence.region_id ? regions.get(evidence.region_id) : null;
    const matches = filterByRegion(byRoles(entities, [evidence.absent_role]), region);
    if (matches.length) addIssue(issues, evidence, evidence.severity || 'error', `Negative evidence forbids ${evidence.absent_role}, but matching parts exist.`, { entity_ids: matches.map((entity) => entity.id), source_observation_ids: evidence.source_observation_ids || [] });
  }
}

function validateMeshContracts(issues, contract, entities) {
  for (const assertion of (contract.assertions || []).filter((entry) => entry.type === 'mesh_integrity')) {
    const matches = byRoles(entities, rolesFor(assertion));
    for (const entity of matches) {
      if (entity.primitive !== 'mesh') {
        addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} has no persisted mesh validation evidence.`, { entity_id: entity.id });
        continue;
      }
      const vertices = entity.parameters?.vertices || [];
      const faces = entity.parameters?.faces || [];
      const hasGeometry = vertices.length > 0 && faces.length > 0;
      if (hasGeometry) {
        const mesh = meshOrientation(vertices, faces);
        if (mesh.degenerate_faces.length) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} contains degenerate mesh faces.`, { entity_id: entity.id, face_indices: mesh.degenerate_faces });
        if (assertion.require_consistent_outward_winding === true && mesh.inward_faces.length) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} has inward or inconsistent face winding.`, { entity_id: entity.id, face_indices: mesh.inward_faces });
      } else if (assertion.require_consistent_outward_winding === true && entity.parameters?.precompile_winding_validated !== true) {
        addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} has neither native mesh geometry nor a persisted compiler winding attestation.`, { entity_id: entity.id });
      }
      const runtimeMesh = entity.parameters?.runtime_mesh_semantic;
      if (runtimeMesh) {
        if (runtimeMesh.geometry_remeasured !== true || Number(runtimeMesh.face_count || 0) < 1) {
          addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} runtime mesh measurement is incomplete.`, { entity_id: entity.id, runtime_mesh_semantic: runtimeMesh });
        }
        if (Number(runtimeMesh.degenerate_face_count || 0) > 0) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} runtime mesh contains degenerate faces.`, { entity_id: entity.id, count: runtimeMesh.degenerate_face_count });
        if (assertion.require_consistent_outward_winding === true && Number(runtimeMesh.inward_face_count || 0) > 0) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} runtime mesh has inward faces.`, { entity_id: entity.id, count: runtimeMesh.inward_face_count });
        if (assertion.require_back_material === true && Number(runtimeMesh.missing_back_material_face_count || 0) > 0) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} runtime mesh has faces without back material.`, { entity_id: entity.id, count: runtimeMesh.missing_back_material_face_count });
        if (assertion.back_material_must_match_front === true && Number(runtimeMesh.front_back_material_mismatch_count || 0) > 0) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} runtime mesh front/back materials differ.`, { entity_id: entity.id, count: runtimeMesh.front_back_material_mismatch_count });
      }
      if (assertion.require_back_material === true && !entity.parameters?.back_material) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} has no explicit back material.`, { entity_id: entity.id });
      if (assertion.back_material_must_match_front === true && entity.parameters?.back_material !== (entity.parameters?.material || entity.material)) addIssue(issues, assertion, assertion.severity || 'error', `${entity.id} back material does not match the front material.`, { entity_id: entity.id, front_material: entity.parameters?.material || entity.material || null, back_material: entity.parameters?.back_material || null });
    }
  }
}

function validateViewEvidence(issues, assertions, viewEvidence) {
  const byView = new Map((viewEvidence.views || []).map((view) => [view.view, view]));
  for (const assertion of assertions) {
    for (const viewName of assertion.views || []) {
      const view = byView.get(viewName);
      if (!view) {
        addIssue(issues, assertion, assertion.severity || 'error', `Required semantic view evidence is missing: ${viewName}.`, { view: viewName });
        continue;
      }
      const visible = new Set(view.visible_roles || []);
      for (const role of assertion.required_visible_roles || []) {
        if (!visible.has(role)) addIssue(issues, assertion, assertion.severity || 'error', `${role} is not visible in ${viewName}.`, { view: viewName, role });
      }
      for (const expected of assertion.layer_order || []) {
        const found = (view.layer_order || []).some((actual) => actual.near_role === expected.near_role && actual.far_role === expected.far_role);
        if (!found) addIssue(issues, assertion, assertion.severity || 'error', `Layer order ${expected.near_role} before ${expected.far_role} is missing in ${viewName}.`, { view: viewName, expected });
      }
    }
  }
}

function validateNamedIdentity(issues, entities, contract) {
  const relevantRoles = new Set((contract.assertions || []).flatMap(rolesFor).filter(Boolean));
  for (const entity of entities.filter((item) => relevantRoles.has(item.role))) {
    const tagRequired = contract.named_identity?.require_tag === true;
    if (!entity.id || !entity.name || !entity.role || !entity.box || (tagRequired && !entity.tag)) {
      issues.push({
        id: `named_identity_${entity.id || 'missing'}`,
        type: 'named_part_identity',
        severity: 'error',
        message: `Semantic parts require a stable id, name, role, AABB${tagRequired ? ', and tag' : ''}.`,
        evidence: { id: entity.id || null, name: entity.name || null, role: entity.role || null, box: entity.box || null }
      });
    }
  }
}

function entitiesFromPartGraph(partGraph) {
  return (partGraph.parts || []).map((part) => ({
    id: part.id,
    name: part.name,
    role: part.role,
    tag: part.tag || part.qa?.tag || null,
    material: part.material || part.shape?.parameters?.material || null,
    primitive: part.shape?.primitive || null,
    parameters: structuredClone(part.shape?.parameters || {}),
    box: partBoundingBox(part)
  }));
}

function entitiesFromDsl(dsl) {
  const tags = new Map();
  for (const operation of dsl.operations || []) {
    if (operation.op === 'assign_tag' && operation.target_id) tags.set(operation.target_id, operation.tag || null);
  }
  return (dsl.operations || []).filter((operation) => operation.id && operation.qa?.part_id).map((operation) => ({
    id: operation.qa.part_id || operation.id,
    name: operation.name || operation.id,
    role: operation.qa.role,
    tag: operation.tag || tags.get(operation.id) || null,
    material: operation.material || null,
    primitive: operation.op,
    parameters: structuredClone(operation),
    box: operationBox(operation)
  }));
}

function entitiesFromSnapshot(snapshot) {
  const raw = snapshot.items || snapshot.entities || snapshot.objects || snapshot.groups || [];
  return raw.map((item) => ({
    id: item.qa?.part_id || item.part_id || item.id || item.name,
    name: item.name || item.id,
    role: item.qa?.role || item.role || item.kind,
    tag: item.tag || item.layer || null,
    material: item.material || item.front_material || null,
    primitive: item.mesh_semantic || item.qa?.mesh_semantic ? 'mesh' : item.op || item.kind || null,
    parameters: {
      ...structuredClone(item.parameters || {}),
      ...(item.qa?.mesh_semantic ? {
        material: item.qa.mesh_semantic.front_material,
        back_material: item.qa.mesh_semantic.back_material,
        precompile_winding_validated: item.qa.mesh_semantic.precompile_winding_validated
      } : {}),
      ...(item.mesh_semantic ? { runtime_mesh_semantic: structuredClone(item.mesh_semantic) } : {})
    },
    box: normalizeBox(item.bounding_box || item.bounds || item.box)
  }));
}

function operationBox(operation) {
  if (['box', 'rounded_box'].includes(operation.op) && vector3(operation.origin) && vector3(operation.size)) return minSizeBox(operation.origin, operation.size);
  if (operation.op === 'mesh' && Array.isArray(operation.vertices)) return pointsBox(operation.vertices);
  if (operation.op === 'cylinder' && vector3(operation.origin)) {
    const [x, y, z] = operation.origin.map(Number);
    const radius = number(operation.radius, 0);
    return { min: [x - radius, y - radius, z], max: [x + radius, y + radius, z + number(operation.height, 0)] };
  }
  return null;
}

function meshOrientation(vertices, faces) {
  const center = centroid(vertices);
  const degenerateFaces = [];
  const inwardFaces = [];
  faces.forEach((face, index) => {
    if (!Array.isArray(face) || face.length < 3 || face.some((vertexIndex) => !vertices[vertexIndex])) {
      degenerateFaces.push(index);
      return;
    }
    const a = vertices[face[0]].map(Number);
    const b = vertices[face[1]].map(Number);
    const c = vertices[face[2]].map(Number);
    const normal = cross(subtract(b, a), subtract(c, a));
    const magnitude = Math.hypot(...normal);
    if (magnitude <= 1e-9) {
      degenerateFaces.push(index);
      return;
    }
    const faceCenter = centroid(face.map((vertexIndex) => vertices[vertexIndex]));
    if (dot(normal, subtract(faceCenter, center)) <= 1e-9) inwardFaces.push(index);
  });
  return { degenerate_faces: degenerateFaces, inward_faces: inwardFaces };
}

function semanticDigestForEntities(entities, contract) {
  const payload = entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    role: entity.role,
    tag: entity.tag,
    material: entity.material,
    back_material: entity.parameters?.back_material || null,
    precompile_winding_validated: entity.parameters?.precompile_winding_validated === true,
    runtime_mesh_semantic: entity.parameters?.runtime_mesh_semantic ? {
      geometry_remeasured: entity.parameters.runtime_mesh_semantic.geometry_remeasured === true,
      native_geometry_remeasured: entity.parameters.runtime_mesh_semantic.native_geometry_remeasured === true,
      face_count: entity.parameters.runtime_mesh_semantic.face_count,
      degenerate_face_count: entity.parameters.runtime_mesh_semantic.degenerate_face_count,
      inward_face_count: entity.parameters.runtime_mesh_semantic.inward_face_count,
      missing_back_material_face_count: entity.parameters.runtime_mesh_semantic.missing_back_material_face_count,
      front_back_material_mismatch_count: entity.parameters.runtime_mesh_semantic.front_back_material_mismatch_count
    } : null,
    box: entity.box
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
  return artifactContentSignature({ contract_id: contract.id || null, entities: payload });
}

function regionIndex(regions) {
  return new Map(regions.map((region) => [region.id, { ...region, box: normalizeBox(region.aabb || region.box) }]));
}

function filterByRegion(entities, region) {
  if (!region) return entities;
  if (!region.box) return [];
  return entities.filter((entity) => entity.box && boxesIntersect(entity.box, region.box));
}

function byRoles(entities, roles) {
  const set = new Set(roles.filter(Boolean));
  return entities.filter((entity) => set.has(entity.role));
}

function rolesFor(assertion) {
  return [...(assertion.roles || []), assertion.role, assertion.absent_role].filter(Boolean);
}

function minimumAxisSeparation(left, right, axis) {
  const index = AXIS_INDEX[axis] ?? 1;
  let minimum = Infinity;
  for (const first of left) for (const second of right) {
    if (!first.box || !second.box) continue;
    minimum = Math.min(minimum, Math.abs(boxCenter(first.box)[index] - boxCenter(second.box)[index]));
  }
  return minimum;
}

function collectRelations(partGraph) {
  return [
    ...(partGraph.physical_relations || []),
    ...(partGraph.parts || []).flatMap((part) => [
      ...(part.physical_relations || []),
      ...(part.relationships || []).map((relation) => ({ ...relation, subject: part.id, target: relation.target }))
    ])
  ];
}

function entityHasRole(entities, id, role) {
  return entities.some((entity) => entity.id === id && entity.role === role);
}

function addIssue(issues, assertion, severity, message, evidence) {
  issues.push({
    id: assertion.id || `${assertion.type}_${issues.length + 1}`,
    type: assertion.type || 'semantic_assertion',
    severity,
    message,
    evidence
  });
}

function emptyReport(phase) {
  return {
    version: 1,
    kind: 'part_graph_semantic_contract_qa',
    phase,
    ok: true,
    verdict: 'not_applicable',
    semantic_contract_id: null,
    semantic_digest: null,
    summary: { assertions: 0, negative_evidence: 0, entities: 0, runtime_mesh_remeasured: 0, native_mesh_remeasured: 0, errors: 0, warnings: 0 },
    issues: []
  };
}

function normalizeBox(value) {
  if (!value) return null;
  if (vector3(value.min) && vector3(value.max)) return { min: value.min.map(Number), max: value.max.map(Number) };
  if (Array.isArray(value) && value.length === 6) return { min: value.slice(0, 3).map(Number), max: value.slice(3, 6).map(Number) };
  return null;
}

function minSizeBox(origin, size) {
  const min = origin.map(Number);
  return { min, max: min.map((value, index) => value + Number(size[index])) };
}

function pointsBox(points) {
  if (!points.length) return null;
  return {
    min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => Number(point[axis])))),
    max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => Number(point[axis]))))
  };
}

function boxCenter(box) {
  return [0, 1, 2].map((axis) => (box.min[axis] + box.max[axis]) / 2);
}

function defaultEyeForView(view) {
  if (view === 'front') return [0, -100000, 5000];
  if (view === 'rear') return [0, 100000, 5000];
  if (view === 'left') return [-100000, 0, 5000];
  if (view === 'right') return [100000, 0, 5000];
  return [80000, -80000, 60000];
}

function projectBox(box, { eye, target, up }) {
  const forward = normalize(subtract(target, eye));
  const right = normalize(cross(forward, up));
  const screenUp = normalize(cross(right, forward));
  const points = boxCorners(box).map((point) => {
    const relative = subtract(point, eye);
    return { x: dot(relative, right), y: dot(relative, screenUp), depth: dot(relative, forward) };
  }).filter((point) => point.depth > 0);
  if (!points.length) return { rect: null, depth: Infinity, samples: [] };
  const rect = {
    min_x: Math.min(...points.map((point) => point.x)),
    max_x: Math.max(...points.map((point) => point.x)),
    min_y: Math.min(...points.map((point) => point.y)),
    max_y: Math.max(...points.map((point) => point.y))
  };
  return {
    rect,
    depth: dot(subtract(boxCenter(box), eye), forward),
    samples: projectedRectSamples(rect)
  };
}

function projectedRectSamples(rect) {
  const samples = [];
  for (let row = 0; row <= PROJECTED_VISIBILITY_GRID_STEPS; row += 1) {
    const yRatio = row / PROJECTED_VISIBILITY_GRID_STEPS;
    const y = rect.min_y + ((rect.max_y - rect.min_y) * yRatio);
    for (let column = 0; column <= PROJECTED_VISIBILITY_GRID_STEPS; column += 1) {
      const xRatio = column / PROJECTED_VISIBILITY_GRID_STEPS;
      const x = rect.min_x + ((rect.max_x - rect.min_x) * xRatio);
      samples.push([x, y]);
    }
  }
  return samples;
}

function projectedEntryVisible(entry, all) {
  if (!entry.rect) return false;
  return entry.samples.some(([x, y]) => !all.some((other) => other !== entry
    && other.rect
    && other.depth < entry.depth - 1
    && x >= other.rect.min_x && x <= other.rect.max_x
    && y >= other.rect.min_y && y <= other.rect.max_y));
}

function boxCorners(box) {
  const points = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) points.push([x, y, z]);
    }
  }
  return points;
}

function normalize(value) {
  const magnitude = Math.hypot(...value);
  return magnitude > 1e-9 ? value.map((item) => item / magnitude) : [1, 0, 0];
}

function boxInside(inner, outer, tolerance = 0) {
  return [0, 1, 2].every((axis) => inner.min[axis] >= outer.min[axis] - tolerance && inner.max[axis] <= outer.max[axis] + tolerance);
}

function boxesIntersect(left, right) {
  return [0, 1, 2].every((axis) => Math.min(left.max[axis], right.max[axis]) >= Math.max(left.min[axis], right.min[axis]));
}

function boxDistance(left, right) {
  return Math.hypot(...[0, 1, 2].map((axis) => Math.max(0, left.min[axis] - right.max[axis], right.min[axis] - left.max[axis])));
}

function centroid(points) {
  if (!points.length) return [0, 0, 0];
  return [0, 1, 2].map((axis) => points.reduce((sum, point) => sum + Number(point[axis]), 0) / points.length);
}

function subtract(left, right) {
  return [0, 1, 2].map((axis) => left[axis] - right[axis]);
}

function cross(left, right) {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function vector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)));
}

function number(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
