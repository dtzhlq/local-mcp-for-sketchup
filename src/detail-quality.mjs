import { AgentContractError, sha256Canonical } from './agent-contract.mjs';

export const DETAIL_QUALITY_VERSION = 'detail-quality.v1';
const CHECK_TYPES = new Set(['opening', 'hollow', 'solid', 'thickness', 'profile', 'min_faces']);

// Specifications express requirements. They are never evidence that geometry exists.
export function freezeDetailSpecification(spec, frozen = null) {
  if (frozen) {
    if (spec !== undefined && sha256Canonical(spec) !== frozen.hash) {
      throw new AgentContractError('INVALID_ARGUMENT', 'The detail specification is frozen; refinement cannot remove or change requirements.');
    }
    return structuredClone(frozen);
  }
  if (spec === undefined || spec === null) return null;
  if (spec.version !== 1 || !Array.isArray(spec.required_parts) || !spec.required_parts.length) {
    throw new AgentContractError('INVALID_ARGUMENT', 'detail_spec requires version=1 and nonempty required_parts.');
  }
  const ids = new Set();
  for (const part of spec.required_parts) {
    const key = JSON.stringify([part?.id, part?.instance_path || null]);
    if (!part || typeof part.id !== 'string' || !part.id || ids.has(key)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'Detail part ids must be nonempty and unique.');
    }
    ids.add(key);
    if (part.instance_path !== undefined && (!Array.isArray(part.instance_path) || !part.instance_path.length || part.instance_path.some(value => typeof value !== 'string' || !value))) throw new AgentContractError('INVALID_ARGUMENT', 'instance_path requires logical occurrence ids.');
    if (part.geometry_checks !== undefined && !Array.isArray(part.geometry_checks)) throw new AgentContractError('INVALID_ARGUMENT', 'geometry_checks must be an array.');
    if (part.require_visible !== undefined && typeof part.require_visible !== 'boolean') throw new AgentContractError('INVALID_ARGUMENT', 'require_visible must be boolean.');
    if (part.min_faces !== undefined && (!Number.isInteger(part.min_faces) || part.min_faces < 1)) throw new AgentContractError('INVALID_ARGUMENT', 'min_faces must be positive.');
    for (const check of part.geometry_checks || []) {
      if (!CHECK_TYPES.has(check?.type)) throw new AgentContractError('INVALID_ARGUMENT', `Unsupported measured detail check: ${check?.type}`);
      for (const field of ['min_count', 'min_mm', 'min_vertices', 'min_faces']) {
        if (check[field] !== undefined && (!Number.isFinite(check[field]) || check[field] < 0)) throw new AgentContractError('INVALID_ARGUMENT', `Invalid detail check ${field}.`);
      }
      if (check.type === 'thickness' && !(check.min_mm > 0)) throw new AgentContractError('INVALID_ARGUMENT', 'A thickness check requires positive min_mm.');
      if (check.type === 'min_faces' && !(Number.isInteger(check.min_faces) && check.min_faces > 0)) throw new AgentContractError('INVALID_ARGUMENT', 'A face count check requires positive min_faces.');
      if (check.expected !== undefined && typeof check.expected !== 'boolean') throw new AgentContractError('INVALID_ARGUMENT', 'A solid check expected value must be boolean.');
      if (check.loop !== undefined && !['outer', 'any'].includes(check.loop)) throw new AgentContractError('INVALID_ARGUMENT', 'A profile check loop must be outer or any.');
      if (check.max_turn_degrees !== undefined && (!(check.max_turn_degrees > 0) || check.max_turn_degrees > 180 || check.loop !== 'outer')) throw new AgentContractError('INVALID_ARGUMENT', 'Profile max_turn_degrees requires an outer loop and a value in (0,180].');
    }
    if (part.bounds_mm) {
      if (!Array.isArray(part.bounds_mm.size) || part.bounds_mm.size.length !== 3 || part.bounds_mm.size.some(value => !Number.isFinite(value) || value <= 0)) throw new AgentContractError('INVALID_ARGUMENT', 'bounds_mm requires three positive size values.');
      if (part.bounds_mm.tolerance_mm !== undefined && (!Number.isFinite(part.bounds_mm.tolerance_mm) || part.bounds_mm.tolerance_mm < 0)) throw new AgentContractError('INVALID_ARGUMENT', 'Invalid bounds tolerance.');
    }
  }
  if (spec.resource_budget !== undefined) {
    const budget = spec.resource_budget;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget) || !Object.keys(budget).length
      || Object.entries(budget).some(([key, value]) => !['max_faces', 'max_edges', 'max_vertices'].includes(key) || !Number.isSafeInteger(value) || value < 1)) {
      throw new AgentContractError('INVALID_ARGUMENT', 'resource_budget requires at least one positive integer max_faces, max_edges or max_vertices.');
    }
  }
  if (spec.required_voids !== undefined && (!Array.isArray(spec.required_voids) || spec.required_voids.length > 128)) throw new AgentContractError('INVALID_ARGUMENT', 'required_voids must be an array with at most 128 local region requirements.');
  const voidIds = new Set();
  for (const region of spec.required_voids || []) {
    if (!region || typeof region.id !== 'string' || !region.id || voidIds.has(region.id)) throw new AgentContractError('INVALID_ARGUMENT', 'Required void ids must be nonempty and unique.');
    voidIds.add(region.id);
    if (!Array.isArray(region.instance_path) || region.instance_path.some(id => typeof id !== 'string' || !id)) throw new AgentContractError('INVALID_ARGUMENT', 'A required void needs an explicit instance_path; [] means model coordinates.');
    if (region.search_scope !== undefined && !['assembly', 'scene'].includes(region.search_scope)) throw new AgentContractError('INVALID_ARGUMENT', 'A void search_scope must be assembly or scene.');
    if (region.exclude_instance_paths !== undefined) throw new AgentContractError('INVALID_ARGUMENT', 'Void exclusions are not supported; anchor the query to the explicit host assembly.');
    if (!['min', 'max'].every(key => Array.isArray(region.bounds_mm?.[key]) && region.bounds_mm[key].length === 3 && region.bounds_mm[key].every(Number.isFinite)) || region.bounds_mm.min.some((value, axis) => region.bounds_mm.max[axis] - value < 0.1)) throw new AgentContractError('INVALID_ARGUMENT', 'Void bounds_mm require finite min/max vectors with each dimension at least 0.1 mm.');
    if (region.boundary_checks !== undefined && (!Array.isArray(region.boundary_checks) || region.boundary_checks.length > 6)) throw new AgentContractError('INVALID_ARGUMENT', 'Void boundary_checks allow at most six sides.');
    const sides = new Set();
    for (const check of region.boundary_checks || []) {
      if (!['min_x', 'max_x', 'min_y', 'max_y', 'min_z', 'max_z'].includes(check?.side) || sides.has(check.side) || !Number.isFinite(check.offset_mm) || check.offset_mm <= 0) throw new AgentContractError('INVALID_ARGUMENT', 'Void boundaries need distinct sides and positive offset_mm.');
      sides.add(check.side);
    }
  }
  if (spec.required_views !== undefined && !Array.isArray(spec.required_views)) throw new AgentContractError('INVALID_ARGUMENT', 'required_views must be an array.');
  const viewIds = new Set();
  if (spec.required_views?.length > 24) throw new AgentContractError('INVALID_ARGUMENT', 'At most 24 required views may be captured per task.');
  for (const view of spec.required_views || []) {
    if (!view || typeof view.id !== 'string' || !view.id || viewIds.has(view.id)) throw new AgentContractError('INVALID_ARGUMENT', 'Required view ids must be nonempty and unique.');
    viewIds.add(view.id);
    if (view.min_width !== undefined && (!Number.isInteger(view.min_width) || view.min_width < 1)) throw new AgentContractError('INVALID_ARGUMENT', 'Required view min_width must be positive.');
    if (view.min_height !== undefined && (!Number.isInteger(view.min_height) || view.min_height < 1)) throw new AgentContractError('INVALID_ARGUMENT', 'Required view min_height must be positive.');
    if (view.instance_path !== undefined && (!Array.isArray(view.instance_path) || !view.instance_path.length || view.instance_path.some(id => typeof id !== 'string' || !id))) throw new AgentContractError('INVALID_ARGUMENT', 'View instance_path requires logical occurrence ids.');
  }
  if (spec.max_iterations !== undefined && (!Number.isInteger(spec.max_iterations) || spec.max_iterations < 1 || spec.max_iterations > 6)) throw new AgentContractError('INVALID_ARGUMENT', 'max_iterations must be 1..6; the automatic safety budget cannot be raised by a specification.');
  return { version: 'frozen-detail-specification.v1', hash: sha256Canonical(spec), specification: structuredClone(spec) };
}

export function evaluateDetailQuality({ snapshot = {}, layoutQa, frozenSpecification, runtime = 'mock', trustedSnapshot = false, identityMap = {}, materialMap = {}, occurrencePathMap = {}, captures = [], regionInspection = null, trustedRegionInspection = false } = {}) {
  const issues = [];
  if (layoutQa?.verdict === 'fail' || layoutQa?.ok === false) issues.push({ type: 'quality.layout_failed', status: 'fail' });
  else if (layoutQa?.verdict === 'review') issues.push({ type: 'quality.layout_requires_review', status: 'review' });
  const spec = frozenSpecification?.specification;
  let resourceCosts = null;
  if (spec?.resource_budget) {
    const trustedCosts = trustedSnapshot && runtime === 'queue' && typeof snapshot.model_revision === 'string' && snapshot.model_revision.length > 0 && snapshot.model_revision_complete === true
      && snapshot.resource_totals?.complete === true && snapshot.resource_totals.scope === 'all_native_stored_geometry';
    const counts = Object.fromEntries(['faces', 'edges', 'vertices'].map(metric => [metric,
      trustedCosts && Number.isSafeInteger(snapshot.resource_totals?.[metric]) && snapshot.resource_totals[metric] >= 0 ? snapshot.resource_totals[metric] : null]));
    resourceCosts = { kind: 'geometry_resource_costs', meaning: 'resource_cost_not_detail_score', scope: 'all_native_stored_geometry',
      model_revision: trustedCosts ? snapshot.model_revision : null, counts, limits: structuredClone(spec.resource_budget) };
    for (const [limit, maximum] of Object.entries(spec.resource_budget)) {
      const metric = limit.slice(4), actual = counts[metric];
      if (actual === null) issues.push({ type: 'quality.resource_budget_unverified', status: 'unverified', resource: metric, part_key: `resource:${metric}`, expected: maximum });
      else if (actual > maximum) issues.push({ type: 'quality.resource_budget_exceeded', status: 'fail', resource: metric, part_key: `resource:${metric}`, actual, expected: maximum });
    }
  }
  const items = collectItems(snapshot);
  let measuredParts = 0;
  for (const requirement of spec?.required_parts || []) {
    const identity = { part_id: requirement.id, ...(requirement.instance_path ? { instance_path: requirement.instance_path, part_key: JSON.stringify(requirement.instance_path) } : {}) };
    const wanted = identityMap[requirement.id] || requirement.id;
    const wantedPath = occurrencePathMap[JSON.stringify(requirement.instance_path)] || requirement.instance_path?.map(id => identityMap[id] || id);
    const matches = items.filter(item => wantedPath
      ? JSON.stringify(item.instance_path) === JSON.stringify(wantedPath)
      : [item.id, item.entity_path, item.reference, item.part_id].includes(wanted));
    if (matches.length !== 1) {
      issues.push({ type: matches.length ? 'detail.part_ambiguous' : 'detail.part_missing', ...identity, status: 'fail' });
      continue;
    }
    const item = matches[0];
    const evidence = item.geometry_evidence;
    if (requirement.require_visible) {
      if (item.visible === false || item.hidden === true || evidence?.visible_face_count === 0) {
        issues.push({ type: 'detail.required_geometry_hidden', ...identity, status: 'fail' });
        continue;
      }
      if (item.visible !== true || !Number.isInteger(evidence?.visible_face_count)) {
        issues.push({ type: 'detail.visibility_unverified', ...identity, status: 'unverified' });
        continue;
      }
      if (Number.isInteger(evidence.face_count) && evidence.visible_face_count < evidence.face_count) {
        issues.push({ type: 'detail.required_faces_hidden', ...identity, status: 'fail' });
        continue;
      }
    }
    // Destructive repair history can veto detailed acceptance, but repair
    // metadata is never affirmative proof of any geometric requirement.
    if (hasBoundingBoxRepair(item, snapshot)) {
      issues.push({ type: 'detail.bounding_box_repair_forbidden', ...identity, status: 'fail' });
      continue;
    }
    const verifiedSource = trustedSnapshot && evidence?.measured === true && evidence?.complete !== false
      && (runtime === 'queue' ? evidence.source === 'sketchup_runtime' : ['mock_runtime', 'sketchup_runtime'].includes(evidence.source));
    if (!verifiedSource) {
      issues.push({ type: 'detail.measured_geometry_unavailable', ...identity, status: 'unverified' });
      continue;
    }
    measuredParts += 1;
    const fail = (type, actual, expected) => issues.push({ type, ...identity, status: 'fail', actual, expected });
    if (requirement.material) {
      const expectedMaterial = materialMap[requirement.material] || requirement.material;
      const actualMaterials = evidence.material_names || [item.material];
      if (!actualMaterials.includes(expectedMaterial)) fail('detail.material_mismatch', actualMaterials, expectedMaterial);
    }
    if (requirement.min_faces && !(evidence.face_count >= requirement.min_faces)) fail('detail.insufficient_faces', evidence.face_count ?? null, requirement.min_faces);
    if (requirement.bounds_mm) {
      const box = evidence.bounds_mm;
      const size = box?.size || (Array.isArray(box?.min) && Array.isArray(box?.max) ? box.max.map((value, index) => value - box.min[index]) : null);
      const tolerance = requirement.bounds_mm.tolerance_mm ?? 1;
      if (!Array.isArray(size) || size.length !== 3 || size.some((value, index) => !Number.isFinite(value) || Math.abs(value - requirement.bounds_mm.size[index]) > tolerance)) fail('detail.dimension_mismatch', size, requirement.bounds_mm);
    }
    for (const check of requirement.geometry_checks || []) {
      if (check.type === 'opening') {
        const count = (evidence.through_holes || []).filter(hole => hole.verified === true).length;
        if (count < (check.min_count ?? 1)) fail('detail.opening_missing', count, check.min_count ?? 1);
      } else if (check.type === 'hollow') {
        const count = (evidence.cavities || []).filter(cavity => cavity.verified === true).length;
        if (count < (check.min_count ?? 1)) fail('detail.cavity_missing', count, check.min_count ?? 1);
      } else if (check.type === 'solid' && evidence.closed_solid !== (check.expected ?? true)) fail('detail.solid_mismatch', evidence.closed_solid ?? null, check.expected ?? true);
      else if (check.type === 'thickness' && !(evidence.min_thickness_mm >= check.min_mm)) fail('detail.thickness_unverified', evidence.min_thickness_mm ?? null, check.min_mm);
      else if (check.type === 'profile') {
        const vertices = check.loop === 'outer' ? evidence.profile_outer_vertex_count : evidence.profile_vertex_count;
        if (!(vertices >= (check.min_vertices ?? 3))) fail('detail.profile_unverified', vertices ?? null, check.min_vertices ?? 3);
        if (check.max_turn_degrees !== undefined && !(Number.isFinite(evidence.profile_outer_max_turn_degrees) && evidence.profile_outer_max_turn_degrees >= 0 && evidence.profile_outer_max_turn_degrees <= check.max_turn_degrees)) fail('detail.rounded_profile_missing', evidence.profile_outer_max_turn_degrees ?? null, check.max_turn_degrees);
      }
      else if (check.type === 'min_faces' && !(evidence.face_count >= check.min_faces)) fail('detail.insufficient_faces', evidence.face_count ?? null, check.min_faces);
    }
  }
  let measuredVoids = 0;
  for (const requirement of spec?.required_voids || []) {
    const identity = { void_id: requirement.id, part_key: `void:${requirement.id}`, instance_path: requirement.instance_path };
    const wantedPath = occurrencePathMap[JSON.stringify(requirement.instance_path)] || requirement.instance_path.map(id => identityMap[id] || id);
    const matches = Array.isArray(regionInspection?.results) ? regionInspection.results.filter(result => result.id === requirement.id) : [];
    const result = matches.length === 1 ? matches[0] : null;
    const trusted = trustedSnapshot && trustedRegionInspection && regionInspection?.version === 'native-detail-regions.v1'
      && regionInspection.read_only === true && regionInspection.model_revision_complete === true
      && typeof snapshot.model_revision === 'string' && regionInspection.model_revision === snapshot.model_revision
      && result?.evidence_source === 'sketchup_runtime' && result.model_revision === snapshot.model_revision
      && JSON.stringify(result.instance_path) === JSON.stringify(wantedPath)
      && JSON.stringify(result.bounds_mm) === JSON.stringify(requirement.bounds_mm)
      && JSON.stringify(result.boundary_checks) === JSON.stringify(requirement.boundary_checks || [])
      && result.search_scope === (requirement.search_scope || 'scene');
    if (!trusted) {
      issues.push({ type: 'detail.context_void_unverified', ...identity, status: 'unverified' });
      continue;
    }
    measuredVoids += 1;
    if (result.status !== 'pass') {
      issues.push({ type: 'detail.context_void_obstructed', ...identity, status: result.status === 'fail' ? 'fail' : 'unverified', reason: result.reason, blocker_path: result.blocker_path });
    } else if ((requirement.boundary_checks || []).some(check => !result.boundary_results?.some(boundary => boundary.side === check.side && boundary.status === 'pass' && boundary.verified === true))) {
      issues.push({ type: 'detail.context_boundary_unverified', ...identity, status: 'unverified' });
    }
  }
  for (const view of spec?.required_views || []) {
    if (!captures.some(capture => capture.id === view.id && capture.server_verified === true && typeof snapshot.model_revision === 'string' && capture.model_revision === snapshot.model_revision && capture.width >= (view.min_width || 1) && capture.height >= (view.min_height || 1))) {
      issues.push({ type: 'detail.view_unverified', view_id: view.id, status: 'unverified' });
    }
  }
  const qualityStatus = issues.some(issue => issue.status === 'fail') ? 'fail' : issues.some(issue => issue.status === 'unverified') ? 'unverified' : issues.length ? 'review' : 'pass';
  return {
    version: DETAIL_QUALITY_VERSION,
    quality_status: qualityStatus,
    quality_accepted: qualityStatus === 'pass' && trustedSnapshot,
    evidence_level: trustedSnapshot ? runtime === 'queue' ? 'live_runtime' : 'offline_mock' : 'supplied_snapshot',
    specification_hash: frozenSpecification?.hash || null,
    required_parts: spec?.required_parts.length || 0,
    measured_parts: measuredParts,
    required_voids: spec?.required_voids?.length || 0,
    measured_voids: measuredVoids,
    ...(resourceCosts ? { resource_costs: resourceCosts } : {}),
    issues,
    remaining: issues.map(({ type, part_id, part_key, instance_path, view_id, void_id, resource, status }) => ({ type, part_id, part_key, instance_path, view_id, void_id, resource, status }))
  };
}

function collectItems(snapshot) {
  const result = [...(snapshot.groups || []), ...(snapshot.instances || [])];
  // Runtime-projected nested occurrences are distinct; do not infer their geometry from definition metadata.
  for (const item of snapshot.geometry_occurrences || []) if (!result.some(entry => entry.entity_path && entry.entity_path === item.entity_path)) result.push(item);
  return result;
}

function hasBoundingBoxRepair(item, snapshot) {
  const strategies = [item.repair_strategy, item.manifold?.repair_strategy, item.geometry_evidence?.repair_strategy, ...(item.geometry_evidence?.repair_strategies || []), ...(item.repair_history || []).map(entry => entry.repair_strategy || entry.strategy)];
  const identifiers = [item.id, item.part_id, item.name, item.entity_path].filter(Boolean);
  for (const check of snapshot.manifold_checks || []) {
    if (check.op === 'manifold_repair' && identifiers.some(id => [check.after?.id, check.after?.name].includes(id))) strategies.push(check.after?.repair_strategy);
  }
  return strategies.includes('seal_bbox');
}
