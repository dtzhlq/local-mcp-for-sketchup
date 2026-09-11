import assert from 'node:assert/strict';
import {narrowDetailLayoutQa} from '../src/detail-collision-review.mjs';
const snapshot={model_revision:'native-revision',model_revision_complete:true,instances:[{id:'left-native',name:'Left',bounding_box:{min:[0,0,0],max:[100,100,100]}},{id:'right-native',name:'Right',bounding_box:{min:[50,0,0],max:[150,100,100]}}]};
const qa={ok:false,verdict:'fail',issues:[{type:'layout.unexpected_collision',severity:'error',item:'Left / Right'}],summary:{total:1}};
for(const mode of ['clear','occupied','stale','wrong-space','wrong-bounds','wrong-anchor','duplicate','error','other-failure']){
 const input=structuredClone(qa);
 if(mode==='other-failure')input.issues.push({type:'other',severity:'error'});
 const bridge={inspect_detail_regions:async({queries})=>{
  assert.equal(queries.length,2);assert.deepEqual(queries[0].bounds_mm,{min:[50,0,0],max:[100,100,100]});
  assert.equal(queries[0].coordinate_space,'model');assert.equal(queries[0].search_scope,'assembly');
  if(mode==='error')throw new Error('Offline failure');
  const result={version:'native-detail-regions.v1',read_only:true,model_revision_complete:true,model_revision:snapshot.model_revision,results:queries.map((query,i)=>({...structuredClone(query),status:i===0?'pass':'fail',evidence_source:'sketchup_runtime',model_revision:snapshot.model_revision}))};
  if(mode==='occupied')result.results[0].status='fail';
  if(mode==='stale')result.model_revision='old';
  if(mode==='wrong-space')delete result.results[0].coordinate_space;
  if(mode==='wrong-bounds')result.results[0].bounds_mm.min[0]=60;
  if(mode==='wrong-anchor')result.results[0].instance_path=['wrong'];
  if(mode==='duplicate')result.results.push(structuredClone(result.results[0]));
  return result;
 }};
 const report=await narrowDetailLayoutQa({bridge,snapshot,qa:input});
 assert.equal(report.qa.ok,mode==='clear',mode);
 if(!['clear','other-failure'].includes(mode))assert.equal(report.qa,input,'An unresolved narrow phase must preserve the original QA conclusion');
 if(mode==='other-failure')assert.deepEqual(report.qa.issues,[{type:'other',severity:'error'}]);
 assert.equal(qa.issues.length,1,'Original report is preserved');
}
console.log('detail-collision-review: actual empty-region proofs only; occupancy, stale or altered receipts, errors and other QA failures stay unresolved (offline fixtures)');
for(const mode of ['valid','wrong-peer','stale','duplicate','wrong-tolerance','empty-coverage','unverified']){
 const bridge={inspect_detail_regions:async({queries})=>{
  const pair=queries[0].mode==='pair_separation';
  const response={version:'native-detail-regions.v1',read_only:true,model_revision_complete:true,model_revision:snapshot.model_revision,results:queries.map(query=>({...query,status:pair?'pass':'fail',evidence_source:'sketchup_runtime',model_revision:snapshot.model_revision,coordinate_space:'model',method:'native_leaf_separation.v1',numerical_tolerance_mm:0.000001,leaf_counts:[4,6]}))};
  if(pair){
   if(mode==='wrong-peer')response.results[0].comparison_instance_path=['some-other-root'];
   if(mode==='stale')response.model_revision='stale';
   if(mode==='duplicate')response.results.push({...response.results[0]});
   if(mode==='wrong-tolerance')response.results[0].numerical_tolerance_mm=1;
   if(mode==='empty-coverage')response.results[0].leaf_counts=[0,6];
   if(mode==='unverified')response.results[0].status='unverified';
  }
  return response;
 }};
 const report=await narrowDetailLayoutQa({bridge,snapshot,qa});
 assert.equal(report.qa.ok,mode==='valid',`Leaf separation receipt: ${mode}`);
}

// Offline reconstruction of a native anonymous root: layout uses its canonical
// pid reference while the second object still has an authored stable id.
const anonymousSnapshot = () => ({ ...structuredClone(snapshot), instances: [
 { id: '', name: '', persistent_id: '41159', bounding_box: structuredClone(snapshot.instances[0].bounding_box) },
 structuredClone(snapshot.instances[1])
] });
const anonymousQa = () => ({ ...structuredClone(qa), issues: [{ ...qa.issues[0], item: 'pid:41159 / Right' }] });
for (const mode of ['string-pid', 'numeric-pid', 'missing-id', 'named-root', 'both-anonymous', 'existing-id', 'unverified']) {
 const inputSnapshot = anonymousSnapshot(), inputQa = anonymousQa(), calls = [];
 if (mode === 'numeric-pid') inputSnapshot.instances[0].persistent_id = 41159;
 if (mode === 'missing-id') delete inputSnapshot.instances[0].id;
 if (mode === 'named-root') { inputSnapshot.instances[0].name = 'Sree'; inputQa.issues[0].item = 'Sree / Right'; }
 if (mode === 'both-anonymous') { Object.assign(inputSnapshot.instances[1], { id: '', name: '', persistent_id: '46839' }); inputQa.issues[0].item = 'pid:41159 / pid:46839'; }
 if (mode === 'existing-id') inputSnapshot.instances[0].id = 'left-native';
 const expectedLeft = mode === 'existing-id' ? 'left-native' : 'pid:41159';
 const expectedRight = mode === 'both-anonymous' ? 'pid:46839' : 'right-native';
 const before = JSON.stringify(inputSnapshot);
 const bridge = { inspect_detail_regions: async ({ queries, runtime }) => {
  assert.equal(runtime, 'queue'); calls.push(structuredClone(queries));
  const pair = queries[0].mode === 'pair_separation';
  assert.deepEqual(queries[0].instance_path, [expectedLeft]);
  if (pair) assert.deepEqual(queries[0].comparison_instance_path, [expectedRight]);
  else { assert.deepEqual(queries[1].instance_path, [expectedRight]); assert.deepEqual(queries[0].bounds_mm, { min: [50, 0, 0], max: [100, 100, 100] }); }
  return { version: 'native-detail-regions.v1', read_only: true, model_revision_complete: true, model_revision: snapshot.model_revision,
   results: queries.map(query => ({ ...query, status: pair && mode !== 'unverified' ? 'pass' : 'unverified',
    evidence_source: 'sketchup_runtime', model_revision: snapshot.model_revision, coordinate_space: 'model',
    method: 'native_leaf_separation.v1', numerical_tolerance_mm: 0.000001, leaf_counts: [4, 6] })) };
 } };
 const report = await narrowDetailLayoutQa({ bridge, snapshot: inputSnapshot, qa: inputQa });
 assert.equal(calls.length, 2, `${mode}: canonical pid roots must reach both read-only narrow phases`);
 assert.equal(report.qa.ok, mode !== 'unverified');
 if (mode === 'unverified') assert.equal(report.qa, inputQa, 'A resolved pid is not itself evidence of separation');
 assert.equal(JSON.stringify(inputSnapshot), before, 'Persistent-id fallback must not assign ids or alter the snapshot');
}

for (const mode of ['duplicate-pid', 'name-alias', 'id-alias', 'duplicate-selected-id', 'zero-pid', 'leading-zero-pid', 'negative-pid', 'non-integer-pid', 'unsafe-number-pid', 'missing-pid', 'malformed-id', 'empty-item', 'object-item', 'nested-pid', 'same-root', 'short-bounds', 'string-bounds', 'inverted-bounds']) {
 const inputSnapshot = anonymousSnapshot(), inputQa = anonymousQa();
 if (mode === 'duplicate-pid') inputSnapshot.instances.push({ ...structuredClone(inputSnapshot.instances[0]), name: 'Different name' });
 if (mode === 'name-alias') inputSnapshot.instances.push({ ...structuredClone(snapshot.instances[0]), name: 'pid:41159' });
 if (mode === 'id-alias') inputSnapshot.instances.push({ ...structuredClone(snapshot.instances[0]), id: 'pid:41159' });
 if (mode === 'duplicate-selected-id') inputSnapshot.instances.push({ ...structuredClone(snapshot.instances[1]), name: 'Different right name' });
 const invalidPids = { 'zero-pid': '0', 'leading-zero-pid': '041159', 'negative-pid': '-41159', 'non-integer-pid': '41159.5', 'unsafe-number-pid': Number.MAX_SAFE_INTEGER + 1 };
 if (Object.hasOwn(invalidPids, mode)) { inputSnapshot.instances[0].persistent_id = invalidPids[mode]; inputQa.issues[0].item = `pid:${invalidPids[mode]} / Right`; }
 if (mode === 'missing-pid') delete inputSnapshot.instances[0].persistent_id;
 if (mode === 'malformed-id') inputSnapshot.instances[0].id = '   ';
 if (mode === 'empty-item') inputQa.issues[0].item = ' / Right';
 if (mode === 'object-item') inputQa.issues[0].item = {};
 if (mode === 'nested-pid') inputQa.issues[0].item = 'pid:41159/46839 / Right';
 if (mode === 'same-root') { inputSnapshot.instances[0].name = 'Sree'; inputQa.issues[0].item = 'pid:41159 / Sree'; }
 if (mode === 'short-bounds') inputSnapshot.instances[0].bounding_box.min = [0, 0];
 if (mode === 'string-bounds') inputSnapshot.instances[0].bounding_box.min[0] = '0';
 if (mode === 'inverted-bounds') inputSnapshot.instances[0].bounding_box.min[0] = 101;
 let called = false;
 const report = await narrowDetailLayoutQa({ bridge: { inspect_detail_regions: async () => { called = true; throw new Error('Invalid identity must never be dispatched'); } }, snapshot: inputSnapshot, qa: inputQa });
 assert.equal(called, false, `${mode}: ambiguous or malformed roots must stay unresolved without native calls`);
 assert.equal(report.qa, inputQa); assert.equal(report.evidence, null);
}
console.log('detail-collision-review: canonical persistent-id fallback, actual pid query paths, preserved stable ids, ambiguity/malformed rejection and unchanged native evidence requirements passed (offline read-only fixtures)');
