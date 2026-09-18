#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {SketchUpBridge} from '../src/bridge.mjs';
import {sha256Canonical} from '../src/agent-contract.mjs';
const root=path.resolve('output/modeling-uplift/native'),out=path.join(root,'followup');await fs.mkdir(out,{recursive:true});
const bridge=new SketchUpBridge({agentContract:{rootDir:path.join(out,'tasks')},approval:{stateDir:path.join(out,'approval')},executionPolicy:{allowed_runtimes:['queue','mock'],allow_queue_mutation:true,allow_direct_expert_queue_mutation:true,trusted_model_copy_auto_approval:{enabled:true,allowed_roots:[root],allowed_risks:['S1','S2','S3','S4'],max_affected_instances:20,allow_save_model:true}}});
const write=async(name,value)=>{await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(value,null,2));return value;};
const checkpoint=async(name,fn)=>{try{return JSON.parse(await fs.readFile(path.join(out,name+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}return write(name,await fn());};
const query=()=>bridge.query_model_geometry({runtime:'queue',detail:'full',max_vertices:100000});
const mutate=(operation,args)=>bridge.withFreshQueueMutationAuthorization({operation,timeoutMs:30000},b=>b[operation]({...args,runtime:'queue',timeoutMs:30000}));
const edit=async(name,make)=>checkpoint(name,async()=>{const q=await query(),c=q.snapshot.contexts.find(c=>c.entity_path==='model');const r=await bridge.edit_model_geometry({runtime:'queue',snapshot_handle:q.snapshot_handle,entity_path:'model',edits:make(c),idempotency_key:'followup-root-'+name});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.task_state,'completed',JSON.stringify(r));return r;});
const canonical=value=>{if(typeof value==='number')return Math.round(value*1e7)/1e7 || 0;if(Array.isArray(value)){const a=value.map(canonical);if(a.every(x=>typeof x==='string'))a.sort();if(a.every(x=>x?.handle||x?.entity_path))a.sort((a,b)=>(a.handle||a.entity_path).localeCompare(b.handle||b.entity_path));return a;}if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonical(v)]));return value;};
const mode=process.argv[2]||'batch';
try{
if(mode==='batch'){
 const info=await bridge.get_model_info({runtime:'queue'});assert.equal(info.source_path??info.path,path.join(root,'modeling-uplift.skp'),'Only the owned QA model may be changed');
 const before=await checkpoint('before',query);
 await checkpoint('material',()=>mutate('build_model',{code:JSON.stringify({version:1,units:'mm',operations:[{op:'material',name:'UpliftFollowupBlue',color:'#2288cc'}]})}));
 await edit('add-face',()=>[{op:'add_face',points:[[800,0,0],[820,0,0],[820,20,0],[800,20,0]]}]);
 const face=c=>c.faces.find(f=>f.loops[0].vertices.every(h=>c.vertices.find(v=>v.handle===h).position[0]>=799));
 await edit('properties',c=>[{op:'set_face_material',handle:face(c).handle,material:'UpliftFollowupBlue',side:'both'},{op:'set_edge_properties',handle:c.edges.find(e=>e.faces.includes(face(c).handle)).handle,soft:true,smooth:true}]);
 const properties=await query(),pc=properties.snapshot.contexts.find(c=>c.entity_path==='model');assert.equal(face(pc).material,'UpliftFollowupBlue');assert.equal(face(pc).back_material,'UpliftFollowupBlue');assert.ok(pc.edges.some(e=>e.soft&&e.smooth));
 await write('property-readback',{front_material:true,back_material:true,soft:true,smooth:true});
 const preReverse=face(pc).normal;
 await edit('reverse',c=>[{op:'reverse_face',handle:face(c).handle}]);
 const rc=(await query()).snapshot.contexts.find(c=>c.entity_path==='model');assert.ok(face(rc).normal.every((v,i)=>Math.abs(v+preReverse[i])<1e-8));
 await edit('move',c=>[{op:'move_vertices',coordinate_space:'world',moves:face(c).loops[0].vertices.map(handle=>({handle,delta:[1,0,0]}))}]);
 await edit('matrix',c=>[{op:'transform_entities',coordinate_space:'world',handles:[face(c).handle],matrix:[1,0,0,0,0,1,0,0,0,0,1,0,9,0,0,1]}]);
 await edit('pushpull',c=>[{op:'pushpull_face',handle:face(c).handle,distance:-30}]);
 await edit('add-edges',()=>[{op:'add_edges',points:[[900,0,0],[910,0,0],[910,10,0]]}]);
 await edit('erase',c=>[{op:'erase_entities',handles:c.edges.filter(e=>e.vertices.every(h=>c.vertices.find(v=>v.handle===h).position[0]>=899)).map(e=>e.handle)}]);
 const after=await query(),rootContext=after.snapshot.contexts.find(c=>c.entity_path==='model');
 assert.equal(sha256Canonical(before.snapshot.contexts.filter(c=>c.entity_path!=='model')),sha256Canonical(after.snapshot.contexts.filter(c=>c.entity_path!=='model')),'All prior grouped geometry preserved');
 assert.ok(rootContext.vertices.every(v=>v.position[0]>=809.999&&v.position[0]<=830.001));
 const measure=await bridge.measure_model_geometry({snapshot_handle:after.snapshot_handle,queries:[{kind:'volume',entity_path:'model'}]});assert.ok(Math.abs(measure.results[0].value-12000)<1e-5,JSON.stringify(measure));
 let page=await bridge.query_model_geometry({runtime:'queue',targets:['model'],recursive:false,page_size:3,detail:'full'}),all=[],pages=0,handle=page.snapshot_handle;
 while(true){pages++;assert.equal(page.snapshot_handle,handle);for(const c of page.snapshot.contexts)for(const kind of ['vertices','edges','faces'])all.push(...c[kind].map(e=>e.handle));if(!page.page.next_cursor)break;page=await bridge.query_model_geometry({cursor:page.page.next_cursor,detail:'full'});}
 assert.equal(all.length,rootContext.vertices.length+rootContext.edges.length+rootContext.faces.length);assert.equal(new Set(all).size,all.length);
 await write('checks',{ok:true,all_nine_edit_operations:true,root_geometry:true,material_both_sides:true,edge_soft_smooth:true,reverse_native_normal:true,world_vertex_and_matrix:true,volume_mm3:measure.results[0].value,unrelated_contexts_unchanged:true,pages,records:all.length,no_duplicates:true});
}
if(mode==='save'){
 await write('overview',await mutate('capture_view',{path:path.join(out,'overview.png'),width:1600,height:1000,zoom_extents:true}));
 await write('save',await mutate('save_model',{path:path.join(root,'modeling-uplift.skp')}));
 await write('before-reopen',await query());
}
if(mode==='open')await write('open',await mutate('open_model',{path:path.join(root,'modeling-uplift.skp')}));
if(mode==='persistence'){
 const before=JSON.parse(await fs.readFile(path.join(out,'before-reopen.json'),'utf8')),after=await query();
 assert.equal(after.model_revision,before.model_revision);assert.notEqual(after.snapshot.document_id,before.snapshot.document_id);assert.deepEqual(canonical(after.snapshot.contexts),canonical(before.snapshot.contexts));await write('persistence',{ok:true,closed_reopened:true,all_contexts:after.contexts.length,root_attributes_preserved:true,model_revision:after.model_revision});
}
console.log(JSON.stringify({ok:true,mode,evidence:out}));
}catch(e){await write('failure-'+mode,{message:e.message,code:e.code,stack:e.stack});console.error(e.stack);process.exitCode=1;}
