import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {compileModelAccessibilityTask as compile,preflightModelAccessibilityTask as preflight} from '../src/model-accessibility-tasks.mjs';
import {buildTraditionalAssemblyRecipe} from '../src/traditional-timber/assembly-compiler.mjs';
import {solveTraditionalLayout,pathPoint} from '../src/traditional-timber/layout.mjs';
import {solveRoofFaces,roofDimensions} from '../src/traditional-timber/roof-families.mjs';
import {normalizeTraditionalAssembly,parameterImpactSet} from '../src/traditional-timber/assembly-plan.mjs';
import {straightCorridorTask,squarePavilionTask,cornerCorridorTask,moonWallTask,courtyardScenePlan,unpresetScenePlan,referenceTask} from '../src/traditional-timber/examples.mjs';
import {compileVersionedAssemblyRebuild} from '../src/detailed-modeling/assembly-edit.mjs';
import {SketchUpBridge} from '../src/bridge.mjs';
import {planDefinitionParameterEdit} from '../src/model-accessibility-parameter-edit.mjs';
import {buildModelGraph} from '../src/model-graph.mjs';
import {adoptParameterRoots} from '../src/model-accessibility-scoped-readback.mjs';
import {compileTraditionalScenePlan,assertTraditionalSceneVerification} from '../src/traditional-timber/scene-plan.mjs';
import {boxMesh,mergeMeshes} from '../src/traditional-timber/assembly-mesh.mjs';
import {sha256Canonical} from '../src/agent-contract.mjs';
import {freezeDetailSpecification} from '../src/detail-quality.mjs';
import {geometryDistance} from '../src/model-geometry-service.mjs';

const a=straightCorridorTask('test-corridor'),base=compile(a,{limits:{max_operations:100,max_affected_instances:200}});
assert.deepEqual([base.bundle.rule_expected_values.column_count,base.bundle.rule_expected_values.total_path_length_mm],[10,12000]);
const changed=structuredClone(a);changed.parameters.bay_lengths_mm[1]=3300;const next=compile(changed);
assert.equal(next.bundle.rule_expected_values.total_path_length_mm,12300);
const layout=solveTraditionalLayout(changed.assembly.layout,changed.parameters);
assert.deepEqual(layout.columns.filter(c=>c.side===1).map(c=>c.point[0]),[0,3000,6300,9300,12300]);
assert.deepEqual(parameterImpactSet(a.assembly,{bay_lengths_mm:[3000,3300,3000,3000]}),['eave','frame','roof','seat']);
const staged=compileVersionedAssemblyRebuild({previousDsl:base.bundle.dsl,nextDsl:next.bundle.dsl,selections:[{logical_definition:'PG2_test-corridor',target:{target_id:'selected'}}],expectedModelRevision:`sha256:${"c".repeat(64)}`,existingDefinitionMap:Object.fromEntries(base.bundle.dsl.operations.filter(o=>o.op==='component_definition').map(o=>[o.name,o.name])),scope:'single',taskId:'task_11111111-1111-4111-8111-111111111111'});
assert.deepEqual(staged.operations.map(o=>o.target_id),['selected']);assert.ok(staged.reused_definition_count>0);
assert.ok(base.preflight.normalized.operation_count<=100);assert.ok(base.preflight.normalized.resource_estimate.faces<50000);
const costly=structuredClone(a);costly.instances=Array.from({length:12},(_,i)=>({id:`copy-${i}`,origin_mm:[0,i*4000,0]}));delete costly.placement;
assert.ok(preflight(costly).issues.some(i=>i.code==='RESOURCE_BUDGET'),'generic input must not inherit the trusted fixed-hall budget');
const invalid=structuredClone(a);invalid.parameters.bay_lengths_mm[1]=-1;assert.equal(preflight(invalid).ok,false);
const missing=structuredClone(a);missing.assembly.connections=[];assert.equal(preflight(missing).ok,false);
const stale=structuredClone(a);stale.assembly.rule_bindings=[{id:'contemporary-chinese-v1',version:1,hash:`sha256:${'0'.repeat(64)}`}];assert.ok(preflight(stale).issues.some(i=>i.code==='RULE_BINDING_MISMATCH'));

// Independent 45-degree node coordinates, rather than generated mesh as oracle.
const corner=cornerCorridorTask('test-corner'),l=solveTraditionalLayout(corner.assembly.layout,corner.parameters);
assert.equal(l.columns.length,10);assert.deepEqual(l.columns.filter(c=>c.station_id==='joint-run-return').map(c=>c.point),[[7000,-1000,0],[5000,1000,0]]);
const f={height:2800,purlin_height:100,layout:l},p=roofDimensions({rise_mm:650,eave_projection_mm:450},f),r=solveRoofFaces(l,p,f);
const left=r.faces.find(v=>v.id==='run-left'),out=r.faces.find(v=>v.id==='return-left');
for(const v of [0,1000,1450])assert.deepEqual(left.point(6000-v,v),out.point(v,v),'both slopes must share the exact miter boundary');
const short=structuredClone(corner);short.parameters.return_bays_mm=[1000];assert.equal(preflight(short).ok,false);
const pavilion=squarePavilionTask('test-pavilion'),b=compile(pavilion);assert.equal(b.bundle.rule_expected_values.column_count,4);
const n=normalizeTraditionalAssembly(pavilion.assembly,pavilion.parameters),pl=solveTraditionalLayout(n.plan.layout,n.parameters),pr=solveRoofFaces(pl,roofDimensions(n.plan.assemblies[1].parameters,{...f,layout:pl}),{...f,layout:pl});
assert.equal(pr.faces.length,4);assert.ok(pr.faces.every(face=>JSON.stringify(face.point(0,0))===JSON.stringify(pr.faces[0].point(0,0))));
const triangles=mesh=>mesh.faces.flatMap(face=>Array.from({length:face.length-2},(_,i)=>[mesh.vertices[face[0]],mesh.vertices[face[i+1]],mesh.vertices[face[i+2]]]));
const pavilionBoards=b.bundle.part_graph.parts.find(part=>part.id==='test-pavilion-roof-boards-geometry').shape.parameters;
for(const [i,face] of pavilionBoards.faces.entries())if(pavilionBoards.cad_faces[i]===1) {
 const center=[0,1,2].map(k=>face.reduce((sum,index)=>sum+pavilionBoards.vertices[index][k],0)/face.length);
 const expected=4118-1100*center[1]/1800+60*(Math.max(0,center[1]-1800)/500)**2;
 assert.ok(Math.abs(center[2]-expected)<.5,'hip board facets must follow the selected surface, below the 7 mm tile clearance');
}
const contact={points:[[0,-1800,2900]],segments:[],triangles:[]};
for(const key of ['roof-purlins','eave-rafters']) {
 const mesh=b.bundle.part_graph.parts.find(part=>part.id===`test-pavilion-${key}-geometry`).shape.parameters;
 assert.equal(geometryDistance(contact,{points:[],segments:[],triangles:triangles(mesh)},10000),0,'square corner needs both a purlin and a touching hip/rafter section');
}
const moon=compile(moonWallTask());assert.equal(moon.bundle.detail_spec.required_voids.length,1);assert.equal(moon.bundle.part_graph.parts.find(p=>p.shape?.primitive==='profile_extrude').shape.parameters.holes[0].length,32);
const unsupported=structuredClone(pavilion);unsupported.assembly.assemblies[1].parameters={type:'xieshan',storeys:2,plan_sides:6};const gap=preflight(unsupported);
assert.equal(gap.ok,false);assert.equal(gap.compilation_gap.status,'unsupported_topology');assert.equal(gap.compilation_gap.proposal.execution_started,false);
const fen=structuredClone(a);fen.assembly.mode='song_informed';fen.parameters.fen_mm=10;fen.parameters.column_height_mm=280;fen.assembly.parameter_units={column_height_mm:'fen'};
assert.equal(buildTraditionalAssemblyRecipe({id:fen.id,assembly:fen.assembly,parameters:fen.parameters}).parts.find(p=>p.shape?.primitive==='cylinder').shape.parameters.height,2800);
assert.equal(preflight({...fen,parameters:{...fen.parameters,fen_mm:0}}).ok,false);
assert.throws(()=>compileTraditionalScenePlan({version:1,id:'too-many',units:'mm',roots:Array.from({length:9},(_,i)=>({...a,id:`root-${i}`}))}),/1..8/);
const courtyard=compileTraditionalScenePlan(courtyardScenePlan());assert.equal(courtyard.jobs.length,8);assert.ok(courtyard.resource_estimate.edges<120000);
// Native mesh construction rejects coincident endpoints, even when they use
// different indices. Coincident pyramid/miter clipping kinks must not emit
// zero-width tile strips in any of the public engineering samples.
for(const task of [pavilion,corner,...courtyard.jobs.map(job=>job.task),...compileTraditionalScenePlan(unpresetScenePlan()).jobs.map(job=>job.task)]) {
 for(const part of compile(task).bundle.part_graph.parts.filter(part=>part.shape?.primitive==='mesh')) {
  const mesh=part.shape.parameters;
  for(const face of mesh.faces)for(let i=0;i<face.length;i++) {
   const distance=Math.hypot(...mesh.vertices[face[i]].map((v,k)=>v-mesh.vertices[face[(i+1)%face.length]][k]));
   assert.ok(distance>2.54e-9,`${part.id} contains a zero-length native edge`);
  }
 }
}
const wrongCamera=courtyardScenePlan('invalid-camera');wrongCamera.view.camera.perspective=true;assert.throws(()=>compileTraditionalScenePlan(wrongCamera),/native eye/);
assert.equal(compile(courtyard.jobs[0].task).bundle.detail_spec.deferred_scene_overview,true);assert.equal(compile(courtyard.jobs[0].task).bundle.views.length,0);
assert.equal(compileTraditionalScenePlan(unpresetScenePlan()).jobs.length,3);
const tagged=boxMesh([0,0,0],[100,100,100]),merged=mergeMeshes([tagged,tagged]);
assert.equal(tagged.cad_faces[0],tagged.cad_faces[1]);assert.notEqual(tagged.cad_faces[0],tagged.cad_faces[4]);assert.notEqual(merged.cad_faces[0],merged.cad_faces[tagged.faces.length]);

// Exercise persisted public creation + parameter discovery/planning on a small
// mock fixture. Native geometry and review execution are separate acceptance.
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'traditional-assembly-'));
try{
 const bridge=new SketchUpBridge({agentContract:{rootDir:path.join(dir,'tasks')},mock:{sessionPath:path.join(dir,'mock.json')}});
 const small=straightCorridorTask('source-corridor');small.parameters={bay_lengths_mm:[1500],width_mm:1000,column_height_mm:2800,rise_mm:300,eave_mm:250};
 Object.assign(small.assembly.assemblies[1].parameters,{tile_pitch_mm:1000,tile_length_mm:1000,rafter_spacing_mm:1000});
 small.instances=[{id:'selected-source',origin_mm:[0,0,0]},{id:'shared-source',origin_mm:[0,4000,0]}];delete small.placement;
 const result=await bridge.start_agent_task({intent:'create_model',instruction:'Test persisted generic source.',idempotency_key:'generic-source',inputs:{runtime:'mock',task:small}});
 const task=await bridge.taskStore.getTask(result.task_id,{includePrivate:true});
 assert.equal(task.private.creation.parameter_edit_support.baseline_captured,true,JSON.stringify(task.private.creation.parameter_edit_support));
 const discovery=await bridge.start_agent_task({intent:'discover',instruction:'Find stored parameter sources.',inputs:{topic:'parameter_sources',runtime:'mock'}});
 const discoveryTask=await bridge.taskStore.getTask(discovery.task_id,{includePrivate:true});assert.ok(discoveryTask.result.sources[0].supported_parameters.includes('bay_lengths_mm'));
 const record=task.private.creation.parameter_source,target=record.entries[0].target;
 const model=buildModelGraph(await adoptParameterRoots({bridge,runtime:'mock',recursiveLimit:5000,rootIds:record.entries.map(entry=>entry.target.target_id)}));
 const edit=planDefinitionParameterEdit({sourceRecord:record,currentModelGraph:model,request:{creation_task_id:result.task_id,scope:'single',targets:[target],changes:{bay_lengths_mm:[1800]}},taskId:'task_22222222-2222-4222-8222-222222222222',instruction:'Edit only selected source root.'});
 assert.equal(edit.ready,true,JSON.stringify(edit));assert.deepEqual(edit.selected_instances,['selected-source']);assert.equal(edit.next_source.rendering_version,'traditional-render.v1');
 assert.throws(()=>planDefinitionParameterEdit({sourceRecord:record,currentModelGraph:model,request:{creation_task_id:result.task_id,scope:'single',targets:[target],changes:{bay_lengths_mm:[900,900]}},taskId:'task_33333333-3333-4333-8333-333333333333'}),/topology change/);
 assert.equal(task.result?.quality_accepted,false,'mock cannot establish native acceptance');
 const scene={version:1,id:'mock-scene',units:'mm',roots:[referenceTask('mock-scene-reference')],view:{id:'mock-scene-overview',camera:{eye:[2000,-2000,1500],target:[250,250,250],up:[0,0,1]}}};
 const request={intent:'create_model',instruction:'Exercise durable independent scene dispatch.',idempotency_key:'mock-scene-v1',inputs:{runtime:'mock',scene_plan:scene}};
 const dispatch=await bridge.start_agent_task(request),parent=await bridge.taskStore.getTask(dispatch.task_id);
 assert.equal(parent.result.state,'mock_geometry_created');assert.equal(parent.result.quality_accepted,false);assert.equal(parent.result.roots.length,1);
 const replay=await bridge.start_agent_task(request);assert.equal(replay.task_id,dispatch.task_id);
 const altered=structuredClone(scene);altered.roots[0].placement.origin_mm[0]=10;
 const rejected=await bridge.start_agent_task({...request,idempotency_key:'altered-scene',inputs:{runtime:'mock',scene_plan:altered}});assert.equal(rejected.ok,false);
 // Isolated server-proof fixture only: queue-shaped metadata is not native
 // evidence. Delivery must reject either an advanced source or a tampered body
 // even when the attacker leaves the previous source_record_hash unchanged.
 const sceneFile=path.join(bridge.taskStore.rootDir,'traditional-scenes-v1',scene.id+'.json');
 const {integrity_hmac:oldHmac,...state}=JSON.parse(await fs.readFile(sceneFile));state.runtime='queue';
 await fs.writeFile(sceneFile,JSON.stringify({...state,integrity_hmac:await bridge.taskStore.mutationReceiptLedger.sign(state)}));
 const child=await bridge.taskStore.getTask(parent.result.roots[0].creation_task_id,{includePrivate:true});
 // The zero-parameter mock reference has no captured edit source. Supply the
 // real persisted mock corridor record as synthetic proof metadata only.
 child.private.creation.parameter_source=structuredClone(record);
 await bridge.taskStore.update(child.task_id,{private:child.private});
 const frozen=freezeDetailSpecification(compile(child.inputs.task).bundle.detail_spec),revision='sha256:'+ '1'.repeat(64);
 const proofBody={version:'traditional-scene-verification.v1',scene_id:scene.id,scene_plan_hash:state.scene_plan_hash,specification_hash:frozen.hash,model_revision:revision,members:[{creation_task_id:child.task_id,source_record_hash:child.private.creation.parameter_source.source_record_hash}]};
 const verification={private:{creation:{frozen_spec:frozen,round:{snapshot:{model_revision:revision}}},traditional_scene_verification:{...proofBody,integrity_hmac:await bridge.taskStore.mutationReceiptLedger.sign(proofBody)}}};
 assert.equal(await assertTraditionalSceneVerification({source:verification,taskStore:bridge.taskStore}),true);
 const tampered=structuredClone(child.private);tampered.creation.parameter_source.entries[0].source.task.parameters.width_mm+=100;
 await bridge.taskStore.update(child.task_id,{private:tampered});
 await assert.rejects(assertTraditionalSceneVerification({source:verification,taskStore:bridge.taskStore}),/parameters changed/);
 const {source_record_hash:previousHash,...advancedBody}=tampered.creation.parameter_source;
 tampered.creation.parameter_source.source_record_hash=sha256Canonical(advancedBody);
 await bridge.taskStore.update(child.task_id,{private:tampered});
 await assert.rejects(assertTraditionalSceneVerification({source:verification,taskStore:bridge.taskStore}),/parameters changed/);
}finally{await fs.rm(dir,{recursive:true,force:true});}
console.log('Traditional assembly: shared layout/miter/apex, true opening, normal budgets, source binding, stored discovery and isolated root planning passed. Native acceptance is separate.');
