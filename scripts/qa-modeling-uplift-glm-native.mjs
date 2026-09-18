#!/usr/bin/env node
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {SketchUpBridge} from '../src/bridge.mjs';import {compileModelProgramSource} from '../src/expert-compiler.mjs';
const original='/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica';
const {requestAlmaMessage}=await import(pathToFileURL(path.join(original,'scripts/model-accessibility/alma-provider.mjs')));
const config=JSON.parse(await fs.readFile(path.join(original,'output/model-accessibility-live-2026-09-08/glm-provider.json'),'utf8'));
const root=path.resolve('output/modeling-uplift/native'),out=path.resolve('output/modeling-uplift/glm');
const b=new SketchUpBridge({agentContract:{rootDir:path.join(out,'native-tasks')},approval:{stateDir:path.join(out,'approval')},executionPolicy:{allowed_runtimes:['queue','mock'],allow_queue_mutation:true,allow_direct_expert_queue_mutation:true,trusted_model_copy_auto_approval:{enabled:true,allowed_roots:[root],allowed_risks:['S1','S2','S3','S4'],max_affected_instances:20,allow_save_model:false}}});
const names=process.argv.slice(2);const results=[];
for(const id of names.length?names:['generation','local-edit','readback']){
 const file=path.join(out,id+'-uplift.json'),r=JSON.parse(await fs.readFile(file));if(r.native){results.push(r.native);continue;}
 if(r.summary.parameter_result!=='accepted'){results.push({task:id,status:'not_executed'});continue;}
 let parsed=r.attempts.at(-1).parsed,q=await b.query_model_geometry({runtime:'queue',detail:'full'});
 let failure;try{compileModelProgramSource(parsed.stages[0].code,{bindings:{snapshot:q.snapshot,previous:null,parameters:{},stage:0}});}catch(e){failure=e.message;}
 if(failure&&r.attempts.length===1){
  const last=r.attempts[0].response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  try{
   const response=await requestAlmaMessage({...config,timeoutMs:120000,body:{model:config.model,messages:[{role:'user',content:r.prompt+'\nTask: '+r.task},{role:'assistant',content:last},{role:'user',content:'Compilation failed before any mutation: '+failure+'. Correct once, return the complete JSON stages.'}],max_tokens:2500,stream:false}});
   const text=response.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');parsed=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));r.attempts.push({response,parsed,error:null});r.summary.requests++;r.summary.corrections++;r.summary.usage.push(response.usage);failure=null;
   try{compileModelProgramSource(parsed.stages[0].code,{bindings:{snapshot:q.snapshot,previous:null,parameters:{},stage:0}});}catch(e){failure=e.message;}
  }catch(e){failure=e.message;r.correction_transport_error={code:e.code,message:e.message};}
  await fs.writeFile(file,JSON.stringify(r,null,2));
 }
 if(failure){r.native={task:id,status:'compile_failed',reason:failure,mutated:false};await fs.writeFile(file,JSON.stringify(r,null,2));results.push(r.native);console.log(JSON.stringify(r.native));continue;}
 const handshake=await b.create_queue_handshake();
 const outcome=await b.run_model_program({runtime:'queue',session_contract:handshake.session_contract,stages:parsed.stages,idempotency_key:'glm-followup-'+id,instruction:r.task});
 r.native={task:id,status:outcome.task_state,outcome,before_snapshot_handle:q.snapshot_handle};await fs.writeFile(file,JSON.stringify(r,null,2));
 if(outcome.ok&&outcome.task_state==='completed'){
  const after=await b.query_model_geometry({runtime:'queue',detail:'full'});r.native.readback_revision=after.model_revision;
  if(id==='generation'){const c=after.snapshot.contexts.find(c=>c.name==='GLM_Generation');assert.ok(c?.manifold);assert.equal(c.vertices.length,12);r.native.geometry_assertion='closed_3_station_rectangular_sweep';}
  if(id==='local-edit'){const c=after.snapshot.contexts.find(c=>c.entity_path==='model');const old=q.snapshot.contexts.find(c=>c.entity_path==='model');const top=Math.max(...old.vertices.map(v=>v.world_position[2]));assert.ok(c.vertices.every(v=>{const a=old.vertices.find(x=>x.handle===v.handle);return a&&Math.abs(v.world_position[2]-a.world_position[2]-(Math.abs(a.world_position[2]-top)<1e-6?5:0))<1e-6;}));r.native.geometry_assertion='root_solid_top_plus_5mm_other_vertices_unchanged';}
  if(id==='readback'){const c=after.snapshot.contexts.find(c=>c.name==='GLM_Readback');assert.ok(c.vertices.some(v=>Math.abs(v.position[2]-25)<1e-6));assert.ok(c.vertices.filter(v=>v.position[0]<1029).every(v=>Math.abs(v.position[2])<1e-6));r.native.geometry_assertion='right_half_25mm_left_half_unchanged';}
  r.summary.native_executed=true;r.native.status='geometry_passed';
 }
 await fs.writeFile(file,JSON.stringify(r,null,2));results.push(r.native);console.log(JSON.stringify({task:id,status:r.native.status,task_id:outcome.task_id}));
}
await fs.writeFile(path.join(out,'native-summary.json'),JSON.stringify(results,null,2));
