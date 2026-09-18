import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {SketchUpBridge} from '../src/bridge.mjs';import {sha256Canonical} from '../src/agent-contract.mjs';
const root=path.resolve('output/modeling-uplift/native'),out=path.resolve('output/modeling-uplift/qa-scope');await fs.mkdir(out,{recursive:true});
const b=new SketchUpBridge({agentContract:{rootDir:path.join(out,'tasks')},approval:{stateDir:path.join(out,'approval')},executionPolicy:{allowed_runtimes:['queue','mock'],allow_queue_mutation:true,allow_direct_expert_queue_mutation:true,trusted_model_copy_auto_approval:{enabled:true,allowed_roots:[root],allowed_risks:['S1','S2','S3','S4'],max_affected_instances:20,allow_save_model:true}}});
const id=process.argv[2]||'control',file=path.join(out,'native-'+id+'.json');
try{await fs.access(file);throw new Error('Existing execution evidence; inspect instead of replay');}catch(e){if(e.code!=='ENOENT')throw e;}
const info=await b.get_model_info({runtime:'queue'});assert.equal(info.source_path??info.path,path.join(root,'modeling-uplift.skp'));
const before=await b.query_model_geometry({runtime:'queue',detail:'full'});assert.ok(before.snapshot.contexts.some(c=>c.name==='Sweep_Closed'));
const recovering=id==='glm-recovery';
if(recovering){const prior=JSON.parse(await fs.readFile(path.join(out,'native-glm.json')));const task=await b.taskStore.getTask(prior.result.task_id,{includePrivate:true});assert.equal(task.private.model_program.index,1);assert.equal(task.state,'failed');assert.ok(before.snapshot.contexts.some(c=>c.name==='GLM_QAFix'));}
const name=id==='control'?'Scope_Control':'GLM_QAFix';
const stages=id==='control'?[
 {kind:'create',code:"({operations:[{op:'mesh',name:'Scope_Control',vertices:[[1200,400,0],[1260,400,0],[1260,440,0],[1200,440,0]],faces:[[0,1,2,3]]}],result:{name:'Scope_Control'}});"},
 {kind:'edit',code:"const c=snapshot.contexts.find(c=>c.name===previous.name);({entity_path:c.entity_path,edits:[{op:'add_edges',points:[[1230,400,0],[1230,440,0]]}],result:previous});"},
 {kind:'edit',code:"const c=snapshot.contexts.find(c=>c.name===previous.name);const f=c.faces.find(f=>f.loops[0].vertices.every(h=>c.vertices.find(v=>v.handle===h).position[0]>=1229.99));({entity_path:c.entity_path,edits:[{op:'pushpull_face',handle:f.handle,distance:f.normal[2]>0?25:-25}],result:previous});"}
]:JSON.parse(await fs.readFile(path.join(out,'glm-correction.json'))).parsed.stages;
if(recovering)stages.splice(0,1);
const handshake=await b.create_queue_handshake();const result=await b.run_model_program({runtime:'queue',session_contract:handshake.session_contract,idempotency_key:'qa-scope-'+id,stages,instruction:'Verify three stages while preserving existing model geometry and reporting background warnings.'});
await fs.writeFile(file,JSON.stringify({result},null,2));assert.equal(result.task_state,'completed',JSON.stringify(result));
const task=await b.taskStore.getTask(result.task_id,{includePrivate:true});const created=await b.taskStore.getTask(task.private.model_program.stages[0].child_task_id,{includePrivate:true});
const after=await b.query_model_geometry({runtime:'queue',detail:'full'});const c=after.snapshot.contexts.find(c=>c.name===name);assert.ok(c);
assert.ok(c.vertices.some(v=>Math.abs(v.position[2]-25)<1e-6));assert.ok(c.vertices.filter(v=>v.position[0]<1229).every(v=>Math.abs(v.position[2])<1e-6));
for(const old of before.snapshot.contexts.filter(c=>!recovering||c.name!==name)){const current=after.snapshot.contexts.find(c=>c.entity_path===old.entity_path);assert.equal(sha256Canonical(current),sha256Canonical(old),'Unrelated geometry changed: '+old.name);}
if(!recovering){assert.equal(created.result.qa.verdict,'pass');assert.ok(created.result.qa.background_issues.some(i=>i.item==='Sweep_Closed'));}
await fs.writeFile(file,JSON.stringify({ok:true,source:id!=='control'?'unmodified GLM corrected stages':'deterministic control program',task_id:result.task_id,completed_stages:stages.length,prior_committed_stages:recovering?1:0,native_top_height_mm:25,left_half_unchanged:true,all_preexisting_geometry_unchanged:true,background_warning_retained:true,scope_evidence:created.result.qa?.scope_evidence,result},null,2));
await b.withFreshQueueMutationAuthorization({operation:'save_model'},live=>live.save_model({runtime:'queue',path:path.join(root,'modeling-uplift.skp')}));
console.log(JSON.stringify({ok:true,id,stages:stages.length,evidence:file}));
