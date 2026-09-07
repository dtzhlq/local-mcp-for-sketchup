import assert from 'node:assert/strict';
import { buildDetailedRecipeSample, buildDetailedScene } from '../src/detailed-modeling/scenes.mjs';
import { DETAILED_RECIPE_KINDS } from '../src/detailed-modeling/recipes.mjs';
import { freezeDetailSpecification, evaluateDetailQuality } from '../src/detail-quality.mjs';
import { maximumProfileTurnDegrees, requirementsForOccurrences } from '../src/detailed-modeling/requirements.mjs';
import { addRailing } from '../src/architecture-operations.mjs';
import { emptyModel } from '../src/model-state.mjs';

for (const kind of DETAILED_RECIPE_KINDS) {
  const bundle = buildDetailedRecipeSample({ kind });
  assert.equal(bundle.detail_spec.coverage_version, 2);
  assert.equal(bundle.detail_spec.required_parts.length, bundle.parts_mapping.length, `${kind}: every repeated leaf is independently required`);
  assert.equal(new Set(bundle.detail_spec.required_parts.map(part => JSON.stringify(part.instance_path))).size, bundle.parts_mapping.length);
  assert.ok(bundle.detail_spec.required_parts.every(part => part.require_visible && part.material && (part.bounds_mm || part.geometry_checks.length || part.min_faces > 6)));
  freezeDetailSpecification(bundle.detail_spec);
}
for (const scene of ['kitchen', 'entry-facade']) {
  const bundle = buildDetailedScene({ scene });
  assert.equal(bundle.detail_spec.required_parts.length, bundle.parts_mapping.length);
  assert.ok(bundle.detail_spec.required_parts.some(part => /handle|hinge|bolt|clamp/.test(part.role)));
}
const panel = { id: 'host', role: 'wall', material: 'Stone', shape: { primitive: 'panel_with_openings', parameters: {
  size: [500, 400], thickness: 30, openings: [{ x: 20, y: 0, width: 100, height: 200 }, { x: 200, y: 100, width: 100, height: 200 }]
} } };
const hostRules = requirementsForOccurrences([panel], [{ part_id: 'host', instance_path: ['host'], definition_path: [] }]);
assert.equal(hostRules[0].geometry_checks.find(check => check.type === 'opening').min_count, 1, 'edge notches are proved by context voids, not false inner-loop counts');

// Synthetic measured-receipt fixtures test the gate, not live SketchUp quality.
// Numeric geometry values below are independent of requirement thresholds.
const window = buildDetailedRecipeSample({ kind: 'window' });
const frameRules = window.detail_spec.required_parts.filter(part => ['frame', 'sash_frame', 'glazing'].includes(part.role));
const spec = freezeDetailSpecification({ version: 1, required_parts: frameRules });
const sourceParts = new Map(window.part_graph.parts.map(part => [part.id, part]));
const frameSnapshot = { geometry_occurrences: frameRules.map(rule => {
  const p = sourceParts.get(rule.id).shape.parameters;
  const isProfile = Boolean(p.outer), min = isProfile ? [Math.min(...p.outer.map(point => point[0])), Math.min(...p.outer.map(point => point[1]))] : null;
  const size = isProfile ? [Math.max(...p.outer.map(point => point[0])) - min[0], p.depth, Math.max(...p.outer.map(point => point[1])) - min[1]] : p.size;
  const faceCount = isProfile ? p.outer.length + (p.holes || []).reduce((sum, hole) => sum + hole.length, 0) + 2 : 6;
  return { part_id: rule.id, instance_path: rule.instance_path, visible: true, geometry_evidence: { source: 'mock_runtime', measured: true, complete: true, face_count: faceCount, visible_face_count: faceCount, bounds_mm: { size }, material_names: [sourceParts.get(rule.id).material], profile_outer_vertex_count: p.outer?.length, profile_vertex_count: Math.max(p.outer?.length || 0, ...(p.holes || []).map(hole => hole.length)), through_holes: (p.holes || []).map(() => ({ verified: true })) } };
}) };
const evaluate = snapshot => evaluateDetailQuality({ snapshot, frozenSpecification: spec, trustedSnapshot: true, runtime: 'mock', layoutQa: { verdict: 'pass', ok: true } });
assert.equal(evaluate(frameSnapshot).quality_accepted, true);
const removed = structuredClone(frameSnapshot); removed.geometry_occurrences.splice(0, 1);
assert.ok(evaluate(removed).remaining.some(issue => issue.type === 'detail.part_missing'));
const repeated = structuredClone(frameSnapshot); repeated.geometry_occurrences.pop();
assert.ok(evaluate(repeated).remaining.some(issue => issue.type === 'detail.part_missing'), 'remaining left sash cannot cover a deleted right sash leaf');
const sealed = structuredClone(frameSnapshot); sealed.geometry_occurrences[0].geometry_evidence.through_holes = []; sealed.geometry_occurrences[0].features = [{ opening: true }];
assert.ok(evaluate(sealed).remaining.some(issue => issue.type === 'detail.opening_missing'));
const hidden = structuredClone(frameSnapshot); hidden.geometry_occurrences[0].visible = false;
assert.ok(evaluate(hidden).remaining.some(issue => issue.type === 'detail.required_geometry_hidden'));
const hiddenFace = structuredClone(frameSnapshot); hiddenFace.geometry_occurrences[0].geometry_evidence.visible_face_count--;
assert.ok(evaluate(hiddenFace).remaining.some(issue => issue.type === 'detail.required_faces_hidden'));
const metadata = structuredClone(frameSnapshot); for (const item of metadata.geometry_occurrences) { delete item.geometry_evidence; item.features = { detailed: true, opening: true, visible: true }; }
assert.equal(evaluate(metadata).quality_accepted, false);

const drawer = buildDetailedRecipeSample({ kind: 'cabinet' });
const rounded = drawer.detail_spec.required_parts.find(part => part.role === 'drawer_front');
const outer = drawer.part_graph.parts.find(part => part.id === rounded.id).shape.parameters.outer;
assert.ok(maximumProfileTurnDegrees(outer) < 45);
const fake = { part_id: rounded.id, instance_path: rounded.instance_path, visible: true, geometry_evidence: { source: 'mock_runtime', measured: true, complete: true, face_count: 26, visible_face_count: 26, material_names: ['Detail_Oak'], bounds_mm: { size: rounded.bounds_mm.size }, profile_outer_vertex_count: outer.length, profile_vertex_count: 40, profile_outer_max_turn_degrees: 90, through_holes: [{ verified: true }] } };
const sharp = evaluateDetailQuality({ snapshot: { geometry_occurrences: [fake] }, frozenSpecification: freezeDetailSpecification({ version: 1, required_parts: [rounded] }), trustedSnapshot: true, runtime: 'mock' });
assert.ok(sharp.remaining.some(issue => issue.type === 'detail.rounded_profile_missing'), 'subdivided straight corners and an unrelated 40-vertex inner loop cannot satisfy rounded outer corners');

const model = emptyModel(); addRailing(model, { name: 'R', path: [[0, 0, 0], [2400, 0, 0]] });
assert.ok(model.groups.every(group => group.segments === 32), 'generic railing no longer silently hardcodes 8 sides');
const precise = emptyModel(); addRailing(precise, { name: 'P', path: [[0, 0, 0], [2400, 0, 0]], chord_tolerance_mm: 0.01 });
assert.ok(precise.groups.every(group => group.segments > 32));
assert.throws(() => addRailing(emptyModel(), { name: 'Bad', path: [[0, 0, 0], [2400, 0, 0]], chord_tolerance_mm: 0.0001, max_segments: 40 }), /requires.*segments/);
console.log('detail-quality-coverage: eight recipe/full occurrence coverage, synthetic geometry vetoes, and actual Node railing tessellation passed; no live acceptance asserted');
