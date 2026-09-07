import assert from 'node:assert/strict';
import { buildDetailedSampleMatrix, buildDetailedSampleCohort } from '../src/detailed-modeling/sample-matrix.mjs';
const matrix=buildDetailedSampleMatrix();
assert.equal(matrix.length,8);
for(const {kind,baseline,resized,nested_mirrored: nested,acceptance} of matrix){
  assert.notDeepEqual(baseline.brief.parameters,resized.brief.parameters,kind);
  assert.equal(nested.parts_mapping.length,baseline.parts_mapping.length,`${kind} nesting must preserve every occurrence`);
  assert.ok(nested.parts_mapping.every(part=>part.instance_path.length>=3));
  assert.ok(nested.detail_spec.required_voids.every(rule=>rule.instance_path[0].endsWith('-fixture')&&rule.instance_path[1].endsWith('-placed')));
  assert.equal(nested.part_graph.parts.at(-1).assembly.children[0].transform.mirror,'x');
  assert.equal(nested.part_graph.parts.at(-1).assembly.children[0].transform.rotateZ,27);
  assert.equal(acceptance.native_verified,false);
  assert.ok(acceptance.required_negative_cases.includes('metadata_only_replacement'));
  const cohort=buildDetailedSampleCohort(kind);
  assert.equal(cohort.part_graph.roots.length,3);
  assert.equal(cohort.views.length,6);
  assert.deepEqual(cohort.detail_spec.required_parts,[baseline,resized,nested].flatMap(sample=>sample.detail_spec.required_parts),'Combining fixtures must not weaken any original part requirement');
  assert.deepEqual(cohort.detail_spec.required_voids,[baseline,resized,nested].flatMap(sample=>sample.detail_spec.required_voids));
  assert.equal(new Set(cohort.parts_mapping.map(part=>part.instance_path.join('/'))).size,cohort.parts_mapping.length);
  assert.equal(cohort.brief.agent_scene_evidence,false);
  assert.equal(cohort.part_graph.roots[1].origin[0],14000);
  assert.equal(cohort.part_graph.roots[2].origin[0],28000);
}
assert.throws(()=>buildDetailedSampleCohort('unknown'),/Unknown/);
console.log('detail-sample-matrix: 8 families x base/resized/nested mirrored specifications, occurrence and frozen void binding; no native acceptance');
