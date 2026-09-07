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
