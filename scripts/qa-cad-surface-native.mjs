import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {SketchUpBridge} from '../src/bridge.mjs';import {sha256Canonical} from '../src/agent-contract.mjs';
const root=path.resolve('output/cad-surface-kernel/native');await fs.mkdir(root,{recursive:true});
const b=new SketchUpBridge({agentContract:{rootDir:path.join(root,'tasks')},approval:{stateDir:path.join(root,'approval')},executionPolicy:{allowed_runtimes:['queue','mock'],allow_queue_mutation:true,allow_direct_expert_queue_mutation:true,trusted_model_copy_auto_approval:{enabled:true,allowed_roots:[root],allowed_risks:['S1','S2','S3','S4'],max_affected_instances:20,allow_save_model:true}}});
const mode=process.argv[2],modelPath=path.join(root,'cad-surfaces.skp');
const write=async(name,x)=>{await fs.writeFile(path.join(root,name+'.json'),JSON.stringify(x,null,2));return x;};
const mutate=(method,args)=>b.withFreshQueueMutationAuthorization({operation:method,timeoutMs:60000},live=>live[method]({...args,runtime:'queue',timeoutMs:60000}));
if(mode==='setup'){
 const info=await b.get_model_info({runtime:'queue'});assert.ok(!info.source_path&&!info.path,'Setup requires the new unsaved QA window');
 await write('setup-before',info);await write('setup-reset',await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:[{op:'reset'}]})}));await write('setup-save',await mutate('save_model',{path:modelPath}));
}else{
 const info=await b.get_model_info({runtime:'queue'});assert.equal(info.source_path??info.path,modelPath);
 if(mode==='program'){
  const q=await b.query_model_geometry({runtime:'queue',detail:'full'});assert.ok(!q.snapshot.contexts.some(c=>c.name==='NURBS_QuarterCylinder'),'Never replay fixture creation');
  const n=JSON.parse(await fs.readFile('examples/cad-kernel/nurbs.json'));const f=JSON.parse(await fs.readFile('examples/cad-kernel/curved-fillet.json'));f.transform={translate:[200,0,50]};
  const control={...structuredClone(n),name:'CAD_Stale_Control',transform:{translate:[400,0,0]}};
  const updatedN=structuredClone(n.recipe);updatedN.nodes[0].poles.forEach(row=>row[1][2]=60);const updatedF=structuredClone(f.recipe);updatedF.nodes.at(-1).radius=4;
  const h=await b.create_queue_handshake();const result=await write('program',await b.run_model_program({runtime:'queue',session_contract:h.session_contract,idempotency_key:'cad-combined-program',parameters:{operations:[n,f,control],updatedN,updatedF},stages:[
   {kind:'create',code:'({operations:parameters.operations,result:{created:true}});'},
   {kind:'edit',code:"const c=snapshot.contexts.find(c=>c.name==='NURBS_QuarterCylinder');({entity_path:c.entity_path,edits:[{op:'replace_cad',recipe:parameters.updatedN}],result:{nurbs_updated:true}});"},
   {kind:'edit',code:"const c=snapshot.contexts.find(c=>c.name==='CAD_CurvedIntersection');({entity_path:c.entity_path,edits:[{op:'replace_cad',recipe:parameters.updatedF}],result:{both_updated:true}});"}
  ]}));assert.equal(result.task_state,'completed',JSON.stringify(result));
 }
 if(mode==='nurbs-solid'){
  const before=await b.query_model_geometry({runtime:'queue',detail:'full'});assert.ok(!before.snapshot.contexts.some(c=>c.name==='NURBS_Solid_Fillet'));
  const op=JSON.parse(await fs.readFile('examples/cad-kernel/nurbs-solid-fillet.json'));op.transform={translate:[150,200,0]};
  const h=await b.create_queue_handshake();const task=await write('nurbs-solid-task',await b.run_model_program({runtime:'queue',session_contract:h.session_contract,idempotency_key:'cad-nurbs-solid',parameters:{operation:op},stages:[{kind:'create',code:'({operations:[parameters.operation]});'}]}));assert.equal(task.task_state,'completed',JSON.stringify(task));
  const after=await b.query_model_geometry({runtime:'queue',detail:'full'}),c=after.snapshot.contexts.find(c=>c.name===op.name);assert.ok(c.cad.current&&c.manifold);for(const old of before.snapshot.contexts)assert.equal(sha256Canonical(after.snapshot.contexts.find(x=>x.entity_path===old.entity_path)),sha256Canonical(old));
  const measurement=await b.measure_model_geometry({runtime:'queue',snapshot_handle:after.snapshot_handle,queries:[{kind:'volume',entity_path:c.entity_path}]});const value=measurement.results[0].value;assert.equal(measurement.results[0].status,'available');const relative=Math.abs(value/c.cad.evidence.volume_mm3-1);assert.ok(relative<0.02);
  await write('nurbs-solid-checks',{ok:true,nurbs_patches:6,sewn_closed_solid:true,curved_edges:op.recipe.nodes.at(-1).edges,fillet_radius_mm:3,native_volume_mm3:value,exact_cad_volume_mm3:c.cad.evidence.volume_mm3,relative_volume_error:relative,unrelated_geometry_unchanged:true});
 }
 if(mode==='verify'){
  const q=await b.query_model_geometry({runtime:'queue',detail:'full'});await write('geometry',q);
  const n=q.snapshot.contexts.find(c=>c.name==='NURBS_QuarterCylinder'),f=q.snapshot.contexts.find(c=>c.name==='CAD_CurvedIntersection');assert.ok(n.cad.current&&f.cad.current);assert.equal(n.cad.recipe.nodes[0].poles[0][1][2],60);assert.equal(f.cad.recipe.nodes.at(-1).radius,4);
  assert.ok(Math.abs(Math.max(...n.vertices.map(v=>v.position[2]))-60)<1e-7);for(const v of n.vertices)assert.ok(Math.abs(Math.hypot(...v.position.slice(0,2))-30)<1e-6);
  assert.ok(f.manifold);const measures=await b.measure_model_geometry({runtime:'queue',snapshot_handle:q.snapshot_handle,queries:[{kind:'volume',entity_path:f.entity_path}]});const m=measures.results[0];assert.equal(m.status,'available');const relative=Math.abs(m.value/f.cad.evidence.volume_mm3-1);assert.ok(relative<0.02);
  const invalid=structuredClone(f.cad.recipe);invalid.nodes.at(-1).radius=500;await assert.rejects(()=>b.edit_model_geometry({runtime:'queue',snapshot_handle:q.snapshot_handle,entity_path:f.entity_path,edits:[{op:'replace_cad',recipe:invalid}],idempotency_key:'cad-impossible-radius'}),/CAD_GEOMETRY_FAILED/);
  const after=await b.query_model_geometry({runtime:'queue',detail:'full'});assert.equal(after.model_revision,q.model_revision);
  await write('geometry-checks',{ok:true,nurbs_radius_mm:30,nurbs_updated_height_mm:60,fillet_updated_radius_mm:4,closed_native_manifold:true,native_volume_mm3:m.value,exact_cad_volume_mm3:f.cad.evidence.volume_mm3,relative_volume_error:relative,impossible_radius_preserves_model:true});
 }
 if(mode==='stale'){
  const q=await b.query_model_geometry({runtime:'queue',detail:'full'}),c=q.snapshot.contexts.find(c=>c.name==='CAD_Stale_Control');assert.ok(c.cad.current,'Do not replay invalidation');
  const edit=await write('local-vertex-edit',await b.edit_model_geometry({runtime:'queue',snapshot_handle:q.snapshot_handle,entity_path:c.entity_path,edits:[{op:'move_vertices',moves:[{handle:c.vertices[0].handle,delta:[1,0,0]}]}],idempotency_key:'cad-invalidate-control'}));assert.equal(edit.task_state,'completed');
  const after=await b.query_model_geometry({runtime:'queue',detail:'full'}),modified=after.snapshot.contexts.find(x=>x.name===c.name);assert.equal(modified.cad.current,false);
  await assert.rejects(()=>b.edit_model_geometry({runtime:'queue',snapshot_handle:after.snapshot_handle,entity_path:modified.entity_path,edits:[{op:'replace_cad',recipe:c.cad.recipe}],idempotency_key:'cad-reject-stale-source'}),/current parametric/);
  for(const old of q.snapshot.contexts.filter(x=>x.name!==c.name))assert.equal(sha256Canonical(after.snapshot.contexts.find(x=>x.entity_path===old.entity_path)),sha256Canonical(old));
  await write('stale-checks',{ok:true,source_invalidated:true,stale_regeneration_rejected:true,unrelated_geometry_unchanged:true});
 }
 if(mode==='rebind-fingerprint'){
  const evidence=JSON.parse(await fs.readFile('output/cad-kernel-probe/fingerprint-regression.json'));assert.ok(evidence.ok&&evidence.saved_roundoff_ignored&&evidence.real_edit_detected);
  const observed=JSON.parse(await fs.readFile(path.join(root,'after-reopen.json'))),fresh=await b.query_model_geometry({runtime:'queue',detail:'full'});assert.equal(fresh.model_revision,observed.model_revision,'Do not rebind after another edit');
  const operations=evidence.verified_rebindings.map(r=>{const c=fresh.snapshot.contexts.find(x=>x.entity_path===r.entity_path);assert.equal(c.cad.source_hash,r.source_hash);return {op:'attribute',entity_path:r.entity_path,edit_scope:'instance_path',instance_policy:'make_unique',instance_id:r.entity_path.slice(4),dictionary:'AlmaSketchupMCP',key:'cad_geometry_digest',value:r.geometry_digest};});
  await write('fingerprint-rebinding',await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations})}));await write('saved-fingerprint',await mutate('save_model',{path:modelPath}));
 }
 if(mode==='save'){
  await write('camera',await mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:[{op:'camera',eye:[650,-650,450],target:[215,0,45],up:[0,0,1]}]})}));
  await write('capture',await mutate('capture_view',{path:path.join(root,'overview.png'),width:1600,height:1000}));
  await write('saved',await mutate('save_model',{path:modelPath}));await write('before-reopen',await b.query_model_geometry({runtime:'queue',detail:'full'}));
 }
 if(mode==='persistence'){
  const old=JSON.parse(await fs.readFile(path.join(root,'before-reopen.json'))),q=await b.query_model_geometry({runtime:'queue',detail:'full'});
  for(const c of old.snapshot.contexts){const fresh=q.snapshot.contexts.find(x=>x.entity_path===c.entity_path);assert.ok(fresh);assert.deepEqual(fresh.cad,c.cad);assert.equal(fresh.faces.length,c.faces.length);assert.equal(fresh.vertices.length,c.vertices.length);}
  await write('persistence',{ok:true,new_document:q.snapshot.document_id!==old.snapshot.document_id,contexts:q.snapshot.contexts.length,parametric_sources_preserved:true});
 }
}
console.log(JSON.stringify({ok:true,mode,root}));
