import { sha256Canonical } from './agent-contract.mjs';

function persistentReference(root) {
  const value = root?.persistent_id;
  const id = typeof value === 'string' ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : '';
  return /^[1-9][0-9]*$/.test(id) ? `pid:${id}` : null;
}

function rootMatchesReference(root, reference) {
  return root?.name === reference || root?.id === reference
    || (/^pid:[1-9][0-9]*$/.test(reference) && persistentReference(root) === reference);
}

function queryReference(root, roots) {
  const hasId = typeof root.id === 'string' && root.id.trim();
  if (!hasId && root.id !== undefined && root.id !== null && root.id !== '') return null;
  const reference = hasId ? root.id : persistentReference(root);
  // A query reference is usable only when it identifies exactly this
  // snapshot root, including potential collisions with named/id aliases.
  const matches = reference ? roots.filter(candidate => rootMatchesReference(candidate, reference)) : [];
  return matches.length === 1 && matches[0] === root ? reference : null;
}

function validRootBounds(root) {
  const bounds = root?.bounding_box;
  return ['min', 'max'].every(key => Array.isArray(bounds?.[key]) && bounds[key].length === 3 && bounds[key].every(Number.isFinite))
    && bounds.max.every((value, axis) => value >= bounds.min[axis]);
}

// Conservative narrow phase: an empty geometric intersection box on either
// side proves separation. An occupied box does not prove a collision, so its
// existing warning remains for further analysis. Touching faces are not waived.
export async function narrowDetailLayoutQa({ bridge, snapshot, qa, runtime = 'queue', timeoutMs = 120000 }) {
  if (runtime !== 'queue' || !snapshot?.model_revision_complete || !snapshot.model_revision) return { qa, evidence: null };
  const roots = [...(snapshot.groups || []), ...(snapshot.instances || [])];
  const pairs = [];
  for (const [index, issue] of (qa.issues || []).entries()) {
    if (issue.type !== 'layout.unexpected_collision') continue;
    const names = typeof issue.item === 'string' ? issue.item.split(' / ') : null;
    if (names?.length !== 2 || names.some(name => !name)) continue;
    const matches = names.map(name => roots.filter(root => rootMatchesReference(root, name)));
    if (matches.some(items => items.length !== 1) || matches[0][0] === matches[1][0]) continue;
    const entities = matches.map(items => items[0]);
    const references = entities.map(entity => queryReference(entity, roots));
    if (references.some(reference => !reference) || entities.some(entity => !validRootBounds(entity))) continue;
    const bounds = { min: [0,1,2].map(axis => Math.max(...entities.map(entity => entity.bounding_box.min[axis]))), max: [0,1,2].map(axis => Math.min(...entities.map(entity => entity.bounding_box.max[axis]))) };
    if (![...bounds.min,...bounds.max].every(Number.isFinite) || bounds.max.some((max, axis) => max - bounds.min[axis] < 0.1)) continue;
    pairs.push({ issue_index: index, queries: entities.map((_entity, side) => ({ id: `collision-${index}-${side}`, instance_path: [references[side]], search_scope: 'assembly', coordinate_space: 'model', bounds_mm: bounds, boundary_checks: [] })) });
  }
  if (!pairs.length || pairs.length > 64) return { qa, evidence: null };
  const queries = pairs.flatMap(pair => pair.queries);
  let response;
  try { response = await bridge.inspect_detail_regions({ queries, runtime, timeoutMs }); }
  catch (error) { return { qa, evidence: { queries, error: String(error.message), resolved: [] } }; }
  const valid = response?.version === 'native-detail-regions.v1' && response.read_only === true && response.model_revision_complete === true && response.model_revision === snapshot.model_revision;
  const passed = query => {
    if (!valid) return false;
    const results = response.results?.filter(result => result.id === query.id) || [];
    if (results.length !== 1) return false;
    const result = results[0];
    return result.status === 'pass' && result.evidence_source === 'sketchup_runtime' && result.model_revision === snapshot.model_revision
      && result.coordinate_space === 'model' && result.search_scope === 'assembly'
      && sha256Canonical(result.instance_path) === sha256Canonical(query.instance_path)
      && sha256Canonical(result.bounds_mm) === sha256Canonical(query.bounds_mm)
      && sha256Canonical(result.boundary_checks || []) === sha256Canonical([]);
  };
  const pairQueries = pairs.filter(pair => !pair.queries.some(passed)).map(pair => ({ id: `leaf-pair-${pair.issue_index}`, mode: 'pair_separation',
    instance_path: pair.queries[0].instance_path, comparison_instance_path: pair.queries[1].instance_path }));
  let pairResponse = null, pairError = null;
  if (pairQueries.length) {
    try { pairResponse = await bridge.inspect_detail_regions({ queries: pairQueries, runtime, timeoutMs }); }
    catch (error) { pairError = String(error.message); }
  }
  const separated = pair => {
    if (pairResponse?.version !== 'native-detail-regions.v1' || pairResponse.read_only !== true || pairResponse.model_revision_complete !== true || pairResponse.model_revision !== snapshot.model_revision) return false;
    const results = pairResponse.results?.filter(result => result.id === `leaf-pair-${pair.issue_index}`) || [];
    if (results.length !== 1) return false;
    const result = results[0];
    return result.status === 'pass' && result.mode === 'pair_separation' && result.method === 'native_leaf_separation.v1'
      && result.evidence_source === 'sketchup_runtime' && result.model_revision === snapshot.model_revision && result.coordinate_space === 'model'
      && result.numerical_tolerance_mm === 0.000001 && result.leaf_counts?.length === 2 && result.leaf_counts.every(count => Number.isInteger(count) && count > 0)
      && sha256Canonical(result.instance_path) === sha256Canonical(pair.queries[0].instance_path)
      && sha256Canonical(result.comparison_instance_path) === sha256Canonical(pair.queries[1].instance_path);
  };
  const evidence = { queries, response, pair_queries: pairQueries, pair_response: pairResponse, pair_error: pairError };
  const resolved = pairs.filter(pair => pair.queries.some(passed) || separated(pair));
  if (!resolved.length) return { qa, evidence: { ...evidence, resolved: [] } };
  const cleared = new Set(resolved.map(pair => pair.issue_index));
  const issues = qa.issues.filter((_, index) => !cleared.has(index));
  const accepted = resolved.map(pair => ({ ...qa.issues[pair.issue_index], reason: separated(pair) ? 'Native leaf geometry has no interior overlap; boundary contact is permitted.' : 'Native geometry is empty in the shared bounding-box region on at least one side.', evidence_kind: 'native_separation_proof', query_ids: separated(pair) ? [`leaf-pair-${pair.issue_index}`] : pair.queries.filter(passed).map(query => query.id), model_revision: snapshot.model_revision }));
  const remainingError = issues.some(issue => issue.severity === 'error');
  const remainingWarning = issues.some(issue => issue.severity === 'warn');
  const bySeverity = {}, byType = {};
  for (const issue of issues) { bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1; byType[issue.type] = (byType[issue.type] || 0) + 1; }
  return { qa: { ...qa, issues, ok: !remainingError, verdict: remainingError ? 'fail' : remainingWarning ? 'review' : 'pass', level: remainingError ? 'error' : remainingWarning ? 'warn' : 'ok',
    summary: { ...qa.summary, total: issues.length, by_severity: bySeverity, by_type: byType },
    native_separation_proofs: [...(qa.native_separation_proofs || []), ...accepted] },
    evidence: { ...evidence, resolved: accepted } };
}
