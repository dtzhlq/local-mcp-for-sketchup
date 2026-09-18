#!/usr/bin/env node
// Dedicated fixture only. Scope the existing server approval policy to this QA directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {SketchUpBridge} from '../src/bridge.mjs';
const root=path.resolve('output/modeling-uplift/native');
await fs.mkdir(root,{recursive:true});
const bridge=new SketchUpBridge({agentContract:{rootDir:path.join(root,'tasks')},approval:{stateDir:path.join(root,'approval')},executionPolicy:{allowed_runtimes:['queue','mock'],allow_queue_mutation:true,allow_direct_expert_queue_mutation:true,trusted_model_copy_auto_approval:{enabled:true,allowed_roots:[root],allowed_risks:['S1','S2','S3','S4'],max_affected_instances:20,allow_save_model:true}}});
const mode=process.argv[2]??'inspect';
const write=async(name,value)=>{await fs.writeFile(path.join(root,name+'.json'),JSON.stringify(value,null,2));return value;};
const mutate=(operation,args)=>bridge.withFreshQueueMutationAuthorization({operation,timeoutMs:30000},b=>b[operation]({...args,runtime:'queue',timeoutMs:30000}));
try{
if(mode==='open'){await write('reopened',await mutate('open_model',{path:path.join(root,'modeling-uplift.skp')}));}
if(mode==='create'){
 const model=await bridge.get_model_info({runtime:'queue'});
 // Never reset or replace an existing saved model.
 assert.ok(!model.path && !model.file_path, 'A new unsaved fixture window is required');
 const ops=[
 {op:'sweep_profile',name:'Sweep_3D',id:'uplift-sweep',profile:[[-12,-8],[12,-8],[12,8],[-12,8]],path:[[0,0,0],[0,0,80],[40,0,140],[80,40,190]],initial_up:[1,0,0],scale_stations:[{t:0,value:1},{t:1,value:0.7}],twist_stations:[{t:0,value:0},{t:1,value:30}]},
 {op:'loft_profiles_v2',name:'Loft_Unequal',id:'uplift-loft',profiles:[[[160,0,0],[240,0,0],[240,70,0],[160,70,0]],[[170,10,100],[210,0,100],[235,30,100],[210,60,100],[170,55,100]]]},
 {op:'component_definition',name:'Uplift_Inner',operations:[{op:'box',name:'Shared_Core',origin:[0,0,0],size:[60,40,80]}]},
 {op:'component_definition',name:'Uplift_Outer',operations:[{op:'component_instance',name:'Nested_Core',definition:'Uplift_Inner',origin:[0,0,0],transform:{rotateZ:25}}]},
 {op:'component_instance',name:'Shared_Target',id:'uplift-shared-target',definition:'Uplift_Outer',origin:[350,0,0],transform:{rotateZ:20}},
 {op:'component_instance',name:'Shared_Control',id:'uplift-shared-control',definition:'Uplift_Outer',origin:[480,0,0]},
 {op:'sweep_profile',name:'Program_Base',id:'uplift-program',profile:[[0,0],[60,0],[60,50],[0,50]],path:[[0,220,0],[0,220,80]],initial_up:[1,0,0]},
 {op:'sweep_profile',name:'Failure_Control',id:'uplift-failure',profile:[[0,0],[40,0],[40,40],[0,40]],path:[[180,220,0],[180,220,60]],initial_up:[1,0,0]},
 {op:'camera',eye:[1000,-1000,900],target:[230,100,70],up:[0,0,1]}
 ];
 await write('creation',await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:ops})}));
 await write('saved-initial',await mutate('save_model',{path:path.join(root,'modeling-uplift.skp')}));
}
if(mode==='program'){
 const handshake=await bridge.create_queue_handshake();
 const args={runtime:'queue',session_contract:handshake.session_contract,idempotency_key:'native-program-v2',stages:[
  {kind:'create',code:"const operations=[];for(let i=0;i<2;i++){operations.push({op:'mesh',name:'Program_Stage_'+i,id:'uplift-stage-'+i,vertices:[[350+i*100,220,0],[430+i*100,220,0],[430+i*100,280,0],[350+i*100,280,0]],faces:[[0,1,2,3]]});} ({operations,result:{name:'Program_Stage_0'}});"},
  {kind:'edit',code:"const c=snapshot.contexts.find(c=>c.name===previous.name); ({entity_path:c.entity_path,edits:[{op:'add_edges',points:[[390,220,0],[390,280,0]]}],result:previous});"},
  {kind:'edit',code:"const c=snapshot.contexts.find(c=>c.name===previous.name);const f=c.faces.find(f=>f.loops[0].vertices.every(h=>c.vertices.find(v=>v.handle===h).position[0]>=389.99));({entity_path:c.entity_path,edits:[{op:'pushpull_face',handle:f.handle,distance:60}],result:{face_count_after_split:c.faces.length}});"}
 ]};
 const result=await write('program',await bridge.run_model_program(args));
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.task_state,'completed',JSON.stringify(result));
}
if(mode==='failure'){
 const before=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 const c=before.snapshot.contexts.find(c=>c.name==='Failure_Control');
 let failed=false;
 try{await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:[{op:'edit_geometry',entity_path:c.entity_path,snapshot_revision:before.model_revision,edits:[{op:'move_vertices',moves:[{handle:c.vertices[0].handle,delta:[2,0,0]}]},{op:'set_face_material',handle:c.faces[0].handle,material:'Missing_Uplift_Material'}]}]})});}catch(e){failed=true;await write('rollback-error',{code:e.code,message:e.message,details:e.details});}
 assert.equal(failed,true,'Controlled failure must reject');
 const after=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 assert.equal(after.model_revision,before.model_revision,'Atomic failure must restore the revision');
 assert.deepEqual(after.snapshot.contexts.find(x=>x.entity_path===c.entity_path),c,'Atomic failure must restore all geometry');
 const stale=JSON.parse(await fs.readFile(path.join(root,'query-edit.json'),'utf8'));
 await assert.rejects(()=>bridge.edit_model_geometry({runtime:'queue',snapshot_handle:stale.snapshot_handle,entity_path:stale.contexts.find(c=>c.name==='Failure_Control').entity_path,edits:[{op:'reverse_face',handle:c.faces[0].handle}],idempotency_key:'native-stale-reject'}),e=>e.code==='MODEL_REVISION_MISMATCH');
 await write('failure-checks',{rollback:true,stale_reference_rejected:true,model_revision:after.model_revision});
}
if(mode==='extras'){
 const L=[[0,0],[80,0],[80,40],[40,40],[40,80],[0,80]];
 const rings=[L.map(([x,y])=>[x+180,y+390,0]),[[0,0],[40,0],[80,0],[80,40],[40,40],[40,80],[0,80]].map(([x,y])=>[x+185,y+400,70])];
 const loop=Array.from({length:17},(_,i)=>[70+65*Math.cos(i*Math.PI/8),450+65*Math.sin(i*Math.PI/8),60]);
 const operations=[{op:'sweep_profile',name:'Sweep_Closed',profile:[[-5,-5],[5,-5],[5,5],[-5,5]],path:loop,initial_up:[0,0,1]},
 {op:'loft_profiles_v2',name:'Loft_Concave',profiles:rings},
 {op:'box',name:'Transform_Control',origin:[0,0,0],size:[10,20,30],transform:{matrix:[-2,0,0,0,0,3,0,0,0,0,0.5,0,650,0,0,1]}}];
 await write('extras-creation',await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations})}));
 const read=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 const names=['Loft_Concave','Transform_Control'];
 const measurement=await write('extras-measurements',await bridge.measure_model_geometry({snapshot_handle:read.snapshot_handle,queries:names.map(name=>({kind:'volume',entity_path:read.contexts.find(c=>c.name===name).entity_path}))}));
 assert.ok(Math.abs(measurement.results[0].value-336000)<1e-5);
 assert.ok(Math.abs(measurement.results[1].value-18000)<1e-5);
 assert.equal(read.contexts.find(c=>c.name==='Sweep_Closed').manifold,true);
}
if(mode==='matrix'){
 await write('matrix-creation',await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:[{op:'box',name:'Transform_Verified',origin:[0,0,0],size:[10,20,30],transform:{matrix:[-2,0,0,0,0,3,0,0,0,0,0.5,0,650,0,0,1]}}]})}));
 const read=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 const c=read.snapshot.contexts.find(c=>c.name==='Transform_Verified');
 const measurements=await write('matrix-measurements',await bridge.measure_model_geometry({snapshot_handle:read.snapshot_handle,queries:[{kind:'volume',entity_path:c.entity_path}]}));
 assert.ok(Math.abs(measurements.results[0].value-18000)<1e-5);
 assert.ok(Math.abs(Math.min(...c.vertices.map(v=>v.world_position[0]))-630)<1e-5);
 assert.equal(read.contexts.find(c=>c.name==='Sweep_Closed').manifold,true);
 await write('matrix-checks',{volume_mm3:measurements.results[0].value,mirror_nonuniform_transform:true,closed_sweep_manifold:true});
}
if(mode==='generation-edit'){
 const before=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 const c=before.snapshot.contexts.find(c=>c.name==='Loft_Unequal');
 const args={runtime:'queue',snapshot_handle:before.snapshot_handle,entity_path:c.entity_path,idempotency_key:'native-loft-edit-v1',edits:[{op:'move_vertices',moves:c.vertices.filter(v=>v.position[2]>99).map(v=>({handle:v.handle,delta:[0,0,10]}))}]};
 const edited=await write('loft-edit',await bridge.edit_model_geometry(args));
 assert.equal(edited.task_state,'completed',JSON.stringify(edited));
 const after=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 const replay=await write('receipt-replay',await bridge.edit_model_geometry(args));
 const final=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 assert.equal(replay.task_id,edited.task_id);assert.equal(final.model_revision,after.model_revision);
 const changed=final.snapshot.contexts.find(x=>x.name==='Loft_Unequal');
 assert.ok(changed.vertices.some(v=>Math.abs(v.position[2]-110)<1e-6));
 assert.equal(changed.manifold,true);
 await write('generation-edit-checks',{generated_loft_edited:true,still_manifold:true,receipt_replay_no_mutation:true,model_revision:final.model_revision});
}
if(mode==='views'){
 for(const view of ['top','front'])await write('capture-'+view,await mutate('capture_view',{path:path.join(root,view+'.png'),view,width:1600,height:1000,zoom_extents:true}));
 await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:[{op:'camera',eye:[950,-950,1050],target:[310,210,70],up:[0,0,1]}]})});
 await write('saved-final',await mutate('save_model',{path:path.join(root,'modeling-uplift.skp')}));
}
if(mode==='persistence'){
 const before=JSON.parse(await fs.readFile(path.join(root,'query-views.json'),'utf8'));
 const after=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 assert.equal(after.model_revision,before.model_revision);
 const canonical=(value,key='')=>{
  if(typeof value==='number')return Math.round(value*1e7)/1e7;
  if(Array.isArray(value)){
   const result=value.map(v=>canonical(v));
   if(['edges','faces'].includes(key)&&result.every(v=>typeof v==='string'))result.sort();
   if(result.every(v=>v&&typeof v==='object'&&(v.handle||v.entity_path)))result.sort((a,b)=>(a.handle||a.entity_path).localeCompare(b.handle||b.entity_path));
   return result;
  }
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonical(v,k)]));
  return value;
 };
 assert.equal(JSON.stringify(canonical(after.snapshot.contexts)),JSON.stringify(canonical(before.snapshot.contexts)),'Persistent topology, adjacency and coordinates must agree within 1e-7');
 assert.notEqual(after.snapshot.document_id,before.snapshot.document_id);
 await write('persistence-checks',{saved_reopened:true,new_document_id:true,all_contexts_equivalent:true,numeric_tolerance:1e-7,model_revision:after.model_revision,contexts:after.contexts.length});
}
if(mode==='finalize'){
 const before=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 const discard=before.contexts.filter(c=>['Program_Split_0','Program_Split_1','Transform_Control'].includes(c.name)||c.entity_path==='pid:41159');
 await write('fixture-cleanup',await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:[...discard.map(c=>({op:'delete',entity_path:c.entity_path,edit_scope:'instance_path',instance_policy:'definition_wide',confirmed:true})),{op:'camera',eye:[950,-950,1050],target:[310,210,70],up:[0,0,1]}]})}));
 const final=await bridge.query_model_geometry({runtime:'queue',detail:'full'});
 const modified=final.snapshot.contexts.find(c=>c.name==='Program_Stage_0');
 const control=final.snapshot.contexts.find(c=>c.name==='Program_Stage_1');
 assert.ok(modified.vertices.some(v=>Math.abs(v.position[2]-60)<1e-6));
 assert.ok(control.vertices.every(v=>Math.abs(v.position[2])<1e-6));
 await write('program-readback-checks',{split_then_pushpull_height_mm:60,unselected_patch_unchanged:true});
 await write('saved-final',await mutate('save_model',{path:path.join(root,'modeling-uplift.skp')}));
 await write('capture-final',await mutate('capture_view',{path:path.join(root,'overview.png'),width:1600,height:1000}));
}
const q=await write('query-'+mode,await bridge.query_model_geometry({runtime:'queue',detail:'full',max_vertices:100000}));
if(mode==='edit'){
 const target=q.snapshot.contexts.find(c=>c.name==='Shared_Core'&&c.entity_path.startsWith(q.contexts.find(x=>x.name==='Shared_Target').entity_path+'.'));
 const control=q.snapshot.contexts.find(c=>c.name==='Shared_Core'&&c.entity_path.startsWith(q.contexts.find(x=>x.name==='Shared_Control').entity_path+'.'));
 const top=target.vertices.filter(v=>v.position[2]>79);
 let edited=await write('shared-edit',await bridge.edit_model_geometry({runtime:'queue',snapshot_handle:q.snapshot_handle,entity_path:target.entity_path,edits:[{op:'move_vertices',moves:top.map(v=>({handle:v.handle,delta:[0,0,20]}))}],idempotency_key:'native-shared-edit-1'}));
 if(edited.next_action?.action==='prepare_new_plan'){
  const refreshed=await bridge.submit_agent_task_input({task_id:edited.task_id,idempotency_key:'native-refresh:'+process.pid,input:{}});
  edited=await write('shared-edit',await bridge.geometryService.advanceAutomaticEdit(refreshed,{idempotency_key:'native-shared-edit-1'},'queue'));
 }
 if(edited.error?.code==='HANDSHAKE_REQUIRED'){const h=await bridge.create_queue_handshake();edited=await write('shared-edit',await bridge.submit_agent_task_input({task_id:edited.task_id,idempotency_key:'native-shared-edit-1:handshake',input:{session_contract:h.session_contract}}));}
 assert.equal(edited.ok,true,JSON.stringify(edited));assert.equal(edited.task_state,'completed',JSON.stringify(edited));
 const after=await write('shared-after',await bridge.query_model_geometry({runtime:'queue',detail:'full'}));
 const unchanged=after.snapshot.contexts.find(c=>c.entity_path===control.entity_path);
 assert.deepEqual(unchanged.vertices,control.vertices,'Sibling occurrence must remain unchanged');
 const changed=after.snapshot.contexts.find(c=>c.name==='Shared_Core'&&c.entity_path.startsWith(q.contexts.find(x=>x.name==='Shared_Target').entity_path+'.'));
 assert.ok(changed.vertices.some(v=>Math.abs(v.position[2]-100)<1e-6),'Target top moved exactly 20mm');
 await write('shared-measurements',await bridge.measure_model_geometry({snapshot_handle:after.snapshot_handle,queries:[{kind:'volume',entity_path:changed.entity_path},{kind:'volume',entity_path:control.entity_path}]}));
}
console.log(JSON.stringify({mode,complete:q.complete,contexts:q.contexts,snapshot_handle:q.snapshot_handle}));
}catch(error){await write('failure-'+mode,{code:error.code,message:error.message,details:error.details,stack:error.stack});console.error(error.stack);process.exitCode=1;}
